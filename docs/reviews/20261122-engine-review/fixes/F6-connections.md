# F6 — 접합부(Chapter J) · Lap · 특수 주제 수정 기록

## 요약

고침 28 · 보류 0 · 기각 0 · 사용자 결정 필요 1 (R6-13). 대상 29건 = R6-01 – R6-24, R5-20 – R5-24.
(R5-22 의 `applicable` 키 뜻은 F4 호출자 때문에 바꾸지 않고 새 키로 보완 — 「못 한 것」 참고.)

전체 시험(마지막 실행, 두 번 반복): `C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe test\python\run_all.py` → `Ran 307 tests` /
`FAILED (failures=1)`. 실패는 F3 영역의 `test_review_1122_cfsm.test_R3_01_sharp_lipped_z_real_modes_locks_rotT` 하나로,
F6 파일을 부르지 않는다. (중간 실행에서 보였던 `design.loads` 의 세 실패 — `test_i621_uplift_r`, `test_analyze_loads_integration`,
`test_fe_lap_golden` — 는 F7 작업이 진행되며 사라졌다.) 린트 `ruff check python test` → `All checks passed!`.
새 시험 `test/python/test_review_1122_connections.py` 38개 전부 통과.

**V3 검증 뒤(아래 「V3 검증 뒤 고친 것」)**: 고침 13 (V3-01 – V3-10, 시험 R6-09 · R6-02 재작성, 시험 공백 7건), 결정으로 기록 1 (V3-11),
사용자 결정 가능 3 (V3-03 대체식 기본값, V3-09, V3-11). 접합부 시험 52개 통과, 되돌리기 시험 13/13 검출, 매뉴얼 재현값 변화 없음.
마지막 전체 시험(두 번 반복): `Ran 349 tests` / `FAILED (failures=9, errors=20)` — 실패·오류는 모두 `test_solver`, `test_review_1122_fsm`,
`test_review_1122_cfsm`, `test_review_1122_dsm_shear`, `test_review_1122_server`, `test_design_verification`(DSM 2건, 화면 문자열 1건,
전역좌굴 1건), `test_regression_0926`(DSM 1건)이며 원인은 `python/engine/fsm_solver.py`·`dsm.py` 를 다른 담당이 고치는 중인 것
(`_longitudinal_term_diagnostics() takes 6 positional arguments but 7 were given` 등). 접합부·lap·special_topics 시험은 하나도 없다.
린트는 F6 파일 전부 `All checks passed!`; 저장소 전체는 `python\engine\fsm_solver.py:563 E741` 1건(F6 파일 아님).

### 매뉴얼 재현 (가용강도 kips, 전 → 후, 매뉴얼 인쇄값)

| 예제 · 한계상태 | ASD 전 → 후 (매뉴얼) | LRFD 전 → 후 (매뉴얼) |
|---|---|---|
| IV-1 필릿, t1=0.105/t2=0.060 (그림 표기) | 5.162 → 4.316 (4.32) | 7.897 → 6.581 (6.58) |
| IV-1 필릿, t1=0.060/t2=0.105 | 4.315 → 4.316 (4.32) | 6.581 → 6.581 (6.58) |
| IV-2 아크 스팟 **전단 지배** | 3.051 시트 → **1.863 블록전단** (1.86) | 4.698 → **2.795** (2.80) |
| IV-2 J6.1 / J6.2 | 없음 → 2.43 / 2.19 (2.43 / 2.19) | 없음 → 3.645 / 3.62 (3.65 / 3.61) |
| IV-2 상향 인장 J2.2.3 | 없음(전단 3.05 와 비교) → 1.513 (1.51) | 없음 → 2.269 (2.27) |
| IV-2 J2.2.4 조합 | 없음 → 0.737 (0.735) | 없음 → 0.938 (0.932) |
| IV-3 아크 시임 시트 J2.3.2.1-2 | 3.334 → 3.049 (3.05) | 5.002 → 4.665 (4.66) |
| IV-3 **지배 J6.1** | 없음 → **2.808** (2.81) | 없음 → **4.212** (4.21) |
| IV-4 플레어 베벨 횡방향 (L=3.14 / 3.08) | 4.00 → 4.00 (4.00) | — → 6.00 (6.00, L=3.08) |
| IV-9 볼트 J6.1 / J6.2 / J6.3 | 3.672 / 5.66 / 4.895 → 같음 (3.67 / 5.68 / 4.91) | 5.298 / 8.168 / 7.064 → 같음 (5.30 / 8.19 / 7.09) |
| IV-9 지압 / 볼트전단 / D2 | 5.67 / 5.301 / 8.299 → 같음 (5.67 / 5.29 / 8.32) | 8.505 / 7.952 / 12.47 → 같음 (8.51 / 7.94 / 12.5) |
| IV-10 앵글 J6.2 (Usl 0.534) | 5.172 → 3.433 (3.43) | — |
| IV-10 앵글 J6.1 (2볼트 일렬) | 3.557 → 5.336 (5.36) | — |
| IV-10 앵글 J6.3 / 지배 지압 | 미평가 → 3.89 (3.89) / 2.43 → 2.43 (2.43) | — |
| IV-10 평판 J6.2 / J6.3 | — → 7.94 / 8.26 (7.93 / 8.29) | — |
| IV-11 나사 **전단 지배** | 0.196(풀아웃, 방향 혼합) → **0.360 틸팅** (0.360) | 0.294 → **0.540** (0.540) |
| IV-11 인장 지배 풀아웃 | (전단과 섞임) → 0.196 (0.196) | → 0.295 (0.295) |
| IV-11 J4.5.1 / J4.5.2 / J4.5.3 | 없음 → 0.379≤0.468 / 0.409≤0.451 / 0.199≤0.433 (같음) | 없음 → 0.632≤0.715 / 0.681≤0.690 / 0.331≤0.650 (같음) |
| IV-11 J6.1 | 0.556 → 0.556 (0.557) | 0.834 → 0.834 (0.835) |
| IV-12 PAF J5.3.3 | 0.027 → 1.591 (1.59) | 0.041 → 2.434 (2.44) |
| IV-12 **전단 지배** | 0.027(J5.3.3) → **0.657 지압·틸팅** (0.659) | 0.041 → **1.078** (1.08) |
| IV-12 인장 지배 풀오버 / J5.4 | 섞임 → 0.398 / 0.610 (0.397 / 0.610) | → 0.597 / 0.648 (0.595 / 0.648) |
| IV-12 핀 전단 / J6.1 / J6.2 | 1.498 / 0.843 / 8.299 → 같음 (1.50 / 0.843 / 8.30) | 2.382 / 1.265 / 12.45 → 같음 (2.38 / 1.27 / 12.5) |
| I-16 냉간가공 Fyc / Fya | 45.0 / 36.15 → 52.43 / 38.08 (52.30 / 38.06) | — |
| I-18 플랜지 컬링 cf | 0.000194 → 0.000194 (0.000194) | — |

매뉴얼과 다르게 둔 곳(모두 보수 쪽): IV-3 J6.2 는 매뉴얼이 Usl=1.0·Ω 2.50 으로 3.90/5.85 를 냈으나 기준 식이 없는
한계상태이므로 IV-2 의 합리적 해석(A1.2(c), Ω 3.00/φ 0.55)을 똑같이 써서 3.07/5.07 (지배 아님). IV-11 J6.2 는 매뉴얼이
Usl=1.0 으로 7.27/10.9, 코드는 Eq. J6.2-4 그대로 6.56/9.84. IV-12 J5.3.2 는 ds=0.180 을 매뉴얼처럼 0.177 로 보고
평가한다(허용폭 0.003 in, 경고).

