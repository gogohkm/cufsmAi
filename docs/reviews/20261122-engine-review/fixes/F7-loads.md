# F7 — 하중·연속보·소요강도·브레이싱 수정 기록

## 요약

고침 27 · 보류 2 (R7-23, R7-25 — TypeScript·MCP 스키마, 다음 묶음) · 기각 0 · 사용자 결정 필요 0 (발견사항 전체가 아니라 가정·선택지 8건을 아래 「사용자 결정 필요」에 적었다).

전체 시험: `C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe test\python\run_all.py` → `Ran 307 tests in 27.428s` / `OK` (종료 코드 0). 첫 실행에서 `test_review_1122_cfsm.test_R3_01_sharp_lipped_z_real_modes_locks_rotT`(F3 영역) 하나가 실패했고, 다시 돌리니 통과했다(동시 수정 중의 일시 상태). `ruff check python test` → `All checks passed!`.

해석 핵심(3-모멘트·직접강성)의 맞던 값은 그대로다 — 닫힌 해 표는 `test_R7_closed_form_*`, `test_R7_independent_*` 에 시험 안에서 따로 계산한 기대값으로 잠갔다. 바뀐 것은 해석 결과를 설계 입력으로 바꾸는 층이다.

### 구조 변경 (한 번 적어 둔 규칙)

- **해석**: `analyze_loads` 가 경간마다 1 kip/ft 단위하중 응답을 한 번 구하고 중첩한다(`required_strength._unit_responses`). 조합·재하 패턴마다 위치별 (최대, 최소) 포락선을 만들고(`_variant_envelope`), 중력/양력/전체 묶음마다 다시 포락한다(`_class_result`). 위치마다 지배 조합(`combo`)과 패턴(`pattern`)을 단다. 이전 키(`combo`, `locations`, `M_diagram`, `V_diagram`, `x_diagram`)는 뜻을 유지한다 — `M_diagram` 은 전체 최대 |M| 을 만드는 조합·패턴의 **실제** 다이어그램이다.
- **지점 전단·반력**: 경간 자유물체의 정역학(`beam_analysis.support_statics`) — 지점 양쪽 전단과 상향 + 반력. EI 분포와 무관해 랩 경로에도 그대로 맞다.
- **압축 플랜지·영역 규칙**(`bracing.UNBRACED_RULE`, `determine_unbraced_lengths`): M > 0 → 상부, M < 0 → 하부 플랜지 압축 (중력·양력 구분 없음). 브레이스 = 지점(P/R/F) + 이산 브레이스, 자유단(N)은 비지지. through-fastened 데크만 상부 플랜지를 연속 지지하고, 그때만 변곡점을 하부 플랜지의 브레이스로 본다(매뉴얼 II-1A/II-2A 가정). 랩 근처 단일부재 구간은 랩 끝에서 끝나고, 랩 안 구간은 `lap_regions` 로 따로 낸다. 스탠딩심·데크 없음은 이산 브레이스만(App. A I6.2.2) — 비지지길이 = 브레이스 간 거리. Cb 는 F2.1.1-2(|M|), 자유단 비지지 내민·캔틸레버는 1.0.
- **legacy 단일 키**(`positive_region`, `negative_region_gov`, `uplift_bracing.negative_region`): TypeScript 가 아직 영역별로 설계하지 않으므로 보수측 대표값 = 영역들의 최대 Ly · 최소 Cb (`basis` 키로 밝힘). 영역별 값은 `positive_regions` / `negative_regions` 에 M_max_abs 와 함께 있다.

