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

def _wc_row(C: float, Cr: float, CN: float, Ch: float,
            omega: float, phi: float,
            lsd_phi: float | None = None,
            rt_limit: float | None = None) -> dict:
    return {
        'C': C,
        'Cr': Cr,
        'CN': CN,
        'Ch': Ch,
        'omega': omega,
        'phi': phi,
        'lsd_phi': lsd_phi,
        'rt_limit': rt_limit,
    }


_G5_TABLES = {
    'built_up_i': {
        'table': 'G5-1',
        'per_web': False,
        'limits': {'h_t_max': 200.0, 'N_t_max': 210.0, 'N_h_max': 2.0, 'theta_min': 90.0, 'theta_max': 90.0},
        'rows': {
            ('fastened', 'stiffened', 'EOF'): _wc_row(10.0, 0.14, 0.28, 0.001, 2.00, 0.75, 0.60, 5.0),
            ('fastened', 'stiffened', 'IOF'): _wc_row(20.5, 0.17, 0.11, 0.001, 1.75, 0.85, 0.75, 5.0),
            ('fastened', 'stiffened', 'ETF'): _wc_row(15.0, 0.14, 0.28, 0.003, 2.00, 0.75, 0.60, 5.0),
            ('fastened', 'stiffened', 'ITF'): _wc_row(50.0, 0.14, 0.08, 0.04, 2.00, 0.75, 0.65, None),
            ('unfastened', 'stiffened', 'EOF'): _wc_row(10.0, 0.14, 0.28, 0.001, 2.00, 0.75, 0.60, 5.0),
            ('unfastened', 'stiffened', 'IOF'): _wc_row(20.5, 0.17, 0.11, 0.001, 1.75, 0.85, 0.75, 5.0),
            ('unfastened', 'stiffened', 'ETF'): _wc_row(15.5, 0.09, 0.08, 0.04, 2.00, 0.75, 0.65, 3.0),
            ('unfastened', 'stiffened', 'ITF'): _wc_row(36.0, 0.14, 0.08, 0.04, 2.00, 0.75, 0.65, 3.0),
            ('unfastened', 'unstiffened', 'EOF'): _wc_row(10.0, 0.14, 0.28, 0.001, 2.00, 0.75, 0.60, 5.0),
            ('unfastened', 'unstiffened', 'IOF'): _wc_row(20.5, 0.17, 0.11, 0.001, 1.75, 0.85, 0.75, 3.0),
        },
    },
    'c': {
        'table': 'G5-2',
        'per_web': False,
        'limits': {'h_t_max': 200.0, 'N_t_max': 210.0, 'N_h_max': 2.0, 'theta_min': 90.0, 'theta_max': 90.0},
        'rows': {
            ('fastened', 'stiffened', 'EOF'): _wc_row(4.0, 0.14, 0.35, 0.02, 1.75, 0.85, 0.75, 9.0),
            ('fastened', 'stiffened', 'IOF'): _wc_row(13.0, 0.23, 0.14, 0.01, 1.65, 0.90, 0.80, 5.0),
            ('fastened', 'stiffened', 'ETF'): _wc_row(7.5, 0.08, 0.12, 0.048, 1.75, 0.85, 0.75, 12.0),
            ('fastened', 'stiffened', 'ITF'): _wc_row(20.0, 0.10, 0.08, 0.031, 1.75, 0.85, 0.75, 12.0),
            ('unfastened', 'stiffened', 'EOF'): _wc_row(4.0, 0.14, 0.35, 0.02, 1.85, 0.80, 0.70, 5.0),
            ('unfastened', 'stiffened', 'IOF'): _wc_row(13.0, 0.23, 0.14, 0.01, 1.65, 0.90, 0.80, 5.0),
            ('unfastened', 'stiffened', 'ETF'): _wc_row(13.0, 0.32, 0.05, 0.04, 1.65, 0.90, 0.80, 3.0),
            ('unfastened', 'stiffened', 'ITF'): _wc_row(24.0, 0.52, 0.15, 0.001, 1.90, 0.80, 0.65, 3.0),
            ('fastened', 'unstiffened', 'EOF'): _wc_row(4.0, 0.40, 0.60, 0.03, 1.80, 0.85, 0.70, 2.0),
            ('fastened', 'unstiffened', 'IOF'): _wc_row(13.0, 0.32, 0.10, 0.01, 1.80, 0.85, 0.70, 1.0),
            ('fastened', 'unstiffened', 'ETF'): _wc_row(2.0, 0.11, 0.37, 0.01, 2.00, 0.75, 0.65, 1.0),
            ('fastened', 'unstiffened', 'ITF'): _wc_row(13.0, 0.47, 0.25, 0.04, 1.90, 0.80, 0.65, 1.0),
            ('unfastened', 'unstiffened', 'EOF'): _wc_row(4.0, 0.40, 0.60, 0.03, 1.80, 0.85, 0.70, 2.0),
            ('unfastened', 'unstiffened', 'IOF'): _wc_row(13.0, 0.32, 0.10, 0.01, 1.80, 0.85, 0.70, 1.0),
            ('unfastened', 'unstiffened', 'ETF'): _wc_row(2.0, 0.11, 0.37, 0.01, 2.00, 0.75, 0.65, 1.0),
            ('unfastened', 'unstiffened', 'ITF'): _wc_row(13.0, 0.47, 0.25, 0.04, 1.90, 0.80, 0.65, 1.0),
        },
    },
    'z': {
        'table': 'G5-3',
        'per_web': False,
        'limits': {'h_t_max': 200.0, 'N_t_max': 210.0, 'N_h_max': 2.0, 'theta_min': 90.0, 'theta_max': 90.0},
        'rows': {
            ('fastened', 'stiffened', 'EOF'): _wc_row(4.0, 0.14, 0.35, 0.02, 1.75, 0.85, 0.75, 9.0),
            ('fastened', 'stiffened', 'IOF'): _wc_row(13.0, 0.23, 0.14, 0.01, 1.65, 0.90, 0.80, 5.5),
            ('fastened', 'stiffened', 'ETF'): _wc_row(9.0, 0.05, 0.16, 0.052, 1.75, 0.85, 0.75, 12.0),
            ('fastened', 'stiffened', 'ITF'): _wc_row(24.0, 0.07, 0.07, 0.04, 1.85, 0.80, 0.70, 12.0),
            ('unfastened', 'stiffened', 'EOF'): _wc_row(5.0, 0.09, 0.02, 0.001, 1.80, 0.85, 0.75, 5.0),
            ('unfastened', 'stiffened', 'IOF'): _wc_row(13.0, 0.23, 0.14, 0.01, 1.65, 0.90, 0.80, 5.0),
            ('unfastened', 'stiffened', 'ETF'): _wc_row(13.0, 0.32, 0.05, 0.04, 1.65, 0.90, 0.80, 3.0),
            ('unfastened', 'stiffened', 'ITF'): _wc_row(24.0, 0.52, 0.15, 0.001, 1.90, 0.80, 0.65, 3.0),
            ('fastened', 'unstiffened', 'EOF'): _wc_row(4.0, 0.40, 0.60, 0.03, 1.80, 0.85, 0.70, 2.0),
            ('fastened', 'unstiffened', 'IOF'): _wc_row(13.0, 0.32, 0.10, 0.01, 1.80, 0.85, 0.70, 1.0),
            ('fastened', 'unstiffened', 'ETF'): _wc_row(2.0, 0.11, 0.37, 0.01, 2.00, 0.75, 0.65, 1.0),
            ('fastened', 'unstiffened', 'ITF'): _wc_row(13.0, 0.47, 0.25, 0.04, 1.90, 0.80, 0.65, 1.0),
            ('unfastened', 'unstiffened', 'EOF'): _wc_row(4.0, 0.40, 0.60, 0.03, 1.80, 0.85, 0.70, 2.0),
            ('unfastened', 'unstiffened', 'IOF'): _wc_row(13.0, 0.32, 0.10, 0.01, 1.80, 0.85, 0.70, 1.0),
            ('unfastened', 'unstiffened', 'ETF'): _wc_row(2.0, 0.11, 0.37, 0.01, 2.00, 0.75, 0.65, 1.0),
            ('unfastened', 'unstiffened', 'ITF'): _wc_row(13.0, 0.47, 0.25, 0.04, 1.90, 0.80, 0.65, 1.0),
        },
    },
    'hat': {
        'table': 'G5-4',
        'per_web': True,
        'limits': {'h_t_max': 200.0, 'N_t_max': 200.0, 'N_h_max': 2.0, 'theta_min': 90.0, 'theta_max': 90.0},
        'rows': {
            ('fastened', 'EOF'): _wc_row(4.0, 0.25, 0.68, 0.04, 2.00, 0.75, 0.65, 5.0),
            ('fastened', 'IOF'): _wc_row(17.0, 0.13, 0.13, 0.04, 1.80, 0.85, 0.70, 10.0),
            ('fastened', 'ETF'): _wc_row(9.0, 0.10, 0.07, 0.03, 1.75, 0.85, 0.75, 10.0),
            ('fastened', 'ITF'): _wc_row(10.0, 0.14, 0.22, 0.02, 1.80, 0.85, 0.75, None),
            ('unfastened', 'EOF'): _wc_row(4.0, 0.25, 0.68, 0.04, 2.00, 0.75, 0.65, 5.0),
            ('unfastened', 'IOF'): _wc_row(17.0, 0.13, 0.13, 0.04, 1.80, 0.85, 0.70, 10.0),
        },
    },
    'multi_web': {
        'table': 'G5-5',
        'per_web': True,
        'limits': {'h_t_max': 200.0, 'N_t_max': 210.0, 'N_h_max': 3.0, 'theta_min': 45.0, 'theta_max': 90.0},
        'rows': {
            ('fastened', 'EOF'): _wc_row(4.0, 0.04, 0.25, 0.025, 1.70, 0.90, 0.80, 20.0),
            ('fastened', 'IOF'): _wc_row(8.0, 0.10, 0.17, 0.004, 1.75, 0.85, 0.75, None),
            ('fastened', 'ETF'): _wc_row(9.0, 0.12, 0.14, 0.040, 1.80, 0.85, 0.70, 10.0),
            ('fastened', 'ITF'): _wc_row(10.0, 0.11, 0.21, 0.020, 1.75, 0.85, 0.75, None),
            ('unfastened', 'EOF'): _wc_row(3.0, 0.04, 0.29, 0.028, 2.45, 0.60, 0.50, 20.0),
            ('unfastened', 'IOF'): _wc_row(8.0, 0.10, 0.17, 0.004, 1.75, 0.85, 0.75, None),
            ('unfastened', 'ETF'): _wc_row(6.0, 0.16, 0.15, 0.050, 1.65, 0.90, 0.80, 5.0),
            ('unfastened', 'ITF'): _wc_row(17.0, 0.10, 0.10, 0.046, 1.65, 0.90, 0.80, None),
        },
    },
}


