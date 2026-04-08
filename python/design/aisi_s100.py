"""AISI S100-16 메인 설계 엔진

design_member()  — 압축/휨/조합/인장 부재 설계 계산
design_guide()   — AI용 설계 가이드 (워크플로우, 공식, 예제)
"""

import math

from design.dsm_strength import (
    compression_local, compression_distortional,
    flexure_local, flexure_distortional,
)
from design.global_buckling import (
    column_global_strength, beam_global_strength,
    compute_column_Fcre, compute_beam_Fcre,
)
from design.interaction import (
    combined_axial_bending, combined_bending_shear,
)
from design.shear import shear_strength, web_crippling
from design.connections import design_connection
from design.steel_grades import E, G, STEEL_GRADES

# 안전/저항 계수
PHI = {
    'compression': 0.85,
    'flexure': 0.90,
    'tension_yield': 0.90,
    'tension_rupture': 0.75,
    'shear': 0.95,
}
OMEGA = {
    'compression': 1.80,
    'flexure': 1.67,
    'tension_yield': 1.67,
    'tension_rupture': 2.00,
    'shear': 1.60,
}


def design_member(params: dict) -> dict:
    """부재 설계 계산 메인 디스패처"""
    # props가 없으면 단면 템플릿에서 자동 생성
    if not params.get('props') or not params['props'].get('A'):
        params = _auto_generate_props(params)

    member_type = params.get('member_type', 'compression')

    if member_type == 'compression':
        result = _design_compression(params)
    elif member_type == 'flexure':
        result = _design_flexure(params)
    elif member_type == 'combined':
        result = _design_combined(params)
    elif member_type == 'tension':
        result = _design_tension(params)
    elif member_type == 'connection':
        return design_connection(params)
    else:
        return {'error': f'Unknown member_type: {member_type}'}

    # DSM 적용 한계 검증 (접합부 제외)
    if 'error' not in result:
        dsm_warnings = check_dsm_limits(params)
        if dsm_warnings:
            result['dsm_warnings'] = dsm_warnings

    # 보고서 생성
    if 'error' not in result:
        result['report'] = generate_report(result, params)

    return result


# ============================================================
# DSM 적용 한계 검증 (Table B4.1-1)
# ============================================================

def check_dsm_limits(params: dict) -> list:
    """DSM 적용 한계 검증 (AISI S100-16 Table B4.1-1)

    Returns: list of warnings (빈 리스트면 모두 통과)
    """
    props = params.get('props', {})
    Fy = params.get('Fy', 35.53)
    t = props.get('t', 0)
    warnings = []

    if t <= 0:
        return warnings

    # 보강 요소 (웹): w/t ≤ 500
    h_web = props.get('h_web', 0)
    if h_web > 0:
        wt_web = h_web / t
        if wt_web > 500:
            warnings.append(f'Web w/t = {wt_web:.1f} > 500 (Table B4.1-1 stiffened limit)')

    # 연단보강 요소 (플랜지): b/t ≤ 160
    b_flange = props.get('b_flange', 0)
    if b_flange > 0:
        bt_fl = b_flange / t
        if bt_fl > 160:
            warnings.append(f'Flange b/t = {bt_fl:.1f} > 160 (Table B4.1-1 edge-stiffened limit)')

    # 비보강 요소 (립): d/t ≤ 60
    d_lip = props.get('d_lip', 0)
    if d_lip > 0:
        dt_lip = d_lip / t
        if dt_lip > 60:
            warnings.append(f'Lip d/t = {dt_lip:.1f} > 60 (Table B4.1-1 unstiffened limit)')

    # 코너 반경: R/t ≤ 20
    R = props.get('R', 0) or props.get('r', 0)
    if R > 0:
        Rt = R / t
        if Rt > 20:
            warnings.append(f'Corner R/t = {Rt:.1f} > 20 (Table B4.1-1 corner limit)')

    # 항복강도: Fy ≤ 95 ksi
    if Fy > 95:
        warnings.append(f'Fy = {Fy} ksi > 95 ksi (Table B4.1-1 Fy limit)')

    return warnings


# ============================================================
# 압축 부재 설계
# ============================================================

