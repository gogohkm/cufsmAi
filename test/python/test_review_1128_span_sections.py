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
- 두 예제의 랩 구간 강도는 가정 (c) 「겹친 부재 강도의 합」(II-1A: φMnℓ = 0.90(11.3 + 8.66) = 18.0 kip-ft) — 결정 S3′
  (2026-11-28 오후)부터 엔진도 그 합으로 판정(strength_basis), 강성 몫은 참고값(reference_basis = stiffness_share).
- 데크 강성은 설계 매뉴얼 II-1C 처럼 한 번(결정 S7′ — 쓰이는 단면 가운데 kφ 가 가장 작은 단면): x070 0.1417 · x059 0.1126
  kip-in/rad/in → 모든 경간에 0.1126.
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
                   'share_by_stiffness', 'strength_basis', 'reference_basis', 'same_section', 'depth_mismatch',
                   'lap_evaluable', 'not_evaluable_reason', 'uplift_R'}
AUTO_NEW_KEYS = {'deck_basis', 'i621_by_span', 'uplift_R_by_span', 'span_map', 'i621_check_span'}


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
        db = ap['deck_basis']                       # 결정 S7′: 단면 하나 — 그 단면의 데크 값 그대로
        assert db['kphi_section_id'] == db['kx_section_id'] == 'S1' and [r['section_id'] for r in db['by_section']] == ['S1'], name
        assert db['by_section'][0]['spans'] == list(range(n)) and db['by_section'][0]['adopted_kphi'] is True, name
        assert db['by_section'][0]['adopted_kx'] is True, name
        assert (db['by_section'][0]['kphi'], db['by_section'][0]['kx']) == (ap['deck']['kphi'], ap['deck']['kx']), name
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
    # 결정 S7′: 데크 강성은 한 번 — 쓰이는 단면 가운데 kφ 가 가장 작은 단면(두께만 다르면 얇은 쪽, Design Manual II-1C 의
    # 「안전측의 근사」). 단면마다의 kφ 는 식(Gao & Moen, Example II-1C 3b) 그대로 참고로: x070 0.1417, x059 0.1126 kip-in/rad/in
    k = {t: calc_rotational_stiffness(t_panel=0.019, t_purlin=t, fastener_spacing=12, flange_width=2.5, E=29500.0)
         for t in (0.070, 0.059)}
    db = ap['deck_basis']
    # F2 의 2: kφ 와 kx 를 따로 가장 작은 값 — 두께만 다른 두 부재(매뉴얼의 경우)는 둘 다 얇은 쪽(S2)
    assert db['rule'] == 'once_smallest_kphi_and_kx' and db['kphi_section_id'] == db['kx_section_id'] == 'S2'
    assert 'section_id' not in db
    assert [(r['section_id'], r['spans'], r['adopted_kphi'], r['adopted_kx']) for r in db['by_section']] == [
        ('S1', [0, 3], False, False), ('S2', [1, 2], True, True)]
    assert [r['kphi'] for r in db['by_section']] == [round(k[0.070], 4), round(k[0.059], 4)] == [0.1417, 0.1126]
    d2 = _calc_deck_info(dict(C.DECK_TF), dict(C.SEC_C059, id='S2'))             # 모든 데크 값이 그 한 단면에서
    keys = ('kphi', 'kx', 'kphi_method', 'kx_method', 'display_unrounded', 'type')
    assert {k: ap['deck'][k] for k in keys} == {k: d2[k] for k in keys} and ap['deck']['kphi'] == 0.1126
    assert 'deck_by_span' not in ap
    assert ap['positive_region']['kphi'] == 0.1126
    assert 'loads.assumption.deck_once_smallest_kphi' in _codes(r, 'assumptions')
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
            assert [m['stiffness_share'] for m in g['lap_members']] == g['share_by_stiffness']
            assert g['strength_basis'] == 'sum_of_strengths' and g['reference_basis'] == 'stiffness_share'
            assert g['lap_evaluable'] is True and 'share_basis' not in g
        else:
            assert g['spans'] and g['span'] in g['spans'], (lst, g)
    # 중력 랩 구간 6개(지점마다 왼쪽 · 오른쪽), 지점 2 의 몫 = 12.2 / 22.5
    laps = ap['lap_regions']
    assert len(laps) == 6 and laps[0]['share_by_stiffness'][0] == 12.2 / 22.5
    assert 'loads.assumption.lap_sum_of_strengths' in _codes(r, 'assumptions')
    assert 'loads.assumption.span_sections_per_span' in _codes(r, 'assumptions')


