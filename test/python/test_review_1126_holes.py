"""2026-11-26 EA — 구멍이 있는 부재: §E2.5 · §E3.2.2 · §E4.2 · §F2.2 · §F3.2.2 · §F4.2 와 부록 2 의 탄성 좌굴.

기준값의 출처(aisi-cold-formed-steel 스킬, 이 세션에서 연 글):
- Design Manual Example II-14 (Lipped C-Section With Web Perforations by DSM — Flexure, 550S162-33, Fy = 33 ksi,
  dh = 1.5 in, Lh = 4.5 in, s = 24 in): Mcrℓnh = 17.6, Mcrℓh = 9.60 (Lcrℓh = 3.80 in), Lcrd = 16.6, tr = 0.0311,
  Mcrd = 20.5 kip-in (gross 23.4), My = 18.0, Mynet = 17.8, Mnℓ = 12.4, λd = 0.937, λd2 = 0.708, Mnd = 14.7,
  Mn = 12.4, φMn = 11.2, Mn/Ω = 7.43 kip-in.
- Design Manual Example III-4 (C-Section With Lips With Holes — Compression — DSM, 550S162-33, KxLx = 96,
  KyLy = KtLt = 48 in): A = 0.327, Anet = 0.275, Ix = 1.46 / 1.45, Iy = 0.113 / 0.100, xo = −1.11 / −1.20,
  J = 0.000130 / 0.000110, Cw = 0.713 / 0.677 (gross / net); Ix,avg = 1.46, Iy,avg = 0.111, Aavg = 0.317,
  Javg = 0.000126, xo,avg = −1.13, ro,avg = 2.50, β = 0.796, σex = 141, σey = 42.9, σt = 42.6, Fcre = 39.5 ksi,
  Pne = 7.62, Pcrℓ = 1.34, Pnℓ = 3.52, Pynet = 9.08, Lcrd = 19.3, kφfe = 0.0493, k̃φfg = 0.00251, tr = 0.0317,
  kφwe = 0.0313, k̃φwg = 0.00233, Fcrd = 16.7 ksi, Pcrd = 5.46, Py = 10.8, λd = 1.41, λd2 = 1.13, Pnd = 5.98 kips.
- §E4.2 / §F4.2 의 전이 갈래(Eq. E4.2-1/-2, F4.2-1/-2)는 두 예제가 닿지 않는다 — 아래에 손계산을 적었다.
"""

import json
import math
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'python'))
sys.path.insert(0, HERE)

from design.aisi_s100 import design_member  # noqa: E402
from design import holes as H  # noqa: E402
from design.dsm_strength import (  # noqa: E402
    compression_local, compression_distortional_holes, flexure_local, flexure_distortional_holes)
from design.global_buckling import compute_column_Fcre, column_global_strength  # noqa: E402
import test_review_1124_trace_recompute as TR  # noqa: E402

SEC = dict(section_type='lippedc', H=5.5, B=1.625, D=0.5, t=0.0346, R=0.0764, Fy=33.0, design_method='LRFD')
HOLE = dict(hole_shape='noncircular', hole_depth=1.5, hole_length=4.5, hole_spacing=24.0)
_RUNS = {}


def run(**kw):
    key = json.dumps(kw, sort_keys=True, default=str)
    if key not in _RUNS:
        _RUNS[key] = design_member(dict(kw))
    return _RUNS[key]


def rel(a, b):
    return abs(a / b - 1.0)


def checks(r):
    return {c['id']: c for c in r['design_checks']}


def _model():
    from engine.template import generate_section
    import numpy as np
    sec = generate_section('lippedc', {'H': 5.5, 'B': 1.625, 'D': 0.5, 't': 0.0346, 'r': 0.0764})
    return np.asarray(sec['node'], float), np.asarray(sec['elem'], float), sec['element_roles']


# ------------------------------------------------------------------ Example II-14 (휨, FSM)
def test_ii14_strength_equations_with_the_manual_elastic_values():
    """Manual II-14 의 탄성값(My 18.0, Mynet 17.8, Mcrℓ 9.60, Mcrd 20.5)으로 §F3.2.2 · §F4.2 의 강도를 다시 낸다."""
    My, Mynet = 18.0, 17.8
    loc = flexure_local(My, 9.60)                     # Mne = My (완전 횡지지)
    assert loc['equation'] == 'F3.2.1-2' and round(loc['lambda_l'], 2) == 1.37
    Mnl = min(loc['Mnl'], Mynet)                      # Eq. F3.2.2-1
    assert round(Mnl, 1) == 12.4 and loc['Mnl'] < Mynet
    d = flexure_distortional_holes(My, Mynet, 20.5)
    assert round(d['lambda_d'], 3) == 0.937 and round(d['lambda_d2'], 3) == 0.708
    assert d['equation'] == 'F4.1-2' and round(d['Mnd'], 1) == 14.7     # λd > λd2 → §F4.1
    Mn = min(My, Mnl, d['Mnd'])
    Mr = round(Mn, 1)                                 # Manual 은 Mn = 12.4 로 반올림한 뒤 φ · Ω 를 쓴다
    assert Mr == 12.4 and round(0.90 * Mr, 1) == 11.2 and round(Mr / 1.67, 2) == 7.43


