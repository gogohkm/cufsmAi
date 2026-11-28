"""2026-11-28 E — 경간마다 다른 퍼린 단면(엔진 단계). 작업문서 docs/implementation/20261128-span-sections-worklog.md.

기준값의 출처(aisi-cold-formed-steel 스킬, 이 세션에서 연 글):
- Design Manual Example II-1A (Four Span Continuous C-Purlins, LRFD): 4 × 25 ft, 9CS2.5x070 끝 경간 · 9CS2.5x059
  안 경간(Ix 12.2 / 10.3 in^4), 랩(연결점까지) 2.0 · 2.75 · 1.25 · 1.25 · 2.75 · 2.0 ft, D 15 · Lr 90 · W 144 plf (양력).
  가정 (b): 랩 안의 Ix = 두 부재 Ix 의 합. 1.2D + 1.6Lr: 끝 경간 +M 7.36, 오른쪽 랩 끝 7.34, 지점 12.0, 안 경간 왼쪽 랩 끝
  6.54, +M 3.16, 오른쪽 랩 끝 5.00, 가운데 지점 7.16 kip-ft; Vu 1.54 · 2.18 · 2.50 · 2.22 · 1.78 · 1.62 · 1.84 kips;
  Pu 1.54 · 4.74 · 3.66 kips; 0.9D + 1.0W: 끝 경간 −5.93, 안 경간 −2.56 kip-ft; R = 0.60 (C, 연속).
- Design Manual Example II-2A (Four Span Continuous Z-Purlins, ASD): 1 ft 내민 + 4 × 25 ft + 1 ft 내민, 8ZS2.25x070 끝 ·
  8ZS2.25x059 안(Ix 9.18 / 7.76), 랩 2.5 · 3.5 · 1.0 · 1.0 · 3.5 · 2.5 ft, D 15 · Lr 100 · W 170 plf.
  D + Lr: 내민 −0.06, 끝 경간 +M 5.11, 랩 끝 4.65, 지점 8.75, 안 경간 랩 끝 3.89, +M 2.23, 랩 끝 3.73, 가운데 4.95 kip-ft;
  V 1.09 · 1.50 · 1.78 · 1.59 · 1.18 · 1.17 · 1.29 kips; P 1.21 · 3.37 · 2.58 kips; 0.6D + 0.6W: −4.13 · −1.81 kip-ft; R = 0.70 (Z).
  예제의 값은 반올림한 비계수 값(그림 2)을 조합한 것이라 |계산 − 매뉴얼| ≤ 0.01 + 0.5 % 로 본다.
- 두 예제의 랩 구간 강도는 가정 (c) 「겹친 부재 강도의 합」(II-1A: φMnℓ = 0.90(11.3 + 8.66)) — 엔진의 강성 몫(결정 S3)은
  설계 가정이며 그 합은 참고값(reference_basis)으로 싣는다.
"""

import hashlib
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'python'))
sys.path.insert(0, HERE)

from design.loads.required_strength import analyze_loads, _calc_deck_info  # noqa: E402
from design.loads.bracing import calc_rotational_stiffness  # noqa: E402
from design.lap_connection import design_lap_connection, check_lap_length, _fastener_pns  # noqa: E402
from design.connections import design_connection  # noqa: E402
import span_sections_1128_cases as C  # noqa: E402

BASELINE = os.path.join(HERE, 'span_sections_1128_baseline.json')

# span_sections 를 주면 더해지는 키(옛 키 · 값은 그대로) — 같은 단면 시험에서 이 키를 빼고 견준다
REGION_NEW_KEYS = {'span', 'spans', 'crosses_support', 'lap_portions', 'lap_support', 'lap_side', 'lap_end_ft',
                   'continuous_member_span', 'ending_member_span', 'lap_members', 'Ixx_members',
                   'share_by_stiffness', 'share_basis', 'reference_basis', 'same_section', 'depth_mismatch',
                   'lap_evaluable', 'not_evaluable_reason', 'uplift_R'}
AUTO_NEW_KEYS = {'deck_by_span', 'i621_by_span', 'uplift_R_by_span', 'span_map', 'i621_check_span'}


def _sha(obj):
    return hashlib.sha256(C.canon(obj).encode()).hexdigest()


