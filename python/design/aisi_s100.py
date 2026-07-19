"""AISI S100-16 메인 설계 엔진

design_member()  — 압축/휨/조합/인장 부재 설계 계산
design_guide()   — AI용 설계 가이드 (워크플로우, 공식, 예제)
"""

import math

from design.dsm_strength import (
    compression_local, compression_distortional,
    flexure_local, flexure_distortional,
)
from design.global_buckling import (
    column_global_strength, beam_global_strength,
    compute_column_Fcre, compute_beam_Fcre,
)
from design.interaction import (
    combined_axial_bending, combined_bending_shear,
)
from design.shear import shear_strength, web_crippling
from design.connections import design_connection
from design.steel_grades import E, STEEL_GRADES

# 안전/저항 계수
PHI = {
    'compression': 0.85,
    'flexure': 0.90,
    'flexure_round_hss': 0.95,  # §F2.3 폐합 원형관 (round HSS) — φ_b=0.95
    'tension_yield': 0.90,
    'tension_rupture': 0.75,
    'shear': 0.95,
}
OMEGA = {
    'compression': 1.80,
    'flexure': 1.67,
    'flexure_round_hss': 1.67,  # §F2.3 폐합 원형관 (round HSS) — Ω_b=1.67
    'tension_yield': 1.67,
    'tension_rupture': 2.00,
    'shear': 1.60,
}


def _effective_section_type(params: dict) -> str:
    """우선순위: 명시 section_type → section.type → 기본 C"""
    section = params.get('section', {}) or {}
    return str(params.get('section_type') or section.get('type') or 'C')


def _normalized_section_type(params: dict) -> str:
    """AISI 분기용 단면명 정규화."""
    return _effective_section_type(params).strip().upper().replace('-', '').replace('_', '')


def _supports_cz_plate_fallback(params: dict) -> bool:
    """현재 구현된 Appendix 1/2 폐형식 fallback의 단면 범위."""
    return _normalized_section_type(params) in (
        'C', 'LIPPEDC', 'CHANNEL', 'TRACK', 'Z', 'LIPPEDZ',
    )


def _supports_cz_distortional_fallback(params: dict) -> bool:
    """Appendix 2 C/Z 플랜지-립 모델을 적용할 수 있는 단면인지 확인한다."""
    return _normalized_section_type(params) in ('C', 'LIPPEDC', 'Z', 'LIPPEDZ')


def _section_geometry(params: dict) -> dict:
    """UI ``section`` 또는 계산 ``props``에서 설계용 평탄폭 기하를 일관되게 복원한다.

    grosprop 결과에는 t/h/b/d가 없으므로 기존 UI 경로에서는 Table B4.1-1, G2,
    G5 검사가 건너뛰어졌다. props의 명시적 평탄폭을 우선하고, 없을 때만
    out-to-out 템플릿 치수에서 코너를 차감한다.
    """
    props = params.get('props', {}) or {}
    section = params.get('section', {}) or {}
    t = float(props.get('t', 0) or section.get('thickness', 0) or params.get('t', 0) or 0)
    R = float(
        props.get('R', 0) or props.get('r', 0)
        or section.get('R_corner', 0) or section.get('r', 0)
        or params.get('R', 0) or params.get('r', 0) or 0
    )
    depth = float(section.get('depth', 0) or params.get('H', 0) or 0)
    flange_o = float(section.get('flange_width', 0) or params.get('B', 0) or 0)
    lip_o = float(section.get('lip_depth', 0) or params.get('D', 0) or 0)
    corner = R + t if t > 0 else 0.0
    sec = _normalized_section_type(params)
    has_lip = lip_o > 0 or float(props.get('d_lip', 0) or 0) > 0
    is_angle = 'ANGLE' in sec

    h_web = float(props.get('h_web', 0) or section.get('h_web', 0) or 0)
    if h_web <= 0 and depth > 0:
        h_web = max(depth - 2.0 * corner, 0.0)

    b_flange = float(props.get('b_flange', 0) or section.get('b_flange', 0) or 0)
    if b_flange <= 0 and flange_o > 0:
        n_corners = 1 if is_angle or not has_lip else 2
        b_flange = max(flange_o - n_corners * corner, 0.0)

    d_lip = float(props.get('d_lip', 0) or section.get('d_lip', 0) or 0)
    if d_lip <= 0 and lip_o > 0:
        d_lip = max(lip_o - corner, 0.0)

    return {
        't': t, 'R': R,
        'h_web': h_web, 'b_flange': b_flange, 'd_lip': d_lip,
        'depth': depth, 'flange_o': flange_o, 'lip_o': lip_o,
        'lip_angle': float(section.get('lip_angle', 0) or section.get('qlip', 0)
                           or params.get('qlip', 0) or 90.0),
        'n_f': int(section.get('n_f', params.get('n_f', 0)) or 0),
        'n_le': int(section.get('n_le', params.get('n_le', 0)) or 0),
        'n_w': int(section.get('n_w', params.get('n_w', 0)) or 0),
    }


def _merge_governing_check(result: dict, check: dict, name: str,
                            normalized_ratio: float | None = None) -> None:
    """한계상태 결과를 최상위 pass/utilization에 병합한다."""
    if normalized_ratio is None:
        normalized_ratio = check.get('total')
    if normalized_ratio is not None and math.isfinite(float(normalized_ratio)):
        current = result.get('utilization')
        if current is None or float(normalized_ratio) > float(current):
            result['utilization'] = round(float(normalized_ratio), 4)
            result['governing_check'] = name
    passed = check.get('pass')
    if passed is False:
        result['pass'] = False
    elif passed is True and result.get('pass') is None:
        result['pass'] = True


def _infer_web_crippling_family(params: dict, section_type: str) -> str:
    """§G5 family inference for auto-mode UI/save paths."""
    section = params.get('section', {}) or {}
    explicit = params.get('wc_section_family')
    if explicit:
        return str(explicit)

    family_hint = section.get('family_hint')
    if family_hint:
        return str(family_hint)

    st = str(section_type or section.get('type') or 'C').strip().lower().replace('-', '_')
    if st in ('i', 'i_section', 'isect'):
        return 'built_up_i'
    if st.startswith('z'):
        return 'Z'
    if st.startswith('hat'):
        return 'hat'
    if st.startswith('track'):
        return 'C'

    web_count = section.get('web_count')
    try:
        if web_count is not None and int(float(web_count)) >= 3:
            return 'multi_web'
    except Exception:
        pass
    return 'C'


def _infer_web_crippling_n_webs(params: dict, section_family: str) -> int | None:
    """Infer n_webs only for families where total strength depends on it."""
    explicit = params.get('wc_n_webs')
    if explicit not in (None, ''):
        try:
            return int(float(explicit))
        except Exception:
            return None

    section = params.get('section', {}) or {}
    web_count = section.get('web_count')
    if section_family == 'hat':
        try:
            return max(2, int(float(web_count))) if web_count is not None else 2
        except Exception:
            return 2
    if section_family == 'multi_web':
        try:
            return max(2, int(float(web_count))) if web_count is not None else None
        except Exception:
            return None
    return None


def _estimate_cold_work_areas(section: dict, props: dict, R: float, t: float) -> dict:
    """냉간가공 코너면적비 추정 — AISI §A3.3.2 Eq. A3.3.2-1용.

    휨부재: C = 제어 플랜지의 코너면적 / 제어 플랜지 전체면적
    - 제어 플랜지 코너 수: C/Z = 2개 (웹-플랜지, 플랜지-립)
    - 제어 플랜지 면적: flat 플랜지 + flat 립 + 코너 arc (전체)
    """
    if R <= 0 or t <= 0:
        return {}

    sec_type = str(section.get('type') or 'C').upper()
    flange_width = float(section.get('flange_width') or props.get('b_flange') or 0)
    lip_depth = float(section.get('lip_depth') or props.get('d_lip') or 0)

    if flange_width <= 0:
        return {}

    arc_length = (math.pi / 2.0) * (R + t / 2.0)
    A_corner_each = arc_length * t

    # 제어 플랜지 (압축 플랜지) 기준 코너 수 및 면적
    if sec_type == 'HAT':
        # Hat: 상부 플랜지 기준 — 웹-플랜지 코너 2개
        n_corners_flange = 2
        flat_flange = max(flange_width - 2 * (R + t / 2.0), 0)
        A_flange = flat_flange * t + n_corners_flange * A_corner_each
    elif sec_type in ('TRACK',):
        # Track: 플랜지-웹 코너 1개 (립 없음)
        n_corners_flange = 1
        flat_flange = max(flange_width - (R + t / 2.0), 0)
        A_flange = flat_flange * t + n_corners_flange * A_corner_each
    else:
        # C/Z: 제어 플랜지 = 플랜지 flat + 립 flat + 2 코너(웹-플랜지, 플랜지-립)
        n_corners_flange = 2 if lip_depth > 0 else 1
        flat_flange = max(flange_width - (R + t / 2.0) * 2, 0) if lip_depth > 0 else max(flange_width - (R + t / 2.0), 0)
        flat_lip = max(lip_depth - (R + t / 2.0) / 2.0, 0) if lip_depth > 0 else 0
        A_flange = (flat_flange + flat_lip) * t + n_corners_flange * A_corner_each

    A_corners = n_corners_flange * A_corner_each

    if A_flange <= 0:
        return {}
    return {
        'n_corners': n_corners_flange,
        'A_corners': A_corners,
        'A_flange': A_flange,
    }


def design_member(params: dict) -> dict:
    """부재 설계 계산 메인 디스패처"""
    # design_method 정규화/검증: 인식 불가 값이 ASD로 위장(silent fallthrough)하는 것을 막는다.
    # Chapters E~H는 LRFD(φ)/ASD(Ω)와 LSD(φ, 캐나다)를 정의한다. 본 도구는 LRFD/ASD만 구현하며,
    # LSD는 미지원이므로 명시적으로 거부한다(자동 ASD 처리 금지).
    dm = params.get('design_method', 'LRFD')
    dm_norm = str(dm).strip().upper()
    if dm_norm not in ('LRFD', 'ASD'):
        if dm_norm == 'LSD':
            return {
                'error': 'LSD(Limit States Design, 캐나다) φ 계수(예: φc=0.80)는 미구현입니다. '
                         'LRFD 또는 ASD를 사용하세요.'
            }
        return {'error': f"Unrecognized design_method '{dm}'. Use 'LRFD' or 'ASD'."}
    params = {**params, 'design_method': dm_norm}

    # props가 없으면 단면 템플릿에서 자동 생성
    if not params.get('props') or not params['props'].get('A'):
        params = _auto_generate_props(params)

    member_type = params.get('member_type', 'compression')

    if member_type == 'compression':
        result = _design_compression(params)
    elif member_type == 'flexure':
        result = _design_flexure(params)
    elif member_type == 'combined':
        result = _design_combined(params)
    elif member_type == 'tension':
        result = _design_tension(params)
    elif member_type == 'connection':
        return design_connection(params)
    else:
        return {'error': f'Unknown member_type: {member_type}'}

    # DSM 적용 한계 검증 (접합부 제외)
    if 'error' not in result:
        dsm_warnings = check_dsm_limits(params, member_type=member_type)
        if dsm_warnings:
            result['dsm_warnings'] = dsm_warnings
            # §B3.3 / §B4.2: Table B4.1-1 한계를 벗어난 부재는 Chapters E~H의
            # φ/Ω를 자동으로 사용할 수 없다. A1.2(c) 합리적 해석 또는 K2 시험자료로
            # φ/Ω를 재정립해야 한다. 따라서 기본 φ/Ω로 산출된 강도/이용률을
            # '코드 적합(green pass)'으로 표시하지 않는다.
            result['b4_limits_exceeded'] = True
            result['utilization_valid'] = False
            result['pass'] = None  # 'OK' 표시 차단 — B4.2 절차 필요
            result.setdefault('warnings', [])
            result['warnings'].append(
                '§B3.3/§B4.2: 단면이 Table B4.1-1 적용한계를 벗어났습니다. '
                'Chapters E~H의 φ/Ω(예: φc=0.85/φb=0.90, Ωc=1.80/Ωb=1.67)는 잠정값이며, '
                'A1.2(c) 합리적 공학해석 또는 K2 시험자료(B4.2(b))로 φ/Ω를 재정립해야 합니다. '
                '내측굽힘 R/t>10만 초과한 경우 Table B4.1-1 각주(d)에 따라 합리적 해석(A1.2(c))이 허용됩니다.'
            )

    # 보고서 생성
    if 'error' not in result:
        result['report'] = generate_report(result, params)

    return result


# ============================================================
# DSM 적용 한계 검증 (Table B4.1-1)
# ============================================================

