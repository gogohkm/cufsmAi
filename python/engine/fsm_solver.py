"""유한스트립법 좌굴 해석 메인 솔버

참조: 프로젝트개요.md §4 해석 워크플로우, §5.1 FSM 해석 엔진
참조: 컨버전전략.md §6 수치해석 매핑 (eigs → eigsh)
원본: Ref_Source/analysis/stripmain.m

해석 흐름:
  [0] 입력 검사, msort (stripmain.m:82)
  [1] elemprop() → 요소 폭, 각도
  [2] 각 길이에 대해:
      a. K, Kg 초기화
      b. 요소 루프: klocal → kglocal → trans → assemble
      c. 스프링 조립
      d. DOF 구속 적용
      e. 고유치 풀이
      f. 반올림 오차 추정, 결과 정리
"""

import math

import numpy as np

from .element import klocal, kglocal, spring_klocal
from .transform import trans, spring_trans
from .assembly import assemble, spring_assemble
from .boundary import VALID_BCS
from .helpers import msort
from .properties import elemprop
from models.data import CufsmResult, GBTConfig

_EPS = np.finfo(float).eps

# 1차 모드 고유치의 반올림 오차 추정치(상대) 한계 (_rounding_error_estimate).
# eigh 경로의 대각 스케일 추정치는 같은 K 에 DOF 순열 + 성분별 ±eps 섭동을 준
# 실측 흔들림(최대 − 최소)의 약 1.2 – 5 배다(립 C · 둥근 립 C · 트랙 · CHS).
# 0.1 이면 흔들림이 수 % 에 이르는 길이를 버린다.
ILL_COND_WARN = 1e-2
ILL_COND_ERROR = 0.1

# m_recommend 는 언제나 1..7 (helpers.GLOBAL_TERMS) 을 넣으므로 적어도 7 개 항을 낸다.
_MIN_RECOMMENDED_TERMS = 7


