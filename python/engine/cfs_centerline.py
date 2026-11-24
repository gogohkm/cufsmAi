"""
cfs_centerline.py - Cold-Formed Steel Centerline Coordinate Generator
=====================================================================

범용 냉간성형강 단면 중심선 좌표 생성 모듈
모든 열린(open) 냉간성형강 단면에 적용 가능

알고리즘: 외측 꼭짓점(Sharp Corner) → t/2 Offset → r_c Fillet → 도심 이동

지원 단면 유형:
  - C-section (채널)
  - Z-section
  - Sigma (Σ) section
  - Hat section
  - Rack section
  - 임의 열린 단면 (사용자 정의 꼭짓점)

사용법:
  from cfs_centerline import ColdFormedSection
  
  section = ColdFormedSection(
      outer_corners=[(x0,y0), (x1,y1), ...],  # 외측 꼭짓점 좌표
      t=0.0451,                                 # 판 두께
      R_inner=0.09375,                           # 내측 코너 반경 (모든 코너 동일)
      corner_radii=None,                         # 또는 코너별 개별 반경 리스트
      n_arc=10,                                  # 코너당 호 분할 수
      outer_side='left',                         # offset 방향 = 판 재료 쪽 ('left'|'right'|'auto'|구간별 목록)
      labels=None,                               # 꼭짓점별 라벨 (선택)
  )
  
  coords = section.get_coords()           # 도심 원점 좌표
  coords_raw = section.get_coords_raw()   # 원래 좌표 (도심 이동 전)
  section.to_excel("output.xlsx")         # 엑셀 출력
  section.plot("output.png")              # 시각화

핵심 개념:
  1. 냉간성형강은 한 장의 판을 순차 절곡한 열린 단면
  2. 외측 꼭짓점 = 코너 R이 없다고 가정한 외측면 교차점
  3. 중심선 = 외측면에서 t/2만큼 안쪽으로 offset된 선
  4. 실제 코너 = 중심선의 sharp corner에 r_c=R+t/2 필렛을 적용한 원호
"""

import math
from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Union


# ============================================================
# 핵심 기하학 함수들
# ============================================================

def _vec_len(dx: float, dy: float) -> float:
    """벡터 길이"""
    return math.sqrt(dx * dx + dy * dy)


def _vec_normalize(dx: float, dy: float) -> Tuple[float, float]:
    """단위 벡터"""
    L = _vec_len(dx, dy)
    if L < 1e-12:
        return (0.0, 0.0)
    return (dx / L, dy / L)


def _left_normal(dx: float, dy: float) -> Tuple[float, float]:
    """진행방향 좌측 법선 단위벡터 (반시계 90° 회전)"""
    ux, uy = _vec_normalize(dx, dy)
    return (-uy, ux)


def _right_normal(dx: float, dy: float) -> Tuple[float, float]:
    """진행방향 우측 법선 단위벡터 (시계 90° 회전)"""
    ux, uy = _vec_normalize(dx, dy)
    return (uy, -ux)


# ============================================================
# Step 1: Offset — 외측 꼭짓점 → 중심선 꼭짓점
# ============================================================

def _offset_per_segment(
    outer_corners: List[Tuple[float, float]],
    t: float,
    sides: List[str],
) -> List[Tuple[float, float]]:
    """구간별 offset 방향으로 각 변을 t/2 옮기고 이웃 offset 선의 교점을 꼭짓점으로 삼는다.

    Z · hat 처럼 판의 서로 다른 면이 '외측'인 단면은 한 방향 offset 으로 만들 수 없다.
    """
    n = len(outer_corners)
    if len(sides) != n - 1:
        raise ValueError(
            f"outer_side list length ({len(sides)}) must equal the number of "
            f"segments ({n - 1})")
    lines = []  # (offset 된 시작점, 단위 방향)
    for k in range(n - 1):
        side = sides[k]
        if side not in ('left', 'right'):
            raise ValueError(f"outer_side[{k}] must be 'left' or 'right', got {side!r}")
        (x1, y1), (x2, y2) = outer_corners[k], outer_corners[k + 1]
        dx, dy = x2 - x1, y2 - y1
        if _vec_len(dx, dy) < 1e-12:
            raise ValueError(f"segment {k} has zero length")
        nx, ny = _left_normal(dx, dy) if side == 'left' else _right_normal(dx, dy)
        ux, uy = _vec_normalize(dx, dy)
        lines.append(((x1 + nx * t / 2, y1 + ny * t / 2), (ux, uy), (nx, ny)))

    cl = [lines[0][0]]
    for k in range(1, n - 1):
        (p1x, p1y), (u1x, u1y), (n1x, n1y) = lines[k - 1]
        (p2x, p2y), (u2x, u2y), (n2x, n2y) = lines[k]
        den = u1x * u2y - u1y * u2x
        if abs(den) < 1e-10:
            # 평행한 이웃 변(직진 또는 되접힘): 꼭짓점을 이전 변 법선으로 옮긴다
            x, y = outer_corners[k]
            cl.append((x + n1x * t / 2, y + n1y * t / 2))
            continue
        s = ((p2x - p1x) * u2y - (p2y - p1y) * u2x) / den
        cl.append((p1x + s * u1x, p1y + s * u1y))
    (xe, ye) = outer_corners[-1]
    _, _, (nxe, nye) = lines[-1]
    cl.append((xe + nxe * t / 2, ye + nye * t / 2))
    return cl


def offset_to_centerline(
    outer_corners: List[Tuple[float, float]],
    t: float,
    outer_side: Union[str, List[str]] = 'left'
) -> List[Tuple[float, float]]:
    """
    외측(바깥면) 꼭짓점 좌표를 판 두께 중심선으로 t/2 offset.

    Parameters
    ----------
    outer_corners : list of (x, y)
        외측면의 sharp corner 좌표. 경로 순서대로 나열.
        첫 점과 끝 점은 자유단(lip end 등).
    t : float
        판 두께
    outer_side : str or list of str
        중심선을 옮기는 쪽 = **판 재료(두께)가 놓인 쪽**. 바깥면은 그 반대쪽이다.
        'left'  = 판 재료가 경로 진행방향 좌측 (바깥면은 우측) (기본값)
        'right' = 판 재료가 경로 진행방향 우측 (바깥면은 좌측)
        list    = 구간별 값 (길이 = 점 수 − 1). Z · hat 처럼 플랜지마다
                  바깥면이 판의 다른 면인 단면에 쓴다. 꼭짓점은 이웃
                  offset 선의 교점이 된다.

    Returns
    -------
    list of (x, y) : 중심선 sharp corner 좌표

    알고리즘 상세
    -----------
    자유단(첫/끝 점):
        해당 변의 법선 방향으로 t/2 이동

    내부 꼭짓점:
        양쪽 변의 법선벡터의 이등분선(bisector) 방향으로 이동
        이동 거리 = t/2 / cos(반각)

        이유: 두 평면이 각도 θ로 만날 때,
        외측면에서 t/2 안쪽의 교차점은 이등분선 위에 있고
        법선 방향 거리 t/2를 유지하려면 1/cos(θ/2)를 곱해야 함

    outer_side 결정법:
        경로의 시작점에서 끝점까지 따라갈 때 판 재료(단면 안쪽)가
        진행방향 왼쪽에 있으면 'left' (= 바깥면이 오른쪽).

        예시 (C-section, 하단 립→하단 플랜지→웹→상부 플랜지→상부 립):
        - 웹이 우측에 있는 일반 C: outer_side='left'
          (하단 플랜지를 +x 로 지날 때 바깥면 −y 는 오른쪽, 재료 +y 는 왼쪽)
        - 웹이 좌측에 있는 역방향 C: outer_side='right'
        틀린 쪽을 주면 중심선이 바깥면 밖으로 나가 단면이 t 만큼 커진다 —
        `centerline_envelope_excess` 로 검출한다.
    """
    if isinstance(outer_side, (list, tuple)):
        return _offset_per_segment(outer_corners, t, list(outer_side))
    if outer_side not in ('left', 'right'):
        raise ValueError(f"outer_side must be 'left', 'right' or a per-segment list, got {outer_side!r}")
    sign = 1.0 if outer_side == 'left' else -1.0
    n = len(outer_corners)
    cl_corners = []

    for i in range(n):
        x, y = outer_corners[i]

        if i == 0:
            # 자유단 시작: 첫 번째 변의 법선 방향
            x2, y2 = outer_corners[1]
            dx, dy = x2 - x, y2 - y
            nx, ny = _left_normal(dx, dy) if sign > 0 else _right_normal(dx, dy)
            cl_corners.append((x + nx * t / 2, y + ny * t / 2))

        elif i == n - 1:
            # 자유단 끝: 마지막 변의 법선 방향
            x1, y1 = outer_corners[n - 2]
            dx, dy = x - x1, y - y1
            nx, ny = _left_normal(dx, dy) if sign > 0 else _right_normal(dx, dy)
            cl_corners.append((x + nx * t / 2, y + ny * t / 2))

        else:
            # 내부 꼭짓점: 이등분선 방향으로 offset
            xp, yp = outer_corners[i - 1]
            xn, yn = outer_corners[i + 1]

            # 이전 변 방향 (P_{i-1} → P_i)
            d1x, d1y = x - xp, y - yp
            # 다음 변 방향 (P_i → P_{i+1})
            d2x, d2y = xn - x, yn - y

            # 각 변의 외측 법선
            if sign > 0:
                n1x, n1y = _left_normal(d1x, d1y)
                n2x, n2y = _left_normal(d2x, d2y)
            else:
                n1x, n1y = _right_normal(d1x, d1y)
                n2x, n2y = _right_normal(d2x, d2y)

            # 이등분선 방향
            bx = n1x + n2x
            by = n1y + n2y
            bL = _vec_len(bx, by)

            if bL < 1e-10:
                # 두 법선이 반대 방향 (180° 꺾임) → 직선이므로 법선 방향 사용
                cl_corners.append((x + n1x * t / 2, y + n1y * t / 2))
                continue

            bx /= bL
            by /= bL

            # cos(반각) = n1 · bisector
            cos_half = n1x * bx + n1y * by
            cos_half = max(cos_half, 0.01)  # 극단적 예각 보호

            # offset 거리
            offset_dist = (t / 2) / cos_half
            cl_corners.append((x + bx * offset_dist, y + by * offset_dist))

    return cl_corners


