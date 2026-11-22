"""접합부 설계(connections.design_connection)의 검토 항목(design_checks) 만들기.

엔진의 판정 규칙을 그대로 옮긴다(connections.design_connection):
- 면내 전단(V) · 축방향 인장(T) 소요를 각 방향의 한계상태와 비교한다. 엔진은 방향마다 가정값 없이
  평가한(verified) 한계상태의 최소 설계강도와 비교하므로, 한계상태 하나하나의 비 V/φRn 중 가장 큰 것이
  엔진의 비와 같다.
- 설계강도는 반올림하지 않은 값으로 비교한다(limit_states[i].design_strength 는 표시용 소수 3자리).
- 가정값으로 만든 한계상태(assumed)는 판정에 쓰지 않는다 → not_evaluated(참고값은 reference).
- 소요가 없는 방향의 한계상태는 not_applicable, 소요가 하나도 없으면 not_evaluated(소요 없음).
"""

from design.checks import (
    Trace, q, src, spec, make_check, design_strength_step, factor, connection_check_id, set_governing,
    apply_context, demand_source,
)

_UNTRACED = ('nominal-strength inputs of this limit state are not traced step by step — '
             'see limit_states[{i}].formula for the engine text')


def _nominal_symbol(item):
    f = str(item.get('formula') or '')
    head = f.split('=')[0].strip() if '=' in f else ''
    return head if head and len(head) <= 8 and ' ' not in head else 'Rn'


