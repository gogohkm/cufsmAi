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
    compute_column_Fcre, compute_beam_Fcre, compute_beam_Fcre_detail,  # noqa: F401 (옛 이름 유지)
    CANONICAL_SECTION_NAMES, canonical_section_name,
)
from design.interaction import (
    combined_axial_bending, combined_bending_shear, combined_bending_shear_stiffened,
)
from design.shear import shear_strength, web_crippling, _web_crippling_detail  # noqa: F401
from design.connections import design_connection
from design.steel_grades import E, STEEL_GRADES
from design import member_checks as _mc
from design.checks import set_governing as _set_governing, apply_context as _apply_context, \
    display_rounding as _display_rounding

# 템플릿으로 단면 성질을 만든 실행의 내부 표지(입력이 아님) — 계산서 출처 'generated' 에만 쓴다.
_PROPS_GENERATED = '_props_generated'
# 하위 설계(압축 · 휨 · 인장)가 조합 검토에 넘기는 반올림하지 않은 설계강도(결과에는 남기지 않는다).
_RAW_DS = '_raw_design_strength'
# 랩 구간의 구속(계약 §6.3) — Design Manual 의 가정을 사람이 밝힌 것만 쓴다(횡비틀림 + 뒤틀림, 한 진술).
LAP_MANUAL_ASSUMPTION = ('AISI Design Manual Examples II-1A / II-2A: "The lapped section is assumed to be sufficiently '
                         'restrained against lateral-torsional buckling and distortional buckling" (assumption (f): '
                         '"the region at and near the interior supports is assumed to be not subject to '
                         'lateral-torsional or distortional buckling between the support and the ends of the laps")')
from design.notices import N as _nt, attach as _attach_notices, joined as _joined, prefixed as _prefixed  # noqa: E402
LAP_STATED = (_nt('member.assumption.f2_lap_region_lap_restrained', manual_quote=LAP_MANUAL_ASSUMPTION))
LAP_LTB_UNSTATED = (_nt('member.ne.f2_f2_lateral_torsional_buckling_3', manual_quote=LAP_MANUAL_ASSUMPTION))
LAP_DIST_UNSTATED = (_nt('member.ne.f4_f4_distortional_buckling_lap', manual_quote=LAP_MANUAL_ASSUMPTION))
LAP_DIST_STATED = LAP_STATED      # 옛 이름(2026-11-24 첫 판) — 같은 문장
# 구간 설계 · 랩 도구의 진술 입력. distortion_restrained 는 같은 뜻의 옛 이름(별칭)이다.
LAP_STATEMENT_KEYS = ('lap_restrained', 'distortion_restrained')


# 진술이 있는 랩 구간에서 쓰지 않는 dsm 값(F4 해당 없음) — 퍼린 경로가 단일 단면으로 계산해 넘긴다.
LAP_IGNORED_DSM = ('Mcrd', 'M_Lcrd', 'Lcrd')


def lap_restraint_stated(params: dict) -> bool:
    return any(params.get(k) is True for k in LAP_STATEMENT_KEYS)


# 반올림하지 않은 이용률(지배 이름 고르기용) — design_member 가 내보내기 전에 뺀다.
_UTIL_RAW = '_utilization_raw'
# 랩 구간에서 Lb = 0 을 사람의 진술(lap_restrained)로 정했다는 표지(계산 과정의 출처용, 결과에 나가지 않음)
_LAP_LB = '_lb_from_lap_restrained'
_LAP_LB_BOUND = '_lb_lap_upper_bound'
# global_buckling 이 '횡좌굴 없음'에 쓰는 표지값(1e6 ksi) — 이 값이면 끝없는 값(∞)이다.
_FCRE_INF = 1e6

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


_CANONICAL_SECTION_NAMES = CANONICAL_SECTION_NAMES  # 정규 이름 표 하나(global_buckling)


def _canonical_section_type(params: dict) -> str:
    """단면 표기를 하나의 정규 이름으로 모은다. 모르는 이름은 정규화된 원문을 돌려준다."""
    return canonical_section_name(_effective_section_type(params))


def _is_round_section(params: dict) -> bool:
    return _canonical_section_type(params) == 'CHS'


def _is_closed_section(params: dict) -> bool:
    return _canonical_section_type(params) in ('RHS', 'CHS')


def _supports_cz_plate_fallback(params: dict) -> bool:
    """현재 구현된 Appendix 1/2 폐형식 fallback의 단면 범위."""
    return _canonical_section_type(params) in ('C', 'TRACK', 'Z')


def _supports_cz_distortional_fallback(params: dict) -> bool:
    """Appendix 2 C/Z 플랜지-립 모델을 적용할 수 있는 단면인지 확인한다."""
    return _canonical_section_type(params) in ('C', 'Z')


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
    canon = _canonical_section_type(params)
    if canon == 'HAT':
        return _hat_geometry(params, props, section, t, R)
    depth = float(section.get('depth', 0) or params.get('H', 0) or 0)
    flange_o = float(section.get('flange_width', 0) or params.get('B', 0) or 0)
    # params['D'] 는 립 템플릿(lippedc/lippedz/lipped_angle/sigma)에서만 립 깊이다.
    # CHS 에서는 외경, hat 에서는 하부 플랜지 폭이므로 립으로 읽지 않는다.
    lip_from_D = params.get('D', 0) if canon in ('C', 'Z', 'LIPPEDANGLE', 'SIGMA') else 0
    lip_o = float(section.get('lip_depth', 0) or lip_from_D or 0)
    # 정의상 립이 없는 단면: 화면이 웹 절점에서 추정한 lip_depth 를 립으로 쓰지 않는다.
    no_lip_by_definition = canon in ('RHS', 'CHS', 'TRACK', 'ANGLE', 'TEE')
    if no_lip_by_definition:
        lip_o = 0.0
    corner = R + t if t > 0 else 0.0
    sec = _normalized_section_type(params)
    has_lip = (not no_lip_by_definition) and (
        lip_o > 0 or float(props.get('d_lip', 0) or 0) > 0)
    is_angle = 'ANGLE' in sec

    h_web = float(props.get('h_web', 0) or section.get('h_web', 0) or 0)
    if h_web <= 0 and depth > 0:
        h_web = max(depth - 2.0 * corner, 0.0)

    b_flange = float(props.get('b_flange', 0) or section.get('b_flange', 0) or 0)
    if b_flange <= 0 and flange_o > 0:
        # 폐단면(RHS) 플랜지는 양 웹 사이의 보강요소 — 코너 2개.
        n_corners = 2 if (has_lip and not is_angle) or canon == 'RHS' else 1
        b_flange = max(flange_o - n_corners * corner, 0.0)

    d_lip = 0.0 if no_lip_by_definition else float(
        props.get('d_lip', 0) or section.get('d_lip', 0) or 0)
    if d_lip <= 0 and lip_o > 0:
        d_lip = max(lip_o - corner, 0.0)

    # 립 정보가 명시되었는지(0 포함) — 뒤틀림 해당 여부 판정에서 "모름"과 "없음"을 가른다.
    lip_specified = no_lip_by_definition or ('d_lip' in props) or ('lip_depth' in section) \
        or (canon in ('C', 'Z', 'LIPPEDANGLE', 'SIGMA') and 'D' in params)

    return {
        'canonical_type': canon,
        'has_lip': bool(has_lip or d_lip > 0),
        'lip_specified': bool(lip_specified),
        't': t, 'R': R,
        'h_web': h_web, 'b_flange': b_flange, 'd_lip': d_lip,
        'depth': depth, 'flange_o': flange_o, 'lip_o': lip_o,
        'lip_angle': float(section.get('lip_angle', 0) or section.get('qlip', 0)
                           or params.get('qlip', 0) or 90.0),
        'n_f': int(section.get('n_f', params.get('n_f', 0)) or 0),
        'n_le': int(section.get('n_le', params.get('n_le', 0)) or 0),
        'n_w': int(section.get('n_w', params.get('n_w', 0)) or 0),
    }


def _hat_geometry(params: dict, props: dict, section: dict, t: float, R: float) -> dict:
    """hat: 템플릿 규약대로 H = 상판 외-외 폭, B = 전체 깊이(웹), D = 브림 폭(engine/template.py).

    이름 있는 인자(params 의 top_width/depth/brim 또는 section 의 top_width/hat_depth/brim)가
    우선이다. 없으면 section.depth/flange_width/lip_depth 를 화면이 지금 보내는 대로 템플릿
    H/B/D(상판 폭/깊이/브림)로 읽는다. 브림은 립이 아니라 비보강 플랜지다 — 립은
    `hat_lip_depth` 로만 받는다.
    """
    def _f(*vals):
        for v in vals:
            try:
                if v is not None and float(v) > 0:
                    return float(v)
            except (TypeError, ValueError):
                continue
        return 0.0
    top = _f(section.get('top_width'), params.get('top_width'), section.get('depth'), params.get('H'))
    depth = _f(section.get('hat_depth'), params.get('depth'), section.get('flange_width'), params.get('B'))
    brim = _f(section.get('brim'), params.get('brim'), section.get('lip_depth'), params.get('D'))
    lip = _f(section.get('hat_lip_depth'), params.get('hat_lip_depth'))
    corner = R + t if t > 0 else 0.0
    have_dims = depth > 0 and top > 0
    h_web = max(depth - 2.0 * corner, 0.0) if have_dims else float(props.get('h_web', 0) or 0)
    b_top = max(top - 2.0 * corner, 0.0) if have_dims else float(props.get('b_flange', 0) or 0)
    brim_flat = max(brim - (2.0 if lip > 0 else 1.0) * corner, 0.0) if brim > 0 else 0.0
    d_lip = max(lip - corner, 0.0) if lip > 0 else 0.0
    named = bool(section.get('top_width') or params.get('top_width') or section.get('hat_depth'))
    return {
        'canonical_type': 'HAT',
        'has_lip': d_lip > 0,
        'lip_specified': True,
        't': t, 'R': R,
        'h_web': h_web, 'b_flange': b_top, 'd_lip': d_lip,
        'depth': depth, 'flange_o': top, 'lip_o': lip,
        'brim_o': brim, 'brim_flat': brim_flat, 'n_webs': 2,
        'hat_dims_from': 'named' if named else 'template H/B/D',
        'lip_angle': 90.0,
        'n_f': int(section.get('n_f', params.get('n_f', 0)) or 0),
        'n_le': int(section.get('n_le', params.get('n_le', 0)) or 0),
        'n_w': int(section.get('n_w', params.get('n_w', 0)) or 0),
    }


def _zero_demand_not_applicable(checks: list) -> None:
    """소요가 없는 한계상태(FIXES §3.1, V6b-03): 다른 소요가 있어 무엇이든 평가했으면 그 한계상태는 해당 없음이다
    (예: Mu = 0 · Vu > 0 이면 F2–F4 는 not_applicable). 소요가 하나도 없을 때만 not_evaluated(소요 없음)로 둔다 —
    엔진의 pass 와 같은 규칙."""
    if not any(c['verdict'] in ('pass', 'fail') and c.get('counts', True) for c in checks):
        return
    groups = set()
    for c in checks:
        if c['verdict'] == 'not_evaluated' and str(c.get('reason') or '').startswith('no required'):
            c['verdict'] = 'not_applicable'
            c['reason'] = _joined(' — ', [c['reason'], _nt('member.reason.no_demand_this_limit_state')])
            c.pop('mirrors', None)
            groups.add(c['group'])
    for g in groups:
        _set_governing([c for c in checks if c['group'] == g])


# 계약 §6.4 주 소요: 설계 결과는 설계하는 것의 주 소요를 주고 평가했을 때만 합격할 수 있다.
# 무리마다 하나 이상을 주어야 한다(조합: 축력과 모멘트 하나). 0 은 zero_demand_stated = true 일 때만 0 이다.
_MAIN_DEMAND = {
    'flexure': (('Mu',),),
    'compression': (('Pu',),),
    'tension': (('Tu',),),
    'combined': (('Pu',), ('Mux', 'Muy')),
}
# 그 주 소요 없이는 판정할 수 없는 검토(id, '.' 으로 끝나면 접두). 정모멘트 구간(Mu_pos)은 Mu 를 쓰지 않는다.
_BENDING_NEEDS = ('member.flexure.', 'member.bending_shear', 'member.bending_web_crippling')
_NEEDS_MAIN = {
    'Mu': _BENDING_NEEDS,
    'Mux': _BENDING_NEEDS + ('member.axial_bending', 'member.tension_bending.'),
    'Pu': ('member.compression.', 'member.tension.', 'member.axial_bending', 'member.tension_bending.'),
    'Tu': ('member.tension.',),
}
_NEEDS_NOT = ('member.flexure.positive_region',)


def _main_demand_gaps(params: dict, member_type: str) -> list:
    """주 소요 무리 중 채워지지 않은 것: [(무리 첫 키, 'missing' | 'zero', 입력 이름 글)]."""
    stated = params.get('zero_demand_stated') is True
    gaps = []
    for grp in _MAIN_DEMAND.get(member_type, ()):
        vals = {k: params.get(k) for k in grp}
        given = [k for k in grp if vals[k] is not None]
        nonzero = False
        for k in given:
            try:
                nonzero = nonzero or float(vals[k]) != 0.0
            except (TypeError, ValueError):
                nonzero = True     # 수가 아닌 값은 여기서 다루지 않는다
        if nonzero or (given and stated):
            continue
        gaps.append((grp[0], 'zero', ', '.join(given)) if given else (grp[0], 'missing', ' / '.join(grp)))
    return gaps


def _main_demand_rule(result: dict, params: dict, member_type: str, checks: list) -> None:
    """주 소요가 없거나 밝히지 않은 0 이면: 그것을 쓰는 검토는 판정 없음(합격 → 미평가, 해당 없음(소요 없음) → 미평가,
    불합격은 그대로 — 준 소요로 이미 넘으면 전체 소요로도 넘는다), 결과는 합격이 아니다(not_evaluated 에 적는다).
    소요가 하나도 없어 아무것도 평가하지 않았으면 이미 판정 없음이라 그대로 둔다."""
    gaps = _main_demand_gaps(params, member_type)
    if not gaps or not any(c['verdict'] in ('pass', 'fail') and c.get('counts', True) for c in checks):
        return
    groups = set()
    for i, c in enumerate(checks):
        cid = c.get('id') or ''
        if cid in _NEEDS_NOT:
            continue
        hit = [g for g in gaps if any(cid.startswith(p) if p.endswith('.') else cid == p for p in _NEEDS_MAIN[g[0]])]
        if not hit:
            continue
        why = [(_nt('member.reason.main_demand_not_given', inputs=txt) if kind == 'missing'
                else _nt('member.reason.main_demand_zero_not_stated', inputs=txt)) for _k, kind, txt in hit]
        reason = why[0] if len(why) == 1 else _joined('; ', why)
        inputs = ', '.join(txt for _k, _kind, txt in hit)
        if c['verdict'] == 'fail':
            c = dict(c, demand_incomplete=[txt for _k, _kind, txt in hit],
                     reason=_joined('; ', [r for r in (c.get('reason'), _nt('member.reason.fail_with_incomplete_demand',
                                                                            inputs=inputs)) if r]))
        elif c['verdict'] == 'pass':
            c = _mc.demote_to_not_evaluated(c, reason)
        elif str(c.get('reason') or '').startswith('no required'):
            c = dict(c, verdict='not_evaluated', reason=reason)
            c.pop('mirrors', None)
        else:
            continue       # 다른 까닭으로 해당 없음 · 미평가(예: 랩 구속 진술의 §F4)는 그대로
        checks[i] = c
        groups.add(c['group'])
    for g in groups:
        _set_governing([c for c in checks if c['group'] == g])
    for _k, kind, txt in gaps:
        _mark_not_evaluated(result, _nt('member.ne.main_demand_not_given', inputs=txt) if kind == 'missing'
                            else _nt('member.ne.main_demand_zero_not_stated', inputs=txt))


def _governing_check_id(checks: list, group: str, value) -> str | None:
    """하위 설계의 설계강도(Pa · Max · Ta)는 그 무리에서 설계강도가 가장 작은 모드의 값이다 — 그 항목의 id."""
    if value is None:
        return None
    cands = [c for c in checks if c.get('group') == group and (c.get('capacity') or {}).get('value') is not None]
    best = min(cands, key=lambda c: abs(c['capacity']['value'] - value), default=None)
    if best is not None and abs(best['capacity']['value'] - value) <= 1e-9 * max(abs(value), 1.0):
        return best['id']
    return None


def _merge_governing_check(result: dict, check: dict, name: str,
                            normalized_ratio: float | None = None) -> None:
    """한계상태 결과를 최상위 pass/utilization에 병합한다."""
    if normalized_ratio is None:
        normalized_ratio = check.get('total')
    if normalized_ratio is not None and math.isfinite(float(normalized_ratio)):
        # 지배 이름은 반올림하지 않은 이용률로 고른다(utilization 키는 표시용 4자리, V6-14).
        current = result.get(_UTIL_RAW, result.get('utilization'))
        if current is None or float(normalized_ratio) > float(current):
            result['utilization'] = round(float(normalized_ratio), 4)
            result[_UTIL_RAW] = float(normalized_ratio)
            result['governing_check'] = name
    passed = check.get('pass')
    if passed is False:
        result['pass'] = False
    elif passed is True and result.get('pass') is None and not result.get('not_evaluated'):
        result['pass'] = True
    result.setdefault('limit_state_checks', []).append({
        'name': name,
        'ratio': (round(float(normalized_ratio), 4)
                  if normalized_ratio is not None and math.isfinite(float(normalized_ratio))
                  else normalized_ratio),
        'pass': passed,
    })


def _finalize_verdict(result: dict) -> None:
    """판정 규칙: 불합격이 이기고, 해당하는데 평가하지 못한 한계상태가 있으면 판정 없음(None)."""
    if result.get('not_evaluated'):
        result['utilization_valid'] = False
        if result.get('pass') is not False:
            result['pass'] = None


def _mark_not_evaluated(result: dict, name: str, warning: str | None = None) -> None:
    """해당하는데 평가하지 못한 한계상태(또는 가정한 입력으로만 평가한 것)를 기록한다."""
    items = result.setdefault('not_evaluated', [])
    if name not in items:
        items.append(name)
    if warning:
        warnings = result.setdefault('warnings', [])
        if warning not in warnings:
            warnings.append(warning)
    _finalize_verdict(result)


def _dsm_diagnostics(dsm: dict, prefix: str) -> dict:
    """engine.dsm.extract_dsm_values 의 진단 키(P_/M_ 접두 또는 접두 없음)를 모은다."""
    def _g(key, default=None):
        if prefix + key in dsm:
            return dsm[prefix + key]
        return dsm.get(key, default)
    return {
        'single_minimum': bool(_g('single_minimum', False)),
        'bound': float(_g('single_minimum_bound') or 0.0),
        'boundary_minimum': bool(_g('boundary_minimum', False)),
        'ref_consistent': _g('reference_stress_consistent'),
        'ref_unsymm': _g('reference_unsymm'),
        'warnings': [w if isinstance(w, str) else str(w) for w in (_g('warnings') or [])],
    }


