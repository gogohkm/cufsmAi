"""AISI S100 특수 주제

§D3: Shear Lag (전단지연)
§D5: Block Shear (블록 전단)
§A7.2: Cold Work of Forming (냉간가공 효과)
§C3.1.4: Flange Curling (플랜지 컬링)
"""

import math


def shear_lag(Ag: float, An_net: float, x_bar: float, L_conn: float,
              Fu: float, Fy: float, design_method: str = 'LRFD') -> dict:
    """전단지연 계수 및 유효 순단면적 (§D3, Eq. D3-1)

    인장 부재에서 접합부가 전체 단면을 연결하지 않을 때
    비균일 응력 분포를 반영하는 감소계수

    Args:
        Ag: 총단면적 (in²)
        An_net: 순단면적 (구멍 제외) (in²)
        x_bar: 접합 평면으로부터 비접합 요소의 도심 거리 (in)
        L_conn: 접합부 길이 (in)
        Fu: 인장강도 (ksi)
        Fy: 항복강도 (ksi)
        design_method: 'LRFD' or 'ASD'

    Returns:
        dict: {U, Ae, Tn_yield, Tn_rupture, Tn, phi_Tn, pass, steps}
    """
    # Shear lag coefficient (Eq. D3-1)
    if L_conn > 0:
        U = min(1.0, 1.0 - x_bar / L_conn)
    else:
        U = 1.0

    U = max(U, 0.0)

    # Effective net area
    Ae = An_net * U

    # Tensile strength
    Tn_yield = Ag * Fy        # §D2.1 Yielding
    Tn_rupture = Ae * Fu      # §D3 Rupture with shear lag

    Tn = min(Tn_yield, Tn_rupture)

    phi = 0.90 if design_method == 'LRFD' else None
    omega = 1.67 if design_method == 'ASD' else None
    phi_Tn = phi * Tn if phi else Tn / omega

    governing = 'Yielding (§D2)' if Tn == Tn_yield else 'Rupture with shear lag (§D3)'

    return {
        'U': round(U, 4),
        'Ae': round(Ae, 4),
        'An_net': round(An_net, 4),
        'Tn_yield': round(Tn_yield, 3),
        'Tn_rupture': round(Tn_rupture, 3),
        'Tn': round(Tn, 3),
        'phi_Tn': round(phi_Tn, 3),
        'governing': governing,
        'steps': [
            {'name': 'Shear Lag Coefficient', 'formula': f'U = 1 - x̄/L = 1 - {x_bar:.3f}/{L_conn:.3f} = {U:.4f}'},
            {'name': 'Effective Net Area', 'formula': f'Ae = An × U = {An_net:.4f} × {U:.4f} = {Ae:.4f} in²'},
            {'name': 'Yield Strength', 'formula': f'Tn_yield = Ag × Fy = {Ag:.4f} × {Fy:.1f} = {Tn_yield:.3f} kips'},
            {'name': 'Rupture Strength', 'formula': f'Tn_rupture = Ae × Fu = {Ae:.4f} × {Fu:.1f} = {Tn_rupture:.3f} kips'},
        ],
    }


def block_shear(Agv: float, Anv: float, Ant: float,
                Fy: float, Fu: float,
                design_method: str = 'LRFD') -> dict:
    """블록 전단 파단 강도 (§J7, Eq. J7-1)

    Args:
        Agv: 전단면 총면적 (in²)
        Anv: 전단면 순면적 (in²)
        Ant: 인장면 순면적 (in²)
        Fy: 항복강도 (ksi)
        Fu: 인장강도 (ksi)

    Returns:
        dict: {Rn, phi_Rn, steps}
    """
    # Eq. J7-1: Rn = min(0.6Fy×Agv + Fu×Ant, 0.6Fu×Anv + Fu×Ant)
    Rn1 = 0.6 * Fy * Agv + Fu * Ant  # Yield on shear + rupture on tension
    Rn2 = 0.6 * Fu * Anv + Fu * Ant  # Rupture on shear + rupture on tension

    Rn = min(Rn1, Rn2)
    governing = 'Shear yield + tension rupture' if Rn == Rn1 else 'Shear rupture + tension rupture'

    phi = 0.65 if design_method == 'LRFD' else None
    omega = 2.50 if design_method == 'ASD' else None
    phi_Rn = phi * Rn if phi else Rn / omega

    return {
        'Rn': round(Rn, 3),
        'Rn1': round(Rn1, 3),
        'Rn2': round(Rn2, 3),
        'phi_Rn': round(phi_Rn, 3),
        'governing': governing,
        'steps': [
            {'name': 'Path 1', 'formula': f'0.6Fy×Agv + Fu×Ant = 0.6×{Fy}×{Agv:.4f} + {Fu}×{Ant:.4f} = {Rn1:.3f} kips'},
            {'name': 'Path 2', 'formula': f'0.6Fu×Anv + Fu×Ant = 0.6×{Fu}×{Anv:.4f} + {Fu}×{Ant:.4f} = {Rn2:.3f} kips'},
            {'name': 'Block Shear', 'formula': f'Rn = min({Rn1:.3f}, {Rn2:.3f}) = {Rn:.3f} kips'},
        ],
    }