def check_dsm_limits(params: dict, member_type: str = None) -> list:
    """DSM 적용 한계 검증 (AISI S100-16 Table B4.1-1)

    member_type: 'compression' / 'flexure' / 'combined' / 'tension' — 웹 한계가
    응력 상태에 따라 달라지므로 전달한다. 휨/조합 부재의 웹은 응력 구배 하에 있어
    Table B4.1-1 '응력 구배 하의 보강 요소(웹)' 행의 DSM 한계 h/t ≤ 300이 적용된다.
    압축(균일 응력) 부재의 보강 요소는 w/t ≤ 500이다.

    참고: EWM 하위 한계(무보강 웹 <200, 보강 시 ≤260/≤300)는 본 도구가 DSM 기반이므로
    구현하지 않는다.

    Returns: list of warnings (빈 리스트면 모두 통과)
    """
    Fy = params.get('Fy', 35.53)
    geom = _section_geometry(params)
    t = geom['t']
    if member_type is None:
        member_type = params.get('member_type', 'compression')
    warnings = []

    if t <= 0:
        return warnings

    # 보강 요소 (웹): Table B4.1-1
    #  - 압축(균일 응력): w/t ≤ 500 'stiffened element in compression'
    #  - 휨/조합(응력 구배): h/t ≤ 300 'stiffened element in bending'
    #    (조합 부재 웹은 축력+휨을 동시에 받으므로 더 엄격한 300이 지배)
    h_web = geom['h_web']
    if h_web > 0:
        wt_web = h_web / t
        if member_type in ('flexure', 'combined'):
            if wt_web > 300:
                warnings.append(
                    f'Web h/t = {wt_web:.1f} > 300 '
                    '(Table B4.1-1 stiffened element in bending limit)'
                )
        else:
            if wt_web > 500:
                warnings.append(
                    f'Web w/t = {wt_web:.1f} > 500 '
                    '(Table B4.1-1 stiffened element in compression limit)'
                )

    # 연단보강 요소 (플랜지): b/t ≤ 160
    b_flange = geom['b_flange']
    if b_flange > 0:
        bt_fl = b_flange / t
        if bt_fl > 160:
            warnings.append(f'Flange b/t = {bt_fl:.1f} > 160 (Table B4.1-1 edge-stiffened limit)')

    # 비보강 요소 (립): d/t ≤ 60
    d_lip = geom['d_lip']
    if d_lip > 0:
        dt_lip = d_lip / t
        if dt_lip > 60:
            warnings.append(f'Lip d/t = {dt_lip:.1f} > 60 (Table B4.1-1 unstiffened limit)')

    # 코너 반경: R/t ≤ 20
    R = geom['R']
    if R > 0:
        Rt = R / t
        if Rt > 20:
            warnings.append(f'Corner R/t = {Rt:.1f} > 20 (Table B4.1-1 corner limit)')

    # 단순 연단보강재 길이/플랜지폭: do/bo ≤ 0.7
    lip_o = geom['lip_o'] or d_lip
    flange_o = geom['flange_o'] or b_flange
    if lip_o > 0 and flange_o > 0:
        do_bo = lip_o / flange_o
        if do_bo > 0.7:
            warnings.append(
                f'Simple edge stiffener d_o/b_o = {do_bo:.3f} > 0.7 '
                '(Table B4.1-1 simple edge stiffener limit)'
            )

    # 중간/연단 보강재 개수
    if geom['n_f'] > 4:
        warnings.append(f'n_f = {geom["n_f"]} > 4 (Table B4.1-1 flange intermediate stiffener limit)')
    if geom['n_le'] > 2:
        warnings.append(f'n_le = {geom["n_le"]} > 2 (Table B4.1-1 edge stiffener count limit)')
    if geom['n_w'] > 4:
        warnings.append(f'n_w = {geom["n_w"]} > 4 (Table B4.1-1 web intermediate stiffener limit)')

    # 항복강도: Fy < 95 ksi (표의 부등호는 strict)
    if Fy >= 95:
        warnings.append(f'Fy = {Fy} ksi is not < 95 ksi (Table B4.1-1 Fy limit)')

    return warnings


# ============================================================
# 압축 부재 설계
# ============================================================

def _design_compression(params: dict) -> dict:
    """DSM 압축 부재 설계 (§E2, §E3.2, §E4)"""
    Fy = params.get('Fy', 35.53)
    design_method = params.get('design_method', 'LRFD')
    Pu = params.get('Pu', 0)

    # 단면 성질 (외부에서 전달)
    props = params.get('props', {})
    Ag = props.get('A', 0)
    if Ag <= 0:
        return {'error': 'Section properties not available (A=0)'}

    # §E2 분기 판정용 section_type 주입: compute_column_Fcre는 props['section_type']로
    # 점대칭(Z, §E2.3)/폐합(§E2.1)을 분류한다. 디스패처가 이를 채워야 §E2.3이 발동한다.
    # (이미 명시된 경우엔 보존; lippedC는 'C'로 분류되어 기존 휨-비틀림 경로 불변.)
    props = dict(props)
    props.setdefault('section_type', _effective_section_type(params))

    # DSM 값 (외부에서 전달 — get_dsm_values 결과)
    dsm = params.get('dsm', {})
    Pcrl = dsm.get('Pcrl', 0)
    Pcrd = dsm.get('Pcrd', 0)
    Py_dsm = dsm.get('Py', 0)
    _modal_method = str(dsm.get('P_classification_method', dsm.get('classification_method', '')))
    _local_detected = dsm.get('P_local_detected', dsm.get('local_detected'))
    _dist_detected = dsm.get('P_dist_detected', dsm.get('dist_detected'))
    local_absence_verified = _modal_method.startswith('cfsm_modal') and _local_detected is False
    dist_absence_verified = _modal_method.startswith('cfsm_modal') and _dist_detected is False

    # 유효좌굴길이
    KxLx = params.get('KxLx', 120)
    KyLy = params.get('KyLy', 120)
    KtLt = params.get('KtLt', 120)

    steps = []
    spec_sections = []
    warnings = []

    # 유효좌굴길이가 전달되지 않으면 기본 120 in이 강도를 결정하므로 경고를 남긴다.
    # (실제 지정값과 무관하게 부재가 존재할 수 있으므로 멤버십으로 부재 여부만 판단)
    if not any(k in params for k in ('KxLx', 'KyLy', 'KtLt')):
        warnings.append(
            'Effective length defaulted to KxLx=KyLy=KtLt=120 in — '
            'verify against actual unbraced/braced lengths'
        )

    if Pcrl == 0 and Pcrd == 0:
        warnings.append(
            'Pcrl=0, Pcrd=0: 좌굴 해석 결과가 없어 좌굴 감소가 적용되지 않습니다. '
            'FSM 해석을 먼저 실행하세요 (run_analysis → get_dsm_values).'
        )

    # Step 1: Py — DSM에서 전달된 Py 우선 사용 (yieldMP 기반)
    # Pcrl = LF × Py_dsm 이므로, Py도 동일한 Py_dsm을 사용해야 λ가 일관됨
    Py = Py_dsm if Py_dsm > 0 else Ag * Fy
    Ag_eff = Py / Fy if Fy > 0 else Ag
    steps.append({
        'step': 1, 'name': 'Yield Load (Py)',
        'value': round(Py, 2), 'unit': 'kips',
        'formula': f'Py = {"DSM" if Py_dsm > 0 else "Ag×Fy"} = {Py:.2f} kips (Ag={Ag_eff:.4f} in²)',
    })

    # Step 2: 전체좌굴 (E2)
    Fcre_override = float(params.get('Fcre', 0) or 0)
    if Fcre_override > 0:
        Fcre_result = {
            'Fcre': Fcre_override,
            'buckling_type': 'user/rational analysis',
            'equation': 'User-supplied elastic buckling stress',
        }
    else:
        Fcre_result = compute_column_Fcre(props, Fy, KxLx, KyLy, KtLt)
    Fcre = Fcre_result['Fcre']
    global_result = column_global_strength(Fy, Fcre, Ag_eff)
    Pne = global_result['Pne']
    spec_sections.append('E2')

    # §E2: Fcre를 계산할 수 없으면(rx/ry/ro/J/Cw 누락 시 compute_column_Fcre가 0 반환)
    # Pne=0 → Pn=0이 되어 강도가 0으로 잠긴다. 이를 유효한 설계(0강도 통과)로 오인하지
    # 않도록 명시적 경고를 남긴다. 근본 원인은 보통 cutwp 실패로 J/Cw가 0이 된 경우다.
    if Fcre <= 0 or Pne <= 0:
        _cutwp_note = ' (cutwp 해석 실패로 J/Cw=0이 되었습니다)' if props.get('cutwp_failed') else ''
        if Fcre_result.get('unsupported'):
            warnings.append(f'§E2.4: {Fcre_result.get("error", "rational analysis is required")}.')
        else:
            warnings.append(
                '§E2: 전체 탄성좌굴응력 Fcre를 계산할 수 없습니다(Fcre=0 → Pne=0 → Pn=0). '
                f'비틀림 성질 J/Cw 또는 rx/ry/ro/xo가 누락되었을 가능성이 큽니다{_cutwp_note}. '
                '0 강도를 유효한 설계로 해석하지 마십시오.'
            )

    steps.append({
        'step': 2, 'name': 'Global Buckling (Pne)',
        'value': round(Pne, 2), 'unit': 'kips',
        'formula': f'Fcre = {Fcre:.2f} ksi, λc = {global_result["lambda_c"]:.3f}, '
                   f'Fn = {global_result["Fn"]:.2f} ksi → Pne = {Pne:.2f} kips',
        'equation': global_result['equation'],
        'buckling_type': Fcre_result.get('buckling_type', ''),
    })

    # Step 3: 국부좌굴 (E3.2)
    # Pcrl=0 fallback: signature curve에서 국부좌굴 극소 미검출 시
    # Appendix 1 §1.1 Eq. 1.1-4 판좌굴 공식으로 Fcrl 산정 (Pcrl_local = Fcrl × Ag_eff)
    Pcrl_source = 'FSM'
    if (Pcrl == 0 and Ag_eff > 0 and not local_absence_verified
            and _supports_cz_plate_fallback(params)):
        geom = _section_geometry(params)
        ho, bo, do = geom['h_web'], geom['b_flange'], geom['d_lip']
        t, R_loc = geom['t'], geom['R']
        sec_type = _effective_section_type(params)
        if ho > 0 and bo > 0 and t > 0:
            try:
                from design.loads.local_params import calc_Fcrl
                fcrl_result = calc_Fcrl(ho, bo, do, t, R=R_loc, section_type=sec_type)
                Fcrl_calc = fcrl_result['Fcrl']
                if Fcrl_calc > 0:
                    Pcrl = Fcrl_calc * Ag_eff
                    Pcrl_source = '§App.1 Eq.1.1-4'
                    warnings.append(
                        f'Pcrl: signature curve에서 국부좌굴 극소 미검출 → '
                        f'Appendix 1 §1.1 Eq.1.1-4 해석적 판좌굴 공식 사용 '
                        f'(Fcrl={Fcrl_calc:.2f} ksi, 지배요소={fcrl_result["governing"]})'
                    )
            except Exception:
                pass

    if Pcrl > 0:
        local_result = compression_local(Pne, Pcrl)
        Pnl = local_result['Pnl']
        spec_sections.append('E3.2')
    else:
        Pnl = Pne
        local_result = {'lambda_l': 0, 'equation': 'N/A (no Pcrl)'}

    steps.append({
        'step': 3, 'name': 'Local Buckling (Pnl)',
        'value': round(Pnl, 2), 'unit': 'kips',
        'formula': (
            f'Pcrl = {Pcrl:.2f} kips ({Pcrl_source}), '
            f'λl = √(Pne/Pcrl) = √({Pne:.2f} kips/{Pcrl:.2f} kips) = {local_result["lambda_l"]:.3f} '
            f'{"≤" if local_result["lambda_l"] <= 0.776 else ">"} 0.776 → '
            f'Pnl = {Pnl:.2f} kips'
        ) if Pcrl > 0 else f'Pcrl = 0 → Pnl = Pne = {Pnl:.2f} kips',
        'equation': local_result['equation'],
    })

    # Step 4: 왜곡좌굴 (E4)
    # Pcrd=0 fallback: signature curve에서 뒤틀림 극소 미검출 시
    # AISI Appendix 2, §2.3.1.3 해석적 공식으로 Fcrd 계산
    Pcrd_source = 'FSM'
    distortional_not_evaluated = False
    if (Pcrd == 0 and Ag > 0 and not dist_absence_verified
            and _supports_cz_distortional_fallback(params)):
        geom = _section_geometry(params)
        ho, bo, do = geom['h_web'], geom['b_flange'], geom['d_lip']
        t, lip_angle = geom['t'], geom['lip_angle']
        sec_type = 'Z' if _normalized_section_type(params) in ('Z', 'LIPPEDZ') else 'C'
        if ho > 0 and bo > 0 and t > 0 and do > 0:
            try:
                from design.loads.distortional_params import (
                    calc_flange_properties, calc_Fcrd
                )
                b_cl = bo - t
                d_cl = do - t / 2.0
                fp = calc_flange_properties(b_cl, d_cl, t, lip_angle, sec_type)
                fcrd_result = calc_Fcrd(fp, ho, t, xi_web=0)  # compression
                Fcrd_calc = fcrd_result['Fcrd']
                Lcrd_val = fcrd_result.get('Lcrd', '')
                if Fcrd_calc > 0:
                    Pcrd = Fcrd_calc * Ag_eff
                    Pcrd_source = '§2.3.1.3'
                    warnings.append(
                        f'Pcrd: signature curve에서 뒤틀림 극소 미검출 → '
                        f'Appendix 2 §2.3.1.3 해석적 공식 사용 '
                        f'(Fcrd={Fcrd_calc:.2f} ksi, Lcrd={Lcrd_val} in)'
                    )
            except Exception as e:
                # 해석적 fallback이 시도되었으나 실패 — 삼키지 않고 표면화한다.
                # 왜곡좌굴(E4)이 실제 지배할 경우 Pn=min(Pne,Pnl,Py)가 과대평가될 수 있다.
                distortional_not_evaluated = True
                warnings.append(
                    f'Pcrd 해석적 fallback(Appendix 2 §2.3.1.3) 실패: {e} — '
                    '왜곡좌굴(E4)이 평가되지 않았습니다. Pn에 왜곡좌굴 한계상태가 누락되었으므로 '
                    '유효한 공칭강도로 단정하지 마십시오.'
                )
    elif (Pcrd == 0 and Ag > 0 and not dist_absence_verified
          and not _supports_cz_distortional_fallback(params)):
        distortional_not_evaluated = True
        warnings.append(
            f"Pcrd=0이며 단면 '{_effective_section_type(params)}'은 구현된 Appendix 2 C/Z "
            '폐형식 fallback 범위 밖입니다. cFSM/유한요소 또는 합리적 해석으로 E4를 평가하세요.'
        )

    if Pcrd > 0:
        dist_result = compression_distortional(Py, Pcrd)
        Pnd = dist_result['Pnd']
        spec_sections.append('E4')
    else:
        Pnd = Py
        dist_result = {'lambda_d': 0, 'equation': 'N/A (no Pcrd)'}

    steps.append({
        'step': 4, 'name': 'Distortional Buckling (Pnd)',
        'value': round(Pnd, 2), 'unit': 'kips',
        'formula': (
            f'Pcrd = {Pcrd:.2f} kips ({Pcrd_source}), '
            f'λd = √(Py/Pcrd) = √({Py:.2f} kips/{Pcrd:.2f} kips) = {dist_result["lambda_d"]:.3f} '
            f'{"≤" if dist_result["lambda_d"] <= 0.561 else ">"} 0.561 → '
            f'Pnd = {Pnd:.2f} kips'
        ) if Pcrd > 0 else f'Pcrd = 0 → Pnd = Py = {Pnd:.2f} kips',
        'equation': dist_result['equation'],
    })

    # Step 5: 공칭강도
    # 지배 모드는 실제로 좌굴이 강도를 감소시킨 경우에만 국부/왜곡으로 표시한다.
    # Pcrl=0이면 Pnl=Pne(직접 대입), Pcrd=0이면 Pnd=Py이므로, 전체좌굴이 지배할 때
    # bare float equality(Pn==Pnl)만으로는 국부좌굴로 오표시된다(휨 경로 line 736 방식과 일치).
    Pn = min(Pne, Pnl, Pnd)
    if Pn == Pnl and Pnl < Pne:
        mode = 'Local Buckling'
    elif Pn == Pnd and Pnd < Pne:
        mode = 'Distortional Buckling'
    else:
        mode = f'Global Buckling ({Fcre_result.get("buckling_type", "")})'

    phi = PHI['compression']
    omega = OMEGA['compression']
    phi_Pn = phi * Pn
    Pn_omega = Pn / omega

    steps.append({
        'step': 5, 'name': 'Nominal Strength (Pn)',
        'value': round(Pn, 2), 'unit': 'kips',
        'formula': f'Pn = min(Pne={Pne:.2f} kips, Pnl={Pnl:.2f} kips, Pnd={Pnd:.2f} kips) = {Pn:.2f} kips',
        'controlling_mode': mode,
    })

    # Step 6: 설계강도
    utilization = 0
    if design_method == 'LRFD':
        design_strength = phi_Pn
        if Pu > 0 and phi_Pn > 0:
            utilization = Pu / phi_Pn
        elif Pu > 0:
            utilization = float('inf')
        steps.append({
            'step': 6, 'name': 'Design Strength (LRFD)',
            'value': round(phi_Pn, 2), 'unit': 'kips',
            'formula': f'φPn = {phi} × {Pn:.2f} kips = {phi_Pn:.2f} kips',
        })
    else:
        design_strength = Pn_omega
        if Pu > 0 and Pn_omega > 0:
            utilization = Pu / Pn_omega
        elif Pu > 0:
            utilization = float('inf')
        steps.append({
            'step': 6, 'name': 'Allowable Strength (ASD)',
            'value': round(Pn_omega, 2), 'unit': 'kips',
            'formula': f'Pn/Ω = {Pn:.2f} kips/{omega} = {Pn_omega:.2f} kips',
        })

    # 0 공칭강도는 어떤 경우에도 유효한 설계가 아니다 → Pu 유무와 무관하게 pass=False.
    if Pn <= 0:
        pass_flag = False
    elif Pu > 0:
        pass_flag = utilization <= 1.0
    else:
        pass_flag = None

    result = {
        'member_type': 'compression',
        'method': 'DSM',
        'design_method': design_method,
        'Pn': round(Pn, 2),
        'Pne': round(Pne, 2),
        'Pnl': round(Pnl, 2),
        'Pnd': round(Pnd, 2),
        'Py': round(Py, 2),
        'controlling_mode': mode,
        'phi_Pn': round(phi_Pn, 2),
        'Pn_omega': round(Pn_omega, 2),
        'design_strength': round(design_strength, 2),
        'utilization': round(utilization, 4) if Pu > 0 else None,
        'pass': pass_flag,
        'distortional_not_evaluated': distortional_not_evaluated,
        'steps': steps,
        'spec_sections': list(set(spec_sections)),
        'warnings': warnings,
    }
    if distortional_not_evaluated:
        result['pass'] = None
        result['utilization_valid'] = False
    return result


