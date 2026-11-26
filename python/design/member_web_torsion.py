"""부재 설계(_design_flexure)의 보강 웹 · 구멍이 있는 웹 · 비틀림 — 2026-11-26 EB.

- §G2.2 · §G2.3(b) (횡방향 웹 보강재가 있는 웹의 전단) — 보강재가 §G4.1 을 맞출 때만. 자료가 모자라면 평가하지
  않고 §G2.1(kv = 5.34) 값을 보수측 참고값으로만 싣는다. §G4.2(맞지 않는 보강재)도 평가하지 않는다.
- §G4.1 횡방향 웹 보강재 요건(간격, Is ≥ Eq. G4.1-1, Ast ≥ Eq. G4.1-2) — 따로 된 검토 항목 member.web_stiffeners.
- §H2 의 보강 웹 식(Eq. H2-2, M/Maℓo > 0.5 이고 V/Va > 0.7 일 때; Maℓo = min(F3, F4)) — §G4 의 보강재일 때만.
- §G3 구멍이 있는 C 단면 웹의 전단(qs), §G6 구멍이 있는 C 단면 웹의 웹 크리플링(Rc).
- §H4 휨 + 비틀림의 R(Eq. H4-1): 응력을 직접(길 ①) 또는 하중 편심으로 계산(길 ②, design/torsion.py).
입력이 없으면(보강재 · 구멍 · 비틀림 어느 것도) 아무것도 하지 않는다 — 옛 결과 그대로(결정 T4).
계산식 · 한계 · 원문 인용은 design/shear.py · design/torsion.py 에 있다.
"""

from design.shear import (shear_web_strength, stiffener_inputs, hole_inputs, g6_reduction)
from design.notices import N as _nt, joined as _joined
from design.checks import (Trace, q, src, spec, make_check, ratio_of, verdict_from, verdict_step,
                           design_strength_step, factor, demand_source)

TORSION_KEYS = ('torsion_f_bending', 'torsion_f_torsion', 'torsion_f_bending_max', 'torsion_at_web_flange_junction',
                'torsion_eccentricity', 'torsion_span', 'torsion_load', 'torsion_support')
# §H4 길 ① 의 단면(대칭축 = x 축에 대해 휨): C · 트랙 · 시그마(x 축 대칭), I · RHS · CHS(이축 대칭)
_H4_SYMMETRIC_TYPES = ('C', 'TRACK', 'SIGMA', 'I', 'RHS', 'CHS')


def _given(v):
    return v is not None and not (isinstance(v, str) and v.strip() == '')


def _has_model(p: dict) -> bool:
    n, e = p.get('node'), p.get('elem')
    return n is not None and e is not None and len(n) > 0 and len(e) > 0


def web_inputs(params: dict) -> dict | None:
    st, ho = stiffener_inputs(params), hole_inputs(params)
    if st is None and ho is None:
        return None
    return {'stiffeners': st, 'holes': ho}


def torsion_given(params: dict) -> bool:
    return any(_given(params.get(k)) for k in TORSION_KEYS)


# ================================================================ §G2 · §G3 · §G4 · §H2 (부재)