def test_ii14_elastic_values_from_this_programs_fsm():
    """같은 단면(템플릿 lippedc, 안쪽 반경 0.0764 in)을 이 프로그램의 FSM 으로: Manual 의 CUFSM 값과 견준다."""
    node, elem, roles = _model()
    hole = H.parse(HOLE)
    m = H.build_models(node, elem, roles, hole)
    assert m['ok'] and abs(m['net']['A'] - (m['gross']['A'] - 1.5 * 0.0346)) < 1e-6
    assert rel(m['gross']['A'], 0.327) < 0.005 and rel(m['net']['A'], 0.275) < 0.005
    loc = H.local_net(m, H.FSM_PROP_DEFAULT, 33.0, 'M', 4.5)
    assert rel(loc['value'], 9.60) < 0.02 and rel(loc['L'], 3.80) < 0.05 and not loc['at_hole_length']
    gd = H._gross_dsm(H.FSM_PROP_DEFAULT, node, elem, 33.0, 'M', None, 'C')
    assert rel(gd['crl'], 17.6) < 0.02 and rel(gd['crd'], 23.4) < 0.01
    # 총단면 Lcrd: 이 격자의 극소 17.87 in, Manual 16.6 in(곡선이 극소 근처에서 평평하다) — tr 은 Lcrd 에 둔하다
    assert rel(gd['Lcrd'], 16.6) < 0.10
    web = H._web_chain(node, elem, roles)[0]['elems']
    for Lcrd, tr in ((16.6, 0.0311), (gd['Lcrd'], None)):
        d = H.distortional_reduced(node, elem, web, H.FSM_PROP_DEFAULT, 33.0, 'M', 4.5, Lcrd)
        if tr:
            assert round(d['tr'], 4) == tr
        assert rel(d['value'], 20.5) < 0.01, (Lcrd, d['value'])     # 기준 하중을 줄인 단면에(Manual 의 20.5)


def test_ii14_member_check():
    """설계 엔진 전체: §F2.2 · §F3.2.2 · §F4.2 의 같은 id(조항 갈래), Mn ≈ 12.4 (이 FSM 의 My 17.49 kip-in 은 Manual 의
    18.0 보다 2.8 % 낮다 — Mn 12.11)."""
    r = run(**SEC, member_type='flexure', Mu=10.0, Lb=0.0, **HOLE)
    assert 'error' not in r and r['holes']['evaluated'] is True and r['holes_evaluated'] is True
    c = checks(r)
    assert [c[k]['clause'] for k in ('member.flexure.global', 'member.flexure.local', 'member.flexure.distortional')] \
        == ['F2.2', 'F3.2.2', 'F4.2']
    assert all(c[k].get('clause_variant') == 'holes' for k in ('member.flexure.local', 'member.flexure.distortional'))
    du = r['display_unrounded']
    assert rel(du['Mn'], 12.4) < 0.03 and r['controlling_mode'] == 'Local Buckling'
    assert du['Mnl'] <= du['Mynet'] and rel(du['Mynet'] / du['My'], 17.8 / 18.0) < 0.005
    assert rel(du['Mnd'], 14.7) < 0.03
    assert r['pass'] is True and c['member.applicability.holes']['verdict'] == 'pass' \
        and c['member.applicability.holes']['counts'] is False
    assert not any('구멍을 입력하지 않았습니다' in str(s) for s in r['scope_notes'])
    assert 'F3.2.2' in r['spec_sections'] and 'F4.2' in r['spec_sections']


# ------------------------------------------------------------------ Example III-4 (압축, 해석식)
def _iii4_hc():
    g = dict(A=0.327, Ixx=1.46, Izz=0.113, I22=0.113, J=0.000130, Cw=0.713, xo=1.11)
    n = dict(A=0.275, Ixx=1.45, Izz=0.100, I22=0.100, J=0.000110, Cw=0.677, xo=1.20)
    return {'gross': g, 'net': n, 'hole': H.parse(HOLE), 'Ag': 0.327, 'section_type': 'C'}


def test_iii4_weighted_average_global_buckling():
    """표 2.3.2-1 · Eq. 2.3.2.1.2-1 … -4 · 2.3.2.1.1-1 을 Manual III-4 의 총단면 · 순단면 성질로."""
    hc = _iii4_hc()
    assert H.holes_in_length(96.0, 4.5, 24.0) == 4 and H.holes_in_length(48.0, 4.5, 24.0) == 2
    av = H.column_average_props(hc, 96.0, 48.0, 48.0)
    t = av['trace']
    assert t['fx']['Lnet'] == 18.0 and t['fy']['Lnet'] == 9.0 and t['ft']['Lg'] == 39.0
    assert round(t['Ix_avg'], 2) == 1.46 and round(t['Iy_avg'], 3) == 0.111 and round(t['A_avg'], 3) == 0.317
    assert round(t['J_avg'], 6) == 0.000126 and round(t['xo_avg'], 2) == 1.13 and rel(t['ro_avg'], 2.50) < 0.005    # Manual 은 반올림한 평균값으로 2.50
    fr = compute_column_Fcre(av['props'], 33.0, 96.0, 48.0, 48.0)
    # Manual 은 반올림한 평균값(Iy,avg = 0.111 …)으로 σey = 42.9 — 반올림 전 값으로는 42.7
    assert round(fr['sigma_ex']) == 141 and rel(fr['sigma_ey'], 42.9) < 0.006 and rel(fr['sigma_t'], 42.6) < 0.006
    assert round(fr['trace']['beta'], 3) == 0.796 and rel(fr['Fcre'], 39.5) < 0.005    # 반올림 전 39.63
    assert fr['buckling_type'] == 'flexural-torsional'
    assert round(column_global_strength(33.0, fr['Fcre'], 0.327)['Pne'], 2) == 7.62


