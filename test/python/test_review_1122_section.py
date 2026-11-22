"""2026-11-22 엔진 리뷰 R2 (단면 생성 · 단면 성질) + R3-09 (GBTConfig.is_active) 회귀 시험.

기대값은 AISI Cold-Formed Steel Design Manual 2017 Part I 표(Table I-1/I-2/I-3/I-4/I-6/I-8
인쇄값), 박벽 닫힌 해, 이 파일 안의 독립 박벽 적분기(_poly_props)로 정한다. 코드 출력을
베끼지 않는다. 표 대조 허용오차는 둥근 모서리 반영 후 측정한 오차(A · I · J ≤ 0.4 %,
xo ≤ 1.5 % — 표는 3 자리 인쇄값이고 AISI 는 xo · Cw 를 각진 모서리 근사로 계산한다)에
여유를 둔 값이다. Cw 는 표와 3 – 13 % 다르므로(AISI 각진 모서리 근사, Part I §3) 표 대신
r = 0 닫힌 해로 검사한다.
"""

import json
import math
import os
import sys

import numpy as np

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, 'python'))

from engine.template import generate_section  # noqa: E402
from engine.properties import grosprop  # noqa: E402
from engine.cutwp import cutwp_prop  # noqa: E402
from engine.cfs_centerline import (  # noqa: E402
    ColdFormedSection, make_c_section, make_z_section, make_hat_section,
    validate_section,
)
from models.data import GBTConfig, SafeJsonEncoder, CufsmModel  # noqa: E402

E = 29500.0
NU = 0.3
PROP = np.array([[100, E, E, NU, NU, E / (2 * (1 + NU))]])


# ---------------------------------------------------------------- helpers

def _raises(fn, *args, **kw):
    try:
        fn(*args, **kw)
    except ValueError as e:
        return str(e)
    raise AssertionError(f"{getattr(fn, '__name__', fn)} did not raise ValueError")


def _rel(a, b):
    return abs(a - b) / abs(b)


def _props(sec):
    g = grosprop(sec['node'], sec['elem'])
    c = cutwp_prop(sec['node'], sec['elem'])
    out = dict(g)
    for k in ('J', 'Cw', 'Xs', 'Zs'):
        out[k] = c[k]
    out['xo'] = c['Xs'] - g['xcg']
    out['zo'] = c['Zs'] - g['zcg']
    out['ro'] = math.sqrt((g['Ixx'] + g['Izz']) / g['A'] + out['xo'] ** 2 + out['zo'] ** 2)
    return out


def _span(sec):
    n = sec['node']
    return float(np.ptp(n[:, 1])), float(np.ptp(n[:, 2]))


def _poly_props(P, t):
    """독립 박벽 적분기 — 열린 꺾은선 하나(각진 모서리), 요소 선형 분포의 정확 적분."""
    segs = list(zip(P[:-1], P[1:]))
    A = sum(math.dist(a, b) * t for a, b in segs)
    xc = sum(math.dist(a, b) * t * (a[0] + b[0]) / 2 for a, b in segs) / A
    yc = sum(math.dist(a, b) * t * (a[1] + b[1]) / 2 for a, b in segs) / A
    Q = [(p[0] - xc, p[1] - yc) for p in P]

    def integ(f1, f2, g1, g2, L):
        return L * t * (f1 * g1 / 3 + f2 * g2 / 3 + (f1 * g2 + f2 * g1) / 6)

    Ix = Iy = Ixy = 0.0
    for a, b in zip(Q[:-1], Q[1:]):
        L = math.dist(a, b)
        Ix += integ(a[1], b[1], a[1], b[1], L)
        Iy += integ(a[0], b[0], a[0], b[0], L)
        Ixy += integ(a[0], b[0], a[1], b[1], L)
    w = [0.0]
    for a, b in zip(Q[:-1], Q[1:]):
        w.append(w[-1] + (a[0] * (b[1] - a[1]) - a[1] * (b[0] - a[0])))
    Iwx = Iwy = 0.0
    for i, (a, b) in enumerate(zip(Q[:-1], Q[1:])):
        L = math.dist(a, b)
        Iwx += integ(w[i], w[i + 1], a[0], b[0], L)
        Iwy += integ(w[i], w[i + 1], a[1], b[1], L)
    D = Ix * Iy - Ixy ** 2
    sx = (Iy * Iwy - Ixy * Iwx) / D
    sy = -(Ix * Iwx - Ixy * Iwy) / D
    ws = [w[i] - sx * Q[i][1] + sy * Q[i][0] for i in range(len(Q))]
    wm = sum(math.dist(a, b) * t * (ws[i] + ws[i + 1]) / 2
             for i, (a, b) in enumerate(zip(Q[:-1], Q[1:]))) / A
    wn = [x - wm for x in ws]
    Cw = sum(integ(wn[i], wn[i + 1], wn[i], wn[i + 1], math.dist(a, b))
             for i, (a, b) in enumerate(zip(Q[:-1], Q[1:])))
    J = sum(math.dist(a, b) * t ** 3 / 3 for a, b in segs)
    return dict(A=A, Ixx=Ix, Izz=Iy, Ixz=Ixy, xo=sx, zo=sy, Cw=Cw, J=J)


