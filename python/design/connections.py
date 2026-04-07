"""접합부 설계 — AISI S100-16 Chapter J

볼트(J3), 나사(J4), 필릿용접(J2.1) 접합부의 공칭강도 계산.
각 파괴 모드별 강도를 계산하고 지배 모드를 결정한다.
"""

import math

# ============================================================
# 안전/저항 계수
# ============================================================

PHI_BOLT = {
    'bearing':  0.60,    # J3.3.1
    'tearout':  0.70,    # J3.3.1
    'shear':    0.65,    # J3.3.2
    'tension':  0.75,    # J3.3.2
}
OMEGA_BOLT = {
    'bearing':  2.50,
    'tearout':  2.22,
    'shear':    2.40,
    'tension':  2.00,
}

PHI_SCREW = {
    'bearing':  0.50,    # J4.3.1
    'pullout':  0.50,    # J4.4.1
    'pullover': 0.50,    # J4.4.2
    'shear':    0.50,    # J4.3
    'tilting':  0.50,    # J4.3.1
}
OMEGA_SCREW = {
    'bearing':  3.00,
    'pullout':  3.00,
    'pullover': 3.00,
    'shear':    3.00,
    'tilting':  3.00,
}

PHI_WELD = {
    'weld_shear':  0.60,    # J2.1
    'sheet_shear': 0.60,    # J2.2.2.1
    'sheet_tear':  0.60,    # J2.2.2.1
}
OMEGA_WELD = {
    'weld_shear':  2.50,
    'sheet_shear': 2.50,
    'sheet_tear':  2.50,
}


# ============================================================
# 볼트 접합 (J3)
# ============================================================

def bolt_connection(t1: float, t2: float, d: float,
                    Fy: float, Fu: float, Fub: float,
                    e: float = None, s: float = None,
                    n: int = 1,
                    design_method: str = 'LRFD') -> dict:
    """볼트 접합 설계 (§J3)

    Args:
        t1, t2: 연결판 두께 (in)
        d: 볼트 직경 (in)
        Fy, Fu: 모재 항복/인장강도 (ksi)
        Fub: 볼트 인장강도 (ksi)
        e: 끝단 거리 (in, None이면 2.5d 가정)
        s: 볼트 간격 (in, None이면 3d 가정)
        n: 볼트 개수
        design_method: 'ASD' or 'LRFD'
    """
    if e is None:
        e = 2.5 * d
    if s is None:
        s = 3.0 * d

    t_min = min(t1, t2)
    limit_states = []

    # (a) 지압 강도 (J3.3.1)
    # 단일 볼트당: Pnb = C × mf × d × t × Fu
    # C = min(e/d, 3.0)  [끝단 볼트], C = min(s/d, 3.0) [내부 볼트]
    # 단순화: 끝단 볼트 C 사용
    C = min(e / d, 3.0)
    mf = 1.0  # 와셔 없는 경우 기본값
    Pnb_per = C * mf * d * t_min * Fu
    Pnb = n * Pnb_per
    limit_states.append({
        'name': 'Bearing (J3.3.1)',
        'Rn': round(Pnb, 3),
        'phi': PHI_BOLT['bearing'],
        'omega': OMEGA_BOLT['bearing'],
        'formula': f'Pnb = {n}×{C:.2f}×{mf}×{d}×{t_min}×{Fu} = {Pnb:.3f}',
        'equation': 'J3.3.1-1',
    })

    # (b) 인열파단 (Tearout, J3.3.1)
    Pnt_per = 0.6 * Fu * t_min * (e - d / 2)
    Pnt = n * Pnt_per
    limit_states.append({
        'name': 'Tearout (J3.3.1)',
        'Rn': round(Pnt, 3),
        'phi': PHI_BOLT['tearout'],
        'omega': OMEGA_BOLT['tearout'],
        'formula': f'Pnt = {n}×0.6×{Fu}×{t_min}×({e}-{d}/2) = {Pnt:.3f}',
        'equation': 'J3.3.1-2',
    })

    # (c) 볼트 전단 (J3.3.2)
    Ab = math.pi / 4 * d ** 2
    Fnv = 0.50 * Fub  # 전단면이 나사부 통과 시 (보수적)
    Pns = n * Ab * Fnv
    limit_states.append({
        'name': 'Bolt Shear (J3.3.2)',
        'Rn': round(Pns, 3),
        'phi': PHI_BOLT['shear'],
        'omega': OMEGA_BOLT['shear'],
        'formula': f'Pns = {n}×{Ab:.4f}×{Fnv:.1f} = {Pns:.3f}',
        'equation': 'J3.3.2',
    })

    # 각 한계상태별 설계강도
    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    # 지배 모드
    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    Pu = 0  # 외부에서 설정
    return {
        'connection_type': 'bolt',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J3.3.1', 'J3.3.2'],
    }


