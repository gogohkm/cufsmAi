"""통합 소요강도 계산 — analyze_loads 메인 엔트리포인트

사용자 입력(부재구성, 하중, 데크) → 구조해석 → 하중조합 → 소요강도 추출

해석은 경간별 단위하중(1 kip/ft)의 응답을 한 번씩 구하고 중첩한다. 그래서 같은
하중이 경간마다 다르게 실리는 부분재하(ASCE 7 Sec. 4.3.3, 7.5)를 해석 한 번에
다룰 수 있다. 결과는 조합 하나의 다이어그램이 아니라 위치별 포락선(정·부 최대 M,
V, 지점 반력)이고, 위치마다 지배 조합과 재하 패턴을 함께 낸다.
"""

import json

import numpy as np

from design.loads.load_combinations import (
    find_controlling_combo, get_applicable_combos, normalize_design_method,
    snow_partial_cases, LOAD_COMBINATION_EDITION, LOAD_COMBINATION_REFERENCE,
    PATTERNED_LIVE_LOADS, PATTERNED_SNOW_LOADS,
    normalize_load_combination_standard, STANDARD_TABLES, LOAD_COMBINATION_STANDARDS,
)
from design.loads.beam_analysis import (
    analyze_simple_beam, analyze_continuous_beam_general, analyze_beam_fe,
    extract_critical_locations, extract_critical_locations_envelope,
    extract_max_deflection_per_span, support_statics, check_support_stability,
    BeamResult,
)
from design.loads.bracing import (
    calc_rotational_stiffness, lateral_stiffness_detail,
    determine_unbraced_lengths, check_i621_conditions,
    span_geometry, tag_region_spans, interval_spans, lap_region_members,
)
from design.notices import N as _nt, attach as _attach_notices, joined as _joined  # noqa: E402

E_STEEL = 29500.0  # ksi — CFS 표준 탄성계수 (기본값)

MEMBER_APPS = ('roof-purlin', 'floor-joist', 'wall-girt', 'wall-stud')
# 벽 부재: 웹 평면(강축)의 하중은 풍하중뿐이다. 외장재 자중 D 는 약축(거트) 또는
# 축방향(스터드)이므로 강축 휨에 더하지 않는다.
WALL_APPS = ('wall-girt', 'wall-stud')
DECK_TYPES = ('through-fastened', 'standing-seam', 'none')

NOT_EVALUATED_ALWAYS = [
    _nt('loads.scope.i6_4_1_s100_i6_anchorage_bracing'),
    _nt('loads.scope.deflection_limits_checked_deflections'),
]