def _lipped_c_sharp(a, b, c, t):
    """AISI Manual Part I §3 중심선 식, 각진 모서리. a=웹, b=플랜지, c=립 중심선 길이."""
    A = t * (a + 2 * b + 2 * c)
    xbar = t * (b * b + 2 * b * c) / A
    Ix = t * (a ** 3 / 12 + 2 * b * (a / 2) ** 2 + 2 * (c ** 3 / 12 + c * (a / 2 - c / 2) ** 2))
    Iy = t * (a * xbar ** 2 + 2 * (b ** 3 / 12 + b * (b / 2 - xbar) ** 2) + 2 * c * (b - xbar) ** 2)
    m = b * t / (12 * Ix) * (6 * c * a ** 2 + 3 * b * a ** 2 - 8 * c ** 3)
    xo = -(m + xbar)
    J = t ** 3 / 3 * (a + 2 * b + 2 * c)
    Cw = (a ** 2 * b ** 2 * t / 12) * (2 * a ** 3 * b + 3 * a ** 2 * b ** 2 + 48 * c ** 4 + 112 * b * c ** 3
                                       + 8 * a * c ** 3 + 48 * a * b * c ** 2 + 12 * a ** 2 * c ** 2
                                       + 12 * a ** 2 * b * c + 6 * a ** 3 * c) \
        / (6 * a ** 2 * b + (a + 2 * c) ** 3 - 24 * a * c ** 2)
    return dict(A=A, Ixx=Ix, Izz=Iy, xo=xo, J=J, Cw=Cw)


def _plain_c_sharp(a, b, t):
    A = t * (a + 2 * b)
    xbar = b * b / (a + 2 * b)
    Ix = t * (a ** 3 / 12 + 2 * b * (a / 2) ** 2)
    Iy = t * (a * xbar ** 2 + 2 * (b ** 3 / 12 + b * (b / 2 - xbar) ** 2))
    xo = -(3 * b * b / (6 * b + a) + xbar)
    J = t ** 3 / 3 * (a + 2 * b)
    Cw = t * b ** 3 * a ** 2 / 12 * (3 * b + 2 * a) / (6 * b + a)
    return dict(A=A, Ixx=Ix, Izz=Iy, xo=xo, J=J, Cw=Cw)


def _check(p, ref, tol, keys=None, absval=()):
    for k in (keys or ref):
        v = abs(p[k]) if k in absval else p[k]
        assert _rel(v, ref[k]) <= tol, f"{k}: engine {v:.6g} vs ref {ref[k]:.6g} (tol {tol:.2%})"


def _local_min_bending(sec, lengths=(3.0, 4.0, 5.0, 6.0)):
    """순수 강축 휨(최외단 50 ksi), S-S, 국부 반파장 범위의 최소 1차 하중계수."""
    from engine.fsm_solver import stripmain
    from engine.stress import stresgen
    node, elem = sec['node'].copy(), sec['elem']
    g = grosprop(node, elem)
    c = max(g['zcg'] - node[:, 2].min(), node[:, 2].max() - g['zcg'])
    node = stresgen(node, P=0, Mxx=50 * g['Ixx'] / c, Mzz=0, M11=0, M22=0, A=g['A'],
                    xcg=g['xcg'], zcg=g['zcg'], Ixx=g['Ixx'], Izz=g['Izz'], Ixz=g['Ixz'],
                    thetap=g['thetap'], I11=g['I11'], I22=g['I22'])
    L = np.array(lengths)
    r = stripmain(PROP, node, elem, L, np.array([]), np.array([]), GBTConfig(), 'S-S',
                  [np.array([1.0]) for _ in L], neigs=1)
    return min(float(np.asarray(cv).reshape(-1)[1]) for cv in r.curve)


# 9CS2.5x059 외측 꼭짓점 (웹 x = B 오른쪽, 아래 립 끝에서 시작)
_H, _B, _D, _T, _R = 9.0, 2.5, 0.773, 0.059, 0.1875
_C_CORNERS = [(0, _D), (0, 0), (_B, 0), (_B, _H), (0, _H), (0, _H - _D)]


# ---------------------------------------------------------------- R2-01

def test_R2_01_custom_path_subdivides_flats_same_properties():
    """R2-01: 임의 단면 경로가 직선부를 나누고, 같은 단면의 템플릿과 성질이 같다."""
    cus = generate_section('custom', dict(outer_corners=_C_CORNERS, t=_T, R_inner=_R))
    tpl = generate_section('lippedc', dict(H=_H, B=_B, D=_D, t=_T, r=_R))
    assert len(cus['elem']) >= 30, len(cus['elem'])   # 예전 21 (직선부당 1 개)
    L = np.hypot(np.diff(cus['node'][:, 1]), np.diff(cus['node'][:, 2]))
    assert L.max() < 8.5 / 7, L.max()                  # 웹 8.5 in 가 1 요소이던 결함
    pc, pt = _props(cus), _props(tpl)
    for k in ('A', 'Ixx', 'Izz', 'J', 'Cw'):
        assert _rel(pc[k], pt[k]) < 1e-6, (k, pc[k], pt[k])
    # custom 꼭짓점은 템플릿의 좌우 거울상(웹이 오른쪽)이라 xo 부호만 반대다
    assert _rel(abs(pc['xo']), abs(pt['xo'])) < 1e-6
    # 두 경로 모두 AISI Table I-1 9CS2.5x059 와 맞는다
    _check(pc, dict(A=0.881, Ixx=10.3, Izz=0.698, J=0.00102), 0.005)
    assert _rel(abs(pc['xo']), 1.66) < 0.015