def _design_compression(params: dict) -> dict:
    """DSM 압축 부재 설계 (§E2, §E3.2, §E4)"""
    Fy = params.get('Fy', 35.53)
    Fu = params.get('Fu', 58.02)
    design_method = params.get('design_method', 'LRFD')
    Pu = params.get('Pu', 0)

    # 단면 성질 (외부에서 전달)
    props = params.get('props', {})
    Ag = props.get('A', 0)
    if Ag <= 0:
        return {'error': 'Section properties not available (A=0)'}

    # DSM 값 (외부에서 전달 — get_dsm_values 결과)
    dsm = params.get('dsm', {})
    Pcrl = dsm.get('Pcrl', 0)
    Pcrd = dsm.get('Pcrd', 0)
    Py_dsm = dsm.get('Py', 0)

    # 유효좌굴길이
    KxLx = params.get('KxLx', 120)
    KyLy = params.get('KyLy', 120)
    KtLt = params.get('KtLt', 120)

    steps = []
    spec_sections = []
    warnings = []

    if Pcrl == 0 and Pcrd == 0:
        warnings.append(
            'Pcrl=0, Pcrd=0: 좌굴 해석 결과가 없어 좌굴 감소가 적용되지 않습니다. '
            'FSM 해석을 먼저 실행하세요 (run_analysis → get_dsm_values).'
        )

    # Step 1: Py — DSM에서 전달된 Py 우선 사용 (yieldMP 기반)
    # Pcrl = LF × Py_dsm 이므로, Py도 동일한 Py_dsm을 사용해야 λ가 일관됨
    Py = Py_dsm if Py_dsm > 0 else Ag * Fy
    Ag_eff = Py / Fy if Fy > 0 else Ag
    steps.append({
        'step': 1, 'name': 'Yield Load (Py)',
        'value': round(Py, 2), 'unit': 'kips',
        'formula': f'Py = {"DSM" if Py_dsm > 0 else "Ag×Fy"} = {Py:.2f} kips (Ag={Ag_eff:.4f})',
    })

    # Step 2: 전체좌굴 (E2)
    Fcre_result = compute_column_Fcre(props, Fy, KxLx, KyLy, KtLt)
    Fcre = Fcre_result['Fcre']
    global_result = column_global_strength(Fy, Fcre, Ag_eff)
    Pne = global_result['Pne']
    spec_sections.append('E2')

    steps.append({
        'step': 2, 'name': 'Global Buckling (Pne)',
        'value': round(Pne, 2), 'unit': 'kips',
        'formula': f'Fcre = {Fcre:.2f} ksi, λc = {global_result["lambda_c"]:.3f}, '
                   f'Fn = {global_result["Fn"]:.2f} ksi → Pne = {Pne:.2f} kips',
        'equation': global_result['equation'],
        'buckling_type': Fcre_result.get('buckling_type', ''),
    })

    # Step 3: 국부좌굴 (E3.2)
    if Pcrl > 0:
        local_result = compression_local(Pne, Pcrl)
        Pnl = local_result['Pnl']
        spec_sections.append('E3.2')
    else:
        Pnl = Pne
        local_result = {'lambda_l': 0, 'equation': 'N/A (no Pcrl)'}

    steps.append({
        'step': 3, 'name': 'Local Buckling (Pnl)',
        'value': round(Pnl, 2), 'unit': 'kips',
        'formula': (
            f'Pcrl = {Pcrl:.2f} kips, '
            f'λl = √(Pne/Pcrl) = √({Pne:.2f} kips/{Pcrl:.2f} kips) = {local_result["lambda_l"]:.3f} '
            f'{"≤" if local_result["lambda_l"] <= 0.776 else ">"} 0.776 → '
            f'Pnl = {Pnl:.2f} kips'
        ) if Pcrl > 0 else f'Pcrl = 0 → Pnl = Pne = {Pnl:.2f} kips',
        'equation': local_result['equation'],
    })

    # Step 4: 왜곡좌굴 (E4)
    # Pcrd=0 fallback: signature curve에서 뒤틀림 극소 미검출 시
    # AISI Appendix 2, §2.3.1.3 해석적 공식으로 Fcrd 계산
    Pcrd_source = 'FSM'
    if Pcrd == 0 and Ag > 0:
        section = params.get('section', {})
        ho = props.get('h_web', 0) or section.get('depth', 0)
        bo = props.get('b_flange', 0) or section.get('flange_width', 0)
        do = section.get('lip_depth', 0) or props.get('d_lip', 0)
        t = props.get('t', 0) or section.get('thickness', 0)
        sec_type = section.get('type', 'C')
        if ho > 0 and bo > 0 and t > 0 and do > 0:
            try:
                from design.loads.distortional_params import (
                    calc_flange_properties, calc_Fcrd
                )
                b_cl = bo - t
                d_cl = do - t / 2.0
                fp = calc_flange_properties(b_cl, d_cl, t, 90.0, sec_type)
                fcrd_result = calc_Fcrd(fp, ho, t, xi_web=0)  # compression
                Fcrd_calc = fcrd_result['Fcrd']
                if Fcrd_calc > 0:
                    Pcrd = Fcrd_calc * Ag_eff
                    Pcrd_source = '§2.3.1.3'
                    warnings.append(
                        f'Pcrd: signature curve에서 뒤틀림 극소 미검출 → '
                        f'Appendix 2 §2.3.1.3 해석적 공식 사용 '
                        f'(Fcrd={Fcrd_calc:.2f} ksi, Lcrd={fcrd_result["Lcrd"]} in)'
                    )
            except Exception:
                pass

    if Pcrd > 0:
        dist_result = compression_distortional(Py, Pcrd)
        Pnd = dist_result['Pnd']
        spec_sections.append('E4')
    else:
        Pnd = Py
        dist_result = {'lambda_d': 0, 'equation': 'N/A (no Pcrd)'}

    steps.append({
        'step': 4, 'name': 'Distortional Buckling (Pnd)',
        'value': round(Pnd, 2), 'unit': 'kips',
        'formula': (
            f'Pcrd = {Pcrd:.2f} kips ({Pcrd_source}), '
            f'λd = √(Py/Pcrd) = √({Py:.2f} kips/{Pcrd:.2f} kips) = {dist_result["lambda_d"]:.3f} '
            f'{"≤" if dist_result["lambda_d"] <= 0.561 else ">"} 0.561 → '
            f'Pnd = {Pnd:.2f} kips'
        ) if Pcrd > 0 else f'Pcrd = 0 → Pnd = Py = {Pnd:.2f} kips',
        'equation': dist_result['equation'],
    })

    # Step 5: 공칭강도
    Pn = min(Pne, Pnl, Pnd)
    if Pn == Pnl:
        mode = 'Local Buckling'
    elif Pn == Pnd:
        mode = 'Distortional Buckling'
    else:
        mode = f'Global Buckling ({Fcre_result.get("buckling_type", "")})'

    phi = PHI['compression']
    omega = OMEGA['compression']
    phi_Pn = phi * Pn
    Pn_omega = Pn / omega

    steps.append({
        'step': 5, 'name': 'Nominal Strength (Pn)',
        'value': round(Pn, 2), 'unit': 'kips',
        'formula': f'Pn = min(Pne={Pne:.2f}, Pnl={Pnl:.2f}, Pnd={Pnd:.2f}) = {Pn:.2f} kips',
        'controlling_mode': mode,
    })

    # Step 6: 설계강도
    utilization = 0
    if design_method == 'LRFD':
        design_strength = phi_Pn
        if Pu > 0 and phi_Pn > 0:
            utilization = Pu / phi_Pn
        elif Pu > 0:
            utilization = float('inf')
        steps.append({
            'step': 6, 'name': 'Design Strength (LRFD)',
            'value': round(phi_Pn, 2), 'unit': 'kips',
            'formula': f'φPn = {phi} × {Pn:.2f} = {phi_Pn:.2f} kips',
        })
    else:
        design_strength = Pn_omega
        if Pu > 0 and Pn_omega > 0:
            utilization = Pu / Pn_omega
        elif Pu > 0:
            utilization = float('inf')
        steps.append({
            'step': 6, 'name': 'Allowable Strength (ASD)',
            'value': round(Pn_omega, 2), 'unit': 'kips',
            'formula': f'Pn/Ω = {Pn:.2f}/{omega} = {Pn_omega:.2f} kips',
        })

    return {
        'member_type': 'compression',
        'method': 'DSM',
        'design_method': design_method,
        'Pn': round(Pn, 2),
        'Pne': round(Pne, 2),
        'Pnl': round(Pnl, 2),
        'Pnd': round(Pnd, 2),
        'Py': round(Py, 2),
        'controlling_mode': mode,
        'phi_Pn': round(phi_Pn, 2),
        'Pn_omega': round(Pn_omega, 2),
        'design_strength': round(design_strength, 2),
        'utilization': round(utilization, 4) if Pu > 0 else None,
        'pass': utilization <= 1.0 if Pu > 0 else None,
        'steps': steps,
        'spec_sections': list(set(spec_sections)),
        'warnings': warnings,
    }


