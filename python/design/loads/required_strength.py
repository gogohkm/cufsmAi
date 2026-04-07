"""통합 소요강도 계산 — analyze_loads 메인 엔트리포인트

사용자 입력(부재구성, 하중, 데크) → 구조해석 → 하중조합 → 소요강도 추출
"""

E_STEEL = 29500.0  # ksi — CFS 표준 탄성계수 (기본값)

from design.loads.load_combinations import (
    get_applicable_combos, apply_combination, find_controlling_combo,
)
from design.loads.beam_analysis import (
    analyze_simple_beam, analyze_continuous_beam,
    analyze_continuous_beam_general, analyze_cantilever_beam,
    analyze_beam_fe,
    extract_critical_locations, compute_deflection,
    compute_deflection_variable_I, extract_max_deflection_per_span,
    BeamResult,
)
from design.loads.bracing import (
    calc_rotational_stiffness, calc_lateral_stiffness,
    determine_unbraced_lengths, check_i621_conditions,
)


def analyze_loads(
    member_app: str,
    span_type: str,
    span_ft: float,
    loads: dict,
    design_method: str = 'LRFD',
    spacing_ft: float = 5.0,
    laps: dict = None,
    deck: dict = None,
    section: dict = None,
    supports: list = None,
    spans_ft: list = None,
    laps_per_support: list = None,
    E: float = None,
) -> dict:
    """통합 하중 분석

    Parameters
    ----------
    member_app : 'roof-purlin', 'floor-joist', 'wall-girt', 'wall-stud'
    span_type : 'simple', 'cont-2', 'cont-3', 'cont-4', 'cont-n'
    span_ft : 스팬 길이 (ft)
    loads : dict — {'D': plf, 'Lr': plf, 'S': plf, 'W': plf, ...}
    design_method : 'ASD' or 'LRFD'
    spacing_ft : 부재 간격 (ft), PSF→PLF 변환은 호출자가 수행
    laps : dict — {'left_ft': float, 'right_ft': float}
    deck : dict — {'type', 't_panel', 'fastener_spacing', ...}
    section : dict — 단면 정보 (I6.2.1 검증용), section['E']가 있으면 탄성계수로 사용
    E : float — 탄성계수 (ksi), 지정 시 section['E']보다 우선. 미지정 시 29500.0 사용

    Returns
    -------
    dict with:
        controlling_combo, gravity, uplift, auto_params, wc_reactions, ...
    """
    # 경간 수 결정
    n_spans = _parse_n_spans(span_type)

    # 부등스팬 지원: spans_ft 배열이 제공되면 사용
    if spans_ft and len(spans_ft) == n_spans:
        spans = [float(s) for s in spans_ft]
    else:
        spans = [span_ft] * n_spans

    # 지점 조건 기본값
    if not supports:
        supports = ['P'] * (n_spans + 1)

    # 각 하중 케이스별 구조해석
    load_types = {k: v for k, v in loads.items() if v is not None and v != 0}
    load_results = {}

    # 자유단(N) 포함 여부 확인 → 캔틸레버/일반 해석 경로 결정
    has_free = any(s.upper().startswith('N') for s in supports)

    # Lap 유무 판별
    has_laps = laps_per_support and any(
        lp and (lp.get('left_ft', 0) > 0 or lp.get('right_ft', 0) > 0)
        for lp in laps_per_support if lp
    )
    # 단면2차모멘트 (FE 해석용)
    Ixx_fe = (section.get('Ixx') or section.get('Ix') or 1.0) if section else 1.0
    E_fe = E or (section.get('E') if section else None) or E_STEEL

    for load_type, w_plf in load_types.items():
        if has_laps and n_spans > 1:
            # Lap 비등단면 → FE 직접 강성법 (M, V, R, δ 동시 계산)
            w_list = [w_plf] * n_spans
            result = analyze_beam_fe(
                spans, w_list, supports=supports,
                laps_per_support=laps_per_support,
                I_base_in4=Ixx_fe, I_lap_ratio=2.0,
                E_ksi=E_fe,
            )
        elif n_spans == 1 and not has_free and sup_type_simple(supports):
            result = analyze_simple_beam(spans[0], w_plf)
        else:
            w_list = [w_plf] * n_spans
            result = analyze_continuous_beam_general(
                spans, w_list, supports=supports,
            )
        load_results[load_type] = result.to_dict()

    # 하중조합 적용 → 지배조합 결정
    controlling = find_controlling_combo(loads, load_results, design_method)

    # 중력 지배 결과
    gravity_result = None
    gravity_name = None
    if controlling.get('gravity'):
        gravity_name, gravity_combined = controlling['gravity']
        gravity_locations = _extract_locations_from_combined(
            gravity_combined, spans, laps
        )
        gravity_result = {
            'combo': gravity_name,
            'locations': gravity_locations,
            'M_diagram': gravity_combined.get('M', []),
            'V_diagram': gravity_combined.get('V', []),
        }

    # 양력 결과
    uplift_result = None
    if controlling.get('uplift'):
        uplift_name, uplift_combined = controlling['uplift']
        uplift_locations = _extract_locations_from_combined(
            uplift_combined, spans, laps
        )
        uplift_result = {
            'combo': uplift_name,
            'locations': uplift_locations,
            'M_diagram': uplift_combined.get('M', []),
        }

    # 데크 강성 계산
    deck_info = _calc_deck_info(deck, section, E=E)

    # 비지지길이 자동 결정
    auto_params = {}
    if gravity_result:
        M_diag = gravity_result['M_diagram']
        # x 좌표 생성 (간단한 등간격)
        total_L = sum(spans)
        n_pts = len(M_diag)
        x_diag = [i * total_L / (n_pts - 1) for i in range(n_pts)] if n_pts > 1 else [0]

        unbraced = determine_unbraced_lengths(
            M_diag, x_diag, spans, laps,
            deck_type=deck.get('type', 'none') if deck else 'none',
        )
        auto_params['unbraced'] = unbraced
        auto_params['deck'] = deck_info

        # 정모멘트 영역: fully braced (deck)
        auto_params['positive_region'] = {
            'Ly_in': 0, 'Lt_in': 0, 'Cb': 1.0,
            'kphi': deck_info.get('kphi', 0),
            'braced': True,
        }

        # 부모멘트 영역: 비지지 (첫 번째 부모멘트 구간 대표)
        neg_regions = unbraced.get('negative_regions', [])
        if neg_regions:
            nr = neg_regions[0]
            auto_params['negative_region'] = {
                'Ly_in': nr.get('Ly_in', 0),
                'Lt_in': nr.get('Lt_in', 0),
                'Cb': nr.get('Cb', 1.67),
                'kphi': 0,  # 부모멘트: 하부 플랜지 비지지
            }
        else:
            auto_params['negative_region'] = {
                'Ly_in': span_ft * 12, 'Lt_in': span_ft * 12,
                'Cb': 1.0, 'kphi': 0,
            }

    # I6.2.1 양력 R 검증
    if section:
        i621 = check_i621_conditions(
            section=section, Fy=section.get('Fy', 35.53),
            Fu=section.get('Fu', 58.02), span_ft=span_ft,
            span_type='continuous' if n_spans > 1 else 'simple',
            lap_length_in=min(laps.get('left_ft', 0), laps.get('right_ft', 0)) * 12
            if laps else None,
        )
        auto_params['uplift_R'] = i621.get('R')
        auto_params['i621_check'] = i621
    else:
        # 단면 정보 없으면 보수적 R
        auto_params['uplift_R'] = 0.60

    # 웹크리플링용 반력 추출
    wc_reactions = _extract_wc_reactions(gravity_result, spans)

    # ── 처짐 계산 (사용하중 조합) ──
    deflection_result = None
    if gravity_result and section:
        E_ksi = E or (section.get('E') if section else None) or E_STEEL
        Ixx = section.get('Ixx') or section.get('Ix') or 0
        if Ixx > 0:
            # 사용하중 조합(비계수 하중)으로 처짐 계산 — ASD 조합 사용
            service_controlling = find_controlling_combo(loads, load_results, 'ASD')
            service_gravity = service_controlling.get('gravity')
            if service_gravity:
                svc_name, svc_combined = service_gravity
                svc_M = svc_combined.get('M', [])
                svc_V = svc_combined.get('V', [])
                svc_R = svc_combined.get('R', [])
                if len(svc_M) > 2:
                    total_L = sum(spans)
                    n_pts = len(svc_M)
                    svc_x = [i * total_L / (n_pts - 1) for i in range(n_pts)]
                    svc_result = BeamResult(svc_x, svc_M, svc_V, svc_R, n_pts)

                    # Lap이 있으면 비등단면 보 해석으로 모멘트 재분배 후 처짐 계산
                    # Lap 구간의 EI 증가 → 지점 모멘트 증가 → 경간 모멘트 감소 → 처짐 감소
                    defl = compute_deflection_variable_I(
                        svc_result, E_ksi, Ixx,
                        spans=spans, supports=supports,
                        laps_per_support=laps_per_support,
                        I_lap_ratio=2.0,
                    )
                    per_span = extract_max_deflection_per_span(svc_x, defl, spans)
                    deflection_result = {
                        'combo': svc_name,
                        'D_diagram': defl,
                        'per_span': per_span,
                        'E_ksi': E_ksi,
                        'Ixx': Ixx,
                    }

    return {
        'member_app': member_app,
        'span_type': span_type,
        'n_spans': n_spans,
        'design_method': design_method,
        'gravity': gravity_result,
        'uplift': uplift_result,
        'deflection': deflection_result,
        'auto_params': auto_params,
        'wc_reactions': wc_reactions,
        'all_combos': [name for name, _ in controlling.get('all', [])],
        'all_combos_detail': controlling.get('all_detail', []),
        'input_loads_plf': {k: round(v, 3) for k, v in loads.items()
                           if v is not None and v != 0},
        'supports': supports,
        'spans_ft': spans,
        'laps_per_support': laps_per_support,
    }


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

