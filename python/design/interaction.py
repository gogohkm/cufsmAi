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
                                    phi: float = 0.75) -> dict:
    """휨 + 웹 크리플링 상호작용 검토 (§H3, Eq. H3-1)

    0.91(P/Pn) + (M/Mnfo) ≤ 1.33φ  (단일 비보강 웹)
    """
    p_term = 0.91 * (P / Pn) if Pn > 0 else 0
    m_term = (M / Mnfo) if Mnfo > 0 else 0
    total = p_term + m_term
    limit = 1.33 * phi

    return {
        'P_term': round(p_term, 4),
        'M_term': round(m_term, 4),
        'total': round(total, 4),
        'limit': round(limit, 4),
        'pass': total <= limit,
        'equation': 'H3-1',
    }
