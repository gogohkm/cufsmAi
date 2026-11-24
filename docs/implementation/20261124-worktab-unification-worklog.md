# 업무 탭 통일 · 검증 지적 반영 — 작업문서

- 시작: 2026-11-24 저녁
- 근거: 저장소 뿌리의 `ALCalc_StCFSD_검증_및_업무탭_통일안.md`(사용자가 준 문서 — ALCalc 와 StCFSD 를 같이 써 보고 얻은 것)
- 요청: 「이 중 우리에게 해당하는 부분과 6. 업무 탭 통일안을 반영해서 코드를 개선」
- 방식: 오케스트레이터 + Opus 서브에이전트. 단계가 끝날 때마다 이 문서를 고친다. 같은 파일(`StcfsdPanel.ts` · `server.ts`)을 여러 단계가 고치므로 **차례대로** 돌린다.
- 브랜치: `feature/desktop-program`. 커밋 · 푸시는 사용자가 말할 때만.

---

## 1. StCFSD 에 해당하는 것

| 문서 | 내용 | 단계 |
|---|---|---|
| 4.1 높음 | 둥근 모서리(r>0) 단면: FSM 을 돌린 뒤에도 휨 설계가 FSM 의 Mcrl · Mcrd 를 쓰지 않고 해석식으로. 「FSM 해석을 먼저 실행하세요」 는 틀린 경고. 압축은 FSM 값을 쓴다 | A |
| 4.2 높음 | AI 가 설계 도구를 부르면 주지 않은 화면 입력 24칸이 비워진다. 화면 연동 묶음이 `person` 으로 남는다. 화면 실행과 AI 실행의 입력이 다르다 | B · C |
| 4.5 중간 | 원형관(CHS)에 DSM 국부 / 뒤틀림 이름표 | A |
| 4.7 낮음 | 응답 top-level 수가 US 로 반올림된 뒤 SI 로(design_checks 와 0.03 % 어긋남) · `warnings: [""]` 같은 빈 글 | A |
| 4.7 낮음 | `design_dsm` 실행 기록이 AI 의 `run_analysis` 뒤 자동으로 생기는데 `by: person` | C |
| 4.7 낮음 | 편집 상태(F2)에서 고유치 수 10 → 12 를 바꿨는데 변경 기록이 없다 | C |
| 4.7 낮음 | `new_case` 가 직전 모델을 물려받는다 · 기준응력이 파일에 없어 열 때마다 경고 | C |
| 6.2 – 6.7 | 업무 탭 통일안 — 구조 · 레코드 · 줄 양식 · 행위자 · MCP 도구 · 보고 양식 | C · D |
| 6.8 StCFSD | 1 입력을 비우지 않기 · 2 행위자 `program` · 3 휨 FSM 규칙 · 4 업무 트리 · 5 묶음 제목 · 6 CHS 고지 · 빈 warning · 반올림 | A – D |

ALCalc 만의 것(4.3 · 4.4 · 4.6 의 ALCalc 몫 · 4.7 의 ALCalc 줄 · 6.8 ALCalc)은 이 저장소의 일이 아니다.

---

## 2. 단계표

| 단계 | 내용 | 닿는 곳 | 상태 |
|---|---|---|---|
| A | 엔진 · DSM 채택 — 4.1 · 4.5 · 4.7(빈 글 · 반올림) | `python/**`, `StcfsdPanel.ts` 의 DSM 준비 · 채택, 응답 다듬기 | 끝 |
| B | 입력 합치기 — 4.2 (a)(c): 받은 키만 쓰고, 계산은 화면의 입력 집합으로 | `src/case/**`, `StcfsdPanel.ts` 의 MCP 쓰기, `server.ts` 의 도구 설명 | 끝 |
| C | 기록 · MCP 통일 — 행위자(`program` · `file`), `work_status` · `work_log` · `show`, 공통 레코드 모양, 확인(ack) · 판정 변화, 묶음 제목, `design_dsm` 의 행위자 | `src/records/**`, `src/mcp/**`, `StcfsdPanel.ts` 의 기록 | 끝 |
| D | 업무 탭 화면 — 할 일 · 기록 · 점검, 줄 양식 · 배지, 상세 차례, 계산 일치 칩, 보고 양식 | `desktop/ui/**` | 끝 |
| 끝 | 닿는 시험 한 번 · 설치 파일 다시 만들기 | — | 끝(2026-11-24 23:13 의 설치 파일) |

**줄인 것(2026-11-24 밤 — 사용자: 「시간이 많이 걸리는데 꼭 필요한 과정만」).** 독립 검증 단계를 없앴다(끝에 닿는 시험 한 번). C 와 D 를 동시에 돌린다(닿는 폴더가 다르다 — 호스트가 화면에 새로 주는 것은 실행 이력의 `no` · `auto` 와 연동 줄의 행위자 `program` 뿐이고, 화면은 두 꼴을 다 받는다). 4.7 의 낮은 것 셋(편집 상태에서 바꾼 고유치 수의 기록 · `new_case` 가 물려받는 모델 · 파일에 없는 기준응력)은 이번에 하지 않는다(5절).

---

## 3. 결정 기록

**D1 — K2 결정 1(「묶음을 통째로」)을 뒤집는다(4.2).** K2 에서는 MCP 설계 도구가 그 도구의 인자 묶음을 통째로 상태에 썼다(주지 않은 칸 = 빈 칸). 까닭은 「화면의 입력 = 그 결과를 만든 입력」 이었다. 그런데 써 보니 (1) 사람 · 기본값의 칸이 한 번의 호출로 24칸 비워지고 (2) 끼운 화면이 체크 칸을 다시 켜서 그 「같음」 도 지켜지지 않았다. 새 규칙:

