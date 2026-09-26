"""pytest 진입점 — 함수형 스위트를 pytest 규약(assert)으로 수집.

기존 스위트(test_solver/test_element/test_design_verification/test_regression_0926)는
return-False 규약이라 pytest가 직접 수집하면 거짓-통과가 난다.
이 모듈이 각 함수를 호출하고 `is False`를 assert로 전환하므로,
원본 파일 수정 없이 `pytest test/python/test_pytest_entry.py` 게이트가 성립한다.
"""

import pytest

import test_unittest_collection as existing
import test_regression_0926 as reg0926


def _collect():
    cases = []
    for module, names in existing.TEST_FUNCTIONS:
        for name in names:
            cases.append(pytest.param(module, name, id=f'{module.__name__}.{name}'))
    for name in sorted(dir(reg0926)):
        if name.startswith('test_') and callable(getattr(reg0926, name)):
            cases.append(pytest.param(reg0926, name,
                                      id=f'test_regression_0926.{name}'))
    return cases


@pytest.mark.parametrize('module,name', _collect())
def test_suite_entry(module, name):
    func = getattr(module, name)
    assert func() is not False, f'{module.__name__}.{name} reported failure'
