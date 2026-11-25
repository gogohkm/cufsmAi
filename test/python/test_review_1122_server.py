"""2026-11-22 수정 묶음 2 — W1 (python/server.py · __main__.py · fileio) 회귀 시험.

실제 서버 프로세스(확장과 같은 방식: cwd=python, `python -u server.py`, 줄 단위 JSON)를
띄워 JSON-RPC 로 말한다. 프로세스 하나를 모든 시험이 같이 쓴다(시작 비용 1 회).

기대값의 출처:
- 어댑터 충실도: 같은 인자로 엔진 함수를 직접 부른 결과(이 파일의 `_plain` 으로 JSON 화 —
  서버의 변환 함수를 쓰지 않는다). 서버가 덧붙이는 키는 따로 확인한다.
- 직렬화: NaN/Inf → null 은 리터럴 기대값.
- m_all: S-S 자동 항 = 길이마다 [1](S-S 에서 항이 묶이지 않음, CUFSM 서명곡선 관행).
- ILL_CONDITIONED: F1 기록 — 립 C r=0 의 L = 1e4 · 5e4 in 은 폐기 길이.
- .mat: Ref_Source 의 CUFSM 원본 파일에 저장된 값, 옛 스프링 변환은 loader.m 의 식.
"""
import atexit
import hashlib
import json
import math
import os
import queue
import subprocess
import sys
import tempfile
import threading

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ENG = os.path.join(ROOT, 'python')
sys.path.insert(0, ENG)

import numpy as np  # noqa: E402

PY = os.path.join(ROOT, '.venv', 'Scripts', 'python.exe')
if not os.path.exists(PY):
    PY = sys.executable

E = 29500.0
NU = 0.3
PROP = [[100, E, E, NU, NU, E / (2 * (1 + NU))]]
GBT_OFF = {'glob': [], 'dist': [], 'local': [], 'other': [], 'ospace': 1, 'orth': 2,
           'couple': 1, 'norm': 1}

# 이 파일이 RPC 로 확인하는 메서드 — server.METHODS 와 같아야 한다(새 메서드에 시험을 강제).
TESTED_METHODS = {
    'ping', 'selftest', 'analyze', 'm_recommend', 'get_properties', 'generate_section',
    'stresgen', 'yieldMP', 'firstyield', 'classify', 'classify_detailed', 'fcfsm',
    'vibration', 'plastic', 'load_mat', 'save_project', 'load_project', 'doubler',
    'signature_ss', 'dsm', 'cutwp', 'energy_recovery', 'aisi_design', 'aisi_guide',
    'steel_grades', 'web_crippling', 'analyze_loads', 'calc_deck_stiffness',
    'lap_connection', 'check_lap_length', 'shear_lag', 'block_shear', 'cold_work',
    'flange_curling', 'design_connection', 'design_signature_lengths',
}


# ----------------------------------------------------------------- 서버 프로세스
class _Server:
    def __init__(self, args=None, env=None, cwd=ENG):
        self.stderr = tempfile.TemporaryFile()
        self.p = subprocess.Popen(
            args or [PY, '-u', 'server.py'], cwd=cwd, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=self.stderr,
            env={**os.environ, **(env or {})})
        self.lines = queue.Queue()
        threading.Thread(target=self._pump, daemon=True).start()
        self.i = 0

    def _pump(self):
        for raw in self.p.stdout:
            self.lines.put(raw)
        self.lines.put(None)

    def send_raw(self, data: bytes, timeout=180):
        """바이트를 보내고 응답 한 줄(bytes, 개행 제외)을 받는다."""
        self.p.stdin.write(data)
        self.p.stdin.flush()
        line = self.lines.get(timeout=timeout)
        assert line is not None, f'server exited (rc={self.p.poll()}): {self.stderr_text()[-800:]}'
        return line.rstrip(b'\r\n')

    def request(self, method, params=None, rid=None):
        self.i += 1
        rid = self.i if rid is None else rid
        raw = self.send_raw((json.dumps({'method': method, 'params': params or {}, 'id': rid})
                             + '\n').encode('utf-8'))
        resp = json.loads(raw)
        assert resp.get('id') == rid, (resp.get('id'), rid)
        return resp, raw

    def call(self, method, params=None):
        resp, _ = self.request(method, params)
        assert 'error' not in resp, f"{method}: {resp.get('error')}\n{resp.get('traceback', '')}"
        return resp['result']

    def error(self, method, params=None):
        resp, _ = self.request(method, params)
        assert 'error' in resp, f'{method}: expected an error, got {str(resp)[:200]}'
        return resp

    def stderr_text(self):
        self.stderr.seek(0)
        return self.stderr.read().decode('utf-8', 'replace')

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(10)
        except Exception:
            self.p.kill()


_SERVER = None


def _srv() -> _Server:
    global _SERVER
    if _SERVER is None or _SERVER.p.poll() is not None:
        _SERVER = _Server()
        atexit.register(_SERVER.close)
    return _SERVER