def _apply_fsm_diagnostics(diag: dict, warnings: list, not_evaluated: list, tag: str,
                           local_from_fsm: bool, dist_from_fsm: bool,
                           local_name: str, dist_name: str,
                           assumptions: list | None = None) -> None:
    """FSM 값의 신뢰 조건: 격자 하한 극소와 기준 응력 불일치는 해당 한계상태를 미평가로.

    dsm 이 남긴 설명(극소 배정·분류 방법)은 값을 바꾸지 않으므로 assumptions 로 보낸다.
    """
    sink = assumptions if assumptions is not None else warnings
    for w in diag['warnings']:
        msg = _prefixed(f'[DSM {tag}] ', w)
        if msg not in sink:
            sink.append(msg)
    if diag['boundary_minimum'] and local_from_fsm:
        not_evaluated.append(_nt('member.ne.fsm_minimum_at_shortest', local_name=local_name))
        warnings.append(_nt('member.warning.dsm_local_minimum_at_first_length', tag=tag))
    if diag['ref_consistent'] is False:
        if local_from_fsm:
            not_evaluated.append(_nt('member.ne.fsm_reference_stress_inconsistent', local_name=local_name))
        if dist_from_fsm:
            not_evaluated.append(_nt('member.ne.fsm_reference_stress_inconsistent_2', dist_name=dist_name))
        warnings.append(_nt('member.warning.dsm_fsm', tag=tag))
    if tag == 'M' and diag.get('ref_unsymm') == 1 and (local_from_fsm or dist_from_fsm):
        # 비구속 휨 응력의 Mcr(P_ref = 비구속 첫 항복)은 구속 My = Sf·Fy 와 같은 기준이 아니다.
        if local_from_fsm:
            not_evaluated.append(_nt('member.ne.fsm_from_unrestrained_bending', local_name=local_name))
        if dist_from_fsm:
            not_evaluated.append(_nt('member.ne.fsm_from_unrestrained_bending_2', dist_name=dist_name))
        warnings.append(_nt('member.warning.f3_dsm_mcrl_mcrd_unsymm'))


def _out_to_out_dims(geom: dict) -> tuple:
    """Appendix 2 해석식(local_params/distortional_params)의 계약인 외-외 치수(ho, bo, do).

    템플릿/화면의 외-외 치수가 있으면 그것을, 없으면 평탄폭에 코너분을 되더해 복원한다
    (_section_geometry 의 외-외 → 평탄 환산의 역).
    """
    t, R = geom['t'], geom['R']
    corner = R + t if t > 0 else 0.0
    lipped = geom['d_lip'] > 0 or geom['lip_o'] > 0
    ho = geom['depth'] if geom['depth'] > 0 else (
        geom['h_web'] + 2.0 * corner if geom['h_web'] > 0 else 0.0)
    bo = geom['flange_o'] if geom['flange_o'] > 0 else (
        geom['b_flange'] + (2.0 if lipped else 1.0) * corner if geom['b_flange'] > 0 else 0.0)
    do = geom['lip_o'] if geom['lip_o'] > 0 else (
        geom['d_lip'] + corner if geom['d_lip'] > 0 else 0.0)
    return ho, bo, do


def _distortional_applicability(geom: dict) -> tuple:
    """§E4/§F4 해당 여부를 단면 형상으로 정한다 (연단 보강 플랜지가 있는 개단면만 해당).

    Returns (applicable, reason). 형상으로 배제할 수 없으면 해당하는 것으로 본다.
    """
    canon = geom['canonical_type']
    if canon in ('RHS', 'CHS'):
        return False, 'closed section'
    if canon in ('TRACK', 'ANGLE', 'TEE'):
        return False, 'no edge-stiffened flanges'
    if geom['has_lip']:
        return True, 'edge-stiffened flanges'
    if canon in ('C', 'Z', 'LIPPEDANGLE', 'SIGMA'):
        if geom['lip_specified']:
            return False, 'lip depth = 0'
        return True, 'lipped section type'
    if canon in ('HAT', 'I'):
        return False, 'no edge stiffener given'
    if geom['lip_specified']:
        return False, 'lip depth = 0'
    return True, 'section type unknown — not excluded'


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
    canon = _canonical_section_type({'section_type': section_type or section.get('type') or 'C'})
    if st in ('i', 'i_section', 'isect') or canon == 'I':
        return 'built_up_i'
    # 'lippedz' 등 Z 표기를 C 표(G5-2)로 보내지 않는다.
    if st.startswith('z') or canon == 'Z':
        return 'Z'
    if st.startswith('hat') or canon == 'HAT':
        return 'hat'
    if st.startswith('track') or canon == 'TRACK':
        return 'C'

    web_count = section.get('web_count')
    try:
        if web_count is not None and int(float(web_count)) >= 3:
            return 'multi_web'
    except (ValueError, TypeError):
        # 비숫자 web_count는 무시하고 아래 기본 'C'로 분류 (호출자 입력 오류는
        # _validate_section_keys가 별도 경고 — 조용한 오분류 방지).
        pass
    return 'C'


def _infer_web_crippling_n_webs(params: dict, section_family: str) -> int | None:
    """Infer n_webs only for families where total strength depends on it."""
    explicit = params.get('wc_n_webs')
    if explicit not in (None, ''):
        try:
            return int(float(explicit))
        except (ValueError, TypeError):
            return None

    section = params.get('section', {}) or {}
    web_count = section.get('web_count')
    if section_family == 'hat':
        try:
            return max(2, int(float(web_count))) if web_count is not None else 2
        except (ValueError, TypeError):
            return 2
    if section_family == 'multi_web':
        try:
            return max(2, int(float(web_count))) if web_count is not None else None
        except (ValueError, TypeError):
            return None
    return None


def _validate_section_keys(params: dict) -> list:
    """형상 추론 키(web_count/wc_n_webs/wc_section_family) 명시적 검증 (P2).

    _infer_* 폴백이 조용히 기본값을 선택하기 전에, 비숫자·음수 등
    호출자 입력 오류를 경고로 표면화한다.
    """
    warnings = []
    section = params.get('section', {}) or {}
    wc = section.get('web_count')
    if wc is not None:
        try:
            if int(float(wc)) < 1:
                warnings.append(
                    _nt('member.warning.section_web_count_family', wc=wc))
        except (ValueError, TypeError):
            warnings.append(
                _nt('member.warning.section_web_count_family_2', wc=wc))
    nw = params.get('wc_n_webs')
    if nw not in (None, ''):
        try:
            if int(float(nw)) < 1:
                warnings.append(_nt('member.warning.wc_webs', nw=nw))
        except (ValueError, TypeError):
            warnings.append(_nt('member.warning.wc_webs_2', nw=nw))
    return warnings


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

    member_type = params.get('member_type', 'compression')

    # F17: 접합부는 단면성질/DSM이 필요 없으므로 자동 생성보다 먼저 분기한다.
    # (generate_section/stripmain/DSM 호출 없음 — 접합 업무 계산 비용만 발생)
    if member_type == 'connection':
        return design_connection(params)

    if member_type not in ('compression', 'flexure', 'combined', 'tension'):
        return {'error': f'Unknown member_type: {member_type}'}

    # 설계 Fy 는 모든 강도식의 기준이다 — 기본값으로 채우지 않는다.
    try:
        _fy_in = float(params.get('Fy')) if params.get('Fy') is not None else 0.0
    except (TypeError, ValueError):
        _fy_in = 0.0
    if _fy_in <= 0:
        return {'error': 'Fy (design yield stress, ksi) is required and must be > 0.',
                'member_type': member_type}

    # 단면 성질이 없으면 기본 단면으로 대체하지 않는다. 템플릿 치수가 모두 명시된
    # 경우에만 단면을 생성하고, 그 사실을 결과에 남긴다.
    auto_section = None
    auto_warnings = []
    if not params.get('props') or not params['props'].get('A'):
        missing = _missing_template_dims(params)
        if missing:
            return {
                'error': ('Section properties missing: props.A is absent or zero, and the section '
                          'cannot be generated because ' + ', '.join(missing) + ' is not given. '
                          'Pass props (A, Sf, rx, ry, J, Cw, xo, ...) from get_section_properties/cutwp, '
                          'or section_type with all template dimensions.'),
                'member_type': member_type,
            }
        params = _auto_generate_props(params)
        params[_PROPS_GENERATED] = True   # 계산서: 단면 성질의 출처를 '템플릿 자동 생성'으로
        auto_section = params.pop('_auto_section', None)
        auto_warnings = params.pop('_auto_warnings', [])
        if params.get('_auto_error') or not (params.get('props') or {}).get('A'):
            return {'error': f"Section generation failed: {params.get('_auto_error', 'A=0')}",
                    'member_type': member_type}

    if member_type == 'compression':
        result = _design_compression(params)
    elif member_type == 'flexure':
        result = _design_flexure(params)
    elif member_type == 'combined':
        result = _design_combined(params)
    else:
        result = _design_tension(params)

    if 'error' in result:
        return result

    result.setdefault('warnings', [])
    result.setdefault('assumptions', [])
    result.setdefault('scope_notes', [])
    if auto_section is not None:
        result['auto_generated_section'] = auto_section
        result['section_source'] = 'auto-template'
        result['assumptions'].append(
            _nt('member.assumption.section_from_template', auto_section=auto_section))
    for _w in auto_warnings:
        if _w not in result['warnings']:
            result['warnings'].append(_w)
    if not params.get('section_type') and not (params.get('section') or {}).get('type'):
        result['assumptions'].append(
            _nt('member.assumption.e2_section_type_e2_f2'))

    # DSM 적용 한계 검증 — Table B4.1-1 은 Chapters E~H 에만 해당한다(인장 D장 제외).
    b4_items = []
    if member_type != 'tension':
        dsm_warnings = check_dsm_limits(params, member_type=member_type, _items=b4_items)
        if dsm_warnings:
            result['dsm_warnings'] = dsm_warnings
            # §B3.3 / §B4.2: Table B4.1-1 한계를 벗어난 부재는 Chapters E~H의
            # φ/Ω를 그대로 쓸 수 없다(A1.2(c) 합리적 해석 또는 K2 시험으로 재정립).
            # 불합격은 그대로 두고, 합격만 '판정 없음'으로 내린다.
            result['b4_limits_exceeded'] = True
            _mark_not_evaluated(
                result, _nt('member.ne.b4_1_b4_limits_chapters_applicable'),
                _nt('member.warning.b3_3_b3_b4_b4_chapters'))

    # 구현하지 않은 조항 — 해당할 수 있으면 사용자에게 보인다.
    result['not_checked'] = _not_checked_provisions(params, member_type)
    _not_implemented_warnings(result, params, member_type)
    for key in ('warnings', 'assumptions', 'scope_notes'):
        result[key] = list(dict.fromkeys(result.get(key) or []))
    result['spec_sections'] = sorted(set(result.get('spec_sections') or []))
    _finalize_verdict(result)

    checks = result.setdefault('design_checks', [])
    if member_type != 'tension':
        b4 = _mc.b4_check(params['design_method'], b4_items, result.get('dsm_warnings') or [],
                          bool(result.get('b4_limits_exceeded')), params.get(_PROPS_GENERATED))
        checks.append(b4)
        _set_governing([b4])
    _main_demand_rule(result, params, member_type, checks)
    _zero_demand_not_applicable(checks)
    _apply_context(checks, params)
    # 옛 계산서 단계(steps[])의 1e6 ksi 는 '횡좌굴 없음(∞)'의 표지다 — 값은 화면 비교용으로 두고 옆에 표시(V6-16).
    for st in result.get('steps') or []:
        if isinstance(st, dict) and st.get('value') == _FCRE_INF:
            st['unbounded'] = True

    result.pop(_RAW_DS, None)
    result.pop(_UTIL_RAW, None)
    result['display_rounding'] = _display_rounding('member')
    result['report'] = generate_report(result, params)
    _attach_notices(result)
    return result


def _missing_template_dims(params: dict) -> list:
    """자동 단면 생성에 필요한데 빠진 입력 이름 목록."""
    st = str(params.get('section_type') or '').strip()
    if not st:
        return ['section_type']
    canon = _canonical_section_type({'section_type': st})
    if canon == 'CHS':
        need = ('OD' if params.get('OD') else 'D', 't')
    elif canon == 'HAT' and params.get('top_width'):
        need = ('top_width', 'depth', 'brim', 't')
    elif canon in ('C', 'Z', 'LIPPEDANGLE', 'HAT', 'SIGMA'):
        need = ('H', 'B', 'D', 't')
    else:
        need = ('H', 'B', 't')
    missing = []
    for k in need:
        try:
            if not params.get(k) or float(params.get(k)) <= 0:
                missing.append(k)
        except (TypeError, ValueError):
            missing.append(k)
    return missing


def _not_checked_provisions(params: dict, member_type: str) -> list:
    """이 도구가 구현하지 않은 조항 중 이 부재에 해당할 수 있는 것."""
    canon = _canonical_section_type(params)
    items = []
    if member_type in ('compression', 'flexure', 'combined'):
        items.append(_nt('member.scope.not_checked_holes'))
    if member_type in ('compression', 'combined') and canon == 'RHS':
        items.append(_nt('member.scope.not_checked_e2_1_1_closed_box_rr'))
    if member_type in ('flexure', 'combined'):
        if canon in ('ANGLE', 'LIPPEDANGLE', 'HAT', 'TEE'):
            items.append(_nt('member.scope.not_checked_f2_1_2_ltb_this_shape'))
        if canon not in ('RHS', 'CHS', 'Z', 'I'):
            items.append(_nt('member.scope.not_checked_h4_bending_torsion'))
        if not params.get('transverse_stiffeners'):
            items.append(_nt('member.scope.not_checked_h2_2_stiffened_webs'))
        items.append(_nt('member.scope.not_checked_weak_axis_dsm_flexure'))
        if not (params.get('wc_N') or 0) > 0 and canon not in ('RHS', 'CHS', 'ANGLE', 'TEE'):
            items.append(_nt('member.scope.not_checked_g5_h3_no_bearing_length'))
    if member_type == 'combined':
        items.append(_nt('member.scope.not_checked_c1_b2_sway'))
    if member_type == 'tension':
        items.append(_nt('member.scope.not_checked_d1_connection_governed'))
    return items


def _not_implemented_warnings(result: dict, params: dict, member_type: str) -> None:
    """입력과 무관하게 늘 참인 범위 진술 — warnings 가 아니라 scope_notes(FIXES §3.1.1)."""
    canon = _canonical_section_type(params)
    w = result.setdefault('scope_notes', [])

    def _add(msg):
        if msg not in w:
            w.append(msg)

    if member_type in ('compression', 'flexure', 'combined'):
        _add(_nt('member.scope.e2_5_e2_e3_e4_f2'))
    if member_type in ('compression', 'combined') and canon == 'RHS':
        _add(_nt('member.scope.e2_1_1_e2_kl_l0_rr'))
    if member_type in ('flexure', 'combined') and canon not in ('RHS', 'CHS', 'Z', 'I'):
        _add(_nt('member.scope.h4_torsion_not_implemented'))
    if member_type == 'combined':
        _add(_nt('member.scope.c1_c1_b2'))
    if member_type == 'tension':
        _add(_nt('member.scope.d1_d1_chapter_j6'))


# ============================================================
# DSM 적용 한계 검증 (Table B4.1-1)
# ============================================================

def check_dsm_limits(params: dict, member_type: str = None, _items: list | None = None) -> list:
    """DSM 적용 한계 검증 (AISI S100-16 Table B4.1-1)

    member_type: 'compression' / 'flexure' / 'combined' / 'tension' — 웹 한계가
    응력 상태에 따라 달라지므로 전달한다. 휨/조합 부재의 웹은 응력 구배 하에 있어
    Table B4.1-1 '응력 구배 하의 보강 요소(웹)' 행의 DSM 한계 h/t ≤ 300이 적용된다.
    압축(균일 응력) 부재의 보강 요소는 w/t ≤ 500이다.

    참고: EWM 하위 한계(무보강 웹 <200, 보강 시 ≤260/≤300)는 본 도구가 DSM 기반이므로
    구현하지 않는다.

    Returns: list of warnings (빈 리스트면 모두 통과)
    _items: 주면 검토한 한계마다 {label, num, den, ratio, limit, row, ok} 를 채운다(계산서용, 값 불변).
    """
    def _rec(label, num, den, ratio, limit, row, ok, strict=False):
        if _items is not None:
            _items.append({'label': label, 'num': num, 'den': den, 'ratio': ratio, 'limit': limit, 'row': row,
                           'ok': bool(ok), 'strict': strict})
    Fy = params.get('Fy')   # 없으면 Fy 한계 줄만 건너뛴다 — 강종을 짐작하지 않는다
    geom = _section_geometry(params)
    t = geom['t']
    if _is_round_section(params):
        # 원형관: Table B4.1-1 에 D/t 행이 없다(§F2.3 자체 한계로 검토). 판요소 기하는 쓰지 않는다.
        geom = {**geom, 'h_web': 0.0, 'b_flange': 0.0, 'd_lip': 0.0, 'lip_o': 0.0, 'flange_o': 0.0}
    if member_type is None:
        member_type = params.get('member_type', 'compression')
    warnings = []

    # Table B4.1-1 은 Chapters E~H 부재 설계의 한계다 — 인장(D장)에는 적용하지 않는다.
    if member_type == 'tension':
        return warnings
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
            _rec('web h/t', ('h', h_web, 'length'), ('t', t, 'length'), wt_web, 300,
                 'stiffened element in bending (web)', wt_web <= 300)
            if wt_web > 300:
                warnings.append(
                    _nt('member.warning.table_b4_1_1_web_b4_stiffened_element', wt_web=wt_web)
                )
        else:
            _rec('web w/t', ('w', h_web, 'length'), ('t', t, 'length'), wt_web, 500,
                 'stiffened element in compression (web)', wt_web <= 500)
            if wt_web > 500:
                warnings.append(
                    _nt('member.warning.table_b4_1_1_web_b4_stiffened_element_2', wt_web=wt_web)
                )

    # 플랜지: 요소 종류별 한계 (Table B4.1-1)
    #  - 연단보강(립 있음) b/t ≤ 160
    #  - 보강(폐단면·hat 상부판처럼 양단이 웹에 지지) w/t ≤ 500
    #  - 비보강(립 없는 개단면: 트랙·앵글 다리·I/T 플랜지 돌출부) d/t ≤ 60
    b_flange = geom['b_flange']
    canon = geom['canonical_type']
    if b_flange > 0:
        if canon in ('RHS', 'HAT'):
            bt_fl = b_flange / t
            _rec('flange w/t', ('w', b_flange, 'length'), ('t', t, 'length'), bt_fl, 500,
                 'stiffened element in compression (flange)', bt_fl <= 500)
            if bt_fl > 500:
                warnings.append(
                    _nt('member.warning.table_b4_1_1_flange_b4_stiffened_element', bt_fl=bt_fl))
        elif geom['has_lip']:
            bt_fl = b_flange / t
            _rec('flange b/t', ('b', b_flange, 'length'), ('t', t, 'length'), bt_fl, 160,
                 'edge-stiffened element', bt_fl <= 160)
            if bt_fl > 160:
                warnings.append(_nt('member.warning.table_b4_1_1_flange_b4_edge_stiffened', bt_fl=bt_fl))
        elif canon != 'CHS':
            # I·T 는 웹 양쪽 돌출부가 각각 비보강요소다.
            d_out = b_flange / 2.0 if canon in ('I', 'TEE') else b_flange
            bt_fl = d_out / t
            _rec('flange outstand d/t', ('d', d_out, 'length'), ('t', t, 'length'), bt_fl, 60,
                 'unstiffened element in compression', bt_fl <= 60)
            if bt_fl > 60:
                warnings.append(
                    _nt('member.warning.table_b4_1_1_flange_b4_unstiffened_element', bt_fl=bt_fl))

    # hat 브림: 비보강 요소 d/t ≤ 60
    if geom.get('brim_flat', 0) > 0:
        _rec('brim d/t', ('d', geom['brim_flat'], 'length'), ('t', t, 'length'), geom['brim_flat'] / t, 60,
             'unstiffened element in compression (brim)', geom['brim_flat'] / t <= 60)
    if geom.get('brim_flat', 0) > 0 and geom['brim_flat'] / t > 60:
        warnings.append(_nt('member.warning.table_b4_1_1_brim_b4_unstiffened_element', value=geom['brim_flat'] / t))

    # 비보강 요소 (립): d/t ≤ 60
    d_lip = geom['d_lip']
    if d_lip > 0:
        dt_lip = d_lip / t
        _rec('lip d/t', ('d', d_lip, 'length'), ('t', t, 'length'), dt_lip, 60, 'unstiffened element (lip)',
             dt_lip <= 60)
        if dt_lip > 60:
            warnings.append(_nt('member.warning.table_b4_1_1_lip_b4_unstiffened_limit', dt_lip=dt_lip))

    # 코너 반경: R/t ≤ 20
    R = geom['R']
    if R > 0:
        Rt = R / t
        _rec('corner R/t', ('R', R, 'length'), ('t', t, 'length'), Rt, 20, 'inside bend radius', Rt <= 20)
        if Rt > 20:
            warnings.append(_nt('member.warning.table_b4_1_1_corner_b4_corner_limit', Rt=Rt))

    # 단순 연단보강재 길이/플랜지폭: do/bo ≤ 0.7
    lip_o = geom['lip_o'] or d_lip
    flange_o = geom['flange_o'] or b_flange
    if lip_o > 0 and flange_o > 0:
        do_bo = lip_o / flange_o
        _rec('simple edge stiffener do/bo', ('do', lip_o, 'length'), ('bo', flange_o, 'length'), do_bo, 0.7,
             'simple lip edge stiffener', do_bo <= 0.7)
        if do_bo > 0.7:
            warnings.append(
                _nt('member.warning.table_b4_1_1_simple_edge_stiffener_b4', do_bo=do_bo)
            )

    # 중간/연단 보강재 개수
    if geom['n_f'] > 4:
        warnings.append(_nt('member.warning.table_b4_1_1_b4_flange_intermediate_stiffener', n_f=geom["n_f"]))
    if geom['n_le'] > 2:
        warnings.append(_nt('member.warning.table_b4_1_1_le_b4_edge_stiffener', n_le=geom["n_le"]))
    if geom['n_w'] > 4:
        warnings.append(_nt('member.warning.table_b4_1_1_b4_web_intermediate_stiffener', n_w=geom["n_w"]))

    # 항복강도: Fy < 95 ksi (표의 부등호는 strict)
    if Fy is not None:
        _rec('Fy', ('Fy', Fy, 'stress'), None, Fy, 95, 'yield stress limit (§B4.1)', Fy < 95, strict=True)
    if Fy is not None and Fy >= 95:
        warnings.append(_nt('member.warning.table_b4_1_1_fy_ksi_b4_fy', Fy=Fy))

    return warnings


