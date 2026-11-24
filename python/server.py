"""JSON-RPC 서버 — Extension Host와 stdin/stdout 통신

참조: 컨버전전략.md §5.2 Python 해석 엔진

프로토콜: 한 줄에 JSON 객체 하나.
    요청  {"method": str, "params": object, "id": int|str|null}
    응답  {"id", "result"}  또는  {"id", "error": str, "error_code": str[, "error_type", "traceback"]}

- 줄마다 응답이 꼭 하나 나간다. 깨진 줄 · 객체가 아닌 JSON · 모르는 메서드 · 엔진 예외 ·
  직렬화할 수 없는 결과는 그 요청의 오류 응답이 되고 서버는 계속 돈다.
- 결과의 NaN · ±Inf 는 스칼라든 배열 안이든 null 이다(0.0 이나 맨 토큰 NaN 이 아님).
- stdout 에는 JSON-RPC 응답만 나간다. 엔진의 print · C 확장의 출력은 stderr 로 간다.
- 메서드는 엔진 함수의 얇은 어댑터다: 엔진이 받는 인자를 모두 넘기고, 서버가 기본값을
  지어내지 않으며, 엔진이 돌려준 키(warnings · diagnostics · 미평가 목록)를 모두 돌려준다.
  계약표는 docs/reviews/20261122-engine-review/fixes/W1-server.md.
"""

import contextlib
import inspect
import json
import math
import os
import re
import sys
import traceback

import numeric_threads  # noqa: F401 — numpy 보다 먼저: BLAS 스레드 1 (V8-04)
import numpy as np

from engine.fsm_solver import stripmain
from engine.properties import grosprop
from engine.template import generate_section
from engine.stress import stresgen, yieldMP
from engine.dsm import extract_dsm_values
from engine.helpers import doubler, signature_ss, firstyield, m_recommend_details
from engine.cutwp import cutwp_prop
from cfsm.classify import classify
from vibration.solver import stripmain_vib
from fcfsm.solver import stripmain_fcfsm
from plastic.pmm_plastic import pmm_plastic
from fileio.mat_loader import read_mat_file
from fileio.project_io import save_project, read_project
from models.data import CufsmModel, GBTConfig, curve_rows_to_lists
from design.notices import N as _nt, attach as attach_notices, NOTICE_LISTS  # noqa: E402

PROTOCOL_VERSION = 2

# --------------------------------------------------------------------------- 엔진 식별(engine_id)
# 저장한 결과(.csd)가 어느 엔진의 것인지 — 손으로 올리는 번호는 잊힌다. 결과에 영향을 줄 수 있는 엔진 소스
# 전부의 sha256. 같은 소스면 실행 · 기계 · 줄끝(CRLF/LF)과 무관하게 같고, 한 바이트라도 바뀌면 다르다.
# 한 파일이라도 읽지 못하거나 폴더가 없으면 'unknown' — 일부만으로 만든 해시를 내지 않는다.
ENGINE_ID_DIRS = ('engine', 'design', 'cfsm', 'fcfsm', 'vibration', 'plastic', 'fileio', 'models')
ENGINE_ID_FILES = ('server.py', 'numeric_threads.py')
ENGINE_ID_SCHEME = 'engine-id/2'


def _engine_sources(root: str) -> list:
    """[(상대 경로 'design/checks.py', 바이트)] — 정렬. __pycache__ · 시험 파일은 뺀다. 못 읽으면 OSError."""
    items = []
    for d in ENGINE_ID_DIRS:
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            raise OSError(f'engine source folder missing: {d}/')
        found = 0
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(x for x in dirnames if x != '__pycache__' and x not in ('test', 'tests'))
            for f in filenames:
                if not f.endswith('.py') or f.startswith('test_'):
                    continue
                full = os.path.join(dirpath, f)
                rel = os.path.relpath(full, root).replace(os.sep, '/')
                with open(full, 'rb') as fh:
                    items.append((rel, fh.read()))
                found += 1
        if not found:
            raise OSError(f'no .py source in {d}/ (compiled-only layout?)')
    for f in ENGINE_ID_FILES:
        with open(os.path.join(root, f), 'rb') as fh:
            items.append((f, fh.read()))
    return sorted(items)


def engine_runtime() -> dict:
    """결과가 기대는 수치 라이브러리 판과 Python major.minor — 개발 환경이 바뀌면 id 도 바뀐다."""
    out = {'python': f'{sys.version_info[0]}.{sys.version_info[1]}', 'numpy': getattr(np, '__version__', 'unknown')}
    try:
        import scipy
        out['scipy'] = getattr(scipy, '__version__', 'unknown')
    except Exception:  # noqa: BLE001 — 없으면 없다고 해시에 넣는다
        out['scipy'] = 'absent'
    return out


