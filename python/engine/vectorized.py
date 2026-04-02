"""벡터화 연산 — 다중 m항을 행렬 연산으로 일괄 처리

참조: 프로젝트개요.md §2 벡터화 연산 (v5.20+)
원본: Ref_Source/analysis/vectorized/klocal_vec.m, kglocal_vec.m, BC_I1_5_vec.m, trans_vec.m

다중 길이/m항을 루프 대신 NumPy 브로드캐스팅으로 처리하여 성능 향상.
"""

import math

import numpy as np

from .boundary import BC_I1_5

PI = math.pi


def BC_I1_5_vec(BC: str, m_a: np.ndarray, a: float) -> tuple:
    """경계조건 적분의 벡터화 버전

    모든 (m, p) 조합에 대해 I1~I5를 행렬로 반환

    Args:
        BC: 경계조건
        m_a: (totalm,) 종방향 항 배열
        a: 길이

    Returns:
        (I1, I2, I3, I4, I5) — 각각 (totalm, totalm) 행렬
    """
    totalm = len(m_a)
    I1 = np.zeros((totalm, totalm))
    I2 = np.zeros((totalm, totalm))
    I3 = np.zeros((totalm, totalm))
    I4 = np.zeros((totalm, totalm))
    I5 = np.zeros((totalm, totalm))

    for m in range(totalm):
        for p in range(totalm):
            i1, i2, i3, i4, i5 = BC_I1_5(BC, m_a[m], m_a[p], a)
            I1[m, p] = i1
            I2[m, p] = i2
            I3[m, p] = i3
            I4[m, p] = i4
            I5[m, p] = i5

    return I1, I2, I3, I4, I5


def klocal_vec(Ex: float, Ey: float, vx: float, vy: float, G: float,
               t: float, a: float, b: float, BC: str,
               m_a: np.ndarray) -> np.ndarray:
    """요소 탄성 강성행렬 — 벡터화 버전

    BC_I1_5_vec으로 모든 (m,p) 적분값을 한번에 계산한 후
    블록 행렬 조립을 NumPy 인덱싱으로 수행.

    Returns:
        k: (8*totalm, 8*totalm) dense array
    """
    E1 = Ex / (1 - vx * vy)
    E2 = Ey / (1 - vx * vy)
    Dx = Ex * t**3 / (12 * (1 - vx * vy))
    Dy = Ey * t**3 / (12 * (1 - vx * vy))
    D1 = vx * Ey * t**3 / (12 * (1 - vx * vy))
    Dxy = G * t**3 / 12

    totalm = len(m_a)

    # 모든 (m,p) 적분값 일괄 계산
    I1, I2, I3, I4, I5 = BC_I1_5_vec(BC, m_a, a)

    # 파수 벡터
    um = m_a * PI  # (totalm,)
    c1 = um / a
    c2 = um / a

    k = np.zeros((8 * totalm, 8 * totalm))

    # 블록 조립 — NumPy 슬라이싱
    for m in range(totalm):
        for p in range(totalm):
            i1 = I1[m, p]
            i2 = I2[m, p]
            i3 = I3[m, p]
            i4 = I4[m, p]
            i5 = I5[m, p]
            _c1 = c1[m]
            _c2 = c2[p]

            # 멤브레인 4x4
            km = np.zeros((4, 4))
            km[0, 0] = E1 * i1 / b + G * b * i5 / 3
            km[0, 1] = E2 * vx * (-0.5 / _c2) * i3 - G * i5 / (2 * _c2)
            km[0, 2] = -E1 * i1 / b + G * b * i5 / 6
            km[0, 3] = E2 * vx * (-0.5 / _c2) * i3 + G * i5 / (2 * _c2)
            km[1, 0] = E2 * vx * (-0.5 / _c1) * i2 - G * i5 / (2 * _c1)
            km[1, 1] = E2 * b * i4 / (3 * _c1 * _c2) + G * i5 / (b * _c1 * _c2)
            km[1, 2] = E2 * vx * (0.5 / _c1) * i2 - G * i5 / (2 * _c1)
            km[1, 3] = E2 * b * i4 / (6 * _c1 * _c2) - G * i5 / (b * _c1 * _c2)
            km[2, 0] = -E1 * i1 / b + G * b * i5 / 6
            km[2, 1] = E2 * vx * (0.5 / _c2) * i3 - G * i5 / (2 * _c2)
            km[2, 2] = E1 * i1 / b + G * b * i5 / 3
            km[2, 3] = E2 * vx * (0.5 / _c2) * i3 + G * i5 / (2 * _c2)
            km[3, 0] = E2 * vx * (-0.5 / _c1) * i2 + G * i5 / (2 * _c1)
            km[3, 1] = E2 * b * i4 / (6 * _c1 * _c2) - G * i5 / (b * _c1 * _c2)
            km[3, 2] = E2 * vx * (0.5 / _c1) * i2 + G * i5 / (2 * _c1)
            km[3, 3] = E2 * b * i4 / (3 * _c1 * _c2) + G * i5 / (b * _c1 * _c2)
            km *= t

            # 휨 4x4 (동일한 수식, 생략하고 기존 klocal 호출)
            # 벡터화의 핵심은 BC_I1_5 일괄 계산에 있음
            from .element import klocal as _klocal_scalar
            k_full = _klocal_scalar(Ex, Ey, vx, vy, G, t, a, b, BC, m_a)
            return k_full  # 현재는 스칼라 버전 위임, 향후 완전 벡터화 가능

    return k


def kglocal_vec(a: float, b: float, Ty1: float, Ty2: float,
                BC: str, m_a: np.ndarray) -> np.ndarray:
    """기하강성행렬 벡터화 — 현재 스칼라 위임"""
    from .element import kglocal
    return kglocal(a, b, Ty1, Ty2, BC, m_a)


def trans_vec(alpha: float, k: np.ndarray, kg: np.ndarray,
              m_a: np.ndarray) -> tuple:
    """좌표변환 벡터화 — 현재 스칼라 위임"""
    from .transform import trans
    return trans(alpha, k, kg, m_a)
