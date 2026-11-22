# F2 — 단면 생성 · 단면 성질 수정 기록

## 요약

고침 17 · 보류 0 (부분 보류 1: R2-20 의 단위 가정 상수) · 기각 0 (부분 기각 1: R2-05 의 "C 와 Z 가 반대") · 사용자 결정 필요 2.
대상: R2-01 – 05, 09 – 16, 18 – 20 (R2-06 · 07 · 08 · 17 은 F3) + R3-09 + 오케스트레이터가 넘긴 후속(R3-10 기본값, F1 의 `CufsmResult.m_all`, F3 의 셀 cutwp).
전체 시험(`.venv\Scripts\python.exe test\python\run_all.py`, 마지막 실행): `Ran 307 tests in 30.495s` / `FAILED (failures=1)` — 남은 1 건은 `test_review_1122_cfsm.test_R3_01_sharp_lipped_z_real_modes_locks_rotT`(F3 파일). 이 시험은 자연기저 G2 · G3 단독 선택을 보는데 `GBTConfig(glob=…)` 를 기본 orth/norm 으로 만든다 — R3-10 으로 기본이 orth 2 · norm 1 이 되어 모달 기저 모드를 고르게 됐다. 시험 안에서 `orth=1, norm=0` 을 명시하면 통과함을 확인했다(아래 후속). 그 전 실행에서 보이던 F7 영역 3 건(Uplift R ×2, FE lap golden)은 마지막 실행에서 사라졌다. 새 시험 `test_review_1122_section.py` 29 개 통과. `ruff check python test`: All checks passed!

재현: 리뷰어 스크립트(`scratchpad/review/R2/t1 – t9`)로 모든 발견을 재현한 뒤 고쳤다. 수정 확인 스크립트는 `scratchpad/fix/F2/`.

