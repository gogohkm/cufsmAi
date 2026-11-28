"""Lap Splice Connection Design (AISI S100 Chapter J)

패스너 강도: Chapter J (볼트 J3·App. A J3.4, 나사 J4, 파단 J6.1) — design.connections 공유 엔진.
패스너 힘 분배: 기준 조항이 아니라 사내 합리적 해석(§A1.2(c))이다 — 결과의 force_model 참고.
랩 길이 1.5d: §I6.2.1(g)(R 계수법 적용 조건)·§J3(겹친 Z 부재의 과대·슬롯 구멍 예외 조건).
"""

import math
from design.connections import design_connection, normalize_design_method
from design.checks import display_rounding as _display_rounding
from design.notices import N as _nt, attach as _attach_notices, prefixed as _prefixed  # noqa: E402

# 패스너 수요 모델 설명(결과·steps 에 그대로 싣는다). 모델을 바꾸는 것은 사용자 결정 사항이다.
FORCE_MODEL = {
    'basis': 'in_house_rational_analysis',
    'clause': _nt('lap.label.force_model_clause'),
    'specification_provision': False,
    'description': _nt('lap.label.force_model_description'),
    'user_decision_pending': True,
    'known_limitations': [_nt('lap.label.force_model_limit_a'), _nt('lap.label.force_model_limit_b'),
                          _nt('lap.label.force_model_limit_c'), _nt('lap.label.force_model_limit_d'),
                          _nt('lap.label.force_model_limit_e')],
}


def _precise(a, b, fmt, ratio=None, rfmt=None):
    """단언한 a > b 가 보이는 자리로 같은 글이 되면(83.29 > 83.29) 더 긴 자리의 판 code 를 쓴다(V9a-06 ⑦)."""
    tie = format(a, fmt) == format(b, fmt) or (ratio is not None and format(ratio, rfmt) == format(1.0, rfmt))
    return '_precise' if tie else ''


