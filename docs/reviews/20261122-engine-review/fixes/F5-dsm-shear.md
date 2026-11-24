# F5 — DSM 추출(dsm.py) · 전단/웹 크리플링(shear.py) · 강종표(steel_grades.py) 수정 기록

## 요약

고침 16 · 보류 0 · 기각 0 · 사용자 결정 필요 2 (R5-30 의 남은 선택, R5-31).
대상: R5-01 – R5-07, R5-10 – R5-16, R5-30, R5-31 (18건; R5-30 은 고침 + 사용자 결정 항목 하나).

전체 시험(`C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe test\python\run_all.py`):
마지막 실행 `Ran 174 tests` → `FAILED (failures=8, errors=3)`. 남은 11건은 전부 다른 담당의 진행 중
영역이다: F6(`test_arc_seam_formula_terms`, `test_bolt_shear_tension_interaction_j34`,
`test_connection_bolt`, `test_paf_limit_state_mapping`, `test_shear_lag_design_strength_split`,
`test_connection_not_checked_verdict`, `test_fe_lap_golden`, `test_j6_bolt_full`,
`test_j6_screw_paf_rupture_no_block`), F7(`test_i621_uplift_r`, `test_analyze_loads_integration`).
앞선 실행에서 보인 H3·G5 설계 경로 실패(F4 의 §F2 ry/ro 필수화로 설계가 웹 크리플링 전에 멈춤 —
같은 입력을 직접 돌려 확인)는 F4 가 고친 뒤 사라졌다. 자기 시험
`test/python/test_review_1122_dsm_shear.py` 27 개 통과(약 1.5 s). `ruff check python test`: All checks passed!