def test_iii4_strengths_from_the_manual_elastic_values():
    Pne = column_global_strength(33.0, 39.5, 0.327)['Pne']
    assert rel(Pne, 7.62) < 0.002                       # Manual: Fn = 23.3 로 반올림 → 7.62
    loc = compression_local(7.62, 1.34)                   # Manual 은 Pne = 7.62 로 반올림해 쓴다
    Pynet = 0.275 * 33.0
    assert round(loc['lambda_l'], 2) == 2.38 and round(min(loc['Pnl'], Pynet), 2) == 3.52 and round(Pynet, 2) == 9.08
    d = compression_distortional_holes(0.327 * 33.0, Pynet, 5.46)
    # Eq. E4.2-5 를 Py = 10.8, Pynet = 9.08 로 풀면 1.125 — Manual 은 1.13 으로 적었다(갈래는 같다: λd = 1.41 > λd2)
    assert round(d['lambda_d'], 2) == 1.41 and rel(d['lambda_d2'], 1.13) < 0.006
    assert d['equation'] == 'E4.1-2' and round(d['Pnd'], 2) == 5.98


def test_iii4_analytic_distortional_with_holes():
    """§2.3.2.3: Eq. 2.3.1.3-4 · -6 의 t → tr. Manual 은 tr 을 0.0317 로 반올림해 쓴다(그래서 Fcrd 가 0.6 % 높다)."""
    t = 0.0346
    an = {'ho': 5.5, 'b': 1.625 - t, 'd': 0.5 - t / 2, 't': t, 'theta': 90.0}
    d = H.distortional_analytic(an, 4.5, flexure=False)
    assert round(d['Lcrd'], 1) == 19.3 and round(d['tr'], 4) == 0.0317
    assert round(d['stiff']['k_phi_fe'], 4) == 0.0493 and round(d['stiff']['k_tilde_phi_fg'], 5) == 0.00251
    assert rel(d['stiff']['k_phi_we'], 0.0313) < 0.01 and rel(d['stiff']['k_tilde_phi_wg'], 0.00233) < 0.01
    assert rel(d['F'], 16.7) < 0.01 and rel(d['F'] * 0.327, 5.46) < 0.01


def test_iii4_member_check():
    """설계 엔진 전체(템플릿 단면): §E2.5 의 Pne ≈ 7.62, 압축 서명곡선에 뒤틀림 극소가 없어 총단면 Pcrd 는 부록 2
    해석식 → 구멍도 §2.3.2.3 해석식(tr) → Pnd ≈ 5.98. 국부는 이 FSM 의 Pcrℓ(해석식 1.34 보다 크다)."""
    r = run(**SEC, member_type='compression', Pu=2.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, **HOLE)
    du = r['display_unrounded']
    assert rel(du['Pne'], 7.62) < 0.005 and rel(du['Pnd'], 5.98) < 0.01 and rel(du['Pynet'], 9.08) < 0.005
    assert du['Pnl'] <= du['Pynet']
    assert r['holes']['distortional_method_P'] == 'analytic'
    c = checks(r)
    assert [c[k]['clause'] for k in ('member.compression.global', 'member.compression.local',
                                     'member.compression.distortional')] == ['E2.5', 'E3.2.2', 'E4.2']
    assert r['pass'] is True


# ------------------------------------------------------------------ §E4.2 · §F4.2 전이 (손계산)
def test_e42_transition_hand_calculation():
    Py, Pynet = 10.0, 8.0
    ld1 = 0.561 * 0.8
    ld2 = 0.561 * (14.0 * 1.25 ** 0.4 - 13.0)
    Pd2 = (1 - 0.25 * (1 / ld2) ** 1.2) * (1 / ld2) ** 1.2 * Py
    d = compression_distortional_holes(Py, Pynet, 100.0)          # λd = 0.316 ≤ λd1 → Eq. E4.2-1
    assert d['equation'] == 'E4.2-1' and d['Pnd'] == Pynet
    d = compression_distortional_holes(Py, Pynet, 20.0)           # λd = 0.707 ∈ (λd1, λd2]
    lam = math.sqrt(Py / 20.0)
    assert d['equation'] == 'E4.2-2' and ld1 < lam <= ld2
    assert abs(d['Pnd'] - (Pynet - (Pynet - Pd2) / (ld2 - ld1) * (lam - ld1))) < 1e-12
    assert abs(d['lambda_d2'] - ld2) < 1e-12 and abs(d['Pd2'] - Pd2) < 1e-12


def test_f42_transition_hand_calculation():
    My, Mynet = 10.0, 9.0
    ld1 = 0.673 * 0.9 ** 3
    ld2 = 0.673 * (1.7 * (10 / 9) ** 2.7 - 0.7)
    Md2 = (1 - 0.22 / ld2) / ld2 * My
    d = flexure_distortional_holes(My, Mynet, 100.0)              # λd = 0.316 ≤ λd1 = 0.491
    assert d['equation'] == 'F4.2-1' and d['Mnd'] == Mynet
    d = flexure_distortional_holes(My, Mynet, 20.0)               # λd = 0.707 ∈ (0.491, 1.050]
    lam = math.sqrt(My / 20.0)
    interp = Mynet - (Mynet - Md2) / (ld2 - ld1) * (lam - ld1)
    cap = (1 - 0.22 * math.sqrt(2.0)) * math.sqrt(2.0) * My
    assert d['equation'] == 'F4.2-2' and abs(d['Mnd'] - min(interp, cap)) < 1e-12 and interp < cap


# ------------------------------------------------------------------ 적용범위(결정 T3)
def _ne(r):
    return ' '.join(str(x) for x in r.get('not_evaluated') or [])


def _assert_not_evaluated(r, code, fam_checks):
    assert 'error' not in r, r.get('error')
    assert r['holes']['evaluated'] is False and r['holes_evaluated'] is False
    assert code in _codes(r), (code, _codes(r))
    c = checks(r)
    for k in fam_checks:
        assert c[k]['verdict'] == 'not_evaluated', (k, c[k]['verdict'])
    assert c['member.applicability.holes']['verdict'] == 'not_evaluated'
    assert c['member.applicability.holes']['reason_parts'] or c['member.applicability.holes']['reason_code']
    assert r['pass'] is None
    for item in r.get('limit_state_checks') or []:
        assert item['pass'] is None