def _normalize_fastened(fastened: str | None) -> str:
    return 'unfastened' if str(fastened or '').strip().lower() == 'unfastened' else 'fastened'


def _normalize_support(support: str | None) -> str:
    sup = str(support or 'EOF').strip().upper()
    return sup if sup in ('EOF', 'IOF', 'ETF', 'ITF') else 'EOF'


def _normalize_section_family(section_family: str | None = None,
                              section_type: str | None = None) -> str:
    raw = str(section_family or section_type or 'C').strip().lower().replace('-', '_')
    if raw in ('built_up_i', 'buildupi', 'built_up', 'builtup_i', 'i', 'i_section', 'built_up_i_section'):
        return 'built_up_i'
    if raw.startswith('z'):
        return 'z'
    if raw.startswith('hat'):
        return 'hat'
    if raw in ('multi_web', 'multiweb', 'deck', 'multi_web_deck'):
        return 'multi_web'
    return 'c'


def _normalize_flange_condition(flange_condition: str | None,
                                section_family: str) -> str:
    raw = str(flange_condition or '').strip().lower().replace('-', '_')
    if section_family in ('hat', 'multi_web'):
        return 'stiffened'
    if raw in ('unstiffened', 'unreinforced'):
        return 'unstiffened'
    return 'stiffened'