## 발견사항별

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| R6-01 | 고침 | `connections.py`: `_j6_rupture_limit_states` 를 용접에도 적용(`arc_spot_weld_connection`, `arc_seam_weld_connection`), 필릿·플레어는 `_weld_j6`(J6.2 Table J6.2-1 용접 분류, J6.3 면적 입력). 모든 결과에 `j6_verified`·`not_evaluated` 가 들어가고 `design_connection` 이 §3.1 로 판정. 아크 스팟 J6.2 는 Manual IV-2 의 A1.2(c) 합리적 해석(구멍=da, Ω3.00/φ0.55). 버트 그루브(J2.1)는 겹침이 없어 J6 해당 없음으로 표기 | IV-2 지배 3.051→1.863 (1.86), 2.795 (2.80); Pu=2.5 ASD PASS→FAIL; IV-3 3.334→2.808 (2.81). 기하 없으면 PASS→NOT_CHECKED | `test_R6_01_*` 4개 |
| R6-02 | 고침 | `fillet_weld_connection`: t=min(t1,t2) 로 L/t 분기·φ/Ω 를 한 번 정하고 두 판에 같은 식 | IV-1 그림 표기 5.162→4.316 (4.32), 7.897→6.581 (6.58) | `test_R6_02_iv1_independent_of_sheet_order` |
| R6-03 | 고침 | `arc_spot_weld_connection`: Eq. J2.2.2.1-3 `0.280(1+5.59·λ/(da/t))` | t=0.03, d=0.88, Fu=65: 2.714→2.415 (손계산 2.415) | `test_R6_03_arc_spot_transition_equation` |
| R6-04 | 고침 | `arc_seam_weld_connection`: da=d−t, L≤3d, Ω 2.55, 식 라벨 J2.3.2.1-1/-2 | IV-3 3.334→3.049 (3.05), 5.002→4.665 (4.66); L=3.0 7.195→4.665 | `test_R6_04_iv3_arc_seam_sheet_and_length_cap`, 기존 `test_arc_seam_formula_terms` 바로잡음 |
| R6-05 | 고침 | `arc_spot_weld_connection`: `joint`(sheet_to_support/sheet_to_sheet, 미지정이고 t1=t2 면 두 식 모두 평가해 작은 값), J2.2.2.2 와 적용한계, `t_sheets`(Σt), `de`(절차 확보값), J2.2.3 인장(용도별 φ/Ω, 편심 50 %, 사이드랩 70 %), J2.2.4 조합(적용한계 포함), J2.2 최소 de 3/8 in·두께 0.15 in 범위 | 시트-시트 2.335→1.751 (손계산 1.751); IV-2 인장 1.51/2.27 (매뉴얼) | `test_R6_05_sheet_to_sheet_and_tension_and_interaction` |
| R6-06 | 고침 | `paf_connection`: Eq. J5.3.3-1 에 `E`(인자, 기본 29500), 상수 `PAF_FBS`(J5.2.1-2 전용, `PAF_FH` 는 호환 별칭) | IV-12 Pnos 0.069→4.057 (4.06); 지배 0.027/0.041→0.657/1.078 (0.659/1.08) — **허용 쪽 변화**, 기준식대로 | `test_R6_06_*` 2개 |
| R6-07 | 고침 | `paf_connection`: d'w ≤ 0.60 in, d'w 없으면 풀오버 미평가(추정 안 함), `alpha_w` 입력 | d'w=0.75: 2.632→2.106 (손계산 2.106) | `test_R6_07_paf_washer_cap_060` |
| R6-08 | 고침 | `_bolt_Fnv_Fnt`: d<1/2 나사통과 0.400Fu, A325·A490 d<1/2 는 오류, A354BD·A449 소경 나사제외 84·68, 알 수 없는 등급 오류 | d=3/8 Fnv 54→48 (Pns 5.964→5.301) | `test_R6_08_bolt_table_small_diameter` |
| R6-09 | 고침 | `bolt_connection`: 볼트 인장(J3.4-1) 한계상태, 상호작용을 `interaction_checks` 로 판정에 넣음, Vu 생략 시 디스패처가 Pu 를 전단으로 넘김, 볼트머리 풀오버는 `Pnov_bolt`(기준식 없음) 없으면 미평가 | 비율 1.51: PASS→FAIL; fv 0→10.19 ksi | `test_R6_09_bolt_interaction_fails_verdict` |
| R6-10 | 고침 | 모든 한계상태에 `direction`(shear/tension). 결과에 `shear_*`·`tension_*` 지배값. `design_connection` 에 `Vu`·`Tu`·`force_direction`(Pu 의 방향, 기본 shear = 과거 동작) 추가. 나사 J4.4.3(Pnts)·J4.5.1·J4.5.2·J4.5.3, PAF J5.2.1(Pntp, F_uh=F_bs·e^(HRC/40) 또는 260)·J5.4(Commentary C-J5.4-1, Manual IV-12), 아크 스팟 J2.2.3·J2.2.4 | IV-11 지배 0.196(풀아웃)→0.360(틸팅); IV-2 상향 인장 3.05(전단과 비교)→1.51 | `test_R6_10_*` 2개 |
| R6-11 | 고침 | `screw_connection` docstring 에 t1=머리·와셔 접촉 부재 명시, t1>t2 경고, 디스패처 별칭 `t_head`/`t_far`(t1/t2 와 다르면 오류) | 값 변화 없음(오입력 경고) | `test_R6_11_head_side_alias_and_swap_warning` |
| R6-12 | 고침 | `connections.shear_lag_factor` 하나로 Table J6.2-1 전부(평판·엇모·횡용접·전요소·용접/볼트 앵글·채널) 구현, `normalize_member_case`. J6.2 는 `member_case`(또는 `Usl`) 없으면 미평가. 하중방향 다열(`n_rows_long`, `pitch`)은 J6.1 e_net·J6.2 L 에 반영. `special_topics.shear_lag` 가 같은 함수 사용 | IV-10 앵글 J6.2 5.172→3.433 (3.43) | `test_R6_12_*` 3개, `test_R5_20_*`, `test_R5_21_*` |
| R6-13 | 사용자 결정 필요 | 모델은 그대로. `lap_connection.FORCE_MODEL` 을 결과 `force_model` 로 싣고(근거 §A1.2(c), 기준 조항 아님, 한계 (a)–(e)), Step 2·4 이름과 경고에 명시. 인용 「§B/§K2.1」→「§A1.2(c)」 | 값 변화 없음 (V_transfer = max(Mu/(d−t), Vu) 그대로) | `test_R6_13_lap_force_model_disclosed_unchanged` |
| R6-14 | 고침 | `design_lap_connection`: Se 없고 Mu>0 → `flexure_ok=None` → `pass=None`·`verdict='NOT_CHECKED'`; Vn 산정 불가로 H2 를 못 하면 None | Se 미입력: PASS→NOT_CHECKED | `test_R6_14_lap_without_se_not_pass` |
| R6-15 | 고침 | `paf_connection`: §J5 범위(t1≤0.06, t2≤0.75, ds 0.106–0.206), J5.3.2 한계(t2/t1≥2, t2≥1/8, ds 0.146–0.177), J5.3.3 한계(0.113≤t2≤0.75), Table J5.1-1 간격·연단, `alpha_b`, `HRC_p`. 범위 밖 한계상태는 `limit_states` 에서 빼고 `not_evaluated` 로. F_uh 입력이 없으면 120 ksi 는 참고값(미평가). 시공 조건(점 전체 관입, 0.6t2 관입)은 `assumptions` 에 명시 | t2=0.08: 값 있음→J5.3.2·J5.3.3 미평가, NOT_CHECKED | `test_R6_15_paf_limits`, 기존 `test_paf_limit_state_mapping` 입력 바로잡음 |
| R6-16 | 고침 | `check_lap_length`: 한쪽이라도 0 이면 `ok=None`; 메시지에 「R 계수법(I6.2.1)·J3 겹친 Z 슬롯 예외의 적용 조건」 | (8, 0, 13): ok True→None | `test_R6_16_lap_length_each_direction` |
| R6-17 | 고침 | `design_lap_connection`: `e=edge_dist` 를 공유 엔진에 넘김, 중복 Step 6a 삭제, Step 3 문구를 실제 포함 모드(J6.1 포함)로, 2e 보다 짧은 랩은 배치 0 | 볼트 1/2, e=2.0: Pns 1.51(J6.1)→2.788(지압, 손계산 2.788), n 12→6 | `test_R6_17_lap_end_distance_reaches_j61` |
| R6-18 | 고침 | `normalize_design_method`(connections) — 모든 진입점(`design_connection`, 각 함수, `design_lap_connection`, `shear_lag`, `block_shear`)에서 대문자 정규화, LSD·기타 오류 | 'lrfd' 0.684(ASD 값)→0.987(LRFD); 'LSD' 0.684→오류 | `test_R6_18_design_method_normalised_or_rejected` |
| R6-19 | 고침 | `bolt_connection`: `_mf_from_table`(hole_type, slot_orientation, washers, shear_plane; 모자라면 그 구멍 종류의 최소값), J3.3.2 선택(`consider_hole_deformation`), 장슬롯 오류, Table J3.3.1-1 두께 범위(0.024 ≤ t < 0.1875) 밖은 미평가, J6.1/J6.3 에 실제 구멍 치수(과대·슬롯), J6.2 Ant 는 표준공(Eq. J6.2-3) | 과대공 mf 0.75→0.70; 단슬롯(방향 미상) 0.75→0.55 | `test_R6_19_mf_by_hole_type_and_hole_deformation` |
| R6-20 | 고침 | 디스패처: t1·Fy·Fu·d(볼트·나사·PAF)·용접 치수 없으면 오류, 't' 키는 오류, 알 수 없는 키 경고. J3.1/J3.2/J4.1/J4.2/J2.2.1/J2.3.1/Table J5.1-1 검사(위반 → FAIL, 미입력 → 미평가), 나사 d 범위·J2/J3/J6 t≤3/16 범위 밖 → 판정 없음. 볼트 등급·Fub 모두 없으면 승인 볼트 최저 A307 값 | 미입력 기본값 0.059/SGC400/0.5 → 오류; 볼트 Fub 기본 120 → A307 (d≥1/2 Fnv 54→27) | `test_R6_20_scope_and_required_inputs`, 기존 `test_connection_bolt` 를 IV-9 실값으로 |
| R6-21 | 고침 (의심 → 확정: J4.3.2 는 제조사·시험값을 요구) | `screw_connection`: `Pnvs`·`Pnts` 입력. Pnvs 없으면 0.5·Fub·As 는 `assumed`·참고값으로만 남기고 미평가(→ NOT_CHECKED). d'w 미입력도 표시 | Pnvs 미입력 나사: PASS→NOT_CHECKED | `test_R6_21_screw_shear_needs_manufacturer_value` |
| R6-22 | 고침 | `_j6_rupture_limit_states`: 하중방향 다열(전단 길이에 (rows−1)·pitch, 구멍 (rows−½)), 단면당 패스너 수로 Ant, 단면당 1개면 연단 경로(`edge_transverse`, Manual IV-10) 필요, 블록 면적 직접 입력(`Agv_bs` 등). J1 편심은 미지원임을 `assumptions` 에 | IV-10 J6.3 미평가→3.89 (3.89); n=1 기하 없음: 그대로 계산→미평가 | `test_R6_22_block_shear_multi_row_and_single_fastener` |
| R6-23 | 고침 | `groove_weld_connection`: Table J2.6-1/-2(`process`, 미지정이면 하한), Eq. J2.6-5 의 t_wf·η, 플레어 V Eq. J2.6-7(`d1`,`d2`,`R2`). tw 를 못 구하면 종방향은 J2.6-2(보수), t>0.10 이면 J2.6-4 상한 미평가. PJP te 추정은 미평가 | tw 추정 0.707t 로 확정 → 판정 없음 | `test_R6_23_flare_throat_and_estimates` |
| R6-24 | 고침 | 라벨(J2.3.2.1, 필릿 J2.5, PHI_WELD 주석, PAF_FBS/'F_uh'), lap 모듈 docstring 인용, 죽은 `_screw_shear_strength` 삭제, 랩 < 2e 배치 0, `test_multi_bolt_c_factor` 를 실수치로 | — | 기존 `test_multi_bolt_c_factor` 바로잡음 |
| R5-20 | 고침 | `special_topics.shear_lag`: J6.2 파단에 Table J6-1(`connection_type`, 없으면 표의 가장 보수적인 Ω3.00/φ0.50 + 경고), D3(An·Fu, 2.00/0.75)는 따로 보고 | IV-10 평판 bolted ASD 8.804→7.93 (7.93) | `test_R5_20_shear_lag_table_j6_1_factors`, 기존 `test_shear_lag_design_strength_split` 바로잡음 |
| R5-21 | 고침 | `shear_lag`: J6.2-6(b1,b2)·J6.2-8(bf,bw), 분류명 정규화, 일반식 1−x̄/L 삭제(분류·Usl 없으면 오류), flat_sheet 에 d·s 없으면 1.0→하한 0.9 | IV-10 앵글 U 0.738→0.534, 가용 5.266→3.43 (3.43) | `test_R5_21_shear_lag_bolted_angle_and_channel` |
| R5-22 | 고침 (일부 보류) | `cold_work_strength`: Fyc 상한 삭제(Fya ≤ Fuv 만), 면적이 없으면 C=0(증가 없음), 압축부재 `A_total`·`n_corners` 사용, `formula_applicable`·`buckling_precondition`·`fya_usable` 추가, 새 인자 `buckling_precondition` | I-16 Fyc 45→52.43 (52.30), Fya 36.15→38.08 (38.06); 면적 없음 C 0.15→0 | `test_R5_22_cold_work_example_i16` |
| R5-23 | 고침 | `shear_lag`·`block_shear`: LSD·알 수 없는 방법 오류, 블록전단을 나사·PAF 에 쓰면 오류, 덜 보수적인 사용자 φ/Ω 경고 | LSD: ASD/LRFD 로 계산→오류 | `test_R5_23_block_shear_not_for_screws`, `test_R6_18_*` |
| R5-24 | 고침 | `flange_curling`: `d`(보 깊이, h 대신), `wf_is_half_clear_distance`, docstring 의 h 뜻 | 값 변화 없음 (I-18 0.000194) | `test_R5_24_flange_curling_example_i18` |

