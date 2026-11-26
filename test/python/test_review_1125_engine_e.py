"""2026-11-25 남은 작업 단계 E(엔진) — 회귀 시험.

E-1 빈 길이(엔진의 기본 120 in)로 낸 강도는 판정이 아니다(길이와 상관없는 한계상태로 넘을 때만 불합격).
E-2 랩 패스너 힘 분배 모델 A 의 판정은 사람이 밝혔을 때만(결정 R2).
E-3 하중조합 기준 선택(결정 R4) — 처음 값은 지금 그대로, 기준마다 손으로 셀 수 있는 사례 하나.
E-4 KS D 3506 강종 값(바꾸지 않음 — 확인한 출처의 값과 같음을 고정).
E-5 설계용 서명곡선 격자(결정 R8) — 엔진의 한 규칙.

기대값은 시험 안에서 따로 계산한 값(조합 계수 × 하중 × L²/8 등)이거나 확인한 표의 값이다.
"""

import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'python'))

from design.aisi_s100 import design_member  # noqa: E402
from design.lap_connection import design_lap_connection  # noqa: E402
from design.loads.required_strength import analyze_loads  # noqa: E402
from design.loads.load_combinations import get_applicable_combos, LOAD_COMBINATION_STANDARDS  # noqa: E402

# III-3 (362S162-54) 단면 성질 — Manual 인쇄값(test_review_1122_member 와 같음). Sf 는 이 시험의 휨용 값.
III3 = dict(A=0.422, rx=1.44, ry=0.605, J=0.000451, Cw=0.457, xo=1.28, ro=2.02, t=0.0566, R=0.0849, Sf=0.5)
III3_SECTION = dict(type='C', depth=3.625, flange_width=1.625, lip_depth=0.5, thickness=0.0566, r=0.0849)
BASE = dict(design_method='LRFD', Fy=50.0, Fu=65.0, section_type='C', props=dict(III3), section=dict(III3_SECTION),
            dsm=dict(Pcrl=15.8, Pcrd=23.4, Mcrl=30.0, Mcrd=30.0))
LOW_D = dict(BASE, dsm=dict(Pcrl=15.8, Pcrd=4.0, Mcrl=30.0, Mcrd=8.0))   # 뒤틀림이 지배하도록 낮춘 Pcrd · Mcrd


def _c(r, cid):
    return [c for c in r['design_checks'] if c['id'] == cid][0]


# ---------------------------------------------------------------- E-1
def test_E1_compression_blank_lengths_give_no_verdict_even_over_one():
    """전에는 Pu = 8 kips 에서 E2 · E3 · 요약 항목이 120 in 가정으로 불합격(비 3.44)이라 전체가 NG 였다."""
    r = design_member(dict(BASE, member_type='compression', Pu=8.0))
    assert r['pass'] is None and r['length_assumed'] is True
    for cid in ('member.compression.global', 'member.compression.local'):
        c = _c(r, cid)
        assert c['verdict'] == 'not_evaluated' and c['reference']['ratio'] > 1.0, cid
        assert 'assumed length' in c['reason']
    item = r['limit_state_checks'][0]
    assert item['pass'] is None and item['reference_only'] is True and item['ratio'] > 3.0
    assert item['reason_code'] == 'member.reason.assumed_length_reference_only' and item['reason_ko']
    # 길이를 주면 같은 비로 판정한다(불합격)
    g = design_member(dict(BASE, member_type='compression', Pu=8.0, KxLx=120, KyLy=120, KtLt=120))
    assert g['pass'] is False and 'length_assumed' not in g


def test_E1_length_independent_mode_still_fails():
    """Pnd(뒤틀림)는 길이와 상관없다 — Pn ≤ Pnd 이므로 Pu > φPnd 면 어느 길이에서나 불합격."""
    r = design_member(dict(LOW_D, member_type='compression', Pu=8.0))
    d = _c(r, 'member.compression.distortional')
    assert d['verdict'] == 'fail' and r['pass'] is False
    assert r['limit_state_checks'][0]['pass'] is False
    assert r['limit_state_checks'][0]['reason_code'] == 'member.reason.fails_on_length_independent_mode'
    f = design_member(dict(LOW_D, member_type='flexure', Mu=12.0))
    assert _c(f, 'member.flexure.distortional')['verdict'] == 'fail' and f['pass'] is False
    ok = design_member(dict(BASE, member_type='flexure', Mu=12.0))       # 비 1.99 지만 F4 는 통과 → 판정 없음
    assert ok['pass'] is None and _c(ok, 'member.flexure.global')['verdict'] == 'not_evaluated'
    assert ok['limit_state_checks'][0]['pass'] is None


