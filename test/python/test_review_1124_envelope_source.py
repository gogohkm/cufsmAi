"""2026-11-24 V6-08 (엔진 쪽) — 하중 해석 포락선의 값마다 그 값을 만든 조합 · 활하중 패턴.

`analyze_loads` 의 포락선(M · V · R 최대/최소, 처짐 포락)과 이름 붙은 위치에 붙인 출처(envelope_source,
combo_V / pattern_V …)가 참인지, **포락 코드를 쓰지 않고** 확인한다: 출처가 말한 조합의 계수 × 하중을 그 패턴의
경간에만 실어 보 해석기로 다시 풀고, 그 지점의 값이 포락값과 같아야 한다. 중력 · 양력 · 부분재하 · 같은 값(동률)
지점을 지난다. 동률 규칙: 조합은 combos 목록에서 먼저 나온 것, 경간의 기여가 정확히 0 이면 '싣지 않음'.
"""

import json
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), 'python'))

from design.loads.required_strength import analyze_loads  # noqa: E402
from design.loads.beam_analysis import (  # noqa: E402
    analyze_continuous_beam_general, analyze_simple_beam, analyze_beam_fe, support_statics,
)

C9 = dict(Ixx=10.3, depth=9.0)
CASES = [
    ('cont-3 gravity L pattern ASD', dict(member_app='floor-joist', span_type='cont-3', span_ft=20.0,
                                          loads={'D': 40, 'L': 150}, design_method='ASD', section=dict(C9))),
    ('cont-4 Lr reduced + uplift LRFD', dict(member_app='roof-purlin', span_type='cont-4', span_ft=25.0,
                                             loads={'D': 15, 'Lr': 100, 'W': -170}, design_method='LRFD',
                                             lr_reduced=True, section=dict(C9))),
    ('cont-2 snow cases ASD', dict(member_app='roof-purlin', span_type='cont-2', span_ft=22.0,
                                   loads={'D': 20, 'S': 120}, design_method='ASD', section=dict(C9))),
    ('simple D Lr W Wp LRFD', dict(member_app='roof-purlin', span_type='simple', span_ft=24.0,
                                   loads={'D': 15, 'Lr': 80, 'W': -120, 'Wp': 60}, design_method='LRFD',
                                   section=dict(C9))),
    ('cont-3 overhang L pattern', dict(member_app='floor-joist', span_type='cont-n', span_ft=10.0,
                                       spans_ft=[18.0, 18.0, 6.0], supports=['P', 'R', 'R', 'N'],
                                       loads={'D': 30, 'L': 120}, design_method='LRFD', section=dict(C9))),
    ('cont-4 laps D L W ASD', dict(member_app='roof-purlin', span_type='cont-4', span_ft=25.0,
                                   loads={'D': 15, 'L': 60, 'W': -170}, design_method='ASD',
                                   laps={'left_ft': 1.0, 'right_ft': 2.5}, section=dict(C9))),
    ('cont-6 size D Lr W Wp', dict(member_app='roof-purlin', span_type='cont-6', span_ft=25.0,
                                   loads={'D': 15, 'Lr': 100, 'W': -170, 'Wp': 50}, design_method='ASD',
                                   lr_reduced=True, section=dict(C9))),
]


def _solve(r, w_span, need_D=False):
    """다시 풀기 — 포락 코드가 아니라 보 해석기 그대로(단위하중 중첩도 쓰지 않는다)."""
    spans, sup = r['spans_ft'], r['supports']
    laps = r.get('laps_per_support')
    has_laps = bool(laps and any(laps))
    w = [float(v) for v in w_span]
    if has_laps or any(s in ('F', 'N') for s in sup[1:-1]):
        res = analyze_beam_fe(spans, w, sup, laps if has_laps else None, I_base_in4=10.3, I_lap_ratio=2.0,
                              E_ksi=29500.0, n_pts_per_span=101 if len(spans) == 1 else 51)
    elif len(spans) == 1 and sup[0] in ('P', 'R') and sup[1] in ('P', 'R'):
        res = analyze_simple_beam(spans[0], w[0], 101)
    else:
        res = analyze_continuous_beam_general(spans, w, supports=sup, n_pts_per_span=51)
    st = support_statics(res.x, res.M, spans, w, sup)
    if not need_D:
        return {'M': list(res.M), 'V': list(res.V), 'R': list(st['R']), 'VL': list(st['V_left']),
                'VR': list(st['V_right'])}
    fe = analyze_beam_fe(spans, w, sup, laps if has_laps else None, I_base_in4=10.3, I_lap_ratio=2.0, E_ksi=29500.0,
                         n_pts_per_span=101 if len(spans) == 1 else 51)
    D = [float(v) for v in np.interp(np.asarray(res.x, float), np.asarray(fe.x, float), np.asarray(fe.D, float))]
    return {'M': list(res.M), 'V': list(res.V), 'R': list(st['R']), 'VL': list(st['V_left']),
            'VR': list(st['V_right']), 'D': D}


