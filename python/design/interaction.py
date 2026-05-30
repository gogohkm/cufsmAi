"""조합 하중 상호작용 검토 — AISI S100-16 Chapter H"""

import math


def combined_axial_bending(P: float, Pa: float,
                           Mx: float, Max: float,
                           My: float = 0, May: float = 1e10) -> dict:
    """축력 + 휨 상호작용 검토 (§H1.2, Eq. H1.2-1)

    P/Pa + Mx/Max + My/May ≤ 1.0

    Args:
        P, Pa: 소요/허용 축력 (kips)
        Mx, Max: 소요/허용 x축 모멘트 (kip-in)
        My, May: 소요/허용 y축 모멘트 (kip-in)
    """
    P_ratio = abs(P) / Pa if Pa > 0 else 0
    Mx_ratio = abs(Mx) / Max if Max > 0 else 0
    My_ratio = abs(My) / May if May > 0 else 0
    total = P_ratio + Mx_ratio + My_ratio

    return {
        'P_ratio': round(P_ratio, 4),
        'Mx_ratio': round(Mx_ratio, 4),
        'My_ratio': round(My_ratio, 4),
        'total': round(total, 4),
        'pass': total <= 1.0,
        'equation': 'H1.2-1',
    }


def combined_bending_shear(M: float, Mao: float,
                           V: float, Va: float) -> dict:
    """휨 + 전단 상호작용 검토 (§H2, Eq. H2-1)

    (M/Mao)² + (V/Va)² ≤ 1.0
    """
    m2 = (M / Mao) ** 2 if Mao > 0 else 0
    v2 = (V / Va) ** 2 if Va > 0 else 0
    total = math.sqrt(m2 + v2)

    return {
        'M_ratio': round(math.sqrt(m2), 4),
        'V_ratio': round(math.sqrt(v2), 4),
        'total': round(total, 4),
        'pass': total <= 1.0,
        'equation': 'H2-1',
    }


def combined_bending_web_crippling(P: float, Pn: float,
                                    M: float, Mnfo: float,
                                    phi: float = 0.90,
                                    web_config: str = 'single',
                                    design_method: str = 'LRFD',
                                    omega: float = 1.70) -> dict:
    """휨 + 웹 크리플링 상호작용 검토 (§H3)

    web_config (force-coefficient / limit-coefficient / equation):
      'single'    → Eq. H3-1: 0.91(P/Pn) + (M/Mnfo) ≤ 1.33·(φ or 1/Ω)
      'multi_web' → Eq. H3-2: 0.88(P/Pn) + (M/Mnfo) ≤ 1.46·(φ or 1/Ω)
      'nested_z'  → Eq. H3-3: 0.86(P/Pn) + (M/Mnfo) ≤ 1.65·(φ or 1/Ω)

    The left-hand side (force-coefficient·P/Pn + M/Mnfo) is identical for
    ASD/LRFD/LSD and uses NOMINAL strengths Pn, Mnfo. Only the right-hand
    side limit differs by design method:
      LRFD/LSD → limit = limit_coef · φ
      ASD      → limit = limit_coef / Ω   (Ω = 1.70 for all three, §H3 spec)

    Args:
        P, Pn:   소요/공칭 집중하중(웹 크리플링) (kips)
        M, Mnfo: 소요/공칭 휨강도 (kip-in)
        phi:     LRFD/LSD 저항계수 (LRFD=0.90; LSD H3-1/H3-2=0.75, H3-3=0.80)
        web_config: 'single' | 'multi_web' | 'nested_z'
        design_method: 'LRFD' | 'LSD' | 'ASD'
        omega:   ASD 안전계수 (§H3 Eq. H3-1a/H3-2a/H3-3a 모두 Ω=1.70)
    """
    p_ratio = (P / Pn) if Pn > 0 else 0
    m_term = (M / Mnfo) if Mnfo > 0 else 0

    # §H3 force-coefficient / limit-coefficient / equation label per web config.
    if web_config == 'nested_z':
        # Eq. H3-3: two nested Z-shapes (AISI S100-16 §H3(c)).
        p_coef = 0.86
        limit_coef = 1.65
        eq = 'H3-3'
    elif web_config == 'multi_web':
        # Eq. H3-2: multiple unreinforced webs, e.g. back-to-back I (§H3(b)).
        p_coef = 0.88
        limit_coef = 1.46
        eq = 'H3-2'
    else:
        # Eq. H3-1: single unreinforced web (§H3(a)).
        p_coef = 0.91
        limit_coef = 1.33
        eq = 'H3-1'

    p_term = p_coef * p_ratio
    p_label = f'{p_coef:g}(P/Pn)'

    # RHS limit by design method (§H3: ASD uses Ω=1.70, LRFD/LSD use φ).
    method = str(design_method or 'LRFD').strip().upper()
    if method == 'ASD':
        # Conservative, spec-correct: Ω = 1.70 for Eq. H3-1a/H3-2a/H3-3a.
        limit = limit_coef / omega
    else:
        # LRFD/LSD: limit_coef · φ (φ supplied by caller; LRFD=0.90).
        limit = limit_coef * phi

    total = p_term + m_term

    return {
        'P_term': round(p_term, 4),
        'P_term_label': p_label,
        'M_term': round(m_term, 4),
        'total': round(total, 4),
        'limit': round(limit, 4),
        'pass': total <= limit,
        'equation': eq,
        'web_config': web_config,
        'design_method': method,
    }
