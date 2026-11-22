# W1 — Python JSON-RPC 서버 (`python/server.py` · `python/__main__.py` · `python/fileio/`) 수정 기록

## 요약

고침 26 (R8 9 건: R8-01·05 서버 쪽, 17, 21 서버 쪽, 24, 25, 26, 27, 28 fileio, 31 서버 쪽 · 묶음 1 후속 16 건 · `__main__` 1 건) · 보류 0 · 기각 0 · 사용자 결정 필요 3 (이미 정한 ILL_CONDITIONED 결정은 구현).

- 새 시험 `test/python/test_review_1122_server.py` 18 개 — 실제 서버 프로세스(`.venv\Scripts\python.exe -u server.py`, cwd=`python`)를 하나 띄워 줄 단위 JSON-RPC 로 말한다. 35 개 메서드 모두 같은 인자의 엔진 직접 호출과 비교한다(`TESTED_METHODS` 가 `server.METHODS` 와 같아야 통과 — 메서드를 더하면 시험도 더해야 한다).
- 전체 시험: `C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe test\python\run_all.py` → `Ran 325 tests in 64.345s` / `OK`. 그 전 실행(부하가 큰 때)에서는 F1 의 시간 시험 `test_review_1122_fsm.test_R1_04_multi_term_runtime` 하나가 7.56 s > 5 s 로 실패했다. 혼자 다시 돌리면 1.4 s 로 통과했고, 서버 파일과 관계없다.
- 린트: `C:\Coding_Works\cufsmAi\.venv\Scripts\ruff.exe check python test` → `All checks passed!`
- 재현: R8 의 `rpc_driver.py` 를 새 서버로 다시 돌렸다. 차이는 의도한 것뿐이다 — 덧붙인 키(analyze · vibration · plastic · load_project), dsm 의 BC 경고, KL 을 주고 `section_type` 을 빼면 오류(R8-05), `aisi_design.report` 의 조항 줄 순서(R8-27, 고침). `[1,2,3]` 한 줄 뒤에 서버가 죽던 것(R8-17)은 이제 `INVALID_REQUEST` 응답 뒤 `pong`.

