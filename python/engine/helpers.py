"""CUFSM 헬퍼 함수 모음

원본: Ref_Source/helpers/ 및 Ref_Source/analysis/ 내 유틸리티
      doubler.m, add_corner.m, master_slave.m, signature_ss.m,
      firstyield.m, energy_recovery.m, stress_to_action.m, msort.m
"""

import math

import numpy as np


def doubler(node: np.ndarray, elem: np.ndarray) -> tuple:
    """메시 세분화 — 각 요소의 중간점에 절점 삽입하여 요소 수 2배

    Args:
        node: (nnodes, 8), elem: (nelems, 5) — MATLAB 1-based

    Returns:
        (node_out, elem_out)
    """
    nnodes = node.shape[0]
    nelems = elem.shape[0]

    new_nodes = []
    new_elems = []

    # 기존 절점 복사
    for i in range(nnodes):
        new_nodes.append(node[i].copy())

    # 각 요소마다 중간점 생성
    mid_node_id = nnodes + 1  # 1-based
    for e in range(nelems):
        ni = int(elem[e, 1])
        nj = int(elem[e, 2])
        t = elem[e, 3]
        mat = elem[e, 4]

        # 중간점 좌표/응력 평균
        xi = node[ni - 1, 1]
        zi = node[ni - 1, 2]
        xj = node[nj - 1, 1]
        zj = node[nj - 1, 2]
        si = node[ni - 1, 7]
        sj = node[nj - 1, 7]

        xm = (xi + xj) / 2.0
        zm = (zi + zj) / 2.0
        sm = (si + sj) / 2.0

        new_nodes.append([mid_node_id, xm, zm, 1, 1, 1, 1, sm])

        # 2개 하위 요소
        new_elems.append([len(new_elems) + 1, ni, mid_node_id, t, mat])
        new_elems.append([len(new_elems) + 1, mid_node_id, nj, t, mat])

        mid_node_id += 1

    node_out = np.array(new_nodes)
    elem_out = np.array(new_elems)
    # elem 번호 재정렬
    elem_out[:, 0] = np.arange(1, elem_out.shape[0] + 1)

    return node_out, elem_out


def add_corner(node: np.ndarray, elem: np.ndarray,
               e1_idx: int, e2_idx: int, r: float, n_arc: int = 4) -> tuple:
    """코너에 필릿(호) 추가

    Args:
        node, elem: 모델 데이터 (1-based)
        e1_idx, e2_idx: 공유 절점을 가진 두 요소 번호 (1-based)
        r: 필릿 반경
        n_arc: 호 분할 수

    Returns:
        (node_out, elem_out)
    """
    node = node.copy()
    elem = elem.copy()

    # 공유 절점 찾기
    e1 = elem[e1_idx - 1]
    e2 = elem[e2_idx - 1]
    ni1, nj1 = int(e1[1]), int(e1[2])
    ni2, nj2 = int(e2[1]), int(e2[2])

    shared = set([ni1, nj1]) & set([ni2, nj2])
    if not shared:
        return node, elem
    k = shared.pop()  # 공유 절점 (1-based)

    # 먼 절점
    far1 = nj1 if ni1 == k else ni1
    far2 = nj2 if ni2 == k else ni2

    xk, zk = node[k - 1, 1], node[k - 1, 2]
    x1, z1 = node[far1 - 1, 1], node[far1 - 1, 2]
    x2, z2 = node[far2 - 1, 1], node[far2 - 1, 2]

    a1 = math.atan2(xk - x1, zk - z1)  # e1 방향 (k→far1 반대)
    a2 = math.atan2(x2 - xk, z2 - zk)  # e2 방향

    # 두 방향 사이 각도
    d_ang = a2 - a1
    while d_ang > math.pi: d_ang -= 2 * math.pi
    while d_ang < -math.pi: d_ang += 2 * math.pi

    theta = abs(d_ang)
    if theta < 0.01:
        return node, elem  # 거의 직선

    # 접선 길이
    d = r * math.tan(theta / 2)

    # 접점 A (e1 쪽), B (e2 쪽)
    dir1x = x1 - xk
    dir1z = z1 - zk
    len1 = math.sqrt(dir1x**2 + dir1z**2)
    dir2x = x2 - xk
    dir2z = z2 - zk
    len2 = math.sqrt(dir2x**2 + dir2z**2)

    if d > len1 * 0.9 or d > len2 * 0.9:
        return node, elem  # 반경 너무 큼

    ax = xk + d * dir1x / len1
    az = zk + d * dir1z / len1
    bx = xk + d * dir2x / len2
    bz = zk + d * dir2z / len2

    # 호 중심
    # 각 이등분선 방향
    bisect_x = (dir1x / len1 + dir2x / len2) / 2
    bisect_z = (dir1z / len1 + dir2z / len2) / 2
    bisect_len = math.sqrt(bisect_x**2 + bisect_z**2)
    if bisect_len < 1e-12:
        return node, elem

    R = r / math.cos(theta / 2)
    cx = xk + R * bisect_x / bisect_len
    cz = zk + R * bisect_z / bisect_len

    # 호 절점 생성
    start_ang = math.atan2(az - cz, ax - cx)
    end_ang = math.atan2(bz - cz, bx - cx)
    # 짧은 호 선택
    arc_span = end_ang - start_ang
    while arc_span > math.pi: arc_span -= 2 * math.pi
    while arc_span < -math.pi: arc_span += 2 * math.pi

    t = e1[3]  # 두께
    mat = e1[4]

    new_nodes = list(node)
    new_elems = list(elem)
    arc_node_ids = []

    for i in range(n_arc + 1):
        frac = i / n_arc
        ang = start_ang + arc_span * frac
        nx = cx + r * math.cos(ang)
        nz = cz + r * math.sin(ang)
        stress = node[k - 1, 7]

        nid = len(new_nodes) + 1
        new_nodes.append(np.array([nid, nx, nz, 1, 1, 1, 1, stress]))
        arc_node_ids.append(nid)

    # e1의 끝을 접점 A (첫 번째 호 절점)으로 변경
    for i in range(len(new_elems)):
        if int(new_elems[i][1]) == k:
            new_elems[i] = new_elems[i].copy()
            new_elems[i][1] = arc_node_ids[0]
        if int(new_elems[i][2]) == k:
            new_elems[i] = new_elems[i].copy()
            new_elems[i][2] = arc_node_ids[0]

    # e2의 시작을 접점 B (마지막 호 절점)으로 변경
    for i in range(len(new_elems)):
        if int(new_elems[i][0]) == e2_idx:
            if int(new_elems[i][1]) == k:
                new_elems[i] = new_elems[i].copy()
                new_elems[i][1] = arc_node_ids[-1]
            if int(new_elems[i][2]) == k:
                new_elems[i] = new_elems[i].copy()
                new_elems[i][2] = arc_node_ids[-1]

    # 호 요소 추가
    for i in range(n_arc):
        eid = len(new_elems) + 1
        new_elems.append(np.array([eid, arc_node_ids[i], arc_node_ids[i + 1], t, mat]))

    node_out = np.array(new_nodes)
    elem_out = np.array(new_elems)
    elem_out[:, 0] = np.arange(1, elem_out.shape[0] + 1)

    return node_out, elem_out


