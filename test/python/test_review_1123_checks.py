"""2026-11-23 검토 항목 계약(design_checks) — 일관성 시험과 Manual 손계산 대조.

계약: docs/implementation/20261123-check-contract.md. 사례: contract_cases_1123.py(기준선 비교와 같은 목록).
기대값은 코드가 낸 값을 베끼지 않는다 — 일관성은 결과의 옛 키와, 중간값은 AISI Cold-Formed Steel
Design Manual (2017) 의 인쇄값과 맞댄다(허용오차와 출처는 각 시험에 적었다).
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'python'))
sys.path.insert(0, HERE)

from design.checks import (  # noqa: E402
    REGISTRY, VERDICTS, STEP_KINDS, QUANTITIES, SOURCE_KINDS, overall_verdict,
)
from design.aisi_s100 import design_member  # noqa: E402
from design.connections import design_connection  # noqa: E402
from design.lap_connection import design_lap_connection  # noqa: E402
import contract_cases_1123 as cases  # noqa: E402

_ENGINE = {'aisi_design': design_member, 'design_connection': design_connection,
           'lap_connection': design_lap_connection}
_CACHE = {}


def _results():
    """사례마다 (이름, 엔진이 직접 낸 결과, server 경로로 JSON 왕복한 결과)."""
    if 'r' not in _CACHE:
        import copy
        out = []
        for name, method, params in cases.design_cases():
            direct = _ENGINE[method](copy.deepcopy(params))
            via = cases.run_case(method, params)
            out.append((name, direct, via))
        _CACHE['r'] = out
    return _CACHE['r']


def _all_check_lists(result):
    """결과 안의 design_checks 목록들(랩은 fastener_design 안에도 있다)."""
    lists = []
    if isinstance(result, dict):
        if isinstance(result.get('design_checks'), list):
            lists.append((result, result['design_checks']))
        fd = result.get('fastener_design')
        if isinstance(fd, dict) and isinstance(fd.get('design_checks'), list):
            lists.append((fd, fd['design_checks']))
    return lists


def _resolve(obj, path):
    cur = obj
    for part in path.replace(']', '').replace('[', '.').split('.'):
        if part == '':
            continue
        cur = cur[int(part)] if part.isdigit() else cur[part]
    return cur


def _close(a, b, rel, label):
    assert a is not None and b is not None, f'{label}: {a} vs {b}'
    assert abs(a - b) <= rel * abs(b), f'{label}: {a} vs {b} (±{rel * 100:.2f} %)'


# ------------------------------------------------------------------ 계약 일관성

def test_every_design_result_has_checks_and_ids_are_registered_and_unique():
    for name, direct, via in _results():
        if 'error' in direct:
            continue
        lists = _all_check_lists(via)
        assert lists, f'{name}: no design_checks'
        for _, checks in lists:
            assert checks, f'{name}: empty design_checks'
            ids = [c['id'] for c in checks]
            for cid in ids:
                assert cid in REGISTRY, f'{name}: unregistered id {cid}'
            assert len(ids) == len(set(ids)), f'{name}: duplicate ids {ids}'
            for c in checks:
                reg = REGISTRY[c['id']]
                assert (c['clause'], c['name'], c['name_ko']) == (reg['clause'], reg['name'], reg['name_ko'])
                assert c['verdict'] in VERDICTS, (name, c['id'], c['verdict'])
        assert 'design_checks_error' not in via, name


def test_vocabularies_and_sources():
    """단계 종류 · 물리량 · 출처는 정해진 어휘만, 단계 입력은 모두 출처를 갖는다."""
    def walk_q(x, where):
        if isinstance(x, dict) and 'quantity' in x and 'symbol' in x:
            assert x['quantity'] in QUANTITIES, (where, x)
        if isinstance(x, dict):
            if 'source' in x and isinstance(x['source'], dict):
                assert x['source'].get('kind') in SOURCE_KINDS, (where, x['source'])
            for k, v in x.items():
                walk_q(v, f'{where}.{k}')
        elif isinstance(x, list):
            for i, v in enumerate(x):
                walk_q(v, f'{where}[{i}]')

    for name, _, via in _results():
        for _, checks in _all_check_lists(via):
            for c in checks:
                walk_q(c, f'{name}:{c["id"]}')
                for i, s in enumerate(c['steps']):
                    assert s['kind'] in STEP_KINDS, (name, c['id'], s['kind'])
                    for inp in s['inputs']:
                        assert isinstance(inp.get('source'), dict), (name, c['id'], i, inp)
                        src = inp['source']
                        if src['kind'] == 'step':
                            j = src['step']
                            assert 0 <= j < i, (name, c['id'], i, src)
                            r = c['steps'][j]['result']
                            assert r['value'] == inp['value'], (name, c['id'], i, inp, r)
                            assert r['quantity'] == inp['quantity'], (name, c['id'], i, inp, r)
                    if s['kind'] == 'branch':
                        assert isinstance(s.get('condition'), str) and isinstance(s.get('holds'), bool)
                if not c['steps']:
                    assert c.get('steps_unavailable'), (name, c['id'])


def test_capacity_mirrors_existing_fields_and_ratio_is_demand_over_capacity():
    n_mirror = 0
    for name, _, via in _results():
        for owner, checks in _all_check_lists(via):
            for c in checks:
                for field, m in (c.get('mirrors') or {}).items():
                    old = _resolve(owner, m['path'])
                    # 평가하지 못한 항목의 값은 reference 에만 있다(계약: not_evaluated 는 capacity/ratio 없음).
                    holder = c.get('reference') if c['verdict'] == 'not_evaluated' else c
                    holder = holder or {}
                    v = holder.get(field)
                    new = v.get('value') if isinstance(v, dict) else v
                    assert new is not None, (name, c['id'], field)
                    if m['digits'] is None:
                        assert new == old, (name, c['id'], field, new, old)
                    else:
                        assert round(new, m['digits']) == old, (name, c['id'], field, new, old, m)
                    n_mirror += 1
                if c['verdict'] in ('pass', 'fail') and c['ratio'] is not None and c['demand'] and c['capacity']:
                    r = c['demand']['value'] / c['capacity']['value']
                    if c.get('ratio_form'):
                        # 지수 n 의 상호작용: 비 = (value/limit)^(1/n) — 하중 배율로 견줄 수 있는 꼴(계약 §4)
                        n_exp = float(c['ratio_form'].split('^(1/')[1].rstrip(')'))
                        r = r ** (1.0 / n_exp)
                    assert abs(r - c['ratio']) <= 1e-12 * max(1.0, abs(r)), (name, c['id'], r, c['ratio'])
    assert n_mirror > 300, n_mirror


def test_governing_check_ratio_equals_existing_utilization():
    """부재: 엔진이 고른 지배 모드의 항목 비 = 옛 이용률(F flexure / E axial compression / D tension).
    그 항목이 평가된 것이면 무리의 지배(governs)이기도 하다."""
    hit = 0
    for name, _, via in _results():
        if via.get('member_type') not in ('compression', 'flexure', 'tension'):
            continue
        main = {'compression': 'E axial compression', 'flexure': 'F flexure', 'tension': 'D tension'}[via['member_type']]
        old = [x['ratio'] for x in via.get('limit_state_checks') or [] if x['name'] == main]
        if not old:
            continue
        mir = [c for c in via['design_checks'] if 'ratio' in (c.get('mirrors') or {})
               and c['mirrors']['ratio']['path'] in ('utilization', 'limit_state_checks[0].ratio')]
        assert len(mir) == 1, (name, [c['id'] for c in mir])
        c = mir[0]
        ratio = c['ratio'] if c['verdict'] in ('pass', 'fail') else (c.get('reference') or {}).get('ratio')
        assert ratio is not None and round(ratio, 4) == old[0], (name, ratio, old)
        if c['verdict'] in ('pass', 'fail'):
            top = max(x['ratio'] for x in via['design_checks'] if x['group'] == c['group']
                      and x['verdict'] in ('pass', 'fail') and x['ratio'] is not None)
            assert c['ratio'] == top, (name, c['id'])
        hit += 1
    assert hit > 40, hit


def test_design_strength_step_equals_capacity_and_no_orphan_numbers():
    for name, _, via in _results():
        for _, checks in _all_check_lists(via):
            for c in checks:
                steps = c['steps']
                if c['verdict'] in ('pass', 'fail') and c['capacity'] and c['capacity']['quantity'] != 'dimensionless':
                    ds = [s for s in steps if s['kind'] == 'design_strength']
                    if ds:
                        assert ds[-1]['result']['value'] == c['capacity']['value'], (name, c['id'])
                ends = set()
                for key in ('capacity', 'demand'):
                    if c.get(key):
                        ends.add(c[key]['value'])
                for v in (c['ratio'], (c.get('reference') or {}).get('ratio')):
                    if v is not None:
                        ends.add(v)
                for v in ((c.get('reference') or {}).get('capacity') or {}, ):
                    if v.get('value') is not None:
                        ends.add(v['value'])
                for i, s in enumerate(steps):
                    r = s.get('result')
                    if not r or r.get('value') is None:
                        continue
                    used = any(inp.get('source') == {'kind': 'step', 'step': i}
                               for later in steps[i + 1:] for inp in later['inputs'])
                    assert used or r['value'] in ends, (name, c['id'], i, s['expr'], r)


def test_not_evaluated_checks_carry_no_demand_capacity_figures():
    for name, _, via in _results():
        for _, checks in _all_check_lists(via):
            for c in checks:
                if c['verdict'] == 'not_evaluated':
                    assert c['capacity'] is None and c['ratio'] is None, (name, c['id'])
                    assert c.get('reason'), (name, c['id'])
                if c['verdict'] == 'not_applicable':
                    assert c['capacity'] is None and c.get('reason'), (name, c['id'])


def test_governing_is_highest_ratio_and_group_and_overall_verdicts_match_engine():
    """무리마다 지배 하나(계약 §4, V6-03): 판정에 드는 불합격 → 그 중 비 최대('fail'), 없고 미평가가 있으면
    그 미평가 항목('not_evaluated', 평가한 최대는 highest_evaluated), 모두 평가했으면 비 최대('ratio').
    전체 판정(fail > not_evaluated > pass) = 엔진의 pass."""
    for name, _, via in _results():
        for owner, checks in _all_check_lists(via):
            groups = {}
            for c in checks:
                groups.setdefault(c['group'], []).append(c)
            for g, items in groups.items():
                gov = [c for c in items if c['governs']]
                assert len(gov) <= 1, (name, g)
                ev = [c for c in items if c['verdict'] in ('pass', 'fail') and c['ratio'] is not None]
                fails = [c for c in ev if c['verdict'] == 'fail' and c['counts']]
                ne = [c for c in items if c['verdict'] == 'not_evaluated' and c['counts']]
                if fails:
                    assert gov and gov[0]['governs_basis'] == 'fail' and                         gov[0]['ratio'] == max(c['ratio'] for c in fails), (name, g)
                elif ne:
                    assert gov and gov[0]['verdict'] == 'not_evaluated' and gov[0]['governs_basis'] == 'not_evaluated'
                    he = gov[0]['highest_evaluated']
                    if ev:
                        assert he['ratio'] == max(c['ratio'] for c in ev), (name, g)
                    else:
                        assert he is None, (name, g)
                elif ev:
                    assert gov and gov[0]['governs_basis'] == 'ratio' and                         gov[0]['ratio'] == max(c['ratio'] for c in ev), (name, g)
            if owner is via or 'pass' in owner:
                if owner.get('pass') is None and owner is not via:
                    continue
                want = {True: 'pass', False: 'fail', None: 'not_evaluated'}[owner.get('pass')]
                if owner is via:
                    assert overall_verdict(checks) == want, (name, want, [(c['id'], c['verdict']) for c in checks])


def test_strict_json_round_trip():
    for name, direct, _ in _results():
        for owner, checks in _all_check_lists(direct):
            text = json.dumps(checks, allow_nan=False)
            assert json.loads(text) == checks, name


def test_context_is_attached_unchanged():
    loc = {'region': 'B right lap end', 'x_in': 79.2}
    r = design_member(dict(cases._member()[0][2], check_location=loc, check_combination='2: 1.2D+1.6Lr+0.5W'))
    for c in r['design_checks']:
        assert c['location'] == loc and c['combination'] == '2: 1.2D+1.6Lr+0.5W'
    assert r['design_checks'][0]['demand']['source']['kind'] == 'load_analysis'
    c = design_connection(dict(cases._iv9('ASD', Pu=1.0), check_location='lap P1-B'))
    assert not any('check_location' in w for w in c['warnings'])
    assert all(x['location'] == 'lap P1-B' for x in c['design_checks'])


def test_element_roles_for_templates_only():
    from engine.template import generate_section
    expect = {
        'lippedc': ({'bottom_lip', 'bottom_flange', 'web', 'top_flange', 'top_lip', 'corner'},
                    dict(H=8.0, B=2.5, D=0.625, t=0.059, r=0.157)),
        'lippedz': ({'bottom_lip', 'bottom_flange', 'web', 'top_flange', 'top_lip', 'corner'},
                    dict(H=8.0, B=2.25, D=0.91, t=0.059, r=0.1875)),
        'track': ({'bottom_flange', 'web', 'top_flange', 'corner'}, dict(H=6.0, B=1.625, t=0.0566, r=0.0849)),
        'hat': ({'brim', 'web', 'top_flange', 'corner'}, dict(H=3.0, B=4.0, D=1.0, t=0.06, r=0.1)),
        'rhs': ({'bottom_flange', 'web', 'top_flange', 'corner'}, dict(H=6.0, B=4.0, t=0.125, r=0.1875)),
        'chs': ({'wall'}, dict(OD=6.0, t=0.12)),
        'angle': ({'leg', 'corner'}, dict(H=3.0, B=2.0, t=0.06, r=0.1)),
        'lipped_angle': ({'lip', 'leg', 'corner'}, dict(H=4.0, B=4.0, D=0.6, t=0.06, r=0.1)),
        'isect': ({'bottom_flange', 'top_flange', 'web'}, dict(H=8.0, B=4.0, t=0.1)),
        'tee': ({'top_flange', 'web'}, dict(H=4.0, B=4.0, t=0.1)),
    }
    for st, (roles, prm) in expect.items():
        sec = generate_section(st, prm)
        er = sec['element_roles']
        assert len(er) == len(sec['elem']), st
        assert set(er) == roles, (st, set(er))
    # 날카로운 모서리 lippedc: 모서리 요소 없음, 웹 요소는 8개(8·nseg)
    sec = generate_section('lippedc', dict(H=8.0, B=2.5, D=0.625, t=0.059, r=0.0))
    assert 'corner' not in sec['element_roles'] and sec['element_roles'].count('web') == 8
    # 손으로 만든 단면(custom)은 자리를 짐작하지 않는다
    cust = generate_section('custom', {'outer_corners': [[0, 0], [0, 3], [2, 3]], 't': 0.06})
    assert 'element_roles' not in cust


# ------------------------------------------------------------------ Manual 대조 (장마다 하나 이상)
# 허용오차: Manual 은 중간값을 3자리로 반올림해 다음 식에 넣는다(예: KxLx/rx = 83.3) — 엔진은 반올림하지
# 않으므로 같은 자리수로 맞지 않을 수 있다. 기존 F4 시험(test_review_1122_member)과 같은 ±0.7 % 를 쓴다.

def _step_value(check, symbol, kind=None):
    for s in check['steps']:
        r = s.get('result')
        if r and r['symbol'] == symbol and (kind is None or s['kind'] == kind):
            return r['value']
    raise AssertionError(f"{check['id']}: no step result {symbol}")


def _by_id(result, cid):
    m = [c for c in result['design_checks'] if c['id'] == cid]
    assert m, cid
    return m[0]


def test_manual_E_III_3_trace():
    """Chapter E — Manual Example III-3 (362S162-54, KxLx 120, KyLy=KtLt 60, Fy 50): σex 42.0, σt 24.4,
    β 0.598, Fcre(E2.2-1) 18.5, σey(E2.1-1) 29.6, λc 1.64, Fn 16.3, Pne 6.88; Py 21.1, Pcrd 1.11·Py → λd."""
    r = design_member(dict(cases._member()[0][2]))
    g = _by_id(r, 'member.compression.global')
    for sym, man in (('σex', 42.0), ('σt', 24.4), ('β', 0.598), ('Fcre,ft', 18.5), ('σey', 29.6),
                     ('λc', 1.64), ('Fn', 16.3), ('Pne', 6.88)):
        _close(_step_value(g, sym), man, 0.007, f'III-3 {sym}')
    br = [s for s in g['steps'] if s['kind'] == 'branch'][0]
    assert br['condition'] == 'λc ≤ 1.5' and br['holds'] is False and br['equation'] == 'E2-3'
    d = _by_id(r, 'member.compression.distortional')
    _close(_step_value(d, 'Py'), 21.1, 0.002, 'III-3 Py')
    # Manual 도해의 Pcrd/Py = 1.11 (FSM) → λd = (1/1.11)^0.5 = 0.949 (독립 계산)
    _close(_step_value(d, 'λd'), math.sqrt(1 / 1.11), 1e-9, 'III-3 λd from Pcrd = 1.11 Py')


def test_manual_F_II_1B_per_mode_design_strengths():
    """Chapter F — Manual Example II-1B (9CS2.5x059, Fy 55, LRFD): My 126, Mne 126 (Fcre ≥ 2.78Fy, Eq. F2.1-3),
    λℓ 1.22, Mnℓ 93.6, φMnℓ 84.2; β 1.23 → Mcrd 132, λd 0.977, Mnd 99.9, φMnd 89.9; φMne 113.
    Manual 은 모드마다 설계강도를 내고 최소(84.2, 국부)를 지배로 본다 — 계산서의 모드별 검토와 같은 꼴.
    엔진에는 Manual 의 FSM 값(Mcrl 84.4, Mcrd/My 0.85, Lcrd 25)을 준다. Fcre 는 Example II-1A 의 폐형식
    (Eq. F2.1.1-1: σey 72.8, σt 82.4, Fcre 194 ksi)으로 엔진이 계산한다."""
    p = dict(member_type='flexure', design_method='LRFD', Fy=55.0, Lb=56.3, Cb=1.67, Mu=60.0, section_type='C',
             props=dict(cases.C9), dsm=dict(Mcrl=84.4, Mcrd=0.85 * 126.0, My=126.0, Lcrd=25.0),
             dist_M1_M2=0.0, dist_Lm=56.3)
    r = design_member(p)
    g = _by_id(r, 'member.flexure.global')
    l_ = _by_id(r, 'member.flexure.local')
    d = _by_id(r, 'member.flexure.distortional')
    for sym, man in (('σey', 72.8), ('σt', 82.4), ('Fcre', 194)):
        _close(_step_value(g, sym), man, 0.007, f'II-1A {sym}')
    assert [s for s in g['steps'] if s['kind'] == 'elastic_buckling'][-1]['equation'] == 'F2.1.1-1'
    _close(_step_value(g, 'Mne'), 126, 0.007, 'II-1B Mne')
    assert [s for s in g['steps'] if s['kind'] == 'branch'][0]['equation'] == 'F2.1-3'
    _close(g['capacity']['value'], 113, 0.007, 'II-1B φMne')
    _close(_step_value(l_, 'λℓ'), 1.22, 0.007, 'II-1B λℓ')
    _close(_step_value(l_, 'Mnℓ'), 93.6, 0.007, 'II-1B Mnℓ')
    _close(l_['capacity']['value'], 84.2, 0.007, 'II-1B φMnℓ')
    _close(_step_value(d, 'My', 'yield'), 126, 0.007, 'II-1B My')
    _close(_step_value(d, 'β'), 1.23, 0.007, 'II-1B β')
    _close(_step_value(d, 'Mcrd', 'modifier'), 132, 0.007, 'II-1B βMcrd')
    _close(_step_value(d, 'λd'), 0.977, 0.007, 'II-1B λd')
    _close(_step_value(d, 'Mnd'), 99.9, 0.007, 'II-1B Mnd')
    _close(d['capacity']['value'], 89.9, 0.007, 'II-1B φMnd')
    assert l_['governs'] and not d['governs'] and not g['governs']
    assert r['controlling_mode'] == 'Local Buckling'


def test_manual_G_II_2A_shear_and_II_1A_web_crippling():
    """Chapter G — Manual II-2A (8ZS2.25x059, ASD): Va = Vn/Ωv = 2.43 kips; II-1A (9CS2.5x070, Fy 55,
    EOF fastened, N = 5 in, h = 8.485 in): Pn = 2.56 kips (Table G5-2: C 4, CR 0.14, CN 0.35, Ch 0.02)."""
    r = design_member(dict(cases._member()[[n for n, _, _ in cases._member()].index('H2 Manual II-2A lap end ASD')][2]))
    sh = _by_id(r, 'member.shear')
    _close(sh['capacity']['value'], 2.43, 0.01, 'II-2A Va')
    h2 = _by_id(r, 'member.bending_shear')
    _close(h2['ratio'], 1.027, 0.005, 'II-2A H2-1 (Manual DSM numbers)')
    t = 0.070
    w = design_member(dict(member_type='flexure', design_method='ASD', Fy=55.0, Lb=0.0001, Mu=1.0,
                           section_type='C', props=dict(cases.C9, t=t, R=0.1875, h_web=8.485, b_flange=2.0,
                                                        d_lip=0.5),
                           dsm=dict(Mcrl=1e4, Mcrd=1e4), wc_N=5.0, wc_R=0.1875, wc_support='EOF', wc_P=1.0))
    wc = _by_id(w, 'member.web_crippling')
    _close(wc['nominal']['value'], 2.56, 0.02, 'II-1A EOF Pn')
    eq = [s for s in wc['steps'] if s.get('equation') == 'G5-1'][0]
    coef = {i['symbol']: i['value'] for i in eq['inputs']}
    assert (coef['C'], coef['CR'], coef['CN'], coef['Ch']) == (4.0, 0.14, 0.35, 0.02)


def test_manual_H_III_11_B1_and_H1_2():
    """Chapter H / C1 — Manual III-11 (RHS, ASD P 45, M 15): Pe1 = 337 kips, B1 = 1.27; H1.2 ≤ 1 (pass)."""
    r = design_member(dict([p for n, _, p in cases._member() if n == 'III-11 RHS combined ASD'][0]))
    h = _by_id(r, 'member.axial_bending')
    _close(_step_value(h, 'Pe1x'), 337, 0.007, 'III-11 Pe1')
    _close(_step_value(h, 'B1x'), 1.27, 0.007, 'III-11 B1')
    assert h['verdict'] == 'pass' and h['ratio'] == r['interaction']['total'] or \
        round(h['ratio'], 4) == r['interaction']['total']


def test_manual_D_and_J_IV_9_bolted_connection():
    """Chapters D · J — Manual IV-9 (ASD, 1/2 in A307 bolts, t 0.105, Fu 45): J6.1 3.67, J6.2 5.68, J6.3 4.91,
    bearing 5.67, bolt shear 5.29, D2 8.32 kips (design strengths)."""
    r = design_connection(cases._iv9('ASD', member_tension=True, Ae=0.42, Pu=3.5))
    for cid, man in (('conn.j6.shear_rupture', 3.67), ('conn.j6.tension_rupture', 5.68),
                     ('conn.j6.block_shear', 4.91), ('conn.bolt.bearing', 5.67), ('conn.bolt.shear', 5.29),
                     ('conn.member.tension_yield', 8.32)):
        _close(_by_id(r, cid)['capacity']['value'], man, 0.015, f'IV-9 {cid}')
    j61 = _by_id(r, 'conn.j6.shear_rupture')
    # Manual IV-9: Anv = 2 n t e_net, e_net = e − dh/2 = 1.0 − 0.5625/2 (독립 계산)
    _close(_step_value(j61, 'e_net'), 1.0 - (0.5 + 1 / 16) / 2, 1e-12, 'IV-9 e_net')
    assert j61['governs'] and r['governing_mode'] == 'Shear Rupture (J6.1)'
    assert _by_id(r, 'conn.bolt.bearing')['steps'][0]['result']['value'] == 3.0   # C (d/t = 4.76 < 10)


def test_manual_I_II_2A_uplift_R():
    """Chapter I — Manual II-2A/II-2B uplift: Mn = R·Mnℓo, R = 0.70 (continuous Z), Mnℓo from F3.2.1 with
    Mne = My = 1.94·55, Mcrl 91 (Manual II-2B) — independent hand calculation."""
    r = design_member(dict([p for n, _, p in cases._member() if n == 'I6.2.1 uplift II-2A'][0]))
    c = _by_id(r, 'member.flexure.uplift_r')
    My = 1.94 * 55.0
    rr = (91.0 / My) ** 0.4
    Mnlo = (1 - 0.15 * rr) * rr * My
    _close(_step_value(c, 'Mnℓo'), Mnlo, 1e-12, 'II-2A Mnℓo')
    _close(c['nominal']['value'], 0.70 * Mnlo, 1e-12, 'II-2A Mn = R Mnℓo')
    for cid in ('member.flexure.global', 'member.flexure.local', 'member.flexure.distortional'):
        assert _by_id(r, cid)['verdict'] == 'not_applicable'


def test_server_passes_design_checks_and_roles_through_unchanged():
    """server.py 의 처리기(aisi_design · design_connection · lap_connection · generate_section)가 새 필드를
    바꾸지 않고 돌려준다(엄격 JSON 왕복 뒤 엔진이 낸 것과 같다)."""
    for name, direct, via in _results():
        assert json.loads(json.dumps(direct['design_checks'], allow_nan=False)) == via['design_checks'], name
    via = cases.run_case('generate_section', dict(section_type='lippedc',
                                                  params=dict(H=8.0, B=2.5, D=0.625, t=0.059, r=0.157)))
    assert len(via['element_roles']) == len(via['elem']) and via['element_roles'][0] == 'bottom_lip'
