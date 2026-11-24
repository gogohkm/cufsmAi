"""fcFSM 자리 — 아직 MATLAB fcFSM 의 이식이 아니다

참조: 프로젝트개요.md §5.3 힘 기반 구속 FSM
원본(이식 대상, 미이식): Ref_Source/analysis/fcFSM/stripmain_fcFSM.m, SecAnal_fcFSM.m

지금 이 함수가 하는 일:
  1. 구속 없는 보통 FSM 고유치 해석 (곡선·모드형상은 stripmain 과 같다)
  2. 모드 분류는 고전 cFSM(`cfsm.classify`, 길이·BC·m 마다 기저)으로 한다.
     고전 cFSM 이 다루지 못하는 둥근 모서리·폐단면·가지 단면은 NaN 이다.

MATLAB fcFSM 은 판 단위 힘 [q] 로 J_GD, C_L = null(J_GD'), C_D = inv(K)·J_GD·J_D,
C_G = inv(K)·J_GD·J_G 를 각 길이의 K 로 만들고 변형에너지 비로 분류한다. 둥근
모서리(cornerStrips)를 다루는 것이 fcFSM 의 목적인데, 그 부분은 여기 없다.
결과의 'is_fcfsm' 은 언제나 False 이고 'method' 가 실제 계산을 밝힌다.
"""

import numpy as np

FCFSM_METHOD = 'fsm_eigen+classical_cfsm_classification'
FCFSM_WARNING = ('fcFSM is not implemented: the curve is an unconstrained FSM solution '
                 'and the G/D/L/O split comes from classical cFSM, which is not valid for '
                 'rounded corners (left unclassified there). Do not report it as fcFSM.')


def stripmain_fcfsm(prop: np.ndarray, node: np.ndarray, elem: np.ndarray,
                    lengths: np.ndarray, BC: str, m_all: list,
                    neigs: int = 10) -> dict:
    """보통 FSM 좌굴 해석 + 고전 cFSM 분류 (fcFSM 아님 — 모듈 설명 참조)

    Returns:
        dict: {
            'curve': list[np.ndarray],
            'shapes': list[np.ndarray],
            'classification': list[np.ndarray],  # [%G, %D, %L, %O], NaN = 미분류
            'method': FCFSM_METHOD, 'is_fcfsm': False,
            'classification_status': cfsm.classify 의 상태 요약,
            'warnings', 'assumptions', 'scope_notes': [str] (FIXES §3.1.1 — 'fcFSM 미구현'
            은 scope_notes), 'diagnostics', 'success',
        }
    """
    # 고유치 해석은 보통 FSM 과 같은 문제(구속 · 스프링 없음)이므로 engine 의 stripmain
    # 을 그대로 쓴다 — dense 색인 조립 + 대칭 정부호 eigh (F1 R1-04). 예전의 lil 조립
    # + 전 고유치 QZ 사본과 고유치는 반올림 안에서 같고, 모드형상은 stripmain 처럼
    # 최대 성분 +1 로 정규화된다(예전: |최대| = 1, 부호 임의).
    from engine.fsm_solver import stripmain
    from models.data import GBTConfig
    res = stripmain(prop, node, elem, np.asarray(lengths, dtype=float), np.array([]),
                    np.array([]), GBTConfig(), BC, m_all, neigs)
    curve_list = list(res.curve)
    shapes_list = list(res.shapes)
    m_used = res.m_all if res.m_all else m_all
    diagnostics = [{
        # 입력과 상관없이 늘 참 → scope note (FIXES §3.1.1)
        'severity': 'info', 'category': 'scope', 'code': 'FCFSM_NOT_IMPLEMENTED',
        'length_index': None, 'length': None, 'message': FCFSM_WARNING,
    }] + list(res.diagnostics)

    from cfsm.classify import classify
    clas = classify(prop, node, elem, lengths, shapes_list, None, BC, m_used)
    clas_list = list(clas)
    diagnostics.extend(clas.diagnostics)

    return {
        'curve': curve_list,
        'shapes': shapes_list,
        'classification': clas_list,
        'method': FCFSM_METHOD,
        'is_fcfsm': False,
        'classification_status': clas.summary(),
        'warnings': [d['message'] for d in res.diagnostics
                     if d.get('severity') in ('warning', 'error')] + list(clas.warnings),
        'assumptions': list(clas.assumptions),
        'scope_notes': [FCFSM_WARNING] + list(clas.scope_notes),
        'diagnostics': diagnostics,
        'success': not any(d.get('severity') == 'error' for d in diagnostics),
    }


def _classify_fcfsm(modes: np.ndarray, sec_data: dict,
                     nnodes: int, totalm: int) -> np.ndarray:
    """옛 분류(쓰지 않음): 길이 100 · S-S · m=1 고정의 cFSM 자연기저 최소제곱.

    길이·경계조건과 무관한 기저라 fcFSM 도 고전 cFSM 도 아니다. 분해에 실패하면
    NaN 을 돌려준다.

    Returns:
        (n_modes, 4) — [%G, %D, %L, %O]
    """
    n_modes = modes.shape[1]
    clas = np.zeros((n_modes, 4))

    b_v = sec_data.get('basis', None)
    if b_v is None or b_v.size == 0:
        clas[:, :] = np.nan
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
            except Exception:
                cl_g = cl_d = cl_l = cl_o = np.nan
                break

        total = cl_g + cl_d + cl_l + cl_o
        if np.isfinite(total) and total > 0.0:
            clas[m_idx] = np.array([cl_g, cl_d, cl_l, cl_o]) / total * 100
        else:
            clas[m_idx] = np.nan

    return clas
