"""fcFSM 단면 해석

원본: Ref_Source/analysis/fcFSM/SecAnal_fcFSM.m

단면의 평판/곡선 요소를 식별하고 힘 기반 구속행렬을 구성한다.
"""

import math

import numpy as np

from cfsm.node_utils import node_class, mode_nr
from cfsm.base_vectors import _create_base_vectors_simple
from engine.properties import elemprop


def section_analysis_fcfsm(node: np.ndarray, elem: np.ndarray,
                            prop: np.ndarray) -> dict:
    """fcFSM 단면 해석 — 기저벡터 생성

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5)
        prop: (nmats, 6)

    Returns:
        dict: {
            'basis': np.ndarray — 기저벡터 행렬,
            'ngm': int, 'ndm': int, 'nlm': int,
            'flat_elems': list, 'curved_elems': list
        }
    """
    nnodes = node.shape[0]
    nelems = elem.shape[0]

    # 절점 분류
    nmno, ncno, nsno, node_prop = node_class(node, elem)
    ngm, ndm, nlm = mode_nr(nmno, ncno, nsno)

    # 요소 분류: 평판 vs 곡선
    elprop_arr = elemprop(node, elem)
    flat_elems = []
    curved_elems = []

    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        # 이웃 요소와의 각도 차이로 곡선 판별
        is_curved = _is_curved_element(e, ni, nj, elem, node)
        if is_curved:
            curved_elems.append(e)
        else:
            flat_elems.append(e)

    # 기저벡터 생성 (단일 m=1 기준)
    basis = _create_base_vectors_simple(
        node, elem, elprop_arr, nnodes, nmno, ncno, nsno,
        ngm, ndm, nlm, 1.0, 100.0, 'S-S'
    )

    return {
        'basis': basis,
        'ngm': ngm,
        'ndm': ndm,
        'nlm': nlm,
        'flat_elems': flat_elems,
        'curved_elems': curved_elems,
    }


def _is_curved_element(e_idx: int, ni: int, nj: int,
                        elem: np.ndarray, node: np.ndarray) -> bool:
    """요소가 곡선 구간에 있는지 판별

    양쪽 이웃 요소와의 방향 변화로 판단.
    """
    angle_e = math.atan2(node[nj, 2] - node[ni, 2],
                          node[nj, 1] - node[ni, 1])

    for e2 in range(elem.shape[0]):
        if e2 == e_idx:
            continue
        n2i = int(elem[e2, 1]) - 1
        n2j = int(elem[e2, 2]) - 1
        # 공유 절점이 있는 이웃
        if n2i == nj or n2j == ni or n2i == ni or n2j == nj:
            angle_2 = math.atan2(node[n2j, 2] - node[n2i, 2],
                                  node[n2j, 1] - node[n2i, 1])
            diff = abs(angle_e - angle_2)
            if diff > math.pi:
                diff = 2 * math.pi - diff
            # 5도 이상 차이 → 곡선
            if diff > math.radians(5):
                return True

    return False