# ============================================================
# 휨 부재 설계
# ============================================================

def _design_flexure(params: dict) -> dict:
    """DSM 휨 부재 설계 (§F2, §F3.2, §F4)"""
    Fy = params.get('Fy', 35.53)
    Fu = params.get('Fu', 58.02)
    design_method = params.get('design_method', 'LRFD')
    Mu = abs(params.get('Mu', 0))  # 부호는 방향만 나타내므로 절대값 사용
    Lb = params.get('Lb', 120)
    Cb = params.get('Cb', 1.0)

    props = params.get('props', {})
    Ag = props.get('A', 0)
    Sf = props.get('Sf', 0) or props.get('Sxx', 0) or props.get('Sx', 0)
    if Sf <= 0:
        return {'error': 'Section modulus not available (Sf=0)'}

    dsm = params.get('dsm', {})
    Mcrl = dsm.get('Mcrl', 0)
    Mcrd = dsm.get('Mcrd', 0)
    My_dsm = dsm.get('My', 0)

    steps = []
    spec_sections = []
    warnings = []

    if Mcrl == 0 and Mcrd == 0:
        warnings.append(
            'Mcrl=0, Mcrd=0: 좌굴 해석 결과가 없어 좌굴 감소가 적용되지 않습니다. '
            'FSM 해석을 먼저 실행하세요 (run_analysis → get_dsm_values).'
        )

    # Step 1: My — DSM에서 전달된 My 우선 사용 (yieldMP 기반, Ixz 고려)
    # Mcrl = LF × My_dsm 이므로, My도 동일한 My_dsm을 사용해야 λ가 일관됨
    My = My_dsm if My_dsm > 0 else Sf * Fy
    # Sf_eff: My와 일관된 유효 단면계수 (My_dsm/Fy, Ixz 고려)
    Sf_eff = My / Fy if Fy > 0 else Sf
    steps.append({
        'step': 1, 'name': 'Yield Moment (My)',
        'value': round(My, 2), 'unit': 'kip-in',
        'formula': f'My = {"DSM" if My_dsm > 0 else "Sf×Fy"} = {My:.2f} kip-in (Sf={Sf_eff:.4f})',
    })

    # Step 2: 전체좌굴 LTB (F2 / F2.4.2)
    Fcre = compute_beam_Fcre(props, Cb, Lb)
    Zf = props.get('Zx', 0) or props.get('Zf', 0)  # 소성단면계수
    use_ir = params.get('use_inelastic_reserve', False)
    global_result = beam_global_strength(Fy, Fcre, Sf_eff, Zf=Zf,
                                          use_inelastic_reserve=use_ir)
    Mne = global_result['Mne']
    spec_sections.append('F2')
    if global_result.get('inelastic_reserve'):
        spec_sections.append('F2.4.2')

    ir_note = ''
    if use_ir and Zf > 0:
        Mp = global_result.get('Mp', 0)
        if global_result.get('inelastic_reserve'):
            ir_note = f' [§F2.4.2 Inelastic Reserve: Mp={Mp:.2f} kip-in]'
        else:
            ir_note = f' [§F2.4.2 not applicable: Mcre≤2.78My]'

    steps.append({
        'step': 2, 'name': 'Global/LTB (Mne)',
        'value': round(Mne, 2), 'unit': 'kip-in',
        'formula': f'Fcre = {Fcre:.2f} ksi, Fn = {global_result["Fn"]:.2f} ksi → Mne = {Mne:.2f} kip-in{ir_note}',
        'equation': global_result['equation'],
    })

    # Step 3: 국부좌굴 (F3.2)
    if Mcrl > 0:
        local_result = flexure_local(Mne, Mcrl)
        Mnl = local_result['Mnl']
        spec_sections.append('F3.2')
    else:
        Mnl = Mne
        local_result = {'lambda_l': 0, 'equation': 'N/A'}

    steps.append({
        'step': 3, 'name': 'Local Buckling (Mnl)',
        'value': round(Mnl, 2), 'unit': 'kip-in',
        'formula': (
            f'Mcrl = {Mcrl:.2f} kip-in, '
            f'λl = √(Mne/Mcrl) = √({Mne:.2f} kip-in/{Mcrl:.2f} kip-in) = {local_result["lambda_l"]:.3f} '
            f'{"≤" if local_result["lambda_l"] <= 0.776 else ">"} 0.776 → '
            f'Mnl = {Mnl:.2f} kip-in'
        ) if Mcrl > 0 else f'Mcrl = 0 → Mnl = Mne = {Mnl:.2f} kip-in',
        'equation': local_result['equation'],
    })

    # Step 4: 왜곡좌굴 (F4)
    # Mcrd=0 fallback: signature curve에서 뒤틀림 극소 미검출 시
    # AISI Appendix 2, §2.3.3.3 해석적 공식으로 Fcrd 계산
    Mcrd_source = 'FSM'
    if Mcrd == 0 and Sf > 0:
        section = params.get('section', {})
        ho = props.get('h_web', 0) or section.get('depth', 0)
        bo = props.get('b_flange', 0) or section.get('flange_width', 0)
        do = section.get('lip_depth', 0) or props.get('d_lip', 0)
        t = props.get('t', 0) or section.get('thickness', 0)
        sec_type = section.get('type', 'C')
        kphi_ext = params.get('kphi', 0)
        if ho > 0 and bo > 0 and t > 0 and do > 0:
            try:
                from design.loads.distortional_params import (
                    calc_flange_properties, calc_Fcrd
                )
                b_cl = bo - t        # centerline flange width
                d_cl = do - t / 2.0  # centerline lip depth
                fp = calc_flange_properties(b_cl, d_cl, t, 90.0, sec_type)
                fcrd_result = calc_Fcrd(
                    fp, ho, t,
                    kphi_external=kphi_ext,
                    beta=1.0,
                    xi_web=2,  # pure bending
                )
                Fcrd_calc = fcrd_result['Fcrd']
                if Fcrd_calc > 0:
                    Mcrd = Fcrd_calc * Sf_eff
                    Mcrd_source = '§2.3.3.3'
                    warnings.append(
                        f'Mcrd: signature curve에서 뒤틀림 극소 미검출 → '
                        f'Appendix 2 §2.3.3.3 해석적 공식 사용 '
                        f'(Fcrd={Fcrd_calc:.2f} ksi, Lcrd={fcrd_result["Lcrd"]} in)'
                    )
            except Exception:
                pass  # 단면 정보 부족 시 Mcrd=0 유지

    if Mcrd > 0:
        dist_result = flexure_distortional(My, Mcrd)
        Mnd = dist_result['Mnd']
        spec_sections.append('F4')
    else:
        Mnd = My
        dist_result = {'lambda_d': 0, 'equation': 'N/A'}

    steps.append({
        'step': 4, 'name': 'Distortional Buckling (Mnd)',
        'value': round(Mnd, 2), 'unit': 'kip-in',
        'formula': (
            f'Mcrd = {Mcrd:.2f} kip-in ({Mcrd_source}), '
            f'λd = √(My/Mcrd) = √({My:.2f} kip-in/{Mcrd:.2f} kip-in) = {dist_result["lambda_d"]:.3f} '
            f'{"≤" if dist_result["lambda_d"] <= 0.673 else ">"} 0.673 → '
            f'Mnd = {Mnd:.2f} kip-in'
        ) if Mcrd > 0 else f'Mcrd = 0 → Mnd = My = {Mnd:.2f} kip-in',
        'equation': dist_result['equation'],
    })

    # Step 5: 공칭강도
    Mn_dsm = min(Mne, Mnl, Mnd)
    if Mn_dsm == Mnl and Mnl < Mne:
        mode = 'Local Buckling'
    elif Mn_dsm == Mnd and Mnd < Mne:
        mode = 'Distortional Buckling'
    else:
        mode = 'Global/LTB'

    steps.append({
        'step': 5, 'name': 'Nominal Strength — DSM (Mn)',
        'value': round(Mn_dsm, 2), 'unit': 'kip-in',
        'formula': f'Mn = min(Mne={Mne:.2f}, Mnl={Mnl:.2f}, Mnd={Mnd:.2f}) = {Mn_dsm:.2f} kip-in',
        'controlling_mode': mode,
    })

    # Step 5b: §I6.2.1 양력 감소계수 R 적용 (through-fastened panel)
    # AISI 예제 방식: Mn = R × Mnfo (Mnfo = Mnl with Mne=My, 뒤틀림좌굴 제외)
    R_uplift = params.get('R_uplift')
    Mn = Mn_dsm
    if R_uplift is not None and R_uplift > 0:
        # Mnfo: 국부좌굴 강도만 고려 (Fn=Fy, Mne=My 조건)
        # DSM: Mnl (이미 Mne=My일 때의 값), 뒤틀림좌굴(Mnd) 제외
        if Mcrl > 0:
            Mnfo_result = flexure_local(My, Mcrl)
            Mnfo = Mnfo_result['Mnl']
        else:
            Mnfo = My
        Mn_R = R_uplift * Mnfo
        # R-factor 적용 시 Mnd 검토 불필요 (§I6.2.1)
        Mn = min(Mne, Mnl, Mn_R)  # Mnd 제외
        if Mn == Mn_R:
            mode = f'§I6.2.1 R-factor (R={R_uplift})'
        elif Mn == Mnl and Mnl < Mne:
            mode = 'Local Buckling'
        else:
            mode = 'Global/LTB'
        steps.append({
            'step': '5b', 'name': 'Uplift R-factor (§I6.2.1)',
            'value': round(Mn_R, 2), 'unit': 'kip-in',
            'formula': f'Mnfo(Mne=My) = {Mnfo:.2f} kip-in, Mn_R = R × Mnfo = {R_uplift} × {Mnfo:.2f} = {Mn_R:.2f} kip-in',
            'R': R_uplift,
            'Mnfo': round(Mnfo, 2),
            'controls': Mn == Mn_R,
            'note': 'Distortional buckling excluded per §I6.2.1',
        })
        spec_sections.append('I6.2.1')

    phi = PHI['flexure']
    omega = OMEGA['flexure']
    phi_Mn = phi * Mn
    Mn_omega = Mn / omega

    steps.append({
        'step': 6, 'name': 'Final Nominal Strength (Mn)',
        'value': round(Mn, 2), 'unit': 'kip-in',
        'formula': f'Mn = {Mn:.2f} kip-in — {mode}',
        'controlling_mode': mode,
    })

    utilization = 0
    if design_method == 'LRFD':
        design_strength = phi_Mn
        if Mu > 0 and phi_Mn > 0:
            utilization = Mu / phi_Mn
        elif Mu > 0 and phi_Mn <= 0:
            utilization = float('inf')
        steps.append({
            'step': 7, 'name': 'Design Strength (LRFD)',
            'value': round(phi_Mn, 2), 'unit': 'kip-in',
            'formula': f'φMn = {phi} × {Mn:.2f} = {phi_Mn:.2f} kip-in',
        })
    else:
        design_strength = Mn_omega
        if Mu > 0 and Mn_omega > 0:
            utilization = Mu / Mn_omega
        elif Mu > 0 and Mn_omega <= 0:
            utilization = float('inf')
        steps.append({
            'step': 7, 'name': 'Allowable Strength (ASD)',
            'value': round(Mn_omega, 2), 'unit': 'kip-in',
            'formula': f'Mn/Ω = {Mn:.2f}/{omega} = {Mn_omega:.2f} kip-in',
        })

    result = {
        'member_type': 'flexure',
        'method': 'DSM',
        'design_method': design_method,
        'Mn': round(Mn, 2),
        'Mn_dsm': round(Mn_dsm, 2),
        'Mne': round(Mne, 2),
        'Mnl': round(Mnl, 2),
        'Mnd': round(Mnd, 2),
        'My': round(My, 2),
        'R_uplift': R_uplift,
        'controlling_mode': mode,
        'phi_Mn': round(phi_Mn, 2),
        'Mn_omega': round(Mn_omega, 2),
        'design_strength': round(design_strength, 2),
        'utilization': round(utilization, 4) if Mu > 0 else None,
        'pass': utilization <= 1.0 if Mu > 0 else None,
        'steps': steps,
        'spec_sections': list(set(spec_sections)),
        'warnings': warnings,
    }

    # §H3 웹 크리플링 + 휨 상호작용
    wc_N = params.get('wc_N', 0)
    wc_R = params.get('wc_R', 0)
    wc_support = params.get('wc_support', 'EOF')
    if wc_N > 0 and wc_R > 0:
        h = props.get('h_web', 0)
        t = props.get('t', 0)
        if h > 0 and t > 0:
            wc = web_crippling(h, t, wc_R, wc_N, Fy, support=wc_support)
            Pn_wc = wc['Pn']
            from design.interaction import combined_bending_web_crippling
            # 집중하중 P = 소요 반력 (Vu를 사용하거나, Pu를 사용)
            Vu = params.get('Vu', 0) or params.get('Pu', 0)
            h3 = combined_bending_web_crippling(Vu, Pn_wc, Mu, Mn, wc['phi'])
            result['web_crippling'] = {
                'Pn': round(Pn_wc, 2),
                'support': wc_support,
                'phi': wc['phi'],
            }
            result['h3_interaction'] = h3
            result['spec_sections'].append('G5')
            result['spec_sections'].append('H3')

    return result


