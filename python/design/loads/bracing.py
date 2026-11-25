"""데크/패널 강성 계산, 비지지길이 결정, 모멘트구배계수, 양력 R 검증

Sections:
  - kφ (rotational stiffness) — Gao & Moen (2011), Design Manual Example II-1C 3b
  - kx (lateral stiffness) — AISI RP17-2 curve fit, Design Manual Example II-1C 3a
  - Cb (moment gradient factor) — AISI S100-16 Eq. F2.1.1-2
  - β (distortional buckling gradient) — Appendix 2, Eq. 2.3.3.3-3
  - 비지지 영역 — determine_unbraced_lengths 의 규칙
  - R (uplift reduction factor) — Section I6.2.1 (through-fastened)
"""
from design.notices import N as _nt, joined as _joined, fields as _fields  # noqa: E402


E_STEEL = 29500.0  # ksi
G_STEEL = 11300.0  # ksi — AISI S100-16 §A3.1 published shear modulus (77,900 MPa)


# ---------------------------------------------------------------------------
# 패널 회전강성 kφ (Gao & Moen 2011, Example II-1C 3b)
# ---------------------------------------------------------------------------

def calc_rotational_stiffness(
    t_panel: float,
    t_purlin: float,
    fastener_spacing: float = 12.0,
    flange_width: float = 2.5,
    k_per_fastener: float = None,
    E: float = E_STEEL,
    b_fastener: float = None,
    c_fastener: float = None,
) -> float:
    """through-fastened 패널-퍼린 연결의 회전강성 kφ (Gao & Moen 2011)

    Design Manual Example II-1C 3b 의 식:
        kφ = 1 / [ 1/(k c²) + (b²c/2 + b c² + c³/3) / (E I c²) ]
        k  = 1.934 c^-0.4 / s   (패널 인발강성, kip/in./fastener → 간격 s 로 나눔)
        I  = t_purlin³ / 12     (퍼린 판의 단위폭 I)
    b = 웹-플랜지 모서리 ~ 패스너, c = 플랜지-립 모서리 ~ 패스너 (기본 각각 B/2).

    k 의 추세식은 0.018 in. 패널의 유한요소 결과에서 나왔다. 패널이 이보다 얇거나
    패스너가 패널 리브에서 1 in. 넘게 떨어지면 과대평가할 수 있다(예제 본문).
    식에는 패널 두께가 들어가지 않는다 — t_panel 은 적용 범위 확인에만 쓴다.
    예비설계용 해석식이다. S918 시험값이 있으면 kphi_override 로 넣는다.

    Parameters
    ----------
    t_panel : 패널 두께 (in.) — 식에는 쓰지 않음
    t_purlin : 퍼린 두께 (in.)
    fastener_spacing : 패스너 간격 s (in.)
    flange_width : 플랜지 외-외 폭 B (in.)
    k_per_fastener : 패스너당 인발강성을 직접 줄 때 (kip/in./fastener). None 이면 1.934 c^-0.4
    E : 탄성계수 (ksi)
    b_fastener, c_fastener : b, c (in.). None 이면 B/2

    Returns
    -------
    kφ in kip-in./rad/in. (Example II-1C: 0.113)
    """
    if min(t_purlin, fastener_spacing, flange_width, E) <= 0:
        return 0.0
    b = b_fastener if b_fastener is not None else flange_width / 2.0
    c = c_fastener if c_fastener is not None else flange_width / 2.0
    if b <= 0 or c <= 0:
        return 0.0
    k_fast = k_per_fastener if k_per_fastener is not None else 1.934 * c ** -0.4
    k = k_fast / fastener_spacing
    I_sheet = t_purlin ** 3 / 12.0

    flex = (b ** 2 * c / 2.0 + b * c ** 2 + c ** 3 / 3.0) / (E * I_sheet * c ** 2)
    pull = 1.0 / (k * c ** 2)
    return 1.0 / (pull + flex)


# ---------------------------------------------------------------------------
# 패널 횡강성 kx (AISI RP17-2, Example II-1C 3a)
# ---------------------------------------------------------------------------

# Example II-1C 3a 의 패스너 값 (Fss 1800 lb, D 0.190 in., Fu1 = Fu2 = 70 ksi)
RP17_2_EXAMPLE_FASTENER = {'Fss_kip': 1.8, 'D_screw_in': 0.190, 'Fu1_ksi': 70.0, 'Fu2_ksi': 70.0}


