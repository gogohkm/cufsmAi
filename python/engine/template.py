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
    """
    H = params.get('H', 9.0)
    B = params.get('B', 5.0)
    D = params.get('D', 1.0)
    t = params.get('t', 0.1)
    rin = params.get('r', 0.0)
    nseg = max(1, params.get('nseg', 1))

    h = H - t
    b = B - t
    d = D - t / 2.0
    r = (rin + t / 2.0) if rin > 0 else 0.0

    lengths = [d, b, h, b, d]
    angles = [270, 180, 90, 0, -90]
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
    """I-section (중심선) — 분기 단면, 레거시 방식 유지"""
    H = params.get('H', 10.0)
    B = params.get('B', 5.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)

    h = H - t
    b = B - t
    half_b = b / 2.0

    corners = [
        (-half_b, 0),
        (half_b, 0),
        (0, 0),
        (0, h),
        (-half_b, h),
        (half_b, h),
    ]
    segs = [4, 2, 8, 2, 4]
    coords = []
    for i in range(len(corners) - 1):
        n = segs[i] * nseg
        seg = _subdivide(corners[i], corners[i + 1], n)
        coords = _chain(coords, seg)

    return _build_from_coords(coords, t)


def _gen_tee(params: dict) -> dict:
    """T-section (중심선) — 분기 단면, 레거시 방식 유지"""
    H = params.get('H', 8.0)
    B = params.get('B', 6.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)

    h = H - t / 2.0
    b = B - t
    half_b = b / 2.0

    corners = [
        (-half_b, h),
        (half_b, h),
        (0, h),
        (0, 0),
    ]
    segs = [6, 3, 8]
    coords = []
    for i in range(len(corners) - 1):
        n = segs[i] * nseg
        seg = _subdivide(corners[i], corners[i + 1], n)
        coords = _chain(coords, seg)

    return _build_from_coords(coords, t)