def engine_id_of(items, runtime: dict | None = None) -> str:
    """'sha256:<64 hex>' — 판 정보(runtime), 그다음 경로와 (줄끝을 LF 로 맞춘) 내용을 길이와 함께 차례로 넣는다."""
    import hashlib
    runtime = engine_runtime() if runtime is None else runtime
    h = hashlib.sha256(ENGINE_ID_SCHEME.encode('ascii') + b'\n')
    for k in sorted(runtime):
        h.update(f'{k}={runtime[k]}'.encode('utf-8') + b'\n')
    for rel, data in sorted(items):
        body = data.replace(b'\r\n', b'\n')
        path = rel.encode('utf-8')
        h.update(len(path).to_bytes(4, 'big') + path + len(body).to_bytes(8, 'big') + body)
    return 'sha256:' + h.hexdigest()


def compute_engine_id(root: str | None = None, runtime: dict | None = None) -> tuple:
    """(engine_id, error) — 읽지 못하면 ('unknown', 까닭)."""
    root = root or os.path.dirname(os.path.abspath(__file__))
    try:
        return engine_id_of(_engine_sources(root), runtime), None
    except Exception as e:  # noqa: BLE001 — 어떤 실패든 'unknown'
        return 'unknown', f'{type(e).__name__}: {e}'


ENGINE_ID, ENGINE_ID_ERROR = compute_engine_id()

# 결과에서 순서가 뜻이 없는 목록(엔진이 set 으로 모은 것). 해시 시드와 무관한 출력을 위해 정렬한다.
_UNORDERED_LIST_KEYS = frozenset({'spec_sections'})

# 해석 모델(CufsmModel)에서 꼭 있어야 하는 키. springs · constraints · GBTcon · neigs 는
# 없으면 "없음"(빈 배열, 구속 해석 꺼짐, 엔진 기본 neigs=10)이다.
_MODEL_REQUIRED = ('prop', 'node', 'elem', 'lengths', 'BC')


class RpcError(Exception):
    """요청 자체가 잘못된 경우(필수 인자 없음, 모양 오류) — 엔진 예외와 구별한다."""

    def __init__(self, message: str, code: str = 'INVALID_PARAMS'):
        super().__init__(message)
        self.code = code


# --------------------------------------------------------------------------- JSON 변환

def _json_key(k, path):
    if isinstance(k, str):
        return k
    if isinstance(k, (bool, np.bool_)):
        return 'true' if k else 'false'
    if k is None:
        return 'null'
    if isinstance(k, (int, np.integer)):
        return str(int(k))
    if isinstance(k, (float, np.floating)):
        return repr(float(k))
    raise TypeError(f'dict key of type {type(k).__name__} at {path} is not JSON serialisable')


def to_jsonable(obj, path='result', _key=None):
    """엔진 결과를 순수 JSON 값으로 바꾼다.

    numpy 스칼라 · 배열을 파이썬 값으로, 유한하지 않은 실수를 None 으로, set 을 정렬된
    목록으로 바꾼다. 복소수처럼 뜻을 잃지 않고 바꿀 수 없는 값은 TypeError(경로 포함).
    """
    if obj is None or isinstance(obj, (str, bool)):
        return obj
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, (complex, np.complexfloating)):
        raise TypeError(f'complex value {obj!r} at {path} is not JSON serialisable')
    if isinstance(obj, dict):
        return {_json_key(k, path): to_jsonable(v, f'{path}.{k}', k) for k, v in obj.items()}
    if isinstance(obj, np.ndarray):
        if obj.dtype.kind == 'c':
            raise TypeError(f'complex array at {path} is not JSON serialisable')
        return to_jsonable(obj.tolist(), path, _key)
    if isinstance(obj, (set, frozenset)):
        items = [to_jsonable(v, f'{path}[]') for v in obj]
        try:
            return sorted(items)
        except TypeError:
            return sorted(items, key=lambda v: json.dumps(v, sort_keys=True))
    if isinstance(obj, (list, tuple)):
        out = [to_jsonable(v, f'{path}[{i}]') for i, v in enumerate(obj)]
        if _key in _UNORDERED_LIST_KEYS and all(isinstance(v, str) for v in out):
            out = sorted(out)
        return out
    raise TypeError(f'value of type {type(obj).__name__} at {path} is not JSON serialisable')


def encode_response(response: dict) -> str:
    """응답 dict → 한 줄 JSON. 실패하면 같은 id 의 직렬화 오류 응답을 만든다."""
    try:
        return json.dumps(to_jsonable(response, 'response'), allow_nan=False)
    except Exception as e:  # noqa: BLE001 — 어떤 실패든 오류 응답으로 바꾼다
        rid = response.get('id') if isinstance(response, dict) else None
        if not isinstance(rid, (int, str)) or isinstance(rid, bool):
            rid = None
        return json.dumps({'id': rid, 'error': f'serialization: {e}',
                           'error_code': 'SERIALIZATION_ERROR'})


# --------------------------------------------------------------------------- 인자 도우미

def _require(params: dict, method: str, *keys):
    missing = [k for k in keys if params.get(k) is None]
    if missing:
        raise RpcError(f"{method}: missing required parameter(s): {', '.join(missing)}")


def _array(params: dict, key: str, method: str) -> np.ndarray:
    _require(params, method, key)
    try:
        return np.array(params[key], dtype=float)
    except (TypeError, ValueError) as e:
        raise RpcError(f'{method}: {key} must be a numeric array ({e})') from e


def _node_elem(params: dict, method: str):
    return _array(params, 'node', method), _array(params, 'elem', method)