def lateral_stiffness_detail(
    t_panel: float,
    t_purlin: float,
    fastener_spacing: float = 12.0,
    E: float = E_STEEL,
    Fss_kip: float = None,
    D_screw_in: float = None,
    Fu1_ksi: float = None,
    Fu2_ksi: float = None,
) -> dict:
    """RP17-2 곡선맞춤 (Example II-1C 3a):

        Ka = [1/(E t1) + 1/(E t2)]^-1
        ψ  = (Fss / (t1 D Fu1)) (Fss / (t2 D Fu2))
        Ke = 0.27 ψ^-0.69 Ka            (패스너 1개, kip/in.)
        kx = Ke / s

    Fss·D·Fu 가 없으면 예제 값을 쓰고 'defaulted' 에 밝힌다. 시험 자료는 강판
    두께 18 – 97 mil, #8 – #12 자기천공 나사이고, 곡선의 변동계수가 0.86 으로 크다.

    알림 (FIXES §3.1.1): 'warnings' = 이 입력에서 값을 바꾼 것(범위 밖, 0 처리),
    'scope_notes' = 늘 참인 방법의 한계(COV). 'notes' 는 둘을 합친 이전 키.
    """
    t1, t2 = t_panel, t_purlin
    out = {'kx': 0.0, 'Ka': None, 'psi': None, 'Ke': None, 'defaulted': [], 'notes': [],
           'warnings': [], 'scope_notes': []}
    if min(t1, t2, fastener_spacing, E) <= 0:
        out['warnings'].append(_nt('loads.warning.non_positive_thickness_spacing'))
        out['notes'] = out['warnings'] + out['scope_notes']
        return out
    vals = {'Fss_kip': Fss_kip, 'D_screw_in': D_screw_in, 'Fu1_ksi': Fu1_ksi, 'Fu2_ksi': Fu2_ksi}
    for key, v in vals.items():
        if v is None or v <= 0:
            vals[key] = RP17_2_EXAMPLE_FASTENER[key]
            out['defaulted'].append(key)
    Ka = 1.0 / (1.0 / (E * t1) + 1.0 / (E * t2))
    psi = (vals['Fss_kip'] / (t1 * vals['D_screw_in'] * vals['Fu1_ksi'])) * \
          (vals['Fss_kip'] / (t2 * vals['D_screw_in'] * vals['Fu2_ksi']))
    Ke = 0.27 * psi ** -0.69 * Ka
    out.update({'kx': Ke / fastener_spacing, 'Ka': Ka, 'psi': psi, 'Ke': Ke, 'inputs': vals})
    if min(t1, t2) < 0.0179 or max(t1, t2) > 0.097:
        out['warnings'].append(_nt('loads.warning.ply_thickness_outside_rp17'))
    out['scope_notes'].append(_nt('loads.scope.rp17_curve_fit_has'))
    out['notes'] = out['warnings'] + out['scope_notes']
    return out


def calc_lateral_stiffness(
    t_panel: float,
    t_purlin: float,
    fastener_spacing: float = 12.0,
    E: float = E_STEEL,
    Pss: float = 0,
    d_screw: float = 0,
    Fu_panel: float = 0,
    Fss_kip: float = None,
    D_screw_in: float = None,
    Fu1_ksi: float = None,
    Fu2_ksi: float = None,
    **_kwargs,
) -> float:
    """패널-퍼린 연결의 횡강성 kx (kip/in./in.) — lateral_stiffness_detail 의 kx.

    Fss_kip·D_screw_in·Fu1_ksi·Fu2_ksi 가 없으면 Example II-1C 의 패스너 값을 쓴다
    (예제 점에서 1.28). Pss/d_screw/Fu_panel 은 이전 API 호환용으로 받기만 하고 쓰지
    않는다(검증되지 않은 별도 모델이었다).
    """
    return lateral_stiffness_detail(
        t_panel, t_purlin, fastener_spacing, E,
        Fss_kip=Fss_kip, D_screw_in=D_screw_in, Fu1_ksi=Fu1_ksi, Fu2_ksi=Fu2_ksi,
    )['kx']


# ---------------------------------------------------------------------------
# 모멘트 구배계수 Cb (AISI Eq. F2.1.1-2)
# ---------------------------------------------------------------------------

def calc_Cb(M_max: float, M_A: float, M_B: float, M_C: float,
            return_detail: bool = False):
    """횡-비틀림좌굴 모멘트 구배계수

    Parameters (all absolute values of moments in unbraced segment)
    ----------
    M_max : 구간 내 최대 모멘트 |M|
    M_A : 1/4점 모멘트 |M|
    M_B : 중앙점 모멘트 |M|
    M_C : 3/4점 모멘트 |M|
    return_detail : True이면 dict 반환 (Cb + 상세)

    Returns
    -------
    Cb (≥ 1.0), or dict if return_detail=True
    """
    denom = 2.5 * M_max + 3.0 * M_A + 4.0 * M_B + 3.0 * M_C
    if denom < 1e-15:
        Cb = 1.0
    else:
        Cb = 12.5 * M_max / denom
    Cb = max(Cb, 1.0)
    if return_detail:
        return {
            'Cb': round(Cb, 4),
            'Mmax': round(M_max, 4),
            'MA': round(M_A, 4),
            'MB': round(M_B, 4),
            'MC': round(M_C, 4),
            # 반올림 전 값(SI 변환용 — 설계 결과의 display_unrounded 와 같은 뜻)
            'display_unrounded': {'Cb': float(Cb), 'Mmax': float(M_max), 'MA': float(M_A), 'MB': float(M_B),
                                  'MC': float(M_C)},
        }
    return Cb


def calc_Cb_from_diagram(M_list: list, x_list: list,
                         x_start: float, x_end: float) -> float:
    """모멘트 다이어그램에서 비지지 구간의 Cb 자동 계산"""
    # 구간 내 모멘트 추출
    seg_M = []
    seg_x = []
    for i, x in enumerate(x_list):
        if x_start - 0.01 <= x <= x_end + 0.01:
            seg_M.append(M_list[i])
            seg_x.append(x)

    if len(seg_M) < 3:
        return 1.0

    M_abs = [abs(m) for m in seg_M]
    M_max = max(M_abs)

    L = x_end - x_start
    if L < 1e-10:
        return 1.0

    # 1/4, 1/2, 3/4점 보간
    def interp_M(target_x):
        for j in range(len(seg_x) - 1):
            if seg_x[j] <= target_x <= seg_x[j + 1]:
                ratio = (target_x - seg_x[j]) / (seg_x[j + 1] - seg_x[j]) if (seg_x[j + 1] - seg_x[j]) > 1e-10 else 0
                return abs(seg_M[j] + ratio * (seg_M[j + 1] - seg_M[j]))
        return 0.0

    M_A = interp_M(x_start + L * 0.25)
    M_B = interp_M(x_start + L * 0.50)
    M_C = interp_M(x_start + L * 0.75)

    return calc_Cb(M_max, M_A, M_B, M_C)


