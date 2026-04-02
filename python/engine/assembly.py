"""전체 강성행렬 조립

원본: Ref_Source/analysis/assemble.m, spring_assemble.m

글로벌 DOF 배치:
  각 m항(longitudinal term)마다 4*nnodes DOF:
    처음 2*nnodes: 멤브레인 [u1,v1, u2,v2, ..., un,vn]
    다음 2*nnodes: 휨 [w1,θ1, w2,θ2, ..., wn,θn]
  전체: 4*nnodes*totalm × 4*nnodes*totalm

주의: MATLAB의 nodei, nodej는 1-based.
      이 모듈에서는 MATLAB 원본과 동일한 1-based 값을 받아서 처리.
"""

import numpy as np
from scipy import sparse


def _extract_blocks(mat: np.ndarray, i: int, j: int) -> dict:
    """8x8 요소 행렬에서 2x2 서브블록 16개 추출

    Args:
        mat: (8*totalm × 8*totalm)
        i, j: m항 인덱스 (0-based)

    Returns:
        dict with keys '11','12','13','14','21',...,'44'
    """
    ri = 8 * i
    rj = 8 * j
    blocks = {}
    for a in range(4):
        for b in range(4):
            key = f'{a+1}{b+1}'
            blocks[key] = mat[ri + 2*a:ri + 2*a + 2, rj + 2*b:rj + 2*b + 2]
    return blocks


def assemble(K: sparse.lil_matrix, Kg: sparse.lil_matrix,
             k: np.ndarray, kg: np.ndarray,
             nodei: int, nodej: int, nnodes: int,
             m_a: np.ndarray) -> tuple:
    """요소 행렬을 전체 행렬에 조립

    Args:
        K, Kg: 전체 행렬 (scipy.sparse.lil_matrix, 4*nnodes*totalm × 4*nnodes*totalm)
        k, kg: 요소 행렬 (8*totalm × 8*totalm) — 글로벌 좌표계
        nodei, nodej: 절점 번호 (MATLAB 1-based)
        nnodes: 전체 절점 수
        m_a: 종방향 조화항 배열

    Returns:
        (K, Kg) 업데이트된 전체 행렬
    """
    totalm = len(m_a)
    skip = 2 * nnodes
    nd = 4 * nnodes

    for i in range(totalm):
        for j in range(totalm):
            # 요소 행렬에서 2x2 서브블록 추출
            kb = _extract_blocks(k, i, j)
            kgb = _extract_blocks(kg, i, j)

            # MATLAB 1-based → 글로벌 위치 (0-based 슬라이싱)
            # 멤브레인: 노드 n → 글로벌 인덱스 (n*2-2):(n*2) (0-based)
            mi = nodei * 2 - 2  # nodei의 멤브레인 시작 (0-based)
            mj = nodej * 2 - 2
            fi = skip + nodei * 2 - 2  # nodei의 휨 시작
            fj = skip + nodej * 2 - 2

            ri = nd * i  # i번째 m항 오프셋
            rj = nd * j

            # k11: nodei_mem × nodei_mem
            K[ri+mi:ri+mi+2, rj+mi:rj+mi+2] += kb['11']
            # k12: nodei_mem × nodej_mem
            K[ri+mi:ri+mi+2, rj+mj:rj+mj+2] += kb['12']
            # k21: nodej_mem × nodei_mem
            K[ri+mj:ri+mj+2, rj+mi:rj+mi+2] += kb['21']
            # k22: nodej_mem × nodej_mem
            K[ri+mj:ri+mj+2, rj+mj:rj+mj+2] += kb['22']

            # k33: nodei_flex × nodei_flex
            K[ri+fi:ri+fi+2, rj+fi:rj+fi+2] += kb['33']
            # k34: nodei_flex × nodej_flex
            K[ri+fi:ri+fi+2, rj+fj:rj+fj+2] += kb['34']
            # k43: nodej_flex × nodei_flex
            K[ri+fj:ri+fj+2, rj+fi:rj+fi+2] += kb['43']
            # k44: nodej_flex × nodej_flex
            K[ri+fj:ri+fj+2, rj+fj:rj+fj+2] += kb['44']

            # k13: nodei_mem × nodei_flex
            K[ri+mi:ri+mi+2, rj+fi:rj+fi+2] += kb['13']
            # k14: nodei_mem × nodej_flex
            K[ri+mi:ri+mi+2, rj+fj:rj+fj+2] += kb['14']
            # k23: nodej_mem × nodei_flex
            K[ri+mj:ri+mj+2, rj+fi:rj+fi+2] += kb['23']
            # k24: nodej_mem × nodej_flex
            K[ri+mj:ri+mj+2, rj+fj:rj+fj+2] += kb['24']

            # k31: nodei_flex × nodei_mem
            K[ri+fi:ri+fi+2, rj+mi:rj+mi+2] += kb['31']
            # k32: nodei_flex × nodej_mem
            K[ri+fi:ri+fi+2, rj+mj:rj+mj+2] += kb['32']
            # k41: nodej_flex × nodei_mem
            K[ri+fj:ri+fj+2, rj+mi:rj+mi+2] += kb['41']
            # k42: nodej_flex × nodej_mem
            K[ri+fj:ri+fj+2, rj+mj:rj+mj+2] += kb['42']

            # Kg 동일 구조
            Kg[ri+mi:ri+mi+2, rj+mi:rj+mi+2] += kgb['11']
            Kg[ri+mi:ri+mi+2, rj+mj:rj+mj+2] += kgb['12']
            Kg[ri+mj:ri+mj+2, rj+mi:rj+mi+2] += kgb['21']
            Kg[ri+mj:ri+mj+2, rj+mj:rj+mj+2] += kgb['22']

            Kg[ri+fi:ri+fi+2, rj+fi:rj+fi+2] += kgb['33']
            Kg[ri+fi:ri+fi+2, rj+fj:rj+fj+2] += kgb['34']
            Kg[ri+fj:ri+fj+2, rj+fi:rj+fi+2] += kgb['43']
            Kg[ri+fj:ri+fj+2, rj+fj:rj+fj+2] += kgb['44']

            Kg[ri+mi:ri+mi+2, rj+fi:rj+fi+2] += kgb['13']
            Kg[ri+mi:ri+mi+2, rj+fj:rj+fj+2] += kgb['14']
            Kg[ri+mj:ri+mj+2, rj+fi:rj+fi+2] += kgb['23']
            Kg[ri+mj:ri+mj+2, rj+fj:rj+fj+2] += kgb['24']

            Kg[ri+fi:ri+fi+2, rj+mi:rj+mi+2] += kgb['31']
            Kg[ri+fi:ri+fi+2, rj+mj:rj+mj+2] += kgb['32']
            Kg[ri+fj:ri+fj+2, rj+mi:rj+mi+2] += kgb['41']
            Kg[ri+fj:ri+fj+2, rj+mj:rj+mj+2] += kgb['42']

    return K, Kg


