"""2026-11-22 엔진 리뷰 — F4 부재 설계(aisi_s100 · dsm_strength · global_buckling · interaction) 회귀 시험.

기대값은 AISI Cold-Formed Steel Design Manual (2017) 예제의 인쇄값, 또는 시험 안에서
AISI S100-16 원문 식으로 따로 계산한 값이다. 코드가 낸 값을 베끼지 않는다.
"""

import ast
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'python'))

from design.aisi_s100 import (  # noqa: E402
    design_member, _finalize_verdict, _infer_web_crippling_family,
    _bending_reference_nodes, _auto_generate_props,
)
from design.global_buckling import (  # noqa: E402
    compute_column_Fcre, compute_beam_Fcre, compute_beam_Fcre_detail,
)

E = 29500.0
G = 11300.0
PI2E = math.pi ** 2 * E


def _close(actual, expected, rel, label):
    assert actual is not None, f'{label}: actual is None'
    assert abs(actual - expected) <= rel * abs(expected), \
        f'{label}: actual={actual} expected={expected} (±{rel * 100:.2f} %)'


def _step(res, prefix):
    for s in res.get('steps', []):
        if str(s.get('name', '')).startswith(prefix):
            return s
    raise AssertionError(f'step {prefix!r} not found')


def _dsm_local(Pne, Pcrl):
    """Eq. E3.2.1-1/-2 (같은 꼴의 F3.2.1)."""
    lam = math.sqrt(Pne / Pcrl)
    if lam <= 0.776:
        return Pne
    r = (Pcrl / Pne) ** 0.4
    return (1 - 0.15 * r) * r * Pne


def _dsm_dist_flex(My, Mcrd):
    """Eq. F4.1-1/-2."""
    lam = math.sqrt(My / Mcrd)
    if lam <= 0.673:
        return My
    r = (Mcrd / My) ** 0.5
    return (1 - 0.22 * r) * r * My


# III-3 (362S162-54 기둥) 단면 성질 — Manual 인쇄값
III3 = dict(A=0.422, rx=1.44, ry=0.605, J=0.000451, Cw=0.457, xo=1.28, ro=2.02, t=0.0566, R=0.0849)
III3_SECTION = dict(type='C', depth=3.625, flange_width=1.625, lip_depth=0.5, thickness=0.0566, r=0.0849)
# 9CS2.5x059 (Example II-1A/II-1B) 단면 성질 — Manual 인쇄값
C9 = dict(A=0.881, Sf=2.29, ry=0.890, ro=3.90, J=0.00102, Cw=11.9, rx=3.42)


# ============================================================
# Manual 예제 재현 — design_member 공개 진입점 (리뷰어 ex_repro.py 를 시험으로)
# ============================================================

def test_manual_examples_reproduce_printed_values():
    """R4 매뉴얼 재현표: 11개 예제의 중간값이 Manual 인쇄값과 ±0.7 % 안에서 맞는다.

    (허용오차 0.7 %: 인쇄값의 유효숫자 3자리 반올림 + DSM 입력값(Py, My)의 반올림.
    R4-03 이후 Py=Ag·Fy, My=Sf·Fy 를 설계 Fy 로 다시 산정하므로 III-14·II-2B 는
    Manual 의 반올림된 Py(37.4)·My(107) 대신 Ag·Fy=37.35·Sf·Fy=106.7 을 쓴다.)
    """
    rows = []
    # III-3: E2.2 FT. Manual Fcre 18.5, Fn 16.3, Pne 6.88
    r = design_member(dict(member_type='compression', design_method='LRFD', Fy=50.0, Fu=65.0,
                           KxLx=120.0, KyLy=60.0, KtLt=60.0, Pu=1.0, section_type='C',
                           props=dict(III3), section=dict(III3_SECTION),
                           dsm=dict(Pcrl=0.75 * 21.1, Pcrd=1.11 * 21.1)))
    g = _step(r, 'Global')['formula']
    rows += [('III-3 Fcre', float(g.split('Fcre = ')[1].split(' ksi')[0]), 18.5),
             ('III-3 Fn', float(g.split('Fn = ')[1].split(' ksi')[0]), 16.3),
             ('III-3 Pne', r['Pne'], 6.88)]
    assert r['pass'] is True
    # III-14 (sigma C, FSM 값): case1 Pnl 30.9 φPn 26.3 Pn/Ω 17.2, case2 Pne 24.9 Pnl 23.5 Pnd 21.0
    for case, Fcre_o, Pcrd, man in (('case1', 1e6, 1e6, (37.4, 30.9, 37.4, 26.3, 17.2)),
                                    ('case2', 52.1, 19.4, (24.9, 23.5, 21.0, 17.9, 11.7))):
        common = dict(member_type='compression', Fy=50.0, KxLx=66, KyLy=66, KtLt=66, Fcre=Fcre_o,
                      Pu=1.0, section_type='C', props=dict(A=0.747, rx=3, ry=1, J=1e-3, Cw=1, xo=1),
                      dsm=dict(Pcrl=34.4, Pcrd=Pcrd, Py=37.4))
        lr = design_member(dict(common, design_method='LRFD'))
        ad = design_member(dict(common, design_method='ASD'))
        rows += [(f'III-14 {case} Pne', lr['Pne'], man[0]), (f'III-14 {case} Pnl', lr['Pnl'], man[1]),
                 (f'III-14 {case} Pnd', lr['Pnd'], man[2]), (f'III-14 {case} phiPn', lr['design_strength'], man[3]),
                 (f'III-14 {case} Pn/Om', ad['design_strength'], man[4])]
    # II-4A/II-4B (트랙 550T125-54): σey 26.28, σt 36.48, Fcre 58.6; Mne 20.5 Mnl 19.6 Mnd 19.0, 17.1/11.4
    p = dict(member_type='flexure', design_method='LRFD', Fy=33.0, Lb=36.0, Cb=1.30, Mu=1.0,
             section_type='TRACK',
             props=dict(A=0.452, Sf=0.668, ry=0.342, ro=2.15, J=0.000483, Cw=0.315, rx=2.0),
             dsm=dict(Mcrl=29.5, Mcrd=29.5))
    r = design_member(p)
    fd = r['Fcre_detail']
    rows += [('II-4A sigma_ey', fd['sigma_ey'], 26.28), ('II-4A sigma_t', fd['sigma_t'], 36.48),
             ('II-4A Fcre', fd['Fcre'], 58.6)]
    for dm, man in (('LRFD', 17.1), ('ASD', 11.4)):
        rr = design_member(dict(p, design_method=dm, Fcre=56.6))
        if dm == 'LRFD':
            rows += [('II-4B Mne', rr['Mne'], 20.5), ('II-4B Mnl', rr['Mnl'], 19.6), ('II-4B Mnd', rr['Mnd'], 19.0)]
        rows.append((f'II-4B {dm}', rr['design_strength'], man))
    # II-1A/II-1B (9CS2.5x059 부모멘트): σey 72.8, σt 82.4, Fcre 194; Mne 126 Mnl 93.6 β 1.23 Mnd 99.9 φMn 84.2
    r = design_member(dict(member_type='flexure', design_method='LRFD', Fy=55.0, Lb=56.3, Cb=1.67, Mu=1.0,
                           section_type='C', props=dict(C9),
                           dsm=dict(Mcrl=84.4, Mcrd=0.85 * 126.0, My=126.0, Lcrd=25.0),
                           dist_M1_M2=0.0, dist_Lm=56.3))
    fd = r['Fcre_detail']
    rows += [('II-1A sigma_ey', fd['sigma_ey'], 72.8), ('II-1A sigma_t', fd['sigma_t'], 82.4),
             ('II-1A Fcre', fd['Fcre'], 194), ('II-1B Mne', r['Mne'], 126), ('II-1B Mnl', r['Mnl'], 93.6),
             ('II-1B beta', r['beta_dist'], 1.23), ('II-1B Mnd', r['Mnd'], 99.9),
             ('II-1B phiMn', r['design_strength'], 84.2)]
    # II-1C (FSM Fcre 41.0): Mne 87.7 Mnl 73.6 Mnd 92.6 φMn 66.2
    r = design_member(dict(member_type='flexure', design_method='LRFD', Fy=55.0, Lb=56.3, Mu=1.0, Fcre=41.0,
                           section_type='C', props=dict(A=0.881, Sf=2.29),
                           dsm=dict(Mcrl=84.4, Mcrd=107.0, My=126.0)))
    rows += [('II-1C Mne', r['Mne'], 87.7), ('II-1C Mnl', r['Mnl'], 73.6), ('II-1C Mnd', r['Mnd'], 92.6),
             ('II-1C phiMn', r['design_strength'], 66.2)]
    # II-2B (8ZS2.25x059, ASD): Mne 107 Mnl 86.2 Mnd 81.7 Mn/Ω 48.9
    r = design_member(dict(member_type='flexure', design_method='ASD', Fy=55.0, Lb=49.1, Mu=1.0, Fcre=243.0,
                           section_type='Z', props=dict(A=0.822, Sf=1.94),
                           dsm=dict(Mcrl=91.0, Mcrd=101.0, My=107.0)))
    rows += [('II-2B Mne', r['Mne'], 107), ('II-2B Mnl', r['Mnl'], 86.2), ('II-2B Mnd', r['Mnd'], 81.7),
             ('II-2B Mn/Om', r['design_strength'], 48.9)]
    # II-9 (RHS 6x6x1/8, F2.1.4): Lu 1660, Mne 256 — 판정이 나와야 한다(R4-09)
    r = design_member(dict(member_type='flexure', design_method='LRFD', Fy=46.0, Lb=120.0, Cb=1.0, Mu=1.0,
                           section_type='RHS',
                           props=dict(A=2.91, Sf=5.56, Izz=16.7, Ixx=16.7, J=25.3, rx=2.393, ry=2.393),
                           dsm=dict(Mcrl=4.95 / 5.56 * 256 * 3, Mcrd=0)))
    rows += [('II-9 Lu', r['Fcre_detail']['Lu'], 1660), ('II-9 Mne', r['Mne'], 256)]
    assert r['pass'] is True and r.get('utilization_valid') is not False, ('II-9 verdict', r.get('not_evaluated'))
    # II-8 (원형관 F2.3): Mne 233, Mn/Ω 140, φMn 221 — 판정이 나와야 한다(R4-09/R4-10)
    for dm, man in (('ASD', 140), ('LRFD', 221)):
        r = design_member(dict(member_type='flexure', design_method=dm, Fy=42.0, Lb=120.0, Mu=1.0,
                               section_type='CHS', D=8.0,
                               props=dict(A=2.482, Sf=4.84, t=0.1, Izz=19.37, Ixx=19.37, J=38.7,
                                          rx=2.794, ry=2.794),
                               section=dict(diameter=8.0, thickness=0.1, type='CHS'),
                               dsm=dict(Mcrl=0, Mcrd=0)))
        if dm == 'ASD':
            rows.append(('II-8 Mne', r['Mne'], 233))
        rows.append((f'II-8 {dm}', r['design_strength'], man))
        assert r['pass'] is True and not r.get('dsm_warnings'), ('II-8 verdict', r.get('not_evaluated'))
        assert not any('F2.1.5' in w for w in r['warnings'])
    # III-11 (RHS 기둥-보, C1 B1): Pe1 337, B1 1.27 (ASD) / 1.26 (LRFD) — 판정(R4-09)
    for dm, P, M, B1 in (('ASD', 45.0, 15.0, 1.27), ('LRFD', 69.0, 24.0, 1.26)):
        r = design_member(dict(member_type='combined', design_method=dm, Fy=46.0, KxLx=120, KyLy=120,
                               KtLt=120, Lb=120, Cb=1.0, Pu=P, Mux=M, Muy=0, Cmx=1.0, Cmy=1.0,
                               section_type='RHS',
                               props=dict(A=2.914, Sf=5.56, Ixx=16.69, Izz=16.69, rx=2.393, ry=2.393,
                                          J=25.3, Cw=0.0),
                               dsm=dict(Pcrl=52.20 * 2.914, Pcrd=0, Mcrl=52.20 * 5.56 * 2.0, Mcrd=0)))
        rows += [(f'III-11 Pe1 {dm}', r['amplification']['PEx'], 337), (f'III-11 B1 {dm}', r['amplification']['alpha_x'], B1)]
        assert r['pass'] is True and r.get('utilization_valid') is not False, ('III-11', dm, r.get('not_evaluated'))
    # III-6 (원형관 기둥-보): Pe1 391, B1 1.10/1.05, Ma 140/221 — 판정(R4-09)
    for dm, P, M, B1, Ma in (('ASD', 22.5, 67.6, 1.10, 140), ('LRFD', 19.0, 150.0, 1.05, 221)):
        r = design_member(dict(member_type='combined', design_method=dm, Fy=42.0, KxLx=120, KyLy=120,
                               KtLt=120, Lb=120, Pu=P, Mux=M, Cmx=1.0, Cmy=1.0, section_type='CHS', D=8.0,
                               props=dict(A=2.482, Sf=4.84, Ixx=19.37, Izz=19.37, rx=2.794, ry=2.794,
                                          J=38.74, Cw=0.0, t=0.1),
                               section=dict(diameter=8.0, thickness=0.1, type='CHS'),
                               dsm=dict(Pcrl=0.605 * 29500 * 0.1 / 3.95 * 2.482, Pcrd=0, Mcrl=0, Mcrd=0)))
        rows += [(f'III-6 Pe1 {dm}', r['amplification']['PEx'], 391), (f'III-6 B1 {dm}', r['amplification']['alpha_x'], B1),
                 (f'III-6 Ma {dm}', r['flexure_x']['design_strength'], Ma)]
        assert r['pass'] is True and r.get('utilization_valid') is not False, ('III-6', dm, r.get('not_evaluated'))
    for label, actual, manual in rows:
        _close(actual, manual, 0.007, label)