def _default_n_webs(section_family: str, n_webs: int | float | None) -> int:
    if section_family == 'hat':
        base = 2
    elif section_family == 'multi_web':
        base = 2
    else:
        base = 1
    try:
        n = int(float(n_webs)) if n_webs is not None else base
    except Exception:
        n = base
    return max(n, base)


def _support_location(support: str) -> str:
    return 'end' if support.startswith('E') else 'interior'


def _support_load_case(support: str) -> str:
    return 'one_flange' if support.endswith('OF') else 'two_flange'


def classify_web_crippling_case(h: float, t: float, R: float, N: float,
                                theta: float = 90,
                                support: str = 'EOF',
                                fastened: str = 'fastened',
                                section_type: str = 'C',
                                section_family: str | None = None,
                                flange_condition: str | None = None,
                                Lo: float | None = None,
                                edge_distance: float | None = None,
                                n_webs: int | float | None = None,
                                web_config: str = 'single',
                                bearing_case: str | None = None,
                                support_fastener_spacing: float | None = None) -> dict:
    family = _normalize_section_family(section_family, section_type)
    sup = _normalize_support(support)
    fas = _normalize_fastened(fastened)
    edge_val = None
    if edge_distance is not None:
        try:
            parsed_edge = float(edge_distance)
            if parsed_edge > 0:
                edge_val = parsed_edge
        except Exception:
            edge_val = None
    warnings: list[str] = []
    assumptions: list[str] = []

    if family == 'multi_web' and support_fastener_spacing is not None and support_fastener_spacing > 18.0:
        if fas != 'unfastened':
            warnings.append('Multi-web deck with support fastener spacing > 18 in. is treated as unfastened per Table G5-5 note.')
        fas = 'unfastened'

    flange = _normalize_flange_condition(flange_condition, family)
    webs = _default_n_webs(family, n_webs)
    if family in ('c', 'z') and webs > 1:
        warnings.append('Single-web C/Z coefficients were requested with n_webs > 1. Using one web only; use section_family=multi_web for deck sections.')
        webs = 1
    if family == 'built_up_i' and webs > 1:
        assumptions.append('Built-up I-section strength is taken directly from Table G5-1 without multiplying by n_webs.')
        webs = 1

    table_meta = _G5_TABLES.get(family)
    if table_meta is None:
        return {'error': f'Unsupported section_family for G5: {family}'}

    if family in ('built_up_i', 'c', 'z'):
        row = table_meta['rows'].get((fas, flange, sup))
        if row is None and family == 'built_up_i':
            return {
                'error': f'Table G5-1 data for built-up I-section case ({fas}, {flange}, {sup}) is not available in the current implementation.',
                'warnings': ['Built-up I-section unstiffened two-flange rows are not implemented.'],
            }
    else:
        row = table_meta['rows'].get((fas, sup))
        if row is None and family == 'hat':
            return {
                'error': f'Table G5-4 data for hat section case ({fas}, {sup}) is not available in the current implementation.',
                'warnings': ['Hat section unfastened two-flange rows are not implemented.'],
            }

    if row is None:
        return {'error': f'Unknown web crippling case: family={family}, fastened={fas}, support={sup}'}

    loc = _support_location(sup)
    load_case = _support_load_case(sup)
    explicit_bearing_case = str(bearing_case or '').strip().lower()
    lo_val = float(Lo or 0.0)
    is_overhang_length = lo_val > 0 and h > 0 and lo_val <= 1.5 * h
    if lo_val > 0 and sup == 'EOF' and h > 0 and lo_val > 1.5 * h:
        assumptions.append(f'Lo={lo_val:.3f} in exceeds 1.5h={1.5 * h:.3f} in, so the case is treated as standard EOF instead of overhang per §G5 definition.')
    if explicit_bearing_case in ('overhang', 'overhang_bearing') and not is_overhang_length:
        warnings.append('Explicit overhang_bearing was requested, but Lo does not satisfy the §G5 overhang definition (Lo ≤ 1.5h). Falling back to standard bearing case.')
    if (explicit_bearing_case in ('overhang', 'overhang_bearing') and is_overhang_length) or (is_overhang_length and sup == 'EOF'):
        bcase = 'overhang_bearing'
    elif loc == 'end':
        bcase = 'end_bearing'
    else:
        bcase = 'interior_bearing'

    if bcase == 'overhang_bearing' and not (family in ('c', 'z') and sup == 'EOF'):
        warnings.append('Overhang bearing (Eq. G5-2) applies only to EOF loading on C/Z sections. Falling back to Eq. G5-1.')
        bcase = 'end_bearing' if loc == 'end' else 'interior_bearing'

    equation = 'G5-2' if bcase == 'overhang_bearing' else 'G5-1'

    h_t = h / t if h > 0 and t > 0 else 0
    N_t = N / t if N > 0 and t > 0 else 0
    N_h = N / h if N > 0 and h > 0 else 0
    R_t = R / t if R > 0 and t > 0 else 0
    limits = table_meta['limits']
    if h_t > limits['h_t_max']:
        warnings.append(f'h/t={h_t:.1f} exceeds Table {table_meta["table"]} applicability limit of {limits["h_t_max"]:.0f}.')
    if N_t > limits['N_t_max']:
        warnings.append(f'N/t={N_t:.1f} exceeds Table {table_meta["table"]} applicability limit of {limits["N_t_max"]:.0f}.')
    if N_h > limits['N_h_max']:
        warnings.append(f'N/h={N_h:.3f} exceeds Table {table_meta["table"]} applicability limit of {limits["N_h_max"]:.1f}.')
    if not (limits['theta_min'] <= theta <= limits['theta_max']):
        warnings.append(
            f'θ={theta:.1f}° is outside Table {table_meta["table"]} applicability range '
            f'{limits["theta_min"]:.0f}°–{limits["theta_max"]:.0f}°.'
        )
    if row.get('rt_limit') is not None and R_t > row['rt_limit']:
        warnings.append(f'R/t={R_t:.2f} exceeds row applicability limit of {row["rt_limit"]:.1f}.')
    if family in ('built_up_i', 'c', 'z') and sup == 'ITF':
        req = 2.5 if fas == 'fastened' else 1.5
        required_edge_distance = req * h
        if edge_val is None:
            assumptions.append(f'ITF edge distance extension ≥ {req:.1f}h is assumed; current input set does not verify it directly.')
        else:
            if edge_val + 1e-9 < required_edge_distance:
                warnings.append(
                    f'Provided ITF edge distance {edge_val:.3f} in is smaller than the required {required_edge_distance:.3f} in (={req:.1f}h).'
                )
            else:
                assumptions.append(
                    f'Provided ITF edge distance {edge_val:.3f} in satisfies the ≥ {required_edge_distance:.3f} in (={req:.1f}h) requirement.'
                )
    if family == 'hat':
        assumptions.append(f'Table G5-4 is per web. Total nominal strength uses n_webs={webs}.')
    if family == 'multi_web':
        assumptions.append(f'Table G5-5 is per web. Total nominal strength uses n_webs={webs}.')
    if family == 'built_up_i':
        assumptions.append('Built-up I-section strength uses Table G5-1 directly and is not multiplied by number of webs.')

    h3_applicable = True
    h3_reason = ''
    web_cfg = str(web_config or 'single').strip().lower()
    if bcase == 'overhang_bearing':
        h3_applicable = False
        h3_reason = 'H3 applicability for overhang-bearing web crippling is not implemented.'
    elif family in ('hat', 'built_up_i'):
        h3_applicable = False
        h3_reason = 'H3 applicability for this section family is not implemented.'

    if web_cfg == 'nested_z':
        h3_candidate = 'H3-2'
    elif web_cfg == 'multi_web':
        h3_candidate = 'H3-3'
    else:
        h3_candidate = 'H3-1'

    return {
        'section_family': family,
        'section_type': str(section_type or '').upper() or family.upper(),
        'support': sup,
        'fastened': fas,
        'flange_condition': flange,
        'load_case': load_case,
        'location': loc,
        'bearing_case': bcase,
        'equation': equation,
        'table': table_meta['table'],
        'row': row,
        'Lo': lo_val if lo_val > 0 else None,
        'edge_distance': edge_val,
        'n_webs': webs,
        'assumptions': assumptions,
        'warnings': warnings,
        'h3_applicable': h3_applicable,
        'h3_equation_candidate': h3_candidate,
        'h3_not_applicable_reason': h3_reason,
    }


