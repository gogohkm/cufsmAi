# F4 — 부재 설계(aisi_s100 · dsm_strength · global_buckling · interaction) 수정 기록

## 요약

고침 26 (R4-15 의 F2.1.2 구현만 보류) · 보류 0 · 기각 0 · 사용자 결정 필요 4 — 첫 묶음.
검증(V2 · V3) 뒤 둘째 묶음: 고침 17 (아래 「V2 · V3 검증 뒤 고친 것」), 사용자 결정 1 건 해소(§I6.2.1, 오케스트레이터 결정) · 1 건 추가(트랙 체결 웹 크리플링) — 열린 결정 4.

V4 검증 뒤 셋째 묶음: 고침 3 (V4-04, 계산서 단계, V4-18 웹 크리플링 하중 — 아래 「V4 검증 뒤 고친 것」).

새 시험 `test/python/test_review_1122_member.py` 44개 전부 통과. 전체 시험(마지막 실행)
`.venv\Scripts\python.exe test\python\run_all.py` → `Ran 386 tests in 77.205s` / `OK`
(바로 앞 실행은 F6 가 `connections.py` 를 고치던 중이라 접합부 시험 7건이 떨어졌고, 다시 돌려 통과).
`ruff check python test` → `All checks passed!`

판정 규칙(FIXES §3.1)을 압축·휨·조합·인장에 같은 헬퍼로 적용했다: `_merge_governing_check`(검토 하나를
판정·이용률·지배 검토에 합침, `limit_state_checks` 에 기록) · `_mark_not_evaluated`(해당하는데 평가하지 못한
한계상태를 `not_evaluated` 에 올림) · `_finalize_verdict`(불합격이 이기고, 미평가가 있으면 `pass=None`,
`utilization_valid=False`). 해당하지 않는 한계상태(립 없는 단면·폐단면의 E4/F4)는 미평가가 아니다.

강도식·φ/Ω 는 건드리지 않았다. 리뷰어 재현 스크립트(`scratchpad/review/R4/ex_repro.py`)의 매뉴얼 비교표는
아래 R4-03 의 반올림 영향(≤0.3 %) 말고는 같고, III-11 · III-6 · II-9 · II-8 이 이제 `pass=True` 다.
모든 행이 여전히 Manual 인쇄값 ±0.6 % 안이다(회귀 시험 `test_manual_examples_reproduce_printed_values`).

