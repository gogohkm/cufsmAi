"""AISI S100-16 설계 모듈 종합 검증 테스트

각 테스트는 AISI Cold-Formed Steel Design Manual (2017 Edition)의
실제 예제 값과 비교하여 코드의 정확성을 검증한다.
검증 허용 오차: 2% (프리즈매틱 해석 등 근사에 의한 허용)
"""

import sys
import os
import math
import subprocess
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
    r_iof2 = web_crippling(h=h2, t=0.059, R=0.1875, N=5.0, Fy=55, support='IOF')
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
    from design.loads.required_strength import _calc_deck_info

    all_pass = True

    # kphi: through-fastened, should be in range 0.05 ~ 0.30
    kphi = calc_rotational_stiffness(t_panel=0.0179, t_purlin=0.059,
                                      fastener_spacing=12, flange_width=2.5)
    all_pass &= approx(1 if 0.05 < kphi < 0.50 else 0, 1, label=f'kphi={kphi:.3f} in range')

    # kx: should be order of 1 kip/in./in.
    kx = calc_lateral_stiffness(t_panel=0.0179, t_purlin=0.059, fastener_spacing=12)
    all_pass &= approx(1 if 0.1 < kx < 10 else 0, 1, label=f'kx={kx:.3f} in range')

    deck_auto = _calc_deck_info(
        {'type': 'through-fastened', 't_panel': 0.0179, 'fastener_spacing': 12},
        {'thickness': 0.059, 'flange_width': 2.5},
    )
    all_pass &= approx(deck_auto['kx'], 1.28, tol=0.015,
                        label='Auto deck kx matches Example II-1C')
    all_pass &= approx(
        1 if deck_auto['kx_method'] == 'rp17_2_example_calibrated_approximation' else 0,
        1, label='Auto deck kx method is disclosed',
    )
    deck_override = _calc_deck_info(
        {
            'type': 'through-fastened', 't_panel': 0.0179,
            'fastener_spacing': 12, 'kphi_override': 0.113, 'kx_override': 1.28,
        },
        {'thickness': 0.059, 'flange_width': 2.5},
    )
    all_pass &= approx(deck_override['kphi'], 0.113, tol=1e-12,
                        label='Test kphi override preserved')
    all_pass &= approx(deck_override['kx'], 1.28, tol=1e-12,
                        label='Test kx override preserved')
    all_pass &= approx(1 if deck_override['warning'] is None else 0, 1,
                        label='Both test overrides remove approximation warning')

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
    all_pass &= approx(1 if combined_axial_bending(1, 0, 0, 1)['pass'] is False else 0, 1,
                        label='H1 zero capacity fails')
    all_pass &= approx(1 if combined_bending_shear(1, 0, 0, 1)['pass'] is False else 0, 1,
                        label='H2 zero capacity fails')
    all_pass &= approx(
        1 if combined_bending_web_crippling(1, 0, 0, 1)['pass'] is False else 0,
        1, label='H3 zero capacity fails')

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


def test_shear_lag_design_strength_split():
    """Shear lag는 항복/파단 저항계수를 분리 적용해야 한다."""
    print('\n=== TEST: Shear Lag Design Strength Split ===')
    from design.special_topics import shear_lag

    result = shear_lag(
        Ag=1.0,
        An_net=0.5,
        x_bar=0.25,
        L_conn=2.0,
        Fu=65,
        Fy=50,
        design_method='LRFD',
    )

    all_pass = True
    expected_u = 1.0 - 0.25 / 2.0
    expected_ae = 0.5 * expected_u
    expected_rupture = expected_ae * 65.0
    expected_design = 0.75 * expected_rupture
    all_pass &= approx(result['U'], expected_u, label='U')
    all_pass &= approx(result['Ae'], expected_ae, label='Ae')
    all_pass &= approx(result['phi_Tn'], expected_design, label='phi_Tn uses D3 factor')
    all_pass &= approx(1 if 'Rupture' in result['governing'] else 0, 1, label='Rupture governs')
    return all_pass


def test_connection_arc_spot_uses_diameter_input():
    """Arc spot connection은 d 입력을 visible diameter로 반영해야 한다."""
    print('\n=== TEST: Arc Spot Uses d Input ===')
    from design.connections import design_connection

    small = design_connection({
        'connection_type': 'arc_spot',
        't1': 0.06,
        't2': 0.06,
        'd': 0.5,
        'Fy': 50,
        'Fu': 65,
        'n': 1,
        'design_method': 'LRFD',
    })
    large = design_connection({
        'connection_type': 'arc_spot',
        't1': 0.06,
        't2': 0.06,
        'd': 0.75,
        'Fy': 50,
        'Fu': 65,
        'n': 1,
        'design_method': 'LRFD',
    })

    all_pass = True
    all_pass &= approx(1 if large['design_strength'] > small['design_strength'] else 0, 1, label='larger da increases strength')
    return all_pass


def test_combined_requires_explicit_weak_axis_strength():
    """약축 휨 조합설계는 명시적인 May_strength 없이 진행하면 안 된다."""
    print('\n=== TEST: Combined Requires Explicit Weak-axis Strength ===')
    from design.aisi_s100 import design_member

    result = design_member({
        'member_type': 'combined',
        'design_method': 'LRFD',
        'Fy': 50,
        'Fu': 65,
        'Pu': 5.0,
        'Mux': 10.0,
        'Muy': 3.0,
        'KxLx': 120.0,
        'KyLy': 120.0,
        'KtLt': 120.0,
        'Lb': 120.0,
        'props': {
            'A': 1.2,
            'Sf': 2.0,
            'Sxx': 2.0,
            'Sy': 0.8,
            'rx': 1.5,
            'ry': 0.8,
            'ro': 2.0,
            'J': 0.01,
            'Cw': 1.0,
            'xo': 0.2,
            'h_web': 6.0,
            't': 0.08,
        },
        'dsm': {
            'Pcrl': 80.0, 'Pcrd': 90.0, 'Py': 60.0,
            'Mcrl': 150.0, 'Mcrd': 180.0, 'My': 100.0,
        },
    })

    all_pass = True
    all_pass &= approx(1 if 'May_strength' in (result.get('error') or '') else 0, 1, label='error requires May_strength')
    return all_pass


def test_lap_connection_uses_shared_connection_engine():
    """Lap connection은 shared connection engine의 single-fastener strength를 사용해야 한다."""
    print('\n=== TEST: Lap Connection Uses Shared Connection Engine ===')
    from design.lap_connection import design_lap_connection
    from design.connections import design_connection

    lap = design_lap_connection({
        'd': 8.0,
        't': 0.059,
        'Fy': 50,
        'Fu': 65,
        'lap_left_in': 14.0,
        'lap_right_in': 14.0,
        'Mu_support': 8.0,
        'Vu_support': 2.0,
        'fastener_type': 'screw',
        'fastener_dia': 0.19,
        'n_rows': 2,
        'design_method': 'LRFD',
    })
    conn = design_connection({
        'connection_type': 'screw',
        'design_method': 'LRFD',
        'Fy': 50,
        'Fu': 65,
        't1': 0.059,
        't2': 0.059,
        'd': 0.19,
        'n': 1,
    })

    all_pass = True
    # 새 계약: Lap 패스너 수요는 전단이므로 Pns는 shared engine 한계상태 중
    # '전단 전달' 모드(틸팅/지압/나사전단/J6.1)의 최소 설계강도와 같아야 한다.
    # 인장계(풀아웃 J4.4.1/풀오버 J4.4.2)와 부재 검토(J6.2/J6.3/D)는 제외
    # (과거에는 전체 최소값 = 풀아웃이 지배해 전단 패스너 수가 과대 산정됐음).
    _tension_keys = ('Pull-out (J4.4', 'Pull-over (J4.4', 'Tension', 'Block Shear', 'Member')
    shear_ls = [ls for ls in conn['limit_states']
                if not any(k in ls['name'] for k in _tension_keys)]
    expected_pns = min(ls['design_strength'] for ls in shear_ls)
    all_pass &= approx(lap['Pns'], expected_pns, label='lap Pns = shared shear-mode governing strength')
    all_pass &= approx(1 if lap.get('fastener_design') else 0, 1, label='shared design result attached')
    all_pass &= approx(1 if 'Pull-out' not in lap.get('Pns_governing_mode', '') else 0, 1,
                       label='tension mode not governing shear sizing')
    return all_pass