## 발견사항별

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| R8-17 | 고침 | `server.py:main` · `process_line` · `handle_request` · `encode_response` · `to_jsonable`. 줄마다 응답이 꼭 하나 나간다. 깨진 줄 → `PARSE_ERROR`, 객체가 아닌 JSON(`[1]` · `42` · `"x"` · `null`) → `INVALID_REQUEST`, method 가 문자열이 아님 → `INVALID_REQUEST`, params 가 객체가 아님 → `INVALID_PARAMS`, 모르는 메서드 → `METHOD_NOT_FOUND`, 엔진 예외 → `ENGINE_ERROR`(+`error_type` · `traceback`), 직렬화 불가(복소수 · 임의 객체) → `SERIALIZATION_ERROR`, UTF-8 아닌 바이트 → `PARSE_ERROR`. stdin 은 바이트로 읽어 UTF-8 로 푼다(전: 로캘 인코딩) | `[1,2,3]` 다음 ping: 프로세스 종료 → `pong` | `test_R8_17_bad_lines_get_error_responses_and_server_survives`, `test_R8_17_serialisation_and_stdout_protection` |
| R8-25 | 고침 (서버 쪽) | `server.py:to_jsonable` — 결과를 서버 안에서 순수 JSON 값으로 바꾼다. 유한하지 않은 실수는 스칼라 · 중첩 list · ndarray 어디서나 `null`, numpy 정수 · bool · 실수 스칼라는 파이썬 값, set 은 정렬된 list, dict 키는 JSON 규칙의 문자열. 최종 `json.dumps(allow_nan=False)` 로 맨 토큰 `NaN` / `Infinity` 를 막는다. (`models/data.py` 의 ndarray NaN 은 F2 가 이미 `null` 로 고침 — 서버는 이제 그 인코더에 기대지 않는다) | `{'rows':[array([1,nan,inf])], 'flag': np.bool_}` → `[[1.0,null,null]]`, `true` (전: np.bool_ 은 TypeError → 프로세스 종료) | `test_R8_17_serialisation_and_stdout_protection`, `test_R8_25_rounded_corner_classification_is_null_with_status` |
| R8-26 | 고침 (서버 쪽) | `server.py:_protocol_stream` — 시작할 때 fd 1 을 복제해 응답 전용으로 쓰고 fd 1 은 stderr 로 돌린다(파이썬 `print`, `sys.stdout.write`, C 확장의 `write(1, …)` 모두 stderr). 요청 처리 중에는 `redirect_stdout(sys.stderr)` 도 건다(서버를 모듈로 부르는 시험에서도). 엔진의 stdout `print` 는 F4 가 이미 없앴다 | 엔진 print → 응답 채널 오염 → stderr | `test_R8_17_serialisation_and_stdout_protection` (주입한 메서드가 세 가지로 출력해도 응답 줄이 그대로) |
| R8-27 | 고침 | `server.py:_m_aisi_design` · `_sort_unordered` — 결과 안 어디든 `spec_sections` 를 정렬하고, 최상위 `report` 를 엔진의 `generate_report(result, params)` 로 다시 만든다(보고서의 "Specification: AISI S100-16 §…" 줄이 set 순서였다). `to_jsonable` 도 `spec_sections` 를 정렬한다 | PYTHONHASHSEED 1/2/3 에서 응답 해시 3 종 → 1 종 (combined: `['C1','E2','E3.2','E4','F2','F3.2','F4','H1.2']`) | `test_R8_27_output_is_byte_identical_across_hash_seeds` |
| R8-24 | 고침 (F1 이 엔진을 고침, 서버는 응답) | `server.py:_m_signature_ss` — `neigs` · `GBTcon` 를 넘기고 `diagnostics` · `shapes` · `success` 를 싣는다. 폐기 길이 규칙(아래 F1 후속 4) 적용. 쓰이지 않는 `springs` · `constraints` 를 주면 경고 | 언제나 ImportError → 동작 | `test_F1_signature_ss_rpc_returns_diagnostics`, `test_W1_analysis_methods_match_engine` |
| R8-28 (fileio) | 고침 | `fileio/project_io.py:read_project` · `save_project`: `format` 이 `cufsm-vscode` 가 아니면 · 주 버전이 1 이 아니면 · 버전을 못 읽으면 오류. 머리말이 없는 파일은 원시 모델 JSON 으로 읽고 경고(호스트의 `.stcfsd` 원시 모델도 읽힌다). `prop` · `node` · `elem` · `lengths` · `BC` 가 없으면 오류(전: `KeyError` 또는 BC 를 S-S 로 채움). `NaN`/`Infinity` 토큰은 JSON 이 아니므로 거절. 저장은 `allow_nan=False`(NaN 모델은 쓰지 않음) + 임시 파일 → `os.replace`. 응답에 `file_info` | 무손실 왕복은 그대로(C-F, 다항 m_all, 스프링, GBTcon 포함 확인) | `test_W1_project_file_round_trip_and_version_checks` |
| R8-28 (.mat) | 고침 | `fileio/mat_loader.py:read_mat_file` — `Ref_Source` 의 CUFSM `.mat` 82 개(단면이 있는 것 전부)를 읽어 고쳤다. 길이 하나의 다항 `m_all`(simplify_cells 가 1×1 셀을 푼 것)을 한 길이로, CUFSM 4.2 이전 4 열 스프링을 `loader.m` 과 같은 식으로 10 열로, 뒤 열이 0 인 8 열 구속을 5 열로, 7 열 prop(진동 밀도)를 그대로. `GBTcon` 의 빠진 설정은 CUFSM 기본(orth 2 · norm 1 — 전: orth 1 · norm 0), 옛 `basis` 를 ospace/orth/couple 로. 지어내던 기본값 제거: prop 없음 → 오류(전 G=11300 인 기본 재료), node/elem 없음 → 오류, lengths 없음 → 빈 길이 + 경고(전 [100]), BC 없음(CUFSM 3) → S-S + 경고, m_all 없음 → S-S 는 [1] + 경고 · 그 밖은 비우고 경고. 저장된 curve/shapes/clas 는 가져오지 않는다고 경고. 응답에 `file_info` | `ffplate1.mat`: m_all 10 개(길이 1 개와 불일치 → 해석 오류) → `[[1..10]]`. `zwlip_Mxr_p7rotspring.mat` 스프링 `[27,4,0.7,1]` → `[1,27,0,0,0,0,0.7,0,0,0]`(전: 4 열 그대로 → 엔진 ValueError) | `test_W1_mat_import_cufsm_files` |
| R8-31 (`server.py:380`) | 고침 | 깨진 줄에서도 `"id": …` 를 찾아 그 id 로 오류 응답(전: 언제나 `id: 0` → 호출자가 5 분 기다림). 못 찾으면 `id: null` | `{"method":"ping","id":77,` → `id 77` | `test_R8_17_bad_lines_get_error_responses_and_server_survives` |
| R8-21 (서버 쪽) | 고침 | 새 메서드 `selftest` — 파이썬 ≥ 3.10, 설계 모듈 전부 import, 메서드 목록, `protocol_version: 2`. 호스트가 ping 대신 부르면 된다(W3) | — | `test_W1_method_table_is_covered` |
| R8-01 · R8-05 (서버 쪽) | 고침 | `dsm`: `fy` 필수(전 서버 기본 35.53). `KxLx` · `KyLy` · `KtLt` · `Lb` 중 하나라도 주면 `section_type` 필수(전: 엔진 기본 'C' 로 Z 를 C 식으로 계산 — Mcre 2.0×, Pcre 2.24×). MCP · 패널 쪽 수정은 W2 · W3 | Z + Lb, section_type 없음: Mcre 64.27(C 식) → 오류 | `test_F5_dsm_forwards_bc_and_requires_section_type` |
| F1 후속 1 | 고침 | 새 RPC `m_recommend(prop, node, elem, lengths)` → `engine.helpers.m_recommend_details` 그대로(`m_all` 은 list of list) | — | `test_F1_m_all_missing_auto_and_explicit` |
| F1 후속 2 · 사용자 지시 | 고침 | `analyze` · `fcfsm`: `m_all` 이 없거나 `[]` 이면 오류(`'auto'` 와 `m_recommend` 를 안내). `m_all: "auto"`(대소문자 무관)는 S-S → 길이마다 `[1]`, 그 밖 → `m_recommend` 권장 항. 명시 목록은 그대로 엔진에 간다(엔진은 msort 만). 어느 쪽인지 `m_all_selection` 으로 돌려준다. `vibration` · `classify` 는 `"auto"` 를 받지 않는다(해석이 실제로 쓴 `m_all` 을 넘겨야 모드 DOF 배치가 맞는다) | m_all 없음: `ValueError("m_all must give one array …")` → `INVALID_PARAMS` + auto 안내 | `test_F1_m_all_missing_auto_and_explicit` |
| F1 후속 3 | 고침 | `analyze` 응답에 `diagnostics` 전체 + `warnings`(severity warning 진단의 문장 + 폐기 길이 문장 + m_recommend 경고). `INSUFFICIENT_LONGITUDINAL_TERMS` 가 호출자에게 닿는다 | C-C, m=[1]: 진단만 → 진단 + warnings 문장 | `test_F1_m_all_missing_auto_and_explicit` |
| F1 후속 4 · 사용자 결정(정해짐) | 고침 | `server.py:_drop_discarded_lengths` — `ILL_CONDITIONED`(severity error) 로 엔진이 버린 길이(0 행)를 `curve` · `shapes` · `m_all` 에서 빼고, 남은 것이 있고 다른 error 진단이 없으면 `success=True`. 진단은 그대로 두고 `discarded: true` 를 붙인다. `lengths`(남은 길이) · `length_indices`(원래 색인) · `lengths_requested` · `discarded_lengths` 를 덧붙인다. 다른 실패(NO_FREE_DOF 등)는 그대로 실패. 모두 폐기되면 `ALL_LENGTHS_DISCARDED` error. DSM 추출은 원래도 lf ≤ 0 행을 건너뛰므로(`dsm.py:130`) 값이 같다 | 립 C r=0, L=[10,100,1000,1e4,5e4]: `success=False`(TS 예외) → `success=True`, 곡선 3 길이, 1e4 · 5e4 는 `discarded_lengths` | `test_F1_ill_conditioned_lengths_removed_analysis_succeeds` |
| F1 후속 5 | 고침 | = R8-24 | | |
| F2 후속 | 고침 | `generate_section` 이 엔진 결과의 모든 키를 돌려준다(custom · custom_builder 의 `validation` · `warnings`). `section_type` · `params` 필수(전: 'lippedc' · `{}` 기본). `analyze` 응답의 `m_all`(실제로 쓴 정렬된 항)은 그대로 실린다 | — | `test_W1_section_methods_match_engine` |
| F3 후속 (classify) | 고침 | `classify`: 최상위 `GBTcon` 이 `model.GBTcon` 보다 먼저. 해석이 폐기한 길이를 빼고 부를 수 있게 `lengths` · `m_all` 최상위 덮어쓰기. `shapes` 개수 ≠ 길이 수면 오류(전: 행이 밀려 다른 길이의 모드를 분류할 수 있었음). 결과는 지금처럼 list(`.tolist()`, NaN → null). 새 메서드 `classify_detailed` → `{classification, status, supported, code, message, settings, diagnostics}`(`CfsmClassification.summary()`) | 둥근 모서리 립 C: list 의 null 만 → + `status 'unsupported'`, `code 'ROUNDED_CORNER'` | `test_R8_25_rounded_corner_classification_is_null_with_status`, `test_W1_analysis_methods_match_engine` |
| F3 후속 (vibration) | 고침 | `model.springs` · `model.constraints` · `model.neigs` 를 `stripmain_vib` 에 넘긴다. `rho` 가 없으면 넘기지 않는다(엔진 강재 7.345e-7 + `DEFAULT_DENSITY` 경고). `rho ≤ 0` · 비유한 → 오류. 엔진 결과 전부(`frequencies` · `shapes` · `diagnostics` · `success` · `rho_used` · `units`) | 스프링 있는 모델: 스프링 무시 → 반영 | `test_W1_vibration_fcfsm_plastic_forward_new_keys` |
| F3 후속 (fcfsm) | 고침 | 엔진 결과 전부(`method` · `is_fcfsm` · `warnings` · `classification_status` · `shapes` …) + `m_all_selection` | — | 같은 시험 |
| F3 후속 (plastic) | 고침 | `fy` 필수(전 35.53), `n_theta` · `n_na` · `n_fibers_per_elem` · `n_thick` 전달, 엔진 결과 전부(`normalized` · `warnings` · `P_raw` · `M11_raw` · `M22_raw` · `n_thick`). 격자는 지금처럼 행 우선 펼침 | — | 같은 시험, `test_W1_section_methods_match_engine` |
| F5 후속 (dsm) | 고침 | `BC` · `unsymm` 전달. `BC` 가 없으면 결과 `warnings` 에 서버 문장(서명곡선인지 확인 못 함). `mode_classifications`(엔진 이름)도 받는다(`classifications` 와 함께 주면 오류). 나머지 선택 인자(`load_type` · `Cb` · `section_type` …)는 줄 때만 넘긴다(빠지면 엔진 기본) | C-C 곡선: Pcrl 0.970·Py → 0(`signature_curve=False`) | `test_F5_dsm_forwards_bc_and_requires_section_type` |
| F5 후속 (web_crippling) | 고침 | 엔진 서명 그대로 넘긴다(`d` · `web_holes` 포함). 서버 기본값(h=t=R=N=0, Fy=35.53, theta, support, fastened, section_type, web_config) 제거 — 빠진 필수 인자는 `INVALID_PARAMS`, 선택 인자는 엔진 기본 | h 없음: h=0 으로 계산 → 오류 | `test_W1_design_methods_match_engine`, `test_W1_kw_methods_have_no_server_defaults` |
| F5 후속 (steel_grades) | 고침 | `include_restricted` 전달 | — | `test_W1_design_methods_match_engine` |
| F6 후속 9 | 고침 | `check_lap_length`: `d` · `lap_left` · `lap_right` 필수(전 d=8.0, 0 기본) | d 없음: d=8 → 오류 | `test_W1_kw_methods_have_no_server_defaults` |
| F6 후속 (접합 · 특수 주제) | 고침 | `design_connection` · `lap_connection` 은 dict 를 그대로(새 키 모두 엔진에 닿음, 모르는 키는 엔진이 경고). `shear_lag` · `block_shear` · `cold_work` · `flange_curling` 은 서명 검사 어댑터 — 모르는 인자는 TypeError 로 죽지 않고 결과의 `ignored_params` + `warnings` 로 드러난다 | 모르는 키: `TypeError` 오류 → 계산 + `ignored_params` | 같은 시험 |
| F7 후속 (analyze_loads) | 고침 | 엔진 서명 그대로: `pattern_loading` · `brace_points_ft` · `i621_conditions_confirmed` · `insulation_in` 포함. 서버 기본값(member_app 'roof-purlin', span_type 'simple', span_ft 25, loads {}) 제거. `design_method` · `spacing_ft` 는 빠지면 엔진 기본(LRFD · 5.0) | span_ft 없음: 25 ft → 오류 | `test_W1_design_methods_match_engine`, `test_W1_kw_methods_have_no_server_defaults` |
| F7 후속 (calc_deck_stiffness) | 고침 | `kphi_method` 'chen_moen_preliminary_approximation' → `'gao_moen_2011_example_II_1C'`, `kx_method` → `'rp17_2_curve_fit_example_II_1C'`. kx 는 `lateral_stiffness_detail` 로 구해 `kx_detail`(Ka · ψ · Ke · 쓴 패스너 값 · `defaulted` · `notes`)을 싣고 기본 패스너 값 사용 · 두께 범위 · COV 를 `warnings` 로. 엔진 선택 인자(`k_per_fastener`, `E`, `b_fastener`, `c_fastener`, `Fss_kip`, `D_screw_in`, `Fu1_ksi`, `Fu2_ksi`) 전달. t_panel · t_purlin 기본(0.018 · 0.059) 제거 — 시험값 두 개를 다 주지 않으면 필수. override ≤ 0 은 오류(전: "없음"으로 봄). **반올림 제거**(전 kφ 4 자리 · kx 3 자리) | (0.018, 0.059): kφ 0.1126 → 0.112603…, kx 1.283 → 1.28323… | `test_W1_calc_deck_stiffness_reports_method_and_kx_detail` |
| `__main__.py` | 고침 | `python -m python`(저장소 루트)에서 `from server import main` 이 실패했다(엔진 폴더가 sys.path 에 없음) — 폴더를 앞에 넣는다 | ImportError → 동작 | `test_R8_17_module_entry_point_speaks_protocol` |