def stripmain(prop: np.ndarray, node: np.ndarray, elem: np.ndarray,
              lengths: np.ndarray, springs: np.ndarray,
              constraints: np.ndarray, GBTcon, BC: str,
              m_all: list, neigs: int = 10,
              half_wavelengths: dict = None) -> CufsmResult:
    """FSM 좌굴 해석 메인 루틴

    Args:
        prop: (nmats, 6) [matnum, Ex, Ey, vx, vy, G]
        node: (nnodes, 8) [node#, x, z, dofx, dofz, dofy, dofrot, stress]
        elem: (nelems, 5) [elem#, nodei, nodej, t, matnum]
        lengths: (nlengths,) 해석 길이 배열
        springs: (nsprings, 10) 스프링 데이터 또는 빈 배열. 스프링 하나는 (10,) 도 된다.
        constraints: (nconstraints, 5) 구속조건 또는 빈 배열
        GBTcon: GBTConfig 객체 (cFSM 모드 구속)
        BC: 경계조건 문자열 ('S-S','C-C','S-C','C-S','C-F','F-C','C-G','G-C')
        m_all: list[np.ndarray] — 각 길이별 종방향 항. MATLAB 처럼 msort 로
            0 · 중복을 지우고 오름차순으로 정리한 뒤 쓴다(shapes 도 그 순서).
            S-S 가 아닌 BC 에서는 helpers.m_recommend 로 고른 항을 넘겨야 한다.
        neigs: 계산할 고유치 수 (≥ 1)
        half_wavelengths: (선택) helpers.m_recommend_details 또는
            characteristic_half_wavelengths 의 결과 dict ('Lcrl', 'Lcrd', 'minima').
            주면 S-S 가 아닌 BC 의 항 부족 진단에서 서명 곡선을 다시 풀지 않는다.

    Returns:
        CufsmResult(curve, shapes, diagnostics). 정리된 항은 result.m_all 에 싣는다.

    Raises:
        ValueError: 입력 모양 · 값이 잘못된 경우
    """
    (prop, node, elem, lengths, springs, constraints, m_all, neigs,
     elprop) = _validate_inputs(prop, node, elem, lengths, springs,
                                constraints, BC, m_all, neigs)
    nnodes = node.shape[0]
    nelems = elem.shape[0]

    curve_list = []
    shapes_list = []
    diagnostics = []

    m_all_raw = m_all
    m_all = msort(m_all)
    for i, (raw, m_a) in enumerate(zip(m_all_raw, m_all)):
        if len(m_a) == 0:
            raise ValueError(
                f"m_all[{i}] has no nonzero longitudinal term after msort")
        if len(m_a) != len(raw) or np.any(m_a != raw):
            diagnostics.append({
                'severity': 'info', 'code': 'LONGITUDINAL_TERMS_SORTED',
                'length_index': i, 'length': float(lengths[i]),
                'message': (f'm_all[{i}] was cleaned by msort (zeros and duplicates '
                            f'removed, ascending order): {m_a.tolist()}'),
            })

    if BC != 'S-S':
        diagnostics.extend(_longitudinal_term_diagnostics(
            prop, node, elem, lengths, BC, m_all, half_wavelengths))

    # cFSM 모드 분류 활성화 여부
    cFSM_analysis = (isinstance(GBTcon, GBTConfig) and GBTcon.is_active())
    if cFSM_analysis:
        diagnostics.extend(_cfsm_constraint_diagnostics(node, elem, GBTcon, prop))
    # BCFlag 판별: 사용자 구속 또는 절점 고정이 있는지 (stripmain.m line 84: constr_BCFlag)
    BCFlag = _constr_BCFlag(node, constraints)

    for length_idx in range(len(lengths)):
        a = lengths[length_idx]
        m_a = m_all[length_idx]
        totalm = len(m_a)
        ndof = 4 * nnodes * totalm

        # 전체 행렬 (dense — 아래에서 어차피 dense 고유치 풀이를 한다)
        K = np.zeros((ndof, ndof))
        Kg = np.zeros((ndof, ndof))

        # === 요소 루프: 강성행렬 조립 ===
        for e in range(nelems):
            # 요소 절점 (MATLAB 1-based)
            ni = int(elem[e, 1])
            nj = int(elem[e, 2])
            t = elem[e, 3]
            matnum = int(elem[e, 4])

            # 재료 물성 찾기 (MATLAB: row=find(matnum==prop(:,1)) — 미정의 시 fail-fast)
            mat_idx = np.where(prop[:, 0] == matnum)[0]
            if len(mat_idx) == 0:
                raise ValueError(
                    f"Element {int(elem[e, 0])} references undefined material "
                    f"{matnum}; available: {prop[:, 0].astype(int).tolist()}"
                )
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
        for s in range(springs.shape[0]):
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
        K_dense = K
        Kg_dense = Kg

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
        # scipy.linalg.eig 는 전 고유치를 구하므로 n_eigs 는 풀이 개수를 줄이지 않는다
        # (MATLAB eigs(...,'SM') 보다 양의 고유치를 놓칠 위험이 적다).
        n_eigs = max(min(2 * neigs, n_free), 1)
        if n_free <= 0:
            diagnostics.append({
                'severity': 'error', 'code': 'NO_FREE_DOF',
                'length_index': length_idx, 'length': float(a),
                'message': 'No free degrees of freedom remain after constraints.',
            })
            curve_list.append(np.array([[a, 0.0]]))
            shapes_list.append(np.zeros((ndof, 1)))
            continue

        # Kg 대칭화
        Kgff_sym = (Kgff + Kgff.T) / 2.0
        # 대각 스케일한 K 의 고유치 (양의 정부호 판정 · 조건수 추정에 같이 쓴다)
        k_info = _stiffness_info(Kff)

        try:
            lf, modes_valid = _lowest_positive_modes(
                Kff, Kgff_sym, neigs, n_eigs, k_info)
        except Exception as exc:
            diagnostics.append({
                'severity': 'error', 'code': 'EIGENSOLVE_FAILED',
                'length_index': length_idx, 'length': float(a),
                'message': f'{type(exc).__name__}: {exc}',
            })
            curve_list.append(np.array([[a, 0.0]]))
            shapes_list.append(np.zeros((ndof, 1)))
            continue

        if len(lf) == 0:
            diagnostics.append({
                'severity': 'error', 'code': 'NO_POSITIVE_EIGENVALUE',
                'length_index': length_idx, 'length': float(a),
                'message': 'The eigensolver returned no finite positive real eigenvalue.',
            })
            curve_list.append(np.array([[a, 0.0]]))
            shapes_list.append(np.zeros((ndof, 1)))
            continue

        # 반올림 오차 추정 — 길이가 아주 길면 cond(K) ∝ L⁴ 로 1차 고유치가 무너진다
        err_est = _rounding_error_estimate(Kff, modes_valid[:, 0], k_info)
        if err_est > ILL_COND_WARN:
            is_error = err_est > ILL_COND_ERROR
            diagnostics.append({
                'severity': 'error' if is_error else 'warning',
                'code': 'ILL_CONDITIONED',
                'length_index': length_idx, 'length': float(a),
                # 비정부호 K(추정 불가)는 JSON 에 inf 를 싣지 않고 None
                'error_estimate': float(err_est) if math.isfinite(err_est) else None,
                'message': (
                    f'Length {float(a):g}: estimated round-off error of the first '
                    f'load factor is {err_est:.1e} (relative). The stiffness matrix '
                    f'is ill-conditioned (membrane/bending stiffness ratio grows '
                    f'with L^4). '
                    + ('The result is discarded.' if is_error else
                       'The result may be inaccurate.')),
            })
            if is_error:
                curve_list.append(np.array([[a, 0.0]]))
                shapes_list.append(np.zeros((ndof, 1)))
                continue

        # 모드형상을 전체 DOF로 복원 (stripmain.m line 381: mode = R*modes)
        n_modes = len(lf)
        if R is not None:
            full_modes_raw = R @ modes_valid
        else:
            # R == None: free_dofs 방식
            full_modes_raw = np.zeros((ndof, n_modes))
            full_modes_raw[free_dofs, :] = modes_valid

        # 정규화: 절댓값 최대 성분을 +1.0 으로 (stripmain.m line 386-389, 부호 포함)
        full_modes = np.zeros((ndof, n_modes))
        for m_idx in range(n_modes):
            mode_vec = full_modes_raw[:, m_idx]
            imax = int(np.argmax(np.abs(mode_vec)))
            if mode_vec[imax] != 0:
                mode_vec = mode_vec / mode_vec[imax]
            full_modes[:, m_idx] = mode_vec

        # 곡선 데이터: [길이, 하중비1, 하중비2, ...]
        curve_row = np.zeros(n_modes + 1)
        curve_row[0] = a
        curve_row[1:] = lf
        curve_list.append(curve_row.reshape(1, -1))

        shapes_list.append(full_modes)

    result = CufsmResult(curve=curve_list, shapes=shapes_list,
                         diagnostics=diagnostics)
    # 정리된 종방향 항 — shapes 의 DOF 배치가 이 순서를 따른다
    result.m_all = m_all
    return result


