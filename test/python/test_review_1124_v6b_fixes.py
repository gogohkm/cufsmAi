"""2026-11-24 — 재검증 V6b (docs/reviews/20261122-engine-review/verify/V6b-check-contract-reverify.md) 의 엔진 쪽 수정.

각 시험은 b8c9187 의 엔진에서 실패한다. 기대값은 시험 안에서 원문 식으로 따로 계산한다.
"""

import itertools
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), 'python'))
sys.path.insert(0, HERE)

from design.aisi_s100 import (  # noqa: E402
    design_member, LAP_STATED, LAP_LTB_UNSTATED, LAP_DIST_UNSTATED, LAP_MANUAL_ASSUMPTION,
)
from design.checks import overall_verdict  # noqa: E402
from design.lap_connection import design_lap_connection  # noqa: E402
from design.loads.required_strength import analyze_loads  # noqa: E402
import contract_cases_1123 as cases  # noqa: E402

E = 29500.0
C9 = dict(A=0.881, Sf=2.29, ry=0.890, ro=3.90, J=0.00102, Cw=11.9, rx=3.42, xo=1.83, t=0.059, R=0.1875,
          h_web=8.51, b_flange=1.98, d_lip=0.53)
S9 = dict(type='C', depth=9.0, flange_width=2.5, lip_depth=0.773, thickness=0.059, r=0.1875)
FOLD = {True: 'pass', False: 'fail', None: 'not_evaluated'}


def _check(r, cid):
    return [c for c in r['design_checks'] if c['id'] == cid][0]


# ---------------------------------------------------------------- 1. Cm (V6b-02)
def test_V6b_02_Cm_is_never_built_from_the_distortional_moment_ratio():
    """§C1.2.1.1: Cm 의 M1/M2 는 '그 굽힘 평면의 비지지 구간' 끝 모멘트 비. dist_M1_M2(부록 2 β 입력)는 쓰지 않는다.
    Cm · 그 축의 비가 없으면 Cm = 1.0(Eq. C1.2.1.1-4 의 상한, (b) 가 허용). 축마다 Cmx_M1_M2 · Cmy_M1_M2."""
    base = dict(member_type='combined', design_method='LRFD', Fy=55, KxLx=48.0, KyLy=96.0, KtLt=48.0, Lb=48.0,
                Pu=4.0, Mux=5.0, Muy=2.0, May_strength=10.0, Cmx=1.0, section_type='C', props=dict(C9),
                dsm=dict(Pcrl=1e4, Pcrd=1e4, Mcrl=1e4, Mcrd=1e4))
    pey = math.pi ** 2 * E * 0.881 / (96.0 / 0.890) ** 2
    b1y = 1.0 / (1 - 4.0 / pey)
    r = design_member(dict(base, dist_M1_M2=0.5))
    assert r['amplification']['Cmy'] == 1.0 and abs(r['amplification']['alpha_y'] - round(b1y, 4)) < 1e-9
    assert any('Cmy = 1.0' in a and 'C1.2.1.1' in a for a in r['assumptions'])
    y = design_member(dict(base, Cmy_M1_M2=0.5))                  # 그 축의 비를 주면 Eq. C1.2.1.1-4
    assert abs(y['amplification']['Cmy'] - (0.6 - 0.4 * 0.5)) < 1e-12
    h = _check(y, 'member.axial_bending')
    cm = [s for s in h['steps'] if (s['result'] or {}).get('symbol') == 'Cmy'][0]
    assert cm['equation'] == 'C1.2.1.1-4' and cm['inputs'][0]['source']['key'] == 'Cmy_M1_M2'
    x = design_member(dict(base, Cmx=None, dist_M1_M2=0.5))       # x 축도 같은 규칙
    assert x['amplification']['Cmx'] == 1.0


# ---------------------------------------------------------------- 2. 랩 J6.3 하한 (판정에 든다)
def _bs_hand(p, m, s, V, dm):
    """J6.3 하한: Lv = e + (m−1)s, Agv = 2tLv, Anv = 2t(Lv − (m−0.5)dh), Pnr = min(0.6FyAgv, 0.6FuAnv),
    볼트 Table J6-1 φ 0.65 / Ω 2.22, 표준 구멍 dh = d + 1/16 (d ≥ 1/2 in, Table J3.3-1)."""
    t, e, d = p['t'], p['end_distance'], p['fastener_dia']
    dh = d + 1 / 16
    Lv = e + (m - 1) * s
    Pnr = min(0.6 * p['Fy'] * 2 * t * Lv, 0.6 * p['Fu'] * 2 * t * (Lv - (m - 0.5) * dh))
    return V / (0.65 * Pnr if dm == 'LRFD' else Pnr / 2.22)