def test_tension_d2_d3_hand_values():
    """D2/D3 손계산: Ta = min(φt·Ag·Fy, φt·An·Fu) (LRFD), min(AgFy/1.67, AnFu/2.00) (ASD)."""
    for dm in ('LRFD', 'ASD'):
        r = design_member(dict(member_type='tension', design_method=dm, Fy=50.0, Fu=65.0, Tu=10.0,
                               An=0.70, props=dict(A=0.881)))
        hand = (min(0.9 * 0.881 * 50, 0.75 * 0.70 * 65) if dm == 'LRFD'
                else min(0.881 * 50 / 1.67, 0.70 * 65 / 2.0))
        _close(r['design_strength'], hand, 0.001, f'Ta {dm}')
        assert r['pass'] is True
        assert not r.get('dsm_warnings')


# ============================================================
# 판정 규칙 (FIXES §3.1)
# ============================================================

def test_verdict_rule_fail_beats_incomplete_and_incomplete_is_never_pass():
    """§3.1: 불합격이 이기고, 미평가가 있으면 True 가 아니다."""
    r = {'pass': True, 'not_evaluated': ['E3 local buckling']}
    _finalize_verdict(r)
    assert r['pass'] is None and r['utilization_valid'] is False
    r = {'pass': False, 'not_evaluated': ['E3 local buckling']}
    _finalize_verdict(r)
    assert r['pass'] is False
    r = {'pass': True}
    _finalize_verdict(r)
    assert r['pass'] is True and 'utilization_valid' not in r


def test_R4_01_missing_Pcrl_is_not_evaluated_not_pass():
    """R4-01: Pcrl=0, 기하 없음 → E3 미평가, pass None (전에는 0.98 로 합격)."""
    r = design_member(dict(member_type='compression', Fy=50, KxLx=24, KyLy=24, KtLt=24, Pu=15.0,
                           section_type='C', props=dict(III3), dsm=dict(Pcrl=0, Pcrd=40.0, Py=21.1)))
    assert r['pass'] is None and r['utilization_valid'] is False
    assert r['local_not_evaluated'] is True
    assert any('E3' in w for w in r['warnings'])
    # 불합격은 미평가를 이긴다: 같은 부재에 Pu 를 키우면 False.
    r = design_member(dict(member_type='compression', Fy=50, KxLx=24, KyLy=24, KtLt=24, Pu=60.0,
                           section_type='C', props=dict(III3), dsm=dict(Pcrl=0, Pcrd=40.0)))
    assert r['pass'] is False
    # 휨도 같은 꼴 (9CS2.5x059, Mcrl=0, section 없음, Mcrd 큼 → Mu 가 작으면 판정 없음)
    r = design_member(dict(member_type='flexure', Fy=55, Lb=0.0001, Mu=10.0, section_type='C',
                           props=dict(C9), dsm=dict(Mcrl=0, Mcrd=1e4)))
    assert r['pass'] is None and r['local_not_evaluated'] is True
    assert any('F3' in w for w in r['warnings'])


def test_R4_01_modal_label_does_not_verify_absence():
    """R4-01/R5-01/R3-01/§4.1: cfsm_modal + local_detected=False 를 '부재 확인'으로 읽지 않는다.

    9CS2.5x059 (H 9, B 2.5, D 0.773, t 0.059, r 0.1875), Fy 55, KL=144 in. 옛 dsm.py 출력
    (Pcrl=0, Pcrd=단일 극소 0.125·Py, cfsm_modal, local_detected=False) 을 그대로 넣어도
    Pn 이 R5-01 의 올바른 값(단일 극소를 Pcrl·Pcrd 둘 다로 쓴 6.49 kips) 이하여야 한다
    (리뷰 시점 8.58 kips). 600S162-54 (KxLx 120, KyLy=KtLt 60): ≤ 9.08 kips (리뷰 시점 11.47).
    """
    base = dict(member_type='compression', design_method='LRFD', section_type='lippedc',
                H=9.0, B=2.5, D=0.773, t=0.059, r=0.1875, Fy=55.0, Fu=70.0, Pu=1.0,
                KxLx=144.0, KyLy=144.0, KtLt=144.0)
    Py = 48.444
    old_dsm = {'Pcrl': 0.0, 'Pcrd': 0.125 * Py, 'Py': Py, 'P_classification_method': 'cfsm_modal',
               'P_local_detected': False, 'P_dist_detected': True}
    r = design_member(dict(base, dsm=old_dsm))
    assert 'error' not in r, r
    assert r['Pn'] <= 6.49 * 1.005, r['Pn']
    assert r['dsm_source']['Pcrl'].startswith('§App.1')
    # 독립 확인: 해석식 Fcrl (Eq. 1.1-4, 외-외 ho=9.0 → w = ho - 2(R+t) = 8.507, k=4)
    w = 9.0 - 2 * (0.1875 + 0.059)
    Fcrl = 4.0 * PI2E / (12 * (1 - 0.09)) * (0.059 / w) ** 2
    Pnl_hand = _dsm_local(r['Pne'], Fcrl * r['Py'] / 55.0)
    _close(r['Pnl'], Pnl_hand, 0.005, 'Pnl from analytic Fcrl')

    s = dict(member_type='compression', section_type='lippedc', H=6.0, B=1.625, D=0.5, t=0.0566,
             r=0.0849, Fy=50.0, Fu=65.0, KxLx=120.0, KyLy=60.0, KtLt=60.0, Pu=1.0)
    Py6 = design_member(dict(s, dsm={'Pcrl': 1e4, 'Pcrd': 1e4}))['Py']
    old6 = {'Pcrl': 0.0, 'Pcrd': 0.281 * Py6, 'Py': Py6, 'P_classification_method': 'cfsm_modal',
            'P_local_detected': False, 'P_dist_detected': True}
    r6 = design_member(dict(s, dsm=old6))
    assert r6['Pn'] <= 9.08 * 1.005, r6['Pn']


def test_R4_02_web_crippling_alone_governs():
    """R4-02: §G5 단독 검토 P̄ ≤ Pa. 반력 = 1.15·φwPn, M≈0 → 불합격, 지배 'G5 web crippling'."""
    base = dict(member_type='flexure', design_method='LRFD', Fy=50, Lb=0.0001, section_type='C',
                props=dict(C9, t=0.059, R=0.1875, h_web=8.51, b_flange=1.98, d_lip=0.53),
                section=dict(type='C', depth=9.0, flange_width=2.5, lip_depth=0.773, thickness=0.059, r=0.1875),
                dsm=dict(Mcrl=1e4, Mcrd=1e4), wc_N=3.0, wc_R=0.1875, wc_support='EOF', wc_fastened='fastened')
    # φwPn 독립 계산: Table G5-2, 체결·보강 플랜지·EOF: C 4, CR 0.14, CN 0.35, Ch 0.02, φw 0.85
    t, R, N, h, Fy = 0.059, 0.1875, 3.0, 8.51, 50.0
    Pn = 4 * t ** 2 * Fy * (1 - 0.14 * math.sqrt(R / t)) * (1 + 0.35 * math.sqrt(N / t)) \
        * (1 - 0.02 * math.sqrt(h / t))
    phiPn = 0.85 * Pn
    r = design_member(dict(base, Mu=1.0, wc_P=1.15 * phiPn))
    _close(r['web_crippling']['Pn'], Pn, 0.005, 'G5-2 Pn (Eq. G5-1)')
    # ASD 쪽: Pa = Pn/Ωw (Ωw 1.75)
    ra = design_member(dict(base, design_method='ASD', Mu=1.0, wc_P=1.15 * Pn / 1.75))
    _close(ra['utilization'], 1.15, 0.005, 'G5 utilization ASD')
    assert r['pass'] is False
    assert r['governing_check'] == 'G5 web crippling'
    _close(r['utilization'], 1.15, 0.005, 'G5 utilization')
    # H3 자체는 이 경우 통과한다 — 단독 검토가 없으면 합격이 나던 경우.
    assert r['h3_interaction']['pass'] is True