def _validate_inputs(prop, node, elem, lengths, springs, constraints,
                     BC, m_all, neigs):
    """stripmain 입력 검사. 잘못된 입력은 계산하지 않고 ValueError 로 거절한다."""
    if BC not in VALID_BCS:
        raise ValueError(
            f"Unknown boundary condition {BC!r}; expected one of {list(VALID_BCS)}")

    prop = np.atleast_2d(np.asarray(prop, dtype=float))
    if prop.ndim != 2 or prop.shape[1] < 6 or prop.shape[0] == 0:
        raise ValueError(f"prop must be (nmats, 6) [matnum Ex Ey vx vy G]; got shape {prop.shape}")
    if not np.all(np.isfinite(prop[:, :6])):
        raise ValueError("prop contains non-finite values")
    if np.any(prop[:, [1, 2, 5]] <= 0):
        raise ValueError("prop Ex, Ey and G must be positive")

    node = np.asarray(node, dtype=float)
    if node.ndim != 2 or node.shape[1] < 8 or node.shape[0] < 2:
        raise ValueError(f"node must be (nnodes>=2, 8); got shape {node.shape}")
    if not np.all(np.isfinite(node[:, :8])):
        raise ValueError("node contains non-finite coordinates, DOF flags or stresses")
    nnodes = node.shape[0]

    elem = np.asarray(elem, dtype=float)
    if elem.ndim != 2 or elem.shape[1] < 5 or elem.shape[0] == 0:
        raise ValueError(f"elem must be (nelems, 5); got shape {elem.shape}")
    if not np.all(np.isfinite(elem[:, :5])):
        raise ValueError("elem contains non-finite values")
    ends = elem[:, 1:3]
    if np.any(ends != np.round(ends)) or np.any(ends < 1) or np.any(ends > nnodes):
        bad = int(elem[np.any((ends < 1) | (ends > nnodes) | (ends != np.round(ends)),
                              axis=1)][0, 0])
        raise ValueError(f"Element {bad} references a node outside 1..{nnodes}")
    if np.any(elem[:, 3] <= 0):
        bad = int(elem[elem[:, 3] <= 0][0, 0])
        raise ValueError(f"Element {bad} has non-positive thickness")
    elprop = elemprop(node, elem)
    if np.any(elprop[:, 1] <= 1e-12):
        bad = int(elem[elprop[:, 1] <= 1e-12][0, 0])
        raise ValueError(f"Element {bad} has zero width (coincident end nodes)")

    lengths = np.atleast_1d(np.asarray(lengths, dtype=float))
    if lengths.ndim != 1 or lengths.size == 0:
        raise ValueError("lengths must be a non-empty 1-D array")
    if not np.all(np.isfinite(lengths)) or np.any(lengths <= 0):
        raise ValueError("every length must be finite and > 0")

    if m_all is None or len(m_all) != len(lengths):
        n = 0 if m_all is None else len(m_all)
        raise ValueError(
            f"m_all must give one array of longitudinal terms per length "
            f"(len(m_all)={n}, len(lengths)={len(lengths)}); "
            f"use engine.helpers.m_recommend for non S-S boundary conditions")
    m_clean = []
    for i, m in enumerate(m_all):
        arr = np.atleast_1d(np.asarray(m, dtype=float)).reshape(-1)
        if not np.all(np.isfinite(arr)):
            raise ValueError(f"m_all[{i}] contains non-finite terms")
        if np.any(arr < 0) or np.any(arr != np.round(arr)):
            raise ValueError(
                f"m_all[{i}] = {arr.tolist()}: longitudinal terms must be positive integers")
        m_clean.append(arr)

    if isinstance(neigs, bool) or int(neigs) != neigs or int(neigs) < 1:
        raise ValueError(f"neigs must be an integer >= 1; got {neigs!r}")
    neigs = int(neigs)

    springs = _normalize_springs(springs, nnodes)
    constraints = _normalize_constraints(constraints, nnodes)
    return (prop, node, elem, lengths, springs, constraints, m_clean, neigs,
            elprop)


