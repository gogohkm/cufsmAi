"""2026-11-22 엔진 리뷰 R5 (dsm.py · shear.py · steel_grades.py) 회귀 시험.

기대값은 코드가 낸 값을 베끼지 않는다: AISI S100-16 원문 표(Tables G5-1 … G5-5)를
이 파일에 따로 옮겨 Eq. G5-1 을 시험 안에서 계산하고, 매뉴얼 예제 인쇄값
(Example II-1A 전단·웹 크리플링, II-1B·III-3 DSM 비), 합성 곡선의 닫힌 값을 쓴다.
FSM 을 돌리는 시험은 격자를 줄여 몇 초 안에 끝나게 했다.
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'python'))

import numpy as np

from engine.dsm import extract_dsm_values
from engine.template import generate_section

PROP = np.array([[100, 29500, 29500, 0.3, 0.3, 11300]])


# ----------------------------------------------------------------- helpers
def _section(fy=50.0):
    sec = generate_section('lippedc', {'H': 8.0, 'B': 2.5, 'D': 0.625, 't': 0.06, 'r': 0.15})
    node, elem = sec['node'], sec['elem']
    node[:, 7] = fy
    return node, elem


L50 = np.logspace(0, 3, 50)


def _curve(f, lengths=L50):
    return [np.array([[length, f(length)]]) for length in lengths]


def _branch(Lh, lfmin, p=2.0):
    return lambda length: lfmin * 0.5 * ((length / Lh) ** p + (Lh / length) ** p)


def _glob(lfac):
    return lambda length: lfac * (100.0 / length) ** 2


def _sig(*branches):
    return lambda length: min(b(length) for b in branches)


def _cls(f_lab, lengths=L50):
    return [[f_lab(length)] for length in lengths]


def _fsm(sec_type, params, fy, case, lengths, classify_modes=False, stress=None):
    from cfsm.classify import classify
    from engine.fsm_solver import stripmain
    from engine.properties import grosprop
    from engine.stress import stresgen
    from models.data import GBTConfig

    sec = generate_section(sec_type, params)
    node, elem = sec['node'], sec['elem']
    if case == 'P':
        node[:, 7] = fy if stress is None else stress
    else:
        p = grosprop(node, elem)
        node = stresgen(node, 0, 1.0, 0, 0, 0, p['A'], p['xcg'], p['zcg'], p['Ixx'], p['Izz'],
                        p['Ixz'], p['thetap'], p['I11'], p['I22'], unsymm=0)
        node[:, 7] *= fy / np.max(np.abs(node[:, 7]))
    m_all = [np.array([1.0]) for _ in lengths]
    res = stripmain(PROP, node, elem, lengths, np.array([]), np.array([]), GBTConfig(),
                    'S-S', m_all, neigs=4)
    clas = None
    if classify_modes:
        clas = [np.asarray(c).tolist() for c in
                classify(PROP, node, elem, lengths, res.shapes, GBTConfig(), 'S-S', m_all)]
    return node, elem, res, clas


def _assert_no_absence(r):
    assert r['local_absence_verified'] is False and r['dist_absence_verified'] is False
    if not (r['local_basis'] == 'cfsm_label' and r['dist_basis'] == 'cfsm_label'):
        assert not str(r['classification_method']).startswith('cfsm_modal'), r['classification_method']


# ====================================================== dsm.py — R5-01 … R5-07
def test_R5_01_single_D_labelled_minimum_does_not_verify_local_absence():
    """R5-01/V2-04: 단일 극소가 D 로 분류되면 뒤틀림만 분리 — 국부는 부재 확정도, 그 값도 아니고 하한(floor)."""
    node, elem = _section()
    curve = [[[1.0, 2.0]], [[5.0, 1.0]], [[10.0, 2.0]]]
    clas = [[[0.0, 10.0, 90.0, 0.0]], [[0.0, 98.0, 2.0, 0.0]], [[0.0, 20.0, 80.0, 0.0]]]
    r = extract_dsm_values(curve, node, elem, 50.0, 'P', mode_classifications=clas)
    Py = 50.0 * r['A']
    _assert_no_absence(r)
    assert not r['classification_method'].startswith('cfsm_modal')
    assert r['dist_detected'] is True and abs(r['Pcrd'] - 1.0 * Py) < 1e-9 * Py
    # 서명곡선은 순수모드 곡선의 아래 포락선 → 단일 극소 값은 국부 임계값의 하한일 뿐 (값으로 쓰지 않음)
    assert r['local_detected'] is False and r['Pcrl'] == 0.0 and r['local_basis'] == 'not_isolated'
    assert abs(r['crl_floor'] - 1.0 * Py) < 1e-9 * Py and r['crd_floor'] is None
    assert r['single_minimum'] is True and 'floor' in r['single_minimum_bound_meaning']


def test_R5_01_rounded_9cs_compression_keeps_local_reduction():
    """R5-01/R3-01: 9CS2.5x059(r=0.1875) 압축 — 분류가 NaN 이든 옛 D 라벨이든 국부 감소가 남는다.

    리뷰어 측정: 옛 cFSM 경로 Pn(KL=144) 8.58 kips, 단일 극소를 국부에 쓴 처리 6.49 kips;
    V2 독립 계산 6.47 kips. 기준: NaN 경로 6.47 ±3 %(양쪽), 옛 D 라벨 경로(국부는 해석식 대체,
    V2 측정 5.87) 5.2 – 6.6 kips.
    """
    from design.aisi_s100 import design_member
    p = {'H': 9.0, 'B': 2.5, 'D': 0.773, 't': 0.059, 'r': 0.1875}
    node, elem, res, clas = _fsm('lippedc', p, 55.0, 'P', L50, classify_modes=True)
    r_now = extract_dsm_values(res.curve, node, elem, 55.0, 'P', mode_classifications=clas)
    # 옛 cFSM(둥근 모서리 국부 극소를 D 94 % 로 분류)을 흉내 — 이 쪽 수정만으로 닫혀야 한다
    mn = r_now['minima'][0]
    old = [list(c) for c in clas]
    old[mn['curve_index']] = [[0.0, 94.4, 5.3, 0.2]]
    r_old = extract_dsm_values(res.curve, node, elem, 55.0, 'P', mode_classifications=old)
    base = {'member_type': 'compression', 'design_method': 'LRFD', 'section_type': 'lippedc',
            'H': 9.0, 'B': 2.5, 'D': 0.773, 't': 0.059, 'r': 0.1875, 'Fy': 55.0, 'Fu': 70.0,
            'Pu': 1.0, 'KxLx': 144.0, 'KyLy': 144.0, 'KtLt': 144.0}
    for r, lo, hi in ((r_now, 6.47 * 0.97, 6.47 * 1.03), (r_old, 5.2, 6.6)):
        assert r['n_minima'] == 1 and r['single_minimum'] is True
        _assert_no_absence(r)
        # 단일 극소 LF 0.125 (리뷰어 50점 격자 측정 0.125, 400점 0.124)
        assert abs(r['LF_single_minimum'] - 0.125) < 0.003
        dsm = {'Pcrl': r['crl'], 'Pcrd': r['crd'], 'Py': r['P_y'],
               'P_classification_method': r['classification_method'],
               'P_local_detected': r['local_detected'], 'P_dist_detected': r['dist_detected']}
        out = design_member({**base, 'dsm': dsm})
        assert lo <= out['Pn'] <= hi, out['Pn']
    # NaN 분류(F3) 경로: 국부 = 극소, 뒤틀림은 미분리 + 하한. 예정된 상황이므로 warnings 는 비어 있다.
    assert r_now['local_detected'] is True and abs(r_now['LF_local'] - 0.125) < 0.003
    assert r_now['Pcrd'] == 0.0 and abs(r_now['crd_floor'] - r_now['Pcrl']) < 1e-9
    assert r_now['warnings'] == [] and r_now['assumptions'], r_now['warnings']
    # 옛 D 라벨 경로: 뒤틀림 = 극소, 국부는 미분리 + 하한
    assert r_old['Pcrl'] == 0.0 and abs(r_old['crl_floor'] - r_old['Pcrd']) < 1e-9


def test_R5_02_g_dominant_distortional_minimum_is_not_discarded():
    """R5-02: G50/D45 로 분류된 장파장 극소를 버리지 않고 반파장 순서로 뒤틀림에 쓴다."""
    node, elem = _section()
    f = _sig(_branch(4, 0.7), _branch(30, 0.6), _glob(2))
    clas = _cls(lambda L: [5, 5, 90, 0] if L < 12 else [50, 45, 5, 0])
    r = extract_dsm_values(_curve(f), node, elem, 50, 'P', mode_classifications=clas)
    assert r['dist_detected'] is True and abs(r['LF_dist'] - 0.60) < 0.01
    assert r['local_basis'] == 'cfsm_label' and r['dist_basis'] == 'wavelength_order'
    _assert_no_absence(r)


def test_R5_03_node_stress_scale_is_reconciled_with_fy():
    """R5-03: 절점 응력 1 ksi 로 만든 곡선(LF 는 50 배)도 fy=50 기준과 같은 Pcr 을 낸다."""
    node50, elem = _section(50.0)
    node1, _ = _section(1.0)
    f = _sig(_branch(4, 0.7), _branch(20, 0.9), _glob(3))
    r50 = extract_dsm_values(_curve(f), node50, elem, 50, 'P')
    r1 = extract_dsm_values(_curve(lambda L: 50.0 * f(L)), node1, elem, 50, 'P')
    assert abs(r1['Pcrl'] / r50['Pcrl'] - 1) < 1e-9 and abs(r1['Pcrd'] / r50['Pcrd'] - 1) < 1e-9
    assert abs(r1['stress_scale'] - 1 / 50) < 1e-12
    assert any('σmax/fy' in w for w in r1['assumptions']) and not r1['warnings']   # 환산은 가정(§3.1.1)


def test_R5_03_real_fsm_with_unit_stress_matches_fy_stress():
    """R5-03: 9CS2.5x059 압축을 1 ksi 와 55 ksi 로 각각 FSM — 추출한 Pcrl 이 같아야 한다."""
    p = {'H': 9.0, 'B': 2.5, 'D': 0.773, 't': 0.059, 'r': 0.1875}
    L = np.logspace(0, 2, 20)
    n55, elem, res55, _ = _fsm('lippedc', p, 55.0, 'P', L)
    n1, _, res1, _ = _fsm('lippedc', p, 55.0, 'P', L, stress=1.0)
    r55 = extract_dsm_values(res55.curve, n55, elem, 55.0, 'P')
    r1 = extract_dsm_values(res1.curve, n1, elem, 55.0, 'P')
    assert abs(r1['Pcrl'] / r55['Pcrl'] - 1) < 1e-6


def test_R5_03_unrestrained_z_bending_uses_matching_first_yield():
    """R5-03: Z 에 비구속 휨(unsymm=1) 응력을 넣으면 P_ref 는 그 분포의 첫 항복 모멘트다.

    Mxx=M 을 비구속으로 걸면 최대 |σ|=s. 하중계수 LF 의 임계 모멘트는 LF·M 이어야 하고
    (응력 상태가 그 모멘트에서 정의되므로), 같은 분포의 첫 항복 모멘트는 M·fy/s.
    """
    from engine.properties import grosprop
    from engine.stress import stresgen
    sec = generate_section('lippedz', {'H': 8.0, 'B': 2.25, 'D': 0.91, 't': 0.059, 'r': 0.1875,
                                       'qlip': 50.0})
    node, elem = sec['node'], sec['elem']
    p = grosprop(node, elem)
    M = 106.75
    node = stresgen(node, 0, M, 0, 0, 0, p['A'], p['xcg'], p['zcg'], p['Ixx'], p['Izz'],
                    p['Ixz'], p['thetap'], p['I11'], p['I22'], unsymm=1)
    s = float(np.max(np.abs(node[:, 7])))
    f = _sig(_branch(4, 0.8), _branch(22, 0.7), _glob(3))
    r = extract_dsm_values(_curve(f), node, elem, 55.0, 'Mxx')
    lf_l = r['minima'][0]['load_factor']
    assert r['reference_unsymm'] == 1 and r['reference_stress_consistent'] is True
    assert abs(r['Mxxcrl'] - lf_l * M) < 1e-6 * M
    assert abs(r['P_y'] - M * 55.0 / s) < 1e-6 * M
    # V2-11: 소비자가 구속 My(Sf·Fy)와 섞지 않도록 — 비구속 기준임과 구속 첫 항복값을 함께 낸다
    s0 = stresgen(node, 0, 1.0, 0, 0, 0, p['A'], p['xcg'], p['zcg'], p['Ixx'], p['Izz'],
                  p['Ixz'], p['thetap'], p['I11'], p['I22'], unsymm=0)[:, 7]
    assert r['reference_is_restrained'] is False
    assert abs(r['P_ref_restrained'] - 55.0 / np.max(np.abs(s0))) < 1e-6 * M


def test_R5_03_shape_mismatch_is_flagged():
    """R5-03: 휨 추출에 균일 압축 응력을 넣으면 일관성 False 와 경고."""
    node, elem = _section()
    f = _sig(_branch(4, 0.7), _branch(20, 0.9), _glob(3))
    r = extract_dsm_values(_curve(f), node, elem, 50, 'Mxx')
    assert r['reference_stress_consistent'] is False and r['reference_distribution'] == 'unmatched'
    assert r['warnings']


def test_R5_04_single_minimum_flag_and_bound():
    """R5-04: 단일 극소(휴리스틱) — single_minimum 과 LF 를 돌려준다."""
    node, elem = _section()
    f = _sig(_branch(20, 0.5), _glob(3.0))
    r = extract_dsm_values(_curve(f), node, elem, 50, 'P')
    expected = min(f(L) for L in L50 if L < 60)       # 표본 최소(장파장 꼬리 앞)
    assert r['single_minimum'] is True and abs(r['LF_single_minimum'] - expected) < 1e-12
    assert abs(r['single_minimum_bound'] - expected * r['P_ref']) < 1e-9 * r['P_ref']
    assert r['dist_detected'] is False and r['Pcrd'] == 0.0
    _assert_no_absence(r)


def test_R5_05_boundary_minimum_is_flagged():
    """R5-05: 실제 국부 최소(0.6 in)가 격자 하한(1 in) 아래 — 경계 극소 플래그와 경고."""
    node, elem = _section()
    f = _sig(_branch(0.6, 0.8), _branch(15, 1.2), _glob(3))
    r = extract_dsm_values(_curve(f), node, elem, 50, 'P')
    assert r['boundary_minimum'] is True and r['local_isolated'] is False
    assert any('격자의 첫 길이' in w for w in r['warnings'])


def test_R5_05_interpolated_minimum_never_exceeds_sampled():
    """R5-05: log L 포물선 보간 극소 ≤ 표본 극소. log L 에 대한 포물선 곡선에서는 꼭짓점을 정확히 낸다."""
    node, elem = _section()
    rng = np.random.default_rng(5)
    for _ in range(40):
        Lh1, Lh2 = rng.uniform(1.5, 6.0), rng.uniform(10.0, 60.0)
        f = _sig(_branch(Lh1, rng.uniform(0.2, 2.0), rng.uniform(1.0, 3.0)),
                 _branch(Lh2, rng.uniform(0.2, 2.0), rng.uniform(1.0, 3.0)), _glob(rng.uniform(1, 9)))
        lengths = np.logspace(0, 3, int(rng.integers(12, 60)))
        r = extract_dsm_values(_curve(f, lengths), node, elem, 50, 'P')
        for mn in r['minima']:
            assert mn['load_factor_interp'] <= mn['load_factor'] + 1e-15
    # 닫힌 값: LF = 0.5 + (ln L − ln 4)² → 꼭짓점 0.5 @ 4 in
    lengths = np.logspace(0, 2, 15)
    r = extract_dsm_values(_curve(lambda L: 0.5 + (math.log(L) - math.log(4.0)) ** 2 if L < 30 else 9.0,
                                  lengths), node, elem, 50, 'P')
    assert abs(r['LF_local_interp'] - 0.5) < 1e-9


def test_R5_06_no_minimum_same_result_on_both_paths():
    """R5-06: 단조감소 곡선 — 휴리스틱·cFSM 경로 모두 no_minimum, 국부 검출 아님."""
    node, elem = _section()
    c = _curve(_glob(1.0))
    r_h = extract_dsm_values(c, node, elem, 50, 'P')
    r_c = extract_dsm_values(c, node, elem, 50, 'P', mode_classifications=_cls(lambda L: [90, 5, 5, 0]))
    for r in (r_h, r_c):
        assert r['classification'] == 'no_minimum'
        assert r['local_detected'] is False and r['dist_detected'] is False
        assert r['Pcrl'] == 0.0 and r['Pcrd'] == 0.0
        _assert_no_absence(r)


def test_R5_07_empty_result_keys_load_type_and_bc():
    """R5-07: 3점 미만도 같은 키 집합, load_type 검증, S-S 가 아닌 곡선은 극소를 뽑지 않음."""
    node, elem = _section()
    full = extract_dsm_values(_curve(_sig(_branch(4, 0.7), _branch(20, 0.9), _glob(3))), node, elem, 50, 'P')
    short = extract_dsm_values([np.array([[1, 1.0]]), np.array([[2, 0.5]])], node, elem, 50, 'P')
    assert set(full) == set(short) and short['classification'] == 'insufficient_points'
    try:
        extract_dsm_values(_curve(_glob(1.0)), node, elem, 50, 'M11')
    except ValueError:
        pass
    else:
        raise AssertionError('load_type M11 must be rejected')
    cc = extract_dsm_values(_curve(_sig(_branch(7, 0.97), _branch(39, 1.42), _glob(3))), node, elem, 50,
                            'P', BC='C-C')
    assert cc['signature_curve'] is False and cc['classification'] == 'not_signature_curve'
    assert cc['Pcrl'] == 0.0 and cc['Pcrd'] == 0.0 and cc['warnings']
    assert full['signature_curve'] is None
    ss = extract_dsm_values(_curve(_sig(_branch(4, 0.7), _branch(20, 0.9), _glob(3))), node, elem, 50,
                            'P', BC='S-S')
    assert ss['signature_curve'] is True and ss['Pcrl'] == full['Pcrl']


def test_R5_curve_shape_behaviour_table():
    """R5-01/02/04/05/06: 리뷰어가 시험한 곡선 모양마다 반환값과 플래그 (보수 또는 명시 플래그)."""
    node, elem = _section()
    two = _sig(_branch(4, 0.7), _branch(20, 0.9), _glob(3.0))
    def L_D_G(L):
        return [5, 5, 90, 0] if L < 9 else ([5, 90, 5, 0] if L < 60 else [90, 5, 5, 0])

    cases = [
        # (이름, 곡선, 분류, 기대: classification, method, LFl, LFd)
        ('two minima heuristic', two, None, 'two_minima', 'heuristic', 0.70, 0.90),
        ('two minima labelled L/D', two, _cls(L_D_G), 'cfsm_modal', 'cfsm_modal', 0.70, 0.90),
        ('third long minimum lower (heuristic)', _sig(_branch(4, 0.7), _branch(20, 0.9),
                                                       _branch(150, 0.5), _glob(3.0)),
         None, 'two_minima', 'heuristic', 0.70, 0.50),
        ('third minimum labelled G ignored', _sig(_branch(4, 0.7), _branch(20, 0.9),
                                                   _branch(150, 0.5), _glob(3.0)),
         _cls(L_D_G), 'cfsm_modal', 'cfsm_modal', 0.70, 0.90),
        # V2-08/V2-15: 두 극소가 모두 L 라벨이면 국부 = 더 낮은 L(하한), 그보다 긴 극소가 없어 뒤틀림 미분리
        ('both labelled L → lower L is local', _sig(_branch(4, 0.7), _branch(30, 0.6), _glob(2)),
         _cls(lambda L: [5, 5, 90, 0] if L < 12 else [5, 40, 55, 0]),
         'cfsm_ordering_tiebreak', 'heuristic', 0.60, 0.0),
        ('labels contradict wavelength order', two,
         _cls(lambda L: [5, 90, 5, 0] if L < 9 else [5, 5, 90, 0]),
         'cfsm_ordering_tiebreak', 'heuristic', 0.70, 0.90),
        ('NaN classification rows', two, _cls(lambda L: [float('nan')] * 4),
         'cfsm_ordering_tiebreak', 'heuristic', 0.70, 0.90),
        ('two close minima merge into one', lambda L: min(_branch(4.0, 0.60, 3)(L),
                                                          _branch(5.0, 0.58, 3)(L), _glob(30)(L)),
         None, 'single_minimum', 'heuristic', 0.58, 0.0),
        ('single minimum labelled D', _sig(_branch(20, 0.5), _glob(3.0)),
         _cls(lambda L: [5, 90, 5, 0]), 'single_minimum', 'cfsm_partial', 0.0, 0.50),
        ('single minimum labelled L', _sig(_branch(4, 0.4), _glob(30.0)),
         _cls(lambda L: [5, 10, 85, 0]), 'single_minimum', 'cfsm_partial', 0.40, 0.0),
        ('minimum at last length not used', two,
         None, 'two_minima', 'heuristic', 0.70, 0.90),
    ]
    for name, f, clas, cls_exp, meth_exp, lfl, lfd in cases:
        r = extract_dsm_values(_curve(f), node, elem, 50, 'P', mode_classifications=clas)
        assert r['classification'] == cls_exp, (name, r['classification'])
        assert r['classification_method'] == meth_exp, (name, r['classification_method'])
        assert abs(r['LF_local'] - lfl) < 0.012, (name, r['LF_local'])
        assert abs(r['LF_dist'] - lfd) < 0.012, (name, r['LF_dist'])
        _assert_no_absence(r)


def test_R5_manual_dsm_ratios_through_real_fsm():
    """매뉴얼 DSM 비: 9CS2.5x059 휨 Mcrl/My 0.67·Mcrd/My 0.85 (Ex. II-1B),
    362S162-54 압축 Pcrl/Py 0.75·Pcrd/Py 1.11 (Ex. III-3). 인쇄값 2자리 → 허용 ±0.015."""
    L = np.logspace(0, 2, 25)
    n, e, res, _ = _fsm('lippedc', {'H': 9.0, 'B': 2.5, 'D': 0.773, 't': 0.059, 'r': 0.1875}, 55.0, 'Mxx', L)
    r = extract_dsm_values(res.curve, n, e, 55.0, 'Mxx')
    assert abs(r['LF_local'] - 0.67) < 0.015 and abs(r['LF_dist'] - 0.85) < 0.015, (r['LF_local'], r['LF_dist'])
    n, e, res, _ = _fsm('lippedc', {'H': 3.625, 'B': 1.625, 'D': 0.5, 't': 0.0566, 'r': 0.0849}, 50.0, 'P', L)
    r = extract_dsm_values(res.curve, n, e, 50.0, 'P')
    assert abs(r['LF_local'] - 0.75) < 0.015 and abs(r['LF_dist'] - 1.11) < 0.015, (r['LF_local'], r['LF_dist'])


# ====================================================== shear.py — G2
def test_R5_16_example_II_1A_shear_strength():
    """Example II-1A: 9CS2.5x059 h=8.507 → Vn=Vcr=3.44 kips; 9CS2.5x070 h=8.485 → 5.76 kips (Fy 55)."""
    from design.shear import shear_strength
    r = shear_strength(8.507, 0.059, 55.0)
    assert abs(r['Vn'] - 3.44) < 0.01 and r['equation'] == 'G2.1 (elastic)'
    assert abs(r['Vy'] - 16.6) < 0.05
    r = shear_strength(8.485, 0.070, 55.0)
    assert abs(r['Vn'] - 5.76) < 0.01


def test_R5_16_unimplemented_chapter_g_provisions_are_visible():
    """R5-16: G3(구멍)·G6(구멍 크리플링) 은 오류, G2.2 는 경고, 범위는 assumptions 에 남는다."""
    from design.shear import shear_strength, web_crippling
    r = shear_strength(8.5, 0.059, 55.0)
    assert any('§G3' in a for a in r['scope_notes'])      # FIXES §3.1.1: 늘 참인 범위는 scope_notes
    assert 'error' in shear_strength(8.5, 0.059, 55.0, web_holes=True)
    assert shear_strength(8.5, 0.059, 55.0, kv=10.0)['warnings']
    wc = web_crippling(8.485, 0.070, 0.1875, 5.0, 55.0)
    assert any('§G6' in a for a in wc['scope_notes']) and not wc['warnings']
    holes = web_crippling(8.485, 0.070, 0.1875, 5.0, 55.0, web_holes=True)
    assert 'error' in holes and holes['Pn'] is None


# ====================================================== shear.py — G5
# AISI S100-16 Tables G5-1 … G5-5 (skill data/specification/Chapter_G_Shear.md L240-375)
# (family, fastened, flange, support): (C, CR, CN, Ch, Ω, φ, φLSD, R/t limit)
SPEC_G5 = {
    ('built_up_i', 'fastened', 'stiffened', 'EOF'): (10, 0.14, 0.28, 0.001, 2.00, 0.75, 0.60, 5),
    ('built_up_i', 'fastened', 'stiffened', 'IOF'): (20.5, 0.17, 0.11, 0.001, 1.75, 0.85, 0.75, 5),
    ('built_up_i', 'unfastened', 'stiffened', 'EOF'): (10, 0.14, 0.28, 0.001, 2.00, 0.75, 0.60, 5),
    ('built_up_i', 'unfastened', 'stiffened', 'IOF'): (20.5, 0.17, 0.11, 0.001, 1.75, 0.85, 0.75, 3),
    ('built_up_i', 'unfastened', 'stiffened', 'ETF'): (15.5, 0.09, 0.08, 0.04, 2.00, 0.75, 0.65, 3),
    ('built_up_i', 'unfastened', 'stiffened', 'ITF'): (36, 0.14, 0.08, 0.04, 2.00, 0.75, 0.65, 3),
    ('built_up_i', 'unfastened', 'unstiffened', 'EOF'): (10, 0.14, 0.28, 0.001, 2.00, 0.75, 0.60, 5),
    ('built_up_i', 'unfastened', 'unstiffened', 'IOF'): (20.5, 0.17, 0.11, 0.001, 1.75, 0.85, 0.75, 3),
    ('c', 'fastened', 'stiffened', 'EOF'): (4, 0.14, 0.35, 0.02, 1.75, 0.85, 0.75, 9),
    ('c', 'fastened', 'stiffened', 'IOF'): (13, 0.23, 0.14, 0.01, 1.65, 0.90, 0.80, 5),
    ('c', 'fastened', 'stiffened', 'ETF'): (7.5, 0.08, 0.12, 0.048, 1.75, 0.85, 0.75, 12),
    ('c', 'fastened', 'stiffened', 'ITF'): (20, 0.10, 0.08, 0.031, 1.75, 0.85, 0.75, 12),
    ('c', 'unfastened', 'stiffened', 'EOF'): (4, 0.14, 0.35, 0.02, 1.85, 0.80, 0.70, 5),
    ('c', 'unfastened', 'stiffened', 'IOF'): (13, 0.23, 0.14, 0.01, 1.65, 0.90, 0.80, 5),
    ('c', 'unfastened', 'stiffened', 'ETF'): (13, 0.32, 0.05, 0.04, 1.65, 0.90, 0.80, 3),
    ('c', 'unfastened', 'stiffened', 'ITF'): (24, 0.52, 0.15, 0.001, 1.90, 0.80, 0.65, 3),
    ('c', 'unfastened', 'unstiffened', 'EOF'): (4, 0.40, 0.60, 0.03, 1.80, 0.85, 0.70, 2),
    ('c', 'unfastened', 'unstiffened', 'IOF'): (13, 0.32, 0.10, 0.01, 1.80, 0.85, 0.70, 1),
    ('c', 'unfastened', 'unstiffened', 'ETF'): (2, 0.11, 0.37, 0.01, 2.00, 0.75, 0.65, 1),
    ('c', 'unfastened', 'unstiffened', 'ITF'): (13, 0.47, 0.25, 0.04, 1.90, 0.80, 0.65, 1),
    ('z', 'fastened', 'stiffened', 'EOF'): (4, 0.14, 0.35, 0.02, 1.75, 0.85, 0.75, 9),
    ('z', 'fastened', 'stiffened', 'IOF'): (13, 0.23, 0.14, 0.01, 1.65, 0.90, 0.80, 5.5),
    ('z', 'fastened', 'stiffened', 'ETF'): (9, 0.05, 0.16, 0.052, 1.75, 0.85, 0.75, 12),
    ('z', 'fastened', 'stiffened', 'ITF'): (24, 0.07, 0.07, 0.04, 1.85, 0.80, 0.70, 12),
    ('z', 'unfastened', 'stiffened', 'EOF'): (5, 0.09, 0.02, 0.001, 1.80, 0.85, 0.75, 5),
    ('z', 'unfastened', 'stiffened', 'IOF'): (13, 0.23, 0.14, 0.01, 1.65, 0.90, 0.80, 5),
    ('z', 'unfastened', 'stiffened', 'ETF'): (13, 0.32, 0.05, 0.04, 1.65, 0.90, 0.80, 3),
    ('z', 'unfastened', 'stiffened', 'ITF'): (24, 0.52, 0.15, 0.001, 1.90, 0.80, 0.65, 3),
    ('z', 'unfastened', 'unstiffened', 'EOF'): (4, 0.40, 0.60, 0.03, 1.80, 0.85, 0.70, 2),
    ('z', 'unfastened', 'unstiffened', 'IOF'): (13, 0.32, 0.10, 0.01, 1.80, 0.85, 0.70, 1),
    ('z', 'unfastened', 'unstiffened', 'ETF'): (2, 0.11, 0.37, 0.01, 2.00, 0.75, 0.65, 1),
    ('z', 'unfastened', 'unstiffened', 'ITF'): (13, 0.47, 0.25, 0.04, 1.90, 0.80, 0.65, 1),
    ('hat', 'fastened', None, 'EOF'): (4, 0.25, 0.68, 0.04, 2.00, 0.75, 0.65, 5),
    ('hat', 'fastened', None, 'IOF'): (17, 0.13, 0.13, 0.04, 1.80, 0.85, 0.70, 10),
    ('hat', 'fastened', None, 'ETF'): (9, 0.10, 0.07, 0.03, 1.75, 0.85, 0.75, 10),
    ('hat', 'fastened', None, 'ITF'): (10, 0.14, 0.22, 0.02, 1.80, 0.85, 0.75, 10),
    ('hat', 'unfastened', None, 'EOF'): (4, 0.25, 0.68, 0.04, 2.00, 0.75, 0.65, 5),
    ('hat', 'unfastened', None, 'IOF'): (17, 0.13, 0.13, 0.04, 1.80, 0.85, 0.70, 10),
    ('multi_web', 'fastened', None, 'EOF'): (4, 0.04, 0.25, 0.025, 1.70, 0.90, 0.80, 20),
    ('multi_web', 'fastened', None, 'IOF'): (8, 0.10, 0.17, 0.004, 1.75, 0.85, 0.75, 20),
    ('multi_web', 'fastened', None, 'ETF'): (9, 0.12, 0.14, 0.040, 1.80, 0.85, 0.70, 10),
    ('multi_web', 'fastened', None, 'ITF'): (10, 0.11, 0.21, 0.020, 1.75, 0.85, 0.75, 10),
    ('multi_web', 'unfastened', None, 'EOF'): (3, 0.04, 0.29, 0.028, 2.45, 0.60, 0.50, 20),
    ('multi_web', 'unfastened', None, 'IOF'): (8, 0.10, 0.17, 0.004, 1.75, 0.85, 0.75, 20),
    ('multi_web', 'unfastened', None, 'ETF'): (6, 0.16, 0.15, 0.050, 1.65, 0.90, 0.80, 5),
    ('multi_web', 'unfastened', None, 'ITF'): (17, 0.10, 0.10, 0.046, 1.65, 0.90, 0.80, 5),
}
# 표별 한계: (h/t, N/t, N/h)
SPEC_G5_LIMITS = {'built_up_i': (200, 210, 1.0), 'c': (200, 210, 2.0), 'z': (200, 210, 2.0),
                  'hat': (200, 200, 2.0), 'multi_web': (200, 210, 3.0)}
_FAMILY_ARG = {'built_up_i': 'built_up_i', 'c': 'C', 'z': 'Z', 'hat': 'hat', 'multi_web': 'multi_web'}
_TABLE = {'built_up_i': 'G5-1', 'c': 'G5-2', 'z': 'G5-3', 'hat': 'G5-4', 'multi_web': 'G5-5'}


def _eq_g51(C, CR, CN, Ch, t, Fy, R, N, h, theta=90.0):
    return (C * t ** 2 * Fy * math.sin(math.radians(theta)) * (1 - CR * math.sqrt(R / t))
            * (1 + CN * math.sqrt(N / t)) * (1 - Ch * math.sqrt(h / t)))


def _wc(fam, fas, flange, sup, **kw):
    from design.shear import web_crippling
    args = dict(h=6.0, t=0.06, R=0.05, N=3.0, Fy=50.0, support=sup, fastened=fas,
                section_family=_FAMILY_ARG[fam], flange_condition=flange, n_webs=1)
    args.update(kw)
    return web_crippling(**args)


def test_R5_G5_every_specification_row_and_only_those():
    """Tables G5-1 … G5-5: 원문 46 행 전부의 계수·Ω·φ·φLSD·R/t 한계, 원문에 없는 조합은 모두 오류."""
    from design.shear import classify_web_crippling_case
    t, h, N, Fy = 0.06, 6.0, 3.0, 50.0
    for (fam, fas, flange, sup), (C, CR, CN, Ch, om, phi, phil, rt) in SPEC_G5.items():
        R = 0.9 * rt * t
        r = _wc(fam, fas, flange, sup, R=R)
        assert 'error' not in r, ((fam, fas, flange, sup), r.get('error'))
        assert r['table'] == _TABLE[fam]
        exp = _eq_g51(C, CR, CN, Ch, t, Fy, R, N, h)
        assert abs(r['Pn_per_web'] - exp) < 1.5e-3, ((fam, fas, flange, sup), r['Pn_per_web'], exp)
        assert r['omega'] == om and r['phi'] == phi
        case = classify_web_crippling_case(h, t, R, N, support=sup, fastened=fas,
                                           section_family=_FAMILY_ARG[fam], flange_condition=flange)
        assert case['row']['lsd_phi'] == phil
        # R/t 한계: 바로 위는 범위 밖(오류), 바로 아래는 범위 안
        over = _wc(fam, fas, flange, sup, R=1.05 * rt * t)
        assert 'error' in over and over['within_limits'] is False, (fam, fas, flange, sup)
    for fam in SPEC_G5_LIMITS:
        flanges = (None,) if fam in ('hat', 'multi_web') else ('stiffened', 'unstiffened')
        for fas in ('fastened', 'unfastened'):
            for flange in flanges:
                for sup in ('EOF', 'IOF', 'ETF', 'ITF'):
                    if (fam, fas, flange, sup) in SPEC_G5:
                        continue
                    r = _wc(fam, fas, flange, sup, R=0.03)
                    sub = ('built_up_i', 'c', 'z')
                    if fam in sub and fas == 'fastened' and flange == 'unstiffened' and sup in ('EOF', 'IOF'):
                        # V2-07: 1-플랜지 체결-무보강은 무체결-무보강 원문 행으로 보수 대체
                        C, CR, CN, Ch, om, phi, _, _ = SPEC_G5[(fam, 'unfastened', 'unstiffened', sup)]
                        assert r['row_used'] == 'unfastened_substitute' and 'error' not in r, (fam, sup)
                        assert abs(r['Pn_per_web'] - _eq_g51(C, CR, CN, Ch, t, Fy, 0.03, N, h)) < 1.5e-3
                        assert r['omega'] == om and r['phi'] == phi
                        continue
                    assert 'error' in r and r.get('Pn') is None, (fam, fas, flange, sup)
                    assert r.get('not_covered') is True


def test_R5_G5_table_limits_h_t_N_t_N_h():
    """표별 h/t · N/t · N/h 한계(원문 표 머리말) — 넘으면 within_limits=False 와 오류."""
    for fam, (ht, nt, nh) in SPEC_G5_LIMITS.items():
        flange = None if fam in ('hat', 'multi_web') else 'stiffened'
        ok = _wc(fam, 'unfastened', flange, 'EOF', h=6.0, t=0.06, N=min(nh * 6.0, nt * 0.06) * 0.95)
        assert ok['within_limits'] is True and 'error' not in ok, (fam, ok.get('error'))
        assert 'error' in _wc(fam, 'unfastened', flange, 'EOF', h=1.05 * ht * 0.06, t=0.06, N=1.0)
        assert 'error' in _wc(fam, 'unfastened', flange, 'EOF', h=6.0, t=0.06, N=1.05 * nh * 6.0)


def test_R5_10_builtup_fastened_two_flange_is_not_covered():
    """R5-10: Table G5-1 Fastened 그룹은 one-flange 두 행뿐 — ETF/ITF 는 오류(이전 Pn 6.197 kips)."""
    from design.shear import web_crippling
    for sup in ('ETF', 'ITF'):
        r = web_crippling(8.0, 0.06, 0.18, 3.5, 50, support=sup, fastened='fastened',
                          section_family='built_up_i')
        assert 'error' in r and r['Pn'] is None and 'G5-1' in r['error']


def test_R5_11_z_section_names_route_to_table_g5_3():
    """R5-11: 템플릿·GUI·MCP 의 Z 표기 모두 G5-3, isect → G5-1, rhs → 오류.

    h 8, t 0.06, R 0.18, N 3.5, Fy 50, unfastened EOF: G5-3 계수 (5, 0.09, 0.02, 0.001) 로 계산.
    """
    from design.shear import web_crippling
    exp = _eq_g51(5, 0.09, 0.02, 0.001, 0.06, 50, 0.18, 3.5, 8.0)
    for name in ('Z', 'z', 'lippedz', 'LIPPEDZ', 'lipped_z', 'Lipped Z', 'lipped-z', 'ZEE', 'zs'):
        r = web_crippling(8.0, 0.06, 0.18, 3.5, 50, support='EOF', fastened='unfastened', section_type=name)
        assert r['table'] == 'G5-3' and abs(r['Pn'] - exp) < 1e-3, (name, r.get('table'), r.get('Pn'))
    # aisi_s100 의 옛 추론처럼 family='C' 와 section_type='lippedz' 가 함께 와도 Z 표
    r = web_crippling(8.0, 0.06, 0.18, 3.5, 50, support='EOF', fastened='unfastened',
                      section_type='lippedz', section_family='C')
    assert r['table'] == 'G5-3' and r['warnings']
    for name in ('isect', 'I', 'built-up I'):
        r = web_crippling(8.0, 0.06, 0.15, 3.5, 50, support='EOF', fastened='unfastened', section_type=name)
        assert r['table'] == 'G5-1', name
    for name in ('rhs', 'chs', 'angle', 'tee', 'mystery'):
        r = web_crippling(8.0, 0.06, 0.15, 3.5, 50, support='EOF', section_type=name)
        assert 'error' in r and r.get('Pn') is None, name
    assert 'error' in web_crippling(8.0, 0.06, 0.15, 3.5, 50, section_type='angle', section_family='C')


def test_R5_12_corrected_applicability_limits():
    """R5-12: G5-1 U-IOF R/t≤3, G5-1 N/h≤1.0, G5-4 F-ITF R/t≤10, G5-5 F/U-IOF ≤20 · F-ITF ≤10 · U-ITF ≤5,
    G5-2 F-ITF d ≥ 4.5 in."""
    t = 0.06
    assert 'error' in _wc('built_up_i', 'unfastened', 'stiffened', 'IOF', R=3.2 * t)
    assert 'error' in _wc('built_up_i', 'unfastened', 'stiffened', 'EOF', R=0.1, N=1.5 * 6.0)
    assert 'error' in _wc('hat', 'fastened', None, 'ITF', R=10.5 * t)
    assert 'error' in _wc('multi_web', 'fastened', None, 'IOF', R=21 * t)
    assert 'error' not in _wc('multi_web', 'fastened', None, 'IOF', R=19 * t)
    assert 'error' in _wc('multi_web', 'fastened', None, 'ITF', R=10.5 * t)
    assert 'error' in _wc('multi_web', 'unfastened', None, 'IOF', R=21 * t)
    assert 'error' in _wc('multi_web', 'unfastened', None, 'ITF', R=5.5 * t)
    shallow = _wc('c', 'fastened', 'stiffened', 'ITF', h=3.0, R=0.1, N=1.0)     # d ≈ 3.32 in
    assert 'error' in shallow and any('4.5' in v for v in shallow['limit_violations'])
    assert 'error' not in _wc('c', 'fastened', 'stiffened', 'ITF', h=3.0, R=0.1, N=1.0, d=4.6)


def test_R5_13_no_silent_row_substitution_and_explicit_n_webs():
    """R5-13/V2-07: C/Z fastened-unstiffened 는 원문에 없음 — 2-플랜지는 오류, 1-플랜지는 무체결 행을
    보수 대체로 쓰고 assumptions 에 밝힌다. multi-web n_webs=1 은 그대로 1."""
    for fam in ('c', 'z'):
        for sup in ('ETF', 'ITF'):
            r = _wc(fam, 'fastened', 'unstiffened', sup, R=0.03)
            assert r.get('not_covered') is True and 'No conservative substitute' in r['error']
        for sup in ('EOF', 'IOF'):
            r = _wc(fam, 'fastened', 'unstiffened', sup, R=0.03)
            assert r['row_used'] == 'unfastened_substitute'
            assert any('conservative substitute' in a for a in r['assumptions']) and not r['warnings']
    r = _wc('multi_web', 'fastened', None, 'EOF', n_webs=1, R=0.1)
    assert r['n_webs'] == 1 and r['Pn'] == r['Pn_per_web']
    r = _wc('hat', 'fastened', None, 'EOF', n_webs=None, R=0.1)
    assert r['n_webs'] == 2 and abs(r['Pn'] - 2 * r['Pn_per_web']) < 2e-3


def test_R5_14_builtup_i_strength_is_per_web():
    """R5-14: Table G5-1 은 "per web"(표 제목·Commentary G5) — 기본 두 웨브, 명시 n_webs 존중."""
    t, R, N, h = 0.08, 0.16, 3.0, 7.0
    exp = _eq_g51(15.5, 0.09, 0.08, 0.04, t, 50.0, R, N, h)
    r = _wc('built_up_i', 'unfastened', 'stiffened', 'ETF', h=h, t=t, R=R, N=N, n_webs=None)
    assert abs(r['Pn_per_web'] - exp) < 1e-3 and abs(r['Pn'] - 2 * exp) < 2e-3 and r['n_webs'] == 2


def test_R5_15_outside_limits_cannot_pass():
    """R5-15: h/t=233 → 오류·within_limits False; 설계 경로에서는 판정이 None."""
    from design.aisi_s100 import design_member
    r = _wc('c', 'fastened', 'stiffened', 'EOF', h=14.0, t=0.06, R=0.1)
    assert r['within_limits'] is False and 'error' in r and any('h/t' in v for v in r['limit_violations'])
    base = {'member_type': 'flexure', 'design_method': 'LRFD', 'section_type': 'lippedc',
            'H': 8.0, 'B': 2.5, 'D': 0.625, 't': 0.06, 'R': 0.09, 'Fy': 50.0, 'Mu': 1.0, 'Lb': 0.0,
            'Vu': 0.1, 'dsm': {'Mcrl': 100.0, 'Mcrd': 100.0, 'My': 100.0},
            'wc_R': 0.1, 'wc_support': 'EOF'}
    ok = design_member({**base, 'wc_N': 1.0})
    short = design_member({**base, 'wc_N': 0.5})       # N < 0.75 in (§G5 정의)
    assert ok.get('web_crippling', {}).get('within_limits') is True
    assert short['pass'] is None


def test_R5_example_II_1A_web_crippling():
    """Example II-1A §G5: 9CS2.5x070 EOF Pn 2.56, IOF 4.24; 9CS2.5x059 IOF 2.96 kips (fastened, N 5, R 0.1875)."""
    from design.shear import web_crippling
    assert abs(web_crippling(8.485, 0.070, 0.1875, 5.0, 55, support='EOF')['Pn'] - 2.56) < 0.01
    assert abs(web_crippling(8.485, 0.070, 0.1875, 5.0, 55, support='IOF')['Pn'] - 4.24) < 0.01
    assert abs(web_crippling(8.507, 0.059, 0.1875, 5.0, 55, support='IOF')['Pn'] - 2.96) < 0.01


# ====================================================== steel_grades.py
def test_R5_30_low_ductility_grades_are_not_offered_at_80_ksi():
    """R5-30: §A3.1.3 강종은 기본 표에 없고, 명시 요청 시 Fy=min(0.75Fsy,60)·Fu=min(0.75Fu,62)."""
    from design.steel_grades import STEEL_GRADES, a313_flexure_Rb, get_grade, list_grades
    for gid in ('A653-80', 'A792-80', 'SGC570', 'A1003-80'):
        assert gid not in STEEL_GRADES and get_grade(gid) is None
    assert all(g['Fy'] <= 55.0 for g in list_grades())
    a653 = get_grade('A653-80', include_restricted=True)
    assert a653['Fy'] == 60.0 and a653['Fu'] == 0.75 * 82 and a653['elongation_group'] == 'A3.1.3'
    sgc = get_grade('SGC570', include_restricted=True)
    assert sgc['Fy'] == 60.0 and abs(sgc['Fu'] - 62.0) < 1e-9 and 'multiple-web' in sgc['use_restriction']
    # Eq. A3.1.3-1: w/t=100, Fsy=80, E=29500
    exp = 1 - 0.26 * (100 * 80 / 29500 - 0.067) ** 0.4
    assert abs(a313_flexure_Rb(100, 80) - exp) < 1e-12
    assert a313_flexure_Rb(20, 80) == 1.0 and a313_flexure_Rb(400, 80) == 0.75
    assert abs(a313_flexure_Rb(30, 80, stiffened=False) - (1.079 - 0.6 * math.sqrt(30 * 80 / 29500))) < 1e-12


def test_R5_31_ks_grade_values_unchanged_and_annotated():
    """R5-31(의심, 사용자 결정): 값은 그대로 두고 현행 KS 명칭 사실을 note 로 남긴다."""
    from design.steel_grades import get_grade
    g = get_grade('SGC400')
    assert (g['Fy'], g['Fu']) == (35.53, 58.02) and 'SGC245Y' in g['note']


# ====================================================== V2 검증 뒤 (2026-11-22)
def test_V2_04_single_minimum_floor_is_never_the_other_modes_value():
    """V2-04: 단일 극소는 한 모드만 분리 — 다른 모드는 0 + 하한(floor) 키, 그 뜻을 결과에 적는다."""
    node, elem = _section()
    f = _sig(_branch(6, 0.3), _glob(30.0))
    for clas, iso_key, floor_key in ((None, 'Pcrl', 'crd_floor'),
                                     (_cls(lambda L: [0, 94, 6, 0]), 'Pcrd', 'crl_floor')):
        r = extract_dsm_values(_curve(f), node, elem, 50, 'P', mode_classifications=clas)
        other = 'Pcrd' if iso_key == 'Pcrl' else 'Pcrl'
        lf = r['LF_single_minimum']
        assert abs(r[iso_key] - lf * r['P_ref']) < 1e-9 * r['P_ref'] and r[other] == 0.0
        assert abs(r[floor_key] - lf * r['P_ref']) < 1e-9 * r['P_ref']
        assert r['single_minimum_bound_meaning'].startswith('lower bound')
        assert r['local_isolated'] is False and r['dist_isolated'] is False
        assert r['warnings'] == [] and any('floor' in a for a in r['assumptions'])


def test_V2_08_lower_local_minimum_is_not_dropped():
    """V2-08: 짧은 쪽의 높은 극소가 국부를 가리면 안 된다 (V2 synth t · t2 · l; 옛 Pcrl +69 % / +60 %).

    곡선: 국부 0.6 @ 4 in, 뒤틀림 0.9 @ 25 in, 국부 하강부 1.6 in 근처의 작은 흔들림(LF ≈ 1.0).
    서명곡선은 순수모드 곡선의 아래 포락선이므로, 어느 극소가 국부인지 모를 때 국부일 수 있는
    극소의 최저를 쓰면 보수 측이다.
    """
    node, elem = _section()

    def pm(L, L0, f0):
        return f0 * ((L / L0) + (L0 / L)) ** 2 / 4

    L60 = np.logspace(0, 3, 60)

    def two(L):
        return min(pm(L, 4, 0.6), pm(L, 25, 0.9), 20000.0 / L ** 2)

    def wig(L):
        return two(L) * (0.8 if 1.45 < L < 1.6 else 1.0)

    # (t) 라벨 없음, 극소 셋 → 국부 0.6 (옛 1.012), 뒤틀림은 하한 규칙
    r = extract_dsm_values(_curve(wig, L60), node, elem, 50, 'P')
    assert r['n_minima'] == 3 and abs(r['LF_local'] - 0.6) < 0.005, r['LF_local']
    assert r['LF_dist'] <= 0.903 + 1e-6 and r['local_basis'] == 'wavelength_bound' and r['warnings']
    # (t2) L 라벨(짧은 쪽 전부) + D 라벨 → 국부 0.6, 뒤틀림 0.903
    lab = _cls(lambda L: [0, 3, 97, 0] if L < 10 else [2, 96, 2, 0], L60)
    r = extract_dsm_values(_curve(wig, L60), node, elem, 50, 'P', mode_classifications=lab)
    assert abs(r['LF_local'] - 0.6) < 0.005 and abs(r['LF_dist'] - 0.903) < 0.005
    assert r['classification_method'] == 'cfsm_modal'

    # (l) NaN 극소(0.5 @ 1.8)가 L 라벨 극소(0.8 @ 6)보다 짧고 낮다 → 국부 0.5 (옛 0.80)
    def two_s(L):
        return min(pm(L, 1.8, 0.5), pm(L, 6, 0.8), pm(L, 30, 1.0), 20000.0 / L ** 2)

    def lab_l(L):
        return [float('nan')] * 4 if L < 3 else ([0, 3, 97, 0] if L < 10 else [90, 8, 1, 1])

    r = extract_dsm_values(_curve(two_s, L60), node, elem, 50, 'P', mode_classifications=_cls(lab_l, L60))
    assert abs(r['LF_local'] - 0.5) < 0.005, r['LF_local']
    assert r['LF_dist'] <= 1.0 + 1e-6 and r['warnings']
    _assert_no_absence(r)


def test_V2_07_fastened_track_web_crippling_gets_a_strength():
    """V2-07: 트랙(무립) + 체결 EOF — 무체결 무보강 행(C 4, CR 0.40, CN 0.60, Ch 0.03, Ω 1.80, φ 0.85)으로
    보수 대체한 강도. 대체 근거: 보강 플랜지 1-플랜지 행에서 체결 Pn ≥ 무체결 Pn (표 계수로 아래에서 확인)."""
    from design.shear import web_crippling
    h, t, R, N, Fy = 5.75, 0.0566, 0.0566, 3.0, 50.0     # 600T125-54 류, R/t = 1.0 ≤ 2
    r = web_crippling(h, t, R, N, Fy, support='EOF', fastened='fastened', section_type='track')
    exp = _eq_g51(4, 0.40, 0.60, 0.03, t, Fy, R, N, h)
    assert 'error' not in r and abs(r['Pn'] - exp) < 1e-3 and r['omega'] == 1.80 and r['phi'] == 0.85
    assert r['flange_condition'] == 'unstiffened' and r['row_used'] == 'unfastened_substitute'
    itf = web_crippling(h, t, R, N, Fy, support='ITF', fastened='fastened', section_type='track')
    assert itf.get('not_covered') is True and itf['Pn'] is None
    # 근거 확인: G5-2·G5-3 보강 플랜지 1-플랜지 행 — 체결 Pn ≥ 무체결 Pn (h/t 20–200, R/t ≤ 5, N/t ≤ 210)
    for fam in ('c', 'z'):
        for sup in ('EOF', 'IOF'):
            f = SPEC_G5[(fam, 'fastened', 'stiffened', sup)]
            u = SPEC_G5[(fam, 'unfastened', 'stiffened', sup)]
            for ht in (20, 60, 100, 150, 200):
                for rt in (0.0, 1.0, 3.0, 5.0):
                    for nt in (12.5, 50.0, 150.0, 210.0):
                        if nt / ht > 2.0:
                            continue
                        pf = _eq_g51(*f[:4], 1.0, 1.0, rt, nt, ht)
                        pu = _eq_g51(*u[:4], 1.0, 1.0, rt, nt, ht)
                        assert pf >= pu * (1 - 1e-12), (fam, sup, ht, rt, nt)
                        assert pf * f[5] >= pu * u[5] * (1 - 1e-12) and pf / f[4] >= pu / u[4] * (1 - 1e-12)


def test_V2_02_h3_applies_to_hat_builtup_and_overhang_and_is_not_evaluated_here():
    """V2-02: §H3 (a)(b) 는 hat · built-up I · 돌출(G5-2)에도 해당한다 — 결과가 '해당함 · 여기서 평가 안 함'을 밝힌다."""
    from design.shear import web_crippling
    hat = web_crippling(3.68, 0.06, 0.1, 3.0, 50, support='IOF', section_family='hat')
    bui = web_crippling(8.0, 0.059, 0.15, 3.5, 55, support='IOF', fastened='unfastened',
                        section_family='built_up_i')
    ovh = web_crippling(7.485, 0.070, 0.1875, 5.0, 55, support='EOF', section_type='Z', Lo=9.5)
    for r, eq in ((hat, 'H3-1'), (bui, 'H3-2'), (ovh, 'H3-1')):
        assert r['h3_applies'] is True and r['h3_applicable'] is True and r['h3_evaluated'] is False
        assert r['h3_equation'] == eq and r['h3_equation_candidate'] == eq
    assert ovh['equation'] == 'G5-2' and any('Pnc' in a for a in ovh['assumptions'])


def test_V2_10_expected_situations_do_not_raise_warnings():
    """V2-10 · FIXES §3.1.1: 분류 행이 전부 NaN(F3 의 예정된 동작)이면 알림 없이 classification_note 만,
    단일 극소는 assumptions, 범위 진술은 scope_notes."""
    node, elem = _section()
    two = _sig(_branch(4, 0.7), _branch(20, 0.9), _glob(3.0))
    r = extract_dsm_values(_curve(two), node, elem, 50, 'P', mode_classifications=_cls(lambda L: [float('nan')] * 4))
    assert r['warnings'] == [] and r['assumptions'] == [] and r['classification_note']
    assert r['scope_notes'] and abs(r['LF_local'] - 0.70) < 0.012 and abs(r['LF_dist'] - 0.90) < 0.012
    single = extract_dsm_values(_curve(_sig(_branch(6, 0.3), _glob(30.0))), node, elem, 50, 'P')
    assert single['warnings'] == [] and single['assumptions']
