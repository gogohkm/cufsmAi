"""0926 개선 Phase 0 회귀 테스트

0926코드개선방안.md §4·§7 Phase 0 항목을 고정한다:
H3 3식×LRFD/ASD, H3-LSD φ 필수, J6 경로별 파단 포함,
Lb/KL 기본값 경고, xo 복원 계약, DSM 미평가 플래그,
D 조합, 랩 FE 골든(모멘트 재분배+처짐).

기존 test_design_verification.py와 동일한 함수형 스타일
(pytest 없이 직접 실행 가능).
"""

import sys
import os
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'python'))

PASS = 0
FAIL = 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  PASS: {label}')
    else:
        FAIL += 1
        print(f'  *** FAIL ***: {label}')
    return cond


def approx(a, b, tol=1e-6):
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


# ============================================================
# H3 휨+웹크리플링 (§4 P0-1 회귀)
# ============================================================

def test_h3_all_configs_both_methods():
    """H3-1/2/3 × LRFD/ASD 한계·식별자·판정 고정"""
    print('\n=== TEST: H3 all configs x LRFD/ASD ===')
    from design.interaction import combined_bending_web_crippling as h3
    cases = [
        ('single', 'H3-1', 0.91, 1.33),
        ('multi_web', 'H3-2', 0.88, 1.46),
        ('nested_z', 'H3-3', 0.86, 1.65),
    ]
    ok = True
    for cfg, eq, p_coef, lim_coef in cases:
        r = h3(10.0, 10.0, 0.0, 100.0, web_config=cfg, design_method='LRFD')
        ok &= check(r['equation'] == eq, f'{cfg} LRFD equation={eq}')
        ok &= check(approx(r['limit'], lim_coef * 0.90), f'{cfg} LRFD limit={lim_coef}*0.9')
        ok &= check(approx(r['total'], p_coef), f'{cfg} LRFD total={p_coef}(P/Pn)')
        ok &= check(r['pass'] is True, f'{cfg} LRFD pass')
        r = h3(10.0, 10.0, 0.0, 100.0, web_config=cfg, design_method='ASD')
        ok &= check(r['equation'] == eq, f'{cfg} ASD equation={eq}')
        # 반환 limit은 round(...,4) — 같은 반올림 기준으로 비교
        ok &= check(approx(r['limit'], round(lim_coef / 1.70, 4)), f'{cfg} ASD limit={lim_coef}/1.7')
        ok &= check(r['pass'] is (p_coef <= lim_coef / 1.70), f'{cfg} ASD pass consistent')
        # 과하중 판정: P항만으로 한계 초과
        r = h3(20.0, 10.0, 0.0, 100.0, web_config=cfg, design_method='LRFD')
        ok &= check(r['pass'] is False, f'{cfg} LRFD overload fails')
    return ok


def test_h3_lsd_requires_explicit_phi():
    """H3 LSD는 식별 φ 필수 — LRFD 기본값 침묵 사용 금지 (P1-6)"""
    print('\n=== TEST: H3 LSD explicit phi ===')
    from design.interaction import combined_bending_web_crippling as h3
    ok = True
    try:
        h3(5.0, 10.0, 5.0, 100.0, web_config='single', design_method='LSD')
        ok &= check(False, 'LSD without phi raises ValueError')
    except ValueError:
        ok &= check(True, 'LSD without phi raises ValueError')
    r = h3(5.0, 10.0, 5.0, 100.0, web_config='single', design_method='LSD', phi=0.75)
    ok &= check(approx(r['limit'], 1.33 * 0.75), 'LSD H3-1 limit=1.33*0.75')
    r = h3(5.0, 10.0, 5.0, 100.0, web_config='nested_z', design_method='LSD', phi=0.80)
    ok &= check(approx(r['limit'], 1.65 * 0.80), 'LSD H3-3 limit=1.65*0.80')
    # LRFD 기본 φ=0.90 하위호환
    r = h3(5.0, 10.0, 5.0, 100.0, web_config='single', design_method='LRFD')
    ok &= check(approx(r['limit'], 1.33 * 0.90), 'LRFD default phi=0.90 preserved')
    return ok


# ============================================================
# J6 파단 경로 (§4 P0-2 회귀)
# ============================================================

def _ls_names(result):
    return [ls['name'] for ls in result.get('limit_states', [])]


