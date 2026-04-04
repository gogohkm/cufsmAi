"""유한스트립법 좌굴 해석 메인 솔버

참조: 프로젝트개요.md §4 해석 워크플로우, §5.1 FSM 해석 엔진
참조: 컨버전전략.md §6 수치해석 매핑 (eigs → eigsh)
원본: Ref_Source/analysis/stripmain.m

해석 흐름:
  [1] elemprop() → 요소 폭, 각도
  [2] 각 길이에 대해:
      a. K, Kg 초기화
      b. 요소 루프: klocal → kglocal → trans → assemble
      c. 스프링 조립
      d. DOF 구속 적용
      e. 고유치 풀이
      f. 결과 정리
"""

import math

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import eigsh

from .element import klocal, kglocal, spring_klocal
from .transform import trans, spring_trans
from .assembly import assemble, spring_assemble
from .properties import elemprop
from models.data import CufsmResult, GBTConfig


def stripmain(prop: np.ndarray, node: np.ndarray, elem: np.ndarray,
              lengths: np.ndarray, springs: np.ndarray,
              constraints: np.ndarray, GBTcon, BC: str,
              m_all: list, neigs: int = 20) -> CufsmResult:
    """FSM 좌굴 해석 메인 루틴

    Args:
        prop: (nmats, 6) [matnum, Ex, Ey, vx, vy, G]
        node: (nnodes, 8) [node#, x, z, dofx, dofz, dofy, dofrot, stress]
        elem: (nelems, 5) [elem#, nodei, nodej, t, matnum]
        lengths: (nlengths,) 해석 길이 배열
        springs: (nsprings, 10) 스프링 데이터 또는 빈 배열
        constraints: (nconstraints, 5) 구속조건 또는 빈 배열
        GBTcon: GBTConfig 객체 (현재 미사용, Phase 5에서 구현)
        BC: 경계조건 문자열
        m_all: list[np.ndarray] — 각 길이별 종방향 항
        neigs: 계산할 고유치 수

    Returns:
        CufsmResult(curve, shapes)
    """
    nnodes = node.shape[0]
    nelems = elem.shape[0]

    # 요소 물성 (폭, 각도)
    elprop = elemprop(node, elem)

    curve_list = []
    shapes_list = []

    for length_idx in range(len(lengths)):
        a = lengths[length_idx]
        m_a = m_all[length_idx]
        totalm = len(m_a)
        ndof = 4 * nnodes * totalm

        # 전체 행렬 초기화
        K = sparse.lil_matrix((ndof, ndof))
        Kg = sparse.lil_matrix((ndof, ndof))

        # === 요소 루프: 강성행렬 조립 ===
        for e in range(nelems):
            # 요소 절점 (MATLAB 1-based)
            ni = int(elem[e, 1])
            nj = int(elem[e, 2])
            t = elem[e, 3]
            matnum = int(elem[e, 4])

            # 재료 물성 찾기
            mat_idx = np.where(prop[:, 0] == matnum)[0]
            if len(mat_idx) == 0:
                mat_idx = 0
            else:
                mat_idx = mat_idx[0]
            Ex = prop[mat_idx, 1]
            Ey = prop[mat_idx, 2]
            vx = prop[mat_idx, 3]
            vy = prop[mat_idx, 4]
            G = prop[mat_idx, 5]

            # 요소 폭, 각도
            b = elprop[e, 1]
            alpha = elprop[e, 2]

            # 절점 응력 × 두께 = 응력 결과력 (MATLAB: node(nodei,8)*t)
            Ty1 = node[ni - 1, 7] * t
            Ty2 = node[nj - 1, 7] * t

            # 로컬 요소 행렬
            k_local = klocal(Ex, Ey, vx, vy, G, t, a, b, BC, m_a)
            kg_local = kglocal(a, b, Ty1, Ty2, BC, m_a)

            # 좌표 변환
            k_global, kg_global = trans(alpha, k_local, kg_local, m_a)

            # 전체 행렬에 조립
            K, Kg = assemble(K, Kg, k_global, kg_global, ni, nj, nnodes, m_a)

        # === 스프링 조립 ===
        if springs is not None and springs.size > 0 and springs.ndim == 2:
            nsprings = springs.shape[0]
            for s in range(nsprings):
                sni = int(springs[s, 1])   # nodei (1-based)
                snj = int(springs[s, 2])   # nodej (1-based, 0=접지)
                ku = springs[s, 3]
                kv = springs[s, 4]
                kw = springs[s, 5]
                kq = springs[s, 6]
                discrete = int(springs[s, 8])
                ys = springs[s, 9] if discrete else 0.0

                ks_l = spring_klocal(ku, kv, kw, kq, a, BC, m_a,
                                     bool(discrete), ys)

                # 스프링 좌표변환 (stripmain.m line 226-259)
                if snj == 0:
                    # 접지 스프링 — 글로벌 좌표계
                    sp_alpha = 0.0
                else:
                    xi = node[sni - 1, 1]
                    zi = node[sni - 1, 2]
                    xj = node[snj - 1, 1]
                    zj = node[snj - 1, 2]
                    dx = xj - xi
                    dz = zj - zi
                    width = math.sqrt(dx * dx + dz * dz)
                    if width < 1e-10 or int(springs[s, 7]) == 0:
                        sp_alpha = 0.0
                    else:
                        sp_alpha = math.atan2(dz, dx)

                ks = spring_trans(sp_alpha, ks_l, m_a)
                K = spring_assemble(K, ks, sni, snj, nnodes, m_a)

        # === DOF 구속 및 제약 행렬 적용 ===
        # (1) BCFlag 판별: 사용자 구속 또는 절점 고정이 있는지 확인
        #     (stripmain.m line 84: constr_BCFlag)
        BCFlag = _constr_BCFlag(node, constraints)

        # (2) cFSM 모드 분류 활성화 여부
        cFSM_analysis = (isinstance(GBTcon, GBTConfig) and GBTcon.is_active())

        K_dense = K.toarray()
        Kg_dense = Kg.toarray()

        if BCFlag == 0 and not cFSM_analysis:
            # 단순 케이스: 고정 DOF만 제거 (기존 방식)
            free_dofs = _get_free_dofs(node, nnodes, totalm)
            Kff = K_dense[np.ix_(free_dofs, free_dofs)]
            Kgff = Kg_dense[np.ix_(free_dofs, free_dofs)]
            R = None  # 제약 행렬 없음
        else:
            # 제약 행렬 R 접근 (stripmain.m line 265-315)
            from cfsm.constraints import constr_user

            # Ruser 생성 및 null space
            if BCFlag != 0:
                Ruser = constr_user(node, constraints, m_a)
                Ru0 = _null_space(Ruser.T)
            else:
                Ru0 = np.zeros((ndof, 0))

            # cFSM 모드 제약 (stripmain.m line 282-294)
            if cFSM_analysis:
                from cfsm.base_vectors import base_column, base_update, mode_select
                b_v_l, ngm, ndm, nlm = base_column(node, elem, prop, a, BC, m_a)
                b_v = base_update(
                    GBTcon.ospace, 0, b_v_l, a, m_a, node, elem, prop,
                    ngm, ndm, nlm, BC, GBTcon.couple, GBTcon.orth
                )
                b_v = mode_select(
                    b_v, ngm, ndm, nlm,
                    GBTcon.glob, GBTcon.dist, GBTcon.local, GBTcon.other,
                    4 * nnodes, m_a
                )
                Rmode = b_v
            else:
                Rmode = np.eye(ndof)

            # 최종 제약 행렬 R 생성 (stripmain.m line 296-315)
            if BCFlag == 0:
                R = Rmode
            else:
                if cFSM_analysis:
                    Rm0 = _null_space(Rmode.T)
                    nm0 = Rm0.shape[1]
                    nu0 = Ru0.shape[1]
                    if nm0 > 0 or nu0 > 0:
                        R0_parts = []
                        if nm0 > 0:
                            R0_parts.append(Rm0)
                        if nu0 > 0:
                            R0_parts.append(Ru0)
                        R0 = np.hstack(R0_parts)
                        R = _null_space(R0.T)
                    else:
                        R = np.eye(ndof)
                else:
                    R = _null_space(Ru0.T)

            # R'*K*R, R'*Kg*R (stripmain.m line 318-319)
            Kff = R.T @ K_dense @ R
            Kgff = R.T @ Kg_dense @ R

        # === 고유치 풀이 ===
        n_free = Kff.shape[0]
        n_eigs = max(min(2 * neigs, n_free), 1)
        if n_free <= 0:
            curve_list.append(np.array([[a, 0.0]]))
            shapes_list.append(np.zeros((ndof, 1)))
            continue

        # Kg 대칭화
        Kgff_sym = (Kgff + Kgff.T) / 2.0

        try:
            # 일반화 고유치 문제: K*x = lambda*Kg*x
            eigenvalues, eigenvectors = _solve_eigenproblem(
                Kff, Kgff_sym, n_eigs)
        except Exception:
            curve_list.append(np.array([[a, 0.0]]))
            shapes_list.append(np.zeros((ndof, 1)))
            continue

        # 양의 실수 고유치만 필터링 및 정렬
        valid = np.where((np.isreal(eigenvalues)) & (np.real(eigenvalues) > 0))[0]
        if len(valid) == 0:
            curve_list.append(np.array([[a, 0.0]]))
            shapes_list.append(np.zeros((ndof, 1)))
            continue

        lf = np.real(eigenvalues[valid])
        modes_valid = np.real(eigenvectors[:, valid])

        # 정렬 (오름차순)
        sort_idx = np.argsort(lf)
        lf = lf[sort_idx[:neigs]]
        modes_valid = modes_valid[:, sort_idx[:neigs]]

        # 모드형상을 전체 DOF로 복원 (stripmain.m line 381: mode = R*modes)
        n_modes = len(lf)
        if R is not None:
            full_modes_raw = R @ modes_valid
        else:
            # R == None: free_dofs 방식
            full_modes_raw = np.zeros((ndof, n_modes))
            full_modes_raw[free_dofs, :] = modes_valid

        # 정규화: 최대 절대값을 1.0으로
        full_modes = np.zeros((ndof, n_modes))
        for m_idx in range(n_modes):
            mode_vec = full_modes_raw[:, m_idx]
            max_val = np.max(np.abs(mode_vec))
            if max_val > 0:
                mode_vec = mode_vec / max_val
            full_modes[:, m_idx] = mode_vec

        # 곡선 데이터: [길이, 하중비1, 하중비2, ...]
        curve_row = np.zeros(n_modes + 1)
        curve_row[0] = a
        curve_row[1:] = lf
        curve_list.append(curve_row.reshape(1, -1))

        shapes_list.append(full_modes)

    return CufsmResult(curve=curve_list, shapes=shapes_list)