def test_lap_block_shear_lower_bound_is_evaluated_and_counts():
    a = dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=12, lap_right_in=12, Mu_support=120.0, Vu_support=4.0,
             fastener_type='bolt', fastener_dia=0.5, n_rows=2, end_distance=2.0, Se=3.0, distortion_restrained=True,
             design_method='LRFD')
    b = dict(a, lap_left_in=6, lap_right_in=6, Mu_support=60.0, Vu_support=2.0, end_distance=1.0, design_method='ASD')
    for p, want in ((a, 0.597), (b, 0.942)):
        r = design_lap_connection(p)
        c = _check(r, 'lap.block_shear')
        V = 120.0 / (8.0 - 0.059) if p is a else 60.0 / (8.0 - 0.059)
        hand = _bs_hand(p, r['n_per_row'], r['spacing'], V, p['design_method'])
        assert abs(c['ratio'] - hand) <= 1e-9 and abs(hand - want) < 0.0005, (c['ratio'], hand)
        assert c['counts'] is True and c['verdict'] == 'pass' and c['basis'] == 'lower_bound_tension_plane_ignored'
        assert [s for s in c['steps'] if s['equation'] == 'J6.3-1'] and [s for s in c['steps']
                                                                         if s['equation'] == 'J6.3-2']
        assert any('tension plane ignored' in x for x in r['assumptions'])
    # 짧은 랩 · 작은 e 에서는 블록 전단이 패스너 무리보다 지배한다(0.942 > 0.785)
    rb = design_lap_connection(b)
    assert _check(rb, 'lap.block_shear')['ratio'] > _check(rb, 'lap.fastener_group')['ratio']
    over = design_lap_connection(dict(b, Mu_support=80.0))           # 1.0 을 넘기면 랩 판정이 불합격
    assert _check(over, 'lap.block_shear')['verdict'] == 'fail' and over['pass'] is False
    s = design_lap_connection(dict(a, fastener_type='screw', fastener_dia=0.216, Pnvs=2.0))
    sc = _check(s, 'lap.block_shear')
    assert sc['verdict'] == 'not_applicable' and 'J6.1 and J6.2' in sc['reason']   # J6 머리글: 나사는 J6.3 없음


# ---------------------------------------------------------------- 3. 랩 구간의 뒤틀림 구속 (§6.3)
def test_lap_region_one_statement_covers_ltb_and_distortion():
    """계약 §6.3: 랩 구간은 lap_restrained(별칭 distortion_restrained) 하나가 Manual 가정 두 반쪽을 덮는다.
    호스트는 Lb = 0 을 정하지 않는다 — 엔진이 진술을 보고 Lb = 0 · F4 해당 없음을 쓴다."""
    base = dict(member_type='flexure', design_method='ASD', Fy=55, Mu=20.0, section_type='C',
                props=dict(C9), section=dict(S9), dsm=dict(Mcrl=84.4), lap_region=True, moment_sign='-')
    un = design_member(dict(base))
    g, d = _check(un, 'member.flexure.global'), _check(un, 'member.flexure.distortional')
    assert g['verdict'] == 'not_evaluated' and LAP_LTB_UNSTATED in g['reason']
    assert d['verdict'] == 'not_evaluated' and LAP_DIST_UNSTATED in d['reason'] and un['pass'] is None
    assert LAP_LTB_UNSTATED in un['not_evaluated'] and LAP_DIST_UNSTATED in un['not_evaluated']
    assert 'lateral-torsional buckling and distortional buckling' in LAP_MANUAL_ASSUMPTION
    for key in ('lap_restrained', 'distortion_restrained'):              # 새 이름과 별칭
        st = design_member(dict(base, **{key: True}))
        g2, d2 = _check(st, 'member.flexure.global'), _check(st, 'member.flexure.distortional')
        assert g2['verdict'] == 'pass' and d2['verdict'] == 'not_applicable', key
        assert d2['restraint_source'] == {'kind': 'user_input', 'key': 'lap_restrained'}
        lb = [i for s in g2['steps'] for i in s['inputs'] if i['symbol'] == 'Lb'][0]
        assert lb['value'] == 0.0 and lb['source']['key'] == 'lap_restrained'
        assert LAP_STATED in st['assumptions'] and st['pass'] is True
        # Mne = My (Fn = Fy): 손계산 Sf·Fy / Ωb 와 같은 설계강도
        assert abs(g2['capacity']['value'] - 2.29 * 55 / 1.67) <= 1e-9
    over = design_member(dict(base, lap_restrained=True, Lb=40.0))           # 진술이 있으면 준 Lb 대신 가정
    assert any('is not used' in w for w in over['warnings'])
    legacy = design_member(dict(base, Lb=0, Cb=1.0, distortional_not_applicable=True))   # 호스트의 옛 호출
    assert _check(legacy, 'member.flexure.distortional')['verdict'] == 'not_evaluated'
    assert any('distortional_not_applicable is ignored' in w for w in legacy['warnings'])
    given = design_member(dict(base, Lb=30.0, dsm=dict(Mcrl=84.4, Mcrd=107.0)))   # Lb · Mcrd 를 주면 평가
    assert _check(given, 'member.flexure.global')['verdict'] in ('pass', 'fail')
    assert _check(given, 'member.flexure.distortional')['verdict'] in ('pass', 'fail')


