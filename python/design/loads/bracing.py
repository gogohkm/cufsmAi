"""데크/패널 강성 계산, 비지지길이 결정, 모멘트구배계수, 양력 R 검증

Sections:
  - kφ (rotational stiffness) — Chen & Moen 2011
  - kx (lateral stiffness) — AISI RP17-2
  - Cb (moment gradient factor) — ASCE 7 / AISI F2.1.1-2
  - β (distortional buckling gradient) — Appendix 2, Eq. 2.3.3.3-3
  - R (uplift reduction factor) — Section I6.2.1
"""

import math
from typing import List, Optional

E_STEEL = 29500.0  # ksi
G_STEEL = 11300.0  # ksi


# ---------------------------------------------------------------------------
# 패널 회전강성 kφ (Chen & Moen 2011, Example II-1C)
# ---------------------------------------------------------------------------

def calc_rotational_stiffness(
    t_panel: float,
    t_purlin: float,
    fastener_spacing: float = 12.0,
    flange_width: float = 2.5,
    k_per_fastener: float = 1.77,
    E: float = E_STEEL,
) -> float:
    """패널-퍼린 연결의 회전강성 kφ 추정 (Chen & Moen 2011 기반)

    NOTE: 이 값은 근사치. 정확한 값은 AISI S901 ���험 또는 kphi_override 사용.
    예제 참고값: through-fastened 0.05~0.30, standing-seam 0.002~0.01

    Parameters
    ----------
    t_panel : 패널 두께 (in.)
    t_purlin : 퍼린 두께 (in.)
    fastener_spacing : 패스너 간격 (in.), 기본 12
    flange_width : 플랜지 폭 (in.)
    k_per_fastener : 패스너당 비틀림 강성 (kip/in./fastener), 기본 1.77
    E : 탄성계수 (ksi)

    Returns
    -------
    kφ in kip-in./rad/in.
    """
    c = flange_width / 2.0
    k = k_per_fastener / fastener_spacing
    # Example II-1C: I = t_purlin^3/12 (purlin thickness for conservative I)
    I_panel = t_purlin ** 3 / 12.0

    denom1 = k * c ** 2
    denom2 = 3.0 * E * I_panel * c ** 2
    if denom1 < 1e-15 or denom2 < 1e-15:
        return 0.0

    kphi = 1.0 / (1.0 / denom1 + c ** 3 / denom2)
    return kphi


# ---------------------------------------------------------------------------
# 패널 횡강성 kx (AISI RP17-2, Example II-1C)
# ---------------------------------------------------------------------------

def calc_lateral_stiffness(
    t_panel: float,
    t_purlin: float,
    fastener_spacing: float = 12.0,
    E: float = E_STEEL,
    **_kwargs,
) -> float:
    """패널-퍼린 연결의 횡강성 kx 추정 (2-ply 직렬스프링 × 경험적 감소)

    NOTE: 정확한 kx는 AISI S917 시험 또는 MASTAN2 모델링으로 결정해야 함.
    이 함수는 2-ply 직렬스프링 근사치에 경험적 감소(4%)를 적용한 추정치.
    Example II-1C 참고: kx = 1.28 kip/in./in.
    전체 RP17-2 공식(Pss, d_screw 등)은 미구현 — 추정치만 제공.

    Returns
    -------
    kx in kip/in./in.
    """
    t1 = t_panel
    t2 = t_purlin

    # 2-ply 축강성 (직렬 스프링), per fastener
    kx_per_fastener = 1.0 / (1.0 / (E * t1) + 1.0 / (E * t2))

    # 단위 길이당 (패스너 간격으로 나눔)
    kx = kx_per_fastener / fastener_spacing

    # 경험적 감소 (패스너 유연성, 패널 유연성 고려)
    # RP17-2 시험 결과 실제 kx는 이론값의 약 3~5% 수준
    reduction = 0.04
    kx_effective = kx * reduction

    return kx_effective


# ---------------------------------------------------------------------------
# 모멘트 구배계수 Cb (AISI Eq. F2.1.1-2)
# ---------------------------------------------------------------------------

