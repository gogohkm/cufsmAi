"""AISI S100 특수 주제

J6.2: Shear Lag (전단지연)
J6.3: Block Shear (블록 전단)
A3.3.2: Cold Work of Forming (냉간가공 효과)
L3: Flange Curling (플랜지 컬링 서비스성)
"""

import math

from design.connections import (
    OMEGA_RUPTURE, PHI_RUPTURE, block_shear_nominal, normalize_design_method,
    normalize_member_case, rupture_factors, shear_lag_factor, MEMBER_CASES,
)


def shear_lag(Ag: float, An_net: float, x_bar: float, L_conn: float,
              Fu: float, Fy: float, design_method: str = 'LRFD',
              Usl: float = None, connection_case: str = 'generic',
              d: float = None, s: float = None,
              connection_type: str = None,
              b1: float = None, b2: float = None,
              bf: float = None, bw: float = None) -> dict:
    """접합부 인장부재의 전단지연(J6.2, Table J6.2-1)과 인장강도(D2, D3, J6.2)

    Usl 식과 Table J6-1 계수는 design.connections 의 단일 구현을 쓴다.

    Args:
        Ag: 총단면적 (in²)
        An_net: 접합부 순단면적 Ant (Eq. J6.2-3; Table J6.2-1 (3)(a) 는 직접 접합 요소 면적) (in²)
        x_bar: 전단면으로부터 단면 도심까지의 거리 x̄ (in)
        L_conn: 접합 길이(볼트: 끝 패스너 사이) 또는 종방향 용접 길이 L (in)
        Fu, Fy: 강도 (ksi)
        design_method: 'LRFD' | 'ASD' (LSD 는 오류)
        Usl: 직접 지정하면 Table J6.2-1 대신 사용
        connection_case: Table J6.2-1 분류 (하이픈·공백·대소문자 무관)
            'flat_sheet'(J6.2-4, d·s 필요 — 없으면 하한 0.9), 'flat_sheet_staggered'(=1.0),
            'transverse_weld'((3)(a), =1.0), 'all_elements'((3)(b), =1.0),
            'angle_welded'(J6.2-5), 'angle_bolted'(J6.2-6, b1·b2 필요),
            'channel_welded'(J6.2-7), 'channel_bolted'(J6.2-8, bf·bw 필요).
            분류가 없고 Usl 도 없으면 오류(과거의 1 − x̄/L 일반식은 기준식이 아님).
        d, s: flat_sheet 의 볼트 공칭직경, 시트폭/단면 구멍수 (in)
        connection_type: 'bolted'|'welded'|'screw'|'paf' — J6.2 파단의 Table J6-1 계수.
            None 이면 표에서 가장 보수적인 행(나사·PAF: Ω=3.00, φ=0.50)을 쓴다(경고).
        b1, b2: 앵글의 비접합·접합 다리 폭 (J6.2-6), bf, bw: 채널 비접합 플랜지·접합 웨브 폭 (J6.2-8)

    Returns:
        dict: {U, Ae, Tn_yield, Tn_rupture, Tn, phi_Tn, governing, steps, warnings, ...}
    """
    try:
        dm = normalize_design_method(design_method)
    except ValueError as exc:
        return {'error': str(exc)}
    warnings = []
    if Usl is not None:
        U = float(Usl)
        formula_str = f'U = {U:.4f} (Usl provided)'
        usl_eq = 'Usl provided'
    else:
        case = normalize_member_case(connection_case)
        if case is None:
            return {'error': (f"connection_case '{connection_case}' is not a Table J6.2-1 case "
                              f"({', '.join(MEMBER_CASES)}); give connection_case or Usl")}
        sl = shear_lag_factor(case, d=d, s=s, x_bar=x_bar, L=L_conn, b1=b1, b2=b2, bf=bf, bw=bw)
        if sl['Usl'] is None:
            return {'error': f'Table J6.2-1: {sl["reason"]}'}
        U = sl['Usl']
        usl_eq = sl['equation']
        formula_str = f"{sl['formula']} (Eq./Table {usl_eq})"
        warnings.extend(sl['warnings'])
        if case == 'transverse_weld':
            warnings.append('Table J6.2-1 (3)(a): An_net 에 직접 접합된 요소의 면적을 넣어야 함')
    U = max(min(U, 1.0), 0.0)

    if connection_type is None:
        phi_r, omega_r, rkey = 0.50, 3.00, 'screw/paf (most conservative)'
        warnings.append('connection_type 미지정 — J6.2 파단에 Table J6-1 의 가장 보수적인 계수'
                        '(나사·PAF Ω=3.00, φ=0.50) 사용. bolted/welded 를 지정하세요.')
    else:
        try:
            phi_r, omega_r, rkey = rupture_factors(connection_type)
        except ValueError as exc:
            return {'error': str(exc)}

    Ae = An_net * U
    Tn_yield = Ag * Fy          # §D2
    Tn_rupture = Ae * Fu        # §J6.2 (Eq. J6.2-1)
    Tn_net = An_net * Fu        # §D3 (Ae 없이 순단면)

    if dm == 'LRFD':
        design_yield = 0.90 * Tn_yield
        design_rupture = phi_r * Tn_rupture
        design_net = 0.75 * Tn_net
    else:
        design_yield = Tn_yield / 1.67
        design_rupture = Tn_rupture / omega_r
        design_net = Tn_net / 2.00

    candidates = [(design_yield, Tn_yield, 'Yielding (§D2)'),
                  (design_rupture, Tn_rupture, 'Rupture with shear lag (§J6.2)'),
                  (design_net, Tn_net, 'Net section rupture (§D3)')]
    phi_Tn, Tn, governing = min(candidates, key=lambda c: c[0])
    fac = f'φ={phi_r}' if dm == 'LRFD' else f'Ω={omega_r}'

    return {
        'U': round(U, 4),
        'Ae': round(Ae, 4),
        'An_net': round(An_net, 4),
        'Tn_yield': round(Tn_yield, 3),
        'Tn_rupture': round(Tn_rupture, 3),
        'Tn_net_rupture_D3': round(Tn_net, 3),
        'Tn': round(Tn, 3),
        'phi_Tn': round(phi_Tn, 3),
        'design_yield': round(design_yield, 3),
        'design_rupture': round(design_rupture, 3),
        'design_net_rupture_D3': round(design_net, 3),
        'rupture_phi': phi_r,
        'rupture_omega': omega_r,
        'rupture_factor_basis': f'Table J6-1 ({rkey})',
        'Usl_equation': usl_eq,
        'design_method': dm,
        'governing': governing,
        'connection_case': connection_case,
        'steps': [
            {'name': 'Shear Lag Coefficient', 'formula': formula_str},
            {'name': 'Effective Net Area', 'formula': f'Ae = An × U = {An_net:.4f} × {U:.4f} = {Ae:.4f} in²'},
            {'name': 'Yield Strength (D2)', 'formula': f'Tn_yield = Ag × Fy = {Ag:.4f} × {Fy:.1f} = {Tn_yield:.3f} kips'},
            {'name': 'Rupture Strength (J6.2)',
             'formula': f'Tn_rupture = Ae × Fu = {Ae:.4f} × {Fu:.1f} = {Tn_rupture:.3f} kips ({fac}, Table J6-1)'},
            {'name': 'Net Section Rupture (D3)', 'formula': f'Tn = An × Fu = {Tn_net:.3f} kips'},
        ],
        'warnings': warnings,
    }