def test_E1_h12_from_assumed_lengths_is_not_a_verdict():
    """전에는 H1.2 가 가정 길이의 Pa · Max 로 3.305 → 불합격(0.61 이면 항목 통과)이었다."""
    for Pu, Mux in ((5.0, 5.0), (1.0, 1.0)):
        r = design_member(dict(BASE, member_type='combined', Pu=Pu, Mux=Mux))
        h = _c(r, 'member.axial_bending')
        assert h['verdict'] == 'not_evaluated' and r['pass'] is None, (Pu, h['verdict'])
        assert any(str(x).startswith('H1.2 axial + bending (Pa / Max / B1 from an assumed length')
                   for x in r['not_evaluated'])
        assert r['limit_state_checks'][0]['pass'] is None
    # 길이를 주면 판정(같은 하중 5/5 → 1.266 불합격)
    g = design_member(dict(BASE, member_type='combined', Pu=5.0, Mux=5.0, KxLx=120, KyLy=60, KtLt=60, Lb=60))
    assert _c(g, 'member.axial_bending')['verdict'] == 'fail' and g['pass'] is False


def test_E1_h12_lower_bound_fails_for_any_length():
    """하한 비 = Pu/φPnd + Mux/φMnd (B1 = 1) — 손계산: φ = 0.85 · 0.90, Pnd · Mnd 는 결과의 값."""
    r = design_member(dict(LOW_D, member_type='combined', Pu=3.0, Mux=6.0))
    sub_p = design_member(dict(LOW_D, member_type='compression', Pu=3.0))
    sub_m = design_member(dict(LOW_D, member_type='flexure', Mu=6.0))
    Pnd = sub_p['display_unrounded']['Pnd']
    Mnd = sub_m['display_unrounded']['Mnd']
    bound = 3.0 / (0.85 * Pnd) + 6.0 / (0.90 * Mnd)
    h = _c(r, 'member.axial_bending')
    assert bound > 1.0 and h['verdict'] == 'fail' and abs(h['ratio'] - bound) < 1e-9 and r['pass'] is False
    assert abs(r['interaction_length_bound']['total_unrounded'] - bound) < 1e-9


def test_E1_tension_bending_h11_2_from_assumed_lb():
    """H1.1-1(인장 플랜지 항복)은 길이와 상관없어 판정, H1.1-2 는 가정 Lb 의 Max — 판정 없음."""
    r = design_member(dict(BASE, member_type='combined', Pu=-3.0, Mux=12.0))
    assert _c(r, 'member.tension_bending.flange_yield')['verdict'] == 'pass'
    assert _c(r, 'member.tension_bending.buckling')['verdict'] == 'not_evaluated' and r['pass'] is None
    g = design_member(dict(BASE, member_type='combined', Pu=-3.0, Mux=12.0, Lb=60))
    assert _c(g, 'member.tension_bending.buckling')['verdict'] in ('pass', 'fail')


def test_E1_lap_region_upper_bound_unchanged():
    """랩 구간의 Lb 없음은 Lb = 0 상한(가장 유리한 길이)이라 그 불합격은 진짜 — E-1 의 차단 대상이 아니다."""
    p = dict(member_type='flexure', design_method='ASD', Fy=55, Mu=400.0, section_type='C', lap_region=True,
             moment_sign='-', props=dict(A=0.881, Sf=2.29, ry=0.890, ro=3.90, J=0.00102, Cw=11.9, rx=3.42),
             dsm=dict(Mcrl=84.4))
    r = design_member(p)
    assert 'length_assumed' not in r and _c(r, 'member.flexure.global')['verdict'] == 'fail'


# ---------------------------------------------------------------- E-2
_LAP = dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=12, lap_right_in=12, Mu_support=120.0, Vu_support=4.0,
            fastener_type='bolt', fastener_dia=0.5, n_rows=2, end_distance=2.0, Se=3.0, lap_restrained=True,
            design_method='LRFD')


