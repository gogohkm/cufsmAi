"""2026-11-23 검토 항목 계약(design_checks) — 기준선 사례와 기준선 비교 도구.

`test_review_1123_checks.py` 가 이 사례들을 모두 돌려 계약을 검사하고, 아래 명령으로
변경 전 결과(기준선)와 변경 후 결과를 맞대어 옛 키 · 값이 하나도 바뀌지 않았음을 보인다.

    # 변경 전(또는 git 의 옛 python/ 사본)에서
    .venv/Scripts/python.exe test/python/contract_cases_1123.py capture <baseline.json> [python_root]
    # 변경 후
    .venv/Scripts/python.exe test/python/contract_cases_1123.py capture <after.json>
    .venv/Scripts/python.exe test/python/contract_cases_1123.py compare <baseline.json> <after.json>

결과는 server.py 의 경로(METHODS[...] → to_jsonable → json.dumps(allow_nan=False))를 그대로
지난다. 비교는 기준선의 모든 dict 키 · 목록 원소 · 스칼라가 새 결과에 같은 값으로 있는지
(실수는 JSON 표기가 같은지 = 비트 단위) 본다. 새 결과에만 있는 dict 키는 덧붙인 것으로 친다.
"""

import json
import os
import sys

MM = 1 / 25.4

# Manual 단면 성질 (test_review_1122_member.py 와 같은 인쇄값)
III3 = dict(A=0.422, rx=1.44, ry=0.605, J=0.000451, Cw=0.457, xo=1.28, ro=2.02, t=0.0566, R=0.0849)
III3_SECTION = dict(type='C', depth=3.625, flange_width=1.625, lip_depth=0.5, thickness=0.0566, r=0.0849)
C9 = dict(A=0.881, Sf=2.29, ry=0.890, ro=3.90, J=0.00102, Cw=11.9, rx=3.42)
C9_SECTION = dict(type='C', depth=9.0, flange_width=2.5, lip_depth=0.773, thickness=0.059, r=0.1875)
ZP = dict(A=0.822, Sf=1.94, rx=3.04, ry=0.83, ro=3.17, J=0.000954, Cw=11.3, xo=0.0, I22=0.25,
          t=0.059, R=0.1875)
Z8_SECTION = dict(type='Z', depth=8.0, flange_width=2.25, lip_depth=0.91, thickness=0.059, r=0.1875)
DEFAULT_LIPPEDC = dict(section_type='lippedc', H=100 * MM, B=50 * MM, D=20 * MM, t=2.3 * MM, r=4 * MM,
                       Fy=35.53, Fu=58.02)
_LAP = dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=12, lap_right_in=12, Mu_support=120,
            Vu_support=4.0, fastener_type='bolt', fastener_dia=0.5, n_rows=2)


