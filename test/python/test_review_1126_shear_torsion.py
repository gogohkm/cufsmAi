"""2026-11-26 EB — 보강 웹 · 구멍이 있는 웹의 전단 · 웹 크리플링, §H2(보강 웹), §H4 휨 + 비틀림.

원문(aisi-cold-formed-steel 스킬): Chapter_G_Shear.md §G2.2 · §G2.3 · §G3 · §G4.1 · §G4.2 · §G6,
Chapter_H_Combined_Forces_Torsion.md §H2 · §H4, Commentary G · H.
예제: Design Manual Example II-10 (C-Section With Openings — §G3 qs, §G6 Rc),
      Example II-11 (C-Section With Combined Bending and Torsional Loading — §H4, DG 9 Cases 3 · 4).
예제가 없는 §G2.2 · §G4.1 은 아래에 손으로 적은 계산과 견준다. §H4 의 닫힌 식은 미분방정식의 수치해와도 견준다.
"""

import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'python'))
sys.path.insert(0, HERE)

from design.shear import (shear_strength, web_crippling, shear_web_strength, g4_conformance,  # noqa: E402
                          g3_reduction)
from design import torsion as T  # noqa: E402
from design.aisi_s100 import design_member  # noqa: E402
from design.checks import REGISTRY, REGISTRY_VARIANTS  # noqa: E402

E, G = 29500.0, 11300.0


def codes(reason):
    """알림(또는 이은 알림)의 code 들."""
    if hasattr(reason, 'parts'):
        return {c for p in reason.parts for c in codes(p)}
    return {getattr(reason, 'code', None)}


def close(a, b, rel=5e-3, label=''):
    assert a is not None and b is not None, (label, a, b)
    assert abs(a - b) <= rel * max(abs(b), 1e-12), f'{label}: {a} vs {b}'


def _check(r, cid):
    hits = [c for c in r['design_checks'] if c['id'] == cid]
    assert len(hits) == 1, (cid, [c['id'] for c in r['design_checks']])
    return hits[0]


# ================================================================ Example II-10 (400S162-68, Fy = 50 ksi)
II10_H = 4.00 - 2 * (0.1069 + 0.0713)          # 3.644 in (예제 그대로)
II10_T = 0.0713
II10_HOLES = dict(hole_shape='noncircular', hole_depth=1.5, hole_length=4.5, hole_spacing=24.0,
                  hole_corner_radius=0.25, hole_web_offset=0.0)


def test_II10_g3_shear_with_holes():
    """Example II-10 §2c: c = 1.07, c/t = 15.0, qs = 0.278, Vn = qs·Vn = 2.17 kips; Va(ASD) = 1.36, φVn = 2.06."""
    r = shear_strength(II10_H, II10_T, 50.0, section_type='C', **II10_HOLES)
    assert 'error' not in r, r.get('error')
    close(r['g3']['c'], 1.07, 5e-3, 'c')
    close(r['g3']['c_over_t'], 15.0, 5e-3, 'c/t')
    close(r['qs'], 0.278, 2e-3, 'qs')
    close(r['Vn'], 2.17, 3e-3, 'Vn')
    close(r['Vn'] / 1.60, 1.36, 4e-3, 'Va ASD')
    close(0.95 * r['Vn'], 2.06, 4e-3, 'phi Vn')
    assert r['g3']['c_equation'] == 'G3-3' and r['g3']['qs_equation'] == 'G3-1'
    # 예제 §1c 의 한계 확인과 같은 항목(모두 만족)
    assert all(i['ok'] for i in r['g3']['limits']['items'])


def test_II10_g6_web_crippling_with_holes():
    """Example II-10 §4c: 끝(EOF, N = 3, x = 8.25) Rc = 1.06 → 1.0, Pn = 2.36; 내부(IOF, N = 5, x = 7.25) Rc = 0.986,
    Pn = 4.72; ASD Pa = 1.35 / 2.86, LRFD φPn = 2.01 / 4.25 kips."""
    common = dict(fastened='fastened', section_type='C', d=4.0, hole_end_distance=9.75, **II10_HOLES)
    e = web_crippling(II10_H, II10_T, 0.1069, 3.0, 50.0, support='EOF', hole_bearing_distance=8.25, **common)
    assert 'error' not in e, e.get('error')
    close(e['g6']['Rc_raw'], 1.06, 5e-3, 'Rc raw EOF')
    assert e['Rc'] == 1.0 and e['g6']['equation'] == 'G6-1'
    close(e['Pn'], 2.36, 3e-3, 'Pn EOF')
    close(e['Pa'], 1.35, 4e-3, 'Pa EOF')
    close(e['phi_Pn'], 2.01, 4e-3, 'phiPn EOF')
    i = web_crippling(II10_H, II10_T, 0.1069, 5.0, 50.0, support='IOF', hole_bearing_distance=7.25, **common)
    assert 'error' not in i, i.get('error')
    close(i['Rc'], 0.986, 1e-3, 'Rc IOF')
    assert i['g6']['equation'] == 'G6-2'
    close(i['Pn_without_holes'], 4.79, 2e-3, 'Pn G5 IOF')
    close(i['Pn'], 4.72, 2e-3, 'Pn IOF')
    close(i['Pa'], 2.86, 3e-3, 'Pa IOF')
    close(i['phi_Pn'], 4.25, 3e-3, 'phiPn IOF')
    assert i['spec_sections'] == ['G5', 'G6']


II10_MEMBER = dict(member_type='flexure', design_method='ASD', Fy=50.0, Fu=65, Lb=0.0001, Mu=17.2, Vu=0.450,
                   section_type='lippedc', H=4.0, B=1.625, D=0.5, t=0.0713, R=0.1069, wc_N=5.0, wc_R=0.1069,
                   wc_support='IOF', wc_P=0.900, wc_M=21.6, hole_end_distance=9.75, hole_bearing_distance=7.25,
                   **II10_HOLES)


def test_II10_member_path_shear_and_web_crippling():
    """부재 설계(aisi_design flexure)에서 같은 값: §G3 Va = 1.36 kips (ASD), §G6 내부 Pn = 4.72, Pa = 2.86 kips."""
    r = design_member(dict(II10_MEMBER))
    assert 'error' not in r, r.get('error')
    close(r['shear']['Vn'], 2.17, 3e-3, 'Vn')
    close(r['shear']['design_strength'], 1.36, 4e-3, 'Va')
    sh = _check(r, 'member.shear')
    assert sh['clause'] == 'G3' and sh['clause_variant'] == 'web_holes' and sh['verdict'] == 'pass'
    assert [s['equation'] for s in sh['steps'] if s['kind'] == 'modifier'] == ['G3-1']
    wc = _check(r, 'member.web_crippling')
    assert wc['clause'] == 'G6' and wc['clause_variant'] == 'web_holes'
    close(r['web_crippling']['Pn'], 4.72, 2e-3, 'Pn G6')
    close(r['web_crippling']['design_strength'], 2.86, 3e-3, 'Pa G6')
    close(r['web_crippling']['Rc'], 0.986, 1e-3, 'Rc')
    assert 'G3' in r['spec_sections'] and 'G6' in r['spec_sections']
    # LRFD: φVn = 2.06, φPn = 4.25 (예제 §2d · §4d)
    r = design_member(dict(II10_MEMBER, design_method='LRFD', Mu=26.4, Vu=0.690, wc_P=1.38, wc_M=33.1))
    close(r['shear']['design_strength'], 2.06, 4e-3, 'phi Vn')
    close(r['web_crippling']['design_strength'], 4.25, 3e-3, 'phi Pn')