def test_E2_lap_fastener_group_needs_the_stated_model():
    un = design_lap_connection(dict(_LAP))
    fg = _c(un, 'lap.fastener_group')
    assert fg['verdict'] == 'not_evaluated' and fg['reason_code'] == 'lap.reason.force_model_not_confirmed'
    assert fg['reference']['ratio'] < 1.0 and un['pass'] is None and un['verdict'] == 'NOT_CHECKED'
    assert _c(un, 'lap.fastener_count')['verdict'] == 'not_evaluated'
    assert un['force_model']['confirmed'] is False and un['lap_force_model_confirmed'] is False
    assert any(getattr(w, 'code', None) == 'lap.warning.force_model_not_confirmed' or 'not confirmed' in str(w)
               for w in un['warnings'])
    # 모델 A 의 수는 그대로(참고값): V = 120/(8 − 0.059) kips
    assert abs(un['V_transfer'] - 120.0 / (8.0 - 0.059)) < 1e-12
    ok = design_lap_connection(dict(_LAP, lap_force_model_confirmed=True))
    assert _c(ok, 'lap.fastener_group')['verdict'] == 'pass' and ok['pass'] is True
    assert ok['force_model']['confirmed'] is True
    assert any('lap_force_model_confirmed = true' in str(a) for a in ok['assumptions'])


def test_E2_lap_fails_under_model_A_without_statement():
    """모델 A(가장 유리한 분배)로도 넘으면 확인 없이 불합격 — 그 까닭을 밝힌다. 한 줄에 패스너 하나만 들어가는 랩."""
    over = design_lap_connection(dict(_LAP, lap_left_in=4.5, lap_right_in=4.5, Mu_support=200.0))
    fg = _c(over, 'lap.fastener_group')
    assert fg['verdict'] == 'fail' and over['pass'] is False
    assert fg['reason_code'] == 'lap.reason.fails_under_most_favourable_distribution'


# ---------------------------------------------------------------- E-3
def _gov(st, method, loads):
    r = analyze_loads('roof-purlin', 'simple', 25.0, loads, design_method=method, load_combination_standard=st)
    return r, max(r['gravity']['M_envelope_max']) if r['gravity'] else None, \
        min(r['uplift']['M_envelope_min']) if r['uplift'] else None


def test_E3_default_is_unchanged_and_bad_values_list_the_allowed_ones():
    loads = {'D': 10, 'S': 100, 'W': -100}
    a, _, _ = _gov(None, 'LRFD', loads)
    b = analyze_loads('roof-purlin', 'simple', 25.0, loads, design_method='LRFD')
    assert a == b and a['load_combination_standard']['edition'] == 'ASCE/SEI 7-10'
    assert 'key' not in a['load_combination_standard'] and not any('must be' in str(x) for x in a['assumptions'])
    for bad in ('asce7_16', 'ASCE 7-05', 'xx'):
        try:
            analyze_loads('roof-purlin', 'simple', 25.0, loads, load_combination_standard=bad)
        except ValueError as e:
            assert all(k in str(e) for k in LOAD_COMBINATION_STANDARDS), str(e)
        else:
            raise AssertionError(bad)


def test_E3_one_hand_case_per_standard_and_method():
    """단순보 25 ft, D 10 · S 100 · W −100 plf. M = w L²/8 (kip-ft) = w × 625 / 8000.
    ASCE 7-10: 1.2D+1.6S = 172 · D+S = 110 · 0.9D+1.0W = −91 · 0.6D+0.6W = −54
    ASCE 7-22: 1.2D+1.0S = 112 (Sec. 2.3.1 3a) · D+0.7S = 80 (2.4.1 3a) · 0.9D+1.0W · 0.6D+0.6W (5a · 7a)
    KDS 41 12 00: 1.2D+1.6S = 172 (1.7-3) · D+S = 110 (1.7-10) · 0.9D+1.0W (1.7-6) · 0.6D+0.65W = −59 (1.7-14)"""
    loads = {'D': 10, 'S': 100, 'W': -100}
    want = {('asce7_10', 'LRFD'): (172, -91), ('asce7_10', 'ASD'): (110, -54),
            ('asce7_22', 'LRFD'): (112, -91), ('asce7_22', 'ASD'): (80, -54),
            ('kds_41_12_00', 'LRFD'): (172, -91), ('kds_41_12_00', 'ASD'): (110, -59)}
    for (st, m), (wg, wu) in want.items():
        r, mg, mu = _gov(st, m, loads)
        assert abs(mg - wg * 625 / 8000) < 1e-9 and abs(mu - wu * 625 / 8000) < 1e-9, (st, m, mg, mu)
        assert r['load_combination_standard']['key'] == st
        if st != 'asce7_10':
            assert any('must be' in str(a) for a in r['assumptions']), st
            assert any('changes only the factored combinations' in str(x) for x in r['scope_notes'])


