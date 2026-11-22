"""2026-11-24 — 독립 검증 V6(docs/reviews/20261122-engine-review/verify/V6-check-contract.md) 의 엔진 쪽 수정 회귀 시험.

각 시험은 da93885 의 엔진에서 실패한다. 기대값은 시험 안에서 원문 식으로 따로 계산한다.
"""

import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), 'python'))
sys.path.insert(0, HERE)

from design.aisi_s100 import design_member  # noqa: E402
from design.connections import design_connection  # noqa: E402
from design.lap_connection import design_lap_connection  # noqa: E402
import contract_cases_1123 as cases  # noqa: E402

E = 29500.0
C9 = dict(A=0.881, Sf=2.29, ry=0.890, ro=3.90, J=0.00102, Cw=11.9, rx=3.42)


def _case(name):
    return dict([p for n, _, p in cases.all_cases() if n == name][0])


def _check(r, cid):
    return [c for c in r['design_checks'] if c['id'] == cid][0]


def _step(c, symbol):
    return [s for s in c['steps'] if (s.get('result') or {}).get('symbol') == symbol][0]


def _lap(**kw):
    return dict(dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=12, lap_right_in=30, Mu_support=105.0,
                     Vu_support=1.78, fastener_type='bolt', fastener_dia=0.5, n_rows=2, end_distance=2.0,
                     Se=2.025, design_method='ASD'), **kw)


def test_V6_01_H1_2_traces_the_amplification_and_keeps_the_user_moment_as_input():
    """§C1.2.1.1: Pe1y = π²EA/(KyLy/ry)², B1y = Cmy/(1 − αP/Pe1y); 사용자가 준 Muy = 1.0 은 입력,
    키운 값 My,amp = B1y·Muy 는 계산 결과(다른 기호)."""
    p = dict(member_type='combined', design_method='LRFD', Fy=55, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0,
             Pu=2.0, Mux=25.0, Muy=1.0, May_strength=8.0, Cmx=0.85, Cmy=1.0, section_type='C',
             props=dict(C9, xo=1.83), dsm=dict(Pcrl=20.0, Pcrd=25.0, Mcrl=84.4, Mcrd=107.0))
    h = _check(design_member(p), 'member.axial_bending')
    pe1y = math.pi ** 2 * E * 0.881 / (48.0 / 0.890) ** 2
    b1y = 1.0 / (1 - 1.0 * 2.0 / pe1y)
    assert abs(_step(h, 'Pe1y')['result']['value'] - pe1y) <= 1e-9 * pe1y
    assert abs(_step(h, 'B1y')['result']['value'] - b1y) <= 1e-12
    my = _step(h, 'My,amp')
    assert abs(my['result']['value'] - b1y * 1.0) <= 1e-12
    for s in h['steps']:
        for i in s['inputs']:
            if i['source'].get('key') == 'Muy':
                assert i['value'] == 1.0 and i['symbol'] == 'My', i       # 입력은 사용자가 준 그 값
    eq = [s for s in h['steps'] if s['equation'] == 'H1.2-1'][0]
    assert 'My,amp' in [i['symbol'] for i in eq['inputs']]
    pa = [i for i in eq['inputs'] if i['symbol'] == 'Pa'][0]['source']
    assert pa['id'] in ('member.compression.global', 'member.compression.local', 'member.compression.distortional')


def test_V6_03_not_evaluated_check_governs_its_group():
    """볼트 지압 0.658 이 합격이고 J6.1(e = 1.5d 가정)이 미평가 · 참고 비 1.22 이면, 무리의 지배는 J6.1 이다."""
    r = design_connection(_case('bolt assumed e (not decided)'))
    j61 = _check(r, 'conn.j6.shear_rupture')
    assert j61['verdict'] == 'not_evaluated' and j61['governs'] is True and j61['governs_basis'] == 'not_evaluated'
    he = j61['highest_evaluated']
    brg = _check(r, 'conn.bolt.bearing')
    assert he['id'] == 'conn.bolt.bearing' and he['ratio'] == brg['ratio'] and brg['governs'] is False
    assert j61['reference']['ratio'] > 1.0 > brg['ratio']
    assert r['pass'] is None                                      # 전체 판정은 그대로(미평가)


def test_V6_04_out_of_scope_limit_states_do_not_read_as_pass():
    """J4 머리글: 0.08 ≤ d ≤ 0.25 in 나사에만. 범위 밖에서 계산한 합격은 not_evaluated, 수는 reference 로."""
    r = design_connection(_case('screw out of scope d'))
    for c in r['design_checks']:
        if c['clause'].startswith('J4'):
            assert c['verdict'] != 'pass', c['id']
    tilt = _check(r, 'conn.screw.bearing_tilting')
    assert tilt['verdict'] == 'not_evaluated' and tilt['out_of_scope'] == 'J4'
    assert tilt['capacity'] is None and tilt['reference']['ratio'] > 0
    t = design_connection(_case('bolt thick (AISC scope)'))          # t = 0.25 > 3/16 in: J3 · J6 머리글
    for c in t['design_checks']:
        if c['clause'].startswith(('J3', 'J6')):
            assert c['verdict'] != 'pass', c['id']
    assert r['pass'] is None and t['pass'] is None


