"""접합부 설계 — AISI S100-16 Chapter J

볼트(J3), 나사(J4), 필릿용접(J2.5), 아크스팟(J2.2), 아크시임(J2.3), 그루브(J2.1 버트/J2.6 플레어),
PAF(J5) 접합부의 공칭강도 계산. 각 파괴 모드별 강도를 계산하고 지배 모드를 결정한다.

결과 계약
- limit_states[*]['direction']: 'shear' = 접합부가 판 면내로 전달하는 힘(패스너 전단·용접 접합력),
  'tension' = 패스너 축방향(인발·풀오버) 힘. 두 방향은 각자의 소요강도와 비교한다.
- not_evaluated: 해당하지만 평가하지 못한 한계상태·요건 목록. design_connection 이 소요강도
  방향에 따라 판정(pass)에 반영한다(불합격 > 미평가 > 합격).
- J6 파단(J6.1/J6.2/J6.3)은 용접·볼트·나사·PAF 모두에 적용 범위에 맞게 넣는다(J6 머리글).
"""

import math

from design.checks import Trace, q, src, CONTEXT_KEYS, display_rounding
from design.notices import N as _nt, attach as _attach_notices, joined as _joined  # noqa: E402

# 강재 탄성계수 (ksi) — 아크스팟 슬렌더니스 분기, PAF 전단 풀아웃(J5.3.3)에 사용
E_STEEL = 29500.0

# J2·J3·J6 적용범위: 가장 얇은 접합 부재 두께 ≤ 3/16 in (초과 시 AISC 360)
T_SCOPE_MAX = 3.0 / 16.0

# ============================================================
# 안전/저항 계수
# ============================================================

PHI_BOLT = {
    'bearing':  0.60,    # J3.3.1 (Eq. J3.3.1-1)
    'bearing_deformation': 0.65,  # J3.3.2 (Eq. J3.3.2-1)
    'shear':    0.75,    # J3.4 (Appendix A): φ=0.75
    'tension':  0.75,    # J3.4 (Appendix A): φ=0.75
}
OMEGA_BOLT = {
    'bearing':  2.50,
    'bearing_deformation': 2.22,
    'shear':    2.00,    # J3.4 (Appendix A): Ω=2.00
    'tension':  2.00,
}

# J6 파단 한계상태 계수 (Table J6-1) — connections.py 와 special_topics.py 가 함께 쓴다.
PHI_RUPTURE = {
    'weld':   0.60,
    'bolt':   0.65,
    'screw':  0.50,
    'paf':    0.50,
}
OMEGA_RUPTURE = {
    'weld':   2.50,
    'bolt':   2.22,
    'screw':  3.00,
    'paf':    3.00,
}

# A1.2(c) 합리적 해석(접합부) 계수 — 기준 식이 없는 한계상태를 공학적으로 평가할 때
PHI_RATIONAL_CONNECTION = 0.55
OMEGA_RATIONAL_CONNECTION = 3.00

_RUPTURE_ALIASES = {
    'weld': 'weld', 'welds': 'weld', 'welded': 'weld',
    'bolt': 'bolt', 'bolts': 'bolt', 'bolted': 'bolt',
    'screw': 'screw', 'screws': 'screw', 'screwed': 'screw',
    'paf': 'paf', 'pafs': 'paf',
}


def normalize_design_method(design_method) -> str:
    """'ASD'/'LRFD' 로 정규화한다. LSD·알 수 없는 값은 ValueError (ASD 로 위장하지 않는다)."""
    s = str(design_method if design_method is not None else 'LRFD').strip().upper()
    if s in ('LRFD', 'ASD'):
        return s
    if s == 'LSD':
        raise ValueError('LSD(캐나다) φ 계수는 이 접합부 엔진에 구현되어 있지 않습니다. '
                         'LRFD 또는 ASD를 사용하세요.')
    raise ValueError(f"Unrecognized design_method '{design_method}'. Use 'LRFD' or 'ASD'.")


def rupture_factors(connection_type) -> tuple:
    """Table J6-1 의 (φ, Ω, 정규화 키). connection_type: weld/bolt/screw/paf (복수·형용사형 허용)."""
    key = _RUPTURE_ALIASES.get(str(connection_type).strip().lower())
    if key is None:
        raise ValueError(f"Unknown connection type for Table J6-1: '{connection_type}' "
                         "(use 'welded', 'bolted', 'screw' or 'paf')")
    return PHI_RUPTURE[key], OMEGA_RUPTURE[key], key


def _available(Rn: float, phi: float, omega: float, design_method: str) -> float:
    return phi * Rn if design_method == 'LRFD' else Rn / omega


# 계산서(design_checks) 입력 꼴 — 값은 계산이 쓴 그 변수, 출처만 붙인다.
def _ui(sym, val, qty, key, **kw):
    return q(sym, val, qty, src('user_input', key=key, **kw))


def _mt(sym, val, key=None):
    return q(sym, val, 'stress', src('material', key=key or sym))


def _sp(sym, val, qty='dimensionless', **kw):
    return q(sym, val, qty, src('specification', **kw))


def _interaction_trace(tr, value_idx, limit_idx=None):
    """상호작용 항목의 계산 과정 — connection_checks 가 값 · 한계 단계를 찾는다."""
    return {'steps': tr.steps, 'value_step': value_idx, 'limit_step': limit_idx}


def _ne(name: str, direction: str, reason: str, category: str) -> dict:
    """not_evaluated 항목. direction: shear|tension|interaction|any.
    category: fastener|rupture|detailing|scope|interaction|member."""
    return {'name': name, 'direction': direction, 'reason': reason, 'category': category}


_USL_TERM_KEYS = {'d': 'd', 's': 's (sheet width / fasteners across, or given)', 'x̄': 'x_bar',
                  'L': 'L_conn (or (n_rows − 1)·pitch)', 'b1': 'b1', 'b2': 'b2', 'bf': 'bf', 'bw': 'bw'}


def _usl_step(tr, sl, Usl_in=None):
    """Usl 단계 — 입력이면 그 값, 아니면 Table J6.2-1 의 식을 기호로(숫자를 식 문자열에 넣지 않는다, V6-11)."""
    if Usl_in is not None:
        return tr.add('modifier', 'Usl (input)', inputs=[q('Usl', float(Usl_in), 'dimensionless',
                                                          src('user_input', key='Usl'))],
                      result=q('Usl', float(Usl_in), 'dimensionless'))
    ins = []
    for sym, val, qty in sl.get('terms') or []:
        if sym == 'Usl,min':
            ins.append(q(sym, val, qty, src('specification', equation='J6.2-4')))
        else:
            ins.append(q(sym, val, qty, src('user_input', key=_USL_TERM_KEYS.get(sym, sym))))
    return tr.add('modifier', sl.get('expr') or f"Usl ({sl.get('equation')})", equation=str(sl.get('equation')),
                  inputs=ins, result=q('Usl', sl['Usl'], 'dimensionless'))


# ============================================================
# Table J6.2-1 전단지연계수 (평판·앵글·채널, 볼트·용접) — 단일 구현
# ============================================================

_MEMBER_CASE_ALIASES = {
    'flat_sheet': 'flat_sheet', 'flat': 'flat_sheet', 'sheet': 'flat_sheet',
    'flat_sheet_staggered': 'flat_sheet_staggered', 'flat_sheet_stag': 'flat_sheet_staggered',
    'flat_staggered': 'flat_sheet_staggered', 'staggered': 'flat_sheet_staggered',
    'transverse_weld': 'transverse_weld', 'transverse_welds': 'transverse_weld',
    'all_elements': 'all_elements',
    'angle_welded': 'angle_welded', 'welded_angle': 'angle_welded',
    'angle_bolted': 'angle_bolted', 'bolted_angle': 'angle_bolted',
    'channel_welded': 'channel_welded', 'welded_channel': 'channel_welded',
    'channel_bolted': 'channel_bolted', 'bolted_channel': 'channel_bolted',
}
MEMBER_CASES = tuple(sorted(set(_MEMBER_CASE_ALIASES.values())))


def normalize_member_case(member_case):
    """Table J6.2-1 분류명 정규화(소문자, 하이픈·공백 → 밑줄). 알 수 없으면 None."""
    if member_case is None:
        return None
    s = str(member_case).strip().lower().replace('-', '_').replace(' ', '_')
    return _MEMBER_CASE_ALIASES.get(s)


def shear_lag_factor(member_case, d: float = None, s: float = None,
                     x_bar: float = None, L: float = None,
                     b1: float = None, b2: float = None,
                     bf: float = None, bw: float = None) -> dict:
    """Table J6.2-1 전단지연계수 Usl.

    Returns {'Usl', 'case', 'equation', 'formula', 'warnings', 'reason'}.
    Usl=None 이면 reason 에 평가하지 못한 까닭이 있다(입력 부족·알 수 없는 분류).
    """
    case = normalize_member_case(member_case)
    out = {'Usl': None, 'case': case, 'equation': None, 'formula': None,
           'warnings': [], 'reason': None}
    if case is None:
        out['reason'] = (f"member_case '{member_case}' 가 Table J6.2-1 분류가 아님 "
                         f"(허용: {', '.join(MEMBER_CASES)})")
        return out
    if case == 'flat_sheet':
        if d is not None and d > 0 and s is not None and s > 0:
            U = min(0.9 + 0.1 * d / s, 1.0)
            out.update(Usl=U, equation='J6.2-4',
                       formula=f'Usl = 0.9 + 0.1·d/s = 0.9 + 0.1×{d:.4f}/{s:.4f} = {U:.4f}',
                       expr='Usl = 0.9 + 0.1 d/s ≤ 1.0', terms=[('d', d, 'length'), ('s', s, 'length')])
        else:
            # Eq. J6.2-4 는 d/s ≥ 0 에서 0.9 이상이므로 0.9 는 하한이다.
            out.update(Usl=0.9, equation='J6.2-4 (하한)',
                       formula='Usl = 0.9 (d 또는 s 미지정 — Eq. J6.2-4 의 하한)',
                       expr='Usl = Usl,min  (d or s not given — lower bound of Eq. J6.2-4)',
                       terms=[('Usl,min', 0.9, 'dimensionless')])
            out['warnings'].append(_nt('conn.warning.j6_2_j6_usl_j6'))
        return out
    if case in ('flat_sheet_staggered', 'all_elements', 'transverse_weld'):
        row = {'flat_sheet_staggered': '(2)', 'all_elements': '(3)(b)', 'transverse_weld': '(3)(a)'}[case]
        out.update(Usl=1.0, equation=f'Table J6.2-1 {row}', formula=f'Usl = 1.0 (Table J6.2-1 {row})',
                   expr=f'Usl = 1.0  (Table J6.2-1 {row})', terms=[])
        return out
    if x_bar is None or L is None or L <= 0 or x_bar < 0:
        out['reason'] = f'{case}: x̄ 와 접합 길이 L(>0) 이 필요함'
        return out
    if case == 'angle_welded':
        U = max(min(1.0 - 1.20 * x_bar / L, 0.9), 0.4)
        out.update(Usl=U, equation='J6.2-5',
                   formula=f'Usl = 1 − 1.20·x̄/L = 1 − 1.20×{x_bar:.4f}/{L:.4f} → {U:.4f} (0.4 ≤ Usl ≤ 0.9)',
                   expr='Usl = 1 − 1.20 x̄/L, 0.4 ≤ Usl ≤ 0.9', terms=[('x̄', x_bar, 'length'), ('L', L, 'length')])
        return out
    if case == 'channel_welded':
        U = max(min(1.0 - 0.36 * x_bar / L, 0.9), 0.5)
        out.update(Usl=U, equation='J6.2-7',
                   formula=f'Usl = 1 − 0.36·x̄/L = 1 − 0.36×{x_bar:.4f}/{L:.4f} → {U:.4f} (0.5 ≤ Usl ≤ 0.9)',
                   expr='Usl = 1 − 0.36 x̄/L, 0.5 ≤ Usl ≤ 0.9', terms=[('x̄', x_bar, 'length'), ('L', L, 'length')])
        return out
    if case == 'angle_bolted':
        if not (b1 and b2 and b1 > 0 and b2 > 0):
            out['reason'] = 'angle_bolted: b1(비접합 다리), b2(접합 다리) 가 필요함'
            return out
        U = min(1.0 / (1.1 + 0.5 * b1 / (b2 + b1) + 2.0 * x_bar / L), 1.0)
        out.update(Usl=U, equation='J6.2-6',
                   formula=(f'Usl = 1/(1.1 + 0.5·b1/(b2+b1) + 2x̄/L) = 1/(1.1 + 0.5×{b1}/({b2}+{b1}) '
                            f'+ 2×{x_bar:.4f}/{L:.4f}) = {U:.4f}'),
                   expr='Usl = 1/(1.1 + 0.5 b1/(b2 + b1) + 2 x̄/L) ≤ 1.0',
                   terms=[('b1', b1, 'length'), ('b2', b2, 'length'), ('x̄', x_bar, 'length'), ('L', L, 'length')])
        return out
    if case == 'channel_bolted':
        if not (bf and bw and bf > 0 and bw > 0):
            out['reason'] = 'channel_bolted: bf(비접합 플랜지), bw(접합 웨브) 가 필요함'
            return out
        U = min(1.0 / (1.1 + bf / (bw + 2.0 * bf) + x_bar / L), 1.0)
        out.update(Usl=U, equation='J6.2-8',
                   formula=(f'Usl = 1/(1.1 + bf/(bw+2bf) + x̄/L) = 1/(1.1 + {bf}/({bw}+2×{bf}) '
                            f'+ {x_bar:.4f}/{L:.4f}) = {U:.4f}'),
                   expr='Usl = 1/(1.1 + bf/(bw + 2 bf) + x̄/L) ≤ 1.0',
                   terms=[('bf', bf, 'length'), ('bw', bw, 'length'), ('x̄', x_bar, 'length'), ('L', L, 'length')])
        return out
    out['reason'] = f'{case}: 처리하지 못한 분류'
    return out


def block_shear_nominal(Fy: float, Fu: float, Agv: float, Anv: float, Ant: float,
                        Ubs: float = 1.0) -> tuple:
    """Eq. J6.3-1/-2: (Pnr, Pnr1, Pnr2)."""
    Pnr1 = 0.6 * Fy * Agv + Ubs * Fu * Ant
    Pnr2 = 0.6 * Fu * Anv + Ubs * Fu * Ant
    return min(Pnr1, Pnr2), Pnr1, Pnr2


# Table J3.4-1 (Appendix A): 볼트 공칭 전단/인장강도 Fnv, Fnt (ksi)
# 키: (grade, threads_excluded). 'small' = 1/4<=d<1/2 in, 'large' = d>=1/2 in. None = NA.
_BOLT_TABLE_J34_1 = {
    # A307 Grade A — 나사 전단면 허용 (note b)
    ('A307', False): {'Fnv_small': 24.0, 'Fnv_large': 27.0, 'Fnt_small': 40.0, 'Fnt_large': 45.0},
    ('A307', True):  {'Fnv_small': 24.0, 'Fnv_large': 27.0, 'Fnt_small': 40.0, 'Fnt_large': 45.0},
    # A325 (F3125) — small(d<1/2) = NA
    ('A325', False): {'Fnv_small': None, 'Fnv_large': 54.0, 'Fnt_small': None, 'Fnt_large': 90.0},
    ('A325', True):  {'Fnv_small': None, 'Fnv_large': 68.0, 'Fnt_small': None, 'Fnt_large': 90.0},
    # A354 Grade BD
    ('A354BD', False): {'Fnv_small': 61.0, 'Fnv_large': 68.0, 'Fnt_small': 101.0, 'Fnt_large': 113.0},
    ('A354BD', True):  {'Fnv_small': 84.0, 'Fnv_large': 84.0, 'Fnt_small': 101.0, 'Fnt_large': 113.0},
    # A449
    ('A449', False): {'Fnv_small': 48.0, 'Fnv_large': 54.0, 'Fnt_small': 81.0, 'Fnt_large': 90.0},
    ('A449', True):  {'Fnv_small': 68.0, 'Fnv_large': 68.0, 'Fnt_small': 81.0, 'Fnt_large': 90.0},
    # A490 (F3125) — small(d<1/2) = NA
    ('A490', False): {'Fnv_small': None, 'Fnv_large': 68.0, 'Fnt_small': None, 'Fnt_large': 113.0},
    ('A490', True):  {'Fnv_small': None, 'Fnv_large': 84.0, 'Fnt_small': None, 'Fnt_large': 113.0},
}
_BOLT_GRADE_NORM = {
    'A307': 'A307', 'A307A': 'A307',
    'A325': 'A325', 'F3125A325': 'A325', 'A325M': 'A325',
    'A354BD': 'A354BD', 'A354': 'A354BD',
    'A449': 'A449',
    'A490': 'A490', 'F3125A490': 'A490', 'A490M': 'A490',
}


def _bolt_Fnv_Fnt(d: float, Fub: float, bolt_grade: str = None,
                  threads_excluded: bool = False) -> tuple:
    """Table J3.4-1 (Appendix A)로부터 (Fnv, Fnt, label) (ksi).

    bolt_grade 가 표에 있으면 표값. None 이면 "Threaded Parts" 행(Fub 계수):
    Fnv = 0.400·Fu(d<1/2, 나사 통과) / 0.450·Fu(d≥1/2, 나사 통과) / 0.563·Fu(나사 제외),
    Fnt = 0.675·Fu(d<1/2) / 0.75·Fu(d≥1/2).
    표에서 NA 인 조합(A325·A490 d<1/2 in)과 알 수 없는 등급은 ValueError.
    """
    small = d < 0.5  # 1/4 in <= d < 1/2 in
    if bolt_grade:
        key = str(bolt_grade).upper().replace('-', '').replace(' ', '')
        grade = _BOLT_GRADE_NORM.get(key)
        if grade is None:
            raise ValueError(f"Unknown bolt_grade '{bolt_grade}' (Table J3.4-1: "
                             "A307, A325, A354BD, A449, A490)")
        row = _BOLT_TABLE_J34_1[(grade, bool(threads_excluded))]
        Fnv = row['Fnv_small'] if small else row['Fnv_large']
        Fnt = row['Fnt_small'] if small else row['Fnt_large']
        if Fnv is None or Fnt is None:
            raise ValueError(f'Table J3.4-1: {grade} 볼트는 d < 1/2 in 에서 NA(사용 불가) — d={d}')
        return Fnv, Fnt, grade
    if threads_excluded:
        fnv_coef = 0.563
    else:
        fnv_coef = 0.400 if small else 0.450
    return fnv_coef * Fub, (0.675 if small else 0.75) * Fub, 'Threaded Parts'


def _bolt_hole_dia(d: float) -> float:
    """표준 구멍 직경 dh (Table J3-1, in)."""
    if d < 0.5:
        return d + 1.0 / 32.0
    elif d < 1.0:
        return d + 1.0 / 16.0
    elif d == 1.0:
        return 1.125
    else:
        return d + 1.0 / 8.0


def _normalize_hole_type(hole_type) -> str:
    s = str(hole_type or 'standard').strip().lower().replace('-', '_').replace(' ', '_')
    if s in ('standard', 'std'):
        return 'standard'
    if s in ('oversized', 'oversize'):
        return 'oversized'
    if s in ('short_slotted', 'short_slot', 'short_slotted_parallel', 'short_slotted_perp',
             'short_slotted_perpendicular'):
        return 'short_slotted'
    if s in ('long_slotted', 'long_slot'):
        return 'long_slotted'
    return s


def _bolt_hole_dims(d: float, hole_type: str, slot_orientation: str = None) -> tuple:
    """Table J3-1 구멍 치수 → (하중방향 치수, 하중직각 치수). 슬롯 방향 미상이면 긴 치수(보수)."""
    std = _bolt_hole_dia(d)
    if hole_type == 'oversized':
        if d < 0.5:
            dh = d + 1.0 / 16.0
        elif d < 1.0:
            dh = d + 1.0 / 8.0
        elif d == 1.0:
            dh = 1.25
        else:
            dh = d + 5.0 / 16.0
        return dh, dh
    if hole_type == 'short_slotted':
        if d < 1.0:
            length = d + 0.25
        elif d == 1.0:
            length = 1.3125
        else:
            length = d + 0.375
        if slot_orientation == 'parallel':
            return length, std
        if slot_orientation == 'perpendicular':
            return std, length
        return length, length
    return std, std


def _normalize_orientation(o):
    if o is None:
        return None
    s = str(o).strip().lower()
    if s.startswith('par'):
        return 'parallel'
    if s.startswith('perp') or s.startswith('trans') or s.startswith('normal'):
        return 'perpendicular'
    return None


PHI_SCREW = {
    'bearing':  0.50,    # J4.3.1
    'pullout':  0.50,    # J4.4.1
    'pullover': 0.50,    # J4.4.2
    'shear':    0.50,    # J4.3.2
    'tilting':  0.50,    # J4.3.1
    'tension':  0.50,    # J4.4.3
}
OMEGA_SCREW = {
    'bearing':  3.00,
    'pullout':  3.00,
    'pullover': 3.00,
    'shear':    3.00,
    'tilting':  3.00,
    'tension':  3.00,
}

# 참고용 상수(미사용): 용접 φ/Ω 는 각 식(J2.1, J2.2.2.1, J2.3.2.1, J2.5, J2.6)에 직접 둔다.
PHI_WELD = {
    'weld_shear':  0.60,    # J2.2.2.1-1 / J2.3.2.1
    'sheet_shear': 0.60,
    'sheet_tear':  0.60,
}
OMEGA_WELD = {
    'weld_shear':  2.55,
    'sheet_shear': 2.55,
    'sheet_tear':  2.55,
}


# ============================================================
# J6 파단 한계상태 (전단파단/순단면 인장파단/블록전단)
# ============================================================