def _normalize_springs(springs, nnodes):
    """스프링을 (n, 10) 으로 정리. 없으면 (0, 10).

    MATLAB stripmain.m:226 은 1×10 행 하나를 스프링 하나로 받는다. 0 하나(또는
    전부 0)는 "스프링 없음"의 표시로 다룬다.
    """
    if springs is None:
        return np.zeros((0, 10))
    sp = np.asarray(springs, dtype=float)
    if sp.size == 0 or np.all(sp == 0):
        return np.zeros((0, 10))
    sp = np.atleast_2d(sp)
    if sp.ndim != 2 or sp.shape[1] != 10:
        raise ValueError(
            f"springs must be (nsprings, 10) [num nodei nodej ku kv kw kq local "
            f"discrete ys]; got shape {sp.shape}")
    if not np.all(np.isfinite(sp)):
        raise ValueError("springs contain non-finite values")
    for r in range(sp.shape[0]):
        ni, nj = sp[r, 1], sp[r, 2]
        if ni != round(ni) or not 1 <= ni <= nnodes:
            raise ValueError(f"spring row {r}: nodei {ni:g} outside 1..{nnodes}")
        if nj != round(nj) or not 0 <= nj <= nnodes:
            raise ValueError(f"spring row {r}: nodej {nj:g} outside 0..{nnodes} (0 = ground)")
        if sp[r, 8] not in (0, 1):
            raise ValueError(f"spring row {r}: discrete flag must be 0 or 1")
        if sp[r, 8] == 1 and not 0.0 <= sp[r, 9] <= 1.0:
            raise ValueError(
                f"spring row {r}: discrete spring position ys={sp[r, 9]:g} must be "
                f"a fraction of the length in [0, 1]")
    return sp


