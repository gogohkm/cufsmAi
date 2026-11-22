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

    치수 규약(모든 템플릿): H · B · D 는 out-to-out, r 은 내측 반경(중심선 반경
    r + t/2). 각 템플릿의 H · B · D 뜻은 생성기 docstring 에 있다 — hat 은
    H = 상판 폭, B = 깊이(웹), D = 브림 폭(이름 있는 인자 top_width · depth · brim
    도 받는다), chs 는 D(또는 OD) = 바깥지름.

    빠진 필수 치수, t ≤ 0, nseg < 1, 코너 반경보다 짧은 직선부 같은 퇴화
    입력은 ValueError 로 거절한다(다른 단면을 조용히 만들지 않는다).

    Returns:
        dict with 'node' (nnodes,8) and 'elem' (nelems,5) — MATLAB 1-based.
        custom · custom_builder 는 'validation'(검증 보고) 과 'warnings' 를 덧붙인다.
    """
    if not isinstance(params, dict):
        raise ValueError("params must be a dict")
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
# 입력 검사
# ============================================================

def _req(params: dict, key: str, stype: str) -> float:
    """필수 치수. 빠지면 기본값으로 채우지 않고 거절한다."""
    v = params.get(key)
    if v is None:
        raise ValueError(f"{stype}: required dimension '{key}' is missing")
    try:
        v = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"{stype}: dimension '{key}' must be a number, got {v!r}")
    if not math.isfinite(v):
        raise ValueError(f"{stype}: dimension '{key}' must be finite, got {v!r}")
    return v


def _pos(params: dict, key: str, stype: str) -> float:
    v = _req(params, key, stype)
    if v <= 0:
        raise ValueError(f"{stype}: '{key}' must be > 0, got {v}")
    return v


def _opt_nonneg(params: dict, key: str, stype: str, default: float = 0.0) -> float:
    v = params.get(key)
    if v is None:
        return default
    v = float(v)
    if not math.isfinite(v) or v < 0:
        raise ValueError(f"{stype}: '{key}' must be >= 0, got {v}")
    return v


def _nseg(params: dict, stype: str) -> int:
    n = params.get('nseg', 1)
    if n is None:
        return 1
    if isinstance(n, bool) or int(n) != n or n < 1:
        raise ValueError(f"{stype}: 'nseg' must be an integer >= 1, got {n!r}")
    return int(n)


def _qlip(params: dict, stype: str) -> float:
    q = params.get('qlip')
    if q is None:
        return 90.0
    q = float(q)
    if not (0.0 < q < 180.0):
        raise ValueError(f"{stype}: 'qlip' must be between 0 and 180 degrees (exclusive), got {q}")
    return q


def _lip_setback(t: float, qlip: float) -> float:
    """out-to-out 치수 → 중심선 sharp 치수 환산에서 립 굽힘이 빼는 길이.

    굽힘 각(립의 꺾임) γ 에 대해 (t/2)·tan(γ/2) — AISI Manual Example I-3,
    Ref_Source/helpers/template_out_to_in.m. γ = 90° 이면 t/2.
    """
    if qlip == 90.0:
        return t / 2.0
    return (t / 2.0) * math.tan(math.radians(qlip) / 2.0)


# ============================================================
# snakey: MATLAB snakey.m 포팅
# ============================================================

def _wrap_pi(d: float) -> float:
    """각도를 (-pi, pi] 범위로 랩핑"""
    return (d + PI) % (2 * PI) - PI


def _snakey(lengths, angles, n_strips, thicknesses, mat_ids,
            radii=None, rn=None, rt=None, rid=None,
            closed=False, roles=None) -> dict:
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
        roles: 직선 세그먼트마다의 단면 자리(웹 · 플랜지 · 립 …). 주면 요소마다의 자리를
            'element_roles' 로 돌려준다(원호 요소는 'corner'). 절점 · 요소는 그대로.

    Returns:
        dict with 'node' (nnodes,8) and 'elem' (nelems,5)[, 'element_roles']
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
    seg_role = []

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
        # 직선부가 음수면 호는 그대로 두고 직선만 0 으로 자르게 되어 입력과 다른
        # (out-to-out 이 부푼) 단면이 조용히 생긴다 — 거절한다.
        if L_eff < -1e-9 * max(1.0, abs(L_flat)):
            raise ValueError(
                f"segment {j} (centerline length {L_flat:.4g}) is shorter than its "
                f"corner radii need ({L_flat - L_eff:.4g}); reduce r or enlarge the dimension")
        L_eff = max(L_eff, 0.0)

        # 직선 세그먼트 추가
        seg_l.append(L_eff)
        seg_q1.append(q_flat)
        seg_q2.append(q_flat)
        seg_n.append(n_flat)
        seg_t.append(t_flat)
        seg_id.append(id_flat)
        seg_role.append(roles[j] if roles else None)

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
                seg_role.append('corner')

    # --- 노드/요소 생성 (snakey march) ---
    nodes = []
    elems = []
    elem_roles = []
    # 마지막 생성 절점. 첫 유효 세그먼트 전에도 초기화하여 빈/건너뛴
    # 세그먼트가 선행하는 경우의 제어흐름을 명확히 한다.
    x2, y2 = 0.0, 0.0
    started = False
    node_idx = 1

    for j in range(len(seg_l)):
        n = seg_n[j]
        segment_length = seg_l[j]
        q1 = seg_q1[j]
        q2 = seg_q2[j]
        t = seg_t[j]
        mid = seg_id[j]

        if n == 0 or segment_length == 0:
            continue

        dq = (q2 - q1) / max(n, 1)

        if q1 == q2:
            le = segment_length / n
        else:
            dtheta = _wrap_pi(q2 - q1)
            r = segment_length / abs(dtheta)
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
            elem_roles.append(seg_role[j])
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

    out = {'node': node, 'elem': elem}
    if roles:
        out['element_roles'] = elem_roles
    return out


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
    st = 'track'
    H = _pos(params, 'H', st)
    B = _pos(params, 'B', st)
    t = _pos(params, 't', st)
    rin = _opt_nonneg(params, 'r', st)
    nseg = _nseg(params, st)

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
                   radii=radii, rn=rn, rt=rt, rid=rid,
                   roles=['bottom_flange', 'web', 'top_flange'])


# 립 C · 립 Z 의 직선 세그먼트 자리 — 첫 립이 아래 플랜지 끝에서 시작한다(모델 z 위가 +).
_LIPPED_ROLES = ['bottom_lip', 'bottom_flange', 'web', 'top_flange', 'top_lip']


def _gen_lipped_c(params: dict) -> dict:
    """Lipped C-channel (out-to-out) — MATLAB template_build_model.m 'lippedc' 포팅

    strips.l= [d   b   h  b  d]
    strips.q= [270 180 90 0 -90] (degrees)
    qlip: 립 굽힘 각 γ (기본 90 = 플랜지에 수직), 0 < qlip < 180.
          플랜지 선에서 립이 꺾인 각이다 — 90 미만이면 립이 플랜지 끝 밖으로
          벌어지고(AISI Table I-4 의 θ = 50° Z 와 같은 뜻), 90 초과면 안으로 접힌다.
          lippedz · lipped_angle 도 같은 뜻.
    D = 0 이면 립과 립 코너를 모두 없앤 track 과 같다.
    """
    st = 'lippedc'
    H = _pos(params, 'H', st)
    B = _pos(params, 'B', st)
    D = _opt_nonneg(params, 'D', st, default=None)
    if D is None:
        raise ValueError(f"{st}: required dimension 'D' (lip length) is missing")
    t = _pos(params, 't', st)
    rin = _opt_nonneg(params, 'r', st)
    qlip = _qlip(params, st)
    nseg = _nseg(params, st)
    if D == 0:
        return _gen_track(params)

    sb = _lip_setback(t, qlip)
    h = H - t
    b = B - t / 2.0 - sb
    d = D - sb
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
                   radii=radii, rn=rn, rt=rt, rid=rid, roles=_LIPPED_ROLES)


def _gen_lipped_z(params: dict) -> dict:
    """Lipped Z-section (out-to-out) — MATLAB template_build_model.m 'lippedz' 포팅

    strips.l= [d,  b,  h,  b,  d]
    strips.q= [-q, 0, 90,  0, -q] (degrees, q=90 for standard Z)
    qlip: lippedc 와 같은 뜻(립 굽힘 각, 90 미만이면 플랜지 끝 밖으로 벌어짐).
    D = 0 이면 립 없는 Z(플랜지 끝 자유단).
    """
    st = 'lippedz'
    H = _pos(params, 'H', st)
    B = _pos(params, 'B', st)
    D = _opt_nonneg(params, 'D', st, default=None)
    if D is None:
        raise ValueError(f"{st}: required dimension 'D' (lip length) is missing")
    t = _pos(params, 't', st)
    rin = _opt_nonneg(params, 'r', st)
    qlip = _qlip(params, st)
    nseg = _nseg(params, st)
    h = H - t
    r = (rin + t / 2.0) if rin > 0 else 0.0

    if D == 0:
        b0 = B - t / 2.0
        lengths = [b0, h, b0]
        angles = [a * PI / 180 for a in (0, 90, 0)]
        rr = [r, r] if r > 0 else []
        return _snakey(lengths, angles, [4 * nseg, 8 * nseg, 4 * nseg], [t] * 3, [100] * 3,
                       radii=rr, rn=[4] * len(rr), rt=[t] * len(rr), rid=[100] * len(rr),
                       roles=['bottom_flange', 'web', 'top_flange'])

    sb = _lip_setback(t, qlip)
    b = B - t / 2.0 - sb
    d = D - sb

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
                   radii=radii, rn=rn, rt=rt, rid=rid, roles=_LIPPED_ROLES)


def _gen_hat(params: dict) -> dict:
    """Hat section (out-to-out) — MATLAB template_build_model.m 'hat' 포팅

    strips.l= [d,  b,  h,  b,  d]
    strips.q= [0, 90,  0, -90, 0] (degrees)

    치수 뜻(MATLAB template_section_params.m 의 C 규약 그대로 — 저장된 .csd 가 기댄다):
        H = 상판(웹 사이) out-to-out 폭, B = 전체 깊이(웹 높이), D = 브림 폭.
    이름 있는 인자 top_width · depth · brim 을 주면 그것이 H · B · D 보다 우선한다
    (AISI Table I-8 의 Depth · Width · Brim 과 같은 이름).
    D(brim) = 0 이면 브림과 브림 코너를 없앤다(웹 끝 자유단).
    """
    st = 'hat'
    named = {k: params.get(k) for k in ('top_width', 'depth', 'brim')}
    p = dict(params)
    if named['top_width'] is not None:
        p['H'] = named['top_width']
    if named['depth'] is not None:
        p['B'] = named['depth']
    if named['brim'] is not None:
        p['D'] = named['brim']
    H = _pos(p, 'H', st)        # 상판 폭
    B_top = _pos(p, 'B', st)    # 깊이
    D = _opt_nonneg(p, 'D', st, default=None)
    if D is None:
        raise ValueError(f"{st}: required dimension 'D' (brim width) is missing")
    t = _pos(p, 't', st)
    rin = _opt_nonneg(p, 'r', st)
    nseg = _nseg(p, st)

    h = H - t
    r = (rin + t / 2.0) if rin > 0 else 0.0
    if D == 0:
        b0 = B_top - t / 2.0
        rr = [r, r] if r > 0 else []
        return _snakey([b0, h, b0], [a * PI / 180 for a in (90, 0, -90)],
                       [4 * nseg, 8 * nseg, 4 * nseg], [t] * 3, [100] * 3,
                       radii=rr, rn=[4] * len(rr), rt=[t] * len(rr), rid=[100] * len(rr),
                       roles=['web', 'top_flange', 'web'])
    b = B_top - t
    d = D - t / 2.0

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
                   radii=radii, rn=rn, rt=rt, rid=rid,
                   roles=['brim', 'web', 'top_flange', 'web', 'brim'])


def _gen_rhs(params: dict) -> dict:
    """Rectangular Hollow Section — MATLAB template_build_model.m 'rhs' 포팅

    strips.l= [b h b h]
    strips.q= [0 90 180 270] (degrees)
    """
    st = 'rhs'
    H = _pos(params, 'H', st)
    B = _pos(params, 'B', st)
    t = _pos(params, 't', st)
    rin = _opt_nonneg(params, 'r', st)
    nseg = _nseg(params, st)

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
                   radii=radii, rn=rn, rt=rt, rid=rid, closed=True,
                   roles=['bottom_flange', 'web', 'top_flange', 'web'])


def _gen_chs(params: dict) -> dict:
    """Circular Hollow Section — 중심선 지름 OD − t 의 정다각형(꼭짓점이 중심선 위)

    바깥지름: 'OD'(MATLAB template_build_model.m 'chs' 와 같은 이름)가 있으면 그것,
    없으면 'D'(GUI 는 H 를 D 로 복사해 보낸다 — 저장된 .csd 의 뜻). OD 없이 H 와 D 가
    서로 다르게 오면 어느 쪽이 지름인지 알 수 없으므로 거절한다(MCP 는 D 를 립
    길이로 설명하고 빠지면 1 을 넣는다 — 1 in 관이 조용히 생기던 경로).
    n_elem 기본 48: 24 현 내접 다각형은 I −1.4 %, J −2.0 % 였다(48 현 −0.36 % / −0.50 %).
    """
    st = 'chs'
    if params.get('OD') is not None:
        D = _pos(params, 'OD', st)
    else:
        D = _pos(params, 'D', st)
        H = params.get('H')
        if H is not None and abs(float(H) - D) > 1e-9 * max(1.0, D):
            raise ValueError(
                f"chs: outer diameter is ambiguous (D={D:g}, H={float(H):g}); "
                "pass the outer diameter as 'OD' (or D equal to H)")
    t = _pos(params, 't', st)
    n_elem = params.get('n_elem', 48)
    if isinstance(n_elem, bool) or int(n_elem) != n_elem or n_elem < 8:
        raise ValueError(f"chs: 'n_elem' must be an integer >= 8, got {n_elem!r}")
    n_elem = int(n_elem)
    if t >= D:
        raise ValueError(f"chs: t ({t:g}) must be smaller than the outer diameter ({D:g})")

    r = (D - t) / 2.0
    coords = []
    for i in range(n_elem):
        angle = 2 * PI * i / n_elem
        coords.append((r * math.cos(angle), r * math.sin(angle)))

    sec = _build_from_coords(coords, t, closed=True)
    sec['element_roles'] = ['wall'] * len(sec['elem'])
    return sec


def _gen_angle(params: dict) -> dict:
    """Angle (L-section) — MATLAB template_build_model.m 'angle' 포팅

    strips.l= [d b]
    strips.q= [-90 0] (degrees)
    """
    st = 'angle'
    H = _pos(params, 'H', st)
    B = _pos(params, 'B', st)
    t = _pos(params, 't', st)
    rin = _opt_nonneg(params, 'r', st)
    nseg = _nseg(params, st)

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
                   radii=radii, rn=rn, rt=rt, rid=rid, roles=['leg', 'leg'])


def _gen_isect(params: dict) -> dict:
    """I-section (중심선) — 분기 단면, 노드 공유 방식

    3개 부재(하부 플랜지, 웹, 상부 플랜지)를 별도로 생성하고
    접합점(웹-플랜지)에서 노드를 공유한다.

    H = 전체 깊이(out-to-out), B = 플랜지 폭. 플랜지 끝은 자유단이므로 중심선
    플랜지 폭은 B 그대로다(MATLAB template_build_model.m 'isect': bf/2 두 조각).
    tf · tw 를 주면 플랜지 · 웹 두께(없으면 t).
    """
    st = 'isect'
    H = _pos(params, 'H', st)
    B = _pos(params, 'B', st)
    tf = _pos(params, 'tf', st) if params.get('tf') is not None else _pos(params, 't', st)
    tw = _pos(params, 'tw', st) if params.get('tw') is not None else _pos(params, 't', st)
    nseg = _nseg(params, st)

    h = H - tf          # 웹 높이 (플랜지 중심선 사이)
    half_b = B / 2.0    # 플랜지 반폭

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
        # 앞의 2·nf 개는 플랜지, 나머지는 웹
        te = tf if i < 2 * nf else tw
        elem[i] = [i + 1, ni + 1, nj + 1, te, 100]

    # 요소 순서: 하부 플랜지 nf 개 → 상부 플랜지 nf 개 → 웹
    roles = ['bottom_flange'] * nf + ['top_flange'] * nf + ['web'] * (ne - 2 * nf)
    return {'node': node, 'elem': elem, 'element_roles': roles}


def _gen_tee(params: dict) -> dict:
    """T-section (중심선) — 분기 단면, 노드 공유 방식

    2개 부재(플랜지, 웹)를 별도로 생성하고
    접합점에서 노드를 공유한다.

    H = 전체 깊이(out-to-out), B = 플랜지 폭(자유단 → 중심선 폭도 B).
    tf · tw 를 주면 플랜지 · 웹 두께(없으면 t).
    """
    st = 'tee'
    H = _pos(params, 'H', st)
    B = _pos(params, 'B', st)
    tf = _pos(params, 'tf', st) if params.get('tf') is not None else _pos(params, 't', st)
    tw = _pos(params, 'tw', st) if params.get('tw') is not None else _pos(params, 't', st)
    nseg = _nseg(params, st)

    h = H - tf / 2.0       # 웹 높이 (자유단 ~ 플랜지 중심선)
    half_b = B / 2.0       # 플랜지 반폭

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
        te = tf if i < nf else tw  # 앞의 nf 개는 플랜지
        elem[i] = [i + 1, ni + 1, nj + 1, te, 100]

    roles = ['top_flange'] * nf + ['web'] * (ne - nf)   # 플랜지는 위(z = h)
    return {'node': node, 'elem': elem, 'element_roles': roles}


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
        # 코너는 세그먼트 사이 7 곳. _snakey 는 radii[i] 를 i 번 코너로 읽으므로
        # 0 을 걸러내면 반경이 엉뚱한 코너로 밀린다 — 제자리에 0 을 둔다.
        radii = [r, r, 0, 0, 0, r, r]
        rn_list = [4, 4, 0, 0, 0, 4, 4]
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
    H · B = 다리 out-to-out, D = 립 out-to-out, 세 코너 모두 내측 반경 r
    (AISI Table I-6). qlip 은 lippedc 와 같은 뜻이며 두 립에 대칭으로 적용한다.
    D = 0 이면 립 없는 angle 과 같다.
    """
    st = 'lipped_angle'
    H = _pos(params, 'H', st)
    B = _pos(params, 'B', st)
    D = _opt_nonneg(params, 'D', st, default=None)
    if D is None:
        raise ValueError(f"{st}: required dimension 'D' (lip length) is missing")
    t = _pos(params, 't', st)
    rin = _opt_nonneg(params, 'r', st)
    qlip = _qlip(params, st)
    nseg = _nseg(params, st)
    if D == 0:
        return _gen_angle(params)

    sb = _lip_setback(t, qlip)
    leg_h = H - t / 2.0 - sb
    leg_b = B - t / 2.0 - sb
    d = D - sb
    r = (rin + t / 2.0) if rin > 0 else 0.0

    lengths = [d, leg_h, leg_b, d]
    # 립2 (코너→끝) 방향 = qlip, 립1 은 다리 사이 45° 선에 대한 거울상(코너→끝 = 90 − qlip)
    angles = [270 - qlip, 270, 0, qlip]
    angles = [a * PI / 180 for a in angles]
    n_strips = [2 * nseg, 6 * nseg, 6 * nseg, 2 * nseg]
    thicknesses = [t] * 4
    mat_ids = [100] * 4

    if r > 0:
        # _snakey 는 radii[i] 를 i 번 코너(립1–다리1, 다리1–다리2, 다리2–립2)로 읽는다
        radii = [r, r, r]
        rn_list = [4, 4, 4]
        rt = [t] * len(radii)
        rid = [100] * len(radii)
    else:
        radii = []
        rn_list = []
        rt = []
        rid = []

    return _snakey(lengths, angles, n_strips, thicknesses, mat_ids,
                   radii=radii, rn=rn_list, rt=rt, rid=rid, roles=['lip', 'leg', 'leg', 'lip'])


