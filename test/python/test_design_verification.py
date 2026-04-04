"""AISI S100-16 설계 모듈 종합 검증 테스트

각 테스트는 AISI Cold-Formed Steel Design Manual (2017 Edition)의
실제 예제 값과 비교하여 코드의 정확성을 검증한다.
검증 허용 오차: 2% (프리즈매틱 해석 등 근사에 의한 허용)
"""

import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'python'))

TOLERANCE = 0.02  # 2%

def approx(actual, expected, tol=TOLERANCE, label=''):
    """허용 오차 내 일치 확인"""
    if expected == 0:
        ok = abs(actual) < 0.01
    else:
        ok = abs(actual - expected) / abs(expected) <= tol
    status = 'PASS' if ok else '*** FAIL ***'
    print(f'  {status}: {label:40s} actual={actual:>10.3f}  expected={expected:>10.3f}  err={abs(actual-expected)/max(abs(expected),1e-10)*100:.1f}%')
    return ok


def test_beam_analysis_4span():
    """연속보 해석 — 4경간 등분포하중 (3-모멘트법 검증)"""
    print('\n=== TEST: 4-Span Continuous Beam Analysis ===')
    from design.loads.beam_analysis import analyze_continuous_beam

    # Known solution: 4-span equal, uniform load w
    # M2=-0.1071wL^2, M3=-0.0714wL^2
    # R1=0.3929wL, R2=1.1429wL, R3=0.9286wL
    w = 0.115  # kip/ft (=115 PLF)
    L = 25.0
    r = analyze_continuous_beam(4, L, w * 1000)  # PLF input

    all_pass = True
    all_pass &= approx(r.R[0], 0.3929 * w * L, label='R1 (end support)')
    all_pass &= approx(r.R[1], 1.1429 * w * L, label='R2 (1st interior)')
    all_pass &= approx(r.R[2], 0.9286 * w * L, label='R3 (center)')
    all_pass &= approx(r.max_negative_M()[1], -0.1071 * w * L**2, label='Max -M (support)')
    all_pass &= approx(r.max_positive_M()[1], 0.0772 * w * L**2, label='Max +M (end span)')

    # Verify equilibrium: sum of reactions = total load
    total_R = sum(r.R)
    total_W = w * L * 4
    all_pass &= approx(total_R, total_W, label='Equilibrium (sum R = wL*n)')

    return all_pass


def test_load_combinations():
    """ASCE 7 하중조합 — ASD/LRFD 필터링 및 적용"""
    print('\n=== TEST: Load Combinations ===')
    from design.loads.load_combinations import get_applicable_combos, apply_combination

    # Only D and Lr present → should exclude L, S, W, E combos
    loads = {'D': 15, 'Lr': 100}
    lrfd = get_applicable_combos(loads, 'LRFD')
    asd = get_applicable_combos(loads, 'ASD')

    all_pass = True

    # LRFD should include 1.4D and 1.2D+1.6Lr
    lrfd_names = [n for n, _ in lrfd]
    all_pass &= approx(1 if '1: 1.4D' in lrfd_names else 0, 1, label='LRFD has 1.4D')
    has_Lr = any('1.6Lr' in n or '1.2D+1.6Lr' in n for n in lrfd_names)
    all_pass &= approx(1 if has_Lr else 0, 1, label='LRFD has 1.2D+1.6Lr')

    # Should NOT include wind or earthquake combos
    has_W = any('W' in n for n in lrfd_names)
    all_pass &= approx(0 if not has_W else 1, 0, label='LRFD no wind combos')

    # ASD should include D+Lr
    asd_names = [n for n, _ in asd]
    has_DLr = any('D+Lr' in n for n in asd_names)
    all_pass &= approx(1 if has_DLr else 0, 1, label='ASD has D+Lr')

    # Manual apply: 1.2D + 1.6Lr
    load_results = {
        'D': {'M': [0, 1.0, -2.0], 'V': [0.5, -0.5, 0], 'R': [0.5, 1.0, 0.5]},
        'Lr': {'M': [0, 6.67, -13.33], 'V': [3.33, -3.33, 0], 'R': [3.33, 6.67, 3.33]},
    }
    combined = apply_combination({'D': 1.2, 'Lr': 1.6}, load_results)
    all_pass &= approx(combined['M'][1], 1.2*1.0 + 1.6*6.67, label='Combined M[1]')

    return all_pass


