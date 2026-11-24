"""fcFSM 단면 해석 자리 (SecAnal_fcFSM.m 의 이식이 아니다)

이식 대상: Ref_Source/analysis/fcFSM/SecAnal_fcFSM.m (판 단위 힘 [q] 로 C_L, J_D,
J_GD 를 만든다). 이 모듈은 그것을 하지 않는다: 길이 100 · S-S · m=1 의 고전 cFSM
자연기저를 돌려주고, 이웃 요소와 5° 넘게 꺾인 요소를 '곡선'으로 표시할 뿐이다
(예리한 모서리 옆 요소도 곡선으로 잡힌다). stripmain_fcfsm 은 이제 이것을 쓰지
않는다.
"""

import math

import numpy as np

from cfsm.node_utils import base_properties
from cfsm.base_vectors import base_column


def section_analysis_fcfsm(node: np.ndarray, elem: np.ndarray,
                            prop: np.ndarray) -> dict:
    """고정 길이(100)·S-S·m=1 의 고전 cFSM 자연기저 + 요소 꺾임 표시 (fcFSM 아님)

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
    nelems = elem.shape[0]

    # 절점 분류 — base_properties로 모든 데이터 한번에 획득
    (elprop_arr, m_node, m_elem, node_prop,
     nmno, ncno, nsno, ndm, nlm, DOFperm) = base_properties(node, elem)

    # 요소 분류: 평판 vs 곡선
    flat_elems = []
    curved_elems = []

    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        is_curved = _is_curved_element(e, ni, nj, elem, node)
        if is_curved:
            curved_elems.append(e)
        else:
            flat_elems.append(e)

    # 기저벡터 생성 — base_column 사용
    m_a = np.array([1.0])
    a = 100.0
    BC = 'S-S'
    b_v_l, ngm, ndm_out, nlm_out = base_column(node, elem, prop, a, BC, m_a)
    basis = b_v_l

    return {
        'basis': basis,
        'ngm': ngm,
        'ndm': ndm_out,
        'nlm': nlm_out,
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
