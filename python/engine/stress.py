"""응력 분포 생성

참조: 프로젝트개요.md §4 해석 워크플로우 [3] 하중/경계조건
원본: Ref_Source/analysis/stresgen.m, Ref_Source/helpers/yieldMP.m

P, Mxx, Mzz, M11, M22 하중 조합에서 각 절점의 응력을 자동 계산하여
node 배열의 stress 열(8번째)에 할당한다.
"""

import math

import numpy as np


def stresgen(node: np.ndarray, P: float, Mxx: float, Mzz: float,
             M11: float, M22: float,
             A: float, xcg: float, zcg: float,
             Ixx: float, Izz: float, Ixz: float,
             thetap: float, I11: float, I22: float,
             unsymm: int = 0) -> np.ndarray:
    """하중 조합에 따른 절점 응력 계산

    Args:
        node: (nnodes, 8) — 절점 배열 (수정하여 반환)
        P: 축력
        Mxx: x축 모멘트
        Mzz: z축 모멘트
        M11: 주축1 모멘트
        M22: 주축2 모멘트
        A, xcg, zcg, Ixx, Izz, Ixz: 단면 성질
        thetap: 주축 각도 (도)
        I11, I22: 주축 관성모멘트
        unsymm: 0=구속 휨(Ixz=0 강제), 1=비구속

    Returns:
        node: stress 열이 업데이트된 절점 배열
    """
    node = node.copy()
    nnodes = node.shape[0]

    if unsymm == 0:
        Ixz = 0.0

    # 축력 응력
    stress = np.full(nnodes, P / A if A != 0 else 0.0)

    # 휨 응력 (글로벌 축)
    denom = Izz * Ixx - Ixz**2
    if abs(denom) > 1e-20:
        x_rel = node[:, 1] - xcg
        z_rel = node[:, 2] - zcg
        stress -= ((Mzz * Ixx + Mxx * Ixz) * x_rel -
                    (Mzz * Ixz + Mxx * Izz) * z_rel) / denom

    # 주축 좌표 변환
    th = math.radians(thetap)
    c = math.cos(th)
    s = math.sin(th)
    x_rel = node[:, 1] - xcg
    z_rel = node[:, 2] - zcg
    # 주축 좌표: [cos -sin; sin cos]^(-1) * [x; z]
    prin_1 = c * x_rel + s * z_rel   # 주축1 방향
    prin_2 = -s * x_rel + c * z_rel  # 주축2 방향

    # 주축 모멘트 응력
    if abs(I11) > 1e-20:
        stress -= M11 * prin_2 / I11
    if abs(I22) > 1e-20:
        stress -= M22 * prin_1 / I22

    node[:, 7] = stress
    return node


def yieldMP(node: np.ndarray, fy: float,
            A: float, xcg: float, zcg: float,
            Ixx: float, Izz: float, Ixz: float,
            thetap: float, I11: float, I22: float,
            unsymm: int = 0) -> dict:
    """항복 응력에 대한 기준 하중 계산

    각 하중 성분(P, Mxx, Mzz, M11, M22)이 단독으로 작용할 때
    단면 최외단에서 fy에 도달하는 하중값을 계산한다.

    Args:
        node: (nnodes, 8)
        fy: 항복 응력
        나머지: 단면 성질

    Returns:
        dict: {Py, Mxx_y, Mzz_y, M11_y, M22_y}
    """
    if unsymm == 0:
        Ixz = 0.0

    # Py = fy * A
    Py = fy * A

    x_rel = node[:, 1] - xcg
    z_rel = node[:, 2] - zcg
    denom = Izz * Ixx - Ixz**2

    # Mxx_y
    Mxx_y = 0.0
    if abs(denom) > 1e-20:
        stress_mxx = ((0 * Ixx + 1 * Ixz) * x_rel -
                      (0 * Ixz + 1 * Izz) * z_rel) / denom
        max_s = np.max(np.abs(stress_mxx))
        Mxx_y = fy / max_s if max_s > 1e-20 else 0.0

    # Mzz_y
    Mzz_y = 0.0
    if abs(denom) > 1e-20:
        stress_mzz = ((1 * Ixx + 0 * Ixz) * x_rel -
                      (1 * Ixz + 0 * Izz) * z_rel) / denom
        max_s = np.max(np.abs(stress_mzz))
        Mzz_y = fy / max_s if max_s > 1e-20 else 0.0

    # 주축 좌표
    th = math.radians(thetap)
    c = math.cos(th)
    s = math.sin(th)
    prin_1 = c * x_rel + s * z_rel
    prin_2 = -s * x_rel + c * z_rel

    # M11_y
    M11_y = 0.0
    if abs(I11) > 1e-20:
        stress_m11 = prin_2 / I11
        max_s = np.max(np.abs(stress_m11))
        M11_y = fy / max_s if max_s > 1e-20 else 0.0

    # M22_y
    M22_y = 0.0
    if abs(I22) > 1e-20:
        stress_m22 = prin_1 / I22
        max_s = np.max(np.abs(stress_m22))
        M22_y = fy / max_s if max_s > 1e-20 else 0.0

    return dict(Py=Py, Mxx_y=Mxx_y, Mzz_y=Mzz_y, M11_y=M11_y, M22_y=M22_y)
