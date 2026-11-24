"""2026-11-22 엔진 리뷰 R3 (cFSM · fcFSM · 진동 · 소성곡면) + R2-06/07/08/17 (_cutwp_prop2) 회귀 시험.

기대값은 닫힌 해 · 이론 조건 · 독립 계산으로 정한다(코드 출력을 베끼지 않는다).
"""

import json
import math
import os
import sys

import numpy as np

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, 'python'))

from engine.template import generate_section  # noqa: E402
from engine.fsm_solver import stripmain  # noqa: E402
from engine.properties import grosprop, elemprop  # noqa: E402
from engine.stress import stresgen, yieldMP  # noqa: E402
from models.data import GBTConfig, SafeJsonEncoder  # noqa: E402
from cfsm.classify import classify, mode_class, CUFSM_CLASSIFY_DEFAULTS  # noqa: E402
from cfsm.node_utils import base_properties, check_cfsm_model  # noqa: E402
from cfsm.base_vectors import (base_column, base_update, mode_select,  # noqa: E402
                               _cutwp_prop2, cutwp_section_type,
                               constrained_selection_notes)
from cfsm.constraints import constr_xz_y  # noqa: E402
from cfsm.stiffness import create_Ks  # noqa: E402

E = 29500.0
NU = 0.3
G_MOD = E / (2 * (1 + NU))
PROP = np.array([[100, E, E, NU, NU, G_MOD]])
RHO_STEEL = 0.2836 / 386.09 / 1000.0   # kip*s^2/in^4 (0.2836 lb/in^3)


# ---------------------------------------------------------------- helpers
def _sec(kind, **kw):
    p = dict(H=9.0, B=5.0, D=1.0, t=0.1, r=0.0, nseg=1)
    p.update(kw)
    s = generate_section(kind, p)
    node = np.array(s['node'], float)
    elem = np.array(s['elem'], float)
    node[:, 7] = 1.0
    return node, elem


def _custom(coords, t=0.1, closed=False):
    coords = np.asarray(coords, float)
    n = len(coords)
    node = np.zeros((n, 8))
    node[:, 0] = np.arange(1, n + 1)
    node[:, 1:3] = coords
    node[:, 3:7] = 1
    node[:, 7] = 1.0
    rows = [[i + 1, i + 1, i + 2, t, 100] for i in range(n - 1)]
    if closed:
        rows.append([n, n, 1, t, 100])
    return node, np.array(rows, float)


def _run(node, elem, lengths, gbt=None, BC='S-S', neigs=4, m_all=None):
    lengths = np.atleast_1d(np.asarray(lengths, float))
    if m_all is None:
        m_all = [np.array([1.0]) for _ in lengths]
    return stripmain(PROP, node, elem, lengths, np.array([]), np.array([]),
                     gbt if gbt is not None else GBTConfig(), BC, m_all, neigs)


def _lf1(res, i=0):
    return float(np.asarray(res.curve[i]).reshape(-1)[1])


def _bending(node, elem):
    p = grosprop(node, elem)
    y = yieldMP(node.copy(), 50.0, p['A'], p['xcg'], p['zcg'], p['Ixx'], p['Izz'], p['Ixz'],
                p['thetap'], p['I11'], p['I22'])
    return stresgen(node.copy(), P=0.0, Mxx=y['Mxx_y'], Mzz=0.0, M11=0.0, M22=0.0,
                    A=p['A'], xcg=p['xcg'], zcg=p['zcg'], Ixx=p['Ixx'], Izz=p['Izz'],
                    Ixz=p['Ixz'], thetap=p['thetap'], I11=p['I11'], I22=p['I22'], unsymm=0)


def _minima(node, elem, lengths):
    res = _run(node, elem, lengths, neigs=1)
    lf = np.array([_lf1(res, i) for i in range(len(lengths))])
    idx = [i for i in range(1, len(lf) - 1) if lf[i] < lf[i - 1] and lf[i] <= lf[i + 1]]
    return res, lf, idx


def _gbt_sel(node, elem, g=0, d=0, l_=0, o=0, **kw):
    (_, _, _, _, nmno, ncno, nsno, ndm, nlm, _) = base_properties(node, elem)
    ngm = 4
    nom = 4 * node.shape[0] - ngm - ndm - nlm
    return GBTConfig(glob=np.full(ngm, g, float), dist=np.full(ndm, d, float),
                     local=np.full(nlm, l_, float), other=np.full(nom, o, float), **kw)


def _first(cl, i):
    return np.asarray(cl[i])[0]


# ---------------------------------------------------------------- R3-01 / §4.1
def test_R3_01_rounded_corner_classification_is_nan():
    """R3-01: 둥근 모서리(호를 요소 4개로) 립 C 는 고전 cFSM 이 국부 극소를 D 96 % 로 분류했다.
    §4.1 계약: 믿을 수 없는 분류는 NaN 행(25 % 균등 · 0 행 금지), 사유를 결과에 담는다.
    AISI 예제 단면 8x2.5x0.625x0.059, r=0.157, 국부 극소 L=5.79."""
    node, elem = _sec('lippedc', H=8.0, B=2.5, D=0.625, t=0.059, r=0.157)
    lengths = np.array([5.79, 30.0, 300.0])
    res = _run(node, elem, lengths, neigs=3)
    cl = classify(PROP, node, elem, lengths, res.shapes, GBTConfig(), 'S-S',
                  [np.array([1.0])] * 3)
    assert cl.status == 'unsupported' and not cl.supported
    assert cl.code == 'ROUNDED_CORNER'
    assert 'rounded' in cl.message
    for c in cl:
        c = np.asarray(c)
        assert c.shape == (3, 4) and np.all(np.isnan(c))
    assert any(d['code'] == 'CFSM_UNSUPPORTED_MODEL' for d in cl.diagnostics)
    # server.py 의 직렬화 경로([c.tolist()] + SafeJsonEncoder): NaN 은 0 이 아니라 null
    payload = json.dumps({'result': [c.tolist() for c in cl]}, cls=SafeJsonEncoder)
    back = json.loads(payload)['result']
    assert back[0][0] == [None, None, None, None]


def test_R3_01_auto_dsm_keeps_local_buckling_for_rounded_corners():
    """R3-01 회귀(보고서의 시험 그대로): 립 C 8x2.5x0.625x0.059, r=0.157, Fy=50, 압축,
    `_auto_generate_props` → 예전 Pcrl=0 · P_local_detected=False(국부좌굴 감소 생략).
    NaN 분류(F3) + 미분류 극소의 휴리스틱(F5) → Pcrl>0, 국부 검출, r=0 모델과 2 % 안쪽."""
    from design.aisi_s100 import _auto_generate_props
    base = {'member_type': 'compression', 'design_method': 'LRFD', 'Fy': 50, 'Fu': 65,
            'section_type': 'lippedc', 'H': 8, 'B': 2.5, 'D': 0.625, 't': 0.059}
    d_r = _auto_generate_props(dict(base, r=0.157))['dsm']
    d_0 = _auto_generate_props(dict(base, r=0.0))['dsm']
    assert d_r['Pcrl'] > 0 and d_r['P_local_detected'] is True
    assert not str(d_r['P_classification_method']).startswith('cfsm_modal')
    assert abs(d_r['Pcrl'] / d_0['Pcrl'] - 1) < 0.02, (d_r['Pcrl'], d_0['Pcrl'])