def _loaded(desc, n):
    m = re.match(r'spans ([\d,]+) loaded', desc)
    if m:
        return {int(i) - 1 for i in m.group(1).split(',')}
    if desc == 'not acting':
        return set()
    raise KeyError(desc)


def _w_span(r, combo, pattern):
    """조합 이름 → 계수(all_combos_detail), 하중(strong_axis_loads_plf), 패턴 → 경간별 하중(plf)."""
    n = r['n_spans']
    det = [d for d in r['all_combos_detail'] if d['name'] == combo][0]
    loads = dict(r['strong_axis_loads_plf'])
    if combo.endswith(' [Wp]'):
        loads['W'] = r['input_loads_plf']['Wp']
    w = [0.0] * n
    snow = r['pattern_loading']['snow_cases']
    for k, a in det['factors'].items():
        p = (pattern or {}).get(k)
        if p is None:
            spans = set(range(n))
            mult = [1.0] * n
        elif p in snow:
            from design.loads.load_combinations import snow_partial_cases
            mult = dict(snow_partial_cases(n))[p]
            spans = set(range(n))
        else:
            spans, mult = _loaded(p, n), [1.0] * n
        for i in spans:
            w[i] += a * loads.get(k, 0.0) * mult[i]
    return w


def _runs_to_list(runs, n):
    out = [None] * n
    for start, count, ci, pi in runs:
        for k in range(start, start + count):
            out[k] = (ci, pi)
    assert None not in out
    return out


def _close(a, b):
    return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))


def _cls(r):
    return [(k, r[k]) for k in ('governing', 'gravity', 'uplift') if r.get(k)]


def test_every_envelope_value_comes_from_its_named_combination_and_pattern():
    n_checked = 0
    for name, p in CASES:
        r = analyze_loads(**p)
        cache = {}
        for cname, res in _cls(r):
            src = res['envelope_source']
            combos, pats = res['combos'], src['patterns']
            for key, arr, q in (('M_max', 'M_envelope_max', 'M'), ('M_min', 'M_envelope_min', 'M'),
                                ('V_max', 'V_envelope_max', 'V'), ('V_min', 'V_envelope_min', 'V'),
                                ('R_max', 'R_envelope_max', 'R'), ('R_min', 'R_envelope_min', 'R')):
                env = res[arr]
                for k, (ci, pi) in enumerate(_runs_to_list(src[key], len(env))):
                    combo, pat = combos[ci], pats[pi]
                    ck = (combo, json.dumps(pat, sort_keys=True))
                    if ck not in cache:
                        cache[ck] = _solve(r, _w_span(r, combo, pat))
                    assert _close(cache[ck][q][k], env[k]), (name, cname, key, k, combo, pat, cache[ck][q][k], env[k])
                    n_checked += 1
            # 이름 붙은 위치: M(combo · pattern), V(combo_V · pattern_V), 지점 R(combo_R · pattern_R)
            for loc in res['locations']:
                if 'source_stations' in loc:
                    continue
                x = res['x_diagram']
                k = min(range(len(x)), key=lambda i: abs(x[i] - loc['x_ft']))
                if loc.get('combo') and loc.get('Mu') is not None:
                    s = _solve(r, _w_span(r, loc['combo'], loc['pattern']))
                    assert abs(s['M'][k] - loc['Mu']) <= 0.0006, (name, loc['name'], s['M'][k], loc['Mu'])
                if loc.get('combo_V'):
                    s = _solve(r, _w_span(r, loc['combo_V'], loc['pattern_V']))
                    if 'support' in loc and loc.get('V_side'):
                        j = loc['support'] - 1
                        v = s['VL' if loc['V_side'] == 'left' else 'VR'][j]
                    else:
                        v = s['V'][k]
                    assert abs(abs(v) - loc['Vu']) <= 0.0006, (name, loc['name'], v, loc['Vu'])
                if loc.get('combo_R'):
                    s = _solve(r, _w_span(r, loc['combo_R'], loc['pattern_R']))
                    j = loc['support'] - 1
                    want = loc['R_min'] if cname == 'uplift' else loc['R_max']
                    assert abs(s['R'][j] - want) <= 0.00006, (name, loc['name'], s['R'][j], want)
    assert n_checked > 3000, n_checked


