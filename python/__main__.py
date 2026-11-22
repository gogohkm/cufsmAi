"""CUFSM Python 엔진 진입점

사용법: python -m python (프로젝트 루트에서)
또는:   python python/__main__.py
확장은 cwd=python 에서 `python -u server.py` 로 띄운다 — 어느 쪽이든 같은 server.main 이다.
"""

import os
import sys

# `python -m python` 은 저장소 루트를 sys.path 에 둔다 — 엔진 모듈(engine, design …)은 이 폴더 기준.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from server import main  # noqa: E402

if __name__ == '__main__':
    main()
