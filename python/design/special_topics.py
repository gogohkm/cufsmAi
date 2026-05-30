"""AISI S100 특수 주제

J6.2: Shear Lag (전단지연)
J6.3: Block Shear (블록 전단)
A3.3.2: Cold Work of Forming (냉간가공 효과)
L3: Flange Curling (플랜지 컬링 서비스성)
"""

import math


def shear_lag(Ag: float, An_net: float, x_bar: float, L_conn: float,
              Fu: float, Fy: float, design_method: str = 'LRFD',
              Usl: float = None, connection_case: str = 'generic',
              d: float = None, s: float = None) -> dict:
    """전단지연 계수 및 유효 순단면적 (AISI J6.2, Table J6.2-1)

    인장 부재에서 접합부가 전체 단면을 연결하지 않을 때
    비균일 응력 분포를 반영하는 감소계수

    Args:
        Ag: 총단면적 (in²)
        An_net: 순단면적 (구멍 제외) (in²)
        x_bar: 전단면으로부터 단면 도심까지의 거리 x̄ (in)
        L_conn: 접합부 길이 또는 종방향 용접 길이 L (in)
        Fu: 인장강도 (ksi)
        Fy: 항복강도 (ksi)
        design_method: 'LRFD' or 'ASD'
        Usl: 직접 지정 시 Table J6.2-1을 우회하여 사용하는 전단지연 계수
        connection_case: Table J6.2-1 분류
            'flat_sheet'      → Eq. J6.2-4: U = 0.9 + 0.1·d/s
            'flat_sheet_stag' → 엇모배치 평판: U = 1.0
            'transverse_weld' → 횡방향 용접만으로 전달: U = 1.0
            'all_elements'    → 모든 단면요소에 직접 전달: U = 1.0
            'welded_angle'    → Eq. J6.2-5: U = 1.0 - 1.20·x̄/L ≤ 0.9, ≥ 0.4
            'welded_channel'  → Eq. J6.2-7: U = 1.0 - 0.36·x̄/L ≤ 0.9, ≥ 0.5
            'generic'(기본)   → 분류 미지정: 경고 후 1 - x̄/L 사용(부재별 하한 미적용)
        d: 평판 접합부(flat_sheet)에서 공칭 볼트 직경 (in) — Eq. J6.2-4용
        s: 평판 접합부(flat_sheet)에서 시트폭/단면 내 볼트구멍 수 (in) — Eq. J6.2-4용

    Returns:
        dict: {U, Ae, Tn_yield, Tn_rupture, Tn, phi_Tn, pass, steps}
    """
    warnings = []
    # AISI S100-16 Table J6.2-1: shear lag factor depends on connection type.
    # The generic 1 - x̄/L form matches none of the table equations; only used
    # as a labeled fallback when connection_case is unknown.
    formula_str = None
    if Usl is not None:
        U = Usl
    elif connection_case in ('flat_sheet_stag', 'transverse_weld', 'all_elements'):
        # Eq. J6.2-1 table rows (2), (3)(a) transverse welds, (3)(b): U = 1.0
        U = 1.0
        formula_str = f'U = 1.0 (Table J6.2-1: {connection_case})'
    elif connection_case == 'flat_sheet':
        # Eq. J6.2-4: U = 0.9 + 0.1·d/s (flat sheet, non-staggered holes)
        if d is not None and s is not None and s > 0:
            U = 0.9 + 0.1 * d / s
            formula_str = f'U = 0.9 + 0.1·d/s = 0.9 + 0.1×{d:.4f}/{s:.4f} = {min(U, 1.0):.4f} (Eq. J6.2-4)'
        else:
            U = 1.0
            warnings.append(
                "connection_case='flat_sheet' requires d (bolt diameter) and s "
                '(sheet width / number of holes) for Eq. J6.2-4; assuming U = 1.0.'
            )
            formula_str = 'U = 1.0 (Eq. J6.2-4 inputs d, s missing)'
    elif connection_case == 'welded_angle' and L_conn > 0:
        # Eq. J6.2-5: U = 1.0 - 1.20·x̄/L ≤ 0.9, but not less than 0.4
        U = 1.0 - 1.20 * x_bar / L_conn
        U = min(U, 0.9)
        U = max(U, 0.4)  # lower bound per Table J6.2-1 (3)(c)
        formula_str = f'U = 1.0 - 1.20·x̄/L = 1.0 - 1.20×{x_bar:.3f}/{L_conn:.3f} → {U:.4f} (Eq. J6.2-5, 0.4≤U≤0.9)'
    elif connection_case == 'welded_channel' and L_conn > 0:
        # Eq. J6.2-7: U = 1.0 - 0.36·x̄/L ≤ 0.9, but not less than 0.5
        U = 1.0 - 0.36 * x_bar / L_conn
        U = min(U, 0.9)
        U = max(U, 0.5)  # lower bound per Table J6.2-1 (3)(d)
        formula_str = f'U = 1.0 - 0.36·x̄/L = 1.0 - 0.36×{x_bar:.3f}/{L_conn:.3f} → {U:.4f} (Eq. J6.2-7, 0.5≤U≤0.9)'
    elif L_conn > 0:
        # 'generic' / unknown: no Table J6.2-1 equation applies. Emit a warning
        # and use the plain 1 - x̄/L form (member-specific floors NOT applied).
        U = min(1.0, 1.0 - x_bar / L_conn)
        warnings.append(
            "connection_case='%s' is not a Table J6.2-1 case; using generic "
            '1 - x_bar/L_conn approximation (no member-specific lower bound). '
            'Specify connection_case or Usl per AISI Table J6.2-1.' % connection_case
        )
        formula_str = f'U = 1 - x̄/L = 1 - {x_bar:.3f}/{L_conn:.3f} = {U:.4f} (generic, not Table J6.2-1)'
    else:
        U = 1.0
        warnings.append('L_conn <= 0; assuming Usl = 1.0.')
        formula_str = 'U = 1.0 (L_conn <= 0)'

    U = max(min(U, 1.0), 0.0)
    if formula_str is None:
        formula_str = f'U = {U:.4f} (Usl provided)'

    # Effective net area
    Ae = An_net * U

    # Tensile strength
    Tn_yield = Ag * Fy        # §D2.1 Yielding
    Tn_rupture = Ae * Fu      # §D3 Rupture with shear lag

    if design_method == 'LRFD':
        design_yield = 0.90 * Tn_yield
        design_rupture = 0.75 * Tn_rupture
    else:
        design_yield = Tn_yield / 1.67
        design_rupture = Tn_rupture / 2.00

    phi_Tn = min(design_yield, design_rupture)
    Tn = Tn_yield if design_yield <= design_rupture else Tn_rupture
    governing = 'Yielding (§D2)' if design_yield <= design_rupture else 'Rupture with shear lag (§D3/J6.2)'

    return {
        'U': round(U, 4),
        'Ae': round(Ae, 4),
        'An_net': round(An_net, 4),
        'Tn_yield': round(Tn_yield, 3),
        'Tn_rupture': round(Tn_rupture, 3),
        'Tn': round(Tn, 3),
        'phi_Tn': round(phi_Tn, 3),
        'governing': governing,
        'connection_case': connection_case,
        'steps': [
            {'name': 'Shear Lag Coefficient', 'formula': formula_str},
            {'name': 'Effective Net Area', 'formula': f'Ae = An × U = {An_net:.4f} × {U:.4f} = {Ae:.4f} in²'},
            {'name': 'Yield Strength', 'formula': f'Tn_yield = Ag × Fy = {Ag:.4f} × {Fy:.1f} = {Tn_yield:.3f} kips'},
            {'name': 'Rupture Strength', 'formula': f'Tn_rupture = Ae × Fu = {Ae:.4f} × {Fu:.1f} = {Tn_rupture:.3f} kips'},
        ],
        'warnings': warnings,
    }