def analyze_loads(
    member_app: str,
    span_type: str,
    span_ft: float,
    loads: dict,
    design_method: str = 'LRFD',
    spacing_ft: float = 5.0,
    laps: dict = None,
    deck: dict = None,
    section: dict = None,
    supports: list = None,
    spans_ft: list = None,
    laps_per_support: list = None,
    E: float = None,
    pattern_loading: bool = True,
    brace_points_ft: list = None,
    i621_conditions_confirmed: bool = None,
    insulation_in: float = None,
    lr_reduced: bool = False,
    I_span_in4: list = None,
    load_combination_standard: str = None,
    span_sections: list = None,
) -> dict:
    """통합 하중 분석

    Parameters
    ----------
    member_app : 'roof-purlin', 'floor-joist', 'wall-girt', 'wall-stud'
    span_type : 'simple', 'cantilever', 'cont-2' … 'cont-<n>', 'cont-n' (cont-n 은 spans_ft 필수)
    span_ft : 스팬 길이 (ft) — spans_ft 가 없을 때 모든 경간
    loads : dict — {'D', 'L', 'Lr', 'S', 'R', 'E', 'W'(부압/양력 −), 'Wp'(정압 +)} plf
            (부재 자중은 D 에 포함해야 한다 — 자동으로 더하지 않는다)
    design_method : 'ASD' or 'LRFD' (그 밖의 값은 ValueError)
    spacing_ft : 부재 간격 (ft) — PSF→PLF 변환은 호출자가 수행 (여기서는 쓰지 않음)
    laps : dict — {'left_ft', 'right_ft'}: laps_per_support 가 없으면 모든 내부 지점에 적용
    laps_per_support : 지점별 [{left_ft, right_ft} | None] (지점 수만큼).
            left_ft = 지점 중심에서 왼쪽 랩 끝까지, right_ft = 오른쪽 랩 끝까지.
    deck : dict — {'type': through-fastened|standing-seam|none, 't_panel', 'fastener_spacing',
            'kphi_override', 'kx_override', 'Fss_kip', 'D_screw_in', 'Fu_panel_ksi',
            'i621_conditions_confirmed', 'insulation_in', 'R_tested_uplift', 'R_tested_gravity',
            'brace_points_ft'}
    section : dict — 단면 정보 (I6.2.1 검증, 데크 강성, 처짐), section['E'] 가 있으면 탄성계수
    supports : 지점 조건 P/R/F/N (지점 수 = 경간 수 + 1). cantilever 기본 ['F','N']
    spans_ft : 경간별 길이 (ft) — 길이가 경간 수와 다르면 ValueError
    E : float — 탄성계수 (ksi), 지정 시 section['E']보다 우선. 미지정 시 29500.0 사용
    pattern_loading : True(기본)면 연속보에서 L 의 경간별 부분재하(Sec. 4.3.3), S 의 Sec. 7.5.1
            부분재하, 그리고 lr_reduced 일 때 Lr 의 부분재하(Sec. 4.3.3.1)를 포락한다
    lr_reduced : Lr 이 Sec. 4.8.2 로 20 psf 미만으로 감소된 값이면 True. ASCE 7-22 Sec. 4.3.3.1 은
            그 경우에만 지붕 활하중의 인접·교번 경간 재하를 요구한다. 기본 False (Lr 전 경간 재하)
    I_span_in4 : 경간별 부재 Ix (in^4, 경간 수만큼). 주면 랩 구간 Ix = 양쪽 부재 Ix 의 합
            (설계매뉴얼 II-1A/II-2A 가정 b). section['I_span_in4'] 로도 줄 수 있다
    brace_points_ft : 이산 브레이스 위치 (ft). deck['brace_points_ft'] 로도 줄 수 있다
    i621_conditions_confirmed : I6.2.1 (i)–(n) 사용자 확인 (deck 안의 같은 키로도 줄 수 있다)
    insulation_in : 단열재 두께 (in.), 단순보 R 보정 (deck 안으로도 가능)
    load_combination_standard : 하중조합 기준 'asce7_10'(처음 값 — 지금까지의 결과 그대로) · 'asce7_22' ·
            'kds_41_12_00'. 그 밖의 값은 허용값을 밝히는 ValueError. 넣은 하중이 그 기준의 하중 정의를 따른다고 본다
            (엔진은 바꾸지 않는다 — assumptions 에 밝힌다). 처짐(비계수) · 부분재하 규칙은 바꾸지 않는다
    span_sections : 경간마다의 단면(2026-11-28) — 경간 수만큼의 dict, 각각 section 과 같은 꼴(type, depth,
            flange_width, thickness, lip_depth, R_corner, Ixx, Fy, Fu …)에 호출자가 정한 'id'(예: 'S1'; 없으면 같은
            단면끼리 'S1', 'S2' … 를 붙인다). 주면:
              - 경간별 Ix = 그 경간 단면의 Ixx (I_span_in4 를 따로 주면 그 값을 쓰고, 단면의 Ixx 와 1 % 넘게 다른
                경간마다 경고 — 결정 S6). 모든 단면의 Ixx 가 같으면 Ix 하나(오늘과 같은 길).
              - §I6.2.1 조건과 양력 R 을 경간마다 그 단면으로(결정 S7) — auto_params.i621_by_span, uplift_R_by_span.
              - 데크 kφ · kx 는 한 번(결정 S7′ — 쓰이는 단면 가운데 kφ 가 가장 작은 단면, 설계 매뉴얼 II-1C 의 안전측 근사):
                auto_params.deck 가 그 값, auto_params.deck_basis {rule, section_id, by_section(단면마다 — 참고)}.
              - 구간 기록마다 span · spans(0 부터), 랩 구간은 두 부재 · 강성 몫(참고 — 판정은 두 부재 강도의 합, 결정 S3′).
              - section 을 주지 않으면 section = span_sections[0] (옛 단일 키 — deck, i621_check, deflection.Ixx — 의 단면).
            없으면 결과는 오늘과 바이트까지 같다. 모든 경간에 같은 단면이면 옛 키의 값은 section 하나와 같다.

    Returns
    -------
    dict with:
        governing, gravity, uplift, deflection, deflection_cases, auto_params, wc_reactions,
        uplift_reactions, all_combos, all_combos_detail, pattern_loading,
        load_combination_standard, warnings, assumptions, not_evaluated, ...
    """
    warnings = []
    assumptions = []
    not_evaluated = list(NOT_EVALUATED_ALWAYS)
    # FIXES §3.1.1: warnings = 이 실행에서 값·판정을 바꿨거나 사용자가 손볼 것,
    # assumptions = 이 실행이 가정한 것, scope_notes = 입력과 무관하게 늘 참인 범위 안내.
    scope_notes = list(NOT_EVALUATED_ALWAYS)

    method = normalize_design_method(design_method)
    combo_std = normalize_load_combination_standard(load_combination_standard)
    std_table = STANDARD_TABLES[combo_std]
    if member_app not in MEMBER_APPS:
        raise ValueError(f'Unknown member_app {member_app!r}: use one of {MEMBER_APPS}.')

    n_spans, spans, sup = _resolve_geometry(span_type, span_ft, spans_ft, supports)
    laps_ps = _resolve_laps(laps, laps_per_support, n_spans, sup, warnings)
    # 경간마다의 단면(2026-11-28). 옛 단일 키는 section(없으면 첫 경간의 단면)으로 낸다.
    span_secs = _resolve_span_sections(span_sections, n_spans, section)
    secs_differ = bool(span_secs) and any(not _same_section(s, span_secs[0]) for s in span_secs[1:])
    if span_secs is not None and not section:
        section = {k: v for k, v in span_secs[0].items() if k != 'id'}
    has_laps = n_spans > 1 and any(lp for lp in laps_ps)
    if has_laps and laps_per_support is None:
        assumptions.append(_nt('loads.assumption.lap_lengths_given_as'))

    deck = dict(deck or {})
    deck_type = deck.get('type') or 'none'
    if deck_type not in DECK_TYPES:
        raise ValueError(f'Unknown deck type {deck_type!r}: use one of {DECK_TYPES}.')
    if brace_points_ft is None:
        brace_points_ft = deck.get('brace_points_ft')
    if i621_conditions_confirmed is None:
        i621_conditions_confirmed = deck.get('i621_conditions_confirmed')
    if insulation_in is None:
        insulation_in = deck.get('insulation_in')

    # ── 하중 (강축 = 웹 평면) ──
    loads_in = {k: (float(v) if v is not None else 0.0) for k, v in (loads or {}).items()}
    Wp_plf = loads_in.pop('Wp', 0.0)
    if Wp_plf < 0:
        warnings.append(_nt('loads.warning.wp_wind_pressure_must'))
        Wp_plf = 0.0
    strong = dict(loads_in)
    if member_app in WALL_APPS:
        dropped = [k for k in ('D', 'L', 'Lr', 'S', 'R') if strong.get(k)]
        for k in dropped:
            strong[k] = 0.0
        if dropped:
            warnings.append(
                _nt('loads.warning.act_out_plane_web', member_app=member_app, dropped=", ".join(dropped)))
            not_evaluated.append(_nt('loads.ne.weak_axis_bending_axial', member_app=member_app, dropped=", ".join(dropped)))
    present = {k: v for k, v in strong.items() if v}

    # ── 단위하중 응답 (경간별 1 kip/ft) ──
    Ixx = None
    if section:
        Ixx = section.get('Ixx') or section.get('Ix') or None
    if I_span_in4 is None and section:
        I_span_in4 = section.get('I_span_in4')
    I_span_given = I_span_in4 is not None
    sec_I = None
    if span_secs is not None:
        sec_I = [_sec_ixx(s) for s in span_secs]
        if not I_span_given and any(v is not None for v in sec_I):
            if any(v is None for v in sec_I):
                raise ValueError('span_sections: give Ixx for every span section (or I_span_in4), not for some only.')
            if max(sec_I) - min(sec_I) > 1e-12 * max(sec_I):
                I_span_in4 = list(sec_I)     # 경간마다 그 단면의 Ix (결정 S6). 모두 같으면 Ix 하나 — 오늘의 길
            if Ixx is None:
                Ixx = sec_I[0]
    if I_span_in4 is not None:
        I_span_in4 = [float(v) for v in I_span_in4]
        if len(I_span_in4) != n_spans or min(I_span_in4) <= 0:
            raise ValueError(f'I_span_in4 needs {n_spans} positive values (one per span).')
        if I_span_given and sec_I is not None:
            # 결정 S6: 사람이 넣은 경간별 Ix 를 쓰되, 그 경간 단면의 Ixx 와 1 % 넘게 다르면 알린다
            for i, (vg, vs) in enumerate(zip(I_span_in4, sec_I)):
                if vs and abs(vg - vs) > 0.01 * abs(vs):
                    warnings.append(_nt('loads.warning.span_ix_differs_from_section', span=i + 1,
                                        I_given=vg, section_id=span_secs[i]['id'], I_section=vs,
                                        pct=100.0 * (vg - vs) / vs))
        if Ixx is None:
            Ixx = min(I_span_in4)
        assumptions.append(_nt('loads.assumption.per_span_member_ix'))
    elif n_spans > 1:
        assumptions.append(_nt('loads.assumption.one_ix_every_span'))
    E_fe = E or (section.get('E') if section else None) or E_STEEL
    varying_I = I_span_in4 is not None and max(I_span_in4) - min(I_span_in4) > 1e-12 * max(I_span_in4)
    use_fe = has_laps or varying_I or any(s in ('F', 'N') for s in sup[1:-1])
    npts = 101 if n_spans == 1 else 51
    units = _unit_responses(spans, sup, laps_ps if has_laps else None, Ixx, E_fe, use_fe, npts,
                            I_span_in4=I_span_in4)
    if has_laps and not Ixx:
        assumptions.append(_nt('loads.assumption.section_ixx_given_lap'))

    # ── 하중조합 · 부분재하 ──
    patterned, pattern_why = _pattern_keys(bool(lr_reduced), present, n_spans, bool(pattern_loading))
    snow_cases = snow_partial_cases(n_spans) if 'S' in patterned else [(_nt('loads.label.snow_balanced'), [1.0] * n_spans)]
    pattern_on = patterned  # 부분재하할 하중 키 집합 (아래 함수들은 이 집합으로 하중별 방식을 정한다)
    variants = _build_variants(present, Wp_plf, method, combo_std)
    for var in variants:
        var['env'] = _variant_envelope(var, units, pattern_on, snow_cases)

    grav_vars = [v for v in variants if not v['is_uplift']]
    up_vars = [v for v in variants if v['is_uplift']]

    depth = section.get('depth') if section else None
    if secs_differ:
        # 끝 지점의 내민 판정(EOF/IOF)에 지점마다 그 양쪽 부재 깊이의 큰 값(1.5 d 를 넘기 어렵게 — 보수측)
        dl = [s.get('depth') for s in span_secs]
        if len(set(dl)) > 1:
            depth = [max([v for v in (dl[j - 1] if j > 0 else None, dl[j] if j < n_spans else None) if v] or [0])
                     or None for j in range(n_spans + 1)]
        else:
            depth = dl[0]
    gravity_result = _class_result(grav_vars, units, spans, sup, laps_ps, 'gravity', depth,
                                   pattern_on, snow_cases)
    uplift_result = _class_result(up_vars, units, spans, sup, laps_ps, 'uplift', depth,
                                  pattern_on, snow_cases)
    governing_result = _class_result(variants, units, spans, sup, laps_ps, 'overall', depth,
                                     pattern_on, snow_cases)

    # ── 데크 강성 ──
    deck_basis = None
    if span_secs is None:
        deck_info = _calc_deck_info(deck, section, E=E)
    else:
        # 결정 S7′(2026-11-28 오후): 데크 강성은 한 번 계산해 모든 경간에 — 쓰이는 단면 가운데 kφ 가 가장 작은 단면의 값
        # (설계 매뉴얼 II-1C: 얇은 퍼린으로 한 번, 「안전측의 근사」). 데크의 모든 값이 그 한 단면에서. 단면마다의 값은 참고
        deck_info, deck_basis = _deck_once(deck, span_secs, E)
    warnings.extend(deck_info.get('warnings', []))
    assumptions.extend(deck_info.get('assumptions', []))
    scope_notes.extend(deck_info.get('scope_notes', []))

    # ── 비지지 영역 ──
    auto_params = {'deck': deck_info}
    geo = None
    I_used = None
    if span_secs is not None:
        auto_params['deck_basis'] = deck_basis
        if secs_differ and deck_type != 'none':
            assumptions.append(_nt('loads.assumption.deck_once_smallest_kphi', section_id=deck_basis['section_id'],
                                   kphi=float((deck_info.get('display_unrounded') or {}).get('kphi', deck_info['kphi']))))
        geo = span_geometry(spans, laps_ps if has_laps else None, sup)
        I_used = list(I_span_in4) if I_span_in4 is not None else list(sec_I)
    x_list = units['x'].tolist()
    ub = None
    if gravity_result:
        ub = determine_unbraced_lengths(
            gravity_result['M_envelope_max'], x_list, spans, None,
            laps_per_support=laps_ps, deck_type=deck_type,
            M_min_diagram=gravity_result['M_envelope_min'], supports=sup,
            brace_points_ft=brace_points_ft, envelope_members=_members(grav_vars))
        if geo is not None:
            tag_region_spans(ub, geo)
            for r in ub['lap_regions']:
                _lap_member_sections(r, span_secs, I_used)
        auto_params['unbraced'] = ub
        assumptions.extend(a for a in ub['assumptions'] if a not in assumptions)
        auto_params['positive_region'] = _positive_gov(ub, deck_type, deck_info)
        neg = ub['negative_regions']
        auto_params['negative_regions'] = neg
        gov = _negative_gov(neg, ub, sup, spans)
        auto_params['negative_region_gov'] = gov
        auto_params['negative_region'] = gov
        auto_params['lap_regions'] = ub['lap_regions']

    if uplift_result:
        ubu = determine_unbraced_lengths(
            uplift_result['M_envelope_max'], x_list, spans, None,
            laps_per_support=laps_ps, deck_type=deck_type,
            M_min_diagram=uplift_result['M_envelope_min'], supports=sup,
            brace_points_ft=brace_points_ft, envelope_members=_members(up_vars))
        for r in ubu['negative_regions']:
            r['i621_region_eligible'] = (not r['cantilever']
                                         and not r.get('zone_contains_interior_support'))
        if geo is not None:
            tag_region_spans(ubu, geo)
            for r in ubu['lap_regions']:
                _lap_member_sections(r, span_secs, I_used)
        uneg = ubu['negative_regions']
        ugov = _negative_gov(uneg, ubu, sup, spans)
        auto_params['uplift_bracing'] = {
            'positive_region': _positive_gov(ubu, deck_type, deck_info),
            'negative_regions': uneg,
            'negative_region': ugov,
            'lap_regions': ubu['lap_regions'],
            'unbraced': ubu,
        }
        if geo is not None:
            auto_params['uplift_bracing']['positive_pieces'] = _uplift_positive_pieces(
                ubu, ub['lap_regions'] if ub else [], geo, span_secs, I_used)
        assumptions.extend(a for a in ubu['assumptions'] if a not in assumptions)

    # ── 양력 R (I6.2.1 through-fastened / I6.2.2 standing seam) ──
    uplift_R = None
    R_basis = None
    R_by_span = None
    if deck_type == 'through-fastened':
        if section:
            lap_in = []
            lap_d = []
            if has_laps:
                # (g) 는 내부 지점의 랩이다 — 내민(N)이 있으면 첫·마지막 실제 지점은 끝 지점이다.
                real_j = [j for j in range(n_spans + 1) if sup[j] != 'N']
                for j in range(real_j[0] + 1, real_j[-1]):
                    if sup[j] == 'N':
                        continue
                    lp = laps_ps[j] or {}
                    lap_in += [(lp.get('left_ft', 0) or 0) * 12.0, (lp.get('right_ft', 0) or 0) * 12.0]
                    if span_secs is not None:
                        dj = max([v for v in (span_secs[j - 1].get('depth'), span_secs[j].get('depth')) if v] or [0])
                        lap_d += [dj, dj]
            i621 = check_i621_conditions(
                section=section, Fy=section.get('Fy'), Fu=section.get('Fu'),
                span_ft=max(spans), span_type='continuous' if n_spans > 1 else 'simple',
                lap_lengths_in=lap_in or None, spans_ft=spans, supports=sup, deck=deck,
                system_confirmed=bool(i621_conditions_confirmed), insulation_in=insulation_in,
            )
            if span_secs is not None:
                # 결정 S7: §I6.2.1 조건 · R 을 경간마다 그 경간의 단면으로 — R 은 오늘의 규칙(경간 R 의 최솟값,
                # Table I6.2.1-1)을 그 단면으로 본 값. (g) 는 랩마다 겹친 두 부재 깊이의 큰 값과 견준다.
                by_span, gi = _i621_by_span(span_secs, section, spans, sup, deck, lap_in, lap_d,
                                            bool(i621_conditions_confirmed), insulation_in, secs_differ)
                auto_params['i621_by_span'] = by_span
                R_by_span = [b['R'] for b in by_span]
                real = [b for b in by_span if b['real_span']]
                if secs_differ:
                    i621 = by_span[gi]['check']
                    i621 = dict(i621, R=(min(b['R'] for b in real) if real and all(b['R'] is not None for b in real)
                                         else None))
                    auto_params['i621_check_span'] = gi
                    some = [b['span'] + 1 for b in real if b['R'] is not None]
                    if i621['R'] is None and some and uplift_result:
                        warnings.append(_nt('loads.warning.i621_r_some_spans_only', spans=', '.join(map(str, some)),
                                            others=', '.join(str(b['span'] + 1) for b in real if b['R'] is None)))
            auto_params['i621_check'] = i621
            uplift_R = i621.get('R')
            R_basis = _nt('loads.label.r_basis_table_i6_2_1') if uplift_R is not None else None
            if uplift_R is not None:
                assumptions.append(_nt('loads.assumption.i6_2_1_i6_conditions_confirmed_user'))
                assumptions.extend(i621['reasons'])
            elif uplift_result:
                warnings.append(_nt('loads.warning.i6_2_1_i6_uplift_applied_uplift', reasons=_joined(' ', i621['reasons'])))
        elif uplift_result:
            warnings.append(_nt('loads.warning.i6_2_1_section_provided_i6_uplift'))
    elif deck_type == 'standing-seam':
        R_t = deck.get('R_tested_uplift', deck.get('R_tested'))
        if R_t:
            uplift_R = float(R_t)
            R_basis = _nt('loads.label.r_basis_s908_test')
            assumptions.append(_nt('loads.assumption.standing_seam_uplift_from', uplift_R=uplift_R))
        elif uplift_result:
            warnings.append(_nt('loads.warning.app_a_standing_seam_roof_no'))
        if deck.get('R_tested_gravity'):
            auto_params['gravity_R'] = float(deck['R_tested_gravity'])
            auto_params['gravity_R_basis'] = _nt('loads.label.r_basis_s908_test')
            warnings.append(_nt('loads.warning.standing_seam_gravity_reported'))
        if not brace_points_ft:
            assumptions.append(_nt('loads.assumption.app_a_standing_seam_roof_without'))
    auto_params['uplift_R'] = uplift_R
    auto_params['uplift_R_basis'] = R_basis
    if span_secs is not None:
        if R_by_span is None:
            # 시험값 R(§I6.2.2)과 R 없음은 경간과 상관없다 — 경간마다 같은 값
            R_by_span = [uplift_R if not (sup[i] == 'N' or sup[i + 1] == 'N') else None for i in range(n_spans)]
        auto_params['uplift_R_by_span'] = R_by_span
        for r in (auto_params.get('uplift_bracing') or {}).get('negative_regions') or []:
            # 구간의 R = 그 구간이 놓인 경간의 R (§I6.2.1 이 쓰이는 구간만 — i621_region_eligible)
            r['uplift_R'] = R_by_span[r['span']] if r.get('i621_region_eligible') else None
        auto_params['span_map'] = _span_map(geo, span_secs, I_used, sec_I)
        if secs_differ:
            assumptions.append(_nt('loads.assumption.span_sections_per_span'))
            for j in range(1, n_spans):
                if sup[j] != 'N' and not laps_ps[j] and not _same_section(span_secs[j - 1], span_secs[j]):
                    warnings.append(_nt('loads.warning.section_change_without_lap', support=j + 1,
                                        left=span_secs[j - 1]['id'], right=span_secs[j]['id']))
            shared = [lp for lp in auto_params['span_map']['laps'] if not lp['same_section']]
            if shared:
                assumptions.append(_nt('loads.assumption.lap_sum_of_strengths'))
            for lp in auto_params['span_map']['laps']:
                if lp['depth_mismatch']:
                    warnings.append(_nt('loads.warning.lap_depth_mismatch', support=lp['support'] + 1,
                                        d_left=lp['depths'][0], d_right=lp['depths'][1]))
                if lp['stiffness_shares'] is None:
                    warnings.append(_nt('loads.warning.lap_shares_need_ixx', support=lp['support'] + 1))

    # ── 반력 ──
    wc_reactions = _extract_wc_reactions(gravity_result, spans)
    uplift_reactions = []
    if governing_result:
        for loc in governing_result['locations']:
            if loc.get('R_uplift') is not None and loc['R_uplift'] < -1e-9:
                uplift_reactions.append({
                    'name': loc['name'], 'x_ft': loc['x_ft'], 'support': loc.get('support'),
                    'R_uplift': loc['R_uplift'], 'combo': loc.get('combo_R_uplift'),
                    'unrounded': {'R_uplift': (loc.get('unrounded') or {}).get('R_uplift', loc['R_uplift']),
                                  'x_ft': (loc.get('unrounded') or {}).get('x_ft', loc['x_ft'])},
                    'pattern': loc.get('pattern_R_uplift'),
                })

    # ── 처짐 (사용하중) ──
    deflection_result, deflection_cases = _deflections(
        units, present, Wp_plf, spans, sup, pattern_on, snow_cases, E_fe, Ixx)
    if span_secs is not None and deflection_result:
        # 처짐은 경간마다의 강성(FE, 랩 = 두 부재의 합)으로 이미 풀었다 — 'Ixx' 는 옛 키(첫 단면), 여기 경간별 값
        deflection_result['I_span_in4'] = I_used
    if Ixx is None:
        warnings.append(_nt('loads.warning.section_ixx_given_deflections'))

    all_detail = []
    for v in variants:
        env = v['env']
        _mp, _mn = float(env['M'][0].max()), float(env['M'][1].min())
        _vv = float(max(env['V'][0].max(), -env['V'][1].min()))
        _rr = float(max(np.abs(env['R'][0]).max(), np.abs(env['R'][1]).max()))
        all_detail.append({
            'name': v['name'], 'factors': v['factors'],
            'max_pos_M': round(float(env['M'][0].max()), 3),
            'max_neg_M': round(float(env['M'][1].min()), 3),
            'max_abs_M': round(float(max(env['M'][0].max(), -env['M'][1].min())), 3),
            'max_abs_V': round(float(max(env['V'][0].max(), -env['V'][1].min())), 3),
            'max_R': round(float(max(np.abs(env['R'][0]).max(), np.abs(env['R'][1]).max())), 3),
            'is_uplift': v['is_uplift'],
            'governs_gravity': bool(gravity_result and v['name'] == gravity_result['combo']),
            'governs_uplift': bool(uplift_result and v['name'] == uplift_result['combo']),
            'governs_overall': bool(governing_result and v['name'] == governing_result['combo']),
            # 위 max_* 의 반올림 전 값(SI 변환용)
            'display_unrounded': {'max_pos_M': _mp, 'max_neg_M': _mn, 'max_abs_M': max(_mp, -_mn),
                                  'max_abs_V': _vv, 'max_R': _rr},
        })

    pattern_info = {
        'enabled': bool(patterned),
        'requested': bool(pattern_loading),
        'lr_reduced': bool(lr_reduced),
        'patterned_loads': sorted(patterned),
        'live_loads_patterned': [k for k in PATTERNED_LIVE_LOADS if k in patterned],
        'snow_cases': [c[0] for c in snow_cases] if 'S' in patterned else [],
        'why': pattern_why,
        'rule': _nt('loads.label.pattern_rule_patterned') if patterned else _nt('loads.label.pattern_rule_all'),
    }
    if 'S' in patterned:
        assumptions.append(_nt('loads.assumption.snow_partial_loading_sec'))
    scope_notes.append(_nt('loads.scope.member_self_weight_added'))
    if present.get('E'):
        # 지진 E 는 한 값의 하중효과로 조합한다(검토 2차 R2-5) — 7-22 의 7 · 10 은 −Ev 를 쓴다(Sec. 2.3.6 · 2.4.5)
        scope_notes.append(_nt('loads.scope.seismic_single_effect', standard=std_table['edition'],
                               combos={'asce7_10': '0.9D + 1.0E (LRFD 7), 0.6D + 0.7E (ASD 8)',
                                       'asce7_22': '7: 0.9D − Ev + Eh, 10: 0.6D − 0.7Ev + 0.7Eh',
                                       'kds_41_12_00': '(1.7-7) 0.9D + 1.0E, (1.7-15) 0.6D + 0.7E'}[combo_std]))
    if combo_std != 'asce7_10':
        # 처음 값(asce7_10)의 결과는 지금과 바이트로 같게 둔다 — 고른 때만 밝힌다(결정 R4)
        assumptions.append(std_table['load_definition'])
        scope_notes.append(_nt('loads.scope.combination_standard_scope', standard=std_table['edition']))

    return _attach_notices(_mirror_unrounded({
        'member_app': member_app,
        'span_type': span_type,
        'n_spans': n_spans,
        'design_method': method,
        'load_combination_standard': ({
            'edition': LOAD_COMBINATION_EDITION,
            'reference': LOAD_COMBINATION_REFERENCE[method],
        } if combo_std == 'asce7_10' and load_combination_standard is None else {
            'edition': std_table['edition'],
            'reference': std_table['reference'][method],
            'key': combo_std,
            'allowed': list(LOAD_COMBINATION_STANDARDS),
            'unchanged_by_selection': ['deflection', 'deflection_cases', 'pattern_loading'],
        }),
        'analysis_method': _nt('loads.label.method_fe') if use_fe else _nt('loads.label.method_three_moment'),
        'governing': governing_result,
        'gravity': gravity_result,
        'uplift': uplift_result,
        'deflection': deflection_result,
        'deflection_cases': deflection_cases,
        'auto_params': auto_params,
        'wc_reactions': wc_reactions,
        'uplift_reactions': uplift_reactions,
        'all_combos': [v['name'] for v in variants],
        # 사람이 읽도록 반올림한 위치 키(판정은 반올림하지 않은 값 — locations[].Vu_left_unrounded 등, 계약 §6.1)
        'display_rounding': {'decimals': {'wc_reactions[].Pu': 3, 'uplift_reactions[].R_uplift': 4,
                                          'auto_params.*_regions[].start_ft · end_ft · M1 · M2 · M_max_abs': 4,
                                          'auto_params.*_regions[].x_M_max_ft': 3,
                                          'auto_params.*_regions[].Ly_in · Lt_in': 1,
                                          'auto_params.*_regions[].Cb': 2,
                                          'auto_params.*.inflection_points_ft': 2,
                                          'locations[].Mu': 3, 'locations[].Vu': 3, 'locations[].Ru': 3,
                                          'locations[].Vu_left': 3, 'locations[].Vu_right': 3,
                                          'locations[].Mu_max': 3, 'locations[].Mu_min': 3, 'locations[].R_max': 4,
                                          'locations[].R_min': 4, 'locations[].x_ft': 2},
                             'note': 'display only — every listed record carries the same keys unrounded in its '
                                     '`unrounded` sub-object (and inflection_points_ft_unrounded); use those and the '
                                     'envelope arrays for decisions'},
        'all_combos_detail': all_detail,
        'pattern_loading': pattern_info,
        'input_loads_plf': {k: round(v, 3) for k, v in (loads or {}).items()
                            if v is not None and v != 0},
        'strong_axis_loads_plf': {k: round(v, 3) for k, v in present.items()},
        'supports': sup,
        'spans_ft': spans,
        'laps_per_support': laps_ps,
        'brace_points_ft': list(brace_points_ft or []),
        'warnings': warnings,
        'assumptions': assumptions,
        'scope_notes': scope_notes,
        'not_evaluated': not_evaluated,
    }, deck_info))