# ----------------------------------------------------------------- 도우미
def _plain(x):
    """직접 호출 결과 → JSON 값(서버 함수와 독립). NaN/Inf → None."""
    if isinstance(x, dict):
        return {str(k): _plain(v) for k, v in x.items()}
    if isinstance(x, np.ndarray):
        return _plain(x.tolist())
    if isinstance(x, (list, tuple)):
        return [_plain(v) for v in x]
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    if isinstance(x, (int, np.integer)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        return float(x) if math.isfinite(float(x)) else None
    return x


def _diff(a, b, path='', tol=1e-12, out=None):
    out = [] if out is None else out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(f'{path}.{k}: only in {"rpc" if k in a else "direct"}')
            else:
                _diff(a[k], b[k], f'{path}.{k}', tol, out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f'{path}: len {len(a)} != {len(b)}')
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                _diff(x, y, f'{path}[{i}]', tol, out)
    elif (isinstance(a, (int, float)) and isinstance(b, (int, float))
          and not isinstance(a, bool) and not isinstance(b, bool)):
        if not (a == b or abs(a - b) <= tol * max(1.0, abs(a), abs(b))):
            out.append(f'{path}: {a} != {b}')
    elif a != b:
        out.append(f'{path}: {str(a)[:60]!r} != {str(b)[:60]!r}')
    return out


def _same(rpc, direct, name, extra=()):
    """rpc == direct, extra 키(서버가 덧붙이거나 따로 확인하는 것)는 양쪽에서 빼고."""
    # 'notices'(계약 §16)는 서버가 결과와 그 하위 블록의 알림 목록에서 지어 붙인다 — 엔진을 바로 부른 결과에는 없을 수 있다
    # 서버가 덧붙이는 알림 필드(계약 §16.10 · §16.11): notices, {k}_notices, {k}_code · _kind · _ko · _template(_ko) ·
    # _params, 모드 이름의 {k}_id — 엔진을 바로 부른 결과에는 없을 수 있다
    _added = ('_notices', '_code', '_kind', '_template', '_template_ko', '_params', '_parts', '_sep')

    def _drop_notices(x):
        if isinstance(x, dict):
            keep = {}
            for k, v in x.items():
                if k == 'notices' or (isinstance(k, str) and k.endswith(_added)):
                    continue
                if isinstance(k, str) and k.endswith(('_ko', '_id')) and k[:-3] in x and k not in ('name_ko',):
                    continue
                keep[k] = _drop_notices(v)
            return keep
        if isinstance(x, list):
            return [_drop_notices(v) for v in x]
        return x

    def _strip(x):
        return {k: v for k, v in _drop_notices(x).items() if k not in extra} if isinstance(x, dict) else x
    d = _diff(_strip(rpc), _strip(_plain(direct)))
    assert not d, f'{name}: ' + '; '.join(d[:6])


def _section(r=0.1875, stress=None):
    from engine.template import generate_section
    g = generate_section('lippedc', {'H': 8.0, 'B': 2.5, 'D': 0.625, 't': 0.059, 'r': r})
    node = np.array(g['node'], dtype=float)
    if stress is not None:
        node[:, 7] = stress
    return node.tolist(), np.array(g['elem'], dtype=float).tolist()


def _model(node, elem, lengths, BC='S-S', m_all=None, **kw):
    return {'prop': PROP, 'node': node, 'elem': elem, 'lengths': list(lengths),
            'springs': [], 'constraints': [], 'BC': BC,
            'm_all': [[1.0] for _ in lengths] if m_all is None else m_all,
            'GBTcon': dict(GBT_OFF), 'neigs': 4, **kw}


def _cm(model):
    from models.data import CufsmModel
    return CufsmModel.from_dict(model)


def _design_props(node, elem):
    from engine.properties import grosprop
    from engine.cutwp import cutwp_prop
    p = grosprop(np.array(node), np.array(elem))
    c = cutwp_prop(np.array(node), np.array(elem))
    return _plain({**p, 'J': c.get('J', 0), 'Cw': c.get('Cw', 0), 'xo': c.get('xo', 0),
                   'ro': c.get('ro', 0), 'Sf': p['Sx'], 'rx': p['rx'], 'ry': p['rz'],
                   't': 0.059, 'R': 0.1875})


_DESIGN_SECTION = {'depth': 8, 'flange_width': 2.5, 'thickness': 0.059, 'lip_depth': 0.625,
                   'R_corner': 0.1875, 'type': 'C', 'qlip': 90}

_LENGTHS = [float(x) for x in np.logspace(0, 3, 14)]


# ----------------------------------------------------------------- 계약표
def test_W1_method_table_is_covered():
    """W1: server.METHODS 의 모든 메서드가 이 파일의 RPC 시험을 받는다. selftest 가 같은 목록을 낸다."""
    from server import METHODS
    assert set(METHODS) == TESTED_METHODS, sorted(set(METHODS) ^ TESTED_METHODS)
    st = _srv().call('selftest')
    assert st['ok'] is True and st['import_errors'] == {}, st
    assert st['methods'] == sorted(METHODS)
    assert st['protocol_version'] == 2
    assert _srv().call('ping') == 'pong'


def test_W1_section_methods_match_engine():
    """W1: generate_section · get_properties · cutwp · doubler · stresgen · yieldMP · firstyield 은 엔진 그대로."""
    from engine.template import generate_section
    from engine.properties import grosprop
    from engine.cutwp import cutwp_prop
    from engine.helpers import doubler, firstyield
    from engine.stress import stresgen, yieldMP
    s = _srv()
    sp = {'H': 8.0, 'B': 2.5, 'D': 0.625, 't': 0.059, 'r': 0.1875}
    _same(s.call('generate_section', {'section_type': 'lippedc', 'params': sp}),
          generate_section('lippedc', dict(sp)), 'generate_section')
    # F2 후속: custom 경로의 validation · warnings 를 버리지 않는다.
    cp = {'outer_corners': [[2.5, 8.0], [0.0, 8.0], [0.0, 0.0], [2.5, 0.0]], 't': 0.059,
          'R_inner': 0.1}
    rc = s.call('generate_section', {'section_type': 'custom', 'params': cp})
    dc = generate_section('custom', dict(cp))
    assert 'validation' in rc and 'warnings' in rc
    _same(rc, dc, 'generate_section custom')
    node, elem = _section()
    N, El = np.array(node), np.array(elem)
    props = s.call('get_properties', {'node': node, 'elem': elem})
    _same(props, grosprop(N, El), 'get_properties')
    _same(s.call('cutwp', {'node': node, 'elem': elem}), cutwp_prop(N, El), 'cutwp')
    dn, de = doubler(N, El)
    _same(s.call('doubler', {'node': node, 'elem': elem}), {'node': dn, 'elem': de}, 'doubler')
    loads = {'P': 0, 'Mxx': 1, 'Mzz': 0, 'M11': 0, 'M22': 0, 'unsymm': 1}
    keys = ('A', 'xcg', 'zcg', 'Ixx', 'Izz', 'Ixz', 'thetap', 'I11', 'I22')
    _same(s.call('stresgen', {'node': node, 'props': props, 'loads': loads}),
          {'node': stresgen(N.copy(), P=0, Mxx=1, Mzz=0, M11=0, M22=0,
                            **{k: props[k] for k in keys}, unsymm=1)}, 'stresgen')
    p = grosprop(N, El)
    for unsymm in (0, 1):
        _same(s.call('yieldMP', {'node': node, 'elem': elem, 'fy': 50, 'unsymm': unsymm}),
              yieldMP(N, 50, *[p[k] for k in keys], unsymm=unsymm), f'yieldMP u{unsymm}')
        _same(s.call('firstyield', {'node': node, 'elem': elem, 'fy': 50, 'unsymm': unsymm}),
              firstyield(N, El, 50, unsymm=unsymm), f'firstyield u{unsymm}')
    # 서버가 지어내던 fy=35.53 기본값은 없다.
    for m in ('yieldMP', 'firstyield', 'plastic'):
        e = s.error(m, {'node': node, 'elem': elem})
        assert e['error_code'] == 'INVALID_PARAMS' and 'fy' in e['error'], e
    assert s.error('generate_section', {'params': sp})['error_code'] == 'INVALID_PARAMS'


def test_W1_analysis_methods_match_engine():
    """W1: analyze · classify · classify_detailed · dsm · signature_ss · energy_recovery 는 엔진 그대로."""
    from engine.fsm_solver import stripmain
    from engine.dsm import extract_dsm_values
    from engine.helpers import signature_ss, energy_recovery
    from cfsm.classify import classify
    s = _srv()
    node, elem = _section(r=0.0, stress=50.0)
    model = _model(node, elem, _LENGTHS)
    an = s.call('analyze', model)
    m = _cm(model)
    d = stripmain(m.prop, m.node, m.elem, m.lengths, m.springs, m.constraints, m.GBTcon,
                  m.BC, m.m_all, m.neigs).to_dict()
    # 폐기된 길이가 없으면 곡선 · 모드 · 진단 · m_all 은 엔진 그대로다.
    _same(an, d, 'analyze', extra=('lengths', 'length_indices', 'lengths_requested',
                                   'discarded_lengths', 'warnings', 'assumptions',
                                   'm_all_selection'))
    assert an['lengths'] == _LENGTHS and an['discarded_lengths'] == []
    assert an['m_all_selection']['source'] == 'caller'

    shapes = [np.array(x) for x in an['shapes']]
    clas = s.call('classify', {'model': model, 'shapes': an['shapes']})
    dclas = classify(m.prop, m.node, m.elem, m.lengths, shapes, m.GBTcon, m.BC, m.m_all)
    _same(clas, [c.tolist() for c in dclas], 'classify')
    det = s.call('classify_detailed', {'model': model, 'shapes': an['shapes']})
    _same(det, {'classification': [c.tolist() for c in dclas], **dclas.summary()},
          'classify_detailed')
    assert det['status'] == 'ok' and det['supported'] is True, det['status']

    dsm = s.call('dsm', {'node': node, 'elem': elem, 'curve': an['curve'], 'fy': 50,
                         'load_type': 'P', 'classifications': clas, 'BC': 'S-S',
                         'KxLx': 120, 'KyLy': 60, 'KtLt': 60, 'section_type': 'C'})
    ddsm = extract_dsm_values(an['curve'], m.node, m.elem, 50, 'P', mode_classifications=clas,
                              KxLx=120, KyLy=60, KtLt=60, section_type='C', BC='S-S')
    _same(dsm, ddsm, 'dsm')

    sig = s.call('signature_ss', {'prop': PROP, 'node': node, 'elem': elem, 'neigs': 1})
    dsig = signature_ss(m.prop, m.node, m.elem, neigs=1)
    _same({k: sig[k] for k in ('curve', 'lengths', 'diagnostics', 'shapes')},
          {'curve': [np.asarray(c).reshape(-1) for c in dsig['curve']],
           'lengths': dsig['lengths'], 'diagnostics': dsig['diagnostics'],
           'shapes': dsig['shapes']}, 'signature_ss')

    mode = shapes[6][:, 0].tolist()
    er = s.call('energy_recovery', {'node': node, 'elem': elem, 'prop': PROP, 'mode': mode,
                                    'length': _LENGTHS[6], 'BC': 'S-S', 'm_a': [1.0]})
    se = energy_recovery(m.prop, m.node, m.elem, np.array(mode), _LENGTHS[6],
                         m_a=np.array([1.0]), BC='S-S')
    _same(er, {'energy': se, 'columns': ['membrane', 'bending'], 'n_elements': len(se)},
          'energy_recovery')


def test_W1_vibration_fcfsm_plastic_forward_new_keys():
    """F3 후속: vibration 은 springs · constraints · neigs 를 넘기고 rho_used · units 를, fcfsm · plastic 은 새 키를 돌려준다."""
    from vibration.solver import stripmain_vib
    from fcfsm.solver import stripmain_fcfsm
    from plastic.pmm_plastic import pmm_plastic
    s = _srv()
    node, elem = _section(r=0.0, stress=50.0)
    springs = [[1, 1, 0, 0.0, 0.0, 1.0, 0.0, 0, 0, 0]]
    model = _model(node, elem, [20.0, 80.0], springs=springs)
    m = _cm(model)
    vib = s.call('vibration', model)               # rho 없음 → 엔진의 강재 기본 + 경고
    dv = stripmain_vib(m.prop, m.node, m.elem, m.lengths, m.BC, m.m_all, neigs=m.neigs,
                       springs=m.springs)
    _same(vib, dv, 'vibration')
    assert 'DEFAULT_DENSITY' in [x.get('code') for x in vib['diagnostics']]
    assert vib['units'] == {'frequency': 'Hz', 'rho': 'kip*s^2/in^4'} and vib['rho_used']
    no_spring = s.call('vibration', {**model, 'springs': [], 'rho': 7.345e-7})
    assert no_spring['frequencies'][0][0] != vib['frequencies'][0][0]   # 스프링이 실제로 들어갔다
    assert s.error('vibration', {**model, 'rho': -1})['error_code'] == 'INVALID_PARAMS'

    fc = s.call('fcfsm', model)
    dfc = stripmain_fcfsm(m.prop, m.node, m.elem, m.lengths, m.BC, m.m_all, m.neigs)
    _same(fc, {**dfc, 'curve': [np.asarray(c).reshape(-1) for c in dfc['curve']],
               'n_lengths': len(dfc['curve'])}, 'fcfsm', extra=('m_all_selection',))
    assert fc['is_fcfsm'] is False and fc['method'] and 'classification_status' in fc

    pl = s.call('plastic', {'node': node, 'elem': elem, 'fy': 50, 'n_theta': 12, 'n_na': 9})
    dp = pmm_plastic(np.array(node), np.array(elem), 50, n_theta=12, n_na=9)
    _same(pl, {k: (v.flatten() if isinstance(v, np.ndarray) else v) for k, v in dp.items()},
          'plastic')
    assert 'normalized' in pl and 'warnings' in pl and len(pl['P_raw']) == 12 * 9


def test_W1_design_methods_match_engine():
    """W1: aisi_design · aisi_guide · steel_grades · web_crippling · analyze_loads · 접합 · 특수 주제는 엔진 그대로."""
    from design.aisi_s100 import design_member, design_guide
    from design.steel_grades import list_grades
    from design.shear import web_crippling
    from design.loads.required_strength import analyze_loads
    from design.lap_connection import design_lap_connection, check_lap_length
    from design.special_topics import shear_lag, block_shear, cold_work_strength, flange_curling
    from design.connections import design_connection
    s = _srv()
    node, elem = _section()
    dp = {'member_type': 'compression', 'design_method': 'LRFD', 'Fy': 50, 'Fu': 65,
          'KxLx': 120, 'KyLy': 60, 'KtLt': 60, 'Pu': 5, 'props': _design_props(node, elem),
          'section_type': 'C', 'section': dict(_DESIGN_SECTION)}
    ra = s.call('aisi_design', dp)
    da = design_member(json.loads(json.dumps(dp)))
    assert ra['spec_sections'] == sorted(da['spec_sections'])
    _same(ra, da, 'aisi_design', extra=('spec_sections', 'report'))
    _same(s.call('aisi_guide', {'query_type': 'beam'}), design_guide({'query_type': 'beam'}),
          'aisi_guide')
    # F5 후속: include_restricted
    _same(s.call('steel_grades', {}), list_grades(), 'steel_grades')
    _same(s.call('steel_grades', {'include_restricted': True}), list_grades(True),
          'steel_grades restricted')
    wc = dict(h=7.5, t=0.059, R=0.1875, N=3.5, Fy=50, support='EOF', fastened='fastened',
              section_type='C', d=8.0)
    _same(s.call('web_crippling', wc), web_crippling(**wc), 'web_crippling')
    _same(s.call('web_crippling', {**wc, 'web_holes': True}),
          web_crippling(**wc, web_holes=True), 'web_crippling holes')
    # F7 후속: 새 인자(pattern_loading 등)가 엔진에 닿는다.
    al = dict(member_app='roof-purlin', span_type='cont-3', span_ft=25,
              loads={'D': 25, 'S': 100, 'W': -120}, design_method='LRFD', spacing_ft=5,
              pattern_loading=False, brace_points_ft=[12.5])
    r_al = s.call('analyze_loads', al)
    _same(r_al, analyze_loads(**al), 'analyze_loads')
    _same(s.call('analyze_loads', {**al, 'pattern_loading': True}),
          analyze_loads(**{**al, 'pattern_loading': True}), 'analyze_loads pattern')
    lp = {'d': 8, 't': 0.059, 'Fy': 50, 'Fu': 65, 'lap_left_in': 24, 'lap_right_in': 24,
          'Mu_support': 60, 'Vu_support': 2, 'Se': 1.0, 'design_method': 'LRFD'}
    _same(s.call('lap_connection', lp), design_lap_connection(dict(lp)), 'lap_connection')
    _same(s.call('check_lap_length', {'d': 8, 'lap_left': 10, 'lap_right': 14}),
          check_lap_length(8, 10, 14), 'check_lap_length')
    for name, fn, args in (
            ('shear_lag', shear_lag, dict(Ag=1, An_net=0.9, x_bar=0.5, L_conn=4, Fu=65, Fy=50,
                                          connection_case='flat_sheet', d=0.5, s=2.0)),
            ('block_shear', block_shear, dict(Agv=1, Anv=0.8, Ant=0.3, Fy=50, Fu=65)),
            ('cold_work', cold_work_strength, dict(Fyv=50, Fuv=65, R=0.1875, t=0.059)),
            ('flange_curling', flange_curling, dict(bf=2.5, t=0.059, h=8, f_avg=30))):
        try:
            direct = fn(**args)
        except Exception as exc:  # 엔진 오류도 같은 문장으로 와야 한다
            assert str(exc) in s.error(name, args)['error']
            continue
        _same(s.call(name, args), direct, name)
    dcp = {'connection_type': 'screw', 't1': 0.059, 't2': 0.059, 'd': 0.19, 'Fy': 50,
           'Fu': 65, 'n': 4, 'Pu': 2, 'design_method': 'LRFD'}
    _same(s.call('design_connection', dcp), design_connection(dict(dcp)), 'design_connection')


def test_W1_kw_methods_have_no_server_defaults():
    """W1 · F5/F6/F7 후속: 키워드 메서드는 서버 기본값이 없다 — 빠진 필수 인자는 오류, 모르는 인자는 결과에 드러난다."""
    s = _srv()
    e = s.error('web_crippling', {'t': 0.059, 'R': 0.1875, 'N': 3.5, 'Fy': 50})
    assert e['error_code'] == 'INVALID_PARAMS' and 'h' in e['error']
    e = s.error('check_lap_length', {'lap_left': 10, 'lap_right': 14})
    assert 'd' in e['error'], e                        # 예전: d=8.0 을 지어냄
    e = s.error('analyze_loads', {'member_app': 'roof-purlin', 'span_type': 'simple',
                                  'loads': {'D': 10}})
    assert 'span_ft' in e['error'], e                  # 예전: span_ft=25 를 지어냄
    r = s.call('web_crippling', dict(h=7.5, t=0.059, R=0.1875, N=3.5, Fy=50, sectoin_type='Z'))
    assert r['ignored_params'] == ['sectoin_type']
    assert any('sectoin_type' in w for w in r['warnings'])
    e = s.error('steel_grades', {'bogus': 1})          # 목록 결과 — 실을 곳이 없으니 오류
    assert e['error_code'] == 'INVALID_PARAMS'


def test_W1_calc_deck_stiffness_reports_method_and_kx_detail():
    """F7 후속: kφ 방법명이 Gao & Moen 2011 (Example II-1C), kx 는 lateral_stiffness_detail 의 패스너 값 · 경고와 함께."""
    from design.loads.bracing import calc_rotational_stiffness, lateral_stiffness_detail
    s = _srv()
    r = s.call('calc_deck_stiffness', {'t_panel': 0.018, 't_purlin': 0.059})
    assert r['kphi_method'] == 'gao_moen_2011_example_II_1C'
    assert abs(r['kphi'] - calc_rotational_stiffness(0.018, 0.059)) < 1e-15
    det = lateral_stiffness_detail(0.018, 0.059)
    _same(r['kx_detail'], det, 'kx_detail')
    assert r['kx'] == det['kx'] and r['units'] == {'kphi': 'kip-in/rad/in', 'kx': 'kip/in/in'}
    assert any('II-1C' in w for w in r['warnings'])        # 기본 패스너 값을 썼다고 밝힘
    guide = 'Use project-specific connection/panel test stiffness overrides when available.'
    assert guide in r['assumptions'] and guide not in r['warnings'] and r['warning'] == guide
    assert any('0.86' in a for a in r['assumptions'])     # COV 참고는 assumptions
    r2 = s.call('calc_deck_stiffness', {'kphi_override': 0.2, 'kx_override': 1.5})
    assert (r2['kphi'], r2['kx'], r2['kphi_method']) == (0.2, 1.5, 'test_override')
    assert r2['warning'] is None and r2['kx_detail'] is None
    assert s.error('calc_deck_stiffness', {'t_panel': 0.018})['error_code'] == 'INVALID_PARAMS'
    assert s.error('calc_deck_stiffness', {'kphi_override': 0, 'kx_override': 1})[
        'error_code'] == 'INVALID_PARAMS'


# ----------------------------------------------------------------- R8-17 견고성
def test_R8_17_bad_lines_get_error_responses_and_server_survives():
    """R8-17 · R8-31: 깨진 줄 · 객체가 아닌 JSON · 모르는 메서드 · 엔진 예외 뒤에도 서버가 산다. 깨진 줄도 id 를 되찾는다."""
    s = _srv()
    cases = [
        (b'[1,2,3]\n', None, 'INVALID_REQUEST'),
        (b'42\n', None, 'INVALID_REQUEST'),
        (b'"text"\n', None, 'INVALID_REQUEST'),
        (b'null\n', None, 'INVALID_REQUEST'),
        (b'{"method": "ping", "id": 77, \n', 77, 'PARSE_ERROR'),
        (b'{not json\n', None, 'PARSE_ERROR'),
        (b'\xff\xfe{"method":"ping"}\n', None, 'PARSE_ERROR'),
        (b'{"method": 5, "id": 3}\n', 3, 'INVALID_REQUEST'),
        (b'{"method": "ping", "params": [1], "id": 4}\n', 4, 'INVALID_PARAMS'),
        (b'{"method": "no_such", "id": "q"}\n', 'q', 'METHOD_NOT_FOUND'),
        (b'{"method": "get_properties", "params": {"node": [], "elem": []}, "id": 5}\n',
         5, 'ENGINE_ERROR'),
        (b'{"method": "dsm", "params": {"node": [[1,0,0,1,1,1,1,0]]}, "id": 6}\n',
         6, 'INVALID_PARAMS'),
    ]
    for data, rid, code in cases:
        resp = json.loads(s.send_raw(data))
        assert resp['id'] == rid and resp['error_code'] == code and resp['error'], (data, resp)
        assert s.call('ping') == 'pong', data
    eng = json.loads(s.send_raw(cases[10][0]))
    assert eng['error_type'] == 'ValueError' and 'Traceback' in eng['traceback']
    assert s.send_raw(b'\n{"method": "ping", "id": 9}\n') == b'{"id": 9, "result": "pong"}'


_INJECT = r'''
import os, sys
sys.path.insert(0, os.getcwd())
import numpy as np
import server

def noisy(p):
    print('stray print from engine')
    sys.stdout.write('stray write\n')
    os.write(1, b'raw fd write\n')
    return {'ok': True}

server.METHODS.update({
    'noisy': noisy,
    'nan_scalar': lambda p: {'a': float('nan'), 'b': np.float64('inf'), 'c': -np.inf, 'd': np.float32(1.5)},
    'nan_nested': lambda p: {'rows': [np.array([1.0, np.nan, np.inf]), [[np.nan, 2.0]]],
                             'm': np.array([[np.nan, 1.0], [2.0, -np.inf]]),
                             'i': np.int64(3), 'flag': np.bool_(True), 's': {3, 1, 2}},
    'complex_result': lambda p: {'z': np.array([1 + 2j])},
    'bad_object': lambda p: {'obj': object()},
})
server.main()
'''


def test_R8_17_serialisation_and_stdout_protection():
    """R8-17 · R8-25 · R8-26: NaN/±Inf → null(스칼라 · 중첩 배열), 직렬화 불가 결과는 오류 응답, stdout 에는 JSON-RPC 만."""
    s = _Server(args=[PY, '-u', '-c', _INJECT])
    try:
        raw = s.send_raw(b'{"method": "noisy", "id": 1}\n')
        assert json.loads(raw) == {'id': 1, 'result': {'ok': True}}
        assert s.send_raw(b'{"method": "ping", "id": 2}\n') == b'{"id": 2, "result": "pong"}'
        r = s.send_raw(b'{"method": "nan_scalar", "id": 3}\n')
        assert b'NaN' not in r and b'Infinity' not in r
        assert json.loads(r)['result'] == {'a': None, 'b': None, 'c': None, 'd': 1.5}
        r = s.send_raw(b'{"method": "nan_nested", "id": 4}\n')
        assert b'NaN' not in r and b'Infinity' not in r
        assert json.loads(r)['result'] == {'rows': [[1.0, None, None], [[None, 2.0]]],
                                           'm': [[None, 1.0], [2.0, None]], 'i': 3,
                                           'flag': True, 's': [1, 2, 3]}
        for rid, meth in ((5, 'complex_result'), (6, 'bad_object')):
            resp = json.loads(s.send_raw(f'{{"method": "{meth}", "id": {rid}}}\n'.encode()))
            assert resp['id'] == rid and resp['error_code'] == 'SERIALIZATION_ERROR', resp
            assert s.send_raw(b'{"method": "ping", "id": 7}\n') == b'{"id": 7, "result": "pong"}'
    finally:
        s.close()
    err = s.stderr_text()
    for noise in ('stray print from engine', 'stray write', 'raw fd write'):
        assert noise in err, err          # 출력은 stderr 로 갔고, 위의 응답 줄은 깨지지 않았다


def test_R8_17_module_entry_point_speaks_protocol():
    """W1: `python -m python`(저장소 루트)도 같은 서버다."""
    s = _Server(args=[PY, '-u', '-m', 'python'], cwd=ROOT)
    try:
        assert s.send_raw(b'{"method": "ping", "id": 1}\n') == b'{"id": 1, "result": "pong"}'
    finally:
        s.close()


# ----------------------------------------------------------------- R8-25 · F3 NaN 분류
def test_R8_25_rounded_corner_classification_is_null_with_status():
    """R8-25 · F3 후속: 둥근 모서리 단면의 cFSM 분류는 0 이 아니라 null 행이고, classify_detailed 가 status · code 를 준다."""
    s = _srv()
    node, elem = _section(r=0.1875, stress=50.0)
    model = _model(node, elem, [5.0, 20.0])
    an = s.call('analyze', model)
    resp, raw = s.request('classify_detailed', {'model': model, 'shapes': an['shapes']})

    # 값으로서의 NaN · Infinity 토큰이 없어야 한다(JSON 이 아니다). 안내 문장 안의 "NaN" 이라는
    # 글자는 괜찮다 — 바이트를 찾지 않고 엄격하게 파싱해서 가른다.
    def _bare_constant(name):
        raise AssertionError(f'bare {name} token in JSON response')
    json.loads(raw.decode('utf-8'), parse_constant=_bare_constant)
    det = resp['result']
    assert det['status'] == 'unsupported' and det['code'] == 'ROUNDED_CORNER', det
    assert det['supported'] is False and det['message']
    assert all(v is None for rows in det['classification'] for row in rows for v in row)
    legacy = s.call('classify', {'model': model, 'shapes': an['shapes']})
    assert legacy == det['classification']
    # F3 후속: 최상위 GBTcon 이 model.GBTcon 보다 먼저 — 설정이 결과의 settings 에 보인다.
    node0, elem0 = _section(r=0.0, stress=50.0)
    m0 = _model(node0, elem0, [5.0])
    an0 = s.call('analyze', m0)
    g = {'ospace': 1, 'orth': 1, 'couple': 1, 'norm': 0}
    det0 = s.call('classify_detailed', {'model': m0, 'shapes': an0['shapes'], 'GBTcon': g})
    assert det0['settings'] == g, det0['settings']


# ----------------------------------------------------------------- R8-27 결정성
def test_R8_27_output_is_byte_identical_across_hash_seeds():
    """R8-27: 같은 요청은 해시 시드와 무관하게 같은 바이트(spec_sections · 보고서의 조항 줄 포함)."""
    node, elem = _section()
    req = {'member_type': 'combined', 'design_method': 'LRFD', 'Fy': 50, 'Fu': 65,
           'KxLx': 120, 'KyLy': 60, 'KtLt': 60, 'Lb': 60, 'Pu': 5, 'Mux': 20,
           'props': _design_props(node, elem), 'section_type': 'C',
           'section': dict(_DESIGN_SECTION)}
    line = (json.dumps({'method': 'aisi_design', 'params': req, 'id': 1}) + '\n').encode()
    digests = []
    srv = _Server(env={'PYTHONHASHSEED': '1'})     # 공유 서버는 무작위 시드 — 둘을 비교한다
    try:
        digests.append(hashlib.sha256(srv.send_raw(line)).hexdigest())
    finally:
        srv.close()
    shared = _srv()
    shared.i = 0
    first = shared.send_raw(line)
    assert shared.send_raw(line) == first
    digests.append(hashlib.sha256(first).hexdigest())
    assert len(set(digests)) == 1, digests
    res = json.loads(first)['result']
    secs = res['spec_sections']
    assert secs == sorted(secs) and len(secs) >= 6
    assert ('Specification: AISI S100-16 ' + ', '.join('§' + x for x in secs)) in res['report']


# ----------------------------------------------------------------- F1 후속: m_all
def test_F1_m_all_missing_auto_and_explicit():
    """F1 후속: m_all 이 빠지면 지어내지 않고 오류(auto 안내), 'auto' 는 S-S [1] · 그 밖은 m_recommend, 명시 목록은 그대로 + INSUFFICIENT 진단."""
    from engine.helpers import recommended_terms
    s = _srv()
    # 휨 응력: 서명곡선에 국부 · 뒤틀림 두 극소가 있어 m_recommend 가 가벼운 'signature' 길로 간다.
    node, elem = _section(r=0.0)
    props = s.call('get_properties', {'node': node, 'elem': elem})
    node = s.call('stresgen', {'node': node, 'props': props, 'loads': {'Mxx': 1}})['node']
    peak = max(abs(n[7]) for n in node)
    node = [n[:7] + [n[7] * 50.0 / peak] for n in node]
    L = [30.0]
    base = _model(node, elem, L, BC='C-C')
    for missing in ({k: v for k, v in base.items() if k != 'm_all'}, {**base, 'm_all': []}):
        e = s.error('analyze', missing)
        assert e['error_code'] == 'INVALID_PARAMS' and "'auto'" in e['error'], e
    # S-S 자동: 길이마다 [1]
    ss = s.call('analyze', {**base, 'BC': 'S-S', 'lengths': [30.0, 60.0], 'm_all': 'auto'})
    assert ss['m_all'] == [[1.0], [1.0]] and ss['m_all_selection']['source'] == 'auto'
    # RPC m_recommend: 엔진 dict 그대로, 항은 엔진의 recommended_terms(a, Lcrl, Lcrd) 그대로
    rec = s.call('m_recommend', {'prop': PROP, 'node': node, 'elem': elem, 'lengths': L})
    assert rec['method'] == 'signature' and set(rec) >= {'m_all', 'Lcrl', 'Lcrd', 'minima', 'warnings'}
    assert rec['m_all'] == [recommended_terms(30.0, rec['Lcrl'], rec['Lcrd']).astype(float).tolist()]
    # 그 밖의 BC 자동: m_recommend 와 같은 항, 항 부족 경고 없음
    auto = s.call('analyze', {**base, 'm_all': 'AUTO'})
    assert auto['m_all'] == rec['m_all']
    sel = auto['m_all_selection']
    assert sel['source'] == 'm_recommend' and sel['Lcrl'] == rec['Lcrl'] and sel['method'] == 'signature'
    # 자동으로 고른 항은 참고(assumptions)이고 경고가 아니다
    assert any(a.startswith('m_all chosen automatically (m_recommend)') for a in auto['assumptions'])
    assert not any('chosen automatically' in w for w in auto['warnings'])
    assert 'INSUFFICIENT_LONGITUDINAL_TERMS' not in [d['code'] for d in auto['diagnostics']]
    # 명시 목록은 그대로(엔진은 항을 바꾸지 않음) — 진단과 경고가 호출자에게 닿는다
    one = s.call('analyze', {**base, 'm_all': [[1]]})
    assert one['m_all'] == [[1.0]] and one['m_all_selection']['source'] == 'caller'
    assert one['assumptions'] == []
    ins = [d for d in one['diagnostics'] if d['code'] == 'INSUFFICIENT_LONGITUDINAL_TERMS']
    assert ins and one['success'] is True
    assert any(ins[0]['message'] == w for w in one['warnings'])
    # 같은 C-C 에서 [1] 은 권장 항보다 하중계수가 높다(항 부족 = 비보수)
    assert one['curve'][0][1] > auto['curve'][0][1]
    e = s.error('analyze', {**base, 'm_all': 'everything'})
    assert e['error_code'] == 'INVALID_PARAMS'


# ----------------------------------------------------------------- F1 후속: 폐기 길이
def test_F1_ill_conditioned_lengths_removed_analysis_succeeds():
    """F1 후속(사용자 결정): ILL_CONDITIONED 로 폐기된 긴 길이는 곡선에서 빠지고 해석은 성공, 진단은 남는다. DSM 은 같은 값."""
    from engine.dsm import extract_dsm_values
    from engine.fsm_solver import stripmain
    s = _srv()
    node, elem = _section(r=0.0, stress=50.0)
    L = [10.0, 100.0, 1000.0, 1.0e4, 5.0e4, 1.0e5]
    model = _model(node, elem, L)
    # 어느 길이를 엔진이 폐기하는지는 엔진의 판정(경계값은 F1 소관)을 직접 호출로 읽는다.
    m = _cm(model)
    direct = stripmain(m.prop, m.node, m.elem, m.lengths, m.springs, m.constraints, m.GBTcon,
                       m.BC, m.m_all, m.neigs).to_dict()
    drop = [x['length_index'] for x in direct['diagnostics']
            if x['code'] == 'ILL_CONDITIONED' and x['severity'] == 'error']
    assert direct['success'] is False and drop and drop[-1] == len(L) - 1   # 엔진은 실패로 낸다
    keep = [i for i in range(len(L)) if i not in drop]
    an = s.call('analyze', model)
    assert an['success'] is True
    assert an['lengths'] == [L[i] for i in keep] and an['length_indices'] == keep
    assert an['lengths_requested'] == L
    assert [x['length'] for x in an['discarded_lengths']] == [L[i] for i in drop]
    n = len(keep)
    assert len(an['curve']) == len(an['shapes']) == len(an['m_all']) == an['n_lengths'] == n
    assert an['curve'] == [direct['curve'][i] for i in keep]
    ill = [x for x in an['diagnostics'] if x['code'] == 'ILL_CONDITIONED' and x['severity'] == 'error']
    assert [x['length_index'] for x in ill] == drop and all(x['discarded'] for x in ill)
    assert sum('removed from the curve' in w for w in an['warnings']) == len(drop)
    # 0 행이 섞인 원래 곡선으로 뽑아도 DSM 은 같다(엔진이 lf ≤ 0 행을 건너뜀)
    raw_curve = direct['curve']
    a = s.call('dsm', {'node': node, 'elem': elem, 'curve': an['curve'], 'fy': 50, 'BC': 'S-S'})
    b = extract_dsm_values(raw_curve, np.array(node), np.array(elem), 50, BC='S-S')
    _same(a, b, 'dsm without discarded rows')
    # classify: analyze 가 준 lengths 로 부르면 된다. 옛 lengths 는 어긋남을 오류로 알린다.
    ok = s.call('classify', {'model': model, 'shapes': an['shapes'],
                             'lengths': an['lengths'], 'm_all': an['m_all']})
    assert len(ok) == n
    e = s.error('classify', {'model': model, 'shapes': an['shapes']})
    assert 'lengths' in e['error'] and e['error_code'] == 'INVALID_PARAMS'
    # 다른 실패(모든 자유도 고정)는 그대로 해석 실패
    fixed = [r[:3] + [0, 0, 0, 0] + r[7:] for r in node]
    bad = s.call('analyze', _model(fixed, elem, [10.0, 100.0]))
    assert bad['success'] is False
    assert {d['code'] for d in bad['diagnostics']} == {'NO_FREE_DOF'}


def test_F1_signature_ss_rpc_returns_diagnostics():
    """F1 후속 · R8-24: signature_ss RPC 가 동작하고 diagnostics · shapes 를 싣는다. 쓰지 않는 springs 는 경고."""
    s = _srv()
    node, elem = _section(r=0.0, stress=50.0)
    sig = s.call('signature_ss', {**_model(node, elem, [10.0]),
                                  'springs': [[1, 1, 0, 0, 0, 1.0, 0, 0, 0, 0]]})
    assert len(sig['curve']) + len(sig['discarded_lengths']) == 100
    assert len(sig['lengths']) == len(sig['curve']) == len(sig['shapes'])
    assert isinstance(sig['diagnostics'], list) and 'success' in sig
    assert any('springs' in w for w in sig['warnings'])


def test_E5_design_signature_lengths_rpc():
    """2026-11-25 R8: 설계용 서명곡선 격자는 엔진의 한 규칙 — 0.05 D … 100 D 의 로그 간격 10 배마다 30 점(101 점),
    D = 중심선 범위의 큰 쪽. 엔진의 자동 경로(_auto_generate_props)가 같은 함수를 쓴다. node 가 없으면 오류."""
    import math
    s = _srv()
    node, elem = _section(r=0.0, stress=50.0)
    out = s.call('design_signature_lengths', {'node': node, 'elem': elem})
    xs = [r[1] for r in node]
    zs = [r[2] for r in node]
    D = max(max(xs) - min(xs), max(zs) - min(zs))
    L = out['lengths']
    assert len(L) == 101 and abs(out['D'] - D) < 1e-12 and out['BC'] == 'S-S'
    assert abs(L[0] - 0.05 * D) < 1e-9 * D and abs(L[-1] - 100 * D) < 1e-9 * D
    ratio = [math.log10(b / a) for a, b in zip(L, L[1:])]
    assert max(ratio) - min(ratio) < 1e-9 and abs(1 / ratio[0] - 30.3) < 0.1   # log10(2000)/100 → 30.3 점/10 배
    e = s.error('design_signature_lengths', {})
    assert 'node' in e['error']


# ----------------------------------------------------------------- F5 후속: dsm
def test_F5_dsm_forwards_bc_and_requires_section_type():
    """F5 후속 · R8-05: dsm 이 BC · unsymm 을 넘긴다(C-C 곡선은 서명곡선 아님), 폐형식 전체좌굴에 section_type 필수, BC 가 없으면 경고."""
    s = _srv()
    node, elem = _section(r=0.0, stress=50.0)
    an = s.call('analyze', _model(node, elem, _LENGTHS))
    base = {'node': node, 'elem': elem, 'curve': an['curve'], 'fy': 50, 'load_type': 'P'}
    cc = s.call('dsm', {**base, 'BC': 'C-C'})
    assert cc['signature_curve'] is False and cc['crl'] == 0
    ss = s.call('dsm', {**base, 'BC': 'S-S'})
    assert ss['signature_curve'] is True and ss['crl'] > 0
    nobc = s.call('dsm', base)
    assert any(w.startswith('server: BC was not given') for w in nobc['warnings'])
    e = s.error('dsm', {**base, 'BC': 'S-S', 'Lb': 120, 'load_type': 'Mxx'})
    assert 'section_type' in e['error'] and e['error_code'] == 'INVALID_PARAMS'
    assert s.error('dsm', {k: v for k, v in base.items() if k != 'fy'})['error_code'] == 'INVALID_PARAMS'
    e = s.error('dsm', {**base, 'classifications': [], 'mode_classifications': []})
    assert e['error_code'] == 'INVALID_PARAMS'


# ----------------------------------------------------------------- fileio
def test_W1_project_file_round_trip_and_version_checks():
    """R8-28 (fileio): .cufsm 저장 → 읽기 무손실, 새 주 버전 · 다른 형식은 거절, 머리말 없는 원시 모델은 경고와 함께 읽음, NaN 은 쓰지 않음."""
    s = _srv()
    node, elem = _section(r=0.0, stress=50.0)
    model = _model(node, elem, [10.0, 50.0], BC='C-F', m_all=[[1, 2, 3], [1, 2]],
                   springs=[[1, 1, 0, 0, 0, 1.0, 0, 0, 0, 0]],
                   GBTcon={'glob': [1, 1, 1, 1], 'dist': [0, 0], 'local': [], 'other': [],
                           'ospace': 2, 'orth': 1, 'couple': 1, 'norm': 0})
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'p.cufsm')
        assert s.call('save_project', {'model': model, 'filepath': path}) == 'saved'
        with open(path, encoding='utf-8') as f:
            on_disk = json.load(f)
        assert on_disk['format'] == 'cufsm-vscode' and on_disk['version'] == '1.0'
        back = s.call('load_project', {'filepath': path})
        assert back.pop('file_info') == {'format': 'cufsm-vscode', 'version': '1.0',
                                         'warnings': [], 'assumptions': []}
        _same(back, _cm(model).to_dict(), 'project round trip')
        assert back['m_all'] == [[1.0, 2.0, 3.0], [1.0, 2.0]] and back['BC'] == 'C-F'
        for patch, word in (({'version': '2.0'}, 'newer'), ({'format': 'other'}, 'format'),
                            ({'version': 'x'}, 'version')):
            p2 = os.path.join(tmp, 'v.cufsm')
            with open(p2, 'w', encoding='utf-8') as f:
                json.dump({**on_disk, **patch}, f)
            assert word in s.error('load_project', {'filepath': p2})['error']
        bare = os.path.join(tmp, 'bare.stcfsd')
        with open(bare, 'w', encoding='utf-8') as f:
            json.dump(model, f)
        rb = s.call('load_project', {'filepath': bare})
        assert rb['file_info']['assumptions'] and rb['node'] == back['node']
        nobc = os.path.join(tmp, 'nobc.cufsm')
        with open(nobc, 'w', encoding='utf-8') as f:
            json.dump({k: v for k, v in on_disk.items() if k != 'BC'}, f)
        assert 'BC' in s.error('load_project', {'filepath': nobc})['error']
        nan_model = json.loads(json.dumps(model))
        nan_model['node'][0][7] = None          # JSON null → NaN in the model
        e = s.error('save_project', {'model': nan_model, 'filepath': os.path.join(tmp, 'n.cufsm')})
        assert 'NaN' in e['error']
        assert not os.path.exists(os.path.join(tmp, 'n.cufsm'))
        assert s.error('load_project', {})['error_code'] == 'INVALID_PARAMS'