# ============================================================
# 압축 부재 설계
# ============================================================

def _design_compression(params: dict) -> dict:
    """DSM 압축 부재 설계 (§E2, §E3.2, §E4)"""
    Fy = params['Fy']   # design_member 가 Fy > 0 을 확인한다 — 기본 강종으로 채우지 않는다
    design_method = params.get('design_method', 'LRFD')
    Pu = params.get('Pu', 0)

    # 단면 성질 (외부에서 전달)
    props = _plain_scalars(params.get('props', {}) or {})
    Ag = float(props.get('A', 0) or 0)
    if Ag <= 0:
        return {'error': 'Section properties not available (A=0)'}
    Fy = float(Fy)

    # §E2 분기 판정용 section_type 주입: compute_column_Fcre는 props['section_type']로
    # 점대칭(Z, §E2.3)/폐합(§E2.1)을 분류한다. 표기 변형('C-section', 'lippedz' 등)이
    # 압축·휨에서 서로 다르게 인식되지 않도록 정규 이름을 넘긴다.
    props = dict(props)
    props.setdefault('section_type', _canonical_section_type(params))
    geom = _section_geometry(params)

    # DSM 값 (외부에서 전달 — get_dsm_values 결과). Pcrl·Pcrd 는 탄성 임계하중이라 Fy 와 무관하다.
    # 분류 문자열(classification_method)이나 *_detected=False 로 모드의 "부재"를 추론하지
    # 않는다 — 극소가 분리되지 않았다는 뜻일 뿐이다(Appendix 2 §2.2).
    dsm = params.get('dsm', {}) or {}
    Pcrl = float(dsm.get('Pcrl', 0) or 0)
    Pcrd = float(dsm.get('Pcrd', 0) or 0)
    Py_dsm = float(dsm.get('Py', 0) or 0)
    diag = _dsm_diagnostics(dsm, 'P_')

    steps = []
    spec_sections = []
    warnings = []
    assumptions = []
    not_evaluated = []

    Fcre_override = float(params.get('Fcre', 0) or 0)

    # 유효좌굴길이: 빠진 길이마다 120 in 으로 두되, 그 값으로 낸 E2 결과는 판정에 쓰지 않는다.
    missing_len = [k for k in ('KxLx', 'KyLy', 'KtLt') if params.get(k) is None]
    KxLx = params.get('KxLx') if params.get('KxLx') is not None else 120
    KyLy = params.get('KyLy') if params.get('KyLy') is not None else 120
    KtLt = params.get('KtLt') if params.get('KtLt') is not None else 120
    if missing_len:
        warnings.append(
            _nt('member.warning.effective_length_defaulted_verify',
                items=_joined(', ', [_nt('member.fragment.length_default_item', symbol=k) for k in missing_len])))
        if Fcre_override <= 0:
            not_evaluated.append(_nt('member.ne.e2_e2_global_buckling_assumed', missing_len='/'.join(missing_len)))

    if Pcrl == 0 and Pcrd == 0:
        warnings.append(
            _nt('member.warning.pcrl_pcrd_fsm_run')
        )

    # Step 1: Py = Ag·Fy (Eq. E4.1-4) — 설계 Fy 로 산정한다. DSM 의 Py 는 해석 fy 기준이므로
    # 비교만 한다(Pcrl·Pcrd 는 절대값이라 그대로 쓴다).
    Py = Ag * Fy
    if Py_dsm > 0 and abs(Py_dsm / Py - 1.0) > 0.02:
        warnings.append(
            _nt('member.warning.dsm_py_ag_fy', Py_dsm=Py_dsm, Py=Py, Fy=Fy, value=Py_dsm / Ag))
    _fy_an = dsm.get('fy_analysis')
    if _fy_an and abs(float(_fy_an) - Fy) > 1e-6 * max(Fy, 1.0):
        warnings.append(
            _nt('member.warning.dsm_fy_fy_py', _fy_an=float(_fy_an), Fy=Fy))
    steps.append({
        'step': 1, 'name': 'Yield Load (Py)',
        'value': round(Py, 2), 'unit': 'kips',
        'formula': f'Py = Ag×Fy = {Ag:.4f} in²×{Fy:.2f} ksi = {Py:.2f} kips',
    })

    # Step 2: 전체좌굴 (E2)
    if Fcre_override > 0:
        Fcre_result = {
            'Fcre': Fcre_override,
            'buckling_type': 'user/rational analysis',
            'equation': 'User-supplied elastic buckling stress',
        }
    else:
        Fcre_result = compute_column_Fcre(props, Fy, KxLx, KyLy, KtLt)
        if Fcre_result.get('missing'):
            return {'error': f"§E2: {Fcre_result.get('error')}", 'member_type': 'compression'}
    Fcre = Fcre_result['Fcre']
    global_result = column_global_strength(Fy, Fcre, Ag)
    Pne = global_result['Pne']
    spec_sections.append('E2')

    # 단축대칭 개단면에서 xo 를 확인할 수 없으면 E2.2 를 평가하지 못한 것이다.
    ft_not_evaluated = bool(Fcre_result.get('ft_not_evaluated', False))
    if ft_not_evaluated:
        not_evaluated.append(_nt('member.ne.e2_2_e2_flexural_torsional_buckling'))
        warnings.append(
            _nt('member.warning.e2_2_e2_xo_xo_xs')
        )
    if Fcre_result.get('symmetry_axis') == 'z':
        assumptions.append(
            _nt('member.assumption.e2_2_e2_ex_kyly_ry'))

    # §E2: Fcre를 계산할 수 없으면 Pne=0 → Pn=0. 0 강도는 "불합격"이 아니라 "평가하지 못함"이다.
    e2_unavailable = Fcre <= 0 or Pne <= 0
    if e2_unavailable:
        _cutwp_note = ' (cutwp 해석 실패로 J/Cw=0이 되었습니다)' if props.get('cutwp_failed') else ''
        not_evaluated.append(_nt('member.ne.e2_e2_global_buckling'))
        if Fcre_result.get('unsupported'):
            warnings.append(_nt('member.warning.e2_4_e2', error=Fcre_result.get("error", "rational analysis is required")))
        else:
            warnings.append(
                _nt('member.warning.e2_e2_fcre_fcre_pne', cutwp_note=_cutwp_note)
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
    # Pcrl 이 없으면 Appendix 1 §1.1 Eq. 1.1-4 판좌굴 해석식(외-외 치수 계약)으로 대체하고
    # 출처를 표시한다. 그것도 못 하면 E3 를 "평가하지 못함"으로 둔다.
    Pcrl_source = _nt('member.label.src_fsm') if Pcrl > 0 else _nt('member.label.src_none')
    pcrl_an = None   # 해석식 대체의 값(계산서 design_checks 용)
    if Pcrl <= 0 and _supports_cz_plate_fallback(params):
        ho, bo, do = _out_to_out_dims(geom)
        t, R_loc = geom['t'], geom['R']
        if ho > 0 and bo > 0 and t > 0:
            try:
                from design.loads.local_params import calc_Fcrl
                fcrl_result = calc_Fcrl(ho, bo, do, t, R=R_loc,
                                        section_type=_canonical_section_type(params))
                Fcrl_calc = fcrl_result['Fcrl']
                if Fcrl_calc > 0:
                    Pcrl = Fcrl_calc * Ag
                    Pcrl_source = _nt('member.label.src_app1_plate')
                    pcrl_an = {'ho': ho, 'bo': bo, 'do': do, 't': t, 'F': Fcrl_calc, 'raw_product': Pcrl,
                               'governing': fcrl_result.get('governing'), 'kind': 'local',
                               'elements': fcrl_result.get('elements'), 'trace': fcrl_result.get('trace')}
                    # 단일 극소 곡선: 서명곡선은 모든 모드의 아래 포락선이므로 분리되지 않은 모드의
                    # 임계값은 그 극소 값 이상이다 — 해석식 값이 그보다 낮을 때만 극소 값으로 올린다.
                    if diag['single_minimum'] and diag['bound'] > Pcrl:
                        Pcrl = diag['bound']
                        Pcrl_source = _nt('member.label.src_raised_to_floor', source=Pcrl_source)
                        pcrl_an.update(raised=True, final=Pcrl)
                    assumptions.append(
                        _nt('member.assumption.pcrl_fsm_appendix_fcrl', Fcrl_calc=Fcrl_calc, governing=fcrl_result["governing"], ho=ho, bo=bo, do=do)
                    )
            except Exception as e:
                warnings.append(_nt('member.warning.pcrl_fallback_appendix', e=e))

    local_not_evaluated = Pcrl <= 0
    if Pcrl > 0:
        local_result = compression_local(Pne, Pcrl)
        Pnl = local_result['Pnl']
        spec_sections.append('E3.2')
    else:
        Pnl = Pne
        local_result = {'lambda_l': 0, 'equation': 'N/A (E3 not evaluated: no Pcrl)'}
        not_evaluated.append(_nt('member.ne.e3_e3_local_buckling'))
        warnings.append(
            _nt('member.warning.e3_e3_pcrl_pnl_pne'))

    steps.append({
        'step': 3, 'name': 'Local Buckling (Pnl)',
        'value': round(Pnl, 2), 'unit': 'kips',
        'formula': (
            f'Pcrl = {Pcrl:.2f} kips ({Pcrl_source}), '
            f'λl = √(Pne/Pcrl) = √({Pne:.2f} kips/{Pcrl:.2f} kips) = {local_result["lambda_l"]:.3f} '
            f'{"≤" if local_result["lambda_l"] <= 0.776 else ">"} 0.776 → '
            f'Pnl = {Pnl:.2f} kips'
        ) if Pcrl > 0 else f'Pcrl 없음 → E3 미평가 (Pnl = Pne = {Pnl:.2f} kips 로 표시)',
        'equation': local_result['equation'],
    })

    # Step 4: 왜곡좌굴 (E4) — 연단 보강 플랜지가 있는 개단면만 해당한다.
    dist_applicable, dist_reason = _distortional_applicability(geom)
    Pcrd_source = _nt('member.label.src_fsm') if Pcrd > 0 else _nt('member.label.src_none')
    pcrd_an = None
    distortional_not_evaluated = False
    if Pcrd <= 0 and dist_applicable and _supports_cz_distortional_fallback(params):
        ho, bo, do = _out_to_out_dims(geom)
        t, lip_angle = geom['t'], geom['lip_angle']
        sec_type = 'Z' if _canonical_section_type(params) == 'Z' else 'C'
        if ho > 0 and bo > 0 and t > 0 and do > 0:
            try:
                from design.loads.distortional_params import (
                    calc_flange_properties, calc_Fcrd
                )
                # distortional_params 계약: b = bo − t, d = do − t/2, ho = 외-외 웹 깊이.
                b_cl = bo - t
                d_cl = do - t / 2.0
                fp = calc_flange_properties(b_cl, d_cl, t, lip_angle, sec_type)
                fcrd_result = calc_Fcrd(fp, ho, t, xi_web=0)  # compression
                Fcrd_calc = fcrd_result['Fcrd']
                Lcrd_val = fcrd_result.get('Lcrd', '')
                assumptions.extend(_prefixed('§2.3.1.3: ', n) for n in (fcrd_result.get('notes') or []))
                if Fcrd_calc > 0:
                    Pcrd = Fcrd_calc * Ag
                    Pcrd_source = _nt('member.label.src_app2_compression')
                    pcrd_an = {'ho': ho, 'bo': bo, 'do': do, 't': t, 'F': Fcrd_calc, 'raw_product': Pcrd,
                               'kind': 'distortional', 'b': b_cl, 'd': d_cl, 'theta': lip_angle,
                               'trace': fcrd_result.get('trace')}
                    if diag['single_minimum'] and diag['bound'] > Pcrd:
                        Pcrd = diag['bound']
                        Pcrd_source = _nt('member.label.src_raised_to_floor', source=Pcrd_source)
                        pcrd_an.update(raised=True, final=Pcrd)
                    assumptions.append(
                        _nt('member.assumption.pcrd_fsm_appendix_fcrd', Fcrd_calc=Fcrd_calc, Lcrd_val=Lcrd_val)
                    )
            except Exception as e:
                warnings.append(_nt('member.warning.pcrd_fallback_appendix', e=e))

    if Pcrd > 0:
        # 해당하지 않는 단면이라도 값이 주어지면 쓴다(감소만 할 수 있으므로 보수측 — Manual II-4B).
        dist_result = compression_distortional(Py, Pcrd)
        Pnd = dist_result['Pnd']
        spec_sections.append('E4')
    elif not dist_applicable:
        Pnd = Py
        dist_result = {'lambda_d': 0, 'equation': f'N/A (E4 not applicable: {dist_reason})'}
    else:
        Pnd = Py
        distortional_not_evaluated = True
        dist_result = {'lambda_d': 0, 'equation': 'N/A (E4 not evaluated: no Pcrd)'}
        not_evaluated.append(_nt('member.ne.e4_e4_distortional_buckling'))
        warnings.append(
            _nt('member.warning.e4_e4_pcrd_appendix_cfsm', value=_effective_section_type(params)))

    steps.append({
        'step': 4, 'name': 'Distortional Buckling (Pnd)',
        'value': round(Pnd, 2), 'unit': 'kips',
        'formula': (
            f'Pcrd = {Pcrd:.2f} kips ({Pcrd_source}), '
            f'λd = √(Py/Pcrd) = √({Py:.2f} kips/{Pcrd:.2f} kips) = {dist_result["lambda_d"]:.3f} '
            f'{"≤" if dist_result["lambda_d"] <= 0.561 else ">"} 0.561 → '
            f'Pnd = {Pnd:.2f} kips'
        ) if Pcrd > 0 else (
            f'§E4 해당 없음({dist_reason}) → Pnd = Py = {Pnd:.2f} kips' if not dist_applicable
            else f'Pcrd 없음 → E4 미평가 (Pnd = Py = {Pnd:.2f} kips 로 표시)'),
        'equation': dist_result['equation'],
    })

    _apply_fsm_diagnostics(diag, warnings, not_evaluated, 'P',
                           local_from_fsm=(Pcrl_source == 'FSM'), dist_from_fsm=(Pcrd_source == 'FSM'),
                           local_name=_nt('member.ne.e3_e3_local_buckling'), dist_name=_nt('member.ne.e4_e4_distortional_buckling'),
                           assumptions=assumptions)

    # §H1.2: 앵글은 압축 단독이라도 (P)L/1000 편심 모멘트를 조합식으로 검토해야 한다
    # (면제: 단축대칭 무보강 앵글이면서 Pnl = Pne).
    if _canonical_section_type(params) in ('ANGLE', 'LIPPEDANGLE') and not _angle_l1000_exempt(
            params, geom, Pnl, Pne):
        not_evaluated.append(_nt('member.ne.h1_2_h1_angle'))
        warnings.append(
            _nt('member.warning.h1_2_h1_muy_member_type'))

    # Step 5: 공칭강도
    # 지배 모드는 실제로 좌굴이 강도를 감소시킨 경우에만 국부/왜곡으로 표시한다.
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

    # 0 공칭강도: E2 를 평가하지 못한 경우는 판정 없음, 그 밖의 0 강도는 불합격.
    if Pn <= 0:
        pass_flag = None if e2_unavailable else False
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
        _RAW_DS: design_strength,
        'utilization': round(utilization, 4) if Pu > 0 else None,
        _UTIL_RAW: utilization if Pu > 0 else None,
        'pass': pass_flag,
        'distortional_not_evaluated': bool(distortional_not_evaluated),
        'distortional_applicable': bool(dist_applicable),
        'local_not_evaluated': bool(local_not_evaluated),
        'ft_not_evaluated': ft_not_evaluated,
        'dsm_source': {'Pcrl': Pcrl_source, 'Pcrd': Pcrd_source},
        'steps': steps,
        'spec_sections': sorted(set(spec_sections)),
        'warnings': warnings,
        'assumptions': assumptions,
        'scope_notes': [],
    }
    if Pu > 0 and Pn > 0:
        result['governing_check'] = 'E axial compression'
        result['limit_state_checks'] = [{
            'name': 'E axial compression', 'ratio': round(utilization, 4), 'pass': pass_flag}]
    for item in not_evaluated:
        _mark_not_evaluated(result, item)
    _finalize_verdict(result)
    # 검토 항목(design_checks) — 위에서 계산한 바로 그 값들로 엮는다(덧붙이기, 값 불변).
    result['design_checks'] = _checks_or_trace_error(lambda: _mc.compression_checks(dict(
        dm=design_method, params=params, generated=params.get(_PROPS_GENERATED), props=props,
        Fy=Fy, Pu=Pu, Ag=Ag, dsm=dsm, diag=diag, missing_len=missing_len,
        Fcre_override=Fcre_override, Fcre_result=Fcre_result, Fcre=Fcre, global_result=global_result,
        Pne=Pne, e2_unavailable=e2_unavailable, Pcrl=Pcrl, Pcrl_source=Pcrl_source, pcrl_an=pcrl_an,
        local_result=local_result, Pnl=Pnl, local_not_evaluated=local_not_evaluated, Py=Py, Pcrd=Pcrd,
        Pcrd_source=Pcrd_source, pcrd_an=pcrd_an, dist_applicable=dist_applicable, dist_reason=dist_reason,
        dist_result=dist_result, Pnd=Pnd, Pn=Pn, mode=mode, phi=phi, omega=omega,
        not_evaluated=result.get('not_evaluated') or [])), {
            'Local Buckling': 'member.compression.local',
            'Distortional Buckling': 'member.compression.distortional'}.get(mode, 'member.compression.global'))
    return result