# ============================================================
# 나사 접합 (J4)
# ============================================================

def screw_connection(t1: float, t2: float, d: float,
                     Fy: float, Fu: float, Fub: float,
                     n: int = 1,
                     design_method: str = 'LRFD') -> dict:
    """나사 접합 설계 (§J4)

    t1: 풀아웃(pullout) 측 두께 (하부판) — 나사가 관통하는 판
    t2: 풀오버(pullover) 측 두께 (상부판) — 머리 접촉 판
    d: 나사 직경 (in)
    Fub: 나사 인장/전단 강도 (ksi)
    """
    limit_states = []

    # (a) 전단 지압 — 얇은 판 지배 (J4.3.1)
    t_min = min(t1, t2)
    if t2 / t1 <= 1.0:
        # t2 ≤ t1: tilting+bearing
        alpha = 4.2 * (t2 / d) ** 0.5 if t2 / d <= 1.0 else 2.7
        Pns = alpha * t2 * d * Fu * n
        eq_bear = 'J4.3.1-1 (tilting)'
    elif t2 / t1 >= 2.5:
        # t2/t1 ≥ 2.5
        Pns = 2.7 * t1 * d * Fu * n
        eq_bear = 'J4.3.1-3'
    else:
        # 보간
        Pns1 = 4.2 * (t2 / d) ** 0.5 * t2 * d * Fu * n
        Pns2 = 2.7 * t1 * d * Fu * n
        Pns = min(Pns1, Pns2)
        eq_bear = 'J4.3.1 (interpolated)'

    limit_states.append({
        'name': 'Bearing/Tilting (J4.3.1)',
        'Rn': round(Pns, 3),
        'phi': PHI_SCREW['bearing'],
        'omega': OMEGA_SCREW['bearing'],
        'formula': f'Pns = {Pns:.3f} kips',
        'equation': eq_bear,
    })

    # (b) 나사 전단 (J4.3.2)
    As = math.pi / 4 * d ** 2
    Pss = 0.50 * Fub * As * n
    limit_states.append({
        'name': 'Screw Shear (J4.3.2)',
        'Rn': round(Pss, 3),
        'phi': PHI_SCREW['shear'],
        'omega': OMEGA_SCREW['shear'],
        'formula': f'Pss = 0.5×{Fub}×{As:.4f}×{n} = {Pss:.3f}',
        'equation': 'J4.3.2',
    })

    # (c) 풀아웃 (J4.4.1)
    Pnot = 0.85 * t1 * d * Fu * n
    limit_states.append({
        'name': 'Pull-out (J4.4.1)',
        'Rn': round(Pnot, 3),
        'phi': PHI_SCREW['pullout'],
        'omega': OMEGA_SCREW['pullout'],
        'formula': f'Pnot = 0.85×{t1}×{d}×{Fu}×{n} = {Pnot:.3f}',
        'equation': 'J4.4.1-1',
    })

    # (d) 풀오버 (J4.4.2)
    dw = min(d * 2.0, 0.75)  # 와셔 직경 (보수적 추정)
    Pnov = 0.85 * t2 * dw * Fu * n
    limit_states.append({
        'name': 'Pull-over (J4.4.2)',
        'Rn': round(Pnov, 3),
        'phi': PHI_SCREW['pullover'],
        'omega': OMEGA_SCREW['pullover'],
        'formula': f'Pnov = 0.85×{t2}×{dw:.3f}×{Fu}×{n} = {Pnov:.3f}',
        'equation': 'J4.4.2-1',
    })

    # 설계강도 계산
    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    return {
        'connection_type': 'screw',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J4.3.1', 'J4.3.2', 'J4.4.1', 'J4.4.2'],
    }


