# desktop/ui — 새 검토 화면 (U1 – U4, 기본 화면)

2026-11-24 · 상태: **U4 끝 — 기본 화면** — 템플릿 00 · 01 · 02 · 03 · 04 · 05 · 06 · 09 가 실제 데이터로 돈다. `serve` · 창(Electron) · 설치본이 스위치 없이 이 화면을 연다. 예전의 틀은 한 판 동안 `--ui classic`(창 `StCFSD.exe --ui classic`, 개발판 `npm run start:classic`, 브라우저 길 `npm run serve:classic`).

사람이 AI 가 한 일을 **검토하는** 화면이다. 단면 · 해석 · 검토를 바꾸는 일은 Claude Desktop 에 말로 한다. 이 화면은 읽고, 고르고, 본다.
손으로 직접 입력할 때만 편집 상태(F2)를 켠다 — 지금의 설계 화면(탭 6개)이 그대로 열린다.

- 목표 모습: [`desktop/design/`](../design/README.md) 의 00 시작 · 01 모델 — 단면 · 04 결과 — 부재 검토
- 구성안: [`docs/implementation/20261122-desktop-interface-proposal.md`](../../docs/implementation/20261122-desktop-interface-proposal.md) 3장(화면) · 7장(U1)
- 화면 다리: [`desktop/host/BRIDGE.md`](../host/BRIDGE.md) — 이 화면은 거기 적힌 경로만 쓴다

## 돌리기

```
npx tsc -p ./                                  # 저장소 루트 — out/
cd desktop && npm install && npm run build     # 호스트 · 다리 + 이 화면(ui/dist)
npm run serve -- --open <파일.csd>              # 기본이 이 화면(U4) — 「화면:」 줄의 /ui/?t=… 주소를 브라우저로. 예전의 틀은 npm run serve:classic
npm run test:ui                                # 빌드 → 화면 시험(진짜 호스트 · Python · MCP 클라이언트, headless Edge)
cd shell && npm start -- <파일.csd>             # 창(Electron) — 기본이 이 화면. 예전의 틀은 npm run start:classic(= --ui classic)
```

- 브라우저: `serve` 가 낸 주소(`http://127.0.0.1:<포트>/ui/?t=<토큰>`). 토큰은 첫 요청에서 HttpOnly 쿠키로 바뀌고 주소에서 빠진다. `?theme=light|dark`.
- 테마는 페이지를 다시 싣지 않고 바꾼다(`window.__stcfsdUi.setTheme` — 창의 메뉴 「보기 › 테마」가 이것을 부른다). 끼운 설계 화면은 아직 보내지 않은 입력을 잃지 않게 다시 싣지 않으므로, 그 안의 색은 다음에 실을 때부터 새 테마다(다리가 웹뷰의 테마를 HTML 을 내줄 때만 넣는다).
- U4 부터 스위치 없이 이 화면이 기본이다 — `/` 는 `/ui/` 로 간다. 예전의 틀은 한 판 동안 `--ui classic`(serve · 창 모두, `npm run serve:classic` · `cd shell && npm run start:classic`)일 때 `/` 에 있다. 창(Electron)은 이 폴더가 있으면 늘 다리에 준다.
- 같은 다리에 화면을 둘(`/` 와 `/ui/`) 열면 끼운 설계 웹뷰는 뒤에 연 쪽이 가져간다(BRIDGE.md 8절 「두 탭」).

## 구조

```
index.html          틀: 제목 표시줄(진행 띠) · [트리 | 보기 | 정보 창 + 「Claude 가 보는 선택」] · 상태 표시줄, 시작 화면(덮개), 끼운 설계 웹뷰(#edit)
style/ui.css        살아 있는 화면에 필요한 것만(창 높이 · 단추 · 빈 값 · 판정비 표 · 보기 칸 · 표 서랍 · 편집 칸 · 물음 상자 · 밝은 테마의 그림 색 · 좁은 창)
build.mjs           esbuild — src/main.ts → dist/main.js(ESM 한 파일). 템플릿 CSS 셋(design/assets 의 review · app · cfsd)을 dist/ 로 그대로 복사
src/
  main.ts           진입점 — 다리의 이벤트 → 다시 읽기 → 다시 그리기, 탭 · 고르기, F2 · Ctrl+O · Ctrl+S
  bridge.ts         다리 클라이언트: /api/mcp/action(AI 와 같은 호스트 경로) · /api/wv/<id>/last · /api/events · /api/claude/*
  store.ts          화면 상태 한 곳 — 무엇을 어디서 읽는지(아래 표), 진행 띠의 상태, 판정 줄, 「기본값」 판정
  units.ts          표시 단위 — 이 화면에서 단위를 바꾸는 유일한 곳(제품의 src/mcp/siUnits.ts 를 그대로 묶는다)
  format.ts         글자 — 수(유효 숫자 · ×10ⁿ) · 판정비(소수 3 자리, NG 올림 · 그 밖 내림) · 판정 · 「결과 없음」. 수마다 data-v · data-src · data-u
  names.ts          엔진 이름 → 화면 이름(템플릿 · 하중 경우 · 경계조건). 값은 바꾸지 않는다
  titlebar.ts       StCFSD · 검토 대상 ▾(열기 · 저장) · 진행 띠 | 편집 F2 · Claude 연결 상태 · 「연결」/「끊기」
  tree.ts           트리 탭 4개의 가지와 그리기
  info.ts           정보 창(단면 · 재료 · 해석 조건 · 좌굴 해석 · 부재 검토 · 접합부 · 기록 없는 것)과 「Claude 가 보는 선택」의 글
  center.ts         가운데 — 보기 고르기(단면 · 모드 형상 · 좌굴 곡선 · 부재 · 판정비 · 접합 도면, 한 번에 셋까지), 정직한 빈 상태, 표 서랍의 표
  section.ts        단면 그림(치수선 · 주축 · 도심 · 전단 중심 · 응력 띠 · 모드 형상) — 데이터 → SVG 의 순수 함수
  curve.ts          좌굴 곡선(모드 1 + 고차 모드, 엔진의 극소, cFSM 분류 띠, 고른 반파장)
  member.ts         부재 보기(경간 · 지점 · 랩 · 하중, M · V · 처짐 도표, 지점 반력, 이름 붙은 위치, 판정비 띠)
  lap.ts            접합 도면(측면도 · Cut A-A 「개략」 · 패스너 배치), 단일 접합 개략
  drawer.ts         표 서랍(보기 뒤의 표 — 정렬 · 탭으로 나눈 글로 복사)
  zoom.ts           확대(휠) · 옮기기(끌기) · 맞춤(두 번 누르기 · 「전체 맞춤」) — SVG viewBox 만 바꾼다
  sheet.ts          계산 시트(템플릿 05) — 검토 항목 하나의 1. 부재와 가정 · 2. 소요강도 · 3. 한계상태별 계산(엔진의 steps 를 그대로 편다)
  follow.ts         보기 보고(report_view) · 「Claude 가 보는 선택」 · AI 의 focus 요청(따르기 · 알림) · 화면 키 ↔ 보기 계약의 item id
  ctxmenu.ts        우클릭 메뉴(트리 줄 · 값 · 표의 줄 · 그림 — 템플릿 01 · 04 의 항목과 단축키)
  find.ts           찾기(Ctrl+F) — 검토 항목 · 구간 · 절점 · 요소 · 값
  caseFields.ts     검토 상태(K2)의 칸 — 제품의 하나뿐인 표(webview/js/designState.js FIELDS)를 묶고 화면의 한국어 이름 · 출처 꼬리표만 더한다
  caseView.ts       모델 탭의 부재 · 하중 · 설계 조건 · 접합부 · 재료 — get_case_inputs 의 값 · 단위 · 출처, 경간 표, 「AI 가 바꾼 사람의 값」
  editstrip.ts      편집 상태의 띠(템플릿 09) — 「이번 편집 — 바뀐 것 N」 · AI 대기 · 편집 마치기 · 버리기(R2 전 꺼짐)
  checklist.ts      점검(validate_design 의 항목 — 결과 탭)과 문서 탭(계산서 · 좌굴 해석 보고서 · 검증표 — generate_report 의 파일, sandbox 미리보기)
  changes.ts        R2-3 — 변경 묶음(list_changes detail fields) · 출처 꼬리표(입력 키 last_change, 모델 칸은 칸 글) · 06 의 낡음 풍선 · 비교 기준
  work.ts           R3-3 — 업무 항목 · 가정 · 원자료(work_items · assumptions · sources — recordsChanged 의 종류만 다시 읽는다)
  reviews.ts        R4-2 — 확인 표시(get_reviews 읽기, 표시 · 믿기는 /api/person/review · trust 만 — shown = 그린 지문 · 업무 · 가정은 seq · 입력 묶음은 group_fps)
  alts.ts           R4-3 — 대안(alternatives list · compare · open, 열쇠마다 나란히 · 지키기 · 이름 · 숨기기는 /api/person/alternative)
  docs.ts           R5-3 — 문서 · 발행(documents list · check, 미리보기 · 발행 · 내보내기는 /api/person/issue/preview · issue · export 만 — 템플릿 08)
  notices.ts        엔진의 글(경고 · 가정 · 범위 · 미검토 · 이유 · 패스너 이름표) — 제품의 webview/js/notices.js 를 그대로 묶어 한국어 · SI 로, code 를 data-code 에(K4b)
  webopts.ts        결정 T7 — 부재 검토 정보 창의 「웹 구멍」 · 전단(곡선 · kv · qs) · 웹 크리플링(Rc) · 「횡방향 웹 보강재 §G4.1」 · 「휨 + 비틀림 §H4」 묶음(결과에 있을 때만)
  records.ts        기록 갈래 R1-3 — 프로젝트 · 검토 대상(get_full_state.project · list_cases · get_case_status), 띠, 사람만 하는 일(/api/person/*)
  v3d.ts            3D 모드 형상 — 제품의 렌더러를 /ui/viewer3d/ 에서 싣고 캔버스 하나를 다시 그릴 때마다 옮겨 붙인다
  start.ts          시작 화면(템플릿 00)
  edit.ts           편집 상태 — 설계 웹뷰를 늘 붙여 두고 F2 로 보인다, 두 번째 웹뷰(좌굴 보고서) 칸. 끼운 웹뷰는 다리의 웹뷰 서버(다른 출처)라
                    문서에 닿지 않고 postMessage 로만: 웹뷰 열쇠 건네기(need-key) · 테마 · 「열기」 · 「저장」 단추 · 웹뷰 안의 F2(V5 — host/BRIDGE.md 2절 끝)
  dialogs.ts        호스트의 물음(알림 · 고르기 · 입력 · 열기/저장) · 잠깐 뜨는 알림 · 진행
  dom.ts · tips.ts · menu.ts   도우미 · 풍선 도움말 · 작은 펼침 목록(StAnal 의 것을 옮김)
test/
  ui.mjs            화면 시험(아래). 그림은 test/out/*.png(git 에 넣지 않음)
```

