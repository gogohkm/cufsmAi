# V8 — 마일스톤 1 재확인: V6b · V7 의 P0 / P1 이 닫혔나, 그리고 두 질문 (커밋 `c223b80`)

대상: `feature/desktop-program` 의 `c223b80`(분리된 작업 트리 `…\scratchpad\v8`). 넓은 새 검토가 아니라 V6b-01 · V6b-02 · V7-01 · V7-02 · V7-03 · V7-04 · V7-05 · V7-40 · V7-41 의 재현과, 질문 A(반올림 전 소요 · 스레드 수) · B(랩 도구의 Se). 검증자는 제품 코드 · 시험을 고치지 않았고 이 보고서만 썼다. 새 결함은 V8-xx. 심각도는 V7 과 같은 뜻으로 썼다(P0 = 보통 쓰임에서 틀린 판정 · 보안 경계가 뚫림, P1 = 일을 잃음 · 남는 프로세스 같은 심한 결함, P2 = 틀린 값이지만 보수 측이거나 드문 길, P3 = 표기 · 방어 깊이 · 문서).

## 요약

- **아홉 건 모두 닫힘**(V6b-01 · V6b-02 · V7-01 · V7-02 · V7-03 · V7-04 · V7-05 · V7-40 · V7-41). 남은 것은 아래 새 결함 다섯(P2 1 · P3 4)과 의심 둘.
- **질문 A — 맞다.** II-2A(1 ft 내민 6경간, 랩), 같은 것에 웹 크리플링 + 패턴, 1 ft 내민 4경간(LRFD, 랩, 웹 크리플링), V6b 의 `flip` 두 갈래 — 엔진 호출 **200건 · 값 1,548개**를 하중 해석 기록에서 **위치마다 따로**(구간 id → 그 목록의 n째 기록, 검토점 → 그 기록의 `x_M_max_ft` · 격자의 V 최대 · 그 지점의 `wc_reactions`/`locations`) 다시 지어 대조 — **어긋남 0**(×12, 랩 ½, `|Mu|`, 플랜지 부호, 지점 면 쪽 모두). 하중 해석 · 모든 소요는 `OPENBLAS_NUM_THREADS` 1 · 4 · 8 에서 **바이트까지 같다**. 다만 FSM 서명곡선(정 · 부 DSM)은 1 과 4/8 사이에서 끝자리가 다르다(Mcre 상대 1.1e-7 – 1.07e-6) — V8-04.
- **질문 B — 틀린 값이다(이 예제에서는 크게 보수 측).** 랩 도구가 받는 `Se` 는 「지배 구간」 결과의 `Mnl / Fy_used` — II-2A 에서는 양력 하부압축 구간(Ly 226 in 의 횡비틀림으로 줄인) Mnℓ 12.71 kip-in 에서 **Se = 0.2311 in³**. 매뉴얼은 랩 안을 횡비틀림 · 뒤틀림에 구속된 것으로 두고 부재마다 Mnℓ = Se·Fy(Fn = Fy, 0.059 는 Se 1.80 in³)를 더한다. 결과: 첫 안쪽 지점(Mu 8.75 kip-ft = 105 kip-in, ASD)에서 도구의 랩 휨 **6.898 불합격**(H2 6.908, 뒤틀림 1.141 도 불합격) — 같은 지점의 퍼린 자신의 랩 구간 검토는 **1.0207**, 매뉴얼은 **0.788**(0.070 + 0.059), 같은 두 0.059 로 Se 1.80 이면 **0.886**. V8-01.
- 새 결함: **V8-01 (P2)** 랩 도구의 Se · Mnd 가 엉뚱한 구간에서 온다. **V8-02 (P3)** 인쇄의 허용 목록이 따옴표 안의 `>` 하나로 지나가지고(CSP 가 없으면 스크립트가 돈다), 문서의 「남는 위험 — 밖으로 보내지는 못한다」는 WebRTC 의 UDP 로 틀린다. **V8-03 (P3)** 결과 봉인의 모델 지문에 `sectionType` · `cornerRadius` 가 없다(템플릿 없는 모델에서 엔진 요청을 바꾸는데 봉인은 그대로). **V8-04 (P3)** FSM 값의 스레드 의존. **V8-05 (P3)** 새로 고침 뒤 지운 카드의 까닭 글이 「프로젝트를 열었습니다」.