def _get_free_dofs(node: np.ndarray, nnodes: int, totalm: int) -> np.ndarray:
    """고정되지 않은 자유 DOF 인덱스 목록

    node[:,3:7] = [dofx, dofz, dofy, dofrot] (1=자유, 0=고정)
    글로벌 DOF 배치에 따라 인덱스 매핑

    Returns:
        free_dofs: 자유 DOF 인덱스 배열 (0-based)
    """
    free = []
    skip = 2 * nnodes

    for m_idx in range(totalm):
        base = 4 * nnodes * m_idx
        for n in range(nnodes):
            # 멤브레인 DOF: u (dofx=col3), v (dofz=col4)
            if node[n, 3] == 1:  # dofx → u
                free.append(base + 2 * n)
            if node[n, 4] == 1:  # dofz → v
                free.append(base + 2 * n + 1)
            # 휨 DOF: w (dofy=col5), θ (dofrot=col6)
            if node[n, 5] == 1:  # dofy → w
                free.append(base + skip + 2 * n)
            if node[n, 6] == 1:  # dofrot → θ
                free.append(base + skip + 2 * n + 1)

    return np.array(free, dtype=int)


def _solve_eigenproblem(K: np.ndarray, Kg: np.ndarray,
                        n_eigs: int) -> tuple:
    """일반화 고유치 문제 풀이

    K*x = lambda*Kg*x에서 최소 양의 고유치를 찾는다.
    scipy.linalg.eig 사용 (밀집 행렬, 소규모 문제에 안정적)

    Returns:
        (eigenvalues, eigenvectors)
    """
    from scipy.linalg import eig

    eigenvalues, eigenvectors = eig(K, Kg)

    return eigenvalues, eigenvectors


def _constr_BCFlag(node: np.ndarray, constraints: np.ndarray) -> int:
    """사용자 구속 또는 절점 고정 여부 판별

    원본: Ref_Source/analysis/constr_BCFlag.m

    Returns:
        1 if there are user constraints or node fixities, 0 otherwise
    """
    nnodes = node.shape[0]
    for i in range(nnodes):
        for j in range(3, 7):  # dofx, dofz, dofy, dofrot
            if node[i, j] == 0:
                return 1
    # Check user constraints
    if constraints is None or constraints.size == 0:
        return 0
    if constraints.ndim == 1 and np.all(constraints == 0):
        return 0
    return 1


def _null_space(A: np.ndarray) -> np.ndarray:
    """행렬 A의 영공간 (null space) 계산

    scipy.linalg.null_space 래퍼
    """
    from scipy.linalg import null_space
    if A.size == 0:
        return np.eye(A.shape[1]) if A.ndim == 2 and A.shape[1] > 0 else np.zeros((0, 0))
    return null_space(A)