TypeScript, 프레임워크 없음(StAnal 과 같은 결정). 다리의 CSP(`script-src 'self'`)라 인라인 스크립트가 없다. 템플릿의 CSS 는 고치지 않고 쓴다 — 시험이 「design/assets 와 한 글자도 다르지 않다」를 본다.

## 화면의 각 자리와 데이터

| 자리 | 무엇을 | 어디서 |
|---|---|---|
| 제목 표시줄 | 「검토 대상 ▾」의 열기 · 저장 | 끼운 설계 화면의 Open · Save 단추를 누른다 — 그 화면이 늘 쓰던 길(웹뷰 → 호스트 → 열기/저장 물음). 다리에 상태를 바꾸는 경로를 새로 두지 않았다 |
| | 파일 이름 | `/api/state` 의 `currentName` · 이벤트 `file:current` |
| | 진행 띠 6 단계 | 아래 「진행 띠」 |
| | Claude 연결 상태 · 「연결」/「끊기」 | `GET /api/claude/status`(10 초마다 · `claude:status`) · `POST /api/claude/connect|disconnect` — S4 와 같은 길 |
| 시작 화면 | 지금 모델 한 줄(작은 단면 · 진행 띠) | 아래 모델 · 절점과 같은 것 |
| | Claude Desktop 연결 세 단계 | `/api/claude/status`(등록 · 다시 시작 필요 · 마지막 호출) |
| 트리 · 정보 창 — 모델 | 절점 · 요소 · 스프링 · 구속 수, 경계조건, 반파장, 재료 E · ν · G, 절점 응력 범위 | MCP `get_full_state` |
| | 단면 템플릿과 치수(H · B · D · t · r · 립 각도), 하중 경우, 고유치 수 | 호스트가 설계 패널에 보낸 마지막 `modelLoaded` — **MCP 도구는 이것을 돌려주지 않는다**(K4) |
| | 「기본값」 꼬리표 | 지금 모델의 묶음(단면 · 재료 · 해석 조건)이 다리가 보낸 첫 `modelLoaded`(프로그램이 시작할 때 채운 것)와 같고 파일을 연 적이 없을 때 · 템플릿에서 주지 않은 치수(r → 0, 립 각도 → 90°) |
| | 단면 성질 A · Ixx · Izz · Ixz · Sx · Sz · rx · rz · xcg · zcg · θp · I11 · I22 | MCP `get_section_properties`(호스트 액션 `get_properties`) |
| | J · Cw · 전단 중심 | MCP `get_cutwp`(`cutwp`) |
| 가운데 — 단면 | 절점 · 요소 그림, 절점 · 요소 표 | MCP `get_nodes` · `get_elements`. 도심 = 단면 성질의 xcg · zcg, 폭 · 높이 치수 = `get_full_state.section` |
| 트리 · 정보 창 — 좌굴 해석 | Pcr / Mcr(국부 · 뒤틀림 · 전체) · 반파장 · LF · 기준 Py/My · 기준 응력 · 경고 · 가정 · 범위 | MCP `get_dsm_values`(`get_dsm`, 해석의 하중 계열 = 호스트가 보낸 `dsmResult.load_family`). 해석이 최신일 때만(`get_full_state.hasAnalysis`) |
| 트리 · 가운데 · 정보 창 — 부재 검토 | 한계상태 줄(판정비 · 판정), 미검토 줄, 범위 밖, 해당 없음, 엔진이 쓴 값, 경고 · 가정 · 범위 | 호스트가 보낸 마지막 `designResult`(AI 의 `aisi_design_*` 든 편집 상태의 「설계 검토 실행」이든 같은 길) · `designPurlinResult`(구간마다 한 묶음) |
| 접합부 검토 | 판정 · 판정비 · 「자체 가정」 알림 | 마지막 `lapConnectionResult` · `connectionResult` |
| 하중 해석 | 결과가 있는가 · 지배 조합 | 마지막 `loadAnalysisComplete` |
| 「Claude 가 보는 선택」 | 고른 줄의 글 | 이 화면. AI 가 읽는 길(`get_view`)은 U3 |
| 상태 표시줄 | 고른 것 · 마지막 변화 · 설계법 · 단위 · AI 마지막 호출 | 위의 것들 · `/api/claude/status` 의 `lastAiCall` |
| 보기 — 단면(01) | 치수선 H · B · D · t · r | 호스트의 `modelLoaded.sectionParams`(SI 로 보이기만). 자리는 `src/section.ts` 머리글의 규칙(아래) |
| | 주축 1 · 2 와 θp, 도심 | `get_section_properties` 의 `thetap` · `xcg` · `zcg` |
| | 전단 중심 | `get_cutwp` 의 `Xs` · `Zs` |
| | 응력 띠 · σ 최대 · 최소 | `get_nodes` 의 7 열(절점 응력) |
| 보기 — 좌굴(02) | 곡선(모드 1 · 고차 모드) | 호스트 액션 `get_curve`(= MCP `get_buckling_curve`), 반파장 in → mm |
| | 극소 국부 · 뒤틀림 · 전체 | `get_dsm_values` 의 `Lcrl · LF_local` … — **화면이 극소를 찾지 않는다** |
| | 모드 형상(2D) · 작은 그림 셋 | 호스트가 보낸 마지막 `analysisComplete` 의 `shapes[길이][자유도][모드]` — u(전역 x) · w(전역 z)를 절점에 더한다, 배율 임의 |
| | cFSM 분류 띠 · 정보 창의 G · D · L · O % | `analysisComplete.classifications` · `classifyResult`. 엔진이 분류를 안 하면(`classification_status` — 둥근 모서리 등) 「분류 없음 — 까닭」 |
| 보기 — 부재 · 하중(03 · 04 가운데) | 경간 · 지점 · 랩 끝 · 변곡점 · 하중 wu · 조합 | `design_purlin` 의 `load_analysis`(호스트의 `designPurlinResult`) 또는 `loadAnalysisComplete` — `auto_params.unbraced` · `governing` |
| | M · V · 처짐 도표, 지점 반력, 이름 붙은 위치, 경간 처짐 | `governing.x_diagram · M_diagram · V_diagram · R_envelope_max · locations`, `deflection.D_diagram · per_span` — 엔진 점 그대로 이은다(V 의 최대 · 최소 글자도 그 점 가운데 하나) |
| | 판정비 띠(구간마다), 고른 구간 강조, 띠를 누르면 그 검토 | `designPurlinResult.regions[i]`(`start_ft` · `end_ft` · `result.utilization` · `pass`). 중력(정 · 부모멘트 · 랩) 줄과 양압 줄을 따로. pass null = 빗금(미검토), false = 빨강 |
| 보기 — 접합(06) | 측면도(랩 길이 · d · 패스너 수 · 열 · 짝힘 V「자체 가정」), 패스너 배치(e · s · 지름) | `lapConnectionResult`. 패스너 자리 = 지금 웹뷰의 랩 도면과 같은 규칙(한 열의 반은 왼쪽 랩 끝에서 e + i·s, 나머지는 오른쪽 끝에서) |
| | Cut A-A | 지금 단면을 두 겹으로 — 「겹침 — 개략」(같은 플랜지 Z 는 실제로 그대로 겹치지 않는다). 열 높이는 개략(엔진이 정하지 않는다) |
| 표 서랍 | 곡선 점 · 극소 · 위치별 소요강도 · 도표 점 · 지점 반력 · 구간 판정비 · 패스너 · 계산 단계 · 한계상태 | 위 보기와 같은 값. 03 만 처음부터 펼쳐져 있다(템플릿) |
| 검토 항목(트리 · 04 · 시트) | 줄 하나 = 엔진의 `design_checks` 한 항목(고정 id · `name_ko` · 조항 · 소요 / 설계강도 · 비 · 판정 · 지배). 퍼린은 구간의 검토 지점(`result.checks[p]` — 지점마다 `location` · `combination` · `design_checks`)마다 | 호스트의 `designResult` · `designPurlinResult` · `lapConnectionResult` · `connectionResult` 를 제품 표(`siUnits` — `quantity` 로)로 통째로 SI 로. 호스트가 지금 결과로 아는 것만(`get_full_state.results` — 다리 기록의 옛 메시지는 쓰지 않는다) |
| 판정비 띠(04) | 구간 막대 + **검토 지점마다 막대**(엔진의 `location.x`, 그 지점의 `utilization` · `pass`), 고른 항목의 **검토 위치 표지**(`x = …`, 그 x 에 도표 점이 있으면 그 점) | 위와 같다 |
| 계산 시트(05) | 1절 — 단계 입력 가운데 단면 · 재료 · 좌굴 해석 · 다른 검토에서 온 값(왼쪽)과 입력 · 기본값 · 하중 해석에서 온 값(오른쪽), 검토 위치 · 조합. 2절 — 같은 지점 항목들의 소요 · 조합 · 위치와 작은 모멘트도. 3절 — 같은 지점의 항목마다 덩어리(엔진 순서): 고른 것은 펼쳐 단계마다 [종류 · 기호식 = 대입 = 결과 · 식 번호 · 출처 꼬리표], 갈래는 조건과 맞음 · 아님, 판정 단계. 나머지는 한 줄(소요 / 설계강도 · 비). 미검토 · 해당 없음은 엔진의 `reason`, 참고값은 「판정에 쓰지 않음」 | 위의 항목 그대로. 대입은 `expr` 의 기호 자리에 `inputs` 의 값을 놓는 보이기다(곱은 「×」로) — 기호를 다 찾지 못하면 꾸미지 않고 입력을 나열한다. **시트는 계산하지 않는다** — 결과는 늘 `result` |
| 요소의 자리(01 표) | 아래 립 · 아래 플랜지 · 웨브 · 위 플랜지 · 위 립 · 모서리 … | `get_full_state.element_roles`(템플릿 단면만 — 손으로 만든 단면은 「—」) |
| 「Claude 가 보는 선택」 | 호스트가 **받아 적은** 마지막 보기 보고 — `get_view` 가 돌려줄 것 그대로(`data-item` = selection) | 고를 때 · 보기를 바꿀 때 0.4 초 모아 호스트 액션 `report_view`(`screen: 'review'`, `view`, `selection`, `follows_focus`, `by`) |
| AI 따라가기 | 켜 두고 사람이 5 초 넘게 가만히 있고 편집 상태가 아니면 AI 의 `focus` 를 따라간다(트리 · 보기 · 정보 창 · 열린 시트, `by: 'focus'`, 까닭을 띠에 10 초). 아니면 움직이지 않고 「AI 가 가리킴 — 가기」 띠. 이 화면에 없는 항목이면 「없다」고 보이고 따르지 않는다. 어느 쪽이든 다음 보고에 `focus_response` | 다리의 이벤트 `host:message`(focusRequest — 본문을 한 번만 싣는다, BRIDGE.md) |

