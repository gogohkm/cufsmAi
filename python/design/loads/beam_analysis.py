"""연속보 구조해석 — 3-모멘트법 및 직접 강성법

등분포하중을 받는 단순보~N경간 연속보의 M, V, R 다이어그램을 계산한다.
랩 구간 Ix 증가(비등단면)는 직접 강성법(`analyze_beam_fe`)으로 다룬다.

부호 규약 (모든 해석 경로 공통):
  x 는 ft, M 은 kip-ft (새깅 +), V = dM/dx (kips), 처짐 D 는 in. (하중 방향, 하향 +),
  반력 R 은 지점마다 하나(자유단 N 은 0.0), 상향 + (양력이면 음수).
  w 는 plf, 하향(중력) + .
"""

from typing import List, Tuple, Optional

# ---------------------------------------------------------------------------
# 해석 결과 클래스
# ---------------------------------------------------------------------------

class BeamResult:
    """단일 하중 케이스의 구조해석 결과"""

    def __init__(self, x: list, M: list, V: list, R: list, n_pts: int,
                 is_valid: bool = True):
        self.x = x          # 좌표 (ft 단위)
        self.M = M          # 모멘트 (kip-ft)
        self.V = V          # 전단력 (kips)
        self.R = R          # 지점 반력 (kips, 상향 +, 지점마다 하나)
        self.n_pts = n_pts
        self.is_valid = is_valid  # FE 풀이 성공 여부
        # 지점 바로 왼쪽/오른쪽 전단 (kips, V = dM/dx). 경간이 없는 쪽은 0.0.
        self.V_sup_left = None
        self.V_sup_right = None

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
            'is_valid': self.is_valid,
            'V_sup_left': self.V_sup_left,
            'V_sup_right': self.V_sup_right,
        }


def support_statics(x: list, M: list, spans: List[float],
                    w_plf_list: List[float], supports: List[str] = None) -> dict:
    """지점 모멘트와 경간 하중으로 지점 양쪽 전단과 반력을 정역학으로 구한다.

    경간 k 의 자유물체: V⁺(k) = w L/2 + (M_{k+1} − M_k)/L, V⁻(k+1) = V⁺(k) − w L.
    강성(EI) 분포와 무관하므로 비등단면(랩)에서도 그대로 맞다. R_j = V⁺_j − V⁻_j
    (상향 +). 자유단(N)은 0.0 으로 둔다.
    """
    n = len(spans)
    sup = _norm_supports(supports, n)
    xs = [0.0]
    for s in spans:
        xs.append(xs[-1] + s)
    M_sup = []
    for xj in xs:
        i = min(range(len(x)), key=lambda k: abs(x[k] - xj))
        M_sup.append(float(M[i]))
    VR = [0.0] * (n + 1)
    VL = [0.0] * (n + 1)
    for k in range(n):
        w = w_plf_list[k] / 1000.0
        L = spans[k]
        VR[k] = w * L / 2.0 + (M_sup[k + 1] - M_sup[k]) / L
        VL[k + 1] = VR[k] - w * L
    R = [0.0 if sup[j] == 'N' else VR[j] - VL[j] for j in range(n + 1)]
    return {'V_left': VL, 'V_right': VR, 'R': R, 'M_support': M_sup, 'x_support': xs}


def _norm_supports(supports, n_spans: int) -> list:
    if not supports:
        return ['P'] * (n_spans + 1)
    return [s[0].upper() if s else 'P' for s in supports]