def _member():
    c = []
    a = c.append
    # --- 압축 (E) ---
    a(('III-3 compression LRFD', dict(member_type='compression', design_method='LRFD', Fy=50.0, Fu=65.0,
                                       KxLx=120.0, KyLy=60.0, KtLt=60.0, Pu=5.0, section_type='C',
                                       props=dict(III3), section=dict(III3_SECTION),
                                       dsm=dict(Pcrl=0.75 * 21.1, Pcrd=1.11 * 21.1))))
    for case, Fcre_o, Pcrd in (('case1', 1e6, 1e6), ('case2', 52.1, 19.4)):
        for dm in ('LRFD', 'ASD'):
            a((f'III-14 {case} {dm}', dict(member_type='compression', design_method=dm, Fy=50.0, KxLx=66,
                                            KyLy=66, KtLt=66, Fcre=Fcre_o, Pu=10.0, section_type='C',
                                            props=dict(A=0.747, rx=3, ry=1, J=1e-3, Cw=1, xo=1),
                                            dsm=dict(Pcrl=34.4, Pcrd=Pcrd, Py=37.4))))
    a(('III-11 RHS compression ASD', dict(member_type='compression', design_method='ASD', Fy=46.0, KxLx=120,
                                          KyLy=120, KtLt=120, Pu=45.0, section_type='RHS',
                                          props=dict(A=2.914, rx=2.393, ry=2.393, J=25.3, Cw=0.0),
                                          dsm=dict(Pcrl=52.20 * 2.914, Pcrd=0))))
    a(('compression Pcrl missing (E3 not evaluated)', dict(member_type='compression', Fy=50, KxLx=24, KyLy=24,
                                                           KtLt=24, Pu=15.0, section_type='C', props=dict(III3),
                                                           dsm=dict(Pcrl=0, Pcrd=40.0, Py=21.1))))
    a(('compression length missing', dict(member_type='compression', Fy=50, KxLx=120, KyLy=60, Pu=1.0,
                                          section_type='C', props=dict(III3), dsm=dict(Pcrl=1e4, Pcrd=1e4))))
    a(('compression Z via I22', dict(member_type='compression', Fy=55, KxLx=96, KyLy=96, KtLt=96, Pu=1.0,
                                     section_type='Z', props=dict(A=0.822, rx=3.04, ry=0.83, J=0.000954,
                                                                  Cw=11.3, xo=0.0, Ixz=1.8, Ixx=7.6, Izz=0.57),
                                     dsm=dict(Pcrl=1e4, Pcrd=1e4))))
    a(('compression analytic Pcrl/Pcrd fallback', dict(member_type='compression', Fy=55, KxLx=24, KyLy=24,
                                                        KtLt=24, Pu=1.0, section_type='C',
                                                        props=dict(C9, xo=1.83, t=0.059, R=0.1875),
                                                        section=dict(C9_SECTION), dsm=dict(Pcrl=0, Pcrd=0))))
    a(('compression single-minimum floor', dict(member_type='compression', section_type='lippedc', H=9.0, B=2.5,
                                                D=0.773, t=0.059, r=0.1875, Fy=55.0, Pu=1.0, KxLx=24.0,
                                                KyLy=24.0, KtLt=24.0,
                                                props=dict(A=0.881, rx=3.42, ry=0.890, J=0.00102, Cw=11.9,
                                                           xo=1.83, t=0.059, R=0.1875),
                                                dsm={'Pcrl': 0.125 * 48.455, 'Pcrd': 0.0,
                                                     'P_single_minimum': True,
                                                     'P_single_minimum_bound': 0.60 * 48.455,
                                                     'P_Lcrl': 4.2})))
    a(('compression boundary minimum', dict(member_type='compression', Fy=50.0, KxLx=120.0, KyLy=60.0,
                                            KtLt=60.0, Pu=1.0, section_type='C', props=dict(III3),
                                            section=dict(III3_SECTION),
                                            dsm=dict(Pcrl=0.75 * 21.1, Pcrd=1.11 * 21.1, P_boundary_minimum=True))))
    a(('compression hat unsupported E2', dict(member_type='compression', Fy=50, KxLx=60, KyLy=60, KtLt=60,
                                              Pu=3.0, section_type='HAT',
                                              props=dict(A=0.5, rx=1.0, ry=1.5, J=1e-3, Cw=1.0, xo=1.2),
                                              dsm=dict(Pcrl=20, Pcrd=20))))
    a(('compression angle H1.2 required', dict(member_type='compression', design_method='ASD', Fy=50.0,
                                               KxLx=18.0, KyLy=18.0, KtLt=18.0, Pu=3.0, Fcre=40.0,
                                               section_type='lipped_angle',
                                               props=dict(A=0.4, Sf=0.2, rx=0.8, ry=0.5, J=1e-3, Cw=1e-3, xo=0.5),
                                               dsm=dict(Pcrl=30.0, Pcrd=30.0))))
    a(('compression CHS no Pcrd (E4 n/a)', dict(member_type='compression', Fy=42, KxLx=120, KyLy=120,
                                                KtLt=120, Pu=50.0, section_type='CHS', D=8.0,
                                                props=dict(A=2.482, rx=2.794, ry=2.794, J=38.7, Cw=0, t=0.1),
                                                section=dict(type='CHS', diameter=8.0, thickness=0.1),
                                                dsm=dict(Pcrl=1e4, Pcrd=0))))
    # Manual III-6 (원형관 8.00 × 0.100, KL 120 in): §E3.1.1.1 Ae = 2.465 in², Pn = Ae Fn = 92.7 kips — Pcrl 없음
    a(('compression CHS E3.1.1.1 (III-6)', dict(member_type='compression', design_method='ASD', Fy=42.0, KxLx=120,
                                                KyLy=120, KtLt=120, Pu=22.5, section_type='CHS', D=8.0,
                                                props=dict(A=2.482, rx=2.794, ry=2.794, J=38.74, Cw=0.0, t=0.1),
                                                section=dict(type='CHS', diameter=8.0, thickness=0.1), dsm={})))
    a(('compression no demand', dict(member_type='compression', Fy=50.0, KxLx=120.0, KyLy=60.0, KtLt=60.0,
                                     section_type='C', props=dict(III3), section=dict(III3_SECTION),
                                     dsm=dict(Pcrl=0.75 * 21.1, Pcrd=1.11 * 21.1))))
    a(('compression overload fails', dict(member_type='compression', Fy=50, KxLx=24, KyLy=24, KtLt=24,
                                          Pu=60.0, section_type='C', props=dict(III3),
                                          dsm=dict(Pcrl=0, Pcrd=40.0))))
    # --- 휨 (F) ---
    p4 = dict(member_type='flexure', design_method='LRFD', Fy=33.0, Lb=36.0, Cb=1.30, Mu=12.0,
              section_type='TRACK', props=dict(A=0.452, Sf=0.668, ry=0.342, ro=2.15, J=0.000483, Cw=0.315, rx=2.0),
              dsm=dict(Mcrl=29.5, Mcrd=29.5))
    a(('II-4A track LTB LRFD', dict(p4)))
    for dm in ('LRFD', 'ASD'):
        a((f'II-4B track Fcre 56.6 {dm}', dict(p4, design_method=dm, Fcre=56.6)))
    a(('II-1B C9 beta LRFD', dict(member_type='flexure', design_method='LRFD', Fy=55.0, Lb=56.3, Cb=1.67,
                                  Mu=60.0, section_type='C', props=dict(C9),
                                  dsm=dict(Mcrl=84.4, Mcrd=0.85 * 126.0, My=126.0, Lcrd=25.0),
                                  dist_M1_M2=0.0, dist_Lm=56.3)))
    a(('II-1C Fcre 41.0', dict(member_type='flexure', design_method='LRFD', Fy=55.0, Lb=56.3, Mu=50.0, Fcre=41.0,
                               section_type='C', props=dict(A=0.881, Sf=2.29),
                               dsm=dict(Mcrl=84.4, Mcrd=107.0, My=126.0))))
    a(('II-2B Z ASD', dict(member_type='flexure', design_method='ASD', Fy=55.0, Lb=49.1, Mu=40.0, Fcre=243.0,
                           section_type='Z', props=dict(A=0.822, Sf=1.94), dsm=dict(Mcrl=91.0, Mcrd=101.0, My=107.0))))
    a(('II-9 RHS F2.1.4', dict(member_type='flexure', design_method='LRFD', Fy=46.0, Lb=120.0, Cb=1.0, Mu=100.0,
                               section_type='RHS',
                               props=dict(A=2.91, Sf=5.56, Izz=16.7, Ixx=16.7, J=25.3, rx=2.393, ry=2.393),
                               dsm=dict(Mcrl=4.95 / 5.56 * 256 * 3, Mcrd=0))))
    a(('RHS F2.1.4-2 long', dict(member_type='flexure', Fy=46.0, Lb=2000.0, Cb=1.0, Mu=1.0, section_type='RHS',
                                 props=dict(A=2.91, Sf=5.56, Izz=16.7, Ixx=16.7, J=25.3, rx=2.393, ry=2.393),
                                 dsm=dict(Mcrl=1e4, Mcrd=0))))
    for dm in ('ASD', 'LRFD'):
        a((f'II-8 CHS {dm}', dict(member_type='flexure', design_method=dm, Fy=42.0, Lb=120.0, Mu=100.0,
                                  section_type='CHS', D=8.0,
                                  props=dict(A=2.482, Sf=4.84, t=0.1, Izz=19.37, Ixx=19.37, J=38.7,
                                             rx=2.794, ry=2.794),
                                  section=dict(diameter=8.0, thickness=0.1, type='CHS'),
                                  dsm=dict(Mcrl=0, Mcrd=0))))
    a(('flexure Mcrl missing', dict(member_type='flexure', Fy=55, Lb=0.0001, Mu=10.0, section_type='C',
                                    props=dict(C9), dsm=dict(Mcrl=0, Mcrd=1e4))))
    a(('flexure Mcrd missing (F4 not evaluated)', dict(member_type='flexure', Fy=55, Lb=0.0001, Mu=1.0,
                                                       section_type='C', props=dict(C9),
                                                       dsm=dict(Mcrl=84.4, Mcrd=0))))
    a(('flexure track F4 n/a', dict(member_type='flexure', Fy=33.0, Lb=36.0, Cb=1.3, Mu=1.0, section_type='TRACK',
                                    props=dict(A=0.452, Sf=0.668, ry=0.342, ro=2.15, J=0.000483, Cw=0.315, rx=2.0),
                                    dsm=dict(Mcrl=29.5, Mcrd=0))))
    a(('flexure Lb missing', dict(member_type='flexure', Fy=55, Mu=10.0, section_type='C', props=dict(C9),
                                  dsm=dict(Mcrl=84.4, Mcrd=107.0))))
    a(('flexure B4 exceeded and fails', dict(member_type='flexure', Fy=55, Lb=0.0001, Mu=500.0, section_type='C',
                                             props=dict(C9, t=0.059, R=1.5), dsm=dict(Mcrl=84.4, Mcrd=107.0))))
    a(('flexure analytic Mcrd II-5', dict(member_type='flexure', Fy=50, Lb=0.0001, Mu=20.0, section_type='C',
                                          dsm=dict(Mcrl=1e4, Mcrd=0),
                                          props=dict(A=0.6, Sf=1.0, rx=3.0, ry=0.7, ro=3.3, J=1e-3, Cw=2.0,
                                                     t=0.0566, R=0.0849),
                                          section=dict(type='C', depth=8.0, flange_width=2.0, lip_depth=0.625,
                                                       thickness=0.0566, r=0.0849))))
    a(('flexure inelastic reserve', dict(member_type='flexure', design_method='LRFD', Fy=50.0, Lb=0.0, Mu=50.0,
                                         use_inelastic_reserve=True, section_type='C',
                                         props=dict(A=0.881, Sf=2.29, Zx=2.75, rx=3.42, ry=0.89, ro=3.9,
                                                    J=0.00102, Cw=11.9),
                                         dsm=dict(Mcrl=500.0, Mcrd=600.0))))
    a(('flexure cold work + shear + wc', dict(member_type='flexure', design_method='LRFD', Fy=33.0, Fu=45.0,
                                              Lb=0.0001, Mu=10.0, Vu=1.0, section_type='C', use_cold_work=True,
                                              props=dict(C9, t=0.059, R=0.0885, h_web=8.51, b_flange=1.98,
                                                         d_lip=0.53),
                                              section=dict(type='C', depth=9.0, flange_width=2.5, lip_depth=0.773,
                                                           thickness=0.059, r=0.0885),
                                              dsm=dict(Mcrl=1e4, Mcrd=1e4), wc_N=3.0, wc_R=0.0885)))
    wc_base = dict(member_type='flexure', design_method='LRFD', Fy=50, Lb=0.0001, section_type='C',
                   props=dict(C9, t=0.059, R=0.1875, h_web=8.51, b_flange=1.98, d_lip=0.53),
                   section=dict(C9_SECTION), dsm=dict(Mcrl=1e4, Mcrd=1e4), wc_N=3.0, wc_R=0.1875,
                   wc_support='EOF', wc_fastened='fastened')
    a(('G5 alone governs LRFD', dict(wc_base, Mu=1.0, wc_P=2.2)))
    a(('G5 ASD', dict(wc_base, design_method='ASD', Mu=1.0, wc_P=1.0)))
    a(('G5 load from Vu', dict(wc_base, Mu=1.0, Vu=0.5)))
    a(('G5 no bearing load', dict(wc_base, Mu=1.0, Pu=5.0)))
    a(('H3-2 built-up I', dict(member_type='flexure', design_method='LRFD', Fy=55.0, Fu=70.0, Lb=0.0, Cb=1.0,
                               section_type='I', Mu=150.0, wc_P=1.0, wc_M=150.0,
                               props=dict(A=1.762, Sf=4.58, rx=3.42, ry=1.2, J=0.002, Cw=30.0, xo=0.0,
                                          t=0.059, R=0.1875, h_web=8.51, b_flange=4.6, d_lip=0.53),
                               section=dict(type='I', depth=9.0, flange_width=5.0, lip_depth=0.773,
                                            thickness=0.059, r=0.1875),
                               dsm=dict(Mcrl=169.0, Mcrd=215.0), wc_N=3.5, wc_R=0.15, wc_support='IOF',
                               wc_fastened='unfastened')))
    a(('H3 multi-web ETF Z', {
        'member_type': 'flexure', 'design_method': 'LRFD', 'Fy': 50, 'Fu': 65, 'Mu': 8.0, 'Vu': 2.0,
        'Lb': 48.0, 'section_type': 'Z', 'wc_N': 3.5, 'wc_R': 0.1875, 'wc_support': 'ETF',
        'wc_fastened': 'unfastened', 'wc_web_config': 'multi_web', 'wc_section_family': 'multi_web',
        'wc_n_webs': 3,
        'props': {'A': 1.0, 'Sf': 2.0, 'Ixx': 8.0, 'Izz': 2.0, 'Ixz': 0.0, 'I22': 2.0,
                  'J': 0.01, 'Cw': 5.0, 'xo': 0.0, 'h_web': 7.5, 't': 0.06},
        'section': {'type': 'Z', 'depth': 8.0, 'flange_width': 2.25, 'lip_depth': 0.75, 'thickness': 0.06},
        'dsm': {'Mcrl': 150.0, 'Mcrd': 180.0}}))
    a(('H2 Manual II-2A lap end ASD', dict(member_type='flexure', design_method='ASD', Fy=55.0, Fu=70, Lb=49.1,
                                           Cb=1.67, Mu=3.892 * 12, Vu=1.187, section_type='Z', props=dict(ZP),
                                           section=dict(Z8_SECTION), dsm=dict(Mcrl=91.0, Mcrd=101.0))))
    a(('H2-2 stiffened', dict(member_type='flexure', design_method='ASD', Fy=55.0, Fu=70, Lb=49.1, Cb=1.67,
                              Mu=3.892 * 12, Vu=2.0, transverse_stiffeners=True, section_type='Z', props=dict(ZP),
                              section=dict(Z8_SECTION), dsm=dict(Mcrl=91.0, Mcrd=101.0))))
    a(('I6.2.1 uplift II-2A', dict(member_type='flexure', design_method='ASD', Fy=55, Fu=70, Lb=270.0, Cb=1.0,
                                   Mu=1.81 * 12, section_type='Z', props=dict(ZP), R_uplift=0.70,
                                   span_type='continuous', section=dict(Z8_SECTION),
                                   dsm=dict(Mcrl=91.0, Mcrd=101.0))))
    a(('I6.2.1 R exceeds table', dict(member_type='flexure', Fy=55, Fu=70, Lb=0.0001, Mu=30.0, section_type='C',
                                      props=dict(C9, t=0.059, R=0.1875), section=dict(C9_SECTION),
                                      dsm=dict(Mcrl=84.4, Mcrd=107.0), R_uplift=0.70)))
    a(('positive region governs', dict(member_type='flexure', Fy=55, Lb=56.3, Cb=1.67, Mu=50.0, Mu_pos=110.0,
                                       Lb_pos=0.0, section_type='C', props=dict(C9),
                                       dsm=dict(Mcrl=84.4, Mcrd=107.0, My=126.0))))
    a(('positive region Lb_pos missing', dict(member_type='flexure', Fy=55, Lb=56.3, Cb=1.67, Mu=50.0,
                                              Mu_pos=10.0, section_type='C', props=dict(C9),
                                              dsm=dict(Mcrl=84.4, Mcrd=107.0))))
    a(('flexure hat negative sign', dict(member_type='flexure', section_type='hat', H=3.0, B=4.0, D=1.0, t=0.06,
                                         r=0.1, Fy=50.0, Fu=65.0, Lb=0.0, Mu=-1.0)))
    a(('flexure unrestrained reference', dict(member_type='flexure', section_type='Z', Fy=55, Lb=0.0001, Mu=1.0,
                                              props=dict(A=0.822, Sf=1.94, rx=3.04, ry=0.83, ro=3.17, J=0.000954,
                                                         Cw=11.3, xo=0.0, I22=0.25),
                                              dsm=dict(Mcrl=91.0, Mcrd=101.0, M_reference_unsymm=1))))
    # --- 조합 (H1) · 인장 (D) ---
    for dm, P, M in (('ASD', 45.0, 15.0), ('LRFD', 69.0, 24.0)):
        a((f'III-11 RHS combined {dm}', dict(member_type='combined', design_method=dm, Fy=46.0, KxLx=120,
                                              KyLy=120, KtLt=120, Lb=120, Cb=1.0, Pu=P, Mux=M, Muy=0, Cmx=1.0,
                                              Cmy=1.0, section_type='RHS',
                                              props=dict(A=2.914, Sf=5.56, Ixx=16.69, Izz=16.69, rx=2.393,
                                                         ry=2.393, J=25.3, Cw=0.0),
                                              dsm=dict(Pcrl=52.20 * 2.914, Pcrd=0, Mcrl=52.20 * 5.56 * 2.0,
                                                       Mcrd=0))))
    a(('III-6 CHS combined LRFD', dict(member_type='combined', design_method='LRFD', Fy=42.0, KxLx=120,
                                       KyLy=120, KtLt=120, Lb=120, Pu=19.0, Mux=150.0, Cmx=1.0, Cmy=1.0,
                                       section_type='CHS', D=8.0,
                                       props=dict(A=2.482, Sf=4.84, Ixx=19.37, Izz=19.37, rx=2.794, ry=2.794,
                                                  J=38.74, Cw=0.0, t=0.1),
                                       section=dict(diameter=8.0, thickness=0.1, type='CHS'),
                                       dsm=dict(Pcrl=0.605 * 29500 * 0.1 / 3.95 * 2.482, Pcrd=0, Mcrl=0,
                                                Mcrd=0))))
    a(('combined angle (P)L/1000', dict(member_type='combined', design_method='ASD', Fy=50.0, KxLx=18.0,
                                        KyLy=18.0, KtLt=18.0, Lb=18.0, Pu=3.0, Mux=0.0, Muy=0.0, Cmx=1.0, Cmy=1.0,
                                        Fcre=40.0, section_type='lipped_angle', May_strength=4.97,
                                        props=dict(A=0.4, Sf=0.2, rx=0.8, ry=0.5, J=1e-3, Cw=1e-3, xo=0.5),
                                        dsm=dict(Pcrl=30.0, Pcrd=30.0, Mcrl=30.0, Mcrd=30.0))))
    a(('combined positive region fails', dict(member_type='combined', Fy=55, KxLx=56.3, KyLy=56.3, KtLt=56.3,
                                              Lb=56.3, Cb=1.67, Pu=0.1, Mux=50.0, Mu_pos=110.0, Lb_pos=0.0,
                                              Cmx=1.0, Cmy=1.0, section_type='C', props=dict(C9, xo=1.0),
                                              dsm=dict(Pcrl=1e4, Pcrd=1e4, Mcrl=84.4, Mcrd=107.0))))
    a(('combined with shear and M1/M2', dict(member_type='combined', design_method='LRFD', Fy=55, KxLx=96.0,
                                             KyLy=48.0, KtLt=48.0, Lb=48.0, Pu=3.0, Mux=30.0, Muy=2.0,
                                             May_strength=10.0, Vu=1.0, dist_M1_M2=0.5, section_type='C',
                                             props=dict(C9, xo=1.83, t=0.059, R=0.1875),
                                             section=dict(C9_SECTION),
                                             dsm=dict(Pcrl=1e4, Pcrd=1e4, Mcrl=1e4, Mcrd=1e4))))
    a(('combined tension + bending', dict(member_type='combined', design_method='LRFD', Fy=50.0, Fu=65.0,
                                          Lb=24.0, Pu=-10.0, Mux=40.0, An=0.8, section_type='C',
                                          props=dict(C9), dsm=dict(Mcrl=1e4, Mcrd=1e4))))
    for dm in ('LRFD', 'ASD'):
        a((f'tension D2/D3 {dm}', dict(member_type='tension', design_method=dm, Fy=50.0, Fu=65.0, Tu=10.0,
                                       An=0.70, props=dict(A=0.881))))
    a(('tension no Fu', dict(member_type='tension', Fy=50, Tu=30.0, props=dict(A=0.881))))
    a(('tension no An', dict(member_type='tension', Fy=50, Fu=65, Tu=30.0, props=dict(A=0.881))))
    a(('tension no demand', dict(member_type='tension', Fy=50, Fu=65, An=0.7, props=dict(A=0.881))))
    # --- 반올림 띠 안의 사례(§8.3.1 수정 3–6) — 옛 엔진은 반올림한 값으로 판정했다 ---
    a(('band: positive region ratio 1.000004', dict(member_type='flexure', Fy=55, Lb=56.3, Cb=1.67, Mu=50.0,
                                                    Mu_pos=83.2944, Lb_pos=0.0, section_type='C', props=dict(C9),
                                                    dsm=dict(Mcrl=84.4, Mcrd=107.0, My=126.0))))
    a(('band: H1.2 with rounded Pa/Max', dict(member_type='combined', design_method='LRFD', Fy=46.0, KxLx=120,
                                              KyLy=120, KtLt=120, Lb=120, Cb=1.0, Pu=69.0, Mux=43.00252593173444,
                                              Muy=0, Cmx=1.0, Cmy=1.0, section_type='RHS',
                                              props=dict(A=2.914, Sf=5.56, Ixx=16.69, Izz=16.69, rx=2.393,
                                                         ry=2.393, J=25.3, Cw=0.0),
                                              dsm=dict(Pcrl=52.20 * 2.914, Pcrd=0, Mcrl=52.20 * 5.56 * 2.0,
                                                       Mcrd=0))))
    a(('band: web crippling Pn rounded', dict(member_type='flexure', design_method='LRFD', Fy=50, Lb=0.0001,
                                              section_type='C', Mu=1.0, wc_P=1.1797,
                                              props=dict(C9, t=0.059, R=0.1875, h_web=8.51, b_flange=1.98,
                                                         d_lip=0.53),
                                              section=dict(C9_SECTION), dsm=dict(Mcrl=1e4, Mcrd=1e4), wc_N=3.0,
                                              wc_R=0.1875, wc_support='EOF', wc_fastened='fastened')))
    a(('combined angle (P)L/1000 fails', dict(member_type='combined', design_method='ASD', Fy=50.0, KxLx=18.0,
                                              KyLy=18.0, KtLt=18.0, Lb=18.0, Pu=3.0, Mux=0.0, Muy=1.5, Cmx=1.0,
                                              Cmy=1.0, Fcre=40.0, section_type='lipped_angle', May_strength=1.0,
                                              props=dict(A=0.4, Sf=0.2, rx=0.8, ry=0.5, J=1e-3, Cw=1e-3, xo=0.5),
                                              dsm=dict(Pcrl=30.0, Pcrd=30.0, Mcrl=30.0, Mcrd=30.0))))
    # --- 퍼린(하중 해석 뒤 구간 설계 — StcfsdPanel 이 보내는 꼴) ---
    zr = dict(member_type='flexure', design_method='ASD', Fy=55.0, Fu=70.0, section_type='Z', props=dict(ZP),
              section=dict(Z8_SECTION))
    a(('purlin negative region (M_max)', dict(zr, Lb=49.1, Cb=1.67, Mu=4.65 * 12, Vu=1.5, moment_sign='-',
                                              dist_M1_M2=0.0, dist_Lm=49.1,
                                              dsm=dict(Mcrl=91.0, Mcrd=101.0, Lcrd=20.8, M_Lcrl=5.1,
                                                       M_Lcrd=20.8, M_sign='-'))))
    a(('purlin lap region (half M)', dict(zr, Lb=0, Cb=1.0, distortional_not_applicable=True,
                                          Mu=0.5 * 5.5 * 12, Vu=0.5 * 2.2, moment_sign='-',
                                          dsm=dict(Mcrl=91.0, M_sign='-'))))
    # 2026-11-24 V6b-04 (계약 §6.3): 랩 구간은 사람이 밝힌 구속만 쓴다
    a(('purlin lap region stated', dict(zr, lap_region=True, lap_restrained=True,
                                        Mu=0.5 * 5.5 * 12, Vu=0.5 * 2.2, moment_sign='-',
                                        dsm=dict(Mcrl=91.0, M_sign='-'))))
    a(('purlin lap region unstated', dict(zr, lap_region=True,
                                          Mu=0.5 * 5.5 * 12, Vu=0.5 * 2.2, moment_sign='-',
                                          dsm=dict(Mcrl=91.0, M_sign='-'))))
    # V6b-03: 휨 소요 없이 전단만 · 웹 크리플링만
    a(('flexure V only (Mu = 0)', dict(zr, Lb=49.1, Cb=1.67, Mu=0.0, Vu=1.2, dsm=dict(Mcrl=91.0, Mcrd=101.0))))
    # V6b-02: 축마다의 Cm 끝 모멘트 비
    a(('combined Cmy from its own ratio', dict(member_type='combined', design_method='LRFD', Fy=55, KxLx=48.0,
                                               KyLy=96.0, KtLt=48.0, Lb=48.0, Pu=4.0, Mux=5.0, Muy=2.0,
                                               May_strength=10.0, Cmx_M1_M2=-0.5, Cmy_M1_M2=0.5, dist_M1_M2=0.3,
                                               section_type='C', props=dict(C9),
                                               dsm=dict(Pcrl=20.0, Pcrd=25.0, Mcrl=84.4, Mcrd=107.0))))
    a(('purlin positive region uplift R', dict(zr, Lb=270.0, Cb=1.0, Mu=1.81 * 12, R_uplift=0.70,
                                               span_type='continuous', dsm=dict(Mcrl=91.0, Mcrd=101.0))))
    a(('purlin support with wc', dict(zr, Lb=49.1, Cb=1.67, Mu=4.0 * 12, Vu=1.4, moment_sign='-',
                                      wc_N=3.0, wc_R=0.1875, wc_support='IOF', wc_fastened='fastened',
                                      wc_P=2.4, wc_M=4.0 * 12, dsm=dict(Mcrl=91.0, Mcrd=101.0, M_sign='-'))))
    # --- 자동 단면(템플릿 · FSM) — 기본 단면, 둥근 모서리, 날카로운 모서리 ---
    a(('default lippedc compression (auto FSM)', dict(DEFAULT_LIPPEDC, member_type='compression', Pu=20.0,
                                                      KxLx=118.11, KyLy=59.06, KtLt=59.06)))
    a(('default lippedc flexure (auto FSM)', dict(DEFAULT_LIPPEDC, member_type='flexure', Mu=30.0, Lb=59.06,
                                                  Cb=1.0)))
    a(('rounded-corner lippedc KL100 (auto FSM)', dict(member_type='compression', section_type='lippedc', H=8.0,
                                                       B=2.5, D=0.625, t=0.059, r=0.157, Fy=50.0, Fu=65.0, Pu=1.0,
                                                       KxLx=100.0, KyLy=100.0, KtLt=100.0)))
    a(('sharp lippedz combined (auto FSM)', dict(member_type='combined', section_type='lippedz', H=8.0, B=2.25,
                                                 D=0.91, t=0.059, r=0.0, Fy=55.0, Fu=70.0, Pu=1.0, Mux=10.0,
                                                 Cmx=1.0, Cmy=1.0, KxLx=60.0, KyLy=60.0, KtLt=60.0, Lb=60.0)))
    a(('I-8B lippedc ASD flexure (auto FSM)', dict(section_type='lippedc', H=9.0, B=2.5, D=0.773, t=0.059,
                                                   r=0.1875, Fy=55.0, Fu=70.0, design_method='ASD',
                                                   member_type='flexure', Lb=0.0, Mu=1.0)))
    return [(name, 'aisi_design', p) for name, p in c]