def test_R2_01_custom_path_local_buckling_matches_template():
    """R2-01: FSM 국부좌굴 하중계수 — custom 과 템플릿이 2 % 안(예전 custom 은 +24 %)."""
    cus = generate_section('custom', dict(outer_corners=_C_CORNERS, t=_T, R_inner=_R))
    tpl = generate_section('lippedc', dict(H=_H, B=_B, D=_D, t=_T, r=_R))
    fine = generate_section('lippedc', dict(H=_H, B=_B, D=_D, t=_T, r=_R, nseg=2))
    lc, lt, lf = (_local_min_bending(s) for s in (cus, tpl, fine))
    assert abs(lc / lt - 1) <= 0.02, (lc, lt)
    assert abs(lc / lf - 1) <= 0.03, (lc, lf)   # 두 배 조밀한 메시(수렴 기준)와도 가깝다
    # 예전 동작(n_flat=1)은 비보수 쪽으로 크게 틀렸다 — 결함이 시험으로 재현되는지 확인
    old = generate_section('custom', dict(outer_corners=_C_CORNERS, t=_T, R_inner=_R, n_flat=1))
    assert _local_min_bending(old) / lt > 1.15


def test_R2_01_custom_builder_and_mesh_controls():
    """R2-01: build_section 경로도 나누고, n_flat · max_elem_len 이 동작한다."""
    steps = [{'type': 'start', 'x': 0, 'y': _D}, {'type': 'go', 'dx': 0, 'dy': -_D},
             {'type': 'go', 'dx': _B, 'dy': 0}, {'type': 'go', 'dx': 0, 'dy': _H},
             {'type': 'go', 'dx': -_B, 'dy': 0}, {'type': 'go', 'dx': 0, 'dy': -_D}]
    b = generate_section('custom_builder', dict(steps=steps, t=_T, R_inner=_R))
    assert len(b['elem']) >= 30
    s3 = generate_section('custom', dict(outer_corners=_C_CORNERS, t=_T, R_inner=_R, n_flat=3))
    assert len(s3['elem']) == 5 * 3 + 4 * 4          # 5 직선부 × 3 + 4 코너 × n_arc 4
    sm = generate_section('custom', dict(outer_corners=_C_CORNERS, t=_T, max_elem_len=0.25))
    L = np.hypot(np.diff(sm['node'][:, 1]), np.diff(sm['node'][:, 2]))
    assert L.max() <= 0.25 + 1e-12


# ---------------------------------------------------------------- R2-02 / R2-14

def test_R2_02_z_needs_per_segment_side():
    """R2-02: Z 는 한 방향 offset 으로 만들 수 없다 → 거절, 구간별 side 로는 정확."""
    t, H, B, D = 0.059, 8.0, 2.25, 0.91
    Zc = [(-B, D), (-B, 0), (0, 0), (0, H), (B, H), (B, H - D)]
    for side in ('left', 'right', 'auto'):
        _raises(generate_section, 'custom', dict(outer_corners=Zc, t=t, R_inner=0.1875, outer_side=side))
    s = generate_section('custom', dict(outer_corners=Zc, t=t, R_inner=0.1875,
                                        outer_side=['left', 'left', 'left', 'right', 'right']))
    sx, sz = _span(s)
    assert abs(sx - (2 * B - t)) < 1e-6 and abs(sz - (H - t)) < 1e-6, (sx, sz)
    # 위 플랜지 폭을 위 굽힘 바깥면(웹 반대 면)에서 재도록 꼭짓점을 주면 lippedz 와 같다:
    # 각진 모서리에서 독립 꺾은선 적분과 비교 (b = B - t, c = D - t/2, h = H - t)
    Zc2 = [(-(B - t), D), (-(B - t), 0), (0, 0), (0, H), (B, H), (B, H - D)]
    sides = ['left', 'left', 'right', 'right', 'right']
    s0 = generate_section('custom', dict(outer_corners=Zc2, t=t, outer_side=sides))
    a, b, c = H - t, B - t, D - t / 2
    ref = _poly_props([(-b, -a / 2 + c), (-b, -a / 2), (0, -a / 2), (0, a / 2), (b, a / 2),
                       (b, a / 2 - c)], t)
    _check(_props(s0), ref, 1e-9, keys=('A', 'Ixx', 'Izz', 'J', 'Cw'))
    assert _rel(abs(_props(s0)['Ixz']), abs(ref['Ixz'])) < 1e-9
    # 둥근 모서리: lippedz(qlip=90) 템플릿과 0.5 % 안 (리뷰 제안 허용오차)
    sr = _props(generate_section('custom', dict(outer_corners=Zc2, t=t, R_inner=0.1875, outer_side=sides)))
    zr = _props(generate_section('lippedz', dict(H=H, B=B, D=D, t=t, r=0.1875)))
    _check(sr, zr, 0.005, keys=('A', 'Ixx', 'Izz', 'J'))


def test_R2_02_factories_z_hat_depth():
    """R2-02 · R2-18: make_z_section · make_hat_section 중심선 깊이 = H − t."""
    t = 0.059
    z = make_z_section(H=8, B_top=2.25, B_bot=2.25, D=0.91, t=t, R=0.1875, n_arc=4)
    cs = np.array(z.get_coords())
    assert abs(np.ptp(cs[:, 1]) - (8 - t)) < 1e-9
    assert abs(np.ptp(cs[:, 0]) - 2 * (2.25 - t)) < 1e-9     # b = B − t 두 개
    zt = _props(generate_section('lippedz', dict(H=8, B=2.25, D=0.91, t=t, r=0.1875)))
    assert _rel(z.properties['A'], zt['A']) < 1e-6
    assert _rel(z.properties['Ix'], zt['Ixx']) < 1e-6
    h = make_hat_section(H=3.0, B_top=4.0, B_bot=8.0, t=0.048, R=3 / 16)
    cs = np.array(h.get_coords())
    assert abs(np.ptp(cs[:, 1]) - (3.0 - 0.048)) < 1e-9