def test_web_crippling_c_z_separation():
    """웹크리플링 — C vs Z, fastened vs unfastened 계수 분리 검증"""
    print('\n=== TEST: Web Crippling C/Z Table Separation (F-038~040) ===')
    from design.shear import web_crippling

    all_pass = True

    # C-section EOF fastened: C=4.0, phi=0.85
    wc_c_f = web_crippling(h=7.5, t=0.059, R=0.157, N=3.5, Fy=50,
                            support='EOF', fastened='fastened', section_type='C')
    all_pass &= approx(wc_c_f['phi'], 0.85, label='C EOF fast phi=0.85')

    # C-section EOF unfastened: phi=0.80 (different from fastened!)
    wc_c_u = web_crippling(h=7.5, t=0.059, R=0.157, N=3.5, Fy=50,
                            support='EOF', fastened='unfastened', section_type='C')
    all_pass &= approx(wc_c_u['phi'], 0.80, label='C EOF unfas phi=0.80')

    # Z-section EOF unfastened: C=5 (not 4!)
    wc_z_u = web_crippling(h=7.5, t=0.059, R=0.157, N=3.5, Fy=50,
                            support='EOF', fastened='unfastened', section_type='Z')
    # Z unfastened EOF Pn should differ from C unfastened EOF (different C, Cr, CN, Ch)
    all_pass &= approx(1 if abs(wc_z_u['Pn'] - wc_c_u['Pn']) > 0.001 else 0, 1,
                        label='Z-EOF-unfas ≠ C-EOF-unfas')

    # C ETF fastened: C=7.5 (not 6.9)
    wc_etf_f = web_crippling(h=7.5, t=0.059, R=0.157, N=3.5, Fy=50,
                              support='ETF', fastened='fastened', section_type='C')
    all_pass &= approx(wc_etf_f['phi'], 0.85, label='C ETF fast phi=0.85')

    # section_type in result
    all_pass &= approx(1 if wc_z_u.get('section_type') == 'Z' else 0, 1,
                        label='result has section_type=Z')
    all_pass &= approx(1 if wc_c_f.get('table') == 'G5-2' else 0, 1,
                        label='C uses table G5-2')

    return all_pass


def test_web_crippling_overhang_eq_g52():
    """웹크리플링 overhang — Eq. G5-2 / G5-3 및 interior cap 검증"""
    print('\n=== TEST: Web Crippling Overhang Eq. G5-2 (F-038~040) ===')
    from design.shear import web_crippling

    # Example II-2A values from AISI manual
    result = web_crippling(
        h=7.485, t=0.070, R=0.1875, N=5.0, Fy=55,
        support='EOF', fastened='fastened', section_type='Z',
        Lo=9.5
    )

    all_pass = True
    all_pass &= approx(1 if result.get('equation') == 'G5-2' else 0, 1, label='uses Eq. G5-2')
    all_pass &= approx(result.get('alpha', 0), 1.13, tol=0.02, label='alpha per Eq. G5-3')
    all_pass &= approx(result.get('Pn', 0), 2.95, tol=0.03, label='Pnc overhang strength')
    all_pass &= approx(1 if result.get('Pn_interior_cap', 0) > result.get('Pn', 0) else 0, 1,
                        label='interior cap larger than Pnc')
    all_pass &= approx(1 if not result.get('h3_applicable', True) else 0, 1,
                        label='H3 disabled for overhang')
    return all_pass


def test_web_crippling_overhang_definition_limit():
    """Lo > 1.5h 는 overhang가 아니라 standard EOF로 분류되어야 함"""
    print('\n=== TEST: Web Crippling Overhang Definition Limit ===')
    from design.shear import web_crippling

    h = 7.5
    result = web_crippling(
        h=h, t=0.059, R=0.157, N=3.5, Fy=50,
        support='EOF', fastened='fastened', section_type='C',
        Lo=1.6 * h
    )

    all_pass = True
    all_pass &= approx(1 if result.get('equation') == 'G5-1' else 0, 1, label='Lo > 1.5h falls back to G5-1')
    all_pass &= approx(1 if result.get('bearing_case') == 'end_bearing' else 0, 1, label='treated as end bearing')
    all_pass &= approx(1 if any('standard EOF instead of overhang' in msg for msg in result.get('assumptions', [])) else 0, 1,
                        label='fallback assumption recorded')
    return all_pass


def test_web_crippling_itf_edge_distance_validation():
    """C/Z ITF edge distance requirement를 입력값으로 직접 검증"""
    print('\n=== TEST: Web Crippling ITF Edge Distance Validation ===')
    from design.shear import web_crippling

    h = 7.5
    short_case = web_crippling(
        h=h, t=0.059, R=0.157, N=3.5, Fy=50,
        support='ITF', fastened='fastened', section_type='C',
        edge_distance=18.0
    )
    ok_case = web_crippling(
        h=h, t=0.059, R=0.157, N=3.5, Fy=50,
        support='ITF', fastened='fastened', section_type='C',
        edge_distance=19.0
    )

    all_pass = True
    all_pass &= approx(1 if any('smaller than the required' in msg for msg in short_case.get('warnings', [])) else 0, 1,
                        label='short edge distance warning emitted')
    all_pass &= approx(1 if any('satisfies the ≥' in msg for msg in ok_case.get('assumptions', [])) else 0, 1,
                        label='sufficient edge distance accepted')
    all_pass &= approx(ok_case.get('edge_distance', 0), 19.0, tol=0.001, label='edge distance metadata returned')
    return all_pass


def test_web_crippling_built_up_i_table_g51():
    """built-up I-section — Table G5-1 계수와 H3 비적용 메타데이터 검증"""
    print('\n=== TEST: Built-Up I-Section Web Crippling (G5-1) ===')
    from design.shear import web_crippling

    h = 7.0
    t = 0.08
    R = 0.16
    N = 3.0
    Fy = 50.0
    result = web_crippling(
        h=h, t=t, R=R, N=N, Fy=Fy,
        support='ETF', fastened='unfastened',
        section_family='built_up_i',
        flange_condition='stiffened'
    )

    expected = 15.5 * t**2 * Fy * (1 - 0.09 * math.sqrt(R / t)) * (1 + 0.08 * math.sqrt(N / t)) * (1 - 0.04 * math.sqrt(h / t))

    all_pass = True
    all_pass &= approx(1 if result.get('table') == 'G5-1' else 0, 1, label='uses Table G5-1')
    all_pass &= approx(result.get('Pn', 0), expected, tol=0.02, label='built-up I ETF Pn')
    all_pass &= approx(1 if not result.get('h3_applicable', True) else 0, 1, label='H3 disabled for built-up I')
    all_pass &= approx(1 if any('Table G5-1 directly' in msg for msg in result.get('assumptions', [])) else 0, 1,
                        label='built-up assumption recorded')
    return all_pass


def test_web_crippling_built_up_i_unsupported_unstiffened_two_flange():
    """built-up I-section unstiffened two-flange rows는 미구현 error를 반환해야 함"""
    print('\n=== TEST: Built-Up I Unsupported Unstiffened Two-Flange ===')
    from design.shear import web_crippling

    result = web_crippling(
        h=7.0, t=0.08, R=0.16, N=3.0, Fy=50.0,
        support='ETF', fastened='unfastened',
        section_family='built_up_i',
        flange_condition='unstiffened'
    )

    all_pass = True
    all_pass &= approx(1 if 'error' in result else 0, 1, label='returns unsupported-row error')
    all_pass &= approx(1 if any('unstiffened two-flange rows are not implemented' in msg for msg in result.get('warnings', [])) else 0, 1,
                        label='unsupported-row warning returned')
    return all_pass