def test_j6_bolt_full():
    """볼트: J6.1+J6.2+J6.3 모두 포함, j6_verified=True"""
    print('\n=== TEST: J6 bolt full ===')
    from design.connections import design_connection
    r = design_connection({
        'connection_type': 'bolt', 'design_method': 'LRFD',
        'Fy': 35.53, 'Fu': 58.02, 't1': 0.1, 't2': 0.1,
        'd': 0.5, 'Fub': 120, 'n': 2, 'e': 1.5,
        'Ag': 2.0, 'width': 4.0, 'g': 2.0,
    })
    names = _ls_names(r)
    ok = True
    ok &= check('Shear Rupture (J6.1)' in names, 'bolt J6.1 present')
    ok &= check('Tension Rupture (J6.2)' in names, 'bolt J6.2 present')
    ok &= check('Block Shear (J6.3)' in names, 'bolt J6.3 present')
    ok &= check(r.get('j6_verified') is True, 'bolt j6_verified True')
    return ok


def test_j6_screw_paf_rupture_no_block():
    """나사/PAF: J6.1+J6.2 포함, J6.3 제외(볼트/용접 대상)"""
    print('\n=== TEST: J6 screw/paf ===')
    from design.connections import design_connection
    ok = True
    for ctype, d in (('screw', 0.190), ('paf', 0.145)):
        r = design_connection({
            'connection_type': ctype, 'design_method': 'LRFD',
            'Fy': 35.53, 'Fu': 58.02, 't1': 0.06, 't2': 0.06,
            'd': d, 'n': 2, 'e': 1.0, 'Ag': 1.0, 'width': 3.0,
        })
        names = _ls_names(r)
        ok &= check('Shear Rupture (J6.1)' in names, f'{ctype} J6.1 present')
        ok &= check('Tension Rupture (J6.2)' in names, f'{ctype} J6.2 present')
        ok &= check('Block Shear (J6.3)' not in names, f'{ctype} J6.3 excluded')
    return ok


def test_j6_warns_without_geometry():
    """형상 미입력 시 J6.2/J6.3 미평가 경고 + j6_verified=False"""
    print('\n=== TEST: J6 missing geometry warns ===')
    from design.connections import design_connection
    r = design_connection({
        'connection_type': 'bolt', 'design_method': 'LRFD',
        'Fy': 35.53, 'Fu': 58.02, 't1': 0.1, 't2': 0.1,
        'd': 0.5, 'n': 1, 'e': 1.5,
    })
    w = ' '.join(r.get('warnings', []))
    ok = True
    ok &= check('J6.2' in w, 'J6.2 unevaluated warning')
    ok &= check('J6.3' in w, 'J6.3 unevaluated warning')
    ok &= check(r.get('j6_verified') is False, 'j6_verified False')
    return ok


# ============================================================
# 기본값 경고 (§4 P3 회귀)
# ============================================================

def test_lb_default_warning():
    """휨 Lb 미지정 시 120in 기본값 경고"""
    print('\n=== TEST: Lb default warning ===')
    from design.aisi_s100 import _design_flexure
    r = _design_flexure({'Fy': 35.53, 'props': {'A': 1.0, 'Sf': 1.0}})
    w = ' '.join(r.get('warnings', []))
    ok = check('Lb defaulted to 120 in' in w, 'Lb default warning present')
    r2 = _design_flexure({'Fy': 35.53, 'Lb': 60.0, 'props': {'A': 1.0, 'Sf': 1.0}})
    w2 = ' '.join(r2.get('warnings', []))
    ok &= check('Lb defaulted' not in w2, 'no Lb warning when specified')
    return ok


def test_kl_default_warning():
    """압축 KL 미지정 시 120in 기본값 경고"""
    print('\n=== TEST: KL default warning ===')
    from design.aisi_s100 import _design_compression
    r = _design_compression({'Fy': 35.53, 'props': {'A': 1.0}})
    w = ' '.join(r.get('warnings', []))
    ok = check('Effective length defaulted' in w, 'KL default warning present')
    r2 = _design_compression({'Fy': 35.53, 'KxLx': 60.0, 'props': {'A': 1.0}})
    w2 = ' '.join(r2.get('warnings', []))
    ok &= check('Effective length defaulted' not in w2, 'no KL warning when specified')
    return ok


# ============================================================
# xo/ro 계약 (P1-1/P1-4)
# ============================================================