def _iv1(dm, t1, t2, **kw):
    return dict(connection_type='fillet_weld', design_method=dm, Fy=50, Fu=65, t1=t1, t2=t2, weld_size=0.105,
                weld_length=2.25, n=2, member_case='flat_sheet', **kw)


def _iv2(dm, **kw):
    return dict(dict(connection_type='arc_spot', design_method=dm, Fy=33, Fu=45, t1=0.060, t2=0.105, da=0.625,
                     de=0.375, Fxx=60, n=2, e=1.25, width=3.75, g=1.25, member_case='flat_sheet',
                     joint='sheet_to_support'), **kw)


def _iv3(dm, **kw):
    return dict(dict(connection_type='arc_seam', design_method=dm, Fy=50, Fu=65, t1=0.060, t2=0.105, da=0.50,
                     weld_length=1.5, n=1, e=1.75, width=4.5, edge_transverse=2.25, member_case='flat_sheet',
                     joint='sheet_to_support'), **kw)


def _iv9(dm, **kw):
    return dict(dict(connection_type='bolt', design_method=dm, Fy=33, Fu=45, t1=0.105, t2=0.105, d=0.5, n=2,
                     e=1.0, s=2.0, bolt_grade='A307', mf=1.0, Ag=0.42, width=4.0, g=2.0,
                     member_case='flat_sheet', edge_transverse=1.0), **kw)


