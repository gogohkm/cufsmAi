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
    load_types = {k: v for k, v in loads.items()
                  if v is not None and v != 0 and k != 'Wp'}
    load_results = {}

    # 풍정압(Wp) 분리: Wp는 'W'와 같은 하중계수를 사용하지만 부호가 양수(하향)
    Wp_plf = loads.get('Wp', 0) or 0

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

    def _run_analysis(w_plf):
        if has_laps and n_spans > 1:
            w_list = [w_plf] * n_spans
            return analyze_beam_fe(
                spans, w_list, supports=supports,
                laps_per_support=laps_per_support,
                I_base_in4=Ixx_fe, I_lap_ratio=2.0,
                E_ksi=E_fe,
            )
        elif n_spans == 1 and not has_free and sup_type_simple(supports):
            return analyze_simple_beam(spans[0], w_plf)
        else:
            w_list = [w_plf] * n_spans
            return analyze_continuous_beam_general(
                spans, w_list, supports=supports,
            )

    for load_type, w_plf in load_types.items():
        load_results[load_type] = _run_analysis(w_plf).to_dict()

    # Wp 해석 (풍정압): 별도로 'Wp' 키에 저장
    Wp_result = None
    if Wp_plf > 0:
        Wp_result = _run_analysis(Wp_plf).to_dict()

    # 하중조합 적용 → 지배조합 결정
    # 1차: W(부압/양력) 조합
    controlling = find_controlling_combo(loads, load_results, design_method)

    # 2차: Wp(정압) 조합 — 'W' 슬롯에 Wp 결과를 대입하여 재계산
    if Wp_result:
        wp_load_results = dict(load_results)
        wp_load_results['W'] = Wp_result
        wp_loads = dict(loads)
        wp_loads['W'] = Wp_plf  # 양수 → is_uplift=False
        wp_loads.pop('Wp', None)
        controlling_wp = find_controlling_combo(wp_loads, wp_load_results,
                                                design_method)
        # Wp 중력 조합이 Wu 중력보다 클 경우 교체
        controlling = _merge_controlling(controlling, controlling_wp)

    # laps에 지점별 정보 첨부 (extract_critical_locations에서 사용)
    laps_with_detail = dict(laps) if laps else {}
    if laps_per_support:
        laps_with_detail['_per_support'] = laps_per_support

    # 중력 지배 결과
    gravity_result = None
    gravity_name = None
    if controlling.get('gravity'):
        gravity_name, gravity_combined = controlling['gravity']
        gravity_locations = _extract_locations_from_combined(
            gravity_combined, spans, laps_with_detail
        )
        gravity_result = {
            'combo': gravity_name,
            'locations': gravity_locations,
            'M_diagram': gravity_combined.get('M', []),
            'V_diagram': gravity_combined.get('V', []),
            'x_diagram': gravity_combined.get('x', []),
        }

    # 양력 결과
    uplift_result = None
    if controlling.get('uplift'):
        uplift_name, uplift_combined = controlling['uplift']
        uplift_locations = _extract_locations_from_combined(
            uplift_combined, spans, laps_with_detail
        )
        uplift_result = {
            'combo': uplift_name,
            'locations': uplift_locations,
            'M_diagram': uplift_combined.get('M', []),
            'x_diagram': uplift_combined.get('x', []),
        }

    # 데크 강성 계산
    deck_info = _calc_deck_info(deck, section, E=E)

    # 비지지길이 자동 결정
    auto_params = {}
    if gravity_result:
        M_diag = gravity_result['M_diagram']
        # 해석에서 전달된 실제 x좌표 사용 (부등경간 정확도 보장)
        total_L = sum(spans)
        n_pts = len(M_diag)
        x_diag = gravity_result.get('x_diagram', [])
        if not x_diag or len(x_diag) != n_pts:
            x_diag = [i * total_L / (n_pts - 1) for i in range(n_pts)] if n_pts > 1 else [0]

        unbraced = determine_unbraced_lengths(
            M_diag, x_diag, spans, laps,
            laps_per_support=laps_per_support,
            deck_type=deck.get('type', 'none') if deck else 'none',
        )
        auto_params['unbraced'] = unbraced
        auto_params['deck'] = deck_info

        # 정모멘트 영역
        deck_braces_top = deck and deck.get('type', 'none') in ('through-fastened', 'standing-seam')
        if deck_braces_top:
            # 데크가 상부 플랜지를 연속 지지 → LTB 불필요
            auto_params['positive_region'] = {
                'Ly_in': 0, 'Lt_in': 0, 'Cb': 1.0,
                'kphi': deck_info.get('kphi', 0),
                'braced': True,
            }
        else:
            # 데크 없음 → 정모멘트 구간도 비지지, Lb/Cb 계산 필요
            pos_regions = unbraced.get('positive_regions', [])
            if pos_regions and pos_regions[0].get('Ly', 0) > 0:
                pr = pos_regions[0]
                auto_params['positive_region'] = {
                    'Ly_in': pr.get('Ly', 0),
                    'Lt_in': pr.get('Lt', 0),
                    'Cb': pr.get('Cb', 1.0),
                    'kphi': 0,
                    'braced': False,
                }
            else:
                # positive_regions에서 Ly 계산이 없으면 변곡점 간 거리 사용
                inflections = unbraced.get('inflection_points_ft', [])
                if len(inflections) >= 2:
                    # 가장 긴 정모멘트 구간 ≈ 인접 변곡점 간 최대 거리
                    max_pos_span = 0
                    for k in range(len(inflections) - 1):
                        seg = inflections[k + 1] - inflections[k]
                        if seg > max_pos_span:
                            max_pos_span = seg
                    Ly_pos = max_pos_span * 12.0  # ft → in
                elif len(inflections) == 1:
                    # 단순보: 전체 스팬
                    Ly_pos = max(spans) * 12.0
                else:
                    Ly_pos = max(spans) * 12.0
                # 정모멘트 구간 Cb 계산
                Cb_pos = 1.0
                if inflections and len(M_diag) > 2:
                    from design.loads.bracing import calc_Cb_from_diagram
                    if len(inflections) >= 2:
                        Cb_pos = calc_Cb_from_diagram(M_diag, x_diag,
                                                       inflections[0], inflections[1])
                    elif len(inflections) == 1:
                        Cb_pos = calc_Cb_from_diagram(M_diag, x_diag, 0, inflections[0])
                auto_params['positive_region'] = {
                    'Ly_in': round(Ly_pos, 1),
                    'Lt_in': round(Ly_pos, 1),
                    'Cb': round(max(Cb_pos, 1.0), 2),
                    'kphi': 0,
                    'braced': False,
                }

        # 부모멘트 영역: 비지지 (첫 번째 부모멘트 구간 대표)
        neg_regions = unbraced.get('negative_regions', [])
        if neg_regions:
            nr = max(neg_regions, key=lambda r: r.get('Ly_in', 0))
            auto_params['negative_regions'] = neg_regions
            auto_params['negative_region_gov'] = {
                'start_ft': nr.get('start_ft', 0),
                'end_ft': nr.get('end_ft', 0),
                'Ly_in': nr.get('Ly_in', 0),
                'Lt_in': nr.get('Lt_in', 0),
                'Cb': nr.get('Cb', 1.67),
                'Cb_detail': nr.get('Cb_detail'),
                'M1': nr.get('M1'),
                'M2': nr.get('M2'),
                'kphi': 0,  # 부모멘트: 하부 플랜지 비지지
            }
            auto_params['negative_region'] = auto_params['negative_region_gov']
        else:
            # 부모멘트 영역 없음 (단순보 또는 변곡점 없음) → 전체 스팬 사용
            inflections = unbraced.get('inflection_points_ft', [])
            total_L = sum(spans)
            # 변곡점이 있으면 변곡점~마지막 지점 구간 사용
            if inflections:
                fb_start = inflections[-1]
                fb_end = total_L
                fb_Ly = (fb_end - fb_start) * 12
            else:
                fb_start = 0
                fb_end = total_L
                fb_Ly = total_L * 12
            fallback_nr = {
                'start_ft': fb_start, 'end_ft': fb_end,
                'Ly_in': round(fb_Ly, 1), 'Lt_in': round(fb_Ly, 1),
                'Cb': 1.0, 'kphi': 0,
            }
            auto_params['negative_regions'] = [fallback_nr]
            auto_params['negative_region_gov'] = fallback_nr
            auto_params['negative_region'] = fallback_nr

    # ── 양력 지배 시 Lb/Cb 별도 계산 ──
    # 양력 시 압축 플랜지가 반전됨:
    #   중력: 정모멘트=상부압축(데크지지), 부모멘트=하부압축(비지지)
    #   양력: 정모멘트=상부압축(데크지지), 부모멘트=하부압축(비지지)
    # → 양력 M_diagram을 부호 반전(-M)하면 중력과 동일한 로직 적용 가능
    if uplift_result:
        uM = uplift_result.get('M_diagram', [])
        ux = uplift_result.get('x_diagram', [])
        if uM and len(uM) > 2:
            total_L_u = sum(spans)
            n_pts_u = len(uM)
            if not ux or len(ux) != n_pts_u:
                ux = [i * total_L_u / (n_pts_u - 1) for i in range(n_pts_u)]

            # 양력 M을 부호 반전 → 중력과 동일한 정/부 판정으로 변환
            uM_flipped = [-m for m in uM]

            # 데크 지지 반전: 양력 시 데크(상부)는 원래의 부모멘트(=반전 후 정모멘트) 구간 지지
            # → 반전 후 정모멘트 구간이 데크 지지 = 중력과 동일 로직
            deck_type_u = deck.get('type', 'none') if deck else 'none'
            unbraced_u = determine_unbraced_lengths(
                uM_flipped, ux, spans, laps,
                laps_per_support=laps_per_support,
                deck_type=deck_type_u,
            )

            uplift_auto = {}
            deck_braces = deck and deck_type_u in ('through-fastened', 'standing-seam')

            # 양력 정모멘트 영역 (= 원래 부모멘트 방향 → 반전 후 정모멘트)
            if deck_braces:
                uplift_auto['positive_region'] = {
                    'Ly_in': 0, 'Lt_in': 0, 'Cb': 1.0,
                    'kphi': deck_info.get('kphi', 0), 'braced': True,
                }
            else:
                upos = unbraced_u.get('positive_regions', [])
                if upos and upos[0].get('Ly', 0) > 0:
                    pr = upos[0]
                    uplift_auto['positive_region'] = {
                        'Ly_in': pr.get('Ly', 0), 'Lt_in': pr.get('Lt', 0),
                        'Cb': pr.get('Cb', 1.0), 'kphi': 0, 'braced': False,
                    }
                else:
                    uplift_auto['positive_region'] = {
                        'Ly_in': round(max(spans) * 12.0, 1),
                        'Lt_in': round(max(spans) * 12.0, 1),
                        'Cb': 1.0, 'kphi': 0, 'braced': False,
                    }

            # 양력 부모멘트 영역 (= 원래 정모멘트 방향 → 반전 후 부모멘트)
            uneg = unbraced_u.get('negative_regions', [])
            if uneg:
                unr = max(uneg, key=lambda r: r.get('Ly_in', 0))
                uplift_auto['negative_regions'] = uneg
                uplift_auto['negative_region'] = {
                    'start_ft': unr.get('start_ft', 0),
                    'end_ft': unr.get('end_ft', 0),
                    'Ly_in': unr.get('Ly_in', 0),
                    'Lt_in': unr.get('Lt_in', 0),
                    'Cb': unr.get('Cb', 1.67),
                    'Cb_detail': unr.get('Cb_detail'),
                    'M1': unr.get('M1'), 'M2': unr.get('M2'),
                    'kphi': 0,
                }
            else:
                fb = {'start_ft': 0, 'end_ft': total_L_u,
                      'Ly_in': round(total_L_u * 12, 1),
                      'Lt_in': round(total_L_u * 12, 1),
                      'Cb': 1.0, 'kphi': 0}
                uplift_auto['negative_regions'] = [fb]
                uplift_auto['negative_region'] = fb

            auto_params['uplift_bracing'] = uplift_auto

    # I6.2.1 양력 R 검증
    if section:
        lap_lengths_in = []
        if laps_per_support:
            for lap in laps_per_support:
                if not lap:
                    continue
                for key in ('left_ft', 'right_ft'):
                    if lap.get(key, 0) > 0:
                        lap_lengths_in.append(lap.get(key, 0) * 12)
        elif laps:
            for key in ('left_ft', 'right_ft'):
                if laps.get(key, 0) > 0:
                    lap_lengths_in.append(laps.get(key, 0) * 12)
        i621 = check_i621_conditions(
            section=section, Fy=section.get('Fy', 35.53),
            Fu=section.get('Fu', 58.02), span_ft=max(spans),
            span_type='continuous' if n_spans > 1 else 'simple',
            lap_length_in=max(lap_lengths_in) if lap_lengths_in else None,
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
                svc_D_combined = svc_combined.get('D', [])
                if len(svc_M) > 2:
                    total_L = sum(spans)
                    n_pts = len(svc_M)
                    svc_x = svc_combined.get('x', [])
                    if not svc_x or len(svc_x) != n_pts:
                        svc_x = [i * total_L / (n_pts - 1) for i in range(n_pts)]

                    # FE 해석에서 이미 계산된 D(랩 효과 반영)를 선형 조합한 결과 우선 사용
                    # FE D 조합이 없거나 유효하지 않으면 fallback으로 재계산
                    defl = None
                    if (svc_D_combined and len(svc_D_combined) == n_pts
                            and any(abs(d) > 1e-12 for d in svc_D_combined)):
                        defl = [round(d, 5) for d in svc_D_combined]
                    else:
                        # Fallback: 비등단면 FE 재계산
                        svc_result = BeamResult(svc_x, svc_M, svc_V, svc_R, n_pts)
                        defl = compute_deflection_variable_I(
                            svc_result, E_ksi, Ixx,
                            spans=spans, supports=supports,
                            laps_per_support=laps_per_support,
                            I_lap_ratio=2.0,
                        )

                    if defl is None:
                        defl = [0.0] * n_pts  # fallback
                    per_span = extract_max_deflection_per_span(svc_x, defl, spans)
                    deflection_valid = not (
                        any(abs(v) > 1e-8 for v in svc_M) and
                        all(abs(d) < 1e-12 for d in defl)
                    )
                    deflection_result = {
                        'combo': svc_name,
                        'D_diagram': defl,
                        'per_span': per_span,
                        'E_ksi': E_ksi,
                        'Ixx': Ixx,
                        'valid': deflection_valid,
                        'note': None if deflection_valid else 'FE deflection solve failed or returned a zero displacement field.',
                    }

    # 전체 조합 중 절대 최대 |M| 지배 조합 (gravity/uplift 구분 없음)
    governing_result = None
    if controlling.get('overall'):
        gov_name, gov_combined = controlling['overall']
        gov_locations = _extract_locations_from_combined(
            gov_combined, spans, laps_with_detail
        )
        governing_result = {
            'combo': gov_name,
            'locations': gov_locations,
            'M_diagram': gov_combined.get('M', []),
            'V_diagram': gov_combined.get('V', []),
            'x_diagram': gov_combined.get('x', []),
        }

    return {
        'member_app': member_app,
        'span_type': span_type,
        'n_spans': n_spans,
        'design_method': design_method,
        'governing': governing_result,
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

def _merge_controlling(base: dict, wp: dict) -> dict:
    """Wu 조합과 Wp 조합 결과를 병합하여 더 큰 쪽 채택"""
    merged = dict(base)

    def _max_abs_M(combo_tuple):
        if not combo_tuple:
            return 0
        _, combined = combo_tuple
        M = combined.get('M', [])
        return max((abs(m) for m in M), default=0) if M else 0

    # gravity: |M|max가 더 큰 쪽
    if _max_abs_M(wp.get('gravity')) > _max_abs_M(base.get('gravity')):
        merged['gravity'] = wp['gravity']
    # uplift: min(M)이 더 작은(더 음수인) 쪽
    base_uplift_min = min((m for m in (base['uplift'][1].get('M', []) if base.get('uplift') else [])), default=0)
    wp_uplift_min = min((m for m in (wp['uplift'][1].get('M', []) if wp.get('uplift') else [])), default=0)
    if wp_uplift_min < base_uplift_min:
        merged['uplift'] = wp['uplift']
    # overall: |M|max 절대 최대
    if _max_abs_M(wp.get('overall')) > _max_abs_M(base.get('overall')):
        merged['overall'] = wp['overall']
    # all_detail 병합
    merged['all_detail'] = base.get('all_detail', []) + [
        {**d, 'name': d['name'] + ' [Wp]'}
        for d in wp.get('all_detail', [])
    ]
    merged['all'] = base.get('all', []) + [
        (n + ' [Wp]', c) for n, c in wp.get('all', [])
    ]
    return merged


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

    n_pts = len(M)
    # 해석에서 전달된 실제 x좌표 사용 (부등경간 정확도 보장)
    x = combined.get('x', [])
    if not x or len(x) != n_pts:
        # fallback: 균등 간격 (등경간이면 정확, 부등경간이면 근사)
        total_L = sum(spans)
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