바로잡은 기존 시험(함수 안에서만, 까닭 주석 1줄): `test_design_verification.py` 의 `test_connection_bolt`(R6-20),
`test_shear_lag_design_strength_split`(R5-20/21), `test_multi_bolt_c_factor`(R6-24), `test_arc_seam_formula_terms`(R6-04),
`test_paf_limit_state_mapping`(R6-15, 입력을 J5.3.2 범위 안으로), `test_bolt_shear_tension_interaction_j34`(R6-12 member_case);
`test_regression_0926.py` 의 `test_j6_bolt_full`, `test_j6_screw_paf_rupture_no_block`, `test_connection_not_checked_verdict`(R6-12 member_case).

### 판정에 생긴 큰 변화 (§3.1 의 결과)

- 불합격이 있으면 미평가가 있어도 `pass=False` (과거 `None`).
- J6.2 는 `member_case` 없이는 평가하지 않는다 → 볼트·나사·PAF·필릿·플레어의 많은 기존 호출이 PASS → NOT_CHECKED.
  MCP·GUI 가 아직 이 키를 못 보내므로 다음 묶음 전까지 접합부 판정은 대부분 NOT_CHECKED 가 된다(의도한 것).
- 끝단 거리 e(볼트·나사·PAF·용접), n>1 의 간격 s, 나사 Pnvs, PAF F_uh 가 없으면 NOT_CHECKED.
- 소요 인장 Tu 를 주면 인장 쪽 미평가 항목(나사 Pnts, PAF Pnot, 볼트머리 풀오버)이 판정을 막는다. Tu 가 없으면 인장
  한계상태는 판정에 쓰지 않고 `assumptions` 에 그렇게 적는다(과거 동작: 전단만).

