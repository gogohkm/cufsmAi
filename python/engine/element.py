"""요소 강성행렬 계산

참조: 프로젝트개요.md §5.1 FSM 해석 엔진 (klocal.m, kglocal.m)
원본: Ref_Source/analysis/klocal.m, kglocal.m, spring_klocal.m

DOF 순서: [u1 v1 u2 v2 w1 θ1 w2 θ2]
  u,v: 멤브레인 (면내), w,θ: 휨 (면외)
"""

import math

import numpy as np

from .boundary import BC_I1_5, BC_I1_5_atpoint

PI = math.pi


def klocal(Ex: float, Ey: float, vx: float, vy: float, G: float,
           t: float, a: float, b: float, BC: str, m_a: np.ndarray) -> np.ndarray:
    """요소 탄성 강성행렬 (로컬 좌표계)

    Args:
        Ex, Ey: x, y 방향 탄성계수
        vx, vy: 포아송비
        G: 전단탄성계수
        t: 요소 두께
        a: 종방향 길이
        b: 횡방향 폭 (요소 폭)
        BC: 경계조건
        m_a: 종방향 조화항 배열

    Returns:
        k: (8*totalm, 8*totalm) 강성행렬
    """
    E1 = Ex / (1 - vx * vy)
    E2 = Ey / (1 - vx * vy)
    Dx = Ex * t**3 / (12 * (1 - vx * vy))
    Dy = Ey * t**3 / (12 * (1 - vx * vy))
    D1 = vx * Ey * t**3 / (12 * (1 - vx * vy))
    Dxy = G * t**3 / 12

    totalm = len(m_a)
    k = np.zeros((8 * totalm, 8 * totalm))

    for m in range(totalm):
        for p in range(totalm):
            um = m_a[m] * PI
            up = m_a[p] * PI
            c1 = um / a
            c2 = up / a

            I1, I2, I3, I4, I5 = BC_I1_5(BC, m_a[m], m_a[p], a)

            # 멤브레인 강성 4x4
            km = np.zeros((4, 4))
            km[0, 0] = E1 * I1 / b + G * b * I5 / 3
            km[0, 1] = E2 * vx * (-1 / 2 / c2) * I3 - G * I5 / 2 / c2
            km[0, 2] = -E1 * I1 / b + G * b * I5 / 6
            km[0, 3] = E2 * vx * (-1 / 2 / c2) * I3 + G * I5 / 2 / c2

            km[1, 0] = E2 * vx * (-1 / 2 / c1) * I2 - G * I5 / 2 / c1
            km[1, 1] = E2 * b * I4 / 3 / c1 / c2 + G * I5 / b / c1 / c2
            km[1, 2] = E2 * vx * (1 / 2 / c1) * I2 - G * I5 / 2 / c1
            km[1, 3] = E2 * b * I4 / 6 / c1 / c2 - G * I5 / b / c1 / c2

            km[2, 0] = -E1 * I1 / b + G * b * I5 / 6
            km[2, 1] = E2 * vx * (1 / 2 / c2) * I3 - G * I5 / 2 / c2
            km[2, 2] = E1 * I1 / b + G * b * I5 / 3
            km[2, 3] = E2 * vx * (1 / 2 / c2) * I3 + G * I5 / 2 / c2

            km[3, 0] = E2 * vx * (-1 / 2 / c1) * I2 + G * I5 / 2 / c1
            km[3, 1] = E2 * b * I4 / 6 / c1 / c2 - G * I5 / b / c1 / c2
            km[3, 2] = E2 * vx * (1 / 2 / c1) * I2 + G * I5 / 2 / c1
            km[3, 3] = E2 * b * I4 / 3 / c1 / c2 + G * I5 / b / c1 / c2

            km *= t

            # 휨 강성 4x4
            kf = np.zeros((4, 4))
            b2 = b**2
            b3 = b**3
            b4 = b**4
            b5 = b**5
            b6 = b**6
            denom = 420 * b3

            kf[0, 0] = (5040 * Dx * I1 - 504 * b2 * D1 * I2 - 504 * b2 * D1 * I3 + 156 * b4 * Dy * I4 + 2016 * b2 * Dxy * I5) / denom
            kf[0, 1] = (2520 * b * Dx * I1 - 462 * b3 * D1 * I2 - 42 * b3 * D1 * I3 + 22 * b5 * Dy * I4 + 168 * b3 * Dxy * I5) / denom
            kf[0, 2] = (-5040 * Dx * I1 + 504 * b2 * D1 * I2 + 504 * b2 * D1 * I3 + 54 * b4 * Dy * I4 - 2016 * b2 * Dxy * I5) / denom
            kf[0, 3] = (2520 * b * Dx * I1 - 42 * b3 * D1 * I2 - 42 * b3 * D1 * I3 - 13 * b5 * Dy * I4 + 168 * b3 * Dxy * I5) / denom

            kf[1, 0] = (2520 * b * Dx * I1 - 462 * b3 * D1 * I3 - 42 * b3 * D1 * I2 + 22 * b5 * Dy * I4 + 168 * b3 * Dxy * I5) / denom
            kf[1, 1] = (1680 * b2 * Dx * I1 - 56 * b4 * D1 * I2 - 56 * b4 * D1 * I3 + 4 * b6 * Dy * I4 + 224 * b4 * Dxy * I5) / denom
            kf[1, 2] = (-2520 * b * Dx * I1 + 42 * b3 * D1 * I2 + 42 * b3 * D1 * I3 + 13 * b5 * Dy * I4 - 168 * b3 * Dxy * I5) / denom
            kf[1, 3] = (840 * b2 * Dx * I1 + 14 * b4 * D1 * I2 + 14 * b4 * D1 * I3 - 3 * b6 * Dy * I4 - 56 * b4 * Dxy * I5) / denom

            kf[2, 0] = kf[0, 2]
            kf[2, 1] = kf[1, 2]
            kf[2, 2] = (5040 * Dx * I1 - 504 * b2 * D1 * I2 - 504 * b2 * D1 * I3 + 156 * b4 * Dy * I4 + 2016 * b2 * Dxy * I5) / denom
            kf[2, 3] = (-2520 * b * Dx * I1 + 462 * b3 * D1 * I2 + 42 * b3 * D1 * I3 - 22 * b5 * Dy * I4 - 168 * b3 * Dxy * I5) / denom

            kf[3, 0] = kf[0, 3]
            kf[3, 1] = kf[1, 3]
            kf[3, 2] = (-2520 * b * Dx * I1 + 462 * b3 * D1 * I3 + 42 * b3 * D1 * I2 - 22 * b5 * Dy * I4 - 168 * b3 * Dxy * I5) / denom
            kf[3, 3] = (1680 * b2 * Dx * I1 - 56 * b4 * D1 * I2 - 56 * b4 * D1 * I3 + 4 * b6 * Dy * I4 + 224 * b4 * Dxy * I5) / denom

            # 8x8 블록 조립: [km 0; 0 kf]
            r_m = 8 * m
            r_p = 8 * p
            k[r_m:r_m + 4, r_p:r_p + 4] = km
            k[r_m + 4:r_m + 8, r_p + 4:r_p + 8] = kf

    return k