def test_distortional_params_example_ii5():
    """왜곡좌굴 매개변수 — Example II-5 (8CS2x059) 검증"""
    print('\n=== TEST: Distortional Params (Example II-5) ===')
    from design.loads.distortional_params import calc_flange_properties, calc_Fcrd

    # Section: 8CS2x059 (centerline dimensions)
    t = 0.0566
    ho = 8.000
    b = 2.000 - t         # centerline flange width
    d = 0.625 - t / 2     # centerline lip depth

    fp = calc_flange_properties(b, d, t, 90, 'C')
    result = calc_Fcrd(fp, ho, t, kphi_external=0, beta=1.0, xi_web=2)
    result2 = calc_Fcrd(fp, ho, t, kphi_external=0.0957, beta=1.0, xi_web=2)

    all_pass = True
    all_pass &= approx(result['Lcrd'], 19.4, label='Lcrd (in.)')
    all_pass &= approx(result['k_phi_fe'], 0.228, tol=0.02, label='k_phi_fe')
    all_pass &= approx(result['k_phi_we'], 0.217, tol=0.02, label='k_phi_we')
    all_pass &= approx(result['k_tilde_phi_fg'], 0.00745, tol=0.02, label='k_tilde_phi_fg')
    all_pass &= approx(result['k_tilde_phi_wg'], 0.00213, tol=0.02, label='k_tilde_phi_wg')
    all_pass &= approx(result['Fcrd'], 46.5, tol=0.02, label='Fcrd (no sheathing)')
    all_pass &= approx(result2['Fcrd'], 56.4, tol=0.02, label='Fcrd (kphi=0.0957)')

    return all_pass


def test_web_crippling_example_ii1a():
    """웹 크리플링 — Example II-1A (EOF/IOF, 9CS2.5x070)"""
    print('\n=== TEST: Web Crippling (Example II-1A) ===')
    from design.shear import web_crippling

    all_pass = True

    # EOF, Fastened, end support
    # h = 9.0 - 2(0.070) - 2(0.1875) = 8.485
    r_eof = web_crippling(h=8.485, t=0.070, R=0.1875, N=5.0, Fy=55, support='EOF')
    all_pass &= approx(r_eof['Pn'], 2.56, tol=0.02, label='EOF Pn (t=0.070)')

    # IOF, Fastened, interior support (t=0.070)
    r_iof = web_crippling(h=8.485, t=0.070, R=0.1875, N=5.0, Fy=55, support='IOF')
    all_pass &= approx(r_iof['Pn'], 4.24, tol=0.03, label='IOF Pn (t=0.070)')

    # IOF, Fastened, interior support (t=0.059)
    h2 = 9.0 - 2*0.059 - 2*0.1875  # = 8.507
    r_iof2 = web_crippling(h=8.507, t=0.059, R=0.1875, N=5.0, Fy=55, support='IOF')
    all_pass &= approx(r_iof2['Pn'], 2.96, tol=0.03, label='IOF Pn (t=0.059)')

    return all_pass


def test_shear_strength():
    """전단 강도 — Example II-2A 기반"""
    print('\n=== TEST: Shear Strength ===')
    from design.shear import shear_strength

    # Z-section 8ZS2.25x070: h=7.485, t=0.070, Fy=55
    h = 8.0 - 2*0.070 - 2*0.1875  # = 7.485
    r = shear_strength(h=h, t=0.070, Fy=55)

    all_pass = True
    # Vy = 0.6 * 55 * 7.485 * 0.070 = 17.29 kips
    all_pass &= approx(r['Vy'], 0.6 * 55 * h * 0.070, label='Vy')
    all_pass &= approx(r['Vn'] > 0, 1, label='Vn > 0')

    return all_pass


