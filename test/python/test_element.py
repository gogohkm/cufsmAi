"""요소 강성행렬 단위 테스트"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import numpy as np
from python.engine.element import klocal, kglocal, spring_klocal
from python.engine.boundary import BC_I1_5


def test_bc_i1_5_ss():
    """S-S 경계조건: m=n일 때만 비영"""
    I1, I2, I3, I4, I5 = BC_I1_5('S-S', 1, 1, 100.0)
    assert abs(I1 - 50.0) < 1e-10, f"I1={I1}, expected 50.0"
    assert I5 > 0, f"I5={I5}, expected > 0"

    # m != n → 0
    I1, I2, I3, I4, I5 = BC_I1_5('S-S', 1, 2, 100.0)
    assert I1 == 0 and I2 == 0 and I3 == 0 and I4 == 0 and I5 == 0


def test_bc_i1_5_all_types():
    """5종 BC 모두 에러 없이 실행"""
    for bc in ['S-S', 'C-C', 'S-C', 'C-F', 'C-G']:
        for m in [1, 2, 3]:
            for n in [1, 2, 3]:
                I1, I2, I3, I4, I5 = BC_I1_5(bc, m, n, 100.0)
                # NaN/Inf 없어야 함
                for val in [I1, I2, I3, I4, I5]:
                    assert np.isfinite(val), f"BC={bc}, m={m}, n={n}: non-finite value"


def test_klocal_shape():
    """klocal 반환 행렬 크기 확인"""
    m_a = np.array([1.0])
    k = klocal(29500, 29500, 0.3, 0.3, 11346, 0.1, 100.0, 5.0, 'S-S', m_a)
    assert k.shape == (8, 8), f"Expected (8,8), got {k.shape}"

    m_a = np.array([1.0, 2.0])
    k = klocal(29500, 29500, 0.3, 0.3, 11346, 0.1, 100.0, 5.0, 'S-S', m_a)
    assert k.shape == (16, 16), f"Expected (16,16), got {k.shape}"


def test_klocal_symmetry():
    """klocal은 S-S일 때 대칭"""
    m_a = np.array([1.0])
    k = klocal(29500, 29500, 0.3, 0.3, 11346, 0.1, 100.0, 5.0, 'S-S', m_a)
    # 멤브레인 블록(0:4,0:4)은 비대칭 가능 (D1 항), 휨 블록도
    # 전체 행렬은 근사 대칭
    diff = np.max(np.abs(k - k.T))
    assert diff < 1e-6, f"klocal asymmetry = {diff}"


def test_kglocal_shape():
    """kglocal 반환 행렬 크기"""
    m_a = np.array([1.0])
    kg = kglocal(100.0, 5.0, 50.0, 50.0, 'S-S', m_a)
    assert kg.shape == (8, 8)


def test_kglocal_symmetry():
    """kglocal은 대칭"""
    m_a = np.array([1.0])
    kg = kglocal(100.0, 5.0, 50.0, 50.0, 'S-S', m_a)
    diff = np.max(np.abs(kg - kg.T))
    assert diff < 1e-10, f"kglocal asymmetry = {diff}"


def test_spring_klocal_shape():
    """spring_klocal 크기 확인"""
    m_a = np.array([1.0])
    ks = spring_klocal(10, 10, 10, 1, 100.0, 'S-S', m_a, False, 0.0)
    assert ks.shape == (8, 8)


if __name__ == '__main__':
    test_bc_i1_5_ss()
    test_bc_i1_5_all_types()
    test_klocal_shape()
    test_klocal_symmetry()
    test_kglocal_shape()
    test_kglocal_symmetry()
    test_spring_klocal_shape()
    print("All element tests passed!")