def block_shear(Agv: float, Anv: float, Ant: float,
                Fy: float, Fu: float,
                design_method: str = 'LRFD',
                Ubs: float = 1.0,
                phi_factor: float = None,
                omega_factor: float = None,
                connection_type: str = 'bolted') -> dict:
    """블록 전단 파단 강도 (AISI J6.3)

    Args:
        Agv: 전단면 총면적 (in²)
        Anv: 전단면 순면적 (in²)
        Ant: 인장면 순면적 (in²)
        Fy: 항복강도 (ksi)
        Fu: 인장강도 (ksi)
        design_method: 'LRFD'(φRn) | 'ASD'(Rn/Ω). LSD·알 수 없는 값은 오류.
        Ubs: 1.0 (일반), 0.5 (코핑 보 + 수직열 2개 이상)
        connection_type: 'bolted' | 'welded' — Table J6-1 의 φ/Ω (볼트 0.65/2.22, 용접 0.60/2.50).
            J6 머리글에 따라 나사·PAF 접합에는 블록전단을 적용하지 않는다(오류).

    Returns:
        dict: {Rn, phi_Rn, steps}
    """
    try:
        dm = normalize_design_method(design_method)
        _, _, key = rupture_factors(connection_type)
    except ValueError as exc:
        return {'error': str(exc)}
    if key in ('screw', 'paf'):
        return {'error': 'J6: 나사·PAF 접합의 파단은 J6.1·J6.2 만 — 블록전단(J6.3)은 볼트·용접 접합에만 적용'}

    Rn, Rn1, Rn2 = block_shear_nominal(Fy, Fu, Agv, Anv, Ant, Ubs)
    governing = 'Shear yield + tension rupture' if Rn == Rn1 else 'Shear rupture + tension rupture'

    phi_default, omega_default = PHI_RUPTURE[key], OMEGA_RUPTURE[key]
    phi = phi_factor if phi_factor is not None else phi_default
    omega = omega_factor if omega_factor is not None else omega_default
    warnings = []
    if phi_factor is None and omega_factor is None:
        warnings.append(f'Using Table J6-1 factors for {key} connection (phi={phi}, omega={omega}).')
    if (phi_factor is not None and phi_factor > phi_default) or \
            (omega_factor is not None and omega_factor < omega_default):
        warnings.append('A1.2: 사용자 계수가 Table J6-1 보다 덜 보수적임 '
                        f'(표: φ={phi_default}, Ω={omega_default}) — 시험 근거(K2) 없이는 쓸 수 없음')

    is_asd = dm == 'ASD'
    phi_Rn = Rn / omega if is_asd else phi * Rn

    return {
        'Rn': round(Rn, 3),
        'Rn1': round(Rn1, 3),
        'Rn2': round(Rn2, 3),
        'phi_Rn': round(phi_Rn, 3),
        'design_method': dm,
        'phi': phi,
        'omega': omega,
        'connection_type': 'welded' if key == 'weld' else 'bolted',
        'governing': governing,
        'Ubs': Ubs,
        'steps': [
            {'name': 'Path 1', 'formula': f'0.6Fy×Agv + Ubs×Fu×Ant = 0.6×{Fy}×{Agv:.4f} + {Ubs:.2f}×{Fu}×{Ant:.4f} = {Rn1:.3f} kips'},
            {'name': 'Path 2', 'formula': f'0.6Fu×Anv + Ubs×Fu×Ant = 0.6×{Fu}×{Anv:.4f} + {Ubs:.2f}×{Fu}×{Ant:.4f} = {Rn2:.3f} kips'},
            {'name': 'Block Shear', 'formula': f'Rn = min({Rn1:.3f}, {Rn2:.3f}) = {Rn:.3f} kips'},
            {'name': 'Available Strength',
             'formula': (f'Rn/Ω = {Rn:.3f}/{omega} = {phi_Rn:.3f} kips' if is_asd
                         else f'φRn = {phi} × {Rn:.3f} = {phi_Rn:.3f} kips')},
        ],
        'warnings': warnings,
    }