def _get_Cb_detail(M_list, x_list, x_start, x_end):
    """Cb 계산 상세 (MA, MB, MC, Mmax) 반환"""
    seg_M, seg_x = [], []
    for i, x in enumerate(x_list):
        if x_start - 0.01 <= x <= x_end + 0.01:
            seg_M.append(M_list[i])
            seg_x.append(x)
    if len(seg_M) < 3:
        return None
    M_abs = [abs(m) for m in seg_M]
    M_max = max(M_abs)
    L = x_end - x_start
    if L < 1e-10:
        return None
    def _interp(tx):
        for j in range(len(seg_x) - 1):
            if seg_x[j] <= tx <= seg_x[j + 1]:
                r = (tx - seg_x[j]) / (seg_x[j+1] - seg_x[j]) if (seg_x[j+1] - seg_x[j]) > 1e-10 else 0
                return abs(seg_M[j] + r * (seg_M[j+1] - seg_M[j]))
        return 0.0
    MA = _interp(x_start + L * 0.25)
    MB = _interp(x_start + L * 0.50)
    MC = _interp(x_start + L * 0.75)
    return calc_Cb(M_max, MA, MB, MC, return_detail=True)


def _interp_moment(M_list, x_list, target_x):
    """모멘트 다이어그램에서 특정 위치의 모멘트 보간"""
    for j in range(len(x_list) - 1):
        if x_list[j] <= target_x <= x_list[j + 1]:
            dx = x_list[j + 1] - x_list[j]
            r = (target_x - x_list[j]) / dx if dx > 1e-10 else 0
            return M_list[j] + r * (M_list[j + 1] - M_list[j])
    return 0.0


# ---------------------------------------------------------------------------
# 왜곡좌굴 구배보정 β (Appendix 2, Eq. 2.3.3.3-3)
# ---------------------------------------------------------------------------

def calc_beta_distortional(Lcrd: float, Lm: float,
                           M1: float, M2: float,
                           diagram_signs: bool = False) -> float:
    """왜곡좌굴 모멘트 구배 보정계수 (Eq. 2.3.3.3-3)

    Parameters
    ----------
    Lcrd : 왜곡좌굴 반파장 (in.)
    Lm : 비지지길이 (in.) — 랩 끝~변곡점
    M1, M2 : 비지지구간 양 끝 모멘트. 크기로 정렬해 |M1| ≤ |M2| 로 쓰므로 순서는 무관.
    diagram_signs : 부호의 뜻.
        False (기본) — Eq. 2.3.3.3-3 규약의 부호: 비 M1/M2 가 역곡률이면 +, 단곡률이면 −
                       가 되도록 넣은 값.
        True — 모멘트 다이어그램 부호(새깅 +) 그대로. 두 끝이 같은 부호 = 단곡률이므로
               비를 −|M1|/|M2| 로, 다른 부호 = 역곡률이므로 +|M1|/|M2| 로 바꾼다.

    Returns
    -------
    β (1.0 ≤ β ≤ 1.3)
    """
    L = min(Lcrd, Lm)
    if Lm < 1e-10:
        return 1.0

    # 크기순 정렬: |M1| ≤ |M2| (Eq. 2.3.3.3-3에서 M1=작은 단부, M2=큰 단부)
    if abs(M1) > abs(M2):
        M1, M2 = M2, M1
    # M2는 큰 쪽 단부이므로 ≈0이면 두 단부 모두 ≈0 (모멘트 없음)
    if abs(M2) < 1e-10:
        return 1.0

    # 단곡률이면 음(-)→β 감소, 역곡률이면 양(+). r ≥ -1 (Eq. 2.3.3.3-3).
    r = M1 / M2
    if diagram_signs:
        r = -r
    r = max(r, -1.0)
    beta = 1.0 + 0.4 * (L / Lm) ** 0.7 * (1.0 + r) ** 0.7
    return max(1.0, min(beta, 1.3))


# ---------------------------------------------------------------------------
# 비지지길이 자동 결정
# ---------------------------------------------------------------------------

UNBRACED_RULE = (
    "Compression flange from the sign of M (sagging +): M > 0 -> top flange, M < 0 -> bottom "
    "flange, for gravity and uplift alike. Brace points: supports (P/R/F) and the given discrete "
    "brace points; a free end (N) is unbraced. A through-fastened deck braces the top flange "
    "continuously, and inflection points are then taken as brace points of the bottom flange "
    "(Design Manual Examples II-1A/II-2A); the single-member segment near a lapped support ends at "
    "the lap end. Standing-seam roofs and members without deck are braced only at discrete points "
    "(S100-16 App. A I6.2.2): the unbraced length is the brace-to-brace distance and inflection "
    "points are not brace points. Cb from Eq. F2.1.1-2 with |M|; Cb = 1.0 for an overhang or "
    "cantilever with an unbraced free end (F2.1.1)."
)


INFLECTION_TOL = 1e-7    # |M| ≤ 1e-7 × max(1, max|M|) 는 0 (부호 없음) — _sign_zones 와 같은 허용오차


def inflection_points(x, M) -> list:
    """M 의 부호가 부재 안에서 바뀌는 점(ft).

    측점의 부호: M > tol → +, M < −tol → −, |M| ≤ tol → 0 (tol = INFLECTION_TOL × max(1, max|M|)). 부호가 0 이 아닌
    두 측점 사이에서 부호가 바뀔 때만 변곡점이다:
    - 이웃한 두 측점이면 그 사이를 선형보간한 영점;
    - 사이에 0 인 측점들이 끼어 있으면(모멘트 0 인 구간) 그 0 구간의 가운데.
    따라서 자유단 · 핀 끝 지점의 M = 0, 실을 하중이 없는 내다지의 M = 0 구간처럼 부호가 바뀌지 않는 0 은 변곡점이 아니다.
    """
    if len(M) < 2:
        return []
    tol = INFLECTION_TOL * max([1.0] + [abs(v) for v in M])
    sg = [1 if v > tol else (-1 if v < -tol else 0) for v in M]
    out = []
    prev = None
    for i, s_i in enumerate(sg):
        if s_i == 0:
            continue
        if prev is not None and sg[prev] != s_i:
            if i == prev + 1:
                m0, m1 = M[prev], M[i]
                out.append(x[prev] - m0 * (x[i] - x[prev]) / (m1 - m0))
            else:
                out.append(0.5 * (x[prev + 1] + x[i - 1]))
        prev = i
    return out


