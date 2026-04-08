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

    # 자유단(N) 캔틸레버 특수 처리: 1스팬 고정-자유 → 전용 함수
    if n_spans == 1 and sup[0] == 'F' and sup[1] == 'N':
        return analyze_cantilever_beam(spans[0], w_plf_list[0], n_pts_per_span)
    if n_spans == 1 and sup[0] == 'N' and sup[1] == 'F':
        # 역방향 캔틸레버: 좌측 자유, 우측 고정 → 좌표 반전
        res = analyze_cantilever_beam(spans[0], w_plf_list[0], n_pts_per_span)
        L = spans[0]
        res.x = [L - x for x in reversed(res.x)]
        res.M = list(reversed(res.M))
        res.V = [-v for v in reversed(res.V)]
        res.R = list(reversed(res.R))
        return res

    # 단순보 특수 처리
    if n_spans == 1 and sup[0] != 'F' and sup[1] != 'F' and sup[0] != 'N' and sup[1] != 'N':
        return analyze_simple_beam(spans[0], w_plf_list[0], n_pts_per_span)

    w_list = [w / 1000.0 for w in w_plf_list]  # kip/ft

    # 비등단면 계수 (Ix_list가 있으면 L/I 비율 사용)
    if Ix_list and len(Ix_list) == n_spans:
        I_ref = Ix_list[0]  # 기준 Ix
        LI_ratio = [spans[i] / Ix_list[i] if Ix_list[i] > 0 else spans[i]
                     for i in range(n_spans)]
        wLI_ratio = [w_list[i] * spans[i] ** 3 / (4.0 * Ix_list[i])
                      if Ix_list[i] > 0 else w_list[i] * spans[i] ** 3 / 4.0
                      for i in range(n_spans)]
    else:
        LI_ratio = list(spans)  # L/I = L (I 소거됨, 등단면)
        wLI_ratio = [w_list[i] * spans[i] ** 3 / 4.0 for i in range(n_spans)]

    # 경계조건 판별
    # F(고정단): M≠0, slope=0, R≠0  →  미지수에 추가
    # P/R(핀/롤러): M=0, R≠0        →  기존 경계
    # N(자유단): M=0, R=0            →  인접 내부지점에 R=0 조건 부여
    left_fixed = (sup[0] == 'F')
    right_fixed = (sup[-1] == 'F')
    left_free = (sup[0] == 'N')
    right_free = (sup[-1] == 'N')

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
    # 3-moment (비등단면): 2*M0*(L1/I1) + M1*(L1/I1) = -w1*L1^3/(4*I1)
    if left_fixed:
        LI1 = LI_ratio[0]
        row = 0
        A[row][idx_of_support[0]] = 2.0 * LI1
        if idx_of_support[1] >= 0:
            A[row][idx_of_support[1]] = LI1
        b_vec[row] = -wLI_ratio[0]

    # 내부 지점 방정식 (3-moment / 자유단 R=0 조건)
    for j in range(1, n_spans):
        row = idx_of_support[j]
        Li = spans[j - 1]
        Li1 = spans[j] if j < n_spans else 0
        wi = w_list[j - 1]
        wi1 = w_list[j] if j < n_spans else 0
        # 비등단면 L/I 비율
        LIi = LI_ratio[j - 1]
        LIi1 = LI_ratio[j] if j < n_spans else 0

        # 좌측 자유단(N): 첫 번째 내부 지점에 R[0]=0 조건 적용
        if left_free and j == 1:
            A[row][row] = 1.0
            b_vec[row] = -wi * Li ** 2 / 2.0
            continue

        # 우측 자유단(N): 마지막 내부 지점에 R[n]=0 조건 적용
        if right_free and j == n_spans - 1:
            A[row][row] = 1.0
            b_vec[row] = -wi1 * Li1 ** 2 / 2.0
            continue

        # 비등단면 3-moment 방정식:
        # M_{j-1}*(Li/Ii) + 2*M_j*(Li/Ii + Li1/Ii1) + M_{j+1}*(Li1/Ii1)
        #   = -(wi*Li^3/(4*Ii) + wi1*Li1^3/(4*Ii1))
        A[row][row] = 2.0 * (LIi + LIi1)
        if idx_of_support[j - 1] >= 0:
            A[row][idx_of_support[j - 1]] = LIi
        if idx_of_support[j + 1] >= 0:
            A[row][idx_of_support[j + 1]] = LIi1

        b_vec[row] = -(wLI_ratio[j - 1] + (wLI_ratio[j] if j < n_spans else 0))

    # 우측 고정단 방정식: slope=0 at support n_spans
    # 3-moment: M_{n-1}*Ln + 2*Mn*Ln = -wn*Ln^3/4
    if right_fixed:
        LIn = LI_ratio[-1]
        row = idx_of_support[n_spans]
        A[row][row] = 2.0 * LIn
        if idx_of_support[n_spans - 1] >= 0:
            A[row][idx_of_support[n_spans - 1]] = LIn
        b_vec[row] = -wLI_ratio[-1]

    # 연립방정식 풀기
    M_solution = _solve_general(A, b_vec)

    # M_sup 배열 복원
    M_sup = [0.0] * (n_spans + 1)
    for j in range(n_spans + 1):
        if idx_of_support[j] >= 0:
            M_sup[j] = M_solution[idx_of_support[j]]

    # 반력 (자유단은 R=0)
    reactions = []
    for j in range(n_spans + 1):
        R_j = 0.0
        if sup[j] == 'N':
            R_j = 0.0  # 자유단: 반력 없음
        elif j == 0:
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
    I_in4 : 단면 2차모멘트 (in^4) — 단일값 또는 비등단면 시 None
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