def test_W1_mat_import_cufsm_files():
    """R8-28 (fileio): CUFSM .mat — 길이 하나의 다항 m_all, 옛 4열 스프링 변환(loader.m), 0 으로 채운 구속 열, 경고."""
    from scipy.io import savemat
    s = _srv()
    ff = os.path.join(ROOT, 'Ref_Source', 'examples', 'vibration', 'ffplate1.mat')
    if os.path.exists(ff):
        r = s.call('load_mat', {'filepath': ff})
        assert r['m_all'] == [[float(i) for i in range(1, 11)]]      # 예전: 항 10개를 길이 10개로 쪼갬
        assert r['BC'] == 'S-S' and len(r['prop'][0]) == 7               # 7 열 = 질량밀도
    node, elem = _section(r=0.0)
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'old.mat')
        savemat(path, {'prop': np.array(PROP[0]), 'node': np.array(node), 'elem': np.array(elem),
                       'lengths': np.array([10.0, 20.0]), 'springs': np.array([27, 4, 0.7, 1.0]),
                       'constraints': np.array([[3, 1, 1, 5, 1, 0, 0, 0]]),
                       'GBTcon': {'glob': 0, 'dist': 0, 'local': 0, 'other': 0}})
        r = s.call('load_mat', {'filepath': path})
        assert r['springs'] == [[1.0, 27.0, 0.0, 0.0, 0.0, 0.0, 0.7, 0.0, 0.0, 0.0]]
        assert r['constraints'] == [[3.0, 1.0, 1.0, 5.0, 1.0]]
        assert r['BC'] == 'S-S' and r['m_all'] == [[1.0], [1.0]]
        assert (r['GBTcon']['orth'], r['GBTcon']['norm']) == (2, 1)      # CUFSM loader.m 기본
        # loader.m 과 같은 채움 · 변환은 값을 바꾸지 않으므로 assumptions, warnings 는 비어 있다
        a = ' '.join(r['file_info']['assumptions'])
        assert 'CUFSM 3' in a and 'converted' in a and 'm=[1]' in a
        assert r['file_info']['warnings'] == []
        bad = os.path.join(tmp, 'bad.mat')
        savemat(bad, {'prop': np.array(PROP[0]), 'node': np.array(node)})
        assert 'elem' in s.error('load_mat', {'filepath': bad})['error']