- 설계 도구(`aisi_design_*` · `design_purlin` · `analyze_loads` · `design_connection` · `design_lap_connection`)는 **받은 인자의 키만** 상태에 쓴다(합치기). 주지 않은 칸은 건드리지 않는다.
- 계산은 **화면 단추와 같은 본문**(합친 뒤의 상태로 만든 것 — `src/case/requests.ts`)으로 한다. 화면 칸이 없는 인자(mcpOnly)는 받은 그대로 얹는다. 그래서 AI 의 실행과 「설계 검토 실행」 단추가 같은 입력 집합으로 계산한다.
- 응답은 AI 가 주지 않아 상태에서 온 값을 그 출처(default · user · ai · file · load-analysis)와 함께 싣는다 — 「넘기지 않은 입력을 지어내지 않는다」 는 규칙은 「넘기지 않은 입력은 화면의 값이고, 무엇이 그랬는지 밝힌다」 로 바뀐다. 기본값으로 남은 칸은 지금처럼 가정 등록부가 임시 가정으로 잡는다.
- 도구 설명의 「omit → engine …」 문구를 새 규칙으로 고친다.

**D2 — 저장 형식은 그대로 둔다(6.3).** 통일안은 `.<앱>/worklog.jsonl` 한 파일을 말한다. StCFSD 의 기록은 `.stcfsd/log/<종류>/<작성자>.jsonl`(작성자마다 덧붙이기 · 서명 · 내용 주소 사본)이고, 클라우드 동기화의 충돌과 손댄 줄을 가려내려고 그렇게 만들었다. 이것을 한 파일로 바꾸면 그 보장을 잃는다. **공통 스키마는 읽고 쓰는 면에서 맞춘다** — MCP `work_log` 의 응답과 화면의 줄이 통일안 6.3 의 키(`type` · `id` · `at` · `actor {kind, client, trigger}` · `reason` · `work` · `title` · `fields [{path, label, from, to, unit, display}]` · `invalidated` · `verdict_delta` · `ack`)를 쓴다. 사용자에게 알릴 것.

**D3 — 도구 이름(6.6).** 새로 등록: `work_status`(= `get_case_status` 에 할 일 수 · 마지막 실행 · 계산 일치), `work_log`(= `list_changes` 를 공통 스키마로, 실행 줄 포함, `actor` 거르기), `show`(= `focus`). 있는 이름(`get_case_status` · `list_changes` · `focus`)은 그대로 둔다(별칭). `work_items` · `assumptions` · `get_view` 는 이미 같은 이름이다.

**D4 — 행위자(6.5).** 사람의 칸 확정 · 편집 마치기 = `person`. AI 의 MCP 쓰기 = `ai`. 한 칸이 다른 칸을 따라 바뀐 것(화면 연동 · 단위 바꿈 · 기본값 자동 채움) = **`program`**(trigger `mirror` · `unit-toggle` · `default`). 파일 열기 · 가져오기 · 밖에서 바뀜 = **`file`**(지금까지의 `external` — 적힌 줄은 그대로 읽고, 새 도구와 화면에서 `file` 로 보인다). 계산이 자동으로 만든 결과(`design_dsm`)의 행위자 = 그 계산을 부른 쪽.

**D5 — 화면의 말.** 「사용자」 → 「사람」. 배지 색: 사람 = 초록, AI = 파랑, 프로그램 = 회색, 파일 = 보라.

**D6 — 묶음 제목(6.4).** 칸이 5개 이하면 칸마다 「이름 전 → 후 단위」 를 ` · ` 로 잇고, 5개를 넘으면 「첫 칸 · 외 n」. 수와 단위는 사람이 읽는 꼴(화면 단위).

**D7 — 원형관 압축은 원형관 조항으로 판정한다(4.5 의 뒤).** DSM 이름표를 떼자 원형관 압축이 「판정 없음」 이 되었다. 고지만 내고 판정을 잃는 것은 물러서는 것이다 — 원형관 압축의 유효면적 조항(Ae = Ao + R(A − Ao))을 엔진에 넣어 판정을 되찾는다. 호출자가 Pcrl 을 직접 주는 §E3.2.1 의 길은 남긴다(그 사실을 가정으로 밝힌다).

**D8 — 묶음 인자는 묶음째로(4.2).** `loads` · `deck` 처럼 묶음으로 주는 인자는 준 묶음 전체를 쓴다(빠진 성분은 화면의 값이 아니라 「주지 않음」). 합치기를 성분까지 내리면 AI 가 D · S 만 준 하중에 화면의 기본 Lr 이 섞인다.

---

## 4. 단계별 기록

### A — 엔진 · DSM 채택

**A-1 (4.1) — 휨이 FSM 값을 쓰지 않던 것.** 원인은 둥근 모서리가 아니었다(검증 문서의 가설은 틀렸다). 차례: 해석을 새로 하면 준비된 DSM 값을 지운다 → 끼운 화면의 자동 준비(`app.js` `_autoPrepareDesignDsm`)가 **그때의 부재 종류**로만 다시 준비한다(압축 설계 직후면 P 만) → `_designMember` 는 준비된 값의 서명(모델 + Fy)만 보고 통째로 골랐다 — 필요한 하중군(Mxx)이 그 안에 있는지 보지 않았다 → Mcrl · Mcrd 없이 엔진으로 가서 해석식으로, 그리고 「FSM 을 먼저 실행하세요」. r=0 인 S5 가 정상이었던 것은 그때 부재 종류가 이미 휨이었기 때문이다.

- 고침(`StcfsdPanel._designMember`): 압축 · 휨이 같은 규칙 — 하중군마다 준비된 값에 있으면 그것, 없으면 그 하중군의 지금 해석, 그것도 없으면 값 없이 정확한 까닭(`dsm_warning`). `dsm_basis_by_family` 를 더했고 `dsm_basis` 에 `prepared+current_analysis` · `none` 이 생겼다.
- 고친 뒤 S3 휨(SI): `dsm_basis current_analysis`, `dsm_source {Mcrl FSM, Mcrd FSM}`, 경고 없음, Mcrl 23.80 kN·m @78.5 mm, Mcrd 16.15 kN·m @370 mm, Mnd 7.899 kN·m. 압축(Pn 69.728 kN)과 S5 는 그대로.
- 검증 문서의 참고값 「Mcrd 16.21 이면 Mnd 7.878」 은 F4.1-2 로 재현되지 않는다(My 8.1214 · Mcrd 16.21 이면 7.907). 프로그램의 7.899 는 손계산과 맞는다.

