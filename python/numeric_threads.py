"""엔진 프로세스의 수치 라이브러리(OpenBLAS · OpenMP · MKL) 스레드를 1 로 고정한다 — V8-04 (2026-11-24).

FSM 고유치 풀이(LAPACK)의 끝자리는 BLAS 스레드 수에 따라 달랐다(서명곡선 Mcre 상대 1e-7 – 1e-6, 검토 비 1e-11).
같은 입력이 같은 PC 에서 환경(OPENBLAS_NUM_THREADS · 코어 수)과 무관하게 같은 바이트를 내도록, numpy 를 가져오기
**전에** 이 모듈을 가져온다: server.py 의 맨 앞, engine · design 꾸러미의 __init__, 시험의 진입(run_all · conftest).
사용자가 준 값도 덮어쓴다 — 엔진 프로세스 안의 일이다(호스트 · 다른 프로세스는 바뀌지 않는다).

보장하지 않는 것: 다른 CPU 는 OpenBLAS 가 다른 커널(DYNAMIC_ARCH: Haswell · SkylakeX · Zen …)을 고르므로 PC 사이에서는
끝자리가 다를 수 있다. numpy · scipy · OpenBLAS 의 판이 바뀌어도 같다(그 판은 engine_runtime 에 들어간다).
"""

import os
import sys

THREAD_VARS = ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'BLIS_NUM_THREADS',
               'VECLIB_MAXIMUM_THREADS', 'NUMEXPR_NUM_THREADS')
# numpy 가 이미 올라와 있으면 이 고정은 늦었다(라이브러리는 올라올 때 한 번 읽는다) — selftest 가 알린다.
PINNED_BEFORE_NUMPY = 'numpy' not in sys.modules
for _k in THREAD_VARS:
    os.environ[_k] = '1'


def status() -> dict:
    return {'threads': 1, 'variables': list(THREAD_VARS), 'pinned_before_numpy': PINNED_BEFORE_NUMPY}
