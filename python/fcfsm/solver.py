"""fcFSM (Force-based Constrained Finite Strip Method) 해석

참조: 프로젝트개요.md §5.3 힘 기반 구속 FSM
원본: Ref_Source/analysis/fcFSM/stripmain_fcFSM.m

기존 cFSM의 운동학적 접근 대신 힘 평형을 기반으로 모드를 분해한다.
곡선 모서리를 가진 단면도 지원.
"""

import numpy as np
from scipy.linalg import eig

from engine.element import klocal, kglocal
from engine.transform import trans
from engine.assembly import assemble
from engine.properties import elemprop
from engine.fsm_solver import _get_free_dofs
from models.data import CufsmResult
from fcfsm.section_analysis import section_analysis_fcfsm

from scipy import sparse


def stripmain_fcfsm(prop: np.ndarray, node: np.ndarray, elem: np.ndarray,
                    lengths: np.ndarray, BC: str, m_all: list,
                    neigs: int = 20) -> dict:
    """fcFSM 좌굴 해석 + 모드 분류

    Returns:
        dict: {
            'curve': list[np.ndarray],
            'shapes': list[np.ndarray],
            'classification': list[np.ndarray],  # [%G, %D, %L, %O]
        }
    """
    nnodes = node.shape[0]
    nelems = elem.shape[0]
    elprop = elemprop(node, elem)

    curve_list = []
    shapes_list = []
    clas_list = []

    # fcFSM 단면 해석 — 구속행렬 생성
    sec_data = section_analysis_fcfsm(node, elem, prop)

    for l_idx in range(len(lengths)):
        a = lengths[l_idx]
        m_a = m_all[l_idx]
        totalm = len(m_a)
        ndof = 4 * nnodes * totalm

        K = sparse.lil_matrix((ndof, ndof))
        Kg = sparse.lil_matrix((ndof, ndof))

        for e in range(nelems):
            ni = int(elem[e, 1])
            nj = int(elem[e, 2])
            t = elem[e, 3]
            matnum = int(elem[e, 4])

            mat_idx = np.where(prop[:, 0] == matnum)[0]
            mat_idx = mat_idx[0] if len(mat_idx) > 0 else 0
            Ex, Ey = prop[mat_idx, 1], prop[mat_idx, 2]
            vx, vy = prop[mat_idx, 3], prop[mat_idx, 4]
            G = prop[mat_idx, 5]

            b = elprop[e, 1]
            alpha = elprop[e, 2]
            Ty1 = node[ni - 1, 7]
            Ty2 = node[nj - 1, 7]

            k_loc = klocal(Ex, Ey, vx, vy, G, t, a, b, BC, m_a)
            kg_loc = kglocal(a, b, Ty1, Ty2, BC, m_a)
            k_glob, kg_glob = trans(alpha, k_loc, kg_loc, m_a)
            K, Kg = assemble(K, Kg, k_glob, kg_glob, ni, nj, nnodes, m_a)

        # DOF 구속
        free_dofs = _get_free_dofs(node, nnodes, totalm)
        Kff = K.tocsr()[free_dofs, :][:, free_dofs].toarray()
        Kgff = Kg.tocsr()[free_dofs, :][:, free_dofs].toarray()
        Kgff_sym = (Kgff + Kgff.T) / 2.0

        try:
            eigenvalues, eigenvectors = eig(Kff, Kgff_sym)
            valid = np.where((np.isreal(eigenvalues)) & (np.real(eigenvalues) > 0))[0]
            lf = np.real(eigenvalues[valid])
            modes = np.real(eigenvectors[:, valid])
            sort_idx = np.argsort(lf)
            lf = lf[sort_idx[:neigs]]
            modes = modes[:, sort_idx[:neigs]]
        except Exception:
            lf = np.array([0.0])
            modes = np.zeros((len(free_dofs), 1))

        # 곡선
        n_modes = len(lf)
        curve_row = np.zeros(n_modes + 1)
        curve_row[0] = a
        curve_row[1:] = lf
        curve_list.append(curve_row.reshape(1, -1))

        # 모드형상 복원
        full_modes = np.zeros((ndof, n_modes))
        for m_idx in range(n_modes):
            mv = modes[:, m_idx]
            max_val = np.max(np.abs(mv))
            if max_val > 0:
                mv /= max_val
            full_modes[free_dofs, m_idx] = mv
        shapes_list.append(full_modes)

        # fcFSM 분류 (힘 기반)
        clas_modes = _classify_fcfsm(full_modes, sec_data, nnodes, totalm)
        clas_list.append(clas_modes)

    return {
        'curve': curve_list,
        'shapes': shapes_list,
        'classification': clas_list,
    }


def _classify_fcfsm(modes: np.ndarray, sec_data: dict,
                     nnodes: int, totalm: int) -> np.ndarray:
    """fcFSM 힘 기반 모드 분류

    Returns:
        (n_modes, 4) — [%G, %D, %L, %O]
    """
    n_modes = modes.shape[1]
    clas = np.zeros((n_modes, 4))

    b_v = sec_data.get('basis', None)
    if b_v is None or b_v.size == 0:
        clas[:, :] = 25.0  # 분류 불가 시 균등 분배
        return clas

    ngm = sec_data.get('ngm', 4)
    ndm = sec_data.get('ndm', 0)
    nlm = sec_data.get('nlm', 0)

    for m_idx in range(n_modes):
        displ = modes[:, m_idx]
        ndof_m = 4 * nnodes

        cl_g = cl_d = cl_l = cl_o = 0.0
        for mi in range(totalm):
            r0 = ndof_m * mi
            r1 = ndof_m * (mi + 1)
            d_m = displ[r0:r1]

            if b_v.shape[0] >= r1:
                bv_m = b_v[r0:r1, r0:r1] if b_v.shape[1] >= r1 else b_v[:ndof_m, :ndof_m]
            else:
                bv_m = b_v[:ndof_m, :ndof_m] if b_v.shape[0] >= ndof_m else np.eye(ndof_m)

            try:
                coeffs = np.linalg.lstsq(bv_m, d_m, rcond=None)[0]
                cl_g += np.sum(np.abs(coeffs[:ngm])**2)
                cl_d += np.sum(np.abs(coeffs[ngm:ngm+ndm])**2)
                cl_l += np.sum(np.abs(coeffs[ngm+ndm:ngm+ndm+nlm])**2)
                cl_o += np.sum(np.abs(coeffs[ngm+ndm+nlm:])**2)
            except Exception as e:
                pass  # classification coefficient solve failed

        total = cl_g + cl_d + cl_l + cl_o
        if total > 1e-15:
            clas[m_idx] = np.array([cl_g, cl_d, cl_l, cl_o]) / total * 100
        else:
            clas[m_idx] = [25, 25, 25, 25]

    return clas