def test_V6_05_every_multiplied_value_is_an_input():
    """랩 H2 의 두 겹 전단(×2), 볼트 F'nt 의 Ab · Fnt · Fnv · φ, J2.2.2.1-3 의 λ 가 단계의 입력이다."""
    h = _check(design_lap_connection(_lap(distortion_restrained=True)), 'lap.bending_shear')
    vl = _step(h, 'Vn,lap')
    vn = [i for i in vl['inputs'] if i['symbol'] == 'Vn'][0]['value']
    assert vl['result']['value'] == 2 * vn
    ds = [s for s in h['steps'] if s['kind'] == 'design_strength'][0]
    om = [i for i in ds['inputs'] if i['symbol'] == 'Ωv'][0]['value']
    assert abs(ds['result']['value'] - 2 * vn / om) <= 1e-12 and om == 1.60
    b = design_connection(dict(_case('IV-9 bolt V+T ASD'))) if any(
        n == 'IV-9 bolt V+T ASD' for n, _, _ in cases.all_cases()) else design_connection(
        dict(cases._iv9('LRFD'), Pu=1.0, Tu=0.5))
    st = _check(b, 'conn.bolt.shear_tension')
    fnt = [s for s in st['steps'] if (s['result'] or {}).get('symbol') == "F'nt"][0]
    assert {'Fnt', 'Fnv', 'fv'} <= {i['symbol'] for i in fnt['inputs']}
    assert {'φv', 'Ωv'} & {i['symbol'] for i in fnt['inputs']}
    fv = [s for s in st['steps'] if (s['result'] or {}).get('symbol') == 'fv'][0]
    assert {'V', 'n', 'Ab'} == {i['symbol'] for i in fv['inputs']}
    a = design_connection(dict(connection_type='arc_spot', design_method='LRFD', Fy=33, Fu=45, t1=0.03,
                               t2=0.25, da=0.625, n=1, e=1.0, joint='sheet_to_support',
                               member_case='not_tension_member', j6_3_not_applicable=True, Pu=0.5))
    tear = _check(a, 'conn.arc_spot.sheet_tear')
    eq = [s for s in tear['steps'] if s['equation'] == 'J2.2.2.1-3']
    if eq:
        assert 'λ' in [i['symbol'] for i in eq[-1]['inputs']]


def test_V6_06_nonlinear_interaction_ratio_is_comparable():
    """J2.2.4: (V/Pav)^1.5 + (T/Pat)^1.5 ≤ 1 — 비는 (값)^(1/1.5)(하중 배율). Manual IV-2 ASD: 값 0.737 → 비 0.816."""
    r = design_connection(_case('IV-2 arc spot V+T ASD'))
    c = _check(r, 'conn.arc_spot.shear_tension')
    val = c['demand']['value']
    assert abs(val - 0.737) <= 0.0005 and abs(c['ratio'] - val ** (1 / 1.5)) <= 1e-12
    assert c['ratio_form'] == '(value/limit)^(1/1.5)'
    assert r['utilization'] == round(val ** (1 / 1.5), 4) == 0.8159
    assert r['interaction_checks'][0]['value'] == round(val, 4)          # 원문의 좌변은 그대로
    assert r['pass'] is True


def test_V6_07_lap_distortion_is_not_assumed():
    """Mnd 가 없으면 랩 뒤틀림은 not_evaluated(판정 None). 구속은 입력(distortion_restrained)으로만."""
    r = design_lap_connection(_lap())
    d = _check(r, 'lap.flexure.distortional')
    assert d['verdict'] == 'not_evaluated' and d['counts'] is True and r['pass'] is None
    s = design_lap_connection(_lap(distortion_restrained=True))
    d2 = _check(s, 'lap.flexure.distortional')
    assert d2['verdict'] == 'not_applicable' and d2['restraint_source']['kind'] == 'user_input'
    assert s['pass'] is True
    m = design_lap_connection(_lap(Mnd=100.0))
    assert _check(m, 'lap.flexure.distortional')['verdict'] in ('pass', 'fail')


def test_V6_14_governing_check_name_from_unrounded_utilisation():
    """휨 비 0.50003 이 0.5000 으로 저장돼도, 비 0.50002 인 정모멘트 구간이 지배 이름을 가져가지 않는다."""
    base = dict(member_type='flexure', design_method='LRFD', Fy=55, Lb=56.3, Cb=1.67, Mu=50.0, Mu_pos=10.0,
                Lb_pos=0.0, section_type='C', props=dict(C9), dsm=dict(Mcrl=84.4, Mcrd=107.0, My=126.0))
    r = design_member(dict(base))
    capF = [c for c in r['design_checks'] if c['group'] == 'member.flexure' and c['governs']][0]['capacity']['value']
    capP = _check(r, 'member.flexure.positive_region')['capacity']['value']
    r = design_member(dict(base, Mu=0.50003 * capF, Mu_pos=0.50002 * capP))
    assert r['governing_check'] == 'F flexure' and r['utilization'] == 0.5


