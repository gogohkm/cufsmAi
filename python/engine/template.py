"""파라메트릭 단면 템플릿 생성

참조: 프로젝트개요.md §2 단면 템플릿 (C, Z, Hat, HDS, 원형관 등)
원본: Ref_Source/helpers/templatecalc.m, interface/template/template_build_model.m

snakey 패턴: 직선 스트립 + 코너 호(arc)를 연결하여 단면 생성
"""

import math
import numpy as np

PI = math.pi


def generate_section(section_type: str, params: dict) -> dict:
    """파라메트릭 단면 생성

    Args:
        section_type: 'lippedc', 'lippedz', 'hat', 'rhs', 'chs', 'angle', 'isect', 'tee'
        params: 단면 파라미터 딕셔너리

    Returns:
        dict with 'node' and 'elem' arrays (MATLAB 1-based 형식)
    """
    generators = {
        'lippedc': _gen_lipped_c,
        'lippedz': _gen_lipped_z,
        'hat': _gen_hat,
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


def _snakey(strips: list, corners: list, closed: bool = False) -> dict:
    """직선 스트립 + 코너 호(arc)를 연결하여 node/elem 생성

    Args:
        strips: [{'length': L, 'angle': q(rad), 'n_elem': n, 't': t, 'mat': id}, ...]
        corners: [{'radius': r, 'n_elem': rn, 't': t, 'mat': id}, ...]
                 len(corners) = len(strips) - 1 (또는 len(strips) for closed)
        closed: 폐합 단면 여부

    Returns:
        dict with 'node': (nnodes, 8), 'elem': (nelems, 5) — MATLAB 1-based 형식
    """
    nodes = []  # (x, z)
    elems = []  # (nodei, nodej, t, mat)

    # 시작점
    x, z = 0.0, 0.0
    nodes.append((x, z))

    n_strips = len(strips)

    for s_idx in range(n_strips):
        s = strips[s_idx]
        angle = s['angle']
        length = s['length']
        n_elem = s['n_elem']
        t = s['t']
        mat = s.get('mat', 100)

        # 직선 스트립: n_elem개 요소
        dx_per = length / n_elem * math.cos(angle)
        dz_per = length / n_elem * math.sin(angle)

        for _ in range(n_elem):
            x_new = x + dx_per
            z_new = z + dz_per
            nodes.append((x_new, z_new))
            ni = len(nodes) - 1  # 이전 노드 (0-based)
            nj = len(nodes)      # 현재 노드 (0-based + 1 = 1-based)
            elems.append((ni, nj, t, mat))
            x, z = x_new, z_new

        # 코너 호 (마지막 스트립 이후에는 없음, 단 closed일 때는 있음)
        c_idx = s_idx
        if c_idx < len(corners):
            corner = corners[c_idx]
            r = corner['radius']
            if r > 0:
                rn = corner['n_elem']
                ct = corner.get('t', t)
                cmat = corner.get('mat', mat)

                # 현재 방향과 다음 방향 사이의 호
                next_idx = (s_idx + 1) % n_strips
                q1 = strips[s_idx]['angle']
                q2 = strips[next_idx]['angle']

                # 호의 중심점 계산
                # 법선 방향 (직선 끝에서 안쪽으로)
                turn = q2 - q1
                # 방향 정규화
                while turn > PI:
                    turn -= 2 * PI
                while turn < -PI:
                    turn += 2 * PI

                # 호 중심
                normal_angle = q1 + PI / 2 if turn > 0 else q1 - PI / 2
                cx = x + r * math.cos(normal_angle)
                cz = z + r * math.sin(normal_angle)

                # 호 시작각/끝각
                start_a = math.atan2(z - cz, x - cx)
                total_arc = -turn  # 부호 반전

                for i in range(1, rn + 1):
                    frac = i / rn
                    a = start_a + total_arc * frac
                    x_new = cx + r * math.cos(a)
                    z_new = cz + r * math.sin(a)
                    nodes.append((x_new, z_new))
                    ni = len(nodes) - 1
                    nj = len(nodes)
                    elems.append((ni, nj, ct, cmat))
                    x, z = x_new, z_new

    # node 배열: [node#, x, z, dofx, dofz, dofy, dofrot, stress]
    node_arr = np.zeros((len(nodes), 8))
    for i, (nx, nz) in enumerate(nodes):
        node_arr[i] = [i + 1, nx, nz, 1, 1, 1, 1, 1.0]

    # elem 배열: [elem#, nodei, nodej, t, matnum]
    elem_arr = np.zeros((len(elems), 5))
    for i, (ni, nj, t, mat) in enumerate(elems):
        elem_arr[i] = [i + 1, ni, nj, t, mat]

    return {'node': node_arr, 'elem': elem_arr}


def _gen_lipped_c(params: dict) -> dict:
    """Lipped C-channel

    params: H (웹 높이), B (플랜지 폭), D (립 길이), t (두께), r (내부 코너 반경)
    모두 out-to-out 치수
    """
    H = params.get('H', 9.0)
    B = params.get('B', 5.0)
    D = params.get('D', 1.0)
    t = params.get('t', 0.1)
    r_in = params.get('r', 0.0)
    nseg = params.get('nseg', 1)
    mat = params.get('mat', 100)

    # 중심선 치수
    h = H - t
    b = B - t
    d = D - t / 2.0
    r = r_in + t / 2.0 if r_in > 0 else 0.0

    strips = [
        {'length': d, 'angle': 270 * PI / 180, 'n_elem': 2 * nseg, 't': t, 'mat': mat},
        {'length': b, 'angle': 180 * PI / 180, 'n_elem': 4 * nseg, 't': t, 'mat': mat},
        {'length': h, 'angle': 90 * PI / 180,  'n_elem': 8 * nseg, 't': t, 'mat': mat},
        {'length': b, 'angle': 0,               'n_elem': 4 * nseg, 't': t, 'mat': mat},
        {'length': d, 'angle': -90 * PI / 180, 'n_elem': 2 * nseg, 't': t, 'mat': mat},
    ]

    rn = 4 if r > 0 else 0
    corners = [
        {'radius': r, 'n_elem': rn, 't': t, 'mat': mat},
        {'radius': r, 'n_elem': rn, 't': t, 'mat': mat},
        {'radius': r, 'n_elem': rn, 't': t, 'mat': mat},
        {'radius': r, 'n_elem': rn, 't': t, 'mat': mat},
    ]

    return _snakey(strips, corners)


def _gen_lipped_z(params: dict) -> dict:
    """Lipped Z-section

    params: H, B, D, t, r, qlip (립 각도, degrees)
    """
    H = params.get('H', 9.0)
    B = params.get('B', 5.0)
    D = params.get('D', 1.0)
    t = params.get('t', 0.1)
    r_in = params.get('r', 0.0)
    qlip = params.get('qlip', 90.0)
    nseg = params.get('nseg', 1)
    mat = params.get('mat', 100)

    h = H - t
    b = B - t
    d = D - t / 2.0
    r = r_in + t / 2.0 if r_in > 0 else 0.0
    q = qlip * PI / 180

    strips = [
        {'length': d, 'angle': -q,            'n_elem': 2 * nseg, 't': t, 'mat': mat},
        {'length': b, 'angle': 0,              'n_elem': 4 * nseg, 't': t, 'mat': mat},
        {'length': h, 'angle': 90 * PI / 180, 'n_elem': 8 * nseg, 't': t, 'mat': mat},
        {'length': b, 'angle': PI,             'n_elem': 4 * nseg, 't': t, 'mat': mat},
        {'length': d, 'angle': PI - q,         'n_elem': 2 * nseg, 't': t, 'mat': mat},
    ]

    rn = 4 if r > 0 else 0
    corners = [{'radius': r, 'n_elem': rn, 't': t, 'mat': mat} for _ in range(4)]

    return _snakey(strips, corners)


def _gen_hat(params: dict) -> dict:
    """Hat section"""
    H = params.get('H', 6.0)
    B_top = params.get('B_top', 4.0)
    B_bot = params.get('B_bot', 2.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)
    mat = params.get('mat', 100)

    h = H - t
    bt = B_top - t
    bb = B_bot - t / 2.0

    web_angle = math.atan2(h, (bt - bb) / 2.0)
    web_len = math.sqrt(h**2 + ((bt - bb) / 2.0)**2)

    strips = [
        {'length': bb, 'angle': PI,              'n_elem': 3 * nseg, 't': t, 'mat': mat},
        {'length': web_len, 'angle': PI - web_angle, 'n_elem': 6 * nseg, 't': t, 'mat': mat},
        {'length': bt, 'angle': 0,               'n_elem': 4 * nseg, 't': t, 'mat': mat},
        {'length': web_len, 'angle': -web_angle,  'n_elem': 6 * nseg, 't': t, 'mat': mat},
        {'length': bb, 'angle': 0,               'n_elem': 3 * nseg, 't': t, 'mat': mat},
    ]

    corners = [{'radius': 0, 'n_elem': 0, 't': t, 'mat': mat} for _ in range(4)]
    return _snakey(strips, corners)


def _gen_rhs(params: dict) -> dict:
    """Rectangular Hollow Section"""
    H = params.get('H', 6.0)
    B = params.get('B', 4.0)
    t = params.get('t', 0.1)
    r_in = params.get('r', 0.0)
    nseg = params.get('nseg', 1)
    mat = params.get('mat', 100)

    h = H - t
    b = B - t
    r = r_in + t / 2.0 if r_in > 0 else 0.0

    strips = [
        {'length': b, 'angle': 0,              'n_elem': 4 * nseg, 't': t, 'mat': mat},
        {'length': h, 'angle': 90 * PI / 180,  'n_elem': 6 * nseg, 't': t, 'mat': mat},
        {'length': b, 'angle': PI,             'n_elem': 4 * nseg, 't': t, 'mat': mat},
        {'length': h, 'angle': -90 * PI / 180, 'n_elem': 6 * nseg, 't': t, 'mat': mat},
    ]

    rn = 4 if r > 0 else 0
    corners = [{'radius': r, 'n_elem': rn, 't': t, 'mat': mat} for _ in range(4)]
    return _snakey(strips, corners, closed=True)


def _gen_chs(params: dict) -> dict:
    """Circular Hollow Section"""
    D = params.get('D', 6.0)
    t = params.get('t', 0.1)
    n_elem = params.get('n_elem', 24)
    mat = params.get('mat', 100)

    r = (D - t) / 2.0
    nodes = []
    elems = []

    for i in range(n_elem):
        angle = 2 * PI * i / n_elem
        x = r * math.cos(angle)
        z = r * math.sin(angle)
        nodes.append((x, z))

    node_arr = np.zeros((n_elem, 8))
    for i, (nx, nz) in enumerate(nodes):
        node_arr[i] = [i + 1, nx, nz, 1, 1, 1, 1, 1.0]

    elem_arr = np.zeros((n_elem, 5))
    for i in range(n_elem):
        ni = i + 1
        nj = (i + 1) % n_elem + 1
        elem_arr[i] = [i + 1, ni, nj, t, mat]

    return {'node': node_arr, 'elem': elem_arr}


def _gen_angle(params: dict) -> dict:
    """Angle (L-section)"""
    H = params.get('H', 6.0)
    B = params.get('B', 4.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)
    mat = params.get('mat', 100)

    h = H - t / 2.0
    b = B - t / 2.0

    strips = [
        {'length': b, 'angle': 0,              'n_elem': 4 * nseg, 't': t, 'mat': mat},
        {'length': h, 'angle': 90 * PI / 180,  'n_elem': 6 * nseg, 't': t, 'mat': mat},
    ]
    corners = [{'radius': 0, 'n_elem': 0, 't': t, 'mat': mat}]
    return _snakey(strips, corners)


def _gen_isect(params: dict) -> dict:
    """I-section"""
    H = params.get('H', 10.0)
    B = params.get('B', 5.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)
    mat = params.get('mat', 100)

    h = H - t
    b = B - t

    strips = [
        {'length': b / 2, 'angle': PI,             'n_elem': 2 * nseg, 't': t, 'mat': mat},
        {'length': b / 2, 'angle': 0,              'n_elem': 2 * nseg, 't': t, 'mat': mat},
        {'length': h,     'angle': 90 * PI / 180,  'n_elem': 8 * nseg, 't': t, 'mat': mat},
        {'length': b / 2, 'angle': PI,             'n_elem': 2 * nseg, 't': t, 'mat': mat},
        {'length': b / 2, 'angle': 0,              'n_elem': 2 * nseg, 't': t, 'mat': mat},
    ]
    corners = [{'radius': 0, 'n_elem': 0, 't': t, 'mat': mat} for _ in range(4)]
    return _snakey(strips, corners)


def _gen_tee(params: dict) -> dict:
    """T-section"""
    H = params.get('H', 8.0)
    B = params.get('B', 6.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)
    mat = params.get('mat', 100)

    h = H - t / 2.0
    b = B - t

    strips = [
        {'length': b / 2, 'angle': PI,            'n_elem': 3 * nseg, 't': t, 'mat': mat},
        {'length': b / 2, 'angle': 0,             'n_elem': 3 * nseg, 't': t, 'mat': mat},
        {'length': h,     'angle': -90 * PI / 180, 'n_elem': 8 * nseg, 't': t, 'mat': mat},
    ]
    corners = [{'radius': 0, 'n_elem': 0, 't': t, 'mat': mat} for _ in range(2)]
    return _snakey(strips, corners)