def flexure_shear(result: dict, ck: dict, params: dict, geom: dict, *, Fy_v, E, Mu, Mnfo_v, Mnd_v, phi, omega,
                  design_method, section_type) -> bool:
    """보강재 · 구멍 입력이 있으면 전단 · §H2 를 여기서 다 하고 True. 없으면 False(옛 길)."""
    web = web_inputs(params)
    h, t = geom.get('h_web') or 0.0, geom.get('t') or 0.0
    if web is None or not (h > 0 and t > 0):
        return False
    from design import aisi_s100 as A
    from design.interaction import combined_bending_shear, combined_bending_shear_stiffened
    canon = A._canonical_section_type(params)
    sr = shear_web_strength(h, t, Fy_v, E=E, stiffeners=web['stiffeners'], holes=web['holes'], section_canon=canon)
    g4 = sr.get('g4')
    n_webs = int(params.get('shear_n_webs') or geom.get('n_webs') or (2 if section_type == 'RHS' else 1))
    phi_v, omega_v = A.PHI['shear'], A.OMEGA['shear']
    Vu = abs(params.get('Vu') or 0)
    stiffened = web['stiffeners'] is not None
    conforming = bool(g4 and g4.get('conforming'))
    Vn_web = sr['Vn'] if sr['evaluated'] else (sr['reference'] or {}).get('Vn')
    res_shear = {'evaluated': sr['evaluated'], 'reason': sr['reason'], 'curve': sr['curve'], 'kv': sr['kv'],
                 'kv_equation': sr['kv_equation'], 'qs': sr['qs'], 'stiffened': stiffened, 'holes': sr['holes'],
                 'reference_only': (not sr['evaluated']) and Vn_web is not None,
                 'Vy': sr['Vy'], 'Vcr': sr['Vcr'], 'lambda_v': sr['lambda_v'], 'equation': sr['equation'],
                 'warnings': sr['warnings'], 'assumptions': sr['assumptions'], 'scope_notes': sr['scope_notes'],
                 'n_webs': n_webs, 'Vu': round(Vu, 2)}
    if sr.get('g3') and sr['g3'].get('c') is not None:
        res_shear.update(c=sr['g3']['c'], c_over_t=sr['g3']['c_over_t'])
    if web['holes'] is not None:
        result.setdefault('assumptions', []).append(_nt('member.assumption.holes_at_demand_section'))
    for w in sr['warnings']:
        if w not in result.setdefault('warnings', []):
            result['warnings'].append(w)
    for a in sr['assumptions']:
        result.setdefault('assumptions', []).append(a)
    for s in sr['scope_notes']:
        if s not in result.setdefault('scope_notes', []):
            result['scope_notes'].append(s)
    data = dict(sr=sr, h=h, t=t, Fy=Fy_v, E=E, n_webs=n_webs, phi_v=phi_v, omega_v=omega_v, Vu=Vu, Mu=Mu,
                stiffened=stiffened, conforming=conforming, g4=g4, web=web)
    ck['shear_eb'] = data
    if g4 is not None:
        result['web_stiffeners'] = _g4_block(g4)
        _g4_verdict(result, g4)
    if Vn_web is None:
        # 평가하지 못했고 보수측 참고값도 없다(구멍 한계 밖 등) — 전단 · §H2 미평가
        result['shear'] = res_shear
        A._mark_not_evaluated(result, _nt('member.ne.g2_h2_shear_why', why=sr['reason']))
        result['spec_sections'].extend(['G2', 'H2'] + (['G3'] if web['holes'] is not None else [])
                                       + (['G4'] if stiffened else []))
        return True
    Vn = Vn_web * n_webs
    Va = phi_v * Vn if design_method == 'LRFD' else Vn / omega_v
    # §H2: Maℓo = §F3 (Fn = Fy) — 보강재가 있으면 (b) F3 와 F4 가운데 작은 값(원문 (b)(1)(2)). 참고값의 길도 옛 규칙 그대로.
    Mnlo = min(Mnfo_v, Mnd_v) if stiffened else Mnfo_v
    Malo = phi * Mnlo if design_method == 'LRFD' else Mnlo / omega
    h2_raw = {}
    if stiffened:
        si = combined_bending_shear_stiffened(Mu, Malo, Vu, Va, _raw=h2_raw)
    else:
        si = combined_bending_shear(Mu, Malo, Vu, Va, _raw=h2_raw)
    si['Malo'] = round(Malo, 2)
    si['Mnlo'] = round(Mnlo, 2)
    si['evaluated'] = sr['evaluated']
    si = dict(si, **{A._DISPLAY_UNROUNDED: {'Malo': Malo, 'Mnlo': Mnlo}})
    data.update(Vn_web=Vn_web, Vn=Vn, Va=Va, Mnlo=Mnlo, Malo=Malo, shear_int=si, h2_raw=h2_raw,
                kv=sr['kv'] if sr['evaluated'] else 5.34)
    eq = si['equation']
    result['steps'].append({
        'step': 8, 'name': f'Bending + Shear (§H2, Eq. {"H2-2" if stiffened else "H2-1"})',
        'value': si['total'], 'unit': '',
        'formula': (f"Vn = {Vn:.2f} kips ({sr['equation']}" + (f", qs = {sr['qs']:.3f}" if sr['qs'] is not None else '')
                    + f"), Malo = {Malo:.2f} kip-in, Va = {Va:.2f} kips → H2 = {si['total']:.3f}"
                    + ('' if sr['evaluated'] else ' (reference only — not evaluated)')),
        'equation': eq,
    })
    res_shear.update({'Vn': round(Vn, 2), 'Vn_per_web': round(Vn_web, 2), 'design_strength': round(Va, 2),
                      A._DISPLAY_UNROUNDED: {'Vn': Vn, 'Vn_per_web': Vn_web, 'design_strength': Va, 'Vu': Vu}})
    result['shear'] = res_shear
    result['shear_interaction'] = si
    result['spec_sections'].extend(['G2', 'H2'] + (['G3'] if web['holes'] is not None else [])
                                   + (['G4'] if stiffened else []))
    if sr['evaluated'] and (not stiffened or conforming):
        A._merge_governing_check(result, si, 'H2 bending + shear')
    else:
        A._merge_governing_check(result, {'total': si['total'], 'pass': None}, 'H2 bending + shear')
        A._mark_not_evaluated(result, _nt('member.ne.g2_h2_shear_why', why=sr['reason']))
    return True


def _g4_block(g4: dict) -> dict:
    keys = ('a', 'kind', 'Is', 'As', 'Fy_st', 'a_over_h', 'a_over_h_limit', 'kv', 'Is_min', 'Is_min_raw', 'Is_floor',
            'Cv', 'Y', 'D', 'Ast_min')
    out = {k: g4.get(k) for k in keys if g4.get(k) is not None}
    out.update(conforming=g4.get('conforming'), missing=list(g4.get('missing') or []), reason=g4.get('reason'),
               g4_2=bool(g4.get('g4_2')))
    r = _g4_ratio(g4)
    if r is not None:
        out['ratio'] = round(r, 4)
        out['display_unrounded'] = {'ratio': r}
    return out


def _g4_ratio(g4: dict):
    """요건 비: max(Is,min/Is, Ast/As, (a/h)/한계) — 자료가 모두 있을 때만."""
    if g4.get('missing') or g4.get('a_over_h') is None or g4.get('Ast_min') is None:
        return None
    if not (g4.get('Is') and g4['Is'] > 0 and g4.get('As') and g4['As'] > 0):
        return None
    return max(g4['Is_min'] / g4['Is'], g4['Ast_min'] / g4['As'], g4['a_over_h'] / g4['a_over_h_limit'])