def test_R2_14_outer_side_means_material_side():
    """R2-14: 'left' = 판 재료가 진행방향 왼쪽. 미지정(auto)은 맞는 쪽, 틀린 쪽은 거절."""
    s = generate_section('custom', dict(outer_corners=_C_CORNERS, t=_T, R_inner=_R))
    sx, sz = _span(s)
    assert abs(sx - (_B - _T)) < 1e-9 and abs(sz - (_H - _T)) < 1e-9
    assert s['validation']['outer_side'] == 'left'
    msg = _raises(generate_section, 'custom',
                  dict(outer_corners=_C_CORNERS, t=_T, R_inner=_R, outer_side='right'))
    assert 'envelope' in msg
    # 역방향 C(웹 왼쪽)는 'right'
    rev = [(_B, _D), (_B, 0), (0, 0), (0, _H), (_B, _H), (_B, _H - _D)]
    s2 = generate_section('custom', dict(outer_corners=rev, t=_T, outer_side='right'))
    assert abs(_span(s2)[0] - (_B - _T)) < 1e-9


# ---------------------------------------------------------------- R2-03 / R2-04 / R2-05

def test_R2_03_lipped_angle_all_corners_rounded():
    """R2-03: 4LS4x060 (Table I-6: A 0.512, Ix 0.959, I2 0.397), 등변 → Ixx = Izz."""
    s = generate_section('lipped_angle', dict(H=4, B=4, D=0.5, t=0.06, r=0.1875))
    n = s['node']
    assert not any(abs(x) < 1e-9 and abs(z) < 1e-9 for x, z in n[:, 1:3])  # 주 코너가 각지지 않음
    p = _props(s)
    assert _rel(p['A'], 0.512) <= 0.005
    assert _rel(p['Ixx'], 0.959) <= 0.005
    assert _rel(p['I22'], 0.397) <= 0.015
    assert _rel(p['Ixx'], p['Izz']) < 1e-9


def test_R2_04_sloped_lip_dimensions_aisi_z():
    """R2-04: 8ZS2.25x059 γ=50° vs Table I-4 (A 0.822, Ix 7.76, Iy 1.08, Ixy 2.08, Imin 0.481)."""
    p = _props(generate_section('lippedz', dict(H=8, B=2.25, D=0.910, t=0.059, r=0.1875, qlip=50)))
    assert _rel(p['A'], 0.822) <= 0.003
    assert _rel(p['Ixx'], 7.76) <= 0.003
    assert _rel(p['Izz'], 1.08) <= 0.006
    assert _rel(abs(p['Ixz']), 2.08) <= 0.003
    assert _rel(p['I22'], 0.481) <= 0.005
    assert _rel(p['J'], 0.000954) <= 0.005
    # 90° 는 예전 식과 같다 (b = B − t, d = D − t/2): 각진 모서리 닫힌 해
    H, B, D, t = 9.0, 2.5, 0.773, 0.059
    pc = _props(generate_section('lippedc', dict(H=H, B=B, D=D, t=t, r=0, qlip=90)))
    _check(pc, _lipped_c_sharp(H - t, B - t, D - t / 2, t), 1e-9, keys=('A', 'Ixx', 'Izz', 'J', 'Cw'))


def test_R2_05_qlip_convention_consistent():
    """R2-05: qlip(굽힘 각) < 90 이면 C · Z · 립 앵글 모두 립이 플랜지 끝 밖으로 벌어진다.

    리뷰의 "C 와 Z 가 반대" 는 재현되지 않았다(둘 다 바깥으로 벌어짐). 립 앵글은 첫 립만
    반대로 기울어 등변 앵글의 대칭이 깨졌었다 — 고쳤다.
    """
    t = 0.059
    for typ, bx in (('lippedc', 2.5 - t), ('lippedz', 2 * (2.5 - t))):
        s = generate_section(typ, dict(H=8, B=2.5, D=0.9, t=t, r=0, qlip=50))
        assert np.ptp(s['node'][:, 1]) > bx + 0.1, typ       # 립 끝이 플랜지 끝 밖
        s = generate_section(typ, dict(H=8, B=2.5, D=0.9, t=t, r=0, qlip=135))
        assert np.ptp(s['node'][:, 1]) < bx + 1e-9, typ       # 안으로 접힘
    for q in (50, 120):
        p = _props(generate_section('lipped_angle', dict(H=4, B=4, D=0.5, t=0.06, r=0.1875, qlip=q)))
        assert _rel(p['Ixx'], p['Izz']) < 1e-9, q             # 45° 선 대칭 유지


# ---------------------------------------------------------------- R2-09 / R2-10 / R2-11 / R2-15