## 발견사항별

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| R4-01 | 고침 | `aisi_s100._design_compression/_design_flexure`: `classification_method`·`*_detected` 로 부재를 추론하던 코드 삭제. Pcrl/Mcrl 이 없으면 App.1 Eq.1.1-4 해석식(출처 `dsm_source`)→ 못 하면 E3/F3 미평가 | III-3 Pcrl=0, Pu=15: pass True(0.98) → None. 9CS2.5x059 KL=144 옛 dsm 출력: Pn 8.58 → 5.87 kips (≤ 올바른 6.49). 600S162-54: 11.47 → 8.19 (≤ 9.08) | `test_R4_01_*` |
| R4-02 | 고침 | `_design_flexure`: §G5 단독 검토 P̄ ≤ Pa(φw·Pn / Pn/Ωw)를 `G5 web crippling` 으로 합침. 새 선택 인자 `wc_P`(반력), `wc_M`(반력 위치 모멘트, 없으면 Mu + 경고) | 반력 1.15φwPn, M≈0: pass True(0.75) → False(1.15, 지배 G5) | `test_R4_02_web_crippling_alone_governs` |
| R4-03 / R8-02(엔진) | 고침 | `_design_compression`: Py = Ag·Fy, Pne = Ag·Fn. `_design_flexure`: My = Sf·Fy. DSM Py/My 는 비교만(±2 % 넘으면 경고, `fy_analysis` 있으면 비교), Pcrl/Mcrl/Pcrd/Mcrd 는 탄성값으로 그대로 | III-3 dsm.Py@70ksi: Pne 9.60 → 6.86 (Manual 6.88). 9CS 휨 dsm.My@70: My 160.3 → 125.95, Mn 107.4 → 92.55. 매뉴얼 표: III-14 Pne 37.40 → 37.35, II-2B Mne 107.0 → 106.7, Mn/Ω 48.94 → 48.86 (Manual Py·My 가 반올림값이라 생김) | `test_R4_03_R8_02_*` |
| R4-04 | 고침 | `global_buckling.resolve_xo_ro`: Zs−zcg 를 보고 대칭축(`symmetry_axis` x/z/none) 판정, 잡음 수준 xo 무시. `compute_column_Fcre`: 대칭축 z 면 σex↔σey 를 바꿔 E2.2, ro 재유도; 두 방향 편심이면 E2.4 미지원 | III-3 을 90° 돌린 모델: Fcre 24.42 → 18.53 (Manual 18.5), Pne 8.96 → 6.86 | `test_R4_04_*` (회전 불변 포함) |
| R4-05 | 고침 | `_design_combined`: 면제 아닌 앵글은 Muy=0 이어도 `May_strength` 필수(없으면 error), 추가 모멘트에 B1: B1y·(Muy+P̄L/1000). 면제는 등변(단축대칭) 무보강 앵글 + Pnl=Pne 로 한정(`_angle_l1000_exempt`). 압축 단독 앵글은 H1.2 미평가 | lipped angle, Muy=0: My 항 0 → B1y·PL/1000/May | `test_R4_05_*` |
| R4-06 / R8-11 | 고침 | `design_member`: props·A 가 없으면 `section_type` 과 템플릿 치수(H,B,t / lipped·hat 은 D / CHS 는 D,t)가 모두 있을 때만 생성, 아니면 error. 생성하면 `auto_generated_section`·`section_source='auto-template'`·경고. `Fy` 없으면 error | 기본 C 단면 Pn 9.34(경고 없음) → error | `test_R4_06_R8_11_no_default_section` |
| R4-07 / R5-25 | 고침 | `_design_flexure`: G2 전단·G5·H3(Mnfo 포함)에 virgin Fy·virgin 상태 사용 | 웹 크리플링 Pn 1.05 → 1.01 (virgin 과 같음) | `test_R4_07_R5_25_*` |
| R4-08 | 고침 | B4 초과·미평가 표시가 False 를 덮지 않음(`_mark_not_evaluated`), 보고서 None → 'N/A' | 이용률 6.54: pass None → False | `test_R4_08_*` |
| R4-09 | 고침 | `_distortional_applicability`(형상 기준: RHS/CHS/트랙/앵글/티 해당 없음, 립 있으면 해당, C/Z 는 립 0 이 명시될 때만 제외, hat·I 는 립 정보가 있을 때만). 해당 없으면 Pnd=Py/Mnd=My 를 미평가로 두지 않음. 값이 주어지면 그대로 씀(II-4B) | III-11/III-6/II-9/II-8: pass None → True | `test_R4_09_*`, 매뉴얼 시험 |
| R4-10 | 고침 | `_section_geometry`: CHS·hat 에서 `params['D']` 를 립으로 읽지 않음, 폐단면·트랙·앵글·티의 립 정보 무시. `check_dsm_limits`: 원형관은 판요소 검사 안 함. `_design_flexure`: 원형관은 `compute_beam_Fcre` 를 부르지 않고 F2.3 문구 | CHS: 거짓 'Lip d/t=79' → 없음, pass None → True | `test_R4_10_*`, 매뉴얼 시험 |
| R4-11 | 고침 | `check_dsm_limits`: 립 있음 b/t ≤ 160, RHS·hat 보강 w/t ≤ 500, 무립 개단면 d/t ≤ 60(I·T 는 돌출부 b/2), 인장 제외 | 트랙 b/t 100: 경고 없음 → 'unstiffened … 60', pass None | `test_R4_11_*` |
| R4-12 | 고침 | 인장: An 없으면 An=Ag + 경고, Fu 없으면 D3 미평가(`Tn_rupture=None`). 압축: 빠진 길이마다 경고 + E2 판정 보류. 휨: Lb 기본 → F2 판정 보류, `cantilever=True` 면 Cb=1, Cb∉[1,3] 경고, `Mu_pos` 있는데 `Lb_pos` 없으면 정모멘트 구간 판정 보류. `global_buckling`: rx/ry/J/Cw 없으면 1e10 대신 `missing` → error, Z 의 I22 는 Ixx·Izz·Ixz 로, 휨 ry/rx 는 Izz/Ixx 로 유도 | III-3 rx 없음: Pne 10.41(+52 %) → error. Z(I22 없음): Pne 15.69 → 3.77 | `test_R4_12_defaults_are_flagged` |
| R4-13 | 고침 | `_check_i621_limits`: R ≤ 0.70, (a)~(f)·(o) 확인, 위반/미확인이면 I6.2.1 미평가. (g)~(n)·변곡점/캔틸레버 제외는 경고. C/Z 아니면 error | R=1.0: 경고 없음 → 'Table I6.2.1-1' + pass None | `test_R4_13_*` |
| R4-14 | 고침 | 정모멘트 구간을 `F positive region` 검토로 합침(조합도 이어받음), 조합은 하위의 H2/H3/G5/정모멘트 검토와 미평가를 모두 합침(`_merge_sub_verdicts`), 보고서에 지배 검토·미평가·경고 전체·H3 식별 라벨 | 이용률 0.59 → 1.32, 지배 '' → 'F positive region' | `test_R4_14_*` |
| R4-15 | 고침(F2.1.2 보류) | `_canonical_section_type`(+ `global_buckling._norm_sec`)로 표기 통일; hat 은 Xs/Zs 로 대칭축을 확인하면 E2.2 적용(직접 xo 만이면 미지원·판정 없음). F2.1.2 미구현 — 오류 문구에 FSM Mcre/Sf 를 Fcre 로 넣는 안내 | 'Z-section' 휨: Mne 0 → F2.1.3 | `test_R4_15_*` |
| R4-16 | 고침 | 단계 2a 를 식별로(F2.1.4 는 Lu·√(EGJIy)), E 를 상수에서, F2.3 단계 문구, I6.1.2 는 Fcre 를 입력했을 때만 인용(아니면 경고) | 문구만 | `test_R4_16_*` |
| R4-17 / §4.7 | 고침 | `print()` 3곳 삭제(경고·`_auto_error` 로), `compute_beam_Fcre._last_detail` 삭제 → `compute_beam_Fcre_detail()` 이 (Fcre, detail) 반환(옛 함수는 float 그대로) | — | `test_R4_17_*`, `test_auto_generate_reports_failures_in_result_not_stdout` |
| R4-18 | 고침 | 결과에 `not_checked` 목록, 구멍·E2.1.1·H4·B2 경고, Table B4.1-1 를 인장에 적용하지 않음 | 인장 B4 로 pass None → True | `test_R4_18_*` |
| R7-17 (호출자) | 고침 | `_out_to_out_dims`: App.2 해석식에 외-외 ho/bo/do 를 넘김(없으면 평탄폭 + 코너로 복원) | II-5 Fcrd = 46.5 ksi (Manual 46.5), 9CS 국부 Fcrl 5.78 → 5.13 ksi | `test_R7_17_*` |
| R5-01 / R3-01 (소비 측, §4.1) | 고침 | R4-01 과 같은 변경. F5 의 새 키를 소비: 단일 극소면 분리 안 된 모드는 min(해석식, `single_minimum_bound`), `boundary_minimum`·`reference_stress_consistent=False` 는 해당 한계상태 미평가, dsm `warnings` 전달 | 9CS KL=24 자동 경로: Pn 18.26 → 12.86 (R5-04 기준 12.91). 립C 8×2.5 r 0.157 KL 100: 12.76 → 9.99 | `test_F5_*`, `test_R3_01_rounded_corner_lipped_C_KL100` |
| §4.2 / R5-03 (F4 쪽) | 고침 | `_bending_reference_nodes`: 항복 모멘트와 휨 응력 모두 `unsymm=0`(구속 휨). `_auto_generate_props` 가 F5 진단 키를 `P_`/`M_` 로 옮기고, 분류에 `GBTConfig()` 대신 `None`(CUFSM 기본, F3) | Z 최대 \|σ\| 109.4 → 55.0 (=Fy) | `test_sec42_*` |
| R5-11 (소비 측) | 고침 | `_infer_web_crippling_family`: 정규 이름으로 'lippedz' → Z, 'isect' → built_up_i | — | `test_R4_15_*` |
| R5 교차 (5) A3.3.2 | 고침 | 냉간가공 게이트를 virgin Fy 와 Fya 두 응력 수준에서 확인(Manual I-16), 미평가 국부/뒤틀림이면 적용 안 함 | 보수 측(증가를 덜 허용) | 기존 `test_cold_work_uses_estimated_corner_ratio` |