def test_member_holes_outside_limits_not_evaluated():
    # §G3(f) Lh 4.6 > 4.5 — 전단 · §H2 미평가(참고값도 없음: 구멍 없는 값은 보수측이 아니다)
    no_wc = {k: v for k, v in II10_MEMBER.items() if not k.startswith('wc_')}
    r = design_member(dict(no_wc, hole_length=4.6))
    sh = _check(r, 'member.shear')
    assert sh['verdict'] == 'not_evaluated' and not sh.get('reference')
    assert 'shear.reason.holes_noncircular_size' in codes(sh['reason'])
    assert _check(r, 'member.bending_shear')['verdict'] == 'not_evaluated' and r['pass'] is not True
    # §G6: 구멍이 지압 길이 안 → G5 · H3 미평가
    r = design_member(dict(II10_MEMBER, hole_within_bearing=True))
    assert _check(r, 'member.web_crippling')['verdict'] == 'not_evaluated'
    assert _check(r, 'member.bending_web_crippling')['verdict'] == 'not_evaluated'
    assert r['web_crippling']['Pn'] is None and r['pass'] is not True
    # Z 단면은 §G3 · §G6 밖
    z = dict(no_wc, section_type='lippedz', H=8.0, B=2.25, D=0.91, t=0.059, R=0.1875)
    r = design_member(z)
    if 'error' not in r:
        assert _check(r, 'member.shear')['verdict'] == 'not_evaluated'


# ---------------------------------------------------------------- §G3 · §G6 적용 한계 (원문 (a)–(h) / (a)–(i))

def _g3(**over):
    holes = dict(II10_HOLES, **over)
    holes = {k: v for k, v in holes.items() if v is not None}
    return g3_reduction(II10_H, II10_T, holes, 'C')


G3_LIMITS_OUTSIDE_NOT_EVALUATED_CASES = [
    (dict(hole_depth=2.6), 'shear.reason.holes_noncircular_size'),            # (f) dh ≤ 2.5 in
    (dict(hole_length=4.6), 'shear.reason.holes_noncircular_size'),           # (f) Lh ≤ 4.5 in
    (dict(hole_corner_radius=0.10), 'shear.reason.holes_corner_radius'),      # (e) r ≥ 2t = 0.1426
    (dict(hole_spacing=4.5 + 17.9), 'shear.reason.holes_clear_spacing'),      # (d) 순간격 ≥ 18 in
    (dict(hole_web_offset=0.25), 'shear.reason.holes_not_centered'),          # (c) 가운데
    (dict(hole_depth=0.5), 'shear.reason.holes_min_depth'),                   # (h) dh > 9/16 in
]


def test_g3_limits_outside_not_evaluated():
    for over, code in G3_LIMITS_OUTSIDE_NOT_EVALUATED_CASES:
        _g3_limits_outside_not_evaluated(over, code)


def _g3_limits_outside_not_evaluated(over, code):
    r = _g3(**over)
    assert r['evaluated'] is False and r['qs'] is None
    parts = getattr(r['reason'], 'parts', [r['reason']])
    assert any(getattr(p, 'code', None) == code for p in parts), (code, str(r['reason']))


def test_g3_limits_edges_inside_evaluated():
    """경계값은 안: dh/h = 0.7 · 순간격 18 in · r = 2t · dh = 2.5 · Lh = 4.5 (원형 지름 6 in 는 아래)."""
    assert _g3(hole_depth=2.5, hole_spacing=4.5 + 18.0, hole_corner_radius=2 * II10_T)['evaluated']
    # 원형: c = h/2 − dh/2.83 (Eq. G3-2), 지름 ≤ 6 in
    h = 9.0
    r = g3_reduction(h, 0.059, dict(hole_shape='circular', hole_depth=1.5, hole_spacing=24.0), 'C')
    assert r['evaluated'] and r['c_equation'] == 'G3-2'
    close(r['c'], h / 2 - 1.5 / 2.83, 1e-12, 'c circular')
    r = g3_reduction(h, 0.059, dict(hole_shape='circular', hole_depth=6.01, hole_spacing=30.0), 'C')
    assert not r['evaluated']      # (g) 6 in 초과 (dh/h 0.668 은 안)


def test_g3_dh_h_and_h_t_and_c_t_and_section():
    r = g3_reduction(2.0, 0.05, dict(II10_HOLES, hole_depth=1.41), 'C')     # dh/h = 0.705 > 0.7 (a)
    assert not r['evaluated'] and 'holes_dh_over_h' in r['reason'].parts[0].code
    r = g3_reduction(10.0, 0.049, dict(II10_HOLES), 'C')                     # h/t = 204 > 200 (b)
    assert not r['evaluated'] and r['reason'].parts[0].code == 'shear.reason.holes_h_over_t'
    # c/t < 5: 원문은 5 ≤ c/t < 54 와 c/t ≥ 54 만 — 그 밖은 평가하지 않는다
    r = g3_reduction(2.0, 0.1, dict(II10_HOLES, hole_depth=1.2, hole_corner_radius=0.25), 'C')   # c = 0.4, c/t = 4
    assert not r['evaluated'] and r['reason'].code == 'shear.reason.g3_c_over_t_below_5'
    # c/t ≥ 54 → qs = 1
    r = g3_reduction(8.0, 0.045, dict(II10_HOLES, hole_depth=0.8, hole_length=0.8, hole_corner_radius=0.1), 'C')
    assert r['evaluated'] and r['qs'] == 1.0 and r['c_over_t'] >= 54
    # C 단면만
    r = g3_reduction(II10_H, II10_T, dict(II10_HOLES), 'Z')
    assert not r['evaluated'] and r['reason'].parts[0].code == 'shear.reason.holes_section_not_c'
    # 자료가 모자라면 평가하지 않고 무엇이 없는지 말한다
    r = g3_reduction(II10_H, II10_T, dict(hole_shape='noncircular', hole_depth=1.5), 'C')
    assert not r['evaluated'] and set(r['limits']['missing']) == {'hole_length', 'hole_spacing', 'hole_corner_radius'}


