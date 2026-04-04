"""왜곡좌굴 매개변수 계산 — Appendix 2, Section 2.3.1.3

C-단면/Z-단면의 플랜지+립 기하 성질과
왜곡좌굴 탄성/기하학적 회전강성을 계산한다.
"""

import math

E_STEEL = 29500.0  # ksi
G_STEEL = 11300.0  # ksi
MU = 0.3           # Poisson's ratio


def calc_flange_properties(b: float, d: float, t: float,
                           theta: float = 90.0,
                           section_type: str = 'C') -> dict:
    """Table 2.3.1.3-1: 플랜지+립 기하 성질

    Parameters
    ----------
    b : 중심선 플랜지폭 = bo - t (in.)
    d : 중심선 립높이 = do - t/2 (in.)
    t : 두께 (in.)
    theta : 립 각도 (deg), C-section = 90°
    section_type : 'C' or 'Z'

    Returns
    -------
    dict with Af, Jf, Cwf, Ixf, Iyf, Ixyf, xof, hxf, yof
    """
    cos_th = math.cos(math.radians(theta))
    sin_th = math.sin(math.radians(theta))
    bd = b + d

    Af = bd * t
    Jf = (b * t ** 3 + d * t ** 3) / 3.0
    Cwf = 0.0

    if section_type.upper() == 'C':
        Ixf = t * (t ** 2 * b ** 2 + 4 * b * d ** 3 + t ** 2 * b * d + d ** 4) / (12 * bd)
        Iyf = t * (b ** 4 + 4 * d * b ** 3) / (12 * bd)
        Ixyf = t * b ** 2 * d ** 2 / (4 * bd)
        xof = b ** 2 / (2 * bd)
        hxf = -(b ** 2 + 2 * d * b) / (2 * bd)
        yof = -d ** 2 / (2 * bd)
    else:  # Z-section
        Ixf = t * (t ** 2 * b ** 2 + 4 * b * d ** 3 - 4 * b * d ** 3 * cos_th ** 2
                    + t ** 2 * b * d + d ** 4 - d ** 4 * cos_th ** 2) / (12 * bd)
        Iyf = t * (b ** 4 + 4 * d * b ** 3 + 6 * d ** 2 * b ** 2 * cos_th
                    + 4 * d ** 3 * b * cos_th ** 2 + d ** 4 * cos_th ** 2) / (12 * bd)
        Ixyf = t * b * d ** 2 * sin_th * (b + d * cos_th) / (4 * bd)
        xof = (b ** 2 - d ** 2 * cos_th) / (2 * bd)
        hxf = -(b ** 2 + 2 * d * b + d ** 2 * cos_th) / (2 * bd)
        yof = -d ** 2 * sin_th / (2 * bd)

    return {
        'Af': Af, 'Jf': Jf, 'Cwf': Cwf,
        'Ixf': Ixf, 'Iyf': Iyf, 'Ixyf': Ixyf,
        'xof': xof, 'hxf': hxf, 'yof': yof,
    }


def calc_Lcrd(ho: float, t: float, fp: dict,
              mu: float = MU, flexure: bool = False) -> float:
    """왜곡좌굴 반파장 Lcrd

    Compression: Eq. 2.3.1.3-7 (coeff=6, no ho^4 term)
    Flexure:     Eq. 2.3.3.3-4 (coeff=4, +π^4*ho^4/720 term)

    Parameters
    ----------
    ho : 웹 외-외 깊이 (in.)
    t : 두께 (in.)
    fp : 플랜지 성질 dict
    mu : 포아송비
    flexure : True이면 휨 공식 사용
    """
    xof = fp['xof']
    hxf = fp['hxf']
    Ixf = fp['Ixf']
    Cwf = fp['Cwf']
    Ixyf = fp['Ixyf']
    Iyf = fp['Iyf']

    dx = xof - hxf
    term1 = Ixf * dx ** 2 + Cwf
    term2 = (Ixyf ** 2 / Iyf) * dx ** 2 if Iyf > 1e-15 else 0

    if flexure:
        # Eq. 2.3.3.3-4
        coeff = 4.0
        inner = (coeff * math.pi ** 4 * ho * (1 - mu ** 2) / t ** 3) * (term1 - term2)
        inner += math.pi ** 4 * ho ** 4 / 720.0
    else:
        # Eq. 2.3.1.3-7
        coeff = 6.0
        inner = (coeff * math.pi ** 4 * ho * (1 - mu ** 2) / t ** 3) * (term1 - term2)

    if inner <= 0:
        return 20.0

    Lcrd = inner ** 0.25
    return Lcrd


