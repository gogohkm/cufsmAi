"""2026-11-22 엔진 리뷰 R1 (FSM 코어) 회귀 시험.

기대값은 닫힌 해(판 좌굴계수, 오일러, 횡비틀림, 휨비틀림, 탄성지반 · 이산 스프링)나
독립 경로(S-S 서명 곡선, 구속 없는 연속판)에서 시험 안에서 따로 계산한다.
단면은 template.py 에 기대지 않고 이 파일에서 직접 만든다(중심선 모델).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'python'))

import math

import numpy as np
from scipy import sparse

from engine.fsm_solver import stripmain
from models.data import GBTConfig

E = 29500.0
NU = 0.3
G = E / (2 * (1 + NU))
PROP = np.array([[100, E, E, NU, NU, G]])


# ----------------------------------------------------------------- helpers
def _run(node, elem, lengths, BC='S-S', m_all=None, springs=None,
         constraints=None, neigs=3):
    lengths = np.atleast_1d(np.asarray(lengths, dtype=float))
    if m_all is None:
        m_all = [np.array([1.0]) for _ in lengths]
    return stripmain(PROP, node, elem, lengths,
                     np.array([]) if springs is None else springs,
                     np.array([]) if constraints is None else constraints,
                     GBTConfig(), BC, m_all, neigs)


def _lf(res, i=0, k=1):
    row = np.asarray(res.curve[i]).reshape(-1)
    return float(row[k]) if len(row) > k else float('nan')


def _codes(res, severity=None):
    return [d['code'] for d in res.diagnostics
            if severity is None or d.get('severity') == severity]


def _raises(fn, exc=ValueError):
    try:
        fn()
    except exc:
        return True
    raise AssertionError(f'{exc.__name__} expected')


def _polyline(pts, t, stress=None):
    n = len(pts)
    node = np.zeros((n, 8))
    for i, (x, z) in enumerate(pts):
        node[i] = [i + 1, x, z, 1, 1, 1, 1, 1.0 if stress is None else stress[i]]
    elem = np.array([[i + 1, i + 1, i + 2, t, 100] for i in range(n - 1)], dtype=float)
    return node, elem


def _plate(b=10.0, t=0.1, nel=20, stress_fn=None):
    """세로 판 (z 방향 폭 b). 양 가장자리 면외(전역 x) 고정 = 단순지지."""
    pts = [(0.0, b * i / nel) for i in range(nel + 1)]
    z = np.array([p[1] for p in pts])
    st = np.ones(nel + 1) if stress_fn is None else stress_fn(z)
    node, elem = _polyline(pts, t, st)
    node[0, 3] = 0
    node[-1, 3] = 0
    return node, elem


def _plate_unit(b, t):
    return math.pi ** 2 * E / (12 * (1 - NU ** 2)) * (t / b) ** 2


def _tube(a=4.0, t=0.1, nper=4):
    """정사각관 (중심선 한 변 a). 닫힌 해용 A, I (얇은 벽)."""
    corners = [(-a / 2, -a / 2), (a / 2, -a / 2), (a / 2, a / 2), (-a / 2, a / 2)]
    pts = []
    for k in range(4):
        x0, z0 = corners[k]
        x1, z1 = corners[(k + 1) % 4]
        for i in range(nper):
            pts.append((x0 + (x1 - x0) * i / nper, z0 + (z1 - z0) * i / nper))
    n = len(pts)
    node = np.zeros((n, 8))
    for i, (x, z) in enumerate(pts):
        node[i] = [i + 1, x, z, 1, 1, 1, 1, 1.0]
    elem = np.array([[i + 1, i + 1, (i + 1) % n + 1, t, 100] for i in range(n)], dtype=float)
    Ig = (2.0 / 3.0) * t * a ** 3 + 2 * a * t ** 3 / 12
    A = 4 * a * t
    return node, elem, A, Ig


def _lipped_c(H=6.0, B=2.5, D=0.75, t=0.06):
    """중심선 립 C형강 (웨브 x=0, 플랜지 +x 쪽, 립은 안쪽). 20 요소."""
    pts = []
    pts += [(B, H / 2 - D + D * i / 2) for i in range(2)]          # 위 립 (아래 → 위)
    pts += [(B - B * i / 4, H / 2) for i in range(4)]               # 위 플랜지
    pts += [(0.0, H / 2 - H * i / 8) for i in range(8)]             # 웨브
    pts += [(B * i / 4, -H / 2) for i in range(4)]                  # 아래 플랜지
    pts += [(B, -H / 2 + D * i / 2) for i in range(3)]              # 아래 립
    return _polyline(pts, t)


def _isection(h=8.0, bf=4.0, t=0.1, nw=8, nf=4):
    nodes, elems = [], []

    def add(x, z):
        nodes.append((x, z))
        return len(nodes)
    xs = np.linspace(-bf / 2, bf / 2, nf + 1)
    bl = [add(x, -h / 2) for x in xs]
    elems += [(bl[i], bl[i + 1]) for i in range(nf)]
    prev = bl[nf // 2]
    for z in np.linspace(-h / 2, h / 2, nw + 1)[1:-1]:
        k = add(0.0, z)
        elems.append((prev, k))
        prev = k
    tl = [add(x, h / 2) for x in xs]
    elems.append((prev, tl[nf // 2]))
    elems += [(tl[i], tl[i + 1]) for i in range(nf)]
    node = np.zeros((len(nodes), 8))
    for i, (x, z) in enumerate(nodes):
        node[i] = [i + 1, x, z, 1, 1, 1, 1, 1.0]
    elem = np.array([[i + 1, e[0], e[1], t, 100] for i, e in enumerate(elems)], dtype=float)
    p = dict(A=(2 * bf + h) * t,
             Ix=t * h ** 3 / 12 + 2 * bf * t * (h / 2) ** 2,
             Iy=2 * t * bf ** 3 / 12 + h * t ** 3 / 12,
             J=(2 * bf + h) * t ** 3 / 3,
             Cw=(t * bf ** 3 / 12) * h ** 2 / 2)
    return node, elem, p


def _hat_sharp(t=0.06):
    """날카로운 모서리 햇 (브림 2 · 웨브 2 · 상판)."""
    pts = [(-2.0, 0.0), (-1.5, 0.0), (-1.0, 0.0), (-1.0, 1.5), (-1.0, 3.0), (0.0, 3.0),
           (1.0, 3.0), (1.0, 1.5), (1.0, 0.0), (1.5, 0.0), (2.0, 0.0)]
    return _polyline(pts, t)


def _angle_sharp(b=2.0, t=0.0346):
    return _polyline([(0.0, b), (0.0, b / 2), (0.0, 0.0), (b / 2, 0.0), (b, 0.0)], t)


def _rounded_c(H=8.0, B=2.5, D=0.625, t=0.059, r=0.1875, narc=3):
    """모서리마다 반지름 r 의 호(요소 narc 개)를 둔 립 C형강 중심선."""
    corners = [(B, H / 2 - D), (B, H / 2), (0.0, H / 2), (0.0, -H / 2), (B, -H / 2),
               (B, -H / 2 + D)]
    pts = [corners[0]]

    def straight(to):
        prev = np.array(pts[-1])
        nseg = max(1, int(round(np.linalg.norm(to - prev) / 0.75)))
        for i in range(1, nseg + 1):
            pts.append(tuple(prev + (to - prev) * i / nseg))
    for k in range(1, len(corners) - 1):
        p0, p1, p2 = (np.array(c) for c in corners[k - 1:k + 2])
        u1 = (p0 - p1) / np.linalg.norm(p0 - p1)
        u2 = (p2 - p1) / np.linalg.norm(p2 - p1)
        a, b, c = p1 + r * u1, p1 + r * u2, p1 + r * u1 + r * u2
        straight(a)
        th0 = math.atan2(a[1] - c[1], a[0] - c[0])
        th1 = math.atan2(b[1] - c[1], b[0] - c[0])
        dth = (th1 - th0 + math.pi) % (2 * math.pi) - math.pi
        for i in range(1, narc + 1):
            th = th0 + dth * i / narc
            pts.append((c[0] + r * math.cos(th), c[1] + r * math.sin(th)))
    straight(np.array(corners[-1]))
    return _polyline(pts, t)


def _open_section_props(node, elem):
    """단일 가지 열린 얇은 단면의 A, 도심 주축 I, 전단중심, J, Cw (시험용 독립 계산).

    요소마다 x, z, ω 가 선형이므로 Simpson 적분이 정확하다.
    ω 는 도심 극에 대한 부채꼴 좌표 dω = x dz − z dx, 전단중심은
    ∫ω_P x dA = ∫ω_P z dA = 0 을 풀어 구한다.
    """
    xy = node[:, 1:3]
    segs = [(int(e[1]) - 1, int(e[2]) - 1, e[3]) for e in elem]
    A = sum(t * np.hypot(*(xy[j] - xy[i])) for i, j, t in segs)
    xc = sum(t * np.hypot(*(xy[j] - xy[i])) * (xy[i, 0] + xy[j, 0]) / 2 for i, j, t in segs) / A
    zc = sum(t * np.hypot(*(xy[j] - xy[i])) * (xy[i, 1] + xy[j, 1]) / 2 for i, j, t in segs) / A
    X = xy[:, 0] - xc
    Z = xy[:, 1] - zc
    w = np.zeros(len(xy))
    for i, j, _ in segs:            # 요소가 경로 순서로 이어져 있다
        w[j] = w[i] + X[i] * Z[j] - X[j] * Z[i]

    def integ(f):
        s = 0.0
        for i, j, t in segs:
            L = np.hypot(*(xy[j] - xy[i]))
            fi, fj, fm = f(i), f(j), None
            fm = f((i, j))
            s += t * L / 6 * (fi + 4 * fm + fj)
        return s

    def at(arr):
        return lambda k: (arr[k[0]] + arr[k[1]]) / 2 if isinstance(k, tuple) else arr[k]

    def prod(a, b):
        fa, fb = at(a), at(b)
        return lambda k: fa(k) * fb(k)
    Ixx = integ(prod(Z, Z))
    Izz = integ(prod(X, X))
    Ixz = integ(prod(X, Z))
    Iwx = integ(prod(w, X))
    Iwz = integ(prod(w, Z))
    s0 = segs[0][0]
    # ω_P = ω − xP (z − z0) + zP (x − x0)
    M = np.array([[-Ixz, Izz], [-Ixx, Ixz]])
    xP, zP = np.linalg.solve(M, [-Iwx, -Iwz])
    wP = w - xP * (Z - Z[s0]) + zP * (X - X[s0])
    wn = wP - integ(at(wP)) / A
    Cw = integ(prod(wn, wn))
    J = sum(np.hypot(*(xy[j] - xy[i])) * t ** 3 / 3 for i, j, t in segs)
    return dict(A=A, Ixx=Ixx, Izz=Izz, Ixz=Ixz, xo=xP, zo=zP, J=J, Cw=Cw, zc=zc, xc=xc)


# ----------------------------------------------------------------- R1-01
def test_R1_01_euler_tube_all_bc_converges_with_terms():
    """R1-01: 정사각관 4×4×0.1, L=400 — BC 별 오일러 닫힌 해(유효길이계수).

    C-C 4Pe, C-F 0.25Pe, C-G Pe, S-C 2.0457Pe. 2.0457 = (4.4934/π)², tan(kL) = kL 의 첫 근.
    (1) m_recommend 항(낮은 항 1..7 + 국부 · 뒤틀림 창)으로 푼 값이 상한 안 — C-C 1.02,
        C-F 1.008, C-G 1.015, S-C 1.07 (측정 1.017 · 1.006 · 1.012 · 1.063. MATLAB 의
        낮은 항 1..3 이면 1.034 · 1.007 · 1.026 · 1.127 로 C-C · C-G · S-C 가 상한을 넘는다).
        m=[1] 은 네 BC 모두 이 상한을 넘는다(1.061 · 1.083 · 1.065 · 1.263).
    (2) m=1..15 이면 C-C · C-F · C-G ±1 %, S-C ±3.5 % (리뷰어 1.008 · 1.007 · 1.006 · 1.031).
    """
    from engine.helpers import m_recommend_details
    node, elem, A, Ig = _tube()
    L = 400.0
    sig_e = math.pi ** 2 * E * Ig / (A * L ** 2)
    det = m_recommend_details(PROP, node, elem, [L])
    m15 = [np.arange(1, 16.0)]
    assert set(range(1, 8)) <= set(det['m_all'][0].astype(int))
    for BC, f, rec_max, tol15 in (('C-C', 4.0, 1.02, 0.01), ('C-F', 0.25, 1.008, 0.01),
                                  ('C-G', 1.0, 1.015, 0.01), ('S-C', 2.0457, 1.07, 0.035)):
        r = _run(node, elem, [L], BC, m_all=det['m_all'], neigs=1)
        ratio = _lf(r) / (f * sig_e)
        assert 0.999 < ratio < rec_max, (BC, ratio)
        r1 = _run(node, elem, [L], BC, neigs=1)
        assert _lf(r1) / (f * sig_e) > rec_max, (BC, _lf(r1) / (f * sig_e))
        r = _run(node, elem, [L], BC, m_all=m15, neigs=1)
        ratio = _lf(r) / (f * sig_e)
        assert 0.999 < ratio < 1 + tol15, (BC, ratio)


def test_R1_01_non_ss_single_term_warns():
    """R1-01: S-S 가 아닌 BC 에 m=[1] 이면 INSUFFICIENT_LONGITUDINAL_TERMS 경고(m_all 은 그대로)."""
    node, elem = _lipped_c()
    r = _run(node, elem, [100.0], 'C-C')
    assert 'INSUFFICIENT_LONGITUDINAL_TERMS' in _codes(r, 'warning')
    assert r.to_dict()['success'] is True       # 경고이지 실패가 아니다
    assert [m.tolist() for m in r.m_all] == [[1.0]]
    r_ss = _run(node, elem, [100.0], 'S-S')
    assert 'INSUFFICIENT_LONGITUDINAL_TERMS' not in _codes(r_ss)


def test_R1_01_m_recommend_lipped_c_clamped_finds_local():
    """R1-01: 립 C형강 L=100 C-C — m_recommend 항이면 국부좌굴을 찾는다.

    긴 부재(반파 20 개 이상)의 국부좌굴 하중은 단부 조건과 거의 무관하므로 기대값은
    S-S 서명 곡선의 국부 극소(독립 경로)다. ±1 %. m=[1] 은 그 5 배 가까이 나온다
    (리뷰어 75.68 vs 15.11).
    """
    from engine.helpers import m_recommend_details, recommended_terms
    node, elem = _lipped_c()
    det = m_recommend_details(PROP, node, elem, [100.0])
    assert det['method'] == 'signature'
    Lcrl, Lcrd = det['Lcrl'], det['Lcrd']
    assert 3.0 < Lcrl < 7.0 and 15.0 < Lcrd < 40.0, (Lcrl, Lcrd)
    m_a = det['m_all'][0]
    assert np.array_equal(m_a, recommended_terms(100.0, Lcrl, Lcrd))
    assert set(range(1, 8)) <= set(m_a.astype(int))
    c = math.ceil(100.0 / Lcrl)
    assert set(range(c - 3, c + 4)) <= set(m_a.astype(int))

    # S-S 국부 극소 (서명 곡선 극소 근처를 촘촘히)
    Ls = np.linspace(0.8 * Lcrl, 1.2 * Lcrl, 9)
    rs = _run(node, elem, Ls, 'S-S', neigs=1)
    local_min = min(_lf(rs, i) for i in range(len(Ls)))

    r = _run(node, elem, [100.0], 'C-C', m_all=det['m_all'], neigs=1)
    assert 'INSUFFICIENT_LONGITUDINAL_TERMS' not in _codes(r)
    assert abs(_lf(r) / local_min - 1) < 0.01, (_lf(r), local_min)
    r1 = _run(node, elem, [100.0], 'C-C', neigs=1)
    assert _lf(r1) > 3 * local_min


def test_R1_01_recommended_terms_lcrd_typo():
    """R1-01: m_recommend.m:101 의 ceil(a/Lcrl)+3 은 ceil(a/Lcrd)+3 으로 고쳐 쓴다."""
    from engine.helpers import recommended_terms
    t = set(recommended_terms(100.0, 4.0, 10.0).astype(int))
    # 낮은 항 1..7 (MATLAB 1..3 을 넓힘) + 국부 22..28 + 뒤틀림 7..13 (…+3 이 Lcrd)
    assert t == set(range(1, 8)) | set(range(22, 29)) | set(range(7, 14))
    t = set(recommended_terms(10.0, 4.0, 10.0).astype(int))
    assert t == set(range(1, 8))
    t = set(recommended_terms(100.0, None, None).astype(int))
    assert t == set(range(1, 8))
    t = set(recommended_terms(100.0, 4.0, 10.0, extra=(50.0 / 3,)).astype(int))
    assert set(range(3, 10)) <= t


def test_R1_01_m_recommend_other_branches():
    """R1-01 · V1-05: m_recommend 의 다른 경로.

    - 날카로운 햇(서명 곡선 극소 1 개, 고전 cFSM 성립) → 'cfsm'. 서명 곡선 극소 근처 항도 넣는다.
    - 둥근 모서리 립 C(극소 1 개) → cFSM 을 쓰지 않고 'signature_fallback' (cfsm_check ROUNDED_CORNER).
      국부 반파장은 서명 곡선 극소 = 같은 단면 S-S 국부 극소와 같다.
    - I형강(가지 단면) → 'signature_fallback' (BRANCHED_SECTION).
    - 날카로운 2×2 앵글 압축(극소 없음) → 오류 대신 'no_minimum', 항 1..7, 경고.
    """
    from engine.helpers import m_recommend_details
    a = 100.0
    det = m_recommend_details(PROP, *_hat_sharp(), [a])
    assert det['method'] == 'cfsm', det['method']
    assert det['Lcrl'] < det['Lcrd']
    terms = set(det['m_all'][0].astype(int))
    for Lcr in [det['Lcrl'], det['Lcrd']] + det['minima']:
        c = math.ceil(a / Lcr)
        assert (set(range(c - 3, c + 4)) if c > 4 else set(range(1, 8))) <= terms

    nR, eR = _rounded_c()
    det = m_recommend_details(PROP, nR, eR, [a])
    assert det['method'] == 'signature_fallback' and det['cfsm_check'] == 'ROUNDED_CORNER'
    assert len(det['minima']) == 1 and det['Lcrl'] == det['minima'][0]
    assert any('cFSM' in w for w in det['warnings'])
    c = math.ceil(a / det['Lcrl'])
    assert set(range(c - 3, c + 4)) | set(range(1, 8)) <= set(det['m_all'][0].astype(int))

    node, elem, _ = _isection()
    det = m_recommend_details(PROP, node, elem, [a])
    assert det['method'] == 'signature_fallback' and det['cfsm_check'] == 'BRANCHED_SECTION'

    det = m_recommend_details(PROP, *_angle_sharp(), [a, 300.0])
    assert det['method'] == 'no_minimum' and det['Lcrl'] is None and det['Lcrd'] is None
    assert [m.astype(int).tolist() for m in det['m_all']] == [list(range(1, 8))] * 2
    assert det['warnings']


def test_R1_01_precomputed_half_wavelengths_skip_recomputation():
    """W1: stripmain(half_wavelengths=m_recommend_details 결과) 는 서명 곡선을 다시 풀지 않고,
    같은 진단을 낸다. characteristic_half_wavelengths 는 같은 모델을 캐시한다."""
    import engine.helpers as H
    node, elem = _lipped_c()
    node = node.copy()
    node[:, 7] = 1.0 + 1e-3 * np.arange(node.shape[0])   # 이 시험만의 모델(캐시 비우기 대신)
    calls = {'n': 0}
    orig = H.signature_ss

    def spy(*args, **kw):
        calls['n'] += 1
        return orig(*args, **kw)
    H.signature_ss = spy
    try:
        det = H.m_recommend_details(PROP, node, elem, [100.0, 200.0])
        n_first = calls['n']
        assert n_first >= 1
        m_all = [det['m_all'][0], np.arange(1, 16.0)]       # 둘째 길이는 일부러 부족하게
        r = stripmain(PROP, node, elem, np.array([100.0, 200.0]), np.array([]), np.array([]),
                      GBTConfig(), 'C-C', m_all, 1, half_wavelengths=det)
        assert calls['n'] == n_first
        r2 = _run(node, elem, [100.0, 200.0], 'C-C', m_all=m_all, neigs=1)   # 캐시 경로
        assert calls['n'] == n_first
    finally:
        H.signature_ss = orig
    d1 = [(d['length_index'], d.get('missing_terms')) for d in r.diagnostics
          if d['code'] == 'INSUFFICIENT_LONGITUDINAL_TERMS']
    d2 = [(d['length_index'], d.get('missing_terms')) for d in r2.diagnostics
          if d['code'] == 'INSUFFICIENT_LONGITUDINAL_TERMS']
    assert d1 == d2 and [i for i, _ in d1] == [1]
    _raises(lambda: stripmain(PROP, node, elem, np.array([100.0]), np.array([]), np.array([]),
                              GBTConfig(), 'C-C', [np.arange(1, 16.0)], 1,
                              half_wavelengths={'Lcrl': 4.0}))


# ----------------------------------------------------------------- R1-02
def test_R1_02_msort_duplicate_zero_unsorted_terms():
    """R1-02: stripmain 이 msort 를 적용 — [1,1] · [0,1] 은 [1] 과 같고, [2,1] 은 [1,2] 와 같다."""
    node, elem = _lipped_c()
    ref = _run(node, elem, [10.0])
    for m in ([1.0, 1.0], [0.0, 1.0]):
        r = _run(node, elem, [10.0], m_all=[np.array(m)])
        assert abs(_lf(r) / _lf(ref) - 1) < 1e-9, (m, _lf(r), _lf(ref))
        assert 'LONGITUDINAL_TERMS_SORTED' in _codes(r, 'info')
        assert r.to_dict()['success'] is True
    r21 = _run(node, elem, [100.0], 'C-C', m_all=[np.array([2.0, 1.0])])
    r12 = _run(node, elem, [100.0], 'C-C', m_all=[np.array([1.0, 2.0])])
    assert np.allclose(r21.curve[0], r12.curve[0], rtol=1e-10)
    assert r21.m_all[0].tolist() == [1.0, 2.0]
    s21, s12 = r21.shapes[0], r12.shapes[0]
    assert np.allclose(s21, s12, atol=1e-8)


# ----------------------------------------------------------------- R1-03
def test_R1_03_very_long_length_is_flagged_not_returned():
    """R1-03: 립 C형강 L=5e4 는 ILL_CONDITIONED 오류로 버리고, L=1000 은 경고 없이 약축 오일러 ±0.5 %."""
    node, elem = _lipped_c()
    p = _open_section_props(node, elem)
    r = _run(node, elem, [1000.0, 5e4])
    errs = [d for d in r.diagnostics if d['code'] == 'ILL_CONDITIONED']
    assert [d['length_index'] for d in errs if d['severity'] == 'error'] == [1]
    assert all(d['length_index'] == 1 for d in errs)
    assert _lf(r, 1) == 0.0
    assert r.to_dict()['success'] is False
    Imin = min(np.linalg.eigvalsh([[p['Ixx'], p['Ixz']], [p['Ixz'], p['Izz']]]))
    sez = math.pi ** 2 * E * Imin / (p['A'] * 1000.0 ** 2)
    assert abs(_lf(r, 0) / sez - 1) < 0.005, _lf(r, 0) / sez


def test_R1_03_garbage_at_long_length_never_success():
    """R1-03: 여러 단면 · 길이에서 오일러의 10 배 같은 값이 성공으로 나오지 않는다."""
    node, elem, A, Ig = _tube(6.0, 0.1, 6)
    Ls = [400.0, 2e4, 5e4, 1e5]
    r = _run(node, elem, Ls)
    errs = {d['length_index'] for d in r.diagnostics
            if d['code'] == 'ILL_CONDITIONED' and d['severity'] == 'error'}
    # 같은 실행의 보통 길이는 진단 없이 오일러 ±0.5 %
    assert 0 not in errs and not [d for d in r.diagnostics if d['length_index'] == 0]
    assert abs(_lf(r, 0) / (math.pi ** 2 * E * Ig / (A * 400.0 ** 2)) - 1) < 0.005
    for i, L in enumerate(Ls[1:], start=1):
        sig_e = math.pi ** 2 * E * Ig / (A * L ** 2)
        if i in errs:
            assert _lf(r, i) == 0.0
        else:
            assert abs(_lf(r, i) / sig_e - 1) < 0.05, (L, _lf(r, i) / sig_e)


def test_R1_03_stiff_spring_not_flagged():
    """V1-01: 큰 접지 스프링(1e14, '고정' 흉내)은 대각에만 큰 값을 더할 뿐이라 결과가 정확하다.
    대각 스케일 추정이므로 ILL_CONDITIONED 가 나지 않고, 값은 같은 절점을 DOF 플래그로
    고정한 정확한 구속해와 1e-6 안에서 같다."""
    node, elem = _lipped_c()
    fixed = node.copy()
    fixed[0, 3] = 0           # dofx
    fixed[0, 4] = 0           # dofz
    ref = _run(fixed, elem, [100.0, 300.0], neigs=1)
    for k in (1e12, 1e14):
        sp = np.array([[1, 1, 0, k, 0, k, 0, 0, 0, 0]], dtype=float)
        r = _run(node, elem, [100.0, 300.0], springs=sp, neigs=1)
        assert 'ILL_CONDITIONED' not in _codes(r), r.diagnostics
        for i in range(2):
            assert abs(_lf(r, i) / _lf(ref, i) - 1) < 1e-6, (k, i, _lf(r, i), _lf(ref, i))


# ----------------------------------------------------------------- R1-04
def test_R1_04_dense_assembly_matches_block_assembly():
    """R1-04: 색인 한 번 조립(dense)이 원래의 2×2 블록 조립(lil)과 같다 (max|ΔK|/max|K| < 1e-14)."""
    from engine.assembly import assemble, spring_assemble
    from engine.element import klocal, kglocal, spring_klocal
    from engine.properties import elemprop
    from engine.transform import trans, spring_trans
    # lil 블록 조립이 느려서 작은 꺾인 단면(9 절점)으로 본다
    node, elem = _polyline([(2.0, 2.5), (2.0, 3.0), (1.0, 3.0), (0.0, 3.0), (0.0, 1.0),
                            (0.0, -1.0), (0.3, -2.9), (1.5, -3.2), (2.0, -2.6)], 0.06)
    node[:, 7] = np.linspace(1.0, -0.5, node.shape[0])
    nn = node.shape[0]
    ep = elemprop(node, elem)
    a = 37.0
    for BC in ('S-S', 'C-C', 'S-C', 'C-F', 'C-G'):
        for M in ((1, 3, 5) if BC == 'C-F' else (1, 3)):
            m_a = np.arange(1, M + 1.0)
            nd = 4 * nn * M
            Ks, Kgs = sparse.lil_matrix((nd, nd)), sparse.lil_matrix((nd, nd))
            Kd, Kgd = np.zeros((nd, nd)), np.zeros((nd, nd))
            for e in range(elem.shape[0]):
                ni, nj, t = int(elem[e, 1]), int(elem[e, 2]), elem[e, 3]
                k = klocal(E, E, NU, NU, G, t, a, ep[e, 1], BC, m_a)
                kg = kglocal(a, ep[e, 1], node[ni - 1, 7] * t, node[nj - 1, 7] * t, BC, m_a)
                k, kg = trans(ep[e, 2], k, kg, m_a)
                Ks, Kgs = assemble(Ks, Kgs, k, kg, ni, nj, nn, m_a)
                Kd, Kgd = assemble(Kd, Kgd, k, kg, ni, nj, nn, m_a)
            for sni, snj, disc in ((3, 0, 0), (5, 9, 1), (7, 7, 0)):
                ks = spring_trans(0.4, spring_klocal(1.0, 2.0, 3.0, 4.0, a, BC, m_a,
                                                     bool(disc), 0.3), m_a)
                Ks = spring_assemble(Ks, ks, sni, snj, nn, m_a)
                Kd = spring_assemble(Kd, ks, sni, snj, nn, m_a)
            Ks, Kgs = Ks.toarray(), Kgs.toarray()
            assert np.max(np.abs(Kd - Ks)) / np.max(np.abs(Ks)) < 1e-14, (BC, M)
            assert np.max(np.abs(Kgd - Kgs)) / np.max(np.abs(Kgs)) < 1e-14, (BC, M)


def test_R1_04_multi_term_uses_fast_paths():
    """R1-04: 다항 해석이 dense 색인 조립과 부분 대칭 정부호 고유치 풀이(eigh subset)를 탄다.
    벽시계 대신 경로를 센다: lil 블록 조립 0 회, 전 고유치 QZ 0 회. 값은 m=1..10 C-C 의
    국부좌굴 ≈ S-S 국부 극소 (±2 %, 반파 20 개 이상이면 단부 조건과 거의 무관)."""
    import engine.fsm_solver as F
    node, elem = _lipped_c()
    seen = {'dense': 0, 'other': 0, 'qz': 0}
    orig_asm, orig_qz = F.assemble, F._solve_eigenproblem

    def asm(K, Kg, *args):
        seen['dense' if isinstance(K, np.ndarray) and isinstance(Kg, np.ndarray)
             else 'other'] += 1
        return orig_asm(K, Kg, *args)

    def qz(*args):
        seen['qz'] += 1
        return orig_qz(*args)
    F.assemble, F._solve_eigenproblem = asm, qz
    try:
        r = _run(node, elem, [100.0], 'C-C', m_all=[np.arange(1, 26.0)], neigs=1)
    finally:
        F.assemble, F._solve_eigenproblem = orig_asm, orig_qz
    assert seen == {'dense': elem.shape[0], 'other': 0, 'qz': 0}, seen
    Ls = np.linspace(3.5, 6.0, 11)
    rs = _run(node, elem, Ls, neigs=1)
    local_min = min(_lf(rs, i) for i in range(len(Ls)))
    assert abs(_lf(r) / local_min - 1) < 0.02, (_lf(r), local_min)


# ----------------------------------------------------------------- R1-05
def test_R1_05_signature_ss_rpc_works():
    """R1-05: 서버 signature_ss RPC 가 ImportError 없이 100 점 곡선을 돌려준다."""
    from server import handle_request
    node, elem, _, _ = _tube()
    resp = handle_request({'id': 1, 'method': 'signature_ss', 'params': {
        'prop': PROP.tolist(), 'node': node.tolist(), 'elem': elem.tolist(),
        'lengths': [10.0], 'm_all': [[1.0]], 'BC': 'S-S'}})
    assert 'error' not in resp, resp.get('error')
    assert len(resp['result']['curve']) == 100
    assert len(resp['result']['lengths']) == 100


# ----------------------------------------------------------------- R1-06
def test_R1_06_one_dimensional_spring_not_dropped():
    """R1-06: 스프링 하나를 1차원 (10,) 으로 줘도 (1,10) 과 같은 고유치. 열 수 · 절점 오류는 ValueError."""
    node, elem = _lipped_c()
    row = [1, 11, 0, 10.0, 0, 10.0, 0, 0, 0, 0]
    r0 = _run(node, elem, [10.0])
    r1 = _run(node, elem, [10.0], springs=np.array(row, dtype=float))
    r2 = _run(node, elem, [10.0], springs=np.array([row], dtype=float))
    assert abs(_lf(r1) / _lf(r2) - 1) < 1e-10
    assert _lf(r1) > 1.5 * _lf(r0)            # 스프링이 실제로 들어갔다
    _raises(lambda: _run(node, elem, [10.0], springs=np.array([row[:8]], dtype=float)))
    bad = list(row)
    bad[1] = 99
    _raises(lambda: _run(node, elem, [10.0], springs=np.array([bad], dtype=float)))
    bad = list(row)
    bad[8], bad[9] = 1, 1.5
    _raises(lambda: _run(node, elem, [10.0], springs=np.array([bad], dtype=float)))


# ----------------------------------------------------------------- R1-07
def test_R1_07_master_slave_rows_match_matlab():
    """R1-07: master_slave 가 master_slave.m 처럼 u · w · θ 만 묶는다 (v 는 묶지 않음)."""
    from engine.helpers import master_slave
    node = np.array([[1, 0, 0, 1, 1, 1, 1, 0], [2, 3.0, 4.0, 1, 1, 1, 1, 0]], dtype=float)
    rows = master_slave(1, [2], node).tolist()
    expect = [[2, 1, 1.0, 1, 1], [2, 1, -4.0, 1, 4], [2, 2, 1.0, 1, 2],
              [2, 2, 3.0, 1, 4], [2, 4, 1.0, 1, 4]]
    assert len(rows) == len(expect)
    for r, e in zip(rows, expect):
        assert np.allclose(r, e), (r, e)


def test_R1_07_master_slave_ties_split_plate():
    """R1-07 · R1-10: 판 중간을 겹친 절점으로 나눈 뒤 묶으면 연속판 k=4.000 (±0.1 %)."""
    from engine.helpers import master_slave
    b, t = 10.0, 0.1
    pn, pe = _plate(b, t, 10)
    nn = pn.shape[0]
    pn2 = np.vstack([pn, pn[5]])
    pn2[-1, 0] = nn + 1
    pe2 = pe.copy()
    pe2[5, 1] = nn + 1
    unit = _plate_unit(b, t)
    k_untied = _lf(_run(pn2, pe2, [b])) / unit
    cons4 = np.array([[nn + 1, d, 1.0, 6, d] for d in (1, 2, 3, 4)], dtype=float)
    k_tied = _lf(_run(pn2, pe2, [b], constraints=cons4)) / unit
    k_ms = _lf(_run(pn2, pe2, [b], constraints=master_slave(6, [nn + 1], pn2))) / unit
    assert abs(k_tied / 4.0 - 1) < 0.001, k_tied
    assert abs(k_ms / 4.0 - 1) < 0.001, k_ms
    assert k_untied < 3.0, k_untied


# ----------------------------------------------------------------- R1-08
def test_R1_08_invalid_input_rejected():
    """R1-08: 잘못된 입력은 계산하지 않고 ValueError."""
    node, elem = _lipped_c()
    m1 = [np.array([1.0])]
    _raises(lambda: _run(node, elem, [10.0], 's-s'))
    _raises(lambda: _run(node, elem, [10.0], 'SS'))
    _raises(lambda: stripmain(PROP, node, elem, np.array([10.0]), np.array([]),
                              np.array([]), GBTConfig(), 'S-S', [], 10))
    _raises(lambda: _run(node, elem, [10.0, 20.0], m_all=m1))
    _raises(lambda: _run(node, elem, [10.0], m_all=m1 * 2))
    _raises(lambda: _run(node, elem, [0.0]))
    _raises(lambda: _run(node, elem, [-10.0]))
    _raises(lambda: _run(node, elem, [float('nan')]))
    _raises(lambda: _run(node, elem, [10.0], m_all=[np.array([1.5])]))
    _raises(lambda: _run(node, elem, [10.0], m_all=[np.array([-1.0])]))
    _raises(lambda: _run(node, elem, [10.0], m_all=[np.array([0.0])]))
    _raises(lambda: _run(node, elem, [10.0], neigs=0))
    e = elem.copy()
    e[0, 1] = 0
    _raises(lambda: _run(node, e, [10.0]))
    n2 = np.vstack([node, node[-1]])
    n2[-1, 0] = node.shape[0] + 1
    e2 = np.vstack([elem, [elem.shape[0] + 1, node.shape[0], node.shape[0] + 1, 0.06, 100]])
    _raises(lambda: _run(n2, e2, [10.0]))         # 폭 0 요소
    n3 = node.copy()
    n3[3, 7] = np.nan
    _raises(lambda: _run(n3, elem, [10.0]))
    _raises(lambda: _run(node, elem, [10.0],
                         constraints=np.array([[1, 5, 1.0, 2, 1]], dtype=float)))
    from engine.boundary import BC_I1_5
    _raises(lambda: BC_I1_5('CC', 1, 1, 10.0))


# ----------------------------------------------------------------- R1-09
def test_R1_09_mode_normalised_to_plus_one():
    """R1-09: 모드형상은 절댓값 최대 성분이 +1 (stripmain.m:386-389)."""
    node, elem = _lipped_c()
    r = _run(node, elem, [10.0, 300.0], neigs=4)
    for s in r.shapes:
        for j in range(s.shape[1]):
            v = s[:, j]
            assert abs(v[np.argmax(np.abs(v))] - 1.0) < 1e-12


def test_R1_09_firstyield_unsymm_consistent_with_stresgen():
    """R1-09: Z형강(Ixz≠0)에서 firstyield(unsymm=1) 의 Mxx_y 로 만든 stresgen(unsymm=1)
    응력장의 최대 |σ| 가 fy 와 같다."""
    from engine.helpers import firstyield
    from engine.properties import grosprop
    from engine.stress import stresgen
    pts = [(-2.5, 3.6), (-2.5, 4.0), (-1.25, 4.0), (0.0, 4.0), (0.0, 2.0), (0.0, 0.0),
           (0.0, -2.0), (0.0, -4.0), (1.25, -4.0), (2.5, -4.0), (2.5, -3.6)]
    node, elem = _polyline(pts, 0.06)
    gp = grosprop(node, elem)
    assert abs(gp['Ixz']) > 1e-3
    fy = 50.0
    y1 = firstyield(node, elem, fy, unsymm=1)
    n1 = stresgen(node.copy(), 0, y1['Mxx_y'], 0, 0, 0, gp['A'], gp['xcg'], gp['zcg'],
                  gp['Ixx'], gp['Izz'], gp['Ixz'], gp['thetap'], gp['I11'], gp['I22'], 1)
    assert abs(np.max(np.abs(n1[:, 7])) / fy - 1) < 1e-9
    y0 = firstyield(node, elem, fy)
    assert abs(y0['Mxx_y'] / y1['Mxx_y'] - 1) > 1e-3     # 기본값(unsymm=0)은 다른 값


def test_R1_09_orphan_node_uses_fallback_solver():
    """R1-09/R1-04: 연결되지 않은 절점(K 의 0 행)이 있으면 QZ 경로로 풀고, 그 값도
    오일러 닫힌 해 ±0.2 % (정사각관 L=400) · 짧은 길이에서는 eigh 경로 값과 같다."""
    import engine.fsm_solver as F
    node, elem, A, Ig = _tube()
    n2 = np.vstack([node, [node.shape[0] + 1, 50.0, 50.0, 1, 1, 1, 1, 1.0]])
    calls = {'qz': 0}
    orig = F._solve_eigenproblem

    def qz(*args):
        calls['qz'] += 1
        return orig(*args)
    F._solve_eigenproblem = qz
    try:
        r2 = _run(n2, elem, [10.0, 400.0], neigs=1)
        assert calls['qz'] == 2
        r1 = _run(node, elem, [10.0, 400.0], neigs=1)
        assert calls['qz'] == 2                      # 정상 모델은 eigh 경로
    finally:
        F._solve_eigenproblem = orig
    sig_e = math.pi ** 2 * E * Ig / (A * 400.0 ** 2)
    assert abs(_lf(r2, 1) / sig_e - 1) < 0.002, _lf(r2, 1) / sig_e
    assert abs(_lf(r2, 0) / _lf(r1, 0) - 1) < 1e-8


def test_R3_15_cfsm_constraint_warnings():
    """R3-15: G 공간만 고른 cFSM 구속해는 고전값 × 1/(1−ν²) (L=800 립 C, ±0.5 %) 이고
    CFSM_GLOBAL_ONLY 경고가 붙는다. 고전 cFSM 밖 모델(둥근 모서리)의 구속 해석에는
    CFSM_MODEL_NOT_SUPPORTED 경고. 구속 없는 해석에는 둘 다 없다."""
    from cfsm.node_utils import base_properties
    node, elem = _lipped_c()
    bp = base_properties(node, elem)
    ndm, nlm, nn = int(bp[7]), int(bp[8]), node.shape[0]
    g = GBTConfig(glob=np.ones(4), dist=np.zeros(ndm), local=np.zeros(nlm),
                  other=np.zeros(2 * (nn - 1)), orth=1, norm=0)
    rg = stripmain(PROP, node, elem, np.array([800.0]), np.array([]), np.array([]), g,
                   'S-S', [np.array([1.0])], 1)
    r0 = _run(node, elem, [800.0], neigs=1)
    assert 'CFSM_GLOBAL_ONLY' in _codes(rg, 'warning')
    assert 'CFSM_MODEL_NOT_SUPPORTED' not in _codes(rg)
    assert abs(_lf(rg) / _lf(r0) * (1 - NU ** 2) - 1) < 0.005, _lf(rg) / _lf(r0)
    assert not [c for c in _codes(r0) if c.startswith('CFSM_')]

    nR, eR = _rounded_c()
    bp = base_properties(nR, eR)
    ndm, nlm, nn = int(bp[7]), int(bp[8]), nR.shape[0]
    gd = GBTConfig(glob=np.zeros(4), dist=np.ones(ndm), local=np.zeros(nlm),
                   other=np.zeros(2 * (nn - 1)), orth=1, norm=0)
    rd = stripmain(PROP, nR, eR, np.array([20.0]), np.array([]), np.array([]), gd,
                   'S-S', [np.array([1.0])], 1)
    nsup = [d for d in rd.diagnostics if d['code'] == 'CFSM_MODEL_NOT_SUPPORTED']
    assert nsup and nsup[0]['cfsm_code'] == 'ROUNDED_CORNER'
    assert 'CFSM_GLOBAL_ONLY' not in _codes(rd)


# ----------------------------------------------------------------- R1-10
def test_R1_10_plate_buckling_coefficients():
    """R1-10: 4변 단순지지 판 — 균일압축 L=b 에서 k=4.000 (±0.1 %),
    ψ=0 최소 7.81 (EN 1993-1-5 표 4.1), ψ=−1 최소 23.9 (Timoshenko) ±0.5 %."""
    b, t = 10.0, 0.1
    unit = _plate_unit(b, t)
    node, elem = _plate(b, t, 20)
    assert abs(_lf(_run(node, elem, [b], neigs=1)) / unit / 4.0 - 1) < 0.001
    # 극소 위치: ψ=0 → L/b≈0.98, ψ=−1 → L/b≈0.67
    for psi, ref, Ls in ((0.0, 7.81, np.linspace(0.85, 1.1, 11) * b),
                         (-1.0, 23.9, np.linspace(0.57, 0.77, 11) * b)):
        node, elem = _plate(b, t, 20, lambda z, psi=psi: 1.0 + (psi - 1.0) * z / b)
        r = _run(node, elem, Ls, neigs=1)
        kmin = min(_lf(r, i) for i in range(len(Ls))) / unit
        assert abs(kmin / ref - 1) < 0.005, (psi, kmin)


def test_R1_10_euler_tube_ss():
    """R1-10: 정사각관 S-S L=400 — P/Pe = 1.0004 (±0.2 %); S-S 다항은 서로 분리된다."""
    node, elem, A, Ig = _tube()
    L = 400.0
    sig_e = math.pi ** 2 * E * Ig / (A * L ** 2)
    r1 = _run(node, elem, [L], neigs=1)
    assert abs(_lf(r1) / sig_e - 1) < 0.002
    r5 = _run(node, elem, [L], m_all=[np.arange(1, 6.0)], neigs=1)
    assert abs(_lf(r5) / _lf(r1) - 1) < 1e-8


def test_R1_10_isection_lateral_torsional():
    """R1-10: I형강 h8 × bf4 × t0.1 순수휨 L=400 — 횡비틀림 닫힌 해 ±1 % (리뷰어 1.0034 – 1.0040)."""
    node, elem, p = _isection()
    # 순수 강축 휨 M=1: σ = −M z / Ix (z>0 쪽 압축, FSM 은 압축을 양으로 둔다)
    node[:, 7] = node[:, 2] / p['Ix']
    L = 400.0
    Mcr = (math.pi / L) * math.sqrt(E * p['Iy'] * G * p['J']) * math.sqrt(
        1 + math.pi ** 2 * E * p['Cw'] / (G * p['J'] * L ** 2))
    r = _run(node, elem, [L], neigs=1)
    assert abs(_lf(r) / Mcr - 1) < 0.01, _lf(r) / Mcr


def test_R1_10_lipped_c_flexural_torsional():
    """R1-10: 립 C형강 L=200 균일압축 — lf1 = 휨비틀림(닫힌 해), lf2 = 약축 휨 ±0.5 %
    (리뷰어 FT 1.001, 약축 0.998). 단면 성질은 이 파일의 독립 부채꼴 적분."""
    node, elem = _lipped_c()
    p = _open_section_props(node, elem)
    assert abs(p['zo']) < 1e-9 and abs(p['Ixz']) < 1e-9
    L = 200.0
    A = p['A']
    r0sq = p['xo'] ** 2 + p['zo'] ** 2 + (p['Ixx'] + p['Izz']) / A
    beta = 1 - p['xo'] ** 2 / r0sq
    # 대칭축이 x(수평)이고 전단중심이 x 축 위에 있으므로 비틀림은 x 축에 대한 휨
    # (∫z² dA, 강축)과 연성되고, z 축에 대한 휨(∫x² dA, 약축)은 따로 논다 (AISI S100 C3.1.2.1)
    sex = math.pi ** 2 * E * p['Ixx'] / (A * L ** 2)
    sey = math.pi ** 2 * E * p['Izz'] / (A * L ** 2)
    st = (G * p['J'] + math.pi ** 2 * E * p['Cw'] / L ** 2) / (A * r0sq)
    sft = ((sex + st) - math.sqrt((sex + st) ** 2 - 4 * beta * sex * st)) / (2 * beta)
    r = _run(node, elem, [L], neigs=3)
    lfs = sorted([_lf(r, 0, 1), _lf(r, 0, 2)])
    expected = sorted([sft, sey])
    for got, ref in zip(lfs, expected):
        assert abs(got / ref - 1) < 0.005, (lfs, expected)


def test_R1_10_springs_closed_form():
    """R1-10: 정사각관 + x · z 스프링 — 탄성지반 β=Pe·π²/L² → 2Pe, 중앙 이산 K=Pe·π²/(2L) → 2Pe,
    L/4 → 1.5Pe (m=1 Rayleigh, ±0.1 %)."""
    node, elem, A, Ig = _tube()
    L = 400.0
    Pe = math.pi ** 2 * E * Ig / L ** 2

    def S(kx, kz, disc=0, ys=0.0):
        return np.array([[1, 3, 0, kx / 2, 0, 0, 0, 0, disc, ys],
                         [2, 11, 0, kx / 2, 0, 0, 0, 0, disc, ys],
                         [3, 7, 0, 0, 0, kz / 2, 0, 0, disc, ys],
                         [4, 15, 0, 0, 0, kz / 2, 0, 0, disc, ys]], dtype=float)
    beta = Pe * math.pi ** 2 / L ** 2
    P = _lf(_run(node, elem, [L], springs=S(beta, beta), neigs=1)) * A
    assert abs(P / (2 * Pe) - 1) < 0.001, P / Pe
    K = Pe * math.pi ** 2 / (2 * L)
    P = _lf(_run(node, elem, [L], springs=S(K, K, 1, 0.5), neigs=1)) * A
    assert abs(P / (2 * Pe) - 1) < 0.001, P / Pe
    P = _lf(_run(node, elem, [L], springs=S(K, K, 1, 0.25), neigs=1)) * A
    assert abs(P / (1.5 * Pe) - 1) < 0.001, P / Pe


def test_R1_10_plate_rotational_springs_clamped():
    """R1-10: 판 양 가장자리 회전 스프링 kq=1e6 → 고정단 판 k_min = 6.97 (L/b≈0.66), ±0.5 %."""
    b, t = 10.0, 0.1
    unit = _plate_unit(b, t)
    pn, pe = _plate(b, t, 20)
    sp = np.array([[1, 1, 0, 0, 0, 0, 1e6, 0, 0, 0], [2, 21, 0, 0, 0, 0, 1e6, 0, 0, 0]], dtype=float)
    Ls = np.linspace(0.58, 0.74, 9) * b
    r = _run(pn, pe, Ls, springs=sp, neigs=1)
    kmin = min(_lf(r, i) for i in range(len(Ls))) / unit
    assert abs(kmin / 6.97 - 1) < 0.005, kmin
