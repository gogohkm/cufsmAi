"""자유 진동 해석

참조: 프로젝트개요.md §5.5 자유 진동 해석
원본: Ref_Source/analysis/vibration/stripmain_vib.m, mlocal.m

고유치 문제: [K - omega^2 * M]{Phi} = 0
"""

import math

import numpy as np
from scipy import sparse
from scipy.linalg import eig

from engine.element import klocal
from engine.transform import trans
from engine.assembly import assemble
from engine.properties import elemprop
from engine.boundary import BC_I1_5

PI = math.pi


def mlocal(rho: float, t: float, a: float, b: float,
           BC: str, m_a: np.ndarray) -> np.ndarray:
    """요소 질량행렬 (로컬 좌표계)

    Args:
        rho: 재료 밀도
        t: 요소 두께
        a: 종방향 길이
        b: 횡방향 폭
        BC: 경계조건
        m_a: 종방향 조화항

    Returns:
        mass: (8*totalm, 8*totalm) 질량행렬
    """
    totalm = len(m_a)
    mass = np.zeros((8 * totalm, 8 * totalm))

    for m in range(totalm):
        for p in range(totalm):
            I1, I2, I3, I4, I5 = BC_I1_5(BC, m_a[m], m_a[p], a)

            # 멤브레인 질량 4x4 (일관 질량)
            mm = np.zeros((4, 4))
            mm[0, 0] = rho * t * b * I1 / 3
            mm[0, 2] = rho * t * b * I1 / 6
            mm[2, 0] = mm[0, 2]
            mm[2, 2] = rho * t * b * I1 / 3

            um = m_a[m] * PI
            up = m_a[p] * PI
            if um != 0 and up != 0:
                mm[1, 1] = rho * t * b * I4 * a**2 / (3 * um * up)
                mm[1, 3] = rho * t * b * I4 * a**2 / (6 * um * up)
                mm[3, 1] = mm[1, 3]
                mm[3, 3] = rho * t * b * I4 * a**2 / (3 * um * up)

            # 휨 질량 4x4
            mf = np.zeros((4, 4))
            mf[0, 0] = 156 * rho * t * b * I1 / 420
            mf[0, 1] = 22 * rho * t * b**2 * I1 / 420
            mf[1, 0] = mf[0, 1]
            mf[0, 2] = 54 * rho * t * b * I1 / 420
            mf[2, 0] = mf[0, 2]
            mf[0, 3] = -13 * rho * t * b**2 * I1 / 420
            mf[3, 0] = mf[0, 3]
            mf[1, 1] = 4 * rho * t * b**3 * I1 / 420
            mf[1, 2] = 13 * rho * t * b**2 * I1 / 420
            mf[2, 1] = mf[1, 2]
            mf[1, 3] = -3 * rho * t * b**3 * I1 / 420
            mf[3, 1] = mf[1, 3]
            mf[2, 2] = 156 * rho * t * b * I1 / 420
            mf[2, 3] = -22 * rho * t * b**2 * I1 / 420
            mf[3, 2] = mf[2, 3]
            mf[3, 3] = 4 * rho * t * b**3 * I1 / 420

            r_m = 8 * m
            r_p = 8 * p
            mass[r_m:r_m + 4, r_p:r_p + 4] = mm
            mass[r_m + 4:r_m + 8, r_p + 4:r_p + 8] = mf

    return mass


def stripmain_vib(prop: np.ndarray, node: np.ndarray, elem: np.ndarray,
                  lengths: np.ndarray, BC: str, m_all: list,
                  neigs: int = 10) -> dict:
    """자유 진동 해석

    prop에 밀도(rho) 열이 추가되어야 함: [matnum, Ex, Ey, vx, vy, G, rho]

    Returns:
        dict: {'frequencies': list[np.ndarray], 'shapes': list[np.ndarray]}
    """
    nnodes = node.shape[0]
    nelems = elem.shape[0]
    elprop_arr = elemprop(node, elem)

    freq_list = []
    shapes_list = []

    for l_idx in range(len(lengths)):
        a = lengths[l_idx]
        m_a = m_all[l_idx]
        totalm = len(m_a)
        ndof = 4 * nnodes * totalm

        K = sparse.lil_matrix((ndof, ndof))
        M = sparse.lil_matrix((ndof, ndof))

        # 더미 Kg (0)
        Kg_zero = sparse.lil_matrix((ndof, ndof))

        for e in range(nelems):
            ni = int(elem[e, 1])
            nj = int(elem[e, 2])
            t = elem[e, 3]
            matnum = int(elem[e, 4])

            mat_idx = np.where(prop[:, 0] == matnum)[0]
            mat_idx = mat_idx[0] if len(mat_idx) > 0 else 0
            Ex = prop[mat_idx, 1]
            Ey = prop[mat_idx, 2]
            vx = prop[mat_idx, 3]
            vy = prop[mat_idx, 4]
            G = prop[mat_idx, 5]
            rho = prop[mat_idx, 6] if prop.shape[1] > 6 else 1.0

            b = elprop_arr[e, 1]
            alpha = elprop_arr[e, 2]

            # 강성행렬
            k_loc = klocal(Ex, Ey, vx, vy, G, t, a, b, BC, m_a)
            kg_loc = np.zeros_like(k_loc)
            k_glob, _ = trans(alpha, k_loc, kg_loc, m_a)

            # 질량행렬
            m_loc = mlocal(rho, t, a, b, BC, m_a)
            m_glob, _ = trans(alpha, m_loc, np.zeros_like(m_loc), m_a)

            K, Kg_zero = assemble(K, Kg_zero, k_glob, np.zeros_like(k_glob),
                                  ni, nj, nnodes, m_a)
            M, _ = assemble(M, sparse.lil_matrix((ndof, ndof)),
                           m_glob, np.zeros_like(m_glob), ni, nj, nnodes, m_a)

        # DOF 구속
        from engine.fsm_solver import _get_free_dofs
        free_dofs = _get_free_dofs(node, nnodes, totalm)

        Kff = K.tocsr()[free_dofs, :][:, free_dofs].toarray()
        Mff = M.tocsr()[free_dofs, :][:, free_dofs].toarray()

        try:
            eigenvalues, eigenvectors = eig(Kff, Mff)
            valid = np.where((np.isreal(eigenvalues)) & (np.real(eigenvalues) > 0))[0]
            lam = np.real(eigenvalues[valid])
            sort_idx = np.argsort(lam)
            lam = lam[sort_idx[:neigs]]
            freqs = np.sqrt(lam) / (2 * PI)  # Hz
            freq_list.append(freqs)
            shapes_list.append(np.real(eigenvectors[:, valid][:, sort_idx[:neigs]]))
        except Exception:
            freq_list.append(np.array([0.0]))
            shapes_list.append(np.zeros((len(free_dofs), 1)))

    return {'frequencies': freq_list, 'shapes': shapes_list}
