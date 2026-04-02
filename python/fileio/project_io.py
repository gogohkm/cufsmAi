"""프로젝트 파일 I/O (.cufsm JSON)

참조: 컨버전전략.md §9 프로젝트 파일 형식
"""

import json

from models.data import CufsmModel


def save_project(model: CufsmModel, filepath: str) -> None:
    """CufsmModel을 .cufsm JSON 파일로 저장"""
    data = {
        'version': '1.0',
        'format': 'cufsm-vscode',
    }
    data.update(model.to_dict())

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def load_project(filepath: str) -> CufsmModel:
    """JSON .cufsm 파일에서 CufsmModel 로드"""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # version, format 필드는 무시하고 모델 데이터만 추출
    return CufsmModel.from_dict(data)