호스트 → 설계 패널 메시지(`modelLoaded` · `analysisComplete` · `analysisInvalidated` · `designResult` …)가 지나갈 때마다 다리가 `host:message` 이벤트를 낸다(본문 없음). 화면은 0.25 초 뒤 위의 것을 다시 읽는다 — AI 가 MCP 로 바꾼 것도, 편집 상태에서 사람이 바꾼 것도 같은 길로 따라온다. 새로 고침하지 않는다. 보는 자리(탭 · 고른 줄)는 바꾸지 않는다(구성안 3.9). 모델이 바뀔 때만 단면 성질 · 절점을 다시 묻는다.

### 단위

엔진 · 호스트는 US 다. 화면은 SI(mm · MPa · kN · kN·m)로 **보이기만** 한다. 바꾸는 곳은 `src/units.ts` 하나이고, 그 파일은 제품의 `src/mcp/siUnits.ts` 를 묶는다 — MCP 도구가 `units:"SI"` 로 돌려줄 때와 같은 표 · 같은 곱셈이다(단면 성질 · cutwp · DSM · 부재 설계 · 퍼린 설계는 그 도구의 출력 표로 통째로, `get_full_state` · `get_nodes` · 모델 치수는 `toSI(값, 종류)`). 바꾼 값을 모델로 되돌리는 길은 없다(이 화면은 모델을 쓰지 않는다). 엔진이 쓴 글(경고 · 가정 · 범위 · 미검토 · 이유 · 패스너 이름표)은 제품의 하나뿐인 그리기 `webview/js/notices.js`(`src/notices.ts` 가 묶는다)로 한국어 · SI 로 그린다(보기 계약 4d) — 화면은 글을 고쳐 쓰지 않는다. 알림(code)이 없는 글(엔진의 not_checked · 호스트가 더한 글)은 그 글 그대로이고, SI 면 그 안의 US 상수만 notices.js 가 바꾼다.