def _normalize_constraints(constraints, nnodes):
    """구속식을 (n, 5) 로 정리. 없으면 빈 배열(constr_BCFlag 와 같은 뜻)."""
    if constraints is None:
        return np.array([])
    c = np.asarray(constraints, dtype=float)
    if c.size == 0 or np.all(c == 0):
        return np.array([])
    c = np.atleast_2d(c)
    if c.ndim != 2 or c.shape[1] < 5:
        raise ValueError(
            f"constraints must be (n, 5) [node_e dof_e coeff node_k dof_k]; got shape {c.shape}")
    if not np.all(np.isfinite(c[:, :5])):
        raise ValueError("constraints contain non-finite values")
    for r in range(c.shape[0]):
        for col in (0, 3):
            n = c[r, col]
            if n != round(n) or not 1 <= n <= nnodes:
                raise ValueError(f"constraint row {r}: node {n:g} outside 1..{nnodes}")
        for col in (1, 4):
            if c[r, col] not in (1, 2, 3, 4):
                raise ValueError(
                    f"constraint row {r}: DOF code {c[r, col]:g} must be 1 (x), 2 (z), "
                    f"3 (y) or 4 (theta)")
    return c


def _longitudinal_term_diagnostics(prop, node, elem, lengths, BC, m_all,
                                   half_wavelengths=None):
    """S-S 가 아닌 BC 에서 m_recommend(CUFSM) 권장 항이 빠진 길이를 경고한다.

    m_all 은 바꾸지 않는다. 권장 항은 언제나 1..7 을 포함하므로, 그중 하나라도
    빠지면 서명 곡선을 풀지 않고 바로 부족으로 본다. half_wavelengths
    (m_recommend_details 의 결과)를 주면 서명 곡선을 다시 풀지 않는다.
    """
    from .helpers import (GLOBAL_TERMS, characteristic_half_wavelengths,
                          terms_from_half_wavelengths)

    diags = []
    lcr = None
    if half_wavelengths is not None:
        if not isinstance(half_wavelengths, dict) or 'Lcrl' not in half_wavelengths                 or 'Lcrd' not in half_wavelengths:
            raise ValueError("half_wavelengths must be the dict returned by "
                             "engine.helpers.m_recommend_details (keys 'Lcrl', 'Lcrd')")
        lcr = half_wavelengths
    for i, (a, m_a) in enumerate(zip(lengths, m_all)):
        have = set(int(m) for m in m_a)
        if len(have) < _MIN_RECOMMENDED_TERMS or not set(GLOBAL_TERMS) <= have:
            diags.append({
                'severity': 'warning', 'code': 'INSUFFICIENT_LONGITUDINAL_TERMS',
                'length_index': i, 'length': float(a),
                'message': (
                    f'BC {BC}: length {float(a):g} is solved with longitudinal terms '
                    f'{sorted(have)}. A non S-S member needs the terms from m_recommend '
                    f'(1..7 plus terms near L/Lcr); with too few terms local '
                    f'and distortional buckling are missed and the load factor is '
                    f'overestimated (unconservative). ' + _NON_SS_GLOBAL_NOTE),
            })
            continue
        if lcr is None:
            try:
                lcr = characteristic_half_wavelengths(prop, node, elem)
            except Exception as exc:  # 서명 곡선 실패 — 판단 불가를 알린다
                lcr = {'error': f'{type(exc).__name__}: {exc}'}
        if 'error' in lcr:
            diags.append({
                'severity': 'warning', 'code': 'INSUFFICIENT_LONGITUDINAL_TERMS',
                'length_index': i, 'length': float(a),
                'message': (f'BC {BC}: could not verify the longitudinal terms at length '
                            f'{float(a):g} against m_recommend ({lcr["error"]}).'),
            })
            continue
        need = set(int(m) for m in terms_from_half_wavelengths(a, lcr))
        missing = sorted(need - have)
        if missing:
            diags.append({
                'severity': 'warning', 'code': 'INSUFFICIENT_LONGITUDINAL_TERMS',
                'length_index': i, 'length': float(a),
                'missing_terms': missing,
                'message': (
                    f'BC {BC}: length {float(a):g} lacks longitudinal terms recommended '
                    f'by m_recommend (Lcrl={_fmt(lcr["Lcrl"])}, Lcrd={_fmt(lcr["Lcrd"])}): '
                    f'missing {missing}. Local or distortional buckling may be missed '
                    f'(unconservative). ' + _NON_SS_GLOBAL_NOTE),
            })
    return diags