## 발견사항별

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| R7-01 | 고침 | `load_combinations.get_applicable_combos`: 없는 하중은 0, 항만 빼고 조합 유지, 같은 계수 집합 병합. 이름도 줄인 항으로(`4: 1.2D+1.0W+0.5Lr`). 7-10 Sec. 2.3.2/2.4.1 목록을 ASCE 7-22 Ch.2 원문 구조와 대조(7-10 계수 유지) | 25 ft 단순보 LRFD D10·Lr100·Wp300: Mu 25.16 → **28.28** (닫힌 해 0.362·625/8); ASD D10·Lr100·Wp150: 8.59 → **11.91**; D50·Wp100(지붕): 11.33 → **12.50** | `test_R7_01_missing_L_keeps_wind_combinations`, `test_R7_01_combo_list_reduction_and_merge` |
| R7-02 | 고침 | `bracing.determine_unbraced_lengths` (규칙 하나), `required_strength.analyze_loads` 양력 반전 로직 제거 | 2경간 25 ft 양력 영역 18.75–25 ft, Ly 75 in → **0–18.75 ft, 225 in** (0.75L), \|Mu\| 6.195 | `test_R7_02_uplift_unbraced_region_midspan` |
| R7-03 | 고침 | 스탠딩심 = 이산 브레이스만, kφ 자동식 없음(`_calc_deck_info`), 양력 R 은 `deck.R_tested_uplift`(S908)만, 중력 R 은 `auto_params.gravity_R` 로만 보고 | 정모멘트 Ly 0(braced) → 브레이스 간 길이; kφ 0.1936 → 0 (override 만); uplift R 0.60 → None + 경고 | `test_R7_03_standing_seam_not_continuous_bracing` |
| R7-04 | 고침 | R 은 through-fastened + 단면 + 조건 (a)–(o) 만족 + (i)–(n) 사용자 확인(`i621_conditions_confirmed`)일 때만. R=0.60 기본값 삭제. `check_i621_conditions` 에 `conditions`(pass/fail/unverified), `R_if_confirmed`, `reasons` | MCP(단면 없음) R 0.60 → None; 데크 none + 적합 단면 0.5 → None; 확인 없음 → None(경고), 확인 → 표값 0.70 | `test_R7_04_uplift_R_only_when_I621_applies` |
| R7-05 | 고침 | `check_i621_conditions`: (g) 지점·방향별 최솟값, 연속인데 랩 없음 → 미확인, 인접 경간 > 20 % → 단순보 값, 단순보 단열재 r (Eq. I6.2.1-2), 내민·캔틸레버 경간 R 없음, 단면 형식 `'Z' in t` / C 계열 / 그 밖 None, 패널 두께·패스너 간격·단열재 두께는 입력이 있으면 검사 | 랩 0.5/1.5 ft d=8: 0.70 → None; 30/20/30: 0.70 → 0.65; 단열 6 in: 0.65 → 0.611; `lippedc` 깊은 단순보 0.50 → 0.40 | `test_R7_05_I621_condition_details` |
| R7-06 | 고침 | `bracing.calc_rotational_stiffness`: Gao & Moen 원식(b²c/2 + bc² + c³/3 항, k = 1.934c^-0.4/s). 출처 표기 정정 | Example II-1C: 0.1936 → **0.1126** (매뉴얼 0.113) | `test_R7_06_kphi_gao_moen_example_II_1C` |
| R7-07 | 고침 | `pattern_loading=True`(기본): L·Lr 은 경간별 실림/안 실림을 위치마다 최악으로(Sec. 4.3.3/4.3.3.1 — 2ⁿ 부분집합과 같음), S 는 균형 + Sec. 7.5.1 경우(`snow_partial_cases`). 포락선을 소요강도·영역·반력·처짐에 그대로 씀. 지배 패턴을 위치마다 보고 | 3경간 25 ft 1.2D+1.6S: 외측 M+ 8.900 → 9.578, 내부 M+ 2.781 → **4.109** (+48 %), 지점 M −11.125 → −11.958, R 4.895 → 5.095 (독립해 ±0.5 %) | `test_R7_07_snow_partial_loading_three_spans`, `test_R7_07_snow_case_list`, `test_R7_07_live_load_alternate_and_adjacent_spans` |
| R7-08 | 고침 | `beam_analysis.analyze_beam_fe`: 반력 부호 유지(상향 +), 모든 지점(자유단 0.0). 조합 분류는 순하중 부호(`_variant`: D·W 만의 순하중 < 0 → 양력)로 경로 무관 | 2경간 랩 w=−100: [+0.898, +3.204, +0.898] → [−0.892, −3.215, −0.892] (독립해; 0.898→0.892 는 R7-18). ASD D10·W−150 랩 유무 같은 분류 (`5: D+0.6W` 양력). 새 키 `uplift_reactions` | `test_R7_08_fe_reactions_signed` |
| R7-09 | 고침 | FE 반력을 지점마다; `extract_critical_locations(_envelope)` 가 자유단을 건너뛰고 실제 양끝 지점을 'End support', 내민 길이 > 1.5h(단면 깊이 있을 때)면 IOF; `laps_per_support[j]` None = 랩 없음; `analyze_beam_fe(I_span_in4=…)` 로 부재별 I (랩 I = 양 부재 합) | II-2A 기하: x=76 ft Ru 1.04 → **2.94**; 지점 x=1…101 Ru = 1.05/2.93/2.24/2.93/1.05 (독립해 1 %); x=0·102 반력·가짜 랩 끝 없어짐 | `test_R7_09_free_end_support_mapping_II2A` |
| R7-10 | 고침 | 랩 끝 = 지점 − left_ft, + right_ft (위치·비지지길이 모두, `beam_analysis.normalize_laps` 에 규약 docstring) | 2×25 랩 2.5/3.5: 랩 끝 x 21.5/27.5 → **22.5/28.5**, M −4.043/−5.357 → −5.234/−3.926; Ly 45.2/57.2 → 55.9/43.9 in | `test_R7_10_lap_left_right_convention` |
| R7-11 | 고침 | `_resolve_laps`: `laps` 사전만 있으면 모든 내부 지점에 적용해 FE 경로 | 랩 끝(22.5) M −4.22 → **−5.23**, 지점 M −7.81 → −8.94 | `test_R7_11_laps_dict_enters_stiffness` |
| R7-12 | 고침 | 영역 = 부호 구간을 지점·브레이스·랩 끝으로 자른 조각 (내민·고정단 포함, 지점을 넘지 않음) | 20+5 ft 내민: 지배 Ly 15 → **60 in, Cb 1.0**; 30/20/30 의 지점을 넘던 292 in 조각 → 랩 끝 사이 168 in | `test_R7_12_overhang_region_and_cb` |
| R7-13 | 고침 | 영역마다 Ly·Cb·M_max_abs; 대표값은 최대 Ly·최소 Cb. 데크 없음은 브레이스 간 길이 | 18/32/18 데크 없음: positive_region Ly 118.5 → **384 in** (리뷰어 수용치 251.4 는 변곡점을 브레이스로 본 값 — 아래 사용자 결정 2) | `test_R7_13_no_deck_regions_brace_to_brace` |
| R7-14 | 고침 | `_resolve_geometry`: cantilever → ['F','N'] (N 없으면 오류), cont-n → len(spans_ft) (없으면 오류), 개수 불일치·미지 span_type·불안정 지점 → ValueError; 미지 member_app → ValueError | cantilever 8 ft D=100 ASD: M +0.8 → **−3.20** (−wL²/2) | `test_R7_14_span_type_and_geometry_inputs` |
| R7-15 | 고침 | `support_statics` 로 지점 양쪽 전단, 위치에 `Vu_left`·`Vu_right`, `Vu` = 큰 값 (세 경로 같음) | 2×25: 1.513 → **1.5625**; 20/30/20 지점1: 1.297 → **1.500** | `test_R7_15_support_shear_both_sides` |
| R7-16 | 고침 | wall-girt·wall-stud: D, L, Lr, S, R 은 웹 평면 밖 → 강축에서 제외, 경고 + `not_evaluated` 에 약축/축방향 미검토 | 거트 D20·W−100 ASD 흡인: −48 → **−60 plf** | `test_R7_16_wall_girt_dead_load_out_of_plane` |
| R7-17 | 고침 (내 쪽) | `distortional_params`·`local_params` 모듈·함수 docstring 에 기하 계약 명시(ho 외-외, b = bo − t, d = do − t/2; 국부 판식은 외-외 받고 코너를 스스로 뺌). 호출자 수정은 F4 | 값 변화 없음 (II-5 Fcrd 46.5 / Lcrd 19.4 재현 유지) | `test_R7_17_fcrd_contract_and_z_note` |
| R7-18 | 고침 | `analyze_beam_fe`: 요소 EI·하중을 중점으로 판정, 0.01 ft 보조 절점 삭제; `compute_deflection_variable_I` 도 같은 규칙(min). `test_regression_0926.test_fe_lap_golden` 골든값 정정 | 랩 2/2: Msup −8.8007 → **−8.6334**, M(12.5) 3.4122 → 3.4958, δ 0.9944 → 1.0233 in; 랩 2.5/3.5 n=51 −9.077 → −8.9405 (격자 무관) | `test_R7_18_lap_EI_extent_exact`, (정정) `test_fe_lap_golden` |
| R7-19 | 고침 (한계값은 보류) | `deflection_cases`: 하중별 단독(비계수, 패턴 포락) + D+(L\|Lr\|S\|R) 합계, W 는 입력값 1.0. `deflection` = 합계 중 최대(조합명·basis 표기). 캔틸레버·내민 경간 처짐비 2L/δ (`L_ratio_basis`) | 이전 '가장 큰 ASD 조합'(예: 풍 포함) → 비계수 사용하중 합계; 캔틸레버 L/δ 기준 L → 2L | `test_R7_19_deflection_cases` |
| R7-20 | 고침 | `normalize_design_method` (대소문자 무관, 그 밖은 ValueError — 조용한 ASD 없음), 결과에 `load_combination_standard` (ASCE/SEI 7-10 Sec. 2.3.2/2.4.1). 다른 판은 넣지 않음 | 'lrfd' → LRFD, 'LSD' → 오류 | `test_R7_20_method_and_edition` |
| R7-21 | 고침 | `bracing.lateral_stiffness_detail` / `calc_lateral_stiffness`: RP17-2 Ke = 0.27ψ^-0.69 Ka. 패스너 값(Fss·D·Fu)이 없으면 예제 값 + 경고, 두께 범위·COV 0.86 경고. 이전 인수(Pss 등)는 계속 무시 | (0.015, 0.059): 1.114 → **0.981**; (0.024, 0.070): 1.665 → 2.282; 예제점 1.280 → 1.273 (매뉴얼 1.28) | `test_R7_21_kx_rp17_2_psi` |
| R7-22 | 고침 | `_solve_general` 특이 → ValueError, `check_support_stability`, FE 풀이 실패·잔차 과대 → ValueError (0 해 금지), `calc_Lcrd` 내부값 ≤ 0 → ValueError (20 in 대체 삭제), Ixx 없을 때 처짐 미계산을 경고 | ['N','N','N']: M=0 결과 → ValueError | `test_R7_22_failures_raise` |
| R7-23 | 보류 | (TS) — 엔진은 `uplift_bracing.negative_regions[*].M_max_abs`·`i621_region_eligible` 를 준다 | — | (후속) |
| R7-24 | 고침 (의심 부분 보류) | `local_params.calc_Fcrl(flexure=True)`: 웹 k = 24 (ψ = −1), 최외연 외삽; 기본(압축)은 그대로. `calc_Fcrd` 결과 `notes`: Z 압축 해석식은 FSM 보다 18–31 % 클 수 있음 | II-5 휨 fallback(플래그 사용 시) 5.74 → 35.7 ksi (FSM 42.8 이하). 호출자가 플래그를 넘기기 전까지 값 변화 없음 | `test_R7_24_local_flexure_fallback` |
| R7-25 | 보류 | (MCP 스키마) — 엔진은 빠진 입력을 기본값으로 채우지 않고 경고/오류 (R 0.60·kφ 기본 단면 삭제) | MCP 경로 kφ/kx 0.194/1.28 → **0/0** (단면 없음, 보수측) | (후속) |
| R7-26 | 고침 | FE 요소 하중 = 중점이 속한 경간의 w | 3경간 1·3 재하 R 1.3502/1.4001 → 1.375 (정확해) | `test_R7_26_fe_span_boundary_loads` |
| R7-27 | 고침 | `calc_flange_properties`: θ ≠ 90° 이면 단면 종류와 무관하게 경사립 열 (θ = 90 에서 두 열이 같음을 시험) | 경사립 C 의 Ixf 등 (수직립 식 → 경사립 식) | `test_R7_27_inclined_lip_formula_for_C` |
| R7-28 | 고침 | `calc_beta_distortional(diagram_signs=False)`: docstring 정정, 다이어그램 부호 입력 옵션 | 기본 동작 같음 | `test_R7_28_beta_diagram_sign_option` |
| R7-29 | 고침 | 위치 이름(내민 'Overhang', 캔틸레버 'Cantilever', 실제 단부경간 'End span', 'Center' 는 기하 중앙), `W=None` TypeError, 자중 미포함을 `assumptions` 에, 모듈 docstring 정정. 쓰이지 않는 함수(`analyze_continuous_beam`, `compute_deflection`, `find_controlling_combo`, `_merge_controlling`)는 호환용으로 남김 | — | `test_R7_29_wind_none_and_self_weight_note` |