def _j6_rupture_limit_states(conn: str, Fu: float, t: float, dh: float,
                             n: int, e: float, Fy: float = None,
                             Ag: float = None, width: float = None,
                             d: float = None, s: float = None,
                             g: float = None, s_pitch: float = None,
                             include_block_shear: bool = True,
                             geometry: dict = None,
                             dh_transverse: float = None,
                             dh_net: float = None,
                             j62_factors: tuple = None,
                             e_assumed: bool = False,
                             notes: list = None,
                             label: str = '') -> tuple:
    """J6 파단 한계상태. 반환: (limit_states, warnings, not_evaluated)

    Args:
        conn: 'bolt' | 'screw' | 'paf' | 'weld' (Table J6-1 계수)
        Fu, Fy: 임계 부재 강도 (ksi)
        t: 임계 부재 두께 (in)
        dh: 하중방향 구멍(용접) 치수 — J6.1 e_net = e − dh/2, J6.3 Anv
        n: 패스너(용접) 총 개수
        e: 끝단 거리(하중방향 첫 패스너 중심 → 재단 끝), in. None 이면 J6.1·J6.3 미평가.
        Ag, width: J6.2 총단면적/시트폭 (Ag 없으면 width·t)
        d: Usl(Eq. J6.2-4) 의 d (볼트 공칭직경·나사 d·PAF ds·용접은 제거 폭)
        s: Eq. J6.2-4 의 s (시트폭/단면 구멍수). None 이면 width/단면 구멍수.
        g: 하중직각 패스너 간격 (J6.3 인장면, 엇모 J6.2-3)
        s_pitch: 엇모 종방향 간격 s'
        geometry: 추가 기하 dict — member_case, Usl, x_bar, L_conn, b1, b2, bf, bw,
            n_rows_long(하중방향 행 수), pitch(하중방향 간격), edge_transverse(패스너 선 →
            나란한 연단 거리), Agv_bs/Anv_bs/Ant_bs(블록전단 면적 직접 입력), Ant(Table J6.2-1 (3)(a))
        dh_transverse: 하중직각 구멍 치수(J6.3 Ant). None 이면 dh.
        dh_net: J6.2 Ant 의 구멍 치수 (볼트는 표준공, Eq. J6.2-3). None 이면 dh.
        j62_factors: (φ, Ω, basis) — J6.2 를 합리적 해석으로 평가할 때(용접)
        e_assumed: e 가 입력이 아니라 최소값 가정이면 True (J6.1·J6.3 이 'assumed' 가 되어 판정에 쓰이지 않음)
        notes: 호출자 진술(해당 없음 선언 등)을 덧붙일 목록 (결과의 assumptions)
        label: 한계상태 이름 뒤에 붙일 표지 (두 번째 판: ' [part 2]')

    호출자 진술 (geometry):
        member_case='not_tension_member' — 이 판은 접합력을 인장재로 받지 않는다 → J6.2 해당 없음
        j6_3_not_applicable=True — 블록전단 경로가 없다고 호출자가 밝힘 → J6.3 해당 없음
    """
    geo = dict(geometry or {})
    for k, v in (('Ag', Ag), ('width', width), ('g', g), ('s_pitch', s_pitch)):
        if v is not None:
            geo[k] = v
    Ag = geo.get('Ag')
    width = geo.get('width')
    g = geo.get('g')
    s_pitch = geo.get('s_pitch')
    dh_tr = dh_transverse if dh_transverse is not None else dh
    dh_n = dh_net if dh_net is not None else dh

    ls, warnings, ne = [], [], []
    if notes is None:
        notes = []
    phi_r, omega_r = PHI_RUPTURE[conn], OMEGA_RUPTURE[conn]
    not_tension = str(geo.get('member_case') or '').strip().lower().replace('-', '_') == 'not_tension_member'
    j63_na = bool(geo.get('j6_3_not_applicable'))

    n = int(n)
    n_rows = int(geo.get('n_rows_long') or 1)
    pitch = geo.get('pitch')
    if n_rows < 1 or n % n_rows != 0:
        ne.append(_ne('J6 파단', 'shear',
                      _nt('conn.reason.rows_long', n=n, n_rows=n_rows),
                      'rupture'))
        return ls, warnings, ne
    n_cross = n // n_rows
    if n_rows > 1 and not (pitch and pitch > 0):
        ne.append(_ne('J6.1/J6.3', 'shear', _nt('conn.reason.rows_long_pitch'), 'rupture'))
        pitch_ok = False
    else:
        pitch_ok = True

    # --- J6.1 전단파단 (Eq. J6.1-1, J6.1-2) ---
    if e is None:
        ne.append(_ne('Shear Rupture (J6.1)', 'shear', _nt('conn.reason.end_distance_not_given'), 'rupture'))
    elif pitch_ok:
        e_net = max(e - dh / 2.0, 0.0) + (n_rows - 1) * max((pitch or 0.0) - dh, 0.0)
        Anv = 2.0 * n_cross * t * e_net
        Pnv = 0.6 * Fu * Anv
        tr = Trace()
        i_e = tr.add('equation', 'e_net = (e − dh/2) + (n_rows − 1)(pitch − dh)', equation=None,
                     inputs=[q('e', e, 'length', src('engine_default', key='e', note=_nt('conn.note.e_min_1_5d'))
                               if e_assumed else src('user_input', key='e')),
                             q('dh', dh, 'length', src('specification', note=_nt('conn.note.hole_dimension_along_load'))),
                             q('n_rows', n_rows, 'count', src('user_input', key='n_rows_long')),
                             q('pitch', pitch or 0.0, 'length', src('user_input', key='pitch'))],
                     result=q('e_net', e_net, 'length'))
        i_a = tr.add('equation', 'Anv = 2 n t e_net', equation='J6.1-2',
                     inputs=[q('n', n_cross, 'count', src('user_input', key='n / n_rows_long')),
                             q('t', t, 'length', src('user_input', key='t')), tr.ref(i_e)],
                     result=q('Anv', Anv, 'area'))
        tr.add('equation', 'Pnv = 0.6 Fu Anv', equation='J6.1-1',
               inputs=[q('Fu', Fu, 'stress', src('material', key='Fu')), tr.ref(i_a)], result=q('Pnv', Pnv, 'force'))
        item = {
            'name': 'Shear Rupture (J6.1)',
            'Rn': Pnv, 'phi': phi_r, 'omega': omega_r, 'direction': 'shear',
            'formula': (f'Pnv = 0.6×{Fu}×Anv, Anv = 2×{n_cross}×{t}×e_net({e_net:.4f}) = {Anv:.4f}'
                        + (' (e=최소값 가정)' if e_assumed else '')),
            'equation': 'J6.1-1',
            '_trace': tr.steps,
        }
        if e_assumed:
            item['assumed'] = True
        ls.append(item)

    # --- J6.2 순단면 인장파단 (Eq. J6.2-1..-3, Table J6.2-1) ---
    if Ag is None and width is not None:
        Ag = width * t
    if not_tension:
        # Table J6.2-1 은 인장재 접합의 전단지연 표다 — 인장재가 아니면 J6 머리글의 "as applicable" 로 제외
        notes.append(_nt('conn.assumption.j6_2_j6_member_case_tension', label=label))
    elif Ag is None or Ag <= 0:
        ne.append(_ne('Tension Rupture (J6.2)', 'shear',
                      _nt('conn.reason.ag_width'), 'rupture'))
    else:
        case = normalize_member_case(geo.get('member_case'))
        Usl_in = geo.get('Usl')
        if case is None and geo.get('member_case') is not None:
            ne.append(_ne('Tension Rupture (J6.2)', 'shear',
                          _nt('conn.reason.table_j6_2_1_member_case_j6', member_case=geo.get('member_case')),
                          'rupture'))
        elif case is None and Usl_in is None:
            ne.append(_ne('Tension Rupture (J6.2)', 'shear',
                          _nt('conn.reason.table_j6_2_1_member_case_j6_flat'), 'rupture'))
        else:
            if case == 'transverse_weld':
                Ant = geo.get('Ant')
                ant_note = 'Ant = 직접 접합된 요소 면적(입력)'
            else:
                Ant = Ag - n_cross * dh_n * t
                ant_note = f'Ant = Ag − {n_cross}×{dh_n:.4f}×{t}'
                if s_pitch and g and g > 0:
                    Ant += t * (s_pitch ** 2) / (4.0 * g + 2.0 * dh_n)
                    ant_note += ' + t·s\'²/(4g+2dh)'
            if Ant is None:
                ne.append(_ne('Tension Rupture (J6.2)', 'shear',
                              _nt('conn.reason.table_j6_2_1_j6_ant'), 'rupture'))
            else:
                Ant = max(Ant, 0.0)
                sl = None
                if Usl_in is not None:
                    Usl, usl_eq, usl_formula = float(Usl_in), 'Usl 입력', f'Usl = {float(Usl_in):.4f} (입력)'
                    usl_reason = None
                else:
                    L_conn = geo.get('L_conn')
                    if L_conn is None and n_rows > 1 and pitch:
                        L_conn = (n_rows - 1) * pitch
                    s_eff = s if s is not None else geo.get('s')
                    if s_eff is None and width:
                        s_eff = width / max(n_cross, 1)
                    sl = shear_lag_factor(case, d=d, s=s_eff, x_bar=geo.get('x_bar'), L=L_conn,
                                          b1=geo.get('b1'), b2=geo.get('b2'),
                                          bf=geo.get('bf'), bw=geo.get('bw'))
                    Usl, usl_eq, usl_formula, usl_reason = sl['Usl'], sl['equation'], sl['formula'], sl['reason']
                    warnings.extend(sl['warnings'])
                if Usl is None:
                    ne.append(_ne('Tension Rupture (J6.2)', 'shear', usl_reason, 'rupture'))
                else:
                    Usl = max(min(Usl, 1.0), 0.0)
                    Pnt = Fu * Usl * Ant
                    if j62_factors is not None:
                        phi62, om62, basis62 = j62_factors
                    else:
                        phi62, om62, basis62 = phi_r, omega_r, _nt('conn.label.factor_table_j6_1')
                    tr = Trace()
                    if case == 'transverse_weld':
                        i_ant = tr.add('equation', 'Ant = area of directly connected elements (input)',
                                       equation='Table J6.2-1 (3)(a)',
                                       inputs=[q('Ant', Ant, 'area', src('user_input', key='Ant'))],
                                       result=q('Ant', Ant, 'area'))
                    else:
                        ant_ins = [q('Ag', Ag, 'area', src('user_input', key='Ag / width·t')),
                                   q('n', n_cross, 'count', src('user_input', key='fasteners in the section')),
                                   q('dh', dh_n, 'length', src('specification', note=_nt('conn.note.table_j3_1_standard_hole_j3'))),
                                   q('t', t, 'length', src('user_input', key='t'))]
                        ant_expr = 'Ant = Ag − n dh t'
                        if s_pitch and g and g > 0:
                            ant_expr += " + t s'² / (4 g + 2 dh)  (staggered)"
                            ant_ins += [q("s'", s_pitch, 'length', src('user_input', key='s_pitch')),
                                        q('g', g, 'length', src('user_input', key='g'))]
                        i_ant = tr.add('equation', ant_expr, equation='J6.2-3', inputs=ant_ins,
                                       result=q('Ant', Ant, 'area'))
                    i_u = _usl_step(tr, dict(sl or {}, Usl=Usl), Usl_in)
                    tr.add('equation', 'Pnt = Fu Usl Ant', equation='J6.2-1',
                           inputs=[q('Fu', Fu, 'stress', src('material', key='Fu')), tr.ref(i_u), tr.ref(i_ant)],
                           result=q('Pnt', Pnt, 'force'))
                    item = {
                        'name': 'Tension Rupture (J6.2)',
                        'Rn': Pnt, 'phi': phi62, 'omega': om62, 'direction': 'shear',
                        'formula': (f'Pnt = {Fu}×Usl×Ant, {usl_formula} [{usl_eq}], '
                                    f'{ant_note} = {Ant:.4f}'),
                        'equation': 'J6.2-1',
                        'factor_basis': basis62,
                        '_trace': tr.steps,
                    }
                    if j62_factors is not None:
                        item['basis'] = 'rational_A1.2c'
                    ls.append(item)

    # --- J6.3 블록전단 (볼트/용접만, Eq. J6.3-1/-2) ---
    if include_block_shear and conn in ('bolt', 'weld') and j63_na:
        notes.append(_nt('conn.assumption.j6_3_not_applicable_stated_path', label=label))
    elif include_block_shear and conn in ('bolt', 'weld'):
        explicit = [geo.get('Agv_bs'), geo.get('Anv_bs'), geo.get('Ant_bs')]
        paths = []
        if all(v is not None for v in explicit):
            paths.append(('입력 면적', explicit[0], explicit[1], explicit[2]))
        elif Fy is not None and e is not None and pitch_ok:
            L_sh = e + (n_rows - 1) * (pitch or 0.0)
            edge_t = geo.get('edge_transverse')
            if n_cross >= 2 and g is not None and g > 0:
                # 두 전단면 + 패스너 사이 인장면 (Commentary Fig. C-J6-4)
                Agv = 2.0 * L_sh * t
                Anv = Agv - 2.0 * (n_rows - 0.5) * dh * t
                Ant_bs = (n_cross - 1) * max(g - dh_tr, 0.0) * t
                paths.append(('2 전단면', Agv, Anv, Ant_bs))
            if edge_t is not None and edge_t > 0:
                # 바깥 패스너 선 1 전단면 + 나란한 연단까지 인장면 (Manual Example IV-10)
                Agv = L_sh * t
                Anv = Agv - (n_rows - 0.5) * dh * t
                gg = g if (g and n_cross >= 2) else 0.0
                Ant_bs = max(edge_t + (n_cross - 1) * gg - (n_cross - 0.5) * dh_tr, 0.0) * t
                paths.append(('연단 1 전단면', Agv, Anv, Ant_bs))
        if paths:
            best = None
            for plabel, Agv, Anv, Ant_bs in paths:
                Pnr, P1, P2 = block_shear_nominal(Fy if Fy is not None else Fu, Fu,
                                                  Agv, max(Anv, 0.0), Ant_bs)
                if best is None or Pnr < best[0]:
                    best = (Pnr, P1, P2, plabel, Agv, Anv, Ant_bs)
            Pnr, P1, P2, plabel, Agv, Anv, Ant_bs = best
            if Fy is None:
                warnings.append(_nt('conn.warning.j6_3_j6_fy_j6_fu'))
            area_src = (src('user_input', key='Agv_bs/Anv_bs/Ant_bs') if plabel == '입력 면적'
                        else src('specification', note=_nt('conn.note.block_shear_path_areas', plabel=plabel)))
            tr = Trace()
            fy_q = q('Fy', Fy if Fy is not None else Fu, 'stress',
                     src('material', key='Fy' if Fy is not None else 'Fu (Fy not given)'))
            fu_q = q('Fu', Fu, 'stress', src('material', key='Fu'))
            agv, anv, ant = (q('Agv', Agv, 'area', area_src), q('Anv', max(Anv, 0.0), 'area', area_src),
                             q('Ant', Ant_bs, 'area', area_src))
            ubs = q('Ubs', 1.0, 'dimensionless', src('specification'))
            i1 = tr.add('equation', 'Pnr1 = 0.6 Fy Agv + Ubs Fu Ant', equation='J6.3-1',
                        inputs=[fy_q, agv, ubs, fu_q, ant], result=q('Pnr1', P1, 'force'), path=plabel)
            i2 = tr.add('equation', 'Pnr2 = 0.6 Fu Anv + Ubs Fu Ant', equation='J6.3-2',
                        inputs=[fu_q, anv, ubs, ant], result=q('Pnr2', P2, 'force'), path=plabel)
            tr.add('equation', 'Pnr = min(Pnr1, Pnr2)', inputs=[tr.ref(i1), tr.ref(i2)], result=q('Pnr', Pnr, 'force'))
            item = {
                '_trace': tr.steps,
                'name': 'Block Shear (J6.3)',
                'Rn': Pnr, 'phi': phi_r, 'omega': omega_r, 'direction': 'shear',
                'formula': (f'[{plabel}] Agv={Agv:.4f}, Anv={Anv:.4f}, Ant={Ant_bs:.4f}, Ubs=1.0: '
                            f'Pnr = min({P1:.3f}, {P2:.3f}) = {Pnr:.3f}'
                            + (' (e=최소값 가정)' if e_assumed and plabel != '입력 면적' else '')),
                'equation': 'J6.3-1/-2',
            }
            if e_assumed and plabel != '입력 면적':
                item['assumed'] = True
            ls.append(item)
        else:
            if Fy is None:
                reason = _nt('conn.reason.fy_not_given')
            elif e is None:
                reason = _nt('conn.reason.end_distance_not_given')
            elif n_cross >= 2:
                reason = _nt('conn.reason.gauge_not_given')
            else:
                reason = (_nt('conn.reason.edge_transverse_agv_bs'))
            ne.append(_ne('Block Shear (J6.3)', 'shear', reason, 'rupture'))
    if label:
        for x in ls:
            x['name'] += label
        for x in ne:
            x['name'] += label
    return ls, warnings, ne


def _j6_second_part(conn: str, part2: dict, n: int, dh: float, d_usl: float, notes: list,
                    dh_transverse: float = None, dh_net: float = None,
                    j62_factors: tuple = None, include_block_shear: bool = True) -> tuple:
    """두 번째 접합 판의 J6 (판마다 끝단 거리·폭·두께·강도가 다를 수 있다).

    part2: {'t', 'Fu', 'Fy', 'e', 그리고 _j6_rupture_limit_states 의 geometry 키}
    """
    p = dict(part2)
    t2p, Fu2p = p.get('t'), p.get('Fu')
    if t2p is None or Fu2p is None:
        return [], [], [_ne('J6 [part 2]', 'shear', _nt('conn.reason.j6_part2_fu'), 'rupture')]
    return _j6_rupture_limit_states(
        conn=conn, Fu=Fu2p, t=t2p, dh=dh, n=n, e=p.get('e'), Fy=p.get('Fy'),
        d=d_usl, include_block_shear=include_block_shear, geometry=p,
        dh_transverse=dh_transverse, dh_net=dh_net, j62_factors=j62_factors,
        notes=notes, label=' [part 2]')


def _part_basis_note(kind: str, t: float, has_part2: bool) -> str:
    if has_part2:
        return _nt('conn.assumption.j6_both_parts_checked', t=t)
    return (_nt('conn.assumption.j6_one_part_checked', kind=kind, t=t))


# Chapter D 인장 한계상태 계수
PHI_TENSION = {'yield': 0.90, 'rupture': 0.75}   # D2 / D3 (LRFD)
OMEGA_TENSION = {'yield': 1.67, 'rupture': 2.00}  # D2 / D3 (ASD)


def _chapter_d_tension_caps(Fy: float, Fu: float, t: float, dh: float,
                            n: int, Ag: float = None, width: float = None,
                            Ae: float = None) -> tuple:
    """Chapter D 부재 인장 한계상태(D2 항복/D3 순단면 파단)를 한계상태로 반환.

    부재 총단면적 Ag(또는 폭 width)가 주어질 때만 평가한다. 반환: (limit_states, warnings)
    Ae 가 None 이면 An=Ag−n·dh·t (전단지연 미반영).
    """
    ls = []
    warnings = []
    if Ag is None and width is not None:
        Ag = width * t
    if Ag is None or Ag <= 0:
        return ls, warnings
    Tn_y = Ag * Fy
    ag_q = q('Ag', Ag, 'area', src('user_input', key='Ag / width·t'))
    tr = Trace()
    tr.add('yield', 'Tn = Ag Fy', equation='D2-1', inputs=[ag_q, q('Fy', Fy, 'stress', src('material', key='Fy'))],
           result=q('Tn', Tn_y, 'force'))
    ls.append({
        'name': 'Member Tension Yield (D2)',
        'Rn': Tn_y, 'phi': PHI_TENSION['yield'], 'omega': OMEGA_TENSION['yield'],
        'direction': 'shear',
        'formula': f'Tn = Ag({Ag:.4f})×Fy({Fy}) = {Tn_y:.3f}',
        'equation': 'D2-1',
        '_trace': tr.steps,
    })
    An = Ae if Ae is not None else max(Ag - n * dh * t, 0.0)
    Tn_r = An * Fu
    tr = Trace()
    if Ae is not None:
        an_q = q('An', An, 'area', src('user_input', key='Ae'))
    else:
        i_an = tr.add('equation', 'An = Ag − n_holes dh t',
                      inputs=[ag_q, q('n_holes', n, 'count', src('user_input', key='n (holes in the section)') if n
                                      else src('specification', note=_nt('conn.note.welded_connection_no_holes_2'))),
                              q('dh', dh, 'length', src('specification', note=_nt('conn.note.standard_hole'))),
                              q('t', t, 'length', src('user_input', key='t'))],
                      result=q('An', An, 'area'))
        an_q = tr.ref(i_an)
    tr.add('equation', 'Tn = An Fu', equation='D3-1', inputs=[an_q, q('Fu', Fu, 'stress', src('material', key='Fu'))],
           result=q('Tn', Tn_r, 'force'))
    ls.append({
        'name': 'Member Tension Rupture (D3)',
        'Rn': Tn_r, 'phi': PHI_TENSION['rupture'], 'omega': OMEGA_TENSION['rupture'],
        'direction': 'shear',
        'formula': f'Tn = An({An:.4f})×Fu({Fu}) = {Tn_r:.3f}',
        'equation': 'D3-1',
        '_trace': tr.steps,
    })
    if Ae is None:
        warnings.append(
            _nt('conn.warning.j6_2_chapter_ae_ag_dh'))
    return ls, warnings


def _finish(connection_type: str, limit_states: list, not_evaluated: list,
            warnings: list, design_method: str, spec_sections: list,
            extra: dict = None, interaction_checks: list = None,
            detailing_checks: list = None, assumptions: list = None) -> dict:
    """설계강도·방향별 지배 모드·결과 dict 조립."""
    # 계산서(design_checks) 재료는 결과 키에 남기지 않고 따로 둔다(옛 키 · 값은 그대로).
    check_data = {
        'traces': [item.pop('_trace', None) for item in limit_states],
        'Rn_raw': [item['Rn'] for item in limit_states],
        'iraws': [ic.pop('_raw', None) for ic in (interaction_checks or [])],
        'itraces': [ic.pop('_trace', None) for ic in (interaction_checks or [])],
        'draws': [dc.pop('_raw', None) for dc in (detailing_checks or [])],
    }
    # 설계강도: 지배 모드 · 판정은 반올림하지 않은 값으로 정하고, 키(design_strength · Rn)는 표시용 소수 3자리.
    ds_raw = {}
    for item in limit_states:
        item.setdefault('direction', 'shear')
        Rn = item['Rn']
        ds_raw[id(item)] = _available(Rn, item['phi'], item['omega'], design_method)
        item['design_strength'] = round(ds_raw[id(item)], 3)
        item['Rn'] = round(Rn, 3)
    check_data['ds_raw'] = [ds_raw[id(item)] for item in limit_states]

    def _raw(x):
        return ds_raw[id(x)]
    shear_ls = [x for x in limit_states if x['direction'] == 'shear']
    tension_ls = [x for x in limit_states if x['direction'] == 'tension']
    gov_s = min(shear_ls, key=_raw) if shear_ls else None
    gov_t = min(tension_ls, key=_raw) if tension_ls else None
    # 가정값으로 만든 한계상태(assumed)는 참고로만 보이고 판정에는 쓰지 않는다 (FIXES §3.1).
    ver_s = [x for x in shear_ls if not x.get('assumed')]
    ver_t = [x for x in tension_ls if not x.get('assumed')]
    vgov_s = min(ver_s, key=_raw) if ver_s else None
    vgov_t = min(ver_t, key=_raw) if ver_t else None
    check_data['gov_raw'] = {
        'shear': _raw(gov_s) if gov_s else None, 'tension': _raw(gov_t) if gov_t else None,
        'shear_verified': _raw(vgov_s) if vgov_s else None,
        'tension_verified': _raw(vgov_t) if vgov_t else None,
    }
    primary = gov_s or gov_t
    if primary is not None:
        primary['governs'] = True
    if gov_t is not None:
        gov_t['governs_tension'] = True
    result = {
        'connection_type': connection_type,
        'limit_states': limit_states,
        'governing_mode': primary['name'] if primary else None,
        'design_strength': primary['design_strength'] if primary else None,
        'Rn': primary['Rn'] if primary else None,
        'spec_sections': spec_sections,
        'shear_governing_mode': gov_s['name'] if gov_s else None,
        'shear_design_strength': gov_s['design_strength'] if gov_s else None,
        'tension_governing_mode': gov_t['name'] if gov_t else None,
        'tension_design_strength': gov_t['design_strength'] if gov_t else None,
        'governing_assumed': bool(primary and primary.get('assumed')),
        'shear_verified_governing_mode': vgov_s['name'] if vgov_s else None,
        'shear_verified_design_strength': vgov_s['design_strength'] if vgov_s else None,
        'tension_verified_governing_mode': vgov_t['name'] if vgov_t else None,
        'tension_verified_design_strength': vgov_t['design_strength'] if vgov_t else None,
        'not_evaluated': not_evaluated,
        'interaction_checks': interaction_checks or [],
        'detailing_checks': detailing_checks or [],
        'assumptions': assumptions or [],
        'design_method': design_method,
        'j6_verified': not any(x['category'] == 'rupture' for x in not_evaluated),
        'warnings': list(warnings),
    }
    for x in not_evaluated:
        result['warnings'].append(_nt('conn.warning.limit_state_not_evaluated', name=x['name'], reason=x['reason']))
    if extra:
        result.update(extra)
    # 소요를 모르는 단계의 검토 항목(직접 호출용). design_connection 이 소요로 다시 만든다.
    from design.connection_checks import build as _build_checks
    result['design_checks'] = _build_checks(result, check_data, 0.0, 0.0)
    result['_check_data'] = check_data
    return result


def _detail(name: str, provided: float, required: float, clause: str) -> dict:
    return {'name': name, 'provided': round(provided, 4), 'required': round(required, 4),
            'pass': provided >= required - 1e-9, 'clause': clause,
            '_raw': {'provided': provided, 'required': required}}


def _scope_thickness(t_min: float, clause: str, not_eval: list):
    if t_min > T_SCOPE_MAX + 1e-9:
        not_eval.append(_ne(f'적용범위 ({clause})', 'any',
                            _nt('conn.reason.aisi_s100_ansi_aisc', t_min=t_min, clause=clause), 'scope'))


_CONCENTRIC = _nt('conn.assumption.j1_concentric_load')


# ============================================================
# 볼트 접합 (J3)
# ============================================================