_NON_SS_GLOBAL_NOTE = (
    'Even with the recommended terms, long-length (global) values of a non S-S curve '
    'keep a few per cent series-truncation error on the high side; do not use them '
    'as Pcre/Mcre (take global buckling from the closed forms).')


def _fmt(v):
    return 'none' if v is None else f'{v:.4g}'


def _cfsm_constraint_diagnostics(node, elem, GBTcon, prop):
    """cFSM 모드 구속 해석의 해석상 한계를 알린다 (결과 값은 바꾸지 않는다).

    - G 공간만 고른 구속해는 막 변형률을 GBT 가정으로 묶어 고전 전체좌굴의
      1/(1−ν²) 배(ν=0.3 에서 +9.9 %)가 된다(MATLAB 도 같음). Pcre · Mcre 로 쓰면
      비안전측이다.
    - 고전 cFSM 의 전제(열린 · 가지 없는 · 날카로운 모서리 단면)가 깨지는 모델
      (cfsm.node_utils.check_cfsm_model)에서는 G/D/L/O 공간이 물리적 모드가 아니다.
    """
    diags = []

    def total(v):
        arr = np.asarray(v, dtype=float).reshape(-1)
        return float(np.sum(arr)) if arr.size else 0.0
    g, d, loc, o = (total(GBTcon.glob), total(GBTcon.dist),
                  total(GBTcon.local), total(GBTcon.other))
    if g > 0 and d == 0 and loc == 0 and o == 0:
        nu = float(prop[0, 3])
        diags.append({
            'severity': 'warning', 'code': 'CFSM_GLOBAL_ONLY',
            'message': (
                'cFSM constrained to the global (G) space: the load factor is the '
                'classical global value times about 1/(1-nu^2) '
                f'(+{100 * (1 / (1 - nu * nu) - 1):.1f} % for nu={nu:g}) because the '
                'GBT assumptions restrain transverse membrane strain. Do not use it '
                'as Pcre/Mcre; use the unconstrained FSM curve or the AISI closed form.'),
        })
    try:
        from cfsm.node_utils import check_cfsm_model
        chk = check_cfsm_model(node, elem)
    except Exception as exc:  # 판정 실패도 알린다
        chk = {'supported': False, 'code': 'CHECK_FAILED',
               'message': f'{type(exc).__name__}: {exc}'}
    if not chk.get('supported', False):
        diags.append({
            'severity': 'warning', 'code': 'CFSM_MODEL_NOT_SUPPORTED',
            'cfsm_code': chk.get('code'),
            'message': (
                'cFSM constrained analysis on a model outside classical cFSM '
                f'({chk.get("code")}: {chk.get("message")}). The G/D/L/O spaces are '
                'not the physical buckling modes for this model; the constrained '
                'load factors are not pure-mode values.'),
        })
    return diags