부수 변경: grosprop 의 numpy 스칼라가 판정에 `np.bool_` 로 새어 JSON 직렬화가 깨지던 것을 막음(`_plain_scalars`, `test_auto_path_result_is_json_serialisable`). `Pn`/`Mn` 이 0 인데 원인이 E2/F2 미평가(미지원 단면·성질 부족)이면 `pass=False` 가 아니라 `None`(§3.1).

바로잡은 기존 시험(함수 안만, 까닭 주석 한 줄):
- `test_design_verification.test_unsupported_sections_require_rational_global_buckling_input`: cfsm_modal 라벨로 F4 부재를 인정하던 단언 → F4 미평가·pass None.
- `test_regression_0926.test_lb_default_warning` · `test_kl_default_warning` · `test_design_not_evaluated_flags` · `test_combined_propagates_sub_warnings`: `props={'A':1}` 처럼 필수 성질이 없는 입력(이제 오류)에 rx/ry/J/Cw/xo 를 넣음, KL 은 셋 다 주어야 경고가 없음, `dsm_source` 는 키만 확인(값이 없으면 'none').

## V2 · V3 검증 뒤 고친 것

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| V2-04 | 고침 | `_design_compression/_design_flexure`: 단일 극소를 분리되지 않은 모드의 **하한**으로만 쓴다(해석식이 그보다 낮을 때만 올림, 출처 `… (raised to single-minimum floor)`). 첫 묶음의 상한 처리는 방향이 반대였다(오케스트레이터 지시 정정) | Manual I-8B (9CS2.5x059 완전 횡지지, ASD): Pa 7.14 → 10.92 kips (Manual 10.8, +1.1 %). 자동 경로와 화면식 dsm(진단 키 없음)이 같은 값. 9CS KL 24: 12.86 → 18.96 (V2 독립 18.95). KL 144 는 6.47 그대로(≤ 6.49) | `test_V2_04_single_minimum_is_a_floor_not_a_cap`, `test_V2_04_manual_I_8B_two_sided_and_path_independent`(양쪽 ±3 %, Ma 55.4 도) |
| V2-01 | 고침 | `_auto_generate_props`: `qlip`·`nseg` 를 템플릿에 넘기고 `auto_generated_section` 에 기록, section 에도 `qlip` | 8ZS2.25x059 50° 립 Lb 12: Mn 83.00 → 75.67 (V2 독립 75.61) | `test_V2_01_auto_path_keeps_sloped_lips` |
| V2-02 | 고침 | `_design_flexure`: §H3 식을 단면 모양으로 정한다(맞댄 I → H3-2, hat 의 각 웹 → H3-1). `shear.web_crippling` 이 hat · built-up I · 돌출(G5-2)을 `h3_applicable=False` 로 두어도 계산(돌출은 Pn = Pnc), 가정은 `assumptions`. 그 밖의 `h3_applicable=False` 는 H3 미평가 | built-up I 2×9CS IOF: pass True(0.90) → False, H3-2 좌변 1.475 > 1.314 (V2 독립) | `test_V2_02_h3_evaluated_for_built_up_I_and_hat` |
| V2-03 | 고침 | `_check_i621_limits`: Table I6.2.1-1 값(`_i621_table_R`, 깊이 · C/Z · 새 선택 인자 `span_type` simple/continuous, 없으면 두 값 중 작은 쪽)과 비교, 넘으면 I6.2.1 미평가 | 9CS R 0.70: pass True(Mn 65.5) → None + 'Table I6.2.1-1 R=0.40' | `test_V2_03_i621_R_against_table` |
| V3-21 | 고침(오케스트레이터 결정) | R 경로 Mn = R·Mnlo (Eq. I6.2.1-1). Mne(LTB)·Mnd 와 비교하지 않음. R 이 없으면 지금처럼 F2 경로 | II-2A 내부 경간 8ZS2.25x059, Lb 270, R 0.70 연속, ASD: Mn = 0.70·Mnlo 60.22 kip-in, Ma 3.01 kip-ft ≥ 1.81 → 합격 (Mne 로 자르면 10배 넘게 불합격). Manual(EWM Se) 3.46 kip-ft | `test_V3_21_uplift_R_route_is_R_times_Mnlo` |
| V2-05 · V2-09 | 고침 | `_hat_geometry`: hat 은 템플릿 규약 H = 상판 폭, B = 깊이(웹), D = 브림. 이름 있는 키(params `top_width/depth/brim`, section `top_width/hat_depth/brim`)가 우선, 없으면 section.depth/flange_width/lip_depth 를 화면이 지금 보내는 대로 H/B/D 로 읽음. 브림은 립이 아니다(립은 `hat_lip_depth` 로만) → E4/F4 해당 없음. G2 전단은 웹 2개(RHS 도), 결과에 `shear.n_webs`·`Vn_per_web` | hat 3×4×1×0.06 IOF: G5 Pn 7.16 → 6.71 (V2 독립 6.71), G2 Vn 4.82 → 12.13 (V2 12.1), 화면 경로 압축 pass None → True. RHS G2 Vn ×2(두 웹) | `test_V2_05_V2_09_hat_dimensions` |
| V2-14 | 고침 | `check_dsm_limits`: hat 브림 비보강 d/t ≤ 60 | 경고 추가만 | (V2-05 시험의 hat 은 한계 안) |
| V2-06 | 고침 | 새 선택 인자 `moment_sign`(없으면 `Mu` 부호), dsm 의 `M_sign`(기본 '+'). x 축 대칭이 아닌 단면(hat · 앵글 · 티 · 모름)에서 부호가 다르면 F3/F4 미평가 + 경고. 결과 키 `moment_sign` | hat Mu −1: pass True → None | `test_V2_06_moment_sign_for_unsymmetric_sections` |
| V2-11 | 고침 | `_apply_fsm_diagnostics`: dsm `M_reference_unsymm == 1`(비구속 휨 응력의 Mcr)이면 FSM 값의 F3/F4 미평가 — 구속 My = Sf·Fy 와 섞지 않음 | 판정만 | `test_V2_11_*` |
| V2-16 | 고침 | `_auto_generate_props`: CHS 는 `OD` 만 넘김(기본 H 없음), 빠진 템플릿 치수를 기본값으로 채우지 않음(R2-20) | CHS 6×0.12 Fy 42 자동 경로: 오류 → Pn 92.29, Mn 167.06 (V2 독립, 0.0 %) | `test_V2_16_chs_auto_path` |
| V2-13 | 고침 | 정규 이름 표를 `global_buckling.CANONICAL_SECTION_NAMES`/`canonical_section_name()` 하나로(aisi 가 import). 'Z purlin', 'built-up I' 등 shear.py 의 별칭 추가 | 'Z purlin' 휨 Mne 0 → F2.1.3 | (R4-15 시험) |
| V2-10 · §3.1.1 | 고침 | 결과에 `assumptions` · `scope_notes` 추가. 구멍 · H4 · E2.1.1 · C1 B2 · D1 · "구멍 없는 웹"(G2/G5) → `scope_notes`; 템플릿 생성 · 해석식 대체(출처) · dsm 설명 · Cm=1.0 기본 · An=Ag · wc_M=Mu · E2.2 z 대칭축 · I6.1.2 · I6.2.1 (g)~(n) · H1.1 방법 → `assumptions`; 값·판정을 바꾼 것만 `warnings`. 조합은 하위 알림을 한 번만(`[압축]`·`[휨x]` 재부착 없음). 보고서에 세 목록 | 평범한 9CS 휨 실행: warnings 7 → 0 | `test_V2_10_notices_split_and_not_repeated` |
| W1 | 고침 | `spec_sections` 를 모든 결과에서 `sorted(set(...))` | 순서만 | V2-10 시험 |
| F6 후속 | 고침 | `cold_work_strength(..., buckling_precondition=<virgin 게이트>)`, 판단은 `fya_usable`(없으면 `applicable`) | 값 변화 없음 | 기존 `test_cold_work_uses_estimated_corner_ratio` · `test_R4_07_*` |
| F7 후속 | 고침 | 휨 국부 해석식 `calc_Fcrl(..., flexure=True)`(웹 응력 구배 k 24), `calc_Fcrd` 가 오류를 내면 F4/E4 미평가(기존 try → 미평가 경로 확인), 압축 `calc_Fcrd` 의 `notes` → `assumptions` | 휨 fallback Mcrl 이 커짐(II-5 5.74 → 35.7 ksi, FSM 42.8 이하). FSM Mcrl 이 있으면 무관 | — |
| 시험 보강 | 고침 | `test_R7_17` 에 국부 Fcrl(외-외, 9CS 5.13 ksi) 단언 추가 — 옛 코드에서 떨어진다. `test_R4_02` 의 φwPn 을 Table G5-2 손계산으로(ASD Pn/Ωw 도). 첫 묶음의 상한 시험(`test_F5_single_minimum_bound_caps…`)은 V2-04 로 지움 | — | — |