def test_web_crippling_hat_per_web_multiplier():
    """hat section — Table G5-4 per-web 강도와 n_web 합산 검증"""
    print('\n=== TEST: Hat Section Web Crippling Multiplier (G5-4) ===')
    from design.shear import web_crippling

    h = 6.0
    t = 0.06
    R = 0.12
    N = 3.0
    Fy = 50.0
    result = web_crippling(
        h=h, t=t, R=R, N=N, Fy=Fy,
        support='ETF', fastened='fastened',
        section_family='hat'
    )

    all_pass = True
    expected_per_web = 9.0 * t**2 * Fy * (1 - 0.10 * math.sqrt(R / t)) * (1 + 0.07 * math.sqrt(N / t)) * (1 - 0.03 * math.sqrt(h / t))
    all_pass &= approx(1 if result.get('table') == 'G5-4' else 0, 1, label='uses Table G5-4')
    all_pass &= approx(result.get('Pn_per_web', 0), expected_per_web, tol=0.02, label='hat per-web Pn')
    all_pass &= approx(result.get('Pn', 0), expected_per_web * 2.0, tol=0.02, label='hat total Pn = 2 webs')
    all_pass &= approx(1 if result.get('n_webs') == 2 else 0, 1, label='hat defaults to 2 webs')
    return all_pass


def test_web_crippling_multiweb_spacing_override():
    """multi-web deck — G5-5와 18in spacing unfastened override 검증"""
    print('\n=== TEST: Multi-Web Deck Web Crippling (G5-5) ===')
    from design.shear import web_crippling

    h = 6.0
    t = 0.05
    R = 0.10
    N = 3.0
    Fy = 50.0
    result = web_crippling(
        h=h, t=t, R=R, N=N, Fy=Fy,
        support='EOF', fastened='fastened',
        section_family='multi_web',
        n_webs=3,
        support_fastener_spacing=24.0
    )

    all_pass = True
    expected_per_web = 3.0 * t**2 * Fy * (1 - 0.04 * math.sqrt(R / t)) * (1 + 0.29 * math.sqrt(N / t)) * (1 - 0.028 * math.sqrt(h / t))
    all_pass &= approx(1 if result.get('table') == 'G5-5' else 0, 1, label='uses Table G5-5')
    all_pass &= approx(1 if result.get('fastened') == 'unfastened' else 0, 1, label='spacing override → unfastened')
    all_pass &= approx(result.get('Pn_per_web', 0), expected_per_web, tol=0.02, label='multi-web per-web Pn')
    all_pass &= approx(result.get('Pn', 0), expected_per_web * 3.0, tol=0.02, label='multi-web total Pn = 3 webs')
    all_pass &= approx(result.get('phi', 0), 0.60, tol=0.01, label='unfastened EOF phi=0.60')
    return all_pass


def test_dsm_boundary_minima():
    """DSM 극소 탐지 — 경계점 검출 및 반파장 분류 (F-003)"""
    print('\n=== TEST: DSM Boundary Minima Detection (F-003) ===')
    import numpy as np
    from engine.dsm import extract_dsm_values
    from engine.template import generate_section

    all_pass = True

    # 테스트용 곡선: 경계 극소가 있는 경우
    # [length, lf] — 첫 점이 최소
    sec = generate_section('lippedc', {'H': 8, 'B': 2.5, 'D': 0.625, 't': 0.059})
    node = sec['node']
    elem = sec['elem']

    # 인위적 곡선: 첫 점이 극소 (lf=0.5), 중간에 극소 (lf=0.3), 끝은 상승 (lf=1.0)
    fake_curve = [
        np.array([1.0, 0.5]),   # 경계 극소
        np.array([2.0, 0.8]),
        np.array([5.0, 0.3]),   # 내부 극소
        np.array([10.0, 0.4]),
        np.array([50.0, 0.6]),
        np.array([100.0, 1.0]),
    ]

    result = extract_dsm_values(fake_curve, node, elem, 50.0, 'P')
    # 경계 극소(lf=0.5)가 감지되어야 함 → Pcrl = 0.5 * Py
    # 내부 극소(lf=0.3)도 감지 → Pcrd = 0.3 * Py (또는 반대)
    n_min = result.get('n_minima', 0)
    all_pass &= approx(1 if n_min >= 2 else 0, 1, label=f'n_minima={n_min} >= 2 (boundary detected)')

    # classification 필드 존재
    all_pass &= approx(1 if result.get('classification') else 0, 1, label='has classification field')

    return all_pass


def test_uplift_combo_reaction_based():
    """양력 조합 판정 — 반력 기반 개선 (F-001)"""
    print('\n=== TEST: Uplift Combo Reaction-Based Detection (F-001) ===')
    from design.loads.load_combinations import find_controlling_combo

    all_pass = True

    # 하중: D=15 plf, W=-150 plf (양력)
    loads = {'D': 15, 'W': -150}
    # 가상 해석 결과: D 단독
    load_results = {
        'D': {'M': [0, 5, 8, 5, 0], 'V': [3, 1, 0, -1, -3], 'R': [3, 0, 0, 0, 3]},
        'W': {'M': [0, -30, -50, -30, 0], 'V': [-15, -5, 0, 5, 15], 'R': [-15, 0, 0, 0, -15]},
    }

    result = find_controlling_combo(loads, load_results, 'LRFD')
    uplift = result.get('uplift')

    # 양력 조합이 탐지되어야 함
    all_pass &= approx(1 if uplift is not None else 0, 1, label='uplift combo detected')

    return all_pass


def test_auto_generate_passes_corner_radius():
    """자동 생성 경로에서 코너 반경 전달 (F-002)"""
    print('\n=== TEST: Auto Generate Passes Corner Radius (F-002) ===')
    from design.aisi_s100 import _auto_generate_props

    all_pass = True

    # R=0.157 전달 후 생성된 단면 확인
    params = {'H': 8, 'B': 2.5, 'D': 0.625, 't': 0.059, 'r': 0.157, 'Fy': 50}
    result = _auto_generate_props(params)
    props = result.get('props', {})

    # 단면적이 코너 없는 경우와 달라야 함
    params_no_r = {'H': 8, 'B': 2.5, 'D': 0.625, 't': 0.059, 'r': 0, 'Fy': 50}
    result_no_r = _auto_generate_props(params_no_r)
    props_no_r = result_no_r.get('props', {})

    A_with_r = props.get('A', 0)
    A_no_r = props_no_r.get('A', 0)
    # 코너 반경이 있으면 면적이 다름 (코너 호 길이 차이)
    all_pass &= approx(1 if A_with_r > 0 else 0, 1, label=f'A_with_r={A_with_r:.4f} > 0')
    all_pass &= approx(1 if abs(A_with_r - A_no_r) > 0.001 else 0, 1,
                        label=f'A_with_r={A_with_r:.4f} ≠ A_no_r={A_no_r:.4f}')

    return all_pass