def test_g6_limits_and_cases():
    common = dict(fastened='fastened', section_type='C', d=4.0, **II10_HOLES)
    wc = lambda **k: web_crippling(II10_H, II10_T, 0.1069, k.pop('N', 3.0), 50.0, **{**common, **k})  # noqa: E731
    # 구멍이 지압 길이 안이면 지압 보강재(§F5 — 이 도구 밖)
    r = wc(support='EOF', hole_end_distance=9.75, hole_bearing_distance=-0.5)
    assert r['Pn'] is None and 'shear.reason.g6_hole_within_bearing' in codes(r['g6']['reason'])
    r = wc(support='EOF', hole_end_distance=9.75, hole_bearing_distance=2.0, hole_within_bearing=True)
    assert r['Pn'] is None
    # N ≥ 1 in (G6-1), N ≥ 3 in (G6-2)
    r = wc(support='EOF', N=0.9, hole_end_distance=9.75, hole_bearing_distance=8.0)
    assert r['Pn'] is None and 'shear.reason.g6_min_bearing' in codes(r['g6']['reason'])
    r = wc(support='IOF', N=2.9, hole_end_distance=9.75, hole_bearing_distance=8.0)
    assert r['Pn'] is None
    assert wc(support='IOF', N=3.0, hole_end_distance=9.75, hole_bearing_distance=8.0)['Pn'] is not None
    # (e) 부재 끝 → 구멍 가장자리 ≥ d
    r = wc(support='EOF', hole_end_distance=3.9, hole_bearing_distance=8.0)
    assert r['Pn'] is None and 'shear.reason.holes_end_distance' in codes(r['g6']['reason'])
    # 두 플랜지 하중은 §G6 에 Rc 가 없다
    r = wc(support='ETF', fastened='unfastened', hole_end_distance=9.75, hole_bearing_distance=8.0)
    assert r['Pn'] is None and 'shear.reason.g6_not_covered_case' in codes(r['g6']['reason'])
    # Z (Table G5-3) 도 다루지 않는다
    r = web_crippling(II10_H, II10_T, 0.1069, 3.0, 50.0, section_type='Z', fastened='fastened', d=4.0,
                      hole_end_distance=9.75, hole_bearing_distance=8.0, **II10_HOLES)
    assert r['Pn'] is None
    # x 가 없으면 평가하지 않음
    r = wc(support='EOF', hole_end_distance=9.75)
    assert r['Pn'] is None
    # 구멍 자료 없이 web_holes=True 는 여전히 강도를 내지 않는다
    r = web_crippling(II10_H, II10_T, 0.1069, 3.0, 50.0, web_holes=True)
    assert 'error' in r and r['Pn'] is None


# ================================================================ §G2.2 · §G2.3(b) · §G4.1 (손 계산)

def _hand_g22(h, t, Fy, a):
    ah = a / h
    kv = 4.00 + 5.34 / ah ** 2 if ah <= 1.0 else 5.34 + 4.00 / ah ** 2          # Eq. G2.3-3 / G2.3-4
    Aw = h * t                                                                  # Eq. G2.1-6
    Fcr = math.pi ** 2 * E * kv / (12 * (1 - 0.3 ** 2) * (h / t) ** 2)          # Eq. G2.3-2
    Vcr = Aw * Fcr                                                              # Eq. G2.3-1
    Vy = 0.6 * Aw * Fy                                                          # Eq. G2.1-5
    lam = math.sqrt(Vy / Vcr)                                                   # Eq. G2.1-4
    if lam <= 0.776:
        return kv, Vy, Vcr, lam, Vy                                              # Eq. G2.2-1
    x = (Vcr / Vy) ** 0.4
    return kv, Vy, Vcr, lam, (1 - 0.15 * x) * x * Vy                             # Eq. G2.2-2


STIFF = dict(stiffener_kind='pair', stiffener_Is=0.05, stiffener_area=0.5, stiffener_Fy=50.0)


G22_STIFFENED_WEB_HAND_CALC_CASES = [(7.507, 0.059, 10.0), (11.5, 0.040, 8.0), (11.5, 0.060, 20.0)]


def test_g22_stiffened_web_hand_calc():
    for h, t, a in G22_STIFFENED_WEB_HAND_CALC_CASES:
        _g22_stiffened_web_hand_calc(h, t, a)


def _g22_stiffened_web_hand_calc(h, t, a):
    kv, Vy, Vcr, lam, Vn = _hand_g22(h, t, 50.0, a)
    r = shear_web_strength(h, t, 50.0, stiffeners=dict(STIFF, stiffener_spacing=a))
    assert r['evaluated'] and r['curve'] == 'G2.2', r['reason']
    close(r['kv'], kv, 1e-12, 'kv')
    close(r['Vcr'], Vcr, 1e-12, 'Vcr')
    close(r['Vn'], Vn, 1e-12, 'Vn')
    assert r['equation_id'] == ('G2.2-1' if lam <= 0.776 else 'G2.2-2')
    # 같은 웹의 §G2.1 (kv = 5.34) 보다 작지 않다(장력장 — Commentary G2.2)
    assert r['Vn'] >= shear_strength(h, t, 50.0)['Vn'] - 1e-9


def test_g22_spacing_over_2h_uses_g21_with_stiffened_kv():
    """§G2.2 는 a ≤ 2h 에서만. 2 < a/h ≤ 3 이면 §G2.1 에 §G2.3(b) kv (가정으로 밝힌다)."""
    h, t = 7.507, 0.059
    a = 2.5 * h
    r = shear_web_strength(h, t, 50.0, stiffeners=dict(STIFF, stiffener_spacing=a))
    kv = 5.34 + 4.00 / 2.5 ** 2
    assert r['evaluated'] and r['curve'] == 'G2.1'
    close(r['kv'], kv, 1e-12)
    old = shear_strength(h, t, 50.0, kv=kv)
    close(r['Vn'], old['Vn'], 1e-12, 'G2.1 with kv(b)')
    assert any(a.code == 'shear.assumption.g2_2_spacing_over_2h' for a in r['assumptions'])


def test_g41_requirements_hand_calc():
    """Eq. G4.1-1 · G4.1-2 · G4.1-3/4 · G4.1-5/6 를 손으로 — h = 7.507, t = 0.059, Fy = 50, a = 10 (pair, D = 1.0)."""
    h, t, Fy, a = 7.507, 0.059, 50.0, 10.0
    g = g4_conformance(h, t, Fy, dict(STIFF, stiffener_spacing=a, stiffener_kind='single_angle', stiffener_Fy=33.0,
                                         stiffener_area=0.4))
    ah = a / h
    Ismin = max(5 * h * t ** 3 * (h / a - 0.7 * ah), (h / 50) ** 4)
    kv = 5.34 + 4.00 / ah ** 2
    Cv = 1.53 * E * kv / (Fy * (h / t) ** 2)
    assert Cv <= 0.8
    Ast = (1 - Cv) / 2 * (ah - ah ** 2 / (ah + math.sqrt(1 + ah ** 2))) * (Fy / 33.0) * 1.8 * h * t
    close(g['Is_min'], Ismin, 1e-12, 'Is,min')
    close(g['kv'], kv, 1e-12, 'kv G4.1-6')
    close(g['Cv'], Cv, 1e-12, 'Cv G4.1-3')
    close(g['Ast_min'], Ast, 1e-12, 'Ast')
    assert g['D'] == 1.8 and g['Cv_equation'] == 'G4.1-3' and g['conforming'] is True
    close(g['a_over_h_limit'], min((260 / (h / t)) ** 2, 3.0), 1e-12)
    # Cv > 0.8 → Eq. G4.1-4 (두꺼운 웹)
    g2 = g4_conformance(3.0, 0.1, 50.0, dict(STIFF, stiffener_spacing=3.0))
    kv2 = 4.00 + 5.34
    assert g2['Cv_equation'] == 'G4.1-4'
    close(g2['Cv'], 1.11 / 30.0 * math.sqrt(E * kv2 / 50.0), 1e-12, 'Cv G4.1-4')