R8 의 나머지(R8-02 – 16, 18 – 20, 22, 23, 29, 30, R8-28 의 TS 줄, R8-31 의 TS 줄)는 TypeScript 쪽 — W2 · W3. R8-11 · R8-15 는 엔진이 이미 닫았다(props 없는 `aisi_design` → `error`, `design_connection` 의 'lrfd' → LRFD: 새 서버로 1.749 = LRFD 1.749, ASD 1.166).

## RPC 계약 (protocol_version 2)

### 전송

- 요청 한 줄: `{"method": str, "params": object, "id": int | str}`. `params` 는 생략하면 `{}`.
- 성공: `{"id", "result"}`. 실패: `{"id", "error": str, "error_code": str}` + `ENGINE_ERROR` 와 `INTERNAL_ERROR` 는 `error_type` · `traceback`.
  - `error` 는 지금처럼 **문자열**이다(`JsonRpcProtocol` 은 `Error(response.error)` 로 reject 한다 — 그대로 동작).
  - `error_code` ∈ `PARSE_ERROR` · `INVALID_REQUEST` · `INVALID_PARAMS`(필수 인자 없음 · 모양 오류 — 서버가 낸 것) · `METHOD_NOT_FOUND` · `ENGINE_ERROR`(엔진의 ValueError 등) · `SERIALIZATION_ERROR` · `INTERNAL_ERROR`.
  - 줄을 읽지 못했거나 객체가 아니면 `id` 는 줄에서 찾은 값 또는 `null`.
- 결과의 NaN · ±Inf 는 어디서나 `null`. 출력은 ASCII JSON(비 ASCII 는 `\u` 이스케이프), 줄 끝은 `\n`.
- 같은 요청 → 같은 바이트(해시 시드 무관).
- stdout 에는 응답만. 엔진 출력은 stderr — 호스트는 stderr 를 읽어 로그로 버려야 한다(파이프가 가득 차면 서버가 막힌다).
- 「서버 기본값 없음」: 빠진 필수 인자는 `INVALID_PARAMS`. 「선택(엔진 기본 x)」은 서버가 값을 넣지 않고 엔진 함수의 기본값이 쓰인다는 뜻이다. 키워드 메서드에서 엔진이 받지 않는 인자는 버리지 않고 결과에 `ignored_params` + `warnings` 한 줄로 드러낸다(결과가 list 인 `steel_grades` 는 오류).
- **알림 키(2차).** 엔진의 `warnings` · `assumptions` · `scope_notes` · `not_evaluated` · `not_evaluated_relevant` · `not_checked` · `diagnostics` 는 중첩된 곳까지 바꾸지 않고 그대로 간다(엔진이 새 알림 키를 더해도 dict 를 통째로 넘기므로 따라간다). 서버의 알림은 엔진 목록 **끝에 덧붙기만** 한다. 서버 알림의 자리: 값을 바꿨거나 사용자가 볼 일이 있으면 `warnings`(입력 무시 `ignored_params`, 폐기 길이, BC 없는 dsm, 진동 · 서명곡선에서 쓰지 않은 스프링, 기본 패스너 값, 범위 밖), 값을 바꾸지 않은 참고는 `assumptions`(자동으로 고른 m_all 의 규칙, 시험 강성을 쓰라는 안내, RP17-2 곡선의 COV, 파일 읽기의 loader.m 과 같은 채움 · 변환). 엔진이 목록이 아닌 값을 둔 키는 덮지 않고 `server_<키>` 에 둔다.

### 해석 모델(CufsmModel) 인자 — analyze · fcfsm · vibration · classify(model) · save_project(model) 공통

