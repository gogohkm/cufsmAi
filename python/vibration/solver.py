"""자유 진동 해석

참조: 프로젝트개요.md §5.5 자유 진동 해석
원본: Ref_Source/analysis/vibration/stripmain_vib.m, mlocal.m

고유치 문제: [K - omega^2 * M]{Phi} = 0

단위: 엔진 내부 단위(in, kip, s)에서 질량밀도는 kip·s²/in⁴ 이다. 그러면
고유진동수가 Hz 로 나온다. 강재 0.2836 lb/in³ (7850 kg/m³) 은
0.2836 / 386.09 / 1000 = 7.345e-7 kip·s²/in⁴ 이다.
"""

import math

import numpy as np
from scipy.linalg import null_space

from engine.element import klocal, spring_klocal
from engine.transform import trans, spring_trans
from engine.assembly import assemble, spring_assemble
from engine.properties import elemprop
from engine.boundary import BC_I1_5
from design.notices import N as _nt  # noqa: E402

PI = math.pi

# 강재 질량밀도 [kip·s²/in⁴] = 0.2836 lb/in³ ÷ g(386.09 in/s²) ÷ 1000 lb/kip
STEEL_MASS_DENSITY_US = 0.2836 / 386.09 / 1000.0

# 1 kg/m³ = 9.357e-11 kip·s²/in⁴ (경계에서 SI 입력을 바꿀 때 쓴다)
KG_PER_M3_TO_KIP_S2_PER_IN4 = 0.0254 ** 3 / 0.45359237 / 386.0886 / 1000.0

VIBRATION_SCOPE_NOTES = (
    'Undamped free vibration of the strip model with its own (structural) mass only: '
    'no non-structural or added mass, no effect of axial load on the frequencies.',
    'cFSM mode constraints (GBTcon) are not applied in the vibration analysis.',
    'For end conditions other than S-S the frequencies converge from above with the '
    'number of longitudinal terms.',
)

# 구조 재료의 질량밀도 범위 [kip·s²/in⁴]. 목재(≈5e-8)부터 납(≈1.06e-6)까지를
# 넉넉히 덮는다. 밖이면 다른 단위(무게밀도 lb/in³, kg/m³, 또는 1.0)로 본다.
_PLAUSIBLE_RHO = (1.0e-8, 2.0e-6)


