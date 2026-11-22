# W3 — 확장 호스트 · 웹뷰 (`src/webview/` · `src/extension.ts` · `src/bridge/` · `src/models/types.ts` · `webview/js/`) 수정 기록

## 요약

고침 41 행 (R8 19 · 묶음 1 · W1 · W2 · 검증 V1–V3 후속 22 — 한 행에 여러 출처를 묶음) · 보류 1 (R8-31 호스트 쪽) · 기각 0 · 사용자 결정 필요 5. R8-04 · 06 · 12 · 13 · 14 · 15 · 20 · 29 는 W2 · 엔진 영역(호스트는 인자를 그대로 넘김).

- **판정 표시(가장 중요).** 엔진의 `pass` 는 True / False / None. 화면의 모든 판정을 세 상태로 바꿨다 — 공용 순수 함수 `webview/js/utils.js` 의 `verdictOf` · `combineVerdicts`(불합격이 이기고, 판정 없음은 OK 가 아님) · `notEvaluatedList` · `warningsList` · `assumptionsList` · `scopeNotesList` 하나를 쓰고, `app.js` 에 세 번 있던 `verdictOf` 는 지웠다. 판정 옆에 `warnings`(눈에 띄게) · `assumptions`(따로) · `scope_notes`(접어서) · 평가하지 않은 목록을 함께 보인다. 아래 「판정 표시를 바꾼 곳」 표.
- **한 길(R8-08).** 계산마다 호스트 함수 하나를 GUI 와 MCP 가 같이 부른다: `_performAnalysis`(해석) · `_designMember`(부재 설계) · `_signatureDsm`(설계용 DSM) · `_analyzeLoads`(하중) · `_designPurlin`(퍼린 — 구간별) · `_applyTemplate`(템플릿) · `_classifyCurrent`(분류). 같은 입력의 GUI(`runPurlinDesign`) 경로와 MCP(`design_purlin`) 경로가 같은 답을 내는 것을 시험으로 고정(`panel_host_contract.js`).
- **시험.** 새 시험 4 개(`package.json` 의 `test:webview` 끝에 이었다): `verdict_display_contract.js`(판정 함수 단위 + 두 상태 판정 꼴 금지 tripwire), `panel_host_contract.js`(**진짜 `StcfsdPanel` + 진짜 파이썬 서버**를 VS Code 없이 Node 에서 — 시나리오 9 개, 약 12 s), `design_state_v13_contract.js`(.csd v1.3 입력 왕복), 보조 `panel_harness.js`. 고친 기존 시험: `design_prepare_contract.js`(퍼린 배선 · MCP Cm), `lap_governing_contract.js`(×12 tripwire), `test_design_verification.test_purlin_uplift_r_and_governing_wiring_contract`(퍼린 배선 — 그 함수 안만).
- 게이트(끝의 실행 결과는 「게이트」 절).

## 발견사항별