def bolt_connection(t1: float, t2: float, d: float,
                    Fy: float, Fu: float, Fub: float,
                    e: float = None, s: float = None,
                    n: int = 1,
                    design_method: str = 'LRFD',
                    bolt_grade: str = None,
                    threads_excluded: bool = False,
                    mf: float = None,
                    hole_type: str = 'standard',
                    pattern_length: float = None,
                    Ag: float = None, width: float = None,
                    g: float = None, s_pitch: float = None,
                    Vu: float = None, Tu: float = None,
                    member_tension: bool = False, Ae: float = None,
                    slot_orientation: str = None,
                    washers: str = None, shear_plane: str = None,
                    consider_hole_deformation: bool = False,
                    Pnov_bolt: float = None,
                    j6_geometry: dict = None,
                    dw: float = None, j6_part2: dict = None) -> dict:
    """볼트 접합 설계 (§J3 + App. A §J3.4 + §J6)

    Args:
        t1, t2: 연결판 두께 (in)
        d: 볼트 직경 (in)
        Fy, Fu: 모재 항복/인장강도 (ksi)
        Fub: 볼트 인장강도 (ksi) — bolt_grade 가 없을 때 "Threaded Parts" 행에 사용.
            bolt_grade 와 Fub 가 모두 없으면 승인 볼트 중 최저인 A307 값을 쓴다(경고).
        e: 끝단 거리 (in). None 이면 J3.2 최소 1.5d 로 J6.1 을 평가하고 미확인으로 표시.
        s: 볼트 중심 간격 (in, J3.1 검사). None 이고 n>1 이면 g(1열일 때)로 대신하거나 미확인.
        n: 볼트 개수
        design_method: 'ASD' | 'LRFD'
        bolt_grade: 'A307'|'A325'|'A354BD'|'A449'|'A490' (None이면 Threaded Parts)
        threads_excluded: 전단면에서 나사 제외 여부 (Table J3.4-1)
        mf: 지압 수정계수 (Table J3.3.1-2). None 이면 washers/shear_plane 로 표에서 고르고,
            그것도 없으면 구멍 종류별 최소값(표준 0.75, 과대·단슬롯 평행 0.70, 단슬롯 직각·미상 0.55).
        hole_type: 'standard'|'oversized'|'short_slotted' ('long_slotted' 는 시험 필요 → 오류)
        pattern_length: 패스너 패턴 길이 (in) — >38 in 이면 Fnv×0.833 (Table J3.4-1 note a)
        Ag, width, g, s_pitch: J6 기하 (선택)
        Vu, Tu: 접합부 전체 소요 전단력·인장력 (kips). Tu 가 있으면 볼트 인장(J3.4)과
            전단-인장 상호작용(Eq. J3.4-2/-3)을 평가한다.
        member_tension: True 이면 Chapter D(D2/D3) 캡 적용
        Ae: 유효 순단면적 (in^2) — D3 용
        slot_orientation: 'parallel'|'perpendicular' (단슬롯이 하중에 대해)
        washers: 'both'|'one'|'none' (Table J3.3.1-2)
        shear_plane: 'single'|'double_outside'|'double_inside' (Table J3.3.1-2)
        consider_hole_deformation: True 이면 J3.3.2 (Eq. J3.3.2-1) 도 평가
        Pnov_bolt: 볼트 머리·너트·와셔에서 판 풀오버 공칭강도 (kips/볼트, 시험·합리적 해석).
            App. A J3.4 는 볼트 인장 시 이 검토를 요구하지만 식이 없다.
        dw: 볼트 머리·와셔의 판 접촉 직경 (in). Pnov_bolt 가 없으면 Eq. J4.4.2-1 꼴
            1.5·t·d'w·Fu (d'w ≤ 3/4 in) 을 A1.2(c) 합리적 해석으로 쓴다(Ω 3.00/φ 0.50). 둘 다 없으면 미평가.
        j6_geometry: J6 추가 기하 (_j6_rupture_limit_states 참고)
        j6_part2: 두 번째 판의 J6 입력 {'t', 'Fu', 'Fy', 'e', 'width'|'Ag', 'g', 'member_case', …}
    """
    try:
        dm = normalize_design_method(design_method)
    except ValueError as exc:
        return {'error': str(exc)}
    n = int(n)
    if n < 1:
        return {'error': f'n={n}: 볼트 개수는 1 이상'}
    hole = _normalize_hole_type(hole_type)
    if hole == 'long_slotted':
        return {'error': 'App. A J3.4 / J3: 장슬롯 구멍의 접합 강도는 K2 하중시험으로 정해야 함 — 계산 미지원'}
    if hole not in ('standard', 'oversized', 'short_slotted'):
        return {'error': f"Unknown hole_type '{hole_type}'"}
    orient = _normalize_orientation(slot_orientation)
    if hole == 'short_slotted' and orient is None and str(hole_type).lower().endswith(('perp', 'perpendicular')):
        orient = 'perpendicular'
    if hole == 'short_slotted' and orient is None and str(hole_type).lower().endswith('parallel'):
        orient = 'parallel'

    geo = dict(j6_geometry or {})
    t_min = min(t1, t2)
    limit_states, warnings, not_eval, detailing = [], [], [], []
    assumptions = [_CONCENTRIC]
    _scope_thickness(t_min, 'J3/J6', not_eval)
    dh_along, dh_tr = _bolt_hole_dims(d, hole, orient)
    dh_std = _bolt_hole_dia(d)

    # J3.2 끝단·연단 거리, J3.1 간격
    e_assumed = False
    if e is None:
        e = 1.5 * d
        e_assumed = True
        not_eval.append(_ne('끝단 거리 (J3.2)', 'shear',
                            _nt('conn.reason.j6_1_j6'), 'detailing'))
    else:
        detailing.append(_detail('끝단 거리 e ≥ 1.5d (J3.2)', e, 1.5 * d, 'J3.2'))
        if hole != 'standard':
            detailing.append(_detail('구멍 가장자리 → 끝단 ≥ d (J3.2)', e - dh_along / 2.0, d, 'J3.2'))
    edge_t = geo.get('edge_transverse')
    if edge_t is not None:
        detailing.append(_detail('연단 거리 ≥ 1.5d (J3.2)', edge_t, 1.5 * d, 'J3.2'))
    n_rows = int(geo.get('n_rows_long') or 1)
    spacing = s
    if spacing is None and n > 1:
        if n_rows > 1 and geo.get('pitch'):
            spacing = geo.get('pitch')
        elif g is not None:
            spacing = g
    if n > 1:
        if spacing is None:
            not_eval.append(_ne('볼트 간격 (J3.1)', 'shear', _nt('conn.reason.spacing_not_given_3d'), 'detailing'))
        else:
            detailing.append(_detail('볼트 간격 s ≥ 3d (J3.1)', spacing, 3.0 * d, 'J3.1'))
            if hole != 'standard':
                detailing.append(_detail('구멍 순간격 ≥ 2d (J3.1)', spacing - max(dh_along, dh_tr), 2.0 * d, 'J3.1'))

    # (a) 지압 강도 (J3.3.1, Eq. J3.3.1-1): Pnb = C·mf·d·t·Fu, C 는 Table J3.3.1-1 (d/t)
    if not (0.024 <= t_min < 0.1875):
        not_eval.append(_ne('Bearing (J3.3.1)', 'shear',
                            _nt('conn.reason.table_j3_3_1_1_j3', t_min=t_min),
                            'fastener'))
    else:
        dt = d / t_min
        if hole in ('oversized', 'short_slotted'):
            C = 3.0 if dt < 7 else (1.0 + 14.0 / dt if dt <= 18 else 1.8)
        else:
            C = 3.0 if dt < 10 else (4.0 - 0.1 * dt if dt <= 22 else 1.8)
        mf_note = ''
        mf_given = mf is not None
        if mf is None:
            mf, mf_note = _mf_from_table(hole, orient, washers, shear_plane)
            warnings.append(_nt('conn.warning.table_j3_3_1_2_j3_mf', mf=mf, mf_note=mf_note))
        Pnb = n * C * mf * d * t_min * Fu
        d_q = q('d', d, 'length', src('user_input', key='d'))
        t_q = q('t', t_min, 'length', src('user_input', key='min(t1, t2)'))
        fu_q = q('Fu', Fu, 'stress', src('material', key='Fu'))
        n_q = q('n', n, 'count', src('user_input', key='n'))
        tr = Trace()
        i_c = tr.add('modifier', 'C from Table J3.3.1-1 (d/t, hole type)', equation='Table J3.3.1-1',
                     inputs=[d_q, t_q], result=q('C', C, 'dimensionless'), hole_type=hole)
        mf_q = q('mf', mf, 'dimensionless', src('user_input', key='mf') if mf_given
                 else src('specification', table='J3.3.1-2', note=mf_note))
        tr.add('equation', 'Pnb = n C mf d t Fu', equation='J3.3.1-1',
               inputs=[n_q, tr.ref(i_c), mf_q, d_q, t_q, fu_q], result=q('Pnb', Pnb, 'force'))
        limit_states.append({
            'name': 'Bearing (J3.3.1)',
            'Rn': Pnb, 'phi': PHI_BOLT['bearing'], 'omega': OMEGA_BOLT['bearing'],
            'direction': 'shear',
            'formula': f'Pnb = {n}×C×mf×d×t×Fu, C={C:.3f}(d/t={dt:.2f}), mf={mf} = {Pnb:.3f}',
            'equation': 'J3.3.1-1',
            '_trace': tr.steps,
        })
        if consider_hole_deformation:
            Pnb2 = n * (4.64 * t_min + 1.53) * d * t_min * Fu
            tr = Trace()
            # 4.64 t 의 t 는 in 단위다(원문의 α = 1 for US) — 식 문자열은 US 단위로 쓴 것(V6-11, 계약 §3)
            tr.add('equation', 'Pnb = n (4.64 α t + 1.53) d t Fu', equation='J3.3.2-1',
                   inputs=[n_q, _sp('α', 1.0, note=_nt('conn.note.unit_conversion_coefficient_inches')),
                           t_q, d_q, fu_q],
                   result=q('Pnb', Pnb2, 'force'), expr_units='US',
                   units_note='4.64 α t is written for t in inches (α = 1); in SI α = 0.0394 for t in mm')
            limit_states.append({
                'name': 'Bearing w/ Hole Deformation (J3.3.2)',
                'Rn': Pnb2, 'phi': PHI_BOLT['bearing_deformation'],
                'omega': OMEGA_BOLT['bearing_deformation'], 'direction': 'shear',
                'formula': f'Pnb = {n}×(4.64t+1.53)·d·t·Fu = {Pnb2:.3f}',
                'equation': 'J3.3.2-1',
                '_trace': tr.steps,
            })

    # (b) 볼트 전단·인장 (App. A J3.4, Eq. J3.4-1; Table J3.4-1)
    Ab = math.pi / 4 * d ** 2
    Fnv = Fnt = None
    grade_label = None
    if d < 0.25:
        not_eval.append(_ne('Bolt Shear (J3.4)', 'shear', _nt('conn.reason.table_j3_4_1_j3', d=d),
                            'fastener'))
        not_eval.append(_ne('Bolt Tension (J3.4)', 'tension', _nt('conn.reason.table_j3_4_1_j3', d=d),
                            'fastener'))
    else:
        grade = bolt_grade
        if not grade and not (Fub and Fub > 0):
            grade = 'A307'
            warnings.append(_nt('conn.warning.app_a_j3_bolt_grade_fub'))
        try:
            Fnv, Fnt, grade_label = _bolt_Fnv_Fnt(d, Fub or 0.0, grade, threads_excluded)
        except ValueError as exc:
            return {'error': str(exc)}
        if grade_label == 'A354BD' and d >= 0.5:
            warnings.append(_nt('conn.warning.j3_j3_astm_a354_grade'))
        Fnv_table = Fnv
        if pattern_length is not None and pattern_length > 38.0:
            Fnv *= 0.833
        Pns = n * Ab * Fnv
        bn = q('n', n, 'count', src('user_input', key='n'))
        tr = Trace()
        i_ab = tr.add('equation', 'Ab = π d² / 4', inputs=[q('d', d, 'length', src('user_input', key='d'))],
                      result=q('Ab', Ab, 'area'))
        fnv_q = q('Fnv', Fnv_table, 'stress', src('specification', table='J3.4-1', row=grade_label,
                                                   threads_excluded=bool(threads_excluded)))
        if Fnv != Fnv_table:
            i_f = tr.add('modifier', 'Fnv = 0.833 Fnv (fastener pattern length > 38 in)',
                         equation='Table J3.4-1 note a',
                         inputs=[fnv_q, q('L_pattern', pattern_length, 'length',
                                          src('user_input', key='pattern_length'))],
                         result=q('Fnv', Fnv, 'stress'))
            fnv_q = tr.ref(i_f)
        tr.add('equation', 'Pnv = n Ab Fnv', equation='J3.4-1', inputs=[bn, tr.ref(i_ab), fnv_q],
               result=q('Pnv', Pns, 'force'))
        limit_states.append({
            'name': 'Bolt Shear (J3.4)',
            'Rn': Pns, 'phi': PHI_BOLT['shear'], 'omega': OMEGA_BOLT['shear'], 'direction': 'shear',
            'formula': f'Pns = {n}×{Ab:.4f}×Fnv({grade_label})={Fnv:.1f} = {Pns:.3f}',
            'equation': 'J3.4-1 (Appendix A)',
            '_trace': tr.steps,
        })
        Pnt = n * Ab * Fnt
        tr = Trace()
        i_ab = tr.add('equation', 'Ab = π d² / 4', inputs=[q('d', d, 'length', src('user_input', key='d'))],
                      result=q('Ab', Ab, 'area'))
        tr.add('equation', 'Pnt = n Ab Fnt', equation='J3.4-1',
               inputs=[bn, tr.ref(i_ab), q('Fnt', Fnt, 'stress', src('specification', table='J3.4-1',
                                                                    row=grade_label))],
               result=q('Pnt', Pnt, 'force'))
        limit_states.append({
            'name': 'Bolt Tension (J3.4)',
            'Rn': Pnt, 'phi': PHI_BOLT['tension'], 'omega': OMEGA_BOLT['tension'], 'direction': 'tension',
            'formula': f'Pnt = {n}×{Ab:.4f}×Fnt({grade_label})={Fnt:.1f} = {Pnt:.3f}',
            'equation': 'J3.4-1 (Appendix A)',
            '_trace': tr.steps,
        })
    if Pnov_bolt is not None and Pnov_bolt > 0:
        tr = Trace()
        tr.add('equation', 'Pnov = n Pnov,bolt  (test / rational value, A1.2(c) factors)',
               inputs=[_ui('n', n, 'count', 'n'), _ui('Pnov,bolt', Pnov_bolt, 'force', 'Pnov_bolt')],
               result=q('Pnov', n * Pnov_bolt, 'force'))
        limit_states.append({
            '_trace': tr.steps,
            'name': 'Sheet Pull-over at Bolt Head (App. A J3.4)',
            'Rn': n * Pnov_bolt, 'phi': PHI_RATIONAL_CONNECTION, 'omega': OMEGA_RATIONAL_CONNECTION,
            'direction': 'tension', 'basis': 'user_value_A1.2c',
            'formula': f'Pnov = {n}×{Pnov_bolt} (입력값, A1.2(c) 계수)',
            'equation': 'App. A J3.4 (식 없음)',
        })
    elif dw is not None and dw > 0:
        # App. A J3.4 는 식을 주지 않는다 — 나사의 Eq. J4.4.2-1 을 A1.2(c) 합리적 해석으로 쓴다.
        # 계수는 J4(Ω 3.00/φ 0.50) 와 A1.2(c)(Ω 3.00/φ 0.55) 중 보수 쪽.
        dwc = min(dw, 0.75)
        Pnov_b = 1.5 * t_min * dwc * Fu * n
        tr = Trace()
        i_dw = tr.add('modifier', "d'w = min(d'w, d'w,max)", equation='J4.4.2',
                      inputs=[_ui("d'w", dw, 'length', 'dw'), _sp("d'w,max", 0.75, 'length', note=_nt('conn.note.j4_4_2_j4'))],
                      result=q("d'w", dwc, 'length'))
        tr.add('equation', "Pnov = 1.5 t d'w Fu n  (Eq. J4.4.2-1 form, A1.2(c))", equation='J4.4.2-1',
               inputs=[_ui('t', t_min, 'length', 'min(t1, t2)'), tr.ref(i_dw), _mt('Fu', Fu),
                       _ui('n', n, 'count', 'n')], result=q('Pnov', Pnov_b, 'force'))
        limit_states.append({
            '_trace': tr.steps,
            'name': 'Sheet Pull-over at Bolt Head (App. A J3.4)',
            'Rn': Pnov_b, 'phi': 0.50, 'omega': 3.00, 'direction': 'tension', 'basis': 'rational_A1.2c',
            'formula': f"Pnov = 1.5×t({t_min})×d'w({dwc:.3f})×Fu({Fu})×{n} = {Pnov_b:.3f} "
                       '(Eq. J4.4.2-1 꼴, A1.2(c) 합리적 해석)',
            'equation': 'J4.4.2-1 (A1.2(c))',
        })
        assumptions.append(_nt('conn.assumption.app_a_j3_j4_fu_a1'))
    else:
        not_eval.append(_ne('Sheet Pull-over at Bolt Head (App. A J3.4)', 'tension',
                            _nt('conn.reason.a1_2_dw_a1_pnov_bolt'), 'fastener'))

    # (c) J6 파단: J6.1/J6.3 은 실제 구멍, J6.2 Ant 는 표준공(Eq. J6.2-3)
    j6_ls, j6_warn, j6_ne = _j6_rupture_limit_states(
        conn='bolt', Fu=Fu, t=t_min, dh=dh_along, n=n, e=e, Fy=Fy,
        Ag=Ag, width=width, d=d, s=None, g=g, s_pitch=s_pitch,
        include_block_shear=True, geometry=geo, dh_transverse=dh_tr, dh_net=dh_std,
        e_assumed=e_assumed, notes=assumptions)
    limit_states.extend(j6_ls)
    warnings.extend(j6_warn)
    not_eval.extend(j6_ne)
    if j6_part2:
        p_ls, p_w, p_ne = _j6_second_part('bolt', j6_part2, n, dh_along, d, assumptions,
                                          dh_transverse=dh_tr, dh_net=dh_std)
        limit_states.extend(p_ls)
        warnings.extend(p_w)
        not_eval.extend(p_ne)
    assumptions.append(_part_basis_note('', t_min, bool(j6_part2)))
    assumptions.append(_nt('conn.assumption.j3_3_1_bearing_thinner_sheet'))

    if member_tension:
        d_ls, d_warn = _chapter_d_tension_caps(
            Fy=Fy, Fu=Fu, t=t_min, dh=dh_std, n=n,
            Ag=Ag if Ag is not None else geo.get('Ag'),
            width=width if width is not None else geo.get('width'), Ae=Ae)
        limit_states.extend(d_ls)
        warnings.extend(d_warn)

    # (d) App. A J3.4(b) 전단-인장 상호작용 (Eq. J3.4-2 ASD / J3.4-3 LRFD)
    shear_tension = None
    interaction = []
    if Tu is not None and Tu > 0 and Fnv:
        phi_v, omega_v = PHI_BOLT['shear'], OMEGA_BOLT['shear']
        phi_t, omega_t = PHI_BOLT['tension'], OMEGA_BOLT['tension']
        if Vu is None:
            V_req = 0.0
            not_eval.append(_ne('전단-인장 상호작용 (App. A J3.4)', 'interaction',
                                _nt('conn.reason.vu_fv'), 'interaction'))
        else:
            V_req = abs(Vu)
        fv = V_req / (n * Ab)
        st_warn = []
        fv_cap = phi_v * Fnv if dm == 'LRFD' else Fnv / omega_v
        if fv > fv_cap:
            st_warn.append(
                _nt('conn.warning.app_a_j3_fv', fv=fv, fv_cap=fv_cap))
        if dm == 'LRFD':
            Fnt_red = 1.3 * Fnt - (Fnt / (phi_v * Fnv)) * fv
        else:
            Fnt_red = 1.3 * Fnt - (omega_v * Fnt / Fnv) * fv
        Fnt_red = max(min(Fnt_red, Fnt), 0.0)
        Pnt_prime = n * Ab * Fnt_red
        avail_T = _available(Pnt_prime, phi_t, omega_t, dm)
        ratio = (Tu / avail_T) if avail_T > 0 else float('inf')
        eq = 'J3.4-3 (LRFD)' if dm == 'LRFD' else 'J3.4-2 (ASD)'
        shear_tension = {
            'V_required': round(V_req, 3), 'T_required': round(Tu, 3), 'fv': round(fv, 3),
            'Fnt': round(Fnt, 2), 'Fnv': round(Fnv, 2), 'Fnt_reduced': round(Fnt_red, 3),
            'Pnt_prime': round(Pnt_prime, 3), 'available_tension': round(avail_T, 3),
            'ratio': round(ratio, 4), 'pass': ratio <= 1.0, 'equation': eq,
        }
        if st_warn:
            shear_tension['warnings'] = st_warn
            warnings.extend(st_warn)
        interaction.append({'name': "Bolt tension with F'nt (App. A J3.4)", 'equation': eq,
                            'value': round(Tu, 4), 'limit': round(avail_T, 4),
                            'ratio': round(ratio, 4), 'pass': ratio <= 1.0,
                            '_raw': {'value': Tu, 'limit': avail_T, 'ratio': ratio, 'quantity': 'force',
                                     'fv': fv, 'Fnt_red': Fnt_red, 'Pnt_prime': Pnt_prime,
                                     'V': V_req, 'n': n, 'd': d, 'Ab': Ab, 'Fnt': Fnt, 'Fnv': Fnv,
                                     'phi_v': phi_v, 'omega_v': omega_v, 'phi_t': phi_t, 'omega_t': omega_t}})

    spec_sections = ['J3.1', 'J3.2', 'J3.3.1', 'J3.4', 'J6.1', 'J6.2', 'J6.3']
    if consider_hole_deformation:
        spec_sections.insert(3, 'J3.3.2')
    if member_tension:
        spec_sections += ['D2', 'D3']
    extra = {}
    if shear_tension is not None:
        extra['shear_tension_interaction'] = shear_tension
    return _finish('bolt', limit_states, not_eval, warnings, dm, spec_sections, extra,
                   interaction, detailing, assumptions)


def _mf_from_table(hole: str, orient: str, washers, shear_plane) -> tuple:
    """Table J3.3.1-2. 정보가 모자라면 해당 구멍 종류에서 가장 작은 값(보수)."""
    w = str(washers).lower() if washers else None
    sp = str(shear_plane).lower() if shear_plane else None
    inside = sp is not None and 'inside' in sp
    if inside:
        if hole == 'standard':
            return 1.33, _nt('conn.note.mf_inside_standard')
        if hole == 'oversized' or (hole == 'short_slotted' and orient == 'parallel'):
            return 1.10, _nt('conn.note.mf_inside_oversized')
        return 0.90, _nt('conn.note.mf_inside_slot_transverse')
    if hole == 'standard':
        if w == 'both' and sp is not None:
            return 1.00, _nt('conn.note.mf_outside_standard_both_washers')
        return 0.75, _nt('conn.note.mf_outside_standard')
    if hole == 'oversized' or (hole == 'short_slotted' and orient == 'parallel'):
        return 0.70, _nt('conn.note.mf_outside_oversized')
    return 0.55, _nt('conn.note.mf_outside_slot_transverse')


# ============================================================
# 나사 접합 (J4)
# ============================================================