def test_lap_tool_same_statement_and_alias():
    L = dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=12, lap_right_in=30, Mu_support=105.0, Vu_support=1.78,
             fastener_type='bolt', fastener_dia=0.5, n_rows=2, end_distance=2.0, Se=2.025, design_method='ASD')
    un = design_lap_connection(dict(L))
    lo = _check(un, 'lap.flexure.local')
    assert lo['verdict'] == 'not_evaluated' and 'lap_restrained' in lo['reason'] and un['pass'] is None
    assert lo['reference']['ratio'] < 1.0
    assert _check(un, 'lap.flexure.distortional')['verdict'] == 'not_evaluated'
    # 2026-11-24 V9a-03: H2 도 Mn,lap = 2SeFy 를 쓰므로 진술 없이는 판정하지 않는다(불합격은 그대로)
    assert _check(un, 'lap.bending_shear')['verdict'] == 'not_evaluated'
    for key in ('lap_restrained', 'distortion_restrained'):
        st = design_lap_connection(dict(L, **{key: True}))
        assert _check(st, 'lap.flexure.local')['verdict'] == 'pass'
        assert _check(st, 'lap.flexure.distortional')['restraint_source']['key'] == 'lap_restrained'
        assert st['pass'] is True, key
    bad = design_lap_connection(dict(L, Mu_support=400.0))                 # 가정 없이도 불합격은 불합격
    assert _check(bad, 'lap.flexure.local')['verdict'] == 'fail' and bad['pass'] is False


def test_angle_L_substitution_is_an_assumption():
    """§H1.2 (P)L/1000: L 을 받지 않으면 KyLy 를 쓴다 — 계산 과정만이 아니라 assumptions 에(조항 · 두 양과 함께)."""
    r = design_member(dict([p for nm, _, p in cases._member() if nm == 'combined angle (P)L/1000'][0]))
    a = [x for x in r['assumptions'] if x.startswith('§H1.2 (P)L/1000: member length L not given')]
    assert len(a) == 1 and 'KyLy' in a[0] and 'Laterally unbraced length of member' in a[0]
    p = dict([p for nm, _, p in cases._member() if nm == 'combined angle (P)L/1000'][0], L=18.0)
    assert not any(x.startswith('§H1.2 (P)L/1000: member length') for x in design_member(p)['assumptions'])


