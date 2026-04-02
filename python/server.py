"""JSON-RPC 서버 — Extension Host와 stdin/stdout 통신

참조: 컨버전전략.md §5.2 Python 해석 엔진
"""

import json
import sys
import traceback

import numpy as np

from engine.fsm_solver import stripmain
from engine.properties import grosprop
from engine.template import generate_section
from cfsm.classify import classify
from vibration.solver import stripmain_vib
from plastic.pmm_plastic import pmm_plastic
from fileio.mat_loader import load_mat_file
from fileio.project_io import save_project, load_project
from models.data import CufsmModel, CufsmResult, GBTConfig


def handle_request(request: dict) -> dict:
    """JSON-RPC 요청 처리"""
    method = request.get('method', '')
    params = request.get('params', {})
    req_id = request.get('id', 0)

    try:
        if method == 'analyze':
            model = CufsmModel.from_dict(params)
            result = stripmain(
                prop=model.prop,
                node=model.node,
                elem=model.elem,
                lengths=model.lengths,
                springs=model.springs,
                constraints=model.constraints,
                GBTcon=model.GBTcon,
                BC=model.BC,
                m_all=model.m_all,
                neigs=model.neigs,
            )
            return {'id': req_id, 'result': result.to_dict()}

        elif method == 'get_properties':
            node = np.array(params['node'], dtype=float)
            elem = np.array(params['elem'], dtype=float)
            props = grosprop(node, elem)
            return {'id': req_id, 'result': props}

        elif method == 'generate_section':
            section_type = params.get('section_type', 'lippedc')
            section_params = params.get('params', {})
            result = generate_section(section_type, section_params)
            return {'id': req_id, 'result': {
                'node': result['node'].tolist(),
                'elem': result['elem'].tolist(),
            }}

        elif method == 'classify':
            model = CufsmModel.from_dict(params.get('model', {}))
            shapes = [np.array(s) for s in params.get('shapes', [])]
            clas = classify(
                model.prop, model.node, model.elem,
                model.lengths, shapes, model.GBTcon, model.BC, model.m_all
            )
            return {'id': req_id, 'result': [c.tolist() for c in clas]}

        elif method == 'vibration':
            model = CufsmModel.from_dict(params)
            result = stripmain_vib(
                model.prop, model.node, model.elem,
                model.lengths, model.BC, model.m_all
            )
            return {'id': req_id, 'result': {
                'frequencies': [f.tolist() for f in result['frequencies']],
            }}

        elif method == 'plastic':
            node = np.array(params['node'], dtype=float)
            elem = np.array(params['elem'], dtype=float)
            fy = params.get('fy', 50.0)
            result = pmm_plastic(node, elem, fy)
            return {'id': req_id, 'result': {
                'P': result['P'].tolist(),
                'Mxx': result['Mxx'].tolist(),
                'Mzz': result['Mzz'].tolist(),
            }}

        elif method == 'load_mat':
            filepath = params.get('filepath', '')
            model = load_mat_file(filepath)
            return {'id': req_id, 'result': model.to_dict()}

        elif method == 'save_project':
            model = CufsmModel.from_dict(params.get('model', {}))
            filepath = params.get('filepath', '')
            save_project(model, filepath)
            return {'id': req_id, 'result': 'saved'}

        elif method == 'load_project':
            filepath = params.get('filepath', '')
            model = load_project(filepath)
            return {'id': req_id, 'result': model.to_dict()}

        elif method == 'ping':
            return {'id': req_id, 'result': 'pong'}

        else:
            return {'id': req_id, 'error': f'Unknown method: {method}'}

    except Exception as e:
        return {
            'id': req_id,
            'error': str(e),
            'traceback': traceback.format_exc(),
        }


def main():
    """stdin에서 JSON-RPC 요청을 읽고 stdout으로 응답"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            response = handle_request(request)
            sys.stdout.write(json.dumps(response, default=_json_default) + '\n')
            sys.stdout.flush()
        except json.JSONDecodeError as e:
            error_response = {'id': 0, 'error': f'JSON parse error: {e}'}
            sys.stdout.write(json.dumps(error_response) + '\n')
            sys.stdout.flush()


def _json_default(obj):
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


if __name__ == '__main__':
    main()