def test_xo_ro_sources():
    """resolve_xo_ro: direct/Xs-xcg/zero + ro 유도"""
    print('\n=== TEST: xo/ro resolve sources ===')
    from design.global_buckling import resolve_xo_ro
    ok = True
    r = resolve_xo_ro({'xo': 1.5, 'ro': 3.0}, 2.0, 1.0)
    ok &= check(r['xo_source'] == 'direct' and r['ro_source'] == 'direct', 'direct sources')
    r = resolve_xo_ro({'Xs': 2.5, 'xcg': 1.0}, 2.0, 1.0)
    ok &= check(r['xo_source'] == 'Xs-xcg' and approx(r['xo'], 1.5), 'Xs-xcg restore')
    ok &= check(approx(r['ro'], math.sqrt(4.0 + 1.0 + 2.25)), 'ro derived formula')
    ok &= check(r['ro_source'] == 'derived', 'ro derived source')
    r = resolve_xo_ro({}, 2.0, 1.0)
    ok &= check(r['xo_source'] == 'zero' and r['xo'] == 0, 'zero source')
    return ok


def test_ft_not_evaluated_flag():
    """C단면 xo 전멸 시 ft_not_evaluated=True + 경고, 복원 시 False"""
    print('\n=== TEST: ft_not_evaluated flag ===')
    from design.global_buckling import compute_column_Fcre
    base = {'A': 1.0, 'rx': 3.0, 'ry': 1.0, 'J': 0.01, 'Cw': 10.0,
            'Ixx': 9.0, 'Izz': 1.0, 'section_type': 'C'}
    r = compute_column_Fcre(dict(base), 35.53, 120.0, 120.0, 120.0)
    ok = check(r.get('ft_not_evaluated') is True, 'C without xo -> ft_not_evaluated')
    ok &= check(r.get('xo_source') == 'zero', 'xo_source zero')
    p2 = dict(base)
    p2['Xs'] = 2.0
    p2['xcg'] = 0.5
    r2 = compute_column_Fcre(p2, 35.53, 120.0, 120.0, 120.0)
    ok &= check(r2.get('ft_not_evaluated') is False, 'C with Xs/xcg -> evaluated')
    ok &= check(r2.get('xo_source') == 'Xs-xcg', 'xo_source Xs-xcg')
    # 이중대칭(I)은 xo=0이 정상 → 플래그 False
    p3 = dict(base)
    p3['section_type'] = 'I'
    r3 = compute_column_Fcre(p3, 35.53, 120.0, 120.0, 120.0)
    ok &= check(r3.get('ft_not_evaluated') is False, 'I-section xo=0 is genuine')
    return ok


# ============================================================
# DSM 미평가 전파 (P1-2)
# ============================================================

def test_dsm_strength_evaluated_flags():
    """dsm_strength 4함수: 임계값 0 → evaluated False"""
    print('\n=== TEST: dsm_strength evaluated flags ===')
    from design import dsm_strength as ds
    ok = True
    ok &= check(ds.compression_local(10.0, 0.0)['evaluated'] is False, 'Pnl unevaluated')
    ok &= check(ds.compression_distortional(10.0, 0.0)['evaluated'] is False, 'Pnd unevaluated')
    ok &= check(ds.flexure_local(10.0, 0.0)['evaluated'] is False, 'Mnl unevaluated')
    ok &= check(ds.flexure_distortional(10.0, 0.0)['evaluated'] is False, 'Mnd unevaluated')
    ok &= check(ds.compression_local(10.0, 5.0).get('evaluated', True) is not False, 'Pnl evaluated')
    return ok


def test_design_not_evaluated_flags():
    """설계 결과에 local/distortional/ft 미평가 플래그 전파"""
    print('\n=== TEST: design not-evaluated flags ===')
    from design.aisi_s100 import _design_compression, _design_flexure
    ok = True
    rc = _design_compression({'Fy': 35.53, 'props': {'A': 1.0}})
    ok &= check(rc.get('local_not_evaluated') is True, 'compression local flag')
    ok &= check(rc.get('distortional_not_evaluated') is True, 'compression distortional flag')
    ok &= check(rc.get('dsm_source') == {'Pcrl': 'FSM', 'Pcrd': 'FSM'}, 'compression dsm_source keys')
    rf = _design_flexure({'Fy': 35.53, 'props': {'A': 1.0, 'Sf': 1.0}})
    ok &= check(rf.get('local_not_evaluated') is True, 'flexure local flag')
    ok &= check(rf.get('distortional_not_evaluated') is True, 'flexure distortional flag')
    ok &= check(set(rf.get('dsm_source', {}).keys()) == {'Mcrl', 'Mcrd'}, 'flexure dsm_source keys')
    return ok


