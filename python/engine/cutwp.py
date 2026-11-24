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
               J, Xs, Zs, Cw, B1, B2, warp, nan_substituted}

    Raises:
        ValueError — _cutwp_prop2 가 거절한 모델(끊어진 모델, 다세포, 0 길이 요소, t ≤ 0)
    """
    from cfsm.base_vectors import _cutwp_prop2

    # _cutwp_prop2는 coord(nnodes,2)=[x,z]와 ends(nelems,3)=[ni,nj,t] 형식
    coord = node[:, 1:3].copy()   # (nnodes, 2) [x, z]
    ends = elem[:, 1:4].copy()    # (nelems, 3) [nodei(1b), nodej(1b), t]

    (A, xcg, zcg, Ixx, Izz, Ixz, thetap, I11, I22,
     J, Xs, Zs, Cw, B1, B2, wn) = _cutwp_prop2(coord, ends)

    # thetap는 _cutwp_prop2에서 라디안으로 반환됨 → 도(degrees)로 변환
    thetap_deg = math.degrees(thetap)

    # _cutwp_prop2 는 셀(폐단면, 셀+가지)에서도 전단중심 · Cw · B1 · B2 · wn 을 유한값으로
    # 준다(Saint-Venant 뒤틀림 함수; RHS 의 Cw 는 0 이 아니다 — 덮어쓰지 않는다).
    # 끊어진 모델 · 다세포 · 0 길이 · t ≤ 0 은 ValueError 로 올라오며 여기서 잡지 않는다.
    # 아래 대체는 그래도 NaN 이 오는 경우의 JSON 안전장치일 뿐이고, 대체한 항목은
    # 'nan_substituted' 에 남겨 호출자가 '계산하지 못함' 으로 다루게 한다.
    substituted = []

    def _safe(name, val, default=0.0):
        try:
            bad = math.isnan(float(val))
        except (TypeError, ValueError):
            bad = False
        if bad:
            substituted.append(name)
            return default
        return val

    Xs = _safe('Xs', Xs, xcg)
    Zs = _safe('Zs', Zs, zcg)
    Cw = _safe('Cw', Cw, 0.0)
    B1 = _safe('B1', B1, 0.0)
    B2 = _safe('B2', B2, 0.0)

    if isinstance(wn, np.ndarray) and np.any(np.isnan(wn)):
        substituted.append('warp')
        wn = np.zeros(node.shape[0])

    return {
        'A': A, 'xcg': xcg, 'zcg': zcg,
        'Ixx': Ixx, 'Izz': Izz, 'Ixz': Ixz,
        'thetap': thetap_deg, 'I11': I11, 'I22': I22,
        'J': J, 'Xs': Xs, 'Zs': Zs,
        'Cw': Cw, 'B1': B1, 'B2': B2,
        'warp': wn.tolist() if isinstance(wn, np.ndarray) else [0.0] * node.shape[0],
        'nan_substituted': substituted,
    }
