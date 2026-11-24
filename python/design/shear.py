"""전단 강도 및 웹 크리플링 — AISI S100-16 Chapters G2, G5"""

import math

from design.steel_grades import E as E_STEEL
from design.notices import N as _nt  # noqa: E402


# Chapter G 가운데 이 모듈이 다루지 않는 조항 — 결과의 assumptions 에 그대로 남긴다.
_SHEAR_SCOPE_NOTE = _nt('shear.scope.g2_1_web_without_holes')
_WC_SCOPE_NOTE = _nt('shear.scope.g5_web_without_holes')


def shear_strength(h: float, t: float, Fy: float,
                   E: float = E_STEEL, kv: float = 5.34,
                   web_holes: bool = False,
                   transverse_stiffeners: bool = False) -> dict:
    """웹 전단 강도 (§G2.1, 횡보강재 없음)

    범위 한정: 본 함수는 §G2.1 (구멍·횡보강재 없는 웹)만 구현한다. 횡보강재가 있는
    웹에 대한 §G2.2 곡선(λv≤0.776에서 Vn=Vy)과 §G2.3(b) Eq. G2.3-3/4 의 kv
    (=4.00+5.34/(a/h)² 또는 5.34+4.00/(a/h)²)는 미구현이며, 이는 보수적
    (더 낮은 강도) 결과를 준다. 기본 kv=5.34는 §G2.3(a) 비보강 웹 값이다.
    구멍이 있는 웹(§G3 qs 감소)은 구현하지 않았으므로 web_holes=True 이면 오류를 낸다.

    Args:
        h: 웹 평면폭 (in)
        t: 웹 두께 (in)
        Fy: 항복강도 (ksi)
        kv: 전단좌굴 계수 (기본 5.34, §G2.3(a) 비보강 웹)
        web_holes: 웹에 구멍이 있으면 True (§G3 미구현 → error)
        transverse_stiffeners: 횡보강재가 있으면 True (§G2.2 미구현 → §G2.1 로 보수 계산, 경고)
    """
    if web_holes:
        return {
            'error': '§G3 shear strength of webs with holes is not implemented; '
                     'the qs reduction cannot be applied, so no shear strength is reported.',
            'warnings': ['§G3 (webs with holes) not evaluated.'],
            'assumptions': [],
            'scope_notes': [_SHEAR_SCOPE_NOTE],
        }
    # 퇴화/무효 입력 가드 (§G2.1): Vcr 계산의 (t/h)**2 평가 전에 검증하여
    # h=0 등에서 ZeroDivisionError 방지. 정상 경로와 동일한 키 집합/일관된
    # 점표기(G2.1) 라벨로 반환.
    if h <= 0 or t <= 0 or Fy <= 0:
        return {'Vn': 0, 'Vy': 0, 'Vcr': 0, 'lambda_v': 0, 'equation': 'G2.1 (degenerate)',
                'warnings': ['h, t or Fy is not positive; shear strength not evaluated.'],
                'assumptions': [], 'scope_notes': [_SHEAR_SCOPE_NOTE]}

    warnings = []
    if transverse_stiffeners or abs(kv - 5.34) > 1e-9:
        warnings.append(_nt('shear.warning.g2_2_g2_webs_transverse_stiffeners'))

    Vy = 0.60 * Fy * h * t
    Vcr = (math.pi ** 2 * E * kv) / (12 * (1 - 0.3 ** 2)) * (t / h) ** 2 * h * t

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
        'warnings': warnings,
        'assumptions': [],
        'scope_notes': [_SHEAR_SCOPE_NOTE],
    }


# ============================================================
# 웹 크리플링 (§G5)
# ============================================================

def _wc_row(C: float, Cr: float, CN: float, Ch: float,
            omega: float, phi: float,
            lsd_phi: float | None = None,
            rt_limit: float | None = None,
            d_min: float | None = None) -> dict:
    return {
        'C': C,
        'Cr': Cr,
        'CN': CN,
        'Ch': Ch,
        'omega': omega,
        'phi': phi,
        'lsd_phi': lsd_phi,
        'rt_limit': rt_limit,
        'd_min': d_min,
    }


