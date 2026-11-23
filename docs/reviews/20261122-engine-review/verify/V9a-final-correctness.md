# V9a — 마일스톤 마지막 확인: 값 · 판정 · 사람이 읽는 글 (커밋 `e622857`)

대상: `feature/desktop-program` 의 `e622857`(분리된 작업 트리 `…\scratchpad\v9a`). 범위는 **맞음**(수 · 판정 · 사람이 읽는 글) — 보안 · 기록 무결성(사람만의 경계, 꾸민 프로젝트 폴더, 경로, 인쇄 격리, 서명)은 나란히 도는 V9b 의 몫이다. 검증자는 제품 코드 · 시험을 고치지 않았고 이 보고서만 썼다. 새 결함은 V9a-xx. 심각도는 V7 · V8 과 같은 뜻(P0 = 틀린 판정 · 강도가 맞는 것으로 보임, 또는 내면 안 되는 것이 발행됨, P1 = 심한 결함, P2 = 틀린 값이지만 보수 측이거나 드문 길, P3 = 표기 · 방어 깊이 · 문서).

## 요약

- **V8-01 · V8-S2 는 닫혔다.** 퍼린 뒤의 랩 검토는 그 지점 랩 구간의 `lap_section`(Fn = Fy, Mne = My, 여유 · 냉간가공 없음, 한 부재의 Vn)만 쓴다 — 지배 구간 · 비탄성 여유 · 냉간가공 · 중력 지배(부모멘트 구간 지배) · LRFD 어느 것에도 흔들리지 않고, 랩의 판정 · 맨 위 `utilization` · `governing_check` · `fastener_utilization` · 경고가 서로 맞는다. II-2A 첫 안쪽 지점: Se 1.56190 in³ → 국부 1.02061(퍼린 `lap-1` F3 1.02067 과 같음), H2 1.08411, 둘 다 손계산과 맞음.
- **K4b 의 글은 수가 맞다.** 엔진 계약 사례 154 개의 알림 2,641 개(code 327 종)를 `notices.js` 로 US · SI 두 번 그려 US 글이 엔진의 `text_ko` 와 **2,641 / 2,641 같고**, SI 글의 치수 수 285 개가 내 환산과 모두 맞다. 진짜 호스트의 II-2A(퍼린 + 랩, SI)에서 MCP 요약 · 전체, 화면 나무 · 목록, 검증표, 계산서 문서의 US/SI 글 짝 232,697 개 — 수 · 단위가 틀린 것 0. 남은 것은 옛 문자열에 남은 US 단위(P3)뿐.
- **새 결함: P0 1 · P1 1 · P2 1 · P3 6.**
  - **V9a-01 (P0)** 발행 묶음의 검증표 · 좌굴 보고서는 점검을 지난 **뒤**, 계산서 PDF 를 찍는 동안(수 초) 바뀔 수 있는 「지금 상태」로 그린다 — 그 사이 AI 의 설계 한 번으로 R0 의 검증표가 **불합격(115.6 %) 상태**를, 계산서는 확인한 통과 상태(Mu 40)를 싣고, 목록 파일은 확인한 내용 지문을 적고, 발행 목록은 「그대로」.
  - **V9a-02 (P1)** 랩의 Mu · Vu 는 처음 값 0 이 「입력 없음」이 아니라 「0」으로 간다 → 휨 · H2 가 「해당 없음」이 되어 **랩 종합 OK**. Mu 를 비운 랩(나사): OK, 같은 랩에 Vu 를 비우면 OK(0.972) — Vu 1.78 을 넣으면 H2 1.0385 불합격.
  - **V9a-03 (P2)** 랩 구속을 밝히지 않고 AI 가 Se 를 준 랩: 엔진은 국부 휨을 미평가로 두면서 같은 가정(Mn,lap = 2SeFy)에 선 H2 를 「통과」로, `flexure_checked: true` 로 낸다 → 검증표 「Lap 휨강도 DCR … 통과」.
  - P3: 랩 길이 자동 채우기의 지점 섞임(V9a-04), 화면 부재 카드의 수식 환산이 길이를 남김(V9a-05), SI 글에 남은 US 단위 · 긴 자리(V9a-06), 퍼린 모드 검증표의 랩 · 정모멘트 항목의 이름과 값(V9a-07), 변경 기록의 단위 없는 칸(V9a-08), MCP 도구 설명의 거짓 문장(V9a-09).