def test_R2_09_isect_tee_flange_width():
    """R2-09: 플랜지 끝 자유단 → 중심선 플랜지 폭 = B. tf · tw 분리."""
    s = generate_section('isect', dict(H=10, B=5, t=0.1))
    assert abs(np.ptp(s['node'][:, 1]) - 5.0) < 1e-12
    p = _props(s)
    assert _rel(p['A'], 0.1 * (9.9 + 10)) < 1e-9
    assert _rel(p['Cw'], 0.1 * 5 ** 3 * 9.9 ** 2 / 24) < 1e-6
    h = 8 - 0.05
    A = 0.1 * (h + 6)
    zc = (6 * 0.1 * h + h * 0.1 * h / 2) / A
    pt = _props(generate_section('tee', dict(H=8, B=6, t=0.1)))
    assert _rel(pt['A'], A) < 1e-9 and _rel(pt['zcg'], zc) < 1e-9
    assert _rel(pt['Izz'], 0.1 * 6 ** 3 / 12) < 1e-9
    # tf ≠ tw: I = tw·h³/12 + 2·B·tf·(h/2)², h = H − tf
    tf, tw = 0.2, 0.1
    pi_ = _props(generate_section('isect', dict(H=10, B=5, tf=tf, tw=tw)))
    hh = 10 - tf
    assert _rel(pi_['A'], tw * hh + 2 * 5 * tf) < 1e-9
    assert _rel(pi_['Ixx'], tw * hh ** 3 / 12 + 2 * 5 * tf * (hh / 2) ** 2) < 1e-9


def test_R2_10_chs_diameter_argument():
    """R2-10: MCP 인자 {H:6,B:6,D:1} 는 지름이 모호 → 거절. OD 또는 GUI 의 D=H 는 정확."""
    msg = _raises(generate_section, 'chs', dict(H=6, B=6, D=1, t=0.1, r=0))
    assert 'OD' in msg
    A0 = math.pi * 5.9 * 0.1
    for prm in (dict(H=6, B=6, D=1, OD=6, t=0.1), dict(H=6, B=2, D=6, t=0.1), dict(D=6, t=0.1)):
        s = generate_section('chs', prm)
        assert abs(np.ptp(s['node'][:, 1]) - 5.9) < 1e-9
        assert _rel(_props(s)['A'], A0) <= 0.005


def test_R2_15_chs_polygon_accuracy():
    """R2-15: CHS D=6, t=0.1 → I 가 π r_c³ t 의 0.5 % 안 (예전 24 현 −1.42 %)."""
    p = _props(generate_section('chs', dict(D=6, t=0.1)))
    rc = 2.95
    assert _rel(p['Ixx'], math.pi * rc ** 3 * 0.1) <= 0.005
    assert _rel(p['J'], 2 * math.pi * rc ** 3 * 0.1) <= 0.0075   # Bredt, 다각형 근사


def test_R2_11_hat_named_dimensions():
    """R2-11: 3HU4.5x135 (Table I-8: depth 3, width 4.5, brim 1.67) — 이름 있는 인자.

    표의 x 축은 대칭축(수직)이다: Ix 8.28 = 엔진 Izz, Iy 2.47 = 엔진 Ixx.
    """
    named = generate_section('hat', dict(depth=3.0, top_width=4.5, brim=1.67, t=0.135, r=0.1875))
    legacy = generate_section('hat', dict(H=4.5, B=3.0, D=1.67, t=0.135, r=0.1875))
    p, q = _props(named), _props(legacy)
    for k in ('A', 'Ixx', 'Izz', 'J'):
        assert _rel(p[k], q[k]) < 1e-12
    assert _rel(p['A'], 1.74) <= 0.005
    assert _rel(p['Izz'], 8.28) <= 0.01
    assert _rel(p['Ixx'], 2.47) <= 0.01
    assert _rel(p['J'], 0.0105) <= 0.01
    assert _rel(p['ro'], 3.52) <= 0.01
    assert _rel(abs(p['zo']), 2.49) <= 0.015
    sx, sz = _span(named)
    assert abs(sz - (3.0 - 0.135)) < 1e-9                     # 깊이 방향


# ---------------------------------------------------------------- 템플릿 전체 대조

def test_R2_templates_vs_aisi_tables():
    """R2 맞다고 확인한 것 + 수정 후: 템플릿 A · Ix · Iy · J · xo vs AISI Part I 표."""
    cases = [  # (type, params, A, Ix, Iy, J, xo)
        ('lippedc', dict(H=9, B=2.5, D=0.773, t=0.059, r=0.1875), 0.881, 10.3, 0.698, 0.00102, -1.66),
        ('lippedc', dict(H=8, B=2, D=0.625, t=0.0566, r=0.0849), 0.726, 6.57, 0.357, 0.000775, -1.27),
        ('lippedc', dict(H=5.5, B=1.625, D=0.5, t=0.0346, r=0.0764), 0.327, 1.46, 0.113, 0.000130, -1.11),
        ('lippedc', dict(H=3.625, B=1.625, D=0.5, t=0.0566, r=0.0849), 0.422, 0.873, 0.154, 0.000451, -1.28),
        ('track', dict(H=6.25, B=2.0, t=0.0713, r=0.1069), 0.712, 3.99, 0.254, 0.00121, -1.03),
        ('track', dict(H=5.698, B=1.25, t=0.0566, r=0.0849), 0.452, 1.90, 0.0530, 0.000483, -0.532),
    ]
    for typ, prm, A, Ix, Iy, J, xo in cases:
        p = _props(generate_section(typ, prm))
        _check(p, dict(A=A, Ixx=Ix, Izz=Iy, J=J), 0.005)
        assert _rel(p['xo'], xo) <= 0.016, (typ, prm, p['xo'], xo)