# ============================================================
# 휨 부재 설계
# ============================================================

def _design_flexure(params: dict) -> dict:
    """DSM 휨 부재 설계 (§F2, §F3.2, §F4)"""
    Fy = params.get('Fy', 35.53)
    Fu = params.get('Fu', 58.02)
    design_method = params.get('design_method', 'LRFD')
    Mu = abs(params.get('Mu', 0))
    Lb = params.get('Lb', 120)
    Cb = params.get('Cb', 1.0)

    props = params.get('props', {})
    Sf = props.get('Sf', 0) or props.get('Sxx', 0) or props.get('Sx', 0)
    if Sf <= 0:
        return {'error': 'Section modulus not available (Sf=0)'}
    Fy_original = Fy
    cold_work_info = None
    dsm = params.get('dsm', {})
    Mcrl = dsm.get('Mcrl', 0)
    Mcrd = dsm.get('Mcrd', 0)
    My_dsm = dsm.get('My', 0)
    _modal_method = str(dsm.get('M_classification_method', dsm.get('classification_method', '')))
    _local_detected = dsm.get('M_local_detected', dsm.get('local_detected'))
    _dist_detected = dsm.get('M_dist_detected', dsm.get('dist_detected'))
    local_absence_verified = _modal_method.startswith('cfsm_modal') and _local_detected is False
    dist_excluded = bool(params.get('distortional_not_applicable', False))
    dist_absence_verified = (
        dist_excluded
        or (_modal_method.startswith('cfsm_modal') and _dist_detected is False)
    )
    warnings = []
    if dist_excluded:
        warnings.append(
            'F4 distortional buckling was explicitly excluded by the supplied assembly/member '
            'assumption; Mnd=My is used.'
        )
    steps = []
    spec_sections = []
    section_type = _effective_section_type(params)
    Zf = props.get('Zx', 0) or props.get('Zf', 0)
    use_ir = params.get('use_inelastic_reserve', False)
    Fcre_override = float(params.get('Fcre', 0) or 0)

    # §F2.3 round-HSS 분기용 D/t 산정 (원형관 'chs'일 때만; 그 외 None).
    # 외경 D는 section.diameter 또는 params['D'](템플릿 CHS의 외경)이며 두께 t로 나눈다.
    # §F2.1.4 closed-box('rhs')는 compute_beam_Fcre가 props['Izz']를 약축 Iy로 사용하므로
    # 추가 키 주입이 불필요하다(grosprop이 Izz를 제공). D_over_t는 round-HSS 전용.
    _sec_norm = str(section_type or '').strip().lower().replace('-', '').replace('_', '')
    _is_round = _sec_norm in ('chs', 'round', 'pipe', 'cylindrical') or _sec_norm.startswith('chs')
    D_over_t = None
    if _is_round:
        _section = params.get('section', {}) or {}
        _t = props.get('t', 0) or _section.get('thickness', 0) or params.get('t', 0)
        # 외경 우선순위: 명시 diameter → CHS 템플릿 외경 params['D'] → section.depth/H fallback.
        # CHS는 params['D']가 외경이므로 section.depth(=H)보다 우선한다.
        _D = (_section.get('diameter', 0) or params.get('D', 0)
              or _section.get('depth', 0) or params.get('H', 0))
        if _D > 0 and _t > 0:
            D_over_t = _D / _t

    # Lb 미지정 시 기본 120 in이 LTB 강도를 결정하므로 경고를 남긴다.
    if 'Lb' not in params:
        warnings.append('Lb defaulted to 120 in — verify lateral unbraced length')

    if Mcrl == 0 and Mcrd == 0:
        warnings.append(
            'Mcrl=0, Mcrd=0: 좌굴 해석 결과가 없어 좌굴 감소가 적용되지 않습니다. '
            'FSM 해석을 먼저 실행하세요 (run_analysis → get_dsm_values).'
        )

    # [문제4] β 보정계수 파라미터 (§Appendix 2 §2.3.3.3 Eq. 2.3.3.3-3)
    dist_M1_M2 = params.get('dist_M1_M2', None)  # M1/M2 비율 (양: 역곡률, 음: 단일곡률)
    dist_Lm = params.get('dist_Lm', 0)            # 뒤틀림 구속점 간격 (in)
    dist_Lcrd = dsm.get('Lcrd', 0)                # 뒤틀림좌굴 반파장 (in, DSM 추출)

    def _calc_flexure_state(Fy_eval: float, allow_ir: bool) -> dict:
        scale = Fy_eval / Fy_original if Fy_original > 0 else 1.0
        My = (My_dsm * scale) if My_dsm > 0 else (Sf * Fy_eval)
        Sf_eff = My / Fy_eval if Fy_eval > 0 else Sf
        # §F2.1.4 closed-box는 Lb<=Lu 판정에 Fy가 필요하므로 Fy_eval을 전달한다.
        if Fcre_override > 0:
            Fcre = Fcre_override
            fcre_detail_state = {
                'Fcre': Fcre,
                'equation': 'User-supplied elastic buckling stress',
                'user_supplied': True,
            }
        else:
            Fcre = compute_beam_Fcre(props, Cb, Lb, section_type=section_type, Fy=Fy_eval)
            fcre_detail_state = dict(getattr(compute_beam_Fcre, '_last_detail', {}) or {})
        # §F2.3 round-HSS는 section_type/D_over_t/E를 받아 직접 Mne 곡선을 산정한다.
        global_result = beam_global_strength(
            Fy_eval, Fcre, Sf_eff, Zf=Zf, use_inelastic_reserve=allow_ir,
            section_type=section_type, D_over_t=D_over_t, E=E)
        Mne = global_result['Mne']

        # §F3.2.1/§F4: Mcrl, Mcrd are ELASTIC critical buckling moments (Appendix 2),
        # functions of E and gross geometry only — independent of Fy/Fya. They must NOT
        # be scaled by Fya in the cold-work path; only My and Mne respond to the elevated
        # yield. Scaling them would mask the increase in local/distortional slenderness
        # (λl=√(Mne/Mcrl), λd=√(My/Mcrd)) and overpredict Mnl/Mnd (unconservative).
        Mcrl_eff = Mcrl if Mcrl > 0 else 0
        Mcrl_source = 'FSM'

        # Mcrl=0 fallback: signature curve에서 국부좌굴 극소 미검출 시
        # Appendix 1 §1.1 Eq. 1.1-4 판좌굴 공식으로 Fcrl 산정 (Mcrl_local = Fcrl × Sf)
        if (Mcrl_eff == 0 and Sf_eff > 0 and not local_absence_verified
                and _supports_cz_plate_fallback(params)):
            geom = _section_geometry(params)
            ho, bo, do = geom['h_web'], geom['b_flange'], geom['d_lip']
            t, R_loc = geom['t'], geom['R']
            sec_type = _effective_section_type(params)
            if ho > 0 and bo > 0 and t > 0:
                try:
                    from design.loads.local_params import calc_Fcrl
                    fcrl_result = calc_Fcrl(ho, bo, do, t, R=R_loc, section_type=sec_type)
                    Fcrl_calc = fcrl_result['Fcrl']
                    if Fcrl_calc > 0:
                        Mcrl_eff = Fcrl_calc * Sf_eff
                        Mcrl_source = '§App.1 Eq.1.1-4'
                except Exception:
                    pass

        # §F2.4.2-3: 부재 소성모멘트 Mp = Zf×Fy (탄성 임계값과 달리 Fy/Fya에 비례)
        Mp = Zf * Fy_eval if Zf > 0 else 0.0

        # §F3.1.1: 원형관(round HSS)으로 D/t ≤ 0.441 E/Fy 이면 국부좌굴(Mnl)을 검토하지
        # 않는다(local buckling need not be checked). 원형관 국부좌굴은 이미 §F2.3 Mne
        # 곡선에 반영되어 있으므로 Mnl 감소를 건너뛰고 Mnl=Mne로 둔다.
        _skip_round_local = (
            _is_round and D_over_t is not None and D_over_t > 0
            and Fy_eval > 0 and D_over_t <= 0.441 * E / Fy_eval
        )

        if _skip_round_local:
            local_result = {'lambda_l': 0,
                            'equation': 'F3.1.1 (round HSS, local buckling not checked)'}
            Mnl = Mne
        elif Mcrl_eff > 0:
            local_result = flexure_local(Mne, Mcrl_eff)
            Mnl = local_result['Mnl']
            # §F3.2.3 국부 비탄성 예비강도: λl=√(My/Mcrl)≤0.776 이고 Mne≥My 일 때.
            # 주의: §F3.2.3-3의 λl은 √(My/Mcrl)이며 §F3.2.1-3의 √(Mne/Mcrl)과 다르다.
            if allow_ir and Mp > Mne and My > 0 and Mne >= My:
                lam_l_ir = math.sqrt(My / Mcrl_eff)
                if lam_l_ir <= 0.776:
                    Cyl = min(math.sqrt(0.776 / lam_l_ir), 3.0) if lam_l_ir > 0 else 3.0
                    Mnl_ir = My + (1 - 1 / Cyl ** 2) * (Mp - My)  # Eq. F3.2.3-1
                    # F3.2.3은 소성 기반으로 Mnl을 끌어올린다(비탄성 예비). non-IR 값보다 클 때만 채택.
                    if Mnl_ir > Mnl:
                        Mnl = Mnl_ir
                        local_result = {
                            'lambda_l': lam_l_ir,
                            'equation': 'F3.2.3-1 (local inelastic reserve)',
                            'Cyl': Cyl,
                        }
        else:
            local_result = {'lambda_l': 0, 'equation': 'N/A'}
            Mnl = Mne

        Mcrd_eff = Mcrd if Mcrd > 0 else 0
        Mcrd_source = 'FSM'
        mcrd_fallback_failed = False

        # §2.3.3.3 해석적 Fcrd fallback
        # round HSS(폐합 원형관)는 왜곡좌굴(§F4) 한계상태가 없으므로 해석적 fallback을
        # 건너뛴다 — 그렇지 않으면 CHS에 기본 H/B로 산정된 허위 Mcrd가 §F2.3 Mne를 깎는다.
        if (Mcrd_eff == 0 and Sf > 0 and not _skip_round_local
                and not dist_absence_verified
                and _supports_cz_distortional_fallback(params)):
            geom = _section_geometry(params)
            ho, bo, do = geom['h_web'], geom['b_flange'], geom['d_lip']
            t, lip_angle = geom['t'], geom['lip_angle']
            sec_type = 'Z' if _normalized_section_type(params) in ('Z', 'LIPPEDZ') else 'C'
            kphi_ext = params.get('kphi', 0)
            if ho > 0 and bo > 0 and t > 0 and do > 0:
                try:
                    from design.loads.distortional_params import calc_flange_properties, calc_Fcrd
                    b_cl = bo - t
                    d_cl = do - t / 2.0
                    fp = calc_flange_properties(b_cl, d_cl, t, lip_angle, sec_type)
                    fcrd_result = calc_Fcrd(
                        fp, ho, t,
                        kphi_external=kphi_ext,
                        beta=1.0,
                        xi_web=2,
                    )
                    Fcrd_calc = fcrd_result['Fcrd']
                    if Fcrd_calc > 0:
                        Mcrd_eff = Fcrd_calc * Sf_eff
                        Mcrd_source = '§2.3.3.3'
                except Exception as e:
                    # 해석적 fallback이 시도되었으나 실패 — 삼키지 않고 표면화한다.
                    # 왜곡좌굴(F4)이 실제 지배하면 Mn=min(Mne,Mnl,My)가 과대평가될 수 있다.
                    mcrd_fallback_failed = True
                    warnings.append(
                        f'Mcrd 해석적 fallback(Appendix 2 §2.3.3.3) 실패: {e} — '
                        '왜곡좌굴(F4)이 평가되지 않았습니다. Mn에 왜곡좌굴 한계상태가 누락되었으므로 '
                        '유효한 공칭강도로 단정하지 마십시오.'
                    )
        elif (Mcrd_eff == 0 and Sf > 0 and not _skip_round_local
              and not dist_absence_verified
              and not _supports_cz_distortional_fallback(params)):
            mcrd_fallback_failed = True
            warnings.append(
                f"Mcrd=0이며 단면 '{section_type}'은 구현된 Appendix 2 C/Z 폐형식 "
                'fallback 범위 밖입니다. cFSM/유한요소 또는 합리적 해석으로 F4를 평가하세요.'
            )

        # 정모멘트 구간 등 다른 곡률을 위한 β 미적용 기준 Mcrd 보존 (positive-region용)
        Mcrd_base = Mcrd_eff

        # [문제4] §2.3.3.3 Eq. 2.3.3.3-3: β 모멘트 구배 보정
        beta_dist = 1.0
        beta_note = ''
        if Mcrd_eff > 0 and dist_M1_M2 is not None and dist_Lm > 0:
            # math는 모듈 최상단에서 import됨 (함수 내 재-import 시 math가 지역변수로
            # 묶여 IR 분기의 선행 math.sqrt 호출이 UnboundLocalError를 일으킨다 — 제거).
            Lcrd_val = dist_Lcrd if dist_Lcrd > 0 else dist_Lm
            L_beta = min(Lcrd_val, dist_Lm)
            ratio_L = L_beta / dist_Lm if dist_Lm > 0 else 1.0
            ratio_M = 1 + dist_M1_M2
            if ratio_M > 0:
                beta_raw = 1.0 + 0.4 * (ratio_L ** 0.7) * (ratio_M ** 0.7)
            else:
                beta_raw = 1.0
            beta_dist = max(1.0, min(beta_raw, 1.3))
            if beta_dist > 1.0:
                Mcrd_eff *= beta_dist
                beta_note = f' [β={beta_dist:.3f}, §2.3.3.3 Eq.3]'
                Mcrd_source += beta_note

        if Mcrd_eff > 0:
            dist_result = flexure_distortional(My, Mcrd_eff)
            Mnd = dist_result['Mnd']
            # §F4.3 왜곡 비탄성 예비강도: λd=√(My/Mcrd)≤0.673 일 때.
            if allow_ir and Mp > My and My > 0:
                lam_d_ir = math.sqrt(My / Mcrd_eff)
                if lam_d_ir <= 0.673:
                    Cyd = min(math.sqrt(0.673 / lam_d_ir), 3.0) if lam_d_ir > 0 else 3.0
                    Mnd_ir = My + (1 - 1 / Cyd ** 2) * (Mp - My)  # Eq. F4.3-1
                    if Mnd_ir > Mnd:
                        Mnd = Mnd_ir
                        dist_result = {
                            'lambda_d': lam_d_ir,
                            'equation': 'F4.3-1 (distortional inelastic reserve)',
                            'Cyd': Cyd,
                        }
        elif _skip_round_local:
            # round HSS: 왜곡좌굴(§F4) 미적용. §F2.3 Mne가 1.25Fy까지 허용되므로
            # Mnd를 My로 캡하지 않고 Mne로 둔다 → Mn=min(Mne,Mnl,Mnd)=Mne.
            dist_result = {'lambda_d': 0, 'equation': 'N/A (round HSS, §F4 not applicable)'}
            Mnd = Mne
        else:
            dist_result = {'lambda_d': 0, 'equation': 'N/A'}
            Mnd = My

        # Mnfo: Mne=My 가정의 국부좌굴 강도(§I6.2.1, Fn=Fy → Mne=My).
        # IR 활성 시 §F3.2.3 소성값(λl=√(My/Mcrl)≤0.776)으로 끌어올리되 소성 상한을 초과하지 않게 한다.
        if Mcrl_eff > 0:
            Mnfo = flexure_local(My, Mcrl_eff)['Mnl']
            if allow_ir and Mp > My and My > 0:
                lam_l_fo = math.sqrt(My / Mcrl_eff)
                if lam_l_fo <= 0.776:
                    Cyl_fo = min(math.sqrt(0.776 / lam_l_fo), 3.0) if lam_l_fo > 0 else 3.0
                    Mnfo_ir = My + (1 - 1 / Cyl_fo ** 2) * (Mp - My)  # Eq. F3.2.3-1
                    Mnfo = max(Mnfo, Mnfo_ir)
        else:
            Mnfo = My
        return {
            'Fy': Fy_eval,
            'My': My,
            'Sf_eff': Sf_eff,
            'Fcre': Fcre,
            'Fcre_detail': fcre_detail_state,
            'global_result': global_result,
            'Mne': Mne,
            'Mcrl': Mcrl_eff,
            'Mcrl_source': Mcrl_source,
            'local_result': local_result,
            'Mnl': Mnl,
            'Mcrd': Mcrd_eff,
            'Mcrd_base': Mcrd_base,
            'Mcrd_source': Mcrd_source,
            'beta_dist': beta_dist,
            'dist_result': dist_result,
            'Mnd': Mnd,
            'Mnfo': Mnfo,
            'Mp': Mp,
            'mcrd_fallback_failed': mcrd_fallback_failed,
        }

    state = _calc_flexure_state(Fy_original, use_ir)
    if params.get('use_cold_work', False):
        from design.special_topics import cold_work_strength
        R = props.get('R', 0) or params.get('R', 0) or params.get('r', 0)
        t = props.get('t', 0) or params.get('t', 0)
        if R > 0 and t > 0:
            cw_area_kwargs = _estimate_cold_work_areas(params.get('section', {}) or {}, props, R, t)
            cold_work_info = cold_work_strength(
                Fyv=Fy_original, Fuv=Fu, R=R, t=t, **cw_area_kwargs
            )
            # §A3.3.2 적용한계: 냉간가공 증가는 "Fy 응력 수준에서 국부/왜곡좌굴에 의한
            # 강도 감소를 받지 않는 단면"에만 허용된다 — 보 부재의 경우 Mnl=Mne(국부 비지배)
            # AND Mnd=My(왜곡 비지배). 둘 중 하나라도 강도를 줄이면 Fya를 적용해서는 안 된다.
            # virgin-Fy 상태(이미 계산된 state)에서 부동소수 허용오차로 판정한다.
            _ir_tol = 1e-6
            _cw_applicable_geom = (
                abs(state['Mnl'] - state['Mne']) <= _ir_tol * max(state['Mne'], 1.0)
                and abs(state['Mnd'] - state['My']) <= _ir_tol * max(state['My'], 1.0)
            )
            if use_ir:
                warnings.append('§A3.3.2: Cold Work(Fya)와 §F2.4.2 Inelastic Reserve는 동시 적용 불가. Cold Work를 적용하지 않았습니다.')
            elif not _cw_applicable_geom:
                # 국부 또는 왜곡좌굴이 강도를 감소시키는 단면 → §A3.3.2 적용 불가.
                warnings.append(
                    '§A3.3.2: Fy 응력 수준에서 국부 또는 왜곡좌굴이 강도를 감소시키므로 '
                    '(Mnl≠Mne 또는 Mnd≠My) 냉간가공 강도증가를 적용할 수 없습니다. Virgin Fy를 사용합니다.'
                )
            elif cold_work_info['applicable'] and cold_work_info['Fya'] > Fy_original:
                # §A3.3.2: Fya를 Fy 대신 대입하여 재계산.
                # 위 _cw_applicable_geom 게이트가 "국부/왜곡좌굴 비지배(Mnl=Mne, Mnd=My)" 조건을
                # virgin-Fy 상태에서 명시적으로 확인했다. 아래 Mn_cw ≤ Mn_virgin 가드는 2차 안전장치다.
                Mn_virgin = min(state['Mne'], state['Mnl'], state['Mnd'])
                Fy = cold_work_info['Fya']
                state = _calc_flexure_state(Fy, False)
                Mn_cw = min(state['Mne'], state['Mnl'], state['Mnd'])
                if Mn_cw <= Mn_virgin:
                    # Fya 적용해도 좌굴 감소가 더 커서 강도 증가 없음 → virgin Fy 복원
                    Fy = Fy_original
                    state = _calc_flexure_state(Fy, False)
                    cold_work_info = None
                    warnings.append(
                        '§A3.3.2 cold work(Fya) 적용 시 좌굴 감소가 증가하여 '
                        '강도 개선 효과가 없습니다. Virgin Fy를 사용합니다.'
                    )
            else:
                warnings.extend(cold_work_info.get('warnings', []))

    Fy = state['Fy']
    My = state['My']
    Fcre = state['Fcre']
    global_result = state['global_result']
    Mne = state['Mne']
    Mcrl = state['Mcrl']
    Mcrl_source = state.get('Mcrl_source', 'FSM')
    local_result = state['local_result']
    Mnl = state['Mnl']
    Mcrd = state['Mcrd']
    Mcrd_source = state['Mcrd_source']
    dist_result = state['dist_result']
    Mnd = state['Mnd']
    Mnfo = state['Mnfo']

    # [문제1] My 라벨: Sf×Fy 명시, Cold Work 시 Sf×Fya 표시
    Fy_label = f'Fya={Fy:.2f} ksi' if cold_work_info and Fy != Fy_original else f'Fy={Fy:.2f} ksi'
    steps.append({
        'step': 1, 'name': 'Yield Moment (My)',
        'value': round(My, 2), 'unit': 'kip-in',
        'formula': f'My = Sf × {Fy_label.split("=")[0]} = {state["Sf_eff"]:.4f} in³ × {Fy:.2f} ksi = {My:.2f} kip-in',
    })

    # [문제2] Cold Work 적용 시 Fy→Fya 전환 단계 추가
    if cold_work_info and Fy != Fy_original:
        cw_C = cold_work_info.get('C', 0)
        cw_Fyc = cold_work_info.get('Fyc', 0)
        cw_Fya = cold_work_info.get('Fya', 0)
        steps.append({
            'step': '1b', 'name': '§A3.3.2 Cold Work of Forming',
            'value': round(cw_Fya, 2), 'unit': 'ksi',
            'formula': (
                f'Fyc = {cw_Fyc:.2f} ksi (R/t={cold_work_info.get("R_over_t", 0):.2f}), '
                f'C = {cw_C:.4f}, '
                f'Fya = C×Fyc + (1-C)×Fyv = {cw_C:.4f}×{cw_Fyc:.2f} + {1-cw_C:.4f}×{Fy_original:.2f} = {cw_Fya:.2f} ksi '
                f'(+{cold_work_info.get("increase_pct", 0):.1f}%) → Fy={Fy_original:.2f} ksi를 Fya={cw_Fya:.2f} ksi로 대체'
            ),
            'equation': 'A3.3.2-1',
        })
        spec_sections.append('A3.3.2')

    spec_sections.append('F2')
    if global_result.get('inelastic_reserve'):
        spec_sections.append('F2.4.2')
    if Mcrl > 0:
        spec_sections.append('F3.2')
    if Mcrd > 0:
        spec_sections.append('F4')
    # §F3.2.3 / §F4.3: 국부/왜곡 비탄성 예비강도가 실제로 적용된 경우에만 인용
    if str(local_result.get('equation', '')).startswith('F3.2.3'):
        spec_sections.append('F3.2.3')
    if str(dist_result.get('equation', '')).startswith('F4.3'):
        spec_sections.append('F4.3')
    # [문제3] §I6.1.2 관통체결 조항 인용
    if params.get('through_fastened', False):
        spec_sections.append('I6.1.2')

    ir_note = ''
    if use_ir and Zf > 0:
        Mp = global_result.get('Mp', 0)
        # §F2.4.2/§F3.2.3/§F4.3 비탄성 예비강도가 실제로 한 한계상태라도 비-IR 값을
        # 초과했는지 확인 — 그렇지 않으면 'Inelastic Reserve applied' 라벨이 오해를 부른다.
        _ir_engaged = (
            bool(global_result.get('inelastic_reserve'))
            or str(local_result.get('equation', '')).startswith('F3.2.3')
            or str(dist_result.get('equation', '')).startswith('F4.3')
        )
        if _ir_engaged:
            ir_note = f' [§F2.4.2 Inelastic Reserve: Mp={Mp:.2f} kip-in]'
        else:
            ir_note = ' [§F2.4.2 not applicable]'
            warnings.append(
                '§F2.4.2: Inelastic Reserve를 요청했으나 어떤 한계상태(F2.4.2/F3.2.3/F4.3)도 '
                '비탄성 예비강도를 발휘하지 못했습니다(λ 한계 초과 또는 Mp≤My). My로 상한됩니다.'
            )

    # [문제5] Cb + Fcre 상세 계산과정
    fcre_detail = state.get('Fcre_detail', {})
    if fcre_detail.get('unsupported'):
        _required_f = fcre_detail.get('required_section', 'F2.1.5')
        warnings.append(f'§{_required_f}: {fcre_detail.get("error", "rational analysis is required")}.')
    if fcre_detail and Lb > 0 and not fcre_detail.get('user_supplied') and not fcre_detail.get('unsupported'):
        _sey = fcre_detail.get('sigma_ey', 0)
        _st = fcre_detail.get('sigma_t', 0)
        _ro = fcre_detail.get('ro', 0)
        _Ag = fcre_detail.get('Ag', 0)
        _Sf_f = fcre_detail.get('Sf', 0)
        _ry = fcre_detail.get('ry', 0)
        _J = fcre_detail.get('J', 0)
        _Cw = fcre_detail.get('Cw', 0)
        _zf = fcre_detail.get('z_factor', 1.0)
        _eq = fcre_detail.get('equation', 'F2.1.1')
        fcre_formula = (
            f'σey = π²E/(Lb/ry)² = π²×29500 ksi/({Lb:.1f} in/{_ry:.4f} in)² = {_sey:.2f} ksi, '
            f'σt = (GJ + π²ECw/Lb²)/(Ag×ro²) = {_st:.2f} ksi, '
            f'Fcre = {"Cb×" if Cb != 1.0 else ""}ro×Ag/{"(2×Sf)" if _zf > 1 else "Sf"}×√(σey×σt) '
            f'= {"%.2f×" % Cb if Cb != 1.0 else ""}{_ro:.4f} in×{_Ag:.4f} in²/'
            f'{("(2×%.4f in³)" % _Sf_f) if _zf > 1 else "%.4f in³" % _Sf_f}'
            f'×√({_sey:.2f} ksi×{_st:.2f} ksi) = {Fcre:.2f} ksi'
        )
        steps.append({
            'step': '2a', 'name': f'Fcre — Lateral-Torsional Buckling (§{_eq})',
            'value': round(Fcre, 2), 'unit': 'ksi',
            'formula': fcre_formula,
            'equation': _eq,
        })

    # [문제2] Fn 표시에 적용 Fy(또는 Fya) 명시
    Fn_val = global_result["Fn"]
    Fcre_val = Fcre
    threshold = 2.78 * Fy
    if Fcre_val >= threshold:
        fn_cond = f'Fcre={Fcre_val:.2f} ksi ≥ 2.78×{Fy_label} = {threshold:.2f} ksi → Fn = {Fy_label}'
    elif Fcre_val > 0.56 * Fy:
        fn_cond = f'0.56×{Fy:.2f} ksi < Fcre={Fcre_val:.2f} ksi < 2.78×{Fy:.2f} ksi → Fn = {Fn_val:.2f} ksi (inelastic LTB)'
    else:
        fn_cond = f'Fcre={Fcre_val:.2f} ksi ≤ 0.56×{Fy:.2f} ksi → Fn = Fcre = {Fn_val:.2f} ksi'

    steps.append({
        'step': 2, 'name': 'Global/LTB (Mne)',
        'value': round(Mne, 2), 'unit': 'kip-in',
        'formula': f'{fn_cond}, Mne = Sf×Fn = {state["Sf_eff"]:.4f} in³×{Fn_val:.2f} ksi = {Mne:.2f} kip-in{ir_note}',
        'equation': global_result['equation'],
    })

    if Mcrl_source.startswith('§App.1'):
        warnings.append('Mcrl: signature curve에서 국부좌굴 극소 미검출 → Appendix 1 §1.1 Eq.1.1-4 해석적 판좌굴 공식 사용')

    steps.append({
        'step': 3, 'name': 'Local Buckling (Mnl)',
        'value': round(Mnl, 2), 'unit': 'kip-in',
        'formula': (
            f'Mcrl = {Mcrl:.2f} kip-in ({Mcrl_source}), '
            f'λl = √(Mne/Mcrl) = √({Mne:.2f} kip-in/{Mcrl:.2f} kip-in) = {local_result["lambda_l"]:.3f} → '
            f'Mnl = {Mnl:.2f} kip-in'
        ) if Mcrl > 0 else f'Mcrl = 0 → Mnl = Mne = {Mnl:.2f} kip-in',
        'equation': local_result['equation'],
    })

    if Mcrd_source.startswith('§2.3.3.3'):
        warnings.append('Mcrd: signature curve에서 뒤틀림 극소 미검출 → Appendix 2 §2.3.3.3 해석적 공식 사용')

    steps.append({
        'step': 4, 'name': 'Distortional Buckling (Mnd)',
        'value': round(Mnd, 2), 'unit': 'kip-in',
        'formula': (
            f'Mcrd = {Mcrd:.2f} kip-in ({Mcrd_source}), '
            f'λd = √(My/Mcrd) = √({My:.2f} kip-in/{Mcrd:.2f} kip-in) = {dist_result["lambda_d"]:.3f} → '
            f'Mnd = {Mnd:.2f} kip-in'
        ) if Mcrd > 0 else f'Mcrd = 0 → Mnd = My = {Mnd:.2f} kip-in',
        'equation': dist_result['equation'],
    })

    # Step 5: 공칭강도
    Mn_dsm = min(Mne, Mnl, Mnd)
    if Mn_dsm == Mnl and Mnl < Mne:
        mode = 'Local Buckling'
    elif Mn_dsm == Mnd and Mnd < Mne:
        mode = 'Distortional Buckling'
    else:
        mode = 'Global/LTB'

    steps.append({
        'step': 5, 'name': 'Nominal Strength — DSM (Mn)',
        'value': round(Mn_dsm, 2), 'unit': 'kip-in',
        'formula': f'Mn = min(Mne={Mne:.2f} kip-in, Mnl={Mnl:.2f} kip-in, Mnd={Mnd:.2f} kip-in) = {Mn_dsm:.2f} kip-in',
        'controlling_mode': mode,
    })

    # Step 5b: §I6.2.1 양력 감소계수 R 적용 (through-fastened panel)
    # AISI 예제 방식: Mn = R × Mnfo (Mnfo = Mnl with Mne=My, 뒤틀림좌굴 제외)
    R_uplift = params.get('R_uplift')
    Mn = Mn_dsm
    if R_uplift is not None and R_uplift > 0:
        # Mnfo: 국부좌굴 강도만 고려 (Fn=Fy, Mne=My 조건). state['Mnfo']는 IR 활성 시
        # §F3.2.3 소성 상한(λl=√(My/Mcrl)≤0.776)을 이미 반영하므로, 왜곡(Mnd)이 제외된
        # 이 경로에서도 국부 비탄성 상한을 초과하지 않는다(§A3.3.2/§F3.2.3 일관성).
        Mnfo = state['Mnfo']
        Mn_R = R_uplift * Mnfo
        # R-factor 적용 시 Mnd 검토 불필요 (§I6.2.1)
        Mn = min(Mne, Mnl, Mn_R)  # Mnd 제외
        if Mn == Mn_R:
            mode = f'§I6.2.1 R-factor (R={R_uplift})'
        elif Mn == Mnl and Mnl < Mne:
            mode = 'Local Buckling'
        else:
            mode = 'Global/LTB'
        steps.append({
            'step': '5b', 'name': 'Uplift R-factor (§I6.2.1)',
            'value': round(Mn_R, 2), 'unit': 'kip-in',
            'formula': f'Mnfo(Mne=My) = {Mnfo:.2f} kip-in, Mn_R = R × Mnfo = {R_uplift} × {Mnfo:.2f} = {Mn_R:.2f} kip-in',
            'R': R_uplift,
            'Mnfo': round(Mnfo, 2),
            'controls': Mn == Mn_R,
            'note': 'Distortional buckling excluded per §I6.2.1',
        })
        spec_sections.append('I6.2.1')

    # §F2.3 round HSS는 φ_b=0.95(LRFD)/Ω_b=1.67(ASD)를 사용한다. global_result의
    # equation에 'F2.3'이 포함되면(즉 §F2.3 곡선으로 Mne를 산정한 round HSS) 0.95를 적용한다.
    # 그 외 모든 단면(C/Z 개단면, closed-box 등)은 기존 φ_b=0.90으로 불변.
    _is_f2_3 = 'F2.3' in str(global_result.get('equation', ''))
    phi = PHI['flexure_round_hss'] if _is_f2_3 else PHI['flexure']
    omega = OMEGA['flexure_round_hss'] if _is_f2_3 else OMEGA['flexure']
    phi_Mn = phi * Mn
    Mn_omega = Mn / omega

    steps.append({
        'step': 6, 'name': 'Final Nominal Strength (Mn)',
        'value': round(Mn, 2), 'unit': 'kip-in',
        'formula': f'Mn = {Mn:.2f} kip-in — {mode}',
        'controlling_mode': mode,
    })

    utilization = 0
    if design_method == 'LRFD':
        design_strength = phi_Mn
        if Mu > 0 and phi_Mn > 0:
            utilization = Mu / phi_Mn
        elif Mu > 0 and phi_Mn <= 0:
            utilization = float('inf')
        steps.append({
            'step': 7, 'name': 'Design Strength (LRFD)',
            'value': round(phi_Mn, 2), 'unit': 'kip-in',
            'formula': f'φMn = {phi} × {Mn:.2f} kip-in = {phi_Mn:.2f} kip-in',
        })
    else:
        design_strength = Mn_omega
        if Mu > 0 and Mn_omega > 0:
            utilization = Mu / Mn_omega
        elif Mu > 0 and Mn_omega <= 0:
            utilization = float('inf')
        steps.append({
            'step': 7, 'name': 'Allowable Strength (ASD)',
            'value': round(Mn_omega, 2), 'unit': 'kip-in',
            'formula': f'Mn/Ω = {Mn:.2f} kip-in/{omega} = {Mn_omega:.2f} kip-in',
        })

    # 0 공칭강도는 어떤 경우에도 유효한 설계가 아니다 → Mu 유무와 무관하게 pass=False.
    # (_design_compression의 Pn<=0 가드와 동일 — 단면물성 실패로 Mn=0이 나온 경우
    #  pass=None('미검토')으로 표시되어 0강도 실패가 가려지는 것을 방지.)
    if Mn <= 0:
        pass_flag = False
    elif Mu > 0:
        pass_flag = utilization <= 1.0
    else:
        pass_flag = None

    result = {
        'member_type': 'flexure',
        'method': 'DSM',
        'design_method': design_method,
        'Mn': round(Mn, 2),
        'Mn_dsm': round(Mn_dsm, 2),
        'Mne': round(Mne, 2),
        'Mnl': round(Mnl, 2),
        'Mnd': round(Mnd, 2),
        'My': round(My, 2),
        'R_uplift': R_uplift,
        'cold_work': cold_work_info,
        'use_cold_work': params.get('use_cold_work', False),
        'use_inelastic_reserve': use_ir,
        'beta_dist': state.get('beta_dist', 1.0),
        'distortional_not_evaluated': state.get('mcrd_fallback_failed', False),
        'Fcre_detail': fcre_detail if fcre_detail else None,
        'Fy_used': round(Fy, 2),
        'Fy_original': round(Fy_original, 2),
        'controlling_mode': mode,
        'phi_Mn': round(phi_Mn, 2),
        'Mn_omega': round(Mn_omega, 2),
        'design_strength': round(design_strength, 2),
        'utilization': round(utilization, 4) if Mu > 0 else None,
        'pass': pass_flag,
        'steps': steps,
        'spec_sections': list(set(spec_sections)),
        'warnings': warnings,
    }
    if state.get('mcrd_fallback_failed', False):
        result['pass'] = None
        result['utilization_valid'] = False

    # §G2 + §H2 전단 및 휨-전단 상호작용. UI는 flexure에도 Vu를 전달하므로
    # member_type='combined'에만 두면 순수 휨 설계 경로에서 전단 한계상태가 누락된다.
    Vu = abs(params.get('Vu', 0) or 0)
    if Vu > 0:
        geom = _section_geometry(params)
        h_shear = geom['h_web']
        t_shear = geom['t']
        if h_shear > 0 and t_shear > 0:
            shear_res = shear_strength(h_shear, t_shear, Fy)
            Vn = shear_res['Vn']
            phi_v = PHI['shear']
            omega_v = OMEGA['shear']
            Va = phi_v * Vn if design_method == 'LRFD' else Vn / omega_v
            shear_int = combined_bending_shear(Mu, design_strength, Vu, Va)
            result['shear'] = {
                **shear_res,
                'Vn': round(Vn, 2),
                'design_strength': round(Va, 2),
                'Vu': round(Vu, 2),
            }
            result['shear_interaction'] = shear_int
            result['spec_sections'].extend(['G2', 'H2'])
            _merge_governing_check(result, shear_int, 'H2 bending + shear')
        else:
            result['pass'] = None
            result['utilization_valid'] = False
            result['warnings'].append(
                'Vu가 입력되었으나 web flat depth h 또는 thickness t가 없어 '
                '§G2/§H2 전단 검토를 수행할 수 없습니다.'
            )

    # ── 정모멘트 구간 별도 검토 ──
    Lb_pos = params.get('Lb_pos', 0)
    Cb_pos = params.get('Cb_pos', 1.0)
    Mu_pos = abs(params.get('Mu_pos', 0))
    if Lb_pos > 0 or Mu_pos > 0 or (Lb_pos == 0 and params.get('Lb', 0) > 0):
        # 정모멘트 구간: Lb_pos, Cb_pos로 별도 Fcre/Mne 계산.
        # §F2.1.4 box(Fy)/§F2.3 round HSS(section_type/D_over_t/E) 분기를 주 구간과 일관되게 전달.
        Fcre_pos = compute_beam_Fcre(props, Cb_pos, Lb_pos, section_type=section_type, Fy=Fy)
        global_pos = beam_global_strength(
            Fy, Fcre_pos, Sf, section_type=section_type, D_over_t=D_over_t, E=E)
        Mne_pos = global_pos['Mne']

        # §F3.1.1: round HSS로 D/t ≤ 0.441 E/Fy 이면 국부좌굴 미검토 (Mnl_pos=Mne_pos).
        _skip_round_local_pos = (
            _is_round and D_over_t is not None and D_over_t > 0
            and Fy > 0 and D_over_t <= 0.441 * E / Fy
        )
        # 정모멘트: Mcrl, Mcrd는 동일 단면이므로 같은 값 사용
        if _skip_round_local_pos:
            Mnl_pos = Mne_pos
        elif Mcrl > 0:
            local_pos = flexure_local(Mne_pos, Mcrl)
            Mnl_pos = local_pos['Mnl']
        else:
            Mnl_pos = Mne_pos

        # 정모멘트 구간의 왜곡좌굴: 부모멘트 구간에서 곱한 β(역곡률 증대)를 그대로
        # 재사용하면 안 된다(§Appendix 2 Eq. 2.3.3.3-3의 β는 구간 곡률에 의존). 따라서
        # β 미적용 기준값 Mcrd_base를 사용하여 정모멘트 구간은 β=1.0을 기본으로 한다.
        # My_pos = Sf×Fy(총단면계수×Fy)는 Eq. F4.1-4에 부합하며 주 구간과 동일하다.
        Mcrd_pos = state.get('Mcrd_base', Mcrd)
        if _skip_round_local_pos:
            # round HSS: 왜곡좌굴 미적용 → Mnd_pos=Mne_pos (§F2.3 Mne 보존).
            Mnd_pos = Mne_pos
        elif Mcrd_pos > 0:
            dist_pos = flexure_distortional(Sf * Fy, Mcrd_pos)
            Mnd_pos = dist_pos['Mnd']
        else:
            Mnd_pos = Sf * Fy

        Mn_pos = min(Mne_pos, Mnl_pos, Mnd_pos)
        if design_method == 'LRFD':
            phi_Mn_pos = phi * Mn_pos
        else:
            phi_Mn_pos = Mn_pos / omega

        # 정모멘트 구간 이용률
        util_pos = None
        pass_pos = None
        if Mu_pos > 0 and phi_Mn_pos > 0:
            util_pos = round(Mu_pos / phi_Mn_pos, 4)
            pass_pos = util_pos <= 1.0

        result['positive_region'] = {
            'Lb': round(Lb_pos, 1),
            'Cb': round(Cb_pos, 2),
            'Fcre': round(Fcre_pos, 2),
            'Mne': round(Mne_pos, 2),
            'Mnl': round(Mnl_pos, 2),
            'Mnd': round(Mnd_pos, 2),
            'Mn': round(Mn_pos, 2),
            'phi_Mn': round(phi_Mn_pos, 2),
            'Mu_pos': round(Mu_pos, 2),
            'utilization': util_pos,
            'pass': pass_pos,
            'equation': global_pos.get('equation', ''),
        }

        # 정모멘트 구간이 지배하는지 체크 → 전체 판정에 반영
        if pass_pos is not None and not pass_pos:
            result['pass'] = False
            if 'warnings' not in result:
                result['warnings'] = []
            result['warnings'].append(
                f'정모멘트 구간 NG: Mu(+)={Mu_pos:.2f} > '
                f'{"φ" if design_method == "LRFD" else ""}Mn(+)={phi_Mn_pos:.2f} kip-in '
                f'(DCR={util_pos:.3f})'
            )

    # §H3 웹 크리플링 + 휨 상호작용
    wc_N = params.get('wc_N', 0)
    wc_R = params.get('wc_R', 0)
    wc_support = params.get('wc_support', 'EOF')
    if wc_N > 0 and wc_R >= 0:
        geom = _section_geometry(params)
        h = geom['h_web']
        t = geom['t']
        if h > 0 and t > 0:
            wc_sec_type = params.get('wc_section_type') or _effective_section_type(params)
            wc_section_family = _infer_web_crippling_family(params, wc_sec_type)
            wc_fastened = params.get('wc_fastened', 'fastened')
            wc_web_config = params.get('wc_web_config', 'single')
            wc_flange_condition = params.get('wc_flange_condition')
            wc_overhang = params.get('wc_overhang', 0)
            wc_edge_distance = params.get('wc_edge_distance')
            wc_n_webs = _infer_web_crippling_n_webs(params, wc_section_family)
            wc_spacing = params.get('wc_support_fastener_spacing')
            wc = web_crippling(h, t, wc_R, wc_N, Fy, support=wc_support,
                               fastened=wc_fastened,
                               section_type=wc_sec_type,
                               section_family=wc_section_family,
                               flange_condition=wc_flange_condition,
                               Lo=wc_overhang,
                               edge_distance=wc_edge_distance,
                               n_webs=wc_n_webs,
                               web_config=wc_web_config,
                               support_fastener_spacing=wc_spacing)
            if 'error' in wc:
                warnings.append(f'§G5 web crippling could not be evaluated: {wc["error"]}')
                result['web_crippling'] = wc
                result['pass'] = None
                result['utilization_valid'] = False
                return result
            Pn_wc = wc['Pn']
            from design.interaction import combined_bending_web_crippling
            # 집중하중 P = 소요 반력 (Vu를 사용하거나, Pu를 사용)
            Vu = params.get('Vu', 0) or params.get('Pu', 0)
            wc_result = {**wc, 'Pn': round(Pn_wc, 2)}
            result['web_crippling'] = wc_result
            result['warnings'].extend(wc.get('warnings', []))
            if wc.get('h3_applicable', True):
                # §H3 Eq. H3-1/2/3: limit is method-dependent (LRFD/LSD → coeff·φ;
                # ASD → coeff/Ω with Ω=1.70 per spec). Pass design_method (in scope)
                # instead of hardcoding φ=0.90 so the ASD (Ω) form is used for ASD runs.
                h3 = combined_bending_web_crippling(
                    Vu, Pn_wc, Mu, Mnfo,
                    web_config=wc_web_config, design_method=design_method)
                result['h3_interaction'] = h3
                h3_ratio = h3['total'] / h3['limit'] if h3.get('limit', 0) > 0 else float('inf')
                _merge_governing_check(result, h3, 'H3 bending + web crippling', h3_ratio)
            elif wc.get('h3_not_applicable_reason'):
                result['warnings'].append(wc['h3_not_applicable_reason'])
            result['Mnfo'] = round(Mnfo, 2)
            result['spec_sections'].append('G5')
            if result.get('h3_interaction'):
                result['spec_sections'].append('H3')

    return result