바로잡은 기존 시험(둘째 묶음, 함수 안만): `test_design_verification.test_unsupported_sections_require_rational_global_buckling_input`
(hat 의 립은 `hat_lip_depth` 로만 — 립 있는 hat 로 시험), `test_regression_0926.test_combined_propagates_sub_warnings`
(Cm 기본은 `assumptions`).

## V4 검증 뒤 고친 것

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| V4-04 | 고침 | `aisi_s100._design_flexure`: §H2 의 휨 강도를 Malo(§F3, Fn = Fy / Mne = My 의 국부좌굴 가용강도 = φ·Mnℓo 또는 Mnℓo/Ω, virgin 상태 — §H2 는 §A3.3.2 밖)로. 지배 강도 Ma(F2 · F3 · F4 · R 의 최소)를 쓰던 것을 바꿈. 새 선택 인자 `transverse_stiffeners`: 있으면 Malo = min(§F3, §F4) 이고 Eq. H2-2(0.6 M̄/Malo + V̄/Va ≤ 1.3, M̄/Malo > 0.5 이고 V̄/Va > 0.7 일 때만; 그 밖에는 V̄ ≤ Va) — `interaction.combined_bending_shear_stiffened` 신설, `shear_strength(…, transverse_stiffeners=)` 전달. 결과 `shear_interaction` 에 `Malo` · `Mnlo`, 계산서 단계 'Bending + Shear (§H2, Eq. H2-1/H2-2)' 에 Malo 식 · 조항 | Manual II-2A 안경간 랩 끝(8ZS2.25x059, ASD, M̄ 3.892 kip-ft, V̄ 1.187 kip, Va 2.43): H2 1.141 → 1.029 (Manual 자신의 DSM 값 II-2B 로 1.027; II-2A 의 0.925 는 유효폭법 Mnℓ 99 kip-in 이라 다름). Malo 45.29 → 51.51 kip-in | `test_V4_04_H2_uses_Malo_not_governing_strength`(Mnlo F3.2.1 · Va G2.1 손계산, H2-2 포함) |

