"""2026-11-22 엔진 리뷰 R7 (하중·연속보·소요강도·브레이싱) 회귀 시험 — F7

기대값은 엔진 값을 베끼지 않는다. 닫힌 해, 이 파일 안의 독립 강성법 해(`_ref_solve`,
경계마다 절점을 두는 구간별 등단면·등분포 보 — 요소 안은 정역학으로 정확), 그리고
AISI 설계매뉴얼 · ASCE 7 의 식을 시험 안에서 따로 계산한다.
"""

import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'python'))

from design.loads.beam_analysis import (  # noqa: E402
    analyze_simple_beam, analyze_continuous_beam_general, analyze_beam_fe,
    analyze_cantilever_beam, extract_critical_locations,
)
from design.loads.bracing import (  # noqa: E402
    calc_rotational_stiffness, calc_lateral_stiffness, check_i621_conditions,
    calc_beta_distortional, determine_unbraced_lengths,
)
from design.loads.distortional_params import calc_flange_properties, calc_Fcrd  # noqa: E402
from design.loads.local_params import calc_Fcrl  # noqa: E402
from design.loads.load_combinations import (  # noqa: E402
    get_applicable_combos, find_controlling_combo, snow_partial_cases,
)
from design.loads.required_strength import analyze_loads  # noqa: E402

E = 29500.0


# ---------------------------------------------------------------------------
# 독립 기준해 (리뷰어 ref_beam.py 와 같은 방법을 따로 구현)
# ---------------------------------------------------------------------------

def _ref_solve(spans, w_span_kft, EI_func, supports=None, breaks=()):
    """x ft, w kip/ft(하향 +), EI kip-ft². 경계·EI 계단에 절점을 두는 Hermite 요소."""
    n_sp = len(spans)
    supports = supports or ['P'] * (n_sp + 1)
    xs = np.concatenate([[0.0], np.cumsum(spans)])
    pts = set(np.round(xs, 9))
    for b in breaks:
        if 0 < b < xs[-1]:
            pts.add(round(b, 9))
    nodes = np.array(sorted(pts))
    nn = len(nodes)
    K = np.zeros((2 * nn, 2 * nn))
    F = np.zeros(2 * nn)
    els = []
    for e in range(nn - 1):
        a, b = nodes[e], nodes[e + 1]
        Le = b - a
        xm = 0.5 * (a + b)
        s = min(max(np.searchsorted(xs, xm, side='right') - 1, 0), n_sp - 1)
        w = w_span_kft[s]
        EI = EI_func(xm)
        k = EI / Le ** 3 * np.array([[12, 6 * Le, -12, 6 * Le], [6 * Le, 4 * Le ** 2, -6 * Le, 2 * Le ** 2],
                                      [-12, -6 * Le, 12, -6 * Le], [6 * Le, 2 * Le ** 2, -6 * Le, 4 * Le ** 2]])
        fe = w * Le / 2 * np.array([1, Le / 6, 1, -Le / 6])
        d = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3]
        K[np.ix_(d, d)] += k
        F[d] += fe
        els.append((a, b, EI, w, k, fe, d))
    fixed = []
    for j, s in enumerate(supports):
        i = int(np.argmin(abs(nodes - xs[j])))
        if s != 'N':
            fixed.append(2 * i)
        if s == 'F':
            fixed.append(2 * i + 1)
    free = [i for i in range(2 * nn) if i not in fixed]
    u = np.zeros(2 * nn)
    u[free] = np.linalg.solve(K[np.ix_(free, free)], F[free])
    Rall = K @ u - F
    R = []
    for j, s in enumerate(supports):
        i = int(np.argmin(abs(nodes - xs[j])))
        R.append(-Rall[2 * i] if s != 'N' else 0.0)   # 상향 +
    seg = [(a, b, EI, w, k @ u[d] - fe) for (a, b, EI, w, k, fe, d) in els]
    return {'nodes': nodes, 'u': u, 'seg': seg, 'R': R}


def _ref_MV(sol, x, side='right'):
    segs = sol['seg']
    for (a, b, EI, w, f) in segs:
        inside = (a <= x < b) if side == 'right' else (a < x <= b)
        if inside or (x == segs[-1][1] and b == x) or (x == segs[0][0] and a == x):
            s = x - a
            return f[1] + (-f[0]) * s - w * s * s / 2, (-f[0]) - w * s
    raise ValueError(x)


def _ref_defl_in(sol, x):
    nodes, u = sol['nodes'], sol['u']
    for e in range(len(nodes) - 1):
        a, b = nodes[e], nodes[e + 1]
        if a <= x <= b:
            Le = b - a
            s = (x - a) / Le
            N = [1 - 3 * s ** 2 + 2 * s ** 3, Le * (s - 2 * s ** 2 + s ** 3), 3 * s ** 2 - 2 * s ** 3, Le * (-s ** 2 + s ** 3)]
            vh = sum(N[i] * u[2 * e + i] for i in range(4))
            EI, w = sol['seg'][e][2], sol['seg'][e][3]
            return (vh + w * (x - a) ** 2 * (b - x) ** 2 / (24 * EI)) * 12.0
    raise ValueError(x)


def _ref_extrema(sol, a, b, n=4001):
    xs = np.linspace(a, b, n)
    M = [_ref_MV(sol, x)[0] for x in xs]
    return max(M), min(M)


def _near(r, x):
    return int(np.argmin([abs(v - x) for v in r.x]))


def _rel(a, b):
    return abs(a - b) / max(abs(b), 1e-12)


def _loc(locs, name):
    hits = [loc for loc in locs if loc['name'] == name]
    assert hits, f'{name} not in {[loc["name"] for loc in locs]}'
    return hits[0]


# ---------------------------------------------------------------------------
# 닫힌 해 · 독립해 표 (리뷰 「맞다고 확인한 것」) — 지금 맞는 것이 그대로인지
# ---------------------------------------------------------------------------

L25, W100, I10 = 25.0, 100.0, 10.0
w_k = W100 / 1000.0
EI_kft2 = E * I10 / 144.0


def test_R7_closed_form_simple_span():
    """단순보: M = wL²/8, V = wL/2, δ = 5wL⁴/384EI (닫힌 해, 0.01 %)."""
    r = analyze_simple_beam(L25, W100)
    assert _rel(max(r.M), w_k * L25 ** 2 / 8) < 1e-4
    assert _rel(r.V[0], w_k * L25 / 2) < 1e-4
    fe = analyze_beam_fe([L25], [W100], ['P', 'P'], None, I10, 2.0, E)
    assert _rel(max(fe.D), 5 * w_k * L25 ** 4 / (384 * EI_kft2) * 12) < 1e-4
    assert _rel(sum(fe.R), w_k * L25) < 1e-6 and min(fe.R) > 0


def test_R7_closed_form_equal_spans():
    """2·3·4 등경간: 지점 M −wL²/8, −wL²/10, −3wL²/28; 반력 3/8, 10/8 wL; 4경간 11/28, 32/28, 26/28 wL."""
    r2 = analyze_continuous_beam_general([L25] * 2, [W100] * 2)
    assert _rel(r2.M[_near(r2, 25)], -w_k * L25 ** 2 / 8) < 1e-6
    assert _rel(r2.R[0], 0.375 * w_k * L25) < 1e-6 and _rel(r2.R[1], 1.25 * w_k * L25) < 1e-6
    assert _rel(max(r2.M), 9 / 128 * w_k * L25 ** 2) < 2e-3   # 격자 51점 (리뷰: −0.02 %)
    r3 = analyze_continuous_beam_general([L25] * 3, [W100] * 3)
    assert _rel(r3.M[_near(r3, 25)], -0.1 * w_k * L25 ** 2) < 1e-6
    r4 = analyze_continuous_beam_general([L25] * 4, [W100] * 4)
    assert _rel(r4.M[_near(r4, 25)], -3 / 28 * w_k * L25 ** 2) < 1e-6
    for j, c in ((0, 11 / 28), (1, 32 / 28), (2, 26 / 28)):
        assert _rel(r4.R[j], c * w_k * L25) < 1e-6
    fe2 = analyze_beam_fe([L25] * 2, [W100] * 2, None, None, I10, 2.0, E)
    sol = _ref_solve([L25] * 2, [w_k] * 2, lambda x: EI_kft2)
    dmax = max(_ref_defl_in(sol, x) for x in np.linspace(0, 25, 2001))
    assert _rel(max(fe2.D), dmax) < 1e-3