# ============================================================
# 필릿 용접 (J2.1)
# ============================================================

def fillet_weld_connection(t1: float, t2: float,
                          weld_size: float, weld_length: float,
                          Fy: float, Fu: float,
                          Fxx: float = 60,
                          n_welds: int = 1,
                          design_method: str = 'LRFD') -> dict:
    """필릿 용접 접합 설계 (§J2.1, §J2.2.2.1)

    Args:
        t1, t2: 연결판 두께 (in)
        weld_size: 용접 크기 (레그 크기, in)
        weld_length: 용접 길이 (in)
        Fy, Fu: 모재 항복/인장강도 (ksi)
        Fxx: 용접봉 강도 (ksi, 기본 E60)
        n_welds: 용접선 수 (양면 용접 = 2)
    """
    t_min = min(t1, t2)
    limit_states = []

    # 용접 목두께
    te = weld_size * 0.707  # 45도 필릿의 유효 목두께

    # (a) 용접 전단 강도 (J2.1)
    # Rn = 0.75 × te × L × Fxx (용접부 전단)
    Rn_weld = 0.75 * te * weld_length * Fxx * n_welds
    limit_states.append({
        'name': 'Weld Shear (J2.1)',
        'Rn': round(Rn_weld, 3),
        'phi': PHI_WELD['weld_shear'],
        'omega': OMEGA_WELD['weld_shear'],
        'formula': f'Rn = 0.75×{te:.4f}×{weld_length}×{Fxx}×{n_welds} = {Rn_weld:.3f}',
        'equation': 'J2.1',
    })

    # (b) 모재 전단 파단 (J2.2.2.1)
    # 횡방향 용접: Rn = t × L × Fu
    Rn_sheet = t_min * weld_length * Fu * n_welds
    limit_states.append({
        'name': 'Sheet Shear (J2.2.2.1)',
        'Rn': round(Rn_sheet, 3),
        'phi': PHI_WELD['sheet_shear'],
        'omega': OMEGA_WELD['sheet_shear'],
        'formula': f'Rn = {t_min}×{weld_length}×{Fu}×{n_welds} = {Rn_sheet:.3f}',
        'equation': 'J2.2.2.1-1',
    })

    # 설계강도 계산
    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    return {
        'connection_type': 'fillet_weld',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J2.1', 'J2.2.2.1'],
    }


# ============================================================
# 아크 스팟 용접 (J2.2.1)
# ============================================================

def arc_spot_weld_connection(t1: float, t2: float,
                             da: float, Fy: float, Fu: float,
                             Fxx: float = 60,
                             n: int = 1,
                             design_method: str = 'LRFD') -> dict:
    """아크 스팟 용접 (너겟 용접) 접합 설계 (§J2.2.1)

    Args:
        t1, t2: 연결판 두께 (in)
        da: 용접 너겟 직경 (in) — 가시 직경
        Fy, Fu: 모재 강도 (ksi)
        Fxx: 용접봉 강도 (ksi)
        n: 용접점 개수
    """
    t_min = min(t1, t2)
    limit_states = []

    # 유효 직경: de = 0.7d - 1.5t ≥ 0.55d (J2.2.1)
    de = max(0.7 * da - 1.5 * t_min, 0.55 * da)

    # (a) 용접부 전단 (J2.2.1.1)
    Ae_weld = math.pi / 4 * de ** 2
    Rn_weld = 0.75 * Fxx * Ae_weld * n
    limit_states.append({
        'name': 'Weld Nugget Shear (J2.2.1.1)',
        'Rn': round(Rn_weld, 3),
        'phi': 0.60,
        'omega': 2.50,
        'formula': f'Rn = 0.75×{Fxx}×π/4×{de:.3f}²×{n} = {Rn_weld:.3f}',
        'equation': 'J2.2.1.1',
    })

    # (b) 모재 인열 (J2.2.1.2) — 얇은 판 주위 인열파단
    Rn_tear = 2.20 * t_min * da * Fu * n
    limit_states.append({
        'name': 'Sheet Tear (J2.2.1.2)',
        'Rn': round(Rn_tear, 3),
        'phi': 0.60,
        'omega': 2.50,
        'formula': f'Rn = 2.20×{t_min}×{da}×{Fu}×{n} = {Rn_tear:.3f}',
        'equation': 'J2.2.1.2',
    })

    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    return {
        'connection_type': 'arc_spot_weld',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J2.2.1'],
    }


