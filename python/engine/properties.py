"""요소/단면 물성 계산

원본: Ref_Source/analysis/elemprop.m, Ref_Source/helpers/grosprop.m
"""

import math

import numpy as np


def elemprop(node: np.ndarray, elem: np.ndarray) -> np.ndarray:
    """요소별 폭(width)과 회전각(alpha) 계산

    Args:
        node: (nnodes, 8) — [node#, x, z, dofx, dofz, dofy, dofrot, stress]
        elem: (nelems, 5) — [elem#, nodei, nodej, t, matnum]
              nodei, nodej는 MATLAB 1-based 값

    Returns:
        elprop: (nelems, 3) — [elem_index, width, alpha]
    """
    nelems = elem.shape[0]
    elprop = np.zeros((nelems, 3))

    for i in range(nelems):
        # MATLAB 1-based → Python 0-based
        nodei = int(elem[i, 1]) - 1
        nodej = int(elem[i, 2]) - 1
        xi = node[nodei, 1]
        zi = node[nodei, 2]
        xj = node[nodej, 1]
        zj = node[nodej, 2]
        dx = xj - xi
        dz = zj - zi
        width = math.sqrt(dx**2 + dz**2)
        alpha = math.atan2(dz, dx)
        elprop[i, :] = [i, width, alpha]

    return elprop


def grosprop(node: np.ndarray, elem: np.ndarray) -> dict:
    """총단면 성질 계산

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5) — nodei, nodej는 MATLAB 1-based

    Returns:
        dict with keys: A, xcg, zcg, Ixx, Izz, Ixz, thetap, I11, I22
    """
    nelems = elem.shape[0]

    A_total = 0.0
    Ax = 0.0
    Az = 0.0
    Axx = 0.0
    Azz = 0.0
    Axz = 0.0
    Ixx_o = 0.0
    Izz_o = 0.0
    Ixz_o = 0.0

    for i in range(nelems):
        nodei = int(elem[i, 1]) - 1
        nodej = int(elem[i, 2]) - 1
        t = elem[i, 3]

        xi = node[nodei, 1]
        zi = node[nodei, 2]
        xj = node[nodej, 1]
        zj = node[nodej, 2]

        dx = xj - xi
        dz = zj - zi
        L = math.sqrt(dx**2 + dz**2)

        A_e = L * t
        x_c = (xi + xj) / 2.0
        z_c = (zi + zj) / 2.0

        A_total += A_e
        Ax += A_e * x_c
        Az += A_e * z_c
        Axx += A_e * x_c**2
        Azz += A_e * z_c**2
        Axz += A_e * x_c * z_c

        # 요소 자체의 관성모멘트 (중심축)
        Ixx_o += t * L**3 * dz**2 / L**2 / 12.0  # = t * L * dz^2 / 12
        Izz_o += t * L**3 * dx**2 / L**2 / 12.0
        Ixz_o += t * L**3 * dx * dz / L**2 / 12.0

    if A_total == 0:
        return dict(A=0, xcg=0, zcg=0, Ixx=0, Izz=0, Ixz=0, thetap=0, I11=0, I22=0)

    xcg = Ax / A_total
    zcg = Az / A_total

    # 도심 축 관성모멘트 (평행축 정리)
    Ixx = Ixx_o + Azz - A_total * zcg**2
    Izz = Izz_o + Axx - A_total * xcg**2
    Ixz = Ixz_o + Axz - A_total * xcg * zcg

    # 주축 각도
    if abs(Ixx - Izz) < 1e-14:
        thetap = 0.0 if abs(Ixz) < 1e-14 else 45.0
    else:
        thetap = math.degrees(math.atan2(-2 * Ixz, Ixx - Izz) / 2.0)

    # 주축 관성모멘트
    theta_rad = math.radians(thetap)
    c = math.cos(theta_rad)
    s = math.sin(theta_rad)
    I11 = Ixx * c**2 + Izz * s**2 - 2 * Ixz * s * c
    I22 = Ixx * s**2 + Izz * c**2 + 2 * Ixz * s * c

    return dict(
        A=A_total, xcg=xcg, zcg=zcg,
        Ixx=Ixx, Izz=Izz, Ixz=Ixz,
        thetap=thetap, I11=I11, I22=I22,
    )
