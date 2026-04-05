"""파라메트릭 단면 템플릿 생성

참조: 프로젝트개요.md §2 단면 템플릿
원본: Ref_Source/interface/snakey.m, Ref_Source/interface/template/template_build_model.m

MATLAB snakey 알고리즘을 Python으로 포팅:
  - 직선 세그먼트 + 코너 반경 원호 요소 생성
  - 치수는 out-to-out 기준, 좌표는 중심선(centerline) 기준으로 변환
"""

import math
import numpy as np

PI = math.pi


def generate_section(section_type: str, params: dict) -> dict:
    """파라메트릭 단면 생성

    Returns:
        dict with 'node' (nnodes,8) and 'elem' (nelems,5) — MATLAB 1-based
    """
    # custom 타입: cfs_centerline 알고리즘 사용 (외측 꼭짓점 → 중심선)
    if section_type == 'custom':
        return _gen_custom(params)

    # custom_builder 타입: SectionBuilder 요소 조합 방식
    if section_type == 'custom_builder':
        return _gen_custom_builder(params)

    generators = {
        'lippedc': _gen_lipped_c,
        'lippedz': _gen_lipped_z,
        'hat': _gen_hat,
        'track': _gen_track,
        'rhs': _gen_rhs,
        'chs': _gen_chs,
        'angle': _gen_angle,
        'isect': _gen_isect,
        'tee': _gen_tee,
        'lipped_angle': _gen_lipped_angle,
    }
    gen = generators.get(section_type)
    if gen is None:
        raise ValueError(f"Unknown section type: {section_type}")
    return gen(params)


# ============================================================
# snakey: MATLAB snakey.m 포팅
# ============================================================

def _wrap_pi(d: float) -> float:
    """각도를 (-pi, pi] 범위로 랩핑"""
    return (d + PI) % (2 * PI) - PI