def compute_deflection_variable_I(
    result: BeamResult, E_ksi: float, I_base_in4: float,
    spans: List[float],
    supports: List[str],
    laps_per_support: list = None,
    I_lap_ratio: float = 2.0,
) -> list:
    """비등단면(랩 구간 Ix 증가)을 고려한 처짐 계산

    연속보의 각 지점 경계조건(P/R/F/N)에 따른 적분 경계를 적용하고,
    랩 구간에서는 Ix를 증가시켜 강성 변화를 반영한다.

    Parameters
    ----------
    result : BeamResult (x in ft, M in kip-ft)
    E_ksi : 탄성계수 (ksi)
    I_base_in4 : 기본 단면2차모멘트 (in^4)
    spans : 각 스팬 길이 (ft) 리스트
    supports : 지점 조건 리스트 ['P','P',...] — P/R/F/N
    laps_per_support : 지점별 랩 정보 [{'left_ft':..,'right_ft':..}, ...]
    I_lap_ratio : 랩 구간 Ix 배율 (기본 2.0 — 2겹 단면)

    Returns
    -------
    list of deflections (in.) at each x point
    """
    n = len(result.x)
    if n < 3 or E_ksi <= 0 or I_base_in4 <= 0:
        return [0.0] * n

    E = E_ksi
    x_in = [x * 12.0 for x in result.x]
    M_kipin = [m * 12.0 for m in result.M]
    total_L_ft = sum(spans)

    # --- 지점 x좌표 (ft → in) ---
    sup_x_in = [0.0]
    for s in spans:
        sup_x_in.append(sup_x_in[-1] + s * 12.0)
    n_sup = len(sup_x_in)

    # --- 각 x점의 Ix 결정 (랩 구간이면 I_base × ratio) ---
    I_at_x = [I_base_in4] * n
    if laps_per_support:
        for si in range(min(n_sup, len(laps_per_support))):
            lap = laps_per_support[si]
            if not lap:
                continue
            lL = (lap.get('left_ft') or lap.get('left') or 0) * 12.0
            lR = (lap.get('right_ft') or lap.get('right') or 0) * 12.0
            if lL <= 0 and lR <= 0:
                continue
            sx = sup_x_in[si]
            x_start = sx - lL
            x_end = sx + lR
            for i in range(n):
                if x_start <= x_in[i] <= x_end:
                    I_at_x[i] = I_base_in4 * I_lap_ratio

    # --- M/EI 곡선 (비등단면) ---
    kappa = [M_kipin[i] / (E * I_at_x[i]) for i in range(n)]

    # --- 지점 조건 판별 ---
    sup = [s[0].upper() if s else 'P' for s in supports]

    left_type = sup[0] if sup else 'P'
    right_type = sup[-1] if sup else 'P'

    # --- 캔틸레버 특수 처리 ---
    if left_type == 'F' and right_type == 'N':
        # 좌측 고정, 우측 자유: θ[0]=0, δ[0]=0 — 좌측부터 적분
        theta = [0.0] * n
        delta = [0.0] * n
        for i in range(1, n):
            dx = x_in[i] - x_in[i - 1]
            theta[i] = theta[i - 1] + 0.5 * (kappa[i - 1] + kappa[i]) * dx
        for i in range(1, n):
            dx = x_in[i] - x_in[i - 1]
            delta[i] = delta[i - 1] + 0.5 * (theta[i - 1] + theta[i]) * dx
        return [round(d, 5) for d in delta]

    if left_type == 'N' and right_type == 'F':
        # 좌측 자유, 우측 고정: θ[-1]=0, δ[-1]=0 — 우측부터 역적분
        theta = [0.0] * n
        delta = [0.0] * n
        for i in range(n - 2, -1, -1):
            dx = x_in[i + 1] - x_in[i]
            theta[i] = theta[i + 1] - 0.5 * (kappa[i] + kappa[i + 1]) * dx
        for i in range(n - 2, -1, -1):
            dx = x_in[i + 1] - x_in[i]
            delta[i] = delta[i + 1] - 0.5 * (theta[i] + theta[i + 1]) * dx
        return [round(d, 5) for d in delta]

    # --- 연속보/단순보: Beam FE 직접 강성법 ---
    # 등단면/비등단면 모두 일관된 방법으로 처짐 계산
    # 하중 → 모멘트 → 처짐을 한 번에 계산하여 EI 변화를 정확히 반영
    import numpy as _np

    # 지점 인덱스 찾기 (δ=0 조건)
    sup_indices = []
    for si, sx in enumerate(sup_x_in):
        if si < len(sup) and sup[si] != 'N':
            best_i = min(range(n), key=lambda idx: abs(x_in[idx] - sx))
            sup_indices.append(best_i)

    if len(sup_indices) < 2:
        return [0.0] * n

    # 등분포하중 복원: 반력 합 또는 V 다이어그램에서 추정
    total_L_in = x_in[-1] - x_in[0]
    total_R = sum(abs(r) for r in result.R) if result.R else 0
    if total_R > 1e-10 and total_L_in > 0:
        w_klin = total_R / total_L_in  # kip/in
    elif len(result.V) >= 2 and total_L_in > 0:
        # V 다이어그램 최대/최소 차이에서 하중 추정
        V_kipin = [v * 1.0 for v in result.V]  # kips (already)
        w_klin = (max(V_kipin) - min(V_kipin)) / total_L_in
    else:
        w_klin = 0.0

    # Beam FE: 각 절점 2 DOF (δ, θ), 총 2n DOF
    ndof = 2 * n
    K_global = _np.zeros((ndof, ndof))
    F_global = _np.zeros(ndof)

    for i in range(n - 1):
        Le = x_in[i + 1] - x_in[i]
        if Le < 1e-10:
            continue
        EI_e = E * (I_at_x[i] + I_at_x[i + 1]) / 2.0

        # Euler-Bernoulli 보 요소 강성행렬 (4×4)
        c = EI_e / Le ** 3
        ke = c * _np.array([
            [12,    6*Le,   -12,    6*Le],
            [6*Le,  4*Le**2, -6*Le, 2*Le**2],
            [-12,  -6*Le,    12,   -6*Le],
            [6*Le,  2*Le**2, -6*Le, 4*Le**2],
        ])

        # 등분포하중 등가절점하중
        fe = w_klin * Le / 2.0 * _np.array([1.0, Le/6.0, 1.0, -Le/6.0])

        # 조립
        dofs = [2*i, 2*i+1, 2*(i+1), 2*(i+1)+1]
        for a in range(4):
            F_global[dofs[a]] += fe[a]
            for b in range(4):
                K_global[dofs[a], dofs[b]] += ke[a, b]

    # 경계조건: 지점에서 δ=0, 고정단에서 θ=0
    bc_dofs = set()
    for si_idx, si in enumerate(sup_indices):
        bc_dofs.add(2 * si)  # δ = 0
    # 고정단 처리
    for si, sx in enumerate(sup_x_in):
        if si < len(sup) and sup[si] == 'F':
            best_i = min(range(n), key=lambda idx: abs(x_in[idx] - sx))
            bc_dofs.add(2 * best_i + 1)  # θ = 0

    free_dofs = sorted(i for i in range(ndof) if i not in bc_dofs)
    Kff = K_global[_np.ix_(free_dofs, free_dofs)]
    Ff = F_global[free_dofs]

    try:
        d_free = _np.linalg.solve(Kff, Ff)
        d_full = _np.zeros(ndof)
        for i, fi in enumerate(free_dofs):
            d_full[fi] = d_free[i]
        delta = [d_full[2 * i] for i in range(n)]
    except Exception:
        delta = [0.0] * n

    return [round(d, 5) for d in delta]