추가: `test_R7_closed_form_simple_span`, `test_R7_closed_form_equal_spans`, `test_R7_independent_unequal_fixed_cantilever_overhang` (리뷰의 「맞다고 확인한 것」 표), `test_R7_outputs_not_evaluated_and_legacy_keys` (이전 키 유지, I6.4.1 미검토 명시).

기존 시험 정정(그 함수 안에서만):
- `test_design_verification.test_i621_uplift_r` · `test_analyze_loads_integration`: (i)–(n) 확인 플래그를 넣음 — 이전에는 확인 없이 R 을 잠갔다.
- `test_regression_0926.test_fe_lap_golden`: max() 규칙 골든값 → 정확해.

리뷰어 스크립트(`scratchpad\review\R7\t1`–`t10`)는 전·후를 `scratchpad\fix\F7\before_*.txt`·`after_*.txt` 에 남겼다. `t4`(`i621_check` 키가 데크 none 에서는 없음)와 `t7`(`_parse_n_spans('cont-n')` 이 이제 오류)은 의도된 변화로 멈춘다. `t5` 의 「wall-girt D50·Wp100 기대 12.50」은 R7-16 과 모순이다 — 거트의 D 를 강축에서 빼므로 7.81(1.0Wp)이 맞고, 지붕 퍼린에서는 12.50 이다(시험에 둘 다 반영).