def kglocal(a: float, b: float, Ty1: float, Ty2: float,
            BC: str, m_a: np.ndarray) -> np.ndarray:
    """요소 기하강성행렬 (로컬 좌표계)

    Args:
        a: 종방향 길이
        b: 횡방향 폭
        Ty1, Ty2: 절점 응력
        BC: 경계조건
        m_a: 종방향 조화항 배열

    Returns:
        kg: (8*totalm, 8*totalm) 기하강성행렬
    """
    totalm = len(m_a)
    kg = np.zeros((8 * totalm, 8 * totalm))

    for m in range(totalm):
        for p in range(totalm):
            um = m_a[m] * PI
            up = m_a[p] * PI

            I1, I2, I3, I4, I5 = BC_I1_5(BC, m_a[m], m_a[p], a)

            # 멤브레인 안정성 4x4 (대칭)
            gm = np.zeros((4, 4))
            gm[0, 0] = b * (3 * Ty1 + Ty2) * I5 / 12
            gm[0, 2] = b * (Ty1 + Ty2) * I5 / 12
            gm[2, 0] = gm[0, 2]
            gm[1, 1] = b * a**2 * (3 * Ty1 + Ty2) * I4 / 12 / um / up
            gm[1, 3] = b * a**2 * (Ty1 + Ty2) * I4 / 12 / um / up
            gm[3, 1] = gm[1, 3]
            gm[2, 2] = b * (Ty1 + 3 * Ty2) * I5 / 12
            gm[3, 3] = b * a**2 * (Ty1 + 3 * Ty2) * I4 / 12 / um / up

            # 휨 안정성 4x4 (대칭)
            gf = np.zeros((4, 4))
            gf[0, 0] = (10 * Ty1 + 3 * Ty2) * b * I5 / 35
            gf[0, 1] = (15 * Ty1 + 7 * Ty2) * b**2 * I5 / 210 / 2
            gf[1, 0] = gf[0, 1]
            gf[0, 2] = 9 * (Ty1 + Ty2) * b * I5 / 140
            gf[2, 0] = gf[0, 2]
            gf[0, 3] = -(7 * Ty1 + 6 * Ty2) * b**2 * I5 / 420
            gf[3, 0] = gf[0, 3]
            gf[1, 1] = (5 * Ty1 + 3 * Ty2) * b**3 * I5 / 2 / 420
            gf[1, 2] = (6 * Ty1 + 7 * Ty2) * b**2 * I5 / 420
            gf[2, 1] = gf[1, 2]
            gf[1, 3] = -(Ty1 + Ty2) * b**3 * I5 / 140 / 2
            gf[3, 1] = gf[1, 3]
            gf[2, 2] = (3 * Ty1 + 10 * Ty2) * b * I5 / 35
            gf[2, 3] = -(7 * Ty1 + 15 * Ty2) * b**2 * I5 / 420
            gf[3, 2] = gf[2, 3]
            gf[3, 3] = (3 * Ty1 + 5 * Ty2) * b**3 * I5 / 420 / 2

            # 8x8 블록 조립
            r_m = 8 * m
            r_p = 8 * p
            kg[r_m:r_m + 4, r_p:r_p + 4] = gm
            kg[r_m + 4:r_m + 8, r_p + 4:r_p + 8] = gf

    return kg