def test_R3_01_unsupported_topologies_are_nan():
    """R3-01/R3-13: 폐단면 · 가지 단면 · 끊어진 모델 · 외톨이 절점은 분류하지 않는다(NaN + 사유 코드)."""
    cases = {
        'CLOSED_SECTION': _sec('rhs', H=6.0, B=4.0, t=0.1),
        'BRANCHED_SECTION': _sec('isect', H=8.0, B=4.0, t=0.1),
    }
    a = _custom([[0, 1], [0, 0], [3, 0]])
    b = _custom([[10, 1], [10, 0], [13, 0]])
    nb = b[0].copy()
    nb[:, 0] += 3
    eb = b[1].copy()
    eb[:, 0] += 2
    eb[:, 1:3] += 3
    cases['DISCONNECTED'] = (np.vstack([a[0], nb]), np.vstack([a[1], eb]))
    orphan = _custom([[0, 0], [1, 0], [2, 0]])
    orphan_node = np.vstack([orphan[0], [4, 5, 5, 1, 1, 1, 1, 1]])
    cases['ORPHAN_NODE'] = (orphan_node, orphan[1])
    for code, (node, elem) in cases.items():
        chk = check_cfsm_model(node, elem)
        assert not chk['supported'] and chk['code'] == code, (code, chk)
        shapes = [np.ones((4 * node.shape[0], 2))]
        cl = classify(PROP, node, elem, [10.0], shapes, None, 'S-S', [np.array([1.0])])
        assert cl.status == 'unsupported' and cl.code == code
        assert np.all(np.isnan(cl[0])) and cl[0].shape == (2, 4)


def test_R3_01_sharp_lipped_c_real_modes():
    """R3-01 대조(예리한 모서리): 국부 극소 L ≥ 90 %, 뒤틀림 극소 D ≥ 85 %, 긴 길이 G ≥ 95 %,
    참여율 합 100 %. 립 C 9x5x1x0.1 (리뷰어 측정 L 98.2 @7.02, D 92.9 @41.25, G 100)."""
    node, elem = _sec('lippedc')
    assert check_cfsm_model(node, elem)['supported']
    lengths = np.array([7.02, 41.25, 1000.0])
    res = _run(node, elem, lengths, neigs=1)
    cl = classify(PROP, node, elem, lengths, res.shapes, None, 'S-S', [np.array([1.0])] * 3)
    assert cl.status == 'ok'
    for i in range(3):
        assert abs(_first(cl, i).sum() - 100.0) < 1e-6
    assert _first(cl, 0)[2] >= 90.0
    assert _first(cl, 1)[1] >= 85.0
    assert _first(cl, 2)[0] >= 95.0


def test_R3_01_sharp_lipped_z_real_modes_locks_rotT():
    """R3-01 대조 + rot.T 잠금: 주축이 기운 Z(θp≈-30°) 에서도 국부 극소 L ≥ 90 %, 뒤틀림 극소
    D ≥ 85 %, 긴 길이 G ≥ 95 %. yDOFs 의 rot.T 를 rot 로 바꾸면 G2·G3 가 주축에서 벗어나
    긴 길이 모드가 G 단일 성분이 아니게 된다(리뷰어 확인: 결합 0.757)."""
    node, elem = _sec('lippedz')
    p = grosprop(node, elem)
    assert abs(p['thetap']) > 10.0    # principal axes really rotated
    lengths = np.logspace(0.3, 2.0, 18)
    res, lf, idx = _minima(node, elem, lengths)
    assert len(idx) >= 2
    L_loc, L_dist = lengths[idx[0]], lengths[idx[-1]]
    ls = np.array([L_loc, L_dist, 1000.0])
    r2 = _run(node, elem, ls, neigs=1)
    cl = classify(PROP, node, elem, ls, r2.shapes, None, 'S-S', [np.array([1.0])] * 3)
    assert _first(cl, 0)[2] >= 90.0, _first(cl, 0)
    assert _first(cl, 1)[1] >= 85.0, _first(cl, 1)
    assert _first(cl, 2)[0] >= 95.0, _first(cl, 2)
    # The G space is the same either way; rot.T shows in the individual natural G
    # modes: G2/G3 alone must be pure bending about principal axes 1/2, i.e. their
    # constrained load factor is the Euler value pi^2*E*I/(A*L^2)/(1-nu^2) (eps_x = 0).
    A = p['A']
    L = 200.0
    (_, _, _, _, nmno, ncno, nsno, ndm, nlm, _) = base_properties(node, elem)
    nom = 4 * node.shape[0] - 4 - ndm - nlm
    for k, I_ax in ((1, p['I11']), (2, p['I22'])):
        g = np.zeros(4)
        g[k] = 1.0
        # 자연 기저(orth=1)여야 G2 · G3 가 주축 휨 하나씩이다. 모달 기저(orth=2, 지금의
        # GBTConfig 기본값)에서는 G 모드가 하중에 대한 고유모드 순서라 색인의 뜻이 다르다.
        gbt = GBTConfig(glob=g, dist=np.zeros(ndm), local=np.zeros(nlm), other=np.zeros(nom),
                        orth=1, norm=0)
        lf = _lf1(_run(node, elem, [L], gbt=gbt, neigs=1))
        ref = math.pi**2 * E * I_ax / (A * L**2) / (1 - NU**2)
        assert abs(lf / ref - 1) < 0.01, (k, lf, ref)


# ---------------------------------------------------------------- basis checks
def _criteria(node, elem, bv, cols, a, m=1):
    """열마다 (횡방향 막변형, 면내 전단, |v|, |u_local|) 최댓값 — GBT 역학 조건."""
    nn = node.shape[0]
    ep = elemprop(node, elem)
    km = m * math.pi / a
    out = []
    for c in cols:
        v = bv[:, c]
        ext = sh = umax = 0.0
        vmax = np.max(np.abs(v[1:2 * nn:2]))
        for e in range(elem.shape[0]):
            i = int(elem[e, 1]) - 1
            j = int(elem[e, 2]) - 1
            b = ep[e, 1]
            cs, sn = math.cos(ep[e, 2]), math.sin(ep[e, 2])
            ui = cs * v[2 * i] + sn * v[2 * nn + 2 * i]
            uj = cs * v[2 * j] + sn * v[2 * nn + 2 * j]
            dv = v[2 * j + 1] - v[2 * i + 1]
            ext = max(ext, abs(ui - uj))
            sh = max(sh, min(abs(ui * km * b + dv), abs(ui * km * b - dv)))
            umax = max(umax, abs(ui), abs(uj))
        out.append((ext, sh, vmax, umax))
    return np.array(out)


def test_R3_basis_dimensions_rank_and_mechanics():
    """cFSM 기저: 차원 nG=4, nD=nmno-4, nL=nmno+2nsno+neno, nO=2·nel, 합=4·nnode, rank 꽉 참.
    G/D: 횡방향 막변형 0, 면내 전단 0. L: v=0, 요소 방향 u=0. (Ádány & Schafer 의 GBT 조건)"""
    for kind in ('lippedc', 'lippedz'):
        node, elem = _sec(kind)
        (_, _, _, _, nmno, ncno, nsno, ndm, nlm, _) = base_properties(node, elem)
        a = 20.0
        bvl, ngm, ndm2, nlm2 = base_column(node, elem, PROP, a, 'S-S', np.array([1.0]))
        nnode, nel = node.shape[0], elem.shape[0]
        neno = nmno - ncno
        assert (ngm, ndm2, nlm2) == (4, nmno - 4, nmno + 2 * nsno + neno)
        nom = 4 * nnode - ngm - ndm2 - nlm2
        assert nom == 2 * nel
        assert np.linalg.matrix_rank(bvl) == 4 * nnode
        gd = _criteria(node, elem, bvl, range(ngm + ndm2), a)
        assert gd[:, 0].max() < 1e-12 and gd[:, 1].max() < 1e-12
        lc = _criteria(node, elem, bvl, range(ngm + ndm2, ngm + ndm2 + nlm2), a)
        assert lc[:, 2].max() < 1e-12 and lc[:, 3].max() < 1e-12
        # modal basis (CUFSM default) keeps the rank and the G/D/L conditions
        bv = base_update(1, 1, bvl, a, np.array([1.0]), node, elem, PROP,
                         ngm, ndm2, nlm2, 'S-S', 1, 2)
        assert np.linalg.matrix_rank(bv) == 4 * nnode
        gd = _criteria(node, elem, bv, range(ngm + ndm2), a)
        assert gd[:, 0].max() < 1e-10 and gd[:, 1].max() < 1e-10