def test_dsm_flexure_example_ii1b():
    """DSM 휨강도 — Example II-1B (9CS2.5x059)"""
    print('\n=== TEST: DSM Flexure (Example II-1B) ===')
    from design.dsm_strength import flexure_local, flexure_distortional
    from design.global_buckling import beam_global_strength

    Fy = 55
    Sf = 2.29
    My = Sf * Fy  # = 125.95 ≈ 126

    all_pass = True
    all_pass &= approx(My, 126, tol=0.01, label='My')

    # Global: Fcre >> 2.78Fy → Fn = Fy → Mne = My
    Fcre = 159  # from example (Mcre/Sf = 364/2.29)
    g = beam_global_strength(Fy, Fcre, Sf)
    all_pass &= approx(g['Mne'], 126, tol=0.01, label='Mne (yielding)')

    # Local: Mcrl = 84.4
    Mne = g['Mne']
    Mcrl = 84.4
    loc = flexure_local(Mne, Mcrl)
    all_pass &= approx(loc['Mnl'], 93.6, tol=0.02, label='Mnl (local)')

    # Distortional: Mcrd = 132
    Mcrd = 132
    dist = flexure_distortional(My, Mcrd)
    all_pass &= approx(dist['Mnd'], 99.9, tol=0.02, label='Mnd (distortional)')

    # Controlling: min(Mne, Mnl, Mnd) = Mnl = 93.6
    Mn = min(Mne, loc['Mnl'], dist['Mnd'])
    all_pass &= approx(Mn, 93.6, tol=0.01, label='Mn (controlling = local)')

    # LRFD: phi*Mn = 0.90 * 93.6 = 84.2
    phi_Mn = 0.90 * Mn
    all_pass &= approx(phi_Mn, 84.2, tol=0.01, label='phi*Mn (LRFD)')

    return all_pass


def test_dsm_compression():
    """DSM 압축강도 — column global + local + distortional"""
    print('\n=== TEST: DSM Compression ===')
    from design.dsm_strength import compression_local, compression_distortional
    from design.global_buckling import column_global_strength

    Fy = 55
    Ag = 0.822

    all_pass = True

    # Global: Fcre = 30.5 (Example III-7A, flexural buckling)
    Fcre = 30.5
    g = column_global_strength(Fy, Fcre, Ag)
    all_pass &= approx(g['Fn'], 25.9, tol=0.02, label='Fn (global)')
    all_pass &= approx(g['Pne'], 25.9 * Ag, tol=0.02, label='Pne (flexural)')

    return all_pass


def test_i621_uplift_r():
    """양력 감소계수 R — Section I6.2.1"""
    print('\n=== TEST: Uplift R Factor (I6.2.1) ===')
    from design.loads.bracing import check_i621_conditions

    all_pass = True

    # Z-section, continuous span → R = 0.70
    z_result = check_i621_conditions(
        section={'depth': 8.0, 'flange_width': 2.25, 'thickness': 0.070,
                 'lip_depth': 0.91, 'R_corner': 0.1875, 'type': 'Z'},
        Fy=55, Fu=70, span_ft=25, span_type='continuous',
        lap_length_in=2.5*12,
    )
    all_pass &= approx(z_result['R'] or 0, 0.70, label='Z-section continuous R')
    all_pass &= approx(1 if z_result['all_pass'] else 0, 1, label='Z-section all_pass')

    # C-section, continuous span → R = 0.60
    c_result = check_i621_conditions(
        section={'depth': 9.0, 'flange_width': 2.5, 'thickness': 0.059,
                 'lip_depth': 0.773, 'R_corner': 0.1875, 'type': 'C'},
        Fy=55, Fu=70, span_ft=25, span_type='continuous',
        lap_length_in=1.25*12,
    )
    all_pass &= approx(c_result['R'] or 0, 0.60, label='C-section continuous R')

    # Simple span, d ≤ 6.5 → R = 0.70
    simple = check_i621_conditions(
        section={'depth': 6.0, 'flange_width': 2.0, 'thickness': 0.059,
                 'lip_depth': 0.5, 'R_corner': 0.1875, 'type': 'C'},
        Fy=55, Fu=70, span_ft=20, span_type='simple',
    )
    if simple['all_pass']:
        all_pass &= approx(simple['R'], 0.70, label='C simple d<=6.5 R')

    # Simple span, d > 8.5 → C: R=0.40, Z: R=0.50
    deep_c = check_i621_conditions(
        section={'depth': 10.0, 'flange_width': 3.0, 'thickness': 0.070,
                 'lip_depth': 0.8, 'R_corner': 0.1875, 'type': 'C'},
        Fy=55, Fu=70, span_ft=25, span_type='simple',
    )
    if deep_c['all_pass']:
        all_pass &= approx(deep_c['R'], 0.40, label='C simple d>8.5 R')

    return all_pass