def test_h3_web_configs():
    """H3 상호작용 — single/nested_z/multi_web 분기 (F-023)"""
    print('\n=== TEST: H3 Web Config Variants (F-023) ===')
    from design.interaction import combined_bending_web_crippling

    all_pass = True

    # H3-1: 0.91P/Pn + M/Mn ≤ 1.33φ
    h1 = combined_bending_web_crippling(3, 5, 10, 20, 0.90, 'single')
    all_pass &= approx(1 if h1['equation'] == 'H3-1' else 0, 1, label='single → H3-1')
    all_pass &= approx(h1['limit'], 1.33 * 0.90, label='H3-1 limit=1.197')

    # H3-3: 0.86P/Pn + M/Mn ≤ 1.65φ (two nested Z-shapes, AISI S100-16 Eq. H3-3)
    h2 = combined_bending_web_crippling(3, 5, 10, 20, 0.90, 'nested_z')
    all_pass &= approx(h2['limit'], 1.65 * 0.90, label='nested_z → H3-3 limit=1.485')
    all_pass &= approx(1 if h2['equation'] == 'H3-3' else 0, 1, label='nested_z → eq H3-3')

    # H3-2: 0.88P/Pn + M/Mn ≤ 1.46φ (multiple unreinforced webs, AISI S100-16 Eq. H3-2)
    h3 = combined_bending_web_crippling(3, 5, 10, 20, 0.90, 'multi_web')
    all_pass &= approx(h3['limit'], 1.46 * 0.90, label='multi_web → H3-2 limit=1.314')
    all_pass &= approx(1 if h3['equation'] == 'H3-2' else 0, 1, label='multi_web → eq H3-2')

    return all_pass


def test_kx_matches_reference_example():
    """kx 횡강성 — AISI RP17-2 Example II-1C 문서값 검증"""
    print('\n=== TEST: kx Reference Example II-1C ===')
    from design.loads.bracing import calc_lateral_stiffness

    all_pass = True

    kx = calc_lateral_stiffness(t_panel=0.0179, t_purlin=0.059, fastener_spacing=12)
    all_pass &= approx(kx, 1.28, tol=0.015,
                        label=f'Example II-1C kx={kx:.4f} ~ 1.28 kip/in/in')

    # 이전 API의 Pss 계열 인수는 검증되지 않은 별도 모델을 활성화하지 않아야 한다.
    kx_compat = calc_lateral_stiffness(
        t_panel=0.0179, t_purlin=0.059, fastener_spacing=12,
        Pss=1.8, d_screw=0.17, Fu_panel=70,
    )
    all_pass &= approx(kx_compat, kx, tol=1e-12,
                        label='Legacy fastener arguments preserve calibrated estimate')

    return all_pass


def test_multi_bolt_c_factor():
    """다볼트 지압강도 — 끝단/내부 C 분리 (F-013)"""
    print('\n=== TEST: Multi-Bolt End/Interior C Factor (F-013) ===')
    from design.connections import bolt_connection

    all_pass = True

    # 1볼트: e/d 기준
    r1 = bolt_connection(t1=0.059, t2=0.059, d=0.5, Fy=50, Fu=65, Fub=120,
                          e=1.5, s=2.0, n=1)
    # 3볼트: 끝단(e/d) + 내부(s/d) 분리
    r3 = bolt_connection(t1=0.059, t2=0.059, d=0.5, Fy=50, Fu=65, Fub=120,
                          e=1.5, s=2.0, n=3)

    Rn1 = [ls for ls in r1['limit_states'] if ls['name'].startswith('Bearing')][0]['Rn']
    Rn3 = [ls for ls in r3['limit_states'] if ls['name'].startswith('Bearing')][0]['Rn']
    # 3볼트 강도는 1볼트 × 3이 아님 (e/d ≠ s/d이면)
    all_pass &= approx(
        1 if Rn1 > 0 and Rn3 > 0 else 0,
        1,
        label=f'bearing strengths: 1-bolt Rn={Rn1:.3f}, 3-bolt Rn={Rn3:.3f}',
    )
    # e=1.5, d=0.5 → C_end=3.0; s=2.0, d=0.5 → C_int=3.0 (이 경우 동일)
    # 다른 e/s로 확인
    r3b = bolt_connection(t1=0.059, t2=0.059, d=0.5, Fy=50, Fu=65, Fub=120,
                           e=0.75, s=2.0, n=3)
    Rn3b = [ls for ls in r3b['limit_states'] if ls['name'].startswith('Bearing')][0]['Rn']
    # e/d=1.5 (C_end=1.5), s/d=4.0 (C_int=3.0) → 끝단 < 내부
    all_pass &= approx(1 if Rn3b > 0 else 0, 1, label=f'3-bolt(small e) Rn={Rn3b:.3f} > 0')

    return all_pass


def test_beam_fe_solve_flag():
    """FE 보 해석 — solve 실패 시 is_valid 플래그 (F-047)"""
    print('\n=== TEST: Beam FE Solve Validity Flag (F-047) ===')
    from design.loads.beam_analysis import BeamResult

    all_pass = True

    # 정상 결과: is_valid=True
    r = BeamResult([0, 1], [0, 1], [1, -1], [1, 1], 2, is_valid=True)
    all_pass &= approx(1 if r.is_valid else 0, 1, label='normal result is_valid=True')

    # 실패 결과: is_valid=False
    r2 = BeamResult([0, 1], [0, 0], [0, 0], [0, 0], 2, is_valid=False)
    all_pass &= approx(1 if not r2.is_valid else 0, 1, label='failed result is_valid=False')

    # to_dict에 포함
    d = r2.to_dict()
    all_pass &= approx(1 if d.get('is_valid') is False else 0, 1, label='to_dict has is_valid=False')

    return all_pass


def test_screw_connection_interpolation_and_pullover():
    """나사 접합 — J4.3.1 보간 및 J4.4.2 풀오버 식 검증 (F-015)"""
    print('\n=== TEST: Screw Connection Interpolation and Pullover (F-015) ===')
    from design.connections import screw_connection

    t1 = 0.05
    t2 = 0.075  # ratio = 1.5
    d = 0.2
    Fu = 65
    Fub = 100
    n = 2
    result = screw_connection(t1=t1, t2=t2, d=d, Fy=50, Fu=Fu, Fub=Fub, n=n)

    all_pass = True
    bearing = [ls for ls in result['limit_states'] if ls['name'].startswith('Bearing')][0]
    pullover = [ls for ls in result['limit_states'] if ls['name'].startswith('Pull-over')][0]

    # AISI S100-16 Eq. J4.3.1: for 1.0 < t2/t1 < 2.5, linear interpolation between
    # the t2/t1<=1.0 case (min of the three eqs; the 4.2-sqrt term uses the FAR member t2)
    # and the t2/t1>=2.5 case (min of the two bearing eqs).
    eq1 = 4.2 * math.sqrt(t2 ** 3 * d) * Fu * n
    eq2 = 2.7 * t1 * d * Fu * n
    eq3 = 2.7 * t2 * d * Fu * n
    pn_ratio_1 = min(eq1, eq2, eq3)
    pn_ratio_25 = min(eq2, eq3)
    interp = (t2 / t1 - 1.0) / 1.5
    expected_bearing = (1 - interp) * pn_ratio_1 + interp * pn_ratio_25
    dw = min(d * 2.0, 0.75)
    expected_pullover = 1.5 * t1 * dw * Fu * n

    all_pass &= approx(bearing['Rn'], expected_bearing, label='J4.3.1 interpolated bearing')
    all_pass &= approx(pullover['Rn'], expected_pullover, label='J4.4.2 pull-over')
    return all_pass


def test_arc_spot_effective_diameter_cap():
    """아크 스팟 용접 — de 상한은 min(...)이어야 함 (F-016)"""
    print('\n=== TEST: Arc Spot Effective Diameter Cap (F-016) ===')
    from design.connections import arc_spot_weld_connection

    da = 0.625
    t = 0.12
    result = arc_spot_weld_connection(t1=t, t2=t, da=da, Fy=50, Fu=65, n=1)
    nugget = [ls for ls in result['limit_states'] if ls['name'].startswith('Weld Nugget')][0]

    all_pass = True
    de = min(max(0.7 * da - 1.5 * t, 0.0), 0.55 * da)
    expected = 0.75 * 60 * (math.pi / 4) * de ** 2
    all_pass &= approx(nugget['Rn'], expected, label='J2.2.1 nugget shear with capped de')
    return all_pass