## 후속 — 다른 곳이 따라와야 하는 것

새 입력 키(디스패처 `design_connection`): `Vu`, `Tu`, `force_direction`, `t_head`, `t_far`, `member_case`, `Usl`, `x_bar`, `L_conn`, `b1`, `b2`,
`bf`, `bw`, `n_rows_long`, `pitch`, `edge_transverse`, `Agv_bs`, `Anv_bs`, `Ant_bs`, `Ant`, `Pnvs`, `Pnts`, `Fy1`, `Fy2`, `d_head_washer`,
`Pnov_bolt`, `slot_orientation`, `washers`, `shear_plane`, `consider_hole_deformation`, `joint`, `t_sheets`, `de`, `application`,
`eccentric_tension`, `sidelap`, `seam_orientation`, `HRC_p`, `alpha_w`, `alpha_b`, `d1`, `d2`, `R2`. 새 결과 키: `not_evaluated`,
`not_evaluated_relevant`, `checks`, `interaction_checks`, `detailing_checks`, `assumptions`, `shear_governing_mode`, `shear_design_strength`,
`tension_governing_mode`, `tension_design_strength`, `demands`, 한계상태의 `direction`·`assumed`·`basis`. `governing_mode`·`design_strength`·`Rn`
는 한계상태가 하나도 없으면 `None` 일 수 있다.

1. `src/mcp/server.ts:923-975` `aisi_design_connection`
   - 위 새 키를 스키마에 추가. `t1`/`t2` 설명을 「나사·PAF: t1 = 머리·와셔 접촉 부재, t2 = 먼 부재」로(R6-11). `Pu` 설명은
     「force_direction 방향 소요강도(기본 면내 전단)」.
   - `:970` `Fuf: Fuf || 120` 기본값을 없앨 것 — 엔진은 넘어온 Fuf 를 사용자 값으로 믿으므로 지금은 근거 없는 120 ksi 로
     PAF 가 PASS 할 수 있다. HRC_p 를 노출하고 Fuf 는 비워 두게.
   - `:939` groove_type enum 에 `flare_bevel`, `flare_v` 추가(R6-23), `load_direction`·`w1`·`w2`·`R`·`h`·`process`·`te` 노출.
   - `:963` `t2: t2 || t1` 은 엔진 기본과 같아 무해.
   - `src/mcp/siUnits.ts:131` SI 입력 맵에 길이(x_bar, L_conn, b1, b2, bf, bw, pitch, edge_transverse, de, d1, d2, R2, t_head, t_far),
     면적(Agv_bs, Anv_bs, Ant_bs, Ant), 힘(Pnvs, Pnts, Pnov_bolt, Pnot_test), 응력(Fy1, Fy2) 변환 추가; `:80` 출력 맵에
     shear_/tension_design_strength.
2. `src/mcp/server.ts:1238-1258` `design_connection` 도구: `Fy`·`Fu` 가 optional 인데 엔진은 이제 오류를 낸다(§3.1) — required 로.
   같은 새 키 추가.
3. `src/mcp/server.ts:1204-1218` `design_lap_connection`: `Se`, `Mnd`, `Vn`, `design_method`, `end_distance`, `Pnvs`, `Fub`, `bolt_grade`
   추가(R6-14 — 지금 MCP 로는 휨을 못 해 언제나 NOT_CHECKED). 결과의 `force_model`, `verdict` 설명.
4. `src/mcp/server.ts:1225-1236` `check_lap_length`: `ok` 가 `null` 일 수 있음을 설명.
5. `src/mcp/server.ts:1260-1276` `check_shear_lag`: `connection_case` 를 enum(MEMBER_CASES)으로, `connection_type`, `d`, `s`, `b1`, `b2`,
   `bf`, `bw`, `design_method` 노출, 설명에서 "generic" 삭제(이제 오류). `:1278-1296` `check_block_shear` 설명에 「나사·PAF 불가」.
6. `src/mcp/server.ts:1301-1318` `cold_work`: `A_total`, `buckling_precondition` 추가, 결과 `fya_usable`/`buckling_precondition` 설명.
   `:1320-1334` `flange_curling`: `d`, `wf_is_half_clear_distance`.
7. `src/webview/StcfsdPanel.ts:1329-1336` allowlist 에 새 인자(shear_lag: connection_type, b1, b2, bf, bw; cold_work: A_total,
   buckling_precondition; flange_curling: d, wf_is_half_clear_distance) — 없으면 화면 호출은 "Unsupported parameter" 오류.
8. `webview/js/app.js:924-953` 단일 접합 입력: member_case, e, s, width/Ag, g, Pnvs, dw, Tu(상향 인장) 입력칸; `:1111-` 결과 화면에
   `not_evaluated_relevant`, `checks`, 방향별 지배값 표시. `:899-918` Lap 은 이미 Se·Mnd·Vn 을 보내지만 `pass: null` 을
   NOT_CHECKED 로 보여 주는지 확인(R8).
9. `python/server.py:345-351` `check_lap_length` 기본값 0 → 이제 `ok=None`(조용한 통과 없음). 필요하면 필수 인자로.
10. `python/design/aisi_s100.py:1046-1084` (F4): `cold_work_strength(..., buckling_precondition=_cw_applicable_geom)` 로 넘기고
    `fya_usable` 로 판단하게. 그 뒤 F6 쪽에서 `applicable` 을 결합 의미로 바꿀 수 있다(아래 「못 한 것」).
11. F3: 마지막 전체 시험의 유일한 실패 `test_review_1122_cfsm.test_R3_01_sharp_lipped_z_real_modes_locks_rotT` (cFSM, F6 무관).
12. R7: Lap 대안 D(랩 끝 단면의 부재 분담 모멘트)를 쓰려면 해석이 랩 끝 모멘트를 내줘야 한다.