def test_E3_combination_tables():
    """조합표 자체(하중이 모두 있을 때의 계수) — ASCE 7-22 Sec. 2.3.6 / 2.4.5 의 지진, KDS 1.7-13 의 0.75(0.65W)."""
    loads = {'D': 1, 'L': 1, 'Lr': 1, 'S': 1, 'R': 1, 'W': 1, 'E': 1}
    t22 = dict(get_applicable_combos(loads, 'LRFD', 'asce7_22'))
    assert t22['6: 1.2D+1.0E+L+0.15S'] == {'D': 1.2, 'E': 1.0, 'L': 1.0, 'S': 0.15}
    assert t22['2a: 1.2D+1.6L+0.3S'] == {'D': 1.2, 'L': 1.6, 'S': 0.3}
    a22 = dict(get_applicable_combos(loads, 'ASD', 'asce7_22'))
    assert a22['9: D+0.525E+0.75L+0.1S'] == {'D': 1.0, 'E': 0.525, 'L': 0.75, 'S': 0.1}
    assert a22['6a: D+0.75L+0.75(0.6W)+0.525S'] == {'D': 1.0, 'L': 0.75, 'W': 0.45, 'S': 0.525}
    kl = dict(get_applicable_combos(loads, 'LRFD', 'kds_41_12_00'))
    assert kl['1.7-5: 1.2D+1.0E+1.0L+0.2S'] == {'D': 1.2, 'E': 1.0, 'L': 1.0, 'S': 0.2}
    ka = dict(get_applicable_combos(loads, 'ASD', 'kds_41_12_00'))
    assert ka['1.7-13: D+0.75(0.65W)+0.75L+0.75R'] == {'D': 1.0, 'W': 0.4875, 'L': 0.75, 'R': 0.75}
    assert ka['1.7-14: 0.6D+0.65W'] == {'D': 0.6, 'W': 0.65}


# ---------------------------------------------------------------- E-4
def test_E4_ks_d3506_values_match_the_checked_tables():
    """KDS 41 30 30:2022 표 3.2-2(현행 이름)와 JIS G 3302(옛 이름 — 일본제철 카탈로그의 인용)의 값. 바꾸지 않았다."""
    from design.steel_grades import list_grades
    rows = {g['id']: g for g in list_grades(include_restricted=True)}
    for gid, fy, fu in (('SGC340', 245, 340), ('SGC400', 295, 400), ('SGC440', 335, 440), ('SGC490', 365, 490)):
        assert abs(rows[gid]['Fy_MPa'] - fy) < 1e-9 and abs(rows[gid]['Fu_MPa'] - fu) < 1e-9, gid
    assert abs(rows['SGC570']['Fsy_specified'] * 6.894757293168361 - 560) < 0.05
    assert abs(rows['SGC570']['Fu_specified'] * 6.894757293168361 - 570) < 0.05
    assert list_grades()[0]['id'] == 'SGC400'