def _strip(obj):
    """span_sections 로 더해진 키를 뺀 사본(구간 기록 = start_ft 를 가진 dict)."""
    if isinstance(obj, list):
        return [_strip(x) for x in obj]
    if not isinstance(obj, dict):
        return obj
    out = {}
    for k, v in obj.items():
        if 'start_ft' in obj and k in REGION_NEW_KEYS:
            continue
        if k in AUTO_NEW_KEYS or k == 'positive_pieces' or (k == 'I_span_in4' and 'D_diagram' in obj):
            continue
        out[k] = _strip(v)
    return out


def _regions(ap):
    """auto_params 의 모든 구간 기록(목록 이름, 기록)."""
    out = []
    ub = ap.get('unbraced') or {}
    for key in ('positive_regions', 'negative_regions', 'lap_regions'):
        out += [('gravity.' + key, r) for r in ub.get(key) or []]
    up = (ap.get('uplift_bracing') or {}).get('unbraced') or {}
    for key in ('positive_regions', 'negative_regions', 'lap_regions'):
        out += [('uplift.' + key, r) for r in up.get(key) or []]
    out += [('uplift.positive_pieces', r) for r in (ap.get('uplift_bracing') or {}).get('positive_pieces') or []]
    return out


def _close(calc, manual):
    return abs(calc - manual) <= 0.01 + 0.005 * abs(manual)


def _codes(result, key='warnings'):
    return [getattr(w, 'code', None) for w in result.get(key) or []]


# ------------------------------------------------------------------ (a) 새 입력 없음 → 기준과 같다
def test_no_new_input_matches_stored_baseline():
    """엔진을 고치기 전(HEAD 253adb1)의 결과와 바이트(정규 JSON 의 sha256)까지 같다 — 하중 해석 6 경우, 랩 접합 4 경우."""
    base = json.load(open(BASELINE, encoding='utf-8'))
    got = {}
    for name, kw in C.load_cases():
        got[name] = _sha(analyze_loads(**kw))
    for name, p in C.lap_cases():
        got[name] = _sha(design_lap_connection(dict(p)))
    assert got == base, {k: (got[k] == base.get(k)) for k in got}


# ------------------------------------------------------------------ (b) 모든 경간에 같은 단면 → 단면 하나와 같다
def test_same_section_every_span_equals_single_section():
    for name, kw in C.load_cases():
        if name == 'cont4_Ispan_given':      # I_span_in4 가 단면 Ixx 와 달라 결정 S6 의 경고가 붙는 경우 — (d) 에서
            continue
        kw = dict(kw)
        sec = kw.pop('section')
        one = analyze_loads(**kw, section=dict(sec))
        n = one['n_spans']
        per = analyze_loads(**kw, span_sections=[dict(sec, id='S1') for _ in range(n)])
        assert C.canon(_strip(per)) == C.canon(one), name
        ap = per['auto_params']
        assert all(d['kphi'] == ap['deck']['kphi'] and d['kx'] == ap['deck']['kx'] for d in ap['deck_by_span']), name
        assert ap['uplift_R_by_span'] is not None and 'span_map' in ap, name
        if 'i621_by_span' in ap:
            assert all(b['R'] == ap['uplift_R'] for b in ap['i621_by_span'] if b['real_span']), name
        for lst, r in _regions(ap):
            assert isinstance(r['span'], int) and r['spans'], (name, lst)
            if 'lap_members' in r:
                assert r['share_by_stiffness'] == [0.5, 0.5] and r['same_section'] is True, (name, lst)


# ------------------------------------------------------------------ (c) 두 단면, 4 경간 랩
def _two_section_run(interior=None, **extra):
    kw = dict(C.load_cases()[0][1])
    kw.pop('section')
    a = dict(C.SEC_C070, id='S1')
    b = dict(interior or C.SEC_C059, id='S2')
    return analyze_loads(**kw, span_sections=[a, b, b, a], **extra), kw