def _optional(params: dict, *keys) -> dict:
    """주어진(None 이 아닌) 선택 인자만 넘긴다 — 빠진 것은 엔진 기본값을 쓴다."""
    return {k: params[k] for k in keys if params.get(k) is not None}


def _add_notes(result: dict, key: str, notes) -> dict:
    """서버의 알림을 결과의 warnings / assumptions 끝에 붙인다. 엔진이 준 항목은 그대로 둔다.

    warnings: 서버가 값을 바꿨거나(길이 폐기, 입력 무시) 사용자가 볼 일이 있는 것.
    assumptions: 값을 바꾸지 않은 참고(자동으로 고른 항의 규칙 등).
    """
    notes = [n for n in (notes or []) if n]
    if not notes:
        return result
    result = dict(result)
    cur = result.get(key)
    if cur is None:
        result[key] = list(notes)
    elif isinstance(cur, list):
        result[key] = list(cur) + list(notes)
    else:   # 엔진이 목록이 아닌 값을 둔 키는 덮지 않는다
        result[f'server_{key}'] = list(notes)
    return result


def _note_ignored(result, unknown: list, method: str):
    """엔진이 받지 않는 인자는 버리지 않고 결과에 드러낸다(입력이 쓰이지 않았으므로 warnings)."""
    if not unknown:
        return result
    if not isinstance(result, dict):
        raise RpcError(f"{method}: unknown parameter(s): {', '.join(unknown)}")
    result = dict(result)
    result['ignored_params'] = list(unknown)
    return _add_notes(result, 'warnings',
                      [f"server: parameter(s) not used by {method}: {', '.join(unknown)}"])


def _call_kw(fn, params: dict, method: str):
    """키워드 인자 엔진 함수를 그대로 부른다: 필수 인자 확인, 모르는 인자 보고, 기본값 없음."""
    sig = inspect.signature(fn)
    names = [n for n, p in sig.parameters.items()
             if p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)]
    missing = [n for n in names
               if sig.parameters[n].default is inspect.Parameter.empty and params.get(n) is None]
    if missing:
        raise RpcError(f"{method}: missing required parameter(s): {', '.join(missing)}")
    unknown = sorted(k for k in params if k not in names)
    kwargs = {k: v for k, v in params.items() if k in names}
    return _note_ignored(fn(**kwargs), unknown, method)


def _model_from(params: dict, method: str, *, need_m_all: bool = True) -> CufsmModel:
    _require(params, method, *_MODEL_REQUIRED)
    d = dict(params)
    if not need_m_all:
        d.pop('m_all', None)
    try:
        return CufsmModel.from_dict(d)
    except (TypeError, ValueError) as e:
        raise RpcError(f'{method}: {e}') from e


def _resolve_m_all(params: dict, model: CufsmModel, method: str, *, allow_auto: bool):
    """종방향 항을 정한다. 호출자가 준 목록은 그대로 쓴다(엔진이 msort 만 한다).

    'auto' 는 명시적 자동 요청이다: S-S 는 길이마다 [1](S-S 에서는 항이 서로 묶이지 않음),
    그 밖의 BC 는 engine.helpers.m_recommend 의 권장 항. 빠지면 지어내지 않고 거절한다.
    """
    req = params.get('m_all')
    n = len(model.lengths)
    if isinstance(req, str):
        if not allow_auto or req.strip().lower() != 'auto':
            raise RpcError(f"{method}: m_all must be a list of term lists"
                           + (" or the string 'auto'" if allow_auto else ''))
        if str(model.BC).strip() == 'S-S':
            return [np.array([1.0]) for _ in range(n)], {
                'source': 'auto', 'BC': model.BC,
                'rule': 'S-S: one term m=[1] per length (terms do not couple for S-S)',
                'warnings': []}
        det = m_recommend_details(model.prop, model.node, model.elem, model.lengths)
        lcr = ', '.join(f'{k}={det[k]:.4g} in' for k in ('Lcrl', 'Lcrd')
                        if isinstance(det.get(k), (int, float)))
        return [np.asarray(m, dtype=float) for m in det['m_all']], {
            'source': 'm_recommend', 'BC': model.BC,
            'rule': ('engine.helpers.m_recommend (Lcrl / Lcrd from the S-S signature curve'
                     + (f'; {lcr}' if lcr else '') + f"; method={det.get('method')})"),
            # m_recommend_details 의 키 전부(m_all 은 결과의 m_all 과 같으므로 뺀다)
            **{k: v for k, v in det.items() if k not in ('m_all', 'warnings')},
            'warnings': list(det.get('warnings') or []),
            # stripmain 의 항 부족 진단이 서명곡선을 다시 풀지 않게 넘긴다(호출자에게는 안 감).
            '_half_wavelengths': det}
    if req is None or (isinstance(req, list) and len(req) == 0):
        raise RpcError(
            f"{method}: m_all is required — give one list of longitudinal terms per length"
            + (", or m_all='auto' (S-S: [1] per length; other BC: engine m_recommend, "
               "also available as the m_recommend method)" if allow_auto else ''))
    try:
        return [np.array(m, dtype=float).reshape(-1) for m in req], {
            'source': 'caller', 'BC': model.BC, 'warnings': []}
    except (TypeError, ValueError) as e:
        raise RpcError(f'{method}: m_all must be a list of numeric term lists ({e})') from e


