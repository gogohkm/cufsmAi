"""소성 상호작용곡면 생성 (P-M11-M22)

참조: 프로젝트개요.md §5.4 소성 해석
원본: Ref_Source/analysis/plastic/PMM_Plastic.m, fiber4elem.m

파이버 기반 단면 이산화로 P-M11-M22 소성 상호작용 곡면을 생성한다.
주축(principal axis) 좌표계에서 계산하여 정규화된 결과를 반환한다.
"""

import math

import numpy as np

from engine.properties import grosprop
from engine.stress import yieldMP


def pmm_plastic(node: np.ndarray, elem: np.ndarray,
                fy: float, n_theta: int = 36, n_na: int = 21) -> dict:
    """소성 상호작용곡면 계산 (주축 좌표계)

    MATLAB PMM_Plastic.m 알고리즘을 충실히 포팅:
    1. 파이버 생성 → 도심 이동 → 주축 회전
    2. 중립축 각도(theta) × 위치(e) 를 순회하며 (P, M11, M22) 계산
    3. 항복값(Py, M11_y, M22_y)으로 정규화

    Args:
        node: (nnodes, 8) — 절점 배열
        elem: (nelems, 5) — 요소 배열
        fy: 항복 응력
        n_theta: 중립축 각도 분할 수
        n_na: 중립축 위치 분할 수

    Returns:
        dict: 정규화된 곡면 + 항복값 + 메타 정보
    """
    # --- 단면 성질 ---
    props = grosprop(node, elem)
    A = props['A']
    xcg, zcg = props['xcg'], props['zcg']
    Ixx, Izz, Ixz = props['Ixx'], props['Izz'], props['Ixz']
    thetap = props['thetap']
    I11, I22 = props['I11'], props['I22']

    # --- 항복값 ---
    ymp = yieldMP(node, fy, A, xcg, zcg, Ixx, Izz, Ixz, thetap, I11, I22)
    Py = ymp['Py']
    M11_y = ymp['M11_y']
    M22_y = ymp['M22_y']
    Mxx_y = ymp['Mxx_y']
    Mzz_y = ymp['Mzz_y']

    # --- 파이버 생성 ---
    fibers = _create_fibers(node, elem)
    n_fibers = len(fibers)

    # --- 도심 이동 + 주축 회전 ---
    th_rad = math.radians(-thetap)
    cos_r = math.cos(th_rad)
    sin_r = math.sin(th_rad)

    fib_x = np.empty(n_fibers)
    fib_z = np.empty(n_fibers)
    fib_a = np.empty(n_fibers)

    for i, (x, z, area) in enumerate(fibers):
        dx = x - xcg
        dz = z - zcg
        fib_x[i] = cos_r * dx - sin_r * dz
        fib_z[i] = sin_r * dx + cos_r * dz
        fib_a[i] = area

    # --- 중립축 순회 ---
    thetas = np.linspace(0, 2 * math.pi, n_theta, endpoint=False)

    P_grid = np.zeros((n_na, n_theta))
    M11_grid = np.zeros((n_na, n_theta))
    M22_grid = np.zeros((n_na, n_theta))

    for k in range(n_theta):
        theta = thetas[k]
        cos_t = math.cos(theta)
        sin_t = math.sin(theta)

        # 각 파이버의 중립축까지 거리 (MATLAB: CL = z*cos(theta) - x*sin(theta) - e)
        dists = fib_z * cos_t - fib_x * sin_t

        # 중립축 범위 (MATLAB: emin ~ emax, 약간 여유)
        d_min = np.min(dists)
        d_max = np.max(dists)
        r = max(abs(d_min), abs(d_max)) * 1.02
        na_positions = np.linspace(-r, r, n_na)

        for i in range(n_na):
            e = na_positions[i]
            CL = dists - e  # 각 파이버의 중립축 대비 위치

            # 응력 결정: CL > 0 → -fy, CL < 0 → +fy, CL == 0 → 0
            stress = np.where(CL > 0, -fy, np.where(CL < 0, fy, 0.0))
            force = stress * fib_a

            P_grid[i, k] = np.sum(force)
            M11_grid[i, k] = -np.sum(force * fib_z)  # M about axis 1
            M22_grid[i, k] = -np.sum(force * fib_x)  # M about axis 2

    # --- 정규화 ---
    P_n = P_grid / Py if abs(Py) > 1e-20 else P_grid
    M11_n = M11_grid / M11_y if abs(M11_y) > 1e-20 else M11_grid
    M22_n = M22_grid / M22_y if abs(M22_y) > 1e-20 else M22_grid

    return {
        'P': P_n,
        'M11': M11_n,
        'M22': M22_n,
        'Py': float(Py),
        'M11_y': float(M11_y),
        'M22_y': float(M22_y),
        'Mxx_y': float(Mxx_y),
        'Mzz_y': float(Mzz_y),
        'thetap': float(thetap),
        'fy': float(fy),
        'n_theta': n_theta,
        'n_na': n_na,
    }


def _create_fibers(node: np.ndarray, elem: np.ndarray,
                    n_fibers_per_elem: int = 4) -> list:
    """요소를 파이버로 이산화

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5) — 1-based
        n_fibers_per_elem: 요소당 파이버 수

    Returns:
        list of (x, z, area) tuples
    """
    fibers = []
    nelems = elem.shape[0]

    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        t = elem[e, 3]

        xi, zi = node[ni, 1], node[ni, 2]
        xj, zj = node[nj, 1], node[nj, 2]

        L = math.sqrt((xj - xi)**2 + (zj - zi)**2)
        fiber_length = L / n_fibers_per_elem
        area = fiber_length * t

        for f in range(n_fibers_per_elem):
            frac = (f + 0.5) / n_fibers_per_elem
            x = xi + frac * (xj - xi)
            z = zi + frac * (zj - zi)
            fibers.append((x, z, area))

    return fibers