## 발견사항별

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| R2-01 | 고침 | `cfs_centerline.subdivide_flats` 신설, `template._gen_custom` 이 기본으로 호출(직선부: 가장 긴 직선부/8 길이 기준, 내부 ≥ 4 · 립 ≥ 2 = lippedc 템플릿 밀도). 새 인자 `n_flat`(1 = 예전), `max_elem_len`. 서버는 params 를 그대로 넘기므로(`server.py:57-60`) 서버 수정 없이 MCP set_custom_section · build_section 에 적용된다 | 9CS2.5x059 custom: 요소 21 → 36(템플릿 36), 순수 휨 국부 최소 하중계수 0.912 → 0.7355 (템플릿 0.7355, 2 배 조밀 템플릿 0.7350). 성질(A · I · J · Cw · xo)은 불변 | `test_R2_01_custom_path_subdivides_flats_same_properties`, `test_R2_01_custom_path_local_buckling_matches_template`, `test_R2_01_custom_builder_and_mesh_controls` |
| R2-02 | 고침 | `cfs_centerline.offset_to_centerline` 이 구간별 `outer_side` 목록을 받음(이웃 offset 선의 교점). `centerline_envelope_excess` 신설 — `_gen_custom` 은 중심선이 외측 꼭짓점 범위를 0.25 t 넘게 벗어나면 ValueError. `make_z_section` · `make_hat_section` 을 구간별 side 로 다시 씀(Z 의 위 플랜지 폭은 위 굽힘 바깥면에서 잰다) | 리뷰 Z 꼭짓점 단일 side: 중심선 (4.500, 8.000), Ix 7.753 → ValueError; 구간별 side → (4.441, 7.941). `make_z_section` 깊이 8.94 → 7.941, lippedz 와 A · Ix 일치. `make_hat_section(H=3)` 깊이 3.000 → 2.952 | `test_R2_02_z_needs_per_segment_side`, `test_R2_02_factories_z_hat_depth` |
| R2-03 | 고침 | `template._gen_lipped_angle`: radii `[r, r, r]` 제자리(걸러내기 삭제). 같은 걸러내기가 있던 `_gen_sigma`(미등록)도 7 코너 제자리 목록으로 | 4LS4x060: A 0.5235 → 0.5120 (Table I-6 0.512), Ix 0.972 → 0.9575 (0.959), I2 0.4197 → 0.3966 (0.397), J 0.000628 → 0.000614 (0.000615) | `test_R2_03_lipped_angle_all_corners_rounded` |
| R2-04 | 고침 | `template._lip_setback` 신설: b = B − t/2 − (t/2)tan(γ/2), d = D − (t/2)tan(γ/2) (AISI Example I-3, `template_out_to_in.m`). lippedc · lippedz · lipped_angle. γ = 90° 는 예전 식과 비트 단위로 같다 | 8ZS2.25x059 γ=50: A 0.8181 → 0.8218 (0.822), Ix 7.707 → 7.756 (7.76), Iy 1.045 → 1.076 (1.08), Ixy 2.043 → 2.082 (2.08), Imin 0.468 → 0.480 (0.481) | `test_R2_04_sloped_lip_dimensions_aisi_z` |
| R2-05 | 부분 기각 · 고침 | "C 와 Z 의 qlip 뜻이 반대" 는 재현되지 않음 — 둘 다 qlip < 90 이면 립이 플랜지 끝 밖으로 벌어진다(굽힘 각 γ, AISI θ 와 같은 뜻; Z q=50 이 Table I-4 와 맞는 것이 근거). lipped_angle 은 첫 립만 반대로 기울어 등변 대칭이 깨졌다 → 첫 립 각을 `270 − qlip` 로(코너→끝 방향이 둘째 립의 45° 거울상). 세 생성기 docstring 에 규약을 적음 | lipped_angle q=50: Ixx ≠ Izz → Ixx = Izz. q=90 불변 | `test_R2_05_qlip_convention_consistent` |
| R2-09 | 고침 | `_gen_isect` · `_gen_tee`: half_b = B/2, `tf` · `tw` 인자(없으면 t), isect h = H − tf, tee h = H − tf/2 | isect H10 B5 t0.1: A 1.97 → 1.99, Izz 1.961 → 2.083, Cw 48.04 → 51.05 (닫힌 해). tee H8 B6: A 1.385 → 1.395, Izz 1.711 → 1.800 | `test_R2_09_isect_tee_flange_width` |
| R2-10 | 고침 | `_gen_chs`: `OD`(MATLAB 이름) 우선, 없으면 `D`(GUI 가 H 를 D 로 복사해 보냄 — 저장된 뜻 유지). OD 없이 H ≠ D 이면 ValueError(지름 모호). 경우: GUI 는 엔진과 맞고(`app.js:2199-2202`), **MCP 설명(D = "Lip length", `D || 1`)이 틀림** | MCP 인자 {H:6, B:6, D:1}: 지름 1 in 관 → ValueError; OD=6 → 지름 6 관. 설계 경로 기본값 {H:8, D:0.625} → ValueError(예전 0.625 in 관) | `test_R2_10_chs_diameter_argument` |
| R2-11 | 고침(인자 덧붙임) + 사용자 결정 | `_gen_hat`: 이름 있는 인자 `top_width` · `depth` · `brim` (H · B · D 보다 우선). H · B · D 의 뜻(H = 상판 폭, B = 깊이, D = 브림)은 §4.6 대로 유지 · docstring 에 명시. 경우: **엔진이 MCP 설명("H: Height", "B: flange width")과 호스트 자체 사용(`StcfsdPanel.ts:1556` depth = H, `app.js:3808` depth = tpl-H) 둘 다와 어긋난다**(GUI 라벨은 "H/B/D" 뿐). 오케스트레이터 기준으로는 엔진이 틀렸으나 뜻을 뒤집으면 저장된 .csd · 화면 입력이 다른 단면이 되므로 뒤집기는 사용자 결정으로 남김 | 값 불변(이름 인자 경로: 3HU4.5x135 A 1.735 (1.74), Ix 8.277 (8.28), Iy 2.465 (2.47)) | `test_R2_11_hat_named_dimensions` |
| R2-12 | 고침 | `template._req/_pos/_opt_nonneg/_nseg/_qlip` 입력 검사: t ≤ 0, nseg < 1, 0 ≥ qlip ≥ 180, 음수 r/D → ValueError. `_snakey`: 코너 반경보다 짧은 직선부 → ValueError(예전 0 으로 잘라 형상 팽창). D = 0 → 립 · 립 코너 제거(lippedc → track, lippedz → 무립 Z, hat → 무브림, lipped_angle → angle). `cfs_centerline.apply_fillet`: 45 % 자동 반경 축소 삭제, 한 변의 접선 거리 합 > 변 길이면 ValueError, n_arc < 1 거절. custom: 닫힌 경로 · 중복 점 거절. `properties.grosprop`: 면적 0 → ValueError | lippedc D=0 r=0.2: A 0.9761 → 0.9580 (= track). track B=0.6 r=0.8, lippedc B=1 D=0.3 r=0.5: 부푼 단면 → ValueError. custom 립 D=0.4/0.3: 호 반경 0.167/0.122 → 0.217 (요청값, 템플릿과 같은 A). isect nseg=0 · custom n_arc=0: ZeroDivisionError → ValueError. t=0: A=0 dict → ValueError | `test_R2_12_degenerate_inputs_rejected`, `test_R2_12_zero_lip_is_unlipped_section`, `test_R2_12_custom_short_lip_keeps_radius`, `test_R2_12_grosprop_zero_area_rejected` |
| R2-13 | 고침 | `_gen_custom` 이 `validation`(validate_section 보고 + `status` · `outer_side` · `n_elem`)과 `warnings`(pass 아닌 검사의 문장)를 결과에 덧붙임. 자기 교차 → ValueError(예전 stderr 출력만). `validate_section`: `cl_coords` 로 실제 모델 면적 비교, 비 0.8–1.2 pass / 0.7–1.3 warn / 그 밖 fail, 전체 `status`, 립 검사를 "립 끝이 인접 플랜지 선의 안쪽 반평면" 으로 | expected_A 비 2.0: 무표시 → status 'fail'. 문서 시그마 아래 립 (0,−1): 'inward' → 'outward'(warn) | `test_R2_13_custom_reports_validation` |
| R2-14 | 고침 | 코드 뜻(= 판 재료가 놓인 쪽)을 유지하고 글을 고침: `offset_to_centerline` · `ColdFormedSection` · `_gen_custom` docstring, `Example/CFS_CENTERLINE_ALGORITHM.md`, `Example/임의단면형상모델링방안.md` §4.4. `outer_side='auto'`(중심선이 외측 범위 안에 남는 한 방향)를 `_gen_custom` 의 기본값으로, 틀린 쪽은 범위 검사로 ValueError. 경우: **MCP 설명 · 문서의 글 규칙이 틀림** (MCP 예제 값 C/sigma = 'left' 는 코드와 맞음) | C 경로 'right': 중심선 (2.559, 9.059), A +3.2 %, Ix +6.9 % → ValueError. 미지정 → (2.441, 8.941) | `test_R2_14_outer_side_means_material_side` |
| R2-15 | 고침 | `_gen_chs` 기본 `n_elem` 24 → 48 (꼭짓점은 중심선 위 그대로). MATLAB 32 대신 48: 32 는 I −0.80 % 로 리뷰 기준 0.5 % 를 넘는다 | D=6 t=0.1: A −0.29 → −0.07 %, I −1.42 → −0.36 %, J −1.98 → −0.50 % (닫힌 해 대비) | `test_R2_15_chs_polygon_accuracy` |
| R2-16 | 고침 | `grosprop`: Sx · Sz 를 요소 직사각형의 최외단(절점 ± (t/2)·법선 성분, 수직 판 자유단은 절점 그대로)으로 계산. 예전 중심선 기준 값은 `Sx_cl` · `Sz_cl` 로 덧붙임 | 800S200-54: Sx 1.6538 → 1.6421 (Table I-2 1.64). 9CS2.5x059 r=0: 2.404 → 2.389. 설계 경로 Sf = Sx 이므로 My 약 −0.7 % (보수 쪽, AISI 정의) | `test_R2_16_section_modulus_outer_fibre` |
| R2-18 | 고침 | **권위본 = `python/engine/cfs_centerline.py`** (엔진 `_gen_custom` 이 쓰고 검증 · SectionBuilder · 팩토리를 가진 쪽). `Example/cfs_centerline.py` 는 엔진 모듈을 다시 내보내는 비권위 진입점으로 바꿈(문서 · `verify_all_examples.py` 의 `from cfs_centerline import` 는 그대로 동작, 결과 21/23 PASS 동일). 엔진 쪽: `corner_radii` 를 docstring 대로 **내측 반경**(+t/2)으로 — `_gen_custom` 의 미리 더하기 제거(MCP 결과 불변). `make_c_section` · `make_sigma_section` 아래 립 +D(안쪽). `__main__` 의 `/home/claude` 경로 → 임시 폴더 | `ColdFormedSection(corner_radii=[0.1875]*4)` 직접 사용: A 0.8988 → 0.8808 (= R_inner 경로). `make_c_section` 첫 꼭짓점 y −0.625 → +0.625 | `test_R2_18_single_authoritative_centerline_module` |
| R2-19 | 고침 | `Example/III-3.md`: 제목 · 단면 유형 Z → 립 C(스터드), §7 총단면 값을 Table I-2 362S162-54(Ix 0.873, Iy 0.154, xo −1.28, J 0.000451, Cw 0.457)로, 원 예제(pp. 468-473)에 없는 구멍 · 순단면 값은 "출처 미확인" 표시. `CFS_CENTERLINE_ALGORITHM.md` 시그마 아래 립 (0, −1.00) → (0, 1.00), 45 % 규칙 · corner_radii 설명 · Z/Hat 표 정정 | 문서 | `test_R2_19_example_doc_values` |
| R2-20 | 고침 (단위 상수는 보류) | `models/data.py`: ndarray 의 NaN/Inf 도 null (`_ndarray_to_json`; 예전 0.0), `CufsmModel.from_dict` 가 node (n,8) · elem (m,5) 모양 검사. `generate_section`: 빠진 필수 치수(t, H, B, 립 단면의 D, custom 의 t)를 기본값으로 채우지 않고 ValueError. **보류**: `properties.py` 파이버 `L/0.1`, `check_symmetry` 의 `max(…, 1)`, 검증 문구 "in²" — 엔진 내부 단위가 US 라 지금은 맞고, SI 좌표를 직접 받게 될 때(데스크톱) 같이 정할 일 | JSON `[1, NaN, inf]` → `[1, 0, 0]` → `[1, null, null]` | `test_R2_20_json_nan_in_arrays_is_null`, `test_R2_20_model_shape_checked` |
| R3-09 | 고침 | `GBTConfig.is_active`: 어느 선택 벡터든 합 > 0 일 때만 (MATLAB stripmain) | 0 벡터 GBTConfig: 모든 길이 NO_FREE_DOF → 보통 FSM 과 같은 하중계수 | `test_R3_09_zero_selection_vectors_inactive` |