### 진행 띠 — 무엇이 최신인가

계산하지 않는다. 호스트가 지운 것 · 남긴 것만 본다.

| 단계 | ● 일치 | ◐ 낡음 | ○ 아직 안 함 |
|---|---|---|---|
| 단면 | 절점이 있다 | — | — |
| 좌굴 해석 | `get_full_state.hasAnalysis` | 이번 세션에 본 결과를 호스트가 지웠다(`analysisInvalidated` — 까닭 글 그대로) | 그 밖 |
| 하중 해석 | `loadAnalysisComplete` 가 남아 있다 | 같은 규칙(`invalidateLoads`) | AI 의 `analyze_loads` 는 화면에 오지 않는다(K4) |
| 부재 검토 | `designResult` · `designPurlinResult` 가 남아 있다 | 같은 규칙 | 그 밖 |
| 접합부 | `lapConnectionResult` | 같은 규칙 | 단일 접합 결과만 있으면 회색 점(「최신 여부 모름」 — 호스트가 판정하지 않는다) |
| 점검 | — | — | 늘 ○ — 검증 70 항목은 편집 상태의 검증 탭에서만 돈다(K3) |

다른 파일을 열면(`resultsCleared`) 낡음이 아니라 ○. 「이번 세션에 본 것」은 `sessionStorage` 에 둔다(새로 고침해도 남는다, 없어도 화면은 돈다 — 그때는 지워진 결과가 ○ 로 보인다). 실행 중(파란 점)은 `analysisStarted` 부터 `analysisComplete` · `dsmResult` · `analysisError` 까지.

좁은 창(E11): 제목 표시줄이 넘치면(`titlebar.fitTitle` 이 잰다 — 이름 · Claude 상태 글에 따라 넘치는 폭이 다르다) 차례로 줄인다 — 진행 띠 · 계산 일치 칩의 짧은 이름 → 진행 띠는 점(● ◐ ○)만(이름은 풍선) → 파일 이름 줄임표. 진행 띠 칸은 넘친 글을 잘라 단추 · 연결 상태 위에 그리지 않는다. 내용 폭 약 800 CSS px(셸의 최소 창 900 · 화면 배율)까지 가로 스크롤이 없다.

### 판정

엔진의 `pass` · `limit_state_checks` · `not_evaluated` · `not_checked` 를 그 차례대로 옮긴다. 화면이 판정을 만들지 않는다.

- 한계상태 줄: `pass` true → OK, false → NG, 그 밖 → 미검토. `not_evaluated` 의 항목은 「미검토 — 평가 못 함」 줄(판정비 없음). 트리는 NG · 미검토 · OK 로 센다(미검토는 합격이 아니다).
- 검토 전체: 엔진의 `pass`(true OK · false NG · null **판정 없음**). NG 가 미검토를 이기고, 미검토가 OK 를 이긴다 — 엔진이 이미 그렇게 낸다.
- 「범위 밖」(`not_checked` — 구현 안 됨 · 입력 없음)은 판정에 들어가지 않고 미검토와 따로 보인다. 「해당 없음」(`distortional_applicable: false`)도 따로.
- 경고(`warnings`) · 가정(`assumptions`) · 범위(`scope_notes`)는 세 목록으로 따로. 하위 묶음(`shear` · `positive_region` …)의 것은 `[shear] …` 처럼 앞에 이름을 붙여 같은 목록에 둔다. `dsm_warning` 은 `[DSM] …` 으로 경고에.
- 판정비 글자: 소수 3 자리, NG 는 올림 · 그 밖은 내림(1.0004 NG 가 「1.000」, 0.99996 OK 가 「1.000」으로 보이지 않게 — StAnal 과 같은 규칙).
- 결과가 없으면 「결과 없음」 · 「아직 평가 안 함」, 지워졌으면 「낡음 — 결과를 지웠다」. 빈칸 · 0 · 옛 수를 적지 않는다.
- 결과의 이용률이 판정비가 아닐 때(엔진의 `utilization_valid: false` · 결과의 `pass: null` · 가정한 길이 `length_assumed: true`)는 머리 비 자리에 「판정 없음」(풍선 = 그 까닭 — 가정한 길이, 또는 엔진이 평가하지 못한 항목의 이름 · 이유). 가정한 길이의 이용률은 「참고 r」(`data-ratio-ref`, 판정비 `data-ratio` 가 아니다)로만 — NG 여도(format.utilShown · notices.utilHtml).
- 웹 구멍 · 보강재 · §H4(결정 T7, 2026-11-26): 새 검토(`member.applicability.holes` · `member.web_stiffeners` · `member.bending_torsion`)와 조항 갈래(`clause_variant` holes · stiffened_web · web_holes)는 엔진의 이름 · 조항 그대로. 구멍 조항을 평가하지 못했는데 구멍 없는 강도(상한)로도 넘으면(엔진의 `trusted: false` · `member.reason.fails_without_holes`) 검토 줄의 비 옆에 「구멍 없이」 꼬리표, 검토 전체는 NG 와 그 하한의 비(`holes_strength_bound` · `shear.bound_without_holes` · `web_crippling.bound_without_holes` · `interaction_holes_bound` 에서 넘은 것 — format.holesBoundCandidates · resultBound, 제품 webview/js/utils.js 의 holesBoundCandidates · lengthBoundFailure 와 같은 규칙, 풍선 = 평가하지 못한 조항과 까닭). 넘지 않으면 「판정 없음」 과 까닭. 모델 › 설계 조건에 구역 셋(「웹 구멍(천공)」 · 「횡방향 웹 보강재」 · 「비틀림(§H4)」 — 「없음」 이면 한 줄, 빈 중심 간격은 「구멍 하나」).
- 랩 패스너의 힘 분배(R2): 「자체 가정」 꼬리표가 엔진의 `force_model.confirmed` 를 따라 「자체 가정 · 확인함」 / 「자체 가정 · 확인 안 함」. 밝히지 않았으면 패스너 무리의 비는 「참고」, 패스너 무리 · 개수는 엔진대로 미검토(까닭 `lap.reason.force_model_not_confirmed`), 랩 전체는 「판정 없음」. 칸은 모델 › 접합부 「힘 분배 모델 확인」(`lapForceModelConfirmed`).
- 하중조합의 기준(R4): 하중 해석의 정보 창 「조합」 · 트리 「조합 기준」 = 결과의 `load_combination_standard.edition`(key 가 없으면 고르지 않은 처음 값). 칸은 모델 › 하중 「조합 기준」(`loadComboStandard`).
- 좌굴 값의 출처(R1): 부재 검토는 호스트가 그 안에서 설계 Fy 의 S-S 서명곡선 FSM 값을 준비한다(`dsm_basis_by_family: prepared`). 「해석식 좌굴값」 꼬리표는 호스트가 `none` 이라고 한 대체(준비 실패)에서만 — 원형관은 엔진이 DSM 비적용을 범위 알림으로 밝혀 꼬리표를 달지 않는다.

