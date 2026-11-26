"""ASCE/SEI 7 하중조합 엔진

ASD 및 LRFD 하중조합을 자동 선별하고 적용한다.
처음 값(asce7_10)의 계수는 AISI S100-16 설계매뉴얼 예제가 쓰는 ASCE/SEI 7-10 의 기본조합이다
(7-10 Sec. 2.3.2 LRFD / Sec. 2.4.1 ASD). 고를 수 있는 것(결정 R4): ASCE/SEI 7-22(Sec. 2.3.1 · 2.3.6 ·
2.4.1 · 2.4.5 — 적설 1.0S · 0.3S · 0.7S), KDS 41 12 00:2022(1.7.1 · 1.7.2 — 허용응력 풍하중 0.65W).
ASCE/SEI 7-16 은 조합표를 원문으로 확인하지 못해 넣지 않았다. LSD(NBCC) 조합은 없다.

선별 규칙 (7-10 Sec. 2.3.2 / 2.4.1 "Effects of one or more loads not acting shall
be considered"): 없는 하중은 0 으로 둔다. 조합은 지우지 않고 없는 항만 뺀다.
줄어든 계수 집합이 같아진 조합은 하나로 합친다.
"""

import re
from design.notices import N as _nt  # noqa: E402


LOAD_COMBINATION_EDITION = 'ASCE/SEI 7-10'
LOAD_COMBINATION_REFERENCE = {
    'LRFD': _nt('loads.label.combo_ref_lrfd'),
    'ASD': _nt('loads.label.combo_ref_asd'),
}

# 하중조합 기준(결정 R4, 2026-11-25). 처음 값 asce7_10 — 지금까지의 결과 그대로.
DEFAULT_LOAD_COMBINATION_STANDARD = 'asce7_10'
LOAD_COMBINATION_STANDARDS = ('asce7_10', 'asce7_22', 'kds_41_12_00')
# 고를 수 있게 요청받았지만 조합표를 이 판에서 원문으로 확인하지 못해 넣지 않은 것 — 지어내지 않는다.
_UNVERIFIED_STANDARDS = {
    'asce7_16': 'the ASCE/SEI 7-16 Sec. 2.3.1 / 2.3.6 / 2.4.1 / 2.4.5 tables could not be checked against the '
                'standard for this build, so they are not implemented',
}


