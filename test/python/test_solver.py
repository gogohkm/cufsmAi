"""FSM 솔버 + 통합 테스트"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import numpy as np
from python.engine.fsm_solver import stripmain
from python.engine.properties import grosprop, elemprop
from python.engine.transform import trans
from python.engine.assembly import assemble
from python.engine.stress import stresgen, yieldMP
from python.engine.template import generate_section
from python.models.data import CufsmModel, GBTConfig
from scipy import sparse


def _default_model():
    """기본 Lipped C-channel"""
    prop = np.array([[100, 29500, 29500, 0.3, 0.3, 11346.15]])
    node = np.array([
        [1, 5.0, 1.0, 1,1,1,1, 50],
        [2, 5.0, 0.0, 1,1,1,1, 50],
        [3, 2.5, 0.0, 1,1,1,1, 50],
        [4, 0.0, 0.0, 1,1,1,1, 50],
        [5, 0.0, 3.0, 1,1,1,1, 50],
        [6, 0.0, 6.0, 1,1,1,1, 50],
        [7, 0.0, 9.0, 1,1,1,1, 50],
        [8, 2.5, 9.0, 1,1,1,1, 50],
        [9, 5.0, 9.0, 1,1,1,1, 50],
        [10, 5.0, 8.0, 1,1,1,1, 50],
    ])
    elem = np.array([
        [1,1,2,0.1,100], [2,2,3,0.1,100], [3,3,4,0.1,100],
        [4,4,5,0.1,100], [5,5,6,0.1,100], [6,6,7,0.1,100],
        [7,7,8,0.1,100], [8,8,9,0.1,100], [9,9,10,0.1,100],
    ])
    return prop, node, elem


def test_grosprop():
    """단면 성질 계산"""
    _, node, elem = _default_model()
    props = grosprop(node, elem)
    assert props['A'] > 0, f"Area = {props['A']}"
    assert np.isfinite(props['Ixx'])
    assert np.isfinite(props['Izz'])
    print(f"  A={props['A']:.4f}, Ixx={props['Ixx']:.4f}, Izz={props['Izz']:.4f}")


def test_elemprop():
    """요소 물성 계산"""
    _, node, elem = _default_model()
    ep = elemprop(node, elem)
    assert ep.shape[0] == 9
    for i in range(9):
        assert ep[i, 1] > 0, f"Element {i}: width = {ep[i,1]}"


def test_trans():
    """좌표 변환 — 회전 불변"""
    from python.engine.element import klocal
    m_a = np.array([1.0])
    k = klocal(29500, 29500, 0.3, 0.3, 11346, 0.1, 100, 5, 'S-S', m_a)
    kg = np.zeros_like(k)
    k0, _ = trans(0.0, k, kg, m_a)
    # alpha=0이면 변환 없음
    diff = np.max(np.abs(k0 - k))
    assert diff < 1e-10, f"trans(0) should not change k, diff={diff}"


def test_assembly():
    """행렬 조립 — 크기 확인"""
    _, node, elem = _default_model()
    nnodes = 10
    m_a = np.array([1.0])
    ndof = 4 * nnodes * 1
    K = sparse.lil_matrix((ndof, ndof))
    Kg = sparse.lil_matrix((ndof, ndof))

    from python.engine.element import klocal, kglocal
    ep = elemprop(node, elem)

    k_loc = klocal(29500, 29500, 0.3, 0.3, 11346, 0.1, 100, ep[0,1], 'S-S', m_a)
    kg_loc = kglocal(100, ep[0,1], 50, 50, 'S-S', m_a)
    k_glob, kg_glob = trans(ep[0,2], k_loc, kg_loc, m_a)

    K, Kg = assemble(K, Kg, k_glob, kg_glob, int(elem[0,1]), int(elem[0,2]), nnodes, m_a)

    assert K.shape == (ndof, ndof)
    assert K.nnz > 0, "K should have non-zero entries after assembly"


def test_stripmain_basic():
    """기본 좌굴 해석 실행"""
    prop, node, elem = _default_model()
    lengths = np.array([10.0, 100.0])
    m_all = [np.array([1.0]), np.array([1.0])]
    result = stripmain(prop, node, elem, lengths, np.array([]), np.array([]),
                       GBTConfig(), 'S-S', m_all, neigs=5)
    assert len(result.curve) == 2
    for c in result.curve:
        assert c[0, 0] > 0, "Length should be positive"
        assert c[0, 1] > 0, "Load factor should be positive"
    print(f"  L=10: LF={result.curve[0][0,1]:.4f}, L=100: LF={result.curve[1][0,1]:.4f}")


def test_stripmain_all_bc():
    """5종 BC 모두 해석 가능"""
    prop, node, elem = _default_model()
    lengths = np.array([50.0])
    m_all = [np.array([1.0])]
    for bc in ['S-S', 'C-C', 'S-C', 'C-F', 'C-G']:
        result = stripmain(prop, node, elem, lengths, np.array([]), np.array([]),
                           GBTConfig(), bc, m_all, neigs=3)
        lf = result.curve[0][0, 1]
        assert lf > 0, f"BC={bc}: LF={lf} should be > 0"
        print(f"  BC={bc}: LF={lf:.4f}")


def test_stresgen():
    """응력 분포 생성"""
    _, node, elem = _default_model()
    props = grosprop(node, elem)
    node_out = stresgen(node, P=100, Mxx=0, Mzz=0, M11=0, M22=0,
                        A=props['A'], xcg=props['xcg'], zcg=props['zcg'],
                        Ixx=props['Ixx'], Izz=props['Izz'], Ixz=props['Ixz'],
                        thetap=props['thetap'], I11=props['I11'], I22=props['I22'])
    # 순수 축력 → 모든 절점 동일 응력
    stresses = node_out[:, 7]
    expected = 100 / props['A']
    assert np.allclose(stresses, expected, atol=0.01), f"stresses={stresses}, expected={expected}"
    print(f"  Pure P=100: stress={stresses[0]:.4f} (expected {expected:.4f})")


def test_yieldMP():
    """항복 하중 계산"""
    _, node, elem = _default_model()
    props = grosprop(node, elem)
    ymp = yieldMP(node, 50.0, props['A'], props['xcg'], props['zcg'],
                  props['Ixx'], props['Izz'], props['Ixz'],
                  props['thetap'], props['I11'], props['I22'])
    assert ymp['Py'] > 0
    assert ymp['Mxx_y'] > 0 or ymp['Mxx_y'] == 0
    print(f"  Py={ymp['Py']:.2f}, Mxx_y={ymp['Mxx_y']:.2f}, Mzz_y={ymp['Mzz_y']:.2f}")


def test_template_all_types():
    """8종 템플릿 모두 생성 가능"""
    types = ['lippedc', 'lippedz', 'hat', 'rhs', 'chs', 'angle', 'isect', 'tee']
    for t in types:
        params = {'H': 6, 'B': 4, 'D': 1, 't': 0.1}
        if t == 'chs':
            params = {'D': 6, 't': 0.1, 'n_elem': 12}
        result = generate_section(t, params)
        assert result['node'].shape[0] > 0, f"{t}: no nodes"
        assert result['elem'].shape[0] > 0, f"{t}: no elements"
        print(f"  {t}: {result['node'].shape[0]} nodes, {result['elem'].shape[0]} elems")


if __name__ == '__main__':
    tests = [
        test_grosprop, test_elemprop, test_trans, test_assembly,
        test_stripmain_basic, test_stripmain_all_bc,
        test_stresgen, test_yieldMP, test_template_all_types,
    ]
    passed = 0
    failed = 0
    for t in tests:
        name = t.__name__
        try:
            print(f"[RUN] {name}")
            t()
            print(f"[PASS] {name}")
            passed += 1
        except Exception as e:
            print(f"[FAIL] {name}: {e}")
            failed += 1
    print(f"\n{'='*50}")
    print(f"Results: {passed} passed, {failed} failed, {passed+failed} total")
