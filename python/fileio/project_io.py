"""프로젝트 파일 I/O (.cufsm JSON)

참조: 컨버전전략.md §9 프로젝트 파일 형식

형식: {"format": "cufsm-vscode", "version": "1.0", <CufsmModel.to_dict() 의 키>}.
읽기는 같은 주 버전(1.x)만 받는다. 머리말(format · version)이 없는 파일은 모델 JSON
그대로(예: 호스트가 저장한 원시 모델)로 읽고 그렇다고 알린다.
"""

import json
import os
import tempfile

from models.data import CufsmModel
from design.notices import N as _nt  # noqa: E402

PROJECT_FORMAT = 'cufsm-vscode'
PROJECT_VERSION = '1.0'
SUPPORTED_MAJOR = 1

# 해석 모델을 다시 만들 수 있으려면 꼭 있어야 하는 키
_REQUIRED_KEYS = ('prop', 'node', 'elem', 'lengths', 'BC')


def save_project(model: CufsmModel, filepath: str) -> None:
    """CufsmModel을 .cufsm JSON 파일로 저장

    NaN · Inf 는 JSON 이 아니므로 쓰지 않고 거절한다. 임시 파일에 다 쓴 뒤 바꿔 넣어
    실패해도 이전 파일이 반쯤 덮이지 않게 한다.
    """
    if not filepath:
        raise ValueError('save_project: filepath is required')
    data = {
        'version': PROJECT_VERSION,
        'format': PROJECT_FORMAT,
    }
    data.update(model.to_dict())
    try:
        text = json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False)
    except ValueError as e:
        raise ValueError(f'save_project: the model contains NaN or Infinity ({e})') from e

    folder = os.path.dirname(os.path.abspath(filepath))
    fd, tmp = tempfile.mkstemp(prefix='.cufsm-', suffix='.tmp', dir=folder)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
        os.replace(tmp, filepath)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def _reject_constant(name):
    raise ValueError(f'file contains {name}, which is not valid JSON')


def read_project(filepath: str):
    """JSON .cufsm 파일에서 (CufsmModel, file_info) 를 읽는다.

    file_info: {'format', 'version', 'warnings', 'assumptions'}.
    """
    if not filepath:
        raise ValueError('load_project: filepath is required')
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f, parse_constant=_reject_constant)
    if not isinstance(data, dict):
        raise ValueError('load_project: the file does not contain a JSON object')

    warnings = []
    assumptions = []
    fmt = data.get('format')
    ver = data.get('version')
    if fmt is not None and fmt != PROJECT_FORMAT:
        raise ValueError(f"load_project: unknown file format '{fmt}' (expected '{PROJECT_FORMAT}')")
    if ver is not None:
        try:
            major = int(str(ver).split('.')[0])
        except ValueError as e:
            raise ValueError(f"load_project: unreadable file version '{ver}'") from e
        if major > SUPPORTED_MAJOR:
            raise ValueError(f"load_project: file version {ver} is newer than this program "
                             f"supports ({SUPPORTED_MAJOR}.x)")
        if major < SUPPORTED_MAJOR:
            raise ValueError(f"load_project: unsupported file version {ver}")
    if fmt is None and ver is None:
        assumptions.append(_nt('file.assumption.no_format_version_header'))

    missing = [k for k in _REQUIRED_KEYS if k not in data]
    if missing:
        raise ValueError(f"load_project: the file is missing {', '.join(missing)}")
    model = CufsmModel.from_dict(data)
    return model, {'format': fmt, 'version': ver, 'warnings': warnings,
                   'assumptions': assumptions}


def load_project(filepath: str) -> CufsmModel:
    """JSON .cufsm 파일에서 CufsmModel 로드"""
    return read_project(filepath)[0]