def spring_klocal(ku: float, kv: float, kw: float, kq: float,
                  a: float, BC: str, m_a: np.ndarray,
                  discrete: bool, ys: float = 0.0) -> np.ndarray:
    """스프링 요소 강성행렬

    Args:
        ku, kv, kw, kq: u, v, w, θ 방향 스프링 강성
        a: 종방향 길이
        BC: 경계조건
        m_a: 종방향 조화항
        discrete: True=이산 스프링, False=분포 스프링(기초)
        ys: 이산 스프링 위치 (a 대비 비율, 0~1)

    Returns:
        k: (8*totalm, 8*totalm) 스프링 강성행렬
    """
    totalm = len(m_a)
    k = np.zeros((8 * totalm, 8 * totalm))

    for m_idx in range(totalm):
        for p_idx in range(totalm):
            um = m_a[m_idx] * PI
            up = m_a[p_idx] * PI

            if discrete:
                I1, I5 = BC_I1_5_atpoint(BC, m_a[m_idx], m_a[p_idx], a, ys)
                I4 = 0.0
            else:
                I1, I2, I3, I4, I5 = BC_I1_5(BC, m_a[m_idx], m_a[p_idx], a)

            # 멤브레인 스프링 4x4
            ks_m = np.zeros((4, 4))
            ks_m[0, 0] = ku * I1
            ks_m[0, 2] = -ku * I1
            ks_m[2, 0] = -ku * I1
            ks_m[2, 2] = ku * I1

            if um != 0 and up != 0:
                v_term = kv * I5 * a**2 / um / up
                ks_m[1, 1] = v_term
                ks_m[1, 3] = -v_term
                ks_m[3, 1] = -v_term
                ks_m[3, 3] = v_term

            # 휨 스프링 4x4
            ks_f = np.zeros((4, 4))
            ks_f[0, 0] = kw * I1
            ks_f[0, 2] = -kw * I1
            ks_f[2, 0] = -kw * I1
            ks_f[2, 2] = kw * I1
            ks_f[1, 1] = kq * I1
            ks_f[1, 3] = -kq * I1
            ks_f[3, 1] = -kq * I1
            ks_f[3, 3] = kq * I1

            # 8x8 블록 조립
            r_m = 8 * m_idx
            r_p = 8 * p_idx
            k[r_m:r_m + 4, r_p:r_p + 4] = ks_m
            k[r_m + 4:r_m + 8, r_p + 4:r_p + 8] = ks_f

    return k