## U4 — 검토 상태(K2) · 편집 상태 · 저장 안 함

| 자리 | 무엇 | 어디서 |
|---|---|---|
| 모델 탭의 부재 · 하중 · 설계 조건 · 접합부 · 재료(설계 강도) | 값 · 단위 · 출처 꼬리표(기본값 · 지정 · AI · 파일 · 하중 해석 · 연동), 경간 · 지점 · 랩 표. AI 가 그 도구의 묶음에서 주지 않은 칸은 「AI: 주지 않음」, 그 밖의 빈칸은 「빈칸」 | 호스트 동작 `get_case_inputs`(MCP 와 같은 값, US) → 제품의 `caseValueToSI`(표의 단위 종류) — `data-src="case:inputs.<키>"` |
| 「AI 가 바꾼 사람의 값」 | 앞 판에서 지정 · 파일 · 하중 해석이던 칸이 다음 판에 AI 가 된 것(이름 · 앞 값 → 지금 값) | 검토 상태 두 판의 차이(MCP 응답의 `case_inputs_replaced` 와 같은 뜻) |
| 해석 기준 응력 | 재료 자리에, AI 가 `set_load_case` 로 정했으면 꼬리표 AI | `get_full_state.load_fy` · 모델 메시지의 `loadFySource` |
| 계산 시트 「설계 가정과 출처」 | 입력 · 기본값 · 재료에서 온 단계 입력 옆에 그 칸의 검토 상태 출처 | 엔진 인자 → 상태 키(caseFields.ENGINE_TO_CASE) |
| 제목 줄 「파일 이름 ●」 | 저장하지 않은 변경 | `get_full_state.case.dirty`(= `caseDirty`) |
| 편집 상태(F2 · 「편집 F2」, 템플릿 09) | 제목 줄 「편집」 표 · 그 아래 띠(이번 편집 — 바뀐 것 N 칩 · AI 대기 · 알림 N · 「편집 마치기 F2」 · 「버리기」 꺼짐) · 트리는 그대로 · 가운데와 오른쪽에 설계 화면(탭 6개). 고친 값은 호스트에 곧바로 가고 이 화면의 트리 · 정보 창 · 시트 · 진행 띠가 따라온다. 마치기: F2 · 단추 · Esc(설계 화면 안에서도, 칸 밖일 때). 돌아오면 고른 것 · 보기 그대로 | 띠의 칩 = 편집을 연 때와 지금의 `get_case_inputs` 차이 |
| `caseDiscarded` | AI 의 `load_project` 가 저장하지 않은 변경을 버렸으면 알림(막지 않는다) | 다리 이벤트 `host:message` 의 `discarded` |

보기 보고(b60e62d — 보기 계약 2절): 화면은 id · 어휘만 보낸다 — 보기 `start` · `sheet` · `<트리 탭>/<무리>:<보기>`, 검토 항목의 위치는 퍼린의 `{region, check_point}` · 엔진의 `{segment}` 만(x · 지점 번호 등 수는 보내지 않는다), focus 답의 `note` 는 코드(`followed` · `not_in_results` · `follow_off` · `editing` · `busy`). 「Claude 가 보는 선택」 칩은 호스트가 받아 적은 것 — 호스트가 버린 칸(`dropped`)은 빼고 「호스트가 버림: …」 이라고 보인다(`data-dropped`). 퍼린 검토 지점(보기 계약 4a): 「검토 위치」에 지점 n · 경간 n(1 부터, 호스트가 채운 그대로) · 구간의 지점 · 소요 근거, 조합이 `'envelope'` 이면 「포락선」(어느 조합인지 모름), 시트의 「설계 가정과 출처」 끝에 그 지점 자신의 경고 · 가정 · 범위 · 검토 안 함.

보기 계약 kind `validation`(4b99968): 점검 항목을 고르면 `{kind: 'validation', id: 'val.*'}` 을 알리고, AI 의 `focus` 가 그 kind 면 그 항목으로(마지막 점검에 있을 때). 글 방향 제어 문자(LRM · RLM · LRE – RLO · LRI – PDI · ALM)는 화면의 모든 글(파일 이름 · 알림 · 엔진 글 · 풍선)에서 U+FFFD 로 — 호스트의 그리기(`reportRender.esc`)와 같은 규칙. 파일의 결과를 버리고 연 때(봉인 · 엔진 — 장부의 `open_project`) 제목 표시줄 아래 「입력만 열었습니다 — 까닭」 띠와 「다시 계산」(버린 차례대로 — 좌굴 해석이 버려졌으면 run_analysis → run_case_check member → 랩 · 단일 접합이 버려졌으면 lap · connection. 한 단계가 안 되어도 나머지는 하고 알림에 한 것 · 못 한 것을 적는다), 지금 저장하면 서명이 붙지 않으면 「결과 서명 안 됨」. 랩 구간 구속 진술(`lap_restrained`)이 검토 상태에 생기면 부재 · 접합부 가지에 출처와 함께.

엔진 계약(b288448)의 표시: 무리의 지배가 미검토(`governs_basis: 'not_evaluated'`)면 덩어리 머리 「지배 — 미검토」 · 「미검토 (참고 판정비 r)」, 「평가한 최대: 이름 비」 줄을 따로(머리 비로 쓰지 않는다 — 정보 창도). `out_of_scope` 는 「참고 — 적용 범위 밖」. `ratio_form` 은 「원문 좌변 소요 ≤ 강도, 견줄 비 r」 + 「비의 꼴」 꼬리표. `unbounded` 는 「∞」(바꾸지 않는다). `expr_units: 'US'` 단계는 「US 단위로 쓴 식」 + `units_note`. 랩의 `lap.block_shear`(미검토 · 판정에 안 듦)와 범위 글, Mnd 없는 랩의 뒤틀림 미검토는 엔진이 내는 대로.