# ============================================================
# D 조합 + 랩 FE 골든 (§4 이슈1 회귀)
# ============================================================

def test_d_combination():
    """apply_combination이 D(처짐)도 선형 조합"""
    print('\n=== TEST: D combination ===')
    from design.loads.load_combinations import apply_combination
    load_results = {
        'D': {'M': [1.0, 2.0], 'V': [0.5, 0.5], 'R': [1.0], 'D': [0.1, 0.2], 'x': [0, 1]},
        'Lr': {'M': [2.0, 4.0], 'V': [1.0, 1.0], 'R': [2.0], 'D': [0.2, 0.4], 'x': [0, 1]},
    }
    r = apply_combination({'D': 1.2, 'Lr': 1.6}, load_results)
    ok = True
    ok &= check(len(r['D']) == 2, 'D combined length')
    ok &= check(approx(r['D'][0], 1.2 * 0.1 + 1.6 * 0.2), 'D[0] linear combo')
    ok &= check(approx(r['D'][1], 1.2 * 0.2 + 1.6 * 0.4), 'D[1] linear combo')
    ok &= check(approx(r['M'][0], 1.2 * 1.0 + 1.6 * 2.0), 'M still combined')
    return ok


def test_fe_lap_golden():
    """2경간 랩 FE 골든: 지점 모멘트·반력·처짐 + 랩 재분배"""
    print('\n=== TEST: FE lap golden ===')
    from design.loads.beam_analysis import analyze_beam_fe
    kw = dict(spans=[25.0, 25.0], w_plf_list=[100.0, 100.0],
              supports=['P', 'P', 'P'], I_base_in4=10.0, n_pts_per_span=51)
    laps = [None, {'left_ft': 2.0, 'right_ft': 2.0}, None]
    r = analyze_beam_fe(laps_per_support=laps, I_lap_ratio=2.0, **kw)
    x = r.x
    si = min(range(len(x)), key=lambda i: abs(x[i] - 25.0))
    mi = min(range(len(x)), key=lambda i: abs(x[i] - 12.5))
    ok = True
    ok &= check(approx(r.M[si], -8.800698, 1e-4), f'support M golden ({r.M[si]:.4f})')
    ok &= check(approx(r.M[mi], 3.412151, 1e-4), f'midspan M golden ({r.M[mi]:.4f})')
    ok &= check(approx(sum(float(v) for v in r.R), 5.0, 1e-3), 'equilibrium R=5kips')
    ok &= check(abs(r.D[si]) < 1e-6, 'zero deflection at support')
    ok &= check(approx(r.D[mi], 0.99439, 1e-3), f'midspan D golden ({r.D[mi]:.5f})')
    # 랩 효과: 무랩 대비 지점 부모멘트 증가·경간 처짐 감소
    r0 = analyze_beam_fe(laps_per_support=None, I_lap_ratio=1.0, **kw)
    x0 = r0.x
    si0 = min(range(len(x0)), key=lambda i: abs(x0[i] - 25.0))
    mi0 = min(range(len(x0)), key=lambda i: abs(x0[i] - 12.5))
    ok &= check(abs(r.M[si]) > abs(r0.M[si0]), 'lap increases support moment')
    ok &= check(r.D[mi] < r0.D[mi0], 'lap decreases midspan deflection')
    return ok


# ============================================================
# J3 지압계수 C + 볼트 강도표 (P1-8 대조 잠금)
# ============================================================