| 번호 (출처) | 처리 | 무엇을 바꿨나 (파일:함수) | 전 → 후 | 시험 |
|---|---|---|---|---|
| R8-01 | 고침 | `StcfsdPanel.ts` `get_dsm`: DSM fy 는 언제나 해석 기준응력 `_meta.fy`. 다른 `fy` 를 주면 오류. 모든 dsm 호출은 `_callDsm` 하나로 — `BC`(곡선이 푼 BC) 항상 전달 | MCP 기본 35.53 → Mcrl 0.71× · SI 9.7× → 해석 fy 로만, 다른 fy 거절 | `panel_host_contract` `scenarioTemplateLoadCaseAndDsm` |
| R8-02 · F4 후속 · V2-12 | 고침 | `_designMember` · `_dsmForDesign`: 설계에 **Py · My 를 보내지 않는다**(엔진이 설계 Fy 로 Ag·Fy · Sf·Fy). 탄성 임계값(Pcrl · Pcrd · Mcrl · Mcrd · Lcrd) + `fy_analysis` + F5 진단 키 전부를 `P_`/`M_` 접두로(`crl_floor` · `crd_floor` · `single_minimum*` · `boundary_minimum` · `reference_stress_consistent` · `reference_is_restrained` · `reference_unsymm` · `warnings` · `assumptions` …) — 판단은 TS 에서 다시 하지 않음. 못 찾은 값(0 · null · NaN)은 보내지 않음(전 `?? 0`) | 해석 fy 50 · 설계 Fy 35.53: Mn 71.41(+24.7 %) → 해석 fy 35.53 과 같은 값 | `scenarioMemberDesignFyConsistency` |
| R8-03 | 고침 | `_applyTemplate`(GUI · MCP 공용) 은 균일 압축을 넣고 `loadCase='compression'`. 초기 모델도 화면 기본(압축)과 같게. 절점 응력 직접 편집(`set_node_stress` · `set_nodes` · `add_node` · `modify_node(stress)`)은 `_markCustomStress`(custom, loadFy 지움). 불러온 파일에 표지가 없으면 custom | 템플릿 → 해석: 압축 곡선이 Mxx 로 추출(Mcrl 0.19×) → P family, Mxx 요청 거절 | `scenarioTemplateLoadCaseAndDsm`, `scenarioCustomLoadNotRescaled` |
| R8-05 | 고침 | `_callDsm`: KxLx · KyLy · KtLt · Lb 를 주면 `section_type` 을 모델 형식(`_sectionTypeForEngine`)으로, 사용자 단면이면 오류(지어내지 않음). `_normalizeSectionType` 이 rhs · chs · isect 를 'C' 로 만들던 것(R8-28)도 고침 — C · Z · Track · Hat · RHS · CHS · I · Tee · Angle · LippedAngle · custom | Z + Lb 120: Mcre 2.0× (C 식) → Z 식 | `scenarioZSectionType`(브리지 직접 호출 Z/C 와 비교, C/Z = 2.00) |
| R8-07 (호스트) | 고침 | `load_project` · `save_project`: 실패를 `{error}` 로(전 throw · 일부 성공 문구) | — | `scenarioPreviewAndProjectFiles` |
| R8-08 · V3 T1–T10 · F7 후속 | 고침 | `_designPurlin` 새로 씀(아래 「퍼린 설계」). GUI 자동 계산 모드의 「설계 검토 실행」이 `runPurlinDesign` → 같은 함수 | 대표값 하나(최대 Ly + 최소 Cb + 최대 Mu) → 엔진 구간마다 자기 Ly · Cb · M | `scenarioPurlinRegions`(GUI = MCP 같은 답) |
| R8-09 (호스트 쪽) | 고침 | `save_project`: 절대 경로 · `.stcfsd` / `.json` 만, 임시 파일 → rename. (브리지 CORS · Content-Type 은 W2) | 임의 경로 쓰기 → 거절 | `scenarioPreviewAndProjectFiles` |
| R8-10 | 고침 | `_analyzeLoads`: 엔진 인자만(`ANALYZE_LOADS_ARGS`), `section` 이 없으면 지금 모델의 템플릿 치수 + grosprop Ixx(+ 준 Fy · Fu)로, `section_source` 로 밝힘 | MCP: section 없음 → R · 처짐 없음 → 모델 단면으로 | `scenarioPurlinRegions` |
| R8-16 | 고침 | `set_load_case custom` · `set_stress custom`(fy 없음): 실하중 응력 그대로, family 추론 없음(`custom`), 응답 `reference: 'applied loads'`. `_applyStressToModel` 은 fy 를 지어내지 않음(순수 분포에 fy 없으면 오류) | P=30: 35.53 으로 재척도 → P/A 그대로 | `scenarioCustomLoadNotRescaled` |
| R8-17 (호스트) | 고침 | `PythonBridge`: 정상 시작 뒤 죽으면 다음 호출에서 **한 번** 다시 띄우고 알림(`onStatus` → 정보 · 경고 창), 두 번째 죽음은 분명한 오류. stderr 는 계속 읽고 끝 8000 자만 보관(서버가 엔진 출력을 stderr 로 보냄). `error_code` 를 `Error.code` 로 | 죽으면 이후 모든 호출 "not running" → 1 회 재시작 | 코드 확인(프로세스 죽이기 시험은 못 함 — 「못 한 것」) |
| R8-18 | 고침 | `capture_section_preview`: 요청마다 새 파일(`cufsm_section_preview_<pid>_<n>.png`), 이번 요청에 쓴 경우에만 경로, 웹뷰 오류 · 시간 초과는 `{error}` | 이전 PNG 를 성공으로 → 오류 | `scenarioPreviewAndProjectFiles` |
| R8-19 · F3 후속 | 고침 | 진동: `rho: 1.0` 고정 제거. 화면에 질량밀도 칸(`vib-rho`, kg/m³ ↔ kip·s²/in⁴, 단위 변환 · 저장), 비우면 보내지 않음(엔진 강재 + 경고). 모델 springs · constraints · neigs · GBTcon 전달, 항은 `_resolvedTerms`. 결과에 `rho_used` · 경고 · Hz 라벨(전 "rad/s") | 진동수 1/1166 → 강재 값 | `scenarioAllowlistsAndVibration`(질량 2배 → 1/√2) |
| R8-21 | 고침 | 시작 점검을 `selftest`(옛 서버면 ping) — `ok=false` 면 `PythonStartupError` 로 파이썬 버전 · import 오류를 그대로 안내. 확장의 오류 창이 그 문장을 보임 | ping 만 → 버전 · import 확인 | `panel_harness`(매 시험 selftest 로 시작) |
| R8-22 (일부) | 고침 | `extension.ts:_mergeIntoFile`: 내용이 같으면 쓰지 않음(W2 후속 2). 네 곳 자동 등록 자체는 K1 범위 | 활성화마다 mtime 변경 → 같으면 쓰지 않음 | — |
| R8-23 | 고침 | `signature_ss`: 모델 BC · 길이 · 항을 바꾸지 않고 서버 `signature_ss`(요소폭 기반 길이)를 임시로. `_meta.BC='S-S'`, `kind='signature_ss'`, family 는 실제 응력(`_analysisFamily` 의 'signature_ss'→Mxx 제거) | BC · 길이 영구 변경 · Mxx 오표지 → 그대로 · 실제 family | `scenarioSignatureAndBc` |
| R8-24 (호스트) | 고침 | 위와 같음 — 호스트가 서버 `signature_ss` 를 처음으로 씀 | — | 같음 |
| R8-25 (호스트) | 고침 | 호스트의 `?? 0`(DSM 값) 제거 — null 은 보내지 않아 엔진이 미산정으로 | — | `scenarioMemberDesignFyConsistency` |
| R8-28 (호스트 줄) | 고침 | `validate_design` 이 `Fy` 로 준비 DSM 을 돌려줌 · `classify` 는 `classify_detailed` + 최상위 GBTcon · `_normalizeSectionType`(R8-05 행) · MCP 원시 모델을 화면 「열기」로도(`.stcfsd`/`.json` 필터) · `.csd` 주 버전 검사 · 행 검증 · `_lastDesignRequest` 초기화 | — | `scenarioPreviewAndProjectFiles` |
| R8-30 | 고침 | 호스트를 진짜 파이썬으로 구동하는 Node 시험(`panel_harness.js` + `panel_host_contract.js`) — 도구 인자 → 패널 → 파이썬 전달과 GUI/MCP 일치를 본다 | 문자열 tripwire 만 → 실제 구동 | 그 시험 |
| R8-31 (호스트) | 보류 | 파이썬 호출 취소 · 시간 초과(5 분) 구조는 그대로. 서버 쪽 id 응답(W1)으로 매달림은 없어짐 | — | — |
| R8-04 · 06 · 12 · 13 · 14 · 15 · 20 · 29 | W2 · 엔진 | MCP 스키마 · SI 변환 · 번들. 호스트는 그 인자를 모두 받아 그대로 넘긴다(아래 표). R8-12 의 화면 쪽: `app.js UNIT` 을 정의값(1 kip = 4.4482216152605 kN, 25.4, 0.3048)으로 — MCP `siUnits` 와 같은 식(W2 후속 3) | 화면 · MCP SI 표시 상대 1e-6 – 1e-5 차 → 같음 | 기존 왕복 시험 |
| F1 후속 1 · 2 · 4 | 고침 | 기본 `lengths.map(() => [1])` 네 곳(`StcfsdPanel` 초기화 · `set_lengths` · `signature_ss`, `app.js` 해석 버튼) → `m_all: 'auto'`(서버가 S-S [1], 그 밖 m_recommend). `set_bc` · `set_lengths` 는 'auto' 로 되돌림. 실제 쓴 항 · 길이(`m_all` · `lengths` · `m_all_selection` · `discarded_lengths`)를 결과에 보관 · 표시, `run_analysis` 응답에 `lengths` 배열(W2 후속 6) | C-C: m=[1] 비보수 → 권장 항 | `scenarioNonSSAutoTerms` |
| F1 후속 3 · W1 후속 3 · V1 | 고침 | 해석 경고(`result.warnings` + 폐기 길이 문장)를 GUI 해석 탭(`analysis-warnings` 상자)과 MCP `run_analysis` 응답(`warnings`)에. 성공이어도 보임. `discarded:true` 진단은 실패로 보지 않음 | 경고 버려짐 → 표시 | `scenarioTemplateLoadCaseAndDsm` |
| F1 후속 6 | 고침 | `set_springs`: 10 열 · 유한 · 절점 범위 검사, 적용 전 거절 | 엔진 ValueError → 앞에서 분명한 오류 | 코드 |
| W1 후속 2 · 7 | 고침 | `classify_detailed` 에 `lengths: result.lengths, m_all: result.m_all` · 곡선이 푼 BC. `energy_recovery` 는 `result.lengths[i]` 와 `m_a: result.m_all[i]`, 곡선 BC | 다항 해석에서 DOF 어긋남 → 맞음 | `scenarioNonSSAutoTerms` |
| W1 후속 4 · F3 후속 · V1 | 고침 | 분류: `status` · `code` · `message` 를 화면(`classify-status`)과 MCP 에. `renderClassifyCurve` 는 null 행을 0 % 로 그리지 않음 | 둥근 모서리 → 0 % 로 그림 → 그리지 않고 까닭 표시 | 코드 · `node --check` |
| W1 후속 8 · F7 | 고침 | `analyze_loads` · `design_purlin` 은 엔진 인자만 골라 보냄(`Fy` 등 남는 키는 안 보냄) | `ignored_params` 경고 → 없음 | `scenarioPurlinRegions` |
| W1 후속 9 · F2 후속 | 고침 | `generate_section` 의 `validation` · `warnings` 를 GUI 상태줄 · MCP 응답에 | — | `scenarioTemplateLoadCaseAndDsm` |
| W1 후속 10 | 고침 | `calc_deck_stiffness` allowlist(엔진 인자 전부), 반올림 없음(호스트는 값을 바꾸지 않음) | — | — |
| W1 후속 11 · 12 · 13 | 고침 | = R8-21 · R8-17 행 | | |
| F2 후속 (hat · CHS · 라벨) · V2-05 · V2-09 · V2-16 | 고침 | `_designSectionGeometry`: hat 은 section `top_width`(H) · `hat_depth`(B) · `brim`(D) — 립 아님, `depth`/`lip_depth` 보내지 않음. CHS `diameter`. 트랙 · RHS · 앵글 · 티 · I 는 립 없음. 사용자 단면은 판 치수를 보내지 않고 경고. `app.js` 하중 분석의 hat depth = B. 템플릿 칸 옆에 형식별 H/B/D 뜻(`tpl-dim-hint`), CHS 는 `OD` 로 보냄 | hat: H 를 웹 깊이로 · 브림을 립으로(E4/F4 판정 없음) → 템플릿 규약 | 코드 |
| F2 · F3 후속 (`set_gbtcon`) · V1-02 | 고침 | `set_gbtcon` 기본 · `types.ts` 기본 모델을 CUFSM 기본 orth 2 · norm 1 | 1/0 → 2/1(분류 값이 바뀜) | `scenarioTemplateLoadCaseAndDsm` |
| F4 후속 (cutwp · ro · 립) | 고침 | `_designProps`: cutwp 실패 시 J · Cw · Xs · Zs 를 채우지 않고 경고(전 `Xs = xcg`), `xo` · `ro` 보내지 않음, `nan_substituted` 전달. 절점에서 립을 추정하던 코드 제거 | E2.2 미평가 탐지 막힘 → 엔진이 판정 | 코드 |
| F4 후속 (판정 표시) · V2 | 고침 | 아래 「판정 표시를 바꾼 곳」. 인장 `Tn_rupture: null`, 웹 크리플링 `{error, Pn: null}`, built-up I `Pn` = 웹 합 라벨, `limit_state_checks` · `governing_check` · `not_checked` · `auto_generated_section` 표시 | None → OK 로 보임 → 「판정 없음」 | `verdict_display_contract` |
| F4 V2-03 · V2-06 | 고침 | R 을 보낼 때 `span_type`('simple'|'continuous'): 퍼린은 경간 형식에서, 직접 입력은 R 선택지의 `data-span`(선택지 기본을 「미적용」으로 — 전 0.60 이 선택돼 있었다). 휨 좌굴값의 부호: 준비 · 현재 해석 DSM 에 `M_sign`, 퍼린 구간마다 `moment_sign` 과 같은 부호의 DSM(하부 압축 → −Mxx 곡선) | 연속 Z R 0.70 판정 없음 → 판정 | `scenarioPurlinRegions` |
| F5 후속 (강종) · V2 | 고침 | `gradeMap` · 드롭다운: SGC570 · A653-80 · A792-80 을 A3.1.3 감소값(Fy 60 · Fu 61.5/62 ksi — 엔진 `steel_grades` 와 같은 값)으로, 고르면 사용 제한 문구. `steel_grades` 에 `include_restricted` 전달 | 80 ksi 감소 없이 → 감소값 + 표시 | 코드 |
| F5 후속 (DSM 표시) | 고침 | `renderDsmResults`: `crl_floor`/`crd_floor` 는 「하한 (값 아님)」 행, 0 은 「분리하지 못함 — 없음이 아님」, 분류 방법 · `signature_curve=false` · 비구속 응력 · dsm 경고 · 가정. Py 행 키(`P_y`) 오타 고침 | — | 코드 |
| F6 후속 7 · 8 · 13 · 17 · V3 | 고침 | allowlist(아래 표, `cold_work` A_total · buckling_precondition, `flange_curling` d · wf_is_half_clear_distance, `shear_lag` connection_type · b1 · b2 · bf · bw). 단일 접합 입력 칸: 끝단 `e`, 간격 `s`, 인장 `Tu`, 부재 경우 `member_case`(「인장재 아님」 포함), 폭 `width`, 「블록전단 경로 없음」(`j6_3_not_applicable`), 나사 `Pnvs`, `dw`. `Fub` · `Fuf` 기본값을 지어내지 않음(비우면 안 보냄 — 전 화면이 120/100 · 120 ksi 를 채움). Lap: 끝단거리 빈 칸은 안 보냄(전 0 → 자동), 랩 `Pnvs`. `governing_assumed` 는 「참고값 — 입력 필요」, verified 지배값 · `utilization_reference` 표시 | 가정값으로 FAIL/PASS 처럼 보임 → 참고값 | `scenarioAllowlistsAndVibration` |
| F7 후속 · F7(V3 뒤) | 고침 | 하중 탭 입력: 활하중 부분재하 스위치(`pattern_loading`), 지붕 활하중 감소(`lr_reduced`), §I6.2.1 조건 확인(`i621_conditions_confirmed`), 단열재 두께(`insulation_in`), 스탠딩심 시험 R(`deck.R_tested_uplift`), 이산 브레이스 위치(`brace_points_ft`, 목록), 경간별 Ix(`I_span_in4`, 목록 — 개수 검사). 결과: 위치별 지배 조합 · 패턴, 지점 `Vu_left/Vu_right`, `R_bearing / R_uplift` 부호(T13), `combo_R_uplift`, `pattern_loading.patterned_loads/why`, 하중조합 기준, 하중 분석의 경고 · 가정 · 미평가 | 대표 조합 한 줄 → 포락 + 위치별 조합 | 코드 · `panel_host_contract` |
| V3 T11 · T14 | 고침(엔진 + 화면) | 대표값이 한 구간의 자기 값이 됨(F7) — 자동 채움 Cb 와 Cb 식이 같은 구간. 보고서 'Chen & Moen' → Gao–Moen 2011, 검증 'R=0.60 기본값' 문구 삭제(포크 작업) | — | `verdict_display_contract` |
| G2 §3.2 (저장) | 고침 | `.csd` v1.3: 저장되지 않던 9 칸(`design-Mx-pos` · `design-Lb-pos` · `design-Cb-pos` · `design-dist-M1M2` · `design-dist-Lm` · `select-r-value` · `conn-edge-dist` · `input-E` · `input-G`, + `input-v`)과 새 입력 전부, Lap 결과(`lapResult`). 빈 칸은 null(= 입력 없음). custom 하중은 US 값으로도(전 표시값 — 단위계가 바뀌면 왜곡). 옛 파일(1.0–1.2)은 그대로 읽힘, 주 버전 ≠ 1 은 거절. 복원: 경간 표 동기 채움(100 ms 타이머 제거), 복원 뒤 연동 이벤트(`afterRestore` → 부재 유형 · 템플릿 · 하중 case · 접합 유형 · 데크 · β · 냉간가공, PLF · β 미리보기 · 응력 미리보기)를 결과 무효화 없이 돌림. 호스트는 입력 복원을 결과보다 먼저(하중 결과의 자동 채움 뒤에 한 번 더) 보냄 | 9 칸 · Lap 결과 소실 → 왕복 | `design_state_v13_contract`, `scenarioPreviewAndProjectFiles` |
| W2 후속 1 · 5 | 고침 | `plastic`: `n_theta` · `n_na` · `n_fibers_per_elem` · `n_thick` 전달, `fy` 없으면 오류(전 35.53). `set_material` 의 빠진 E · v 는 지금 모델 값(전 29500 · 0.3) + `assumptions`, `set_lengths` · `energy_recovery` 의 기본 인덱스 · 범위는 `assumptions` 로 돌려줌. 화면 소성 곡면은 null 정규화 값을 그리지 않음 | — | 코드 |