# ----------------------------------------------------------------- 검증 뒤 (V1 · V3)
def _mat_with_gbtcon(tmp, name, gbtcon):
    from scipy.io import savemat
    node, elem = _section(r=0.0)
    path = os.path.join(tmp, name)
    d = {'prop': np.array(PROP[0]), 'node': np.array(node), 'elem': np.array(elem),
         'lengths': np.array([10.0]), 'BC': 'S-S', 'm_all': np.array([1.0])}
    if gbtcon is not None:
        d['GBTcon'] = gbtcon
    savemat(path, d)
    return path


def test_V1_02_mat_cfsm_settings_follow_cufsm_loader():
    """V1-02: .mat 에 없는 cFSM 설정은 CUFSM loader.m:134-146 의 값(ospace 1 · orth 2 · couple 1 · norm 1), 있는 값은 그대로, 옛 basis 는 loader.m 의 표대로."""
    from fileio.mat_loader import CUFSM_LOADER_GBT_DEFAULTS
    # loader.m:134-146 의 리터럴: ospace=1, orth=2, couple=1, norm=1
    assert CUFSM_LOADER_GBT_DEFAULTS == {'ospace': 1, 'orth': 2, 'couple': 1, 'norm': 1}
    s = _srv()

    def settings(r):
        g = r['GBTcon']
        return g['ospace'], g['orth'], g['couple'], g['norm']

    with tempfile.TemporaryDirectory() as tmp:
        cases = [
            ('none.mat', None, (1, 2, 1, 1)),
            ('vectors_only.mat', {'glob': 0, 'dist': 0, 'local': 0, 'other': 0}, (1, 2, 1, 1)),
            ('partial.mat', {'ospace': 3, 'orth': 1, 'couple': 2}, (3, 1, 2, 1)),
            ('full.mat', {'ospace': 2, 'orth': 3, 'couple': 1, 'norm': 0}, (2, 3, 1, 0)),
            ('basis1.mat', {'basis': 1}, (1, 1, 1, 1)),
            ('basis2.mat', {'basis': 2}, (1, 2, 1, 1)),
            ('basis3.mat', {'basis': 3}, (2, 2, 1, 1)),
        ]
        for name, gbt, expected in cases:
            r = s.call('load_mat', {'filepath': _mat_with_gbtcon(tmp, name, gbt)})
            assert settings(r) == expected, (name, settings(r))
            notes = ' '.join(r['file_info']['assumptions'])
            if name == 'full.mat':
                assert 'cFSM settings' not in notes     # 다 저장돼 있으면 채운 것이 없다
            else:
                assert 'loader' in notes, (name, notes)
            assert r['file_info']['warnings'] == []


