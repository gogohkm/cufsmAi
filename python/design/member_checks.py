"""부재 설계(aisi_s100)의 검토 항목(design_checks) 만들기.

aisi_s100 의 각 설계 함수가 계산을 마친 자리에서 자기 지역 변수(같은 객체)를 ctx 로 넘기면
여기서 계약 모양으로 엮는다. 숫자를 다시 계산하지 않는다 — 모드별 설계강도(φ·Pne 등)처럼
엔진에 따로 없던 곱 하나만 새로 만들고, 그것도 지배 모드에서는 엔진의 φ·Pn 과 같은 연산이다.
"""

from design.checks import (
    Trace, q, src, spec, make_check, ratio_of, verdict_from, verdict_step, design_strength_step,
    factor, demand_source,
)
from design.notices import N as _nt, joined as _joined  # noqa: E402

PI = 'π'


# ---------------------------------------------------------------- 공통

def ne_items(not_evaluated, *prefixes):
    """엔진의 not_evaluated 목록에서 이 한계상태에 걸린 항목(이름 접두로)."""
    out = []
    for item in not_evaluated or []:
        s = item if isinstance(item, str) else str(item)
        if any(s.startswith(p) for p in prefixes):
            out.append(s)
    return out


def _sec(key, ctx):
    return src('section_property', key=key, generated=True if ctx.get('generated') else None)


def _len_src(key, params, defaulted):
    if defaulted:
        return src('engine_default', key=key, note='120 in — Effective length defaulted')
    return src('user_input', key=key)


def buckling_src(label, dsm, prefix, mode):
    """좌굴값 출처 — §4.1 식별 계약(FSM 극소 · 단일 극소 · 해석식 · 하한으로 올림)."""
    label = str(label or '')
    hw_keys = [prefix + ('Lcrl' if mode == 'local' else 'Lcrd')]
    if prefix == 'M_' and mode == 'distortional':
        hw_keys.append('Lcrd')
    hw = next((dsm.get(k) for k in hw_keys if isinstance(dsm.get(k), (int, float)) and dsm.get(k) > 0), None)
    if label.startswith('FSM'):
        single = bool(dsm.get(prefix + 'single_minimum'))
        method = 'fsm_single_minimum' if single else 'fsm_minimum'
        iso = dsm.get(prefix + ('local_isolated' if mode == 'local' else 'dist_isolated'))
        return src('buckling_analysis', method=method, label=label,
                   half_wavelength=q('L', hw, 'length') if hw else None,
                   isolated=iso if isinstance(iso, bool) else None,
                   classification=dsm.get(prefix + 'classification_method'))
    method = 'analytic_raised_to_floor' if 'floor' in label else 'analytic'
    return src('buckling_analysis', method=method, label=label)


def strength_check(cid, tr, ctx, nominal_idx, nom_symbol, cap_symbol, quantity, demand,
                   *, phi, omega, trusted=True, untrusted_reason=None, mirrors=None,
                   phi_symbol='φ', omega_symbol='Ω', location=None, group=None, no_demand_reason=None):
    """공칭강도 단계 다음의 설계강도 · 판정 단계를 붙이고 항목을 만든다.

    demand: q(...) (소요강도, source 포함) 또는 None/0 — 없으면 not_evaluated(소요 없음).
    """
    dm = ctx['dm']
    nom = tr.steps[nominal_idx]['result']['value']
    cap = phi * nom if dm == 'LRFD' else nom / omega
    i_ds = design_strength_step(tr, dm, tr.ref(nominal_idx, nom_symbol), phi, omega, cap, cap_symbol,
                                quantity, phi_symbol=phi_symbol, omega_symbol=omega_symbol)
    cap_q = q(cap_symbol, cap, quantity)
    nom_q = q(nom_symbol, nom, quantity)
    fac = factor(dm, phi, omega, phi_symbol, omega_symbol)
    dval = demand['value'] if demand else None
    if not dval or dval <= 0:
        return make_check(cid, design_method=dm, verdict='not_evaluated', demand=None,
                          reason=no_demand_reason or _nt('member.reason.no_required_strength_given'),
                          steps=tr.steps, reference={'capacity': cap_q, 'nominal': nom_q},
                          location=location, group=group, mirrors=mirrors)
    r = ratio_of(dval, cap)
    if r is None:
        # 강도 0 에 소요 > 0 — 엔진은 E2/F2 를 평가하지 못한 경우가 아니면 불합격이다.
        v = 'fail' if trusted else 'not_evaluated'
        tr.add('verdict', f'{demand["symbol"]} / {cap_symbol}', inputs=[demand, tr.ref(i_ds)],
               result=None, verdict=v, note='zero design strength')
        return make_check(cid, design_method=dm, verdict=v, demand=demand, capacity=cap_q, nominal=nom_q,
                          factor_=fac, ratio=None, reason='zero design strength' if trusted else untrusted_reason,
                          steps=tr.steps, location=location, group=group, mirrors=mirrors,
                          trusted=trusted if not trusted else None)
    v = verdict_from(r, trusted=trusted)
    verdict_step(tr, demand, tr.ref(i_ds), r, v)
    reason = None
    ref = None
    if not trusted:
        reason = untrusted_reason
        if v == 'not_evaluated':
            ref = {'capacity': cap_q, 'nominal': nom_q, 'ratio': r}
    return make_check(cid, design_method=dm, verdict=v, demand=demand, capacity=cap_q, nominal=nom_q,
                      factor_=fac, ratio=r, reason=reason, steps=tr.steps, reference=ref,
                      location=location, group=group, mirrors=mirrors,
                      trusted=False if not trusted else None)


def not_evaluated(cid, ctx, reason, *, steps=None, location=None, group=None, reference=None):
    return make_check(cid, design_method=ctx['dm'], verdict='not_evaluated', reason=reason,
                      steps=steps or [], steps_unavailable=reason, location=location, group=group,
                      reference=reference)


def not_applicable(cid, ctx, reason, *, location=None, group=None):
    return make_check(cid, design_method=ctx['dm'], verdict='not_applicable', reason=reason,
                      steps=[], steps_unavailable=reason, location=location, group=group)


def _mirror(path, digits):
    return {'path': path, 'digits': digits}


# ---------------------------------------------------------------- 압축 (E)

def _column_fcre_steps(tr, ctx):
    """§E2 Fcre 의 단계. 돌려주는 값: Fcre 단계 번호(없으면 None)."""
    p = ctx['params']
    if ctx['Fcre_override'] > 0:
        return tr.add('elastic_buckling', 'Fcre = rational elastic buckling stress (input)',
                      equation=None,
                      inputs=[q('Fcre', ctx['Fcre'], 'stress',
                                src('user_input', key='Fcre', method='user_supplied'))],
                      result=q('Fcre', ctx['Fcre'], 'stress'))
    fr = ctx['Fcre_result']
    tc = fr.get('trace')
    if not tc or not fr.get('Fcre'):
        return None
    miss = ctx['missing_len']
    E = q('E', tc['E'], 'stress', spec())
    A = q('A', tc['Ag'], 'area', _sec('A', ctx))
    L = {k: q(k, tc[k], 'length', _len_src(k, p, k in miss)) for k in ('KxLx', 'KyLy', 'KtLt')}
    rx = q('rx', tc['rx'], 'length', _sec('rx', ctx))
    ry = q('ry', tc['ry'], 'length', _sec('ry', ctx))
    sw = tc.get('swapped_axes')
    # σex(대칭축) · σey — 대칭축이 모델 z 면 엔진이 둘을 바꿔 쓴다.
    ex_L, ex_r, ey_L, ey_r = (('KyLy', ry, 'KxLx', rx) if sw else ('KxLx', rx, 'KyLy', ry))
    ft = tc['branch'] == 'singly_symmetric'
    ps = tc['branch'] == 'point_symmetric'   # §E2.3 은 σex · σey 를 쓰지 않는다(약축 주축 σe,min)
    i_ex = None if ps else tr.add('elastic_buckling', f'σex = {PI}² E / ({ex_L} / {ex_r["symbol"]})²',
                  equation='E2.2-6' if ft else 'E2.1-1', inputs=[E, L[ex_L], ex_r],
                  result=q('σex', fr['sigma_ex'], 'stress'))
    i_ey = None if ps else tr.add('elastic_buckling', f'σey = {PI}² E / ({ey_L} / {ey_r["symbol"]})²', equation='E2.1-1',
                  inputs=[E, L[ey_L], ey_r], result=q('σey', fr['sigma_ey'], 'stress'))
    props = ctx['props']
    if props.get('ro') and props.get('ro') > 0 and not sw:
        ro_in = q('ro', fr['ro'], 'length', _sec('ro', ctx))
    else:
        i_ro = tr.add('equation', 'ro = (rx² + ry² + xo²)^0.5', equation='E2.2-4',
                      inputs=[rx, ry, q('xo', fr['xo'], 'length', _sec('xo', ctx, ) if fr.get('xo_source') == 'direct'
                                       else src('section_property', key=fr.get('xo_source')))],
                      result=q('ro', fr['ro'], 'length'))
        ro_in = tr.ref(i_ro)
    i_t = tr.add('elastic_buckling', f'σt = [G J + {PI}² E Cw / (KtLt)²] / (A ro²)', equation='E2.2-5',
                 inputs=[q('G', tc['G'], 'stress', spec()), q('J', tc['J'], 'torsion_constant', _sec('J', ctx)),
                         E, q('Cw', tc['Cw'], 'warping_constant', _sec('Cw', ctx)), L['KtLt'], A, ro_in],
                 result=q('σt', fr['sigma_t'], 'stress'))
    if tc['branch'] == 'point_symmetric':
        i_r = tr.add('equation', 'r_min = (I22 / A)^0.5', inputs=[
            q('I22', tc['I22'], 'moment_of_inertia', _sec('I22', ctx)), A],
            result=q('r_min', tc['r_minor'], 'length'))
        i_em = tr.add('elastic_buckling', f'σe,min = {PI}² E / (KyLy / r_min)²', equation='E2.1-1',
                      inputs=[E, L['KyLy'], tr.ref(i_r)], result=q('σe,min', tc['sigma_e_minor'], 'stress'))
        return tr.add('elastic_buckling', 'Fcre = min(σt, σe,min)  (point-symmetric, §E2.3)',
                      inputs=[tr.ref(i_t), tr.ref(i_em)], result=q('Fcre', fr['Fcre'], 'stress'),
                      buckling_type=fr.get('buckling_type'))
    if ft:
        i_b = tr.add('equation', 'β = 1 − (xo / ro)²', equation='E2.2-3',
                     inputs=[q('xo', fr['xo'], 'length', src('section_property', key='xo',
                                                              basis=fr.get('xo_source'))), ro_in],
                     result=q('β', tc['beta'], 'dimensionless'))
        i_ft = tr.add('elastic_buckling', 'Fcre,ft = [(σex + σt) − ((σex + σt)² − 4 β σex σt)^0.5] / (2 β)',
                      equation='E2.2-1', inputs=[tr.ref(i_ex), tr.ref(i_t), tr.ref(i_b)],
                      result=q('Fcre,ft', tc['Fcre_ft'], 'stress'))
        return tr.add('elastic_buckling', 'Fcre = min(σey, Fcre,ft)', inputs=[tr.ref(i_ey), tr.ref(i_ft)],
                      result=q('Fcre', fr['Fcre'], 'stress'), buckling_type=fr.get('buckling_type'))
    return tr.add('elastic_buckling', 'Fcre = min(σex, σey, σt)', inputs=[tr.ref(i_ex), tr.ref(i_ey), tr.ref(i_t)],
                  result=q('Fcre', fr['Fcre'], 'stress'), buckling_type=fr.get('buckling_type'))


def _sp_dim(key, val):
    return q(key, val, 'length', src('section_property', key=key, basis='out-to-out'))


def _local_fcr_steps(tr, an, eq_label):
    """부록 1 Eq. 1.1-4 — 요소(웹 · 플랜지 · 립)마다 평탄폭 · 판좌굴 응력, 그 최소(loads.local_params.calc_Fcrl)."""
    tc, el = an['trace'], an['elements']
    t_q = q('t', an['t'], 'length', src('section_property', key='t'))
    E = q('E', tc['E'], 'stress', spec())
    mu = q('μ', tc['mu'], 'dimensionless', spec())
    if tc['R'] > 0:
        i_c = tr.add('equation', 'c = R + t  (corner allowance per side)',
                     inputs=[q('R', tc['R'], 'length', src('section_property', key='R')), t_q],
                     result=q('c', tc['corner'], 'length'))
    else:
        i_c = tr.add('equation', 'c = t / 2  (R not given)', inputs=[t_q], result=q('c', tc['corner'], 'length'))
    refs = []
    for name, dim in (('web', 'ho'), ('flange', 'bo'), ('lip', 'do')):
        e = el.get(name)
        if not e:
            continue
        if name == 'web':
            expr_w = 'w = ho − 2c'
        elif name == 'flange':
            expr_w = 'w = bo − 2c' if e.get('corners', 2) == 2 else 'w = bo − c'
        else:
            expr_w = 'w = do − c'
        i_w = tr.add('equation', expr_w, inputs=[_sp_dim(dim, an[dim]), tr.ref(i_c)],
                     result=q(f'w,{name}', e['w'], 'length'))
        ins = [q('k', e['k'], 'dimensionless', src('specification', note=f'{name} plate buckling coefficient')),
               E, mu, t_q, tr.ref(i_w)]
        expr = f'Fcrl,{name} = k π² E / [12 (1 − μ²)] (t / w)²'
        if e.get('scale', 1.0) != 1.0:
            ins.append(q('s', e['scale'], 'dimensionless',
                         src('specification', note='extrapolated to the extreme fibre (App. 2 §2.3.3.2)')))
            expr += ' × s'
        refs.append(tr.ref(tr.add('elastic_buckling', expr, equation='1.1-4', inputs=ins,
                                  result=q(f'Fcrl,{name}', e['Fcrl'], 'stress'))))
    return tr.add('elastic_buckling', 'Fcrl = min over the elements', equation=eq_label, inputs=refs,
                  result=q('Fcrl', an['F'], 'stress'), governing=an.get('governing'))