def design_lap_connection(params: dict) -> dict:
    """Lap 접합부 설계

    Args:
        params: {
            d: 부재 높이 (in)
            t: 두께 (in)
            Fy: 항복강도 (ksi)
            Fu: 인장강도 (ksi)
            lap_left_in: 좌측 Lap 길이 (in)
            lap_right_in: 우측 Lap 길이 (in)
            Mu_support: 지점 모멘트 (kip-in)
            Vu_support: 지점 전단력 (kips)
            fastener_type: 'screw' | 'bolt'
            fastener_dia: 패스너 직경 (in)
            n_rows: 패스너 행 수 (기본 2)
            end_distance: 패스너 끝단 거리 (in, ≥ 1.5d)
            design_method: 'LRFD' | 'ASD' (대소문자 무관, LSD·기타는 오류)
            Pnvs: 나사 전단 공칭강도(제조사 값, kips/개) — 나사일 때
            Fub, bolt_grade: 볼트 강도 — 볼트일 때 (없으면 A307 가정)
            Se, Mnd, Vn, h_web: Lap 구간 휨·뒤틀림·H2 검토용
            lap_restrained: True 면 사람이 Design Manual II-1A / II-2A 의 가정('겹친 부분은 횡비틀림 · 뒤틀림 좌굴에
                충분히 구속됨')을 밝힘 — 랩 휨 Mnℓ = Se·Fy(횡비틀림 없음)와 §F4 해당 없음(Mnd 가 없을 때)이 그
                가정에 선다. 없으면 그 두 검토는 미평가(판정 None). distortion_restrained 는 같은 뜻의 옛 이름(별칭)
            lap_force_model_confirmed: True 면 사람이 패스너 힘 분배 모델 A(모든 패스너가 max(Mu/(d−t), Vu) 를 고르게
                나눔 — 자체 가정)를 받아들임 — 패스너 무리 용량 · 필요 개수의 판정을 낸다. 없거나 False 면 A 로도 넘을
                때만 불합격, 아니면 그 두 검토는 판정 없음(수는 참고값). 결정 R2(2026-11-25)
        }

    Returns:
        dict: 설계 결과. pass 는 True/False/None(검토 미완), verdict 는 PASS/FAIL/NOT_CHECKED.
    """
    try:
        design_method = normalize_design_method(params.get('design_method', 'LRFD'))
    except ValueError as exc:
        return {'error': str(exc)}
    d = params.get('d', 8.0)
    t = params.get('t', 0.059)
    # 모재 Fy · Fu 는 패스너 지압 · 랩 휨의 기준이다 — 기본 강종으로 채우지 않는다.
    Fy = params.get('Fy')
    Fu = params.get('Fu')
    for _name, _v in (('Fy', Fy), ('Fu', Fu)):
        if not (isinstance(_v, (int, float)) and not isinstance(_v, bool) and _v > 0):
            return {'error': f'{_name} (member steel, ksi) is required and must be > 0.'}
    lap_left = params.get('lap_left_in', 0) or 0
    lap_right = params.get('lap_right_in', 0) or 0
    Mu = abs(params.get('Mu_support', 0) or 0)
    Vu = abs(params.get('Vu_support', 0) or 0)
    # 랩 검토에는 지점 소요가 필요하다(계약 §6.3, V9a-02): 없으면 0 이 아니라 「미입력」, 0 은 밝혔을 때만 0.
    _zero_stated = params.get('zero_demand_stated') is True
    demand_missing = [k for k in ('Mu_support', 'Vu_support') if params.get(k) is None]
    demand_zero_unstated = [k for k in ('Mu_support', 'Vu_support')
                            if params.get(k) is not None and abs(params.get(k) or 0) == 0 and not _zero_stated]
    fastener_type = params.get('fastener_type', 'screw')
    fastener_dia = params.get('fastener_dia', 0.19)  # #10 screw = 0.190 in
    n_rows = params.get('n_rows', 2)

    steps = []
    warnings = []
    # 두 번째 부재(2026-11-28, 결정 S4 · S5): *_2 입력이 하나라도 있으면 겹친 두 부재가 다를 수 있다
    two = _second_member(params, d, t, Fy)
    extra_assumptions = []
    if two is not None:
        extra_assumptions.append(_nt('lap.assumption.two_members'))
        if two['defaulted']:
            extra_assumptions.append(_nt('lap.assumption.member2_taken_equal', keys=', '.join(two['defaulted'])))

    # Step 1: Lap 길이 (§I6.2.1(g) "in each direction")
    lap_chk = check_lap_length(d if two is None else max(d, two['d']), lap_left, lap_right)
    min_lap = lap_chk['min_lap_in']
    lap_each = lap_chk['actual_in']
    lap_ok = lap_chk['ok']
    steps.append({
        'step': 1, 'name': 'Lap Length Check (§I6.2.1(g), §J3 lapped-Z exception)',
        'value': round(lap_each, 2), 'unit': 'in',
        'formula': (f'Lap = min(좌,우) = {lap_each:.2f} in {"≥" if lap_ok else "<"} 1.5d = {min_lap:.2f} in'
                    if lap_ok is not None else lap_chk['message']),
        'pass': lap_ok,
    })
    if lap_chk['message']:
        warnings.append(lap_chk['message'])

    # Step 2: 전달 전단력 — 사내 합리적 해석(§A1.2(c)), 기준 조항 아님. 모델 변경은 사용자 결정.
    d_lever = (d - t) if (d - t) > 0 else d
    arm_member = 1
    if two is not None:
        # 결정 S5: 우력의 팔은 불리한 쪽(작은 d − t — 전달력이 큰 쪽)
        arm2 = (two['d'] - two['t']) if (two['d'] - two['t']) > 0 else two['d']
        if arm2 < d_lever:
            d_lever, arm_member = arm2, 2
    if Mu > 0 and d_lever > 0:
        V_flange = Mu / d_lever
        V_transfer = max(V_flange, Vu)
        v2_formula = (
            f'V_transfer = max(Mu/(d-t), Vu) = '
            f'max({Mu:.2f}/{d_lever:.3f}, {Vu:.3f}) = '
            f'max({V_flange:.3f}, {Vu:.3f}) = {V_transfer:.3f} kips '
            f'[사내 합리적 해석 §A1.2(c) — 기준 조항 아님]'
        )
    else:
        V_transfer = Vu
        v2_formula = f'V_transfer = Vu = {Vu:.3f} kips [사내 합리적 해석 §A1.2(c) — 기준 조항 아님]'
    steps.append({
        'step': 2, 'name': 'Transfer Shear Force (in-house rational analysis, §A1.2(c) — not a spec provision)',
        'value': round(V_transfer, 3), 'unit': 'kips',
        'formula': v2_formula,
    })
    warnings.append(_nt('lap.warning.a1_2_lap_step_a1_force'))

    # 끝단 거리 (§J3.2 볼트 / §J4.2 나사: ≥ 1.5d). 사용자 값은 그대로 엔진에 넘긴다 —
    # 1.5d 보다 짧으면 엔진의 J3.2/J4.2 검사가 불합격을 낸다(조용히 올리지 않는다).
    edge_min = 1.5 * fastener_dia
    edge_user = params.get('end_distance') or 0
    edge_dist = edge_user if edge_user > 0 else edge_min
    if 0 < edge_user < edge_min:
        warnings.append(
            _nt('lap.warning.j3_2_j3_j4', edge_user=edge_user, edge_min=edge_min)
        )
    elif edge_user <= 0:
        warnings.append(_nt('lap.warning.j6_1_end_distance_j6', edge_min=edge_min))

    # Step 3: 패스너 1개 설계강도 — 전단 방향 한계상태(지압·틸팅·패스너 전단·J6.1 끝단 파단)
    conn_type = 'screw' if fastener_type == 'screw' else 'bolt'
    cparams = {
        'connection_type': conn_type,
        'design_method': design_method,
        'Fy': Fy, 'Fu': Fu, 't1': t, 't2': t,
        'd': fastener_dia, 'n': 1, 'Pu': 0,
        'e': edge_dist,
    }
    for k in ('Pnvs', 'Fub', 'bolt_grade', 'threads_excluded', 'mf', 'hole_type'):
        if params.get(k) is not None:
            cparams[k] = params[k]
    orientations = [(t, t, None)]
    if two is not None:
        # 결정 S5: 두 판의 두께가 다르면 두 놓임(어느 판이 나사 머리 쪽인지)을 모두 보고 작은 Pns — 얇은 판이 지압 ·
        # 틸팅을 정한다. 같으면 한 번(오늘과 같다)
        orientations = [(t, two['t'], {'t1': 't', 't2': 't_2'})]
        if abs(two['t'] - t) > 1e-12:
            orientations.append((two['t'], t, {'t1': 't_2', 't2': 't'}))
    best = None
    for (t1_, t2_, keymap) in orientations:
        cp = dict(cparams, t1=t1_, t2=t2_)
        cr = design_connection(cp)
        if cr.get('error'):
            return cr
        _rekey_fastener_sources(cr.get('design_checks') or [], keymap)
        got = _fastener_pns(cr)
        if best is None or got[0] < best[1][0] - 1e-12:
            best = ((t1_, t2_), got, cr)
    (fast_t1, fast_t2), (Pns, pns_mode, pns_assumed), conn_result = best
    fastener_unverified = [x for x in conn_result.get('not_evaluated', [])
                           if x.get('category') in ('fastener', 'scope')
                           and x.get('direction') in ('shear', 'any')]
    fastener_ok = None if fastener_unverified else True
    for x in fastener_unverified:
        warnings.append(_nt('lap.warning.fastener_strength_unsettled', name=x['name'], reason=x['reason']))
    detail_fail = [x for x in conn_result.get('detailing_checks', []) if not x['pass']]
    if detail_fail:
        fastener_ok = False
        for x in detail_fail:
            warnings.append(_nt('lap.warning.detail_fails', name=x['name'], provided=x['provided'], required=x['required']))
    if pns_assumed:
        warnings.append(_nt('lap.warning.pns_from_assumed_limit_state', pns_mode=pns_mode))
    # 이름표의 숫자(계약 §16.6, K4b): 글은 그대로, 옆에 템플릿과 물리량 붙은 값을 싣는다.
    _d_param = {'symbol': 'd', 'value': fastener_dia, 'quantity': 'length', 'fmt': '.3f', 'unit_text': 'in', 'sep': ' '}
    if fastener_type == 'screw':
        _gauge = _screw_gauge(fastener_dia)
        fastener_label = f'Screw #{_gauge}'
        fastener_label_parts = {'template': 'Screw #{gauge}', 'template_ko': '나사 #{gauge}',
                                'params': [{'symbol': 'gauge', 'value': _gauge, 'quantity': None, 'fmt': ''}],
                                'values': [_d_param]}
    else:
        fastener_label = f'Bolt d={fastener_dia:.3f} in'
        fastener_label_parts = {'template': 'Bolt d={d}', 'template_ko': '볼트 d={d}', 'params': [_d_param],
                                'values': []}

    steps.append({
        'step': 3, 'name': f'Fastener Strength ({fastener_label})',
        'value': round(Pns, 3), 'unit': 'kips',
        'formula': (
            f'Pdesign = {Pns:.3f} kips/ea — 지배: {pns_mode} '
            f'(전단 방향: 지압·틸팅·패스너 전단·J6.1 끝단 파단(e={edge_dist:.3f} in); '
            f'인장 방향 J4.4·부재 J6.2/J6.3/D 제외)'
        ),
        'pass': fastener_ok,
    })

    # Step 4: 필요 패스너 수 (사내 모델: 균등 분담)
    if Pns > 0:
        n_required = math.ceil(V_transfer / Pns)
        n_per_row = math.ceil(n_required / n_rows)
        n_total = n_per_row * n_rows
    else:
        n_required = 0
        n_per_row = 0
        n_total = 0
        warnings.append(_nt('lap.warning.fastener_strength_zero'))

    steps.append({
        'step': 4, 'name': 'Required Fasteners (in-house uniform-share model)',
        'value': n_total, 'unit': 'ea',
        'formula': f'n = V/Pdesign = {V_transfer:.3f}/{Pns:.3f} = {n_required} → {n_rows} rows × {n_per_row}/row = {n_total} ea'
            if Pns > 0 else 'N/A',
    })

    # Step 5: 배치 가능 최대 패스너 수 — 양 끝 끝단거리 2e 가 들어가야 1개라도 배치된다.
    min_spacing = 3 * fastener_dia
    if lap_each > 0 and min_spacing > 0:
        if lap_each < 2 * edge_dist:
            n_max_per_row = 0
            warnings.append(_nt('lap.warning.lap_shorter_than_2e', lap_each=lap_each, value=2 * edge_dist))
        else:
            n_max_per_row = int((lap_each - 2 * edge_dist) / min_spacing) + 1
    else:
        n_max_per_row = n_per_row
    n_max_total = n_max_per_row * n_rows

    n_per_row_actual = min(n_per_row, n_max_per_row)
    n_total_actual = n_per_row_actual * n_rows
    if n_per_row_actual > 1 and lap_each > 0:
        spacing = (lap_each - 2 * edge_dist) / (n_per_row_actual - 1)
    else:
        spacing = 0
    spacing_ok = spacing >= min_spacing if spacing > 0 else True

    steps.append({
        'step': 5, 'name': 'Fastener Spacing & Layout',
        'value': round(spacing, 2), 'unit': 'in',
        'formula': (
            f'Required: {n_total} ea, Max fit: {n_max_total} ea '
            f'(Lap={lap_each:.2f} in, edge={edge_dist:.3f} in, min s=3d={min_spacing:.2f} in), '
            f's = {spacing:.2f} in {"≥" if spacing_ok else "<"} {min_spacing:.2f} in'
        ),
        'pass': spacing_ok and n_total <= n_max_total,
    })

    if n_total > n_max_total:
        warnings.append(
            _nt('lap.warning.fasteners_do_not_fit', n_total=n_total, n_max_total=n_max_total)
        )
    if not spacing_ok:
        warnings.append(_nt('lap.warning.fastener_spacing_below_3d', spacing=spacing, min_spacing=min_spacing))

    # Step 6: 끝단 거리 (J6.1 끝단 파단은 Step 3 에 이미 포함)
    steps.append({
        'step': 6, 'name': 'Edge/End Distance (§J3.2 / §J4.2)',
        'value': round(edge_dist, 3), 'unit': 'in',
        'formula': (
            f'e = {edge_dist:.3f} in (사용자 지정, 최소 1.5d = {edge_min:.3f} in 충족)'
            if edge_user > edge_min else
            f'e = 1.5d = 1.5 × {fastener_dia:.3f} = {edge_dist:.3f} in (최소값 가정)'
        ) + ' — §J6.1 끝단 파단은 이 e 로 Step 3 에서 평가',
    })

    # Step 7: 용량 검증 (Demand vs Capacity)
    capacity = n_total_actual * Pns if Pns > 0 else 0
    utilization = V_transfer / capacity if capacity > 0 else float('inf')
    capacity_ok = utilization <= 1.0

    steps.append({
        'step': 7, 'name': 'Demand vs Capacity',
        'value': round(utilization, 3), 'unit': '',
        'formula': (
            f'Capacity = {n_total_actual} ea × {Pns:.3f} kips = {capacity:.3f} kips, '
            f'DCR = V_transfer / Capacity = {V_transfer:.3f} / {capacity:.3f} = {utilization:.3f}'
            if capacity > 0 else 'Capacity = 0'
        ),
        'pass': capacity_ok,
    })

    # Step 8: Lap 구간 휨강도 검토 (AISI §F — 2겹 부재 합산)
    # Lap 구간은 횡지지(인접 부재로 구속)되어 LTB(전체좌굴)는 지배하지 않는다.
    # Mnl_single = Se × Fy 는 유효 단면계수(Se)에 의해 이미 *국부좌굴*을 반영한다.
    # 따라서 본 식에서 누락된 모드는 (a) 뒤틀림좌굴(distortional, §F4)과
    # (b) 지점부 휨-전단 상호작용(§H2)이며, 아래에서 별도로 처리한다.
    # Mn_lap = Se × Fy × 2 (동일 단면 2겹, AISI Example II-2A 방식)
    # Se(유효 단면계수)만 판정 근거다. 총단면 Sf 는 국부좌굴을 반영하지 않아 Mnl 을 과대평가하므로
    # Se 대신 쓰지 않는다 — Sf 만 있으면 참고값(assumed)으로만 보이고 휨은 미평가(FIXES §3.1).
    Se = params.get('Se') or 0
    Sf_only = params.get('Sf') or 0
    from design.aisi_s100 import lap_restraint_stated
    lap_stated = lap_restraint_stated(params)

    # §H2 검토용 전단강도 Vn: 미입력이면 §G2.1(비보강 웹)로 직접 산정한다 —
    # 본 도구는 d, t, Fy를 이미 보유하므로 외부 입력에 의존할 이유가 없다.
    Vn_in = params.get('Vn')
    vn_auto = False
    if not (Vn_in and Vn_in > 0):
        from design.shear import shear_strength
        h_web = params.get('h_web') or max(d - 2.0 * t, 0.0)
        _sres = shear_strength(h_web, t, Fy)
        if _sres['Vn'] > 0:
            Vn_in = _sres['Vn']
            vn_auto = True
            steps.append({
                'step': '8p', 'name': 'Vn 자동산정 (§G2.1, 비보강 웹)',
                'value': round(Vn_in, 3), 'unit': 'kips',
                'formula': (
                    f'h = d-2t = {h_web:.3f} in, λv = {_sres["lambda_v"]:.3f} → '
                    f'{_sres["equation"]}, Vn = {Vn_in:.3f} kips'
                ),
            })

    Vn2_in, vn2_auto = None, False
    two_flex_missing = None
    if two is not None:
        Vn2_in = two['Vn']
        if not (Vn2_in and Vn2_in > 0):
            from design.shear import shear_strength
            _sres2 = shear_strength(two['h_web'] or max(two['d'] - 2.0 * two['t'], 0.0), two['t'], Fy)
            if _sres2['Vn'] > 0:
                Vn2_in, vn2_auto = _sres2['Vn'], True
        if Mu > 0 and Se > 0 and not two['Se']:
            # 결정 S3′: 랩의 강도는 두 부재 강도의 합 — 부재 2 의 Se 가 없으면 판정 없음(강성 몫은 참고라 없어도 된다)
            two_flex_missing = _nt('lap.reason.member2_value_missing', key='Se_2')

    _flex = {}   # 계산서(design_checks) 재료 — 아래 휨 검토가 쓴 값
    flexure_ok = True
    flexure_dcr = None
    flexure_reference_dcr = None
    flexure_dcr_governing = None  # 국부/뒤틀림/H2 중 최대 DCR (헤드라인 표시용)
    Mn_lap = 0
    phi_Mn_lap = 0

    if Se > 0 and Fy > 0 and Mu > 0 and not two_flex_missing:
        Mnl_single = Se * Fy  # kip-in
        n_members = 2
        Mn_lap = Mnl_single * n_members  # kip-in
        two_local = None
        if two is not None:
            # 결정 S3′(2026-11-28 오후): 랩의 강도 = 두 부재 강도의 합 Mn,lap = Mnℓ,1 + Mnℓ,2 (설계 매뉴얼 II-1A · II-2A 의
            # 가정 (c)). 같은 두 부재면 2 Mnℓ — 오늘과 같다. 강성 몫(s_i = I_i / ΣI)으로 본 min_i(Mnℓ,i / s_i) 는 참고값.
            sh = two['shares']
            Mnl_m = [Se * Fy, two['Se'] * Fy]
            Mn_lap = Mnl_m[0] + Mnl_m[1]
            Mnl_single = Mnl_m[0]
            stiff = None
            if sh:
                cand = [Mnl_m[0] / sh[0], Mnl_m[1] / sh[1]]
                gm = 0 if cand[0] <= cand[1] else 1
                stiff = dict(shares=sh, Mn_member=cand, governing_member=gm + 1, Mn_lap=cand[gm])
            two_local = dict(Mnl=Mnl_m, Se=[Se, two['Se']], Mn_sum=Mn_lap, stiffness=stiff)

        if design_method == 'LRFD':
            phi_b = 0.90
            phi_Mn_lap = phi_b * Mn_lap
            flexure_dcr = Mu / phi_Mn_lap if phi_Mn_lap > 0 else float('inf')
        else:  # ASD
            omega_b = 1.67
            phi_Mn_lap = Mn_lap / omega_b
            flexure_dcr = Mu / phi_Mn_lap if phi_Mn_lap > 0 else float('inf')

        flexure_ok = flexure_dcr <= 1.0
        # Mnℓ = Se·Fy 는 Fn = Fy(횡비틀림 없음)다 — Manual 의 가정에 선다(계약 §6.3). 밝히지 않았으면 판정 없음
        # (불합격은 그대로: 가정 없이 강도는 더 작아질 뿐이다).
        if not lap_stated:
            _flex['ltb_unstated'] = True
            if flexure_ok:
                flexure_ok = None
                warnings.append(_nt('lap.warning.lap_mn_se_fy'))
        flexure_dcr_governing = flexure_dcr
        _flex['local'] = dict(Mnl_single=Mnl_single, Mn_lap=Mn_lap, phi_Mn_lap=phi_Mn_lap, dcr=flexure_dcr,
                              ok=flexure_ok, n_members=n_members)
        if two_local is not None:
            _st = two_local['stiffness']
            if _st is not None:
                _st['phi_Mn_lap'] = 0.90 * _st['Mn_lap'] if design_method == 'LRFD' else _st['Mn_lap'] / 1.67
                _st['dcr'] = Mu / _st['phi_Mn_lap'] if _st['phi_Mn_lap'] > 0 else None
            _flex['local']['two'] = two_local

        if two_local is None:
            steps.append({
                'step': 8, 'name': 'Lap Flexural Strength (§F, 2-member sum; local incl., distortional excl.)',
                'value': round(flexure_dcr, 3), 'unit': '',
                'formula': (
                    f'Se = {Se:.4f} in³, Mnl = Se×Fy = {Se:.4f}×{Fy:.2f} = {Mnl_single:.2f} kip-in, '
                    f'Mn_lap = {n_members}×{Mnl_single:.2f} = {Mn_lap:.2f} kip-in, '
                    f'{"φ" if design_method == "LRFD" else "1/Ω"}Mn = {phi_Mn_lap:.2f} kip-in, '
                    f'Mu = {Mu:.2f} kip-in, DCR = {flexure_dcr:.3f}'
                ),
                'pass': flexure_ok,
            })
        else:
            _m, _st = two_local['Mnl'], two_local['stiffness']
            steps.append({
                'step': 8, 'name': 'Lap Flexural Strength (§F, sum of the two members — Design Manual II-1A / II-2A (c))',
                'value': round(flexure_dcr, 3), 'unit': '',
                'formula': (
                    f'Mnl1 = Se×Fy = {Se:.4f}×{Fy:.2f} = {_m[0]:.2f}, Mnl2 = Se_2×Fy = {two["Se"]:.4f}×{Fy:.2f} = '
                    f'{_m[1]:.2f} kip-in, Mn_lap = Mnl1 + Mnl2 = {Mn_lap:.2f} kip-in, '
                    f'{"φ" if design_method == "LRFD" else "1/Ω"}Mn = {phi_Mn_lap:.2f} kip-in, '
                    f'Mu = {Mu:.2f} kip-in, DCR = {flexure_dcr:.3f}'
                ) + (f' [reference only — stiffness shares s1 = {_st["shares"][0]:.4f}, s2 = {_st["shares"][1]:.4f}: '
                     f'min(Mnl1/s1, Mnl2/s2) = {_st["Mn_lap"]:.2f} kip-in (member {_st["governing_member"]}), '
                     f'DCR = {_st["dcr"]:.3f}]' if _st is not None else ''),
                'pass': flexure_ok,
            })
        if flexure_ok is False:      # None(진술 없음 · 판정 없음)은 부족이 아니다 — 2026-11-24 K4f
            warnings.append(
                _nt('lap.warning.lap_mu_mn_dcr' + _precise(Mu, phi_Mn_lap, '.2f', flexure_dcr, '.2f'), Mu=Mu,
                    text="φ" if design_method == "LRFD" else "",
                    omega='' if design_method == 'LRFD' else '/Ω', phi_Mn_lap=phi_Mn_lap, flexure_dcr=flexure_dcr)
            )

        # 뒤틀림좌굴(§F4) 검토 — 구간 설계와 같은 계약(§6.3, V8-01): 진술이 있으면 준 Mnd 와 무관하게 해당 없음
        # (Manual 의 읽기: 랩 안에서 Mnd = My). 진술이 없으면 Mnd 를 주면 평가, 없으면 판정 없음.
        # 주: S100-16 에서 뒤틀림은 국부/전체와 동일한 계수(φ_b=0.90 / Ω_b=1.67)를 사용한다.
        Mnd_single = params.get('Mnd') or params.get('Mnd_single')
        if lap_stated:
            _flex['dist_restrained'] = True
            if Mnd_single and Mnd_single > 0:
                _flex['dist_ignored'] = Mnd_single
                warnings.append(_nt('lap.warning.mnd_not_used_lap_restrained', Mnd_single=Mnd_single))
            warnings.append(
                _nt('lap.warning.f4_f4_lap_restrained_true')
            )
        elif Mnd_single and Mnd_single > 0 and two is not None and not two['Mnd']:
            # 두 부재가 다른데 Mnd_2 가 없다 — 뒤틀림은 판정 없음(부재 1 의 값을 쓰지 않는다)
            flexure_ok = None if flexure_ok else flexure_ok
            _flex['dist_missing'] = True
            _flex['dist_missing_reason'] = _nt('lap.reason.member2_value_missing', key='Mnd_2')
            warnings.append(_nt('lap.warning.member2_value_missing', key='Mnd_2'))
        elif Mnd_single and Mnd_single > 0:
            Mnd_lap = Mnd_single * n_members
            if two is not None:
                # 결정 S3′: 두 부재 강도의 합(같은 두 부재면 2 Mnd — 오늘과 같다). 강성 몫의 값은 참고
                _dm = [Mnd_single, two['Mnd']]
                Mnd_lap = _dm[0] + _dm[1]
                _dst = None
                if two['shares']:
                    _cd = [_dm[0] / two['shares'][0], _dm[1] / two['shares'][1]]
                    _gd = 0 if _cd[0] <= _cd[1] else 1
                    _dst = dict(shares=two['shares'], Mn_member=_cd, governing_member=_gd + 1, Mnd_lap=_cd[_gd])
                _flex['dist_two'] = dict(Mnd=_dm, Mnd_sum=Mnd_lap, stiffness=_dst)
            if design_method == 'LRFD':
                phi_Mnd_lap = 0.90 * Mnd_lap
            else:
                phi_Mnd_lap = Mnd_lap / 1.67
            dist_dcr = Mu / phi_Mnd_lap if phi_Mnd_lap > 0 else float('inf')
            dist_ok = dist_dcr <= 1.0
            _flex['dist'] = dict(Mnd_single=Mnd_single, Mnd_lap=Mnd_lap, phi_Mnd_lap=phi_Mnd_lap, dcr=dist_dcr,
                                 ok=dist_ok)
            flexure_ok = _and3(flexure_ok, dist_ok)
            flexure_dcr_governing = max(flexure_dcr_governing or 0, dist_dcr)
            steps.append({
                'step': '8a', 'name': 'Lap Distortional Flexural Strength (§F4, 2-member sum)',
                'value': round(dist_dcr, 3), 'unit': '',
                'formula': ((
                    f'Mnd = {Mnd_single:.2f} kip-in, Mnd_lap = {n_members}×Mnd = {Mnd_lap:.2f} kip-in, '
                    f'{"φ" if design_method == "LRFD" else "1/Ω"}Mnd = {phi_Mnd_lap:.2f} kip-in, '
                    f'DCR = {dist_dcr:.3f}'
                ) if 'dist_two' not in _flex else (
                    f'Mnd1 = {_flex["dist_two"]["Mnd"][0]:.2f}, Mnd2 = {_flex["dist_two"]["Mnd"][1]:.2f} kip-in, '
                    f'Mnd_lap = Mnd1 + Mnd2 = {Mnd_lap:.2f} kip-in (sum of strengths), '
                    f'{"φ" if design_method == "LRFD" else "1/Ω"}Mnd = {phi_Mnd_lap:.2f} kip-in, '
                    f'DCR = {dist_dcr:.3f}'
                )),
                'pass': dist_ok,
            })
            if not dist_ok:
                warnings.append(
                    _nt('lap.warning.f4_lap_f4_dcr', dist_dcr=dist_dcr)
                )
        else:
            # 구속을 엔진이 가정하지 않는다(V6-07): 해당하는데 평가하지 못한 한계상태 → 판정 없음(FIXES §3.1).
            flexure_ok = None if flexure_ok else flexure_ok
            _flex['dist_missing'] = True
            warnings.append(
                _nt('lap.warning.f4_f4_mnd_mcrd_lap')
            )

        # 지점부 휨-전단 상호작용(§H2) 검토: Vn은 입력값 또는 §G2.1 자동산정값.
        Vn = Vn_in
        h2_two = None
        h2_ready = bool(Vn and Vn > 0) and (two is None or bool(Vn2_in and Vn2_in > 0))
        if h2_ready and Vu > 0 and phi_Mn_lap > 0:
            n_members_v = 2
            if design_method == 'LRFD':
                phi_Vn_lap = 0.95 * (Vn * n_members_v)
            else:
                phi_Vn_lap = (Vn * n_members_v) / 1.60
            phi_Mn_h2 = phi_Mn_lap
            if two is not None:
                # 결정 S3′: H2 도 두 부재 강도의 합으로 — Ma = φ(Mnℓ,1 + Mnℓ,2)(국부 휨과 같은 값), Va = φ(Vn,1 + Vn,2).
                # 같은 두 부재면 2 Vn — 오늘과 같다. 강성 몫으로 본 부재마다의 H2(큰 쪽)는 참고값
                _Vn = [Vn, Vn2_in]
                phi_Vn_lap = 0.95 * (_Vn[0] + _Vn[1]) if design_method == 'LRFD' else (_Vn[0] + _Vn[1]) / 1.60
                _hst = None
                _sh = two['shares']
                if _sh:
                    _Mn = _flex['local']['two']['Mnl']
                    if design_method == 'LRFD':
                        _pm = [0.90 * (_Mn[i] / _sh[i]) for i in (0, 1)]
                        _pv = [0.95 * (_Vn[i] / _sh[i]) for i in (0, 1)]
                    else:
                        _pm = [(_Mn[i] / _sh[i]) / 1.67 for i in (0, 1)]
                        _pv = [(_Vn[i] / _sh[i]) / 1.60 for i in (0, 1)]
                    _mv = [math.sqrt((Mu / _pm[i]) ** 2 + (Vu / _pv[i]) ** 2) for i in (0, 1)]
                    _gh = 0 if _mv[0] >= _mv[1] else 1
                    _hst = dict(shares=_sh, mv=_mv, governing_member=_gh + 1, ratio=_mv[_gh])
                h2_two = dict(Vn=_Vn, vn_auto=[vn_auto, vn2_auto], Vn_sum=_Vn[0] + _Vn[1], stiffness=_hst)
            # Eq. H2-1 꼴 √((M/Ma)² + (V/Va)²) ≤ 1.0 — 부재 H2 와 같은 꼴이어야 '비 ≤ 1.0' 이 어디서나 같은 뜻이다
            # (제곱합은 판정은 같지만 다른 비와 견줄 수 없다).
            if phi_Vn_lap > 0:
                mv_m, mv_v = Mu / phi_Mn_h2, Vu / phi_Vn_lap
                mv_term = math.sqrt(mv_m ** 2 + mv_v ** 2)
            else:
                mv_m = mv_v = None
                mv_term = float('inf')
            mv_ok = mv_term <= 1.0
            _flex['h2'] = dict(Vn=Vn, vn_auto=vn_auto, phi_Vn_lap=phi_Vn_lap, mv=mv_term, ok=mv_ok,
                               m_ratio=mv_m, v_ratio=mv_v)
            if h2_two is not None:
                _flex['h2'].update(two=h2_two, phi_Mn_lap=phi_Mn_h2)
            flexure_ok = _and3(flexure_ok, mv_ok)
            flexure_dcr_governing = max(flexure_dcr_governing or 0, mv_term)
            steps.append({
                'step': '8b', 'name': 'Lap Combined Bending+Shear (§H2, Eq. H2-1)',
                'value': round(mv_term, 3), 'unit': '',
                'formula': (
                    f'√((Mu/{"φ" if design_method == "LRFD" else "1/Ω"}Mn)² + '
                    f'(Vu/{"φ" if design_method == "LRFD" else "1/Ω"}Vn)²) = '
                    f'√(({Mu:.2f}/{phi_Mn_h2:.2f})² + ({Vu:.3f}/{phi_Vn_lap:.3f})²) = {mv_term:.3f} ≤ 1.0'
                ) + ((f' (sum of the two members: Vn,1 + Vn,2 = {h2_two["Vn"][0]:.3f} + {h2_two["Vn"][1]:.3f} kips'
                      + (f'; reference only — stiffness shares, member {h2_two["stiffness"]["governing_member"]}: '
                         f'{h2_two["stiffness"]["ratio"]:.3f}' if h2_two['stiffness'] else '') + ')')
                     if h2_two is not None else ''),
                'pass': mv_ok,
            })
            if not mv_ok:
                warnings.append(
                    _nt('lap.warning.h2_lap_h2' + _precise(mv_term, 1.0, '.2f'), mv_term=mv_term)
                )
        elif Vu > 0:
            _flex['h2_missing'] = True
            flexure_ok = None if flexure_ok else flexure_ok
            warnings.append(
                _nt('lap.warning.h2_vn_lap_h2')
            )
    elif Mu > 0 and two_flex_missing:
        # 두 부재가 다른데 부재 2 의 Se 또는 강성 몫이 없다 — 랩 휨 · H2 는 판정 없음
        flexure_ok = None
        _flex['two_missing'] = two_flex_missing
        warnings.append(_nt('lap.warning.two_member_flexure_not_evaluated', reason=two_flex_missing))
    elif Mu > 0 and Se <= 0:
        flexure_ok = None
        warnings.append(
            _nt('lap.warning.se_lap')
        )
        if Sf_only > 0 and Fy > 0 and (two is None or two['Sf']):
            Mn_ref = 2 * Sf_only * Fy
            if two is not None:
                Mn_ref = Sf_only * Fy + two['Sf'] * Fy      # 결정 S3′: 두 부재의 합
            phi_ref = 0.90 * Mn_ref if design_method == 'LRFD' else Mn_ref / 1.67
            flexure_reference_dcr = Mu / phi_ref if phi_ref > 0 else None
            _flex['reference'] = dict(Mn_ref=Mn_ref, phi_ref=phi_ref, dcr=flexure_reference_dcr)
            steps.append({
                'step': '8r', 'name': 'Lap Flexure — reference only (gross Sf, local buckling not included)',
                'value': round(flexure_reference_dcr, 3) if flexure_reference_dcr is not None else None,
                'unit': '', 'assumed': True, 'pass': None,
                'formula': (f'참고값: Sf = {Sf_only:.4f} in³ (총단면) → 2×Sf×Fy = {Mn_ref:.2f} kip-in, '
                            f'{"φ" if design_method == "LRFD" else "1/Ω"}Mn = {phi_ref:.2f} kip-in, '
                            f'DCR = {flexure_reference_dcr:.3f} — Se 가 아니므로 판정에 쓰지 않음'),
            })
            warnings.append(_nt('lap.warning.sf_only_reference'))

    if not capacity_ok:
        warnings.append(
            _nt('lap.warning.transfer_capacity_dcr' + _precise(V_transfer, capacity, '.3f', utilization, '.2f'), V_transfer=V_transfer, capacity=capacity, utilization=utilization)
        )
    # 랩 길이 1.5d 는 강도 규정이 아니라 R 계수법(I6.2.1(g))·J3 겹친 Z 슬롯 예외의 적용 조건이다 —
    # 못 미치면 그 두 방법을 쓸 수 없다는 경고만 남기고 판정에는 넣지 않는다(미입력이면 배치를 못 하므로 None).
    if lap_ok is False:
        warnings.append(_nt('lap.warning.i6_2_1_lap_i6_j3', lap_each=lap_each, min_lap=min_lap))
    # J6.3 패스너 무리의 블록 전단 — 장력면을 빼고(Ant = 0) 두 전단면만: 하한(보수). 볼트만(J6 머리글: 나사 · PAF
    # 접합의 Rn 은 J6.1 · J6.2 의 작은 값 — J6.3 은 용접 · 볼트에만).  V6b 재검증 · 오케스트레이터 결정 2026-11-24.
    bs = {'applies': fastener_type != 'screw'}
    block_ok = True
    if bs['applies'] and n_total_actual > 0 and Pns > 0:
        dh = None
        for _c in conn_result.get('design_checks') or []:
            if _c['id'] == 'conn.j6.shear_rupture':
                for _st in _c.get('steps') or []:
                    for _i in _st.get('inputs') or []:
                        if _i['symbol'] == 'dh':
                            dh = _i['value']
        if dh is None:   # Table J3.3-1 표준 구멍
            dh = fastener_dia + (1.0 / 16.0 if fastener_dia >= 0.5 else 1.0 / 32.0)
        m = n_per_row_actual
        Lv = edge_dist + (m - 1) * spacing
        t_bs = t if two is None else min(t, two['t'])      # 결정 S5: 얇은 판
        Agv = 2.0 * t_bs * Lv
        Anv = 2.0 * t_bs * max(Lv - (m - 0.5) * dh, 0.0)
        P1 = 0.6 * Fy * Agv
        P2 = 0.6 * Fu * Anv
        Pnr = min(P1, P2)
        phi_bs, om_bs = 0.65, 2.22                     # Table J6-1, bolts
        Pa_bs = phi_bs * Pnr if design_method == 'LRFD' else Pnr / om_bs
        ratio_bs = V_transfer / Pa_bs if Pa_bs > 0 else float('inf')
        block_ok = ratio_bs <= 1.0
        bs.update(dh=dh, m=m, Lv=Lv, Agv=Agv, Anv=Anv, P1=P1, P2=P2, Pnr=Pnr, phi=phi_bs, omega=om_bs, Pa=Pa_bs,
                  ratio=ratio_bs, ok=block_ok)
        steps.append({
            'step': '7b', 'name': 'Lap fastener group block shear (§J6.3, lower bound — tension plane ignored)',
            'value': round(ratio_bs, 3), 'unit': '',
            'formula': (f'Lv = e + (m−1)s = {edge_dist:.3f} + ({m}−1)×{spacing:.3f} = {Lv:.3f} in, '
                        f'Agv = 2tLv = {Agv:.4f}, Anv = 2t(Lv − (m−0.5)dh) = {Anv:.4f} in², '
                        f'Pnr = min(0.6FyAgv, 0.6FuAnv) = {Pnr:.3f} kips, '
                        f'{"φ" if design_method == "LRFD" else "1/Ω"}Pnr = {Pa_bs:.3f} kips, '
                        f'V_transfer/{"φ" if design_method == "LRFD" else "1/Ω"}Pnr = {ratio_bs:.3f}'),
            'pass': block_ok,
        })
        if not block_ok:
            warnings.append(_nt('lap.warning.j6_3_lap_j6' + _precise(ratio_bs, 1.0, '.2f'), ratio_bs=ratio_bs))
    elif bs['applies']:
        block_ok = None if Pns <= 0 or n_total_actual <= 0 else True
    # R2(2026-11-25): 모델 A(모든 패스너가 고르게)로 낸 패스너 무리 용량 · 필요 개수의 판정은 사람이 그 가정을 밝혔을 때만
    # (lap_force_model_confirmed = true). 밝히지 않았으면 A 로도 넘으면 불합격(견준 분배 가운데 가장 유리한 것), 아니면
    # 판정 없음. 블록 전단(J6.3)은 무리 전체가 전체 전달력을 받는 검토라 분배와 상관없다 — 그대로.
    fits = n_total <= n_max_total
    force_confirmed = params.get('lap_force_model_confirmed') is True
    cap_part, fit_part = capacity_ok, fits
    if not force_confirmed:
        cap_part = False if not capacity_ok else None
        fit_part = False if not fits else None
        if (cap_part is None or fit_part is None) and not pns_assumed and Pns > 0:
            warnings.append(_nt('lap.warning.force_model_not_confirmed'))
    layout = [cap_part, spacing_ok, fit_part, block_ok]
    if pns_assumed:
        # 가정값 강도로 정한 수·용량·배치는 FAIL/PASS 를 내지 않는다 (FIXES §3.1)
        layout = [None if p is False else p for p in layout]
        fastener_ok = False if fastener_ok is False else None
    parts = [None if lap_ok is None else True] + layout + [flexure_ok, fastener_ok]
    if any(p is False for p in parts):
        overall_pass = False
    elif any(p is None for p in parts):
        overall_pass = None
    else:
        overall_pass = True
    verdict = 'PASS' if overall_pass is True else ('FAIL' if overall_pass is False else 'NOT_CHECKED')

    # 검토 항목(design_checks) — 위에서 쓴 값 그대로(lap_checks.py)
    from design.lap_checks import build as _build_lap_checks, LAP_BLOCK_SHEAR_NOTE, LAP_BLOCK_SHEAR_ASSUMPTION
    _ck = dict(dm=design_method, params=params, d=d, t=t, Fy=Fy, lap_chk=lap_chk, lap_ok=lap_ok, Mu=Mu, Vu=Vu,
               d_lever=d_lever, V_transfer=V_transfer, Pns=Pns, pns_mode=pns_mode, pns_assumed=pns_assumed,
               fastener_unverified=fastener_unverified, conn_result=conn_result, n_required=n_required,
               n_per_row=n_per_row, n_total=n_total, n_rows=n_rows, n_max_per_row=n_max_per_row,
               n_max_total=n_max_total, n_total_actual=n_total_actual, spacing=spacing, min_spacing=min_spacing,
               spacing_ok=spacing_ok, edge_dist=edge_dist, capacity=capacity, utilization=utilization,
               capacity_ok=capacity_ok, Se=Se, Sf_only=Sf_only, flex=_flex, block=bs,
               force_confirmed=force_confirmed)
    if two is not None:
        _ck.update(two=two, arm_member=arm_member, t_block=min(t, two['t']),
                   arm_d=(d if arm_member == 1 else two['d']), arm_t=(t if arm_member == 1 else two['t']))
    lap_design_checks = _build_lap_checks(_ck)
    from design.lap_checks import apply_missing_demands as _apply_missing_demands
    lap_design_checks = _apply_missing_demands(lap_design_checks, demand_missing, demand_zero_unstated,
                                               demand_positive=V_transfer > 0)
    if demand_missing or demand_zero_unstated:
        # 소요가 모자라면 통과가 아니다. 불합격은 검토 항목이 불합격으로 남은 때만(소요 0 에서 생긴 「배치 없음」은 아님)
        overall_pass = False if any(c['verdict'] == 'fail' and c.get('counts', True)
                                    for c in lap_design_checks) else None
        verdict = 'FAIL' if overall_pass is False else 'NOT_CHECKED'
    two_out = {}
    if two is not None:
        two_out = _two_member_summary(two, d, t, Se, params, arm_member, (fast_t1, fast_t2), _flex)
        if two['depth_mismatch']:
            # 결정 S4: 깊이가 다른 두 부재의 랩은 평가하지 않는다 — 모든 항목을 판정 없음(값은 reference 로)
            why = _nt('lap.reason.depth_mismatch', d=d, d_2=two['d'])
            lap_design_checks = _demote_all(lap_design_checks, why)
            warnings.append(_nt('lap.warning.depth_mismatch', d=d, d_2=two['d']))
            overall_pass, verdict = None, 'NOT_CHECKED'
            two_out['lap_evaluable'] = False
            two_out['not_evaluable_reason'] = why
    # 맨 위 utilization 은 판정을 낸 랩 강도 항목(pass · fail) 가운데 가장 큰 비 — 다른 결과와 같은 뜻(V8-01).
    # 상세(간격 · 끝단 거리)의 비는 치수 대 최소값이라 넣지 않는다. 패스너 무리의 비(옛 utilization)는 fastener_utilization.
    _gov = None
    for _c in lap_design_checks:
        if _c['id'] in LAP_STRENGTH_CHECKS and _c.get('verdict') in ('pass', 'fail') and _c.get('ratio') is not None:
            if _gov is None or float(_c['ratio']) > float(_gov['ratio']):
                _gov = _c

    return _attach_notices({
        'fastener_type': fastener_type,
        'fastener_dia': fastener_dia,
        'fastener_label': fastener_label,
        'fastener_label_parts': fastener_label_parts,
        'n_required': n_total,
        'n_total': n_total_actual,
        'n_max_total': n_max_total,
        'n_rows': n_rows,
        'n_per_row': n_per_row_actual,
        'spacing': spacing,
        'edge_distance': edge_dist,
        'V_transfer': V_transfer,
        'capacity': capacity,
        'Pns': round(Pns, 3),   # 표시용(계산은 반올림하지 않은 값)
        'Pns_governing_mode': pns_mode,  # 전단 산정에 사용된 지배 한계상태
        'Vn_used': round(Vn_in, 3) if Vn_in else None,
        'Vn_auto': vn_auto,
        'utilization': round(float(_gov['ratio']), 4) if _gov is not None else None,
        'governing_check': _gov['id'] if _gov is not None else None,
        'fastener_utilization': round(utilization, 4),
        'flexure_dcr': round(flexure_dcr, 4) if flexure_dcr is not None else None,
        # 국부(§F3)·뒤틀림(§F4)·휨-전단(§H2) 중 최대 — 헤드라인 DCR이 pass 플래그와
        # 모순되지 않도록 렌더러는 이 값을 우선 사용한다.
        'flexure_dcr_governing': round(flexure_dcr_governing, 4) if flexure_dcr_governing is not None else None,
        # Se 기준 휨(국부 · H2)을 평가했는가 — 뒤틀림 미평가(Mnd 없음)는 이 키가 아니라 pass · design_checks 에 난다.
        # 휨 검토(국부 · H2)가 판정을 냈는가(V9a-03) — 진술 없음 · 소요 없음의 미평가는 아니다
        'flexure_checked': _flexure_checked(lap_design_checks),
        'flexure_basis': 'Se' if Se > 0 else ('Sf_reference' if Sf_only > 0 else None),
        'flexure_assumed': Se <= 0 and Sf_only > 0,
        'flexure_reference_dcr': (round(flexure_reference_dcr, 4)
                                  if flexure_reference_dcr is not None else None),
        'Mn_lap': round(Mn_lap, 2),
        'phi_Mn_lap': round(phi_Mn_lap, 2),
        # 위 표시용 반올림 값의 반올림 전 값(SI 변환용 — 부재 설계의 display_unrounded 와 같은 뜻).
        # 패스너 결과(fastener_design)는 제 안에 같은 키를 갖는다.
        'display_unrounded': {k: float(v) for k, v in (('Pns', Pns), ('Vn_used', Vn_in if Vn_in else None),
                                                       ('Mn_lap', Mn_lap), ('phi_Mn_lap', phi_Mn_lap))
                              if v is not None},
        'pass': overall_pass,
        # 판정이 없으면 위 utilization 은 판정의 비가 아니다 — 부재 설계와 같은 표지(검토 2차 R2-6)
        **({'utilization_valid': False} if overall_pass is None else {}),
        'verdict': verdict,
        'design_method': design_method,
        'force_model': dict(FORCE_MODEL, confirmed=force_confirmed,
                            confirmation_input='lap_force_model_confirmed',
                            verdict_rule=('model_A_confirmed' if force_confirmed else
                                          'fail_if_model_A_exceeds_else_not_evaluated')),
        'lap_force_model_confirmed': force_confirmed,
        'fastener_design': conn_result,
        'lap_ok': lap_ok,
        'lap_length_role': _nt('lap.label.lap_length_role'),
        'Pns_assumed': pns_assumed,
        'min_lap': min_lap,
        'steps': steps,
        'warnings': warnings,
        # 도면용 단면/랩 치수
        'd': d,
        't': t,
        'lap_left_in': lap_left,
        'lap_right_in': lap_right,
        'design_checks': lap_design_checks,
        'scope_notes': [_prefixed('J6.3: ', LAP_BLOCK_SHEAR_NOTE)],
        'assumptions': ([LAP_BLOCK_SHEAR_ASSUMPTION] if bs.get('Pnr') is not None else [])
                       + ([_nt('lap.assumption.force_model_confirmed')] if force_confirmed else [])
                       + extra_assumptions,
        **two_out,
        'display_rounding': _display_rounding('lap'),
    })