### 퍼린 설계 (`_designPurlin`)

1. `_analyzeLoads` (엔진 인자만, section 없으면 모델에서).
2. 설계 Fy 로 S-S 서명곡선 DSM 둘: 정모멘트(상부 압축, 데크 kφ · kx 스프링), 부모멘트(하부 압축, 스프링 없음).
3. 구간: `unbraced.positive_regions` · `negative_regions` · `lap_regions` · `uplift_bracing.negative_regions`(R 은 `i621_region_eligible === true` 이고 `uplift_R` 이 있을 때만, `span_type` 함께) · 양력 지점부 상부 압축(엔진이 랩 끝에서 나누지 않으므로 중력의 랩 구간으로 잘라 랩 안 · 밖으로; 조각의 M 은 양력 포락선 최대).
4. 구간마다 `aisi_design`(구간 Ly · Cb · `cantilever`, 부호별 DSM · `moment_sign`): (A) 구간 최대 M(엔진 `M_max_abs`) + 그 위치 V, (B) 구간 최대 V + 그 위치 M, (C) 구간 안 지점마다 지점 M + 지점 양쪽 V 중 큰 값 + 웹 크리플링(`wc_P` = 지점 반력, `wc_support` = 지점 `case`, `wc_M`). 랩은 두 부재가 M · V 를 반씩(가정, `assumptions`), 랩 안 LTB · 뒤틀림 제외.
5. 판정: 구간 안 검토들 → 구간 판정, 구간들 → 전체 판정(세 상태). 지압 길이 `wc_N` 이 없으면 웹 크리플링 「평가하지 않음」(전체 판정 null 쪽), 랩 안 지점의 웹 크리플링은 모형화하지 않아 「평가하지 않음」으로 밝힘.
6. 결과: `regions[]`(구간 · Ly · Cb · Mu · Vu · R · 결과 · 검토점별 `checks`), 종류별 지배(`design_positive` …), `pass` · `utilization` · `governing`, `not_evaluated` · `load_not_evaluated` · `warnings` · `assumptions`, `uplift_R` · `i621_check` · `wc_reactions` · `uplift_reactions`.

**II-2A 기준 (시험 `scenarioPurlinRegions`)** — 8ZS2.25x059(Fy 55) 한 두께, 패턴 끔, kφ 0.300, ASD, I6.2.1 확인: 안경간 정모멘트 Ma 4.299 kip-ft (매뉴얼 4.35, −1.2 %), 안경간 왼쪽 랩 끝 부모멘트 4.299 → **3.775** (매뉴얼 F4 3.93, −3.9 % — FSM 서명곡선 Mcrd 대 부록 2 해석식), 양력 R 경로 Ma 3.001 (V3-21 엔진 기준 3.01). 전체 판정은 매뉴얼처럼 나오지 않는다 — **매뉴얼은 끝 경간에 더 두꺼운 부재(Ix 9.18)를 쓰는데 패널 모델은 단면 하나**다. 그리고 랩 끝 H2 가 엔진에서 1.16(매뉴얼 0.925) — 「후속」(F4).

### 판정 표시를 바꾼 곳 (전 → 후)

| 곳 | 전 | 후 |
|---|---|---|
| Lap 결과 종합 판정 (`renderLapConnectionResult`) | `pass ? ✅ OK : ❌ NG` — null 이 NG | 세 상태 + `verdict` 코드 · `flexure_checked` · `force_model` · 목록 |
| Lap 길이 · 휨 DCR 아이콘 | `lap_ok ? OK : NG`, `dcr <= 1.0 ? ✅` | 세 상태(`flexure_checked` 필요) |
| 단일 접합 판정 (`renderConnectionResult`) | 지역 `_verdictOf` | 공용 · 방향별 지배 · 미평가 까닭 · **가정값 지배는 「참고값」** |
| Lap · 접합 도면 색 (`_drawLapSvg` · `_drawConnectionSvg`) | null → 초록/흐림 | 주황 |
| 트리 요약 (`sendTreeUpdate`, `ProjectExplorerProvider`) | `d.pass ? 'OK' : 'NG'`, 아이콘 OK 아니면 error | 공용 `short`, 아이콘 pass / error / **warning** |
| 퍼린 지배 선택 (`_pickGoverningPurlinDesign`) | 이용률 최대 하나의 `pass` | 불합격 구간 우선, 전체 `pass` 는 호스트의 합친 세 상태 |
| 설계 결과 (`renderDesignResult`) 게이지 · 정모멘트 단계 · H1.2 · H3 · 웹 크리플링 · 인장 | 이용률 색, `pass !== false`, `pass ? OK : NG` | 세 상태, 판정 배너 + 지배 검토 + 한계상태 표 + 목록, 퍼린 구간 표 |
| 보고서 (`_rptFlexure` · `_rptSummary` · `_rptDesignCalc` · `_rptTension` · Lap 절) | `utilization <= 1.0`, `pass !== false`, `negOK && pr.pass !== false` | 엔진 검토(`limit_state_checks`)의 판정, 전체는 `d.pass` |
| 검증 70 항목 (`runAllValidationChecks`) | 이용률 문턱 · `pass ? … : 'fail'` · 해석식 대체를 pass | `_statusFromVerdict`(null → warn + 미평가 목록), 「종합 판정(엔진)」 항목 추가 |
| 진동 · 분류 · 소성 | — | 경고 표시, null 을 0 으로 그리지 않음 |

## `handleMcpAction` — 호스트 action → 받는 인자 (W2 용)

규칙: **파이썬 이름 그대로**, 값을 바꾸지 않고 넘긴다. 키워드 메서드(allowlist)는 목록 밖 키를 `{error: "Unsupported parameter …"}` 로 거절. dict 메서드는 `action` · `units` 만 빼고 그대로(모르는 키는 엔진이 경고). 호스트가 채우는 값은 응답의 `assumptions` 나 결과 키로 밝힌다.