FLEX = ('member.flexure.global', 'member.flexure.local', 'member.flexure.distortional')
COMP = ('member.compression.global', 'member.compression.local', 'member.compression.distortional')


def _codes(r):
    out = []
    for e in r['holes'].get('reasons_notices') or r['holes'].get('notices') or []:
        out.append(e.get('code'))
    return out


def test_inside_the_limits_is_evaluated():
    r = run(**SEC, member_type='flexure', Mu=10.0, Lb=0.0, **HOLE)
    assert r['holes']['evaluated'] and checks(r)['member.applicability.holes']['verdict'] == 'pass'


def test_section_type_outside_is_not_evaluated():
    r = run(section_type='hat', top_width=4.0, depth=3.0, brim=1.5, t=0.06, R=0.1, Fy=50.0, member_type='flexure',
            Mu=5.0, Lb=0.0, **HOLE)
    _assert_not_evaluated(r, 'member.reason.holes_section_not_covered', ('member.flexure.global',
                                                                          'member.flexure.local'))
    assert 'member.reason.holes_section_not_covered' in _codes(r)


def test_web_not_identified_and_model_missing():
    """호스트처럼 props 를 주는 경로: 모델(node · elem)이 없거나 요소 자리(element_roles)가 없으면(직접 그린 단면) 평가하지 못함."""
    node, elem, roles = _model()
    from design.holes import section_properties
    props = section_properties(node, elem)
    props.update(t=0.0346, R=0.0764)
    common = dict(Fy=33.0, design_method='LRFD', member_type='compression', Pu=1.0, KxLx=48.0, KyLy=48.0,
                  KtLt=48.0, section_type='C', props=props, **HOLE)
    r = run(**common)                                         # 모델 없음
    _assert_not_evaluated(r, 'member.reason.holes_model_missing', COMP[:2])
    assert 'member.reason.holes_model_missing' in _codes(r)
    r = run(**common, node=node.tolist(), elem=elem.tolist())     # 요소 자리 없음(손으로 그린 단면)
    assert 'member.reason.holes_web_not_identified' in _codes(r)
    assert r['pass'] is None
    # 호스트가 모델 · 요소 자리 · 총단면 설계 서명곡선의 값(dsm)을 넘기면 평가 — 템플릿 자동 경로와 같은 수
    gd = H._gross_dsm(H.FSM_PROP_DEFAULT, node, elem, 33.0, 'P', None, 'C')
    dsm = {'Pcrl': gd['crl'], 'Pcrd': gd['crd'], 'P_Lcrd': gd['Lcrd'], 'fy_analysis': 33.0}
    section = {'type': 'C', 'depth': 5.5, 'flange_width': 1.625, 'lip_depth': 0.5, 'thickness': 0.0346, 'r': 0.0764}
    r = run(**common, node=node.tolist(), elem=elem.tolist(), element_roles=roles, dsm=dsm, section=section)
    auto = run(**SEC, member_type='compression', Pu=1.0, KxLx=48.0, KyLy=48.0, KtLt=48.0, **HOLE)
    assert r['holes']['evaluated'] and r['pass'] is True and auto['pass'] is True
    for k in ('Pne', 'Pnl', 'Pnd', 'Pynet'):
        assert rel(r['display_unrounded'][k], auto['display_unrounded'][k]) < 1e-6, k


def test_hole_outside_the_flat_web():
    r = run(**SEC, member_type='flexure', Mu=5.0, Lb=0.0, **{**HOLE, 'hole_depth': 5.3})
    assert 'member.reason.holes_outside_web' in _codes(r) and r['pass'] is None


def test_off_centre_hole_is_not_evaluated():
    """가운데가 아닌 구멍은 순단면이 대칭이 아니다 — 비대칭 단면의 구멍 전체좌굴(§2.3.2.1.4)은 구현하지 않았다."""
    r = run(**SEC, member_type='compression', Pu=1.0, KxLx=48.0, KyLy=48.0, KtLt=48.0, **HOLE, hole_web_offset=0.5)
    _assert_not_evaluated(r, 'member.reason.holes_offset_unsymmetric', COMP)


def test_edge_stiffened_hole():
    r = run(**SEC, member_type='flexure', Mu=5.0, Lb=0.0, **HOLE, hole_edge_stiffened=True)
    assert 'member.reason.holes_edge_stiffened' in _codes(r) and r['pass'] is None


def test_spacing_below_lcrd_and_hole_longer_than_lcrd():
    r = run(**SEC, member_type='flexure', Mu=5.0, Lb=0.0, **{**HOLE, 'hole_spacing': 10.0})
    _assert_not_evaluated(r, 'member.reason.holes_spacing_below_lcrd', FLEX)
    assert 'member.reason.holes_spacing_below_lcrd' in _codes(r)
    r = run(**SEC, member_type='flexure', Mu=5.0, Lb=0.0, **{**HOLE, 'hole_length': 20.0, 'hole_spacing': 60.0})
    assert 'member.reason.holes_lh_not_below_lcrd' in _codes(r) and r['pass'] is None