**A-2 (4.5) — 원형관의 DSM 이름표.** `engine/dsm.py` `extract_dsm_values` 가 원형관도 극소의 반파장 순서로 국부 · 뒤틀림을 배정했고, 그 값이 설계(§E3.2.1 의 Pcrl, E4 · F4 의 Pcrd · Mcrd)에 섞였다.

- 고침: 원형관이면 극소는 이름표 없이 내고 crl · crd 는 0, `classification 'not_applicable_round_tube'`, `dsm_applicable: false`, 범위 고지 `dsm.scope.round_tube_not_applicable`(「원형관(CHS): DSM 비적용 — 원형관 조항 사용 …」). 호스트 `_callDsm` 이 CHS 형식을 넘긴다. 설계는 원형관에서 받은 Pcrd · Mcrd 를 쓰지 않는다.
- 휨은 이미 §F2.3 · §F3.1.1 로 갔다(그대로 pass). **압축은 판정이 없어졌다**(pass null — 전에는 FSM 의 Pcrl 을 §E3.2.1 에 넣어 pass). 원형관 압축 조항의 유효면적이 이 저장소에 없기 때문이다 → 결정 D7.

**A-3 (4.7).**

- 반올림: 엔진이 top-level 을 US 로 반올림해 싣고 `server.ts unitReply` 가 그 값을 SI 로 바꿨다. 엔진이 압축 · 휨 · 인장 · 조합 결과에 반올림 전 값(`display_unrounded`)을 함께 싣고, SI 응답만 그것을 바꾼다(`siUnits.withUnroundedValues`). US 응답의 값은 그대로. S3 압축 SI 의 Pn 69.72828 = design_checks 69.72828.
- 빈 글: `engine/dsm.py` 의 등록되지 않은 평문 6개가 구조화될 때 `text_ko: null` 이 되고 화면 쪽 `render` 가 빈 글로 그렸다. 6개를 고지 등록표에 넣었다(US 글은 그대로).

바꾼 파일: `StcfsdPanel.ts`(`_designMember` · `_callDsm`), `src/mcp/siUnits.ts` · `server.ts`(`unitReply`), `python/engine/dsm.py`, `python/design/aisi_s100.py` · `notice_registry.py`, 시험 `panel_host_contract.js`(시나리오 둘: `scenarioDsmFamilyRule` · `scenarioRoundTubeNoDsm`) · `mcp_si_chain.js`(SI = 반올림 전 값의 변환). 고정값 파일은 바꾸지 않았다.

시험: compile · lint, `design_prepare_contract` · `parity_contract` · `notice_render_contract` · `panel_host_contract`(시나리오 20) · `mcp_si_chain`(71), 파이썬 `run_all.py` 483 — 통과. 오케스트레이터가 `panel_host_contract` · `mcp_si_chain` 을 다시 돌려 확인했다.

남은 것(이 단계가 손대지 않은 것):

- 끼운 화면 · 새 화면의 SI 표시는 여전히 US 반올림 값을 바꾼다(같은 0.03 %). `display_unrounded` 를 쓰면 된다.
- 중첩 묶음(`shear.Vn` · `positive_region.*` · `web_crippling.*` …)의 SI 는 여전히 반올림 값의 변환이다.
- `desktop/ui/src/info.ts` 는 `dsm_basis === 'current_analysis'` 일 때만 FSM 표시를 붙인다 — 새 값 `prepared+current_analysis` 에는 붙지 않는다(단계 D 에서).
- `webview/js/notices.js` 의 `render` 는 `text_ko: null` 을 빈 글로 그린다 — 등록되지 않은 글이 또 생기면 같은 일이 난다.
- 화면의 자동 준비가 「그때의 부재 종류」 만 준비하는 것 자체는 그대로다(호스트의 채택 규칙으로 막았다).

**A-4 — 원형관 압축의 판정(D7).** AISI S100-16 §E3.1.1.1 을 엔진에 넣었다(본문과 Manual 예제 III-6 으로 식 · 한계를 다시 확인).

- 적용: 닫힌 원형관, D/t ≤ 0.441 E/Fy. Ao = [0.037 / ((D Fy)/(t E)) + 0.667] A ≤ A (E3.1.1.1-2), R = Fy / (2 Fcre) ≤ 1.0 (E3.1.1.1-3), Ae = Ao + R (A − Ao) (E3.1.1.1-1), Pnℓ = Ae Fn ≤ Pne (E3.1-1). Fcre · Fn 은 §E2 의 값 그대로.
- D/t 가 한계를 넘거나 D · t 를 모르면 값을 짓지 않고 「평가하지 못함」 과 까닭(`member.ne.e3_1_1_1_round_tube_d_t_over` · `…_dims_unknown`).
- 검토 항목의 id 는 `member.compression.local` 그대로(화면이 이 id 로 찾는다) — 조항만 갈래로(`checks.py` `REGISTRY_VARIANTS`, 항목에 `clause_variant: "round_tube"`, 조항 `E3.1.1.1`). 계산 단계 다섯(갈래 조건 → Ao → R → Ae → Pnℓ).
- 호출자가 `dsm` 인자로 Pcrl 을 직접 주는 §E3.2.1 의 길은 그대로(가정으로 밝힌다).
- 값: Manual III-6(8.00 × 0.100, Fy 42 ksi, KL 120 in) Pn 92.598 kips(인쇄값 92.7 — Manual 이 Fn 을 37.6 으로 반올림한 몫), Ae 2.4645(2.465). S4(D100×2, KL 2 m, Pu 40 kN) pass, 비 0.282, φcPn 141.89 kN, 지배는 전체좌굴.
- 원형관이 아닌 압축 · 조합의 계약 사례 28개를 고치기 전 엔진과 견줬다 — `display_unrounded` 키 말고는 같다.
- 바꾼 파일: `python/design/aisi_s100.py` · `checks.py` · `member_checks.py` · `notice_registry.py`, 시험 `test_review_1122_member.py`(III-6) · `1123_checks` · `1124_trace_recompute` · `contract_cases_1123.py`(사례 하나) · `panel_host_contract.js`.
- 시험: 파이썬 `run_all.py` 483, `panel_host_contract` · `mcp_si_chain` · `notice_render_contract` 통과. 오케스트레이터가 `1122_member` · `1124_trace_recompute`(48)를 다시 돌려 확인했다.
- 남은 것: 끼운 화면의 조항 이름표(`app.js` 의 조항 → 제목 표)에 E3.1.1.1 이 없다. 원형관 압축의 `dsm_source` 는 「없음」 뿐이다(국부가 §E3.1.1.1 로 평가된 것은 검토 항목의 조항 · 단계에만).