def _dist_fcr_steps(tr, an, ctx):
    """부록 2 §2.3.1.3 / §2.3.3.3 — 플랜지 · 립 성질(표 2.3.1.3-1), Lcrd, 회전강성 넷, Fcrd
    (loads.distortional_params 가 계산한 그 값)."""
    tc = an['trace']
    fp, st = tc['fp'], tc['stiff']
    flex = tc['flexure']
    t_q = q('t', an['t'], 'length', src('section_property', key='t'))
    i_b = tr.add('equation', 'b = bo − t  (centreline flange)', inputs=[_sp_dim('bo', an['bo']), t_q],
                 result=q('b', an['b'], 'length'))
    i_d = tr.add('equation', 'd = do − t/2  (centreline lip)', inputs=[_sp_dim('do', an['do']), t_q],
                 result=q('d', an['d'], 'length'))
    th = q('θ', an['theta'], 'angle', src('section_property', key='lip angle'))
    geo = [tr.ref(i_b), tr.ref(i_d), t_q, th]
    props = {}
    for key, qty in (('Af', 'area'), ('Jf', 'torsion_constant'), ('Ixf', 'moment_of_inertia'),
                     ('Iyf', 'moment_of_inertia'), ('Ixyf', 'moment_of_inertia'),
                     ('xof', 'length'), ('hxf', 'length'), ('yof', 'length')):
        props[key] = tr.ref(tr.add('equation', f'{key} (flange + lip)', equation='Table 2.3.1.3-1', inputs=geo,
                                   result=q(key, fp[key], qty)))
    cwf = q('Cwf', fp['Cwf'], 'warping_constant', src('specification', note='Table 2.3.1.3-1'))
    E = q('E', tc['E'], 'stress', spec())
    G = q('G', tc['G'], 'stress', spec())
    mu = q('μ', tc['mu'], 'dimensionless', spec())
    ho = _sp_dim('ho', an['ho'])
    if flex:
        lexpr = ('Lcrd = {(4π⁴ ho (1−μ²)/t³)[Ixf (xof−hxf)² + Cwf − (Ixyf²/Iyf)(xof−hxf)²] + π⁴ ho⁴/720}^0.25')
    else:
        lexpr = 'Lcrd = {(6π⁴ ho (1−μ²)/t³)[Ixf (xof−hxf)² + Cwf − (Ixyf²/Iyf)(xof−hxf)²]}^0.25'
    i_L = tr.add('elastic_buckling', lexpr, equation='2.3.3.3-4' if flex else '2.3.1.3-7',
                 inputs=[ho, mu, t_q, props['Ixf'], props['xof'], props['hxf'], cwf, props['Ixyf'], props['Iyf']],
                 result=q('Lcrd', tc['Lcrd'], 'length'))
    if tc['Lm'] is not None:
        i_L = tr.add('modifier', 'L = min(Lcrd, Lm)',
                     inputs=[tr.ref(i_L), q('Lm', tc['Lm'], 'length', src('user_input', key='Lm'))],
                     result=q('L', tc['L'], 'length'))
    L = tr.ref(i_L, 'L')
    i_fe = tr.add('elastic_buckling',
                  'kφfe = (π/L)⁴ [E Ixf (xof−hxf)² + E Cwf − E (Ixyf²/Iyf)(xof−hxf)²] + (π/L)² G Jf',
                  equation='2.3.1.3-3',
                  inputs=[L, E, props['Ixf'], props['xof'], props['hxf'], cwf, props['Ixyf'], props['Iyf'], G,
                          props['Jf']],
                  result=q('kφfe', st['k_phi_fe'], 'rotational_stiffness'))
    if flex:
        wexpr = 'kφwe = E t³/(12(1−μ²)) [3/ho + (π/L)² 19 ho/60 + (π/L)⁴ ho³/240]'
    else:
        wexpr = 'kφwe = E t³ / [6 ho (1 − μ²)]'
    i_we = tr.add('elastic_buckling', wexpr, equation='2.3.3.3-5' if flex else '2.3.1.3-4',
                  inputs=[E, t_q, ho, mu] + ([L] if flex else []),
                  result=q('kφwe', st['k_phi_we'], 'rotational_stiffness'))
    i_fg = tr.add('elastic_buckling',
                  'k̃φfg = (π/L)² [Af ((xof−hxf)² (Ixyf/Iyf)² − 2 yof (xof−hxf)(Ixyf/Iyf) + hxf² + yof²) + Ixf + Iyf]',
                  equation='2.3.1.3-5',
                  inputs=[L, props['Af'], props['xof'], props['hxf'], props['Ixyf'], props['Iyf'], props['yof'],
                          props['Ixf']],
                  result=q('k̃φfg', st['k_tilde_phi_fg'], 'area'))
    if flex:
        gexpr = ('k̃φwg = ho t π²/13440 {[45360(1−ξweb) + 62160](L/ho)² + 448π² + (ho/L)² [53 + 3(1−ξweb)] π⁴}'
                 ' / [π⁴ + 28π² (L/ho)² + 420 (L/ho)⁴]')
    else:
        gexpr = 'k̃φwg = (π/L)² t ho³ / 60'
    i_wg = tr.add('elastic_buckling', gexpr, equation='2.3.3.3-6' if flex else '2.3.1.3-6',
                  inputs=[ho, t_q, L] + ([q('ξweb', tc['xi_web'], 'dimensionless', spec())] if flex else []),
                  result=q('k̃φwg', st['k_tilde_phi_wg'], 'area'))
    kq = q('kφ', tc['kphi_external'], 'rotational_stiffness',
           src('user_input', key='kphi') if an.get('kphi_given') else
           src('engine_default', key='kphi', note='0 — no external rotational restraint'))
    ins = [tr.ref(i_fe), tr.ref(i_we), kq, tr.ref(i_fg), tr.ref(i_wg)]
    expr = 'Fcrd = (kφfe + kφwe + kφ) / (k̃φfg + k̃φwg)'
    if flex:
        ins.insert(0, q('β', tc['beta'], 'dimensionless', spec()))
        expr = 'Fcrd = β (kφfe + kφwe + kφ) / (k̃φfg + k̃φwg)  (β = 1 here; the moment-gradient β is applied to Mcrd)'
    return tr.add('elastic_buckling', expr, equation='2.3.3.3-2' if flex else '2.3.1.3-2', inputs=ins,
                  result=q('Fcrd', an['F'], 'stress'))


def _analytic_crit_steps(tr, an, ctx, sym, base_sym, area_sym, area_val, area_q, eq_label, floor_bound, prefix):
    """부록 1/2 해석식 대체: Fcr(요소별 · 강성항까지) → Pcr = Fcr·A(또는 Sf) → (하한으로 올림)."""
    if an.get('kind') == 'local' and an.get('trace'):
        i_f = _local_fcr_steps(tr, an, eq_label)
    elif an.get('kind') == 'distortional' and an.get('trace'):
        i_f = _dist_fcr_steps(tr, an, ctx)
    else:
        dims = [_sp_dim(k, an[k]) for k in ('ho', 'bo', 'do') if an.get(k) is not None]
        dims.append(q('t', an['t'], 'length', src('section_property', key='t')))
        i_f = tr.add('elastic_buckling', f'{base_sym} = analytic elastic buckling stress ({eq_label})',
                     equation=eq_label, inputs=dims, result=q(base_sym, an['F'], 'stress'))
    pcr_eq = {('local', 'A'): '2.3.1.2-1', ('local', 'Sf'): '2.3.3.2-1', ('distortional', 'A'): '2.3.1.3-1',
              ('distortional', 'Sf'): '2.3.3.3-1'}.get((an.get('kind'), area_sym))
    i_p = tr.add('equation', f'{sym} = {base_sym} {area_sym}', equation=pcr_eq, inputs=[tr.ref(i_f), area_q],
                 result=q(sym, an['raw_product'], 'force' if area_sym == 'A' else 'moment'))
    if an.get('raised'):
        i_p = tr.add('modifier', f'{sym} = max({sym}, single-minimum floor)  (§4.1: the lone minimum is a floor)',
                     inputs=[tr.ref(i_p), q(f'{sym},floor', floor_bound, 'force' if area_sym == 'A' else 'moment',
                                            src('buckling_analysis', method='fsm_single_minimum',
                                                key=prefix + 'single_minimum_bound'))],
                     result=q(sym, an['final'], 'force' if area_sym == 'A' else 'moment'))
    return i_p