| W3 (V4 뒤) 계산서 단계 | 고침 | `_design_flexure`: R 경로(§I6.2.1)의 단계를 보고 강도를 만든 길로 — 새 단계 '5a' Mnℓo(F3, Fn = Fy: My · Mcrl · λl · 식), '5b' Eq. I6.2.1-1(R · Table I6.2.1-1 의 행 `_i621_row_text` · Mn = R·Mnℓo · 조건 확인 상태). F2(LTB) · F3(Mne 기준) · F4 · DSM 최소 단계(2, 2a, 3, 4, 5)는 남기되 `not_used: True` · 이름 앞 "[참고 — §I6.2.1 이 대신함, 강도에 쓰지 않음]" · `controlling_mode` 삭제. `spec_sections` 에서 F2 · F2.4.2 · F4 · F4.3 을 빼고 F3.2 · I6.2.1. 다른 곳도 같은 원칙으로: 정모멘트 구간이 검토되면 단계 9(Fcre → Mne · Mnl · Mnd → φMn(+)), G5 단독 단계 10, H3 단계 11, 조합 H1.2 단계 12(B1x · 세 비 · 합). 해석식 대체(출처 표시) · hat(F2.1.2 미지원 → Mne 0 단계) · CHS(F2.3 단계) · RHS(F2.1.4 단계)는 이미 보고 값과 같은 길 | 값 변화 없음. II-2A 양력 R 경로 단계: 이전에는 'Global/LTB Mne 5.62 → Mn 5.62' 가 지배처럼 보였으나 이제 '5b Mn = 0.7 × 86.03 = 60.22', Mn/Ω 36.06 | `test_W3_steps_describe_the_reported_path` |
| V4-18 (엔진 쪽) | 고침(표시만) | `wc_N` 이 없으면 `not_checked` 에 'G5/H3 web crippling (no bearing length wc_N given)'(관형 · 앵글 · 티 제외). `not_evaluated` 에는 넣지 않았다 — 지점·집중하중 유무를 엔진이 모르므로 판정을 막지 않는다 | 판정 변화 없음 | 위 시험 |