# ============================================================
# 조합 하중
# ============================================================

def _design_combined(params: dict) -> dict:
    """조합 하중 설계 (압축 + 휨x + 휨y + 전단, §C1 모멘트 증폭 포함)

    부호 규약: params['Pu'] 양수 = 압축(§H1.2), 음수 = 인장(§H1.1).
    """
    design_method = params.get('design_method', 'LRFD')

    # §H1.1 vs §H1.2 분기: abs() 적용 전 원래 부호로 인장/압축을 판정한다.
    Pu_raw = params.get('Pu', 0)
    if Pu_raw < 0:
        return _design_combined_tension(params, abs(Pu_raw))

    # 소요 하중
    Pu = abs(Pu_raw)
    Mux = abs(params.get('Mux', 0))
    Muy = abs(params.get('Muy', 0))

    # Cm 등가모멘트 계수 (§C1.2.1.1 Eq. C1.2.1.1-4)
    #  (a) 지간 사이 횡하중 없음: Cm = 0.6 - 0.4(M1/M2), M1/M2는 역곡률 양수/단일곡률 음수
    #  (b) 지간 사이 횡하중 있음: Cm = 1.0 (보수적 기본값)
    # 하중 구성을 알 수 없으면 0.85가 아니라 사양이 허용하는 보수적 1.0을 기본으로 한다.
    M1_M2 = params.get('dist_M1_M2', None)
    if params.get('Cmx') is not None:
        Cmx = params.get('Cmx')
    elif M1_M2 is not None and not params.get('transverse_load', False):
        Cmx = 0.6 - 0.4 * M1_M2  # Eq. C1.2.1.1-4
    else:
        Cmx = 1.0
    if params.get('Cmy') is not None:
        Cmy = params.get('Cmy')
    elif M1_M2 is not None and not params.get('transverse_load', False):
        Cmy = 0.6 - 0.4 * M1_M2
    else:
        Cmy = 1.0

    # 압축 설계
    comp_params = {**params, 'member_type': 'compression', 'Pu': Pu}
    comp = _design_compression(comp_params)
    if 'error' in comp:
        return comp

    # 휨 설계 (x축)
    flex_params = {**params, 'member_type': 'flexure', 'Mu': Mux}
    flex_x = _design_flexure(flex_params)
    if 'error' in flex_x:
        return flex_x

    # 휨 설계 (y축 — 약축)
    props = params.get('props', {})
    Ag = props.get('A', 0)
    flex_y = None
    May_strength = params.get('May_strength', 0)
    if Muy > 0:
        if May_strength <= 0:
            return {
                'error': 'Weak-axis flexure requires explicit May_strength. Automatic weak-axis DSM strength is not implemented.',
                'member_type': 'combined',
            }
        flex_y = {
            'Mn': round(May_strength, 2),
            'design_strength': round(May_strength, 2),
            'controlling_mode': 'User-supplied weak-axis strength',
        }
    else:
        May_strength = 1e10

    # §C1 모멘트 증폭 (P-δ 효과)
    KxLx = params.get('KxLx', 120)
    KyLy = params.get('KyLy', 120)
    rx = props.get('rx', 0)
    # 약축 회전반경: grosprop 계열 props는 'rz' 키만 제공하므로 fallback 필수
    # (없으면 alpha_y가 항상 1.0으로 고정되어 §C1.2.1.1 약축 증폭이 누락된다).
    ry = props.get('ry', 0) or props.get('rz', 0)
    alpha_x, alpha_y = 1.0, 1.0
    PEx, PEy = 1e10, 1e10
    # §C1.2.1.1 Eq. C1.2.1.1-3: B1 = Cm/(1 - α·P̄/Pe1) ≥ 1.0
    # α = 1.00 (LRFD/LSD), 1.60 (ASD). Pu is the required axial force in the
    # corresponding load combination (passed in unmodified, so applying 1.60
    # here is the single place the ASD destabilizing-ratio amplifier is applied).
    c1_alpha = 1.60 if design_method == 'ASD' else 1.00
    if Pu > 0 and rx > 0 and Ag > 0:
        PEx = math.pi ** 2 * E * Ag / (KxLx / rx) ** 2
        alpha_x = Cmx / max(1 - c1_alpha * Pu / PEx, 0.01)
        alpha_x = max(alpha_x, 1.0)
    if Pu > 0 and ry > 0 and Ag > 0:
        PEy = math.pi ** 2 * E * Ag / (KyLy / ry) ** 2
        alpha_y = Cmy / max(1 - c1_alpha * Pu / PEy, 0.01)
        alpha_y = max(alpha_y, 1.0)

    Mux_amp = Mux * alpha_x
    Muy_amp = Muy * alpha_y

    # 설계강도
    Pa = comp['design_strength']
    Max = flex_x['design_strength']
    May = flex_y['design_strength'] if flex_y else 1e10

    # §H1.2 2번째 단락: 각형(angle) 단면(비대칭 무보강 각형의 미감소 Ae 또는 Pnl=Pne인
    # 예외 경우 제외)은 My를 Muy 또는 Muy+(P)L/1000 중 P 허용값이 더 낮아지는 쪽으로 취한다.
    # L은 부재 비지지 길이(in) — 본 코드의 단위계가 in이므로 P*L/1000은 kip-in 모멘트가 된다.
    sec_type_eff = _effective_section_type(params).strip().lower()
    is_angle = 'angle' in sec_type_eff
    # 예외(L/1000 불필요): 비대칭 무보강 각형의 미감소 Ae 이거나 Pnl=Pne
    angle_exempt = (comp.get('Pnl', 0) >= comp.get('Pne', 0)) if is_angle else True
    angle_l1000_note = None
    if is_angle and not angle_exempt:
        L_angle = params.get('L', 0) or KyLy
        Padd = Pu * L_angle / 1000.0
        Muy_with_ecc = Muy_amp + Padd
        # 두 경우를 모두 평가하여 P 허용값이 낮은(이용률이 큰) 쪽을 지배 케이스로 채택
        inter_no_ecc = combined_axial_bending(Pu, Pa, Mux_amp, Max, Muy_amp, May)
        inter_ecc = combined_axial_bending(Pu, Pa, Mux_amp, Max, Muy_with_ecc, May)
        if inter_ecc['total'] >= inter_no_ecc['total']:
            Muy_amp = Muy_with_ecc
            angle_l1000_note = (
                f'§H1.2: 각형 단면 → My = Muy + (P)L/1000 = {Muy_with_ecc:.2f} kip-in '
                f'(P={Pu:.2f} kips, L={L_angle:.1f} in, 추가편심모멘트={Padd:.2f} kip-in)이 지배'
            )
        else:
            angle_l1000_note = (
                f'§H1.2: 각형 단면 추가편심 (P)L/1000={Padd:.2f} kip-in 검토 — Muy만 사용한 경우가 지배'
            )

    # 상호작용 검토 (증폭된 모멘트 사용)
    interaction = combined_axial_bending(Pu, Pa, Mux_amp, Max, Muy_amp, May)

    result = {
        'member_type': 'combined',
        'design_method': design_method,
        'compression': {
            'Pn': comp['Pn'],
            'design_strength': comp['design_strength'],
            'controlling_mode': comp['controlling_mode'],
        },
        'flexure_x': {
            'Mn': flex_x['Mn'],
            'design_strength': flex_x['design_strength'],
            'controlling_mode': flex_x['controlling_mode'],
        },
        'interaction': interaction,
        'utilization': interaction['total'],
        'pass': interaction['pass'],
        'governing_check': 'H1.2 axial + bending',
        'steps': comp['steps'] + flex_x['steps'],
        'spec_sections': list(set(comp['spec_sections'] + flex_x['spec_sections'] + ['H1.2'])),
        'warnings': list(dict.fromkeys(comp.get('warnings', []) + flex_x.get('warnings', []))),
    }
    if angle_l1000_note:
        result.setdefault('warnings', []).append(angle_l1000_note)
        result['angle_l1000'] = angle_l1000_note

    # y축 휨 결과
    if flex_y:
        result['flexure_y'] = flex_y
        result['steps'].append({
            'step': len(result['steps']) + 1,
            'name': 'Weak-axis Flexure (Mny)',
            'value': flex_y['Mn'], 'unit': 'kip-in',
            'formula': f'May = {flex_y["Mn"]} kip-in (user-supplied available weak-axis strength)',
            'equation': 'User input',
        })

    # 모멘트 증폭 정보
    if alpha_x > 1.0 or alpha_y > 1.0:
        result['amplification'] = {
            'Cmx': Cmx, 'Cmy': Cmy,
            'alpha': c1_alpha,  # §C1.2.1.1-3 α: 1.00 (LRFD/LSD), 1.60 (ASD)
            'PEx': round(PEx, 2), 'PEy': round(PEy, 2),
            'alpha_x': round(alpha_x, 4), 'alpha_y': round(alpha_y, 4),
            'Mux_amp': round(Mux_amp, 2), 'Muy_amp': round(Muy_amp, 2),
        }
        result['spec_sections'].append('C1')

    # _design_flexure가 동일 Mux/Vu 위치에 대해 수행한 G2/H2 및 G5/H3 결과를
    # 조합부재 최상위 판정에도 병합한다. 내부 결과만 저장하고 pass를 누락하지 않는다.
    if flex_x.get('shear'):
        result['shear'] = flex_x['shear']
    if flex_x.get('shear_interaction'):
        result['shear_interaction'] = flex_x['shear_interaction']
        _merge_governing_check(result, flex_x['shear_interaction'], 'H2 bending + shear')
    if flex_x.get('web_crippling'):
        result['web_crippling'] = flex_x['web_crippling']
    if flex_x.get('h3_interaction'):
        result['h3_interaction'] = flex_x['h3_interaction']
        h3 = flex_x['h3_interaction']
        h3_ratio = h3['total'] / h3['limit'] if h3.get('limit', 0) > 0 else float('inf')
        _merge_governing_check(result, h3, 'H3 bending + web crippling', h3_ratio)
    if comp.get('utilization_valid') is False or flex_x.get('utilization_valid') is False:
        result['utilization_valid'] = False
        result['pass'] = None if result.get('pass') is not False else False

    return result


