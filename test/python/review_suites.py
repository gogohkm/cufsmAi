"""리뷰 회귀 스위트 자동 수집.

`test/python/test_review_*.py` 의 `test_*` 함수를 모아 run_all.py(unittest)와
test_pytest_entry.py(pytest) 두 게이트에 똑같이 넘긴다. 새 리뷰 스위트 파일은
이름만 맞추면 어느 게이트에도 따로 등록할 필요가 없다.

규약: 실패는 `assert` 로 알린다(예외 = 실패). 기존 스위트의 `return False`
규약도 두 게이트가 실패로 처리하므로 섞여 있어도 거짓-통과가 나지 않는다.
"""

import glob
import importlib
import os

_HERE = os.path.dirname(os.path.abspath(__file__))


def iter_review_modules():
    for path in sorted(glob.glob(os.path.join(_HERE, 'test_review_*.py'))):
        yield importlib.import_module(os.path.splitext(os.path.basename(path))[0])


def iter_review_tests():
    """(module, function_name) 쌍을 파일 이름 · 함수 이름 순으로 낸다."""
    for module in iter_review_modules():
        for name in sorted(dir(module)):
            if name.startswith('test_') and callable(getattr(module, name)):
                yield module, name