| 이름 | 단위 · 모양 | 필수 | 기본 | 비고 |
|---|---|---|---|---|
| `prop` | (nmats, ≥6) `[matnum Ex Ey vx vy G]` ksi. 7 열 = 질량밀도 kip·s²/in⁴(진동) | 필수 | — | |
| `node` | (n, 8) `[# x z dofx dofz dofy dofrot stress]` in · ksi | 필수 | — | |
| `elem` | (m, 5) `[# nodei nodej t matnum]` in | 필수 | — | |
| `lengths` | in | 필수 | — | |
| `BC` | 'S-S' 'C-C' 'S-C' 'C-S' 'C-F' 'F-C' 'C-G' 'G-C' | **필수(새)** | — | 전: 빠지면 모델 로더가 S-S |
| `m_all` | 길이마다 항 목록 `[[1],[1,2,3],…]` 또는 `"auto"`(analyze · fcfsm 만) | 필수 | — | 아래 「m_all」 |
| `springs` | (k, 10) | 선택 | 없음 | |
| `constraints` | (k, 5) | 선택 | 없음 | |
| `GBTcon` | `{glob, dist, local, other, ospace, orth, couple, norm}` | 선택 | 구속 꺼짐, CUFSM 설정(ospace 1 · orth 2 · couple 1 · norm 1) | |
| `neigs` | 정수 ≥ 1 | 선택 | 10 | |

그 밖의 키(호스트의 `loadCase`, `sectionType` …)는 읽지 않는다(보고하지 않음 — 호스트 모델 객체를 통째로 보내는 것을 허용).

**m_all**: 명시 목록은 그대로 엔진에 간다(엔진은 msort 로 0 · 중복만 지움, 정리했으면 `LONGITUDINAL_TERMS_SORTED` info). `"auto"` → S-S: 길이마다 `[1]`, 그 밖: `engine.helpers.m_recommend` 권장 항(서명곡선 하나 또는 세 개를 푸므로 수 초 걸린다). 빠지거나 `[]` 이면 `INVALID_PARAMS`. 쓴 규칙은 `m_all_selection = {source: 'caller'|'auto'|'m_recommend', BC, rule?, warnings, + m_recommend 일 때 m_recommend_details 의 키 전부(Lcrl, Lcrd, method, minima, extra_lengths, cfsm_check)}`. (3차) m_recommend 로 고른 항이면 서버가 그 dict 를 `stripmain(..., half_wavelengths=…)` 에 넘겨 항 부족 진단이 서명곡선을 다시 풀지 않는다(서명곡선은 m_recommend 의 한 번뿐). 극소가 없는 곡선은 `method: 'no_minimum'`, `Lcrl`/`Lcrd` 가 `null`, 항 1..7 과 경고로 온다(오류 아님).

### 메서드 표