def _snakey(lengths, angles, n_strips, thicknesses, mat_ids,
            radii=None, rn=None, rt=None, rid=None,
            closed=False) -> dict:
    """MATLAB snakey 함수의 Python 포팅

    직선 세그먼트와 코너 반경으로부터 node/elem 배열 생성.

    Args:
        lengths: 각 직선 세그먼트의 중심선 길이
        angles: 각 세그먼트의 방향각 (라디안)
        n_strips: 각 세그먼트의 요소 분할 수
        thicknesses: 각 세그먼트의 두께
        mat_ids: 각 세그먼트의 재료 번호
        radii: 코너 반경 (N-1개, 인접 세그먼트 사이)
        rn: 코너당 원호 요소 수
        rt: 코너 요소 두께
        rid: 코너 요소 재료 번호
        closed: True면 폐합 단면

    Returns:
        dict with 'node' (nnodes,8) and 'elem' (nelems,5)
    """
    nl = len(lengths)
    nr = 0 if radii is None or len(radii) == 0 else len(radii)

    # --- 세그먼트 빌드: 직선 + 원호 교차 배열 ---
    seg_l = []
    seg_q1 = []
    seg_q2 = []
    seg_n = []
    seg_t = []
    seg_id = []

    for j in range(nl):
        L_flat = lengths[j]
        q_flat = angles[j]
        n_flat = n_strips[j]
        t_flat = thicknesses[j]
        id_flat = mat_ids[j]

        # 왼쪽 코너 기여 (세그먼트 j-1과 j 사이)
        r_left = 0.0
        dtheta_left = 0.0
        if j > 0 and nr >= j:
            r_left = radii[j - 1]
            dtheta_left = _wrap_pi(angles[j] - angles[j - 1])
        elif closed and nr == nl and j == 0:
            r_left = radii[-1]
            dtheta_left = _wrap_pi(angles[0] - angles[-1])

        # 오른쪽 코너 기여 (세그먼트 j와 j+1 사이)
        r_right = 0.0
        dtheta_right = 0.0
        if j < nl - 1 and nr > j:
            r_right = radii[j]
            dtheta_right = _wrap_pi(angles[j + 1] - angles[j])
        elif closed and nr == nl and j == nl - 1:
            r_right = radii[-1]
            dtheta_right = _wrap_pi(angles[0] - angles[-1])

        # 코너 반경만큼 직선 길이 트림
        L_eff = L_flat
        if r_left > 0 and dtheta_left != 0:
            L_eff -= r_left * abs(math.tan(dtheta_left / 2))
        if r_right > 0 and dtheta_right != 0:
            L_eff -= r_right * abs(math.tan(dtheta_right / 2))
        L_eff = max(L_eff, 0.0)

        # 직선 세그먼트 추가
        seg_l.append(L_eff)
        seg_q1.append(q_flat)
        seg_q2.append(q_flat)
        seg_n.append(n_flat)
        seg_t.append(t_flat)
        seg_id.append(id_flat)

        # 코너 원호 (세그먼트 j와 j+1 사이)
        corner_idx = -1
        q_in = 0.0
        q_out = 0.0

        if j < nl - 1 and nr > j:
            corner_idx = j
            q_in = angles[j]
            q_out = angles[j + 1]
        elif closed and nr == nl and j == nl - 1:
            corner_idx = nl - 1
            q_in = angles[-1]
            q_out = angles[0]

        if corner_idx >= 0:
            r_corner = radii[corner_idx]
            n_corner = rn[corner_idx] if rn else 4
            t_corner = rt[corner_idx] if rt else t_flat
            id_corner = rid[corner_idx] if rid else id_flat

            if r_corner > 0 and n_corner > 0 and q_in != q_out:
                dtheta = _wrap_pi(q_out - q_in)
                L_arc = r_corner * abs(dtheta)
                q2_arc = q_in + dtheta

                seg_l.append(L_arc)
                seg_q1.append(q_in)
                seg_q2.append(q2_arc)
                seg_n.append(n_corner)
                seg_t.append(t_corner)
                seg_id.append(id_corner)

    # --- 노드/요소 생성 (snakey march) ---
    nodes = []
    elems = []
    x, y = 0.0, 0.0
    started = False
    node_idx = 1

    for j in range(len(seg_l)):
        n = seg_n[j]
        l = seg_l[j]
        q1 = seg_q1[j]
        q2 = seg_q2[j]
        t = seg_t[j]
        mid = seg_id[j]

        if n == 0 or l == 0:
            continue

        dq = (q2 - q1) / max(n, 1)

        if q1 == q2:
            le = l / n
        else:
            dtheta = _wrap_pi(q2 - q1)
            r = l / abs(dtheta)
            le = 2 * r * math.sin(abs(dtheta) / (2 * n))

        for k in range(n):
            if not started:
                x1, y1 = 0.0, 0.0
                nodes.append([node_idx, x1, y1, 1, 1, 1, 1, 1.0])
                node_idx += 1
                started = True
            else:
                x1, y1 = x2, y2

            angle_mid = q1 + (k + 0.5) * dq
            x2 = x1 + le * math.cos(angle_mid)
            y2 = y1 + le * math.sin(angle_mid)
            nodes.append([node_idx, x2, y2, 1, 1, 1, 1, 1.0])
            elems.append([node_idx - 1, node_idx - 1, node_idx, t, mid])
            node_idx += 1

    node = np.array(nodes)
    elem = np.array(elems)

    # 폐합 처리
    if closed and len(node) > 1:
        n_nodes = len(node)
        if nr == 0:
            node[-1, 1:3] = node[0, 1:3]
        else:
            xm = 0.5 * (node[0, 1] + node[-1, 1])
            ym = 0.5 * (node[0, 2] + node[-1, 2])
            node[0, 1:3] = [xm, ym]

        last_id = n_nodes
        first_id = 1
        elem[elem[:, 1] == last_id, 1] = first_id
        elem[elem[:, 2] == last_id, 2] = first_id
        node = node[:-1]

    # 원점을 좌하단으로 이동
    if len(node) > 0:
        xo = np.min(node[:, 1])
        zo = np.min(node[:, 2])
        node[:, 1] -= xo
        node[:, 2] -= zo

    return {'node': node, 'elem': elem}


