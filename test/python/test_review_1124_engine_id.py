"""2026-11-24 — engine_id: 저장한 결과가 어느 엔진의 것인지(server.selftest).

같은 소스 → 같은 id, 설계 모듈 한 바이트 → 다른 id, CRLF ↔ LF → 같은 id, 한 파일이라도 못 읽으면 'unknown'.
파일을 쓰지 않는다 — 실제 소스를 읽어 메모리에서 바꾼다.
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'python')
sys.path.insert(0, PY)

import server  # noqa: E402


def test_same_sources_same_id_and_selftest_reports_it():
    a, ea = server.compute_engine_id(PY)
    b, eb = server.compute_engine_id(PY)
    assert ea is None and eb is None
    assert a == b == server.ENGINE_ID == server._m_selftest({})['engine_id']
    assert re.fullmatch(r'sha256:[0-9a-f]{64}', a)


def test_one_byte_in_a_design_module_changes_the_id():
    items = server._engine_sources(PY)
    rels = [r for r, _ in items]
    assert 'design/checks.py' in rels and 'server.py' in rels and 'design/loads/required_strength.py' in rels
    assert not any('__pycache__' in r or os.path.basename(r).startswith('test_') for r in rels)
    k = rels.index('design/checks.py')
    changed = list(items)
    data = changed[k][1]
    changed[k] = (rels[k], data[:-1] + bytes([data[-1] ^ 1]))
    assert server.engine_id_of(changed) != server.engine_id_of(items)
    renamed = list(items)
    renamed[k] = ('design/checks2.py', data)               # 경로도 해시에 든다
    assert server.engine_id_of(renamed) != server.engine_id_of(items)


def test_crlf_and_lf_checkouts_give_the_same_id():
    items = server._engine_sources(PY)
    lf = [(r, d.replace(b'\r\n', b'\n')) for r, d in items]
    crlf = [(r, d.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')) for r, d in items]
    assert server.engine_id_of(lf) == server.engine_id_of(crlf) == server.engine_id_of(items)


def test_unreadable_or_missing_source_gives_unknown_not_a_partial_hash():
    real_open = open

    def failing_open(path, *a, **kw):
        if str(path).replace(os.sep, '/').endswith('design/shear.py'):
            raise PermissionError('denied')
        return real_open(path, *a, **kw)

    import builtins
    builtins.open = failing_open
    try:
        eid, err = server.compute_engine_id(PY)
    finally:
        builtins.open = real_open
    assert eid == 'unknown' and 'PermissionError' in err
    eid2, err2 = server.compute_engine_id(os.path.join(PY, 'design'))      # 폴더가 없는 배치
    assert eid2 == 'unknown' and 'missing' in err2