# ============================================================
# Step 2: Fillet — 중심선 sharp corner에 원호 삽입
# ============================================================

def apply_fillet(
    cl_corners: List[Tuple[float, float]],
    r_fillet: Union[float, List[float]],
    n_arc: int = 10
) -> Tuple[List[Tuple[float, float]], List[dict]]:
    """
    중심선 sharp corner 목록에 필렛(원호) 적용.
    첫 점과 끝 점은 자유단이므로 필렛 없음.
    
    Parameters
    ----------
    cl_corners : list of (x, y)
        중심선 sharp corner 좌표
    r_fillet : float or list of float
        필렛 반경. 
        float: 모든 내부 코너에 동일 적용
        list: 각 내부 코너별 개별 반경 (길이 = len(cl_corners)-2)
              0이면 해당 코너는 sharp corner 유지
    n_arc : int
        각 코너의 호 분할 수 (기본 10)
        
    Returns
    -------
    coords : list of (x, y)
        필렛 적용된 최종 좌표
    segment_info : list of dict
        각 좌표의 구간 정보 {'type': 'free_end'|'arc'|'tangent', 'corner_idx': int}
    
    알고리즘 상세
    -----------
    각 내부 꼭짓점(인덱스 1 ~ n-2)에 대해:
    
    1) 꼭짓점에서 이전/다음 점으로의 단위벡터 u1, u2 계산
    2) 두 벡터 사이의 끼인각 θ = acos(u1·u2) 계산
    3) 접선점 거리 d_tan = r / tan(θ/2)
    4) 접선점 T1, T2 = 꼭짓점 + u1*d_tan, 꼭짓점 + u2*d_tan
    5) 호 중심 = 꼭짓점 + bisector * r/sin(θ/2)
    6) T1→T2 호를 n_arc 등분
    
    안전장치:
    - 한 변에 걸린 두 코너의 접선 거리 합(자유단 쪽은 하나)이 그 변의 길이를
      넘으면 ValueError — 직선부가 음수가 되는 형상은 반경을 몰래 줄이지 않고 거절한다
      (template._snakey 와 같은 규칙).
    - θ ≈ 0° 또는 180°이면 필렛 생략
    """
    n = len(cl_corners)
    n_inner = n - 2  # 내부 코너 수
    if int(n_arc) != n_arc or n_arc < 1:
        raise ValueError(f"n_arc must be an integer >= 1, got {n_arc!r}")
    n_arc = int(n_arc)

    # r_fillet을 리스트로 정규화
    if isinstance(r_fillet, (int, float)):
        radii = [float(r_fillet)] * n_inner
    else:
        if len(r_fillet) != n_inner:
            raise ValueError(
                f"corner_radii 길이({len(r_fillet)})가 "
                f"내부 코너 수({n_inner})와 불일치"
            )
        radii = [float(r) for r in r_fillet]
    if any(r < 0 for r in radii):
        raise ValueError("corner radii must be >= 0")

    # 코너별 접선 거리를 먼저 구해 각 변에서 직선부가 남는지 확인한다
    tan_dists = [0.0] * n
    for i in range(1, n - 1):
        r = radii[i - 1]
        if r < 1e-10:
            continue
        x, y = cl_corners[i]
        u1x, u1y = _vec_normalize(cl_corners[i - 1][0] - x, cl_corners[i - 1][1] - y)
        u2x, u2y = _vec_normalize(cl_corners[i + 1][0] - x, cl_corners[i + 1][1] - y)
        theta = math.acos(max(-1.0, min(1.0, u1x * u2x + u1y * u2y)))
        if theta < 0.005 or theta > math.pi - 0.005:
            continue
        tan_dists[i] = r / math.tan(theta / 2)
    for k in range(n - 1):
        (xa, ya), (xb, yb) = cl_corners[k], cl_corners[k + 1]
        L = _vec_len(xb - xa, yb - ya)
        need = tan_dists[k] + tan_dists[k + 1]
        if need > L * (1 + 1e-9) + 1e-12:
            raise ValueError(
                f"segment {k} (centerline length {L:.4g}) is shorter than the "
                f"corner fillets need ({need:.4g}); reduce the corner radius or "
                f"lengthen the segment")

    coords = []
    seg_info = []

    for i in range(n):
        if i == 0:
            coords.append(cl_corners[0])
            seg_info.append({'type': 'free_end', 'corner_idx': 0})
            continue

        if i == n - 1:
            coords.append(cl_corners[-1])
            seg_info.append({'type': 'free_end', 'corner_idx': n - 1})
            continue

        r = radii[i - 1]  # 이 코너의 필렛 반경

        if r < 1e-10:
            # 반경 0 = sharp corner 유지
            coords.append(cl_corners[i])
            seg_info.append({'type': 'sharp', 'corner_idx': i})
            continue

        x, y = cl_corners[i]
        xp, yp = cl_corners[i - 1]
        xn, yn = cl_corners[i + 1]

        # 꼭짓점 → 이전점 방향
        u1x, u1y = _vec_normalize(xp - x, yp - y)

        # 꼭짓점 → 다음점 방향
        u2x, u2y = _vec_normalize(xn - x, yn - y)

        # 끼인각
        dot = u1x * u2x + u1y * u2y
        dot = max(-1.0, min(1.0, dot))
        cross = u1x * u2y - u1y * u2x
        theta = math.acos(dot)

        # 거의 직선(0°) 또는 역방향(180°) → 필렛 생략
        if theta < 0.005 or theta > math.pi - 0.005:
            coords.append((x, y))
            seg_info.append({'type': 'degenerate', 'corner_idx': i})
            continue

        # 접선점 거리 (변 길이 부족은 위에서 이미 거절했다)
        tan_dist = r / math.tan(theta / 2)
        r_actual = r

        # 접선점
        t1x = x + u1x * tan_dist
        t1y = y + u1y * tan_dist
        t2x = x + u2x * tan_dist
        t2y = y + u2y * tan_dist

        # 호 중심 (이등분선 위)
        bx = u1x + u2x
        by = u1y + u2y
        bL = _vec_len(bx, by)
        if bL < 1e-10:
            coords.append((x, y))
            seg_info.append({'type': 'degenerate', 'corner_idx': i})
            continue
        bx /= bL
        by /= bL

        center_dist = r_actual / math.sin(theta / 2)
        cx = x + bx * center_dist
        cy = y + by * center_dist

        # 호 시작/끝 각도
        start_ang = math.atan2(t1y - cy, t1x - cx)
        end_ang = math.atan2(t2y - cy, t2x - cx)

        # 호 방향 결정
        # cross > 0: u1→u2가 CCW → 호는 CW (짧은 쪽)
        # cross < 0: u1→u2가 CW → 호는 CCW (짧은 쪽)
        if cross > 0:
            # CW 호 (end < start)
            while end_ang >= start_ang:
                end_ang -= 2 * math.pi
            if start_ang - end_ang > math.pi + 0.01:
                end_ang += 2 * math.pi
        else:
            # CCW 호 (end > start)
            while end_ang <= start_ang:
                end_ang += 2 * math.pi
            if end_ang - start_ang > math.pi + 0.01:
                end_ang -= 2 * math.pi

        # 호 좌표 생성
        for j in range(n_arc + 1):
            frac = j / n_arc
            ang = start_ang + (end_ang - start_ang) * frac
            px = cx + r_actual * math.cos(ang)
            py = cy + r_actual * math.sin(ang)
            coords.append((px, py))
            seg_info.append({'type': 'arc', 'corner_idx': i, 'arc_frac': frac})

    return coords, seg_info