def test_R7_independent_unequal_fixed_cantilever_overhang():
    """부등경간 20/30/25, 양단고정, 캔틸레버, 내민보 20+5 — 독립 강성법과 0.01 %."""
    spans = [20, 30, 25]
    r = analyze_continuous_beam_general(spans, [W100] * 3)
    sol = _ref_solve(spans, [w_k] * 3, lambda x: EI_kft2)
    for xj in (20, 50):
        assert _rel(r.M[_near(r, xj)], _ref_MV(sol, xj)[0]) < 1e-4
    for a, b in zip(r.R, sol['R']):
        assert _rel(a, b) < 1e-4
    ff = analyze_continuous_beam_general([L25], [W100], supports=['F', 'F'])
    assert _rel(ff.M[0], -w_k * L25 ** 2 / 12) < 1e-6
    assert _rel(ff.M[_near(ff, 12.5)], w_k * L25 ** 2 / 24) < 1e-6
    fef = analyze_beam_fe([L25], [W100], ['F', 'F'], None, I10, 2.0, E)
    assert _rel(fef.D[_near(fef, 12.5)], w_k * L25 ** 4 / (384 * EI_kft2) * 12) < 1e-4
    c = analyze_cantilever_beam(8.0, W100)
    assert _rel(c.M[0], -w_k * 64 / 2) < 1e-9
    ov = analyze_continuous_beam_general([20, 5], [W100] * 2, supports=['P', 'P', 'N'])
    solo = _ref_solve([20, 5], [w_k] * 2, lambda x: EI_kft2, ['P', 'P', 'N'])
    assert _rel(ov.M[_near(ov, 20)], _ref_MV(solo, 20)[0]) < 1e-6
    assert _rel(ov.R[0], solo['R'][0]) < 1e-6 and _rel(ov.R[1], solo['R'][1]) < 1e-6
    assert ov.R[2] == 0.0


def test_R7_18_lap_EI_extent_exact():
    """R7-18: 랩 EI 는 요소 중점 판정 — 랩 2/2 ft 정확해 Msup −8.6334, M(12.5) 3.4958, δ 1.0233 in (n=51, 0.1 %)."""
    laps = [None, {'left_ft': 2.0, 'right_ft': 2.0}, None]
    r = analyze_beam_fe([L25] * 2, [W100] * 2, ['P'] * 3, laps, I10, 2.0, E)
    sol = _ref_solve([L25] * 2, [w_k] * 2, lambda x: 2 * EI_kft2 if 23 <= x <= 27 else EI_kft2,
                     breaks=(23, 27))
    assert _rel(r.M[_near(r, 25)], _ref_MV(sol, 25)[0]) < 1e-3
    assert _rel(r.M[_near(r, 12.5)], _ref_MV(sol, 12.5)[0]) < 1e-3
    assert _rel(r.D[_near(r, 12.5)], _ref_defl_in(sol, 12.5)) < 1e-3
    # 2.5/3.5 랩: 정확해 −8.9405 (리뷰). 격자를 바꿔도 결과가 같아야 한다.
    laps2 = [None, {'left_ft': 2.5, 'right_ft': 3.5}, None]
    sol2 = _ref_solve([L25] * 2, [w_k] * 2, lambda x: 2 * EI_kft2 if 22.5 <= x <= 28.5 else EI_kft2,
                      breaks=(22.5, 28.5))
    for npts in (51, 201):
        r2 = analyze_beam_fe([L25] * 2, [W100] * 2, None, laps2, I10, 2.0, E, n_pts_per_span=npts)
        assert _rel(r2.M[_near(r2, 25)], _ref_MV(sol2, 25)[0]) < 1e-3


# ---------------------------------------------------------------------------
# R7-01 · R7-20 하중조합
# ---------------------------------------------------------------------------

def test_R7_01_missing_L_keeps_wind_combinations():
    """R7-01: L 이 없어도 W 조합이 남는다 (ASCE 7 "loads not acting") — 단순보 25 ft.

    LRFD D=10, Lr=100, Wp=300 → 1.2D+1.0W+0.5Lr: w = 12+300+50 = 362 plf, M = wL²/8 = 28.28.
    ASD D=10, Lr=100, Wp=150 → D+0.75(0.6W)+0.75Lr: w = 10+67.5+75 = 152.5, M = 11.91.
    LRFD D=50, Wp=100 → 1.2D+1.0W: w = 160, M = 12.50.
    """
    r = analyze_loads('roof-purlin', 'simple', 25, {'D': 10, 'Lr': 100, 'Wp': 300}, 'LRFD')
    assert r['gravity']['combo'].startswith('4: 1.2D+1.0W+0.5Lr')
    assert _rel(max(r['gravity']['M_envelope_max']), 0.362 * 625 / 8) < 5e-3
    r = analyze_loads('roof-purlin', 'simple', 25, {'D': 10, 'Lr': 100, 'Wp': 150}, 'ASD')
    assert r['gravity']['combo'].startswith('6a: D+0.75(0.6W)+0.75Lr')
    assert _rel(max(r['gravity']['M_envelope_max']), 0.1525 * 625 / 8) < 5e-3
    r = analyze_loads('roof-purlin', 'simple', 25, {'D': 50, 'Wp': 100}, 'LRFD')
    assert r['gravity']['combo'].startswith('4: 1.2D+1.0W')
    assert _rel(max(r['gravity']['M_envelope_max']), 0.160 * 625 / 8) < 5e-3


def test_R7_01_combo_list_reduction_and_merge():
    """R7-01: 없는 항만 빼고, 같은 계수 집합은 하나로."""
    combos = get_applicable_combos({'D': 10, 'Lr': 100, 'W': -150}, 'LRFD')
    names = [n for n, _ in combos]
    keys = [tuple(sorted(f.items())) for _, f in combos]
    assert len(keys) == len(set(keys))
    assert '4: 1.2D+1.0W+0.5Lr' in names and '6: 0.9D+1.0W' in names
    asd = [n for n, _ in get_applicable_combos({'D': 10, 'S': 100, 'W': -150}, 'ASD')]
    assert '6a: D+0.75(0.6W)+0.75S' in asd and '7: 0.6D+0.6W' in asd


def test_R7_20_method_and_edition():
    """R7-20: 'lrfd' 은 LRFD, 그 밖의 설계법은 오류, 판 표기."""
    a = get_applicable_combos({'D': 10, 'Lr': 100}, 'lrfd')
    b = get_applicable_combos({'D': 10, 'Lr': 100}, 'LRFD')
    assert a == b
    for bad in ('LSD', 'xyz', None):
        with pytest.raises(ValueError):
            get_applicable_combos({'D': 10}, bad)
    with pytest.raises(ValueError):
        analyze_loads('roof-purlin', 'simple', 25, {'D': 10}, 'LSD')
    r = analyze_loads('roof-purlin', 'simple', 25, {'D': 10, 'Lr': 20}, 'asd')
    assert r['design_method'] == 'ASD'
    assert r['load_combination_standard']['edition'] == 'ASCE/SEI 7-10'


def test_R7_29_wind_none_and_self_weight_note():
    """R7-29: W=None 이 TypeError 를 내지 않고, 자중 미포함을 밝힌다."""
    res = find_controlling_combo({'D': 10, 'W': None}, {'D': {'M': [0, 1, 0], 'V': [0, 0, 0], 'R': [1, 1]}})
    assert res['gravity'] is not None
    r = analyze_loads('roof-purlin', 'simple', 20, {'D': 10, 'W': None}, 'LRFD')
    assert any('self-weight' in a for a in r['scope_notes'])      # 늘 참인 범위 안내 (FIXES §3.1.1)


# ---------------------------------------------------------------------------
# R7-07 · R7-26 부분재하
# ---------------------------------------------------------------------------

def test_R7_07_snow_partial_loading_three_spans():
    """R7-07: 3경간 25 ft, 1.2D+1.6S (D 15, S 100) — ASCE 7 Sec. 7.5.1 경우 독립해 (±0.5 %).

    표: 외측 M+ 9.579, 내부 M+ 4.109, 1번 내부지점 M −11.958, R 5.095.
    """
    L = 25.0
    D, S = 0.015, 0.100
    cases = [[1, 1, 1], [1, .5, .5], [.5, 1, 1], [.5, .5, 1], [1, 1, .5]]
    ext, intr, msup, r1 = -1e9, -1e9, 1e9, -1e9
    for f in cases:
        sol = _ref_solve([L] * 3, [1.2 * D + 1.6 * S * k for k in f], lambda x: 2000.0)
        ext = max(ext, _ref_extrema(sol, 0, L)[0])
        intr = max(intr, _ref_extrema(sol, L, 2 * L)[0])
        msup = min(msup, _ref_MV(sol, L)[0])
        r1 = max(r1, sol['R'][1])
    r = analyze_loads('roof-purlin', 'cont-3', L, {'D': 15, 'S': 100}, 'LRFD')
    locs = r['gravity']['locations']
    assert _rel(max(loc['Mu'] for loc in locs if loc['name'] == 'End span +M'), ext) < 5e-3
    assert _rel(_loc(locs, 'Int span 2 +M')['Mu'], intr) < 5e-3
    sup1 = _loc(locs, '1st interior')
    assert _rel(sup1['Mu'], msup) < 5e-3
    assert _rel(sup1['Ru'], r1) < 5e-3
    assert 'S' in sup1['pattern'] and r['pattern_loading']['enabled']
    # 끄면 균등재하 (내부 M+ 2.781)
    r0 = analyze_loads('roof-purlin', 'cont-3', L, {'D': 15, 'S': 100}, 'LRFD', pattern_loading=False)
    sol = _ref_solve([L] * 3, [1.2 * D + 1.6 * S] * 3, lambda x: 2000.0)
    assert _rel(_loc(r0['gravity']['locations'], 'Int span 2 +M')['Mu'], _ref_extrema(sol, L, 2 * L)[0]) < 5e-3


