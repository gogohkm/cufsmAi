"""전체 좌굴 계산 — AISI S100-16 Chapters E2, F2

유연좌굴, 비틀림좌굴, 휨-비틀림좌굴, 횡-비틀림좌굴 임계응력 계산.
"""

import math

from design.steel_grades import E as E_STEEL, G as G_STEEL


# ============================================================
# 압축 — Chapter E2
# ============================================================

def column_global_strength(Fy: float, Fcre: float, Ag: float) -> dict:
    """전체좌굴 압축강도 (§E2)

    Args:
        Fy: 항복강도 (ksi)
        Fcre: 탄성 전체좌굴 임계응력 (ksi)
        Ag: 총단면적 (in²)
    """
    if Fcre <= 0:
        return {'Pne': 0, 'Fn': 0, 'lambda_c': float('inf'), 'equation': 'E2 (Fcre=0)'}

    lam_c = math.sqrt(Fy / Fcre)

    if lam_c <= 1.5:
        Fn = (0.658 ** (lam_c ** 2)) * Fy
        eq = 'E2-2'
    else:
        Fn = (0.877 / lam_c ** 2) * Fy
        eq = 'E2-3'

    Pne = Ag * Fn
    return {'Pne': Pne, 'Fn': Fn, 'lambda_c': lam_c, 'Fcre': Fcre, 'equation': eq}


def flexural_buckling_stress(E: float, K: float, L: float, r: float) -> float:
    """유연좌굴 임계응력 (§E2.1)

    Returns: Fcre (ksi)
    """
    if r <= 0 or L <= 0:
        return 0.0
    return math.pi ** 2 * E / (K * L / r) ** 2


def torsional_buckling_stress(E: float, G: float, Ag: float,
                               J: float, Cw: float, ro: float,
                               Kt: float, Lt: float) -> float:
    """비틀림좌굴 임계응력 σt (§E2.1)"""
    if Ag <= 0 or ro <= 0:
        return 0.0
    return (1 / (Ag * ro ** 2)) * (G * J + math.pi ** 2 * E * Cw / (Kt * Lt) ** 2)


def flexural_torsional_stress(sigma_ex: float, sigma_t: float,
                               xo: float, ro: float) -> float:
    """휨-비틀림좌굴 임계응력 (§E2.2, 단축대칭 단면)"""
    if ro <= 0:
        return 0.0
    beta = 1 - (xo / ro) ** 2
    if beta <= 0:
        return min(sigma_ex, sigma_t)

    disc = (sigma_ex + sigma_t) ** 2 - 4 * beta * sigma_ex * sigma_t
    if disc < 0:
        disc = 0
    return (1 / (2 * beta)) * ((sigma_ex + sigma_t) - math.sqrt(disc))


def compute_column_Fcre(props: dict, Fy: float,
                        KxLx: float, KyLy: float, KtLt: float,
                        E: float = E_STEEL, G: float = G_STEEL) -> dict:
    """단면 성질로부터 압축 Fcre 계산 (§E2)

    Args:
        props: {A, Ixx, Izz, J, Cw, xcg, zcg, rx, ry, xo, ro, ...}
              (get_section_properties + get_cutwp 결과)
    """
    Ag = props.get('A', 0)
    rx = props.get('rx', 0) or (math.sqrt(props.get('Ixx', 0) / Ag) if Ag > 0 else 0)
    ry = props.get('ry', 0) or (math.sqrt(props.get('Izz', 0) / Ag) if Ag > 0 else 0)
    J = props.get('J', 0)
    Cw = props.get('Cw', 0)
    xo = abs(props.get('xo', 0))
    ro = props.get('ro', 0)

    if ro <= 0 and Ag > 0:
        ro = math.sqrt(rx ** 2 + ry ** 2 + xo ** 2)

    # 유연좌굴 응력
    sigma_ex = flexural_buckling_stress(E, 1.0, KxLx, rx) if rx > 0 else 1e10
    sigma_ey = flexural_buckling_stress(E, 1.0, KyLy, ry) if ry > 0 else 1e10

    # 비틀림좌굴 응력
    sigma_t = torsional_buckling_stress(E, G, Ag, J, Cw, ro, 1.0, KtLt)

    # 대칭 여부 판정 (xo ≈ 0이면 이중대칭 또는 폐합단면)
    if abs(xo) < 1e-6:
        # 이중대칭: min(σex, σey, σt)
        Fcre = min(sigma_ex, sigma_ey, sigma_t)
        buckling_type = 'flexural' if Fcre in (sigma_ex, sigma_ey) else 'torsional'
    else:
        # 단축대칭: 휨-비틀림좌굴
        Fcre_ft = flexural_torsional_stress(sigma_ex, sigma_t, xo, ro)
        Fcre = min(sigma_ey, Fcre_ft)
        buckling_type = 'flexural' if Fcre == sigma_ey else 'flexural-torsional'

    return {
        'Fcre': Fcre,
        'sigma_ex': sigma_ex,
        'sigma_ey': sigma_ey,
        'sigma_t': sigma_t,
        'buckling_type': buckling_type,
        'ro': ro,
    }