def test_ties_take_the_first_combination_and_unloaded_zero_spans():
    """대칭 2경간의 가운데 지점에서 V 는 좌우가 같고, 단순보 끝의 M = 0 은 모든 조합이 같다(동률)."""
    r = analyze_loads(**dict(CASES[3][1]))
    g = r['gravity']
    first = _runs_to_list(g['envelope_source']['M_max'], len(g['M_envelope_max']))[0]
    assert g['M_envelope_max'][0] == 0.0 or abs(g['M_envelope_max'][0]) < 1e-12
    assert first[0] == 0                                   # x = 0 에서 M = 0: combos 의 첫 조합
    # 연속보 끝 지점(x = 0): 모든 경간의 M 기여가 0 — 패턴은 '싣지 않음'(기여 0 은 싣지 않는다)
    r2 = analyze_loads(**dict(CASES[0][1]))
    g2 = r2['gravity']
    src = g2['envelope_source']
    ci0, pi0 = _runs_to_list(src['M_max'], len(g2['M_envelope_max']))[0]
    assert ci0 == 0 and g2['combos'][0] == '1: D' and src['patterns'][pi0] == {}, (ci0, src['patterns'][pi0])
    dl = [c for c in r2['deflection_cases'] if c['case'] == 'L'][0]['D_envelope_source']
    first_d = [x for x in dl['D_max'] if x[0] == 0][0]
    assert dl['patterns'][first_d[2]]['loads']['L'] == 'not acting'
    for ci, pi in _runs_to_list(src['M_max'], len(g2['M_envelope_max'])):
        for k, desc in src['patterns'][pi].items():
            assert desc == 'not acting' or desc.startswith('spans ')


def test_deflection_envelope_patterns():
    checked, dcache = [], {}
    r = analyze_loads(**dict(CASES[0][1]))
    for c in r['deflection_cases']:
        if 'D_envelope_source' not in c:
            continue
        src = c['D_envelope_source']
        for key, arr in (('D_max', 'D_envelope_max'), ('D_min', 'D_envelope_min')):
            for k, pi in enumerate(_runs_to_list([[a, b, 0, d] for a, b, d in src[key]], len(c[arr]))):
                pat = src['patterns'][pi[1]]
                n = r['n_spans']
                w = [0.0] * n
                for key2, desc in pat['loads'].items():
                    spans = set(range(n)) if desc == 'all spans' else _loaded(desc, n)
                    for i in spans:
                        w[i] += r['strong_axis_loads_plf'][key2]
                if tuple(w) not in dcache:
                    dcache[tuple(w)] = _solve(r, w, True)['D']
                d = dcache[tuple(w)]
                checked.append(1)
                if d:
                    assert abs(d[k] - c[arr][k]) <= 1e-6 * max(1.0, abs(c[arr][k])), (c['case'], key, k)
    assert len(checked) > 100 and _solve(r, [1.0] * r['n_spans'], True)['D']


