"""cFSM 단일 m항 행렬 조립 + DOF 재배열

원본: Ref_Source/analysis/cFSM/assemble_m.m, DOF_ordering.m, base_properties.m
"""

import numpy as np
from scipy import sparse

from .node_utils import node_class, mode_nr
from engine.properties import elemprop


def assemble_m(K, Kg, k, kg, nodei, nodej, nnodes):
    """cFSM 단일 m항 행렬 조립 (4*nnodes × 4*nnodes)

    analysis/assemble.m의 단일 m항 버전.
    DOF: [u1,v1,...,un,vn | w1,θ1,...,wn,θn]

    Args:
        K, Kg: 전체 행렬 (4*nnodes × 4*nnodes)
        k, kg: 요소 행렬 (8 × 8)
        nodei, nodej: 절점 번호 (1-based)
        nnodes: 절점 수

    Returns:
        (K, Kg)
    """
    skip = 2 * nnodes

    # 2×2 서브블록 추출
    blocks_k = {}
    blocks_kg = {}
    for a in range(4):
        for b in range(4):
            key = f'{a}{b}'
            blocks_k[key] = k[2*a:2*a+2, 2*b:2*b+2]
            blocks_kg[key] = kg[2*a:2*a+2, 2*b:2*b+2]

    mi = (nodei - 1) * 2  # 멤브레인 시작 (0-based)
    mj = (nodej - 1) * 2
    fi = skip + (nodei - 1) * 2  # 휨 시작
    fj = skip + (nodej - 1) * 2

    # 멤브레인 블록
    K[mi:mi+2, mi:mi+2] += blocks_k['00']
    K[mi:mi+2, mj:mj+2] += blocks_k['01']
    K[mj:mj+2, mi:mi+2] += blocks_k['10']
    K[mj:mj+2, mj:mj+2] += blocks_k['11']

    # 휨 블록
    K[fi:fi+2, fi:fi+2] += blocks_k['22']
    K[fi:fi+2, fj:fj+2] += blocks_k['23']
    K[fj:fj+2, fi:fi+2] += blocks_k['32']
    K[fj:fj+2, fj:fj+2] += blocks_k['33']

    # 커플링
    K[mi:mi+2, fi:fi+2] += blocks_k['02']
    K[mi:mi+2, fj:fj+2] += blocks_k['03']
    K[mj:mj+2, fi:fi+2] += blocks_k['12']
    K[mj:mj+2, fj:fj+2] += blocks_k['13']
    K[fi:fi+2, mi:mi+2] += blocks_k['20']
    K[fi:fi+2, mj:mj+2] += blocks_k['21']
    K[fj:fj+2, mi:mi+2] += blocks_k['30']
    K[fj:fj+2, mj:mj+2] += blocks_k['31']

    # Kg 동일
    Kg[mi:mi+2, mi:mi+2] += blocks_kg['00']
    Kg[mi:mi+2, mj:mj+2] += blocks_kg['01']
    Kg[mj:mj+2, mi:mi+2] += blocks_kg['10']
    Kg[mj:mj+2, mj:mj+2] += blocks_kg['11']
    Kg[fi:fi+2, fi:fi+2] += blocks_kg['22']
    Kg[fi:fi+2, fj:fj+2] += blocks_kg['23']
    Kg[fj:fj+2, fi:fi+2] += blocks_kg['32']
    Kg[fj:fj+2, fj:fj+2] += blocks_kg['33']
    Kg[mi:mi+2, fi:fi+2] += blocks_kg['02']
    Kg[mi:mi+2, fj:fj+2] += blocks_kg['03']
    Kg[mj:mj+2, fi:fi+2] += blocks_kg['12']
    Kg[mj:mj+2, fj:fj+2] += blocks_kg['13']
    Kg[fi:fi+2, mi:mi+2] += blocks_kg['20']
    Kg[fi:fi+2, mj:mj+2] += blocks_kg['21']
    Kg[fj:fj+2, mi:mi+2] += blocks_kg['30']
    Kg[fj:fj+2, mj:mj+2] += blocks_kg['31']

    return K, Kg


def DOF_ordering(node: np.ndarray, elem: np.ndarray) -> np.ndarray:
    """DOF 재배열 순열 행렬 생성

    GBT 규약에 따라 DOF를 재배열:
    [y_main | x_corner | z_corner | x_edge | z_edge | theta_main | y_sub | ...]

    Returns:
        DOFperm: (4*nnodes, 4*nnodes) 순열 행렬
    """
    nnodes = node.shape[0]
    nmno, ncno, nsno, node_prop = node_class(node, elem)
    neno = nmno - ncno
    ndof = 4 * nnodes
    skip = 2 * nnodes

    # 절점 분류
    corner_nodes = []
    edge_nodes = []
    sub_nodes = []
    for i in range(nnodes):
        if node_prop[i, 3] == 1:
            if len([e for e in range(elem.shape[0])
                    if int(elem[e, 1]) - 1 == i or int(elem[e, 2]) - 1 == i]) <= 1:
                corner_nodes.append(i)  # 단부
            else:
                corner_nodes.append(i)  # 코너
        elif node_prop[i, 3] == 3:
            sub_nodes.append(i)
        else:
            edge_nodes.append(i)

    main_nodes = corner_nodes + edge_nodes

    # 새 DOF 순서 구축
    new_order = []

    # y DOF of main nodes (v)
    for n in main_nodes:
        new_order.append(2 * n + 1)  # v

    # x DOF of corner nodes (u)
    for n in corner_nodes:
        new_order.append(2 * n)  # u

    # z DOF of corner nodes (w)
    for n in corner_nodes:
        new_order.append(skip + 2 * n)  # w

    # theta of main nodes
    for n in main_nodes:
        new_order.append(skip + 2 * n + 1)  # theta

    # 나머지 DOF (edge u/z, sub 전체)
    all_used = set(new_order)
    for i in range(ndof):
        if i not in all_used:
            new_order.append(i)

    # 순열 행렬
    DOFperm = np.zeros((ndof, ndof))
    for new_idx, old_idx in enumerate(new_order[:ndof]):
        if old_idx < ndof:
            DOFperm[new_idx, old_idx] = 1.0

    return DOFperm


def base_properties(node: np.ndarray, elem: np.ndarray) -> dict:
    """cFSM 기저 물성 — 절점 분류, 모드 수, DOF 순열 일괄 반환

    Returns:
        dict with keys: elprop, node_prop, nmno, ncno, nsno, ngm, ndm, nlm, DOFperm
    """
    nmno, ncno, nsno, node_prop = node_class(node, elem)
    ngm, ndm, nlm = mode_nr(nmno, ncno, nsno)
    elprop_arr = elemprop(node, elem)
    DOFperm = DOF_ordering(node, elem)

    return {
        'elprop': elprop_arr,
        'node_prop': node_prop,
        'nmno': nmno,
        'ncno': ncno,
        'nsno': nsno,
        'ngm': ngm,
        'ndm': ndm,
        'nlm': nlm,
        'DOFperm': DOFperm,
    }