def compression_checks(ctx):
    """§E2 · §E3.2 · §E4 의 모드별 검토."""
    dm, p = ctx['dm'], ctx['params']
    phi, omega = ctx['phi'], ctx['omega']
    ne = ctx['not_evaluated']
    Pu = ctx['Pu']
    demand = q('Pu', Pu, 'force', demand_source(p, 'Pu')) if Pu and Pu > 0 else None
    fy = q('Fy', ctx['Fy'], 'stress', src('material', key='Fy'))
    A = q('A', ctx['Ag'], 'area', _sec('A', ctx))
    gov_id = {'Local Buckling': 'member.compression.local',
              'Distortional Buckling': 'member.compression.distortional'}.get(ctx['mode'],
                                                                            'member.compression.global')
    checks = []

    def mir(cid, nominal_path):
        m = {'nominal': _mirror(nominal_path, 2)}
        if cid == gov_id and Pu and Pu > 0 and ctx['Pn'] > 0:
            m['capacity'] = _mirror('design_strength', 2)
            m['ratio'] = _mirror('utilization', 4)
        return m

    # --- E2
    g_items = ne_items(ne, 'E2')
    gr = ctx['global_result']
    tr = Trace()
    i_fcre = _column_fcre_steps(tr, ctx)
    if ctx['e2_unavailable'] or i_fcre is None:
        checks.append(not_evaluated('member.compression.global', ctx,
                                    _joined('; ', g_items) or _nt('member.reason.e2_e2_global_buckling_stress'),
                                    steps=tr.steps))
        g_trusted = False
    else:
        i_l = tr.add('slenderness', 'λc = (Fy / Fcre)^0.5', equation='E2-4', inputs=[fy, tr.ref(i_fcre)],
                     result=q('λc', gr['lambda_c'], 'dimensionless'))
        holds = gr['equation'] == 'E2-2'
        tr.branch('λc ≤ 1.5', holds, gr['equation'], inputs=[tr.ref(i_l)])
        i_fn = tr.add('equation', 'Fn = 0.658^(λc²) Fy' if holds else 'Fn = (0.877 / λc²) Fy',
                      equation=gr['equation'], inputs=[tr.ref(i_l), fy], result=q('Fn', gr['Fn'], 'stress'))
        i_pne = tr.add('equation', 'Pne = Ag Fn', equation='E2-1', inputs=[A, tr.ref(i_fn)],
                       result=q('Pne', ctx['Pne'], 'force'))
        g_trusted = not g_items
        checks.append(strength_check('member.compression.global', tr, ctx, i_pne, 'Pne', 'φcPne'
                                     if dm == 'LRFD' else 'Pne/Ωc', 'force', demand, phi=phi, omega=omega,
                                     trusted=g_trusted, untrusted_reason=_joined('; ', g_items),
                                     mirrors=mir('member.compression.global', 'Pne'),
                                     phi_symbol='φc', omega_symbol='Ωc',
                                     no_demand_reason=_nt('member.reason.no_required_axial_strength')))

    # --- E3.2
    l_items = ne_items(ne, 'E3')
    if ctx['local_not_evaluated']:
        checks.append(not_evaluated('member.compression.local', ctx, _joined('; ', l_items) or _nt('member.reason.no_pcrl')))
    elif ctx['e2_unavailable']:
        checks.append(not_evaluated('member.compression.local', ctx,
                                    _nt('member.reason.e2_pne_e2_available_local')))
    else:
        tr = Trace()
        lr = ctx['local_result']
        an = ctx.get('pcrl_an')
        if an:
            i_cr = _analytic_crit_steps(tr, an, ctx, 'Pcrl', 'Fcrl', 'A', ctx['Ag'], A, '1.1-4',
                                        ctx['diag']['bound'], 'P_')
        else:
            i_cr = tr.add('elastic_buckling', 'Pcrl (elastic local buckling load)',
                          inputs=[q('Pcrl', ctx['Pcrl'], 'force',
                                    buckling_src(ctx['Pcrl_source'], ctx['dsm'], 'P_', 'local'))],
                          result=q('Pcrl', ctx['Pcrl'], 'force'))
        pne_in = q('Pne', ctx['Pne'], 'force', src('check' if not g_items else 'check',
                                                   id='member.compression.global'))
        i_l = tr.add('slenderness', 'λℓ = (Pne / Pcrl)^0.5', equation='E3.2.1-3',
                     inputs=[pne_in, tr.ref(i_cr)], result=q('λℓ', lr['lambda_l'], 'dimensionless'))
        holds = lr['equation'] == 'E3.2.1-1'
        tr.branch('λℓ ≤ 0.776', holds, lr['equation'], inputs=[tr.ref(i_l)])
        i_n = tr.add('equation', 'Pnℓ = Pne' if holds else
                     'Pnℓ = [1 − 0.15 (Pcrl/Pne)^0.4] (Pcrl/Pne)^0.4 Pne',
                     equation=lr['equation'], inputs=[pne_in, tr.ref(i_cr)], result=q('Pnℓ', ctx['Pnl'], 'force'))
        reasons = list(l_items)
        if g_items:
            reasons.append(_nt('member.reason.e2_uses_pne_from_e2', g_items=_joined('; ', g_items)))
        checks.append(strength_check('member.compression.local', tr, ctx, i_n, 'Pnℓ',
                                     'φcPnℓ' if dm == 'LRFD' else 'Pnℓ/Ωc', 'force', demand, phi=phi,
                                     omega=omega, trusted=not reasons, untrusted_reason=_joined('; ', reasons),
                                     mirrors=mir('member.compression.local', 'Pnl'),
                                     phi_symbol='φc', omega_symbol='Ωc',
                                     no_demand_reason=_nt('member.reason.no_required_axial_strength')))

    # --- E4
    d_items = ne_items(ne, 'E4')
    if ctx['Pcrd'] > 0:
        tr = Trace()
        dr = ctx['dist_result']
        i_py = tr.add('yield', 'Py = Ag Fy', equation='E4.1-4', inputs=[A, fy], result=q('Py', ctx['Py'], 'force'))
        an = ctx.get('pcrd_an')
        if an:
            i_cr = _analytic_crit_steps(tr, an, ctx, 'Pcrd', 'Fcrd', 'A', ctx['Ag'], A, '2.3.1.3-2',
                                        ctx['diag']['bound'], 'P_')
        else:
            i_cr = tr.add('elastic_buckling', 'Pcrd (elastic distortional buckling load)',
                          inputs=[q('Pcrd', ctx['Pcrd'], 'force',
                                    buckling_src(ctx['Pcrd_source'], ctx['dsm'], 'P_', 'distortional'))],
                          result=q('Pcrd', ctx['Pcrd'], 'force'))
        i_l = tr.add('slenderness', 'λd = (Py / Pcrd)^0.5', equation='E4.1-3', inputs=[tr.ref(i_py), tr.ref(i_cr)],
                     result=q('λd', dr['lambda_d'], 'dimensionless'))
        holds = dr['equation'] == 'E4.1-1'
        tr.branch('λd ≤ 0.561', holds, dr['equation'], inputs=[tr.ref(i_l)])
        i_n = tr.add('equation', 'Pnd = Py' if holds else
                     'Pnd = [1 − 0.25 (Pcrd/Py)^0.6] (Pcrd/Py)^0.6 Py',
                     equation=dr['equation'], inputs=[tr.ref(i_py), tr.ref(i_cr)], result=q('Pnd', ctx['Pnd'], 'force'))
        checks.append(strength_check('member.compression.distortional', tr, ctx, i_n, 'Pnd',
                                     'φcPnd' if dm == 'LRFD' else 'Pnd/Ωc', 'force', demand, phi=phi, omega=omega,
                                     trusted=not d_items, untrusted_reason=_joined('; ', d_items),
                                     mirrors=mir('member.compression.distortional', 'Pnd'),
                                     phi_symbol='φc', omega_symbol='Ωc',
                                     no_demand_reason=_nt('member.reason.no_required_axial_strength')))
    elif not ctx['dist_applicable']:
        checks.append(not_applicable('member.compression.distortional', ctx,
                                     _nt('member.reason.e4_e4_applicable', dist_reason=ctx['dist_reason'])))
    else:
        checks.append(not_evaluated('member.compression.distortional', ctx, _joined('; ', d_items) or _nt('member.reason.no_pcrd')))

    # --- §H1.2 앵글: 압축 단독이라도 조합 검토가 필요
    h_items = ne_items(ne, 'H1.2')
    if h_items:
        checks.append(not_evaluated('member.axial_bending', ctx,
                                    _nt('member.reason.h1_2_h1_angle_compression_needs')))
    return checks


# ---------------------------------------------------------------- 휨 (F)

def _unbounded(symbol, quantity='stress'):
    """끝없는 값(횡좌굴 없음 → Fcre = ∞). 숫자로 싣지 않는다(엔진 안의 1e6 ksi 는 '없음'의 표지일 뿐 — V6-16)."""
    return q(symbol, None, quantity, unbounded=True,
             reason=_nt('member.reason.no_lateral_torsional_buckling'))


def _beam_fcre_steps(tr, ctx, st, Lb, Cb, Lb_src, Cb_src, sym_suffix=''):
    """§F2 Fcre 단계 — st['Fcre_raw'] 은 compute_beam_Fcre_detail(_raw=…) 가 채운 값."""
    raw = st.get('Fcre_raw') or {}
    Fsym = 'Fcre' + sym_suffix
    if ctx['Fcre_override'] > 0:
        return tr.add('elastic_buckling', f'{Fsym} = rational elastic buckling stress (input)',
                      inputs=[q('Fcre', ctx['Fcre_override'], 'stress',
                                src('user_input', key='Fcre', method='user_supplied'))],
                      result=q(Fsym, st['Fcre'], 'stress'))
    br = raw.get('branch')
    if br == 'fully_braced':
        return tr.add('elastic_buckling', f'{Fsym} → ∞ (Lb = 0: compression flange fully braced, no LTB)',
                      inputs=[q('Lb', Lb, 'length', Lb_src)], result=_unbounded(Fsym))
    E = q('E', raw.get('E'), 'stress', spec())
    G = q('G', raw.get('G'), 'stress', spec())
    J = q('J', raw.get('J'), 'torsion_constant', _sec('J', ctx))
    Sf = q('Sf', raw.get('Sf'), 'section_modulus', _sec('Sf', ctx))
    cb = q('Cb', Cb, 'dimensionless', Cb_src)
    if br == 'closed_box':
        Iy = q('Iy', raw['Iy'], 'moment_of_inertia', _sec('Iy', ctx))
        fy = q('Fy', raw['Fy'], 'stress', src('material', key='Fy'))
        i_lu = tr.add('equation', f'Lu = 0.36 Cb {PI} / (Fy Sf) (E G J Iy)^0.5', equation='F2.1.4-1',
                      inputs=[cb, fy, Sf, E, G, J, Iy], result=q('Lu', raw['Lu'], 'length'))
        lb = q('Lb', Lb, 'length', Lb_src)
        tr.branch('Lb ≤ Lu', raw['lb_le_lu'], 'F2.1.4-1' if raw['lb_le_lu'] else 'F2.1.4-2',
                  inputs=[lb, tr.ref(i_lu)])
        if raw['lb_le_lu']:
            return tr.add('elastic_buckling', f'{Fsym} → ∞ (Lb ≤ Lu: lateral-torsional buckling not considered)',
                          inputs=[lb, tr.ref(i_lu)], result=_unbounded(Fsym))
        return tr.add('elastic_buckling', f'{Fsym} = Cb {PI} / (Ky Ly Sf) (E G J Iy)^0.5', equation='F2.1.4-2',
                      inputs=[cb, q('Ky', raw['Ky'], 'dimensionless', spec()),
                              q('Ly', raw['Ly'], 'length', Lb_src), Sf, E, G, J, Iy],
                      result=q(Fsym, raw['Fcre'], 'stress'))
    if br != 'open':
        return None
    A = q('A', raw['Ag'], 'area', _sec('A', ctx))
    ry = q('ry', raw['ry'], 'length', _sec('ry', ctx))
    ly = q('KyLy', raw['Ky'] * raw['Ly'], 'length', Lb_src)
    lt = q('KtLt', raw['Kt'] * raw['Lt'], 'length', Lb_src)
    i_ey = tr.add('elastic_buckling', f'σey = {PI}² E / (KyLy / ry)²', equation='F2.1.1-4', inputs=[E, ly, ry],
                  result=q('σey', raw['sigma_ey'], 'stress'))
    ro = q('ro', raw['ro'], 'length', _sec('ro', ctx))
    i_t = tr.add('elastic_buckling', f'σt = [G J + {PI}² E Cw / (KtLt)²] / (A ro²)', equation='F2.1.1-5',
                 inputs=[G, J, E, q('Cw', raw['Cw'], 'warping_constant', _sec('Cw', ctx)), lt, A, ro],
                 result=q('σt', raw['sigma_t'], 'stress'))
    z = raw['z_factor'] != 1.0
    return tr.add('elastic_buckling', (f'{Fsym} = Cb ro A / (2 Sf) (σey σt)^0.5' if z
                                       else f'{Fsym} = Cb ro A / Sf (σey σt)^0.5'),
                  equation='F2.1.3-1' if z else 'F2.1.1-1',
                  inputs=[cb, ro, A, Sf, tr.ref(i_ey), tr.ref(i_t)], result=q(Fsym, raw['Fcre'], 'stress'))


def _fy_input(tr, ctx, st):
    """휨의 Fy 입력 — 냉간가공(§A3.3.2)을 적용했으면 Fya 단계."""
    cw = ctx.get('cold_work_info')
    if cw and st['Fy'] != ctx['Fy_original']:
        i = tr.add('modifier', 'Fya = C Fyc + (1 − C) Fyv ≤ Fuv  (cold work of forming)', equation='A3.3.2-1',
                   inputs=[q('C', cw.get('C'), 'dimensionless', src('section_property', key='corner area ratio',
                                                                   rounded_to=0.0001)),
                           q('Fyc', cw.get('Fyc'), 'stress', src('specification', equation='A3.3.2-2',
                                                                rounded_to=0.01)),
                           q('Fyv', ctx['Fy_original'], 'stress', src('material', key='Fy')),
                           q('Fuv', ctx['params'].get('Fu'), 'stress', src('material', key='Fu'))],
                   result=q('Fya', st['Fy'], 'stress'), rounded_to=0.01)
        return tr.ref(i, 'Fy')
    return q('Fy', st['Fy'], 'stress', src('material', key='Fy'))


def _mne_steps(tr, ctx, st, Lb, Cb, Lb_src, Cb_src, sym='Mne'):
    """Fcre → Fn(갈래) → Mne. 돌려주는 값: Mne 단계 번호(없으면 None)."""
    gr = st['global_result']
    Sf = q('Sf', st['Sf_eff'], 'section_modulus', _sec('Sf', ctx))
    fy = _fy_input(tr, ctx, st)
    eq = str(gr.get('equation', ''))
    if eq.startswith('F2.3'):
        dt = ctx['D_over_t']
        dtq = q('D/t', dt, 'dimensionless', src('section_property', key='D/t'))
        E = q('E', ctx['E'], 'stress', spec())
        n = eq.split(' ')[0]
        tr.branch('D/t ≤ 0.0714 E/Fy' if n == 'F2.3-2' else
                  ('0.0714 E/Fy < D/t ≤ 0.318 E/Fy' if n == 'F2.3-3' else '0.318 E/Fy < D/t ≤ 0.441 E/Fy'),
                  True, n, inputs=[dtq, E, fy])
        expr = {'F2.3-2': 'Fn = 1.25 Fy', 'F2.3-3': 'Fn = [0.970 + 0.020 (E/Fy)/(D/t)] Fy',
                'F2.3-4': 'Fn = 0.328 E / (D/t)'}[n]
        i_fn = tr.add('equation', expr, equation=n, inputs=[fy, E, dtq], result=q('Fn', gr['Fn'], 'stress'))
        return tr.add('equation', f'{sym} = Sf Fn', equation='F2.3-1', inputs=[Sf, tr.ref(i_fn)],
                      result=q(sym, st['Mne'] if sym == 'Mne' else gr['Mne'], 'moment'))
    i_f = _beam_fcre_steps(tr, ctx, st, Lb, Cb, Lb_src, Cb_src)
    if i_f is None or not gr.get('Fcre'):
        return None
    yl = 'yielding' in eq
    inel = 'inelastic LTB' in eq
    if 'F2.4.2' in eq:
        tr.branch('Fcre ≥ 2.78 Fy', True, 'F2.1-3', inputs=[tr.ref(i_f), fy])
    else:
        tr.branch('Fcre ≥ 2.78 Fy', yl, 'F2.1-3' if yl else ('F2.1-4' if inel else 'F2.1-5'),
                  inputs=[tr.ref(i_f), fy])
        if not yl:
            tr.branch('Fcre > 0.56 Fy', inel, 'F2.1-4' if inel else 'F2.1-5', inputs=[tr.ref(i_f), fy])
    if 'F2.4.2' in eq:
        # 비탄성 예비강도(§F2.4.2) — Mne 를 My 위로 올린 경우
        i_my = tr.add('yield', 'My = Sf Fy', equation='F2.1-2', inputs=[Sf, fy], result=q('My', st['My'], 'moment'))
        zf = q('Zf', ctx['Zf'], 'section_modulus', _sec('Zx', ctx))
        i_mp = tr.add('yield', 'Mp = Zf Fy', equation='F2.4.2-3', inputs=[zf, fy], result=q('Mp', st['Mp'], 'moment'))
        fref = tr.ref(i_f)
        i_mcre = tr.add('elastic_buckling', 'Mcre = Sf Fcre', equation='F2.4.2-2', inputs=[Sf, fref],
                        result=(_unbounded('Mcre', 'moment') if fref.get('unbounded')
                                else q('Mcre', st['Sf_eff'] * gr['Fcre'], 'moment')))
        tr.branch('Mcre > 2.78 My (inelastic reserve)', True, 'F2.4.2-1', inputs=[tr.ref(i_mcre), tr.ref(i_my)])
        return tr.add('equation', 'Mne = Mp − (Mp − My) [(My/Mcre)^0.5 − 0.23] / 0.37 ≤ Mp',
                      equation='F2.4.2-1', inputs=[tr.ref(i_mp), tr.ref(i_my), tr.ref(i_mcre)],
                      result=q('Mne', gr['Mne'], 'moment'))
    expr = ('Fn = Fy' if yl else ('Fn = (10/9) Fy [1 − 10 Fy / (36 Fcre)]' if inel else 'Fn = Fcre'))
    i_fn = tr.add('equation', expr, equation='F2.1-3' if yl else ('F2.1-4' if inel else 'F2.1-5'),
                  inputs=[fy, tr.ref(i_f)], result=q('Fn', gr['Fn'], 'stress'))
    return tr.add('equation', f'{sym} = Sf Fn ≤ My', equation='F2.1-1', inputs=[Sf, tr.ref(i_fn)],
                  result=q(sym, gr['Mne'], 'moment'))