def test_R3_constrained_solutions_bound_fsm():
    """구속해 ≥ 비구속해(구속은 강성만 더한다). 립 C: 순수 L @7.02 ≥ FSM, 순수 D @41.25 ≥ FSM,
    순수 G @1000 = FSM·1/(1-ν²) ±1.5 % (R3-15: ε_x=0 가정의 알려진 성질 — Pcre 로 쓰면 안 됨)."""
    node, elem = _sec('lippedc')
    for L, sel in ((7.02, dict(l_=1)), (41.25, dict(d=1))):
        f = _lf1(_run(node, elem, [L], neigs=1))
        c = _lf1(_run(node, elem, [L], gbt=_gbt_sel(node, elem, orth=2, **sel), neigs=1))
        assert c >= f * (1 - 1e-9), (L, c, f)
        assert c <= 1.2 * f
    f = _lf1(_run(node, elem, [1000.0], neigs=1))
    g = _lf1(_run(node, elem, [1000.0], gbt=_gbt_sel(node, elem, g=1, orth=2), neigs=1))
    assert abs(g / f - 1 / (1 - NU**2)) < 0.015 / (1 - NU**2), g / f
    # R3-15 (V1): the caveat travels with the selection
    notes = constrained_selection_notes(_gbt_sel(node, elem, g=1, orth=2), PROP)
    pure_g = [n for n in notes if n['code'] == 'CFSM_PURE_G_NOT_PCRE']
    assert pure_g and pure_g[0]['severity'] == 'warning'
    assert abs(pure_g[0]['factor'] - 1 / (1 - NU**2)) < 1e-12
    assert 'Pcre' in pure_g[0]['message']
    assert not [n for n in constrained_selection_notes(_gbt_sel(node, elem, l_=1), PROP)
                if n['code'] == 'CFSM_PURE_G_NOT_PCRE']


def test_V1_02_individual_mode_index_is_basis_dependent():
    """V1-02: 개별 모드 색인의 뜻은 기저에 따른다(GBTConfig 기본이 orth 2 가 되며 G2 만 고른 구속해가
    109.51 → 27.22). 두 뜻을 따로 잠근다 — 예리한 립 C 압축 L=200, glob=[0,1,0,0]:
    자연기저(orth=1): G2 = 주축 1 휨 → π²E·I11/(A L²)/(1-ν²) (ε_x=0) ±1 %;
    모달기저(orth=2): G2 = G 공간의 두 번째로 낮은 모드 → G 전체 구속해의 2차 고유치와 같다."""
    node, elem = _sec('lippedc')
    p = grosprop(node, elem)
    L = 200.0
    (_, _, _, _, nmno, ncno, nsno, ndm, nlm, _) = base_properties(node, elem)
    nom = 4 * node.shape[0] - 4 - ndm - nlm
    rest = dict(dist=np.zeros(ndm), local=np.zeros(nlm), other=np.zeros(nom))
    g2 = np.array([0.0, 1.0, 0.0, 0.0])
    nat = _lf1(_run(node, elem, [L], gbt=GBTConfig(glob=g2, orth=1, norm=0, **rest), neigs=1))
    ref = math.pi**2 * E * p['I11'] / (p['A'] * L**2) / (1 - NU**2)
    assert abs(nat / ref - 1) < 0.01, (nat, ref)
    modal = _lf1(_run(node, elem, [L], gbt=GBTConfig(glob=g2, orth=2, norm=1, **rest), neigs=1))
    allg = _run(node, elem, [L], gbt=GBTConfig(glob=np.ones(4), orth=2, norm=1, **rest), neigs=4)
    second = float(np.asarray(allg.curve[0]).reshape(-1)[2])   # curve row [a, lf1, lf2, ...]
    assert abs(modal / second - 1) < 1e-6, (modal, second)
    assert abs(modal / nat - 1) > 0.5      # the two bases really pick different modes
    # whole-space selection does not depend on the basis
    whole = [_lf1(_run(node, elem, [L], gbt=GBTConfig(glob=np.ones(4), orth=o, norm=n, **rest),
                       neigs=1)) for o, n in ((1, 0), (2, 1))]
    assert abs(whole[0] / whole[1] - 1) < 1e-8
    notes = constrained_selection_notes(GBTConfig(glob=g2, orth=2, norm=1, **rest))
    info = [n for n in notes if n['code'] == 'CFSM_INDIVIDUAL_MODES_BASIS_DEPENDENT']
    assert info and info[0]['classes'] == ['glob'] and info[0]['settings']['orth'] == 2
    assert not [n for n in constrained_selection_notes(GBTConfig(glob=np.ones(4), **rest))
                if n['code'] == 'CFSM_INDIVIDUAL_MODES_BASIS_DEPENDENT']


def _span_residual(B, R):
    """largest relative residual of the columns of R projected onto span(B)."""
    Q, _ = np.linalg.qr(B)
    res = R - Q @ (Q.T @ R)
    return float(np.max(np.linalg.norm(res, axis=0) / np.linalg.norm(R, axis=0)))


def test_V1_03_ospace_numbering_matches_matlab_per_couple():
    """V1-03 / R3-07: ospace 번호는 MATLAB base_update.m 그대로 — 비결합(couple=1) 1 ST · 2 K · 3 Kg ·
    4 벡터, 결합(couple=2) 1 · 2 ST · 3 K · 4 Kg · 5 벡터(:247-270). O 열의 공간을 MATLAB 정의
    (자연 O, K\null(GDL'), Kg\null(GDL'), null(GDL'))와 비교한다. C-C, m=1,2, orth=2."""
    node, elem = _sec('lippedc')
    m_a = np.array([1.0, 2.0])
    a, BC = 50.0, 'C-C'
    nn = node.shape[0]
    ndof_m = 4 * nn
    bvl, ngm, ndm, nlm = base_column(node, elem, PROP, a, BC, m_a)
    ngdl = ngm + ndm + nlm
    gdl_cols = [ml * ndof_m + j for ml in range(2) for j in range(ngdl)]
    o_cols = [ml * ndof_m + j for ml in range(2) for j in range(ngdl, ndof_m)]
    K = np.zeros((2 * ndof_m, 2 * ndof_m))
    Kg = np.zeros_like(K)
    nd = node.copy()
    nd[:, 7] = 1.0
    for ml in range(2):
        k_m, kg_m = create_Ks(m_a[ml], nd, elem, elemprop(nd, elem), PROP, a, BC)
        sl = slice(ml * ndof_m, (ml + 1) * ndof_m)
        K[sl, sl] = k_m
        Kg[sl, sl] = kg_m
    from scipy.linalg import null_space
    A = null_space(bvl[:, gdl_cols].T)
    refs = {'ST': bvl[:, o_cols], 'K': np.linalg.solve(K, A), 'Kg': np.linalg.solve(Kg, A),
            'vector': A}
    expected = {1: {1: 'ST', 2: 'K', 3: 'Kg', 4: 'vector'},
                2: {1: 'ST', 2: 'ST', 3: 'K', 4: 'Kg', 5: 'vector'}}
    for couple, table in expected.items():
        for ospace, name in table.items():
            bv = base_update(ospace, 0, bvl, a, m_a, node, elem, PROP, ngm, ndm, nlm, BC, couple, 2)
            o_sp = bv[:, o_cols]
            assert _span_residual(o_sp, refs[name]) < 1e-8, (couple, ospace, name)
            others = [_span_residual(o_sp, r) for k, r in refs.items() if k != name]
            assert min(others) > 1e-4, (couple, ospace, name, others)
            # GDL spaces are untouched by the O-space option
            assert _span_residual(bv[:, gdl_cols], bvl[:, gdl_cols]) < 1e-8
    try:
        classify(PROP, node, elem, [a], [np.ones((2 * ndof_m, 1))],
                 GBTConfig(ospace=5, couple=1), BC, [m_a])
    except ValueError as exc:
        assert 'ospace=5' in str(exc)
    else:
        raise AssertionError('ospace=5 is coupled-only')


# ---------------------------------------------------------------- R3-04
def _noisy_c(noise):
    top = np.c_[np.linspace(0, 5, 5), 9.0 + np.array([0, -noise, noise, -noise, 0])]
    bot = np.c_[np.linspace(5, 0, 5), np.array([0, noise, -noise, noise, 0])]
    coords = np.vstack([[[5, 1]], bot, np.c_[np.zeros(3), np.linspace(0, 9, 5)[1:4]], top, [[5, 8]]])
    return _custom(coords)