def test_R4_03_R8_02_Py_My_from_design_Fy():
    """R4-03/R8-02: DSM 의 Py·My 가 다른 Fy 에서 왔어도 Py=Ag·Fy, My=Sf·Fy (설계 Fy).

    III-3, Fy=50, dsm.Py = 0.422×70 → Pne = Manual 6.88 (±0.5 %). (리뷰 시점 9.60, +40 %)
    9CS2.5x059 휨, Fy=55, dsm.My = 2.29×70 → My = 2.29×55 = 125.95, Mn = 손계산.
    """
    r = design_member(dict(member_type='compression', Fy=50.0, KxLx=120.0, KyLy=60.0, KtLt=60.0,
                           Pu=1.0, section_type='C', props=dict(III3), section=dict(III3_SECTION),
                           dsm=dict(Pcrl=0.75 * 21.1, Pcrd=1.11 * 21.1, Py=0.422 * 70)))
    _close(r['Pne'], 6.88, 0.005, 'Pne (Manual III-3)')
    _close(r['Py'], 0.422 * 50.0, 1e-3, 'Py = Ag·Fy')
    assert any('Ag·Fy' in w for w in r['warnings'])
    r = design_member(dict(member_type='flexure', Fy=55.0, Lb=0.0001, Mu=1.0, section_type='C',
                           props=dict(C9), dsm=dict(Mcrl=84.4, Mcrd=107.0, My=2.29 * 70)))
    My = 2.29 * 55.0
    Mn_hand = min(My, _dsm_local(My, 84.4), _dsm_dist_flex(My, 107.0))
    _close(r['My'], My, 1e-3, 'My = Sf·Fy')
    _close(r['Mn'], Mn_hand, 2e-3, 'Mn hand (F2/F3/F4)')
    assert any('Sf·Fy' in w for w in r['warnings'])


def test_R4_04_shear_centre_offset_along_z_uses_E2_2():
    """R4-04: 대칭축이 모델 z 축인 C(회전 배치). III-3 성질을 90° 돌려(rx↔ry, KxLx↔KyLy)
    전단중심 편심을 Zs−zcg 로만 주면 Manual III-3 의 Fcre 18.5 ksi · Pne 6.88 kips 가 나와야 한다.
    (리뷰 시점: 이중대칭 분기로 Fcre 24.4, Pne 8.96, +31 %)"""
    rot = dict(A=0.422, rx=0.605, ry=1.44, J=0.000451, Cw=0.457, xo=0.0, Xs=1.0, xcg=1.0,
               Zs=0.0, zcg=1.28, t=0.0566, R=0.0849)
    r = design_member(dict(member_type='compression', Fy=50.0, KxLx=60.0, KyLy=120.0, KtLt=60.0,
                           Pu=1.0, section_type='C', props=rot, dsm=dict(Pcrl=1e4, Pcrd=1e4)))
    g = _step(r, 'Global')['formula']
    _close(float(g.split('Fcre = ')[1].split(' ksi')[0]), 18.5, 0.005, 'Fcre (Manual III-3)')
    _close(r['Pne'], 6.88, 0.005, 'Pne (Manual III-3)')
    # 두 방향 모두 편심 → 비대칭(E2.4): 대칭축 식을 쓰지 않는다.
    both = compute_column_Fcre(dict(rot, Xs=1.5, section_type='C'), 50.0, 60.0, 120.0, 60.0)
    assert both.get('unsupported') is True and both['Fcre'] == 0.0


def test_R4_04_rotation_invariance_on_generated_section():
    """R4-04: 같은 립C(템플릿)를 x↔z 로 뒤집은 모델의 E2 Fcre 는 원래 모델과 같다(독립 해: 좌표 불변)."""
    from engine.template import generate_section
    from engine.properties import grosprop
    from engine.cutwp import cutwp_prop

    def props_of(node, elem):
        p = {k: (v.item() if hasattr(v, 'item') and getattr(v, 'ndim', 1) == 0 else v)
             for k, v in grosprop(node, elem).items()}
        cw = cutwp_prop(node, elem)
        p.update(J=float(cw['J']), Cw=float(cw['Cw']), Xs=float(cw['Xs']), Zs=float(cw['Zs']))
        p['xo'] = abs(p['Xs'] - p['xcg'])
        p['ry'] = p.get('rz', 0)
        p['section_type'] = 'C'
        return p

    sec = generate_section('lippedc', {'H': 3.625, 'B': 1.625, 'D': 0.5, 't': 0.0566, 'r': 0.0849})
    node, elem = sec['node'].copy(), sec['elem']
    p0 = props_of(node, elem)
    node_r = node.copy()
    node_r[:, 1], node_r[:, 2] = node[:, 2].copy(), node[:, 1].copy()
    p1 = props_of(node_r, elem)
    assert p1['xo'] < 1e-6  # 회전 모델은 x 편심이 없다
    f0 = compute_column_Fcre(p0, 50.0, 120.0, 60.0, 60.0)
    f1 = compute_column_Fcre(p1, 50.0, 60.0, 120.0, 60.0)
    assert f1['symmetry_axis'] == 'z'
    _close(f1['Fcre'], f0['Fcre'], 2e-3, 'rotated Fcre')
    assert f0['buckling_type'] == f1['buckling_type'] == 'flexural-torsional'


def test_R4_05_angle_L1000_requires_weak_axis_strength_and_is_amplified():
    """R4-05: 앵글은 Muy=0 이어도 (P)L/1000 검토에 May 가 필요하고, 추가 모멘트에 B1 을 곱한다."""
    common = dict(member_type='combined', design_method='ASD', Fy=50.0, KxLx=18.0, KyLy=18.0,
                  KtLt=18.0, Lb=18.0, Pu=3.0, Mux=0.0, Muy=0.0, Cmx=1.0, Cmy=1.0, Fcre=40.0,
                  section_type='lipped_angle',
                  props=dict(A=0.4, Sf=0.2, rx=0.8, ry=0.5, J=1e-3, Cw=1e-3, xo=0.5),
                  dsm=dict(Pcrl=30.0, Pcrd=30.0, Mcrl=30.0, Mcrd=30.0))
    r = design_member(common)
    assert 'error' in r and 'May_strength' in r['error']
    r = design_member(dict(common, May_strength=4.97))
    assert 'error' not in r, r
    Pa = r['compression']['design_strength']
    Pe1y = PI2E * 0.4 / (18.0 / 0.5) ** 2
    B1y = 1.0 / (1 - 1.6 * 3.0 / Pe1y)
    total_hand = 3.0 / Pa + B1y * (3.0 * 18.0 / 1000.0) / 4.97
    _close(r['interaction']['total'], total_hand, 2e-3, 'H1.2 with B1·(P)L/1000')
    # 압축 단독 경로도 H1.2 를 요구한다(미평가).
    rc = design_member(dict(common, member_type='compression'))
    assert rc['pass'] is None and any('H1.2' in x for x in rc['not_evaluated'])


def test_R4_06_R8_11_no_default_section():
    """R4-06/R8-11: props 도 템플릿 치수도 없으면 오류. 치수를 다 주면 생성하고 결과에 밝힌다."""
    r = design_member({'member_type': 'compression', 'Fy': 50, 'KxLx': 96, 'KyLy': 48, 'KtLt': 48, 'Pu': 3})
    assert 'error' in r and 'props' in r['error']
    r = design_member({'member_type': 'compression', 'Fy': 50, 'section_type': 'lippedc',
                       'H': 8.0, 'B': 2.5, 't': 0.06, 'Pu': 3})   # D 빠짐
    assert 'error' in r and 'D' in r['error']
    assert 'error' in design_member({'member_type': 'compression', 'props': dict(III3), 'Pu': 1})  # Fy 없음
    r = design_member({'member_type': 'flexure', 'Fy': 50, 'section_type': 'lippedc', 'H': 8.0, 'B': 2.5,
                       'D': 0.625, 't': 0.06, 'R': 0.09, 'Lb': 0.0, 'Mu': 1.0,
                       'dsm': {'Mcrl': 100.0, 'Mcrd': 100.0}})
    assert r['auto_generated_section']['H'] == 8.0 and r['section_source'] == 'auto-template'
    assert any('템플릿' in w for w in r['assumptions'])  # FIXES §3.1.1: 가정은 assumptions


def test_R4_07_R5_25_cold_work_not_used_in_chapter_G():
    """R4-07/R5-25: 냉간가공 Fya 는 G2 전단·G5 웹 크리플링·H3 에 쓰지 않는다(§A3.3.2)."""
    cw = dict(member_type='flexure', design_method='LRFD', Fy=33.0, Fu=45.0, Lb=0.0001, Mu=10.0, Vu=1.0,
              section_type='C', use_cold_work=True,
              props=dict(C9, t=0.059, R=0.0885, h_web=8.51, b_flange=1.98, d_lip=0.53),
              section=dict(type='C', depth=9.0, flange_width=2.5, lip_depth=0.773, thickness=0.059, r=0.0885),
              dsm=dict(Mcrl=1e4, Mcrd=1e4), wc_N=3.0, wc_R=0.0885)
    r = design_member(cw)
    r0 = design_member(dict(cw, use_cold_work=False))
    assert r['Fy_used'] > 33.0  # 휨에는 Fya 가 적용된 경우
    assert r['shear']['Vn'] == r0['shear']['Vn']
    assert r['web_crippling']['Pn'] == r0['web_crippling']['Pn']
    assert r['Mnfo'] == r0['Mnfo']