def _g4_verdict(result, g4):
    from design import aisi_s100 as A
    r = _g4_ratio(g4)
    if r is not None and not g4.get('g4_2_kind'):
        A._merge_governing_check(result, {'total': r, 'pass': r <= 1.0}, 'G4.1 transverse web stiffeners')
    elif g4.get('reason') is not None:
        A._mark_not_evaluated(result, _nt('member.ne.g4_stiffeners_why', why=g4['reason']))


# ================================================================ §G6 (부재의 웹 크리플링)

def flexure_g6(result: dict, wc: dict, wc_detail: dict | None, params: dict, geom: dict, *, h, t, N) -> str | None:
    """구멍 입력이 있으면 §G6 Rc 를 G5 결과에 곱한다(제자리). 평가하지 못하면 까닭(알림)을 돌려준다. 구멍 입력이 없으면 None."""
    holes = hole_inputs(params)
    if holes is None:
        return None
    from design import aisi_s100 as A
    d = geom.get('depth') or 0.0
    if not d > 0:
        R = float(geom.get('R') or 0.0)
        d = h + 2.0 * (R + t)
        result.setdefault('assumptions', []).append(_nt('member.assumption.g6_depth_estimated', d=d))
    g6 = g6_reduction(wc, h, t, N, d, holes)
    wc['g6'] = g6
    for a in ((g6.get('limits') or {}).get('assumptions') or []):
        if a not in result.setdefault('assumptions', []):
            result['assumptions'].append(a)
    if not g6['evaluated']:
        return g6['reason']
    Rc = g6['Rc']
    pn0 = wc_detail['Pn_final'] if wc_detail else wc['Pn']
    pn = Rc * pn0
    if wc_detail is not None:
        wc_detail['g6'] = dict(g6, Pn_g5=pn0)
        wc_detail['Pn_final'] = pn
    wc.update(Pn=round(pn, 3), Pn_without_holes=round(pn0, 3), Rc=round(Rc, 4),
              phi_Pn=round(wc['phi'] * pn, 3), Pa=round(pn / wc['omega'], 3) if wc.get('omega') else None)
    wc['spec_sections'] = list(wc.get('spec_sections') or []) + ['G6']
    du = dict(wc.get(A._DISPLAY_UNROUNDED) or {})
    du.update(Pn=pn, Pn_without_holes=pn0, Rc=Rc, phi_Pn=wc['phi'] * pn)
    if wc.get('omega'):
        du['Pa'] = pn / wc['omega']
    wc[A._DISPLAY_UNROUNDED] = du
    note = _nt('shear.scope.g6_web_with_holes')
    if note not in result.setdefault('scope_notes', []):
        result['scope_notes'].append(note)
    result['spec_sections'].append('G6')
    return None


def g6_not_evaluated(result: dict, wc: dict, why) -> None:
    """§G6 를 평가하지 못함 — G5 · H3 판정 없음(구멍 없는 Pn 은 보수측이 아니라 참고값도 싣지 않는다)."""
    from design import aisi_s100 as A
    result['web_crippling'] = {k: v for k, v in wc.items() if k not in ('Pn', 'phi_Pn', 'Pa', 'Pn_per_web')}
    result['web_crippling'].update(Pn=None, evaluated=False, reason=why)
    result['web_crippling'].pop(A._DISPLAY_UNROUNDED, None)
    A._mark_not_evaluated(result, _nt('member.ne.g5_g6_web_crippling_why', why=why),
                          _nt('shear.warning.g6_not_evaluated', why=why))
    A._mark_not_evaluated(result, _nt('member.ne.h3_web_crippling_why', why=why))
    result['spec_sections'].extend(['G5', 'G6'])


# ================================================================ §H4