def test_deck_once_smallest_kphi_and_kx_taken_separately():
    """검증 2026-11-28 F2 의 2: kφ 가 가장 작은 단면이 플랜지가 좁은 두꺼운 부재라 kx 가 크면(S1 t 0.059 B 2.5 → kφ 0.1126 · kx
    1.388, S2 t 0.080 B 1.75 → kφ 0.1116 · kx 1.829) 옛 규칙은 S2 의 kx 1.829 를 S1 경간에도 주었다(S1 의 정모멘트 Mcrd 140.22 →
    142.18 kip-in, +1.4 % — 안전측이 아님). 이제 가장 작은 kφ(S2)와 가장 작은 kx(S1)를 따로 — 어느 단면도 제 값보다 큰 데크 값을 받지 않는다."""
    kw = dict(C.load_cases()[0][1])
    kw.pop('section')
    a = dict(C.SEC_C059, id='S1')
    b = dict(C.SEC_C059, id='S2', thickness=0.080, flange_width=1.75)
    r = analyze_loads(**kw, span_sections=[a, b, b, a])
    ap = r['auto_params']
    db = ap['deck_basis']
    own = {x['section_id']: x for x in db['by_section']}
    da, dbb = _calc_deck_info(dict(C.DECK_TF), a), _calc_deck_info(dict(C.DECK_TF), b)
    assert (own['S1']['kphi'], own['S1']['kx']) == (da['kphi'], da['kx']) == (0.1126, 1.388)
    assert (own['S2']['kphi'], own['S2']['kx']) == (dbb['kphi'], dbb['kx']) == (0.1116, 1.829)
    assert db['rule'] == 'once_smallest_kphi_and_kx' and (db['kphi_section_id'], db['kx_section_id']) == ('S2', 'S1')
    assert [(x['adopted_kphi'], x['adopted_kx']) for x in db['by_section']] == [(False, True), (True, False)]
    deck = ap['deck']
    assert (deck['kphi'], deck['kx']) == (0.1116, 1.388)
    assert deck['display_unrounded'] == {'kphi': dbb['display_unrounded']['kphi'], 'kx': da['display_unrounded']['kx']}
    assert (deck['kphi_method'], deck['kx_method']) == (dbb['kphi_method'], da['kx_method'])
    # 어느 단면도 제 값보다 큰 데크 값을 받지 않는다
    assert all(deck['kphi'] <= x['kphi'] and deck['kx'] <= x['kx'] for x in db['by_section'])
    assert ap['positive_region']['kphi'] == 0.1116
    n = next(x for x in r['assumptions'] if getattr(x, 'code', None) == 'loads.assumption.deck_once_smallest_kphi')
    assert 'kphi 0.1116 kip-in/rad/in from section S2, kx from section S1' in str(n), str(n)
    # 두께만 다른 매뉴얼의 경우는 한 단면(위 시험) — 같은 단면이면 그 단면의 데크 결과 그대로
    same = analyze_loads(**kw, span_sections=[a, a, a, a])['auto_params']
    assert same['deck_basis']['kphi_section_id'] == same['deck_basis']['kx_section_id'] == 'S1'