def test_two_sections_per_span_stiffness_deck_and_regions():
    r, kw = _two_section_run()
    ap = r['auto_params']
    # 경간별 Ix = 그 단면의 Ixx — I_span_in4 를 직접 준 해석과 같은 소요(가정 (b) 의 비등단면 보)
    ref = analyze_loads(**kw, section=dict(C.SEC_C070), I_span_in4=[12.2, 10.3, 10.3, 12.2])
    assert [s['Ixx_used'] for s in ap['span_map']['spans']] == [12.2, 10.3, 10.3, 12.2]
    assert r['gravity']['M_envelope_min'] == ref['gravity']['M_envelope_min']
    assert r['uplift']['M_envelope_max'] == ref['uplift']['M_envelope_max']
    assert r['deflection']['I_span_in4'] == [12.2, 10.3, 10.3, 12.2]
    # 데크 kφ 는 경간마다 그 단면의 t (Gao & Moen, Example II-1C 3b) — 두 값이 다르고 각각 식과 같다
    k = [calc_rotational_stiffness(t_panel=0.019, t_purlin=t, fastener_spacing=12, flange_width=2.5, E=29500.0)
         for t in (0.070, 0.059, 0.059, 0.070)]
    assert [round(d['kphi'], 4) for d in ap['deck_by_span']] == [round(x, 4) for x in k]
    assert ap['deck_by_span'][0]['kphi'] > ap['deck_by_span'][1]['kphi']
    d0 = _calc_deck_info(dict(C.DECK_TF), dict(C.SEC_C070))                      # 옛 키 = 첫 경간의 단면
    assert (ap['deck']['kphi'], ap['deck']['kx']) == (d0['kphi'], d0['kx']) ==         (ap['deck_by_span'][0]['kphi'], ap['deck_by_span'][0]['kx'])
    # §I6.2.1 — 두 단면 모두 조건을 만족: C 연속보 R = 0.60 (Example II-1A)
    assert ap['uplift_R_by_span'] == [0.6, 0.6, 0.6, 0.6] and ap['uplift_R'] == 0.6
    # 모든 구간에 경간
    regs = _regions(ap)
    assert len(regs) > 20
    xs = ap['span_map']['supports_ft']
    for lst, g in regs:
        a, b = g['start_ft'], g['end_ft']
        assert isinstance(g['span'], int) and 0 <= g['span'] < 4, (lst, g)
        assert xs[g['span']] - 1e-6 <= 0.5 * (a + b) <= xs[g['span'] + 1] + 1e-6 or g.get('crosses_support'), (lst, g)
        if 'lap_members' in g:
            j = g['lap_support']
            assert g['spans'] == [j - 1, j]
            assert g['span'] == (j - 1 if g['lap_side'] == 'left' else j)
            assert abs(sum(g['share_by_stiffness']) - 1.0) < 1e-15
            I = [12.2, 10.3, 10.3, 12.2]
            assert g['share_by_stiffness'] == [I[j - 1] / (I[j - 1] + I[j]), I[j] / (I[j - 1] + I[j])]
            assert [m['section_id'] for m in g['lap_members']] == [['S1', 'S2', 'S2', 'S1'][j - 1],
                                                                   ['S1', 'S2', 'S2', 'S1'][j]]
            roles = [m['role'] for m in g['lap_members']]
            assert roles == (['continuous', 'ends_at_lap_end'] if g['lap_side'] == 'left'
                             else ['ends_at_lap_end', 'continuous'])
            assert g['reference_basis'] == 'sum_of_strengths' and g['lap_evaluable'] is True
        else:
            assert g['spans'] and g['span'] in g['spans'], (lst, g)
    # 중력 랩 구간 6개(지점마다 왼쪽 · 오른쪽), 지점 2 의 몫 = 12.2 / 22.5
    laps = ap['lap_regions']
    assert len(laps) == 6 and laps[0]['share_by_stiffness'][0] == 12.2 / 22.5
    assert 'loads.assumption.lap_stiffness_share' in _codes(r, 'assumptions')
    assert 'loads.assumption.span_sections_per_span' in _codes(r, 'assumptions')


def test_two_sections_i621_per_span():
    """안 경간 단면이 (c) d/t ≤ 170 을 넘으면(9 / 0.050 = 180) 그 경간만 R 없음 — 끝 경간은 0.60, 옛 uplift_R 은 없음."""
    thin = dict(C.SEC_C059, thickness=0.050, Ixx=8.8)
    r, _ = _two_section_run(interior=thin)
    ap = r['auto_params']
    assert ap['uplift_R_by_span'] == [0.6, None, None, 0.6]
    assert ap['uplift_R'] is None and ap['i621_check_span'] == 1
    c = {x['id']: x['status'] for x in ap['i621_by_span'][1]['check']['conditions']}
    assert c['(c)'] == 'fail' and ap['i621_by_span'][0]['all_pass'] is True
    for g in ap['uplift_bracing']['negative_regions']:
        assert g['uplift_R'] == (0.6 if g['span'] in (0, 3) and g['i621_region_eligible'] else None), g
    assert 'loads.warning.i621_r_some_spans_only' in _codes(r)