def calc_Cb(M_max: float, M_A: float, M_B: float, M_C: float) -> float:
    """횡-비틀림좌굴 모멘트 구배계수

    Parameters (all absolute values of moments in unbraced segment)
    ----------
    M_max : 구간 내 최대 모멘트 |M|
    M_A : 1/4점 모멘트 |M|
    M_B : 중앙점 모멘트 |M|
    M_C : 3/4점 모멘트 |M|

    Returns
    -------
    Cb (≥ 1.0)
    """
    denom = 2.5 * M_max + 3.0 * M_A + 4.0 * M_B + 3.0 * M_C
    if denom < 1e-15:
        return 1.0
    Cb = 12.5 * M_max / denom
    return max(Cb, 1.0)


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


# ---------------------------------------------------------------------------
# 왜곡좌굴 구배보정 β (Appendix 2, Eq. 2.3.3.3-3)
# ---------------------------------------------------------------------------

def calc_beta_distortional(Lcrd: float, Lm: float,
                           M1: float, M2: float) -> float:
    """왜곡좌굴 모멘트 구배 보정계수

    Parameters
    ----------
    Lcrd : 왜곡좌굴 반파장 (in.)
    Lm : 비지지길이 (in.) — 랩 끝~변곡점
    M1 : 구간 시작점 모멘트 (보통 0, 변곡점)
    M2 : 구간 끝점 모멘트

    Returns
    -------
    β (1.0 ≤ β ≤ 1.3)
    """
    L = min(Lcrd, Lm)
    if Lm < 1e-10 or abs(M2) < 1e-10:
        return 1.0

    beta = 1.0 + 0.4 * (L / Lm) ** 0.7 * (1.0 + abs(M1 / M2)) ** 0.7
    return max(1.0, min(beta, 1.3))


# ---------------------------------------------------------------------------
# 비지지길이 자동 결정
# ---------------------------------------------------------------------------

def determine_unbraced_lengths(
    M_diagram: list,
    x_diagram: list,
    spans: list,
    laps: dict = None,
    deck_type: str = 'through-fastened',
) -> dict:
    """모멘트 다이어그램과 지지조건으로부터 정/부모멘트 영역별 비지지길이를 결정

    Returns
    -------
    dict with:
        'positive_regions': [{start, end, Ly, Lt, Cb, braced}]
        'negative_regions': [{start, end, Ly, Lt, Cb, Lm}]
    """
    # 변곡점 찾기
    inflections = []
    for i in range(len(M_diagram) - 1):
        if M_diagram[i] * M_diagram[i + 1] < 0:
            x_zero = x_diagram[i] - M_diagram[i] * (x_diagram[i + 1] - x_diagram[i]) / (M_diagram[i + 1] - M_diagram[i])
            inflections.append(x_zero)

    # 지점 위치
    supports = [0.0]
    offset = 0.0
    for s in spans:
        offset += s
        supports.append(offset)

    # 랩 끝 위치
    lap_ends = []
    if laps and len(spans) > 1:
        lap_left = laps.get('left_ft', 0)
        lap_right = laps.get('right_ft', 0)
        for j in range(1, len(supports) - 1):
            sup = supports[j]
            if lap_right > 0:
                lap_ends.append(sup - lap_right)
            if lap_left > 0:
                lap_ends.append(sup + lap_left)

    positive_regions = []
    negative_regions = []

    # 정모멘트 영역: 변곡점 사이 또는 지점~변곡점 (M > 0)
    # 부모멘트 영역: 변곡점~랩끝 또는 변곡점~지점 (M < 0)

    if deck_type in ('through-fastened', 'standing-seam'):
        # 정모멘트: 상부 플랜지 압축 → 데크가 연속 횡지지
        for i, x in enumerate(x_diagram):
            if M_diagram[i] > 0:
                positive_regions.append({
                    'x': x, 'Ly': 0, 'Lt': 0, 'braced': True,
                })
                break  # 대표 하나만

        # 부모멘트: 하부 플랜지 압축 → 비지지
        # 비지지길이 = 랩끝 ~ 변곡점
        for j in range(1, len(supports) - 1):
            sup = supports[j]
            # 좌측: sup - lap_right ~ 가장 가까운 좌측 변곡점
            lap_right = laps.get('right_ft', 0) if laps else 0
            lap_left = laps.get('left_ft', 0) if laps else 0

            brace_start_left = sup - lap_right if lap_right > 0 else sup
            closest_infl_left = None
            for ip in inflections:
                if ip < brace_start_left:
                    closest_infl_left = ip

            if closest_infl_left is not None:
                Ly = (brace_start_left - closest_infl_left) * 12.0  # ft→in.
                Cb_val = calc_Cb_from_diagram(M_diagram, x_diagram,
                                              closest_infl_left, brace_start_left)
                negative_regions.append({
                    'support': j, 'side': 'left',
                    'start_ft': closest_infl_left,
                    'end_ft': brace_start_left,
                    'Ly_in': round(Ly, 1),
                    'Lt_in': round(Ly, 1),
                    'Cb': round(Cb_val, 2),
                })

            # 우측
            brace_start_right = sup + lap_left if lap_left > 0 else sup
            closest_infl_right = None
            for ip in inflections:
                if ip > brace_start_right:
                    closest_infl_right = ip
                    break

            if closest_infl_right is not None:
                Ly = (closest_infl_right - brace_start_right) * 12.0
                Cb_val = calc_Cb_from_diagram(M_diagram, x_diagram,
                                              brace_start_right, closest_infl_right)
                negative_regions.append({
                    'support': j, 'side': 'right',
                    'start_ft': brace_start_right,
                    'end_ft': closest_infl_right,
                    'Ly_in': round(Ly, 1),
                    'Lt_in': round(Ly, 1),
                    'Cb': round(Cb_val, 2),
                })

    return {
        'positive_regions': positive_regions,
        'negative_regions': negative_regions,
        'inflection_points_ft': [round(ip, 2) for ip in inflections],
        'supports_ft': supports,
        'lap_ends_ft': [round(le, 2) for le in lap_ends],
    }


