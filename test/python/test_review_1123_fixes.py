"""2026-11-23 두 번째 묶음 — 작업문서 §8.3.1 의 일곱 가지 수정 회귀 시험.

각 시험은 수정 전 엔진에서 실패한다(반올림 띠 사례는 수정 전 판정이 반대였다 — contract_cases_1123 의
'band: …' 사례, 기준선 비교 참고). 기대값은 원문 식으로 시험 안에서 따로 계산하거나 Manual 인쇄값이다.
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), 'python'))
sys.path.insert(0, HERE)

from design.aisi_s100 import design_member  # noqa: E402
from design.connections import design_connection  # noqa: E402
from design.lap_connection import design_lap_connection  # noqa: E402
from design.global_buckling import beam_global_strength  # noqa: E402
import contract_cases_1123 as cases  # noqa: E402

E = 29500.0


def _case(name):
    return dict([p for n, _, p in cases.all_cases() if n == name][0])


def _check(r, cid):
    return [c for c in r['design_checks'] if c['id'] == cid][0]


def test_fix1_f2_equation_labels_are_S100_16_numbers():
    """§8.3.1-1: Fn 갈래의 식 번호는 F2.1-3 / -4 / -5 (S100-16 에 'F2-1' 은 없다). Mne = Sf·Fn 은 F2.1-1."""
    Fy = 55.0
    assert beam_global_strength(Fy, 3.0 * Fy, 1.0)['equation'].startswith('F2.1-3')
    assert beam_global_strength(Fy, 1.0 * Fy, 1.0)['equation'].startswith('F2.1-4')
    assert beam_global_strength(Fy, 0.5 * Fy, 1.0)['equation'].startswith('F2.1-5')
    r = design_member(_case('II-4A track LTB LRFD'))
    assert not any('F2-1' in str(s.get('equation')) for s in r['steps'])


def test_fix2_angle_PL1000_is_evaluated_in_combined_and_not_in_compression():
    """§8.3.1-2: 조합 검토가 (P)L/1000 을 넣어 평가했으면 압축 쪽 '미평가' 알림을 판정에 옮기지 않는다.
    반대로, 압축 단독(조합을 하지 않은) 앵글은 여전히 미평가다."""
    # 계약 §6.4(2026-11-24): 이 사례는 Mux = Muy = 0 을 준다 — 진술이 있어야 0 이다(없으면 판정 없음)
    assert design_member(_case('combined angle (P)L/1000'))['pass'] is None
    r = design_member(dict(_case('combined angle (P)L/1000'), zero_demand_stated=True))
    assert r['pass'] is True and not r.get('not_evaluated'), r.get('not_evaluated')
    h = _check(r, 'member.axial_bending')
    assert h['verdict'] == 'pass'
    # (P)L/1000 이 들어간 My 로 평가했다 — PL/1000 · My,ecc 단계와 그것을 고른 갈래(V6-01)
    pl = [s for s in h['steps'] if (s['result'] or {}).get('symbol') == 'PL/1000'][0]
    assert abs(pl['result']['value'] - 3.0 * 18.0 / 1000.0) <= 1e-12
    assert [s for s in h['steps'] if s['kind'] == 'branch'][0]['holds'] is True
    # 독립 계산: P/Pa + B1y·(Muy + P·L/1000)/May (ASD α = 1.6), Pa = 압축 설계강도
    Pa = _check(r, 'member.compression.global')['capacity']['value']
    Pe1y = math.pi ** 2 * E * 0.4 / (18.0 / 0.5) ** 2
    B1y = 1.0 / (1 - 1.6 * 3.0 / Pe1y)
    total = 3.0 / min(Pa, _check(r, 'member.compression.local')['capacity']['value'],
                      _check(r, 'member.compression.distortional')['capacity']['value']) \
        + B1y * (3.0 * 18.0 / 1000.0) / 4.97
    assert abs(h['ratio'] - total) <= 1e-9 * total
    bad = design_member(_case('combined angle (P)L/1000 fails'))
    assert bad['pass'] is False and _check(bad, 'member.axial_bending')['verdict'] == 'fail'
    comp = design_member(_case('compression angle H1.2 required'))
    assert comp['pass'] is None and any(x.startswith('H1.2 angle') for x in comp['not_evaluated'])
    assert _check(comp, 'member.axial_bending')['verdict'] == 'not_evaluated'


def test_fix3_positive_region_verdict_on_unrounded_ratio():
    """§8.3.1-3: Mu(+) = 83.2944 > φMn(+) = 83.29408 (비 1.000004). 옛 엔진은 비를 0.0001 로 반올림(1.0)한 뒤
    1.0 과 비교해 합격이었다. φMn(+) 손계산: Lb_pos = 0 → Mne = My = Sf·Fy, F3.2.1 · F4.1 (Mcrl 84.4, Mcrd 107)."""
    My = 2.29 * 55.0
    rl = (84.4 / My) ** 0.4
    Mnl = (1 - 0.15 * rl) * rl * My
    rd = (107.0 / My) ** 0.5
    Mnd = (1 - 0.22 * rd) * rd * My
    phiMn = 0.9 * min(My, Mnl, Mnd)
    assert 83.2944 > phiMn and round(83.2944 / phiMn, 4) == 1.0
    r = design_member(_case('band: positive region ratio 1.000004'))
    assert r['positive_region']['pass'] is False and r['pass'] is False
    assert r['positive_region']['utilization'] == 1.0          # 표시는 반올림 그대로
    assert 'positive_region.utilization' in r['display_rounding']['decimals']


def test_fix4_connection_verdict_on_unrounded_design_strength():
    """§8.3.1-4: Manual IV-9 (ASD) J6.1 — Pnv/Ω = 0.6·45·(2·2·0.105·(1.0 − 0.5625/2))/2.22 = 3.67145 kips.
    표시값은 3.671 이고 V = 3.6712 는 그 사이. 옛 엔진은 반올림값과 비교해 불합격(1.0001)이었다."""
    raw = 0.6 * 45 * (2 * 2 * 0.105 * (1.0 - (0.5 + 1 / 16) / 2)) / 2.22
    assert round(raw, 3) < 3.6712 <= raw
    r = design_connection(_case('band: IV-9 J6.1 design strength rounded'))
    assert r['pass'] is True and r['checks'][0]['pass'] is True
    assert r['shear_verified_design_strength'] == 3.671          # 표시값
    j61 = _check(r, 'conn.j6.shear_rupture')
    assert abs(j61['capacity']['value'] - raw) <= 1e-12 * raw and j61['verdict'] == 'pass'
    assert 'limit_states[].design_strength' in r['display_rounding']['decimals']


def test_fix5_H1_uses_unrounded_Pa_and_Max():
    """§8.3.1-5: III-11 (LRFD) 꼴, Mux = 43.0025 — 반올림한 Pa · Max(0.01) 로는 0.99999, 그대로는 1.00001.
    판정은 반올림하지 않은 값으로(불합격)."""
    r = design_member(_case('band: H1.2 with rounded Pa/Max'))
    h = _check(r, 'member.axial_bending')
    Pa = [i for s in h['steps'] for i in s['inputs'] if i['symbol'] == 'Pa'][0]['value']
    Max = [i for s in h['steps'] for i in s['inputs'] if i['symbol'] == 'Max'][0]['value']
    B1 = [s for s in h['steps'] if s['result'] and s['result']['symbol'] == 'B1x'][0]['result']['value']
    Mux = 43.00252593173444
    assert 69.0 / Pa + B1 * Mux / Max > 1.0 >= 69.0 / round(Pa, 2) + B1 * Mux / round(Max, 2)
    assert r['pass'] is False and h['verdict'] == 'fail'
    assert Pa != round(Pa, 2) and Max != round(Max, 2)           # 엔진이 반올림 전 값을 넘겼다


def test_fix6_web_crippling_uses_unrounded_Pn():
    """§8.3.1-6: Table G5-2 (fastened, stiffened, EOF: C 4, CR 0.14, CN 0.35, Ch 0.02), t 0.059, R 0.1875,
    N 3, h 8.51, Fy 50 → Pn = 1.38766 kips. φw 0.85. P = 1.1797: 옛 엔진은 Pn 을 1.388 로 반올림해 합격."""
    t, R, N, h, Fy = 0.059, 0.1875, 3.0, 8.51, 50.0
    Pn = 4 * t ** 2 * Fy * (1 - 0.14 * math.sqrt(R / t)) * (1 + 0.35 * math.sqrt(N / t)) * (1 - 0.02 * math.sqrt(h / t))
    assert 1.1797 / (0.85 * Pn) > 1.0 >= 1.1797 / (0.85 * round(Pn, 3))
    r = design_member(_case('band: web crippling Pn rounded'))
    wc = _check(r, 'member.web_crippling')
    assert abs(wc['nominal']['value'] - Pn) <= 1e-12 * Pn
    assert r['pass'] is False and wc['verdict'] == 'fail'
    assert r['web_crippling']['Pn'] == round(Pn, 2)              # 표시는 소수 2자리(display_rounding)


def test_fix7_lap_H2_reported_in_the_member_H2_form():
    """§8.3.1-7: 랩 지점부 H2 는 부재 H2 와 같은 꼴 √((M/Ma)² + (V/Va)²) — 판정은 같고 비는 견줄 수 있다.
    Manual II-2A 랩 안 지점: √((8.75/11.1)² + (1.78/6.53)²) = 0.834. 이 도구의 랩은 같은 두 부재를 가정하므로
    두 부재의 평균으로 넣는다: Se = (2.25 + 1.80)/2, Vn = 6.53·1.60/2 (Va = 2·Vn/Ωv = 6.53)."""
    p = dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=12, lap_right_in=30, Mu_support=8.75 * 12,
             Vu_support=1.78, fastener_type='bolt', fastener_dia=0.5, n_rows=2, end_distance=2.0,
             Se=(2.25 + 1.80) / 2, Vn=6.53 * 1.60 / 2, design_method='ASD',
             distortion_restrained=True)   # Manual II-2A 가정 (f): 겹친 부분은 뒤틀림이 구속됨(계약 §6.3)
    r = design_lap_connection(p)
    h = _check(r, 'lap.bending_shear')
    _Ma = 2 * p['Se'] * 55 / 1.67
    hand = math.sqrt((105.0 / _Ma) ** 2 + (1.78 / 6.53) ** 2)
    assert abs(h['ratio'] - hand) <= 1e-12 and abs(hand - 0.834) <= 0.005 * 0.834
    step = [s for s in r['steps'] if s['step'] == '8b'][0]
    assert step['value'] == round(hand, 3) and step['pass'] is True
    # 판정은 제곱합 꼴과 같다(제곱합 ≤ 1 ⇔ √ ≤ 1)
    over = design_lap_connection(dict(p, Mu_support=200.0 * 12))
    assert _check(over, 'lap.bending_shear')['verdict'] == 'fail' and over['pass'] is False
    assert r['flexure_dcr_governing'] == round(max(h['ratio'], r['flexure_dcr']), 4)