def flexure_torsion(result: dict, ck: dict, params: dict, geom: dict, *, Mu, Mnfo_v, phi, omega,
                    design_method) -> None:
    """torsion_* 입력이 있으면 §H4 의 R 과 그 검토. 없으면 아무것도 하지 않는다."""
    if not torsion_given(params):
        return
    from design import aisi_s100 as A
    from design import torsion as T
    p = params
    canon = A._canonical_section_type(p)
    edge_c = canon == 'C' and bool(geom.get('has_lip'))
    Malo = phi * Mnfo_v if design_method == 'LRFD' else Mnfo_v / omega
    data = {'Mnlo': Mnfo_v, 'Malo': Malo, 'Mu': Mu, 'canon': canon, 'edge_c': edge_c}
    ck['h4'] = data
    direct = _given(p.get('torsion_f_bending')) or _given(p.get('torsion_f_torsion'))
    data['route'] = 'direct' if direct else 'computed'

    def _ne(why, na=False):
        data['na' if na else 'ne'] = why
        result['torsion'] = {'route': data['route'], 'evaluated': False, 'reason': why,
                             'applicable': not na}
        if not na:
            A._mark_not_evaluated(result, _nt('member.ne.h4_bending_torsion_why', why=why))
        result['spec_sections'].append('H4')

    if (p.get('R_uplift') or 0) > 0:
        return _ne(_nt('member.reason.h4_i621_used'), na=True)
    try:
        muy = abs(float(p.get('Muy') or 0.0))
    except (TypeError, ValueError):
        muy = 0.0
    if muy > 0:
        return _ne(_nt('member.reason.h4_biaxial', Muy=muy))
    if direct:
        missing = [k for k in ('torsion_f_bending', 'torsion_f_torsion') if not _given(p.get(k))]
        if missing:
            return _ne(_nt('member.reason.h4_input_missing', names=', '.join(missing)))
        if canon not in _H4_SYMMETRIC_TYPES:
            ok = False
            if _has_model(p):
                try:
                    from engine.properties import grosprop
                    import numpy as np
                    g = grosprop(np.asarray(p['node'], float), np.asarray(p['elem'], float))
                    ok = T.symmetric_about_horizontal(p['node'], p['elem'], float(g['zcg']))
                except Exception:
                    ok = False
            if not ok:
                return _ne(_nt('member.reason.h4_section_not_symmetric', section=canon or 'custom'))
        fb = float(p['torsion_f_bending'])
        ft = float(p['torsion_f_torsion'])
        fbm = float(p['torsion_f_bending_max']) if _given(p.get('torsion_f_bending_max')) else None
        at_j = p.get('torsion_at_web_flange_junction') is True
        rr = T.r_factor_direct(fb, ft, fbm, at_web_flange_junction=at_j, edge_stiffened_c=edge_c)
        if rr.get('error') == 'sides':
            return _ne(_nt('member.reason.h4_stress_sides', fbmax=rr['f_bending_max'], fb=fb))
        if rr.get('error'):
            return _ne(_nt('member.reason.h4_zero_combined'))
        if fbm is None:
            result.setdefault('assumptions', []).append(_nt('member.assumption.h4_fbmax_defaulted'))
        if any(_given(p.get(k)) for k in ('torsion_eccentricity', 'torsion_span', 'torsion_load')):
            result.setdefault('assumptions', []).append(_nt('member.assumption.h4_direct_ignores_computed'))
        data.update(rr=rr, R=rr['R'], demand=Mu, y=None)
    else:
        missing = [k for k in ('torsion_eccentricity', 'torsion_span', 'torsion_load', 'torsion_support')
                   if not _given(p.get(k))]
        if missing:
            return _ne(_nt('member.reason.h4_input_missing', names=', '.join(missing)))
        sup = str(p['torsion_support']).strip().lower()
        if sup != 'simple':
            return _ne(_nt('member.reason.h4_route_a_only', support=str(p['torsion_support'])))
        load = str(p['torsion_load']).strip().lower()
        if load not in T.LOADS:
            return _ne(_nt('member.reason.h4_load_unknown', load=str(p['torsion_load'])))
        if not _has_model(p):
            return _ne(_nt('member.reason.h4_no_section_model'))
        e = float(p['torsion_eccentricity'])
        L = float(p['torsion_span'])
        if not L > 0:
            return _ne(_nt('member.reason.h4_input_missing', names='torsion_span'))
        roles = p.get('element_roles') or p.get(A._ELEMENT_ROLES)
        try:
            rr = T.r_factor_eccentric(p['node'], p['elem'], e=e, L=L, load=load, roles=roles, edge_stiffened_c=edge_c,
                                      Mu=Mu if Mu > 0 else None)
        except Exception as ex:          # 단면 모델을 cutwp 가 거절(끊어진 모델 등)
            return _ne(_nt('member.reason.h4_model_unusable', why=str(ex)))
        if rr.get('error') == 'not_symmetric':
            return _ne(_nt('member.reason.h4_section_not_symmetric', section=canon or 'custom'))
        if rr.get('error'):
            return _ne(_nt('member.reason.h4_model_unusable', why=rr['error']))
        result.setdefault('assumptions', []).append(_nt('member.assumption.h4_computed_route', L=L, load=load, e=e))
        if edge_c and not rr['junction_known']:
            result.setdefault('assumptions', []).append(_nt('member.assumption.h4_junction_unknown'))
        demand = Mu * rr['M_unit'] / rr['Mmax_unit']
        data.update(rr=rr, R=rr['R'], demand=demand, y=rr['y'])
    rr = data['rr']
    if rr.get('increased') and rr['R'] > 0:
        result.setdefault('assumptions', []).append(_nt('member.assumption.h4_15pct'))
    R = data['R']
    Mn_h4 = R * Mnfo_v
    cap = R * Malo
    demand = data['demand']
    ratio = ratio_of(demand, cap)
    data.update(Mn_h4=Mn_h4, cap=cap, ratio=ratio)
    block = {'route': data['route'], 'evaluated': True, 'R': round(R, 4), 'R_raw': round(rr['R_raw'], 4),
             'increased_15pct': bool(rr.get('increased')), 'Mnlo': round(Mnfo_v, 2), 'Malo': round(Malo, 2),
             'Mn': round(Mn_h4, 2), 'design_strength': round(cap, 2), 'Mu': round(demand, 2),
             'ratio': round(ratio, 4) if ratio is not None else None,
             'pass': (ratio <= 1.0) if ratio is not None else None}
    du = {'R': R, 'R_raw': rr['R_raw'], 'Mnlo': Mnfo_v, 'Malo': Malo, 'Mn': Mn_h4, 'design_strength': cap,
          'Mu': demand}
    if ratio is not None:
        du['ratio'] = ratio
    if data['route'] == 'computed':
        block.update(y=round(rr['y'], 3), node=rr['node'] + 1, node_xz=[round(rr['node_xz'][0], 4),
                                                                     round(rr['node_xz'][1], 4)],
                     at_web_flange_junction=rr['at_junction'], e=rr['e'], L=rr['L'], load=rr['load'],
                     a=round(rr['a'], 3), J=rr['J'], Cw=rr['Cw'], omega_n=round(rr['omega_n'], 4))
        du.update(y=rr['y'], a=rr['a'], omega_n=rr['omega_n'])
        for k in ('f_bending', 'f_torsion', 'f_bending_max', 'f_combined'):
            if rr.get(k + '_at_Mu') is not None:
                block[k] = round(rr[k + '_at_Mu'], 3)
                du[k] = rr[k + '_at_Mu']
        if rr.get('rotation_mid_at_Mu') is not None:
            block['rotation_mid'] = round(rr['rotation_mid_at_Mu'], 4)
            du['rotation_mid'] = rr['rotation_mid_at_Mu']
    else:
        block.update(f_bending=rr['f_bending'], f_torsion=rr['f_torsion'], f_bending_max=rr['f_bending_max'],
                     at_web_flange_junction=p.get('torsion_at_web_flange_junction') is True)
    from design.aisi_s100 import _DISPLAY_UNROUNDED
    block[_DISPLAY_UNROUNDED] = du
    result['torsion'] = block
    result['spec_sections'].append('H4')
    result['steps'].append({
        'step': 12, 'name': 'Bending + torsion (§H4, Eq. H4-1)', 'value': block['ratio'], 'unit': '',
        'formula': (f"R = {R:.3f}" + (' (×1.15)' if rr.get('increased') else '')
                    + f", R·Maℓo = {cap:.2f} kip-in, M = {demand:.2f} kip-in → {block['ratio']}"),
        'equation': 'H4-1',
    })
    if ratio is not None:
        A._merge_governing_check(result, {'total': ratio, 'pass': ratio <= 1.0}, 'H4 bending + torsion')