def _demote_all(checks, reason):
    """모든 항목을 판정 없음으로 — 통과 · 불합격의 값은 reference 로 옮긴다(해당 없음은 그대로)."""
    from design.member_checks import demote_to_not_evaluated
    from design.checks import set_governing
    out = []
    for c in checks:
        if c.get('verdict') in ('pass', 'fail'):
            c = demote_to_not_evaluated(c, reason)
        elif c.get('verdict') == 'not_evaluated':
            c = dict(c, reason=reason)
        out.append(c)
    set_governing(out)
    return out


def _two_member_summary(two, d, t, Se, params, arm_member, fast, flex):
    """두 부재 랩의 결과 키(더하기만): 부재마다의 값과 항목마다 어느 부재가 정했는가. 결정 S3′: 랩의 휨 · H2 는 두 부재
    강도의 합(member_governing 의 그 항목은 'sum'), 강성 몫은 참고(flexure_reference_stiffness_share)."""
    loc = (flex.get('local') or {}).get('two')
    dist = flex.get('dist_two')
    h2 = (flex.get('h2') or {}).get('two')
    sh = two['shares']
    members = [
        {'member': 1, 't': t, 'd': d, 'Se': Se or None, 'Sf': params.get('Sf'), 'Mnd': params.get('Mnd'),
         'Ixx': two['Ixx'], 'stiffness_share': sh[0] if sh else None,
         'Mnl': loc['Mnl'][0] if loc else None, 'Vn': h2['Vn'][0] if h2 else None},
        {'member': 2, 't': two['t'], 'd': two['d'], 'Se': two['Se'], 'Sf': two['Sf'], 'Mnd': two['Mnd'],
         'Ixx': two['Ixx_2'], 'stiffness_share': sh[1] if sh else None,
         'Mnl': loc['Mnl'][1] if loc else None, 'Vn': h2['Vn'][1] if h2 else None},
    ]
    thin = 1 if t < two['t'] else (2 if two['t'] < t else 'both')
    gov = {
        'fastener_bearing_tilting': thin,
        'fastener_orientation': {'t1_head_side': fast[0], 't2_far_side': fast[1]},
        'lever_arm': arm_member,
        'block_shear': thin,
        'flexure_local': 'sum' if loc else None,
        'flexure_distortional': 'sum' if dist else None,
        'bending_shear': 'sum' if h2 else None,
    }
    out = {
        'lap_two_members': True,
        'lap_members': members,
        'share_by_stiffness': sh,
        'strength_basis': 'sum_of_strengths',
        'reference_basis': 'stiffness_share',
        'same_members': two['same'],
        'depth_mismatch': two['depth_mismatch'],
        'lap_evaluable': True,
        'member_governing': gov,
        'member2_defaulted': list(two['defaulted']),
    }
    st = (loc or {}).get('stiffness')
    if st:
        out['flexure_reference_stiffness_share'] = {'Mn_lap': st['Mn_lap'], 'phi_Mn_lap': st['phi_Mn_lap'],
                                                    'dcr': st['dcr'], 'governing_member': st['governing_member'],
                                                    'shares': st['shares']}
    return out