def _gbtcon(value):
    if value is None:
        return None
    if isinstance(value, GBTConfig):
        return value
    if not isinstance(value, dict):
        raise RpcError('GBTcon must be an object')
    return GBTConfig.from_dict(value)


# --------------------------------------------------------------------------- 긴 길이 폐기

def _drop_discarded_lengths(curve, shapes, m_all, lengths, diagnostics):
    """ILL_CONDITIONED 로 폐기된 길이(0 행)를 곡선에서 빼고 해석은 살린다(사용자 결정).

    다른 실패(NO_FREE_DOF 등)는 그대로 해석 실패다. 진단은 숨기지 않고 'discarded' 를
    붙여 남긴다. 남는 행의 원래 색인은 length_indices 로 준다(진단의 length_index 와 대응).
    """
    def _is_discard(d):
        return (d.get('code') == 'ILL_CONDITIONED' and d.get('severity') == 'error'
                and d.get('length_index') is not None)

    drop = {int(d['length_index']) for d in diagnostics if _is_discard(d)}
    keep = [i for i in range(len(curve)) if i not in drop]
    diags = [dict(d, discarded=True) if _is_discard(d) else d for d in diagnostics]
    discarded = [{'length_index': int(d['length_index']), 'length': d.get('length'),
                  'code': d['code'], 'error_estimate': d.get('error_estimate'),
                  'message': d.get('message')} for d in diags if d.get('discarded')]
    warnings = [d.get('message') or d.get('code') for d in diags if d.get('severity') == 'warning']
    warnings += [f"Length {x['length']:g} removed from the curve: {x['message']}"
                 for x in discarded if x.get('length') is not None]
    if not keep:
        diags.append({'severity': 'error', 'code': 'ALL_LENGTHS_DISCARDED',
                      'length_index': None, 'length': None,
                      'message': _nt('server.warning.every_analysis_length_was')})
    other_error = any(d.get('severity') == 'error' and not d.get('discarded') for d in diags)

    def _pick(seq):
        return [seq[i] for i in keep] if seq is not None and len(seq) == len(curve) else seq

    return {
        'curve': [curve[i] for i in keep],
        'shapes': _pick(shapes),
        'm_all': _pick(m_all),
        'lengths': [float(lengths[i]) for i in keep],
        'length_indices': keep,
        'lengths_requested': [float(x) for x in lengths],
        'discarded_lengths': discarded,
        'n_lengths': len(keep),
        'diagnostics': diags,
        'warnings': warnings,
        'success': bool(keep) and not other_error,
    }


# --------------------------------------------------------------------------- 메서드

def _m_ping(params):
    return 'pong'


def _m_selftest(params):
    errors = {}
    for mod in ('design.aisi_s100', 'design.connections', 'design.lap_connection',
                'design.special_topics', 'design.shear', 'design.steel_grades',
                'design.loads.required_strength', 'design.loads.bracing'):
        try:
            __import__(mod)
        except Exception as e:  # noqa: BLE001
            errors[mod] = f'{type(e).__name__}: {e}'
    py_ok = sys.version_info >= (3, 10)
    return {'ok': py_ok and not errors, 'python': sys.version.split()[0],
            'python_ok': py_ok, 'import_errors': errors,
            'protocol_version': PROTOCOL_VERSION, 'engine_id': ENGINE_ID, 'engine_runtime': engine_runtime(),
            'numeric_threads': numeric_threads.status(),
            **({'engine_id_error': ENGINE_ID_ERROR} if ENGINE_ID_ERROR else {}),
            'methods': sorted(METHODS)}


def _m_analyze(params):
    model = _model_from(params, 'analyze', need_m_all=False)
    m_all, selection = _resolve_m_all(params, model, 'analyze', allow_auto=True)
    det = selection.pop('_half_wavelengths', None)
    result = stripmain(prop=model.prop, node=model.node, elem=model.elem,
                       lengths=model.lengths, springs=model.springs,
                       constraints=model.constraints, GBTcon=model.GBTcon,
                       BC=model.BC, m_all=m_all, neigs=model.neigs,
                       **({'half_wavelengths': det} if det is not None else {}))
    res = result.to_dict()
    out = _drop_discarded_lengths(res['curve'], res['shapes'], res['m_all'],
                                  model.lengths, res['diagnostics'])
    out['warnings'] = list(selection.get('warnings') or []) + out['warnings']
    out['assumptions'] = _selection_assumptions(selection)
    out['m_all_selection'] = selection
    return out


def _selection_assumptions(selection: dict) -> list:
    """자동으로 고른 항은 값을 지어낸 것이 아니라 요청받은 규칙이다 — assumptions 에 적는다."""
    if selection.get('source') in (None, 'caller'):
        return []
    return [f"m_all chosen automatically ({selection['source']}): {selection.get('rule')}"]