| V4-18 나머지 (재검증) | 고침 | `_design_flexure`: 웹 크리플링 지압 하중 P̄ = `wc_P`(명시) → 없으면 Vu 를 쓰고 `assumptions` 에 "§G5/§H3: 웹 크리플링 하중으로 Vu = … kips 를 썼다 — 반력 · 집중하중(wc_P)을 주지 않음." → 둘 다 없으면 G5 · H3 미평가(0 하중 합격 금지). 축력 `Pu` 를 지압 하중으로 쓰던 마지막 대체는 지움(조합 부재에서 축력이 반력으로 쓰였다). 결과 `web_crippling.load` · `load_source`('wc_P' | 'Vu' | null) | wc_N 만 있고 wc_P · Vu 없음: G5 P = 0 → 합격처럼 보임 → 판정 없음. Vu 사용 시 값 그대로, 가정 표시 | `test_V4_18_web_crippling_load_source` (첫 묶음 `test_R4_02` 는 Pu 대신 wc_P 로) |

같은 대체가 다른 상호작용식에 있는지 확인했다.
- §H3: Eq. H3-1/2/3 의 Mnℓo 자리에 이미 `Mnfo`(Mne = My 의 국부 강도, 공칭, virgin)를 쓴다 — 원문과 같다. H3 의 M̄ ≤ Malo 는 주 휨 검토(M̄ ≤ φMn, Mn ≤ Mnℓo)에 포함된다.
- §H1.2 · §H1.1: Max · May 는 원문이 "Chapter F 의 가용 휨강도" 로 정의하므로 지배 강도가 맞다. H1.1 의 Maxt 는 φb·Sft·Fy 그대로.
- §I6.2.1: Mn = R·Mnlo (V3-21 에서 고침).
- 남은 것(후속): 조합 부재(H1.2)의 H2 는 하위 휨 결과의 M̄ = Mux(증폭 전)를 쓴다. §C1 이 소요강도를 2차 효과 포함으로 정하므로 B1·Mux 를 써야 할 수 있다 — 같은 위치의 M̄ 인지(최대 모멘트 위치 대 전단 위치)는 호출자가 알므로 다음 묶음에서 정한다.

## 후속 — 다른 곳이 따라와야 하는 것