def test_g41_limits_and_missing_and_nonconforming():
    h, t = 7.507, 0.059
    # 간격 a/h > 3.0 (h/t = 127 이면 [260/(h/t)]² = 4.19 → 3.0 이 지배)
    g = g4_conformance(h, t, 50.0, dict(STIFF, stiffener_spacing=3.1 * h))
    assert g['conforming'] is False and g['g4_2']
    # 간격 a/h > [260/(h/t)]² (h/t = 200 → 1.69)
    g = g4_conformance(8.0, 0.04, 50.0, dict(STIFF, stiffener_spacing=1.75 * 8.0))
    assert g['conforming'] is False and abs(g['a_over_h_limit'] - (260 / 200) ** 2) < 1e-12
    # Is 부족 · Ast 부족
    assert g4_conformance(h, t, 50.0, dict(STIFF, stiffener_spacing=10.0, stiffener_Is=1e-5))['conforming'] is False
    assert g4_conformance(h, t, 50.0, dict(STIFF, stiffener_spacing=10.0, stiffener_area=0.01))['conforming'] is False
    # 자료 없음 → None(평가하지 않음), 맞지 않는 종류 → §G4.2
    g = g4_conformance(h, t, 50.0, {'stiffener_spacing': 10.0})
    assert g['conforming'] is None and set(g['missing']) == {'stiffener_kind', 'stiffener_Is', 'stiffener_area',
                                                            'stiffener_Fy'}
    g = g4_conformance(h, t, 50.0, {'stiffener_kind': 'rolled-in'})
    assert g['conforming'] is False and g['g4_2']


# ---------------------------------------------------------------- 부재 경로: 보강재

C8 = dict(member_type='flexure', design_method='LRFD', Fy=50.0, Fu=65, Lb=0.0001, section_type='lippedc',
          H=8.0, B=2.5, D=0.625, t=0.059, R=0.1875)


def test_member_stiffened_web_conforming_and_h2_2():
    a = 10.0
    r0 = design_member(dict(C8, Mu=20.0, Vu=2.0))
    r = design_member(dict(C8, Mu=20.0, Vu=2.0, stiffener_spacing=a, **STIFF))
    assert r['shear']['curve'] == 'G2.2' and r['shear']['evaluated'] is True
    h = r0['shear']['Vy'] / (0.6 * 50.0 * 0.059)
    kv, Vy, Vcr, lam, Vn = _hand_g22(h, 0.059, 50.0, a)
    close(r['shear']['Vn'], round(Vn, 2), 1e-9, 'member Vn')
    sh = _check(r, 'member.shear')
    assert sh['verdict'] == 'pass' and sh['clause'] == 'G2.2' and sh['clause_variant'] == 'stiffened_web'
    st = _check(r, 'member.web_stiffeners')
    assert st['verdict'] == 'pass' and st['clause'] == 'G4.1'
    # §H2: 보강재가 있으면 Maℓo = min(F3, F4) 이고 Eq. H2-2 는 M/Maℓo > 0.5 이고 V/Va > 0.7 일 때만
    Va = r['shear']['design_strength']
    Malo = r['shear_interaction']['Malo']
    r2 = design_member(dict(C8, Mu=0.8 * Malo, Vu=0.85 * Va, stiffener_spacing=a, **STIFF))
    si = r2['shear_interaction']
    assert si['equation'] == 'H2-2' and si['applies']
    close(si['lhs'], 0.6 * si['M_ratio'] + si['V_ratio'], 1e-3)
    assert _check(r2, 'member.bending_shear')['verdict'] in ('pass', 'fail')
    assert r['pass'] is True and 'G4' in r['spec_sections'] and 'G2' in r['spec_sections']


def test_member_boolean_stiffeners_only_is_not_evaluated_with_conservative_reference():
    """결정(이 단계의 지시): 보강재 자료가 없으면 §G2.2 는 평가하지 않음 — §G2.1 값은 보수측 참고값으로만(판정 없음).
    옛 결과는 §G2.1 로 판정하고 경고만 냈다(바뀐 기대값)."""
    r0 = design_member(dict(C8, Mu=20.0, Vu=2.0))
    r = design_member(dict(C8, Mu=20.0, Vu=2.0, transverse_stiffeners=True))
    assert r['pass'] is None and r['shear']['reference_only'] is True
    assert r['shear']['Vn'] == r0['shear']['Vn']           # 참고값 = §G2.1 (kv = 5.34)
    sh = _check(r, 'member.shear')
    assert sh['verdict'] == 'not_evaluated' and sh['capacity'] is None
    close(sh['reference']['capacity']['value'], r0['shear']['design_strength'], 1e-3)
    assert sh['reason'].startswith('§G4.1: stiffener data not given')
    assert _check(r, 'member.bending_shear')['verdict'] == 'not_evaluated'
    assert _check(r, 'member.web_stiffeners')['verdict'] == 'not_evaluated'
    assert any(str(w).startswith('§G2.2 / §G2.3(b) stiffened-web shear not evaluated') for w in r['warnings'])


def test_member_stiffener_failing_g41_is_fail_and_shear_not_evaluated():
    r = design_member(dict(C8, Mu=20.0, Vu=2.0, stiffener_spacing=10.0, **dict(STIFF, stiffener_Is=1e-5)))
    st = _check(r, 'member.web_stiffeners')
    assert st['verdict'] == 'fail' and st['ratio'] > 1
    assert _check(r, 'member.shear')['verdict'] == 'not_evaluated'
    assert r['pass'] is False


# ================================================================ §H4 — DG 9 닫힌 식

GJ_II11 = G * 0.00102
A_II11 = math.sqrt(E * 11.9 / GJ_II11)