def sup_type_simple(supports: list) -> bool:
    """양단 핀/롤러인 단순보인지 확인 (고정단·자유단 아닌 경우)"""
    if not supports or len(supports) < 2:
        return True
    for s in supports:
        c = s[0].upper() if s else 'P'
        if c in ('F', 'N'):
            return False
    return True


def _parse_n_spans(span_type: str) -> int:
    mapping = {
        'simple': 1, 'cantilever': 1,
        'cont-2': 2, 'cont-3': 3, 'cont-4': 4, 'cont-5': 5,
    }
    # cont-n with custom count: "cont-6", "cont-7" etc.
    if span_type.startswith('cont-') and span_type[5:].isdigit():
        return int(span_type[5:])
    return mapping.get(span_type, 1)


def _extract_locations_from_combined(combined: dict, spans: list,
                                     laps: dict = None) -> list:
    """하중조합 결과에서 임계 위치 추출"""
    M = combined.get('M', [])
    V = combined.get('V', [])
    R = combined.get('R', [])

    if not M:
        return []

    total_L = sum(spans)
    n_pts = len(M)
    x = [i * total_L / (n_pts - 1) for i in range(n_pts)] if n_pts > 1 else [0]

    # BeamResult 호환 임시 객체 생성
    from design.loads.beam_analysis import BeamResult
    temp = BeamResult(x, M, V, R, n_pts)
    return extract_critical_locations(temp, spans, laps)