def screw_connection(t1: float, t2: float, d: float,
                     Fy: float, Fu: float, Fub: float,
                     n: int = 1,
                     design_method: str = 'LRFD',
                     Fu1: float = None, Fu2: float = None,
                     tc: float = None, dw: float = None,
                     e: float = None,
                     Ag: float = None, width: float = None,
                     g: float = None,
                     member_tension: bool = False, Ae: float = None,
                     Vu: float = None, Tu: float = None,
                     Pnvs: float = None, Pnts: float = None,
                     Fy1: float = None, Fy2: float = None,
                     d_head_washer: float = None, s: float = None,
                     j6_geometry: dict = None,
                     j45_rational: bool = True, j6_part2: dict = None) -> dict:
    """나사 접합 설계 (§J4 + §J6)

    두께의 뜻(§J4 표기, 바꿔 넣으면 풀오버가 비보수가 된다):
        t1: 나사 머리/와셔와 **접촉하는** 부재 두께 (in)
        t2: 나사 머리/와셔와 접촉하지 **않는** (far) 부재 두께 (in)
        Fu1, Fu2 / Fy1, Fy2: t1/t2 부재의 강도 (ksi). None 이면 Fu / Fy.
    d: 나사 공칭 직경 (in), §J4 적용범위 0.08 ≤ d ≤ 0.25 in
    Fub: Pnvs 미입력 시 사내 추정 0.5·Fub·As 에만 쓰임 (기준값 아님 → 미평가 표시)
    tc: 관입깊이와 t2 중 작은 값 (in). None 이면 t2.
    dw: 유효 풀오버 직경 d'w (in, J4.4.2 (a)(b)(c)). None 이면 2d 추정 + 미평가 표시.
    Pnvs, Pnts: 제조사·독립시험 나사 전단/인장 공칭강도 (kips/개, J4.3.2·J4.4.3)
    d_head_washer: J4.5.1 의 dw(머리 직경과 와셔 직경 중 큰 값). None 이면 d'w (보수).
    e: 끝단 거리 (in). None 이면 1.5d 로 J6.1 계산 + 미확인 표시.
    s: 나사 중심 간격 (in, J4.1)
    Vu, Tu: 접합부 전체 소요 전단·인장력 (kips) — 둘 다 있으면 J4.5.1/J4.5.2/J4.5.3
    member_tension: True 이면 Chapter D 캡
    j45_rational: J4.5.1/J4.5.2 적용한계 밖이면 Commentary C-J4.5.1-1 직선식을 A1.2(c) 로 쓸지 (기본 True).
        False 면 그 조합은 미평가.
    j6_part2: 두 번째 판의 J6 입력 (bolt_connection 과 같음)
    """
    try:
        dm = normalize_design_method(design_method)
    except ValueError as exc:
        return {'error': str(exc)}
    n = int(n)
    if n < 1:
        return {'error': f'n={n}: 나사 개수는 1 이상'}
    if Fu1 is None:
        Fu1 = Fu
    if Fu2 is None:
        Fu2 = Fu
    if Fy1 is None:
        Fy1 = Fy
    if Fy2 is None:
        Fy2 = Fy
    geo = dict(j6_geometry or {})
    limit_states, warnings, not_eval, detailing = [], [], [], []
    assumptions = [_CONCENTRIC]

    if not (0.08 <= d <= 0.25):
        not_eval.append(_ne('적용범위 (J4)', 'any',
                            _nt('conn.reason.j4_screw_diameter_out_of_range', d=d), 'scope'))
    if t1 > t2:
        warnings.append(
            _nt('conn.warning.j4_j4_t1_t2_t1', t1=t1, t2=t2))

    e_assumed = False
    if e is None:
        e = 1.5 * d
        e_assumed = True
        not_eval.append(_ne('끝단 거리 (J4.2)', 'shear',
                            _nt('conn.reason.j6_1_j6'), 'detailing'))
    else:
        detailing.append(_detail('끝단 거리 e ≥ 1.5d (J4.2)', e, 1.5 * d, 'J4.2'))
    if n > 1:
        spacing = s if s is not None else g
        if spacing is None:
            not_eval.append(_ne('나사 간격 (J4.1)', 'shear', _nt('conn.reason.spacing_not_given_3d'), 'detailing'))
        else:
            detailing.append(_detail('나사 간격 ≥ 3d (J4.1)', spacing, 3.0 * d, 'J4.1'))

    # (a) 전단 지압/tilting — J4.3.1 (각 항은 해당 부재 두께·강도)
    ratio = t2 / t1 if t1 > 0 else float('inf')
    Pns_eq1 = 4.2 * math.sqrt(max(t2 ** 3 * d, 0.0)) * Fu2 * n  # Eq. J4.3.1-1
    Pns_eq2 = 2.7 * t1 * d * Fu1 * n                            # Eq. J4.3.1-2
    Pns_eq3 = 2.7 * t2 * d * Fu2 * n                            # Eq. J4.3.1-3
    if ratio <= 1.0:
        Pns = min(Pns_eq1, Pns_eq2, Pns_eq3)
        eq_bear = 'J4.3.1-1/2/3'
    elif ratio >= 2.5:
        Pns = min(Pns_eq2, Pns_eq3)
        eq_bear = 'J4.3.1-4/5'
    else:
        interp = (ratio - 1.0) / 1.5
        Pns = (1 - interp) * min(Pns_eq1, Pns_eq2, Pns_eq3) + interp * min(Pns_eq2, Pns_eq3)
        eq_bear = 'J4.3.1 (linear interpolation)'
    sd = q('d', d, 'length', src('user_input', key='d'))
    sn = q('n', n, 'count', src('user_input', key='n'))
    st1 = q('t1', t1, 'length', src('user_input', key='t1 (head side)'))
    st2 = q('t2', t2, 'length', src('user_input', key='t2'))
    sfu1 = q('Fu1', Fu1, 'stress', src('material', key='Fu1'))
    sfu2 = q('Fu2', Fu2, 'stress', src('material', key='Fu2'))
    tr = Trace()
    # t2/t1 ≥ 2.5 이면 틸팅(Eq. J4.3.1-1)은 쓰이지 않는다 — 쓰는 값만 싣는다.
    i1 = None if ratio >= 2.5 else tr.add(
        'equation', 'Pnv1 = 4.2 (t2³ d)^0.5 Fu2 n  (tilting)', equation='J4.3.1-1',
        inputs=[st2, sd, sfu2, sn], result=q('Pnv1', Pns_eq1, 'force'))
    i2 = tr.add('equation', 'Pnv2 = 2.7 t1 d Fu1 n', equation='J4.3.1-2', inputs=[st1, sd, sfu1, sn],
                result=q('Pnv2', Pns_eq2, 'force'))
    i3 = tr.add('equation', 'Pnv3 = 2.7 t2 d Fu2 n', equation='J4.3.1-3', inputs=[st2, sd, sfu2, sn],
                result=q('Pnv3', Pns_eq3, 'force'))
    i_r = tr.add('equation', 't2/t1', inputs=[st1, st2], result=q('t2/t1', ratio, 'dimensionless'))
    if ratio <= 1.0:
        tr.branch('t2/t1 ≤ 1.0', True, 'J4.3.1-1/2/3', inputs=[tr.ref(i_r)])
        tr.add('equation', 'Pnv = min(Pnv1, Pnv2, Pnv3)', inputs=[tr.ref(i1), tr.ref(i2), tr.ref(i3)],
               result=q('Pnv', Pns, 'force'))
    elif ratio >= 2.5:
        tr.branch('t2/t1 ≥ 2.5', True, 'J4.3.1-4/5', inputs=[tr.ref(i_r)])
        tr.add('equation', 'Pnv = min(Pnv2, Pnv3)  (Eq. J4.3.1-4/-5)', inputs=[tr.ref(i2), tr.ref(i3)],
               result=q('Pnv', Pns, 'force'))
    else:
        tr.branch('1.0 < t2/t1 < 2.5 (linear interpolation)', True, 'J4.3.1', inputs=[tr.ref(i_r)])
        tr.add('equation', 'Pnv = (1 − k) min(Pnv1, Pnv2, Pnv3) + k min(Pnv2, Pnv3), k = (t2/t1 − 1)/1.5',
               inputs=[tr.ref(i_r), tr.ref(i1), tr.ref(i2), tr.ref(i3)], result=q('Pnv', Pns, 'force'))
    limit_states.append({
        'name': 'Bearing/Tilting (J4.3.1)',
        'Rn': Pns, 'phi': PHI_SCREW['bearing'], 'omega': OMEGA_SCREW['bearing'], 'direction': 'shear',
        'formula': f'Pnv = {Pns:.3f} kips (t2/t1={ratio:.2f})',
        'equation': eq_bear,
        '_trace': tr.steps,
    })

    # (b) 나사 전단 (J4.3.2) — Pnvs 는 제조사·독립시험 값
    As = math.pi / 4 * d ** 2
    if Pnvs is not None and Pnvs > 0:
        tr = Trace()
        tr.add('equation', 'Pnvs,total = n Pnvs', equation='J4.3.2',
               inputs=[sn, q('Pnvs', Pnvs, 'force', src('user_input', key='Pnvs', note=_nt('conn.note.manufacturer_test_value')))],
               result=q('Pnvs', Pnvs * n, 'force'))
        limit_states.append({
            'name': 'Screw Shear (J4.3.2)',
            'Rn': Pnvs * n, 'phi': PHI_SCREW['shear'], 'omega': OMEGA_SCREW['shear'], 'direction': 'shear',
            'formula': f'Pnvs = {Pnvs}×{n} (제조사/시험값) = {Pnvs * n:.3f}',
            'equation': 'J4.3.2', 'basis': 'manufacturer',
            '_trace': tr.steps,
        })
    else:
        Fub_eff = Fub if (Fub and Fub > 0) else 100.0
        Pss = 0.50 * Fub_eff * As * n
        tr = Trace()
        tr.add('equation', 'Pnvs ≈ 0.5 Fub As n (in-house estimate, not a specification value)',
               inputs=[q('Fub', Fub_eff, 'stress', src('user_input', key='Fub') if (Fub and Fub > 0)
                         else src('engine_default', key='Fub', note=_nt('conn.note.fub_default'))),
                       q('As', As, 'area', src('specification', note=_nt('conn.note.bolt_area_formula'))), sn],
               result=q('Pnvs', Pss, 'force'))
        limit_states.append({
            '_trace': tr.steps,
            'name': 'Screw Shear (J4.3.2)',
            'Rn': Pss, 'phi': PHI_SCREW['shear'], 'omega': OMEGA_SCREW['shear'], 'direction': 'shear',
            'formula': f'Pnvs ≈ 0.5×Fub({Fub_eff})×As({As:.4f})×{n} = {Pss:.3f} (사내 추정, 기준값 아님)',
            'equation': 'J4.3.2 (estimate)', 'basis': 'in_house_estimate', 'assumed': True,
        })
        not_eval.append(_ne('Screw Shear (J4.3.2)', 'shear',
                            _nt('conn.reason.pnvs_fub_as'),
                            'fastener'))

    # (c) 풀아웃 (J4.4.1, Eq. J4.4.1-1): Pnot = 0.85·tc·d·Fu2
    tc_eff = tc if tc is not None else t2
    Pnot = 0.85 * tc_eff * d * Fu2 * n
    tr = Trace()
    tr.add('equation', 'Pnot = 0.85 tc d Fu2 n', equation='J4.4.1-1',
           inputs=[q('tc', tc_eff, 'length', src('user_input', key='tc') if tc is not None
                     else src('engine_default', key='tc', note=_nt('conn.note.tc_t2'))), sd, sfu2, sn],
           result=q('Pnot', Pnot, 'force'))
    limit_states.append({
        '_trace': tr.steps,
        'name': 'Pull-out (J4.4.1)',
        'Rn': Pnot, 'phi': PHI_SCREW['pullout'], 'omega': OMEGA_SCREW['pullout'], 'direction': 'tension',
        'formula': f'Pnot = 0.85×tc({tc_eff})×{d}×Fu2({Fu2})×{n} = {Pnot:.3f}',
        'equation': 'J4.4.1-1',
    })

    # (d) 풀오버 (J4.4.2, Eq. J4.4.2-1): Pnov = 1.5·t1·d'w·Fu1 (머리쪽 부재)
    dw_given = dw is not None
    if dw is None:
        dw = min(d * 2.0, 0.75)
        not_eval.append(_ne('Pull-over (J4.4.2)', 'tension',
                            _nt('conn.reason.dw_not_given_2d_reference'), 'fastener'))
    else:
        if dw < 5.0 / 16.0:
            warnings.append(_nt('conn.warning.j4_4_j4', dw=dw))
        dw_in = dw
        dw = min(dw, 0.75)
    Pnov = 1.5 * t1 * dw * Fu1 * n
    tr = Trace()
    if dw_given:
        i_dwc = tr.add('modifier', "d'w = min(d'w, d'w,max)", equation='J4.4.2',
                       inputs=[q("d'w", dw_in, 'length', src('user_input', key='dw')),
                               _sp("d'w,max", 0.75, 'length', note=_nt('conn.note.j4_4_2_j4'))],
                       result=q("d'w", dw, 'length'))
        dw_q = tr.ref(i_dwc)
    else:
        dw_q = q("d'w", dw, 'length', src('engine_default', key='dw', note=_nt('conn.note.dw_2d_estimate')))
    tr.add('equation', "Pnov = 1.5 t1 d'w Fu1 n", equation='J4.4.2-1', inputs=[st1, dw_q, sfu1, sn],
           result=q('Pnov', Pnov, 'force'))
    item = {
        '_trace': tr.steps,
        'name': 'Pull-over (J4.4.2)',
        'Rn': Pnov, 'phi': PHI_SCREW['pullover'], 'omega': OMEGA_SCREW['pullover'], 'direction': 'tension',
        'formula': f'Pnov = 1.5×t1({t1})×{dw:.3f}×Fu1({Fu1})×{n} = {Pnov:.3f}',
        'equation': 'J4.4.2-1',
    }
    if not dw_given:
        item['assumed'] = True
    limit_states.append(item)

    # (e) 나사 인장 (J4.4.3) — Pnts 는 제조사·독립시험 값
    if Pnts is not None and Pnts > 0:
        tr = Trace()
        tr.add('equation', 'Pnts,total = n Pnts', equation='J4.4.3',
               inputs=[sn, q('Pnts', Pnts, 'force', src('user_input', key='Pnts', note=_nt('conn.note.manufacturer_test_value')))],
               result=q('Pnts', Pnts * n, 'force'))
        limit_states.append({
            '_trace': tr.steps,
            'name': 'Screw Tension (J4.4.3)',
            'Rn': Pnts * n, 'phi': PHI_SCREW['tension'], 'omega': OMEGA_SCREW['tension'],
            'direction': 'tension',
            'formula': f'Pnts = {Pnts}×{n} (제조사/시험값) = {Pnts * n:.3f}',
            'equation': 'J4.4.3', 'basis': 'manufacturer',
        })
    else:
        not_eval.append(_ne('Screw Tension (J4.4.3)', 'tension',
                            _nt('conn.reason.pnts_not_given'), 'fastener'))

    # (f) J6 파단 (나사: J6.1 + J6.2, 블록전단 제외 — J6 머리글). 얇은 부재 기준.
    t_crit = min(t1, t2)
    Fu_crit = Fu1 if t1 <= t2 else Fu2
    j6_ls, j6_warn, j6_ne = _j6_rupture_limit_states(
        conn='screw', Fu=Fu_crit, t=t_crit, dh=d, n=n, e=e,
        Ag=Ag, width=width, d=d, g=g, include_block_shear=False, geometry=geo,
        e_assumed=e_assumed, notes=assumptions)
    limit_states.extend(j6_ls)
    warnings.extend(j6_warn)
    not_eval.extend(j6_ne)
    if j6_part2:
        p_ls, p_w, p_ne = _j6_second_part('screw', j6_part2, n, d, d, assumptions, include_block_shear=False)
        limit_states.extend(p_ls)
        warnings.extend(p_w)
        not_eval.extend(p_ne)
    assumptions.append(_part_basis_note('', t_crit, bool(j6_part2)))
    if tc is None:
        assumptions.append(_nt('conn.assumption.j4_4_1_tc_equals_t2'))

    if member_tension:
        d_ls, d_warn = _chapter_d_tension_caps(
            Fy=Fy, Fu=Fu_crit, t=t_crit, dh=d, n=n,
            Ag=Ag if Ag is not None else geo.get('Ag'),
            width=width if width is not None else geo.get('width'), Ae=Ae)
        limit_states.extend(d_ls)
        warnings.extend(d_warn)

    # (g) J4.5 조합 (나사 1개당 소요강도)
    interaction = []
    if Vu and Tu and Vu > 0 and Tu > 0:
        Vb, Tb = Vu / n, Tu / n
        Pns_each = Pns / n   # J4.3.1 시트 전단강도 (나사 1개)
        # J4.5.1 전단 + 풀오버
        dwc = d_head_washer if d_head_washer else dw
        lim = []
        if not (0.0285 - 1e-6 <= t1 <= 0.0445 + 1e-6):
            lim.append(_nt('conn.fragment.lim_range_length', symbol='t1', value=t1, lo=0.0285, hi=0.0445))
        if not (0.21 <= d <= 0.25):
            lim.append(_nt('conn.fragment.lim_screw_gauge', symbol='d', value=d, gauges='No.12·14'))
        if dwc > 0.75:
            lim.append(_nt('conn.fragment.lim_le_length', symbol='dw', value=dwc, limit=0.75))
        if Fu1 > 70:
            lim.append(_nt('conn.fragment.lim_le_stress', symbol='Fu1', value=Fu1, limit=70))
        if ratio < 2.5 - 1e-3:
            lim.append(_nt('conn.fragment.lim_ge_ratio_3f', symbol='t2/t1', value=ratio, limit=2.5))
        if not dw_given and d_head_washer is None:
            not_eval.append(_ne('전단+풀오버 (J4.5.1)', 'interaction',
                                _nt('conn.reason.dw_not_given_combined'),
                                'interaction'))
        elif lim:
            _j45_fallback(interaction, not_eval, assumptions, j45_rational, dm,
                          '전단+풀오버 (J4.5.1)', 'J4.5.1', lim,
                          Vb, min(Pns_each, 2.7 * t1 * d * Fu1), Tb, 1.5 * t1 * dwc * Fu1, "Pnov")
        else:
            Pnv1 = 2.7 * t1 * d * Fu1
            Pnov1 = 1.5 * t1 * dwc * Fu1
            tr = Trace()
            i1 = tr.add('equation', 'Pnv = 2.7 t1 d Fu1', equation='J4.5.1-2', inputs=[st1, sd, sfu1],
                        result=q('Pnv', Pnv1, 'force'))
            i2 = tr.add('equation', 'Pnov = 1.5 t1 dw Fu1', equation='J4.5.1-3',
                        inputs=[st1, _ui('dw', dwc, 'length', 'd_head_washer / dw'), sfu1], result=q('Pnov', Pnov1, 'force'))
            i_v = tr.add('equation', 'V/Pnv + 0.71 T/Pnov  (per screw)', equation='J4.5.1-1' + ('b' if dm == 'LRFD' else 'a'),
                         inputs=[_ui('V', Vb, 'force', 'Vu / n'), tr.ref(i1), _ui('T', Tb, 'force', 'Tu / n'),
                                 tr.ref(i2)], result=q('value', Vb / Pnv1 + 0.71 * Tb / Pnov1, 'dimensionless'))
            interaction.append(_screw_interaction('전단+풀오버 (J4.5.1)', 'J4.5.1-1',
                                                  tr.steps[i_v]['result']['value'], 1.10, 0.65, 2.35, dm,
                                                  tr=tr, value_idx=i_v))
        # J4.5.2 전단 + 풀아웃
        lim = []
        if not (0.0297 - 1e-6 <= t2 <= 0.0724 + 1e-6):
            lim.append(_nt('conn.fragment.lim_range_length', symbol='t2', value=t2, lo=0.0297, hi=0.0724))
        if not (0.16 <= d <= 0.25):
            lim.append(_nt('conn.fragment.lim_screw_gauge', symbol='d', value=d, gauges='No.8–14'))
        if Fu2 > 121:
            lim.append(_nt('conn.fragment.lim_le_stress', symbol='Fu2', value=Fu2, limit=121))
        for lab, fu_i, fy_i in (('1', Fu1, Fy1), ('2', Fu2, Fy2)):
            if fy_i and not (1.0 <= fu_i / fy_i <= 1.62):
                lim.append(_nt('conn.fragment.lim_range_ratio_2f', symbol=f'Fu{lab}/Fy{lab}', value=fu_i / fy_i, lo=1.0, hi=1.62))
        if lim:
            _j45_fallback(interaction, not_eval, assumptions, j45_rational, dm,
                          '전단+풀아웃 (J4.5.2)', 'J4.5.2', lim,
                          Vb, min(Pns_each, 4.2 * math.sqrt(t2 ** 3 * d) * Fu2), Tb,
                          0.85 * tc_eff * d * Fu2, "Pnot")
        else:
            Pnv2 = 4.2 * math.sqrt(t2 ** 3 * d) * Fu2
            Pnot2 = 0.85 * tc_eff * d * Fu2
            tr = Trace()
            i1 = tr.add('equation', 'Pnv = 4.2 (t2³ d)^0.5 Fu2', equation='J4.5.2-2', inputs=[st2, sd, sfu2],
                        result=q('Pnv', Pnv2, 'force'))
            i2 = tr.add('equation', 'Pnot = 0.85 tc d Fu2', equation='J4.5.2-3',
                        inputs=[q('tc', tc_eff, 'length', src('user_input', key='tc') if tc is not None
                                  else src('engine_default', key='tc', note=_nt('conn.note.tc_t2'))), sd, sfu2],
                        result=q('Pnot', Pnot2, 'force'))
            i_v = tr.add('equation', 'V/Pnv + T/Pnot  (per screw)', equation='J4.5.2-1' + ('b' if dm == 'LRFD' else 'a'),
                         inputs=[_ui('V', Vb, 'force', 'Vu / n'), tr.ref(i1), _ui('T', Tb, 'force', 'Tu / n'),
                                 tr.ref(i2)], result=q('value', Vb / Pnv2 + Tb / Pnot2, 'dimensionless'))
            interaction.append(_screw_interaction('전단+풀아웃 (J4.5.2)', 'J4.5.2-1',
                                                  tr.steps[i_v]['result']['value'], 1.15, 0.60, 2.55, dm,
                                                  tr=tr, value_idx=i_v))
        # J4.5.3 나사 자체 전단 + 인장
        if Pnvs and Pnts and Pnvs > 0 and Pnts > 0:
            tr = Trace()
            i_v = tr.add('equation', 'V/Pnvs + T/Pnts  (per screw)', equation='J4.5.3-1' + ('b' if dm == 'LRFD' else 'a'),
                         inputs=[_ui('V', Vb, 'force', 'Vu / n'), _ui('Pnvs', Pnvs, 'force', 'Pnvs'),
                                 _ui('T', Tb, 'force', 'Tu / n'), _ui('Pnts', Pnts, 'force', 'Pnts')],
                         result=q('value', Vb / Pnvs + Tb / Pnts, 'dimensionless'))
            interaction.append(_screw_interaction('나사 전단+인장 (J4.5.3)', 'J4.5.3-1',
                                                  tr.steps[i_v]['result']['value'], 1.3, PHI_SCREW['shear'],
                                                  OMEGA_SCREW['shear'], dm, tr=tr, value_idx=i_v))
        else:
            not_eval.append(_ne('나사 전단+인장 (J4.5.3)', 'interaction',
                                _nt('conn.reason.pnvs_pnts'), 'interaction'))
        if d_head_washer is None:
            assumptions.append(_nt('conn.assumption.j4_5_1_j4_dw'))

    spec_sections = ['J4.1', 'J4.2', 'J4.3.1', 'J4.3.2', 'J4.4.1', 'J4.4.2', 'J4.4.3', 'J6.1', 'J6.2']
    if Vu and Tu:
        spec_sections += ['J4.5.1', 'J4.5.2', 'J4.5.3']
    if member_tension:
        spec_sections += ['D2', 'D3']
    return _finish('screw', limit_states, not_eval, warnings, dm, spec_sections, None,
                   interaction, detailing, assumptions)


def _j45_fallback(interaction, not_eval, assumptions, enabled, dm, name, clause, lim,
                  Vb, Pnv, Tb, Pnt, tname):
    """J4.5.1/J4.5.2 적용한계 밖의 조합 검토.

    기준 식(Eq. J4.5.1-1 / J4.5.2-1)은 시험 범위 안에서만 유효하고, 범위 밖에 대한 식은 기준에 없다
    (J4: 시험·K2 또는 A1.2 합리적 해석). Commentary J4.5.1 은 기준 식보다 보수적인 직선식
    V/Pnv + T/Pnov ≤ 1.0 (Eq. C-J4.5.1-1) 이 실무에서 쓰여 왔다고 적는다. 이를 J4 의 계수로 쓴
    가용강도 기준 직선 상호작용 V/(Pnv/Ω) + T/(Pnt/Ω) ≤ 1 로, A1.2(c) 합리적 해석으로 적용한다.
    enabled=False 면 미평가로 둔다.
    """
    why = _nt('conn.reason.outside_equation_limits', clause=clause, lim=_joined(', ', lim))
    if not enabled:
        not_eval.append(_ne(name, 'interaction',
                            _nt('conn.reason.a1_2_k2_a1_j45_rational', why=why), 'interaction'))
        return
    phi, omega = PHI_SCREW['shear'], OMEGA_SCREW['shear']
    value = Vb / Pnv + Tb / Pnt
    limit = phi if dm == 'LRFD' else 1.0 / omega
    ratio = value / limit
    tr = Trace()
    i_v = tr.add('equation', f'V/Pnv + T/{tname}  (per screw, Commentary C-J4.5.1-1 as A1.2(c))',
                 equation='C-J4.5.1-1',
                 inputs=[_ui('V', Vb, 'force', 'Vu / n'),
                         _sp('Pnv', Pnv, 'force', note=_nt('conn.note.j4_3_1_min_j4_sheet_strength')),
                         _ui('T', Tb, 'force', 'Tu / n'), _sp(tname, Pnt, 'force', note=_nt('conn.note.j4_4_j4_sheet_term'))],
                 result=q('value', value, 'dimensionless'))
    if dm == 'LRFD':
        i_l = tr.add('equation', 'limit = φ', inputs=[_sp('φ', phi)], result=q('limit', limit, 'dimensionless'))
    else:
        i_l = tr.add('equation', 'limit = 1 / Ω', inputs=[_sp('Ω', omega)], result=q('limit', limit, 'dimensionless'))
    interaction.append({'name': name + ' — A1.2(c) 직선식', 'equation': 'C-J4.5.1-1 (A1.2(c))',
                        'value': round(value, 4), 'limit': round(limit, 4), 'ratio': round(ratio, 4),
                        'pass': ratio <= 1.0 + 1e-9, 'basis': 'rational_A1.2c',
                        'note': why, '_raw': {'value': value, 'limit': limit, 'ratio': ratio},
                        '_trace': _interaction_trace(tr, i_v, i_l)})
    assumptions.append(_nt('conn.assumption.j4_5_1_commentary_j4_pnv_a1', name=name, why=why, tname=tname, omega=omega, phi=phi))


def _screw_interaction(name, eq, value, coef, phi, omega, dm, tr=None, value_idx=None) -> dict:
    limit = coef * phi if dm == 'LRFD' else coef / omega
    ratio = value / limit
    out = {'name': name, 'equation': eq + ('b' if dm == 'LRFD' else 'a'),
           'value': round(value, 4), 'limit': round(limit, 4),
           'ratio': round(ratio, 4), 'pass': ratio <= 1.0 + 1e-9,
           '_raw': {'value': value, 'limit': limit, 'ratio': ratio}}
    if tr is not None:
        if dm == 'LRFD':
            i_l = tr.add('equation', f'limit = {coef:g} φ', equation=out['equation'], inputs=[_sp('φ', phi)],
                         result=q('limit', limit, 'dimensionless'))
        else:
            i_l = tr.add('equation', f'limit = {coef:g} / Ω', equation=out['equation'], inputs=[_sp('Ω', omega)],
                         result=q('limit', limit, 'dimensionless'))
        out['_trace'] = _interaction_trace(tr, value_idx, i_l)
    return out


# ============================================================
# 필릿 용접 (J2.5)
# ============================================================

def _weld_j6(member_case_geo: dict, Fy: float, Fu: float, t: float, warnings: list,
             not_eval: list, limit_states: list, notes: list = None):
    """필릿·플레어 용접 접합의 J6 (J6.1 은 해당 없음 — 패스너 인열이 아니다).

    J6.2: Table J6.2-1 의 용접 분류(앵글·채널 J6.2-5/-7, (3)(a) 횡방향 용접, (3)(b) 전 요소).
    평판(flat_sheet) 의 용접 접합은 구멍이 없어 Table J6.2-1 (1)(볼트식)이 해당하지 않으므로,
    Manual Example IV-1·IV-4–IV-7 처럼 Chapter D(접합부 밖 순단면)로 검토한다(member_tension=True).
    J6.3: 블록전단 면적(Agv_bs/Anv_bs/Ant_bs) 입력 시 평가. 평판은 위와 같은 까닭으로 해당 없음.
    호출자 진술: member_case='not_tension_member' → J6.2 해당 없음, j6_3_not_applicable=True → J6.3 해당 없음.
    """
    geo = member_case_geo
    if notes is None:
        notes = []
    raw_case = str(geo.get('member_case') or '').strip().lower().replace('-', '_')
    j63_na = bool(geo.get('j6_3_not_applicable'))
    if raw_case == 'not_tension_member':
        notes.append(_nt('conn.assumption.j6_2_j6_member_case_tension_2'))
        if j63_na:
            notes.append(_nt('conn.assumption.j6_3_not_applicable_stated'))
        elif all(geo.get(k) is not None for k in ('Agv_bs', 'Anv_bs', 'Ant_bs')):
            Pnr, P1, P2 = block_shear_nominal(Fy, Fu, geo['Agv_bs'], geo['Anv_bs'], geo['Ant_bs'])
            limit_states.append({
                '_trace': _block_shear_trace(Fy, Fu, geo['Agv_bs'], geo['Anv_bs'], geo['Ant_bs'], P1, P2, Pnr),
                'name': 'Block Shear (J6.3)', 'Rn': Pnr, 'phi': PHI_RUPTURE['weld'],
                'omega': OMEGA_RUPTURE['weld'], 'direction': 'shear',
                'formula': f'Pnr = min({P1:.3f}, {P2:.3f}) = {Pnr:.3f} (입력 면적)', 'equation': 'J6.3-1/-2',
            })
        else:
            not_eval.append(_ne('Block Shear (J6.3)', 'shear',
                                _nt('conn.reason.agv_bs_anv_bs'), 'rupture'))
        return
    case = normalize_member_case(geo.get('member_case'))
    if case is None:
        not_eval.append(_ne('Tension Rupture (J6.2)', 'shear',
                            _nt('conn.reason.j6_2_member_case_flat_sheet'), 'rupture'))
        not_eval.append(_ne('Block Shear (J6.3)', 'shear', _nt('conn.reason.member_case'), 'rupture'))
        return
    if case in ('angle_bolted', 'channel_bolted', 'flat_sheet_staggered'):
        not_eval.append(_ne('Tension Rupture (J6.2)', 'shear',
                            _nt('conn.reason.member_case_2', case=case), 'rupture'))
        return
    explicit = [geo.get('Agv_bs'), geo.get('Anv_bs'), geo.get('Ant_bs')]
    phi_r, om_r = PHI_RUPTURE['weld'], OMEGA_RUPTURE['weld']
    if case == 'flat_sheet':
        notes.append(_nt('conn.assumption.j6_2_flat_weld_no_holes'))
    else:
        Ag = geo.get('Ag')
        if Ag is None and geo.get('width') is not None:
            Ag = geo['width'] * t
        Ant = geo.get('Ant') if case == 'transverse_weld' else Ag
        sl = None
        if Usl_given := geo.get('Usl'):
            Usl, usl_formula, reason = float(Usl_given), f'Usl={float(Usl_given):.4f} (입력)', None
        else:
            sl = shear_lag_factor(case, x_bar=geo.get('x_bar'), L=geo.get('L_conn'))
            Usl, usl_formula, reason = sl['Usl'], sl['formula'], sl['reason']
            warnings.extend(sl['warnings'])
        if Ant is None or Ant <= 0:
            not_eval.append(_ne('Tension Rupture (J6.2)', 'shear',
                                _nt('conn.reason.ag_ant'), 'rupture'))
        elif Usl is None:
            not_eval.append(_ne('Tension Rupture (J6.2)', 'shear', reason, 'rupture'))
        else:
            Pnt = Fu * Usl * Ant
            tr = Trace()
            ant_q = (_ui('Ant', Ant, 'area', 'Ant', note=_nt('conn.note.table_j6_2_1_j6_directly_connected_elements'))
                     if case == 'transverse_weld' else
                     _ui('Ant', Ant, 'area', 'Ag / width·t', note=_nt('conn.note.welded_connection_no_holes')))
            i_u = _usl_step(tr, dict(sl or {}, Usl=Usl), Usl_given if geo.get('Usl') else None)
            tr.add('equation', 'Pnt = Fu Usl Ant', equation='J6.2-1', inputs=[_mt('Fu', Fu), tr.ref(i_u), ant_q],
                   result=q('Pnt', Pnt, 'force'))
            limit_states.append({
                '_trace': tr.steps,
                'name': 'Tension Rupture (J6.2)', 'Rn': Pnt, 'phi': phi_r, 'omega': om_r,
                'direction': 'shear',
                'formula': f'Pnt = Fu×Usl×Ant = {Fu}×{Usl:.4f}×{Ant:.4f} = {Pnt:.3f} ({usl_formula})',
                'equation': 'J6.2-1',
            })
    if j63_na:
        notes.append(_nt('conn.assumption.j6_3_not_applicable_stated'))
    elif all(v is not None for v in explicit):
        Pnr, P1, P2 = block_shear_nominal(Fy, Fu, *explicit)
        limit_states.append({
            '_trace': _block_shear_trace(Fy, Fu, *explicit, P1, P2, Pnr),
            'name': 'Block Shear (J6.3)', 'Rn': Pnr, 'phi': phi_r, 'omega': om_r, 'direction': 'shear',
            'formula': f'Pnr = min({P1:.3f}, {P2:.3f}) = {Pnr:.3f} (입력 면적)',
            'equation': 'J6.3-1/-2',
        })
    elif case != 'flat_sheet':
        not_eval.append(_ne('Block Shear (J6.3)', 'shear',
                            _nt('conn.reason.agv_bs_anv_bs_2'), 'rupture'))