def block_shear(Agv: float, Anv: float, Ant: float,
                Fy: float, Fu: float,
                design_method: str = 'LRFD',
                Ubs: float = 1.0,
                phi_factor: float = None,
                omega_factor: float = None) -> dict:
    """블록 전단 파단 강도 (AISI J6.3)

    Args:
        Agv: 전단면 총면적 (in²)
        Anv: 전단면 순면적 (in²)
        Ant: 인장면 순면적 (in²)
        Fy: 항복강도 (ksi)
        Fu: 인장강도 (ksi)

    Returns:
        dict: {Rn, phi_Rn, steps}
    """
    # Eq. J6.3-1 / J6.3-2
    Rn1 = 0.6 * Fy * Agv + Ubs * Fu * Ant
    Rn2 = 0.6 * Fu * Anv + Ubs * Fu * Ant

    Rn = min(Rn1, Rn2)
    governing = 'Shear yield + tension rupture' if Rn == Rn1 else 'Shear rupture + tension rupture'

    phi = phi_factor if phi_factor is not None else (0.65 if design_method == 'LRFD' else None)
    omega = omega_factor if omega_factor is not None else (2.50 if design_method == 'ASD' else None)
    phi_Rn = phi * Rn if phi else Rn / omega

    return {
        'Rn': round(Rn, 3),
        'Rn1': round(Rn1, 3),
        'Rn2': round(Rn2, 3),
        'phi_Rn': round(phi_Rn, 3),
        'governing': governing,
        'Ubs': Ubs,
        'steps': [
            {'name': 'Path 1', 'formula': f'0.6Fy×Agv + Ubs×Fu×Ant = 0.6×{Fy}×{Agv:.4f} + {Ubs:.2f}×{Fu}×{Ant:.4f} = {Rn1:.3f} kips'},
            {'name': 'Path 2', 'formula': f'0.6Fu×Anv + Ubs×Fu×Ant = 0.6×{Fu}×{Anv:.4f} + {Ubs:.2f}×{Fu}×{Ant:.4f} = {Rn2:.3f} kips'},
            {'name': 'Block Shear', 'formula': f'Rn = min({Rn1:.3f}, {Rn2:.3f}) = {Rn:.3f} kips'},
        ],
        'warnings': [] if (phi_factor is not None or omega_factor is not None) else [
            'Using default connection resistance factors. Override phi_factor/omega_factor for connection-specific AISI J6.3 design.'
        ],
    }