def _design_combined_tension(params: dict, T_abs: float) -> dict:
    """§H1.1 조합 인장축력 + 휨 (Eq. H1.1-1, H1.1-2).

    순 인장 부재는 P-δ 모멘트 증폭을 받지 않으므로(α=1.0, 증폭 없음) Mux/Muy를 증폭하지 않는다.
    Eq. H1.1-1: Mx/Maxt + My/Mayt + T/Ta ≤ 1.0  (인장 플랜지 항복, Maxt=φb·Sft·Fy)
    Eq. H1.1-2: Mx/Max  + My/May  - T/Ta ≤ 1.0  (좌굴 — Chapter F 강도)
    """
    design_method = params.get('design_method', 'LRFD')
    Fy = params.get('Fy', 35.53)
    Mux = abs(params.get('Mux', 0))
    Muy = abs(params.get('Muy', 0))
    props = params.get('props', {})

    # Ta — Chapter D (항복/파단)
    tens = _design_tension({**params, 'member_type': 'tension', 'Tu': T_abs})
    if 'error' in tens:
        return tens
    Ta = tens['design_strength']

    # 휨 (x축) — Chapter F 압축좌굴 강도 (Max, Eq. H1.1-2)
    flex_x = _design_flexure({**params, 'member_type': 'flexure', 'Mu': Mux})
    if 'error' in flex_x:
        return flex_x
    Max = flex_x['design_strength']

    # y축 휨: 사용자 제공 강도 (자동 약축 DSM 미구현)
    May_strength = params.get('May_strength', 0)
    if Muy > 0 and May_strength <= 0:
        return {
            'error': 'Weak-axis flexure requires explicit May_strength. Automatic weak-axis DSM strength is not implemented.',
            'member_type': 'combined',
        }
    May = May_strength if May_strength > 0 else 1e10

    # Maxt / Mayt — 인장 플랜지 항복 (Eq. H1.1-3): φb·Sft·Fy (LRFD/LSD), Sft·Fy/Ωb (ASD)
    # Sft = 극인장섬유 기준 총(미감소)단면계수. 본 코드는 Sx를 대표 단면계수로 사용한다.
    Sft = props.get('Sft', 0) or props.get('Sf', 0) or props.get('Sxx', 0) or props.get('Sx', 0)
    phi_b = PHI['flexure']
    omega_b = OMEGA['flexure']
    if design_method == 'LRFD':
        Maxt = phi_b * Sft * Fy
    else:
        Maxt = Sft * Fy / omega_b
    # 약축 인장항복 단면계수가 별도로 제공되지 않으면 사용자 제공 약축강도(May)로 대체
    Sft_y = props.get('Sft_y', 0)
    if Sft_y > 0:
        Mayt = (phi_b * Sft_y * Fy) if design_method == 'LRFD' else (Sft_y * Fy / omega_b)
    else:
        Mayt = May

    def _ratio(num, den):
        demand = abs(num)
        if demand <= 0:
            return 0.0
        return demand / den if den and den > 0 else float('inf')

    # Eq. H1.1-1
    r11 = _ratio(Mux, Maxt) + _ratio(Muy, Mayt) + _ratio(T_abs, Ta)
    # Eq. H1.1-2 (-T/Ta 항)
    r12 = _ratio(Mux, Max) + _ratio(Muy, May) - _ratio(T_abs, Ta)
    total = max(r11, r12)
    governing = 'H1.1-1' if r11 >= r12 else 'H1.1-2'

    interaction = {
        'eq_H1_1_1': round(r11, 4),
        'eq_H1_1_2': round(r12, 4),
        'total': round(total, 4),
        'governing': governing,
        'pass': total <= 1.0,
        'equation': governing,
        # UI 호환 키 (combined_axial_bending과 동일한 표시 키 일부 제공)
        'P_ratio': round(_ratio(T_abs, Ta), 4),
        'Mx_ratio': round(_ratio(Mux, Maxt if governing == 'H1.1-1' else Max), 4),
        'My_ratio': round(_ratio(Muy, Mayt if governing == 'H1.1-1' else May), 4),
    }

    result = {
        'member_type': 'combined',
        'load_type': 'tension+bending',
        'design_method': design_method,
        'tension': {
            'Tn': tens.get('Tn'),
            'design_strength': Ta,
            'controlling_mode': tens.get('controlling_mode'),
        },
        'flexure_x': {
            'Mn': flex_x['Mn'],
            'design_strength': Max,
            'controlling_mode': flex_x['controlling_mode'],
        },
        'Maxt': round(Maxt, 2),
        'Mayt': round(Mayt, 2) if Mayt < 1e9 else None,
        'interaction': interaction,
        'steps': tens.get('steps', []) + flex_x.get('steps', []),
        'spec_sections': list(set(tens.get('spec_sections', []) + flex_x['spec_sections'] + ['H1.1'])),
        'warnings': list(dict.fromkeys(flex_x.get('warnings', []) + [
            '§H1.1: 순 인장축력 + 휨으로 평가했습니다(P-δ 모멘트 증폭 미적용). '
            'Maxt=φb·Sft·Fy(인장항복), Max=Chapter F(압축좌굴). Pu 부호 규약: 음수=인장.'
        ])),
        'pass': interaction['pass'],
        'utilization': round(total, 4),
    }
    if flex_x.get('utilization_valid') is False:
        result['utilization_valid'] = False
        result['pass'] = None if result['pass'] else False
    return result