# ============================================================
# 조합 하중
# ============================================================

def _design_combined(params: dict) -> dict:
    """조합 하중 설계 (압축 + 휨x + 휨y + 전단, §C1 모멘트 증폭 포함)"""
    design_method = params.get('design_method', 'LRFD')
    Fy = params.get('Fy', 35.53)

    # 소요 하중
    Pu = abs(params.get('Pu', 0))
    Mux = abs(params.get('Mux', 0))
    Muy = abs(params.get('Muy', 0))
    Vu = abs(params.get('Vu', 0))

    # Cm 등가모멘트 계수 (§C1, 기본 0.85 — 횡이동 없는 골조)
    Cmx = params.get('Cmx', 0.85)
    Cmy = params.get('Cmy', 0.85)

    # 압축 설계
    comp_params = {**params, 'member_type': 'compression', 'Pu': Pu}
    comp = _design_compression(comp_params)
    if 'error' in comp:
        return comp

    # 휨 설계 (x축)
    flex_params = {**params, 'member_type': 'flexure', 'Mu': Mux}
    flex_x = _design_flexure(flex_params)
    if 'error' in flex_x:
        return flex_x

    # 휨 설계 (y축 — 약축)
    props = params.get('props', {})
    Ag = props.get('A', 0)
    Sy = props.get('Sy', 0) or props.get('Szz', 0)
    flex_y = None
    if Muy > 0 and Sy > 0:
        # 약축 휨: LTB 없음 → Mny = Sy × Fy (항복 지배)
        Mny = Sy * Fy
        phi_b = PHI['flexure']
        omega_b = OMEGA['flexure']
        if design_method == 'LRFD':
            May_strength = phi_b * Mny
        else:
            May_strength = Mny / omega_b
        flex_y = {
            'Mn': round(Mny, 2),
            'design_strength': round(May_strength, 2),
            'controlling_mode': 'Yielding (weak axis)',
        }
    else:
        May_strength = 1e10  # y축 휨 불필요

    # §C1 모멘트 증폭 (P-δ 효과)
    KxLx = params.get('KxLx', 120)
    KyLy = params.get('KyLy', 120)
    rx = props.get('rx', 0)
    ry = props.get('ry', 0)
    alpha_x, alpha_y = 1.0, 1.0
    PEx, PEy = 1e10, 1e10
    if Pu > 0 and rx > 0 and Ag > 0:
        PEx = math.pi ** 2 * E * Ag / (KxLx / rx) ** 2
        alpha_x = Cmx / max(1 - Pu / PEx, 0.01)
        alpha_x = max(alpha_x, 1.0)
    if Pu > 0 and ry > 0 and Ag > 0:
        PEy = math.pi ** 2 * E * Ag / (KyLy / ry) ** 2
        alpha_y = Cmy / max(1 - Pu / PEy, 0.01)
        alpha_y = max(alpha_y, 1.0)

    Mux_amp = Mux * alpha_x
    Muy_amp = Muy * alpha_y

    # 설계강도
    Pa = comp['design_strength']
    Max = flex_x['design_strength']
    May = flex_y['design_strength'] if flex_y else 1e10

    # 상호작용 검토 (증폭된 모멘트 사용)
    interaction = combined_axial_bending(Pu, Pa, Mux_amp, Max, Muy_amp, May)

    result = {
        'member_type': 'combined',
        'design_method': design_method,
        'compression': {
            'Pn': comp['Pn'],
            'design_strength': comp['design_strength'],
            'controlling_mode': comp['controlling_mode'],
        },
        'flexure_x': {
            'Mn': flex_x['Mn'],
            'design_strength': flex_x['design_strength'],
            'controlling_mode': flex_x['controlling_mode'],
        },
        'interaction': interaction,
        'steps': comp['steps'] + flex_x['steps'],
        'spec_sections': list(set(comp['spec_sections'] + flex_x['spec_sections'] + ['H1.2'])),
    }

    # y축 휨 결과
    if flex_y:
        result['flexure_y'] = flex_y
        result['steps'].append({
            'step': len(result['steps']) + 1,
            'name': 'Weak-axis Flexure (Mny)',
            'value': flex_y['Mn'], 'unit': 'kip-in',
            'formula': f'Mny = Sy × Fy = {Sy:.4f} × {Fy} = {flex_y["Mn"]}',
            'equation': 'F2 (yielding)',
        })

    # 모멘트 증폭 정보
    if alpha_x > 1.0 or alpha_y > 1.0:
        result['amplification'] = {
            'Cmx': Cmx, 'Cmy': Cmy,
            'PEx': round(PEx, 2), 'PEy': round(PEy, 2),
            'alpha_x': round(alpha_x, 4), 'alpha_y': round(alpha_y, 4),
            'Mux_amp': round(Mux_amp, 2), 'Muy_amp': round(Muy_amp, 2),
        }
        result['spec_sections'].append('C1')

    # 전단 검토
    if Vu > 0:
        h = props.get('h_web', 0)
        t_web = props.get('t', 0)
        if h > 0 and t_web > 0:
            shear_res = shear_strength(h, t_web, Fy)
            Vn = shear_res['Vn']
            phi_v = PHI['shear']
            omega_v = OMEGA['shear']
            Va = phi_v * Vn if design_method == 'LRFD' else Vn / omega_v
            shear_int = combined_bending_shear(Mux, Max, Vu, Va)
            result['shear'] = {'Vn': round(Vn, 2), 'design_strength': round(Va, 2)}
            result['shear_interaction'] = shear_int
            result['spec_sections'].append('G2')
            result['spec_sections'].append('H2')

    return result


