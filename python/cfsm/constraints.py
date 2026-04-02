"""cFSM 구속행렬 생성

원본: Ref_Source/analysis/cFSM/constr_*.m (6개)

GBT 기반 변위장 구속행렬을 생성하여
모드 분류의 물리적 정확성을 보장한다.
"""

import math

import numpy as np
from scipy.linalg import solve

from .node_utils import node_class


def constr_xz_y(node: np.ndarray, elem: np.ndarray,
                node_prop: np.ndarray) -> tuple:
    """x,z 변위를 y 변위(종방향)로 구속

    코너 절점의 x,z 변위를 주절점의 y 변위로부터 계산한다.
    GBT의 Vlasov 가정: 단면이 면내 변형 없이 변위

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5) — 1-based
        node_prop: (nnodes, 4) — 절점 분류

    Returns:
        (Rx, Rz): 각각 (ncno, nmno) 행렬
    """
    nnodes = node.shape[0]
    nelems = elem.shape[0]
    nmno, ncno, nsno, _ = node_class(node, elem)

    Rx = np.zeros((ncno, nmno))
    Rz = np.zeros((ncno, nmno))

    # 메타 요소 구축 (주절점 간 연결)
    # 주절점 인덱스 (node_prop type != 3)
    main_nodes = [i for i in range(nnodes) if node_prop[i, 3] != 3]
    main_map = {main_nodes[i]: i for i in range(len(main_nodes))}

    # 코너 절점 인덱스
    corner_nodes = [i for i in range(nnodes) if node_prop[i, 3] == 1]

    # 각 코너 절점에 대해 인접 요소의 방향으로 Rx, Rz 계산
    for k, cn in enumerate(corner_nodes):
        # cn에 인접한 요소 찾기
        adj_elems = []
        for e in range(nelems):
            ni = int(elem[e, 1]) - 1
            nj = int(elem[e, 2]) - 1
            if ni == cn or nj == cn:
                other = nj if ni == cn else ni
                dx = node[other, 1] - node[cn, 1]
                dz = node[other, 2] - node[cn, 2]
                dist = math.sqrt(dx**2 + dz**2)
                if dist > 1e-12:
                    adj_elems.append({
                        'other': other,
                        'angle': math.atan2(dz, dx),
                        'length': dist,
                    })

        if len(adj_elems) < 2:
            # 단부 절점 — 단일 방향
            if len(adj_elems) == 1:
                ae = adj_elems[0]
                other_idx = main_map.get(ae['other'])
                cn_idx = main_map.get(cn)
                if other_idx is not None and cn_idx is not None:
                    r = 1.0 / ae['length']
                    Rx[k, cn_idx] = -r * math.sin(ae['angle'])
                    Rx[k, other_idx] = r * math.sin(ae['angle'])
                    Rz[k, cn_idx] = r * math.cos(ae['angle'])
                    Rz[k, other_idx] = -r * math.cos(ae['angle'])
            continue

        # 2개 이상 인접 → 첫 2개 사용
        e1, e2 = adj_elems[0], adj_elems[1]
        a1, a2 = e1['angle'], e2['angle']
        r1 = 1.0 / e1['length']
        r2 = 1.0 / e2['length']
        det = math.sin(a2 - a1)

        if abs(det) < 1e-12:
            continue

        cn_idx = main_map.get(cn)
        o1_idx = main_map.get(e1['other'])
        o2_idx = main_map.get(e2['other'])

        if cn_idx is None:
            continue

        s1, c1 = math.sin(a1), math.cos(a1)
        s2, c2 = math.sin(a2), math.cos(a2)

        # Rx 계산
        if o1_idx is not None:
            Rx[k, o1_idx] = s2 * r1 / det
        if o2_idx is not None:
            Rx[k, o2_idx] = -s1 * r2 / det
        if cn_idx is not None:
            Rx[k, cn_idx] = (-s2 * r1 + s1 * r2) / det

        # Rz 계산
        if o1_idx is not None:
            Rz[k, o1_idx] = -c2 * r1 / det
        if o2_idx is not None:
            Rz[k, o2_idx] = c1 * r2 / det
        if cn_idx is not None:
            Rz[k, cn_idx] = (c2 * r1 - c1 * r2) / det

    return Rx, Rz