def _block_shear_trace(Fy, Fu, Agv, Anv, Ant, P1, P2, Pnr) -> list:
    """입력 면적의 블록 전단(Eq. J6.3-1/-2) 계산 과정."""
    tr = Trace()
    a = [_ui('Agv', Agv, 'area', 'Agv_bs'), _ui('Anv', Anv, 'area', 'Anv_bs'), _ui('Ant', Ant, 'area', 'Ant_bs')]
    ubs = _sp('Ubs', 1.0)
    i1 = tr.add('equation', 'Pnr1 = 0.6 Fy Agv + Ubs Fu Ant', equation='J6.3-1',
                inputs=[_mt('Fy', Fy), a[0], ubs, _mt('Fu', Fu), a[2]], result=q('Pnr1', P1, 'force'))
    i2 = tr.add('equation', 'Pnr2 = 0.6 Fu Anv + Ubs Fu Ant', equation='J6.3-2',
                inputs=[_mt('Fu', Fu), a[1], ubs, a[2]], result=q('Pnr2', P2, 'force'))
    tr.add('equation', 'Pnr = min(Pnr1, Pnr2)', inputs=[tr.ref(i1), tr.ref(i2)], result=q('Pnr', Pnr, 'force'))
    return tr.steps


def fillet_weld_connection(t1: float, t2: float,
                          weld_size: float, weld_length: float,
                          Fy: float, Fu: float,
                          Fxx: float = 60,
                          n_welds: int = 1,
                          design_method: str = 'LRFD',
                          load_direction: str = 'longitudinal',
                          Fu1: float = None, Fu2: float = None,
                          w1: float = None, w2: float = None,
                          j6_geometry: dict = None,
                          member_tension: bool = False, joint_type: str = 'lap') -> dict:
    """필릿 용접 접합 설계 (§J2.5 + §J6)

    Args:
        t1, t2: 연결판 두께 (in) — Fig. J2.5-1/-2 표기. 어느 쪽을 t1 으로 넣어도 결과는 같다
            (식 분기와 φ/Ω 는 t = min(t1, t2) 로 정한다).
        weld_size: 용접 레그 크기 (in) — w1,w2 미지정 시 양쪽에 사용
        weld_length: 용접 길이 L (in, 용접선 1개)
        Fy, Fu: 모재 항복/인장강도 (ksi)
        Fxx: 용접봉 강도 (ksi, 기본 E60)
        n_welds: 용접선 수
        load_direction: 'longitudinal' | 'transverse' (J2.5(a)/(b))
        Fu1, Fu2: 각 연결판 인장강도 (None이면 Fu)
        w1, w2: 각 용접 레그 (in). lap joint 에서 w1 ≤ t1 (Fig. J2.5-1) — 목두께 계산에 그 상한을 쓴다.
        j6_geometry: J6 기하 — member_case, Ag/width, x_bar, L_conn, Ant, Usl, Agv_bs/Anv_bs/Ant_bs
        member_tension: True 이면 Chapter D(D2 항복, D3 접합부 밖 순단면 = Ag) — Manual IV-1
        joint_type: 'lap'(Fig. J2.5-1, 기본) | 't_joint'(Fig. J2.5-2, w1 ≤ t1 상한 없음)
    """
    try:
        dm = normalize_design_method(design_method)
    except ValueError as exc:
        return {'error': str(exc)}
    if Fu1 is None:
        Fu1 = Fu
    if Fu2 is None:
        Fu2 = Fu
    if w1 is None:
        w1 = weld_size
    if w2 is None:
        w2 = weld_size
    L = weld_length
    t_min = min(t1, t2)
    limit_states, warnings, not_eval = [], [], []
    assumptions = [_CONCENTRIC]
    _scope_thickness(t_min, 'J2', not_eval)
    lap_joint = not str(joint_type or 'lap').lower().startswith('t')
    if lap_joint and w1 is not None and w1 > t1 + 1e-9:
        warnings.append(_nt('conn.warning.j2_5_j2_w1_t1_fig', t1=t1, w1=w1))
        w1 = t1

    longitudinal = str(load_direction).lower().startswith('long')
    # J2.5: L/t 분기와 φ/Ω 는 t = min(t1, t2) 하나로 정하고 두 판에 같은 식을 쓴다.
    if longitudinal:
        if L / t_min < 25:
            def _pnv(ti, Fui):
                return (1.0 - 0.01 * L / ti) * L * ti * Fui
            phi_s, omega_s, eq_s = 0.60, 2.55, 'J2.5-1/2'
        else:
            def _pnv(ti, Fui):
                return 0.75 * ti * L * Fui
            phi_s, omega_s, eq_s = 0.50, 3.05, 'J2.5-3/4'
    else:
        def _pnv(ti, Fui):
            return ti * L * Fui
        phi_s, omega_s, eq_s = 0.65, 2.35, 'J2.5-5/6'
    Pnv1 = _pnv(t1, Fu1)
    Pnv2 = _pnv(t2, Fu2)
    Pnv_sheet = min(Pnv1, Pnv2) * n_welds
    fl = q('L', L, 'length', src('user_input', key='weld_length'))
    ft = q('t', t_min, 'length', src('user_input', key='min(t1, t2)'))
    tr = Trace()
    i_lt = tr.add('equation', 'L / t', inputs=[fl, ft], result=q('L/t', L / t_min, 'dimensionless'))
    if longitudinal:
        short = L / t_min < 25
        tr.branch('L/t < 25 (longitudinal load)', short, 'J2.5-1' if short else 'J2.5-3', inputs=[tr.ref(i_lt)])
        e1, e2 = (('Pnv1 = (1 − 0.01 L/t1) L t1 Fu1', 'Pnv2 = (1 − 0.01 L/t2) L t2 Fu2') if short
                  else ('Pnv1 = 0.75 t1 L Fu1', 'Pnv2 = 0.75 t2 L Fu2'))
    else:
        tr.branch('transverse load', True, 'J2.5-5', inputs=[tr.ref(i_lt)])
        e1, e2 = 'Pnv1 = t1 L Fu1', 'Pnv2 = t2 L Fu2'
    j1 = tr.add('equation', e1, equation=eq_s,
                inputs=[q('t1', t1, 'length', src('user_input', key='t1')), fl,
                        q('Fu1', Fu1, 'stress', src('material', key='Fu1'))], result=q('Pnv1', Pnv1, 'force'))
    j2 = tr.add('equation', e2, equation=eq_s,
                inputs=[q('t2', t2, 'length', src('user_input', key='t2')), fl,
                        q('Fu2', Fu2, 'stress', src('material', key='Fu2'))], result=q('Pnv2', Pnv2, 'force'))
    tr.add('equation', 'Pnv = min(Pnv1, Pnv2) n_welds',
           inputs=[tr.ref(j1), tr.ref(j2), q('n', n_welds, 'count', src('user_input', key='n'))],
           result=q('Pnv', Pnv_sheet, 'force'))
    limit_states.append({
        '_trace': tr.steps,
        'name': 'Sheet Strength (J2.5)',
        'Rn': Pnv_sheet, 'phi': phi_s, 'omega': omega_s, 'direction': 'shear',
        'formula': (f'L/t = {L}/{t_min} = {L / t_min:.2f}; Pnv = min(Pnv1={Pnv1:.3f}, '
                    f'Pnv2={Pnv2:.3f})×{n_welds} = {Pnv_sheet:.3f}'),
        'equation': eq_s,
    })

    # 용접금속 한계 (Eq. J2.5-7): t = min(t1,t2) > 0.10 in 인 경우에만
    if t_min > 0.10:
        tw = 0.707 * min(w1, w2)
        Pn_weld = 0.75 * tw * L * Fxx * n_welds
        tr = Trace()
        i_tw = tr.add('equation', 'tw = 0.707 min(w1, w2)', inputs=[
            q('w1', w1, 'length', src('user_input', key='w1 / weld_size', note=_nt('conn.note.w1_t1_lap_joint'))),
            q('w2', w2, 'length', src('user_input', key='w2 / weld_size'))], result=q('tw', tw, 'length'))
        tr.add('equation', 'Pn = 0.75 tw L Fxx n_welds', equation='J2.5-7',
               inputs=[tr.ref(i_tw), fl, q('Fxx', Fxx, 'stress', src('user_input', key='Fxx', note=_nt('conn.note.fxx_e60_default_see_assumptions'))),
                       q('n', n_welds, 'count', src('user_input', key='n'))], result=q('Pn', Pn_weld, 'force'))
        limit_states.append({
            '_trace': tr.steps,
            'name': 'Weld Metal (J2.5)',
            'Rn': Pn_weld, 'phi': 0.60, 'omega': 2.55, 'direction': 'shear',
            'formula': f'Pn = 0.75×tw({tw:.4f})×{L}×{Fxx}×{n_welds} = {Pn_weld:.3f}',
            'equation': 'J2.5-7',
        })

    geo = dict(j6_geometry or {})
    _weld_j6(geo, Fy, min(Fu1, Fu2), t_min, warnings, not_eval, limit_states, assumptions)
    spec = ['J2.5', 'J6.2', 'J6.3']
    if member_tension:
        _weld_chapter_d(geo, Fy, min(Fu1, Fu2), t_min, warnings, not_eval, limit_states)
        spec += ['D2', 'D3']
    not_eval.append(_ne('면외 인장', 'tension', _nt('conn.reason.fillet_no_out_of_plane_tension'), 'fastener'))
    return _finish('fillet_weld', limit_states, not_eval, warnings, dm, spec, assumptions=assumptions)


def _weld_chapter_d(geo, Fy, Fu, t, warnings, not_eval, limit_states):
    """용접 인장부재의 Chapter D (구멍 없음: D3 의 An = Ag) — Manual IV-1."""
    d_ls, d_warn = _chapter_d_tension_caps(Fy=Fy, Fu=Fu, t=t, dh=0.0, n=0,
                                           Ag=geo.get('Ag'), width=geo.get('width'), Ae=None)
    if not d_ls:
        not_eval.append(_ne('Member Tension (D2/D3)', 'shear',
                            _nt('conn.reason.member_tension_true_ag'), 'member'))
    limit_states.extend(d_ls)
    warnings.extend(w for w in d_warn if '전단지연' not in w)


# ============================================================
# 아크 스팟 용접 (J2.2)
# ============================================================

def _normalize_joint(joint):
    if joint is None:
        return None
    s = str(joint).strip().lower().replace('-', '_').replace(' ', '_')
    if s in ('sheet_to_support', 'sheet_to_supporting_member', 'support', 'sheet_to_thicker'):
        return 'sheet_to_support'
    if s in ('sheet_to_sheet', 'sheet'):
        return 'sheet_to_sheet'
    raise ValueError(f"Unknown joint '{joint}' (use 'sheet_to_support' or 'sheet_to_sheet')")


def arc_spot_weld_connection(t1: float, t2: float,
                             da: float, Fy: float, Fu: float,
                             Fxx: float = 60,
                             n: int = 1,
                             design_method: str = 'LRFD',
                             E: float = E_STEEL,
                             Vu: float = None, Tu: float = None,
                             joint: str = None, t_sheets: list = None,
                             de: float = None,
                             application: str = 'other',
                             eccentric_tension: bool = False,
                             sidelap: bool = False,
                             e: float = None,
                             j6_geometry: dict = None,
                             j6_part2: dict = None) -> dict:
    """아크 스팟 용접 (퍼들 용접) 접합 설계 (§J2.2 + §J6)

    J6 파단은 접합된 판 한 장의 두께로 검토한다(여러 시트면 가장 얇은 한 장). 두께 합은
    J2.2.2.1(전단면 위 시트 합)과 J2.2.3(Eq. J2.2.3-2 의 합)에만 쓴다. j6_part2 로 다른 판도 검토할 수 있다.

    Args:
        t1, t2: 연결판 두께 (in). sheet_to_support 이면 얇은 쪽이 시트, 두꺼운 쪽이 지지재.
        da: 용접 가시(visible) 직경 d (in) — 이름은 과거 호환. 평균직경 d_a = d − t 는 내부 계산.
        Fy, Fu: 시트 강도 (ksi)
        Fxx: 용접봉 강도 (ksi)
        n: 용접점 개수
        E: 강재 탄성계수 (ksi)
        Vu, Tu: 접합부 전체 소요 전단·인장(상향)력 (kips)
        joint: 'sheet_to_support' (J2.2.2.1) | 'sheet_to_sheet' (J2.2.2.2). None 이면 t1≠t2 는
            sheet_to_support 로 보고, t1=t2 는 두 식을 모두 평가해 작은 값을 쓴다.
        t_sheets: 지지재 위 여러 시트 두께 목록 — t = Σt (J2.2.2.1, J2.2.3)
        de: 시공 절차로 확인한 유효 직경 (in). None 이면 Eq. J2.2.2.1-5.
        application: 'deck'|'panel' (J2.2.3 Ω2.50/φ0.60) | 'other' (Ω3.00/φ0.50)
        eccentric_tension: 편심 상향 인장이면 True (J2.2.3: 50 %)
        sidelap: 데크 사이드랩이면 True (J2.2.3: 70 %)
        e: 끝단 거리(용접 중심 → 재단 끝, in) — J2.2.1, J6.1, J6.3
        j6_geometry: member_case, Ag/width, g, edge_transverse, … (_j6_rupture_limit_states 참고)
    """
    try:
        dm = normalize_design_method(design_method)
        jt = _normalize_joint(joint)
    except ValueError as exc:
        return {'error': str(exc)}
    n = int(n)
    d_vis = da
    limit_states, warnings, not_eval, detailing = [], [], [], []
    assumptions = [_CONCENTRIC]
    equal = abs(t1 - t2) <= 0.01 * max(t1, t2)
    if t_sheets:
        t_sheet = float(sum(t_sheets))
        if jt is None:
            jt = 'sheet_to_support'
    else:
        t_sheet = min(t1, t2)
    if jt is None:
        if equal:
            warnings.append(_nt('conn.warning.j2_2_j2_joint_t1_t2'))
        else:
            warnings.append(_nt('conn.warning.j2_2_j2_joint_j2'))
    if jt == 'sheet_to_sheet' and not equal:
        not_eval.append(_ne('Sheet Tear Sheet-to-Sheet (J2.2.2.2)', 'shear',
                            _nt('conn.reason.j2_2_2_2_j2_t1_t2', t1=t1, t2=t2), 'fastener'))

    # 적용범위 (J2.2)
    thinnest = min(t_sheets) if t_sheets else min(t1, t2)
    if thinnest > 0.15 or t_sheet > 0.15:
        not_eval.append(_ne('적용범위 (J2.2)', 'any',
                            _nt('conn.reason.arc_spot_sheet_thickness_limit', t_sheet=t_sheet), 'scope'))
    if t_sheet < 0.028 and jt != 'sheet_to_sheet':
        warnings.append(_nt('conn.warning.j2_2_j2'))

    da_avg = max(d_vis - t_sheet, 0.0)
    de_calc = min(max(0.7 * d_vis - 1.5 * t_sheet, 0.0), 0.55 * d_vis)
    if de is not None and de > 0:
        de_used = de
        warnings.append(_nt('conn.warning.j2_2_3_j2_de', de=de))
    else:
        de_used = de_calc
    if de_used < 0.375 - 1e-9:
        not_eval.append(_ne('최소 유효직경 (J2.2)', 'shear',
                            _nt('conn.reason.j2_2_2_1_de_j2_de', de_used=de_used),
                            'detailing'))

    # J2.2.1 연단·끝단 거리
    if e is not None:
        detailing.append(_detail('용접 중심 → 끝단 ≥ 1.5d (J2.2.1)', e, 1.5 * d_vis, 'J2.2.1'))
        detailing.append(_detail('용접 → 끝단 순거리 ≥ 1.0d (J2.2.1)', e - d_vis / 2.0, d_vis, 'J2.2.1'))
    else:
        not_eval.append(_ne('끝단 거리 (J2.2.1)', 'shear', _nt('conn.reason.e_not_given'), 'detailing'))
    geo = dict(j6_geometry or {})
    if n > 1 and geo.get('g') is not None:
        detailing.append(_detail('용접 사이 순거리 ≥ 1.0d (J2.2.1)', geo['g'] - d_vis, d_vis, 'J2.2.1'))

    lam = math.sqrt(E / Fu) if Fu > 0 else float('inf')
    shear_states = []
    q_d = _ui('d', d_vis, 'length', 'da (visible diameter)')
    q_t = _ui('t', t_sheet, 'length', 't (sheet; Σ t_sheets)')
    q_n = _ui('n', n, 'count', 'n')

    def _de_step(tr):
        if de is not None and de > 0:
            return tr.add('equation', 'de (input — verified by the welding procedure)',
                          inputs=[_ui('de', de_used, 'length', 'de')], result=q('de', de_used, 'length'))
        return tr.add('equation', 'de = 0.7 d − 1.5 t ≤ 0.55 d', equation='J2.2.2.1-5', inputs=[q_d, q_t],
                      result=q('de', de_used, 'length'))

    def _da_step(tr):
        return tr.add('equation', 'da = d − t', inputs=[q_d, q_t], result=q('da', da_avg, 'length'))
    if jt in (None, 'sheet_to_support'):
        # (a) 용접 너겟 전단 (Eq. J2.2.2.1-1)
        Rn_weld = 0.75 * Fxx * math.pi / 4 * de_used ** 2 * n
        tr = Trace()
        i_de = _de_step(tr)
        tr.add('equation', 'Pnv = (π de² / 4) 0.75 Fxx n', equation='J2.2.2.1-1',
               inputs=[tr.ref(i_de), _ui('Fxx', Fxx, 'stress', 'Fxx', note=_nt('conn.note.fxx_e60_default')), q_n],
               result=q('Pnv', Rn_weld, 'force'))
        shear_states.append({
            '_trace': tr.steps,
            'name': 'Weld Nugget Shear (J2.2.2.1)',
            'Rn': Rn_weld, 'phi': 0.60, 'omega': 2.55, 'direction': 'shear',
            'formula': f'Pnv = 0.75×{Fxx}×π/4×de({de_used:.3f})²×{n} = {Rn_weld:.3f}',
            'equation': 'J2.2.2.1-1',
        })
        # (b) 시트 (Eq. J2.2.2.1-2/-3/-4)
        dt = da_avg / t_sheet if t_sheet > 0 else float('inf')
        if dt <= 0.815 * lam:
            Rn_tear = 2.20 * t_sheet * da_avg * Fu * n
            phi_t, omega_t, eq_t = 0.70, 2.20, 'J2.2.2.1-2'
        elif dt < 1.397 * lam:
            Rn_tear = 0.280 * (1.0 + 5.59 * lam / dt) * t_sheet * da_avg * Fu * n
            phi_t, omega_t, eq_t = 0.55, 2.80, 'J2.2.2.1-3'
        else:
            Rn_tear = 1.40 * t_sheet * da_avg * Fu * n
            phi_t, omega_t, eq_t = 0.50, 3.05, 'J2.2.2.1-4'
        tr = Trace()
        i_da = _da_step(tr)
        i_lam = tr.add('equation', 'λ = (E / Fu)^0.5', inputs=[_sp('E', E, 'stress'), _mt('Fu', Fu)],
                       result=q('λ', lam, 'dimensionless'))
        i_r = tr.add('slenderness', 'da / t', inputs=[tr.ref(i_da), q_t], result=q('da/t', dt, 'dimensionless'))
        cond = {'J2.2.2.1-2': 'da/t ≤ 0.815 λ', 'J2.2.2.1-3': '0.815 λ < da/t < 1.397 λ',
                'J2.2.2.1-4': 'da/t ≥ 1.397 λ'}[eq_t]
        tr.branch(cond, True, eq_t, inputs=[tr.ref(i_r), tr.ref(i_lam)])
        expr = {'J2.2.2.1-2': 'Pnv = 2.20 t da Fu n',
                'J2.2.2.1-3': 'Pnv = 0.280 [1 + 5.59 λ / (da/t)] t da Fu n',
                'J2.2.2.1-4': 'Pnv = 1.40 t da Fu n'}[eq_t]
        ins_t = [q_t, tr.ref(i_da), _mt('Fu', Fu), q_n]
        if eq_t == 'J2.2.2.1-3':
            ins_t = [tr.ref(i_lam), tr.ref(i_r)] + ins_t   # 식에 λ 와 da/t 가 있다(V6-05)
        tr.add('equation', expr, equation=eq_t, inputs=ins_t, result=q('Pnv', Rn_tear, 'force'))
        shear_states.append({
            '_trace': tr.steps,
            'name': 'Sheet Tear (J2.2.2.1)',
            'Rn': Rn_tear, 'phi': phi_t, 'omega': omega_t, 'direction': 'shear',
            'formula': (f'Pnv (t={t_sheet}, da={da_avg:.4f}, da/t={dt:.2f}, 0.815λ={0.815 * lam:.2f}, '
                        f'1.397λ={1.397 * lam:.2f}) = {Rn_tear:.3f}'),
            'equation': eq_t,
        })
    if jt == 'sheet_to_sheet' or (jt is None and equal):
        ts = t1
        lim = []
        if Fu > 59:
            lim.append(_nt('conn.fragment.lim_le_stress', symbol='Fu', value=Fu, limit=59))
        if not Fxx > Fu:
            lim.append(_nt('conn.fragment.lim_fxx_gt_fu'))
        if not (0.028 <= ts <= 0.0635):
            lim.append(_nt('conn.fragment.lim_range_length', symbol='t', value=ts, lo=0.028, hi=0.0635))
        if lim or not equal:
            if equal:
                not_eval.append(_ne('Sheet Tear Sheet-to-Sheet (J2.2.2.2)', 'shear',
                                    _nt('conn.reason.j2_2_2_2_j2', lim=_joined(', ', lim)), 'fastener'))
        else:
            da_s = max(d_vis - ts, 0.0)
            Rn_ss = 1.65 * ts * da_s * Fu * n
            tr = Trace()
            q_ts = _ui('t', ts, 'length', 't1 (= t2)')
            i_da = tr.add('equation', 'da = d − t', inputs=[q_d, q_ts], result=q('da', da_s, 'length'))
            tr.add('equation', 'Pnv = 1.65 t da Fu n', equation='J2.2.2.2-1',
                   inputs=[q_ts, tr.ref(i_da), _mt('Fu', Fu), q_n], result=q('Pnv', Rn_ss, 'force'))
            shear_states.append({
                '_trace': tr.steps,
                'name': 'Sheet Tear Sheet-to-Sheet (J2.2.2.2)',
                'Rn': Rn_ss, 'phi': 0.70, 'omega': 2.20, 'direction': 'shear',
                'formula': f'Pnv = 1.65×t({ts})×da({da_s:.4f})×Fu({Fu})×{n} = {Rn_ss:.3f}',
                'equation': 'J2.2.2.2-1',
            })
    limit_states.extend(shear_states)

    # J2.2.3 상향 인장 (시트-지지재)
    tension_ok = jt in (None, 'sheet_to_support') and not (jt is None and equal)
    Pnt_weld = None
    if tension_ok:
        lim = []
        tdaFu = t_sheet * da_avg * Fu
        if tdaFu > 3.0:
            lim.append(_nt('conn.fragment.lim_le_force_2f', symbol='t·da·Fu', value=tdaFu, limit=3))
        if Fxx < 60:
            lim.append(_nt('conn.fragment.lim_ge_stress', symbol='Fxx', value=Fxx, limit=60))
        if Fu > 82:
            lim.append(_nt('conn.fragment.lim_le_stress', symbol='Fu', value=Fu, limit=82))
        if not Fxx > Fu:
            lim.append(_nt('conn.fragment.lim_fxx_gt_fu'))
        if lim:
            not_eval.append(_ne('Weld Tension (J2.2.3)', 'tension',
                                _nt('conn.reason.j2_2_3_j2', lim=_joined(', ', lim)), 'fastener'))
        else:
            P1 = math.pi * de_used ** 2 / 4 * Fxx
            P2 = 0.8 * (Fu / Fy) ** 2 * t_sheet * da_avg * Fu
            red = 1.0
            notes = []
            if eccentric_tension:
                red *= 0.5
                notes.append(_nt('conn.assumption.eccentric_tension_50pct'))
            if sidelap:
                red *= 0.7
                notes.append(_nt('conn.assumption.sidelap_70pct'))
            Pnt_weld = min(P1, P2) * red
            deck = str(application).lower() in ('deck', 'panel', 'panel_deck', 'deck_panel')
            phi_n, om_n = (0.60, 2.50) if deck else (0.50, 3.00)
            tr = Trace()
            i_de = _de_step(tr)
            i_da = _da_step(tr)
            i1 = tr.add('equation', 'Pnt1 = (π de² / 4) Fxx', equation='J2.2.3-1',
                        inputs=[tr.ref(i_de), _ui('Fxx', Fxx, 'stress', 'Fxx', note=_nt('conn.note.fxx_e60_default'))],
                        result=q('Pnt1', P1, 'force'))
            i2 = tr.add('equation', 'Pnt2 = 0.8 (Fu/Fy)² t da Fu', equation='J2.2.3-2',
                        inputs=[_mt('Fu', Fu), _mt('Fy', Fy), q_t, tr.ref(i_da)], result=q('Pnt2', P2, 'force'))
            i_m = tr.add('modifier', 'Pnt = min(Pnt1, Pnt2) × r  (r: 0.5 eccentric, 0.7 sidelap)', equation='J2.2.3',
                         inputs=[tr.ref(i1), tr.ref(i2),
                                 _ui('r', red, 'dimensionless', 'eccentric_tension / sidelap')],
                         result=q('Pnt', Pnt_weld, 'force'))
            tr.add('equation', 'Pnt,total = n Pnt', inputs=[tr.ref(i_m), q_n], result=q('Pnt', Pnt_weld * n, 'force'))
            limit_states.append({
                '_trace': tr.steps,
                'name': 'Weld Tension (J2.2.3)',
                'Rn': Pnt_weld * n, 'phi': phi_n, 'omega': om_n, 'direction': 'tension',
                'formula': (f'Pnt = min(π de²/4·Fxx={P1:.3f}, 0.8(Fu/Fy)²·t·da·Fu={P2:.3f})'
                            f'{" × " + "·".join(notes) if notes else ""} × {n} = {Pnt_weld * n:.3f} '
                            f'({"패널·데크" if deck else "기타 용도"})'),
                'equation': 'J2.2.3-1/-2',
            })
    else:
        not_eval.append(_ne('Weld Tension (J2.2.3)', 'tension',
                            _nt('conn.reason.j2_2_3_j2_joint'), 'fastener'))

    # J6 (아크 스팟: J6.1 e_net=e−d/2, J6.3 Manual IV-2; J6.2 는 Manual IV-2 의 합리적 해석:
    # 구멍=da, Usl=0.9+0.1·da/s, A1.2(c) 계수)
    # J6 은 접합된 판(part) 하나의 파단이다(J6.1 t = "base steel thickness of section"). 시트 두께 합은
    # 용접 전단(J2.2.2.1)과 인장(J2.2.3 "sum of the sheet thicknesses")에만 쓴다. 여러 장이면 가장 얇은
    # 한 장으로 검토한다(끝단 겹침처럼 위 시트 하나가 힘을 옮길 수 있으므로). 그 판의 구멍 폭 da = d − t_j6.
    t_j6 = min(t_sheets) if t_sheets else t_sheet
    da_j6 = max(d_vis - t_j6, 0.0)
    geo_j6 = dict(geo)
    j62f = (PHI_RATIONAL_CONNECTION, OMEGA_RATIONAL_CONNECTION, _nt('conn.label.factor_rational_iv2'))
    j6_ls, j6_warn, j6_ne = _j6_rupture_limit_states(
        conn='weld', Fu=Fu, t=t_j6, dh=d_vis, n=n, e=e, Fy=Fy, d=da_j6,
        include_block_shear=True, geometry=geo_j6, dh_transverse=d_vis, dh_net=da_j6,
        j62_factors=j62f, notes=assumptions)
    limit_states.extend(j6_ls)
    warnings.extend(j6_warn)
    not_eval.extend(j6_ne)
    if j6_part2:
        p2 = dict(j6_part2)
        da_p2 = max(d_vis - p2.get('t', t_j6), 0.0)
        p_ls, p_w, p_ne = _j6_second_part('weld', p2, n, d_vis, da_p2, assumptions,
                                          dh_transverse=d_vis, dh_net=da_p2, j62_factors=j62f)
        limit_states.extend(p_ls)
        warnings.extend(p_w)
        not_eval.extend(p_ne)
    if t_sheets and len(t_sheets) > 1:
        assumptions.append(_nt('conn.assumption.j6_multi_sheet_thinnest_j2_2', value=list(t_sheets), t_j6=t_j6, t_sheet=t_sheet))
    assumptions.append(_part_basis_note('', t_j6, bool(j6_part2)))
    if any(x['name'].startswith('Tension Rupture') for x in j6_ls):
        assumptions.append(_nt('conn.assumption.j6_2_j6_manual_iv_a1'))

    # J2.2.4 조합 (용접 1개당)
    interaction = []
    if Vu and Tu and Vu > 0 and Tu > 0:
        if Pnt_weld is None or not shear_states:
            not_eval.append(_ne('전단+인장 (J2.2.4)', 'interaction', _nt('conn.reason.j2_2_2_no_strength'),
                                'interaction'))
        else:
            lim = []
            if Fu > 105:
                lim.append(_nt('conn.fragment.lim_le_stress', symbol='Fu', value=Fu, limit=105))
            if Fxx < 60:
                lim.append(_nt('conn.fragment.lim_ge_stress', symbol='Fxx', value=Fxx, limit=60))
            if t_sheet * da_avg * Fu > 3.0:
                lim.append(_nt('conn.fragment.lim_tdafu_le'))
            if Fu / Fy < 1.02:
                lim.append(_nt('conn.fragment.lim_ge_ratio_3f', symbol='Fu/Fy', value=Fu / Fy, limit=1.02))
            if not (0.47 <= d_vis <= 1.02):
                lim.append(_nt('conn.fragment.lim_range_length', symbol='d', value=d_vis, lo=0.47, hi=1.02))
            if lim:
                not_eval.append(_ne('전단+인장 (J2.2.4)', 'interaction',
                                    _nt('conn.reason.j2_2_4_j2', lim=_joined(', ', lim)), 'interaction'))
            else:
                Pav = min(_available(x['Rn'], x['phi'], x['omega'], dm) for x in shear_states) / n
                ten = [x for x in limit_states if x['name'] == 'Weld Tension (J2.2.3)'][0]
                Pat = _available(ten['Rn'], ten['phi'], ten['omega'], dm) / n
                Vb, Tb = Vu / n, Tu / n
                tt = (Tb / Pat) ** 1.5
                tr = Trace()
                q_pav = q('Pav', Pav, 'force', src('check', note=_nt('conn.note.j2_2_2_least_available_shear_strength')))
                q_pat = q('Pat', Pat, 'force', src('check', id='conn.arc_spot.tension', note=_nt('conn.note.available_per_fastener')))
                i_t = tr.add('equation', '(T / Pat)^1.5  (per weld)', inputs=[_ui('T', Tb, 'force', 'Tu / n'), q_pat],
                             result=q('(T/Pat)^1.5', tt, 'dimensionless'))
                tr.branch('(T/Pat)^1.5 ≤ 0.15 (interaction need not be checked)', tt <= 0.15,
                          'J2.2.4' if tt <= 0.15 else 'J2.2.4-1', inputs=[tr.ref(i_t)])
                if tt <= 0.15:
                    i_v = tr.add('equation', 'value = (T/Pat)^1.5', inputs=[tr.ref(i_t)],
                                 result=q('value', tt, 'dimensionless'))
                    # 비는 하중 배율로 견줄 수 있게 (value/limit)^(1/1.5) — 다른 한계상태의 선형 비와 같은 뜻(V6-06)
                    r_lin = (tt / 0.15) ** (1 / 1.5)
                    interaction.append({'name': '전단+인장 (J2.2.4)', 'equation': 'J2.2.4',
                                        'value': round(tt, 4), 'limit': 0.15, 'ratio': round(r_lin, 4),
                                        'ratio_form': _nt('conn.label.ratio_form_root_1_5'),
                                        'pass': True, 'note': _nt('conn.label.interaction_not_required'),
                                        '_raw': {'value': tt, 'limit': 0.15, 'ratio': r_lin, 'exponent': 1.5},
                                        '_trace': _interaction_trace(tr, i_v)})
                else:
                    val = (Vb / Pav) ** 1.5 + tt
                    i_v = tr.add('equation', '(V/Pav)^1.5 + (T/Pat)^1.5  (per weld)', equation='J2.2.4-1',
                                 inputs=[_ui('V', Vb, 'force', 'Vu / n'), q_pav, tr.ref(i_t)],
                                 result=q('value', val, 'dimensionless'))
                    r_lin = val ** (1 / 1.5)
                    interaction.append({'name': '전단+인장 (J2.2.4)', 'equation': 'J2.2.4-1',
                                        'value': round(val, 4), 'limit': 1.0, 'ratio': round(r_lin, 4),
                                        'ratio_form': _nt('conn.label.ratio_form_root_1_5'),
                                        'pass': val <= 1.0 + 1e-9,
                                        '_raw': {'value': val, 'limit': 1.0, 'ratio': r_lin, 'exponent': 1.5},
                                        '_trace': _interaction_trace(tr, i_v)})

    spec = ['J2.2', 'J2.2.1', 'J2.2.2.1', 'J2.2.2.2', 'J2.2.3', 'J6.1', 'J6.2', 'J6.3']
    if Vu and Tu:
        spec.append('J2.2.4')
    return _finish('arc_spot_weld', limit_states, not_eval, warnings, dm, spec,
                   {'joint': jt}, interaction, detailing, assumptions)