def test_R3_04_subnode_detection_survives_atan2_wrap():
    """R3-04: -x 방향 플랜지에 1e-13 · 1e-9 잡음 → 예전에는 ±π 경계로 일직선 절점이 모서리가 되어
    nmno 9, Rx 0 행, 국부 분류 [41.7, 28.1, 0, 30.2]. 잡음 0 과 같은 nsno=9, nD=2, 국부 L ≥ 95 %."""
    ref = None
    for noise in (0.0, 1e-13, 1e-9):
        node, elem = _noisy_c(noise)
        (_, m_node, m_elem, _, nmno, ncno, nsno, ndm, nlm, _) = base_properties(node, elem)
        assert (nmno, nsno, ndm) == (6, 9, 2), (noise, nmno, nsno, ndm)
        Rx, Rz = constr_xz_y(m_node, m_elem)
        assert not np.any(np.all(np.abs(Rx) < 1e-14, axis=1))
        res = _run(node, elem, [7.0], neigs=1)
        cl = classify(PROP, node, elem, [7.0], res.shapes, None, 'S-S', [np.array([1.0])])
        assert _first(cl, 0)[2] >= 95.0, (noise, _first(cl, 0))
        if ref is None:
            ref = _first(cl, 0)
        assert np.allclose(_first(cl, 0), ref, atol=0.05)


def test_R3_04_parallel_corner_raises():
    """R3-04: 모든 메타요소가 평행한 '모서리'(180° 접힘)는 0 행을 남기지 말고 오류(MATLAB 은 배열 밖 접근으로 멈춤)."""
    node, elem = _custom([[0, 0], [2, 0], [1, 0.0]])   # folds back on itself
    _, m_node, m_elem, *_ = base_properties(node, elem)
    try:
        constr_xz_y(m_node, m_elem)
    except ValueError as exc:
        assert 'parallel' in str(exc)
    else:
        raise AssertionError('expected ValueError for a fold-back corner')


# ---------------------------------------------------------------- R3-06 / R3-07 / R3-10
def test_R3_06_coupled_natural_basis_equals_uncoupled():
    """R3-06: couple=2 + orth=1 이 0 기저 → 25/25/25/25 였다. S-S · m=1 에서는 결합 기저 = 비결합 기저."""
    node, elem = _sec('lippedc')
    res = _run(node, elem, [7.0], neigs=1)
    out = []
    for couple in (1, 2):
        cl = classify(PROP, node, elem, [7.0], res.shapes,
                      GBTConfig(couple=couple, orth=1, norm=0), 'S-S', [np.array([1.0])])
        out.append(_first(cl, 0))
    assert np.allclose(out[0], out[1], atol=1e-8), out
    assert out[1][2] > 90.0


def test_R3_07_coupled_ospace_multi_m():
    """R3-07: C-C, m=1..3, couple=2, ospace=3, orth=2 가 broadcast 오류로 죽었다(행/열 전치).
    고친 뒤: 예외 없음, 기저 rank 꽉 참, 분류 합 100 %."""
    node, elem = _sec('lippedc')
    m_a = np.array([1.0, 2.0, 3.0])
    a = 50.0
    bvl, ngm, ndm, nlm = base_column(node, elem, PROP, a, 'C-C', m_a)
    for ospace in (1, 2, 3, 4, 5):
        bv = base_update(ospace, 1, bvl, a, m_a, node, elem, PROP, ngm, ndm, nlm, 'C-C', 2, 2)
        assert np.linalg.matrix_rank(bv) == bv.shape[0], ospace
    res = _run(node, elem, [a], BC='C-C', m_all=[m_a], neigs=1)
    cl = classify(PROP, node, elem, [a], res.shapes, GBTConfig(ospace=3, couple=2, orth=2, norm=1),
                  'C-C', [m_a])
    assert abs(_first(cl, 0).sum() - 100.0) < 1e-6


def test_R3_10_default_settings_are_cufsm():
    """R3-10: GBTcon=None 이면 CUFSM 기본(ospace 1, orth 2, couple 1, norm 1, loader.m:135-145).
    예리한 립 C 휨 국부(L=4.92): 비직교 자연기저는 O 4.5 %, CUFSM 기본은 O ≤ 1 %."""
    assert CUFSM_CLASSIFY_DEFAULTS == {'ospace': 1, 'orth': 2, 'couple': 1, 'norm': 1}
    node, elem = _sec('lippedc')
    node = _bending(node, elem)
    res = _run(node, elem, [4.92], neigs=1)
    cl = classify(PROP, node, elem, [4.92], res.shapes, None, 'S-S', [np.array([1.0])])
    assert cl.settings == CUFSM_CLASSIFY_DEFAULTS
    assert _first(cl, 0)[3] <= 1.0 and _first(cl, 0)[2] >= 90.0
    same = classify(PROP, node, elem, [4.92], res.shapes, GBTConfig(orth=2, norm=1), 'S-S',
                    [np.array([1.0])])
    assert np.allclose(_first(same, 0), _first(cl, 0))
    try:
        classify(PROP, node, elem, [4.92], res.shapes, GBTConfig(orth=7), 'S-S', [np.array([1.0])])
    except ValueError as exc:
        assert 'orth' in str(exc)
    else:
        raise AssertionError('invalid orth must be rejected')


# ---------------------------------------------------------------- R3-13 / R3-14 / R3-16
def test_R3_13_closed_section_basis_clear_error():
    """R3-13: 폐단면 cFSM 기저가 'array must not contain infs or NaNs' 로 죽었다 → 원인을 밝힌 오류."""
    node, elem = _sec('rhs', H=6.0, B=4.0, t=0.1)
    try:
        base_column(node, elem, PROP, 10.0, 'S-S', np.array([1.0]))
    except ValueError as exc:
        assert 'open sections only' in str(exc) and 'closed' in str(exc)
    else:
        raise AssertionError('closed section must be rejected')


def test_R3_14_failed_decomposition_is_nan():
    """R3-14: 0 벡터 모드 · 빈 모드형상 · 크기 불일치는 25 % 균등 · 0 행이 아니라 NaN (MATLAB 은 0/0 = NaN)."""
    node, elem = _sec('lippedc')
    ndof = 4 * node.shape[0]
    bvl, ngm, ndm, nlm = base_column(node, elem, PROP, 7.0, 'S-S', np.array([1.0]))
    assert np.all(np.isnan(mode_class(bvl, np.zeros(ndof), ngm, ndm, nlm, [1.0], ndof, 1)))
    assert np.all(np.isnan(mode_class(bvl, np.zeros(ndof), ngm, ndm, nlm, [1.0], ndof, 2)))
    shapes = [np.zeros((ndof, 2)), np.zeros((0, 0)), np.ones((ndof + 3, 1))]
    cl = classify(PROP, node, elem, [7.0, 8.0, 9.0], shapes, None, 'S-S', [np.array([1.0])] * 3)
    assert cl.status == 'partial'
    assert all(np.all(np.isnan(c)) for c in cl)
    codes = {d['code'] for d in cl.diagnostics}
    assert {'MODE_NOT_CLASSIFIED', 'NO_MODE_SHAPE', 'SHAPE_SIZE_MISMATCH'} <= codes
    # a singular basis (single flat plate has only 2 global modes) is not decomposed
    pnode, pelem = _custom(np.c_[np.linspace(0, 5, 6), np.zeros(6)])
    res = _run(pnode, pelem, [7.0], neigs=1)
    cl = classify(PROP, pnode, pelem, [7.0], res.shapes, None, 'S-S', [np.array([1.0])])
    assert np.all(np.isnan(cl[0])) and cl.diagnostics[0]['code'] == 'CFSM_BASIS_SINGULAR'