def test_R7_07_snow_case_list():
    """Sec. 7.5.1: 4경간 → 균형 + 외측 full/half 4 + 인접 쌍 3 (중복 제거)."""
    cases = snow_partial_cases(4)
    vecs = [tuple(v) for _, v in cases]
    assert (1, 1, 1, 1) in vecs and (1, .5, .5, .5) in vecs and (.5, 1, 1, 1) in vecs
    assert (1, 1, .5, .5) in vecs and (.5, 1, 1, .5) in vecs and (.5, .5, 1, 1) in vecs
    assert len(vecs) == len(set(vecs))


def test_R7_07_live_load_alternate_and_adjacent_spans():
    """R7-07: L 은 경간마다 실림/안 실림 — 4경간 1.2D+1.6L, 위치별 최악 (2⁴ 조합 독립해 전수)."""
    L = 20.0
    D, LL = 0.020, 0.100
    best = {'Mpos2': -1e9, 'Msup1': 1e9, 'R1': -1e9, 'Mneg_mid3': 1e9}
    for mask in range(16):
        f = [(mask >> i) & 1 for i in range(4)]
        sol = _ref_solve([L] * 4, [1.2 * D + 1.6 * LL * k for k in f], lambda x: 2000.0)
        best['Mpos2'] = max(best['Mpos2'], _ref_extrema(sol, L, 2 * L)[0])
        best['Msup1'] = min(best['Msup1'], _ref_MV(sol, L)[0])
        best['R1'] = max(best['R1'], sol['R'][1])
    r = analyze_loads('floor-joist', 'cont-4', L, {'D': 20, 'L': 100}, 'LRFD')
    locs = r['gravity']['locations']
    assert _rel(_loc(locs, 'Int span 2 +M')['Mu'], best['Mpos2']) < 5e-3
    s1 = _loc(locs, '1st interior')
    assert _rel(s1['Mu'], best['Msup1']) < 5e-3
    assert _rel(s1['Ru'], best['R1']) < 5e-3
    assert s1['pattern']['L'] == 'spans 1,2,4 loaded'   # 인접 경간 + 하나 건너 경간


def test_R7_26_fe_span_boundary_loads():
    """R7-26: FE 경간 경계 요소의 하중을 평균하지 않는다 — 3경간 1·3 재하, R 1.125/1.375, M+ 0.10125wL²."""
    r = analyze_beam_fe([L25] * 3, [W100, 0.0, W100], None, None, I10, 2.0, E)
    assert _rel(r.R[0], 0.45 * w_k * L25) < 1e-4
    assert _rel(r.R[1], 0.55 * w_k * L25) < 1e-4
    assert _rel(max(r.M), 0.10125 * w_k * L25 ** 2) < 2e-3


# ---------------------------------------------------------------------------
# R7-08 · R7-09 · R7-10 · R7-11 · R7-15 · R7-22 (해석 → 위치)
# ---------------------------------------------------------------------------

def test_R7_08_fe_reactions_signed():
    """R7-08: FE 반력 부호 유지 (상향 +) — 2경간 랩, w = −100 plf."""
    laps = [None, {'left_ft': 2.5, 'right_ft': 3.5}, None]
    r = analyze_beam_fe([L25] * 2, [-W100] * 2, None, laps, 7.76, 2.0, E)
    EI = E * 7.76 / 144
    sol = _ref_solve([L25] * 2, [-w_k] * 2, lambda x: 2 * EI if 22.5 <= x <= 28.5 else EI, breaks=(22.5, 28.5))
    for a, b in zip(r.R, sol['R']):
        assert b < 0 and _rel(a, b) < 1e-3
    # 랩 유무와 관계없이 같은 조합 분류 (ASD D=10, W=−150)
    a = analyze_loads('roof-purlin', 'cont-2', 25, {'D': 10, 'W': -150}, 'ASD',
                      laps_per_support=[None, {'left_ft': 2.5, 'right_ft': 3.5}, None])
    b = analyze_loads('roof-purlin', 'cont-2', 25, {'D': 10, 'W': -150}, 'ASD')
    ua = sorted(d['name'] for d in a['all_combos_detail'] if d['is_uplift'])
    ub = sorted(d['name'] for d in b['all_combos_detail'] if d['is_uplift'])
    assert ua == ub and '5: D+0.6W' in ua
    assert a['gravity']['combo'] == b['gravity']['combo'] == '1: D'
    assert all(u['R_uplift'] < 0 for u in a['uplift_reactions'])


def test_R7_09_free_end_support_mapping_II2A():
    """R7-09: II-2A 기하 (1/25×4/1 ft, 양끝 N, 랩 3곳, 부재별 I) — 지점 x=1…101 의 반력 (독립해, 1 %).

    매뉴얼 활하중 도표 R 1.05 / 2.93 / 2.24. 자유단에는 반력 위치가 없다.
    """
    spans = [1, 25, 25, 25, 25, 1]
    sup = ['N', 'P', 'P', 'P', 'P', 'P', 'N']
    I070, I059 = 9.18, 7.76
    lps = [None, None, {'left_ft': 2.5, 'right_ft': 3.5}, {'left_ft': 1, 'right_ft': 1},
           {'left_ft': 3.5, 'right_ft': 2.5}, None, None]
    xs = np.concatenate([[0], np.cumsum(spans)])

    def EIex(x):
        I_ = I070 if (x <= 26 or x >= 76) else I059
        for j, (lL, lR) in {2: (2.5, 3.5), 3: (1.0, 1.0), 4: (3.5, 2.5)}.items():
            if xs[j] - lL <= x <= xs[j] + lR:
                I_ = I070 + I059 if j in (2, 4) else 2 * I059
        return E * I_ / 144
    brk = [23.5, 29.5, 50, 52, 72.5, 78.5]
    sol = _ref_solve(spans, [0.1] * 6, EIex, sup, brk)
    r = analyze_beam_fe(spans, [100] * 6, sup, lps, I059, 2.0, E,
                        I_span_in4=[I070, I070, I059, I059, I070, I070])
    assert r.R[0] == 0.0 and r.R[-1] == 0.0
    for j in range(1, 6):
        assert _rel(r.R[j], sol['R'][j]) < 1e-2
    for j, man in ((1, 1.05), (2, 2.93), (3, 2.24)):
        assert abs(sol['R'][j] - man) < 0.01
    locs = extract_critical_locations(r, spans, {'_per_support': lps}, supports=sup)
    sup_locs = [loc for loc in locs if loc.get('support') and loc['name'].startswith(('End', '1st', 'Sup', 'Cen'))]
    assert sorted(loc['x_ft'] for loc in sup_locs) == [1, 26, 51, 76, 101]
    for loc in sup_locs:
        j = int(np.argmin(abs(xs - loc['x_ft'])))
        assert _rel(loc['Ru'], sol['R'][j]) < 1e-2
    assert not any(loc['x_ft'] in (0, 102) and loc.get('Ru') for loc in locs)
    assert not any(loc['x_ft'] < 0 or loc['x_ft'] > 102 for loc in locs)   # 가짜 랩 끝 없음


def test_R7_10_lap_left_right_convention():
    """R7-10: 랩 끝 = 지점 − left_ft, 지점 + right_ft — 2×25 ft, 랩 2.5/3.5: x 22.5 · 28.5 (독립해)."""
    laps = [None, {'left_ft': 2.5, 'right_ft': 3.5}, None]
    r = analyze_beam_fe([L25] * 2, [W100] * 2, None, laps, 7.76, 2.0, E)
    EI = E * 7.76 / 144
    sol = _ref_solve([L25] * 2, [w_k] * 2, lambda x: 2 * EI if 22.5 <= x <= 28.5 else EI, breaks=(22.5, 28.5))
    locs = extract_critical_locations(r, [L25] * 2, {'_per_support': laps})
    le = _loc(locs, 'Lap end (left of sup 2)')
    ri = _loc(locs, 'Lap end (right of sup 2)')
    assert le['x_ft'] == 22.5 and ri['x_ft'] == 28.5
    assert _rel(le['Mu'], _ref_MV(sol, 22.5)[0]) < 2e-3      # −5.234
    assert _rel(ri['Mu'], _ref_MV(sol, 28.5)[0]) < 2e-3      # −3.926
    # 비지지 길이: 변곡점 ~ 랩 끝 (데크 있음)
    xs = np.linspace(0, 50, 20001)
    Ms = np.array([_ref_MV(sol, x)[0] for x in xs])
    zc = [xs[i] for i in range(len(xs) - 1) if Ms[i] * Ms[i + 1] < 0]
    ub = determine_unbraced_lengths(r.M, r.x, [L25] * 2, None, laps, 'through-fastened')
    left = [g for g in ub['negative_regions'] if g['end_ft'] <= 25.0]
    right = [g for g in ub['negative_regions'] if g['start_ft'] >= 25.0]
    assert abs(left[0]['Ly_in'] - (22.5 - zc[0]) * 12) < 0.5      # 55.8 in
    assert abs(right[0]['Ly_in'] - (zc[1] - 28.5) * 12) < 0.5     # 43.8 in
    assert len(ub['lap_regions']) == 2