def test_R4_08_fail_is_not_overwritten_by_none():
    """R4-08: B4 초과 등 미평가 표시가 명백한 NG(이용률 6.5)를 None 으로 덮지 않는다."""
    r = design_member(dict(member_type='flexure', Fy=55, Lb=0.0001, Mu=500.0, section_type='C',
                           props=dict(C9, t=0.059, R=1.5), dsm=dict(Mcrl=84.4, Mcrd=107.0)))
    assert r.get('b4_limits_exceeded') is True
    assert r['pass'] is False and r['utilization_valid'] is False
    assert 'NG' in r['report']


def test_R4_09_distortional_not_applicable_sections_get_verdict():
    """R4-09: 연단 보강 플랜지가 없는 단면(트랙)·폐단면은 F4/E4 '해당 없음' — 판정을 막지 않는다."""
    r = design_member(dict(member_type='flexure', Fy=33.0, Lb=36.0, Cb=1.3, Mu=1.0, section_type='TRACK',
                           props=dict(A=0.452, Sf=0.668, ry=0.342, ro=2.15, J=0.000483, Cw=0.315, rx=2.0),
                           dsm=dict(Mcrl=29.5, Mcrd=0)))
    assert r['pass'] is True and r['distortional_not_evaluated'] is False
    assert 'not applicable' in _step(r, 'Distortional')['equation']
    # III-11 압축 단독: Pn = DSM(Pne, Pcrl=Fcrl·A) 손계산, pass True
    r = design_member(dict(member_type='compression', design_method='ASD', Fy=46.0, KxLx=120, KyLy=120,
                           KtLt=120, Pu=45.0, section_type='RHS',
                           props=dict(A=2.914, rx=2.393, ry=2.393, J=25.3, Cw=0.0),
                           dsm=dict(Pcrl=52.20 * 2.914, Pcrd=0)))
    Fe = PI2E / (120 / 2.393) ** 2
    lam = math.sqrt(46.0 / Fe)
    Fn = 0.658 ** (lam ** 2) * 46.0
    Pn_hand = _dsm_local(2.914 * Fn, 52.20 * 2.914)
    _close(r['Pn'], Pn_hand, 2e-3, 'III-11 Pn')
    _close(r['Pn'], 106.1, 0.005, 'III-11 Pn (R4 table)')
    assert r['pass'] is True and r.get('utilization_valid') is not False
    # 립 C 는 여전히 해당 — Mcrd 없고 기하 없으면 미평가.
    r = design_member(dict(member_type='flexure', Fy=55, Lb=0.0001, Mu=1.0, section_type='C',
                           props=dict(C9), dsm=dict(Mcrl=84.4, Mcrd=0)))
    assert r['distortional_not_evaluated'] is True and r['pass'] is None


def test_R4_10_chs_diameter_is_not_a_lip():
    """R4-10: CHS 의 외경 D 를 립으로 읽어 거짓 B4 위반을 내지 않는다(압축)."""
    r = design_member(dict(member_type='compression', Fy=42, KxLx=120, KyLy=120, KtLt=120, Pu=50.0,
                           section_type='CHS', D=8.0,
                           props=dict(A=2.482, rx=2.794, ry=2.794, J=38.7, Cw=0, t=0.1),
                           section=dict(type='CHS', diameter=8.0, thickness=0.1, lip_depth=8.0),
                           dsm=dict(Pcrl=1e4, Pcrd=0)))
    assert not r.get('dsm_warnings'), r.get('dsm_warnings')
    assert r['pass'] is True


def test_R4_11_unstiffened_flange_limit_60():
    """R4-11: 립 없는 플랜지는 Table B4.1-1 비보강요소 d/t ≤ 60 (트랙 b/t = 100 → 위반)."""
    r = design_member(dict(member_type='flexure', Fy=33, Lb=0.0001, Mu=1.0, section_type='TRACK',
                           props=dict(A=0.5, Sf=0.6, t=0.03, b_flange=3.0, h_web=5.0, R=0.05, ry=0.3,
                                      ro=2, J=1e-4, Cw=0.2, rx=2),
                           section=dict(type='TRACK', depth=5.16, flange_width=3.08, thickness=0.03),
                           dsm=dict(Mcrl=50, Mcrd=50)))
    assert 'unstiffened' in r['dsm_warnings'][0]
    assert r['pass'] is None
    # RHS 플랜지는 보강요소 w/t ≤ 500 (b/t=300 은 위반 아님)
    r = design_member(dict(member_type='compression', Fy=46, KxLx=60, KyLy=60, KtLt=60, Pu=1.0,
                           section_type='RHS', props=dict(A=2.0, rx=2.0, ry=2.0, J=20.0, Cw=0.0,
                                                          t=0.02, b_flange=6.0, h_web=6.0),
                           dsm=dict(Pcrl=100.0, Pcrd=0)))
    assert not any('Flange' in w for w in (r.get('dsm_warnings') or []))


def test_R4_12_defaults_are_flagged():
    """R4-12: 빠진 입력의 기본값 — 경고 + 해당 한계상태 판정 보류, 필수 성질은 오류."""
    r = design_member(dict(member_type='tension', Fy=50, Fu=65, Tu=30.0, props=dict(A=0.881)))
    assert any('An' in w for w in r['assumptions']) and r['pass'] is True
    r = design_member(dict(member_type='tension', Fy=50, Tu=30.0, props=dict(A=0.881)))
    assert r['pass'] is None and r['Tn_rupture'] is None   # Fu 없음 → D3 미평가
    # rx 가 없으면 Fcre 를 만들지 않는다(리뷰 시점: σex=1e10 → Pne +52 %)
    p = dict(III3)
    p.pop('rx')
    r = design_member(dict(member_type='compression', Fy=50, KxLx=120, KyLy=60, KtLt=60, Pu=1.0,
                           section_type='C', props=p, dsm=dict(Pcrl=1e4, Pcrd=1e4)))
    assert 'error' in r and 'rx' in r['error']
    # Z 기둥: I22 가 없으면 Ixx·Izz·Ixz 로 주축 약축 I22 를 구한다(Eq. E2.3, 리뷰 시점 ×4.2)
    pz = dict(A=0.822, rx=3.04, ry=0.83, J=0.000954, Cw=11.3, xo=0.0, Ixz=1.8, Ixx=7.6, Izz=0.57)
    I22 = (7.6 + 0.57) / 2 - math.sqrt(((7.6 - 0.57) / 2) ** 2 + 1.8 ** 2)
    se = PI2E / (96 / math.sqrt(I22 / 0.822)) ** 2
    ro = math.sqrt(3.04 ** 2 + 0.83 ** 2)
    st = (G * 0.000954 + PI2E * 11.3 / 96 ** 2) / (0.822 * ro ** 2)
    Fcre = min(se, st)
    lam = math.sqrt(55 / Fcre)
    Fn = 0.658 ** (lam ** 2) * 55 if lam <= 1.5 else 0.877 / lam ** 2 * 55
    r = design_member(dict(member_type='compression', Fy=55, KxLx=96, KyLy=96, KtLt=96, Pu=1.0,
                           section_type='Z', props=pz, dsm=dict(Pcrl=1e4, Pcrd=1e4)))
    _close(r['Pne'], 0.822 * Fn, 2e-3, 'Z Pne via I22 from Ixx/Izz/Ixz')
    # 길이 하나만 빠져도 경고 + E2 판정 보류
    r = design_member(dict(member_type='compression', Fy=50, KxLx=120, KyLy=60, Pu=1.0, section_type='C',
                           props=dict(III3), dsm=dict(Pcrl=1e4, Pcrd=1e4)))
    assert any('KtLt=120' in w for w in r['warnings']) and r['pass'] is None
    # 캔틸레버는 Cb=1 (§F2.1.1)
    a = design_member(dict(member_type='flexure', Fy=55, Lb=100.0, Cb=1.67, cantilever=True, Mu=1.0,
                           section_type='C', props=dict(C9), dsm=dict(Mcrl=1e4, Mcrd=1e4)))
    b = design_member(dict(member_type='flexure', Fy=55, Lb=100.0, Cb=1.0, Mu=1.0,
                           section_type='C', props=dict(C9), dsm=dict(Mcrl=1e4, Mcrd=1e4)))
    assert a['Mne'] == b['Mne'] and any('캔틸레버' in w for w in a['warnings'])


def test_R4_13_i621_limits_checked():
    """R4-13: §I6.2.1 R 의 적용 조건·Table I6.2.1-1 상한을 확인한다."""
    common = dict(member_type='flexure', Fy=55, Fu=70, Lb=0.0001, Mu=1.0, section_type='C',
                  props=dict(C9, t=0.059, R=0.1875),
                  section=dict(type='C', depth=9.0, flange_width=2.5, lip_depth=0.773, thickness=0.059, r=0.1875),
                  dsm=dict(Mcrl=84.4, Mcrd=107.0))
    r = design_member(dict(common, R_uplift=0.8))
    assert any('Table I6.2.1-1' in w for w in r['warnings']) and r['pass'] is None
    r = design_member(dict(common, R_uplift=0.4))   # 9CS: d/t 152, d/b 3.6, b 2.5, w/t ≈ 33.7 → 조건 만족
    assert not any('적용 조건 위반' in w for w in r['warnings'])
    assert r['pass'] is True
    r = design_member(dict(common, section_type='HAT', R_uplift=0.5))
    assert 'error' in r


def test_R4_14_positive_region_governs_utilization():
    """R4-14: 정모멘트 구간 NG 가 이용률·지배 검토에 반영된다. φMn(+) 손계산: Lb_pos=0 → Mne=My."""
    r = design_member(dict(member_type='flexure', Fy=55, Lb=56.3, Cb=1.67, Mu=50.0, Mu_pos=110.0,
                           Lb_pos=0.0, section_type='C', props=dict(C9),
                           dsm=dict(Mcrl=84.4, Mcrd=107.0, My=126.0)))
    My = 2.29 * 55
    phiMn_pos = 0.9 * min(My, _dsm_local(My, 84.4), _dsm_dist_flex(My, 107.0))
    _close(r['utilization'], 110.0 / phiMn_pos, 2e-3, 'positive-region utilization')
    assert r['governing_check'] == 'F positive region' and r['pass'] is False
    assert 'WARNINGS' in r['report']
    # Lb_pos 를 주지 않으면 완전 횡지지 가정을 판정에 쓰지 않는다.
    r = design_member(dict(member_type='flexure', Fy=55, Lb=56.3, Cb=1.67, Mu=50.0, Mu_pos=10.0,
                           section_type='C', props=dict(C9), dsm=dict(Mcrl=84.4, Mcrd=107.0)))
    assert r['pass'] is None and any('Lb_pos' in w for w in r['warnings'])
    # 조합도 정모멘트 구간 NG 를 이어받는다.
    r = design_member(dict(member_type='combined', Fy=55, KxLx=56.3, KyLy=56.3, KtLt=56.3, Lb=56.3, Cb=1.67,
                           Pu=0.1, Mux=50.0, Mu_pos=110.0, Lb_pos=0.0, Cmx=1.0, Cmy=1.0, section_type='C',
                           props=dict(C9, xo=1.0), dsm=dict(Pcrl=1e4, Pcrd=1e4, Mcrl=84.4, Mcrd=107.0)))
    assert r['pass'] is False and r['governing_check'] == 'F positive region'