def _iv11(dm, **kw):
    return dict(dict(connection_type='screw', design_method=dm, Fy=55, Fu=65, Fu1=65, Fu2=45, Fy1=55, Fy2=36,
                     t1=0.0285, t2=0.0713, d=0.216, dw=0.340, e=0.75 + 0.108, Pnvs=2.00, Pnts=2.78,
                     width=12.0, member_case='flat_sheet', n=1), **kw)


def _iv12(dm, **kw):
    return dict(dict(connection_type='paf', design_method=dm, Fy=55, Fu=65, Fy2=50, t1=0.036, t2=0.25, d=0.180,
                     HRC_p=56, dw=0.340, e=1.0, width=12.0, member_case='flat_sheet', n=1, Pnot_test=1.97), **kw)


def _connections():
    c = []
    a = c.append
    for dm in ('ASD', 'LRFD'):
        a((f'IV-1 fillet {dm}', _iv1(dm, 0.060, 0.105, Pu=4.0)))
        a((f'IV-1 fillet member tension {dm}', _iv1(dm, 0.060, 0.105, member_tension=True, width=2.5, Pu=4.0)))
        a((f'IV-2 arc spot {dm}', _iv2(dm, Pu=1.5)))
        a((f'IV-2 arc spot V+T {dm}', _iv2(dm, Vu=1.08 if dm == 'LRFD' else 1.30, Tu=2.00 if dm == 'LRFD' else 0.90)))
        a((f'IV-3 arc seam {dm}', _iv3(dm, Pu=2.80 if dm == 'ASD' else 4.20)))
        a((f'IV-4 flare bevel {dm}', dict(connection_type='groove', design_method=dm, Fy=50, Fu=65, t1=0.060,
                                          t2=0.105, groove_type='flare_bevel', load_direction='transverse',
                                          weld_length=3.14 if dm == 'ASD' else 3.08, Pu=3.5)))
        a((f'IV-9 bolt {dm}', _iv9(dm, member_tension=True, Ae=0.42, Pu=3.5)))
        a((f'IV-11 screw V+T {dm}', _iv11(dm, Vu=0.300 if dm == 'ASD' else 0.500,
                                          Tu=0.135 if dm == 'ASD' else 0.225)))
        a((f'IV-12 PAF V+T {dm}', _iv12(dm, Vu=0.213 if dm == 'ASD' else 0.355, Tu=0.114 if dm == 'ASD' else 0.190)))
    a(('IV-2 overload fails', _iv2('ASD', Pu=2.5)))
    a(('IV-2 tension direction', _iv2('ASD', Pu=1.0, force_direction='tension')))
    a(('IV-10 bolted angle', dict(connection_type='bolt', design_method='ASD', Fy=33, Fu=45, t1=0.060, t2=0.097,
                                  d=0.5, n=2, e=1.5, bolt_grade='A307', Ag=0.351, n_rows_long=2, pitch=3.0,
                                  member_case='angle_bolted', b1=3.0, b2=3.0, x_bar=0.785, edge_transverse=1.5,
                                  Pu=2.0)))
    a(('IV-10 missing member_case', dict(connection_type='bolt', design_method='ASD', Fy=33, Fu=45, t1=0.060,
                                         t2=0.097, d=0.5, n=2, e=1.5, bolt_grade='A307', Ag=0.351, n_rows_long=2,
                                         pitch=3.0, b1=3.0, b2=3.0, x_bar=0.785, edge_transverse=1.5, Pu=1.0)))
    a(('bolt J3.4 interaction fails', dict(connection_type='bolt', design_method='LRFD', t1=0.105, t2=0.105,
                                           d=0.5, Fy=50, Fu=65, bolt_grade='A307', e=2.0, n=1,
                                           member_case='not_tension_member', j6_3_not_applicable=True,
                                           Pnov_bolt=10.0, Vu=3.8, Tu=3.0)))
    a(('bolt assumed e (not decided)', dict(connection_type='bolt', design_method='LRFD', t1=0.06, t2=0.06,
                                            d=0.5, Fy=33, Fu=45, bolt_grade='A307', n=1,
                                            member_case='not_tension_member', j6_3_not_applicable=True, Pu=1.2)))
    a(('bolt part 2 J6', dict(connection_type='bolt', design_method='LRFD', t1=0.06, t2=0.10, d=0.5, Fy=33,
                              Fu=45, bolt_grade='A307', n=1, e=2.0, member_case='not_tension_member',
                              j6_3_not_applicable=True, Pu=1.0,
                              j6_part2={'t': 0.10, 'Fu': 45, 'Fy': 33, 'e': 0.75,
                                        'member_case': 'not_tension_member', 'j6_3_not_applicable': True})))
    a(('bolt 2x2 block shear', dict(connection_type='bolt', design_method='LRFD', t1=0.06, t2=0.06, d=0.5,
                                    Fy=33.0, Fu=45.0, n=4, n_rows_long=2, pitch=2.0, e=1.0, g=2.0, width=4.0,
                                    member_case='flat_sheet', bolt_grade='A307', Pu=3.0,
                                    consider_hole_deformation=True)))
    a(('bolt short e fails', _iv9('ASD', e=0.5, Pu=1.0)))
    a(('bolt thick (AISC scope)', _iv9('ASD', t1=0.25, t2=0.25, Pu=1.0)))
    a(('screw no Pnvs (assumed)', dict(connection_type='screw', design_method='LRFD', t1=0.059, t2=0.059, d=0.19,
                                       Fy=50, Fu=58, n=1, e=1.0, member_case='not_tension_member', Pu=0.73)))
    a(('screw J4.5.1 rational', dict(connection_type='screw', design_method='ASD', Fy=55, Fu=65, t1=0.0236,
                                     t2=0.0713, d=0.216, dw=0.340, e=1.0, Pnvs=2.0, Pnts=2.78,
                                     member_case='not_tension_member', n=1, Vu=0.10, Tu=0.05)))
    a(('screw out of scope d', dict(connection_type='screw', t1=0.059, t2=0.059, d=0.375, Fy=35.53, Fu=58.02,
                                    n=1, Pu=0.1, Pnvs=5.0, e=1.0, width=6, member_case='flat_sheet')))
    a(('PAF thin t2 not evaluated', _iv12('LRFD', t2=0.08, Pu=0.2)))
    a(('arc spot sheet-to-sheet', dict(connection_type='arc_spot', design_method='LRFD', Fy=33, Fu=45, t1=0.048,
                                       t2=0.048, da=0.75, n=1, joint='sheet_to_sheet', Pu=1.0)))
    a(('arc spot multi sheet', dict(connection_type='arc_spot', design_method='ASD', Fy=33, Fu=45, t1=0.03,
                                    t2=0.25, t_sheets=[0.03, 0.03], da=0.75, n=1, e=1.5, width=4.0,
                                    member_case='flat_sheet', edge_transverse=2.0, Pu=0.5, Tu=0.2)))
    a(('fillet angle welded', dict(connection_type='fillet_weld', design_method='ASD', Fy=50, Fu=65, t1=0.06,
                                   t2=0.105, weld_size=0.06, weld_length=3.0, n=2, member_case='angle_welded',
                                   Ag=0.351, x_bar=0.785, L_conn=3.0, Pu=1.0)))
    a(('fillet thick t_joint', dict(connection_type='fillet_weld', design_method='LRFD', Fy=50, Fu=65, t1=0.12,
                                    t2=0.135, weld_size=0.25, weld_length=2.0, n=1, member_case='not_tension_member',
                                    joint_type='t_joint', Pu=2.0)))
    a(('groove CJP tension', dict(connection_type='groove', design_method='LRFD', Fy=50, Fu=65, t1=0.06, t2=0.06,
                                  weld_length=2.0, groove_type='complete', load_direction='tension',
                                  member_case='not_tension_member', j6_3_not_applicable=True, Pu=3.0)))
    a(('groove CJP shear', dict(connection_type='groove', design_method='ASD', Fy=50, Fu=65, t1=0.06, t2=0.06,
                                weld_length=2.0, groove_type='complete', load_direction='shear',
                                member_case='not_tension_member', j6_3_not_applicable=True, Pu=1.0)))
    a(('flare V longitudinal', dict(connection_type='groove', design_method='LRFD', Fy=50, Fu=65, t1=0.12, t2=0.12,
                                    weld_length=2.0, groove_type='flare_v', load_direction='longitudinal', R=0.25,
                                    R2=0.30, d1=0.02, d2=0.10, process='GMAW', member_case='not_tension_member',
                                    j6_3_not_applicable=True, Pu=1.0)))
    a(('flare V transverse n/e', dict(connection_type='groove', design_method='ASD', Fy=50, Fu=65, t1=0.06,
                                      t2=0.06, weld_length=3.0, groove_type='flare_v', load_direction='transverse',
                                      Pu=1.0, member_case='not_tension_member', j6_3_not_applicable=True)))
    a(('connection no demand', _iv9('ASD')))
    a(('band: IV-9 J6.1 design strength rounded', _iv9('ASD', Pu=3.6712)))
    # --- 나머지 id · 계산 과정을 지나는 사례(2026-11-23 두 번째 묶음에서 더함)
    a(('arc seam sheet-to-sheet', dict(connection_type='arc_seam', design_method='LRFD', Fy=33, Fu=45, t1=0.048,
                                       t2=0.048, da=0.5, weld_length=1.0, n=1, joint='sheet_to_sheet', e=1.0,
                                       member_case='not_tension_member', j6_3_not_applicable=True, Pu=1.0)))
    a(('flare bevel weld-metal cap', dict(connection_type='groove', design_method='LRFD', Fy=50, Fu=65, t1=0.12,
                                          t2=0.25, weld_length=2.0, groove_type='flare_bevel',
                                          load_direction='longitudinal', w1=0.05, w2=0.06, R=0.1875, process='GMAW',
                                          member_case='not_tension_member', j6_3_not_applicable=True, Pu=1.0)))
    a(('bolt part 2 J6.2 J6.3', dict(connection_type='bolt', design_method='ASD', Fy=33, Fu=45, t1=0.06, t2=0.10,
                                     d=0.5, n=2, e=1.0, s=2.0, g=2.0, bolt_grade='A307', width=4.0,
                                     member_case='flat_sheet', edge_transverse=1.0, Pu=1.0,
                                     j6_part2={'t': 0.10, 'Fu': 45, 'Fy': 33, 'e': 1.0, 'width': 4.0, 'g': 2.0,
                                               'member_case': 'flat_sheet', 'edge_transverse': 1.0})))
    a(('bolt oversized holes', _iv9('LRFD', hole_type='oversized', Pu=2.0)))
    a(('screw two in a row', _iv11('LRFD', n=2, s=1.0, Vu=0.5)))
    a(('PAF two with spacing', _iv12('LRFD', n=2, s=1.5, Vu=0.3)))
    a(('arc spot small de', dict(connection_type='arc_spot', design_method='ASD', Fy=33, Fu=45, t1=0.06, t2=0.105,
                                 da=0.5, n=1, e=1.0, joint='sheet_to_support', member_case='not_tension_member',
                                 j6_3_not_applicable=True, Pu=0.5)))
    a(('groove PJP no te', dict(connection_type='groove', design_method='LRFD', Fy=50, Fu=65, t1=0.06, t2=0.06,
                                weld_length=2.0, groove_type='partial', load_direction='tension', Pu=0.5)))
    a(('fillet member tension no Ag', _iv1('ASD', 0.060, 0.105, member_tension=True, Pu=1.0)))
    a(('fillet V and T', _iv1('ASD', 0.060, 0.105, Vu=1.0, Tu=0.5)))
    return [(name, 'design_connection', p) for name, p in c]