def _mirror_unrounded(result, deck_info=None):
    """표시용으로 반올림한 기록마다 같은 자리의 반올림 전 값을 display_unrounded 로 덧붙인다(SI 변환용 — 설계
    결과와 같은 이름 · 같은 뜻). 값은 이미 있는 `unrounded` 하위 묶음 · `*_unrounded` 키 · 데크 강성에서 온다.
    옛 키 · 값은 바꾸지 않는다. 같은 객체가 두 자리에 있어도 결과는 같다."""
    deck_raw = (deck_info or {}).get('display_unrounded') or {}

    def num(v):
        return isinstance(v, (int, float)) and not isinstance(v, bool) and np.isfinite(v)

    def walk(o):
        if isinstance(o, list):
            for x in o:
                walk(x)
            return
        if not isinstance(o, dict):
            return
        du = {}
        u = o.get('unrounded')
        if isinstance(u, dict):
            for k, v in u.items():
                if num(v) and num(o.get(k)):
                    du[k] = float(v)
            for alias, src_key in (('Ly', 'Ly_in'), ('Lt', 'Lt_in')):
                if num(o.get(alias)) and num(u.get(src_key)) and o.get(alias) == o.get(src_key):
                    du[alias] = float(u[src_key])
        for k, v in o.items():
            if k.endswith('_unrounded') and num(v) and num(o.get(k[:-len('_unrounded')])):
                du[k[:-len('_unrounded')]] = float(v)
        for k, dec in (('kphi', 4), ('kx', 3)):      # _calc_deck_info 의 반올림 자리
            if (num(o.get(k)) and num(deck_raw.get(k)) and o.get(k) != deck_raw[k]
                    and abs(o[k] - round(deck_raw[k], dec)) < 1e-12):
                du[k] = float(deck_raw[k])
        if du:
            prev = o.get('display_unrounded') if isinstance(o.get('display_unrounded'), dict) else {}
            o['display_unrounded'] = {**du, **prev}
        for k, v in o.items():
            if k not in ('display_unrounded', 'unrounded'):
                walk(v)
    walk(result)
    return result