## 어떻게 돌렸나

- 사본: `…\scratchpad\v8`(`c223b80`, `node_modules` 셋은 본 저장소로 가는 junction — 건드리지 않음). `npx tsc -p ./` · `cd desktop && npm run build` · `cd desktop/shell && node build.mjs` 로 `out/` · `dist/` 만 생김(`git status` 깨끗).
- 호스트 탐침은 사본의 시험 도구(`test/webview/panel_harness.js` 의 `loadTs` · `makeFakeVscode`)로 진짜 `StcfsdPanel` + 진짜 파이썬(`C:\Coding_Works\cufsmAi\.venv`)을 띄우되 **기록자 열쇠 폴더는 늘 scratch 의 임시 폴더**(`StcfsdPanel.writerKeyDir`), `TEMP`/`TMP` 도 scratch(`…\v8probes\tmp`). 인쇄는 시스템 Edge headless(제품의 `printHtmlToPdf` 그대로). 화면은 시험 모드 Electron(`STCFSD_SHELL_TEST=1`, 창 보이지 않음 — 끝에 `visible false · focused false · show 0 · focus 0`).
- 탐침(남겨 둠, `…\scratchpad\v8probes\`): `_env.js` · `a1_capture.js <threads>`(퍼린 경로의 모든 `aisi_design` 요청 · 결과와 하중 해석을 잡음) · `a1_diff.js` · `a1_diff2.js`(스레드 비교) · `a2_locate.js <capture>`(위치마다 다시 지어 대조) · `a3_flip.js` · `v6b02_cmy.py` · `p1_seal.js` · `p1b_seal_gap.js` · `p2_report.js` · `p2_print.js` · `p2_print_nocsp.js` · `p4_loadproject.js` · `b_lap_se.py` · `b_lap_wiring.js` · `screens\s1.mjs`(+ `lib.mjs`, 로그 `screens\logs\s1.out.txt`). 잡은 결과는 `v8probes\out\`.
- 지시대로 전체 시험 묶음은 돌리지 않았다. 기존 시험 파일도 하나도 돌리지 않았다(내 탐침이 증거).

## 처리 상태

| 번호 | 상태 | 증거(재현) |
|---|---|---|
| **V6b-01** (P0) | **닫힘** | `a3_flip.js`: V6b 의 `flip`(4경간 25 ft, 랩 0.5 ft, ASD) — 지점 2 왼쪽 랩(24.5 – 25 ft) M_max 검토점의 Vu 0.89382(왼쪽 면) → H2 **1.00995 불합격**(전: 0.995 합격), 오른쪽 랩은 자기 면 0.78838 → 0.9950. `a2_locate.js` 로 다섯 사례의 모든 지점 위 검토점(M_max · V_max · 지점)이 그 지점 `locations[].unrounded.Vu_left/Vu_right` 의 **구간 쪽 면**(구간 안이면 큰 면)과 일치, V_max 탐색도 면 값을 넣는다. 면 값은 매뉴얼 II-2A 와 맞다(첫 안쪽 지점 왼쪽 1.78522 / 오른쪽 1.58953 kips — 매뉴얼 1.78 / 1.59, 왼쪽 지점 1.08978 — 1.09) |
| **V6b-02** (P1) | **닫힘** | `v6b02_cmy.py`(V6 의 C9 사례): Cmy 없이 `dist_M1_M2` 0.5 또는 −1 → Cmy **1.0**, B1y 1.2217, H1.2 0.5323 + 가정 두 줄(「dist_M1_M2 는 … Cm 에 쓰지 않았다」). 축 자신의 `Cmy_M1_M2` 0.5 → Cmy 0.4(출처 `user_input Cmy_M1_M2`). Cmx 도 같은 규칙 |
| **V7-01** (P0) | **닫힘**(남은 틈 V8-03) | `p1_seal.js`(열쇠 폴더 scratch): 정직한 파일 A(불합격 보) · B(통과)는 다시 열면 모두 돌아옴. 아래는 **모두 결과를 버리고 까닭을 알림**: 봉인 없음 · 결과의 pass/비 조작 · 입력 Fy 33(봉인 그대로) · B 의 봉인을 A 에 · B 의 결과+봉인을 A 의 입력에 · A 의 결과+봉인 아래 B 의 입력 · 다른 열쇠(`not_this_pc`) · 열쇠 파일 없음(열쇠를 **만들지 않음** 확인) · 열쇠 폴더 null · `case` 지우고 `designInputs` 만 · `resultsEngine` 지움 · 봉인 schema 바꿈 · 봉인에 있는 결과 하나 지움 · 봉인 항목 하나 지움(서명 틀림) · 지어낸 `lapResult`/`loadAnalysis` 끼움 · 퍼린 파일의 `loadAnalysis` 한 값 · 경간 길이 · `mcpOnly` 추가 · Lap 결과의 판정 조작 · 퍼린 결과만 지움(Lap 은 남김). AI 의 `load_project` 는 정직한 파일도 결과를 되살리지 않음. 되살아나도 맞는 것: `version` 1.0 표지만 바꿈(내용 · 봉인 같음), `timestamp`, 보기 단위, 출처 꼬리표(봉인 밖 — 판정과 무관), `derivedStateSignature` 를 바꾸면 설계만 안 돌아옴(안전 쪽) |
| **V7-02** (P0) | **닫힘**(방어 깊이의 말은 틀림 — V8-02) | 층 1(이스케이프), `p2_report.js`: 퍼린 + Lap + 부재 설계의 호스트 결과에 든 **글 609칸 모두**에 `<b id="X_…">` 표지, 파일 이름 `name'&;%23 x.csd`, `mcpOnly` 글, MCP 인자의 낯선 글(`wc_fastened` · `name` · `note` · `reason`) → `generate_report` US · SI: **날것 0**, 이스케이프 138, `<script` · `on…=` 0. 좌굴 보고서도 날것 0, 화면이 준 그림의 `onerror` · `javascript:` · `svg+xml` · `file:` 모두 빠짐. 층 2 · 3(층 1 을 지났다고 치고), `p2_print.js`: 여덟 가지 공격 문서(따옴표 안 `>` 로 스타일 url · 이벤트 처리기, CSS 이스케이프 `\75rl(//…)`, meta refresh 변형, svg 안 `@import`, `image-set("http…")`) → **연결 0 · 스크립트 안 돎 · 다른 파일 안 실림**(CSP 가 막음). 남는 위험의 문장 확인은 V8-02 |
| V7-03 (P1) | **닫힘** | `p2_print.js` 끝: `for(;;){}` 문서(시험 전용으로 CSP 끔), `timeoutMs` 15 s → 25.4 s 에 `{ok:false, error:'PDF printing did not finish in 15 s — the printer was stopped and its files removed'}`(예외 아님), 그 인쇄의 표지가 명령줄에 든 프로세스 **0**, 임시 폴더 없음, `cufsm_pdf_*` 남은 것 0. 호스트의 `generateReportFiles` 는 그 오류를 `pdf_note` 로(코드) |
| V7-04 (P1) | **닫힘** | `p4_loadproject.js`: 사람 Lb 33.3 · Cb 1.4 → MCP `save_project raw.json` → `load_project raw.json` → **Lb 118.11 (default)**, Cb 1, dirty false — 화면의 열기와 같음(같은 파일을 화면으로 열어도 118.11 default). 1.0 `.csd` 도 처음 값 |
| V7-05 (P1) | **닫힘** | 같은 탐침: `discarded_unsaved_changes.values = [{Lb 33.3 user}, {Cb 1.4 user}]`, `restore.arguments` 를 그대로 `set_case_inputs` 하면 `accepted [Lb, Cb]` · Lb 33.3 · Cb 1.4 로 돌아옴. 1.4 파일 위로 열어도 버린 값(88 · 2.0)과 파일 경로. `restore_note` 가 「사람에게 먼저 물으라」 |
| **V7-40** (P0) | **닫힘** | `screens\s1.mjs`: (R2) AI `aisi_design` → 사람이 끼운 화면에서 Lb 9999 → 호스트 결과 `[]` → 새로 고침 → 설계 카드 「결과 없음 …」(옛 「종합 판정」 없음). (R3) AI `set_case_inputs` 로 지운 설계 → 새로 고침 → 카드 없음. (R4) Lap 결과 → `connMu` 변경(`invalidated: [lap]`) → 새로 고침 → 호스트 · 화면 모두 Lap 결과 없음. 까닭 글은 V8-05 |
| V7-41 (P1) | **닫힘** | 같은 탐침: 길 넷(페이지의 Ctrl+O · 제목 표시줄 「열기」 · 끼운 화면의 Open 단추 · 진짜 Ctrl+O 키 `sendInputEvent`) × 답 둘. 모두 화면 안 물음 「저장하지 않은 변경(…)이 있습니다 — 다른 파일을 열기 전에 저장할까요?」, `diag.unsaved = [{where:'page-open', how:'page', answer}]`. 「취소」 → 파일 · dirty · Lb 그대로, 「저장 안 함」 → 다른 파일 · 처음 값 |

## 질문 A — 퍼린 길이 엔진에 보내는 값은 하중 해석의 반올림 전 값, 맞는 자리의 것인가

**방법.** `a1_capture.js` 가 `design_purlin` 을 진짜 호스트로 돌리며 파이썬 다리의 `aisi_design` 호출을 모두 잡는다. `a2_locate.js` 는 호스트 코드를 쓰지 않고, 하중 해석 결과만으로 기대값을 따로 짓는다:
- 구간 id(`positive-n` · `negative-n` · `lap-n` · `uplift-n` · `uplift_support-n` · `uplift_support_lap-n` · `uplift_lap-n`) → 그 목록(`auto_params.unbraced.positive_regions` · `auto_params.negative_regions` · `lap_regions` · `uplift_bracing.negative_regions` · 양력 지점부 조각 — 조각은 내가 중력의 랩 구역으로 따로 잘라 양력 포락선에서 최대를 찾음 · `uplift_bracing.lap_regions`)의 n째 기록(호스트와 같은 거름: 반올림한 `M_max_abs > 1e-9`).
- M_max 검토점: `Mu = unrounded.M_max_abs × 12 × (랩 ½)`, `x = unrounded.x_M_max_ft × 12`, `Vu` = 그 격자점의 최대 |V|, 그 점이 지점이면 그 지점 `locations[].unrounded` 의 구간 쪽 면; `Lb = unrounded.Ly_in`, `Cb = unrounded.Cb`, `dist_M1_M2 = −(작은/큰)`(unrounded M1 · M2), `dist_Lm = Ly`; 랩은 `Lb` · `Cb` 없음 + `lap_region` + 진술. V_max 검토점: 구간 격자의 V 최대(면 값 포함, 첫 최대)와 그 점의 부호 쪽 M ×12. 지점 검토점: `wc_reactions[]` 중 그 지점 번호의 `unrounded.Pu` · `unrounded.x_ft`, `Mu = wc_M = |locations[지점].unrounded.Mu| × 12`, 면 전단, `wc_support` = 그 반력의 `case`. `moment_sign` 은 구간의 플랜지.
- 엔진 쪽도: 반올림 칸 = 반올림 전 값을 `display_rounding` 의 자리수로 반올림한 것, 구간 `M_max_abs` ≥ 그 구간 격자의 최대, `locations[].unrounded.Mu` = 그 지점 격자의 포락선(지배 부호), 면 값과 이웃 격자, `wc_reactions[].unrounded.Pu` = 같은 지점 `R_bearing` = `R_envelope_max[j]`, 지점 번호 ↔ `supports_ft`(자유단 포함 — 내민보에서도 하나씩 맞음).

| 사례 | 엔진 호출 | 대조한 값 | 어긋남 |
|---|---|---|---|
| II-2A(1 · 25 · 25 · 25 · 25 · 1 ft, 경간별 I, 랩 2.5/3.5 · 1/1 · 3.5/2.5, ASD, 진술) | 46 | 352 | 0 |
| II-2A + 웹 크리플링(N 3.5) + 패턴 | 48 | 374 | 0 |
| 1 ft 내민 4경간(랩 2/3, LRFD, 양력, 웹 크리플링) | 24 | 190 | 0 |
| `flip`(V6b) | 40 | 306 | 0 |
| `flip` + 진술 + 웹 크리플링 | 42 | 326 | 2 — 끝 지점 Mu 1.3e-12 kip-in 대 내 기대 0(끝 지점의 Mu 는 엔진이 `null` 로 줌 → 호스트가 포락선 값을 씀. 잡음 — 결함 아님) |

- 단위 · 부호: kip-ft → kip-in ×12(Mu · wc_M), ft → in ×12(x), Ly 는 in 그대로, 랩은 부재마다 ½(Mu · Vu), 지점 M 은 `|Mu|`, 부모멘트 · 랩 · 양력 하부압축은 `moment_sign '-'`, 정 · 양력 지점부는 `'+'` — 모두 맞음. **다른 기록 · 다른 키에서 온 값은 찾지 못했다.** 랩 끝 위치(`Lap end …`, 같은 `support` 번호)는 `Vu_left` · `R_bearing` 이 없어 면 · 반력 조회에 잡히지 않는다(맞음). 반올림 전 값이 없는 칸(`rounded_demand_fallbacks`)은 다섯 사례 모두 없음.
- II-2A 의 하중 해석은 매뉴얼과 맞는다(독립 비교): 반력 1.2048 / 3.3748 / 2.5709 kips(매뉴얼 1.21 / 3.37 / 2.58), 면 전단(위 표), 변곡점까지의 거리 6.10 · 7.59 · 4.94 ft → 구간 경계 19.90 · 33.59 · 46.05 ft(매뉴얼과 같은 수). 변곡점 목록에 자유단의 0 이 없고 모두 진짜 부호 변화(`e42adf1`).
- **스레드 수**(`a1_diff2.js`): 1 · 4 · 8 에서 `load_analysis` 전체, `analyze_loads` 요청 · 응답, 모든 `aisi_design` 의 소요 · 위치 칸이 **같다**. 4 와 8 은 결과 전체가 같다. 1 과 4 사이에서는 FSM 의 정 · 부 DSM 이 다르다 — II-2A `dsm_positive.Mcre` 789.59123 대 789.59114(상대 1.1e-7), 4경간 629.74143 대 629.74211(1.07e-6), Mcrd 1e-10, Mcrl 1e-14. 그 탓에 검토 항목의 비가 최대 상대 7.2e-11 다르다. 판정 · `utilization`(4자리) · 지배는 같다 → V8-04.

## 질문 B — 랩 도구의 Se

**어디서.** 퍼린 뒤의 「랩 접합」 은 `lastDesign` 을 쓴다: 호스트 `src/case/caseKeeper.ts:280-288`(`context` → 퍼린 결과면 `UTILS.pickGoverningPurlinDesign`), `webview/js/utils.js:201-226`(불합격 가운데 이용률이 가장 큰 구간 하나), 그 결과로 `src/case/requests.ts:240-249`(`buildLapRequest` — `Se = last.Se`, 없으면 `last.Mnl / last.Fy_used`; `Mnd = last.Mnd`; `Vn = last.Vn`), 화면도 같다(`webview/js/app.js:1110-1125`). 엔진 `python/design/lap_connection.py:294-366` 은 `Mnℓ = Se·Fy`, `Mn_lap = 2·Se·Fy`. 엔진의 휨 결과에는 `Se` 키가 없어 늘 `Mnl / Fy_used` 가 된다.

**II-2A 에서 실제로 가는 값**(`b_lap_wiring.js` — `design_purlin` 뒤 `set_case_inputs` 로 첫 안쪽 지점의 랩(30 / 42 in, Mu 105 kip-in, Vu 1.78, 볼트 ½ in 2열) → `run_case_check {what:'lap'}`, 화면 단추와 같은 본문): 지배 구간 `uplift-1`(양력 하부압축 1.05 – 19.90 ft, Ly 226.1 in, Cb 1.14 — 판정은 §I6.2.1 R 0.7) 의 `Mnl 12.71 · Mne 12.71 · Mnd 76.83` → **`Se 0.2311 in³`, `Mnd 76.83`, `Vn 3.90`**, `lap_restrained true`.

| Se 출처 | Se (in³) | 랩 휨 국부(ASD, 2 부재) | 그 밖 |
|---|---|---|---|
| 지금(지배 구간 `Mnl/Fy` = 12.71/55) | 0.2311 | 2·0.2311·55/1.67 = 15.2 kip-in → **6.898 불합격** | H2 6.908 불합격, 뒤틀림(Mnd 76.83 을 받아 평가) **1.141 불합격** — 진술이 있는데도 |
| 엔진 자신의 부모멘트 DSM, Fn = Fy(`lap-1` 구간의 Mnℓ 85.9 kip-in / 55) | 1.562 | **1.021 불합격** — 같은 지점의 퍼린 랩 구간 F3 1.0207 과 같음 | 뒤틀림 해당 없음(진술) |
| 매뉴얼 II-2A, 두 부재 0.059(Se 1.80) | 1.80 | 2·1.80·55/1.67 = 118.6 → **0.886 통과** | |
| 매뉴얼 II-2A 그대로(0.070 + 0.059: 2.25 + 1.80) | — | (124 + 99.0)/1.67 = 133.4 kip-in(11.1 kip-ft) → **0.788** | 매뉴얼 Mne = Mnd = My = (1.94 + 2.30)·55 = 233 kip-in |

**기준 · 매뉴얼.** S100-16 에 랩만의 조항은 없다. 매뉴얼 II-2A 의 가정 (c) 「랩 안의 강도는 부재 강도의 합」 · (f) 「지점과 랩 끝 사이는 횡비틀림 · 뒤틀림 좌굴을 받지 않는다」, 그리고 「In the lapped region over the support … sufficiently restrained … Fn = Fy」 → 부재마다 §F3.1 Eq. F3.1-1 `Mnℓ = Se·Fn`(Fn = Fy; DSM 이면 §F3.2 에서 Mne = My)과 §F4 는 Mnd = My, H2 · H3 의 Maℓo · Mnℓo 도 Fn = Fy. 즉 랩 검토의 Se 는 **그 랩 단면(부모멘트 — 하부 플랜지 압축)의, Fn = Fy 의 유효 단면계수**(또는 DSM 의 Mnℓ(Mne = My)/Fy)여야 하고, Mnd 는 진술이 있으면 My.

**판단.** 지금 값은 **틀렸다** — 다른 구간(지배 구간 — 이 예제에서는 정모멘트 쪽 경간 가운데의 양력 구간)의, 횡비틀림으로 줄인 강도를 Fy 로 나눈 것이다. II-2A 에서는 **크게 보수 측**(Se 가 맞는 값의 15 %, 비 6.9 대 1.02 · 0.89). 비보수가 될 수 있는 경우(의심): 지배 구간이 정모멘트(상부 압축, 데크 스프링)면 그 쪽 Mnℓ 을 쓴다(II-2A 에서 86.16 대 85.9 — 0.3 % 큼), 지배 구간에 비탄성 여유 · 냉간 가공이 켜져 Mnℓ 가 My 를 넘으면 그 여유가 랩으로 옮겨 간다. 랩 도구의 맨 위 `utilization` 0.9025 는 패스너 무리의 비라 6.9 불합격과 함께 보면 오해를 부른다(`pass: false` 는 맞음).

## 새 결함

| 번호 | 심각도 | 위치 | 무엇 | 재현 · 증거 | 고칠 방향 |
|---|---|---|---|---|---|
| **V8-01** | **P2**(보수 측의 틀린 판정. 비보수 변형은 의심) | `src/case/requests.ts:240-249`, `webview/js/app.js:1110-1125`, `src/case/caseKeeper.ts:286-288`, `webview/js/utils.js:201-226` | 퍼린 뒤의 랩 접합이 `Se · Mnd · Vn` 을 「지배 구간」 결과에서 가져온다 — 랩 단면이 아니다. `Se = Mnl/Fy_used` 는 그 구간의 횡비틀림 · 뒤틀림 감소를 품고, `Mnd` 는 구속되지 않은 플랜지의 값이라 진술(`lap_restrained`)이 있어도 §F4 를 불합격으로 낸다. (작성자가 「옛것」 으로 적어 둔 것 — 이번 작업에서 생긴 것은 아님) | `b_lap_wiring.js`(II-2A): 보낸 `Se 0.2311, Mnd 76.83` → `lap.flexure.local 6.898 fail · lap.bending_shear 6.908 fail · lap.flexure.distortional 1.141 fail`. 같은 지점의 퍼린 `lap-1` F3 1.0207, 매뉴얼 0.788. `b_lap_se.py`: Se 1.562 → 1.021, Se 1.80 → 0.886 | 랩의 Se 는 랩이 걸친 지점의 부모멘트 구간(퍼린 결과의 `lap` 구간)의 Mnℓ(Fn = Fy, Mne = My)/Fy 로, 진술이 있으면 Mnd = My(또는 보내지 않음). 지배 구간 하나를 고르지 말 것. 시험: II-2A 의 랩이 퍼린 랩 구간과 같은 F3 비 |
| V8-02 | P3(방어 깊이 · 문서) | `src/case/pdfPrint.ts:41-59`(정규식 허용 목록), `:62-74`(인자), 작업문서 §6.12 V7-02 행 | (a) 허용 목록은 태그를 `<…[^>]*>` 로 자른다 — 따옴표 안의 `>` 뒤 속성은 보지 않는다. CSS 이스케이프(`\75rl(`), 프로토콜 없는 `//호스트`, 문자열 `image-set("…")` 도 지난다. **CSP 를 빼면 스크립트가 돈다** — 작업문서의 「CSP 를 빼도 같다」 는 틀리다. (b) 받아들인 남는 위험의 「(두 겹을 다 지나도) 밖으로 보내지는 못한다」 도 틀리다 — WebRTC 의 UDP 는 죽은 프록시 · 이름 풀이 규칙을 타지 않는다. 지금 층 1(이스케이프)과 CSP 가 서 있어 실제 길은 없다 | `p2_print.js`: 여덟 문서 모두 연결 0 · 스크립트 0(CSP). `p2_print_nocsp.js`(허용 목록 + 인자, CSP 없음): `<details title=">" open ontoggle="…append('JSRAN')">` → **PDF 에 JSRAN**. 남는 위험 재현(CSP · 허용 목록 모두 없음): `RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:<udp>'}]})` → 내 UDP 수신기에 **20 B · 28 B 두 데이터그램**, TCP 0, 다른 파일은 PDF 에 실림 | 인자에 `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`(와 `--webrtc-ip-handling-policy=…`), 허용 목록은 정규식이 아니라 파서(또는 인쇄할 문서를 `reportRender` 가 만든 것만으로 한정하고 목록을 지우거나), 문서의 두 문장을 고친다 |
| V8-03 | P3 | `src/records/fp.ts:modelFp`(필드: 서명 투영 + `sectionTemplate` · `sectionParams`), `src/case/resultSeal.ts:34-49`(`requestFor` — `props: null`, 단면 기하 없음), `StcfsdPanel.ts:2175-2192`(`sectionType` · `cornerRadius` 가 엔진의 `section.type` · `R_corner` 를 정함) | 템플릿이 없는 모델(옛 파일 · 원시 모델)에서는 `sectionType` · `cornerRadius` 가 엔진 요청을 바꾸는데 봉인의 어느 지문에도 들지 않는다 — 저장 뒤 그 두 칸을 고친 파일이 경고 없이 결과를 「지금 것」 으로 되살린다 | `p1b_seal_gap.js`: 원시 모델(템플릿 없음, Z, R 0.1875)로 설계 → 저장(봉인) → 파일에서 C · R 0.6 → 열기: 경고 0, 설계 결과 되살아남, `get_full_state` 에 `member_design`. 같은 설계를 다시 돌리면 요청이 `section {type:'C', R_corner:0.6}`(전 Z · 0.1875) — 이 사례에서는 판정 · 비가 같았다(평가된 항목이 R · 형식에 기대지 않음) | 모델 지문에 엔진 요청에 닿는 모든 모델 칸(`sectionType` · `cornerRadius` · `elementRoles`?)을 넣거나, 봉인의 요청 지문을 「그때 보낸 진짜 요청 본문」 으로 |
| V8-04 | P3 | FSM 고유치 풀이(`python/` 의 서명곡선 · DSM 경로 — `1b365f8` 은 보 해석만 바꿈) | OpenBLAS 스레드 1 과 4 · 8 에서 FSM 값의 끝자리가 다르다(Mcre 상대 최대 1.07e-6). 판정 · 4자리 이용률은 같지만 「같은 입력 = 같은 결과」 와 고정값 시험(다른 코어 수의 PC)이 흔들릴 수 있다 | `a1_diff2.js`: `dsm_positive.Mcre` 629.74143 / 629.74211, 검토 비 최대 상대 7.2e-11, `load_analysis` · 소요는 같음 | 고유치 풀이를 스레드 1 로(`threadpoolctl`) 또는 결정적 경로로, 아니면 계약에 「FSM 값은 상대 1e-6 안에서만 같다」 |
| V8-05 | P3(의심 — 원인 미확인) | 끼운 화면의 설계 카드 · 다리의 다시 보내기 | 사람의 입력 변경(또는 AI 의 `set_case_inputs`)으로 지운 설계가 새로 고침 뒤 「결과 없음 — **프로젝트를 열었습니다**」 로 보인다(까닭이 바뀜 — 판정은 안 나옴). 시작 때의 `resultsCleared {reason:'project opened'}` 가 다시 보내지는 듯 | `s1.mjs` R2 · R3 의 `after reload` 글 | 다시 실은 화면에는 장부(`resultsLedger`)의 까닭을 보이기 |

## 의심(확인하지 못함)

| 번호 | 무엇 | 확인할 방법 |
|---|---|---|
| V8-S1 | V8-02 (a) 의 `//호스트/…` 는 `file://` 문서 안에서 `file://호스트/…`(UNC — SMB, 프록시 밖)로 풀린다. CSP 가 있으면 막히고(확인), 없으면 SMB 연결 · NTLM 이 나갈 수 있다 | 시험 VM 에서 CSP 를 끈 인쇄로 `<div style="background:\75rl(//<시험 호스트>/s/x)">` 를 찍고 445 연결을 본다 |
| V8-S2 | V8-01 의 비보수 변형 — 지배 구간이 정모멘트이거나 비탄성 여유 · 냉간 가공이 켜진 구간이면 랩의 Se 가 맞는 값보다 커진다 | 같은 II-2A 에 `use_inelastic_reserve` 를 켜고(또는 정모멘트가 지배하는 하중으로) `run_case_check lap` 의 Se 와 퍼린 랩 구간의 Mnℓ 비교 |

## 못 본 것

- 시작 화면의 「열기」(V7-41 의 다섯째 길) — 탐침이 시작 화면을 띄우지 않았다. 네 길은 확인.
- 독립 프로그램의 진짜 OS 대화상자 · 로그오프 복구본, VS Code 안의 진짜 확장(`globalStorageUri/writer` 자리) — 열쇠 폴더는 늘 scratch 로만.
- II-2A 의 하중 해석을 내 보 해석으로 다시 풀지는 않았다(매뉴얼의 반력 · 면 전단 · 변곡점 거리와 대조함). 적설 · 바닥 하중, LSD.
- 기존 시험 묶음 · 시험 파일(지시 — 하나도 돌리지 않음). 기본(환경 변수 없는) 스레드 수의 FSM 값.

## 정리

- 띄운 파이썬 · 헤드리스 Edge · 시험 모드 Electron 은 모두 끝났다 — 명령줄에 `v8probes` · `scratchpad\v8\` 이 든 프로세스 0(끝에 확인). 실수로 띄운 것 하나: `bash` 의 heredoc 이 `python3`(WindowsApps 별칭 → `python3.13.exe`, PID 112568)을 stdin 대기로 남겨 **그 PID 로만** 끝냈다(창 없음).
- 사본에 생긴 것은 빌드 산출물(`out/` · `desktop/**/dist/` — git 무시 대상)뿐, `node_modules` junction 은 건드리지 않았다. 열쇠 · 임시 파일 · 인쇄 프로필은 모두 `…\scratchpad\v8probes\tmp\` 안. `%APPDATA%\StCFSD` · 진짜 Claude 설정 · `.mcp.json` 류 · `C:\Coding_Works\StAnal` · `…\scratchpad\m1` 에는 닿지 않았다. git 쓰기 없음. 본 저장소에 쓴 것은 이 보고서 하나다.
