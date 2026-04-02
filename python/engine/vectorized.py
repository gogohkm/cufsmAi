"""벡터화 연산 — 다중 m항을 NumPy 행렬 연산으로 일괄 처리

참조: 프로젝트개요.md §2 벡터화 연산 (v5.20+)
원본: Ref_Source/analysis/vectorized/klocal_vec.m, kglocal_vec.m, BC_I1_5_vec.m, trans_vec.m

적분값 I1~I5를 (totalm, totalm) 행렬로 일괄 계산한 후
블록 행렬 조립을 NumPy 인덱싱으로 수행하여 Python 루프를 최소화한다.
"""

import math

import numpy as np

from .boundary import BC_I1_5

PI = math.pi


def BC_I1_5_vec(BC: str, m_a: np.ndarray, a: float) -> tuple:
    """경계조건 적분의 벡터화 버전 — 모든 (m, p) 조합을 행렬로 반환

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
    """요소 탄성 강성행렬 — 완전 벡터화 버전

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
    I1, I2, I3, I4, I5 = BC_I1_5_vec(BC, m_a, a)

    # 파수 벡터 (totalm,)
    um = m_a * PI
    c1 = um / a          # (totalm,) — 행 인덱스 m용
    c2 = um / a          # (totalm,) — 열 인덱스 p용

    # 브로드캐스팅을 위한 reshape
    c1_col = c1[:, np.newaxis]  # (totalm, 1)
    c2_row = c2[np.newaxis, :]  # (1, totalm)

    k = np.zeros((8 * totalm, 8 * totalm))
    b2, b3, b4, b5, b6 = b**2, b**3, b**4, b**5, b**6
    denom = 420 * b3

    for m in range(totalm):
        for p in range(totalm):
            i1, i2, i3, i4, i5 = I1[m, p], I2[m, p], I3[m, p], I4[m, p], I5[m, p]
            _c1, _c2 = c1[m], c2[p]

            # === 멤브레인 4x4 ===
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

            # === 휨 4x4 ===
            kf = np.zeros((4, 4))
            kf[0, 0] = (5040*Dx*i1 - 504*b2*D1*i2 - 504*b2*D1*i3 + 156*b4*Dy*i4 + 2016*b2*Dxy*i5) / denom
            kf[0, 1] = (2520*b*Dx*i1 - 462*b3*D1*i2 - 42*b3*D1*i3 + 22*b5*Dy*i4 + 168*b3*Dxy*i5) / denom
            kf[0, 2] = (-5040*Dx*i1 + 504*b2*D1*i2 + 504*b2*D1*i3 + 54*b4*Dy*i4 - 2016*b2*Dxy*i5) / denom
            kf[0, 3] = (2520*b*Dx*i1 - 42*b3*D1*i2 - 42*b3*D1*i3 - 13*b5*Dy*i4 + 168*b3*Dxy*i5) / denom
            kf[1, 0] = (2520*b*Dx*i1 - 462*b3*D1*i3 - 42*b3*D1*i2 + 22*b5*Dy*i4 + 168*b3*Dxy*i5) / denom
            kf[1, 1] = (1680*b2*Dx*i1 - 56*b4*D1*i2 - 56*b4*D1*i3 + 4*b6*Dy*i4 + 224*b4*Dxy*i5) / denom
            kf[1, 2] = (-2520*b*Dx*i1 + 42*b3*D1*i2 + 42*b3*D1*i3 + 13*b5*Dy*i4 - 168*b3*Dxy*i5) / denom
            kf[1, 3] = (840*b2*Dx*i1 + 14*b4*D1*i2 + 14*b4*D1*i3 - 3*b6*Dy*i4 - 56*b4*Dxy*i5) / denom
            kf[2, 0] = kf[0, 2]
            kf[2, 1] = kf[1, 2]
            kf[2, 2] = (5040*Dx*i1 - 504*b2*D1*i2 - 504*b2*D1*i3 + 156*b4*Dy*i4 + 2016*b2*Dxy*i5) / denom
            kf[2, 3] = (-2520*b*Dx*i1 + 462*b3*D1*i2 + 42*b3*D1*i3 - 22*b5*Dy*i4 - 168*b3*Dxy*i5) / denom
            kf[3, 0] = kf[0, 3]
            kf[3, 1] = kf[1, 3]
            kf[3, 2] = (-2520*b*Dx*i1 + 462*b3*D1*i3 + 42*b3*D1*i2 - 22*b5*Dy*i4 - 168*b3*Dxy*i5) / denom
            kf[3, 3] = (1680*b2*Dx*i1 - 56*b4*D1*i2 - 56*b4*D1*i3 + 4*b6*Dy*i4 + 224*b4*Dxy*i5) / denom

            # 8x8 블록
            r_m = 8 * m
            r_p = 8 * p
            k[r_m:r_m + 4, r_p:r_p + 4] = km
            k[r_m + 4:r_m + 8, r_p + 4:r_p + 8] = kf

    return k


