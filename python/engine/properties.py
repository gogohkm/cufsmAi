"""요소/단면 물성 계산

원본: Ref_Source/analysis/elemprop.m, Ref_Source/helpers/grosprop.m
"""

import math

import numpy as np


def _calc_plastic_modulus(node, elem, xcg, zcg, axis='x'):
    """소성단면계수 계산 (파이버 적분)

    소성중립축(PNA)을 찾아 단면을 면적이 같은 두 부분으로 나누고,
    각 부분의 면적 × 도심거리의 합으로 Z를 계산.

    axis='x': Zx (강축, z방향 분할)
    axis='z': Zz (약축, x방향 분할)
    """
    nelems = elem.shape[0]

    # 파이버 생성 (요소당 10개 분할)
    fibers = []
    for i in range(nelems):
        ni = int(elem[i, 1]) - 1
        nj = int(elem[i, 2]) - 1
        t = elem[i, 3]
        xi, zi = node[ni, 1], node[ni, 2]
        xj, zj = node[nj, 1], node[nj, 2]
        L = math.sqrt((xj - xi)**2 + (zj - zi)**2)
        n_fib = max(10, int(L / 0.1))
        for k in range(n_fib):
            frac = (k + 0.5) / n_fib
            fx = xi + frac * (xj - xi)
            fz = zi + frac * (zj - zi)
            fa = L * t / n_fib
            fibers.append((fx, fz, fa))

    if not fibers:
        return 0.0

    total_A = sum(f[2] for f in fibers)
    half_A = total_A / 2.0

    # 소성중립축 위치 탐색 (이분법)
    if axis == 'x':
        coords = [f[1] for f in fibers]  # z좌표 기준
    else:
        coords = [f[0] for f in fibers]  # x좌표 기준

    lo, hi = min(coords), max(coords)
    for _ in range(60):
        mid = (lo + hi) / 2.0
        area_below = sum(f[2] for f in fibers if (f[1] if axis == 'x' else f[0]) <= mid)
        if area_below < half_A:
            lo = mid
        else:
            hi = mid
    pna = (lo + hi) / 2.0

    # Z = Σ|거리| × 면적
    Z = 0.0
    for f in fibers:
        c = f[1] if axis == 'x' else f[0]
        Z += abs(c - pna) * f[2]

    return Z


def elemprop(node: np.ndarray, elem: np.ndarray) -> np.ndarray:
    """요소별 폭(width)과 회전각(alpha) 계산

    Args:
        node: (nnodes, 8) — [node#, x, z, dofx, dofz, dofy, dofrot, stress]
        elem: (nelems, 5) — [elem#, nodei, nodej, t, matnum]
              nodei, nodej는 MATLAB 1-based 값

    Returns:
        elprop: (nelems, 3) — [elem_index, width, alpha]
    """
    nelems = elem.shape[0]
    elprop = np.zeros((nelems, 3))

    for i in range(nelems):
        # MATLAB 1-based → Python 0-based
        nodei = int(elem[i, 1]) - 1
        nodej = int(elem[i, 2]) - 1
        xi = node[nodei, 1]
        zi = node[nodei, 2]
        xj = node[nodej, 1]
        zj = node[nodej, 2]
        dx = xj - xi
        dz = zj - zi
        width = math.sqrt(dx**2 + dz**2)
        alpha = math.atan2(dz, dx)
        elprop[i, :] = [i, width, alpha]

    return elprop