# ================================================================ 검토 항목(design_checks)

def flexure_eb_checks(ck: dict) -> list:
    """flexure_checks_all 이 부른다 — 전단(보강 · 구멍) · §H2 · §G4.1 · §H4 의 항목."""
    out = []
    sh = ck.get('shear_eb')
    if sh is not None:
        out += _shear_checks(ck, sh)
        if sh.get('g4') is not None:
            out.append(_g4_check(ck, sh))
    if ck.get('h4') is not None:
        out.append(_h4_check(ck, ck['h4']))
    return out


def _variant(sh):
    sr = sh['sr']
    if sh['web']['holes'] is not None:
        return 'web_holes'
    if sh['stiffened'] and sh['conforming']:
        return 'stiffened_web' if sr['curve'] == 'G2.2' else 'stiffened_web_g2_1'
    return None


def _shear_checks(ctx, sh):
    from design.member_checks import shear_checks, not_evaluated as _ne_check, demote_to_not_evaluated, _mirror
    dm, p, sr = ctx['dm'], ctx['params'], sh['sr']
    variant = _variant(sh)
    vu = q('Vu', sh['Vu'], 'force', demand_source(p, 'Vu'))
    if sh.get('Vn_web') is None:
        why = sr['reason']
        return [_ne_check('member.shear', ctx, why, variant=variant),
                _ne_check('member.bending_shear', ctx, why)]
    tr = Trace()
    h = q('h', sh['h'], 'length', src('section_property', key='h_web'))
    t = q('t', sh['t'], 'length', src('section_property', key='t'))
    fy = q('Fy', sh['Fy'], 'stress', src('material', key='Fy', note=_nt('member.note.a3_3_2_virgin_fy_a3_excludes')))
    E = q('E', sh['E'], 'stress', spec())
    use_ref = not sr['evaluated']
    g4 = sh.get('g4') or {}
    if sh['stiffened'] and sh['conforming']:
        a = q('a', g4['a'], 'length', src('user_input', key='stiffener_spacing'))
        i_kv = tr.add('equation', 'kv = 4.00 + 5.34/(a/h)²' if sr['kv_equation'] == 'G2.3-3' else 'kv = 5.34 + 4.00/(a/h)²',
                      equation=sr['kv_equation'], inputs=[a, h], result=q('kv', sr['kv'], 'dimensionless'))
        kv_in = tr.ref(i_kv)
        Vy, Vcr, lam, curve, eqid, Vn_g2 = sr['Vy'], sr['Vcr'], sr['lambda_v'], sr['curve'], sr['equation_id'], sr['Vn_g2']
    else:
        kv_in = q('kv', 5.34, 'dimensionless', spec())
        if use_ref:
            from design.shear import _g2_terms, _g21_curve
            Vy, Vcr, lam = _g2_terms(sh['h'], sh['t'], sh['Fy'], sh['E'], 5.34)
            Vn_g2, _eq, eqid = _g21_curve(Vy, Vcr, lam)
        else:
            Vy, Vcr, lam, eqid, Vn_g2 = sr['Vy'], sr['Vcr'], sr['lambda_v'], sr['equation_id'], sr['Vn_g2']
        curve = 'G2.1'
    i_vy = tr.add('yield', 'Vy = 0.6 Aw Fy, Aw = h t', equation='G2.1-5', inputs=[h, t, fy], result=q('Vy', Vy, 'force'))
    i_vcr = tr.add('elastic_buckling', 'Vcr = Aw π² E kv / [12 (1 − μ²) (h/t)²], μ = 0.3', equation='G2.3-2',
                   inputs=[h, t, E, kv_in], result=q('Vcr', Vcr, 'force'))
    i_l = tr.add('slenderness', 'λv = (Vy / Vcr)^0.5', equation='G2.1-4', inputs=[tr.ref(i_vy), tr.ref(i_vcr)],
                 result=q('λv', lam, 'dimensionless'))
    if curve == 'G2.2':
        holds = eqid == 'G2.2-1'
        tr.branch('λv ≤ 0.776', holds, eqid, inputs=[tr.ref(i_l)])
        i_v = tr.add('equation', 'Vn = Vy' if holds else 'Vn = [1 − 0.15 (Vcr/Vy)^0.4] (Vcr/Vy)^0.4 Vy', equation=eqid,
                     inputs=[tr.ref(i_vy)] if holds else [tr.ref(i_vcr), tr.ref(i_vy)],
                     result=q('Vn,web', Vn_g2, 'force'))
    else:
        cond = {'G2.1-1': 'λv ≤ 0.815', 'G2.1-2a': '0.815 < λv ≤ 1.227', 'G2.1-3a': 'λv > 1.227'}[eqid]
        tr.branch(cond, True, eqid, inputs=[tr.ref(i_l)])
        expr = {'G2.1-1': 'Vn = Vy', 'G2.1-2a': 'Vn = 0.815 (Vcr Vy)^0.5', 'G2.1-3a': 'Vn = Vcr'}[eqid]
        ins = {'G2.1-1': [tr.ref(i_vy)], 'G2.1-2a': [tr.ref(i_vcr), tr.ref(i_vy)], 'G2.1-3a': [tr.ref(i_vcr)]}[eqid]
        i_v = tr.add('equation', expr, equation=eqid, inputs=ins, result=q('Vn,web', Vn_g2, 'force'))
    g3 = sr.get('g3')
    if g3 is not None and g3.get('evaluated'):
        g = g3['limits']['geometry']
        dh = q('dh', g['dh'], 'length', src('user_input', key='hole_depth'))
        i_c = tr.add('equation', 'c = h/2 − dh/2.83' if g3['c_equation'] == 'G3-2' else 'c = h/2 − dh/2',
                     equation=g3['c_equation'], inputs=[h, dh], result=q('c', g3['c'], 'length'))
        if g3['qs_equation'] == 'G3-1':
            tr.branch('5 ≤ c/t < 54', True, 'G3-1', inputs=[tr.ref(i_c), t])
            i_q = tr.add('equation', 'qs = c / (54 t)', equation='G3-1', inputs=[tr.ref(i_c), t],
                         result=q('qs', g3['qs'], 'dimensionless'))
        else:
            tr.branch('c/t ≥ 54', True, None, inputs=[tr.ref(i_c), t])
            i_q = tr.add('equation', 'qs = 1.0', inputs=[tr.ref(i_c)], result=q('qs', 1.0, 'dimensionless'))
        i_v = tr.add('modifier', 'Vn,web = qs Vn,web(G2)', equation='G3-1', inputs=[tr.ref(i_q), tr.ref(i_v)],
                     result=q('Vn,web', sh['Vn_web'], 'force'))
    i_n = tr.add('equation', 'Vn = n_webs Vn,web', inputs=[tr.ref(i_v), q('n_webs', sh['n_webs'], 'count',
                                                                        src('section_property', key='webs'))],
                 result=q('Vn', sh['Vn'], 'force'))
    cap_sym = 'φvVn' if dm == 'LRFD' else 'Vn/Ωv'
    i_ds = design_strength_step(tr, dm, tr.ref(i_n), sh['phi_v'], sh['omega_v'], sh['Va'], cap_sym, 'force',
                                phi_symbol='φv', omega_symbol='Ωv')
    r = ratio_of(sh['Vu'], sh['Va'])
    mirrors = {'nominal': _mirror('shear.Vn', 2), 'capacity': _mirror('shear.design_strength', 2),
               'ratio': _mirror('shear_interaction.V_ratio', 4)}
    if use_ref:
        verdict_step(tr, vu, tr.ref(i_ds), r, 'not_evaluated')
        g2 = make_check('member.shear', design_method=dm, verdict='not_evaluated', demand=vu, reason=sr['reason'],
                        steps=tr.steps, variant=variant, mirrors=mirrors,
                        reference={'capacity': q(cap_sym, sh['Va'], 'force'), 'nominal': q('Vn', sh['Vn'], 'force'),
                                   'ratio': r, 'basis': _nt('shear.warning.g2_1_conservative_reference')})
    else:
        v = verdict_from(r)
        verdict_step(tr, vu, tr.ref(i_ds), r, v)
        g2 = make_check('member.shear', design_method=dm, verdict=v, demand=vu, capacity=q(cap_sym, sh['Va'], 'force'),
                        nominal=q('Vn', sh['Vn'], 'force'), factor_=factor(dm, sh['phi_v'], sh['omega_v'], 'φv', 'Ωv'),
                        ratio=r, steps=tr.steps, variant=variant, mirrors=mirrors)
    # §H2 — 옛 함수의 단계를 그대로 쓴다(Eq. H2-1 / H2-2)
    legacy = dict(shear_res={'Vy': Vy, 'Vcr': Vcr, 'lambda_v': lam, 'equation': 'G2.1 (yielding)', 'Vn': sh['Vn_web']},
                  h=sh['h'], t=sh['t'], Fy=sh['Fy'], E=sh['E'], kv=5.34, n_webs=sh['n_webs'], Vn=sh['Vn'],
                  phi_v=sh['phi_v'], omega_v=sh['omega_v'], Va=sh['Va'], Vu=sh['Vu'], Mnlo=sh['Mnlo'],
                  Malo=sh['Malo'], Mu=sh['Mu'], stiffened=sh['stiffened'], shear_int=sh['shear_int'],
                  h2_raw=sh['h2_raw'])
    _g2_old, (h2,) = shear_checks(ctx, legacy)
    if use_ref or (sh['stiffened'] and not sh['conforming']):
        h2 = demote_to_not_evaluated(h2, sr['reason'])
    return [g2, h2]