def test_R2_templates_sharp_closed_forms():
    """r = 0 닫힌 해 (Cw 포함): lippedc · track · angle · hat · rhs(Bredt)."""
    H, B, D, t = 9.0, 2.5, 0.773, 0.059
    _check(_props(generate_section('lippedc', dict(H=H, B=B, D=D, t=t, r=0))),
           _lipped_c_sharp(H - t, B - t, D - t / 2, t), 1e-9)
    _check(_props(generate_section('track', dict(H=6, B=2, t=0.1, r=0))),
           _plain_c_sharp(5.9, 1.95, 0.1), 1e-9)
    pa = _props(generate_section('angle', dict(H=6, B=4, t=0.1, r=0)))
    _check(pa, _poly_props([(0, 5.95), (0, 0), (3.95, 0)], 0.1), 1e-9, keys=('A', 'Ixx', 'Izz', 'J'))
    ph = _props(generate_section('hat', dict(H=6, B=4, D=2, t=0.1, r=0)))
    P = [(-2.95 - 1.95, 0), (-2.95, 0), (-2.95, 3.9), (2.95, 3.9), (2.95, 0), (2.95 + 1.95, 0)]
    _check(ph, _poly_props(P, 0.1), 1e-9, keys=('A', 'Ixx', 'Izz', 'J', 'Cw'))
    pr = _props(generate_section('rhs', dict(H=6, B=4, t=0.1, r=0)))
    h, b = 5.9, 3.9
    assert _rel(pr['J'], 4 * (b * h) ** 2 / (2 * (b + h) / 0.1)) < 1e-9
    # 셀 뒤틀림(F3 의 _cutwp_prop2 수정): 균일 두께 직사각 관 Cw = b²h²t(b−h)²/(24(b+h))
    # (Kollbrunner-Basler), 전단중심 = 도심. cutwp.py 는 이 값을 0 으로 덮지 않는다.
    assert _rel(pr['Cw'], b ** 2 * h ** 2 * 0.1 * (b - h) ** 2 / (24 * (b + h))) < 1e-6
    assert abs(pr['xo']) < 1e-9 and abs(pr['zo']) < 1e-9
    pc = _props(generate_section('chs', dict(D=6, t=0.1)))
    assert abs(pc['Cw']) < 1e-6 * pc['Ixx'] and abs(pc['xo']) < 1e-9


def test_R2_cutwp_passes_model_errors_through():
    """끊어진 모델(두 앵글)은 cutwp_prop 에서 ValueError 로 올라온다(그럴듯한 값 대신)."""
    a = generate_section('angle', dict(H=3, B=3, t=0.1))
    nA, eA = a['node'].copy(), a['elem'].copy()
    nB = nA.copy()
    nB[:, 1] += 10
    nB[:, 0] += len(nA)
    eB = eA.copy()
    eB[:, 1:3] += len(nA)
    eB[:, 0] += len(eA)
    _raises(cutwp_prop, np.vstack([nA, nB]), np.vstack([eA, eB]))
    c = cutwp_prop(*[generate_section('lippedc', dict(H=9, B=2.5, D=0.773, t=0.059, r=0))[k]
                     for k in ('node', 'elem')])
    assert c['nan_substituted'] == []


# ---------------------------------------------------------------- R2-12

def test_R2_12_degenerate_inputs_rejected():
    """R2-12: 퇴화 입력은 ValueError (다른 단면을 조용히 만들지 않는다)."""
    bad = [
        ('track', dict(H=6, B=0.6, t=0.1, r=0.8)),           # 직선부 < 코너
        ('lippedc', dict(H=3, B=1.0, D=0.3, t=0.1, r=0.5)),
        ('isect', dict(H=10, B=5, t=0.1, nseg=0)),
        ('lippedc', dict(H=9, B=2.5, D=0.7, t=0.0, r=0.1)),
        ('lippedc', dict(H=9, B=2.5, t=0.06)),               # D 누락
        ('lippedc', dict(B=2.5, D=0.7, t=0.06)),             # H 누락
        ('lippedc', dict(H=9, B=2.5, D=0.7, t=0.06, qlip=0)),
        ('custom', dict(outer_corners=_C_CORNERS, t=_T, R_inner=0.1, n_arc=0)),
        ('custom', dict(outer_corners=_C_CORNERS)),           # t 누락
        ('custom', dict(outer_corners=[(0, 0), (4, 0), (4, 6), (0, 6), (0, 0)], t=0.1)),  # 닫힌 경로
        ('custom', dict(outer_corners=[(0, 0.2), (0, 0), (2.5, 0), (2.5, 9), (0, 9), (0, 8.8)],
                        t=0.059, R_inner=0.1875)),            # 립 < 필렛
    ]
    for typ, prm in bad:
        _raises(generate_section, typ, prm)


def test_R2_12_zero_lip_is_unlipped_section():
    """R2-12: D = 0 이면 립 · 립 코너가 모두 없다 (허상 립 없음)."""
    for r in (0.0, 0.2):
        a = _props(generate_section('lippedc', dict(H=6, B=2, D=0, t=0.1, r=r)))['A']
        b = _props(generate_section('track', dict(H=6, B=2, t=0.1, r=r)))['A']
        assert _rel(a, b) < 1e-12, (r, a, b)
    # 립 없는 Z: A = t·(h + 2·(B − t/2)) (r = 0)
    pz = _props(generate_section('lippedz', dict(H=8, B=2.25, D=0, t=0.059, r=0)))
    assert _rel(pz['A'], 0.059 * (8 - 0.059 + 2 * (2.25 - 0.0295))) < 1e-12