def flexure_checks(ctx):
    """§F2 · §F3.2 · §F4 (또는 §I6.2.1) 와 G2 · G5 · H2 · H3 · 정모멘트 구간."""
    dm, p = ctx['dm'], ctx['params']
    phi, omega = ctx['phi'], ctx['omega']
    ne = ctx['not_evaluated_all']
    st = ctx['state']
    Mu = ctx['Mu']
    demand = q('Mu', Mu, 'moment', demand_source(p, 'Mu')) if Mu and Mu > 0 else None
    if p.get('_lb_from_lap_restrained'):
        Lb_src = src('user_input', key='lap_restrained',
                     note='lap region: Manual II-1A / II-2A assumption — lapped section restrained against '
                          'lateral-torsional buckling → Lb = 0')
    elif p.get('_lb_lap_upper_bound'):
        Lb_src = src('engine_default', key='Lb',
                     note='lap region, restraint not stated and Lb not given: Lb = 0 only as an upper bound '
                          '(Mne ≤ My) — F2 is not evaluated unless this bound already fails')
    else:
        Lb_src = (src('engine_default', key='Lb', note='120 in') if 'Lb' not in p else src('user_input', key='Lb'))
    Cb_src = src('user_input', key='Cb') if p.get('Cb') is not None else src('engine_default', key='Cb', note='1.0')
    if p.get('_lb_from_lap_restrained'):
        Cb_src = src('user_input', key='lap_restrained', note='lap region: Cb = 1.0 (Lb = 0)')
    i621 = ctx['R_uplift'] is not None and ctx['R_uplift'] > 0
    gov_id = ('member.flexure.uplift_r' if i621 else
              {'Local Buckling': 'member.flexure.local',
               'Distortional Buckling': 'member.flexure.distortional'}.get(ctx['mode'], 'member.flexure.global'))
    sym_phi, sym_om = 'φb', 'Ωb'
    checks = []
    Sf = q('Sf', st['Sf_eff'], 'section_modulus', _sec('Sf', ctx))
    no_dem = _nt('member.reason.no_required_flexural_strength')

    def mir(cid, nominal_path):
        m = {'nominal': _mirror(nominal_path, 2)} if nominal_path else {}
        if cid == gov_id and Mu and Mu > 0 and ctx['Mn'] > 0:
            m['capacity'] = _mirror('design_strength', 2)
            m['ratio'] = _mirror('limit_state_checks[0].ratio', 4)
        return m or None

    replaced = _nt('member.reason.i6_2_1_replaced_i6_mn_mn')
    g_items = ne_items(ne, 'F2')
    l_items = ne_items(ne, 'F3')
    d_items = ne_items(ne, 'F4')

    if i621:
        # §I6.2.1 이 F2 · F4 (와 F3 의 Mne 경로)를 대신한다 — 엔진이 미평가로 올린 것만 미평가로.
        # I6.2.1 자체를 쓸 수 없으면(표 밖 등) 대신할 것이 없다: 그때는 F2–F4 가 휨강도이고, 이 실행은 그것을
        # 계산하지 않았다 → not_evaluated (V6-20). '대체됨 — 해당 없음'이라고 적지 않는다.
        i621_items = ne_items(ctx['not_evaluated_all'], 'I6.2.1')
        stands = (_nt('member.reason.i6_2_1_i6_cannot_applied_chapter', i621_items=_joined('; ', i621_items)))
        for cid, items in (('member.flexure.global', g_items), ('member.flexure.local', l_items),
                           ('member.flexure.distortional', d_items)):
            if items:
                checks.append(not_evaluated(cid, ctx, _joined('; ', items)))
            elif i621_items:
                checks.append(not_evaluated(cid, ctx, stands))
            else:
                checks.append(not_applicable(cid, ctx, replaced))
        checks.append(_i621_check(ctx, st, Sf, demand))
        return checks

    # --- F2
    tr = Trace()
    i_mne = _mne_steps(tr, ctx, st, ctx['Lb'], ctx['Cb'], Lb_src, Cb_src)
    if i_mne is None or ctx['f2_unavailable']:
        checks.append(not_evaluated('member.flexure.global', ctx,
                                    _joined('; ', g_items) or _nt('member.reason.f2_f2_strength_available'), steps=tr.steps))
    else:
        checks.append(strength_check('member.flexure.global', tr, ctx, i_mne, 'Mne',
                                     'φbMne' if dm == 'LRFD' else 'Mne/Ωb', 'moment', demand, phi=phi, omega=omega,
                                     trusted=not g_items, untrusted_reason=_joined('; ', g_items),
                                     mirrors=mir('member.flexure.global', 'Mne'),
                                     phi_symbol=sym_phi, omega_symbol=sym_om, no_demand_reason=no_dem))
    g_bad = bool(g_items) or ctx['f2_unavailable']

    # --- F3.2
    lr = st['local_result']
    if st['skip_round_local']:
        checks.append(not_applicable('member.flexure.local', ctx,
                                     _nt('member.reason.f3_1_1_f3_round_hss_fy')))
    elif st['local_missing']:
        checks.append(not_evaluated('member.flexure.local', ctx, _joined('; ', l_items) or _nt('member.reason.no_mcrl')))
    elif ctx['f2_unavailable'] or i_mne is None:
        checks.append(not_evaluated('member.flexure.local', ctx,
                                    _nt('member.reason.f2_mne_f2_available_local')))
    else:
        tr = Trace()
        i_cr = _mcrl_steps(tr, ctx, st, Sf)
        mne_in = q('Mne', st['Mne'], 'moment', src('check', id='member.flexure.global'))
        if str(lr['equation']).startswith('F3.2.3'):
            fy = _fy_input(tr, ctx, st)
            i_my = tr.add('yield', 'My = Sf Fy', equation='F2.1-2', inputs=[Sf, fy], result=q('My', st['My'], 'moment'))
            i_mp = tr.add('yield', 'Mp = Zf Fy', equation='F2.4.2-3',
                          inputs=[q('Zf', ctx['Zf'], 'section_modulus', _sec('Zx', ctx)), fy],
                          result=q('Mp', st['Mp'], 'moment'))
            i_l = tr.add('slenderness', 'λℓ = (My / Mcrl)^0.5', equation='F3.2.3-3', inputs=[tr.ref(i_my), tr.ref(i_cr)],
                         result=q('λℓ', lr['lambda_l'], 'dimensionless'))
            tr.branch('λℓ ≤ 0.776 and Mne ≥ My (local inelastic reserve)', True, 'F3.2.3-1',
                      inputs=[tr.ref(i_l), mne_in, tr.ref(i_my)])
            i_c = tr.add('equation', 'Cyℓ = (0.776 / λℓ)^0.5 ≤ 3', equation='F3.2.3-4', inputs=[tr.ref(i_l)],
                         result=q('Cyℓ', lr['Cyl'], 'dimensionless'))
            i_n = tr.add('equation', 'Mnℓ = My + (1 − 1/Cyℓ²) (Mp − My)', equation='F3.2.3-1',
                         inputs=[tr.ref(i_my), tr.ref(i_c), tr.ref(i_mp)], result=q('Mnℓ', st['Mnl'], 'moment'))
        else:
            i_l = tr.add('slenderness', 'λℓ = (Mne / Mcrl)^0.5', equation='F3.2.1-3', inputs=[mne_in, tr.ref(i_cr)],
                         result=q('λℓ', lr['lambda_l'], 'dimensionless'))
            holds = lr['equation'] == 'F3.2.1-1'
            tr.branch('λℓ ≤ 0.776', holds, lr['equation'], inputs=[tr.ref(i_l)])
            i_n = tr.add('equation', 'Mnℓ = Mne' if holds else
                         'Mnℓ = [1 − 0.15 (Mcrl/Mne)^0.4] (Mcrl/Mne)^0.4 Mne',
                         equation=lr['equation'], inputs=[mne_in, tr.ref(i_cr)], result=q('Mnℓ', st['Mnl'], 'moment'))
        reasons = list(l_items)
        if g_bad:
            reasons.append(_nt('member.reason.f2_uses_mne_from_f2', g_items=_joined('; ', g_items)))
        checks.append(strength_check('member.flexure.local', tr, ctx, i_n, 'Mnℓ',
                                     'φbMnℓ' if dm == 'LRFD' else 'Mnℓ/Ωb', 'moment', demand, phi=phi, omega=omega,
                                     trusted=not reasons, untrusted_reason=_joined('; ', reasons),
                                     mirrors=mir('member.flexure.local', 'Mnl'),
                                     phi_symbol=sym_phi, omega_symbol=sym_om, no_demand_reason=no_dem))

    # --- F4
    dr = st['dist_result']
    if st['Mcrd'] > 0:
        tr = Trace()
        fy = _fy_input(tr, ctx, st)
        i_my = tr.add('yield', 'My = Sf Fy', equation='F4.1-4', inputs=[Sf, fy], result=q('My', st['My'], 'moment'))
        i_cr = _mcrd_steps(tr, ctx, st, Sf)
        if str(dr['equation']).startswith('F4.3'):
            i_mp = tr.add('yield', 'Mp = Zf Fy', equation='F2.4.2-3',
                          inputs=[q('Zf', ctx['Zf'], 'section_modulus', _sec('Zx', ctx)), fy],
                          result=q('Mp', st['Mp'], 'moment'))
            i_l = tr.add('slenderness', 'λd = (My / Mcrd)^0.5', equation='F4.3-3', inputs=[tr.ref(i_my), tr.ref(i_cr)],
                         result=q('λd', dr['lambda_d'], 'dimensionless'))
            tr.branch('λd ≤ 0.673 (distortional inelastic reserve)', True, 'F4.3-1', inputs=[tr.ref(i_l)])
            i_c = tr.add('equation', 'Cyd = (0.673 / λd)^0.5 ≤ 3', equation='F4.3-4', inputs=[tr.ref(i_l)],
                         result=q('Cyd', dr['Cyd'], 'dimensionless'))
            i_n = tr.add('equation', 'Mnd = My + (1 − 1/Cyd²) (Mp − My)', equation='F4.3-1',
                         inputs=[tr.ref(i_my), tr.ref(i_c), tr.ref(i_mp)], result=q('Mnd', st['Mnd'], 'moment'))
        else:
            i_l = tr.add('slenderness', 'λd = (My / Mcrd)^0.5', equation='F4.1-3', inputs=[tr.ref(i_my), tr.ref(i_cr)],
                         result=q('λd', dr['lambda_d'], 'dimensionless'))
            holds = dr['equation'] == 'F4.1-1'
            tr.branch('λd ≤ 0.673', holds, dr['equation'], inputs=[tr.ref(i_l)])
            i_n = tr.add('equation', 'Mnd = My' if holds else
                         'Mnd = [1 − 0.22 (Mcrd/My)^0.5] (Mcrd/My)^0.5 My',
                         equation=dr['equation'], inputs=[tr.ref(i_my), tr.ref(i_cr)],
                         result=q('Mnd', st['Mnd'], 'moment'))
        checks.append(strength_check('member.flexure.distortional', tr, ctx, i_n, 'Mnd',
                                     'φbMnd' if dm == 'LRFD' else 'Mnd/Ωb', 'moment', demand, phi=phi, omega=omega,
                                     trusted=not d_items, untrusted_reason=_joined('; ', d_items),
                                     mirrors=mir('member.flexure.distortional', 'Mnd'),
                                     phi_symbol=sym_phi, omega_symbol=sym_om, no_demand_reason=no_dem))
    elif ctx['is_round']:
        checks.append(not_applicable('member.flexure.distortional', ctx, _nt('member.reason.f4_f4_does_apply_round')))
    elif not ctx['dist_applicable']:
        c = not_applicable('member.flexure.distortional', ctx, _nt('member.reason.f4_f4_applicable', dist_reason=ctx['dist_reason']))
        if ctx.get('dist_stated'):
            c['restraint_source'] = src('user_input', key='lap_restrained')
        checks.append(c)
    else:
        checks.append(not_evaluated('member.flexure.distortional', ctx, _joined('; ', d_items) or _nt('member.reason.no_mcrd')))

    return checks