# ============================================================
# 레거시 헬퍼 (I-section, Tee 등 분기 단면용)
# ============================================================

def _build_from_coords(coords: list, t: float, mat: int = 100,
                        closed: bool = False) -> dict:
    """좌표 리스트로부터 node/elem 배열 생성"""
    n = len(coords)
    node = np.zeros((n, 8))
    for i, (x, z) in enumerate(coords):
        node[i] = [i + 1, x, z, 1, 1, 1, 1, 1.0]

    n_elem = n if closed else n - 1
    elem = np.zeros((n_elem, 5))
    for i in range(n_elem):
        ni = i + 1
        nj = (i + 1) % n + 1 if closed else i + 2
        elem[i] = [i + 1, ni, nj, t, mat]

    return {'node': node, 'elem': elem}


def _subdivide(p1: tuple, p2: tuple, n: int) -> list:
    """두 점 사이를 n개 구간으로 분할 (n+1개 점, 양 끝 포함)"""
    pts = []
    for i in range(n + 1):
        frac = i / n
        x = p1[0] + frac * (p2[0] - p1[0])
        z = p1[1] + frac * (p2[1] - p1[1])
        pts.append((x, z))
    return pts


def _chain(*segments) -> list:
    """여러 세그먼트를 연결 (중복 절점 제거)"""
    coords = []
    for seg in segments:
        if coords and len(seg) > 0:
            start = 1 if _close(coords[-1], seg[0]) else 0
            coords.extend(seg[start:])
        else:
            coords.extend(seg)
    return coords


def _close(p1, p2, tol=1e-6):
    return abs(p1[0]-p2[0]) < tol and abs(p1[1]-p2[1]) < tol


# ============================================================
# 단면 생성기 (snakey 기반)
# ============================================================

def _gen_track(params: dict) -> dict:
    """Track / Unlipped C-channel (out-to-out)

    립이 없는 트랙 단면. 3개 세그먼트: 플랜지-웹-플랜지
    플랜지 끝이 자유단이므로 b = B - t/2 (웹쪽 코너만 차감)

    strips.l= [b  h  b]
    strips.q= [180 90 0] (degrees)
    """
    H = params.get('H', 6.0)
    B = params.get('B', 2.0)
    t = params.get('t', 0.1)
    rin = params.get('r', 0.0)
    nseg = max(1, params.get('nseg', 1))

    h = H - t
    b = B - t / 2.0  # 플랜지: 웹쪽 코너만 차감, 끝은 자유단
    r = (rin + t / 2.0) if rin > 0 else 0.0

    lengths = [b, h, b]
    angles = [180, 90, 0]
    angles = [a * PI / 180 for a in angles]
    n_strips = [4 * nseg, 8 * nseg, 4 * nseg]
    thicknesses = [t] * 3
    mat_ids = [100] * 3

    radii = [r, r] if r > 0 else []
    rn = [4, 4] if r > 0 else []
    rt = [t, t] if r > 0 else []
    rid = [100, 100] if r > 0 else []

    return _snakey(lengths, angles, n_strips, thicknesses, mat_ids,
                   radii=radii, rn=rn, rt=rt, rid=rid)