## 발견사항별

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| R5-01 | 고침 | `engine/dsm.py:extract_dsm_values`, `_assign_two_or_more`. 극소 하나의 라벨로 다른 모드의 부재를 정하지 않는다. 단일 극소는 언제나 Pcrl(하한), D 라벨이면 Pcrd 도 같은 값. `classification_method` 는 국부·뒤틀림이 **서로 다른 두 극소에서 둘 다 라벨로** 정해졌을 때만 `'cfsm_modal'`. 새 키 `local_absence_verified`·`dist_absence_verified`(항상 False), `local_isolated`·`dist_isolated`, `local_basis`·`dist_basis`. NaN/None 분류 행은 미분류 → 반파장 순서. | 9CS2.5x059(r 0.1875) 압축, 옛 D 라벨 경로: Pcrl 0 → 0.125·Py, method `cfsm_modal` → `cfsm_partial`; 설계 Pn(KL=144) 8.58 → 6.48 kips, KL=96 12.91 → 10.98 (리뷰어 보수 기준 6.49 / 10.99) | `test_R5_01_single_D_labelled_minimum_does_not_verify_local_absence`, `test_R5_01_rounded_9cs_compression_keeps_local_reduction` |
| R5-02 | 고침 | `_assign_two_or_more`: G/O 우세·미분류 극소를 버리지 않고, D 라벨이 하나도 없으면 국부보다 긴 극소 중 최저를 뒤틀림으로. | 합성 (h): LFd 0, dist_detected False → 0.60, True | `test_R5_02_g_dominant_distortional_minimum_is_not_discarded` |
| R5-03 | 고침 | `_check_reference_stress`: 최대 \|σ\| 와 fy 의 비 `stress_scale` 로 LF 를 환산, 절점 응력 형상을 load_type 의 순수 분포(구속/비구속 휨)와 비교해 맞는 분포의 첫 항복값을 `P_ref` 로. 어긋나면 `reference_stress_consistent=False` + 경고. 새 인자 `unsymm=None`. | 노드 응력 1 ksi·fy 50: Pcrl 1439 → 28.8 kips(×50 오류 제거). Z 비구속(unsymm=1) 응력: Mcr = LF·M_applied 유지, P_ref 106.75 → 53.67 kip-in(같은 분포의 첫 항복). F4 의 새 `_bending_reference_nodes`(unsymm=0)와 함께면 Z 자동경로 My=103.6 ≈ Sf·Fy 로 변화 없음. | `test_R5_03_*` 4개 |
| R5-04 | 고침 | 단일 극소 플래그 `single_minimum`, `LF_single_minimum`, `single_minimum_bound`(하중 단위), 경고 문장. | 값 변화 없음(플래그 추가) | `test_R5_04_single_minimum_flag_and_bound` |
| R5-05 | 고침 | 경계 극소 `boundary_minimum` + 경고, `local_isolated=False`. log L 3점 포물선 보간 `LF_local_interp`/`LF_dist_interp`(꼭짓점 값 ≤ 표본값을 식과 시험으로 보임, `min(·, 표본)` 로 한 번 더 묶음). 보간값은 **보고만** 하고 Pcr 은 표본값 유지(CUFSM·매뉴얼 관행), 1 % 넘게 차이 나면 격자 경고. 평탄 구간 극소도 찾는다. | 값 변화 없음 | `test_R5_05_boundary_minimum_is_flagged`, `test_R5_05_interpolated_minimum_never_exceeds_sampled` |
| R5-06 | 고침 | 극소 0개: 두 경로 모두 `classification='no_minimum'`, Pcrl=Pcrd=0, 검출 False + 경고(장파장 꼬리를 국부로 쓰지 않음). | 단조감소 곡선 Pcrl 0.010·Py(전체좌굴 꼬리) → 0(미분리) | `test_R5_06_no_minimum_same_result_on_both_paths` |
| R5-07 | 고침 | 3점 미만도 같은 키 집합(`classification='insufficient_points'`), `load_type ∉ {P,Mxx,Mzz}` → ValueError, 새 인자 `BC=None`: S-S 가 아니면 극소를 뽑지 않음(`signature_curve=False`, `not_signature_curve`). | C-C 곡선 LFl 0.970 → 0(미분리 + 경고) | `test_R5_07_empty_result_keys_load_type_and_bc` |
| (곡선 모양 표) | — | 아래 「곡선 모양별 동작」 | — | `test_R5_curve_shape_behaviour_table`, `test_R5_manual_dsm_ratios_through_real_fsm` |
| R5-10 | 고침 | `shear.py:_G5_TABLES` built-up I fastened ETF/ITF 두 행 삭제 → "Not covered by Table G5-1" 오류(`Pn=None`, `not_covered=True`). | Pn 6.197 / 5.91 kips → 오류 | `test_R5_10_builtup_fastened_two_flange_is_not_covered`, `test_R5_G5_every_specification_row_and_only_those` |
| R5-11 | 고침 | `_resolve_section_family`: 대문자화·공백/`-`/`_` 제거 뒤 이름표(템플릿 `lippedz`·`isect`, GUI `Z`·`Hat`·`Track`·`Tee`·`Angle`, MCP `C/Z/HAT/I`, `aisi_s100._CANONICAL_SECTION_NAMES` 와 같은 표기)로 판정. 모르는 이름은 C 로 보내지 않고 오류. family='C' 인데 section_type 이 Z/I/hat 이면 section_type 쪽 표 + 경고(옛 `aisi_s100._infer_web_crippling_family` 의 'lippedz'→'C' 도 이쪽에서 닫힘). RHS/CHS/angle/tee 는 family 를 주어도 오류. track/unlipped C 는 flange_condition 미지정 시 unstiffened 행. | 'lippedz' 무체결 EOF: Pn 1.541 → 0.866 kips(φPn −40 %), 'angle' 등: C 표 값 → 오류, track: stiffened 행 → unstiffened 행(체결이면 표에 없음 → 오류) | `test_R5_11_z_section_names_route_to_table_g5_3` |
| R5-12 | 고침 | 원문대로: G5-1 U-IOF R/t≤3, G5-1 N/h≤1.0, G5-4 F-ITF R/t≤10, G5-5 F-IOF≤20·F-ITF≤10·U-IOF≤20·U-ITF≤5, G5-2 F-ITF `d ≥ 4.5 in`(새 인자 `d`, 없으면 h+2(R+t) 로 추정하고 assumptions 에 기록). | 경고 없던 범위 밖 사용 → 범위 밖 오류(R5-15) | `test_R5_12_corrected_applicability_limits`, `test_R5_G5_table_limits_h_t_N_t_N_h` |
| R5-13 | 고침 | C/Z fastened-unstiffened 8행 삭제 → "Not covered by Table G5-2/3" 오류. `n_webs` 명시값은 그대로(1 이상), 기본만 hat 2 · multi_web 2 · built-up I 2 · C/Z 1. | C fastened-unstiffened EOF 1.576 kips → 오류; multi-web n_webs=1: ×2 → ×1 | `test_R5_13_no_silent_row_substitution_and_explicit_n_webs` |
| R5-14 | 고침 | Commentary G5 "In Specification Table G5-1, the heading was changed in 2012 to indicate that the resulting nominal web crippling strength is per web" + 표 제목 "…Built-Up Sections per Web" → `per_web=True`, 기본 n_webs=2. | built-up I Pn ×2 (예: 7×0.08 unfastened ETF Pn_per_web 그대로, Pn 2배) | `test_R5_14_builtup_i_strength_is_per_web` (기존 `test_web_crippling_built_up_i_table_g51` 바로잡음) |
| R5-15 | 고침 | 표 한계(h/t, N/t, N/h, θ, R/t, d, N ≥ 0.75 in, ITF 끝거리 입력값) 위반 → `within_limits=False`, `limit_violations`, `error` 키(계산값은 참고로 남김). 지금의 `aisi_s100` 은 `error` 를 보면 `pass=None`. | h/t 233 등: 경고+Pn → 오류(판정 None) | `test_R5_15_outside_limits_cannot_pass` |
| R5-16 | 고침 | `shear_strength`: 새 인자 `web_holes`(→ §G3 미구현 오류), `transverse_stiffeners`/kv≠5.34(→ §G2.2 미구현 경고), `assumptions` 에 범위(G2.2/G3/G4 미평가). `web_crippling`: 새 인자 `web_holes`(→ §G6 미구현 오류), assumptions 에 §G6 미평가. | 값 변화 없음 | `test_R5_16_example_II_1A_shear_strength`(Vn 3.44 / 5.76), `test_R5_16_unimplemented_chapter_g_provisions_are_visible` |
| R5-30 | 고침 + 사용자 결정 | `steel_grades.py`: §A3.1.3 강종(A653-80, A792-80, SGC570, A1003-80)을 기본 표에서 빼 `LOW_DUCTILITY_GRADES` 로. 그 'Fy'/'Fu' 는 감소값 min(0.75Fsy, 60)·min(0.75Fu, 62), `use_restriction`(다중 웨브 전용). `get_grade(..., include_restricted=False)`, `list_grades(include_restricted=False)`. 도우미 `a313_design_values`, `a313_flexure_Rb`(Eq. A3.1.3-1/-2). 기본 표에 `elongation_group`. | `steel_grades` 목록: A653-80 Fy 80 → 목록에서 빠짐(요청 시 60 ksi) | `test_R5_30_low_ductility_grades_are_not_offered_at_80_ksi` |
| R5-31 | 사용자 결정 필요 | 값은 그대로. `note` 키로 현행 KS 명칭 사실을 남김. | 변화 없음 | `test_R5_31_ks_grade_values_unchanged_and_annotated` |