def master_slave(master: int, slave_nodes: list,
                 node: np.ndarray) -> np.ndarray:
    """Master-slave 구속 방정식 생성

    slave 절점의 변위를 master 절점의 변위+회전으로 구속

    Args:
        master: master 절점 번호 (1-based)
        slave_nodes: slave 절점 번호 리스트 (1-based)
        node: (nnodes, 8)

    Returns:
        constraints: (3*n_slaves, 5) [node_e, dof_e, coeff, node_k, dof_k]
    """
    xm = node[master - 1, 1]
    zm = node[master - 1, 2]

    rows = []
    for sn in slave_nodes:
        xs = node[sn - 1, 1]
        zs = node[sn - 1, 2]

        dx = xs - xm
        dz = zs - zm
        r = math.sqrt(dx**2 + dz**2)
        theta = math.atan2(dz, dx) if r > 0 else 0

        uq = -r * math.sin(theta)
        wq = r * math.cos(theta)

        # u_slave = u_master + uq * theta_master
        rows.append([sn, 1, 1.0, master, 1])   # u: coeff=1 on u_master
        # w_slave = w_master + wq * theta_master
        rows.append([sn, 3, 1.0, master, 3])   # w: coeff=1 on w_master
        # theta_slave = theta_master
        rows.append([sn, 4, 1.0, master, 4])   # theta: coeff=1

    return np.array(rows) if rows else np.array([]).reshape(0, 5)


def signature_ss(prop: np.ndarray, node: np.ndarray,
                 elem: np.ndarray, neigs: int = 20) -> dict:
    """시그니처 곡선 계산 (S-S 경계조건)

    Args:
        prop, node, elem: 모델 데이터
        neigs: 고유치 수

    Returns:
        dict: {'curve': list, 'shapes': list, 'lengths': np.ndarray}
    """
    from .properties import elemprop
    from .fsm_solver import stripmain
    from ..models.data import GBTConfig

    ep = elemprop(node, elem)
    widths = ep[:, 1]
    min_w = np.min(widths)
    max_w = np.max(widths)

    lengths = np.logspace(np.log10(min_w), np.log10(1000 * max_w), 100)
    m_all = [np.array([1.0]) for _ in lengths]

    result = stripmain(prop, node, elem, lengths, np.array([]), np.array([]),
                       GBTConfig(), 'S-S', m_all, neigs)

    return {
        'curve': result.curve,
        'shapes': result.shapes,
        'lengths': lengths,
    }