def _gen_lipped_c(params: dict) -> dict:
    """Lipped C-channel (out-to-out) — MATLAB template_build_model.m 'lippedc' 포팅

    strips.l= [d   b   h  b  d]
    strips.q= [270 180 90 0 -90] (degrees)
    qlip: 립 각도 (기본 90도 = 수직), 0~180 사이
    """
    H = params.get('H', 9.0)
    B = params.get('B', 5.0)
    D = params.get('D', 1.0)
    t = params.get('t', 0.1)
    rin = params.get('r', 0.0)
    qlip = params.get('qlip', 90.0)
    nseg = max(1, params.get('nseg', 1))

    h = H - t
    b = B - t
    d = D - t / 2.0
    r = (rin + t / 2.0) if rin > 0 else 0.0

    lengths = [d, b, h, b, d]
    angles = [180 + qlip, 180, 90, 0, -qlip]
    angles = [a * PI / 180 for a in angles]
    n_strips = [2 * nseg, 4 * nseg, 8 * nseg, 4 * nseg, 2 * nseg]
    thicknesses = [t] * 5
    mat_ids = [100] * 5

    radii = [r, r, r, r] if r > 0 else []
    rn = [4, 4, 4, 4] if r > 0 else []
    rt = [t, t, t, t] if r > 0 else []
    rid = [100, 100, 100, 100] if r > 0 else []

    return _snakey(lengths, angles, n_strips, thicknesses, mat_ids,
                   radii=radii, rn=rn, rt=rt, rid=rid)


def _gen_lipped_z(params: dict) -> dict:
    """Lipped Z-section (out-to-out) — MATLAB template_build_model.m 'lippedz' 포팅

    strips.l= [d,  b,  h,  b,  d]
    strips.q= [-q, 0, 90,  0, -q] (degrees, q=90 for standard Z)
    """
    H = params.get('H', 9.0)
    B = params.get('B', 5.0)
    D = params.get('D', 1.0)
    t = params.get('t', 0.1)
    rin = params.get('r', 0.0)
    qlip = params.get('qlip', 90.0)
    nseg = max(1, params.get('nseg', 1))

    h = H - t
    b = B - t
    d = D - t / 2.0
    r = (rin + t / 2.0) if rin > 0 else 0.0

    lengths = [d, b, h, b, d]
    angles = [-qlip, 0, 90, 0, -qlip]
    angles = [a * PI / 180 for a in angles]
    n_strips = [2 * nseg, 4 * nseg, 8 * nseg, 4 * nseg, 2 * nseg]
    thicknesses = [t] * 5
    mat_ids = [100] * 5

    radii = [r, r, r, r] if r > 0 else []
    rn = [4, 4, 4, 4] if r > 0 else []
    rt = [t, t, t, t] if r > 0 else []
    rid = [100, 100, 100, 100] if r > 0 else []

    return _snakey(lengths, angles, n_strips, thicknesses, mat_ids,
                   radii=radii, rn=rn, rt=rt, rid=rid)


def _gen_hat(params: dict) -> dict:
    """Hat section (out-to-out) — MATLAB template_build_model.m 'hat' 포팅

    strips.l= [d,  b,  h,  b,  d]
    strips.q= [0, 90,  0, -90, 0] (degrees)
    """
    H = params.get('H', 6.0)
    B_top = params.get('B', 4.0)
    D = params.get('D', 2.0)
    t = params.get('t', 0.1)
    rin = params.get('r', 0.0)
    nseg = max(1, params.get('nseg', 1))

    h = H - t
    b = B_top - t
    d = D - t / 2.0
    r = (rin + t / 2.0) if rin > 0 else 0.0

    lengths = [d, b, h, b, d]
    angles = [0, 90, 0, -90, 0]
    angles = [a * PI / 180 for a in angles]
    n_strips = [2 * nseg, 4 * nseg, 8 * nseg, 4 * nseg, 2 * nseg]
    thicknesses = [t] * 5
    mat_ids = [100] * 5

    radii = [r, r, r, r] if r > 0 else []
    rn = [4, 4, 4, 4] if r > 0 else []
    rt = [t, t, t, t] if r > 0 else []
    rid = [100, 100, 100, 100] if r > 0 else []

    return _snakey(lengths, angles, n_strips, thicknesses, mat_ids,
                   radii=radii, rn=rn, rt=rt, rid=rid)