def _laps():
    c = [
        ('lap bolt no Se', dict(_LAP)),
        ('lap bolt Se e=2', dict(_LAP, end_distance=2.0, Se=3.0)),
        ('lap bolt Se Mnd', dict(_LAP, end_distance=2.0, Se=3.0, Mnd=100.0)),
        ('lap bolt Sf only', dict(_LAP, end_distance=2.0, Sf=3.0)),
        ('lap bolt short e', dict(_LAP, end_distance=0.5, Se=3.0)),
        ('lap bolt short lap', dict(_LAP, lap_left_in=10, lap_right_in=10, end_distance=2.0, Se=3.0)),
        ('lap screw Pnvs ASD', dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=24, lap_right_in=24,
                                    Mu_support=5.5 * 12, Vu_support=2.2, fastener_type='screw', fastener_dia=0.19,
                                    n_rows=2, end_distance=0.75, Pnvs=2.0, Se=1.8, Mnd=85.0,
                                    design_method='ASD')),
        ('lap screw no Pnvs', dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=24, lap_right_in=24,
                                   Mu_support=40.0, Vu_support=2.0, fastener_type='screw', fastener_dia=0.19,
                                   n_rows=2, Se=1.8)),
        ('lap overload fails', dict(_LAP, end_distance=2.0, Se=0.5, Mu_support=200.0)),
    ]
    return [(name, 'lap_connection', p) for name, p in c]