# ---------------------------------------------------------------- E-5
def test_E5_auto_path_uses_the_design_grid():
    """엔진의 자동 경로(_auto_generate_props)가 design_signature_lengths 의 격자(101 점, 0.05 D – 100 D)로 푼다."""
    import engine.helpers as helpers
    from design.aisi_s100 import _auto_generate_props
    seen = []
    real = helpers.design_signature_lengths

    def spy(node, elem=None):
        out = real(node, elem)
        seen.append(out)
        return out
    helpers.design_signature_lengths = spy
    try:
        p = _auto_generate_props(dict(section_type='lippedz', H=8.0, B=2.25, D=0.91, t=0.105, r=0.0, Fy=55.0))
    finally:
        helpers.design_signature_lengths = real
    assert len(seen) == 1 and len(seen[0]['lengths']) == 101
    assert abs(seen[0]['lengths'][0] - 0.05 * seen[0]['D']) < 1e-12 and abs(seen[0]['D'] - (8.0 - 0.105)) < 0.2
    assert p['dsm']['Mcrl'] > 0 and p['dsm']['Pcrl'] > 0


# ---------------------------------------------------------------- E-1 후속: 요약 키의 판정
def test_E1_summary_interaction_pass_follows_the_same_rule():
    """조합 결과의 요약 interaction.pass 도 검토 항목과 같은 규칙 — 가정 길이면 None, 길이와 상관없는 하한이 넘을 때만
    False. 비(total 등)는 참고값으로 남는다. 계산서 글은 판정을 쓰지 않는다."""
    r = design_member(dict(BASE, member_type='combined', Pu=5.0, Mux=5.0))
    assert r['interaction']['pass'] is None and r['interaction']['length_assumed'] is True
    assert r['interaction']['total'] > 1.0                                   # 참고값(3.305)
    assert 'reference only — not evaluated' in r['report'] and 'Total   = 3.3050 > 1.0' not in r['report']
    f = design_member(dict(LOW_D, member_type='combined', Pu=3.0, Mux=6.0))
    assert f['interaction']['pass'] is False
    t = design_member(dict(BASE, member_type='combined', Pu=-3.0, Mux=12.0))
    assert t['interaction']['pass'] is None and t['interaction']['eq_H1_1_2_length_assumed'] is True
    g = design_member(dict(BASE, member_type='combined', Pu=5.0, Mux=5.0, KxLx=120, KyLy=60, KtLt=60, Lb=60))
    assert g['interaction']['pass'] is False and 'length_assumed' not in g['interaction']


# ---------------------------------------------------------------- display_unrounded 의 하위 묶음
def _check_unrounded(o, top_du=None, path=''):
    """display_unrounded(제 자리 또는 맨 위의 같은 이름 묶음)의 값마다 옆의 표시 값과 반올림 차이만큼만 다르다."""
    n = 0
    if isinstance(o, list):
        for i, x in enumerate(o):
            n += _check_unrounded(x, None, f'{path}[{i}]')
        return n
    if not isinstance(o, dict):
        return 0
    du = dict(top_du or {})
    du.update(o.get('display_unrounded') or {})
    for k, v in du.items():
        if isinstance(v, dict):
            continue
        shown = o.get(k)
        assert isinstance(shown, (int, float)) and not isinstance(shown, bool), (path, k, shown)
        assert abs(v - shown) <= 0.051 + 1e-9 * abs(v), (path, k, v, shown)
        n += 1
    for k, x in o.items():
        if k in ('display_unrounded', 'unrounded', 'design_checks', 'notices'):
            continue
        n += _check_unrounded(x, du.get(k) if isinstance(du.get(k), dict) else None, f'{path}.{k}')
    return n


def test_display_unrounded_nested_groups_mirror_the_shown_values():
    """하위 묶음의 반올림 전 값: 부재 설계는 맨 위 display_unrounded 의 같은 이름 묶음(display_unrounded.shear.Vn …),
    목록의 기록(접합 limit_states[] · 하중 locations[] …)과 따로 부르는 도구의 결과는 제 자리의 display_unrounded."""
    import contract_cases_1123 as cases
    seen = set()
    total = 0
    for name, method, params in cases.all_cases():
        r = cases.run_case(method, params)
        total += _check_unrounded(r)
        du = r.get('display_unrounded') or {}
        for g in ('shear', 'positive_region', 'web_crippling', 'shear_interaction', 'Fcre_detail', 'amplification'):
            if g in du:
                seen.add(f'{method}.{g}')
        if any('display_unrounded' in x for x in r.get('limit_states') or []):
            seen.add(f'{method}.limit_states')
        if method == 'lap_connection' and 'Pns' in du:
            seen.add('lap.Pns')
        loc = ((r.get('gravity') or {}).get('locations') or [{}])[0]
        if 'Mu' in (loc.get('display_unrounded') or {}):
            seen.add('loads.locations')
    want = {'aisi_design.shear', 'aisi_design.positive_region', 'aisi_design.web_crippling',
            'aisi_design.shear_interaction', 'aisi_design.Fcre_detail', 'aisi_design.amplification',
            'design_connection.limit_states', 'lap.Pns', 'loads.locations'}
    assert want <= seen, want - seen
    assert total > 1000