## V3 검증 뒤 고친 것

검증 보고서: `verify/V3-connections-loads.md` (V3-12 … V3-24, 예제 II-2 대조, 시험의 정직성). 인수 시험은 설계매뉴얼 Example II-2A 를 기본 설정의 `analyze_loads` 로 푼 것이다(부재별 Ix 를 입력으로 줌).

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| V3-12 | 고침 | `required_strength.analyze_loads`: I6.2.1 (g) 의 랩 목록을 첫·마지막 **실제** 지점 사이의 지점에서만 모음 | II-2A (g): fail 0.0 in → pass 12 in (≥ 1.5d) | `test_V3_II2A_manual_uplift_R` |
| V3-13 | 고침 | `bracing.check_i621_conditions`: I6.2.1 첫 문장("shall not apply … for the region between inflection points adjacent to a support or to a cantilever beam")대로 내민 **구간만** 뺌. R = 실제 경간 R 의 최솟값, 내민 경간은 `R_per_span` None, 영역은 `i621_region_eligible=False`. 실제 경간이 없는 캔틸레버 보는 None | II-2A uplift_R None → **0.70** (매뉴얼 §4a) | `test_V3_II2A_manual_uplift_R`, `test_R7_05_I621_condition_details` |
| V3-14 | 고침 | `required_strength._variant`: 조합의 순하중(모든 항, 등분포) 부호로 양력 분류 | II-2A `6a: D+0.75(0.6W)+0.75Lr`(+13.5 plf) 양력 → 중력; 양력 영역 Ly 270 → **226.1 in**(끝) · 246 → 149.6 in(안), 모두 I6.2.1 적용 영역; 단순보 D10·Lr100·W−150 양력 M_envelope_max 7.578 → 0 | `test_V3_14_uplift_class_by_net_load`, `test_V3_II2A_manual_uplift_R` |
| V3-15 | 고침 (결정대로) | `analyze_loads(lr_reduced=False)` 추가, `_pattern_keys`: Lr 은 `lr_reduced=True` 일 때만 부분재하 (ASCE 7-22 Sec. 4.3.3.1 "Where Section 4.8.2 reduces a uniform roof live load below 20 psf … apply … to adjacent spans or alternate spans" — 스킬 원문. 7-10 원문은 스킬에 없음). L(Sec. 4.3.3)·S(Sec. 7.5)는 그대로. 결과 `pattern_loading.patterned_loads`·`why` | II-2A 안경간 M+ 5.160 → **2.233** (매뉴얼 2.23), 랩 끝 50 ft 6.087 → 3.722 (3.73), 끝경간 부모멘트 영역 Ly 270 → 43.2 in | `test_V3_15_Lr_partial_loading_switch`, `test_V3_II2A_manual_gravity_values` |
| V3-16 | 고침 | `required_strength._governing_region`, `_negative_gov`·`_positive_gov`: 지배 영역 = M_max_abs·Ly²/Cb 최대(Fcre ∝ Cb/Ly², 1 in 미만 조각 제외), legacy 키는 그 영역 자신의 Ly·Cb·M1·M2·Cb_detail | II-2A negative_region_gov Ly 50.0 · Cb 1.0 → **Ly 49.1 · Cb 1.79** (안경간 왼쪽 랩 끝, 매뉴얼에서 가장 빠듯한 검토) | `test_V3_16_17_governing_region_own_values`, `test_V3_II2A_manual_gravity_values`, `test_R7_12_overhang_region_and_cb` |
| V3-17 | 고침 | `bracing.determine_unbraced_lengths.region_info`: `M_max_abs` = 상부 영역 max(M,0), 하부 영역 max(−M,0) | 20+5 데크 없음 하부 영역 2.636(경간 정모멘트) → 1.25; 18/32/18 상부 4.386 → 경간 정모멘트 | `test_V3_16_17_governing_region_own_values`, `test_R7_13_no_deck_regions_brace_to_brace` |
| V3-18 | 고침 (엔진 쪽) | `_resolve_geometry` 오류 문장: "cont-n (or cont-N) needs spans_ft … or give the count, e.g. cont-4". 스키마는 W2 | — | `test_V3_18_cont_n_message_and_I_span_input` |
| V3-19 | 고침 | `_class_result`: 지점마다 `combo_R_uplift`·`pattern_R_uplift`(R 최소의 조합), `uplift_reactions[*].combo` 가 이것을 씀 | II-2A 인발 라벨 `3: D+Lr` → **`7: 0.6D+0.6W`** | `test_V3_II2A_manual_uplift_R` |
| V3-20 | 고침 | `analyze_loads(I_span_in4=None)` (또는 `section['I_span_in4']`) → FE 에 경간별 Ix, 랩 Ix = 두 부재 합. 주지 않으면 `assumptions` 에 영향(≈2 %, 빠듯한 검토가 바뀔 수 있음)을 적음 | II-2A 안경간 왼쪽 랩 끝 (균일 Ix) 3.971 → (부재별) **3.892** (매뉴얼 3.89) | `test_V3_II2A_manual_gravity_values`, `test_V3_18_cont_n_message_and_I_span_input` |
| V3-22 | 고침 | Mu 가 None 인 끝 지점의 `combo`·`pattern` = None | `1: 1.4D` 등 → None | `test_V3_22_23_24_labels_numbering_unused_solver` |
| V3-23 | 고침 | `load_combinations.ASD_COMBOS` 번호를 ASCE 7-10 Sec. 2.4.1 로: 5 (0.6W 또는 0.7E), 6a, 6b, 7, 8. 계수는 같음 | 이름만 (`6:`→`6a:`, `8: D+0.7E`→`5:`, `9:`→`6b:`, `10:`→`8:`) | `test_V3_22_23_24_labels_numbering_unused_solver`, `test_R7_01_*` |
| V3-24 | 고침 | `beam_analysis.analyze_continuous_beam` → `analyze_continuous_beam_general` 로 위임 (지점 양쪽 전단 포함) | 2경간 지점 전단 1.512 → 1.5625 (5wL/8) | `test_V3_22_23_24_labels_numbering_unused_solver` |

