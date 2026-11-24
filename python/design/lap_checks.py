"""랩 접합(lap_connection.design_lap_connection)의 검토 항목(design_checks) 만들기.

엔진의 판정(parts = [랩 길이 미입력 → None] + [용량, 간격, 배치 개수] + [휨, 패스너])을 그대로 옮긴다.
랩 길이 1.5d 는 §I6.2.1(g) · §J3 의 적용 조건이라 판정에 들지 않는다(counts=False) — 미입력이면
엔진이 판정을 None 으로 두므로 그때만 not_evaluated 로 판정에 든다.
"""

from design.checks import (
    Trace, q, src, spec, make_check, design_strength_step, factor, connection_check_id, set_governing,
    apply_context, demand_source,
)
from design.notices import N as _nt, joined as _joined, prefixed as _prefixed, name_ko_prefix as _name_ko_prefix  # noqa: E402


LAP_BLOCK_SHEAR_NOTE = (
    _nt('lap.scope.j6_3_j6_block_shear_lap'))
LAP_BLOCK_SHEAR_ASSUMPTION = (
    _nt('lap.assumption.j6_3_j6_lap_fastener_group'))


from design.aisi_s100 import LAP_MANUAL_ASSUMPTION, LAP_DIST_UNSTATED  # noqa: E402

LAP_LTB_UNSTATED_TOOL = (_nt('lap.reason.lap_flexure_mn_se', manual_quote=LAP_MANUAL_ASSUMPTION))