def _g4_check(ctx, sh):
    from design.member_checks import not_evaluated as _ne_check, _mirror
    dm, g4 = ctx['dm'], sh['g4']
    if g4.get('g4_2') and g4.get('a_over_h') is None or (g4.get('g4_2') and _g4_ratio(g4) is None):
        return _ne_check('member.web_stiffeners', ctx, _joined('; ', [g4['reason'], _nt('shear.reason.stiffener_g4_2')]))
    r = _g4_ratio(g4)
    if r is None:
        return _ne_check('member.web_stiffeners', ctx, g4['reason'] or _nt('shear.reason.stiffener_input_missing',
                                                                             names=', '.join(g4.get('missing') or [])))
    tr = Trace()
    h = q('h', g4['h'], 'length', src('section_property', key='h_web'))
    t = q('t', g4['t'], 'length', src('section_property', key='t'))
    a = q('a', g4['a'], 'length', src('user_input', key='stiffener_spacing'))
    i_ah = tr.add('equation', 'a/h', inputs=[a, h], result=q('a/h', g4['a_over_h'], 'dimensionless'))
    i_lim = tr.add('equation', 'limit = min([260/(h/t)]², 3.0)', inputs=[h, t],
                   result=q('(a/h)max', g4['a_over_h_limit'], 'dimensionless'))
    i_r1 = tr.add('equation', '(a/h) / (a/h)max', inputs=[tr.ref(i_ah), tr.ref(i_lim)],
                  result=q('r_a', g4['a_over_h'] / g4['a_over_h_limit'], 'dimensionless'))
    i_is = tr.add('equation', 'Is,min = 5 h t³ [h/a − 0.7 (a/h)] ≥ (h/50)⁴', equation='G4.1-1', inputs=[h, t, a],
                  result=q('Is,min', g4['Is_min'], 'moment_of_inertia'))
    Is = q('Is', g4['Is'], 'moment_of_inertia', src('user_input', key='stiffener_Is'))
    i_r2 = tr.add('equation', 'Is,min / Is', inputs=[tr.ref(i_is), Is], result=q('r_I', g4['Is_min'] / g4['Is'],
                                                                              'dimensionless'))
    i_kv = tr.add('equation', 'kv = 4.00 + 5.34/(a/h)²' if g4['kv_equation'] == 'G4.1-5' else 'kv = 5.34 + 4.00/(a/h)²',
                  equation=g4['kv_equation'], inputs=[tr.ref(i_ah)], result=q('kv', g4['kv'], 'dimensionless'))
    fy = q('Fy', g4['Fy_web'], 'stress', src('material', key='Fy'))
    E = q('E', 29500.0, 'stress', spec())
    i_cv = tr.add('equation', 'Cv = 1.53 E kv / [Fy (h/t)²]' if g4['Cv_equation'] == 'G4.1-3'
                  else 'Cv = 1.11/(h/t) (E kv / Fy)^0.5', equation=g4['Cv_equation'],
                  inputs=[E, tr.ref(i_kv), fy, h, t], result=q('Cv', g4['Cv'], 'dimensionless'))
    fys = q('Fy,st', g4['Fy_st'], 'stress', src('user_input', key='stiffener_Fy'))
    i_y = tr.add('equation', 'Y = Fy(web) / Fy(stiffener)', inputs=[fy, fys], result=q('Y', g4['Y'], 'dimensionless'))
    D = q('D', g4['D'], 'dimensionless', src('specification', note=_nt('shear.scope.g2_stiffened_web')))
    i_a = tr.add('equation', 'Ast = (1 − Cv)/2 [a/h − (a/h)² / (a/h + (1 + (a/h)²)^0.5)] Y D h t', equation='G4.1-2',
                 inputs=[tr.ref(i_cv), tr.ref(i_ah), tr.ref(i_y), D, h, t], result=q('Ast,min', g4['Ast_min'], 'area'))
    As = q('Ast', g4['As'], 'area', src('user_input', key='stiffener_area'))
    i_r3 = tr.add('equation', 'Ast,min / Ast', inputs=[tr.ref(i_a), As], result=q('r_A', g4['Ast_min'] / g4['As'],
                                                                               'dimensionless'))
    i_r = tr.add('equation', 'max(r_a, r_I, r_A)', inputs=[tr.ref(i_r1), tr.ref(i_r2), tr.ref(i_r3)],
                 result=q('ratio', r, 'dimensionless'))
    v = 'pass' if r <= 1.0 else 'fail'
    tr.add('verdict', 'ratio ≤ 1', inputs=[tr.ref(i_r), q('limit', 1.0, 'dimensionless', spec())],
           result=q('ratio', r, 'dimensionless'), verdict=v)
    return make_check('member.web_stiffeners', design_method=dm, verdict=v, demand=q('ratio', r, 'dimensionless'),
                      capacity=q('limit', 1.0, 'dimensionless'), ratio=r, steps=tr.steps,
                      reason=g4['reason'] if v == 'fail' else None,
                      mirrors={'ratio': _mirror('web_stiffeners.ratio', 4)})