### 곡선 모양별 동작 (`extract_dsm_values`) — V2 검증 뒤 갱신본

(1차 표의 "극소 1개, 라벨 D → Pcrl=Pcrd=극소값" 과 "극소 2개 이상 → 가장 짧은 극소=국부" 는 V2-04 · V2-08 로
바뀌었다. 아래가 지금 동작이다.)

| 곡선 | classification / method | Pcrl | Pcrd | 플래그 | 안전성 |
|---|---|---|---|---|---|
| 극소 없음(단조) | `no_minimum` / heuristic | 0 | 0 | 둘 다 detected False, 경고 | 하류 해석식 대체 또는 미평가 |
| 극소 1개, 라벨 없음·NaN·L | `single_minimum` / heuristic·cfsm_partial | 극소값 | 0 | `single_minimum`, `crd_floor`(=극소값, **하한**), assumptions | Pcrd 는 하류가 해석식으로 — 극소값은 floor 로만 |
| 극소 1개, 라벨 D | `single_minimum` / cfsm_partial | 0 | 극소값 | `crl_floor`(=극소값, 하한) | Pcrl 은 하류 해석식 + floor |
| 가까운 두 극소(표본상 합쳐짐) | 극소 1개와 같음 | | | | 같음 |
| 극소 2개, 라벨 없음 | `two_minima` / heuristic | 짧은 쪽 | 긴 쪽 | | 지금과 같음 |
| 극소 3개 이상, 라벨 없음 | `two_minima` / heuristic | 가장 긴 극소를 뺀 최저 | 가장 짧은 극소를 뺀 최저 | `wavelength_bound`(isolated False), 경고 | 둘 다 하한(보수, 때로 과보수) |
| D 라벨 1개(가장 짧지 않음) | `cfsm_modal`(국부가 L 라벨일 때) / `cfsm_partial` | D 보다 짧은 극소(L·미분류) 중 최저 | D | 미분류가 L 보다 낮으면 그것 + 경고 | 세 번째 G 극소 무시 |
| L 라벨 있음, 쓸 D 라벨 없음 | `cfsm_partial` 또는 `cfsm_ordering_tiebreak` | L 라벨과 가장 긴 L 보다 짧은 미분류 중 최저 | 국부보다 긴 극소 중 최저(없으면 0 + `crd_floor`) | L 이 둘 이상이거나 미분류를 쓰면 `wavelength_bound` + 경고 | 국부 하한 |
| 라벨이 순서와 어긋남(D 가 L 보다 짧음) | `cfsm_ordering_tiebreak` / heuristic | 라벨 없음 규칙 | 라벨 없음 규칙 | assumptions | — |
| 분류 행 전부 NaN(F3 의 둥근 모서리) | `cfsm_ordering_tiebreak` / heuristic | 라벨 없음 규칙 | 라벨 없음 규칙 | `classification_note` 만(알림 없음) | — |
| D 극소가 G/O 우세 | `cfsm_partial` | L 라벨 | 국부보다 긴 최저 | | 버리지 않음 |
| 첫 길이 최소(격자 하한 아래) | (해당 분류) | 첫 점 값 | | `boundary_minimum`, `local_isolated=False`, 경고 | 과대 가능 — 명시 플래그 |
| 마지막 길이 최소 | 극소로 넣지 않음 | | | Pcre 점근값만 | 문제 없음 |
| BC ≠ S-S | `not_signature_curve` | 0 | 0 | `signature_curve=False`, 경고 | 하류 대체/미평가 |
| 절점 응력 ≠ fy | (그대로) | LF·(σmax/fy)·P_ref | 같음 | `stress_scale`, 경고 | 환산으로 일관 |
| 3점 미만 | `insufficient_points` / none | 0 | 0 | 같은 키 집합 | — |