def test_R3_16_input_validation():
    """R3-16: GBTConfig(glob=[1.0]) 는 IndexError 였다 → 길이를 밝힌 오류. 재료 번호가 없으면
    0 번 재료로 대체하던 것을 오류로(FSM · 진동과 같게)."""
    node, elem = _sec('lippedc')
    ndof = 4 * node.shape[0]
    bvl, ngm, ndm, nlm = base_column(node, elem, PROP, 7.0, 'S-S', np.array([1.0]))
    nom = ndof - ngm - ndm - nlm
    try:
        mode_select(bvl, ngm, ndm, nlm, [1.0], np.zeros(ndm), np.zeros(nlm), np.zeros(nom),
                    ndof, np.array([1.0]))
    except ValueError as exc:
        assert 'glob must have length 4' in str(exc)
    else:
        raise AssertionError('short selection vector must be rejected')
    sel = mode_select(bvl, ngm, ndm, nlm, np.ones(ngm), np.zeros(ndm), np.zeros(nlm),
                      np.zeros(nom), ndof, np.array([1.0]))
    assert sel.shape == (ndof, ngm)
    bad = elem.copy()
    bad[0, 4] = 7
    try:
        create_Ks(1.0, node, bad, elemprop(node, bad), PROP, 7.0, 'S-S')
    except ValueError as exc:
        assert 'material' in str(exc)
    else:
        raise AssertionError('undefined material must be rejected')


# ---------------------------------------------------------------- R2-06/07/08/17 (_cutwp_prop2)
def _rect_tube(b=4.0, h=4.0, t=0.1, n=4, t_left=None):
    """centerline rectangle b x h, n elements per side, counter-clockwise from (0,0)."""
    pts = []
    for k in range(n):
        pts.append((b * k / n, 0.0))
    for k in range(n):
        pts.append((b, h * k / n))
    for k in range(n):
        pts.append((b - b * k / n, h))
    for k in range(n):
        pts.append((0.0, h - h * k / n))
    coord = np.array(pts)
    m = len(pts)
    ends = np.array([[i + 1, (i + 1) % m + 1, t] for i in range(m)], float)
    if t_left is not None:
        ends[3 * n:, 2] = t_left
    return coord, ends


def test_R2_07_bredt_J_independent_of_element_direction_and_order():
    """R2-07 / R3-08: 폐단면 J 가 요소 방향에 따라 달랐다(한 요소 반대 3.600, Bredt 6.400).
    4x4 각관 t=0.1: J = 4·A0²/Σ(L/t) = 4·16²/(16/0.1) = 6.400 — 방향 · 순서와 무관해야 한다."""
    coord, ends = _rect_tube()
    J_ref = 4 * 16.0**2 / (16.0 / 0.1)
    rng = np.random.default_rng(3)
    for trial in range(6):
        e = ends.copy()
        flip = rng.random(len(e)) < 0.5 if trial else np.zeros(len(e), bool)
        e[flip, 0], e[flip, 1] = ends[flip, 1], ends[flip, 0]
        e = e[rng.permutation(len(e))] if trial > 2 else e
        out = _cutwp_prop2(coord, e)
        assert abs(out[9] - J_ref) < 1e-9 * J_ref, (trial, out[9])
        assert cutwp_section_type(coord, e) == 'close'


def test_R2_08_closed_cell_shear_center_and_cw():
    """R2-08: 폐단면 전단중심을 NaN(→ 도심)으로 두었다. 셀 전단류 해석(독립 계산)과 비교:
    4x6 상자, 왼쪽 벽 t=0.3 · 나머지 0.1 → 전단중심이 두꺼운 벽 쪽으로 옮겨간다.
    균일 두께 직사각형 관 Cw = b²h²t(b-h)²/(24(b+h)) (Kollbrunner-Basler), 정사각관 Cw = 0."""
    b, h = 4.0, 6.0
    coord, ends = _rect_tube(b, h, 0.1, n=6, t_left=0.3)
    out = _cutwp_prop2(coord, ends)
    xs, ys = out[10], out[11]
    xs_ref = _box_shear_center_x(b, h, 0.1, 0.3)
    assert abs(xs - xs_ref) < 1e-6 * b, (xs, xs_ref)
    assert abs(ys - h / 2) < 1e-9
    assert abs(xs - out[1]) > 0.05   # singly symmetric: not the centroid
    coord, ends = _rect_tube(b, h, 0.1, n=6)
    out = _cutwp_prop2(coord, ends)
    cw_ref = b**2 * h**2 * 0.1 * (b - h)**2 / (24 * (b + h))
    assert abs(out[12] - cw_ref) < 1e-9 * cw_ref
    assert abs(out[10] - b / 2) < 1e-9 and abs(out[11] - h / 2) < 1e-9
    coord, ends = _rect_tube(5.0, 5.0, 0.1)
    assert _cutwp_prop2(coord, ends)[12] == 0.0


def _box_shear_center_x(b, h, t, tl, nseg=2000):
    """Independent shear-flow solution for a rectangular cell (left wall thickness tl):
    vertical shear V=1 along z, open flow from a cut at the bottom-left corner plus the
    closed-cell circulation q0 = -∮(q_o/t)ds/∮ds/t; shear centre x from moment balance."""
    walls = [((0, 0), (b, 0), t), ((b, 0), (b, h), t), ((b, h), (0, h), t), ((0, h), (0, 0), tl)]
    A = b * t * 2 + h * t + h * tl
    xc = (h * t * b) / A
    zc = h / 2
    Ix = 2 * b * t * (h / 2)**2 + (t + tl) * h**3 / 12
    segs = []
    Q = 0.0
    for (p0, p1, tw) in walls:
        p0, p1 = np.array(p0, float), np.array(p1, float)
        L = np.linalg.norm(p1 - p0)
        for k in range(nseg):
            a0 = p0 + (p1 - p0) * k / nseg
            a1 = p0 + (p1 - p0) * (k + 1) / nseg
            ds = L / nseg
            zm = (a0[1] + a1[1]) / 2 - zc
            q_start = Q
            Q += tw * ds * zm
            segs.append((a0, a1, tw, ds, -(q_start + Q) / 2 / Ix))
    qo = np.array([s[4] for s in segs])
    tt = np.array([s[2] for s in segs])
    ds = np.array([s[3] for s in segs])
    q0 = -np.sum(qo / tt * ds) / np.sum(ds / tt)
    q = qo + q0
    mom = 0.0
    fz = 0.0
    for (a0, a1, _, _, _), qi in zip(segs, q):
        r = (a0 + a1) / 2 - np.array([xc, zc])
        d = a1 - a0
        mom += qi * (r[0] * d[1] - r[1] * d[0])
        fz += qi * d[1]
    return xc + mom / fz   # resultant (0, fz) acts at x - xc = M / fz


def test_R2_06_cell_with_branch_is_not_open():
    """R2-06: 각관 6x4x0.1 에 0.5 in 립을 붙이면 '열린 단면' 으로 J=0.0067(1/1600), Cw 허위 155.6.
    고친 뒤: J = Bredt(셀) + 립 b·t³/3, 'arbitrary' 로 분류, Cw 는 셀의 값 수준."""
    b, h, t = 3.9, 5.9, 0.1
    coord, ends = _rect_tube(b, h, t, n=4)
    J_cell = 4 * (b * h)**2 / (2 * (b + h) / t)
    Cw_cell = _cutwp_prop2(coord, ends)[12]
    coord2 = np.vstack([coord, [[-0.5, h]]])
    tip = len(coord2)
    corner = 2 * 4 + 4 + 1   # node (0, h)
    assert np.allclose(coord2[corner - 1], [0.0, h])
    ends2 = np.vstack([ends, [[corner, tip, t]]])
    out = _cutwp_prop2(coord2, ends2)
    assert cutwp_section_type(coord2, ends2) == 'arbitrary'
    assert abs(out[9] - (J_cell + 0.5 * t**3 / 3)) < 1e-9 * J_cell
    assert out[12] < 5 * max(Cw_cell, 1.0)   # not the bogus open-section 155.6


def test_R2_17_disconnected_and_multicell_raise():
    """R2-17: 떨어진 앵글 두 개가 그럴듯한 Xs · Cw 를 냈다 → 오류. 다세포(셀 2개)도 오류."""
    coord = np.array([[0, 1], [0, 0], [1, 0], [10, 1], [10, 0], [11, 0]], float)
    ends = np.array([[1, 2, 0.1], [2, 3, 0.1], [4, 5, 0.1], [5, 6, 0.1]], float)
    try:
        _cutwp_prop2(coord, ends)
    except ValueError as exc:
        assert 'disconnected' in str(exc)
    else:
        raise AssertionError('disconnected model must be rejected')
    coord = np.array([[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]], float)
    ends = np.array([[1, 2, .1], [2, 3, .1], [3, 4, .1], [4, 5, .1], [5, 6, .1], [6, 1, .1],
                     [2, 5, .1]], float)
    try:
        _cutwp_prop2(coord, ends)
    except ValueError as exc:
        assert 'multi-cell' in str(exc)
    else:
        raise AssertionError('two-cell section must be rejected')