def build(result: dict, data: dict, V: float, T: float, params: dict | None = None) -> list:
    """result: _finish 가 만든 접합부 결과, data: _finish 가 떼어 둔 계산서 재료."""
    params = params or {}
    dm = result['design_method']
    checks = []
    by_id = {}
    shear_dem = (q('Vu', V, 'force', demand_source(params, 'Vu')) if V > 0 else None)
    tens_dem = (q('Tu', T, 'force', demand_source(params, 'Tu')) if T > 0 else None)
    old_checks = result.get('checks') or []

    for i, item in enumerate(result.get('limit_states') or []):
        cid = connection_check_id(item['name'])
        if cid is None:
            raise KeyError(f"connection limit state {item['name']!r} has no registered check id")
        tr = Trace()
        trace = data['traces'][i]
        rn_raw = data['Rn_raw'][i]
        sym = _nominal_symbol(item)
        if trace:
            tr.steps.extend(trace)
            last = tr.steps[-1]['result']
            sym = last['symbol']
            nom_idx = len(tr.steps) - 1
            untraced = None
        else:
            untraced = _UNTRACED.format(i=i)
            nom_idx = tr.add('equation', f'{sym} per Eq. {item.get("equation")}', equation=item.get('equation'),
                             inputs=[], result=q(sym, rn_raw, 'force'), untraced=untraced)
        cap_sym = f'φ{sym}' if dm == 'LRFD' else f'{sym}/Ω'
        # 엔진은 반올림하지 않은 설계강도로 지배 · 판정을 정한다(limit_states[i].design_strength 는 표시용).
        cap = data['ds_raw'][i] if data.get('ds_raw') else item['design_strength']
        i_ds = design_strength_step(tr, dm, tr.ref(nom_idx), item['phi'], item['omega'], cap, cap_sym, 'force')
        direction = item.get('direction', 'shear')
        dem = shear_dem if direction == 'shear' else tens_dem
        other = tens_dem if direction == 'shear' else shear_dem
        mirrors = {'nominal': {'path': f'limit_states[{i}].Rn', 'digits': 3},
                   'capacity': {'path': f'limit_states[{i}].design_strength', 'digits': 3}}
        common = dict(design_method=dm, nominal=q(sym, rn_raw, 'force'),
                      factor_=factor(dm, item['phi'], item['omega']), steps=tr.steps, mirrors=mirrors,
                      direction=direction, basis=item.get('basis'), assumed=True if item.get('assumed') else None,
                      steps_note=untraced)
        if dem is None:
            if other is not None:
                c = make_check(cid, verdict='not_applicable',
                               reason=f'no {"in-plane shear" if direction == "shear" else "axial tension"} '
                                      'demand on the connection', capacity=None,
                               reference={'capacity': q(cap_sym, cap, 'force')}, **common)
            else:
                c = make_check(cid, verdict='not_evaluated', reason='no required strength given (Vu = Tu = 0)',
                               reference={'capacity': q(cap_sym, cap, 'force')}, **common)
        else:
            ratio = dem['value'] / cap if cap > 0 else None
            if item.get('assumed'):
                c = make_check(cid, verdict='not_evaluated',
                               reason='computed from an assumed input (e = 1.5d minimum or an estimated fastener '
                                      'strength) — reference only, not used for the verdict',
                               demand=dem, reference={'capacity': q(cap_sym, cap, 'force'), 'ratio': ratio},
                               **common)
                tr.add('verdict', f'{dem["symbol"]} / {cap_sym} ≤ 1', inputs=[dem, tr.ref(i_ds)],
                       result=q('ratio', ratio, 'dimensionless'), verdict='not_evaluated')
            else:
                v = 'fail' if dem['value'] > cap + 1e-9 else 'pass'
                tr.add('verdict', f'{dem["symbol"]} / {cap_sym} ≤ 1', inputs=[dem, tr.ref(i_ds)],
                       result=q('ratio', ratio, 'dimensionless'), verdict=v)
                c = make_check(cid, verdict=v, demand=dem, capacity=q(cap_sym, cap, 'force'), ratio=ratio,
                               **common)
                gov_name = result.get('shear_verified_governing_mode' if direction == 'shear'
                                      else 'tension_verified_governing_mode')
                if gov_name == item['name']:
                    label = ('전단(면내) — ' if direction == 'shear' else '인장(축방향) — ') + item['name']
                    for k, oc in enumerate(old_checks):
                        if oc.get('name') == label:
                            c['mirrors']['ratio'] = {'path': f'checks[{k}].ratio', 'digits': 4}
        if cid in by_id:
            raise KeyError(f'duplicate connection check id {cid}')
        by_id[cid] = c
        checks.append(c)

    for i, ic in enumerate(result.get('interaction_checks') or []):
        cid = connection_check_id(ic['name'])
        if cid is None:
            raise KeyError(f"interaction {ic['name']!r} has no registered check id")
        raw = data['iraws'][i] or {'value': ic['value'], 'limit': ic['limit'], 'ratio': ic['ratio']}
        qty = raw.get('quantity', 'dimensionless')
        tr = Trace()
        if 'Fnt_red' in raw:
            i_fv = tr.add('equation', 'fv = V / (n Ab)', inputs=[q('V', V, 'force', demand_source(params, 'Vu'))],
                          result=q('fv', raw['fv'], 'stress'), equation='J3.4-2/-3')
            i_fn = tr.add('equation', "F'nt = 1.3 Fnt − (Fnt / (φ Fnv)) fv ≤ Fnt" if dm == 'LRFD'
                          else "F'nt = 1.3 Fnt − (Ω Fnt / Fnv) fv ≤ Fnt", equation=ic['equation'].split(' ')[0],
                          inputs=[tr.ref(i_fv)], result=q("F'nt", raw['Fnt_red'], 'stress'))
            i_p = tr.add('equation', "Pnt' = n Ab F'nt", inputs=[tr.ref(i_fn)],
                         result=q("Pnt'", raw['Pnt_prime'], 'force'))
            i_x = design_strength_step(tr, dm, tr.ref(i_p), 0.75, 2.00, raw['limit'],
                                       "φPnt'" if dm == 'LRFD' else "Pnt'/Ω", 'force')
            dem = q('T', raw['value'], 'force', demand_source(params, 'Tu'))
            cap = q("φPnt'" if dm == 'LRFD' else "Pnt'/Ω", raw['limit'], 'force')
            ref_cap = tr.ref(i_x)
        elif (data.get('itraces') or [None] * (i + 1))[i]:
            it = data['itraces'][i]
            tr.steps.extend(it['steps'])
            dem = tr.ref(it['value_step'], 'value')
            if it.get('limit_step') is not None:
                ref_cap = tr.ref(it['limit_step'], 'limit')
                cap = q('limit', raw['limit'], 'dimensionless')
            else:
                cap = q('limit', raw['limit'], 'dimensionless', spec())
                ref_cap = cap
        else:
            i_x = tr.add('equation', f"interaction value (Eq. {ic['equation']})", equation=ic['equation'],
                         inputs=[], result=q('value', raw['value'], 'dimensionless'),
                         untraced='terms of the interaction value are not traced (see interaction_checks)')
            dem = tr.ref(i_x, 'value')
            cap = q('limit', raw['limit'], 'dimensionless', spec())
            ref_cap = cap
        v = 'pass' if ic['pass'] else 'fail'
        tr.add('verdict', 'value / limit ≤ 1', inputs=[dem, ref_cap], result=q('ratio', raw['ratio'], 'dimensionless'),
               verdict=v)
        c = make_check(cid, design_method=dm, verdict=v, demand=dem if qty == 'force' else q('value', raw['value'],
                                                                                              'dimensionless'),
                       capacity=cap, ratio=raw['ratio'], steps=tr.steps, basis=ic.get('basis'),
                       equation_used=ic.get('equation'),
                       mirrors={'demand': {'path': f'interaction_checks[{i}].value', 'digits': 4},
                                'capacity': {'path': f'interaction_checks[{i}].limit', 'digits': 4},
                                'ratio': {'path': f'interaction_checks[{i}].ratio', 'digits': 4}})
        if cid in by_id:
            raise KeyError(f'duplicate connection check id {cid}')
        by_id[cid] = c
        checks.append(c)

    for i, dc in enumerate(result.get('detailing_checks') or []):
        cid = connection_check_id(dc['name'])
        if cid is None:
            raise KeyError(f"detailing check {dc['name']!r} has no registered check id")
        raw = data['draws'][i] or {'provided': dc['provided'], 'required': dc['required']}
        tr = Trace()
        req = q('required', raw['required'], 'length', spec())
        prov = q('provided', raw['provided'], 'length', src('user_input', key='geometry'))
        ratio = raw['required'] / raw['provided'] if raw['provided'] > 0 else None
        v = 'pass' if dc['pass'] else 'fail'
        tr.add('verdict', 'required ≤ provided', inputs=[req, prov], result=q('ratio', ratio, 'dimensionless'),
               verdict=v)
        c = make_check(cid, design_method=dm, verdict=v, demand=req, capacity=prov, ratio=ratio, steps=tr.steps,
                       mirrors={'demand': {'path': f'detailing_checks[{i}].required', 'digits': 4},
                                'capacity': {'path': f'detailing_checks[{i}].provided', 'digits': 4}})
        if cid in by_id:
            raise KeyError(f'duplicate connection check id {cid}')
        by_id[cid] = c
        checks.append(c)

    # 평가하지 못한 항목(해당하면 not_evaluated, 소요 방향과 무관하면 not_applicable)
    relevant = result.get('not_evaluated_relevant')
    items = list(result.get('not_evaluated') or [])
    for x in relevant or []:
        if x not in items:
            items.append(x)
    merged = {}
    for x in items:
        cid = connection_check_id(x['name'])
        if cid is None:
            raise KeyError(f"not-evaluated item {x['name']!r} has no registered check id")
        rel = relevant is None or x in relevant
        m = merged.setdefault(cid, {'reasons': [], 'relevant': False})
        m['reasons'].append(f"{x['name']}: {x['reason']}")
        m['relevant'] = m['relevant'] or rel
    for cid, m in merged.items():
        reason = '; '.join(m['reasons'])
        if cid in by_id:
            c = by_id[cid]
            c['reason'] = '; '.join(r for r in (c.get('reason'), reason) if r)
            if m['relevant'] and c['verdict'] == 'pass':
                c.update(verdict='not_evaluated', reference={'capacity': c['capacity'], 'ratio': c['ratio']},
                         capacity=None, ratio=None, nominal=None, factor=None)
            continue
        if m['relevant']:
            c = make_check(cid, design_method=dm, verdict='not_evaluated', reason=reason)
        else:
            c = make_check(cid, design_method=dm, verdict='not_applicable',
                           reason=reason + ' — not relevant to the given demand direction(s)')
        by_id[cid] = c
        checks.append(c)

    pref = {}
    for g, key in (('conn.shear', 'shear_verified_governing_mode'), ('conn.tension', 'tension_verified_governing_mode')):
        if result.get(key):
            pref[g] = connection_check_id(result[key])
    set_governing(checks, pref)
    apply_context(checks, params)
    return checks