`local_absence_verified` · `dist_absence_verified` 는 모든 경우 False 다.

## 후속 — 다른 곳이 따라와야 하는 것

- **F4 `aisi_s100.py`**
  - `_auto_generate_props`(지금 `:2868` 부근)가 `params['dsm']` 에 고른 키만 옮긴다. 새 키 `local_absence_verified`, `dist_absence_verified`, `single_minimum`, `single_minimum_bound`, `crl_floor`, `crd_floor`, `boundary_minimum`, `reference_stress_consistent`, `reference_is_restrained`, `P_ref_restrained`, `warnings`, `assumptions` 를 함께 옮겨 설계 결과의 같은 이름 목록으로 보여 주어야 한다.
  - ~~단일 극소일 때 `min(해석식 Pcrd, single_minimum_bound)` 를 보수 상한으로~~ — **틀린 안내였다(V2-04).** 단일 극소 값은 분리되지 않은 모드 임계값의 **하한**이다. 분리되지 않은 모드(Pcrl 또는 Pcrd = 0)는 부록 2 해석식으로 정하고, `crl_floor`/`crd_floor`(= `single_minimum_bound`)는 그 값의 아래 한계로만 쓴다: `max(해석식, floor)`. 상한으로 쓰면 립 C·Z 압축이 13–36 % 낮아진다(Manual I-8B Pa 10.8 → 7.14 kips).
  - `boundary_minimum=True` 또는 `reference_stress_consistent=False` 이면 Pcrl 을 "평가하지 못함" 쪽으로.
  - 압축(`_design_compression`)에서 `local_not_evaluated=True` 이면 판정 `None`(지금은 휨만 그렇게 함). R5-06 으로 단조 곡선의 Pcrl 이 0 이 되므로 C/Z 가 아닌 단면에서 필요하다.
  - `_infer_web_crippling_family` 의 'lippedz'→'C' 는 shear.py 쪽에서 닫았지만, 같은 이름표를 쓰도록 맞추면 경고가 사라진다. `_infer_web_crippling_n_webs` 는 built-up I 에 None 을 넘겨 기본 2 웨브가 된다(R5-14) — 의도와 맞는지 확인.
  - `web_crippling` 결과의 새 키 `within_limits`, `limit_violations`, `not_covered` 를 읽을 것(지금도 `error` 로 `pass=None` 은 된다). `shear` 결과의 새 `warnings`/`assumptions` 를 상위 `warnings` 로 올릴 것.
