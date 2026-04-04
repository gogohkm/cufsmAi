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
from engine.stress import stresgen, yieldMP
from engine.dsm import extract_dsm_values
from engine.helpers import doubler, add_corner, signature_ss, firstyield, msort
from engine.cutwp import cutwp_prop
from cfsm.classify import classify
from vibration.solver import stripmain_vib
from fcfsm.solver import stripmain_fcfsm
from plastic.pmm_plastic import pmm_plastic
from fileio.mat_loader import load_mat_file
from fileio.project_io import save_project, load_project
from models.data import CufsmModel, CufsmResult, GBTConfig, _json_serializer


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

        elif method == 'stresgen':
            node = np.array(params['node'], dtype=float)
            props = params.get('props', {})
            loads = params.get('loads', {})
            node = stresgen(
                node,
                P=loads.get('P', 0), Mxx=loads.get('Mxx', 0),
                Mzz=loads.get('Mzz', 0), M11=loads.get('M11', 0),
                M22=loads.get('M22', 0),
                A=props['A'], xcg=props['xcg'], zcg=props['zcg'],
                Ixx=props['Ixx'], Izz=props['Izz'], Ixz=props['Ixz'],
                thetap=props['thetap'], I11=props['I11'], I22=props['I22'],
                unsymm=loads.get('unsymm', 0),
            )
            return {'id': req_id, 'result': {'node': node.tolist()}}

        elif method == 'yieldMP':
            node = np.array(params['node'], dtype=float)
            elem = np.array(params['elem'], dtype=float)
            fy = params.get('fy', 50.0)
            props = grosprop(node, elem)
            result = yieldMP(
                node, fy, props['A'], props['xcg'], props['zcg'],
                props['Ixx'], props['Izz'], props['Ixz'],
                props['thetap'], props['I11'], props['I22'],
            )
            return {'id': req_id, 'result': result}

        elif method == 'classify':
            model = CufsmModel.from_dict(params.get('model', {}))
            shapes = [np.array(s) for s in params.get('shapes', [])]
            clas = classify(
                model.prop, model.node, model.elem,
                model.lengths, shapes, model.GBTcon, model.BC, model.m_all
            )
            return {'id': req_id, 'result': [c.tolist() for c in clas]}

        elif method == 'fcfsm':
            model = CufsmModel.from_dict(params)
            result = stripmain_fcfsm(
                model.prop, model.node, model.elem,
                model.lengths, model.BC, model.m_all, model.neigs
            )
            return {'id': req_id, 'result': {
                'curve': [c.tolist() for c in result['curve']],
                'classification': [c.tolist() for c in result['classification']],
                'n_lengths': len(result['curve']),
            }}

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
                'P': result['P'].flatten().tolist(),
                'M11': result['M11'].flatten().tolist(),
                'M22': result['M22'].flatten().tolist(),
                'Py': result['Py'],
                'M11_y': result['M11_y'],
                'M22_y': result['M22_y'],
                'Mxx_y': result['Mxx_y'],
                'Mzz_y': result['Mzz_y'],
                'thetap': result['thetap'],
                'fy': result['fy'],
                'n_theta': result['n_theta'],
                'n_na': result['n_na'],
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

        elif method == 'doubler':
            node = np.array(params['node'], dtype=float)
            elem = np.array(params['elem'], dtype=float)
            n_out, e_out = doubler(node, elem)
            return {'id': req_id, 'result': {'node': n_out.tolist(), 'elem': e_out.tolist()}}

        elif method == 'signature_ss':
            model = CufsmModel.from_dict(params)
            result = signature_ss(model.prop, model.node, model.elem)
            return {'id': req_id, 'result': {
                'curve': [c.tolist() for c in result['curve']],
                'lengths': result['lengths'].tolist(),
            }}

        elif method == 'firstyield':
            node = np.array(params['node'], dtype=float)
            elem = np.array(params['elem'], dtype=float)
            fy = params.get('fy', 50.0)
            result = firstyield(node, elem, fy)
            return {'id': req_id, 'result': result}

        elif method == 'dsm':
            node = np.array(params['node'], dtype=float)
            elem = np.array(params['elem'], dtype=float)
            curve = params.get('curve', [])
            fy = params.get('fy', 50.0)
            load_type = params.get('load_type', 'P')
            result = extract_dsm_values(curve, node, elem, fy, load_type)
            return {'id': req_id, 'result': result}

        elif method == 'cutwp':
            node = np.array(params['node'], dtype=float)
            elem = np.array(params['elem'], dtype=float)
            result = cutwp_prop(node, elem)
            return {'id': req_id, 'result': result}

        elif method == 'energy_recovery':
            from engine.helpers import energy_recovery
            node = np.array(params['node'], dtype=float)
            elem = np.array(params['elem'], dtype=float)
            prop = np.array(params['prop'], dtype=float)
            mode = np.array(params['mode'], dtype=float)
            length = float(params['length'])
            BC = params.get('BC', 'S-S')
            se = energy_recovery(prop, node, elem, mode, length, BC=BC)
            return {'id': req_id, 'result': {
                'energy': se.tolist(),
                'columns': ['membrane', 'bending'],
                'n_elements': len(se),
            }}

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
            sys.stdout.write(json.dumps(response, default=_json_serializer) + '\n')
            sys.stdout.flush()
        except json.JSONDecodeError as e:
            error_response = {'id': 0, 'error': f'JSON parse error: {e}'}
            sys.stdout.write(json.dumps(error_response) + '\n')
            sys.stdout.flush()


if __name__ == '__main__':
    main()