def cold_work_strength(Fyv: float, Fuv: float, R: float, t: float,
                        n_corners: int = 4,
                        corner_angle: float = 90.0,
                        A_corners: float = 0,
                        A_flange: float = 0,
                        corners_per_flange: int = 2,
                        A_total: float = 0,
                        buckling_precondition: bool = None) -> dict:
    """냉간가공 항복강도 증가 (§A3.3.2, Eq. A3.3.2-1~4)

    AISI S100-16 §A3.3.2: Fya 를 Fy 대신 쓸 수 있는 곳은 Chapters D, E, F (§F2.4 제외),
    §H1, §I4, §I6.2 이고, Fy 응력 수준에서 국부·뒤틀림 좌굴 감소가 없는 단면
    (기둥 Pnℓ=Pne·Pnd=Py, 보 Mnℓ=Mne·Mnd=My)에 한한다.

    Eq. A3.3.2-1의 C 정의:
      - 압축부재: C = 전체 코너 단면적 / 전체 단면적  (A_total 과 n_corners 로 산정 가능)
      - 휨부재   : C = 제어 플랜지의 코너 단면적 / 제어 플랜지 단면적 (A_flange)
    면적이 하나도 없으면 C 를 추정하지 않고 증가 없음(C=0)으로 둔다.

    Args:
        Fyv, Fuv: Virgin 항복/인장강도 (ksi)
        R: 내부 코너 반경 (in), t: 두께 (in)
        n_corners: 전체 단면 코너 수 — A_total 이 있을 때 압축부재 C 자동계산
        corner_angle: 코너 각도 (degrees, 기본 90)
        A_corners: 코너부 단면적 (in²) — A_flange 또는 A_total 과 함께 직접 C 계산
        A_flange: 제어 플랜지 총 단면적 (in²) — 휨부재 C
        corners_per_flange: 제어 플랜지 1개당 코너 수 (C/Z 플랜지 기본 2)
        A_total: 전체 단면적 (in²) — 압축부재 C
        buckling_precondition: 호출자가 좌굴 전제(위)를 확인했으면 True, 위배면 False,
            확인하지 않았으면 None (단독 호출).

    Returns:
        dict: Fya, Fyc, Bc, m, C, steps, warnings 와
            applicable          — 식(Eq. A3.3.2-2) 적용조건(Fu/Fy ≥ 1.2, R/t ≤ 7, 각도 ≤ 120°) 만족 여부
            formula_applicable  — applicable 과 같음
            buckling_precondition — 'met' | 'not_met' | 'not_checked'
            fya_usable          — 식 조건과 좌굴 전제를 모두 만족하면 True, 하나라도 위배면 False,
                                  좌굴 전제를 확인하지 않았으면 None
    """
    warnings = []
    if A_corners < 0 or A_flange < 0 or A_total < 0:
        warnings.append('A_corners/A_flange/A_total 음수 입력 → 0(미제공)으로 처리.')
        A_corners = max(A_corners, 0.0)
        A_flange = max(A_flange, 0.0)
        A_total = max(A_total, 0.0)
    Rt = R / t if t > 0 else 0
    if buckling_precondition is True:
        bp = 'met'
    elif buckling_precondition is False:
        bp = 'not_met'
    else:
        bp = 'not_checked'
        warnings.append('§A3.3.2 좌굴 전제(Pnℓ=Pne, Pnd=Py / Mnℓ=Mne, Mnd=My)는 확인하지 않음 — '
                        'Fya 는 그 전제가 성립할 때만 쓸 수 있다(fya_usable=None).')

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

    def _usable(formula_ok):
        if not formula_ok or bp == 'not_met':
            return False
        return True if bp == 'met' else None

    if not applicable or Rt <= 0:
        return {
            'Fya': Fyv, 'Fyc': Fyv, 'Bc': 0, 'm': 0, 'C': 0,
            'increase_pct': 0, 'applicable': False, 'formula_applicable': False,
            'buckling_precondition': bp, 'fya_usable': False,
            'steps': [], 'warnings': warnings,
        }

    ratio = Fuv / Fyv
    Bc = max(3.69 * ratio - 0.819 * ratio ** 2 - 1.79, 0)   # Eq. A3.3.2-3
    m = 0.192 * ratio - 0.068                              # Eq. A3.3.2-4
    # Eq. A3.3.2-2: 코너 항복응력. 상한은 Eq. A3.3.2-1 의 Fya ≤ Fuv 뿐이다(Fyc 자체는 Fuv 를 넘을 수 있음 —
    # Manual Example I-16: Fyc = 52.30 > Fuv = 45 ksi).
    Fyc = Bc * Fyv / (Rt ** m)

    arc_length = (corner_angle * math.pi / 180) * (R + t / 2)
    A_corner_each = arc_length * t

    if A_corners > 0 and A_flange > 0:
        C = A_corners / A_flange
        c_note = 'C = A_corners/A_flange (입력)'
    elif A_flange > 0:
        # 휨부재: 제어 플랜지 코너 면적 / 제어 플랜지 면적 (전체 코너 수로 나누면 C 과대)
        C = corners_per_flange * A_corner_each / A_flange
        c_note = f'C = {corners_per_flange}×A_corner/A_flange (휨부재)'
        warnings.append(
            f'A_corners 미제공 → 제어 플랜지 코너 {corners_per_flange}개 면적으로 '
            'C 자동 산정(Eq. A3.3.2-1, 휨부재).')
    elif A_total > 0:
        A_c = A_corners if A_corners > 0 else n_corners * A_corner_each
        C = A_c / A_total
        c_note = ('C = A_corners/A_total (압축부재)' if A_corners > 0
                  else f'C = {n_corners}×A_corner/A_total (압축부재)')
    else:
        C = 0.0
        c_note = 'C = 0 (면적 미제공 — 증가 없음)'
        warnings.append('A_flange(휨) 또는 A_total(압축) 미제공 — C 를 추정하지 않고 증가 없음(C=0). '
                        '과거의 C=0.15 는 압축부재(C≈0.09–0.10)에서 비보수였다.')

    C = min(max(C, 0.0), 1.0)
    Fyf = Fyv
    Fya = min(C * Fyc + (1 - C) * Fyf, Fuv)                 # Eq. A3.3.2-1 (≤ Fuv)
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
        'formula_applicable': True,
        'buckling_precondition': bp,
        'fya_usable': _usable(True),
        'excluded_sections': '§F2.4 (Inelastic Reserve); Chapter G, H2, H3 등 §A3.3.2 목록 밖',
        'steps': [
            {'name': 'Bc (Eq. A3.3.2-3)', 'formula': f'Bc = 3.69×{ratio:.3f} - 0.819×{ratio:.3f}² - 1.79 = {Bc:.4f}'},
            {'name': 'm (Eq. A3.3.2-4)', 'formula': f'm = 0.192×{ratio:.3f} - 0.068 = {m:.4f}'},
            {'name': 'Fyc (Eq. A3.3.2-2)', 'formula': f'Fyc = Bc×Fyv/(R/t)^m = {Bc:.4f}×{Fyv}/{Rt:.2f}^{m:.4f} = {Fyc:.2f} ksi'},
            {'name': 'C (corner ratio)', 'formula': f'{c_note} = {C:.4f}'},
            {'name': 'Fya (Eq. A3.3.2-1)', 'formula': f'Fya = C×Fyc + (1-C)×Fyf = {C:.4f}×{Fyc:.2f} + {1-C:.4f}×{Fyf:.2f} = {Fya:.2f} ksi (+{increase:.1f}%) ≤ Fuv'},
        ],
        'warnings': warnings,
    }