- **`python/server.py`**: `dsm` 분기(`:196-212`)가 모델의 `BC` 와 (있으면) `unsymm` 을 `extract_dsm_values` 에 넘겨야 R5-07 의 BC 검사가 동작한다. `web_crippling` 분기(`:250-271`)에 `d`, `web_holes` 를 넘길 것. `steel_grades`(`:246-248`)는 `include_restricted` 를 받을 수 있게.
- **TypeScript `src/webview/StcfsdPanel.ts`**
  - `:1462-1467`, `:1500-1505`, `:1949-1951`, `:1972-1974`, `:1998-2000`, `:2057-2059` 가 `classification_method`·`*_detected` 만 옮긴다. `local_absence_verified`·`dist_absence_verified`(언제나 False), `single_minimum`, `single_minimum_bound`, `boundary_minimum`, `warnings` 를 옮기고 해석 탭에 `warnings` 를 보여 줄 것.
  - `:2813-2819` 강종 드롭다운과 `webview/js/app.js:3282-3289` `gradeMap` 이 SGC570(81.22 ksi)·A653-80·A792-80(80 ksi)을 감소 없이 제공한다 — 빼거나 A3.1.3 감소값·사용 제한 표시로.
  - `_normalizeSectionType`(`:958-966`)은 'Z','Hat','Track','Tee','Angle','C' 를 낸다 — shear.py 가 모두 인식한다(Tee/Angle 은 이제 "Table 이 다루지 않음" 오류).
- **MCP `src/mcp/server.ts`**: `get_web_crippling`(`:1010-1045`) 설명에 not-covered/범위 밖 오류와 built-up I per-web(기본 2 웨브)를 적을 것. `steel_grades`(`:989`) 설명 "KS SGC490/570" 에서 570 을 빼거나 제한 강종으로 표시. `get_dsm_values`(`:143-162`) 결과 설명에 새 키.

## 사용자 결정 필요

1. **R5-30 남은 선택 — §A3.1.3 강종을 화면에 둘 것인가.** 엔진은 기본 목록에서 뺐고 요청 시 감소값(Fy 60, Fu 61.5/62)을 준다. 선택지: (a) 화면에서도 뺀다(이 도구의 설계 대상 C/Z/hat 에는 §A3.1.3 이 금지), (b) 데크 설계용으로 감소값 + 경고와 함께 남긴다(§A3.1.3(a) 의 Chapter F Rb·Fsy 는 `a313_flexure_Rb` 로 계산 가능하지만 설계 경로에는 아직 연결되지 않음). SGC570 을 §A3.1.3 으로 본 근거는 Fu/Fy = 1.02 < 1.08(§A3.1.1(a) 불만족)이고, KS 연신율 값은 이번 자료에 없다.
2. **R5-31 KS 강종 명칭.** 확인한 사실(kds skill `data/standards/KDS_41_30_30.md` 표 3.2-1/3.2-2): 현행 KS D 3506 냉연 계열은 SGC245Y 245/340, SGC295Y 295/400, SGC335Y 335/440, SGC365Y 365/490 MPa, SGC560Y(강도 칸 비어 있음); KS D 3530 은 SSC275(275/410). 코드의 `SGC400` = 245/400 은 Fy 는 SGC245Y, Fu 는 SGC295Y 행의 값이다 — 사용자가 SGC245Y 를 쓰면 Fu 가 +18 % (접합부 지압·파단 비보수), 구 명칭 SGC400(옛 JIS G 3302 계열 295/400 로 알려짐 — 이번 1차 자료로는 확인 못 함)이면 Fy 가 보수. `SGC440`=295/440 도 같은 엇갈림(현행 SGC335Y 335/440). `SGC490`=365/490 은 SGC365Y 와 일치. `SSC400`=245/400 은 구 KS D 3530 SSC400 으로 보인다(현행 SSC275 는 275/410 — 보수). 도구 기본강(SGC400 245/400)을 그대로 둘지, 현행 명칭(SGC245Y 245/340 등)으로 바꾸고 구 명칭을 별칭으로 둘지 정해 주십시오. 값은 바꾸지 않았고 `note` 키로 사실만 붙였다.

