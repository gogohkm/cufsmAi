"""MATLAB .mat 파일 Import

참조: 컨버전전략.md §9 — .mat 파일 호환성

기존 CUFSM .mat 파일을 CufsmModel로 변환한다. CUFSM 의 saver.m 이 쓰는 변수
(prop, node, elem, lengths, springs, constraints, GBTcon, BC, m_all [, curve, shapes, clas])를
읽는다. CUFSM 3 시대 파일에는 BC · m_all 이 없다 — 그 판은 S-S 만 풀었으므로 S-S · m=[1]
로 읽고 그렇다고 알린다. 해석 결과(curve · shapes · clas)는 가져오지 않는다.
"""

import numpy as np

from models.data import CufsmModel, GBTConfig
from design.notices import N as _nt  # noqa: E402


def _matrix(data: dict, key: str, ncols: int, required: bool, max_cols: int = None) -> np.ndarray:
    raw = data.get(key)
    if raw is None or np.size(raw) == 0:
        if required:
            raise ValueError(f'.mat file has no {key}')
        return np.array([])
    arr = np.array(raw, dtype=float)
    # CUFSM 은 "없음" 을 스칼라 0 으로 저장한다(springs=0, constraints=0).
    if arr.ndim == 0 or (not required and not np.any(arr)):
        if required:
            raise ValueError(f'.mat {key} is a scalar, expected a ({key} x {ncols}) matrix')
        return np.array([])
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)
    hi = max_cols if max_cols is not None else ncols
    if arr.ndim != 2 or not (ncols <= arr.shape[1] <= hi):
        raise ValueError(f'.mat {key} must have {ncols} columns, got shape {arr.shape}')
    return arr


def _old_springs(arr: np.ndarray, warnings: list, assumptions: list) -> np.ndarray:
    """CUFSM 4.2 이전 스프링 [node dof k kflag] → 10 열 (loader.m 의 변환 그대로)."""
    out = []
    for i, (nodei, dof, k, kflag) in enumerate(arr[:, :4], start=1):
        dof = int(dof)
        out.append([i, nodei, 0, k * (dof == 1), k * (dof == 2), k * (dof == 3),
                    k * (dof == 4), 0, 0, 0])
        if int(kflag) == 0:
            warnings.append(_nt('file.warning.old_spring_has_kflag', i=i))
    assumptions.append(_nt('file.assumption.springs_from_cufsm_earlier'))
    return np.array(out, dtype=float)


def _springs(data: dict, warnings: list, assumptions: list) -> np.ndarray:
    raw = data.get('springs')
    if raw is None or np.size(raw) == 0 or not np.any(np.array(raw, dtype=float)):
        return np.array([])
    arr = np.atleast_2d(np.array(raw, dtype=float))
    if arr.shape[1] < 10:
        if arr.shape[1] != 4:
            raise ValueError(f'.mat springs must have 10 (or old-format 4) columns, got {arr.shape}')
        return _old_springs(arr, warnings, assumptions)
    return _matrix(data, 'springs', 10, required=False)


def _constraints(data: dict, assumptions: list) -> np.ndarray:
    arr = _matrix(data, 'constraints', 5, required=False, max_cols=64)
    if arr.size and arr.shape[1] > 5:
        # constr_user 는 앞 5 열만 읽는다. 뒤 열이 0 이 아니면 뜻을 알 수 없으므로 거절한다.
        if np.any(arr[:, 5:]):
            raise ValueError(f'.mat constraints has {arr.shape[1]} columns with non-zero '
                             'entries beyond column 5')
        assumptions.append(_nt('file.assumption.constraints_had_columns_zero', value=arr.shape[1]))
        arr = arr[:, :5]
    return arr


def _bc(data: dict, assumptions: list) -> str:
    raw = data.get('BC')
    if isinstance(raw, np.ndarray):
        raw = str(raw.flat[0]) if raw.size > 0 else None
    if raw is None or str(raw).strip() == '':
        assumptions.append(_nt('file.assumption.bc_stored_cufsm_file'))
        return 'S-S'
    return str(raw).strip()


def _m_all(data: dict, n_lengths: int, BC: str, warnings: list, assumptions: list) -> list:
    raw = data.get('m_all')
    if raw is None or np.size(raw) == 0:
        if BC == 'S-S':
            if raw is None:
                assumptions.append(_nt('file.assumption.all_stored_per_length'))
            return [np.array([1.0]) for _ in range(n_lengths)]
        warnings.append(_nt('file.warning.all_stored_bc_no', BC=BC))
        return []
    if np.isscalar(raw) or (isinstance(raw, np.ndarray) and raw.dtype != object):
        # simplify_cells 는 항 하나짜리 1x1 셀을 숫자 하나로 푼다.
        arr = np.asarray(raw, dtype=float)
        # simplify_cells 는 1x1 셀을 내용물로 푼다: 길이 하나의 항 벡터.
        if n_lengths == 1:
            return [arr.reshape(-1)]
        if arr.ndim == 1 and arr.size == n_lengths:
            return [np.array([v]) for v in arr]
        if arr.ndim == 2 and arr.shape[0] == n_lengths:
            return [row.reshape(-1) for row in arr]
        raise ValueError(f'.mat m_all of shape {arr.shape} does not match {n_lengths} lengths')
    items = list(raw.flat) if isinstance(raw, np.ndarray) else list(raw)
    m_all = [np.array(m, dtype=float).reshape(-1) for m in items]
    if len(m_all) != n_lengths:
        raise ValueError(f'.mat m_all has {len(m_all)} entries for {n_lengths} lengths')
    return m_all