def _gen_rhs(params: dict) -> dict:
    """Rectangular Hollow Section — MATLAB template_build_model.m 'rhs' 포팅

    strips.l= [b h b h]
    strips.q= [0 90 180 270] (degrees)
    """
    H = params.get('H', 6.0)
    B = params.get('B', 4.0)
    t = params.get('t', 0.1)
    rin = params.get('r', 0.0)
    nseg = max(1, params.get('nseg', 1))

    h = H - t
    b = B - t
    r = (rin + t / 2.0) if rin > 0 else 0.0

    lengths = [b, h, b, h]
    angles = [0, 90, 180, 270]
    angles = [a * PI / 180 for a in angles]
    n_strips = [4 * nseg, 8 * nseg, 4 * nseg, 8 * nseg]
    thicknesses = [t] * 4
    mat_ids = [100] * 4

    radii = [r, r, r, r] if r > 0 else []
    rn = [4, 4, 4, 4] if r > 0 else []
    rt = [t, t, t, t] if r > 0 else []
    rid = [100, 100, 100, 100] if r > 0 else []

    return _snakey(lengths, angles, n_strips, thicknesses, mat_ids,
                   radii=radii, rn=rn, rt=rt, rid=rid, closed=True)


def _gen_chs(params: dict) -> dict:
    """Circular Hollow Section"""
    D = params.get('D', 6.0)
    t = params.get('t', 0.1)
    n_elem = params.get('n_elem', 24)

    r = (D - t) / 2.0
    coords = []
    for i in range(n_elem):
        angle = 2 * PI * i / n_elem
        coords.append((r * math.cos(angle), r * math.sin(angle)))

    return _build_from_coords(coords, t, closed=True)


def _gen_angle(params: dict) -> dict:
    """Angle (L-section) — MATLAB template_build_model.m 'angle' 포팅

    strips.l= [d b]
    strips.q= [-90 0] (degrees)
    """
    H = params.get('H', 6.0)
    B = params.get('B', 4.0)
    t = params.get('t', 0.1)
    rin = params.get('r', 0.0)
    nseg = max(1, params.get('nseg', 1))

    d = H - t / 2.0
    b = B - t / 2.0
    r = (rin + t / 2.0) if rin > 0 else 0.0

    lengths = [d, b]
    angles = [-90, 0]
    angles = [a * PI / 180 for a in angles]
    n_strips = [6 * nseg, 6 * nseg]
    thicknesses = [t, t]
    mat_ids = [100, 100]

    radii = [r] if r > 0 else []
    rn = [4] if r > 0 else []
    rt = [t] if r > 0 else []
    rid = [100] if r > 0 else []

    return _snakey(lengths, angles, n_strips, thicknesses, mat_ids,
                   radii=radii, rn=rn, rt=rt, rid=rid)


def _gen_isect(params: dict) -> dict:
    """I-section (중심선) — 분기 단면, 노드 공유 방식

    3개 부재(하부 플랜지, 웹, 상부 플랜지)를 별도로 생성하고
    접합점(웹-플랜지)에서 노드를 공유한다.
    """
    H = params.get('H', 10.0)
    B = params.get('B', 5.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)

    h = H - t          # 웹 높이 (중심선 기준)
    half_b = (B - t) / 2.0  # 플랜지 반폭

    nf = 4 * nseg  # 플랜지 요소 수
    nw = 8 * nseg  # 웹 요소 수

    nodes = []
    elems = []

    # 하부 플랜지: (-half_b, 0) → (half_b, 0), nf+1 nodes
    for i in range(nf + 1):
        x = -half_b + i * (2 * half_b) / nf
        nodes.append((x, 0.0))
    # 하부 플랜지 요소
    for i in range(nf):
        elems.append((i, i + 1))

    # 웹 접합 노드 (하부) = 하부 플랜지 중앙점
    bot_mid = nf // 2  # 하부 플랜지 중앙 노드 인덱스

    # 웹: (0, 0) → (0, h), 중간 노드만 추가 (양끝은 플랜지와 공유)
    web_start = bot_mid  # 하부 접합점
    web_node_start = len(nodes)
    for i in range(1, nw):  # 1 ~ nw-1 (양끝 제외)
        z = i * h / nw
        nodes.append((0.0, z))
    # 상부 접합점은 상부 플랜지 중앙에서 공유 — 아래에서 생성

    # 상부 플랜지: (-half_b, h) → (half_b, h), nf+1 nodes
    top_flange_start = len(nodes)
    for i in range(nf + 1):
        x = -half_b + i * (2 * half_b) / nf
        nodes.append((x, h))
    top_mid = top_flange_start + nf // 2  # 상부 플랜지 중앙 노드

    # 상부 플랜지 요소
    for i in range(nf):
        elems.append((top_flange_start + i, top_flange_start + i + 1))

    # 웹 요소: bot_mid → web_nodes → top_mid
    web_nodes = [bot_mid] + list(range(web_node_start, web_node_start + nw - 1)) + [top_mid]
    for i in range(len(web_nodes) - 1):
        elems.append((web_nodes[i], web_nodes[i + 1]))

    # node/elem 배열 생성 (1-based)
    n = len(nodes)
    node = np.zeros((n, 8))
    for i, (x, z) in enumerate(nodes):
        node[i] = [i + 1, x, z, 1, 1, 1, 1, 1.0]
    ne = len(elems)
    elem = np.zeros((ne, 5))
    for i, (ni, nj) in enumerate(elems):
        elem[i] = [i + 1, ni + 1, nj + 1, t, 100]

    return {'node': node, 'elem': elem}


