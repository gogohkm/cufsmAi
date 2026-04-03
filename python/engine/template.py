"""파라메트릭 단면 템플릿 생성

참조: 프로젝트개요.md §2 단면 템플릿
원본: Ref_Source/helpers/templatecalc.m

각 단면 유형에 대해 절점 좌표를 직접 계산하여 node/elem 배열을 생성한다.
치수는 out-to-out 기준, 좌표는 중심선(centerline) 기준으로 변환.
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


def _build_from_coords(coords: list, t: float, mat: int = 100,
                        closed: bool = False) -> dict:
    """좌표 리스트로부터 node/elem 배열 생성

    Args:
        coords: [(x1,z1), (x2,z2), ...] 중심선 좌표
        t: 두께
        mat: 재료 번호
        closed: True면 마지막→첫번째 연결

    Returns:
        dict with 'node' and 'elem'
    """
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
            # 이전 마지막 점과 현재 첫 점이 같으면 건너뜀
            start = 1 if _close(coords[-1], seg[0]) else 0
            coords.extend(seg[start:])
        else:
            coords.extend(seg)
    return coords


def _close(p1, p2, tol=1e-6):
    return abs(p1[0]-p2[0]) < tol and abs(p1[1]-p2[1]) < tol


def _gen_lipped_c(params: dict) -> dict:
    """Lipped C-channel (out-to-out)

         D
        ┌──┐
        │  │ B
    H   │  └──────┐
        │         │
        │  ┌──────┘
        │  │ B
        └──┘
         D
    """
    H = params.get('H', 9.0)
    B = params.get('B', 5.0)
    D = params.get('D', 1.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)

    # 중심선 치수
    h = H - t
    b = B - t
    d = D - t / 2.0

    # 코너 좌표 (시계 방향, 상단 립 → 하단 립)
    corners = [
        (b, h),       # 상단 립 끝
        (b, h - d),   # 상단 립 시작 = 상단 플랜지 끝
        (0, h - d),   # 웹 상단
        (0, d),       # 웹 하단
        (b, d),       # 하단 플랜지 끝
        (b, 0),       # 하단 립 끝
    ]

    coords = []
    segs = [2, 4, 8, 4, 2]  # 각 스트립 요소 수
    for i in range(len(corners) - 1):
        n = segs[i] * nseg
        seg = _subdivide(corners[i], corners[i + 1], n)
        coords = _chain(coords, seg)

    return _build_from_coords(coords, t)


def _gen_lipped_z(params: dict) -> dict:
    """Lipped Z-section (out-to-out)

    상하 플랜지가 반대 방향:

        ┌──┐ D
        │  │
        │  └──────┐ B
    H   │         │
        ┌──────┘  │
        │  B      │
        └──┘ D
    """
    H = params.get('H', 9.0)
    B = params.get('B', 5.0)
    D = params.get('D', 1.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)

    h = H - t
    b = B - t
    d = D - t / 2.0

    # Z-section: 상단 플랜지 오른쪽, 하단 플랜지 왼쪽
    corners = [
        (-b, 0),       # 하단 립 끝 (왼쪽)
        (-b, d),       # 하단 립 시작
        (0, d),        # 웹 하단
        (0, h - d),    # 웹 상단
        (b, h - d),    # 상단 플랜지 끝 (오른쪽)
        (b, h),        # 상단 립 끝
    ]

    segs = [2, 4, 8, 4, 2]
    coords = []
    for i in range(len(corners) - 1):
        n = segs[i] * nseg
        seg = _subdivide(corners[i], corners[i + 1], n)
        coords = _chain(coords, seg)

    return _build_from_coords(coords, t)


def _gen_hat(params: dict) -> dict:
    """Hat section (out-to-out)

    B_bot     B_bot
    ┌───┐     ┌───┐
    │   └─────┘   │
    │    B_top    │
    H             H
    │             │
    """
    H = params.get('H', 6.0)
    B_top = params.get('B', 4.0)  # B → top width
    B_bot = params.get('D', 2.0)  # D → bottom flange width
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)

    h = H - t
    bt = B_top - t
    bb = B_bot - t / 2.0

    # Hat: 왼쪽 플랜지 → 왼쪽 웹 → 상단 → 오른쪽 웹 → 오른쪽 플랜지
    half = bt / 2.0
    corners = [
        (-half - bb, 0),   # 왼쪽 플랜지 끝
        (-half, 0),        # 왼쪽 웹 하단
        (-half, h),        # 왼쪽 웹 상단 = 상판 왼쪽
        (half, h),         # 상판 오른쪽
        (half, 0),         # 오른쪽 웹 하단
        (half + bb, 0),    # 오른쪽 플랜지 끝
    ]

    segs = [3, 6, 4, 6, 3]
    coords = []
    for i in range(len(corners) - 1):
        n = segs[i] * nseg
        seg = _subdivide(corners[i], corners[i + 1], n)
        coords = _chain(coords, seg)

    return _build_from_coords(coords, t)


def _gen_rhs(params: dict) -> dict:
    """Rectangular Hollow Section"""
    H = params.get('H', 6.0)
    B = params.get('B', 4.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)

    h = H - t
    b = B - t

    corners = [(0, 0), (b, 0), (b, h), (0, h)]
    segs = [4, 6, 4, 6]
    coords = []
    for i in range(len(corners)):
        ni = i
        nj = (i + 1) % len(corners)
        n = segs[i] * nseg
        seg = _subdivide(corners[ni], corners[nj], n)
        coords = _chain(coords, seg)

    return _build_from_coords(coords, t, closed=True)


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
    """Angle (L-section)

    │
    │ H
    │
    └────── B
    """
    H = params.get('H', 6.0)
    B = params.get('B', 4.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)

    h = H - t / 2.0
    b = B - t / 2.0

    corners = [(0, 0), (b, 0), (b, t), (t, t), (t, h), (0, h)]
    # 단순화: 두꺼운 표현 대신 중심선 L
    corners = [(0, 0), (b, 0), (b, h)]
    segs = [4, 6]
    coords = []
    for i in range(len(corners) - 1):
        n = segs[i] * nseg
        seg = _subdivide(corners[i], corners[i + 1], n)
        coords = _chain(coords, seg)

    return _build_from_coords(coords, t)


def _gen_isect(params: dict) -> dict:
    """I-section (중심선)

    ┌──────────┐  상부 플랜지
         │
    H    │         웹
         │
    └──────────┘  하부 플랜지
    """
    H = params.get('H', 10.0)
    B = params.get('B', 5.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)

    h = H - t
    b = B - t

    # 하부 플랜지 왼쪽 → 중앙 → 오른쪽 (한 방향)
    # 그 다음 웹 올라감
    # 상부 플랜지 왼쪽 → 오른쪽

    # 3개 부분으로 분리: 하부 플랜지, 웹, 상부 플랜지
    half_b = b / 2.0

    seg1 = _subdivide((-half_b, 0), (0, 0), 2 * nseg)            # 하부 플랜지 왼쪽
    seg2 = _subdivide((0, 0), (half_b, 0), 2 * nseg)             # 하부 플랜지 오른쪽
    # 웹 시작점은 (0,0) — 하부 플랜지 중앙에서 올라감
    # 그런데 I-section은 분기점이 있음. FSM에서는 분기를 허용하지 않으므로
    # 단일 경로로 펼쳐야 함:
    # 하부플랜지 좌끝 → 중앙 → 하부플랜지 우끝은 분기 문제
    #
    # CUFSM 원본 방식: 하부플랜지좌 → 중앙, 중앙에서 꺾어서 웹 위로,
    # 상부플랜지좌 → 우
    # 즉: [-B/2,0] → [0,0] → [0,H] → [-B/2,H]... 이 아니라
    # [-B/2,0] → [B/2,0] (하부 전체) → [B/2,0]에서 웹...
    #
    # 실제로는: 하부좌 → 하부우 → (뒤로 중앙으로) → 웹 위로 → 상부좌 → 상부우
    # 이것은 겹치는 경로가 됨.
    #
    # CUFSM 원래 방식 (snakey):
    # 하부플랜지좌절반: (-B/2,0) → (0,0)
    # 하부플랜지우절반: (0,0) → (B/2,0)
    # 웹: (0,0) → (0,H)   ← 분기점! 중앙으로 돌아가서 올라감
    # 상부플랜지좌절반: (0,H) → (-B/2,H)
    # 상부플랜지우절반: (0,H) → (B/2,H)  ← 또 분기
    #
    # FSM에서 I-section은 분기점이 있어서 master-slave 또는 특수 처리 필요.
    # 여기서는 단순 단일 경로로:
    # 하부플랜지 좌→우, 우끝에서 중앙으로 안 돌아가고
    # 사실상 ㄷ자 형태로 펼침:
    # 하부좌(-B/2,0) → 하부우(B/2,0) → 웹(B/2,0→B/2,H)는 비대칭...
    #
    # 가장 깔끔한 접근: 하부좌 → 중앙 → 상부좌 → 상부우 → 중앙상 → 하부우
    # 하지만 교차 발생. CUFSM 원본은 그냥 겹치는 경로를 씀.

    # 단일 경로 I-section (CUFSM 표준):
    # 하부플랜지좌끝 → 하부중앙 → 웹 → 상부중앙 → 상부플랜지 우끝
    # + 분기: 하부중앙 → 하부우끝, 상부중앙 → 상부좌끝
    # 분기 없는 단순화 = C-channel 변형:
    # 하부좌 → 하부우 순서로

    # 실용적 단순화: 펼친 I-section
    corners = [
        (-half_b, 0),    # 하부 플랜지 왼쪽
        (half_b, 0),     # 하부 플랜지 오른쪽
        (0, 0),          # 웹 하단 (되돌아감)
        (0, h),          # 웹 상단
        (-half_b, h),    # 상부 플랜지 왼쪽
        (half_b, h),     # 상부 플랜지 오른쪽
    ]
    segs = [4, 2, 8, 2, 4]
    coords = []
    for i in range(len(corners) - 1):
        n = segs[i] * nseg
        seg = _subdivide(corners[i], corners[i + 1], n)
        coords = _chain(coords, seg)

    return _build_from_coords(coords, t)


def _gen_tee(params: dict) -> dict:
    """T-section (중심선)

    ┌──────────┐  플랜지
         │
         │ H      웹 (아래로)
         │
    """
    H = params.get('H', 8.0)
    B = params.get('B', 6.0)
    t = params.get('t', 0.1)
    nseg = params.get('nseg', 1)

    h = H - t / 2.0
    b = B - t
    half_b = b / 2.0

    # 플랜지 좌 → 중앙 → 플랜지 우 → 중앙으로 되돌아감 → 웹 아래로
    # 되돌아감 없이: 플랜지 좌 → 우, 우에서 (0,0)으로 되돌아감 → 웹 아래
    corners = [
        (-half_b, h),   # 플랜지 왼쪽
        (half_b, h),    # 플랜지 오른쪽
        (0, h),         # 웹 상단 (되돌아감)
        (0, 0),         # 웹 하단
    ]
    segs = [6, 3, 8]
    coords = []
    for i in range(len(corners) - 1):
        n = segs[i] * nseg
        seg = _subdivide(corners[i], corners[i + 1], n)
        coords = _chain(coords, seg)

    return _build_from_coords(coords, t)