def test_lap_depth_mismatch_and_section_change_without_lap():
    deep = dict(C.SEC_C059, depth=10.0, Ixx=13.0)
    r, kw = _two_section_run(interior=deep)
    laps = r['auto_params']['lap_regions']
    mis = [g for g in laps if g['lap_support'] in (1, 3)]          # S1 | S2 — 9 in. 와 10 in.
    same = [g for g in laps if g['lap_support'] == 2]              # S2 | S2
    assert mis and all(g['depth_mismatch'] and g['lap_evaluable'] is False for g in mis)
    assert same and all(not g['depth_mismatch'] and g['lap_evaluable'] is True for g in same)
    laps = mis
    assert getattr(laps[0]['not_evaluable_reason'], 'code', None) == 'loads.reason.lap_depth_mismatch'
    assert 'loads.warning.lap_depth_mismatch' in _codes(r)
    # 랩 없는 지점에서 단면이 바뀌면 알린다
    kw2 = dict(kw, laps_per_support=None)
    r2 = analyze_loads(**kw2, span_sections=[dict(C.SEC_C070), dict(C.SEC_C059), dict(C.SEC_C059), dict(C.SEC_C070)])
    assert _codes(r2).count('loads.warning.section_change_without_lap') == 2
    assert [s['section_id'] for s in r2['auto_params']['span_map']['spans']] == ['S1', 'S2', 'S2', 'S1']


# ------------------------------------------------------------------ (d) I_span_in4 와 단면의 Ixx (결정 S6)
def test_given_I_span_warns_when_it_differs_from_section():
    kw = dict(C.load_cases()[0][1])
    kw.pop('section')
    secs = [dict(C.SEC_C070), dict(C.SEC_C059), dict(C.SEC_C059), dict(C.SEC_C070)]
    given = [12.5, 10.35, 10.3, 12.0]     # 경간 1: +2.5 %, 경간 2: +0.49 %, 경간 4: −1.6 %
    r = analyze_loads(**kw, span_sections=secs, I_span_in4=given)
    w = [x for x in r['warnings'] if getattr(x, 'code', None) == 'loads.warning.span_ix_differs_from_section']
    assert [x.values['span'] for x in w] == [1, 4]
    assert [s['Ixx_used'] for s in r['auto_params']['span_map']['spans']] == given
    ref = analyze_loads(**kw, section=dict(C.SEC_C070), I_span_in4=given)
    assert r['gravity']['M_envelope_min'] == ref['gravity']['M_envelope_min']
    try:
        analyze_loads(**kw, span_sections=[dict(C.SEC_C070), {'type': 'C', 'depth': 9.0}, dict(C.SEC_C059),
                                           dict(C.SEC_C070)])
    except ValueError as e:
        assert 'Ixx' in str(e)
    else:
        raise AssertionError('partial Ixx must be refused')


# ------------------------------------------------------------------ (e) 두 부재의 랩 접합 (결정 S4 · S5)
LAP2 = dict(C.LAP_BASE, t=0.070, Pnvs=3.0, Se=2.47, Mnd=120.0, lap_restrained=True, lap_force_model_confirmed=True)


def _pns_direct(t1, t2):
    r = design_connection({'connection_type': 'screw', 'design_method': 'LRFD', 'Fy': 55.0, 'Fu': 70.0,
                           't1': t1, 't2': t2, 'd': 0.19, 'n': 1, 'Pu': 0, 'e': 0.5, 'Pnvs': 3.0})
    return _fastener_pns(r)[0]          # 랩 접합이 쓰는 것과 같은 고르기(전단 방향 한계상태의 최소)


