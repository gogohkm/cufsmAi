"""2026-11-28 경간마다 다른 단면 — 기준(baseline) 경우들. test_review_1128_span_sections.py 가 쓴다.

여기의 경우는 엔진을 고치기 전에 돌려 그 결과를 span_sections_1128_baseline.json 에 담았다(새 입력이 없을 때 결과가
옛 결과와 같은지 보려고). 경우를 바꾸면 기준도 다시 만들어야 한다 — 바꾸지 말 것.
"""

import json

# 9CS2.5x070 / 9CS2.5x059 (Design Manual Example II-1A 의 표 · Table I-1 의 립 d, 이 세션에서 연 글). Fu 70 은 시험 입력
SEC_C070 = {'type': 'C', 'depth': 9.0, 'flange_width': 2.5, 'thickness': 0.070, 'lip_depth': 0.800,
            'R_corner': 0.1875, 'Ixx': 12.2, 'Fy': 55.0, 'Fu': 70.0}
SEC_C059 = {'type': 'C', 'depth': 9.0, 'flange_width': 2.5, 'thickness': 0.059, 'lip_depth': 0.773,
            'R_corner': 0.1875, 'Ixx': 10.3, 'Fy': 55.0, 'Fu': 70.0}
# 8ZS2.25x070 / 8ZS2.25x059 (Example II-2A 의 표 · Table I-4 의 립 d)
SEC_Z070 = {'type': 'Z', 'depth': 8.0, 'flange_width': 2.25, 'thickness': 0.070, 'lip_depth': 0.930,
            'R_corner': 0.1875, 'Ixx': 9.18, 'Fy': 55.0, 'Fu': 70.0}
SEC_Z059 = {'type': 'Z', 'depth': 8.0, 'flange_width': 2.25, 'thickness': 0.059, 'lip_depth': 0.91,
            'R_corner': 0.1875, 'Ixx': 7.76, 'Fy': 55.0, 'Fu': 70.0}

DECK_TF = {'type': 'through-fastened', 't_panel': 0.019, 'fastener_spacing': 12,
           'i621_conditions_confirmed': True}

LAPS_II1A = [None, {'left_ft': 2.0, 'right_ft': 2.75}, {'left_ft': 1.25, 'right_ft': 1.25},
             {'left_ft': 2.75, 'right_ft': 2.0}, None]


def load_cases():
    """(이름, analyze_loads 키워드 인자) — section 하나(오늘의 입력)."""
    return [
        ('cont4_lap_tf_lrfd', dict(
            member_app='roof-purlin', span_type='cont-4', span_ft=25.0,
            loads={'D': 15, 'Lr': 90, 'W': -144}, design_method='LRFD',
            laps_per_support=LAPS_II1A, deck=dict(DECK_TF), section=dict(SEC_C070))),
        ('cont4_lap_tf_z_asd_L', dict(
            member_app='roof-purlin', span_type='cont-4', span_ft=25.0,
            loads={'D': 15, 'L': 60, 'W': -170}, design_method='ASD',
            laps={'left_ft': 2.5, 'right_ft': 3.0}, deck=dict(DECK_TF, insulation_in=2.0),
            section=dict(SEC_Z070))),
        ('cont3_ss_brace', dict(
            member_app='roof-purlin', span_type='cont-3', span_ft=22.0,
            loads={'D': 10, 'S': 80, 'W': -100}, design_method='LRFD',
            laps={'left_ft': 2.0, 'right_ft': 2.0},
            deck={'type': 'standing-seam', 'R_tested_uplift': 0.55}, brace_points_ft=[11.0, 33.0, 55.0],
            section=dict(SEC_Z059))),
        ('overhang_nodeck', dict(
            member_app='roof-purlin', span_type='cont-n', span_ft=20.0, spans_ft=[3.0, 20.0, 22.0, 3.0],
            supports=['N', 'P', 'P', 'P', 'N'], loads={'D': 12, 'Lr': 60, 'Wp': 40}, design_method='LRFD',
            laps={'left_ft': 1.5, 'right_ft': 1.5}, section=dict(SEC_C059))),
        ('simple_tf', dict(
            member_app='roof-purlin', span_type='simple', span_ft=24.0,
            loads={'D': 15, 'Lr': 90, 'W': -144}, design_method='LRFD',
            deck=dict(DECK_TF, insulation_in=1.0), section=dict(SEC_C059))),
        ('cont4_Ispan_given', dict(
            member_app='roof-purlin', span_type='cont-4', span_ft=25.0,
            loads={'D': 15, 'Lr': 90, 'W': -144}, design_method='LRFD',
            laps_per_support=LAPS_II1A, deck=dict(DECK_TF),
            section=dict(SEC_C059), I_span_in4=[12.2, 10.3, 10.3, 12.2])),
    ]


LAP_BASE = dict(d=9.0, t=0.059, Fy=55.0, Fu=70.0, lap_left_in=24.0, lap_right_in=33.0,
                Mu_support=144.0, Vu_support=2.5, fastener_type='screw', fastener_dia=0.19,
                Pnvs=1.2, n_rows=2, end_distance=0.5, design_method='LRFD')


def lap_cases():
    return [
        ('lap_screw_se', dict(LAP_BASE, Se=1.89, Mnd=95.0)),
        ('lap_screw_restrained', dict(LAP_BASE, Se=1.89, lap_restrained=True, lap_force_model_confirmed=True)),
        ('lap_bolt', dict(LAP_BASE, fastener_type='bolt', fastener_dia=0.5, end_distance=1.0, Se=1.89,
                          lap_restrained=True, bolt_grade='A307')),
        ('lap_sf_only', dict(LAP_BASE, Sf=2.29)),
    ]


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, default=str, ensure_ascii=False)
