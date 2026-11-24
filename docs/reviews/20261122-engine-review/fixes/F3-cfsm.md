# F3 — cFSM · fcFSM · 진동 · 소성곡면 (+ `_cutwp_prop2`) 수정 기록

## 요약

고침 18 · 보류 2 · 기각 0 · 사용자 결정 필요 2 (R3 17건 + R2-06 · 07 · 08 · 17; R3-08 = R2-07, R3-09 는 F2 소관이라 셈에서 뺌).

- 고침: R3-01(§4.1 F3 쪽) · 02 · 03(엔진 쪽) · 04 · 06 · 07 · 10(엔진 쪽) · 11 · 12 · 13 · 14 · 16(엔진 쪽) · 17, R2-06 · 07(=R3-08) · 08 · 17
- 보류: R3-05(fcFSM 이식 — 결과를 fcFSM 으로 오인하지 못하게만 함). R3-15 는 V1 검증 뒤 고침으로 옮김(아래 「V1 검증 뒤 고친 것」)
- 사용자 결정 필요: 가지 단면(I · T)의 cFSM 분류를 막을지, 폐단면 Cw 를 설계에 쓸지 (아래)

전체 시험: `C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe test\python\run_all.py` → `Ran 266 tests in 22.506s` · `FAILED (failures=3)` — 실패 3건(`test_i621_uplift_r` · `test_analyze_loads_integration` · `test_fe_lap_golden`)은 모두 `design/loads` 쪽(F7 · F6 작업 중)이며 두 번 돌려 같았다. 내 시험 27건(`-k test_review_1122_cfsm`, 6.8 s)은 모두 통과. `ruff check python test` → `All checks passed!`