## U5 — 호스트가 만든 점검 · 계산서(K3, f08e10e)

| 자리 | 무엇 | 어디서 |
|---|---|---|
| 결과 탭 「점검」 · 진행 띠 「점검」 | 항목마다 고정 id(`val.*`) · 판정(호스트의 셋 pass · warn · fail 을 편집 상태 검증 탭의 말 통과 · 주의 · 실패로) · 값 · 기준 · 주석, 분류(A … H — 검증 탭과 같은 차례)마다 수, 고르면 정보 창 | 호스트 동작 `validate_design`(detail 'full' · SI) — 「점검 실행」을 누를 때, 그리고 편집 상태의 검증 탭에서 「설계 검증 실행」을 눌렀을 때(호스트가 그 페이지에 보낸 `validationResult` 를 신호로). 화면은 다시 판정하지 않는다 |
| 점검의 낡음 · 마지막 점검(4b99968) | 호스트의 `results.validation {at, case_rev, counts, units, by}` 이 있으면 「일치」(누가 — 편집 화면 · 이 화면 / AI), 없고 장부에 kind `validation` 이면 「낡음」과 그 까닭. 항목은 호스트가 설계 패널에 보낸 마지막 `validationResult`(다리가 그 점검이 지금 것인 동안 남긴다) — 새로 고쳐도 · AI 의 `validate_design` 도 보인다. 「점검 실행」은 끼운 화면의 「설계 검증 실행」을 누른다(MCP 를 부르지 않는다 — 그러면 AI 가 돌린 것으로 적힌다) | `get_full_state` · `/api/wv/<id>/last` |
| 문서 탭 · 계산서 · 좌굴 해석 보고서 | 「만들기」 → 호스트가 HTML 을 쓰고 미리보기, 「PDF 저장」 → 호스트의 길(보이지 않는 Edge 인쇄)로 같은 폴더에 PDF · 쪽 수. 쓴 곳(열린 `.csd` 의 폴더 · 없으면 임시 폴더)과 파일 경로, 판정, 알림, 통과 아닌 검토 id | 다리 `POST /api/report` → 호스트 동작 `generate_report`. 화면은 경로를 주지 않는다 |
| 미리보기의 틀 | `<iframe sandbox="" referrerpolicy="no-referrer" srcdoc="호스트 파일 그대로">` — 빈 sandbox: 스크립트 · 폼 · 팝업 · 같은 출처 · 위 문서 이동 모두 없음(불투명 출처라 바깥 문서에 닿지 않는다). srcdoc 문서는 이 화면의 CSP(`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'` …)를 물려받는다 | 시험 u54(파일 sha256 = srcdoc) · u55(스크립트 · onerror · svg onload · 외부 스크립트를 넣어도 실행 0, Chromium 이 막은 줄이 남는다) |
| 검증표(문서 탭) | 점검과 같은 항목을 문서 꼴로 | 같음 |
| 발행 · 검토 도장 | 꺼짐 — 발행은 기록(R5), 확인 표시는 R4 | — |

점검 규칙은 지금 제품에서 고치는 중이다(K3-6) — 그동안 점검 보기 위에 그렇다고 적는다(`checklist.ts` 의 `VAL_RULES_CHANGING`, 끝나면 false).

## R1-3 — 프로젝트 · 검토 대상(템플릿 00 · 기록 설계 §5.3)

시작 화면: 「최근 검토」 = 열린 프로젝트의 대상(호스트의 `list_cases` — 단면 · 강종 · 최대 판정비 · 마지막 저장, 누르면 열기), 프로젝트가 없으면 최근 프로젝트(`/api/person/recent`)와 지금 모델 한 줄. 「폴더에서 열기」 · 「새 프로젝트」 · 「새 검토」(카드 넷 — 바닥 장선 · 스터드는 한 카드에 둘) · 「파일만 열기 (.csd)」 · 바닥 줄(프로젝트 이름 · 대상 수). 제목 표시줄: 프로젝트 안이면 「<프로젝트> ▾」(최근 · 폴더에서 열기 · 새 프로젝트) + 「검토 대상 <이름> ▾」(대상 목록 · 새 검토 · 저장 · 보관), 밖이면 「파일 <이름> ▾」(열기 · 저장 · 프로젝트로 만들기). 띠: 「프로젝트 밖 — 작업 기록이 남지 않음 · 프로젝트로 만들기」(열린 프로젝트가 없으면 고른 뒤 이어서), 「읽기 전용 — 까닭 · 새 검토 대상으로 · 넘겨받기」, 「밖에서 바뀜 — 다른 이름으로 저장 · 덮어쓰기(호스트에 바람 — 꺼짐) · 취소」. 수는 모두 호스트가 준 것. 사람만 하는 일은 다리의 `/api/person/*`(BRIDGE.md).

## 진짜와 자리

| 진짜(데이터로 돈다) | 자리(U2 · U3 · R 에서) |
|---|---|
| 제목 표시줄 · 진행 띠 · Claude 연결(연결 · 끊기) | 찾기 · AI 따라가기(U3) — 템플릿 자리에 꺼진 단추로 |
| 트리 탭 4개. 모델 · 결과 탭의 가지 | 업무 · 문서 탭 — 가지만 있고 값 자리에 「기록 없음」(R1 – R5) · 「편집 상태에서」(K3) |
| 정보 창: 단면(종류 · 치수 · 출처 · 단면 성질 · 요소 분할), 재료, 해석 조건, 좌굴 해석, 부재 검토(템플릿 04 의 머리 · 게이지 · 설계 가정 · 한계상태 표 · 세 목록), 접합부 요약 | 「확인 표시」(R4) — 보이되 꺼 두었다. 계산 시트(U3) |
| 가운데(U2): 단면(치수선 · 주축 · 전단 중심 · 응력 · 확대), 모드 형상(2D · 3D 칩), 좌굴 곡선(고차 모드 · 극소 · 분류 띠), 부재(M · V · 처짐 · 반력 · 판정비 띠 · 검토 지점 막대 · 검토 위치), 접합 도면, 표 서랍 | 문서 미리보기 — 「편집 상태의 보고서 · 검증 탭」(K3). 단일 접합 도면은 개략(배치를 엔진이 정하지 않는다) |
| U3: 계산 시트(05) · 우클릭 메뉴(트리 줄 · 값 · 표의 줄 · 그림) · 키(F · I · Enter · Space · Ctrl+C · Shift+F10 · Esc · Alt+← →) · 찾기(Ctrl+F) · 「Claude 가 보는 선택」(get_view) · AI 따라가기(focus) | 「확인 표시」 — 메뉴 · 시트 · 정보 창에 꺼진 채로, 누르면 「기록(R4)부터」. 「CSV 로 내보내기」는 파일이 아니라 클립보드로(이 화면은 파일을 쓰지 않는다) |
| 시작 화면: 지금 모델 한 줄 · 열기 · Claude 연결 세 단계 · 「단면만」 | 최근 검토 목록 · 프로젝트 폴더 · 템플릿 셋(지붕 퍼린 · 벽 거트 · 장선/스터드)(R1) — 흐리게 |
| 편집 상태(F2): 지금의 설계 화면이 늘 붙어 있고(숨김) F2 · 「편집 F2」로 가운데 + 오른쪽 자리에. 거기서 한 해석 · 검토 · 저장 · 열기 · 보고서 · 검증이 그대로 되고, 결과는 새 화면에 따라온다 | 편집 상태 다듬기 · 「이번 편집」 줄(U4) |
| 호스트의 물음(열기/저장 경로 · 알림 단추 · 고르기 · 입력) · 진행 · 알림 · 좌굴 보고서 칸 | 우클릭 메뉴(U3) |
| 「Claude 가 보는 선택」 한 줄(고른 것의 글) | AI 가 그것을 읽는 `get_view`(U3) — 점을 점선으로 두었다 |