def test_R4_14_report_h3_label():
    """R4-14: 보고서의 H3 항 이름은 식별(H3-2 → 0.88(P/Pn))을 따른다."""
    r = design_member({
        'member_type': 'flexure', 'design_method': 'LRFD', 'Fy': 50, 'Fu': 65, 'Mu': 8.0, 'Vu': 2.0,
        'Lb': 48.0, 'section_type': 'Z', 'wc_N': 3.5, 'wc_R': 0.1875, 'wc_support': 'ETF',
        'wc_fastened': 'unfastened', 'wc_web_config': 'multi_web', 'wc_section_family': 'multi_web',
        'wc_n_webs': 3,
        'props': {'A': 1.0, 'Sf': 2.0, 'Ixx': 8.0, 'Izz': 2.0, 'Ixz': 0.0, 'I22': 2.0,
                  'J': 0.01, 'Cw': 5.0, 'xo': 0.0, 'h_web': 7.5, 't': 0.06},
        'section': {'type': 'Z', 'depth': 8.0, 'flange_width': 2.25, 'lip_depth': 0.75, 'thickness': 0.06},
        'dsm': {'Mcrl': 150.0, 'Mcrd': 180.0},
    })
    assert '0.88(P/Pn)' in r['report']


def test_R4_15_section_name_normalization_and_hat_E2():
    """R4-15: 'Z-section'/'zee' 는 휨에서도 Z(F2.1.3), hat 은 전단중심 위치로 대칭축을 정해 E2.2 적용."""
    for name in ('Z-section', 'zee', 'ZS', 'lippedz'):
        f, d = compute_beam_Fcre_detail(dict(C9), 1.0, 60.0, section_type=name.upper().replace('-', ''))
        assert d['equation'] == 'F2.1.3', name
    assert _infer_web_crippling_family({}, 'lippedz') == 'Z'   # R5-11 소비 측
    # hat 템플릿과 그것을 x↔z 로 뒤집은 모델: 둘 다 E2.2 로 같은 Fcre (좌표 불변).
    from engine.template import generate_section
    from engine.properties import grosprop
    from engine.cutwp import cutwp_prop
    sec = generate_section('hat', {'H': 4.0, 'B': 3.0, 'D': 1.5, 't': 0.06})

    def props_of(node):
        p = {k: (v.item() if hasattr(v, 'item') and getattr(v, 'ndim', 1) == 0 else v)
             for k, v in grosprop(node, sec['elem']).items()}
        cw = cutwp_prop(node, sec['elem'])
        p.update(J=float(cw['J']), Cw=float(cw['Cw']), Xs=float(cw['Xs']), Zs=float(cw['Zs']),
                 ry=p['rz'], section_type='HAT')
        p['xo'] = abs(p['Xs'] - p['xcg'])
        return p

    node = sec['node'].copy()
    node_r = node.copy()
    node_r[:, 1], node_r[:, 2] = node[:, 2].copy(), node[:, 1].copy()
    a = compute_column_Fcre(props_of(node), 50.0, 80.0, 80.0, 80.0)
    b = compute_column_Fcre(props_of(node_r), 50.0, 80.0, 80.0, 80.0)
    assert not a.get('unsupported') and not b.get('unsupported')
    assert {a['symmetry_axis'], b['symmetry_axis']} == {'x', 'z'}
    _close(a['Fcre'], b['Fcre'], 2e-3, 'hat Fcre rotation invariant')
    # 직접 준 xo 만으로는 hat 의 대칭축 방향을 모른다 → 지원하지 않음(판정 없음)
    r = design_member(dict(member_type='compression', Fy=50, KxLx=60, KyLy=60, KtLt=60, Pu=3.0,
                           section_type='HAT', props=dict(A=0.5, rx=1.0, ry=1.5, J=1e-3, Cw=1.0, xo=1.2),
                           dsm=dict(Pcrl=20, Pcrd=20)))
    assert r['Pn'] == 0 and r['pass'] is None


def test_R4_16_closed_box_ltb_step_text():
    """R4-16: F2.1.4 계산서는 개단면 σey·σt 식이 아니라 Lu·√(EGJIy) 식을 찍는다(II-9, Lb=2000)."""
    r = design_member(dict(member_type='flexure', Fy=46.0, Lb=2000.0, Cb=1.0, Mu=1.0, section_type='RHS',
                           props=dict(A=2.91, Sf=5.56, Izz=16.7, Ixx=16.7, J=25.3, rx=2.393, ry=2.393),
                           dsm=dict(Mcrl=1e4, Mcrd=0)))
    f = _step(r, 'Fcre')['formula']
    assert 'σey' not in f and 'Lu' in f
    # 독립 계산: Eq. F2.1.4-2
    Fcre = math.pi / (2000.0 * 5.56) * math.sqrt(E * G * 25.3 * 16.7)
    _close(r['Fcre_detail']['Fcre'], Fcre, 1e-3, 'F2.1.4-2 Fcre')
    assert 'I6.1.2' not in design_member(dict(member_type='flexure', Fy=55, Lb=60.0, Mu=1.0,
                                              section_type='C', props=dict(C9), through_fastened=True,
                                              dsm=dict(Mcrl=1e4, Mcrd=1e4)))['spec_sections']


def test_R4_17_no_print_and_no_shared_detail_state():
    """R4-17/§4.7: 담당 파일에 print() 가 없고, compute_beam_Fcre 는 공유 전역 상세를 쓰지 않는다."""
    for fname in ('aisi_s100.py', 'dsm_strength.py', 'global_buckling.py', 'interaction.py'):
        path = os.path.join(ROOT, 'python', 'design', fname)
        tree = ast.parse(open(path, encoding='utf-8').read())
        prints = [n.lineno for n in ast.walk(tree)
                  if isinstance(n, ast.Call) and getattr(n.func, 'id', None) == 'print']
        assert not prints, (fname, prints)
    compute_beam_Fcre(dict(C9), 1.0, 60.0, section_type='C')
    assert not hasattr(compute_beam_Fcre, '_last_detail')
    f, d = compute_beam_Fcre_detail(dict(C9), 1.0, 60.0, section_type='C')
    assert f > 0 and d['equation'] == 'F2.1.1'


def test_R4_18_unimplemented_provisions_visible_and_tension_skips_B4():
    """R4-18: 미구현 조항을 not_checked·warnings 로 보이고, Table B4.1-1 은 인장(D장)에 쓰지 않는다."""
    r = design_member(dict(member_type='tension', Fy=50, Fu=65, Tu=1.0, An=0.8,
                           props=dict(A=0.881, t=0.02, h_web=8.0)))
    assert not r.get('dsm_warnings') and r['pass'] is True
    r = design_member(dict(member_type='combined', Fy=55, KxLx=60, KyLy=60, KtLt=60, Lb=60, Pu=1.0, Mux=1.0,
                           Cmx=1.0, Cmy=1.0, section_type='C', props=dict(C9, xo=1.0),
                           dsm=dict(Pcrl=1e4, Pcrd=1e4, Mcrl=1e4, Mcrd=1e4)))
    assert any('B2' in x for x in r['not_checked']) and any('H4' in x for x in r['not_checked'])
    assert any('B2' in w for w in r['scope_notes']) and any('구멍' in w for w in r['scope_notes'])


def test_R7_17_appendix2_fallback_gets_out_to_out_dimensions():
    """R7-17: 부록 2 해석식에 외-외 치수를 넘긴다. Manual II-5 (800S200-54, 휨, kφ=0):
    Fcrd = 46.5 ksi (Eq. 2.3.3.3-2). 평탄폭만 준 경우도 외-외로 복원해 같은 값."""
    sect = dict(type='C', depth=8.0, flange_width=2.0, lip_depth=0.625, thickness=0.0566, r=0.0849)
    props = dict(A=0.6, Sf=1.0, rx=3.0, ry=0.7, ro=3.3, J=1e-3, Cw=2.0, t=0.0566, R=0.0849)
    for case in ('section', 'flats'):
        p = dict(member_type='flexure', Fy=50, Lb=0.0001, Mu=1.0, section_type='C',
                 dsm=dict(Mcrl=1e4, Mcrd=0))
        if case == 'section':
            p.update(props=dict(props), section=dict(sect))
        else:
            c = 0.0849 + 0.0566
            p.update(props=dict(props, h_web=8.0 - 2 * c, b_flange=2.0 - 2 * c, d_lip=0.625 - c))
        r = design_member(p)
        f = _step(r, 'Distortional')['formula']
        Mcrd = float(f.split('Mcrd = ')[1].split(' kip-in')[0])
        _close(Mcrd / 1.0, 46.5, 0.005, f'II-5 Fcrd ({case})')
        assert r['dsm_source']['Mcrd'].startswith('§2.3.3.3')
    # 국부 해석식(Eq. 1.1-4, 압축)도 외-외 치수로: 웹 w = ho − 2(R+t) (k 4). 평탄폭(h_web)을 ho 로
    # 넘기던 리뷰 시점 코드는 w = h − 2(R+t) 로 코너를 두 번 빼 Fcrl 이 컸다(9CS 5.78 → 5.13 ksi).
    t, R = 0.059, 0.1875
    w = 9.0 - 2 * (R + t)
    Fcrl = 4.0 * PI2E / (12 * (1 - 0.09)) * (t / w) ** 2
    for case in ('section', 'flats'):
        p = dict(member_type='compression', Fy=55, KxLx=24, KyLy=24, KtLt=24, Pu=1.0, section_type='C',
                 dsm=dict(Pcrl=0, Pcrd=1e4))
        if case == 'section':
            p.update(props=dict(C9, xo=1.83, t=t, R=R),
                     section=dict(type='C', depth=9.0, flange_width=2.5, lip_depth=0.773, thickness=t, r=R))
        else:
            c = R + t
            p.update(props=dict(C9, xo=1.83, t=t, R=R, h_web=9.0 - 2 * c, b_flange=2.5 - 2 * c,
                                d_lip=0.773 - c))
        r = design_member(p)
        f = _step(r, 'Local')['formula']
        Pcrl = float(f.split('Pcrl = ')[1].split(' kips')[0])
        _close(Pcrl / 0.881, Fcrl, 0.005, f'9CS Fcrl out-to-out ({case})')
        _close(Fcrl, 5.13, 0.01, 'R7-17 table value 5.13 ksi')


