"""전단 강도 및 웹 크리플링 — AISI S100-16 Chapters G2, G5"""

import math

from design.steel_grades import E as E_STEEL


def shear_strength(h: float, t: float, Fy: float,
                   E: float = E_STEEL, kv: float = 5.34) -> dict:
    """웹 전단 강도 (§G2.1, 횡보강재 없음)

    Args:
        h: 웹 평면폭 (in)
        t: 웹 두께 (in)
        Fy: 항복강도 (ksi)
        kv: 전단좌굴 계수 (기본 5.34)
    """
    Vy = 0.60 * Fy * h * t
    Vcr = (math.pi ** 2 * E * kv) / (12 * (1 - 0.3 ** 2)) * (t / h) ** 2 * h * t

    if Vy <= 0:
        return {'Vn': 0, 'lambda_v': 0, 'equation': 'G2-1'}

    lam_v = math.sqrt(Vy / Vcr) if Vcr > 0 else float('inf')

    if lam_v <= 0.815:
        Vn = Vy
        eq = 'G2.1 (yielding)'
    elif lam_v <= 1.227:
        Vn = 0.815 * math.sqrt(Vcr * Vy)
        eq = 'G2.1 (inelastic)'
    else:
        Vn = Vcr
        eq = 'G2.1 (elastic)'

    return {
        'Vn': Vn,
        'Vy': Vy,
        'Vcr': Vcr,
        'lambda_v': lam_v,
        'equation': eq,
    }


# ============================================================
# 웹 크리플링 (§G5)
# ============================================================

# Table G5-3 계수 (단일 비보강 웹, C/Z 형강)
_WC_COEFFS = {
    # (support, load_case): (C, Cr, CN, Ch)
    # EOF = End One-Flange, IOF = Interior One-Flange
    # ETF = End Two-Flange,  ITF = Interior Two-Flange
    ('EOF', 'fastened'): (4.0, 0.14, 0.35, 0.02),
    ('EOF', 'unfastened'): (4.0, 0.14, 0.35, 0.02),
    ('IOF', 'fastened'): (13.0, 0.23, 0.14, 0.01),
    ('IOF', 'unfastened'): (13.0, 0.23, 0.14, 0.01),
    ('ETF', 'fastened'): (6.9, 0.06, 0.16, 0.05),
    ('ETF', 'unfastened'): (6.9, 0.06, 0.16, 0.05),
    ('ITF', 'fastened'): (13.0, 0.32, 0.05, 0.04),
    ('ITF', 'unfastened'): (13.0, 0.32, 0.05, 0.04),
}

# φ and Ω per load case
_WC_FACTORS = {
    'EOF': {'phi': 0.85, 'omega': 1.76},
    'IOF': {'phi': 0.90, 'omega': 1.65},
    'ETF': {'phi': 0.75, 'omega': 2.00},
    'ITF': {'phi': 0.90, 'omega': 1.65},
}


def web_crippling(h: float, t: float, R: float, N: float,
                  Fy: float, theta: float = 90,
                  support: str = 'EOF',
                  fastened: str = 'fastened') -> dict:
    """웹 크리플링 강도 (§G5, Eq. G5-1)

    Pn = C × t² × sin(θ) × (1 - Cr√(R/t)) × (1 + CN√(N/t)) × (1 - Ch√(h/t)) × √(E×Fy)

    Args:
        h: 웹 평면폭 (in)
        t: 웹 두께 (in)
        R: 내측 굽힘 반경 (in)
        N: 지압 길이 (in)
        Fy: 항복강도 (ksi)
        theta: 웹과 지압면 사이 각도 (deg, 기본 90)
        support: 'EOF' | 'IOF' | 'ETF' | 'ITF'
        fastened: 'fastened' | 'unfastened'

    Returns:
        dict: {Pn, phi, omega, equation, ...}
    """
    key = (support.upper(), fastened.lower())
    coeffs = _WC_COEFFS.get(key)
    if coeffs is None:
        return {'error': f'Unknown web crippling case: {key}'}

    C, Cr, CN, Ch = coeffs
    factors = _WC_FACTORS[support.upper()]

    theta_rad = math.radians(theta)
    sin_theta = math.sin(theta_rad)

    Rt = math.sqrt(R / t) if R > 0 and t > 0 else 0
    Nt = math.sqrt(N / t) if N > 0 and t > 0 else 0
    ht = math.sqrt(h / t) if h > 0 and t > 0 else 0

    term1 = 1 - Cr * Rt
    term2 = 1 + CN * Nt
    term3 = 1 - Ch * ht

    # 각 항이 음수가 되지 않도록
    term1 = max(term1, 0)
    term3 = max(term3, 0)

    Pn = C * t ** 2 * Fy * sin_theta * term1 * term2 * term3

    return {
        'Pn': round(Pn, 3),
        'phi': factors['phi'],
        'omega': factors['omega'],
        'support': support.upper(),
        'fastened': fastened.lower(),
        'equation': 'G5-1',
        'formula': (f'Pn = {C}×t²×Fy×sin({theta}°)'
                    f'×(1-{Cr}√(R/t))×(1+{CN}√(N/t))×(1-{Ch}√(h/t))'
                    f' = {Pn:.3f} kips'),
        'spec_sections': ['G5'],
    }
