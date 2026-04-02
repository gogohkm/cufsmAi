"""cFSM 절점 분류 유틸리티

순환 import 방지를 위해 classify.py와 base_vectors.py에서 공통 사용하는
절점 분류 함수를 별도 모듈로 분리.
"""

import numpy as np


def node_class(node: np.ndarray, elem: np.ndarray) -> tuple:
    """절점 분류 — 코너/에지/내부

    Returns:
        (nmno, ncno, nsno, node_prop)
    """
    nnodes = node.shape[0]
    nelems = elem.shape[0]

    adj_count = np.zeros(nnodes, dtype=int)
    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        adj_count[ni] += 1
        adj_count[nj] += 1

    node_prop = np.zeros((nnodes, 4))
    ncno = 0
    nsno = 0

    for i in range(nnodes):
        node_prop[i, 0] = i + 1
        node_prop[i, 1] = i + 1
        node_prop[i, 2] = adj_count[i]

        if adj_count[i] != 2:
            node_prop[i, 3] = 1
            ncno += 1
        else:
            neighbors = _get_neighbor_angles(i, elem, node)
            if neighbors is not None and abs(neighbors) < 0.01:
                node_prop[i, 3] = 3
                nsno += 1
            else:
                node_prop[i, 3] = 1
                ncno += 1

    nmno = nnodes - nsno
    return nmno, ncno, nsno, node_prop


def mode_nr(nmno: int, ncno: int, nsno: int) -> tuple:
    """모드 수 결정

    Returns:
        (ngm, ndm, nlm)
    """
    neno = nmno - ncno
    ngm = 4
    ndm = max(0, nmno - 4)
    nlm = nmno + 2 * nsno + neno
    return ngm, ndm, nlm


def _get_neighbor_angles(node_idx: int, elem: np.ndarray, node: np.ndarray):
    angles = []
    for e in range(elem.shape[0]):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        if ni == node_idx or nj == node_idx:
            xi, zi = node[ni, 1], node[ni, 2]
            xj, zj = node[nj, 1], node[nj, 2]
            angle = np.arctan2(zj - zi, xj - xi)
            if nj == node_idx:
                angle += np.pi
            angles.append(angle)
    if len(angles) == 2:
        diff = abs(angles[0] - angles[1])
        if diff > np.pi:
            diff = 2 * np.pi - diff
        return abs(diff - np.pi)
    return None