def _m_m_recommend(params):
    node, elem = _node_elem(params, 'm_recommend')
    prop = _array(params, 'prop', 'm_recommend')
    lengths = _array(params, 'lengths', 'm_recommend')
    return m_recommend_details(prop, node, elem, lengths)


def _m_get_properties(params):
    node, elem = _node_elem(params, 'get_properties')
    return grosprop(node, elem)


def _m_generate_section(params):
    _require(params, 'generate_section', 'section_type', 'params')
    if not isinstance(params['params'], dict):
        raise RpcError('generate_section: params must be an object')
    return generate_section(params['section_type'], dict(params['params']))


def _m_stresgen(params):
    node = _array(params, 'node', 'stresgen')
    _require(params, 'stresgen', 'props')
    props = params['props']
    loads = params.get('loads') or {}
    if not isinstance(props, dict) or not isinstance(loads, dict):
        raise RpcError('stresgen: props and loads must be objects')
    need = ('A', 'xcg', 'zcg', 'Ixx', 'Izz', 'Ixz', 'thetap', 'I11', 'I22')
    missing = [k for k in need if props.get(k) is None]
    if missing:
        raise RpcError(f"stresgen: props is missing {', '.join(missing)}")
    # 빠진 하중 성분은 "그 하중 없음" = 0 이다(서버가 정하는 유일한 값).
    node = stresgen(
        node, P=loads.get('P', 0), Mxx=loads.get('Mxx', 0), Mzz=loads.get('Mzz', 0),
        M11=loads.get('M11', 0), M22=loads.get('M22', 0),
        **{k: props[k] for k in need}, unsymm=loads.get('unsymm', 0))
    return {'node': node}


def _m_yieldMP(params):
    node, elem = _node_elem(params, 'yieldMP')
    _require(params, 'yieldMP', 'fy')
    props = grosprop(node, elem)
    return yieldMP(node, float(params['fy']), props['A'], props['xcg'], props['zcg'],
                   props['Ixx'], props['Izz'], props['Ixz'], props['thetap'],
                   props['I11'], props['I22'], **_optional(params, 'unsymm'))


def _m_firstyield(params):
    node, elem = _node_elem(params, 'firstyield')
    _require(params, 'firstyield', 'fy')
    return firstyield(node, elem, float(params['fy']), **_optional(params, 'unsymm'))


def _classify(params, method):
    _require(params, method, 'model', 'shapes')
    mparams = params['model']
    if not isinstance(mparams, dict):
        raise RpcError(f'{method}: model must be an object')
    mparams = dict(mparams)
    # 해석이 폐기한 길이를 뺀 lengths · 실제로 쓴 m_all 을 따로 줄 수 있다(analyze 결과 그대로).
    for k in ('lengths', 'm_all'):
        if params.get(k) is not None:
            mparams[k] = params[k]
    model = _model_from(mparams, method, need_m_all=False)
    m_all, _ = _resolve_m_all(mparams, model, method, allow_auto=False)
    shapes = [np.array(s, dtype=float) for s in params['shapes']]
    if len(shapes) != len(model.lengths):
        raise RpcError(
            f'{method}: {len(shapes)} mode-shape sets for {len(model.lengths)} lengths — pass '
            'the lengths and m_all returned by analyze (lengths removed as ill-conditioned '
            'are not in shapes)')
    gbt = _gbtcon(params.get('GBTcon')) or model.GBTcon
    return classify(model.prop, model.node, model.elem, model.lengths, shapes,
                    gbt, model.BC, m_all)


def _m_classify(params):
    return [c.tolist() for c in _classify(params, 'classify')]


def _m_classify_detailed(params):
    clas = _classify(params, 'classify_detailed')
    summary = clas.summary() if hasattr(clas, 'summary') else {}
    return {'classification': [c.tolist() for c in clas], **summary}


def _m_fcfsm(params):
    model = _model_from(params, 'fcfsm', need_m_all=False)
    m_all, selection = _resolve_m_all(params, model, 'fcfsm', allow_auto=True)
    selection.pop('_half_wavelengths', None)   # stripmain_fcfsm 은 받지 않는다
    result = dict(stripmain_fcfsm(model.prop, model.node, model.elem, model.lengths,
                                  model.BC, m_all, model.neigs))
    result['curve'] = curve_rows_to_lists(result['curve'])
    result['classification'] = [np.asarray(c).tolist() for c in result['classification']]
    result['n_lengths'] = len(result['curve'])
    result['m_all_selection'] = selection
    result = _add_notes(result, 'warnings', selection.get('warnings'))
    return _add_notes(result, 'assumptions', _selection_assumptions(selection))


def _m_vibration(params):
    model = _model_from(params, 'vibration', need_m_all=False)
    m_all, _ = _resolve_m_all(params, model, 'vibration', allow_auto=False)
    vib_prop = model.prop.copy()
    rho = params.get('rho')
    if rho is not None:
        rho = float(rho)
        if not (rho > 0 and math.isfinite(rho)):
            raise RpcError('vibration: rho must be a positive mass density (kip*s^2/in^4)')
        if vib_prop.shape[1] <= 6:
            vib_prop = np.column_stack([vib_prop, np.full(vib_prop.shape[0], rho)])
        else:
            vib_prop[:, 6] = rho
    return stripmain_vib(
        vib_prop, model.node, model.elem, model.lengths, model.BC, m_all,
        neigs=model.neigs,
        springs=model.springs if model.springs.size > 0 else None,
        constraints=model.constraints if model.constraints.size > 0 else None)