def _gen_tee(params: dict) -> dict:
    """T-section (중심선) — 분기 단면, 노드 공유 방식

    2개 부재(플랜지, 웹)를 별도로 생성하고
    접합점에서 노드를 공유한다.
    """
    H = params.get('H', 8.0)
    B = params.get('B', 6.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)

    h = H - t / 2.0        # 웹 높이
    half_b = (B - t) / 2.0  # 플랜지 반폭

    nf = 6 * nseg  # 플랜지 요소 수
    nw = 8 * nseg  # 웹 요소 수

    nodes = []
    elems = []

    # 플랜지: (-half_b, h) → (half_b, h)
    for i in range(nf + 1):
        x = -half_b + i * (2 * half_b) / nf
        nodes.append((x, h))
    for i in range(nf):
        elems.append((i, i + 1))
    flange_mid = nf // 2  # 플랜지 중앙 노드 = 웹 접합점

    # 웹: (0, h) → (0, 0), 웹 상단은 flange_mid 공유
    web_node_start = len(nodes)
    for i in range(1, nw + 1):  # 1 ~ nw (상단 제외, 하단 포함)
        z = h - i * h / nw
        nodes.append((0.0, z))

    # 웹 요소
    web_nodes = [flange_mid] + list(range(web_node_start, web_node_start + nw))
    for i in range(len(web_nodes) - 1):
        elems.append((web_nodes[i], web_nodes[i + 1]))

    # node/elem 배열 생성 (1-based)
    n = len(nodes)
    node = np.zeros((n, 8))
    for i, (x, z) in enumerate(nodes):
        node[i] = [i + 1, x, z, 1, 1, 1, 1, 1.0]
    ne = len(elems)
    elem = np.zeros((ne, 5))
    for i, (ni, nj) in enumerate(elems):
        elem[i] = [i + 1, ni + 1, nj + 1, t, 100]

    return {'node': node, 'elem': elem}