### 치수선의 자리(01)

그림의 기하이고 공학 판단이 아니다. 바깥면 = 중심선 좌표 ± t/2. 웨브 = 절점이 가장 많은 세로 열(같으면 세로 범위가 긴 쪽 — 둥근 모서리의 호 절점은 열을 이루지 않는다). H 는 전체 높이의 왼쪽(전단 중심이 단면 왼쪽 밖이면 그보다 더 왼쪽), B 는 윗 플랜지(앵글은 아랫) 쪽 절반의 절점 가운데 웨브에서 먼 끝까지 — 웨브 바깥면부터, 립이 있으면 립 바깥면 · 없으면 끝 절점까지. D 는 그 끝 x 의 절점 열 가운데 그 플랜지 쪽 절반(립)에서 플랜지 바깥면부터 립 끝 절점까지. t 는 웨브 가운데, r 은 웨브와 그 플랜지의 모서리를 가리킨다. 각형 · 원형 · I · T 는 전체 폭 · 높이, 햇은 B = 전체 높이 · H = 윗면 폭. 시험은 립 C r 4 에서 H · B · D 치수선의 길이 = 템플릿 치수(200 · 75 · 20)를 본다.

## 다리가 줘야 할 것

| 무엇 | 왜 |
|---|---|
| (닫힘, 809caad) 3D 모드 형상 — 다리가 `/ui/viewer3d/` 로 제품의 렌더러를 이 화면의 출처에서 내준다(CSP 그대로). 이 화면이 그것을 쓴다(v3d.ts) | — |
| (U3 에서 함) `focusRequest` 를 한 번만 — 다시 보내기 기록에 남기지 않고 이벤트에 본문을 싣는다. `derivedResultsInvalidated` 가 기록의 설계 · 퍼린 · 랩 결과를 지운다 | BRIDGE.md 5절 ③ · ② |

## 제품 코드가 줘야 할 것(K2 · K3 · K4)

화면에서 흉내 내지 않고 정직한 상태를 보인 것들이다.

| 무엇 | 왜 | 갈래 |
|---|---|---|
| (닫힘, K2) 설계 · 하중 · 접합 입력 | 호스트의 검토 상태 — 모델 탭이 `get_case_inputs` 로 값 · 출처를 보인다 | — |
| (K2 로 반 닫힘) 출처 | 검토 상태의 칸은 호스트의 `sources`(기본값 · 지정 · AI · 파일 · 하중 해석). 모델(단면 · 재료 · 해석 조건)은 아직 「기본값인가 아닌가」만 — 누가 언제 바꿨는지는 R2 | R2 |
| 점검(검증 70 항목) · 계산서 · 검증표 | 웹뷰 JS 에서만 만든다. 진행 띠의 「점검」은 늘 ○, 업무 · 문서 탭은 「편집 상태에서」 | K3 |
| (닫힘, K4a) 단면 템플릿 · 치수 · 하중 경우 · 기준 응력 · 고유치 수 · 해석의 하중 계열 · 요소 자리 | `get_full_state` 에서 읽는다(모델 메시지는 「기본값」 꼬리표만) | — |
| (닫힘, K4a) AI 의 `analyze_loads` 결과가 화면에 온다 | `loadAnalysisComplete` — 시험 u17c | — |
| (닫힘, K4a) 결과의 최신 여부 | `get_full_state.results` 와 무효 장부 `invalidated` — 화면은 기억하지 않는다(세션 기억을 지웠다, 시험 u33 은 새로 고친 뒤에도 같은 까닭). 남은 것: 장부는 호스트가 다시 뜨면 비어 있다(파일에서 연 결과의 장부는 호스트가 다시 채운다) | — |
| (닫힘, 검토 항목 계약) 한계상태마다 소요 / 설계강도 · 검토 지점의 위치 x · 계산 과정 | `design_checks` · 퍼린 `result.checks[].location` | — |
| 패스너 열 높이(gauge) · 단일 접합의 배치 | 엔진이 정하지 않는다 — 도면은 「개략」, 측면도의 열 높이는 판의 ¼ · ¾ | K4 |
| 검토 항목의 `reason` · 경고 글이 영문 | 엔진의 글 그대로(계약 9절 4 — 경고는 이번 계약 밖). 이름(`name_ko`)만 한글 | K4b |
| 길이마다의 분류 구역 이름(템플릿 02 의 국부 · 뒤틀림 · 전체 바탕 띠) | 엔진은 길이마다 G · D · L · O 비율만 낸다. 구역 경계를 화면이 정하면 판단이 된다 — 그래서 비율을 쌓은 띠로 보인다 | K4 |
| 패스너 이름의 단위(`fastener_label` 「Bolt d=0.472 in」) | 엔진이 만든 글이라 US 그대로다(값은 SI 로 따로 보인다) | K4 |
| 최근 검토 목록 · 검토 대상 템플릿 | 호스트에 없다 | R1 |

## 시험(`test/ui.mjs`)

`serve --ui` 를 자식 프로세스로(진짜 호스트 · Python), 진짜 MCP 클라이언트(`media/mcp-server.js`, stdio — Claude Desktop 이 띄우는 그 서버)가 AI 자리, 이 PC 의 Edge 를 headless 로(창 없음). 마지막 실행 137 / 137, 약 85 초. 단계마다 그림 · 페이지 예외 0 · 콘솔 오류(CSP 포함) 0 · 화면 글자(새 화면과 끼운 웹뷰)에 `undefined` / `NaN` / `[object Object]` 0.