def _checks_or_trace_error(build, preferred_id=None) -> list:
    """검토 항목을 만들고 무리마다 지배 항목을 표시한다. 비가 같으면 엔진이 고른 지배 모드(preferred_id)."""
    checks = build()
    groups = {c['group'] for c in checks}
    _set_governing(checks, {g: preferred_id for g in groups} if preferred_id else None)
    return checks


def _angle_l1000_exempt(params: dict, geom: dict, Pnl: float, Pne: float) -> bool:
    """§H1.2: (P)L/1000 면제 — 단축대칭(등변) 무보강 앵글이면서 Pnl = Pne 일 때만."""
    if _canonical_section_type(params) != 'ANGLE':
        return False
    if Pnl < Pne - 1e-9 * max(Pne, 1.0):
        return False
    legs = (geom.get('depth', 0), geom.get('flange_o', 0))
    # 다리 길이를 모르면 단축대칭임을 확인할 수 없다.
    return legs[0] > 0 and legs[1] > 0 and abs(legs[0] - legs[1]) <= 1e-6 * max(legs)


# ============================================================
# 휨 부재 설계
# ============================================================

# 굽힘축(x)에 대칭인 단면 — 정·부모멘트에서 Mcrl/Mcrd/Sf 가 같다(Z 는 점대칭).
_X_SYMMETRIC_SECTIONS = ('C', 'Z', 'I', 'RHS', 'CHS', 'TRACK', 'SIGMA')


def _moment_sign(params: dict) -> int:
    """이 휨 검토의 부호: moment_sign('+'/'-'/±1) → Mu 의 부호 → +."""
    ms = params.get('moment_sign')
    if ms is not None:
        return -1 if str(ms).strip() in ('-', '-1', 'negative', 'neg') else 1
    try:
        return -1 if float(params.get('Mu', 0) or 0) < 0 else 1
    except (TypeError, ValueError):
        return 1


def _add_notes(result: dict, warnings, assumptions, tag: str) -> None:
    """하위 계산(G2·G5)의 알림을 FIXES §3.1.1 대로: 경고는 warnings, 가정은 assumptions,
    입력과 무관한 범위 진술(구멍 없는 웹)은 scope_notes."""
    for w in warnings or []:
        if w not in result.setdefault('warnings', []):
            result['warnings'].append(w)
    for a in assumptions or []:
        key = 'scope_notes' if 'hole' in str(a).lower() else 'assumptions'
        msg = _prefixed(f'{tag}: ', a)
        if msg not in result.setdefault(key, []):
            result[key].append(msg)


