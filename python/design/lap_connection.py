"""Lap Splice Connection Design (AISI S100 Chapter J)

패스너 강도: Chapter J (볼트 J3·App. A J3.4, 나사 J4, 파단 J6.1) — design.connections 공유 엔진.
패스너 힘 분배: 기준 조항이 아니라 사내 합리적 해석(§A1.2(c))이다 — 결과의 force_model 참고.
랩 길이 1.5d: §I6.2.1(g)(R 계수법 적용 조건)·§J3(겹친 Z 부재의 과대·슬롯 구멍 예외 조건).
"""

import math
from design.connections import design_connection, normalize_design_method
from design.checks import display_rounding as _display_rounding

# 패스너 수요 모델 설명(결과·steps 에 그대로 싣는다). 모델을 바꾸는 것은 사용자 결정 사항이다.
FORCE_MODEL = {
    'basis': 'in_house_rational_analysis',
    'clause': 'AISI S100-16 §A1.2(c) (rational engineering analysis) — not a specification provision',
    'specification_provision': False,
    'description': (
        'V_transfer = max(Mu/(d − t), Vu); 모든 패스너(n_rows × n_per_row)가 V_transfer 를 '
        '균등 분담한다고 보고 n = ceil(V_transfer / Pns). Mu 는 지점 모멘트 전체, d − t 는 플랜지 '
        '우력의 팔. 패스너 1개 강도 Pns 는 공유 엔진의 전단 방향 한계상태 최솟값.'),
    'user_decision_pending': True,
    'known_limitations': [
        '(a) 우력 F=Mu/(d−t) 는 위·아래 행에 +F/−F 로 걸리므로 각 행이 F 전체를 받는다 — '
        '균등 분담은 행 수만큼 패스너당 수요를 과소평가할 수 있다.',
        '(b) 팔 길이는 실제 패스너 행 간격(보통 d−t 보다 작다)이어야 한다.',
        '(c) 연직 전단 Vu 와 수평 우력 성분을 같은 패스너가 받으므로 max 가 아니라 벡터합이 맞다.',
        '(d) 지점 모멘트 전체를 넘기는 것은 과대할 수 있다 — 랩 끝에서 끝나는 부재가 넘기는 것은 '
        '그 단면에서 자기가 지던 몫뿐이다(Manual II-1A 가정 a–c).',
        '(e) Commentary J3: 랩 구간 저항의 일부는 겹친 부재의 끼움으로 생기며, 기준에는 랩 패스너 '
        '수 산정식이 없다.',
    ],
}


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
    fastener_type = params.get('fastener_type', 'screw')
    fastener_dia = params.get('fastener_dia', 0.19)  # #10 screw = 0.190 in
    n_rows = params.get('n_rows', 2)

    steps = []
    warnings = []

    # Step 1: Lap 길이 (§I6.2.1(g) "in each direction")
    lap_chk = check_lap_length(d, lap_left, lap_right)
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
    warnings.append('Lap 패스너 힘 분배(Step 2·4)는 기준 조항이 아닌 사내 합리적 해석(§A1.2(c))입니다 — '
                    'force_model 의 한계 (a)–(e) 를 확인하세요.')

    # 끝단 거리 (§J3.2 볼트 / §J4.2 나사: ≥ 1.5d). 사용자 값은 그대로 엔진에 넘긴다 —
    # 1.5d 보다 짧으면 엔진의 J3.2/J4.2 검사가 불합격을 낸다(조용히 올리지 않는다).
    edge_min = 1.5 * fastener_dia
    edge_user = params.get('end_distance') or 0
    edge_dist = edge_user if edge_user > 0 else edge_min
    if 0 < edge_user < edge_min:
        warnings.append(
            f'입력 단부거리 {edge_user:.3f} in < 최소 1.5d = {edge_min:.3f} in — '
            f'§J3.2/§J4.2 불합격 (값은 그대로 사용).'
        )
    elif edge_user <= 0:
        warnings.append(f'end_distance 미입력 — 최소 1.5d = {edge_min:.3f} in 로 배치를 제안하고 §J6.1 을 그 값으로 '
                        '평가 (시공 상세가 이 끝단 거리를 지켜야 함)')

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
    conn_result = design_connection(cparams)
    if conn_result.get('error'):
        return conn_result

    # 부재 단면 검토(J6.2 순단면·J6.3 블록·Chapter D)와 인장 방향(풀아웃·풀오버·패스너 인장)은
    # 패스너 1개의 전단 전달 강도가 아니므로 Pns 에서 뺀다(J6.1 끝단 파단은 포함).
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
        Pns = _raw_ds.get(id(gov_shear), gov_shear.get('design_strength', 0))
        pns_mode = gov_shear.get('name', '')
        pns_assumed = bool(gov_shear.get('assumed'))
    else:
        Pns = 0
        pns_mode = ''
        pns_assumed = False
    fastener_unverified = [x for x in conn_result.get('not_evaluated', [])
                           if x.get('category') in ('fastener', 'scope')
                           and x.get('direction') in ('shear', 'any')]
    fastener_ok = None if fastener_unverified else True
    for x in fastener_unverified:
        warnings.append(f"패스너 강도 미확정: {x['name']} — {x['reason']}")
    detail_fail = [x for x in conn_result.get('detailing_checks', []) if not x['pass']]
    if detail_fail:
        fastener_ok = False
        for x in detail_fail:
            warnings.append(f"상세 불합격: {x['name']} (입력 {x['provided']} < 요구 {x['required']})")
    if pns_assumed:
        warnings.append(f'Pns 가 가정값 한계상태({pns_mode})로 정해졌다 — 패스너 수·용량·배치 판정은 '
                        '참고값이며 불합격도 합격도 내지 않는다.')
    if fastener_type == 'screw':
        fastener_label = f'Screw #{_screw_gauge(fastener_dia)}'
    else:
        fastener_label = f'Bolt d={fastener_dia:.3f} in'

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
        warnings.append('패스너 강도 = 0 — 패스너 사양을 확인하세요.')

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
            warnings.append(f'Lap {lap_each:.2f} in < 2e = {2 * edge_dist:.2f} in — 패스너를 배치할 수 없음')
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
            f'필요 패스너 {n_total} ea > Lap 내 최대 배치 {n_max_total} ea — '
            f'Lap 길이를 늘리거나 패스너 사양을 변경하세요.'
        )
    if not spacing_ok:
        warnings.append(f'패스너 간격 {spacing:.2f} in < 최소 3d = {min_spacing:.2f} in')

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

    _flex = {}   # 계산서(design_checks) 재료 — 아래 휨 검토가 쓴 값
    flexure_ok = True
    flexure_dcr = None
    flexure_reference_dcr = None
    flexure_dcr_governing = None  # 국부/뒤틀림/H2 중 최대 DCR (헤드라인 표시용)
    Mn_lap = 0
    phi_Mn_lap = 0

    if Se > 0 and Fy > 0 and Mu > 0:
        Mnl_single = Se * Fy  # kip-in
        n_members = 2
        Mn_lap = Mnl_single * n_members  # kip-in

        if design_method == 'LRFD':
            phi_b = 0.90
            phi_Mn_lap = phi_b * Mn_lap
            flexure_dcr = Mu / phi_Mn_lap if phi_Mn_lap > 0 else float('inf')
        else:  # ASD
            omega_b = 1.67
            phi_Mn_lap = Mn_lap / omega_b
            flexure_dcr = Mu / phi_Mn_lap if phi_Mn_lap > 0 else float('inf')

        flexure_ok = flexure_dcr <= 1.0
        flexure_dcr_governing = flexure_dcr
        _flex['local'] = dict(Mnl_single=Mnl_single, Mn_lap=Mn_lap, phi_Mn_lap=phi_Mn_lap, dcr=flexure_dcr,
                              ok=flexure_ok, n_members=n_members)

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
        if not flexure_ok:
            warnings.append(
                f'Lap 구간 휨강도 부족: Mu = {Mu:.2f} kip-in > '
                f'{"φ" if design_method == "LRFD" else ""}Mn = {phi_Mn_lap:.2f} kip-in '
                f'(DCR = {flexure_dcr:.2f})'
            )

        # 뒤틀림좌굴(§F4) 검토: Mcrd/Mnd 가 주어지면 평가하고, 없으면 경고.
        # 주: S100-16 에서 뒤틀림은 국부/전체와 동일한 계수(φ_b=0.90 / Ω_b=1.67)를 사용한다.
        Mnd_single = params.get('Mnd') or params.get('Mnd_single')
        if Mnd_single and Mnd_single > 0:
            Mnd_lap = Mnd_single * n_members
            if design_method == 'LRFD':
                phi_Mnd_lap = 0.90 * Mnd_lap
            else:
                phi_Mnd_lap = Mnd_lap / 1.67
            dist_dcr = Mu / phi_Mnd_lap if phi_Mnd_lap > 0 else float('inf')
            dist_ok = dist_dcr <= 1.0
            _flex['dist'] = dict(Mnd_single=Mnd_single, Mnd_lap=Mnd_lap, phi_Mnd_lap=phi_Mnd_lap, dcr=dist_dcr,
                                 ok=dist_ok)
            flexure_ok = flexure_ok and dist_ok
            flexure_dcr_governing = max(flexure_dcr_governing or 0, dist_dcr)
            steps.append({
                'step': '8a', 'name': 'Lap Distortional Flexural Strength (§F4, 2-member sum)',
                'value': round(dist_dcr, 3), 'unit': '',
                'formula': (
                    f'Mnd = {Mnd_single:.2f} kip-in, Mnd_lap = {n_members}×Mnd = {Mnd_lap:.2f} kip-in, '
                    f'{"φ" if design_method == "LRFD" else "1/Ω"}Mnd = {phi_Mnd_lap:.2f} kip-in, '
                    f'DCR = {dist_dcr:.3f}'
                ),
                'pass': dist_ok,
            })
            if not dist_ok:
                warnings.append(
                    f'Lap 구간 뒤틀림 휨강도 부족(§F4): DCR = {dist_dcr:.2f}.'
                )
        else:
            warnings.append(
                '뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간은 Manual II-1A 처럼 '
                '겹친 부재로 뒤틀림이 구속된다고 가정했습니다. 구속이 없으면 Mnd 를 입력하세요.'
            )

        # 지점부 휨-전단 상호작용(§H2) 검토: Vn은 입력값 또는 §G2.1 자동산정값.
        Vn = Vn_in
        if Vn and Vn > 0 and Vu > 0 and phi_Mn_lap > 0:
            n_members_v = 2
            if design_method == 'LRFD':
                phi_Vn_lap = 0.95 * (Vn * n_members_v)
            else:
                phi_Vn_lap = (Vn * n_members_v) / 1.60
            # Eq. H2-1 꼴 √((M/Ma)² + (V/Va)²) ≤ 1.0 — 부재 H2 와 같은 꼴이어야 '비 ≤ 1.0' 이 어디서나 같은 뜻이다
            # (제곱합은 판정은 같지만 다른 비와 견줄 수 없다).
            if phi_Vn_lap > 0:
                mv_m, mv_v = Mu / phi_Mn_lap, Vu / phi_Vn_lap
                mv_term = math.sqrt(mv_m ** 2 + mv_v ** 2)
            else:
                mv_m = mv_v = None
                mv_term = float('inf')
            mv_ok = mv_term <= 1.0
            _flex['h2'] = dict(Vn=Vn, vn_auto=vn_auto, phi_Vn_lap=phi_Vn_lap, mv=mv_term, ok=mv_ok,
                               m_ratio=mv_m, v_ratio=mv_v)
            flexure_ok = flexure_ok and mv_ok
            flexure_dcr_governing = max(flexure_dcr_governing or 0, mv_term)
            steps.append({
                'step': '8b', 'name': 'Lap Combined Bending+Shear (§H2, Eq. H2-1)',
                'value': round(mv_term, 3), 'unit': '',
                'formula': (
                    f'√((Mu/{"φ" if design_method == "LRFD" else "1/Ω"}Mn)² + '
                    f'(Vu/{"φ" if design_method == "LRFD" else "1/Ω"}Vn)²) = '
                    f'√(({Mu:.2f}/{phi_Mn_lap:.2f})² + ({Vu:.3f}/{phi_Vn_lap:.3f})²) = {mv_term:.3f} ≤ 1.0'
                ),
                'pass': mv_ok,
            })
            if not mv_ok:
                warnings.append(
                    f'Lap 지점부 휨-전단 상호작용(§H2) 초과: 상호작용값 = {mv_term:.2f} > 1.0.'
                )
        elif Vu > 0:
            _flex['h2_missing'] = True
            flexure_ok = None if flexure_ok else flexure_ok
            warnings.append(
                '단면 전단강도 Vn 을 산정할 수 없습니다(퇴화 기하) — Lap 지점부 '
                '휨-전단 상호작용(§H2) 검토를 수행하지 못했습니다.'
            )
    elif Mu > 0 and Se <= 0:
        flexure_ok = None
        warnings.append(
            'Se(유효 단면계수)가 미입력 — Lap 구간 휨강도 검토를 수행하지 못했습니다(판정 없음). '
            '설계 탭에서 단면 정보를 확인하세요.'
        )
        if Sf_only > 0 and Fy > 0:
            Mn_ref = 2 * Sf_only * Fy
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
            warnings.append('Sf(총단면 계수)만 입력 — 국부좌굴을 반영하지 않은 참고값만 계산했고 '
                            '휨 판정은 하지 않음. Se 를 입력하세요.')

    if not capacity_ok:
        warnings.append(
            f'용량 부족: V_transfer = {V_transfer:.3f} kips > Capacity = {capacity:.3f} kips '
            f'(DCR = {utilization:.2f}). 패스너 수 또는 사양을 변경하세요.'
        )
    # 랩 길이 1.5d 는 강도 규정이 아니라 R 계수법(I6.2.1(g))·J3 겹친 Z 슬롯 예외의 적용 조건이다 —
    # 못 미치면 그 두 방법을 쓸 수 없다는 경고만 남기고 판정에는 넣지 않는다(미입력이면 배치를 못 하므로 None).
    if lap_ok is False:
        warnings.append(f'Lap {lap_each:.2f} in < 1.5d = {min_lap:.2f} in — §I6.2.1 R 계수법과 §J3 겹친 Z 부재의 '
                        '과대·슬롯 구멍 예외를 쓸 수 없음 (접합 강도 판정에는 넣지 않음)')
    layout = [capacity_ok, spacing_ok, n_total <= n_max_total]
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
    from design.lap_checks import build as _build_lap_checks
    _ck = dict(dm=design_method, params=params, d=d, t=t, Fy=Fy, lap_chk=lap_chk, lap_ok=lap_ok, Mu=Mu, Vu=Vu,
               d_lever=d_lever, V_transfer=V_transfer, Pns=Pns, pns_mode=pns_mode, pns_assumed=pns_assumed,
               fastener_unverified=fastener_unverified, conn_result=conn_result, n_required=n_required,
               n_per_row=n_per_row, n_total=n_total, n_rows=n_rows, n_max_per_row=n_max_per_row,
               n_max_total=n_max_total, n_total_actual=n_total_actual, spacing=spacing, min_spacing=min_spacing,
               spacing_ok=spacing_ok, edge_dist=edge_dist, capacity=capacity, utilization=utilization,
               capacity_ok=capacity_ok, Se=Se, Sf_only=Sf_only, flex=_flex)
    lap_design_checks = _build_lap_checks(_ck)

    return {
        'fastener_type': fastener_type,
        'fastener_dia': fastener_dia,
        'fastener_label': fastener_label,
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
        'utilization': round(utilization, 4),
        'flexure_dcr': round(flexure_dcr, 4) if flexure_dcr is not None else None,
        # 국부(§F3)·뒤틀림(§F4)·휨-전단(§H2) 중 최대 — 헤드라인 DCR이 pass 플래그와
        # 모순되지 않도록 렌더러는 이 값을 우선 사용한다.
        'flexure_dcr_governing': round(flexure_dcr_governing, 4) if flexure_dcr_governing is not None else None,
        'flexure_checked': flexure_ok is not None and Se > 0,
        'flexure_basis': 'Se' if Se > 0 else ('Sf_reference' if Sf_only > 0 else None),
        'flexure_assumed': Se <= 0 and Sf_only > 0,
        'flexure_reference_dcr': (round(flexure_reference_dcr, 4)
                                  if flexure_reference_dcr is not None else None),
        'Mn_lap': round(Mn_lap, 2),
        'phi_Mn_lap': round(phi_Mn_lap, 2),
        'pass': overall_pass,
        'verdict': verdict,
        'design_method': design_method,
        'force_model': FORCE_MODEL,
        'fastener_design': conn_result,
        'lap_ok': lap_ok,
        'lap_length_role': 'applicability condition for §I6.2.1 R-factor method and §J3 lapped-Z hole exception '
                           '(not a strength check; not part of pass)',
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
        'display_rounding': _display_rounding('lap'),
    }