| action | 받는 인자 | 호스트가 채우는 것 / 비고 |
|---|---|---|
| `generate_template` | `section_type`, `params`(엔진 `generate_section` 인자 그대로 — H,B,D,t,r,qlip,nseg,OD,top_width,depth,brim,tf,tw, custom 키 …) | 균일 압축 응력(지금 loadFy, 없으면 35.53 + `warnings`), `loadCase='compression'`. 응답 `validation` · `warnings` · `section_type` · `load_case` · `fy_reference` |
| `set_material` | `E`, `v`, `G` (ksi) | 빠진 E · v 는 지금 모델 값, G 는 E/2(1+v) — `assumptions` |
| `set_bc` | `BC` ∈ S-S C-C S-C C-S C-F F-C C-G G-C | 그 밖은 오류. `m_all='auto'` |
| `set_lengths` | `min`, `max`(in), `n` | 빠지면 1 / 1000 / 50 — `assumptions`. `m_all='auto'` |
| `set_load_case` | `load_case`, `fy`(순수 분포의 기준응력), `P`, `Mxx`, `Mzz` | custom 은 재척도 없음(`reference: 'applied loads'`). 순수 분포에 fy 가 없고 모델에도 없으면 오류 |
| `set_stress` | `type`, `fy`, `P`, `Mxx`, `Mzz` | custom + fy 일 때만 family 추론 |
| `run_analysis` | `neigs` | 응답 `lengths` · `lengths_analyzed` · `discarded_lengths` · `m_all_selection` · `m_terms_max` · `warnings` · `classification_status` · `dsm_*` · `dsm_error` · `fy_reference` |
| `signature_ss` | — | 모델 불변, `BC 'S-S'` · `load_family` · `warnings` |
| `get_dsm` | `load_type`(P/Mxx/Mzz, 기본 P), `KxLx`, `KyLy`, `KtLt`(P), `Lb`(M), `Cb`, `section_type`, `fy`(해석 기준응력과 같을 때만) | BC = 곡선이 푼 BC, 분류 = 해석의 것. 응답 `fy_used` · `section_type_used` |
| `classify` | `GBTcon`(선택) | `classify_detailed` 결과 `{classification, status, supported, code, message, …}` |
| `energy_recovery` | `length_index`(= `run_analysis.lengths` 색인), `mode_index` | `m_a` = 그 길이의 항, BC = 곡선 BC. 응답 `length` · `m_a` · `assumptions` |
| `vibration` | `rho`(kip·s²/in⁴, 선택) | 모델 springs · constraints · neigs · GBTcon, 항 `_resolvedTerms`. 응답 `rho_used` · `units` · `warnings` · `m_all_source` · `lengths` |
| `plastic` | `fy`(필수), `n_theta`, `n_na`, `n_fibers_per_elem`, `n_thick` | — |
| `aisi_design` | 엔진 `design_member` dict 그대로(`member_type`, `design_method`, `Fy`, `Fu`, `KxLx`…, `Mu`, `Mu_pos`, `Lb_pos`, `Cb_pos`, `Vu`, `wc_*`, `wc_P`, `wc_M`, `cantilever`, `R_uplift`, `span_type`, `moment_sign`, `use_*`, `dist_*`, `May_strength`, `Cmx`/`Cmy`, `An`, `Tu`, `Fcre`, `section_type`, `section`, `dsm`(덮어쓰기) …). connection 은 그대로 엔진 | `props`(grosprop + cutwp J · Cw · Xs · Zs, 실패면 빼고 `warnings`), `section`(템플릿 외측 치수), `dsm`(준비 · 현재 해석의 탄성값 + 진단 키 + `fy_analysis` + `M_sign`), `through_fastened`(스프링 있음). 응답 `dsm_basis` · `dsm_warning` · `host_warnings` |
| `prepare_design_dsm` | `member_type`, `Fy`(또는 `fy`) — 필수 | S-S 서명곡선 · 설계 Fy 응력 |
| `analyze_loads` | `member_app`, `span_type`, `span_ft`, `loads`, `design_method`, `spacing_ft`, `laps`, `deck`, `section`, `supports`, `spans_ft`, `laps_per_support`, `E`, `pattern_loading`, `brace_points_ft`, `i621_conditions_confirmed`, `insulation_in`, `lr_reduced`, `I_span_in4` | section 없으면 모델에서(`section_source`). 그 밖 키는 보내지 않음 |
| `design_purlin` | `analyze_loads` 의 인자 전부 + `Fy`(필수), `Fu` + `use_inelastic_reserve`, `use_cold_work`, `wc_N`, `wc_R`, `wc_fastened`, `wc_web_config`, `wc_section_family`, `wc_flange_condition`, `wc_overhang`, `wc_edge_distance`, `wc_n_webs`, `wc_support_fastener_spacing`, `wc_section_type` | 위 「퍼린 설계」. 결과 키는 거기 |
| `web_crippling` | `h`, `t`, `R`, `N`, `Fy`, `theta`, `support`, `fastened`, `section_type`, `section_family`, `flange_condition`, `Lo`, `edge_distance`, `n_webs`, `web_config`, `bearing_case`, `support_fastener_spacing`, `d`, `web_holes` | allowlist |
| `calc_deck_stiffness` | `t_panel`, `t_purlin`, `fastener_spacing`, `flange_width`, `k_per_fastener`, `E`, `b_fastener`, `c_fastener`, `Fss_kip`, `D_screw_in`, `Fu1_ksi`, `Fu2_ksi`, `kphi_override`, `kx_override` | allowlist |
| `lap_connection` | 엔진 `design_lap_connection` dict 그대로(`Se`, `Sf`, `Mnd`, `Vn`, `design_method`, `end_distance`, `Pnvs`, `Fub`, `bolt_grade` …) | — |
| `check_lap_length` | `d`, `lap_left`, `lap_right` | allowlist |
| `design_connection` | 엔진 `design_connection` dict 그대로(F6 13 의 키 전부: `member_case`(`not_tension_member` 포함), `j6_3_not_applicable`, `j6_part2`, `e`, `s`, `width`, `Ag`, `g`, `Tu`, `Vu`, `force_direction`, `Pnvs`, `Pnts`, `dw`, `Fuf`, `HRC_p`, `t_sheets`, `j45_rational`, `member_tension`, `joint_type` …) | — |
| `shear_lag` | `Ag`, `An_net`, `x_bar`, `L_conn`, `Fu`, `Fy`, `design_method`, `Usl`, `connection_case`, `d`, `s`, `connection_type`, `b1`, `b2`, `bf`, `bw` | allowlist |
| `block_shear` | `Agv`, `Anv`, `Ant`, `Fy`, `Fu`, `design_method`, `Ubs`, `phi_factor`, `omega_factor`, `connection_type` | allowlist |
| `cold_work` | `Fyv`, `Fuv`, `R`, `t`, `n_corners`, `corner_angle`, `A_corners`, `A_flange`, `corners_per_flange`, `A_total`, `buckling_precondition` | allowlist |
| `flange_curling` | `bf`, `t`, `h`, `f_avg`, `E`, `allowable_cf`, `d`, `wf_is_half_clear_distance` | allowlist |
| `steel_grades` | `include_restricted` | allowlist |
| `aisi_guide` | dict 그대로 | — |
| `set_springs` | `springs`(k × 10) | 열 · 절점 범위 검사 |
| `set_gbtcon` | `glob`, `dist`, `local`, `other`, `ospace`, `orth`, `couple`, `norm` | 빠지면 CUFSM 기본(1 · 2 · 1 · 1) |
| `save_project` | `filepath`(절대, `.stcfsd`/`.json`) | 원시 모델 + `format: 'stcfsd-model'` |
| `load_project` | `filepath` | 행 · BC · 길이 검증, 표지 없으면 custom, `warnings` |
| `capture_section_preview` | — | 이번 요청의 파일만 |
| `validate_design` | `Fy` | `prepared_design_dsm`(그 Fy), `errors` |
| `generate_report` | `member_type` 와 설계 인자, `loads` 등 하중 인자, `Fy` | 하중은 `_analyzeLoads`, 실패는 `errors` |
| 그 밖 | `get_status`, `get_full_state`, `get_properties`, `get_nodes`, `get_elements`, `set_nodes`, `set_elements`, `add_node`, `add_element`, `modify_node`, `modify_element`, `delete_node`, `delete_element`, `doubler`, `cutwp`, `get_curve`, `set_constraints`, `apply_deck_springs` | 전과 같음(절점 응력을 바꾸면 custom) |

## 후속 — 다른 곳이 따라와야 하는 것

### W2 (MCP)
- 시험 `mcp_si_chain` 을 진짜 패널로: `test/webview/panel_harness.js` 의 `createPanel()` 이 진짜 `StcfsdPanel` 과 진짜 파이썬을 VS Code 없이 띄운다(src 를 `typescript.transpileModule` 로 메모리에서 불러오고 `vscode` 를 가짜로). `ctx.panel.handleMcpAction(body)` 가 브리지의 `POST /action` 과 같은 진입점이고, `McpBridgeServer(() => ctx.panel, port)` 를 그대로 붙일 수 있다.
- `classify_modes` 응답은 이제 `classify_detailed` 모양(`classification` 키 아래 목록 + status).
- `run_analysis` 응답의 `lengths` 가 `get_energy_recovery.length_index` 의 기준.
- `design_purlin` 결과 모양(위 「퍼린 설계」 6). 도구 설명에 「구간별 검토, 지압 길이 wc_N 이 없으면 웹 크리플링 미평가, 랩은 두 부재 균등 분담 가정」.
- `get_dsm_values` 의 `fy` 는 「해석 기준응력과 같아야 함(다르면 오류)」으로 설명.

### 엔진
- **F4 `aisi_s100` H2**: II-2A 의 안경간 랩 끝(M 3.97 · V 1.19 kip, 8ZS2.25x059 ASD)에서 H2 비 1.16 — 매뉴얼 0.925. 엔진의 H2 Malo 가 무엇을 쓰는지(Mnlo 인지) 확인 필요. 웹뷰 · 호스트는 엔진 값을 그대로 보인다.
- **F7 `analyze_loads`**: `uplift_bracing.unbraced.positive_regions`(양력 지점부, 상부 압축)가 랩 끝에서 나뉘지 않는다 — 호스트가 중력 `lap_regions` 로 자른다. 엔진이 양력에도 `lap_regions` 를 내주면 그것을 쓰겠다.
- **F7**: 지점 `locations` 의 `Mu` 가 끝 지점에서 null 일 때 호스트는 포락선 값을 쓴다 — 엔진이 지점 M 을 늘 주면 좋다.
- **F6 `lap_connection`**: 기본값(d 8 · t 0.059 · Fy 35.53 · Fu 58.02 · fastener_dia 0.19)이 남아 있다(W2 지적). 화면은 다섯을 늘 보낸다.