def test_lap_connection_two_thicknesses_thinner_governs():
    one = design_lap_connection(dict(LAP2))                        # 두 부재 모두 0.070
    two = design_lap_connection(dict(LAP2, t_2=0.059, Se_2=1.89, Mnd_2=95.0, Ixx=12.2, Ixx_2=10.3))
    assert not one.get('error') and not two.get('error')
    p_ab, p_ba = _pns_direct(0.070, 0.059), _pns_direct(0.059, 0.070)
    assert abs(two['display_unrounded']['Pns'] - min(p_ab, p_ba)) < 1e-12
    assert two['display_unrounded']['Pns'] < one['display_unrounded']['Pns']
    mg = two['member_governing']
    assert mg['fastener_bearing_tilting'] == 2 and mg['block_shear'] == 2
    assert mg['fastener_orientation'] == {'t1_head_side': 0.070, 't2_far_side': 0.059}
    # 팔: min(9 − 0.070, 9 − 0.059) = 8.930 (부재 1)
    assert mg['lever_arm'] == 1 and abs(two['V_transfer'] - 144.0 / 8.930) < 1e-12
    # 랩 휨: Mn,lap = min(Mnℓ,i / s_i), s = I_i / ΣI (결정 S3); 참고 = 강도의 합 (매뉴얼 가정 (c))
    s1, s2 = 12.2 / 22.5, 10.3 / 22.5
    mn = min(2.47 * 55.0 / s1, 1.89 * 55.0 / s2)
    assert abs(two['display_unrounded']['Mn_lap'] - mn) < 1e-9 and mg['flexure_local'] == 2
    assert two['share_by_stiffness'] == [s1, s2]
    ref = two['flexure_reference_sum_of_strengths']
    assert abs(ref['Mn_lap'] - (2.47 + 1.89) * 55.0) < 1e-9
    assert mg['flexure_distortional'] is None       # lap_restrained — 뒤틀림 해당 없음
    assert 'lap.assumption.two_members' in _codes(two, 'assumptions')
    loc = next(c for c in two['design_checks'] if c['id'] == 'lap.flexure.local')
    assert loc['governing_member'] == 2 and loc['reference_sum_of_strengths']['ratio'] == ref['dcr']


def test_lap_connection_same_second_member_equals_single():
    for name, p in C.lap_cases():
        one = design_lap_connection(dict(p))
        same = design_lap_connection(dict(p, t_2=p['t'], d_2=p['d']))
        for k in ('pass', 'verdict', 'Pns', 'V_transfer', 'capacity', 'Mn_lap', 'phi_Mn_lap', 'flexure_dcr',
                  'flexure_dcr_governing', 'utilization', 'n_required', 'n_total'):
            assert one[k] == same[k], (name, k, one[k], same[k])
        assert [(c['id'], c['verdict'], c['ratio']) for c in one['design_checks']] == \
               [(c['id'], c['verdict'], c['ratio']) for c in same['design_checks']], name
        assert same['share_by_stiffness'] == [0.5, 0.5] and same['same_members'] is True, name


def test_lap_connection_different_depths_not_evaluated():
    r = design_lap_connection(dict(LAP2, t_2=0.059, d_2=8.0, Se_2=1.5, Ixx=12.2, Ixx_2=8.0))
    assert r['pass'] is None and r['verdict'] == 'NOT_CHECKED' and r['lap_evaluable'] is False
    assert all(c['verdict'] in ('not_evaluated', 'not_applicable') for c in r['design_checks'])
    assert getattr(r['not_evaluable_reason'], 'code', None) == 'lap.reason.depth_mismatch'
    assert 'lap.warning.depth_mismatch' in _codes(r)
    ll = check_lap_length(9.0, 24.0, 33.0, d_2=8.0)
    assert ll['ok'] is None and ll['depth_mismatch'] is True
    assert check_lap_length(9.0, 24.0, 33.0, d_2=9.0) == dict(check_lap_length(9.0, 24.0, 33.0), depth_mismatch=False)


def test_lap_connection_second_member_without_se_is_not_evaluated():
    r = design_lap_connection(dict(LAP2, t_2=0.059))
    v = {c['id']: c['verdict'] for c in r['design_checks']}
    assert v['lap.flexure.local'] == 'not_evaluated' and r['pass'] is None
    loc = next(c for c in r['design_checks'] if c['id'] == 'lap.flexure.local')
    assert getattr(loc['reason'], 'code', None) == 'lap.reason.member2_value_missing'


# ------------------------------------------------------------------ (f) 설계 매뉴얼 II-1A · II-2A 의 소요 강도
def _loc(res, name):
    return next(l for l in res['locations'] if l['name'] == name)['unrounded']