def test_not_evaluated_never_gives_a_pass_from_gross_values_but_a_certain_failure_stands():
    """구멍 조항을 평가하지 못하면 구멍 없는 값으로 합격을 내지 않는다. 2026-11-26 독립 검증 2 로 바뀐 기대: 소요가 구멍
    없는 상한(구멍은 강도를 낮추기만 한다 — 식이 보장하는 상한)의 설계강도를 넘으면 구멍이 있어도 넘는다 → 불합격(그 까닭).
    옛 기대(소요가 강도의 몇 배라도 판정 없음)는 확실한 불합격을 감추었다."""
    r = run(**SEC, member_type='flexure', Mu=500.0, Lb=0.0, **{**HOLE, 'hole_spacing': 10.0})
    assert r['pass'] is False and all(checks(r)[k]['verdict'] == 'fail' for k in FLEX)
    assert all(checks(r)[k]['reason_code'] == 'member.reason.fails_without_holes' for k in FLEX)
    assert r['holes_strength_bound']['ratio'] > 1.0
    r = run(**SEC, member_type='flexure', Mu=2.0, Lb=0.0, **{**HOLE, 'hole_spacing': 10.0})
    assert r['pass'] is None and all(checks(r)[k]['verdict'] == 'not_evaluated' for k in FLEX)
    assert all((checks(r)[k].get('reference') or {}).get('capacity') for k in FLEX)       # 참고값은 남는다
    r = run(**SEC, member_type='compression', Pu=500.0, **{**HOLE, 'hole_edge_stiffened': True})
    assert r['pass'] is False and 'length_independent_bound' not in r and 'holes_strength_bound' in r


def test_input_errors():
    for bad in ({'hole_depth': 1.5}, {**HOLE, 'hole_shape': 'triangle'}, {**HOLE, 'hole_spacing': 4.0},
                {'hole_shape': 'circular', 'hole_depth': 1.5, 'hole_length': 2.0, 'hole_spacing': 24.0},
                {'hole_shape': 'noncircular', 'hole_depth': 1.5, 'hole_spacing': 24.0},
                {**HOLE, 'hole_depth': -1.0}):
        r = design_member({**SEC, 'member_type': 'flexure', 'Mu': 5.0, 'Lb': 0.0, **bad})
        assert 'error' in r and r['error'].startswith('holes:'), bad
    ok = H.parse({'hole_shape': 'circular', 'hole_depth': 1.5, 'hole_spacing': 24.0})
    assert ok['Lh'] == 1.5 and ok['web_offset'] == 0.0


# ------------------------------------------------------------------ 구멍 입력 없음(결정 T4)
def test_no_hole_results_equal_the_stored_results_before_holes():
    """HEAD 8f98c82(구멍 구현 전)의 엔진으로 낸 값(holes_1126_nohole_fixture.json) — 수 · 판정 · 검토 항목이 같다."""
    with open(os.path.join(HERE, 'holes_1126_nohole_fixture.json'), encoding='utf-8') as f:
        want = json.load(f)
    cases = {
        'comp': dict(SEC, member_type='compression', Pu=2.0, KxLx=96.0, KyLy=48.0, KtLt=48.0),
        'flex': dict(SEC, member_type='flexure', Mu=10.0, Lb=48.0, Cb=1.0),
        'comb': dict(SEC, member_type='combined', Pu=1.0, Mux=5.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0),
        'comp_blank': dict(SEC, member_type='compression', Pu=2.0),
    }
    keys = ('Pn', 'Pne', 'Pnl', 'Pnd', 'Mn', 'Mne', 'Mnl', 'Mnd', 'design_strength', 'utilization', 'pass')
    for name, p in cases.items():
        r = design_member(dict(p))
        du = r.get('display_unrounded') or {}
        got = {k: du.get(k, r.get(k)) for k in keys if k in r}
        got['checks'] = {c['id']: [c['verdict'], (c.get('capacity') or {}).get('value')] for c in r['design_checks']}
        if name == 'comb':
            got['interaction'] = r['interaction']['total']
        assert got == want[name], name
        assert 'holes' not in r and 'Pynet' not in r and 'Mynet' not in r
        assert any(getattr(s, 'code', None) == 'member.scope.holes_not_entered'
                   or '구멍을 입력하지 않았습니다' in str(s) for s in r['scope_notes'])


def test_no_hole_input_never_runs_the_hole_code():
    # pytest 의 monkeypatch 를 쓰지 않는다 — run_all.py 는 시험 함수를 인자 없이 부른다(직접 바꾸고 끝에 되돌린다).
    import design.aisi_s100 as A

    def boom(*a, **k):
        raise AssertionError('hole code reached without hole input')
    names = ('evaluate', 'column_average_props', 'beam_average_props', 'distortional_fsm',
             'distortional_from_analytic', 'summary')
    saved = {name: getattr(A._holes, name) for name in names}
    try:
        for name in names:
            setattr(A._holes, name, boom)
        for p in (dict(SEC, member_type='compression', Pu=2.0, KxLx=96.0, KyLy=48.0, KtLt=48.0),
                  dict(SEC, member_type='flexure', Mu=10.0, Lb=48.0, Mu_pos=5.0, Lb_pos=24.0),
                  dict(SEC, member_type='combined', Pu=1.0, Mux=5.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0),
                  dict(SEC, member_type='flexure', Mu=10.0, Lb=48.0, hole_shape=None, hole_depth=None)):
            r = design_member(p)
            assert 'error' not in r and 'holes' not in r
    finally:
        for name, fn in saved.items():
            setattr(A._holes, name, fn)