### Example II-2A — 매뉴얼 대 `analyze_loads` (기본 설정, ASD, `I_span_in4 = [9.18, 9.18, 7.76, 7.76, 9.18, 9.18]`, I6.2.1 확인 플래그)

| 항목 | 매뉴얼 | 도구 |
|---|---|---|
| 지배 조합 (중력 / 양력) | D+Lr / 0.6D+0.6W | `3: D+Lr` / `7: 0.6D+0.6W` |
| M+ 끝경간 / 랩 끝 23.5 / 지점 26 / 랩 끝 29.5 | 5.11 / 4.65 / 8.75 / 3.89 | 5.106 / 4.647 / 8.751 / 3.892 |
| M+ 안경간 / 랩 끝 50 / 중앙 51 | 2.23 / 3.73 / 4.95 | 2.233 / 3.722 / 4.950 |
| V 끝 지점 / 랩 끝 23.5 / 지점 26 왼 · 오 | 1.09 / 1.50 / 1.78 · 1.59 | 1.090 / 1.498 / 1.785 · 1.590 |
| V 랩 끝 29.5 / 50 / 중앙 | 1.18 / 1.17 / 1.29 | 1.187 / 1.170 / 1.285 |
| R 끝 / 첫 내부 / 중앙 (웹크리플링 EOF / IOF / IOF) | 1.21 / 3.37 / 2.58 | 1.205 / 3.375 / 2.571 (EOF / IOF / IOF) |
| 변곡점 (지점에서) 끝 / 안 왼 / 중앙 | 6.10 / 7.59 / 4.94 ft | 6.10 / 7.59 / 4.95 ft |
| Ly 랩 끝 → 변곡점 | 43.2 / 49.1 / 47.3 in | 43.2 / 49.1 / 47.3 in |
| Cb 같은 구간 | 1.67 (선형 가정, 보수) | 1.75 / 1.79 / 1.79 (F2.1.1-2, 독립해와 같음) |
| 양력 −M 끝 / 안 | 4.13 / 1.81 | 4.129 / 1.806 |
| 양력 R | 0.70 (15개 조건 가정) | 0.70 (확인 플래그; 내민 경간은 영역에서만 빠짐) |
| 양력 하부압축 영역 | — (R 법) | 1.05 – 19.90 ft (226.1 in), 33.59 – 46.05 ft (149.6 in), 모두 적용 영역 |
| 부분재하 | 없음 (전 경간) | 없음 (`patterned_loads` = [], Lr 은 감소되지 않음) |

부재별 Ix 를 주지 않으면(Ix 7.76 하나) 안경간 왼쪽 랩 끝이 3.971 이 되어 매뉴얼의 F4 검토(3.89 ≤ 3.93)가 1.01 로 뒤집힌다 — `assumptions` 에 그 영향을 적는다. 양력 R 경로의 Mne 처리(V3-21, F4)는 이 표 밖이다.

### 시험의 정직성 (되돌리기 시험)