def mlocal(rho: float, t: float, a: float, b: float,
           BC: str, m_a: np.ndarray) -> np.ndarray:
    """요소 질량행렬 (로컬 좌표계)

    Args:
        rho: 재료 질량밀도 [kip·s²/in⁴]
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

            # v = (a/(m·pi))·Y'm 이므로 운동에너지는 ∫Y'm·Y'p = I5 (mlocal.m:45-46)
            um = m_a[m] * PI
            up = m_a[p] * PI
            if um != 0 and up != 0:
                mm[1, 1] = rho * t * b * I5 * a**2 / (3 * um * up)
                mm[1, 3] = rho * t * b * I5 * a**2 / (6 * um * up)
                mm[3, 1] = mm[1, 3]
                mm[3, 3] = rho * t * b * I5 * a**2 / (3 * um * up)

            # 휨 질량 4x4 (mlocal.m:57 의 mf(2,1) 에는 여분의 t 가 있다 — 원본
            # 결함이므로 따르지 않는다)
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


def _assemble_springs(K, springs, node, nnodes, a, BC, m_a):
    """스프링 강성을 K 에 더한다 (stripmain_vib.m 의 spring 블록, ys 는 길이 비율)."""
    sp = np.atleast_2d(np.asarray(springs, dtype=float))
    if sp.shape[1] != 10:
        raise ValueError(
            'springs must be (n, 10): [#, nodei, nodej, ku, kv, kw, kq, local, '
            f'discrete, ys]; got shape {sp.shape}')
    for s in range(sp.shape[0]):
        sni = int(sp[s, 1])
        snj = int(sp[s, 2])
        if not (1 <= sni <= nnodes and 0 <= snj <= nnodes):
            raise ValueError(f'spring row {s}: node numbers ({sni}, {snj}) out of range')
        discrete = int(sp[s, 8])
        ys = sp[s, 9] if discrete else 0.0
        ks_l = spring_klocal(sp[s, 3], sp[s, 4], sp[s, 5], sp[s, 6], a, BC, m_a,
                             bool(discrete), ys)
        if snj == 0:
            sp_alpha = 0.0
        else:
            dx = node[snj - 1, 1] - node[sni - 1, 1]
            dz = node[snj - 1, 2] - node[sni - 1, 2]
            if math.hypot(dx, dz) < 1e-10 or int(sp[s, 7]) == 0:
                sp_alpha = 0.0
            else:
                sp_alpha = math.atan2(dz, dx)
        ks = spring_trans(sp_alpha, ks_l, m_a)
        K = spring_assemble(K, ks, sni, snj, nnodes, m_a)
    return K


def _lowest_vibration_modes(Kff, Mff, neigs):
    """K φ = ω² M φ 의 가장 작은 양의 ω² neigs 개 (오름차순)와 모드.

    engine.fsm_solver 의 좌굴 고유치 풀이(_lowest_positive_modes)를 그대로 쓴다:
    K 가 양의 정부호이면 대칭 정부호 문제 M φ = μ K φ (μ = 1/ω²)를 큰 μ 부터
    neigs 개만 풀고(scipy eigh, Cholesky — K 가 정부호가 아니면 LinAlgError),
    아니면(연결 안 된 절점의 0 행 등) 전 고유치 QZ 로 푼다. 예전의 QZ 와 같은
    양 · 유한 · 실수 거르기를 쓴다. K 의 정부호 여부는 Cholesky 시도로 가리므로
    _stiffness_info 의 전 고유치 계산은 하지 않는다.
    """
    from engine import fsm_solver as F
    Ks = (Kff + Kff.T) / 2.0
    Ms = (Mff + Mff.T) / 2.0
    nz = np.any(Ks != 0.0, axis=1)
    k_info = {'nz': nz, 'has_zero_rows': not bool(np.all(nz)), 'scale': None,
              'ev_scaled': np.zeros(0), 'pd': True, 'path': None}
    lam, modes = F._lowest_positive_modes(Ks, Ms, neigs, max(min(2 * neigs, Ks.shape[0]), 1),
                                          k_info)
    modes = np.real(modes)
    nrm = np.linalg.norm(modes, axis=0)
    nrm[nrm == 0.0] = 1.0
    return lam, modes / nrm   # unit 2-norm, as scipy eig returned before


def stripmain_vib(prop: np.ndarray, node: np.ndarray, elem: np.ndarray,
                  lengths: np.ndarray, BC: str, m_all: list,
                  neigs: int = 10, springs=None, constraints=None) -> dict:
    """자유 진동 해석

    prop: [matnum, Ex, Ey, vx, vy, G, rho] — rho 는 질량밀도 [kip·s²/in⁴].
    rho 열이 없으면 강재 7.345e-7 kip·s²/in⁴ 를 쓰고 경고를 남긴다. rho 가
    구조 재료 범위(1e-8 – 2e-6) 밖이면 단위가 틀린 것으로 보고 경고를 남긴다
    (1.0 이면 진동수가 √7.345e-7 ≈ 1/1167 배로 나온다).

    springs: (n, 10) 스프링 [#, nodei, nodej, ku, kv, kw, kq, local, discrete, ys]
    constraints: (n, 5) 사용자 구속 [node_e, dof_e, coeff, node_k, dof_k]
    (stripmain_vib.m 과 같이 K 에 스프링을 더하고 R = null(Ruser') 로 구속한다.
    cFSM 모드 구속(GBTcon)은 반영하지 않는다.)

    Returns:
        dict: {'frequencies': list[np.ndarray] (Hz),
               'shapes': list[np.ndarray] (자유 DOF 벡터; constraints 가 있으면
               전체 DOF 벡터 R·phi),
               'diagnostics', 'success', 'rho_used' (재료별 질량밀도),
               'units': {'frequency': 'Hz', 'rho': 'kip*s^2/in^4'},
               'warnings', 'assumptions', 'scope_notes': 문자열 목록(FIXES §3.1.1)}
    """
    from engine.fsm_solver import _get_free_dofs, _constr_BCFlag
    from cfsm.constraints import constr_user

    nnodes = node.shape[0]
    nelems = elem.shape[0]
    elprop_arr = elemprop(node, elem)

    freq_list = []
    shapes_list = []
    diagnostics = []

    # 재료별 질량밀도
    rho_by_mat = {}
    for row in range(prop.shape[0]):
        matnum = int(prop[row, 0])
        if prop.shape[1] <= 6:
            rho_by_mat[matnum] = STEEL_MASS_DENSITY_US
            continue
        rho = float(prop[row, 6])
        if not rho > 0:
            raise ValueError(
                f'Material {matnum} requires a positive mass density rho in prop column 7 '
                'for vibration analysis')
        rho_by_mat[matnum] = rho
    if prop.shape[1] <= 6:
        diagnostics.append({
            # 기본값으로 채운 입력 = 가정(FIXES §3.1.1), 경고가 아니다
            'severity': 'info', 'category': 'assumption', 'code': 'DEFAULT_DENSITY',
            'length_index': None, 'length': None,
            'message': (_nt('solver.warning.no_mass_density_given')),
        })
    for matnum, rho in rho_by_mat.items():
        if not (_PLAUSIBLE_RHO[0] <= rho <= _PLAUSIBLE_RHO[1]):
            diagnostics.append({
                'severity': 'warning', 'category': 'warning', 'code': 'DENSITY_UNITS_SUSPECT',
                'length_index': None, 'length': None,
                'message': (_nt('solver.warning.material_mass_density_outside', matnum=matnum, rho=rho)),
            })

    has_springs = springs is not None and np.size(springs) > 0
    cons = None
    if constraints is not None and np.size(constraints) > 0:
        cons = np.atleast_2d(np.asarray(constraints, dtype=float))
    use_R = cons is not None and _constr_BCFlag(node, cons) != 0

    for l_idx in range(len(lengths)):
        a = lengths[l_idx]
        m_a = m_all[l_idx]
        totalm = len(m_a)
        ndof = 4 * nnodes * totalm

        # dense 배열로 조립한다 — engine.assembly.assemble 의 색인 경로(F1 R1-04).
        # (K, M) 을 assemble 의 (K, Kg) 자리에 함께 넘긴다.
        K = np.zeros((ndof, ndof))
        M = np.zeros((ndof, ndof))

        for e in range(nelems):
            ni = int(elem[e, 1])
            nj = int(elem[e, 2])
            t = elem[e, 3]
            matnum = int(elem[e, 4])

            mat_idx = np.where(prop[:, 0] == matnum)[0]
            if len(mat_idx) == 0:
                # fail-fast like MATLAB stripmain.m find(); no silent fallback to material 0
                raise ValueError(
                    f'Element {e}: material number {matnum} not found in prop '
                    f'(available: {prop[:, 0].tolist()})')
            mat_idx = mat_idx[0]
            Ex = prop[mat_idx, 1]
            Ey = prop[mat_idx, 2]
            vx = prop[mat_idx, 3]
            vy = prop[mat_idx, 4]
            G = prop[mat_idx, 5]
            rho = rho_by_mat[int(prop[mat_idx, 0])]

            b = elprop_arr[e, 1]
            alpha = elprop_arr[e, 2]

            # 강성 · 질량행렬 (같은 좌표변환을 한 번에)
            k_loc = klocal(Ex, Ey, vx, vy, G, t, a, b, BC, m_a)
            m_loc = mlocal(rho, t, a, b, BC, m_a)
            k_glob, m_glob = trans(alpha, k_loc, m_loc, m_a)
            K, M = assemble(K, M, k_glob, m_glob, ni, nj, nnodes, m_a)

        if has_springs:
            K = _assemble_springs(K, springs, node, nnodes, a, BC, m_a)

        # DOF 구속
        if not use_R:
            free_dofs = _get_free_dofs(node, nnodes, totalm)
            Kff = K[np.ix_(free_dofs, free_dofs)]
            Mff = M[np.ix_(free_dofs, free_dofs)]
            R = None
            n_free = len(free_dofs)
        else:
            # stripmain_vib.m: R = null(null(Ruser')') — 절점 고정과 사용자 구속
            Ruser = constr_user(node, cons, m_a)
            Ru0 = null_space(Ruser.T)
            R = null_space(Ru0.T) if Ru0.shape[1] > 0 else np.eye(ndof)
            Kff = R.T @ K @ R
            Mff = R.T @ M @ R
            n_free = R.shape[1]

        if n_free == 0:
            diagnostics.append({
                'severity': 'error', 'code': 'NO_FREE_DOF',
                'length_index': l_idx, 'length': float(a),
                'message': _nt('fsm_solver.warning.no_free_degrees_freedom'),
            })
            freq_list.append(np.array([0.0]))
            shapes_list.append(np.zeros((0, 1)))
            continue

        try:
            lam, modes = _lowest_vibration_modes(Kff, Mff, neigs)
            if len(lam) == 0:
                diagnostics.append({
                    'severity': 'error', 'code': 'NO_POSITIVE_EIGENVALUE',
                    'length_index': l_idx, 'length': float(a),
                    'message': _nt('fsm_solver.warning.eigensolver_returned_no_finite'),
                })
                freq_list.append(np.array([0.0]))
                shapes_list.append(np.zeros((n_free, 1)))
                continue
            freqs = np.sqrt(lam) / (2 * PI)  # Hz
            freq_list.append(freqs)
            shapes_list.append(R @ modes if R is not None else modes)
        except Exception as exc:
            diagnostics.append({
                'severity': 'error', 'code': 'EIGENSOLVE_FAILED',
                'length_index': l_idx, 'length': float(a),
                'message': _nt('fsm_solver.warning.exception', exc_type=type(exc).__name__, exc=exc),
            })
            freq_list.append(np.array([0.0]))
            shapes_list.append(np.zeros((n_free, 1)))

    return {
        'frequencies': freq_list, 'shapes': shapes_list,
        'diagnostics': diagnostics,
        'success': not any(d.get('severity') == 'error' for d in diagnostics),
        'rho_used': {int(k): float(v) for k, v in rho_by_mat.items()},
        'units': {'frequency': 'Hz', 'rho': 'kip*s^2/in^4'},
        # FIXES §3.1.1: warnings = 값을 바꿨거나 손봐야 하는 것, assumptions = 이 실행의
        # 가정, scope_notes = 입력과 상관없이 늘 참인 범위
        'warnings': [d['message'] for d in diagnostics
                     if d.get('severity') in ('warning', 'error')],
        'assumptions': [d['message'] for d in diagnostics
                        if d.get('category') == 'assumption'],
        'scope_notes': list(VIBRATION_SCOPE_NOTES),
    }