# ============================================================
# 그루브 용접 (J2.1 Butt-Joint, J2.6 Flare Groove)
# ============================================================

_TWF_BEVEL = {'smaw': (5.0 / 16.0, 0.274), 'fcaw_s': (5.0 / 16.0, 0.274),
              'gmaw': (5.0 / 8.0, 0.073), 'fcaw_g': (5.0 / 8.0, 0.073),
              'saw': (5.0 / 16.0, 0.274)}           # Table J2.6-1: (twf/R, η)
_TWF_V = {'smaw': 5.0 / 8.0, 'fcaw_s': 5.0 / 8.0, 'gmaw': 0.75, 'fcaw_g': 0.75, 'saw': 0.5}  # Table J2.6-2


def _norm_process(process):
    if not process:
        return None
    return str(process).strip().lower().replace('-', '_').replace(' ', '_')


def groove_weld_connection(t1: float, t2: float,
                           weld_length: float,
                           Fy: float, Fu: float,
                           Fxx: float = 60,
                           groove_type: str = 'complete',
                           design_method: str = 'LRFD',
                           load_direction: str = 'tension',
                           te: float = None,
                           w1: float = None, w2: float = None,
                           R: float = None, h: float = None,
                           process: str = None,
                           d1: float = None, d2: float = None, R2: float = None,
                           j6_geometry: dict = None,
                           member_tension: bool = False) -> dict:
    """그루브 용접 접합 설계 (버트조인트 §J2.1, 플레어 그루브 §J2.6)

    플레어 V 홈 용접의 횡방향 하중은 J2.6 에 식이 없어 미평가로 둔다(Eq. J2.6-1 은 플레어 베벨 전용).
    member_tension=True(플레어)이면 Chapter D(D2/D3, Ag 또는 width) 도 평가한다.

    Args:
        t1, t2: 연결판 두께 (in)
        weld_length: 용접 길이 L (in)
        Fy, Fu: 모재 항복/인장강도 (ksi)
        Fxx: 용접봉 강도 (ksi)
        groove_type: 'complete'(CJP) | 'partial'(PJP) | 'flare_bevel' | 'flare_v'
        load_direction: 'tension'|'compression'|'shear' (J2.1) / 'transverse'|'longitudinal' (J2.6)
        te: 유효 목두께 (in, J2.1). CJP 는 None 이면 t_min. PJP 는 입력 필요(없으면 0.5t 참고값, 미평가).
        w1, w2, R: 플레어 베벨 레그·바깥 굽힘 반경 (Eq. J2.6-5)
        h: 립 높이 (in, J2.6(b))
        process: 'SMAW'|'FCAW-S'|'GMAW'|'FCAW-G'|'SAW' (Table J2.6-1/-2). 미지정이면 표에서 가장
            작은 목두께가 나오는 공정 값(하한)을 쓴다.
        d1, d2, R2: 플레어 V 그루브의 플러시 기준 오프셋과 두 번째 반경 (Eq. J2.6-7)
        j6_geometry: 플레어 그루브 J6 기하 (필릿과 같음). 버트 이음(J2.1)에는 J6 해당 없음.
    """
    try:
        dm = normalize_design_method(design_method)
    except ValueError as exc:
        return {'error': str(exc)}
    t_min = min(t1, t2)
    limit_states, warnings, not_eval = [], [], []
    _scope_thickness(t_min, 'J2', not_eval)
    flare = str(groove_type).lower().startswith('flare')

    if not flare:
        te_assumed = False
        if te is None:
            if groove_type == 'complete':
                te = t_min
            else:
                te = 0.5 * t_min
                te_assumed = True
                not_eval.append(_ne('Groove Weld (J2.1) PJP 목두께', 'shear',
                                    _nt('conn.reason.te_not_given'), 'detailing'))
        L = weld_length
        sval = str(load_direction).lower()
        tr = Trace()
        if te_assumed:
            i_te = tr.add('equation', 'te = 0.5 t (reference only — no basis in the Specification)',
                          inputs=[_ui('t', t_min, 'length', 'min(t1, t2)')], result=q('te', te, 'length'))
        elif groove_type == 'complete' and te == t_min:
            i_te = tr.add('equation', 'te = t (complete joint penetration)',
                          inputs=[_ui('t', t_min, 'length', 'min(t1, t2)')], result=q('te', te, 'length'))
        else:
            i_te = tr.add('equation', 'te (input)', inputs=[_ui('te', te, 'length', 'te')], result=q('te', te, 'length'))
        q_L = _ui('L', L, 'length', 'weld_length')
        if sval.startswith('shear'):
            Rn_2 = L * te * 0.6 * Fxx            # Eq. J2.1-2, φ=0.80/Ω=1.90
            Rn_3 = L * te * Fy / math.sqrt(3.0)  # Eq. J2.1-3, φ=0.90/Ω=1.70
            if dm == 'ASD':
                weld_metal_governs = Rn_2 / 1.90 <= Rn_3 / 1.70
            else:
                weld_metal_governs = 0.80 * Rn_2 <= 0.90 * Rn_3
            if weld_metal_governs:
                Rn_g, phi_g, omega_g, eq_g = Rn_2, 0.80, 1.90, 'J2.1-2'
            else:
                Rn_g, phi_g, omega_g, eq_g = Rn_3, 0.90, 1.70, 'J2.1-3'
            i2 = tr.add('equation', 'Pn2 = L te 0.6 Fxx  (weld metal)', equation='J2.1-2',
                        inputs=[q_L, tr.ref(i_te), _ui('Fxx', Fxx, 'stress', 'Fxx', note=_nt('conn.note.fxx_e60_default'))],
                        result=q('Pn2', Rn_2, 'force'))
            i3 = tr.add('equation', 'Pn3 = L te Fy / √3  (base metal)', equation='J2.1-3',
                        inputs=[q_L, tr.ref(i_te), _mt('Fy', Fy)], result=q('Pn3', Rn_3, 'force'))
            tr.branch('0.80 Pn2 ≤ 0.90 Pn3' if dm == 'LRFD' else 'Pn2/1.90 ≤ Pn3/1.70', weld_metal_governs, eq_g,
                      inputs=[tr.ref(i2), tr.ref(i3)])
            tr.add('equation', 'Pn = Pn2' if weld_metal_governs else 'Pn = Pn3',
                   inputs=[tr.ref(i2 if weld_metal_governs else i3)], result=q('Pn', Rn_g, 'force'))
            limit_states.append({
                '_trace': tr.steps,
                'name': 'Groove Weld Shear (J2.1)',
                'Rn': Rn_g, 'phi': phi_g, 'omega': omega_g, 'direction': 'shear',
                'formula': f'Pn = min(L·te·0.6Fxx, L·te·Fy/√3) = {Rn_g:.3f} (te={te:.4f})',
                'equation': eq_g,
            })
        else:
            Rn_g = L * te * Fy
            tr.add('equation', 'Pn = L te Fy', equation='J2.1-1', inputs=[q_L, tr.ref(i_te), _mt('Fy', Fy)],
                   result=q('Pn', Rn_g, 'force'))
            limit_states.append({
                '_trace': tr.steps,
                'name': 'Groove Weld Tension/Compression (J2.1)',
                'Rn': Rn_g, 'phi': 0.90, 'omega': 1.70, 'direction': 'shear',
                'formula': f'Pn = L({L})×te({te:.4f})×Fy({Fy}) = {Rn_g:.3f}',
                'equation': 'J2.1-1',
            })
        if te_assumed:
            limit_states[-1]['assumed'] = True
        notes = [_nt('conn.assumption.j6_butt_joint_no_rupture_path')]
    else:
        t = t_min
        L = weld_length
        proc = _norm_process(process)
        tw = None
        tw_note = 'tw 미산정'
        tw_inputs = None   # 계산서: tw 단계(식, 입력)
        is_v = str(groove_type).lower().endswith('v')
        if not is_v and w1 is not None and w2 is not None and R is not None and w1 > 0:
            wf = math.sqrt(w1 ** 2 + w2 ** 2)
            if proc in _TWF_BEVEL:
                choices = [_TWF_BEVEL[proc]]
            else:
                choices = list(set(_TWF_BEVEL.values()))
                if proc is not None:
                    warnings.append(_nt('conn.warning.j2_6_process_not_in_table', process=process))
            tws = []
            for twf_r, eta in choices:
                twv = ((w2 + twf_r * R - R + math.sqrt(max(2.0 * R * w1 - w1 ** 2, 0.0))) * (w1 / wf)
                       - R * eta * (w2 / wf))
                tws.append(max(twv, 0.0))
            tw = min(tws)
            tw_note = f'tw(Eq. J2.6-5)={tw:.4f}' + ('' if proc in _TWF_BEVEL else ' (공정 미지정: 하한)')
            tw_inputs = ('tw = (w2 + twf − R + (2 R w1 − w1²)^0.5) w1/wf − η R w2/wf, wf = (w1² + w2²)^0.5'
                         + ('' if proc in _TWF_BEVEL else '  (least over the processes of Table J2.6-1)'),
                         'J2.6-5', [_ui('w1', w1, 'length', 'w1'), _ui('w2', w2, 'length', 'w2'),
                                    _ui('R', R, 'length', 'R'),
                                    _sp('twf/R, η', None if proc not in _TWF_BEVEL else _TWF_BEVEL[proc][0],
                                        table='J2.6-1', process=process or 'not given (lower bound)')])
        elif is_v and R is not None and d1 is not None and d2 is not None:
            Rv = min(R, R2) if R2 else R
            if proc in _TWF_V:
                twf = _TWF_V[proc] * Rv
            else:
                twf = min(_TWF_V.values()) * Rv
            tw = max(min(twf - d1, twf - d2), 0.0)
            tw_note = f'tw(Eq. J2.6-7)={tw:.4f}' + ('' if proc in _TWF_V else ' (공정 미지정: 하한)')
            tw_inputs = ('tw = min(twf − d1, twf − d2), twf = k R', 'J2.6-7',
                         [q('twf', twf, 'length', src('specification', table='J2.6-2',
                                                       process=process or 'not given (lower bound)', R=Rv)),
                          _ui('d1', d1, 'length', 'd1'), _ui('d2', d2, 'length', 'd2')])
        sval = str(load_direction).lower()
        transverse = sval.startswith('trans')
        if transverse and is_v:
            # J2.6(a) 의 Eq. J2.6-1 은 플레어 베벨 홈 용접 전용이다. 플레어 V 홈 용접의 횡방향 하중에는
            # 기준 식이 없다(시험 K2 또는 A1.2 합리적 해석).
            Pnv = None
            not_eval.append(_ne('Flare V-Groove Transverse (J2.6)', 'shear',
                                _nt('conn.reason.j2_6_flare_v_transverse_no_equation'), 'fastener'))
        elif transverse:
            Pnv = 0.833 * t * L * Fu            # Eq. J2.6-1
            phi_f, omega_f, eq_f = 0.60, 2.55, 'J2.6-1'
        else:
            if tw is not None and tw >= 2.0 * t and (h is not None and h >= L):
                Pnv = 1.50 * t * L * Fu      # Eq. J2.6-3
                eq_f = 'J2.6-3'
            else:
                Pnv = 0.75 * t * L * Fu      # Eq. J2.6-2 (tw 미산정 시 보수 분기)
                eq_f = 'J2.6-2'
            phi_f, omega_f = 0.55, 2.80
        Pnv_base = Pnv
        Pn_cap = None
        if t > 0.10 and Pnv is not None:
            if tw is None:
                not_eval.append(_ne('Flare Groove (J2.6-4) 용접금속 상한', 'shear',
                                    _nt('conn.reason.tw_w1_w2_d1'),
                                    'detailing'))
            else:
                Pn_cap = 0.75 * tw * L * Fxx
                if Pn_cap < Pnv:
                    Pnv = Pn_cap
                    eq_f = f'{eq_f}≤J2.6-4'
                    phi_f, omega_f = 0.60, 2.55
        if Pnv is not None:
            tr = Trace()
            q_t, q_L, q_fu = _ui('t', t, 'length', 'min(t1, t2)'), _ui('L', L, 'length', 'weld_length'), _mt('Fu', Fu)
            i_tw = None
            if tw is not None:
                i_tw = tr.add('equation', tw_inputs[0], equation=tw_inputs[1],
                              inputs=[x for x in tw_inputs[2] if x['value'] is not None],
                              result=q('tw', tw, 'length'))
            base_eq = eq_f.split('≤')[0]
            if transverse:
                tr.branch('transverse load (flare bevel)', True, 'J2.6-1', inputs=[])
                i_b = tr.add('equation', 'Pn = 0.833 t L Fu', equation='J2.6-1', inputs=[q_t, q_L, q_fu],
                             result=q('Pn', Pnv_base, 'force'))
            else:
                ins = [q_t, q_L]
                if i_tw is not None:
                    ins.append(tr.ref(i_tw))
                if h is not None:
                    ins.append(_ui('h', h, 'length', 'h'))
                tr.branch('tw ≥ 2t and h ≥ L (longitudinal)', base_eq == 'J2.6-3', base_eq, inputs=ins)
                i_b = tr.add('equation', 'Pn = 1.50 t L Fu' if base_eq == 'J2.6-3' else 'Pn = 0.75 t L Fu',
                             equation=base_eq, inputs=[q_t, q_L, q_fu], result=q('Pn', Pnv_base, 'force'))
            if Pn_cap is not None:
                tr.branch('t > t,lim  (weld-metal limit applies)', True, 'J2.6-4',
                          inputs=[q_t, _sp('t,lim', 0.10, 'length', note=_nt('conn.note.j2_6_j2'))])
                i_c = tr.add('equation', 'Pn,weld = 0.75 tw L Fxx', equation='J2.6-4',
                             inputs=[tr.ref(i_tw), q_L, _ui('Fxx', Fxx, 'stress', 'Fxx',
                                                            note=_nt('conn.note.fxx_e60_default'))],
                             result=q('Pn,weld', Pn_cap, 'force'))
                tr.add('modifier', 'Pn = min(Pn, Pn,weld)', inputs=[tr.ref(i_b), tr.ref(i_c)],
                       result=q('Pn', Pnv, 'force'))
            limit_states.append({
                '_trace': tr.steps,
                'name': 'Flare Groove Shear (J2.6)',
                'Rn': Pnv, 'phi': phi_f, 'omega': omega_f, 'direction': 'shear',
                'formula': f'Pnv = {Pnv:.3f} ({tw_note}, t={t})',
                'equation': eq_f,
            })
        notes = []
        geo = dict(j6_geometry or {})
        _weld_j6(geo, Fy, Fu, t, warnings, not_eval, limit_states, notes)
        if member_tension:
            _weld_chapter_d(geo, Fy, Fu, t, warnings, not_eval, limit_states)

    not_eval.append(_ne('면외 인장', 'tension', _nt('conn.reason.groove_no_out_of_plane_tension'), 'fastener'))
    return _finish('groove_weld', limit_states, not_eval, warnings, dm,
                   ['J2.6', 'J6.2', 'J6.3'] if flare else ['J2.1'],
                   assumptions=[_CONCENTRIC] + notes)


# ============================================================
# 아크 시임 용접 (J2.3)
# ============================================================