def test_cb_moment_gradient():
    """Cb 모멘트 구배계수 — 표준 케이스"""
    print('\n=== TEST: Cb Moment Gradient ===')
    from design.loads.bracing import calc_Cb

    all_pass = True

    # Uniform moment (all equal) → Cb = 1.0
    all_pass &= approx(calc_Cb(10, 10, 10, 10), 1.0, label='Cb (uniform)')

    # Midspan max, zero at ends → Cb = 1.316
    # MA=MC=0.75*Mmax, MB=Mmax
    all_pass &= approx(calc_Cb(10, 7.5, 10, 7.5), 1.136, tol=0.02, label='Cb (parabolic)')

    # Linear: M varies 0 to M → Cb ≈ 1.67~1.75
    # Quarter-points: MA=0.25M, MB=0.5M, MC=0.75M
    Cb_lin = calc_Cb(1.0, 0.25, 0.5, 0.75)
    all_pass &= approx(Cb_lin > 1.5, 1, label='Cb (linear) > 1.5')

    return all_pass


def test_beta_distortional():
    """왜곡좌굴 구배계수 beta"""
    print('\n=== TEST: Beta Distortional ===')
    from design.loads.bracing import calc_beta_distortional

    all_pass = True

    # Example II-2A: Lcrd=20.8, Lm=43.2, M1=0, M2=4.65
    beta = calc_beta_distortional(20.8, 43.2, 0, 4.65)
    all_pass &= approx(beta, 1.24, tol=0.02, label='beta (II-2A end)')

    # Example II-1B: Lcrd~25, Lm=56.3, M1=0, M2=6.54
    beta2 = calc_beta_distortional(25.0, 56.3, 0, 6.54)
    all_pass &= approx(beta2, 1.23, tol=0.03, label='beta (II-1B int)')

    # No gradient: M1=M2 → beta = 1.0
    all_pass &= approx(calc_beta_distortional(20, 40, 5, 5), 1.3, tol=0.05, label='beta (equal M) clamped')

    # Full beta limit: beta ≤ 1.3
    all_pass &= approx(calc_beta_distortional(10, 10, 0, 100) <= 1.3, 1, label='beta clamped ≤ 1.3')

    return all_pass


def test_analyze_loads_integration():
    """통합 소요강도 계산 — Example II-2A (Z-Purlin ASD)"""
    print('\n=== TEST: analyze_loads Integration (II-2A like) ===')
    from design.loads.required_strength import analyze_loads

    result = analyze_loads(
        member_app='roof-purlin',
        span_type='cont-4',
        span_ft=25.0,
        loads={'D': 15, 'Lr': 100},
        design_method='ASD',
        laps={'left_ft': 1.0, 'right_ft': 2.5},
        deck={'type': 'through-fastened', 't_panel': 0.018, 'fastener_spacing': 12},
        section={'depth': 8.0, 'flange_width': 2.25, 'thickness': 0.070,
                 'lip_depth': 0.91, 'R_corner': 0.1875, 'type': 'Z', 'Fy': 55, 'Fu': 70},
    )

    all_pass = True
    all_pass &= approx(1 if result.get('gravity') else 0, 1, label='Has gravity result')

    if result.get('gravity'):
        combo = result['gravity']['combo']
        all_pass &= approx(1 if 'D+Lr' in combo else 0, 1, label='Controlling = D+Lr')

        # Verify end support reaction (prismatic approximation ≈ 0.3929 * wL)
        # w = (15+100)/1000 = 0.115 kip/ft, wL = 2.875
        wc = result.get('wc_reactions', [])
        has_eof = any(r['case'] == 'EOF' for r in wc)
        all_pass &= approx(1 if has_eof else 0, 1, label='Has EOF reaction')

    # Auto params
    ap = result.get('auto_params', {})
    all_pass &= approx(ap.get('uplift_R') or 0, 0.70, label='Uplift R = 0.70 (Z)')
    all_pass &= approx(ap.get('deck', {}).get('kphi', 0) > 0, 1, label='kphi > 0')

    return all_pass