# ---------------------------------------------------------------- 4. 소요 0 (V6b-03)
def test_folded_design_checks_equal_the_result_pass_everywhere():
    """계약 사례 전부 + 소요 0 조합의 격자: design_checks 를 접은 판정 = 결과의 pass. 소요가 없는 한계상태는 다른
    소요가 있으면 not_applicable, 소요가 하나도 없으면 not_evaluated."""
    n = 0
    for name, method, params in cases.all_cases():
        if method not in ('aisi_design', 'design_connection', 'lap_connection'):
            continue
        r = cases.run_case(method, params)
        if 'error' in r or 'pass' not in r:
            continue
        assert overall_verdict(r['design_checks']) == FOLD[r['pass']], (name, r['pass'])
        n += 1
    dsm = dict(Pcrl=20.0, Pcrd=25.0, Mcrl=84.4, Mcrd=107.0)
    base = dict(design_method='LRFD', Fy=55, KxLx=96, KyLy=48, KtLt=48, Lb=48, section_type='C', props=dict(C9),
                section=dict(S9), dsm=dsm)
    for P, M, V, W in itertools.product((0, 2.0), (0, 20.0), (0, 1.0), (0, 0.5)):
        for mt in ('flexure', 'compression', 'combined'):
            p = dict(base, member_type=mt)
            if mt == 'flexure':
                if P:
                    continue
                p.update(Mu=M, Vu=V, **({'wc_P': W, 'wc_N': 3.0, 'wc_support': 'EOF'} if W else {}))
            elif mt == 'compression':
                if M or V or W:
                    continue
                p.update(Pu=P)
            else:
                if W:
                    continue
                p.update(Pu=P, Mux=M, Vu=V)
            r = design_member(p)
            if 'error' in r:
                continue
            assert overall_verdict(r['design_checks']) == FOLD[r['pass']], (mt, P, M, V, W, r['pass'])
            if mt == 'flexure' and not M and (V or W):
                assert _check(r, 'member.flexure.global')['verdict'] == 'not_applicable'
            n += 1
    assert n > 150, n


# ---------------------------------------------------------------- 5. 옛 단계의 ∞ (V6-16 나머지)
def test_legacy_steps_mark_the_unbounded_Fcre():
    r = design_member(dict([p for nm, _, p in cases._member() if nm == 'II-9 RHS F2.1.4'][0]))
    inf = [s for s in r['steps'] if s.get('value') == 1e6]
    assert inf and all(s.get('unbounded') is True for s in inf)


# ---------------------------------------------------------------- 7. 동률 · 표기
def test_envelope_source_ties_on_all_zero_stations_take_the_first_combination():
    """모든 조합이 0 인 측점(끝 지점 M · 대칭 중앙 V)에서 부동소수 잡음으로 고르지 않는다(허용오차 1e-9 × 크기)."""
    # 대칭 3경간 D + Lr(LRFD): 끝 지점 M · 가운데 경간 중앙 V 가 모든 조합에서 0 (b8c9187 에서는 24 측점이 잡음으로 골림)
    r = analyze_loads(member_app='roof-purlin', span_type='cont-3', span_ft=25.0, loads={'D': 15, 'Lr': 100},
                      design_method='LRFD', section={'Ixx': 10.3})
    bad = 0
    for cls in ('governing', 'gravity'):
        res = r[cls]
        if not res:
            continue
        src = res['envelope_source']
        for key, arr in (('M_max', 'M_envelope_max'), ('M_min', 'M_envelope_min'), ('V_max', 'V_envelope_max'),
                         ('V_min', 'V_envelope_min'), ('R_max', 'R_envelope_max'), ('R_min', 'R_envelope_min')):
            big = max(1.0, max(abs(x) for x in res[arr]))
            for start, count, ci, pi in src[key]:
                for k in range(start, start + count):
                    if abs(res[arr][k]) <= 1e-9 * big:
                        if ci != 0 or any(v != 'not acting' for v in src['patterns'][pi].values()):
                            bad += 1
    assert bad == 0, bad


def test_small_labels():
    r = design_member(dict([p for nm, _, p in cases._member() if nm == 'combined tension + bending'][0]))
    fy = _check(r, 'member.tension_bending.flange_yield')
    assert not any(s.get('equation') == 'H1.1-3' for s in fy['steps'])
    assert [s for s in fy['steps'] if s['kind'] == 'design_strength'][0]['equation'] in ('H1.1-3a', 'H1.1-3b')
    from design.connections import design_connection
    c = design_connection(dict([p for nm, _, p in cases._connections() if nm == 'screw out of scope d'][0], Pu=3.0))
    fails = [x for x in c['design_checks'] if x['verdict'] == 'fail' and x['clause'].startswith('J4')]
    assert fails and all(x.get('out_of_scope') == 'J4' for x in fails)