### B — 입력 합치기

**새 흐름(`StcfsdPanel._mcpDesign` — AI 의 설계 도구 호출 하나).**

1. `mcpWrite(action, 인자, 지금 상태)` 가 받은 인자를 셋으로 나눈다 — 합칠 칸(받은 키만), 묶음째 쓸 칸(`loads` · `deck` · 경간 표 — 빠진 성분은 null / 처음 값), 그 호출에만 쓸 인자(화면 칸이 없는 것 · 위치 · 조합 꼬리표).
2. `caseKeeper.mergeMcp` 가 상태의 **사본**에 합친다(아직 쓰지 않는다).
3. 그 사본으로 `requests.ts` 의 `build*Request` 가 화면 단추와 같은 본문을 만든다. 필수 칸이 비면 엔진을 돌리지 않고 오류(`missing_inputs` — 「인자로 주거나 set_case_inputs」). 상태에 쓸 수 없는 인자가 있어도 계산하지 않는다(계산하면 AI 가 준 값 대신 화면의 값이 쓰인다).
4. `mcpBody` 가 화면 칸이 없는 인자를 본문에 얹고 `_handleAction` 으로 계산한다 — 결과는 화면 · 기록에 한 번만.
5. 성공한 뒤에만 `applyMcp` 로 확정한다(계산 중에 들어온 화면 변경을 잃지 않게 지금 상태에 다시 합친다). 읽기 전용 대상이면 쓰지 않고 알린다(`case_inputs_not_written`).

**검증 문서 재현의 앞 / 뒤.** 사람이 wcN 3 · wcR 0.15 · wcSupport IOF · β 켬 · Cb(+) 1.2 · 냉간가공 켬 · Lb 80 · Cb 1.3 을 넣은 상태에서 `aisi_design_flexure(LRFD, Fy 50, Lb 60, Cb 1.14, Mu 30, Vu 1)`:

| | 앞 | 뒤 |
|---|---|---|
| 바뀐 칸 | 27칸(그 가운데 20칸을 비움) | 7칸(fy · connFy · memberType · Lb · Cb · Mux · Vu) — 변경 묶음도 이 7칸 |
| 엔진 요청 | 받은 7키 | 30키(상태의 칸이 더해짐) |
| 바로 뒤 `run_case_check member` 와 | 16키가 다름 | 바이트까지 같음 |

같은 값을 다시 주면(60.0 · 1.0 처럼 꼴만 다른 것도) 변경 줄이 생기지 않는다.

**새 응답 필드.** `case_inputs_used`(이번에 주지 않아 화면에서 온 값과 그 출처 — default · user · ai · file …) · `case_inputs_used_note` · `case_args_not_on_screen`(화면 칸이 없어 단추로는 다시 나오지 않는 인자). 있던 `case_inputs_written`(실제로 바뀐 키) · `case_inputs_replaced` · `case_inputs_not_written` 은 그대로.

**도구 설명 · 안내문.** INPUTS · CASE INPUTS 단락을 새 규칙으로, `CASE_MERGE_NOTE` 를 설계 도구 설명에, 화면 칸이 있는 인자의 「omit → engine …」 를 「omit → the screen's …」 로. 사실과 달라진 문장을 고쳤다 — 웹 크리플링은 화면에 지압 길이가 있으면 검토된다(화면은 지압 길이 89 mm 를 가지고 시작한다 — 빼려면 `wcN: null` 이나 `wc_N: 0`), 냉간가공은 화면 칸이 켜져 시작한다.

**결정과 다르게 한 것 · 더한 것.**

- 경간 표도 묶음째로(D8 과 같은 까닭 — 성분까지 합치면 뒤 호출이 앞 사례의 자유단 지점을 물려받았다). `span_ft` 가 필수라 퍼린 · 하중 도구는 사람의 지점 · 랩을 처음 값으로 바꾸고 `case_inputs_replaced` 로 알린다.
- 하중을 plf ÷ 간격으로 바꿀 때 다시 곱해 받은 수가 정확히 나오는 값을 고른다(15 가 14.999999999999998 이 되던 것).
- 고친 기존 결함: 화면이 붙지 않으면 `run_case_check` 의 하중 단면에 Ixx 가 없어 처짐을 계산하지 않았다(`_caseHostProps`).

**AI 의 결과가 달라지는 것(규칙의 귀결).** 화면의 처음 값(지압 길이 89 mm · 냉간가공 켬)이 이제 AI 의 계산에도 든다. 고정값의 퍼린 사례에서 지점 웹 크리플링이 들어가 내민 부모멘트 구간이 4.9 % OK → 128.3 % NG 가 되었다 — 화면 단추만 쓰는 고정값(gui-purlin)과 같은 값이다. 사용자에게 알릴 것.

바꾼 파일: `src/case/mcpGroups.ts`(매퍼를 합치기로, `mcpBody` · `inputsUsed` …) · `caseKeeper.ts`(`mergeMcp`) · `requests.ts`(`missingKeys`), `StcfsdPanel.ts`(`_mcpDesign` · `_caseHostProps` · `_caseRequest` · `_caseRunCheck`), `src/mcp/server.ts`, `media/mcp-server.js`(다시 빌드). 고정값 `test/rendered/k2/golden/mcp-beam · mcp-column · mcp-connection · mcp-purlin`(14항목 — 상태의 칸이 더해진 것 · 키 차례 · 위의 퍼린 귀결, 항목마다 까닭을 달았다).

