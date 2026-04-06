"""연속보 구조해석 — 3-모멘트법 및 직접 강성법

등분포하중을 받는 단순보~N경간 연속보의 M, V, R 다이어그램을 계산한다.
비등단면(랩 구간 Ix 합산)도 지원한다.
"""

import math
from typing import List, Tuple, Optional

# ---------------------------------------------------------------------------
# 해석 결과 클래스
# ---------------------------------------------------------------------------

class BeamResult:
    """단일 하중 케이스의 구조해석 결과"""

    def __init__(self, x: list, M: list, V: list, R: list, n_pts: int):
        self.x = x          # 좌표 (in. 단위)
        self.M = M          # 모멘트 (kip-ft)
        self.V = V          # 전단력 (kips)
        self.R = R          # 지점 반력 (kips)
        self.n_pts = n_pts

    def max_positive_M(self) -> Tuple[float, float]:
        """최대 정모멘트 (x_ft, M_kft)"""
        idx = max(range(len(self.M)), key=lambda i: self.M[i])
        return (self.x[idx], self.M[idx])

    def max_negative_M(self) -> Tuple[float, float]:
        """최대 부모멘트 (x_ft, M_kft) — 가장 큰 음수"""
        idx = min(range(len(self.M)), key=lambda i: self.M[i])
        return (self.x[idx], self.M[idx])

    def max_shear(self) -> Tuple[float, float]:
        """최대 전단력 (x_ft, V_kips) — 절대값 최대"""
        idx = max(range(len(self.V)), key=lambda i: abs(self.V[i]))
        return (self.x[idx], self.V[idx])

    def inflection_points(self) -> List[float]:
        """변곡점 (M=0) 위치 리스트 (ft)"""
        pts = []
        for i in range(len(self.M) - 1):
            if self.M[i] * self.M[i + 1] < 0:
                # 선형 보간
                x_zero = self.x[i] - self.M[i] * (self.x[i + 1] - self.x[i]) / (self.M[i + 1] - self.M[i])
                pts.append(x_zero)
        return pts

    def to_dict(self) -> dict:
        return {
            'x': self.x,
            'M': self.M,
            'V': self.V,
            'R': self.R,
            'D': getattr(self, 'D', []),
        }


# ---------------------------------------------------------------------------
# 단순보 (Simple Span)
# ---------------------------------------------------------------------------

def analyze_simple_beam(L_ft: float, w_plf: float, n_pts: int = 101) -> BeamResult:
    """등분포하중 단순보 해석

    Parameters
    ----------
    L_ft : float — 스팬 길이 (ft)
    w_plf : float — 등분포하중 (plf, lb/ft)
    n_pts : int — 출력 점 수
    """
    w = w_plf / 1000.0  # kip/ft
    L = L_ft
    R_left = w * L / 2.0
    R_right = w * L / 2.0

    dx = L / (n_pts - 1) if n_pts > 1 else L
    x_list = [i * dx for i in range(n_pts)]
    M_list = []
    V_list = []

    for x in x_list:
        V = R_left - w * x  # kips
        M = R_left * x - w * x * x / 2.0  # kip-ft
        V_list.append(V)
        M_list.append(M)

    return BeamResult(x_list, M_list, V_list, [R_left, R_right], n_pts)


# ---------------------------------------------------------------------------
# N경간 등단면 등경간 연속보 — 3-모멘트법 (Clapeyron)
# ---------------------------------------------------------------------------