def _sign_zones(x, M, sign: int, members=None) -> list:
    """sign*M > 0 인 연속 구간 [(a, b), ...] (경계는 선형보간한 영점).

    M 이 여러 다이어그램의 포락선이면 members 에 그 다이어그램들을 준다. 포락선은
    격자 사이에서 꺾이므로, 경계를 포락선이 아니라 각 다이어그램의 영점으로 정한다.
    """
    n = len(x)
    if n == 0:
        return []
    scale = max(abs(m) for m in M) if M else 0.0
    if scale <= 0:
        return []
    tol = 1e-7 * scale
    s = [sign * m > tol for m in M]

    def lin(y, i0, i1):
        v0, v1 = sign * y[i0], sign * y[i1]
        if abs(v1 - v0) < 1e-30:
            return x[i0]
        xc = x[i0] + (0.0 - v0) * (x[i1] - x[i0]) / (v1 - v0)
        lo_x, hi_x = min(x[i0], x[i1]), max(x[i0], x[i1])
        return min(max(xc, lo_x), hi_x)

    def cross(i0, i1):
        # i0: 구간 밖, i1: 구간 안
        if not members:
            return lin(M, i0, i1)
        cands = [lin(m, i0, i1) for m in members if sign * m[i1] > tol]
        if not cands:
            return lin(M, i0, i1)
        return min(cands, key=lambda c: abs(c - x[i0]))

    zones = []
    i = 0
    while i < n:
        if not s[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and s[j + 1]:
            j += 1
        a = x[0] if i == 0 else cross(i - 1, i)
        b = x[-1] if j == n - 1 else cross(j + 1, j)
        zones.append((a, b))
        i = j + 1
    return zones


def _segment_cb(M_abs, x, a, b, cantilever: bool):
    if cantilever:
        return 1.0, None
    detail = _get_Cb_detail(M_abs, x, a, b)
    if detail is None:
        return 1.0, None
    return detail['Cb'], detail


def determine_unbraced_lengths(
    M_diagram: list,
    x_diagram: list,
    spans: list,
    laps: dict = None,
    laps_per_support: list = None,
    deck_type: str = 'through-fastened',
    M_min_diagram: list = None,
    supports: list = None,
    brace_points_ft: list = None,
    envelope_members: tuple = None,
) -> dict:
    """모멘트 다이어그램(또는 포락선)과 지지조건으로 압축 플랜지별 비지지 영역을 정한다.

    규칙은 UNBRACED_RULE 하나다 (중력·양력 구분 없이 M 의 부호로 압축 플랜지를 정함).

    Parameters
    ----------
    M_diagram : M (kip-ft, 새깅 +). M_min_diagram 을 주면 이것은 정(최대) 포락선.
    M_min_diagram : 부(최소) 포락선. 없으면 M_diagram 과 같다.
    laps : {'left_ft','right_ft'} — laps_per_support 가 없을 때 모든 내부 지점에 적용
    laps_per_support : 지점별 [{left_ft, right_ft} | None, ...] (left = 지점 중심에서 왼쪽 랩 끝까지)
    deck_type : 'through-fastened' | 'standing-seam' | 'none'
    supports : 지점 조건 (P/R/F/N)
    brace_points_ft : 이산 브레이스 위치 (ft, 양 플랜지 횡구속)
    envelope_members : (정 포락선을 이루는 다이어그램 목록, 부 포락선을 이루는 목록) — 영점 정밀화용

    Returns
    -------
    dict with:
        'positive_regions': 상부 플랜지 압축 영역 [{start_ft, end_ft, Ly, Lt, Ly_in, Lt_in, Cb, braced, ...}]
        'negative_regions': 하부 플랜지 압축 영역 (랩 안 구간 제외)
                            [{support, side, start_ft, end_ft, Ly_in, Lt_in, Cb, Cb_detail, M1, M2, ...}]
        'lap_regions': 랩 안의 하부 플랜지 압축 구간 (2겹 단면, 따로 검토)
        'inflection_points_ft', 'supports_ft', 'lap_ends_ft', 'brace_points_ft', 'rule', 'assumptions'
    """
    x = [float(v) for v in x_diagram]
    M_hi = [float(v) for v in M_diagram]
    M_lo = [float(v) for v in M_min_diagram] if M_min_diagram is not None else M_hi
    n = len(spans)
    sup = [s[0].upper() if s else 'P' for s in supports] if supports else ['P'] * (n + 1)
    xs = [0.0]
    for s in spans:
        xs.append(xs[-1] + s)
    total = xs[-1]
    eps = 1e-6

    # 랩 (지점별, 양 끝 지점은 제외)
    lap_pairs = [(0.0, 0.0)] * (n + 1)
    if laps_per_support:
        lap_pairs = []
        for j in range(n + 1):
            lp = laps_per_support[j] if j < len(laps_per_support) else None
            if not lp or j == 0 or j == n:
                lap_pairs.append((0.0, 0.0))
            else:
                lap_pairs.append((float(lp.get('left_ft', 0) or 0), float(lp.get('right_ft', 0) or 0)))
    elif laps and n > 1:
        lL = float(laps.get('left_ft', 0) or 0)
        lR = float(laps.get('right_ft', 0) or 0)
        lap_pairs = [(lL, lR) if (0 < j < n and sup[j] != 'N') else (0.0, 0.0) for j in range(n + 1)]
    lap_ends = []
    lap_spans = []  # (start, end) of lapped portion
    for j, (lL, lR) in enumerate(lap_pairs):
        if lL > 0:
            lap_ends.append(xs[j] - lL)
        if lR > 0:
            lap_ends.append(xs[j] + lR)
        if lL > 0 or lR > 0:
            lap_spans.append((xs[j] - lL, xs[j] + lR))

    braces = sorted(float(b) for b in (brace_points_ft or []) if eps < float(b) < total - eps)
    real_sup_x = [xs[j] for j in range(n + 1) if sup[j] != 'N']
    interior_real_x = [xs[j] for j in range(1, n) if sup[j] != 'N']
    brace_x = sorted(set(real_sup_x + braces))
    free_ends = []
    if sup[0] == 'N':
        free_ends.append(xs[0])
    if sup[-1] == 'N':
        free_ends.append(xs[-1])

    mem_hi, mem_lo = (envelope_members or (None, None))
    M_abs_env = [max(abs(a), abs(b)) for a, b in zip(M_hi, M_lo)]
    # 동률 허용오차(계약 §6.1): 모멘트 포락 크기의 1e-9 배(최소 1e-9)
    tie_tol = 1e-9 * max([1.0] + [abs(v) for v in M_hi + M_lo])
    M_abs_lo = [abs(v) for v in M_lo]
    M_abs_hi = [abs(v) for v in M_hi]

    def nearest_support(a, b):
        mid = 0.5 * (a + b)
        cands = [j for j in range(n + 1) if sup[j] != 'N']
        j = min(cands, key=lambda k: abs(xs[k] - mid))
        return j, ('left' if mid < xs[j] else 'right')

    def touches(xv, pts):
        return any(abs(xv - p) < eps for p in pts)

    def region_info(a, b, flange, M_signed, M_abs, cantilever, braced=False):
        Ly = 0.0 if braced else (b - a) * 12.0
        cb, detail = (1.0, None) if braced else _segment_cb(M_abs, x, a, b, cantilever)
        m_a = _interp_moment(M_signed, x, a)
        m_b = _interp_moment(M_signed, x, b)
        M1, M2 = (m_a, m_b) if abs(m_a) <= abs(m_b) else (m_b, m_a)
        # 이 플랜지를 압축하는 부호의 모멘트만 (상부: M > 0, 하부: M < 0). 브레이스 간 영역은
        # 반대 부호 모멘트를 함께 담으므로 |M| 로 고르면 다른 플랜지의 모멘트가 섞인다.
        sgn = 1.0 if flange == 'top' else -1.0
        pts = [k for k, xv in enumerate(x) if a - eps <= xv <= b + eps]
        if pts:
            # 같은 값(허용오차 안)이면 앞 측점 — 끝자리 잡음으로 위치를 고르지 않는다(계약 §6.1 동률 규칙)
            top = max(sgn * M_signed[k] for k in pts)
            kmax = next(k for k in pts if sgn * M_signed[k] >= top - tie_tol)
            m_max, x_max = max(sgn * M_signed[kmax], 0.0), x[kmax]
        else:
            m_max, x_max = max(sgn * m_a, sgn * m_b, 0.0), a
        j, side = nearest_support(a, b)
        kind = 'cantilever' if cantilever else (
            'support' if (touches(a, real_sup_x + lap_ends) or touches(b, real_sup_x + lap_ends))
            and any(a - eps <= xr <= b + eps for xr in interior_real_x + lap_ends) else 'span')
        return {
            'support': j, 'side': side,
            'start_ft': round(a, 4), 'end_ft': round(b, 4),
            'Ly_in': round(Ly, 1), 'Lt_in': round(Ly, 1),
            'Ly': round(Ly, 1), 'Lt': round(Ly, 1),
            'Cb': round(cb, 2), 'Cb_detail': detail,
            'M1': round(M1, 4), 'M2': round(M2, 4),
            'M_max_abs': round(m_max, 4), 'x_M_max_ft': round(x_max, 3),
            'flange': flange, 'braced': braced, 'cantilever': cantilever, 'kind': kind,
            'unrounded': {'start_ft': float(a), 'end_ft': float(b), 'Ly_in': float(Ly), 'Lt_in': float(Ly),
                          'Cb': float(cb), 'M1': float(M1), 'M2': float(M2), 'M_max_abs': float(m_max),
                          'x_M_max_ft': float(x_max)},
        }

    positive_regions, negative_regions, lap_regions = [], [], []
    assumptions = []
    deck_braced_top = (deck_type == 'through-fastened')

    if deck_braced_top:
        for (a, b) in _sign_zones(x, M_hi, +1, mem_hi):
            r = region_info(a, b, 'top', M_hi, M_abs_hi, False, braced=True)
            r['kind'] = 'deck_braced'
            positive_regions.append(r)
        for (a, b) in _sign_zones(x, M_lo, -1, mem_lo):
            zone_has_int_support = any(a + eps < xr < b - eps for xr in interior_real_x)
            cuts = sorted(set([a, b] + [p for p in brace_x + lap_ends if a + eps < p < b - eps]))
            for p, q in zip(cuts[:-1], cuts[1:]):
                if q - p < eps:
                    continue
                mid = 0.5 * (p + q)
                cant = touches(p, free_ends) or touches(q, free_ends)
                r = region_info(p, q, 'bottom', M_lo, M_abs_lo, cant)
                r['zone_contains_interior_support'] = zone_has_int_support
                r['inflection_brace_assumed'] = not (touches(p, brace_x) and touches(q, brace_x))
                if any(s0 - eps <= p and q <= s1 + eps for (s0, s1) in lap_spans) and \
                        any(s0 < mid < s1 for (s0, s1) in lap_spans):
                    r['kind'] = 'lap'
                    lap_regions.append(r)
                else:
                    negative_regions.append(r)
        if negative_regions:
            assumptions.append(_nt('loads.assumption.inflection_points_taken_as'))
        if lap_regions:
            assumptions.append(_nt('loads.assumption.bottom_flange_segments_inside'))
    else:
        pts = brace_x[:]
        intervals = []
        if sup[0] == 'N' and pts and pts[0] > xs[0] + eps:
            intervals.append((xs[0], pts[0], True))
        for p, q in zip(pts[:-1], pts[1:]):
            intervals.append((p, q, False))
        if sup[-1] == 'N' and pts and pts[-1] < xs[-1] - eps:
            intervals.append((pts[-1], xs[-1], True))
        tol_hi = 1e-7 * max([abs(v) for v in M_hi] + [1e-30])
        tol_lo = 1e-7 * max([abs(v) for v in M_lo] + [1e-30])
        for (p, q, cant) in intervals:
            idx = [k for k, xv in enumerate(x) if p - eps <= xv <= q + eps]
            if any(M_hi[k] > tol_hi for k in idx):
                r = region_info(p, q, 'top', M_hi, M_abs_env, cant)
                positive_regions.append(r)
            if any(M_lo[k] < -tol_lo for k in idx):
                r = region_info(p, q, 'bottom', M_lo, M_abs_env, cant)
                r['zone_contains_interior_support'] = any(p + eps < xr < q - eps for xr in interior_real_x)
                r['inflection_brace_assumed'] = False
                negative_regions.append(r)
        assumptions.append(
            _nt('loads.assumption.flanges_braced_only_at', text=_nt('loads.fragment.standing_seam_roof') if deck_type == 'standing-seam' else _nt('loads.fragment.no_deck_bracing')))

    # 변곡점 (legacy 키) — M 의 부호가 부재 안에서 실제로 바뀌는 곳만(계약 §6.1, 2026-11-24)
    inflections = inflection_points(x, M_hi)
    infl_lo = inflection_points(x, M_lo)

    return {
        'positive_regions': positive_regions,
        'negative_regions': negative_regions,
        'lap_regions': lap_regions,
        'inflection_points_ft': [round(ip, 2) for ip in inflections],
        'inflection_points_min_envelope_ft': [round(ip, 2) for ip in infl_lo],
        'inflection_points_ft_unrounded': [float(ip) for ip in inflections],
        'inflection_points_min_envelope_ft_unrounded': [float(ip) for ip in infl_lo],
        'supports_ft': xs,
        'lap_ends_ft': [round(le, 2) for le in sorted(lap_ends)],
        'brace_points_ft': braces,
        'deck_type': deck_type,
        'rule': _nt('loads.label.unbraced_rule'),
        'assumptions': assumptions,
    }


# ---------------------------------------------------------------------------
# 양력 감소계수 R (Section I6.2.1)
# ---------------------------------------------------------------------------

# 시스템 조건 (i) – (n) 중 입력으로 확인할 수 없는 부분 — 사용자가 확인해야 한다.
I621_SYSTEM_CONDITIONS = (   # 이름표(kind 'label') — 글은 전과 같고 code · 한국어 · 치수 상수가 붙는다(K4c)
    _nt('loads.label.i621_sys_i'),
    _nt('loads.label.i621_sys_j'),
    _nt('loads.label.i621_sys_k'),
    _nt('loads.label.i621_sys_l'),
    _nt('loads.label.i621_sys_m'),
    _nt('loads.label.i621_sys_n'),
)


# §I6.2.1 조건 이름표(label)에 든 한계값 — 숫자와 물리량(계약 §3.2 어휘). 이름표 글은 그대로 두고 옆에 싣는다(K4b).
# 경간은 이름표 · 값이 ft 다 — quantity None, unit_text 'ft' 로 그대로 두고, 경계층이 바꿀 수 있게 엔진의 길이 단위(in)로
# 같은 값을 as_length · value_as_length 에 함께 싣는다(1 ft = 12 in, 정확 — 계약 §16.6).
I621_LIMITS = {
    '(a)': {'quantity': 'length', 'unit_text': 'in', 'limits': ({'op': '<=', 'value': 12.0},)},
    '(b)': {'quantity': 'length', 'unit_text': 'in', 'limits': ({'op': '>', 'value': 0.0},)},
    '(c)': {'quantity': 'dimensionless', 'limits': ({'op': '>=', 'value': 60.0}, {'op': '<=', 'value': 170.0})},
    '(d)': {'quantity': 'dimensionless', 'limits': ({'op': '>=', 'value': 2.8}, {'op': '<=', 'value': 5.5})},
    '(e)': {'quantity': 'length', 'unit_text': 'in', 'limits': ({'op': '>=', 'value': 2.125},)},
    '(f)': {'quantity': 'dimensionless', 'limits': ({'op': '>=', 'value': 16.0}, {'op': '<=', 'value': 43.0})},
    '(g)': {'quantity': 'length', 'unit_text': 'in', 'limits': ({'op': '>=', 'value': 1.5, 'times': 'd'},)},
    '(h)': {'quantity': None, 'unit_text': 'ft',
            'limits': ({'op': '<=', 'value': 33.0, 'unit_text': 'ft',
                        'as_length': {'value': 396.0, 'quantity': 'length', 'unit_text': 'in'}},)},
    '(j)-t': {'quantity': 'length', 'unit_text': 'in', 'limits': ({'op': '>=', 'value': 0.018, 'accepted': 0.0179},)},
    '(k)-t': {'quantity': 'length', 'unit_text': 'in', 'limits': ({'op': '<=', 'value': 6.0},)},
    '(n)-s': {'quantity': 'length', 'unit_text': 'in', 'limits': ({'op': '<=', 'value': 12.0},)},
    '(o)': {'quantity': 'dimensionless', 'limits': ({'op': '>=', 'value': 1.08},)},
}


def _i621_profile(sec_type) -> str:
    """I6.2.1 표의 단면 구분: 'Z', 'C', 또는 None (표에 없는 단면)."""
    t = str(sec_type or '').strip().upper()
    if 'Z' in t:
        return 'Z'
    if t in ('C', 'CS', 'CEE', 'LIPPEDC', 'LIPPED_C', 'LIPPED-C', 'C-SECTION') or t.startswith('C') \
            or 'LIPPEDC' in t.replace('_', '').replace('-', ''):
        return 'C'
    return None


def _i621_table(profile: str, d: float, continuous: bool):
    if continuous:
        return 0.60 if profile == 'C' else 0.70
    if d <= 6.5:
        return 0.70
    if d <= 8.5:
        return 0.65
    return 0.40 if profile == 'C' else 0.50


def check_i621_conditions(
    section: dict,
    Fy: float,
    Fu: float,
    span_ft: float,
    span_type: str = 'continuous',
    lap_length_in: float = None,
    lap_lengths_in: list = None,
    spans_ft: list = None,
    supports: list = None,
    deck: dict = None,
    system_confirmed: bool = None,
    insulation_in: float = None,
) -> dict:
    """Section I6.2.1 양력 감소계수 R 적용조건 검증 (through-fastened 전용)

    R 은 모든 조건 (a) – (o) 를 만족할 때만 준다. (i) – (n) 은 대부분 입력으로 확인할
    수 없으므로 system_confirmed=True (사용자 확인)가 있어야 만족으로 본다. 입력으로
    확인할 수 있는 부분(패널 두께, 패스너 간격, 단열재 두께)은 따로 검사한다.

    Parameters
    ----------
    section : depth, flange_width, thickness, lip_depth, R_corner, type ('C'/'Z'/'lippedc'...)
    Fy, Fu : ksi (None 이면 (o) 미확인)
    span_ft : 최대 경간 (spans_ft 가 없을 때)
    span_type : 'simple' | 'continuous' (spans_ft 가 있으면 그것으로 정함)
    lap_length_in : 랩 길이 하나 (이전 API) — 최솟값으로 본다
    lap_lengths_in : 내부 지점마다 양방향 랩 길이 목록 (in.) — (g) 는 그 최솟값
    spans_ft, supports : 경간별 R (20 % 규정, 캔틸레버 배제)
    deck : {'type', 't_panel', 'fastener_spacing', 'insulation_in'}
    system_confirmed : (i) – (n) 사용자 확인
    insulation_in : 단열재 두께 t_i (in.) — 단순보 r = 1 − 0.01 t_i (Eq. I6.2.1-2)

    Returns
    -------
    dict with 'all_pass', 'R' (None unless all conditions are met), 'checks' [(label, bool)],
    'conditions' [{id, label, status: pass|fail|unverified}], 'R_if_confirmed',
    'R_per_span', 'reasons', 'span_type', 'section_type'
    """
    d = section.get('depth', 0) or 0
    b = section.get('flange_width', 0) or 0
    t = section.get('thickness', 0) or 0
    lip = section.get('lip_depth', 0) or 0
    R_corner = section.get('R_corner', 0.1875)
    if R_corner is None:
        R_corner = 0.1875
    profile = _i621_profile(section.get('type', 'C'))
    sec_type = profile or str(section.get('type', ''))
    flat_b = b - 2.0 * (t + R_corner) if t > 0 else 0

    deck = deck or {}
    if insulation_in is None:
        insulation_in = deck.get('insulation_in')

    # 경간 구성
    if spans_ft:
        spans = [float(s) for s in spans_ft]
        sup = [s[0].upper() if s else 'P' for s in supports] if supports else ['P'] * (len(spans) + 1)
    else:
        spans = [float(span_ft)]
        sup = ['P', 'P']
    real_span = [not (sup[i] == 'N' or sup[i + 1] == 'N') for i in range(len(spans))]
    n_real = sum(real_span)
    if spans_ft:
        continuous = n_real > 1
    else:
        continuous = (span_type == 'continuous')

    conds = []

    def add(cid, label, status, value=None):
        c = {'id': cid, 'label': label, 'status': status, 'value': value}
        c.update(_fields(label, 'label'))      # 이름표의 code · 한국어 · 치수 매개변수(계약 §16.6, K4c)
        if getattr(value, 'code', None):       # 값이 글(알림)일 때만 — 'Z' · 'through-fastened' 같은 입력값은 그대로
            c.update(_fields(value, 'value'))
        lim = I621_LIMITS.get(cid)
        if lim is not None:   # 이름표 안의 숫자(한계) · value 의 물리량 — 계약 §16.6 (K4b)
            c['limits'] = [dict(x) for x in lim['limits']]
            c['value_quantity'] = lim['quantity'] if isinstance(value, (int, float)) and not isinstance(value, bool)                 else None
            if lim.get('unit_text'):
                c['value_unit_text'] = lim['unit_text']
            if lim.get('unit_text') == 'ft' and isinstance(value, (int, float)) and not isinstance(value, bool):
                c['value_as_length'] = {'value': float(value) * 12.0, 'quantity': 'length', 'unit_text': 'in'}
        conds.append(c)

    def pf(ok):
        return 'pass' if ok else 'fail'

    add('profile', _nt('loads.label.i621_profile'), pf(profile is not None), sec_type)
    deck_type = deck.get('type')
    if deck_type is not None:
        add('deck', _nt('loads.label.i621_deck'),
            pf(deck_type == 'through-fastened'), deck_type)
    add('(a)', _nt('loads.label.i621_a'), pf(0 < d <= 12.0), d)
    add('(b)', _nt('loads.label.i621_b'), pf(lip > 0), lip)
    add('(c)', _nt('loads.label.i621_c'), pf(t > 0 and 60 <= d / t <= 170), round(d / t, 1) if t > 0 else None)
    add('(d)', _nt('loads.label.i621_d'), pf(b > 0 and 2.8 <= d / b <= 5.5), round(d / b, 2) if b > 0 else None)
    add('(e)', _nt('loads.label.i621_e'), pf(b >= 2.125), b)
    add('(f)', _nt('loads.label.i621_f'), pf(t > 0 and 16 <= flat_b / t <= 43),
        round(flat_b / t, 1) if t > 0 else None)

    laps = [float(v) for v in (lap_lengths_in or []) if v is not None]
    if lap_length_in is not None and not laps:
        laps = [float(lap_length_in)]
    if continuous:
        if laps:
            add('(g)', _nt('loads.label.i621_g'),
                pf(min(laps) >= 1.5 * d), round(min(laps), 2))
        else:
            add('(g)', _nt('loads.label.i621_g'),
                'unverified', _nt('loads.label.i621_lap_lengths_not_given'))
    else:
        add('(g)', _nt('loads.label.i621_g_simple'), 'pass')

    add('(h)', _nt('loads.label.i621_h'), pf(max(sp for sp, rs in zip(spans, real_span) if rs) <= 33.0)
        if n_real else 'fail', max(spans))

    # (i) – (n): 입력으로 확인 가능한 부분은 검사, 나머지는 사용자 확인
    t_panel = deck.get('t_panel')
    if t_panel is not None:
        add('(j)-t', _nt('loads.label.i621_j_thickness'),
            pf(t_panel >= 0.0179), t_panel)
    if insulation_in is not None:
        add('(k)-t', _nt('loads.label.i621_k_insulation'), pf(0 <= insulation_in <= 6.0), insulation_in)
    s_fast = deck.get('fastener_spacing')
    if s_fast is not None:
        add('(n)-s', _nt('loads.label.i621_n_spacing'), pf(s_fast <= 12.0 + 1e-9), s_fast)
    add('(i)-(n)', _nt('loads.label.i621_system', items=_joined('; ', I621_SYSTEM_CONDITIONS)),
        'pass' if system_confirmed else 'unverified', bool(system_confirmed))

    if Fy and Fu:
        add('(o)', _nt('loads.label.i621_o'), pf(Fu / Fy >= 1.08), round(Fu / Fy, 3))
    else:
        add('(o)', _nt('loads.label.i621_o'), 'unverified', _nt('loads.label.i621_fy_fu_not_given'))

    geometric_ok = all(c['status'] == 'pass' for c in conds if c['id'] != '(i)-(n)')
    all_pass = all(c['status'] == 'pass' for c in conds)

    # 경간별 R
    reasons = []
    r_ins = None
    if not continuous:
        ti = insulation_in if insulation_in is not None else 0.0
        r_ins = 1.00 - 0.01 * ti
        if insulation_in is None:
            reasons.append(_nt('loads.reason.i621_insulation_not_given'))
    R_per_span = []
    real_idx = [i for i in range(len(spans)) if real_span[i]]
    for i in range(len(spans)):
        if not real_span[i]:
            R_per_span.append(None)
            continue
        if spans[i] > 33.0 or profile is None:
            R_per_span.append(None)
            continue
        use_simple = not continuous
        if continuous:
            k = real_idx.index(i)
            for nb in (k - 1, k + 1):
                if 0 <= nb < len(real_idx):
                    a_, b_ = spans[real_idx[nb]], spans[i]
                    if max(a_, b_) / min(a_, b_) > 1.20 + 1e-12:
                        use_simple = True
        Rv = _i621_table(profile, d, continuous and not use_simple)
        if not continuous:
            Rv = Rv * r_ins
        R_per_span.append(round(Rv, 4))
        if continuous and use_simple:
            reasons.append(_nt('loads.reason.i621_adjacent_spans_vary', span=i + 1))
    # I6.2.1: "shall not apply to a continuous beam for the region between inflection points
    # adjacent to a support or to a cantilever beam" — 빠지는 것은 내민(캔틸레버) 구간이지 보 전체가
    # 아니다. 내민 구간은 R_per_span None, 영역은 i621_region_eligible=False 로 뺀다.
    if any(not rs for rs in real_span):
        reasons.append(_nt('loads.reason.i621_cantilever'))

    eligible = [r for r, rs in zip(R_per_span, real_span) if rs]
    R_if_confirmed = None
    if geometric_ok and eligible and all(r is not None for r in eligible):
        R_if_confirmed = min(eligible)
    R = R_if_confirmed if all_pass else None
    if R is None:
        failed = [c['label'] for c in conds if c['status'] == 'fail']
        unver = [c['id'] for c in conds if c['status'] == 'unverified']
        if failed:
            reasons.append(_nt('loads.reason.i621_limits_not_met', items=_joined('; ', failed)))
        if unver:
            reasons.append(_nt('loads.reason.i621_not_verified', ids=', '.join(unver)))

    checks = [(c['label'], c['status'] == 'pass') for c in conds]
    return {
        'all_pass': all_pass, 'R': R, 'checks': checks, 'conditions': conds,
        'R_if_confirmed': R_if_confirmed, 'R_per_span': R_per_span,
        'insulation_r': r_ins, 'reasons': reasons,
        'span_type': 'continuous' if continuous else 'simple',
        'section_type': sec_type,
    }