def test_bolt_bearing_c_branches():
    """Table J3.3.1-1 C 분기: standard d/t 10/22, oversized 7/18"""
    print('\n=== TEST: bolt bearing C branches ===')
    from design.connections import bolt_connection

    def c_of(d, t, hole='standard'):
        r = bolt_connection(t1=t, t2=t, d=d, Fy=50, Fu=65, Fub=120,
                            n=1, mf=1.0, hole_type=hole)
        b = [ls for ls in r['limit_states'] if ls['name'].startswith('Bearing')][0]
        return b['Rn'] / (d * t * 65.0)  # Rn = C·mf·d·t·Fu, mf=1

    ok = True
    # standard: C=3.0 (d/t<10), 4-0.1·d/t (10..22), 1.8 (>22)
    ok &= check(approx(c_of(0.5, 0.1), 3.0), 'standard d/t=5 -> C=3.0')
    ok &= check(approx(c_of(1.2, 0.1), 4.0 - 0.1 * 12.0), 'standard d/t=12 -> 4-0.1dt')
    ok &= check(approx(c_of(2.5, 0.1), 1.8), 'standard d/t=25 -> C=1.8')
    # oversized: C=3.0 (d/t<7), 1+14/d/t (7..18), 1.8 (>18)
    ok &= check(approx(c_of(0.5, 0.1, 'oversized'), 3.0), 'oversized d/t=5 -> C=3.0')
    ok &= check(approx(c_of(1.0, 0.1, 'oversized'), 1.0 + 14.0 / 10.0),
                'oversized d/t=10 -> 1+14/dt')
    ok &= check(approx(c_of(2.0, 0.1, 'oversized'), 1.8), 'oversized d/t=20 -> C=1.8')
    return ok


def test_bolt_fnv_fnt_table():
    """Table J3.4-1 Fnv/Fnt: A325/A307 표값 + Threaded Parts 폴백"""
    print('\n=== TEST: bolt Fnv/Fnt table ===')
    from design.connections import _bolt_Fnv_Fnt
    ok = True
    fnv, fnt, _ = _bolt_Fnv_Fnt(0.75, 120, 'A325', False)
    ok &= check((fnv, fnt) == (54.0, 90.0), 'A325 large threads-in 54/90')
    fnv, fnt, _ = _bolt_Fnv_Fnt(0.75, 120, 'A325', True)
    ok &= check((fnv, fnt) == (68.0, 90.0), 'A325 large threads-excluded 68/90')
    fnv, fnt, _ = _bolt_Fnv_Fnt(0.375, 60, 'A307', False)
    ok &= check((fnv, fnt) == (24.0, 40.0), 'A307 small 24/40')
    fnv, fnt, label = _bolt_Fnv_Fnt(0.75, 100, None, False)
    ok &= check(approx(fnv, 0.450 * 100) and approx(fnt, 0.75 * 100),
                'Threaded Parts fallback 0.45/0.75 Fu')
    ok &= check(label == 'Threaded Parts', 'fallback label')
    fnv, _, _ = _bolt_Fnv_Fnt(0.75, 100, None, True)
    ok &= check(approx(fnv, 0.563 * 100), 'Threaded Parts excluded 0.563 Fu')
    return ok


def test_combined_propagates_sub_warnings():
    """조합 설계: 하위 압축/휨 경고·미평가 플래그·Cm 경고 전파"""
    print('\n=== TEST: combined warning propagation ===')
    from design.aisi_s100 import _design_combined
    r = _design_combined({'Fy': 35.53, 'Pu': 1.0, 'Mux': 5.0,
                          'props': {'A': 1.0, 'Sf': 1.0}})
    ok = True
    w = ' '.join(r.get('warnings', []))
    ok &= check('Cmx' in w and 'Cmy' in w, 'Cm default warnings')
    ok &= check(r.get('local_not_evaluated') is True, 'local flag propagated')
    ok &= check(r.get('distortional_not_evaluated') is True, 'dist flag propagated')
    ok &= check(set(r.get('dsm_source', {}).keys()) == {'compression', 'flexure_x'},
                'dsm_source propagated')
    # 명시 Cm 입력 시 경고 없음
    r2 = _design_combined({'Fy': 35.53, 'Pu': 1.0, 'Mux': 5.0, 'Cmx': 0.9, 'Cmy': 0.9,
                           'props': {'A': 1.0, 'Sf': 1.0}})
    w2 = ' '.join(r2.get('warnings', []))
    ok &= check('Cmx 미지정' not in w2 and 'Cmy 미지정' not in w2, 'no Cm warning when given')
    return ok


