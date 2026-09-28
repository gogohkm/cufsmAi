"""Lap Splice Connection Design (AISI S100 Chapter J)

§I6.2.1(g): Lap 길이 ≥ 1.5d
§J3.3: 볼트 접합 Lapped Z-members
§J4: Screw 접합
§J2.4.1: Arc Seam Welds on Lap Joint

Lap 구간은 접합부(connection)로 설계 — 전단 전달용 볼트/스크류 개수 산정
"""

import math
from design.connections import design_connection


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
        }

    Returns:
        dict: 설계 결과
    """
    d = params.get('d', 8.0)
    t = params.get('t', 0.059)
    Fy = params.get('Fy', 35.53)
    Fu = params.get('Fu', 58.02)
    lap_left = params.get('lap_left_in', 0)
    lap_right = params.get('lap_right_in', 0)
    Mu = abs(params.get('Mu_support', 0))
    Vu = abs(params.get('Vu_support', 0))
    fastener_type = params.get('fastener_type', 'screw')
    fastener_dia = params.get('fastener_dia', 0.19)  # #10 screw = 0.190 in
    n_rows = params.get('n_rows', 2)
    design_method = params.get('design_method', 'LRFD')

    steps = []
    warnings = []

    # Step 1: Lap 길이 검증 (§I6.2.1(g))
    min_lap = 1.5 * d
    lap_each = min(lap_left, lap_right) if lap_left > 0 and lap_right > 0 else max(lap_left, lap_right)

    lap_ok = lap_each >= min_lap
    steps.append({
        'step': 1, 'name': 'Lap Length Check (§I6.2.1(g))',
        'value': round(lap_each, 2), 'unit': 'in',
        'formula': f'Lap = {lap_each:.2f} in {"≥" if lap_ok else "<"} 1.5d = {min_lap:.2f} in',
        'pass': lap_ok,
    })
    if not lap_ok:
        warnings.append(
            f'Lap 길이 {lap_each:.2f} in < 1.5d = {min_lap:.2f} in — '
            f'§I6.2.1(g) 미충족. Lap 길이를 {min_lap:.1f} in 이상으로 늘리세요.'
        )

    # Step 2: 전달 전단력 산정 (합리적 해석 모델 — §B / §K2.1)
    # AISI Chapter J/I 에는 Lap 패스너群 전달력에 대한 폐형식 식이 없으므로
    # 합리적 해석(rational analysis)으로 산정한다.
    # 지점 모멘트는 단면 상·하 플랜지의 우력(couple)으로 전달되므로
    # 플랜지 전달력 ≈ Mu / (d - t)  (플랜지 중심간 거리 = 단면깊이 - 두께)
    # 이를 지점 전단력 Vu 와 비교해 큰 값을 패스너群 전달 수요로 사용한다.
    # (이전의 Mu/(Lap/2) 식은 Lap > d 일 때 수요를 과소평가하므로 사용하지 않음)
    d_lever = (d - t) if (d - t) > 0 else d  # 플랜지 우력의 모멘트 팔
    if Mu > 0 and d_lever > 0:
        V_flange = Mu / d_lever  # 플랜지 우력 전달력
        V_transfer = max(V_flange, Vu)
        v2_formula = (
            f'V_transfer = max(Mu/(d-t), Vu) = '
            f'max({Mu:.2f}/{d_lever:.3f}, {Vu:.3f}) = '
            f'max({V_flange:.3f}, {Vu:.3f}) = {V_transfer:.3f} kips'
        )
    else:
        V_transfer = Vu  # fallback (모멘트 미입력 시 지점 전단력 사용)
        v2_formula = f'V_transfer = Vu = {Vu:.3f} kips'

    steps.append({
        'step': 2, 'name': 'Transfer Shear Force (rational analysis, §B/§K2.1)',
        'value': round(V_transfer, 3), 'unit': 'kips',
        'formula': v2_formula,
    })

    # Step 3: 개별 패스너 설계강도 — 전단 전달 한계상태만 사용
    conn_type = 'screw' if fastener_type == 'screw' else 'bolt'
    conn_result = design_connection({
        'connection_type': conn_type,
        'design_method': params.get('design_method', 'LRFD'),
        'Fy': Fy,
        'Fu': Fu,
        't1': t,
        't2': t,
        'd': fastener_dia,
        'n': 1,
        'Pu': 0,
    })
    if conn_result.get('error'):
        return conn_result

    # Lap 패스너群의 수요는 전단(V_transfer)이므로 전단 전달 한계상태
    # (§J4.3 틸팅/지압/나사전단, §J3.3 지압, §J3.4 볼트전단 등)만으로 Pns를
    # 산정한다. 인장계 한계상태(풀아웃 J4.4.1, 풀오버 J4.4.2)와 부재 단면검토
    # (J6.2/J6.3/D2/D3)는 전단 수요에 적용되지 않는데도 과거에는 전체 최소값을
    # 사용해 스크류 개수가 크게 과대 산정되었다. (양력 인장 검토는 별도 수행)
    _TENSION_MODE_KEYS = ('Pull-out (J4.4', 'Pull-over (J4.4', 'Tension', 'Block Shear', 'Member')
    shear_ls = [ls for ls in conn_result.get('limit_states', [])
                if not any(k in ls.get('name', '') for k in _TENSION_MODE_KEYS)]
    if shear_ls:
        gov_shear = min(shear_ls, key=lambda x: x.get('design_strength', float('inf')))
        Pns = gov_shear.get('design_strength', 0)
        pns_mode = gov_shear.get('name', '')
    else:
        Pns = conn_result.get('design_strength', 0)
        pns_mode = conn_result.get('governing_mode', '')
    if fastener_type == 'screw':
        fastener_label = f'Screw #{_screw_gauge(fastener_dia)}'
    else:
        fastener_label = f'Bolt d={fastener_dia:.3f} in'

    steps.append({
        'step': 3, 'name': f'Fastener Strength ({fastener_label})',
        'value': round(Pns, 3), 'unit': 'kips',
        'formula': (
            f'Pdesign = {Pns:.3f} kips/ea — 지배: {pns_mode} '
            f'(전단 한계상태만; 인장계 J4.4·부재 J6/D 제외)'
        ),
    })

    # Step 4: 필요 패스너 수
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
        'step': 4, 'name': 'Required Fasteners',
        'value': n_total, 'unit': 'ea',
        'formula': f'n = V/Pdesign = {V_transfer:.3f}/{Pns:.3f} = {n_required} → {n_rows} rows × {n_per_row}/row = {n_total} ea'
            if Pns > 0 else 'N/A',
    })

    # Step 5: 배치 가능 최대 패스너 수 (Lap 길이 제약)
    # 최소 연단/단부 거리 = 1.5d (§J3.2 볼트, §J4.2 스크류).
    # 사용자가 end_distance를 지정하면 그 값(≥1.5d)을 사용 — 볼트의 §J6.1
    # 인열(tearout)은 e에 비례하므로, 최소 e 가정은 볼트 개수를 크게 부풀린다.
    edge_min = 1.5 * fastener_dia  # §J3.2 (볼트) / §J4.2 (스크류): 1.5d
    edge_user = params.get('end_distance') or 0
    edge_dist = max(edge_min, edge_user)
    if edge_user > 0 and edge_user < edge_min:
        warnings.append(
            f'입력 단부거리 {edge_user:.3f} in < 최소 1.5d = {edge_min:.3f} in — '
            f'최소값으로 상향 적용했습니다.'
        )
    min_spacing = 3 * fastener_dia
    if lap_each > 0 and min_spacing > 0:
        n_max_per_row = max(1, int((lap_each - 2 * edge_dist) / min_spacing) + 1)
    else:
        n_max_per_row = n_per_row
    n_max_total = n_max_per_row * n_rows

    # 패스너 배치 간격
    n_per_row_actual = min(n_per_row, n_max_per_row)
    n_total_actual = n_per_row_actual * n_rows
    if n_per_row_actual > 1 and lap_each > 0:
        spacing = (lap_each - 2 * edge_dist) / (n_per_row_actual - 1) if n_per_row_actual > 1 else 0
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

    # Step 6: Edge/End distance + (볼트 한정) 단부거리 지배 전단파단 강도 (§J6.1)
    steps.append({
        'step': 6, 'name': 'Edge/End Distance (§J3.2 / §J4.2)',
        'value': round(edge_dist, 3), 'unit': 'in',
        'formula': (
            f'e = {edge_dist:.3f} in (사용자 지정, 최소 1.5d = {edge_min:.3f} in 충족)'
            if edge_user > edge_min else
            f'e = 1.5d = 1.5 × {fastener_dia:.3f} = {edge_dist:.3f} in (최소값 가정)'
        ),
    })

    # 볼트 경로: 단부거리(end distance) 지배 전단파단(tearout) 한계상태를 추가한다.
    # §J6.1 Eq.J6.1-1: Pnv = 0.6·Fu·Anv, Anv = 2·t·e_net (패스너 1개당 양측 전단면).
    # e_net = 단부 순거리 = edge_dist - d_h/2 (보수적으로 표준홀 d_h ≈ d+1/16").
    # 볼트 파단 계수: φ=0.65 / Ω=2.22 (Table J6-1).
    # 스크류는 §J4 에 단부거리 강도식이 없으므로 적용하지 않는다(기하 최소거리만).
    if fastener_type != 'screw' and Pns > 0:
        d_hole = fastener_dia + 1.0 / 16.0  # 표준홀 직경 (보수적 가정)
        e_net = max(edge_dist - d_hole / 2.0, 0.0)
        Pnv_tearout = 0.6 * Fu * (2.0 * t * e_net)  # 공칭 전단파단강도 (kips)
        if design_method == 'LRFD':
            P_tearout = 0.65 * Pnv_tearout
        else:  # ASD
            P_tearout = Pnv_tearout / 2.22
        if P_tearout > 0 and P_tearout < Pns:
            # 단부거리 지배 전단파단이 베어링/전단강도보다 작으면 이를 채택
            Pns = P_tearout
            # 채택된 강도 변화에 따라 Step 4 의 필요 패스너 수를 재산정
            n_required = math.ceil(V_transfer / Pns)
            n_per_row = math.ceil(n_required / n_rows)
            n_total = n_per_row * n_rows
            n_per_row_actual = min(n_per_row, n_max_per_row)
            n_total_actual = n_per_row_actual * n_rows
            # 재산정된 배치에 맞춰 간격/판정도 갱신 — Step 5가 이미 기록돼 있으므로
            # 함께 갱신하지 않으면 반환 spacing/도면이 재산정 전 배치를 표시하게 된다.
            if n_per_row_actual > 1 and lap_each > 0:
                spacing = (lap_each - 2 * edge_dist) / (n_per_row_actual - 1)
            else:
                spacing = 0
            spacing_ok = spacing >= min_spacing if spacing > 0 else True
            for _st in steps:
                if _st.get('step') == 5:
                    _st['value'] = round(spacing, 2)
                    _st['formula'] = (
                        f'(§J6.1 재산정) Required: {n_total} ea, Max fit: {n_max_total} ea '
                        f'(Lap={lap_each:.2f} in, edge={edge_dist:.3f} in, min s=3d={min_spacing:.2f} in), '
                        f's = {spacing:.2f} in {"≥" if spacing_ok else "<"} {min_spacing:.2f} in'
                    )
                    _st['pass'] = spacing_ok and n_total <= n_max_total
            if n_total > n_max_total:
                warnings.append(
                    f'(§J6.1 재산정) 필요 패스너 {n_total} ea > Lap 내 최대 배치 {n_max_total} ea — '
                    f'Lap 길이를 늘리거나 패스너 사양을 변경하세요.'
                )
            if not spacing_ok:
                warnings.append(f'(§J6.1 재산정) 패스너 간격 {spacing:.2f} in < 최소 3d = {min_spacing:.2f} in')
            warnings.append(
                f'단부거리 지배 전단파단(§J6.1)이 패스너 강도를 지배: '
                f'{"φ" if design_method == "LRFD" else "1/Ω"}Pnv = {Pns:.3f} kips '
                f'(e = {edge_dist:.3f} in, e_net = {e_net:.3f} in). 필요 패스너 수가 '
                f'재산정되었습니다. 단부거리 e를 늘리면 인열 강도가 비례 증가하여 '
                f'볼트 수를 줄일 수 있습니다.'
            )
        steps.append({
            'step': '6a', 'name': 'Bolt End-Distance Shear Rupture (§J6.1)',
            'value': round(P_tearout, 3), 'unit': 'kips',
            'formula': (
                f'e_net = e - d_h/2 = {edge_dist:.3f} - {d_hole/2:.3f} = {e_net:.3f} in, '
                f'Pnv = 0.6·Fu·(2·t·e_net) = 0.6×{Fu:.2f}×(2×{t:.4f}×{e_net:.3f}) = {Pnv_tearout:.3f} kips, '
                f'{"φ" if design_method == "LRFD" else "1/Ω"}Pnv = {P_tearout:.3f} kips'
            ),
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
    Se = params.get('Se', 0) or params.get('Sf', 0)  # 유효 단면계수

    # §H2 검토용 전단강도 Vn: 미입력이면 §G2.1(비보강 웹)로 직접 산정한다 —
    # 본 도구는 d, t, Fy를 이미 보유하므로 외부 입력에 의존할 이유가 없다.
    # (과거에는 미입력 시 H2 검토를 통째로 건너뛰고 경고만 남겼음)
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

    flexure_ok = True
    flexure_dcr = None
    flexure_dcr_governing = None  # 국부/뒤틀림/H2 중 최대 DCR (헤드라인 표시용)
    Mn_lap = 0
    phi_Mn_lap = 0

    if Se > 0 and Fy > 0 and Mu > 0:
        # 단일 부재 국부좌굴 강도: Mnl = Se × Fy (§F3.1, Fn=Fy — Se 가 국부좌굴 반영)
        Mnl_single = Se * Fy  # kip-in
        # 2겹 합산 (AISI Example II-2A 방식)
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
                '뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간 휨강도에서 '
                '뒤틀림좌굴이 평가되지 않았습니다. 보수적으로 단면의 Mnd 를 확인하세요.'
            )

        # 지점부 휨-전단 상호작용(§H2) 검토: Vn은 입력값 또는 §G2.1 자동산정값.
        # §H2.1 Eq.H2-1(원형 상호작용): (Mu/φMn)^2 + (Vu/φVn)^2 ≤ 1.0
        Vn = Vn_in  # 단일 단면 공칭 전단강도 (kips)
        if Vn and Vn > 0 and Vu > 0 and phi_Mn_lap > 0:
            n_members_v = 2  # 2겹 단면의 전단강도 합산
            if design_method == 'LRFD':
                phi_Vn_lap = 0.95 * (Vn * n_members_v)  # §G φv=0.95 (LRFD)
            else:
                phi_Vn_lap = (Vn * n_members_v) / 1.60   # §G Ωv=1.60 (ASD)
            mv_term = (Mu / phi_Mn_lap) ** 2 + (Vu / phi_Vn_lap) ** 2 if phi_Vn_lap > 0 else float('inf')
            mv_ok = mv_term <= 1.0
            flexure_ok = flexure_ok and mv_ok
            flexure_dcr_governing = max(flexure_dcr_governing or 0, mv_term)
            steps.append({
                'step': '8b', 'name': 'Lap Combined Bending+Shear (§H2)',
                'value': round(mv_term, 3), 'unit': '',
                'formula': (
                    f'(Mu/{"φ" if design_method == "LRFD" else "1/Ω"}Mn)² + '
                    f'(Vu/{"φ" if design_method == "LRFD" else "1/Ω"}Vn)² = '
                    f'({Mu:.2f}/{phi_Mn_lap:.2f})² + ({Vu:.3f}/{phi_Vn_lap:.3f})² = {mv_term:.3f} ≤ 1.0'
                ),
                'pass': mv_ok,
            })
            if not mv_ok:
                warnings.append(
                    f'Lap 지점부 휨-전단 상호작용(§H2) 초과: 상호작용값 = {mv_term:.2f} > 1.0.'
                )
        elif Vu > 0:
            warnings.append(
                '단면 전단강도 Vn 을 산정할 수 없습니다(퇴화 기하) — Lap 지점부 '
                '휨-전단 상호작용(§H2) 검토를 수행하지 못했습니다.'
            )
    elif Mu > 0 and Se <= 0:
        warnings.append(
            'Se(유효 단면계수)가 미입력 — Lap 구간 휨강도 검토를 수행할 수 없습니다. '
            '설계 탭에서 단면 정보를 확인하세요.'
        )

    overall_pass = lap_ok and capacity_ok and spacing_ok and (n_total <= n_max_total) and flexure_ok
    if not capacity_ok:
        warnings.append(
            f'용량 부족: V_transfer = {V_transfer:.3f} kips > Capacity = {capacity:.3f} kips '
            f'(DCR = {utilization:.2f}). 패스너 수 또는 사양을 변경하세요.'
        )

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
        'Pns': Pns,
        'Pns_governing_mode': pns_mode,  # 전단 산정에 사용된 지배 한계상태
        'Vn_used': round(Vn_in, 3) if Vn_in else None,
        'Vn_auto': vn_auto,
        'utilization': round(utilization, 4),
        'flexure_dcr': round(flexure_dcr, 4) if flexure_dcr is not None else None,
        # 국부(§F3)·뒤틀림(§F4)·휨-전단(§H2) 중 최대 — 헤드라인 DCR이 pass 플래그와
        # 모순되지 않도록 렌더러는 이 값을 우선 사용한다.
        'flexure_dcr_governing': round(flexure_dcr_governing, 4) if flexure_dcr_governing is not None else None,
        'Mn_lap': round(Mn_lap, 2),
        'phi_Mn_lap': round(phi_Mn_lap, 2),
        'pass': overall_pass,
        'fastener_design': conn_result,
        'lap_ok': lap_ok,
        'min_lap': min_lap,
        'steps': steps,
        'warnings': warnings,
        # 도면용 단면/랩 치수
        'd': d,
        't': t,
        'lap_left_in': lap_left,
        'lap_right_in': lap_right,
    }


def check_lap_length(d: float, lap_left: float, lap_right: float) -> dict:
    """Lap 길이 검증 (§I6.2.1(g))

    Args:
        d: 부재 높이 (in)
        lap_left, lap_right: 각 방향 Lap 길이 (in)

    Returns:
        dict: {ok, min_lap, actual, message}
    """
    min_lap = 1.5 * d
    actual = min(lap_left, lap_right) if lap_left > 0 and lap_right > 0 else max(lap_left, lap_right)
    ok = actual >= min_lap

    return {
        'ok': ok,
        'min_lap_in': min_lap,
        'actual_in': actual,
        'message': '' if ok else f'Lap {actual:.2f} in < 1.5d = {min_lap:.2f} in (§I6.2.1(g))',
    }


def _screw_shear_strength(t1: float, t2: float, d_screw: float, Fu: float) -> float:
    """Screw 접합 전단 강도 (§J4.3.1)

    Pns = min(tilting, bearing, screw shear)
    """
    # Tilting (t2/t1 ≤ 1.0, single shear)
    Pns_tilt = 4.2 * (t2 ** 3 * d_screw) ** 0.5 * Fu
    # Bearing
    Pns_bear = 2.7 * t1 * d_screw * Fu
    # Screw shear (conservative estimate)
    Pns_screw = 0.5 * math.pi * (d_screw / 2) ** 2 * 62  # 62 ksi screw shear strength

    Pns = min(Pns_tilt, Pns_bear, Pns_screw)
    return Pns


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