def test_dg9_closed_forms_reproduce_example_II11_values():
    """Example II-11: a = 175 in; Case 4 (t_r = 0.000875) θ_t(L/2) = 0.199 rad, θ''_t = −21.2e-6;
    Case 3 (T = 1, α = 0.5) θ_T = 1.21 rad, θ''_T = −172e-6 (예제는 a = 175, L/a = 1.71 로 반올림해 계산)."""
    close(A_II11, 175.0, 3e-3, 'a')
    L, a = 300.0, 175.0          # 예제의 a (반올림), 예제는 L/a = 1.71 · z/a = 0.857 로 더 반올림했다 — θ 는 그 반올림에 민감
    close(T.phi_uniform(150, L, a, GJ_II11, 0.000875), 0.199, 1.5e-2, 'theta_t')
    close(T.phi_pp_uniform(150, L, a, GJ_II11, 0.000875), -21.2e-6, 1e-2, "theta''_t")
    close(T.phi_point(150, L, a, GJ_II11, 1.0, 0.5), 1.21, 2e-2, 'theta_T')
    close(T.phi_pp_point(150, L, a, GJ_II11, 1.0, 0.5), -172e-6, 5e-3, "theta''_T")
    # 예제가 반올림한 L/a = 1.71, z/a = 0.857 을 인쇄된 식에 넣으면 예제의 0.199 가 그대로 나온다(반올림이 차이의 까닭)
    lam, u = 1.71, 0.857
    th = 0.000875 * 175 ** 2 / GJ_II11 * (lam ** 2 / 2 * 0.25 + math.cosh(u) - math.tanh(lam / 2) * math.sinh(u) - 1)
    close(th, 0.199, 3e-3, 'theta_t with the example rounding')
    # 1/3 점(α = 0.667 의 집중 비틀림): θ''_T(L/3) = −67.1e-6, θ''_T(L/2) = −108e-6, θ''_T(2L/3) = −156e-6
    close(T.phi_pp_point(100, L, A_II11, GJ_II11, 1.0, 2 / 3), -67.1e-6, 1e-2, "theta''_T 1/3")
    close(T.phi_pp_point(150, L, A_II11, GJ_II11, 1.0, 2 / 3), -108e-6, 1e-2, "theta''_T 1/2")
    close(T.phi_pp_point(200, L, A_II11, GJ_II11, 1.0, 2 / 3), -156e-6, 1e-2, "theta''_T 2/3")


def test_dg9_stable_forms_equal_the_printed_forms():
    """구현의 넘침 없는 꼴 = 예제에 인쇄된 꼴 (여러 z, L/a)."""
    for L, a in ((300.0, 175.0), (300.0, 40.0), (120.0, 300.0)):
        for z in np.linspace(0, L, 13):
            pp4 = 0.001 / GJ_II11 * (-1 + math.cosh(z / a) - math.tanh(L / (2 * a)) * math.sinh(z / a))
            ph4 = 0.001 * a * a / GJ_II11 * (L ** 2 / (2 * a * a) * (z / L - z * z / L ** 2) + math.cosh(z / a)
                                             - math.tanh(L / (2 * a)) * math.sinh(z / a) - 1)
            assert abs(T.phi_pp_uniform(z, L, a, GJ_II11, 0.001) - pp4) <= 1e-9 * max(abs(pp4), 1e-12) + 1e-15
            assert abs(T.phi_uniform(z, L, a, GJ_II11, 0.001) - ph4) <= 1e-9 * max(abs(ph4), 1e-12) + 1e-12
            al = 0.3
            if z <= al * L:
                K = math.sinh(al * L / a) / math.tanh(L / a) - math.cosh(al * L / a)
                pp3 = 1.0 / (a * GJ_II11) * K * math.sinh(z / a)
                ph3 = L / GJ_II11 * ((1 - al) * z / L + a / L * K * math.sinh(z / a))
                assert abs(T.phi_pp_point(z, L, a, GJ_II11, 1.0, al) - pp3) <= 1e-9 * max(abs(pp3), 1e-12) + 1e-15
                assert abs(T.phi_point(z, L, a, GJ_II11, 1.0, al) - ph3) <= 1e-9 * max(abs(ph3), 1e-12) + 1e-12