def _stiffness_info(K: np.ndarray) -> dict:
    """대칭화한 K 의 대각 스케일 고유치와 정부호 여부.

    값이 전부 0 인 행 · 열(어디에도 연결되지 않은 절점의 DOF)은 빼고 본다.
    대각 스케일(Kd = D K D, D = diag(K)^-1/2)은 큰 접지 스프링처럼 대각에만 있는
    큰 값이 만드는 조건수를 없앤다. Cholesky 기반 풀이의 정확도는 이 스케일
    조건수를 따른다(van der Sluis).

    Returns:
        dict: {'nz', 'has_zero_rows', 'scale', 'ev_scaled', 'pd', 'path'}
    """
    Ks = (K + K.T) / 2.0
    nz = np.any(Ks != 0.0, axis=1)
    info = {'nz': nz, 'has_zero_rows': not bool(np.all(nz)), 'scale': None,
            'ev_scaled': np.zeros(0), 'pd': False, 'path': None}
    if not np.any(nz):
        return info
    Kn = Ks[np.ix_(nz, nz)]
    diag = np.diag(Kn)
    if np.all(diag > 0.0):
        d = 1.0 / np.sqrt(diag)
        ev = np.linalg.eigvalsh(Kn * d[:, None] * d[None, :])
        info['scale'] = d
        info['ev_scaled'] = ev
        info['pd'] = bool(ev[0] > 0.0)
    return info


def _lowest_positive_modes(K: np.ndarray, Kg: np.ndarray, neigs: int,
                           n_eigs: int, k_info: dict) -> tuple:
    """K x = λ Kg x 의 가장 작은 양의 유한 고유치 neigs 개와 모드 (오름차순).

    K 가 양의 정부호이면 대칭 정부호 문제 Kg x = μ K x (μ = 1/λ)를 큰 μ 부터
    neigs 개만 푼다(scipy.linalg.eigh, LAPACK sygvx). 양의 λ 의 작은 순서가
    양의 μ 의 큰 순서와 같고, Kg 의 영공간(λ = ∞)은 μ = 0 이 되어 저절로
    빠진다. 전 고유치 QZ(scipy.linalg.eig) 보다 훨씬 빠르다.
    K 가 정부호가 아니면(연결 안 된 절점 등) 원래의 QZ 경로로 푼다.
    어느 경로로 풀었는지 k_info['path'] 에 'eigh' / 'qz' 로 남긴다.
    """
    from scipy.linalg import eigh

    n = K.shape[0]
    if k_info['pd'] and not k_info['has_zero_rows']:
        k = min(neigs, n)
        Ks = (K + K.T) / 2.0
        try:
            mu, vec = eigh(Kg, Ks, subset_by_index=[n - k, n - 1])
        except np.linalg.LinAlgError:
            mu = None
        if mu is not None:
            k_info['path'] = 'eigh'
            order = np.argsort(-mu)
            mu = mu[order]
            vec = vec[:, order]
            pos = mu > 0.0
            lf = 1.0 / mu[pos]
            keep = np.isfinite(lf)
            return lf[keep], vec[:, pos][:, keep]

    k_info['path'] = 'qz'
    eigenvalues, eigenvectors = _solve_eigenproblem(K, Kg, n_eigs)
    # 양의 실수 고유치만 필터링 및 정렬
    # stripmain.m line 364: find(lf>0 & imag(abs(lf))<0.00001) 의 의도(real() cast 포함)는
    # |imag(lf)|<1e-5. 더불어 singular Kg 에서 나오는 inf(+0j) 를 isfinite 로 명시 제거.
    valid = np.where(
        (np.abs(np.imag(eigenvalues)) < 1e-5)
        & (np.real(eigenvalues) > 0)
        & np.isfinite(np.real(eigenvalues))
    )[0]
    lf = np.real(eigenvalues[valid])
    modes = np.real(eigenvectors[:, valid])
    sort_idx = np.argsort(lf)[:neigs]
    return lf[sort_idx], modes[:, sort_idx]