# ============================================================
# 그루브 용접 (J2.3)
# ============================================================

def groove_weld_connection(t1: float, t2: float,
                           weld_length: float,
                           Fy: float, Fu: float,
                           Fxx: float = 60,
                           groove_type: str = 'complete',
                           design_method: str = 'LRFD') -> dict:
    """그루브 용접 접합 설계 (§J2.3)

    Args:
        t1, t2: 연결판 두께 (in)
        weld_length: 용접 길이 (in)
        groove_type: 'complete' (완전용입) or 'partial' (부분용입)
    """
    t_min = min(t1, t2)
    limit_states = []

    if groove_type == 'complete':
        # 완전용입 그루브 용접: 모재 강도 = 용접 강도
        # 인장/압축: Rn = t × L × Fu
        Rn_base = t_min * weld_length * Fu
        limit_states.append({
            'name': 'Base Metal (J2.3)',
            'Rn': round(Rn_base, 3),
            'phi': 0.90,
            'omega': 1.67,
            'formula': f'Rn = {t_min}×{weld_length}×{Fu} = {Rn_base:.3f}',
            'equation': 'J2.3 (CJP)',
        })
    else:
        # 부분용입: 유효 목두께 = 모재 두께의 보수적 비율
        te = t_min * 0.5  # 보수적 유효 목두께
        Rn_weld = 0.75 * Fxx * te * weld_length
        Rn_base = t_min * weld_length * Fu

        limit_states.append({
            'name': 'Weld Throat (J2.3)',
            'Rn': round(Rn_weld, 3),
            'phi': 0.60,
            'omega': 2.50,
            'formula': f'Rn = 0.75×{Fxx}×{te:.3f}×{weld_length} = {Rn_weld:.3f}',
            'equation': 'J2.3 (PJP weld)',
        })
        limit_states.append({
            'name': 'Base Metal (J2.3)',
            'Rn': round(Rn_base, 3),
            'phi': 0.90,
            'omega': 1.67,
            'formula': f'Rn = {t_min}×{weld_length}×{Fu} = {Rn_base:.3f}',
            'equation': 'J2.3 (PJP base)',
        })

    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    return {
        'connection_type': 'groove_weld',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J2.3'],
    }


# ============================================================
# 아크 시임 용접 (J2.2.2)
# ============================================================