def _others():
    """설계 결과가 아니지만 같은 변경을 지나는 것 — 값이 그대로인지만 본다."""
    c = []
    for st, prm in (('lippedc', dict(H=8.0, B=2.5, D=0.625, t=0.059, r=0.157)),
                    ('lippedc', dict(H=8.0, B=2.5, D=0.0, t=0.059, r=0.1)),
                    ('lippedz', dict(H=8.0, B=2.25, D=0.91, t=0.059, r=0.1875, qlip=50)),
                    ('lippedz', dict(H=8.0, B=2.25, D=0.0, t=0.059, r=0.0)),
                    ('track', dict(H=6.0, B=1.625, t=0.0566, r=0.0849)),
                    ('hat', dict(H=3.0, B=4.0, D=1.0, t=0.06, r=0.1)),
                    ('hat', dict(H=3.0, B=4.0, D=0.0, t=0.06, r=0.0)),
                    ('rhs', dict(H=6.0, B=4.0, t=0.125, r=0.1875)),
                    ('rhs', dict(H=6.0, B=4.0, t=0.125, r=0.0)),
                    ('chs', dict(OD=6.0, t=0.12)),
                    ('angle', dict(H=3.0, B=2.0, t=0.06, r=0.1)),
                    ('lipped_angle', dict(H=4.0, B=4.0, D=0.6, t=0.06, r=0.1)),
                    ('isect', dict(H=8.0, B=4.0, t=0.1)),
                    ('tee', dict(H=4.0, B=4.0, t=0.1))):
        c.append((f'template {st} {sorted(prm.items())}', 'generate_section',
                  dict(section_type=st, params=prm)))
    c.append(('analyze_loads II-2A purlin with laps', 'analyze_loads', dict(
        member_app='roof-purlin', span_type='cont-4', span_ft=25.0, loads={'D': 15, 'Lr': 100},
        design_method='ASD', laps={'left_ft': 1.0, 'right_ft': 2.5},
        deck={'type': 'through-fastened', 't_panel': 0.018, 'fastener_spacing': 12,
              'i621_conditions_confirmed': True},
        section={'depth': 8.0, 'flange_width': 2.25, 'thickness': 0.070, 'lip_depth': 0.91,
                 'R_corner': 0.1875, 'type': 'Z', 'Fy': 55, 'Fu': 70})))
    return c