def test_R2_open_sections_unchanged_closed_forms():
    """_cutwp_prop2 열린 단면 경로(재작성 후): 예리한 립 C 의 J = Σbt³/3, 앵글 Cw = 0,
    I 단면 전단중심 = 도심(이중대칭) — 닫힌 식."""
    node, elem = _sec('lippedc')
    out = _cutwp_prop2(node[:, 1:3], elem[:, 1:4])
    L = elemprop(node, elem)[:, 1]
    assert abs(out[9] - np.sum(L * elem[:, 3]**3) / 3) < 1e-12
    node, elem = _sec('angle', H=4.0, B=3.0)
    assert abs(_cutwp_prop2(node[:, 1:3], elem[:, 1:4])[12]) < 1e-9
    node, elem = _sec('isect', H=8.0, B=4.0, t=0.1)
    out = _cutwp_prop2(node[:, 1:3], elem[:, 1:4])
    assert abs(out[10] - out[1]) < 1e-9 and abs(out[11] - out[2]) < 1e-9


# ---------------------------------------------------------------- R3-02 / R3-03 / R3-12 (vibration)
def _plate(b=6.0, t=0.1, n=4):
    node = np.zeros((n + 1, 8))
    node[:, 0] = np.arange(1, n + 2)
    node[:, 1] = np.linspace(0, b, n + 1)
    node[:, 3:7] = 1
    elem = np.array([[i + 1, i + 1, i + 2, t, 100] for i in range(n)], float)
    return node, elem


def _vprop(rho=RHO_STEEL):
    return np.array([[100, E, E, NU, NU, G_MOD, rho]])


def test_R3_02_axial_frequency_closed_form():
    """R3-02: 종방향 질량에 I4 를 써서 축방향 진동수가 길이와 무관하게 33435 Hz 였다(mlocal.m 은 I5).
    v 만 자유인 평판(u 고정 → 판 변형률): f₁ = (1/2L)·√(E/(1-ν²)/ρ). L=100 → 1050.4 Hz, L=10 → 10504 Hz."""
    from vibration.solver import stripmain_vib
    for L in (100.0, 10.0):
        node, elem = _plate()
        node[:, [3, 4, 6]] = 0
        r = stripmain_vib(_vprop(), node, elem, np.array([L]), 'S-S', [np.array([1.0])], neigs=2)
        f_ref = 1 / (2 * L) * math.sqrt(E / (1 - NU**2) / RHO_STEEL)
        assert abs(r['frequencies'][0][0] / f_ref - 1) < 0.01, (L, r['frequencies'][0][0], f_ref)


def test_R3_02_plate_and_beam_frequencies_closed_form():
    """진동 닫힌 해: 단순지지 평판 f₁₁ = (π/2)(1/a²+1/b²)√(D/ρt) (a=b=6 → 529.2 Hz, ±0.5 %);
    보 휨 f = β²/(2πL²)·√(EI/ρA): S-S β=π (±0.5 %); C-C β=4.7300 · C-F β=1.8751 은 m 항이 적으면
    Ritz 상한으로 위에서 수렴하므로 [-0.5 %, +3 %] (리뷰어: 10 항에서 +0.03 % · +0.75 %)."""
    from vibration.solver import stripmain_vib
    node, elem = _plate(n=6)
    node[[0, -1], 4] = 0
    node[:, 3] = 0
    node[:, 5] = 0
    r = stripmain_vib(_vprop(), node, elem, np.array([6.0]), 'S-S', [np.array([1.0])], neigs=1)
    Dp = E * 0.1**3 / (12 * (1 - NU**2))
    f11 = math.pi / 2 * (2 / 36.0) * math.sqrt(Dp / (RHO_STEEL * 0.1))
    assert abs(r['frequencies'][0][0] / f11 - 1) < 0.005
    # beam: square tube 4x4x0.1, two elements per side
    bw = 4.0
    coord, _ = _rect_tube(bw, bw, 0.1, n=2)
    bnode, belem = _custom(coord, t=0.1, closed=True)
    A = 4 * bw * 0.1
    Ib = 2 * bw * 0.1 * (bw / 2)**2 + 2 * 0.1 * bw**3 / 12
    L = 300.0
    for BC, beta, ms, lo, hi in (('S-S', math.pi, [1.0], -0.005, 0.005),
                                 ('C-C', 4.7300407, [1.0, 3.0, 5.0], -0.005, 0.03),
                                 ('C-F', 1.8751041, [1.0, 2.0, 3.0, 4.0], -0.005, 0.03)):
        r = stripmain_vib(_vprop(), bnode, belem, np.array([L]), BC, [np.array(ms)], neigs=1)
        f_ref = beta**2 / (2 * math.pi * L**2) * math.sqrt(E * Ib / (RHO_STEEL * A))
        dev = r['frequencies'][0][0] / f_ref - 1
        assert lo < dev < hi, (BC, r['frequencies'][0][0], f_ref)


def test_R3_03_density_default_and_units_warning():
    """R3-03: GUI 가 무단위 ρ=1.0 을 넣어 진동수가 1/1167 로 나왔다. 엔진: ρ 열이 없으면 강재
    7.345e-7 kip·s²/in⁴ + 경고, ρ 가 구조 재료 범위 밖이면 단위 경고. 결과에 ρ · 단위를 싣는다."""
    from vibration.solver import stripmain_vib, STEEL_MASS_DENSITY_US, KG_PER_M3_TO_KIP_S2_PER_IN4
    assert abs(STEEL_MASS_DENSITY_US - 7.345e-7) < 0.001e-7
    assert abs(7850 * KG_PER_M3_TO_KIP_S2_PER_IN4 - 7.345e-7) < 0.002e-7
    node, elem = _plate()
    node[:, [3, 4, 6]] = 0
    r0 = stripmain_vib(PROP, node, elem, np.array([100.0]), 'S-S', [np.array([1.0])], neigs=1)
    assert any(d['code'] == 'DEFAULT_DENSITY' for d in r0['diagnostics'])
    assert r0['success'] is True and r0['units']['frequency'] == 'Hz'
    assert abs(r0['rho_used'][100] - STEEL_MASS_DENSITY_US) < 1e-15
    r1 = stripmain_vib(_vprop(1.0), node, elem, np.array([100.0]), 'S-S', [np.array([1.0])], neigs=1)
    assert any(d['code'] == 'DENSITY_UNITS_SUSPECT' for d in r1['diagnostics'])
    ratio = r0['frequencies'][0][0] / r1['frequencies'][0][0]
    assert abs(ratio - 1 / math.sqrt(STEEL_MASS_DENSITY_US)) < 1e-6 * ratio
    r2 = stripmain_vib(_vprop(), node, elem, np.array([100.0]), 'S-S', [np.array([1.0])], neigs=1)
    assert not r2['diagnostics']


def test_R3_12_vibration_springs_and_constraints():
    """R3-12: 진동 해석이 스프링 · 사용자 구속을 조용히 버렸다. 판 띠(평면 밖 휨): 한쪽 가장자리
    w 에 큰 스프링 → f₁ 증가. 가장자리 w 를 구속식(w_n = 0·w_1)으로 없애면 절점 고정과 같은 f₁."""
    from vibration.solver import stripmain_vib
    node, elem = _plate(n=4)
    node[:, 3] = 0
    node[:, 5] = 0
    node[0, 4] = 0
    args = (_vprop(), node, elem, np.array([20.0]), 'S-S', [np.array([1.0])])
    f_free = stripmain_vib(*args, neigs=1)['frequencies'][0][0]
    spr = np.array([[1, 5, 0, 0, 0, 1e6, 0, 0, 0, 0]], float)
    f_spr = stripmain_vib(*args, neigs=1, springs=spr)['frequencies'][0][0]
    assert f_spr > 1.5 * f_free
    fixed = node.copy()
    fixed[4, 4] = 0
    f_fix = stripmain_vib(_vprop(), fixed, elem, np.array([20.0]), 'S-S',
                          [np.array([1.0])], neigs=1)['frequencies'][0][0]
    cons = np.array([[5, 2, 0.0, 1, 2]], float)   # w5 = 0 * w1
    f_con = stripmain_vib(*args, neigs=1, constraints=cons)['frequencies'][0][0]
    assert abs(f_con / f_fix - 1) < 1e-6, (f_con, f_fix)
    assert abs(f_spr / f_fix - 1) < 0.01