# ============================================================
# 인장 부재 설계
# ============================================================

def _design_tension(params: dict) -> dict:
    """인장 부재 설계 (§D2, §D3)"""
    Fy = params.get('Fy', 35.53)
    Fu = params.get('Fu', 58.02)
    design_method = params.get('design_method', 'LRFD')
    Tu = params.get('Tu', 0)

    props = params.get('props', {})
    Ag = props.get('A', 0)
    An = params.get('An', Ag)  # 순단면적 (기본=총단면)

    if Ag <= 0:
        return {'error': 'Section area not available (A=0)'}

    steps = []

    # 항복
    Tn_yield = Ag * Fy
    phi_y = PHI['tension_yield']
    omega_y = OMEGA['tension_yield']
    steps.append({
        'step': 1, 'name': 'Yielding (D2)',
        'value': round(Tn_yield, 2), 'unit': 'kips',
        'formula': f'Tn = Ag × Fy = {Ag:.4f} × {Fy} = {Tn_yield:.2f}',
    })

    # 파단
    Tn_rupture = An * Fu
    phi_r = PHI['tension_rupture']
    omega_r = OMEGA['tension_rupture']
    steps.append({
        'step': 2, 'name': 'Rupture (D3)',
        'value': round(Tn_rupture, 2), 'unit': 'kips',
        'formula': f'Tn = An × Fu = {An:.4f} × {Fu} = {Tn_rupture:.2f}',
    })

    if design_method == 'LRFD':
        str_y = phi_y * Tn_yield
        str_r = phi_r * Tn_rupture
    else:
        str_y = Tn_yield / omega_y
        str_r = Tn_rupture / omega_r

    if str_y <= str_r:
        Tn = Tn_yield
        design_strength = str_y
        mode = 'Yielding'
    else:
        Tn = Tn_rupture
        design_strength = str_r
        mode = 'Rupture'

    utilization = Tu / design_strength if Tu > 0 and design_strength > 0 else None

    return {
        'member_type': 'tension',
        'design_method': design_method,
        'Tn': round(Tn, 2),
        'Tn_yield': round(Tn_yield, 2),
        'Tn_rupture': round(Tn_rupture, 2),
        'design_strength': round(design_strength, 2),
        'controlling_mode': mode,
        'utilization': round(utilization, 4) if utilization else None,
        'pass': utilization <= 1.0 if utilization else None,
        'steps': steps,
        'spec_sections': ['D2', 'D3'],
    }