**둘째 묶음에서 더해진 것 (W2 MCP · W3 화면)**
- 결과의 알림이 셋이다: `warnings`(값·판정을 바꾼 것), `assumptions`(이 실행의 가정), `scope_notes`(늘 참인 범위). 화면과 MCP 는 세 목록을 다 보여 줄 것 — 지금 `warnings` 만 그리면 템플릿 생성 · 해석식 대체 · Cm 기본 등이 화면에서 사라진다.
- 새 선택 인자: `span_type`('simple'|'continuous' — §I6.2.1 R 표 확인; 화면 퍼린 경로 `StcfsdPanel.ts` 의 `R_uplift` 호출과 `app.js:3634-3636` R 선택에 함께 보낼 것, 안 보내면 두 값 중 작은 쪽으로 확인해 연속 Z R 0.70 이 판정 없음이 된다), `moment_sign`('+'|'-'), dsm `M_sign`, `hat_lip_depth`, `shear_n_webs`, CHS `OD`, hat 이름 키(`top_width`, `depth`, `brim` / section `top_width`, `hat_depth`, `brim`).
- hat: 화면 `StcfsdPanel.ts:1540-1556` 은 `storedSection.H` 를 depth, `B` 를 flange_width, `D` 를 lip_depth 로 보낸다. 엔진은 이를 템플릿 H/B/D(상판 폭/깊이/브림)로 읽도록 맞췄으나, 화면은 section 에 `top_width`·`hat_depth`·`brim` 을 보내고 hat 에 `lip_depth` 를 보내지 말 것. `app.js:3808` analyzeLoads 의 depth 도 hat 이면 B.
- §I6.2.1: R 이 있으면 Mn = R·Mnlo 이고 LTB(Mne) 와 비교하지 않는다(V3-21). 퍼린 경로는 양력 영역의 R 을 하중 해석에서 받아 그대로 넘기면 된다.
- 휨 결과의 새 키 `moment_sign`, `shear.n_webs`·`Vn_per_web`; H3 를 F4 가 계산한 경우 `assumptions` 에 그 사실.
- 셋째 묶음: `shear_interaction.Malo` · `Mnlo`(H2 의 휨 강도 — 화면 · 보고서가 H2 행에 Ma 대신 이것을 보일 것), 새 선택 인자 `transverse_stiffeners`(웹 전단보강재; Eq. H2-2).
- 셋째 묶음: 단계에 `not_used: True` 가 있으면 화면 단계 카드가 흐리게(또는 "참고") 그릴 것 — R 경로의 F2/F4 단계. 새 단계 이름: '5a Mnℓo …', '5b Uplift R-factor (§I6.2.1, Eq. I6.2.1-1)', 'Positive-moment region …', 'Web crippling (§G5 …)', 'Bending + web crippling (§H3 …)', 'Bending + Shear (§H2 …)', 'Axial + bending interaction (§H1.2 …)'. `step` 값은 숫자 또는 '5a'/'5b' 문자열이다.
- 셋째 묶음(V4-18): `web_crippling.load` · `load_source` — 화면 웹 크리플링 행에 "P = … (wc_P | Vu 가정)" 으로 보일 것. 축력 `Pu` 는 더는 지압 하중으로 쓰지 않는다 — 퍼린 경로는 이미 `wc_P` 를 보낸다(W3), 직접 입력 화면은 반력 칸을 두거나 Vu 가정을 표시.
- **W2 MCP 설명**: `wc_N` 이 없을 때 §G5/§H3 은 이제 `not_checked` 에 오른다(`not_evaluated` 에는 오르지 않음 — 판정 불변). `aisi_design_flexure` 설명의 "미평가 목록에 오르지 않는 예외" 문장은 **그대로 맞다**(not_evaluated 아님) — 지우지 말고 "not_checked 에 표시된다" 를 덧붙이면 된다.
- **F5 `shear.py:450-455`**: hat · built-up I · 돌출의 `h3_applicable=False`("not implemented")를 이제 F4 가 계산한다. shear.py 가 `h3_equation_candidate` 를 단면 모양으로 정해 주면(built-up I → H3-2, hat → H3-1, 돌출 → 그 단면군) F4 의 대체를 지울 수 있다. 두 곳의 정규 이름 표는 `global_buckling.canonical_section_name` 하나로 합칠 것(V2-13).
- **F1 `python/engine/fsm_solver.py:564`**: ruff E741(`l`).
- 둘째 묶음 끝 전체 시험의 실패 2건은 W3 가 고치는 `StcfsdPanel.ts`·`app.js` 문자열 계약 시험이다.

**첫 묶음에서 적은 것**