def firstyield(node: np.ndarray, elem: np.ndarray, fy: float) -> dict:
    """초기 항복 응력 계산

    Returns:
        dict: {'Py': float, 'Mxx_y': float, 'Mzz_y': float}
    """
    from .properties import grosprop
    from .stress import yieldMP

    props = grosprop(node, elem)
    return yieldMP(node, fy,
                   props['A'], props['xcg'], props['zcg'],
                   props['Ixx'], props['Izz'], props['Ixz'],
                   props['thetap'], props['I11'], props['I22'])


def energy_recovery(prop: np.ndarray, node: np.ndarray, elem: np.ndarray,
                    mode: np.ndarray, L: float) -> np.ndarray:
    """요소별 변형 에너지 계산

    Args:
        prop, node, elem: 모델
        mode: 전체 DOF 변위 벡터
        L: half-wavelength

    Returns:
        (nelems, 2) [membrane_energy, bending_energy]
    """
    from .element import klocal
    from .properties import elemprop

    nnodes = node.shape[0]
    nelems = elem.shape[0]
    ep = elemprop(node, elem)
    skip = 2 * nnodes

    se = np.zeros((nelems, 2))
    m_a = np.array([1.0])

    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        t = elem[e, 3]
        matnum = int(elem[e, 4])

        mat_idx = np.where(prop[:, 0] == matnum)[0]
        mat_idx = mat_idx[0] if len(mat_idx) > 0 else 0
        Ex, Ey = prop[mat_idx, 1], prop[mat_idx, 2]
        vx, vy = prop[mat_idx, 3], prop[mat_idx, 4]
        G = prop[mat_idx, 5]

        b = ep[e, 1]
        alpha = ep[e, 2]

        # 전체 벡터에서 요소 DOF 추출
        d_global = np.zeros(8)
        d_global[0] = mode[2 * ni]            # u1
        d_global[1] = mode[2 * ni + 1]        # v1
        d_global[2] = mode[2 * nj]            # u2
        d_global[3] = mode[2 * nj + 1]        # v2
        d_global[4] = mode[skip + 2 * ni]     # w1
        d_global[5] = mode[skip + 2 * ni + 1] # theta1
        d_global[6] = mode[skip + 2 * nj]     # w2
        d_global[7] = mode[skip + 2 * nj + 1] # theta2

        # 로컬 변환
        c = math.cos(alpha)
        s = math.sin(alpha)
        d_local = d_global.copy()
        d_local[0] = c * d_global[0] + s * d_global[4]
        d_local[4] = -s * d_global[0] + c * d_global[4]
        d_local[2] = c * d_global[2] + s * d_global[6]
        d_local[6] = -s * d_global[2] + c * d_global[6]

        # 로컬 강성
        k = klocal(Ex, Ey, vx, vy, G, t, L, b, 'S-S', m_a)

        # 멤브레인 에너지
        dm = d_local[:4]
        se[e, 0] = 0.5 * dm @ k[:4, :4] @ dm

        # 휨 에너지
        df = d_local[4:]
        se[e, 1] = 0.5 * df @ k[4:8, 4:8] @ df

    return se


def stress_to_action(node: np.ndarray, xcg: float, zcg: float,
                     thetap: float, A: float, I11: float, I22: float,
                     w: np.ndarray = None, Cw: float = 0.0) -> dict:
    """절점 응력으로부터 하중 성분 (P, M11, M22, B) 역산

    sigma = P/A + M11*y/I11 - M22*x/I22 + B*w/Cw

    Returns:
        dict: {'P', 'M11', 'M22', 'B', 'error'}
    """
    nnodes = node.shape[0]
    stresses = node[:, 7]

    # 주축 좌표 변환
    th = math.radians(thetap)
    c = math.cos(th)
    s = math.sin(th)
    x_rel = node[:, 1] - xcg
    z_rel = node[:, 2] - zcg
    x_princ = c * x_rel + s * z_rel
    y_princ = -s * x_rel + c * z_rel

    # G 행렬 구성
    n_cols = 3
    G = np.zeros((nnodes, n_cols))
    G[:, 0] = 1.0 / A if A != 0 else 0
    G[:, 1] = y_princ / I11 if I11 != 0 else 0
    G[:, 2] = -x_princ / I22 if I22 != 0 else 0

    if w is not None and Cw > 0:
        n_cols = 4
        G = np.column_stack([G, w / Cw])

    # 최소자승 풀이
    f, residuals, _, _ = np.linalg.lstsq(G, stresses, rcond=None)
    err = np.linalg.norm(G @ f - stresses)

    result = {'P': f[0], 'M11': f[1], 'M22': f[2], 'error': err}
    if n_cols == 4:
        result['B'] = f[3]
    else:
        result['B'] = 0.0

    return result


def msort(m_all: list) -> list:
    """종방향 항 정렬/정리

    중복 제거, 0 제거, 오름차순 정렬
    """
    cleaned = []
    for m in m_all:
        arr = np.array(m, dtype=float)
        arr = arr[arr != 0]          # 0 제거
        arr = np.unique(arr)         # 중복 제거 + 정렬
        cleaned.append(arr)
    return cleaned