# ---------------------------------------------------------------------------
# 입력 해석
# ---------------------------------------------------------------------------

def _resolve_geometry(span_type, span_ft, spans_ft, supports):
    st = str(span_type or '').strip().lower()
    if st in ('simple', 'cantilever'):
        n = 1
    elif st == 'cont-n':
        if not spans_ft:
            raise ValueError("span_type 'cont-n' (or 'cont-N') needs spans_ft with one length per "
                             "span; for equal spans give the count instead, e.g. span_type='cont-4'.")
        n = len(spans_ft)
    elif st.startswith('cont-') and st[5:].isdigit() and int(st[5:]) >= 1:
        n = int(st[5:])
    else:
        raise ValueError(f'Unknown span_type {span_type!r}: use simple, cantilever, cont-<n> or cont-n.')
    if spans_ft:
        if len(spans_ft) != n:
            raise ValueError(f'spans_ft has {len(spans_ft)} lengths but span_type {span_type!r} '
                             f'means {n} span(s).')
        spans = [float(s) for s in spans_ft]
    else:
        spans = [float(span_ft)] * n
    if any(s <= 0 for s in spans):
        raise ValueError('Span lengths must be positive.')
    if supports:
        if len(supports) != n + 1:
            raise ValueError(f'supports has {len(supports)} entries; {n} span(s) need {n + 1}.')
        sup = [str(s)[0].upper() if s else 'P' for s in supports]
    else:
        sup = ['F', 'N'] if st == 'cantilever' else ['P'] * (n + 1)
    if st == 'cantilever' and 'N' not in sup:
        raise ValueError("span_type 'cantilever' needs a free end (N) in supports.")
    check_support_stability(sup)
    return n, spans, sup


def _resolve_laps(laps, laps_per_support, n_spans, sup, warnings):
    """지점별 랩 [dict|None] (지점 수만큼). 양 끝 지점·자유단의 랩은 버린다."""
    out = [None] * (n_spans + 1)
    if laps_per_support is not None:
        if len(laps_per_support) != n_spans + 1:
            raise ValueError(f'laps_per_support has {len(laps_per_support)} entries; '
                             f'{n_spans + 1} supports.')
        for j, lp in enumerate(laps_per_support):
            if not lp:
                continue
            lL = float(lp.get('left_ft', 0) or 0)
            lR = float(lp.get('right_ft', 0) or 0)
            if lL <= 0 and lR <= 0:
                continue
            if j == 0 or j == n_spans or sup[j] == 'N':
                warnings.append(_nt('loads.warning.lap_at_support_ignored', value=j + 1))
                continue
            out[j] = {'left_ft': lL, 'right_ft': lR}
    elif laps:
        lL = float(laps.get('left_ft', 0) or 0)
        lR = float(laps.get('right_ft', 0) or 0)
        if (lL > 0 or lR > 0) and n_spans > 1:
            for j in range(1, n_spans):
                if sup[j] != 'N':
                    out[j] = {'left_ft': lL, 'right_ft': lR}
    for j, lp in enumerate(out):
        if lp and (lp['left_ft'] < 0 or lp['right_ft'] < 0):
            raise ValueError(f'Negative lap length at support {j + 1}.')
    return out


# ---------------------------------------------------------------------------
# 단위하중 응답과 포락
# ---------------------------------------------------------------------------

def _unit_responses(spans, sup, laps_ps, Ixx, E_ksi, use_fe, npts, I_span_in4=None):
    """경간 i 에만 1 kip/ft (1000 plf) 를 실은 응답 배열 (경간 수 × …)."""
    n = len(spans)
    rows = {'M': [], 'V': [], 'R': [], 'VL': [], 'VR': [], 'D': []}
    x_ref = None
    for i in range(n):
        w = [0.0] * n
        w[i] = 1000.0
        if use_fe:
            res = analyze_beam_fe(spans, w, sup, laps_ps, I_base_in4=Ixx or 1.0,
                                  I_lap_ratio=2.0, E_ksi=E_ksi, n_pts_per_span=npts,
                                  I_span_in4=I_span_in4)
        elif n == 1 and sup[0] in ('P', 'R') and sup[1] in ('P', 'R'):
            res = analyze_simple_beam(spans[0], 1000.0, npts)
        else:
            res = analyze_continuous_beam_general(spans, w, supports=sup, n_pts_per_span=npts)
        if not res.is_valid:
            raise ValueError('Beam analysis failed.')
        x = np.asarray(res.x, dtype=float)
        if x_ref is None:
            x_ref = x
        elif len(x) != len(x_ref) or np.max(np.abs(x - x_ref)) > 1e-9:
            raise ValueError('Inconsistent analysis grids between unit load cases.')
        st = support_statics(res.x, res.M, spans, w, sup)
        rows['M'].append(np.asarray(res.M, dtype=float))
        rows['V'].append(np.asarray(res.V, dtype=float))
        rows['R'].append(np.asarray(st['R'], dtype=float))
        rows['VL'].append(np.asarray(st['V_left'], dtype=float))
        rows['VR'].append(np.asarray(st['V_right'], dtype=float))
        if Ixx:
            if use_fe:
                d = np.asarray(res.D, dtype=float)
            else:
                fe = analyze_beam_fe(spans, w, sup, None, I_base_in4=Ixx, E_ksi=E_ksi,
                                     n_pts_per_span=npts, I_span_in4=I_span_in4)
                d = np.interp(x_ref, np.asarray(fe.x), np.asarray(fe.D))
            rows['D'].append(d)
    out = {k: np.vstack(v) for k, v in rows.items() if v}
    out['x'] = x_ref
    out['has_D'] = bool(Ixx)
    return out


def _build_variants(present, Wp_plf, method, standard=None):
    """조합 × 풍하중 방향. W 슬롯은 부압 W, 정압 Wp 두 가지."""
    variants = []
    for name, factors in get_applicable_combos(present, method, standard):
        w = {k: present.get(k, 0.0) for k in factors}
        variants.append(_variant(name, factors, w))
    if Wp_plf > 0:
        wp_loads = dict(present)
        wp_loads['W'] = Wp_plf
        for name, factors in get_applicable_combos(wp_loads, method, standard):
            if 'W' not in factors:
                continue
            w = {k: wp_loads.get(k, 0.0) for k in factors}
            variants.append(_variant(name + ' [Wp]', factors, w))
    return variants


def _variant(name, factors, w):
    # 하중이 모두 등분포이므로 조합의 순하중 부호가 곧 모든 위치의 하중 방향이다.
    # 순하중이 위로 향하는 조합만 양력이다 — W 가 있다는 것만으로(또는 D·W 만의 순하중으로)
    # 가르면 D+0.75(0.6W)+0.75Lr 처럼 순하향인 조합의 중력형 다이어그램이 양력 포락에 섞인다.
    w_net = sum(a * w.get(k, 0.0) for k, a in factors.items())
    return {'name': name, 'factors': dict(factors), 'w': w, 'is_uplift': w_net < 0,
            'w_net_plf': w_net}


def _members(vars_):
    return ([v['env']['M'][0].tolist() for v in vars_], [v['env']['M'][1].tolist() for v in vars_])


def _pattern_keys(lr_reduced, present, n_spans, requested):
    """부분재하할 하중 집합과 하중별 까닭."""
    keys, why = set(), {}
    for k in ('L', 'Lr', 'S'):
        if k not in present:
            continue
        if n_spans < 2:
            why[k] = _nt('loads.label.pattern_why_single_span')
        elif not requested:
            why[k] = _nt('loads.label.pattern_why_disabled')
        elif k == 'L':
            keys.add(k)
            why[k] = _nt('loads.label.pattern_why_l')
        elif k == 'Lr':
            if lr_reduced:
                keys.add(k)
                why[k] = _nt('loads.label.pattern_why_lr_reduced')
            else:
                why[k] = _nt('loads.label.pattern_why_lr_not_reduced')
        else:
            keys.add(k)
            why[k] = _nt('loads.label.pattern_why_s')
    return frozenset(keys), why