# ============================================================
# 설계 가이드 (AI용)
# ============================================================

DESIGN_GUIDES = {
    'column': {
        'workflow_steps': [
            '1. set_section_template → 단면 생성',
            '2. set_material(E=29500, v=0.3) → 재료 설정',
            '3. set_stress(type="uniform_compression", fy=Fy) → 압축 응력',
            '4. run_analysis(neigs=10) → FSM 좌굴 해석',
            '5. get_dsm_values(fy=Fy) → Pcrl, Pcrd, Py 추출',
            '6. get_section_properties() → A, rx, ry, J, Cw, xo',
            '7. aisi_design_compression(...) → 설계 계산',
        ],
        'required_inputs': [
            '단면 치수 (H, B, D, t, r)',
            '항복강도 Fy (ksi), 인장강도 Fu (ksi)',
            '유효좌굴길이 KxLx, KyLy, KtLt (in)',
            '설계방법 (ASD 또는 LRFD)',
        ],
        'cufsm_load_cases': ['compression'],
        'safety_factors': {'phi': 0.85, 'omega': 1.80},
        'similar_examples': [
            {'id': 'III-1A', 'title': 'C-Section Compression (EWM)', 'method': 'EWM'},
            {'id': 'III-1B', 'title': 'Double Z-Section (DSM)', 'method': 'DSM'},
            {'id': 'III-14', 'title': 'Web-Stiffened C-Section (DSM)', 'method': 'DSM'},
        ],
    },
    'beam': {
        'workflow_steps': [
            '1. set_section_template → 단면 생성',
            '2. set_material(E=29500, v=0.3) → 재료 설정',
            '3. set_stress(type="pure_bending", fy=Fy) → 휨 응력',
            '4. run_analysis(neigs=10) → FSM 좌굴 해석',
            '5. get_dsm_values(fy=Fy) → Mcrl, Mcrd, My 추출',
            '6. get_section_properties() → A, Sf, ry, J, Cw, xo',
            '7. aisi_design_flexure(...) → 설계 계산',
        ],
        'required_inputs': [
            '단면 치수 (H, B, D, t, r)',
            '항복강도 Fy (ksi), 인장강도 Fu (ksi)',
            '횡지지 간격 Lb (in), 모멘트 구배 계수 Cb',
            '설계방법 (ASD 또는 LRFD)',
        ],
        'cufsm_load_cases': ['bending_xx_pos'],
        'safety_factors': {'phi': 0.90, 'omega': 1.67},
        'similar_examples': [
            {'id': 'II-1A', 'title': 'C-Section Purlins (EWM, ASD)', 'method': 'EWM'},
            {'id': 'II-1B', 'title': 'C-Section Flexural (DSM)', 'method': 'DSM'},
            {'id': 'II-2B', 'title': 'Z-Section Flexural (DSM)', 'method': 'DSM'},
        ],
    },
    'beam_column': {
        'workflow_steps': [
            '1~6. 압축 설계 워크플로우 실행',
            '7. set_stress(type="pure_bending", fy=Fy) → 휨 응력으로 변경',
            '8. run_analysis(neigs=10) → 휨 좌굴 해석',
            '9. get_dsm_values(fy=Fy) → Mcrl, Mcrd, My 추출',
            '10. aisi_design_combined(...) → 조합 하중 설계',
        ],
        'required_inputs': [
            '단면 치수 (H, B, D, t, r)',
            '항복강도 Fy, 인장강도 Fu',
            'KxLx, KyLy, KtLt, Lb, Cb',
            '소요 하중: Pu, Mux, Muy, Vu',
        ],
        'cufsm_load_cases': ['compression', 'bending_xx_pos'],
        'safety_factors': {'phi_c': 0.85, 'phi_b': 0.90, 'omega_c': 1.80, 'omega_b': 1.67},
        'similar_examples': [
            {'id': 'III-7A', 'title': 'Z-Section Wall Stud (EWM)', 'method': 'EWM'},
            {'id': 'III-7B', 'title': 'Z-Section Wall Stud (DSM)', 'method': 'DSM'},
            {'id': 'III-12', 'title': 'Unbraced Frame Design', 'method': 'combined'},
        ],
    },
    'tension': {
        'workflow_steps': [
            '1. set_section_template → 단면 생성',
            '2. get_section_properties() → Ag (총단면적)',
            '3. aisi_design_tension(Fy, Fu, Tu) → 인장 설계',
        ],
        'required_inputs': [
            '단면 치수 → Ag',
            '항복강도 Fy, 인장강도 Fu',
            '순단면적 An (볼트홀 등 공제, 기본=Ag)',
            '소요 인장력 Tu (kips)',
        ],
        'cufsm_load_cases': [],
        'safety_factors': {'phi_yield': 0.90, 'phi_rupture': 0.75,
                           'omega_yield': 1.67, 'omega_rupture': 2.00},
        'similar_examples': [],
    },
    'connection': {
        'workflow_steps': [
            '1. 접합 유형 선택 (bolt / screw / fillet_weld)',
            '2. 모재 두께 t1, t2 및 Fy, Fu 입력',
            '3. 볼트/나사: 직경 d, 강도 Fub, 개수 n, 끝단거리 e',
            '4. 필릿용접: 용접크기, 길이, 용접봉강도 Fxx',
            '5. aisi_design_connection(...) → 접합 설계',
            '6. 각 파괴모드별 강도 확인 → 지배 모드 결정',
        ],
        'required_inputs': [
            '접합 유형 (bolt / screw / fillet_weld)',
            '모재 두께 t1, t2 (in)',
            '모재 강도 Fy, Fu (ksi)',
            '체결재/용접 상세',
        ],
        'cufsm_load_cases': [],
        'safety_factors': {'phi': '0.50~0.75 (유형별)', 'omega': '2.00~3.00 (유형별)'},
        'similar_examples': [
            {'id': 'IV-9', 'title': 'Bolted Connection', 'method': 'bolt'},
            {'id': 'IV-11', 'title': 'Screw Connection', 'method': 'screw'},
            {'id': 'IV-1', 'title': 'Fillet Weld Connection', 'method': 'fillet_weld'},
        ],
    },
}