def build(ck: dict) -> list:
    dm, p = ck['dm'], ck['params']
    checks = []
    lap = ck['lap_chk']

    # --- 랩 길이 (적용 조건)
    tr = Trace()
    if ck['lap_ok'] is None:
        checks.append(make_check('lap.length_condition', design_method=dm, verdict='not_evaluated',
                                 reason=lap['message']))
    else:
        dem = q('1.5d', lap['min_lap_in'], 'length', spec())
        cap = q('L_lap', lap['actual_in'], 'length', src('user_input', key='min(lap_left_in, lap_right_in)'))
        r = lap['min_lap_in'] / lap['actual_in'] if lap['actual_in'] > 0 else None
        v = 'pass' if ck['lap_ok'] else 'fail'
        tr.add('verdict', 'min(L_left, L_right) ≥ 1.5 d', inputs=[dem, cap], result=q('ratio', r, 'dimensionless'),
               verdict=v)
        checks.append(make_check('lap.length_condition', design_method=dm, verdict=v, demand=dem, capacity=cap,
                                 ratio=r, steps=tr.steps, counts=False,
                                 reason=(lap['message'] or None),
                                 note=_nt('lap.label.lap_length_check_note')))

    # --- 패스너 무리: V_transfer ≤ n·Pns (사내 합리적 해석 §A1.2(c))
    tr = Trace()
    mu = q('Mu', ck['Mu'], 'moment', demand_source(p, 'Mu_support'))
    vu = q('Vu', ck['Vu'], 'force', demand_source(p, 'Vu_support'))
    if ck['Mu'] > 0 and ck['d_lever'] > 0:
        i_arm = tr.add('equation', 'arm = d − t', inputs=[q('d', ck['d'], 'length', src('user_input', key='d')),
                                                         q('t', ck['t'], 'length', src('user_input', key='t'))],
                       result=q('arm', ck['d_lever'], 'length'))
        i_vf = tr.add('demand', 'V_flange = Mu / arm  (in-house rational model, §A1.2(c))', inputs=[mu, tr.ref(i_arm)],
                      result=q('V_flange', ck['Mu'] / ck['d_lever'], 'force'))
        i_v = tr.add('demand', 'V_transfer = max(V_flange, Vu)', inputs=[tr.ref(i_vf), vu],
                     result=q('V_transfer', ck['V_transfer'], 'force'))
    else:
        i_v = tr.add('demand', 'V_transfer = Vu', inputs=[vu], result=q('V_transfer', ck['V_transfer'], 'force'))
    cr = ck['conn_result']
    pns_id = connection_check_id(ck['pns_mode']) if ck['pns_mode'] else None
    pns = q('Pns', ck['Pns'], 'force', src('check', id=pns_id, note=_nt('lap.note.one_fastener_governing_plane')))
    if ck['Pns'] > 0:
        i_n = tr.add('equation', 'n = ceil(ceil(V_transfer/Pns) / rows) · rows', inputs=[tr.ref(i_v), pns,
                     q('rows', ck['n_rows'], 'count', src('user_input', key='n_rows'))],
                     result=q('n', ck['n_total'], 'count'))
        i_na = tr.add('equation', 'n_used = min(n/rows, n_fit/row) · rows',
                      inputs=[tr.ref(i_n), q('n_fit/row', ck['n_max_per_row'], 'count',
                                             src('specification', note=_nt('lap.note.fit_within_lap_lap'))),
                              q('rows', ck['n_rows'], 'count', src('user_input', key='n_rows'))],
                      result=q('n_used', ck['n_total_actual'], 'count'))
        i_c = tr.add('design_strength', 'capacity = n_used Pns', inputs=[tr.ref(i_na), pns],
                     result=q('capacity', ck['capacity'], 'force'))
        r = ck['utilization']
        if ck['pns_assumed']:
            v, why = 'not_evaluated', _nt('lap.reason.pns_from_assumed_limit', pns_mode=ck['pns_mode'])
        elif not ck['capacity_ok']:
            v, why = 'fail', None
        elif ck['fastener_unverified']:
            v = 'not_evaluated'
            why = _nt('lap.reason.fastener_strength_verified', items=_joined('; ', (
                _prefixed(f"{x['name']} — ", x['reason'], _name_ko_prefix(x['name'], ' — ')) for x in ck['fastener_unverified'])))
        else:
            v, why = 'pass', None
        tr.add('verdict', 'V_transfer / capacity ≤ 1', inputs=[tr.ref(i_v), tr.ref(i_c)],
               result=q('ratio', r, 'dimensionless'), verdict=v)
        checks.append(make_check('lap.fastener_group', design_method=dm, verdict=v,
                                 demand=q('V_transfer', ck['V_transfer'], 'force'),
                                 capacity=q('capacity', ck['capacity'], 'force'), ratio=r, reason=why, steps=tr.steps,
                                 reference={'capacity': q('capacity', ck['capacity'], 'force'), 'ratio': r}
                                 if v == 'not_evaluated' else None,
                                 mirrors={'capacity': {'path': 'capacity', 'digits': None},
                                          'ratio': {'path': 'fastener_utilization', 'digits': 4}},
                                 basis='in_house_rational_analysis_A1.2c'))
    else:
        checks.append(make_check('lap.fastener_group', design_method=dm, verdict='fail' if not ck['pns_assumed']
                                 else 'not_evaluated', demand=q('V_transfer', ck['V_transfer'], 'force'),
                                 capacity=q('capacity', 0.0, 'force'), ratio=None,
                                 reason=_nt('lap.reason.fastener_design_strength'), steps=tr.steps))

    # --- 배치 개수
    tr = Trace()
    fits = ck['n_total'] <= ck['n_max_total']
    dem = q('n', ck['n_total'], 'count', src('check', id='lap.fastener_group'))
    cap = q('n_fit', ck['n_max_total'], 'count', spec())
    r = ck['n_total'] / ck['n_max_total'] if ck['n_max_total'] > 0 and ck['n_total'] > 0 else None
    v = 'pass' if fits else ('not_evaluated' if ck['pns_assumed'] else 'fail')
    tr.add('verdict', 'n ≤ n_fit', inputs=[dem, cap], result=q('ratio', r, 'dimensionless'), verdict=v)
    checks.append(make_check('lap.fastener_count', design_method=dm, verdict=v, demand=dem, capacity=cap, ratio=r,
                             steps=tr.steps, reason='from an assumed Pns' if v == 'not_evaluated' else None,
                             reference={'ratio': r} if v == 'not_evaluated' else None))

    # --- 간격
    if ck['spacing'] > 0:
        tr = Trace()
        dem = q('3d', ck['min_spacing'], 'length', spec())
        cap = q('s', ck['spacing'], 'length', src('specification', note=_nt('lap.note.spacing_from_count')))
        r = ck['min_spacing'] / ck['spacing']
        v = 'pass' if ck['spacing_ok'] else ('not_evaluated' if ck['pns_assumed'] else 'fail')
        tr.add('verdict', 's ≥ 3d', inputs=[dem, cap], result=q('ratio', r, 'dimensionless'), verdict=v)
        checks.append(make_check('lap.fastener_spacing', design_method=dm, verdict=v, demand=dem, capacity=cap,
                                 ratio=r, steps=tr.steps, mirrors={'capacity': {'path': 'spacing', 'digits': None}},
                                 reference={'ratio': r} if v == 'not_evaluated' else None))
    else:
        checks.append(make_check('lap.fastener_spacing', design_method=dm, verdict='not_applicable',
                                 reason=_nt('lap.reason.one_fastener_per_row')))

    # --- 패스너 무리의 블록 전단(J6.3) — 장력면을 뺀 하한으로 평가하고 판정에 넣는다(2026-11-24 결정)
    checks.append(_block_shear(ck))

    # --- 패스너 상세(J3.2/J4.2 끝단 거리 등) — 접합 엔진의 항목 그대로
    for c in cr.get('design_checks') or []:
        if c['group'] == 'conn.detailing' and c['verdict'] in ('pass', 'fail'):
            c = dict(c)
            c.pop('mirrors', None)
            c['part_of'] = 'fastener_design'
            checks.append(c)

    # --- 랩 구간 휨
    fx = ck['flex']
    no_m = _nt('lap.reason.no_support_moment_stated')
    phi_b, om_b = 0.90, 1.67
    if ck['Mu'] <= 0:
        for cid in ('lap.flexure.local', 'lap.flexure.distortional', 'lap.bending_shear'):
            checks.append(make_check(cid, design_method=dm, verdict='not_applicable', reason=no_m))
    else:
        if fx.get('local'):
            lo = fx['local']
            tr = Trace()
            i_m = tr.add('equation', 'Mnℓ = Se Fy  (one member; laterally braced in the lap)', equation='F3.1-1',
                         inputs=[q('Se', ck['Se'], 'section_modulus', src('user_input', key='Se')),
                                 q('Fy', ck['Fy'], 'stress', src('material', key='Fy'))],
                         result=q('Mnℓ', lo['Mnl_single'], 'moment'))
            i_l = tr.add('equation', 'Mn,lap = 2 Mnℓ  (two lapped members, Manual II-2A assumption)',
                         inputs=[tr.ref(i_m), q('members', lo['n_members'], 'count', spec())],
                         result=q('Mn,lap', lo['Mn_lap'], 'moment'))
            i_d = design_strength_step(tr, dm, tr.ref(i_l), phi_b, om_b, lo['phi_Mn_lap'],
                                       'φbMn,lap' if dm == 'LRFD' else 'Mn,lap/Ωb', 'moment',
                                       phi_symbol='φb', omega_symbol='Ωb')
            v = 'pass' if lo['dcr'] <= 1.0 else 'fail'
            unstated = fx.get('ltb_unstated') and v == 'pass'
            if unstated:
                v = 'not_evaluated'
            tr.add('verdict', f"Mu / {tr.steps[i_d]['result']['symbol']} ≤ 1", inputs=[mu, tr.ref(i_d)],
                   result=q('ratio', lo['dcr'], 'dimensionless'),
                   verdict=v)
            if not fx.get('ltb_unstated'):
                tr.steps[i_m]['assumption_source'] = src('user_input', key='lap_restrained',
                                                         note=_nt('lap.note.fn_fy_lapped_section'))
            checks.append(make_check('lap.flexure.local', design_method=dm, verdict=v, demand=mu,
                                     reason=(LAP_LTB_UNSTATED_TOOL if unstated else None),
                                     reference=({'capacity': q('φbMn,lap' if dm == 'LRFD' else 'Mn,lap/Ωb',
                                                               lo['phi_Mn_lap'], 'moment'), 'ratio': lo['dcr']}
                                                if unstated else None),
                                     capacity=q('φbMn,lap' if dm == 'LRFD' else 'Mn,lap/Ωb', lo['phi_Mn_lap'], 'moment'),
                                     nominal=q('Mn,lap', lo['Mn_lap'], 'moment'),
                                     factor_=factor(dm, phi_b, om_b, 'φb', 'Ωb'), ratio=lo['dcr'], steps=tr.steps,
                                     mirrors={'nominal': {'path': 'Mn_lap', 'digits': 2},
                                              'capacity': {'path': 'phi_Mn_lap', 'digits': 2},
                                              'ratio': {'path': 'flexure_dcr', 'digits': 4}}))
        else:
            ref = None
            if fx.get('reference'):
                rf = fx['reference']
                ref = {'capacity': q('φbMn,ref', rf['phi_ref'], 'moment'), 'ratio': rf['dcr'],
                       'basis': _nt('lap.label.gross_sf_reference')}
            checks.append(make_check('lap.flexure.local', design_method=dm, verdict='not_evaluated',
                                     reason=_nt('lap.reason.se_effective_section_modulus'), reference=ref))
        if fx.get('dist'):
            ds = fx['dist']
            tr = Trace()
            i_l = tr.add('equation', 'Mnd,lap = 2 Mnd', inputs=[q('Mnd', ds['Mnd_single'], 'moment',
                                                                  src('user_input', key='Mnd'))],
                         result=q('Mnd,lap', ds['Mnd_lap'], 'moment'))
            i_d = design_strength_step(tr, dm, tr.ref(i_l), phi_b, om_b, ds['phi_Mnd_lap'],
                                       'φbMnd,lap' if dm == 'LRFD' else 'Mnd,lap/Ωb', 'moment',
                                       phi_symbol='φb', omega_symbol='Ωb')
            v = 'pass' if ds['ok'] else 'fail'
            tr.add('verdict', f"Mu / {tr.steps[i_d]['result']['symbol']} ≤ 1", inputs=[mu, tr.ref(i_d)],
                   result=q('ratio', ds['dcr'], 'dimensionless'), verdict=v)
            checks.append(make_check('lap.flexure.distortional', design_method=dm, verdict=v, demand=mu,
                                     capacity=q('φbMnd,lap' if dm == 'LRFD' else 'Mnd,lap/Ωb', ds['phi_Mnd_lap'],
                                                'moment'),
                                     nominal=q('Mnd,lap', ds['Mnd_lap'], 'moment'),
                                     factor_=factor(dm, phi_b, om_b, 'φb', 'Ωb'), ratio=ds['dcr'], steps=tr.steps))
        elif fx.get('local') and fx.get('dist_restrained'):
            checks.append(make_check('lap.flexure.distortional', design_method=dm, verdict='not_applicable',
                                     reason=_nt('lap.reason.lap_restrained_true_user', manual_quote=LAP_MANUAL_ASSUMPTION),
                                     restraint_source=src('user_input', key='lap_restrained')))
        elif fx.get('local'):
            checks.append(make_check('lap.flexure.distortional', design_method=dm, verdict='not_evaluated',
                                     reason=LAP_DIST_UNSTATED))
        else:
            checks.append(make_check('lap.flexure.distortional', design_method=dm, verdict='not_evaluated',
                                     reason=_nt('lap.reason.lap_flexure_evaluated_no')))
        if fx.get('h2'):
            h = fx['h2']
            tr = Trace()
            vn = q('Vn', h['Vn'], 'force', src('specification', note=_nt('lap.note.g2_1_g2_one_web_computed'))
                   if h['vn_auto'] else src('user_input', key='Vn'))
            # 두 겹 부재의 전단강도 합 — ×2 를 기호에 숨기지 않고 단계로(V6-05)
            i_vl = tr.add('equation', 'Vn,lap = 2 Vn  (two lapped members)',
                          inputs=[vn, q('members', 2, 'count', spec())], result=q('Vn,lap', 2 * h['Vn'], 'force'))
            v_sym = 'φvVn,lap' if dm == 'LRFD' else 'Vn,lap/Ωv'
            m_sym = 'φbMn,lap' if dm == 'LRFD' else 'Mn,lap/Ωb'
            i_v = design_strength_step(tr, dm, tr.ref(i_vl), 0.95, 1.60, h['phi_Vn_lap'], v_sym, 'force',
                                       phi_symbol='φv', omega_symbol='Ωv')
            lo = fx['local']
            i_x = tr.add('equation', f'[(Mu / {m_sym})² + (Vu / {v_sym})²]^0.5', equation='H2-1',
                         inputs=[mu, q(m_sym, lo['phi_Mn_lap'], 'moment', src('check', id='lap.flexure.local')),
                                 vu, tr.ref(i_v)], result=q('H2', h['mv'], 'dimensionless'))
            v = 'pass' if h['ok'] else 'fail'
            unstated_h2 = fx.get('ltb_unstated') and v == 'pass'     # V9a-03: 국부 휨과 같은 규칙
            if unstated_h2:
                v = 'not_evaluated'
            tr.add('verdict', 'H2 ≤ 1.0', inputs=[tr.ref(i_x), q('limit', 1.0, 'dimensionless', spec())],
                   result=q('ratio', h['mv'], 'dimensionless'), verdict=v)
            if unstated_h2:
                checks.append(make_check('lap.bending_shear', design_method=dm, verdict=v,
                                         reason=_nt('lap.reason.h2_unstated'), steps=tr.steps,
                                         reference={'capacity': q('limit', 1.0, 'dimensionless'), 'ratio': h['mv']}))
            else:
                checks.append(make_check('lap.bending_shear', design_method=dm, verdict=v,
                                     demand=q('H2', h['mv'], 'dimensionless'), capacity=q('limit', 1.0, 'dimensionless'),
                                         ratio=h['mv'], steps=tr.steps,
                                         mirrors={'ratio': {'path': 'flexure_dcr_governing', 'digits': 4}}
                                         if h['mv'] >= max(lo['dcr'], (fx.get('dist') or {}).get('dcr') or 0)
                                         else None))
        elif fx.get('h2_missing'):
            checks.append(make_check('lap.bending_shear', design_method=dm, verdict='not_evaluated',
                                     reason=_nt('lap.reason.section_shear_strength_vn')))
        elif ck['Vu'] <= 0:
            checks.append(make_check('lap.bending_shear', design_method=dm, verdict='not_applicable',
                                     reason=_nt('lap.reason.no_support_shear_vu')))
        else:
            checks.append(make_check('lap.bending_shear', design_method=dm, verdict='not_evaluated',
                                     reason=_nt('lap.reason.lap_flexure_evaluated_no')))

    set_governing(checks)
    apply_context(checks, p)
    return checks