def normalize_load_combination_standard(value) -> str:
    """하중조합 기준 키. None · 빈 값은 처음 값(asce7_10). 모르는 값은 허용값을 밝히는 ValueError."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return DEFAULT_LOAD_COMBINATION_STANDARD
    key = str(value).strip().lower().replace('-', '_').replace(' ', '_')
    if key in LOAD_COMBINATION_STANDARDS:
        return key
    allowed = ', '.join(repr(k) for k in LOAD_COMBINATION_STANDARDS)
    if key in _UNVERIFIED_STANDARDS:
        raise ValueError(f'load_combination_standard {value!r} is not available: '
                         f'{_UNVERIFIED_STANDARDS[key]}. Allowed values: {allowed}.')
    raise ValueError(f'Unknown load_combination_standard {value!r}. Allowed values: {allowed} '
                     f'(default {DEFAULT_LOAD_COMBINATION_STANDARD!r}).')

# 조합표에 나오는 하중 기호. 이 밖의 키(예: 'Wp')는 조합 선별에 쓰지 않는다.
LOAD_SYMBOLS = ('D', 'L', 'Lr', 'S', 'R', 'W', 'E')

# 부분재하 대상 — L: ASCE 7 Sec. 4.3.3 (어느 일부 재하든), Lr: Sec. 4.3.3/4.3.3.1
# (인접·교번 경간), S: Sec. 7.5 (전/반 재하 경우들).
PATTERNED_LIVE_LOADS = ('L', 'Lr')
PATTERNED_SNOW_LOADS = ('S',)


def normalize_design_method(method) -> str:
    """'LRFD' / 'ASD' 만 받는다. 그 밖의 값은 조용히 ASD 로 두지 않고 거절한다."""
    m = str(method).strip().upper() if method is not None else ''
    if m not in ('LRFD', 'ASD'):
        raise ValueError(
            f"Unsupported design_method {method!r}: use 'LRFD' or 'ASD' "
            f"({LOAD_COMBINATION_EDITION} combinations). LSD (NBCC) combinations are not implemented."
        )
    return m


def snow_partial_cases(n_spans: int) -> list:
    """ASCE 7 Sec. 7.5.1 연속보 부분재하 경우 (경간별 배율 벡터).

    균형하중 전경간 재하에 더해
      1. 어느 한 외측경간 full, 나머지 half
      2. 어느 한 외측경간 half, 나머지 full
      3. 인접한 두 경간 full, 나머지 half (n-1 경우)
    캔틸레버(내민) 경간도 한 경간으로 본다(Sec. 7.5.1). 같은 벡터는 한 번만 둔다.
    """
    n = int(n_spans)
    cases = [(_nt('loads.label.snow_balanced'), [1.0] * n)]
    if n < 2:
        return cases
    for side, k in ((_nt('loads.fragment.side_left'), 0), (_nt('loads.fragment.side_right'), n - 1)):
        v = [0.5] * n
        v[k] = 1.0
        cases.append((_nt('loads.label.snow_case1', side=side), v))
        v = [1.0] * n
        v[k] = 0.5
        cases.append((_nt('loads.label.snow_case2', side=side), v))
    for k in range(n - 1):
        v = [0.5] * n
        v[k] = v[k + 1] = 1.0
        cases.append((_nt('loads.label.snow_case3', s1=k + 1, s2=k + 2), v))
    unique, seen = [], set()
    for name, v in cases:
        key = tuple(v)
        if key in seen:
            continue
        seen.add(key)
        unique.append((name, v))
    return unique


# ---------------------------------------------------------------------------
# 하중조합 정의
# ---------------------------------------------------------------------------

# ASCE 7 의 지붕 대체하중 그룹 (Lr or S or R) — 세 하중은 동일하게 취급된다.
# 한 곳에서만 나열해 향후 편집 시 한 종류가 누락되는 것을 방지한다.
_ROOF_ALT = ('Lr', 'S', 'R')


def _expand_roof_alt(template_name, base_factors, roof_factor):
    """(Lr or S or R) 그룹을 세 하중 각각에 대해 동일하게 전개한다.

    template_name 안의 '{r}' 를 각 지붕하중 기호로 치환한다.
    """
    rows = []
    for r in _ROOF_ALT:
        factors = dict(base_factors)
        factors[r] = roof_factor
        rows.append((template_name.format(r=r), factors))
    return rows


# ASD (Allowable Strength Design) — ASCE 7 Section 2.4.1
ASD_COMBOS = [
    ('1: D',                   {'D': 1.0}),
    ('2: D+L',                 {'D': 1.0, 'L': 1.0}),
    # 3: D + (Lr or S or R)  — ASCE 7-10 Eq. 2.4-3
    *_expand_roof_alt('3: D+{r}', {'D': 1.0}, 1.0),
    # 4: D + 0.75L + 0.75(Lr or S or R)  — ASCE 7-10 Eq. 2.4-4
    *_expand_roof_alt('4: D+0.75L+0.75{r}', {'D': 1.0, 'L': 0.75}, 0.75),
    # 5: D + (0.6W or 0.7E)  — ASCE 7-10 Eq. 2.4-5 (번호는 7-10 §2.4.1 그대로)
    ('5: D+0.6W',             {'D': 1.0, 'W': 0.6}),
    # 6a: D + 0.75L + 0.75(0.6W) + 0.75(Lr or S or R)  — ASCE 7-10 Eq. 2.4-6a
    *_expand_roof_alt('6a: D+0.75L+0.75(0.6W)+0.75{r}',
                      {'D': 1.0, 'L': 0.75, 'W': 0.45}, 0.75),
    ('7: 0.6D+0.6W',          {'D': 0.6, 'W': 0.6}),
    ('5: D+0.7E',             {'D': 1.0, 'E': 0.7}),
    # 6b: D + 0.75L + 0.75(0.7E) + 0.75S  — ASCE 7-10 Eq. 2.4-6b
    ('6b: D+0.75L+0.75(0.7E)+0.75S',
     {'D': 1.0, 'L': 0.75, 'E': 0.525, 'S': 0.75}),
    # 8: 0.6D + 0.7E  — ASCE 7-10 Eq. 2.4-8
    ('8: 0.6D+0.7E',          {'D': 0.6, 'E': 0.7}),
]

# LRFD (Load and Resistance Factor Design) — ASCE 7 Section 2.3.1
LRFD_COMBOS = [
    ('1: 1.4D',                      {'D': 1.4}),
    ('2: 1.2D+1.6L',                {'D': 1.2, 'L': 1.6}),
    # 2: 1.2D + 1.6L + 0.5(Lr or S or R)  — ASCE 7-10 Eq. 2.3-2
    *_expand_roof_alt('2: 1.2D+1.6L+0.5{r}', {'D': 1.2, 'L': 1.6}, 0.5),
    # 3: 1.2D + 1.6(Lr or S or R)  — ASCE 7-10 Eq. 2.3-3 (with L or 0.5W companion)
    *_expand_roof_alt('3: 1.2D+1.6{r}', {'D': 1.2}, 1.6),
    *_expand_roof_alt('3: 1.2D+1.6{r}+L', {'D': 1.2, 'L': 1.0}, 1.6),
    *_expand_roof_alt('3: 1.2D+1.6{r}+0.5W', {'D': 1.2, 'W': 0.5}, 1.6),
    # 4: 1.2D + 1.0W + L + 0.5(Lr or S or R)  — ASCE 7-10 Eq. 2.3-4
    *_expand_roof_alt('4: 1.2D+1.0W+L+0.5{r}',
                      {'D': 1.2, 'W': 1.0, 'L': 1.0}, 0.5),
    ('6: 0.9D+1.0W',                {'D': 0.9, 'W': 1.0}),
    ('5: 1.2D+1.0E+L+0.2S',         {'D': 1.2, 'E': 1.0, 'L': 1.0, 'S': 0.2}),
    ('7: 0.9D+1.0E',                {'D': 0.9, 'E': 1.0}),
]


def _expand_alt(template_name, base_factors, alt_factors):
    """(Lr 또는 S 또는 R) 무리를 하중마다 다른 계수로 전개한다(ASCE 7-22: 0.5Lr 또는 0.3S 또는 0.5R).

    template_name 안의 '{t}' 를 그 항의 글(계수 + 기호, 계수 1 이면 기호만)로 바꾼다.
    """
    rows = []
    for r in _ROOF_ALT:
        f = alt_factors[r]
        factors = dict(base_factors)
        factors[r] = f
        txt = r if f == 1.0 else f'{f:g}{r}'
        rows.append((template_name.format(t=txt), factors))
    return rows


# ---------------------------------------------------------------------------
# ASCE/SEI 7-22 — Sec. 2.3.1 (1a–5a), 2.3.6 (6, 7), 2.4.1 (1a–7a), 2.4.5 (8–10).
# 출처: asce7-loads-design 스킬 data/Chapter_02_Combinations_of_Loads.md (스킬의 원본 대조 범위 안의 쪽).
# W_T(토네이도) · F · H · 홍수 · 착빙 항은 엔진의 하중에 없어 넣지 않는다. E 는 사용자가 준 지진하중 효과 하나
# (Ev + Eh 를 하중 방향으로 합한 값)로 쓴다 — 7-10 과 같다. 예외 1(L 계수 0.5)은 쓰지 않는다(보수측).
# ---------------------------------------------------------------------------
_LR22_COMPANION = {'Lr': 0.5, 'S': 0.3, 'R': 0.5}
_LR22_PRINCIPAL = {'Lr': 1.6, 'S': 1.0, 'R': 1.6}
LRFD_COMBOS_ASCE7_22 = [
    ('1a: 1.4D',                    {'D': 1.4}),
    ('2a: 1.2D+1.6L',               {'D': 1.2, 'L': 1.6}),
    *_expand_alt('2a: 1.2D+1.6L+{t}', {'D': 1.2, 'L': 1.6}, _LR22_COMPANION),
    *_expand_alt('3a: 1.2D+{t}', {'D': 1.2}, _LR22_PRINCIPAL),
    *_expand_alt('3a: 1.2D+{t}+L', {'D': 1.2, 'L': 1.0}, _LR22_PRINCIPAL),
    *_expand_alt('3a: 1.2D+{t}+0.5W', {'D': 1.2, 'W': 0.5}, _LR22_PRINCIPAL),
    *_expand_alt('4a: 1.2D+1.0W+L+{t}', {'D': 1.2, 'W': 1.0, 'L': 1.0}, _LR22_COMPANION),
    ('5a: 0.9D+1.0W',               {'D': 0.9, 'W': 1.0}),
    ('6: 1.2D+1.0E+L+0.15S',        {'D': 1.2, 'E': 1.0, 'L': 1.0, 'S': 0.15}),
    ('7: 0.9D+1.0E',                {'D': 0.9, 'E': 1.0}),
]
_ASD22_ALT = {'Lr': 1.0, 'S': 0.7, 'R': 1.0}
_ASD22_ALT_075 = {'Lr': 0.75, 'S': 0.525, 'R': 0.75}      # 0.75(Lr 또는 0.7S 또는 R)
ASD_COMBOS_ASCE7_22 = [
    ('1a: D',                       {'D': 1.0}),
    ('2a: D+L',                     {'D': 1.0, 'L': 1.0}),
    *_expand_alt('3a: D+{t}', {'D': 1.0}, _ASD22_ALT),
    *_expand_alt('4a: D+0.75L+{t}', {'D': 1.0, 'L': 0.75}, _ASD22_ALT_075),
    ('5a: D+0.6W',                  {'D': 1.0, 'W': 0.6}),
    *_expand_alt('6a: D+0.75L+0.75(0.6W)+{t}', {'D': 1.0, 'L': 0.75, 'W': 0.45}, _ASD22_ALT_075),
    ('7a: 0.6D+0.6W',               {'D': 0.6, 'W': 0.6}),
    ('8: D+0.7E',                   {'D': 1.0, 'E': 0.7}),
    ('9: D+0.525E+0.75L+0.1S',      {'D': 1.0, 'E': 0.525, 'L': 0.75, 'S': 0.1}),
    ('10: 0.6D+0.7E',               {'D': 0.6, 'E': 0.7}),
]

# ---------------------------------------------------------------------------
# KDS 41 12 00:2022 — 1.7.1 식(1.7-1)–(1.7-7), 1.7.2 식(1.7-8)–(1.7-15).
# 출처: kds-structural-design 스킬 data/standards/KDS_41_12_00.md 와 원본 PDF 13 · 14쪽(렌더해 대조).
# F · T · H 항은 엔진의 하중에 없어 넣지 않는다. 1.7.1 (2) 의 L 계수 0.5 는 쓰지 않는다(보수측).
# ---------------------------------------------------------------------------
_KDS_ALT_05 = {'Lr': 0.5, 'S': 0.5, 'R': 0.5}
_KDS_ALT_16 = {'Lr': 1.6, 'S': 1.6, 'R': 1.6}
_KDS_ALT_10 = {'Lr': 1.0, 'S': 1.0, 'R': 1.0}
_KDS_ALT_075 = {'Lr': 0.75, 'S': 0.75, 'R': 0.75}
LRFD_COMBOS_KDS = [
    ('1.7-1: 1.4D',                 {'D': 1.4}),
    ('1.7-2: 1.2D+1.6L',            {'D': 1.2, 'L': 1.6}),
    *_expand_alt('1.7-2: 1.2D+1.6L+{t}', {'D': 1.2, 'L': 1.6}, _KDS_ALT_05),
    *_expand_alt('1.7-3: 1.2D+{t}', {'D': 1.2}, _KDS_ALT_16),
    *_expand_alt('1.7-3: 1.2D+{t}+1.0L', {'D': 1.2, 'L': 1.0}, _KDS_ALT_16),
    *_expand_alt('1.7-3: 1.2D+{t}+0.5W', {'D': 1.2, 'W': 0.5}, _KDS_ALT_16),
    *_expand_alt('1.7-4: 1.2D+1.0W+1.0L+{t}', {'D': 1.2, 'W': 1.0, 'L': 1.0}, _KDS_ALT_05),
    ('1.7-5: 1.2D+1.0E+1.0L+0.2S',  {'D': 1.2, 'E': 1.0, 'L': 1.0, 'S': 0.2}),
    ('1.7-6: 0.9D+1.0W',            {'D': 0.9, 'W': 1.0}),
    ('1.7-7: 0.9D+1.0E',            {'D': 0.9, 'E': 1.0}),
]
ASD_COMBOS_KDS = [
    ('1.7-8: D',                    {'D': 1.0}),
    ('1.7-9: D+L',                  {'D': 1.0, 'L': 1.0}),
    *_expand_alt('1.7-10: D+{t}', {'D': 1.0}, _KDS_ALT_10),
    *_expand_alt('1.7-11: D+0.75L+{t}', {'D': 1.0, 'L': 0.75}, _KDS_ALT_075),
    ('1.7-12: D+0.65W',             {'D': 1.0, 'W': 0.65}),
    ('1.7-12: D+0.7E',              {'D': 1.0, 'E': 0.7}),
    *_expand_alt('1.7-13: D+0.75(0.65W)+0.75L+{t}', {'D': 1.0, 'W': 0.4875, 'L': 0.75}, _KDS_ALT_075),
    *_expand_alt('1.7-13: D+0.75(0.7E)+0.75L+{t}', {'D': 1.0, 'E': 0.525, 'L': 0.75}, _KDS_ALT_075),
    ('1.7-14: 0.6D+0.65W',          {'D': 0.6, 'W': 0.65}),
    ('1.7-15: 0.6D+0.7E',           {'D': 0.6, 'E': 0.7}),
]

# 기준별 조합표 · 판 · 근거 글 · 넣은 하중의 정의를 밝히는 알림
STANDARD_TABLES = {
    'asce7_10': {'edition': LOAD_COMBINATION_EDITION, 'LRFD': LRFD_COMBOS, 'ASD': ASD_COMBOS,
                 'reference': LOAD_COMBINATION_REFERENCE, 'load_definition': None},
    'asce7_22': {'edition': 'ASCE/SEI 7-22', 'LRFD': LRFD_COMBOS_ASCE7_22, 'ASD': ASD_COMBOS_ASCE7_22,
                 'reference': {'LRFD': _nt('loads.label.combo_ref_lrfd_asce7_22'),
                               'ASD': _nt('loads.label.combo_ref_asd_asce7_22')},
                 'load_definition': _nt('loads.assumption.load_definition_asce7_22')},
    'kds_41_12_00': {'edition': 'KDS 41 12 00:2022', 'LRFD': LRFD_COMBOS_KDS, 'ASD': ASD_COMBOS_KDS,
                     'reference': {'LRFD': _nt('loads.label.combo_ref_lrfd_kds'),
                                   'ASD': _nt('loads.label.combo_ref_asd_kds')},
                     'load_definition': _nt('loads.assumption.load_definition_kds')},
}


_TERM_LOAD_RE = re.compile(r'(Lr|D|L|S|R|W|E)\)*$')


def _reduced_combo_name(name: str, present: set) -> str:
    """'4: 1.2D+1.0W+L+0.5Lr' 에서 없는 하중의 항을 뺀 이름."""
    num, _, expr = name.partition(':')
    kept = []
    for term in expr.strip().split('+'):
        m = _TERM_LOAD_RE.search(term.strip())
        if m and m.group(1) in present:
            kept.append(term.strip())
    return f'{num}: ' + '+'.join(kept)


def get_applicable_combos(loads: dict, method: str = 'LRFD', standard: str = None) -> list:
    """입력된 하중으로 평가할 하중조합 목록

    없는 하중(0 또는 None)은 계수 0 으로 보고 그 항만 뺀다. 조합 자체는 지우지
    않는다(예: L 이 없는 지붕 퍼린의 LRFD 4 → 1.2D+1.0W+0.5Lr). 줄어든 계수
    집합이 같은 조합은 처음 것 하나로 합친다. D 는 언제나 있는 것으로 본다.

    Parameters
    ----------
    loads : dict
        하중값. 예: {'D': 15, 'Lr': 90, 'W': -144}
    method : str
        'ASD' 또는 'LRFD' (대소문자 무관). 그 밖의 값은 ValueError.
    standard : str
        하중조합 기준 — LOAD_COMBINATION_STANDARDS 가운데 하나(None 이면 처음 값 'asce7_10').

    Returns
    -------
    list of (name, factors_dict) — factors 에는 있는 하중만 들어 있다.
    """
    method = normalize_design_method(method)
    base = STANDARD_TABLES[normalize_load_combination_standard(standard)][method]
    present = {k for k, v in (loads or {}).items()
               if k in LOAD_SYMBOLS and v is not None and v != 0}
    present.add('D')

    result = []
    seen = set()
    for name, factors in base:
        reduced = {k: f for k, f in factors.items() if k in present}
        if not reduced:
            continue
        key = tuple(sorted(reduced.items()))
        if key in seen:
            continue
        seen.add(key)
        result.append((_reduced_combo_name(name, present), reduced))
    return result


def apply_combination(factors: dict, load_results: dict) -> dict:
    """하중조합 계수를 각 하중 케이스 해석 결과에 적용

    Parameters
    ----------
    factors : dict
        하중 계수. 예: {'D': 1.2, 'Lr': 1.6}
    load_results : dict
        각 하중 케이스별 해석 결과.
        예: {'D': {'M': [...], 'V': [...], 'R': [...]},
             'Lr': {'M': [...], ...}}
        M, V, R은 동일 길이의 리스트(같은 x 좌표).

    Returns
    -------
    dict with combined 'M', 'V', 'R' 리스트
    """
    combined_M = None
    combined_V = None
    combined_R = None
    combined_D = None
    combined_x = None

    for load_type, factor in factors.items():
        res = load_results.get(load_type)
        if res is None:
            continue
        M = res.get('M', [])
        V = res.get('V', [])
        R = res.get('R', [])
        D = res.get('D', [])

        if combined_x is None:
            combined_x = res.get('x', [])

        if combined_M is None:
            combined_M = [0.0] * len(M)
            combined_V = [0.0] * len(V)
            combined_R = [0.0] * len(R)
            if D:
                combined_D = [0.0] * len(D)

        for i in range(len(M)):
            combined_M[i] += factor * M[i]
        for i in range(len(V)):
            combined_V[i] += factor * V[i]
        for i in range(len(R)):
            combined_R[i] += factor * R[i]
        # 처짐(D)도 선형 조합 — FE 해석에서 이미 랩 효과가 반영된 D를 직접 합산
        if D and combined_D is not None:
            for i in range(min(len(D), len(combined_D))):
                combined_D[i] += factor * D[i]

    return {
        'x': combined_x or [],
        'M': combined_M or [],
        'V': combined_V or [],
        'R': combined_R or [],
        'D': combined_D or [],
    }


def find_controlling_combo(loads: dict, load_results: dict,
                           method: str = 'LRFD', standard: str = None) -> dict:
    """모든 적용 가능한 하중조합을 적용하여 지배 조합을 결정

    Returns
    -------
    dict with keys:
        'gravity': (name, combined) — |M|max가 최대인 중력 조합
        'uplift': (name, combined) — M이 최소(음수)인 양력 조합
        'all': list of (name, combined)
        'all_detail': list of dicts — 모든 조합의 상세 결과
    """
    combos = get_applicable_combos(loads, method, standard)

    all_results = []
    for name, factors in combos:
        combined = apply_combination(factors, load_results)
        all_results.append((name, factors, combined))

    gravity = None
    gravity_max = 0
    uplift = None
    uplift_min = 0

    all_detail = []

    for name, factors, combined in all_results:
        M = combined.get('M', [])
        V = combined.get('V', [])
        R = combined.get('R', [])
        if not M:
            continue

        max_M = max(M)
        min_M = min(M)
        max_abs_M = max(abs(m) for m in M)
        max_abs_V = max(abs(v) for v in V) if V else 0
        max_R = max(abs(r) for r in R) if R else 0

        d_factor = factors.get('D', 0)
        w_factor = factors.get('W', 0)
        has_uplift_wind = (loads.get('W') or 0) < 0 and w_factor != 0
        combined_R = combined.get('R', [])
        has_net_uplift_R = any(r < 0 for r in combined_R) if combined_R else False
        is_uplift = bool(
            has_uplift_wind
            and min_M < 0
            and (has_net_uplift_R or d_factor < 1.0 or abs(min_M) >= max_M)
        )

        detail = {
            'name': name,
            'factors': factors,
            'max_pos_M': round(max_M, 3),
            'max_neg_M': round(min_M, 3),
            'max_abs_M': round(max_abs_M, 3),
            'max_abs_V': round(max_abs_V, 3),
            'max_R': round(max_R, 3),
            'is_uplift': is_uplift,
            'governs_gravity': False,
            'governs_uplift': False,
            'governs_overall': False,
        }
        all_detail.append(detail)

        if not is_uplift and max_abs_M > gravity_max:
            gravity_max = max_abs_M
            gravity = (name, combined)

        if is_uplift and min_M < uplift_min:
            uplift_min = min_M
            uplift = (name, combined)

    # 전체 조합 중 절대 최대 |M|인 지배 조합
    overall = None
    overall_max = 0
    for name, factors, combined in all_results:
        M = combined.get('M', [])
        if M:
            abs_max = max(abs(m) for m in M)
            if abs_max > overall_max:
                overall_max = abs_max
                overall = (name, combined)

    # 지배 조합 표시
    for d in all_detail:
        if gravity and d['name'] == gravity[0]:
            d['governs_gravity'] = True
        if uplift and d['name'] == uplift[0]:
            d['governs_uplift'] = True
        if overall and d['name'] == overall[0]:
            d['governs_overall'] = True

    return {
        'gravity': gravity,
        'uplift': uplift,
        'overall': overall,
        'all': [(n, c) for n, _, c in all_results],
        'all_detail': all_detail,
    }
