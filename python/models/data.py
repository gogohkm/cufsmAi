"""CUFSM 데이터 모델 정의

참조: 프로젝트개요.md §3 (MATLAB 데이터 구조)
참조: 컨버전전략.md §3 (JSON 메시지 프로토콜), §9 (프로젝트 파일 형식)

MATLAB 원본 데이터 형식:
  prop: [matnum Ex Ey vx vy G]           (nmats × 6)
  node: [node# x z dofx dofz dofy dofrot stress]  (nnodes × 8)
  elem: [elem# nodei nodej t matnum]     (nelems × 5)
  lengths: [L1 L2 ...]                   (1 × nlengths)
  springs: [num nodei nodej ku kv kw kq local discrete yonL]  (nsprings × 10)
  constraints: [node_e dof_e coeff node_k dof_k]  (nconstraints × 5)

주의: MATLAB은 1-based, Python은 0-based 인덱싱.
      node#, elem#, nodei, nodej는 내부적으로 0-based로 변환하여 사용.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import numpy as np


@dataclass
class GBTConfig:
    """cFSM 모드 분류 설정 (GBT 기반)

    참조: 프로젝트개요.md §5.2 구속 유한스트립법
    """
    glob: np.ndarray = field(default_factory=lambda: np.array([]))
    dist: np.ndarray = field(default_factory=lambda: np.array([]))
    local: np.ndarray = field(default_factory=lambda: np.array([]))
    other: np.ndarray = field(default_factory=lambda: np.array([]))
    ospace: int = 1   # 직교 공간 옵션 (1-4)
    orth: int = 1     # 직교화 방법 (1-3)
    couple: int = 1   # 결합/비결합 기저 (1-2)
    norm: int = 0     # 정규화 방법 (0-3)

    def is_active(self) -> bool:
        """cFSM 모드 분류가 활성화되어 있는지 확인"""
        return (len(self.glob) > 0 or len(self.dist) > 0 or
                len(self.local) > 0 or len(self.other) > 0)

    def to_dict(self) -> dict:
        return {
            'glob': self.glob.tolist(),
            'dist': self.dist.tolist(),
            'local': self.local.tolist(),
            'other': self.other.tolist(),
            'ospace': self.ospace,
            'orth': self.orth,
            'couple': self.couple,
            'norm': self.norm,
        }

    @classmethod
    def from_dict(cls, d: dict) -> GBTConfig:
        return cls(
            glob=np.array(d.get('glob', [])),
            dist=np.array(d.get('dist', [])),
            local=np.array(d.get('local', [])),
            other=np.array(d.get('other', [])),
            ospace=d.get('ospace', 1),
            orth=d.get('orth', 1),
            couple=d.get('couple', 1),
            norm=d.get('norm', 0),
        )


@dataclass
class CufsmModel:
    """CUFSM 해석 입력 모델

    참조: 프로젝트개요.md §4 해석 워크플로우 [1]~[4]
    """
    prop: np.ndarray          # (nmats, 6)
    node: np.ndarray          # (nnodes, 8)
    elem: np.ndarray          # (nelems, 5)
    lengths: np.ndarray       # (nlengths,)
    springs: np.ndarray       # (nsprings, 10) or shape (0,)
    constraints: np.ndarray   # (nconstraints, 5) or shape (0,)
    BC: str = 'S-S'           # 경계조건
    m_all: list = field(default_factory=list)   # list[np.ndarray]
    GBTcon: GBTConfig = field(default_factory=GBTConfig)
    neigs: int = 10

    @property
    def nnodes(self) -> int:
        return self.node.shape[0]

    @property
    def nelems(self) -> int:
        return self.elem.shape[0]

    @property
    def nlengths(self) -> int:
        return len(self.lengths)

    def to_dict(self) -> dict:
        """JSON 직렬화용 딕셔너리 변환"""
        return {
            'prop': self.prop.tolist(),
            'node': self.node.tolist(),
            'elem': self.elem.tolist(),
            'lengths': self.lengths.tolist(),
            'springs': self.springs.tolist() if self.springs.size > 0 else [],
            'constraints': self.constraints.tolist() if self.constraints.size > 0 else [],
            'BC': self.BC,
            'm_all': [m.tolist() for m in self.m_all],
            'GBTcon': self.GBTcon.to_dict(),
            'neigs': self.neigs,
        }

    @classmethod
    def from_dict(cls, d: dict) -> CufsmModel:
        """JSON 딕셔너리에서 모델 생성"""
        springs_data = d.get('springs', [])
        constraints_data = d.get('constraints', [])
        return cls(
            prop=np.array(d['prop'], dtype=float),
            node=np.array(d['node'], dtype=float),
            elem=np.array(d['elem'], dtype=float),
            lengths=np.array(d['lengths'], dtype=float),
            springs=np.array(springs_data, dtype=float) if len(springs_data) > 0 else np.array([]),
            constraints=np.array(constraints_data, dtype=float) if len(constraints_data) > 0 else np.array([]),
            BC=d.get('BC', 'S-S'),
            m_all=[np.array(m, dtype=float) for m in d.get('m_all', [])],
            GBTcon=GBTConfig.from_dict(d.get('GBTcon', {})),
            neigs=d.get('neigs', 10),
        )

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, s: str) -> CufsmModel:
        return cls.from_dict(json.loads(s))


@dataclass
class CufsmResult:
    """CUFSM 해석 결과

    참조: 프로젝트개요.md §4 해석 워크플로우 [5]~[6]

    curve[i]: 길이 i에서의 (nummodes, 2) 배열 — [length, load_factor]
    shapes[i]: 길이 i에서의 (ndof, nummodes) 배열 — 모드형상 벡터
    """
    curve: list = field(default_factory=list)    # list[np.ndarray]
    shapes: list = field(default_factory=list)   # list[np.ndarray]

    def to_dict(self) -> dict:
        """JSON 직렬화 — curve + shapes 포함"""
        curve_list = []
        for c in self.curve:
            if isinstance(c, np.ndarray):
                curve_list.append(c.tolist())
            else:
                curve_list.append(c)
        shapes_list = []
        for s in self.shapes:
            if isinstance(s, np.ndarray):
                shapes_list.append(s.tolist())
            else:
                shapes_list.append(s)
        return {
            'curve': curve_list,
            'shapes': shapes_list,
            'n_lengths': len(self.curve),
        }

    def to_full_dict(self) -> dict:
        """모드형상 포함 전체 직렬화"""
        d = self.to_dict()
        shapes_list = []
        for s in self.shapes:
            if isinstance(s, np.ndarray):
                shapes_list.append(s.tolist())
            else:
                shapes_list.append(s)
        d['shapes'] = shapes_list
        return d

    @classmethod
    def from_dict(cls, d: dict) -> CufsmResult:
        curve = [np.array(c) for c in d.get('curve', [])]
        shapes = [np.array(s) for s in d.get('shapes', [])]
        return cls(curve=curve, shapes=shapes)


def _json_serializer(obj: Any) -> Any:
    """numpy 배열을 JSON 직렬화 가능하도록 변환 (NaN/Inf → null)"""
    import math
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, np.ndarray):
        cleaned = np.where(np.isfinite(obj), obj, 0.0) if obj.dtype.kind == 'f' else obj
        return cleaned.tolist()
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        val = float(obj)
        return None if (math.isnan(val) or math.isinf(val)) else val
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


class SafeJsonEncoder(json.JSONEncoder):
    """NaN/Infinity를 null로 변환하는 JSON 인코더.

    json.dumps의 default 함수는 native float에 호출되지 않으므로,
    iterencode를 오버라이드하여 float('nan'), float('inf')를 근본 차단한다.
    """

    def default(self, obj: Any) -> Any:
        return _json_serializer(obj)

    def iterencode(self, o, _one_shot=False):
        """재귀적으로 dict/list를 순회하며 NaN/Inf float를 None으로 치환"""
        return super().iterencode(self._sanitize(o), _one_shot)

    @staticmethod
    def _sanitize(obj):
        import math
        if isinstance(obj, float):
            if math.isnan(obj) or math.isinf(obj):
                return None
        elif isinstance(obj, dict):
            return {k: SafeJsonEncoder._sanitize(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [SafeJsonEncoder._sanitize(v) for v in obj]
        elif isinstance(obj, np.ndarray):
            cleaned = np.where(np.isfinite(obj), obj, 0.0) if obj.dtype.kind == 'f' else obj
            return cleaned.tolist()
        elif isinstance(obj, np.floating):
            val = float(obj)
            return None if (math.isnan(val) or math.isinf(val)) else val
        elif isinstance(obj, np.integer):
            return int(obj)
        return obj
