# W2 — MCP 서버 (`src/mcp/` · 번들 · parity) 수정 기록

## 요약

고침 31 · 보류 0 · 기각 0 · 사용자 결정 필요 4 · 남의 파일(W3)에 넘김 6 (아래 「후속」). R8 의 MCP 쪽 발견사항, 묶음 1 기록(F1–F7)의 MCP 후속, W1 의 W2 후속, 검증 보고서 V1 · V2 · V3 의 호출자 항목, F4 · F5 · F6 · F7 의 검증 뒤 최종 이름을 모두 반영했다. 도구 59 개의 이름은 그대로다(새 도구 없음 — 엔진 기능 가운데 길이 없는 것이 없었다. `m_recommend` 는 패널이 `m_all:"auto"` 로 쓰므로 도구가 필요 없다).

게이트 (마지막 실행):

| 게이트 | 마지막 줄 |
|---|---|
| `.venv\Scripts\python.exe test\python\run_all.py` | `Ran 375 tests in 51.143s` / `FAILED (failures=1)` — `test_design_verification.test_purlin_uplift_r_and_governing_wiring_contract` 하나. 이 시험은 `src/webview/StcfsdPanel.ts` · `webview/js/app.js`(W3 파일)를 읽는 문자열 계약이다. 내 파일과 무관(오케스트레이터 공지와 같음) |
| `.venv\Scripts\ruff.exe check python test` | `All checks passed!` |
| `npx tsc -p ./ --noEmit` | 출력 없음(종료 0) |
| `npx eslint src webview/js test/webview` | 출력 없음(종료 0) |
| `npm run test:webview` | `mcp_si_chain: PASS (23 US/SI comparisons through MCP → bridge → panel stand-in → Python)` (앞의 8 개 시험 모두 PASS) |
| `npm run build:mcp` | `webpack 5.105.4 compiled successfully` |
| `npm run check:mcp-parity` | `MCP parity OK: deployed bundle matches source definitions` (bundle `0.1.1+src.854ff58936a4`, 59 tools) |

## 발견사항별