def _gen_sigma(params: dict) -> dict:
    """Sigma section (C-channel with web stiffener) — snakey 방식

    시그마 단면: C형강 웹 중앙에 V자 스티프너가 있는 형상.
    AISI 예제 II-13, III-14에서 사용.

    경로: 상부 립 → 상부 플랜지 → 상부 웹 → 스티프너(좌측 돌출 V) → 하부 웹 → 하부 플랜지 → 하부 립
    """
    H = params.get('H', 8.0)
    B = params.get('B', 2.25)
    D = params.get('D', 0.625)
    t = params.get('t', 0.0451)
    rin = params.get('r', 0.0)
    Ds = params.get('Ds', 0.5)
    Ws = params.get('Ws', 2.25)
    nseg = max(1, params.get('nseg', 1))

    h = H - t
    b = B - t
    d = D - t / 2.0
    r = (rin + t / 2.0) if rin > 0 else 0.0

    # 웹 스티프너 V자 다리 길이와 각도
    stiff_leg = math.sqrt((Ds / 2.0) ** 2 + Ws ** 2)
    stiff_down_angle = math.degrees(math.atan2(-(Ds / 2.0), -Ws))  # 좌하
    stiff_up_angle = math.degrees(math.atan2(-(Ds / 2.0), Ws))     # 우하

    web_half = h / 2.0 - Ds / 2.0

    lengths = [d, b, web_half, stiff_leg, stiff_leg, web_half, b, d]
    angles = [270, 180, 270, stiff_down_angle, stiff_up_angle, 270, 0, -90]
    angles = [a * PI / 180 for a in angles]
    n_strips = [2*nseg, 4*nseg, 3*nseg, 2*nseg, 2*nseg, 3*nseg, 4*nseg, 2*nseg]
    thicknesses = [t] * 8
    mat_ids = [100] * 8

    if r > 0:
        radii = [r, r, 0, 0, 0, 0, r, r]
        rn_raw = [4, 4, 0, 0, 0, 0, 4, 4]
        radii = [v for v in radii if v > 0]
        rn_list = [v for v in rn_raw if v > 0]
        rt = [t] * len(radii)
        rid = [100] * len(radii)
    else:
        radii = []
        rn_list = []
        rt = []
        rid = []

    return _snakey(lengths, angles, n_strips, thicknesses, mat_ids,
                   radii=radii, rn=rn_list, rt=rt, rid=rid)


def _gen_lipped_angle(params: dict) -> dict:
    """Lipped equal-leg angle — snakey 방식

    AISI 예제 III-5B (4LS4x060): 등변 앵글에 립이 달린 형상.
    경로: 립1(위) → 다리1(아래) → 코너(90°) → 다리2(우측) → 립2(위)
    """
    H = params.get('H', 4.0)
    B = params.get('B', 4.0)
    D = params.get('D', 0.5)
    t = params.get('t', 0.06)
    rin = params.get('r', 0.0)
    qlip = params.get('qlip', 90.0)
    nseg = max(1, params.get('nseg', 1))

    leg_h = H - t
    leg_b = B - t
    d = D - t / 2.0
    r = (rin + t / 2.0) if rin > 0 else 0.0

    lengths = [d, leg_h, leg_b, d]
    angles = [90 + qlip, 270, 0, qlip]
    angles = [a * PI / 180 for a in angles]
    n_strips = [2 * nseg, 6 * nseg, 6 * nseg, 2 * nseg]
    thicknesses = [t] * 4
    mat_ids = [100] * 4

    if r > 0:
        radii = [0, r, 0]
        rn_raw = [0, 4, 0]
        radii = [v for v in radii if v > 0]
        rn_list = [v for v in rn_raw if v > 0]
        rt = [t] * len(radii)
        rid = [100] * len(radii)
    else:
        radii = []
        rn_list = []
        rt = []
        rid = []

    return _snakey(lengths, angles, n_strips, thicknesses, mat_ids,
                   radii=radii, rn=rn_list, rt=rt, rid=rid)