## 못 한 것

- 단일 극소 단면(9CS2.5x059 압축 등)의 "참" Pcrd 는 정하지 않았다 — 순수모드 cFSM(R3 영역)이 둥근 모서리에서 아직 믿을 만하지 않다. 대신 단일 극소 값을 하한/상한 후보로 내보낸다.
- 보간 극소(`LF_*_interp`)를 Pcr 에 쓰지는 않았다. 꼭짓점 값이 표본값 이하임은 보였지만, 모드 교차(kink)에서 포물선이 크게(10 % 대) 밑돌 수 있어 값 자체를 바꾸기보다 격자 경고로 두었다.
- §G2.2(보강 웨브)·§G3(구멍 전단)·§G4·§G6 는 구현하지 않고 오류/경고로 드러내기만 했다.
- ITF 끝거리 입력이 없을 때는 지금처럼 assumptions 로만 남긴다(입력이 없는 모든 ITF 를 "평가하지 못함"으로 만들지 않았다). 입력값이 모자라면 범위 밖 오류다.
- `aisi_s100.py` · `server.py` · TypeScript 는 고치지 않았다(위 「후속」).


## V2 검증 뒤 고친 것

검증 `verify/V2-member-dsm-shear.md` 의 F5 해당 항목(V2-04 의 F5 쪽, V2-02 의 shear.py 쪽, V2-07, V2-08, V2-10 의 dsm/shear 쪽,
V2-11 의 dsm 쪽, V2-15)과 FIXES §3.1.1. 결과 키는 덧붙이기만 했다(아래 "뜻이 바뀐 값" 둘은 1차에서 내가 새로 만든 키다).