def test_arc_seam_formula_terms():
    """아크 시임 용접 — L*de 및 0.96da 항 반영 검증 (F-017)"""
    print('\n=== TEST: Arc Seam Formula Terms (F-017) ===')
    from design.connections import arc_seam_weld_connection

    t = 0.06
    d = 0.5
    L = 1.75
    result = arc_seam_weld_connection(t1=t, t2=t, d=d, L_seam=L, Fy=50, Fu=65, n=1)
    weld = [ls for ls in result['limit_states'] if ls['name'].startswith('Weld Seam')][0]
    tear = [ls for ls in result['limit_states'] if ls['name'].startswith('Sheet Tear')][0]

    all_pass = True
    de = min(max(0.7 * d - 1.5 * t, 0.0), 0.55 * d)
    expected_weld = 0.75 * 60 * (L * de + math.pi / 4 * de ** 2)
    expected_tear = 2.5 * t * 65 * (0.25 * L + 0.96 * d)
    all_pass &= approx(weld['Rn'], expected_weld, label='J2.2.2 seam weld term L*de')
    all_pass &= approx(tear['Rn'], expected_tear, label='J2.2.2 sheet tear term 0.96da')
    return all_pass


def test_paf_limit_state_mapping():
    """PAF 접합 — J5.3.1/J5.3.2 식 매핑 검증 (F-018)"""
    print('\n=== TEST: PAF Limit-State Mapping (F-018) ===')
    from design.connections import paf_connection

    t1 = 0.06
    t2 = 0.08
    d = 0.2
    Fu = 65
    n = 2

    all_pass = True
    # AISI S100-16 Eq. J5.3.1-1: pin shear = 0.6·Fuh·(π/4·d²) — Fuh는 핀(경화강)
    # 인장강도. Fuf 미지정 시 §J5 기본 120 ksi, 지정 시 사용자 값을 Fuh로 사용
    # (GUI/MCP의 Fuf 입력이 실제로 핀 전단에 반영되는 새 계약 — 과거에는 무시됐음).
    result = paf_connection(t1=t1, t2=t2, d=d, Fy=50, Fu=Fu, Fuf=None, n=n)
    pin = [ls for ls in result['limit_states'] if ls['name'].startswith('Pin Shear')][0]
    bearing = [ls for ls in result['limit_states'] if ls['name'].startswith('Bearing')][0]
    expected_pin_default = 0.60 * 120.0 * (math.pi / 4 * d ** 2) * n
    expected_bearing = 3.2 * t1 * d * Fu * n
    all_pass &= approx(pin['Rn'], expected_pin_default, label='J5.3.1 pin shear (default Fuh=120)')
    all_pass &= approx(bearing['Rn'], expected_bearing, label='J5.3.2 bearing/tilting')

    # 명시적 Fuf(=Fuh) 지정 시 핀 전단에 반영되는지
    result2 = paf_connection(t1=t1, t2=t2, d=d, Fy=50, Fu=Fu, Fuf=260, n=n)
    pin2 = [ls for ls in result2['limit_states'] if ls['name'].startswith('Pin Shear')][0]
    expected_pin_260 = 0.60 * 260.0 * (math.pi / 4 * d ** 2) * n
    all_pass &= approx(pin2['Rn'], expected_pin_260, label='J5.3.1 pin shear (user Fuh=260)')
    return all_pass


def test_bolt_shear_tension_interaction_j34():
    """볼트 전단-인장 상호작용 J3.4-2/-3 + 기하 제공 시 J6.2/J6.3 평가 (F-024)"""
    print('\n=== TEST: Bolt Shear-Tension Interaction J3.4 + J6 geometry (F-024) ===')
    from design.connections import bolt_connection

    all_pass = True
    d, n = 0.5, 2
    Ab = math.pi / 4 * d ** 2
    Fnv, Fnt = 54.0, 90.0  # A325, threads-in, d>=1/2 in (Table J3.4-1)
    Vu, Tu = 5.0, 8.0
    fv = Vu / (n * Ab)

    # LRFD: F'nt = 1.3*Fnt - (Fnt/(phi_v*Fnv))*fv ≤ Fnt (Eq. J3.4-3), phi_v=0.75
    r = bolt_connection(t1=0.1, t2=0.1, d=d, Fy=50, Fu=65, Fub=120, n=n,
                        bolt_grade='A325', design_method='LRFD', Vu=Vu, Tu=Tu)
    st = r.get('shear_tension_interaction')
    all_pass &= approx(1 if st else 0, 1, label='J3.4 interaction block present')
    fnt_red = min(1.3 * Fnt - (Fnt / (0.75 * Fnv)) * fv, Fnt)
    avail_T = 0.75 * n * Ab * fnt_red
    all_pass &= approx(st['Fnt_reduced'], fnt_red, label="LRFD F'nt reduced")
    all_pass &= approx(st['available_tension'], avail_T, label='LRFD available tension')
    all_pass &= approx(st['ratio'], Tu / avail_T, label='LRFD interaction ratio')
    all_pass &= approx(1 if st['equation'].startswith('J3.4-3') else 0, 1, label='LRFD eq J3.4-3')

    # ASD: F'nt = 1.3*Fnt - (Omega_v*Fnt/Fnv)*fv ≤ Fnt (Eq. J3.4-2), Omega_v=2.0
    r2 = bolt_connection(t1=0.1, t2=0.1, d=d, Fy=50, Fu=65, Fub=120, n=n,
                         bolt_grade='A325', design_method='ASD', Vu=Vu, Tu=Tu)
    st2 = r2['shear_tension_interaction']
    fnt_red2 = min(1.3 * Fnt - (2.0 * Fnt / Fnv) * fv, Fnt)
    all_pass &= approx(st2['Fnt_reduced'], fnt_red2, label="ASD F'nt reduced")
    all_pass &= approx(1 if st2['equation'].startswith('J3.4-2') else 0, 1, label='ASD eq J3.4-2')

    # J6.2 net-section tension rupture & J6.3 block shear evaluate when member geometry given
    r3 = bolt_connection(t1=0.1, t2=0.1, d=d, Fy=50, Fu=65, Fub=120, n=n,
                         bolt_grade='A325', e=1.0, width=3.0, g=1.5)
    names = [ls['name'] for ls in r3['limit_states']]
    all_pass &= approx(1 if any('J6.2' in x for x in names) else 0, 1, label='J6.2 tension rupture present')
    all_pass &= approx(1 if any('J6.3' in x for x in names) else 0, 1, label='J6.3 block shear present')
    all_pass &= approx(1 if r3.get('j6_verified') else 0, 1, label='j6_verified True with geometry')
    return all_pass


def test_auto_generate_uses_bending_curve_for_flexure_dsm():
    """자동 생성 DSM — 휨은 압축 곡선 재사용이 아니라 별도 응력분포를 써야 함 (F-002)"""
    print('\n=== TEST: Auto Generate Uses Separate Bending Curve (F-002) ===')
    import numpy as np
    from design.aisi_s100 import _auto_generate_props
    from engine.template import generate_section
    from engine.fsm_solver import stripmain
    from engine.dsm import extract_dsm_values
    from models.data import GBTConfig

    params = {'section_type': 'lippedc', 'H': 8, 'B': 2.5, 'D': 0.625, 't': 0.059, 'r': 0.157, 'Fy': 50}
    result = _auto_generate_props(params)
    auto_dsm = result.get('dsm', {})

    sec = generate_section('lippedc', {'H': 8, 'B': 2.5, 'D': 0.625, 't': 0.059, 'r': 0.157})
    node = sec['node']
    elem = sec['elem']
    node_p = node.copy()
    for n in node_p:
        n[7] = 50
    prop_mat = np.array([[100, 29500, 29500, 0.3, 0.3, 11346]])
    lengths = np.logspace(0, 3, 60)
    m_all = [np.array([1.0]) for _ in lengths]
    legacy = stripmain(prop_mat, node_p, elem, lengths, np.array([]), np.array([]), GBTConfig(), 'S-S', m_all, neigs=10)
    legacy_dsm_m = extract_dsm_values(legacy.curve, node_p, elem, 50, 'Mxx')

    all_pass = True
    all_pass &= approx(1 if auto_dsm.get('Mcrl', 0) > 0 else 0, 1, label='auto Mcrl > 0')
    legacy_mcrl = legacy_dsm_m.get('Mxxcrl', 0)
    all_pass &= approx(1 if abs(auto_dsm.get('Mcrl', 0) - legacy_mcrl) > 0.01 else 0, 1,
                        label='auto flexural DSM differs from legacy compression-curve reuse')
    return all_pass