def _calc_deck_info(deck: dict, section: dict = None,
                    E: float = None) -> dict:
    """데크 강성 정보 계산"""
    if not deck or deck.get('type') == 'none':
        return {'kphi': 0, 'kx': 0, 'type': 'none'}

    E_val = E or E_STEEL

    kphi_override = deck.get('kphi_override')
    if kphi_override is not None and kphi_override > 0:
        kphi = kphi_override
    else:
        t_purlin = section.get('thickness', 0.059) if section else 0.059
        flange_w = section.get('flange_width', 2.5) if section else 2.5
        kphi = calc_rotational_stiffness(
            t_panel=deck.get('t_panel', 0.018),
            t_purlin=t_purlin,
            fastener_spacing=deck.get('fastener_spacing', 12),
            flange_width=flange_w,
            E=E_val,
        )

    t_purlin = section.get('thickness', 0.059) if section else 0.059
    kx = calc_lateral_stiffness(
        t_panel=deck.get('t_panel', 0.018),
        t_purlin=t_purlin,
        Pss=deck.get('Pss', 1800),
        d_screw=deck.get('d_screw', 0.17),
        Fu_panel=deck.get('Fu_panel', 70),
        fastener_spacing=deck.get('fastener_spacing', 12),
        E=E_val,
    )

    return {
        'kphi': round(kphi, 4),
        'kx': round(kx, 3),
        'type': deck.get('type', 'through-fastened'),
    }


def _extract_wc_reactions(gravity_result: dict, spans: list) -> list:
    """웹크리플링용 지점 반력 추출"""
    if not gravity_result:
        return []

    locations = gravity_result.get('locations', [])
    wc = []

    for loc in locations:
        Ru = loc.get('Ru')
        if Ru is not None and Ru > 0:
            region = loc.get('region', '')
            if region == 'support_end':
                case = 'EOF'
            else:
                case = 'IOF'
            wc.append({
                'name': loc['name'],
                'Pu': Ru,
                'case': case,
            })

    return wc