_NOTICE_KEYS = ('warnings', 'assumptions', 'scope_notes', 'not_evaluated',
                'not_evaluated_relevant', 'not_checked', 'checks_not_evaluated', 'diagnostics')


def _notice_paths(x, path=()):
    """결과 안(중첩 포함)의 알림 키 경로와 값을 모두 낸다."""
    if isinstance(x, dict):
        for k, v in x.items():
            if k in _NOTICE_KEYS:
                yield path + (k,), v
            yield from _notice_paths(v, path + (k,))
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from _notice_paths(v, path + (i,))


def _get_path(x, path):
    for part in path:
        x = x[part]
    return x


def test_W1_notices_pass_through_unchanged():
    """조정자 3: warnings · assumptions · scope_notes · 미평가 목록 · diagnostics 는 중첩된 곳까지 엔진 그대로. 서버 알림은 끝에 덧붙고 엔진 항목을 바꾸지 않는다."""
    from design.aisi_s100 import design_member
    from design.connections import design_connection
    from design.lap_connection import design_lap_connection
    from design.loads.required_strength import analyze_loads
    from design.shear import web_crippling
    from engine.dsm import extract_dsm_values
    s = _srv()
    node, elem = _section()
    props = _design_props(node, elem)
    cases = [
        ('aisi_design', {'member_type': 'combined', 'design_method': 'LRFD', 'Fy': 50, 'Fu': 65,
                         'KxLx': 120, 'KyLy': 60, 'KtLt': 60, 'Lb': 60, 'Pu': 5, 'Mux': 20,
                         'Vu': 1.0, 'props': props, 'section_type': 'C',
                         'section': dict(_DESIGN_SECTION)},
         lambda p: design_member(json.loads(json.dumps(p)))),
        ('design_connection', {'connection_type': 'bolt', 't1': 0.059, 't2': 0.059, 'd': 0.5,
                               'Fy': 50, 'Fu': 65, 'n': 2, 'Pu': 2, 'Tu': 0.5,
                               'design_method': 'ASD'},
         lambda p: design_connection(dict(p))),
        ('lap_connection', {'d': 8, 't': 0.059, 'Fy': 50, 'Fu': 65, 'lap_left_in': 24,
                            'lap_right_in': 24, 'Mu_support': 60, 'Vu_support': 2},
         lambda p: design_lap_connection(dict(p))),
        ('analyze_loads', dict(member_app='wall-girt', span_type='cont-2', span_ft=20,
                               loads={'D': 20, 'W': -100}, design_method='ASD'),
         lambda p: analyze_loads(**p)),
        ('web_crippling', dict(h=7.5, t=0.059, R=0.1875, N=3.5, Fy=50, web_holes=True),
         lambda p: web_crippling(**p)),
    ]
    sn, se = _section(r=0.0, stress=50.0)
    an = s.call('analyze', _model(sn, se, _LENGTHS))
    dsm_p = {'node': sn, 'elem': se, 'curve': an['curve'], 'fy': 50, 'BC': 'S-S'}
    cases.append(('dsm', dsm_p, lambda p: extract_dsm_values(
        p['curve'], np.array(p['node']), np.array(p['elem']), 50, BC='S-S')))
    seen = 0
    for method, params, direct_fn in cases:
        rpc = s.call(method, params)
        direct = _plain(direct_fn(params))
        paths = list(_notice_paths(direct))
        assert paths, f'{method}: no notice keys to compare'
        for path, value in paths:
            assert _get_path(rpc, path) == value, f'{method} {path} changed'
            seen += 1
    assert seen >= 10
    # 서버 알림은 덧붙기만 한다
    wc = dict(h=7.5, t=0.059, R=0.1875, N=3.5, Fy=50, web_holes=True)
    direct = _plain(web_crippling(**wc))
    rpc = s.call('web_crippling', {**wc, 'typo_key': 1})
    if isinstance(direct.get('warnings'), list):
        assert rpc['warnings'][:-1] == direct['warnings']
    assert rpc['warnings'][-1].startswith('server: parameter(s) not used')
    for k in ('assumptions', 'scope_notes'):
        assert rpc.get(k) == direct.get(k)
    # 자동 항(S-S)은 assumptions, 경고 아님
    ss = s.call('analyze', _model(sn, se, [10.0], m_all='auto'))
    assert ss['assumptions'] == ['m_all chosen automatically (auto): S-S: one term m=[1] per '
                                 'length (terms do not couple for S-S)']
    assert ss['warnings'] == []