def all_cases():
    """(name, server method, params). 이름은 유일하다."""
    cases = _member() + _connections() + _laps() + _others()
    names = [n for n, _, _ in cases]
    assert len(names) == len(set(names)), 'duplicate case name'
    return cases


def design_cases():
    """설계 결과를 내는 사례만 (design_checks 계약 대상)."""
    return [c for c in all_cases() if c[1] in ('aisi_design', 'design_connection', 'lap_connection')]


def run_case(method, params):
    """server.py 의 처리기를 거쳐 엄격 JSON 으로 왕복한 결과."""
    import copy
    import server
    result = server.METHODS[method](copy.deepcopy(params))
    text = json.dumps(server.to_jsonable(result, 'result'), allow_nan=False)
    return json.loads(text)


def capture(path):
    out = {}
    for name, method, params in all_cases():
        try:
            out[name] = {'ok': True, 'result': run_case(method, params)}
        except Exception as e:  # noqa: BLE001 — 기준선에는 예외도 그대로 남긴다
            out[name] = {'ok': False, 'error': f'{type(e).__name__}: {e}'}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, allow_nan=False, sort_keys=True)
    return out


def _same_scalar(a, b):
    if type(a) is not type(b):
        # JSON 은 1 과 1.0 을 가른다 — 정수 · 실수가 바뀌는 것도 변화로 본다.
        return False
    return json.dumps(a) == json.dumps(b)