def test_curling_reference_only():
    """컬링: 허용값 미제공 시 ok=None 참고값 + serviceability 태그 (P1-9)"""
    print('\n=== TEST: curling reference-only ===')
    from design.special_topics import flange_curling
    ok = True
    r = flange_curling(2.0, 0.06, 8.0, 20.0)
    ok &= check(r['ok'] is None, 'no allowable -> ok None')
    ok &= check(r.get('serviceability_only') is True, 'serviceability tag')
    ok &= check(len(r.get('warnings', [])) > 0, 'default-limit warning')
    r2 = flange_curling(2.0, 0.06, 8.0, 20.0, allowable_cf=0.01)
    ok &= check(r2['ok'] in (True, False), 'allowable given -> judged')
    r3 = flange_curling(2.0, 0.0, 8.0, 20.0)
    ok &= check(r3['ok'] is None, 'invalid input -> ok None')
    return ok


# ============================================================
# DSM 추출 분기 (P2 — 합성 곡선)
# ============================================================

def _dsm_synth_section():
    """2절점 1요소 합성 단면 (grosprop/yieldMP 구동용)"""
    import numpy as np
    node = np.array([
        [1, 0.0, 0.0, 1, 1, 1, 1, 0.0],
        [2, 2.0, 0.0, 1, 1, 1, 1, 0.0],
    ])
    elem = np.array([[1, 1, 2, 0.1, 100]])
    return node, elem


def _dsm_curve(pairs):
    import numpy as np
    return [np.array([L, lf]) for L, lf in pairs]


def test_dsm_two_minima_heuristic():
    """2극소: 최단=국부, 이후 최저=뒤틀림 (two_minima)"""
    print('\n=== TEST: dsm two minima ===')
    from engine.dsm import extract_dsm_values
    node, elem = _dsm_synth_section()
    curve = _dsm_curve([(1, 3.0), (2, 2.0), (3, 2.5), (6, 2.2),
                        (9, 1.5), (12, 1.8), (15, 2.0), (20, 2.5)])
    r = extract_dsm_values(curve, node, elem, fy=50.0, load_type='P')
    ok = True
    ok &= check(r['classification'] == 'two_minima', 'two_minima label')
    ok &= check(r['local_detected'] and r['dist_detected'], 'both detected')
    ok &= check(r['classification_method'] == 'heuristic', 'heuristic method')
    ok &= check(abs(r['Lcrl'] - 2.0) < 1e-9, 'Lcrl shortest minimum')
    ok &= check(abs(r['Lcrd'] - 9.0) < 1e-9, 'Lcrd lowest longer minimum')
    ok &= check(r['Pcrl'] > 0 and r['Pcrd'] > 0, 'positive critical loads')
    return ok


def test_dsm_single_minimum_not_isolated():
    """단일 극소: 국부 채택 + 뒤틀림 미분리(Pcrd=0, dist False)"""
    print('\n=== TEST: dsm single minimum ===')
    from engine.dsm import extract_dsm_values
    node, elem = _dsm_synth_section()
    curve = _dsm_curve([(1, 3.0), (2, 2.0), (3, 2.5), (4, 3.0), (5, 3.5)])
    r = extract_dsm_values(curve, node, elem, fy=50.0, load_type='P')
    ok = True
    ok &= check(r['classification'] == 'single_minimum', 'single_minimum label')
    ok &= check(r['local_detected'] is True, 'local detected')
    ok &= check(r['dist_detected'] is False and r['Pcrd'] == 0.0, 'distortional not isolated')
    return ok


def test_dsm_monotone_and_boundary():
    """단조 곡선(monotone) + 짧은끝 경계극소 삽입 확인"""
    print('\n=== TEST: dsm monotone/boundary ===')
    from engine.dsm import extract_dsm_values
    node, elem = _dsm_synth_section()
    # 상승 시작 단조 증가: 첫 점이 극소 → 경계극소 삽입 → single_minimum
    curve = _dsm_curve([(1, 1.0), (2, 2.0), (3, 3.0), (4, 4.0), (5, 5.0)])
    r = extract_dsm_values(curve, node, elem, fy=50.0, load_type='P')
    ok = True
    ok &= check(r['classification'] == 'single_minimum', 'short-end boundary minimum')
    ok &= check(abs(r['Lcrl'] - 1.0) < 1e-9, 'Lcrl at first point')
    # 평탄 시작 단조 증가: 내부 극소·경계 삽입 모두 없음 → monotone, 곡선 최소값 채택
    curve2 = _dsm_curve([(1, 2.0), (2, 2.0), (3, 3.0), (4, 4.0), (5, 5.0)])
    r2 = extract_dsm_values(curve2, node, elem, fy=50.0, load_type='P')
    ok &= check(r2['classification'] == 'monotone', 'monotone label')
    ok &= check(abs(r2['Lcrl'] - 1.0) < 1e-9, 'monotone takes curve minimum')
    return ok