def _flexure_checked(checks):
    v = {c['id']: c['verdict'] for c in checks}
    return (v.get('lap.flexure.local') in ('pass', 'fail')
            and v.get('lap.bending_shear') in ('pass', 'fail', 'not_applicable'))


# 맨 위 utilization 을 정하는 랩 강도 항목(상세 · 적용 조건은 넣지 않는다).
LAP_STRENGTH_CHECKS = ('lap.fastener_group', 'lap.block_shear', 'lap.flexure.local', 'lap.flexure.distortional',
                       'lap.bending_shear')


# 랩이 접합 엔진에 넘긴 입력 이름 → 랩 입력 이름. 접합 엔진의 'd'(패스너 지름)가 랩의 'd'(부재 깊이)와
# 겹치지 않게 출처 key 를 랩의 이름으로 바꾼다(V6-18). 값은 그대로.
_LAP_SOURCE_KEYS = {'d': 'fastener_dia', 't1': 't', 't2': 't', 'e': 'end_distance', 'n': 'n (one fastener)',
                    'Fy': 'Fy', 'Fu': 'Fu'}


def _fastener_pns(conn_result: dict):
    """접합 엔진 결과에서 패스너 1개의 전단 전달 강도 (Pns, 지배 한계상태 이름, 가정값인가).

    부재 단면 검토(J6.2 순단면·J6.3 블록·Chapter D)와 인장 방향(풀아웃·풀오버·패스너 인장)은
    패스너 1개의 전단 전달 강도가 아니므로 Pns 에서 뺀다(J6.1 끝단 파단은 포함)."""
    _EXCLUDED = ('Tension Rupture', 'Block Shear', 'Member')
    shear_ls = [ls for ls in conn_result.get('limit_states', [])
                if ls.get('direction', 'shear') == 'shear'
                and not any(k in ls.get('name', '') for k in _EXCLUDED)]
    # 패스너 1개 강도는 반올림하지 않은 설계강도로 쓴다(접합 엔진의 design_strength 키는 표시용 소수 3자리).
    _ls_all = conn_result.get('limit_states', [])
    _dc = conn_result.get('design_checks') or []
    _raw_ds = {}
    for _i, _ls in enumerate(_ls_all):
        _c = _dc[_i] if _i < len(_dc) else {}
        _cap = _c.get('capacity') or (_c.get('reference') or {}).get('capacity') or {}
        _raw_ds[id(_ls)] = _cap.get('value', _ls.get('design_strength', 0))
    if shear_ls:
        gov_shear = min(shear_ls, key=lambda x: _raw_ds.get(id(x), x.get('design_strength', float('inf'))))
        return (_raw_ds.get(id(gov_shear), gov_shear.get('design_strength', 0)), gov_shear.get('name', ''),
                bool(gov_shear.get('assumed')))
    return 0, '', False


