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
                   transverse_stiffeners: bool = False,
                   stiffener_spacing: float | None = None, stiffener_kind: str | None = None,
                   stiffener_Is: float | None = None, stiffener_area: float | None = None,
                   stiffener_Fy: float | None = None,
                   hole_shape: str | None = None, hole_depth: float | None = None, hole_length: float | None = None,
                   hole_spacing: float | None = None, hole_corner_radius: float | None = None,
                   hole_web_offset: float | None = None, section_type: str | None = None) -> dict:
    """웹 전단 강도 (§G2.1, 횡보강재 없음)

    2026-11-26 EB: stiffener_* (§G2.2 · §G2.3(b) · §G4.1) 나 hole_* (§G3) 를 주면 shear_web_strength 의 결과
    (같은 옛 키 + evaluated · curve · kv · qs · g3 · g4 · reason · reference). 평가하지 못하면 'error' 와 Vn None.
    §G3 은 C 단면 웹만 — section_type 을 주어야 한다(없으면 평가하지 않음). 아래 옛 설명은 새 입력이 없을 때의 것.

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
        web_holes: 웹에 구멍이 있으면 True — 구멍 자료(hole_*)가 없으면 error (§G3 은 hole_* 로 평가)
        transverse_stiffeners: 횡보강재가 있으면 True (§G2.2 미구현 → §G2.1 로 보수 계산, 경고)
    """
    _new = {k: v for k, v in dict(
        stiffener_spacing=stiffener_spacing, stiffener_kind=stiffener_kind, stiffener_Is=stiffener_Is,
        stiffener_area=stiffener_area, stiffener_Fy=stiffener_Fy, hole_shape=hole_shape, hole_depth=hole_depth,
        hole_length=hole_length, hole_spacing=hole_spacing, hole_corner_radius=hole_corner_radius,
        hole_web_offset=hole_web_offset).items() if v is not None}
    if _new and h > 0 and t > 0 and Fy > 0:
        return _shear_strength_eb(h, t, Fy, E, transverse_stiffeners, _new, section_type)
    if web_holes:
        return {
            'error': '§G3 shear strength of webs with holes: the hole data (hole_shape, hole_depth, hole_length, '
                     'hole_spacing, hole_corner_radius, section_type) were not given, so the qs reduction cannot be '
                     'applied and no shear strength is reported.',
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
                  web_holes: bool = False,
                  hole_shape: str | None = None, hole_depth: float | None = None,
                  hole_length: float | None = None, hole_spacing: float | None = None,
                  hole_end_distance: float | None = None, hole_corner_radius: float | None = None,
                  hole_web_offset: float | None = None, hole_bearing_distance: float | None = None,
                  hole_within_bearing: bool | None = None) -> dict:
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
        web_holes: 웹에 구멍이 있으면 True — 구멍 자료(hole_*)가 없으면 error(강도를 내지 않음)
        hole_*: §G6 (2026-11-26 EB) — hole_shape ('circular' | 'noncircular'), hole_depth dh, hole_length Lh,
            hole_spacing (중심 간격), hole_end_distance (부재 끝 → 구멍 가장자리 순거리, ≥ d), hole_corner_radius,
            hole_web_offset (웹 중앙 → 구멍 중심, 기본 0), hole_bearing_distance x (구멍 → 지압 가장자리),
            hole_within_bearing (참이면 지압 보강재가 필요 — 평가하지 않음). 주면 Pn = Rc·Pn(G5).

    Returns:
        dict: {Pn, phi, omega, equation, ..., within_limits, limit_violations}.
        표가 다루지 않는 경우와 적용 한계 밖이면 'error' 키가 있다. 적용 한계 밖이면
        계산값은 참고로 남기되 'within_limits'=False 이고 설계강도로 쓰지 않는다.
    """
    return _web_crippling_detail(
        h, t, R, N, Fy, theta=theta, support=support, fastened=fastened, section_type=section_type,
        section_family=section_family, flange_condition=flange_condition, Lo=Lo,
        edge_distance=edge_distance, n_webs=n_webs, web_config=web_config, bearing_case=bearing_case,
        support_fastener_spacing=support_fastener_spacing, d=d, web_holes=web_holes,
        holes={k: v for k, v in dict(hole_shape=hole_shape, hole_depth=hole_depth, hole_length=hole_length,
                                     hole_spacing=hole_spacing, hole_end_distance=hole_end_distance,
                                     hole_corner_radius=hole_corner_radius, hole_web_offset=hole_web_offset,
                                     hole_bearing_distance=hole_bearing_distance,
                                     hole_within_bearing=hole_within_bearing).items() if v is not None} or None)[0]


def _web_crippling_detail(h, t, R, N, Fy, theta=90, support='EOF', fastened='fastened',
                          section_type='C', section_family=None, flange_condition=None, Lo=None,
                          edge_distance=None, n_webs=None, web_config='single', bearing_case=None,
                          support_fastener_spacing=None, d=None, web_holes=False, holes=None) -> tuple:
    """web_crippling 의 본체 — (결과, 계산서용 상세). 상세: 표 행 계수 · 식의 항 · α · 상한."""
    if holes:
        return _web_crippling_holes(h, t, R, N, Fy, theta, support, fastened, section_type, section_family,
                                    flange_condition, Lo, edge_distance, n_webs, web_config, bearing_case,
                                    support_fastener_spacing, d, holes)
    if web_holes:
        return {
            'error': '§G6 web crippling of webs with holes: the hole data (hole_shape, hole_depth, hole_spacing, '
                     'hole_end_distance, hole_bearing_distance, ...) were not given, so the Rc reduction cannot be '
                     'applied and no web crippling strength is reported.',
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
    # 위 표시용 반올림 값의 반올림 전 값(SI 변환용 — aisi_s100 의 display_unrounded 와 같은 뜻)
    _unr = {'Pn': solved['Pn'], 'Pn_per_web': solved['Pn_per_web'], 'phi_Pn': solved['phi'] * solved['Pn'],
            'Pa': solved['Pn'] / solved['omega'] if solved['omega'] > 0 else None,
            'Lo': float(Lo or 0.0) if Lo is not None else None, 'edge_distance': case.get('edge_distance'),
            'Pn_interior_cap': solved.get('Pn_interior_cap')}
    result['display_unrounded'] = {k: float(v) for k, v in _unr.items() if v is not None}
    if violations:
        # 표의 적용 한계 밖에서는 Eq. G5-1 계수가 보정되지 않았다 — 판정에 쓰지 않도록 오류로 올린다.
        result['error'] = (f'Outside the Table {case["table"]} applicability limits: '
                           + ' '.join(violations)
                           + ' The computed Pn is for reference only and is not a design strength.')
    detail = {'row': case.get('row'), 'terms': solved.get('terms'), 'alpha': solved.get('alpha'),
              'Pn_interior_cap': solved.get('Pn_interior_cap'), 'Pn_final': solved['Pn']}
    return result, detail


# ============================================================
# §G2.2 · §G2.3(b) · §G4 횡방향 웹 보강재, §G3 · §G6 구멍이 있는 C 단면 웹 — 2026-11-26 EB
# 원문: 스킬 data/specification/Chapter_G_Shear.md §G2.2 · §G2.3 · §G3 · §G4.1 · §G4.2 · §G6,
# 예제: Design Manual Example II-10 (C-Section With Openings — §G3 qs, §G6 Rc).
# ============================================================

from design.notices import joined as _joined  # noqa: E402

# 입력 이름(부재 설계 params 와 단독 도구가 같은 이름을 쓴다). 구멍 이름은 EA 단계(§E · §F 구멍)와 같은 머리 hole_.
HOLE_KEYS = ('hole_shape', 'hole_depth', 'hole_length', 'hole_spacing', 'hole_end_distance',
             'hole_corner_radius', 'hole_web_offset', 'hole_bearing_distance', 'hole_within_bearing')
STIFFENER_KEYS = ('stiffener_spacing', 'stiffener_kind', 'stiffener_Is', 'stiffener_area', 'stiffener_Fy')

# §G4.1 Eq. G4.1-2 의 D: "1.0 for stiffeners furnished in pairs, 1.8 for single-angle stiffeners,
# 2.4 for single-plate stiffeners"
STIFFENER_D = {'pair': 1.0, 'single_angle': 1.8, 'single_plate': 2.4}
# §G4.2: "stiffeners that do not meet the requirements of Section G4.1, such as stamped or rolled-in stiffeners"
_NONCONFORMING_KINDS = ('nonconforming', 'stamped', 'rolled_in', 'rolledin')

# §G3 · §G6 는 C 단면 웹만(원문 제목 "C-Section Webs With Holes"; §G6 은 Eq. G5-1 + Table G5-2)
_HOLE_C_SECTIONS = ('C', 'TRACK')


def _given(v) -> bool:
    return v is not None and not (isinstance(v, str) and v.strip() == '')


def hole_inputs(src: dict) -> dict | None:
    """구멍 입력(hole_* · web_holes) — 하나도 없으면 None(구멍 입력 없음 → 옛 결과 그대로)."""
    got = {k: src.get(k) for k in HOLE_KEYS if _given(src.get(k))}
    if not got and not src.get('web_holes'):
        return None
    return got


def stiffener_inputs(src: dict) -> dict | None:
    """보강재 입력(stiffener_* · transverse_stiffeners) — 하나도 없으면 None."""
    got = {k: src.get(k) for k in STIFFENER_KEYS if _given(src.get(k))}
    if not got and not src.get('transverse_stiffeners'):
        return None
    return got


def _norm_shape(raw) -> str | None:
    s = str(raw or '').strip().lower().replace('-', '').replace('_', '').replace(' ', '')
    if s in ('circular', 'circle', 'round'):
        return 'circular'
    if s in ('noncircular', 'rectangular', 'slotted', 'oval', 'diamond'):
        return 'noncircular'
    return None


def _num_or_none(v):
    try:
        return float(v) if _given(v) else None
    except (TypeError, ValueError):
        return None


def _hole_geometry(holes: dict) -> dict:
    """dh · Lh · 모양. 원형은 Lh = dh(지름)."""
    shape = _norm_shape(holes.get('hole_shape')) if _given(holes.get('hole_shape')) else None
    dh = _num_or_none(holes.get('hole_depth'))
    Lh = _num_or_none(holes.get('hole_length'))
    if shape == 'circular' and dh is not None:
        Lh = dh
    return {'shape': shape, 'shape_raw': holes.get('hole_shape'), 'dh': dh, 'Lh': Lh,
            'spacing': _num_or_none(holes.get('hole_spacing')),
            'end_distance': _num_or_none(holes.get('hole_end_distance')),
            'corner_radius': _num_or_none(holes.get('hole_corner_radius')),
            # EA 의 입력 계약: hole_web_offset = 웹 중앙 → 구멍 중심(주지 않으면 0 = 가운데)
            'offset': _num_or_none(holes.get('hole_web_offset')),
            'offset_given': _given(holes.get('hole_web_offset')),
            'x': _num_or_none(holes.get('hole_bearing_distance')),
            'within_bearing': holes.get('hole_within_bearing')}


def hole_limits(clause: str, h: float, t: float, holes: dict, *, d: float | None = None,
                section_canon: str | None = None) -> dict:
    """§G3 (a)–(h) · §G6 (a)–(i) 적용 한계. 돌려주는 dict: geometry, items[{item, key, ok, value, limit}],
    missing[], reason(알림 — 한계 밖 · 자료 없음의 까닭을 이은 것), ok."""
    g = _hole_geometry(holes)
    missing, items, why = [], [], []
    if section_canon is not None and section_canon not in _HOLE_C_SECTIONS:
        why.append(_nt('shear.reason.holes_section_not_c', clause=clause, section=section_canon))
    if g['shape_raw'] is None:
        missing.append('hole_shape')
    elif g['shape'] is None:
        why.append(_nt('shear.reason.holes_shape_unknown', clause=clause, shape=str(g['shape_raw'])))
    if g['dh'] is None:
        missing.append('hole_depth')
    if g['shape'] == 'noncircular' and g['Lh'] is None:
        missing.append('hole_length')
    if g['spacing'] is None:
        missing.append('hole_spacing')
    if g['shape'] == 'noncircular' and g['corner_radius'] is None:
        missing.append('hole_corner_radius')
    g6 = clause == 'G6'
    if g6 and g['end_distance'] is None:
        missing.append('hole_end_distance')
    # 항목 글자: §G3 (a)–(h), §G6 은 (e) 끝 거리가 끼어 (a)–(i)
    keys = ['dh_h', 'h_t', 'center', 'clear'] + (['end'] if g6 else []) + ['radius', 'noncirc', 'circ', 'min']
    L = dict(zip(keys, 'abcdefghi'))
    if missing:
        why.append(_nt('shear.reason.holes_input_missing', clause=clause, names=', '.join(missing)))
    notes = [] if g['offset_given'] else [_nt('shear.assumption.hole_offset_defaulted', clause=clause)]
    if missing or g['shape'] is None:
        return {'geometry': g, 'items': items, 'missing': missing, 'reason': _joined('; ', why), 'ok': False,
                'assumptions': notes}

    def rec(key, ok, n, value=None, limit=None):
        items.append({'item': L[key], 'key': key, 'ok': bool(ok), 'value': value, 'limit': limit})
        if not ok:
            why.append(n)
    dh, Lh = g['dh'], g['Lh']
    rec('dh_h', dh / h <= 0.7, _nt('shear.reason.holes_dh_over_h', clause=clause, item=L['dh_h'], ratio=dh / h,
                                    limit=0.7), dh / h, 0.7)
    rec('h_t', h / t <= 200.0, _nt('shear.reason.holes_h_over_t', clause=clause, item=L['h_t'], ratio=h / t,
                                    limit=200.0), h / t, 200.0)
    off = g['offset'] or 0.0
    rec('center', abs(off) <= 1e-9, _nt('shear.reason.holes_not_centered', clause=clause, item=L['center'], offset=off),
        off, 0.0)
    clear = g['spacing'] - Lh
    rec('clear', clear >= 18.0, _nt('shear.reason.holes_clear_spacing', clause=clause, item=L['clear'], clear=clear,
                                    limit=18.0), clear, 18.0)
    if g6:
        if d is None or not d > 0:
            why.append(_nt('shear.reason.holes_input_missing', clause=clause, names='d'))
        else:
            rec('end', g['end_distance'] >= d, _nt('shear.reason.holes_end_distance', x=g['end_distance'], d=d),
                g['end_distance'], d)
    if g['shape'] == 'noncircular':
        rec('radius', g['corner_radius'] >= 2.0 * t,
            _nt('shear.reason.holes_corner_radius', clause=clause, item=L['radius'], r=g['corner_radius'],
                limit=2.0 * t), g['corner_radius'], 2.0 * t)
        rec('noncirc', dh <= 2.5 and Lh <= 4.5,
            _nt('shear.reason.holes_noncircular_size', clause=clause, item=L['noncirc'], dh=dh, dh_max=2.5, lh=Lh,
                lh_max=4.5), dh, 2.5)
    else:
        rec('circ', dh <= 6.0, _nt('shear.reason.holes_circular_size', clause=clause, item=L['circ'], dh=dh,
                                   limit=6.0), dh, 6.0)
    rec('min', dh > 9.0 / 16.0, _nt('shear.reason.holes_min_depth', clause=clause, item=L['min'], dh=dh,
                                    limit=9.0 / 16.0), dh, 9.0 / 16.0)
    return {'geometry': g, 'items': items, 'missing': [], 'reason': _joined('; ', why) if why else None,
            'ok': not why, 'assumptions': notes}


def g3_reduction(h: float, t: float, holes: dict, section_canon: str | None) -> dict:
    """§G3 qs (Eq. G3-1 – G3-3) — 한계 밖이면 evaluated False 와 까닭. 예제 II-10: Vn = qs·Vn(G2)."""
    lim = hole_limits('G3', h, t, holes, section_canon=section_canon)
    out = {'clause': 'G3', 'limits': lim, 'qs': None, 'c': None, 'c_over_t': None, 'evaluated': False,
           'reason': lim['reason']}
    if not lim['ok']:
        return out
    g = lim['geometry']
    circ = g['shape'] == 'circular'
    c = h / 2.0 - g['dh'] / (2.83 if circ else 2.0)       # Eq. G3-2 (원형) / G3-3 (원형 아님)
    ct = c / t
    out.update(c=c, c_over_t=ct, c_equation='G3-2' if circ else 'G3-3')
    if ct >= 54.0:
        out.update(qs=1.0, qs_equation='c/t ≥ 54', evaluated=True, reason=None)
    elif ct >= 5.0:
        out.update(qs=c / (54.0 * t), qs_equation='G3-1', evaluated=True, reason=None)    # Eq. G3-1
    else:
        # 원문은 c/t ≥ 54 와 5 ≤ c/t < 54 만 준다 — c/t < 5 는 정하지 않았다
        out['reason'] = _nt('shear.reason.g3_c_over_t_below_5', ratio=ct, limit=5.0)
    return out


def _kv_stiffened(a_over_h: float) -> tuple:
    """§G2.3(b) Eq. G2.3-3 / G2.3-4 (= Eq. G4.1-5 / G4.1-6)."""
    if a_over_h <= 1.0:
        return 4.00 + 5.34 / a_over_h ** 2, 'G2.3-3'
    return 5.34 + 4.00 / a_over_h ** 2, 'G2.3-4'


def g4_conformance(h: float, t: float, Fy_web: float, stiff: dict, E: float = E_STEEL) -> dict:
    """§G4.1 요건 — 간격 a/h ≤ [260/(h/t)]² 및 3.0, Is ≥ Is,min (Eq. G4.1-1), Ast ≥ Eq. G4.1-2.

    conforming: True(모두 맞음) / False(하나라도 못 맞춤 또는 §G4.2 의 종류 → g4_2) / None(자료가 모자람).
    """
    a = _num_or_none(stiff.get('stiffener_spacing'))
    kind_raw = stiff.get('stiffener_kind')
    kind = str(kind_raw or '').strip().lower().replace('-', '_').replace(' ', '_') if _given(kind_raw) else None
    Is = _num_or_none(stiff.get('stiffener_Is'))
    As = _num_or_none(stiff.get('stiffener_area'))
    Fys = _num_or_none(stiff.get('stiffener_Fy'))
    out = {'a': a, 'kind': kind, 'Is': Is, 'As': As, 'Fy_st': Fys, 'Fy_web': Fy_web, 'h': h, 't': t,
           'conforming': None, 'reason': None, 'missing': [], 'g4_2': False}
    if kind is not None and kind not in STIFFENER_D:
        out.update(conforming=False, g4_2=True,
                   reason=_nt('shear.reason.stiffener_nonconforming_kind', kind=str(kind_raw)))
        return out
    missing = [k for k, v in (('stiffener_spacing', a), ('stiffener_kind', kind), ('stiffener_Is', Is),
                              ('stiffener_area', As), ('stiffener_Fy', Fys)) if v is None]
    out['missing'] = missing
    why = []
    if a is not None and a > 0 and h > 0 and t > 0 and Fy_web > 0:
        ah = a / h
        lim = min((260.0 / (h / t)) ** 2, 3.0)
        kv, kv_eq = _kv_stiffened(ah)
        Ismin_raw = 5.0 * h * t ** 3 * (h / a - 0.7 * a / h)           # Eq. G4.1-1
        floor = (h / 50.0) ** 4
        Ismin = max(Ismin_raw, floor)
        X = E * kv / (Fy_web * (h / t) ** 2)
        Cv1 = 1.53 * X                                                  # Eq. G4.1-3 (when Cv ≤ 0.8)
        if Cv1 <= 0.8:
            Cv, cv_eq = Cv1, 'G4.1-3'
        else:
            Cv, cv_eq = 1.11 / (h / t) * math.sqrt(E * kv / Fy_web), 'G4.1-4'   # Eq. G4.1-4 (when Cv > 0.8)
        out.update(a_over_h=ah, a_over_h_limit=lim, spacing_ok=ah <= lim, kv=kv,
                   kv_equation='G4.1-5' if kv_eq == 'G2.3-3' else 'G4.1-6', Is_min=Ismin, Is_min_raw=Ismin_raw,
                   Is_floor=floor, Cv=Cv, Cv_equation=cv_eq)
        if not ah <= lim:
            why.append(_nt('shear.reason.stiffener_spacing_limit', ratio=ah, limit=lim))
        if Is is not None and Is < Ismin:
            why.append(_nt('shear.reason.stiffener_is_short', Is=Is, Ismin=Ismin))
        if kind is not None and Fys is not None and Fys > 0:
            Y = Fy_web / Fys
            D = STIFFENER_D[kind]
            bracket = ah - ah ** 2 / (ah + math.sqrt(1.0 + ah ** 2))
            Ast = (1.0 - Cv) / 2.0 * bracket * Y * D * h * t           # Eq. G4.1-2
            out.update(Y=Y, D=D, Ast_min=Ast, bracket=bracket)
            if As is not None and As < Ast:
                why.append(_nt('shear.reason.stiffener_area_short', As=As, Amin=Ast))
    if why:
        out.update(conforming=False, g4_2=True, reason=_joined('; ', why))
    elif missing:
        out['reason'] = _nt('shear.reason.stiffener_input_missing', names=', '.join(missing))
    else:
        out['conforming'] = True
    return out


def _g2_terms(h, t, Fy, E, kv):
    Vy = 0.60 * Fy * h * t                                                       # Eq. G2.1-5
    Vcr = (math.pi ** 2 * E * kv) / (12 * (1 - 0.3 ** 2)) * (t / h) ** 2 * h * t  # Eq. G2.3-1, G2.3-2
    lam = math.sqrt(Vy / Vcr) if Vcr > 0 else float('inf')                       # Eq. G2.1-4
    return Vy, Vcr, lam


def _g21_curve(Vy, Vcr, lam):
    if lam <= 0.815:
        return Vy, 'G2.1 (yielding)', 'G2.1-1'
    if lam <= 1.227:
        return 0.815 * math.sqrt(Vcr * Vy), 'G2.1 (inelastic)', 'G2.1-2a'
    return Vcr, 'G2.1 (elastic)', 'G2.1-3a'


def _g22_curve(Vy, Vcr, lam):
    if lam <= 0.776:
        return Vy, 'G2.2 (yielding)', 'G2.2-1'                                   # Eq. G2.2-1
    r = (Vcr / Vy) ** 0.4
    return (1.0 - 0.15 * r) * r * Vy, 'G2.2 (tension field)', 'G2.2-2'          # Eq. G2.2-2


def shear_web_strength(h: float, t: float, Fy: float, *, E: float = E_STEEL, stiffeners: dict | None = None,
                       holes: dict | None = None, section_canon: str | None = None) -> dict:
    """§G2 의 웹 하나 전단 강도 — 보강재(§G2.2 · §G2.3(b), §G4.1) · 구멍(§G3) 입력이 있을 때.

    evaluated False 면 Vn 은 None 이고 reason 이 까닭이다. 보강재 자료가 없거나 §G4.1 을 못 맞추면
    §G2.1(kv = 5.34, 보강 없는 웹) 값을 보수측 참고값(reference)으로만 싣는다 — 판정에 쓰지 않는다.
    구멍(§G3)을 평가하지 못하면 참고값을 싣지 않는다(구멍 없는 값은 보수측이 아니다).
    """
    Vy0, Vcr0, lam0 = _g2_terms(h, t, Fy, E, 5.34)
    Vn0, eq0, eqn0 = _g21_curve(Vy0, Vcr0, lam0)
    out = {'Vy': Vy0, 'Vcr': Vcr0, 'lambda_v': lam0, 'kv': 5.34, 'kv_equation': 'G2.3(a)', 'curve': 'G2.1',
           'Vn_g2': Vn0, 'equation': eq0, 'equation_id': eqn0, 'qs': None, 'g3': None, 'g4': None,
           'evaluated': True, 'reason': None, 'reference': None, 'warnings': [], 'assumptions': [],
           'scope_notes': [], 'stiffened': stiffeners is not None, 'holes': holes is not None}
    reasons = []
    if stiffeners is not None:
        g4 = g4_conformance(h, t, Fy, stiffeners, E)
        out['g4'] = g4
        out['scope_notes'].append(_nt('shear.scope.g2_stiffened_web'))
        if g4['conforming']:
            ah = g4['a_over_h']
            kv, kv_eq = _kv_stiffened(ah)
            Vy, Vcr, lam = _g2_terms(h, t, Fy, E, kv)
            if ah <= 2.0:
                Vn, eq, eqn = _g22_curve(Vy, Vcr, lam)
                curve = 'G2.2'
            else:
                # §G2.2: "spacing not exceeding twice the web depth" — 넘으면 §G2.1 에 §G2.3(b) 의 kv (G2.1 의 kv 는
                # "determined in accordance with Section G2.3"; Commentary G2.1: 보강재가 있든 없든 적용)
                Vn, eq, eqn = _g21_curve(Vy, Vcr, lam)
                curve = 'G2.1'
                out['assumptions'].append(_nt('shear.assumption.g2_2_spacing_over_2h', ratio=ah))
            out.update(Vy=Vy, Vcr=Vcr, lambda_v=lam, kv=kv, kv_equation=kv_eq, curve=curve, Vn_g2=Vn,
                       equation=eq, equation_id=eqn)
        else:
            reasons.append(g4['reason'])
            if g4.get('g4_2'):
                reasons.append(_nt('shear.reason.stiffener_g4_2'))
            out['reference'] = {'Vn': Vn0, 'basis': 'G2.1 kv = 5.34', 'conservative': True}
            out['warnings'].append(_nt('shear.warning.g2_1_conservative_reference'))
    if holes is not None:
        g3 = g3_reduction(h, t, holes, section_canon)
        out['g3'] = g3
        out['assumptions'].extend(g3['limits'].get('assumptions') or [])
        out['scope_notes'].append(_nt('shear.scope.g3_web_with_holes'))
        if g3['evaluated']:
            out['qs'] = g3['qs']
        else:
            reasons.append(g3['reason'])
            out['reference'] = None
    if reasons:
        out.update(evaluated=False, reason=_joined('; ', [r for r in reasons if r is not None]), Vn=None)
        return out
    out['Vn'] = out['Vn_g2'] * (out['qs'] if out['qs'] is not None else 1.0)
    return out


def g6_reduction(wc: dict, h: float, t: float, N: float, d: float | None, holes: dict) -> dict:
    """§G6 Rc — Eq. G6-1(끝 1-플랜지) · Eq. G6-2(내부 1-플랜지), Eq. G5-1 + Table G5-2 일 때만. 예제 II-10.

    "Where a web hole is within the bearing length, a bearing stiffener shall be used." — 구멍이 지압 길이 안이면
    평가하지 않는다(§F5 지압 보강재는 이 도구가 평가하지 않는다).
    """
    out = {'clause': 'G6', 'Rc': None, 'evaluated': False, 'reason': None, 'limits': None, 'equation': None}
    covered = (wc.get('section_family') == 'c' and wc.get('table') == 'G5-2' and wc.get('equation') == 'G5-1'
               and wc.get('support') in ('EOF', 'IOF'))
    if not covered:
        out['reason'] = _nt('shear.reason.g6_not_covered_case',
                            case=f"{wc.get('section_family')}, {wc.get('support')}, Eq. {wc.get('equation')}")
        return out
    g = _hole_geometry(holes)
    if g['within_bearing'] is True or (g['x'] is not None and g['x'] < 0):
        out['reason'] = _nt('shear.reason.g6_hole_within_bearing')
        return out
    lim = hole_limits('G6', h, t, holes, d=d)
    out['limits'] = lim
    why = [lim['reason']] if lim['reason'] is not None else []
    if g['x'] is None:
        why.append(_nt('shear.reason.holes_input_missing', clause='G6', names='hole_bearing_distance'))
    eof = wc.get('support') == 'EOF'
    Nmin = 1.0 if eof else 3.0                       # 원문: Eq. G6-1 아래 "N ≥ 1 in.", Eq. G6-2 아래 "N ≥ 3 in."
    out['N_min'] = Nmin
    if N < Nmin:
        why.append(_nt('shear.reason.g6_min_bearing', N=N, limit=Nmin, eq='G6-1' if eof else 'G6-2'))
    if why:
        out['reason'] = _joined('; ', why)
        return out
    dh, x = g['dh'], g['x']
    if eof:
        raw = 1.01 - 0.325 * dh / h + 0.083 * x / h       # Eq. G6-1
        eq = 'G6-1'
    else:
        raw = 0.90 - 0.047 * dh / h + 0.053 * x / h       # Eq. G6-2
        eq = 'G6-2'
    out.update(Rc=min(raw, 1.0), Rc_raw=raw, equation=eq, evaluated=True, dh=dh, x=x, N=N, h=h)
    return out


def _shear_strength_eb(h, t, Fy, E, transverse_stiffeners, new: dict, section_type) -> dict:
    """shear_strength 의 새 입력 길 — 옛 키(Vn · Vy · Vcr · lambda_v · equation · warnings · assumptions · scope_notes) 유지."""
    from design.global_buckling import canonical_section_name
    st = stiffener_inputs({**new, 'transverse_stiffeners': transverse_stiffeners})
    ho = hole_inputs(new)
    canon = canonical_section_name(section_type) if section_type else None
    sr = shear_web_strength(h, t, Fy, E=E, stiffeners=st, holes=ho, section_canon=canon)
    if ho is not None and canon is None:
        n = _nt('shear.reason.holes_section_not_c', clause='G3', section='(section_type not given)')
        sr.update(evaluated=False, Vn=None, reference=None, reason=_joined('; ', [r for r in (sr['reason'], n) if r]))
    out = {'Vn': sr['Vn'], 'Vy': sr['Vy'], 'Vcr': sr['Vcr'], 'lambda_v': sr['lambda_v'], 'equation': sr['equation'],
           'kv': sr['kv'], 'kv_equation': sr['kv_equation'], 'curve': sr['curve'], 'qs': sr['qs'],
           'evaluated': sr['evaluated'], 'reason': sr['reason'], 'reference': sr['reference'],
           'g3': sr['g3'], 'g4': sr['g4'], 'warnings': list(sr['warnings']), 'assumptions': list(sr['assumptions']),
           'scope_notes': list(sr['scope_notes']), 'spec_sections': ['G2'] + (['G3'] if ho is not None else [])
           + (['G4'] if st is not None else [])}
    if not sr['evaluated']:
        out['error'] = f"Shear strength not evaluated: {sr['reason']}"
        if ho is not None:
            out['warnings'].append(_nt('shear.warning.g3_not_evaluated', why=sr['reason']))
    return out


def _web_crippling_holes(h, t, R, N, Fy, theta, support, fastened, section_type, section_family, flange_condition,
                         Lo, edge_distance, n_webs, web_config, bearing_case, support_fastener_spacing, d, holes):
    """§G6 — §G5 의 결과에 Rc 를 곱한다(단독 도구). 평가하지 못하면 error 와 Pn None(구멍 없는 값은 보수측이 아니다)."""
    res, det = _web_crippling_detail(h, t, R, N, Fy, theta=theta, support=support, fastened=fastened,
                                     section_type=section_type, section_family=section_family,
                                     flange_condition=flange_condition, Lo=Lo, edge_distance=edge_distance,
                                     n_webs=n_webs, web_config=web_config, bearing_case=bearing_case,
                                     support_fastener_spacing=support_fastener_spacing, d=d)
    if 'error' in res:
        return res, det
    dd = d if (d is not None and d > 0) else h + 2.0 * (R + t)
    g6 = g6_reduction(res, h, t, N, dd, holes)
    scope = _nt('shear.scope.g6_web_with_holes')
    notes = list(((g6.get('limits') or {}).get('assumptions') or []))
    if d is None or not d > 0:
        notes.append(_nt('member.assumption.g6_depth_estimated', d=dd))
    if not g6['evaluated']:
        return {'error': f"§G6 web crippling of webs with holes not evaluated: {g6['reason']}", 'not_covered': True,
                'Pn': None, 'g6': g6, 'warnings': list(res.get('warnings') or []) + [
                    _nt('shear.warning.g6_not_evaluated', why=g6['reason'])],
                'assumptions': list(res.get('assumptions') or []) + notes,
                'scope_notes': [scope], 'spec_sections': ['G5', 'G6']}, None
    Rc = g6['Rc']
    pn0 = det['Pn_final']
    pn = Rc * pn0
    out = dict(res)
    out.update(Pn=round(pn, 3), Pn_per_web=round(Rc * det['terms']['Pn_per_web'], 3) if det.get('terms') else out['Pn_per_web'],
               Pn_without_holes=round(pn0, 3), Rc=round(Rc, 4), g6=g6,
               phi_Pn=round(res['phi'] * pn, 3), Pa=round(pn / res['omega'], 3) if res['omega'] > 0 else None,
               formula=res['formula'] + f"; §G6 Eq. {g6['equation']}: Rc = {Rc:.4f} → Pn = {pn:.3f} kips",
               scope_notes=[scope], spec_sections=['G5', 'G6'],
               assumptions=list(res.get('assumptions') or []) + notes)
    du = dict(res.get('display_unrounded') or {})
    du.update(Pn=pn, Pn_without_holes=pn0, Rc=Rc, phi_Pn=res['phi'] * pn)
    if res['omega'] > 0:
        du['Pa'] = pn / res['omega']
    out['display_unrounded'] = du
    det = dict(det, g6=dict(g6, Pn_g5=pn0), Pn_final=pn)
    return out, det