def test_support_faces_unrounded_and_each_face_named():
    """지점마다 왼쪽 · 오른쪽 면 전단(반올림하지 않은 값)과 그 면의 조합 · 패턴, 지점 M 의 출처 — 다시 풀어 같아야 한다.
    끝 지점의 바깥 면(전단 0), 내다지, 랩이 붙은 지점을 지난다. 반올림한 옛 키는 그대로(표시용)."""
    n = 0
    for name, p in CASES:
        r = analyze_loads(**p)
        assert 'locations[].Vu_left' in r['display_rounding']['decimals']
        for cname, res in _cls(r):
            combos, pats = res['combos'], res['envelope_source']['patterns']
            x = res['x_diagram']
            for loc in res['locations']:
                if 'V_left_source' not in loc:
                    continue
                j = loc['support'] - 1
                for side, sym in (('left', 'VL'), ('right', 'VR')):
                    ci, pi, sense = loc[f'V_{side}_source']
                    s = _solve(r, _w_span(r, combos[ci], pats[pi]))
                    want = loc[f'Vu_{side}_unrounded']
                    assert _close(abs(s[sym][j]), want), (name, cname, loc['name'], side, s[sym][j], want)
                    assert loc[f'Vu_{side}'] == round(want, 3)
                    n += 1
                k = min(range(len(x)), key=lambda i: abs(x[i] - loc['x_ft']))
                ci, pi, sense = loc['M_source']
                s = _solve(r, _w_span(r, combos[ci], pats[pi]))
                env = res['M_envelope_max' if sense > 0 else 'M_envelope_min'][k]
                assert _close(s['M'][k], env), (name, cname, loc['name'], s['M'][k], env)
    assert n > 100, n


def test_fe_answer_does_not_depend_on_blas_threads_and_ties_take_the_first_station():
    """보 유한요소(I_span_in4 · 랩)의 답이 OpenBLAS 스레드 수와 무관하다(띠 Cholesky 풀이). 대칭 3경간의 두 내부 지점처럼
    값이 같은(허용오차 안) 측점은 앞 측점을 고른다 — 전에는 스레드 수에 따라 'Int span 2 -M' 이 x = 25 · 50 ft 로 갈렸다."""
    import subprocess
    code = ("import sys, json, hashlib; sys.path.insert(0, {py!r})\n"
            "from design.loads.required_strength import analyze_loads\n"
            "r = analyze_loads(member_app='roof-purlin', span_type='cont-3', span_ft=25, loads={{'D': 10, 'Lr': 100}},"
            " design_method='LRFD', section={{'Ixx': 10.0, 'depth': 8}}, I_span_in4=[10.0, 20.0, 10.0])\n"
            "print(hashlib.sha256(json.dumps(r, sort_keys=True, default=str).encode()).hexdigest())\n"
            ).format(py=os.path.join(os.path.dirname(os.path.dirname(HERE)), 'python'))
    outs = set()
    for t in ('1', '4', '8'):
        env = dict(os.environ, OPENBLAS_NUM_THREADS=t, PYTHONDONTWRITEBYTECODE='1')
        outs.add(subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, text=True,
                                check=True).stdout.strip())
    assert len(outs) == 1, outs
    r = analyze_loads(member_app='roof-purlin', span_type='cont-3', span_ft=25, loads={'D': 10, 'Lr': 100},
                      design_method='LRFD', section={'Ixx': 10.0, 'depth': 8}, I_span_in4=[10.0, 20.0, 10.0])
    loc = [x for x in r['governing']['locations'] if x['name'] == 'Int span 2 -M'][0]
    assert loc['x_ft'] == 25.0


def _infl_ok(x, M, pts):
    """변곡점마다: 양쪽에 부호가 0 이 아닌(허용오차 밖) 반대 부호의 측점이 있고, 부재 끝이 아니다."""
    tol = 1e-7 * max([1.0] + [abs(v) for v in M])
    for p in pts:
        assert x[0] < p < x[-1], p
        left = [v for xv, v in zip(x, M) if xv <= p + 1e-9 and abs(v) > tol]
        right = [v for xv, v in zip(x, M) if xv >= p - 1e-9 and abs(v) > tol]
        assert left and right and left[-1] * right[0] < 0, p