`scratchpad\fix\F7\mutate.py` 가 수정을 하나씩 되돌린 복사본에서 이 파일의 시험을 돌린다(`mutate_out.txt`). 아홉 경우 모두 하나 이상의 시험이 실패한다: V3-14 (D·W 순하중 규칙, W<0 규칙), V3-12, V3-13, V3-19, V3-15, V3-16, V3-17, 처짐 합계 × 1.6. 약한 단언도 고쳤다: `test_R7_12`(지배 영역 값, 고정단 영역 길이 (1/2 − 1/√12)L), `test_R7_13`(Cb·M 을 독립해로), `test_R7_03`(Ly = 300 in), `test_R7_19`(D+Lr 합계 = 5(wD+wLr)L⁴/384EI).

전체 시험(V3 수정 뒤): `Ran 347 tests in 35.145s` / `FAILED (failures=2)` — 둘 다 F7 파일 밖이다: `test_design_verification.test_purlin_uplift_r_and_governing_wiring_contract`(`src/webview/StcfsdPanel.ts`·`webview/js/app.js` 문자열을 읽는 배선 시험, W3 가 지금 그 파일들을 고치는 중), `test_design_verification.test_unsupported_sections_require_rational_global_buckling_input`(F4 영역 `aisi_s100`/`global_buckling`). 하중 시험은 모두 통과(관련 59건). `ruff check python test` → `All checks passed!`.

## V4 뒤 알림 분류 (FIXES §3.1.1)

W3 기록(`fixes/W3-host-webview.md` 「V4 검증 뒤 고친 것」)이 지적한 대로, 보통 실행마다 주황 경고에 뜨던 F7 알림을 셋으로 나눴다. `warnings` 키는 그대로 두고 `scope_notes` 를 덧붙였다(analyze_loads 결과, `_calc_deck_info`, `lateral_stiffness_detail`). `_calc_deck_info` 의 `notes`·`warning`, `lateral_stiffness_detail` 의 `notes` 는 이전 키로 그대로 남는다(셋을 합친 목록 / 같은 문장).

| 알림 | 전 | 후 | 까닭 |
|---|---|---|---|
| Deck restraint estimates are preliminary… | warnings | **scope_notes** | 방법의 성격 — 입력과 무관하게 늘 참 |
| RP17-2 curve fit has a coefficient of variation of 0.86… | warnings | **scope_notes** | 같음 |
| kx: fastener shear strength/diameter/tensile strengths not given — Example II-1C values used | warnings | **assumptions** | 기본값으로 채운 입력 |
| Fastener taken at mid-width of the flange (b = c = B/2) for kphi | warnings | assumptions | 기본값 |
| Standing-seam roof: no analytical rotational stiffness; kphi = 0 … | warnings | assumptions | 이 실행의 가정 |
| Standing-seam roof without discrete brace points … | warnings | assumptions | 이 실행의 가정 |
| Member self-weight is not added automatically … | assumptions | scope_notes | 늘 참 |
| I6.4.1 not calculated / deflection limits not checked | not_evaluated 만 | not_evaluated + scope_notes | 프로그램 범위 |
| Purlin thickness/flange width not given → kφ, kx = 0; panel < 0.018 in.; ply outside 18–97 mil; Wp < 0 ignored; lap at end support ignored; wall D out of plane (weak axis not evaluated); I6.2.1 R not applied / not evaluated; S908 R missing; standing-seam gravity R not used; Ixx missing → no deflection | warnings | warnings (그대로) | 값·판정을 바꾸거나 사용자가 손볼 것 |
| `calc_Fcrd` 의 Z 압축 메모 (`notes`) | — | 그대로 (F4 가 fallback 을 쓸 때 옮김) | 해석식으로 대체한 좌굴값 → F4 쪽에서 assumptions |

완전히 입력한 through-fastened 퍼린(II-2A, I6.2.1 확인) 의 `warnings` 는 빈 목록이다 — `test_V4_notice_classification_fully_specified_run`. `test_R7_29` 는 자중 문장을 `scope_notes` 에서 찾도록 고쳤다.

전체 시험(V4 분류 뒤): `Ran 382 tests in 95.457s` / `FAILED (failures=2)` — 둘 다 F7 밖 (`test_review_1122_server.test_W1_analysis_methods_match_engine`, `…test_W1_vibration_fcfsm_plastic_forward_new_keys`: cFSM/fcFSM 의 `scope_notes` 문장 대조, 다른 담당이 고치는 중 — 바로 앞 실행에서는 다른 server 시험 하나였다). 하중 시험은 모두 통과. `ruff check python test` → `All checks passed!`.

후속(W3/W2): 화면·MCP 는 `scope_notes` 를 주황 경고가 아닌 범위 안내로, `assumptions` 를 가정 목록으로 보여 준다. `auto_params.deck.warning`(이전 키)을 경고로 띄우던 곳이 있으면 `auto_params.deck.warnings` 로 바꾼다.

## 후속 — 다른 곳이 따라와야 하는 것