def flexure_checks_all(ck):
    """휨 결과의 모든 검토 — F2/F3/F4(또는 I6.2.1), G2 · H2, 정모멘트 구간, G5 · H3."""
    from design.checks import set_governing
    ne = ck['not_evaluated_all']
    checks = flexure_checks(ck)
    if ck.get('shear'):
        g2, h2 = shear_checks(ck, ck['shear'])
        checks += g2 + h2
    elif ne_items(ne, 'G2/H2'):
        why = _nt('member.reason.web_flat_depth_thickness', value=_joined('; ', ne_items(ne, 'G2/H2')))
        checks += [not_evaluated('member.shear', ck, why), not_evaluated('member.bending_shear', ck, why)]
    if ck.get('positive'):
        checks.append(positive_region_check(ck, {**ck['positive'],
                                                 'ne_items': ne_items(ne, 'F positive region')}))
    g5 = ne_items(ne, 'G5')
    if ck.get('wc'):
        checks.append(web_crippling_check(ck, {**ck['wc'], 'ne_items': g5}))
    elif g5:
        checks.append(not_evaluated('member.web_crippling', ck, _joined('; ', g5)))
    h3 = ne_items(ne, 'H3')
    if ck.get('h3'):
        checks.append(h3_check(ck, ck['h3']))
    elif h3:
        checks.append(not_evaluated('member.bending_web_crippling', ck, _joined('; ', h3)))
    i621 = ck['R_uplift'] is not None and ck['R_uplift'] > 0
    gov = ('member.flexure.uplift_r' if i621 else
           {'Local Buckling': 'member.flexure.local',
            'Distortional Buckling': 'member.flexure.distortional'}.get(ck['mode'], 'member.flexure.global'))
    set_governing(checks, {'member.flexure': gov})
    return checks


def lap_section_block(ctx):
    """랩 구간(lap_region + 구속 진술)의 랩 단면 강도 — 랩 도구가 단면 강도를 가져갈 곳(계약 §6.3, 2026-11-24).

    기준: Manual II-1A / II-2A 의 랩 구간 — Fn = Fy(Mne = My), §F3.2.1 국부좌굴만, 비탄성 여유(§F3.2.3)와
    냉간가공(§A3.3.2) 없이(virgin Fy). Se = Mnℓ / Fy. Vn 은 그 단면 한 부재의 §G2.1 (웹 하나 — C · Z).
    구간 자신의 검토 항목은 비탄성 여유 · 냉간가공을 품을 수 있어 랩 검토의 단면 강도로 쓰지 않는다.
    """
    from design.shear import shear_strength
    vs = ctx['state_i621']                    # virgin 상태(냉간가공 전 Fy)
    Fy0 = ctx['Fy_original']
    tr = Trace()
    Sf = q('Sf', vs['Sf_eff'], 'section_modulus', _sec('Sf', ctx))
    fy = q('Fy', Fy0, 'stress', src('material', key='Fy', note='virgin Fy — no cold work (§A3.3.2)'))
    i_my = tr.add('yield', 'My = Sf Fy  (Mne = My, Fn = Fy: lapped section restrained)', equation='F2.1-2',
                  inputs=[Sf, fy], result=q('My', vs['My'], 'moment'),
                  assumption_source=src('user_input', key='lap_restrained',
                                        note='Manual II-1A / II-2A: lapped section restrained against '
                                             'lateral-torsional and distortional buckling'))
    md = vs.get('Mnfo_detail') or {}
    out = {'basis': 'Manual II-1A / II-2A lapped section: Fn = Fy (Mne = My), §F3.2.1 local buckling only, '
                    'no inelastic reserve (§F3.2.3), no cold work (§A3.3.2); Se = Mnℓ / Fy; Vn = §G2.1, one member',
           'clause': 'F3.2.1', 'equations': ['F2.1-2', 'F3.2.1-1', 'F3.2.1-2', 'F3.2.1-3', 'G2.1-1', 'G2.1-2a',
                                              'G2.1-3a'],
           'statement_source': src('user_input', key='lap_restrained')}
    if vs['Mcrl'] > 0 and md.get('Mnl') is not None:
        i_cr = _mcrl_steps(tr, ctx, vs, Sf)
        i_l = tr.add('slenderness', 'λℓ = (My / Mcrl)^0.5', equation='F3.2.1-3',
                     inputs=[tr.ref(i_my), tr.ref(i_cr)], result=q('λℓ', md.get('lambda_l'), 'dimensionless'))
        holds = md.get('equation') == 'F3.2.1-1'
        tr.branch('λℓ ≤ 0.776', holds, md.get('equation'), inputs=[tr.ref(i_l)])
        i_lo = tr.add('equation', 'Mnℓ = My' if holds else 'Mnℓ = [1 − 0.15 (Mcrl/My)^0.4] (Mcrl/My)^0.4 My',
                      equation=md.get('equation'), inputs=[tr.ref(i_my), tr.ref(i_cr)],
                      result=q('Mnℓ', md['Mnl'], 'moment'))
        se = md['Mnl'] / Fy0
        i_se = tr.add('equation', 'Se = Mnℓ / Fy  (effective section modulus at Fn = Fy)', equation='F3.1-1',
                      inputs=[tr.ref(i_lo), fy], result=q('Se', se, 'section_modulus'))
        out.update(available=True, Mnl=tr.steps[i_lo]['result'], Se=tr.steps[i_se]['result'], My=tr.steps[i_my]['result'])
    else:
        out.update(available=False, Mnl=None, Se=None, My=tr.steps[i_my]['result'],
                   reason=_nt('member.reason.no_mcrl'))
    h, t = ctx.get('h_web') or 0.0, ctx.get('t_web') or 0.0
    if h > 0 and t > 0:
        sr = shear_strength(h, t, Fy0)
        hq = q('h', h, 'length', src('section_property', key='h_web'))
        tq = q('t', t, 'length', src('section_property', key='t'))
        i_vy = tr.add('yield', 'Vy = 0.6 Aw Fy, Aw = h t', equation='G2.1-5', inputs=[hq, tq, fy],
                      result=q('Vy', sr['Vy'], 'force'))
        i_vcr = tr.add('elastic_buckling', f'Vcr = Aw {PI}² E kv / [12 (1 − μ²) (h/t)²], μ = 0.3', equation='G2.3-2',
                       inputs=[hq, tq, q('E', ctx['E'], 'stress', spec()), q('kv', 5.34, 'dimensionless', spec())],
                       result=q('Vcr', sr['Vcr'], 'force'))
        i_lv = tr.add('slenderness', 'λv = (Vy / Vcr)^0.5', equation='G2.1-4', inputs=[tr.ref(i_vy), tr.ref(i_vcr)],
                      result=q('λv', sr['lambda_v'], 'dimensionless'))
        eq = sr['equation']
        if 'yielding' in eq:
            tr.branch('λv ≤ 0.815', True, 'G2.1-1', inputs=[tr.ref(i_lv)])
            i_v = tr.add('equation', 'Vn = Vy', equation='G2.1-1', inputs=[tr.ref(i_vy)], result=q('Vn', sr['Vn'], 'force'))
        elif 'inelastic' in eq:
            tr.branch('0.815 < λv ≤ 1.227', True, 'G2.1-2a', inputs=[tr.ref(i_lv)])
            i_v = tr.add('equation', 'Vn = 0.815 (Vcr Vy)^0.5', equation='G2.1-2a',
                         inputs=[tr.ref(i_vcr), tr.ref(i_vy)], result=q('Vn', sr['Vn'], 'force'))
        else:
            tr.branch('λv > 1.227', True, 'G2.1-3a', inputs=[tr.ref(i_lv)])
            i_v = tr.add('equation', 'Vn = Vcr', equation='G2.1-3a', inputs=[tr.ref(i_vcr)],
                         result=q('Vn', sr['Vn'], 'force'))
        out['Vn'] = tr.steps[i_v]['result']
    else:
        out['Vn'] = None
    out['steps'] = tr.steps
    return out


def _mcrl_steps(tr, ctx, st, Sf):
    an = st.get('Mcrl_an')
    if an:
        return _analytic_crit_steps(tr, an, ctx, 'Mcrl', 'Fcrl', 'Sf', st['Sf_eff'], Sf,
                                    '1.1-4', ctx['diag']['bound'], 'M_')
    return tr.add('elastic_buckling', 'Mcrl (elastic local buckling moment)',
                  inputs=[q('Mcrl', st['Mcrl'], 'moment',
                            buckling_src(st['Mcrl_source'], ctx['dsm'], 'M_', 'local'))],
                  result=q('Mcrl', st['Mcrl'], 'moment'))


def _mcrd_steps(tr, ctx, st, Sf, use_base=False):
    an = st.get('Mcrd_an')
    base = st['Mcrd_base']
    if an:
        i = _analytic_crit_steps(tr, an, ctx, 'Mcrd', 'Fcrd', 'Sf', st['Sf_eff'], Sf,
                                 '2.3.3.3-2', ctx['diag']['bound'], 'M_')
    else:
        lbl = str(st['Mcrd_source']).split(' [β=')[0]
        i = tr.add('elastic_buckling', 'Mcrd (elastic distortional buckling moment)',
                   inputs=[q('Mcrd', base, 'moment', buckling_src(lbl, ctx['dsm'], 'M_', 'distortional'))],
                   result=q('Mcrd', base, 'moment'))
    bi = st.get('beta_inputs')
    if use_base or not bi:
        return i
    i_b = tr.add('modifier', 'β = 1 + 0.4 (L/Lm)^0.7 (1 + M1/M2)^0.7, 1.0 ≤ β ≤ 1.3', equation='2.3.3.3-3',
                 inputs=[q('L', bi['L'], 'length', src('buckling_analysis', key='Lcrd', basis=bi['L_basis'])),
                         q('Lm', bi['Lm'], 'length', src('user_input', key='dist_Lm')),
                         q('M1/M2', bi['M1_M2'], 'dimensionless', src('user_input', key='dist_M1_M2'))],
                 result=q('β', st['beta_dist'], 'dimensionless'))
    if st['beta_dist'] > 1.0:
        return tr.add('modifier', 'Mcrd = β Mcrd', equation='2.3.3.3-3', inputs=[tr.ref(i_b), tr.ref(i)],
                      result=q('Mcrd', st['Mcrd'], 'moment'))
    return i


def _i621_check(ctx, st, Sf, demand):
    dm = ctx['dm']
    tr = Trace()
    fy = q('Fy', ctx['Fy_original'], 'stress', src('material', key='Fy'))
    vs = ctx['state_i621']
    i_my = tr.add('yield', 'My = Sf Fy  (Mne = My, Fn = Fy)', equation='F2.1-2', inputs=[Sf, fy],
                  result=q('My', vs['My'], 'moment'))
    md = vs.get('Mnfo_detail') or {}
    if vs['Mcrl'] > 0:
        i_cr = _mcrl_steps(tr, ctx, vs, Sf)
        i_l = tr.add('slenderness', 'λℓ = (My / Mcrl)^0.5', equation='F3.2.1-3', inputs=[tr.ref(i_my), tr.ref(i_cr)],
                     result=q('λℓ', md.get('lambda_l'), 'dimensionless'))
        holds = md.get('equation') == 'F3.2.1-1'
        tr.branch('λℓ ≤ 0.776', holds, md.get('equation'), inputs=[tr.ref(i_l)])
        i_lo = tr.add('equation', 'Mnℓo = My' if holds else 'Mnℓo = [1 − 0.15 (Mcrl/My)^0.4] (Mcrl/My)^0.4 My',
                      equation=md.get('equation'), inputs=[tr.ref(i_my), tr.ref(i_cr)],
                      result=q('Mnℓo', md.get('Mnl'), 'moment'))
        if vs['Mnfo'] != md.get('Mnl'):
            i_lo = tr.add('modifier', 'Mnℓo = max(Mnℓo, local inelastic reserve F3.2.3-1)', equation='F3.2.3-1',
                          inputs=[tr.ref(i_lo)], result=q('Mnℓo', vs['Mnfo'], 'moment'))
    else:
        i_lo = tr.add('equation', 'Mnℓo = My (no Mcrl — F3 not evaluated)', inputs=[tr.ref(i_my)],
                      result=q('Mnℓo', vs['Mnfo'], 'moment'))
    R = ctx['R_uplift']
    # 기호 R 은 굽힘 안쪽 반지름(길이)에도 쓰인다 — 이 감소계수는 R_uplift (한 기호 한 물리량)
    i_r = tr.add('modifier', 'R_uplift from Table I6.2.1-1', equation='Table I6.2.1-1',
                 inputs=[q('R_uplift', R, 'dimensionless', src('user_input', key='R_uplift',
                                                                 table_row=ctx['i621_row']))],
                 result=q('R_uplift', R, 'dimensionless'))
    i_mn = tr.add('equation', 'Mn = R_uplift Mnℓo', equation='I6.2.1-1', inputs=[tr.ref(i_r), tr.ref(i_lo)],
                  result=q('Mn', ctx['Mn'], 'moment'))
    items = ne_items(ctx['not_evaluated_all'], 'I6.2.1')
    m = {'nominal': _mirror('Mn', 2)}
    if demand and ctx['Mn'] > 0:
        m['capacity'] = _mirror('design_strength', 2)
        m['ratio'] = _mirror('limit_state_checks[0].ratio', 4)
    return strength_check('member.flexure.uplift_r', tr, ctx, i_mn, 'Mn',
                          'φbMn' if dm == 'LRFD' else 'Mn/Ωb', 'moment', demand, phi=ctx['phi'], omega=ctx['omega'],
                          trusted=not items, untrusted_reason=_joined('; ', items), mirrors=m,
                          phi_symbol='φb', omega_symbol='Ωb', no_demand_reason=_nt('member.reason.no_required_flexural_strength'))