# ============================================================
# Step 3: 도심 계산 및 좌표 이동
# ============================================================

def compute_line_centroid(
    coords: List[Tuple[float, float]]
) -> Tuple[float, float, float]:
    """
    선형 요소(중심선) 기반 도심 계산.
    
    각 세그먼트(두 연속 좌표 사이)의 길이를 가중치로 사용하여
    중점 좌표의 가중 평균을 계산.
    
    Returns: (xc, yc, total_length)
    """
    total_L = 0.0
    sum_xL = 0.0
    sum_yL = 0.0

    for i in range(len(coords) - 1):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        L = _vec_len(x2 - x1, y2 - y1)
        total_L += L
        sum_xL += (x1 + x2) / 2 * L
        sum_yL += (y1 + y2) / 2 * L

    if total_L < 1e-12:
        return (0.0, 0.0, 0.0)

    return (sum_xL / total_L, sum_yL / total_L, total_L)


def shift_coords(
    coords: List[Tuple[float, float]],
    dx: float, dy: float
) -> List[Tuple[float, float]]:
    """좌표 평행이동"""
    return [(x + dx, y + dy) for x, y in coords]


# ============================================================
# Step 3b: 직선부 분할 — FSM 판 좌굴을 표현할 자유도
# ============================================================

def _is_arc_chord(seg_info: List[dict], k: int) -> bool:
    a, b = seg_info[k], seg_info[k + 1]
    return (a.get('type') == 'arc' and b.get('type') == 'arc'
            and a.get('corner_idx') == b.get('corner_idx'))


def subdivide_flats(
    coords: List[Tuple[float, float]],
    seg_info: List[dict],
    n_flat: Optional[int] = None,
    max_elem_len: Optional[float] = None,
) -> Tuple[List[Tuple[float, float]], List[dict]]:
    """호(코너) 현은 그대로 두고 직선부만 여러 요소로 나눈다.

    직선부 하나를 스트립 하나로 두면 판의 국부좌굴 형상(판 폭 방향 반파)을
    표현하지 못해 FSM 국부좌굴 하중이 크게 나온다(비보수). 템플릿은 웹 8,
    플랜지 4, 립 2 개로 나눈다.

    Parameters
    ----------
    n_flat : int, optional
        모든 직선부에 같은 분할 수. 1 이면 예전(직선부당 요소 1개) 동작.
    max_elem_len : float, optional
        직선부 요소의 최대 길이. n_flat 과 함께 주면 n_flat 이 우선한다.
    기본(둘 다 None): 가장 긴 직선부를 8 개로 나누는 요소 길이 L_ref 를 기준으로
        각 직선부를 max(n_min, ceil(L / L_ref)) 개로 나눈다. n_min 은 내부
        직선부 4, 자유단에 닿은 직선부(립)와 L_ref 보다 짧은 직선부 2 —
        lippedc 템플릿(웹 8 · 플랜지 4 · 립 2)과 같은 밀도.
    """
    nseg = len(coords) - 1
    if nseg < 1:
        return list(coords), list(seg_info)
    if n_flat is not None and (int(n_flat) != n_flat or n_flat < 1):
        raise ValueError(f"n_flat must be an integer >= 1, got {n_flat!r}")
    if max_elem_len is not None and not (max_elem_len > 0):
        raise ValueError(f"max_elem_len must be > 0, got {max_elem_len!r}")

    flat_len = {}
    for k in range(nseg):
        if not _is_arc_chord(seg_info, k):
            (x1, y1), (x2, y2) = coords[k], coords[k + 1]
            flat_len[k] = _vec_len(x2 - x1, y2 - y1)
    if not flat_len:
        return list(coords), list(seg_info)

    L_ref = max(flat_len.values()) / 8.0

    def _count(k, L):
        if L < 1e-12:
            return 1
        if n_flat is not None:
            return int(n_flat)
        if max_elem_len is not None:
            return max(1, math.ceil(L / max_elem_len - 1e-9))
        at_free_end = k in (0, nseg - 1)
        n_min = 2 if (at_free_end or L < L_ref) else 4
        return max(n_min, math.ceil(L / L_ref - 1e-9))

    new_coords = [coords[0]]
    new_info = [seg_info[0]]
    for k in range(nseg):
        (x1, y1), (x2, y2) = coords[k], coords[k + 1]
        if k in flat_len:
            n = _count(k, flat_len[k])
            for j in range(1, n):
                f = j / n
                new_coords.append((x1 + f * (x2 - x1), y1 + f * (y2 - y1)))
                new_info.append({'type': 'flat', 'corner_idx': seg_info[k].get('corner_idx')})
        new_coords.append(coords[k + 1])
        new_info.append(seg_info[k + 1])
    return new_coords, new_info


# ============================================================
# Step 3c: 형상 검사 — 중심선이 외측 꼭짓점 범위를 벗어나는지
# ============================================================

def centerline_envelope_excess(
    outer_corners: List[Tuple[float, float]],
    cl_coords: List[Tuple[float, float]],
) -> float:
    """중심선 좌표가 외측 꼭짓점의 bounding box 밖으로 나간 최대 거리.

    외측 꼭짓점은 판의 바깥면 위에 있으므로 중심선(바깥면에서 재료 쪽으로 t/2)은
    그 범위 안에 있어야 한다. 양수(≈ t/2 이상)이면 offset 방향이 틀렸거나
    (outer_side) 바깥면이 플랜지마다 다른 단면(Z · hat)을 한 방향으로 offset 한 것이다.
    """
    xs = [p[0] for p in outer_corners]
    ys = [p[1] for p in outer_corners]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    excess = 0.0
    for x, y in cl_coords:
        excess = max(excess, x0 - x, x - x1, y0 - y, y - y1)
    return excess


def resolve_outer_side(
    outer_corners: List[Tuple[float, float]],
    t: float,
    tol_ratio: float = 0.25,
) -> str:
    """outer_side='auto': 중심선이 외측 꼭짓점 범위 안에 남는 한 방향을 고른다.

    두 방향 모두 범위를 벗어나면 바깥면이 부분마다 판의 다른 면으로 바뀌는
    단면(Z · hat, 되돌림 플랜지가 있는 시그마)이다. 그런 단면에서 범위 경계에
    닿지 않는 변(Z 의 웹 등)이 판의 어느 면에 놓이는지는 꼭짓점만으로 정해지지
    않으므로 추정하지 않고 오류를 낸다 — 구간별 outer_side 목록을 받아야 한다.
    """
    best = None
    for side in ('left', 'right'):
        cl = offset_to_centerline(outer_corners, t, side)
        ex = centerline_envelope_excess(outer_corners, cl)
        if best is None or ex < best[1]:
            best = (side, ex)
    if best[1] > tol_ratio * t:
        raise ValueError(
            "outer_side='auto': with either side the centerline leaves the outer-corner "
            f"envelope (by >= {best[1]:.4g}). The outside face changes between parts "
            "(Z, hat, return flanges): pass a per-segment outer_side list (side of the "
            "plate material for each segment), or use the lippedz / hat template.")
    return best[0]


# ============================================================
# Step 4: 단면물성 계산 (선형 요소 기반)
# ============================================================