# ------------------------------------------------------------------ 조합 · 빈 길이 · 정모멘트 구간
def test_combined_member_uses_the_hole_strengths():
    comb = run(**SEC, member_type='combined', Pu=1.0, Mux=5.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0, **HOLE)
    comp = run(**SEC, member_type='compression', Pu=1.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, **HOLE)
    flex = run(**SEC, member_type='flexure', Mu=5.0, Lb=48.0, **HOLE)
    assert comb['holes']['compression_evaluated'] and comb['holes']['flexure_evaluated']
    du = comb['display_unrounded']
    assert du['compression']['design_strength'] == comp['display_unrounded']['design_strength']
    assert du['flexure_x']['design_strength'] == flex['display_unrounded']['design_strength']
    c = checks(comb)
    assert c['member.compression.local']['clause'] == 'E3.2.2' and c['member.flexure.global']['clause'] == 'F2.2'
    assert c['member.axial_bending']['verdict'] == 'pass'
    # 구멍 조항을 평가하지 못한 조합 — §H1.2 는 판정 없음. 다만 구멍 없는 상한으로도 넘으면 불합격(2026-11-26 독립
    # 검증 2 로 바뀐 기대: 옛 시험은 Pu = 50 · Mux = 500 (강도의 몇 배)도 판정 없음으로 두었다)
    bad = run(**SEC, member_type='combined', Pu=50.0, Mux=500.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0,
              **{**HOLE, 'hole_edge_stiffened': True})
    cb = checks(bad)
    assert cb['member.axial_bending']['verdict'] == 'fail' and bad['pass'] is False
    assert cb['member.axial_bending']['reason_code'] == 'member.reason.fails_without_holes'
    small = run(**SEC, member_type='combined', Pu=0.5, Mux=2.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0,
                **{**HOLE, 'hole_edge_stiffened': True})
    assert checks(small)['member.axial_bending']['verdict'] == 'not_evaluated' and small['pass'] is None


def test_blank_lengths_with_holes_use_the_most_favourable_length():
    """빈 KxLx · KyLy · KtLt: 길이와 상관없는 상한은 min(Py, Pnℓ(Pne = Py) ≤ Pynet, Pnd(§E4.2)) — 그 설계강도를 넘으면
    어느 길이에서나 불합격, 아니면 판정 없음(가정한 길이의 비는 참고값)."""
    r = run(**SEC, member_type='compression', Pu=1.0, **HOLE)
    b = r['length_independent_bound']
    du = r['display_unrounded']
    assert b['Pn'] <= min(du['Py'], du['Pynet']) + 1e-12 and b['Pn'] <= du['Pnd'] + 1e-12
    assert r['pass'] is None and r['holes']['evaluated']
    big = run(**SEC, member_type='compression', Pu=0.85 * b['Pn'] * 1.01, **HOLE)
    assert big['pass'] is False
    fl = run(**SEC, member_type='flexure', Mu=1.0, **HOLE)
    assert fl['length_independent_bound']['Mn'] <= fl['display_unrounded']['Mynet'] + 1e-12 and fl['pass'] is None


def test_positive_region_with_holes():
    r = run(**SEC, member_type='flexure', Mu=8.0, Lb=48.0, Mu_pos=6.0, Lb_pos=24.0, **HOLE)
    pr = checks(r)['member.flexure.positive_region']
    assert pr['clause'] == 'F2.2' and pr['clause_variant'] == 'holes'
    assert r['positive_region']['Mnl'] <= r['display_unrounded']['Mynet'] + 0.01


def test_z_section_point_symmetric_with_holes():
    z = dict(section_type='lippedz', H=8.0, B=2.25, D=0.91, t=0.059, R=0.1875, Fy=55.0, design_method='LRFD')
    r = run(**z, member_type='compression', Pu=5.0, KxLx=96.0, KyLy=48.0, KtLt=48.0,
            hole_shape='circular', hole_depth=1.5, hole_spacing=30.0)       # Lcrd ≈ 26 in < s
    assert r['holes']['evaluated'], r['holes'].get('reasons')
    g = checks(r)['member.compression.global']
    assert g['clause'] == 'E2.5' and any('point-symmetric, §2.3.2.1.3' in (s.get('expr') or '') for s in g['steps'])


def test_rpc_values_equal_the_member_check():
    node, elem, roles = _model()
    out = H.elastic_buckling({'node': node.tolist(), 'elem': elem.tolist(), 'element_roles': roles, 'Fy': 33.0,
                              'section_type': 'lippedc', **HOLE, 'families': ['M']})
    r = run(**SEC, member_type='flexure', Mu=10.0, Lb=0.0, **HOLE)
    assert out['evaluated'] and abs(out['Mcrl_h'] - r['holes']['Mcrl_h']) < 1e-9
    assert abs(out['Mcrd_h'] - r['holes']['Mcrd_h']) < 1e-9 and abs(out['Anet'] - r['holes']['Anet']) < 1e-12


# ------------------------------------------------------------------ 계산 과정: 단계마다 그 입력으로 다시 계산
def _avg_formula(e, v):
    import re
    m = re.match(r'^(\S+),avg = \[(\S+) \((\S+) − Lnet,(\w)\) \+ (\S+) Lnet,\w\] / \S+$', e)
    if not m:
        return None
    sym, g, L, tag, n = m.groups()
    Ln = v[f'Lnet,{tag}']
    return (v[g] * (v[L] - Ln) + v[n] * Ln) / v[L]


def _count_formula(e, v):
    import re
    m = re.match(r'^n,(\w) = floor\(\((\S+) − Lh\)/s\) \+ 1', e)
    if m:
        L = v[m.group(2)]
        return 1 if L <= v['Lh'] else math.floor((L - v['Lh']) / v['s'] + 1e-12) + 1
    m = re.match(r'^Lnet,(\w) = min\(n,\w Lh, (\S+)\)$', e)
    if m:
        return min(v[f'n,{m.group(1)}'] * v['Lh'], v[m.group(2)])
    return None