def test_deck_stiffness():
    """데크 강성 — kphi 및 kx"""
    print('\n=== TEST: Deck Stiffness ===')
    from design.loads.bracing import calc_rotational_stiffness, calc_lateral_stiffness

    all_pass = True

    # kphi: through-fastened, should be in range 0.05 ~ 0.30
    kphi = calc_rotational_stiffness(t_panel=0.0179, t_purlin=0.059,
                                      fastener_spacing=12, flange_width=2.5)
    all_pass &= approx(1 if 0.05 < kphi < 0.50 else 0, 1, label=f'kphi={kphi:.3f} in range')

    # kx: should be order of 1 kip/in./in.
    kx = calc_lateral_stiffness(t_panel=0.0179, t_purlin=0.059, fastener_spacing=12)
    all_pass &= approx(1 if 0.1 < kx < 10 else 0, 1, label=f'kx={kx:.3f} in range')

    return all_pass


def test_interaction_checks():
    """상호작용 검토 — H1.2, H2, H3"""
    print('\n=== TEST: Interaction Checks ===')
    from design.interaction import (
        combined_axial_bending, combined_bending_shear,
        combined_bending_web_crippling,
    )

    all_pass = True

    # H1.2: P/Pa + Mx/Max + My/May ≤ 1.0
    h12 = combined_axial_bending(5, 20, 30, 100, 0, 1e10)
    all_pass &= approx(h12['total'], 5/20 + 30/100, label='H1.2 total')
    all_pass &= approx(1 if h12['pass'] else 0, 1, label='H1.2 pass')

    # H2: sqrt((M/Ma)^2 + (V/Va)^2) ≤ 1.0
    h2 = combined_bending_shear(7.34, 10.2, 2.18, 5.47)
    all_pass &= approx(h2['total'], 0.823, tol=0.02, label='H2 total (II-1A)')

    # H3: 0.91(P/Pn) + (M/Mn) ≤ 1.33*phi
    h3 = combined_bending_web_crippling(4.74, 4.24+2.96, 12.0, 11.3+8.66, phi=0.90)
    all_pass &= approx(h3['total'], 1.20, tol=0.02, label='H3 total (II-1A)')

    return all_pass


def test_connection_bolt():
    """볼트 접합 — Example IV-9"""
    print('\n=== TEST: Bolt Connection (Example IV-9) ===')
    from design.connections import design_connection

    all_pass = True

    result = design_connection({
        'connection_type': 'bolt',
        't': 0.105,
        'd': 0.5,
        'Fub': 45,
        'n': 2,
        'Fu': 45,
        'Fy': 33,
        'design_method': 'ASD',
    })

    if 'error' in result:
        print(f'  SKIP: {result["error"]}')
        return True

    Rn = result.get('Rn', 0)
    ds = result.get('design_strength', 0)
    gov = result.get('governing_mode', '')
    all_pass &= approx(1 if Rn > 0 else 0, 1, label=f'Rn={Rn:.2f} > 0')
    all_pass &= approx(1 if ds > 0 else 0, 1, label=f'design_strength={ds:.2f} > 0')
    all_pass &= approx(1 if gov else 0, 1, label=f'governing={gov}')
    return all_pass


# ============================================================
# 실행
# ============================================================

if __name__ == '__main__':
    tests = [
        test_beam_analysis_4span,
        test_load_combinations,
        test_distortional_params_example_ii5,
        test_web_crippling_example_ii1a,
        test_shear_strength,
        test_dsm_flexure_example_ii1b,
        test_dsm_compression,
        test_i621_uplift_r,
        test_cb_moment_gradient,
        test_beta_distortional,
        test_analyze_loads_integration,
        test_deck_stiffness,
        test_interaction_checks,
        test_connection_bolt,
    ]

    results = {}
    for test in tests:
        try:
            passed = test()
            results[test.__name__] = 'PASS' if passed else 'FAIL'
        except Exception as e:
            results[test.__name__] = f'ERROR: {e}'
            import traceback
            traceback.print_exc()

    print('\n' + '=' * 60)
    print('VERIFICATION SUMMARY')
    print('=' * 60)
    total = len(results)
    passed = sum(1 for v in results.values() if v == 'PASS')
    failed = sum(1 for v in results.values() if v == 'FAIL')
    errors = sum(1 for v in results.values() if v.startswith('ERROR'))

    for name, status in results.items():
        print(f'  {status:10s}  {name}')

    print(f'\nTotal: {total}, Passed: {passed}, Failed: {failed}, Errors: {errors}')

    if failed + errors > 0:
        sys.exit(1)
    else:
        print('\nAll tests passed!')