시험: 새 `test/webview/mcp_case_merge_contract.js`(진짜 MCP 서버 · 다리로 — 재현, 바이트 일치, loads {D, S} 가 사람의 Lr · Wu 를 섞지 않음, replaced · used · SI, 읽기 전용 · 빈 간격), compile · lint · `check-mcp-parity`(79 도구) · `parity_contract` · `k2_case_state` · `k2_panel_case` · `case_guards_contract` · `records_changes_contract` · `panel_host_contract`(22) · `mcp_si_chain`(71) 과 닿는 계약 시험들, `test/rendered/k2/run.js` 의 gui · mcp · reload. 오케스트레이터가 `mcp_case_merge_contract` 를 다시 돌려 확인했다.

마무리: gui 고정값 4항목(`gui-column` · `gui-beam` · `gui-purlin` 의 `design.engine`, `mcp-column` 의 `gui.runDesign.engine`)을 고쳤다 — 차이는 단계 A 가 요청의 `dsm` 진단 키에 더한 `P_dsm_applicable` / `M_dsm_applicable: true` 하나뿐인 것을 요청마다 확인했다. `test/rendered/k2/run.js --only=gui,mcp,reload` 11/11 단계, 고정값 불일치 0.

요약 크기: 퍼린 38구간 요약이 40,826 B 로 한도 40,960 B 까지 약 130 B 남았다. 그 한도는 `mcp_si_chain.js` 의 단정일 뿐이다 — 서버 · 다리는 응답을 자르거나 막지 않는다(넘으면 시험만 실패하고 AI 는 온전한 JSON 을 받는다). 그래서 새 필드의 꼴은 그대로 두었다. Claude Desktop 쪽이 긴 도구 응답을 자르는지는 이 코드로 알 수 없다.

다음 단계에 넘기는 것: fy 를 따라 바뀌는 connFy(출처 mirror)가 AI 의 묶음 안에 같이 든다 → C 에서 행위자 `program` 으로 가른다(D4). 「AI: 주지 않음」 표시는 이제 `set_case_inputs` 의 null 과 묶음에서 빠진 성분에서만 생긴다.

범위 밖이라 그대로 둔 것: 설계 도구가 다른 결과의 입력을 바꿔도(예: 랩 도구의 Fy) 그 결과를 무효로 하지 않는다(전과 같다). 화면의 경간별 Ix 목록 칸이 값을 반올림해 되돌려 적는다(9.18 → 9.17998922).

### C — 기록 · MCP 통일

**행위자(D4).**

- 화면 연동만의 새 줄은 행위자 `program`(trigger `mirror` · `unit-toggle` 그대로) — `StcfsdPanel._handleMessage` 의 caseEdit ownLine 길. 열린 묶음이 없을 때만 이 길로 오고 바로 내보내므로 사람 · AI 의 묶음을 끊지도 삼키지도 않는다.
- AI 의 묶음 안에 섞인 연동 칸(fy 를 따라 바뀐 connFy)은 **갈랐다** — 그 묶음에서 값이 바뀌었고 지금 출처가 mirror 인 칸을 찾아(`_mirroredKeys`) AI 줄과 `program` · `mirror` 줄 둘로 짓는다(program 줄이 바로 뒤). 사람의 묶음은 가르지 않는다.
- 옛 줄(person + trigger mirror · unit-toggle)은 고쳐 쓰지 않고, 읽어서 내보낼 때 `program` 으로(`records/changes.ts` `shownActorKind` — `list_changes` 의 `by.kind`, `get_case_inputs` 의 `last_change.by`, `work_log`).
- `external` 은 적힌 그대로, `work_log` 에서만 `file`.
- `design_dsm` 실행의 행위자 = 마지막 좌굴 해석을 부른 쪽(`_analysisActor`).

**묶음 제목(D6)** — `changeText.changeTitle`: 5칸 이하면 ` · ` 로 잇고(첫 칸은 무게가 가장 큰 칸), 넘으면 「첫 칸 · 외 n」, 160자를 넘으면 끝을 「…」. 예: `두께 t 2 → 2.3 mm`, `Mu(-) (빈 칸) → 3.38954 kN-m · 외 5`.

**실행 이력** — `get_case_status {detail: 'runs'}` 의 `history` 항목에 `no`(대상 전체에서의 차례)와 `auto: true`(design_dsm).

**같은 요청의 실행(`runs`)** — 요청마다의 문맥(`StcfsdPanel._reqCtx` — AsyncLocalStorage)에서 `_recordRun` 이 `ChangeBatcher.noteRun(ctx, runId)` 를 부르고, 그 요청의 변경 줄의 몸에 `runs: [id…]` 가 실린다. `list_changes` · `work_log` 의 변경에 `runs`, 실행의 `changes` · `verdict_delta` 는 그 실행을 기준으로, `calc.changes_since_run` 은 그 묶음을 세지 않는다. `runs` 가 없는 옛 줄은 같은 요청 id 의 첫 실행에, 그것도 없으면 시각으로.

**MCP 도구 셋(D3)** — 도구 79 → 82.

- `work_status` — `get_case_status` 의 내용 + `todo {questions, unacknowledged_ai_changes, provisional_assumptions}` · `last_run {no, kind, at, by, verdict {status, ratio, governing}}` · `calc {state: match | changed | none, changes_since_run}`. 프로젝트 밖이면 세션의 변경 수와 그 까닭.
- `work_log {since?, actor?, detail?, limit?, case?, units?}` — 변경과 실행을 새 것부터 한 목록(`entries`)으로, 통일안 6.3 의 키: 변경 `{type, id, at, actor {kind, client, trigger}, reason, work, title, fields, invalidated, runs, verdict_delta, ack}`, 실행 `{type, id, no, at, actor, kind, auto, verdict, changes}`. `detail: 'fields'` 면 칸마다 `{path, label, from, to, unit, display}`.
- `show` — `focus` 의 다른 이름(같은 인자 · 같은 답).
- 새 읽기 동작 둘을 `READ_ACTIONS` 에(변경 묶음을 열지도 닫지도 않는다 · 발행 중에도 통과). 서버 안내문에 `WORK RULES` 네 줄.