# Tables G5-1 … G5-5 를 원문 행 그대로 옮겼다. 원문에 없는 행은 두지 않는다 —
# 없는 조합은 "Table G5-x 가 다루지 않음" 오류가 된다(다른 행으로 채우지 않는다).
# rowspan 으로 두 행에 걸친 한계 칸은 두 행 모두에 적었다.
_G5_TABLES = {
    'built_up_i': {
        'table': 'G5-1',
        'per_web': True,   # 표 제목 "…for Built-Up Sections per Web" (Commentary G5: 2012 개정)
        'limits': {'h_t_max': 200.0, 'N_t_max': 210.0, 'N_h_max': 1.0, 'theta_min': 90.0, 'theta_max': 90.0},
        'rows': {
            ('fastened', 'stiffened', 'EOF'): _wc_row(10.0, 0.14, 0.28, 0.001, 2.00, 0.75, 0.60, 5.0),
            ('fastened', 'stiffened', 'IOF'): _wc_row(20.5, 0.17, 0.11, 0.001, 1.75, 0.85, 0.75, 5.0),
            ('unfastened', 'stiffened', 'EOF'): _wc_row(10.0, 0.14, 0.28, 0.001, 2.00, 0.75, 0.60, 5.0),
            ('unfastened', 'stiffened', 'IOF'): _wc_row(20.5, 0.17, 0.11, 0.001, 1.75, 0.85, 0.75, 3.0),
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
            ('fastened', 'stiffened', 'ITF'): _wc_row(20.0, 0.10, 0.08, 0.031, 1.75, 0.85, 0.75, 12.0, d_min=4.5),
            ('unfastened', 'stiffened', 'EOF'): _wc_row(4.0, 0.14, 0.35, 0.02, 1.85, 0.80, 0.70, 5.0),
            ('unfastened', 'stiffened', 'IOF'): _wc_row(13.0, 0.23, 0.14, 0.01, 1.65, 0.90, 0.80, 5.0),
            ('unfastened', 'stiffened', 'ETF'): _wc_row(13.0, 0.32, 0.05, 0.04, 1.65, 0.90, 0.80, 3.0),
            ('unfastened', 'stiffened', 'ITF'): _wc_row(24.0, 0.52, 0.15, 0.001, 1.90, 0.80, 0.65, 3.0),
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
            ('fastened', 'ITF'): _wc_row(10.0, 0.14, 0.22, 0.02, 1.80, 0.85, 0.75, 10.0),
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
            ('fastened', 'IOF'): _wc_row(8.0, 0.10, 0.17, 0.004, 1.75, 0.85, 0.75, 20.0),
            ('fastened', 'ETF'): _wc_row(9.0, 0.12, 0.14, 0.040, 1.80, 0.85, 0.70, 10.0),
            ('fastened', 'ITF'): _wc_row(10.0, 0.11, 0.21, 0.020, 1.75, 0.85, 0.75, 10.0),
            ('unfastened', 'EOF'): _wc_row(3.0, 0.04, 0.29, 0.028, 2.45, 0.60, 0.50, 20.0),
            ('unfastened', 'IOF'): _wc_row(8.0, 0.10, 0.17, 0.004, 1.75, 0.85, 0.75, 20.0),
            ('unfastened', 'ETF'): _wc_row(6.0, 0.16, 0.15, 0.050, 1.65, 0.90, 0.80, 5.0),
            ('unfastened', 'ITF'): _wc_row(17.0, 0.10, 0.10, 0.046, 1.65, 0.90, 0.80, 5.0),
        },
    },
}


def _normalize_fastened(fastened: str | None) -> str:
    return 'unfastened' if str(fastened or '').strip().lower() == 'unfastened' else 'fastened'


def _normalize_support(support: str | None) -> str:
    sup = str(support or 'EOF').strip().upper()
    return sup if sup in ('EOF', 'IOF', 'ETF', 'ITF') else 'EOF'