def test_V3_T13_analyze_loads_new_arguments_reach_engine():
    """V3 T13 · F7 후속: pattern_loading · brace_points_ft · i621_conditions_confirmed · insulation_in 이 엔진에 닿는다 — 각각 결과를 바꾸고, 같은 인자의 직접 호출과 같고, ignored_params 가 없다."""
    from design.loads.required_strength import analyze_loads
    s = _srv()
    sec = {'depth': 8, 'flange_width': 2.5, 'thickness': 0.059, 'lip_depth': 0.625,
           'R_corner': 0.1875, 'type': 'Z', 'Fy': 55, 'Fu': 70, 'Ixx': 10.0}
    base = dict(member_app='roof-purlin', span_type='simple', span_ft=25,
                loads={'D': 10, 'W': -150, 'Lr': 100}, design_method='LRFD', spacing_ft=5,
                section=sec, deck={'type': 'through-fastened', 't_panel': 0.018,
                                   'fastener_spacing': 12})
    r0 = s.call('analyze_loads', base)
    _same(r0, analyze_loads(**base), 'analyze_loads base')
    for key, value in (('pattern_loading', False), ('brace_points_ft', [12.5]),
                       ('i621_conditions_confirmed', True), ('insulation_in', 6.0)):
        r = s.call('analyze_loads', {**base, key: value})
        assert 'ignored_params' not in r, key
        _same(r, analyze_loads(**base, **{key: value}), f'analyze_loads {key}')
        assert _diff(r, r0), f'{key} did not change the result'
    # F7 V3 뒤: lr_reduced(Lr 부분재하는 감소된 Lr 에만) · I_span_in4(경간별 I)
    cont = dict(base, span_type='cont-3', loads={'D': 10, 'Lr': 100}, deck=None)
    c0 = s.call('analyze_loads', cont)
    for key, value, geom in (('lr_reduced', True, cont),
                             ('I_span_in4', [10.0, 20.0, 10.0], cont)):
        r = s.call('analyze_loads', {**geom, key: value})
        assert 'ignored_params' not in r, key
        _same(r, analyze_loads(**geom, **{key: value}), f'analyze_loads {key}')
        assert _diff(r, c0), f'{key} did not change the result'



