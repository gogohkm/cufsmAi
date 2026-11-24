"""
cfs_centerline.py — 비권위(non-authoritative) 진입점
=====================================================

권위 있는 구현은 `python/engine/cfs_centerline.py` 하나다(엔진의 임의 단면 경로
`template._gen_custom` 이 그것을 쓴다). 이 파일은 예전에 따로 고쳐 쓰던 사본이었고
엔진과 갈라져(corner_radii 의 뜻, make_c/z_section 의 립 방향 등) 같은 이름으로
다른 단면을 만들었다. 2026-11-22 엔진 수정(F2, R2-18)부터 사본을 두지 않고 엔진
모듈을 그대로 다시 내보낸다 — `Example/` 에서 `from cfs_centerline import ...` 로
쓰던 스크립트와 문서(CFS_CENTERLINE_ALGORITHM.md, verify_all_examples.py)는 그대로
돌아가고, 결과는 엔진과 같다.

이 파일에 기능을 더하지 말 것. 고칠 것은 python/engine/cfs_centerline.py 에서 고친다.
"""

import os as _os
import sys as _sys

_PY_ROOT = _os.path.normpath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                           '..', 'python'))
if not _os.path.isfile(_os.path.join(_PY_ROOT, 'engine', 'cfs_centerline.py')):
    raise ImportError(
        "Example/cfs_centerline.py re-exports python/engine/cfs_centerline.py, "
        f"which was not found under {_PY_ROOT}")
if _PY_ROOT not in _sys.path:
    _sys.path.insert(0, _PY_ROOT)

from engine.cfs_centerline import *  # noqa: F401,F403,E402
from engine.cfs_centerline import (  # noqa: F401,E402  (밑줄 이름은 * 로 오지 않는다)
    _left_normal, _right_normal, _vec_len, _vec_normalize,
)
