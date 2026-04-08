"""Lap Splice Connection Design (AISI S100 Chapter J)

§I6.2.1(g): Lap 길이 ≥ 1.5d
§J3.3: 볼트 접합 Lapped Z-members
§J4: Screw 접합
§J2.4.1: Arc Seam Welds on Lap Joint

Lap 구간은 접합부(connection)로 설계 — 전단 전달용 볼트/스크류 개수 산정
"""

import math


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
    fastener_dia = params.get('fastener_dia', 0.19)  # #12 screw ≈ 0.19in
    n_rows = params.get('n_rows', 2)

    steps = []
    warnings = []

    # Step 1: Lap 길이 검증 (§I6.2.1(g))
    min_lap = 1.5 * d
    lap_total = lap_left + lap_right
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

    # Step 2: 전달 전단력 산정
    # Lap 구간에서 전달해야 하는 전단력 = 모멘트 변화량 / Lap 길이
    if lap_total > 0 and Mu > 0:
        V_transfer = Mu / (lap_total / 2)  # 각 Lap 방향의 전단 전달력
    else:
        V_transfer = Vu  # fallback

    steps.append({
        'step': 2, 'name': 'Transfer Shear Force',
        'value': round(V_transfer, 3), 'unit': 'kips',
        'formula': f'V_transfer = Mu / (Lap/2) = {Mu:.2f} / {lap_total/2:.2f} = {V_transfer:.3f} kips'
            if Mu > 0 and lap_total > 0
            else f'V_transfer = Vu = {Vu:.3f} kips',
    })

    # Step 3: 개별 패스너 강도
    if fastener_type == 'screw':
        Pns = _screw_shear_strength(t, t, fastener_dia, Fu)
        fastener_label = f'Screw #{_screw_gauge(fastener_dia)}'
    else:
        Pns = _bolt_bearing_strength(t, fastener_dia, Fu)
        fastener_label = f'Bolt d={fastener_dia:.3f} in'

    steps.append({
        'step': 3, 'name': f'Fastener Strength ({fastener_label})',
        'value': round(Pns, 3), 'unit': 'kips',
        'formula': f'Pns = {Pns:.3f} kips per fastener ({fastener_type})',
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
        'formula': f'n = V/{{"Pns"}} = {V_transfer:.3f}/{Pns:.3f} = {n_required} → {n_rows} rows × {n_per_row}/row = {n_total} ea'
            if Pns > 0 else 'N/A',
    })

    # Step 5: 패스너 배치 간격
    if n_per_row > 1 and lap_each > 0:
        spacing = lap_each / (n_per_row + 1)
        min_spacing = 3 * fastener_dia
        spacing_ok = spacing >= min_spacing
    else:
        spacing = 0
        spacing_ok = True

    steps.append({
        'step': 5, 'name': 'Fastener Spacing',
        'value': round(spacing, 2), 'unit': 'in',
        'formula': f's = {lap_each:.2f} / ({n_per_row}+1) = {spacing:.2f} in {"≥" if spacing_ok else "<"} 3d = {3*fastener_dia:.2f} in',
        'pass': spacing_ok,
    })
    if not spacing_ok:
        warnings.append(f'패스너 간격 {spacing:.2f} in < 최소 3d = {3*fastener_dia:.2f} in')

    # Step 6: Edge/End distance
    edge_dist = max(1.5 * fastener_dia, 0.375)  # §J3.3, §J4
    end_dist = max(1.5 * fastener_dia, 0.375)

    steps.append({
        'step': 6, 'name': 'Edge/End Distance',
        'value': round(edge_dist, 3), 'unit': 'in',
        'formula': f'e = max(1.5d, 3/8") = {edge_dist:.3f} in',
    })

    return {
        'fastener_type': fastener_type,
        'fastener_dia': fastener_dia,
        'fastener_label': fastener_label,
        'n_total': n_total,
        'n_rows': n_rows,
        'n_per_row': n_per_row,
        'spacing': spacing,
        'edge_distance': edge_dist,
        'V_transfer': V_transfer,
        'Pns': Pns,
        'lap_ok': lap_ok,
        'min_lap': min_lap,
        'steps': steps,
        'warnings': warnings,
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


def _bolt_bearing_strength(t: float, d_bolt: float, Fu: float) -> float:
    """Bolt 접합 베어링 강도 (§J3.3.1)

    Pnb = C × mf × d × t × Fu (Eq. J3.3.1-1)
    """
    C = 2.22  # Table J3.3.1-1, standard hole
    mf = 1.0  # modification factor
    Pnb = C * mf * d_bolt * t * Fu
    return Pnb


def _screw_gauge(d: float) -> str:
    """Screw 직경으로 게이지 추정"""
    if d <= 0.14:
        return '10'
    elif d <= 0.17:
        return '12'
    elif d <= 0.21:
        return '14'
    else:
        return f'{d:.3f}"'