def test_h3_3_applicability_limits():
    """H3-3 적용한계 §H3(c): 위반 시 경고, 준수/미제공 시 조용 (원문 대조)"""
    print('\n=== TEST: H3-3 applicability limits ===')
    from design.interaction import combined_bending_web_crippling as h3
    ok = True
    r = h3(5.0, 10.0, 5.0, 100.0, web_config='nested_z',
           h_over_t=200.0, N_over_t=100.0, Fy_ksi=50.0, R_over_t=3.0)
    ok &= check('warnings' in r and any('h/t' in w for w in r['warnings']),
                'h/t>150 warns')
    r = h3(5.0, 10.0, 5.0, 100.0, web_config='nested_z',
           h_over_t=100.0, N_over_t=150.0, Fy_ksi=80.0, R_over_t=6.0)
    ok &= check(len(r.get('warnings', [])) == 3, 'N/t+Fy+R/t 3 violations')
    r = h3(5.0, 10.0, 5.0, 100.0, web_config='nested_z',
           h_over_t=100.0, N_over_t=100.0, Fy_ksi=50.0, R_over_t=3.0)
    ok &= check('warnings' not in r, 'within limits silent')
    r = h3(5.0, 10.0, 5.0, 100.0, web_config='nested_z')
    ok &= check('warnings' not in r, 'unprovided silent')
    r = h3(5.0, 10.0, 5.0, 100.0, web_config='single', h_over_t=999.0)
    ok &= check('warnings' not in r, 'limits apply to H3-3 only')
    return ok


def test_section_keys_validation():
    """형상 추론 키 검증: 비숫자/음수 경고 (P2)"""
    print('\n=== TEST: section keys validation ===')
    from design.aisi_s100 import _validate_section_keys
    ok = True
    ok &= check(_validate_section_keys({}) == [], 'empty -> no warnings')
    w = _validate_section_keys({'section': {'web_count': 'abc'}})
    ok &= check(len(w) == 1 and 'web_count' in w[0], 'non-numeric web_count warns')
    w = _validate_section_keys({'section': {'web_count': 0}})
    ok &= check(len(w) == 1, 'zero web_count warns')
    w = _validate_section_keys({'wc_n_webs': 'x'})
    ok &= check(len(w) == 1 and 'wc_n_webs' in w[0], 'non-numeric wc_n_webs warns')
    w = _validate_section_keys({'section': {'web_count': 4}, 'wc_n_webs': 2})
    ok &= check(w == [], 'valid keys silent')
    return ok


def test_msort_stresgen_guards():
    """msort/stresgen 입력 가드 (P2 이식 경계)"""
    print('\n=== TEST: msort/stresgen guards ===')
    import numpy as np
    from engine.helpers import msort
    from engine.stress import stresgen
    ok = True
    ok &= check(msort(None) == [], 'msort None -> []')
    r = msort([[3, 1, 0, 1, float('nan'), float('inf')]])
    ok &= check(list(r[0]) == [1.0, 3.0], 'msort drops 0/dup/NaN/inf + sorts')
    try:
        stresgen(np.zeros((2, 5)), 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1)
        ok &= check(False, 'stresgen bad shape raises')
    except ValueError:
        ok &= check(True, 'stresgen bad shape raises ValueError')
    n = stresgen(np.zeros((2, 8)), 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1)
    ok &= check(n.shape == (2, 8), 'stresgen valid shape passes')
    return ok


if __name__ == '__main__':
    fns = sorted(n for n, f in globals().items()
                 if n.startswith('test_') and callable(f))
    results = []
    for n in fns:
        try:
            results.append((n, globals()[n]()))
        except Exception as e:  # noqa: BLE001 — test runner reports, never hides
            FAIL += 1
            print(f'  *** FAIL ***: {n} raised {type(e).__name__}: {e}')
            results.append((n, False))
    print(f'\n0926 regression: {PASS} checks passed, {FAIL} failed, '
          f'{sum(1 for _, v in results if v)}/{len(results)} tests green')
    sys.exit(1 if FAIL else 0)