## 사용자 결정 필요

1. **설계용 DSM 의 경계조건.** 설계 준비 · 퍼린 DSM 은 모델 BC 와 상관없이 **S-S 서명곡선(m = 1)** 으로 푼다(엔진 자동 경로와 같은 규약 — 같은 부재가 화면 · MCP · 엔진에서 같은 값). 모델이 C-C 등이면 그 곡선은 표시 · 분석용이고 설계에는 쓰지 않는다. 다르게 원하면(모델 BC 의 곡선을 DSM 에) 바꿀 수 있지만 dsm 이 `signature_curve=False` 로 거절한다.
2. **퍼린 랩 구간 모델.** 두 부재가 M · V 를 반씩(강도 합), 랩 안 LTB · 뒤틀림 제외 — 매뉴얼 II-2A 가정 (a)–(c) 를 따른 설계 가정(기준 조항 아님, `assumptions` 에 밝힘). 랩 안 지점의 웹 크리플링은 평가하지 않음으로 둔다.
3. **H2 짝짓기.** 구간마다 (최대 M, 그 위치 V) · (최대 V, 그 위치 M) · 지점(지점 M, 큰 쪽 V) 세 점을 검토한다. 포락선의 같은 위치 값이지만 서로 다른 조합 · 패턴에서 올 수 있어 보수 측이다.
4. **직접 입력 휨의 부호.** 화면 직접 입력 휨은 +Mxx(상부 압축) 좌굴값으로 검토한다(`M_sign '+'`). 대칭이 아닌 단면(hat · 사용자)에서 음의 모멘트를 검토하려면 부호 선택 칸이 필요하다 — 지금은 없음(엔진이 부호 불일치를 미평가로 막는다).
5. **R8-22 의 자동 등록.** 내용이 같으면 쓰지 않게만 했다. 활성화마다 네 곳에 쓰는 것 자체를 멈출지는 K1 과 함께 결정.

## 못 한 것 (VS Code 없이는 확인할 수 없는 것)

- **웹뷰 화면을 실제로 띄워 보지 못했다.** `app.js` 의 바뀐 렌더(판정 배너 · 구간 표 · 해석 경고 상자 · 새 입력 칸 · 분류 상태 문구 · 진동 표)는 `node --check` · eslint · 문자열 계약 시험 · 순수 함수 시험으로만 확인했다. 배치 · 줄바꿈 · 색은 VS Code 안에서 봐야 한다.
- 복원 뒤 연동 이벤트(`_fireRestoredInputUpdates`)가 각 화면 칸을 올바르게 다시 그리는지(특히 접합 유형 행 표시, β 미리보기)는 DOM 에서 확인하지 못했다.
- `test/vscode`(`@vscode/test-electron`)는 돌리지 않았다 — 그 시험의 흐름(set_lengths → set_load_case compression 35.53 → run_analysis → prepareDesignDsm → runDesign)은 바뀐 계약과 맞게 남아 있다.
- 파이썬 프로세스가 실제로 죽은 뒤의 재시작(R8-17)은 코드로만 — 시험에서 프로세스를 죽이는 경로는 만들지 않았다.
- PDF 저장 · 좌굴 보고서 패널 · 사이드바 트리 아이콘은 확인하지 못했다.
- 기존 `app.js` 의 `// @ts-check` 오류 102 건(HEAD 와 같은 목록)은 그대로 — 새로 늘지 않았다(포크가 `tsc --checkJs` 로 비교).

## 게이트

마지막 실행(저장소 루트):

```
.venv\Scripts\python.exe test\python\run_all.py      → Ran 375 tests in 58.424s / OK
.venv\Scripts\ruff.exe check python test           → All checks passed!
npx tsc -p ./ --noEmit                               → 출력 없음 (exit 0)
npx eslint src webview/js test/webview               → 출력 없음 (exit 0)
npm run test:webview                                 → … panel_host_contract: PASS (15.3 s) / design_state_v13_contract: PASS
node --check webview/js/app.js                       → OK
npm run build:mcp && npm run check:mcp-parity (W2)   → MCP parity OK: deployed bundle matches source definitions
```

`build:mcp` 는 W2 의 게이트지만 확인하려고 한 번 돌렸다 — W2 의 소스는 고치지 않았고 `media/mcp-server.js` 가 같은 소스로 다시 빌드되었다.

## V4 검증 뒤 고친 것

V4(`verify/V4-boundary-rendered.md`)가 진짜 웹뷰를 헤드리스 Edge 에 띄워 찾은 결함 가운데 W3 파일의 것. V4 의 하니스를 저장소로 옮겨 **렌더 시험** `test/rendered/`(`npm run test:rendered`, opt-in — Edge/Chrome 이 없으면 SKIP 한 줄)으로 만들고, 결함마다 화면에서 재현하는 시나리오를 넣었다. 시나리오는 V4 가 그 결함을 본 조건(같은 입력 · 같은 화면 칸)을 그대로 쓴다 — 고치기 전 작업 트리로 되돌려 다시 돌리지는 않았다(git 으로 작업 폴더를 바꾸지 않는다). 그림은 `test/rendered/out/shots/`(`test/rendered/.gitignore` 로 git 밖).