# ---------------------------------------------------------------------------
# 양력 감소계수 R (Section I6.2.1)
# ---------------------------------------------------------------------------

def check_i621_conditions(
    section: dict,
    Fy: float,
    Fu: float,
    span_ft: float,
    span_type: str = 'continuous',
    lap_length_in: float = None,
) -> dict:
    """Section I6.2.1 양력 감소계수 R 적용조건 검증

    Parameters
    ----------
    section : dict with keys:
        depth, flange_width, thickness, lip_depth, R_corner, type ('C'/'Z')
    Fy, Fu : ksi
    span_ft : 스팬 길이 (ft)
    span_type : 'simple' or 'continuous'
    lap_length_in : 연속스팬 시 랩 길이 (in.)

    Returns
    -------
    dict with 'all_pass', 'R', 'checks'
    """
    d = section.get('depth', 0)
    b = section.get('flange_width', 0)
    t = section.get('thickness', 0)
    lip = section.get('lip_depth', 0)
    R_corner = section.get('R_corner', 0.1875)
    sec_type = section.get('type', 'C').upper()
    flat_b = b - 2.0 * (t + R_corner) if t > 0 else 0

    checks = []
    checks.append(('(a) d ≤ 12 in.', d <= 12.0))
    checks.append(('(b) has lip stiffener', lip > 0))
    checks.append(('(c) 60 ≤ d/t ≤ 170', 60 <= d / t <= 170 if t > 0 else False))
    checks.append(('(d) 2.8 ≤ d/b ≤ 5.5', 2.8 <= d / b <= 5.5 if b > 0 else False))
    checks.append(('(e) b ≥ 2.125 in.', b >= 2.125))
    checks.append(('(f) 16 ≤ flat_b/t ≤ 43', 16 <= flat_b / t <= 43 if t > 0 else False))

    if span_type == 'continuous' and lap_length_in is not None:
        checks.append(('(g) lap ≥ 1.5d', lap_length_in >= 1.5 * d))
    else:
        checks.append(('(g) lap length (N/A for simple)', True))

    checks.append(('(h) span ≤ 33 ft', span_ft <= 33))
    checks.append(('(o) Fu/Fy ≥ 1.08', Fu / Fy >= 1.08 if Fy > 0 else False))

    all_pass = all(c[1] for c in checks)

    R = None
    if all_pass:
        if span_type == 'continuous':
            R = 0.60 if sec_type == 'C' else 0.70
        else:
            if d <= 6.5:
                R = 0.70
            elif d <= 8.5:
                R = 0.65
            else:
                R = 0.40 if sec_type == 'C' else 0.50

    return {'all_pass': all_pass, 'R': R, 'checks': checks,
            'span_type': span_type, 'section_type': sec_type}