**[V3 뒤 추가 — W1·W2·W3 가 넘기고 보여 줄 것]**
- 새 인자 **`lr_reduced`** (bool, 기본 False): Lr 이 ASCE 7 Sec. 4.8.2 로 20 psf 미만으로 감소된 값이면 True — 그때만 Lr 부분재하. `server.py` analyze_loads 분기, MCP analyze_loads·design_purlin 스키마, 화면의 하중 입력(체크박스 "지붕 활하중 감소 적용")이 넘겨야 한다. 기본값(False)에서 Lr 은 전 경간 재하다 — 이전 F7 기록의 "Lr 늘 부분재하"는 바뀌었다.
- 새 인자 **`I_span_in4`** (경간마다 부재 Ix, in⁴; 경간 수만큼): 끝·안 부재 두께가 다를 때. `section['I_span_in4']` 로도 받으므로 `section` 을 그대로 넘기는 경로는 이미 된다. MCP 스키마·화면(경간 표의 부재 Ix 열)에 둔다. 주지 않으면 `assumptions` 에 "One Ix for every span …" 이 붙는다.
- 결과 `pattern_loading` 에 새 키 `patterned_loads`(실제로 부분재하한 하중), `why`(하중별 까닭), `lr_reduced`. 화면·보고서가 보여 줄 것.
- 위치(`locations`)의 지점 항목에 새 키 `combo_R_uplift`·`pattern_R_uplift` (인발 반력을 만드는 조합). `uplift_reactions[*].combo` 가 이것을 쓴다 — 이전에는 최대 지압 반력의 조합이 붙었다. Mu 가 없는 끝 지점의 `combo`·`pattern` 은 None.
- legacy 대표값(`negative_region_gov`, `positive_region`, `uplift_bracing.negative_region`)의 뜻이 바뀌었다: 최대 Ly + 모든 영역의 최소 Cb → **지배 영역 하나의 자기 값**(M_max_abs·Ly²/Cb 최대, 1 in 미만 조각 제외; `basis` 에 기준). 새 키 `M_max_abs`, `cantilever`, (양력) `i621_region_eligible`. 최대 Mu 를 이 (Ly, Cb) 와 짝지어도 탄성 LTB 지표로 보수측이다.
- ASD 조합 이름이 ASCE 7-10 Sec. 2.4.1 번호로 바뀌었다: `6:` → `6a:`, `8: D+0.7E` → `5: D+0.7E`, `9:` → `6b:`, `10: 0.6D+0.7E` → `8: 0.6D+0.7E`. 이름으로 조합을 찾는 화면 코드가 있으면 고친다.
- 양력 분류가 조합의 순하중 부호로 바뀌었다(`all_combos_detail[*].is_uplift`). `D+0.75(0.6W)+0.75Lr` 처럼 순하향인 조합은 이제 중력이다. app.js 4408 의 `upliftGoverns`(uplift.combo == governing.combo)는 그대로 쓸 수 있다.
- `uplift_R`: 내민이 있어도 실제 경간의 R 이 나온다(II-2A 0.70). `i621_check.R_per_span` 의 내민 경간은 None, 양력 영역의 `i621_region_eligible` 로 내민 영역이 빠진다 — 2차 묶음(R7-23)에서 TS 가 이 키를 읽어 영역별로 R 을 줄 것.
- 같은 묶음의 F4 항목(V3-21): R 을 쓰는 양력 검토에서 Mne(F2) 를 빼야 II-2A 가 매뉴얼처럼 합격한다 — 하중 쪽 입력(Ly 226 in, R 0.70)은 이제 맞다.

**`python/server.py:273-289` (analyze_loads)** — 새 인자 `pattern_loading`, `brace_points_ft`, `i621_conditions_confirmed`, `insulation_in` 을 넘긴다. 그전까지는 `deck` 사전 안의 같은 이름 키(`deck.i621_conditions_confirmed`, `deck.insulation_in`, `deck.brace_points_ft`, `deck.R_tested_uplift`, `deck.R_tested_gravity`, `deck.Fss_kip`, `deck.D_screw_in`, `deck.Fu_panel_ksi`, `deck.b_fastener_in`, `deck.c_fastener_in`)로도 들어온다. `analyze_loads` 는 이제 잘못된 입력에 ValueError 를 낸다(서버가 `error` 로 돌려줌).
**`python/server.py:292-316` (calc_deck_stiffness)** — `kphi_method` 문자열 'chen_moen_…' → 'gao_moen_2011_example_II_1C'; kx 는 `lateral_stiffness_detail` 로 패스너 값·경고를 함께 돌려줄 것.

**`src/webview/StcfsdPanel.ts` design_purlin (1873–2063)**
- 정·부모멘트를 영역별로 설계: `auto_params.unbraced.positive_regions` / `auto_params.negative_regions` 의 (Ly_in, Cb, M_max_abs) 쌍마다 `aisi_design` — 지금은 최대 Mu 를 대표값(최대 Ly·최소 Cb)과 짝지어 보수측.
- 양력(R7-23): `uplift_bracing.negative_regions` 의 M_max_abs·Ly·Cb 를 쓰고, `i621_region_eligible` 인 영역에만 `R_uplift` 를 준다. 지점부 양력(M > 0, 상부 압축, 데크 지지)은 따로.
- 지점: `Vu_left`/`Vu_right`, `wc_case`, `R_bearing`, `uplift_reactions`(앵커·클립 인발) 를 읽는다. `wc_reactions[*].case` 는 이제 내민 길이를 반영.
- `uplift_R` 가 None 이 되는 경우가 많아졌다(확인 플래그 필요) — UI 에 I6.2.1 (i)–(n) 확인 체크, 단열재 두께, 스탠딩심 S908 R, 이산 브레이스 위치, 부분재하 스위치 입력을 둔다.
- 결과의 `warnings`·`assumptions`·`not_evaluated`·`pattern_loading`·`load_combination_standard` 를 화면·보고서에 보여 준다.
**`webview/js/app.js`** — 3720/4193 의 영역 그림은 `start_ft/end_ft` 그대로 쓸 수 있다; 4460 자동 채움은 `negative_region_gov`(최소 Cb)로 보수측. 1834 처짐비는 캔틸레버에서 2L 기준. 3876 의 `laps`(내부 지점 최댓값)는 `laps_per_support` 가 있으면 무시된다.