- **`src/webview/StcfsdPanel.ts`**
  - `:1451-1506` DSM 을 해석 Fy 로 추출해 `Py`·`My` 를 보낸다 — 엔진은 이제 설계 Fy 로 다시 계산하고 어긋나면 경고한다. `fy_analysis` 와 F5 의 진단 키(`P_/M_single_minimum`, `_single_minimum_bound`, `_boundary_minimum`, `_reference_stress_consistent`, `_warnings`)를 `dsm` 에 실어 보낼 것(엔진이 읽는다). `:1949-2059` 퍼린 경로도 같다.
  - `:1435` cutwp 실패 시 `Xs = xcg` 로 채우지 말 것(E2.2 미평가 탐지가 막힘). `:1437` ro 는 x 편심만으로 만든다 — hat 처럼 대칭축이 z 인 단면은 엔진이 다시 유도하지만, ro 를 안 보내는 편이 낫다.
  - `:1578-1589` 립 추정: 트랙·RHS·사용자 단면에서 웹 절점을 립으로 잡고, `storedSection.D` 를 CHS(외경)·hat(하부 플랜지)의 립으로 보낸다. 엔진은 RHS/CHS/트랙/앵글/티의 립 정보를 무시하지만 hat·사용자 C 는 구분할 수 없다 — CHS 는 `section.diameter`, hat·트랙은 `lip_depth` 를 보내지 말 것. `:1606` RHS 플랜지 평탄폭은 코너 2개.
  - 결과 표시: `pass=None` 은 'OK' 가 아니라 '판정 없음'으로, `not_evaluated`·`not_checked`·`governing_check`·`limit_state_checks`·`auto_generated_section`·`web_crippling.ratio/design_strength` 를 보여 줄 것. 인장 `Tn_rupture` 는 Fu 가 없으면 `null`(`webview/js/app.js:4710`, `:5864`).
- **`python/server.py` `aisi_design`(`:236-239`)**: 그대로 돈다. props 없이 부르는 클라이언트는 이제 `error`(R8-11)를 받는다.
- **MCP `src/mcp/server.ts:770-930`**: 새 선택 인자 `wc_P`, `wc_M`, `cantilever`, `Lb_pos`(Mu_pos 와 함께 필수), 조합 앵글의 `May_strength` 필수, `R_uplift` 는 C/Z 만, `Fy` 필수를 설명에. SI 출력 맵(R8)에 새 키 없음.
- **F3/F1**: `test_review_1122_cfsm.test_R3_01_sharp_lipped_z_real_modes_locks_rotT` 가 현재 트리에서 실패(G2 순수 모드 LF 31.98 대 Euler 142.8) — 설계 코드를 쓰지 않는 시험이므로 F3·F1 이 확인할 것.
- **F7 `design/loads/bracing.check_i621_conditions`**: §I6.2.1 조건 검사가 두 곳에 있다(`aisi_s100._check_i621_limits` 와). 다음 묶음에서 하나로.
- **F2 템플릿**: hat 의 `D` 가 하부 플랜지 폭이라 립과 섞인다(R2-10). 엔진은 hat 의 `params['D']` 를 립으로 읽지 않게 했다.

## 사용자 결정 필요

1. **Z 휨의 기준 응력(§4.2)**: F1 은 `unsymm=1`(비구속 휨)을 권했다. 이 묶음은 `unsymm=0`(구속 휨, 기하 x 축)으로 항복 모멘트·응력·DSM 기준(F5 의 `extract_dsm_values` 가 응력 모양으로 판정)·설계 My=Sf·Fy 를 모두 맞췄다 — Manual II-2B 의 Z 퍼린(구속 휨)과 같다. 비구속 Z(횡지지 없는 Z) 설계를 지원하려면 My·Sf 를 함께 비구속 첫 항복으로 바꾸는 선택 인자가 필요하다(선택지: 구속만 / 사용자 선택 / 횡지지 조건으로 자동).
2. **기본값으로 낸 결과의 판정**: KxLx·KyLy·KtLt·Lb 의 120 in 기본, `Lb_pos` 미입력은 이제 판정을 막는다(GUI 는 늘 보냄). An 미입력은 An=Ag 로 경고만 한다(구멍 없는 부재의 정상 값이므로). An 도 필수로 할지.
3. **구멍 미구현**: 둘째 묶음에서 `scope_notes` 로 옮겼다(늘 참인 범위 진술). 천공 부재를 거절하려면 입력에 `web_holes` 를 두고 그때만 오류로 하는 방안.
4. ~~§I6.2.1 Mn = min(Mne, Mnl, R·Mnlo)~~ — 오케스트레이터 결정으로 원문(Mn = R·Mnlo)대로 바꿨다(V3-21).
5. **트랙 + 체결 웹 크리플링(V2-07, F5 쪽)**: Table G5-2 에 체결-무보강 행이 없어 판정 없음. 무체결 계수를 보수 대체로 쓰는 선택 인자를 둘지(F5 와 함께).

## 못 한 것

- §F2.1.2(앵글·hat·티의 LTB) 구현 — 미지원으로 판정 없음(오류 문구에 합리적 해석 안내).
- 원형관 압축의 국부 해석식(E3.1.1.1/고전 원통식) — Pcrl 이 없으면 E3 미평가.
- Manual III-5B 의 앵글 허용 P̄ 수치 재현 — 식 대조로만 시험했다(B1·(P)L/1000).
- 주축이 기운 단축대칭 단면(Ixz≠0) 의 E2.2 — 두 방향 편심이면 E2.4 미지원으로 보낸다.