| 번호 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후) | 회귀 시험 |
|---|---|---|---|
| V2-04 (F5 쪽) | `dsm.py:extract_dsm_values` — 극소가 하나면 **한 모드만** 값을 받는다(D 라벨이면 뒤틀림, 아니면 국부). 다른 모드는 0, 새 키 `crl_floor` / `crd_floor`(= `single_minimum_bound`)에 그 극소 값을 **하한**으로 둔다. 새 키 `single_minimum_bound_meaning` = "lower bound of the critical load of the mode that was not isolated; use as a floor, never as the value". docstring 도 같은 뜻. `local_basis` 값 `'single_minimum_bound'` → `'single_minimum_assumed_local'`(1차에서 만든 값; 하한이라는 말과 섞이지 않게). 단일 극소면 `local_isolated` 도 False. | D 라벨 단일 극소: Pcrl 극소값 → 0(+ `crl_floor`). 라벨 없음/L: 값 그대로, `crd_floor` 추가. F3 가 둥근 모서리를 NaN 으로 내므로 실단면에서는 라벨 D 단일 극소가 드물다. | `test_V2_04_single_minimum_floor_is_never_the_other_modes_value`, `test_R5_01_*` 두 개(양쪽 경계: NaN 경로 Pn(KL 144) = 6.47 ± 3 %, V2 독립값) |
| V2-08 · V2-15 | `dsm.py:_assign_two_or_more` 를 다시 씀(규칙은 위 곡선 표). 근거: 서명곡선은 순수모드 곡선의 아래 포락선이므로 어느 극소가 어느 모드인지 모르면 그 모드일 수 있는 극소의 최저가 보수 측 — 국부는 가장 긴 극소일 수 없고 뒤틀림은 가장 짧은 극소일 수 없다. | V2 synth (t): Pcrl 1.012 → 0.600 (Pcrd 0.600 그대로, 하한 표시); (t2) 1.012 → 0.600, Pcrd 0.903; (l): Pcrl 0.801 → 0.500. 두 L 라벨(0.7 @4, 0.6 @30): Pcrl 0.70 → 0.60, Pcrd 0.60 → 0(+ floor). 실단면(극소 2개)은 변화 없음. | `test_V2_08_lower_local_minimum_is_not_dropped`, `test_R5_curve_shape_behaviour_table`(V2-15 행 교체) |
| V2-02 (shear 쪽) | `shear.py:classify_web_crippling_case` — §H3 원문((a) 단일 무보강 웨브: C·Z·hat·다중 웨브 데크, (b) 맞댄 I, (c) 겹친 Z)대로 hat·built-up I·돌출(G5-2)도 `h3_applicable=True`. 새 키 `h3_applies`, `h3_equation`(built-up I → H3-2, nested Z → H3-3, 나머지 H3-1; `web_config` 와 어긋나면 warnings), `h3_evaluated=False`(이 함수는 H3 를 계산하지 않음 — 호출자가 평가하지 않으면 판정 None 이어야 함). 돌출은 Pnc 를 Pn 자리에, hat/데크 내부 지점은 (a) 예외를 주장하지 않음(assumptions). H3 식 자체는 `interaction.combined_bending_web_crippling`(F4 파일)에 이미 있다 — shear.py 쪽에 빠진 식은 없다. | hat·built-up I·돌출: `h3_applicable` False → True. 옛 호출자는 이제 H3 를 계산한다(web_config 기본 'single' 이면 H3-1 — built-up I 에는 H3-2 보다 보수). | `test_V2_02_h3_applies_to_hat_builtup_and_overhang_and_is_not_evaluated_here` |
| V2-07 (조정자 결정) | `shear.py:classify_web_crippling_case` — 체결 + 무보강 플랜지 1-플랜지(EOF·IOF)는 같은 표의 무체결 무보강 행(Ω·φ 포함)을 보수 대체로 쓰고 `assumptions` 와 새 키 `row_used='unfastened_substitute'` 로 밝힌다. 근거 확인: 보강 플랜지 행끼리 체결/무체결을 표 한계 안(h/t 20–200, R/t, N/t ≤ 210) 격자로 비교하면 **1-플랜지는 체결 Pn·φPn·Pn/Ω 가 언제나 무체결 이상**(G5-1/G5-2/G5-3 최소 비 1.00). **2-플랜지는 체결이 무체결의 0.28–0.56 배까지 낮다**(G5-2 ITF 0.32, G5-3 ITF 0.28 @ h/t 200) — "체결은 강도를 낮추지 않는다"가 표와 맞지 않으므로 ETF·ITF 는 대체하지 않고 "Not covered" 에 까닭을 붙였다. 같은 검토로 built-up I 체결-무보강 EOF/IOF 도 대체(G5-1 보강 행은 체결 = 무체결). 다른 "표에 없음": hat 무체결 2-플랜지(보수 대체 행 없음 — 체결 행은 더 큼), built-up I 2-플랜지 체결·무보강 2-플랜지 — 그대로 "not covered". | 트랙 600T125-54 류(h 5.75, t 0.0566, R 0.0566, N 3, Fy 50) 체결 EOF: 오류 → Pn 1.44 kips (φPn 1.22), IOF → 2.20 kips. 트랙 체결 ETF/ITF: 그대로 오류. | `test_V2_07_fastened_track_web_crippling_gets_a_strength`(근거 비교도 시험 안에서), `test_R5_13_*`, `test_R5_G5_every_specification_row_and_only_those` |
| V2-10 · FIXES §3.1.1 | dsm: `warnings`/`assumptions`/`scope_notes` 로 나눔. 단일 극소 · 라벨이 모드를 가르지 못함 · 응력 환산 · 응력 0 → `assumptions`; 분류 행이 **전부 NaN** 이면 알림 없이 `classification_note`; 늘 참인 "부재는 확인하지 않는다" → `scope_notes`. 경계 극소 · 격자 · 응력 형상 불일치 · 비구속 분포 · BC · 극소 없음 · 하한 규칙(3개 이상) → `warnings`. shear/web_crippling: "구멍 없는 웹" 범위 → `scope_notes`(`assumptions` 에서 뺌). | 9CS2.5x059 압축/휨(둥근 모서리, NaN 분류): dsm warnings 1 → 0. | `test_V2_10_expected_situations_do_not_raise_warnings`, `test_R5_16_*`, `test_R5_03_node_stress_scale_*` |
| V2-11 (dsm 쪽) | 새 키 `reference_is_restrained`(P_ref 가 구속 휨 첫 항복 — Sf·Fy 와 같은 기준 — 이면 True), `P_ref_restrained`(같은 단면의 구속 첫 항복). False 이면 Pcr 을 Sf·Fy 로 만든 My 와 섞으면 안 된다. | 값 변화 없음 | `test_R5_03_unrestrained_z_bending_uses_matching_first_yield` |

### V2 뒤 「후속」 추가

