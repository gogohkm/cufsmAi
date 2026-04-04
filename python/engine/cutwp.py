"""CUTWP — 뒤틀림 단면 성질 계산

참조: 프로젝트개요.md §2 CUTWP 연동
원본: Ref_Source/cutwp/cutwp_prop.m, Ref_Source/helpers/Warp.m

뒤틀림 상수 Cw, 비틀림 상수 J, 전단중심 좌표, 뒤틀림 함수를 계산한다.
"""

import math

import numpy as np


def cutwp_prop(node: np.ndarray, elem: np.ndarray) -> dict:
    """뒤틀림 단면 성질 계산 (전체 구현)

    cfsm/base_vectors.py의 _cutwp_prop2() 알고리즘을 사용하여
    B1, B2, 전단중심, 뒤틀림 함수를 정확히 계산한다.

    Args:
        node: (nnodes, 8) — 절점 좌표 (1-based)
        elem: (nelems, 5) — 요소 (1-based)

    Returns:
        dict: {A, xcg, zcg, Ixx, Izz, Ixz, thetap, I11, I22,
               J, Xs, Zs, Cw, B1, B2, warp}
    """
    from cfsm.base_vectors import _cutwp_prop2

    # _cutwp_prop2는 coord(nnodes,2)=[x,z]와 ends(nelems,3)=[ni,nj,t] 형식
    coord = node[:, 1:3].copy()   # (nnodes, 2) [x, z]
    ends = elem[:, 1:4].copy()    # (nelems, 3) [nodei(1b), nodej(1b), t]

    (A, xcg, zcg, Ixx, Izz, Ixz, thetap, I11, I22,
     J, Xs, Zs, Cw, B1, B2, wn) = _cutwp_prop2(coord, ends)

    # thetap는 _cutwp_prop2에서 라디안으로 반환됨 → 도(degrees)로 변환
    thetap_deg = math.degrees(thetap)

    # wn이 nan인 경우 (폐단면) 0으로 대체
    if isinstance(wn, np.ndarray) and np.any(np.isnan(wn)):
        wn = np.zeros(node.shape[0])

    return {
        'A': A, 'xcg': xcg, 'zcg': zcg,
        'Ixx': Ixx, 'Izz': Izz, 'Ixz': Ixz,
        'thetap': thetap_deg, 'I11': I11, 'I22': I22,
        'J': J, 'Xs': Xs, 'Zs': Zs,
        'Cw': Cw, 'B1': B1, 'B2': B2,
        'warp': wn.tolist() if isinstance(wn, np.ndarray) else [0.0] * node.shape[0],
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