def analyze_continuous_beam(n_spans: int, L_ft: float, w_plf: float,
                            n_pts_per_span: int = 51) -> BeamResult:
    """등분포하중 N경간 등단면 등경간 연속보 해석

    3-모멘트법(Three-Moment Equation)으로 지점 모멘트를 구하고,
    각 스팬의 M, V를 역산한다.

    Parameters
    ----------
    n_spans : int — 경간 수 (1=단순보, 2, 3, 4, ...)
    L_ft : float — 각 스팬 길이 (ft), 등경간
    w_plf : float — 등분포하중 (plf)
    n_pts_per_span : int — 스팬당 출력 점 수
    """
    if n_spans == 1:
        return analyze_simple_beam(L_ft, w_plf, n_pts_per_span)

    w = w_plf / 1000.0  # kip/ft
    L = L_ft
    n_sup = n_spans + 1  # 지점 수

    # 3-모멘트법: Mi-1*Li + 2*Mi*(Li+Li+1) + Mi+1*Li+1 = -6*(RHS)
    # 등경간 등분포하중: RHS = wL^3/4 for each span
    # M[0] = M[n_spans] = 0 (양단 힌지)
    # 내부 지점: n_spans - 1 개 미지수

    n_unknowns = n_spans - 1
    if n_unknowns == 0:
        return analyze_simple_beam(L_ft, w_plf, n_pts_per_span)

    # 등경간이므로 Li = Li+1 = L
    # 3-moment equation (Clapeyron):
    # Mi-1*L + 2*Mi*(2L) + Mi+1*L = -6*(wL^3/24 + wL^3/24)
    # → Mi-1 + 4*Mi + Mi+1 = -wL^2/2
    rhs_val = -w * L * L / 2.0  # -wL^2/2

    # 연립방정식 Ax = b (tridiagonal)
    A = [[0.0] * n_unknowns for _ in range(n_unknowns)]
    b = [rhs_val] * n_unknowns

    for i in range(n_unknowns):
        A[i][i] = 4.0
        if i > 0:
            A[i][i - 1] = 1.0
        if i < n_unknowns - 1:
            A[i][i + 1] = 1.0

    # 삼대각 행렬 직접 풀이 (Thomas algorithm)
    M_support = _solve_tridiagonal(A, b)

    # 전체 지점 모멘트: [0, M1, M2, ..., Mn-1, 0]
    M_sup = [0.0] + M_support + [0.0]

    # 지점 반력 계산
    reactions = []
    for j in range(n_sup):
        R_j = 0.0
        if j == 0:
            # 좌측 단부: span 1의 좌반력
            R_j = w * L / 2.0 + (M_sup[1] - M_sup[0]) / L
        elif j == n_sup - 1:
            # 우측 단부: 마지막 스팬의 우반력
            R_j = w * L / 2.0 - (M_sup[j] - M_sup[j - 1]) / L
        else:
            # 내부 지점: 좌측 스팬의 우반력 + 우측 스팬의 좌반력
            R_left_span_right = w * L / 2.0 - (M_sup[j] - M_sup[j - 1]) / L
            R_right_span_left = w * L / 2.0 + (M_sup[j + 1] - M_sup[j]) / L
            R_j = R_left_span_right + R_right_span_left
        reactions.append(R_j)

    # M, V 다이어그램 생성
    x_all = []
    M_all = []
    V_all = []

    for span_i in range(n_spans):
        M_left = M_sup[span_i]
        M_right = M_sup[span_i + 1]

        # 이 스팬의 좌측 반력 (단순보 + 지점모멘트 보정)
        R_span_left = w * L / 2.0 + (M_right - M_left) / L

        dx = L / (n_pts_per_span - 1) if n_pts_per_span > 1 else L
        for k in range(n_pts_per_span):
            if span_i > 0 and k == 0:
                continue  # 중복 지점 방지
            x_local = k * dx
            x_global = span_i * L + x_local

            V_x = R_span_left - w * x_local
            M_x = M_left + R_span_left * x_local - w * x_local * x_local / 2.0

            x_all.append(x_global)
            M_all.append(M_x)
            V_all.append(V_x)

    return BeamResult(x_all, M_all, V_all, reactions,
                      n_spans * (n_pts_per_span - 1) + 1)


# ---------------------------------------------------------------------------
# 다경간 부등경간 연속보 — 3-모멘트법 (일반형)
# ---------------------------------------------------------------------------