def compute_section_properties(
    coords: List[Tuple[float, float]],
    t: float
) -> dict:
    """
    중심선 좌표(도심 원점)와 판 두께로 단면물성 계산.
    AISI 중심선법 기반.
    
    Returns
    -------
    dict with keys:
        'A'   : 단면적 (= total_L * t)
        'Ix'  : X축(수평) 관성모멘트
        'Iy'  : Y축(수직) 관성모멘트
        'Ixy' : 관성상승모멘트
        'xc', 'yc' : 도심 (항상 0, 확인용)
        'total_L' : 총 중심선 길이
    """
    total_L = 0.0
    Ix = 0.0
    Iy = 0.0
    Ixy = 0.0

    for i in range(len(coords) - 1):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        dx = x2 - x1
        dy = y2 - y1
        L = _vec_len(dx, dy)
        
        if L < 1e-12:
            continue

        # 세그먼트 중점
        mx = (x1 + x2) / 2
        my = (y1 + y2) / 2

        # 세그먼트 자체의 관성모멘트 (로컬) + 평행축 정리
        # Ix_seg = t * L * my^2 + t * L^3 * sin^2(α) / 12
        sin_a = dy / L
        cos_a = dx / L

        Ix += t * L * (my * my + L * L * sin_a * sin_a / 12)
        Iy += t * L * (mx * mx + L * L * cos_a * cos_a / 12)
        Ixy += t * L * (mx * my + L * L * sin_a * cos_a / 12)

        total_L += L

    A = total_L * t

    return {
        'A': A,
        'Ix': Ix,
        'Iy': Iy,
        'Ixy': Ixy,
        'total_L': total_L,
    }


# ============================================================
# 검증 함수들 — 경로 교차, 대칭, 자동 outer_side 판별
# ============================================================

def check_path_crossing(coords: List[Tuple[float, float]]) -> List[dict]:
    """경로 자기교차 검출. 교차하는 세그먼트 쌍 목록 반환."""
    crossings = []
    n = len(coords) - 1
    for i in range(n):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        for j in range(i + 2, n):
            if j == i + 1:
                continue
            x3, y3 = coords[j]
            x4, y4 = coords[j + 1]
            # 두 선분의 교차 판정
            d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
            if abs(d) < 1e-12:
                continue
            t_val = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
            u_val = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
            if 0.01 < t_val < 0.99 and 0.01 < u_val < 0.99:
                ix = x1 + t_val * (x2 - x1)
                iy = y1 + t_val * (y2 - y1)
                crossings.append({
                    'seg1': i, 'seg2': j,
                    'point': (round(ix, 4), round(iy, 4))
                })
    return crossings


def check_symmetry(coords: List[Tuple[float, float]], tol: float = 0.05) -> dict:
    """대칭 유형 검출 (거울대칭 / 점대칭 / 없음)."""
    n = len(coords)
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    cx = sum(xs) / n
    cy = sum(ys) / n

    # 거울대칭 (수평축 y=cy 기준)
    mirror_err = 0
    for i in range(n):
        # y=cy 기준 반사점 찾기
        ry = 2 * cy - coords[i][1]
        rx = coords[i][0]
        min_dist = min(_vec_len(rx - c[0], ry - c[1]) for c in coords)
        mirror_err += min_dist
    mirror_err /= n

    # 점대칭 (중심 cx,cy 기준 180° 회전)
    point_err = 0
    for i in range(n):
        rx = 2 * cx - coords[i][0]
        ry = 2 * cy - coords[i][1]
        min_dist = min(_vec_len(rx - c[0], ry - c[1]) for c in coords)
        point_err += min_dist
    point_err /= n

    avg_size = max(max(xs) - min(xs), max(ys) - min(ys), 1)
    mirror_ratio = mirror_err / avg_size
    point_ratio = point_err / avg_size

    sym_type = 'none'
    if mirror_ratio < tol and point_ratio < tol:
        sym_type = 'both'
    elif mirror_ratio < tol:
        sym_type = 'mirror'
    elif point_ratio < tol:
        sym_type = 'point'

    return {
        'type': sym_type,
        'mirror_error': round(mirror_ratio, 4),
        'point_error': round(point_ratio, 4),
        'center': (round(cx, 4), round(cy, 4)),
    }


def validate_section(
    outer_corners: List[Tuple[float, float]],
    t: float,
    expected_A: float = None,
    cl_coords: Optional[List[Tuple[float, float]]] = None,
) -> dict:
    """단면 좌표에 대한 종합 검증 수행.

    cl_coords 를 주면 면적 비교는 실제 중심선 모델의 면적(Σ L·t)으로 한다.
    결과의 'status' 는 checks 가운데 가장 나쁜 값('fail' > 'warn' > 'pass').
    """
    checks = []

    # 1. 최소 점 수
    n = len(outer_corners)
    checks.append({
        'item': 'Minimum points',
        'status': 'pass' if n >= 3 else 'fail',
        'value': n,
        'note': 'At least 3 outer corners required',
    })

    # 2. 경로 교차
    crossings = check_path_crossing(outer_corners)
    checks.append({
        'item': 'Path self-crossing',
        'status': 'pass' if len(crossings) == 0 else 'fail',
        'value': f'{len(crossings)} crossings',
        'note': str(crossings) if crossings else 'No crossings detected',
    })

    # 3. 총 CL 길이 → 예상 면적
    total_L = 0
    for i in range(n - 1):
        dx = outer_corners[i + 1][0] - outer_corners[i][0]
        dy = outer_corners[i + 1][1] - outer_corners[i][1]
        total_L += _vec_len(dx, dy)
    est_A = total_L * t
    checks.append({
        'item': 'Estimated area (outer path)',
        'status': 'pass',
        'value': f'{est_A:.4f} in² (CL ≈ {total_L:.2f} in)',
        'note': 'This is approximate; fillet arcs add ~5-15% more length',
    })

    # 4. 예상 면적 비교
    if expected_A is not None:
        if cl_coords is not None and len(cl_coords) > 1:
            cl_L = sum(_vec_len(cl_coords[i + 1][0] - cl_coords[i][0],
                                cl_coords[i + 1][1] - cl_coords[i][1])
                       for i in range(len(cl_coords) - 1))
            model_A, basis = cl_L * t, 'centerline model'
        else:
            model_A, basis = est_A, 'outer path'
        ratio = model_A / expected_A if expected_A > 0 else 0
        if 0.8 <= ratio <= 1.2:
            a_status = 'pass'
        elif 0.7 <= ratio <= 1.3:
            a_status = 'warn'
        else:
            a_status = 'fail'
        checks.append({
            'item': 'Area vs expected',
            'status': a_status,
            'value': f'{ratio:.2f} (A={model_A:.4f} from {basis}, target {expected_A:.4f})',
            'note': 'Ratio should be 0.8~1.2. If <0.7, path is too short (missing segments?).',
        })

    # 5. 대칭 검출
    sym = check_symmetry(outer_corners)
    checks.append({
        'item': 'Symmetry detection',
        'status': 'pass',
        'value': sym['type'],
        'note': f"mirror_err={sym['mirror_error']}, point_err={sym['point_error']}",
    })

    # 6. 경로 방향 전환 (되돌아감) 검출
    reversals = 0
    for i in range(1, n - 1):
        dx1 = outer_corners[i][0] - outer_corners[i - 1][0]
        dy1 = outer_corners[i][1] - outer_corners[i - 1][1]
        dx2 = outer_corners[i + 1][0] - outer_corners[i][0]
        dy2 = outer_corners[i + 1][1] - outer_corners[i][1]
        L1 = _vec_len(dx1, dy1)
        L2 = _vec_len(dx2, dy2)
        if L1 > 1e-10 and L2 > 1e-10:
            dot = (dx1 * dx2 + dy1 * dy2) / (L1 * L2)
            if dot < -0.5:  # > 120° turn = reversal
                reversals += 1
    checks.append({
        'item': 'Path reversals (U-turns)',
        'status': 'pass',
        'value': f'{reversals} reversals detected',
        'note': 'Reversals are normal for track/sigma flanges. 0 for simple C/Z.',
    })

    # 7. 립 방향 검증: 립 끝이 인접 플랜지 선에 대해 단면의 나머지(플랜지 다음
    #    꼭짓점)와 같은 쪽 = 안쪽 반평면에 있는지. 꼭짓점 평균 쪽을 향하는지만 보면
    #    플랜지 밖으로 뻗은 립도 통과한다.
    if n >= 4:
        def _side(a, b, p):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])

        P = outer_corners
        s_tip0 = _side(P[1], P[2], P[0])
        s_rest0 = _side(P[1], P[2], P[3])
        s_tipN = _side(P[-2], P[-3], P[-1])
        s_restN = _side(P[-2], P[-3], P[-4])
        lip_start_inward = s_tip0 * s_rest0 > 0
        lip_end_inward = s_tipN * s_restN > 0

        if lip_start_inward and lip_end_inward:
            lip_status = 'pass'
            lip_note = 'Both lips lie on the inner side of their flanges (inward).'
        elif lip_start_inward or lip_end_inward:
            lip_status = 'warn'
            lip_note = (f'Start lip {"inward" if lip_start_inward else "OUTWARD"}, '
                        f'End lip {"inward" if lip_end_inward else "OUTWARD"}. Stiffening lips '
                        'normally turn toward the inside of their flange (ignore for hat brims).')
        else:
            lip_status = 'warn'
            lip_note = ('Both end segments turn OUTWARD from their flanges. Check lip '
                        'directions (ignore for hat brims).')

        checks.append({
            'item': 'Lip direction (inward check)',
            'status': lip_status,
            'value': f'start={"inward" if lip_start_inward else "outward"}, end={"inward" if lip_end_inward else "outward"}',
            'note': lip_note,
        })

    statuses = [c['status'] for c in checks]
    status = 'fail' if 'fail' in statuses else ('warn' if 'warn' in statuses else 'pass')
    return {'checks': checks, 'symmetry': sym, 'crossings': crossings, 'status': status}