# CUFSM loader.m:134-146 — 파일에 없는 cFSM 설정을 채우는 값. GBTConfig 의 기본과 같지만
# 그 기본이 바뀌어도 .mat 의 뜻(MATLAB 이 읽는 값)이 따라 바뀌지 않게 여기 따로 둔다.
CUFSM_LOADER_GBT_DEFAULTS = {'ospace': 1, 'orth': 2, 'couple': 1, 'norm': 1}
# loader.m 의 옛 GBTcon.basis → (ospace, orth, couple)
_BASIS_TO_SETTINGS = {1: {'ospace': 1, 'orth': 1, 'couple': 1},
                      2: {'ospace': 1, 'orth': 2, 'couple': 1}}
_BASIS_OTHER = {'ospace': 2, 'orth': 2, 'couple': 1}


def _gbtcon(data: dict, assumptions: list) -> GBTConfig:
    raw = data.get('GBTcon')
    raw = raw if isinstance(raw, dict) else {}
    d = {}
    for k in ('glob', 'dist', 'local', 'other'):
        if k in raw:
            d[k] = np.array(raw[k], dtype=float).reshape(-1)
    for k in CUFSM_LOADER_GBT_DEFAULTS:
        if k in raw and np.size(raw[k]) > 0:
            d[k] = int(np.array(raw[k]).reshape(-1)[0])
    if 'basis' in raw and np.size(raw['basis']) > 0 and not {'ospace', 'orth', 'couple'} & set(d):
        basis = int(np.array(raw['basis']).reshape(-1)[0])
        d.update(_BASIS_TO_SETTINGS.get(basis, _BASIS_OTHER))
        assumptions.append(_nt('file.assumption.gbtcon_basis_old_cufsm', basis=basis, ospace=d['ospace'], orth=d['orth'], couple=d['couple']))
    filled = [k for k in CUFSM_LOADER_GBT_DEFAULTS if k not in d]
    for k in filled:
        d[k] = CUFSM_LOADER_GBT_DEFAULTS[k]
    if filled:
        assumptions.append(_nt('file.assumption.cfsm_settings_stored_filled', items=', '.join(
            f'{k}={CUFSM_LOADER_GBT_DEFAULTS[k]}' for k in filled)))
    return GBTConfig.from_dict(d)


def read_mat_file(filepath: str):
    """CUFSM .mat 파일 → (CufsmModel, file_info).

    file_info = {'format', 'warnings', 'assumptions', 'ignored'} — warnings 는 값을 채웠거나
    사용자가 해야 할 일이 있는 것, assumptions 는 뜻을 바꾸지 않은 변환 · 참고.
    """
    from scipy.io import loadmat

    if not filepath:
        raise ValueError('load_mat: filepath is required')
    data = loadmat(filepath, simplify_cells=True)
    warnings = []
    assumptions = []

    # prop 의 7 번째 열은 진동 해석의 질량밀도(stripmain_vib)다.
    prop = _matrix(data, 'prop', 6, required=True, max_cols=7)
    node = _matrix(data, 'node', 8, required=True)
    elem = _matrix(data, 'elem', 5, required=True)
    if data.get('lengths') is None or np.size(data.get('lengths')) == 0:
        # 단면만 담은 파일(템플릿 아이콘 등). 길이를 지어내지 않는다 — 해석 전에 정해야 한다.
        lengths = np.array([])
        warnings.append(_nt('file.warning.no_analysis_lengths_stored'))
    else:
        lengths = np.array(data['lengths'], dtype=float).reshape(-1)
    springs = _springs(data, warnings, assumptions)
    constraints = _constraints(data, assumptions)
    BC = _bc(data, assumptions)
    m_all = _m_all(data, len(lengths), BC, warnings, assumptions)
    kw = {}
    if data.get('neigs') is not None and np.size(data['neigs']) > 0:
        kw['neigs'] = int(np.array(data['neigs']).reshape(-1)[0])

    ignored = sorted(k for k in ('curve', 'shapes', 'clas') if k in data)
    if ignored:
        assumptions.append(_nt('file.assumption.stored_analysis_results_were', ignored=', '.join(ignored)))
    model = CufsmModel(prop=prop, node=node, elem=elem, lengths=lengths, springs=springs,
                       constraints=constraints, BC=BC, m_all=m_all,
                       GBTcon=_gbtcon(data, assumptions), **kw)
    return model, {'format': 'cufsm-mat', 'warnings': warnings, 'assumptions': assumptions,
                   'ignored': ignored}


def load_mat_file(filepath: str) -> CufsmModel:
    """CUFSM .mat 파일을 CufsmModel로 변환

    Args:
        filepath: .mat 파일 경로

    Returns:
        CufsmModel 인스턴스
    """
    return read_mat_file(filepath)[0]