def _fd_psi(L, ECw, GJ, load, n=4000):
    """E Cw θ'''' − G J θ'' = m_t, θ = θ'' = 0 (양 끝) → ψ = θ'': E Cw ψ'' − G J ψ = m_t, ψ(0) = ψ(L) = 0.
    다음 θ'' = ψ, θ(0) = θ(L) = 0. 중앙차분(등간격 n 칸) — 닫힌 식과 따로 푼 수치해."""
    z = np.linspace(0, L, n + 1)
    dz = L / n
    m = np.zeros(n + 1)
    if load == 'uniform':
        m[:] = 1.0
    else:
        m[n // 2] = 1.0 / dz                          # 집중 비틀림 T = 1 (z = L/2)
    N = n - 1
    Amat = (np.diag(np.full(N, -2.0 * ECw / dz ** 2 - GJ)) + np.diag(np.full(N - 1, ECw / dz ** 2), 1)
            + np.diag(np.full(N - 1, ECw / dz ** 2), -1))
    psi = np.zeros(n + 1)
    psi[1:-1] = np.linalg.solve(Amat, m[1:-1])
    B = np.diag(np.full(N, -2.0 / dz ** 2)) + np.diag(np.full(N - 1, 1.0 / dz ** 2), 1) + np.diag(np.full(N - 1, 1.0 / dz ** 2), -1)
    th = np.zeros(n + 1)
    th[1:-1] = np.linalg.solve(B, psi[1:-1])
    return z, psi, th


DG9_CLOSED_FORMS_AGAINST_NUMERICAL_ODE_CASES = [('uniform', 175.0), ('uniform', 60.0), ('midspan_point', 175.0),
                                     ('midspan_point', 60.0)]


def test_dg9_closed_forms_against_numerical_ode():
    for load, a in DG9_CLOSED_FORMS_AGAINST_NUMERICAL_ODE_CASES:
        _dg9_closed_forms_against_numerical_ode(load, a)


def _dg9_closed_forms_against_numerical_ode(load, a):
    L = 300.0
    GJ = GJ_II11
    ECw = a * a * GJ
    z, psi, th = _fd_psi(L, ECw, GJ, load)
    for k in range(200, len(z) - 1, 400):
        if load == 'uniform':
            pp, ph = T.phi_pp_uniform(z[k], L, a, GJ, 1.0), T.phi_uniform(z[k], L, a, GJ, 1.0)
        else:
            pp, ph = T.phi_pp_point(z[k], L, a, GJ, 1.0, 0.5), T.phi_point(z[k], L, a, GJ, 1.0, 0.5)
        close(psi[k], pp, 2e-3, f"theta'' z={z[k]}")
        close(th[k], ph, 2e-3, f'theta z={z[k]}')


# ---------------------------------------------------------------- §H4 Eq. H4-1 (길 ① 응력 직접) — Example II-11

def test_II11_R_direct_midspan_and_third_point_bracing():
    """Example II-11 §1: f_bB = −4.10, f_wB = −1.29 → R = 0.761 (플랜지-립 이음, 증가 없음).
    §2 1/3 점: f_bB = −3.64, f_wB = −0.431 → R = 0.894. 중앙: f_bC = −4.10, f_wC = −0.0732, 웹-플랜지 이음 →
    R = 1.15 × 0.982 = 1.13 > 1.0 → 1.0."""
    r = T.r_factor_direct(-4.10, -1.29, edge_stiffened_c=True)
    close(r['R'], 0.761, 1e-3, 'R mid-span brace')
    assert not r['increased']
    close(T.r_factor_direct(-3.64, -0.431, edge_stiffened_c=True)['R'], 0.894, 1e-3, 'R third points')
    r = T.r_factor_direct(-4.10, -0.0732, at_web_flange_junction=True, edge_stiffened_c=True)
    close(r['R_raw'] * 1.15, 1.13, 5e-3, '1.15 R')
    assert r['R'] == 1.0 and r['increased']
    # 극단 섬유가 아닌 자리(립 끝 A): f_bending_max = −4.10, f_bA = −3.39, f_wA = −1.83 → 4.10 / 5.22
    close(T.r_factor_direct(-3.39, -1.83, -4.10)['R'], 4.10 / 5.22, 1e-9, 'R at lip tip')
    assert T.r_factor_direct(-3.0, -1.0, 4.0)['error'] == 'sides'


def test_II11_midspan_brace_superposition_with_engine_warping_function():
    """Example II-11 §1 을 이 모듈의 닫힌 식 · 부채꼴 좌표로 다시: 예제의 성질(Ix 10.3, J 0.00102, Cw 11.9),
    중심선 치수 ā 8.941 · b̄ 2.441 · c̄ 0.744 (모서리 각진 모델)의 ωn 은 W_A −8.82 · W_B −6.22 · W_C 4.69,
    θ'' = θ''_t + T1 θ''_T = 7.01e-6, f_w = 0.207 Wn, R = 0.761."""
    from engine.template import generate_section
    from engine.cutwp import cutwp_prop
    s = generate_section('lippedc', dict(H=9.0, B=2.5, D=0.773, t=0.059, r=0.0))
    cw = cutwp_prop(s['node'], s['elem'])
    wn, Cw = T.sectorial_coordinate(s['node'], s['elem'], cw['Xs'], cw['Zs'])
    close(Cw, 11.9, 2e-3, 'Cw')
    close(Cw, cw['Cw'], 1e-9, 'Cw = engine cutwp Cw')
    nd = s['node']
    # 위쪽 점: 립 끝(A) = (2.441, 8.1975), 플랜지-립(B) = (2.441, 8.941), 웹-플랜지(C) = (0, 8.941)
    def at(x, z):
        return int(np.argmin(np.hypot(nd[:, 1] - x, nd[:, 2] - z)))
    WA, WB, WC = wn[at(2.441, 8.941 - 0.7435)], wn[at(2.441, 8.941)], wn[at(0.0, 8.941)]
    # 부호 규약은 예제(DG 9)와 반대(이 모듈은 σw = −E ωn θ'') — 크기와 서로의 부호 관계를 견준다
    close(abs(WA), 8.82, 2e-3, 'W_A')
    close(abs(WB), 6.22, 2e-3, 'W_B')
    close(abs(WC), 4.69, 2e-3, 'W_C')
    assert WA * WB > 0 and WB * WC < 0
    L, a, GJ = 300.0, A_II11, GJ_II11
    t_r = 10 * 1.05 / 12000.0
    T1 = -T.phi_uniform(150, L, a, GJ, t_r) / T.phi_point(150, L, a, GJ, 1.0, 0.5)
    close(T1, -0.164, 1.5e-2, 'T1')
    pp = T.phi_pp_uniform(150, L, a, GJ, t_r) + T1 * T.phi_pp_point(150, L, a, GJ, 1.0, 0.5)
    # 예제는 반올림한 중간값(θ_t 0.199, θ_T 1.21, θ''_t −21.2e-6, θ''_T −172e-6)으로 θ'' = 7.01e-6 — 그 산술 그대로:
    close(-21.2e-6 + (-0.164) * -172e-6, 7.01e-6, 2e-3, "theta'' (example's rounded values)")
    # 반올림하지 않은 값으로는 두 항이 서로 지워져 6.84e-6 (−2.4 %) — 그래서 3 % 로 견준다
    close(pp, 7.01e-6, 3e-2, "theta'' braced")
    fw = {k: E * abs(w) * pp for k, w in (('A', WA), ('B', WB), ('C', WC))}      # 크기
    close(fw['B'], 1.29, 3e-2, 'f_wB')
    # 예제의 부호: A · B 는 압축 쪽에 더하고 C 는 덜어낸다
    M = 10 * 25 ** 2 * 12 / 8 / 1000
    fb = {'A': -M * (4.5 - 0.773) / 10.3, 'B': -M * 4.5 / 10.3, 'C': -M * 4.5 / 10.3}
    f = {'A': fb['A'] - fw['A'], 'B': fb['B'] - fw['B'], 'C': fb['C'] + fw['C']}
    k = min(f, key=f.get)
    assert k == 'B'
    close(T.r_factor_direct(fb['B'], -fw['B'], edge_stiffened_c=True)['R'], 0.761, 1e-2, 'R')


# ---------------------------------------------------------------- §H4 (길 ② 하중 편심) — 따로 손으로 푼 값과

def test_route_b_unbraced_span_against_independent_hand_calc():
    """9CS2.5x059 모서리 각진 중심선 모델, L = 300 in 등분포, 하중선 = 웹(e = m). 손 계산(예제의 W_C = ā m/2 와
    부호 결과, θ'' 는 수치해): 최대 합응력은 웹-플랜지 이음 C — |f_C| = M(ā/2)/Ix + E (ā m/2)|θ''|, R = 1.15 f_b/f_C."""
    from engine.template import generate_section
    from engine.cutwp import cutwp_prop
    s = generate_section('lippedc', dict(H=9.0, B=2.5, D=0.773, t=0.059, r=0.0))
    cw = cutwp_prop(s['node'], s['elem'])
    m = -cw['Xs']                                  # 웹(x = 0) 에서 전단중심까지
    abar, L = 8.941, 300.0
    GJ, ECw = G * cw['J'], E * cw['Cw']
    z, psi, _th = _fd_psi(L, ECw, GJ, 'uniform')
    pp = psi[len(z) // 2] * m                     # 단위 하중 w = 1 kip/in, t_r = w m
    M = L ** 2 / 8
    fb = M * (abar / 2) / cw['Ixx']
    fC = fb + E * (abar * m / 2) * abs(pp)
    R_hand = min(1.15 * fb / fC, 1.0)
    rr = T.r_factor_eccentric(s['node'], s['elem'], e=m, L=L, load='uniform', roles=s['element_roles'],
                              edge_stiffened_c=True)
    assert 'error' not in rr, rr
    assert rr['at_junction'] and rr['increased'] and abs(rr['y'] - L / 2) < 1e-9
    close(rr['R'], R_hand, 2e-3, 'R route b vs hand')
    # 하중선이 전단중심 너머(e = −m)이면 립 끝 쪽이 지배하고 15 % 는 쓰지 않는다
    rr2 = T.r_factor_eccentric(s['node'], s['elem'], e=-m, L=L, load='uniform', roles=s['element_roles'],
                               edge_stiffened_c=True)
    assert not rr2['at_junction'] and rr2['R'] < rr['R']
    # 전단중심을 지나는 하중 → R = 1
    rr3 = T.r_factor_eccentric(s['node'], s['elem'], e=0.0, L=L, load='uniform', roles=s['element_roles'])
    close(rr3['R'], 1.0, 1e-12)


def test_route_b_midspan_point_against_hand_calc():
    from engine.template import generate_section
    from engine.cutwp import cutwp_prop
    s = generate_section('lippedc', dict(H=9.0, B=2.5, D=0.773, t=0.059, r=0.0))
    cw = cutwp_prop(s['node'], s['elem'])
    m, abar, L = -cw['Xs'], 8.941, 200.0
    GJ, ECw = G * cw['J'], E * cw['Cw']
    z, psi, _th = _fd_psi(L, ECw, GJ, 'midspan_point')
    pp = psi[len(z) // 2] * m
    M = L / 4
    fb = M * (abar / 2) / cw['Ixx']
    fC = fb + E * (abar * m / 2) * abs(pp)
    rr = T.r_factor_eccentric(s['node'], s['elem'], e=m, L=L, load='midspan_point', roles=s['element_roles'],
                              edge_stiffened_c=False)
    close(rr['R'], fb / fC, 3e-3, 'R point load')
    assert rr['at_junction'] and not rr['increased']


# ---------------------------------------------------------------- §H4 부재 경로 · 적용 한계

C9 = dict(member_type='flexure', design_method='ASD', Fy=55.0, Fu=70, Lb=0.0001, Mu=40.0, section_type='lippedc',
          H=9.0, B=2.5, D=0.773, t=0.059, R=0.1875)


def test_member_h4_direct_route():
    r = design_member(dict(C9, torsion_f_bending=-4.10, torsion_f_torsion=-1.29))
    h4 = _check(r, 'member.bending_torsion')
    t = r['torsion']
    close(t['R'], 0.7607, 1e-3)
    Mnlo = r['display_unrounded']['torsion']['Mnlo']
    close(h4['capacity']['value'], 0.761 * Mnlo / 1.67, 2e-3, 'R Malo')
    close(h4['ratio'], 40.0 / (t['R'] * Mnlo / 1.67), 2e-3)
    assert h4['clause'] == 'H4' and h4['verdict'] == ('pass' if h4['ratio'] <= 1 else 'fail')
    # §H4 는 따로 된 한계상태 — F2 · F3 · F4 · H2 의 값은 바뀌지 않는다(해설 H4)
    r0 = design_member(dict(C9))
    for cid in ('member.flexure.global', 'member.flexure.local', 'member.flexure.distortional'):
        assert _check(r, cid)['capacity'] == _check(r0, cid)['capacity']
    assert 'H4' in r['spec_sections']
    assert not any('§H4: 비틀림 입력이 없어' in str(x) for x in r['scope_notes'])
    assert not any(str(x).startswith('H4 combined') for x in r['not_checked'])
    assert any(str(x).startswith('§H4: 비틀림 입력이 없어') for x in r0['scope_notes'])


def test_member_h4_computed_route_and_numbers_flow_to_check():
    r = design_member(dict(C9, torsion_eccentricity=1.05, torsion_span=300.0, torsion_load='uniform',
                           torsion_support='simple'))
    t = r['torsion']
    assert t['route'] == 'computed' and t['evaluated'] and t['at_web_flange_junction'] and t['increased_15pct']
    h4 = _check(r, 'member.bending_torsion')
    close(h4['ratio'], t['Mu'] / (t['R'] * r['display_unrounded']['torsion']['Mnlo'] / 1.67), 2e-3)
    assert (r['pass'] is False) == (h4['ratio'] > 1)
    # 같은 단면 · 하중을 torsion 모듈로 곧장
    from engine.template import generate_section
    s = generate_section('lippedc', dict(H=9.0, B=2.5, D=0.773, t=0.059, r=0.1875))
    rr = T.r_factor_eccentric(s['node'], s['elem'], e=1.05, L=300.0, load='uniform', roles=s['element_roles'],
                              edge_stiffened_c=True)
    close(t['R'], rr['R'], 1e-3)


MEMBER_H4_APPLICABILITY_CASES = [
    (dict(section_type='lippedz', torsion_f_bending=-4.0, torsion_f_torsion=-1.0), 'not_evaluated',
     'member.reason.h4_section_not_symmetric'),
    (dict(torsion_eccentricity=1.0, torsion_span=300.0, torsion_load='uniform', torsion_support='cantilever'),
     'not_evaluated', 'member.reason.h4_route_a_only'),
    (dict(torsion_eccentricity=1.0, torsion_span=300.0, torsion_load='uniform'), 'not_evaluated',
     'member.reason.h4_input_missing'),
    (dict(torsion_eccentricity=1.0, torsion_span=300.0, torsion_load='triangular', torsion_support='simple'),
     'not_evaluated', 'member.reason.h4_load_unknown'),
    (dict(torsion_f_torsion=-1.0), 'not_evaluated', 'member.reason.h4_input_missing'),
    (dict(R_uplift=0.7, span_type='simple', torsion_f_bending=-4.0, torsion_f_torsion=-1.0), 'not_applicable',
     'member.reason.h4_i621_used'),
]


def test_member_h4_applicability():
    for extra, verdict, code in MEMBER_H4_APPLICABILITY_CASES:
        _member_h4_applicability(extra, verdict, code)


def _member_h4_applicability(extra, verdict, code):
    p = dict(C9, **extra)
    if extra.get('section_type') == 'lippedz':
        p.update(H=8.0, B=2.25, D=0.91)
    r = design_member(p)
    h4 = _check(r, 'member.bending_torsion')
    assert h4['verdict'] == verdict, (h4['verdict'], str(h4.get('reason')))
    assert h4['reason'].code == code if hasattr(h4['reason'], 'code') else True
    via = json.loads(json.dumps(_run('aisi_design', p)))
    c = [x for x in via['design_checks'] if x['id'] == 'member.bending_torsion'][0]
    assert c['reason_code'] == code


def test_member_h4_biaxial_in_combined_is_not_evaluated():
    p = dict(C9, member_type='combined', Pu=1.0, Mux=30.0, Muy=2.0, May_strength=20.0, KxLx=60, KyLy=60, KtLt=60,
             Lb=60, torsion_f_bending=-4.0, torsion_f_torsion=-1.0)
    r = design_member(p)
    h4 = [c for c in r['design_checks'] if c['id'] == 'member.bending_torsion'][0]
    assert h4['verdict'] == 'not_evaluated' and h4['reason'].code == 'member.reason.h4_biaxial'
    p['Muy'] = 0.0
    r = design_member(p)
    h4 = [c for c in r['design_checks'] if c['id'] == 'member.bending_torsion'][0]
    assert h4['verdict'] in ('pass', 'fail') and r['torsion']['evaluated']


def test_member_h4_no_section_model_given_props_only():
    """props 만 주면(단면 모델 node · elem 없음) 길 ② 는 평가하지 않는다 — 길 ① 을 쓰라고 말한다."""
    from engine.template import generate_section
    s = generate_section('lippedc', dict(H=9.0, B=2.5, D=0.773, t=0.059, r=0.1875))
    from engine.properties import grosprop
    g = grosprop(s['node'], s['elem'])
    pr = {k: float(v) for k, v in g.items() if isinstance(v, (int, float, np.floating))}
    pr.update(Sf=pr['Sx'], t=0.059, R=0.1875, J=0.00102, Cw=11.1, xo=1.6)
    q = dict(member_type='flexure', design_method='ASD', Fy=55.0, Lb=0.0001, Mu=40.0, section_type='C', props=pr,
             section=dict(type='C', depth=9.0, flange_width=2.5, lip_depth=0.773, thickness=0.059, r=0.1875),
             dsm=dict(Mcrl=150.0, Mcrd=180.0), torsion_eccentricity=1.0, torsion_span=300.0, torsion_load='uniform',
             torsion_support='simple')
    r = design_member(q)
    h4 = _check(r, 'member.bending_torsion')
    assert h4['verdict'] == 'not_evaluated' and h4['reason'].code == 'member.reason.h4_no_section_model'
    # 단면 모델을 주면 평가한다
    r = design_member(dict(q, node=s['node'].tolist(), elem=s['elem'].tolist(), element_roles=s['element_roles']))
    assert _check(r, 'member.bending_torsion')['verdict'] in ('pass', 'fail')
    assert r['torsion']['increased_15pct']


# ================================================================ 입력이 없으면 그대로 (결정 T4) · 계약

NEW_KEYS = ('stiffener_spacing', 'stiffener_kind', 'stiffener_Is', 'stiffener_area', 'stiffener_Fy',
            'hole_corner_radius', 'hole_bearing_distance', 'hole_within_bearing', 'torsion_f_bending',
            'torsion_f_torsion', 'torsion_f_bending_max', 'torsion_at_web_flange_junction', 'torsion_eccentricity',
            'torsion_span', 'torsion_load', 'torsion_support')


def _run(method, params):
    import contract_cases_1123 as cases
    return cases.run_case(method, params)


def test_no_new_input_is_identical():
    for p in (dict(C8, Mu=20.0, Vu=2.0), dict(C9, wc_N=3.0, wc_R=0.1875, wc_P=1.0),
              dict(C9, member_type='combined', Pu=1.0, Mux=30.0, KxLx=60, KyLy=60, KtLt=60, Lb=60, Vu=1.0)):
        a = _run('aisi_design', p)
        b = _run('aisi_design', dict(p, **{k: None for k in NEW_KEYS}))
        assert a == b
        for k in ('torsion', 'web_stiffeners'):
            assert k not in a
        if 'shear' in a:
            assert 'evaluated' not in a['shear']


def test_new_results_keep_the_check_and_notice_contracts():
    """새 길의 결과도 계약 시험의 같은 규칙: 모든 알림이 등록된 code · 다시 그린 글과 같음, 검토 id 등록 · 갈래의 조항,
    단계 입력의 출처, mirrors = 옛 필드, 비 = 소요/강도, 평가하지 않은 항목에 강도 · 비 없음."""
    from test_review_1124_notices import walk_result
    cases = [
        dict(C8, Mu=20.0, Vu=2.0, stiffener_spacing=10.0, **STIFF),
        dict(C8, Mu=20.0, Vu=2.0, transverse_stiffeners=True),
        dict(C8, Mu=20.0, Vu=2.0, stiffener_spacing=10.0, **dict(STIFF, stiffener_Is=1e-5)),
        dict(C8, Mu=20.0, Vu=2.0, stiffener_spacing=10.0, stiffener_kind='stamped'),
        dict(C9, torsion_f_bending=-4.10, torsion_f_torsion=-1.29),
        dict(C9, torsion_eccentricity=1.05, torsion_span=300.0, torsion_load='uniform', torsion_support='simple'),
        dict(C9, torsion_eccentricity=1.05, torsion_span=300.0, torsion_load='midspan_point', torsion_support='simple'),
        dict(C9, torsion_eccentricity=1.05, torsion_span=300.0, torsion_load='uniform', torsion_support='fixed'),
        dict(C9, member_type='combined', Pu=1.0, Mux=30.0, KxLx=60, KyLy=60, KtLt=60, Lb=60, Vu=1.0,
             torsion_f_bending=-4.0, torsion_f_torsion=-1.0, stiffener_spacing=10.0, **STIFF),
        dict(II10_MEMBER),
        dict(II10_MEMBER, design_method='LRFD', Mu=26.4, Vu=0.690, wc_P=1.38, wc_M=33.1),
        dict(II10_MEMBER, hole_length=4.6),
        dict(II10_MEMBER, hole_within_bearing=True),
        dict(II10_MEMBER, member_type='combined', Pu=0.5, Mux=17.2, KxLx=60, KyLy=60, KtLt=60, Lb=60),
    ]
    errors, codes, stats = [], set(), {'results': 0, 'notices': 0, 'reasons': 0}
    for i, p in enumerate(cases):
        via = _run('aisi_design', p)
        assert 'error' not in via, via.get('error')
        walk_result(via, f'case{i}', errors, codes, stats)
        for c in via['design_checks']:
            reg = REGISTRY_VARIANTS[(c['id'], c['clause_variant'])] if c.get('clause_variant') else REGISTRY[c['id']]
            assert (c['clause'], c['name'], c['name_ko']) == (reg['clause'], reg['name'], reg['name_ko'])
            if c['verdict'] == 'not_evaluated':
                assert c['capacity'] is None and c['ratio'] is None and c.get('reason')
            for j, s in enumerate(c['steps']):
                for inp in s['inputs']:
                    assert isinstance(inp.get('source'), dict), (c['id'], j, inp)
                    if inp['source']['kind'] == 'step':
                        assert 0 <= inp['source']['step'] < j
            for field, m in (c.get('mirrors') or {}).items():
                cur = via
                for part in m['path'].replace(']', '').replace('[', '.').split('.'):
                    cur = cur[int(part)] if part.isdigit() else cur[part]
                holder = c.get('reference') if c['verdict'] == 'not_evaluated' else c
                v = (holder or {}).get(field)
                v = v.get('value') if isinstance(v, dict) else v
                assert round(v, m['digits']) == cur, (i, c['id'], field, v, cur)
            if c['verdict'] in ('pass', 'fail') and c['ratio'] is not None and c['demand'] and c['capacity']:
                assert abs(c['demand']['value'] / c['capacity']['value'] - c['ratio']) <= 1e-12 * max(1, c['ratio'])
        ids = [c['id'] for c in via['design_checks']]
        assert len(ids) == len(set(ids)), ids
    assert not errors, errors[:10]
    assert stats['results'] >= len(cases)


def test_standalone_web_crippling_tool_passes_hole_inputs():
    """RPC web_crippling(단독 도구)는 hole_* 를 엔진에 그대로 넘긴다 — 직접 부른 값과 같다."""
    p = dict(h=II10_H, t=II10_T, R=0.1069, N=5.0, Fy=50.0, support='IOF', fastened='fastened', section_type='C',
             d=4.0, hole_end_distance=9.75, hole_bearing_distance=7.25, **II10_HOLES)
    via = _run('web_crippling', p)
    assert 'ignored_params' not in via and not any('not used' in str(w) for w in via.get('warnings') or [])
    close(via['Pn'], 4.72, 2e-3, 'RPC Pn')
    assert via['Rc'] == round(web_crippling(**p)['Rc'], 4)