# ============================================================
# 인장 부재 설계
# ============================================================

def _design_tension(params: dict) -> dict:
    """인장 부재 설계 (§D2, §D3)"""
    Fy = params.get('Fy', 35.53)
    Fu = params.get('Fu', 58.02)
    design_method = params.get('design_method', 'LRFD')
    Tu = params.get('Tu', 0)

    props = params.get('props', {})
    Ag = props.get('A', 0)
    An = params.get('An', Ag)  # 순단면적 (기본=총단면)

    if Ag <= 0:
        return {'error': 'Section area not available (A=0)'}

    steps = []

    # 항복
    Tn_yield = Ag * Fy
    phi_y = PHI['tension_yield']
    omega_y = OMEGA['tension_yield']
    steps.append({
        'step': 1, 'name': 'Yielding (D2)',
        'value': round(Tn_yield, 2), 'unit': 'kips',
        'formula': f'Tn = Ag × Fy = {Ag:.4f} × {Fy} = {Tn_yield:.2f}',
    })

    # 파단
    Tn_rupture = An * Fu
    phi_r = PHI['tension_rupture']
    omega_r = OMEGA['tension_rupture']
    steps.append({
        'step': 2, 'name': 'Rupture (D3)',
        'value': round(Tn_rupture, 2), 'unit': 'kips',
        'formula': f'Tn = An × Fu = {An:.4f} × {Fu} = {Tn_rupture:.2f}',
    })

    if design_method == 'LRFD':
        str_y = phi_y * Tn_yield
        str_r = phi_r * Tn_rupture
    else:
        str_y = Tn_yield / omega_y
        str_r = Tn_rupture / omega_r

    if str_y <= str_r:
        Tn = Tn_yield
        design_strength = str_y
        mode = 'Yielding'
    else:
        Tn = Tn_rupture
        design_strength = str_r
        mode = 'Rupture'

    utilization = Tu / design_strength if Tu > 0 and design_strength > 0 else None

    return {
        'member_type': 'tension',
        'design_method': design_method,
        'Tn': round(Tn, 2),
        'Tn_yield': round(Tn_yield, 2),
        'Tn_rupture': round(Tn_rupture, 2),
        'design_strength': round(design_strength, 2),
        'controlling_mode': mode,
        'utilization': round(utilization, 4) if utilization else None,
        'pass': utilization <= 1.0 if utilization else None,
        'steps': steps,
        'spec_sections': ['D2', 'D3'],
    }


