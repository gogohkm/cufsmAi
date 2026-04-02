"""cFSM 모드 분류 — 좌굴 모드를 G/D/L/O로 분류

참조: 프로젝트개요.md §5.2 구속 유한스트립법
원본: Ref_Source/analysis/cFSM/classify.m, mode_class.m, node_class.m, mode_nr.m

모드 분류 기준:
  G (Global):       4개 — 강체 운동 + 축압축
  D (Distortional): ndm개 — 주절점 변형 (플랜지 뒤틀림)
  L (Local):        nlm개 — 판 국부 좌굴
  O (Other):        나머지 — 멤브레인 모드
"""

import numpy as np
from scipy.linalg import lstsq, block_diag

from .base_vectors import base_column, base_update
from .node_utils import node_class, mode_nr


def classify(prop: np.ndarray, node: np.ndarray, elem: np.ndarray,
             lengths: np.ndarray, shapes: list, GBTcon, BC: str,
             m_all: list) -> list:
    """좌굴 모드를 G/D/L/O로 분류

    Args:
        prop, node, elem: 모델 데이터 (MATLAB 1-based)
        lengths: 해석 길이 배열
        shapes: list[np.ndarray] — shapes[i] = (ndof, nmodes)
        GBTcon: GBTConfig 객체
        BC: 경계조건
        m_all: list[np.ndarray]

    Returns:
        clas: list[np.ndarray] — clas[i] = (nmodes, 4) [%G, %D, %L, %O]
    """
    nnodes = node.shape[0]
    clas_all = []

    for l_idx in range(len(lengths)):
        a = lengths[l_idx]
        m_a = m_all[l_idx]
        totalm = len(m_a)
        ndof_m = 4 * nnodes

        shape_mat = shapes[l_idx]
        if shape_mat is None or shape_mat.size == 0:
            clas_all.append(np.zeros((1, 4)))
            continue

        n_modes = shape_mat.shape[1] if shape_mat.ndim == 2 else 1

        # 기저벡터 생성
        b_v_l, ngm, ndm, nlm = base_column(node, elem, prop, a, BC, m_a)

        # 직교화/정규화
        ospace = getattr(GBTcon, 'ospace', 1) if GBTcon else 1
        norm_type = getattr(GBTcon, 'norm', 0) if GBTcon else 0
        b_v = base_update(b_v_l, ospace, norm_type)

        # 각 모드 분류
        clas_modes = np.zeros((n_modes, 4))
        for m_idx in range(n_modes):
            if shape_mat.ndim == 2:
                displ = shape_mat[:, m_idx]
            else:
                displ = shape_mat

            couple = getattr(GBTcon, 'couple', 1) if GBTcon else 1
            gdlo = mode_class(b_v, displ, ngm, ndm, nlm, m_a, ndof_m, couple)
            clas_modes[m_idx, :] = gdlo

        clas_all.append(clas_modes)

    return clas_all


def mode_class(b_v: np.ndarray, displ: np.ndarray,
               ngm: int, ndm: int, nlm: int,
               m_a: np.ndarray, ndof_m: int, couple: int = 1) -> np.ndarray:
    """단일 모드의 G/D/L/O 분류

    Args:
        b_v: 기저벡터 행렬
        displ: 변위 벡터
        ngm, ndm, nlm: 모드 수
        m_a: 조화항 배열
        ndof_m: DOF per m-term
        couple: 1=비결합(블록 대각), 2=결합

    Returns:
        gdlo: (4,) — [%G, %D, %L, %O]
    """
    totalm = len(m_a)
    nom = ngm + ndm + nlm  # G+D+L 모드 수
    n_other = ndof_m - nom

    if couple == 1:
        # 비결합: 각 m항 독립적으로 풀이
        cl_g = 0.0
        cl_d = 0.0
        cl_l = 0.0
        cl_o = 0.0

        for mi in range(totalm):
            r0 = ndof_m * mi
            r1 = ndof_m * (mi + 1)

            b_v_m = b_v[r0:r1, r0:r1]
            displ_m = displ[r0:r1]

            if np.max(np.abs(b_v_m)) < 1e-15:
                continue

            # 최소자승 풀이
            coeffs, _, _, _ = lstsq(b_v_m, displ_m)

            cl_g += np.sum(np.abs(coeffs[:ngm])**2)
            cl_d += np.sum(np.abs(coeffs[ngm:ngm+ndm])**2)
            cl_l += np.sum(np.abs(coeffs[ngm+ndm:ngm+ndm+nlm])**2)
            cl_o += np.sum(np.abs(coeffs[ngm+ndm+nlm:])**2)
    else:
        # 결합: 전체를 한번에 풀이
        coeffs, _, _, _ = lstsq(b_v, displ)
        n_per = ngm + ndm + nlm + n_other

        cl_g = 0.0
        cl_d = 0.0
        cl_l = 0.0
        cl_o = 0.0

        for mi in range(totalm):
            base = n_per * mi
            cl_g += np.sum(np.abs(coeffs[base:base+ngm])**2)
            cl_d += np.sum(np.abs(coeffs[base+ngm:base+ngm+ndm])**2)
            cl_l += np.sum(np.abs(coeffs[base+ngm+ndm:base+ngm+ndm+nlm])**2)
            cl_o += np.sum(np.abs(coeffs[base+ngm+ndm+nlm:base+n_per])**2)

    # 정규화 (백분율)
    total = cl_g + cl_d + cl_l + cl_o
    if total < 1e-15:
        return np.array([25.0, 25.0, 25.0, 25.0])

    return np.array([cl_g, cl_d, cl_l, cl_o]) / total * 100.0


    # node_class, mode_nr는 node_utils.py에서 import