def _load_mode(key, pattern_on):
    """pattern_on: 부분재하할 하중 키 집합 (frozenset)."""
    if pattern_on and key in pattern_on and key in PATTERNED_LIVE_LOADS:
        return 'subset'
    if pattern_on and key in pattern_on and key in PATTERNED_SNOW_LOADS:
        return 'cases'
    return 'fixed'


def _variant_envelope(var, units, pattern_on, snow_cases):
    """조합 하나의 위치별 (최대, 최소) — M, V, R, VL, VR, (D)."""
    P = np.array([c[1] for c in snow_cases], dtype=float)
    env = {}
    for q in ('M', 'V', 'R', 'VL', 'VR'):
        U = units[q]
        hi = np.zeros(U.shape[1])
        lo = np.zeros(U.shape[1])
        for k, a in var['factors'].items():
            s = a * var['w'].get(k, 0.0) / 1000.0
            if s == 0:
                continue
            mode = _load_mode(k, pattern_on)
            if mode == 'fixed':
                c = s * U.sum(axis=0)
                hi += c
                lo += c
            elif mode == 'subset':
                C = s * U
                hi += np.clip(C, 0, None).sum(axis=0)
                lo += np.clip(C, None, 0).sum(axis=0)
            else:
                C = s * (P @ U)
                hi += C.max(axis=0)
                lo += C.min(axis=0)
        env[q] = (hi, lo)
    return env


def _pattern_at(var, units, q, idx, sense, pattern_on, snow_cases, tol=0.0):
    """조합 var 의 q[idx] 를 최대(sense=+1)/최소(-1)로 만드는 경간별 하중 (plf) 과 설명.
    tol > 0 이면 기여가 |c| ≤ tol 인 경간은 싣지 않고, 눈 경우는 극값에서 tol 안의 첫 경우(동률 규칙, 계약 §6.1)."""
    n = units['M'].shape[0]
    U = units[q]
    w_span = np.zeros(n)
    desc = {}
    for k, a in var['factors'].items():
        wk = var['w'].get(k, 0.0)
        s = a * wk / 1000.0
        if s == 0:
            continue
        mode = _load_mode(k, pattern_on)
        if mode == 'fixed':
            w_span += a * wk
        elif mode == 'subset':
            c = s * U[:, idx]
            loaded = [i for i in range(n) if sense * c[i] > tol]
            for i in loaded:
                w_span[i] += a * wk
            desc[k] = (_nt('loads.label.pattern_spans_loaded', spans=','.join(str(i + 1) for i in loaded)) if loaded
                       else _nt('loads.label.pattern_not_acting'))
        else:
            P = np.array([c[1] for c in snow_cases], dtype=float)
            vals = s * (P @ U[:, idx])
            p = int(np.argmax(vals)) if sense > 0 else int(np.argmin(vals))
            if tol > 0:
                p = next(i for i, x in enumerate(vals) if abs(x - vals[p]) <= tol)
            w_span += a * wk * P[p]
            desc[k] = snow_cases[p][0]
    return w_span, desc


def _diagram_for(w_span, units, q):
    return (w_span / 1000.0) @ units[q]


def _class_result(vars_, units, spans, sup, laps_ps, direction, depth, pattern_on, snow_cases):
    """조합 묶음(중력/양력/전체)의 포락 결과 — legacy 키(combo, locations, M_diagram, …) 포함."""
    if not vars_:
        return None
    env = {}
    arg = {}
    # np.argmax / argmin 은 같은 값이면 첫 번째를 고른다 → 동률이면 combos 목록에서 먼저 나온 조합(계약 §6.1).
    for q in ('M', 'V', 'R', 'VL', 'VR'):
        HI = np.vstack([v['env'][q][0] for v in vars_])
        LO = np.vstack([v['env'][q][1] for v in vars_])
        env[q] = (HI.max(axis=0), LO.min(axis=0))
        arg[q] = (HI.argmax(axis=0), LO.argmin(axis=0))
    Mhi, Mlo = env['M']
    peak = max(float(Mhi.max()), float(-Mlo.min()))
    if peak <= 1e-12:
        return None

    x = units['x']
    locs = extract_critical_locations_envelope(
        x.tolist(), Mhi.tolist(), Mlo.tolist(), env['V'][0].tolist(), env['V'][1].tolist(),
        spans, supports=sup, laps_per_support=laps_ps,
        R_max=env['R'][0].tolist(), R_min=env['R'][1].tolist(),
        VL_max=env['VL'][0].tolist(), VL_min=env['VL'][1].tolist(),
        VR_max=env['VR'][0].tolist(), VR_min=env['VR'][1].tolist(),
        direction=direction, member_depth_in=depth)

    def gov(q, idx, sense):
        vi = int(arg[q][0 if sense > 0 else 1][idx])
        var = vars_[vi]
        _, desc = _pattern_at(var, units, q, idx, sense, pattern_on, snow_cases)
        return var['name'], desc

    # 포락선의 값마다 그 값을 만든 조합 · 패턴(V6-08) — 런 길이 [start, count, combo_index, pattern_index].
    # combo_index 는 이 결과의 'combos', pattern_index 는 'patterns' 표의 자리.
    patterns, pat_ix = [], {}

    def _pid(desc):
        key = json.dumps(desc, sort_keys=True, ensure_ascii=False)
        if key not in pat_ix:
            pat_ix[key] = len(patterns)
            patterns.append(desc)
        return pat_ix[key]

    # 동률 허용오차: 그 물리량의 포락 크기의 1e-9 배(최소 1e-9) — 모든 조합이 0 인 측점의 부동소수 잡음으로
    # 조합 · 경간을 고르지 않는다(V6b-07).
    tol = {}
    for q in ('M', 'V', 'R', 'VL', 'VR'):
        big = max(float(np.abs(np.vstack([v['env'][q][0] for v in vars_])).max()),
                  float(np.abs(np.vstack([v['env'][q][1] for v in vars_])).max()), 1.0)
        tol[q] = 1e-9 * big

    def pick(q, idx, sense):
        """극값에서 tol 안의 첫 조합(combos 순서)과 그 패턴."""
        k = 0 if sense > 0 else 1
        vals = [float(v['env'][q][k][idx]) for v in vars_]
        ext = max(vals) if sense > 0 else min(vals)
        vi = next(i for i, x in enumerate(vals) if abs(x - ext) <= tol[q])
        _, desc = _pattern_at(vars_[vi], units, q, idx, sense, pattern_on, snow_cases, tol=tol[q])
        return vi, desc

    def gov_src(q, idx, sense):
        vi, desc = pick(q, idx, sense)
        return vars_[vi]['name'], desc

    def _runs(q, sense):
        rows = arg[q][0 if sense > 0 else 1]
        out = []
        for idx in range(len(rows)):
            vi, desc = pick(q, idx, sense)
            pi = _pid(desc)
            if out and out[-1][2] == vi and out[-1][3] == pi and out[-1][0] + out[-1][1] == idx:
                out[-1][1] += 1
            else:
                out.append([idx, 1, vi, pi])
        return out

    env_source = {}
    for q, name in (('M', 'M'), ('V', 'V'), ('R', 'R')):
        env_source[name + '_max'] = _runs(q, +1)
        env_source[name + '_min'] = _runs(q, -1)
    env_source['patterns'] = patterns

    for loc in locs:
        idx, qk = loc.pop('_idx', None), loc.pop('_q', None)
        j = loc.pop('_sup', None)
        if qk in ('Mmax', 'Mmin') and loc['name'].startswith('Lap end'):
            # 랩 끝은 격자 사이의 선형 보간값이다 — 두 이웃 격자점(그 출처는 envelope_source)을 밝힌다.
            xe = loc['x_ft']
            k0 = max(i for i in range(len(x)) if x[i] <= xe + 1e-9) if xe >= x[0] else 0
            loc['source_stations'] = [k0, min(k0 + 1, len(x) - 1)]
            loc['combo'], loc['pattern'] = gov('M', idx, +1 if qk == 'Mmax' else -1)
        elif qk in ('Mmax', 'Mmin'):
            loc['combo'], loc['pattern'] = gov('M', idx, +1 if qk == 'Mmax' else -1)
            vs = +1 if abs(env['V'][0][idx]) >= abs(env['V'][1][idx]) else -1
            loc['combo_V'], loc['pattern_V'] = gov_src('V', idx, vs)
        elif qk == 'support':
            if loc['Mu'] is None:
                loc['combo'], loc['pattern'] = None, None
            else:
                loc['combo'], loc['pattern'] = gov('M', idx, -1 if loc['Mu'] < 0 else +1)
            r_sense = -1 if direction == 'uplift' else +1
            loc['combo_R'], loc['pattern_R'] = gov('R', j, r_sense)
            # Vu = 지점 왼쪽 · 오른쪽 전단 포락의 큰 크기 — 그 쪽(V_side)과 조합 · 패턴
            vl = max(abs(env['VL'][0][j]), abs(env['VL'][1][j]))
            vr = max(abs(env['VR'][0][j]), abs(env['VR'][1][j]))
            side = 'VL' if vl >= vr else 'VR'
            vs = +1 if abs(env[side][0][j]) >= abs(env[side][1][j]) else -1
            loc['V_side'] = 'left' if side == 'VL' else 'right'
            loc['combo_V'], loc['pattern_V'] = gov_src(side, j, vs)
            # 면마다(V6b-01 뒤): 반올림하지 않은 면 전단과 그 출처 [combo_index, pattern_index, sense]
            # (combos · envelope_source.patterns 의 자리; sense +1 = 포락 최대, −1 = 최소에서 온 크기)
            for qk2, key in (('VL', 'left'), ('VR', 'right')):
                hi, lo = float(env[qk2][0][j]), float(env[qk2][1][j])
                sn = +1 if abs(hi) >= abs(lo) else -1
                vi2, desc2 = pick(qk2, j, sn)
                loc[f'Vu_{key}_unrounded'] = max(abs(hi), abs(lo))
                loc[f'V_{key}_source'] = [vi2, _pid(desc2), sn]
            m_hi, m_lo = float(env['M'][0][idx]), float(env['M'][1][idx])
            msn = -1 if abs(m_lo) >= abs(m_hi) else +1
            vi3, desc3 = pick('M', idx, msn)
            loc['M_source'] = [vi3, _pid(desc3), msn]
            if loc.get('R_uplift') is not None and loc['R_uplift'] < -1e-9:
                loc['combo_R_uplift'], loc['pattern_R_uplift'] = gov('R', j, -1)
            else:
                loc['combo_R_uplift'], loc['pattern_R_uplift'] = None, None

    # 전체 최대 |M| 의 조합과 실제 다이어그램
    if float(Mhi.max()) >= float(-Mlo.min()):
        idx, sense = int(Mhi.argmax()), +1
    else:
        idx, sense = int(Mlo.argmin()), -1
    vi = int(arg['M'][0 if sense > 0 else 1][idx])
    var = vars_[vi]
    w_span, desc = _pattern_at(var, units, 'M', idx, sense, pattern_on, snow_cases)
    M_d = _diagram_for(w_span, units, 'M')
    V_d = _diagram_for(w_span, units, 'V')
    return {
        'combo': var['name'],
        'pattern': desc,
        'locations': locs,
        'M_diagram': M_d.tolist(),
        'V_diagram': V_d.tolist(),
        'x_diagram': x.tolist(),
        'governing_span_loads_plf': [round(float(v), 3) for v in w_span],
        'M_envelope_max': Mhi.tolist(),
        'M_envelope_min': Mlo.tolist(),
        'V_envelope_max': env['V'][0].tolist(),
        'V_envelope_min': env['V'][1].tolist(),
        'R_envelope_max': env['R'][0].tolist(),
        'R_envelope_min': env['R'][1].tolist(),
        'combos': [v['name'] for v in vars_],
        'envelope_source': env_source,
    }