**V3 검증 뒤 덧붙인 것 (W2 · W3 가 따라올 것)** — 모두 덧붙이기다. 기존 키의 뜻은 그대로.

13. 새 입력 (디스패처 `design_connection`):
    - `member_case: 'not_tension_member'` — 호출자가 "이 판은 접합력을 인장재로 받지 않는다"고 밝힘 → J6.2 해당 없음.
    - `j6_3_not_applicable: true` — 블록전단 경로가 없다고 밝힘 → J6.3 해당 없음. 둘 다 `assumptions` 에 진술로 남는다.
      화면·MCP 는 이것을 "인장재 아님" · "블록전단 경로 없음" 체크박스로 노출하면 된다(랩 볼트, 클립, 패널 나사).
    - `j6_part2: {t, Fu, Fy, e, width|Ag, g, edge_transverse, member_case, j6_3_not_applicable, …}` — 두 번째 판 J6.
      결과 한계상태 이름 끝에 ` [part 2]` 가 붙는다.
    - `dw` 를 볼트에도: 볼트머리·와셔 접촉 직경 → App. A J3.4 풀오버를 A1.2(c) 대체식으로 평가(없으면 `Pnov_bolt`, 둘 다 없으면 미평가).
    - `j45_rational` (나사, 기본 true): J4.5.1/J4.5.2 적용한계 밖에서 Commentary C-J4.5.1-1 직선식 사용 여부.
    - `member_tension`, `joint_type` ('lap'|'t_joint') 를 필릿에, `member_tension` 을 그루브(플레어)에.
14. 새 결과 키: `governing_assumed`, `shear_verified_governing_mode`, `shear_verified_design_strength`,
    `tension_verified_governing_mode`, `tension_verified_design_strength`, `utilization_reference`.
    **판정(`checks`·`utilization`·`pass`)은 이제 verified 값으로만 낸다.** `design_strength`·`governing_mode` 는 가정값
    한계상태까지 포함한 참고 지배값으로 남는다 — 화면은 `governing_assumed=true` 이면 "참고값(입력 필요)" 으로 표시해야 한다.
    `interaction_checks[*]` 에 `basis: 'rational_A1.2c'`·`note` 가 있을 수 있다(J4.5 대체식).
15. Lap 결과: `lap_length_role`, `Pns_assumed` 추가. 랩 < 1.5d 는 이제 `pass` 에 넣지 않는다(`lap_ok=False` + 경고).
    `end_distance` 가 1.5d 보다 짧으면 그대로 써서 J3.2/J4.2 불합격 — 화면에 그 불합격 문장을 보여야 한다.
16. `src/mcp/server.ts:923-975`, `:1238-1258`: 위 13 의 키를 스키마에. `e` 설명은 "하중방향 끝단 거리(패스너 중심 → 재단 끝)".
17. `webview/js/app.js:923-955`: 단일 접합 입력에 "인장재 아님", "블록전단 경로 없음" 선택, e·s·(Tu)·Pnvs·dw. 아래 「판정 입력」 표가
    기준이 요구하는 최소 입력이다.

## 사용자 결정 필요

### R6-13 — Lap 패스너 힘 분배 모델

**지금 코드의 모델 (그대로 둠)** — `lap_connection.design_lap_connection` Step 2·4·7
1. 수요 `V_transfer = max(Mu/(d − t), Vu)`. Mu 는 지점 모멘트 전체, d − t 는 플랜지 우력의 팔.
2. 패스너 1개 강도 Pns = 공유 엔진의 전단 방향 한계상태 최솟값(지압·틸팅·패스너 전단·J6.1 끝단 파단, 이번에 e 반영).
3. `n = ceil(V_transfer / Pns)`, `n_per_row = ceil(n / n_rows)`, 용량 = n_total × Pns — 모든 행·모든 패스너가 V_transfer 를 균등 분담.
4. 배치: 한쪽 랩 길이 안에서 끝단 e(≥1.5d), 간격 3d.
기준(S100-16 Chapter J·I)에는 랩 패스너 힘 산정식이 없다. 근거는 §A1.2(c) 합리적 해석이며, 이번 수정으로 결과의
`force_model`(specification_provision=False)과 Step 2·4 이름, 경고에 그렇게 밝혔다. 판정은 이 모델로 계속 낸다.

**리뷰어 지적 (a)–(e)**
- (a) 우력은 위 행 +F, 아래 행 −F 로 걸려 각 행이 F = Mu/(d − t) 전체를 받는다 → 균등 분담은 패스너당 수요를 n_rows 배 과소평가할 수 있다.
- (b) 팔 길이는 실제 행 간격(보통 d − t 보다 작다)이어야 한다 → 더 큰 수요.
- (c) 연직 전단과 수평 우력 성분은 같은 패스너에 걸리므로 max 가 아니라 벡터합.
- (d) 반대로 지점 모멘트 전체를 넘기는 것은 과대 — 랩 끝에서 끝나는 부재가 넘기는 것은 그 단면에서 자기가 지던 몫(Manual II-1A 가정 a–c).
- (e) Commentary J3: 랩 구간 저항 일부는 겹친 부재의 끼움에서 온다. 업계 관행(II-1A, Bryant & Murray 시험)은 "full continuity 를 이루는 표준 상세"를 전제하며 패스너 수 식은 기준에 없다.

**선택지와 결과 (예: Mu = 120 kip-in, Vu = 4 kips, d = 8 in, t = 0.059 in, 1/2 in 볼트, Fu = 70 ksi, e = 2.0 in, LRFD;
Pns = 2.788 kips(지압), 2행 × 3개 = 6개 — 스크립트 `scratchpad\fix\F6\lap_alternatives.py`)**

| 선택지 | 패스너당 수요 | DCR (6개 배치) | 필요한 배치 | 결과 |
|---|---|---|---|---|
| A. 지금 모델 유지 (균등 분담) | 15.11/6 = 2.52 kips | 0.90 | 2 × 3 | 가장 적은 패스너. (a)–(c) 가 맞다면 비보수 최대 n_rows 배 |
| B. 우력: 각 행이 F = Mu/h 전체 (h = d − t) | 15.11/3 = 5.04 | 1.81 | 2 × 6 (12개) | 패스너 수 2배. 랩 12 in 에 e=2.0, s=1.5 로 행당 6개가 딱 들어감 |
| C. B + 연직 전단 벡터합 √((F/n_row)² + (V/n)²) | 5.08 | 1.82 | 2 × 6 | B 와 거의 같음 (V 가 작을 때) |
| D. 랩 끝 부재 분담 모멘트 (해석 필요, 예 M_end = 0.6Mu·0.4Mu, 분담 50 %) + 벡터합 | 1.65 / 1.21 | 0.59 / 0.43 | 2 × 3 이하 | 가장 합리적이나 R7 해석이 랩 끝 모멘트를 줘야 함. 가정이 늘어남 |
| E. A 유지하되 문헌(MBMA, AISI D111, Bryant & Murray)으로 확정할 때까지 판정을 NOT_CHECKED 로 | — | — | — | 정직하지만 Lap 기능이 판정을 내지 못함 |