IGNORE_KEYS = set()


def diff(old, new, path='', out=None, counter=None):
    """old 의 모든 키 · 원소가 new 에 같은 값으로 있는지. (차이 목록, 비교한 잎 수)."""
    if out is None:
        out = []
    if counter is None:
        counter = [0]
    if isinstance(old, dict):
        if not isinstance(new, dict):
            out.append((path, 'type', type(old).__name__, type(new).__name__))
            return out, counter
        for k, v in old.items():
            if k in IGNORE_KEYS:
                continue
            if k not in new:
                out.append((f'{path}.{k}', 'missing', v, None))
            else:
                diff(v, new[k], f'{path}.{k}', out, counter)
    elif isinstance(old, list):
        if not isinstance(new, list) or len(new) != len(old):
            out.append((path, 'list', len(old), len(new) if isinstance(new, list) else type(new).__name__))
            return out, counter
        for i, (a, b) in enumerate(zip(old, new)):
            diff(a, b, f'{path}[{i}]', out, counter)
    else:
        counter[0] += 1
        if not _same_scalar(old, new):
            out.append((path, 'value', old, new))
    return out, counter


def compare(base_path, new_path):
    with open(base_path, encoding='utf-8') as f:
        base = json.load(f)
    with open(new_path, encoding='utf-8') as f:
        new = json.load(f)
    diffs, counter = diff(base, new, 'cases')
    return len(base), counter[0], diffs


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(os.path.dirname(here))
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'capture':
        py_root = sys.argv[3] if len(sys.argv) > 3 else os.path.join(root, 'python')
        sys.path.insert(0, py_root)
        res = capture(sys.argv[2])
        bad = [k for k, v in res.items() if not v['ok']]
        print(f'captured {len(res)} cases from {py_root}; exceptions: {bad}')
    elif cmd == 'compare':
        # 선택: --ignore=key1,key2 (예: design_checks — 계약 자체가 바뀐 비교에서 엔진 값만 볼 때)
        for arg in sys.argv[4:]:
            if arg.startswith('--ignore='):
                IGNORE_KEYS.update(x for x in arg[len('--ignore='):].split(',') if x)
        limit = 400 if '--all' in sys.argv else 50
        n, leaves, diffs = compare(sys.argv[2], sys.argv[3])
        for d in diffs[:limit]:
            print('DIFF', d)
        print(f'cases {n}, baseline leaves compared {leaves}, differences {len(diffs)}')
        sys.exit(1 if diffs else 0)
    else:
        print(__doc__)
        sys.exit(2)