def shear_checks(ctx, sh):
    """§G2 전단 단독과 §H2 상호작용 — sh 는 _design_flexure 가 계산한 자리의 값들."""
    dm = ctx['dm']
    p = ctx['params']
    sr = sh['shear_res']
    tr = Trace()
    h = q('h', sh['h'], 'length', src('section_property', key='h_web'))
    t = q('t', sh['t'], 'length', src('section_property', key='t'))
    fy = q('Fy', sh['Fy'], 'stress', src('material', key='Fy', note='virgin Fy (§A3.3.2 excludes Chapter G)'))
    E = q('E', sh['E'], 'stress', spec())
    i_vy = tr.add('yield', 'Vy = 0.6 Aw Fy, Aw = h t', equation='G2.1-5', inputs=[h, t, fy],
                  result=q('Vy', sr['Vy'], 'force'))
    i_vcr = tr.add('elastic_buckling', f'Vcr = Aw {PI}² E kv / [12 (1 − μ²) (h/t)²], μ = 0.3', equation='G2.3-2',
                   inputs=[h, t, E, q('kv', sh['kv'], 'dimensionless', spec())], result=q('Vcr', sr['Vcr'], 'force'))
    i_l = tr.add('slenderness', 'λv = (Vy / Vcr)^0.5', equation='G2.1-4', inputs=[tr.ref(i_vy), tr.ref(i_vcr)],
                 result=q('λv', sr['lambda_v'], 'dimensionless'))
    eq = sr['equation']
    if 'yielding' in eq:
        tr.branch('λv ≤ 0.815', True, 'G2.1-1', inputs=[tr.ref(i_l)])
        i_v = tr.add('equation', 'Vn = Vy', equation='G2.1-1', inputs=[tr.ref(i_vy)], result=q('Vn,web', sr['Vn'], 'force'))
    elif 'inelastic' in eq:
        tr.branch('0.815 < λv ≤ 1.227', True, 'G2.1-2a', inputs=[tr.ref(i_l)])
        i_v = tr.add('equation', 'Vn = 0.815 (Vcr Vy)^0.5', equation='G2.1-2a', inputs=[tr.ref(i_vcr), tr.ref(i_vy)],
                     result=q('Vn,web', sr['Vn'], 'force'))
    else:
        tr.branch('λv > 1.227', True, 'G2.1-3a', inputs=[tr.ref(i_l)])
        i_v = tr.add('equation', 'Vn = Vcr', equation='G2.1-3a', inputs=[tr.ref(i_vcr)], result=q('Vn,web', sr['Vn'], 'force'))
    i_n = tr.add('equation', 'Vn = n_webs Vn,web', inputs=[tr.ref(i_v), q('n_webs', sh['n_webs'], 'count',
                                                                        src('section_property', key='webs'))],
                 result=q('Vn', sh['Vn'], 'force'))
    i_ds = design_strength_step(tr, dm, tr.ref(i_n), sh['phi_v'], sh['omega_v'], sh['Va'],
                                'φvVn' if dm == 'LRFD' else 'Vn/Ωv', 'force', phi_symbol='φv', omega_symbol='Ωv')
    vu = q('Vu', sh['Vu'], 'force', demand_source(p, 'Vu'))
    r = ratio_of(sh['Vu'], sh['Va'])
    v = verdict_from(r)
    verdict_step(tr, vu, tr.ref(i_ds), r, v)
    g2 = make_check('member.shear', design_method=dm, verdict=v, demand=vu,
                    capacity=q('φvVn' if dm == 'LRFD' else 'Vn/Ωv', sh['Va'], 'force'),
                    nominal=q('Vn', sh['Vn'], 'force'), factor_=factor(dm, sh['phi_v'], sh['omega_v'], 'φv', 'Ωv'),
                    ratio=r, steps=tr.steps,
                    mirrors={'nominal': _mirror('shear.Vn', 2), 'capacity': _mirror('shear.design_strength', 2),
                             'ratio': _mirror('shear_interaction.V_ratio', 4)})

    # §H2
    tr = Trace()
    si = sh['shear_int']
    raw = sh['h2_raw']
    mlo_in = q('Mnℓo', sh['Mnlo'], 'moment', src('check', id='member.flexure.local',
                                                  note='Mnℓo: §F3 local strength with Fn = Fy (Mne = My), virgin'))
    i_malo = design_strength_step(tr, dm, mlo_in, ctx['phi'], ctx['omega'], sh['Malo'],
                                  'Maℓo', 'moment', phi_symbol='φb', omega_symbol='Ωb')
    mu = q('M', sh['Mu'], 'moment', demand_source(p, 'Mu'))
    va = q('Va', sh['Va'], 'force', src('check', id='member.shear'))
    if sh['stiffened']:
        tr.branch('M/Maℓo > 0.5 and V/Va > 0.7', raw['applies'], 'H2-2', inputs=[mu, tr.ref(i_malo), vu, va])
        if raw['applies']:
            i_x = tr.add('equation', '0.6 (M/Maℓo) + V/Va ≤ 1.3', equation='H2-2',
                         inputs=[mu, tr.ref(i_malo), vu, va], result=q('H2', raw['lhs'], 'dimensionless'))
            lim = 1.3
            val, cap = raw['lhs'], 1.3
        else:
            i_x = tr.add('equation', 'V/Va ≤ 1.0 (Eq. H2-2 not triggered)', inputs=[vu, va],
                         result=q('H2', raw['total'], 'dimensionless'))
            lim = 1.0
            val, cap = raw['total'], 1.0
    else:
        i_x = tr.add('equation', '[(M/Maℓo)² + (V/Va)²]^0.5 ≤ 1.0', equation='H2-1',
                     inputs=[mu, tr.ref(i_malo), vu, va], result=q('H2', raw['total'], 'dimensionless'))
        lim = 1.0
        val, cap = raw['total'], 1.0
    r = val / cap
    v = 'pass' if si['pass'] else 'fail'
    tr.add('verdict', f'H2 ≤ {lim:g}', inputs=[tr.ref(i_x), q('limit', cap, 'dimensionless', spec())],
           result=q('ratio', r, 'dimensionless'), verdict=v)
    h2 = make_check('member.bending_shear', design_method=dm, verdict=v,
                    demand=q('H2', val, 'dimensionless'), capacity=q('limit', cap, 'dimensionless'),
                    ratio=r, steps=tr.steps, equation_used=si['equation'],
                    mirrors={'ratio': _mirror('shear_interaction.total', 4)})
    return [g2], [h2]


def web_crippling_check(ctx, wc):
    """§G5 단독 검토 P̄ ≤ Pa (wc: _design_flexure 의 계산값)."""
    dm = ctx['dm']
    w = wc['wc']
    det = wc.get('detail') or {}
    tr = Trace()
    row = det.get('row') or {}
    terms = det.get('terms') or {}
    if terms:
        ins = [q('C', row.get('C'), 'dimensionless', src('specification', table=w.get('table'))),
               q('CR', row.get('Cr'), 'dimensionless', src('specification', table=w.get('table'))),
               q('CN', row.get('CN'), 'dimensionless', src('specification', table=w.get('table'))),
               q('Ch', row.get('Ch'), 'dimensionless', src('specification', table=w.get('table'))),
               q('t', wc['t'], 'length', src('section_property', key='t')),
               q('Fy', wc['Fy'], 'stress', src('material', key='Fy', note='virgin Fy')),
               q('θ', terms['theta'], 'angle', src('specification', note='web inclination, default 90')),
               q('R', terms['R'], 'length', src('user_input', key='wc_R')),
               q('N', terms['N'], 'length', src('user_input', key='wc_N')),
               q('h', wc['h'], 'length', src('section_property', key='h_web'))]
        i = tr.add('equation', 'Pn = C t² Fy sinθ (1 − CR (R/t)^0.5)(1 + CN (N/t)^0.5)(1 − Ch (h/t)^0.5)',
                   equation='G5-1', inputs=ins, result=q('Pn,web', terms['Pn_per_web'], 'force'),
                   table=w.get('table'), support=w.get('support'), fastened=w.get('fastened'))
        if terms.get('multiplier', 1) != 1:
            i = tr.add('equation', 'Pn = n_webs Pn,web', inputs=[tr.ref(i), q('n_webs', terms['multiplier'], 'count',
                                                                            src('section_property', key='webs'))],
                       result=q('Pn', terms['Pn_total'], 'force'))
        if det.get('alpha') is not None and w.get('equation') == 'G5-2':
            i = tr.add('modifier', 'Pnc = min(α Pn, Pn,IOF)', equation='G5-2',
                       inputs=[tr.ref(i), q('α', det['alpha'], 'dimensionless', spec()),
                               q('Pn,IOF', det.get('Pn_interior_cap'), 'force', spec())],
                       result=q('Pnc', det['Pn_final'], 'force'))
    else:
        i = tr.add('equation', 'Pn (Eq. G5-1)', equation=w.get('equation'),
                   inputs=[q('Pn', wc['Pn'], 'force', src('specification', table=w.get('table')))],
                   result=q('Pn', wc['Pn'], 'force'))
    phi_w, om_w = w.get('phi'), w.get('omega')
    if not wc.get('Pa'):
        return not_evaluated('member.web_crippling', ctx, _nt('member.reason.table_g5_no_this_g5_row'), steps=tr.steps)
    i_ds = design_strength_step(tr, dm, tr.ref(i), phi_w, om_w, wc['Pa'], 'φwPn' if dm == 'LRFD' else 'Pn/Ωw',
                                'force', phi_symbol='φw', omega_symbol='Ωw')
    dem = q('P', wc['P'], 'force', src('user_input', key='wc_P') if wc['P_source'] == 'wc_P'
            else src('user_input', key='Vu', note='support reaction taken as Vu (assumption)'))
    r = ratio_of(wc['P'], wc['Pa'])
    items = wc.get('ne_items') or []
    v = verdict_from(r, trusted=not items)
    verdict_step(tr, dem, tr.ref(i_ds), r, v)
    return make_check('member.web_crippling', design_method=dm, verdict=v, demand=dem,
                      capacity=q('φwPn' if dm == 'LRFD' else 'Pn/Ωw', wc['Pa'], 'force'),
                      nominal=q('Pn', wc['Pn'], 'force'), factor_=factor(dm, phi_w, om_w, 'φw', 'Ωw'), ratio=r,
                      reason=_joined('; ', items) or None, steps=tr.steps, trusted=False if items else None,
                      reference={'capacity': q('Pa', wc['Pa'], 'force'), 'ratio': r} if v == 'not_evaluated' else None,
                      mirrors={'nominal': _mirror('web_crippling.Pn', 2),
                               'capacity': _mirror('web_crippling.design_strength', 3),
                               'ratio': _mirror('web_crippling.ratio', 4)})


