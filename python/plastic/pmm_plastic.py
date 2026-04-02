"""소성 상호작용곡면 생성 (P-Mxx-Mzz)

참조: 프로젝트개요.md §5.4 소성 해석
원본: Ref_Source/analysis/plastic/PMM_Plastic.m, fiber4elem.m

파이버 기반 단면 이산화로 P-Mxx-Mzz 소성 상호작용 곡면을 생성한다.
"""

import math

import numpy as np


def pmm_plastic(node: np.ndarray, elem: np.ndarray,
                fy: float, n_theta: int = 36, n_phi: int = 19) -> dict:
    """소성 상호작용곡면 계산

    Args:
        node: (nnodes, 8) — 절점 좌표 (1-based)
        elem: (nelems, 5) — 요소 (1-based)
        fy: 항복 응력
        n_theta: theta 분할 수 (방위각)
        n_phi: phi 분할 수 (극각)

    Returns:
        dict: {
            'P': (n_points,), 'Mxx': (n_points,), 'Mzz': (n_points,),
            'theta': (n_points,), 'phi': (n_points,)
        }
    """
    # 파이버 생성
    fibers = _create_fibers(node, elem)
    n_fibers = len(fibers)

    # 각 파이버: (x, z, area)
    # 전소성 상태: 모든 파이버가 +fy 또는 -fy

    P_list = []
    Mxx_list = []
    Mzz_list = []
    theta_list = []
    phi_list = []

    # 도심 계산
    total_A = sum(f[2] for f in fibers)
    xcg = sum(f[0] * f[2] for f in fibers) / total_A if total_A > 0 else 0
    zcg = sum(f[1] * f[2] for f in fibers) / total_A if total_A > 0 else 0

    # P-M 상호작용: 중립축 위치/각도를 변화시키면서 계산
    for i_theta in range(n_theta):
        theta = 2 * math.pi * i_theta / n_theta  # 중립축 방향
        cos_t = math.cos(theta)
        sin_t = math.sin(theta)

        for i_phi in range(n_phi + 1):
            # 중립축 위치 (-최대 ~ +최대)
            phi = -1.0 + 2.0 * i_phi / n_phi

            # 중립축까지의 거리 기반 스케일
            dists = [(f[0] - xcg) * cos_t + (f[1] - zcg) * sin_t for f in fibers]
            d_min = min(dists) if dists else 0
            d_max = max(dists) if dists else 0
            d_range = d_max - d_min if d_max != d_min else 1.0

            # 중립축 위치
            na_pos = d_min + (phi + 1) / 2.0 * d_range

            # 각 파이버의 응력 결정
            P = 0.0
            Mxx = 0.0
            Mzz = 0.0

            for f_idx in range(n_fibers):
                x, z, area = fibers[f_idx]
                dist = (x - xcg) * cos_t + (z - zcg) * sin_t

                if dist >= na_pos:
                    stress = fy
                else:
                    stress = -fy

                force = stress * area
                P += force
                Mxx += force * (z - zcg)
                Mzz += force * (x - xcg)

            P_list.append(P)
            Mxx_list.append(Mxx)
            Mzz_list.append(Mzz)
            theta_list.append(theta)
            phi_list.append(phi)

    return {
        'P': np.array(P_list),
        'Mxx': np.array(Mxx_list),
        'Mzz': np.array(Mzz_list),
        'theta': np.array(theta_list),
        'phi': np.array(phi_list),
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