# 랩 검토 항목이 쓰는 소요(V9a-02)
_NEEDS = {
    'lap.fastener_group': ('Mu_support', 'Vu_support'), 'lap.fastener_count': ('Mu_support', 'Vu_support'),
    'lap.block_shear': ('Mu_support', 'Vu_support'), 'lap.flexure.local': ('Mu_support',),
    'lap.flexure.distortional': ('Mu_support',), 'lap.bending_shear': ('Mu_support', 'Vu_support'),
}


def apply_missing_demands(checks, missing, zero_unstated, demand_positive=True):
    """소요가 없거나(missing) 밝히지 않은 0(zero_unstated)이면 그 소요를 쓰는 항목은 판정 없음 — 통과 · 해당 없음은
    미평가로, 불합격은 그대로(준 소요로 이미 넘으면 전체 소요로도 넘는다: 전달력 max(Mu/(d−t), Vu) 와 H2 는 두 소요에
    대해 줄지 않는다). 계약 §6.3."""
    if not missing and not zero_unstated:
        return checks
    from design.member_checks import demote_to_not_evaluated
    out = []
    for c in checks:
        need = _NEEDS.get(c.get('id'), ())
        miss = [k for k in need if k in missing]
        zero = [k for k in need if k in zero_unstated]
        if not miss and not zero:
            out.append(c)
            continue
        why = []
        if miss:
            why.append(_nt('lap.reason.demand_not_given', inputs=', '.join(miss)))
        if zero:
            why.append(_nt('lap.reason.zero_demand_not_stated', inputs=', '.join(zero)))
        reason = why[0] if len(why) == 1 else _joined('; ', why)
        if c['verdict'] == 'fail' and demand_positive:
            c = dict(c, demand_incomplete=miss + zero,
                     reason=_joined('; ', [r for r in (c.get('reason'), _nt('lap.reason.fail_with_incomplete_demand',
                                                                            inputs=', '.join(miss + zero))) if r]))
        elif c['verdict'] == 'pass':
            c = demote_to_not_evaluated(c, reason)
        else:
            c = dict(c, verdict='not_evaluated', reason=reason)
            c.pop('mirrors', None)
        out.append(c)
    set_governing(out)
    return out