**`src/mcp/server.ts:1053-1152` (R7-25)** — analyze_loads·design_purlin 스키마에 `section`(depth, flange_width, thickness, lip_depth, R_corner, type, Fy, Fu, Ixx), `loads.Wp`, `supports`·`spans_ft`·`laps_per_support`(design_purlin), `E`, deck 확장 키, `brace_points_ft`, `pattern_loading` 을 넣고, 랩 규약(left_ft = 지점 중심에서 왼쪽 랩 끝까지)을 설명에 적는다. `laps` 설명("at first interior support")은 "모든 내부 지점"으로 고친다. span_type enum 의 'cont-n' 은 spans_ft 와 함께여야 한다.

**F4 `python/design/aisi_s100.py`**
- R7-17: `:546-552`, `:598-610`, `:855-862`, `:923-939` 에서 외-외 ho·bo·do 를 넘기고 b = bo − t, d = do − t/2 로 만든다(평탄폭 금지).
- R7-24: 휨 경로(`:861-865`)에서 `calc_Fcrl(..., flexure=True)`; 압축 왜곡 fallback 결과의 `notes` 를 `warnings` 에 옮긴다.
- `calc_Fcrd` 가 잘못된 기하에서 Lcrd = 20 in 으로 채우지 않고 ValueError — 호출부 try 가 「평가하지 못함」으로 처리하는지 확인.
- `R_uplift` 경로의 `Mn = min(Mne, Mnl, Mn_R)` 에서 Mne(LTB)는 이제 긴 Ly(225 in 등)로 들어온다 — I6.2.1 에서는 Mn = R·Mnlo 이므로 R 적용 시 Mne 를 빼는지 F4 가 판단.

**F6** — `lap_connection` 입력(Mu_support, Vu_support)을 사용자가 넣는다. 이제 `locations` 의 랩 끝 Mu 와 지점 `Vu_left`/`Vu_right` 가 맞으므로 화면이 미리 채울 수 있다.

**I6.4.1** (퍼린 지붕계 앵커력) — 저장소 어디에도 없다. `analyze_loads` 결과 `not_evaluated` 에 "not calculated" 로 남겼다. 구현은 다음 작업.

## 사용자 결정 필요

1. **하중조합 판·나라** — 지금은 ASCE/SEI 7-10 하나(설계매뉴얼 예제와 같음). 7-16/7-22(적설 1.0S·0.3S·0.7S, 지진 Ev+Eh+0.15S), 또는 KDS 41 10 15 조합을 넣을지, 어떻게 고르게 할지. 이번에는 넣지 않았다.
2. **데크 없음·스탠딩심의 변곡점** — S100 F2 의 Ly 는 브레이스 사이 거리라서 변곡점을 브레이스로 보지 않았다(18/32/18 내부 384 in). 리뷰어 수용치 251.4 in 은 변곡점을 브레이스로 본 값이다. 데크가 상부를 잡지 않으면 변곡점은 브레이스가 아니라는 판단을 유지할지.
3. ~~**Lr 부분재하**~~ — 결정됨(오케스트레이터, V3-15): `lr_reduced` 입력(기본 False)을 두고 True 일 때만 Lr 부분재하. L·S 는 그대로.
4. **벽 부재의 D** — 거트·스터드의 D·L·Lr·S 를 강축에서 뺐다. 약축(거트 처짐·휨)·축력(스터드)은 analyze_loads 가 검토하지 않는다(`not_evaluated`). 방향별 하중 입력을 둘지.
5. **처짐** — 한계값(L/180 등)과 풍하중 처짐 배율(건축법규가 허용하는 감소)을 정하지 않았다. 지금은 비계수 값과 L/δ 만 낸다.
6. **legacy 대표값** — V3-16 으로 지배 영역(M·Ly²/Cb 최대) 하나의 값으로 바꿨다. TS 가 영역별로 설계하게 되면 이 대표값을 없앨지.
7. **kx 기본 패스너 값** — Fss·D·Fu 가 없으면 Example II-1C 값(1.8 kip, 0.190 in., 70 ksi). 곡선 COV 0.86. 시험값이 없을 때 하한을 쓸지.
8. **I6.2.1 (i)–(n) 확인** — 한 개의 불리언으로 받는다. 항목별 확인을 받을지.

## 못 한 것

- R7-24 의 의심(압축 왜곡 해석식이 Z 에서 FSM 보다 18–31 % 큼): 원식 전사는 맞고(표 2.3.1.3-1, θ = 90 에서 C 와 Z 식이 같음), 해석식이 C 와 Z 의 웹-플랜지 연성 차이를 반영하지 못하는 모형 한계로 보이지만, FSM 극소가 순수 뒤틀림인지 cFSM 모드 분리로 확인하지 못했다. 식은 바꾸지 않고 `calc_Fcrd` 결과에 `notes` 만 달았다.
- 점하중·부분 등분포하중, 처짐 한계 판정, I6.4.1. (부재별 I 는 V3-20 으로 analyze_loads 에 넣었다.)
- 부분재하가 켜진 조합(L·S, 또는 lr_reduced 의 Lr)에서 양력/중력 분류는 전 경간 재하 기준의 순하중 부호다. 패턴에 따라 경간마다 순하중 부호가 달라지는 경우의 위치별 분류는 하지 않았다(II-2A 류 지붕 퍼린에서는 L·감소 Lr 이 없어 해당 없음).
- 쓰이지 않는 이전 함수 정리(호환 때문에 남김).