def cold_work_strength(Fyv: float, Fuv: float, R: float, t: float,
                        n_bends: int = 4) -> dict:
    """냉간가공 항복강도 증가 (§A7.2, Eq. A7.2-1)

    냉간 성형 과정에서 코너부의 항복강도가 증가하는 효과

    Args:
        Fyv: 원래 항복강도 (ksi)
        Fuv: 인장강도 (ksi)
        R: 내부 코너 반경 (in)
        t: 두께 (in)
        n_bends: 굽힘 횟수 (기본 4 = C-channel 4개 코너)

    Returns:
        dict: {Fya, Bc, increase_pct}
    """
    # Eq. A7.2-1: Fya = Fyv + (Fuv - Fyv) × Bc × (t/R)
    # Bc = 1/(5R/t) × (1 - (R/t)/(2R/t + 1))  simplified
    Rt = R / t if t > 0 else 0

    if Rt <= 0:
        return {'Fya': Fyv, 'Bc': 0, 'increase_pct': 0, 'note': 'R/t = 0 (sharp corner)'}

    # Simplified Bc (§A7.2)
    Bc = 3.69 * (Fuv / Fyv) - 0.819 * (Fuv / Fyv) ** 2 - 1.79
    Bc = max(Bc, 0)

    # Full-section average
    # Corner area fraction
    corner_length = math.pi / 2 * (R + t / 2)  # arc length of one corner
    total_perimeter = 100  # placeholder — should come from section geometry
    corner_fraction = min(n_bends * corner_length / total_perimeter, 0.5)

    Fyc = Fyv + Bc * (Fuv - Fyv)  # corner Fy
    Fyc = min(Fyc, Fuv)  # cannot exceed Fu

    # Average across section
    Fya = Fyv * (1 - corner_fraction) + Fyc * corner_fraction

    increase = (Fya / Fyv - 1) * 100

    return {
        'Fya': round(Fya, 2),
        'Fyc_corner': round(Fyc, 2),
        'Bc': round(Bc, 4),
        'R_over_t': round(Rt, 2),
        'increase_pct': round(increase, 1),
        'steps': [
            {'name': 'Bc coefficient', 'formula': f'Bc = 3.69(Fu/Fy) - 0.819(Fu/Fy)² - 1.79 = {Bc:.4f}'},
            {'name': 'Corner Fy', 'formula': f'Fyc = Fy + Bc(Fu-Fy) = {Fyv} + {Bc:.4f}×({Fuv}-{Fyv}) = {Fyc:.2f} ksi'},
            {'name': 'Average Fya', 'formula': f'Fya = {Fya:.2f} ksi (+{increase:.1f}%)'},
        ],
    }


def flange_curling(bf: float, t: float, h: float,
                   f_avg: float, E: float = 29500) -> dict:
    """플랜지 컬링 검토 (§C3.1.4)

    넓은 플랜지에서 압축응력에 의한 플랜지 면외 변형

    Args:
        bf: 플랜지 폭 (in)
        t: 두께 (in)
        h: 웹 높이 (in)
        f_avg: 플랜지 평균 응력 (ksi)
        E: 탄성계수 (ksi)

    Returns:
        dict: {cf, limit, ok}
    """
    if t <= 0 or E <= 0:
        return {'cf': 0, 'limit': 0, 'ok': True, 'note': 'Invalid input'}

    # Eq. C3.1.4-1: cf = 0.061 × bf⁴ × f_avg / (E × t² × h)
    cf = 0.061 * bf ** 4 * abs(f_avg) / (E * t ** 2 * h) if h > 0 else 0

    # Limit: cf ≤ 0.5t (recommended)
    limit = 0.5 * t
    ok = cf <= limit

    return {
        'cf': round(cf, 6),
        'limit': round(limit, 6),
        'ok': ok,
        'bf_over_t': round(bf / t, 1) if t > 0 else 0,
        'steps': [
            {'name': 'Curling', 'formula': f'cf = 0.061 × {bf}⁴ × {abs(f_avg):.1f} / ({E} × {t}² × {h}) = {cf:.6f} in'},
            {'name': 'Limit', 'formula': f'0.5t = {limit:.6f} in → {"OK" if ok else "NG"}'},
        ],
    }