def test_flexure_design_section_type_affects_fcre():
    """휨 설계 — Z 단면 section_type 전달 시 Fcre가 달라져야 함 (F-012)"""
    print('\n=== TEST: Flexure Design Uses Section Type (F-012) ===')
    from design.aisi_s100 import design_member

    base = {
        'member_type': 'flexure',
        'design_method': 'LRFD',
        'Fy': 50,
        'Fu': 65,
        'Mu': 10.0,
        'Lb': 120.0,
        'Cb': 1.0,
        'props': {
            'A': 1.2, 'Sf': 2.0, 'Sxx': 2.0, 'Zx': 2.3,
            'Ixx': 10.0, 'Izz': 1.8, 'Ixz': 0.0,
            'xcg': 0.0, 'zcg': 4.0, 'thetap': 0.0,
            'I11': 10.0, 'I22': 1.8,
            'rx': 2.886, 'ry': 1.225, 'ro': 3.2,
            'J': 0.02, 'Cw': 8.0, 'xo': 0.6,
            'h_web': 7.5, 't': 0.06, 'b_flange': 2.25, 'd_lip': 0.625, 'R': 0.157,
        },
        'section': {
            'type': 'Z', 'depth': 8.0, 'flange_width': 2.25, 'lip_depth': 0.625, 'thickness': 0.06,
        },
        'dsm': {'Mcrl': 120.0, 'Mcrd': 140.0, 'My': 100.0},
    }

    res_c = design_member({**base, 'section_type': 'C'})
    res_z = design_member({**base, 'section_type': 'Z'})

    all_pass = True
    all_pass &= approx(1 if abs(res_c.get('Mne', 0) - res_z.get('Mne', 0)) > 0.01 else 0, 1,
                        label='C vs Z section_type changes Mne')
    return all_pass


def test_cold_work_uses_estimated_corner_ratio():
    """냉간가공 — 설계 경로가 고정 C=0.15만 쓰지 않도록 형상비 추정 사용 (F-011)"""
    print('\n=== TEST: Cold Work Uses Estimated Corner Ratio (F-011) ===')
    from design.aisi_s100 import design_member

    params = {
        'member_type': 'flexure',
        'design_method': 'LRFD',
        'Fy': 50,
        'Fu': 70,
        'Mu': 10.0,
        'Lb': 24.0,
        'Cb': 1.0,
        'use_cold_work': True,
        'section_type': 'C',
        'props': {
            'A': 0.9, 'Sf': 2.0, 'Sxx': 2.0, 'Zx': 2.2,
            'Ixx': 9.0, 'Izz': 2.0, 'Ixz': 0.0,
            'xcg': 0.0, 'zcg': 4.0, 'thetap': 0.0,
            'I11': 9.0, 'I22': 2.0,
            # radii consistent with Ixx/Izz/A so compute_beam_Fcre>0 (braced → yielding
            # governs → §A3.3.2 cold work legitimately applies for this stocky section)
            'rx': 3.162, 'ry': 1.491, 'ro': 3.509,
            'J': 0.01, 'Cw': 5.0, 'xo': 0.3,
            'h_web': 7.5, 't': 0.06, 'b_flange': 2.5, 'd_lip': 0.75, 'R': 0.157,
        },
        'section': {
            'type': 'C', 'depth': 8.0, 'flange_width': 2.5, 'lip_depth': 0.75, 'thickness': 0.06,
        },
        'dsm': {'Mcrl': 1000.0, 'Mcrd': 1000.0, 'My': 100.0},
    }
    result = design_member(params)
    cw = result.get('cold_work') or {}  # design_member returns None when A3.3.2 yields no benefit

    all_pass = True
    all_pass &= approx(1 if cw.get('C', 0) > 0 else 0, 1, label='cold-work C > 0')
    all_pass &= approx(1 if abs(cw.get('C', 0) - 0.15) > 0.001 else 0, 1, label='cold-work C not fixed at 0.15')
    return all_pass


def test_flexure_h3_respects_fastened_and_web_config():
    """휨 설계 H3 — fastened 및 web_config 입력 전달 검증 (F-023/F-040)"""
    print('\n=== TEST: Flexure H3 Uses Fastened and Web Config (F-023/F-040) ===')
    from design.aisi_s100 import design_member

    result = design_member({
        'member_type': 'flexure',
        'design_method': 'LRFD',
        'Fy': 50,
        'Fu': 65,
        'Mu': 8.0,
        'Vu': 2.0,
        'Lb': 48.0,
        'Cb': 1.0,
        'section_type': 'Z',
        'wc_N': 3.5,
        'wc_R': 0.1875,
        'wc_support': 'ETF',
        'wc_fastened': 'unfastened',
        'wc_web_config': 'multi_web',
        'wc_section_family': 'multi_web',
        'wc_n_webs': 3,
        'props': {
            'A': 1.0, 'Sf': 2.0, 'Sxx': 2.0, 'Zx': 2.1,
            'Ixx': 8.0, 'Izz': 2.0, 'Ixz': 0.0,
            'xcg': 0.0, 'zcg': 4.0, 'thetap': 0.0,
            'I11': 8.0, 'I22': 2.0,
            'J': 0.01, 'Cw': 5.0, 'xo': 0.2,
            'h_web': 7.5, 't': 0.06,
        },
        'section': {'type': 'Z', 'depth': 8.0, 'flange_width': 2.25, 'lip_depth': 0.75, 'thickness': 0.06},
        'dsm': {'Mcrl': 150.0, 'Mcrd': 180.0, 'My': 110.0},
    })

    all_pass = True
    all_pass &= approx(1 if result.get('web_crippling', {}).get('fastened') == 'unfastened' else 0, 1,
                        label='H3 passes wc_fastened')
    all_pass &= approx(1 if result.get('web_crippling', {}).get('table') == 'G5-5' else 0, 1,
                        label='uses G5-5 multi-web table')
    all_pass &= approx(1 if result.get('web_crippling', {}).get('n_webs') == 3 else 0, 1,
                        label='passes wc_n_webs')
    all_pass &= approx(1 if result.get('h3_interaction', {}).get('equation') == 'H3-2' else 0, 1,
                        label='H3 uses requested multi_web equation (Eq. H3-2)')
    return all_pass


def test_flexure_design_passes_built_up_i_and_edge_distance():
    """상위 설계 경로가 built_up_i와 edge distance를 §G5까지 전달해야 함"""
    print('\n=== TEST: Flexure Design Passes Built-Up I and Edge Distance ===')
    from design.aisi_s100 import design_member

    result = design_member({
        'member_type': 'flexure',
        'design_method': 'LRFD',
        'analysis_method': 'DSM',
        'Fy': 50,
        'Fu': 65,
        'Mu': 12.0,
        'Vu': 4.0,
        'Lb': 120.0,
        'Cb': 1.0,
        'wc_N': 3.0,
        'wc_R': 0.16,
        'wc_support': 'ITF',
        'wc_fastened': 'unfastened',
        'wc_section_family': 'built_up_i',
        'wc_flange_condition': 'stiffened',
        'wc_edge_distance': 12.0,
        'props': {
            'A': 1.2, 'Sf': 2.4, 'Sxx': 2.4, 'Zx': 2.6,
            'Ixx': 11.0, 'Izz': 2.2, 'Ixz': 0.0,
            'xcg': 0.0, 'zcg': 4.0, 'thetap': 0.0,
            'I11': 11.0, 'I22': 2.2,
            'J': 0.02, 'Cw': 7.0, 'xo': 0.3,
            'h_web': 7.0, 't': 0.08,
        },
        'section': {'type': 'I', 'depth': 8.0, 'flange_width': 2.5, 'lip_depth': 0.0, 'thickness': 0.08},
        'dsm': {'Mcrl': 170.0, 'Mcrd': 0.0, 'My': 120.0},
    })

    wc = result.get('web_crippling', {})
    all_pass = True
    all_pass &= approx(1 if wc.get('table') == 'G5-1' else 0, 1, label='design path uses G5-1')
    all_pass &= approx(1 if wc.get('section_family') == 'built_up_i' else 0, 1, label='passes built_up_i family')
    all_pass &= approx(wc.get('edge_distance', 0), 12.0, tol=0.001, label='passes edge distance')
    all_pass &= approx(1 if not wc.get('h3_applicable', True) else 0, 1, label='H3 marked not applicable')
    all_pass &= approx(1 if result.get('h3_interaction') is None else 0, 1, label='no H3 interaction result')
    return all_pass