def _m_plastic(params):
    node, elem = _node_elem(params, 'plastic')
    _require(params, 'plastic', 'fy')
    result = dict(pmm_plastic(node, elem, float(params['fy']),
                              **_optional(params, 'n_theta', 'n_na',
                                          'n_fibers_per_elem', 'n_thick')))
    # 곡면 격자 (n_na, n_theta) 는 지금까지처럼 행 우선으로 펼쳐 보낸다.
    for k in ('P', 'M11', 'M22', 'P_raw', 'M11_raw', 'M22_raw'):
        if isinstance(result.get(k), np.ndarray):
            result[k] = result[k].flatten()
    return result


def _m_load_mat(params):
    _require(params, 'load_mat', 'filepath')
    model, info = read_mat_file(params['filepath'])
    return {**model.to_dict(), 'file_info': info}


def _m_save_project(params):
    _require(params, 'save_project', 'model', 'filepath')
    if not isinstance(params['model'], dict):
        raise RpcError('save_project: model must be an object')
    model = _model_from(params['model'], 'save_project', need_m_all=True)
    save_project(model, params['filepath'])
    return 'saved'


def _m_load_project(params):
    _require(params, 'load_project', 'filepath')
    model, info = read_project(params['filepath'])
    return {**model.to_dict(), 'file_info': info}


def _m_doubler(params):
    node, elem = _node_elem(params, 'doubler')
    n_out, e_out = doubler(node, elem)
    return {'node': n_out, 'elem': e_out}


def _m_signature_ss(params):
    node, elem = _node_elem(params, 'signature_ss')
    prop = _array(params, 'prop', 'signature_ss')
    gbt = _gbtcon(params.get('GBTcon'))
    kw = _optional(params, 'neigs')
    if gbt is not None:
        kw['GBTcon'] = gbt
    result = signature_ss(prop, node, elem, **kw)
    out = _drop_discarded_lengths(curve_rows_to_lists(result['curve']), result.get('shapes'),
                                  None, result['lengths'], result.get('diagnostics') or [])
    out.pop('m_all', None)
    unused = [k for k in ('springs', 'constraints') if np.size(params.get(k) or []) > 0]
    if unused:
        out['warnings'].append(
            _nt('server.warning.signature_ss_used_cufsm', unused=', '.join(unused)))
    out['assumptions'] = []
    return out


def _m_dsm(params):
    node, elem = _node_elem(params, 'dsm')
    _require(params, 'dsm', 'curve', 'fy')
    if params.get('classifications') is not None and params.get('mode_classifications') is not None:
        raise RpcError('dsm: give classifications or mode_classifications, not both')
    clas = params.get('classifications', params.get('mode_classifications'))
    global_keys = [k for k in ('KxLx', 'KyLy', 'KtLt', 'Lb') if params.get(k) is not None]
    if global_keys and params.get('section_type') is None:
        # 폐형식 전체좌굴은 단면 형식에 따라 식이 다르다(Z 의 F2.1.3 /2, E2.3) — 'C' 로 짐작하지 않는다.
        raise RpcError(f"dsm: section_type is required when {', '.join(global_keys)} "
                       'is given (closed-form global buckling depends on the section type)')
    result = extract_dsm_values(
        params['curve'], node, elem, float(params['fy']),
        mode_classifications=clas,
        **_optional(params, 'load_type', 'KxLx', 'KyLy', 'KtLt', 'Lb', 'Cb',
                    'section_type', 'BC', 'unsymm'))
    if params.get('BC') is None:
        result = _add_notes(result, 'warnings', [_nt('server.warning.dsm_bc_not_given')])
    return result


def _m_cutwp(params):
    node, elem = _node_elem(params, 'cutwp')
    return cutwp_prop(node, elem)


def _m_energy_recovery(params):
    from engine.helpers import energy_recovery
    node, elem = _node_elem(params, 'energy_recovery')
    prop = _array(params, 'prop', 'energy_recovery')
    mode = _array(params, 'mode', 'energy_recovery')
    _require(params, 'energy_recovery', 'length')
    kw = _optional(params, 'BC')
    if params.get('m_a') is not None:
        kw['m_a'] = _array(params, 'm_a', 'energy_recovery')
    se = energy_recovery(prop, node, elem, mode, float(params['length']), **kw)
    return {'energy': se, 'columns': ['membrane', 'bending'], 'n_elements': len(se)}


def _dict_engine(import_path: str, name: str):
    def handler(params):
        mod = __import__(import_path, fromlist=[name])
        return getattr(mod, name)(dict(params))
    return handler