# 단면 표기(템플릿 이름, GUI 정규화 이름, MCP enum, 설계 정규 이름) → G5 표.
# 비교 전에 대문자로 바꾸고 공백·'-'·'_' 를 없앤다.
_G5_FAMILY_NAMES = {
    'c': ('C', 'LIPPEDC', 'CSECTION', 'CEE', 'CS', 'STUD', 'LIPPEDCHANNEL', 'CHANNEL',
          'TRACK', 'U', 'UNLIPPEDC', 'PLAINCHANNEL'),
    'z': ('Z', 'LIPPEDZ', 'ZSECTION', 'ZEE', 'ZS', 'LIPPEDZEE', 'ZPURLIN'),
    'built_up_i': ('I', 'ISECT', 'ISECTION', 'IBEAM', 'BUILTUPI', 'BUILDUPI', 'BUILTUP',
                   'BUILTUPISECTION'),
    'hat': ('HAT', 'HATSECTION'),
    'multi_web': ('MULTIWEB', 'DECK', 'MULTIWEBDECK'),
}
# 웹 크리플링 표가 다루지 않는 단면(관형·앵글·T) — 단면군을 따로 주어도 거절한다.
_G5_UNCOVERED_NAMES = ('RHS', 'SHS', 'BOX', 'HSS', 'TUBE', 'RECTANGULARHSS', 'CHS', 'ROUND',
                       'PIPE', 'CIRCULAR', 'ROUNDHSS', 'ANGLE', 'L', 'LIPPEDANGLE', 'TEE', 'T')
# 립(연단 보강재)이 없는 채널 — Table G5-2 의 unstiffened flanges 행에 해당
_UNLIPPED_CHANNEL_NAMES = ('TRACK', 'U', 'UNLIPPEDC', 'PLAINCHANNEL')


def _canon_name(raw) -> str:
    return str(raw or '').strip().upper().replace(' ', '').replace('-', '').replace('_', '')


def _family_of(raw) -> str | None:
    name = _canon_name(raw)
    if not name:
        return None
    for fam, names in _G5_FAMILY_NAMES.items():
        if name in names:
            return fam
    if name.startswith('HAT'):
        return 'hat'
    if name.startswith('Z') or name.startswith('LIPPEDZ'):
        return 'z'
    return None


def _resolve_section_family(section_family: str | None,
                            section_type: str | None) -> tuple:
    """(family, warnings, error) — 모르는 단면명을 C 로 조용히 보내지 않는다."""
    warnings: list[str] = []
    type_name = _canon_name(section_type)
    if type_name in _G5_UNCOVERED_NAMES or type_name.startswith(('CHS', 'RHS', 'BOX')):
        return None, warnings, (f"Section type '{section_type}' is not covered by Tables G5-1 to "
                                'G5-5 (web crippling of tubular, angle and tee sections is not tabulated).')
    fam_from_type = _family_of(section_type)
    if section_family not in (None, ''):
        fam = _family_of(section_family)
        if fam is None:
            return None, warnings, (f"Unknown section_family '{section_family}' for §G5 "
                                    '(expected built_up_i, C, Z, hat or multi_web).')
        if fam == 'c' and fam_from_type not in (None, 'c'):
            warnings.append(
                _nt('shear.warning.section_family_conflicts_section', section_family=section_family, section_type=section_type, table=_G5_TABLES[fam_from_type]['table']))
            return fam_from_type, warnings, None
        return fam, warnings, None
    if fam_from_type is None:
        return None, warnings, (f"Section type '{section_type}' is not recognised for §G5; give "
                                'section_family (built_up_i, C, Z, hat or multi_web).')
    return fam_from_type, warnings, None


def _normalize_flange_condition(flange_condition: str | None,
                                section_family: str) -> str:
    raw = str(flange_condition or '').strip().lower().replace('-', '_')
    if section_family in ('hat', 'multi_web'):
        return 'stiffened'
    if raw in ('unstiffened', 'unreinforced'):
        return 'unstiffened'
    return 'stiffened'


def _default_n_webs(section_family: str, n_webs: int | float | None) -> tuple:
    """(n_webs, explicit) — 명시값은 그대로 쓰고, 기본값만 단면군별로 둔다."""
    base = {'hat': 2, 'multi_web': 2, 'built_up_i': 2}.get(section_family, 1)
    try:
        n = int(float(n_webs)) if n_webs is not None else None
    except (TypeError, ValueError):
        n = None
    if n is None or n < 1:
        return base, False
    return n, True


def _support_location(support: str) -> str:
    return 'end' if support.startswith('E') else 'interior'


def _support_load_case(support: str) -> str:
    return 'one_flange' if support.endswith('OF') else 'two_flange'


def _not_covered(table: str, detail: str, warnings: list, why: str = '') -> dict:
    tail = (' ' + why) if why else ''
    return {
        'error': f'Not covered by Table {table}: {detail}. The Specification gives no coefficients '
                 f'for this case, so no web crippling strength is reported.{tail}',
        'not_covered': True,
        'table': table,
        'Pn': None,
        'warnings': list(warnings) + [f'Table {table} does not tabulate this case ({detail}).'],
        'scope_notes': [_WC_SCOPE_NOTE],
    }