ZP = dict(A=0.822, Sf=1.94, rx=3.04, ry=0.83, ro=3.17, J=0.000954, Cw=11.3, xo=0.0, I22=0.25, t=0.059, R=0.1875)
Z8 = dict(type='Z', depth=8.0, flange_width=2.25, lip_depth=0.91, thickness=0.059, r=0.1875)
# 호스트가 부르는 꼴 그대로: 단일 단면의 dsm 전부(Mcrd 포함) + 구간의 Lb · Cb · β 입력 (II-2A/II-2B 의 8ZS2.25x059)
HOST_DSM = dict(Mcrl=91.0, Mcrd=101.0, Lcrd=20.8, M_Lcrl=5.1, M_Lcrd=20.8, M_sign='-')


def _host_lap_call(**kw):
    p = dict(member_type='flexure', design_method='ASD', Fy=55.0, Fu=70, section_type='Z', props=dict(ZP),
             section=dict(Z8), moment_sign='-', lap_region=True, Lb=49.1, Cb=1.67, dist_M1_M2=0.0, dist_Lm=49.1,
             dsm=dict(HOST_DSM), Mu=0.5 * 4.95 * 12, Vu=0.5 * 1.29)
    p.update(kw)
    return design_member(p)


def test_stated_lap_region_ignores_single_section_F4_and_Lb_Cb_as_the_host_calls_it():
    """계약 §6.3: 진술이 있으면 dsm 에 Mcrd 가 있어도 F4 는 not_applicable, 준 Lb · Cb 대신 Lb = 0 · Cb = 1.0.
    Manual II-2A 가운데 지점 랩(M 4.95 kip-ft, 두 부재 → 부재당 절반), II-2B 의 부재 값: Mne/Ω = My/Ω = 1.94·55/1.67,
    Mnℓ/Ω = 51.6 kip-in (Manual 인쇄값). (앞의 시험은 dsm 에 Mcrd 를 넣지 않아 이 결함을 놓쳤다.)"""
    r = _host_lap_call(lap_restrained=True)
    c = {x['id']: x for x in r['design_checks']}
    d = c['member.flexure.distortional']
    assert d['verdict'] == 'not_applicable' and d['restraint_source'] == {'kind': 'user_input', 'key': 'lap_restrained'}
    assert abs(c['member.flexure.global']['capacity']['value'] - 1.94 * 55 / 1.67) <= 1e-9
    assert abs(c['member.flexure.local']['capacity']['value'] - 51.6) <= 0.005 * 51.6
    assert c['member.flexure.global']['verdict'] == c['member.flexure.local']['verdict'] == 'pass'
    w = ' '.join(r['warnings'])
    assert 'Lb = 49.1 in is not used' in w and 'Cb = 1.67 is not used' in w and 'Mcrd = 101.0' in w
    assert r['pass'] is True and abs(r['design_strength'] - 51.6) <= 0.005 * 51.6


def test_unstated_lap_region_mirror_cases():
    """진술 없음: Mcrd · Lb 를 주면 그 값으로 평가, 없으면 not_evaluated(이유는 입력 이름과 Manual 인용)."""
    r = _host_lap_call()
    c = {x['id']: x for x in r['design_checks']}
    assert c['member.flexure.distortional']['verdict'] in ('pass', 'fail')       # 준 Mcrd 로 평가
    assert c['member.flexure.global']['verdict'] in ('pass', 'fail')             # 준 Lb 로 평가
    lb = [i for s in c['member.flexure.global']['steps'] for i in s['inputs'] if i['symbol'] == 'KyLy']
    assert lb and lb[0]['value'] == 49.1
    n = _host_lap_call(dsm=dict(Mcrl=91.0, M_sign='-'))
    p = {k: v for k, v in dict(member_type='flexure', design_method='ASD', Fy=55.0, Fu=70, section_type='Z',
                                 props=dict(ZP), section=dict(Z8), moment_sign='-', lap_region=True,
                                 dsm=dict(Mcrl=91.0, M_sign='-'), Mu=0.5 * 4.95 * 12, Vu=0.5 * 1.29).items()}
    m = design_member(p)
    cn = {x['id']: x for x in n['design_checks']}
    cm = {x['id']: x for x in m['design_checks']}
    assert cn['member.flexure.distortional']['verdict'] == 'not_evaluated'
    assert LAP_DIST_UNSTATED in cn['member.flexure.distortional']['reason']
    assert cm['member.flexure.global']['verdict'] == 'not_evaluated' and LAP_LTB_UNSTATED in \
        cm['member.flexure.global']['reason']
    assert n['pass'] is None and m['pass'] is None