def test_R7_11_laps_dict_enters_stiffness():
    """R7-11: laps 사전만 줘도 랩 강성이 해석에 들어간다 — 지점 M 이 FE 랩 해와 같다."""
    r = analyze_loads('roof-purlin', 'cont-2', 25, {'D': 100}, 'ASD',
                      laps={'left_ft': 2.5, 'right_ft': 3.5})
    EI = 1.0
    sol = _ref_solve([L25] * 2, [w_k] * 2, lambda x: 2 * EI if 22.5 <= x <= 28.5 else EI, breaks=(22.5, 28.5))
    s1 = _loc(r['gravity']['locations'], '1st interior')
    assert _rel(s1['Mu'], _ref_MV(sol, 25)[0]) < 2e-3          # −8.94 (등단면 −7.81)
    assert _rel(_loc(r['gravity']['locations'], 'Lap end (left of sup 2)')['Mu'], _ref_MV(sol, 22.5)[0]) < 2e-3
    assert r['analysis_method'].startswith('direct stiffness')


def test_R7_15_support_shear_both_sides():
    """R7-15: 지점 전단 = 양쪽 중 큰 값 — 2×25: 1.5625, 20/30/20 지점 1: 1.500 (독립해)."""
    r = analyze_continuous_beam_general([L25] * 2, [W100] * 2)
    # 위치 값은 소수 셋째 자리로 반올림된다 → 허용 1e-3
    assert _rel(_loc(extract_critical_locations(r, [L25] * 2), '1st interior')['Vu'], 1.25 * w_k * L25 / 2) < 1e-3
    spans = [20, 30, 20]
    sol = _ref_solve(spans, [w_k] * 3, lambda x: 2000.0)
    VL, VR = _ref_MV(sol, 20, 'left')[1], _ref_MV(sol, 20, 'right')[1]
    for res in (analyze_continuous_beam_general(spans, [W100] * 3),
                analyze_beam_fe(spans, [W100] * 3, None, None, 10.0, 2.0, E)):
        loc = _loc(extract_critical_locations(res, spans), '1st interior')
        assert _rel(loc['Vu'], max(abs(VL), abs(VR))) < 1e-3
        assert _rel(loc['Vu_left'], abs(VL)) < 1e-3 and _rel(loc['Vu_right'], abs(VR)) < 1e-3
    r = analyze_loads('roof-purlin', 'cont-3', 20, {'D': 100}, 'ASD', spans_ft=spans)
    assert _rel(_loc(r['gravity']['locations'], '1st interior')['Vu'], abs(VR)) < 1e-3


def test_R7_22_failures_raise():
    """R7-22: 불안정·특이 입력은 오류 (0 모멘트로 통과하지 않는다)."""
    with pytest.raises(ValueError):
        analyze_beam_fe([25, 25], [100, 100], ['N', 'N', 'N'])
    with pytest.raises(ValueError):
        analyze_continuous_beam_general([25, 25], [100, 100], supports=['N', 'P', 'N'])
    with pytest.raises(ValueError):
        analyze_loads('roof-purlin', 'cont-2', 25, {'D': 100}, 'LRFD', supports=['N', 'N', 'N'])
    with pytest.raises(ValueError):
        analyze_loads('roof-purlin', 'simple', 25, {'D': 100}, 'LRFD', supports=['P', 'N'])
    with pytest.raises(ValueError):
        calc_Fcrd({'xof': 0, 'hxf': 0, 'Ixf': 0, 'Cwf': 0, 'Ixyf': 0, 'Iyf': 0, 'Jf': 0, 'Af': 0, 'yof': 0},
                  8.0, 0.06, xi_web=0)


# ---------------------------------------------------------------------------
# R7-14 · R7-16 입력
# ---------------------------------------------------------------------------

def test_R7_14_span_type_and_geometry_inputs():
    """R7-14: cantilever → F-N, cont-n → spans_ft 개수, 개수 불일치 → 오류."""
    r = analyze_loads('roof-purlin', 'cantilever', 8, {'D': 100}, 'ASD')
    assert r['supports'] == ['F', 'N']
    assert _rel(min(r['gravity']['M_envelope_min']), -0.1 * 64 / 2) < 1e-6
    r = analyze_loads('roof-purlin', 'cont-n', 25, {'D': 100}, 'LRFD', spans_ft=[25] * 5)
    assert r['n_spans'] == 5 and r['spans_ft'] == [25.0] * 5
    with pytest.raises(ValueError):
        analyze_loads('roof-purlin', 'cont-2', 25, {'D': 100}, 'LRFD', spans_ft=[30, 30, 30])
    with pytest.raises(ValueError):
        analyze_loads('roof-purlin', 'cont-n', 25, {'D': 100}, 'LRFD')
    with pytest.raises(ValueError):
        analyze_loads('roof-purlin', 'cont-2', 25, {'D': 100}, 'LRFD', supports=['P', 'P'])
    with pytest.raises(ValueError):
        analyze_loads('roof-purlin', 'cantilever', 8, {'D': 100}, 'LRFD', supports=['P', 'P'])
    with pytest.raises(ValueError):
        analyze_loads('roof-purlin', 'triple', 25, {'D': 100}, 'LRFD')
    with pytest.raises(ValueError):
        analyze_loads('bridge', 'simple', 25, {'D': 100}, 'LRFD')


def test_R7_16_wall_girt_dead_load_out_of_plane():
    """R7-16: 거트의 D 는 강축에 더하지 않는다 — D 20, W −100 ASD: 흡인 w = 0.6W = −60 plf, M = wL²/8."""
    r = analyze_loads('wall-girt', 'simple', 20, {'D': 20, 'W': -100}, 'ASD')
    assert _rel(min(r['uplift']['M_envelope_min']), -0.060 * 400 / 8) < 1e-6
    assert any('wall-girt' in w for w in r['warnings'])
    assert r['strong_axis_loads_plf'] == {'W': -100.0}


# ---------------------------------------------------------------------------
# R7-02 · R7-12 · R7-13 · R7-03 영역과 비지지 길이
# ---------------------------------------------------------------------------

def test_R7_02_uplift_unbraced_region_midspan():
    """R7-02: 양력의 하부 플랜지 압축 = M < 0 인 경간 구간 — 2경간 25 ft, D 10, W −150 LRFD:
    0 – 18.75 ft (0.75L), Ly 225 in, |Mu| = 0.141·(9/128)·625 (= 6.195)."""
    r = analyze_loads('roof-purlin', 'cont-2', 25, {'D': 10, 'W': -150}, 'LRFD',
                      deck={'type': 'through-fastened'},
                      section={'depth': 14, 'flange_width': 3.5, 'thickness': 0.1, 'lip_depth': 1,
                               'type': 'Z', 'Fy': 55, 'Fu': 70})
    ub = r['auto_params']['uplift_bracing']
    reg = min(ub['negative_regions'], key=lambda g: g['start_ft'])
    assert abs(reg['start_ft']) < 1e-9 and abs(reg['end_ft'] - 18.75) < 0.01
    assert abs(ub['negative_region']['Ly_in'] - 225.0) < 0.2
    assert _rel(reg['M_max_abs'], 0.141 * 9 / 128 * 625) < 2e-3
    assert r['auto_params']['uplift_R'] is None          # d = 14 in > 12 in
    assert ub['positive_region']['braced'] is True        # 지점부 상부 압축 = 데크 지지
    # 중력 부모멘트 영역은 변곡점 ~ 지점 (0.75L ~ L): 75 in, Cb 1.79 (F2.1.1-2)
    gov = r['auto_params']['negative_region_gov']
    assert abs(gov['Ly_in'] - 75.0) < 0.2