# ----------------------------------------------------------------- 엔진 검증 뒤 (3차)
def test_F1_V1_auto_terms_solve_the_signature_curve_once():
    """F1 V1 뒤: m_all='auto' 는 m_recommend_details 결과를 stripmain(half_wavelengths=…) 에 넘겨 서명곡선을 한 번만 푼다. 넘긴 dict 는 응답에 새지 않는다."""
    import server
    from engine import helpers
    node, elem = _section(r=0.0)
    from engine.properties import grosprop
    from engine.stress import stresgen
    p = grosprop(np.array(node), np.array(elem))
    keys = ('A', 'xcg', 'zcg', 'Ixx', 'Izz', 'Ixz', 'thetap', 'I11', 'I22')
    nb = stresgen(np.array(node), P=0, Mxx=1, Mzz=0, M11=0, M22=0, **{k: p[k] for k in keys})
    nb[:, 7] *= 50.0 / np.max(np.abs(nb[:, 7]))
    model = _model(nb.tolist(), elem, [30.0], BC='C-C', m_all='auto')
    calls = {'sig': 0, 'kw': None}
    real_sig, real_strip = helpers.signature_ss, server.stripmain

    def count_sig(*a, **k):
        calls['sig'] += 1
        return real_sig(*a, **k)

    def spy_strip(*a, **k):
        calls['kw'] = k
        return real_strip(*a, **k)

    helpers.signature_ss, server.stripmain = count_sig, spy_strip
    try:
        helpers._LCR_CACHE.clear()
        helpers.m_recommend_details(np.array(PROP), nb, np.array(elem), [30.0])
        alone = calls['sig']
        helpers._LCR_CACHE.clear()
        calls['sig'] = 0
        resp = server.handle_request({'id': 1, 'method': 'analyze', 'params': model})
    finally:
        helpers.signature_ss, server.stripmain = real_sig, real_strip
    assert 'error' not in resp, resp.get('error')
    res = resp['result']
    assert alone >= 1 and calls['sig'] == alone, (alone, calls['sig'])
    hw = calls['kw'].get('half_wavelengths')
    assert hw is not None and hw['Lcrl'] == res['m_all_selection']['Lcrl']
    assert '_half_wavelengths' not in res['m_all_selection']
    assert {'extra_lengths', 'cfsm_check'} <= set(res['m_all_selection'])   # m_recommend 키 전부