def _solve_g51(case: dict, h: float, t: float, R: float, N: float,
               Fy: float, theta: float) -> dict:
    row = case['row']
    theta_rad = math.radians(theta)
    sin_theta = math.sin(theta_rad)

    Rt = math.sqrt(R / t) if R > 0 and t > 0 else 0
    Nt = math.sqrt(N / t) if N > 0 and t > 0 else 0
    ht = math.sqrt(h / t) if h > 0 and t > 0 else 0

    term1 = max(1 - row['Cr'] * Rt, 0)
    term2 = 1 + row['CN'] * Nt
    term3 = max(1 - row['Ch'] * ht, 0)

    Pn_per_web = row['C'] * t ** 2 * Fy * sin_theta * term1 * term2 * term3
    multiplier = case['n_webs'] if case.get('section_family') in ('hat', 'multi_web') else 1
    Pn_total = Pn_per_web * multiplier

    return {
        'Pn_per_web': Pn_per_web,
        'Pn': Pn_total,
        'phi': row['phi'],
        'omega': row['omega'],
        'lsd_phi': row.get('lsd_phi'),
        'formula': (
            f'Pn = {row["C"]}×t²×Fy×sin({theta}°)'
            f'×(1-{row["Cr"]}√(R/t))×(1+{row["CN"]}√(N/t))×(1-{row["Ch"]}√(h/t))'
        ),
        'multiplier': multiplier,
    }