def test_R7_12_overhang_region_and_cb():
    """R7-12: 경간 20 + 내민 5 ft — 내민 구간 (20 → 25 ft, Ly 60 in, Cb 1.0, F2.1.1)."""
    r = analyze_loads('roof-purlin', 'cont-2', 20, {'D': 100}, 'ASD', spans_ft=[20, 5],
                      supports=['P', 'P', 'N'], deck={'type': 'through-fastened'})
    regs = r['auto_params']['negative_regions']
    ov = [g for g in regs if abs(g['start_ft'] - 20) < 1e-6 and abs(g['end_ft'] - 25) < 1e-6]
    assert ov and abs(ov[0]['Ly_in'] - 60) < 0.1 and ov[0]['Cb'] == 1.0 and ov[0]['cantilever']
    # 내민의 하부 압축 모멘트는 지점 모멘트 wa²/2 = 1.25 (V3-17: 경간 정모멘트가 섞이지 않는다)
    assert abs(ov[0]['M_max_abs'] - 0.1 * 25 / 2) < 1e-3
    # 지배 영역 (V3-16: M·Ly²/Cb 최대 — 내민 1.25·60²/1.0 > 변곡점~지점 1.25·15²/Cb) 의 값 그대로
    gov = r['auto_params']['negative_region_gov']
    assert abs(gov['Ly_in'] - 60) < 0.1 and gov['Cb'] == 1.0
    # 지점을 넘는 영역은 없다
    for g in regs:
        assert not (g['start_ft'] < 20 - 1e-6 < 20 + 1e-6 < g['end_ft'])
    # 고정단도 브레이스 지점 — 양단고정: 지점 ~ 변곡점 (1/2 − 1/√12) L = 0.2113 L
    r = analyze_loads('roof-purlin', 'simple', 25, {'D': 100}, 'ASD', supports=['F', 'F'],
                      deck={'type': 'through-fastened'})
    regs = sorted(r['auto_params']['negative_regions'], key=lambda g: g['start_ft'])
    a = (0.5 - 1 / math.sqrt(12)) * 25 * 12
    assert len(regs) == 2 and all(abs(g['Ly_in'] - a) < 0.5 for g in regs)


def test_R7_13_no_deck_regions_brace_to_brace():
    """R7-13: 데크 없음 — 영역마다 Ly·Cb, 브레이스(지점) 사이 길이. 18/32/18: 내부 384 in.
    대표값은 지배 영역(M·Ly²/Cb 최대)의 값 그대로 (이전: 첫 영역 118.5 in).
    Cb 는 독립해 |M| 로 F2.1.1-2 를 따로 계산, M_max_abs 는 상부 압축(M > 0)만 (V3-17)."""
    r = analyze_loads('roof-purlin', 'cont-3', 25, {'D': 50}, 'LRFD', spans_ft=[18, 32, 18],
                      deck={'type': 'none'})
    pos = r['auto_params']['unbraced']['positive_regions']
    interior = [g for g in pos if abs(g['start_ft'] - 18) < 1e-6]
    assert interior and abs(interior[0]['Ly_in'] - 384) < 0.1
    sol = _ref_solve([18, 32, 18], [1.4 * 0.05] * 3, lambda x: 2000.0)   # 1.4D 지배
    absM = lambda x: abs(_ref_MV(sol, x)[0])   # noqa: E731
    xs = np.linspace(18, 50, 3201)
    mmax = max(absM(x) for x in xs)
    cb = 12.5 * mmax / (2.5 * mmax + 3 * absM(26) + 4 * absM(34) + 3 * absM(42))
    assert abs(interior[0]['Cb'] - round(cb, 2)) < 0.011
    mpos = max(_ref_MV(sol, x)[0] for x in xs)
    assert abs(interior[0]['M_max_abs'] - mpos) / mpos < 2e-3        # 지점 부모멘트가 아님
    pr = r['auto_params']['positive_region']
    assert pr['Ly_in'] == 384 and pr['Cb'] == interior[0]['Cb']
    # 이산 브레이스가 있으면 그것으로 나눈다
    r = analyze_loads('roof-purlin', 'cont-3', 25, {'D': 50}, 'LRFD', spans_ft=[18, 32, 18],
                      deck={'type': 'none'}, brace_points_ft=[34.0])
    # 지배 영역 = M·Ly²/Cb 최대 → 브레이스로 나뉜 안경간 조각 (16 ft) — 외측 18 ft 는 M 이 작다
    assert r['auto_params']['positive_region']['Ly_in'] == 192


def test_R7_03_standing_seam_not_continuous_bracing():
    """R7-03: 스탠딩심 — 연속 횡지지 아님, kφ 자동 근사 없음, 시험 R 없으면 R None + 경고."""
    sec = {'depth': 8, 'flange_width': 2.5, 'thickness': 0.07, 'lip_depth': 0.9, 'type': 'Z',
           'Fy': 55, 'Fu': 70, 'R_corner': 0.1875}
    r = analyze_loads('roof-purlin', 'cont-2', 25, {'D': 10, 'Lr': 100, 'W': -150}, 'LRFD',
                      deck={'type': 'standing-seam'}, section=sec,
                      laps={'left_ft': 1.5, 'right_ft': 1.5})
    ap = r['auto_params']
    assert ap['positive_region']['braced'] is False and ap['positive_region']['Ly_in'] == 300  # 지점 간
    assert ap['uplift_R'] is None and ap['deck']['kphi'] == 0
    assert any('S908' in w for w in r['warnings'])
    r = analyze_loads('roof-purlin', 'cont-2', 25, {'D': 10, 'W': -150}, 'LRFD',
                      deck={'type': 'standing-seam', 'R_tested_uplift': 0.55}, section=sec)
    assert r['auto_params']['uplift_R'] == 0.55


# ---------------------------------------------------------------------------
# R7-04 · R7-05 I6.2.1
# ---------------------------------------------------------------------------

_Z8 = {'depth': 8.0, 'flange_width': 2.25, 'thickness': 0.070, 'lip_depth': 0.91,
       'R_corner': 0.1875, 'type': 'Z', 'Fy': 55, 'Fu': 70}


def test_R7_04_uplift_R_only_when_I621_applies():
    """R7-04: 단면 없음 → None (0.60 기본값 없음), 데크 없음 → None, 확인 플래그 + 적합 → 표값 0.70."""
    loads = {'D': 10, 'W': -150}
    lap = {'left_ft': 1.5, 'right_ft': 1.5}
    r = analyze_loads('roof-purlin', 'cont-2', 25, loads, 'LRFD', deck={'type': 'through-fastened'}, laps=lap)
    assert r['auto_params']['uplift_R'] is None
    r = analyze_loads('roof-purlin', 'cont-2', 25, loads, 'LRFD', deck={'type': 'none'}, section=_Z8, laps=lap)
    assert r['auto_params']['uplift_R'] is None
    deck = {'type': 'through-fastened', 't_panel': 0.0179, 'fastener_spacing': 12}
    r = analyze_loads('roof-purlin', 'cont-2', 25, loads, 'LRFD', deck=deck, section=_Z8, laps=lap)
    assert r['auto_params']['uplift_R'] is None            # (i)-(n) 미확인
    assert any('not verified' in w for w in r['warnings'])
    r = analyze_loads('roof-purlin', 'cont-2', 25, loads, 'LRFD', deck=deck, section=_Z8, laps=lap,
                      i621_conditions_confirmed=True)
    assert r['auto_params']['uplift_R'] == 0.70


def test_R7_05_I621_condition_details():
    """R7-05: (g) 최솟값, 20 % 경간 차 → 단순보 값, 단열재 r, 캔틸레버 배제, 형식 문자열, 랩 미입력."""
    def chk(**kw):
        base = dict(section=_Z8, Fy=55, Fu=70, span_ft=25, system_confirmed=True)
        base.update(kw)
        return check_i621_conditions(**base)
    # (g): 랩 0.5 / 1.5 ft, 1.5d = 12 in → 최솟값 6 in 로 불합격
    assert chk(lap_lengths_in=[6.0, 18.0], spans_ft=[25, 25])['R'] is None
    assert chk(lap_lengths_in=[12.0, 18.0], spans_ft=[25, 25])['R'] == 0.70
    # 연속 + 랩 미입력 → 미확인
    assert chk(spans_ft=[25, 25])['R'] is None
    # 30/20/30 → 인접 경간 차 50 % → 단순보 값 (d = 8: 0.65)
    assert chk(lap_lengths_in=[18.0] * 4, spans_ft=[30, 20, 30])['R'] == 0.65
    # 단순보 단열재 6 in → r = 0.94 (Eq. I6.2.1-2): 0.65 × 0.94
    s = chk(spans_ft=[25], insulation_in=6.0)
    assert abs(s['R'] - 0.65 * (1 - 0.01 * 6)) < 1e-9
    # 캔틸레버(내민) 경간 → R 없음
    # 내민(캔틸레버) 구간만 빠진다 — 보 전체의 R 은 남는다 (V3-13, I6.2.1 첫 문장)
    c = chk(lap_lengths_in=[18.0] * 2, spans_ft=[25, 25, 2], supports=['P', 'P', 'P', 'N'])
    assert c['R'] == 0.70 and c['R_per_span'] == [0.70, 0.70, None]
    # 캔틸레버 보 (실제 경간 없음) → R 없음
    assert chk(spans_ft=[8], supports=['F', 'N'])['R'] is None
    # 'lippedc' 은 C (깊은 단면 단순보 0.40), 'lippedz' 는 Z
    deep = dict(_Z8, depth=10.0, flange_width=3.0, thickness=0.08)
    assert chk(section=dict(deep, type='lippedc'), spans_ft=[25], insulation_in=0)['R'] == 0.40
    assert chk(section=dict(deep, type='lippedz'), spans_ft=[25], insulation_in=0)['R'] == 0.50
    # 확인 없음 → R None, R_if_confirmed 는 표값
    u = check_i621_conditions(section=_Z8, Fy=55, Fu=70, span_ft=25, span_type='continuous',
                              lap_length_in=18.0)
    assert u['R'] is None and u['R_if_confirmed'] == 0.70 and not u['all_pass']