def arc_seam_weld_connection(t1: float, t2: float,
                              d: float, L_seam: float,
                              Fy: float, Fu: float,
                              Fxx: float = 60,
                              n: int = 1,
                              design_method: str = 'LRFD',
                              Vu: float = None, Tu: float = None,
                              joint: str = None, t_sheets: list = None,
                              e: float = None,
                              seam_orientation: str = 'transverse',
                              j6_geometry: dict = None,
                              j6_part2: dict = None) -> dict:
    """아크 시임 용접 접합 설계 (§J2.3 + §J6)

    Args:
        t1, t2: 연결판 두께 (in)
        d: 시임 가시 폭 (in)
        L_seam: 원형 끝을 뺀 시임 길이 L (in). 계산에는 L ≤ 3d (J2.3.2.1).
        Fy, Fu: 시트 강도 (ksi)
        Fxx: 용접봉 강도 (ksi)
        n: 시임 수
        joint: 'sheet_to_support' (J2.3.2.1) | 'sheet_to_sheet' (J2.3.2.2). None 은 아크 스팟과 같다.
        e: 끝단 거리(시임 중심선 → 재단 끝, in)
        seam_orientation: 'transverse'(시임 길이가 하중에 직각, Manual IV-3) | 'longitudinal'
        j6_geometry: member_case, Ag/width, g, edge_transverse, …
    """
    try:
        dm = normalize_design_method(design_method)
        jt = _normalize_joint(joint)
    except ValueError as exc:
        return {'error': str(exc)}
    n = int(n)
    limit_states, warnings, not_eval, detailing = [], [], [], []
    assumptions = [_CONCENTRIC]
    equal = abs(t1 - t2) <= 0.01 * max(t1, t2)
    t_sheet = float(sum(t_sheets)) if t_sheets else min(t1, t2)
    if t_sheets and jt is None:
        jt = 'sheet_to_support'
    _scope_thickness(min(t1, t2), 'J2', not_eval)
    if jt is None:
        warnings.append(_nt('conn.warning.j2_3_j2_joint', text=_nt('conn.fragment.j2_3_equal_thickness')
                                                  if equal else _nt('conn.fragment.j2_3_thinner_as_sheet')))

    L_eff = min(L_seam, 3.0 * d)
    if L_seam > 3.0 * d + 1e-9:
        warnings.append(_nt('conn.warning.j2_3_2_1_j2', L_seam=L_seam, L_eff=L_eff))
    da_avg = max(d - t_sheet, 0.0)                      # Eq. J2.3.2.1-4
    # Eq. J2.3.2.1-3 은 de = 0.7d − 1.5t 뿐이다. 0.55d 상한은 원문 식에 없다(아크 스폿 Eq. J2.2.2.1-5 의 상한이고,
    # Figure J2.3.2.2-1 의 주석에만 보인다) — 사내 보수 상한(A1.2)으로 두고 따로 밝힌다(V6-15).
    de_eq = max(0.7 * d - 1.5 * t_sheet, 0.0)
    de = min(de_eq, 0.55 * d)

    if e is not None:
        detailing.append(_detail('시임 중심 → 끝단 ≥ 1.5d (J2.3.1)', e, 1.5 * d, 'J2.3.1'))
        detailing.append(_detail('시임 → 끝단 순거리 ≥ 1.0d (J2.3.1)', e - d / 2.0, d, 'J2.3.1'))
    else:
        not_eval.append(_ne('끝단 거리 (J2.3.1)', 'shear', _nt('conn.reason.e_not_given'), 'detailing'))

    q_d = _ui('d', d, 'length', 'da (seam width)')
    q_t = _ui('t', t_sheet, 'length', 't (sheet; Σ t_sheets)')
    q_n = _ui('n', n, 'count', 'n')

    def _leff(tr):
        return tr.add('modifier', 'L ≤ 3d', equation='J2.3.2.1',
                      inputs=[_ui('L', L_seam, 'length', 'weld_length / L_seam'), q_d], result=q('L', L_eff, 'length'))
    if jt in (None, 'sheet_to_support'):
        if de < de_eq:
            # de 를 쓰는 식(J2.3.2.1-1)에서만 밝힌다 — 시트-시트(J2.3.2.2)는 de 를 쓰지 않는다.
            assumptions.append(_nt('conn.assumption.j2_3_2_1_de_capped_0_55d', de_eq=de_eq, value=0.55 * d))
        Rn_weld = 0.75 * Fxx * (L_eff * de + math.pi / 4 * de ** 2) * n
        tr = Trace()
        i_de = tr.add('equation', 'de = 0.7 d − 1.5 t  (≥ 0)', equation='J2.3.2.1-3', inputs=[q_d, q_t],
                      result=q('de', de_eq, 'length'))
        i_de = tr.add('modifier', 'de = min(de, 0.55 d)  (in-house conservative cap, A1.2 — not in Eq. J2.3.2.1-3)',
                      inputs=[tr.ref(i_de), q_d], result=q('de', de, 'length'), basis='in_house_A1.2')
        i_l = _leff(tr)
        tr.add('equation', 'Pnv = (π de² / 4 + L de) 0.75 Fxx n', equation='J2.3.2.1-1',
               inputs=[tr.ref(i_de), tr.ref(i_l), _ui('Fxx', Fxx, 'stress', 'Fxx', note=_nt('conn.note.fxx_e60_default')),
                       q_n], result=q('Pnv', Rn_weld, 'force'))
        limit_states.append({
            '_trace': tr.steps,
            'name': 'Weld Seam Shear (J2.3.2.1)',
            'Rn': Rn_weld, 'phi': 0.60, 'omega': 2.55, 'direction': 'shear',
            'formula': f'Pnv = (π·de²/4 + L·de)·0.75Fxx = (π/4×{de:.3f}² + {L_eff:.3f}×{de:.3f})×0.75×{Fxx}×{n} = {Rn_weld:.3f}',
            'equation': 'J2.3.2.1-1',
        })
        Rn_tear = 2.5 * t_sheet * Fu * (0.25 * L_eff + 0.96 * da_avg) * n
        tr = Trace()
        i_da = tr.add('equation', 'da = d − t', equation='J2.3.2.1-4', inputs=[q_d, q_t], result=q('da', da_avg, 'length'))
        i_l = _leff(tr)
        tr.add('equation', 'Pnv = 2.5 t Fu (0.25 L + 0.96 da) n', equation='J2.3.2.1-2',
               inputs=[q_t, _mt('Fu', Fu), tr.ref(i_l), tr.ref(i_da), q_n], result=q('Pnv', Rn_tear, 'force'))
        limit_states.append({
            '_trace': tr.steps,
            'name': 'Sheet Tear (J2.3.2.1)',
            'Rn': Rn_tear, 'phi': 0.60, 'omega': 2.55, 'direction': 'shear',
            'formula': f'Pnv = 2.5×{t_sheet}×{Fu}×(0.25×{L_eff:.3f}+0.96×da({da_avg:.4f}))×{n} = {Rn_tear:.3f}',
            'equation': 'J2.3.2.1-2',
        })
    if jt == 'sheet_to_sheet' or (jt is None and equal):
        ts = t1
        lim = []
        if not equal:
            lim.append(_nt('conn.fragment.lim_equal_thickness'))
        if Fu > 59:
            lim.append(_nt('conn.fragment.lim_le_stress', symbol='Fu', value=Fu, limit=59))
        if not Fxx > Fu:
            lim.append(_nt('conn.fragment.lim_fxx_gt_fu'))
        if not (0.028 <= ts <= 0.0635):
            lim.append(_nt('conn.fragment.lim_range_length', symbol='t', value=ts, lo=0.028, hi=0.0635))
        if lim:
            not_eval.append(_ne('Sheet Tear Sheet-to-Sheet (J2.3.2.2)', 'shear',
                                _nt('conn.reason.j2_3_2_2_j2', lim=_joined(', ', lim)), 'fastener'))
        else:
            da_s = max(d - ts, 0.0)
            Rn_ss = 1.65 * ts * da_s * Fu * n
            tr = Trace()
            q_ts = _ui('t', ts, 'length', 't1 (= t2)')
            i_da = tr.add('equation', 'da = d − t', inputs=[q_d, q_ts], result=q('da', da_s, 'length'))
            tr.add('equation', 'Pnv = 1.65 t da Fu n', equation='J2.3.2.2-1',
                   inputs=[q_ts, tr.ref(i_da), _mt('Fu', Fu), q_n], result=q('Pnv', Rn_ss, 'force'))
            limit_states.append({
                '_trace': tr.steps,
                'name': 'Sheet Tear Sheet-to-Sheet (J2.3.2.2)',
                'Rn': Rn_ss, 'phi': 0.70, 'omega': 2.20, 'direction': 'shear',
                'formula': f'Pnv = 1.65×t({ts})×da({da_s:.4f})×Fu({Fu})×{n} = {Rn_ss:.3f}',
                'equation': 'J2.3.2.2-1',
            })

    # J6 — Manual IV-3: e_net = e − d/2, J6.2 의 제거 폭 = L + d (하중직각 시임)
    if str(seam_orientation).lower().startswith('long'):
        dh_long, dh_tr = L_seam + d, d
    else:
        dh_long, dh_tr = d, L_seam + d
    # J6 은 판 한 장의 파단 — 여러 시트면 가장 얇은 한 장 (아크 스팟과 같은 까닭)
    t_j6 = min(t_sheets) if t_sheets else t_sheet
    j62f = (PHI_RATIONAL_CONNECTION, OMEGA_RATIONAL_CONNECTION, _nt('conn.label.factor_rational_iv2_like'))
    j6_ls, j6_warn, j6_ne = _j6_rupture_limit_states(
        conn='weld', Fu=Fu, t=t_j6, dh=dh_long, n=n, e=e, Fy=Fy, d=dh_tr,
        include_block_shear=True, geometry=dict(j6_geometry or {}), dh_transverse=dh_tr, dh_net=dh_tr,
        j62_factors=j62f, notes=assumptions)
    limit_states.extend(j6_ls)
    warnings.extend(j6_warn)
    not_eval.extend(j6_ne)
    if j6_part2:
        p_ls, p_w, p_ne = _j6_second_part('weld', j6_part2, n, dh_long, dh_tr, assumptions,
                                          dh_transverse=dh_tr, dh_net=dh_tr, j62_factors=j62f)
        limit_states.extend(p_ls)
        warnings.extend(p_w)
        not_eval.extend(p_ne)
    if t_sheets and len(t_sheets) > 1:
        assumptions.append(_nt('conn.assumption.j6_multi_sheet_thinnest_j2_3', value=list(t_sheets), t_j6=t_j6, t_sheet=t_sheet))
    assumptions.append(_part_basis_note('', t_j6, bool(j6_part2)))
    if any(x['name'].startswith('Tension Rupture') for x in j6_ls):
        assumptions.append(_nt('conn.assumption.j6_2_j6_a1_usl_manual'))
    not_eval.append(_ne('면외 인장', 'tension', _nt('conn.reason.arc_seam_no_tension'), 'fastener'))
    return _finish('arc_seam', limit_states, not_eval, warnings, dm,
                   ['J2.3.1', 'J2.3.2.1', 'J2.3.2.2', 'J6.1', 'J6.2', 'J6.3'],
                   {'joint': jt, 'L_effective': round(L_eff, 4)}, None, detailing, assumptions)


# ============================================================
# PAF 화약작동 체결재 (J5)
# ============================================================

PHI_PAF = {'pin_shear': 0.60, 'bearing': 0.80, 'pullout_shear': 0.60,
           'pullout_tension': 0.40, 'pullover': 0.50, 'tension': 0.60}
OMEGA_PAF = {'pin_shear': 2.65, 'bearing': 2.05, 'pullout_shear': 2.55,
             'pullout_tension': 4.00, 'pullover': 3.00, 'tension': 2.65}

# J5.2.1-2 의 F_bs (경도로 F_uh 를 구하는 기준응력, 66,000 psi). J5.3.3 의 E 가 아니다.
PAF_FBS = 66.0
PAF_FH = PAF_FBS  # 과거 이름(호환)
# F_uh 미입력 시 쓰던 값(기준 근거 없음 — 사용하면 미평가로 표시)
PAF_FUH = 120.0


def paf_connection(t1: float, t2: float, d: float,
                   Fy: float, Fu: float, Fuf: float,
                   n: int = 1,
                   design_method: str = 'LRFD',
                   Fy2: float = None, Fu1: float = None,
                   dar: float = None, dw: float = None,
                   Pnot_test: float = None,
                   e: float = None,
                   Ag: float = None, width: float = None,
                   Vu: float = None, Tu: float = None,
                   HRC_p: float = None,
                   alpha_w: float = 1.5, alpha_b: float = 3.2,
                   E: float = E_STEEL, s: float = None,
                   j6_geometry: dict = None,
                   j6_part2: dict = None) -> dict:
    """화약작동 체결재(PAF) 접합 설계 (§J5 + §J6)

    Args:
        t1: PAF 머리/와셔와 접촉하는 부재 두께 (in, ≤ 0.06)
        t2: 머리와 접촉하지 않는 (far) 부재 두께 (in, ≤ 0.75)
        d: PAF 생크 직경 ds (in, 0.106–0.206)
        Fy, Fu: t1(머리측) 부재 강도 (ksi)
        Fuf: PAF 경화강 인장강도 F_uh (ksi). 없으면 HRC_p 로 Eq. J5.2.1-2, 그것도 없으면 120 ksi
            참고값(기준 근거 없음 → 미평가 표시).
        Fy2: far member 항복강도 (ksi, J5.3.3). None 이면 Fy (경고).
        Fu1: 머리측 부재 인장강도 (ksi). None 이면 Fu.
        dar: 평균 매입직경 d_ae (in, J5.3.3). None 이면 d.
        dw: 머리·와셔 실제 접촉 직경 d'w (in, J5.2.3). 계산에는 ≤ 0.60 in. None 이면 풀오버 미평가.
        Pnot_test: J5.2.2 인장 풀아웃 공칭강도 (시험·제조사, kips/개)
        e: 끝단 거리 (in). None 이면 Table J5.1-1 최소값으로 J6.1 계산 + 미확인 표시.
        Vu, Tu: 접합부 전체 소요 전단·인장력 — 둘 다 있으면 J5.4 (Commentary Eq. C-J5.4-1)
        HRC_p: PAF 로크웰 C 경도 (Eq. J5.2.1-2)
        alpha_w: J5.2.3 풀오버 계수 (1.5 / 1.25 / 2.0)
        alpha_b: J5.3.2 지압 계수 (3.2, Fig. J5-1(c)(d) 형식은 3.7)
        E: 탄성계수 (ksi, J5.3.3)
        s: PAF 간격 (in, Table J5.1-1)
    """
    try:
        dm = normalize_design_method(design_method)
    except ValueError as exc:
        return {'error': str(exc)}
    n = int(n)
    if Fy2 is None:
        Fy2 = Fy
        fy2_default = True
    else:
        fy2_default = False
    if Fu1 is None:
        Fu1 = Fu
    if dar is None:
        dar = d
    geo = dict(j6_geometry or {})
    limit_states, warnings, not_eval, detailing = [], [], [], []
    assumptions = [_CONCENTRIC,
                   _nt('conn.assumption.j5_3_2_point_below_t2'),
                   _nt('conn.assumption.j5_3_3_penetration_0_6t2')]

    # 적용범위 (J5)
    lim = []
    if t1 > 0.06 + 1e-9:
        lim.append(_nt('conn.fragment.lim_le_length', symbol='t1', value=t1, limit=0.06))
    if t2 > 0.75 + 1e-9:
        lim.append(_nt('conn.fragment.lim_le_length', symbol='t2', value=t2, limit=0.75))
    if not (0.106 - 1e-9 <= d <= 0.206 + 1e-9):
        lim.append(_nt('conn.fragment.lim_range_length', symbol='ds', value=d, lo=0.106, hi=0.206))
    if lim:
        not_eval.append(_ne('적용범위 (J5)', 'any', _nt('conn.reason.j5_out_of_scope', lim=_joined(', ', lim)), 'scope'))

    # Table J5.1-1 간격·연단
    if d >= 0.200:
        e_min, s_min = 1.00, 1.60
    else:
        e_min, s_min = 0.50, 1.00
    e_assumed = False
    if e is None:
        e = e_min
        e_assumed = True
        not_eval.append(_ne('연단 거리 (Table J5.1-1)', 'shear',
                            _nt('conn.reason.j6_1_j6_2', e_min=e_min), 'detailing'))
    else:
        detailing.append(_detail('연단 거리 (Table J5.1-1)', e, e_min, 'J5.1'))
    if n > 1:
        if s is None:
            not_eval.append(_ne('PAF 간격 (Table J5.1-1)', 'shear', _nt('conn.reason.spacing_not_given_min', s_min=s_min), 'detailing'))
        else:
            detailing.append(_detail('PAF 간격 (Table J5.1-1)', s, s_min, 'J5.1'))

    # F_uh (J5.2.1)
    if Fuf is not None and Fuf > 0:
        Fuh, fuh_note, fuh_ok = Fuf, f'F_uh={Fuf} (입력)', True
    elif HRC_p is not None:
        Fuh = PAF_FBS * math.exp(HRC_p / 40.0)
        fuh_note = f'F_uh = F_bs·e^(HRC/40) = {Fuh:.1f} (Eq. J5.2.1-2)'
        if HRC_p >= 52:
            Fuh = min(Fuh, 260.0)
            fuh_note += ' / HRC ≥ 52 → 260 ksi 허용, 작은 값 사용'
        fuh_ok = True
    else:
        Fuh, fuh_note, fuh_ok = PAF_FUH, f'F_uh={PAF_FUH} (참고값, 기준 근거 없음)', False
        not_eval.append(_ne('PAF 강도 F_uh (J5.2.1)', 'shear',
                            _nt('conn.reason.fuf_uh_hrc_ksi'), 'fastener'))
        not_eval.append(_ne('PAF 강도 F_uh (J5.2.1)', 'tension',
                            _nt('conn.reason.fuf_uh_hrc_ksi'), 'fastener'))

    q_d = _ui('ds', d, 'length', 'd (shank diameter)')
    q_n = _ui('n', n, 'count', 'n')
    q_t1 = _ui('t1', t1, 'length', 't1 (head side)')
    q_fu1 = _mt('Fu1', Fu1)

    def _fuh_step(tr):
        if Fuf is not None and Fuf > 0:
            return tr.add('equation', 'F_uh (input)', inputs=[_ui('F_uh', Fuf, 'stress', 'Fuf')],
                          result=q('F_uh', Fuh, 'stress'))
        if HRC_p is not None:
            f_formula = PAF_FBS * math.exp(HRC_p / 40.0)
            i_f = tr.add('equation', 'F_uh = F_bs e^(HRC/40)', equation='J5.2.1-2',
                         inputs=[_sp('F_bs', PAF_FBS, 'stress'), _ui('HRC', HRC_p, 'dimensionless', 'HRC_p')],
                         result=q('F_uh', f_formula, 'stress'))
            if HRC_p >= 52:
                # J5.2.1: HRC ≥ 52 이면 260 ksi 를 '써도 된다'(대안). 엔진은 둘 중 작은 값을 쓴다(사내 보수).
                tr.branch('HRC ≥ 52  (F_uh,alt permitted)', True, 'J5.2.1',
                          inputs=[_ui('HRC', HRC_p, 'dimensionless', 'HRC_p')])
                i_f = tr.add('modifier', 'F_uh = min(F_uh, F_uh,alt)  (engine takes the smaller — conservative)',
                             inputs=[tr.ref(i_f), _sp('F_uh,alt', 260.0, 'stress', note=_nt('conn.note.j5_2_1_j5_hrc'))],
                             result=q('F_uh', Fuh, 'stress'), basis='in_house_A1.2')
            return i_f
        return tr.add('equation', 'F_uh = 120 ksi (reference only — no basis)',
                      inputs=[q('F_uh', Fuh, 'stress', src('engine_default', key='Fuf', note=_nt('conn.note.f_uh_default')))],
                      result=q('F_uh', Fuh, 'stress'))

    # (a) 핀 전단 (J5.3.1, Eq. J5.3.1-1)
    Pnvp = 0.6 * (d / 2.0) ** 2 * math.pi * Fuh * n
    tr = Trace()
    i_f = _fuh_step(tr)
    tr.add('equation', 'Pnvp = 0.6 π (ds/2)² F_uh n', equation='J5.3.1-1', inputs=[q_d, tr.ref(i_f), q_n],
           result=q('Pnvp', Pnvp, 'force'))
    item = {
        '_trace': tr.steps,
        'name': 'Pin Shear (J5.3.1)',
        'Rn': Pnvp, 'phi': PHI_PAF['pin_shear'], 'omega': OMEGA_PAF['pin_shear'], 'direction': 'shear',
        'formula': f'Pnvp = 0.6×(d/2)²π×Fuh×{n} = {Pnvp:.3f} ({fuh_note})',
        'equation': 'J5.3.1-1',
    }
    if not fuh_ok:
        item['assumed'] = True
    limit_states.append(item)

    # (b) 지압/tilting (J5.3.2, Eq. J5.3.2-1) — 적용한계 (Manual IV-12 은 ds=0.180 을 0.177 로 본다)
    lim = []
    if t2 / t1 < 2.0:
        lim.append(_nt('conn.fragment.lim_ge_ratio_2f', symbol='t2/t1', value=t2 / t1, limit=2))
    if t2 < 0.125 - 1e-9:
        lim.append(_nt('conn.fragment.lim_ge_length_eighth', symbol='t2', value=t2))
    if not (0.146 - 1e-9 <= d <= 0.177 + 0.003 + 1e-9):
        lim.append(_nt('conn.fragment.lim_range_length', symbol='ds', value=d, lo=0.146, hi=0.177))
    if lim:
        not_eval.append(_ne('Bearing/Tilting (J5.3.2)', 'shear',
                            _nt('conn.reason.j5_3_2_j5', lim=_joined(', ', lim)), 'fastener'))
    else:
        if d > 0.177:
            warnings.append(_nt('conn.warning.j5_3_2_j5_ds_manual_iv', d=d))
        Pnb = alpha_b * d * t1 * Fu1 * n
        tr = Trace()
        tr.add('equation', 'Pnb = αb ds t1 Fu1 n', equation='J5.3.2-1',
               inputs=[_ui('αb', alpha_b, 'dimensionless', 'alpha_b', note=_nt('conn.note.alpha_b_default')), q_d, q_t1,
                       q_fu1, q_n], result=q('Pnb', Pnb, 'force'))
        limit_states.append({
            '_trace': tr.steps,
            'name': 'Bearing/Tilting (J5.3.2)',
            'Rn': Pnb, 'phi': PHI_PAF['bearing'], 'omega': OMEGA_PAF['bearing'], 'direction': 'shear',
            'formula': f'Pnb = αb({alpha_b})×ds({d})×t1({t1})×Fu1({Fu1})×{n} = {Pnb:.3f}',
            'equation': 'J5.3.2-1',
        })

    # (c) 전단 풀아웃 (J5.3.3, Eq. J5.3.3-1): Pnos = d_ae^1.8·t2^0.2·(Fy2·E²)^(1/3)/30
    lim = []
    if not (0.113 - 1e-9 <= t2 <= 0.75 + 1e-9):
        lim.append(_nt('conn.fragment.lim_range_length', symbol='t2', value=t2, lo=0.113, hi=0.75))
    if not (0.106 - 1e-9 <= d <= 0.206 + 1e-9):
        lim.append(_nt('conn.fragment.lim_range_length', symbol='ds', value=d, lo=0.106, hi=0.206))
    if lim:
        not_eval.append(_ne('Pull-out in Shear (J5.3.3)', 'shear',
                            _nt('conn.reason.j5_3_3_j5', lim=_joined(', ', lim)), 'fastener'))
    else:
        Pnos = (dar ** 1.8) * (t2 ** 0.2) * ((Fy2 * E ** 2) ** (1.0 / 3.0)) / 30.0 * n
        tr = Trace()
        tr.add('equation', 'Pnos = dae^1.8 t2^0.2 (Fy2 E²)^(1/3) / 30 n', equation='J5.3.3-1',
               inputs=[_ui('dae', dar, 'length', 'dar', note=_nt('conn.note.d_when_not_given')), _ui('t2', t2, 'length', 't2'),
                       q('Fy2', Fy2, 'stress', src('engine_default', key='Fy2', note=_nt('conn.note.head_side_fy'))
                         if fy2_default else src('material', key='Fy2')),
                       _sp('E', E, 'stress'), q_n], result=q('Pnos', Pnos, 'force'))
        limit_states.append({
            '_trace': tr.steps,
            'name': 'Pull-out in Shear (J5.3.3)',
            'Rn': Pnos, 'phi': PHI_PAF['pullout_shear'], 'omega': OMEGA_PAF['pullout_shear'],
            'direction': 'shear',
            'formula': f'Pnos = dae({dar})^1.8·t2({t2})^0.2·(Fy2({Fy2})·E({E})²)^(1/3)/30 ×{n} = {Pnos:.3f}',
            'equation': 'J5.3.3-1',
        })
        if fy2_default:
            limit_states[-1]['assumed'] = True
            not_eval.append(_ne('Pull-out in Shear (J5.3.3)', 'shear',
                                _nt('conn.reason.fy2_fy'), 'fastener'))

    # (d) 풀오버 (J5.2.3, Eq. J5.2.3-1): Pnov = αw·t1·d'w·Fu1, d'w ≤ 0.60 in
    if dw is None:
        not_eval.append(_ne('Pull-over (J5.2.3)', 'tension', _nt('conn.reason.dw_contact_not_given'), 'fastener'))
    else:
        dw_c = min(dw, 0.60)
        if dw > 0.60:
            warnings.append(_nt('conn.warning.j5_washer_diameter_capped', dw=dw))
        Pnov = alpha_w * t1 * dw_c * Fu1 * n
        tr = Trace()
        i_dw = tr.add('modifier', "d'w = min(d'w, d'w,max)", equation='J5.2.3',
                      inputs=[_ui("d'w", dw, 'length', 'dw'), _sp("d'w,max", 0.60, 'length', note=_nt('conn.note.j5_2_3_j5'))],
                      result=q("d'w", dw_c, 'length'))
        tr.add('equation', "Pnov = αw t1 d'w Fu1 n", equation='J5.2.3-1',
               inputs=[_ui('αw', alpha_w, 'dimensionless', 'alpha_w', note=_nt('conn.note.alpha_w_default')), q_t1, tr.ref(i_dw), q_fu1,
                       q_n], result=q('Pnov', Pnov, 'force'))
        limit_states.append({
            '_trace': tr.steps,
            'name': 'Pull-over (J5.2.3)',
            'Rn': Pnov, 'phi': PHI_PAF['pullover'], 'omega': OMEGA_PAF['pullover'], 'direction': 'tension',
            'formula': f"Pnov = αw({alpha_w})×t1({t1})×d'w({dw_c:.3f})×Fu1({Fu1})×{n} = {Pnov:.3f}",
            'equation': 'J5.2.3-1',
        })

    # (e) PAF 인장 (J5.2.1, Eq. J5.2.1-1)
    Pntp = (d / 2.0) ** 2 * math.pi * Fuh * n
    tr = Trace()
    i_f = _fuh_step(tr)
    tr.add('equation', 'Pntp = π (ds/2)² F_uh n', equation='J5.2.1-1', inputs=[q_d, tr.ref(i_f), q_n],
           result=q('Pntp', Pntp, 'force'))
    item = {
        '_trace': tr.steps,
        'name': 'PAF Tension (J5.2.1)',
        'Rn': Pntp, 'phi': PHI_PAF['tension'], 'omega': OMEGA_PAF['tension'], 'direction': 'tension',
        'formula': f'Pntp = (d/2)²π×Fuh×{n} = {Pntp:.3f} ({fuh_note})',
        'equation': 'J5.2.1-1',
    }
    if not fuh_ok:
        item['assumed'] = True
    limit_states.append(item)

    # (f) 인장 풀아웃 (J5.2.2): 폐쇄형 식 없음 — 시험값
    if Pnot_test is not None and Pnot_test > 0:
        tr = Trace()
        tr.add('equation', 'Pnot = n Pnot,test', inputs=[q_n, _ui('Pnot,test', Pnot_test, 'force', 'Pnot_test')],
               result=q('Pnot', Pnot_test * n, 'force'))
        limit_states.append({
            '_trace': tr.steps,
            'name': 'Pull-out in Tension (J5.2.2)',
            'Rn': Pnot_test * n, 'phi': PHI_PAF['pullout_tension'], 'omega': OMEGA_PAF['pullout_tension'],
            'direction': 'tension',
            'formula': f'Pnot = (시험값 {Pnot_test})×{n} = {Pnot_test * n:.3f}',
            'equation': 'J5.2.2 (test)',
        })
    else:
        not_eval.append(_ne('Pull-out in Tension (J5.2.2)', 'tension',
                            _nt('conn.reason.pnot_test'), 'fastener'))

    # (g) J6 (J5.3.4/J5.3.5): 구멍 = 1.10·ds, 나사/PAF 계수(Table J6-1)
    t_crit = min(t1, t2)
    j6_ls, j6_warn, j6_ne = _j6_rupture_limit_states(
        conn='paf', Fu=Fu1, t=t_crit, dh=1.10 * d, n=n, e=e,
        Ag=Ag, width=width, d=d, include_block_shear=False, geometry=geo, e_assumed=e_assumed,
        notes=assumptions)
    limit_states.extend(j6_ls)
    warnings.extend(j6_warn)
    not_eval.extend(j6_ne)
    if j6_part2:
        p_ls, p_w, p_ne = _j6_second_part('paf', j6_part2, n, 1.10 * d, d, assumptions,
                                          include_block_shear=False)
        limit_states.extend(p_ls)
        warnings.extend(p_w)
        not_eval.extend(p_ne)
    assumptions.append(_part_basis_note('', t_crit, bool(j6_part2)))

    # (h) J5.4 조합 — Commentary Eq. C-J5.4-1 (Manual IV-12)
    interaction = []
    if Vu and Tu and Vu > 0 and Tu > 0:
        tens = [x for x in limit_states if x['direction'] == 'tension']
        shr = [x for x in limit_states if x['direction'] == 'shear']
        if (any(x['direction'] in ('tension', 'shear') and x['category'] == 'fastener' for x in not_eval)
                or any(x.get('assumed') for x in tens + shr) or not tens or not shr):
            not_eval.append(_ne('전단+인장 (J5.4)', 'interaction',
                                _nt('conn.reason.strength_not_settled_combined'),
                                'interaction'))
        else:
            gt = min(tens, key=lambda x: _available(x['Rn'], x['phi'], x['omega'], dm))
            gs = min(shr, key=lambda x: _available(x['Rn'], x['phi'], x['omega'], dm))
            Pat = _available(gt['Rn'], gt['phi'], gt['omega'], dm)
            Pav = _available(gs['Rn'], gs['phi'], gs['omega'], dm)
            p = 2 if (gt['name'].startswith('PAF Tension') and gs['name'].startswith('Pin Shear')) else 1
            val = (Tu / Pat) ** p + (Vu / Pav) ** p
            tr = Trace()
            i_p = tr.add('branch', None, equation='C-J5.4-1', inputs=[], result=None,
                         condition='exponent 2 when PAF tension and pin shear govern, else 1', holds=p == 2)
            i_v = tr.add('equation', f'(T/Pat)^{p} + (V/Pav)^{p}', equation='C-J5.4-1',
                         inputs=[_ui('T', Tu, 'force', 'Tu'),
                                 q('Pat', Pat, 'force', src('check', note=_nt('conn.note.governing_tension', name=gt['name']))),
                                 _ui('V', Vu, 'force', 'Vu'),
                                 q('Pav', Pav, 'force', src('check', note=_nt('conn.note.governing_shear', name=gs['name'])))],
                         result=q('value', val, 'dimensionless'))
            del i_p
            r_lin = val ** (1.0 / p)   # 지수 2 이면 √ — 선형 비와 견줄 수 있게(V6-06)
            interaction.append({'name': '전단+인장 (J5.4)', 'equation': f'C-J5.4-1 (n={p})',
                                'value': round(val, 4), 'limit': 1.0, 'ratio': round(r_lin, 4),
                                'ratio_form': _nt('conn.label.ratio_form_root_2') if p == 2 else _nt('conn.label.ratio_form_linear'),
                                'pass': val <= 1.0 + 1e-9, 'basis': 'Commentary C-J5.4 (A1.2)',
                                '_raw': {'value': val, 'limit': 1.0, 'ratio': r_lin, 'exponent': p},
                                '_trace': _interaction_trace(tr, i_v)})

    spec = ['J5.1', 'J5.2.1', 'J5.2.2', 'J5.2.3', 'J5.3.1', 'J5.3.2', 'J5.3.3', 'J6.1', 'J6.2']
    if Vu and Tu:
        spec.append('J5.4')
    return _finish('paf', limit_states, not_eval, warnings, dm, spec, None,
                   interaction, detailing, assumptions)