| 메서드 | 엔진 함수 | 인자 (단위; 필수/선택; 기본) | 결과 | 이번 묶음의 변화 |
|---|---|---|---|---|
| `ping` | — | — | `"pong"` | — |
| `selftest` | (import 검사) | — | `{ok, python, python_ok, import_errors, protocol_version: 2, methods}` | **새 메서드** |
| `analyze` | `engine.fsm_solver.stripmain` | 모델 인자(위) | `{curve: [[L, lf1, …]], shapes, n_lengths, m_all, diagnostics, success, lengths, length_indices, lengths_requested, discarded_lengths, warnings, assumptions, m_all_selection}` | **새 키** lengths · length_indices · lengths_requested · discarded_lengths · warnings · assumptions(2차: 자동 항의 규칙 — 명시 목록이면 `[]`) · m_all_selection. (3차) `diagnostics` 에 엔진의 새 코드 `CFSM_GLOBAL_ONLY` · `CFSM_MODEL_NOT_SUPPORTED`(cFSM 구속 해석의 주의, F1/F3)가 올 수 있다. ILL_CONDITIONED 폐기 경계는 엔진에서 0.25 → 0.1(F1 V1). `m_all:"auto"`. m_all 없으면 오류(auto 안내). BC 필수. ILL_CONDITIONED 폐기 길이는 곡선에서 빠지고 성공(진단은 `discarded: true` 로 남음) |
| `m_recommend` | `engine.helpers.m_recommend_details` | `prop`, `node`(응력 포함), `elem`, `lengths` in — 모두 필수 | `{m_all: [[…]], Lcrl, Lcrd (in 또는 null), method: 'signature'|'cfsm'|'signature_fallback'|'no_minimum', minima, extra_lengths, cfsm_check, warnings}` | **새 메서드**. (3차) 극소가 없으면 오류가 아니라 `no_minimum` + 경고(항 1..7). 고전 cFSM 이 맞지 않는 모델(둥근 모서리 등)은 cFSM 분기를 건너뛴다 |
| `get_properties` | `engine.properties.grosprop` | `node`, `elem` 필수 | grosprop dict (A, xcg, zcg, Ixx, Izz, Ixz, thetap, I11, I22, Sx, Sz, Sx_cl, Sz_cl, rx, rz …) | — |
| `generate_section` | `engine.template.generate_section` | `section_type` 필수, `params` 객체 필수(템플릿 치수 in, qlip deg …) | `{node, elem}` + custom · custom_builder 는 `validation`, `warnings` | 결과 키 전부(**validation · warnings**). section_type · params 기본값 제거 |
| `stresgen` | `engine.stress.stresgen` | `node` 필수, `props`(A, xcg, zcg, Ixx, Izz, Ixz, thetap, I11, I22) 필수, `loads` 선택 `{P kips, Mxx, Mzz, M11, M22 kip-in, unsymm}` | `{node}` | 빠진 하중 성분 = 0, unsymm = 0 (서버가 정하는 값 — 「하중 없음」) |
| `yieldMP` | `engine.stress.yieldMP` (+grosprop) | `node`, `elem`, `fy` ksi 필수, `unsymm` 선택(엔진 0) | `{Py, Mxx_y, Mzz_y, M11_y, M22_y}` | **fy 필수**(전 35.53), unsymm 전달 |
| `firstyield` | `engine.helpers.firstyield` | 같음 | 같음 | **fy 필수**, unsymm 전달 |
| `classify` | `cfsm.classify.classify` | `model`(모델 인자, m_all 은 목록) 필수, `shapes` 필수, `GBTcon` 선택(model 의 것보다 먼저), `lengths` · `m_all` 선택(model 의 것을 덮음 — analyze 결과의 것을 넘김) | `[[[%G,%D,%L,%O] × nmodes] × nlengths]`, 분류 못 한 값은 `null` | 최상위 GBTcon 사용, lengths/m_all 덮어쓰기, shapes 수 ≠ 길이 수 → 오류 |
| `classify_detailed` | 같음 + `CfsmClassification.summary()` | classify 와 같음 | `{classification, status: 'ok'|'partial'|'unsupported', supported, code, message, settings, diagnostics}` | **새 메서드** |
| `fcfsm` | `fcfsm.solver.stripmain_fcfsm` | 모델 인자 (`m_all` 은 목록 또는 `"auto"`) | `{curve, shapes, classification, method, is_fcfsm: false, classification_status, warnings, diagnostics, success, n_lengths, m_all_selection[, assumptions]}` | 엔진 키 전부(method · is_fcfsm · warnings · classification_status · shapes), auto(자동 항이면 `assumptions` 에 규칙) |
| `vibration` | `vibration.solver.stripmain_vib` | 모델 인자(m_all 목록만), `rho` kip·s²/in⁴ 선택(없으면 prop 7 열, 그것도 없으면 엔진 강재 7.345e-7 + 경고), springs · constraints · neigs 전달 | `{frequencies: [[Hz…]…], shapes, diagnostics, success, rho_used: {matnum: rho}, units: {frequency: 'Hz', rho: 'kip*s^2/in^4'}}` | springs · constraints · neigs 전달(**새**), rho_used · units · shapes, rho ≤ 0 오류 |
| `plastic` | `plastic.pmm_plastic.pmm_plastic` | `node`, `elem`, `fy` ksi 필수; `n_theta`(36) · `n_na`(21) · `n_fibers_per_elem`(엔진 자동) · `n_thick`(10) 선택 | `{P, M11, M22 (정규화, (n_na, n_theta) 행 우선, 정의 안 되면 null), P_raw kips, M11_raw, M22_raw kip-in, Py, M11_y, M22_y, Mxx_y, Mzz_y, thetap, fy, n_theta, n_na, n_thick, normalized, warnings}` | **fy 필수**, 새 키 전부, 격자 인자 |
| `load_mat` | `fileio.mat_loader.read_mat_file` | `filepath` 필수 | 모델 dict + `file_info: {format: 'cufsm-mat', warnings, assumptions, ignored}` | 옛 형식 변환, 기본값 제거, file_info. 2차: 없는 cFSM 설정은 loader.m:134-146 값(ospace 1 · orth 2 · couple 1 · norm 1, `CUFSM_LOADER_GBT_DEFAULTS`)을 명시적으로 채우고 `assumptions` 에 적음. loader.m 과 같은 채움(BC → S-S, m_all → [1])과 변환은 `assumptions`, 해야 할 일(길이 없음, 비 S-S 인데 m_all 없음, kflag=0 스프링)만 `warnings` |
| `save_project` | `fileio.project_io.save_project` | `model`(모델 인자; m_all 은 목록이거나 생략 — `"auto"` 불가), `filepath` 필수 | `"saved"` | BC 필수, NaN 거절, 원자적 쓰기 |
| `load_project` | `fileio.project_io.read_project` | `filepath` 필수 | 모델 dict + `file_info: {format, version, warnings, assumptions}` | 형식 · 주 버전 검사, file_info. 2차: 머리말 없는 파일 안내는 `assumptions` |
| `doubler` | `engine.helpers.doubler` | `node`, `elem` 필수 | `{node, elem}` | — |
| `signature_ss` | `engine.helpers.signature_ss` | `prop`, `node`, `elem` 필수; `neigs`(10) · `GBTcon` 선택. 모델 dict 를 보내도 된다(lengths · m_all · BC 는 쓰지 않음; springs · constraints 를 주면 경고) | `{curve, shapes, lengths, length_indices, lengths_requested, discarded_lengths, n_lengths, diagnostics, warnings, assumptions, success}` | 동작함(R8-24), diagnostics · shapes, 폐기 길이 규칙 |
| `dsm` | `engine.dsm.extract_dsm_values` | `node`, `elem`, `curve`, `fy` ksi 필수; `load_type` 'P'|'Mxx'|'Mzz'(엔진 'P'); `classifications`(= `mode_classifications`); `KxLx`, `KyLy`, `KtLt`, `Lb` in; `Cb`(엔진 1.0); `section_type`(KL · Lb 를 주면 **필수**, 아니면 엔진 'C'); `BC`(**새**, 보내야 함); `unsymm`(**새**) | 엔진 dict 그대로(crl, crd, cre, P_y, LF_*, classification_method, *_detected, *_absence_verified, single_minimum, boundary_minimum, signature_curve, reference_stress_consistent, warnings …). BC 를 안 주면 `warnings` 에 서버 문장. (3차, F5 V2) 새 결과 키 `crl_floor`, `crd_floor`, `reference_is_restrained`, `P_ref_restrained`, `single_minimum_bound_meaning`, `classification_note`, `assumptions`, `scope_notes` — 그대로 온다 | **fy 필수**, BC · unsymm 전달, section_type 조건부 필수. 엔진 인자는 3차에도 같다(새 인자 없음) |
| `cutwp` | `engine.cutwp.cutwp_prop` | `node`, `elem` 필수 | cutwp dict (J, Cw, Xs, Zs, xo, zo, ro …, `nan_substituted`) | — |
| `energy_recovery` | `engine.helpers.energy_recovery` | `node`, `elem`, `prop`, `mode`(DOF 벡터), `length` in 필수; `BC`(엔진 'S-S'), `m_a`(엔진 [1]) 선택 | `{energy: [[membrane, bending]…], columns, n_elements}` | m_a · BC 를 줄 때만 넘김(값은 같음) |
| `aisi_design` | `design.aisi_s100.design_member` | dict 그대로(엔진의 키 — F4 기록). (3차, F4 V2·V3) `span_type`, `moment_sign`, `dsm.M_sign`, `dsm` 의 `P_`/`M_` 접두 진단 키 | 엔진 dict(`warnings` · `assumptions` · `scope_notes` · `not_evaluated` …), `spec_sections` 정렬, `report` 를 정렬된 조항으로 다시 씀 | spec_sections 정렬 · 보고서 결정성. F4 가 원천에서 `sorted(set())` 로 바꿔 서버 정렬은 이제 아무것도 바꾸지 않는다(남겨 둠) |
| `aisi_guide` | `design.aisi_s100.design_guide` | dict 그대로 | 엔진 dict | — |
| `steel_grades` | `design.steel_grades.list_grades` | `include_restricted` 선택(False) | 강종 list | **include_restricted**, 모르는 인자 오류 |
| `web_crippling` | `design.shear.web_crippling` | `h`, `t`, `R`, `N` in, `Fy` ksi 필수; `theta`(90), `support`('EOF'), `fastened`('fastened'), `section_type`('C'), `section_family`, `flange_condition`, `Lo`, `edge_distance`, `n_webs`, `web_config`('single'), `bearing_case`, `support_fastener_spacing`, **`d`**, **`web_holes`**(False) 선택 | 엔진 dict (+ `ignored_params`). (3차, F5 V2) `h3_applies`, `h3_equation`, `h3_evaluated`, `row_used`, `scope_notes` | 서버 기본값 제거, d · web_holes |
| `analyze_loads` | `design.loads.required_strength.analyze_loads` | `member_app`, `span_type`, `span_ft` ft, `loads` plf 필수; `design_method`('LRFD'), `spacing_ft`(5.0), `laps`, `deck`, `section`, `supports`, `spans_ft`, `laps_per_support`, `E`, **`pattern_loading`**(True), **`brace_points_ft`** ft, **`i621_conditions_confirmed`**, **`insulation_in`** in, **`lr_reduced`**(False — True 일 때만 Lr 부분재하, 3차), **`I_span_in4`** in⁴ 경간별(3차) 선택 | 엔진 dict (+ `ignored_params`). (3차, F7 V3) ASD 조합 이름이 ASCE 7-10 번호, 양력 반력에 `combo_R_uplift` · `pattern_R_uplift` | 서버 기본값 제거, 새 인자 6 |
| `calc_deck_stiffness` | `design.loads.bracing.calc_rotational_stiffness` + `lateral_stiffness_detail` | `t_panel`, `t_purlin` in(시험값 둘 다 주면 불필요); `fastener_spacing` in(엔진 12), `flange_width` in(엔진 2.5), `k_per_fastener`, `E`(29500), `b_fastener`, `c_fastener`, `Fss_kip`, `D_screw_in`, `Fu1_ksi`, `Fu2_ksi`, `kphi_override` kip-in/rad/in(> 0), `kx_override` kip/in/in(> 0) 선택 | `{kphi, kx, kphi_method, kx_method, kx_detail, units, warnings, assumptions, warning}` | 방법명, kx_detail · units · warnings, 반올림 제거, override ≤ 0 오류, t 기본값 제거. 2차: 시험값 안내 · COV 는 `assumptions`, 기본 패스너 값 · 범위 밖 · kφ=0 은 `warnings`. 옛 `warning` 키는 시험값 안내 문장(둘 다 주면 null) |
| `lap_connection` | `design.lap_connection.design_lap_connection` | dict 그대로 (Se, Sf, Mnd, Vn, design_method, end_distance … F6 기록) | 엔진 dict (`force_model`, `verdict` …) | — |
| `check_lap_length` | `design.lap_connection.check_lap_length` | `d`, `lap_left`, `lap_right` in 필수 | `{ok: true|false|null, …}` | 기본값(d 8, 0) 제거 |
| `shear_lag` | `design.special_topics.shear_lag` | 엔진 서명(Ag, An_net, x_bar, L_conn, Fu, Fy 필수; design_method, Usl, connection_case, d, s, connection_type, b1, b2, bf, bw 선택) | 엔진 dict | 모르는 인자 → ignored_params (전 TypeError) |
| `block_shear` | `…block_shear` | Agv, Anv, Ant, Fy, Fu 필수; design_method, Ubs, phi_factor, omega_factor, connection_type 선택 | 엔진 dict | 같음 |
| `cold_work` | `…cold_work_strength` | Fyv, Fuv, R, t 필수; n_corners, corner_angle, A_corners, A_flange, corners_per_flange, A_total, buckling_precondition 선택 | 엔진 dict | 같음 |
| `flange_curling` | `…flange_curling` | bf, t, h, f_avg 필수; E, allowable_cf, d, wf_is_half_clear_distance 선택 | 엔진 dict | 같음 |
| `design_connection` | `design.connections.design_connection` | dict 그대로 (F6 기록의 새 키 전부). (3차, F6 V3) `member_case`(`'not_tension_member'` 포함), `j6_3_not_applicable`, `j6_part2`, `member_tension`, `t_sheets`, `j45_rational` | 엔진 dict (`*_verified_*`, `governing_assumed`, `not_evaluated`, `assumptions` …) | — |