# ============================================================
# 휨 — Chapter F2
# ============================================================

def beam_global_strength(Fy: float, Fcre: float, Sf: float,
                          Zf: float = 0, use_inelastic_reserve: bool = False) -> dict:
    """전체좌굴(LTB) 휨강도 (§F2, §F2.4.2 Inelastic Reserve)

    Args:
        Fy: 항복강도 (ksi)
        Fcre: 횡-비틀림좌굴 임계응력 (ksi)
        Sf: 총단면 단면계수 (in³)
        Zf: 소성단면계수 (in³) — Inelastic Reserve 적용 시 필요
        use_inelastic_reserve: True면 §F2.4.2 적용
    """
    import math
    My = Sf * Fy

    if Fcre <= 0:
        return {'Mne': 0, 'Fn': 0, 'My': My, 'equation': 'F2 (Fcre=0)',
                'inelastic_reserve': False}

    # §F2.1 기본 (Mne ≤ My)
    if Fcre >= 2.78 * Fy:
        Fn = Fy
        eq = 'F2-1 (yielding)'
    elif Fcre > 0.56 * Fy:
        Fn = (10.0 / 9.0) * Fy * (1 - 10.0 * Fy / (36.0 * Fcre))
        eq = 'F2-1 (inelastic LTB)'
    else:
        Fn = Fcre
        eq = 'F2-1 (elastic LTB)'

    Mne = Sf * Fn
    inelastic_applied = False

    # §F2.4.2 Inelastic Reserve (DSM)
    # 조건: Mcre > 2.78 × My, Zf > 0
    if use_inelastic_reserve and Zf > 0:
        Mcre = Sf * Fcre
        Mp = Zf * Fy

        if Mcre > 2.78 * My:
            # Eq. F2.4.2-1
            ratio = math.sqrt(My / Mcre)
            Mne_ir = Mp - (Mp - My) * (ratio - 0.23) / 0.37
            Mne_ir = min(Mne_ir, Mp)  # ≤ Mp
            Mne_ir = max(Mne_ir, My)  # ≥ My (안전)

            if Mne_ir > Mne:
                Mne = Mne_ir
                Fn = Mne / Sf if Sf > 0 else Fy
                eq = f'F2.4.2-1 (inelastic reserve, Mp={Mp:.2f})'
                inelastic_applied = True

    return {'Mne': Mne, 'Fn': Fn, 'My': My, 'Fcre': Fcre, 'equation': eq,
            'inelastic_reserve': inelastic_applied,
            'Mp': Zf * Fy if Zf > 0 else 0}


def compute_beam_Fcre(props: dict, Cb: float, Lb: float,
                       E: float = E_STEEL, G: float = G_STEEL) -> float:
    """횡-비틀림좌굴 임계응력 Fcre (§F2.1)

    Fcre = Cb * ro * A / Sf * sqrt(sigma_ey * sigma_t)

    props 키 호환: Sf/Sxx/Sx, ry/rz, J, Cw, xo/Xs/xcg, ro
    """
    Ag = props.get('A', 0)

    # Sf — 여러 키 이름 호환
    Sf = props.get('Sf', 0) or props.get('Sxx', 0) or props.get('Sx', 0)

    # ry — 약축 회전반경 (냉간성형강: z축이 약축)
    ry = props.get('ry', 0) or props.get('rz', 0)

    # J, Cw — cutwp에서 계산된 값
    J = props.get('J', 0)
    Cw = props.get('Cw', 0)

    # xo — 전단중심 편심 (도심~전단중심 거리)
    xo = abs(props.get('xo', 0))
    if xo == 0:
        # Xs(전단중심 x좌표)와 xcg(도심 x좌표)에서 계산
        Xs = props.get('Xs', 0)
        xcg = props.get('xcg', 0)
        if Xs != 0 or xcg != 0:
            xo = abs(Xs - xcg)

    # ro — 극관성반경 (전단중심 기준)
    # ro² = rx² + ry² + xo²  (단축대칭 단면)
    ro = props.get('ro', 0)
    if ro <= 0:
        rx = props.get('rx', 0)
        if rx > 0 and ry > 0:
            ro = math.sqrt(rx ** 2 + ry ** 2 + xo ** 2)

    if Ag <= 0 or Sf <= 0 or ry <= 0 or ro <= 0:
        return 0.0

    # Lb가 0이면 완전 구속 → Fcre = 매우 큰 값
    if Lb <= 0:
        return 1e6

    sigma_ey = math.pi ** 2 * E / (Lb / ry) ** 2
    sigma_t = (1 / (Ag * ro ** 2)) * (G * J + math.pi ** 2 * E * Cw / Lb ** 2)

    if sigma_ey <= 0 or sigma_t <= 0:
        return 0.0

    Fcre = Cb * ro * Ag / Sf * math.sqrt(sigma_ey * sigma_t)
    return Fcre