# ---------------------------------------------------------------- R3-05 (fcFSM)
def test_R3_05_fcfsm_result_is_flagged_not_fcfsm():
    """R3-05: fcfsm/ 는 MATLAB fcFSM 의 이식이 아니다(길이 · BC 와 무관한 기저, 25 % 대체값).
    결과가 fcFSM 으로 오인되지 않게: is_fcfsm=False, method 명시, 경고. 분류는 고전 cFSM 과 같고
    둥근 모서리는 NaN."""
    from fcfsm.solver import stripmain_fcfsm
    node, elem = _sec('lippedc')
    lengths = np.array([7.02, 1000.0])
    m_all = [np.array([1.0])] * 2
    r = stripmain_fcfsm(PROP, node, elem, lengths, 'S-S', m_all, neigs=1)
    assert r['is_fcfsm'] is False and 'cfsm' in r['method']
    assert any(d['code'] == 'FCFSM_NOT_IMPLEMENTED' for d in r['diagnostics'])
    assert r['success'] is True
    ref = classify(PROP, node, elem, lengths, r['shapes'], None, 'S-S', m_all)
    for a, b in zip(r['classification'], ref):
        assert np.allclose(a, b, equal_nan=True)
    assert r['classification'][1][0][0] >= 95.0
    node, elem = _sec('lippedc', r=0.1875)
    r = stripmain_fcfsm(PROP, node, elem, np.array([7.02]), 'S-S', [np.array([1.0])], neigs=1)
    assert np.all(np.isnan(r['classification'][0]))


# ---------------------------------------------------------------- R3-11 / R3-17 (plastic)
def _flat(bw, t, ne, ang=0.0):
    c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    xs = np.linspace(-bw / 2, bw / 2, ne + 1)
    node = np.zeros((ne + 1, 8))
    node[:, 0] = np.arange(1, ne + 2)
    node[:, 1] = xs * c
    node[:, 2] = xs * s
    node[:, 3:7] = 1
    elem = np.array([[i + 1, i + 1, i + 2, t, 100] for i in range(ne)], float)
    return node, elem


def _mp_at_p0(r, key):
    P = r['P_raw']
    sel = np.abs(P) < 1e-9 * abs(r['Py'])
    return float(np.max(np.abs(r[key][sel])))


def test_R3_11_plastic_through_thickness_fibres():
    """R3-11: 두께 방향 섬유가 없어 평판 약축 Mp=0 이었다(fiber4elem.m 은 두께 방향 NL 섬유).
    6x0.25 평판, Fy=50: Np = A·Fy = 75, 강축 Mp = t·b²/4·Fy = 112.5, 약축 Mp = b·t²/4·Fy = 4.6875
    (두께 방향 10 섬유, ±1 %). 약축 항복값이 정의되지 않으면 NaN + 경고(회전해도 같게)."""
    from plastic.pmm_plastic import pmm_plastic
    bw, t, fy = 6.0, 0.25, 50.0
    for ang in (0.0, 30.0):
        node, elem = _flat(bw, t, 10, ang)
        r = pmm_plastic(node, elem, fy)
        assert abs(np.max(np.abs(r['P_raw'])) - bw * t * fy) < 1e-9
        assert abs(_mp_at_p0(r, 'M11_raw') - t * bw**2 / 4 * fy) < 1e-3 * 112.5
        weak = _mp_at_p0(r, 'M22_raw')
        assert abs(weak / (bw * t**2 / 4 * fy) - 1) < 0.01, (ang, weak)
        assert r['normalized']['M22'] is False and np.all(np.isnan(r['M22']))
        assert r['warnings']
        assert r['normalized']['M11'] is True


def test_R3_11_17_plastic_closed_forms_and_exact_p0():
    """소성곡면 닫힌 해: 이중대칭 I(중심선 h, bf, t)의 Np = A·Fy, Mp,x = (bf·t·h + t·h²/4)·Fy;
    약축 = (2·t·bf²/4 + h·t²/4)·Fy (웨브 두께 항 포함). R3-17: P=0 표본이 모든 θ 에 정확히 있어
    단축대칭 립 C 의 약축 Mp 가 점구름 최댓값과 같다(예전 −1 %)."""
    from plastic.pmm_plastic import pmm_plastic
    fy = 50.0
    node, elem = _sec('isect', H=10.0, B=5.0, t=0.2, nseg=2)
    h = node[:, 2].max() - node[:, 2].min()
    bf = node[:, 1].max() - node[:, 1].min()
    tt = 0.2
    A = 2 * bf * tt + h * tt
    r = pmm_plastic(node, elem, fy)
    assert abs(np.max(np.abs(r['P_raw'])) - A * fy) < 1e-6 * A * fy
    assert abs(_mp_at_p0(r, 'M11_raw') / ((bf * tt * h + tt * h**2 / 4) * fy) - 1) < 1e-3
    zy = 2 * tt * bf**2 / 4 + h * tt**2 / 4
    assert abs(_mp_at_p0(r, 'M22_raw') / (zy * fy) - 1) < 0.01
    assert np.sum(np.abs(r['P_raw']) < 1e-9 * A * fy) == r['n_theta']
    # lipped C weak axis (axis of symmetry horizontal): independent plastic-neutral-axis
    # integration over the plate walls (200 pieces x 20 layers per element)
    node, elem = _sec('lippedc')
    r = pmm_plastic(node, elem, fy)
    xs_, da = [], []
    for e in range(elem.shape[0]):
        i, j, t = int(elem[e, 1]) - 1, int(elem[e, 2]) - 1, elem[e, 3]
        p0, p1 = node[i, 1:3], node[j, 1:3]
        L = np.linalg.norm(p1 - p0)
        nrm = np.array([-(p1 - p0)[1], (p1 - p0)[0]]) / L
        for a_ in (np.arange(200) + 0.5) / 200:
            for b_ in (np.arange(20) + 0.5) / 20 - 0.5:
                xs_.append((p0 + a_ * (p1 - p0) + b_ * t * nrm)[0])
                da.append(L * t / 4000)
    xs_, da = np.array(xs_), np.array(da)
    lo, hi = xs_.min(), xs_.max()
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if da[xs_ < mid].sum() < da.sum() / 2 else (lo, mid)
    mp_ref = fy * np.sum(da * np.abs(xs_ - (lo + hi) / 2))
    assert abs(_mp_at_p0(r, 'M22_raw') / mp_ref - 1) < 2e-3, (_mp_at_p0(r, 'M22_raw'), mp_ref)


