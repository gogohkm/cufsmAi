# desktop/ui — 새 검토 화면 (U1 · U2 · U3)

2026-11-23 · 상태: **U3 끝** — 템플릿 00 · 01 · 02 · 03 · 04 · 05 · 06 이 실제 데이터로 돈다(U1: 틀 · 트리 · 정보 창, U2: 보기, U3: 계산 시트 · 우클릭 메뉴 · 찾기 · 「Claude 가 보는 선택」 · AI 따라가기 · 3D). 값은 검토 항목 계약(`design_checks`)과 보기 계약(`get_view` · `focus`)에서.

사람이 AI 가 한 일을 **검토하는** 화면이다. 단면 · 해석 · 검토를 바꾸는 일은 Claude Desktop 에 말로 한다. 이 화면은 읽고, 고르고, 본다.
손으로 직접 입력할 때만 편집 상태(F2)를 켠다 — 지금의 설계 화면(탭 6개)이 그대로 열린다.

- 목표 모습: [`desktop/design/`](../design/README.md) 의 00 시작 · 01 모델 — 단면 · 04 결과 — 부재 검토
- 구성안: [`docs/implementation/20261122-desktop-interface-proposal.md`](../../docs/implementation/20261122-desktop-interface-proposal.md) 3장(화면) · 7장(U1)
- 화면 다리: [`desktop/host/BRIDGE.md`](../host/BRIDGE.md) — 이 화면은 거기 적힌 경로만 쓴다

## 돌리기

```
npx tsc -p ./                                  # 저장소 루트 — out/
cd desktop && npm install && npm run build     # 호스트 · 다리 + 이 화면(ui/dist)
npm run serve:ui -- --open <파일.csd>           # = serve --ui. 「화면:」 줄의 /ui/?t=… 주소를 브라우저로 연다
npm run test:ui                                # 빌드 → 화면 시험(진짜 호스트 · Python · MCP 클라이언트, headless Edge)
cd shell && npm start -- --ui <파일.csd>        # 창(Electron)에서. npm run start:ui 도 같다
```

- 브라우저: `serve --ui` 가 낸 주소(`http://127.0.0.1:<포트>/ui/?t=<토큰>`). 토큰은 첫 요청에서 HttpOnly 쿠키로 바뀌고 주소에서 빠진다. `?theme=light|dark`.
- 테마는 페이지를 다시 싣지 않고 바꾼다(`window.__stcfsdUi.setTheme` — 창의 메뉴 「보기 › 테마」가 이것을 부른다). 끼운 설계 화면은 아직 보내지 않은 입력을 잃지 않게 다시 싣지 않으므로, 그 안의 색은 다음에 실을 때부터 새 테마다(다리가 웹뷰의 테마를 HTML 을 내줄 때만 넣는다).
- `--ui` 없이 띄우면 지금처럼 틀(`/`)이다. 다리는 두 경우 모두 `/ui/` 를 내준다(`serve`) — 무엇을 여는지만 바뀐다. 창(Electron)은 `--ui` 일 때만 이 폴더를 다리에 준다.
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

엔진 · 호스트는 US 다. 화면은 SI(mm · MPa · kN · kN·m)로 **보이기만** 한다. 바꾸는 곳은 `src/units.ts` 하나이고, 그 파일은 제품의 `src/mcp/siUnits.ts` 를 묶는다 — MCP 도구가 `units:"SI"` 로 돌려줄 때와 같은 표 · 같은 곱셈이다(단면 성질 · cutwp · DSM · 부재 설계 · 퍼린 설계는 그 도구의 출력 표로 통째로, `get_full_state` · `get_nodes` · 모델 치수는 `toSI(값, 종류)`). 바꾼 값을 모델로 되돌리는 길은 없다(이 화면은 모델을 쓰지 않는다). 엔진이 쓴 글(경고 · 가정 · 범위)은 US 그대로다.

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

### 판정

엔진의 `pass` · `limit_state_checks` · `not_evaluated` · `not_checked` 를 그 차례대로 옮긴다. 화면이 판정을 만들지 않는다.

- 한계상태 줄: `pass` true → OK, false → NG, 그 밖 → 미검토. `not_evaluated` 의 항목은 「미검토 — 평가 못 함」 줄(판정비 없음). 트리는 NG · 미검토 · OK 로 센다(미검토는 합격이 아니다).
- 검토 전체: 엔진의 `pass`(true OK · false NG · null **판정 없음**). NG 가 미검토를 이기고, 미검토가 OK 를 이긴다 — 엔진이 이미 그렇게 낸다.
- 「범위 밖」(`not_checked` — 구현 안 됨 · 입력 없음)은 판정에 들어가지 않고 미검토와 따로 보인다. 「해당 없음」(`distortional_applicable: false`)도 따로.
- 경고(`warnings`) · 가정(`assumptions`) · 범위(`scope_notes`)는 세 목록으로 따로. 하위 묶음(`shear` · `positive_region` …)의 것은 `[shear] …` 처럼 앞에 이름을 붙여 같은 목록에 둔다. `dsm_warning` 은 `[DSM] …` 으로 경고에.
- 판정비 글자: 소수 3 자리, NG 는 올림 · 그 밖은 내림(1.0004 NG 가 「1.000」, 0.99996 OK 가 「1.000」으로 보이지 않게 — StAnal 과 같은 규칙).
- 결과가 없으면 「결과 없음」 · 「아직 평가 안 함」, 지워졌으면 「낡음 — 결과를 지웠다」. 빈칸 · 0 · 옛 수를 적지 않는다.

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
| 설계 · 하중 · 접합 입력(설계 Fy · Fu, 스팬 · 지점 · 랩 · 간격 · 데크, 하중 케이스 · 조합, Lb · Cb, 접합 입력) | 웹뷰 DOM 에만 있다. 모델 탭의 그 가지는 「편집 상태에서」 · 정보 창은 「편집 상태의 입력 칸에만 있다」. 부재 검토 결과가 있으면 그 결과가 돌려준 값(Fy_used · Lb · Cb · 설계법)만 보인다 | K2 |
| 출처(누가 정했나: AI · 사용자) | 「기본값인가 아닌가」만 판정한다(구성안 7장). 나머지는 「지정」 | R2(K2 가 바탕) |
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
7b. u07 끼운 웹뷰가 붙어 있다(숨김) → F2 → 그 「해석 실행」 → 새 화면의 좌굴 ● · 부재 검토 낡음(「New analysis started」) → F2 → 숨김 · 좌굴의 수 = MCP · MCP 토큰이 DOM 에 없다 · 시험 내내 예외 · 오류 0
8. IPC shutdown → 코드 0 · 자식 0 · 포트 · 포트 파일
9. `--ui` 없이 띄운 serve — 「화면:」 은 틀 · `/` 는 틀
10. desktop/ 밖 저장소 · 사용자 설정 · Claude 설정 그대로

창(Electron)은 `desktop/shell/test/ui.mjs`(shell 의 `npm test` 끝): `--ui` 로 띄워 `/ui/` · 명령줄의 .csd 가 검토 화면 · 끼운 웹뷰 · F2 · 쿠키 0 · 창은 보이지 않고 포커스 0 · 끝내면 자식 · 포트 파일 0.