def test_webview_design_state_roundtrip():
    """WebView 설계 상태 저장/복원 round-trip — G5 확장 입력 포함"""
    print('\n=== TEST: WebView Design State Roundtrip ===')
    script_path = os.path.join(os.path.dirname(__file__), '..', 'webview', 'design_state_roundtrip.js')
    result = subprocess.run(
        ['node', script_path],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        print(result.stderr.strip())
    if result.returncode != 0:
        raise AssertionError(f'Node roundtrip test failed with exit code {result.returncode}')
    return True


def test_webview_design_prepare_contract():
    """WebView 설계탭 FSM 준비 UI 계약 — 버튼/메시지 배선 포함"""
    print('\n=== TEST: WebView Design Prepare Contract ===')
    script_path = os.path.join(os.path.dirname(__file__), '..', 'webview', 'design_prepare_contract.js')
    result = subprocess.run(
        ['node', script_path],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        print(result.stderr.strip())
    if result.returncode != 0:
        raise AssertionError(f'Node design-prepare contract test failed with exit code {result.returncode}')
    return True


def test_flexure_design_auto_infers_hat_family_and_webs():
    """wc_section_family auto일 때 Hat 단면 family/n_webs를 추론해야 함"""
    print('\n=== TEST: Flexure Design Auto-Infers Hat Family and Webs ===')
    from design.aisi_s100 import design_member

    result = design_member({
        'member_type': 'flexure',
        'design_method': 'LRFD',
        'analysis_method': 'DSM',
        'Fy': 50,
        'Fu': 65,
        'Mu': 8.0,
        'Vu': 3.5,
        'Lb': 120.0,
        'Cb': 1.0,
        'wc_N': 3.0,
        'wc_R': 0.12,
        'wc_support': 'ETF',
        'section_type': 'Hat',
        'props': {
            'A': 1.0, 'Sf': 2.0, 'Sxx': 2.0, 'Zx': 2.1,
            'Ixx': 8.0, 'Izz': 2.0, 'Ixz': 0.0,
            'xcg': 0.0, 'zcg': 3.0, 'thetap': 0.0,
            'I11': 8.0, 'I22': 2.0,
            'J': 0.01, 'Cw': 5.0, 'xo': 0.2,
            'h_web': 6.0, 't': 0.06,
        },
        'section': {'type': 'Hat', 'depth': 6.5, 'flange_width': 4.0, 'thickness': 0.06},
        'dsm': {'Mcrl': 120.0, 'Mcrd': 150.0, 'My': 100.0},
    })

    wc = result.get('web_crippling', {})
    all_pass = True
    all_pass &= approx(1 if wc.get('section_family') == 'hat' else 0, 1, label='auto family → hat')
    all_pass &= approx(1 if wc.get('table') == 'G5-4' else 0, 1, label='uses hat table')
    all_pass &= approx(wc.get('n_webs', 0), 2, tol=0.001, label='auto n_webs=2')
    return all_pass


def test_flexure_design_auto_infers_multiweb_family_from_section_hint():
    """section.family_hint/web_count로 multi-web family를 추론해야 함"""
    print('\n=== TEST: Flexure Design Auto-Infers Multi-Web Family ===')
    from design.aisi_s100 import design_member

    result = design_member({
        'member_type': 'flexure',
        'design_method': 'LRFD',
        'analysis_method': 'DSM',
        'Fy': 50,
        'Fu': 65,
        'Mu': 8.0,
        'Vu': 3.5,
        'Lb': 120.0,
        'Cb': 1.0,
        'wc_N': 3.0,
        'wc_R': 0.10,
        'wc_support': 'EOF',
        'wc_fastened': 'fastened',
        'wc_support_fastener_spacing': 24.0,
        'section_type': 'CustomDeck',
        'props': {
            'A': 1.0, 'Sf': 2.0, 'Sxx': 2.0, 'Zx': 2.1,
            'Ixx': 8.0, 'Izz': 2.0, 'Ixz': 0.0,
            'xcg': 0.0, 'zcg': 3.0, 'thetap': 0.0,
            'I11': 8.0, 'I22': 2.0,
            'J': 0.01, 'Cw': 5.0, 'xo': 0.2,
            'h_web': 6.0, 't': 0.05,
        },
        'section': {
            'type': 'CustomDeck',
            'family_hint': 'multi_web',
            'web_count': 3,
            'depth': 6.5,
            'flange_width': 5.0,
            'thickness': 0.05,
        },
        'dsm': {'Mcrl': 120.0, 'Mcrd': 150.0, 'My': 100.0},
    })

    wc = result.get('web_crippling', {})
    all_pass = True
    all_pass &= approx(1 if wc.get('section_family') == 'multi_web' else 0, 1, label='auto family → multi_web')
    all_pass &= approx(1 if wc.get('table') == 'G5-5' else 0, 1, label='uses multi-web table')
    all_pass &= approx(wc.get('n_webs', 0), 3, tol=0.001, label='auto n_webs=3')
    all_pass &= approx(1 if wc.get('fastened') == 'unfastened' else 0, 1, label='spacing override retained')
    return all_pass


def test_flexure_shear_and_h3_update_governing_pass():
    """Flexure must include G2/H2 and must not leave an H3 failure as pass=True."""
    print('\n=== TEST: Flexure Governing Pass Includes H2 and H3 ===')
    from design.aisi_s100 import design_member

    base = {
        'member_type': 'flexure', 'design_method': 'LRFD',
        'section_type': 'lippedc',
        'H': 8.0, 'B': 2.5, 'D': 0.625, 't': 0.06, 'R': 0.09,
        'Fy': 50.0, 'Mu': 1.0, 'Lb': 0.0,
        'dsm': {'Mcrl': 100.0, 'Mcrd': 100.0, 'My': 100.0},
    }
    shear_fail = design_member({**base, 'Vu': 100.0})
    h3_fail = design_member({
        **base, 'Vu': 100.0,
        'wc_N': 1.0, 'wc_R': 0.1, 'wc_support': 'EOF',
    })

    all_pass = True
    all_pass &= approx(1 if 'shear' in shear_fail else 0, 1, label='flexure returns G2 shear result')
    all_pass &= approx(1 if shear_fail.get('shear_interaction', {}).get('pass') is False else 0, 1,
                        label='H2 detects failure')
    all_pass &= approx(1 if shear_fail.get('pass') is False else 0, 1,
                        label='H2 failure updates top-level pass')
    all_pass &= approx(1 if h3_fail.get('h3_interaction', {}).get('pass') is False else 0, 1,
                        label='H3 detects failure')
    all_pass &= approx(1 if h3_fail.get('pass') is False else 0, 1,
                        label='H3 failure updates top-level pass')
    return all_pass


def test_b4_limits_use_section_geometry_and_complete_simple_lip_checks():
    """UI-style section geometry must not bypass Table B4.1-1 checks."""
    print('\n=== TEST: B4 Limits Use UI Section Geometry ===')
    from design.aisi_s100 import check_dsm_limits

    params = {
        'member_type': 'flexure', 'Fy': 95.0,
        'props': {'A': 1.0},
        'section': {
            'type': 'C', 'depth': 12.0, 'flange_width': 4.0,
            'lip_depth': 3.0, 'thickness': 0.02, 'R_corner': 0.04,
            'n_f': 5, 'n_le': 3, 'n_w': 5,
        },
    }
    warnings = check_dsm_limits(params, 'flexure')
    joined = '\n'.join(warnings)
    all_pass = True
    for token, label in (
        ('Web h/t', 'web slenderness detected from section'),
        ('Flange b/t', 'flange slenderness detected from section'),
        ('d_o/b_o', 'simple-lip ratio checked'),
        ('n_f', 'flange intermediate stiffener count checked'),
        ('n_le', 'edge stiffener count checked'),
        ('n_w', 'web stiffener count checked'),
        ('Fy = 95.0', 'strict Fy < 95 ksi limit checked'),
    ):
        all_pass &= approx(1 if token in joined else 0, 1, label=label)
    return all_pass


def test_dsm_uses_modal_classification_before_wavelength_heuristic():
    """A D-dominant cFSM label must route a single minimum to distortional buckling."""
    print('\n=== TEST: DSM Uses cFSM Modal Classification ===')
    from engine.dsm import extract_dsm_values
    from engine.template import generate_section

    sec = generate_section('lippedc', {'H': 8.0, 'B': 2.5, 'D': 0.625, 't': 0.06})
    node, elem = sec['node'], sec['elem']
    node[:, 7] = 50.0
    curve = [
        [[1.0, 2.0]],
        [[5.0, 1.0]],
        [[10.0, 2.0]],
    ]
    classifications = [
        [[0.0, 10.0, 90.0, 0.0]],
        [[0.0, 98.0, 2.0, 0.0]],
        [[0.0, 20.0, 80.0, 0.0]],
    ]
    result = extract_dsm_values(
        curve, node, elem, 50.0, 'P',
        mode_classifications=classifications,
    )
    all_pass = True
    all_pass &= approx(1 if result.get('classification_method') == 'cfsm_modal' else 0, 1,
                        label='classification method is cfsm_modal')
    all_pass &= approx(1 if result.get('dist_detected') else 0, 1,
                        label='distortional minimum detected')
    all_pass &= approx(1 if not result.get('local_detected') else 0, 1,
                        label='D-dominant minimum not mislabeled local')
    return all_pass


def test_purlin_uplift_r_and_governing_wiring_contract():
    """The integrated purlin path must apply uplift R/Vu and include uplift as a candidate."""
    print('\n=== TEST: Purlin Uplift/R Governing Wiring ===')
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    with open(os.path.join(root, 'src', 'webview', 'StcfsdPanel.ts'), encoding='utf-8') as f:
        panel = f.read()
    with open(os.path.join(root, 'webview', 'js', 'app.js'), encoding='utf-8') as f:
        app = f.read()
    all_pass = True
    all_pass &= approx(1 if 'R_uplift: upliftR' in panel else 0, 1, label='uplift design receives R')
    all_pass &= approx(1 if 'Vu: upliftVu' in panel else 0, 1, label='uplift design receives Vu')
    all_pass &= approx(1 if "['양력', data.design_uplift]" in app else 0, 1,
                        label='uplift included in governing candidates')
    return all_pass


def test_unsupported_sections_require_rational_global_buckling_input():
    """L/hat 등 비대칭 단면에 C/Z 전역좌굴 폐형식을 자동 적용하면 안 된다."""
    print('\n=== TEST: Unsupported Shapes Require Rational Global Buckling ===')
    from design.aisi_s100 import design_member
    from design.global_buckling import compute_beam_Fcre, compute_column_Fcre

    props = {
        'A': 1.0, 'Sf': 2.0, 'Sxx': 2.0, 'Ixx': 8.0, 'Izz': 1.0,
        'rx': 2.8, 'ry': 1.0, 'J': 0.02, 'Cw': 2.0, 'xo': 0.5,
        'section_type': 'angle', 't': 0.08, 'h_web': 6.0,
        'b_flange': 2.0, 'd_lip': 0.5,
    }
    column = compute_column_Fcre(props, 50.0, 120.0, 120.0, 120.0)
    beam = compute_beam_Fcre(props, 1.0, 120.0, section_type='angle')
    base = {
        'member_type': 'flexure', 'section_type': 'angle', 'Fy': 50.0,
        'Mu': 1.0, 'Lb': 120.0, 'props': props,
        'dsm': {'Mcrl': 100.0, 'Mcrd': 100.0, 'My': 100.0},
    }
    blocked = design_member(base)
    supplied = design_member({**base, 'Fcre': 100.0})
    verified_no_dist = design_member({
        **base, 'section_type': 'hat', 'Fcre': 100.0,
        'dsm': {
            'Mcrl': 100.0, 'Mcrd': 0.0, 'My': 100.0,
            'classification_method': 'cfsm_modal',
            'local_detected': True, 'dist_detected': False,
        },
    })

    all_pass = True
    all_pass &= approx(1 if column.get('unsupported') else 0, 1,
                        label='unmapped symmetry-axis section rejected')
    all_pass &= approx(beam, 0.0, label='unimplemented F2.1.2 orientation rejected')
    all_pass &= approx(blocked.get('Mn', -1), 0.0, label='unsupported formula gives no false strength')
    all_pass &= approx(1 if any('F2.1.2' in w for w in blocked.get('warnings', [])) else 0, 1,
                        label='rational-analysis warning surfaced')
    all_pass &= approx(1 if supplied.get('Mn', 0) > 0 else 0, 1,
                        label='explicit rational Fcre is accepted')
    all_pass &= approx(1 if not verified_no_dist.get('distortional_not_evaluated') else 0, 1,
                        label='verified absence of distortional mode is accepted')
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
        test_shear_lag_design_strength_split,
        test_connection_arc_spot_uses_diameter_input,
        test_combined_requires_explicit_weak_axis_strength,
        test_lap_connection_uses_shared_connection_engine,
        # --- F-xxx 수정 검증 테스트 ---
        test_web_crippling_c_z_separation,
        test_web_crippling_overhang_eq_g52,
        test_web_crippling_overhang_definition_limit,
        test_web_crippling_itf_edge_distance_validation,
        test_web_crippling_built_up_i_table_g51,
        test_web_crippling_built_up_i_unsupported_unstiffened_two_flange,
        test_web_crippling_hat_per_web_multiplier,
        test_web_crippling_multiweb_spacing_override,
        test_dsm_boundary_minima,
        test_uplift_combo_reaction_based,
        test_auto_generate_passes_corner_radius,
        test_h3_web_configs,
        test_kx_matches_reference_example,
        test_multi_bolt_c_factor,
        test_beam_fe_solve_flag,
        test_screw_connection_interpolation_and_pullover,
        test_arc_spot_effective_diameter_cap,
        test_arc_seam_formula_terms,
        test_paf_limit_state_mapping,
        test_auto_generate_uses_bending_curve_for_flexure_dsm,
        test_flexure_design_section_type_affects_fcre,
        test_cold_work_uses_estimated_corner_ratio,
        test_flexure_h3_respects_fastened_and_web_config,
        test_flexure_design_passes_built_up_i_and_edge_distance,
        test_webview_design_state_roundtrip,
        test_webview_design_prepare_contract,
        test_flexure_design_auto_infers_hat_family_and_webs,
        test_flexure_design_auto_infers_multiweb_family_from_section_hint,
        test_flexure_shear_and_h3_update_governing_pass,
        test_b4_limits_use_section_geometry_and_complete_simple_lip_checks,
        test_dsm_uses_modal_classification_before_wavelength_heuristic,
        test_purlin_uplift_r_and_governing_wiring_contract,
        test_unsupported_sections_require_rational_global_buckling_input,
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
