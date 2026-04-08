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
                        n_corners: int = 4,
                        corner_angle: float = 90.0,
                        A_corners: float = 0,
                        A_flange: float = 0) -> dict:
    """냉간가공 항복강도 증가 (§A3.3.2, Eq. A3.3.2-1~4)

    AISI S100-16 §A3.3.2: Fya를 Fy 대신 사용 가능
    적용 범위: Chapters D, E, F (§F2.4 제외), §H1, §I4, §I6.2
    조건: Pn=Pne(E3), Pnd=Py(E4), Mn=Mne(F3), Mnd=My(F4) — 좌굴 미지배 시만

    Args:
        Fyv: Virgin 항복강도 (ksi)
        Fuv: Virgin 인장강도 (ksi)
        R: 내부 코너 반경 (in)
        t: 두께 (in)
        n_corners: 코너 수 (C-channel=4, Z=4, Hat=4)
        corner_angle: 코너 각도 (degrees, 기본 90)
        A_corners: 코너부 총 단면적 (in²) — 0이면 자동 계산
        A_flange: 제어 플랜지 총 단면적 (in²) — 0이면 전체 사용

    Returns:
        dict with Fya, Fyc, Bc, m, C, applicable, steps, warnings
    """
    warnings = []
    Rt = R / t if t > 0 else 0

    # 적용 조건 검사
    applicable = True
    if Fuv / Fyv < 1.2:
        applicable = False
        warnings.append(f'Fu/Fy = {Fuv/Fyv:.3f} < 1.2 — Eq. A3.3.2-2 적용 불가')
    if Rt > 7:
        applicable = False
        warnings.append(f'R/t = {Rt:.2f} > 7 — Eq. A3.3.2-2 적용 불가')
    if corner_angle > 120:
        applicable = False
        warnings.append(f'코너 각도 {corner_angle}° > 120° — Eq. A3.3.2-2 적용 불가')

    if not applicable or Rt <= 0:
        return {
            'Fya': Fyv, 'Fyc': Fyv, 'Bc': 0, 'm': 0, 'C': 0,
            'increase_pct': 0, 'applicable': False,
            'steps': [], 'warnings': warnings,
        }

    # Eq. A3.3.2-3: Bc
    ratio = Fuv / Fyv
    Bc = 3.69 * ratio - 0.819 * ratio ** 2 - 1.79
    Bc = max(Bc, 0)

    # Eq. A3.3.2-4: m
    m = 0.192 * ratio - 0.068

    # Eq. A3.3.2-2: Fyc = Bc × Fyv / (R/t)^m
    Fyc = Bc * Fyv / (Rt ** m)
    Fyc = min(Fyc, Fuv)  # ≤ Fuv

    # 코너부 면적 비율 C (Eq. A3.3.2-1)
    if A_corners > 0 and A_flange > 0:
        C = A_corners / A_flange
    else:
        # 자동 계산: 코너 arc 길이 × t
        arc_length = (corner_angle * math.pi / 180) * (R + t / 2)
        A_corner_each = arc_length * t
        A_corners_total = n_corners * A_corner_each

        # 전체 단면 둘레 × t (근사)
        # C-channel: 2×lip + 2×flange + web ≈ perimeter
        # 여기서는 A_flange가 없으면 보수적으로 전체 단면 사용
        if A_flange > 0:
            C = A_corners_total / A_flange
        else:
            C = min(A_corners_total / (A_corners_total / 0.15), 0.3)  # 보수적 15~30%

    C = min(C, 1.0)

    # Eq. A3.3.2-1: Fya = C × Fyc + (1-C) × Fyf
    # Fyf = virgin Fy (시험 미실시 시)
    Fyf = Fyv
    Fya = C * Fyc + (1 - C) * Fyf
    Fya = min(Fya, Fuv)  # ≤ Fuv

    increase = (Fya / Fyv - 1) * 100

    return {
        'Fya': round(Fya, 2),
        'Fyc': round(Fyc, 2),
        'Bc': round(Bc, 4),
        'm': round(m, 4),
        'C': round(C, 4),
        'R_over_t': round(Rt, 2),
        'increase_pct': round(increase, 1),
        'applicable': True,
        'excluded_sections': '§F2.4 (Inelastic Reserve)',
        'steps': [
            {'name': 'Bc (Eq. A3.3.2-3)', 'formula': f'Bc = 3.69×{ratio:.3f} - 0.819×{ratio:.3f}² - 1.79 = {Bc:.4f}'},
            {'name': 'm (Eq. A3.3.2-4)', 'formula': f'm = 0.192×{ratio:.3f} - 0.068 = {m:.4f}'},
            {'name': 'Fyc (Eq. A3.3.2-2)', 'formula': f'Fyc = Bc×Fyv/(R/t)^m = {Bc:.4f}×{Fyv}/{Rt:.2f}^{m:.4f} = {Fyc:.2f} ksi'},
            {'name': 'C (corner ratio)', 'formula': f'C = A_corners/A_total = {C:.4f}'},
            {'name': 'Fya (Eq. A3.3.2-1)', 'formula': f'Fya = C×Fyc + (1-C)×Fyf = {C:.4f}×{Fyc:.2f} + {1-C:.4f}×{Fyf:.2f} = {Fya:.2f} ksi (+{increase:.1f}%)'},
        ],
        'warnings': warnings,
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