# ============================================================
# 설계 가이드 (AI용)
# ============================================================

DESIGN_GUIDES = {
    'column': {
        'workflow_steps': [
            '1. set_section_template → 단면 생성',
            '2. set_material(E=29500, v=0.3) → 재료 설정',
            '3. set_stress(type="uniform_compression", fy=Fy) → 압축 응력',
            '4. run_analysis(neigs=10) → FSM 좌굴 해석',
            '5. get_dsm_values(fy=Fy) → Pcrl, Pcrd, Py 추출',
            '6. get_section_properties() → A, rx, ry, J, Cw, xo',
            '7. aisi_design_compression(...) → 설계 계산',
        ],
        'required_inputs': [
            '단면 치수 (H, B, D, t, r)',
            '항복강도 Fy (ksi), 인장강도 Fu (ksi)',
            '유효좌굴길이 KxLx, KyLy, KtLt (in)',
            '설계방법 (ASD 또는 LRFD)',
        ],
        'cufsm_load_cases': ['compression'],
        'safety_factors': {'phi': 0.85, 'omega': 1.80},
        'similar_examples': [
            {'id': 'III-1A', 'title': 'C-Section Compression (EWM)', 'method': 'EWM'},
            {'id': 'III-1B', 'title': 'Double Z-Section (DSM)', 'method': 'DSM'},
            {'id': 'III-14', 'title': 'Web-Stiffened C-Section (DSM)', 'method': 'DSM'},
        ],
    },
    'beam': {
        'workflow_steps': [
            '1. set_section_template → 단면 생성',
            '2. set_material(E=29500, v=0.3) → 재료 설정',
            '3. set_stress(type="pure_bending", fy=Fy) → 휨 응력',
            '4. run_analysis(neigs=10) → FSM 좌굴 해석',
            '5. get_dsm_values(fy=Fy) → Mcrl, Mcrd, My 추출',
            '6. get_section_properties() → A, Sf, ry, J, Cw, xo',
            '7. aisi_design_flexure(...) → 설계 계산',
        ],
        'required_inputs': [
            '단면 치수 (H, B, D, t, r)',
            '항복강도 Fy (ksi), 인장강도 Fu (ksi)',
            '횡지지 간격 Lb (in), 모멘트 구배 계수 Cb',
            '설계방법 (ASD 또는 LRFD)',
        ],
        'cufsm_load_cases': ['bending_xx_pos'],
        'safety_factors': {'phi': 0.90, 'omega': 1.67},
        'similar_examples': [
            {'id': 'II-1A', 'title': 'C-Section Purlins (EWM, ASD)', 'method': 'EWM'},
            {'id': 'II-1B', 'title': 'C-Section Flexural (DSM)', 'method': 'DSM'},
            {'id': 'II-2B', 'title': 'Z-Section Flexural (DSM)', 'method': 'DSM'},
        ],
    },
    'beam_column': {
        'workflow_steps': [
            '1~6. 압축 설계 워크플로우 실행',
            '7. set_stress(type="pure_bending", fy=Fy) → 휨 응력으로 변경',
            '8. run_analysis(neigs=10) → 휨 좌굴 해석',
            '9. get_dsm_values(fy=Fy) → Mcrl, Mcrd, My 추출',
            '10. aisi_design_combined(...) → 조합 하중 설계',
        ],
        'required_inputs': [
            '단면 치수 (H, B, D, t, r)',
            '항복강도 Fy, 인장강도 Fu',
            'KxLx, KyLy, KtLt, Lb, Cb',
            '소요 하중: Pu, Mux, Muy, Vu',
        ],
        'cufsm_load_cases': ['compression', 'bending_xx_pos'],
        'safety_factors': {'phi_c': 0.85, 'phi_b': 0.90, 'omega_c': 1.80, 'omega_b': 1.67},
        'similar_examples': [
            {'id': 'III-7A', 'title': 'Z-Section Wall Stud (EWM)', 'method': 'EWM'},
            {'id': 'III-7B', 'title': 'Z-Section Wall Stud (DSM)', 'method': 'DSM'},
            {'id': 'III-12', 'title': 'Unbraced Frame Design', 'method': 'combined'},
        ],
    },
    'tension': {
        'workflow_steps': [
            '1. set_section_template → 단면 생성',
            '2. get_section_properties() → Ag (총단면적)',
            '3. aisi_design_tension(Fy, Fu, Tu) → 인장 설계',
        ],
        'required_inputs': [
            '단면 치수 → Ag',
            '항복강도 Fy, 인장강도 Fu',
            '순단면적 An (볼트홀 등 공제, 기본=Ag)',
            '소요 인장력 Tu (kips)',
        ],
        'cufsm_load_cases': [],
        'safety_factors': {'phi_yield': 0.90, 'phi_rupture': 0.75,
                           'omega_yield': 1.67, 'omega_rupture': 2.00},
        'similar_examples': [],
    },
    'connection': {
        'workflow_steps': [
            '1. 접합 유형 선택 (bolt / screw / fillet_weld)',
            '2. 모재 두께 t1, t2 및 Fy, Fu 입력',
            '3. 볼트/나사: 직경 d, 강도 Fub, 개수 n, 끝단거리 e',
            '4. 필릿용접: 용접크기, 길이, 용접봉강도 Fxx',
            '5. aisi_design_connection(...) → 접합 설계',
            '6. 각 파괴모드별 강도 확인 → 지배 모드 결정',
        ],
        'required_inputs': [
            '접합 유형 (bolt / screw / fillet_weld)',
            '모재 두께 t1, t2 (in)',
            '모재 강도 Fy, Fu (ksi)',
            '체결재/용접 상세',
        ],
        'cufsm_load_cases': [],
        'safety_factors': {'phi': '0.50~0.75 (유형별)', 'omega': '2.00~3.00 (유형별)'},
        'similar_examples': [
            {'id': 'IV-9', 'title': 'Bolted Connection', 'method': 'bolt'},
            {'id': 'IV-11', 'title': 'Screw Connection', 'method': 'screw'},
            {'id': 'IV-1', 'title': 'Fillet Weld Connection', 'method': 'fillet_weld'},
        ],
    },
}


def design_guide(params: dict) -> dict:
    """AI용 설계 가이드 반환"""
    query_type = params.get('query_type', 'column')
    guide = DESIGN_GUIDES.get(query_type, DESIGN_GUIDES['column'])

    return {
        'query_type': query_type,
        'cufsm_needed': True,
        **guide,
        'dsm_limits': {
            'stiffened_compression_wt': 500,   # 압축(균일 응력) 보강요소
            'stiffened_bending_ht': 300,       # 휨(응력 구배) 보강요소(웹), Table B4.1-1
            'edge_stiffened_bt': 160,
            'unstiffened_dt': 60,
            'R_t': 20,
            'Fy_max_ksi': 95,
        },
        'steel_grades': list(STEEL_GRADES.keys()),
    }