# ============================================================
# 프리셋 팩토리 — 시그마 단면
# ============================================================

def sigma_outer_corners(
    H: float = 8.0,
    B: float = 2.25,
    D: float = 0.875,
    D_lip: float = 0.5,
    Ds: float = 0.5,
    Ws: float = 2.25,
) -> List[Tuple[float, float]]:
    """시그마(Σ) 단면 외측 꼭짓점 생성 — 검증된 경로.

    Parameters
    ----------
    H : 전체 높이 (out-to-out)
    B : 플랜지 폭 (웹에서 립 끝까지 수평 거리)
    D : 플랜지 C형 깊이 (수직, 상부 ∪ / 하부 ∩ 의 깊이)
    D_lip : 립 폭 (수평, 플랜지 끝에서 추가 돌출)
    Ds : 스티프너 수평 돌출 (웹에서)
    Ws : 스티프너 수직 높이

    Returns: 12개 외측 꼭짓점 좌표 (검증된 경로, 상하 거울대칭)

    경로 구조:
      상부 ∪형 플랜지: 립끝(P0) → 위(P1) → 좌로 플랜지(P2) → 아래 되돌아감(P3)
      상부 웹: P3 → 아래(P4)
      스티프너: P4 → 우(P5) → 아래(P6) → 좌(P7)
      하부 웹: P7 → 아래(P8)
      하부 ∩형 플랜지: P8 → 우로 플랜지(P9) → 아래 되돌아감(P10) → 좌로 립(P11)

    주의: 위아래가 실제로는 거울대칭이 아니며, 아래 되돌림(P9→P10)과 립(P10→P11)은
    바깥면이 위쪽 부분과 판의 반대 면이다. 한 방향 outer_side 로는 중심선이 외측
    꼭짓점 범위를 t/2 벗어나므로 custom 경로가 거절한다(예전에는 단면이 t 만큼
    부풀었다). 구간별 목록(예: ['left'] * 9 + ['right'] * 2)이 필요하며, 아래
    플랜지(P8→P9)가 판의 어느 면에 놓이는지는 원 도면으로 정해야 한다.
    """
    web_seg = (H - 2 * D - Ws) / 2.0
    if web_seg < 0:
        web_seg = 0

    # 좌표계: x=우, y=위
    # 웹 x좌표 = B (우측), 플랜지는 좌(0~B), 스티프너는 더 우측(B+Ds)
    x_lip = B + D_lip
    x_web = B
    x_fl = 0        # 플랜지 좌측 끝 (= 웹 반대쪽)

    return [
        (x_lip, H - D),                    # P0: 상부 립 끝 (자유단)
        (x_lip, H),                         # P1: 상부 립 상단
        (x_fl, H),                          # P2: 상부 플랜지 상단 좌측
        (x_fl, H - D),                      # P3: 상부 플랜지 하단 (웹 접합, 되돌아감!)
        (x_fl, H - D - web_seg),            # P4: 스티프너 상단
        (x_fl + Ds, H - D - web_seg),       # P5: 스티프너 우측 상단
        (x_fl + Ds, H - D - web_seg - Ws),  # P6: 스티프너 우측 하단
        (x_fl, H - D - web_seg - Ws),       # P7: 스티프너 끝 (웹 복귀)
        (x_fl, D),                          # P8: 하부 플랜지 상단 (웹 접합)
        (x_lip, D),                         # P9: 하부 플랜지 하단 우측 (되돌아감!)
        (x_lip, 0),                         # P10: 하부 립-플랜지 코너
        (x_web, 0),                         # P11: 하부 립 끝 (자유단)
    ]


# ============================================================
# 구조 요소 기반 단면 빌더 (SectionBuilder)
# ============================================================