def calc_distortional_stiffness(
    ho: float, t: float, fp: dict, L: float,
    xi_web: float = 0,
    E: float = E_STEEL, G: float = G_STEEL, mu: float = MU,
) -> dict:
    """왜곡좌굴 4개 회전강성항 계산

    Parameters
    ----------
    ho : 웹 외-외 깊이 (in.)
    t : 두께 (in.)
    fp : 플랜지 성질 dict
    L : min(Lcrd, Lm) (in.)
    xi_web : 0=압축, 2=순수휨 (bending about symmetric axis)
    E, G, mu : 재료 상수

    Returns
    -------
    dict with k_phi_fe, k_phi_we, k_tilde_phi_fg, k_tilde_phi_wg
    """
    pi = math.pi
    piL = pi / L if L > 1e-10 else 0
    piL2 = piL ** 2
    piL4 = piL ** 4

    xof = fp['xof']
    hxf = fp['hxf']
    dx = xof - hxf

    Ixf = fp['Ixf']
    Iyf = fp['Iyf']
    Ixyf = fp['Ixyf']
    Cwf = fp['Cwf']
    Jf = fp['Jf']
    Af = fp['Af']
    yof = fp['yof']

    # kφfe — 플랜지 탄성 회전강성 (Eq. 2.3.1.3-3)
    term_a = E * Ixf * dx ** 2 + E * Cwf
    term_b = E * (Ixyf ** 2 / Iyf) * dx ** 2 if Iyf > 1e-15 else 0
    k_phi_fe = piL4 * (term_a - term_b) + piL2 * G * Jf

    # kφwe — 웹 탄성 회전강성
    if xi_web == 0:
        # 압축 (Eq. 2.3.1.3-4)
        k_phi_we = E * t ** 3 / (6.0 * ho * (1 - mu ** 2))
    else:
        # 휨 (Eq. 2.3.3.3-5)
        k_phi_we = (E * t ** 3 / (12.0 * (1 - mu ** 2))) * (
            3.0 / ho + piL2 * 19.0 * ho / 60.0 + piL4 * ho ** 3 / 240.0
        )

    # k̃φfg — 플랜지 기하학적 회전강성 (Eq. 2.3.1.3-5)
    Ixy_Iy = Ixyf / Iyf if Iyf > 1e-15 else 0
    r1 = dx ** 2 * Ixy_Iy ** 2
    r2 = 2.0 * yof * dx * Ixy_Iy
    r3 = hxf ** 2 + yof ** 2
    k_tilde_phi_fg = piL2 * (Af * (r1 - r2 + r3) + Ixf + Iyf)

    # k̃φwg — 웹 기하학적 회전강성
    if xi_web == 0:
        # 압축 (Eq. 2.3.1.3-6)
        k_tilde_phi_wg = piL2 * t * ho ** 3 / 60.0
    else:
        # 휨 (Eq. 2.3.3.3-6)
        LH = L / ho if ho > 1e-10 else 0
        HL = ho / L if L > 1e-10 else 0
        num = ((45360 * (1 - xi_web) + 62160) * LH ** 2
               + 448 * pi ** 2
               + HL ** 2 * (53 + 3 * (1 - xi_web)) * pi ** 4)
        den = pi ** 4 + 28 * pi ** 2 * LH ** 2 + 420 * LH ** 4
        k_tilde_phi_wg = ho * t * pi ** 2 / 13440.0 * (num / den) if den > 1e-15 else 0

    return {
        'k_phi_fe': k_phi_fe,
        'k_phi_we': k_phi_we,
        'k_tilde_phi_fg': k_tilde_phi_fg,
        'k_tilde_phi_wg': k_tilde_phi_wg,
    }


def calc_Fcrd(fp: dict, ho: float, t: float,
              kphi_external: float = 0.0,
              beta: float = 1.0,
              xi_web: float = 0,
              Lm: float = None,
              E: float = E_STEEL, G: float = G_STEEL, mu: float = MU) -> dict:
    """왜곡좌굴 임계응력 Fcrd 통합 계산

    Parameters
    ----------
    fp : 플랜지 성질 (from calc_flange_properties)
    ho : 웹 외-외 깊이 (in.)
    t : 두께 (in.)
    kphi_external : 외부 회전강성 (패널/브레이싱), kip-in./rad/in.
    beta : 모멘트 구배 보정 (1.0~1.3)
    xi_web : 0=압축, 2=순수휨
    Lm : 비지지길이 (in.), None이면 Lcrd 사용

    Returns
    -------
    dict with Fcrd, Lcrd, stiffness terms, beta
    """
    is_flexure = (xi_web != 0)
    Lcrd = calc_Lcrd(ho, t, fp, mu, flexure=is_flexure)
    L = min(Lcrd, Lm) if Lm is not None else Lcrd

    stiff = calc_distortional_stiffness(ho, t, fp, L, xi_web, E, G, mu)

    denom = stiff['k_tilde_phi_fg'] + stiff['k_tilde_phi_wg']
    if denom < 1e-15:
        Fcrd = 0.0
    else:
        Fcrd = beta * (stiff['k_phi_fe'] + stiff['k_phi_we'] + kphi_external) / denom

    return {
        'Fcrd': Fcrd,
        'Lcrd': round(Lcrd, 1),
        'L_used': round(L, 1),
        'beta': beta,
        'k_phi_fe': round(stiff['k_phi_fe'], 4),
        'k_phi_we': round(stiff['k_phi_we'], 4),
        'k_tilde_phi_fg': round(stiff['k_tilde_phi_fg'], 5),
        'k_tilde_phi_wg': round(stiff['k_tilde_phi_wg'], 5),
        'kphi_external': kphi_external,
    }