| R3-10 (F3 후속) | 고침 | `models/data.py:GBTConfig` 기본 orth 1 → 2, norm 0 → 1 (`from_dict` 의 빠진 키 기본도). CUFSM 기본 확인: `Ref_Source/helpers/loader.m:134-146`(ospace 1, orth 2, couple 1, norm 1), `examples/batchcufsm5.m:169`. 기본 객체는 선택 벡터가 비어 `is_active()` False — 보통 FSM 에는 영향 없음(시험으로 확인) | 예리한 립 C(H9 B5 D1 t0.1) 휨 L=4.92, `classify(…, GBTConfig())`: [G 0.46, D 3.27, L 91.76, O 4.51] → [0.55, 3.45, 95.50, 0.51] %. 구속 FSM 하중계수: 기본 객체로는 불변. 선택 벡터를 준 구속 해석은 기저가 모달로 바뀌어 개별 모드 선택 결과가 달라진다(전체 공간 G/D/L 선택은 같은 공간) | `test_R3_10_gbtconfig_defaults_are_cufsm` |
| F1 후속 | 고침 | `CufsmResult.m_all` 필드(기본 빈 목록) 선언, `to_dict` 에 `'m_all'`(길이별 list), `from_dict` 가 읽음 | 덧붙인 키만 | `test_F1_result_carries_sorted_terms` |
| F3 후속 (셀 cutwp) | 고침 | `engine/cutwp.cutwp_prop`: `_cutwp_prop2` 의 ValueError(끊어진 모델 · 다세포 · 0 길이 · t ≤ 0)를 잡지 않고 올림(docstring 에 명시). 셀의 유한 Cw · 전단중심을 덮지 않는다(관의 Cw 를 0 으로 강제하지 않음 — 오케스트레이터 승인). 그래도 NaN 이 오면 대체하고 대체한 키를 `nan_substituted` 로 남김 | RHS 6×4×0.1: Cw 0 → 0.9004 in⁶ (= b²h²t(b−h)²/(24(b+h)), Kollbrunner-Basler), CHS Cw ≈ 0, 끊어진 두 앵글: 조용한 값 → ValueError | `test_R2_templates_sharp_closed_forms`, `test_R2_cutwp_passes_model_errors_through` |