class SectionBuilder:
    """구조 요소(building block)를 조합하여 외측 꼭짓점 좌표를 생성.

    좌표를 직접 나열하지 않고, 요소 단위로 단면을 구성한다.
    각 요소는 이전 요소의 끝점에서 이어진다.

    좌표계: x=우(+), y=위(+)

    사용법:
        b = SectionBuilder()
        b.start(2.75, 7.125)             # 자유단 시작
        b.go(0, 0.875)                   # 위로 0.875
        b.go(-2.75, 0)                   # 좌로 2.75
        b.go(0, -0.875)                  # 아래로 0.875 (되돌아감!)
        b.go(0, -2.0)                    # 웹 아래로
        b.go(0.5, 0)                     # 스티프너 우로
        b.go(0, -2.25)                   # 스티프너 아래로
        b.go(-0.5, 0)                    # 스티프너 복귀
        b.go(0, -2.0)                    # 웹 아래로
        b.mirror_y()                     # 하부 = 상부 거울대칭
        corners = b.build()
    """

    def __init__(self):
        self._points: List[Tuple[float, float]] = []
        self._mirror_start: Optional[int] = None
        self._expected_center: Optional[Tuple[float, float]] = None

    def start(self, x: float, y: float) -> 'SectionBuilder':
        """경로 시작점 (자유단)."""
        self._points = [(x, y)]
        return self

    def go(self, dx: float, dy: float) -> 'SectionBuilder':
        """현재 점에서 (dx, dy)만큼 이동하여 다음 꼭짓점 추가."""
        if not self._points:
            raise ValueError("start()를 먼저 호출하세요")
        lx, ly = self._points[-1]
        self._points.append((round(lx + dx, 6), round(ly + dy, 6)))
        return self

    def go_to(self, x: float, y: float) -> 'SectionBuilder':
        """절대 좌표 (x, y)로 이동."""
        self._points.append((round(x, 6), round(y, 6)))
        return self

    def add_lip(self, length: float, direction: str) -> 'SectionBuilder':
        """립 추가. direction: 'up', 'down', 'left', 'right'."""
        dx, dy = _dir_to_delta(direction, length)
        return self.go(dx, dy)

    def set_expected_center(self, cx: float, cy: float) -> 'SectionBuilder':
        """단면의 예상 중심점 설정. lip_inward 방향 판별에 사용.

        경로 초기(점 1~2개)에서는 자동 중심 계산이 부정확하므로,
        전체 단면의 대략적 중심을 미리 알려주면 정확해진다.
        """
        self._expected_center = (cx, cy)
        return self

    def add_lip_inward(self, length: float) -> 'SectionBuilder':
        """립을 단면 중심 방향으로 자동 추가.

        우선순위:
        1. set_expected_center()로 설정된 중심 (가장 정확)
        2. 현재까지의 점들로 중심 추정 (점이 많을수록 정확)

        규칙: 립의 끝점이 단면 중심을 향하도록 방향 결정.
        """
        if len(self._points) < 2:
            return self.go(0, -length)

        if hasattr(self, '_expected_center') and self._expected_center:
            cx, cy = self._expected_center
        else:
            xs = [p[0] for p in self._points]
            ys = [p[1] for p in self._points]
            cx = sum(xs) / len(xs)
            cy = sum(ys) / len(ys)

        lx, ly = self._points[-1]
        dx_to_center = cx - lx
        dy_to_center = cy - ly

        px, py = self._points[-2]
        prev_dx = lx - px
        prev_dy = ly - py

        if abs(prev_dx) > abs(prev_dy):
            direction = 'down' if dy_to_center < 0 else 'up'
        else:
            direction = 'left' if dx_to_center < 0 else 'right'

        return self.add_lip(length, direction)

    def add_flange(self, width: float, direction: str) -> 'SectionBuilder':
        """플랜지 추가. direction: 'up', 'down', 'left', 'right'."""
        dx, dy = _dir_to_delta(direction, width)
        return self.go(dx, dy)

    def add_web(self, length: float, direction: str = 'down') -> 'SectionBuilder':
        """웹 추가. direction: 'up' or 'down'."""
        dx, dy = _dir_to_delta(direction, length)
        return self.go(dx, dy)

    def add_stiffener(self, protrusion: float, height: float,
                      direction: str = 'right') -> 'SectionBuilder':
        """Step 스티프너 추가 (수평 돌출 → 수직 → 수평 복귀).

        direction: 돌출 방향 ('left' or 'right')
        """
        dx, _ = _dir_to_delta(direction, protrusion)
        self.go(dx, 0)        # 수평 돌출
        self.go(0, -height)   # 수직 (항상 아래로)
        self.go(-dx, 0)       # 수평 복귀
        return self

    def add_track_flange(self, width: float, depth: float, lip: float,
                         flange_dir: str, lip_dir: str) -> 'SectionBuilder':
        """Track형 플랜지 (∪/∩ 형태, 3변 + 립).

        경로: 립 끝(자유단) → lip_dir(depth) → flange_dir(width) → 반대(depth, 되돌아감)

        Parameters:
            width: 플랜지 폭 (웹까지 수평 거리)
            depth: 플랜지 C형 깊이 (수직)
            lip: 립 폭 (플랜지 끝에서 추가 돌출)
            flange_dir: 플랜지가 뻗는 방향 ('left' or 'right')
            lip_dir: 립이 꺾이는 방향 ('up' or 'down')
        """
        # 이 함수는 시작점이 이미 lip 끝이라고 가정
        # lip_dir로 depth만큼 이동 (립 → 플랜지 상/하단)
        ld_dx, ld_dy = _dir_to_delta(lip_dir, depth)
        self.go(ld_dx, ld_dy)

        # flange_dir로 width만큼 이동 (플랜지)
        # 하지만 lip이 이미 width의 일부를 차지하므로, 실제 이동은 width
        fd_dx, fd_dy = _dir_to_delta(flange_dir, width)
        self.go(fd_dx, fd_dy)

        # 되돌아감: lip_dir의 반대 방향으로 depth만큼
        rev_dir = _opposite_dir(lip_dir)
        rd_dx, rd_dy = _dir_to_delta(rev_dir, depth)
        self.go(rd_dx, rd_dy)

        return self

    def mark_mirror(self) -> 'SectionBuilder':
        """이 시점 이후의 점들을 거울대칭 생성 대상으로 표시."""
        self._mirror_start = len(self._points)
        return self

    def mirror_y(self, y_center: Optional[float] = None) -> 'SectionBuilder':
        """현재까지의 경로를 y축 기준 거울대칭하여 하부 경로 자동 생성.

        y_center: 대칭축 y좌표. None이면 현재 점들의 중앙 사용.
        """
        if not self._points:
            return self

        start = self._mirror_start if self._mirror_start is not None else 0
        pts_to_mirror = self._points[start:]

        if y_center is None:
            all_y = [p[1] for p in self._points]
            y_center = (max(all_y) + min(all_y)) / 2.0

        # 거울 반사: (x, y) → (x, 2*y_center - y), 순서 반전
        mirrored = [(round(x, 6), round(2 * y_center - y, 6))
                    for x, y in reversed(pts_to_mirror)]

        # 중복 점 제거 (마지막 점 = 미러 첫 점이면)
        if mirrored and self._points:
            last = self._points[-1]
            first_m = mirrored[0]
            if abs(last[0] - first_m[0]) < 1e-6 and abs(last[1] - first_m[1]) < 1e-6:
                mirrored = mirrored[1:]

        self._points.extend(mirrored)
        return self

    def build(self) -> List[Tuple[float, float]]:
        """최종 외측 꼭짓점 좌표 반환."""
        return list(self._points)

    def build_json(self) -> list:
        """JSON 직렬화 가능한 리스트 반환."""
        return [[round(x, 4), round(y, 4)] for x, y in self._points]


def _dir_to_delta(direction: str, length: float) -> Tuple[float, float]:
    """방향 문자열을 (dx, dy) 변환."""
    d = direction.lower()
    if d == 'up':
        return (0.0, length)
    elif d == 'down':
        return (0.0, -length)
    elif d == 'left':
        return (-length, 0.0)
    elif d == 'right':
        return (length, 0.0)
    else:
        raise ValueError(f"Unknown direction: {direction}")


def _opposite_dir(direction: str) -> str:
    """반대 방향."""
    return {'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left'}[direction.lower()]


# ============================================================
# 통합 클래스: ColdFormedSection
# ============================================================