def _second_member(params: dict, d: float, t: float, Fy) -> dict | None:
    """겹친 두 번째 부재의 입력(이름 끝 _2) — 하나도 없으면 None(오늘과 같은 길). t_2 · d_2 가 없으면 부재 1 의 값을
    쓰고 defaulted 에 밝힌다. Se_2 · Mnd_2 는 두 부재가 같을 때(t · d · 준 Se 가 같고 Ixx 가 다르지 않을 때)만 부재 1 의
    값을 쓴다 — 다르면 없는 값은 없는 것으로(그 검토는 판정 없음). 강성 몫 s_i = I_i / (I_1 + I_2) 는 Ixx · Ixx_2 로,
    없으면 같은 부재일 때만 0.5 · 0.5 — 참고값일 뿐(결정 S3′: 랩의 강도는 두 부재 강도의 합)."""
    keys = ('t_2', 'd_2', 'Se_2', 'Sf_2', 'Mnd_2', 'Vn_2', 'h_web_2', 'Ixx_2')
    if all(params.get(k) is None for k in keys):
        return None
    defaulted = []
    t2 = params.get('t_2')
    if t2 is None:
        t2 = t
        defaulted.append('t_2')
    d2 = params.get('d_2')
    if d2 is None:
        d2 = d
        defaulted.append('d_2')
    t2, d2 = float(t2), float(d2)
    Se, Se2 = params.get('Se') or 0, params.get('Se_2')
    I1, I2 = params.get('Ixx'), params.get('Ixx_2')
    same = (abs(t2 - t) <= 1e-12 and abs(d2 - d) <= 1e-12 * max(1.0, d)
            and (Se2 is None or Se2 == Se) and (I1 is None or I2 is None or I1 == I2))
    if Se2 is None and same and Se:
        Se2 = Se
        defaulted.append('Se_2')
    Mnd = params.get('Mnd') or params.get('Mnd_single')
    Mnd2 = params.get('Mnd_2')
    if Mnd2 is None and same and Mnd:
        Mnd2 = Mnd
        defaulted.append('Mnd_2')
    Sf2 = params.get('Sf_2')
    if Sf2 is None and same and params.get('Sf'):
        Sf2 = params.get('Sf')
        defaulted.append('Sf_2')
    if I1 and I2:
        shares = [float(I1) / (float(I1) + float(I2)), float(I2) / (float(I1) + float(I2))]
    elif same:
        shares = [0.5, 0.5]
    else:
        shares = None
    return {'t': t2, 'd': d2, 'Se': float(Se2) if Se2 else None, 'Sf': float(Sf2) if Sf2 else None,
            'Mnd': float(Mnd2) if Mnd2 else None, 'Vn': params.get('Vn_2'), 'h_web': params.get('h_web_2'),
            'Ixx': I1, 'Ixx_2': I2, 'shares': shares, 'same': same, 'defaulted': defaulted,
            'depth_mismatch': abs(d2 - d) > 1e-6 * max(d, d2)}