def _solve_g52_overhang(case: dict, h: float, t: float, R: float, N: float,
                        Fy: float, theta: float,
                        Lo: float | None) -> dict:
    lo_val = float(Lo or 0.0)
    eof_case = dict(case)
    eof_case['equation'] = 'G5-1'
    base = _solve_g51(eof_case, h, t, R, N, Fy, theta)

    alpha = 1.0
    warnings = list(case.get('warnings', []))
    if h > 0 and t > 0:
        lo_h = lo_val / h if lo_val > 0 else 0
        h_t = h / t
        if 0.5 <= lo_h <= 1.5 and h_t <= 154:
            alpha = max(1.34 * (lo_h ** 0.26) / (0.009 * h_t + 0.3), 1.0)
        else:
            warnings.append('Overhang Eq. G5-2 applicability limits not met (0.5 ≤ Lo/h ≤ 1.5 and h/t ≤ 154); using α = 1.0.')
    else:
        warnings.append('Invalid h/t for overhang evaluation; using α = 1.0.')

    interior_case = classify_web_crippling_case(
        h=h, t=t, R=R, N=N, theta=theta,
        support='IOF',
        fastened=case['fastened'],
        section_type=case['section_type'],
        section_family=case['section_family'],
        flange_condition=case['flange_condition'],
        Lo=None,
        n_webs=case.get('n_webs', 1),
        web_config='single',
    )
    interior = _solve_g51(interior_case, h, t, R, N, Fy, theta)

    Pnc_raw = alpha * base['Pn']
    Pnc = min(Pnc_raw, interior['Pn'])
    return {
        **base,
        'Pn': Pnc,
        'Pnc_raw': Pnc_raw,
        'Pn_interior_cap': interior['Pn'],
        'alpha': alpha,
        'Lo': lo_val,
        'cap_applied': Pnc < Pnc_raw - 1e-9,
        'warnings': warnings,
        'formula': f'Pnc = min(α·Pn_EOF, Pn_IOF), α = {alpha:.3f}',
    }