def _gen_custom(params: dict) -> dict:
    """임의 단면 생성 — cfs_centerline 알고리즘 사용

    외측 꼭짓점(sharp corner) 좌표를 입력하면
    t/2 offset → fillet → 도심 이동 → CUFSM node/elem 배열 생성

    Parameters (params dict):
        outer_corners: list of [x, y] — 외측면 sharp corner 좌표 (경로 순서, 열린 단면)
        t: float — 판 두께 (필수)
        R_inner: float — 내측 코너 반경 (기본 0, 모든 코너 동일)
        corner_radii: list of float — 코너별 개별 내측 반경 (선택, 길이=N-2)
        n_arc: int — 코너당 호 분할 수 (기본 4)
        outer_side: 중심선 offset 방향 = 판 재료가 놓인 쪽(바깥면의 반대쪽).
            'left' | 'right' | 'auto' | 구간별 목록(길이 N-1, Z · hat 용).
            기본 'auto'(중심선이 외측 꼭짓점 범위 안에 남는 쪽).
        n_flat: int — 직선부당 요소 수 (선택. 1 = 예전 동작)
        max_elem_len: float — 직선부 요소 최대 길이 (선택)
            둘 다 없으면 템플릿과 같은 밀도(가장 긴 직선부 8 개, 내부 직선부 ≥ 4,
            립 ≥ 2)로 나눈다 — 직선부를 요소 하나로 두면 FSM 국부좌굴이 과대(비보수).
        expected_A: float — 기대 면적 (선택, 검증 보고에 비교)

    Returns:
        {'node', 'elem', 'validation', 'warnings'} — validation 은
        cfs_centerline.validate_section 의 보고(+ 'outer_side', 'n_elem'),
        warnings 는 pass 가 아닌 검사의 사람이 읽는 문장.

    Raises:
        ValueError — 자기 교차 경로, 닫힌 경로, 중복 점, 중심선이 외측 꼭짓점
        범위를 벗어남(outer_side 오류), 코너 반경보다 짧은 변, t ≤ 0, n_arc < 1.
    """
    from engine.cfs_centerline import (
        ColdFormedSection, validate_section, check_path_crossing,
        subdivide_flats, centerline_envelope_excess,
    )

    st = 'custom'
    outer_corners = params.get('outer_corners') or []
    if len(outer_corners) < 3:
        raise ValueError("outer_corners must have at least 3 points")

    # tuple 변환
    outer_corners = [(float(p[0]), float(p[1])) for p in outer_corners]
    for k in range(len(outer_corners) - 1):
        (xa, ya), (xb, yb) = outer_corners[k], outer_corners[k + 1]
        if math.hypot(xb - xa, yb - ya) < 1e-9:
            raise ValueError(f"outer_corners[{k}] and [{k + 1}] coincide (zero-length segment)")
    (x0, y0), (xn, yn) = outer_corners[0], outer_corners[-1]
    if math.hypot(xn - x0, yn - y0) < 1e-9:
        raise ValueError(
            "outer_corners is a closed loop; the custom path builds open sections only "
            "(use the rhs / chs templates or set_nodes/set_elements for closed cells)")

    t = _pos(params, 't', st)
    R_inner = _opt_nonneg(params, 'R_inner', st)
    corner_radii = params.get('corner_radii', None)
    n_arc = params.get('n_arc')
    n_arc = 4 if n_arc is None else n_arc
    outer_side = params.get('outer_side') or 'auto'

    crossings = check_path_crossing(outer_corners)
    if crossings:
        raise ValueError(
            f"outer_corners path crosses itself ({len(crossings)} crossing(s): {crossings})")

    section = ColdFormedSection(
        outer_corners=outer_corners,
        t=t,
        R_inner=R_inner,
        corner_radii=corner_radii,   # 내측 반경 — ColdFormedSection 이 + t/2
        n_arc=n_arc,
        outer_side=outer_side,
        origin='centroid',
    )

    excess = centerline_envelope_excess(outer_corners, section.get_cl_corners())
    if excess > 0.25 * t:
        raise ValueError(
            f"centerline leaves the outer-corner envelope by {excess:.4g} (t={t:g}): "
            f"outer_side={section.resolved_outer_side!r} offsets toward the outside face. "
            "outer_side names the side of the path where the plate material lies. When the "
            "outside face changes between parts (Z, hat, sigma with a return flange) pass "
            "a per-segment outer_side list, or use the lippedz / hat template")

    coords, _ = subdivide_flats(section.get_coords(), section._seg_info,
                                n_flat=params.get('n_flat'),
                                max_elem_len=params.get('max_elem_len'))

    expected_A = params.get('expected_A', None)
    validation = validate_section(outer_corners, t, expected_A, cl_coords=coords)
    validation['outer_side'] = section.resolved_outer_side
    nn = len(coords)
    ne = nn - 1
    validation['n_elem'] = ne
    warnings = [f"{c['item']}: {c['value']} - {c['note']}"
                for c in validation['checks'] if c['status'] != 'pass']

    node = np.zeros((nn, 8))
    for i, (x, z) in enumerate(coords):
        node[i] = [i + 1, x, z, 1, 1, 1, 1, 1.0]

    elem = np.zeros((ne, 5))
    for i in range(ne):
        elem[i] = [i + 1, i + 1, i + 2, t, 100]

    return {'node': node, 'elem': elem, 'validation': validation, 'warnings': warnings}


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
        't': params.get('t'),
        'R_inner': params.get('R_inner', 0.0),
        'n_arc': params.get('n_arc', 4),
        'outer_side': params.get('outer_side'),
    }
    for k in ('corner_radii', 'n_flat', 'max_elem_len', 'expected_A'):
        if params.get(k) is not None:
            custom_params[k] = params[k]
    return _gen_custom(custom_params)
