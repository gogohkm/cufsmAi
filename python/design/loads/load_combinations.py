"""ASCE/SEI 7 하중조합 엔진

ASD 및 LRFD 하중조합을 자동 선별하고 적용한다.
AISI S100-16 예제에서 사용하는 ASCE/SEI 7-10 기준.
"""


# ---------------------------------------------------------------------------
# 하중조합 정의
# ---------------------------------------------------------------------------

# ASD (Allowable Strength Design) — ASCE 7 Section 2.4.1
ASD_COMBOS = [
    ('1: D',                   {'D': 1.0}),
    ('2: D+L',                 {'D': 1.0, 'L': 1.0}),
    ('3: D+Lr',                {'D': 1.0, 'Lr': 1.0}),
    ('3: D+S',                 {'D': 1.0, 'S': 1.0}),
    ('3: D+R',                 {'D': 1.0, 'R': 1.0}),
    ('4: D+0.75L+0.75Lr',     {'D': 1.0, 'L': 0.75, 'Lr': 0.75}),
    ('4: D+0.75L+0.75S',      {'D': 1.0, 'L': 0.75, 'S': 0.75}),
    ('5: D+0.6W',             {'D': 1.0, 'W': 0.6}),
    ('6: D+0.75L+0.75(0.6W)+0.75Lr',
     {'D': 1.0, 'L': 0.75, 'W': 0.45, 'Lr': 0.75}),
    ('6: D+0.75L+0.75(0.6W)+0.75S',
     {'D': 1.0, 'L': 0.75, 'W': 0.45, 'S': 0.75}),
    ('7: 0.6D+0.6W',          {'D': 0.6, 'W': 0.6}),
    ('8: D+0.7E',             {'D': 1.0, 'E': 0.7}),
    ('9: D+0.75L+0.75(0.7E)+0.75S',
     {'D': 1.0, 'L': 0.75, 'E': 0.525, 'S': 0.75}),
    ('10: 0.6D+0.7E',         {'D': 0.6, 'E': 0.7}),
]

# LRFD (Load and Resistance Factor Design) — ASCE 7 Section 2.3.1
LRFD_COMBOS = [
    ('1: 1.4D',                      {'D': 1.4}),
    ('2: 1.2D+1.6L+0.5Lr',          {'D': 1.2, 'L': 1.6, 'Lr': 0.5}),
    ('2: 1.2D+1.6L+0.5S',           {'D': 1.2, 'L': 1.6, 'S': 0.5}),
    ('3: 1.2D+1.6Lr',               {'D': 1.2, 'Lr': 1.6}),
    ('3: 1.2D+1.6Lr+L',             {'D': 1.2, 'Lr': 1.6, 'L': 1.0}),
    ('3: 1.2D+1.6Lr+0.5W',          {'D': 1.2, 'Lr': 1.6, 'W': 0.5}),
    ('3: 1.2D+1.6S',                {'D': 1.2, 'S': 1.6}),
    ('3: 1.2D+1.6S+L',              {'D': 1.2, 'S': 1.6, 'L': 1.0}),
    ('3: 1.2D+1.6S+0.5W',           {'D': 1.2, 'S': 1.6, 'W': 0.5}),
    ('4: 1.2D+1.0W+L+0.5Lr',        {'D': 1.2, 'W': 1.0, 'L': 1.0, 'Lr': 0.5}),
    ('4: 1.2D+1.0W+L+0.5S',         {'D': 1.2, 'W': 1.0, 'L': 1.0, 'S': 0.5}),
    ('6: 0.9D+1.0W',                {'D': 0.9, 'W': 1.0}),
    ('5: 1.2D+1.0E+L+0.2S',         {'D': 1.2, 'E': 1.0, 'L': 1.0, 'S': 0.2}),
    ('7: 0.9D+1.0E',                {'D': 0.9, 'E': 1.0}),
]


def get_applicable_combos(loads: dict, method: str = 'LRFD') -> list:
    """입력된 하중 종류에 따라 관련 하중조합만 필터링

    Parameters
    ----------
    loads : dict
        하중값. 예: {'D': 15, 'Lr': 90, 'W': -144}
        값이 0 또는 없으면 해당 하중 미적용.
    method : str
        'ASD' 또는 'LRFD'

    Returns
    -------
    list of (name, factors_dict)
    """
    base = LRFD_COMBOS if method == 'LRFD' else ASD_COMBOS
    present = {k for k, v in loads.items() if v is not None and v != 0}
    # D는 항상 존재한다고 가정
    present.add('D')

    result = []
    for name, factors in base:
        # 조합에 필요한 하중 유형이 모두 present 에 있는 경우만 포함
        needed = set(factors.keys())
        if needed <= present:
            result.append((name, factors))
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

    for load_type, factor in factors.items():
        res = load_results.get(load_type)
        if res is None:
            continue
        M = res.get('M', [])
        V = res.get('V', [])
        R = res.get('R', [])

        if combined_M is None:
            combined_M = [0.0] * len(M)
            combined_V = [0.0] * len(V)
            combined_R = [0.0] * len(R)

        for i in range(len(M)):
            combined_M[i] += factor * M[i]
        for i in range(len(V)):
            combined_V[i] += factor * V[i]
        for i in range(len(R)):
            combined_R[i] += factor * R[i]

    return {
        'M': combined_M or [],
        'V': combined_V or [],
        'R': combined_R or [],
    }


def find_controlling_combo(loads: dict, load_results: dict,
                           method: str = 'LRFD') -> dict:
    """모든 적용 가능한 하중조합을 적용하여 지배 조합을 결정

    Returns
    -------
    dict with keys:
        'gravity': (name, combined) — |M|max가 최대인 중력 조합
        'uplift': (name, combined) — M이 최소(음수)인 양력 조합
        'all': list of (name, combined)
    """
    combos = get_applicable_combos(loads, method)

    all_results = []
    for name, factors in combos:
        combined = apply_combination(factors, load_results)
        all_results.append((name, factors, combined))

    # 중력 조합: D ��수 ≥ 1.0 (1.2D+1.6Lr 등)
    # 양력 조합: D 계수 < 1.0 (0.9D+1.0W 등)
    gravity = None
    gravity_max = 0
    uplift = None
    uplift_min = 0

    for name, factors, combined in all_results:
        M = combined.get('M', [])
        if not M:
            continue
        max_abs = max(abs(m) for m in M)
        min_m = min(M)

        d_factor = factors.get('D', 0)
        w_factor = factors.get('W', 0)
        is_uplift_combo = (d_factor < 1.0 and w_factor != 0)

        if not is_uplift_combo and max_abs > gravity_max:
            gravity_max = max_abs
            gravity = (name, combined)

        if is_uplift_combo and min_m < uplift_min:
            uplift_min = min_m
            uplift = (name, combined)

    return {
        'gravity': gravity,
        'uplift': uplift,
        'all': [(n, c) for n, _, c in all_results],
    }