def h3_check(ctx, h):
    """§H3 휨 + 웹 크리플링 (h: _design_flexure 의 계산값)."""
    dm = ctx['dm']
    h3, raw = h['h3'], h['raw']
    tr = Trace()
    coef = {'H3-1': (0.91, 1.33), 'H3-2': (0.88, 1.46), 'H3-3': (0.86, 1.65)}[h3['equation']]
    P = q('P', h['P'], 'force', src('user_input', key=h['P_source'] or 'wc_P'))
    Pn = q('Pn', h['Pn'], 'force', src('check', id='member.web_crippling'))
    M = q('M', h['M'], 'moment', src('user_input', key='wc_M') if h['M_given'] else
          src('engine_default', key='wc_M', note='member Mu used (conservative)'))
    Mlo = q('Mnℓo', h['Mnlo'], 'moment', src('check', id='member.flexure.local', note='§F3 with Fn = Fy, virgin'))
    i_x = tr.add('equation', f'{coef[0]:g} (P/Pn) + M/Mnℓo', equation=h3['equation'] + ('b' if dm == 'LRFD' else 'a'),
                 inputs=[P, Pn, M, Mlo], result=q('H3', raw['total'], 'dimensionless'))
    if dm == 'LRFD':
        i_lim = tr.add('equation', f'limit = {coef[1]:g} φ', inputs=[q('φ', 0.90, 'dimensionless', spec())],
                       result=q('limit', raw['limit'], 'dimensionless'))
    else:
        i_lim = tr.add('equation', f'limit = {coef[1]:g} / Ω', inputs=[q('Ω', 1.70, 'dimensionless', spec())],
                       result=q('limit', raw['limit'], 'dimensionless'))
    r = raw['total'] / raw['limit'] if raw['limit'] > 0 else None
    v = 'pass' if h3['pass'] else 'fail'
    tr.add('verdict', 'H3 / limit ≤ 1', inputs=[tr.ref(i_x), tr.ref(i_lim)], result=q('ratio', r, 'dimensionless'),
           verdict=v)
    return make_check('member.bending_web_crippling', design_method=dm, verdict=v,
                      demand=q('H3', raw['total'], 'dimensionless'), capacity=q('limit', raw['limit'], 'dimensionless'),
                      ratio=r, steps=tr.steps, equation_used=h3['equation'],
                      mirrors={'demand': _mirror('h3_interaction.total', 4), 'capacity': _mirror('h3_interaction.limit', 4)})


def positive_region_check(ctx, pr):
    """정모멘트 구간(엔진의 'F positive region') — F2 · F3 · F4 의 최소."""
    dm, p = ctx['dm'], ctx['params']
    tr = Trace()
    Sf = q('Sf', pr['Sf'], 'section_modulus', _sec('Sf', ctx))
    fy = q('Fy', pr['Fy'], 'stress', src('material', key='Fy'))
    lbs = src('user_input', key='Lb_pos') if 'Lb_pos' in p else src('engine_default', key='Lb_pos',
                                                                    note='0 (fully braced) — not given')
    cbs = src('user_input', key='Cb_pos') if p.get('Cb_pos') is not None else src('engine_default', key='Cb_pos')
    st_like = {'Fcre_raw': pr['raw'], 'Fcre': pr['Fcre'], 'global_result': pr['global_'], 'Sf_eff': pr['Sf'],
               'Fy': pr['Fy'], 'Mne': pr['Mne'], 'My': pr['Sf'] * pr['Fy'], 'Mp': 0.0}
    i_mne = _mne_steps(tr, {**ctx, 'cold_work_info': None}, st_like, pr['Lb'], pr['Cb'], lbs, cbs)
    if i_mne is None:
        i_mne = tr.add('equation', 'Mne(+)', inputs=[q('Mne', pr['Mne'], 'moment', spec())],
                       result=q('Mne', pr['Mne'], 'moment'))
    i_list = [i_mne]
    if pr['local'] is not None:
        i_cr = tr.add('elastic_buckling', 'Mcrl (same section)', inputs=[q('Mcrl', pr['Mcrl'], 'moment',
                      buckling_src(ctx['state']['Mcrl_source'], ctx['dsm'], 'M_', 'local'))],
                      result=q('Mcrl', pr['Mcrl'], 'moment'))
        lr = pr['local']
        i_l = tr.add('slenderness', 'λℓ = (Mne / Mcrl)^0.5', equation='F3.2.1-3', inputs=[tr.ref(i_mne), tr.ref(i_cr)],
                     result=q('λℓ', lr['lambda_l'], 'dimensionless'))
        holds = lr['equation'] == 'F3.2.1-1'
        tr.branch('λℓ ≤ 0.776', holds, lr['equation'], inputs=[tr.ref(i_l)])
        i_list.append(tr.add('equation', 'Mnℓ = Mne' if holds else 'Mnℓ = [1 − 0.15 (Mcrl/Mne)^0.4] (Mcrl/Mne)^0.4 Mne',
                             equation=lr['equation'], inputs=[tr.ref(i_mne), tr.ref(i_cr)],
                             result=q('Mnℓ', pr['Mnl'], 'moment')))
    if pr['dist'] is not None:
        i_my = tr.add('yield', 'My = Sf Fy', equation='F4.1-4', inputs=[Sf, fy], result=q('My', pr['Sf'] * pr['Fy'],
                                                                                         'moment'))
        i_cr = tr.add('elastic_buckling', 'Mcrd (β = 1 in the positive region)',
                      inputs=[q('Mcrd', pr['Mcrd'], 'moment', buckling_src(str(ctx['state']['Mcrd_source']).split(' [β=')[0],
                                                                          ctx['dsm'], 'M_', 'distortional'))],
                      result=q('Mcrd', pr['Mcrd'], 'moment'))
        dr = pr['dist']
        i_l = tr.add('slenderness', 'λd = (My / Mcrd)^0.5', equation='F4.1-3', inputs=[tr.ref(i_my), tr.ref(i_cr)],
                     result=q('λd', dr['lambda_d'], 'dimensionless'))
        holds = dr['equation'] == 'F4.1-1'
        tr.branch('λd ≤ 0.673', holds, dr['equation'], inputs=[tr.ref(i_l)])
        i_list.append(tr.add('equation', 'Mnd = My' if holds else 'Mnd = [1 − 0.22 (Mcrd/My)^0.5] (Mcrd/My)^0.5 My',
                             equation=dr['equation'], inputs=[tr.ref(i_my), tr.ref(i_cr)],
                             result=q('Mnd', pr['Mnd'], 'moment')))
    i_mn = tr.add('equation', 'Mn(+) = min(Mne, Mnℓ, Mnd)', inputs=[tr.ref(i) for i in i_list],
                  result=q('Mn', pr['Mn'], 'moment'))
    dem = q('Mu(+)', pr['Mu_pos'], 'moment', demand_source(p, 'Mu_pos'))
    items = pr.get('ne_items') or []
    loc = {'segment': 'positive_moment_region', 'Lb': pr['Lb'], 'Cb': pr['Cb']}
    c = strength_check('member.flexure.positive_region', tr, ctx, i_mn, 'Mn(+)',
                       'φbMn(+)' if dm == 'LRFD' else 'Mn(+)/Ωb', 'moment', dem, phi=ctx['phi'], omega=ctx['omega'],
                       trusted=not items, untrusted_reason=_joined('; ', items),
                       mirrors={'nominal': _mirror('positive_region.Mn', 2),
                                'capacity': _mirror('positive_region.phi_Mn', 2),
                                'ratio': _mirror('positive_region.utilization', 4)},
                       phi_symbol='φb', omega_symbol='Ωb', location=loc)
    return c


# ---------------------------------------------------------------- 인장 (D)

def tension_checks(ctx):
    dm, p = ctx['dm'], ctx['params']
    Tu = ctx['Tu']
    demand = q('Tu', Tu, 'force', demand_source(p, 'Tu')) if Tu and Tu > 0 else None
    A = q('Ag', ctx['Ag'], 'area', _sec('A', ctx))
    out = []
    gov = 'member.tension.yielding' if ctx['mode'] == 'Yielding' else 'member.tension.rupture'

    def mir(cid, path):
        m = {'nominal': _mirror(path, 2)}
        if cid == gov and ctx['utilization']:
            m['capacity'] = _mirror('design_strength', 2)
            m['ratio'] = _mirror('utilization', 4)
        return m

    tr = Trace()
    i = tr.add('yield', 'Tn = Ag Fy', equation='D2-1', inputs=[A, q('Fy', ctx['Fy'], 'stress', src('material', key='Fy'))],
               result=q('Tn', ctx['Tn_yield'], 'force'))
    out.append(strength_check('member.tension.yielding', tr, ctx, i, 'Tn', 'φtTn' if dm == 'LRFD' else 'Tn/Ωt',
                              'force', demand, phi=ctx['phi_y'], omega=ctx['omega_y'],
                              mirrors=mir('member.tension.yielding', 'Tn_yield'), phi_symbol='φt', omega_symbol='Ωt',
                              no_demand_reason=_nt('member.reason.no_required_tensile_strength')))
    if ctx['Tn_rupture'] is None:
        out.append(not_evaluated('member.tension.rupture', ctx, _nt('member.reason.d3_fu_given_rupture_d3')))
    else:
        tr = Trace()
        An = q('An', ctx['An'], 'area', src('user_input', key='An') if ctx['An_given'] else
               src('engine_default', key='An', note='An = Ag (no holes deducted) — assumption'))
        i = tr.add('equation', 'Tn = An Fu', equation='D3-1', inputs=[An, q('Fu', ctx['Fu'], 'stress',
                                                                         src('material', key='Fu'))],
                   result=q('Tn', ctx['Tn_rupture'], 'force'))
        out.append(strength_check('member.tension.rupture', tr, ctx, i, 'Tn', 'φtTn' if dm == 'LRFD' else 'Tn/Ωt',
                                  'force', demand, phi=ctx['phi_r'], omega=ctx['omega_r'],
                                  mirrors=mir('member.tension.rupture', 'Tn_rupture'), phi_symbol='φt',
                                  omega_symbol='Ωt', no_demand_reason=_nt('member.reason.no_required_tensile_strength')))
    return out


# ---------------------------------------------------------------- 조합 (H1)

def _cm_step(tr, ctx, axis):
    """Cm (§C1.2.1.1) — 입력 · Eq. C1.2.1.1-4 · 횡하중 1.0 · 기본 1.0 가운데 엔진이 쓴 것."""
    basis, val = ctx[f'Cm{axis}_basis'], ctx[f'Cm{axis}']
    sym = f'Cm{axis}'
    if basis == 'M1_M2':
        i = tr.add('modifier', f'{sym} = 0.6 − 0.4 (M1/M2)', equation='C1.2.1.1-4',
                   inputs=[q('M1/M2', ctx[f'M1_M2_{axis}'], 'dimensionless',
                             src('user_input', key=f'{sym}_M1_M2'))],
                   result=q(sym, val, 'dimensionless'))
        return tr.ref(i)
    if basis == 'user':
        return q(sym, val, 'dimensionless', src('user_input', key=sym))
    if basis == 'transverse':
        return q(sym, val, 'dimensionless', src('specification', key='transverse_load',
                                                 note='transverse load between supports → Cm = 1.0'))
    return q(sym, val, 'dimensionless', src('specification', key=sym, clause='C1.2.1.1',
                                            note='Cm = 1.0: upper bound of Eq. C1.2.1.1-4, permitted by (b) — '
                                                 'neither Cm nor this axis\'s end-moment ratio given'))


def _b1_steps(tr, ctx, axis, P):
    """Pe1 (§C1.2.1.1) · B1 (Eq. C1.2.1.1-3) — x 축은 KxLx/rx, y 축은 KyLy/ry. 돌려주는 값: B1 단계 번호."""
    p = ctx['params']
    L_key, r_key = ('KxLx', 'rx') if axis == 'x' else ('KyLy', 'ry')
    Lq = q(L_key, ctx[L_key], 'length', src('user_input', key=L_key) if p.get(L_key) is not None
           else src('engine_default', key=L_key, note='120 in'))
    i_pe = tr.add('elastic_buckling', f'Pe1{axis} = {PI}² E A / ({L_key} / {r_key})²', equation='C1.2.1.1-5',
                  inputs=[q('E', ctx['E'], 'stress', spec()), q('A', ctx['Ag'], 'area', _sec('A', ctx)), Lq,
                          q(r_key, ctx[r_key], 'length', _sec(r_key, ctx))],
                  result=q(f'Pe1{axis}', ctx['PEx' if axis == 'x' else 'PEy'], 'force'))
    cm = _cm_step(tr, ctx, axis)
    return tr.add('modifier', f'B1{axis} = Cm{axis} / (1 − α P / Pe1{axis}) ≥ 1.0', equation='C1.2.1.1-3',
                  inputs=[cm, q('α', ctx['c1_alpha'], 'dimensionless', spec()), P, tr.ref(i_pe)],
                  result=q(f'B1{axis}', ctx['alpha_x' if axis == 'x' else 'alpha_y'], 'dimensionless'))