# ============================================================
# 설계 보고서 생성
# ============================================================

def generate_report(result: dict, params: dict = None) -> str:
    """설계 결과를 텍스트 보고서로 변환

    Returns: 복사/출력 가능한 텍스트 보고서
    """
    lines = []
    lines.append('=' * 60)
    lines.append('  AISI S100-16 DESIGN REPORT')
    lines.append('=' * 60)

    mt = result.get('member_type', '')
    dm = result.get('design_method', 'LRFD')
    method = result.get('method', 'DSM')

    lines.append(f'  Member Type : {mt.upper()}')
    lines.append(f'  Design Method : {dm}')
    if method:
        lines.append(f'  Analysis Method : {method}')
    lines.append('-' * 60)

    # Steps
    steps = result.get('steps', [])
    if steps:
        lines.append('')
        lines.append('  STEP-BY-STEP CALCULATION')
        lines.append('-' * 60)
        for s in steps:
            eq = f' [{s["equation"]}]' if s.get('equation') else ''
            mode = f' ← {s["controlling_mode"]}' if s.get('controlling_mode') else ''
            lines.append(f'  Step {s["step"]}: {s["name"]}{eq}{mode}')
            if s.get('formula'):
                lines.append(f'    {s["formula"]}')
            if s.get('value') is not None:
                lines.append(f'    → {s["value"]} {s.get("unit", "")}')
            lines.append('')

    # Limit states (connections)
    ls_list = result.get('limit_states', [])
    if ls_list:
        lines.append('')
        lines.append('  LIMIT STATES')
        lines.append('-' * 60)
        for ls in ls_list:
            gov = ' ← GOVERNING' if ls.get('governs') else ''
            lines.append(f'  {ls["name"]}{gov}')
            lines.append(f'    Rn = {ls["Rn"]} kips')
            lines.append(f'    Design Strength = {ls["design_strength"]} kips')
            lines.append('')

    # Summary
    lines.append('-' * 60)
    lines.append('  DESIGN SUMMARY')
    lines.append('-' * 60)

    if mt == 'compression':
        lines.append(f'  Pn   = {result.get("Pn")} kips')
        lines.append(f'  Mode = {result.get("controlling_mode")}')
        lines.append(f'  {"φPn" if dm=="LRFD" else "Pn/Ω"} = {result.get("design_strength")} kips')
    elif mt == 'flexure':
        lines.append(f'  Mn   = {result.get("Mn")} kip-in')
        lines.append(f'  Mode = {result.get("controlling_mode")}')
        lines.append(f'  {"φMn" if dm=="LRFD" else "Mn/Ω"} = {result.get("design_strength")} kip-in')
    elif mt == 'tension':
        lines.append(f'  Tn   = {result.get("Tn")} kips')
        lines.append(f'  Mode = {result.get("controlling_mode")}')
        lines.append(f'  Design Strength = {result.get("design_strength")} kips')
    elif mt == 'combined':
        c = result.get('compression', {})
        fx = result.get('flexure_x', {})
        lines.append(f'  Pn   = {c.get("Pn")} kips ({c.get("controlling_mode")})')
        lines.append(f'  Mnx  = {fx.get("Mn")} kip-in ({fx.get("controlling_mode")})')
        fy = result.get('flexure_y')
        if fy:
            lines.append(f'  Mny  = {fy.get("Mn")} kip-in ({fy.get("controlling_mode")})')
    elif mt == 'connection':
        lines.append(f'  Type = {result.get("connection_type")}')
        lines.append(f'  Governing = {result.get("governing_mode")}')
        lines.append(f'  Design Strength = {result.get("design_strength")} kips')

    util = result.get('utilization')
    if util is not None:
        status = 'OK' if result.get('pass') else 'NG'
        lines.append(f'  Utilization = {util*100:.1f}% → {status}')

    # Interaction
    inter = result.get('interaction')
    if inter:
        lines.append('')
        lines.append('  INTERACTION CHECK (§H1.2)')
        lines.append(f'  P/Pa    = {inter["P_ratio"]:.4f}')
        lines.append(f'  Mx/Max  = {inter["Mx_ratio"]:.4f}')
        lines.append(f'  My/May  = {inter["My_ratio"]:.4f}')
        lines.append(f'  Total   = {inter["total"]:.4f} {"≤" if inter["pass"] else ">"} 1.0 → {"OK" if inter["pass"] else "NG"}')

    h3 = result.get('h3_interaction')
    if h3:
        lines.append('')
        lines.append('  WEB CRIPPLING + BENDING (§H3)')
        lines.append(f'  0.91(P/Pn) = {h3["P_term"]:.4f}')
        lines.append(f'  M/Mnfo     = {h3["M_term"]:.4f}')
        lines.append(f'  Total      = {h3["total"]:.4f} {"≤" if h3["pass"] else ">"} {h3["limit"]:.2f} → {"OK" if h3["pass"] else "NG"}')

    # Spec reference
    secs = result.get('spec_sections', [])
    if secs:
        lines.append('')
        lines.append(f'  Specification: AISI S100-16 {", ".join("§"+s for s in secs)}')

    # Warnings
    warns = result.get('dsm_warnings', [])
    if warns:
        lines.append('')
        lines.append('  ⚠ DSM APPLICABILITY WARNINGS:')
        for w in warns:
            lines.append(f'    - {w}')

    lines.append('')
    lines.append('=' * 60)
    return '\n'.join(lines)


# ============================================================
# 단면 자동 생성 + props 계산
# ============================================================

def _auto_generate_props(params: dict) -> dict:
    """단면 템플릿에서 node/elem → grosprop → props 자동 생성"""
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from engine.template import generate_section
    from engine.properties import grosprop
    from engine.cutwp import cutwp_prop

    params = dict(params)  # 원본 변경 방지

    section_type = params.get('section_type', 'lippedc')
    H = params.get('H', 8.0)
    B = params.get('B', 2.5)
    D = params.get('D', 0.625)
    t = params.get('t', 0.0451)
    R_val = params.get('R', 0) or params.get('r', 0)

    try:
        sec = generate_section(section_type, {'H': H, 'B': B, 'D': D, 't': t, 'r': R_val})
        node = sec['node']
        elem = sec['elem']

        props = grosprop(node, elem)

        # CUTWP 성질 추가
        try:
            cw = cutwp_prop(node, elem)
            props['J'] = cw.get('J', 0)
            props['Cw'] = cw.get('Cw', 0)
            props['Xs'] = cw.get('Xs', 0)
            props['Zs'] = cw.get('Zs', 0)
        except Exception as e:
            # cutwp 실패 시 J/Cw=0 → 하류 compute_column_Fcre가 Fcre=0(→Pne=0)을 산출하는
            # 근본 원인이다. 삼키지 않고 표면화하여 0강도가 유효 설계로 오인되지 않게 한다.
            props['J'] = 0
            props['Cw'] = 0
            props['cutwp_failed'] = True
            print(f'[StCFSD] cutwp_prop failed (J/Cw=0 → Fcre may be 0): {e}')

        # §E2.2/§F2.1: 전단중심 편심 xo = |Xs - xcg| (도심~전단중심 x거리).
        # 단축대칭 C-단면은 xo≠0 → compute_column_Fcre가 휨-비틀림좌굴 분기를 탄다.
        # ro는 하류(compute_column_Fcre)에서 rx,ry,xo로부터 유도하도록 두고 여기서
        # 미리 계산하지 않는다(ro 정의 분기 방지). 점대칭 Z-단면은 xo≈0 → 이중대칭 분기 유지.
        props['xo'] = abs(props.get('Xs', 0) - props.get('xcg', 0))

        # Sf = Sx (호환성)
        props['Sf'] = props.get('Sx', 0)
        # grosprop은 약축 회전반경을 'rz'로만 반환한다 — §C1.2.1.1 약축 P-δ 증폭 등
        # 'ry' 키를 읽는 하류 소비자가 0을 받지 않도록 별칭을 둔다.
        props.setdefault('ry', props.get('rz', 0))
        props['t'] = t
        # 코너 반경: params에서 가져오거나, 템플릿의 기본 r 사용
        R = params.get('R', 0) or params.get('r', 0)
        if R > 0:
            props['R'] = R

        # ── DSM 적용한계/해석적 fallback/웹 크리플링용 기하 키 생성 ──
        # check_dsm_limits(h_web/b_flange/d_lip)와 Pcrd/Mcrd 해석적 fallback, §H3 웹 크리플링은
        # props['h_web']/['b_flange']/['d_lip']와 params['section']을 필요로 한다. grosprop은
        # 이를 제공하지 않으므로 H/B/D/t/R(이미 스코프 내)로부터 Table B4.1-1 / Appendix 1의
        # FLAT(평탄) 폭 규약으로 산정한다(out-to-out 아님). 요소별 내측 코너 수가 다르므로
        # 웹(2 코너)·플랜지(웹코너+립코너)·립(1 코너)에 각각 다른 환산을 적용한다.
        st_norm = str(section_type or 'lippedc').strip().lower().replace('-', '_')
        Rf = R if R > 0 else 0.0
        corner = Rf + t  # 한 내측 코너의 평탄폭 환산량 (out-to-out → flat)
        has_lip = ('lipped' in st_norm) or (st_norm in ('c', 'z', 'lippedc', 'lippedz', 'lipped_angle'))
        is_angle = 'angle' in st_norm
        # 웹: 양 끝 2개 내측 코너
        h_web_flat = max(H - 2 * corner, 0.0)
        # 플랜지: 웹-플랜지 코너 1개 + (립 있으면) 플랜지-립 코너 1개
        if has_lip and not is_angle:
            b_flange_flat = max(B - 2 * corner, 0.0)
        elif is_angle:
            # 앵글 다리: 코너 1개(다리-다리 접합부)
            b_flange_flat = max(B - corner, 0.0)
        else:
            # 무립(track/플랜지만): 웹-플랜지 코너 1개
            b_flange_flat = max(B - corner, 0.0)
        # 립: 끝단 자유, 플랜지-립 코너 1개
        d_lip_flat = max(D - corner, 0.0) if (has_lip and D > 0) else 0.0
        if h_web_flat > 0:
            props.setdefault('h_web', h_web_flat)
        if b_flange_flat > 0:
            props.setdefault('b_flange', b_flange_flat)
        if d_lip_flat > 0:
            props.setdefault('d_lip', d_lip_flat)

        # 해석적 fallback이 읽는 section dict(깊이/플랜지폭/립깊이/두께/유형 = out-to-out 치수)
        sect = params.get('section') or {}
        sect.setdefault('type', section_type)
        sect.setdefault('depth', H)
        sect.setdefault('flange_width', B)
        if D > 0:
            sect.setdefault('lip_depth', D)
        sect.setdefault('thickness', t)
        if R > 0:
            sect.setdefault('r', R)
        params['section'] = sect

        # DSM 값도 자동 계산
        if not params.get('dsm'):
            try:
                from engine.fsm_solver import stripmain
                from engine.dsm import extract_dsm_values
                from engine.stress import stresgen, yieldMP
                from cfsm.classify import classify
                from models.data import GBTConfig
                import numpy as np

                prop_mat = np.array([[100, 29500, 29500, 0.3, 0.3, 11300]])  # G per AISI §A3.1
                Fy = params.get('Fy', 35.53)

                node_p = node.copy()
                for n in node_p:
                    n[7] = Fy

                yield_vals = yieldMP(
                    node.copy(), Fy,
                    props['A'], props['xcg'], props['zcg'],
                    props['Ixx'], props['Izz'], props['Ixz'],
                    props['thetap'], props['I11'], props['I22'],
                )
                node_m = stresgen(
                    node.copy(),
                    P=0.0,
                    Mxx=yield_vals.get('Mxx_y', 0.0),
                    Mzz=0.0,
                    M11=0.0,
                    M22=0.0,
                    A=props['A'],
                    xcg=props['xcg'],
                    zcg=props['zcg'],
                    Ixx=props['Ixx'],
                    Izz=props['Izz'],
                    Ixz=props['Ixz'],
                    thetap=props['thetap'],
                    I11=props['I11'],
                    I22=props['I22'],
                    unsymm=1 if abs(props.get('Ixz', 0)) > 1e-9 else 0,
                )

                lengths = np.logspace(0, 3, 60)
                m_all = [np.array([1.0]) for _ in lengths]
                gbt_config = GBTConfig()
                result_p = stripmain(prop_mat, node_p, elem, lengths,
                                     np.array([]), np.array([]),
                                     gbt_config, 'S-S', m_all, neigs=10)
                result_m = stripmain(prop_mat, node_m, elem, lengths,
                                     np.array([]), np.array([]),
                                     gbt_config, 'S-S', m_all, neigs=10)

                class_p = classify(prop_mat, node_p, elem, lengths, result_p.shapes,
                                   gbt_config, 'S-S', m_all)
                class_m = classify(prop_mat, node_m, elem, lengths, result_m.shapes,
                                   gbt_config, 'S-S', m_all)

                dsmP = extract_dsm_values(
                    result_p.curve, node_p, elem, Fy, 'P',
                    mode_classifications=class_p)
                dsmM = extract_dsm_values(
                    result_m.curve, node_m, elem, Fy, 'Mxx',
                    mode_classifications=class_m)

                params['dsm'] = {
                    'Pcrl': dsmP.get('crl', 0),
                    'Pcrd': dsmP.get('crd', 0),
                    'Py': dsmP.get('P_y', 0),
                    'Mcrl': dsmM.get('crl', 0),
                    'Mcrd': dsmM.get('crd', 0),
                    'My': dsmM.get('P_y', 0),
                    'P_classification_method': dsmP.get('classification_method', 'none'),
                    'P_local_detected': dsmP.get('local_detected', False),
                    'P_dist_detected': dsmP.get('dist_detected', False),
                    'M_classification_method': dsmM.get('classification_method', 'none'),
                    'M_local_detected': dsmM.get('local_detected', False),
                    'M_dist_detected': dsmM.get('dist_detected', False),
                }
            except Exception as e:
                print(f'[StCFSD] Auto DSM failed: {e}')

        params['props'] = props
        params['node'] = node.tolist()
        params['elem'] = elem.tolist()

    except Exception as e:
        print(f'[StCFSD] Auto props failed: {e}')

    return params