| 번호 (출처) | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후) | 회귀 시험 |
|---|---|---|---|---|
| R8-01 (MCP 쪽) · W1 후속 | 고침 | `server.ts` `get_dsm_values`: `fy || 35.53` 삭제 — fy 는 주지 않으면 보내지 않는다(패널이 해석 기준응력을 쓰고, 다른 값은 W3 패널이 거절). 설명: "설계 Fy 를 넣지 말 것". SI 이면 fy MPa → ksi, 길이 mm → in, 출력 전체(crl … 를 family 에 따라 kN 또는 kN-m) 변환. `load_type` 필수(전: 기본 'P'), `section_type` enum + "KL · Lb 를 주면 필수, 생략하면 모델 형식" | 해석 50 ksi, fy 생략: 전 35.53 으로 추출(Mcrl 0.711×) → 해석 fy 50 (`fy_used` 50) | `mcp_si_chain.js` (본문에 fy 없음, `fy_used` 50, SI 출력 단위), `si_units_roundtrip.js` (DSM family 단위) |
| R8-04 | 고침 | `siUnits.ts` 전면 재작성: 키 이름 → 단위 표 **하나**(`MEMBER_KEYS` 를 공유하는 `SI_OUT_*`)를 중첩 dict · 배열 · 한계상태 표 · `steps[{value, unit}]` 에 재귀로 적용(`convertOutputSIDeep`). 같은 이름이 뜻이 다른 곳은 하위 표로(하중 해석의 `Mu` = kip-ft, DSM `crl` = family 단위, `design_strength` = 휨 dict 이면 kip-in, 볼트 F'nt 상호작용만 kips). US 라벨과 같이 나오는 표(`i621_check.conditions`)는 바꾸지 않고 `units:"US"` 표시. 표에 없는 수치 키는 바꾸지 않고 `si_unconverted` 로 경로를 돌려준다. 엔진 글(report · formula · warnings …)은 US 그대로 두고 `text_units:"US"` · `units_note`, report 머리줄, 각 step 에 `formula_units:"US"` | flexure `positive_region.phi_Mn` · combined `flexure_x.design_strength` · connection `limit_states[].Rn` · steps[].value: US 그대로 → SI. combined `flexure_x.design_strength` 는 첫 구현에서 kN 으로 잘못 갔던 것을 시험이 잡아 kN-m 로 고침 | `mcp_si_chain.js` (실제 엔진 출력 23 건의 모든 수치 leaf: SI/US = 1 또는 정의 계수, 미분류 키 0, 핵심 키 단위 개별 확인), `si_units_roundtrip.js` |
| R8-06 · R6-14 · F6 후속 3 | 고침 | `design_lap_connection`: `Se`, `Sf`, `Mnd`, `Mnd_single`, `Vn`, `h_web`, `design_method`, `end_distance`, `Pnvs`, `Fub`, `bolt_grade`, `units` 추가. Fy · Fu 필수, 하중·패스너 인자 필수. 설명에 사내 가정(`force_model`)을 사용자에게 알리라고, Se 없으면 NOT_CHECKED | MCP 로 랩 휨 검토 불가 → 가능(Se=1.0: DCR 2.22, pass False — 시험 입력과 같음) | `mcp_si_chain.js` (lap US/SI, `force_model` 존재) |
| R8-07 | 고침 | `save_project` · `load_project` 를 `postState` 로 — 패널 응답을 그대로 돌려준다(오류면 `isError`). 브리지 연결 실패도 `{error}` 로(전: 예외) | 없는 경로: `isError:false, "Project loaded"` → `isError:true` + ENOENT 문장 | `mcp_si_chain.js` §6 |
| R8-09 | 고침 (WAVE2 범위: 토큰 없이) | `bridge.ts`: `Access-Control-Allow-Origin` 삭제, `Origin` 머리 → 403, POST 가 `application/json` 아니면 415, `Host` 가 127.0.0.1/localhost(+포트) 아니면 403(DNS rebinding), 깨진 JSON → 400(전: `{}` 로 실행), 본문 8 MB 상한, `checkBridgeRequest` 를 순수 함수로 export | 브라우저 text/plain POST 로 `save_project` 실행 가능 → 415, 패널에 닿지 않음 | `mcp_si_chain.js` §5 (거절된 요청은 패널 대역에 기록되지 않음, CORS 머리 없음, MCP 클라이언트는 통과) |
| R8-10 · R7-25 · V3-18 · V3 T16 · F7 후속 | 고침 | `analyze_loads` · `design_purlin` 공통 `LOAD_FIELDS`: `loads.Wp`·`R`, `section{type, depth, flange_width, thickness, lip_depth, R_corner, Fy, Fu, Ixx, qlip, E}`, `E`, `supports`(P/R/F/N), `spans_ft`, `laps_per_support`(null 허용), `pattern_loading`, `brace_points_ft`, `i621_conditions_confirmed`(사용자 확인 — AI 가 스스로 켜지 말 것), `insulation_in`, `lr_reduced`, `I_span_in4`, deck 확장 키(`Fss_kip`, `D_screw_in`, `Fu_panel_ksi`, `b_fastener_in`, `c_fastener_in`, `R_tested_uplift`, `R_tested_gravity`). `span_type` 을 정규식(`simple|cantilever|cont-<n>|cont-n`)으로, 랩 규약(left_ft = 지점 중심 → 왼쪽 랩 끝) 설명. `loads || {}` · `design_method || 'LRFD'` · `spacing_ft || 5.0` 삭제 | Wp 가 브리지 본문에서 지워짐 → 전달; section 없음 → 전달 가능 | `mcp_si_chain.js` (본문 일치, 인자 이름 = `analyze_loads` 서명, cont-3 US/SI) |
| R8-12 | 고침 | `siUnits.toUS`: SI 입력을 계수로 **나누고** 15 자리로 맞춤(전: 역수 곱). 계수는 정의값에서 유도(1 kip = 4.4482216152605 kN 등 — 전 4.44822 · 0.11298 반올림값). 출력은 곱셈만(전: 소수 4 자리 반올림) | 12.7 mm → 0.49999999999999994 in → **0.5** in; 볼트 J6 +0.4 – 1.3 % 차이 → 0. SI 결과의 계수 변화: 상대 ≈ 3.6e-7 (4.44822 → 4.4482216) | `si_units_roundtrip.js` §1–2 (27 값 × 17 단위 왕복 비트 일치), `mcp_si_chain.js` (US·SI 본문 `deepStrictEqual`) |
| R8-13 · F2 후속 · V1 | 고침 | `set_section_template`: `D: D || 1`, `r: r || 0` 삭제(빠지면 보내지 않음 — 엔진이 립 단면은 "D missing" 오류). 형식별 인자 `OD`(chs), `top_width`/`depth`/`brim`(hat), `tf`/`tw`(isect/tee), `nseg`, `n_elem`; 설명을 형식별 H/B/D 뜻(hat H = 상판 폭, B = 깊이), qlip 뜻(플랜지 선에서 꺾인 각, < 90 = 바깥으로)으로. H/B/t 를 선택으로(chs 는 H/B 불필요) | lippedc D 생략: 1 in 립 → 엔진 오류. chs: 늘 오류(V1) → `OD` 로 동작 | `mcp_si_chain.js` §4 (본문에 D·r 없음, chs SI `OD 152.4 mm → 6 in`) |
| R8-14 · F4 후속 · V2 | 고침 | `aisi_design_flexure`: `Vu`, `wc_N` … `wc_M`(14 개), `Lb_pos`·`Cb_pos`·`Mu_pos`, `cantilever`, `R_uplift`(C/Z 만, Mn = R·Mnlo, ≤ 0.70), `span_type`(simple/continuous, Table I6.2.1-1), `moment_sign`, `shear_n_webs`, `use_inelastic_reserve`, `use_cold_work`, `dist_M1_M2`, `dist_Lm`, `kphi`, `Fcre`. combined: `dist_M1_M2`, `transverse_load`, `L`, `Fcre`, `moment_sign`, `shear_n_webs`, `May_strength` 설명(앵글은 Muy=0 이어도). 네 도구: `Fy` 필수(전 35.53/245 기본), `Fu` 선택·기본 없음, `KtLt ?? KyLy`·`Cb || 1.0`·`Cmx ?? 1.0`·`Pu || 0`·`Muy || 0`·`Vu || 0`·`Tu || 0` 삭제(엔진이 미평가 · 경고로 답함), compression `Fcre` | Fy 생략: 35.53 으로 계산 → 스키마 오류; KtLt 생략: KyLy 로 지어냄 → 엔진 E2 미평가 | `mcp_si_chain.js` §3 (모든 인자 이름이 `design_member` 의 `params.get` 키), §4, US/SI 4 건 |
| R8-15 · F6 후속 2 | 고침 (MCP 쪽) | `design_connection` · `aisi_design_connection` · `check_shear_lag` · `design_lap_connection` 에 `design_method` enum. 엔진 정규화는 F6 | MCP 로 ASD 불가 → 가능 | §3 (이름) |
| R8-18 (MCP 쪽) | 고침 | `get_section_preview`: 응답에 `error` 가 있거나 `file_path` 가 없으면 오류(전: `file_path` 만 보고 성공 문구) | 캡처 시간 초과 → `isError` | `mcp_si_chain.js` §6 |
| R8-19 · R3-03 · F3 후속 | 고침 (MCP 쪽) | `run_vibration`: `rho ?? 1.0` 삭제, "질량밀도 kip·s²/in⁴ (강재 7.345e-7)", `units:'SI'` 이면 kg/m³ (7850) ↔ 정의 계수 1.0687e10. 출력 `rho_used` 도 변환 | ρ 생략: 1.0 → 엔진 강재 값 + 경고 | `mcp_si_chain.js` (본문 `{action:'vibration'}`, rho US/SI) |
| R8-20 | 고침 (+ 잔여 위험) | `scripts/mcp-source-hash.cjs`: 해시 전에 CRLF → LF, `package.json` 은 name · version · dependencies 만 해시(scripts 줄을 고쳐도 번들이 그대로면 해시도 그대로). `.gitattributes`: `media/mcp-server.js*` `-text`, `src/mcp/*.ts text eol=lf`. `npm run build:mcp` 로 다시 빌드 | 전: 이 PC 의 CRLF 바이트 해시 ≠ 커밋 번들 `47fb26b50874` → parity 실패. 후: `854ff58936a4`, parity OK | 「잔여 위험」의 바이트 실험 |
| R8-22 | 고침 (registration 쪽) | `registration.ts:mergeServerConfig`: 기존 항목과 내용이 같으면(키 순서 무관 비교) **원문 바이트 그대로** `changed:false` 를 돌려준다(전: 같아도 `JSON.stringify(existing, null, 2)` 로 다시 직렬화 → CRLF · 들여쓰기 · 다른 항목 표기가 바뀌어 git 이 수정으로 봄). `planServerConfigWrite` 추가(`write:false` 면 쓰지 말 것). 실제 쓰기는 `extension.ts`(W3) — 후속 2 | 같은 등록, 다른 들여쓰기·CRLF: 파일 다시 씀 → 글 그대로 | `mcp_registration_contract.js` (실제 설정 파일을 건드리지 않는 순수 함수 시험) |
| R8-28 (MCP 행) | 고침 | `generate_report` 에 `units`(입출력), `validate_design` 의 `Fy || 35.53` 삭제 + `units`, `check_shear_lag` 에 `design_method`, `set_gbtcon` 에 `glob`/`dist`/`local`/`other` 선택 벡터 | — | §3, §4 |
| R8-29 | 고침 | MCP → 브리지 `localhost` → `127.0.0.1` | — | `si_units_roundtrip.js` tripwire |
| R8-30 | 고침 | 시험을 승격: 키 목록 고정 대신 실제 엔진 출력 leaf 전수 분류 + 실제 MCP · 실제 브리지 · 실제 Python 의 종단 비교(`mcp_si_chain.js`) | — | `mcp_si_chain.js` |
| R8-31 (MCP 행) | 고침 | 브리지 HTTP 요청에 6 분 시간 초과(호스트 → Python 5 분보다 김), 끊으면 "계산이 VS Code 에서 계속될 수 있다 — get_status 로 확인" 오류. 연결 실패는 "패널을 여시오" 오류 | 시간 초과 없음(무한 대기) → 오류 응답 | (시간 초과 자체는 시험하지 않음 — 「못 한 것」) |
| F1 후속 6 · V1 | 고침 | `set_springs`: 10 열 강제(`length(10)`), 열 뜻 · 분포/이산 단위, SI 변환(이산 플래그에 따라 kN/m · kN/m/m · kN-m/rad · kN-m/rad/m). `set_constraints` 5 열 강제 | — | `si_units_roundtrip.js` §3 |
| F2 후속 (custom) · R2-14 | 고침 | `set_custom_section` · `build_section`: `outer_side` = "판 재료가 놓인 쪽", enum 에 `'auto'` + 구간별 배열, `|| 'left'` · `|| 0` · `|| 4` 삭제(생략 = 엔진 기본 auto · 0 · 4), `n_flat` · `max_elem_len` · `expected_A`, `units`(좌표 · t · R mm). `custom_section_guide` 의 outer_side 규칙("바깥면이 왼쪽이면 left", "부풀면 바꿔 보라") 삭제, 단일 'left' 로 늘 오류가 나는 시그마 예제를 엔진에서 확인한 립 C 예제로 바꾸고, 시그마는 구간별 outer_side 와 「사용자 결정」 표시 | 시그마 예제: 엔진이 left/right/auto 모두 오류(직접 확인) → 예제 교체 | 엔진 직접 호출로 확인(립 C 'auto' → left 해석, 시그마 3 방식 모두 오류) |
| F3 후속 | 고침 | `set_gbtcon` 설명: 결합 · 비결합 같은 번호(ospace 1–4), CUFSM 기본(orth 2 · norm 1), 응답의 GBTcon 을 확인하라. `classify_modes`: null 행 = "cFSM 분류 불가", status · code · message 보고 | — | — (설명) |
| F4 후속 | 고침 | = R8-14. `MEMBER_NOTE`: 해석식 대체 · 템플릿 생성 · 보수 대체는 `assumptions` 에 있다 | — | §3 |
| F5 후속 · V2 | 고침 | `get_web_crippling`: `Fy || 35.53` · `theta || 90` · `support || 'EOF'` · `fastened` · `section_type || 'C'` · `web_config || 'single'` 삭제, `Fy` 필수, `d` · `web_holes` · `units` 추가, 설명에 built-up I = 두 웨브 합, not-covered · 범위 밖 → `error`·Pn null, 체결 무보강 1-플랜지의 무체결 행 대체(`row_used`), `h3_applies`/`h3_equation`/`h3_evaluated`. `steel_grades`: `include_restricted`, 설명에서 SGC570 등 §A3.1.3 강종 제외. `get_dsm_values` 설명: 단일 극소의 `crl_floor`/`crd_floor` 는 **하한**, `local_detected:false` = "이 곡선에서 분리 안 됨", `classification_method` 의 뜻, `local_basis`/`dist_basis` 값 | — | §3 (`web_crippling` 서명), §4 |
| F6 후속 1 · 13–16 · V3 | 고침 | 두 접합 도구가 같은 `CONNECTION_FIELDS`(엔진 `_KNOWN_KEYS` 안의 70 키): `member_case`(Table J6.2-1 8 분류 + `not_tension_member`), `Usl`, `x_bar`, `L_conn`, `b1`, `b2`, `bf`, `bw`, `n_rows_long`, `pitch`, `edge_transverse`, `Agv_bs`/`Anv_bs`/`Ant_bs`, `Ant`, `Ae`, `j6_3_not_applicable`, `j6_part2{…}`, `member_tension`, `Vu`, `Tu`, `force_direction`, `t_head`/`t_far`, `Fy1`/`Fy2`/`Fu1`/`Fu2`, `Pnvs`, `Pnts`, `dw`, `d_head_washer`, `tc`, `j45_rational`, `Pnov_bolt`, `slot_orientation`, `washers`, `shear_plane`, `mf`, `consider_hole_deformation`, `pattern_length`, 용접 `w1`/`w2`/`joint_type`/`load_direction`(5 값)/`de`/`joint`/`t_sheets`/`application`/`eccentric_tension`/`sidelap`/`seam_orientation`, 그루브 `groove_type`(+`flare_bevel`, `flare_v`)/`te`/`R`/`h`/`process`/`d1`/`d2`/`R2`, PAF `HRC_p`/`dar`/`Pnot_test`/`alpha_w`/`alpha_b`/`E`. `Fuf || 120`(827), `Fxx || 60`(414), `t2 || t1`, `n || 1`, `groove_type || 'complete'`, `Pu || 0` 삭제. `design_connection` 의 Fy · Fu 필수. 설명: t1 = 머리·와셔 쪽(나사 · PAF), `e` = 하중 방향 끝단 거리, Fub · bolt_grade 없으면 A307, 가정값(`assumed`, `governing_assumed`)은 참고값일 뿐 PASS/FAIL 을 내지 않으니 빠진 입력은 사용자에게 받을 것, `assumptions` 의 보수 대체 | PAF Fuf 생략: 120 ksi 로 판정 → 핀 검토 미평가(엔진). member_case 를 보낼 길 없음 → 보냄 | §3 (모든 키가 `_KNOWN_KEYS` 에), §4 (본문에 Fuf · Fxx · n · t2 없음), US/SI 4 건(볼트 12.7 mm 포함) |
| F6 후속 4 | 고침 | `check_lap_length`: `ok` 가 null(한쪽 0) 일 수 있음, 1.5d 는 강도 조건이 아니라 R 계수법 · J3 예외 조건, `units` | — | US/SI |
| F6 후속 5 · R5-21 | 고침 | `check_shear_lag`: `connection_case` 를 Table J6.2-1 enum(밑줄)으로, `connection_type`, `d`, `s`, `b1`, `b2`, `bf`, `bw`, `design_method`, `units`, 설명에서 "generic" 삭제. `check_block_shear`: "나사 · PAF 불가" | 하이픈 표기 권장(일반식으로 계산) → enum | §3 (`shear_lag` 서명), US/SI |
| F6 후속 6 · R5-22 · R5-24 | 고침 | `cold_work`: `A_total`, `buckling_precondition`, `fya_usable` 설명, 면적 없으면 C = 0. `flange_curling`: `d`, `wf_is_half_clear_distance`, `h` = 단면 깊이 | — | §3, US/SI |
| F7 후속 · V3 | 고침 | = R8-10. `analyze_loads` 설명: 모멘트 kip-ft, ASCE 7-10 번호(6a: …), 순하중 부호로 양력 분류, 결과 키(`patterned_loads`, `combo_R_uplift`, `i621_region_eligible`) | — | §3 |
| W1 후속 (W2) | 고침 | `run_analysis` 설명(자동 항 · warnings · discarded_lengths · m_all_selection), `calc_deck_stiffness`(`?? 12` · `?? 2.5` 삭제, 엔진 인자 8 개 추가, `kx_detail` · `warnings`, 반올림 없음, `units`), `run_plastic_surface`(`fy || 35.53` 삭제 → 필수, 격자 인자, `normalized` · `warnings` 설명) | deck fastener_spacing 생략: 12 지어냄 → 엔진 기본(같은 값, 출처가 엔진) | §3 (deck 허용 키), US/SI |
| 서버 instructions | 고침 | 실제 흐름(단면 → 좌굴 → 하중 → 부재 → 접합 → 검증/보고), 패널이 열려 있어야 함, 모델은 도구로만, 입력을 지어내지 않음, 판정 null 의 뜻, warnings · assumptions · scope_notes · 사내 가정(force_model 등)을 사용자에게 알릴 것, 단위 정책. "Default steel SGC400 …" 문장 삭제 | — | — |
| 기타 | 고침 | 상태 도구(`set_*`, 절점·요소 편집, `run_analysis` …)가 패널 응답을 그대로 돌려준다(전: 몇몇은 성공 문구를 지어냄). 절점 · 요소 · 하중 · 재료 · 길이 도구에 `units` | — | §6 |

R8 의 나머지는 내 파일이 아니다: R8-02 · 03 · 05(패널 쪽) · 08 · 16 · 17 · 21 · 23 은 W3 · W1, R8-11 · 24 · 25 · 26 · 27 은 엔진 · W1. 그 가운데 MCP 설명이 따라야 하는 것(R8-05 section_type, R8-16 custom 의 실하중 LF)은 위에서 설명을 고쳤다.

## 도구 계약표 (도구 → 인자(단위) → 브리지 action → Python 메서드)

US 단위 표기. `units:"SI"` 를 받는 도구는 같은 인자를 mm · mm² · MPa · kN · kN-m(하중 도구는 m · kN/m) 로 받는다. MCP 는 `units` 를 브리지에 보내지 않는다. "패널" = 호스트 상태만.

| 도구 | 인자 (필수 **굵게**) | action | Python |
|---|---|---|---|
| get_status | — | `GET /status` | 패널 |
| get_full_state | — | get_full_state | 패널 |
| get_section_properties | units(출력) | get_properties | `get_properties` |
| get_dsm_values | **load_type** P/Mxx/Mzz, fy ksi(생략 권장), KxLx · KyLy · KtLt · Lb in, Cb, section_type, units | get_dsm | `dsm` |
| get_buckling_curve | — | get_curve | 패널 |
| set_section_template | **type**, H, B, D, t, r in, qlip deg, OD, top_width, depth, brim, tf, tw in, nseg, n_elem, units | generate_template `{section_type, params}` | `generate_section` |
| set_custom_section | **outer_corners** in, **t** in, R_inner, corner_radii in, n_arc, outer_side, n_flat, max_elem_len in, expected_A in², units | generate_template (custom) | `generate_section` |
| build_section | **steps**[…] in, **t**, R_inner, n_arc, outer_side, n_flat, max_elem_len, expected_A, expected_center, units | generate_template (custom_builder) | `generate_section` |
| get_section_preview | — | capture_section_preview | 웹뷰 |
| custom_section_guide | section_type | (MCP 안) | — |
| set_material | **E** ksi, **v**, G ksi, units | set_material | 패널 |
| set_load_case | **load_case**, fy ksi, P kips, Mxx · Mzz kip-in, units | set_load_case | `get_properties`+`stresgen` |
| set_stress | **type**, fy, P, Mxx, Mzz, units | set_stress | `stresgen` |
| set_boundary_condition | **BC** | set_bc | 패널 |
| set_lengths | **min**, **max** in, **n**, units | set_lengths | 패널 |
| run_analysis | neigs | run_analysis | `analyze` (+`classify_detailed`, `dsm`) |
| run_signature_curve | — | signature_ss | `analyze` |
| classify_modes | — | classify | `classify_detailed` |
| get_nodes / get_elements | — | get_nodes / get_elements | 패널 |
| set_node_stress | **node_ids**, **stress** ksi, units | set_node_stress | 패널 |
| set_nodes | **nodes**[8 열: x z in, σ ksi], elements[5 열: t in], units | set_nodes | 패널 |
| set_elements | **elements**, units | set_elements | 패널 |
| add_node | **x**, **z** in, stress ksi, units | add_node | 패널 |
| add_element | **nodei**, **nodej**, **thickness** in, units | add_element | 패널 |
| modify_node | **node_id**, x, z, stress, units | modify_node | 패널 |
| delete_node | **node_id** | delete_node | 패널 |
| modify_element | **elem_id**, thickness, nodei, nodej, units | modify_element | 패널 |
| delete_element | **elem_id** | delete_element | 패널 |
| double_mesh | — | doubler | `doubler` |
| get_cutwp | units(출력) | cutwp | `cutwp` |
| run_plastic_surface | **fy** ksi, n_theta, n_na, n_fibers_per_elem, n_thick, units | plastic | `plastic` |
| run_vibration | rho kip·s²/in⁴, units(kg/m³) | vibration | `vibration` |
| save_project / load_project | **filepath** (절대 경로, .stcfsd/.json) | save_project / load_project | 패널 |
| set_springs | **springs**[10 열], units | set_springs | 패널 |
| set_constraints | **constraints**[5 열] | set_constraints | 패널 |
| set_gbtcon | glob, dist, local, other, ospace, norm, couple, orth | set_gbtcon | 패널 |
| get_energy_recovery | **length_index**, **mode_index** | energy_recovery | `energy_recovery` |
| aisi_design_compression | **Fy** ksi, Fu, **KxLx**, **KyLy** in, KtLt, Pu kips, Fcre ksi, design_method, units | aisi_design (compression) | `aisi_design` |
| aisi_design_flexure | **Fy**, Fu, **Lb** in, Cb, Mu kip-in, Vu kips, wc_N · wc_R · wc_overhang · wc_edge_distance · wc_support_fastener_spacing in, wc_support, wc_fastened, wc_flange_condition, wc_section_family, wc_section_type, wc_n_webs, wc_web_config, wc_P kips, wc_M kip-in, Lb_pos in, Cb_pos, Mu_pos kip-in, cantilever, R_uplift, span_type, moment_sign, shear_n_webs, use_inelastic_reserve, use_cold_work, dist_M1_M2, dist_Lm in, kphi kip-in/rad/in, Fcre ksi, design_method, units | aisi_design (flexure) | `aisi_design` |
| aisi_design_combined | **Fy**, Fu, **KxLx**, **KyLy**, KtLt, **Lb** in, Cb, Cmx, Cmy, dist_M1_M2, transverse_load, **Pu** kips(±), **Mux** kip-in, Muy, May_strength kip-in, L in, Vu kips, Fcre, moment_sign, shear_n_webs, design_method, units | aisi_design (combined) | `aisi_design` |
| aisi_design_tension | **Fy**, Fu, Tu kips, An in², design_method, units | aisi_design (tension) | `aisi_design` |
| aisi_design_connection | **connection_type**, **Fy**, **Fu**, **t1** in + 위 F6 행의 키 전부, units | aisi_design (connection) | `aisi_design` → `design_connection` |
| steel_grades | include_restricted | steel_grades | `steel_grades` |
| aisi_design_guide | **query_type** | aisi_guide | `aisi_guide` |
| get_web_crippling | **h**, **t**, **R**, **N** in, **Fy** ksi, theta, support, fastened, section_type, section_family, flange_condition, Lo, edge_distance in, n_webs, web_config, bearing_case, support_fastener_spacing in, d in, web_holes, units | web_crippling | `web_crippling` |
| analyze_loads | **member_app**, **span_type**, **span_ft** ft, spans_ft ft, supports, **loads**{D L Lr S R W Wp} plf, design_method, spacing_ft, laps{left_ft right_ft}, laps_per_support[], deck{…}, section{…}, E ksi, pattern_loading, brace_points_ft, i621_conditions_confirmed, insulation_in in, lr_reduced, I_span_in4 in⁴, units | analyze_loads | `analyze_loads` |
| calc_deck_stiffness | t_panel, t_purlin, fastener_spacing, flange_width in, k_per_fastener kip/in, E, b_fastener, c_fastener in, Fss_kip kips, D_screw_in in, Fu1_ksi, Fu2_ksi ksi, kphi_override kip-in/rad/in, kx_override kip/in/in, units | calc_deck_stiffness | `calc_deck_stiffness` |
| design_purlin | analyze_loads 의 인자 전부 + **Fy**, Fu ksi, units | design_purlin | `analyze_loads` + `analyze`×2 + `dsm`×2 + `aisi_design`×영역 |
| generate_report | member_type, design_method, Fy, Fu, Mu, Pu, Lb, Cb, KxLx, KyLy, KtLt, member_app, span_type, span_ft, spacing_ft, loads, units | generate_report | 수집 + `aisi_design`/`analyze_loads` |
| validate_design | Fy, units | validate_design | 수집 |
| design_lap_connection | **d**, **t** in, **Fy**, **Fu** ksi, **lap_left_in**, **lap_right_in** in, **Mu_support** kip-in, **Vu_support** kips, **fastener_type**, **fastener_dia** in, n_rows, end_distance in, design_method, Se · Sf in³, Mnd · Mnd_single kip-in, Vn kips, h_web in, Pnvs kips, Fub ksi, bolt_grade, units | lap_connection | `lap_connection` |
| check_lap_length | **d**, **lap_left**, **lap_right** in, units | check_lap_length | `check_lap_length` |
| design_connection | aisi_design_connection 과 같음 | design_connection | `design_connection` |
| check_shear_lag | **Ag**, **An_net** in², **x_bar**, **L_conn** in, **Fu**, **Fy** ksi, design_method, Usl, connection_case, connection_type, d, s, b1, b2, bf, bw in, units | shear_lag | `shear_lag` |
| check_block_shear | **Agv**, **Anv**, **Ant** in², **Fy**, **Fu**, Ubs, design_method, connection_type, phi_factor, omega_factor, units | block_shear | `block_shear` |
| cold_work | **Fyv**, **Fuv** ksi, **R**, **t** in, n_corners, corner_angle, A_corners, A_flange, A_total in², corners_per_flange, buckling_precondition, units | cold_work | `cold_work` |
| flange_curling | **bf**, **t**, **h** in, d in, wf_is_half_clear_distance, **f_avg** ksi, E, allowable_cf in, units | flange_curling | `flange_curling` |

### W3 의 handler 와 대조 (끝날 때 `StcfsdPanel.ts` 를 읽음)

일치: `get_dsm`(fy 를 주면 해석 fy 와 다를 때 거절, BC 는 분석 모델, section_type 대체), `aisi_design`(`_designMember` 가 `...input` 전체를 넘김), `analyze_loads`/`design_purlin`(`ANALYZE_LOADS_ARGS` 가 `LOAD_FIELDS` 의 19 키를 모두 받음), `lap_connection` · `design_connection` · `aisi_guide`(`_dictParams` 로 전부), `KW_ALLOWLISTS`(web_crippling · calc_deck_stiffness · check_lap_length · shear_lag · block_shear · cold_work · flange_curling · steel_grades 가 내 스키마 키를 모두 포함), `vibration`(rho 는 줄 때만), `set_load_case`/`set_stress`(fy 없고 모델에도 없으면 오류 — 설명을 그에 맞춤), `set_gbtcon`(CUFSM 기본 · 선택 벡터), `save_project`(절대 경로 · 확장자 — 설명에 반영), `load_project`, `capture_section_preview`, `energy_recovery`. 불일치는 「후속」 1.

## 후속 — 다른 곳이 따라와야 하는 것

### W3 (`src/webview/StcfsdPanel.ts`, `src/extension.ts`, `webview/js/app.js`)

1. **`StcfsdPanel.ts` `case 'plastic'`**: `fy` 만 넘긴다. MCP `run_plastic_surface` 의 `n_theta` · `n_na` · `n_fibers_per_elem` · `n_thick` 를(있을 때만) `plastic` 에 넘길 것 — 지금은 조용히 버려진다.
2. **`extension.ts:_mergeIntoFile` · `setupMcpConfig`**: 활성화마다 `fs.writeFileSync` 한다. `mergeServerConfig(...).changed`(또는 새 `planServerConfigWrite(...).write`)가 false 면 쓰지 말 것. 지금도 내용이 같으면 `registration.ts` 가 원문 바이트를 돌려주므로 파일 글은 바뀌지 않지만 mtime 은 바뀐다. 네 곳 자동 쓰기 자체(R8-22 의 나머지)와 포트 레지스트리는 K1(미승인) 범위.
3. **`webview/js/app.js` `UNIT` 상수**: 4.44822 · 0.11298 · 6.89476 반올림값. MCP 는 정의값(4.4482216152605 …)을 쓴다 — 화면과 MCP 의 SI 표시가 상대 3.6e-7 – 1e-5 만큼 다르다. 같은 값을 쓰려면 `siUnits.US_TO_SI` 의 정의를 옮길 것.
4. `test/python/test_design_verification.py::test_purlin_uplift_r_and_governing_wiring_contract` 가 현재 실패(패널 · app.js 문자열을 읽는 시험) — W3 가 고친다고 공지됨.
5. MCP 는 `units` 키를 보내지 않는다(SI 는 이미 US 로 바꿔 보냄). `_dictParams` 의 `units` 제거는 GUI 경로용으로 남겨도 해 없음.
6. `run_analysis` 응답에 `lengths`(실제 푼 길이 배열)도 실으면 AI 가 `get_energy_recovery` 의 `length_index` 를 고르기 쉽다(지금은 `lengths_analyzed` 개수만).

### 엔진 (참고)

- `interaction_checks` 의 단위를 엔진이 밝혀 주면(예: `unit: 'kips'` 또는 `value_units`) MCP 가 이름 접두어("Bolt tension …")로 kips 를 가려내지 않아도 된다. 지금은 이름이 바뀌면 `comparePhysical` 의 점검 키에는 안 걸리지만 그 값이 무차원으로 남는다.
- `lap_connection.design_lap_connection` 에 `d` 8.0 · `t` 0.059 · `Fy` 35.53 · `Fu` 58.02 · `fastener_dia` 0.19 기본값이 아직 있다(F6). MCP 스키마는 이 다섯을 필수로 받으므로 MCP 경로에서는 쓰이지 않는다.

## 사용자 결정 필요

1. **CI 의 `npm ci` (가장 급함).** `package-lock.json` 이 `.gitignore:37` 로 추적되지 않는다. CI(`.github/workflows/ci.yml`)의 `ts` · `mcp-parity` 작업은 `setup-node cache: npm` + `npm ci` 를 쓰므로 잠금 파일 없이는 실패한다(이 묶음 전부터). 게다가 이 PC 의 잠금 파일은 package.json 과 어긋난다(`@typescript-eslint/*` 8.64.0 vs `^8.70.1` — scratch 에서 `npm ci` 가 EUSAGE). 선택지: (a) `.gitignore` 에서 빼고 `npm install` 로 잠금을 맞춰 커밋(권장 — 그래야 Linux 빌드가 이 번들과 같은 의존성으로 만들어진다), (b) CI 를 `npm install` 로 바꿈(번들 바이트가 의존성 최신판에 따라 바뀔 수 있어 바이트 비교 작업과 맞지 않음).
2. **시그마 단면 예제 · 프리셋(F2 사용자 결정 2).** 안내문의 옛 시그마 예제는 지금 엔진에서 늘 오류였다. 예제를 립 C 로 바꾸고 시그마는 "구간별 outer_side · 도면 확인 · 형상 결정 대기"로 적었다. 형상이 정해지면 예제를 되살린다.
3. **스키마를 엄격하게 바꾼 것.** `get_dsm_values.load_type`, 설계 도구 `Fy`, `run_plastic_surface.fy`, `design_connection` 의 `Fy`·`Fu`, `set_lengths.n`, `design_lap_connection` 의 하중 · 패스너 인자, `get_energy_recovery` 색인이 필수가 됐다. 예전 프롬프트(기본값에 기대던 AI 호출)는 이제 스키마 오류를 받는다 — 의도한 것이지만 공개 계약의 변화다.
4. **`design_method` 생략 = 엔진 기본 LRFD.** 강도 계수의 선택이므로 필수로 할 수도 있다. 지금은 생략하면 엔진 기본을 쓰고 결과 `design_method` 로 밝힌다(MCP 가 지어내지는 않음).

## 잔여 위험

- **CI 바이트 일치.** 실험(`scratchpad\w2\ci_sim`): 작업 트리와 다른 절대 경로에, 번들 입력을 LF 로 맞춰 복사하고 같은 `node_modules`(webpack 5.105.4 · ts-loader 9.5.4 · typescript 5.9.3 · terser 5.46.1 · SDK 1.29.0 · zod 4.3.6 — 잠금 파일과 같은 판)로 두 번 빌드 → 두 빌드끼리, 그리고 저장소의 `media/mcp-server.js` · `.map` 과 **바이트 단위로 같음**(js sha256 `c002ea38…` 형, 최종 소스로 다시 해도 같음). 번들 · 맵에 절대 경로 없음, CR 없음. 같은 실험에서 `server.ts` 를 CRLF 로 두면 **JS 는 같고 `.map` 은 다르다**(sourcesContent 에 원문이 들어감) — 그래서 `.gitattributes` 에 `src/mcp/*.ts text eol=lf` 를 넣었다. 남은 위험: (1) 위 사용자 결정 1 — 잠금 파일이 없으면 CI 가 빌드조차 못 한다. (2) Linux 에서 실제로 빌드해 보지는 못했다(경로 구분자 · 줄바꿈 외의 플랫폼 차이는 webpack 출력에 없다고 판단 — 관찰된 출력에 플랫폼 의존 부분이 없었다). (3) 이 커밋 전에 만든 Windows 클론은 속성 변경 뒤에도 파일을 다시 체크아웃할 때까지 CRLF 일 수 있다 — 그 PC 에서 빌드하면 `.map` 만 달라진다(`git add --renormalize` 또는 다시 체크아웃).
- **VS Code 없이 시험할 수 없는 것.** (V4 뒤 개정 — 아래 절) `mcp_si_chain.js` 는 이제 실제 `StcfsdPanel.handleMcpAction`(W3 의 `panel_harness.js`, 가짜 vscode)을 지난다. 남은 것: VS Code 안의 웹뷰 렌더, 미리보기 PNG 의 실제 왕복(웹뷰 없음 → 시간 초과 오류 경로만 시험), `extension.ts` 활성화 · 등록 쓰기. ~~첫 판의 이 항목(패널 대역)은 V4 가 지적한 대로 `design_purlin` 의 인자 탈락(V4-05)과 묶음 SI 응답(V4-16)을 놓쳤다.~~
- **브리지는 토큰이 없다.** 브라우저 경로는 막았지만 같은 PC 의 다른 프로세스는 여전히 도구를 부를 수 있다(K1 의 토큰 · 포트 파일 방식은 미승인).
- **키 이름 기반 단위 판정.** 같은 이름이 다른 단위인 곳을 하위 표 · 부모 키(`design_strength`)· 이름 접두어(볼트 F'nt 상호작용)로 가렸다. 엔진이 키를 더하면 그 키는 `si_unconverted` 로 드러나고 시험이 실패한다(조용히 섞이지 않음). 그러나 엔진이 **같은 이름의 뜻**을 바꾸면(예: 휨 결과에 Mn 없이 design_strength 만) 오분류될 수 있다 — 종단 시험의 핵심 키 점검이 그 일부를 잡는다.
- 시간 초과(6 분)와 연결 실패 문구는 코드로만 확인했다(6 분을 기다리는 시험은 두지 않았다).

## 못 한 것

- 실제 VS Code 확장 호스트 안의 종단 실행(`@vscode/test-electron`) — 이 PC 에서 돌리지 않았다.
- Linux 체크아웃에서의 실제 빌드 — 위 실험으로 대신했다.
- `mcp_si_chain.js` 는 `.venv` 의 Python 이 없으면(CI 의 `ts` 작업) Python 부분을 건너뛰고 그렇게 출력한다(스키마 · 기본값 · 브리지 · 응답 검사는 늘 돈다). `STCFSD_REQUIRE_PY=1` 이면 건너뛰지 않고 실패한다.

## V4 검증 뒤 고친 것

검증 보고서: `verify/V4-boundary-rendered.md` (진짜 번들 · 진짜 브리지 · 진짜 패널 · 진짜 파이썬). V4 가 확인한 것(브리지 403/415/400, 압축 · 휨 · Lap · 볼트의 GUI = MCP, MCP US = SI)은 그대로다. 내 쪽 결함과 고친 것:

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후) | 회귀 시험 |
|---|---|---|---|---|
| V4-05 (P1) | 고침 | `server.ts` `design_purlin` 스키마에 호스트 퍼린 함수가 구간 설계에 얹는 부재 옵션(`StcfsdPanel.PURLIN_MEMBER_OPTIONS`) 13 키 전부: `wc_N`, `wc_R`, `wc_fastened`, `wc_flange_condition`, `wc_section_family`, `wc_section_type`, `wc_overhang`, `wc_edge_distance`, `wc_n_webs`, `wc_web_config`, `wc_support_fastener_spacing`, `use_inelastic_reserve`, `use_cold_work`(새 `PURLIN_WC` — 호스트가 지점에서 정하는 `wc_support` · `wc_P` · `wc_M` 은 받지 않으므로 내놓지 않음). SI 입력 표에 `wc_N` · `wc_R` · `wc_overhang` · `wc_edge_distance` · `wc_support_fastener_spacing`(mm). 설명: "wc_N · wc_R 이 없으면 웹 크리플링 미평가", "GUI 와 같은 함수 · 같은 결과". 내 첫 기록의 「W3 handler 와 대조 — 일치」 는 `ANALYZE_LOADS_ARGS` 만 보고 `PURLIN_MEMBER_OPTIONS` 를 놓친 틀린 판단이었다 | 같은 입력: MCP 는 끝 지점 G5 를 평가하지 않음(GUI 1.28 NG) → MCP 결과 = 호스트 함수 직접 호출 결과(같은 객체), G5 평가됨 | `mcp_si_chain.js` §3b · §4(본문에 wc_* 전달) · §8(`deepStrictEqual(MCP, panel.handleMcpAction 직접)`, G5 문구 존재) |
| V4-05 의 시험 공백 | 고침 | `mcp_si_chain.js` §3b 새 검사 `hostAcceptedParams`: `StcfsdPanel.ts` 소스에서 `handleMcpAction` 의 case 마다 받는 인자를 뽑는다(`options.X`, `for (const k of [...]) options[k]`, 참조한 static 목록 `ANALYZE_LOADS_ARGS` · `PURLIN_MEMBER_OPTIONS`, `KW_ALLOWLISTS`, `_designMember` · `_analyzeLoads` · `_designPurlin` 의 키, dict 로 넘기는 action 은 엔진 키 — `design_member` 의 `params.get`, `connections._KNOWN_KEYS`, lap 키). 그 action 으로 보내는 MCP 도구(`ACTION_TOOLS`) 어느 것도 내놓지 않는 인자가 있거나, 도구가 보내는데 호스트가 읽지 않는(조용히 버려질) 인자가 있으면 실패. 의도한 제외는 `HOST_ONLY` 에 까닭과 함께(호스트가 채우는 props/dsm/section, GUI 전용 action, props 없을 때만 쓰는 엔진 템플릿 치수 …). 되돌리기 시험: 퍼린 스키마에서 `wc_N` 을 빼면 `host action 'design_purlin' accepts 'wc_N' but no MCP tool (design_purlin) offers it` 로 실패(확인) | 이 검사가 첫 실행에서 찾은 다른 공백 4 건도 고침(아래) | `mcp_si_chain.js` §3b |
| §3b 가 찾은 공백 | 고침 | `design_lap_connection`: `threads_excluded`, `hole_type`, `mf`(호스트 · 엔진이 받는데 없었음). 접합 두 도구: `L_seam`(아크 시임 길이 — `weld_length` 의 별칭). `aisi_design_flexure` · `aisi_design_combined`: `transverse_stiffeners`(§G2.2 미구현 → G2.1 보수 + 경고). `analyze_loads`: `Fy` · `Fu`(호스트가 모델에서 section 을 만들 때 I6.2.1 (o) 에 쓰는 호스트 인자 — 엔진 서명에 없으므로 §3 검사에 이 둘만 호스트 인자로 허용) | — | §3, §3b |
| V4-16 (P2) | 고침 | `siUnits.ts` `SI_OUT_PURLIN` 을 호스트 퍼린 묶음의 실제 모양대로: `regions[]`(위치 `start_ft` · `end_ft` · `x_M_max_ft` = ft, `Ly_in` = in, `Mu` = kip-in(설계 입력), `Vu` = kips), `regions[].result`(부재 설계 결과 + `Mu_checked` · `Vu_checked` · `checks[].Mu/Vu` · `supports_checked[].Pu`), `design_positive/negative/lap/uplift`(지배 구간 결과 + `region`), `i621_check` · `wc_reactions` · `uplift_reactions`(하중 표). 그 밖에 실제 패널 경로가 드러낸 키: `shear_interaction.Malo` · `Mao`(kip-in), 보고서 `curve_length` · `lengths_analyzed` · `m_terms_max`(개수), 진동 응답의 `lengths`(in) | 퍼린 SI 응답 미변환 226 → 0 (이번 입력 86 → 0; 구간 수에 따라 다름). generate_report 1 → 0, run_vibration 3 → 0 | `mcp_si_chain.js` §8: 퍼린 · 보고서 · 검증의 US/SI 전수 비교(미분류 0, 모든 수치 = 정의 계수 배) + 구간 위치 ft · Ly in · Mu kip-in · Vu kips · 검토점 M · V · φMn 의 개별 단위 확인, 구간 M_max 검토점 Mu = 구간 Mu(× 랩 0.5) |
| V4 B-5 (시험) | 고침 | `mcp_si_chain.js` 의 US/SI 비교 26 건 · 오류 응답 · 퍼린 · 보고서 · 검증을 **실제 `StcfsdPanel`**(W3 `test/webview/panel_harness.js` 의 `createPanel`, 진짜 `PythonBridge`)로. 패널 대역(echo)은 §4 「지어낸 입력 없음」(브리지 본문만 보는 검사 — 실제 패널로 하면 단면 · 응력이 바뀜)에만 남겼다. 단면도 MCP 로 만든다: 같은 립 C 를 mm 와 in 으로 만들면 절점이 비트 단위로 같다 | 대역 23 건 → 실제 패널 26 건(+ design_purlin · generate_report · validate_design) | `mcp_si_chain.js` |
| V4-18 (MCP 쪽) | 고침 (설명) | `aisi_design_flexure` 설명: "미평가 목록에 오르지 않는 예외 — wc_N · wc_R 이 없으면 §G5/§H3 은 그냥 없다(GUI 는 늘 지압 길이를 보낸다); 지점 · 집중하중이 있으면 넣을 것". 엔진이 이것을 `not_evaluated` 로 올릴지는 F4 | — | — |
| generate_report | 고침 (설명) | 전체 입력은 aisi_design_* · design_purlin · analyze_loads 로 먼저 돌리고 generate_report 는 member_type 없이 부르라(마지막 결과를 보고). §3b 의 제외 까닭과 같다 | — | §3b |

`test/rendered/` 는 이 시점에 저장소에 없다 — W3 의 `test/webview/panel_harness.js` 를 직접 불렀다. W3 가 하니스를 옮기면 `mcp_si_chain.js` 의 `require('./panel_harness.js')` 한 줄만 바꾸면 된다(W3 후속).

### 게이트 (V4 뒤 마지막 실행)

| 게이트 | 마지막 줄 |
|---|---|
| `.venv\Scripts\python.exe test\python\run_all.py` | `Ran 378 tests in 53.468s` / `OK` |
| `.venv\Scripts\ruff.exe check python test` | `All checks passed!` |
| `npx tsc -p ./ --noEmit` | 출력 없음(종료 0) |
| `npx eslint src webview/js test/webview` | 출력 없음(종료 0) |
| `npm run test:webview` | `mcp_si_chain: PASS (26 US/SI comparisons through MCP → bridge → real StcfsdPanel → Python)` … 마지막 줄 `design_state_v13_contract: PASS` |
| `npm run build:mcp` | `webpack 5.105.4 compiled successfully` |
| `npm run check:mcp-parity` | `MCP parity OK: deployed bundle matches source definitions` (bundle `0.1.1+src.8d6f399e456a`, 59 tools) |

바이트 실험을 최종 소스로 다시 했다: scratch 의 LF 사본 빌드 = 저장소 `media/mcp-server.js` · `.map` (둘 다 같음).

### V4 뒤 후속

- **W3**: 하니스를 `test/rendered/` 로 옮기면 `mcp_si_chain.js:require('./panel_harness.js')` 를 같이 바꿀 것(또는 `test/webview/panel_harness.js` 를 남겨 둘 것). `PURLIN_MEMBER_OPTIONS` 에 키를 더하면(예: 구간별 `dist_M1_M2`/`dist_Lm` 을 호스트가 스스로 채우는 대신 사용자 입력으로 받기) §3b 가 MCP 스키마에 같은 키가 없다고 실패한다 — 그때 W2 가 스키마에 더한다.
- **F4 (참고)**: `wc_N` 이 없을 때 휨 결과에 §G5 가 `not_evaluated` 로도 오르지 않는다(V4-18 의 엔진 쪽). 올리면 MCP 설명의 "예외" 문장을 지운다.

### W3 의 V4 수정을 따라 (진동 인자)

- §3b 가 W3 의 새 호스트 인자를 잡았다: `vibration` 의 `lengths`(in 목록) · `confirm_large`. `run_vibration` 스키마에 둘 다(SI: lengths mm), 설명에 크기 보고(`size`: n_lengths · terms_max · dof_max · estimate_s), 60 s 넘으면 `needs_confirmation` 으로 실행하지 않음, `confirm_large` 는 **도구가 알린 크기 · 시간을 사용자에게 말하고 동의를 받은 뒤에만**(미리 켜지 말 것). SI 출력 표: `size.*` 무차원, 퍼린 구간 `members` 무차원(`beta_dist` · `Malo` · `Mnlo` 는 이미 표에 있음). `design_purlin` 설명에 구간별 β · members, `design_lap_connection` 설명에 "Se 없이 Sf 만 보내지 말 것 — 엔진이 지금 Sf 로 대신한다(F6 후속, `lap_connection.py:281`)". `resultsCleared` 는 웹뷰 메시지라 MCP 와 무관.
- 시험: `mcp_si_chain.js` §4 에 `run_vibration {lengths: [254, 1270] mm, confirm_large}` → 본문 `[10, 50]` in, §7 진동 US/SI 에 `lengths` 와 `size` 점검.
- 게이트(이 시점): `npm run test:webview` 에서 `mcp_si_chain: PASS (26 US/SI comparisons …)` 다음 W3 의 `panel_host_contract.js:258` `default-density warning reaches the caller` 가 실패 — F3 가 `python/vibration/solver.py` 의 기본 밀도 알림을 warnings → assumptions 로 옮긴 결과(W3 기록이 요청한 이동). `run_all.py` 는 `Ran 382 tests` / `FAILED (failures=1)` — W1 의 `test_review_1122_server.test_R8_25_…` 가 응답 바이트에 `NaN` 이 없어야 한다고 보는데, F3 의 새 `classify` 메시지 글 "(NaN rows)" 가 들어 있다(단독 재실행에서도 실패, 시험의 바이트 검사가 글까지 본다). 둘 다 내 파일이 아니다.

### V4 재검증 뒤 (V4-16 나머지 · V4-31 · F6 의 t2 · n)

- **V4-16 나머지**: 하중 표에 `overhang_ft`(ft). 시험에 내민 경간이 있는 퍼린(`spans_ft [1.5, 25, 25, 1.5]`, 지점 `N P P P N`)의 US/SI 전수 비교를 더하고, 결과에 `overhang_ft` 가 실제로 있는지 확인(없으면 시험이 무의미하므로 실패). 같은 실행이 드러낸 엔진 새 키 `web_crippling.load` · `Pn_interior_cap`(kips)도 분류.
- **V4-31**: `mcp_si_chain.js` §8c 「0 = 없음」 검사 — `design_purlin` 스키마의 > 0 경계가 있는 선택 수치 인자마다 그 인자가 실제로 쓰이는 입력(시험값 override 가 있으면 패스너 값이 가려지므로 따로, E 는 기본값과 다른 값으로)으로 호스트 함수를 직접 불러 「0」 과 「인자 없음」 의 결과를 비교하고, 같으면(엔진이 0 을 「주지 않음」 으로 봄) 스키마가 0 을 받아야 한다. 값을 바꿔도 결과가 같은 인자는 「이 입력에서 쓰이지 않음」 으로 따로 적고 판단하지 않는다(spacing_ft · section.qlip · wc_n_webs). 처음 실행에서 16 개가 걸렸다 → `nonnegative`(또는 `min(0)`) + 설명 "0 = not given": deck `kphi_override` · `kx_override` · `R_tested_uplift` · `R_tested_gravity` · `Fss_kip` · `D_screw_in` · `Fu_panel_ksi`, section `depth` · `flange_width` · `thickness` · `Fy` · `Fu` · `Ixx` · `E`, 최상위 `E`, `wc_N`, `wc_support_fastener_spacing`(V4 가 본 칸; 퍼린 · 휨 도구 모두). 0 이 실제 값으로 쓰이는 `t_panel` · `fastener_spacing` · `b_fastener_in` · `c_fastener_in` 은 > 0 그대로. GUI 본문 꼴(wc 칸 0 셋)의 echo 검사 추가. 다른 도구는 같은 비교를 자동으로 돌리지 않았다 — 접합 · 특수 주제 도구는 인자마다 그 인자가 쓰이는 접합 형식을 골라야 해 이번에는 퍼린 · 하중 · 휨의 공유 인자까지만.
- **F6 · V4-29 (t2 · n)**: 두 접합 도구가 보내기 전에 형식별 필수를 검사한다(`missingConnectionInputs` — 엔진 `design_connection` 의 필수 입력과 같은 규칙: t2 는 모든 형식, 단 `t_sheets` 가 있고 시트-시트가 아닌 아크 스팟 · 시임은 생략 가능; n 은 그루브 말고 모두). 평평한 스키마로는 형식별 필수를 적을 수 없어 설명(형식별 필수 입력 목록)과 이 검사로 대신했다. 시험: 나사 t2 없음 · n 없음 · 볼트 둘 다 없음 → 오류, 패널에 아무것도 가지 않음; t_sheets 아크 스팟은 t2 없이 통과.
- 게이트: `run_all.py` → `Ran 386 tests in 50.143s` / `OK`; ruff `All checks passed!`; tsc · eslint 출력 없음; `test:webview` 끝까지 PASS(`mcp_si_chain: PASS (28 US/SI comparisons …)`, 마지막 `design_state_v13_contract: PASS`); `build:mcp` 성공; `check:mcp-parity` → `MCP parity OK` (`0.1.1+src.cbb1a6a8b6e7`).