def arc_seam_weld_connection(t1: float, t2: float,
                              d: float, L_seam: float,
                              Fy: float, Fu: float,
                              Fxx: float = 60,
                              n: int = 1,
                              design_method: str = 'LRFD') -> dict:
    """아크 시임 용접 접합 설계 (§J2.2.2)

    Args:
        t1, t2: 연결판 두께 (in)
        d: 용접 너비 (in)
        L_seam: 시임 용접 길이 (in)
        Fy, Fu: 모재 강도 (ksi)
        Fxx: 용접봉 강도 (ksi)
        n: 용접선 수
    """
    t_min = min(t1, t2)
    limit_states = []

    # 유효 너비
    de = max(0.7 * d - 1.5 * t_min, 0.55 * d)

    # (a) 용접부 전단 (J2.2.2.1)
    # Rn = 0.75 × Fxx × (2.5t × L + π/4 × de²)  per seam
    Ae_weld = 2.5 * t_min * L_seam + math.pi / 4 * de ** 2
    Rn_weld = 0.75 * Fxx * Ae_weld * n
    limit_states.append({
        'name': 'Weld Seam Shear (J2.2.2.1)',
        'Rn': round(Rn_weld, 3),
        'phi': 0.60,
        'omega': 2.50,
        'formula': f'Rn = 0.75×{Fxx}×(2.5×{t_min}×{L_seam}+π/4×{de:.3f}²)×{n} = {Rn_weld:.3f}',
        'equation': 'J2.2.2.1',
    })

    # (b) 모재 인열 (J2.2.2.1)
    Rn_tear = 2.5 * t_min * Fu * (0.25 * L_seam + de) * n
    limit_states.append({
        'name': 'Sheet Tear (J2.2.2.1)',
        'Rn': round(Rn_tear, 3),
        'phi': 0.60,
        'omega': 2.50,
        'formula': f'Rn = 2.5×{t_min}×{Fu}×(0.25×{L_seam}+{de:.3f})×{n} = {Rn_tear:.3f}',
        'equation': 'J2.2.2.1-2',
    })

    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    return {
        'connection_type': 'arc_seam',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J2.2.2'],
    }


# ============================================================
# PAF 화약작동 체결재 (J5)
# ============================================================

# PAF φ and Ω
PHI_PAF = {'shear': 0.50, 'pullout': 0.50, 'pullover': 0.50}
OMEGA_PAF = {'shear': 3.00, 'pullout': 3.00, 'pullover': 3.00}


def paf_connection(t1: float, t2: float, d: float,
                   Fy: float, Fu: float, Fuf: float,
                   n: int = 1,
                   design_method: str = 'LRFD') -> dict:
    """화약작동 체결재(PAF) 접합 설계 (§J5)

    Args:
        t1: 상부판(풀오버 측) 두께 (in)
        t2: 하부판(풀아웃 측) 또는 지지 부재 두께 (in)
        d: PAF 핀 직경 (in)
        Fy, Fu: 상부판 모재 강도 (ksi)
        Fuf: PAF 핀 인장강도 (ksi, 일반 50~65)
        n: 체결재 개수
    """
    limit_states = []

    # (a) 전단 지압 (J5.3.1) — 얇은 판 지배
    Pns = 3.2 * t1 * d * Fu * n
    limit_states.append({
        'name': 'Bearing (J5.3.1)',
        'Rn': round(Pns, 3),
        'phi': PHI_PAF['shear'],
        'omega': OMEGA_PAF['shear'],
        'formula': f'Pns = 3.2×{t1}×{d}×{Fu}×{n} = {Pns:.3f}',
        'equation': 'J5.3.1',
    })

    # (b) 핀 전단 (J5.3.2)
    Af = math.pi / 4 * d ** 2
    Pnf = 0.50 * Fuf * Af * n
    limit_states.append({
        'name': 'Pin Shear (J5.3.2)',
        'Rn': round(Pnf, 3),
        'phi': PHI_PAF['shear'],
        'omega': OMEGA_PAF['shear'],
        'formula': f'Pnf = 0.50×{Fuf}×{Af:.4f}×{n} = {Pnf:.3f}',
        'equation': 'J5.3.2',
    })

    # (c) 풀아웃 (J5.4.1)
    Pnot = 1.01 * t2 * d * Fu * n
    limit_states.append({
        'name': 'Pull-out (J5.4.1)',
        'Rn': round(Pnot, 3),
        'phi': PHI_PAF['pullout'],
        'omega': OMEGA_PAF['pullout'],
        'formula': f'Pnot = 1.01×{t2}×{d}×{Fu}×{n} = {Pnot:.3f}',
        'equation': 'J5.4.1',
    })

    # (d) 풀오버 (J5.4.2)
    dw = min(d * 2.5, 0.75)  # 와셔 직경 보수적 추정
    Pnov = 0.85 * t1 * dw * Fu * n
    limit_states.append({
        'name': 'Pull-over (J5.4.2)',
        'Rn': round(Pnov, 3),
        'phi': PHI_PAF['pullover'],
        'omega': OMEGA_PAF['pullover'],
        'formula': f'Pnov = 0.85×{t1}×{dw:.3f}×{Fu}×{n} = {Pnov:.3f}',
        'equation': 'J5.4.2',
    })

    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    return {
        'connection_type': 'paf',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J5.3.1', 'J5.3.2', 'J5.4.1', 'J5.4.2'],
    }