def cold_work_strength(Fyv: float, Fuv: float, R: float, t: float,
                        n_corners: int = 4,
                        corner_angle: float = 90.0,
                        A_corners: float = 0,
                        A_flange: float = 0,
                        corners_per_flange: int = 2) -> dict:
    """냉간가공 항복강도 증가 (§A3.3.2, Eq. A3.3.2-1~4)

    AISI S100-16 §A3.3.2: Fya를 Fy 대신 사용 가능
    적용 범위: Chapters D, E, F (§F2.4 제외), §H1, §I4, §I6.2
    조건: Pn=Pne(E3), Pnd=Py(E4), Mn=Mne(F3), Mnd=My(F4) — 좌굴 미지배 시만

    Eq. A3.3.2-1의 C 정의:
      - 압축부재: C = 전체 코너 단면적 / 전체 단면적
      - 휨부재   : C = 제어 플랜지의 코너 단면적 / 제어 플랜지 단면적
    따라서 A_flange(제어 플랜지 면적)가 주어지면 그에 대응하는 플랜지 코너
    면적(기본 2개 코너)으로 나눠야 하며, 전체 단면 코너(n_corners) 면적으로
    나누면 C가 과대평가되어 Fya가 비보수적으로 증가한다.

    Args:
        Fyv: Virgin 항복강도 (ksi)
        Fuv: Virgin 인장강도 (ksi)
        R: 내부 코너 반경 (in)
        t: 두께 (in)
        n_corners: 전체 단면 코너 수 (C-channel=4, Z=4, Hat=4) — 압축부재 C 자동계산용
        corner_angle: 코너 각도 (degrees, 기본 90)
        A_corners: (제어)부위 코너부 총 단면적 (in²) — >0이고 A_flange>0이면 직접 C 계산
        A_flange: 제어 플랜지 총 단면적 (in²) — >0이면 휨부재 C로 해석
        corners_per_flange: 제어 플랜지 1개당 코너 수 (C/Z 플랜지 기본 2)

    Returns:
        dict with Fya, Fyc, Bc, m, C, applicable, steps, warnings
    """
    warnings = []
    # 입력 유효성: 면적/형상 입력은 음수가 될 수 없다(음수 C 방지).
    if A_corners < 0 or A_flange < 0:
        warnings.append('A_corners/A_flange 음수 입력 → 0(미제공)으로 처리.')
        A_corners = max(A_corners, 0.0)
        A_flange = max(A_flange, 0.0)
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
    # 코너 1개당 면적 (arc 길이 × t)
    arc_length = (corner_angle * math.pi / 180) * (R + t / 2)
    A_corner_each = arc_length * t

    if A_corners > 0 and A_flange > 0:
        # 직접 입력: A_corners(해당 부위 코너 면적)/A_flange(해당 부위 면적)
        C = A_corners / A_flange
    elif A_flange > 0:
        # 휨부재 C: 제어 플랜지 코너 면적 / 제어 플랜지 면적.
        # A_corners 미제공 → 플랜지 코너(기본 2개) 면적으로 자동 산정.
        # (전체 단면 코너 n_corners로 나누면 C 과대평가 → Fya 비보수적. Eq. A3.3.2-1)
        A_flange_corners = corners_per_flange * A_corner_each
        if A_flange_corners > 0:
            C = A_flange_corners / A_flange
            warnings.append(
                f'A_corners 미제공 → 제어 플랜지 코너 {corners_per_flange}개 면적으로 '
                'C 자동 산정(Eq. A3.3.2-1, 휨부재).'
            )
        else:
            C = 0.15
            warnings.append('코너 면적 산정 불가 → 보수적 C=0.15 사용.')
    else:
        # A_flange 미제공 시 보수적 추정: C = 0.15 (일반적 CFS 범위 0.05~0.30)
        C = 0.15
        warnings.append(
            'A_flange 미제공 → 보수적 C=0.15 사용. '
            '정확한 계산을 위해 A_corners, A_flange를 제공하세요.'
        )

    # 음수 방지(음수 입력은 위에서 0으로 정규화되나 방어적으로 한 번 더 하한 0)
    C = min(max(C, 0.0), 1.0)

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
                   f_avg: float, E: float = 29500,
                   allowable_cf: float = None) -> dict:
    """플랜지 컬링 검토 (AISI L3 serviceability reference)

    넓은 플랜지에서 압축응력에 의한 플랜지 면외 변형

    Args:
        bf: 플랜지 폭 (in)
        t: 두께 (in)
        h: 웹 높이 (in)
        f_avg: 플랜지 평균 응력 (ksi)
        E: 탄성계수 (ksi)

    Returns:
        dict: {cf, allowable_cf, ok}
    """
    if t <= 0 or E <= 0:
        return {'cf': 0, 'limit': 0, 'ok': True, 'note': 'Invalid input'}

    # AISI S100-16 Eq. L3-1 (Chapter L): wf = sqrt(0.061·t·d·E/f_av)·(100·cf/d)^(1/4)
    # where wf = width of flange projecting beyond the web (or half the clear
    # distance between webs for box/U sections), d = depth of beam, f_av = average
    # flange stress. Solving Eq. L3-1 for the curling displacement cf gives:
    #   cf = wf⁴ · f_av² / (100 · d · 0.061² · t² · E²)
    # (Verified against CFS Design Manual Example I-18: wf=1.193, d=5.698,
    #  t=0.0566, f_av=23.82 → cf≈0.000194 in.)
    wf = bf - t  # projection of flange beyond the web (conservative; for box/U
                 # sections pass bf = half the clear distance between webs)
    cf = (wf ** 4 * abs(f_avg) ** 2) / (100.0 * h * (0.061 ** 2) * t ** 2 * E ** 2) \
        if (h > 0 and abs(f_avg) > 0) else 0

    # AISI는 고정 허용치를 제시하지 않으므로 기본값은 commentary-style reference만 둔다.
    limit = allowable_cf if allowable_cf is not None else 0.05 * h
    ok = cf <= limit

    return {
        'cf': round(cf, 6),
        'allowable_cf': round(limit, 6),
        'ok': ok,
        'bf_over_t': round(bf / t, 1) if t > 0 else 0,
        'criterion_type': 'serviceability',
        'steps': [
            {'name': 'Curling', 'formula': f'cf = wf⁴ × f_av² / (100 × d × 0.061² × t² × E²) = {wf:.4f}⁴ × {abs(f_avg):.1f}² / (100 × {h} × 0.061² × {t}² × {E}²) = {cf:.6f} in'},
            {'name': 'Allowable Curling', 'formula': f'cf_allow = {limit:.6f} in → {"OK" if ok else "NG"}'},
        ],
        'warnings': [] if allowable_cf is not None else [
            'AISI L3 does not prescribe a universal allowable curling limit. '
            'Defaulting to 5% of section depth as a serviceability reference.'
        ],
    }