## 후속 — 다른 곳이 따라와야 하는 것

- **`python/server.py:57-64`** `generate_section` 은 `node` · `elem` 만 돌려준다. custom · custom_builder 의 `validation` · `warnings` 를 그대로 덧붙여 넘겨야 화면 · MCP 가 검증 결과(면적비 fail, 립 방향 경고)를 보인다. 새 ValueError(퇴화 입력, 지름 모호, outer_side 오류)는 지금도 오류로 전달된다.
- **`src/mcp/server.ts:179-208` set_section_template**
  - `D: D || 1` 제거 — D 를 안 주면 넘기지 않는다(엔진이 립 단면은 "D 누락" 오류를 낸다).
  - chs: `OD: H` 를 보내거나 OD 인자를 둔다. 지금 MCP 인자({H, B, D||1})는 지름 모호로 **오류**가 난다(예전엔 조용히 1 in 관).
  - hat: 설명을 "H = 상판 out-to-out 폭, B = 전체 깊이, D = 브림 폭" 으로, 또는 `top_width` · `depth` · `brim` 을 노출.
  - qlip 설명: "립 굽힘 각(플랜지에서 꺾인 각), 90 = 수직, < 90 이면 플랜지 끝 밖으로 벌어짐(AISI θ), 0 < qlip < 180".
  - isect · tee: `tf` · `tw` 노출, B 는 "플랜지 전체 폭(중심선 폭과 같음)".
