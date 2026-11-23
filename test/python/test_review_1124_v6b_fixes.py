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

from design.aisi_s100 import design_member, LAP_DIST_STATED, LAP_DIST_UNSTATED  # noqa: E402
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
def test_lap_region_distortion_needs_an_explicit_statement():
    base = dict(member_type='flexure', design_method='ASD', Fy=55, Lb=0, Cb=1.0, Mu=20.0, section_type='C',
                props=dict(C9), section=dict(S9), dsm=dict(Mcrl=84.4), lap_region=True, moment_sign='-')
    un = design_member(dict(base))
    d = _check(un, 'member.flexure.distortional')
    assert d['verdict'] == 'not_evaluated' and LAP_DIST_UNSTATED in d['reason'] and un['pass'] is None
    assert LAP_DIST_UNSTATED in un['not_evaluated']
    st = design_member(dict(base, distortion_restrained=True))
    d2 = _check(st, 'member.flexure.distortional')
    assert d2['verdict'] == 'not_applicable' and d2['restraint_source'] == {'kind': 'user_input',
                                                                            'key': 'distortion_restrained'}
    assert LAP_DIST_STATED in st['assumptions'] and st['pass'] is True
    legacy = design_member(dict(base, distortional_not_applicable=True))   # 자동 가정은 랩 구간에서 무시
    assert _check(legacy, 'member.flexure.distortional')['verdict'] == 'not_evaluated'
    assert any('distortional_not_applicable is ignored' in w for w in legacy['warnings'])
    given = design_member(dict(base, dsm=dict(Mcrl=84.4, Mcrd=107.0)))      # Mcrd 를 주면 평가
    assert _check(given, 'member.flexure.distortional')['verdict'] in ('pass', 'fail')
    lap = design_lap_connection(dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=12, lap_right_in=30,
                                     Mu_support=105.0, Vu_support=1.78, fastener_type='bolt', fastener_dia=0.5,
                                     n_rows=2, end_distance=2.0, Se=2.025, design_method='ASD'))
    assert _check(lap, 'lap.flexure.distortional')['verdict'] == 'not_evaluated'     # 랩 도구도 같은 규칙


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