- **F4 `aisi_s100.py`**: (1) 단일 극소 floor 는 지금 코드(`:913, 972, 1300, 1373` 의 `max` 꼴)대로 하한으로만 — 맞다. D 라벨 단일 극소면 이제 Pcrl=0 이 오므로 국부도 해석식 + `crl_floor`. (2) `web_crippling` 의 `h3_applies=True` 이고 반력 위치 모멘트로 H3 를 계산하지 못하면 판정 `None`; H3 식은 `h3_equation`(built-up I → H3-2)으로 고를 것 — 지금은 `web_config` 로 고른다(데크 `multi_web` 이면 H3-2 를 고르는데 원문은 H3-1, 이 경우 shear.py 가 warnings 를 낸다). (3) `reference_is_restrained=False` 이면 My=Sf·Fy 와 Pcr/P_ref 를 섞지 말고 비구속 첫 항복(`P_y`)을 쓰거나 미평가. (4) dsm `assumptions` 도 옮길 것(`:3182` 목록에 없음 — 단일 극소 알림이 assumptions 로 옮겨 갔다). (5) `row_used='unfastened_substitute'` 는 assumptions 로 보여 줄 것.
- **W2/W3 (MCP · 화면)**: dsm 새 키 `crl_floor`, `crd_floor`, `single_minimum_bound_meaning`, `reference_is_restrained`, `P_ref_restrained`, `classification_note`, `assumptions`, `scope_notes`; `local_basis`/`dist_basis` 의 새 값 `wavelength_bound`, `single_minimum_assumed_local`(1차의 `single_minimum_bound` 값은 없어졌다). web_crippling 새 키 `h3_applies`, `h3_equation`, `h3_evaluated`, `row_used`, `scope_notes`. `single_minimum_bound` 는 **"다른 모드의 값"이 아니라 하한**으로 표시할 것.

### V2 뒤 「못 한 것」

- 라벨 없는 극소 3개 이상에서 국부·뒤틀림 하한 규칙은 과보수일 수 있다(V2 synth (i) 꼬리의 혹 → Pcrd 0.263, 1차와 같음; (t) Pcrd 0.600 vs 아마 0.903). 어느 극소가 어느 모드인지 곡선만으로는 정할 수 없어 보수 쪽을 택하고 경고했다. 실단면 30곡선(V2)에서는 극소 3개가 나오지 않았다.
- V2-04 의 제안 (2) "부록 2 Lcrd 에서의 서명곡선 값"을 Pcrd 후보로 쓰는 일은 하지 않았다 — 부록 2 Lcrd 는 dsm.py 가 모르는 단면 해석식 값이고 조정자가 F4 쪽 규칙(해석식 + floor)으로 정했다. 필요하면 다음 묶음에서 `extract_dsm_values` 에 `Lcrd_estimate` 인자를 덧붙여 그 길이의 곡선 값을 돌려줄 수 있다.

### V2 뒤 시험 결과

- 자기 시험 `test/python/test_review_1122_dsm_shear.py` 32 개 통과(약 2.7 s; V2-02 · V2-04 · V2-07 · V2-08 · V2-10 새 시험, R5-01 의 9CS KL 144 는 양쪽 경계).
- 틀린 동작을 잠그던 기존 시험 세 군데를 그 함수 안에서만 바로잡음(주석 한 줄씩): `test_web_crippling_overhang_eq_g52`·`test_web_crippling_built_up_i_table_g51`("H3 disabled" → H3 해당·미평가), `test_flexure_design_passes_built_up_i_and_edge_distance`("H3 결과 없음" → H3 평가 또는 판정 None), `test_dsm_uses_modal_classification_before_wavelength_heuristic`(D 라벨 단일 극소의 Pcrl → 0 + `crl_floor`).
- 전체 `C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe test\python\run_all.py`: `Ran 367 tests` → `FAILED (failures=4)`. 남은 넷은 다른 담당의 진행 중 영역이다: `test_purlin_uplift_r_and_governing_wiring_contract`·`test_webview_design_prepare_contract`(TypeScript/웹뷰, W3), `test_unsupported_sections_require_rational_global_buckling_input`·`test_combined_propagates_sub_warnings`(F4 `aisi_s100` 판정·경고 — dsm 출력을 거치지 않고 손으로 만든 dsm dict 를 씀).
- `ruff check python test`: 1건 — `python/engine/fsm_solver.py:564` E741(F1 파일). 내 파일은 깨끗하다.