def _gen_custom(params: dict) -> dict:
    """임의 단면 생성 — cfs_centerline 알고리즘 사용

    외측 꼭짓점(sharp corner) 좌표를 입력하면
    t/2 offset → fillet → 도심 이동 → CUFSM node/elem 배열 생성

    Parameters (params dict):
        outer_corners: list of [x, y] — 외측면 sharp corner 좌표 (경로 순서)
        t: float — 판 두께
        R_inner: float — 내측 코너 반경 (기본 0, 모든 코너 동일)
        corner_radii: list of float — 코너별 개별 내측 반경 (선택, 길이=N-2)
        n_arc: int — 코너당 호 분할 수 (기본 4)
        outer_side: str — 'left' or 'right' (기본 'left')
    """
    from engine.cfs_centerline import ColdFormedSection, validate_section, check_path_crossing

    outer_corners = params.get('outer_corners', [])
    if len(outer_corners) < 3:
        raise ValueError("outer_corners must have at least 3 points")

    # tuple 변환
    outer_corners = [(float(p[0]), float(p[1])) for p in outer_corners]

    t = params.get('t', 0.0451)
    R_inner = params.get('R_inner', 0.0)
    corner_radii = params.get('corner_radii', None)
    n_arc = params.get('n_arc', 4)
    outer_side = params.get('outer_side', 'left')

    # 코너별 반경을 중심선 반경(r_c)으로 변환
    if corner_radii is not None:
        r_list = [float(r) + t / 2 if float(r) > 0 else 0.0 for r in corner_radii]
    elif R_inner > 0:
        r_list = None  # ColdFormedSection이 자동 처리
    else:
        r_list = None

    section = ColdFormedSection(
        outer_corners=outer_corners,
        t=t,
        R_inner=R_inner,
        corner_radii=r_list,
        n_arc=n_arc,
        outer_side=outer_side,
        origin='centroid',
    )

    # 자동 검증
    expected_A = params.get('expected_A', None)
    validation = validate_section(outer_corners, t, expected_A)
    crossings = check_path_crossing(outer_corners)
    if crossings:
        import sys
        print(f"[CUFSM WARNING] Path has {len(crossings)} self-crossing(s): {crossings}", file=sys.stderr)

    coords = section.get_coords()
    nn = len(coords)
    ne = nn - 1

    node = np.zeros((nn, 8))
    for i, (x, z) in enumerate(coords):
        node[i] = [i + 1, x, z, 1, 1, 1, 1, 1.0]

    elem = np.zeros((ne, 5))
    for i in range(ne):
        elem[i] = [i + 1, i + 1, i + 2, t, 100]

    return {'node': node, 'elem': elem}


def _gen_custom_builder(params: dict) -> dict:
    """SectionBuilder 요소 조합 방식으로 단면 생성.

    params['steps']: list of step dicts
    각 step: {type, length, direction, x, y, protrusion, height, ...}
    """
    from engine.cfs_centerline import SectionBuilder

    steps = params.get('steps', [])
    if not steps:
        raise ValueError("steps list is empty")

    b = SectionBuilder()

    # expected_center 설정 (lip_inward 정확도 향상)
    ec = params.get('expected_center')
    if ec and len(ec) == 2:
        b.set_expected_center(float(ec[0]), float(ec[1]))

    for step in steps:
        st = step.get('type', '')
        if st == 'start':
            b.start(step.get('x', 0), step.get('y', 0))
        elif st == 'lip':
            b.add_lip(step.get('length', 0.5), step.get('direction', 'up'))
        elif st == 'lip_inward':
            b.add_lip_inward(step.get('length', 0.5))
        elif st == 'flange':
            b.add_flange(step.get('length', 2.0), step.get('direction', 'left'))
        elif st == 'web':
            b.add_web(step.get('length', 2.0), step.get('direction', 'down'))
        elif st == 'stiffener':
            b.add_stiffener(
                step.get('protrusion', 0.5),
                step.get('height', 2.0),
                step.get('direction', 'right'),
            )
        elif st == 'track_flange':
            b.add_track_flange(
                width=step.get('width', 2.0),
                depth=step.get('depth', 0.875),
                lip=step.get('lip_length', 0.5),
                flange_dir=step.get('flange_dir', 'left'),
                lip_dir=step.get('lip_dir', 'up'),
            )
        elif st == 'go':
            b.go(step.get('dx', 0), step.get('dy', 0))
        else:
            raise ValueError(f"Unknown step type: {st}")

    outer_corners = b.build()

    # _gen_custom으로 전달
    custom_params = {
        'outer_corners': outer_corners,
        't': params.get('t', 0.0451),
        'R_inner': params.get('R_inner', 0.0),
        'n_arc': params.get('n_arc', 4),
        'outer_side': params.get('outer_side', 'left'),
    }
    return _gen_custom(custom_params)