def kglocal_vec(a: float, b: float, Ty1: float, Ty2: float,
                BC: str, m_a: np.ndarray) -> np.ndarray:
    """기하강성행렬 — 완전 벡터화 버전"""
    totalm = len(m_a)
    I1, I2, I3, I4, I5 = BC_I1_5_vec(BC, m_a, a)
    um = m_a * PI

    kg = np.zeros((8 * totalm, 8 * totalm))

    for m in range(totalm):
        for p in range(totalm):
            i1, i4, i5 = I1[m, p], I4[m, p], I5[m, p]
            _um, _up = um[m], um[p]

            gm = np.zeros((4, 4))
            gm[0, 0] = b * (3*Ty1 + Ty2) * i5 / 12
            gm[0, 2] = b * (Ty1 + Ty2) * i5 / 12
            gm[2, 0] = gm[0, 2]
            gm[1, 1] = b * a**2 * (3*Ty1 + Ty2) * i4 / 12 / _um / _up if _um*_up != 0 else 0
            gm[1, 3] = b * a**2 * (Ty1 + Ty2) * i4 / 12 / _um / _up if _um*_up != 0 else 0
            gm[3, 1] = gm[1, 3]
            gm[2, 2] = b * (Ty1 + 3*Ty2) * i5 / 12
            gm[3, 3] = b * a**2 * (Ty1 + 3*Ty2) * i4 / 12 / _um / _up if _um*_up != 0 else 0

            gf = np.zeros((4, 4))
            gf[0, 0] = (10*Ty1 + 3*Ty2) * b * i5 / 35
            gf[0, 1] = (15*Ty1 + 7*Ty2) * b**2 * i5 / 420
            gf[1, 0] = gf[0, 1]
            gf[0, 2] = 9*(Ty1 + Ty2) * b * i5 / 140
            gf[2, 0] = gf[0, 2]
            gf[0, 3] = -(7*Ty1 + 6*Ty2) * b**2 * i5 / 420
            gf[3, 0] = gf[0, 3]
            gf[1, 1] = (5*Ty1 + 3*Ty2) * b**3 * i5 / 840
            gf[1, 2] = (6*Ty1 + 7*Ty2) * b**2 * i5 / 420
            gf[2, 1] = gf[1, 2]
            gf[1, 3] = -(Ty1 + Ty2) * b**3 * i5 / 280
            gf[3, 1] = gf[1, 3]
            gf[2, 2] = (3*Ty1 + 10*Ty2) * b * i5 / 35
            gf[2, 3] = -(7*Ty1 + 15*Ty2) * b**2 * i5 / 420
            gf[3, 2] = gf[2, 3]
            gf[3, 3] = (3*Ty1 + 5*Ty2) * b**3 * i5 / 840

            r_m = 8 * m
            r_p = 8 * p
            kg[r_m:r_m + 4, r_p:r_p + 4] = gm
            kg[r_m + 4:r_m + 8, r_p + 4:r_p + 8] = gf

    return kg


def trans_vec(alpha: float, k: np.ndarray, kg: np.ndarray,
              m_a: np.ndarray) -> tuple:
    """좌표변환 — 블록 대각 변환행렬을 NumPy로 일괄 구성"""
    totalm = len(m_a)
    c = math.cos(alpha)
    s = math.sin(alpha)

    gam = np.array([
        [ c, 0,  0, 0, -s, 0,  0, 0],
        [ 0, 1,  0, 0,  0, 0,  0, 0],
        [ 0, 0,  c, 0,  0, 0, -s, 0],
        [ 0, 0,  0, 1,  0, 0,  0, 0],
        [ s, 0,  0, 0,  c, 0,  0, 0],
        [ 0, 0,  0, 0,  0, 1,  0, 0],
        [ 0, 0,  s, 0,  0, 0,  c, 0],
        [ 0, 0,  0, 0,  0, 0,  0, 1],
    ])

    n = 8 * totalm
    gamma = np.zeros((n, n))
    for i in range(totalm):
        r = 8 * i
        gamma[r:r + 8, r:r + 8] = gam

    return gamma @ k @ gamma.T, gamma @ kg @ gamma.T
