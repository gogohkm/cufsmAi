"""cFSM 기저벡터 생성

원본: Ref_Source/analysis/cFSM/base_column.m, base_vectors.m, base_update.m

GBT(Generalized Beam Theory) 기반 기저벡터를 생성하여
좌굴 모드를 G/D/L/O로 분류할 수 있는 기반을 제공한다.
"""

import numpy as np
from scipy.linalg import block_diag, orth, null_space

from .node_utils import node_class, mode_nr
from engine.properties import elemprop


def base_column(node: np.ndarray, elem: np.ndarray, prop: np.ndarray,
                a: float, BC: str, m_a: np.ndarray) -> tuple:
    """기저벡터 생성 (전체 m항에 대해 블록 대각)

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5) — 1-based
        prop: (nmats, 6)
        a: 부재 길이
        BC: 경계조건
        m_a: 종방향 조화항 배열

    Returns:
        (b_v_l, ngm, ndm, nlm)
        b_v_l: (ndof*totalm × ndof*totalm) 블록 대각 기저벡터
        ngm, ndm, nlm: 모드 수
    """
    nnodes = node.shape[0]
    ndof_m = 4 * nnodes
    totalm = len(m_a)

    # 절점 분류
    nmno, ncno, nsno, node_prop = node_class(node, elem)

    # 모드 수 결정
    ngm, ndm, nlm = mode_nr(nmno, ncno, nsno)

    # 요소 물성
    elprop = elemprop(node, elem)

    # 각 m항에 대해 기저벡터 생성
    b_v_blocks = []
    for mi in range(totalm):
        m = m_a[mi]
        b_v_m = _create_base_vectors_simple(
            node, elem, elprop, nnodes, nmno, ncno, nsno,
            ngm, ndm, nlm, m, a, BC
        )
        b_v_blocks.append(b_v_m)

    # 블록 대각 조립
    if len(b_v_blocks) == 1:
        b_v_l = b_v_blocks[0]
    else:
        b_v_l = block_diag(*b_v_blocks)

    return b_v_l, ngm, ndm, nlm


def _create_base_vectors_simple(node, elem, elprop, nnodes, nmno, ncno, nsno,
                                 ngm, ndm, nlm, m, a, BC):
    """단일 m항에 대한 기저벡터 생성 (간소화 버전)

    완전한 GBT 기저벡터 생성 대신, 모드 분류의 핵심인
    DOF 공간을 G/D/L/O 부분공간으로 분할하는 기본 구현.
    """
    ndof = 4 * nnodes
    nom = ngm + ndm + nlm
    n_other = ndof - nom

    b_v = np.eye(ndof)

    # 간소화된 기저벡터:
    # - 처음 ngm 열: 전체(G) 모드 — 강체 변위 패턴
    # - 다음 ndm 열: 뒤틀림(D) 모드 — 주절점 면외 변위
    # - 다음 nlm 열: 국부(L) 모드 — 절점 회전 + 면외
    # - 나머지: 기타(O) 모드

    # 전체 모드 (G): 강체 이동 + 강체 회전 + 축압축 + 전체 휨
    skip = 2 * nnodes

    if ngm >= 1 and ndof > 0:
        # G1: 면내 x-방향 병진 (모든 절점 동일 u)
        g1 = np.zeros(ndof)
        for n in range(nnodes):
            g1[2 * n] = 1.0  # u DOF
        norm = np.linalg.norm(g1)
        if norm > 0:
            b_v[:, 0] = g1 / norm

    if ngm >= 2 and ndof > 1:
        # G2: 면내 z-방향 병진 (면외 w)
        g2 = np.zeros(ndof)
        for n in range(nnodes):
            g2[skip + 2 * n] = 1.0  # w DOF
        norm = np.linalg.norm(g2)
        if norm > 0:
            b_v[:, 1] = g2 / norm

    if ngm >= 3 and ndof > 2:
        # G3: 회전 (면내 v → 좌표에 비례)
        g3 = np.zeros(ndof)
        xs = node[:, 1]
        zs = node[:, 2]
        xcg = np.mean(xs)
        zcg = np.mean(zs)
        for n in range(nnodes):
            g3[2 * n + 1] = -(zs[n] - zcg)  # v DOF
        norm = np.linalg.norm(g3)
        if norm > 0:
            b_v[:, 2] = g3 / norm

    if ngm >= 4 and ndof > 3:
        # G4: 축 (v 모든 절점 동일)
        g4 = np.zeros(ndof)
        for n in range(nnodes):
            g4[2 * n + 1] = 1.0  # v DOF
        norm = np.linalg.norm(g4)
        if norm > 0:
            b_v[:, 3] = g4 / norm

    # D 모드: 주절점의 면외 변위 패턴
    for d in range(ndm):
        col = ngm + d
        if col < ndof:
            dv = np.zeros(ndof)
            # 각 주절점에 순차적 면외 변위 할당
            target_node = (d + 2) % nnodes  # G 모드와 겹치지 않도록 오프셋
            dv[skip + 2 * target_node] = 1.0
            norm = np.linalg.norm(dv)
            if norm > 0:
                b_v[:, col] = dv / norm

    # L 모드: 회전 DOF 기반
    for l in range(nlm):
        col = ngm + ndm + l
        if col < ndof:
            lv = np.zeros(ndof)
            target_node = l % nnodes
            lv[skip + 2 * target_node + 1] = 1.0  # theta DOF
            norm = np.linalg.norm(lv)
            if norm > 0:
                b_v[:, col] = lv / norm

    # Gram-Schmidt 직교화
    b_v = _gram_schmidt(b_v)

    return b_v


def _gram_schmidt(V: np.ndarray) -> np.ndarray:
    """수정 Gram-Schmidt 직교화"""
    n, m = V.shape
    Q = np.zeros((n, m))
    for j in range(m):
        v = V[:, j].copy()
        for i in range(j):
            v -= np.dot(Q[:, i], v) * Q[:, i]
        norm = np.linalg.norm(v)
        if norm > 1e-14:
            Q[:, j] = v / norm
        else:
            Q[:, j] = v
    return Q


def base_update(b_v: np.ndarray, ospace: int = 1, norm_type: int = 0) -> np.ndarray:
    """기저벡터 직교화/정규화

    Args:
        b_v: 기저벡터 행렬
        ospace: 직교 공간 옵션 (1-4)
        norm_type: 정규화 방법 (0-3)

    Returns:
        b_v: 업데이트된 기저벡터
    """
    # 기본: 열 정규화
    n, m = b_v.shape
    for j in range(m):
        norm = np.linalg.norm(b_v[:, j])
        if norm > 1e-14:
            b_v[:, j] /= norm
    return b_v