# ---------------------------------------------------------------------------
# 비지지 영역 대표값 (legacy 단일 키)
# ---------------------------------------------------------------------------

GOV_CRITERION = ('governing region = largest M_max_abs * Ly^2 / Cb (elastic LTB demand index; '
                 'F2.1.1-1/-6: Fcre is proportional to Cb / Ly^2). The keys are that region\'s own '
                 'Ly, Cb and M. Pieces shorter than 1 in. are ignored.')


def _governing_region(regs):
    """M_max_abs·Ly²/Cb 가 가장 큰 영역. 어떤 영역의 M 이 이 영역의 M 이하라면 그 영역의
    지표도 이 영역 이하이므로, 최대 Mu 를 이 영역의 (Ly, Cb) 와 짝지어도 보수측이다."""
    cand = [r for r in regs if r.get('Ly_in', 0) >= 1.0] or list(regs)
    return max(cand, key=lambda r: (r.get('M_max_abs', 0.0) * r['Ly_in'] ** 2 / max(r['Cb'], 1e-9),
                                    r['Ly_in']))


def _positive_gov(ub, deck_type, deck_info):
    regs = ub['positive_regions']
    if deck_type == 'through-fastened':
        return {'Ly_in': 0, 'Lt_in': 0, 'Cb': 1.0, 'kphi': deck_info.get('kphi', 0),
                'braced': True, 'basis': _nt('loads.label.deck_braces_top_flange')}
    if not regs:
        return {'Ly_in': 0, 'Lt_in': 0, 'Cb': 1.0, 'kphi': deck_info.get('kphi', 0),
                'braced': False, 'not_applicable': True,
                'note': _nt('loads.label.no_top_flange_compression')}
    g = _governing_region(regs)
    return {
        'start_ft': g['start_ft'], 'end_ft': g['end_ft'],
        'Ly_in': g['Ly_in'], 'Lt_in': g['Lt_in'],
        'Cb': g['Cb'],
        'Cb_detail': g.get('Cb_detail'),
        'M_max_abs': g.get('M_max_abs'),
        'cantilever': g.get('cantilever'),
        'kphi': deck_info.get('kphi', 0),
        'braced': False,
        'basis': _nt('loads.label.gov_region_top', n=len(regs)),
        'regions': [{k: r[k] for k in ('start_ft', 'end_ft', 'Ly_in', 'Cb', 'M_max_abs', 'cantilever', 'unrounded')}
                    for r in regs],
        'unrounded': g.get('unrounded'),
        **_span_keys(g),
    }


def _negative_gov(regs, ub, sup, spans):
    if regs:
        g = _governing_region(regs)
        out = {
            'start_ft': g['start_ft'], 'end_ft': g['end_ft'],
            'Ly_in': g['Ly_in'], 'Lt_in': g['Lt_in'],
            'Cb': g['Cb'],
            'Cb_detail': g.get('Cb_detail'),
            'M1': g.get('M1'), 'M2': g.get('M2'),
            'M_max_abs': g.get('M_max_abs'),
            'cantilever': g.get('cantilever'),
            'kphi': 0,
            'basis': _nt('loads.label.gov_region_bottom', n=len(regs)),
        }
        if 'i621_region_eligible' in g:
            out['i621_region_eligible'] = g['i621_region_eligible']
        out['unrounded'] = g.get('unrounded')
        out.update(_span_keys(g))
        return out
    # 하부 플랜지 압축이 없으면 가장 긴 브레이스 간격 (보수측 대표값)
    pts = sorted(set([x for j, x in enumerate(ub['supports_ft']) if sup[j] != 'N']
                     + list(ub.get('brace_points_ft', []))))
    segs = [(p, q) for p, q in zip(pts[:-1], pts[1:])]
    xs = ub['supports_ft']
    if sup[0] == 'N':
        segs.append((xs[0], pts[0]))
    if sup[-1] == 'N':
        segs.append((pts[-1], xs[-1]))
    p, q = max(segs, key=lambda s: s[1] - s[0]) if segs else (0.0, sum(spans))
    Ly = round((q - p) * 12.0, 1)
    return {'start_ft': p, 'end_ft': q, 'Ly_in': Ly, 'Lt_in': Ly, 'Cb': 1.0, 'kphi': 0,
            'fallback': True, 'unrounded': {'start_ft': p, 'end_ft': q, 'Ly_in': (q - p) * 12.0,
                                            'Lt_in': (q - p) * 12.0, 'Cb': 1.0},
            'note': 'No bottom-flange compression in this envelope; longest brace-to-brace '
                    'length given with Cb = 1.0.'}


# ---------------------------------------------------------------------------
# 처짐
# ---------------------------------------------------------------------------

def _deflections(units, present, Wp_plf, spans, sup, pattern_on, snow_cases, E_ksi, Ixx):
    if not units.get('has_D'):
        return None, []
    U = units['D']
    x = units['x']
    P = np.array([c[1] for c in snow_cases], dtype=float)

    def single(key, w):
        s = w / 1000.0
        mode = _load_mode(key, pattern_on)
        if mode == 'fixed':
            d = s * U.sum(axis=0)
            return d, d
        if mode == 'subset':
            C = s * U
            return np.clip(C, 0, None).sum(axis=0), np.clip(C, None, 0).sum(axis=0)
        C = s * (P @ U)
        return C.max(axis=0), C.min(axis=0)

    def per_span(hi, lo):
        d = np.where(np.abs(hi) >= np.abs(lo), hi, lo)
        return extract_max_deflection_per_span(x.tolist(), d.tolist(), spans, sup), d

    def d_source(keys):
        """부분재하 처짐 포락의 출처(V6-08): 격자점마다 하중별 재하 경간 — [start, count, pattern_index].
        조합이 아니라 비계수 하중(또는 D + 활하중)이므로 combo 칸이 없다. 부분재하가 없으면 None."""
        if all(_load_mode(k, pattern_on) == 'fixed' for k, _ in keys):
            return None
        pats, ix = [], {}
        out = {}
        for sense, name in ((+1, 'D_max'), (-1, 'D_min')):
            runs = []
            for idx in range(U.shape[1]):
                desc = {}
                for k, w in keys:
                    mode = _load_mode(k, pattern_on)
                    if mode == 'fixed':
                        desc[k] = _nt('loads.label.pattern_all_spans')
                    elif mode == 'subset':
                        c = (w / 1000.0) * U[:, idx]
                        tol_d = 1e-9 * max(float(np.abs(U).max()) * abs(w) / 1000.0, 1e-12)
                        loaded = [i for i in range(U.shape[0]) if sense * c[i] > tol_d]
                        desc[k] = (_nt('loads.label.pattern_spans_loaded', spans=','.join(str(i + 1) for i in loaded))
                                   if loaded else _nt('loads.label.pattern_not_acting'))
                    else:
                        vals = (w / 1000.0) * (P @ U[:, idx])
                        desc[k] = snow_cases[int(np.argmax(vals)) if sense > 0 else int(np.argmin(vals))][0]
                key = json.dumps(desc, sort_keys=True, ensure_ascii=False)
                if key not in ix:
                    ix[key] = len(pats)
                    pats.append({'loads': desc})
                pi = ix[key]
                if runs and runs[-1][2] == pi and runs[-1][0] + runs[-1][1] == idx:
                    runs[-1][1] += 1
                else:
                    runs.append([idx, 1, pi])
            out[name] = runs
        out['patterns'] = pats
        return out

    cases = []
    for key in ('D', 'L', 'Lr', 'S', 'R', 'W'):
        if not present.get(key):
            continue
        hi, lo = single(key, present[key])
        ps, d = per_span(hi, lo)
        cases.append({'case': key, 'basis': (_nt('loads.label.defl_alone_pattern')
                                             if _load_mode(key, pattern_on) != 'fixed' else _nt('loads.label.defl_alone')),
                      'per_span': ps, 'D_envelope_max': hi.tolist(), 'D_envelope_min': lo.tolist()})
        dsrc = d_source([(key, present[key])])
        if dsrc:
            cases[-1]['D_envelope_source'] = dsrc
    if Wp_plf > 0:
        hi, lo = single('W', Wp_plf)
        ps, d = per_span(hi, lo)
        cases.append({'case': 'Wp', 'basis': _nt('loads.label.defl_alone'), 'per_span': ps,
                      'D_envelope_max': hi.tolist(), 'D_envelope_min': lo.tolist()})
    for c in cases:
        if c['case'] in ('W', 'Wp'):
            c['note'] = _nt('loads.label.wind_deflection_note')

    # 사용하중 합계 D + (L | Lr | S | R) — 비계수
    totals = []
    hiD, loD = single('D', present.get('D', 0.0)) if present.get('D') else (np.zeros_like(x), np.zeros_like(x))
    for key in ('L', 'Lr', 'S', 'R'):
        if not present.get(key):
            continue
        hi, lo = single(key, present[key])
        totals.append((f'D+{key}', hiD + hi, loD + lo, key))
    if not totals and present.get('D'):
        totals.append(('D', hiD, loD, None))
    deflection = None
    best = None
    for name, hi, lo, lkey in totals:
        ps, d = per_span(hi, lo)
        cases.append({'case': name, 'basis': _nt('loads.label.defl_service_total'), 'per_span': ps,
                      'D_envelope_max': hi.tolist(), 'D_envelope_min': lo.tolist()})
        if lkey:
            dsrc = d_source(([('D', present['D'])] if present.get('D') else []) + [(lkey, present[lkey])])
            if dsrc:
                cases[-1]['D_envelope_source'] = dsrc
        mag = max(p['abs_delta_in'] for p in ps)
        if best is None or mag > best[0]:
            best = (mag, name, d, ps)
    if best:
        _, name, d, ps = best
        deflection = {
            'combo': name,
            'basis': (_nt('loads.label.defl_gravity_total_pattern') if pattern_on
                      else _nt('loads.label.defl_gravity_total')),
            'D_diagram': [round(float(v), 5) for v in d],
            'per_span': ps,
            'E_ksi': E_ksi,
            'Ixx': Ixx,
            'valid': True,
            'note': None,
        }
    return deflection, cases