### 서버가 아직 스스로 정하는 것

| 메서드 | 서버의 결정 |
|---|---|
| `stresgen` | 빠진 하중 성분 = 0, `unsymm` = 0 |
| `analyze` · `fcfsm` | `m_all: "auto"` 의 S-S 규칙 [1] |
| `analyze` · `signature_ss` | ILL_CONDITIONED 폐기 길이를 곡선에서 뺌, `success` 를 다시 정함 |
| `vibration` | `rho` 를 prop 7 열에 넣음(엔진 계약) |
| `plastic` | 격자를 행 우선으로 펼침 |
| `dsm` | KL · Lb 가 있으면 section_type 필수, BC 가 없으면 경고 한 줄 |
| `aisi_design` | spec_sections 정렬, report 다시 만듦 |
| `calc_deck_stiffness` | 두 엔진 함수를 묶고 시험값(override)을 고름, 경고 문장 |
| 모든 키워드 메서드 | 모르는 인자를 `ignored_params` 로 |

## 검증 뒤 고친 것 (W1 2차 — V1 · V3)

| 출처 | 처리 | 무엇을 바꿨나 | 회귀 시험 |
|---|---|---|---|
| V1-02 | 고침 | `fileio/mat_loader.py`: `CUFSM_LOADER_GBT_DEFAULTS = {ospace 1, orth 2, couple 1, norm 1}`(loader.m:134-146 리터럴)를 두고, 파일에 없는 설정만 그 값으로 채운다(`GBTConfig` 의 기본이 바뀌어도 .mat 의 뜻이 따라 바뀌지 않게). 있는 값은 그대로(ospace 번호는 MATLAB 그대로 넘어간다 — F3 이 couple=2 의 MATLAB 번호로 되돌리면 읽은 파일도 MATLAB 뜻). 채운 설정 · 옛 basis 변환은 `file_info.assumptions`. 1차 수정의 실제 결과도 orth 2 · norm 1 이었으나(`GBTConfig.from_dict` 기본에 기댐) 명시하지 않았다. 함께 찾은 결함: 길이 하나 · 항 하나인 m_all 이 simplify_cells 로 숫자 하나가 되면 TypeError → 고침 | `test_V1_02_mat_cfsm_settings_follow_cufsm_loader` (없음 · 벡터만 · 일부 · 전부 · basis 1/2/3, 기대값은 loader.m 의 표) |
| 조정자 3 | 고침 | `server.py:_add_notes` — 서버 알림을 엔진 목록 끝에 덧붙이기만 한다. 자동 항(S-S · m_recommend)의 규칙, 시험 강성 안내, COV 는 `assumptions` 로 옮김. `analyze` · `signature_ss` 는 언제나 `assumptions` 키를 낸다. 파일 읽기의 loader.m 과 같은 처리도 `assumptions`(위 계약표) | `test_W1_notices_pass_through_unchanged` (aisi_design combined · design_connection · lap_connection · analyze_loads · web_crippling · dsm 결과의 모든 알림 키 경로를 중첩까지 엔진 직접 호출과 비교, 서버 알림은 끝에만), `test_W1_calc_deck_stiffness_reports_method_and_kx_detail`, `test_F1_m_all_missing_auto_and_explicit` |
| V3 T13 | 확인 (1차에 고쳐져 있었음) | V3 가 본 `server.py:275-289` 는 1차 이전 코드다. 지금 `analyze_loads` 는 서명 검사 어댑터(`_call_kw`)라 엔진 인자를 모두 넘긴다 | `test_V3_T13_analyze_loads_new_arguments_reach_engine` — 네 인자 각각: 결과가 바뀌고, 같은 인자의 직접 호출과 같고, `ignored_params` 없음 |
| 조정자 2 | 3차에서 고침(아래) | F1 (`stripmain` 의 `Lcrl`/`Lcrd`), F4 · F5 (`assumptions` · `scope_notes`), F6 (J6.2/J6.3 해당 없음 선언), F7 (`lr_reduced`, 경간별 강성)이 아직 기록에 「V… 검증 뒤 고친 것」을 쓰지 않았다. 서버 쪽: dict 메서드(aisi_design · design_connection · lap_connection)와 서명 검사 메서드(analyze_loads · dsm 의 선택 인자 목록 제외)는 새 인자 · 새 결과 키를 그대로 넘긴다. `dsm` 은 선택 인자를 이름으로 고르므로(`_m_dsm`) F5 가 인자를 더하면 서버에 한 줄을 더해야 한다. `m_all:"auto"` 의 m_recommend 한 번 계산은 F1 의 새 인자가 들어온 뒤 `_resolve_m_all` 의 Lcrl/Lcrd 를 `stripmain` 에 넘겨 닫는다 | (그때) |

시험 중 본 것: `test_F1_ill_conditioned_lengths_removed_analysis_succeeds` 가 1차의 리터럴(1e4 · 5e4 폐기)을 기대했는데, F1 의 검증 뒤 수정으로 L=1e4 가 더는 폐기되지 않았다. 어느 길이를 폐기하는지는 엔진의 판정이므로 시험은 이제 같은 모델의 직접 `stripmain` 진단에서 폐기 색인을 읽고(길이 목록에 1e5 를 더해 적어도 하나는 폐기되게), 서버가 정확히 그 길이를 빼고 나머지 곡선을 그대로 주는지 본다.

