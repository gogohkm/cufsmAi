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


PLASTIC_SCOPE_NOTES = (
    'Full plastic interaction surface of the gross section: no local or distortional '
    'buckling, no strain hardening or cold-work strength increase; for display, not a '
    'member design check.',
)


def pmm_plastic(node: np.ndarray, elem: np.ndarray,
                fy: float, n_theta: int = 36, n_na: int = 21,
                n_fibers_per_elem: int = None, n_thick: int = 10) -> dict:
    """소성 상호작용곡면 계산 (주축 좌표계)

    MATLAB PMM_Plastic.m 알고리즘을 따른다:
    1. 파이버 생성 → 도심 이동 → 주축 회전
    2. 중립축 각도(theta) 마다 축력 P 를 고른 간격으로 두고 (P, M11, M22) 계산
    3. 항복값(Py, M11_y, M22_y)으로 정규화

    MATLAB 은 중립축 위치 e 를 고른 간격으로 두고 점구름을 Plastic_Int.m 으로
    다시 보간한다. 여기서는 각 theta 에서 P(e) 가 단조이므로 목표 P 에 맞는 중립축을
    바로 찾는다(중립축에 걸친 파이버는 면적을 나눠 가진다). 그래서 P = 0 의 Mp 가
    모든 theta 에서 표본에 정확히 들어간다.

    Args:
        node: (nnodes, 8) — 절점 배열
        elem: (nelems, 5) — 요소 배열
        fy: 항복 응력
        n_theta: 중립축 각도 분할 수
        n_na: theta 마다 축력 표본 수 (-Py … +Py, 홀수면 P = 0 포함)
        n_fibers_per_elem: 요소 길이 방향 파이버 수. None이면 요소 길이 기반으로
            자동 산정(요소당 max(10, int(L/0.1)))하여 곡면을 매끄럽게 한다.
        n_thick: 두께 방향 파이버 수 (fiber4elem.m 의 NL). 두께 방향 모멘트
            (b·t²/4 항)를 잡는다 — 평판의 약축 Mp 가 이 항뿐이다.

    Returns:
        dict: 정규화된 곡면 + 항복값 + 메타 정보.
            'normalized': {'P', 'M11', 'M22'} 별 정규화 여부. 항복값이 정의되지
            않는 축(중심선 모델에서 I = 0 인 평판 약축 등)은 False 이고 그 축의
            정규화 배열은 NaN 이다(원값은 'P_raw' · 'M11_raw' · 'M22_raw').
            'warnings': 값을 바꾼 것(정의되지 않아 NaN 으로 둔 축 등) — 문자열 목록.
            'assumptions' · 'scope_notes': 이 실행의 가정 · 늘 참인 범위(FIXES §3.1.1).
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
    fibers = np.array(_create_fibers(node, elem, n_fibers_per_elem, n_thick))

    # --- 도심 이동 + 주축 회전 ---
    th_rad = math.radians(-thetap)
    cos_r = math.cos(th_rad)
    sin_r = math.sin(th_rad)
    dx = fibers[:, 0] - xcg
    dz = fibers[:, 1] - zcg
    fib_x = cos_r * dx - sin_r * dz
    fib_z = sin_r * dx + cos_r * dz
    fib_a = fibers[:, 2]
    A_fib = float(np.sum(fib_a))

    # --- 중립축 순회 ---
    thetas = np.linspace(0, 2 * math.pi, n_theta, endpoint=False)
    # 목표 축력: 압축(-)부터 인장(+)까지
    P_targets = np.linspace(-1.0, 1.0, n_na) * fy * A_fib

    P_grid = np.zeros((n_na, n_theta))
    M11_grid = np.zeros((n_na, n_theta))
    M22_grid = np.zeros((n_na, n_theta))

    scale = max(float(np.max(np.abs(np.r_[fib_x, fib_z]))), 1e-300)
    for k in range(n_theta):
        cos_t = math.cos(thetas[k])
        sin_t = math.sin(thetas[k])

        # 각 파이버의 중립축 방향 거리 (MATLAB: CL = z*cos(theta) - x*sin(theta) - e);
        # CL > 0 → -fy, CL < 0 → +fy. 거리가 같은 파이버는 한 묶음으로 같은 응력을 받는다.
        dists = fib_z * cos_t - fib_x * sin_t
        key = np.round(dists / scale, 12)
        levels, inv = np.unique(key, return_inverse=True)
        a_lev = np.bincount(inv, weights=fib_a)
        cum = np.concatenate([[0.0], np.cumsum(a_lev)])   # 아래(거리 작은 쪽)부터 누적 면적

        for i in range(n_na):
            # P = fy·(A_below - A_above) = fy·(2·A_below - A)
            a_below = min(max((P_targets[i] / fy + A_fib) / 2.0, 0.0), A_fib)
            j = int(np.searchsorted(cum, a_below, side='right')) - 1
            j = min(max(j, 0), len(a_lev) - 1)
            s_lev = np.where(np.arange(len(a_lev)) < j, 1.0, -1.0)
            frac = (a_below - cum[j]) / a_lev[j] if a_lev[j] > 0 else 0.0
            s_lev[j] = 2.0 * frac - 1.0
            force = fy * fib_a * s_lev[inv]

            P_grid[i, k] = np.sum(force)
            M11_grid[i, k] = -np.sum(force * fib_z)  # M about axis 1
            M22_grid[i, k] = -np.sum(force * fib_x)  # M about axis 2

    # --- 정규화 ---
    warnings = []
    normalized = {}
    ref_scale = abs(fy) * A * math.sqrt(max(I11, I22, 0.0) / A) if A > 0 else 0.0

    def _norm(grid, y_val, name, axis_I):
        # 중심선 모델에서 I 가 0(또는 반올림 잡음)이면 yieldMP 의 항복값이 정의되지
        # 않는다(평판 약축: 0° 에서 0, 30° 회전에서 100 같은 임의값).
        defined = (abs(y_val) > 1e-9 * ref_scale
                   and axis_I > 1e-9 * max(I11, I22, 1e-300))
        normalized[name] = bool(defined)
        if defined:
            return grid / y_val
        warnings.append(
            f'{name}_y is not defined for this section (centerline {name[1:]}-axis '
            f'moment of inertia {axis_I:.3g}); the normalized {name} values are left undefined (null) — '
            f'use {name}_raw.')
        return np.full_like(grid, np.nan)

    if abs(Py) > 0:
        P_n = P_grid / Py
        normalized['P'] = True
    else:
        P_n = np.full_like(P_grid, np.nan)
        normalized['P'] = False
        warnings.append('Py is zero; the normalized P values are left undefined (null) — use P_raw.')
    M11_n = _norm(M11_grid, M11_y, 'M11', I11)
    M22_n = _norm(M22_grid, M22_y, 'M22', I22)

    return {
        'P': P_n,
        'M11': M11_n,
        'M22': M22_n,
        'P_raw': P_grid,
        'M11_raw': M11_grid,
        'M22_raw': M22_grid,
        'Py': float(Py),
        'M11_y': float(M11_y),
        'M22_y': float(M22_y),
        'Mxx_y': float(Mxx_y),
        'Mzz_y': float(Mzz_y),
        'thetap': float(thetap),
        'fy': float(fy),
        'n_theta': n_theta,
        'n_na': n_na,
        'n_thick': n_thick,
        'normalized': normalized,
        'warnings': warnings,
        'assumptions': [
            f'Rigid-plastic fibres at +/-fy = {float(fy):g} over the gross section '
            f'({n_thick} through-thickness fibre(s) per element); normalized by the '
            'first-yield values Py, M11_y, M22_y of the centerline model.'],
        'scope_notes': list(PLASTIC_SCOPE_NOTES),
    }


def _create_fibers(node: np.ndarray, elem: np.ndarray,
                   n_fibers_per_elem: int = None, n_thick: int = 10) -> list:
    """요소를 파이버로 이산화 (길이 방향 × 두께 방향 격자)

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5) — 1-based
        n_fibers_per_elem: 요소 길이 방향 파이버 수. None이면 요소 길이에 따라
            요소마다 max(10, int(L/0.1)) 개로 자동 분할한다(아래 참조).
        n_thick: 두께 방향 파이버 수. fiber4elem.m 처럼 중심선에 수직으로
            -t/2 + t/NL/2 … +t/2 - t/NL/2 에 둔다.

    Returns:
        list of (x, z, area) tuples

    Note:
        기본값(None)일 때 요소당 파이버 수를 길이 기반으로 산정하여
        engine.properties._calc_plastic_modulus 와 일치시킨다
        (요소당 최소 10개, 길이가 길면 0.1 길이마다 1개). 고정된 4개는
        긴 웹/플랜지 요소에서 응력 분포를 과소이산화하여 상호작용곡면이
        들쭉날쭉해지므로, 곡면 매끄러움을 위해 밀도를 높인다.
    """
    n_thick = max(1, int(n_thick))
    fibers = []
    nelems = elem.shape[0]

    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        t = elem[e, 3]

        xi, zi = node[ni, 1], node[ni, 2]
        xj, zj = node[nj, 1], node[nj, 2]

        L = math.sqrt((xj - xi)**2 + (zj - zi)**2)
        if L == 0.0:
            continue
        # 길이 기반 분할 (properties._calc_plastic_modulus 와 동일)
        n_fib = n_fibers_per_elem if n_fibers_per_elem is not None \
            else max(10, int(L / 0.1))
        area = (L / n_fib) * (t / n_thick)
        # 중심선의 단위 법선
        nx, nz = -(zj - zi) / L, (xj - xi) / L

        for f in range(n_fib):
            frac = (f + 0.5) / n_fib
            x = xi + frac * (xj - xi)
            z = zi + frac * (zj - zi)
            for k in range(n_thick):
                off = -t / 2 + t / n_thick * (k + 0.5)
                fibers.append((x + off * nx, z + off * nz, area))

    return fibers