| 번호 | 처리 | 무엇을 바꿨나 | 전 → 후 | 시험 |
|---|---|---|---|---|
| V4-01 (P0) | 고침 | `app.js:clearStaleResults(scope, reason)` 한 함수가 무효화 때 화면을 지운다 — 설계 카드 · 단계 · 상호작용 · Lap 결과 · 보고서 · 검증(모든 scope), 하중 결과(load · model · all), DSM 표 · 곡선 · 모드 · 분류 · 해석 경고(analysis · model · all), 진동 · 소성(model · all), 단일 접합(all). 부르는 곳: `analysisInvalidated`(호스트의 모든 모델 변경 — MCP 편집 포함), `invalidateDerivedResults`(화면 입력 변경), 새 메시지 `resultsCleared`(호스트 `_loadProjectFile` 첫머리) | MCP 템플릿 변경 · 다른 `.csd` 열기 뒤 이전 단면의 「✓ OK」 카드가 남음 → 「결과 없음 — … 다시 실행하세요」 | `test:rendered` V4-01 두 개(그림 `r01_after_mcp_template`, `r01b_after_open_old_file`) |
| V4-02 | 고침 | 진동: 사용자가 「진동 길이」(새 칸 `vib-lengths`, MCP `lengths`)를 주면 그 길이만, 아니면 좌굴 해석의 길이 · 항. 크기(DOF = 4 × 절점 × 항, 예상 시간 ≈ Σ 2.2 s·(DOF/3108)³)를 결과에 싣고, 예상 60 s 를 넘으면 시작하지 않고 `needs_confirmation`(화면: 「그래도 실행」 단추, MCP: `confirm_large`) — 요청을 몰래 줄이지 않는다. 호스트 5 분 시간 초과면 `PythonBridge` 가 엔진을 다시 띄워 그 계산을 취소하고 알린다(전: 파이썬이 계속 계산해 뒤 요청이 모두 줄을 섬) | C-C 진동 5 분 시간 초과 · 화면 멈춤 → 48 s 에 끝남(F3 의 빠른 풀이) + 크기 표시, 다음 호출 즉시 | V4-02(그림 `r02_vibration`) |
| V4-03 | 고침 | `_designPurlin`: 구간마다 §2.3.3.3 `dist_M1_M2 = −(M작은/M큰)` · `dist_Lm = Ly`(랩 · Ly 0 구간 제외), 구간 표에 β 열. 화면 β 칸은 자동 계산 모드에서 「이 칸은 설계에 쓰지 않습니다」, Lcrd 를 모르면 L = Lm 으로 미리보기를 지어내지 않음 | II-2A 안경간 랩 끝 Ma 3.775(β 1) → 4.088 kip-ft(β 1.238; 매뉴얼 3.93 — FSM 서명곡선 Mcrd 대 부록 2 해석식) | V4-03/04(그림 `r03_purlin_regions`) |
| V4-04 (화면) | 고침 | H2 표에 Malo · Mnlo(엔진 새 키), 식 라벨 M/Malo | — | 같음 |
| V4-06 | 고침 | `DEFAULTS` 표와 `getNum` 의 숨은 대체를 없앰. 계산 요청은 `reqNum`(필수 — 비면 실행을 막고 이름을 상태줄 · 설계 검증 상자에), `zeroNum`(하중 · 소요강도 성분 — 빈 칸 = 0), `_optNum`(선택 — 비면 보내지 않음)으로: 템플릿(H · B · t 필수, D · r · 립각 선택), 해석(길이 범위 · 개수 · 고유치 수 · E · ν · G · 기준응력), 소성, 하중 분석(간격 · 경간 · 단면 · 설계 Fy 필수), 설계(Fy 필수, 길이 · Cb · Cm · 웹 크리플링 선택 — N 이 비면 웹 크리플링 검토 안 함), Lap, 단일 접합(t1 · Fy · Fu 필수, t2 · d · n · 용접 치수 선택). 웹 크리플링 반력 칸 `design-wc-P` 추가(V4-18) | 빈 S → 0.5 kPa, 빈 경간 → 25 m, 빈 Fy → 245 MPa, 빈 N → 89 mm, 빈 t2 · n → 1.5 mm · 4 → 0 · 막음 · 막음 · 검토 안 함 · 보내지 않음 | V4-06(그림 `r04_blank_fy_blocked`) |
| V4-07 | 고침 | `designState.js` 를 표(`FIELDS`: 저장 키 · id · 단위 · 종류) 하나로 다시 씀 — 빈 칸은 null, 복원은 null → 빈 칸 | 빈 Fub · Fuf → 827 MPa · t2 1.5 · n 4 → 빈 칸 그대로 | V4-07, `design_state_v13_contract` |
| V4-08 | 고침 | Lap: 휨 설계 결과(Se 또는 Mnl/Fy)가 없으면 Se · Sf 를 보내지 않음(엔진 `lap_connection.py:281` 이 Se 가 없으면 Sf 로 대신하므로 Sf 도), 까닭 문구 | 총단면 Sx 로 ✓ OK → 「판정 없음」 + 까닭 | V4-08(그림 `r06_lap_without_Se`) |
| V4-09 · V4-21 | 고침 | 단위 전환 표 = `designState.UNIT_FIELDS`(저장 · 복원과 같은 표). 시험이 HTML 의 단위 있는 `<input>` 을 모두 읽어 표에 같은 단위로 있는지 본다. 칸 값 다시 쓰기는 12 자리(전 6 자리 + 끝 0 지우기 — 1e-6 드리프트 · 100000 → 1 같은 버그) | Lm · May · 웹 크리플링 거리 3 칸 미변환 → 전부 변환, 왕복 오차 0 | V4-09/21, `design_state_v13_contract` |
| V4-10 | 고침 | 화면을 처음 열 때의 입력(`_initialInputs`)으로 모든 칸을 되돌린 뒤 파일 값을 얹음 | 이전 프로젝트의 Mu(+) 84.92 가 남아 NG 1.33 → 처음 값 0 | V4-01/10/11 |
| V4-11 | 고침 | `.csd` 에 `resultsEngine {results_format: 2, protocol_version, python}`. 열 때 이 판과 다르거나 기록이 없으면(1.0–1.2) 해석 · 하중 · 설계 · 준비 DSM · Lap 결과를 버리고 입력만, 「다시 실행」 경고 | 옛 엔진 결과가 「✓ OK」 로 복원 → 버리고 알림 | V4-01/10/11 |
| V4-12 | 고침 | 퍼린 가정(`assumptions` — 랩 두 부재 분담, Vu 짝짓기, 하중 가정, 모드 분류)과 하중 분석의 미평가(`load_not_evaluated` — I6.4.1 등)를 설계 카드에 | 0 건 → 표시 | 그림 `r03_purlin_regions` |
| V4-13 | 고침 | 구간 결과에 `members`(랩 2), 표의 Mu 는 「부재당 Mu(합 …)」, 강도 열 「(부재당)」 | 합계 Mu 대 한 부재 강도 | 같음 |
| V4-14 | 고침 | 게이지 막대만 100 % 에서 자르고 글자는 실제 값 | 「120 %」 → 「138 %」 | 같음 |
| V4-15 | 고침 | 보고서의 Mu 는 결과의 `Mu_checked`/`Mu` 또는 'F flexure' 비 × 강도(`_requiredMoment`) | 이용률 × 강도 역산 → 실제 값 | 코드 |
| V4-17 | 고침 | 자동 계산 → 직접 입력 모드로 바꾸면 하중 분석이 채운 Mu(+) · Lb(+) · Cb(+) · β 칸을 비우고 알림 | 직접 휨에 섞여 NG 1.896 → 비움 | 코드 |
| V4-19 | 고침 | `extension.ts`: 시험 모드(`STCFSD_TEST_MODE`, `ExtensionMode.Test`)에서 MCP 설정 파일을 쓰지 않음 | test/vscode 가 사용자 설정을 다시 쓸 수 있음 → 안 씀 | 코드 |
| V4-20 | 고침 | 구간 Ly 가 없으면 Lb 를 보내지 않음(전 0 = 완전 구속), 지점 M 을 모르면 그 지점 검토를 「평가하지 않음」(전 Mu 0) | — | 코드 |
| V4-22 | 고침 | 구간 라벨의 지점 번호를 1 부터(엔진 구간 support + 1), 「왼쪽/오른쪽」 | 「지점 2 left」(= 26 ft, 웹 크리플링 문장은 지점 3) → 「지점 3 왼쪽」 | 코드 |
| V4-23 | 고침 | 검증 탭 §I6.2.1 항목은 퍼린 결과의 구간 R 도 본다 | 「미적용」 과 「R 0.7」 이 같이 → 일치 | 코드 |
| V4-24 (일부) | 고침 | DSM 표의 미분리 0 은 「— (분리 안 됨)」, 진동 표 열 폭 · 유효 숫자 | — | 그림 `r02_vibration` |
| V4-25 | 고침 | 검증 탭 랩 길이: 한쪽 0 이면 불합격(전 `|| 999` 로 다른 쪽만), 단면 H 가 비면 판정 없음(전 100 mm) | — | 코드 |
| 조정자 지시(분류 알림) | 고침 | 둥근 모서리 등 cFSM 분류 불가는 경고가 아니라 가정 한 줄(「모드 분류: cFSM 을 쓸 수 없는 모델(둥근 모서리) — 반파장 순서로 정함」, 중복 없음), 전체 문장은 분류 그림 옆(`classify-status`)에만. 이 문장을 경고로 올리던 곳은 **W3 의 `_signatureDsm`** 이었다(엔진 · 서버 아님) | 퍼린 경고 상자에 같은 문장 2 번 → 가정 1 줄 | 그림 `r03_purlin_regions` |
| V4-05 · V4-16 | W2 | MCP `design_purlin` 스키마 · SI 응답 | | |
| V4-04 (엔진) · V4-18 (엔진 쪽) | F4 | | | |

### 본 화면 (Read 로 열어 확인한 그림, `test/rendered/out/shots/`)

- `r01_after_mcp_template.png` — MCP 로 단면을 바꾼 뒤 설계 카드: 「결과 없음 — Section template changed. 설계 검토를 다시 실행하세요.」, OK/NG 없음.
- `r01b_after_open_old_file.png` — 옛 판(1.2) 파일을 연 뒤 설계 카드: 「결과 없음 — project opened.」.
- `r03_purlin_regions.png` — 설계 탭 전체(II-2A, 끝 경간도 한 두께): 구간 표(β 열 — 랩 끝 1.238 · 1.245 · 1.260, 랩 행 「52.50 /부재 · 합 105.01」), 종합 ✗ NG(지배: 끝 경간 양력 하부압축 R 0.7, 138 % — 게이지 글자 실제 값), 평가하지 못한 항목(랩 안 지점 웹 크리플링 · 하중 분석 I6.4.1 · 처짐), 경고 상자에 둥근 모서리 문장 없음, 가정 블록에 「모드 분류: … 반파장 순서로 정함」 1 줄 · 랩 분담 · Vu 짝짓기 · 하중 가정, β 칸 「Lcrd 를 아직 모릅니다 … 자동 계산 모드: 이 칸은 설계에 쓰지 않습니다」, 위쪽 DSM · 진동 칸 「결과 없음 — Section template changed」.
- `r06_lap_without_Se.png` — Lap: 「유효단면계수 Se 가 없어 Lap 휨(§F3/F4/H2)은 검토하지 않았습니다 — 판정 없음」, 종합 「⚠ 판정 없음 (미검토) (패스너 DCR=0.918)」.
- `r02_vibration.png` — C-C 진동: 사용한 밀도 · 기본 밀도 알림 · 종방향 항 · 「크기: 길이 60개 · 길이당 최대 21항 · 최대 DOF 3108 (예상 약 34 s)」 · 길이 · 진동수 표(고친 열 폭).
- `r04_blank_fy_blocked.png` — 「설계 검토: 입력이 비어 있습니다 — 설계 Fy」.

화면에서 본 것 가운데 남은 것(엔진 쪽):
- R 경로 양력 구간의 단계 카드가 F2 경로(Mne 12.75 → Mn 12.75)를 보이는데 설계강도는 R·Mnlo(Mn/Ω 36.03) — 단계와 강도가 다른 길을 말한다(F4).
- 진동 「No mass density given … was assumed」 는 엔진(F3 `vibration/solver.py`)이 severity warning 진단으로 낸다 — 기본값으로 채운 입력이므로 assumptions 로 옮길 것(F3). 호스트는 진단의 severity 를 그대로 따른다.
- 하중 분석의 「Deck restraint estimates are preliminary…」 · 「RP17-2 curve fit has a coefficient of variation…」(범위 문장 → scope_notes) 과 「kx: … not given — Example II-1C values used」(기본값 입력 → assumptions)는 엔진 `design/loads/bracing.py`(F7)가 `warnings` 로 낸다 — 거기서 옮길 것. 호스트는 엔진의 분류를 그대로 보인다(`[하중]` 접두만 붙임).

### V4 뒤 후속

- **W2**: `mcp_si_chain` 의 V4-05 검사가 지금 실패한다 — 호스트 `vibration` 이 새로 받는 `lengths`(in 목록) · `confirm_large`(bool)를 `run_vibration` 스키마에 넣을 것(SI 면 lengths 는 mm). 응답의 `needs_confirmation` · `size` 설명.
- **F6 `lap_connection.py:281`**: `Se = params.get('Se') or params.get('Sf')` — Se 가 없으면 총단면 Sf 로 휨을 판정한다(F6 의 「Se 없으면 NOT_CHECKED」 계약과 어긋남). 화면은 Se 를 모르면 Sf 도 보내지 않게 막았다.
- **F4**: 위 「R 경로 단계」. **F3 · F7**: 위 알림 분류.
- 렌더 시험: `npm run test:rendered`(약 1.5 분). `test/rendered/lib.js` 의 `start()` 가 진짜 호스트 · 파이썬 · 브라우저를 띄운다(포트 47831 · 9353). W2 는 V4 의 `mcp.js` 와 같은 방식으로 진짜 `McpBridgeServer` 를 붙여 MCP → 진짜 패널 종단 시험을 만들 수 있다.