def _sort_unordered(obj):
    """엔진이 set 으로 모은 목록(spec_sections)을 제자리에서 정렬한다."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in _UNORDERED_LIST_KEYS and isinstance(v, list) and all(isinstance(s, str) for s in v):
                v.sort()
            else:
                _sort_unordered(v)
    elif isinstance(obj, list):
        for v in obj:
            _sort_unordered(v)


def _m_aisi_design(params):
    from design.aisi_s100 import design_member, generate_report
    eparams = dict(params)
    result = design_member(eparams)
    if isinstance(result, dict):
        _sort_unordered(result)
        # 보고서의 "Specification: §…" 줄이 set 순서(해시 시드)를 따르지 않게 같은 함수로 다시 쓴다.
        if isinstance(result.get('report'), str):
            result['report'] = generate_report(result, eparams)
    return result


def _kw_engine(import_path: str, name: str, method: str):
    def handler(params):
        mod = __import__(import_path, fromlist=[name])
        return _call_kw(getattr(mod, name), params, method)
    return handler


def _m_steel_grades(params):
    from design.steel_grades import list_grades
    return _call_kw(list_grades, params, 'steel_grades')


def _m_calc_deck_stiffness(params):
    from design.loads.bracing import calc_rotational_stiffness, lateral_stiffness_detail
    method = 'calc_deck_stiffness'
    known = {'t_panel', 't_purlin', 'fastener_spacing', 'flange_width', 'kphi_override',
             'kx_override', 'k_per_fastener', 'E', 'b_fastener', 'c_fastener',
             'Fss_kip', 'D_screw_in', 'Fu1_ksi', 'Fu2_ksi'}
    unknown = sorted(k for k in params if k not in known)
    warnings = []      # 값을 대신 정했거나(기본 패스너 값, 0) 적용 범위 밖
    assumptions = []   # 값을 바꾸지 않은 참고

    def _override(key):
        v = params.get(key)
        if v is None:
            return None
        v = float(v)
        if not (v > 0 and math.isfinite(v)):
            raise RpcError(f'{method}: {key} must be a positive tested stiffness')
        return v

    kphi_o, kx_o = _override('kphi_override'), _override('kx_override')
    shared = _optional(params, 'fastener_spacing', 'E')
    if kphi_o is None:
        _require(params, method, 't_panel', 't_purlin')
        kphi = calc_rotational_stiffness(
            params['t_panel'], params['t_purlin'],
            **shared, **_optional(params, 'flange_width', 'k_per_fastener',
                                  'b_fastener', 'c_fastener'))
        if not kphi > 0:
            warnings.append(_nt('server.warning.kphi_thickness_spacing_flange'))
    else:
        kphi = kphi_o
    kx_detail = None
    if kx_o is None:
        _require(params, method, 't_panel', 't_purlin')
        kx_detail = lateral_stiffness_detail(
            params['t_panel'], params['t_purlin'],
            **shared, **_optional(params, 'Fss_kip', 'D_screw_in', 'Fu1_ksi', 'Fu2_ksi'))
        kx = kx_detail['kx']
        if kx_detail.get('defaulted'):
            warnings.append(_nt('server.warning.kx_fastener_values_given', defaulted=', '.join(kx_detail['defaulted'])))
        # 엔진 notes 는 kx_detail 에 그대로 있다. 범위 밖 · 0 처리는 사용자가 볼 일, 나머지는 참고.
        for note in kx_detail.get('notes') or []:
            attention = 'outside' in note or 'taken as 0' in note
            (warnings if attention else assumptions).append(note)
    else:
        kx = kx_o
    guidance = ('Use project-specific connection/panel test stiffness overrides '
                'when available.')
    if kphi_o is None or kx_o is None:
        assumptions.append(guidance)
    result = {
        'kphi': kphi,
        'kx': kx,
        'kphi_method': 'test_override' if kphi_o is not None else 'gao_moen_2011_example_II_1C',
        'kx_method': 'test_override' if kx_o is not None else 'rp17_2_curve_fit_example_II_1C',
        'kx_detail': kx_detail,
        'units': {'kphi': 'kip-in/rad/in', 'kx': 'kip/in/in'},
        'warnings': warnings,
        'assumptions': assumptions,
        # 옛 단일 문자열 키(호환): 시험값을 둘 다 주지 않았으면 안내문.
        'warning': guidance if (kphi_o is None or kx_o is None) else None,
    }
    return _note_ignored(result, unknown, method)


METHODS = {
    'ping': _m_ping,
    'selftest': _m_selftest,
    'analyze': _m_analyze,
    'm_recommend': _m_m_recommend,
    'get_properties': _m_get_properties,
    'generate_section': _m_generate_section,
    'stresgen': _m_stresgen,
    'yieldMP': _m_yieldMP,
    'firstyield': _m_firstyield,
    'classify': _m_classify,
    'classify_detailed': _m_classify_detailed,
    'fcfsm': _m_fcfsm,
    'vibration': _m_vibration,
    'plastic': _m_plastic,
    'load_mat': _m_load_mat,
    'save_project': _m_save_project,
    'load_project': _m_load_project,
    'doubler': _m_doubler,
    'signature_ss': _m_signature_ss,
    'dsm': _m_dsm,
    'cutwp': _m_cutwp,
    'energy_recovery': _m_energy_recovery,
    'aisi_design': _m_aisi_design,
    'aisi_guide': _dict_engine('design.aisi_s100', 'design_guide'),
    'steel_grades': _m_steel_grades,
    'web_crippling': _kw_engine('design.shear', 'web_crippling', 'web_crippling'),
    'analyze_loads': _kw_engine('design.loads.required_strength', 'analyze_loads',
                                'analyze_loads'),
    'calc_deck_stiffness': _m_calc_deck_stiffness,
    'lap_connection': _dict_engine('design.lap_connection', 'design_lap_connection'),
    'check_lap_length': _kw_engine('design.lap_connection', 'check_lap_length',
                                   'check_lap_length'),
    'shear_lag': _kw_engine('design.special_topics', 'shear_lag', 'shear_lag'),
    'block_shear': _kw_engine('design.special_topics', 'block_shear', 'block_shear'),
    'cold_work': _kw_engine('design.special_topics', 'cold_work_strength', 'cold_work'),
    'flange_curling': _kw_engine('design.special_topics', 'flange_curling', 'flange_curling'),
    'design_connection': _dict_engine('design.connections', 'design_connection'),
}


# --------------------------------------------------------------------------- 요청 처리

def _clean_id(rid):
    if rid is None or isinstance(rid, str) or (isinstance(rid, int) and not isinstance(rid, bool)):
        return rid
    return None


def _error(rid, message, code, exc=None):
    out = {'id': rid, 'error': message, 'error_code': code}
    if exc is not None:
        out['error_type'] = type(exc).__name__
        out['traceback'] = traceback.format_exc()
    return out


def handle_request(request) -> dict:
    """JSON-RPC 요청 하나를 처리해 순수 JSON 값으로 된 응답 dict 를 돌려준다."""
    if not isinstance(request, dict):
        return _error(None, f'Invalid request: expected a JSON object, got {type(request).__name__}',
                      'INVALID_REQUEST')
    rid = _clean_id(request.get('id'))
    method = request.get('method')
    params = request.get('params')
    if params is None:
        params = {}
    if not isinstance(method, str):
        return _error(rid, 'Invalid request: method must be a string', 'INVALID_REQUEST')
    if not isinstance(params, dict):
        return _error(rid, f'Invalid params for {method}: expected a JSON object', 'INVALID_PARAMS')
    handler = METHODS.get(method)
    if handler is None:
        return _error(rid, f'Unknown method: {method}', 'METHOD_NOT_FOUND')
    try:
        # 엔진이 print 해도 응답 채널(stdout)에 섞이지 않게 한다.
        with contextlib.redirect_stdout(sys.stderr):
            result = handler(params)
    except RpcError as e:
        return _error(rid, str(e), e.code)
    except Exception as e:  # noqa: BLE001 — 엔진 예외는 그 요청의 오류다
        return _error(rid, str(e) or type(e).__name__, 'ENGINE_ERROR', e)
    try:
        if isinstance(result, dict) and any(k in result for k in NOTICE_LISTS):
            attach_notices(result)
        return {'id': rid, 'result': to_jsonable(result)}
    except Exception as e:  # noqa: BLE001
        return _error(rid, f'serialization: {e}', 'SERIALIZATION_ERROR')


_ID_RE = re.compile(r'"id"\s*:\s*(-?\d+|"(?:[^"\\]|\\.)*")')


def process_line(line: str):
    """한 줄을 응답 dict 로 바꾼다. 빈 줄은 None."""
    line = line.strip()
    if not line:
        return None
    try:
        request = json.loads(line)
    except (json.JSONDecodeError, RecursionError) as e:
        # 깨진 줄에서도 id 를 찾을 수 있으면 돌려줘 호출자가 그 요청을 기다리지 않게 한다.
        m = _ID_RE.search(line)
        rid = None
        if m:
            try:
                rid = json.loads(m.group(1))
            except json.JSONDecodeError:
                rid = None
        return _error(rid, f'JSON parse error: {e}', 'PARSE_ERROR')
    return handle_request(request)


def _protocol_stream():
    """응답 전용 stdout 을 떼어 내고 fd 1 을 stderr 로 돌린다.

    파이썬 print 뿐 아니라 C 확장이 fd 1 에 직접 쓰는 것도 응답 줄을 깨뜨리지 못한다.
    """
    sys.stdout.flush()
    proto_fd = os.dup(1)
    os.dup2(2, 1)
    if os.name == 'nt':
        import msvcrt
        msvcrt.setmode(proto_fd, os.O_BINARY)
        msvcrt.setmode(0, os.O_BINARY)
    return os.fdopen(proto_fd, 'wb', buffering=0)


def main():
    """stdin에서 JSON-RPC 요청을 읽고 stdout으로 응답"""
    out = _protocol_stream()
    for raw in sys.stdin.buffer:
        try:
            line = raw.decode('utf-8')
        except UnicodeDecodeError as e:
            response = _error(None, f'Request is not UTF-8: {e}', 'PARSE_ERROR')
        else:
            try:
                response = process_line(line)
            except Exception as e:  # noqa: BLE001 — 어떤 경우에도 루프는 계속
                response = _error(None, f'Internal server error: {e}', 'INTERNAL_ERROR', e)
        if response is None:
            continue
        out.write((encode_response(response) + '\n').encode('ascii'))


if __name__ == '__main__':
    main()