2차 게이트(다른 담당이 엔진을 고치는 중): `run_all.py` → `Ran 352 tests in 50.332s` / `FAILED (failures=15)`. 13 건은 F4 · F5 영역(`test_review_1122_member`, `test_review_1122_dsm_shear`, `test_design_verification`, `test_regression_0926`)이다. 내 것 2 건(`test_W1_design_methods_match_engine`, `test_W1_notices_pass_through_unchanged`)은 판 차이였다. 공유 서버가 시험 프로세스보다 늦게 엔진을 읽었고, 그 사이 F5 가 `web_crippling` 에 `scope_notes` · `row_used` · `h3_*` 를, `aisi_design` 에 `scope_notes` 를 더했다. 서버 응답에는 새 키가 이미 실려 있었다(엔진 결과를 그대로 넘긴다는 뜻). 이 파일만 다시 돌리면 21 개 모두 통과(7.9 s). `ruff check python test` 의 남은 1 건 `E741 python\engine\fsm_solver.py:563` 은 F1 이 고치는 중인 파일이다.

## 엔진 검증 뒤 따라간 것 (W1 3차)

| 출처 | 처리 | 무엇을 바꿨나 | 회귀 시험 |
|---|---|---|---|
| F1 V1 (`stripmain(half_wavelengths=)`) | 고침 | `_resolve_m_all` 이 m_recommend_details 결과를 내부 키로 넘기고 `_m_analyze` 가 `stripmain(..., half_wavelengths=det)` 로 부른다(응답에서는 뺀다). `m_all_selection` 에 m_recommend 의 키 전부(`extra_lengths` · `cfsm_check` 포함). `stripmain_fcfsm` 은 이 인자가 없어 넘기지 않는다 | `test_F1_V1_auto_terms_solve_the_signature_curve_once` (서명곡선 풀이 횟수 = m_recommend 혼자일 때와 같음, stripmain 이 받은 dict 의 Lcrl = 응답의 Lcrl) |
| F1 V1 (`no_minimum`) | 확인 | 서버 변경 없음 — Lcrl 이 null 이어도 규칙 문장 · auto 해석이 동작 | `test_F1_V1_no_minimum_recommendation_is_reported_not_raised` (등변 앵글 압축: 항 1..7, 경고가 analyze `warnings` 로) |
| F1 · F3 (`CFSM_GLOBAL_ONLY`, `CFSM_MODEL_NOT_SUPPORTED`, `constrained_selection_notes`) | 확인 | F1 의 `stripmain` 이 진단에 붙이므로 `analyze.diagnostics` 로 그대로 온다. `constrained_selection_notes` 를 서버가 따로 부르지 않는다 | (엔진 시험) |
| F4 V2 · V3 | 확인 | dict 메서드 — 새 입력 · 결과 키가 그대로 | `test_F4_F5_F6_new_inputs_and_result_keys_pass_through` |
| F5 V2 | 확인 | `extract_dsm_values` 에 새 **인자**는 없다(서버의 이름 목록 변경 불필요). 새 결과 키 · `web_crippling` 새 키는 그대로 | 같은 시험, `test_W1_notices_pass_through_unchanged` |
| F6 V3 | 확인 | dict 메서드 | 같은 시험(`member_case='not_tension_member'`, `j6_3_not_applicable`) |
| F7 V3 | 확인 | 서명 검사 어댑터라 `lr_reduced` · `I_span_in4` 가 그대로 넘어간다 | `test_V3_T13_analyze_loads_new_arguments_reach_engine` (두 인자 각각 결과를 바꾸고 직접 호출과 같음) |
| 서명 전수 점검 | 고침(시험) | 손으로 짠 어댑터 18 개 엔진 함수의 서명 = 서버가 넘기는 인자 + 일부러 넘기지 않는 인자(`dsm` 의 `mode_shapes` · `classify_fn`). 엔진이 인자를 더하면 이 시험이 빨개진다 | `test_W1_hand_written_adapters_cover_every_engine_argument` |

3차 게이트: 이 파일 `25 passed in 9.31s`. `run_all.py` → `Ran 375 tests in 57.705s` / `FAILED (failures=2)`. 실패 2 건은 W3 의 TypeScript/JS 를 읽는 계약 시험 `test_design_verification.test_webview_design_prepare_contract` · `test_purlin_uplift_r_and_governing_wiring_contract` 다. `ruff check python test` → `All checks passed!`

1 · 2 차에 리터럴로 잠갔다가 바뀐 엔진 값은 2 차에서 이미 직접 호출 기준으로 바꿨다(ILL_CONDITIONED 폐기 길이). 3 차에서 더 바뀐 시험값은 없었다.

## 후속 — 다른 곳이 따라와야 하는 것

### W3 (호스트 `src/webview/StcfsdPanel.ts` · `src/bridge/`)

1. **analyze 의 m_all.** 기본 `lengths.map(() => [1])`(`:192`, `:1076`, `:2123`, 그리고 `webview/js/app.js:2423`)를 BC 에 따라: 사용자가 항을 정하지 않았으면 `m_all: "auto"` 를 보낸다(S-S 는 서버가 [1]). 응답의 `m_all`(실제로 쓴 항)과 `m_all_selection` 을 결과에 보관 · 표시. m_all 을 빠뜨리면 이제 오류다.
2. **폐기 길이.** `result.lengths` · `result.length_indices` 가 곡선 · shapes · m_all 의 실제 길이다. `_lastAnalysisResult` 의 곡선 색인을 `this._model.lengths` 와 맞추던 곳(`get_energy_recovery` 의 length_index, 곡선 표시, `_classifyAnalysis`)은 `result.lengths` 를 쓴다. `classify` 는 `{model, shapes, lengths: result.lengths, m_all: result.m_all}` 로 부른다 — 안 그러면 폐기 길이가 있을 때 `INVALID_PARAMS`(지금 `_classifyAnalysis` 는 오류를 삼키고 휴리스틱으로 감).
3. **warnings 표시.** `_requireSuccessfulAnalysis`(`:676-684`)는 실패만 본다. `result.warnings`(항 부족 · 폐기 길이 · m_recommend 경고)를 해석 탭과 MCP `run_analysis` 응답에 싣는다. `diagnostics` 의 `discarded: true` error 는 실패가 아니다. (2차) 모든 결과의 `assumptions` · `scope_notes` 도 `warnings` 와 따로 보인다 — `warnings` 는 사용자가 볼 일, `assumptions` 는 참고.
4. **classify → classify_detailed.** `status` · `code` · `message` 를 보이고, `null` 행은 "cFSM 분류 불가(둥근 모서리 등)" 로(`app.js:2982-3000` 의 `|| 0` 제거).
5. **dsm 호출 전부**(`:417-427`, `:742-748`, `:1212`, `:1247-1253`, `:1477-1485`, `:1839-1852`)에 `BC: model.BC` 를 넣는다(없으면 결과 경고). `KxLx`/`Lb` 를 보내는 `get_dsm` 은 `section_type` 을 모델 형식으로 채운다(R8-05 — 없으면 이제 오류). `fy` 는 언제나 해석 fy.
6. **vibration** (`:1363-1370`, `_runVibration :2476`): `rho: 1.0` 을 보내지 않는다(없으면 엔진 강재 + 경고). 결과 `rho_used` · `units` · `diagnostics` 경고 표시. 스프링 · 구속이 이제 진동에 들어간다.
7. **energy_recovery** (`:2400-2407`): 다항 해석의 모드이면 `m_a: result.m_all[i]` 를 넘긴다(엔진 기본 [1] 이면 DOF 수가 맞지 않음).
8. **design_purlin** (`:1822`)과 `generate_report` (`:1705`)는 MCP 옵션 전체를 `analyze_loads` 에 넘긴다 — 이제 `Fy` 같은 남는 키는 `ignored_params` · `warnings` 로 돌아온다(오류 아님). 엔진 인자만 골라 보낸다.
9. **generate_section** 결과의 `validation` · `warnings` 를 화면 · MCP 에 보인다(`_generateTemplate`, `generate_template` case).
10. **calc_deck_stiffness**: kφ · kx 가 반올림되지 않는다. `kx_detail` · `warnings` 표시.
11. **시작 점검**: ping 대신(또는 다음에) `selftest` 를 불러 `ok=false` 면 `python_ok` · `import_errors` 를 안내(R8-21).
12. **stderr**: 서버는 엔진 출력을 stderr 로 보낸다 — `PythonBridge` 가 stderr 를 계속 읽어 비워야 한다(지금처럼 `on('data')` 로 로그).
13. `error_code` 를 쓸 수 있다(`INVALID_PARAMS` = 호출자가 고칠 입력).