# ---------------------------------------------------------------------------
# R7-06 · R7-21 데크 강성
# ---------------------------------------------------------------------------

def test_R7_06_kphi_gao_moen_example_II_1C():
    """R7-06: Example II-1C 3b — kφ = 0.113 (b = c = 1.25, k = 1.934c^-0.4/12, I = 0.059³/12) ±1 %."""
    b = c = 1.25
    k = 1.934 * c ** -0.4 / 12
    I_ = 0.059 ** 3 / 12
    hand = 1 / (1 / (k * c * c) + (b * b * c / 2 + b * c * c + c ** 3 / 3) / (E * I_ * c * c))
    got = calc_rotational_stiffness(0.0179, 0.059, 12, 2.5)
    assert abs(got - hand) / hand < 1e-9 and abs(got - 0.113) / 0.113 < 0.01


def test_R7_21_kx_rp17_2_psi():
    """R7-21: RP17-2 Ke = 0.27ψ^-0.69 Ka — (0.015, 0.059, Fss 1.8, D 0.19, Fu 70) → 0.981; 예제점 1.28 (II-1C)."""
    def hand(t1, t2):
        Ka = 1 / (1 / (E * t1) + 1 / (E * t2))
        psi = (1.8 / (t1 * 0.19 * 70)) * (1.8 / (t2 * 0.19 * 70))
        return 0.27 * psi ** -0.69 * Ka / 12
    for t1, t2 in ((0.015, 0.059), (0.024, 0.070), (0.0179, 0.105)):
        assert abs(calc_lateral_stiffness(t1, t2, 12, Fss_kip=1.8, D_screw_in=0.19, Fu1_ksi=70, Fu2_ksi=70)
                   - hand(t1, t2)) < 1e-9
    assert abs(hand(0.015, 0.059) - 0.981) < 0.001
    assert abs(calc_lateral_stiffness(0.0179, 0.059, 12) - 1.28) / 1.28 < 0.015


# ---------------------------------------------------------------------------
# R7-19 처짐
# ---------------------------------------------------------------------------

def test_R7_19_deflection_cases():
    """R7-19: 하중별 단독 처짐 — 단순보 Lr 단독 δ = 5wL⁴/384EI, 조합명 표기, 캔틸레버 2L."""
    sec = {'Ixx': 10.0, 'depth': 8, 'thickness': 0.06}
    r = analyze_loads('roof-purlin', 'simple', 25, {'D': 10, 'Lr': 100}, 'LRFD', section=sec)
    lr = [c for c in r['deflection_cases'] if c['case'] == 'Lr'][0]
    assert _rel(lr['per_span'][0]['abs_delta_in'], 5 * 0.1 * 25 ** 4 / (384 * E * 10 / 144) * 12) < 1e-3
    assert r['deflection']['combo'] == 'D+Lr'
    # 합계는 비계수 D + Lr (계수를 곱하면 잡힌다): 5(wD + wLr)L⁴/384EI
    tot = 5 * 0.110 * 25 ** 4 / (384 * E * 10 / 144) * 12
    assert _rel(r['deflection']['per_span'][0]['abs_delta_in'], tot) < 1e-3
    assert _rel(max(r['deflection']['D_diagram']), tot) < 1e-3
    c = analyze_loads('roof-purlin', 'cantilever', 8, {'D': 100}, 'ASD', section=sec)
    ps = c['deflection']['per_span'][0]
    d_tip = 0.1 * 8 ** 4 / (8 * E * 10 / 144) * 12
    assert _rel(ps['abs_delta_in'], d_tip) < 1e-3
    assert abs(ps['L_over_delta'] - round(2 * 8 * 12 / d_tip)) <= 1 and ps['L_ratio_basis'].startswith('2L')


# ---------------------------------------------------------------------------
# R7-24 · R7-27 · R7-28 · R7-17 해석식
# ---------------------------------------------------------------------------

def test_R7_24_local_flexure_fallback():
    """R7-24: 휨 국부 판식 — 웹 k = 4 + 2(1−ψ)³ + 2(1−ψ) = 24 (ψ = −1), 최외연 외삽. II-5: 34 ≤ Fcrl ≤ 42.8 (FSM)."""
    t, R = 0.0566, 0.0849
    w = 8.0 - 2 * (R + t)
    k = 4 + 2 * 2 ** 3 + 2 * 2
    hand = k * math.pi ** 2 * E / (12 * (1 - 0.09)) * (t / w) ** 2 * 8.0 / w
    res = calc_Fcrl(8.0, 2.0, 0.625, t, R=R, flexure=True)
    assert res['governing'] == 'web' and abs(res['Fcrl'] - hand) < 1e-9
    assert 34.0 <= res['Fcrl'] <= 42.8
    assert calc_Fcrl(8.0, 2.0, 0.625, t, R=R)['elements']['web']['k'] == 4.0   # 압축은 그대로


def test_R7_27_inclined_lip_formula_for_C():
    """R7-27: 표 2.3.1.3-1 은 립 방향 열 — 경사립 C 는 경사립 식, θ = 90 에서 두 열이 같다."""
    b, d, t = 2.44, 0.88, 0.06
    c90 = calc_flange_properties(b, d, t, 90, 'C')
    z90 = calc_flange_properties(b, d, t, 90, 'Z')
    for key in ('Ixf', 'Iyf', 'Ixyf', 'xof', 'hxf', 'yof'):
        assert abs(c90[key] - z90[key]) < 1e-12
    th = math.radians(60)
    bd = b + d
    Ixf = t * (t ** 2 * b ** 2 + 4 * b * d ** 3 - 4 * b * d ** 3 * math.cos(th) ** 2
               + t ** 2 * b * d + d ** 4 - d ** 4 * math.cos(th) ** 2) / (12 * bd)
    assert abs(calc_flange_properties(b, d, t, 60, 'C')['Ixf'] - Ixf) < 1e-12


def test_R7_28_beta_diagram_sign_option():
    """R7-28: 다이어그램 부호(같은 부호 = 단곡률 → 음의 비)."""
    # 같은 부호 끝모멘트 (단곡률): 규약 비 −0.5 → β = 1 + 0.4(L/Lm)^0.7 (0.5)^0.7
    b = calc_beta_distortional(20.0, 40.0, -2.0, -4.0, diagram_signs=True)
    assert abs(b - (1 + 0.4 * 0.5 ** 0.7 * 0.5 ** 0.7)) < 1e-9
    assert calc_beta_distortional(20.0, 40.0, -2.0, -4.0) > b      # 규약 부호로 읽으면 역곡률(+0.5)


def test_R7_17_fcrd_contract_and_z_note():
    """R7-17 (계약): II-5 외-외 ho, 중심선 b·d → Fcrd 46.5 ksi, Lcrd 19.4 in (매뉴얼). Z 압축에는 FSM 우선 메모."""
    t = 0.0566
    fp = calc_flange_properties(2.0 - t, 0.625 - t / 2, t, 90, 'C')
    res = calc_Fcrd(fp, 8.0, t, xi_web=2)
    assert abs(res['Fcrd'] - 46.5) / 46.5 < 0.02 and abs(res['Lcrd'] - 19.4) < 0.15
    fz = calc_flange_properties(2.25 - 0.059, 0.91 - 0.0295, 0.059, 50, 'Z')
    assert calc_Fcrd(fz, 8.0, 0.059, xi_web=0)['notes']


# ---------------------------------------------------------------------------
# 출력 계약 · 판정
# ---------------------------------------------------------------------------

def test_R7_outputs_not_evaluated_and_legacy_keys():
    """I6.4.1 은 검토하지 않았음을 밝히고, 이전 키는 그대로 있다."""
    r = analyze_loads('roof-purlin', 'cont-4', 25, {'D': 15, 'Lr': 100}, 'ASD',
                      laps={'left_ft': 1.0, 'right_ft': 2.5},
                      deck={'type': 'through-fastened', 't_panel': 0.018, 'fastener_spacing': 12},
                      section=_Z8)
    assert any('I6.4.1' in s for s in r['not_evaluated'])
    for key in ('governing', 'gravity', 'uplift', 'deflection', 'auto_params', 'wc_reactions',
                'all_combos', 'all_combos_detail', 'input_loads_plf', 'supports', 'spans_ft',
                'laps_per_support'):
        assert key in r
    ap = r['auto_params']
    for key in ('positive_region', 'negative_regions', 'negative_region_gov', 'negative_region',
                'uplift_R', 'deck', 'unbraced'):
        assert key in ap
    g = r['gravity']
    for key in ('combo', 'locations', 'M_diagram', 'V_diagram', 'x_diagram'):
        assert key in g
    assert len(g['M_diagram']) == len(g['x_diagram'])
    assert any(w['case'] == 'EOF' for w in r['wc_reactions'])
    assert all(w['Pu'] > 0 for w in r['wc_reactions'])


