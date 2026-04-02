"""MATLAB .mat 파일 Import

참조: 컨버전전략.md §9 — .mat 파일 호환성

기존 CUFSM .mat 파일을 CufsmModel로 변환한다.
"""

import numpy as np

from models.data import CufsmModel, GBTConfig


def load_mat_file(filepath: str) -> CufsmModel:
    """CUFSM .mat 파일을 CufsmModel로 변환

    Args:
        filepath: .mat 파일 경로

    Returns:
        CufsmModel 인스턴스
    """
    from scipy.io import loadmat

    data = loadmat(filepath, simplify_cells=True)

    # prop
    prop = np.array(data.get('prop', [[100, 29500, 29500, 0.3, 0.3, 11346]]),
                    dtype=float)
    if prop.ndim == 1:
        prop = prop.reshape(1, -1)

    # node
    node = np.array(data.get('node', []), dtype=float)
    if node.ndim == 1 and node.size > 0:
        node = node.reshape(1, -1)

    # elem
    elem = np.array(data.get('elem', []), dtype=float)
    if elem.ndim == 1 and elem.size > 0:
        elem = elem.reshape(1, -1)

    # lengths
    lengths = np.array(data.get('lengths', [100.0]), dtype=float).flatten()

    # springs
    springs_raw = data.get('springs', None)
    if springs_raw is not None and np.array(springs_raw).size > 0:
        springs = np.array(springs_raw, dtype=float)
        if springs.ndim == 1:
            springs = springs.reshape(1, -1)
    else:
        springs = np.array([])

    # constraints
    constraints_raw = data.get('constraints', None)
    if constraints_raw is not None and np.array(constraints_raw).size > 0:
        constraints = np.array(constraints_raw, dtype=float)
        if constraints.ndim == 1:
            constraints = constraints.reshape(1, -1)
    else:
        constraints = np.array([])

    # BC
    BC_raw = data.get('BC', 'S-S')
    if isinstance(BC_raw, np.ndarray):
        BC = str(BC_raw.flat[0]) if BC_raw.size > 0 else 'S-S'
    else:
        BC = str(BC_raw) if BC_raw else 'S-S'

    # m_all (cell array → list)
    m_all_raw = data.get('m_all', None)
    if m_all_raw is not None:
        if isinstance(m_all_raw, np.ndarray):
            m_all = [np.array(m, dtype=float).flatten() for m in m_all_raw.flat]
        elif isinstance(m_all_raw, list):
            m_all = [np.array(m, dtype=float).flatten() for m in m_all_raw]
        else:
            m_all = [np.array([1.0]) for _ in lengths]
    else:
        m_all = [np.array([1.0]) for _ in lengths]

    # GBTcon
    GBTcon_raw = data.get('GBTcon', None)
    if GBTcon_raw is not None and isinstance(GBTcon_raw, dict):
        gbt = GBTConfig(
            glob=np.array(GBTcon_raw.get('glob', []), dtype=float).flatten(),
            dist=np.array(GBTcon_raw.get('dist', []), dtype=float).flatten(),
            local=np.array(GBTcon_raw.get('local', []), dtype=float).flatten(),
            other=np.array(GBTcon_raw.get('other', []), dtype=float).flatten(),
            ospace=int(GBTcon_raw.get('ospace', 1)),
            orth=int(GBTcon_raw.get('orth', 1)),
            couple=int(GBTcon_raw.get('couple', 1)),
            norm=int(GBTcon_raw.get('norm', 0)),
        )
    else:
        gbt = GBTConfig()

    return CufsmModel(
        prop=prop,
        node=node,
        elem=elem,
        lengths=lengths,
        springs=springs,
        constraints=constraints,
        BC=BC,
        m_all=m_all,
        GBTcon=gbt,
    )