### W2 (MCP `src/mcp/server.ts`)

- `run_analysis` / `set_lengths` / `set_boundary_condition` 설명: 비 S-S 는 자동 항(`"auto"` → m_recommend), 응답 `warnings` · `discarded_lengths`. 필요하면 `m_recommend` 를 도구로(인자 prop · node · elem · lengths 는 패널 모델이 채움).
- `get_dsm_values`: `fy` 기본 35.53 제거(서버가 필수로 받음 — 패널이 해석 fy 로 채우게), `section_type` 설명 "KL · Lb 를 주면 필수".
- `get_web_crippling` (`:1033-1048`): `Fy || 35.53` · `theta || 90` · `support || 'EOF'` · `fastened` · `section_type || 'C'` · `web_config` 기본값 제거, `d` · `web_holes` 추가.
- `analyze_loads` (`:1087-1093`): `loads || {}` · `design_method || 'LRFD'` · `spacing_ft || 5.0` 제거(엔진 기본이 같으나 지어내지 않음), `pattern_loading` · `brace_points_ft` · `i621_conditions_confirmed` · `insulation_in` · `lr_reduced`(3차) · `I_span_in4`(3차) 추가. `design_purlin` 스키마에도 `lr_reduced`.
- `calc_deck_stiffness` (`:1109-1114`): `fastener_spacing ?? 12` · `flange_width ?? 2.5` 제거(엔진 기본), 엔진 인자(`Fss_kip`, `D_screw_in`, `Fu1_ksi`, `Fu2_ksi`, `E`, `k_per_fastener`, `b_fastener`, `c_fastener`) 추가, 출력 `kx_detail` · `warnings` 설명.
- `steel_grades`: `include_restricted` 인자.
- `check_lap_length`: `d` 필수, `ok` 는 `null` 일 수 있음.
- `classify_modes`: 패널이 `classify_detailed` 로 바꾸면 status 설명.
- `run_vibration`: `rho` 기본 1.0 제거, 단위 kip·s²/in⁴.
- `run_plastic_surface`: 응답 `normalized` · `warnings`.

### 엔진 담당(다음 묶음)

- **F1 `engine/fsm_solver.py:_longitudinal_term_diagnostics`**: BC ≠ S-S 이면 항이 충분해도 `characteristic_half_wavelengths` 를 다시 푼다. 그래서 `m_all:"auto"` 해석은 m_recommend 를 두 번 푼다(이 PC 부하 상태에서 립 C 압축 L=30 한 길이: m_recommend 13 s + stripmain 17 s 중 13 s 가 같은 계산). Lcrl · Lcrd 를 인자로 받거나 캐시하면 절반이 된다. → **3차: F1 이 `half_wavelengths` 인자와 캐시를 넣었고 서버가 넘긴다(닫힘).**
- **F4 `design/aisi_s100.py:1048, 1788, 2211, 2380`**: `list(set(...))` → `sorted(set(...))`. 그러면 서버의 정렬 · 보고서 재생성은 아무것도 바꾸지 않게 된다(남겨 두어도 해 없음). → **3차: F4 가 고침(닫힘).**
- **F2 `models/data.py:CufsmModel.from_dict`**: `BC` 가 없으면 조용히 'S-S'. 서버는 이제 BC 를 필수로 검사하지만 다른 호출자를 위해 엔진도 거절하는 편이 낫다. `SafeJsonEncoder` 는 서버가 더 쓰지 않는다(`np.bool_` 미지원 — `to_jsonable` 로 대신).

## 사용자 결정 필요

1. **m_all 이 빠졌을 때(결정함, 확인 요청).** 서버는 지어내지 않고 오류를 낸다. 자동 항은 명시 요청 `m_all: "auto"` 로만(S-S → [1], 그 밖 → m_recommend). 다른 선택지: (a) 빠지면 auto 로 간주(편하지만 「빠진 입력을 채우지 않는다」에 어긋남), (b) 지금처럼 오류. 호스트는 이미 늘 m_all 을 보내므로 (b) 로 깨지는 경로는 없다.
2. **모르는 인자의 처리.** 키워드 메서드는 엔진이 받지 않는 인자를 거절하지 않고 `ignored_params` + `warnings` 로 드러낸다(호스트가 MCP 옵션 전체를 넘기는 곳이 있어서 — W3 후속 8). 오타가 경고로만 끝나는 것을 막으려면 `INVALID_PARAMS` 로 거절하도록 바꿀 수 있다(그때는 W3 후속 8 이 먼저).
3. **해석 모델의 BC 필수.** 전에는 빠지면 S-S 였다. 저장 파일(.cufsm) 도 BC 가 없으면 이제 읽지 않는다(이 프로그램이 쓴 파일에는 늘 있다). CUFSM 3 의 .mat 는 BC 가 없어 S-S + 경고로 읽는다(그 판은 S-S 만 풀었다).

이미 정한 결정: **ILL_CONDITIONED 길이**(F1 사용자 결정 1 의 (b)) — 그 길이만 곡선에서 빼고 해석은 성공, 진단은 `discarded: true` 로 남기고 `warnings` · `discarded_lengths` 에 보인다. 다른 실패(NO_FREE_DOF 등)는 그대로 실패, 전부 폐기되면 실패. 경계값(1e-2 · 0.25)은 바꾸지 않았다.

## 못 한 것

- 서버가 엔진 출력을 stderr 로 보내지만, 호스트가 stderr 파이프를 읽지 않으면 막힐 수 있다 — `PythonBridge.ts` 는 W3 의 파일이라 확인만 했다(지금 `on('data')` 로 읽음).
- `dsm` 의 `mode_shapes` · `classify_fn` 인자는 RPC 로 넘길 수 없는 호출 가능 객체라 노출하지 않았다(분류 결과를 `classifications` 로 넘기는 길이 같은 일을 한다).
- `.mat` 의 해석 결과(curve · shapes · clas)는 지금처럼 가져오지 않는다(경고만). `.csd`(GUI 래퍼)는 호스트만 읽는 형식이라 손대지 않았다.
- 부하가 큰 상태(다른 작업의 파이썬 프로세스 다수)에서 시간을 쟀다. 새 시험 파일은 이 상태에서 약 1 분 30 초(서버 기동 4 회 포함), 대부분이 m_recommend 두 번(엔진 중복 계산, 위 F1 후속).