# ---------------------------------------------------------------------------
# V3 검증 뒤 (V3-12 … V3-24) — AISI 설계매뉴얼 Example II-2A 인수 시험
# ---------------------------------------------------------------------------

_II2A_LAPS = [None, None, {'left_ft': 2.5, 'right_ft': 3.5}, {'left_ft': 1.0, 'right_ft': 1.0},
              {'left_ft': 3.5, 'right_ft': 2.5}, None, None]
_II2A_SEC = dict(depth=8.0, flange_width=2.25, thickness=0.059, lip_depth=0.91, R_corner=0.1875,
                 type='Z', Fy=55.0, Fu=70.0, Ixx=7.76)


def _ii2a(**kw):
    """II-2A: 1/25×4/1 ft, N-P-P-P-P-P-N, 랩 (2.5/3.5), (1/1), (3.5/2.5), D 15 · Lr 100 · W −170 plf, ASD.
    화면이 보내는 꼴(끝 지점에도 0 랩 사전)과 기본 설정 그대로. 부재: 끝 0.070 (Ix 9.18), 안 0.059 (7.76)."""
    args = dict(spans_ft=[1, 25, 25, 25, 25, 1], supports=['N', 'P', 'P', 'P', 'P', 'P', 'N'],
                laps_per_support=[lp or {'left_ft': 0, 'right_ft': 0} for lp in _II2A_LAPS],
                deck={'type': 'through-fastened', 't_panel': 0.019, 'fastener_spacing': 12.0,
                      'kphi_override': 0.300, 'i621_conditions_confirmed': True},
                section=_II2A_SEC, I_span_in4=[9.18, 9.18, 7.76, 7.76, 9.18, 9.18])
    args.update(kw)
    return analyze_loads('roof-purlin', 'cont-6', 25.0, {'D': 15, 'Lr': 100, 'W': -170}, 'ASD', **args)


def test_V3_II2A_manual_gravity_values():
    """II-2A §3 (D+Lr): 매뉴얼 인쇄값 — M 5.11 / 4.65 / 8.75 / 3.89 / 2.23 / 3.73 / 4.95 kip-ft,
    V 1.09 / 1.50 / 1.78 · 1.59 / 1.18 / 1.17 / 1.29, R 1.21 / 3.37 / 2.58 kips,
    변곡점 6.10 / 7.59 / 4.94 ft, Ly 43.2 / 49.1 / 47.3 in, Cb ≥ 1.67 (매뉴얼은 선형 가정 1.67).
    허용: 인쇄값은 두 자리로 반올림한 D·Lr 성분의 합 → ±0.015."""
    r = _ii2a()
    assert r['gravity']['combo'] == '3: D+Lr'
    assert r['pattern_loading']['patterned_loads'] == []          # Lr 은 감소되지 않음 (V3-15)
    locs = r['gravity']['locations']
    M = {loc['x_ft']: loc['Mu'] for loc in locs if loc['name'].startswith(('Lap', 'End support', '1st', 'Center'))}
    end_pos = max(loc['Mu'] for loc in locs if loc['name'] == 'End span +M')
    int_pos = max(loc['Mu'] for loc in locs if loc['name'].startswith('Int span') and loc['Mu'] > 0)
    for got, man in ((end_pos, 5.11), (-M[23.5], 4.65), (-M[26.0], 8.75), (-M[29.5], 3.89),
                     (int_pos, 2.23), (-M[50.0], 3.73), (-M[51.0], 4.95)):
        assert abs(got - man) <= 0.015, (got, man)
    left = _loc(locs, 'End support (left)')
    s1 = _loc(locs, '1st interior')
    cen = _loc(locs, 'Center')
    V = {loc['x_ft']: loc['Vu'] for loc in locs if loc['name'].startswith('Lap')}
    for got, man in ((left['Vu_right'], 1.09), (V[23.5], 1.50), (s1['Vu_left'], 1.78),
                     (s1['Vu_right'], 1.59), (V[29.5], 1.18), (V[50.0], 1.17), (cen['Vu'], 1.29)):
        assert abs(got - man) <= 0.015, (got, man)
    for got, man in ((left['Ru'], 1.21), (s1['Ru'], 3.37), (cen['Ru'], 2.58)):
        assert abs(got - man) <= 0.015, (got, man)
    assert left['wc_case'] == 'EOF' and s1['wc_case'] == 'IOF'
    nregs = r['auto_params']['negative_regions']

    def at_lap_end(xe):
        return [g for g in nregs if abs(g['start_ft'] - xe) < 1e-6 or abs(g['end_ft'] - xe) < 1e-6][0]
    regs = {xe: at_lap_end(xe) for xe in (23.5, 29.5, 50.0)}
    for key, infl, ly in ((23.5, 26 - 6.10, 43.2), (29.5, 26 + 7.59, 49.1), (50.0, 51 - 4.94, 47.3)):
        g = regs[key]
        x_infl = g['start_ft'] if key in (23.5, 50.0) else g['end_ft']
        assert abs(x_infl - infl) < 0.01 and abs(g['Ly_in'] - ly) < 0.6 and g['Cb'] >= 1.67
    # 지배 대표값 = 그 영역 자신의 값 (V3-16): 안경간 왼쪽 랩 끝 영역 (매뉴얼의 가장 빠듯한 검토)
    gov = r['auto_params']['negative_region_gov']
    assert abs(gov['Ly_in'] - 49.1) < 0.6 and gov['Cb'] == regs[29.5]['Cb']


def test_V3_II2A_manual_gravity_Cb_independent():
    """끝경간 랩 끝 ~ 변곡점 영역의 Cb 를 독립 강성법 다이어그램(부재별 I)으로 F2.1.1-2 계산."""
    spans = [1, 25, 25, 25, 25, 1]
    xs = np.concatenate([[0], np.cumsum(spans)])

    def EIex(x):
        I_ = 9.18 if (x <= 26 or x >= 76) else 7.76
        for j, (lL, lR) in {2: (2.5, 3.5), 3: (1.0, 1.0), 4: (3.5, 2.5)}.items():
            if xs[j] - lL <= x <= xs[j] + lR:
                I_ = 9.18 + 7.76 if j in (2, 4) else 2 * 7.76
        return E * I_ / 144
    sol = _ref_solve(spans, [0.115] * 6, EIex, ['N', 'P', 'P', 'P', 'P', 'P', 'N'],
                     [23.5, 29.5, 50, 52, 72.5, 78.5])
    g = [g for g in _ii2a()['auto_params']['negative_regions'] if abs(g['end_ft'] - 23.5) < 1e-6][0]
    a, b = g['start_ft'], g['end_ft']
    absM = lambda x: abs(_ref_MV(sol, x)[0])   # noqa: E731
    mmax = max(absM(x) for x in np.linspace(a, b, 801))
    q = (b - a) / 4
    cb = 12.5 * mmax / (2.5 * mmax + 3 * absM(a + q) + 4 * absM(a + 2 * q) + 3 * absM(a + 3 * q))
    assert abs(g['Cb'] - cb) < 0.011


def test_V3_II2A_manual_uplift_R():
    """II-2A §4a: 0.6D+0.6W 끝 −4.13, 안 −1.81 kip-ft, R = 0.70 (1 ft 내민이 있어도),
    양력 하부압축 영역은 모두 I6.2.1 적용 영역 (지점 ~ 변곡점, 끝 ≈ 226 in). 인발 라벨 0.6D+0.6W.

    V3-12 (끝 지점 랩 0 으로 (g) 불합격), V3-13 (내민 하나로 R 전체 소실), V3-14 (순하향인
    D+0.75(0.6W)+0.75Lr 을 양력으로 분류), V3-19 (인발 라벨) 중 하나만 되돌려도 실패한다."""
    r = _ii2a()
    ap = r['auto_params']
    assert ap['uplift_R'] == 0.70
    u = r['uplift']
    assert u['combo'] == '7: 0.6D+0.6W'
    assert '6a: D+0.75(0.6W)+0.75Lr' not in u['combos']
    end_neg = min(loc['Mu'] for loc in u['locations'] if loc['name'] == 'End span -M')
    int_neg = min(loc['Mu'] for loc in u['locations'] if loc['name'].startswith('Int span') and loc['Mu'] < 0)
    assert abs(end_neg + 4.13) <= 0.015 and abs(int_neg + 1.81) <= 0.015
    regs = ap['uplift_bracing']['negative_regions']
    assert len(regs) == 4 and all(g['i621_region_eligible'] for g in regs)
    first = min(regs, key=lambda g: g['start_ft'])
    assert abs(first['end_ft'] - (26 - 6.10)) < 0.01 and abs(first['start_ft'] - 1.0) < 0.1
    assert abs(first['Ly_in'] - (26 - 6.10 - 1.0) * 12) < 1.5
    for rec in r['uplift_reactions']:
        assert rec['combo'] == '7: 0.6D+0.6W'
    s1 = [rec for rec in r['uplift_reactions'] if rec['x_ft'] == 26.0][0]
    assert abs(s1['R_uplift'] - (0.6 * 0.44 - 0.6 * 5.00)) <= 0.015     # 매뉴얼 도표 0.44, −5.00