def _h4_check(ctx, h4):
    from design.member_checks import not_evaluated as _ne_check, not_applicable as _na_check, _mirror
    dm, p = ctx['dm'], ctx['params']
    if h4.get('na') is not None:
        return _na_check('member.bending_torsion', ctx, h4['na'])
    if h4.get('ne') is not None:
        return _ne_check('member.bending_torsion', ctx, h4['ne'])
    tr = Trace()
    rr = h4['rr']
    if h4['route'] == 'direct':
        fb = q('f_bending', rr['f_bending'], 'stress', src('user_input', key='torsion_f_bending'))
        ft = q('f_torsion', rr['f_torsion'], 'stress', src('user_input', key='torsion_f_torsion'))
        fbm = q('f_bending_max', rr['f_bending_max'], 'stress',
                src('user_input', key='torsion_f_bending_max') if not rr['f_bending_max_defaulted']
                else src('engine_default', key='torsion_f_bending_max', note=_nt('member.assumption.h4_fbmax_defaulted')))
        ins = [fbm, fb, ft]
    else:
        e = q('e', rr['e'], 'length', src('user_input', key='torsion_eccentricity'))
        L = q('L', rr['L'], 'length', src('user_input', key='torsion_span'))
        J = q('J', rr['J'], 'torsion_constant', src('section_property', key='J'))
        Cw = q('Cw', rr['Cw'], 'warping_constant', src('section_property', key='Cw'))
        i_a = tr.add('equation', 'a = (E Cw / G J)^0.5', equation='DG9 3.12',
                     inputs=[q('E', rr['E'], 'stress', spec()), Cw, q('G', rr['G'], 'stress', spec()), J],
                     result=q('a', rr['a'], 'length'))
        scale = (h4['Mu'] / rr['Mmax_unit']) if h4['Mu'] and h4['Mu'] > 0 else 1.0
        wn = q('ωn', rr['omega_n'], 'area', src('section_property', key='omega_n'))
        fb = q('f_bending', rr.get('f_bending_at_Mu', rr['f_bending']), 'stress', src('section_property', key='Ixx'))
        # θ'' (1/in², 하중이 Mu 일 때) 는 물리량 어휘에 없어 단계의 값이 아니라 꼬리표(theta_pp_per_in2)로 싣는다
        i_ft = tr.add('equation', ("f_torsion = −E ωn θ''(z), θ'' from DG 9 Case 4 (uniform torque e·w)"
                                   if rr['load'] == 'uniform' else
                                   "f_torsion = −E ωn θ''(z), θ'' from DG 9 Case 3 (torque e·P at mid-span)"),
                      inputs=[wn, e, L, tr.ref(i_a)],
                      result=q('f_torsion', rr.get('f_torsion_at_Mu', rr['f_torsion']), 'stress'),
                      node=rr['node'] + 1, z=rr['y'], theta_pp_per_in2=rr['phi_pp'] * scale)
        fbm = q('f_bending_max', rr.get('f_bending_max_at_Mu', rr['f_bending_max']), 'stress',
                src('section_property', key='Ixx'))
        ins = [fbm, fb, tr.ref(i_ft)]
    i_r = tr.add('modifier', 'R = f_bending_max / (f_bending + f_torsion) ≤ 1' + (' (× 1.15)' if rr.get('increased') else ''),
                 equation='H4-1', inputs=ins, result=q('R', h4['R'], 'dimensionless'))
    mlo = q('Mnℓo', h4['Mnlo'], 'moment', src('check', id='member.flexure.local',
                                              note=_nt('member.note.f3_mn_f3_local_strength')))
    i_mn = tr.add('modifier', 'Mn = R Mnℓo', equation='H4-1', inputs=[tr.ref(i_r), mlo],
                  result=q('Mn,H4', h4['Mn_h4'], 'moment'))
    cap_sym = 'φbRMnℓo' if dm == 'LRFD' else 'RMnℓo/Ωb'
    i_ds = design_strength_step(tr, dm, tr.ref(i_mn), ctx['phi'], ctx['omega'], h4['cap'], cap_sym, 'moment',
                                phi_symbol='φb', omega_symbol='Ωb')
    dem = q('M', h4['demand'], 'moment', demand_source(p, 'Mu'))
    if h4['ratio'] is None:
        return make_check('member.bending_torsion', design_method=dm, verdict='not_evaluated', demand=None,
                          reason=_nt('member.reason.no_required_flexural_strength'), steps=tr.steps,
                          reference={'capacity': q(cap_sym, h4['cap'], 'moment')})
    v = verdict_from(h4['ratio'])
    verdict_step(tr, dem, tr.ref(i_ds), h4['ratio'], v)
    loc = {'z': rr['y'], 'node': rr['node'] + 1} if h4['route'] == 'computed' else None
    return make_check('member.bending_torsion', design_method=dm, verdict=v, demand=dem,
                      capacity=q(cap_sym, h4['cap'], 'moment'), nominal=q('Mn,H4', h4['Mn_h4'], 'moment'),
                      factor_=factor(dm, ctx['phi'], ctx['omega'], 'φb', 'Ωb'), ratio=h4['ratio'], steps=tr.steps,
                      location=loc,
                      mirrors={'nominal': _mirror('torsion.Mn', 2), 'capacity': _mirror('torsion.design_strength', 2),
                               'ratio': _mirror('torsion.ratio', 4)})