def test_manual_II_1A_required_strengths_with_span_sections():
    S = [dict(C.SEC_C070, id='9CS2.5x070'), dict(C.SEC_C059, id='9CS2.5x059'),
         dict(C.SEC_C059, id='9CS2.5x059'), dict(C.SEC_C070, id='9CS2.5x070')]
    g = analyze_loads('roof-purlin', 'cont-4', 25.0, {'D': 15, 'Lr': 90}, 'LRFD', laps_per_support=C.LAPS_II1A,
                      span_sections=S, deck=dict(C.DECK_TF))
    gr = g['gravity']
    assert gr['combo'].endswith('1.2D+1.6Lr')
    m = {'End span +M': 7.36, 'Lap end (left of sup 2)': -7.34, '1st interior': -12.0,
         'Lap end (right of sup 2)': -6.54, 'Int span 2 +M': 3.16, 'Lap end (left of sup 3)': -5.00, 'Center': -7.16}
    for name, manual in m.items():
        assert _close(_loc(gr, name)['Mu'], manual), (name, _loc(gr, name)['Mu'], manual)
    v = [('End support (left)', 'Vu_right', 1.54), ('Lap end (left of sup 2)', 'Vu', 2.18),
         ('1st interior', 'Vu_left', 2.50), ('1st interior', 'Vu_right', 2.22), ('Lap end (right of sup 2)', 'Vu', 1.78),
         ('Lap end (left of sup 3)', 'Vu', 1.62), ('Center', 'Vu_left', 1.84)]
    for name, key, manual in v:
        assert _close(_loc(gr, name)[key], manual), (name, key, _loc(gr, name)[key], manual)
    for name, manual in (('End support (left)', 1.54), ('1st interior', 4.74), ('Center', 3.66)):
        assert _close(_loc(gr, name)['R_bearing'], manual), (name, manual)
    u = analyze_loads('roof-purlin', 'cont-4', 25.0, {'D': 15, 'W': -144}, 'LRFD', laps_per_support=C.LAPS_II1A,
                      span_sections=S, deck=dict(C.DECK_TF))
    up = u['uplift']
    assert up['combo'].endswith('0.9D+1.0W')
    assert _close(_loc(up, 'End span -M')['Mu'], -5.93) and _close(_loc(up, 'Int span 2 -M')['Mu'], -2.56)
    assert u['auto_params']['uplift_R_by_span'] == [0.6] * 4       # II-1A: R = 0.60 (C, 연속)


def test_manual_II_2A_required_strengths_with_overhangs():
    A, B = dict(C.SEC_Z070, id='8ZS2.25x070'), dict(C.SEC_Z059, id='8ZS2.25x059')
    laps = [None, None, {'left_ft': 2.5, 'right_ft': 3.5}, {'left_ft': 1.0, 'right_ft': 1.0},
            {'left_ft': 3.5, 'right_ft': 2.5}, None, None]
    common = dict(spans_ft=[1, 25, 25, 25, 25, 1], supports=['N', 'P', 'P', 'P', 'P', 'P', 'N'],
                  laps_per_support=laps, span_sections=[A, A, B, B, A, A], deck=dict(C.DECK_TF))
    g = analyze_loads('roof-purlin', 'cont-n', 25.0, {'D': 15, 'Lr': 100}, 'ASD', **common)
    gr = g['gravity']
    m = {'Overhang (left) -M': -0.06, 'End span +M': 5.11, 'Lap end (left of sup 3)': -4.65, '1st interior': -8.75,
         'Lap end (right of sup 3)': -3.89, 'Int span 3 +M': 2.23, 'Lap end (left of sup 4)': -3.73, 'Center': -4.95}
    for name, manual in m.items():
        assert _close(_loc(gr, name)['Mu'], manual), (name, _loc(gr, name)['Mu'], manual)
    v = [('End support (left)', 'Vu_right', 1.09), ('Lap end (left of sup 3)', 'Vu', 1.50),
         ('1st interior', 'Vu_left', 1.78), ('1st interior', 'Vu_right', 1.59), ('Lap end (right of sup 3)', 'Vu', 1.18),
         ('Lap end (left of sup 4)', 'Vu', 1.17), ('Center', 'Vu_left', 1.29)]
    for name, key, manual in v:
        assert _close(_loc(gr, name)[key], manual), (name, key, _loc(gr, name)[key], manual)
    for name, manual in (('End support (left)', 1.21), ('1st interior', 3.37), ('Center', 2.58)):
        assert _close(_loc(gr, name)['R_bearing'], manual), (name, manual)
    u = analyze_loads('roof-purlin', 'cont-n', 25.0, {'D': 15, 'W': -170}, 'ASD', **common)
    up = u['uplift']
    assert _close(_loc(up, 'End span -M')['Mu'], -4.13) and _close(_loc(up, 'Int span 3 -M')['Mu'], -1.81)
    ap = u['auto_params']
    assert ap['uplift_R_by_span'] == [None, 0.7, 0.7, 0.7, 0.7, None] and ap['uplift_R'] == 0.7
    # 내민 경간(N 끝)은 경간 번호 0 · 5 — 그 구간은 §I6.2.1 밖
    for g2 in ap['uplift_bracing']['negative_regions']:
        if g2['span'] in (0, 5):
            assert g2['uplift_R'] is None