def _block_shear(ck):
    """J6.3 하한: Pnr = min(0.6 Fy Agv, 0.6 Fu Anv), Ant = 0 (장력면 무시). 입력은 랩 설계가 이미 가진 것뿐."""
    dm, p = ck['dm'], ck['params']
    bs = ck.get('block') or {}
    if not bs.get('applies', True):
        return make_check('lap.block_shear', design_method=dm, verdict='not_applicable',
                          reason=_nt('lap.reason.j6_j6_screw_connections_rupture'))
    if bs.get('Pnr') is None:
        return make_check('lap.block_shear', design_method=dm, verdict='not_evaluated',
                          reason=_nt('lap.reason.no_fastener_layout_fastener'))
    tr = Trace()
    t = q('t', ck['t'], 'length', src('user_input', key='t'))
    i_L = tr.add('equation', 'Lv = e + (m − 1) s  (shear-plane length: member end to the last fastener of a row)',
                 equation='J6.3',
                 inputs=[q('e', ck['edge_dist'], 'length', src('user_input', key='end_distance')
                           if (p.get('end_distance') or 0) > 0 else
                           src('engine_default', key='end_distance', note=_nt('lap.note.e_min_1_5d'))),
                         q('m', bs['m'], 'count', src('check', id='lap.fastener_count', note=_nt('lap.note.fasteners_per_row'))),
                         q('s', ck['spacing'], 'length', src('specification', note=_nt('lap.note.pitch_from_rows')))],
                 result=q('Lv', bs['Lv'], 'length'))
    i_gv = tr.add('equation', 'Agv = 2 t Lv  (two shear planes, outer fastener rows)', inputs=[t, tr.ref(i_L)],
                  result=q('Agv', bs['Agv'], 'area'))
    dh = q('dh', bs['dh'], 'length', src('check', id='conn.j6.shear_rupture', note=_nt('lap.note.j6_1_hole_diameter_used_j6')))
    m_q = q('m', bs['m'], 'count', src('check', id='lap.fastener_count', note=_nt('lap.note.fasteners_per_row')))
    i_nv = tr.add('equation', 'Anv = 2 t (Lv − (m − 0.5) dh)', inputs=[t, tr.ref(i_L), m_q, dh],
                  result=q('Anv', bs['Anv'], 'area'))
    i_1 = tr.add('equation', 'Pnr1 = 0.6 Fy Agv  (Eq. J6.3-1 with Ant = 0)', equation='J6.3-1',
                 inputs=[q('Fy', ck['Fy'], 'stress', src('material', key='Fy')), tr.ref(i_gv)],
                 result=q('Pnr1', bs['P1'], 'force'))
    i_2 = tr.add('equation', 'Pnr2 = 0.6 Fu Anv  (Eq. J6.3-2 with Ant = 0)', equation='J6.3-2',
                 inputs=[q('Fu', p.get('Fu'), 'stress', src('material', key='Fu')), tr.ref(i_nv)],
                 result=q('Pnr2', bs['P2'], 'force'))
    i_n = tr.add('equation', 'Pnr = min(Pnr1, Pnr2)', inputs=[tr.ref(i_1), tr.ref(i_2)], result=q('Pnr', bs['Pnr'], 'force'))
    sym = 'φPnr' if dm == 'LRFD' else 'Pnr/Ω'
    i_d = design_strength_step(tr, dm, tr.ref(i_n), bs['phi'], bs['omega'], bs['Pa'], sym, 'force')
    dem = q('V_transfer', ck['V_transfer'], 'force', src('check', id='lap.fastener_group'))
    v = 'pass' if bs['ok'] else 'fail'
    if ck['pns_assumed']:
        v = 'fail' if not bs['ok'] else 'not_evaluated'
    tr.add('verdict', f'V_transfer / {sym} ≤ 1', inputs=[dem, tr.ref(i_d)], result=q('ratio', bs['ratio'], 'dimensionless'),
           verdict=v)
    return make_check('lap.block_shear', design_method=dm, verdict=v, demand=dem, capacity=q(sym, bs['Pa'], 'force'),
                      nominal=q('Pnr', bs['Pnr'], 'force'), factor_=factor(dm, bs['phi'], bs['omega']),
                      ratio=bs['ratio'], steps=tr.steps, basis='lower_bound_tension_plane_ignored',
                      reason=('from an assumed Pns layout' if v == 'not_evaluated' else None),
                      reference={'capacity': q(sym, bs['Pa'], 'force'), 'ratio': bs['ratio']}
                      if v == 'not_evaluated' else None,
                      assumed_lower_bound=True)