def grosprop(node: np.ndarray, elem: np.ndarray) -> dict:
    """총단면 성질 계산

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5) — nodei, nodej는 MATLAB 1-based

    Returns:
        dict with keys: A, xcg, zcg, Ixx, Izz, Ixz, thetap, I11, I22,
        Sx, Sz (최외단 섬유 = 판 바깥면 기준, AISI Sf), Sx_cl, Sz_cl (중심선 극한
        절점 기준), rx, rz, Zx, Zz

    Raises:
        ValueError — 단면적이 0 (요소 없음 또는 t = 0)
    """
    nelems = elem.shape[0]

    A_total = 0.0
    Ax = 0.0
    Az = 0.0
    Axx = 0.0
    Azz = 0.0
    Axz = 0.0
    Ixx_o = 0.0
    Izz_o = 0.0
    Ixz_o = 0.0

    for i in range(nelems):
        nodei = int(elem[i, 1]) - 1
        nodej = int(elem[i, 2]) - 1
        t = elem[i, 3]

        xi = node[nodei, 1]
        zi = node[nodei, 2]
        xj = node[nodej, 1]
        zj = node[nodej, 2]

        dx = xj - xi
        dz = zj - zi
        L = math.sqrt(dx**2 + dz**2)

        A_e = L * t
        x_c = (xi + xj) / 2.0
        z_c = (zi + zj) / 2.0

        A_total += A_e
        Ax += A_e * x_c
        Az += A_e * z_c
        Axx += A_e * x_c**2
        Azz += A_e * z_c**2
        Axz += A_e * x_c * z_c

        # 요소 자체의 관성모멘트 (중심축) — thin-wall convention.
        # grosprop.m은 두께방향 자기관성항 t^2*sin^2(theta)를 포함하지만
        # (Ref_Source/helpers/grosprop.m L29-32), 여기서는 이를 의도적으로 생략하여
        # cutwp_prop2.m(Ref_Source/analysis/cutwp_prop2.m L150-152, Ix=yd^2/12*L*t)의
        # 박벽 관례와 일치시킨다. 이로써 grosprop과 cutwp(FSM/DSM 경로)가 서로 일관되며
        # Sf 기반 My가 FSM 경로와 어긋나지 않는다. (t/width)^2 ~0.01-0.25% 수준의 차이만 발생.
        Ixx_o += t * L**3 * dz**2 / L**2 / 12.0  # = t * L * dz^2 / 12
        Izz_o += t * L**3 * dx**2 / L**2 / 12.0
        Ixz_o += t * L**3 * dx * dz / L**2 / 12.0

    if not (A_total > 0):
        # 면적 0(요소 없음, t=0)이면 모든 성질이 뜻을 잃는다 — 0 dict 로 위장하지 않는다
        raise ValueError(
            f"grosprop: section area is {A_total!r} (no elements or zero thickness)")

    xcg = Ax / A_total
    zcg = Az / A_total

    # 도심 축 관성모멘트 (평행축 정리)
    Ixx = Ixx_o + Azz - A_total * zcg**2
    Izz = Izz_o + Axx - A_total * xcg**2
    Ixz = Ixz_o + Axz - A_total * xcg * zcg

    # 주축 각도
    # 상대 허용치: Ixx≈Izz인 원형/정방형 단면에서 수치 잡음 방지
    I_ref = max(abs(Ixx), abs(Izz), 1e-30)
    if abs(Ixx - Izz) < 1e-10 * I_ref and abs(Ixz) < 1e-10 * I_ref:
        thetap = 0.0
    elif abs(Ixx - Izz) < 1e-10 * I_ref:
        thetap = 45.0 if Ixz < 0 else -45.0
    else:
        thetap = math.degrees(math.atan2(-2 * Ixz, Ixx - Izz) / 2.0)

    # 주축 관성모멘트
    theta_rad = math.radians(thetap)
    c = math.cos(theta_rad)
    s = math.sin(theta_rad)
    I11 = Ixx * c**2 + Izz * s**2 - 2 * Ixz * s * c
    I22 = Ixx * s**2 + Izz * c**2 + 2 * Ixz * s * c

    # 단면계수 Sx, Sz — AISI Sf 는 최외단 섬유(판의 바깥면) 기준이다. 요소를 폭 L,
    # 두께 t 인 직사각형으로 보고, 그 모서리의 극한 좌표 = 절점 좌표 ± (t/2)·|법선 성분|
    # 으로 잰다(수평 플랜지는 중심선 + t/2, 수직 판의 자유단은 절점 그대로).
    # 중심선 극한 절점 기준 값은 Sx_cl, Sz_cl 로 남긴다(CUFSM yieldMP 와 같은 기준).
    xs = node[:, 1]
    zs = node[:, 2]
    cx_pos = max(xs) - xcg  # xcg에서 오른쪽 극한 섬유 (중심선)
    cx_neg = xcg - min(xs)  # xcg에서 왼쪽 극한 섬유 (중심선)
    cz_pos = max(zs) - zcg
    cz_neg = zcg - min(zs)
    cx_cl = max(cx_pos, cx_neg) if max(cx_pos, cx_neg) > 0 else 1.0
    cz_cl = max(cz_pos, cz_neg) if max(cz_pos, cz_neg) > 0 else 1.0
    x_hi = z_hi = -math.inf
    x_lo = z_lo = math.inf
    for i in range(nelems):
        ni = int(elem[i, 1]) - 1
        nj = int(elem[i, 2]) - 1
        t = elem[i, 3]
        xi, zi = node[ni, 1], node[ni, 2]
        xj, zj = node[nj, 1], node[nj, 2]
        L = math.hypot(xj - xi, zj - zi)
        if L <= 0:
            continue
        hz = 0.5 * t * abs(xj - xi) / L   # 법선의 z 성분 × t/2
        hx = 0.5 * t * abs(zj - zi) / L   # 법선의 x 성분 × t/2
        z_hi = max(z_hi, zi + hz, zj + hz)
        z_lo = min(z_lo, zi - hz, zj - hz)
        x_hi = max(x_hi, xi + hx, xj + hx)
        x_lo = min(x_lo, xi - hx, xj - hx)
    cz = max(z_hi - zcg, zcg - z_lo)
    cx = max(x_hi - xcg, xcg - x_lo)
    cz = cz if cz > 0 else cz_cl
    cx = cx if cx > 0 else cx_cl
    Sx = Ixx / cz  # 강축 단면계수 (최외단 섬유)
    Sz = Izz / cx  # 약축 단면계수 (최외단 섬유)
    Sx_cl = Ixx / cz_cl
    Sz_cl = Izz / cx_cl

    # 회전반경
    rx = math.sqrt(Ixx / A_total) if A_total > 0 else 0.0
    rz = math.sqrt(Izz / A_total) if A_total > 0 else 0.0

    # 소성단면계수 Zx, Zz (파이버 적분)
    Zx = _calc_plastic_modulus(node, elem, xcg, zcg, axis='x')
    Zz = _calc_plastic_modulus(node, elem, xcg, zcg, axis='z')

    return dict(
        A=A_total, xcg=xcg, zcg=zcg,
        Ixx=Ixx, Izz=Izz, Ixz=Ixz,
        thetap=thetap, I11=I11, I22=I22,
        Sx=Sx, Sz=Sz, rx=rx, rz=rz, Zx=Zx, Zz=Zz,
        Sx_cl=Sx_cl, Sz_cl=Sz_cl,
    )