def spring_assemble(K: sparse.lil_matrix, k_spring: np.ndarray,
                    nodei: int, nodej: int, nnodes: int,
                    m_a: np.ndarray) -> sparse.lil_matrix:
    """스프링 강성을 전체 행렬에 추가

    nodej=0 (접지 스프링): nodei에만 기여, nodej 블록 건너뜀

    Args:
        K: 전체 강성행렬
        k_spring: 스프링 요소 행렬 (8*totalm × 8*totalm)
        nodei, nodej: 절점 번호 (MATLAB 1-based, nodej=0이면 접지)
        nnodes: 전체 절점 수
        m_a: 종방향 조화항

    Returns:
        K: 업데이트된 전체 행렬
    """
    totalm = len(m_a)
    skip = 2 * nnodes
    nd = 4 * nnodes

    for i in range(totalm):
        for j in range(totalm):
            kb = _extract_blocks(k_spring, i, j)
            ri = nd * i
            rj = nd * j

            mi = nodei * 2 - 2
            fi = skip + nodei * 2 - 2

            # nodei × nodei 블록은 항상 추가
            K[ri+mi:ri+mi+2, rj+mi:rj+mi+2] += kb['11']
            K[ri+fi:ri+fi+2, rj+fi:rj+fi+2] += kb['33']
            K[ri+mi:ri+mi+2, rj+fi:rj+fi+2] += kb['13']
            K[ri+fi:ri+fi+2, rj+mi:rj+mi+2] += kb['31']

            if nodej != 0:
                mj = nodej * 2 - 2
                fj = skip + nodej * 2 - 2

                K[ri+mi:ri+mi+2, rj+mj:rj+mj+2] += kb['12']
                K[ri+mj:ri+mj+2, rj+mi:rj+mi+2] += kb['21']
                K[ri+mj:ri+mj+2, rj+mj:rj+mj+2] += kb['22']

                K[ri+fi:ri+fi+2, rj+fj:rj+fj+2] += kb['34']
                K[ri+fj:ri+fj+2, rj+fi:rj+fi+2] += kb['43']
                K[ri+fj:ri+fj+2, rj+fj:rj+fj+2] += kb['44']

                K[ri+mi:ri+mi+2, rj+fj:rj+fj+2] += kb['14']
                K[ri+mj:ri+mj+2, rj+fi:rj+fi+2] += kb['23']
                K[ri+mj:ri+mj+2, rj+fj:rj+fj+2] += kb['24']

                K[ri+fi:ri+fi+2, rj+mj:rj+mj+2] += kb['32']
                K[ri+fj:ri+fj+2, rj+mi:rj+mi+2] += kb['41']
                K[ri+fj:ri+fj+2, rj+mj:rj+mj+2] += kb['42']

    return K
