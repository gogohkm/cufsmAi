"""좌표 변환

원본: Ref_Source/analysis/trans.m
로컬 좌표계 → 글로벌 좌표계 변환
"""

import math

import numpy as np


def trans(alpha: float, k: np.ndarray, kg: np.ndarray,
          m_a: np.ndarray) -> tuple:
    """로컬 좌표계 요소 행렬을 글로벌 좌표계로 변환

    Args:
        alpha: 요소 회전각 (라디안)
        k: 로컬 탄성 강성행렬 (8*totalm × 8*totalm)
        kg: 로컬 기하강성행렬 (8*totalm × 8*totalm)
        m_a: 종방향 조화항 배열

    Returns:
        (k_global, kg_global) 변환된 행렬 튜플
    """
    totalm = len(m_a)
    c = math.cos(alpha)
    s = math.sin(alpha)

    # 8x8 변환행렬 (단일 m항)
    # DOF: [u1 v1 u2 v2 w1 θ1 w2 θ2]
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

    # 전체 크기로 확장 (블록 대각)
    n = 8 * totalm
    gamma = np.zeros((n, n))
    for i in range(totalm):
        r = 8 * i
        gamma[r:r + 8, r:r + 8] = gam

    k_global = gamma @ k @ gamma.T
    kg_global = gamma @ kg @ gamma.T

    return k_global, kg_global


def spring_trans(alpha: float, ks: np.ndarray,
                 m_a: np.ndarray) -> np.ndarray:
    """로컬 좌표계 스프링 강성행렬을 글로벌 좌표계로 변환

    원본: Ref_Source/analysis/spring_trans.m

    Args:
        alpha: 스프링 회전각 (라디안)
        ks: 로컬 스프링 강성행렬 (8*totalm × 8*totalm)
        m_a: 종방향 조화항 배열

    Returns:
        ks_global: 변환된 스프링 강성행렬
    """
    totalm = len(m_a)
    c = math.cos(alpha)
    s = math.sin(alpha)

    # 8x8 변환행렬 (단일 m항) — trans()와 동일한 gamma
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

    ks_global = gamma @ ks @ gamma.T

    return ks_global
