"""CUTWP — 뒤틀림 단면 성질 계산

참조: 프로젝트개요.md §2 CUTWP 연동
원본: Ref_Source/cutwp/cutwp_prop.m, Ref_Source/helpers/Warp.m

뒤틀림 상수 Cw, 비틀림 상수 J, 전단중심 좌표, 뒤틀림 함수를 계산한다.
"""

import math

import numpy as np


def cutwp_prop(node: np.ndarray, elem: np.ndarray) -> dict:
    """뒤틀림 단면 성질 계산

    Args:
        node: (nnodes, 8) — 절점 좌표 (1-based)
        elem: (nelems, 5) — 요소 (1-based)

    Returns:
        dict: {A, xcg, zcg, Ixx, Izz, Ixz, thetap, I11, I22,
               J, Xs, Zs, Cw, B1, B2, warp}
    """
    from .properties import grosprop

    nnodes = node.shape[0]
    nelems = elem.shape[0]

    # 기본 단면 성질
    props = grosprop(node, elem)
    A = props['A']
    xcg = props['xcg']
    zcg = props['zcg']
    Ixx = props['Ixx']
    Izz = props['Izz']
    Ixz = props['Ixz']
    thetap = props['thetap']
    I11 = props['I11']
    I22 = props['I22']

    # 주축 각도
    th = math.radians(thetap)
    c = math.cos(th)
    s = math.sin(th)

    # 비틀림 상수 J = sum(L * t^3 / 3)
    J = 0.0
    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        t = elem[e, 3]
        dx = node[nj, 1] - node[ni, 1]
        dz = node[nj, 2] - node[ni, 2]
        L = math.sqrt(dx**2 + dz**2)
        J += L * t**3 / 3.0

    # 전단중심 계산 (단순화: 개단면 가정)
    # 각 요소의 수직 거리 적분으로 전단흐름 계산
    # VX = ∫(z - zcg) * t * ds, VZ = ∫(x - xcg) * t * ds
    # 전단중심: Xs = -(VX와 관련된 적분) / Ixx, Zs = (VZ 관련) / Izz

    # 뒤틀림 함수 w(s) 계산 — 도심 기준 섹토리얼 좌표
    w = np.zeros(nnodes)

    # 시작 절점: 첫 번째 요소의 첫 절점
    # 연결 순서대로 뒤틀림 함수 누적
    visited = set()
    node_order = _trace_section_path(elem, nnodes)

    # 섹토리얼 좌표: w(s) = ∫₀ˢ r_perp ds
    # r_perp = 도심으로부터 요소에 수직인 거리
    for idx in range(1, len(node_order)):
        prev = node_order[idx - 1]
        curr = node_order[idx]

        x1, z1 = node[prev, 1] - xcg, node[prev, 2] - zcg
        x2, z2 = node[curr, 1] - xcg, node[curr, 2] - zcg

        # 수직 거리 (cross product) = r_perp * ds
        # w += (x1*z2 - x2*z1) / 2  (삼각형 면적의 2배)
        w[curr] = w[prev] + (x1 * z2 - x2 * z1)

    # w 평균 제거 (면적 가중)
    w_avg = 0.0
    total_tL = 0.0
    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        t = elem[e, 3]
        dx = node[nj, 1] - node[ni, 1]
        dz = node[nj, 2] - node[ni, 2]
        L = math.sqrt(dx**2 + dz**2)
        w_avg += t * L * (w[ni] + w[nj]) / 2.0
        total_tL += t * L

    if total_tL > 0:
        w -= w_avg / total_tL

    # 뒤틀림 상수 Cw = ∫ w² * t * ds
    Cw = 0.0
    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        t = elem[e, 3]
        dx = node[nj, 1] - node[ni, 1]
        dz = node[nj, 2] - node[ni, 2]
        L = math.sqrt(dx**2 + dz**2)
        wa = w[ni]
        wb = w[nj]
        dw = wb - wa
        Cw += t * (wa**2 * L + dw**2 * L / 3.0 + wa * dw * L)

    # 전단중심 (간소화: 섹토리얼 1차 모멘트 기반)
    Swx = 0.0  # ∫ w * z * t * ds
    Swz = 0.0  # ∫ w * x * t * ds
    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        t = elem[e, 3]
        dx = node[nj, 1] - node[ni, 1]
        dz = node[nj, 2] - node[ni, 2]
        L = math.sqrt(dx**2 + dz**2)
        xm = (node[ni, 1] + node[nj, 1]) / 2.0 - xcg
        zm = (node[ni, 2] + node[nj, 2]) / 2.0 - zcg
        wm = (w[ni] + w[nj]) / 2.0
        Swx += wm * zm * t * L
        Swz += wm * xm * t * L

    denom_xx = Ixx if abs(Ixx) > 1e-20 else 1
    denom_zz = Izz if abs(Izz) > 1e-20 else 1
    Xs = xcg - Swx / denom_xx
    Zs = zcg + Swz / denom_zz

    # 비대칭 파라미터 B1, B2 (간소화)
    B1 = 0.0
    B2 = 0.0

    return {
        'A': A, 'xcg': xcg, 'zcg': zcg,
        'Ixx': Ixx, 'Izz': Izz, 'Ixz': Ixz,
        'thetap': thetap, 'I11': I11, 'I22': I22,
        'J': J, 'Xs': Xs, 'Zs': Zs,
        'Cw': Cw, 'B1': B1, 'B2': B2,
        'warp': w.tolist(),
    }


def _trace_section_path(elem: np.ndarray, nnodes: int) -> list:
    """요소 연결 순서대로 절점 경로 추적 (개단면)"""
    adj = {i: [] for i in range(nnodes)}
    for e in range(elem.shape[0]):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        adj[ni].append(nj)
        adj[nj].append(ni)

    # 단부 절점 찾기 (인접 1개)
    start = 0
    for n in range(nnodes):
        if len(adj[n]) == 1:
            start = n
            break

    # DFS로 경로 추적
    path = [start]
    visited = {start}
    current = start
    while True:
        found = False
        for neighbor in adj[current]:
            if neighbor not in visited:
                path.append(neighbor)
                visited.add(neighbor)
                current = neighbor
                found = True
                break
        if not found:
            break

    return path