def _attach_statics(result: 'BeamResult', spans, w_plf_list, supports) -> 'BeamResult':
    st = support_statics(result.x, result.M, spans, w_plf_list, supports)
    result.V_sup_left = st['V_left']
    result.V_sup_right = st['V_right']
    return result


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

    res = BeamResult(x_list, M_list, V_list, [R_left, R_right], n_pts)
    res.V_sup_left = [0.0, -R_right]
    res.V_sup_right = [R_left, 0.0]
    return res


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

    일반형(analyze_continuous_beam_general)과 같은 해를 쓴다 — 지점 양쪽 전단
    (V_sup_left / V_sup_right)과 지점별 반력도 그쪽 규약 그대로다.
    """
    if n_spans == 1:
        return analyze_simple_beam(L_ft, w_plf, n_pts_per_span)
    return analyze_continuous_beam_general([L_ft] * n_spans, [w_plf] * n_spans,
                                           n_pts_per_span=n_pts_per_span)


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
    # 반력은 지점마다 하나(자유단 0.0)로 돌려준다.
    if n_spans == 1 and sup[0] == 'F' and sup[1] == 'N':
        res = analyze_cantilever_beam(spans[0], w_plf_list[0], n_pts_per_span)
        res.R = [res.R[0], 0.0]
        return _attach_statics(res, spans, w_plf_list, sup)
    if n_spans == 1 and sup[0] == 'N' and sup[1] == 'F':
        # 역방향 캔틸레버: 좌측 자유, 우측 고정 → 좌표 반전
        res = analyze_cantilever_beam(spans[0], w_plf_list[0], n_pts_per_span)
        L = spans[0]
        res.x = [L - x for x in reversed(res.x)]
        res.M = list(reversed(res.M))
        res.V = [-v for v in reversed(res.V)]
        res.R = [0.0, res.R[0]]
        return _attach_statics(res, spans, w_plf_list, sup)
    if n_spans == 1 and 'N' in sup:
        raise ValueError(f'Unstable single span with supports {sup}: a free end (N) needs a fixed (F) other end.')

    # 단순보 특수 처리
    if n_spans == 1 and sup[0] != 'F' and sup[1] != 'F' and sup[0] != 'N' and sup[1] != 'N':
        return analyze_simple_beam(spans[0], w_plf_list[0], n_pts_per_span)

    check_support_stability(sup)
    # 3-모멘트 식은 내부 지점을 핀(M 연속, 처짐 0)으로만 다룬다.
    if any(s in ('F', 'N') for s in sup[1:-1]):
        raise ValueError('Interior fixed/free supports are not handled by the three-moment '
                         'solver; use analyze_beam_fe.')

    w_list = [w / 1000.0 for w in w_plf_list]  # kip/ft

    # 비등단면 계수 (Ix_list가 있으면 L/I 비율 사용)
    if Ix_list and len(Ix_list) == n_spans:
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
    res = BeamResult(x_all, M_all, V_all, reactions, total_pts)
    return _attach_statics(res, spans, w_plf_list, sup)


def check_support_stability(supports: list) -> None:
    """지점 조합이 보를 안정하게 지지하는지 확인 (아니면 ValueError).

    연직 구속 지점(N 이 아닌 것)이 둘 이상이거나 고정단(F)이 하나라도 있어야 한다.
    """
    sup = [s[0].upper() if s else 'P' for s in supports]
    bad = [s for s in sup if s not in ('P', 'R', 'F', 'N')]
    if bad:
        raise ValueError(f'Unknown support type(s) {bad}: use P, R, F or N.')
    n_vert = sum(1 for s in sup if s != 'N')
    if not (n_vert >= 2 or 'F' in sup):
        raise ValueError(f'Unstable support arrangement {sup}: need at least two '
                         'vertical supports (P/R/F) or one fixed end (F).')


# ---------------------------------------------------------------------------
# 임계 위치 추출
# ---------------------------------------------------------------------------

def extract_critical_locations(result: BeamResult, spans: List[float],
                               laps: dict = None, supports: List[str] = None,
                               member_depth_in: float = None) -> list:
    """해석 결과에서 설계에 필요한 임계 위치를 자동 추출

    laps : {'left_ft', 'right_ft'} (모든 내부 지점에 같은 값) 또는
           '_per_support' 키에 지점별 목록. 지점별 목록의 None 은 "랩 없음".
    supports : 지점 조건 (자유단 N 은 반력 위치에서 빠진다).

    Returns list of dicts:
        [{'name': ..., 'x_ft': ..., 'Mu': ..., 'Vu': ..., 'Ru': ..., 'region': ...}, ...]
    Ru 는 지점 반력의 크기(상향 반력 = 지압), 부호 있는 값은 'R'.
    """
    n_spans = len(spans)
    sup = _norm_supports(supports, n_spans)
    laps_ps = _laps_from_legacy(laps, n_spans, sup)
    M = list(result.M)
    V = list(result.V)
    R = list(result.R) if result.R else [0.0] * (n_spans + 1)
    if len(R) != n_spans + 1:
        raise ValueError(f'Reaction list has {len(R)} entries for {n_spans + 1} supports.')
    VL = result.V_sup_left
    VR = result.V_sup_right
    if VL is None or VR is None:
        VL, VR = _support_shears_from_diagram(result.x, V, spans)
    return extract_critical_locations_envelope(
        result.x, M, M, V, V, spans, supports=sup, laps_per_support=laps_ps,
        R_max=R, R_min=R, VL_max=VL, VL_min=VL, VR_max=VR, VR_min=VR,
        direction='single', member_depth_in=member_depth_in)


def _laps_from_legacy(laps, n_spans: int, sup: list) -> list:
    """legacy laps 인자 → 지점별 목록 (None = 랩 없음)."""
    if not laps:
        return [None] * (n_spans + 1)
    per = laps.get('_per_support') if isinstance(laps, dict) else None
    if per:
        return [per[j] if j < len(per) else None for j in range(n_spans + 1)]
    lL = laps.get('left_ft', 0) or 0
    lR = laps.get('right_ft', 0) or 0
    out = [None] * (n_spans + 1)
    for j in range(1, n_spans):
        if sup[j] != 'N' and (lL > 0 or lR > 0):
            out[j] = {'left_ft': lL, 'right_ft': lR}
    return out


def _support_shears_from_diagram(x, V, spans):
    """V_sup 속성이 없는 결과용: 지점 절점 양옆 값으로 근사."""
    xs = [0.0]
    for s in spans:
        xs.append(xs[-1] + s)
    VL, VR = [], []
    for j, xj in enumerate(xs):
        i = min(range(len(x)), key=lambda k: abs(x[k] - xj))
        VL.append(float(V[i]) if j > 0 else 0.0)
        VR.append(float(V[min(i + 1, len(V) - 1)]) if j < len(spans) else 0.0)
    return VL, VR


def _solve_banded_spd(A, b):
    """보 유한요소 강성(대칭 · 양정치 · 띠)의 풀이 — 띠 Cholesky(LAPACK dpbsv).

    np.linalg.solve(dgesv)는 OpenBLAS 의 스레드 수에 따라 끝자리(상대 1e-11)가 바뀌어, 같은 입력에서 실행마다 다른
    답(같은 값 두 측점 가운데 어느 쪽이 최대인지, 반올림 경계의 값)이 나왔다(2026-11-24). 띠 폭이 좁은 이 행렬에서
    dpbsv 는 블록 없는 경로라 스레드와 무관하다. 띠 폭은 행렬에서 읽는다.
    """
    import numpy as _np
    from scipy.linalg import solveh_banded
    n = A.shape[0]
    nz = _np.nonzero(A)
    u = int(max(abs(nz[1] - nz[0]))) if len(nz[0]) else 0
    ab = _np.zeros((u + 1, n))
    for k in range(u + 1):
        ab[u - k, k:] = _np.diagonal(A, offset=k)
    return solveh_banded(ab, b, lower=False, check_finite=True)


def _interp(x, y, xq):
    for j in range(len(x) - 1):
        if x[j] <= xq <= x[j + 1]:
            dx = x[j + 1] - x[j]
            r = (xq - x[j]) / dx if dx > 1e-12 else 0.0
            return y[j] + r * (y[j + 1] - y[j])
    return y[0] if xq < x[0] else y[-1]


def _gov_signed(a_max, a_min):
    """정·부 포락값 중 크기가 큰 쪽 (부호 유지)."""
    return a_min if abs(a_min) >= abs(a_max) else a_max


def extract_critical_locations_envelope(
    x, M_max, M_min, V_max, V_min, spans, supports=None, laps_per_support=None,
    R_max=None, R_min=None, VL_max=None, VL_min=None, VR_max=None, VR_min=None,
    direction: str = 'gravity', member_depth_in: float = None,
) -> list:
    """포락선(위치별 최대·최소)에서 임계 위치를 뽑는다. 단일 다이어그램은 max = min.

    - 경간별 최대 정모멘트(M_max)와 최소 부모멘트(M_min)
    - 지점: 자유단(N)은 건너뛴다. 실제 양 끝 지점(첫/마지막 비-N 지점)은
      'End support (left/right)', region 'support_end'. 그 사이는 내부 지점.
      지점 모멘트는 정·부 포락 중 큰 쪽, 전단은 지점 양쪽(Vu_left, Vu_right)의 큰 값.
    - 랩 끝: 지점 x − left_ft, x + right_ft.
    direction : 'gravity' → Ru = 지압(상향 반력) 크기, 'uplift' → Ru = 인발(하향 반력) 크기,
                그 밖 → 큰 쪽 크기.
    """
    n_spans = len(spans)
    sup = _norm_supports(supports, n_spans)
    xs = [0.0]
    for s in spans:
        xs.append(xs[-1] + s)
    tol = 1e-9 * max(1.0, max(abs(v) for v in list(M_max) + list(M_min)) if len(M_max) else 1.0)
    real = [j for j in range(n_spans + 1) if sup[j] != 'N']
    first_real, last_real = real[0], real[-1]
    if R_max is None:
        R_max = [0.0] * (n_spans + 1)
    if R_min is None:
        R_min = R_max
    zeros = [0.0] * (n_spans + 1)
    VL_max = VL_max if VL_max is not None else zeros
    VL_min = VL_min if VL_min is not None else VL_max
    VR_max = VR_max if VR_max is not None else zeros
    VR_min = VR_min if VR_min is not None else VR_max

    def vabs(i):
        return max(abs(V_max[i]), abs(V_min[i])) if i < len(V_max) else None

    def node_of(xq):
        return min(range(len(x)), key=lambda k: abs(x[k] - xq))

    locations = []

    # 1. 경간별 최대 정모멘트 / 최소 부모멘트
    for i in range(n_spans):
        a, b = xs[i], xs[i + 1]
        idx = [k for k, xv in enumerate(x) if a - 1e-9 <= xv <= b + 1e-9]
        if not idx:
            continue
        if sup[i] == 'N' or sup[i + 1] == 'N':
            if n_spans == 1:
                base = 'Cantilever'
            else:
                base = 'Overhang (left)' if sup[i] == 'N' else 'Overhang (right)'
        else:
            real_spans = [k for k in range(n_spans) if sup[k] != 'N' and sup[k + 1] != 'N']
            base = 'End span' if (i == real_spans[0] or i == real_spans[-1]) else f'Int span {i + 1}'
        # 같은 값(허용오차 tol 안)이면 앞 측점 — 끝자리 잡음으로 최대 위치를 고르지 않는다(계약 §6.1 동률 규칙)
        top = max(M_max[k] for k in idx)
        bot = min(M_min[k] for k in idx)
        kmax = next(k for k in idx if M_max[k] >= top - tol)
        kmin = next(k for k in idx if M_min[k] <= bot + tol)
        if M_max[kmax] > tol:
            locations.append({
                'name': f'{base} +M', 'x_ft': round(x[kmax], 2),
                'Mu': round(M_max[kmax], 3), 'Vu': round(vabs(kmax), 3),
                'Ru': None, 'region': 'positive', 'span': i + 1, '_idx': kmax, '_q': 'Mmax',
                'unrounded': {'x_ft': float(x[kmax]), 'Mu': float(M_max[kmax]), 'Vu': float(vabs(kmax))},
            })
        if M_min[kmin] < -tol:
            locations.append({
                'name': f'{base} -M', 'x_ft': round(x[kmin], 2),
                'Mu': round(M_min[kmin], 3), 'Vu': round(vabs(kmin), 3),
                'Ru': None, 'region': 'negative', 'span': i + 1, '_idx': kmin, '_q': 'Mmin',
                'unrounded': {'x_ft': float(x[kmin]), 'Mu': float(M_min[kmin]), 'Vu': float(vabs(kmin))},
            })

    # 2. 지점 (자유단 제외)
    x_mid = 0.5 * (xs[first_real] + xs[last_real])
    k_int = 0
    for j in real:
        k = node_of(xs[j])
        m_hi, m_lo = M_max[k], M_min[k]
        mu = _gov_signed(m_hi, m_lo)
        vl = max(abs(VL_max[j]), abs(VL_min[j]))
        vr = max(abs(VR_max[j]), abs(VR_min[j]))
        r_hi, r_lo = float(R_max[j]), float(R_min[j])
        r_bear = max(r_hi, 0.0)
        r_up = min(r_lo, 0.0)
        if direction == 'gravity':
            ru = r_bear
        elif direction == 'uplift':
            ru = -r_up
        else:
            ru = max(abs(r_hi), abs(r_lo))
        is_end = (j == first_real or j == last_real)
        if is_end:
            name = 'End support (left)' if j == first_real else 'End support (right)'
            if first_real == last_real:
                name = 'End support (left)' if j == 0 else 'End support (right)'
            overhang = (xs[j] - xs[0]) if j == first_real else (xs[-1] - xs[j])
            if overhang > 1e-9 and member_depth_in and overhang * 12.0 > 1.5 * member_depth_in:
                wc_case = 'IOF'
            else:
                wc_case = 'EOF'
            region = 'support_end'
        else:
            k_int += 1
            if k_int == 1:
                name = '1st interior'
            elif abs(xs[j] - x_mid) < 1e-6:
                name = 'Center'
            else:
                name = f'Support {j + 1}'
            overhang = 0.0
            wc_case = 'IOF'
            region = 'negative'
        loc = {
            'name': name, 'x_ft': round(xs[j], 2),
            'Mu': (round(mu, 3) if abs(mu) > 1e-6 else None) if is_end else round(mu, 3),
            'Vu': round(max(vl, vr), 3),
            'Ru': round(ru, 3),
            'region': region,
            'support': j + 1, 'support_type': sup[j],
            'Mu_max': round(m_hi, 3), 'Mu_min': round(m_lo, 3),
            'Vu_left': round(vl, 3), 'Vu_right': round(vr, 3),
            'R_max': round(r_hi, 4), 'R_min': round(r_lo, 4),
            'R_bearing': round(r_bear, 4), 'R_uplift': round(r_up, 4),
            'wc_case': wc_case,
            '_idx': k, '_q': 'support', '_sup': j,
            'unrounded': {'x_ft': float(xs[j]), 'Mu': (float(mu) if (abs(mu) > 1e-6 or not is_end) else None),
                          'Vu': float(max(vl, vr)), 'Ru': float(ru), 'Mu_max': float(m_hi), 'Mu_min': float(m_lo),
                          'Vu_left': float(vl), 'Vu_right': float(vr), 'R_max': r_hi, 'R_min': r_lo,
                          'R_bearing': float(r_bear), 'R_uplift': float(r_up)},
        }
        if overhang > 1e-9:
            loc['overhang_ft'] = round(overhang, 3)
            if not member_depth_in:
                loc['wc_case_note'] = ('Member depth unknown: support with overhang taken as '
                                       'end (EOF) loading.')
        locations.append(loc)

    # 3. 랩 끝 (지점 중심 - left_ft, + right_ft)
    if laps_per_support:
        for j in range(1, n_spans):
            lap = laps_per_support[j] if j < len(laps_per_support) else None
            if not lap:
                continue
            lL = lap.get('left_ft', 0) or lap.get('left', 0) or 0
            lR = lap.get('right_ft', 0) or lap.get('right', 0) or 0
            for side, xe, ok in (('left', xs[j] - lL, lL > 0), ('right', xs[j] + lR, lR > 0)):
                if not ok:
                    continue
                m_hi = _interp(x, M_max, xe)
                m_lo = _interp(x, M_min, xe)
                v = max(abs(_interp(x, V_max, xe)), abs(_interp(x, V_min, xe)))
                mu = _gov_signed(m_hi, m_lo)
                locations.append({
                    'name': f'Lap end ({side} of sup {j + 1})',
                    'x_ft': round(xe, 2),
                    'Mu': round(mu, 3), 'Vu': round(v, 3),
                    'Ru': None, 'region': 'negative',
                    'support': j + 1, 'side': side,
                    'Mu_max': round(m_hi, 3), 'Mu_min': round(m_lo, 3),
                    '_idx': node_of(xe), '_q': 'Mmin' if abs(m_lo) >= abs(m_hi) else 'Mmax',
                    'unrounded': {'x_ft': float(xe), 'Mu': float(mu), 'Vu': float(v), 'Mu_max': float(m_hi),
                                  'Mu_min': float(m_lo)},
                })

    if direction == 'single':
        for loc in locations:
            for key in ('_idx', '_q', '_sup'):
                loc.pop(key, None)
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
        # 랩 경계 절점은 랩 안으로 표시되므로 두 끝이 모두 랩일 때만 랩 I —
        # max() 는 랩을 요소 하나만큼 늘린다.
        EI_e = E * min(I_at_x[i], I_at_x[i + 1])

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
        return None  # FE 풀이 실패 → None 반환으로 호출자에서 감지

    return [round(d, 5) for d in delta]


def normalize_laps(laps_per_support, spans: List[float]) -> list:
    """지점별 랩 길이를 [(left_ft, right_ft), ...] (지점 수만큼) 로 정규화한다.

    규약: left_ft = 지점 중심에서 왼쪽 랩 끝까지, right_ft = 오른쪽 랩 끝까지
    (설계매뉴얼 II-2A 의 "center of support to end of lap"; UI 개략도와 같다).
    None 항목은 랩 없음. 랩은 양쪽에 경간이 있는 내부 지점에서만 뜻이 있으므로
    양 끝 지점의 값은 버린다. 랩이 인접 경간보다 길면 ValueError.
    """
    n = len(spans)
    out = [(0.0, 0.0)] * (n + 1)
    if not laps_per_support:
        return out
    out = []
    for j in range(n + 1):
        lap = laps_per_support[j] if j < len(laps_per_support) else None
        if not lap or j == 0 or j == n:
            out.append((0.0, 0.0))
            continue
        lL = float(lap.get('left_ft') or lap.get('left') or 0.0)
        lR = float(lap.get('right_ft') or lap.get('right') or 0.0)
        if lL < 0 or lR < 0:
            raise ValueError(f'Negative lap length at support {j + 1}.')
        if lL >= spans[j - 1] or lR >= spans[j]:
            raise ValueError(f'Lap at support {j + 1} ({lL}, {lR} ft) is not shorter than the adjacent spans.')
        out.append((lL, lR))
    return out


def analyze_beam_fe(
    spans: List[float],
    w_plf_list: List[float],
    supports: List[str] = None,
    laps_per_support: list = None,
    I_base_in4: float = 1.0,
    I_lap_ratio: float = 2.0,
    E_ksi: float = 29500.0,
    n_pts_per_span: int = 51,
    I_span_in4: Optional[List[float]] = None,
) -> BeamResult:
    """직접 강성법(FE)으로 연속보의 M, V, R, δ를 동시 계산

    비등단면(Lap 구간 EI 증가)을 반영하여 모멘트 재분배와 처짐을 일관되게 산출한다.
    절점은 경간마다 n_pts_per_span 개와 랩 끝(경계)에 둔다. 요소의 EI 와 등분포하중은
    요소 **중점**이 속한 구간(랩 안/밖)과 경간의 값을 쓴다 — 경계 절점의 값으로 정하면
    랩이 요소 하나만큼 늘어나고 경간 경계의 하중이 평균된다.

    Parameters
    ----------
    spans : 각 스팬 길이 (ft)
    w_plf_list : 각 스팬의 등분포하중 (plf, 하향 +)
    supports : 지점 조건 ['P','P',...] — P/R/F/N (모든 위치에서 허용)
    laps_per_support : 지점별 랩 [{left_ft:, right_ft:}, ...] — normalize_laps 규약
    I_base_in4 : 기본 단면2차모멘트 (in^4)
    I_lap_ratio : I_span_in4 가 없을 때 랩 구간 Ix 배율 (기본 2.0 = 같은 단면 2겹)
    E_ksi : 탄성계수 (ksi)
    n_pts_per_span : 스팬당 절점 수
    I_span_in4 : 경간별 부재 Ix (in^4). 주면 랩 구간 Ix = 양쪽 부재 Ix 의 합
                 (설계매뉴얼 II-1A/II-2A 가정 b).

    Returns
    -------
    BeamResult with M (kip-ft), V (kips), R (kips, 지점마다, 상향 +), D (in., 하향 +).
    풀이 실패(특이 행렬 등)는 ValueError — 0 결과를 돌려주지 않는다.
    """
    import numpy as _np

    n_spans = len(spans)
    sup = _norm_supports(supports, n_spans)
    if len(sup) != n_spans + 1:
        raise ValueError(f'supports must have {n_spans + 1} entries (got {len(sup)}).')
    check_support_stability(sup)
    if len(w_plf_list) != n_spans:
        raise ValueError('w_plf_list must have one load per span.')
    if I_span_in4 is not None and len(I_span_in4) != n_spans:
        raise ValueError('I_span_in4 must have one value per span.')

    sup_x_ft = [0.0]
    for s in spans:
        sup_x_ft.append(sup_x_ft[-1] + s)
    laps = normalize_laps(laps_per_support, spans)

    # 절점 (ft)
    x_ft = []
    for si in range(n_spans):
        for j in range(n_pts_per_span):
            x_ft.append(sup_x_ft[si] + spans[si] * j / (n_pts_per_span - 1))
    for j, (lL, lR) in enumerate(laps):
        if lL > 0:
            x_ft.append(sup_x_ft[j] - lL)
        if lR > 0:
            x_ft.append(sup_x_ft[j] + lR)
    x_ft = sorted(x_ft)
    x_ft_clean = [x_ft[0]]
    for i in range(1, len(x_ft)):
        if x_ft[i] > x_ft_clean[-1] + 1e-8:
            x_ft_clean.append(x_ft[i])
    x_ft = x_ft_clean
    n = len(x_ft)
    x_in = [x * 12.0 for x in x_ft]

    I_span = list(I_span_in4) if I_span_in4 is not None else [I_base_in4] * n_spans
    if min(I_span) <= 0 or E_ksi <= 0:
        raise ValueError('E and I must be positive.')

    def _span_of(xm_ft):
        for si in range(n_spans):
            if xm_ft <= sup_x_ft[si + 1]:
                return si
        return n_spans - 1

    def _I_at(xm_ft):
        for j, (lL, lR) in enumerate(laps):
            if (lL > 0 or lR > 0) and sup_x_ft[j] - lL < xm_ft < sup_x_ft[j] + lR:
                if I_span_in4 is not None:
                    return I_span[j - 1] + I_span[j]
                return I_base_in4 * I_lap_ratio
        return I_span[_span_of(xm_ft)]

    elems = []
    ndof = 2 * n
    K = _np.zeros((ndof, ndof))
    F = _np.zeros(ndof)
    for i in range(n - 1):
        Le = x_in[i + 1] - x_in[i]
        xm = 0.5 * (x_ft[i] + x_ft[i + 1])
        EI_e = E_ksi * _I_at(xm)
        w_e = w_plf_list[_span_of(xm)] / 1000.0 / 12.0  # kip/in
        c = EI_e / Le ** 3
        ke = c * _np.array([
            [12,    6*Le,   -12,    6*Le],
            [6*Le,  4*Le**2, -6*Le, 2*Le**2],
            [-12,  -6*Le,    12,   -6*Le],
            [6*Le,  2*Le**2, -6*Le, 4*Le**2],
        ])
        fe = w_e * Le / 2.0 * _np.array([1.0, Le/6.0, 1.0, -Le/6.0])
        dofs = [2*i, 2*i+1, 2*(i+1), 2*(i+1)+1]
        K[_np.ix_(dofs, dofs)] += ke
        F[dofs] += fe
        elems.append((ke, fe, dofs))

    # 경계조건 (DOF 양: δ 하향, θ)
    bc_dofs = set()
    sup_node = []
    for si, sx in enumerate(sup_x_ft):
        best_i = min(range(n), key=lambda idx: abs(x_ft[idx] - sx))
        sup_node.append(best_i)
        if sup[si] != 'N':
            bc_dofs.add(2 * best_i)
        if sup[si] == 'F':
            bc_dofs.add(2 * best_i + 1)
    free_dofs = sorted(i for i in range(ndof) if i not in bc_dofs)

    Kff = K[_np.ix_(free_dofs, free_dofs)]
    Ff = F[free_dofs]
    try:
        d_free = _solve_banded_spd(Kff, Ff)
    except (_np.linalg.LinAlgError, ValueError) as exc:
        raise ValueError(f'Beam FE solve failed: {exc}') from exc
    # 촘촘한 격자(경간당 1000 절점)에서는 조건수 때문에 상대 잔차 1e-5 수준이 정상이다.
    # 지점 부족(기구)은 위의 check_support_stability 가 먼저 거른다.
    resid = _np.linalg.norm(Kff @ d_free - Ff)
    scale = max(_np.linalg.norm(Ff), 1e-30)
    if not _np.all(_np.isfinite(d_free)) or (_np.linalg.norm(Ff) > 0 and resid > 1e-3 * scale):
        raise ValueError('Beam FE solve failed (ill-conditioned stiffness matrix).')
    d_full = _np.zeros(ndof)
    d_full[free_dofs] = d_free

    # 요소 내력 (좌단 값; 마지막 절점은 마지막 요소의 우단 값)
    M_kipin = [0.0] * n
    V_kips = [0.0] * n
    for i, (ke, fe, dofs) in enumerate(elems):
        f_elem = ke @ d_full[dofs] - fe
        V_kips[i] = -f_elem[0]
        M_kipin[i] = f_elem[1]
        if i == n - 2:
            V_kips[i + 1] = f_elem[2]
            M_kipin[i + 1] = -f_elem[3]
    M_kipft = [float(m) / 12.0 for m in M_kipin]
    V_kips = [float(v) for v in V_kips]

    # 반력: 지점이 보에 주는 힘(하향 +) = K d − F → 상향 + 로 부호를 바꾼다.
    F_internal = (K * d_full).sum(axis=1)   # numpy 합(결정적) — BLAS 의 스레드 수와 무관
    reactions = []
    for si, node_i in enumerate(sup_node):
        if sup[si] == 'N':
            reactions.append(0.0)
        else:
            reactions.append(round(float(-(F_internal[2 * node_i] - F[2 * node_i])), 6))

    result = BeamResult(x_ft, M_kipft, V_kips, reactions, n, is_valid=True)
    result.D = [round(float(d_full[2 * i]), 6) for i in range(n)]
    return _attach_statics(result, spans, w_plf_list, sup)


def extract_max_deflection_per_span(
    x_ft: list, defl_in: list, spans: List[float], supports: List[str] = None,
) -> list:
    """각 스팬별 최대 처짐 위치와 값 추출

    자유단(N)이 있는 경간(캔틸레버·내민보)의 처짐비는 관례대로 2L/δ 로 낸다
    ('L_ratio_basis').

    Returns
    -------
    list of dicts: [{'span': 1, 'x_ft': ..., 'delta_in': ..., 'L_ft': ...}, ...]
    """
    sup = _norm_supports(supports, len(spans))
    results = []
    x_offset = 0.0
    for si, L in enumerate(spans):
        span_start = x_offset
        span_end = x_offset + L
        cant = sup[si] == 'N' or sup[si + 1] == 'N'
        L_eff = 2.0 * L if cant else L
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
            'L_over_delta': round(L_eff * 12.0 / max_abs, 0) if max_abs > 1e-6 else float('inf'),
            'L_ratio_basis': '2L (cantilever)' if cant else 'L',
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
            # 특이 행렬(불안정 지점 조합 등)을 0 해로 덮으면 M=0 이 설계를 통과한다.
            raise ValueError('Singular beam equations (unstable support arrangement?)')
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
        x[i] = s / aug[i][i]
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