def _design_flexure(params: dict) -> dict:
    """DSM 휨 부재 설계 (§F2, §F3.2, §F4)"""
    Fy = params['Fy']   # design_member 가 Fy > 0 을 확인한다
    Fu = params.get('Fu')   # §A3.3.2 냉간가공에만 쓴다 — 없으면 그 경로가 오류(기본 강종 Fu 를 짓지 않는다)
    if params.get('use_cold_work', False) and not (Fu is not None and Fu > 0):
        return {'error': 'Fu (tensile strength, ksi) is required for the cold-work increase (§A3.3.2, use_cold_work=true).'}
    design_method = params.get('design_method', 'LRFD')
    Mu = abs(params.get('Mu', 0))
    # 랩 구간(계약 §6.3): 사람이 lap_restrained 를 밝혔으면 엔진이 Manual 가정을 쓴다 — Lb = 0, Cb = 1.0.
    lap_region = params.get('lap_region') is True
    lap_stated = lap_region and lap_restraint_stated(params)
    lap_notes = []
    lap_notes_ne = []
    if lap_stated:
        if 'Lb' in params and params.get('Lb') not in (0, 0.0):
            lap_notes.append(_nt('member.warning.lap_region_lap_restrained', Lb=params.get('Lb')))
        if params.get('Cb') is not None and params.get('Cb') != 1.0:
            lap_notes.append(_nt('member.warning.lap_region_lap_restrained_2', Cb=params.get('Cb')))
        # F4 는 해당 없음(Manual 가정) — 단일 단면으로 계산해 넘어온 뒤틀림 값은 쓰지 않는다(계약 §6.3).
        _dsm_in = params.get('dsm') or {}
        _ign = [k for k in LAP_IGNORED_DSM if (_dsm_in.get(k) or 0)]
        if _ign:
            lap_notes.append(_nt('member.warning.f4_lap_region_lap_restrained', items=', '.join(
                f'{k} = {_dsm_in.get(k)}' for k in _ign)))
        _dsm_lap = {k: v for k, v in _dsm_in.items() if k not in LAP_IGNORED_DSM}
        params = {**params, 'Lb': 0.0, 'Cb': 1.0, _LAP_LB: True, 'dsm': _dsm_lap}
        for k in ('dist_M1_M2', 'dist_Lm'):
            params.pop(k, None)
    elif lap_region and 'Lb' not in params:
        # 진술도 Lb 도 없다: 120 in 같은 길이를 지어 횡비틀림을 판정하지 않는다. Lb = 0 은 상한(Mne ≤ My)으로만 —
        # 그 값으로 불합격이면 진짜 불합격(가정 없이 강도는 더 작다), 합격이면 F2 는 미평가(LAP_LTB_UNSTATED).
        params = {**params, 'Lb': 0.0, _LAP_LB_BOUND: True}
        lap_notes_ne = [LAP_LTB_UNSTATED]
    Lb = params.get('Lb', 120)
    Cb = params.get('Cb', 1.0)

    props = _plain_scalars(params.get('props', {}) or {})
    Sf = float(props.get('Sf', 0) or props.get('Sxx', 0) or props.get('Sx', 0) or 0)
    if Sf <= 0:
        return {'error': 'Section modulus not available (Sf=0)'}
    Fy = float(Fy)
    Fy_original = Fy
    cold_work_info = None
    dsm = params.get('dsm', {}) or {}
    # Mcrl·Mcrd 는 탄성 임계모멘트(Fy 무관). 분류 문자열/*_detected 로 모드의 부재를 추론하지 않는다.
    Mcrl = float(dsm.get('Mcrl', 0) or 0)
    Mcrd = float(dsm.get('Mcrd', 0) or 0)
    My_dsm = float(dsm.get('My', 0) or 0)
    diag = _dsm_diagnostics(dsm, 'M_')
    dist_excluded = bool(params.get('distortional_not_applicable', False))
    warnings = []
    assumptions = []
    not_evaluated = []
    # 랩 구간(계약 §6.3): 구속은 사람이 밝힌 것만 쓴다 — 엔진 · 호스트가 가정하지 않는다(V6b-04).
    warnings.extend(lap_notes)
    not_evaluated.extend(lap_notes_ne)
    if lap_region:
        if params.get('distortional_not_applicable'):
            warnings.append(_nt('member.warning.lap_region_distortional_applicable'))
        dist_excluded = lap_stated
        if dist_excluded:
            assumptions.append(LAP_STATED)
        elif not float(dsm.get('Mcrd', 0) or 0) > 0:
            not_evaluated.append(LAP_DIST_UNSTATED)
    elif dist_excluded:
        assumptions.append(
            _nt('member.assumption.f4_f4_distortional_buckling_was')
        )
    steps = []
    spec_sections = []
    section_type = _canonical_section_type(params)
    geom = _section_geometry(params)
    Zf = props.get('Zx', 0) or props.get('Zf', 0)
    use_ir = params.get('use_inelastic_reserve', False)
    Fcre_override = float(params.get('Fcre', 0) or 0)

    # §F2.3 round-HSS 분기용 D/t 산정 (원형관일 때만; 그 외 None).
    # 외경 D는 section.diameter 또는 params['D'](템플릿 CHS의 외경)이며 두께 t로 나눈다.
    _is_round = _is_round_section(params)
    D_over_t = None
    if _is_round:
        _section = params.get('section', {}) or {}
        _t = props.get('t', 0) or _section.get('thickness', 0) or params.get('t', 0)
        # 외경 우선순위: 명시 diameter → CHS 템플릿 외경 params['D'] → section.depth/H fallback.
        _D = (_section.get('diameter', 0) or params.get('D', 0)
              or _section.get('depth', 0) or params.get('H', 0))
        if _D > 0 and _t > 0:
            D_over_t = _D / _t

    # Lb 미지정 시 기본 120 in 으로 계산하되, 그 LTB 결과는 판정에 쓰지 않는다.
    if 'Lb' not in params:
        warnings.append(_nt('member.warning.lb_defaulted_verify_lateral'))
        if Fcre_override <= 0 and not _is_round:
            not_evaluated.append(LAP_LTB_UNSTATED if lap_region else _nt('member.ne.f2_f2_lateral_torsional_buckling_4'))

    # §F2.1.1: Cb — 캔틸레버/자유단 비지지 돌출부는 1.0, 공식(Eq. F2.1.1-2) 범위 밖 값은 경고.
    if params.get('cantilever') and Cb != 1.0:
        warnings.append(_nt('member.warning.f2_1_1_f2_cb_cb', Cb=Cb))
        Cb = 1.0
    if Cb < 1.0 or Cb > 3.0:
        warnings.append(_nt('member.warning.f2_1_1_f2_cb_f2', Cb=Cb))

    if Mcrl == 0 and Mcrd == 0:
        warnings.append(
            _nt('member.warning.mcrl_mcrd_fsm_run')
        )

    # My = Sf·Fy (Eq. F2.1-2/F4.1-4) — 설계 Fy 로 산정. DSM 의 My 는 해석 fy 기준이므로 비교만 한다.
    if My_dsm > 0 and abs(My_dsm / (Sf * Fy_original) - 1.0) > 0.02:
        warnings.append(
            _nt('member.warning.dsm_my_sf_fy', My_dsm=My_dsm, value=Sf * Fy_original, Fy_original=Fy_original, value_2=My_dsm / Sf))
    _fy_an = dsm.get('fy_analysis')
    if _fy_an and abs(float(_fy_an) - Fy_original) > 1e-6 * max(Fy_original, 1.0):
        warnings.append(
            _nt('member.warning.dsm_fy_fy_my', _fy_an=float(_fy_an), Fy_original=Fy_original))

    # [문제4] β 보정계수 파라미터 (§Appendix 2 §2.3.3.3 Eq. 2.3.3.3-3)
    dist_M1_M2 = params.get('dist_M1_M2', None)  # M1/M2 비율 (양: 역곡률, 음: 단일곡률)
    dist_Lm = params.get('dist_Lm', 0)            # 뒤틀림 구속점 간격 (in)
    dist_Lcrd = dsm.get('Lcrd', 0)                # 뒤틀림좌굴 반파장 (in, DSM 추출)

    dist_applicable, dist_reason = _distortional_applicability(geom)
    if dist_excluded and lap_region:
        dist_applicable, dist_reason = False, ('lap region — lap_restrained = true (user statement; AISI '
                                               'Manual II-1A / II-2A: lapped section sufficiently restrained)')
    elif dist_excluded:
        dist_applicable, dist_reason = False, 'excluded by supplied assumption'

    def _calc_flexure_state(Fy_eval: float, allow_ir: bool) -> dict:
        state_warnings = []
        fcre_raw = {}      # 계산서(design_checks)용 — 계산에 쓴 반올림 전 값
        Mcrl_an = Mcrd_an = beta_inputs = None
        My = Sf * Fy_eval
        Sf_eff = Sf
        # §F2.1.4 closed-box는 Lb<=Lu 판정에 Fy가 필요하므로 Fy_eval을 전달한다.
        if Fcre_override > 0:
            Fcre = Fcre_override
            fcre_detail_state = {
                'Fcre': Fcre,
                'equation': 'User-supplied elastic buckling stress',
                'user_supplied': True,
            }
        elif _is_round:
            # §F2.3 은 LTB 식이 없다 — D/t 로 Mne 를 직접 산정한다.
            Fcre = 0.0
            fcre_detail_state = {'equation': 'F2.3', 'round_hss': True}
        else:
            Fcre, fcre_detail_state = compute_beam_Fcre_detail(
                props, Cb, Lb, section_type=section_type, Fy=Fy_eval, _raw=fcre_raw)
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
        Mcrl_source = _nt('member.label.src_fsm') if Mcrl_eff > 0 else _nt('member.label.src_none')

        # Mcrl 이 없으면 Appendix 1 §1.1 Eq. 1.1-4 판좌굴 해석식(외-외 치수 계약)으로 대체.
        if Mcrl_eff == 0 and Sf_eff > 0 and _supports_cz_plate_fallback(params):
            ho, bo, do = _out_to_out_dims(geom)
            t, R_loc = geom['t'], geom['R']
            if ho > 0 and bo > 0 and t > 0:
                try:
                    from design.loads.local_params import calc_Fcrl
                    fcrl_result = calc_Fcrl(ho, bo, do, t, R=R_loc, section_type=section_type,
                                            flexure=True)
                    Fcrl_calc = fcrl_result['Fcrl']
                    if Fcrl_calc > 0:
                        Mcrl_eff = Fcrl_calc * Sf_eff
                        Mcrl_source = _nt('member.label.src_app1_plate')
                        Mcrl_an = {'ho': ho, 'bo': bo, 'do': do, 't': t, 'F': Fcrl_calc, 'raw_product': Mcrl_eff,
                                   'governing': fcrl_result.get('governing'), 'kind': 'local',
                                   'elements': fcrl_result.get('elements'), 'trace': fcrl_result.get('trace')}
                        if diag['single_minimum'] and diag['bound'] > Mcrl_eff:
                            Mcrl_eff = diag['bound']
                            Mcrl_source = _nt('member.label.src_raised_to_floor', source=Mcrl_source)
                            Mcrl_an.update(raised=True, final=Mcrl_eff)
                except Exception as e:
                    state_warnings.append(_nt('member.warning.mcrl_fallback_appendix', e=e))

        # §F2.4.2-3: 부재 소성모멘트 Mp = Zf×Fy (탄성 임계값과 달리 Fy/Fya에 비례)
        Mp = Zf * Fy_eval if Zf > 0 else 0.0

        # §F3.1.1: 원형관(round HSS)으로 D/t ≤ 0.441 E/Fy 이면 국부좌굴(Mnl)을 검토하지
        # 않는다(local buckling need not be checked). 원형관 국부좌굴은 이미 §F2.3 Mne
        # 곡선에 반영되어 있으므로 Mnl 감소를 건너뛰고 Mnl=Mne로 둔다.
        _skip_round_local = (
            _is_round and D_over_t is not None and D_over_t > 0
            and Fy_eval > 0 and D_over_t <= 0.441 * E / Fy_eval
        )

        local_missing = False
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
            local_missing = True
            local_result = {'lambda_l': 0, 'equation': 'N/A (F3 not evaluated: no Mcrl)'}
            Mnl = Mne

        Mcrd_eff = Mcrd if Mcrd > 0 else 0
        Mcrd_source = _nt('member.label.src_fsm') if Mcrd_eff > 0 else _nt('member.label.src_none')
        dist_missing = False

        # §2.3.3.3 해석적 Fcrd fallback — 뒤틀림이 해당하는 C/Z 단면만.
        if (Mcrd_eff == 0 and Sf > 0 and dist_applicable and not _is_round
                and _supports_cz_distortional_fallback(params)):
            ho, bo, do = _out_to_out_dims(geom)
            t, lip_angle = geom['t'], geom['lip_angle']
            sec_type = 'Z' if section_type == 'Z' else 'C'
            kphi_ext = params.get('kphi', 0)
            if ho > 0 and bo > 0 and t > 0 and do > 0:
                try:
                    from design.loads.distortional_params import calc_flange_properties, calc_Fcrd
                    # distortional_params 계약: b = bo − t, d = do − t/2, ho = 외-외 웹 깊이.
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
                        Mcrd_source = _nt('member.label.src_app2_flexure')
                        Mcrd_an = {'ho': ho, 'bo': bo, 'do': do, 't': t, 'F': Fcrd_calc, 'raw_product': Mcrd_eff,
                                   'kind': 'distortional', 'b': b_cl, 'd': d_cl, 'theta': lip_angle,
                                   'trace': fcrd_result.get('trace'), 'kphi_given': 'kphi' in params}
                        if diag['single_minimum'] and diag['bound'] > Mcrd_eff:
                            Mcrd_eff = diag['bound']
                            Mcrd_source = _nt('member.label.src_raised_to_floor', source=Mcrd_source)
                            Mcrd_an.update(raised=True, final=Mcrd_eff)
                except Exception as e:
                    state_warnings.append(_nt('member.warning.mcrd_fallback_appendix', e=e))

        # 정모멘트 구간 등 다른 곡률을 위한 β 미적용 기준 Mcrd 보존 (positive-region용)
        Mcrd_base = Mcrd_eff

        # [문제4] §2.3.3.3 Eq. 2.3.3.3-3: β 모멘트 구배 보정
        beta_dist = 1.0
        if Mcrd_eff > 0 and dist_M1_M2 is not None and dist_Lm > 0:
            Lcrd_val = dist_Lcrd if dist_Lcrd > 0 else dist_Lm
            L_beta = min(Lcrd_val, dist_Lm)
            ratio_L = L_beta / dist_Lm if dist_Lm > 0 else 1.0
            ratio_M = 1 + dist_M1_M2
            if ratio_M > 0:
                beta_raw = 1.0 + 0.4 * (ratio_L ** 0.7) * (ratio_M ** 0.7)
            else:
                beta_raw = 1.0
            beta_dist = max(1.0, min(beta_raw, 1.3))
            beta_inputs = {'L': L_beta, 'L_basis': 'min(Lcrd, Lm)' if dist_Lcrd > 0 else 'Lm (Lcrd not given)',
                           'Lm': dist_Lm, 'M1_M2': dist_M1_M2}
            if beta_dist > 1.0:
                Mcrd_eff *= beta_dist
                Mcrd_source = _nt('member.label.src_beta', source=Mcrd_source, beta=beta_dist)

        if Mcrd_eff > 0:
            # 해당하지 않는 단면이라도 값이 주어지면 쓴다(감소만 할 수 있으므로 보수측 — Manual II-4B).
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
        elif _is_round:
            # round HSS: 왜곡좌굴(§F4) 미적용. §F2.3 Mne가 1.25Fy까지 허용되므로
            # Mnd를 My로 캡하지 않고 Mne로 둔다 → Mn=min(Mne,Mnl,Mnd)=Mne.
            dist_result = {'lambda_d': 0, 'equation': 'N/A (round HSS, §F4 not applicable)'}
            Mnd = Mne
        elif not dist_applicable:
            dist_result = {'lambda_d': 0, 'equation': f'N/A (F4 not applicable: {dist_reason})'}
            Mnd = My
        else:
            dist_missing = True
            dist_result = {'lambda_d': 0, 'equation': 'N/A (F4 not evaluated: no Mcrd)'}
            Mnd = My

        # Mnfo: Mne=My 가정의 국부좌굴 강도(§I6.2.1, Fn=Fy → Mne=My).
        # IR 활성 시 §F3.2.3 소성값(λl=√(My/Mcrl)≤0.776)으로 끌어올리되 소성 상한을 초과하지 않게 한다.
        Mnfo_detail = None
        if Mcrl_eff > 0:
            Mnfo_detail = flexure_local(My, Mcrl_eff)
            Mnfo = Mnfo_detail['Mnl']
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
            'local_missing': local_missing,
            'dist_missing': dist_missing,
            'skip_round_local': _skip_round_local,
            'warnings': state_warnings,
            # 계산서(design_checks) 용 — 위 계산이 쓴 값 그대로
            'Fcre_raw': fcre_raw, 'Mcrl_an': Mcrl_an, 'Mcrd_an': Mcrd_an, 'beta_inputs': beta_inputs,
            'Mnfo_detail': Mnfo_detail,
        }

    state = _calc_flexure_state(Fy_original, use_ir)
    if (state['Fcre_detail'] or {}).get('missing'):
        return {'error': f"§F2: {state['Fcre_detail'].get('error')}", 'member_type': 'flexure'}
    # §G2/§G5/§H3 는 냉간가공 증가를 쓰지 않는다(§A3.3.2) — virgin 상태를 보관한다.
    state_virgin = state
    if params.get('use_cold_work', False):
        from design.special_topics import cold_work_strength
        R = props.get('R', 0) or params.get('R', 0) or params.get('r', 0)
        t = props.get('t', 0) or params.get('t', 0)
        if R > 0 and t > 0:
            # §A3.3.2 적용한계: 냉간가공 증가는 국부/왜곡좌굴에 의한 강도 감소를 받지 않는
            # 부재에만 허용된다 — 보 부재는 Mnl=Mne AND Mnd=My. Virgin Fy 와 Fya 두 응력
            # 수준 모두에서 확인한다(Manual Example I-16 은 Fya 에서 다시 확인한다).
            _ir_tol = 1e-6

            def _no_buckling_reduction(st):
                return (abs(st['Mnl'] - st['Mne']) <= _ir_tol * max(st['Mne'], 1.0)
                        and abs(st['Mnd'] - st['My']) <= _ir_tol * max(st['My'], 1.0)
                        and not st['local_missing'] and not st['dist_missing'])

            cw_area_kwargs = _estimate_cold_work_areas(params.get('section', {}) or {}, props, R, t)
            cold_work_info = cold_work_strength(
                Fyv=Fy_original, Fuv=Fu, R=R, t=t,
                buckling_precondition=bool(_no_buckling_reduction(state)), **cw_area_kwargs
            )
            _cw_formula_ok = cold_work_info.get('fya_usable')
            if _cw_formula_ok is None:
                _cw_formula_ok = cold_work_info.get(
                    'applicable', cold_work_info.get('formula_applicable', False))

            if use_ir:
                warnings.append(_nt('member.warning.a3_3_2_a3_cold_work_fya'))
                cold_work_info = None
            elif not _no_buckling_reduction(state):
                # 국부 또는 왜곡좌굴이 강도를 감소시키는(또는 확인되지 않은) 단면 → §A3.3.2 적용 불가.
                warnings.append(
                    _nt('member.warning.a3_3_2_a3_fy_mnl_mne')
                )
                cold_work_info = None
            elif _cw_formula_ok and cold_work_info['Fya'] > Fy_original:
                Mn_virgin = min(state['Mne'], state['Mnl'], state['Mnd'])
                state_cw = _calc_flexure_state(cold_work_info['Fya'], False)
                Mn_cw = min(state_cw['Mne'], state_cw['Mnl'], state_cw['Mnd'])
                if not _no_buckling_reduction(state_cw):
                    cold_work_info = None
                    warnings.append(
                        _nt('member.warning.a3_3_2_a3_fya_virgin_fy'))
                elif Mn_cw <= Mn_virgin:
                    cold_work_info = None
                    warnings.append(
                        _nt('member.warning.a3_3_2_a3_cold_work_fya_2')
                    )
                else:
                    state = state_cw
            else:
                warnings.extend(cold_work_info.get('warnings', []))
                cold_work_info = None

    for _w in state['warnings']:
        if _w not in warnings:
            warnings.append(_w)
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
                f'(+{cold_work_info.get("increase_pct", 0):.1f}%) → Fy={Fy_original:.2f} ksi를 Fya={cw_Fya:.2f} ksi로 대체 '
                '(§G2·§G5·§H3 은 virgin Fy 사용)'
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
    # §I6.1.2: 데크 강성을 포함한 Fcre(사용자 합리적 해석)가 주어진 경우에만 인용한다.
    if params.get('through_fastened', False):
        if Fcre_override > 0:
            spec_sections.append('I6.1.2')
        else:
            assumptions.append(
                _nt('member.assumption.i6_1_2_i6_mcrl_mcrd_fsm'))

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
                _nt('member.warning.f2_4_2_f2_inelastic_reserve_f2')
            )

    # [문제5] Cb + Fcre 상세 계산과정 — 식(F2.1.1/F2.1.3 대 F2.1.4)별로 다른 문구.
    fcre_detail = state.get('Fcre_detail', {}) or {}
    f2_unavailable = False
    if fcre_detail.get('unsupported'):
        _required_f = fcre_detail.get('required_section', 'F2.1.5')
        warnings.append(_nt('member.warning.fcre_unavailable', clause=_required_f, error=fcre_detail.get("error", "rational analysis is required")))
        not_evaluated.append(_nt('member.ne.f2_f2_lateral_torsional_buckling', clause=_required_f))
        f2_unavailable = True
    _eq = str(fcre_detail.get('equation', ''))
    if (fcre_detail and Lb > 0 and not fcre_detail.get('user_supplied')
            and not fcre_detail.get('unsupported') and not fcre_detail.get('round_hss')):
        _E = fcre_detail.get('E', E)
        if _eq.startswith('F2.1.4'):
            _Lu = fcre_detail.get('Lu', 0)
            if 'Lb<=Lu' in _eq:
                fcre_formula = (
                    f'Lu = 0.36Cbπ/(Fy·Sf)·√(EGJIy) = {_Lu:.1f} in; Lb = {Lb:.1f} in ≤ Lu '
                    '→ 횡-비틀림좌굴 비고려 (Fn = Fy, Eq. F2.1.4-1)')
            else:
                fcre_formula = (
                    f'Lu = {_Lu:.1f} in < Lb = {Lb:.1f} in → '
                    f'Fcre = Cbπ/(KyLy·Sf)·√(EGJIy) = {Cb:.2f}×π/({fcre_detail.get("Ky", 1.0):.2f}×'
                    f'{fcre_detail.get("Ly", Lb):.1f} in×{fcre_detail.get("Sf", 0):.4f} in³)×'
                    f'√({_E:.0f}×{fcre_detail.get("G", 0):.0f}×{fcre_detail.get("J", 0):.4g}×'
                    f'{fcre_detail.get("Iy", 0):.4g}) = {Fcre:.2f} ksi (Eq. F2.1.4-2)')
        else:
            _sey = fcre_detail.get('sigma_ey', 0)
            _st = fcre_detail.get('sigma_t', 0)
            _ro = fcre_detail.get('ro', 0)
            _Ag = fcre_detail.get('Ag', 0)
            _Sf_f = fcre_detail.get('Sf', 0)
            _ry = fcre_detail.get('ry', 0)
            _zf = fcre_detail.get('z_factor', 1.0)
            fcre_formula = (
                f'σey = π²E/(Lb/ry)² = π²×{_E:.0f} ksi/({Lb:.1f} in/{_ry:.4f} in)² = {_sey:.2f} ksi, '
                f'σt = (GJ + π²ECw/Lb²)/(Ag×ro²) = {_st:.2f} ksi, '
                f'Fcre = {"Cb×" if Cb != 1.0 else ""}ro×Ag/{"(2×Sf)" if _zf > 1 else "Sf"}×√(σey×σt) '
                f'= {"%.2f×" % Cb if Cb != 1.0 else ""}{_ro:.4f} in×{_Ag:.4f} in²/'
                f'{("(2×%.4f in³)" % _Sf_f) if _zf > 1 else "%.4f in³" % _Sf_f}'
                f'×√({_sey:.2f} ksi×{_st:.2f} ksi) = {Fcre:.2f} ksi'
            )
        steps.append({
            'step': '2a', 'name': f'Fcre — Lateral-Torsional Buckling (§{_eq or "F2.1"})',
            'value': round(Fcre, 2), 'unit': 'ksi',
            'formula': fcre_formula,
            'equation': _eq,
        })

    # [문제2] Fn 표시에 적용 Fy(또는 Fya) 명시
    Fn_val = global_result["Fn"]
    Fcre_val = Fcre
    threshold = 2.78 * Fy
    _geq = str(global_result.get('equation', ''))
    if 'F2.3' in _geq:
        fn_cond = (f'D/t = {D_over_t:.1f}: 0.0714E/Fy={0.0714 * E / Fy:.1f}, 0.318E/Fy={0.318 * E / Fy:.1f}, '
                   f'0.441E/Fy={0.441 * E / Fy:.1f} → {_geq}, Fn = {Fn_val:.2f} ksi')
    elif _is_round:
        _dt_txt = f'{D_over_t:.1f}' if D_over_t else '미상'
        fn_cond = (f'D/t = {_dt_txt} — §F2.3 적용 범위(D/t ≤ 0.441E/Fy = {0.441 * E / Fy:.1f}) 밖 '
                   '또는 D/t 미상 → Mne 미평가')
    elif Fcre_val >= threshold:
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

    if _is_round and 'F2.3' not in _geq and Fcre_override <= 0:
        not_evaluated.append(_nt('member.ne.f2_3_f2_round_hss_outside'))
        warnings.append(_nt('member.warning.f2_3_f2_fy_mne'))
        f2_unavailable = True
    elif Mne <= 0 and not f2_unavailable:
        not_evaluated.append(_nt('member.ne.f2_f2_lateral_torsional_buckling_2'))
        warnings.append(_nt('member.warning.f2_f2_fcre_mne_cw'))
        f2_unavailable = True

    if Mcrl_source.startswith('§App.1'):
        assumptions.append(_nt('member.assumption.mcrl_fsm_appendix'))
    local_not_evaluated = bool(state['local_missing'])
    _apply_fsm_diagnostics(diag, warnings, not_evaluated, 'M',
                           local_from_fsm=(Mcrl_source == 'FSM' and not state['skip_round_local']),
                           dist_from_fsm=str(Mcrd_source).startswith('FSM'),
                           local_name=_nt('member.ne.f3_f3_local_buckling'), dist_name=_nt('member.ne.f4_f4_distortional_buckling'),
                           assumptions=assumptions)
    # 휨 부호: DSM 값(Mcrl·Mcrd)과 Sf 는 한 부호(기본 +Mxx)의 값이다. 굽힘축에 대칭이 아닌
    # 단면은 반대 부호에서 압축 플랜지가 바뀌므로 그 값으로 판정하지 않는다.
    moment_sign = _moment_sign(params)
    dsm_sign = -1 if str(dsm.get('M_sign', dsm.get('moment_sign', '+'))).strip() in ('-', '-1', 'negative') else 1
    sign_mismatch = (moment_sign != dsm_sign and section_type not in _X_SYMMETRIC_SECTIONS)
    if sign_mismatch:
        for name, from_value in (('F3 local buckling', Mcrl > 0), ('F4 distortional buckling', Mcrd > 0)):
            if from_value:
                not_evaluated.append(_nt('member.ne.dsm_values_other_moment', name=name))
        warnings.append(
            _nt('member.warning.mcrl_mcrd_mxx_dsm', value=_effective_section_type(params), text='부' if moment_sign < 0 else '정', text_2='부' if dsm_sign < 0 else '정'))
    if local_not_evaluated:
        not_evaluated.append(_nt('member.ne.f3_f3_local_buckling'))
        warnings.append(
            _nt('member.warning.f3_f3_mcrl_mnl_mne'))

    steps.append({
        'step': 3, 'name': 'Local Buckling (Mnl)',
        'value': round(Mnl, 2), 'unit': 'kip-in',
        'formula': (
            f'Mcrl = {Mcrl:.2f} kip-in ({Mcrl_source}), '
            f'λl = √(Mne/Mcrl) = √({Mne:.2f} kip-in/{Mcrl:.2f} kip-in) = {local_result["lambda_l"]:.3f} → '
            f'Mnl = {Mnl:.2f} kip-in'
        ) if Mcrl > 0 and not state['skip_round_local'] else (
            f'§F3.1.1 원형관 D/t ≤ 0.441E/Fy → 국부좌굴 검토 불요, Mnl = Mne = {Mnl:.2f} kip-in'
            if state['skip_round_local']
            else f'Mcrl 없음 → F3 미평가 (Mnl = Mne = {Mnl:.2f} kip-in 로 표시)'),
        'equation': local_result['equation'],
    })

    if Mcrd_source.startswith('§2.3.3.3'):
        assumptions.append(_nt('member.assumption.mcrd_fsm_appendix'))
    distortional_not_evaluated = bool(state['dist_missing'])
    if distortional_not_evaluated:
        not_evaluated.append(_nt('member.ne.f4_f4_distortional_buckling'))
        warnings.append(
            _nt('member.warning.f4_f4_mcrd_appendix_cfsm', value=_effective_section_type(params)))

    steps.append({
        'step': 4, 'name': 'Distortional Buckling (Mnd)',
        'value': round(Mnd, 2), 'unit': 'kip-in',
        'formula': (
            f'Mcrd = {Mcrd:.2f} kip-in ({Mcrd_source}), '
            f'λd = √(My/Mcrd) = √({My:.2f} kip-in/{Mcrd:.2f} kip-in) = {dist_result["lambda_d"]:.3f} → '
            f'Mnd = {Mnd:.2f} kip-in'
        ) if Mcrd > 0 else (
            f'{dist_result["equation"]} → Mnd = {Mnd:.2f} kip-in'),
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
        if section_type not in ('C', 'Z'):
            return {'error': (f"§I6.2.1 R-factor applies only to C- or Z-sections "
                              f"(section_type '{_effective_section_type(params)}')."),
                    'member_type': 'flexure'}
        i621_issues, i621_notes = _check_i621_limits(
            params, geom, Fy_original, params.get('Fu'), R_uplift, section_type)
        if i621_issues:
            not_evaluated.append(_nt('member.ne.i6_2_1_i6_outside_i6_conditions'))
            warnings.append(_nt('member.warning.i6_2_1_i6_k2', i621_issues=_joined('; ', i621_issues)))
        assumptions.extend(i621_notes)
        assumptions.append(
            _nt('member.assumption.i6_2_1_i6_ft'))
        # Mnfo: 국부좌굴 강도만 고려 (Fn=Fy, Mne=My 조건). state['Mnfo']는 IR 활성 시
        # §F3.2.3 소성 상한(λl=√(My/Mcrl)≤0.776)을 이미 반영하므로, 왜곡(Mnd)이 제외된
        # 이 경로에서도 국부 비탄성 상한을 초과하지 않는다(§A3.3.2/§F3.2.3 일관성).
        Mnfo = state['Mnfo']
        Mn_R = R_uplift * Mnfo
        # Eq. I6.2.1-1: Mn = R·Mnlo. 압축 플랜지가 횡지지되지 않은 C/Z 의 F2(LTB)·F4 를 대신하는
        # 식이므로 Mne·Mnd 와 비교하지 않는다.
        Mn = Mn_R
        mode = f'§I6.2.1 R-factor (R={R_uplift})'
        # 계산서는 보고하는 강도를 만든 길(I6.2.1)을 보인다 — F2/F4/DSM 최소 단계는 참고로만 남긴다.
        for st_ in steps:
            if st_.get('step') in (2, '2a', 3, 4, 5):
                st_['not_used'] = True
                st_['name'] = f"[참고 — §I6.2.1 이 대신함, 강도에 쓰지 않음] {st_['name']}"
                st_.pop('controlling_mode', None)
        _My, _Mcrl = state['My'], state['Mcrl']
        if _Mcrl > 0:
            _lam = math.sqrt(_My / _Mcrl)
            _mnlo_txt = (f'Mne = My = Sf×Fy = {_My:.2f} kip-in (Fn = Fy), Mcrl = {_Mcrl:.2f} kip-in ({Mcrl_source}), '
                         f'λl = √(My/Mcrl) = {_lam:.3f} → Mnℓo = {Mnfo:.2f} kip-in (Eq. F3.2.1)')
        else:
            _mnlo_txt = f'Mne = My = {_My:.2f} kip-in, Mcrl 없음 → Mnℓo = My = {Mnfo:.2f} kip-in (F3 미평가)'
        steps.append({
            'step': '5a', 'name': 'Mnℓo — local buckling at Fn = Fy (§F3, for §I6.2.1)',
            'value': round(Mnfo, 2), 'unit': 'kip-in',
            'formula': _mnlo_txt,
            'equation': 'F3.2.1',
        })
        _row = _i621_row_text(section_type, _out_to_out_dims(geom)[0], params.get('span_type'))
        steps.append({
            'step': '5b', 'name': 'Uplift R-factor (§I6.2.1, Eq. I6.2.1-1)',
            'value': round(Mn_R, 2), 'unit': 'kip-in',
            'formula': (f'R = {R_uplift} (Table I6.2.1-1: {_row}); '
                        f'Mn = R × Mnℓo = {R_uplift} × {Mnfo:.2f} = {Mn_R:.2f} kip-in — '
                        'F2(LTB)·F4 대신 적용; 조건 ' + ('(a)~(f)·(o) 확인' if not i621_issues
                                                       else '위반/미확인: ' + _joined('; ', i621_issues))
                        + ', (g)~(n) 사용자 확인'),
            'equation': 'I6.2.1-1',
            'R': R_uplift,
            'Mnfo': round(Mnfo, 2),
            'controls': True,
            'controlling_mode': mode,
            'note': 'Lateral-torsional (F2) and distortional (F4) buckling are replaced by §I6.2.1',
        })
        spec_sections[:] = [x for x in spec_sections if x not in ('F2', 'F2.4.2', 'F4', 'F4.3')]
        spec_sections.extend(['F3.2', 'I6.2.1'])

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

    # 0 공칭강도: F2 를 평가하지 못한 경우는 판정 없음, 그 밖의 0 강도는 불합격.
    if Mn <= 0:
        pass_flag = None if f2_unavailable else False
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
        'moment_sign': '+' if moment_sign > 0 else '-',
        'cold_work': cold_work_info,
        'use_cold_work': params.get('use_cold_work', False),
        'use_inelastic_reserve': use_ir,
        'beta_dist': state.get('beta_dist', 1.0),
        'local_not_evaluated': local_not_evaluated,
        'distortional_not_evaluated': distortional_not_evaluated,
        'distortional_applicable': bool(dist_applicable),
        'dsm_source': {'Mcrl': Mcrl_source, 'Mcrd': Mcrd_source},
        'Fcre_detail': (dict(fcre_detail, Fcre_unbounded=True) if fcre_detail and
                        (fcre_detail.get('Fcre') or 0) == _FCRE_INF else (fcre_detail if fcre_detail else None)),
        'Fy_used': round(Fy, 2),
        'Fy_original': round(Fy_original, 2),
        'controlling_mode': mode,
        'phi_Mn': round(phi_Mn, 2),
        'Mn_omega': round(Mn_omega, 2),
        'design_strength': round(design_strength, 2),
        _RAW_DS: design_strength,
        'utilization': round(utilization, 4) if Mu > 0 else None,
        _UTIL_RAW: utilization if Mu > 0 else None,
        'pass': pass_flag,
        'steps': steps,
        'spec_sections': sorted(set(spec_sections)),
        'warnings': warnings,
        'assumptions': assumptions,
        'scope_notes': [],
    }
    if Mu > 0 and Mn > 0:
        result['governing_check'] = 'F flexure'
        result['limit_state_checks'] = [{
            'name': 'F flexure', 'ratio': round(utilization, 4), 'pass': pass_flag}]
    for item in not_evaluated:
        _mark_not_evaluated(result, item)

    # 검토 항목(design_checks) 재료 — 아래 계산이 쓴 값을 그 자리에서 모은다.
    ck = dict(dm=design_method, params=params, generated=params.get(_PROPS_GENERATED), props=props,
              dsm=dsm, diag=diag, state=state, state_i621=state_virgin, Fy_original=Fy_original,
              cold_work_info=cold_work_info, Mu=Mu, Lb=Lb, Cb=Cb, Fcre_override=Fcre_override, Zf=Zf,
              D_over_t=D_over_t, E=E, is_round=_is_round, dist_applicable=dist_applicable,
              dist_reason=dist_reason, dist_stated=bool(lap_region and dist_excluded), f2_unavailable=f2_unavailable, R_uplift=R_uplift, Mn=Mn, mode=mode,
              phi=phi, omega=omega, lap_stated=bool(lap_stated), h_web=geom.get('h_web'), t_web=geom.get('t'),
              i621_row=(_i621_row_text(section_type, _out_to_out_dims(geom)[0], params.get('span_type'))
                        if R_uplift is not None and R_uplift > 0 else None))

    # §G2/§G5/§H2/§H3 는 virgin Fy·virgin 상태를 쓴다(§A3.3.2 적용 장 제한).
    Fy_v = Fy_original
    Mnfo_v = state_virgin['Mnfo']

    # §G2 + §H2 전단 및 휨-전단 상호작용. UI는 flexure에도 Vu를 전달하므로
    # member_type='combined'에만 두면 순수 휨 설계 경로에서 전단 한계상태가 누락된다.
    Vu = abs(params.get('Vu', 0) or 0)
    if Vu > 0:
        h_shear = geom['h_web']
        t_shear = geom['t']
        if h_shear > 0 and t_shear > 0:
            stiffened = bool(params.get('transverse_stiffeners', False))
            shear_res = shear_strength(h_shear, t_shear, Fy_v, transverse_stiffeners=stiffened)
            # §G2: Vn 은 웹 하나의 값이다 — hat·RHS 는 웹 2개.
            n_webs_v = int(params.get('shear_n_webs') or geom.get('n_webs')
                           or (2 if section_type == 'RHS' else 1))
            Vn = shear_res['Vn'] * n_webs_v
            phi_v = PHI['shear']
            omega_v = OMEGA['shear']
            Va = phi_v * Vn if design_method == 'LRFD' else Vn / omega_v
            # §H2: Malo = §F3 국부좌굴 가용강도(Fn = Fy, Mne = My) — virgin 상태(H2 는 §A3.3.2 밖).
            # 전단보강재(§G4)가 있으면 Malo = min(그 값, §F4 가용강도), 식은 Eq. H2-2.
            Mnlo_h2 = Mnfo_v
            if stiffened:
                Mnlo_h2 = min(Mnfo_v, state_virgin['Mnd'])
            Malo = phi * Mnlo_h2 if design_method == 'LRFD' else Mnlo_h2 / omega
            h2_raw = {}
            if stiffened:
                shear_int = combined_bending_shear_stiffened(Mu, Malo, Vu, Va, _raw=h2_raw)
            else:
                shear_int = combined_bending_shear(Mu, Malo, Vu, Va, _raw=h2_raw)
            ck['shear'] = dict(shear_res=shear_res, h=h_shear, t=t_shear, Fy=Fy_v, E=E, kv=5.34,
                               n_webs=n_webs_v, Vn=Vn, phi_v=phi_v, omega_v=omega_v, Va=Va, Vu=Vu,
                               Mnlo=Mnlo_h2, Malo=Malo, Mu=Mu, stiffened=stiffened,
                               shear_int=shear_int, h2_raw=h2_raw)
            shear_int['Malo'] = round(Malo, 2)
            shear_int['Mnlo'] = round(Mnlo_h2, 2)
            _fac = f'{phi}×' if design_method == 'LRFD' else ''
            _div = '' if design_method == 'LRFD' else f'/{omega}'
            result['steps'].append({
                'step': 8, 'name': f'Bending + Shear (§H2, Eq. {"H2-2" if stiffened else "H2-1"})',
                'value': shear_int['total'], 'unit': '',
                'formula': (
                    f'Malo = {_fac}Mnℓo{_div} = {_fac}{Mnlo_h2:.2f}{_div} = {Malo:.2f} kip-in '
                    f'(§F3, Fn = Fy{", min with §F4" if stiffened else ""}), Va = {Va:.2f} kips → '
                    + (f'√(({Mu:.2f}/{Malo:.2f})² + ({Vu:.2f}/{Va:.2f})²) = {shear_int["total"]:.3f}'
                       if not stiffened else
                       f'0.6({Mu:.2f}/{Malo:.2f}) + {Vu:.2f}/{Va:.2f} = {shear_int["lhs"]:.3f} ≤ 1.3'
                       if shear_int['applies'] else
                       f'M/Malo ≤ 0.5 또는 V/Va ≤ 0.7 → Eq. H2-2 해당 없음, V/Va = {shear_int["V_ratio"]:.3f}')),
                'equation': shear_int['equation'],
            })
            result['shear'] = {
                **shear_res,
                'Vn': round(Vn, 2),
                'Vn_per_web': round(shear_res['Vn'], 2),
                'n_webs': n_webs_v,
                'design_strength': round(Va, 2),
                'Vu': round(Vu, 2),
            }
            result['shear_interaction'] = shear_int
            _add_notes(result, shear_res.get('warnings'), shear_res.get('assumptions'), '§G2')
            result['spec_sections'].extend(['G2', 'H2'])
            _merge_governing_check(result, shear_int, 'H2 bending + shear')
        else:
            _mark_not_evaluated(
                result, _nt('member.ne.g2_g2_h2_shear'),
                _nt('member.warning.g2_vu_web_flat_depth'))

    # ── 정모멘트 구간 별도 검토 ──
    Lb_pos = params.get('Lb_pos', 0)
    Cb_pos = params.get('Cb_pos', 1.0)
    Mu_pos = abs(params.get('Mu_pos', 0))
    if Lb_pos > 0 or Mu_pos > 0 or (Lb_pos == 0 and params.get('Lb', 0) > 0):
        # 정모멘트 구간: Lb_pos, Cb_pos로 별도 Fcre/Mne 계산.
        # §F2.1.4 box(Fy)/§F2.3 round HSS(section_type/D_over_t/E) 분기를 주 구간과 일관되게 전달.
        pos_raw = {}
        local_pos = dist_pos = None
        if _is_round:
            Fcre_pos = 0.0
        else:
            Fcre_pos = compute_beam_Fcre_detail(props, Cb_pos, Lb_pos, section_type=section_type, Fy=Fy,
                                                _raw=pos_raw)[0]
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
        # 판정은 반올림하지 않은 비로(utilization 은 표시용 소수 4자리).
        util_pos = None
        ratio_pos = None
        pass_pos = None
        if Mu_pos > 0 and phi_Mn_pos > 0:
            ratio_pos = Mu_pos / phi_Mn_pos
            util_pos = round(ratio_pos, 4)
            pass_pos = ratio_pos <= 1.0
        elif Mu_pos > 0:
            util_pos = ratio_pos = float('inf')
            pass_pos = False

        result['positive_region'] = {
            'Lb': round(Lb_pos, 1),
            'Cb': round(Cb_pos, 2),
            'Fcre': round(Fcre_pos, 2),
            # 1e6 ksi 는 '횡좌굴 없음(∞)'의 표지다 — 숫자로 읽지 말라는 표시(V6-16). Fcre 키는 화면이 쓰므로 그대로.
            'Fcre_unbounded': True if Fcre_pos == _FCRE_INF else None,
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

        # 정모멘트 구간 검토도 하나의 한계상태로 판정·이용률·지배 검토에 합친다.
        if Mu_pos > 0:
            ck['positive'] = dict(raw=pos_raw, Fcre=Fcre_pos, global_=global_pos, Sf=Sf, Fy=Fy, Mne=Mne_pos,
                                  Lb=Lb_pos, Cb=Cb_pos, local=local_pos, Mcrl=Mcrl, Mnl=Mnl_pos, dist=dist_pos,
                                  Mcrd=Mcrd_pos, Mnd=Mnd_pos, Mn=Mn_pos, phi_Mn=phi_Mn_pos, Mu_pos=Mu_pos,
                                  pass_pos=pass_pos, skip_local=_skip_round_local_pos)
            result['steps'].append({
                'step': 9, 'name': f'Positive-moment region (Lb_pos = {Lb_pos:.1f} in, Cb = {Cb_pos:.2f})',
                'value': round(phi_Mn_pos, 2), 'unit': 'kip-in',
                'formula': (f'Fcre = {Fcre_pos:.2f} ksi → Mne = {Mne_pos:.2f}, Mnl = {Mnl_pos:.2f}, '
                            f'Mnd = {Mnd_pos:.2f} (β = 1) → Mn(+) = {Mn_pos:.2f} kip-in; '
                            f'{"φ" if design_method == "LRFD" else ""}Mn(+)'
                            f'{"" if design_method == "LRFD" else "/Ω"} = {phi_Mn_pos:.2f} kip-in, '
                            f'Mu(+) = {Mu_pos:.2f} → {util_pos if util_pos is not None else "—"}'),
                'equation': global_pos.get('equation', ''),
            })
            _merge_governing_check(result, {'total': ratio_pos, 'pass': pass_pos}, 'F positive region')
            if 'Lb_pos' not in params:
                _mark_not_evaluated(
                    result, _nt('member.ne.positive_region_lb_pos'),
                    _nt('member.warning.lb_pos_not_given'))
            if local_not_evaluated:
                _mark_not_evaluated(result, _nt('member.ne.positive_region_local_buckling'))
            if pass_pos is False:
                result['warnings'].append(
                    _nt('member.warning.ng_mu_mn_dcr' + ('_precise' if f'{Mu_pos:.2f}' == f'{phi_Mn_pos:.2f}'
                                                         or f'{util_pos:.3f}' == '1.000' else ''),
                        Mu_pos=Mu_pos, text="φ" if design_method == "LRFD" else "",
                        omega='' if design_method == 'LRFD' else '/Ω', phi_Mn_pos=phi_Mn_pos, util_pos=util_pos)
                )

    # §G5 웹 크리플링 단독 검토(P̄ ≤ Pa) + §H3 휨 상호작용
    wc_N = params.get('wc_N', 0)
    wc_R = params.get('wc_R', 0)
    wc_support = params.get('wc_support', 'EOF')
    if wc_N > 0 and wc_R >= 0:
        h = geom['h_web']
        t = geom['t']
        if h > 0 and t > 0:
            warnings.extend(_validate_section_keys(params))
            wc_sec_type = params.get('wc_section_type') or _effective_section_type(params)
            wc_section_family = _infer_web_crippling_family(params, wc_sec_type)
            wc_fastened = params.get('wc_fastened', 'fastened')
            wc_web_config = params.get('wc_web_config', 'single')
            wc_flange_condition = params.get('wc_flange_condition')
            wc_overhang = params.get('wc_overhang', 0)
            wc_edge_distance = params.get('wc_edge_distance')
            wc_n_webs = _infer_web_crippling_n_webs(params, wc_section_family)
            wc_spacing = params.get('wc_support_fastener_spacing')
            wc, wc_detail = _web_crippling_detail(
                h, t, wc_R, wc_N, Fy_v, support=wc_support,
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
                result['web_crippling'] = wc
                _mark_not_evaluated(result, _nt('member.ne.g5_g5_web_crippling'),
                                    _nt('member.warning.g5_g5_web_crippling_could', error=wc["error"]))
                return _attach_flexure_checks(result, ck)
            # 판정 · H3 는 반올림하지 않은 Pn 으로(wc['Pn'] 은 표시용 소수 3자리).
            Pn_wc = wc_detail['Pn_final'] if wc_detail else wc['Pn']
            from design.interaction import combined_bending_web_crippling
            # 집중하중(반력) P̄: 명시 wc_P, 없으면 지점 반력으로 Vu 를 쓴다(가정으로 밝힌다).
            # 축력 Pu 는 지압 하중이 아니므로 쓰지 않는다. 둘 다 없으면 G5 · H3 는 미평가.
            if abs(params.get('wc_P') or 0) > 0:
                P_wc, P_wc_source = abs(params['wc_P']), 'wc_P'
            elif abs(params.get('Vu') or 0) > 0:
                P_wc, P_wc_source = abs(params['Vu']), 'Vu'
                result.setdefault('assumptions', []).append(
                    _nt('member.assumption.g5_g5_h3_vu_wc', P_wc=P_wc))
            else:
                P_wc, P_wc_source = 0.0, None
            # §H3 의 M̄ 은 반력 위치의 모멘트다. 주지 않으면 부재 최대 Mu 를 쓴다(보수측).
            M_wc = abs(params.get('wc_M')) if params.get('wc_M') is not None else Mu
            wc_result = {**wc, 'Pn': round(Pn_wc, 2), 'load': round(P_wc, 3), 'load_source': P_wc_source}
            result['web_crippling'] = wc_result
            if P_wc_source is None:
                _mark_not_evaluated(
                    result, _nt('member.ne.g5_g5_web_crippling_no'),
                    _nt('member.warning.g5_h3_no_bearing_load'))
            _add_notes(result, wc.get('warnings'), wc.get('assumptions'), '§G5')
            if wc.get('within_limits') is False or wc.get('not_covered'):
                _mark_not_evaluated(result, _nt('member.ne.g5_g5_web_crippling_outside'))

            # §G5 단독: P̄ ≤ Pa (LRFD φw·Pn, ASD Pn/Ωw)
            _phi_w = wc.get('phi')
            _omega_w = wc.get('omega')
            if design_method == 'LRFD':
                Pa_wc = _phi_w * Pn_wc if _phi_w else None
            else:
                Pa_wc = Pn_wc / _omega_w if _omega_w else None
            if P_wc > 0:
                if Pa_wc:
                    wc_ratio = P_wc / Pa_wc
                    wc_result['design_strength'] = round(Pa_wc, 3)
                    wc_result['P'] = round(P_wc, 3)
                    wc_result['ratio'] = round(wc_ratio, 4)
                    _merge_governing_check(result, {'total': wc_ratio, 'pass': wc_ratio <= 1.0},
                                           'G5 web crippling')
                    ck['wc'] = dict(wc=wc, detail=wc_detail, h=h, t=t, Fy=Fy_v, Pn=Pn_wc, Pa=Pa_wc,
                                    P=P_wc, P_source=P_wc_source)
                    result['steps'].append({
                        'step': 10, 'name': f"Web crippling (§G5, Table {wc.get('table')}, {wc.get('equation')})",
                        'value': round(wc_ratio, 4), 'unit': '',
                        'formula': (f"Pn = {Pn_wc:.3f} kips ({wc.get('support')}, {wc.get('fastened')}), "
                                    f"{'φw×Pn' if design_method == 'LRFD' else 'Pn/Ωw'} = {Pa_wc:.3f} kips, "
                                    f'P = {P_wc:.3f} kips → P/Pa = {wc_ratio:.3f}'),
                        'equation': wc.get('equation'),
                    })
                else:
                    _mark_not_evaluated(result, _nt('member.ne.g5_g5_web_crippling_no_2'))

            # §H3: (a) 단일 무보강 웹(C·Z·hat 의 각 웹) → H3-1, (b) 맞댄 두 C 의 I 등 → H3-2,
            # (c) 겹친 Z → H3-3. shear.py 가 hat·built-up I·돌출(G5-2)을 "미구현"으로 두어도
            # 원문이 식을 주므로 여기서 계산한다(돌출이면 Pn = Pnc).
            h3_cfg = wc_web_config
            h3_run = wc.get('h3_applicable', True)
            wc_fam = str(wc.get('section_family') or '').lower()
            # 식은 단면 모양이 정한다: 맞댄 I → H3-2, hat 의 각 웹 → H3-1 (§H3(a)(b)).
            if wc_fam == 'built_up_i' and h3_cfg != 'nested_z':
                h3_cfg = 'multi_web'
            elif wc_fam == 'hat':
                h3_cfg = 'single'
            if not h3_run and (wc_fam in ('hat', 'built_up_i')
                               or wc.get('bearing_case') == 'overhang_bearing'):
                h3_run = True
                result.setdefault('assumptions', []).append(
                    _nt('member.assumption.h3_equation_from_text', table=wc.get('table'), text='(b) Eq. H3-2' if h3_cfg == 'multi_web' else '(a) Eq. H3-1' if h3_cfg == 'single' else '(c) Eq. H3-3'))
            if h3_run and P_wc_source is None:
                _mark_not_evaluated(result, _nt('member.ne.h3_h3_bending_web_crippling'))
            elif h3_run:
                # §H3 Eq. H3-1/2/3: limit is method-dependent (LRFD/LSD → coeff·φ;
                # ASD → coeff/Ω with Ω=1.70 per spec). Pass design_method (in scope)
                # instead of hardcoding φ=0.90 so the ASD (Ω) form is used for ASD runs.
                h3_raw = {}
                h3 = combined_bending_web_crippling(
                    P_wc, Pn_wc, M_wc, Mnfo_v,
                    web_config=h3_cfg, design_method=design_method,
                    h_over_t=(h / t), N_over_t=(wc_N / t),
                    Fy_ksi=Fy_v, R_over_t=(wc_R / t), _raw=h3_raw)
                ck['h3'] = dict(h3=h3, raw=h3_raw, P=P_wc, P_source=P_wc_source, Pn=Pn_wc, M=M_wc,
                                M_given=params.get('wc_M') is not None, Mnlo=Mnfo_v)
                result['h3_interaction'] = h3
                result['warnings'].extend(h3.get('warnings', []))
                result['steps'].append({
                    'step': 11, 'name': f"Bending + web crippling (§H3, Eq. {h3['equation']})",
                    'value': h3['total'], 'unit': '',
                    'formula': (f"{h3['P_term_label']} + M/Mnℓo = {h3['P_term']:.3f} + "
                                f"{M_wc:.2f}/{Mnfo_v:.2f} = {h3['total']:.3f} "
                                f"{'≤' if h3['pass'] else '>'} {h3['limit']:.3f}"),
                    'equation': h3['equation'],
                })
                h3_ratio = h3['total'] / h3['limit'] if h3.get('limit', 0) > 0 else float('inf')
                _merge_governing_check(result, h3, 'H3 bending + web crippling', h3_ratio)
                if params.get('wc_M') is None and M_wc > 0:
                    result.setdefault('assumptions', []).append(
                        _nt('member.assumption.h3_h3_wc_mu'))
            else:
                _mark_not_evaluated(
                    result, _nt('member.ne.h3_h3_bending_web_crippling_2'),
                    _nt('member.warning.h3_not_evaluated', value=wc.get('h3_not_applicable_reason')
                               or _nt('member.fragment.h3_interaction_not_evaluated')))
            result['Mnfo'] = round(Mnfo_v, 2)
            result['spec_sections'].append('G5')
            if result.get('h3_interaction'):
                result['spec_sections'].append('H3')

    _finalize_verdict(result)
    return _attach_flexure_checks(result, ck)


def _attach_flexure_checks(result: dict, ck: dict) -> dict:
    """_design_flexure 가 모은 값(ck)으로 검토 항목을 붙인다(옛 키 · 값은 그대로)."""
    ck['not_evaluated_all'] = list(result.get('not_evaluated') or [])
    result['design_checks'] = _mc.flexure_checks_all(ck)
    if ck.get('lap_stated'):
        # 랩 도구가 단면 강도를 가져갈 곳 — Fn = Fy, 비탄성 여유 · 냉간가공 없이(계약 §6.3)
        result['lap_section'] = _mc.lap_section_block(ck)
    return result


def _i621_table_R(profile: str, d: float, span_type: str) -> float | None:
    """Table I6.2.1-1 의 R (C/Z, 깊이 d in, 'simple' | 'continuous')."""
    if span_type == 'continuous':
        return 0.60 if profile == 'C' else 0.70
    if d <= 6.5:
        return 0.70
    if d <= 8.5:
        return 0.65
    if d <= 12.0:
        return 0.50 if profile == 'Z' else 0.40
    return None


def _i621_row_text(profile: str, d: float, span_type) -> str:
    """계산서용: Table I6.2.1-1 에서 쓴 행."""
    st = str(span_type or '').strip().lower()
    if st == 'continuous':
        return f'continuous span, {profile} → {_i621_table_R(profile, d, st):.2f}'
    if d <= 0:
        return 'depth unknown'
    if d <= 6.5:
        rng = 'd ≤ 6.5 in'
    elif d <= 8.5:
        rng = '6.5 < d ≤ 8.5 in'
    elif d <= 12.0:
        rng = '8.5 < d ≤ 12 in'
    else:
        return f'd = {d:.2f} in > 12 in (no row)'
    simple = _i621_table_R(profile, d, 'simple')
    if st == 'simple':
        return f'simple span, {rng}, {profile} → {simple:.2f}'
    cont = _i621_table_R(profile, d, 'continuous')
    return (f'span type not given — simple ({rng}) {simple:.2f} / continuous {cont:.2f}, '
            f'smaller {min(simple, cont):.2f} checked')


def _check_i621_limits(params: dict, geom: dict, Fy: float, Fu: float, R_uplift: float,
                       profile: str = 'C') -> tuple:
    """§I6.2.1 의 기하·재료 조건 (a)~(f), (o) 와 Table I6.2.1-1 의 R 값을 확인한다.

    Returns (issues, notes): issues 가 있으면 I6.2.1 은 판정에 쓰지 않는다.
    """
    issues = []
    notes = []
    t = geom['t']
    d, bo, _ = _out_to_out_dims(geom)
    span_type = str(params.get('span_type') or '').strip().lower()
    if d > 0:
        if span_type in ('simple', 'continuous'):
            R_tab = _i621_table_R(profile, d, span_type)
        else:
            cands = [v for v in (_i621_table_R(profile, d, 'simple'),
                                 _i621_table_R(profile, d, 'continuous')) if v is not None]
            R_tab = min(cands) if cands else None
            notes.append(_nt('member.assumption.i6_2_1_i6_span_type_simple'))
        if R_tab is None:
            issues.append(_nt('member.fragment.i621_no_table_row', d=d))
        elif R_uplift > R_tab + 1e-9:
            issues.append(_nt('member.fragment.i621_r_above_table', R=R_uplift, R_tab=R_tab, profile=profile, d=d,
                              span_type=span_type or _nt('member.fragment.span_type_unknown')))
    elif R_uplift > 0.70:
        issues.append(_nt('member.fragment.i621_r_above_max', R=R_uplift))
    w = geom['b_flange']
    if d <= 0 or bo <= 0 or t <= 0:
        issues.append(_nt('member.fragment.i621_dims_unknown'))
    else:
        if d > 12.0:
            issues.append(_nt('member.fragment.i621_a', d=d))
        if not geom['has_lip']:
            issues.append(_nt('member.fragment.i621_b'))
        if not 60 <= d / t <= 170:
            issues.append(_nt('member.fragment.i621_c', ratio=d / t))
        if not 2.8 <= d / bo <= 5.5:
            issues.append(_nt('member.fragment.i621_d', ratio=d / bo))
        if bo < 2.125:
            issues.append(_nt('member.fragment.i621_e', bo=bo))
        if w > 0 and not 16 <= w / t <= 43:
            issues.append(_nt('member.fragment.i621_f', ratio=w / t))
        elif w <= 0:
            issues.append(_nt('member.fragment.i621_f_unknown'))
    if Fu is None or Fy <= 0 or Fu / Fy < 1.08:
        issues.append(_nt('member.fragment.i621_o', ratio=(Fu / Fy if Fu and Fy > 0 else 0)))
    return issues, notes


# ============================================================
# 조합 하중
# ============================================================

def _merge_sub_verdicts(result: dict, subs: list, main_names: tuple) -> None:
    """하위 설계의 별도 한계상태(H2·H3·G5·정모멘트 구간)와 미평가 항목을 조합 결과에 합친다.

    하위의 주 검토(E 압축·F 휨 단독)는 상호작용식이 대신하므로 합치지 않는다.
    """
    for label, sub in subs:
        for chk in sub.get('limit_state_checks', []) or []:
            if chk.get('name') in main_names:
                continue
            _merge_governing_check(result, {'total': chk.get('ratio'), 'pass': chk.get('pass')},
                                   chk.get('name'))
        for item in sub.get('not_evaluated', []) or []:
            _mark_not_evaluated(result, _nt('member.ne.sub_result_item', label=label, item=item))


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
    # M1/M2 는 '그 굽힘 평면의 비지지 구간' 끝 모멘트 비다 — 축마다 따로 받는다(Cmx_M1_M2 · Cmy_M1_M2).
    # dist_M1_M2 는 부록 2 Eq. 2.3.3.3-3 β(강축 뒤틀림 구간 Lm)의 입력이라 Cm 에 쓰지 않는다(V6b-02).
    transverse = bool(params.get('transverse_load', False))
    M1_M2_x = params.get('Cmx_M1_M2', None)
    M1_M2_y = params.get('Cmy_M1_M2', None)

    def _cm(key, ratio):
        if params.get(key) is not None:
            return params.get(key), 'user'
        if transverse:
            return 1.0, 'transverse'
        if ratio is not None:
            return 0.6 - 0.4 * ratio, 'M1_M2'     # Eq. C1.2.1.1-4
        return 1.0, 'default'
    Cmx, cmx_basis = _cm('Cmx', M1_M2_x)
    Cmy, cmy_basis = _cm('Cmy', M1_M2_y)

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

    # §H1.2 2번째 단락: 앵글(단축대칭 무보강 앵글이면서 Pnl=Pne 인 경우 제외)은
    # My 를 Muy 또는 Muy+(P)L/1000 중 P 허용값이 더 낮아지는 쪽으로 취한다 — Muy=0 이어도.
    geom = _section_geometry(params)
    is_angle = _canonical_section_type(params) in ('ANGLE', 'LIPPEDANGLE')
    angle_exempt = (not is_angle) or _angle_l1000_exempt(
        params, geom, comp.get('Pnl', 0), comp.get('Pne', 0))

    # 휨 설계 (y축 — 약축)
    props = _plain_scalars(params.get('props', {}) or {})
    Ag = props.get('A', 0)
    flex_y = None
    May_strength = params.get('May_strength', 0) or 0
    if Muy > 0 or not angle_exempt:
        if May_strength <= 0:
            return {
                'error': ('Weak-axis flexure requires explicit May_strength. Automatic weak-axis DSM '
                          'strength is not implemented.'
                          + ('' if Muy > 0 else
                             ' Angle members need it for the §H1.2 (P)L/1000 eccentricity moment '
                             'even when Muy = 0.')),
                'member_type': 'combined',
            }
        flex_y = {
            'Mn': round(May_strength, 2),
            'design_strength': round(May_strength, 2),
            'controlling_mode': 'User-supplied weak-axis strength',
        }

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
    Muy_amp_no_ecc = Muy_amp

    # 설계강도
    # 상호작용은 반올림하지 않은 설계강도로 판정한다(design_strength 키는 표시용으로 반올림된 값).
    Pa = comp.get(_RAW_DS, comp['design_strength'])
    Max = flex_x.get(_RAW_DS, flex_x['design_strength'])
    May = May_strength if flex_y else 1e10

    angle_l1000_note = None
    angle_trace = None
    if not angle_exempt:
        L_angle = params.get('L', 0) or KyLy
        if not params.get('L'):
            # §H1.2 의 (P)L/1000 — L 은 H1.2 에 정의가 없다. Commentary E(앵글)는 그것을 부재의 초기 굽음 L/1000 으로,
            # §E2 는 L 을 'Laterally unbraced length of member' 로 정의한다. 부재 길이를 받지 않았으면 KyLy 로 쓴다.
            result_notes_angle = (
                _nt('member.assumption.h1_2_h1_member_length_given', KyLy=KyLy))
        else:
            result_notes_angle = None
        Padd = Pu * L_angle / 1000.0
        # 추가 편심 모멘트도 증폭한다: B1·(Muy + P̄L/1000) (Manual Example III-5B).
        Muy_with_ecc = alpha_y * (Muy + Padd)
        # 두 경우를 모두 평가하여 P 허용값이 낮은(이용률이 큰) 쪽을 지배 케이스로 채택
        inter_no_ecc = combined_axial_bending(Pu, Pa, Mux_amp, Max, Muy_amp, May)
        inter_ecc = combined_axial_bending(Pu, Pa, Mux_amp, Max, Muy_with_ecc, May)
        angle_trace = dict(L=L_angle, L_given=bool(params.get('L')), Padd=Padd, My_ecc=Muy_with_ecc,
                           My_no_ecc=Muy_amp_no_ecc, total_ecc=inter_ecc['total'],
                           total_no_ecc=inter_no_ecc['total'], ecc_governs=inter_ecc['total'] >= inter_no_ecc['total'])
        if inter_ecc['total'] >= inter_no_ecc['total']:
            Muy_amp = Muy_with_ecc
            angle_l1000_note = (
                _nt('member.assumption.h1_2_h1_my_b1y_muy', Muy_with_ecc=Muy_with_ecc, Pu=Pu, L_angle=L_angle, Padd=Padd)
            )
        else:
            angle_l1000_note = (
                _nt('member.assumption.h1_2_h1_muy', Padd=Padd)
            )

    # 상호작용 검토 (증폭된 모멘트 사용)
    h12_raw = {}
    interaction = combined_axial_bending(Pu, Pa, Mux_amp, Max, Muy_amp, May, _raw=h12_raw)

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
        'utilization': None,
        'pass': None,
        'steps': comp['steps'] + flex_x['steps'],
        'spec_sections': sorted(set(comp['spec_sections'] + flex_x['spec_sections'] + ['H1.2'])),
        # 하위 결과의 알림은 한 번만 싣는다(FIXES §3.1.1).
        'warnings': list(dict.fromkeys(comp.get('warnings', []) + flex_x.get('warnings', []))),
        'assumptions': list(dict.fromkeys(comp.get('assumptions', []) + flex_x.get('assumptions', []))),
        'scope_notes': list(dict.fromkeys(comp.get('scope_notes', []) + flex_x.get('scope_notes', []))),
    }
    # 성분 강도(Pn 또는 Mn)를 평가하지 못해 0 이면 상호작용 비는 판정 근거가 아니다.
    _component_unavailable = (
        (comp['Pn'] <= 0 and comp.get('pass') is None)
        or (flex_x['Mn'] <= 0 and flex_x.get('pass') is None))
    result['steps'].append({
        'step': 12, 'name': 'Axial + bending interaction (§H1.2, Eq. H1.2-1, §C1 B1)',
        'value': interaction['total'], 'unit': '',
        'formula': (f'Mux = B1x×{Mux:.2f} = {Mux_amp:.2f} kip-in (B1x = {alpha_x:.4f}), '
                    f'Muy = {Muy_amp:.2f} kip-in; P/Pa + Mx/Max + My/May = '
                    f"{interaction['P_ratio']:.3f} + {interaction['Mx_ratio']:.3f} + "
                    f"{interaction['My_ratio']:.3f} = {interaction['total']:.3f}"),
        'equation': 'H1.2-1',
    })
    if _component_unavailable:
        _merge_governing_check(result, {**interaction, 'pass': None}, 'H1.2 axial + bending')
        _mark_not_evaluated(result, _nt('member.ne.h1_2_h1_axial_bending_component'))
    else:
        _merge_governing_check(result, interaction, 'H1.2 axial + bending')
    if angle_trace and not angle_trace['L_given']:
        result['assumptions'].append(result_notes_angle)
    if angle_l1000_note:
        result['assumptions'].append(angle_l1000_note)
        result['angle_l1000'] = angle_l1000_note
    result['dsm_source'] = {'compression': comp.get('dsm_source'),
                            'flexure_x': flex_x.get('dsm_source')}
    if comp.get('local_not_evaluated') or flex_x.get('local_not_evaluated'):
        result['local_not_evaluated'] = True
    if comp.get('distortional_not_evaluated') or flex_x.get('distortional_not_evaluated'):
        result['distortional_not_evaluated'] = True
    if comp.get('ft_not_evaluated'):
        result['ft_not_evaluated'] = True

    # P1-5: Cm 근거 없이 보수적 1.0으로 defaulted된 경우 명시.
    # (지간 횡하중 있음 → (b)항 Cm=1.0이므로 정상, 경고 불필요)
    for axis, basis in (('x', cmx_basis), ('y', cmy_basis)):
        if basis == 'default':
            result['assumptions'].append(
                _nt('member.assumption.c1_2_1_1_c1_cm_cm_c1', axis=axis, axis_2=axis, axis_3=axis, axis_4=axis))
    if params.get('dist_M1_M2') is not None and (cmx_basis == 'default' or cmy_basis == 'default'):
        result['assumptions'].append(
            _nt('member.assumption.c1_2_1_1_c1_dist_m1_m2'))

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

    # _design_flexure가 같은 부재에 대해 수행한 G2/H2, G5/H3, 정모멘트 구간 결과와
    # 하위 설계의 미평가 항목을 조합부재 최상위 판정에 병합한다.
    for key in ('shear', 'shear_interaction', 'web_crippling', 'h3_interaction', 'positive_region'):
        if flex_x.get(key) is not None:
            result[key] = flex_x[key]
    # 압축 단독 경로의 '§H1.2 앵글 (P)L/1000 미평가'는 이 조합 검토가 바로 그 검토를 한 것이므로
    # (앵글이고 면제가 아니면 위에서 (P)L/1000 을 넣어 상호작용을 평가했다) 조합 판정에 옮기지 않는다.
    comp_for_merge = comp
    if not angle_exempt:
        comp_for_merge = dict(comp, not_evaluated=[x for x in (comp.get('not_evaluated') or [])
                                                   if not str(x).startswith('H1.2 angle')])
    _merge_sub_verdicts(result, [('[압축]', comp_for_merge), ('[휨x]', flex_x)],
                        ('E axial compression', 'F flexure'))
    _finalize_verdict(result)
    # 검토 항목: 성분(압축 · 휨x 와 그 G2/H2/G5/H3/정모멘트) + §H1.2 상호작용
    comp_checks = [c for c in comp.get('design_checks', []) if c['id'] != 'member.axial_bending']

    h12 = _mc.axial_bending_check(dict(
        dm=design_method, params=params, generated=params.get(_PROPS_GENERATED), raw=h12_raw,
        interaction=interaction, Pu=Pu, Pa=Pa, Max=Max, Mux=Mux, Mux_amp=Mux_amp, alpha_x=alpha_x, PEx=PEx,
        E=E, Ag=Ag, KxLx=KxLx, rx=rx, Cmx=Cmx, c1_alpha=c1_alpha, M1_M2_x=M1_M2_x, M1_M2_y=M1_M2_y,
        Cmx_basis=cmx_basis, Cmy_basis=cmy_basis,
        May=(May if flex_y else None), Muy=Muy, Muy_amp=Muy_amp, alpha_y=alpha_y, PEy=PEy, KyLy=KyLy, ry=ry,
        Cmy=Cmy, angle=angle_trace,
        Pa_id=_governing_check_id(comp.get('design_checks') or [], 'member.compression', Pa),
        Max_id=_governing_check_id(flex_x.get('design_checks') or [], 'member.flexure', Max),
        component_unavailable=_component_unavailable))
    result['design_checks'] = (_mc.remap_mirrors(comp_checks, 'compression')
                               + _mc.remap_mirrors(flex_x.get('design_checks', []), 'flexure_x') + [h12])
    _set_governing([h12])
    return result


def _design_combined_tension(params: dict, T_abs: float) -> dict:
    """§H1.1 조합 인장축력 + 휨 (Eq. H1.1-1, H1.1-2).

    순 인장 부재는 P-δ 모멘트 증폭을 받지 않으므로(α=1.0, 증폭 없음) Mux/Muy를 증폭하지 않는다.
    Eq. H1.1-1: Mx/Maxt + My/Mayt + T/Ta ≤ 1.0  (인장 플랜지 항복, Maxt=φb·Sft·Fy)
    Eq. H1.1-2: Mx/Max  + My/May  - T/Ta ≤ 1.0  (좌굴 — Chapter F 강도)
    """
    design_method = params.get('design_method', 'LRFD')
    Fy = params['Fy']
    Mux = abs(params.get('Mux', 0))
    Muy = abs(params.get('Muy', 0))
    props = _plain_scalars(params.get('props', {}) or {})

    # Ta — Chapter D (항복/파단)
    tens = _design_tension({**params, 'member_type': 'tension', 'Tu': T_abs})
    if 'error' in tens:
        return tens
    Ta = tens.get(_RAW_DS, tens['design_strength'])

    # 휨 (x축) — Chapter F 압축좌굴 강도 (Max, Eq. H1.1-2)
    flex_x = _design_flexure({**params, 'member_type': 'flexure', 'Mu': Mux})
    if 'error' in flex_x:
        return flex_x
    Max = flex_x.get(_RAW_DS, flex_x['design_strength'])

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
            'design_strength': tens['design_strength'],
            'controlling_mode': tens.get('controlling_mode'),
        },
        'flexure_x': {
            'Mn': flex_x['Mn'],
            'design_strength': flex_x['design_strength'],
            'controlling_mode': flex_x['controlling_mode'],
        },
        'Maxt': round(Maxt, 2),
        'Mayt': round(Mayt, 2) if Mayt < 1e9 else None,
        'interaction': interaction,
        'steps': tens.get('steps', []) + flex_x.get('steps', []),
        'spec_sections': sorted(set(tens.get('spec_sections', []) + flex_x['spec_sections'] + ['H1.1'])),
        'warnings': list(dict.fromkeys(tens.get('warnings', []) + flex_x.get('warnings', []))),
        'assumptions': list(dict.fromkeys(tens.get('assumptions', []) + flex_x.get('assumptions', []) + [
            _nt('member.assumption.h1_1_h1_maxt_sft_fy')
        ])),
        'scope_notes': list(dict.fromkeys(tens.get('scope_notes', []) + flex_x.get('scope_notes', []))),
        'pass': None,
        'utilization': None,
    }
    _merge_governing_check(result, interaction, f'{governing} tension + bending')
    for key in ('shear', 'shear_interaction', 'web_crippling', 'h3_interaction', 'positive_region'):
        if flex_x.get(key) is not None:
            result[key] = flex_x[key]
    _merge_sub_verdicts(result, [('[인장]', tens), ('[휨x]', flex_x)],
                        ('D tension', 'F flexure'))
    _finalize_verdict(result)
    h11 = _mc.tension_bending_checks(dict(
        dm=design_method, params=params, generated=params.get(_PROPS_GENERATED), T=T_abs, Ta=Ta, Mux=Mux,
        Muy=Muy, Max=Max, May=May, Maxt=Maxt, Mayt=Mayt, Sft=Sft, Fy=Fy, phi_b=phi_b, omega_b=omega_b,
        r11=r11, r12=r12,
        Ta_id=_governing_check_id(tens.get('design_checks') or [], 'member.tension', Ta),
        Max_id=_governing_check_id(flex_x.get('design_checks') or [], 'member.flexure', Max)))
    _set_governing(h11)
    result['design_checks'] = (_mc.remap_mirrors(tens.get('design_checks', []), 'tension')
                               + _mc.remap_mirrors(flex_x.get('design_checks', []), 'flexure_x') + h11)
    return result