# ---------------------------------------------------------------------------
# 내부 헬퍼 (이전 경로 — 호환용)
# ---------------------------------------------------------------------------

def _merge_controlling(base: dict, wp: dict) -> dict:
    """Wu 조합과 Wp 조합 결과를 병합하여 더 큰 쪽 채택 (이전 API, analyze_loads 는 쓰지 않음)"""
    merged = dict(base)

    def _max_abs_M(combo_tuple):
        if not combo_tuple:
            return 0
        _, combined = combo_tuple
        M = combined.get('M', [])
        return max((abs(m) for m in M), default=0) if M else 0

    if _max_abs_M(wp.get('gravity')) > _max_abs_M(base.get('gravity')):
        merged['gravity'] = wp['gravity']
    base_uplift_min = min((m for m in (base['uplift'][1].get('M', []) if base.get('uplift') else [])), default=0)
    wp_uplift_min = min((m for m in (wp['uplift'][1].get('M', []) if wp.get('uplift') else [])), default=0)
    if wp_uplift_min < base_uplift_min:
        merged['uplift'] = wp['uplift']
    if _max_abs_M(wp.get('overall')) > _max_abs_M(base.get('overall')):
        merged['overall'] = wp['overall']
    merged['all_detail'] = base.get('all_detail', []) + [
        {**d, 'name': d['name'] + ' [Wp]'}
        for d in wp.get('all_detail', [])
    ]
    merged['all'] = base.get('all', []) + [
        (n + ' [Wp]', c) for n, c in wp.get('all', [])
    ]
    return merged


def sup_type_simple(supports: list) -> bool:
    """양단 핀/롤러인 단순보인지 확인 (고정단·자유단 아닌 경우)"""
    if not supports or len(supports) < 2:
        return True
    for s in supports:
        c = s[0].upper() if s else 'P'
        if c in ('F', 'N'):
            return False
    return True


def _parse_n_spans(span_type: str) -> int:
    """span_type → 경간 수. 'cont-n' 처럼 수가 없는 값은 ValueError (spans_ft 로 정한다)."""
    st = str(span_type or '').strip().lower()
    if st in ('simple', 'cantilever'):
        return 1
    if st.startswith('cont-') and st[5:].isdigit():
        return int(st[5:])
    raise ValueError(f'span_type {span_type!r} does not give a span count.')


def _extract_locations_from_combined(combined: dict, spans: list,
                                     laps: dict = None, supports: list = None) -> list:
    """하중조합 결과에서 임계 위치 추출 (이전 API)"""
    M = combined.get('M', [])
    V = combined.get('V', [])
    R = combined.get('R', [])

    if not M:
        return []

    n_pts = len(M)
    x = combined.get('x', [])
    if not x or len(x) != n_pts:
        total_L = sum(spans)
        x = [i * total_L / (n_pts - 1) for i in range(n_pts)] if n_pts > 1 else [0]

    temp = BeamResult(x, M, V, R, n_pts)
    temp.V_sup_left = combined.get('V_sup_left')
    temp.V_sup_right = combined.get('V_sup_right')
    return extract_critical_locations(temp, spans, laps, supports=supports)


def _calc_deck_info(deck: dict, section: dict = None,
                    E: float = None) -> dict:
    """데크 강성 정보 계산

    through-fastened: kφ (Gao & Moen, Example II-1C 3b), kx (RP17-2, Example II-1C 3a).
    standing-seam: 자동 근사식 없음 — 시험값(override)만 쓴다 (App. A I6.2.2).
    퍼린 두께·플랜지 폭이 없으면 kφ·kx 를 0 (보수측)으로 두고 알린다.
    """
    if not deck or deck.get('type', 'none') == 'none':
        return {
            'kphi': 0, 'kx': 0, 'type': 'none',
            'kphi_method': 'not_applicable', 'kx_method': 'not_applicable',
        }

    E_val = E or E_STEEL
    dtype = deck.get('type', 'through-fastened')
    # 알림 분류 (FIXES §3.1.1). 'notes' 는 셋을 합친 이전 키, 'warning' 도 이전 키 그대로.
    d_warn, d_assume, d_scope = [], [], []
    kphi_override = deck.get('kphi_override')
    kx_override = deck.get('kx_override')
    t_purlin = (section or {}).get('thickness')
    flange_w = (section or {}).get('flange_width')

    if kphi_override is not None and kphi_override > 0:
        kphi, kphi_method = kphi_override, 'test_override'
    elif dtype == 'standing-seam':
        kphi, kphi_method = 0.0, 'not_computed_standing_seam'
        d_assume.append(_nt('loads.assumption.standing_seam_roof_no'))
    elif not t_purlin or not flange_w:
        kphi, kphi_method = 0.0, 'not_computed_missing_section'
        d_warn.append('Purlin thickness/flange width not given: deck kphi taken as 0 (conservative).')
    else:
        t_panel = deck.get('t_panel')
        kphi = calc_rotational_stiffness(
            t_panel=t_panel or 0.018, t_purlin=t_purlin,
            fastener_spacing=deck.get('fastener_spacing', 12) or 12,
            flange_width=flange_w, E=E_val,
            b_fastener=deck.get('b_fastener_in'), c_fastener=deck.get('c_fastener_in'),
        )
        kphi_method = 'gao_moen_2011_example_II_1C'
        if t_panel is not None and t_panel < 0.0179:
            d_warn.append('Panel thinner than 0.018 in.: the Gao & Moen pull-out trendline may '
                          'overpredict kphi.')
        if deck.get('b_fastener_in') is None or deck.get('c_fastener_in') is None:
            d_assume.append(_nt('loads.assumption.fastener_taken_at_mid'))

    if kx_override is not None and kx_override > 0:
        kx, kx_method = kx_override, 'test_override'
    elif dtype == 'standing-seam':
        kx, kx_method = 0.0, 'not_computed_standing_seam'
    elif not t_purlin:
        kx, kx_method = 0.0, 'not_computed_missing_section'
        d_warn.append('Purlin thickness not given: deck kx taken as 0 (conservative).')
    else:
        det = lateral_stiffness_detail(
            t_panel=deck.get('t_panel', 0.018) or 0.018, t_purlin=t_purlin,
            fastener_spacing=deck.get('fastener_spacing', 12) or 12, E=E_val,
            Fss_kip=deck.get('Fss_kip'), D_screw_in=deck.get('D_screw_in'),
            Fu1_ksi=deck.get('Fu_panel_ksi'), Fu2_ksi=(section or {}).get('Fu'),
        )
        kx = det['kx']
        kx_method = ('rp17_2_example_calibrated_approximation' if det['defaulted']
                     else 'rp17_2_curve_fit')
        if det['defaulted']:
            d_assume.append(_nt('loads.assumption.kx_fastener_shear_strength', defaulted=', '.join(det['defaulted'])))
        d_warn.extend(det['warnings'])
        d_scope.extend(det['scope_notes'])

    approx = 'override' not in kphi_method or 'override' not in kx_method
    preliminary = (_nt('loads.scope.deck_restraint_estimates_preliminary'))
    if approx:
        d_scope.insert(0, preliminary)
    return {
        'kphi': round(kphi, 4),
        'kx': round(kx, 3),
        'display_unrounded': {'kphi': float(kphi), 'kx': float(kx)},
        'type': dtype,
        'kphi_method': kphi_method,
        'kx_method': kx_method,
        'warning': preliminary if approx else None,
        'notes': d_warn + d_assume + d_scope,
        'warnings': d_warn,
        'assumptions': d_assume,
        'scope_notes': d_scope,
    }


def _extract_wc_reactions(gravity_result: dict, spans: list) -> list:
    """웹크리플링용 지점 반력 (지압 = 상향 반력만)"""
    if not gravity_result:
        return []
    wc = []
    for loc in gravity_result.get('locations', []):
        Rb = loc.get('R_bearing', loc.get('Ru'))
        if Rb is not None and Rb > 0:
            case = loc.get('wc_case') or ('EOF' if loc.get('region') == 'support_end' else 'IOF')
            wc.append({
                'name': loc['name'],
                'Pu': round(Rb, 3),
                'unrounded': {'Pu': float((loc.get('unrounded') or {}).get('R_bearing', Rb)),
                              'x_ft': (loc.get('unrounded') or {}).get('x_ft', loc.get('x_ft'))},
                'case': case,
                'x_ft': loc.get('x_ft'),
                'support': loc.get('support'),
            })
    return wc


# ---------------------------------------------------------------------------
# 경간마다 다른 단면 (2026-11-28, 결정 S1–S10)
# ---------------------------------------------------------------------------

def _resolve_span_sections(span_sections, n_spans, section):
    """경간 수만큼의 단면 dict(복사본). 'id' 가 없으면 같은 단면끼리 'S1', 'S2' … (나온 차례). Fy · Fu 가 없는 단면은
    section(없으면 첫 경간의 단면)의 값을 쓴다(재료는 하나 — 결정 S1 의 같은 템플릿). None 이면 None."""
    if span_sections is None:
        return None
    if not isinstance(span_sections, (list, tuple)) or len(span_sections) != n_spans:
        raise ValueError(f'span_sections needs {n_spans} section objects (one per span).')
    out = []
    for i, s in enumerate(span_sections):
        if not isinstance(s, dict):
            raise ValueError(f'span_sections[{i}] must be an object like section.')
        out.append(dict(s))
    mat = section or out[0]          # 재료의 출처: section, 없으면 첫 경간의 단면
    for d in out:
        for k in ('Fy', 'Fu'):
            if d.get(k) is None and mat.get(k) is not None:
                d[k] = mat[k]
    seen = []
    for d in out:
        if d.get('id') is None:
            for prev in seen:
                if _same_section(prev, d):
                    d['id'] = prev['id']
                    break
            else:
                n = 1
                used = {str(x.get('id')) for x in out if x.get('id') is not None}
                while f'S{n}' in used:
                    n += 1
                d['id'] = f'S{n}'
        else:
            d['id'] = str(d['id'])
        seen.append(d)
    return out