권고(정하는 것은 사용자): 근거 문헌 확인 전에는 B(또는 C)가 안전한 상한이고, D 는 해석 연동이 생긴 뒤의 개선안이다.
어느 것을 택해도 행 간격 `h_rows` 입력이 필요하다(지금은 d − t 고정).

## 못 한 것

- R5-22 의 `applicable` 키: §4.3 은 단독 호출의 `applicable` 이 좌굴 전제까지 반영하길 원하지만, `aisi_s100.py:1072` 가 이 키를
  "식 적용조건"으로 읽고 좌굴 전제는 자기가 먼저 확인한다. 뜻을 바꾸면 휨 설계의 냉간가공이 꺼지고 기존 시험
  `test_cold_work_uses_estimated_corner_ratio` 가 깨진다. 그래서 `applicable` 은 식 조건만으로 두고(docstring 명시),
  결합 판정은 새 키 `fya_usable`(전제 미확인이면 None)과 `buckling_precondition='not_checked'`·경고로 냈다. 후속 10 이후 바꾼다.
- LSD: Chapter J 모든 식의 LSD φ 를 넣지 않고 거부로 처리했다(aisi_s100 과 같은 방침).
- 볼트머리 풀오버(App. A J3.4): 기준식이 없어 사용자 값(`Pnov_bolt`)만 받는다. Commentary Table C-J5.2.2-1(PAF 인장 풀아웃)도 표로
  넣지 않고 `Pnot_test` 로 받는다.
- 미구현 조항은 결과에서 평가하지 않음으로만 드러난다: J1 편심(assumptions 에 명시), J2.4 상부 시임 사이드랩, J2.7 저항 용접,
  J6.1-3 코핑 보, J7. J4.5.1/J4.5.2 의 "self-drilling 나사" 조건과 J5 시공 조건(점 관입, 0.6t2)은 입력으로 확인할 수 없어 가정으로 둔다.
- 다른 담당의 파일(`server.py`, `src/`, `webview/`, `aisi_s100.py`)은 읽기만 했다 — 따라올 것은 「후속」.

## V3 검증 뒤 고친 것