바꾼 파일: `src/records/changes.ts` · `changeText.ts` · `runs.ts` · `desk.ts`, `StcfsdPanel.ts`, `src/mcp/server.ts` · `recordTools.ts` · `siUnits.ts`, `media/mcp-server.js`, `docs/implementation/20261124-records-schema.json`, 시험 `records_changes.js` · `records_v7.js` · 새 `test/webview/records_worklog_contract.js` · `mcp_case_merge_contract.js` · `records_review_contract.js` · `mcp_si_chain.js`. 고정값은 바꾸지 않았다.

시험: compile · lint, `check-mcp-parity`(82), `mcp_registration_contract`, `test/records/run.js`(core 27 · log 18 · changes 24 · work 14 · reviews 11 · v7 32, desk 25 는 따로), `records_changes / host / work / review / worklog_contract`, `reload_replay_contract`, `mcp_case_merge_contract`, `mcp_si_chain`(71) — 통과.

알아 둘 것:

- `test/records/run.js` 는 records_v7 뒤에서 records_desk 와 합계 줄 없이 exit 0 으로 끝난다 — 고치기 전에도 그랬다(이번 변경과 무관). records_desk 는 따로 돌린다.
- `work_status.calc` 는 「마지막 실행(어느 종류든) 뒤의 묶음 수」 다 — 설계 뒤 Lb 를 고치고 좌굴 해석만 다시 돌려도 `match` 가 된다. 종류별 일치는 `results[*].state`.

**후속 — 설계 도구의 실행 기록 사본.** 단계 B 의 새 흐름(계산 뒤에 상태를 확정)에서 실행 기록의 사본(`caseFp` · `snapshot`)이 합치기 **전**의 상태를 담았다 — 대안의 되돌리기 · 확인 표시의 「다시 확인」 · 발행 전 점검이 틀린 입력을 그 결과의 것으로 볼 뻔했다. 고침: 요청마다의 문맥 `_calcCase`(AsyncLocalStorage — 「이 계산이 쓴 검토 상태」)를 `_mcpDesign` 이 계산을 감싸 열고, `_recordRun` 이 그것이 있으면 그것을 실행 기록에 넘긴다. 「성공한 뒤에만 상태에 쓴다」 와 「계산 중에 들어온 화면 변경을 잃지 않는다」 는 그대로. 시험(`records_worklog_contract.js`): `aisi_design_flexure(Fy 55, Lb 60)` 뒤 그 실행 사본의 Lb 60 · fy 55, `caseFp` = 호출 뒤 상태의 지문 — 고침을 되돌리면 실패(사본이 Lb 118.11 · fy 42.79 로 합치기 전의 값)하는 것을 확인했다. `panel_host_contract` · `mcp_case_merge_contract` · `reload_replay_contract` · `records_review_contract` 통과.

읽기 전용 대상에서는 계산은 합친 사본으로 하고 상태에 쓰지 않으며(`case_inputs_not_written`), 실행 기록 · 변경 묶음은 적히지 않는다(코드로 확인 — `desk.onRun`).

### D — 업무 탭 화면

`desktop/ui/**` 만 고쳤다.

1. **트리**(`tree.ts` · `changes.ts` · `main.ts` · `center.ts` · `info.ts`): 할 일(판단 요청 · 확인 대기 · 임시 가정) → 기록(지난 계산 뒤 · 계산 머리줄 · 지난 판단 요청 · 지시) → 점검(판정 요약 · 엔진 알림 · 가정 · 범위 밖 · 보고). 묶는 줄만 새 키이고 변경 · 업무 항목 · 가정 줄의 키(`chg:` · `work:` · `asmr:`)는 그대로. 계산 머리줄은 실행 이력에서 — 자동 실행(`design_dsm`)은 빼고, 사이에 변경이 없는 잇단 실행은 한 줄로. 프로젝트 밖에서는 「지난 계산 뒤 / 그 앞」 둘로만. 같은 변경이 「확인 대기」 와 「기록」 두 곳에 같은 키로 나온다(고르면 둘 다 강조).
2. **행위자**(`changes.ts` · `work.ts` · `info.ts` · `names.ts` · `style/ui.css`): 배지 넷 — 사람 초록 · AI 파랑 · 프로그램 회색 · 파일 보라. 연동 줄은 `person` 이든 `program` 이든 「프로그램 · 화면 연동 / 단위 바꿈 / 기본값 채움」. 「사용자」 → 「사람」. 줄에 판정 변화(뒤 실행이 없으면 「다시 계산 필요」)와 확인 ✓.
3. **상세 패널**(`info.ts`): 머리 → 왜 → 바뀐 것(항목 · 이전 · 이후 · 단위) → 결과에 미친 영향 → 앞뒤(「다음 것」 링크를 더함) → 꼬리.
4. **계산 일치 칩**(`titlebar.ts` · `main.ts`): 진행 띠 끝 — 「계산 #k 과 일치」 / 「입력 바뀜 n건 · 다시 계산」(프로그램 줄은 세지 않는다). 누르면 업무 › 기록 › 지난 계산 뒤.
5. **보고**(`work.ts` · `main.ts`): ✓ 한 것 · ◐ 가정한 것 · ○ 남은 것 · 근거. 보고의 [확인] 이 받아지면 그 보고가 가리킨 변경 묶음도 묶음마다 사람의 길로 확인(거절된 수는 알림).
6. `info.ts` 의 좌굴값 출처 표시가 새 `dsm_basis`(하중군마다)를 읽는다.

시험: `ui.mjs` 에 새 걸음 r42(세 묶음 · 계산 머리줄 아래의 묶음 · 배지와 호스트 kind 의 일치 · 「사용자」 없음 · 판정 변화 · 칩 · 보고 네 머리 · 묶음 확인). typecheck · UI 빌드 통과, `--only=r10,r11,r12,r21,r22,r23,r24b,r25,r29,r42` 통과 59 · 실패 5 — 실패는 화면이 아니라 단계 B 의 새 규칙에 낡은 기대(5 · 6절의 설계 호출 셋 · r24b)와 시험 도중 `src/**` 가 바뀐 것.

