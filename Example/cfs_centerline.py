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
      outer_side='left',                         # 외측면 방향 ('left' or 'right')
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

def offset_to_centerline(
    outer_corners: List[Tuple[float, float]],
    t: float,
    outer_side: str = 'left'
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
    outer_side : str
        'left'  = 경로 진행방향 좌측이 외측면 (기본값)
        'right' = 경로 진행방향 우측이 외측면
        
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
        경로의 시작점에서 끝점까지 순서대로 따라갈 때,
        판의 바깥면(외측)이 진행방향의 왼쪽에 있으면 'left'
        
        예시 (C-section, 하단 립→하단 플랜지→웹→상부 플랜지→상부 립):
        - 웹이 우측에 있는 일반 C: outer_side='left'
        - 웹이 좌측에 있는 역방향 C: outer_side='right'
    """
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
    - d_tan이 인접 변 길이의 45%를 초과하면 반경 자동 축소
    - θ ≈ 0° 또는 180°이면 필렛 생략
    """
    n = len(cl_corners)
    n_inner = n - 2  # 내부 코너 수

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
        L1 = _vec_len(xp - x, yp - y)

        # 꼭짓점 → 다음점 방향
        u2x, u2y = _vec_normalize(xn - x, yn - y)
        L2 = _vec_len(xn - x, yn - y)

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

        # 접선점 거리
        tan_dist = r / math.tan(theta / 2)

        # 안전장치: 인접 변 길이의 45% 초과 시 반경 축소
        max_tan = min(L1, L2) * 0.45
        if tan_dist > max_tan:
            r_actual = max_tan * math.tan(theta / 2)
            tan_dist = max_tan
        else:
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

        # 호 방향 결정 (modular arithmetic으로 정확한 최소 호 보장)
        # cross > 0: u1→u2가 CCW → 호는 CW (짧은 쪽)
        # cross < 0: u1→u2가 CW → 호는 CCW (짧은 쪽)
        TWO_PI = 2 * math.pi
        if cross > 0:
            # CW 호: end_ang < start_ang, 차이를 (0, 2π) 범위로
            diff = (start_ang - end_ang) % TWO_PI
            if diff < 1e-10:
                diff = TWO_PI
            end_ang = start_ang - diff
        else:
            # CCW 호: end_ang > start_ang, 차이를 (0, 2π) 범위로
            diff = (end_ang - start_ang) % TWO_PI
            if diff < 1e-10:
                diff = TWO_PI
            end_ang = start_ang + diff

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
        코너별 개별 내측 반경. 길이 = len(outer_corners) - 2.
        R_inner와 동시 지정 시 corner_radii 우선.
        0이면 해당 코너는 sharp corner 유지.
        
    n_arc : int
        코너당 호 분할 수. 기본값 10.
        
    outer_side : str
        외측면 방향. 'left' 또는 'right'. 기본값 'left'.
        
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
    outer_side: str = 'left'
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

    def __post_init__(self):
        self._compute()

    def _compute(self):
        """전체 계산 파이프라인 실행"""
        n = len(self.outer_corners)
        n_inner = n - 2

        # Step 1: Offset
        self._cl_corners = offset_to_centerline(
            self.outer_corners, self.t, self.outer_side
        )

        # 필렛 반경 결정
        if self.corner_radii is not None:
            r_list = [r + self.t / 2 if r > 0 else 0.0 for r in self.corner_radii]
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
            f"=== Cold-Formed Section Summary ===",
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
    """
    if D_top is None:
        D_top = D

    corners = []
    labels = []

    if D > 0:
        corners.append((B_bot, D))
        labels.append("하단 립 끝")

    corners.append((B_bot, 0))
    labels.append("하단 립-플랜지")

    corners.append((0, 0))
    labels.append("하단 플랜지-웹")

    corners.append((0, H))
    labels.append("상부 웹-플랜지")

    corners.append((-B_top, H))
    labels.append("상부 플랜지-립")

    if D_top > 0:
        corners.append((-B_top, H - D_top))
        labels.append("상부 립 끝")

    return ColdFormedSection(
        outer_corners=corners, t=t, R_inner=R,
        n_arc=n_arc, outer_side='right', labels=labels,
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
    """
    f = (B_bot - B_top) / 2  # 각 측 플랜지 돌출

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
        n_arc=n_arc, outer_side='right', labels=labels,
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
    # 시그마 구조: H = web_lower + sigma_trans + sigma_center + sigma_trans + web_upper
    # 대칭 가정: web_lower = web_upper
    # 3등분: 상/하 웹과 시그마 중심부를 동일 높이로 분배
    # h_segment = (H - 2 * sigma_transition) / 3

    corners = [
        (0, -D_bot),                                           # 하단 립 끝
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
            (0.0, -1.00),
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
        save_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cfs_sections_test.png')
        plt.savefig(save_path, dpi=150)
        print(f"\n검증 플롯 저장: {save_path}")
    except ImportError:
        print("matplotlib 없음, 플롯 생략")