def test_sec42_auto_bending_stress_peak_equals_fy_for_Z():
    """§4.2: 자동 휨 FSM 응력의 최대 |σ| 는 Fy (Z 의 Ixz≠0 에서도 unsymm=0 으로 My 와 같은 분포)."""
    from engine.template import generate_section
    from engine.properties import grosprop
    for st, dims in (('lippedz', {'H': 8.0, 'B': 2.25, 'D': 0.91, 't': 0.059, 'r': 0.1875}),
                     ('lippedc', {'H': 9.0, 'B': 2.5, 'D': 0.773, 't': 0.059, 'r': 0.1875})):
        sec = generate_section(st, dims)
        props = grosprop(sec['node'], sec['elem'])
        node_m = _bending_reference_nodes(sec['node'], props, 55.0)
        _close(float(abs(node_m[:, 7]).max()), 55.0, 1e-6, f'{st} peak stress')


def test_auto_generate_reports_failures_in_result_not_stdout():
    """R4-17: 자동 생성 실패는 stdout 이 아니라 결과(_auto_error / 오류)로 돌아온다."""
    p = _auto_generate_props({'section_type': 'no_such_template', 'H': 8, 'B': 2, 't': 0.05, 'Fy': 50})
    assert p.get('_auto_error')
    r = design_member({'member_type': 'compression', 'Fy': 50, 'section_type': 'no_such_template',
                       'H': 8, 'B': 2, 't': 0.05, 'Pu': 1.0})
    assert 'error' in r


def test_V2_04_single_minimum_is_a_floor_not_a_cap():
    """V2-04: 단일 극소는 분리되지 않은 모드 임계값의 하한(서명곡선 = 포락선)이다 — 상한으로 쓰지 않는다.

    해석식(§2.3.1.3) Pcrd 가 극소 값보다 크면 해석식을 쓰고, 작으면 극소 값으로 올린다. 같은 부재가
    진단 키 유무(자동 경로 · 화면 경로)와 관계없이 같은 답을 낸다."""
    Py = 0.881 * 55.0
    base = dict(member_type='compression', section_type='lippedc', H=9.0, B=2.5, D=0.773, t=0.059,
                r=0.1875, Fy=55.0, Pu=1.0, KxLx=24.0, KyLy=24.0, KtLt=24.0,
                props=dict(A=0.881, rx=3.42, ry=0.890, J=0.00102, Cw=11.9, xo=1.83, t=0.059, R=0.1875))
    plain = design_member(dict(base, dsm={'Pcrl': 0.125 * Py, 'Pcrd': 0.0}))
    low = design_member(dict(base, dsm={'Pcrl': 0.125 * Py, 'Pcrd': 0.0, 'P_single_minimum': True,
                                        'P_single_minimum_bound': 0.125 * Py,
                                        'P_warnings': ['single minimum note']}))
    assert low['Pnd'] == plain['Pnd'] and low['Pn'] == plain['Pn']
    # 해석식 Pcrd/Py ≈ 0.32 → Pnd ≈ 0.44 Py; 극소 값(0.125 Py)을 상한으로 쓰면 0.27 Py 가 된다
    assert low["Pnd"] > 0.40 * Py
    assert any('single minimum note' in a for a in low['assumptions'])
    high = design_member(dict(base, dsm={'Pcrl': 0.125 * Py, 'Pcrd': 0.0, 'P_single_minimum': True,
                                         'P_single_minimum_bound': 0.60 * Py}))
    lam_d = math.sqrt(1 / 0.60)
    Pnd = (1 - 0.25 * 0.60 ** 0.6) * 0.60 ** 0.6 * Py if lam_d > 0.561 else Py
    _close(high['Pnd'], Pnd, 2e-3, 'Pnd raised to the single-minimum floor')
    assert 'floor' in high['dsm_source']['Pcrd']


def test_V2_04_manual_I_8B_two_sided_and_path_independent():
    """V2-04: Manual Example I-8B (9CS2.5x059 완전 횡지지, Fy 55, ASD): Pa = Pnl/Ωc = 10.8 kips,
    Ma = 55.4 kip-in. 양쪽 경계(±3 %). 자동 경로와 진단 키 없는 화면식 dsm 이 같은 Pa."""
    base = dict(section_type='lippedc', H=9.0, B=2.5, D=0.773, t=0.059, r=0.1875, Fy=55.0, Fu=70.0,
                design_method='ASD')
    r = design_member(dict(base, member_type='compression', KxLx=1.0, KyLy=1.0, KtLt=1.0, Pu=1.0))
    _close(r['design_strength'], 10.8, 0.03, 'I-8B Pa')
    assert r['pass'] is True
    p = _auto_generate_props(dict(base, member_type='compression'))
    keep = ('Pcrl', 'Pcrd', 'Py', 'Mcrl', 'Mcrd', 'My', 'P_classification_method',
            'P_local_detected', 'P_dist_detected')
    panel = design_member(dict(member_type='compression', design_method='ASD', Fy=55.0, Pu=1.0,
                               KxLx=1.0, KyLy=1.0, KtLt=1.0, section_type='C', props=p['props'],
                               section=p['section'], dsm={k: p['dsm'][k] for k in keep if k in p['dsm']}))
    assert panel['design_strength'] == r['design_strength']
    m = design_member(dict(base, member_type='flexure', Lb=0.0, Mu=1.0))
    _close(m['design_strength'], 55.4, 0.03, 'I-8B Ma')


def test_F5_boundary_minimum_and_inconsistent_reference_are_not_evaluated():
    """F5 후속: 격자 하한 극소·기준 응력 불일치인 FSM 값으로는 판정하지 않는다."""
    base = dict(member_type='compression', Fy=50.0, KxLx=120.0, KyLy=60.0, KtLt=60.0, Pu=1.0,
                section_type='C', props=dict(III3), section=dict(III3_SECTION),
                dsm=dict(Pcrl=0.75 * 21.1, Pcrd=1.11 * 21.1))
    assert design_member(base)['pass'] is True
    r = design_member(dict(base, dsm=dict(base['dsm'], P_boundary_minimum=True)))
    assert r['pass'] is None and any('E3' in x for x in r['not_evaluated'])
    r = design_member(dict(base, dsm=dict(base['dsm'], P_reference_stress_consistent=False)))
    assert r['pass'] is None and any('E4' in x for x in r['not_evaluated'])


def test_auto_path_result_is_json_serialisable():
    """server.py 는 결과를 JSON 으로 보낸다 — numpy bool/스칼라가 판정 필드에 새지 않아야 한다."""
    import json
    for mt in ('compression', 'flexure', 'combined'):
        r = design_member(dict(member_type=mt, section_type='lippedz', H=8.0, B=2.25, D=0.91, t=0.059,
                               r=0.1875, Fy=55.0, Fu=70.0, Pu=1.0, Mu=10.0, Mux=10.0, Cmx=1.0, Cmy=1.0,
                               KxLx=60.0, KyLy=60.0, KtLt=60.0, Lb=60.0))
        assert 'error' not in r, r
        json.dumps(r)
        assert r['pass'] in (True, False, None) and type(r['pass']) in (bool, type(None))


def test_R3_01_rounded_corner_lipped_C_KL100():
    """R3-01/F3 후속: 립C 8×2.5×0.625×0.059, r=0.157, Fy 50, KL=100 in — 국부 극소를 국부로 다루면
    Pn ≤ 9.99 kips (R3 'KL 별 결과', 리뷰 시점 자동 경로 12.76). 옛 dsm 출력(Pcrl=0, Pcrd=6.889,
    cfsm_modal, local_detected=False)을 넣어도 F4 쪽만으로 같은 상한 안에 들어와야 한다."""
    base = dict(member_type='compression', section_type='lippedc', H=8.0, B=2.5, D=0.625, t=0.059,
                r=0.157, Fy=50.0, Fu=65.0, Pu=1.0, KxLx=100.0, KyLy=100.0, KtLt=100.0)
    r = design_member(dict(base))
    assert 'error' not in r, r
    assert r['Pn'] <= 9.99 * 1.005, r['Pn']
    old = {'Pcrl': 0.0, 'Pcrd': 6.889, 'P_classification_method': 'cfsm_modal',
           'P_local_detected': False, 'P_dist_detected': True}
    r = design_member(dict(base, dsm=old))
    assert r['Pn'] <= 9.99 * 1.005, r['Pn']


def test_V2_01_auto_path_keeps_sloped_lips():
    """V2-01: 자동 경로가 qlip 을 템플릿에 넘긴다. 8ZS2.25x059(50° 립) Lb 0: Mn = min(My, Mnl, Mnd)
    with Mcrl/My 0.844, Mcrd/My 0.767 (R5 표 · V2 독립 FSM, 50° 립). 90° 립이면 Mcrd 가 커서 Mn 이 크다."""
    Z = dict(member_type='flexure', section_type='lippedz', H=8.0, B=2.25, D=0.91, t=0.059, r=0.1875,
             Fy=55.0, Fu=70.0, Lb=0.0, Mu=1.0)
    r50 = design_member(dict(Z, qlip=50))
    r90 = design_member(dict(Z, qlip=90))
    assert r50['auto_generated_section']['qlip'] == 50
    My = r50['My']   # = Sf·Fy (Sf: grosprop 최외단, 시험 대상 아님)
    Mn_hand = min(My, _dsm_local(My, 0.844 * My), _dsm_dist_flex(My, 0.767 * My))
    _close(r50['Mn'], Mn_hand, 0.01, '8ZS 50 deg lip Mn')
    assert r90['Mn'] > 1.05 * r50['Mn']