# ============================================================
# 인장 부재 설계
# ============================================================

def _design_tension(params: dict) -> dict:
    """인장 부재 설계 (§D2, §D3)"""
    Fy = params['Fy']
    Fu = params.get('Fu')
    design_method = params.get('design_method', 'LRFD')
    Tu = params.get('Tu', 0)

    props = _plain_scalars(params.get('props', {}) or {})
    Ag = props.get('A', 0)

    if Ag <= 0:
        return {'error': 'Section area not available (A=0)'}

    warnings = []
    assumptions = []
    not_evaluated = []
    An = params.get('An')
    if An is None or An <= 0:
        An = Ag
        assumptions.append(_nt('member.assumption.d3_d3_ag'))
    if Fu is None or Fu <= 0:
        Fu = None
        not_evaluated.append(_nt('member.ne.d3_d3_rupture_fu_given'))
        warnings.append(_nt('member.warning.d3_d3_fu'))

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
    phi_r = PHI['tension_rupture']
    omega_r = OMEGA['tension_rupture']
    if Fu is not None:
        Tn_rupture = An * Fu
        steps.append({
            'step': 2, 'name': 'Rupture (D3)',
            'value': round(Tn_rupture, 2), 'unit': 'kips',
            'formula': f'Tn = An × Fu = {An:.4f} × {Fu} = {Tn_rupture:.2f}',
        })
    else:
        Tn_rupture = None

    if design_method == 'LRFD':
        str_y = phi_y * Tn_yield
        str_r = phi_r * Tn_rupture if Tn_rupture is not None else None
    else:
        str_y = Tn_yield / omega_y
        str_r = Tn_rupture / omega_r if Tn_rupture is not None else None

    if str_r is None or str_y <= str_r:
        Tn = Tn_yield
        design_strength = str_y
        mode = 'Yielding'
    else:
        Tn = Tn_rupture
        design_strength = str_r
        mode = 'Rupture'

    utilization = Tu / design_strength if Tu > 0 and design_strength > 0 else None

    result = {
        'member_type': 'tension',
        'design_method': design_method,
        'Tn': round(Tn, 2),
        'Tn_yield': round(Tn_yield, 2),
        'Tn_rupture': round(Tn_rupture, 2) if Tn_rupture is not None else None,
        'An_used': round(An, 4),
        'design_strength': round(design_strength, 2),
        _RAW_DS: design_strength,
        'controlling_mode': mode,
        'utilization': round(utilization, 4) if utilization else None,
        _UTIL_RAW: utilization if utilization else None,
        'pass': utilization <= 1.0 if utilization else None,
        'steps': steps,
        'spec_sections': ['D2', 'D3'] if Tn_rupture is not None else ['D2'],
        'warnings': warnings,
        'assumptions': assumptions,
        'scope_notes': [],
    }
    if utilization:
        result['governing_check'] = 'D tension'
        result['limit_state_checks'] = [{
            'name': 'D tension', 'ratio': round(utilization, 4), 'pass': result['pass']}]
    for item in not_evaluated:
        _mark_not_evaluated(result, item)
    _finalize_verdict(result)
    An_given = params.get('An') is not None and params.get('An') > 0
    result['design_checks'] = _checks_or_trace_error(lambda: _mc.tension_checks(dict(
        dm=design_method, params=params, generated=params.get(_PROPS_GENERATED), Tu=Tu, Ag=Ag, Fy=Fy,
        Fu=Fu, An=An, An_given=An_given, Tn_yield=Tn_yield, Tn_rupture=Tn_rupture, phi_y=phi_y,
        omega_y=omega_y, phi_r=phi_r, omega_r=omega_r, mode=mode, utilization=utilization)),
        'member.tension.yielding' if mode == 'Yielding' else 'member.tension.rupture')
    return result


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
    _pass = result.get('pass')
    status = 'OK' if _pass is True else ('NG' if _pass is False else 'N/A (판정 없음)')
    if util is not None:
        gov = f' [{result["governing_check"]}]' if result.get('governing_check') else ''
        lines.append(f'  Utilization = {util*100:.1f}%{gov} → {status}')
    else:
        lines.append(f'  Verdict = {status}')
    if result.get('not_evaluated'):
        lines.append('  Not evaluated: ' + _joined('; ', result['not_evaluated']))

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
        lines.append(f'  {h3.get("P_term_label", "0.91(P/Pn)"):<10s} = {h3["P_term"]:.4f}  ({h3.get("equation", "H3")})')
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
    for key, title in (('warnings', '⚠ WARNINGS'), ('assumptions', 'ASSUMPTIONS'),
                       ('scope_notes', 'SCOPE NOTES')):
        items = result.get(key, [])
        if items:
            lines.append('')
            lines.append(f'  {title}:')
            for w in items:
                lines.append(f'    - {w}')
    if result.get('not_checked'):
        lines.append('')
        lines.append('  NOT IMPLEMENTED (not checked): ' + _joined('; ', result['not_checked']))

    lines.append('')
    lines.append('=' * 60)
    return '\n'.join(lines)