def test_F1_V1_no_minimum_recommendation_is_reported_not_raised():
    """F1 V1 뒤: 극소가 없는 서명곡선(등변 앵글 압축)은 m_recommend 가 method='no_minimum' + 경고로 답하고, auto 해석도 돈다(경고는 warnings 로)."""
    from engine.template import generate_section
    s = _srv()
    g = generate_section('angle', {'H': 3, 'B': 3, 't': 0.06, 'r': 0})
    node = np.array(g['node'], dtype=float)
    node[:, 7] = 50.0
    node, elem = node.tolist(), np.array(g['elem'], dtype=float).tolist()
    rec = s.call('m_recommend', {'prop': PROP, 'node': node, 'elem': elem, 'lengths': [50.0]})
    assert rec['method'] == 'no_minimum' and rec['Lcrl'] is None and rec['warnings']
    assert rec['m_all'] == [[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]]
    an = s.call('analyze', _model(node, elem, [50.0], BC='C-C', m_all='auto'))
    assert an['success'] is True and an['m_all'] == rec['m_all']
    assert an['m_all_selection']['method'] == 'no_minimum'
    assert rec['warnings'][0] in an['warnings']                       # 사용자가 볼 일


def test_F4_F5_F6_new_inputs_and_result_keys_pass_through():
    """F4 · F5 · F6 검증 뒤: 새 입력(aisi_design 의 span_type · moment_sign, design_connection 의 member_case='not_tension_member' · j6_3_not_applicable)은 엔진에 닿고, 새 결과 키(dsm 의 crl_floor 등, web_crippling 의 h3_* · row_used)는 그대로 온다."""
    from design.aisi_s100 import design_member
    from design.connections import design_connection
    from design.shear import web_crippling
    from engine.dsm import extract_dsm_values
    s = _srv()
    node, elem = _section()
    fl = {'member_type': 'flexure', 'design_method': 'LRFD', 'Fy': 50, 'Fu': 65, 'Lb': 60,
          'Mu': 20, 'props': _design_props(node, elem), 'section_type': 'C',
          'section': dict(_DESIGN_SECTION), 'span_type': 'cont-2', 'moment_sign': 'negative'}
    _same(s.call('aisi_design', fl), design_member(json.loads(json.dumps(fl))), 'aisi_design new')
    for extra in ({'member_case': 'not_tension_member'}, {'j6_3_not_applicable': True}):
        dc = {'connection_type': 'bolt', 't1': 0.059, 't2': 0.059, 'd': 0.5, 'Fy': 50, 'Fu': 65,
              'n': 2, 'Pu': 2, 'e': 1.5, 's': 1.5, 'design_method': 'LRFD', **extra}
        r = s.call('design_connection', dc)
        _same(r, design_connection(dict(dc)), f'design_connection {extra}')
    sn, se = _section(r=0.0, stress=50.0)
    an = s.call('analyze', _model(sn, se, _LENGTHS))
    d = s.call('dsm', {'node': sn, 'elem': se, 'curve': an['curve'], 'fy': 50, 'BC': 'S-S'})
    dd = _plain(extract_dsm_values(an['curve'], np.array(sn), np.array(se), 50, BC='S-S'))
    new_dsm = {'crl_floor', 'crd_floor', 'reference_is_restrained', 'P_ref_restrained',
               'single_minimum_bound_meaning', 'classification_note', 'assumptions', 'scope_notes'}
    assert new_dsm & set(dd), 'engine dsm has none of the F5 V2 keys'
    for k in new_dsm & set(dd):
        assert d[k] == dd[k], k
    wc = dict(h=7.5, t=0.059, R=0.1875, N=3.5, Fy=50)
    rw, dw = s.call('web_crippling', wc), _plain(web_crippling(**wc))
    for k in ('h3_applies', 'h3_equation', 'h3_evaluated', 'row_used'):
        if k in dw:
            assert rw[k] == dw[k], k



# 손으로 짠 어댑터가 넘기는 엔진 인자(+ 일부러 넘기지 않는 것과 까닭). 엔진이 인자를 더하면
# 이 표와 서버를 같이 고쳐야 시험이 통과한다 — 조용히 버려지는 인자가 생기지 않게.
_HAND_ADAPTERS = {
    'engine.fsm_solver.stripmain': ({'prop', 'node', 'elem', 'lengths', 'springs', 'constraints',
                                     'GBTcon', 'BC', 'm_all', 'neigs', 'half_wavelengths'}, set()),
    'engine.dsm.extract_dsm_values': ({'curve', 'node', 'elem', 'fy', 'load_type',
                                       'mode_classifications', 'KxLx', 'KyLy', 'KtLt', 'Lb',
                                       'Cb', 'section_type', 'BC', 'unsymm'},
                                      {'mode_shapes', 'classify_fn'}),   # 호출 가능 객체
    'engine.helpers.signature_ss': ({'prop', 'node', 'elem', 'neigs', 'GBTcon'}, set()),
    'engine.helpers.firstyield': ({'node', 'elem', 'fy', 'unsymm'}, set()),
    'engine.helpers.energy_recovery': ({'prop', 'node', 'elem', 'mode', 'L', 'm_a', 'BC'}, set()),
    'engine.helpers.m_recommend_details': ({'prop', 'node', 'elem', 'lengths'}, set()),
    'engine.helpers.doubler': ({'node', 'elem'}, set()),
    'engine.stress.yieldMP': ({'node', 'fy', 'A', 'xcg', 'zcg', 'Ixx', 'Izz', 'Ixz', 'thetap',
                               'I11', 'I22', 'unsymm'}, set()),
    'engine.stress.stresgen': ({'node', 'P', 'Mxx', 'Mzz', 'M11', 'M22', 'A', 'xcg', 'zcg',
                                'Ixx', 'Izz', 'Ixz', 'thetap', 'I11', 'I22', 'unsymm'}, set()),
    'engine.properties.grosprop': ({'node', 'elem'}, set()),
    'engine.cutwp.cutwp_prop': ({'node', 'elem'}, set()),
    'engine.template.generate_section': ({'section_type', 'params'}, set()),
    'cfsm.classify.classify': ({'prop', 'node', 'elem', 'lengths', 'shapes', 'GBTcon', 'BC',
                                'm_all'}, set()),
    'vibration.solver.stripmain_vib': ({'prop', 'node', 'elem', 'lengths', 'BC', 'm_all',
                                        'neigs', 'springs', 'constraints'}, set()),
    'fcfsm.solver.stripmain_fcfsm': ({'prop', 'node', 'elem', 'lengths', 'BC', 'm_all',
                                      'neigs'}, set()),
    'plastic.pmm_plastic.pmm_plastic': ({'node', 'elem', 'fy', 'n_theta', 'n_na',
                                         'n_fibers_per_elem', 'n_thick'}, set()),
    'design.loads.bracing.calc_rotational_stiffness': (
        {'t_panel', 't_purlin', 'fastener_spacing', 'flange_width', 'k_per_fastener', 'E',
         'b_fastener', 'c_fastener'}, set()),
    'design.loads.bracing.lateral_stiffness_detail': (
        {'t_panel', 't_purlin', 'fastener_spacing', 'E', 'Fss_kip', 'D_screw_in', 'Fu1_ksi',
         'Fu2_ksi'}, set()),
}


def test_W1_hand_written_adapters_cover_every_engine_argument():
    """W1 (3차 점검): 손으로 짠 어댑터의 엔진 함수 서명 = 서버가 넘기는 인자 + 일부러 넘기지 않는 인자. 서명 검사 어댑터(_call_kw)와 dict 메서드는 정의상 전부 넘긴다."""
    import importlib
    import inspect
    for path, (forwarded, withheld) in _HAND_ADAPTERS.items():
        mod, name = path.rsplit('.', 1)
        sig = set(inspect.signature(getattr(importlib.import_module(mod), name)).parameters)
        assert sig == forwarded | withheld, (path, sorted(sig - forwarded - withheld),
                                             sorted((forwarded | withheld) - sig))