# ============================================================
# 디스패처
# ============================================================

def design_connection(params: dict) -> dict:
    """접합부 설계 디스패처"""
    conn_type = params.get('connection_type', 'bolt')
    design_method = params.get('design_method', 'LRFD')
    Fy = params.get('Fy', 35.53)
    Fu = params.get('Fu', 58.02)
    t1 = params.get('t1', 0.059)
    t2 = params.get('t2', t1)
    Pu = params.get('Pu', 0)

    if conn_type == 'bolt':
        result = bolt_connection(
            t1=t1, t2=t2,
            d=params.get('d', 0.5),
            Fy=Fy, Fu=Fu,
            Fub=params.get('Fub', 120),
            e=params.get('e'),
            s=params.get('s'),
            n=int(params.get('n', 1)),
            design_method=design_method,
        )
    elif conn_type == 'screw':
        result = screw_connection(
            t1=t1, t2=t2,
            d=params.get('d', 0.190),
            Fy=Fy, Fu=Fu,
            Fub=params.get('Fub', 100),
            n=int(params.get('n', 1)),
            design_method=design_method,
        )
    elif conn_type == 'fillet_weld':
        result = fillet_weld_connection(
            t1=t1, t2=t2,
            weld_size=params.get('weld_size', 0.125),
            weld_length=params.get('weld_length', 1.0),
            Fy=Fy, Fu=Fu,
            Fxx=params.get('Fxx', 60),
            n_welds=int(params.get('n', 1)),
            design_method=design_method,
        )
    elif conn_type == 'arc_spot':
        result = arc_spot_weld_connection(
            t1=t1, t2=t2,
            da=params.get('da', 0.625),
            Fy=Fy, Fu=Fu,
            Fxx=params.get('Fxx', 60),
            n=int(params.get('n', 1)),
            design_method=design_method,
        )
    elif conn_type == 'groove':
        result = groove_weld_connection(
            t1=t1, t2=t2,
            weld_length=params.get('weld_length', 1.0),
            Fy=Fy, Fu=Fu,
            Fxx=params.get('Fxx', 60),
            groove_type=params.get('groove_type', 'complete'),
            design_method=design_method,
        )
    elif conn_type == 'arc_seam':
        result = arc_seam_weld_connection(
            t1=t1, t2=t2,
            d=params.get('da', params.get('d', 0.625)),
            L_seam=params.get('weld_length', params.get('L_seam', 1.0)),
            Fy=Fy, Fu=Fu,
            Fxx=params.get('Fxx', 60),
            n=int(params.get('n', 1)),
            design_method=design_method,
        )
    elif conn_type == 'paf':
        result = paf_connection(
            t1=t1, t2=t2,
            d=params.get('d', 0.145),
            Fy=Fy, Fu=Fu,
            Fuf=params.get('Fuf', params.get('Fub', 60)),
            n=int(params.get('n', 1)),
            design_method=design_method,
        )
    else:
        return {'error': f'Unknown connection_type: {conn_type}'}

    # 활용비
    if Pu > 0 and result.get('design_strength', 0) > 0:
        util = Pu / result['design_strength']
        result['utilization'] = round(util, 4)
        result['pass'] = util <= 1.0
    else:
        result['utilization'] = None
        result['pass'] = None

    result['member_type'] = 'connection'
    result['design_method'] = design_method
    return result