def test_V2_02_h3_evaluated_for_built_up_I_and_hat():
    """V2-02: 맞댄 I(9CS 두 개)는 §H3(b) Eq. H3-2 로 검토된다 — V2 독립값 0.88·P/Pn + M/Mnlo = 1.475 > 1.314.
    Mnlo 는 F3.2.1 (Mne = My = Sf·Fy, Mcrl 169) 손계산."""
    p = dict(member_type='flexure', design_method='LRFD', Fy=55.0, Fu=70.0, Lb=0.0, Cb=1.0,
             section_type='I', props=dict(A=1.762, Sf=4.58, rx=3.42, ry=1.2, J=0.002, Cw=30.0, xo=0.0,
                                          t=0.059, R=0.1875, h_web=8.51, b_flange=4.6, d_lip=0.53),
             section=dict(type='I', depth=9.0, flange_width=5.0, lip_depth=0.773, thickness=0.059, r=0.1875),
             dsm=dict(Mcrl=169.0, Mcrd=215.0), wc_N=3.5, wc_R=0.15, wc_support='IOF', wc_fastened='unfastened')
    probe = design_member(dict(p, Mu=1.0, wc_P=0.01))
    Pn = probe['web_crippling']['Pn']
    My = 4.58 * 55.0
    Mnlo = _dsm_local(My, 169.0)
    phiMn = 0.9 * min(My, Mnlo, _dsm_dist_flex(My, 215.0))
    P, M = 0.9 * 0.9 * Pn, 0.9 * phiMn     # φw 0.90 (Table G5-1 unfastened IOF)
    r = design_member(dict(p, Mu=M, wc_P=P, wc_M=M))
    h3 = r['h3_interaction']
    assert h3['equation'] == 'H3-2'
    _close(h3['total'], 0.88 * P / Pn + M / Mnlo, 2e-3, 'H3-2 left side')
    _close(h3['limit'], 1.46 * 0.90, 1e-6, 'H3-2 LRFD limit 1.46φ')
    assert h3['total'] > h3['limit']
    assert r['pass'] is False and r['governing_check'] == 'H3 bending + web crippling'
    # hat: 각 웹은 단일 무보강 웹 → H3-1 로 계산(판정이 빠지지 않음)
    hat = design_member(dict(member_type='flexure', section_type='hat', H=3.0, B=4.0, D=1.0, t=0.06, r=0.1,
                             Fy=50.0, Fu=65.0, Lb=0.0, Mu=1.0, wc_N=3.0, wc_R=0.1, wc_support='IOF', wc_P=0.5))
    assert hat['h3_interaction']['equation'] == 'H3-1'


def test_V2_03_i621_R_against_table():
    """V2-03: Table I6.2.1-1 — 9 in C 는 단순 0.40, 연속 0.60. R 0.70 은 판정에 쓰지 않는다."""
    common = dict(member_type='flexure', Fy=55, Fu=70, Lb=0.0001, Mu=30.0, section_type='C',
                  props=dict(C9, t=0.059, R=0.1875),
                  section=dict(type='C', depth=9.0, flange_width=2.5, lip_depth=0.773, thickness=0.059, r=0.1875),
                  dsm=dict(Mcrl=84.4, Mcrd=107.0))
    Mnlo = _dsm_local(2.29 * 55.0, 84.4)
    r = design_member(dict(common, R_uplift=0.70))
    assert r['pass'] is None and any('Table I6.2.1-1 R=0.40' in w for w in r['warnings'])
    r = design_member(dict(common, R_uplift=0.60, span_type='continuous'))
    assert r['pass'] is True
    _close(r['Mn'], 0.60 * Mnlo, 2e-3, 'Mn = R*Mnlo')
    r = design_member(dict(common, R_uplift=0.60, span_type='simple'))
    assert r['pass'] is None


def test_V3_21_uplift_R_route_is_R_times_Mnlo():
    """V3-21 (Manual Example II-2A/II-2B): 8ZS2.25x059 내부 경간 양력, R = 0.70 연속, 긴 Ly 270 in,
    ASD M = 1.81 kip-ft. Eq. I6.2.1-1: Mn = R·Mnlo (Mnlo = F3.2.1, Mne = My = Sf·Fy, Mcrl 91 — II-2B).
    LTB(Mne)로 자르지 않는다(자르면 Fcre 가 수 ksi 라 10배 넘게 불합격)."""
    Zp = dict(A=0.822, Sf=1.94, rx=3.04, ry=0.83, ro=3.17, J=0.000954, Cw=11.3, xo=0.0, I22=0.25,
              t=0.059, R=0.1875)
    r = design_member(dict(member_type='flexure', design_method='ASD', Fy=55, Fu=70, Lb=270.0, Cb=1.0,
                           Mu=1.81 * 12, section_type='Z', props=Zp, R_uplift=0.70, span_type='continuous',
                           section=dict(type='Z', depth=8.0, flange_width=2.25, lip_depth=0.91,
                                        thickness=0.059, r=0.1875),
                           dsm=dict(Mcrl=91.0, Mcrd=101.0)))
    Mnlo = _dsm_local(1.94 * 55.0, 91.0)
    _close(r['Mn'], 0.70 * Mnlo, 2e-3, 'II-2A uplift Mn = R*Mnlo')
    assert r['pass'] is True and r['Mne'] < r['Mn']


def test_V2_05_V2_09_hat_dimensions():
    """V2-05/V2-09: hat 은 H = 상판 폭, B = 깊이, D = 브림(템플릿 규약). 웹 평탄폭은 B 에서, 브림은 립이 아니다.
    hat 3×4×1×0.06, r 0.1, IOF N 3: G5-4 Pn = 6.71 kips (V2 독립값; 상판 폭을 웹으로 읽으면 7.16).
    G2 는 웹 2개. 화면처럼 section.lip_depth = 브림을 보내도 E4 는 해당 없음."""
    hat = dict(section_type='hat', H=3.0, B=4.0, D=1.0, t=0.06, r=0.1, Fy=50.0, Fu=65.0)
    r = design_member(dict(hat, member_type='flexure', Lb=0.0, Mu=1.0, Vu=0.5, wc_N=3.0, wc_R=0.1,
                           wc_support='IOF', wc_P=0.5))
    _close(r['web_crippling']['Pn'], 6.71, 0.005, 'hat G5-4 Pn')
    assert r['shear']['n_webs'] == 2 and r['pass'] is True
    p = _auto_generate_props(dict(hat))
    panel_section = dict(type='HAT', depth=3.0, flange_width=4.0, lip_depth=1.0, thickness=0.06, R_corner=0.1)
    rp = design_member(dict(member_type='compression', Fy=50.0, KxLx=24, KyLy=24, KtLt=24, Pu=1.0,
                            section_type='HAT', props={k: v for k, v in p['props'].items()
                                                        if k not in ('h_web', 'b_flange', 'd_lip')},
                            section=panel_section, dsm={'Pcrl': p['dsm']['Pcrl'], 'Pcrd': 0.0}))
    assert rp['distortional_not_evaluated'] is False and rp['pass'] is True


def test_V2_06_moment_sign_for_unsymmetric_sections():
    """V2-06: x 축 비대칭 단면(hat)의 부모멘트를 +Mxx DSM 값으로 판정하지 않는다. C(대칭)는 영향 없음."""
    hat = dict(member_type='flexure', section_type='hat', H=3.0, B=4.0, D=1.0, t=0.06, r=0.1, Fy=50.0,
               Fu=65.0, Lb=0.0)
    pos = design_member(dict(hat, Mu=1.0))
    neg = design_member(dict(hat, Mu=-1.0))
    assert pos['moment_sign'] == '+' and neg['moment_sign'] == '-'
    assert pos['pass'] is True and neg['pass'] is None
    c = design_member(dict(member_type='flexure', section_type='C', Fy=55, Lb=0.0001, Mu=-10.0,
                           props=dict(C9), dsm=dict(Mcrl=84.4, Mcrd=107.0)))
    assert c['pass'] is True


def test_V2_11_unrestrained_reference_not_mixed_with_restrained_My():
    """V2-11: 비구속 휨 응력에서 뽑은 Mcrl/Mcrd(reference_unsymm=1)를 구속 My 와 섞지 않는다."""
    p = dict(member_type='flexure', section_type='Z', Fy=55, Lb=0.0001, Mu=1.0,
             props=dict(A=0.822, Sf=1.94, rx=3.04, ry=0.83, ro=3.17, J=0.000954, Cw=11.3, xo=0.0, I22=0.25),
             dsm=dict(Mcrl=91.0, Mcrd=101.0))
    assert design_member(p)['pass'] is True
    r = design_member(dict(p, dsm=dict(p['dsm'], M_reference_unsymm=1)))
    assert r['pass'] is None and any('unrestrained' in x for x in r['not_evaluated'])


def test_V2_16_chs_auto_path():
    """V2-16: CHS 자동 경로가 OD 로 단면을 만든다. CHS 6×0.12, Fy 42: KL 24 Pn 92.29 kips,
    Lb 24 Mn 167.06 kip-in (V2 독립값: E2 폐단면 · F2.3 · FSM 국부)."""
    base = dict(section_type='chs', D=6.0, t=0.12, Fy=42.0, Fu=58.0)
    r = design_member(dict(base, member_type='compression', KxLx=24, KyLy=24, KtLt=24, Pu=1.0))
    assert 'error' not in r, r
    _close(r['Pn'], 92.29, 0.003, 'CHS Pn')
    m = design_member(dict(base, member_type='flexure', Lb=24.0, Mu=1.0))
    _close(m['Mn'], 167.06, 0.003, 'CHS Mn')


def test_V2_10_notices_split_and_not_repeated():
    """V2-10 / FIXES §3.1.1: 평범한 실행의 warnings 는 비고, 범위 진술은 scope_notes, 가정은 assumptions.
    조합은 하위 알림을 되풀이하지 않는다. spec_sections 는 정렬."""
    base = dict(section_type='lippedc', H=9.0, B=2.5, D=0.773, t=0.059, r=0.1875, Fy=55.0, Fu=70.0)
    m = design_member(dict(base, member_type='flexure', Lb=48.0, Mu=10.0))
    assert m['warnings'] == [], m['warnings']
    assert any('구멍' in x for x in m['scope_notes']) and m['assumptions']
    assert m['spec_sections'] == sorted(m['spec_sections'])
    c = design_member(dict(base, member_type='combined', KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0,
                           Pu=3.0, Mux=30.0, Cmx=1.0, Cmy=1.0))
    for key in ('warnings', 'assumptions', 'scope_notes'):
        assert len(c[key]) == len(set(c[key])), key
        assert not any(x.startswith('[압축]') or x.startswith('[휨x]') for x in c[key]), key
    t = design_member(dict(member_type='tension', Fy=50, Fu=65, Tu=1.0, An=0.8, props=dict(A=0.881)))
    assert t['warnings'] == [] and any('D1' in x for x in t['scope_notes'])