def check_lap_length(d: float, lap_left: float, lap_right: float) -> dict:
    """Lap 길이 검증 (§I6.2.1(g): 지지점 중심에서 각 방향으로 1.5d 이상)

    1.5d 는 §I6.2.1 R 계수법의 적용 조건이자 §J3 의 겹친 Z 부재 과대·슬롯 구멍 예외 조건이다
    (접합 강도 규정이 아님). 한쪽이라도 0(미입력)이면 판정하지 않는다(ok=None).

    Returns:
        dict: {ok, min_lap_in, actual_in, message}
    """
    min_lap = 1.5 * d
    lap_left = lap_left or 0
    lap_right = lap_right or 0
    if lap_left <= 0 or lap_right <= 0:
        actual = min(lap_left, lap_right)
        return {
            'ok': None,
            'min_lap_in': min_lap,
            'actual_in': actual,
            'message': (f'Lap 길이: 좌({lap_left})·우({lap_right}) 가운데 미입력(0)이 있어 판정하지 않음 — '
                        '§I6.2.1(g) 은 각 방향 모두 1.5d 이상을 요구 '
                        '(R 계수법(I6.2.1)·J3 겹친 Z 슬롯 예외의 적용 조건)'),
        }
    actual = min(lap_left, lap_right)
    ok = actual >= min_lap
    return {
        'ok': ok,
        'min_lap_in': min_lap,
        'actual_in': actual,
        'message': '' if ok else (f'Lap {actual:.2f} in < 1.5d = {min_lap:.2f} in (§I6.2.1(g)) — '
                                  'R 계수법(I6.2.1)·J3 겹친 Z 슬롯 예외의 적용 조건 미충족'),
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