**찾은 것 — 실행과 변경의 차례.** AI 의 설계 호출은 계산(실행 기록)이 먼저고 입력 확정(변경 묶음)이 뒤라, 시각으로만 가르면 그 묶음이 「지난 계산 뒤」 로 세어져 계산 직후에도 「입력 바뀜 1건」 이 된다. → C 가 변경 묶음에 「같은 요청이 남긴 실행」(`runs`)을 싣고, 화면은 그 키가 있으면 그 실행 아래에 둔다(진행 중).

**후속 1 — `runs` 키.** `runs` 가 있는 묶음은 시각과 상관없이 그 실행의 머리줄 아래에(여럿이면 가장 늦은 것), 「지난 계산 뒤」 · 계산 일치 칩 · 머리줄을 가르는 판단에 넣지 않는다. 판정 변화는 「그 실행 앞의 마지막 실행 → 그 실행」. 키가 없는 묶음은 시각으로. 함께: 이력이 다 있으면 첫 계산 앞의 묶음을 그 첫 계산 아래에(전에는 「계산 기록 앞」 으로 빠졌다). 실제 결과: 호스트가 `runs` · `no` 를 주고, 계산 직후의 칩이 「계산 #8 과 일치」 다.

**후속 2 — 단계 B 의 새 규칙에 낡은 `ui.mjs` 의 기대.** 걸음마다 실패의 까닭을 값으로 확인하고 고쳤다(확인하던 성질은 남겼다).

- 5절 `aisi_design_flexure(Fy, Lb, Mu)`: pass 가 null — 미검토 `G5 web crippling (no bearing load wc_P or Vu)` · `H3 bending + web crippling (…)`. 화면의 처음 값 지압 길이 89 mm 가 들어가서다. → `wc_N: 0` 을 주어 pass true.
- 6절 `aisi_design_compression` 둘: 화면의 처음 값 KtLt 3000 이 들어가 E2 가 평가되었다. → 「KtLt 없음」 을 `set_case_inputs {KtLt: null}` 로 만든다(NG 와 미검토가 함께 · 판정 없음이 OK 로 보이지 않는 성질은 그대로).
- u41: 전제가 없어졌다(「AI 가 주지 않은 Cb 가 빈다」). → AI 가 Cb 를 주지 않으면 사람의 1.1 이 그대로이고 계산에 쓴 값으로 나온다 / AI 가 `Cb: 1.3` 을 주면 「AI 가 바꾼 사람의 값」 에 「Cb: 1.100(지정) → 1.300(AI)」.
- r24b: `case.mcpOnly.design_purlin.span_ft` 칸이 없어졌다(경간이 경간 표로 간다) → `case.spans.spans[i]` 로.

시험(후속 뒤): typecheck · UI 빌드 통과, `--only=u04a,u05,u06,u41,u44a–u44e,r10–r12,r21–r25,r24b,r29,r33,r34,r42` 통과 87 · 실패 1(「desktop/ 밖에서 저장소가 바뀌지 않았다」 — 시험 도중 다른 단계가 `src/**` 를 고쳐서).

**본 것(고치지 않았다) — 뜬 자릿수의 연동 줄.** 업무 › 기록에 프로그램 연동 줄 「Fy 295 → 294.9999999999998 MPa · Fu 400 → 400.0000000000001 MPa」 가 보인다 — 끼운 화면이 단위를 오가며 되돌려 적은 값이 상태를 마지막 자리에서 바꾼 것이다. 변경 비교에 허용 오차를 넣어 보았으나 되돌렸다: 기록의 규칙(V7-24 — 「허용 오차 없음: 가장 작은 차이도 변경이다 — 비교 · 지문 · 제목이 같은 규칙」)과 부딪힌다. 고칠 자리는 비교가 아니라 상태에 쓰는 쪽(연동 · 단위 바꿈의 값이 보이는 자리 안에서 지금 값과 같으면 받지 않기 — `caseKeeper` 의 `sameShown`)이다 → 5절.

### 끝 — 닿는 시험 한 번 · 설치 파일

**시험에서 나온 것과 처리.**

| 어디 | 무엇 | 처리 |
|---|---|---|
| `case_guards_contract` | 연동 줄을 `person` 으로 기대(옛 규칙) | 시험을 D4 로(`program`) |
| `mcp_port_file_contract` | 도구 수 79 를 두 곳에서 기대 | 82 로 |
| 다리 시험 s14d | **결함** — AI 가 단순보로 `analyze_loads` 를 부르면 앞 사례의 「경간별 Ix」 목록(6개)이 남아 「개수(6)가 경간 수(1)와 다릅니다」 로 막혔다(단계 B 의 합치기에서 그 목록만 성분으로 남았다) | `mcpGroups.spanTable`: 경간 표를 묶음째 쓸 때 `I_span_in4` 를 함께 주지 않았으면 `spanIxIn4` 도 「주지 않음」(경간마다 한 값 — 경간 표의 것이다). 도구 설명도 그렇게 |
| 다리 시험 s14e | s14d 가 막힌 여파(하중 해석 결과가 없어 보고서가 나오지 않았다) | s14d 뒤 통과 |
| 화면 시험 960 px(14건) | 계산 일치 칩이 좁은 창에서 진행 띠를 넘쳐 가로 스크롤 | 1100 px 이하에서는 짧은 글(「일치」 · 「바뀜 n」), 칩 · 띠가 줄어들게 |
| 화면 시험 u15 | 화면의 SI(295.027 — US 반올림 값의 변환) ≠ MCP 의 SI(295.000 — 단계 A 뒤 반올림 전 값의 변환) | 화면의 변환도 `display_unrounded` 를 먼저 쓴다(`desktop/ui/src/units.ts`) — 단계 A 의 「남은 것」 하나가 닫혔다 |
| 화면 시험 u24 · u24b · u24c | 준비의 `aisi_design_flexure` 가 새 규칙에서 pass(화면에 남은 하중 해석의 Cb 1.14 · β 입력 · 냉간가공 켬이 들어가 뒤틀림 0.998) → NG 항목이 없어 시험이 null 을 읽었다 | 준비 입력에 `Cb: 1, dist_Lm: 0, use_cold_work: false` |
| 화면 시험 r26 | 시작 화면의 「다음 판단」 을 새로 고쳐지기 전에 읽음(전에도 부하에서 가끔) | 그 걸음이 값이 올 때까지 기다리게 |
| 고정값 시험 첫 실행 | 「browser did not start」 | 다시 돌려 통과(환경) |

