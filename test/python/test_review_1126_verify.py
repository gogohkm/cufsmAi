"""2026-11-26 독립 검증의 고침 — 구멍 · 횡방향 웹 보강재 · 비틀림(§H4).

검증자의 재현(scratchpad verify2: p13 · p4_verdicts · p11 · p7b · p12)을 고치기 전 → 고친 뒤로 적었다.
1. 보강재 항복응력 ≤ 0 이 §G4.1 면적 검토를 건너뛰어 합격 → 이름을 단 입력 오류. 판정에 드는 검토가 평가하지 못함이면
   결과는 합격이 아니다(새 검토 모두).
2. 구멍 조항을 평가하지 못해도 구멍 없는 상한(구멍은 강도를 낮추기만 한다 — 식이 보장하는 것만)을 소요가 넘으면 불합격.
3. §H4 의 강도는 F3 의 첫 항복(Fn = Fy) — 비탄성 여유를 넣지 않는다.
4. 조합 부재의 B1 — 구멍이면 Pe1 에 표 2.3.2-1 의 가중 평균 I.
5. 틀린 입력 → 그 이름을 단 오류(예외 · NaN 비 없음).
6. 받은 단면 성질이 구멍 모델의 것이 아니면 구멍 조항 평가하지 못함, Pynet ≤ Py · Mynet ≤ My, §E4.2 · §F4.2 의 갈래 순서.
7. hole_spacing 없음 = 구멍 하나. 두 모듈이 hole_* 를 같게 읽는다.
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'python'))
sys.path.insert(0, HERE)

from design.aisi_s100 import design_member, _auto_generate_props, _unevaluated_checks_rule  # noqa: E402
from design import holes as H  # noqa: E402
from design.shear import shear_strength, web_crippling, g3_reduction  # noqa: E402
from design.dsm_strength import (compression_local, flexure_local, compression_distortional_holes,  # noqa: E402
                                 flexure_distortional_holes)

C = dict(section_type='lippedc', H=5.5, B=1.625, D=0.5, t=0.0346, R=0.0764, Fy=33.0, design_method='LRFD')
HOLE = dict(hole_shape='noncircular', hole_depth=1.5, hole_length=4.5, hole_spacing=24.0)
C9 = dict(section_type='lippedc', H=9.0, B=2.5, D=0.773, t=0.059, R=0.1875, Fy=55.0, design_method='ASD',
          member_type='flexure', Mu=40.0, Lb=0.0)
C4 = dict(section_type='lippedc', H=4.0, B=1.625, D=0.5, t=0.0713, R=0.1069, Fy=50.0, design_method='ASD',
          member_type='flexure', Lb=0.0, Mu=5.0, hole_corner_radius=0.25, **HOLE)
C4L = dict(C4, hole_length=4.6)                  # §G3(f) Lh ≤ 4.5 in 밖
_RUNS = {}


def run(**kw):
    key = json.dumps(kw, sort_keys=True, default=str)
    if key not in _RUNS:
        _RUNS[key] = design_member(dict(kw))
    return _RUNS[key]


def checks(r):
    return {c['id']: c for c in r['design_checks']}


def _code(c):
    return c.get('reason_code') or getattr(c.get('reason'), 'code', None)


FAILS = 'member.reason.fails_without_holes'


# ------------------------------------------------------------------ 1
def test_1_stiffener_yield_stress_not_positive_is_an_input_error():
    st = dict(stiffener_spacing=5.0, stiffener_kind='single_plate', stiffener_Is=1.0, stiffener_area=0.001, Vu=4.0)
    # 고치기 전: Fy,st = 0 → conforming True, §G2.2 kv 19.46, Vn 12.82, pass True. 지금: 오류
    for bad in (0.0, -10.0, float('nan'), float('inf'), 'abc'):
        r = run(**C9, **st, stiffener_Fy=bad)
        assert 'error' in r and 'stiffener_Fy' in r['error'] and r['error'].startswith('stiffeners:'), (bad, r)
    for k, bad in (('stiffener_spacing', -5.0), ('stiffener_Is', 0.0), ('stiffener_area', -1.0)):
        r = run(**C9, **dict(st, stiffener_Fy=50.0, **{k: bad}))
        assert 'error' in r and k in r['error'], (k, r.get('error'))
    # Fy,st = 50: Ast,min = 0.0599 in² > 0.001 → 보강재 불합격, 부재 불합격(검증자와 같은 값)
    r = run(**C9, **st, stiffener_Fy=50.0)
    assert abs(r['web_stiffeners']['Ast_min'] - 0.05994) < 1e-4 and r['web_stiffeners']['conforming'] is False
    assert checks(r)['member.web_stiffeners']['verdict'] == 'fail' and r['pass'] is False
    # §G4.1 함수도 0 이하를 맞춤으로 두지 않는다(단독 도구 경로)
    from design.shear import g4_conformance
    g = g4_conformance(8.5, 0.059, 55.0, dict(st, stiffener_Fy=0.0))
    assert g['conforming'] is None and g['invalid'] == ['stiffener_Fy']
    out = shear_strength(8.5, 0.059, 55.0, stiffener_spacing=5.0, stiffener_kind='pair', stiffener_Is=1.0,
                         stiffener_area=1.0, stiffener_Fy=0.0)
    assert 'error' in out and out['Vn'] is None


def test_1_an_unevaluated_counting_check_makes_the_verdict_null():
    """판정 규칙을 검토 항목에도: 해당하는 검토가 평가하지 못함이면 합격이 아니다(불합격은 그대로)."""
    res = {'pass': True}
    chk = [{'id': 'member.web_stiffeners', 'verdict': 'not_evaluated', 'reason': 'x', 'counts': True},
           {'id': 'member.applicability.b4', 'verdict': 'not_evaluated', 'reason': 'y', 'counts': False}]
    _unevaluated_checks_rule(res, chk)
    assert res['pass'] is None and [n.code for n in res['not_evaluated']] == ['member.ne.design_check_not_evaluated']
    res = {'pass': False}
    _unevaluated_checks_rule(res, chk)
    assert res['pass'] is False and 'not_evaluated' not in res
    # 실제 결과: 판정에 드는 검토가 평가하지 못함인데 합격인 결과는 없다(새 입력의 여러 경우)
    for p in (dict(C9, stiffener_spacing=5.0, stiffener_kind='single_plate', stiffener_Is=1.0, stiffener_area=1.0,
                   stiffener_Fy=50.0, Vu=1.0, Mu=10.0),
              dict(C9, Mu=10.0, torsion_f_bending=-4.0, torsion_f_torsion=-1.0),
              dict(C, member_type='flexure', Mu=2.0, Lb=0.0, **HOLE)):
        r = run(**p)
        if r['pass'] is True:
            assert not [c['id'] for c in r['design_checks'] if c['verdict'] == 'not_evaluated' and c.get('counts', True)]


# ------------------------------------------------------------------ 2
def test_2_flexure_fails_without_holes_when_hole_provisions_cannot_be_evaluated():
    """p4 1c · 1d: 550S162-33, Mu = 40 (구멍 없이 비 2.5 – 3.0) — 고치기 전 pass None, 지금 불합격."""
    base = dict(C, member_type='flexure', Mu=40.0, Lb=0.0)
    for extra, code in ((dict(hole_edge_stiffened=True), 'member.reason.holes_edge_stiffened'),
                        (dict(hole_web_offset=0.3), 'member.reason.holes_offset_unsymmetric')):
        r = run(**base, **HOLE, **extra)
        c = checks(r)
        assert r['pass'] is False and r['holes_evaluated'] is False
        b = r['holes_strength_bound']
        for k in ('member.flexure.global', 'member.flexure.local', 'member.flexure.distortional'):
            assert c[k]['verdict'] == 'fail' and _code(c[k]) == FAILS, k
            cap = c[k]['capacity']['value']
            assert abs(c[k]['ratio'] - 40.0 / cap) < 1e-9
        assert abs(b['ratio'] - 40.0 / b['design_strength']) < 1e-12 and b['ratio'] > 1
        item = [i for i in r['limit_state_checks'] if i['name'] == 'F flexure'][0]
        assert item['pass'] is False and item['reason_code'] == FAILS
        assert c['member.applicability.holes']['verdict'] == 'not_evaluated'
        assert code in json.dumps([getattr(x, 'code', '') for x in r['holes'].get('reasons') or []])
    # 상한을 넘지 않으면 판정 없음 그대로
    r = run(**dict(base, Mu=5.0), **HOLE, hole_edge_stiffened=True)
    assert r['pass'] is None and checks(r)['member.flexure.local']['verdict'] == 'not_evaluated'


def test_2_bound_uses_only_quantities_the_formulas_guarantee():
    """상한: Mne ≤ My (Fn ≤ Fy), Mnℓ ≤ min(Mnℓ(My, Mcrℓ 구멍 없음), Mynet), Mnd ≤ My — 구멍 없는 Mne(횡비틀림) 자체는 아니다."""
    r = run(**C, member_type='flexure', Mu=40.0, Lb=96.0, **HOLE, hole_edge_stiffened=True)
    du, b = r['display_unrounded'], r['holes_strength_bound']
    My = du['My']
    assert abs(b['checks']['member.flexure.global']['value'] - My) < 1e-9          # Lb = 96 이어도 My
    assert b['checks']['member.flexure.global']['value'] > du['Mne']               # 구멍 없는 Mne 보다 크다(상한)
    assert abs(b['Mn'] - b['checks']['member.flexure.local']['value']) < 1e-12
    assert b['checks']['member.flexure.distortional']['value'] == My
    # 식의 성질: Pnℓ · Mnℓ 은 Pne(Mne) · Pcrℓ(Mcrℓ) 에 대해 늘어난다
    for f in (compression_local, flexure_local):
        key = 'Pnl' if f is compression_local else 'Mnl'
        for crl in (0.2, 0.8, 1.5, 3.0):
            vals = [f(ne, crl)[key] for ne in (0.5, 0.8, 1.0, 1.3, 2.0)]
            assert all(b2 >= a2 - 1e-12 for a2, b2 in zip(vals, vals[1:]))
            vals = [f(1.0, c)[key] for c in (crl, crl * 1.1, crl * 1.5)]
            assert all(b2 >= a2 - 1e-12 for a2, b2 in zip(vals, vals[1:]))
    # Eq. E4.2-2 는 Pynet 을 넘을 수 있다(Pd2 > Pynet 인 비가 있다) — 그래서 뒤틀림의 상한은 Pynet 이 아니라 Py
    d = compression_distortional_holes(1.0, 0.9857, 1 / 0.6037 ** 2)          # Pynet/Py = 0.9857, λd = 0.604
    assert d['equation'] == 'E4.2-2' and d['Pd2'] > d['Pynet'] and d['Pnd'] > d['Pynet'] * 1.005
    assert max(compression_distortional_holes(1.0, rr, 1 / lam ** 2)['Pnd']
               for rr in (0.5, 0.8, 0.95) for lam in (0.3, 0.6, 1.0, 2.0)) <= 1.0 + 1e-12


def test_2_compression_fails_without_holes():
    """p4 1f: Pu = 30 (구멍 없이 4.6 – 8.6) — 고치기 전 None. 상한은 Pne ≤ Py, Pnℓ(Py, Pcrℓ) — 비는 그 설계강도로."""
    base = dict(C, member_type='compression', KxLx=96.0, KyLy=48.0, KtLt=48.0)
    r = run(**base, Pu=30.0, **HOLE, hole_edge_stiffened=True)
    c = checks(r)
    assert r['pass'] is False
    for k in ('member.compression.global', 'member.compression.local', 'member.compression.distortional'):
        assert c[k]['verdict'] == 'fail' and _code(c[k]) == FAILS and c[k]['clause_variant'] == 'holes', k
    b = r['holes_strength_bound']
    Py = r['display_unrounded']['Py']
    assert abs(b['checks']['member.compression.global']['value'] - Py) < 1e-9
    assert b['Pn'] <= Py
    r = run(**base, Pu=1.0, **HOLE, hole_edge_stiffened=True)
    assert r['pass'] is None and checks(r)['member.compression.local']['verdict'] == 'not_evaluated'


def test_2_shear_g3_outside_limits():
    """p4 2c: 400S162-68, Vu = 8 (구멍 없이 1.64), Lh = 4.6 > 4.5 (§G3(f)) — 고치기 전 None, 지금 불합격(비 = 구멍 없는 비)."""
    r0 = run(**{k: v for k, v in C4.items() if not k.startswith('hole_')}, Vu=8.0)
    r = run(**C4L, Vu=8.0)
    c = checks(r)
    assert r['pass'] is False
    assert c['member.shear']['verdict'] == 'fail' and _code(c['member.shear']) == FAILS
    assert abs(c['member.shear']['ratio'] - checks(r0)['member.shear']['ratio']) < 1e-9
    assert c['member.bending_shear']['verdict'] == 'fail'
    bw = r['shear']['bound_without_holes']
    assert bw['fails'] and bw['h2_fails'] and r['shear']['evaluated'] is False and 'Vn' not in r['shear']
    r = run(**C4L, Vu=1.0)
    c = checks(r)
    assert r['pass'] is None and c['member.shear']['verdict'] == 'not_evaluated' and not c['member.shear'].get('reference')
    assert c['member.bending_shear']['verdict'] == 'not_evaluated'


def test_2_h2_fails_with_shear_alone_within_the_bound():
    """전단만으로는 구멍 없는 강도 안이지만 §H2 가 넘는 경우 — 전단은 판정 없음, §H2 는 불합격."""
    r = run(**C4L, Vu=4.0)
    bw = r['shear']['bound_without_holes']
    assert not bw['fails']
    Mu = 0.8 * bw['Malo']                       # (M/Malo)² + (V/Va)² ≥ 0.64 + (4/4.87)² > 1
    r = run(**dict(C4L, Mu=Mu), Vu=4.0)
    c = checks(r)
    assert c['member.shear']['verdict'] == 'not_evaluated'
    assert c['member.bending_shear']['verdict'] == 'fail' and _code(c['member.bending_shear']) == FAILS
    assert r['pass'] is False


def test_2_web_crippling_hole_within_bearing():
    """p4 3b: 지압 안의 구멍, P = 10 (구멍 없이 3.45) — 고치기 전 None, 지금 G5 · H3 불합격."""
    b3 = dict(C4, Vu=0.5, wc_N=5.0, wc_R=0.1069, wc_support='IOF', wc_M=5.0, hole_end_distance=9.75,
              hole_bearing_distance=7.25, hole_within_bearing=True)
    r = run(**b3, wc_P=10.0)
    c = checks(r)
    assert r['pass'] is False
    assert c['member.web_crippling']['verdict'] == 'fail' and _code(c['member.web_crippling']) == FAILS
    assert c['member.bending_web_crippling']['verdict'] == 'fail'
    assert r['web_crippling']['Pn'] is None and r['web_crippling']['bound_without_holes']['fails']
    r = run(**b3, wc_P=0.5)
    c = checks(r)
    assert r['pass'] is None and c['member.web_crippling']['verdict'] == 'not_evaluated'
    assert c['member.bending_web_crippling']['verdict'] == 'not_evaluated'
    # P 는 강도 안, H3 만 넘음(큰 M)
    pa = r['web_crippling']['bound_without_holes']['design_strength']
    r = run(**dict(b3, wc_M=60.0, Mu=60.0), wc_P=0.9 * pa)
    c = checks(r)
    assert c['member.web_crippling']['verdict'] == 'not_evaluated'
    assert c['member.bending_web_crippling']['verdict'] == 'fail' and r['pass'] is False


def test_2_positive_region_and_combined():
    p = dict(C, member_type='flexure', Mu=2.0, Lb=48.0, Lb_pos=24.0, **HOLE, hole_edge_stiffened=True)
    r = run(**p, Mu_pos=40.0)
    pr = checks(r)['member.flexure.positive_region']
    assert pr['verdict'] == 'fail' and _code(pr) == FAILS and r['pass'] is False
    assert r['positive_region']['pass'] is False
    r = run(**p, Mu_pos=1.0)
    assert checks(r)['member.flexure.positive_region']['verdict'] == 'not_evaluated' and r['pass'] is None
    # §H1.2 (조합): 구멍 없는 상한으로 낸 하한 비
    cb = dict(C, member_type='combined', KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0, **HOLE, hole_edge_stiffened=True)
    r = run(**cb, Pu=3.0, Mux=8.0)
    h = checks(r)['member.axial_bending']
    assert h['verdict'] == 'fail' and _code(h) == FAILS and r['interaction_holes_bound']['total'] > 1
    r = run(**cb, Pu=0.5, Mux=1.0)
    assert checks(r)['member.axial_bending']['verdict'] == 'not_evaluated' and r['pass'] is None


# ------------------------------------------------------------------ 3
def test_3_h4_strength_is_first_yield_without_inelastic_reserve():
    """p11: 4 in C, Fy 50, 비탄성 여유 켬 — 고치기 전 Mnℓo 58.41 (> My 53.59), 지금 53.59 (첫 항복)."""
    b = dict(section_type='lippedc', H=4.0, B=2.0, D=0.6, t=0.1017, R=0.15, Fy=50.0, design_method='LRFD',
             member_type='flexure', Mu=20.0, Lb=0.0, torsion_f_bending=-10.0, torsion_f_torsion=-3.0)
    r0 = run(**b, use_inelastic_reserve=False)
    r1 = run(**b, use_inelastic_reserve=True)
    assert r1['torsion']['Mnlo'] == r0['torsion']['Mnlo'] == 53.59 and r1['torsion']['Mn'] == r0['torsion']['Mn']
    assert r1['display_unrounded']['Mn'] > r0['display_unrounded']['Mn']       # 휨 자체는 비탄성 여유를 쓴다
    assert any(getattr(a, 'code', '') == 'member.assumption.h4_first_yield' for a in r1['assumptions'])
    assert not any(getattr(a, 'code', '') == 'member.assumption.h4_first_yield' for a in r0['assumptions'])


# ------------------------------------------------------------------ 4
def test_4_b1_uses_the_hole_averaged_moment_of_inertia():
    """p7b: 구멍이 있으면 Pe1 = π² E Ix,avg / (KxLx)² (부록 2 표 2.3.2-1)."""
    b = dict(C, member_type='combined', Pu=2.0, Mux=4.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0)
    r0, r1 = run(**b), run(**b, **HOLE)
    a0, a1 = r0['display_unrounded']['amplification'], r1['display_unrounded']['amplification']
    note = [a for a in r1['assumptions'] if getattr(a, 'code', '') == 'member.assumption.c1_pe1_holes_average'][0]
    Ix = note.values['Ix']
    assert abs(a1['PEx'] - math.pi ** 2 * 29500.0 * Ix / 96.0 ** 2) < 1e-6 * a1['PEx']
    assert a1['PEx'] < a0['PEx'] and r1['amplification']['alpha_x'] >= r0['amplification']['alpha_x']
    h = checks(r1)['member.axial_bending']
    pe = [s for s in h['steps'] if s['expr'].startswith('Pe1x')][0]
    assert pe['inputs'][3]['source']['key'] == 'rx,avg'


# ------------------------------------------------------------------ 5
def test_5_bad_new_inputs_are_named_errors():
    T = dict(torsion_eccentricity=1.05, torsion_span=300.0, torsion_load='uniform', torsion_support='simple')
    cases = ((dict(T, torsion_eccentricity='abc'), 'torsion_eccentricity'),
             (dict(torsion_f_bending='x', torsion_f_torsion=-1.0), 'torsion_f_bending'),
             (dict(T, torsion_eccentricity=float('nan')), 'torsion_eccentricity'),
             (dict(T, torsion_span=float('inf')), 'torsion_span'), (dict(T, torsion_span=-5.0), 'torsion_span'),
             (dict(torsion_f_bending=float('nan'), torsion_f_torsion=-1.0), 'torsion_f_bending'),
             (dict(torsion_f_bending=-1.0, torsion_f_torsion=-1.0, torsion_at_web_flange_junction='yes'),
              'torsion_at_web_flange_junction'),
             (dict(stiffener_spacing=-5.0, stiffener_kind='pair', stiffener_Is=1.0, stiffener_area=1.0,
                   stiffener_Fy=50.0, Vu=1.0), 'stiffener_spacing'),
             (dict(stiffener_spacing=5.0, stiffener_kind=3, Vu=1.0), 'stiffener_kind'),
             (dict(HOLE, hole_corner_radius=-1.0, Vu=1.0), 'hole_corner_radius'),
             (dict(HOLE, hole_bearing_distance='near', Vu=1.0), 'hole_bearing_distance'),
             (dict(HOLE, hole_within_bearing='no', Vu=1.0), 'hole_within_bearing'),
             (dict(HOLE, hole_end_distance=float('nan'), Vu=1.0), 'hole_end_distance'))
    for kw, name in cases:
        r = design_member(dict(C9, **kw))
        assert 'error' in r and name in r['error'], (name, r.get('error'))
    # 단독 도구도 같은 규칙
    assert 'error' in shear_strength(4.0, 0.07, 50.0, hole_shape='circular', hole_depth=1.0, hole_length=2.0,
                                     hole_spacing=24.0, section_type='C')
    w = web_crippling(4.0, 0.07, 0.1, 3.0, 50.0, support='IOF', hole_shape='circular', hole_depth=1.0,
                      hole_corner_radius=-0.1, hole_end_distance=5.0, hole_bearing_distance=1.0)
    assert 'error' in w and 'hole_corner_radius' in w['error']


# ------------------------------------------------------------------ 6
def _model_props():
    g = _auto_generate_props(dict(C, member_type='flexure'))
    return g


def test_6_supplied_properties_must_belong_to_the_hole_model():
    g = _model_props()
    common = dict(member_type='flexure', Fy=33.0, design_method='LRFD', Lb=0.0, section_type='C', node=g['node'],
                  elem=g['elem'], element_roles=g['element_roles'], dsm=g['dsm'], section=g['section'], **HOLE)
    # 템플릿(같은 모델): 차 0 — 평가한다
    r = design_member(dict(common, props=g['props'], Mu=5.0))
    assert r['holes']['evaluated'] and r['display_unrounded']['Mynet'] <= r['display_unrounded']['My']
    # 고치기 전: Sf × 0.95 를 받아 Mynet 17.37 > My 16.62. 지금: 평가하지 못함(그 까닭), 큰 소요는 불합격(규칙 2)
    pr = dict(g['props'], Sf=g['props']['Sf'] * 0.95)
    r = design_member(dict(common, props=pr, Mu=5.0))
    assert r['holes']['evaluated'] is False and r['holes'].get('props_mismatch') is True and r['pass'] is None
    assert any(getattr(x, 'code', '') == 'member.reason.holes_props_mismatch_sf' for x in r['holes']['reasons'])
    r = design_member(dict(common, props=pr, Mu=40.0))
    assert r['pass'] is False and checks(r)['member.flexure.local']['verdict'] == 'fail'
    # 반올림(유효숫자 셋)한 성질은 받아 준다(허용 1 %)
    pr = dict(g['props'], A=float(f"{g['props']['A']:.3g}"), Sf=float(f"{g['props']['Sf']:.3g}"))
    assert H.props_mismatch(pr['A'], pr['Sf'], g['props']['A'], g['props']['Sf']) == []


def test_6_net_yield_never_exceeds_gross_and_branch_order():
    # 섞인 값(Mynet > My): 고치기 전 λd ≤ λd1 갈래가 먼저여서 Mnd = Mynet > My
    d = flexure_distortional_holes(10.0, 11.0, 40.0)
    assert d['Mnd'] <= 10.0 and d.get('Mynet_capped_to_My')
    d = compression_distortional_holes(10.0, 11.0, 40.0)
    assert d['Pnd'] <= 10.0 and d.get('Pynet_capped_to_Py')
    # 바른 값에서는 옛 결과와 같다(λd1 ≤ 0.673 ≤ λd2)
    d = flexure_distortional_holes(18.0, 17.8, 20.5)
    assert d['equation'] == 'F4.1-2' and round(d['Mnd'], 1) == 14.7


# ------------------------------------------------------------------ 7
def test_7_single_hole_without_spacing():
    hp = H.parse({'hole_shape': 'circular', 'hole_depth': 1.5})
    assert hp['s'] == math.inf and hp['single_hole'] and hp['Lh'] == 1.5
    assert H.net_fraction(96.0, hp)['n'] == 1
    one = dict(hole_shape='circular', hole_depth=1.5)
    r = run(**C, member_type='compression', Pu=1.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, **one)
    assert r['holes']['evaluated'] and r['holes']['s'] is None and r['holes']['single_hole'] is True
    assert any(getattr(a, 'code', '') == 'member.assumption.holes_single_hole' for a in r['assumptions'])
    g = checks(r)['member.compression.global']
    ns = [s for s in g['steps'] if str(s.get('expr', '')).startswith('n,')]
    assert ns and all(s['result']['value'] == 1 for s in ns)
    json.dumps(r, default=str, allow_nan=False)                # s = ∞ 가 결과에 새지 않는다
    # §G3 도 같은 읽기: 간격 없음 = 순거리 한계 맞음(가정)
    gr = g3_reduction(8.0, 0.045, dict(hole_shape='circular', hole_depth=1.0), 'C')
    assert gr['evaluated'] and any(getattr(a, 'code', '') == 'shear.assumption.holes_single_hole'
                                   for a in gr['limits']['assumptions'])


def test_7_shared_hole_inputs_read_the_same_in_g3_g6():
    base = dict(hole_shape='rectangular', hole_depth=1.5, hole_length=4.5, hole_spacing=24.0, hole_corner_radius=0.25)
    assert g3_reduction(II10_H, II10_T, base, 'C')['evaluated']          # 별칭 'rectangular' 는 둘 다 noncircular
    assert H.parse(base)['shape'] == 'noncircular'
    r = g3_reduction(II10_H, II10_T, dict(base, hole_edge_stiffened=True), 'C')
    assert not r['evaluated'] and 'shear.reason.holes_edge_stiffened' in [getattr(p, 'code', None)
                                                                          for p in r['reason'].parts] + [
        getattr(r['reason'], 'code', None)]
    # 부재 경로: 가장자리 보강 구멍은 §G3 도 평가하지 않는다 → 작은 소요면 판정 없음
    r = run(**C4, Vu=1.0, hole_edge_stiffened=True)
    assert checks(r)['member.shear']['verdict'] == 'not_evaluated'
    # 원형의 hole_length ≠ hole_depth 는 두 모듈 모두 오류
    bad = dict(hole_shape='circular', hole_depth=1.0, hole_length=2.0, hole_spacing=24.0)
    assert 'error' in shear_strength(4.0, 0.07, 50.0, section_type='C', **bad)
    assert design_member(dict(C4, Vu=1.0, **bad))['error'].startswith('holes:')


II10_H, II10_T = 4.00 - 2 * (0.1069 + 0.0713), 0.0713          # Design Manual Example II-10


# ------------------------------------------------------------------ 계약(서버 처리기 + 엄격 JSON, 알림 등록 · 검토 id · mirrors)
def test_new_results_keep_the_result_contract():
    import contract_cases_1123 as cases
    import test_review_1124_notices as NT
    from design.checks import REGISTRY, REGISTRY_VARIANTS
    b3 = dict(C4, Vu=0.5, wc_N=5.0, wc_R=0.1069, wc_support='IOF', wc_M=5.0, hole_end_distance=9.75,
              hole_bearing_distance=7.25, hole_within_bearing=True, wc_P=10.0)
    reqs = [dict(C4L, Vu=8.0), dict(C4L, Vu=1.0), b3, dict(b3, wc_P=0.5),
            dict(C, member_type='flexure', Mu=40.0, Lb=0.0, **HOLE, hole_edge_stiffened=True),
            dict(C, member_type='flexure', Mu=2.0, Lb=48.0, Lb_pos=24.0, Mu_pos=40.0, **HOLE, hole_edge_stiffened=True),
            dict(C, member_type='compression', Pu=30.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, **HOLE,
                 hole_edge_stiffened=True),
            dict(C, member_type='combined', Pu=3.0, Mux=8.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0, **HOLE,
                 hole_edge_stiffened=True),
            dict(C, member_type='combined', Pu=2.0, Mux=4.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0, **HOLE),
            dict(C, member_type='compression', Pu=1.0, KxLx=96.0, KyLy=48.0, KtLt=48.0, hole_shape='circular',
                 hole_depth=1.5),
            dict(section_type='lippedc', H=4.0, B=2.0, D=0.6, t=0.1017, R=0.15, Fy=50.0, design_method='LRFD',
                 member_type='flexure', Mu=20.0, Lb=0.0, torsion_f_bending=-10.0, torsion_f_torsion=-3.0,
                 use_inelastic_reserve=True)]
    errors, codes, stats = [], set(), {'results': 0, 'notices': 0, 'reasons': 0}
    for i, p in enumerate(reqs):
        r = cases.run_case('aisi_design', p)
        assert 'error' not in r, (i, r.get('error'))
        json.dumps(r, allow_nan=False)
        NT.walk_result(r, f'verify-{i}', errors, codes, stats)
        for c in r['design_checks']:
            assert c['id'] in REGISTRY
            if c.get('clause_variant'):
                assert (c['id'], c['clause_variant']) in REGISTRY_VARIANTS
            for k, st in enumerate(c['steps']):
                for inp in st['inputs']:
                    assert isinstance(inp.get('source'), dict), (i, c['id'], k, inp)
                    if inp['source']['kind'] == 'step':
                        j = inp['source']['step']
                        assert 0 <= j < k and c['steps'][j]['result']['value'] == inp['value'], (i, c['id'], k)
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
    assert {FAILS, 'member.assumption.holes_single_hole', 'member.assumption.c1_pe1_holes_average',
            'member.assumption.h4_first_yield', 'member.reason.holes_edge_stiffened'} <= codes, codes