0. 빌드 · 템플릿 CSS 셋이 design/assets 와 같다
1. `serve --ui` — 「화면:」 은 `/ui/`, 준비 줄의 기본 `url` 은 틀 그대로
2. 새 경로 인증: 토큰 없음 401(6 경로) · 상태를 바꾸는 새 경로 없음(`POST /api/file/open` 404) · 다른 Origin 403 · CORS 머리 없음 · CSP · 소스 · 시험 · 뿌리 밖 404 · `/api/wv/<id>/last` · MCP 토큰이 어디에도 없다 · `/` 는 틀 HTML 그대로
3. u01 시작 화면(파일 없음) → u02 「파일만 열기」 → 열기 물음 → 경로 → 검토 화면(템플릿 기록이 없는 단면은 「템플릿 치수 없음」)
4. u03 AI 의 `set_section_template`(SI) → 트리 · 정보 창 · 그림이 따라온다(새로 고침 없음 — 창의 표지가 남는다) · **화면의 수 180 개 = MCP**(`get_section_properties` · `get_cutwp` SI 는 그대로, `get_full_state` · `get_nodes` · `get_elements` 는 × US_TO_SI, 치수는 AI 가 준 SI 입력, 글자는 반올림 반 자리 안) · 단면 그림 = 절점 · 요소(수 · 경계 상자 · 축척 0.2 px 안) · 트리에서 고르면 정보 창이 따라온다
5. u04 AI 의 해석 · 휨 검토 → 진행 띠 ● · 좌굴 해석의 수 = `get_dsm_values`(SI) → AI 가 단면을 바꾸면 좌굴 · 검토 ◐ 낡음(까닭 「Section template changed」), 옛 결과의 수 0, 새 단면의 수 = MCP
6. u05 압축(KtLt 없음 · Pu 400 kN) — 엔진 NG + 미검토 → 줄 · 트리 수 · 전체 판정 · 세 목록 · 범위 밖 · 판정비 = MCP / u06 Pu 5 kN — OK + 미검토 → 「판정 없음」
7. u08 · u09 어두운 · 밝은 테마(페이지를 다시 싣지 않고 바뀐다 — 끼운 화면의 주소 · 창의 표지가 그대로) — 글자 대비 ≥ 4.5 · u10 960 px — 트리 접힘, 가로 스크롤 없음
7c. U2 보기 — 그림의 수 = 엔진(SVG 의 `data-*` 표지와 표 서랍의 `data-v` 를 MCP · 호스트 값과 비교)
   - u10c 하중 해석이 없을 때 — 하중 · 접합 보기는 그리지 않고 밝힌다
   - u11 단면: H · B · D 치수선 = 템플릿 치수, θp · 도심 · 전단 중심 = MCP, 응력 띠 = 절점 응력, 휠 확대 → 「전체 맞춤」
   - u12 좌굴(둥근 모서리): 곡선 점 50 개 = `get_buckling_curve`, 극소 셋 = `get_dsm_values`, 모드 형상 절점 변위 = 호스트 모드 벡터, 「분류 없음」 / u12b 곡선을 누르면 모드 형상 · 정보 창이 그 길이로
   - u13 각진 모서리 · 반파장 100 × 모드 20: 분류 띠 · 정보 창의 % = 엔진, 다시 그리기 시간(평균 약 20 ms)
   - u14 하중 해석: M · V · 처짐 점 151 개 · 반력 · 이름 붙은 위치 = `design_purlin`(SI)의 `load_analysis`(Mu 가 null 인 위치는 그리지 않는다)
   - u15 판정비 띠: 구간 22 개의 판정비 · 판정 = 엔진, NG 빨강, 띠를 누르면 트리 · 정보 창 · 강조가 따라온다 / u15b 표 서랍 정렬 · 복사
   - u16 접합: 랩 길이 · d · 패스너 수 · 자리 = 엔진(+ 웹뷰와 같은 배치 규칙), 「개략」 · 「자체 가정」
   - u17 AI 가 경계조건을 바꾸면 좌굴 · 접합 보기는 낡음, 띠는 사라진다 / u17c AI 의 `analyze_loads` 는 화면에 오지 않는다 / u17b 새 해석이면 곡선이 돌아온다
   - u18 템플릿 01 · 02 · 03 · 04 · 06 × 1920 · 960 × 어두운 · 밝은(가로 스크롤 없음) / u20 판정 없음 구간은 빗금 / u19 지금의 웹뷰(편집 상태)의 곡선 · 하중도 · 랩 도면 그림(나란히 보기)
7d. U3 — 계산 시트 · 메뉴 · 찾기 · AI 따라가기 · 3D · 무효 장부
   - u21 · u22 · u22b · u23 · u24 시트 = 호스트의 design_checks(시험이 따로 제품 표로 SI 로): 퍼린 NG · 접합 미검토 · 접합 해당 없음 · 랩 · 부재 휨 NG — 덩어리(id · 판정 · governs · 단계 수), 고른 덩어리의 단계 차례(kind), 판정 줄, 미검토 · 해당 없음의 까닭, 시트의 수 전부 / u21b · u24b 정보 창 = 시트 · 「소요 / 설계강도」 열 / u24c 앞 · 다음 · 머리 누름 · Esc
   - u25 누른 항목 = `get_view` = 칩 / u26 따라가기 꺼짐 → 움직이지 않고 「AI 가 가리킴」, 「가기」 / u27 켬 + 5 초 → 트리 · 시트가 따라간다(by focus, 까닭), 모델 · 결과 · 편집 상태 그대로 / u28 지금 결과에 없는 항목 → 호스트가 거절 / u28b 화면에 없는 구간 → 「없다」 · followed false
   - u29 메뉴(템플릿 항목 · 단축키 · 확인 표시 꺼짐) / u29b 키보드(Shift+F10 · ↓ · Enter · I · Esc · Enter · F · Space · Ctrl+C) / u29c 값 · 표 줄 · 그림의 메뉴, 출처 보기 / u30 찾기 / u31 3D(CSP 위반 0) / u32 시트 · 미검토 · 메뉴 · 3D 그림 1920 · 960 × 어두운 · 밝은
   - u33(맨 끝) 낡음 = 호스트의 무효 장부 — 새로 고친 뒤에도 같은 까닭, 화면 기억(sessionStorage) 없음
7e. U4 — u40 모델 탭의 부재 · 하중 · 설계 조건 · 접합부 · 재료 = get_case_inputs(값 · SI · 출처 꼬리표, 트리도) / u40b AI 의 기준 응력 · 시트의 출처 / u41 편집 상태의 사람 값 → AI 설계 도구 → 「AI: 주지 않음」 · 「AI 가 바꾼 사람의 값」 / u42 편집 상태 띠 · 뒤의 화면이 곧바로 · 제목 줄 ● · 저장하면 사라짐 · Esc · 고른 것 그대로 / u44a–e 엔진 계약(지배 미검토 · 범위 밖 · 비의 꼴 · ∞ · 랩 블록 전단 · Mnd 없는 랩) / u45 caseDiscarded / u46 그림 1920 · 960 × 어두운 · 밝은(모델 탭 · 편집 상태)
7b. u07 끼운 웹뷰가 붙어 있다(숨김) → F2 → 그 「해석 실행」 → 새 화면의 좌굴 ● · 부재 검토 낡음(「New analysis started」) → F2 → 숨김 · 좌굴의 수 = MCP · MCP 토큰이 DOM 에 없다 · 시험 내내 예외 · 오류 0
8. IPC shutdown → 코드 0 · 자식 0 · 포트 · 포트 파일
9. `--ui classic` 으로 띄운 serve — 「화면:」 은 틀 · `/` 는 틀(스위치 없이 띄운 serve 는 1절 — `/` 가 `/ui/` 로)
10. desktop/ 밖 저장소 · 사용자 설정 · Claude 설정 그대로

창(Electron)은 `desktop/shell/test/ui.mjs`(shell 의 `npm test` 끝): `--ui` 로 띄워 `/ui/` · 명령줄의 .csd 가 검토 화면 · 끼운 웹뷰 · F2 · 쿠키 0 · 창은 보이지 않고 포커스 0 · 끝내면 자식 · 포트 파일 0.