OVERHANG = [
    ('symmetric overhangs', dict(member_app='roof-purlin', span_type='cont-n', span_ft=25.0,
                                  spans_ft=[1.0, 25.0, 25.0, 25.0, 25.0, 1.0], supports=['N', 'P', 'R', 'R', 'R', 'P', 'N'],
                                  loads={'D': 15, 'Lr': 100}, design_method='ASD', lr_reduced=True,
                                  section={'Ixx': 10.0, 'depth': 8},
                                  laps_per_support=[None, None] + [{'left_ft': 1.0, 'right_ft': 2.5}] * 3 + [None, None])),
    ('asymmetric overhangs', dict(member_app='floor-joist', span_type='cont-n', span_ft=20.0,
                                   spans_ft=[2.0, 20.0, 18.0, 4.0], supports=['N', 'P', 'R', 'P', 'N'],
                                   loads={'D': 30, 'L': 120}, design_method='LRFD', section={'Ixx': 10.0})),
    ('pinned ends', dict(member_app='floor-joist', span_type='cont-3', span_ft=20.0, loads={'D': 30, 'L': 120},
                         design_method='LRFD', section={'Ixx': 10.0})),
]


def test_inflection_points_are_real_sign_changes_inside_the_member():
    """자유단 · 핀 끝의 M = 0, 실리지 않은 구간의 0 은 변곡점이 아니다(허용오차 1e-7 × max(1, max|M|))."""
    for name, p in OVERHANG + [CASES[0], CASES[4]]:
        r = analyze_loads(**p)
        for cls in ('governing', 'gravity', 'uplift'):
            ub = ((r['auto_params'] or {}).get('unbraced') if cls == 'governing' else None)
            res = r.get(cls)
            if not res or not ub:
                continue
            x = res['x_diagram']
            _infl_ok(x, res['M_envelope_max'], ub['inflection_points_ft_unrounded'])
            _infl_ok(x, res['M_envelope_min'], ub['inflection_points_min_envelope_ft_unrounded'])
            assert ub['inflection_points_ft'] == [round(v, 2) for v in ub['inflection_points_ft_unrounded']]


def test_named_location_values_are_given_unrounded():
    """내다지 지점 M = w a²/2 (D 115 plf, a = 1 ft → 0.0575 kip-ft): 반올림 경계라 3자리는 흔들린다 — unrounded 로."""
    r = analyze_loads(member_app='roof-purlin', span_type='cont-n', span_ft=20.0, spans_ft=[1.0, 20.0, 20.0, 1.0],
                      supports=['N', 'P', 'R', 'P', 'N'], loads={'D': 115}, design_method='ASD', section={'Ixx': 10.0},
                      pattern_loading=False)
    g = r['gravity']
    sup2 = [x for x in g['locations'] if x.get('support') == 2][0]
    assert abs(abs(sup2['unrounded']['Mu']) - 0.115 * 1.0 ** 2 / 2) <= 1e-6
    for res in (r['governing'], r['gravity']):
        for loc in res['locations']:
            u = loc['unrounded']
            for k, v in u.items():
                if v is None or loc.get(k) is None:
                    continue
                nd = {'x_ft': 2, 'R_max': 4, 'R_min': 4, 'R_bearing': 4, 'R_uplift': 4}.get(k, 3)
                assert loc[k] == round(v, nd), (loc['name'], k, loc[k], v)
    for reg in r['auto_params']['unbraced']['negative_regions'] + r['auto_params']['unbraced']['positive_regions']:
        assert reg['M_max_abs'] == round(reg['unrounded']['M_max_abs'], 4)
    assert all('unrounded' in w for w in r['wc_reactions'])


def test_overhang_answer_does_not_depend_on_blas_threads():
    import subprocess
    code = ("import sys, json, hashlib; sys.path.insert(0, {py!r})\n"
            "from design.loads.required_strength import analyze_loads\n"
            "r = analyze_loads(**{p!r})\n"
            "print(hashlib.sha256(json.dumps(r, sort_keys=True, default=str).encode()).hexdigest())\n"
            ).format(py=os.path.join(os.path.dirname(os.path.dirname(HERE)), 'python'), p=OVERHANG[0][1])
    outs = set()
    for t in ('1', '4', '8'):
        env = dict(os.environ, OPENBLAS_NUM_THREADS=t, PYTHONDONTWRITEBYTECODE='1')
        outs.add(subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, text=True,
                                check=True).stdout.strip())
    assert len(outs) == 1, outs