def test_V6_15_arc_seam_cap_is_labelled_in_house():
    """Eq. J2.3.2.1-3 는 de = 0.7d − 1.5t 뿐. 0.55d 상한은 사내 보수(A1.2) — 따로 단계 · 가정. 강도는 그대로."""
    p = dict(connection_type='arc_seam', design_method='LRFD', Fy=33, Fu=45, t1=0.048, t2=0.25, da=0.5,
             weld_length=1.0, n=1, joint='sheet_to_support', e=1.0, member_case='not_tension_member',
             j6_3_not_applicable=True, Pu=1.0)
    r = design_connection(p)
    c = _check(r, 'conn.arc_seam.weld_shear')
    de_eq = 0.7 * 0.5 - 1.5 * 0.048
    eqs = [s for s in c['steps'] if s['equation'] == 'J2.3.2.1-3'][0]
    assert abs(eqs['result']['value'] - de_eq) <= 1e-12 and '0.55' not in eqs['expr']
    cap = [s for s in c['steps'] if s['kind'] == 'modifier' and 'A1.2' in s['expr']][0]
    assert cap['result']['value'] == 0.55 * 0.5 < de_eq
    assert any('0.55d' in a and 'A1.2' in a for a in r['assumptions'])
    de = 0.55 * 0.5
    assert abs(c['nominal']['value'] - (math.pi * de ** 2 / 4 + 1.0 * de) * 0.75 * 60) <= 1e-9


def test_V6_16_unbounded_Fcre_is_not_a_number():
    """Lb = 0: Fcre → ∞. 계산 과정은 숫자(1e6 ksi)를 싣지 않는다 — value None, unbounded True."""
    r = design_member(dict(member_type='flexure', design_method='LRFD', Fy=55, Lb=0.0, Mu=50.0, section_type='C',
                           props=dict(C9), dsm=dict(Mcrl=84.4, Mcrd=107.0)))
    g = _check(r, 'member.flexure.global')
    f = _step(g, 'Fcre')
    assert f['result']['value'] is None and f['result']['unbounded'] is True
    for c in r['design_checks']:
        for s in c['steps']:
            for x in s['inputs'] + ([s['result']] if s.get('result') else []):
                assert x.get('value') is None or abs(x['value']) < 1e5 or x['symbol'] not in ('Fcre', 'Mcre'), x


def test_V6_20_F2_to_F4_stand_when_I6_2_1_cannot_apply():
    r = design_member(_case('I6.2.1 R exceeds table'))
    assert _check(r, 'member.flexure.uplift_r')['verdict'] == 'not_evaluated'
    for cid in ('member.flexure.global', 'member.flexure.local', 'member.flexure.distortional'):
        c = _check(r, cid)
        assert c['verdict'] == 'not_evaluated' and 'cannot be applied' in c['reason'], (cid, c['reason'])


def test_V6_S1_lap_block_shear_is_stated_not_silent():
    r = design_lap_connection(_lap(distortion_restrained=True))
    b = _check(r, 'lap.block_shear')
    assert b['verdict'] == 'not_evaluated' and b['counts'] is False and b['clause'] == 'J6.3'
    assert any(n.startswith('J6.3') for n in r['scope_notes'])


def test_V6_11_no_unit_constants_hidden_in_expressions():
    """식 문자열에 단위 있는 수(ksi · in)를 넣지 않는다 — 그런 상수는 quantity 가 있는 입력으로. 원문 식 자체가
    US 단위로 쓰인 것(Eq. J3.3.2-1 의 4.64αt)은 expr_units = 'US' 로 표시한다."""
    unit = re.compile(r'\d\s*(ksi\b|in\.?(?=\s*($|[),;])))')
    seen_us = 0
    for name, method, params in cases.all_cases():
        if method not in ('aisi_design', 'design_connection', 'lap_connection'):
            continue
        r = cases.run_case(method, params)
        for c in list(r.get('design_checks') or []) + list((r.get('fastener_design') or {}).get('design_checks')
                                                          or []):
            for s in c['steps']:
                txt = (s.get('expr') or '') + ' ' + (s.get('condition') or '')
                if s.get('expr_units') == 'US':
                    seen_us += 1
                    continue
                assert not unit.search(txt), (name, c['id'], txt)
                assert not re.search(r'\d×\d', txt), (name, c['id'], txt)   # 값을 식에 박지 않는다
    assert seen_us >= 1