# 체결(fastened) 지점의 무보강 플랜지 행은 Tables G5-1 … G5-3 에 없다. 1-플랜지(EOF/IOF)에서는
# 같은 표의 보강 플랜지 행끼리 비교하면 체결 계수의 Pn·φPn·Pn/Ω 가 무체결 계수 이상이다
# (G5-1/G5-2/G5-3, 표 한계 안 h/t 20–200 · R/t · N/t 격자에서 최소 비 1.00). 그러므로 무체결
# 무보강 1-플랜지 행은 체결 경우의 보수 측 대체다. 2-플랜지(ETF/ITF)는 체결 계수가 무체결의
# 0.28–0.56 배까지 내려가 이 논리가 성립하지 않으므로 대체하지 않는다.
_FASTENED_SUBSTITUTE_SUPPORTS = ('EOF', 'IOF')


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
                                support_fastener_spacing: float | None = None,
                                d: float | None = None) -> dict:
    family, fam_warnings, fam_error = _resolve_section_family(section_family, section_type)
    if fam_error:
        return {'error': fam_error, 'not_covered': True, 'Pn': None,
                'warnings': fam_warnings + [fam_error]}
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
    warnings: list[str] = list(fam_warnings)
    assumptions: list[str] = []
    limit_violations: list[str] = []

    if family == 'multi_web' and support_fastener_spacing is not None and support_fastener_spacing > 18.0:
        if fas != 'unfastened':
            warnings.append(_nt('shear.warning.table_g5_5_multi_web_deck_support'))
        fas = 'unfastened'

    if (family == 'c' and flange_condition in (None, '')
            and _canon_name(section_type) in _UNLIPPED_CHANNEL_NAMES):
        flange_condition = 'unstiffened'
        assumptions.append(_nt('shear.assumption.table_g5_2_section_type_has_no', section_type=section_type))
    flange = _normalize_flange_condition(flange_condition, family)
    webs, webs_explicit = _default_n_webs(family, n_webs)
    if family in ('c', 'z') and webs > 1:
        warnings.append(_nt('shear.warning.single_web_coefficients_were'))
        webs = 1

    table_meta = _G5_TABLES[family]
    table = table_meta['table']

    row_used = 'tabulated'
    if family in ('built_up_i', 'c', 'z'):
        row = table_meta['rows'].get((fas, flange, sup))
        detail = f'{fas}, {flange} flanges, {sup}'
        if (row is None and fas == 'fastened' and flange == 'unstiffened'
                and sup in _FASTENED_SUBSTITUTE_SUPPORTS):
            row = table_meta['rows'].get(('unfastened', flange, sup))
            if row is not None:
                row_used = 'unfastened_substitute'
                assumptions.append(
                    _nt('shear.assumption.has_no_fastened_support', table=table, sup=sup, sup_2=sup))
    else:
        row = table_meta['rows'].get((fas, sup))
        detail = f'{fas}, {sup}'
    if row is None:
        why = ''
        if fas == 'fastened' and sup in ('ETF', 'ITF') and family in ('built_up_i', 'c', 'z'):
            why = (_nt('shear.reason.no_conservative_substitute_exists'))
        return _not_covered(table, detail, warnings, why)

    loc = _support_location(sup)
    load_case = _support_load_case(sup)
    explicit_bearing_case = str(bearing_case or '').strip().lower()
    lo_val = float(Lo or 0.0)
    is_overhang_length = lo_val > 0 and h > 0 and lo_val <= 1.5 * h
    if lo_val > 0 and sup == 'EOF' and h > 0 and lo_val > 1.5 * h:
        assumptions.append(_nt('shear.assumption.g5_lo_exceeds_so_case', lo_val=lo_val, value=1.5 * h))
    if explicit_bearing_case in ('overhang', 'overhang_bearing') and not is_overhang_length:
        warnings.append(_nt('shear.warning.g5_explicit_overhang_bearing_was'))
    if (explicit_bearing_case in ('overhang', 'overhang_bearing') and is_overhang_length) or (is_overhang_length and sup == 'EOF'):
        bcase = 'overhang_bearing'
    elif loc == 'end':
        bcase = 'end_bearing'
    else:
        bcase = 'interior_bearing'

    if bcase == 'overhang_bearing' and not (family in ('c', 'z') and sup == 'EOF'):
        warnings.append(_nt('shear.warning.g5_overhang_bearing_g5_applies'))
        bcase = 'end_bearing' if loc == 'end' else 'interior_bearing'

    equation = 'G5-2' if bcase == 'overhang_bearing' else 'G5-1'

    h_t = h / t if h > 0 and t > 0 else 0
    N_t = N / t if N > 0 and t > 0 else 0
    N_h = N / h if N > 0 and h > 0 else 0
    R_t = R / t if R > 0 and t > 0 else 0
    limits = table_meta['limits']
    if h_t > limits['h_t_max']:
        limit_violations.append(
            f'h/t={h_t:.1f} exceeds Table {table} applicability limit of {limits["h_t_max"]:.0f} '
            '(§G5: webs with h/t > 200 shall be provided with means of transmitting concentrated loads directly into the web).')
    if N_t > limits['N_t_max']:
        limit_violations.append(f'N/t={N_t:.1f} exceeds Table {table} applicability limit of {limits["N_t_max"]:.0f}.')
    if N_h > limits['N_h_max']:
        limit_violations.append(f'N/h={N_h:.3f} exceeds Table {table} applicability limit of {limits["N_h_max"]:.1f}.')
    if not (limits['theta_min'] <= theta <= limits['theta_max']):
        limit_violations.append(
            f'θ={theta:.1f}° is outside Table {table} applicability range '
            f'{limits["theta_min"]:.0f}°–{limits["theta_max"]:.0f}°.'
        )
    if row.get('rt_limit') is not None and R_t > row['rt_limit']:
        limit_violations.append(f'R/t={R_t:.2f} exceeds row applicability limit of {row["rt_limit"]:.1f}.')
    if row.get('d_min') is not None:
        if d is not None and float(d) > 0:
            d_val, d_note = float(d), 'given'
        else:
            # 바깥 깊이 = 웹 평면폭 + 양쪽 (내측 반경 + 두께)
            d_val, d_note = h + 2.0 * (R + t), 'estimated as h + 2(R + t)'
            assumptions.append(_nt('shear.assumption.out_out_depth_limit', d_val=d_val, d_note=d_note, table=table, d_min=row["d_min"]))
        if d_val + 1e-9 < row['d_min']:
            limit_violations.append(
                f'd={d_val:.3f} in ({d_note}) is below the Table {table} limit d ≥ {row["d_min"]} in '
                'for this row (Commentary G5: the equation is unconservative for shallower C-sections).')
    # §G5 정의: N = Bearing length (3/4 in. (19 mm) minimum). 계수가 보정된 범위 밖이다.
    if 0 < N < 0.75:
        limit_violations.append(
            f'N={N:.3f} in is below the §G5 minimum bearing length of 0.75 in (19 mm); '
            f'the Table G5-1..G5-5 web crippling coefficients are not calibrated below this bearing length.'
        )
    if family in ('built_up_i', 'c', 'z') and sup == 'ITF':
        req = 2.5 if fas == 'fastened' else 1.5
        required_edge_distance = req * h
        if edge_val is None:
            assumptions.append(_nt('shear.assumption.itf_edge_distance_extension', req=req))
        else:
            if edge_val + 1e-9 < required_edge_distance:
                limit_violations.append(
                    f'Provided ITF edge distance {edge_val:.3f} in is smaller than the required {required_edge_distance:.3f} in (={req:.1f}h).'
                )
            else:
                assumptions.append(
                    _nt('shear.assumption.provided_itf_edge_distance', edge_val=edge_val, required_edge_distance=required_edge_distance, req=req)
                )
    warnings.extend(limit_violations)
    if family == 'hat':
        assumptions.append(_nt('shear.assumption.table_g5_4_g5_per_web_total', webs=webs))
    if family == 'multi_web':
        assumptions.append(_nt('shear.assumption.table_g5_5_g5_per_web_total', webs=webs))
    if family == 'built_up_i':
        assumptions.append(
            _nt('shear.assumption.table_g5_1_g5_per_web_heading', webs=webs, text='' if webs_explicit else _nt('shear.fragment.default_two_back_to_back_channels')))

    # §H3 는 무보강 평판 웨브의 모든 단면에 해당한다: (a) 단일 웨브(C·Z·hat·다중 웨브 데크 —
    # 웨브 하나하나가 단일 웨브), (b) 두 C 를 맞댄 I, (c) 겹친 Z. 돌출(G5-2)은 Pn 자리에 Pnc.
    # 이 함수는 H3 를 계산하지 않는다 — 호출자가 평가해야 하며 h3_evaluated=False 로 알린다.
    h3_applicable = True
    h3_reason = ''
    web_cfg = str(web_config or 'single').strip().lower()
    if family == 'built_up_i':
        h3_candidate = 'H3-2'  # §H3(b) I-sections made of two C-sections back-to-back
    elif web_cfg == 'nested_z' and family == 'z':
        h3_candidate = 'H3-3'  # §H3(c) two nested Z-shapes
        assumptions.append(_nt('shear.assumption.h3_c_conditions_assumed'))
    elif web_cfg == 'multi_web' and family in ('c', 'z'):
        h3_candidate = 'H3-2'  # 호출자가 맞댄 I 로 지정
    else:
        h3_candidate = 'H3-1'  # §H3(a) single unreinforced webs
        if web_cfg == 'multi_web':
            warnings.append(_nt('shear.warning.h3_web_config_multi_web', family=family))
        elif web_cfg == 'nested_z':
            warnings.append(_nt('shear.warning.h3_web_config_nested_applies'))
    if family in ('hat', 'multi_web') and loc == 'interior':
        assumptions.append(_nt('shear.assumption.h3_h3_exception_interior_supports'))
    if bcase == 'overhang_bearing':
        assumptions.append(_nt('shear.assumption.h3_h3_uses_overhang_strength'))

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
        'table': table,
        'row': row,
        'Lo': lo_val if lo_val > 0 else None,
        'edge_distance': edge_val,
        'n_webs': webs,
        'assumptions': assumptions,
        'warnings': warnings,
        'limit_violations': limit_violations,
        'h3_applicable': h3_applicable,
        'h3_equation_candidate': h3_candidate,
        'h3_not_applicable_reason': h3_reason,
        'row_used': row_used,
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
    per_web = _G5_TABLES[case['section_family']]['per_web']
    multiplier = case['n_webs'] if per_web else 1
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
        # 계산서(design_checks)용 — 위 식에 쓴 값
        'terms': {'theta': theta, 'R': R, 'N': N, 'Pn_per_web': Pn_per_web, 'multiplier': multiplier,
                  'Pn_total': Pn_total},
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
            warnings.append(_nt('shear.warning.g5_overhang_g5_applicability_limits'))
    else:
        warnings.append(_nt('shear.warning.invalid_overhang_evaluation_using'))

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
    if 'error' in interior_case:
        # Pnc 는 내부 1-플랜지 강도를 넘을 수 없다 — 그 상한을 못 구하면 α 를 쓰지 않는다.
        warnings.append(_nt('shear.warning.g5_interior_one_flange_cap'))
        return {**base, 'alpha': 1.0, 'Lo': lo_val, 'cap_applied': False,
                'Pn_interior_cap': None, 'Pnc_raw': base['Pn'], 'warnings': warnings}
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
                  support_fastener_spacing: float | None = None,
                  d: float | None = None,
                  web_holes: bool = False) -> dict:
    """웹 크리플링 강도 (§G5, Eq. G5-1 / Eq. G5-2)

    (공개 서명은 그대로 — 계산서용 상세가 필요한 호출자는 _web_crippling_detail 을 쓴다.)

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
        section_type: 단면 표기 ('C', 'Z', 'lippedc', 'lippedz', 'isect', 'hat', 'track', ...)
        section_family: 'built_up_i' | 'C' | 'Z' | 'hat' | 'multi_web'
        flange_condition: 'stiffened' | 'unstiffened' (built-up I/C/Z only)
        Lo: Overhang length for Eq. G5-2 (in)
        edge_distance: Distance from bearing edge to member end for ITF applicability checks (in)
        n_webs: Number of webs at the section (hat/multi-web/built-up I total strength).
                명시하면 그대로 쓴다. 기본: hat 2, multi_web 2, built-up I 2, C/Z 1.
        web_config: H3 classifier hint ('single' | 'nested_z' | 'multi_web')
        bearing_case: Optional explicit override ('overhang_bearing', ...)
        support_fastener_spacing: For multi-web deck note (>18 in → unfastened)
        d: 단면 바깥 깊이 (in) — Table G5-2 fastened ITF 의 d ≥ 4.5 in 검사용.
           없으면 h + 2(R + t) 로 추정한다.
        web_holes: 웹에 구멍이 있으면 True (§G6 미구현 → error)

    Returns:
        dict: {Pn, phi, omega, equation, ..., within_limits, limit_violations}.
        표가 다루지 않는 경우와 적용 한계 밖이면 'error' 키가 있다. 적용 한계 밖이면
        계산값은 참고로 남기되 'within_limits'=False 이고 설계강도로 쓰지 않는다.
    """
    return _web_crippling_detail(
        h, t, R, N, Fy, theta=theta, support=support, fastened=fastened, section_type=section_type,
        section_family=section_family, flange_condition=flange_condition, Lo=Lo,
        edge_distance=edge_distance, n_webs=n_webs, web_config=web_config, bearing_case=bearing_case,
        support_fastener_spacing=support_fastener_spacing, d=d, web_holes=web_holes)[0]