# ---------------------------------------------------------------- 검토 2차(R2-1 … R2-6)
def _dsm_local(Pne, Pcrl):
    lam = math.sqrt(Pne / Pcrl)
    if lam <= 0.776:
        return Pne
    r = (Pcrl / Pne) ** 0.4
    return (1 - 0.15 * r) * r * Pne


def test_R2_1_local_bound_at_pne_py_fails_for_any_length():
    """Pcrl 2.0, Pcrd 40, Pu 9, 길이 빈 칸: Pnℓ(Pne = Py = 21.1) = 7.741, φ 6.580 < 9 → 어느 길이에서나 불합격.
    요약 항목의 ratio 는 그 상한의 비(9 / 6.580 = 1.368), 가정 길이의 비는 reference 아래."""
    Py = 0.422 * 50.0
    pnl = _dsm_local(Py, 2.0)
    r = design_member(dict(BASE, member_type='compression', Pu=9.0, dsm=dict(Pcrl=2.0, Pcrd=40.0)))
    assert r['pass'] is False
    loc = _c(r, 'member.compression.local')
    assert loc['verdict'] == 'fail' and abs(loc['ratio'] - 9.0 / (0.85 * pnl)) < 1e-9
    item = r['limit_state_checks'][0]
    assert item['pass'] is False and abs(item['ratio'] - round(9.0 / (0.85 * pnl), 4)) < 1e-12
    assert item['reference']['ratio'] > 3.0 and 'local buckling at Pne = Py' in item['reason']
    b = r['length_independent_bound']
    assert abs(b['Pn'] - pnl) < 1e-9 and b['governing_check'] == 'member.compression.local'
    a = design_member(dict(BASE, member_type='compression', Pu=6.0, design_method='ASD',
                           dsm=dict(Pcrl=2.0, Pcrd=40.0)))
    assert a['pass'] is False and abs(_c(a, 'member.compression.local')['ratio'] - 6.0 / (pnl / 1.80)) < 1e-9


def test_R2_1_flexure_local_and_yield_bounds():
    """Mcrl 4, Mcrd 60, Mu 15: φMnℓ(Mne = My = 25) = 0.9 × 11.146 = 10.03 < 15 → 불합격.
    Mcrd 없음 · F4 해당 없음, Mu 30 > φMy = 22.5 → 불합격(전에는 None)."""
    My = 0.5 * 50.0
    mnl = _dsm_local(My, 4.0)
    r = design_member(dict(BASE, member_type='flexure', Mu=15.0, dsm=dict(Mcrl=4.0, Mcrd=60.0)))
    assert r['pass'] is False and abs(_c(r, 'member.flexure.local')['ratio'] - 15.0 / (0.9 * mnl)) < 1e-9
    for extra in ({}, {'distortional_not_applicable': True}):
        f = design_member(dict(BASE, member_type='flexure', Mu=30.0, dsm=dict(Mcrl=60.0, Mcrd=0.0), **extra))
        assert f['pass'] is False and _c(f, 'member.flexure.global')['verdict'] == 'fail', extra
        yld = round(30.0 / (0.9 * My), 4)
        if extra:
            assert abs(f['limit_state_checks'][0]['ratio'] - yld) < 1e-12
        else:   # Mcrd 0 → 부록 2 해석식 Mnd 가 상한을 더 낮춘다(min 이 지배)
            assert f['limit_state_checks'][0]['ratio'] >= yld