# ---------------------------------------------------------------- V4-02 (fast assembly)
def _slow_vibration_reference(prop, node, elem, a, BC, m_a, neigs):
    """옛 경로를 시험 안에서 다시 짓는다: lil 블록 조립(engine.assembly 의 sparse 경로) +
    전 고유치 QZ(scipy.linalg.eig) + 양 · 실수 · 유한 거르기 (V4-02 수정 전 solver.py 와 같다)."""
    from scipy import sparse
    from scipy.linalg import eig
    from engine.element import klocal
    from engine.transform import trans
    from engine.assembly import assemble
    from engine.fsm_solver import _get_free_dofs
    from vibration.solver import mlocal
    nn = node.shape[0]
    ndof = 4 * nn * len(m_a)
    K = sparse.lil_matrix((ndof, ndof))
    M = sparse.lil_matrix((ndof, ndof))
    ep = elemprop(node, elem)
    for e in range(elem.shape[0]):
        t = elem[e, 3]
        k_g, _ = trans(ep[e, 2], klocal(E, E, NU, NU, G_MOD, t, a, ep[e, 1], BC, m_a),
                       np.zeros((8 * len(m_a),) * 2), m_a)
        m_g, _ = trans(ep[e, 2], mlocal(prop[0, 6], t, a, ep[e, 1], BC, m_a),
                       np.zeros((8 * len(m_a),) * 2), m_a)
        K, _ = assemble(K, sparse.lil_matrix((ndof, ndof)), k_g, np.zeros_like(k_g),
                        int(elem[e, 1]), int(elem[e, 2]), nn, m_a)
        M, _ = assemble(M, sparse.lil_matrix((ndof, ndof)), m_g, np.zeros_like(m_g),
                        int(elem[e, 1]), int(elem[e, 2]), nn, m_a)
    free = _get_free_dofs(node, nn, len(m_a))
    lam, _ = eig(K.toarray()[np.ix_(free, free)], M.toarray()[np.ix_(free, free)])
    ok = (np.abs(np.imag(lam)) < 1e-5) & (np.real(lam) > 0) & np.isfinite(np.real(lam))
    return np.sqrt(np.sort(np.real(lam[ok]))[:neigs]) / (2 * math.pi)


def test_V4_02_vibration_fast_path_matches_slow_reference():
    """V4-02: 다항 C-C 진동이 lil 조립 + 전 고유치 QZ 로 시간 초과(21 항 × 60 길이 > 25 분).
    dense 색인 조립 + 대칭 정부호 eigh 로 바꾼 뒤 옛 경로(시험 안에서 재구성)와 반올림 안에서 같다:
    예리한 립 C, C-C m=1..4, L=120, 1–6 차 진동수 상대차 < 1e-8 (옛 경로가 느려 한 경우만)."""
    from vibration.solver import stripmain_vib
    node, elem = _sec('lippedc')
    prop = _vprop()
    m_a = np.arange(1.0, 5.0)
    for L in (120.0,):
        r = stripmain_vib(prop, node, elem, np.array([L]), 'C-C', [m_a], neigs=6)
        ref = _slow_vibration_reference(prop, node, elem, L, 'C-C', m_a, 6)
        assert np.max(np.abs(r['frequencies'][0] / ref - 1)) < 1e-8, (L, r['frequencies'][0], ref)
        shp = r['shapes'][0]
        assert shp.shape[1] == 6 and np.allclose(np.linalg.norm(shp, axis=0), 1.0)


def test_V4_02_vibration_and_fcfsm_use_fast_paths():
    """V4-02: 벽시계 대신 경로를 센다 — 진동 · fcFSM 모두 lil 블록 조립 0 회, 전 고유치 QZ 0 회
    (진동은 dense 색인 assemble 을 요소마다 한 번)."""
    import engine.fsm_solver as F
    import vibration.solver as V
    node, elem = _sec('lippedc')
    seen = {'dense': 0, 'other': 0, 'qz': 0}
    orig = {'F_asm': F.assemble, 'V_asm': V.assemble, 'qz': F._solve_eigenproblem}

    def counting(fn):
        def asm(K, Kg, *args):
            seen['dense' if isinstance(K, np.ndarray) and isinstance(Kg, np.ndarray)
                 else 'other'] += 1
            return fn(K, Kg, *args)
        return asm

    def qz(*args):
        seen['qz'] += 1
        return orig['qz'](*args)
    F.assemble, V.assemble, F._solve_eigenproblem = (counting(orig['F_asm']),
                                                      counting(orig['V_asm']), qz)
    try:
        V.stripmain_vib(_vprop(), node, elem, np.array([100.0]), 'C-C',
                        [np.arange(1.0, 9.0)], neigs=3)
        assert seen == {'dense': elem.shape[0], 'other': 0, 'qz': 0}, seen
        from fcfsm.solver import stripmain_fcfsm
        stripmain_fcfsm(PROP, node, elem, np.array([100.0]), 'C-C', [np.arange(1.0, 9.0)],
                        neigs=3)
        # stripmain may assemble extra S-S lengths for its own term check (F1), all dense
        assert seen['dense'] >= 2 * elem.shape[0] and seen['other'] == 0 and seen['qz'] == 0, seen
    finally:
        F.assemble, V.assemble, F._solve_eigenproblem = orig['F_asm'], orig['V_asm'], orig['qz']


# ---------------------------------------------------------------- FIXES §3.1.1 notice classes
def test_F311_notices_split_into_warnings_assumptions_scope():
    """FIXES §3.1.1 (W3 의 V4 화면 지적): 기본값으로 채운 입력은 경고가 아니라 가정이다.
    진동 · 소성 · 분류 · fcFSM 의 알림을 warnings(값을 바꿨거나 손봐야 함) · assumptions(이
    실행의 가정) · scope_notes(늘 참인 범위)로 나눈다."""
    from vibration.solver import stripmain_vib
    from plastic.pmm_plastic import pmm_plastic
    from fcfsm.solver import stripmain_fcfsm, FCFSM_WARNING
    node, elem = _plate()
    node[:, [3, 4, 6]] = 0
    args = (node, elem, np.array([100.0]), 'S-S', [np.array([1.0])])
    r = stripmain_vib(PROP, *args, neigs=1)            # no density column
    assert r['warnings'] == [] and len(r['assumptions']) == 1
    assert 'steel' in r['assumptions'][0] and r['scope_notes']
    d = [x for x in r['diagnostics'] if x['code'] == 'DEFAULT_DENSITY'][0]
    assert d['severity'] == 'info' and d['category'] == 'assumption'
    r = stripmain_vib(_vprop(1.0), *args, neigs=1)     # implausible units -> real warning
    assert len(r['warnings']) == 1 and 'outside the range' in r['warnings'][0]
    assert r['assumptions'] == []
    # classification
    cnode, celem = _sec('lippedc')
    res = _run(cnode, celem, [7.02], neigs=1)
    cl = classify(PROP, cnode, celem, [7.02], res.shapes, None, 'S-S', [np.array([1.0])])
    assert cl.warnings == [] and len(cl.assumptions) == 1 and 'orth=2' in cl.assumptions[0]
    assert cl.scope_notes and cl.summary()['scope_notes'] == cl.scope_notes
    cl = classify(PROP, cnode, celem, [7.02], res.shapes, GBTConfig(), 'S-S', [np.array([1.0])])
    assert cl.assumptions == []
    rn, re_ = _sec('lippedc', r=0.1875)
    cl = classify(PROP, rn, re_, [7.02], [np.ones((4 * rn.shape[0], 1))], GBTConfig(), 'S-S',
                  [np.array([1.0])])
    assert len(cl.warnings) == 1 and 'rounded' in cl.warnings[0]
    # constrained selection caveats
    notes = constrained_selection_notes(_gbt_sel(cnode, celem, g=1), PROP)
    assert {n['code']: n['category'] for n in notes}['CFSM_PURE_G_NOT_PCRE'] == 'warning'
    # plastic: undefined weak-axis normalization is a warning; the fibre model an assumption
    p = pmm_plastic(*_flat(6.0, 0.25, 10), 50.0)
    assert p['warnings'] and p['assumptions'] and p['scope_notes']
    p = pmm_plastic(*_sec('isect', H=8.0, B=4.0, t=0.1), 50.0)
    assert p['warnings'] == [] and p['assumptions']
    # fcFSM: "not fcFSM" is an always-true scope note, not a per-run warning
    f = stripmain_fcfsm(PROP, cnode, celem, np.array([7.02]), 'S-S', [np.array([1.0])], neigs=1)
    assert FCFSM_WARNING in f['scope_notes'] and FCFSM_WARNING not in f['warnings']
    assert f['warnings'] == [] and len(f['assumptions']) == 1
    # notices are JSON text: the token NaN must not appear in them (server test R8-25 scans raw bytes)
    texts = (p['warnings'] + p['assumptions'] + p['scope_notes'] + f['scope_notes'] +
             cl.warnings + cl.scope_notes + r['warnings'] + list(pmm_plastic(
                 *_flat(6.0, 0.25, 10), 50.0)['warnings']))
    assert texts and not any('NaN' in t for t in texts)