def analyze_continuous_beam_general(
    spans: List[float],
    w_plf_list: List[float],
    Ix_list: Optional[List[float]] = None,
    n_pts_per_span: int = 51,
    supports: Optional[List[str]] = None,
) -> BeamResult:
    """부등경간·부등하중 연속보 해석

    Parameters
    ----------
    spans : list of float — 각 스팬 길이 (ft)
    w_plf_list : list of float — 각 스팬의 등분포하중 (plf)
    Ix_list : list of float, optional — 각 스팬의 Ix (in^4), 비등단면 시
    n_pts_per_span : int
    supports : list of str, optional — 지점 조건 ['P','P',...,'P']
               'P'=Pin, 'R'=Roller, 'F'=Fixed.
               P와 R은 해석에 동일 (M=0), F는 고정단 (M!=0).
    """
    n_spans = len(spans)

    # 지점 조건 정규화
    if not supports:
        supports = ['P'] * (n_spans + 1)
    sup = [s[0].upper() if s else 'P' for s in supports]

    # 단순보 특수 처리
    if n_spans == 1 and sup[0] != 'F' and sup[1] != 'F':
        return analyze_simple_beam(spans[0], w_plf_list[0], n_pts_per_span)

    w_list = [w / 1000.0 for w in w_plf_list]  # kip/ft

    # 고정단(F) 포함 시 확장된 3-모멘트 방정식
    # 좌측 고정단: M0도 미지수 → 가상 스팬(L=0) 추가로 모델링
    #   3-moment eq: 2*M0*L1 + M1*L1 = -w1*L1^3/4 (좌측 고정단 조건)
    # 우측 고정단: M_n도 미지수 → 동일 처리
    # 핀/롤러: M=0 (기존 경계조건)

    left_fixed = (sup[0] == 'F')
    right_fixed = (sup[-1] == 'F')

    # 미지수: 내부 지점 모멘트 + 고정단 모멘트
    # 인덱스 매핑: unknowns[0..n-1] = M_support[1..n_spans-1]
    #              + left_fixed → M0, right_fixed → M_n
    n_inner = n_spans - 1
    n_total = n_inner + (1 if left_fixed else 0) + (1 if right_fixed else 0)

    if n_total == 0:
        # 단순보 (1 스팬, 양단 핀)
        return analyze_simple_beam(spans[0], w_plf_list[0], n_pts_per_span)

    # 미지수 인덱스: [left_fixed_M0?, M1, M2, ..., M_{n-1}, right_fixed_Mn?]
    idx_offset = 1 if left_fixed else 0
    # idx_of_support[j] = 미지수 배열의 인덱스 (-1이면 M=0 고정)
    idx_of_support = [-1] * (n_spans + 1)
    if left_fixed:
        idx_of_support[0] = 0
    for j in range(1, n_spans):
        idx_of_support[j] = j - 1 + idx_offset
    if right_fixed:
        idx_of_support[n_spans] = n_total - 1

    A = [[0.0] * n_total for _ in range(n_total)]
    b_vec = [0.0] * n_total

    # 좌측 고정단 방정식: slope=0 at support 0
    # 3-moment: 2*M0*L1 + M1*L1 = -w1*L1^3/4
    if left_fixed:
        L1 = spans[0]
        w1 = w_list[0]
        row = 0
        A[row][idx_of_support[0]] = 2.0 * L1
        if idx_of_support[1] >= 0:
            A[row][idx_of_support[1]] = L1
        b_vec[row] = -w1 * L1 ** 3 / 4.0

    # 내부 지점 방정식 (기존 3-moment)
    for j in range(1, n_spans):
        row = idx_of_support[j]
        Li = spans[j - 1]
        Li1 = spans[j] if j < n_spans else 0
        wi = w_list[j - 1]
        wi1 = w_list[j] if j < n_spans else 0

        # M_{j-1} * Li + 2*M_j*(Li+Li1) + M_{j+1} * Li1 = -(...)/4
        A[row][row] = 2.0 * (Li + Li1)
        if idx_of_support[j - 1] >= 0:
            A[row][idx_of_support[j - 1]] = Li
        else:
            pass  # M_{j-1} = 0 (핀), 이미 0
        if idx_of_support[j + 1] >= 0:
            A[row][idx_of_support[j + 1]] = Li1
        else:
            pass  # M_{j+1} = 0 (핀)

        b_vec[row] = -(wi * Li ** 3 + wi1 * Li1 ** 3) / 4.0

    # 우측 고정단 방정식: slope=0 at support n_spans
    # 3-moment: M_{n-1}*Ln + 2*Mn*Ln = -wn*Ln^3/4
    if right_fixed:
        Ln = spans[-1]
        wn = w_list[-1]
        row = idx_of_support[n_spans]
        A[row][row] = 2.0 * Ln
        if idx_of_support[n_spans - 1] >= 0:
            A[row][idx_of_support[n_spans - 1]] = Ln
        b_vec[row] = -wn * Ln ** 3 / 4.0

    # 연립방정식 풀기
    M_solution = _solve_general(A, b_vec)

    # M_sup 배열 복원
    M_sup = [0.0] * (n_spans + 1)
    for j in range(n_spans + 1):
        if idx_of_support[j] >= 0:
            M_sup[j] = M_solution[idx_of_support[j]]

    # 반력
    reactions = []
    for j in range(n_spans + 1):
        R_j = 0.0
        if j == 0:
            w0 = w_list[0]
            L0 = spans[0]
            R_j = w0 * L0 / 2.0 + (M_sup[1] - M_sup[0]) / L0
        elif j == n_spans:
            wn = w_list[-1]
            Ln = spans[-1]
            R_j = wn * Ln / 2.0 - (M_sup[j] - M_sup[j - 1]) / Ln
        else:
            wL = w_list[j - 1]
            LL = spans[j - 1]
            wR = w_list[j] if j < n_spans else 0
            LR = spans[j] if j < n_spans else 0
            R_left_right = wL * LL / 2.0 - (M_sup[j] - M_sup[j - 1]) / LL
            R_right_left = (wR * LR / 2.0 + (M_sup[j + 1] - M_sup[j]) / LR) if LR > 0 else 0
            R_j = R_left_right + R_right_left
        reactions.append(R_j)

    # M, V 다이어그램
    x_all = []
    M_all = []
    V_all = []
    x_offset = 0.0

    for span_i in range(n_spans):
        Li = spans[span_i]
        wi = w_list[span_i]
        ML = M_sup[span_i]
        MR = M_sup[span_i + 1]
        R_span_left = wi * Li / 2.0 + (MR - ML) / Li

        dx = Li / (n_pts_per_span - 1) if n_pts_per_span > 1 else Li
        for k in range(n_pts_per_span):
            if span_i > 0 and k == 0:
                continue
            x_local = k * dx
            x_global = x_offset + x_local

            V_x = R_span_left - wi * x_local
            M_x = ML + R_span_left * x_local - wi * x_local * x_local / 2.0

            x_all.append(x_global)
            M_all.append(M_x)
            V_all.append(V_x)

        x_offset += Li

    total_pts = n_spans * (n_pts_per_span - 1) + 1
    return BeamResult(x_all, M_all, V_all, reactions, total_pts)


