"""2026-11-22 엔진 리뷰 — 접합부(R6) · special_topics(R5-20 – R5-24) 회귀 시험 (F6).

기대값은 AISI Cold-Formed Steel Design Manual 2017 의 인쇄값(Example IV-1, IV-2, IV-3, IV-4,
IV-9, IV-10, IV-11, IV-12, I-16, I-18)이거나, 시험 안에서 AISI S100-16 식으로 따로 계산한 값이다.
매뉴얼 인쇄값은 유효숫자 3자리이므로 허용오차는 상대 1.5 % (주석에 다르게 적은 곳 제외).
"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'python'))

from design.connections import (  # noqa: E402
    OMEGA_RUPTURE, PHI_RUPTURE, _bolt_Fnv_Fnt, bolt_connection, design_connection,
    shear_lag_factor,
)
from design.lap_connection import check_lap_length, design_lap_connection  # noqa: E402
from design import special_topics  # noqa: E402

REL = 0.015


def _close(actual, expected, rel=REL):
    assert actual is not None, f'expected {expected}, got None'
    assert abs(actual - expected) <= rel * abs(expected), f'{actual} vs {expected} (rel {rel})'


def _ds(r, name):
    m = [x for x in r['limit_states'] if x['name'].startswith(name)]
    assert m, f'limit state {name} missing: {[x["name"] for x in r["limit_states"]]}'
    return m[0]['design_strength']


def _rn(r, name):
    return [x for x in r['limit_states'] if x['name'].startswith(name)][0]['Rn']


# ---------- Manual 예제 입력 ----------

def _iv1(dm, t1, t2, **kw):
    return design_connection(dict(connection_type='fillet_weld', design_method=dm, Fy=50, Fu=65,
                                  t1=t1, t2=t2, weld_size=0.105, weld_length=2.25, n=2,
                                  member_case='flat_sheet', **kw))


def _iv2(dm, **kw):
    p = dict(connection_type='arc_spot', design_method=dm, Fy=33, Fu=45, t1=0.060, t2=0.105,
             da=0.625, de=0.375, Fxx=60, n=2, e=1.25, width=3.75, g=1.25,
             member_case='flat_sheet', joint='sheet_to_support')
    p.update(kw)
    return design_connection(p)


def _iv3(dm, **kw):
    p = dict(connection_type='arc_seam', design_method=dm, Fy=50, Fu=65, t1=0.060, t2=0.105,
             da=0.50, weld_length=1.5, n=1, e=1.75, width=4.5, edge_transverse=2.25,
             member_case='flat_sheet', joint='sheet_to_support')
    p.update(kw)
    return design_connection(p)


def _iv9(dm, **kw):
    p = dict(connection_type='bolt', design_method=dm, Fy=33, Fu=45, t1=0.105, t2=0.105,
             d=0.5, n=2, e=1.0, s=2.0, bolt_grade='A307', mf=1.0, Ag=0.42, width=4.0, g=2.0,
             member_case='flat_sheet', edge_transverse=1.0)
    p.update(kw)
    return design_connection(p)


def _iv10_angle(**kw):
    p = dict(connection_type='bolt', design_method='ASD', Fy=33, Fu=45, t1=0.060, t2=0.097,
             d=0.5, n=2, e=1.5, bolt_grade='A307', Ag=0.351, n_rows_long=2, pitch=3.0,
             member_case='angle_bolted', b1=3.0, b2=3.0, x_bar=0.785, edge_transverse=1.5)
    p.update(kw)
    return design_connection(p)


def _iv11(dm, **kw):
    p = dict(connection_type='screw', design_method=dm, Fy=55, Fu=65, Fu1=65, Fu2=45, Fy1=55, Fy2=36,
             t1=0.0285, t2=0.0713, d=0.216, dw=0.340, e=0.75 + 0.108, Pnvs=2.00, Pnts=2.78,
             width=12.0, member_case='flat_sheet', n=1)
    p.update(kw)
    return design_connection(p)


def _iv12(dm, **kw):
    p = dict(connection_type='paf', design_method=dm, Fy=55, Fu=65, Fy2=50, t1=0.036, t2=0.25,
             d=0.180, HRC_p=56, dw=0.340, e=1.0, width=12.0, member_case='flat_sheet', n=1,
             Pnot_test=1.97)
    p.update(kw)
    return design_connection(p)


# ---------- R6-01: 용접 J6 ----------

def test_R6_01_iv2_block_shear_governs_both_methods():
    """R6-01: Manual IV-2 — 블록전단 4.66 kips → 1.86 (ASD) / 2.80 (LRFD) 가 전단을 지배."""
    a, b = _iv2('ASD'), _iv2('LRFD')
    _close(a['shear_design_strength'], 1.86)
    _close(b['shear_design_strength'], 2.80)
    assert a['shear_governing_mode'] == 'Block Shear (J6.3)'
    _close(_ds(a, 'Shear Rupture (J6.1)'), 2.43)
    _close(_ds(b, 'Shear Rupture (J6.1)'), 3.65)
    _close(_ds(a, 'Sheet Tear (J2.2.2.1)'), 3.05)
    _close(_ds(b, 'Sheet Tear (J2.2.2.1)'), 4.70)
    _close(_ds(a, 'Weld Nugget Shear'), 3.90)      # de = 3/8 in (Manual)
    _close(_ds(a, 'Tension Rupture (J6.2)'), 2.19)  # A1.2(c) 합리적 해석 (Manual)
    _close(_ds(b, 'Tension Rupture (J6.2)'), 3.61)


def test_R6_01_iv2_overload_fails_and_missing_geometry_not_pass():
    """R6-01: Pu=2.5 kips(ASD) 는 블록전단 1.86 초과 → FAIL. J6 기하가 없으면 PASS 가 아니다."""
    r = _iv2('ASD', Pu=2.5)
    assert r['pass'] is False and r['verdict'] == 'FAIL'
    bare = design_connection(dict(connection_type='arc_spot', design_method='ASD', Fy=33, Fu=45,
                                  t1=0.060, t2=0.105, da=0.625, de=0.375, n=2, Pu=1.0,
                                  joint='sheet_to_support'))
    assert bare['pass'] is None and bare['verdict'] == 'NOT_CHECKED'
    assert bare['j6_verified'] is False and bare['verification_complete'] is False


def test_R6_01_iv3_shear_rupture_governs():
    """R6-01: Manual IV-3 — J6.1 7.02 kips → 2.81 (ASD) / 4.21 (LRFD) 지배, P=2.80/4.20 에서 PASS."""
    a, b = _iv3('ASD', Pu=2.80), _iv3('LRFD', Pu=4.20)
    _close(a['shear_design_strength'], 2.81)
    _close(b['shear_design_strength'], 4.21)
    assert a['shear_governing_mode'] == 'Shear Rupture (J6.1)'
    assert a['pass'] is True and b['pass'] is True


def test_R6_01_fillet_and_flare_report_j6():
    """R6-01: 필릿·플레어는 J6 분류(member_case)가 없으면 판정을 내리지 않는다 (§3.1)."""
    r = design_connection(dict(connection_type='fillet_weld', design_method='ASD', Fy=50, Fu=65,
                               t1=0.06, t2=0.105, weld_size=0.105, weld_length=2.25, n=2, Pu=4.0))
    assert r['pass'] is None and r['j6_verified'] is False
    # 용접 앵글: J6.2-5, Usl = 1 − 1.20·x̄/L ≤ 0.9, Table J6-1 용접 계수(Ω 2.50)
    r2 = design_connection(dict(connection_type='fillet_weld', design_method='ASD', Fy=50, Fu=65,
                                t1=0.06, t2=0.105, weld_size=0.06, weld_length=3.0, n=2,
                                member_case='angle_welded', Ag=0.351, x_bar=0.785, L_conn=3.0))
    U = max(min(1 - 1.20 * 0.785 / 3.0, 0.9), 0.4)
    _close(_ds(r2, 'Tension Rupture (J6.2)'), 65 * U * 0.351 / 2.50, rel=0.002)


# ---------- R6-02: 필릿 t1/t2 ----------

def test_R6_02_iv1_independent_of_sheet_order():
    """R6-02: Manual IV-1 — 4.32 (ASD) / 6.58 (LRFD), t1·t2 를 어느 쪽으로 넣어도 같다.

    V3: IV-1 은 t1 분기로 되돌려도 LRFD 가 우연히 같다(0.6×0.625 = 0.5×0.75) — L = 1.8 in 를 더 둔다.
    L/t_min = 30 ≥ 25 → Eq. J2.5-3/-4, φ 0.50 / Ω 3.05; t1(0.105) 로 분기하면 L/t1 = 17 → Eq. J2.5-1/-2 φ 0.60.
    """
    for t1, t2 in ((0.060, 0.105), (0.105, 0.060)):
        _close(_iv1('ASD', t1, t2)['design_strength'], 4.32)
        _close(_iv1('LRFD', t1, t2)['design_strength'], 6.58)
        p = dict(connection_type='fillet_weld', Fy=50, Fu=65, t1=t1, t2=t2, weld_size=0.06,
                 weld_length=1.8, n=2, member_case='flat_sheet')
        Pnv = 0.75 * 0.060 * 1.8 * 65 * 2   # Eq. J2.5-4, 얇은 판
        _close(design_connection(dict(p, design_method='LRFD'))['design_strength'], 0.50 * Pnv, rel=1e-3)
        _close(design_connection(dict(p, design_method='ASD'))['design_strength'], Pnv / 3.05, rel=1e-3)
    assert _iv1('ASD', 0.105, 0.060, Pu=4.0)['pass'] is True


# ---------- R6-03: Eq. J2.2.2.1-3 ----------

def test_R6_03_arc_spot_transition_equation():
    """R6-03: Eq. J2.2.2.1-3 = 0.280[1 + 5.59·√(E/Fu)/(da/t)]·t·da·Fu (√ 는 E/Fu 에만)."""
    t, d, Fu, E = 0.03, 0.88, 65.0, 29500.0
    r = design_connection(dict(connection_type='arc_spot', design_method='LRFD', Fy=50, Fu=Fu,
                               t1=t, t2=0.25, da=d, n=1))
    lam = math.sqrt(E / Fu)
    da = d - t
    expected = 0.280 * (1 + 5.59 * lam / (da / t)) * t * da * Fu   # 2.415 kips
    _close(_rn(r, 'Sheet Tear (J2.2.2.1)'), expected, rel=0.001)
    _close(expected, 2.415, rel=0.002)
    # 경계 연속: 0.815λ 에서 2.20, 1.397λ 에서 1.40
    _close(0.280 * (1 + 5.59 / 0.815), 2.20, rel=0.005)
    _close(0.280 * (1 + 5.59 / 1.397), 1.40, rel=0.005)


# ---------- R6-04: 아크 시임 ----------

def test_R6_04_iv3_arc_seam_sheet_and_length_cap():
    """R6-04: Manual IV-3 — Eq. J2.3.2.1-2 7.77 kips, 3.05 / 4.66 (Ω 2.55, φ 0.60). L ≤ 3d."""
    a, b = _iv3('ASD'), _iv3('LRFD')
    _close(_rn(a, 'Sheet Tear (J2.3.2.1)'), 7.77)
    _close(_ds(a, 'Sheet Tear (J2.3.2.1)'), 3.05)
    _close(_ds(b, 'Sheet Tear (J2.3.2.1)'), 4.66)
    _close(_rn(a, 'Weld Seam Shear'), 19.9)
    long_ = _iv3('LRFD', weld_length=3.0)
    assert _rn(long_, 'Sheet Tear (J2.3.2.1)') == _rn(b, 'Sheet Tear (J2.3.2.1)')


# ---------- R6-05: 아크 스팟 시트-시트·인장·조합 ----------

def test_R6_05_sheet_to_sheet_and_tension_and_interaction():
    """R6-05: J2.2.2.2 시트-시트 1.65·t·da·Fu, IV-2 상향 인장(J2.2.3) 1.51/2.27, J2.2.4 0.735/0.932."""
    r = design_connection(dict(connection_type='arc_spot', design_method='LRFD', Fy=33, Fu=45,
                               t1=0.048, t2=0.048, da=0.75, n=1, joint='sheet_to_sheet'))
    _close(r['shear_design_strength'], 0.70 * 1.65 * 0.048 * (0.75 - 0.048) * 45, rel=0.002)  # 1.751
    a, b = _iv2('ASD'), _iv2('LRFD')
    _close(a['tension_design_strength'], 1.51)
    _close(b['tension_design_strength'], 2.27)
    ia = _iv2('ASD', Vu=1.30, Tu=0.90)['interaction_checks'][0]
    ib = _iv2('LRFD', Vu=1.08, Tu=2.00)['interaction_checks'][0]
    _close(ia['value'], 0.735)
    _close(ib['value'], 0.932)
    # 같은 두께 두 장, joint 미지정 → 두 식 중 작은 값(시트-시트가 지배)
    amb = design_connection(dict(connection_type='arc_spot', design_method='LRFD', Fy=33, Fu=45,
                                 t1=0.048, t2=0.048, da=0.75, n=1))
    assert amb['shear_design_strength'] <= r['shear_design_strength'] + 1e-9


# ---------- R6-06 / R6-07: PAF ----------

def test_R6_06_iv12_paf_pullout_shear_uses_E():
    """R6-06: Manual IV-12 — Pnos 4.06 kips (Eq. J5.3.3-1, E²), 1.59 / 2.44. 지배 전단은 지압·틸팅."""
    a, b = _iv12('ASD'), _iv12('LRFD')
    _close(_rn(a, 'Pull-out in Shear'), 4.06)
    _close(_ds(a, 'Pull-out in Shear'), 1.59)
    _close(_ds(b, 'Pull-out in Shear'), 2.44)
    _close(a['shear_design_strength'], 0.659)
    _close(b['shear_design_strength'], 1.08)
    assert a['shear_governing_mode'] == 'Bearing/Tilting (J5.3.2)'
    _close(_ds(a, 'Pin Shear'), 1.50)
    _close(_ds(b, 'Pin Shear'), 2.38)
    _close(a['tension_design_strength'], 0.397)
    _close(b['tension_design_strength'], 0.595)
    _close(_ds(a, 'Shear Rupture (J6.1)'), 0.843)
    _close(_ds(b, 'Shear Rupture (J6.1)'), 1.27)
    _close(_ds(a, 'Tension Rupture (J6.2)'), 8.30)
    _close(_ds(b, 'Tension Rupture (J6.2)'), 12.5)
    _close(_ds(a, 'PAF Tension'), 2.50)
    _close(_ds(b, 'Pull-out in Tension'), 0.788)


def test_R6_06_iv12_combined_c_j54():
    """R6-06/R6-10: Manual IV-12 J5.4 (Eq. C-J5.4-1, n=1) — 0.610 (ASD) / 0.648 (LRFD), PASS."""
    a = _iv12('ASD', Vu=0.213, Tu=0.114)
    b = _iv12('LRFD', Vu=0.355, Tu=0.190)
    _close(a['interaction_checks'][0]['value'], 0.610)
    _close(b['interaction_checks'][0]['value'], 0.648)
    assert a['pass'] is True and b['pass'] is True


def test_R6_07_paf_washer_cap_060():
    """R6-07: J5 — 계산용 d'w ≤ 0.60 in: d'w=0.75 → Pnov = 1.5·0.036·0.60·65 = 2.106."""
    r = _iv12('LRFD', dw=0.75)
    _close(_rn(r, 'Pull-over (J5.2.3)'), 1.5 * 0.036 * 0.60 * 65, rel=0.001)
    no_dw = _iv12('LRFD', dw=None, Tu=0.1)
    assert not any(x['name'].startswith('Pull-over') for x in no_dw['limit_states'])
    assert no_dw['pass'] is None


# ---------- R6-08: 볼트 표 ----------

def test_R6_08_bolt_table_small_diameter():
    """R6-08: App. A Table J3.4-1 — d<1/2 Threaded Parts 0.400Fu, A325 d<1/2 NA, A354BD/A449 소경 나사제외."""
    assert _bolt_Fnv_Fnt(0.375, 120, None, False)[:2] == (0.400 * 120, 0.675 * 120)
    assert _bolt_Fnv_Fnt(0.375, 120, 'A354BD', True)[0] == 84.0
    assert _bolt_Fnv_Fnt(0.375, 120, 'A449', True)[0] == 68.0
    try:
        _bolt_Fnv_Fnt(0.375, 120, 'A325', False)
        raise AssertionError('A325 d<1/2 must be rejected')
    except ValueError:
        pass
    r = design_connection(dict(connection_type='bolt', t1=0.06, t2=0.06, n=1, d=0.375, Fy=33, Fu=45, bolt_grade='A325'))
    assert 'error' in r and 'A325' in r['error']


# ---------- R6-09: 볼트 인장·상호작용 ----------

def test_R6_09_bolt_interaction_fails_verdict():
    """R6-09: J3.4 상호작용만 불합격인 경우 FAIL. Vu 생략 시 Pu 를 전단으로 써 fv = Pu/(n·Ab).

    V3: 과거 입력(Tu=10)은 볼트 인장 단독으로 불합격이라 상호작용을 빼도 통과했다. t=0.105, Fu=65, A307,
    e=2.0, Vu=3.8, Tu=3.0 (LRFD) 은 전단·인장 단독은 합격이고 Eq. J3.4-3 만 불합격(비 ≈ 1.31).
    """
    Ab = math.pi / 4 * 0.5 ** 2
    fv = 3.8 / Ab
    Fnt_red = min(1.3 * 45 - 45 / (0.75 * 27) * fv, 45)          # Eq. J3.4-3, A307 d ≥ 1/2
    ratio = 3.0 / (0.75 * Ab * Fnt_red)
    assert ratio > 1.25
    full = dict(connection_type='bolt', design_method='LRFD', t1=0.105, t2=0.105, d=0.5, Fy=50, Fu=65,
                bolt_grade='A307', e=2.0, n=1, member_case='not_tension_member', j6_3_not_applicable=True,
                Pnov_bolt=10.0, Vu=3.8, Tu=3.0)
    r = design_connection(full)
    _close(r['shear_tension_interaction']['ratio'], ratio, rel=1e-3)
    others = [c for c in r['checks'] if "F'nt" not in c['name']]
    assert len(others) == 2 and all(c['pass'] for c in others)   # 전단·인장 단독은 합격
    assert r['not_evaluated_relevant'] == []
    assert r['pass'] is False and r['verdict'] == 'FAIL'
    base = dict(connection_type='bolt', design_method='LRFD', t1=0.06, t2=0.06, d=0.5, Fy=33, Fu=45,
                bolt_grade='A307', e=1.0, Ag=0.24, width=4, g=2, n=1, member_case='flat_sheet',
                Pnov_bolt=5.0)
    r2 = design_connection(dict(base, Pu=2.0, Tu=3.0))
    _close(r2['shear_tension_interaction']['fv'], 2.0 / (math.pi / 4 * 0.5 ** 2), rel=0.001)  # 10.19 ksi
    no_pullover = design_connection(dict(base, Pnov_bolt=None, Pu=0.5, Tu=0.5))
    assert no_pullover['pass'] is None   # App. A J3.4 머리 풀오버 미평가


# ---------- R6-10: 방향별 지배 ----------

def test_R6_10_iv11_screw_directions_and_combined():
    """R6-10: Manual IV-11 — 전단 0.360/0.540(틸팅·지압), 인장 0.196/0.295(풀아웃), J4.5.1–J4.5.3."""
    a = _iv11('ASD', Vu=0.300, Tu=0.135)
    b = _iv11('LRFD', Vu=0.500, Tu=0.225)
    _close(a['shear_design_strength'], 0.360)
    _close(b['shear_design_strength'], 0.540)
    assert a['shear_governing_mode'] == 'Bearing/Tilting (J4.3.1)'
    assert a['governing_mode'] == 'Bearing/Tilting (J4.3.1)'
    _close(a['tension_design_strength'], 0.196)
    _close(b['tension_design_strength'], 0.295)
    ia = {x['name'][-8:]: x for x in a['interaction_checks']}
    ib = {x['name'][-8:]: x for x in b['interaction_checks']}
    _close(ia['(J4.5.1)']['value'], 0.379)
    _close(ia['(J4.5.1)']['limit'], 0.468)
    _close(ia['(J4.5.2)']['value'], 0.409)
    _close(ia['(J4.5.2)']['limit'], 0.451)
    _close(ia['(J4.5.3)']['value'], 0.199)
    _close(ia['(J4.5.3)']['limit'], 0.433)
    _close(ib['(J4.5.1)']['value'], 0.632)
    _close(ib['(J4.5.1)']['limit'], 0.715)
    _close(ib['(J4.5.2)']['value'], 0.681)
    _close(ib['(J4.5.2)']['limit'], 0.690)
    _close(ib['(J4.5.3)']['value'], 0.331)
    _close(ib['(J4.5.3)']['limit'], 0.650)
    assert a['pass'] is True and b['pass'] is True
    # J6 (Manual 0.557/0.835) — J6.2 는 Eq. J6.2-4 (Manual 은 Usl=1.0 으로 7.27/10.9, 코드가 보수)
    _close(_ds(a, 'Shear Rupture (J6.1)'), 0.557)
    _close(_ds(b, 'Shear Rupture (J6.1)'), 0.835)
    usl = 0.9 + 0.1 * 0.216 / 12.0
    _close(_ds(a, 'Tension Rupture (J6.2)'), 65 * usl * (12 * 0.0285 - 0.216 * 0.0285) / 3.0, rel=0.002)


def test_R6_10_tension_direction_uses_tension_states():
    """R6-10: force_direction='tension' 이면 Pu 를 인장 한계상태와 비교 (IV-2 상향 인장 1.51 ASD)."""
    r = _iv2('ASD', Pu=1.0, force_direction='tension')
    assert r['governing_mode'] == 'Weld Tension (J2.2.3)'
    _close(r['design_strength'], 1.51)
    _close(r['utilization'], 1.0 / 1.513, rel=0.01)
    over = _iv2('ASD', Pu=2.0, force_direction='tension')
    assert over['pass'] is False   # 과거에는 전단강도 3.05 와 비교해 PASS


# ---------- R6-11: 나사 머리쪽 두께 ----------

def test_R6_11_head_side_alias_and_swap_warning():
    """R6-11: t_head/t_far 별칭 → Pnov 0.945 (IV-11). t1>t2 는 경고. 충돌하면 오류."""
    r = _iv11('LRFD', t1=None, t2=None, t_head=0.0285, t_far=0.0713)
    _close(_rn(r, 'Pull-over (J4.4.2)'), 0.945)
    sw = _iv11('LRFD', t1=0.0713, t2=0.0285)
    assert any('t1(머리' in w for w in sw['warnings'])
    bad = _iv11('LRFD', t_head=0.05)
    assert 'error' in bad


# ---------- R6-12 / R5-20 / R5-21: 전단지연 단일 구현 ----------

def test_R6_12_iv10_bolted_angle():
    """R6-12: Manual IV-10 앵글 — Usl 0.534, Ae 0.169, Pnt 7.61, 3.43 (ASD); J6.1 5.36, J6.3 3.89, 지압 2.43 지배."""
    r = _iv10_angle()
    _close(_rn(r, 'Tension Rupture (J6.2)'), 7.61)
    _close(_ds(r, 'Tension Rupture (J6.2)'), 3.43)
    _close(_ds(r, 'Shear Rupture (J6.1)'), 5.36)
    _close(_ds(r, 'Block Shear (J6.3)'), 3.89)
    _close(r['shear_design_strength'], 2.43)
    assert r['shear_governing_mode'] == 'Bearing (J3.3.1)'
    sl = shear_lag_factor('bolted-angle', x_bar=0.785, L=3.0, b1=3.0, b2=3.0)
    _close(sl['Usl'], 0.534, rel=0.002)


def test_R6_12_missing_member_case_not_pass():
    """R6-12: J6.2 분류(member_case) 없이 평판식을 쓰지 않는다 → 판정 없음."""
    r = _iv10_angle(member_case=None, Pu=1.0)
    assert r['pass'] is None
    assert any(x['name'] == 'Tension Rupture (J6.2)' for x in r['not_evaluated'])


def test_R5_20_shear_lag_table_j6_1_factors():
    """R5-20: Manual IV-10 평판 — Ag 0.485, Ant 0.430, d 0.5, s 5.0, Fu 45, ASD, bolted → 7.93."""
    r = special_topics.shear_lag(Ag=0.485, An_net=0.430, x_bar=0, L_conn=3.0, Fu=45, Fy=33,
                                 design_method='ASD', connection_case='flat_sheet', d=0.5, s=5.0,
                                 connection_type='bolted')
    _close(r['design_rupture'], 7.93)
    assert r['rupture_omega'] == 2.22
    # IV-10 평판 J6.2 를 볼트 경로로도
    f = design_connection(dict(connection_type='bolt', design_method='ASD', Fy=33, Fu=45, t1=0.097,
                               t2=0.097, d=0.5, n=2, e=1.5, bolt_grade='A307', width=5.0, n_rows_long=2,
                               pitch=3.0, member_case='flat_sheet', edge_transverse=2.5))
    _close(_ds(f, 'Tension Rupture (J6.2)'), 7.93)
    _close(_ds(f, 'Block Shear (J6.3)'), 8.29)


def test_R5_21_shear_lag_bolted_angle_and_channel():
    """R5-21: Manual IV-10 앵글 — shear_lag('bolted_angle') Usl 0.534, 3.43. 채널 J6.2-8 독립 계산."""
    r = special_topics.shear_lag(Ag=0.351, An_net=0.317, x_bar=0.785, L_conn=3.0, Fu=45, Fy=33,
                                 design_method='ASD', connection_case='bolted_angle', b1=3.0, b2=3.0,
                                 connection_type='bolted')
    _close(r['U'], 0.534)
    _close(r['phi_Tn'], 3.43)
    bf, bw, xb, L = 1.5, 6.0, 0.5, 4.0
    c = special_topics.shear_lag(Ag=0.6, An_net=0.55, x_bar=xb, L_conn=L, Fu=65, Fy=50,
                                 connection_case='channel-bolted', bf=bf, bw=bw, connection_type='bolted')
    _close(c['U'], 1.0 / (1.1 + bf / (bw + 2 * bf) + xb / L), rel=1e-4)
    g = special_topics.shear_lag(Ag=1.0, An_net=0.5, x_bar=0.25, L_conn=2.0, Fu=65, Fy=50)
    assert 'error' in g   # 일반식 1−x̄/L 은 기준식이 아님


def test_R6_12_single_rupture_factor_table():
    """§4.4: Table J6-1 계수는 connections 한 곳에만 있고 special_topics 가 같은 객체를 쓴다."""
    assert special_topics.PHI_RUPTURE is PHI_RUPTURE
    assert special_topics.OMEGA_RUPTURE is OMEGA_RUPTURE
    assert (PHI_RUPTURE['bolt'], OMEGA_RUPTURE['bolt']) == (0.65, 2.22)
    b = special_topics.block_shear(Agv=0.150, Anv=0.113, Ant=0.0375, Fy=33, Fu=45, design_method='ASD',
                                   connection_type='welded')
    _close(b['phi_Rn'], 1.86)   # Manual IV-2


# ---------- R6-13 / R6-14 / R6-16 / R6-17: Lap ----------

_LAP = dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=12, lap_right_in=12, Mu_support=120,
            Vu_support=4.0, fastener_type='bolt', fastener_dia=0.5, n_rows=2)


def test_R6_13_lap_force_model_disclosed_unchanged():
    """R6-13: 힘 분배 모델은 그대로(V = max(Mu/(d−t), Vu)) 두고 사내 합리적 해석(§A1.2(c))임을 밝힌다."""
    r = design_lap_connection(_LAP)
    _close(r['V_transfer'], 120 / (8.0 - 0.059), rel=1e-6)
    fm = r['force_model']
    assert fm['specification_provision'] is False and 'A1.2(c)' in fm['clause']
    step2 = [s for s in r['steps'] if s['step'] == 2][0]
    assert 'A1.2(c)' in step2['name'] and '§B' not in step2['name']


def test_R6_14_lap_without_se_not_pass():
    """R6-14: Se 미입력 + Mu > 0 → 휨 미검토 → pass None."""
    r = design_lap_connection(_LAP)
    assert r['pass'] is None and r['verdict'] == 'NOT_CHECKED'


def test_R6_16_lap_length_each_direction():
    """R6-16: §I6.2.1(g) 는 각 방향 — 한쪽이 0 이면 판정하지 않는다."""
    assert check_lap_length(8.0, 0, 13)['ok'] is None
    assert check_lap_length(8.0, 12, 0)['ok'] is None
    assert check_lap_length(8.0, 12, 11)['ok'] is False
    r = design_lap_connection(dict(_LAP, lap_right_in=0, Se=3.0))
    assert r['pass'] is not True


def test_R6_17_lap_end_distance_reaches_j61():
    """R6-17: end_distance 가 J6.1 에 반영 — e=2.0 → J6.1 φ·0.6·70·2·0.059·(2.0−0.281) = 5.54, 지압 2.79 지배."""
    r = design_lap_connection(dict(_LAP, end_distance=2.0))
    j61 = 0.65 * 0.6 * 70 * 2 * 0.059 * (2.0 - (0.5 + 1 / 16) / 2)
    _close(_ds(r['fastener_design'], 'Shear Rupture (J6.1)'), j61, rel=0.002)
    _close(r['Pns'], 0.60 * 3.0 * 0.75 * 0.5 * 0.059 * 70, rel=0.002)
    assert r['Pns_governing_mode'] == 'Bearing (J3.3.1)'
    assert not any(s['step'] == '6a' for s in r['steps'])


# ---------- R6-15: PAF 적용한계 ----------

def test_R6_15_paf_limits():
    """R6-15: t2=0.08 → J5.3.2(t2/t1≥2, t2≥1/8)·J5.3.3(t2≥0.113) 미평가 → pass None."""
    r = _iv12('LRFD', t2=0.08, Pu=0.2)
    names = [x['name'] for x in r['not_evaluated']]
    assert 'Bearing/Tilting (J5.3.2)' in names and 'Pull-out in Shear (J5.3.3)' in names
    assert r['pass'] is None


# ---------- R6-18: design_method ----------

def test_R6_18_design_method_normalised_or_rejected():
    """R6-18: 'lrfd' = 'LRFD', 'LSD'·기타는 오류 (조용한 ASD 금지)."""
    p = dict(connection_type='bolt', t1=0.06, t2=0.06, d=0.5, n=1, Fy=33, Fu=45)
    assert design_connection(dict(p, design_method='lrfd'))['design_strength'] == \
        design_connection(dict(p, design_method='LRFD'))['design_strength']
    for bad in ('LSD', 'xyz'):
        assert 'error' in design_connection(dict(p, design_method=bad))
        assert 'error' in design_lap_connection(dict(_LAP, design_method=bad))
    assert design_lap_connection(dict(_LAP, design_method='lrfd'))['Pns'] == design_lap_connection(_LAP)['Pns']
    assert 'error' in special_topics.shear_lag(1, 0.5, 0, 1, 65, 50, design_method='LSD',
                                               connection_case='flat_sheet', d=0.5, s=2)
    assert 'error' in special_topics.block_shear(0.1, 0.1, 0.1, 33, 45, design_method='LSD')


# ---------- R6-19: 지압 mf, J3.3.2 ----------

def test_R6_19_mf_by_hole_type_and_hole_deformation():
    """R6-19: Table J3.3.1-2 — 과대공 0.70, 직각 단슬롯 0.55, 장슬롯 오류; J3.3.2 식."""
    def mf_of(**kw):
        r = bolt_connection(t1=0.06, t2=0.06, d=0.5, Fy=33, Fu=45, Fub=None, **kw)
        b = [x for x in r['limit_states'] if x['name'] == 'Bearing (J3.3.1)'][0]
        dt = 0.5 / 0.06
        C = 3.0 if dt < 7 else (1 + 14 / dt if dt <= 18 else 1.8)
        if kw.get('hole_type', 'standard') == 'standard':
            C = 3.0 if dt < 10 else 4.0 - 0.1 * dt
        return b['Rn'] / (C * 0.5 * 0.06 * 45)
    _close(mf_of(hole_type='oversized'), 0.70, rel=1e-3)
    _close(mf_of(hole_type='short_slotted', slot_orientation='perpendicular'), 0.55, rel=1e-3)
    _close(mf_of(hole_type='standard', washers='both', shear_plane='single'), 1.00, rel=1e-3)
    assert 'error' in bolt_connection(t1=0.06, t2=0.06, d=0.5, Fy=33, Fu=45, Fub=None, hole_type='long_slotted')
    r = bolt_connection(t1=0.06, t2=0.06, d=0.5, Fy=33, Fu=45, Fub=None, consider_hole_deformation=True)
    _close(_rn(r, 'Bearing w/ Hole Deformation'), (4.64 * 0.06 + 1.53) * 0.5 * 0.06 * 45, rel=1e-3)


# ---------- R6-20: 범위·필수 입력 ----------

def test_R6_20_scope_and_required_inputs():
    """R6-20: 나사 d=0.375 → 범위 밖(판정 없음), t1/Fy/Fu 누락·'t' 키 → 오류, e < 1.5d → FAIL."""
    r = design_connection(dict(connection_type='screw', t1=0.059, t2=0.059, d=0.375, Fy=35.53, Fu=58.02, n=1,
                               Pu=0.1, Pnvs=5.0, e=1.0, width=6, member_case='flat_sheet'))
    assert r['pass'] is None
    assert any(x['category'] == 'scope' for x in r['not_evaluated_relevant'])
    assert 'error' in design_connection(dict(connection_type='bolt', d=0.5, Fy=33, Fu=45))
    assert 'error' in design_connection(dict(connection_type='bolt', t=0.105, d=0.5, Fy=33, Fu=45))
    assert 'error' in design_connection(dict(connection_type='bolt', t1=0.105, d=0.5))
    short_e = _iv9('ASD', e=0.5, Pu=1.0)
    assert short_e['pass'] is False   # J3.2 e ≥ 1.5d = 0.75
    thick = _iv9('ASD', t1=0.25, t2=0.25, Pu=1.0)
    assert thick['pass'] is None      # t > 3/16 → AISC 360


# ---------- R6-21: Pnvs ----------

def test_R6_21_screw_shear_needs_manufacturer_value():
    """R6-21: Pnvs 입력 → Screw Shear Rn = Pnvs; 없으면 사내 추정값은 참고, 판정 없음."""
    r = _iv11('ASD', Pu=0.2)
    assert _rn(r, 'Screw Shear (J4.3.2)') == 2.0
    est = _iv11('ASD', Pnvs=None, Pu=0.2)
    assert est['pass'] is None
    assert [x for x in est['limit_states'] if x['name'] == 'Screw Shear (J4.3.2)'][0]['assumed'] is True


# ---------- R6-22: 블록전단 경로 ----------

def test_R6_22_block_shear_multi_row_and_single_fastener():
    """R6-22: 2×2 볼트(e=1, s=2, g=2) 2전단면 경로; 단면당 1개면 연단 경로가 필요."""
    d, t, Fy, Fu = 0.5, 0.06, 33.0, 45.0
    dh = d + 1 / 16
    r = design_connection(dict(connection_type='bolt', design_method='LRFD', t1=t, t2=t, d=d, Fy=Fy, Fu=Fu,
                               n=4, n_rows_long=2, pitch=2.0, e=1.0, g=2.0, width=4.0,
                               member_case='flat_sheet', bolt_grade='A307'))
    Agv = 2 * (1.0 + 2.0) * t
    Anv = Agv - 2 * 1.5 * dh * t
    Ant = (2.0 - dh) * t
    Pnr = min(0.6 * Fy * Agv + Fu * Ant, 0.6 * Fu * Anv + Fu * Ant)
    _close(_rn(r, 'Block Shear (J6.3)'), Pnr, rel=1e-3)
    one = design_connection(dict(connection_type='bolt', t1=t, t2=t, d=d, Fy=Fy, Fu=Fu, n=1, e=1.0,
                                 width=4.0, member_case='flat_sheet', Pu=0.5))
    assert any(x['name'] == 'Block Shear (J6.3)' for x in one['not_evaluated'])
    assert one['pass'] is None


# ---------- R6-23: 플레어·PJP 목두께 ----------

def test_R6_23_flare_throat_and_estimates():
    """R6-23: Eq. J2.6-5 (GMAW: twf=5/8R, η=0.073); t>0.10 인데 tw 입력 없으면 판정 없음; PJP te 추정은 미평가."""
    R, w1, w2, t = 0.1875, 0.1875, 0.25, 0.12
    wf = math.sqrt(w1 ** 2 + w2 ** 2)
    tw = (w2 + 5 / 8 * R - R + math.sqrt(2 * R * w1 - w1 ** 2)) * (w1 / wf) - 0.073 * R * (w2 / wf)
    base = dict(connection_type='groove', design_method='LRFD', Fy=50, Fu=65, t1=t, t2=0.25, weld_length=2.0,
                groove_type='flare_bevel', load_direction='longitudinal', member_case='flat_sheet')
    r = design_connection(dict(base, w1=w1, w2=w2, R=R, process='GMAW', Pu=1.0))
    expected = min(0.75 * t * 2.0 * 65, 0.75 * tw * 2.0 * 60)
    _close(_rn(r, 'Flare Groove Shear'), expected, rel=1e-3)
    no_tw = design_connection(dict(base, Pu=1.0))
    assert no_tw['pass'] is None
    pjp = design_connection(dict(connection_type='groove', Fy=50, Fu=65, t1=0.06, t2=0.06, weld_length=2.0,
                                 groove_type='partial', load_direction='tension', Pu=0.5))
    assert pjp['pass'] is None and pjp['verification_complete'] is False


# ---------- IV-4, IV-9: 맞던 것 유지 ----------

def test_iv4_flare_bevel_transverse():
    """Manual IV-4 — L=3.14 in 에서 ASD 4.00 kips, L=3.08 in 에서 LRFD 6.00 kips (Eq. J2.6-1)."""
    p = dict(connection_type='groove', Fy=50, Fu=65, t1=0.060, t2=0.105, groove_type='flare_bevel',
             load_direction='transverse')
    _close(design_connection(dict(p, design_method='ASD', weld_length=3.14))['design_strength'], 4.00)
    _close(design_connection(dict(p, design_method='LRFD', weld_length=3.08))['design_strength'], 6.00)


def test_iv9_bolted_flat_both_methods():
    """Manual IV-9 — J6.1 3.67/5.30, J6.2 5.68/8.19, J6.3 4.91/7.09, 지압 5.67/8.51, 볼트 5.29/7.94, D2 8.32/12.5."""
    a = _iv9('ASD', member_tension=True, Ae=0.42)
    b = _iv9('LRFD', member_tension=True, Ae=0.42)
    for name, ea, eb in (('Shear Rupture (J6.1)', 3.67, 5.30), ('Tension Rupture (J6.2)', 5.68, 8.19),
                         ('Block Shear (J6.3)', 4.91, 7.09), ('Bearing (J3.3.1)', 5.67, 8.51),
                         ('Bolt Shear (J3.4)', 5.29, 7.94), ('Member Tension Yield (D2)', 8.32, 12.5)):
        _close(_ds(a, name), ea)
        _close(_ds(b, name), eb)
    assert a['governing_mode'] == 'Shear Rupture (J6.1)'
    assert _iv9('ASD', Pu=3.5)['pass'] is True
    assert _iv9('ASD', Pu=3.8)['pass'] is False


def test_verdict_failure_wins_over_not_evaluated():
    """§3.1: 평가한 한계상태가 불합격이면 미평가 항목이 있어도 FAIL."""
    r = design_connection(dict(connection_type='arc_spot', design_method='ASD', Fy=33, Fu=45, t1=0.060,
                               t2=0.105, da=0.625, n=2, Pu=10.0, joint='sheet_to_support'))
    assert r['not_evaluated_relevant'] and r['pass'] is False


# ---------- R5-22 / R5-23 / R5-24 ----------

def test_R5_22_cold_work_example_i16():
    """R5-22: Manual I-16 — Fyc 52.30 (Fuv 45 보다 커도 상한 없음), C 0.262, Fya 38.06."""
    r = special_topics.cold_work_strength(Fyv=33, Fuv=45, R=0.107, t=0.0713, A_corners=0.0320, A_flange=0.122)
    # Manual 은 Fu/Fy 를 1.36(정확히 1.3636)으로 반올림해 Bc·m 을 구한다 → 0.5 % 허용
    _close(r['Fyc'], 52.30, rel=0.005)
    _close(r['Fya'], 38.06, rel=0.005)
    _close(r['C'], 0.262, rel=0.005)
    assert r['buckling_precondition'] == 'not_checked' and r['fya_usable'] is None
    assert special_topics.cold_work_strength(33, 45, 0.107, 0.0713, A_corners=0.032, A_flange=0.122,
                                             buckling_precondition=True)['fya_usable'] is True
    none = special_topics.cold_work_strength(33, 45, 0.107, 0.0713)
    assert none['C'] == 0 and none['Fya'] == 33
    comp = special_topics.cold_work_strength(33, 45, 0.107, 0.0713, n_corners=4, A_total=0.70)
    a_corner = math.pi / 2 * (0.107 + 0.0713 / 2) * 0.0713
    _close(comp['C'], 4 * a_corner / 0.70, rel=2e-3)


def test_R5_23_block_shear_not_for_screws():
    """R5-23/J6: 나사·PAF 에는 블록전단을 적용하지 않는다."""
    assert 'error' in special_topics.block_shear(0.1, 0.1, 0.1, 33, 45, connection_type='screw')


def test_R5_24_flange_curling_example_i18():
    """R5-24: Manual I-18 — wf = 1.250 − 0.0566, d = 5.698, f_av 23.82 → cf = 0.000194 in."""
    r = special_topics.flange_curling(bf=1.250, t=0.0566, h=0.0, d=5.698, f_avg=23.82)
    _close(r['cf'], 0.000194, rel=0.01)
    box = special_topics.flange_curling(bf=1.193, t=0.0566, h=5.698, f_avg=23.82,
                                        wf_is_half_clear_distance=True)
    _close(box['cf'], r['cf'], rel=0.01)


# ---------- V3 검증 뒤 (V3-01 – V3-11 · 시험 정직성) ----------

def test_V3_01_multi_sheet_arc_spot_j6_uses_one_sheet():
    """V3-01: 시트 두 장(0.03+0.03) 위 아크 스팟 — J6 은 한 장(0.03), J2.2.2.1·J2.2.3 은 합(0.06).

    J6.1 t = "base steel thickness of section"(판 하나); J2.2.3 "sum of the sheet thicknesses".
    """
    r = design_connection(dict(connection_type='arc_spot', design_method='ASD', Fy=33, Fu=45, t1=0.03, t2=0.25,
                               t_sheets=[0.03, 0.03], da=0.75, n=1, e=1.5, width=4.0, member_case='flat_sheet',
                               edge_transverse=2.0))
    _close(_rn(r, 'Shear Rupture (J6.1)'), 0.6 * 45 * 2 * 1 * 0.03 * (1.5 - 0.75 / 2), rel=1e-3)   # 1.8225
    _close(_rn(r, 'Sheet Tear (J2.2.2.1)'), 2.20 * 0.06 * (0.75 - 0.06) * 45, rel=1e-3)
    de = min(0.7 * 0.75 - 1.5 * 0.06, 0.55 * 0.75)
    Pnt = min(math.pi * de ** 2 / 4 * 60, 0.8 * (45 / 33) ** 2 * 0.06 * (0.75 - 0.06) * 45)
    _close(_rn(r, 'Weld Tension (J2.2.3)'), Pnt, rel=1e-3)
    s = design_connection(dict(connection_type='arc_seam', design_method='ASD', Fy=33, Fu=45, t1=0.03, t2=0.25,
                               t_sheets=[0.03, 0.03], da=0.5, weld_length=1.0, n=1, e=1.5, width=4.0,
                               member_case='flat_sheet', edge_transverse=2.0))
    _close(_rn(s, 'Shear Rupture (J6.1)'), 0.6 * 45 * 2 * 0.03 * (1.5 - 0.25), rel=1e-3)


def test_V3_02_assumed_values_never_decide():
    """V3-02: e 없는 볼트(J6.1 은 e=1.5d 가정), Pnvs 없는 나사 — 가정값 한계상태로는 FAIL 도 PASS 도 없다."""
    b = dict(connection_type='bolt', design_method='LRFD', t1=0.06, t2=0.06, d=0.5, Fy=33, Fu=45,
             bolt_grade='A307', n=1, member_case='not_tension_member', j6_3_not_applicable=True)
    # J6.1(e=0.75 가정) φPnv = 0.65·0.6·45·2·0.06·(0.75−0.28125) = 0.987 < 1.2 < 지압 1.8225
    r = design_connection(dict(b, Pu=1.2))
    assert r['pass'] is None and r['governing_assumed'] is True
    assert design_connection(dict(b, Pu=1.2, e=2.0))['pass'] is True
    assert design_connection(dict(b, Pu=2.0))['pass'] is False   # 가정 없이 평가한 지압 1.82 초과
    sc = dict(connection_type='screw', design_method='LRFD', t1=0.059, t2=0.059, d=0.19, Fy=50, Fu=58,
              n=1, e=1.0, member_case='not_tension_member', Pu=0.73)
    # 추정 Pnvs 0.5·100·As → φ 0.709 < 0.73 < 틸팅 φ 0.761
    assert design_connection(sc)['pass'] is None
    assert design_connection(dict(sc, Pnvs=2.4))['pass'] is True


def test_V3_03_screw_combined_outside_j45_limits():
    """V3-03: 24 ga 패널(t1=0.0236 < 0.0285) — J4.5.1 적용한계 밖: Commentary C-J4.5.1-1 직선식(A1.2(c))."""
    p = dict(connection_type='screw', design_method='ASD', Fy=55, Fu=65, t1=0.0236, t2=0.0713, d=0.216,
             dw=0.340, e=1.0, Pnvs=2.0, Pnts=2.78, member_case='not_tension_member', n=1, Vu=0.10, Tu=0.05)
    r = design_connection(p)
    fb = [x for x in r['interaction_checks'] if 'J4.5.1' in x['name']][0]
    assert fb['basis'] == 'rational_A1.2c' and 't1=0.0236' in fb['note']
    Pnv = min(2.7 * 0.0236 * 0.216 * 65, 2.7 * 0.0713 * 0.216 * 65)      # t2/t1 ≥ 2.5: J4.3.1-4/-5
    Pnov = 1.5 * 0.0236 * 0.340 * 65
    _close(fb['value'], 0.10 / Pnv + 0.05 / Pnov, rel=1e-3)
    _close(fb['limit'], 1 / 3.0, rel=1e-3)
    assert r['pass'] is True
    off = design_connection(dict(p, j45_rational=False))
    assert off['pass'] is None
    assert any('시험' in x['reason'] for x in off['not_evaluated_relevant'])


def test_V3_03_j45_2_fu_fy_limit():
    """V3-03 / 시험 공백: J4.5.2 의 Fu/Fy ≤ 1.62·≥ 1.0 한계 — Fu2/Fy2 = 0.9 이면 기준식(J4.5.2-1) 을 쓰지 않는다."""
    r = _iv11('ASD', Vu=0.300, Tu=0.135, Fy2=50)
    j452 = [x for x in r['interaction_checks'] if 'J4.5.2' in x['name']][0]
    assert j452['equation'].startswith('C-J4.5.1-1') and 'Fu2/Fy2=0.90' in j452['note']


def test_V3_04_not_tension_member_completes_verdict():
    """V3-04: 인장재가 아닌 판(랩 볼트 등) — member_case='not_tension_member', j6_3_not_applicable 로 판정 완결."""
    r = design_connection(dict(connection_type='bolt', design_method='LRFD', t1=0.06, t2=0.06, d=0.5, Fy=33,
                               Fu=45, bolt_grade='A307', n=2, e=1.0, s=1.5, Pu=1.5,
                               member_case='not_tension_member', j6_3_not_applicable=True))
    assert r['pass'] is True and r['verification_complete'] is True
    assert any('not_tension_member' in a for a in r['assumptions'])
    assert not any(x['name'].startswith('Tension Rupture') for x in r['limit_states'])


def test_V3_05_flare_v_transverse_not_evaluated():
    """V3-05: Eq. J2.6-1 은 플레어 베벨 전용 — 플레어 V 홈의 횡방향 하중은 식이 없어 미평가."""
    r = design_connection(dict(connection_type='groove', design_method='ASD', Fy=50, Fu=65, t1=0.06, t2=0.06,
                               weld_length=3.0, groove_type='flare_v', load_direction='transverse', Pu=1.0,
                               member_case='not_tension_member', j6_3_not_applicable=True))
    assert not any(x['name'].startswith('Flare Groove Shear') for x in r['limit_states'])
    assert r['pass'] is None


def test_V3_06_second_part_j6():
    """V3-06: 두 번째 판(두껍지만 끝단 거리가 짧다)의 J6.1 이 지배할 수 있다 — j6_part2."""
    r = design_connection(dict(connection_type='bolt', design_method='LRFD', t1=0.06, t2=0.10, d=0.5, Fy=33,
                               Fu=45, bolt_grade='A307', n=1, e=2.0, member_case='not_tension_member',
                               j6_3_not_applicable=True,
                               j6_part2={'t': 0.10, 'Fu': 45, 'Fy': 33, 'e': 0.75,
                                         'member_case': 'not_tension_member', 'j6_3_not_applicable': True}))
    p2 = 0.65 * 0.6 * 45 * 2 * 0.10 * (0.75 - (0.5 + 1 / 16) / 2)
    _close(_ds(r, 'Shear Rupture (J6.1) [part 2]'), p2, rel=2e-3)
    assert r['shear_governing_mode'] == 'Shear Rupture (J6.1) [part 2]'
    one = design_connection(dict(connection_type='bolt', t1=0.06, t2=0.10, d=0.5, n=1, Fy=33, Fu=45, e=2.0))
    assert any('j6_part2' in a for a in one['assumptions'])


def test_V3_07_fillet_member_tension_iv1():
    """V3-07: Manual IV-1 Chapter D — D2 7.50 kips → 4.49 / 6.75, D3 9.75 → 4.88 / 7.31."""
    a = _iv1('ASD', 0.060, 0.105, member_tension=True, width=2.5)
    b = _iv1('LRFD', 0.060, 0.105, member_tension=True, width=2.5)
    _close(_ds(a, 'Member Tension Yield (D2)'), 4.49)
    _close(_ds(b, 'Member Tension Yield (D2)'), 6.75)
    _close(_ds(a, 'Member Tension Rupture (D3)'), 4.88)
    _close(_ds(b, 'Member Tension Rupture (D3)'), 7.31)


def test_V3_08_lap_short_end_distance_fails():
    """V3-08: 1/2 in 볼트에 end_distance=0.5 (< 1.5d = 0.75) — 조용히 올리지 않고 J3.2 불합격."""
    r = design_lap_connection(dict(_LAP, end_distance=0.5, Se=3.0))
    assert r['pass'] is False
    assert r['edge_distance'] == 0.5
    assert any(not x['pass'] for x in r['fastener_design']['detailing_checks'])


def test_V3_09_lap_length_is_condition_not_strength():
    """V3-09: 랩 < 1.5d 는 R 계수법·J3 슬롯 예외의 적용 조건 — 경고만, 강도 판정은 그대로."""
    # 2026-11-24 V6-07: Mnd 가 없으면 랩 뒤틀림은 미평가다 — 이 시험의 대상(랩 길이)만 보려고 구속을 밝힌다.
    r = design_lap_connection(dict(_LAP, lap_left_in=10, lap_right_in=10, end_distance=2.0, Se=3.0,
                                   distortion_restrained=True))
    assert r['lap_ok'] is False
    assert r['pass'] is True
    assert any('R 계수법' in w for w in r['warnings'])


def test_V3_10_fillet_throat_uses_w1_le_t1():
    """V3-10: 겹침이음 t > 0.10 — Eq. J2.5-7 의 tw = 0.707·min(w1, w2), w1 ≤ t1 (Fig. J2.5-1)."""
    p = dict(connection_type='fillet_weld', design_method='LRFD', Fy=50, Fu=65, t1=0.12, t2=0.135,
             weld_size=0.25, weld_length=2.0, n=1, member_case='not_tension_member')
    _close(_rn(design_connection(p), 'Weld Metal (J2.5)'), 0.75 * 0.707 * 0.12 * 2.0 * 60, rel=1e-3)
    _close(_rn(design_connection(dict(p, joint_type='t_joint')), 'Weld Metal (J2.5)'),
           0.75 * 0.707 * 0.25 * 2.0 * 60, rel=1e-3)


def test_V3_arc_spot_tension_modifiers():
    """시험 공백: J2.2.3 편심 50 %, 사이드랩 70 %, 패널·데크 Ω 2.50 (IV-2, Pnt 2.27 kips/용접)."""
    Pnt = 0.8 * (45 / 33) ** 2 * 0.060 * (0.625 - 0.060) * 45     # Eq. J2.2.3-2 (지배)
    _close(_iv2('ASD')['tension_design_strength'], 2 * Pnt / 3.00, rel=2e-3)
    _close(_iv2('ASD', eccentric_tension=True)['tension_design_strength'], 2 * 0.5 * Pnt / 3.00, rel=2e-3)
    _close(_iv2('ASD', sidelap=True)['tension_design_strength'], 2 * 0.7 * Pnt / 3.00, rel=2e-3)
    _close(_iv2('ASD', application='deck')['tension_design_strength'], 2 * Pnt / 2.50, rel=2e-3)
    _close(_iv2('LRFD', application='deck')['tension_design_strength'], 0.60 * 2 * Pnt, rel=2e-3)


def test_V3_arc_spot_j224_limits():
    """시험 공백: J2.2.4 적용한계 (e) 0.47 ≤ d ≤ 1.02 in, (d) Fu/Fy ≥ 1.02 — 밖이면 조합 미평가."""
    small = _iv2('ASD', da=0.45, Vu=1.0, Tu=0.5)
    assert any(x['name'].startswith('전단+인장 (J2.2.4)') and 'd=0.45' in x['reason']
               for x in small['not_evaluated'])
    assert small['pass'] is None
    ratio = _iv2('ASD', Fy=45, Vu=1.0, Tu=0.5)
    assert any('Fu/Fy' in x['reason'] for x in ratio['not_evaluated'] if x['name'].startswith('전단+인장'))


def test_V3_flare_v_throat_eq_j267():
    """시험 공백: 플레어 V 종방향, t = 0.12 > 0.10 — Eq. J2.6-7 tw = min(twf−d1, twf−d2), GMAW twf = 3/4 R."""
    r = design_connection(dict(connection_type='groove', design_method='LRFD', Fy=50, Fu=65, t1=0.12, t2=0.12,
                               weld_length=2.0, groove_type='flare_v', load_direction='longitudinal',
                               R=0.25, R2=0.30, d1=0.02, d2=0.10, process='GMAW',
                               member_case='not_tension_member', j6_3_not_applicable=True))
    tw = min(0.75 * 0.25 - 0.02, 0.75 * 0.25 - 0.10)
    expected = min(0.75 * 0.12 * 2.0 * 65, 0.75 * tw * 2.0 * 60)   # J2.6-2 ≤ J2.6-4
    _close(_rn(r, 'Flare Groove Shear'), expected, rel=1e-3)


def test_V4_08_lap_gross_sf_is_not_a_flexure_basis():
    """V4-08: Se 없이 Sf(총단면)만 주면 Lap 휨은 미평가(참고값만), 판정 None. Se 를 주면 평가된다.

    Mu = 120 kip-in, LRFD: Se = 3.0 → φMn = 0.90·2·3.0·55 = 297 kip-in, DCR 0.404 (손계산).
    """
    sf_only = design_lap_connection(dict(_LAP, end_distance=2.0, Sf=3.0))
    assert sf_only['pass'] is None and sf_only['verdict'] == 'NOT_CHECKED'
    assert sf_only['flexure_checked'] is False and sf_only['flexure_dcr'] is None
    assert sf_only['flexure_basis'] == 'Sf_reference' and sf_only['flexure_assumed'] is True
    _close(sf_only['flexure_reference_dcr'], 120 / (0.90 * 2 * 3.0 * 55), rel=1e-3)
    assert [s for s in sf_only['steps'] if s['step'] == '8r'][0]['assumed'] is True
    se = design_lap_connection(dict(_LAP, end_distance=2.0, Se=3.0))
    assert se['flexure_checked'] is True and se['flexure_basis'] == 'Se'
    _close(se['flexure_dcr'], 120 / (0.90 * 2 * 3.0 * 55), rel=1e-3)
    # 2026-11-24 V6-07: Mnd 가 없으면 랩 뒤틀림은 미평가(판정 None) — 구속을 밝히면 판정이 선다.
    assert se['pass'] is None
    assert design_lap_connection(dict(_LAP, end_distance=2.0, Se=3.0, distortion_restrained=True))['pass'] is True
    # Sf 가 함께 있어도 판정 근거는 Se
    both = design_lap_connection(dict(_LAP, end_distance=2.0, Se=3.0, Sf=9.9))
    _close(both['flexure_dcr'], se['flexure_dcr'], rel=1e-9)


def test_V4_29_missing_t2_and_n_are_refused():
    """V4-29: t2 · n 을 t1 · 1 로 가정하지 않는다 — 빠지면 그 이름을 말하는 오류. 완전한 입력은 그대로."""
    full = dict(connection_type='bolt', design_method='ASD', Fy=33, Fu=45, t1=0.105, t2=0.105, d=0.5, n=2,
                e=1.0, s=2.0, bolt_grade='A307', mf=1.0, width=4.0, g=2.0, member_case='flat_sheet')
    no_t2 = dict(full)
    no_t2.pop('t2')
    r = design_connection(no_t2)
    assert 'error' in r and 't2' in r['error']
    no_n = dict(full)
    no_n.pop('n')
    r = design_connection(no_n)
    assert 'error' in r and 'n(' in r['error']
    for ctype, extra in (('screw', dict(d=0.19)), ('paf', dict(d=0.177)), ('arc_spot', dict(da=0.625)),
                         ('arc_seam', dict(da=0.5, weld_length=1.5)),
                         ('fillet_weld', dict(weld_size=0.06, weld_length=2.0))):
        p = dict(connection_type=ctype, Fy=50, Fu=65, t1=0.06, t2=0.10, **extra)
        assert 'n(' in design_connection(p)['error'], ctype
        p2 = dict(p, n=1)
        p2.pop('t2')
        assert 't2' in design_connection(p2)['error'], ctype
    assert 'error' in design_connection(dict(full, n=1.5))
    assert 'error' in design_connection(dict(full, n=0))
    nc = dict(full)
    nc.pop('connection_type')
    assert 'connection_type' in design_connection(nc)['error']
    # 완전한 입력은 바뀌지 않음 — Manual IV-9 (ASD) J6.1 3.67, J6.2 5.68, J6.3 4.91
    ok = design_connection(full)
    _close(_ds(ok, 'Shear Rupture (J6.1)'), 3.67)
    _close(_ds(ok, 'Tension Rupture (J6.2)'), 5.68)
    _close(_ds(ok, 'Block Shear (J6.3)'), 4.91)
    assert any('hole_type' in a for a in ok['assumptions'])


def test_V4_29_multi_sheet_arc_spot_keeps_t_sheets_convention():
    """V4-29: 아크 스팟 t_sheets(지지재 위 시트들) 는 t2(지지재) 없이도 된다 — 강도식에 쓰이지 않음, assumptions 에 적음."""
    r = design_connection(dict(connection_type='arc_spot', design_method='ASD', Fy=33, Fu=45, t1=0.03,
                               t_sheets=[0.03, 0.03], da=0.75, n=1, e=1.5, width=4.0, member_case='flat_sheet',
                               edge_transverse=2.0))
    assert 'error' not in r
    _close(_rn(r, 'Shear Rupture (J6.1)'), 0.6 * 45 * 2 * 0.03 * (1.5 - 0.375), rel=1e-3)
    assert any('t2(지지재)' in a for a in r['assumptions'])
    ss = design_connection(dict(connection_type='arc_spot', Fy=33, Fu=45, t1=0.03, t_sheets=[0.03, 0.03],
                                da=0.75, n=1, joint='sheet_to_sheet'))
    assert 't2' in ss['error']


def test_V4_29_groove_type_and_direction_required():
    """V4-29: 그루브는 groove_type(CJP 가정 금지)과 버트 이음 load_direction(전단 < 인장) 이 필요. 플레어는 종방향(보수)."""
    base = dict(connection_type='groove', design_method='ASD', Fy=50, Fu=65, t1=0.06, t2=0.06, weld_length=2.0)
    assert 'groove_type' in design_connection(base)['error']
    assert 'load_direction' in design_connection(dict(base, groove_type='complete'))['error']
    fl = design_connection(dict(base, groove_type='flare_bevel'))
    assert fl['limit_states'][0]['equation'] == 'J2.6-2'
    assert any('load_direction' in a for a in fl['assumptions']) and any('Fxx' in a for a in fl['assumptions'])