def test_R2_12_custom_short_lip_keeps_radius():
    """R2-12: 유효한 짧은 립에서 반경을 몰래 줄이지 않는다 → 템플릿과 같은 면적."""
    for D_ in (0.4, 0.3):
        cc = [(0, D_), (0, 0), (2.5, 0), (2.5, 9), (0, 9), (0, 9 - D_)]
        a = _props(generate_section('custom', dict(outer_corners=cc, t=0.059, R_inner=0.1875)))['A']
        b = _props(generate_section('lippedc', dict(H=9, B=2.5, D=D_, t=0.059, r=0.1875)))['A']
        assert _rel(a, b) < 1e-9, (D_, a, b)


def test_R2_12_grosprop_zero_area_rejected():
    """R2-12: 면적 0 은 키가 빠진 dict 대신 오류."""
    s = generate_section('lippedc', dict(H=9, B=2.5, D=0.773, t=0.059, r=0))
    elem = s['elem'].copy()
    elem[:, 3] = 0.0
    _raises(grosprop, s['node'], elem)


# ---------------------------------------------------------------- R2-13

def test_R2_13_custom_reports_validation():
    """R2-13: 검증 결과를 돌려준다. 자기 교차는 거절, 면적비 0.5 는 status 'fail'."""
    s = generate_section('custom', dict(outer_corners=_C_CORNERS, t=_T, R_inner=_R, expected_A=0.44))
    v = s['validation']
    assert v['status'] == 'fail'
    assert any(c['item'] == 'Area vs expected' and c['status'] == 'fail' for c in v['checks'])
    assert s['warnings']
    ok = generate_section('custom', dict(outer_corners=_C_CORNERS, t=_T, R_inner=_R, expected_A=0.881))
    assert ok['validation']['status'] == 'pass' and ok['warnings'] == []
    _raises(generate_section, 'custom', dict(outer_corners=[(0, 0), (3, 0), (3, 3), (1.5, -1), (0, 3)], t=0.1))
    # 립이 플랜지 밖으로 나간 경로(옛 문서 시그마 예제의 아래 립 (0, −1))는 립 검사 경고
    sig = [(0.0, -1.0), (0.0, 0.0), (2.5, 0.0), (2.5, 2.25), (2.0, 2.875), (2.0, 5.125),
           (2.5, 5.75), (2.5, 8.0), (0.0, 8.0), (0.0, 7.125)]
    lip = [c for c in validate_section(sig, 0.0451)['checks'] if c['item'].startswith('Lip')][0]
    assert lip['status'] == 'warn' and 'start=outward' in lip['value']


# ---------------------------------------------------------------- R2-16

def test_R2_16_section_modulus_outer_fibre():
    """R2-16: Sx 는 최외단 섬유 기준 — 800S200-54 Sx = 1.64 (Table I-2) ± 0.3 %."""
    g = grosprop(*[generate_section('lippedc', dict(H=8, B=2, D=0.625, t=0.0566, r=0.0849))[k]
                   for k in ('node', 'elem')])
    assert _rel(g['Sx'], 1.64) <= 0.003
    assert _rel(g['Sx'], g['Ixx'] / 4.0) < 1e-9               # 대칭 C: c = H/2
    assert g['Sx_cl'] > g['Sx']                               # 예전 값(중심선 극한)
    # 9CS2.5x059 Sx 2.29, 600T200-68 Sx 1.28
    g = grosprop(*[generate_section('lippedc', dict(H=9, B=2.5, D=0.773, t=0.059, r=0.1875))[k]
                   for k in ('node', 'elem')])
    assert _rel(g['Sx'], 2.29) <= 0.003
    g = grosprop(*[generate_section('track', dict(H=6.25, B=2.0, t=0.0713, r=0.1069))[k]
                   for k in ('node', 'elem')])
    assert _rel(g['Sx'], 1.28) <= 0.004


# ---------------------------------------------------------------- R2-18 / R2-19