def constr_ys_ym(node: np.ndarray, elem: np.ndarray,
                 node_prop: np.ndarray) -> np.ndarray:
    """부절점 y변위를 주절점 y변위로 선형 보간

    Returns:
        Rys: (nsno, nmno) 행렬
    """
    nnodes = node.shape[0]
    nmno, ncno, nsno, _ = node_class(node, elem)

    if nsno == 0:
        return np.zeros((0, nmno))

    main_nodes = [i for i in range(nnodes) if node_prop[i, 3] != 3]
    sub_nodes = [i for i in range(nnodes) if node_prop[i, 3] == 3]
    main_map = {main_nodes[i]: i for i in range(len(main_nodes))}

    Rys = np.zeros((nsno, nmno))

    for s_idx, sn in enumerate(sub_nodes):
        # 부절점에 인접한 요소의 양 끝점(주절점) 찾기
        neighbors = []
        for e in range(elem.shape[0]):
            ni = int(elem[e, 1]) - 1
            nj = int(elem[e, 2]) - 1
            if ni == sn and nj in main_map:
                neighbors.append(nj)
            elif nj == sn and ni in main_map:
                neighbors.append(ni)

        if len(neighbors) >= 2:
            n1, n2 = neighbors[0], neighbors[1]
            # 거리 비율로 보간
            d1 = math.sqrt((node[sn, 1] - node[n1, 1])**2 + (node[sn, 2] - node[n1, 2])**2)
            d2 = math.sqrt((node[sn, 1] - node[n2, 1])**2 + (node[sn, 2] - node[n2, 2])**2)
            total = d1 + d2
            if total > 1e-12:
                Rys[s_idx, main_map[n1]] = d2 / total
                Rys[s_idx, main_map[n2]] = d1 / total

    return Rys


def constr_yd_yg(node: np.ndarray, elem: np.ndarray,
                 node_prop: np.ndarray, Rys: np.ndarray,
                 nmno: int) -> np.ndarray:
    """뒤틀림 모드 기저를 전체 모드 기저로 변환

    Returns:
        Ryd: (nmno, nmno) 행렬
    """
    nnodes = node.shape[0]
    nelems = elem.shape[0]

    # 질량 유사 행렬 A 구축
    A = np.zeros((nnodes, nnodes))
    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        t = elem[e, 3]
        dx = node[nj, 1] - node[ni, 1]
        dz = node[nj, 2] - node[ni, 2]
        L = math.sqrt(dx**2 + dz**2)
        w = L * t
        A[ni, ni] += w / 3
        A[nj, nj] += w / 3
        A[ni, nj] += w / 6
        A[nj, ni] += w / 6

    # Rysm = [I(nmno); Rys]
    nsno = Rys.shape[0] if Rys.size > 0 else 0
    Rysm = np.eye(nmno)
    if nsno > 0:
        Rysm = np.vstack([np.eye(nmno), Rys])

    # Ryd = Rysm' * A_sub * Rysm
    n_total = nmno + nsno
    A_sub = A[:n_total, :n_total]
    Ryd = Rysm.T @ A_sub @ Rysm

    return Ryd


def constr_user(node: np.ndarray, constraints: np.ndarray,
                m_a: np.ndarray) -> np.ndarray:
    """사용자 정의 구속행렬

    고정 DOF 제거 + master-slave 구속 적용

    Args:
        node: (nnodes, 8)
        constraints: (nconstraints, 5) [node_e, dof_e, coeff, node_k, dof_k]
        m_a: 종방향 항

    Returns:
        Ruser: (ndof*totalm, n_free_dof*totalm) 구속행렬
    """
    nnodes = node.shape[0]
    totalm = len(m_a)
    ndof = 4 * nnodes

    blocks = []
    for ml in range(totalm):
        Rm = np.eye(ndof)
        dof_free = np.ones(ndof, dtype=bool)

        # 고정 DOF 제거
        skip = 2 * nnodes
        for n in range(nnodes):
            if node[n, 3] == 0:  # dofx
                dof_free[2 * n] = False
            if node[n, 4] == 0:  # dofz
                dof_free[2 * n + 1] = False
            if node[n, 5] == 0:  # dofy
                dof_free[skip + 2 * n] = False
            if node[n, 6] == 0:  # dofrot
                dof_free[skip + 2 * n + 1] = False

        # Master-slave 구속 적용
        if constraints is not None and constraints.size > 0 and constraints.ndim == 2:
            for c in range(constraints.shape[0]):
                # slave DOF에 master DOF의 계수를 곱해서 추가
                node_e = int(constraints[c, 0]) - 1  # slave node (0-based)
                dof_e = int(constraints[c, 1])        # slave DOF index
                coeff = constraints[c, 2]
                node_k = int(constraints[c, 3]) - 1  # master node
                dof_k = int(constraints[c, 4])        # master DOF index

                # DOF 인덱스 매핑
                s_idx = _dof_index(node_e, dof_e, nnodes)
                m_idx = _dof_index(node_k, dof_k, nnodes)

                if s_idx >= 0 and m_idx >= 0:
                    Rm[:, m_idx] += coeff * Rm[:, s_idx]
                    dof_free[s_idx] = False

        # 자유 DOF만 남김
        Rm_reduced = Rm[:, dof_free]
        blocks.append(Rm_reduced)

    # 블록 대각 조립
    from scipy.linalg import block_diag
    return block_diag(*blocks)


def _dof_index(node_idx: int, dof_type: int, nnodes: int) -> int:
    """DOF 유형(1~4)을 전체 인덱스로 변환"""
    skip = 2 * nnodes
    if dof_type == 1:
        return 2 * node_idx          # u
    elif dof_type == 2:
        return 2 * node_idx + 1      # v
    elif dof_type == 3:
        return skip + 2 * node_idx   # w
    elif dof_type == 4:
        return skip + 2 * node_idx + 1  # theta
    return -1