def _same_section(a: dict, b: dict) -> bool:
    """'id' 를 뺀 모든 키가 같은가(단면 치수 · 성질 · 재료)."""
    ka = {k: v for k, v in (a or {}).items() if k != 'id'}
    kb = {k: v for k, v in (b or {}).items() if k != 'id'}
    return ka == kb


def _sec_ixx(s: dict):
    v = (s or {}).get('Ixx') or (s or {}).get('Ix')
    return float(v) if v else None


def _span_keys(g: dict) -> dict:
    return {k: g[k] for k in ('span', 'spans') if k in g}


def _deck_once(deck, span_secs, E):
    """결정 S7′: 데크 강성 한 번 — 쓰이는 단면(나온 차례)마다 _calc_deck_info, 그 가운데 kφ 가 가장 작은 단면(같으면 kx 가
    작은 쪽, 그다음 앞의 단면)의 결과 전부를 모든 경간에. 반환: (그 데크 결과, deck_basis {rule, section_id, by_section}).
    by_section 은 단면마다의 값(참고 — 해석에 쓰지 않음)."""
    rows = []
    infos = {}
    for i, s in enumerate(span_secs):
        sid = s['id']
        if sid in infos:
            next(r for r in rows if r['section_id'] == sid)['spans'].append(i)
            continue
        di = _calc_deck_info(deck, s, E=E)
        infos[sid] = di
        rows.append({'section_id': sid, 'spans': [i], 'kphi': di['kphi'], 'kx': di['kx'],
                     'kphi_method': di['kphi_method'], 'kx_method': di['kx_method']})

    def raw(di, k):
        return float((di.get('display_unrounded') or {}).get(k, di.get(k) or 0.0))
    pick = min(range(len(rows)), key=lambda j: (raw(infos[rows[j]['section_id']], 'kphi'),
                                               raw(infos[rows[j]['section_id']], 'kx'), j))
    sid = rows[pick]['section_id']
    for j, r in enumerate(rows):
        r['adopted'] = j == pick
    return infos[sid], {'rule': 'once_smallest_kphi', 'section_id': sid,
                        'reference': 'Design Manual Example II-1C — computed once with the thinner purlin '
                                     '(conservative approximation)',
                        'by_section': rows}


def _lap_shares(span_secs, I_used, a, b):
    """랩의 두 부재(경간 a, b)의 강성 몫 [s_a, s_b] (반올림 없음) — 참고값(결정 S3′: 랩의 강도는 두 부재 강도의 합).
    I 는 해석에 쓴 경간별 Ix(I_span_in4 또는 단면의 Ixx). Ix 가 없고 두 단면이 같으면 [0.5, 0.5], 아니면 None."""
    Ia = I_used[a] if I_used else None
    Ib = I_used[b] if I_used else None
    if Ia and Ib:
        return [Ia / (Ia + Ib), Ib / (Ia + Ib)], Ia, Ib
    if _same_section(span_secs[a], span_secs[b]):
        return [0.5, 0.5], Ia, Ib
    return None, Ia, Ib


def _lap_member_sections(r: dict, span_secs, I_used) -> None:
    """랩 구간 기록(tag_region_spans 가 lap_members 를 단 것)에 두 부재의 단면 · Ix · 강성 몫(참고)을 단다.
    결정 S3′: 랩의 판정은 두 부재 강도의 합(strength_basis) — 강도는 부재 검토가 내므로 여기에는 그 근거만."""
    mem = r.get('lap_members')
    if not mem:
        return
    a, b = mem[0]['span'], mem[1]['span']
    shares, Ia, Ib = _lap_shares(span_secs, I_used, a, b)
    for m, s, I, k in ((mem[0], span_secs[a], Ia, 0), (mem[1], span_secs[b], Ib, 1)):
        m['section_id'] = s['id']
        m['Ixx'] = I
        m['depth'] = s.get('depth')
        m['thickness'] = s.get('thickness')
        m['stiffness_share'] = shares[k] if shares else None
    da, db = span_secs[a].get('depth'), span_secs[b].get('depth')
    mismatch = bool(da and db and abs(float(da) - float(db)) > 1e-6 * max(float(da), float(db)))
    r['Ixx_members'] = [Ia, Ib]
    r['share_by_stiffness'] = shares
    r['strength_basis'] = 'sum_of_strengths'    # Design Manual II-1A · II-2A 가정 (c) — 결정 S3′
    r['reference_basis'] = 'stiffness_share'    # 강성 몫 I_i / (I_1 + I_2) — 참고값(판정에 쓰지 않음)
    r['same_section'] = _same_section(span_secs[a], span_secs[b])
    r['depth_mismatch'] = mismatch
    r['lap_evaluable'] = not mismatch
    if mismatch:
        r['not_evaluable_reason'] = _nt('loads.reason.lap_depth_mismatch', d_left=float(da), d_right=float(db))


def _uplift_positive_pieces(ubu, lap_regions, geo, span_secs, I_used):
    """양력의 상부 압축(데크 지지) 구간을 중력 해석의 랩 구간 끝에서 자른 조각 — 호스트가 _designPurlin 에서
    자르는 것과 같은 규칙(구간 안쪽에 든 lap_regions 의 start_ft · end_ft, 반올림 전 값에서; 1e-6 ft 보다 짧은 조각은
    버림). 조각마다 기하만(M 은 호스트가 포락선에서): source_index(ubu.positive_regions 의 자리), start_ft, end_ft,
    in_lap, span, spans, crosses_support, 랩 안이면 lap_support · lap_side · lap_members · share_by_stiffness."""
    def unr(r, k):
        u = r.get('unrounded') or {}
        return float(u.get(k, r.get(k)))

    zones = sorted((unr(z, 'start_ft'), unr(z, 'end_ft')) for z in lap_regions
                   if unr(z, 'end_ft') > unr(z, 'start_ft'))
    out = []
    for si, r in enumerate(ubu.get('positive_regions') or []):
        a0, a1 = unr(r, 'start_ft'), unr(r, 'end_ft')
        cuts = [a0, a1]
        for z0, z1 in zones:
            if a0 < z0 < a1:
                cuts.append(z0)
            if a0 < z1 < a1:
                cuts.append(z1)
        xs = sorted(set(cuts))
        for s0, s1 in zip(xs[:-1], xs[1:]):
            if s1 - s0 < 1e-6:
                continue
            mid = 0.5 * (s0 + s1)
            in_lap = any(z0 < mid < z1 for z0, z1 in zones)
            info = interval_spans(geo, s0, s1)
            p = {'source_index': si, 'start_ft': s0, 'end_ft': s1, 'in_lap': in_lap,
                 'span': info['span'], 'spans': info['spans'], 'crosses_support': info['crosses_support']}
            lm = lap_region_members(geo, s0, s1) if in_lap else None
            if lm is not None:
                p['spans'] = [lm['members'][0]['span'], lm['members'][1]['span']]
                p['lap_support'] = lm['lap_support']
                p['lap_side'] = lm['lap_side']
                p['continuous_member_span'] = lm['continuous_member_span']
                p['ending_member_span'] = lm['ending_member_span']
                p['lap_members'] = lm['members']
                _lap_member_sections(p, span_secs, I_used)
            out.append(p)
    return out


def _i621_by_span(span_secs, section, spans, sup, deck, lap_in, lap_d, confirmed, insulation_in, secs_differ):
    """§I6.2.1 을 경간마다 그 경간의 단면으로. 반환: (기록 목록, 옛 i621_check 로 낼 경간). 기록: span, section_id,
    real_span, R(그 단면으로 본 오늘의 규칙 — 경간 R 의 최솟값, 내민 경간은 None), R_own_span(그 경간의
    R_per_span), all_pass, check(검토 전체). (g) 는 sections 가 다를 때만 랩마다의 d(겹친 두 부재 깊이의 큰 값)로."""
    n = len(spans)
    rows = []
    for i, s in enumerate(span_secs):
        res = check_i621_conditions(
            section=s, Fy=s.get('Fy', (section or {}).get('Fy')), Fu=s.get('Fu', (section or {}).get('Fu')),
            span_ft=max(spans), span_type='continuous' if n > 1 else 'simple',
            lap_lengths_in=lap_in or None, spans_ft=spans, supports=sup, deck=deck,
            system_confirmed=confirmed, insulation_in=insulation_in,
            lap_depths_in=(lap_d if (secs_differ and lap_in) else None))
        real = not (sup[i] == 'N' or sup[i + 1] == 'N')
        rows.append({'span': i, 'section_id': s['id'], 'real_span': real,
                     'R': res.get('R') if real else None,
                     'R_own_span': res['R_per_span'][i] if res.get('all_pass') else None,
                     'all_pass': res['all_pass'], 'check': res})
    real_rows = [r for r in rows if r['real_span']] or rows
    fail = [r for r in real_rows if r['R'] is None]
    gi = fail[0]['span'] if fail else min(real_rows, key=lambda r: (r['R'], r['span']))['span']
    return rows, gi


def _span_map(geo, span_secs, I_used, sec_I):
    """경간 · 랩의 자리와 그 단면(호스트가 자른 조각의 경간을 찾을 때 — 가운데 x 가 놓인 경간, 랩 안이면 그 랩의
    두 부재). 모든 번호는 0 부터, 길이는 ft."""
    laps = []
    for lp in geo['laps']:
        a, b = lp['spans']
        shares, Ia, Ib = _lap_shares(span_secs, I_used, a, b)
        da, db = span_secs[a].get('depth'), span_secs[b].get('depth')
        laps.append({**lp, 'section_ids': [span_secs[a]['id'], span_secs[b]['id']], 'Ixx_members': [Ia, Ib],
                     'stiffness_shares': shares, 'depths': [da, db], 'same_section': _same_section(span_secs[a], span_secs[b]),
                     'depth_mismatch': bool(da and db and abs(float(da) - float(db)) > 1e-6 * max(float(da), float(db)))})
    return {
        'supports_ft': geo['supports_ft'],
        'spans': [{**sp, 'section_id': span_secs[sp['span']]['id'],
                   'Ixx_section': sec_I[sp['span']] if sec_I else None,
                   'Ixx_used': I_used[sp['span']] if I_used else None,
                   'depth': span_secs[sp['span']].get('depth'),
                   'thickness': span_secs[sp['span']].get('thickness')} for sp in geo['spans']],
        'laps': laps,
        'rule': 'span of x: the span whose [start_ft, end_ft] holds x (a support x belongs to both neighbours); '
                'inside laps[k] (start_ft < x < end_ft) both members laps[k].spans are present. Indices are 0-based.',
    }


__all__ = ['analyze_loads', 'find_controlling_combo']