def _rounding_error_estimate(K: np.ndarray, x: np.ndarray, k_info: dict) -> float:
    """1차 고유치의 반올림 상대오차 추정.

    두 값 중 큰 쪽:
      - 돌려줄 1차 모드 x 의 섭동 한계 eps·‖K‖₂·‖x‖²/|xᵀKx|
      - eps·cond₂(K). 가장 무른 방향(긴 길이의 전체좌굴)이 반올림에 묻히면
        진짜 1차 고유치가 음수 · 복소수로 밀려나 걸러지고 더 높은 모드가 1차로
        나온다. 그 모드 자신의 섭동 한계는 작으므로 K 전체의 조건수로 잡는다.
    eigh(Cholesky) 경로는 대각 스케일한 K 로 계산한다(대각 스케일에 불변인
    풀이이므로). QZ 경로는 스케일에 불변이 아니므로 스케일하지 않은 K 로 본다.
    K 를 만들 때의 성분별 반올림(eps)만으로 같은 크기의 흔들림이 나므로(어느
    고유치 풀이법을 써도) 정확도를 되살리는 대신 결과를 표시 · 폐기한다.
    """
    nz = k_info['nz']
    if not np.any(nz):
        return math.inf
    xn = x[nz]
    Kn = ((K + K.T) / 2.0)[np.ix_(nz, nz)]
    if k_info['path'] == 'eigh' and k_info['scale'] is not None:
        ev = k_info['ev_scaled']
        y = xn / k_info['scale']          # x = D y
        Kn = Kn * k_info['scale'][:, None] * k_info['scale'][None, :]
        xn = y
    else:
        ev = np.linalg.eigvalsh(Kn)
    if len(ev) == 0:
        return math.inf
    norm2 = float(max(abs(ev[0]), abs(ev[-1])))
    cond_term = math.inf if ev[0] <= 0.0 else _EPS * norm2 / float(ev[0])
    q = abs(float(xn @ Kn @ xn))
    if q == 0.0 or not np.isfinite(q):
        return math.inf
    mode_term = _EPS * norm2 * float(xn @ xn) / q
    return max(cond_term, mode_term)


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
            # CUFSM DOF 규약 (constr_user.m, assemble.m 기준):
            #   col3 dofx → 멤브레인 slot1 u (base+2n)
            #   col4 dofz → 휨 slot1 w (base+skip+2n)   [out-of-plane]
            #   col5 dofy → 멤브레인 slot2 v (base+2n+1) [longitudinal]
            #   col6 dofrot → 휨 slot2 θ (base+skip+2n+1)
            if node[n, 3] == 1:  # dofx → u (멤브레인)
                free.append(base + 2 * n)
            if node[n, 4] == 1:  # dofz → w (휨)
                free.append(base + skip + 2 * n)
            if node[n, 5] == 1:  # dofy → v (멤브레인)
                free.append(base + 2 * n + 1)
            if node[n, 6] == 1:  # dofrot → θ (휨)
                free.append(base + skip + 2 * n + 1)

    return np.array(free, dtype=int)


def _solve_eigenproblem(K: np.ndarray, Kg: np.ndarray,
                        n_eigs: int) -> tuple:
    """일반화 고유치 문제 풀이

    K*x = lambda*Kg*x에서 최소 양의 고유치를 찾는다.
    scipy.linalg.eig 사용 (밀집 행렬, 전 고유치 — n_eigs 는 쓰지 않는다)

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