V3(`verify/V3-connections-loads.md`)의 접합부 결함 V3-01 – V3-11 과 시험 정직성 지적. 매뉴얼 재현(IV-1, 2, 3, 4, 9, 10, 11, 12)은
수정 전후 값이 같다(`scratchpad\fix\F6\manual_check_v3.txt`). 되돌리기 시험 13개 모두 해당 시험이 잡는다
(`scratchpad\fix\F6\mutate.py`, `mutate_out.txt`).

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| V3-01 (P1) | 고침 | `connections.py` `arc_spot_weld_connection`, `arc_seam_weld_connection`: J6.1–J6.3 에 시트 한 장 두께 `t_j6 = min(t_sheets)`(구멍 폭 da = d − t_j6). 합은 J2.2.2.1·J2.3.2.1(전단면 위 시트 합)과 J2.2.3(원문 "sum of the sheet thicknesses")에만. 근거: J6.1 의 t = "base steel thickness of section"(판 하나), 끝단 겹침에서는 위 시트 한 장이 힘을 옮긴다 | 0.03+0.03 in 시트, d=0.75, e=1.5: J6.1 Rn 3.645 → 1.8225 (손계산 0.6·45·2·0.03·1.125) | `test_V3_01_multi_sheet_arc_spot_j6_uses_one_sheet` |
| V3-02 | 고침 | `_finish`: `*_verified_*` 지배값(assumed 제외), `governing_assumed`. `design_connection`: `checks` 는 verified 값으로만 → 가정값(e=1.5d 의 J6.1·J6.3, 나사 Pnvs 추정, 2d d'w, PAF F_uh 120, PAF Fy2=Fy, PJP te=0.5t)으로는 PASS 도 FAIL 도 나지 않음. `utilization_reference` 에 참고 비율. PAF J5.4 도 가정값이 있으면 미평가. Lap: Pns 가 가정값이면 수·용량·배치는 FAIL 을 내지 않음 | e 없는 1/2 in 볼트 Pu=1.2(LRFD): FAIL → NOT_CHECKED; Pnvs 없는 #10 나사 Pu=0.73: FAIL → NOT_CHECKED | `test_V3_02_assumed_values_never_decide` |
| V3-03 | 고침 (방법 선택은 사용자 결정 가능) | `screw_connection`: J4.5.1/J4.5.2 적용한계 밖이면 어떤 한계를 넘었는지 적고, Commentary C-J4.5.1-1 직선식 V/Pnv + T/Pnt ≤ 1 을 J4 계수의 가용강도로 A1.2(c) 합리적 해석으로 적용(`_j45_fallback`, `basis='rational_A1.2c'`). Pnv 는 J4.3.1 과 해당 식 중 작은 값. `j45_rational=False` 면 "시험(K2) 또는 A1.2 합리적 해석 필요" 로 미평가. 원문 확인: 기준은 한계 밖에 식을 주지 않고, Commentary 는 직선식을 "more conservative linear design equation that has been used by engineers" 라고 적는다 | 24 ga 패널 조합: NOT_CHECKED(영구) → 평가(직선식, 한계 1/Ω = 0.333 vs 기준식 1.10/2.35 = 0.468) | `test_V3_03_*` 2개 |
| V3-04 | 고침 | `_j6_rupture_limit_states`, `_weld_j6`: `member_case='not_tension_member'` → J6.2 해당 없음, `j6_3_not_applicable=True` → J6.3 해당 없음. 호출자 진술로 `assumptions` 에 남김(J6 머리글 "as applicable", Table J6.2-1 은 인장재 접합 표) | 랩 볼트·패널 나사: member_case·폭을 지어내야 함 → 진술로 판정 완결 | `test_V3_04_not_tension_member_completes_verdict` |
| V3-05 | 고침 | `groove_weld_connection`: 플레어 V 홈의 횡방향 하중은 한계상태를 만들지 않고 미평가(J2.6(a) Eq. J2.6-1 은 "flare bevel groove welds" 만) | 3.898 PASS → NOT_CHECKED | `test_V3_05_flare_v_transverse_not_evaluated` |
| V3-06 | 고침 | 모든 패스너·아크 용접: `j6_part2` 로 두 번째 판 J6(이름 ` [part 2]`). 없으면 `assumptions` 에 "판 1 하나만 검토 — 다른 판의 끝단·폭이 더 작으면 j6_part2" 를 밝힘. 볼트 지압은 Fu 가 같으면 C·t 가 t 에 증가해 얇은 판이 지배함을 명시 | 두꺼운 판 e=0.75: 검토 없음(PASS) → J6.1 [part 2] 2.53 kips 지배 | `test_V3_06_second_part_j6` |
| V3-07 | 고침 | `fillet_weld_connection`, `groove_weld_connection`(플레어): `member_tension` 인자 연결, `_weld_chapter_d`(구멍 없음, An=Ag). 평판 안내 문구를 `assumptions` 로 | IV-1 D2 4.49/6.75, D3 4.88/7.31 (매뉴얼 그대로) | `test_V3_07_fillet_member_tension_iv1` |
| V3-08 | 고침 | `design_lap_connection`: `end_distance` 를 올리지 않고 그대로 엔진에 넘김 → J3.2/J4.2 상세 불합격이 `fastener_ok=False`. 미입력이면 1.5d 로 "배치 제안"임을 경고 | 1/2 in 볼트 e=0.5: PASS(0.75 로 올림) → FAIL | `test_V3_08_lap_short_end_distance_fails` |
| V3-09 | 고침 (사용자 결정 반영 가능) | Lap: 랩 < 1.5d 는 `pass` 에 넣지 않고 "R 계수법·J3 슬롯 예외 불가" 경고 + `lap_ok=False`, `lap_length_role` 키. 길이 미입력(0)은 배치를 못 하므로 None | 랩 10 in(d=8): FAIL → PASS(강도 기준) + 경고 | `test_V3_09_lap_length_is_condition_not_strength` |
| V3-10 | 고침 | `fillet_weld_connection`: 겹침이음(`joint_type='lap'`, 기본)에서 Eq. J2.5-7 목두께에 w1 ≤ t1 (Fig. J2.5-1). `t_joint` 는 상한 없음 | t1=0.12, w=0.25: tw 0.177 → 0.085 (Weld Metal Rn 15.9 → 7.64) | `test_V3_10_fillet_throat_uses_w1_le_t1` |
| V3-11 | 결정으로 기록 | J5.3.2 ds 상한 0.177 + 0.003 in — Manual IV-12 가 ds=0.180 을 "≅ 0.177 OK" 로 본 판단을 따랐다(경고를 남김). 바꾸면 IV-12 의 지배 모드가 사라진다 | 변화 없음 | `test_R6_06_iv12_*` |
| 시험 R6-09 | 고침 | `test_R6_09_bolt_interaction_fails_verdict`: V3 의 입력(t 0.105, Fu 65, A307, e 2.0, Vu 3.8, Tu 3.0, LRFD) — 전단·인장 단독은 합격, Eq. J3.4-3 만 비 1.31 로 불합격. 다른 미평가 항목이 없도록 하여 상호작용을 판정에서 빼면 PASS 가 되어 시험이 실패한다 | — | 되돌리기 시험으로 확인 |
| 시험 R6-02 | 고침 | `test_R6_02_*`: L = 1.8 in 를 추가(L/t_min = 30 ≥ 25 이나 L/t1 = 17 < 25) — t1 분기로 되돌리면 φ 0.60 이 되어 실패 | — | 되돌리기 시험으로 확인 |
| 시험 공백 | 고침 | J2.2.3 편심 50 %·사이드랩 70 %·데크 Ω 2.50/φ 0.60, J2.2.4 한계(d, Fu/Fy), J4.5.2 Fu/Fy 한계, `t_sheets`, 플레어 V Eq. J2.6-7 | — | `test_V3_arc_spot_tension_modifiers`, `test_V3_arc_spot_j224_limits`, `test_V3_03_j45_2_fu_fy_limit`, `test_V3_01_*`, `test_V3_flare_v_throat_eq_j267` |

### 판정 입력 — 입력 → 기준이 요구하는 까닭 → 없으면

"완결 판정"(PASS/FAIL)을 내려면 아래 입력이 있어야 한다. 가정값은 결과에 보이되(`assumed`) 판정에는 쓰지 않는다.
기준이 보수적인 대안을 주는 입력은 그 대안을 쓰고 결과에 밝힌다(✓ 표시).

| 패스너 | 입력 | 기준이 요구하는 까닭 | 없으면 |
|---|---|---|---|
| 공통 | t1, t2, Fy, Fu, design_method | 모든 식의 기본 변수 | 오류 |
| 공통 | Pu(+force_direction) 또는 Vu / Tu | 판정 대상 소요강도 | 강도만 내고 판정 없음 |
| 공통 (J6 대상) | member_case(또는 `not_tension_member`) + 인장재면 Ag 또는 width | J6.2 는 인장재 접합의 순단면 파단, Usl 은 Table J6.2-1 분류마다 다르다(앵글·채널이면 평판식이 비보수) | J6.2 미평가 → NOT_CHECKED. 인장재가 아니면 `not_tension_member` 진술로 완결 |
| 볼트·용접 | g(단면당 2개 이상) 또는 edge_transverse(1개) 또는 블록 면적, 또는 `j6_3_not_applicable` | J6.3 은 볼트·용접 접합에 적용, 경로는 기하로 정해진다 | J6.3 미평가 |
| 볼트 | e | J3.2 최소 1.5d, J6.1 은 e 에 비례 | J6.1·J6.3 을 e=1.5d 로 참고 계산(assumed), 판정 없음 |
| 볼트 | s (n > 1) | J3.1 최소 3d | J3.1 미확인 → 판정 없음 (1열이면 g 로 대신) |
| 볼트 | bolt_grade 또는 Fub | Table J3.4-1 | ✓ 승인 볼트 최저 A307 값 사용(경고) |
| 볼트 | mf (washers, shear_plane) | Table J3.3.1-2 | ✓ 해당 구멍 종류의 최소값(표준 0.75, 과대 0.70, 단슬롯 0.55) |
| 볼트 (Tu > 0) | dw(머리·와셔 접촉 직경) 또는 Pnov_bolt | App. A J3.4: 볼트 인장 시 판 풀오버 검토 필수, 식은 없음 | dw 가 있으면 Eq. J4.4.2-1 꼴 A1.2(c) 대체식(밝힘). 둘 다 없으면 인장 판정 없음 |
| 나사 | Pnvs (전단), Pnts (Tu > 0) | J4.3.2·J4.4.3: 제조사 또는 독립 시험값 — 기준이 식을 주지 않는다 | 0.5·Fub·As 추정은 참고값(assumed), 판정 없음. 설계자는 지정한 나사 제품의 값으로 알 수 있다 |
| 나사 | e, s (n > 1) | J4.2 1.5d, J4.1 3d, J6.1 | 볼트와 같음 |
| 나사 (Tu > 0) | dw (d'w) | J4.4.2 (a)(b)(c), J4.4 머리 ≥ 5/16 in | 2d 추정은 참고값, 인장·조합 판정 없음 |
| 나사 | tc | J4.4.1 관입깊이와 t2 중 작은 값 | ✓ 나사가 t2 를 관통한다고 보고 tc = t2 (assumptions) |
| 나사 (V·T 동시) | J4.5.1/J4.5.2 적용한계 | 기준 식은 시험 범위 안에서만 | ✓ 범위 밖이면 Commentary C-J4.5.1-1 직선식(A1.2(c), 더 보수) — `j45_rational=False` 로 끌 수 있음 |
| PAF | Fuf(F_uh) 또는 HRC_p | J5.2.1·J5.3.1 은 F_uh 로 계산(경도식 또는 HRC ≥ 52 면 260 ksi), 제조사 값 허용 | 120 ksi 는 참고값(assumed), 판정 없음 |
| PAF | Fy2 | J5.3.3 은 먼 부재(지지재) 항복강도 | 머리쪽 Fy 로 참고 계산, 판정 없음 |
| PAF | e, s | Table J5.1-1, J6.1 | e 는 최소값으로 참고 계산, 판정 없음 |
| PAF (Tu > 0) | dw, Pnot_test | J5.2.3 d'w ≤ 0.60; J5.2.2 는 시험값만(또는 Commentary Table C-J5.2.2-1) | 인장 판정 없음 |
| 아크 스팟 | de ≥ 3/8 in (Eq. J2.2.2.1-5 값이 작으면 절차 확보값) | J2.2: 최소 유효직경 3/8 in 을 지정해야 함 | 판정 없음 (Manual IV-2 의 "N.G." 와 같은 처리) |
| 아크 스팟·시임 | e | J2.2.1 / J2.3.1 연단, J6.1 | J6.1·J6.3 미평가 |
| 아크 스팟·시임 | joint (t1 = t2 일 때) | J2.2.2.1 과 J2.2.2.2(시트-시트) 식이 다르다 | ✓ 두 식을 모두 평가해 작은 값 (시트-시트 식 범위 밖이면 판정 없음) |
| 플레어 | process | Table J2.6-1/-2 | ✓ 가장 작은 목두께가 나오는 공정 값 |
| 플레어 (t > 0.10) | w1, w2, R (베벨) / R, d1, d2 (V) | Eq. J2.6-4 상한에 tw 필요 | 상한 미평가 → 판정 없음 |
| 그루브 PJP | te | J2.1 유효 목두께 | 0.5t 는 참고값, 판정 없음 |

이 표의 입력을 모두 넣은 보통의 접합(볼트·나사·PAF·용접)은 PASS 또는 FAIL 을 받는다 — 매뉴얼 IV-1, 2, 3, 9, 11, 12 의 전체
입력은 그렇게 된다(시험). 인장재가 아닌 랩·클립·패널 접합은 `not_tension_member` 와 `j6_3_not_applicable` 진술로 완결된다.

### 사용자 결정 (V3 로 생긴 것)

- **V3-03 J4.5 한계 밖 조합**: 기본은 Commentary C-J4.5.1-1 직선식을 A1.2(c) 로 쓰는 것(평가됨, 결과에 밝힘). 이 대체를 원하지 않으면
  `j45_rational=False` 로 미평가(시험 필요)로 돌릴 수 있다 — 기본값을 무엇으로 할지는 사용자가 정한다.
- **V3-09 랩 길이 < 1.5d**: 강도 판정에서 뺐다(경고 + `lap_ok=False`). 사내 정책으로 FAIL 로 두고 싶으면 알려 달라.
- **V3-11 J5.3.2 ds 허용폭 0.003 in**: Manual IV-12 판단을 따랐다. 엄격 적용을 원하면 허용폭을 0 으로.

## V4 검증 뒤 고친 것

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| V4-08 | 고침 | `lap_connection.py` `design_lap_connection` Step 8: `Se = params.get('Se') or params.get('Sf')` 대체를 없앴다. 판정 근거는 Se 뿐이다(이 함수가 받는 다른 휨 강도 입력은 없다 — `Mnd` 는 뒤틀림, `Vn` 은 H2 전단). Sf 만 있으면 2·Sf·Fy 참고값을 Step '8r'(`assumed: True`, `pass: None`)과 `flexure_reference_dcr` 로만 보이고 휨은 미평가 → 판정 None. 새 결과 키 `flexure_basis`('Se'|'Sf_reference'|None), `flexure_assumed`, `flexure_reference_dcr` | Sf=3.0 만: PASS(총단면으로 휨 OK) → NOT_CHECKED; Se=3.0: 변화 없음 (DCR 0.404 = 120/(0.9·2·3.0·55)) | `test_V4_08_lap_gross_sf_is_not_a_flexure_basis` (되돌리기 시험으로 검출 확인) |

매뉴얼·워크 예제 기반 Lap 수치(Pns 1.510 / 2.788 / 0.471 kips, 필요 개수, DCR)는 변화 없음(`scratchpad\fix\F6\lap_alternatives.py`).
후속(W2·W3): MCP `design_lap_connection` 에 `Se` 를 추가할 때 `Sf` 를 Se 대신 보내지 말 것. 결과에 `flexure_assumed=true` 면
"휨 미검토 — Se 필요" 로 보이고 `flexure_reference_dcr` 는 참고값으로만 표시.

V4-08 뒤 게이트: 접합부 시험 53개 통과. 전체 시험 두 번 — 1차 `Ran 379 tests` / `FAILED (failures=5)`(loads `test_R7_29`, server 4건; 그중
`test_F4_F5_F6_new_inputs_and_result_keys_pass_through` 는 `aisi_design` 휨 경로 차이로 단독 실행하면 통과 — 동시 편집),
2차 `Ran 382 tests in 96.445s` / `FAILED (failures=1)` — `test_review_1122_server.test_R8_25_rounded_corner_classification_is_null_with_status`
(cFSM 분류, F6 무관). `ruff check python test` → `All checks passed!`.

### V4-29 — 진입 정규화의 숨은 기본값

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| V4-29 | 고침 | `connections.py` `design_connection`: `t2 = t1`, `n = 1` 가정을 없앴다 — 빠지면 그 이름을 말하는 오류. 진입 정규화를 다시 훑어 공학 입력을 대신하던 기본값을 정리: `connection_type`(과거 'bolt'), 그루브 `groove_type`(과거 'complete' = CJP 가정, PJP 면 비보수), 버트(J2.1) 이음 `load_direction`(과거 'tension', 전단이 더 약해 비보수)은 이제 오류. n 은 1 이상의 정수만. 그루브는 n 을 쓰지 않아 요구하지 않는다. 아크 스팟·시임의 `t_sheets` 관례(지지재 위 시트들; 시트-시트가 아니면 지지재 두께 t2 는 강도식에 쓰이지 않음)는 유지하고 assumptions 에 적는다. 남는 기본값은 보수 쪽 또는 기준의 기본이며 이제 모두 `assumptions` 에 남는다: Fxx = 60(최저 전극), 필릿·플레어 종방향(횡방향보다 작음), 볼트 표준공(Table J3-1), 아크 스팟 상향 인장의 편심·사이드랩 없음(Tu>0 일 때), 시임 하중직각(Manual IV-3), PAF αw = 1.5. 나사 `Fub` 의 디스패처 기본 100 은 없앴다(추정 Pnvs 에만 쓰이던 값, 함수 안에서 참고값으로 표시) | t2·n 빈칸: "NG 326 %"(t2=t1, n=1 가정) → 오류 "t2 … 미입력" / "n(패스너 수) 미입력". 완전한 입력은 그대로(IV-9 J6.1 3.67, J6.2 5.68, J6.3 4.91) | `test_V4_29_missing_t2_and_n_are_refused`, `test_V4_29_multi_sheet_arc_spot_keeps_t_sheets_convention`, `test_V4_29_groove_type_and_direction_required` |

매뉴얼 재현은 V3 뒤 값과 한 줄도 다르지 않다(`scratchpad\fix\F6\manual_check_v3.txt` ↔ `manual_check_v4.txt`, 값 줄 132개 동일).
접합부 시험 56개 통과. 내 시험 가운데 n·t2·load_direction 없이 부르던 4곳(R6-18, R6-20, R6-23, V3-06)에 그 입력을 넣었고,
R6-08 은 A325 오류에 닿도록 t2·n 을 넣었다.

후속(W2·W3): MCP·화면은 `connection_type`, `t2`, `n`(그루브 제외), 그루브의 `groove_type` 과 버트 이음 `load_direction` 을
빈칸이면 보내지 말고 엔진 오류를 그대로 보여 줄 것(엔진이 기본값을 다시 채우지 않는다). 아크 스팟·시임에서 `t_sheets` 를 쓰면 t2 는 비워도 된다.

게이트: `C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe test\python\run_all.py` → `Ran 386 tests in 77.155s` / `OK`.
`C:\Coding_Works\cufsmAi\.venv\Scripts\ruff.exe check python test` → `All checks passed!`