def _rekey_fastener_sources(checks: list, keymap: dict = None) -> None:
    """keymap: 두 부재일 때 접합 엔진의 t1 · t2 가 랩의 어느 입력(t · t_2)인지."""
    names = dict(_LAP_SOURCE_KEYS, **(keymap or {}))

    def fix(qv):
        if isinstance(qv, dict):
            so = qv.get('source')
            if isinstance(so, dict) and so.get('kind') in ('user_input', 'material') and so.get('key') in names:
                qv['source'] = dict(so, key=names[so['key']], via='lap_connection')
    for c in checks:
        for k in ('demand', 'nominal', 'capacity'):
            fix(c.get(k))
        for st in c.get('steps') or []:
            for i in st.get('inputs') or []:
                fix(i)


def _and3(a, b):
    """판정 접기: 하나라도 False 면 False, 아니고 하나라도 None 이면 None, 아니면 True."""
    if a is False or b is False:
        return False
    if a is None or b is None:
        return None
    return True


def check_lap_length(d: float, lap_left: float, lap_right: float, d_2: float = None) -> dict:
    """Lap 길이 검증 (§I6.2.1(g): 지지점 중심에서 각 방향으로 1.5d 이상)

    1.5d 는 §I6.2.1 R 계수법의 적용 조건이자 §J3 의 겹친 Z 부재 과대·슬롯 구멍 예외 조건이다
    (접합 강도 규정이 아님). 한쪽이라도 0(미입력)이면 판정하지 않는다(ok=None).
    d_2: 겹친 두 번째 부재의 깊이(2026-11-28). 주면 d 와 같을 때만 판정하고(depth_mismatch False),
    다르면 판정하지 않는다(ok=None, depth_mismatch True — 결정 S4). 없으면 지금까지 그대로.

    Returns:
        dict: {ok, min_lap_in, actual_in, message[, depth_mismatch]}
    """
    if d_2 is not None:
        mismatch = abs(float(d_2) - float(d)) > 1e-6 * max(float(d), float(d_2))
        if mismatch:
            return {'ok': None, 'min_lap_in': 1.5 * max(float(d), float(d_2)),
                    'actual_in': min(lap_left or 0, lap_right or 0), 'depth_mismatch': True,
                    'message': _nt('lap.reason.depth_mismatch', d=float(d), d_2=float(d_2))}
        return dict(check_lap_length(d, lap_left, lap_right), depth_mismatch=False)
    min_lap = 1.5 * d
    lap_left = lap_left or 0
    lap_right = lap_right or 0
    if lap_left <= 0 or lap_right <= 0:
        actual = min(lap_left, lap_right)
        return {
            'ok': None,
            'min_lap_in': min_lap,
            'actual_in': actual,
            'message': (_nt('lap.warning.i6_2_1_lap_i6_i6_j3_2', lap_left=lap_left, lap_right=lap_right)),
        }
    actual = min(lap_left, lap_right)
    ok = actual >= min_lap
    return {
        'ok': ok,
        'min_lap_in': min_lap,
        'actual_in': actual,
        'message': '' if ok else (_nt('lap.warning.i6_2_1_lap_i6_i6_j3', actual=actual, min_lap=min_lap)),
    }


def _screw_gauge(d: float) -> str:
    """Screw 직경으로 게이지 추정

    표준 나사 외경: #8=0.164, #10=0.190, #12=0.216, #14=0.242 in.
    (과거 매핑은 0.19 in을 #14로 표기 — 실제 #10에 해당하는 오류였음)
    """
    if d <= 0.150:
        return f'{d:.3f}"'
    if d <= 0.177:
        return '8'
    if d <= 0.203:
        return '10'
    if d <= 0.229:
        return '12'
    if d <= 0.260:
        return '14'
    return f'{d:.3f}"'