### V4 뒤 게이트

```
.venv\Scripts\python.exe test\python\run_all.py      → Ran 378 tests in 51.722s / OK
.venv\Scripts\ruff.exe check python test           → All checks passed!
npx tsc -p ./ --noEmit                               → 출력 없음 (exit 0)
npx eslint src webview/js test/webview               → 출력 없음 (exit 0)
npm run test:webview                                 → mcp_si_chain 에서 멈춤: "V4-05 host ↔ schema gaps: host action 'vibration' accepts 'lengths' / 'confirm_large' but no MCP tool (run_vibration) offers it" (W2 후속). 그 뒤 W3 시험은 따로 돌려 PASS: verdict_display_contract · panel_host_contract (8.5 s) · design_state_v13_contract
node --check webview/js/app.js                       → OK
npm run test:rendered                                → test:rendered: PASS (8/8), page exceptions 0, console errors 0
npm run build:mcp && npm run check:mcp-parity (W2)   → MCP parity OK: deployed bundle matches source definitions
```

## V4 재검증 뒤 고친 것

대상: `verify/V4-boundary-rendered.md` 「재검증」 의 W3 몫 — V4-10 남은 길 · V4-18 남은 것 · V4-26 · V4-27 · V4-28 · V4-30 · V4-32 · V4-33 · V4-34 · V4-35, 위젯 동기화, V4-31 의 화면 쪽 — 와 렌더 시험 보강. 엔진 · MCP 파일은 고치지 않았다.

| 번호 | 무엇을 | 전 → 후 | 잠근 시험 |
|---|---|---|---|
| V4-10 (남은 길) | 호스트 `_loadProjectFile` 가 입력 기록이 없는 파일(v1.0 · MCP 원시 모델)에도 `restoreDesignInputs({})` 를 보낸다 → 화면은 모든 칸을 처음 값으로 되돌린다. 모델 메타데이터(`sectionTemplate` · `sectionParams` · `sectionType` · `cornerRadius` · `loadCase` · `loadFy` · `loadValues`)는 파일에 있는 것만 쓴다 — 전에는 이전 프로젝트의 템플릿 기록이 남아 화면이 lippedc 를 보였다. 되돌린 Fy 를 해석 탭 표시에도 | `Example/test.csd`(v1.0) 열기 뒤 Mu(+) 84.92 · Lm 270 · Fub 120 · lippedc H 8 이 남음 → 0 · 처음 값 · 빈 칸 · 「직접 입력」 | `panel_host_contract`(빈 restore, resultsCleared 가 먼저) · 렌더 「V4-10 a v1.0 file…」 |
| 위젯 동기화 | `modelLoaded` 와 복원 뒤(`_fireRestoredInputUpdates`)에 `_syncAnalysisWidgetsFromModel`: BC · 반파장 최소/최대/개수 · 고유치 수 · 하중 경우(엔진 이름 `bending_xx` → 화면 `bending_xx_pos`)와 custom P · Mxx · Mzz(호스트가 `loadValues` 로 기록 — `set_load_case` custom · GUI 해석 실행) · E/ν/G(`prop`) · 단면 템플릿과 치수(`sectionParams`, 없으면 「직접 입력」). 값만 넣고 change 를 내지 않는다(결과를 지우지 않음). 모델 길이가 로그 간격이 아니면 「해석 실행은 다시 나눔」 한 줄. 파일 · MCP 의 절점 응력 분포(custom, P · M 없음)는 P · M 칸을 비우고 그 뜻을 밝히며, 비운 채 해석을 실행하면 저장 분포를 그대로 쓴다(전: 0 하중이나 기준응력 압축으로 덮음) | MCP `set_bc C-C` 뒤 「해석 실행」 이 S-S 로 되돌림 → C-C 그대로 | 렌더 「widget sync…」(BC · 길이 · custom P/M · GUI 실행 본문 BC = C-C) |
| cFSM 체크 | 화면의 체크 다섯(활성화 · G · D · L · O)은 분류 표시 설정이고, 웹뷰가 어디에도 보내지 않는다. 모델의 `GBTcon` 구속(MCP `set_gbtcon`, 모드 번호 벡터)과 다른 것이라 체크로 옮기지 않았다. 대신 구속이 있으면 그 칸 아래에 「모델에 cFSM 모드 구속이 있습니다(G n개 …) — 해석 실행은 이 구속으로」 를 적는다(호스트는 GUI 실행에도 `GBTcon` 을 유지) | — | 코드 |
| V4-28 | 결과를 지우지 않는 칸을 `designState.VIEW_ONLY_CONTROLS` 에 까닭과 함께 적고, ③ · ① 탭의 change 청취기가 그 칸을 거른다. 목록: `select-length` · `select-mode`(모드 형상 보기); `vib-rho` · `vib-lengths`(진동에만); `select-load-case` · `input-load-P/Mxx/Mzz` · `select-bc` · `input-len-min/max/n` · `input-neigs`(해석 실행 때 적용 — 그때 호스트가 해석 · 설계를 무효화); `chk-cfsm-*`(분류 표시). `plastic-fy` 는 설계 Fy 를 동기화하므로 지운다 | 모드 형상 길이 한 칸 → 설계 · Lap · 보고서 · 검증 지워짐 → 그대로; 설계 Lb → 지워짐 | `design_state_v13_contract`(목록의 칸이 ③/① 탭에 있고 설계 입력이 아님, 양방향) · 렌더 「V4-28 …」(보기 칸 8 개를 바꿔도 `invalidateDerivedResults` 없음 · 카드 유지, Lb 바꾸면 지움) |
| V4-27 | 엔진이 `not_used` 로 표시한 단계(문자열 번호 2a · 5a 포함)는 흐리게(opacity 0.5), 「지배」 표지 없이. R 경로(`not_used` 단계 + `R_uplift`)면 강도 카드 F2 · F3 · F4 는 흐리게 「(참고)」, 그 옆에 「Mnℓo (Fn = Fy)」 · 「Mn = R·Mnℓo (R 0.7)」 카드(지배)와 한 줄 설명 | 「Global 12.75 · Local 12.75 · Distort. 76.93」 바로 아래 Mn/Ω 36.03 → 참고 카드 3 + Mnℓo 85.98 · Mn 60.19 | `panel_host_contract`(R 구간 단계 `not_used`) · 렌더 퍼린 단계(「(참고)」 · 「Mn = R·Mnℓo」 · 흐린 단계 ≥ 3) |
| V4-30 | 보고서 단계 5: R 경로면 「Mn(−) = R · Mnℓo = 0.7 × 85.98 = 60.19 (§I6.2.1, Eq. I6.2.1-1)」 + 참고 줄, 단계 2–4 머리에 「[참고 — §I6.2.1 R 계수법이 대신함]」. 지배 하중조합은 지배 구간 자신의 것 — 호스트가 구간마다 `combo`(그 구간 포락선의 조합)를 붙이고 `governing.combo` 로 넘긴다 | 「min(12.75, 12.75, 76.93) = 60.16」 · 「지배 하중조합은 3: D+Lr」 → R·Mnℓo · 「지배 구간(양력 하부압축 1.05–19.90 ft)의 하중조합은 7: 0.6D+0.6W」 | `panel_host_contract`(governing.combo = 구간 combo) · 렌더(보고서 글) |
| V4-32 | 빈 필수 칸 목록이 칸(요소) · 화면 이름 · 탭을 지닌다(`_missEntry`). 막힘 문구는 상태줄과 **누른 단추 바로 아래** 상자(`<단추 id>-missing`)에 「부재 간격 (② 하중계산 탭), Fy (① 단면·재료 탭)」 — 이름을 누르면 그 탭으로 가서 칸을 강조한다(빨간 테두리, 채우면 사라짐). 읽기 전용 설계 Fy 는 그 값을 정하는 ①탭 Fy 로 안내. 하중 분석 · 설계 · 템플릿 · 해석 · 소성 · Lap · 단일 접합 모두 같은 함수 | 하중 탭에서 막히면 아무 표시 없음 → 하중 탭 단추 아래 상자 | 렌더 V4-06 단계(하중 탭 상자 · 탭 이름 · 링크 → ①탭 · 강조 · 해제) |
| V4-33 | `utils.userText`: 엔진 · MCP 인자 이름 → 「화면 이름」(탭). 대상: `i621_conditions_confirmed` · `I_span_in4` · `pattern_loading`(`=False` → 끔) · `lr_reduced` · `insulation_in` · `brace_points_ft` · `R_tested_uplift` · `kphi/kx_override` · `May_strength` · `wc_*` · `dist_M1_M2` · `dist_Lm` · `use_*` · `confirm_large`. 적용한 곳: 경고 · 가정 · 범위 · 미평가 목록(utils), 해석 경고 상자, 데크 안내, 엔진 · 접합 · 하중 · 설계 오류(`_engineErrorText` — 시간 초과는 한국어 문장; 오류 글도 이스케이프). 무효화 까닭(`Section template changed` 등 — MCP 와 같은 영어)은 `_reasonKo`, 종방향 항 출처(`current buckling analysis` 등)는 `_termSourceKo`. SI 화면의 퍼린 구간 라벨 「a–b ft」 → m. 진동 확인 문구에서 `confirm_large` 를 뺐다(MCP 용은 `confirm_param` 필드) | 「i621_conditions_confirmed 가 없거나 조건 밖」 → 「「§I6.2.1 조건 (i)–(n) 확인」(② 하중계산 탭) …」 | `design_state_v13_contract`(표의 모든 이름이 바뀜 · 라벨이 화면 HTML 에 있음) · 렌더(설계 탭에 `wc_P` 없음, 까닭 한국어) |
| V4-18 (남은 것) | 하중 분석 결과의 `wc_reactions` 가운데 가장 큰 지압 반력과 그 지점 형식을 `design-wc-P` · `design-wc-support` 에 넣는다. 직접 휨에서 반력 칸이 비어 엔진이 Vu 를 썼으면(F4 가정 「§G5/§H3: … Vu … wc_P」) 웹 크리플링 카드에 「지압 하중 — Vu 를 썼음, 반력 P 칸이 비어 있음」, 엔진 가정 줄은 「웹 크리플링 반력 P」 로 | 반력 칸이 비면 G5 NG 의 까닭이 안 보임 → 카드 · 가정에 | 렌더 V4-28 단계(카드 · 가정) · 퍼린 단계(반력 칸 채움) |
| V4-26 | `addRegions` 의 id 를 목록마다가 아니라 이름마다 이어 센다; 양력 지점부 랩 조각은 `uplift_support_lap-n`, 양력 랩은 `uplift_lap-n` | `uplift_support-1…6` 이 두 번 → 겹침 없음 | `panel_host_contract` · 렌더(id 유일) |
| V4-34 | 데크 안내를 `deck.warnings`(경고 색) · `deck.assumptions`(보통 글) · `deck.scope_notes`(접힌 「데크 범위 안내 n건」)로 나눈다 — 옛 `deck.warning` 하나뿐이면 범위 안내로 본다. 해석 경고 상자는 경고가 0 이고 정보 줄만이면 중립 `info-box` | 「Deck restraint estimates are preliminary…」 경고 색 → 접힌 범위 안내 | 코드 · 그림 `r03_purlin_regions` |
| V4-35 | 호스트 `vibration`: 예상이 엔진 호출 제한(`PythonBridge.timeoutMs`, 300 s)을 넘으면 확인해도 실행하지 않고 `{exceeds_limit, error, size: {limit_s, lengths_that_fit}}` 를 돌려준다 — 줄이는 법(진동 길이 칸에 약 n 개 이하 · S-S · 성긴 메시). 화면은 「그래도 실행」 없이 그 문장만. 진동 단추는 칸에 「실행 중…」 을 쓰고, `vibrationError`(시간 초과)는 진동 칸에 한국어 오류로 바꾼다 | 「그래도 실행 (예상 433 s)」 → 반드시 취소; 시간 초과 뒤 「실행 중 — 예상 433 s」 가 남음 → 둘 다 없음 | `panel_host_contract`(제한 1 ms 로 줄여 confirm 유무 둘 다 실행 안 함) · 렌더 「V4-35 …」 |
| V4-31 (화면 쪽) | 웹 크리플링 Lo · eITF · sf 의 0 은 「없음」 — 보내지 않음(`_optPos`). 하중 본문의 빈 `kphi_override` · `kx_override` · `section` 은 `null` 이 아니라 생략(렌더 시험이 찾은 두 번째 스키마 오류: `deck.kx_override: expected number, received null`) | GUI 본문 → MCP `design_purlin` 스키마 오류 → 통과, 38 구간 같음 | 렌더 퍼린 단계(화면 본문 그대로 진짜 MCP 서버 → 브리지 → 패널, 구간별 같음) |
| V4-06 (덤) | 전처리 Fy · Fu · 소성 fy 를 비우면 동기화가 245 / 400 MPa 를 다시 채우던 것을 없앰(빈 칸은 빈 칸 — 실행 때 막힘) | | 렌더 V4-06 |
| 복원 표시 | 복원 · 되돌림 값은 단위 전환과 같은 12 자리(전 `118.11023622047244`) | | — |