def axial_bending_check(ctx):
    """§H1.2 P/Pa + Mx/Max + My/May ≤ 1 — Pa · Max 는 하위 설계의 반올림하지 않은 설계강도.

    모멘트는 사용자가 준 Mux · Muy 를 입력으로 두고, §C1.2.1.1 의 Pe1 · Cm · B1 과 증폭한 모멘트(Mx,amp ·
    My,amp)를 단계로 둔다. 앵글(§H1.2 둘째 단락)은 (P)L/1000 을 더한 My,ecc 와 더하지 않은 My,amp 가운데
    허용 P 를 더 작게 만드는 쪽(큰 쪽)을 갈래로 고른다.
    """
    dm, p = ctx['dm'], ctx['params']
    tr = Trace()
    raw = ctx['raw']
    P = q('P', ctx['Pu'], 'force', demand_source(p, 'Pu'))
    Pa = q('Pa', ctx['Pa'], 'force', src('check', id=ctx.get('Pa_id'), group='member.compression',
                                         note='least compression design strength (Chapter E)'))
    Max = q('Max', ctx['Max'], 'moment', src('check', id=ctx.get('Max_id'), group='member.flexure',
                                             note='least flexural design strength (Chapter F)'))
    mx = q('Mx', ctx['Mux'], 'moment', demand_source(p, 'Mux'))
    ins = [P, Pa]
    mx_sym = 'Mx'
    if ctx['PEx'] < 1e9:
        i_b1 = _b1_steps(tr, ctx, 'x', P)
        i_m = tr.add('demand', 'Mx,amp = B1x Mx', equation='C1.2.1.1-1', inputs=[tr.ref(i_b1), mx],
                     result=q('Mx,amp', ctx['Mux_amp'], 'moment'))
        ins += [tr.ref(i_m), Max]
        mx_sym = 'Mx,amp'
    else:
        ins += [mx, Max]
    expr = f'P/Pa + {mx_sym}/Max'
    if ctx.get('May') is not None:
        my = q('My', ctx['Muy'], 'moment', demand_source(p, 'Muy'))
        i_b1y = _b1_steps(tr, ctx, 'y', P) if ctx['PEy'] < 1e9 else None
        b1y = (tr.ref(i_b1y) if i_b1y is not None else
               q('B1y', ctx['alpha_y'], 'dimensionless',
                 src('engine_default', key='B1y', note='no amplification: P = 0 or ry not given')))
        ang = ctx.get('angle')
        if ang:
            Lq = q('L', ang['L'], 'length', src('user_input', key='L') if ang['L_given'] else
                   src('engine_default', key='L', note='member length not given — KyLy used'))
            i_pl = tr.add('demand', 'PL/1000 = P L / 1000  (angle: additional eccentricity moment, §H1.2)',
                          inputs=[P, Lq], result=q('PL/1000', ang['Padd'], 'moment'))
            i_e = tr.add('demand', 'My,ecc = B1y (My + PL/1000)', inputs=[b1y, my, tr.ref(i_pl)],
                         result=q('My,ecc', ang['My_ecc'], 'moment'))
            i_n = tr.add('demand', 'My,amp = B1y My', equation='C1.2.1.1-1', inputs=[b1y, my],
                         result=q('My,amp', ang['My_no_ecc'], 'moment'))
            tr.branch('My,ecc ≥ My,amp  (the larger moment gives the smaller allowable P — §H1.2 angle)',
                      ang['ecc_governs'], 'H1.2', inputs=[tr.ref(i_e), tr.ref(i_n)])
            ins += [tr.ref(i_e if ang['ecc_governs'] else i_n, 'My,used')]
            my_sym = 'My,used'
        elif i_b1y is not None:
            i_my = tr.add('demand', 'My,amp = B1y My', equation='C1.2.1.1-1', inputs=[b1y, my],
                          result=q('My,amp', ctx['Muy_amp'], 'moment'))
            ins += [tr.ref(i_my)]
            my_sym = 'My,amp'
        else:
            ins += [my]
            my_sym = 'My'
        ins += [q('May', ctx['May'], 'moment', src('user_input', key='May_strength'))]
        expr += f' + {my_sym}/May'
    i_x = tr.add('equation', expr, equation='H1.2-1', inputs=ins, result=q('H1.2', raw['total'], 'dimensionless'))
    tr.add('verdict', 'H1.2 ≤ 1.0', inputs=[tr.ref(i_x), q('limit', 1.0, 'dimensionless', spec())],
           result=q('ratio', raw['total'], 'dimensionless'),
           verdict='pass' if ctx['interaction']['pass'] else 'fail')
    if ctx['component_unavailable']:
        return not_evaluated('member.axial_bending', ctx, _nt('member.reason.component_strength_pn_mn'),
                             steps=tr.steps, reference={'ratio': raw['total']})
    return make_check('member.axial_bending', design_method=dm,
                      verdict='pass' if ctx['interaction']['pass'] else 'fail',
                      demand=q('H1.2', raw['total'], 'dimensionless'), capacity=q('limit', 1.0, 'dimensionless'),
                      ratio=raw['total'], steps=tr.steps,
                      mirrors={'ratio': _mirror('interaction.total', 4)})


def tension_bending_checks(ctx):
    dm, p = ctx['dm'], ctx['params']
    out = []
    T = q('T', ctx['T'], 'force', demand_source(p, 'Pu'))
    Ta = q('Ta', ctx['Ta'], 'force', src('check', id=ctx.get('Ta_id'), group='member.tension',
                                         note='least tension design strength (Chapter D)'))
    mx = q('Mx', ctx['Mux'], 'moment', demand_source(p, 'Mux'))
    my = q('My', ctx['Muy'], 'moment', demand_source(p, 'Muy'))
    for cid, val, eq in (('member.tension_bending.flange_yield', ctx['r11'], 'H1.1-1'),
                         ('member.tension_bending.buckling', ctx['r12'], 'H1.1-2')):
        tr = Trace()
        if eq == 'H1.1-1':
            fy = q('Fy', ctx['Fy'], 'stress', src('material', key='Fy'))
            sft = q('Sft', ctx['Sft'], 'section_modulus', _sec('Sft', ctx))
            i_my = tr.add('yield', 'Mnxt = Sft Fy  (§H1.1 — nominal of Eq. H1.1-3a/-3b)', inputs=[sft, fy],
                          result=q('Mnxt', ctx['Sft'] * ctx['Fy'], 'moment'))
            i_mt = design_strength_step(tr, dm, tr.ref(i_my), ctx['phi_b'], ctx['omega_b'], ctx['Maxt'], 'Maxt',
                                        'moment', phi_symbol='φb', omega_symbol='Ωb')
            tr.steps[i_mt]['equation'] = 'H1.1-3b' if dm == 'LRFD' else 'H1.1-3a'
            # 약축 강도가 없으면(엔진은 1e10 을 '약축 항 없음'으로 쓴다) My 항을 싣지 않는다 — 그 항은 0 이다.
            if ctx['Mayt'] < 1e9:
                ins = [mx, tr.ref(i_mt), my, q('Mayt', ctx['Mayt'], 'moment', src('user_input', key='May_strength')),
                       T, Ta]
                expr = 'Mx/Maxt + My/Mayt + T/Ta'
            else:
                ins, expr = [mx, tr.ref(i_mt), T, Ta], 'Mx/Maxt + T/Ta  (no weak-axis moment)'
        else:
            mxa = q('Max', ctx['Max'], 'moment', src('check', id=ctx.get('Max_id'), group='member.flexure',
                                                     note='least flexural design strength (Chapter F)'))
            if ctx['May'] < 1e9:
                ins = [mx, mxa, my, q('May', ctx['May'], 'moment', src('user_input', key='May_strength')), T, Ta]
                expr = 'Mx/Max + My/May − T/Ta'
            else:
                ins, expr = [mx, mxa, T, Ta], 'Mx/Max − T/Ta  (no weak-axis moment)'
        i_x = tr.add('equation', expr, equation=eq, inputs=ins, result=q(eq, val, 'dimensionless'))
        v = 'fail' if val > 1.0 else 'pass'
        tr.add('verdict', f'{eq} ≤ 1.0', inputs=[tr.ref(i_x), q('limit', 1.0, 'dimensionless', spec())],
               result=q('ratio', val, 'dimensionless'), verdict=v)
        mirrors = {'ratio': _mirror('interaction.eq_H1_1_1' if eq == 'H1.1-1' else 'interaction.eq_H1_1_2', 4)}
        out.append(make_check(cid, design_method=dm, verdict=v, demand=q(eq, val, 'dimensionless'),
                              capacity=q('limit', 1.0, 'dimensionless'), ratio=val, steps=tr.steps, mirrors=mirrors))
    return out


# ---------------------------------------------------------------- 조합 결과로 옮길 때

# 하위 결과의 필드 → 조합 결과에서 같은 값이 있는 자리(없으면 mirrors 에서 뺀다)
_SUB_FIELDS = {
    'compression': {'design_strength': 'compression.design_strength', 'Pn': 'compression.Pn'},
    'flexure_x': {'design_strength': 'flexure_x.design_strength', 'Mn': 'flexure_x.Mn'},
    'tension': {'design_strength': 'tension.design_strength', 'Tn': 'tension.Tn'},
}
# 조합 결과로 그대로 복사되는 하위 키(경로가 같다)
_COPIED_PREFIXES = ('shear.', 'shear_interaction.', 'web_crippling.', 'h3_interaction.', 'positive_region.')


def remap_mirrors(checks: list, sub: str) -> list:
    """하위 설계(압축 · 휨x · 인장)의 항목을 조합 결과에 싣는다 — mirrors 경로를 조합 결과 기준으로."""
    out = []
    table = _SUB_FIELDS[sub]
    for c in checks:
        c = dict(c)
        m = c.get('mirrors')
        if m:
            nm = {}
            for k, v in m.items():
                path = v['path']
                if path.startswith(_COPIED_PREFIXES):
                    nm[k] = v
                elif path in table:
                    nm[k] = {**v, 'path': table[path]}
            if nm:
                c['mirrors'] = nm
            else:
                c.pop('mirrors', None)
        c['part_of'] = sub
        if c['verdict'] == 'not_evaluated' and str(c.get('reason') or '').startswith('no required'):
            # 조합 검토의 성분에 그 소요가 없으면(예: Mux = 0) 그 성분 단독 검토는 해당하지 않는다 —
            # 상호작용(§H1)이 그 성분 강도를 0 항으로 쓴다.
            c['verdict'] = 'not_applicable'
            c['reason'] = _joined(' — ', [c['reason'], _nt('member.reason.no_demand_in_combined_check')])
        out.append(c)
    return out


def demote_to_not_evaluated(check: dict, reason: str) -> dict:
    """평가는 했지만 엔진 판정이 '판정 없음'으로 내린 항목 — 값은 reference 로 옮긴다."""
    c = dict(check)
    c['reference'] = {'capacity': c.get('capacity'), 'ratio': c.get('ratio'), 'demand': c.get('demand')}
    c.update(verdict='not_evaluated', reason=reason, capacity=None, ratio=None, nominal=None, factor=None)
    c.pop('mirrors', None)
    if c['steps'] and c['steps'][-1]['kind'] == 'verdict':
        c['steps'] = list(c['steps'])
        c['steps'][-1] = {**c['steps'][-1], 'verdict': 'not_evaluated'}
    return c


# ---------------------------------------------------------------- 표 B4.1-1 적용 한계

def b4_check(dm, items, dsm_warnings, exceeded, generated=None):
    """§B4.1 표 B4.1-1 — check_dsm_limits 가 검토한 한계마다 비 · 한계 · 표의 행(단계)."""
    tr = Trace()
    for it in items:
        num_sym, num_val, num_q = it['num']
        ins = [q(num_sym, num_val, num_q, src('material', key='Fy') if num_sym == 'Fy'
                 else src('section_property', key=num_sym, generated=True if generated else None))]
        if it['den'] is not None:
            den_sym, den_val, den_q = it['den']
            ins.append(q(den_sym, den_val, den_q, src('section_property', key=den_sym,
                                                      generated=True if generated else None)))
            i_r = tr.add('equation', it['label'], inputs=ins, result=q(it['label'].split()[-1], it['ratio'],
                                                                         'dimensionless'))
            ref = tr.ref(i_r)
            lim = q('limit', it['limit'], 'dimensionless', src('specification', table='B4.1-1', row=it['row']))
        else:
            # 응력 한계는 단위가 있는 값이다 — 식 문자열에 숫자를 넣지 않고 입력(quantity)으로(V6-11)
            ref = ins[0]
            lim = q(f"{ref['symbol']},limit", it['limit'], 'stress', src('specification', table='B4.1-1',
                                                                        row=it['row']))
            tr.branch(f"{ref['symbol']} {'<' if it['strict'] else '≤'} {ref['symbol']},limit  ({it['row']})",
                      it['ok'], 'Table B4.1-1', inputs=[ref, lim])
            continue
        tr.branch(f"{ref['symbol']} {'<' if it['strict'] else '≤'} {it['limit']:g}  ({it['row']})", it['ok'],
                  'Table B4.1-1', inputs=[ref, lim])
    labels = {it['label'].split()[-1] for it in items}
    unchecked = []
    if not ({'h/t', 'w/t'} & labels):
        unchecked.append('web')
    if not ({'b/t', 'd/t'} & labels) and 'flange' not in ' '.join(it['label'] for it in items):
        unchecked.append('flange')
    if exceeded:
        return make_check('member.applicability.b4', design_method=dm, verdict='not_evaluated',
                          reason=_joined('; ', dsm_warnings), steps=tr.steps)
    if not items:
        # 두께를 몰라 표 B4.1-1 을 하나도 대조하지 못했다 — 엔진은 이것으로 판정을 내리지 않는다(counts=False).
        return make_check('member.applicability.b4', design_method=dm, verdict='not_evaluated', counts=False,
                          reason=_nt('member.reason.table_b4_1_1_b4_limits_checked_thickness'))
    note = ((_nt('member.reason.checked_element_dimensions_given', unchecked=', '.join(unchecked))) if unchecked else None)
    # 넘지 않으면 판정에 들지 않는다(엔진은 한계를 넘을 때만 판정을 '판정 없음'으로 내린다).
    return make_check('member.applicability.b4', design_method=dm, verdict='pass', steps=tr.steps,
                      counts=False, reason=note,
                      steps_unavailable='no element dimensions given — only the limits listed were checked')