def flange_curling(bf: float, t: float, h: float,
                   f_avg: float, E: float = 29500,
                   allowable_cf: float = None,
                   d: float = None,
                   wf_is_half_clear_distance: bool = False) -> dict:
    """플랜지 컬링 검토 (AISI L3 serviceability reference, Eq. L3-1)

    넓은 플랜지에서 압축응력에 의한 플랜지 면외 변형

    Args:
        bf: 플랜지 폭 (in). 웨브 바깥으로 돌출한 폭 wf = bf − t 로 쓴다.
        t: 두께 (in)
        h: 보 깊이 d (in) — Eq. L3-1 의 d (웨브 높이가 아니라 단면 깊이). 이름은 과거 호환.
        f_avg: 플랜지 평균 응력 (ksi)
        E: 탄성계수 (ksi)
        allowable_cf: 허용 컬링 (in). 없으면 판정 없이 참고값만.
        d: 보 깊이 (in). 주면 h 대신 쓴다.
        wf_is_half_clear_distance: 박스·U형에서 bf 로 "웨브 사이 순거리의 절반"을 넘겼으면 True
            (그 값이 곧 wf 이므로 t 를 빼지 않는다).

    Returns:
        dict: {cf, allowable_cf, ok, ...}. ok=None이면 판정 불가(참고값만 제공) —
        사용성(serviceability) 참고식이므로 강도 판정과 혼동 금지.
    """
    if d is not None:
        h = d
    if t <= 0 or E <= 0:
        return {'cf': 0, 'limit': 0, 'ok': None, 'note': 'Invalid input',
                'criterion_type': 'serviceability', 'serviceability_only': True}

    # AISI S100-16 Eq. L3-1 (Chapter L): wf = sqrt(0.061·t·d·E/f_av)·(100·cf/d)^(1/4)
    # where wf = width of flange projecting beyond the web (or half the clear
    # distance between webs for box/U sections), d = depth of beam, f_av = average
    # flange stress. Solving Eq. L3-1 for the curling displacement cf gives:
    #   cf = wf⁴ · f_av² / (100 · d · 0.061² · t² · E²)
    # (Verified against CFS Design Manual Example I-18: wf=1.193, d=5.698,
    #  t=0.0566, f_av=23.82 → cf≈0.000194 in.)
    wf = bf if wf_is_half_clear_distance else bf - t
    cf = (wf ** 4 * abs(f_avg) ** 2) / (100.0 * h * (0.061 ** 2) * t ** 2 * E ** 2) \
        if (h > 0 and abs(f_avg) > 0) else 0

    # AISI는 고정 허용치를 제시하지 않으므로 허용값 미제공 시 판정(ok) 대신 참고값만 둔다.
    if allowable_cf is not None:
        limit = allowable_cf
        ok = cf <= limit
    else:
        limit = 0.05 * h
        ok = None

    return {
        'cf': round(cf, 6),
        'allowable_cf': round(limit, 6),
        'ok': ok,
        'bf_over_t': round(bf / t, 1) if t > 0 else 0,
        'criterion_type': 'serviceability',
        'serviceability_only': True,
        'steps': [
            {'name': 'Curling', 'formula': f'cf = wf⁴ × f_av² / (100 × d × 0.061² × t² × E²) = {wf:.4f}⁴ × {abs(f_avg):.1f}² / (100 × {h} × 0.061² × {t}² × {E}²) = {cf:.6f} in'},
            {'name': 'Allowable Curling', 'formula': f'cf_allow = {limit:.6f} in → {"참고값(판정 없음)" if ok is None else ("OK" if ok else "NG")}'},
        ],
        'warnings': [] if allowable_cf is not None else [
            'AISI L3 does not prescribe a universal allowable curling limit. '
            'Defaulting to 5% of section depth as a serviceability reference.'
        ],
    }