def design_guide(params: dict) -> dict:
    """AI용 설계 가이드 반환"""
    query_type = params.get('query_type', 'column')
    guide = DESIGN_GUIDES.get(query_type, DESIGN_GUIDES['column'])

    return {
        'query_type': query_type,
        'cufsm_needed': True,
        **guide,
        'dsm_limits': {
            'stiffened_wt': 500,
            'edge_stiffened_bt': 160,
            'unstiffened_dt': 60,
            'R_t': 20,
            'Fy_max_ksi': 95,
        },
        'steel_grades': list(STEEL_GRADES.keys()),
    }


# ============================================================
# 설계 보고서 생성
# ============================================================

def generate_report(result: dict, params: dict = None) -> str:
    """설계 결과를 텍스트 보고서로 변환

    Returns: 복사/출력 가능한 텍스트 보고서
    """
    lines = []
    lines.append('=' * 60)
    lines.append('  AISI S100-16 DESIGN REPORT')
    lines.append('=' * 60)

    mt = result.get('member_type', '')
    dm = result.get('design_method', 'LRFD')
    method = result.get('method', 'DSM')

    lines.append(f'  Member Type : {mt.upper()}')
    lines.append(f'  Design Method : {dm}')
    if method:
        lines.append(f'  Analysis Method : {method}')
    lines.append('-' * 60)

    # Steps
    steps = result.get('steps', [])
    if steps:
        lines.append('')
        lines.append('  STEP-BY-STEP CALCULATION')
        lines.append('-' * 60)
        for s in steps:
            eq = f' [{s["equation"]}]' if s.get('equation') else ''
            mode = f' ← {s["controlling_mode"]}' if s.get('controlling_mode') else ''
            lines.append(f'  Step {s["step"]}: {s["name"]}{eq}{mode}')
            if s.get('formula'):
                lines.append(f'    {s["formula"]}')
            if s.get('value') is not None:
                lines.append(f'    → {s["value"]} {s.get("unit", "")}')
            lines.append('')

    # Limit states (connections)
    ls_list = result.get('limit_states', [])
    if ls_list:
        lines.append('')
        lines.append('  LIMIT STATES')
        lines.append('-' * 60)
        for ls in ls_list:
            gov = ' ← GOVERNING' if ls.get('governs') else ''
            lines.append(f'  {ls["name"]}{gov}')
            lines.append(f'    Rn = {ls["Rn"]} kips')
            lines.append(f'    Design Strength = {ls["design_strength"]} kips')
            lines.append('')

    # Summary
    lines.append('-' * 60)
    lines.append('  DESIGN SUMMARY')
    lines.append('-' * 60)

    if mt == 'compression':
        lines.append(f'  Pn   = {result.get("Pn")} kips')
        lines.append(f'  Mode = {result.get("controlling_mode")}')
        lines.append(f'  {"φPn" if dm=="LRFD" else "Pn/Ω"} = {result.get("design_strength")} kips')
    elif mt == 'flexure':
        lines.append(f'  Mn   = {result.get("Mn")} kip-in')
        lines.append(f'  Mode = {result.get("controlling_mode")}')
        lines.append(f'  {"φMn" if dm=="LRFD" else "Mn/Ω"} = {result.get("design_strength")} kip-in')
    elif mt == 'tension':
        lines.append(f'  Tn   = {result.get("Tn")} kips')
        lines.append(f'  Mode = {result.get("controlling_mode")}')
        lines.append(f'  Design Strength = {result.get("design_strength")} kips')
    elif mt == 'combined':
        c = result.get('compression', {})
        fx = result.get('flexure_x', {})
        lines.append(f'  Pn   = {c.get("Pn")} kips ({c.get("controlling_mode")})')
        lines.append(f'  Mnx  = {fx.get("Mn")} kip-in ({fx.get("controlling_mode")})')
        fy = result.get('flexure_y')
        if fy:
            lines.append(f'  Mny  = {fy.get("Mn")} kip-in ({fy.get("controlling_mode")})')
    elif mt == 'connection':
        lines.append(f'  Type = {result.get("connection_type")}')
        lines.append(f'  Governing = {result.get("governing_mode")}')
        lines.append(f'  Design Strength = {result.get("design_strength")} kips')

    util = result.get('utilization')
    if util is not None:
        status = 'OK' if result.get('pass') else 'NG'
        lines.append(f'  Utilization = {util*100:.1f}% → {status}')

    # Interaction
    inter = result.get('interaction')
    if inter:
        lines.append('')
        lines.append('  INTERACTION CHECK (§H1.2)')
        lines.append(f'  P/Pa    = {inter["P_ratio"]:.4f}')
        lines.append(f'  Mx/Max  = {inter["Mx_ratio"]:.4f}')
        lines.append(f'  My/May  = {inter["My_ratio"]:.4f}')
        lines.append(f'  Total   = {inter["total"]:.4f} {"≤" if inter["pass"] else ">"} 1.0 → {"OK" if inter["pass"] else "NG"}')

    h3 = result.get('h3_interaction')
    if h3:
        lines.append('')
        lines.append('  WEB CRIPPLING + BENDING (§H3)')
        lines.append(f'  0.91(P/Pn) = {h3["P_term"]:.4f}')
        lines.append(f'  M/Mnfo     = {h3["M_term"]:.4f}')
        lines.append(f'  Total      = {h3["total"]:.4f} {"≤" if h3["pass"] else ">"} {h3["limit"]:.2f} → {"OK" if h3["pass"] else "NG"}')

    # Spec reference
    secs = result.get('spec_sections', [])
    if secs:
        lines.append('')
        lines.append(f'  Specification: AISI S100-16 {", ".join("§"+s for s in secs)}')

    # Warnings
    warns = result.get('dsm_warnings', [])
    if warns:
        lines.append('')
        lines.append('  ⚠ DSM APPLICABILITY WARNINGS:')
        for w in warns:
            lines.append(f'    - {w}')

    lines.append('')
    lines.append('=' * 60)
    return '\n'.join(lines)