def test_V4_04_H2_uses_Malo_not_governing_strength():
    """V4-04: §H2 Eq. H2-1 의 휨 강도는 Malo(§F3, Fn = Fy / Mne = My 의 국부좌굴 가용강도)다 — 지배 강도
    (여기서는 뒤틀림 Mnd) 가 아니다. Manual Example II-2A 안경간 랩 끝(II-2B 의 DSM 값으로):
    8ZS2.25x059, Fy 55, ASD, M̄ 3.892 kip-ft, V̄ 1.187 kip.
    Mnlo = F3.2.1(My = 1.94·55, Mcrl 91), Va = §G2.1 손계산(h = 8 − 2(R+t), kv 5.34, Ωv 1.60).
    Manual 자신의 DSM 값(Mnℓ 86.2, Va 2.43)으로 √((3.89/4.30)² + (1.18/2.43)²) = 1.027."""
    t, R, Fy = 0.059, 0.1875, 55.0
    Zp = dict(A=0.822, Sf=1.94, rx=3.04, ry=0.83, ro=3.17, J=0.000954, Cw=11.3, xo=0.0, I22=0.25, t=t, R=R)
    M, V = 3.892 * 12, 1.187
    r = design_member(dict(member_type='flexure', design_method='ASD', Fy=Fy, Fu=70, Lb=49.1, Cb=1.67,
                           Mu=M, Vu=V, section_type='Z', props=Zp,
                           section=dict(type='Z', depth=8.0, flange_width=2.25, lip_depth=0.91,
                                        thickness=t, r=R),
                           dsm=dict(Mcrl=91.0, Mcrd=101.0)))
    Mnlo = _dsm_local(1.94 * Fy, 91.0)
    h = 8.0 - 2 * (R + t)
    Aw = h * t
    Vy = 0.6 * Aw * Fy
    Vcr = math.pi ** 2 * E * 5.34 * Aw / (12 * (1 - 0.09) * (h / t) ** 2)
    lam = math.sqrt(Vy / Vcr)
    Vn = Vy if lam <= 0.815 else (0.815 * math.sqrt(Vcr * Vy) if lam <= 1.227 else Vcr)
    Va = Vn / 1.60
    _close(Va, 2.43, 0.01, 'Va (Manual II-2A 2.43)')
    expected = math.sqrt((M / (Mnlo / 1.67)) ** 2 + (V / Va) ** 2)
    si = r['shear_interaction']
    _close(si['total'], expected, 2e-3, 'H2-1 with Malo')
    _close(si['total'], 1.027, 0.005, 'Manual DSM numbers 1.027')
    _close(si['Malo'], Mnlo / 1.67, 2e-3, 'Malo = Mnlo/Omega')
    assert si['Malo'] > r['design_strength']   # 지배 강도(뒤틀림)보다 크다 — 대신 쓰면 1.14
    step = _step(r, 'Bending + Shear')
    assert step['equation'] == 'H2-1' and 'Mnℓo' in step['formula']
    # 전단보강재가 있으면 Malo = min(F3, F4), Eq. H2-2 는 M/Malo > 0.5 이고 V/Va > 0.7 일 때만
    rs = design_member(dict(member_type='flexure', design_method='ASD', Fy=Fy, Fu=70, Lb=49.1, Cb=1.67,
                            Mu=M, Vu=2.0, transverse_stiffeners=True, section_type='Z', props=Zp,
                            section=dict(type='Z', depth=8.0, flange_width=2.25, lip_depth=0.91,
                                         thickness=t, r=R),
                            dsm=dict(Mcrl=91.0, Mcrd=101.0)))
    ss = rs['shear_interaction']
    Mnd = _dsm_dist_flex(1.94 * Fy, 101.0)
    _close(ss['Malo'], min(Mnlo, Mnd) / 1.67, 2e-3, 'Malo with stiffeners')
    assert ss['equation'] == 'H2-2'
    _close(ss['lhs'], 0.6 * M / ss['Malo'] + 2.0 / rs['shear']['design_strength'], 2e-3, 'H2-2 lhs')


def test_W3_steps_describe_the_reported_path():
    """W3 (V4 뒤): 계산서 단계는 보고한 강도를 만든 길을 말한다.
    R 경로(§I6.2.1): Mnℓo(F3, Fn = Fy) · Table I6.2.1-1 행 · Mn = R·Mnℓo 단계가 있고, 보고한 Mn 과
    설계강도가 그 단계 값과 같으며, F2(LTB)·F4·DSM 최소 단계는 '쓰지 않음'으로 표시된다.
    정모멘트 구간 · G5 · H3 · H1.2 가 지배하거나 판정에 들어가면 그 단계도 있다."""
    Zp = dict(A=0.822, Sf=1.94, rx=3.04, ry=0.83, ro=3.17, J=0.000954, Cw=11.3, xo=0.0, I22=0.25,
              t=0.059, R=0.1875)
    sect = dict(type='Z', depth=8.0, flange_width=2.25, lip_depth=0.91, thickness=0.059, r=0.1875)
    r = design_member(dict(member_type='flexure', design_method='ASD', Fy=55, Fu=70, Lb=270.0, Cb=1.0,
                           Mu=21.72, section_type='Z', props=Zp, R_uplift=0.70, span_type='continuous',
                           section=sect, dsm=dict(Mcrl=91.0, Mcrd=101.0)))
    by = {s['step']: s for s in r['steps']}
    Mnlo = _dsm_local(1.94 * 55.0, 91.0)
    _close(by['5a']['value'], Mnlo, 2e-3, 'step 5a Mnlo')
    assert 'I6.2.1' in by['5b']['name'] and by['5b']['equation'] == 'I6.2.1-1'
    assert 'continuous span, Z → 0.70' in by['5b']['formula']
    _close(by['5b']['value'], r['Mn'], 1e-6, 'step 5b = reported Mn')
    _close(r['Mn'], 0.70 * Mnlo, 2e-3, 'Mn = R*Mnlo')
    assert any(abs(s.get('value', 0) - r['design_strength']) < 0.006 for s in r['steps'])
    for k in (2, '2a', 4, 5):
        assert by[k].get('not_used') is True and 'controlling_mode' not in by[k], k
    assert 'I6.2.1' in r['spec_sections'] and 'F2' not in r['spec_sections'] and 'F4' not in r['spec_sections']
    assert 'I6.2.1' in r['controlling_mode'] and 'I6.2.1' in r['report']
    # 정모멘트 구간이 지배하면 그 단계가 있다
    rp = design_member(dict(member_type='flexure', Fy=55, Lb=56.3, Cb=1.67, Mu=50.0, Mu_pos=110.0,
                            Lb_pos=0.0, section_type='C', props=dict(C9),
                            dsm=dict(Mcrl=84.4, Mcrd=107.0)))
    pos = [s for s in rp['steps'] if str(s['name']).startswith('Positive-moment region')]
    assert rp['governing_check'] == 'F positive region' and pos
    _close(pos[0]['value'], rp['positive_region']['phi_Mn'], 1e-6, 'positive-region step value')
    # G5 · H3 단계
    base = dict(member_type='flexure', design_method='LRFD', Fy=50, Lb=0.0001, section_type='C', Mu=1.0,
                props=dict(C9, t=0.059, R=0.1875, h_web=8.51, b_flange=1.98, d_lip=0.53),
                section=dict(type='C', depth=9.0, flange_width=2.5, lip_depth=0.773, thickness=0.059, r=0.1875),
                dsm=dict(Mcrl=1e4, Mcrd=1e4), wc_N=3.0, wc_R=0.1875, wc_support='EOF', wc_P=1.0)
    rw = design_member(base)
    names = [str(s['name']) for s in rw['steps']]
    assert any(n.startswith('Web crippling (§G5') for n in names)
    assert any(n.startswith('Bending + web crippling (§H3') for n in names)
    # 웹 크리플링 입력이 없으면 not_checked 에 보인다(판정은 바꾸지 않음)
    assert any('wc_N' in x for x in design_member(dict(base, wc_N=0))['not_checked'])
    # 조합: H1.2 단계
    rc = design_member(dict(member_type='combined', Fy=55, KxLx=96.0, KyLy=48.0, KtLt=48.0, Lb=48.0,
                            Pu=3.0, Mux=30.0, Cmx=1.0, Cmy=1.0, section_type='C', props=dict(C9, xo=1.83),
                            dsm=dict(Pcrl=1e4, Pcrd=1e4, Mcrl=1e4, Mcrd=1e4)))
    h12 = [s for s in rc['steps'] if str(s['name']).startswith('Axial + bending interaction')]
    assert h12 and abs(h12[0]['value'] - rc['interaction']['total']) < 1e-9


def test_V4_18_web_crippling_load_source():
    """V4-18 나머지: wc_N 은 있는데 wc_P 가 없으면 Vu 를 지압 하중으로 쓰되 assumptions 와
    web_crippling.load_source 로 밝힌다. 둘 다 없으면 0 하중 합격이 아니라 G5 · H3 미평가.
    축력 Pu 는 지압 하중으로 쓰지 않는다."""
    base = dict(member_type='flexure', design_method='LRFD', Fy=50, Lb=0.0001, section_type='C', Mu=1.0,
                props=dict(C9, t=0.059, R=0.1875, h_web=8.51, b_flange=1.98, d_lip=0.53),
                section=dict(type='C', depth=9.0, flange_width=2.5, lip_depth=0.773, thickness=0.059, r=0.1875),
                dsm=dict(Mcrl=1e4, Mcrd=1e4), wc_N=3.0, wc_R=0.1875, wc_support='EOF')
    explicit = design_member(dict(base, wc_P=0.8, Vu=0.5))
    assert explicit['web_crippling']['load_source'] == 'wc_P' and explicit['web_crippling']['load'] == 0.8
    assert not any('Vu' in a and '웹 크리플링 하중' in a for a in explicit['assumptions'])
    by_vu = design_member(dict(base, Vu=0.5))
    wc = by_vu['web_crippling']
    assert wc['load_source'] == 'Vu' and wc['load'] == 0.5
    assert any('웹 크리플링 하중으로 Vu' in a for a in by_vu['assumptions'])
    _close(wc['ratio'], 0.5 / wc['design_strength'], 2e-3, 'G5 ratio with Vu as load')
    none = design_member(dict(base, Pu=5.0))       # 축력만 — 지압 하중 없음
    assert none['web_crippling']['load_source'] is None
    assert none['pass'] is None
    assert any('G5 web crippling' in x for x in none['not_evaluated'])
    assert any('H3' in x for x in none['not_evaluated'])