def test_R2_1_yield_bound_without_distortional_and_unavailable_e2():
    """Pcrd 없음(또는 해당 없음 · E2 를 못 구한 hat)에서도 Pu > φPy = 0.85 × 21.1 = 17.935 이면 불합격."""
    for st, extra in (('C', {}), ('C', {'distortional_not_applicable': True}), ('hat', {})):
        p = dict(design_method='LRFD', Fy=50.0, section_type=st, props=dict(III3), member_type='compression',
                 Pu=25.0, dsm=dict(Pcrl=15.8, Pcrd=0.0), **extra)
        r = design_member(p)
        g = _c(r, 'member.compression.global')
        assert r['pass'] is False and g['verdict'] == 'fail' and abs(g['ratio'] - 25.0 / (0.85 * 0.422 * 50)) < 1e-9


def test_R2_1_h12_uses_the_same_bounds():
    """조합: Pu 8 > φPnℓ(Py) 6.580 이면 H1.2 하한도 넘는다(Pa ≤ 그 값)."""
    r = design_member(dict(BASE, member_type='combined', Pu=8.0, Mux=2.0,
                           dsm=dict(Pcrl=2.0, Pcrd=40.0, Mcrl=60, Mcrd=60)))
    pnl = _dsm_local(0.422 * 50.0, 2.0)
    assert r['pass'] is False and _c(r, 'member.axial_bending')['verdict'] == 'fail'
    assert abs(r['interaction_length_bound']['Pa_upper'] - 0.85 * pnl) < 1e-9


def test_R2_2_unused_assumed_strength_does_not_block():
    """KL 전부 줌, Mux = 0, Muy 만, Lb 빈 칸: Max 는 H1.2 에 들지 않는다 — 판정(0.396 통과). 인장 조합도 같다."""
    p = dict(BASE, member_type='combined', KxLx=60, KyLy=60, KtLt=60, Mux=0.0, Muy=0.5, May_strength=5.0)
    r = design_member(dict(p, Pu=2.0))
    h = _c(r, 'member.axial_bending')
    assert h['verdict'] == 'pass' and abs(h['ratio'] - 0.3965) < 1e-4 and r['pass'] is True
    t = design_member(dict(p, Pu=-2.0))
    assert _c(t, 'member.tension_bending.buckling')['verdict'] == 'pass' and t['pass'] is True


def test_R2_3_lap_count_never_passes_without_the_statement():
    p = dict(_LAP, fastener_type='screw', fastener_dia=0.19)
    for conf in (False, True):
        r = design_lap_connection(dict(p, lap_force_model_confirmed=conf))
        assert _c(r, 'lap.fastener_count')['verdict'] == 'not_evaluated', conf   # 나사 Pns 가정값 · 진술 없음


def test_R2_4_null_lengths_mean_blank():
    r = design_member(dict(BASE, member_type='flexure', Mu=5.0, Lb=None))
    assert 'error' not in r and r['length_assumed'] is True and r['pass'] is None
    c = design_member(dict(BASE, member_type='combined', Pu=1.0, Mux=1.0, KxLx=None, KyLy=None, KtLt=None, Lb=None))
    assert 'error' not in c and c['pass'] is None


def test_R2_5_seismic_single_effect_is_stated():
    for st in LOAD_COMBINATION_STANDARDS:
        r = analyze_loads('floor-joist', 'simple', 20.0, {'D': 10, 'L': 40, 'E': 5}, load_combination_standard=st)
        notes = [n for n in r['scope_notes'] if getattr(n, 'code', None) == 'loads.scope.seismic_single_effect']
        assert len(notes) == 1, st
    r = analyze_loads('floor-joist', 'simple', 20.0, {'D': 10, 'L': 40, 'E': 5}, load_combination_standard='asce7_22')
    assert '0.9D − Ev + Eh' in str(r['scope_notes'][-2]) or any('0.9D − Ev + Eh' in str(n) for n in r['scope_notes'])
    assert not any(getattr(n, 'code', None) == 'loads.scope.seismic_single_effect'
                   for n in analyze_loads('floor-joist', 'simple', 20.0, {'D': 10, 'L': 40})['scope_notes'])


def test_R2_6_lap_without_verdict_marks_utilization_invalid():
    un = design_lap_connection(dict(_LAP))
    assert un['pass'] is None and un['utilization_valid'] is False
    ok = design_lap_connection(dict(_LAP, lap_force_model_confirmed=True))
    assert ok['pass'] is True and 'utilization_valid' not in ok