**마지막 결과.**

- 뿌리: compile · lint, `check-mcp-parity`(82 도구), `test/records/run.js` 154/154(1 건너뜀), 호스트 계약 시험 — `case_guards` · `lap_section` · `reload_replay` · `records_host / changes / work / review / issue / issue_race / worklog` · `notice_render` · `verdict_display` · `panel_host` · `design_state_v13` · `mcp_port_file` · `claude_desktop` · `mcp_case_merge` · `k2_panel_case` 통과(그 앞의 `design_prepare` … `host_truth` · `load_project` · `lap_statement` 13개는 첫 실행에서 통과), 고정값 `test/rendered/k2/run.js --only=gui,mcp,reload` 11/11 · 불일치 0.
- 파이썬: `run_all.py` 483(단계 A 뒤 — 그 뒤 파이썬은 바뀌지 않았다).
- `desktop/`: typecheck · 빌드, smoke, 다리 시험 94/94, 연결 시험, **화면 시험 351/351**, 설치 단위 시험 통과.

**설치 파일.** `desktop/installer/build/dist/StCFSD-Setup-0.1.1-x64.exe` — 2026-11-24 23:13, 147.8 MiB(이 문서의 A – D 와 위 표의 고침이 든 것, 커밋하지 않은 작업 폴더에서 만들었다 — 목록 파일의 `gitDirty`). 포장본 검사 `npm run test:packaged` 59/59. 같은 날 17:16 의 것을 덮어썼다(그 내용은 커밋 `5177455` 에서 다시 만들 수 있다). git 이 무시하는 폴더라 이 PC 에만 있다. **설치는 사용자가 한다** — 이 PC 에 깔린 것은 17:16 의 빌드다. Claude Desktop 이 `StCFSD.exe` 를 MCP 서버로 쥐고 있으니 Claude Desktop 을 먼저 끝내고 설치한다. 판 번호는 그대로 0.1.1 이다(번호로는 못 가린다 — 업무 탭이 「할 일 · 기록 · 점검」 이면 새 것).

---

## 5. 남은 것 · 사용자가 정할 것

**사용자가 정할 것.**

1. **저장 형식(D2).** 통일안 6.3 은 `.<앱>/worklog.jsonl` 한 파일을 말한다. StCFSD 는 `.stcfsd/log/<종류>/<작성자>.jsonl`(작성자별 · 서명)을 그대로 두고 읽고 쓰는 면(`work_log` 의 키 · 화면)만 맞췄다. 파일까지 같아야 하면 기록의 설계를 다시 정해야 한다(동기화 충돌 · 손댄 줄을 가려내는 보장과 맞바꾼다).
2. **화면의 처음 값(D1 의 귀결).** AI 가 넘기지 않은 입력은 이제 화면의 값이다. 화면은 지압 길이 89 mm · 냉간가공 켬 · KtLt 같은 처음 값을 가지고 시작하므로, AI 의 짧은 호출도 그 값으로 계산된다 — `aisi_design_flexure(Fy, Lb, Mu)` 만 주면 웹 크리플링이 지압 하중 없이 검토 대상이 되어 「판정 없음」 이 되고(빼려면 `wc_N: 0`), 퍼린 사례 하나는 지점 웹 크리플링이 들어가 4.9 % OK → 128.3 % NG 가 되었다. 화면 단추의 결과와 같아진 것이고 응답이 그 값과 출처를 밝히지만, 처음 값 자체(특히 지압 길이)를 비워 둘지는 정할 일이다.
3. **커밋 · 푸시.** 이 문서의 작업은 모두 커밋하지 않았다(`feature/desktop-program` 의 작업 폴더).

**남은 것(이번에 하지 않았다).**

- 4.7 의 낮은 것 셋: 편집 상태(F2)에서 바꾼 고유치 수의 변경 기록, `new_case` 가 직전 모델을 물려받는 것(`section-only` + `from: 'current'` 가 부재 유형도 물려받는다), 파일에 없는 기준응력(열 때마다 경고).
- 뜬 자릿수의 연동 줄(「Fy 295 → 294.9999999999998 MPa」) — 끼운 화면이 단위를 오가며 되돌려 적는 값. 고칠 자리는 상태에 쓰는 쪽(4절 D).
- 끼운 화면(`webview/js/app.js`): SI 표시가 여전히 US 반올림 값의 변환(0.03 %), 조항 이름표에 E3.1.1.1 없음, `notices.js` 의 `render` 가 등록되지 않은 글을 빈 글로 그린다.
- MCP 의 SI 응답에서 중첩 묶음(`shear.Vn` · `positive_region.*` · `web_crippling.*`)은 여전히 반올림 값의 변환이다.
- 화면 칸이 없는 인자(`kphi` · `Fcre` · `moment_sign` …)는 그 호출에만 쓰인다 — 「설계 검토 실행」 단추로는 다시 나오지 않는다(응답의 `case_args_not_on_screen` 이 알린다).
- 설계 도구가 다른 결과의 입력을 바꿔도(예: 랩 도구의 Fy) 그 결과를 무효로 하지 않는다(전과 같다).
- `work_status.calc` 는 종류를 가리지 않는다(마지막 실행 뒤의 묶음 수) — 종류별 일치는 `results[*].state`.
- 퍼린 38구간 요약이 시험의 크기 기준(40,960 B)까지 약 130 B.
- 화면의 판정 요약은 호스트가 「지금 결과의 지배 · 최대」 를 따로 주지 않아 부재 검토 실행들의 판정비에서 고른다.
- 검증 문서의 참고값 하나(「Mcrd 16.21 이면 Mnd 7.878」)는 재현되지 않는다(F4.1-2 로 7.907) — 문서 쪽을 고칠 것.
- 독립 검증(수정에 참여하지 않은 눈)은 하지 않았다 — 사용자가 과정을 줄이라고 했다. 각 단계의 결과는 그 변경을 증명하는 시험 한두 개를 오케스트레이터가 다시 돌려 확인했고, 끝에 닿는 시험을 한 번 돌렸다.
