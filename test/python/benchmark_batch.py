"""CUFSM Python 엔진 검증 스크립트

원본 batchcufsm5.m의 기본 단면(Lipped C-channel)을 사용하여
Python 해석 엔진의 결과를 검증한다.

사용법: python -m test.python.benchmark_batch (프로젝트 루트에서)
또는:   cd c:\Coding_Works\cufsmAi && python test/python/benchmark_batch.py
"""

import sys
import os
import time

# 프로젝트 루트를 경로에 추가
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import numpy as np
from python.engine.fsm_solver import stripmain
from python.engine.properties import grosprop
from python.models.data import GBTConfig


def create_default_model():
    """batchcufsm5.m의 기본 단면 데이터 (doubler 적용 전)

    Lipped C-channel, 축압축 하중 (순수 P)
    """
    # Material: [matnum Ex Ey vx vy G]
    prop = np.array([[100, 29500.00, 29500.00, 0.30, 0.30, 11346.15]])

    # Nodes: [node# x z dofx dofz dofy dofrot stress]
    # 기본 단면 — 순수 축압축 응력 (fy=50, P만 적용)
    node = np.array([
        [1,  5.00, 1.00, 1, 1, 1, 1, 50.00],
        [2,  5.00, 0.00, 1, 1, 1, 1, 50.00],
        [3,  2.50, 0.00, 1, 1, 1, 1, 50.00],
        [4,  0.00, 0.00, 1, 1, 1, 1, 50.00],
        [5,  0.00, 3.00, 1, 1, 1, 1, 50.00],
        [6,  0.00, 6.00, 1, 1, 1, 1, 50.00],
        [7,  0.00, 9.00, 1, 1, 1, 1, 50.00],
        [8,  2.50, 9.00, 1, 1, 1, 1, 50.00],
        [9,  5.00, 9.00, 1, 1, 1, 1, 50.00],
        [10, 5.00, 8.00, 1, 1, 1, 1, 50.00],
    ])

    # Elements: [elem# nodei nodej t matnum]
    elem = np.array([
        [1, 1, 2, 0.10, 100],
        [2, 2, 3, 0.10, 100],
        [3, 3, 4, 0.10, 100],
        [4, 4, 5, 0.10, 100],
        [5, 5, 6, 0.10, 100],
        [6, 6, 7, 0.10, 100],
        [7, 7, 8, 0.10, 100],
        [8, 8, 9, 0.10, 100],
        [9, 9, 10, 0.10, 100],
    ])

    return prop, node, elem


def run_benchmark():
    """기본 단면 좌굴 해석 실행 및 결과 확인"""
    print("=" * 60)
    print("CUFSM Python Engine Benchmark")
    print("=" * 60)

    prop, node, elem = create_default_model()

    # 단면 성질 확인
    props = grosprop(node, elem)
    print(f"\nSection Properties:")
    print(f"  A   = {props['A']:.4f}")
    print(f"  xcg = {props['xcg']:.4f}")
    print(f"  zcg = {props['zcg']:.4f}")
    print(f"  Ixx = {props['Ixx']:.4f}")
    print(f"  Izz = {props['Izz']:.4f}")

    # 해석 설정
    # 소수의 길이로 빠른 테스트
    lengths = np.array([2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0])
    BC = 'S-S'
    m_all = [np.array([1.0]) for _ in lengths]
    springs = np.array([])
    constraints = np.array([])
    GBTcon = GBTConfig()

    print(f"\nAnalysis Settings:")
    print(f"  BC = {BC}")
    print(f"  Lengths: {len(lengths)} points ({lengths[0]:.1f} ~ {lengths[-1]:.1f})")
    print(f"  Nodes: {node.shape[0]}, Elements: {elem.shape[0]}")

    # 해석 실행
    print(f"\nRunning analysis...")
    t0 = time.time()
    result = stripmain(prop, node, elem, lengths, springs, constraints,
                       GBTcon, BC, m_all, neigs=10)
    elapsed = time.time() - t0
    print(f"  Completed in {elapsed:.3f} seconds")

    # 결과 출력
    print(f"\nBuckling Curve (1st mode):")
    print(f"  {'Length':>10s}  {'Load Factor':>12s}")
    print(f"  {'-'*10}  {'-'*12}")
    for i, c in enumerate(result.curve):
        if c is not None and c.size > 0:
            length = c[0, 0]
            lf = c[0, 1] if c.shape[1] > 1 else 0.0
            print(f"  {length:10.2f}  {lf:12.4f}")

    print(f"\n{'=' * 60}")
    print("Benchmark complete.")
    print(f"{'=' * 60}")

    return result


if __name__ == '__main__':
    run_benchmark()