def test_R2_18_single_authoritative_centerline_module():
    """R2-18: Example 사본은 엔진 모듈을 다시 내보낸다. 립은 안쪽, corner_radii 는 내측 반경."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'example_cfs_centerline', os.path.join(_ROOT, 'Example', 'cfs_centerline.py'))
    ex = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ex)
    assert ex.ColdFormedSection is ColdFormedSection
    c = make_c_section(6.0, 2.0, 0.625, 0.054, 3 / 16)
    assert c.outer_corners[0][1] == 0.625
    a = ColdFormedSection(outer_corners=_C_CORNERS, t=_T, corner_radii=[_R] * 4, n_arc=4)
    b = ColdFormedSection(outer_corners=_C_CORNERS, t=_T, R_inner=_R, n_arc=4)
    assert abs(a.properties['A'] - b.properties['A']) < 1e-12


def test_R2_19_example_doc_values():
    """R2-19: Example/III-3.md 총단면 값은 362S162-54(Table I-2), 시그마 예제 립은 안쪽."""
    with open(os.path.join(_ROOT, 'Example', 'III-3.md'), encoding='utf-8') as f:
        s = f.read()
    assert '| Ix | 0.873 |' in s and '| Iy | 0.154 |' in s and '| xo | -1.28 |' in s
    assert 'Z-section with lips' not in s
    with open(os.path.join(_ROOT, 'Example', 'CFS_CENTERLINE_ALGORITHM.md'), encoding='utf-8') as f:
        s = f.read()
    assert '(0.0, -1.00)' not in s


# ---------------------------------------------------------------- R2-20

def test_R2_20_json_nan_in_arrays_is_null():
    """R2-20: 배열 속 NaN/Inf 도 스칼라와 같이 null (0.0 으로 위장하지 않음)."""
    enc = json.loads(json.dumps({'a': float('nan'), 'b': np.array([1.0, np.nan, np.inf]),
                                 'c': np.array([[np.nan, 2.0]])}, cls=SafeJsonEncoder))
    assert enc == {'a': None, 'b': [1.0, None, None], 'c': [[None, 2.0]]}


def test_R2_20_model_shape_checked():
    """R2-20: from_dict 는 node (n,8) · elem (m,5) 모양을 검사한다."""
    base = {'prop': PROP.tolist(), 'node': [[1, 0, 0, 1, 1, 1, 1, 1.0], [2, 1, 0, 1, 1, 1, 1, 1.0]],
            'elem': [[1, 1, 2, 0.1, 100]], 'lengths': [1.0]}
    CufsmModel.from_dict(base)
    _raises(CufsmModel.from_dict, dict(base, node=[[1, 0, 0], [2, 1, 0]]))
    _raises(CufsmModel.from_dict, dict(base, elem=[[1, 1, 2]]))


# ---------------------------------------------------------------- R3-09

def test_R3_09_zero_selection_vectors_inactive():
    """R3-09: 선택 벡터가 모두 0 이면 cFSM 은 꺼진다(MATLAB stripmain: 합 > 0) — 보통 FSM 과 같다."""
    from engine.fsm_solver import stripmain
    s = generate_section('lippedc', dict(H=9, B=2.5, D=0.773, t=0.059, r=0))
    n = len(s['node'])
    zeros = GBTConfig(glob=np.zeros(4), dist=np.zeros(2), local=np.zeros(n), other=np.zeros(2 * n))
    assert zeros.is_active() is False
    assert GBTConfig(glob=np.array([1, 0, 0, 0])).is_active() is True
    node = s['node'].copy()
    node[:, 7] = 50.0
    L = np.array([5.0])
    curves = []
    for g in (zeros, GBTConfig()):
        r = stripmain(PROP, node, s['elem'], L, np.array([]), np.array([]), g, 'S-S',
                      [np.array([1.0])], neigs=1)
        curves.append(float(np.asarray(r.curve[0]).reshape(-1)[1]))
    assert curves[0] > 0 and abs(curves[0] - curves[1]) < 1e-9 * curves[1], curves


def test_R3_10_gbtconfig_defaults_are_cufsm():
    """R3-10: GBTConfig 기본 = CUFSM (Ref_Source/helpers/loader.m:134-146: ospace 1, orth 2,
    couple 1, norm 1). 기본 객체는 구속 해석을 켜지 않는다. 예리한 립 C 휨 국부(L=4.92)
    분류: 비직교 자연기저(옛 기본)는 O 4.5 %, CUFSM 기본은 O ≤ 1 % (리뷰 독립 계산 0.5 %)."""
    from engine.fsm_solver import stripmain
    from engine.stress import stresgen, yieldMP
    from cfsm.classify import classify
    g = GBTConfig()
    assert (g.ospace, g.orth, g.couple, g.norm) == (1, 2, 1, 1)
    f = GBTConfig.from_dict({})
    assert (f.ospace, f.orth, f.couple, f.norm) == (1, 2, 1, 1)
    assert g.is_active() is False
    s = generate_section('lippedc', dict(H=9.0, B=5.0, D=1.0, t=0.1, r=0.0))
    node, elem = s['node'].copy(), s['elem']
    p = grosprop(node, elem)
    y = yieldMP(node.copy(), 50.0, p['A'], p['xcg'], p['zcg'], p['Ixx'], p['Izz'], p['Ixz'],
                p['thetap'], p['I11'], p['I22'])
    node = stresgen(node, P=0.0, Mxx=y['Mxx_y'], Mzz=0.0, M11=0.0, M22=0.0, A=p['A'],
                    xcg=p['xcg'], zcg=p['zcg'], Ixx=p['Ixx'], Izz=p['Izz'], Ixz=p['Ixz'],
                    thetap=p['thetap'], I11=p['I11'], I22=p['I22'], unsymm=0)
    L = np.array([4.92])
    m = [np.array([1.0])]
    lf = []
    for gb in (GBTConfig(), GBTConfig(orth=1, norm=0)):     # 둘 다 구속 꺼짐 → 같은 해
        r = stripmain(PROP, node, elem, L, np.array([]), np.array([]), gb, 'S-S', m, neigs=1)
        lf.append(float(np.asarray(r.curve[0]).reshape(-1)[1]))
    assert abs(lf[0] - lf[1]) < 1e-12 * lf[1]
    cl = classify(PROP, node, elem, L, r.shapes, GBTConfig(), 'S-S', m)
    row = np.asarray(cl[0])[0]
    assert row[3] <= 1.0 and row[2] >= 90.0, row


def test_F1_result_carries_sorted_terms():
    """F1 후속: CufsmResult.m_all 필드 — stripmain 이 정리한 항을 싣고 직렬화한다."""
    from engine.fsm_solver import stripmain
    from models.data import CufsmResult
    assert CufsmResult().m_all == []
    s = generate_section('lippedc', dict(H=9, B=2.5, D=0.773, t=0.059, r=0))
    node = s['node'].copy()
    node[:, 7] = 50.0
    r = stripmain(PROP, node, s['elem'], np.array([5.0]), np.array([]), np.array([]),
                  GBTConfig(), 'S-S', [np.array([2.0, 1.0, 1.0])], neigs=1)
    d = r.to_dict()
    assert d['m_all'] == [[1.0, 2.0]]
    assert CufsmResult.from_dict(json.loads(json.dumps(d, cls=SafeJsonEncoder))).m_all[0].tolist() == [1.0, 2.0]
