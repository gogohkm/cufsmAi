"""0926 Phase 5: 전체 Python 테스트 게이트 (표준 unittest만 사용).

- test_unittest_collection: 기존 스위트 (FunctionTestCase 래핑, False=실패)
- test_regression_0926: 0926 회귀 스위트 (동일 규약으로 래핑)

실행: .venv/bin/python test/python/run_all.py   (repo root 기준 어디서든 가능)
종료코드 0 = 전체 통과.

참고: pytest는 설치되어 있지 않으며, 본 스위트의 return-False 규약은
pytest의 assert 규약과 달라 그대로 수집하면 거짓-통과가 난다.
pytest 이행은 assert 전환 후 별도 과제로 둔다.
"""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'test', 'python'))
sys.path.insert(0, os.path.join(ROOT, 'python'))

import test_unittest_collection as existing  # noqa: E402
import test_regression_0926 as reg0926  # noqa: E402


def _wrap(func):
    def _runner():
        result = func()
        if result is False:
            raise AssertionError(f'{func.__module__}.{func.__name__} reported failure')
    return _runner


def build_suite():
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    # 기존 스위트 (load_tests 훅 경유)
    suite.addTests(loader.loadTestsFromModule(existing))
    # 0926 회귀 스위트
    for name in sorted(dir(reg0926)):
        if name.startswith('test_') and callable(getattr(reg0926, name)):
            suite.addTest(unittest.FunctionTestCase(
                _wrap(getattr(reg0926, name)),
                description=f'test_regression_0926.{name}',
            ))
    return suite


if __name__ == '__main__':
    runner = unittest.TextTestRunner(verbosity=1)
    result = runner.run(build_suite())
    sys.exit(0 if result.wasSuccessful() else 1)