@dataclass
class ColdFormedSection:
    """
    범용 냉간성형강 단면 중심선 좌표 생성기.
    
    Parameters
    ----------
    outer_corners : list of (x, y)
        외측면의 sharp corner 좌표. 경로 순서대로.
        주의: R=0으로 가정한 외측면 교차점 좌표.
        
    t : float
        판 두께
        
    R_inner : float, optional
        내측 코너 반경 (모든 코너 동일). 기본값 0.
        
    corner_radii : list of float, optional
        코너별 개별 **내측** 반경. 길이 = len(outer_corners) - 2.
        중심선 반경은 r + t/2 로 계산한다(R_inner 와 같은 규약).
        R_inner와 동시 지정 시 corner_radii 우선.
        0이면 해당 코너는 sharp corner 유지.

    n_arc : int
        코너당 호 분할 수. 기본값 10.

    outer_side : str or list of str
        중심선 offset 방향 = 판 재료가 놓인 쪽(바깥면의 반대쪽).
        'left' / 'right' / 'auto' / 구간별 목록 — `offset_to_centerline` 참고.
        'auto' 는 중심선이 외측 꼭짓점 범위 안에 남는 방향을 고른다. 기본값 'left'.

    labels : list of str, optional
        각 외측 꼭짓점의 설명 라벨.
        길이 = len(outer_corners).
        
    origin : str
        좌표 원점. 'centroid'(도심), 'raw'(원점 이동 없음). 기본값 'centroid'.
    """
    outer_corners: List[Tuple[float, float]]
    t: float
    R_inner: float = 0.0
    corner_radii: Optional[List[float]] = None
    n_arc: int = 10
    outer_side: Union[str, List[str]] = 'left'
    labels: Optional[List[str]] = None
    origin: str = 'centroid'

    # 계산 결과 (초기화 후 자동 계산)
    _cl_corners: List[Tuple[float, float]] = field(default_factory=list, init=False, repr=False)
    _coords_raw: List[Tuple[float, float]] = field(default_factory=list, init=False, repr=False)
    _coords: List[Tuple[float, float]] = field(default_factory=list, init=False, repr=False)
    _seg_info: List[dict] = field(default_factory=list, init=False, repr=False)
    _xc: float = field(default=0.0, init=False, repr=False)
    _yc: float = field(default=0.0, init=False, repr=False)
    _total_L: float = field(default=0.0, init=False, repr=False)
    _props: dict = field(default_factory=dict, init=False, repr=False)
    resolved_outer_side: Union[str, List[str], None] = field(default=None, init=False, repr=False)

    def __post_init__(self):
        self._compute()

    def _compute(self):
        """전체 계산 파이프라인 실행"""
        n = len(self.outer_corners)
        n_inner = n - 2
        if not (self.t > 0):
            raise ValueError(f"t must be > 0, got {self.t!r}")
        if n < 2:
            raise ValueError("outer_corners must have at least 2 points")

        # Step 1: Offset
        side = self.outer_side
        if side == 'auto':
            side = resolve_outer_side(self.outer_corners, self.t)
        self.resolved_outer_side = side
        self._cl_corners = offset_to_centerline(
            self.outer_corners, self.t, side
        )

        # 필렛 반경 결정 (입력은 내측 반경, 필렛은 중심선 반경 r + t/2)
        if self.corner_radii is not None:
            if len(self.corner_radii) != n_inner:
                raise ValueError(
                    f"corner_radii length ({len(self.corner_radii)}) must equal the "
                    f"number of inner corners ({n_inner})")
            r_list = [float(r) + self.t / 2 if float(r) > 0 else 0.0
                      for r in self.corner_radii]
        elif self.R_inner > 0:
            r_c = self.R_inner + self.t / 2
            r_list = [r_c] * n_inner
        else:
            r_list = [0.0] * n_inner  # 필렛 없음

        # Step 2: Fillet
        self._coords_raw, self._seg_info = apply_fillet(
            self._cl_corners, r_list, self.n_arc
        )

        # Step 3: 도심 계산 및 이동
        self._xc, self._yc, self._total_L = compute_line_centroid(self._coords_raw)

        if self.origin == 'centroid':
            self._coords = shift_coords(self._coords_raw, -self._xc, -self._yc)
        else:
            self._coords = list(self._coords_raw)

        # Step 4: 단면물성
        coords_at_centroid = shift_coords(self._coords_raw, -self._xc, -self._yc)
        self._props = compute_section_properties(coords_at_centroid, self.t)

    # --- 접근자 ---
    
    def get_coords(self) -> List[Tuple[float, float]]:
        """최종 좌표 반환 (origin 설정에 따라 도심 또는 원래 원점)"""
        return list(self._coords)

    def get_coords_raw(self) -> List[Tuple[float, float]]:
        """도심 이동 전 원래 좌표"""
        return list(self._coords_raw)

    def get_cl_corners(self) -> List[Tuple[float, float]]:
        """중심선 sharp corner 좌표 (필렛 전)"""
        return list(self._cl_corners)

    @property
    def centroid(self) -> Tuple[float, float]:
        """도심 좌표 (원래 좌표계 기준)"""
        return (self._xc, self._yc)

    @property
    def total_length(self) -> float:
        """총 중심선 길이"""
        return self._total_L

    @property
    def r_c(self) -> float:
        """중심선 코너 반경 (균일 R 기준)"""
        return self.R_inner + self.t / 2

    @property
    def properties(self) -> dict:
        """단면물성 딕셔너리"""
        return dict(self._props)

    def get_labels(self) -> List[str]:
        """각 좌표점의 구간 라벨 생성"""
        n_outer = len(self.outer_corners)
        user_labels = self.labels or [f"P{i}" for i in range(n_outer)]

        result = []
        for info in self._seg_info:
            ci = info['corner_idx']
            if info['type'] == 'free_end':
                result.append(f"{user_labels[ci]} (자유단)")
            elif info['type'] == 'arc':
                if ci > 0 and ci < n_outer - 1:
                    result.append(f"Corner {user_labels[ci]}")
                else:
                    result.append(user_labels[ci])
            elif info['type'] == 'sharp':
                result.append(f"{user_labels[ci]} (sharp)")
            else:
                result.append(user_labels[ci])
        return result

    def to_csv(self, filepath: str, delimiter: str = ','):
        """CSV 파일로 출력"""
        labels = self.get_labels()
        with open(filepath, 'w') as f:
            f.write(f"No.{delimiter}X{delimiter}Y{delimiter}Segment\n")
            for i, ((x, y), lbl) in enumerate(zip(self._coords, labels)):
                f.write(f"{i}{delimiter}{x:.6f}{delimiter}{y:.6f}{delimiter}{lbl}\n")

    def summary(self) -> str:
        """요약 문자열"""
        xs = [c[0] for c in self._coords]
        ys = [c[1] for c in self._coords]
        p = self._props
        lines = [
            "=== Cold-Formed Section Summary ===",
            f"  판 두께 t = {self.t}",
            f"  내측 R = {self.R_inner}",
            f"  중심선 r_c = {self.r_c:.4f}",
            f"  좌표 수 = {len(self._coords)}",
            f"  도심 (raw) = ({self._xc:.4f}, {self._yc:.4f})",
            f"  총 중심선 길이 = {self._total_L:.4f}",
            f"  X 범위: {min(xs):.4f} ~ {max(xs):.4f}",
            f"  Y 범위: {min(ys):.4f} ~ {max(ys):.4f}",
            f"  A = {p['A']:.6f}",
            f"  Ix = {p['Ix']:.6f}",
            f"  Iy = {p['Iy']:.6f}",
            f"  Ixy = {p['Ixy']:.6f}",
        ]
        return "\n".join(lines)


# ============================================================
# 프리셋 단면 생성 팩토리 함수
# ============================================================

def make_c_section(
    H: float, B: float, D: float, t: float, R: float,
    D_top: float = None, n_arc: int = 10
) -> ColdFormedSection:
    """
    C형강 (채널) 단면 생성
    
    Parameters
    ----------
    H : 총 높이 (외측)
    B : 플랜지 폭 (외측)
    D : 립 깊이 (외측). 하단 립. 0이면 립 없음.
    t : 판 두께
    R : 내측 코너 반경
    D_top : 상부 립 깊이. None이면 D와 동일.
    
    형상:
        lip(상) ─── flange(상)
                          │
                          web
                          │
        lip(하) ─── flange(하)
    
    경로: 하단 립 끝 → 하단 플랜지 좌측 → 우측(웹) → 상부 플랜지 우측 → 좌측 → 상부 립 끝
    """
    if D_top is None:
        D_top = D

    corners = []
    labels = []

    # 립은 플랜지 안쪽(+y)으로 꺾인다
    if D > 0:
        corners.append((0, D))
        labels.append("하단 립 끝")

    corners.append((0, 0))
    labels.append("하단 립-플랜지")

    corners.append((B, 0))
    labels.append("하단 플랜지-웹")

    corners.append((B, H))
    labels.append("상부 웹-플랜지")

    corners.append((0, H))
    labels.append("상부 플랜지-립")

    if D_top > 0:
        corners.append((0, H - D_top))
        labels.append("상부 립 끝")

    return ColdFormedSection(
        outer_corners=corners, t=t, R_inner=R,
        n_arc=n_arc, outer_side='left', labels=labels,
    )


def make_z_section(
    H: float, B_top: float, B_bot: float, D: float, t: float, R: float,
    D_top: float = None, n_arc: int = 10
) -> ColdFormedSection:
    """
    Z형강 단면 생성
    
    Parameters
    ----------
    H : 총 높이 (외측)
    B_top : 상부 플랜지 폭 (외측, 좌측으로 돌출)
    B_bot : 하부 플랜지 폭 (외측, 우측으로 돌출)
    D : 립 깊이
    t : 판 두께
    R : 내측 코너 반경
    
    형상:
        lip(상) ─── flange(상, 좌측)
                   │
                   web
                   │
                   flange(하, 우측) ─── lip(하)

    Z 는 아래 플랜지의 바깥면(아랫면)과 위 플랜지의 바깥면(윗면)이 판의 서로 다른
    면이라 한 방향 offset 으로 만들 수 없다. 구간별 outer_side 를 쓰고, 웹 선은
    아래 굽힘의 바깥면(웹 왼쪽 면 x=0)으로 둔다. 위 플랜지 폭 B_top 은 위 굽힘의
    바깥면(웹 오른쪽 면 x=t)에서 재므로 립 바깥면은 x = t − B_top 이다.
    결과는 template lippedz(qlip=90) 와 같은 중심선 치수(b = B − t, h = H − t)다.
    """
    if D_top is None:
        D_top = D

    corners = []
    labels = []
    sides = []

    # 립은 플랜지 안쪽으로 꺾인다
    if D > 0:
        corners.append((B_bot, D))
        labels.append("하단 립 끝")
        sides.append('right')

    corners.append((B_bot, 0))
    labels.append("하단 립-플랜지")
    sides.append('right')

    corners.append((0, 0))
    labels.append("하단 플랜지-웹")
    sides.append('right')

    corners.append((0, H))
    labels.append("상부 웹-플랜지")
    sides.append('left')

    corners.append((t - B_top, H))
    labels.append("상부 플랜지-립")

    if D_top > 0:
        corners.append((t - B_top, H - D_top))
        labels.append("상부 립 끝")
        sides.append('left')

    return ColdFormedSection(
        outer_corners=corners, t=t, R_inner=R,
        n_arc=n_arc, outer_side=sides, labels=labels,
    )