EXTRA = {
    'ro,avg = [xo,avg² + (Ix,t,avg + Iy,t,avg) / A,avg]^0.5':
        lambda v: math.sqrt(v['xo,avg'] ** 2 + (v['Ix,t,avg'] + v['Iy,t,avg']) / v['A,avg']),
    'ro,avg = [xo,avg² + (Ix,avg + Iy,avg) / A,avg]^0.5':
        lambda v: math.sqrt(v['xo,avg'] ** 2 + (v['Ix,avg'] + v['Iy,avg']) / v['A,avg']),
    'σt = [G J,avg + π² E Cw,net / (KtLt)²] / (Ag ro,avg²)':
        lambda v: (v['G'] * v['J,avg'] + math.pi ** 2 * v['E'] * v['Cw,net'] / v['KtLt'] ** 2) / (v['Ag'] * v['ro,avg'] ** 2),
    'σex = π² E Ix,avg / [Ag (KxLx)²]': lambda v: math.pi ** 2 * v['E'] * v['Ix,avg'] / (v['Ag'] * v['KxLx'] ** 2),
    'σey = π² E Iy,avg / [Ag (KyLy)²]': lambda v: math.pi ** 2 * v['E'] * v['Iy,avg'] / (v['Ag'] * v['KyLy'] ** 2),
    'σe,min = π² E I22,avg / [Ag (KyLy)²]': lambda v: math.pi ** 2 * v['E'] * v['I22,avg'] / (v['Ag'] * v['KyLy'] ** 2),
    'β = 1 − (xo,avg / ro,avg)²': lambda v: 1 - (v['xo,avg'] / v['ro,avg']) ** 2,
    'Fcre = min(σt, σe,min)  (point-symmetric, §2.3.2.1.3)': lambda v: min(v['σt'], v['σe,min']),
    'Fcre = Cb ro,avg Ag / Sf (σey σt)^0.5': lambda v: v['Cb'] * v['ro,avg'] * v['Ag'] / v['Sf'] * math.sqrt(v['σey'] * v['σt']),
    'Fcre = Cb ro,avg Ag / (2 Sf) (σey σt)^0.5':
        lambda v: v['Cb'] * v['ro,avg'] * v['Ag'] / (2 * v['Sf']) * math.sqrt(v['σey'] * v['σt']),
    'Pcrl,h = λh P_ref,net  (net section, half-wavelengths ≤ Lh)': lambda v: v['λh'] * v['P_ref,net'],
    'Mcrl,h = λh M_ref,net  (net section, half-wavelengths ≤ Lh)': lambda v: v['λh'] * v['M_ref,net'],
    'Pcrl = min(Pcrl,nh, Pcrl,h)': lambda v: min(v['Pcrl,nh'], v['Pcrl,h']),
    'Mcrl = min(Mcrl,nh, Mcrl,h)': lambda v: min(v['Mcrl,nh'], v['Mcrl,h']),
    'Pynet = Anet Fy': lambda v: v['Anet'] * v['Fy'],
    'Mynet = Sfnet Fy': lambda v: v['Sfnet'] * v['Fy'],
    'Pnℓ = min(Pnℓ,0, Pynet)': lambda v: min(v['Pnℓ,0'], v['Pynet']),
    'Mnℓ = min(Mnℓ,0, Mynet)': lambda v: min(v['Mnℓ,0'], v['Mynet']),
    'tr = t (1 − Lh/Lcrd)^(1/3)': lambda v: v['t'] * (1 - v['Lh'] / v['Lcrd']) ** (1 / 3),
    'Pcrd = LF P_ref,r  (FSM at Lcrd, web thickness tr)': lambda v: v['LF'] * v['P_ref,r'],
    'Mcrd = LF M_ref,r  (FSM at Lcrd, web thickness tr)': lambda v: v['LF'] * v['M_ref,r'],
    'λd1 = 0.561 (Pynet / Py)': lambda v: 0.561 * v['Pynet'] / v['Py'],
    'λd2 = 0.561 [14.0 (Py / Pynet)^0.4 − 13.0]': lambda v: 0.561 * (14.0 * (v['Py'] / v['Pynet']) ** 0.4 - 13.0),
    'Pd2 = [1 − 0.25 (1/λd2)^1.2] (1/λd2)^1.2 Py':
        lambda v: (1 - 0.25 * (1 / v['λd2']) ** 1.2) * (1 / v['λd2']) ** 1.2 * v['Py'],
    'Pnd = Pynet': lambda v: v['Pynet'],
    'Pnd = Pynet − [(Pynet − Pd2)/(λd2 − λd1)] (λd − λd1)':
        lambda v: v['Pynet'] - (v['Pynet'] - v['Pd2']) / (v['λd2'] - v['λd1']) * (v['λd'] - v['λd1']),
    'λd1 = 0.673 (Mynet / My)^3': lambda v: 0.673 * (v['Mynet'] / v['My']) ** 3,
    'λd2 = 0.673 [1.7 (My / Mynet)^2.7 − 0.7]': lambda v: 0.673 * (1.7 * (v['My'] / v['Mynet']) ** 2.7 - 0.7),
    'Md2 = [1 − 0.22 (1/λd2)] (1/λd2) My': lambda v: (1 - 0.22 / v['λd2']) / v['λd2'] * v['My'],
    'Mnd = Mynet': lambda v: v['Mynet'],
    'Mnd = min{Mynet − [(Mynet − Md2)/(λd2 − λd1)] (λd − λd1), [1 − 0.22 (Mcrd/My)^0.5] (Mcrd/My)^0.5 My}':
        lambda v: min(v['Mynet'] - (v['Mynet'] - v['Md2']) / (v['λd2'] - v['λd1']) * (v['λd'] - v['λd1']),
                      (1 - 0.22 * (v['Mcrd'] / v['My']) ** 0.5) * (v['Mcrd'] / v['My']) ** 0.5 * v['My']),
    'e_max = dh/2 + |e_h|  (hole edge from mid-depth)': lambda v: v['dh'] / 2 + abs(v['e_h']),
    'h/2': lambda v: v['h'] / 2,
}
LOOKUP = ('Lcrd (gross section, distortional half-wavelength)',
          'kφfe (flange term, thickness t — unchanged by the hole)',
          'k̃φfg (flange term, thickness t — unchanged by the hole)')


def _recompute(st):
    e, v = st['expr'], TR._v(st)
    if e in EXTRA:
        return EXTRA[e](v)
    if e in LOOKUP:
        assert len(st['inputs']) == 1
        return st['inputs'][0]['value']
    for f in (_count_formula, _avg_formula):
        out = f(e, v)
        if out is not None:
            return out
    return TR._recompute(st)