- **`src/mcp/server.ts:210-283` set_custom_section · build_section**
  - `outer_side` 설명을 "판 재료가 놓인 쪽(바깥면의 반대)" 으로. enum 에 `'auto'` 추가, 구간별 배열 허용, `|| 'left'` 대신 기본 `'auto'`.
  - `n_flat` · `max_elem_len` · `expected_A` 노출(없으면 엔진 기본 분할이 적용된다 — 지금도 적용됨).
  - 안내문 `:345-349`, `:387-388` 의 outer_side 규칙("바깥면이 왼쪽이면 left", "부풀면 바꿔 보라")을 고친다 — 이제 틀린 쪽은 오류가 난다.
  - **안내문의 시그마 예제(`:311-323`, `:400-423`)와 `cfs_centerline.sigma_outer_corners`**: 아래 되돌림 · 립은 바깥면이 위쪽과 반대 면이라 단일 `'left'` 로는 중심선이 외측 범위를 t/2 벗어난다(예전 결과는 아래쪽이 t 만큼 부푼 단면). 지금은 ValueError. 구간별 side(예: `['left']*9 + ['right']*2`)를 받게 하거나 형상을 바로잡아야 한다 — 아래 「사용자 결정」 2.
- **`src/webview/StcfsdPanel.ts:1540, 1556`** 설계 정보가 `storedSection.H` 를 depth, `B` 를 flange_width 로 읽는다 — hat 에서는 거꾸로다(H = 상판 폭, B = 깊이). **`webview/js/app.js:3808-3811`** analyzeLoads 도 depth = tpl-H. hat 이면 depth = B 로 읽거나 이름 인자를 쓴다. **`app.js:2199-2202`** chs 는 `params.OD = params.H` 로 보내면 뜻이 분명해진다(지금 D = H 도 동작). 화면 라벨 H/B/D 를 템플릿별(hat: 상판 폭/깊이/브림, chs: 바깥지름)로.
- **F4 `python/design/aisi_s100.py:2242-2249` `_auto_generate_props`**: (1) chs 를 기본값 {H 8, D 0.625} 로 부르면 이제 ValueError(지름 모호) → 바깥 except 가 삼키고 `print` 한다 — chs 는 `OD` 를 넘기고, 빠진 치수 기본값(H=8, B=2.5, D=0.625, t=0.0451)으로 단면을 만들지 말 것(R2-20). (2) hat 의 H/B 뜻(상판 폭/깊이)으로 `h_web_flat = H − 2·corner` 를 계산하는데 hat 의 웹은 B 다. (3) `Sf = Sx` 는 이제 최외단 섬유 값(AISI Sf) — 약 −0.7 %. CUFSM `yieldMP` 의 My 는 중심선 기준이므로 DSM 비율과 섞을 때 `Sx_cl` 을 쓰거나 기준을 맞출 것(R5 · FIXES §4.2, F5).
- **F3**: `cutwp_prop` 의 `nan_substituted` 를 설계 경로가 보도록(F4) — 비어 있지 않으면 비틀림 관련 한계상태를 "평가하지 못함" 으로.
- **F3 `test/python/test_review_1122_cfsm.py:206`** (`test_R3_01_sharp_lipped_z_real_modes_locks_rotT`): 자연기저 G2 · G3 단독 선택을 보는 시험이므로 `GBTConfig(glob=g, dist=…, local=…, other=…, orth=1, norm=0)` 로 기저를 명시해야 한다. R3-10 기본값 변경 뒤 이 시험만 실패한다(명시하면 통과 — 확인함). 남의 시험 파일이라 고치지 않았다.
- **`src/webview/StcfsdPanel.ts:2446-2448`** `set_gbtcon` 기본 `orth 1 · norm 0` 을 CUFSM 기본(orth 2 · norm 1)으로 (F3 후속과 같음).
- **`python/server.py` 의 `analyze` 응답**: `result.to_dict()` 에 이제 `m_all` 이 있다 — 호스트가 실제로 쓴 항을 보여 줄 수 있다.