def make_hat_section(
    H: float, B_top: float, B_bot: float, t: float, R: float,
    n_arc: int = 10
) -> ColdFormedSection:
    """
    Hat(모자) 단면 생성
    
    Parameters
    ----------
    H : 높이 (외측)
    B_top : 상부 폭 (외측)
    B_bot : 하부 플랜지 총 폭 (외측, 양쪽 합)
    
    형상 (좌우 대칭):
        flange(하좌) ── web(좌) ── top ── web(우) ── flange(하우)
    
    하부 플랜지 각 측 폭 = (B_bot - B_top) / 2

    브림의 바깥면(아랫면)과 상판의 바깥면(윗면)은 판의 서로 다른 면이므로
    구간별 outer_side 를 쓴다(브림: 재료가 위 = 'left', 웹 · 상판: 재료가 안쪽 = 'right').
    """
    corners = [
        (-B_bot / 2, 0),           # 좌측 플랜지 끝
        (-B_top / 2, 0),           # 좌측 플랜지-웹
        (-B_top / 2, H),           # 좌측 웹-상판
        (B_top / 2, H),            # 우측 웹-상판
        (B_top / 2, 0),            # 우측 플랜지-웹
        (B_bot / 2, 0),            # 우측 플랜지 끝
    ]
    labels = [
        "좌측 플랜지 끝", "좌측 플랜지-웹", "좌측 웹-상판",
        "우측 웹-상판", "우측 플랜지-웹", "우측 플랜지 끝"
    ]

    return ColdFormedSection(
        outer_corners=corners, t=t, R_inner=R,
        n_arc=n_arc, outer_side=['left', 'right', 'right', 'right', 'left'],
        labels=labels,
    )


def make_sigma_section(
    H: float, B: float, D_bot: float, D_top: float,
    sigma_depth: float, sigma_transition: float,
    t: float, R: float, n_arc: int = 10
) -> ColdFormedSection:
    """
    시그마(Σ) 단면 생성
    
    Parameters
    ----------
    H : 총 높이 (외측)
    B : 플랜지 폭 (외측)
    D_bot : 하단 립 깊이
    D_top : 상부 립 깊이
    sigma_depth : 시그마 내측 수평 깊이 (웹에서 안쪽으로의 수평 거리)
    sigma_transition : 시그마 전이부 수직 높이
    t : 판 두께
    R : 내측 코너 반경
    
    형상:
        lip(상) ─── flange(상)
                         │  web(상)
                        ╱   sigma transition
                       │    sigma center web
                        ╲   sigma transition
                         │  web(하)
        lip(하) ─── flange(하)
    """
    # 실제로는 이미지에서 직접 읽은 치수 사용
    # 여기서는 총 높이에서 역산
    # H = web_lower + sigma_trans + sigma_center + sigma_trans + web_upper
    # 대칭 가정: web_lower = web_upper = h_web_outer
    # h_web_outer = (H - sigma_center - 2*sigma_trans) / 2
    # 시그마 단면 이미지에서: h_web_outer = 2.25, sigma_center = 2.25, sigma_trans = 0.625
    # → 사용자가 직접 지정하는 것이 더 정확

    # 실제로는 외측 꼭짓점을 직접 정의하는 것이 가장 정확
    # 하지만 팩토리 함수에서는 표준 시그마 구조를 가정

    # 수정: 사용자가 직접 외측 꼭짓점을 지정하도록 유도하되,
    # 여기서는 이미지와 동일한 구조를 생성

    corners = [
        (0, D_bot),                                            # 하단 립 끝 (안쪽 +y)
        (0, 0),                                                 # 하단 립-플랜지
        (B, 0),                                                 # 하단 플랜지-웹
        (B, (H - 2*sigma_transition) / 3),                     # 하부 웹-시그마
        (B - sigma_depth, 
         (H - 2*sigma_transition) / 3 + sigma_transition),     # 시그마 내측 하
        (B - sigma_depth, 
         H - (H - 2*sigma_transition) / 3 - sigma_transition), # 시그마 내측 상
        (B, H - (H - 2*sigma_transition) / 3),                 # 시그마-상부 웹
        (B, H),                                                 # 상부 웹-플랜지
        (0, H),                                                 # 상부 플랜지-립
        (0, H - D_top),                                         # 상부 립 끝
    ]

    labels = [
        "하단 립 끝", "하단 립-플랜지", "하단 플랜지-웹",
        "웹-시그마(하)", "시그마 내측(하)", "시그마 내측(상)",
        "시그마-웹(상)", "상부 웹-플랜지", "상부 플랜지-립", "상부 립 끝"
    ]

    return ColdFormedSection(
        outer_corners=corners, t=t, R_inner=R,
        n_arc=n_arc, outer_side='left', labels=labels,
    )


# ============================================================
# 메인: 검증 테스트
# ============================================================

if __name__ == "__main__":
    print("=" * 60)
    print("냉간성형강 중심선 좌표 생성기 - 검증 테스트")
    print("=" * 60)

    # --- Test 1: C-section ---
    print("\n--- C-section (600C200-54) ---")
    c_sec = make_c_section(H=6.0, B=2.0, D=0.625, t=0.054, R=3/16)
    print(c_sec.summary())

    # --- Test 2: Z-section ---
    print("\n--- Z-section ---")
    z_sec = make_z_section(H=8.0, B_top=2.5, B_bot=2.5, D=0.75, t=0.060, R=3/16)
    print(z_sec.summary())

    # --- Test 3: Hat section ---
    print("\n--- Hat section ---")
    hat = make_hat_section(H=3.0, B_top=4.0, B_bot=8.0, t=0.048, R=3/16)
    print(hat.summary())

    # --- Test 4: Sigma section (이미지 단면) ---
    print("\n--- Sigma section (이미지) ---")
    sigma = ColdFormedSection(
        outer_corners=[
            (0.0, 1.00),
            (0.0, 0.0),
            (2.50, 0.0),
            (2.50, 2.25),
            (2.00, 2.875),
            (2.00, 5.125),
            (2.50, 5.75),
            (2.50, 8.00),
            (0.0, 8.00),
            (0.0, 7.125),
        ],
        t=0.0451,
        R_inner=3/32,
        n_arc=10,
        outer_side='left',
        labels=[
            "하단 립 끝", "하단 립-플랜지", "하단 플랜지-웹",
            "웹-시그마(하)", "시그마 내측(하)", "시그마 내측(상)",
            "시그마-웹(상)", "상부 웹-플랜지", "상부 플랜지-립", "상부 립 끝"
        ],
    )
    print(sigma.summary())

    # --- Test 5: 임의 단면 (립 없는 앵글) ---
    print("\n--- L-section (앵글) ---")
    angle = ColdFormedSection(
        outer_corners=[
            (0, 0),      # 수직 끝
            (0, 3.0),    # 코너
            (3.0, 3.0),  # 수평 끝
        ],
        t=0.125,
        R_inner=0.1875,
        n_arc=8,
        outer_side='left',
        labels=["수직 끝", "코너", "수평 끝"],
    )
    print(angle.summary())

    # --- 시각화 ---
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(2, 3, figsize=(18, 14))
        
        sections = [
            (c_sec, "C-section"),
            (z_sec, "Z-section"),
            (hat, "Hat section"),
            (sigma, "Sigma section"),
            (angle, "L-section (Angle)"),
        ]
        
        for idx, (sec, title) in enumerate(sections):
            ax = axes[idx // 3][idx % 3]
            coords = sec.get_coords()
            xs = [c[0] for c in coords]
            ys = [c[1] for c in coords]
            ax.plot(xs, ys, 'b-', linewidth=1.5)
            ax.plot(0, 0, 'r+', markersize=12, markeredgewidth=2)
            ax.set_aspect('equal')
            ax.grid(True, alpha=0.3)
            ax.set_title(title, fontsize=12, fontweight='bold')
            ax.set_xlabel('X')
            ax.set_ylabel('Y')
        
        # 빈 subplot 제거
        axes[1][2].set_visible(False)
        
        plt.tight_layout()
        import os
        import tempfile
        out_png = os.path.join(tempfile.gettempdir(), 'cfs_sections_test.png')
        plt.savefig(out_png, dpi=150)
        print(f"\n검증 플롯 저장: {out_png}")
    except ImportError:
        print("matplotlib 없음, 플롯 생략")