# ============================================================
# 디스패처
# ============================================================

_J6_GEOMETRY_KEYS = ('member_case', 'Usl', 'x_bar', 'L_conn', 'b1', 'b2', 'bf', 'bw',
                     'n_rows_long', 'pitch', 'edge_transverse', 'Agv_bs', 'Anv_bs', 'Ant_bs',
                     'Ant', 'Ag', 'width', 'g', 's_pitch', 'j6_3_not_applicable')

_KNOWN_KEYS = set(_J6_GEOMETRY_KEYS) | {
    'connection_type', 'design_method', 'Fy', 'Fu', 't1', 't2', 't_head', 't_far', 'Pu', 'Vu', 'Tu',
    'force_direction', 'd', 'da', 'Fub', 'e', 's', 'n', 'bolt_grade', 'threads_excluded', 'mf',
    'hole_type', 'pattern_length', 'member_tension', 'Ae', 'slot_orientation', 'washers',
    'shear_plane', 'consider_hole_deformation', 'Pnov_bolt', 'Fu1', 'Fu2', 'Fy1', 'Fy2', 'tc', 'dw',
    'Pnvs', 'Pnts', 'd_head_washer', 'weld_size', 'weld_length', 'L_seam', 'Fxx', 'load_direction',
    'w1', 'w2', 'E', 'joint', 't_sheets', 'de', 'application', 'eccentric_tension', 'sidelap',
    'groove_type', 'te', 'R', 'h', 'process', 'd1', 'd2', 'R2', 'seam_orientation', 'Fuf', 'dar',
    'Pnot_test', 'HRC_p', 'alpha_w', 'alpha_b', 'j6_part2', 'j45_rational', 'joint_type',
    # 상위 호출자(aisi_design/server)가 함께 보내는 키
    'member_type', 'units', 'action', 'section', 'props', 'dsm',
}


def design_connection(params: dict) -> dict:
    """접합부 설계 디스패처.

    소요강도(접합부 전체, kips):
        Vu: 면내 전단(접합력), Tu: 패스너 축방향 인장(상향)
        Pu: 과거 호환 — force_direction('shear' 기본 | 'tension') 방향의 소요강도.
            Vu/Tu 가 따로 있으면 그것을 쓴다.
    판정(FIXES §3.1): 평가한 검토 하나라도 불합격 → pass=False; 불합격은 없지만 해당하는데
    평가하지 못한 항목(not_evaluated)이 있으면 None; 모두 평가·만족이면 True.
    두께: 나사·PAF 의 t1 은 머리·와셔 쪽 부재. t_head/t_far 로 넘겨도 된다.

    필수 입력(없으면 오류, FIXES §3.1 — 계산의 뜻이 없어지는 입력은 기본값으로 채우지 않는다):
        connection_type, t1, t2, Fy, Fu; 그루브를 뺀 모든 유형의 n(패스너·용접 수, 필릿은 용접선 수);
        볼트·나사·PAF 의 d; 아크 스팟·시임의 da(또는 d); 필릿 weld_length 와 weld_size(또는 w1, w2);
        그루브 weld_length·groove_type, 버트(J2.1) 이음의 load_direction; 아크 시임 weld_length(또는 L_seam).
        예외: 아크 스팟·시임에 t_sheets(지지재 위 시트들)를 주고 시트-시트가 아니면 t2(지지재 두께)는
        강도식에 쓰이지 않으므로 없어도 된다(assumptions 에 적음).
    남는 기본값은 모두 보수 쪽이거나 기준이 정한 기본이며 assumptions 에 적는다
    (Fxx=60 최저 전극, 필릿 종방향, 플레어 종방향, 표준공, 편심·사이드랩 없음, 시임 하중직각, αw=1.5).
    """
    conn_type = params.get('connection_type')
    if conn_type is None:
        return {'error': 'connection_type 미입력 (bolt, screw, paf, fillet_weld, arc_spot, arc_seam, groove)'}
    try:
        design_method = normalize_design_method(params.get('design_method', 'LRFD'))
    except ValueError as exc:
        return {'error': str(exc)}

    t1 = params.get('t1')
    t2 = params.get('t2')
    if params.get('t_head') is not None or params.get('t_far') is not None:
        if (t1 is not None and params.get('t_head') is not None and abs(t1 - params['t_head']) > 1e-12) or \
           (t2 is not None and params.get('t_far') is not None and abs(t2 - params['t_far']) > 1e-12):
            return {'error': 't1/t2 와 t_head/t_far 가 서로 다름 — 하나만 넘기세요'}
        t1 = params.get('t_head', t1)
        t2 = params.get('t_far', t2)
    if t1 is None:
        if params.get('t') is not None:
            return {'error': "'t' 키는 쓰지 않습니다 — t1(및 t2)으로 두께를 넘기세요"}
        return {'error': 't1(두께) 미입력'}
    entry_notes = []
    if t2 is None:
        multi_sheet = (conn_type in ('arc_spot', 'arc_seam') and params.get('t_sheets')
                       and str(params.get('joint') or '').lower().replace('-', '_') != 'sheet_to_sheet')
        if not multi_sheet:
            return {'error': f'{conn_type}: t2(두 번째 접합 부재 두께) 미입력 — t2 = t1 로 가정하지 않는다 '
                             '(두 번째 판이 더 얇으면 비보수). 두 판 두께를 모두 넘기세요.'}
        # t_sheets 가 시트 두께를 주므로 지지재 두께는 J2.2.2.1·J2.2.3·J2.3.2.1 에 쓰이지 않는다.
        t2 = t1
        entry_notes.append(_nt('conn.assumption.j2_2_2_1_t2_not_used_with_t_sheets'))
    Fy = params.get('Fy')
    Fu = params.get('Fu')
    if Fy is None or Fu is None:
        return {'error': 'Fy, Fu(모재 강도) 미입력'}
    # 위치 · 조합(design.checks.CONTEXT_KEYS)은 설계 입력이 아니라 검토 항목에 붙이는 꼬리표다.
    unknown = sorted(k for k in params if k not in _KNOWN_KEYS and k not in CONTEXT_KEYS)

    force_dir = str(params.get('force_direction') or 'shear').strip().lower()
    if force_dir not in ('shear', 'tension'):
        return {'error': f"force_direction '{force_dir}': 'shear' 또는 'tension'"}
    Pu = params.get('Pu') or 0
    V = params.get('Vu')
    T = params.get('Tu')
    if Pu and Pu > 0:
        if force_dir == 'shear' and V is None:
            V = Pu
        elif force_dir == 'tension' and T is None:
            T = Pu
    V = abs(V) if V else 0.0
    T = abs(T) if T else 0.0
    n_raw = params.get('n')
    if conn_type == 'groove':
        n = 1   # groove_weld_connection 은 n 을 쓰지 않는다(용접 길이 L 로 정해짐)
    elif n_raw is None:
        what = '용접선 수' if conn_type == 'fillet_weld' else ('용접 수' if conn_type in ('arc_spot', 'arc_seam')
                                                             else '패스너 수')
        return {'error': f'{conn_type}: n({what}) 미입력 — 1 로 가정하지 않는다'}
    else:
        try:
            n_f = float(n_raw)
        except (TypeError, ValueError):
            return {'error': f'n={n_raw!r}: 정수가 아님'}
        if n_f < 1 or n_f != int(n_f):
            return {'error': f'n={n_raw}: 1 이상의 정수여야 함'}
        n = int(n_f)
    if conn_type == 'groove':
        if params.get('groove_type') is None:
            return {'error': "groove: groove_type 미입력 ('complete' | 'partial' | 'flare_bevel' | 'flare_v') — "
                             'CJP 로 가정하지 않는다'}
        is_flare = str(params['groove_type']).lower().startswith('flare')
        if params.get('load_direction') is None:
            if not is_flare:
                return {'error': "groove(J2.1): load_direction 미입력 ('tension'|'compression'|'shear') — "
                                 '전단이 인장보다 약하므로 가정하지 않는다'}
            entry_notes.append(_nt('conn.assumption.j2_6_load_direction_longitudinal'))
    if conn_type in ('fillet_weld', 'arc_spot', 'arc_seam', 'groove') and params.get('Fxx') is None:
        entry_notes.append(_nt('conn.assumption.e60_fxx_e60_ksi'))
    if conn_type == 'fillet_weld' and params.get('load_direction') is None:
        entry_notes.append(_nt('conn.assumption.j2_5_j2_load_direction'))
    if conn_type == 'bolt' and params.get('hole_type') is None:
        entry_notes.append(_nt('conn.assumption.j3_hole_type_standard'))
    if conn_type == 'arc_seam' and params.get('seam_orientation') is None:
        entry_notes.append(_nt('conn.assumption.j6_j6_seam_orientation_manual'))
    if conn_type == 'arc_spot' and T > 0:
        if params.get('eccentric_tension') is None:
            entry_notes.append(_nt('conn.assumption.j2_2_3_j2_eccentric_tension'))
        if params.get('sidelap') is None:
            entry_notes.append(_nt('conn.assumption.j2_2_3_j2_sidelap'))
    if conn_type == 'paf' and params.get('alpha_w') is None:
        entry_notes.append(_nt('conn.assumption.j5_2_3_j5_alpha_paf_fig'))
    geo = {k: params[k] for k in _J6_GEOMETRY_KEYS if params.get(k) is not None}

    def _need(key, alt=None):
        v = params.get(key)
        if v is None and alt is not None:
            v = params.get(alt)
        return v

    if conn_type in ('bolt', 'screw', 'paf') and params.get('d') is None:
        return {'error': f'{conn_type}: 패스너 직경 d 미입력'}

    if conn_type == 'bolt':
        result = bolt_connection(
            t1=t1, t2=t2, d=params['d'], Fy=Fy, Fu=Fu,
            Fub=params.get('Fub'),
            e=params.get('e'), s=params.get('s'), n=n,
            design_method=design_method,
            bolt_grade=params.get('bolt_grade'),
            threads_excluded=bool(params.get('threads_excluded', False)),
            mf=params.get('mf'),
            hole_type=params.get('hole_type', 'standard'),
            pattern_length=params.get('pattern_length'),
            Vu=V if (V or T) else None, Tu=T if T else None,
            member_tension=bool(params.get('member_tension', False)),
            Ae=params.get('Ae'),
            slot_orientation=params.get('slot_orientation'),
            washers=params.get('washers'), shear_plane=params.get('shear_plane'),
            consider_hole_deformation=bool(params.get('consider_hole_deformation', False)),
            Pnov_bolt=params.get('Pnov_bolt'),
            j6_geometry=geo,
            dw=params.get('dw'), j6_part2=params.get('j6_part2'),
        )
    elif conn_type == 'screw':
        result = screw_connection(
            t1=t1, t2=t2, d=params['d'], Fy=Fy, Fu=Fu,
            Fub=params.get('Fub'), n=n,
            design_method=design_method,
            Fu1=params.get('Fu1'), Fu2=params.get('Fu2'),
            tc=params.get('tc'), dw=params.get('dw'),
            e=params.get('e'),
            member_tension=bool(params.get('member_tension', False)),
            Ae=params.get('Ae'),
            Vu=V or None, Tu=T or None,
            Pnvs=params.get('Pnvs'), Pnts=params.get('Pnts'),
            Fy1=params.get('Fy1'), Fy2=params.get('Fy2'),
            d_head_washer=params.get('d_head_washer'), s=params.get('s'),
            j6_geometry=geo,
            j45_rational=bool(params.get('j45_rational', True)), j6_part2=params.get('j6_part2'),
        )
    elif conn_type == 'fillet_weld':
        if params.get('weld_length') is None or (params.get('weld_size') is None and
                                                 (params.get('w1') is None or params.get('w2') is None)):
            return {'error': 'fillet_weld: weld_length 와 weld_size(또는 w1, w2) 미입력'}
        result = fillet_weld_connection(
            t1=t1, t2=t2,
            weld_size=params.get('weld_size'),
            weld_length=params['weld_length'],
            Fy=Fy, Fu=Fu, Fxx=params.get('Fxx', 60),
            n_welds=n, design_method=design_method,
            load_direction=params.get('load_direction', 'longitudinal'),
            Fu1=params.get('Fu1'), Fu2=params.get('Fu2'),
            w1=params.get('w1'), w2=params.get('w2'),
            j6_geometry=geo,
            member_tension=bool(params.get('member_tension', False)),
            joint_type=params.get('joint_type', 'lap'),
        )
    elif conn_type == 'arc_spot':
        dvis = _need('da', 'd')
        if dvis is None:
            return {'error': 'arc_spot: 가시 직경 da(또는 d) 미입력'}
        result = arc_spot_weld_connection(
            t1=t1, t2=t2, da=dvis, Fy=Fy, Fu=Fu, Fxx=params.get('Fxx', 60), n=n,
            design_method=design_method, E=params.get('E', E_STEEL),
            Vu=V or None, Tu=T or None, joint=params.get('joint'), t_sheets=params.get('t_sheets'),
            de=params.get('de'), application=params.get('application', 'other'),
            eccentric_tension=bool(params.get('eccentric_tension', False)),
            sidelap=bool(params.get('sidelap', False)), e=params.get('e'),
            j6_geometry=geo, j6_part2=params.get('j6_part2'),
        )
    elif conn_type == 'groove':
        if params.get('weld_length') is None:
            return {'error': 'groove: weld_length 미입력'}
        result = groove_weld_connection(
            t1=t1, t2=t2, weld_length=params['weld_length'], Fy=Fy, Fu=Fu,
            Fxx=params.get('Fxx', 60), groove_type=params.get('groove_type', 'complete'),
            design_method=design_method, load_direction=params.get('load_direction', 'tension'),
            te=params.get('te'), w1=params.get('w1'), w2=params.get('w2'),
            R=params.get('R'), h=params.get('h'), process=params.get('process'),
            d1=params.get('d1'), d2=params.get('d2'), R2=params.get('R2'),
            j6_geometry=geo,
            member_tension=bool(params.get('member_tension', False)),
        )
    elif conn_type == 'arc_seam':
        dvis = _need('da', 'd')
        L_seam = _need('weld_length', 'L_seam')
        if dvis is None or L_seam is None:
            return {'error': 'arc_seam: 시임 폭 da(또는 d) 와 길이 weld_length(또는 L_seam) 미입력'}
        result = arc_seam_weld_connection(
            t1=t1, t2=t2, d=dvis, L_seam=L_seam, Fy=Fy, Fu=Fu, Fxx=params.get('Fxx', 60), n=n,
            design_method=design_method, Vu=V or None, Tu=T or None,
            joint=params.get('joint'), t_sheets=params.get('t_sheets'), e=params.get('e'),
            seam_orientation=params.get('seam_orientation', 'transverse'),
            j6_geometry=geo, j6_part2=params.get('j6_part2'),
        )
    elif conn_type == 'paf':
        result = paf_connection(
            t1=t1, t2=t2, d=params['d'], Fy=Fy, Fu=Fu,
            Fuf=params.get('Fuf', params.get('Fub')), n=n,
            design_method=design_method,
            Fy2=params.get('Fy2'), Fu1=params.get('Fu1'),
            dar=params.get('dar'), dw=params.get('dw'),
            Pnot_test=params.get('Pnot_test'), e=params.get('e'),
            Vu=V or None, Tu=T or None, HRC_p=params.get('HRC_p'),
            alpha_w=params.get('alpha_w', 1.5), alpha_b=params.get('alpha_b', 3.2),
            E=params.get('E', E_STEEL), s=params.get('s'),
            j6_geometry=geo, j6_part2=params.get('j6_part2'),
        )
    else:
        return {'error': f'Unknown connection_type: {conn_type}'}

    if result.get('error'):
        return result
    result['assumptions'].extend(entry_notes)
    if unknown:
        result['warnings'].append(_nt('conn.warning.unknown_input_keys', unknown=', '.join(unknown)))

    # 주 방향의 지배값을 기존 키(design_strength/governing_mode/Rn)에 둔다.
    if force_dir == 'tension' and result.get('tension_design_strength') is not None:
        gov = [x for x in result['limit_states'] if x.get('governs_tension')][0]
        for x in result['limit_states']:
            x.pop('governs', None)
        gov['governs'] = True
        result['governing_mode'] = gov['name']
        result['design_strength'] = gov['design_strength']
        result['Rn'] = gov['Rn']

    # 판정은 가정값 없이 평가한 한계상태(verified)로만 한다. 가정값 한계상태가 더 작으면 그 항목은
    # not_evaluated 에 있으므로 PASS 가 되지 않고, FAIL 은 제대로 평가한 한계상태에서만 나온다.
    # 비 · 판정은 반올림하지 않은 설계강도로(capacity 키는 표시용 소수 3자리).
    checks = []
    gov_raw = (result.get('_check_data') or {}).get('gov_raw') or {}
    if V > 0:
        cap = result.get('shear_verified_design_strength')
        if cap:
            cap_raw = gov_raw.get('shear_verified') or cap
            checks.append({'name': f"전단(면내) — {result['shear_verified_governing_mode']}",
                           'demand': round(V, 4), 'capacity': cap, 'ratio': round(V / cap_raw, 4),
                           'pass': V <= cap_raw + 1e-9})
        else:
            result['not_evaluated'].append(_ne('전단(면내) 강도', 'shear',
                                               _nt('conn.reason.no_verified_shear_limit_state'), 'scope'))
    if T > 0:
        cap = result.get('tension_verified_design_strength')
        if cap:
            cap_raw = gov_raw.get('tension_verified') or cap
            checks.append({'name': f"인장(축방향) — {result['tension_verified_governing_mode']}",
                           'demand': round(T, 4), 'capacity': cap, 'ratio': round(T / cap_raw, 4),
                           'pass': T <= cap_raw + 1e-9})
        elif not any(x['direction'] == 'tension' for x in result['not_evaluated']):
            result['not_evaluated'].append(_ne('인장(축방향) 강도', 'tension', _nt('conn.reason.no_evaluated_tension_limit_state'), 'scope'))
    ref = []
    for key, rkey, dem in (('shear_design_strength', 'shear', V), ('tension_design_strength', 'tension', T)):
        c = result.get(key)
        if dem > 0 and c:
            ref.append(dem / (gov_raw.get(rkey) or c))
    result['utilization_reference'] = round(max(ref), 4) if ref else None
    for ic in result.get('interaction_checks', []):
        checks.append({'name': ic['name'], 'demand': ic['value'], 'capacity': ic['limit'],
                       'ratio': ic['ratio'], 'pass': ic['pass']})
    for dc in result.get('detailing_checks', []):
        if not dc['pass']:
            checks.append({'name': dc['name'], 'demand': dc['required'], 'capacity': dc['provided'],
                           'ratio': None, 'pass': False})

    shear_rel = V > 0 or T == 0
    relevant = [x for x in result['not_evaluated']
                if x['direction'] == 'any'
                or (x['direction'] == 'shear' and shear_rel)
                or (x['direction'] == 'tension' and T > 0)
                or (x['direction'] == 'interaction' and V > 0 and T > 0)]
    if V > 0 and T > 0 and not result.get('interaction_checks') and \
            not any(x['direction'] == 'interaction' for x in result['not_evaluated']):
        relevant.append(_ne('전단+인장 조합', 'interaction', _nt('conn.reason.combined_check_not_implemented'),
                            'interaction'))
    if V > 0 and T == 0:
        result['assumptions'].append(_nt('conn.assumption.tension_demand_not_given'))

    ratios = [c['ratio'] for c in checks if c['ratio'] is not None]
    result['checks'] = checks
    result['utilization'] = round(max(ratios), 4) if ratios else None
    evaluated_pass = None if not checks else all(c['pass'] for c in checks)
    result['evaluated_pass'] = evaluated_pass
    result['not_evaluated_relevant'] = relevant
    result['verification_complete'] = not relevant
    if evaluated_pass is False:
        result['pass'] = False
    elif relevant or not checks:
        result['pass'] = None
    else:
        result['pass'] = True
    result['verdict'] = ('PASS' if result['pass'] is True
                         else ('FAIL' if result['pass'] is False else 'NOT_CHECKED'))
    result['demands'] = {'Vu': round(V, 4), 'Tu': round(T, 4), 'force_direction': force_dir}
    result['member_type'] = 'connection'
    result['design_method'] = design_method
    from design.connection_checks import build as _build_checks
    result['design_checks'] = _build_checks(result, result.pop('_check_data'), V, T, params)
    result['display_rounding'] = display_rounding('connection')
    _attach_notices(result)
    return result