def test_V3_15_Lr_partial_loading_switch():
    """V3-15: Lr 은 감소(20 psf 미만)됐을 때만 부분재하 (ASCE 7-22 Sec. 4.3.3.1). 3경간 1.2D+1.6Lr."""
    L = 25.0
    r0 = analyze_loads('roof-purlin', 'cont-3', L, {'D': 15, 'Lr': 100}, 'LRFD')
    sol = _ref_solve([L] * 3, [1.2 * 0.015 + 1.6 * 0.1] * 3, lambda x: 2000.0)
    assert _rel(_loc(r0['gravity']['locations'], 'Int span 2 +M')['Mu'], _ref_extrema(sol, L, 2 * L)[0]) < 5e-3
    assert 'Lr' in r0['pattern_loading']['why'] and r0['pattern_loading']['patterned_loads'] == []
    r1 = analyze_loads('roof-purlin', 'cont-3', L, {'D': 15, 'Lr': 100}, 'LRFD', lr_reduced=True)
    best = -1e9
    for mask in range(8):
        f = [(mask >> i) & 1 for i in range(3)]
        s = _ref_solve([L] * 3, [1.2 * 0.015 + 1.6 * 0.1 * k for k in f], lambda x: 2000.0)
        best = max(best, _ref_extrema(s, L, 2 * L)[0])
    assert _rel(_loc(r1['gravity']['locations'], 'Int span 2 +M')['Mu'], best) < 5e-3
    assert r1['pattern_loading']['patterned_loads'] == ['Lr']
    # 바닥 활하중 L 과 적설 S 는 기본으로 부분재하 그대로
    r2 = analyze_loads('floor-joist', 'cont-3', L, {'D': 15, 'L': 100, 'S': 20}, 'LRFD')
    assert r2['pattern_loading']['patterned_loads'] == ['L', 'S']


def test_V3_14_uplift_class_by_net_load():
    """V3-14: 양력 묶음 = 순하중이 위로 향하는 조합만. 단순보 D 10, Lr 100, W −150 ASD:
    D+0.75(0.6W)+0.75Lr 의 순하중은 +17.5 plf (하향) → 중력. 양력 포락에는 정모멘트가 없다."""
    r = analyze_loads('roof-purlin', 'simple', 25, {'D': 10, 'Lr': 100, 'W': -150}, 'ASD')
    cls = {d['name']: d['is_uplift'] for d in r['all_combos_detail']}
    assert cls['6a: D+0.75(0.6W)+0.75Lr'] is False
    assert cls['6a: D+0.75(0.6W)'] is True and cls['7: 0.6D+0.6W'] is True and cls['5: D+0.6W'] is True
    assert max(r['uplift']['M_envelope_max']) <= 1e-9
    assert abs(min(r['uplift']['M_envelope_min']) - (0.6 * 0.010 - 0.6 * 0.150) * 625 / 8) < 1e-6


def test_V3_16_17_governing_region_own_values():
    """V3-16: 대표값은 한 영역의 (Ly, Cb, M) 그대로 — 다른 영역의 Cb 와 섞지 않는다.
    V3-17: 데크 없음 영역의 M_max_abs 는 그 플랜지를 압축하는 부호만."""
    r = analyze_loads('roof-purlin', 'cont-2', 20, {'D': 100}, 'ASD', spans_ft=[20, 5],
                      supports=['P', 'P', 'N'], deck={'type': 'none'})
    for g in r['auto_params']['negative_regions']:
        sol = _ref_solve([20, 5], [0.1, 0.1], lambda x: 2000.0, ['P', 'P', 'N'])
        xs = np.linspace(g['start_ft'], g['end_ft'], 801)
        expect = max(max(-_ref_MV(sol, x)[0], 0.0) for x in xs)
        assert abs(g['M_max_abs'] - expect) < 2e-3
    gov = r['auto_params']['negative_region_gov']
    regs = r['auto_params']['negative_regions']
    assert any(g['Ly_in'] == gov['Ly_in'] and g['Cb'] == gov['Cb'] for g in regs)


def test_V3_22_23_24_labels_numbering_unused_solver():
    """V3-22: Mu 가 없는 끝 지점의 combo 는 None. V3-23: ASD 번호 = ASCE 7-10 Sec. 2.4.1
    (5 D+0.7E, 6b, 8 0.6D+0.7E). V3-24: analyze_continuous_beam 의 지점 전단 = 5wL/8."""
    r = analyze_loads('roof-purlin', 'simple', 25, {'D': 10, 'Lr': 20}, 'ASD')
    end = _loc(r['gravity']['locations'], 'End support (left)')
    assert end['Mu'] is None and end['combo'] is None and end['combo_R'] == '3: D+Lr'
    names = [n for n, _ in get_applicable_combos({'D': 10, 'L': 50, 'S': 20, 'E': 30}, 'ASD')]
    assert '5: D+0.7E' in names and '6b: D+0.75L+0.75(0.7E)+0.75S' in names and '8: 0.6D+0.7E' in names
    from design.loads.beam_analysis import analyze_continuous_beam
    rc = analyze_continuous_beam(2, 25.0, 100.0)
    assert abs(rc.V_sup_left[1] + 0.625 * 0.1 * 25) < 1e-9 and abs(rc.V_sup_right[1] - 0.625 * 0.1 * 25) < 1e-9


def test_V3_18_cont_n_message_and_I_span_input():
    """V3-18: 'cont-N' 에 spans_ft 가 없으면 무엇을 줘야 하는지 말한다. V3-20: I_span_in4 개수 검사."""
    with pytest.raises(ValueError, match='spans_ft'):
        analyze_loads('roof-purlin', 'cont-N', 25, {'D': 10}, 'ASD')
    with pytest.raises(ValueError, match='I_span_in4'):
        analyze_loads('roof-purlin', 'cont-2', 25, {'D': 10}, 'ASD', I_span_in4=[7.76])
    r = analyze_loads('roof-purlin', 'cont-2', 25, {'D': 10}, 'ASD')
    assert any('I_span_in4' in a for a in r['assumptions'])



def test_V4_notice_classification_fully_specified_run():
    """FIXES §3.1.1: 완전히 입력한 through-fastened 퍼린(II-2A, 확인 플래그) 은 warnings 가 비고,
    늘 참인 안내는 scope_notes, 기본값으로 채운 입력은 assumptions 에 있다."""
    r = _ii2a()
    assert r['warnings'] == []
    prelim = ('Deck restraint estimates are preliminary. Use project-specific '
              'connection/panel test stiffness overrides when available.')
    cov = ('RP17-2 curve fit has a coefficient of variation of 0.86; use S917 test stiffness '
           '(kx_override) where available.')
    assert prelim in r['scope_notes'] and cov in r['scope_notes']
    assert any(a.startswith('kx: fastener shear strength/diameter/tensile strengths not given')
               for a in r['assumptions'])
    for text in (prelim, cov):
        assert text not in r['warnings'] and text not in r['assumptions']
    assert any('I6.4.1' in n for n in r['scope_notes'])
    # 실제로 값을 바꾸는 것은 그대로 warnings: 단면 없음 → kφ·kx 0, I6.2.1 R 미적용
    r2 = analyze_loads('roof-purlin', 'cont-2', 25, {'D': 10, 'W': -150}, 'LRFD',
                       deck={'type': 'through-fastened', 't_panel': 0.0179, 'fastener_spacing': 12})
    assert any('deck kphi taken as 0' in w for w in r2['warnings'])
    assert any('I6.2.1 uplift R not evaluated' in w for w in r2['warnings'])
    # 패스너 값을 다 주면 kx 기본값 가정도 없다
    r3 = _ii2a(deck={'type': 'through-fastened', 't_panel': 0.019, 'fastener_spacing': 12.0,
                     'kphi_override': 0.300, 'i621_conditions_confirmed': True,
                     'Fss_kip': 1.8, 'D_screw_in': 0.19, 'Fu_panel_ksi': 70.0})
    assert r3['warnings'] == [] and not any(a.startswith('kx:') for a in r3['assumptions'])
