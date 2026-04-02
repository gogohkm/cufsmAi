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

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import eigsh

from .element import klocal, kglocal, spring_klocal
from .transform import trans
from .assembly import assemble, spring_assemble
from .properties import elemprop
from models.data import CufsmResult


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

            # 절점 응력 (MATLAB 1-based → Python 0-based)
            Ty1 = node[ni - 1, 7]
            Ty2 = node[nj - 1, 7]

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

                ks = spring_klocal(ku, kv, kw, kq, a, BC, m_a,
                                   bool(discrete), ys)
                K = spring_assemble(K, ks, sni, snj, nnodes, m_a)

        # === DOF 구속 적용 (고정 DOF 제거) ===
        # node 열 3~6: dofx, dofz, dofy, dofrot (1=자유, 0=고정)
        # 자유 DOF만 남김
        free_dofs = _get_free_dofs(node, nnodes, totalm)

        K_csr = K.tocsr()
        Kg_csr = Kg.tocsr()

        # 자유 DOF만 추출
        Kff = K_csr[free_dofs, :][:, free_dofs]
        Kgff = Kg_csr[free_dofs, :][:, free_dofs]

        # === 고유치 풀이 ===
        n_free = len(free_dofs)
        n_eigs = min(2 * neigs, n_free - 1)
        if n_eigs <= 0:
            curve_list.append(np.array([[a, 0.0]]))
            shapes_list.append(np.zeros((ndof, 1)))
            continue

        # Kg 대칭화
        Kgff_sym = (Kgff + Kgff.T) / 2.0
        Kff_dense = Kff.toarray()
        Kgff_dense = Kgff_sym.toarray()

        try:
            # 일반화 고유치 문제: K*x = lambda*Kg*x
            eigenvalues, eigenvectors = _solve_eigenproblem(
                Kff_dense, Kgff_dense, n_eigs)
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

        # 모드형상을 전체 DOF로 복원
        n_modes = len(lf)
        full_modes = np.zeros((ndof, n_modes))
        for m_idx in range(n_modes):
            mode_vec = modes_valid[:, m_idx]
            # 최대값으로 정규화
            max_val = np.max(np.abs(mode_vec))
            if max_val > 0:
                mode_vec = mode_vec / max_val
            full_modes[free_dofs, m_idx] = mode_vec

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