# ============================================================
# 단면 자동 생성 + props 계산
# ============================================================

def _auto_generate_props(params: dict) -> dict:
    """단면 템플릿에서 node/elem → grosprop → props 자동 생성"""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from engine.template import generate_section
    from engine.properties import grosprop
    from engine.cutwp import cutwp_prop

    params = dict(params)  # 원본 변경 방지

    section_type = params.get('section_type', 'lippedc')
    H = params.get('H', 8.0)
    B = params.get('B', 2.5)
    D = params.get('D', 0.625)
    t = params.get('t', 0.0451)

    try:
        sec = generate_section(section_type, {'H': H, 'B': B, 'D': D, 't': t})
        node = sec['node']
        elem = sec['elem']

        props = grosprop(node, elem)

        # CUTWP 성질 추가
        try:
            cw = cutwp_prop(node, elem)
            props['J'] = cw.get('J', 0)
            props['Cw'] = cw.get('Cw', 0)
            props['Xs'] = cw.get('Xs', 0)
            props['Zs'] = cw.get('Zs', 0)
        except Exception:
            props['J'] = 0
            props['Cw'] = 0

        # Sf = Sx (호환성)
        props['Sf'] = props.get('Sx', 0)
        props['t'] = t

        # DSM 값도 자동 계산
        if not params.get('dsm'):
            try:
                from engine.fsm_solver import stripmain
                from engine.dsm import extract_dsm_values
                from models.data import GBTConfig
                import numpy as np

                prop_mat = np.array([[100, 29500, 29500, 0.3, 0.3, 11346]])
                for n in node:
                    n[7] = params.get('Fy', 35.53)

                lengths = np.logspace(0, 3, 60)
                m_all = [np.array([1.0]) for _ in lengths]
                result = stripmain(prop_mat, node, elem, lengths,
                                   np.array([]), np.array([]),
                                   GBTConfig(), 'S-S', m_all, neigs=10)

                Fy = params.get('Fy', 35.53)
                dsmP = extract_dsm_values(result.curve, node, elem, Fy, 'P')
                dsmM = extract_dsm_values(result.curve, node, elem, Fy, 'Mxx')

                params['dsm'] = {
                    'Pcrl': dsmP.get('Pcrl', 0),
                    'Pcrd': dsmP.get('Pcrd', 0),
                    'Py': dsmP.get('Py', 0),
                    'Mcrl': dsmM.get('Mxxcrl', 0),
                    'Mcrd': dsmM.get('Mxxcrd', 0),
                    'My': dsmM.get('My_xx', 0),
                }
            except Exception as e:
                print(f'[StCFSD] Auto DSM failed: {e}')

        params['props'] = props
        params['node'] = node.tolist()
        params['elem'] = elem.tolist()

    except Exception as e:
        print(f'[StCFSD] Auto props failed: {e}')

    return params