렌더 시험 보강(`test/rendered/run.js` 8 → 13 단계, 새 `test/rendered/mcp.js`):
- 옛 파일: 합성 1.2 파일에 더해 **진짜 v1.0 `Example/test.csd`**(입력 기록 없음, 읽기만) — 칸 초기화 · 「직접 입력」 · 해석 칸 = 모델 · 저장 응력 분포 안내 · Fy 표시.
- 위젯 동기화(MCP 의 C-C · 길이 · custom P/M → 칸, GUI 실행이 C-C 를 보냄).
- V4-28 양방향 + V4-18 빈 반력.
- V4-02: **드롭다운에서 C-C** → GUI 해석 실행 → 진동(12 길이, 8 s). V4-35: 제한 초과 · 시간 초과 표시.
- 퍼린: 반력 칸 채움, id 유일, 0 인 wc 칸 미전송, **GUI 본문 → 진짜 MCP 스키마 → 같은 구간 결과**, R 경로 카드 · 흐린 단계, 보고서 R·Mnℓo · 지배 구간 조합.
- V4-06 · V4-32: 하중 탭 상자 · 탭 이름 · 링크 이동 · 강조. 새 단계: 단일 접합 빈 t2 · n(보내지 않음, 엔진 F6 이 거절 → 판정 없음 · t2 를 말함).

### 본 화면 (재검증 뒤, Read 로 열어 확인한 그림, `test/rendered/out/shots/`)

- `r03_purlin_regions.png` — 설계 탭 전체: 강도 카드 Global 12.75 · Local 12.75 · Distort. 76.95 가 흐림 「(참고)」, 「Mnℓo (Fn = Fy) 85.98」 · 「Mn = R·Mnℓo (R 0.7) 60.19 지배」, 설명 줄. 단계 2a · 2 · 3 · 4 · 5 는 「[참고 — §I6.2.1 이 대신함, 강도에 쓰지 않음]」 으로 흐림, 1 · 5a · 5b · 6 · 7 은 보통. DSM · 진동 칸 「결과 없음 — 단면 템플릿이 바뀌었습니다」(한국어). 해석 칸 반파장 0.3937–393.7 in · 60.
- `r_v427_cards.png` — 구간 표(굵은 지배 행 「양력 하부압축 1.05–19.90 ft (R=0.7)」 137.5 %). 표 아래 카드는 그림 범위 밖이라 잘림 — 위 전체 그림에서 확인.
- `r_v432_loads_blocked.png` — 하중 탭 단추 아래 「하중 분석: 입력이 비어 있습니다 — 부재 간격 (② 하중계산 탭), Fy (① 단면·재료 탭)」(밑줄 링크).
- `r_vibration_over_limit.png` — 「진동 해석을 실행하지 않았습니다: 예상 약 4 s 가 엔진 호출 시간 제한 0 s 를 넘습니다 … 줄이려면: 진동 길이를 … 약 1개 이하 …」(시험이 제한을 1 ms 로 줄였기 때문에 0 s · 1개), 단추 없음.
- `r_vibration_timeout.png` — 「진동 해석 실패: 엔진 호출이 시간 제한(300 s)을 넘어 취소되었습니다 — 엔진을 다시 시작했습니다 …」, 「실행 중」 없음.
- `r_v418_blank_reaction.png` — 웹 크리플링 카드의 「지압 하중 | Vu 를 썼음 — 반력 P 칸이 비어 있음」(값 열 오른쪽이 카드 폭 때문에 잘림 — 기존 배치).
- `r_conn_blank_t2_n.png` — 「screw: t2(두 번째 접합 부재 두께) 미입력 — t2 = t1 로 가정하지 않는다 …」, 판정 없음.
- `r_open_v10_widgets.png` — v1.0 열기 뒤: 하중 케이스 「조합 (P + Mxx + Mzz)」, P · Mxx · Mzz 빈 칸, 「모델의 절점 응력은 저장된 분포입니다 … 비워 두면 그 분포를 그대로」, Fy 표시 = 되돌린 ① Fy.
- `r_v430_report.png` — 보고서 첫 화면(단면 · 성질). 단계 5 는 스크롤 상자 안이라 그림에 없고, 시험이 글로 확인(「Mn(-) = R · Mnℓo = 0.7 × …」, 「지배 구간(…)의 하중조합은 7: 0.6D+0.6W」).

### 재검증 뒤 후속

- **W2**: `run_vibration` 응답의 새 필드 — `exceeds_limit`(true 면 `error` 와 함께 실행하지 않음, `size.limit_s` · `size.lengths_that_fit`), 확인이 필요할 때 `confirm_param: 'confirm_large'`(호스트 문장에서 인자 이름을 뺐다). 도구 설명에 적을 것.
- **관찰(호스트 설계, 고치지 않음)**: 설계 DSM 준비(`_signatureDsm`)는 모델의 반파장 격자를 쓴다. 성긴 격자(예: 10–200 in 12 개)면 랩 끝 Lcrd 가 바뀌어 β 1.238 → 1.3, Ma 4.09 → 4.15 kip-ft. 설계 준비에 고정 격자를 쓸지는 결정이 필요하다(사용자 결정 목록 후보). 렌더 시험은 V4-02 뒤 처음 격자로 되돌린다.
- **cFSM 체크**: 웹뷰가 보내지 않는 분류 표시 설정이다(위). 연결할지 지울지 결정이 필요하다.

### 재검증 뒤 게이트

```
.venv\Scripts\python.exe test\python\run_all.py      → Ran 386 tests in 58.874s / OK
.venv\Scripts\ruff.exe check python test           → All checks passed!
npx tsc -p ./ --noEmit                               → 출력 없음 (exit 0)
npx eslint src webview/js test/webview               → 출력 없음 (exit 0)
npm run test:webview                                 → exit 0 — … mcp_si_chain: PASS (28 US/SI comparisons …) · verdict_display_contract: PASS · panel_host_contract: PASS (8.7 s) · design_state_v13_contract: PASS
node --check webview/js/app.js                       → OK
npm run check:mcp-parity (W2)                        → MCP parity OK: deployed bundle matches source definitions
npm run test:rendered                                → test:rendered: PASS (13/13), page exceptions: 0, console errors: 0
```