## 사용자 결정 필요

1. **hat 의 H / B 뜻 (R2-11).** 엔진은 MATLAB 규약(H = 상판 폭, B = 깊이)이고, MCP 설명과 호스트 코드(`StcfsdPanel.ts:1556`, `app.js:3808`)는 H 를 깊이로 쓴다. 이번에는 뜻을 유지하고 이름 인자(`top_width` · `depth` · `brim`)를 덧붙였다. 선택지: (a) 지금 뜻 유지 + MCP · 화면 라벨과 호스트 코드를 엔진에 맞춤(저장 파일 안전), (b) H = 깊이로 뒤집고 .csd 불러오기에서 hat 의 H/B 를 바꿔 넣는 이전(migration)을 둠(AISI 표 순서 Depth/Width 와 같아짐).
2. **시그마 프리셋 · MCP 안내 예제의 형상.** `sigma_outer_corners` 와 MCP 안내의 12 점 경로는 docstring 의 "상하 거울대칭" 과 달리 아래쪽이 y = D 의 플랜지 + 되돌림 + 립이고, 아래 되돌림 · 립의 바깥면이 위쪽과 반대 면이다. 원 도면(이미지 단면)을 보고 (a) 거울대칭 좌표로 고칠지, (b) 구간별 outer_side 로 둘지(그 경우 아래 플랜지가 판의 어느 면에 놓이는지 정해야 함) 정해야 한다. 꼭짓점만으로는 정해지지 않아 엔진이 추정하지 않는다.

## 못 한 것

- R2-20 의 단위 가정 상수(파이버 간격 0.1 in, 대칭 검사 하한 1 in)는 SI 좌표 입력이 생길 때 같이 정한다.
- R2-01 의 영향을 시그마 · 랙 단면(AISI II-13, III-14)에서 재지는 않았다 — 같은 분할 규칙이 적용되며, 9CS 에서 템플릿과 0.0 % 일치를 보였다.
- 일축대칭 폐단면 전단중심(R2-08)은 F3 소관 — `cutwp.py` 는 대체한 키를 알리기만 한다.