def test_deck_once_section_without_dims_is_an_error():
    """F2 의 2: 데크 강성을 계산하지 못하는 단면(두께 · 플랜지 폭 없음)은 말없이 0(모든 경간의 값)이 되거나 건너뛰지 않는다 — 오류와 까닭.
    시험값(kphi_override · kx_override)을 주면 계산하지 않으므로 그대로."""
    kw = dict(C.load_cases()[0][1])
    kw.pop('section')
    a = dict(C.SEC_C070, id='S1')
    b = {k: v for k, v in C.SEC_C059.items() if k != 'flange_width'}
    b['id'] = 'S2'
    try:
        analyze_loads(**kw, span_sections=[a, b, b, a])
    except ValueError as e:
        assert 'section S2' in str(e) and 'flange width' in str(e), str(e)
    else:
        raise AssertionError('a section without flange width must not give a deck stiffness of 0 silently')
    kw2 = dict(kw, deck=dict(C.DECK_TF, kphi_override=0.1, kx_override=1.0))
    r = analyze_loads(**kw2, span_sections=[a, b, b, a])
    assert (r['auto_params']['deck']['kphi'], r['auto_params']['deck']['kx']) == (0.1, 1.0)
    # 데크 없음: 데크 값이 없으니 그대로
    r0 = analyze_loads(**dict(kw, deck={'type': 'none'}), span_sections=[a, b, b, a])
    assert r0['auto_params']['deck']['kphi'] == 0


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
    # 랩 휨(결정 S3′): Mn,lap = Mnℓ,1 + Mnℓ,2 — 두 부재 강도의 합(매뉴얼 가정 (c)); 참고 = 강성 몫 min(Mnℓ,i / s_i), s = I_i / ΣI
    s1, s2 = 12.2 / 22.5, 10.3 / 22.5
    assert abs(two['display_unrounded']['Mn_lap'] - (2.47 + 1.89) * 55.0) < 1e-9 and mg['flexure_local'] == 'sum'
    assert abs(two['flexure_dcr'] - round(144.0 / (0.9 * (2.47 + 1.89) * 55.0), 4)) < 1e-12
    assert two['share_by_stiffness'] == [s1, s2] and [m['stiffness_share'] for m in two['lap_members']] == [s1, s2]
    assert two['strength_basis'] == 'sum_of_strengths' and two['reference_basis'] == 'stiffness_share'
    assert 'share_basis' not in two and 'flexure_reference_sum_of_strengths' not in two
    ref = two['flexure_reference_stiffness_share']
    assert abs(ref['Mn_lap'] - min(2.47 * 55.0 / s1, 1.89 * 55.0 / s2)) < 1e-9 and ref['governing_member'] == 2
    assert abs(ref['dcr'] - 144.0 / (0.9 * ref['Mn_lap'])) < 1e-12 and ref['dcr'] > 144.0 / (0.9 * (2.47 + 1.89) * 55.0)
    assert [m['Mnl'] for m in two['lap_members']] == [2.47 * 55.0, 1.89 * 55.0]
    # 설계 매뉴얼 II-1A(첫 내부 지점의 랩): φMnℓ = 0.90 (11.3 + 8.66) = 18.0 kip-ft, Mu 12.0 kip-ft → 0.667
    assert _close(two['phi_Mn_lap'] / 12.0, 18.0) and abs(two['flexure_dcr'] - 0.667) < 0.001
    assert mg['flexure_distortional'] is None       # lap_restrained — 뒤틀림 해당 없음
    assert 'lap.assumption.two_members' in _codes(two, 'assumptions')
    loc = next(c for c in two['design_checks'] if c['id'] == 'lap.flexure.local')
    assert loc['strength_basis'] == 'sum_of_strengths' and 'governing_member' not in loc
    assert loc['reference_stiffness_share']['ratio'] == ref['dcr'] and loc['reference_stiffness_share']['governing_member'] == 2
    # H2 도 합한 강도로: Va = φ(Vn,1 + Vn,2), Ma = φ(Mnℓ,1 + Mnℓ,2)
    h2 = next(c for c in two['design_checks'] if c['id'] == 'lap.bending_shear')
    vn = [m['Vn'] for m in two['lap_members']]
    want = ((144.0 / (0.9 * (2.47 + 1.89) * 55.0)) ** 2 + (2.5 / (0.95 * (vn[0] + vn[1]))) ** 2) ** 0.5
    assert abs(h2['ratio'] - want) < 1e-12 and h2['strength_basis'] == 'sum_of_strengths', (h2['ratio'], want)
    assert h2['reference_stiffness_share']['ratio'] >= h2['ratio'] - 1e-12


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