## 발견사항별

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| R3-01 | 고침 (F3 쪽) | `cfsm/node_utils.py:check_cfsm_model`(새 함수: 둥근 모서리 호 · 폐단면 · 가지 · 끊어진 모델 · 외톨이 절점 · 0 길이 요소 판정), `cfsm/classify.py:classify`(지원 밖이면 모든 행 NaN, 반환은 `list` 하위형 `CfsmClassification` 에 `status` · `supported` · `code` · `message` · `diagnostics` · `settings` 를 덧붙임) | 립 C 8x2.5x0.625x0.059 r=0.157 국부 극소 L=5.79: [0, 95.9, 3.9, 0.1] → [NaN×4], `code='ROUNDED_CORNER'`. F5 의 새 `dsm` 과 함께 자동 DSM: Pcrl 0 → 6.882 (r=0 모델 6.923, −0.6 %), `P_local_detected` False → True, 방법 `cfsm_modal` → `heuristic`. KL=100 Pn 12.76 → 9.99 kips(리뷰어의 라벨 교정값) | `test_R3_01_rounded_corner_classification_is_nan`, `test_R3_01_auto_dsm_keeps_local_buckling_for_rounded_corners`, `test_R3_01_unsupported_topologies_are_nan`, `test_R3_01_sharp_lipped_c_real_modes`, `test_R3_01_sharp_lipped_z_real_modes_locks_rotT` |
| R3-02 | 고침 | `vibration/solver.py:mlocal` 종방향 질량 `I4` → `I5` (mlocal.m:45-46) | v 만 자유인 평판 L=100: 33435 → 1050.42 Hz (닫힌 해 1050.42), L=10: 33435 → 10504 Hz. 긴 보 휨 1차는 거의 그대로 | `test_R3_02_axial_frequency_closed_form`, `test_R3_02_plate_and_beam_frequencies_closed_form` |
| R3-03 | 고침 (엔진 쪽) | `vibration/solver.py`: `STEEL_MASS_DENSITY_US = 7.345e-7 kip·s²/in⁴`, `KG_PER_M3_TO_KIP_S2_PER_IN4 = 9.357e-11`; prop 에 ρ 열이 없으면 강재 기본 + `DEFAULT_DENSITY` 경고(예전: 예외); ρ 가 1e-8 – 2e-6 밖이면 `DENSITY_UNITS_SUSPECT` 경고; 결과에 `rho_used` · `units` 덧붙임; `success` 는 error 진단이 없을 때 True(경고로는 False 가 되지 않음) | GUI 의 ρ=1.0 은 값은 그대로(1/1167 배)이고 이제 경고가 붙는다. ρ 미지정(서버 `rho` 없음 + 6열 prop): 예외 → 강재 값 | `test_R3_03_density_default_and_units_warning` |
| R3-04 | 고침 | `cfsm/node_utils.py:meta_elems` 일직선 판정을 atan2 차이 → 단위벡터 외적·내적(`is_collinear_through`, `COLLINEAR_SIN_TOL=1e-6`); `cfsm/constraints.py:_non_parallel_meta_elem`(새) — 평행 메타요소만 있는 '모서리'에서 0 행을 남기던 `continue` 를 오류로(`constr_xz_y`, `constr_yu_yd`, det≈0 `continue` 제거) | 잡음 1e-13 C 의 L=7 분류 [41.7, 28.1, 0.0, 30.2] → [0.3, 1.3, 98.2, 0.2](잡음 0 과 같음); nmno 9 → 6, nD 5 → 2, Rx 0 행 3 → 0 | `test_R3_04_subnode_detection_survives_atan2_wrap`, `test_R3_04_parallel_corner_raises` |
| R3-05 | 보류 (오인 방지만) | `fcfsm/solver.py:stripmain_fcfsm` — 분류를 길이·BC·m 마다 기저를 만드는 고전 cFSM(`cfsm.classify`)으로 바꾸고 `method='fsm_eigen+classical_cfsm_classification'`, `is_fcfsm=False`, `warnings`, `classification_status`, 진단 `FCFSM_NOT_IMPLEMENTED` 를 덧붙임. 모듈 · 함수 docstring 을 실제 계산대로 고침. `_classify_fcfsm` · `section_analysis_fcfsm`(이제 쓰지 않음)의 25 % 대체를 NaN 으로 | 예리한 립 C L=1000: [86.9, 0, 0, 13.1] → [100, 0, 0, 0](고전 cFSM). 둥근 모서리: [0, 99.9, 0.1, 0] → NaN. 곡선은 그대로(보통 FSM) | `test_R3_05_fcfsm_result_is_flagged_not_fcfsm` |
| R3-06 | 고침 | `cfsm/base_vectors.py:base_update` 결합 분기가 `b_v = b_v_l.copy()` 에서 시작(손대지 않는 열은 자연기저) | couple=2 · orth=1 의 국부 분류 [25, 25, 25, 25] → [0.26, 1.34, 97.49, 0.91] (= couple=1) | `test_R3_06_coupled_natural_basis_equals_uncoupled` |
| R3-07 | 고침 | 같은 함수: O 공간을 열로 대입(base_update.m:251-253), 결합 분기 ospace 번호는 MATLAB 그대로(1 · 2 ST, 3 K, 4 Kg, 5 벡터 — V1-03 뒤 되돌림), 고유치 실패 시 단위행렬 대체 제거 | C-C m=1..3, couple=2, ospace=3: `ValueError broadcast` → rank 252, 분류 합 100 %. ospace 의 뜻은 바뀌지 않음 | `test_R3_07_coupled_ospace_multi_m`, `test_V1_03_ospace_numbering_matches_matlab_per_couple` |
| R3-08 | 고침 | = R2-07 | | |
| R3-09 | 해당 없음 | F2 의 `models/data.py:GBTConfig.is_active` | — | — |
| R3-10 | 고침 (엔진 쪽) | `cfsm/classify.py`: `CUFSM_CLASSIFY_DEFAULTS = {ospace 1, orth 2, couple 1, norm 1}`(loader.m:135-145). `GBTcon=None` 이거나 속성이 없으면 이 값. 설정 검증(범위 밖 → ValueError), 쓴 설정을 `settings` 로 반환 | `classify(..., None)` 의 예리한 립 C 휨 국부 L=4.92: [0.5, 3.3, 91.8, 4.5] → [0.5, 3.5, 95.5, 0.5]. F2 가 `GBTConfig` 기본을 orth 2 · norm 1 로 바꿔 `GBTConfig()` 를 넘기는 경로(`aisi_s100`)도 이제 CUFSM 기본으로 분류한다 | `test_R3_10_default_settings_are_cufsm` |
| R3-11 | 고침 | `plastic/pmm_plastic.py:_create_fibers` 길이 × 두께 방향(`n_thick=10`, fiber4elem.m 의 NL) 격자; 항복값이 정의되지 않는 축(중심선 I≈0)은 정규화 배열 NaN + `normalized` · `warnings` 키, 원값 `P_raw` · `M11_raw` · `M22_raw` 덧붙임 | 6x0.25 평판 약축 Mp 0 → 4.6875 (b t²/4·Fy = 4.6875; 짝수 NL 의 중점 파이버는 |z| 적분이 정확); 30° 회전 시 M22_y=100 으로 나누던 것 → NaN + 경고. I 단면 약축 Mp 125.0 → 129.9 (웨브 h t²/4 항 포함) | `test_R3_11_plastic_through_thickness_fibres`, `test_R3_11_17_plastic_closed_forms_and_exact_p0` |
| R3-12 | 고침 (엔진 쪽) | `vibration/solver.py:stripmain_vib(…, springs=None, constraints=None)` — stripmain_vib.m 과 같이 K 에 스프링(`_assemble_springs`), 사용자 구속은 `constr_user` → R = null(null(Ruser')') | 인자를 주면 반영(지금 서버는 넘기지 않음 — 후속). 판 띠 가장자리 kw=1e6 → f₁ 이 고정 가장자리 값과 1 % 안쪽; 구속식 w5=0·w1 = 절점 고정과 같은 f₁ | `test_R3_12_vibration_springs_and_constraints` |
| R3-13 | 고침 | `cfsm/base_vectors.py:base_column` 첫머리에서 `check_cfsm_model` — 폐단면 · 끊어진 모델 · 외톨이 절점은 `ValueError('cFSM base vectors: … (cFSM supports open sections only)')`. 둥근 · 가지 단면은 기저를 계속 만든다(구속 해석용) | rhs: `ValueError: array must not contain infs or NaNs` → 원인을 밝힌 오류; `classify` 는 NaN + `CLOSED_SECTION` | `test_R3_13_closed_section_basis_clear_error`, `test_R3_01_unsupported_topologies_are_nan` |
| R3-14 | 고침 | `cfsm/classify.py:mode_class` · `mode_class2` · `_solve_coeffs`: 특이 기저 · 잔차 > 1e-6 · 0 벡터 → NaN(lstsq · 25 % 대체 제거). `classify`: 빈 모드형상 · 크기 불일치 · 기저 생성 실패 · 기저 cond > 1e12 → 그 길이 NaN + 진단(`NO_MODE_SHAPE`, `SHAPE_SIZE_MISMATCH`, `CFSM_BASIS_FAILED`, `CFSM_BASIS_SINGULAR`, `MODE_NOT_CLASSIFIED`) | 0 모드: [25, 25, 25, 25] 또는 0 행 → NaN. 단일 평판(전체 모드 2개라 기저 rank 23/24): [0, 0, 100, 0] → NaN(`CFSM_BASIS_SINGULAR`) | `test_R3_14_failed_decomposition_is_nan` |
| R3-15 | 고침 (F3 쪽, V1 뒤) | `cfsm/base_vectors.py:constrained_selection_notes`(새, `cfsm` 에서 내보냄): G 만 고른 선택이면 경고 `CFSM_PURE_G_NOT_PCRE`(factor = 1/(1−νx·νy), 'Pcre 로 쓰지 말 것'), `mode_select` · `base_update` docstring 에 같은 경고. 구속해를 결과로 내는 곳은 F1 의 `stripmain` 이므로 그쪽이 이 목록을 진단에 붙인다 | 값 변화 없음(경고만) | `test_R3_constrained_solutions_bound_fsm` (실측 비 1.0990 ± 1.5 % 와 경고 factor 1.0989) |
| R3-16 | 고침 (엔진 쪽) | `cfsm/base_vectors.py:mode_select` 선택 벡터 길이 검사(`glob must have length 4 …`); `yDOFs` 뒤틀림 영공간 벡터가 ndm 보다 많으면 앞의 ndm 개를 쓰던 것을 오류로(yDOFs.m:101 과 같게); `cfsm/stiffness.py:Kglobal_transv` · `create_Ks` 재료 미정의 시 0 번 재료 대체 → `ValueError` | `GBTConfig(glob=[1.0])`: IndexError → 길이를 밝힌 ValueError | `test_R3_16_input_validation` |
| R3-17 | 고침 | `plastic/pmm_plastic.py:pmm_plastic` — θ 마다 e 를 고른 간격으로 두던 것을 목표 P(−Py … +Py, n_na 개)에 맞는 중립축을 바로 찾도록(누적 면적, 걸친 파이버는 면적 분할, 같은 거리의 파이버는 한 묶음) | 립 C 약축: |P|≤0.02Py 표본 max 160.02 → P=0 에서 정확히 161.69 (독립 적분 대비 0.2 % 안쪽). 출력 모양 (n_na, n_theta) 그대로, P 축 표본 위치가 바뀜 | `test_R3_11_17_plastic_closed_forms_and_exact_p0` |
| R2-06 | 고침 | `cfsm/base_vectors.py:_cutwp_topology`(새) — 그래프의 독립 고리 수로 open / close / arbitrary(셀+가지) 판정, `_sectorial`(새) — 셀에서 dω = (ρ − ψ/t)ds(ψ = 2Ae/∮ds/t), 가지에서 dω = ρ ds. J = 4Ae²/∮(L/t) + Σ가지 b t³/3 | RHS 6x4x0.1 + 립 0.5: J 0.0067 → 10.8055 (= 셀 10.8053 + 0.5·0.1³/3), Cw 155.6(허위) → 1.07 (셀만 0.90) | `test_R2_06_cell_with_branch_is_not_open` |
| R2-07 | 고침 | 같은 재작성: 셀을 요소 번호로 순회해 신발끈 공식으로 Ae, 방향 · 순서 무관 | 4x4 각관 한 요소 반대 J 3.600 → 6.400 (Bredt 6.400); RHS 6x4 요소 넷 반대 2.701 → 10.805 | `test_R2_07_bredt_J_independent_of_element_direction_and_order` |
| R2-08 | 고침 | 셀(가지 포함)의 전단중심 · B1 · B2 · wn · Cw 를 위의 Saint-Venant 뒤틀림 함수로 계산(Trefftz 정의, 열린 단면과 같은 식). 예전에는 NaN → `engine/cutwp.py` 가 도심 · 0 으로 바꿈 | 4x6 상자(왼쪽 벽 t=0.3): Xs = 도심 → 셀 전단류 독립 계산값(1e-6 안쪽). 균일 RHS 9x5x0.1 Cw 0 → 9.188 in⁶ (= b²h²t(b−h)²/(24(b+h)), Kollbrunner-Basler), 정사각관 · CHS 0. 이중대칭 관 Xs · Zs = 도심(변화 없음) | `test_R2_08_closed_cell_shear_center_and_cw` |
| R2-17 | 고침 | `_cutwp_topology`: 끊어진 모델 → `ValueError('cutwp: the model is disconnected (n separate parts) …')`, 셀 2개 이상 → `ValueError('multi-cell …')`, 0 길이 · t≤0 · 범위 밖 절점 → `ValueError`. '한 끝도 방문하지 않은 요소를 집는' 대체 제거 | 떨어진 앵글 둘: Xs 2.17 · Cw 17.98 → 오류 | `test_R2_17_disconnected_and_multicell_raise` |

그 밖의 기초 시험(발견사항 아님, R3 「시험이 없는 동작」): `test_R3_basis_dimensions_rank_and_mechanics`(nG=4, nD=nmno−4, nL=nmno+2nsno+neno, nO=2nel, rank 꽉 참, G/D 횡방향 막변형 · 면내 전단 0, L 의 v=0 · u=0), `test_R3_constrained_solutions_bound_fsm`(구속해 ≥ FSM), `test_R2_open_sections_unchanged_closed_forms`(열린 단면 J = Σbt³/3, 앵글 Cw=0, I 전단중심=도심). 열린 단면 12종(lippedc · lippedz r=0/r>0, isect, tee, angle, hat, track, lipped_angle)의 `_cutwp_prop2` 16개 출력은 재작성 전후 1e-9 안쪽으로 같다(스크래치 `fix\F3\cutwp_baseline.py`).

`rot.T` 잠금: Z 에서 자연기저 G2 · G3 만 선택한 구속해 = π²E·I₁,₂/(A L²)/(1−ν²) (1 % 안쪽). `rot.T` 를 `rot` 로 바꾼 변이에서 G2 하중계수가 142.8 → 45.0 으로 떨어져 시험이 실패함을 확인했다(분류 % 는 G 공간이 같아 변이를 못 잡는다).

## 4.1 계약 — F3 쪽이 지금 돌려주는 것

- `cfsm.classify(prop, node, elem, lengths, shapes, GBTcon, BC, m_all)` 의 반환은 예전처럼 `clas[i] = (nmodes, 4) ndarray [%G, %D, %L, %O]` 의 리스트다. 형은 `list` 하위형 `CfsmClassification` 이라 `[c.tolist() for c in clas]` · 인덱싱 · `len` 은 그대로 된다.
- **NaN 행**: 모델이 고전 cFSM 밖이면 모든 길이 · 모든 모드가 NaN, `status='unsupported'`, `code` ∈ {`ROUNDED_CORNER`, `CLOSED_SECTION`, `BRANCHED_SECTION`, `DISCONNECTED`, `ORPHAN_NODE`, `ZERO_LENGTH_ELEMENT`, `BAD_TOPOLOGY`}. 모델은 지원되지만 어떤 길이 · 모드의 분해가 실패하면 그 행만 NaN, `status='partial'`. 25 % 균등이나 0 행은 어디에서도 나오지 않는다. 숫자 행의 합은 100 %.
- 둥근 모서리 판정: 같은 요소로 이어진 두 꺾임 절점이 같은 쪽으로 돌고 그 가운데 작은 쪽이 60° 미만이면 호로 본다(90° 호를 n 등분하면 45/n · 90/n). 템플릿 lippedc · lippedz · hat · track · angle · lipped_angle 은 r>0 이면 모두 걸리고 r=0 이면 하나도 걸리지 않는다. 플랜지를 요소 하나로 둔 거친 모델에 50° 립 같은 얕은 꺾임이 이어지면 거짓 양성(안전 쪽 — 휴리스틱으로 감)이 날 수 있다.
- **둥근 모서리를 바르게 분류하는 길은 넣지 않았다**(호 절점을 부절점으로 다루거나 예리한 등가 기저를 쓰는 것은 GBT 의 평판 가정을 벗어나 r=0 결과와 맞는다는 근거를 시험으로 보일 수 없었다). 그래서 NaN.
- JSON: 서버의 `classify` 경로는 `[c.tolist() for c in clas]` 뒤 `SafeJsonEncoder` 를 거치므로 NaN → `null` 로 살아남는다(시험으로 확인). **ndarray 를 그대로 넣으면 `SafeJsonEncoder._sanitize` 가 NaN 을 0.0 으로 바꾼다(R8-25)** — 서버는 `.tolist()` 를 지켜야 하고, 다음 묶음에서 `_sanitize` 의 ndarray 분기도 `None` 으로 바꿔야 한다. 그래서 반환 원소를 ndarray 로 두되(호출자 호환) 행은 float NaN 으로 낸다.
- dsm 쪽: `_gdlo_label` 이 이미 non-finite 를 None 으로 다룬다. F5 의 새 `extract_dsm_values` 와 함께 둥근 모서리 립 C 가 휴리스틱(`single_minimum`)으로 가고 Pcrl 6.882 (r=0: 6.923) 를 낸다(`test_R3_01_auto_dsm_keeps_local_buckling_for_rounded_corners`). **주의: 옛 dsm 과 짝지으면 NaN 행은 `cfsm_modal_no_ld` → "부재 확인"으로 읽혀 더 나빠진다** — F3 쪽 혼자로는 닫히지 않고 F5 의 계약 쪽이 같이 있어야 한다(지금 작업 폴더에서는 둘 다 들어가 있다).

## 후속 — 다른 곳이 따라와야 하는 것

- `python/server.py:94-101` (`classify`): 패널이 보내는 top-level `params['GBTcon']` 를 `model.GBTcon` 보다 먼저 쓴다(R3-16, `StcfsdPanel.ts:1353-1357, 2661-2665`). 결과가 리스트뿐이라 `CfsmClassification.summary()`(status · code · message · settings · diagnostics)를 실을 자리가 없다 — 새 메서드(예: `classify_v2`)나 envelope 를 정하고 TS 를 같이 바꾼다. `.tolist()` 는 지킨다.
- `python/models/data.py` (F2): `GBTConfig` 기본 orth 2 · norm 1 — F2 가 반영함(V1-02 는 그 영향; 개별 모드 선택의 뜻은 위 V1 절).
- `python/design/aisi_s100.py:2895` (F4): 분류용으로 `GBTConfig()` 대신 `None`(CUFSM 기본)을 `classify` 에 넘긴다.
- `python/engine/fsm_solver.py:208-215` (F1): cFSM 구속 해석에 (a) `cfsm.check_cfsm_model(node, elem)` 이 `ROUNDED_CORNER` · `BRANCHED_SECTION` 이면 진단 경고("고전 cFSM 공간이 물리 모드가 아님" — 둥근 립 C 순수 L 27.59 vs FSM 18.27), (b) 선택이 G 만이면 "순수 G 값은 ε_x=0 가정으로 1/(1−ν²)≈1.099 배 높음 — Pcre 로 쓰지 말 것"(R3-15). `base_column` 은 이제 폐단면에서 `ValueError` 를 낸다(예전에도 NaN 오류로 실패).
- `python/server.py:117-137` (`vibration`): `model.springs`, `model.constraints` 를 `stripmain_vib(..., springs=, constraints=)` 로 넘긴다(R3-12). 결과에 `rho_used` · `units` 를 실어 보낸다. `rho` 가 없으면 넘기지 않는다(엔진이 강재 값 + 경고).
- `src/webview/StcfsdPanel.ts:1368` (`rho: options.rho ?? 1.0`), `:2476` (`_runVibration` 이 `rho: 1.0` 고정), `src/mcp/server.ts:693-695` ("Material density (default 1.0)", `rho ?? 1.0`): 기본 1.0 을 없애고(보내지 않음 → 엔진 강재 7.345e-7) 입력 이름을 "질량밀도 [kip·s²/in⁴]" 로. MCP `units="SI"` 이면 kg/m³ 를 받아 `× 9.357e-11` (7850 → 7.345e-7), 무게밀도 lb/in³ 를 받으면 `÷ 386.09 ÷ 1000`. 진동 결과 화면에 `DENSITY_UNITS_SUSPECT` · `DEFAULT_DENSITY` 경고를 보인다.
- `src/mcp/server.ts:745`: ospace 설명("1=ST, 2=K null, 3=Kg null, 4=vector null")은 비결합(couple=1)에만 맞다. 결합(couple=2)은 MATLAB 번호 1 · 2 ST, 3 K, 4 Kg, 5 벡터(엔진은 MATLAB 그대로 — V1-03). 설명에 couple 별 번호를 적고, 스키마가 couple=2 에서 ospace=5 를 받게 한다(엔진 `classify` 는 couple=1 의 ospace=5 를 ValueError 로 거절).
- `python/engine/fsm_solver.py` cFSM 구속 경로 (F1): `cfsm.constrained_selection_notes(GBTcon, prop)` 를 진단에 붙인다 — `CFSM_PURE_G_NOT_PCRE`(warning, R3-15) 와 `CFSM_INDIVIDUAL_MODES_BASIS_DEPENDENT`(info: 개별 모드 선택이면 쓴 orth · couple · ospace · norm, V1-02).
- `python/fileio/mat_loader.py:85-94` (W1): 빠진 orth/norm 을 CUFSM loader.m 처럼 2/1 로(지금 1/0 — `GBTConfig.from_dict` 기본 2/1 과 다르다). couple=2 · ospace 는 MATLAB 번호 그대로 넘기면 된다(엔진이 같은 번호를 쓴다).
- `src/webview/StcfsdPanel.ts:2446-2448` (`set_gbtcon` 기본 `norm 0`, `orth 1`): CUFSM 기본 `norm 1`, `orth 2` 로.
- `webview/js/app.js:2982-3000` (`renderClassifyCurve`): `null` 을 `|| 0` 으로 0 % 로 그린다 — "cFSM 분류 불가(둥근 모서리 등)" 문구를 보이고 그리지 않게.
- `python/server.py:103-115` (`fcfsm`): 새 키 `method` · `is_fcfsm` · `warnings` · `classification_status` 를 실어 보낸다. README · NEWS 의 fcFSM 광고 문구를 "미구현"으로.
- `python/server.py:139-157` (`plastic`): 새 키 `normalized` · `warnings` (그리고 필요하면 `*_raw`)를 실어 보낸다. 평판 약축처럼 정의되지 않는 축의 정규화 값은 `null` 로 간다.
- `python/engine/cutwp.py:40-52` (F2): `_cutwp_prop2` 가 이제 셀 단면에서도 Xs · Zs · Cw · B1 · B2 · wn 을 유한값으로 준다 — NaN 대체 블록은 열린/닫힌 모두에서 더는 쓰이지 않는다. 끊어진 모델 · 다세포 · 0 길이 · t≤0 은 `ValueError` 가 올라온다(`server.py:214-218` 은 오류 응답으로, `aisi_s100._auto_generate_props` 는 `_auto_error` 로 받는지 F4 가 확인).

## 사용자 결정 필요

1. **가지 단면(I · T · 십자) 분류**: §4.1 지시대로 NaN 으로 막았다. MATLAB cFSM 은 가지 단면을 지원하고(`constr_yu_yd`), 리뷰어 실행에서 I · T 는 nD=0 · 합 100 % 로 그럴듯했지만 물리적 타당성은 확인되지 않았다. 선택지: (a) 그대로 NaN(휴리스틱) — 지금, (b) 가지 단면을 허용하고 닫힌 해 비교 시험을 붙인다.
2. **폐단면 Cw 를 설계에 쓸지**: R2-08 수정으로 RHS 의 Cw 가 0 → b²h²t(b−h)²/(24(b+h)) (9x5x0.1 에서 9.19 in⁶)가 되어 설계 경로(`engine/cutwp.py` → Fcre 비틀림 항)로 들어간다. 이론적으로 맞고 GJ 에 비해 무시할 만큼 작다(L=100 in 에서 π²ECw/L² ≈ 27 vs GJ ≈ 1.2e5 kip·in²). AISI 관행처럼 관의 Cw 를 0 으로 두려면 `engine/cutwp.py`(F2) 에서 폐단면만 0 으로 덮는다.

## 못 한 것

- **R3-05 fcFSM 이식**: 실제 이식에는 `SecAnal_fcFSM.m`(판 단위 힘 [q], 굽은 모서리 `cornerStrips` 입력, `C_L = null(J_GD')`, 평형 기저 `J_D`)과 `stripmain_fcFSM.m` 의 #1–#3 블록(길이마다 `C_D = K\J_GD·J_D`, `J_G = null(C_D'·J_GD)`, `C_G = K\J_GD·J_G`, 다중 m 블록 대각 확장, 스프링 포함 K, 변형에너지 비 분류 — 4 열은 O 가 아니라 오차)을 옮기고, `examples/batchcufsm5_fcFSM.m` 예제 값과 둥근 모서리 립 C 의 L ≥ 95 % · 긴 길이 G ≥ 99 % 로 시험해야 한다. 이번에는 결과를 fcFSM 으로 오인하지 못하게만 했다.
- R3-12 의 cFSM 모드 구속(GBTcon) 진동은 넣지 않았다(stripmain_vib.m 은 지원). 진동의 스프링 ys 는 엔진 FSM 과 같이 길이 비율로 받는다.
- 비결합 base_update 의 ospace=2/3 에서 K·Kg 해가 실패하면 영공간 벡터로 조용히 대체하는 것(옛 동작)은 리뷰 지적 밖이라 그대로 두었다. 결합 분기는 이제 오류를 올린다.
- MATLAB 실행 비교는 이번에도 못 했다(MATLAB 없음). 닫힌 해 · 독립 계산으로 대신했다.

## V1 검증 뒤 고친 것

V1(`verify/V1-fsm-section-cfsm.md`)의 지적 V1-02 · V1-03 · R3-15 에 대해. 모두 덧붙이기이고 값이 바뀐 것은 couple=2 의 ospace 번호를 MATLAB 으로 되돌린 것뿐이다.

| 번호 | 무엇을 바꿨나 (파일:함수) | 값의 변화 | 회귀 시험 |
|---|---|---|---|
| V1-03 | `cfsm/base_vectors.py:base_update` 결합 분기의 ospace 번호를 MATLAB `base_update.m:247-270` 그대로 되돌림: 1 · 2 = ST(2 는 직교화만 켬), 3 = K\null(GDL'), 4 = Kg\null(GDL'), 5 = null(GDL'). R3-07 의 행/열 전치 수정(열 대입)과 R3-06 의 자연기저 시작(`b_v_l` 복사)은 유지. MATLAB 이 K · Kg 를 만들지 않아 멈추던 경우(ospace 4 · orth 1)는 필요한 행렬을 만든다. 번호를 docstring(`base_update`, `classify`)에 couple 별로 적음. `classify` 설정 검증이 ospace 5 를 받고, couple=1 의 ospace=5 는 ValueError | 첫 수정 대비: couple=2 의 ospace 2 → ST(전: K), 3 → K(전: Kg), 4 → Kg(전: 벡터), 5 → 벡터(전: 거절). **원래(수정 전) Python · MATLAB 과 같은 뜻** | `test_V1_03_ospace_numbering_matches_matlab_per_couple` — couple 1 · 2 의 ospace 값마다 O 열 공간이 MATLAB 정의(자연 O / K\A / Kg\A / A, C-C m=1,2)와 1e-8 안에서 같고 다른 정의와는 1e-4 넘게 다름; `test_R3_07_coupled_ospace_multi_m` 은 ospace 1–5 rank |
| V1-02 | 개별 모드 색인이 기저에 따른다는 것을 `base_update` · `mode_select` · `classify` docstring 에 밝힘. `constrained_selection_notes` 가 개별 선택이면 info `CFSM_INDIVIDUAL_MODES_BASIS_DEPENDENT` 와 쓴 설정을 돌려준다 | 값 변화 없음 | `test_V1_02_individual_mode_index_is_basis_dependent` — 예리한 립 C L=200, glob=[0,1,0,0]: orth=1 은 π²E·I11/(A L²)/(1−ν²) (±1 %, 닫힌 해), orth=2 는 G 전체 구속해의 2 차 고유치(1e-6); 두 값은 50 % 넘게 다름; 전체 G 선택은 orth 와 무관(1e-8) |
| R3-15 | 위 표의 R3-15 행 | 경고만 | `test_R3_constrained_solutions_bound_fsm` |

작업 중 `test_R3_07_coupled_ospace_multi_m` 의 C-C 해석 부분이 F1 의 `engine/fsm_solver.py:493` 이 아직 없는 `terms_from_half_wavelengths` 를 들여와 잠시 실패했고, F1 이 그 함수를 넣은 뒤 통과했다.

V1 뒤 마지막 실행: 내 시험 `-k test_review_1122_cfsm` 29 passed. 전체 `run_all.py` → `Ran 352 tests in 36.209s` · `FAILED (failures=15)` — 실패 15 건은 모두 다른 담당이 고치는 중인 곳이다: `test_review_1122_server`(W1: `load_mat` 의 `mat_loader._m_all`, analyze `assumptions` · aisi_design 경고 비교), `test_review_1122_dsm_shear` · `test_review_1122_member` 의 R5-01/R5-03/F5 단일 극소(dsm 의 옛 D 라벨 경로 — 내 NaN 경로는 같은 단면에서 local_detected True · Pcrl 6.04 로 따로 확인), `test_design_verification` 의 설계 계약 4 건. cFSM · 진동 · 소성 · cutwp 에 걸린 실패는 없다. `ruff check python test` → `Found 1 error` — F1 의 `python/engine/fsm_solver.py:563` E741(`l`), 내 파일은 통과.

## V4 검증 뒤 고친 것

V4-02(`verify/V4-boundary-rendered.md`): C-C 다항 진동이 끝나지 않음. 원인은 `vibration/solver.py` 가 lil 블록 조립(2×2 블록을 m·p 쌍마다) + 전 고유치 QZ 를 쓴 것.

| 무엇을 바꿨나 (파일:함수) | 값의 변화 | 회귀 시험 |
|---|---|---|
| `vibration/solver.py:stripmain_vib` — K · M 을 dense 배열로 만들고 `engine.assembly.assemble(K, M, k, m, …)` 의 색인 경로로 요소마다 한 번에 더한다(F1 R1-04; (K, M) 을 (K, Kg) 자리에 넘김). 좌표변환도 `trans(alpha, k, m)` 한 번. 고정 DOF 는 `np.ix_` 로, 사용자 구속은 dense `Rᵀ K R`. 고유치는 새 `_lowest_vibration_modes` → F1 의 `engine.fsm_solver._lowest_positive_modes` 를 그대로 쓴다: K 가 정부호이면 대칭 정부호 `eigh(M, K, subset)` (μ = 1/ω², 큰 쪽부터 neigs 개), Cholesky 가 실패하면(0 행 등) 예전과 같은 거르기의 전 고유치 QZ. K 의 정부호 여부는 Cholesky 시도로 가리고 `_stiffness_info` 의 전 고유치 계산은 하지 않는다(그것만으로 3108 DOF 에서 길이당 1 s 넘음). 모드는 예전 QZ 처럼 2-노름 1 로 정규화 | 예전 구현(스크래치 사본) 대비 1–6 차 진동수 상대차: 축방향 판 1.7e-14, 평판 1.3e-14, 관 S-S 5.1e-10 · C-C(m=1,3,5) 4.7e-10 · C-F(m=1..4) 1.9e-8, 스프링 1.7e-12, 구속식 1.1e-13, 예리한 립 C C-C m=1..8 9.0e-11 | `test_V4_02_vibration_fast_path_matches_slow_reference` (옛 lil + QZ 경로를 시험 안에서 재구성, C-C m=1..4, < 1e-8), 기존 진동 닫힌 해 시험 4 건 그대로 통과 |
| `fcfsm/solver.py:stripmain_fcfsm` — 같은 문제(구속 · 스프링 없는 FSM)이므로 자체 lil + QZ 사본을 지우고 `engine.fsm_solver.stripmain` 을 부른다. 분류는 stripmain 이 정리한 `m_all` 로 | 고유치는 stripmain 과 같다. 모드형상은 stripmain 규약(최대 성분 +1)으로 — 예전에는 |최대| = 1 · 부호 임의(분류 % 는 부호와 무관). stripmain 의 진단(항 부족 경고, ILL_CONDITIONED 등)이 같이 실린다 | `test_V4_02_vibration_and_fcfsm_use_fast_paths`, `test_R3_05_fcfsm_result_is_flagged_not_fcfsm` |
| 경로 시험 — `assemble` 과 `_solve_eigenproblem`(QZ)을 감싸 센다: 진동 C-C m=1..8 은 dense 조립 = 요소 수, lil 0, QZ 0; fCFSM 도 lil 0 · QZ 0 | — | `test_V4_02_vibration_and_fcfsm_use_fast_paths` |

남은 느린 곳은 없다: `cfsm/`(create_Ks · Kglobal_transv)은 처음부터 dense, `plastic/` 은 조립이 없다.

**시간** (립 C 8×2.5×0.625×0.059 r=0.09055, 37 절점, C-C, m=1..21 → 3108 DOF, 60 길이 logspace(1, 3), neigs=10, 이 PC):
- 전: 한 길이 318 s → 60 길이 약 19 000 s (5.3 h; 다른 담당의 시험과 CPU 를 나눠 쓴 측정이라 조금 과대)
- 후: 60 길이 133 s (길이당 2.2 s 가운데 dense `eigh` 1.45 s, klocal · mlocal · trans · assemble 0.7 s)
- 남은 시간은 3108×3108 dense 대칭 고유치 풀이(삼중대각화 O(n³))가 정한다 — 같은 경우의 좌굴 해석(stripmain)도 같은 크기다. 호스트의 5 분 제한 안에는 들지만 21 항 × 60 길이는 2 분이 넘으므로 **호스트는 진동 요청의 항 수 × 길이 수를 계속 묶거나 진행 표시를 두어야 한다**. 더 줄이려면 sparse shift-invert(ARPACK) 가 필요한데, 겹친 진동수에서 모드를 놓칠 위험이 있어 이번에는 넣지 않았다.

후속(추가): `python/server.py` 진동 · fcfsm 메서드는 바꿀 것 없음(인자 · 결과 키 그대로). `src/webview/StcfsdPanel.ts` 의 진동 요청 시간 제한은 위 시간에 맞춰 정한다.

V4 뒤 마지막 실행: 내 시험 `-k test_review_1122_cfsm` 31 passed. 전체 `C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe test\python\run_all.py` → `Ran 378 tests in 54.692s` · `OK`. `ruff check python test` → `All checks passed!`

## W3 화면 지적 뒤 고친 것 — 알림 분류 (FIXES §3.1.1)

W3(`fixes/W3-host-webview.md`, 「V4 검증 뒤 고친 것」)가 진동 화면에서 "질량밀도 없음 — 강재로 가정"이 경고로 뜨는 것을 짚었다. 내 모듈의 알림을 모두 §3.1.1 로 나눴다. 키는 덧붙이기만 했고 값은 바뀌지 않는다.

| 모듈 | warnings (값을 바꿨거나 손봐야 함) | assumptions (이 실행의 가정) | scope_notes (늘 참) |
|---|---|---|---|
| `vibration/solver.py:stripmain_vib` (새 키 `warnings` · `assumptions` · `scope_notes`) | `DENSITY_UNITS_SUSPECT`(구조 재료 범위 밖 ρ), 길이별 error 진단(NO_FREE_DOF 등 — 그 길이 값이 0) | `DEFAULT_DENSITY` — 진단 항목의 severity `warning` → `info`, `category='assumption'` | `VIBRATION_SCOPE_NOTES`: 감쇠 없는 자유진동 · 구조 질량만 · 축력 영향 없음; GBTcon 구속 미적용; S-S 밖은 항 수에 따라 위에서 수렴 |
| `plastic/pmm_plastic.py` (새 키 `assumptions` · `scope_notes`) | 정의되지 않는 축의 정규화 NaN(기존 `warnings` 그대로) | ±fy 강소성 파이버 · 두께 방향 파이버 수 · 정규화 기준(첫 항복값) | `PLASTIC_SCOPE_NOTES`: 총단면 전소성, 국부 · 뒤틀림 좌굴 · 변형경화 · 냉간가공 없음, 표시용 |
| `cfsm/classify.py:CfsmClassification` (새 속성 `warnings` · `assumptions` · `scope_notes`, `summary()` 에도) | NaN 행과 까닭(지원 밖 모델, 길이 · 모드별 실패) | GBTcon 에 없던 기저 옵션을 CUFSM 기본으로 채운 것(GBTcon=None 이면 넷 다) | `CFSM_SCOPE_NOTES`: 고전 cFSM 적용 범위(열린 · 가지 없는 · 예리한 모서리 판 단면), % 는 기저 옵션에 따름 |
| `cfsm/base_vectors.py:constrained_selection_notes` (항목에 `category` 덧붙임) | `CFSM_PURE_G_NOT_PCRE`(Pcre 로 쓰면 비보수) | `CFSM_INDIVIDUAL_MODES_BASIS_DEPENDENT`(개별 모드 색인의 뜻 · 쓴 설정) | — |
| `fcfsm/solver.py:stripmain_fcfsm` (`warnings` 의 내용을 나눔, `assumptions` · `scope_notes` 덧붙임) | stripmain 의 warning/error 진단 + 분류의 warnings | 분류의 assumptions | "fcFSM 미구현" (`FCFSM_NOT_IMPLEMENTED` 진단은 severity `warning` → `info`, `category='scope'`) + 분류의 scope_notes |

`fcfsm` 의 `warnings` 는 이번 묶음에서 내가 덧붙인 키였고, 거기 있던 "fcFSM 미구현" 문장은 `scope_notes` 로 옮겼다(`is_fcfsm=False` · `method` 는 그대로). 회귀 시험: `test_F311_notices_split_into_warnings_assumptions_scope`.

후속(추가): `python/server.py` 의 `vibration` · `plastic` · `fcfsm` · `classify` 응답에 새 세 키(분류는 `summary()`)를 실어 보내고, 화면은 진동 결과의 `DEFAULT_DENSITY` 를 진단 severity 대신 `assumptions` 로 보인다(W3).

알림 문장에는 `NaN` 이라는 낱말을 쓰지 않는다("undefined (null)", "empty/null rows") — 서버 시험 `test_R8_25_rounded_corner_classification_is_null_with_status` 가 응답 바이트에 `NaN` 토큰이 없는지 본다(처음 실행에서 새 scope note 문장 때문에 실패했다).

§3.1.1 뒤 마지막 실행: `-k test_review_1122_cfsm` 32 passed. 전체 `C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe test\python\run_all.py` → `Ran 382 tests in 55.918s` · `OK`. `ruff check python test` → `All checks passed!`