def web_crippling(h: float, t: float, R: float, N: float,
                  Fy: float, theta: float = 90,
                  support: str = 'EOF',
                  fastened: str = 'fastened',
                  section_type: str = 'C',
                  section_family: str | None = None,
                  flange_condition: str | None = None,
                  Lo: float | None = None,
                  edge_distance: float | None = None,
                  n_webs: int | float | None = None,
                  web_config: str = 'single',
                  bearing_case: str | None = None,
                  support_fastener_spacing: float | None = None) -> dict:
    """웹 크리플링 강도 (§G5, Eq. G5-1 / Eq. G5-2)

    Pn = C × t² × Fy × sin(θ) × (1 - Cr√(R/t)) × (1 + CN√(N/t)) × (1 - Ch√(h/t))

    Args:
        h: 웹 평면폭 (in)
        t: 웹 두께 (in)
        R: 내측 굽힘 반경 (in)
        N: 지압 길이 (in)
        Fy: 항복강도 (ksi)
        theta: 웹과 지압면 사이 각도 (deg, 기본 90)
        support: 'EOF' | 'IOF' | 'ETF' | 'ITF'
        fastened: 'fastened' | 'unfastened'
        section_type: 'C' (Table G5-2) | 'Z' (Table G5-3)
        section_family: 'C' | 'Z' | 'hat' | 'multi_web'
        flange_condition: 'stiffened' | 'unstiffened' (C/Z only)
        Lo: Overhang length for Eq. G5-2 (in)
        edge_distance: Distance from bearing edge to member end for ITF applicability checks (in)
        n_webs: Number of webs at the section (hat/multi-web total strength)
        web_config: H3 classifier hint ('single' | 'nested_z' | 'multi_web')
        bearing_case: Optional explicit override ('overhang_bearing', ...)
        support_fastener_spacing: For multi-web deck note (>18 in → unfastened)

    Returns:
        dict: {Pn, phi, omega, equation, ...}
    """
    case = classify_web_crippling_case(
        h=h, t=t, R=R, N=N,
        theta=theta,
        support=support,
        fastened=fastened,
        section_type=section_type,
        section_family=section_family,
        flange_condition=flange_condition,
        Lo=Lo,
        edge_distance=edge_distance,
        n_webs=n_webs,
        web_config=web_config,
        bearing_case=bearing_case,
        support_fastener_spacing=support_fastener_spacing,
    )
    if 'error' in case:
        return case

    if case['equation'] == 'G5-2':
        solved = _solve_g52_overhang(case, h, t, R, N, Fy, theta, Lo)
        warnings = solved.pop('warnings', [])
    else:
        solved = _solve_g51(case, h, t, R, N, Fy, theta)
        warnings = list(case.get('warnings', []))

    return {
        'Pn': round(solved['Pn'], 3),
        'Pn_per_web': round(solved['Pn_per_web'], 3),
        'phi': solved['phi'],
        'omega': solved['omega'],
        'support': case['support'],
        'fastened': case['fastened'],
        'section_type': case['section_type'],
        'section_family': case['section_family'],
        'flange_condition': case['flange_condition'],
        'equation': case['equation'],
        'table': case['table'],
        'load_case': case['load_case'],
        'location': case['location'],
        'bearing_case': case['bearing_case'],
        'n_webs': case['n_webs'],
        'assumptions': case.get('assumptions', []),
        'warnings': warnings,
        'h3_applicable': case['h3_applicable'],
        'h3_equation_candidate': case['h3_equation_candidate'],
        'h3_not_applicable_reason': case['h3_not_applicable_reason'],
        'phi_Pn': round(solved['phi'] * solved['Pn'], 3),
        'Pa': round(solved['Pn'] / solved['omega'], 3) if solved['omega'] > 0 else None,
        'alpha': round(solved.get('alpha', 1.0), 4),
        'Lo': round(float(Lo or 0.0), 4) if Lo is not None else None,
        'edge_distance': round(case['edge_distance'], 4) if case.get('edge_distance') is not None else None,
        'Pn_interior_cap': round(solved.get('Pn_interior_cap', 0.0), 3) if solved.get('Pn_interior_cap') is not None else None,
        'cap_applied': solved.get('cap_applied', False),
        'formula': f'{solved["formula"]} = {solved["Pn"]:.3f} kips [{case["table"]}]',
        'spec_sections': ['G5'],
    }