# ============================================================
# 단면 자동 생성 + props 계산
# ============================================================

_TEMPLATE_NAME = {
    'C': 'lippedc', 'Z': 'lippedz', 'TRACK': 'track', 'HAT': 'hat', 'I': 'isect',
    'RHS': 'rhs', 'CHS': 'chs', 'ANGLE': 'angle', 'LIPPEDANGLE': 'lipped_angle', 'TEE': 'tee',
}


def _bending_reference_nodes(node, props: dict, Fy: float):
    """강축 휨 FSM 의 기준 응력분포 — 첫 항복 모멘트 Mxx_y 에서 최대 |σ| = Fy.

    항복 모멘트(yieldMP)와 응력분포(stresgen)를 같은 unsymm=0(구속 휨, 기하 x 축) 가정으로
    만든다. engine.dsm.extract_dsm_values 의 기준 My(P_ref) 도 unsymm=0 이므로
    Mcr = LF·My 가 이 분포에서 성립한다. Z 단면에 unsymm=1 응력을 쓰면 최대 응력이 Fy 의
    약 2 배가 되어 기준이 어긋난다.
    """
    from engine.stress import stresgen, yieldMP
    yield_vals = yieldMP(
        node.copy(), Fy,
        props['A'], props['xcg'], props['zcg'],
        props['Ixx'], props['Izz'], props['Ixz'],
        props['thetap'], props['I11'], props['I22'],
        unsymm=0,
    )
    return stresgen(
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
        unsymm=0,
    )