- **결정성은 맞다.** 계약 사례 전체 결과가 `OPENBLAS_NUM_THREADS` 1 · 4 · 8 · 없음에서 바이트까지 같고, 진짜 호스트의 II-2A 퍼린 + 좌굴 해석 + 부재 휨 설계도 1 · 8 · 없음에서 바이트까지 같다.

## 어떻게 돌렸나

- 사본: `…\scratchpad\v9a`(`e622857`, `node_modules` 셋은 junction — 건드리지 않음). 호스트는 사본의 시험 도구(`test/webview/panel_harness.js` 의 `loadTs` · `makeFakeVscode`)로 진짜 `StcfsdPanel` + 진짜 파이썬(`C:\Coding_Works\cufsmAi\.venv`)을, 열쇠 폴더 · 프로젝트 뿌리 · `TEMP` 는 늘 `…\scratchpad\v9aprobes\tmp\` 안에. 발행 탐침만 시험처럼 MCP 다리 + MCP 서버(소스 transpile, stdio 자식 하나 — 끝에 닫음)와 진짜 인쇄(제품의 닫힌 Edge 길)를 썼다. `out/`(빌드)는 만들지 않았다(`loadTs` 가 메모리에서 transpile).
- 탐침(`…\scratchpad\v9aprobes\`): `_env.js`, `l1_lap.js`(랩 15 경우), `n1_capture.py`(계약 사례 결과 잡기), `n2_check.js`(알림 US = 엔진 글, SI 수 대조), `n3_registry.py`(등록표의 물리량 · 단위 짝), `n4_ineq.py` · `n5_truth.py` · `n6_falsewarn.py`(부등식의 영어 · 한국어 구조, 나온 부등식의 참, 불합격 없는 묶음의 「부족 · 초과」 경고), `n7_host_si.js`(진짜 호스트 US/SI 글 짝), `n8_sample.py` · `n9_words.py`(영어 · 한국어 읽기), `v1_verdicts.js`(랩 판정의 뜻), `r1_issue_race.js`(발행 중의 변경), `d1_threads.js`(스레드 수). 결과는 `v9aprobes\out\`.
- 지시대로 프로젝트의 시험 묶음은 하나도 돌리지 않았다. 기존 시험 파일도 돌리지 않았다(읽어서 구동법만 따랐다).

## 1. 퍼린 뒤의 랩 검토 — 닫힘 (V8-01 · V8-S2)

`l1_lap.js`: II-2A(8ZS2.25×059, 1 · 25 · 25 · 25 · 25 · 1 ft, 경간별 I, 랩 2.5/3.5 · 1/1 · 3.5/2.5, ASD, 진술)를 진짜 호스트의 `design_purlin` → `set_case_inputs`(랩 30 / 42 in, Mu 105 kip-in, Vu 1.78, 볼트 ½ in 2열, `connLapSupport`) → `run_case_check lap`, 랩 요청을 다리에서 잡음.

| 경우 | 지배 구간 | 보낸 Se · Vn · Mnd | 랩 국부 | H2 | 맨 위 util · 지배 | 판정 |
|---|---|---|---|---|---|---|
| 기본 · 지점 3 | uplift-1 | 1.561897 · 3.89520 · 없음 | 1.02061 fail | 1.08411 fail | 1.0841 · bending_shear | fail |
| 냉간가공 켬 | uplift-1 | 같음 | 1.02061 | 1.08411 | 같음 | fail |
| 비탄성 여유 켬(구간 Mnℓ 96.09, 구간 F3 0.912 통과) | uplift-1 | 같음 | 1.02061 | 1.08411 | 같음 | fail |
| 여유 + 냉간가공 | uplift-1 | 같음 | 같음 | 같음 | 같음 | fail |
| 양력 없음(지배 negative-3) | negative-3 | 같음 | 같음 | 같음 | 같음 | fail |
| LRFD | uplift-1 | 같음 | 0.67905 | 0.72038 | 0.8756 · fastener_group | pass |
| 지점 4 · 5 | — | 그 지점 구간의 블록(같은 단면이라 같은 값), 출처 `lap-3, lap-4` · `lap-5, lap-6` | | | | |
| 지점 2(랩 없음) · 1(자유단) · 없음 | — | 없음 | not_evaluated(지배) | not_evaluated | 0.9025 · fastener_group | 판정 없음 |
| 진술 없음 | — | 없음(까닭 「랩 구속을 밝히지 않음」) | not_evaluated | not_evaluated | 0.9025 | 판정 없음 |
| AI 가 Se 1.8 을 줌 | — | 1.8, 출처 「부른 쪽이 준 값」 | 0.88561 | 0.96521 | 0.9652 | pass |

- 손계산: My = 106.643 kip-in(Sf 1.93896 × 55), Mnℓ = 85.904 → Se = 1.56190 in³; 2·1.5619·55/1.67 = 102.88 → 105/102.88 = **1.02061** ✓. Vn: h = 7.507 in, h/t 127.2, Vcr = π²·29500·5.34·Aw/(10.92·(h/t)²) = 3.896 kips ✓(매뉴얼 3.90). H2: √(1.0206² + (1.78/(2·3.8952/1.60))²) = **1.08413** ✓. `lap_section.Mnl` 85.90436 = 퍼린 `lap-1` F3 의 공칭(여유 없을 때) — Mcrl 90.71(부모멘트 FSM)에서 λℓ 1.084.
- 경고와 맞음: 국부 불합격일 때만 `lap.warning.lap_mu_mn_dcr`(「Mu = 105.00 kip-in > Mn/Ω = 102.88 kip-in」 — 참), H2 초과 경고, 진술이 있으면 F4 해당 없음 알림, Se 가 없으면 「Se 미입력 — 판정 없음」 + 호스트의 「랩 단면 Se 없음 — <까닭>」.
- 여유 · 냉간가공이 랩으로 옮겨 가는 비보수 변형(V8-S2)은 **없다** — 블록은 `state_i621`(virgin Fy)의 `Mnfo_detail`(여유를 얹기 전의 `flexure_local(My, Mcrl)`)이다(`python/design/member_checks.py:781-815`, `aisi_s100.py:1596-1599`). 손으로 적는 Se 칸은 화면에 없다 — 사람이 Se 를 「적는」 길은 AI 의 `design_lap_connection` 뿐이고 그 값과 출처를 단다.
- **자동 채우기**(`webview/js/app.js:5268-5324`, `designState.selectLapGoverningMoment`): II-2A 의 하중 해석 위치로 돌리면 지점 3(부모멘트 −8.751 kip-ft, 경간의 「-M」 과 동률이면 지점), 그 지점의 랩 30 / 42 in, Mu 105.01 · Vu 1.785(전 위치의 최대 — 보수 측). 위치의 지점 번호(1 부터) · `laps_per_support`(0 부터) · 구간 `support`(0 부터)의 대응도 맞음. 남은 틈은 V9a-04.
- 랩 Mu · Vu 를 비운 경우(처음 값 0)는 V9a-02, 진술 없이 Se 를 준 경우는 V9a-03.

## 2. 사람이 읽는 글의 수

**엔진(계약 사례).** `contract_cases_1123.all_cases()` 154 개를 `server.METHODS` 로 엄격 JSON 왕복(시험과 같은 길, `n1_capture.py`). 모든 알림(목록 · 옆 필드 `{k}_kind` · `{k}_notices` · 묶음의 조각 · 매개변수 안의 알림)에 대해(`n2_check.js`):
- `notices.render(n, US)` = 엔진의 `text_ko` — **2,641 / 2,641**.
- SI 글: 수 + 단위 낱말을 차례대로 짝지어 내 계수(1 kip = 4.4482216152605 kN, 1 in = 25.4 mm, 1 ft = 0.3048 m, in² · in³ · in⁴ · in⁶, ksi, kip-in, kip-ft, kip/in, plf, psf, 질량밀도)로 다시 계산 — 치수 수 285 개 모두 맞음(US 글에 단위가 없고 SI 가 단위를 다는 꼴 127 개 포함). 분수(1/8 in → 3.17 mm, 3/16 → 4.76, 1-1/8 → 28.6, 3/8 → 9.52)와 「0 ~ 6 in → 0.0 mm ~ 152.4 mm」 는 눈으로 확인. 단위가 두 번 바뀐 수 · 다른 기호에 붙은 수 · SI 글에 남은 US 단위: 0.
- 등록표 676 code 의 물리량 · 단위 짝(`n3_registry.py`): 단위 글자가 물리량의 US 기본 단위와 다른 것은 상수 셋(`span_max` 396 in 을 「33 ft」, `t_mil` · `t_hi` 의 mil)과 질량밀도뿐 — 값이 in 이라 SI 환산이 맞다.
- 부등식: 부등호 · 비교 낱말이 있는 113 code 의 영어 · 한국어 자리표 차례와 부호가 같다(다른 하나 `member.warning.table_b4_1_1_fy_ksi_b4_fy` 는 「not <」 = 「미만이 아님」 — 같은 뜻). 사례에서 나온 부등식 32 개를 매개변수 값으로 계산하면 모두 참(`n5_truth.py`). 「부족 · 초과 · NG · 불합격」 경고 10 개가 모두 불합격 항목이 있는 묶음에서만 나온다(`6fa25f7` 과 같은 결함 없음, `n6_falsewarn.py`).
- 영어 · 한국어 읽기: 종류마다 고른 42 code(뜻이 같은 쌍이 아닌 것 — 나머지는 같은 글) + 비교 낱말이 있는 28 code 를 읽었다. 뜻이 다른 것 없음. 표기 하나는 V9a-06.

**진짜 호스트의 II-2A(SI).** `n7_host_si.js`: 퍼린(II-2A + 웹 크리플링 N 3.5) · 랩(지점 3)을 한 번 돌리고, 호스트가 쓰는 그리기 그대로 US · SI 를 만들어 같은 자리의 글끼리 짝지었다 — MCP 요약 · 전체(`NOTICES.forReader`, 호스트 `handleMcpAction` 끝과 같은 호출), 화면 나무(`forPage`) · 목록(`warningsList` · `notEvaluatedList` · `assumptionsList` · `scopeNotesList` · `purlinLists`, 구간마다), 검증표(`_mcpValidate` full), 계산서 문서(`_reportDoc`). 글 짝 **232,697**, 그 가운데 값이 다른 짝의 치수 수 359 개 — 틀린 계수 · 단위 · 이중 환산 0(구간 이름표 「1.05–19.90 ft → 0.32–6.07 m」, 「Lap end Mu=6.30 kN-m」, 「DCR=0.902 (V=58.82 / Cap=65.17 kN)」, 「762.0 mm ≥ 1.5d=304.8」, 「해석 기준응력 295.0, 설계 Fy 379.2 MPa」 모두 맞음). SI 에 US 단위가 남은 글은 모두 옛 문자열 — V9a-05 · 06.

## 3. 판정의 뜻

- 엔진: 미평가는 pass · fail 로 세지 않고(맨 위 `utilization` 은 pass · fail 항목만), 미평가가 지배하면 `governs` 와 `governs_basis 'not_evaluated'` — 랩 지점 2 · 진술 없음에서 `lap.flexure.local` 이 not_evaluated 로 지배, 판정 `null` · `NOT_CHECKED`. 해당 없음(`not_applicable`)은 검증표에서 항목을 빼고(`review.js:206`) 미평가는 「주의」.
- 화면 · 검증표 · 계산서 · MCP 는 같은 호스트 결과에서 그린다(독립 프로그램도 같은 호스트 출력). 랩 머리 판정은 `_v3`(3 상태), 검증표의 「Lap 접합부 종합 판정」 도 3 상태.
- 결함: **V9a-02**(처음 값 0 이 「해당 없음」 → OK), **V9a-03**(진술 없는 H2 「통과」 와 `flexure_checked`). 퍼린 모드 검증표의 이름 · 값 어긋남은 V9a-07(판정은 맞음).

## 4. 확인 표시와 발행

- **확인의 유효성**(`src/records/reviews.ts:96-150` 을 읽음): 글 · 참거짓 · null(판정 · 조항 · 식 · 갈래)은 같아야, 출처가 사람 · 기준 · 재료 · 기본값인 입력 값은 정규 값이 같아야, 그 밖의 수는 1e-6(항목에 `numeric_tolerance` 가 있으면 1e-4). 1e-4 는 **양쪽 항목이 다 표지를 가질 때만** 넓어진다 — 한쪽만 있으면 키가 다른 꼴(`shape`)로 「다시 확인」. 그 안에 숨는 변화는 하중 해석에서 온 소요 · 강도의 상대 1e-4 이하뿐이고 판정 · 갈래가 바뀌면 걸린다 — 결함으로 보지 않았다. 출처 종류가 바뀌면(`source.kind` 글) 걸린다. 무효가 된 결과는 「지금 결과에 없음」.
- **발행 전 점검**(`StcfsdPanel.ts:3645-3693`, `desk.ts:1157-1196`): 막는 것 열둘 + 데스크의 셋(`read-only` · `unknown-issue-folder` · `case-file-changed`)을 읽었고, 진짜 흐름(`r1_issue_race.js`, 시험과 같은 순서 — 설계 · 가정 확정 · 사람의 확인 · 저장 · 초안)에서 막는 것 0 · 경고 0 을 만든 뒤 미리보기 → 발행.
- **V9a-01**: 그 발행 도중(계산서 PDF 를 찍는 사이)에 AI 가 부재 설계를 한 번 하자 R0 이 나왔고 검증표가 그 새 상태를 실었다(아래 표).
- 날짜 · 도장 · 차수는 시험(`records_issue_contract`)이 덮는 길이라 따로 보지 않았다 — 위 탐침의 R0 도 차수 R0, 발행 목록 「그대로」.

## 5. 변경과 출처

- `src/records/differ.ts` · `changeText.ts` 를 읽음: 값은 US 로 적고 단위 종류(`UnitKey`)로 보이는 단위로 바꾼다. 검토 입력의 단위 종류 12 가지(`designState.FIELDS` 의 셋째 열 — stress 11 · length 30 · pressure 6 · force 9 · moment 7 · thickness 4 · length_ft 2 · inertia · rotStiff · latStiff · density · radius)가 모두 `CASE_UNIT_KIND` 에 있다. 경간 · 랩 길이는 `length_ft`. 빠진 것: V9a-08.
- 묶음의 귀속 · 버리기의 되돌림 · `last_change` 는 **돌려 보지 못했다**(못 본 것).

## 6. 결정성

- 계약 사례 154 개의 결과 전체: `OPENBLAS_NUM_THREADS` = 1 · 4 · 8 · 없음 — sha256 `99d45e79…` 넷 모두 같음.
- 진짜 호스트: II-2A `design_purlin`(서명곡선 정 · 부 DSM 포함) + `run_analysis` + `aisi_design` 휨(LRFD, Mu 40) — 1 · 8 · 없음 sha256 `ab7b0615…` 셋 모두 같음(V8-04 닫힘).

## 새 결함

| 번호 | 심각도 | 위치 | 무엇 | 재현 · 증거 | 고칠 방향 |
|---|---|---|---|---|---|
| **V9a-01** | **P0**(내면 안 되는 것이 발행됨 — 확인하지 않은 상태의 검증표가 「그대로」 발행본으로) | `src/records/desk.ts:1236-1269`(점검은 `await this.env.issueRender` 앞에서 한 번), `src/webview/StcfsdPanel.ts:3701-3728`(`_issueRender`: 계산서 PDF 를 `await` 로 찍은 **뒤** `_bucklingDoc` · `_validationDoc` 을 지금 상태로 지음 — 주석 「미리보기의 지문이 같음을 이미 확인했다」는 그 await 사이를 덮지 못한다) | 발행 점검을 지난 뒤 PDF 인쇄를 기다리는 몇 초 동안 다른 행위자(AI 의 MCP 요청, 화면의 사람)가 상태를 바꾸면, 묶음의 좌굴 보고서 · 검증표가 바뀐 상태로 그려지고 그대로 발행된다. 목록 파일 · 발행 줄은 점검 때의 `contentFp` · 실행 · 점검 지문을 적으므로 묶음이 서로 다른 두 상태를 「같은 확인」 으로 싣는다. 발행 뒤의 대조는 파일 해시만 보므로 「그대로」 | `r1_issue_race.js race`: 프로젝트 V9 · 대상 Beam(lippedc 8 × 2.5 × 0.625 × 0.059, LRFD, Fy 50, Lb 60, **Mu 40**, Vu 1) — 막는 것 0 → `issuePreview` → `issue(...)` 를 부른 직후 AI 가 `aisi_design_flexure {Mu: 75}`(util 1.1558, fail) → **R0 발행됨**. `Beam.calc.R0.html`: 「Mu = 40.00 kip-in」. `Beam.validation.R0.html`: 「이용률 — 부모멘트 (-M) **115.6%**」(실패). `documents list`: R0 `same`. 계산서 · `.csd` 사본은 맞다(초안 사본 · 인쇄 전에 읽은 바이트) | 묶음의 모든 문서(좌굴 · 검증표)를 점검과 같은 동기 구간에서 지어 두고 인쇄만 기다리거나(초안 때 사본으로 두는 것이 가장 단단하다 — 계산서처럼), 쓰기 직전에 `issueCheckData()` 를 다시 해 지문이 다르면 실패한 발행으로; 발행 중에는 그 대상의 쓰기 요청을 거절. 시험: 발행 중 AI 설계 → 거절 또는 묶음 전부가 점검 상태 |
| **V9a-02** | **P1**(입력 없음이 「해당 없음」 → OK. 보통의 MCP 길 — `run_case_check lap` 앞에 AI 가 `connMu` 를 넣지 않으면 — 에서 틀린 판정이 맞는 것으로 보인다. P0 로 볼 수도 있다) | `webview/js/designState.js:152-153`(`connMu` · `connVu` 처음 값 0), `src/case/requests.ts:256-257`(`r.zero`), `python/design/lap_checks.py:143-147 · 245-247`(Mu ≤ 0 → 휨 셋 `not_applicable` 「no support moment (Mu_support = 0)」, Vu ≤ 0 → H2 `not_applicable`), `python/design/lap_connection.py:95-106 · 327 · 451` | 연속 퍼린의 랩 지점에는 늘 모멘트가 있는데, 칸을 비우면 0 이 「소요 0」 으로 가서 랩 휨 · H2 가 「해당 없음」 이 되고 패스너 수도 Vu 로만 정해진다 → 랩 종합 OK. 화면의 자동 채우기(하중 해석 뒤 옛 화면)만 이것을 막는다 — 새 화면 · MCP 에는 채우기가 없다 | `v1_verdicts.js` (b): II-2A 퍼린 뒤 `connMu 0`(처음 값), 나사 ¼ in Pnvs 2.0, 지점 3, 진술 → **pass · PASS**, 검증표 「Lap 접합부 종합 판정 ✓ OK」(같은 표의 퍼린 「Lap 구간 휨강도 … NG」 와 모순). (c) Mu 100 · `connVu 0` → **PASS 0.972**, (d) Vu 1.78 → **FAIL 1.0385**(H2) | 랩의 Mu · Vu 를 처음 값 null(필수 — 없으면 `missing`)로, 또는 엔진이 Mu_support 가 없거나 0 이면 「소요 없음 — 미평가」(해당 없음은 사람이 0 을 밝힌 때만). 퍼린 결과가 있으면 호스트가 그 지점 값으로 채우는 길을 화면 밖(MCP · 새 화면)에도 |
| V9a-03 | P2(AI 도구의 길 — 종합은 「판정 없음」 으로 맞지만 항목 하나가 미평가를 통과로 보인다) | `python/design/lap_connection.py:416-446`(H2 판정이 `ltb_unstated` 를 보지 않음) · `:584-585`(`flexure_checked` 가 진술 없음의 국부 미평가를 「평가함」 으로 셈), `python/design/lap_checks.py:234-241`, `webview/js/review.js:1113-1121`(「Lap 휨강도 DCR」 이 `flexure_checked` 로 판정) | 진술이 없으면 엔진은 Mnℓ = Se·Fy(Fn = Fy) 의 국부 휨을 미평가로 두면서, 같은 Mn,lap 을 쓰는 H2 는 「통과」 로 낸다. 같은 결과에서 `flexure_checked: true` → 검증표가 「Lap 휨강도 DCR (2겹 §F3/F4/H2) — 통과」 | `v1_verdicts.js` (a): `lap_connection {Se: 1.8, Mu_support: 80, Vu_support: 1.0, 볼트 ½ in, ASD}`(진술 없음) → `lap.flexure.local not_evaluated`, `lap.flexure.distortional not_evaluated`, **`lap.bending_shear pass 0.708`**, 종합 `NOT_CHECKED`; 검증표 「pass \| Lap 휨강도 DCR … DCR=0.708」 | H2 도 진술 없으면 통과 대신 미평가(불합격은 그대로) — 국부와 같은 규칙. `flexure_checked` 는 국부 · H2 가 pass · fail 일 때만 참 |
| V9a-04 | P3 | `webview/js/app.js:5270-5309`(`_autoFillLapInputs`) | 랩 길이는 먼저 **모든 지점의 최대**로 채우고, 고른 지점의 그쪽 길이가 0(또는 그 지점에 랩이 없음)이면 그 최대를 그대로 둔다 — 다른 지점의 길이가 랩 탭에 남아 패스너 배치 · 1.5d 조건이 그 길이로 검토된다 | 코드 읽기 + II-2A 위치로 `selectLapGoverningMoment` 를 돌림(지점 3, 30 / 42 in — 이 예제는 맞음). 지점 3 이 「왼 0 · 오 3.5」 였다면 왼쪽이 다른 지점의 3.5 ft(42 in)로 남는다 | 고른 지점이 있으면 그 지점 값만(0 이면 0, 랩이 없으면 비움) |
| V9a-05 | P3 | `webview/js/app.js:5827-5838`(`_convertFormulaUnits`, 부재 설계 카드의 옛 `steps[].formula`) | 길이 정규식의 앞보기 `[\s,)$]` 의 `$` 는 끝이 아니라 글자 — 「/」 앞 · 글 끝의 길이를 바꾸지 않는다. SI 화면에 한 분수의 위 · 아래가 다른 단위로 | 같은 함수를 II-2A 퍼린 결과의 식에 돌림: 「π²×203395.33 MPa/(**226.1 in/29.06 mm**)²」, 「Fcre = Cb×**3.2781 in**×530.19 mm²/(2×31774.51 mm³)」 | 무늬 환산 대신 구조로 된 `design_checks` 의 단계로 그리거나, 랩 카드처럼 「US 단위」 라고 밝히고 바꾸지 않기 |
| V9a-06 | P3 | 아래 각 자리 | SI 로 읽는 글에 남은 US 단위 · 영어 · 긴 자리: ① `load_analysis.auto_params.i621_check.checks[]`(옛 목록 — 「(a) d <= 12 in.」 「(h) span <= 33 ft」 「Fy >= 50 ksi, t >= 0.018 in.」)가 MCP 요약(SI)과 화면 나무에 그대로 ② 검증표 기준 「Fy < 655.0 MPa (표 B4.1-1(DSM: **Fy < 95 ksi** — 부등호 strict))」 ③ 검증표 값의 긴 자리 「379.211651124 MPa」 「0.143640776941 kPa」 「Lr=0.957605179607 kPa」 ④ 계산서(SI) 검토 항목 단계의 이유 「no lateral-torsional buckling: … 1e6 ksi internally」(영어 · US) ⑤ `lap_checks.py:143` 의 이유 「no support moment (Mu_support = 0)」 가 알림이 아닌 날 영어 ⑥ `solver.warning.material_mass_density_outside` 의 SI 글이 kg/m³ 값 옆에 「kip*s^2/in^4 단위의 구조재료 범위 밖」 ⑦ 「Mu(+)=83.29 > φMn(+)=83.29 kip-in (DCR=1.000)」(비 1.000004 — 보이는 자리로는 거짓으로 읽힘) | `n7_host_si.js`(①–④), 등록표 · 사례(⑤–⑦) | 옛 목록은 알림의 글로 바꾸거나 SI 응답에서 빼기, 검증표 값은 보이는 자리로, 남은 날 글에 code |
| V9a-07 | P3 | `webview/js/review.js:1066-1075 · 976-986` | 퍼린 모드 검증표: 「Lap 구간 휨강도 (§F3, 2겹)」 의 값은 퍼린 랩 구간의 **한 부재** 설계강도(51.44 kip-in = 5.81 kN-m)와 그 구간의 H2 비 1.085 인데, 기준 글은 「2겹 합산 φMn ≥ 지점 Mu」. 「이용률 — 정모멘트 (+M)」 은 퍼린이 정모멘트 구간을 다 평가했는데도 지배 구간의 `positive_region` 을 보고 「Mu(+) 미입력 — 설계탭에서 Mu(+) 값을 입력하세요」(주의) | `n7_host_si.js` · `v1_verdicts.js` 의 검증표 | 퍼린 모드에서는 구간 결과로 이름 · 값을 짓거나 그 두 항목을 빼기 |
| V9a-08 | P3 | `src/records/differ.ts:48-51 · 176-185` | 변경 기록의 단위: 템플릿 치수 `OD`(원형) · `Ds` · `Ws` · `R_inner` 가 `SECTION_PARAM_UNITS` 에 없고, `mcpOnly`(AI 도구만의 인자 — 랩의 `Se` · `Mnd` · `Vn` · 단면 `d` · `t` …)는 늘 단위 없음 → SI 로 읽는 변경 글 · 「전 → 후」 에 US 수가 단위 없이 | 코드 읽기(`template.py` 의 `params.get` 키 목록과 대조) | 치수 키를 더하고, `mcpOnly` 는 도구의 SI 입력 표(`SI_INPUT_TABLES`)로 단위를 찾기 |
| V9a-09 | P3 | `src/mcp/server.ts:1979` | `design_lap_connection` 설명이 「the engine currently substitutes Sf for a missing Se (gross section, unconservative)」 — 지금 엔진은 Sf 를 참고값으로만 쓰고 휨은 미평가(`lap_connection.py:457-475`). AI 가 읽는 글이 거짓 | 코드 읽기 | 문장을 엔진의 지금 규칙으로 |

## 의심(확인하지 못함)

| 번호 | 무엇 | 확인할 방법 |
|---|---|---|
| V9a-S1 | V9a-01 과 같은 틈이 다른 「await 뒤의 지금 상태」에도 있는가 — 초안 만들기(`generateReportFiles` 가 PDF 를 기다리는 동안 문서 · 근거)와 `documents draft` | 초안의 PDF 인쇄 중에 AI 가 설계를 바꾸고, 초안 줄의 `basis` 와 HTML · PDF 의 내용을 견준다 |
| V9a-S2 | 랩 Mu 의 처음 값 0 이 새 화면(데스크톱) 길에서도 그대로인가 — 새 화면에는 실행 단추가 없어 AI 의 `run_case_check lap` 이 보통의 길이다 | 데스크톱의 랩 칸이 비었을 때 AI 가 퍼린 뒤 `run_case_check lap` 을 부르는 흐름을 화면 시험 모드로 |

## 못 본 것

- 영역 5 의 실행: 변경 묶음의 귀속(요약에 보이는 행위자), 버리기가 세션 시작 상태(모델 · 입력 · 무효가 된 결과)를 정확히 되돌리는지, `last_change` 꼬리표 — 코드만 읽었다.
- 영역 4 의 나머지 막는 것을 하나씩(시험이 덮는 길이라 한 번의 깨끗한 흐름만), 손상 · 바뀐 실행 사본, 다른 종류의 실행 결과로 표시를 살리는 길(V9b 와 겹침), 발행 도장 · 지역 날짜 · 차수의 경계(자정 · 실패한 발행 뒤).
- SI 의 숫자 필드(글이 아닌 값)는 `mcp_si_chain` 이 덮는 길이라 다시 보지 않았다 — 이번 대조는 글만.
- 계약 사례가 닿지 않는 349 code 는 등록표의 단위 짝만 보았다(값으로 그려 보지 않음).
- 독립 프로그램의 새 화면(Electron) — 지시대로 띄우지 않았다. 새 화면은 같은 호스트 출력을 쓴다는 전제에서 호스트만 보았다.
- 매뉴얼 원문 대조는 V8 의 II-2A 수치(Se · Vn · 반력)에 기댔다.

## 정리

- 띄운 것: 파이썬 엔진(탐침마다 하나 — 끝에 `bridge.dispose()`, 「exited signal=SIGTERM」 확인), 발행 탐침의 MCP 서버(stdio 자식 — `client.close()`)와 제품의 닫힌 Edge 인쇄. 끝에 명령줄에 `v9aprobes` · `scratchpad\v9a\` 가 든 프로세스 0, 부모가 없는 python · msedge 는 이 작업 전(11-22)의 것 하나뿐(건드리지 않음). 한 번 `bash` 의 빈 heredoc 이 `python`(별칭)을 기다리게 한 배경 작업이 있었다 — 그 작업만 멈췄고 남은 python 프로세스는 없었다.
- 사본에 생긴 것 없음(`git status` 깨끗, `out/` 도 만들지 않음). 열쇠 · 프로젝트 뿌리 · 임시 파일 · 인쇄 프로필은 모두 `…\scratchpad\v9aprobes\tmp\` 안. `%APPDATA%\StCFSD` · 진짜 Claude 설정 · `.mcp.json` 류 · `.claude/` · `C:\Coding_Works\StAnal` · `…\scratchpad\m1` · `k4b` · `v9b` 에는 닿지 않았다. git 쓰기 없음. 본 저장소에 쓴 것은 이 보고서 하나다.