def _web_crippling_detail(h, t, R, N, Fy, theta=90, support='EOF', fastened='fastened',
                          section_type='C', section_family=None, flange_condition=None, Lo=None,
                          edge_distance=None, n_webs=None, web_config='single', bearing_case=None,
                          support_fastener_spacing=None, d=None, web_holes=False) -> tuple:
    """web_crippling 의 본체 — (결과, 계산서용 상세). 상세: 표 행 계수 · 식의 항 · α · 상한."""
    if web_holes:
        return {
            'error': '§G6 web crippling of webs with holes is not implemented; the Rc reduction '
                     'cannot be applied, so no web crippling strength is reported.',
            'not_covered': True,
            'Pn': None,
            'warnings': ['§G6 (webs with holes) not evaluated.'],
        }, None
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
        d=d,
    )
    if 'error' in case:
        return case, None

    if case['equation'] == 'G5-2':
        solved = _solve_g52_overhang(case, h, t, R, N, Fy, theta, Lo)
        warnings = solved.pop('warnings', [])
    else:
        solved = _solve_g51(case, h, t, R, N, Fy, theta)
        warnings = list(case.get('warnings', []))

    violations = case.get('limit_violations', [])
    result = {
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
        'within_limits': not violations,
        'limit_violations': list(violations),
        'h3_applicable': case['h3_applicable'],
        'h3_equation_candidate': case['h3_equation_candidate'],
        'h3_not_applicable_reason': case['h3_not_applicable_reason'],
        # §H3 는 해당한다(h3_applies). 이 함수는 계산하지 않았다(h3_evaluated=False) —
        # 반력 위치의 M̄ 로 호출자가 평가해야 하며, 평가하지 않으면 판정은 None.
        'h3_applies': case['h3_applicable'],
        'h3_equation': case['h3_equation_candidate'],
        'h3_evaluated': False,
        'row_used': case['row_used'],
        'scope_notes': [_WC_SCOPE_NOTE],
        'phi_Pn': round(solved['phi'] * solved['Pn'], 3),
        'Pa': round(solved['Pn'] / solved['omega'], 3) if solved['omega'] > 0 else None,
        'alpha': round(solved.get('alpha', 1.0), 4),
        'Lo': round(float(Lo or 0.0), 4) if Lo is not None else None,
        'edge_distance': round(case['edge_distance'], 4) if case.get('edge_distance') is not None else None,
        'Pn_interior_cap': round(solved.get('Pn_interior_cap'), 3) if solved.get('Pn_interior_cap') is not None else None,
        'cap_applied': solved.get('cap_applied', False),
        'formula': f'{solved["formula"]} = {solved["Pn"]:.3f} kips [{case["table"]}]',
        'spec_sections': ['G5'],
    }
    if violations:
        # 표의 적용 한계 밖에서는 Eq. G5-1 계수가 보정되지 않았다 — 판정에 쓰지 않도록 오류로 올린다.
        result['error'] = (f'Outside the Table {case["table"]} applicability limits: '
                           + ' '.join(violations)
                           + ' The computed Pn is for reference only and is not a design strength.')
    detail = {'row': case.get('row'), 'terms': solved.get('terms'), 'alpha': solved.get('alpha'),
              'Pn_interior_cap': solved.get('Pn_interior_cap'), 'Pn_final': solved['Pn']}
    return result, detail