def analyze_beam_fe(
    spans: List[float],
    w_plf_list: List[float],
    supports: List[str] = None,
    laps_per_support: list = None,
    I_base_in4: float = 1.0,
    I_lap_ratio: float = 2.0,
    E_ksi: float = 29500.0,
    n_pts_per_span: int = 51,
) -> BeamResult:
    """직접 강성법(FE)으로 연속보의 M, V, R, δ를 동시 계산

    비등단면(Lap 구간 EI 증가)을 정확히 반영하여
    모멘트 재분배와 처짐을 일관되게 산출한다.

    Parameters
    ----------
    spans : 각 스팬 길이 (ft)
    w_plf_list : 각 스팬의 등분포하중 (plf)
    supports : 지점 조건 ['P','P',...] — P/R/F/N
    laps_per_support : 지점별 랩 [{left_ft:, right_ft:}, ...]
    I_base_in4 : 기본 단면2차모멘트 (in^4)
    I_lap_ratio : 랩 구간 Ix 배율 (기본 2.0)
    E_ksi : 탄성계수 (ksi)
    n_pts_per_span : 스팬당 절점 수

    Returns
    -------
    BeamResult with M (kip-ft), V (kips), R (kips), D (in.)
    """
    import numpy as _np

    n_spans = len(spans)
    if not supports:
        supports = ['P'] * (n_spans + 1)
    sup = [s[0].upper() if s else 'P' for s in supports]

    # 전체 절점 생성 (ft 단위)
    x_ft = []
    for si in range(n_spans):
        n_seg = n_pts_per_span if si < n_spans - 1 else n_pts_per_span
        x_start = sum(spans[:si])
        for j in range(n_seg):
            x_ft.append(x_start + spans[si] * j / (n_seg - 1))

    # Lap 경계에 추가 절점 삽입 (정확한 I 계단 변화 포착)
    if laps_per_support:
        sup_x_ft = [0.0]
        for s in spans:
            sup_x_ft.append(sup_x_ft[-1] + s)
        for si in range(min(len(sup_x_ft), len(laps_per_support))):
            lap = laps_per_support[si]
            if not lap:
                continue
            lL = lap.get('left_ft') or lap.get('left') or 0
            lR = lap.get('right_ft') or lap.get('right') or 0
            sx = sup_x_ft[si]
            if lL > 0:
                x_ft.append(sx - lL)       # Lap 왼쪽 경계
                x_ft.append(sx - lL + 0.01) # 경계 바로 안쪽
            if lR > 0:
                x_ft.append(sx + lR)       # Lap 오른쪽 경계
                x_ft.append(sx + lR - 0.01) # 경계 바로 안쪽

    # 마지막 점 중복 제거 + 정렬
    x_ft = sorted(set(x_ft))
    x_ft_clean = [x_ft[0]]
    for i in range(1, len(x_ft)):
        if x_ft[i] > x_ft_clean[-1] + 1e-8:
            x_ft_clean.append(x_ft[i])
    x_ft = x_ft_clean
    n = len(x_ft)
    x_in = [x * 12.0 for x in x_ft]  # ft → in

    # 지점 x좌표 (in)
    sup_x_in = [0.0]
    for s in spans:
        sup_x_in.append(sup_x_in[-1] + s * 12.0)

    # 각 절점의 I 결정 (Lap 구간이면 I × ratio)
    I_at_x = [I_base_in4] * n
    if laps_per_support:
        for si in range(min(len(sup_x_in), len(laps_per_support))):
            lap = laps_per_support[si]
            if not lap:
                continue
            lL = (lap.get('left_ft') or lap.get('left') or 0) * 12.0
            lR = (lap.get('right_ft') or lap.get('right') or 0) * 12.0
            if lL <= 0 and lR <= 0:
                continue
            sx = sup_x_in[si]
            for i in range(n):
                if (sx - lL) <= x_in[i] <= (sx + lR):
                    I_at_x[i] = I_base_in4 * I_lap_ratio

    # 각 절점의 등분포하중 (kip/in)
    w_at_x = [0.0] * n
    for si in range(n_spans):
        w_kip_in = w_plf_list[si] / 1000.0 / 12.0  # plf → kip/in
        x_start = sum(spans[:si]) * 12.0
        x_end = x_start + spans[si] * 12.0
        for i in range(n):
            if x_start - 1e-6 <= x_in[i] <= x_end + 1e-6:
                w_at_x[i] = w_kip_in

    # Beam FE 조립: 2 DOF/node (δ, θ)
    ndof = 2 * n
    K = _np.zeros((ndof, ndof))
    F = _np.zeros(ndof)

    for i in range(n - 1):
        Le = x_in[i + 1] - x_in[i]
        if Le < 1e-10:
            continue
        # Lap 구간: I가 step function → max(양 끝 I) 사용
        EI_e = E_ksi * max(I_at_x[i], I_at_x[i + 1])
        w_e = (w_at_x[i] + w_at_x[i + 1]) / 2.0  # 요소 평균 하중

        # Euler-Bernoulli 보 요소 강성행렬
        c = EI_e / Le ** 3
        ke = c * _np.array([
            [12,    6*Le,   -12,    6*Le],
            [6*Le,  4*Le**2, -6*Le, 2*Le**2],
            [-12,  -6*Le,    12,   -6*Le],
            [6*Le,  2*Le**2, -6*Le, 4*Le**2],
        ])

        # 등분포하중 등가절점하중
        fe = w_e * Le / 2.0 * _np.array([1.0, Le/6.0, 1.0, -Le/6.0])

        dofs = [2*i, 2*i+1, 2*(i+1), 2*(i+1)+1]
        for a in range(4):
            F[dofs[a]] += fe[a]
            for b in range(4):
                K[dofs[a], dofs[b]] += ke[a, b]

    # 경계조건
    bc_dofs = set()
    sup_node_indices = []
    for si, sx in enumerate(sup_x_in):
        if si < len(sup) and sup[si] != 'N':
            best_i = min(range(n), key=lambda idx: abs(x_in[idx] - sx))
            bc_dofs.add(2 * best_i)  # δ = 0
            sup_node_indices.append(best_i)
            if sup[si] == 'F':
                bc_dofs.add(2 * best_i + 1)  # θ = 0

    free_dofs = sorted(i for i in range(ndof) if i not in bc_dofs)

    try:
        Kff = K[_np.ix_(free_dofs, free_dofs)]
        Ff = F[free_dofs]
        d_free = _np.linalg.solve(Kff, Ff)
        d_full = _np.zeros(ndof)
        for i, fi in enumerate(free_dofs):
            d_full[fi] = d_free[i]
    except Exception:
        d_full = _np.zeros(ndof)

    # 처짐 추출
    delta = [d_full[2 * i] for i in range(n)]

    # 요소 내력 추출 (M, V)
    M_kipin = [0.0] * n
    V_kips = [0.0] * n

    for i in range(n - 1):
        Le = x_in[i + 1] - x_in[i]
        if Le < 1e-10:
            continue
        # Lap 구간: I가 step function → max(양 끝 I) 사용
        EI_e = E_ksi * max(I_at_x[i], I_at_x[i + 1])
        w_e = (w_at_x[i] + w_at_x[i + 1]) / 2.0

        # 요소 절점 변위
        de = _np.array([d_full[2*i], d_full[2*i+1], d_full[2*(i+1)], d_full[2*(i+1)+1]])

        # 요소 강성행렬 × 절점변위 = 절점력
        c = EI_e / Le ** 3
        ke = c * _np.array([
            [12,    6*Le,   -12,    6*Le],
            [6*Le,  4*Le**2, -6*Le, 2*Le**2],
            [-12,  -6*Le,    12,   -6*Le],
            [6*Le,  2*Le**2, -6*Le, 4*Le**2],
        ])
        fe_fixed = w_e * Le / 2.0 * _np.array([1.0, Le/6.0, 1.0, -Le/6.0])
        f_elem = ke @ de - fe_fixed  # 요소 절점력 (고정단 하중 제거)

        # V = -f_elem[0] (좌측 전단력), M = f_elem[1] (좌측 모멘트)
        V_kips[i] = -f_elem[0]     # 좌측 전단
        M_kipin[i] = f_elem[1]     # 좌측 모멘트
        # 우측 값 (마지막 요소에서 n-1 절점)
        if i == n - 2:
            V_kips[i + 1] = f_elem[2]
            M_kipin[i + 1] = -f_elem[3]

    # 단위 변환: M kip-in → kip-ft, V는 그대로 kips
    M_kipft = [m / 12.0 for m in M_kipin]

    # 지점 반력 추출: R = F_internal - F_applied (구속 DOF)
    F_internal = K @ d_full
    reactions = []
    for si_node in sup_node_indices:
        R_i = F_internal[2 * si_node] - F[2 * si_node]
        reactions.append(round(abs(R_i), 4))

    result = BeamResult(x_ft, M_kipft, V_kips, reactions, n)
    result.D = [round(d, 5) for d in delta]
    return result


def extract_max_deflection_per_span(
    x_ft: list, defl_in: list, spans: List[float],
) -> list:
    """각 스팬별 최대 처짐 위치와 값 추출

    Returns
    -------
    list of dicts: [{'span': 1, 'x_ft': ..., 'delta_in': ..., 'L_ft': ...}, ...]
    """
    results = []
    x_offset = 0.0
    for si, L in enumerate(spans):
        span_start = x_offset
        span_end = x_offset + L
        max_abs = 0.0
        max_x = span_start
        max_d = 0.0
        for i, x in enumerate(x_ft):
            if span_start <= x <= span_end and i < len(defl_in):
                if abs(defl_in[i]) > max_abs:
                    max_abs = abs(defl_in[i])
                    max_x = x
                    max_d = defl_in[i]
        results.append({
            'span': si + 1,
            'x_ft': round(max_x, 2),
            'delta_in': round(max_d, 5),
            'abs_delta_in': round(max_abs, 5),
            'L_ft': L,
            'L_over_delta': round(L * 12.0 / max_abs, 0) if max_abs > 1e-6 else float('inf'),
        })
        x_offset += L
    return results


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