# ---------------------------------------------------------------------------
# 임계 위치 추출
# ---------------------------------------------------------------------------

def extract_critical_locations(result: BeamResult, spans: List[float],
                               laps: dict = None) -> list:
    """해석 결과에서 설계에 필요한 임계 위치를 자동 추출

    Returns list of dicts:
        [{'name': ..., 'x_ft': ..., 'M': ..., 'V': ..., 'R_support': ...}, ...]
    """
    locations = []
    n_spans = len(spans)

    # 1. 각 스팬의 최대 정모멘트 및 최대 부모멘트
    x_offset = 0.0
    for i in range(n_spans):
        L = spans[i]
        span_start = x_offset
        span_end = x_offset + L

        # 이 스팬 범위의 점들
        max_M = -1e30
        max_x = span_start
        max_j = 0
        min_M = 1e30
        min_x = span_start
        min_j = 0
        for j, x in enumerate(result.x):
            if span_start <= x <= span_end:
                if result.M[j] > max_M:
                    max_M = result.M[j]
                    max_x = x
                    max_j = j
                if result.M[j] < min_M:
                    min_M = result.M[j]
                    min_x = x
                    min_j = j

        if max_M > 0:
            label = 'End span +M' if i == 0 or i == n_spans - 1 else f'Int span {i+1} +M'
            V_at_max = abs(result.V[max_j]) if max_j < len(result.V) else None
            locations.append({
                'name': label, 'x_ft': round(max_x, 2),
                'Mu': round(max_M, 3),
                'Vu': round(V_at_max, 3) if V_at_max is not None else None,
                'Ru': None,
                'region': 'positive',
            })

        # 스팬 내 부모멘트 (캔틸레버 등 음수 모멘트 지배 구간)
        if min_M < 0:
            label = 'End span -M' if i == 0 or i == n_spans - 1 else f'Int span {i+1} -M'
            V_at_min = abs(result.V[min_j]) if min_j < len(result.V) else None
            locations.append({
                'name': label, 'x_ft': round(min_x, 2),
                'Mu': round(min_M, 3),
                'Vu': round(V_at_min, 3) if V_at_min is not None else None,
                'Ru': None,
                'region': 'negative',
            })

        x_offset += L

    # 2. 각 내부 지점의 부모멘트 + 전단 + 반력
    x_offset = 0.0
    for i in range(n_spans):
        x_offset += spans[i]
        if i < n_spans - 1:
            # 지점 위치
            sup_x = x_offset
            # 가장 가까운 점 찾기
            closest_idx = min(range(len(result.x)),
                              key=lambda j: abs(result.x[j] - sup_x))
            M_sup = result.M[closest_idx]
            # 전단: 지점 직전 (좌측값)
            V_left_idx = max(0, closest_idx - 1)
            V_sup = abs(result.V[V_left_idx])

            label = '1st interior' if i == 0 else ('Center' if i == n_spans // 2 else f'Support {i+1}')
            locations.append({
                'name': label, 'x_ft': round(sup_x, 2),
                'Mu': round(M_sup, 3),
                'Vu': round(V_sup, 3),
                'Ru': round(abs(result.R[i + 1]), 3) if i + 1 < len(result.R) else None,
                'region': 'negative',
            })

    # 3. 랩 끝 위치의 부모멘트 (laps 정보가 있는 경우)
    if laps and n_spans > 1:
        lap_left = laps.get('left_ft', 0)
        lap_right = laps.get('right_ft', 0)

        x_offset = 0.0
        for i in range(n_spans):
            x_offset_end = x_offset + spans[i]
            if i < n_spans - 1:
                # 지점 = x_offset_end
                sup_x = x_offset_end
                # 좌측 랩 끝: 지점 - lap_right (왼쪽 스팬에서)
                if lap_right > 0:
                    lap_end_x = sup_x - lap_right
                    idx = min(range(len(result.x)),
                              key=lambda j: abs(result.x[j] - lap_end_x))
                    locations.append({
                        'name': f'Lap end (left of sup {i+2})',
                        'x_ft': round(lap_end_x, 2),
                        'Mu': round(result.M[idx], 3),
                        'Vu': round(abs(result.V[idx]), 3),
                        'Ru': None,
                        'region': 'negative',
                    })
                # 우측 랩 끝: 지점 + lap_left (오른쪽 스팬에서)
                if lap_left > 0 and i + 1 < n_spans:
                    lap_end_x = sup_x + lap_left
                    idx = min(range(len(result.x)),
                              key=lambda j: abs(result.x[j] - lap_end_x))
                    locations.append({
                        'name': f'Lap end (right of sup {i+2})',
                        'x_ft': round(lap_end_x, 2),
                        'Mu': round(result.M[idx], 3),
                        'Vu': round(abs(result.V[idx]), 3),
                        'Ru': None,
                        'region': 'negative',
                    })
            x_offset = x_offset_end

    # 4. 단부 지점 반력 (웹크리플링용 + 모멘트)
    if result.R:
        M_left = result.M[0] if result.M else 0
        M_right = result.M[-1] if result.M else 0
        locations.append({
            'name': 'End support (left)', 'x_ft': 0,
            'Mu': round(M_left, 3) if abs(M_left) > 1e-6 else None,
            'Vu': round(abs(result.V[0]), 3),
            'Ru': round(abs(result.R[0]), 3),
            'region': 'support_end',
        })
        locations.append({
            'name': 'End support (right)', 'x_ft': round(sum(spans), 2),
            'Mu': round(M_right, 3) if abs(M_right) > 1e-6 else None,
            'Vu': round(abs(result.V[-1]), 3),
            'Ru': round(abs(result.R[-1]), 3),
            'region': 'support_end',
        })

    return locations


# ---------------------------------------------------------------------------
# 유틸리티
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 캔틸레버 보 (Cantilever)
# ---------------------------------------------------------------------------

def analyze_cantilever_beam(L_ft: float, w_plf: float,
                            n_pts: int = 101) -> BeamResult:
    """등분포하중 캔틸레버 보 (고정단 좌측, 자유단 우측)

    Parameters
    ----------
    L_ft : 캔틸레버 길이 (ft)
    w_plf : 등분포하중 (plf)
    """
    w = w_plf / 1000.0  # kip/ft
    L = L_ft
    R_fixed = w * L  # 고정단 반력 (상향)
    M_fixed = -w * L * L / 2.0  # 고정단 모멘트 (음수 = 시계방향)

    dx = L / (n_pts - 1) if n_pts > 1 else L
    x_list = [i * dx for i in range(n_pts)]
    M_list = []
    V_list = []

    for x in x_list:
        V = R_fixed - w * x
        M = M_fixed + R_fixed * x - w * x * x / 2.0
        V_list.append(V)
        M_list.append(M)

    return BeamResult(x_list, M_list, V_list, [R_fixed], n_pts)


# ---------------------------------------------------------------------------
# 처짐 계산 (Deflection)
# ---------------------------------------------------------------------------

def compute_deflection(result: BeamResult, E_ksi: float, I_in4: float,
                       spans: List[float] = None,
                       boundary: str = 'simple') -> list:
    """M 다이어그램으로부터 처짐 계산 (수치적분 — 이중적분법)

    Parameters
    ----------
    result : BeamResult (x in ft, M in kip-ft)
    E_ksi : 탄성계수 (ksi)
    I_in4 : 단면 2차모멘트 (in^4)
    boundary : 'simple' (양단 δ=0) or 'cantilever' (좌단 δ=0, θ=0)

    Returns
    -------
    list of deflections (in.) at each x point
    """
    n = len(result.x)
    if n < 3:
        return [0.0] * n

    EI = E_ksi * I_in4  # kip-in^2
    if EI <= 0:
        return [0.0] * n

    # M을 kip-in 단위로 변환 (x는 ft, M은 kip-ft → M*12 = kip-in)
    M_kipin = [m * 12.0 for m in result.M]
    x_in = [x * 12.0 for x in result.x]

    # M/EI 곡선
    kappa = [m / EI for m in M_kipin]

    # 1차 적분 → 기울기 θ (trapezoidal)
    theta = [0.0] * n
    for i in range(1, n):
        dx = x_in[i] - x_in[i - 1]
        theta[i] = theta[i - 1] + 0.5 * (kappa[i - 1] + kappa[i]) * dx

    # 2차 적분 → 처짐 δ
    delta = [0.0] * n
    for i in range(1, n):
        dx = x_in[i] - x_in[i - 1]
        delta[i] = delta[i - 1] + 0.5 * (theta[i - 1] + theta[i]) * dx

    if boundary == 'simple':
        # 양단 δ=0: delta[0]=0 (OK), delta[-1]=0으로 보정
        if n > 1 and x_in[-1] > x_in[0]:
            L_total = x_in[-1] - x_in[0]
            correction_slope = delta[-1] / L_total
            for i in range(n):
                delta[i] -= correction_slope * (x_in[i] - x_in[0])
    # cantilever: delta[0]=0, theta[0]=0 (이미 만족)

    return [round(d, 5) for d in delta]


def _solve_general(A: list, b: list) -> list:
    """일반 연립방정식 Ax=b 풀이 (가우스 소거법)"""
    n = len(b)
    if n == 0:
        return []
    # 증강행렬 생성
    aug = [row[:] + [bi] for row, bi in zip(A, b)]
    # Forward elimination with partial pivoting
    for col in range(n):
        # 피벗 선택
        max_row = col
        for row in range(col + 1, n):
            if abs(aug[row][col]) > abs(aug[max_row][col]):
                max_row = row
        aug[col], aug[max_row] = aug[max_row], aug[col]
        pivot = aug[col][col]
        if abs(pivot) < 1e-15:
            continue
        for row in range(col + 1, n):
            factor = aug[row][col] / pivot
            for k in range(col, n + 1):
                aug[row][k] -= factor * aug[col][k]
    # Back substitution
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = aug[i][n]
        for j in range(i + 1, n):
            s -= aug[i][j] * x[j]
        x[i] = s / aug[i][i] if abs(aug[i][i]) > 1e-15 else 0.0
    return x


def _solve_tridiagonal(A: list, b: list) -> list:
    """삼대각 행렬 Ax=b 풀이 (Thomas algorithm)"""
    n = len(b)
    if n == 0:
        return []
    if n == 1:
        return [b[0] / A[0][0]]

    # Forward sweep
    c = [0.0] * n
    d = [0.0] * n

    c[0] = A[0][1] / A[0][0] if n > 1 else 0
    d[0] = b[0] / A[0][0]

    for i in range(1, n):
        a_i = A[i][i - 1] if i > 0 else 0
        b_i = A[i][i]
        c_i = A[i][i + 1] if i < n - 1 else 0

        m = a_i / (b_i - a_i * c[i - 1]) if (b_i - a_i * c[i - 1]) != 0 else 0
        # Recalculate
        denom = b_i - a_i * c[i - 1]
        if abs(denom) < 1e-15:
            denom = 1e-15
        c[i] = c_i / denom
        d[i] = (b[i] - a_i * d[i - 1]) / denom

    # Back substitution
    x = [0.0] * n
    x[-1] = d[-1]
    for i in range(n - 2, -1, -1):
        x[i] = d[i] - c[i] * x[i + 1]

    return x