def _hole_results():
    out = [run(**SEC, member_type='flexure', Mu=10.0, Lb=0.0, **HOLE),
           run(**SEC, member_type='flexure', Mu=8.0, Lb=48.0, Mu_pos=6.0, Lb_pos=24.0, **HOLE),
           run(**SEC, member_type='compression', Pu=2.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, **HOLE),
           run(**SEC, member_type='combined', Pu=1.0, Mux=5.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0, **HOLE),
           run(section_type='lippedz', H=8.0, B=2.25, D=0.91, t=0.059, R=0.1875, Fy=55.0, design_method='ASD',
               member_type='compression', Pu=5.0, KxLx=96.0, KyLy=48.0, KtLt=48.0,
               hole_shape='circular', hole_depth=1.5, hole_spacing=30.0),
           run(section_type='lippedz', H=8.0, B=2.25, D=0.91, t=0.059, R=0.1875, Fy=55.0, design_method='ASD',
               member_type='flexure', Mu=20.0, Lb=60.0, hole_shape='circular', hole_depth=1.5, hole_spacing=30.0)]
    return out


def test_every_hole_step_is_recomputed_from_its_own_inputs_and_nothing_is_orphaned():
    n = 0
    for r in _hole_results():
        assert 'error' not in r and r['holes']['evaluated'], r.get('holes', {}).get('reasons')
        for c in r['design_checks']:
            steps = c['steps']
            for k, st in enumerate(steps):
                where = (c['id'], k, st.get('expr') or st.get('condition'))
                if st['kind'] == 'branch':
                    if st.get('descriptive'):
                        continue
                    assert bool(TR._branch_holds(st)) == st['holds'], where
                    n += 1
                elif st['kind'] in ('design_strength', 'verdict'):
                    continue                     # 계수 · 비는 test_review_1124_trace_recompute 의 규칙(구멍과 무관)
                else:
                    got = _recompute(st)
                    want = math.inf if st['result'].get('unbounded') else st['result']['value']
                    assert TR._close(got, want), where + (got, want)
                    n += 1
                r_ = st.get('result')
                if r_ and r_.get('value') is not None and c['verdict'] in ('pass', 'fail'):
                    used = any(inp.get('source') == {'kind': 'step', 'step': k}
                               for later in steps[k + 1:] for inp in later['inputs'])
                    ends = {(c.get('capacity') or {}).get('value'), (c.get('demand') or {}).get('value'), c['ratio']}
                    assert used or r_['value'] in ends, where
    assert n > 200, n


def test_hole_results_keep_the_result_contract():
    """서버 처리기 + 엄격 JSON 왕복: 알림마다 등록된 code · 한국어(test_review_1124_notices 의 걷기), 검토 id · 조항
    갈래가 등록표대로, 단계 입력의 출처 · 값, mirrors 가 결과의 그 필드와 같다(test_review_1123_checks 의 규칙)."""
    import contract_cases_1123 as cases
    import test_review_1124_notices as NT
    from design.checks import REGISTRY, REGISTRY_VARIANTS, STEP_KINDS
    reqs = [dict(SEC, member_type='flexure', Mu=10.0, Lb=0.0, **HOLE),
            dict(SEC, member_type='flexure', Mu=8.0, Lb=48.0, Mu_pos=6.0, Lb_pos=24.0, Vu=1.0, **HOLE),
            dict(SEC, member_type='compression', Pu=2.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, **HOLE),
            dict(SEC, member_type='compression', Pu=2.0, **HOLE),
            dict(SEC, member_type='combined', Pu=1.0, Mux=5.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0, **HOLE),
            dict(SEC, member_type='flexure', Mu=500.0, Lb=0.0, **{**HOLE, 'hole_spacing': 10.0}),
            dict(SEC, member_type='tension', Tu=1.0, **HOLE)]
    errors, codes, stats = [], set(), {'results': 0, 'notices': 0, 'reasons': 0}
    for i, p in enumerate(reqs):
        r = cases.run_case('aisi_design', p)
        assert 'error' not in r, r.get('error')
        NT.walk_result(r, f'holes-{i}', errors, codes, stats)
        for c in r['design_checks']:
            assert c['id'] in REGISTRY
            reg = REGISTRY_VARIANTS[(c['id'], c['clause_variant'])] if c.get('clause_variant') else REGISTRY[c['id']]
            assert (c['clause'], c['name'], c['name_ko']) == (reg['clause'], reg['name'], reg['name_ko'])
            for k, st in enumerate(c['steps']):
                assert st['kind'] in STEP_KINDS
                for inp in st['inputs']:
                    assert isinstance(inp.get('source'), dict), (c['id'], k, inp)
                    if inp['source']['kind'] == 'step':
                        j = inp['source']['step']
                        assert 0 <= j < k and c['steps'][j]['result']['value'] == inp['value'], (c['id'], k)
            for field, m in (c.get('mirrors') or {}).items():
                holder = (c.get('reference') if c['verdict'] == 'not_evaluated' else c) or {}
                v = holder.get(field)
                new = v.get('value') if isinstance(v, dict) else v
                cur = r
                for part in m['path'].replace(']', '').replace('[', '.').split('.'):
                    if part:
                        cur = cur[int(part)] if part.isdigit() else cur[part]
                assert round(new, m['digits']) == cur, (i, c['id'], field)
    assert not errors, errors[:10]
    assert {'member.ne.f2_2_holes', 'member.reason.holes_spacing_below_lcrd', 'member.warning.holes_not_used_tension',
            'member.assumption.holes_dist_fsm', 'member.assumption.holes_dist_analytic'} <= codes, codes