def _plain_scalars(d: dict) -> dict:
    """numpy 스칼라를 파이썬 수로 — 결과의 판정값이 np.bool_ 이 되면 JSON 직렬화가 깨진다."""
    out = {}
    for k, v in d.items():
        if hasattr(v, 'item') and getattr(v, 'ndim', 1) == 0:
            v = v.item()
        out[k] = v
    return out


def _auto_generate_props(params: dict) -> dict:
    """단면 템플릿에서 node/elem → grosprop → props 자동 생성.

    결과 params 에 '_auto_section'(생성한 단면 치수), '_auto_warnings'(경고 목록),
    실패하면 '_auto_error' 를 싣는다 — stdout 에 쓰지 않는다(server.py 가 stdout 으로
    JSON-RPC 를 말한다). design_member 는 치수가 모두 명시된 경우에만 이 함수를 부른다.
    """
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from engine.template import generate_section
    from engine.properties import grosprop
    from engine.cutwp import cutwp_prop

    params = dict(params)  # 원본 변경 방지
    auto_warnings = []

    section_type = params.get('section_type', 'lippedc')
    canon = _canonical_section_type({'section_type': section_type})
    template_name = _TEMPLATE_NAME.get(canon, str(section_type))
    # 빠진 치수를 기본값으로 채우지 않는다 — 템플릿이 거절하면 _auto_error 로 돌아간다.
    H = params.get('H') or 0.0
    B = params.get('B') or 0.0
    D = params.get('D') or 0.0
    t = params.get('t') or 0.0
    R_val = params.get('R', 0) or params.get('r', 0)
    if canon == 'HAT' and params.get('top_width'):
        H, B, D = params.get('top_width'), params.get('depth'), params.get('brim')
    tmpl = {'t': t, 'r': R_val}
    if canon == 'CHS':
        # 원형관은 바깥지름 OD 하나 — 기본 H 를 함께 넘기면 지름이 모호하다(F2 템플릿 검사).
        OD = params.get('OD') or D
        tmpl['OD'] = OD
        tmpl.pop('r')
        params['_auto_section'] = {'type': template_name, 'OD': OD, 't': t}
    else:
        tmpl.update({'H': H, 'B': B})
        if canon in ('C', 'Z', 'LIPPEDANGLE', 'HAT', 'SIGMA'):
            tmpl['D'] = D
        for k in ('qlip', 'nseg'):
            if params.get(k) is not None:
                tmpl[k] = params[k]
        params['_auto_section'] = {'type': template_name, **tmpl}

    try:
        sec = generate_section(template_name, tmpl)
        node = sec['node']
        elem = sec['elem']

        props = _plain_scalars(grosprop(node, elem))

        # CUTWP 성질 추가
        try:
            cw = cutwp_prop(node, elem)
            props['J'] = float(cw.get('J', 0))
            props['Cw'] = float(cw.get('Cw', 0))
            props['Xs'] = float(cw.get('Xs', 0))
            props['Zs'] = float(cw.get('Zs', 0))
        except Exception as e:
            # cutwp 실패 시 J/Cw=0 → 하류 compute_column_Fcre가 Fcre=0(→Pne=0)을 산출하는
            # 근본 원인이다. 삼키지 않고 결과 경고로 표면화한다.
            props['J'] = 0
            props['Cw'] = 0
            props['cutwp_failed'] = True
            auto_warnings.append(f'cutwp_prop failed (J/Cw=0 → Fcre may be 0): {e}')

        # §E2.2/§F2.1: 전단중심 편심 xo = |Xs - xcg| (도심~전단중심 x거리).
        # 단축대칭 C-단면은 xo≠0 → compute_column_Fcre가 휨-비틀림좌굴 분기를 탄다.
        # 대칭축이 z 인 단면(hat)은 xo=0 이고 Zs−zcg 로 resolve_xo_ro 가 대칭축을 판정한다.
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

        # ── DSM 적용한계/웹 크리플링용 평탄폭(props)과 해석식용 외-외 치수(section) ──
        st_norm = str(template_name).strip().lower().replace('-', '_')
        Rf = R if R > 0 else 0.0
        corner = Rf + t  # 한 내측 코너의 평탄폭 환산량 (out-to-out → flat)
        sect = dict(params.get('section') or {})
        sect.setdefault('type', section_type)
        sect.setdefault('thickness', t)
        if R > 0:
            sect.setdefault('r', R)
        if canon == 'CHS':
            # 원형관: 판요소 평탄폭이 없다. 외경만 넘긴다(§F2.3 D/t).
            sect.setdefault('diameter', tmpl['OD'])
        elif canon == 'HAT':
            # hat: H = 상판 폭, B = 깊이(웹), D = 브림(engine/template.py) — 이름 있는 키로 넘긴다.
            sect.setdefault('top_width', H)
            sect.setdefault('hat_depth', B)
            sect.setdefault('brim', D)
            props.setdefault('h_web', max(B - 2 * corner, 0.0))
            props.setdefault('b_flange', max(H - 2 * corner, 0.0))
            props.setdefault('d_lip', 0.0)
        else:
            has_lip = canon in ('C', 'Z', 'LIPPEDANGLE')
            is_angle = 'angle' in st_norm
            # 웹: 양 끝 2개 내측 코너
            h_web_flat = max(H - 2 * corner, 0.0)
            # 플랜지: 웹-플랜지 코너 1개 + (립 있으면) 플랜지-립 코너 1개
            if has_lip and not is_angle:
                b_flange_flat = max(B - 2 * corner, 0.0)
            elif canon == 'RHS':
                b_flange_flat = max(B - 2 * corner, 0.0)
            else:
                # 무립(track/앵글 다리/I·T 플랜지): 코너 1개
                b_flange_flat = max(B - corner, 0.0)
            # 립: 끝단 자유, 플랜지-립 코너 1개
            d_lip_flat = max(D - corner, 0.0) if (has_lip and D > 0) else 0.0
            if h_web_flat > 0:
                props.setdefault('h_web', h_web_flat)
            if b_flange_flat > 0:
                props.setdefault('b_flange', b_flange_flat)
            props.setdefault('d_lip', d_lip_flat)
            sect.setdefault('depth', H)
            sect.setdefault('flange_width', B)
            sect.setdefault('lip_depth', D if has_lip else 0.0)
            if params.get('qlip') is not None:
                sect.setdefault('qlip', params['qlip'])
        params['section'] = sect

        # DSM 값도 자동 계산
        if not params.get('dsm'):
            try:
                from engine.fsm_solver import stripmain
                from engine.dsm import extract_dsm_values
                from cfsm.classify import classify
                from models.data import GBTConfig
                import numpy as np

                prop_mat = np.array([[100, 29500, 29500, 0.3, 0.3, 11300]])  # G per AISI §A3.1
                Fy = params['Fy']   # design_member 가 확인한 설계 Fy

                node_p = node.copy()
                for n in node_p:
                    n[7] = Fy
                node_m = _bending_reference_nodes(node, props, Fy)

                lengths = np.logspace(0, 3, 60)
                m_all = [np.array([1.0]) for _ in lengths]
                gbt_config = GBTConfig()
                result_p = stripmain(prop_mat, node_p, elem, lengths,
                                     np.array([]), np.array([]),
                                     gbt_config, 'S-S', m_all, neigs=10)
                result_m = stripmain(prop_mat, node_m, elem, lengths,
                                     np.array([]), np.array([]),
                                     gbt_config, 'S-S', m_all, neigs=10)

                # 분류는 CUFSM 기본 기저(None: orth 2, norm 1)로 한다. 둥근 코너·폐단면 등
                # 고전 cFSM 이 다루지 못하는 모델은 NaN 행으로 오고, dsm 이 휴리스틱으로 처리한다.
                class_p = classify(prop_mat, node_p, elem, lengths, result_p.shapes,
                                   None, 'S-S', m_all)
                class_m = classify(prop_mat, node_m, elem, lengths, result_m.shapes,
                                   None, 'S-S', m_all)

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
                    'fy_analysis': Fy,
                    'P_classification_method': dsmP.get('classification_method', 'none'),
                    'P_local_detected': dsmP.get('local_detected', False),
                    'P_dist_detected': dsmP.get('dist_detected', False),
                    'M_classification_method': dsmM.get('classification_method', 'none'),
                    'M_local_detected': dsmM.get('local_detected', False),
                    'M_dist_detected': dsmM.get('dist_detected', False),
                }
                for _pre, _src in (('P_', dsmP), ('M_', dsmM)):
                    for _k in ('local_absence_verified', 'dist_absence_verified', 'local_isolated',
                               'dist_isolated', 'single_minimum', 'LF_single_minimum',
                               'single_minimum_bound', 'boundary_minimum',
                               'reference_stress_consistent', 'warnings'):
                        if _k in _src:
                            params['dsm'][_pre + _k] = _src[_k]
                params['dsm'] = _plain_scalars(params['dsm'])
            except Exception as e:
                auto_warnings.append(_nt('member.warning.auto_fsm_failed', e=e))

        params['props'] = props
        params['node'] = node.tolist()
        params['elem'] = elem.tolist()

    except Exception as e:
        params['_auto_error'] = str(e)

    params['_auto_warnings'] = auto_warnings
    return params
