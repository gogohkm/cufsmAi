# V4 — 경계층을 실제로 띄워 본 검증 (웹뷰 렌더 · 호스트 · MCP · 파이썬)

검증 대상: 묶음 2 의 W1 · W2 · W3 변경(미커밋 작업 트리, 2026-11-22). 검증자는 변경을 만들지 않았다. 저장소 파일은 이 보고서와 `V4-shots/` 그림 12 장 말고는 고치지 않았다.

## 요약

> **재검증(수정 뒤, 같은 날) — 맨 끝 「재검증」 절.** 같은 하니스 · 같은 시나리오 12 개를 고친 작업 트리로 다시 돌렸다(+ 처음 사용자 경로, II-2A 를 매뉴얼 N = 5 in 로, 호스트 시간 초과). 페이지 예외 0 · 콘솔 오류 0. **V4-01(P0) 닫힘**, P1 10 건 중 9 건 닫힘(C-C 진동 46 s, 큰 요청은 확인, 시간 초과 뒤 엔진 재시작 확인) · V4-10 은 일부(입력 기록이 없는 파일을 열면 이전 프로젝트 입력이 그대로). 25 건 합계: 닫힘 21 · 일부 4(V4-10 · 16 · 18 · 24) · 그중 V4-24 의 「0.70 중복」 은 철회(서로 다른 행). **새 결함 10 건(P2 5 · P3 5)** — 가장 중요한 것: 결과를 보기만 하는 칸(모드 형상 길이 선택 등)을 바꿔도 설계 · Lap · 보고서 결과가 지워짐(V4-28), 하중 분석이 빈 칸 때문에 막히면 하중 탭에 아무 표시가 없음(V4-32), 엔진이 빈 t2 · n 을 알리지 않고 t1 · 1 로 채움(V4-29, 화면이 채우던 것을 엔진이 대신), R 경로 보고서의 「min(12.75, 12.75, 76.93) = 60.16」(V4-30). II-2A: GUI 와 MCP 가 웹 크리플링까지 같은 답(38 구간). 남은 매뉴얼 차이는 DSM 대 유효폭법과 단면 하나(끝 경간 0.070 을 못 넣음) — 정당. 다만 H2 로 안경간 랩 끝이 매뉴얼 OK(0.925) → 도구 NG(1.030)로 뒤집히는 것은 매뉴얼 자신의 DSM 값으로도 1.027 이라 방법 차이다.

웹뷰를 처음으로 진짜 브라우저(헤드리스 Edge)에 띄우고, 진짜 호스트(`StcfsdPanel`, src 에서 바로 변환)와 진짜 파이썬 서버로 구동했다. 사용자처럼 DOM 을 조작해 시나리오 10 개를 돌렸다(웹뷰 → 호스트 메시지 739 건, 호스트 → 웹뷰 약 400 건). **페이지 예외 0 건, 콘솔 오류 0 건**(favicon 404 만), 화면 문자열에 `undefined` / `NaN` / `null` / `[object Object]` 0 건. 10 개 템플릿, S-S 해석, 하중 분석(II-2A), 4 가지 직접 입력 설계, 접합 8 종, 보고서 · 검증 탭, `.csd` 왕복, 단위 전환은 모두 그려지고 동작한다. 세 상태 판정 표시(OK · NG · 「판정 없음」 · 「참고값 — 입력 필요」)는 화면에서 의도대로 보였다.

그러나 결함이 있다.

- **P0 1 건 (V4-01)** — 결과가 무효가 되어도 화면의 판정 카드가 지워지지 않는다. 다른 `.csd` 를 열거나 AI 가 MCP 로 단면을 바꾸면, **이전 단면의 「✓ OK」 카드가 새 단면 옆에 그대로 남는다**(그림 `V4-shots/08_stale_*.png`).
- **P1 10 건** — C-C 진동 해석이 끝나지 않고 엔진을 붙잡음(V4-02), 퍼린 경로가 §2.3.3.3 β 를 보내지 않음(V4-03), H2 가 Malo 대신 지배 강도를 씀(V4-04, 엔진), MCP `design_purlin` 이 웹 크리플링 인자를 받지 못함(V4-05, GUI ≠ MCP), 빈 칸을 화면 기본값으로 채워 엔진에 보냄(V4-06), `.csd` 저장이 빈 Fub · Fuf 를 827 MPa 로 바꿈(V4-07), Lap 의 Se 를 총단면 Sx 로 지어내 OK 판정(V4-08), 단위 전환 때 바뀌지 않는 입력 5 칸(V4-09), 파일 열기 때 이전 프로젝트 입력이 섞임(V4-10), 옛 엔진의 설계 결과를 지금 결과처럼 복원(V4-11).
- P2 9 건, P3 5 건.

**H2 (II-2A 안경간 랩 끝 1.16 대 매뉴얼 0.925)**: 호스트의 M · V 짝(3.892 kip-ft, 1.187 kip)과 전단강도(Va 2.43 kip)는 매뉴얼과 같다. 차이의 대부분은 **엔진 `aisi_s100.py:1926` 이 H2 의 분모로 `design_strength`(국부 · 뒤틀림 · 횡비틀림 중 최소, 여기서는 뒤틀림 Mnd/Ω = 45.29 kip-in)를 쓰기 때문**이다. 기준 H2 의 Malo 는 Fn = Fy 의 국부좌굴 강도(Mnℓ/Ω)다 — 엔진이 이미 갖고 있는 `Mnfo`(85.95 kip-in → 51.47 kip-in)로 바꾸면 1.14 → **1.03**. 남는 1.03 대 0.925 는 정당한 방법 차이다: 매뉴얼 II-2A 는 유효폭법 Mnℓ = 8.25 kip-ft(Malo 4.94), 같은 단면의 DSM 예제 II-2B 는 Mnℓ = 86.2 kip-in(Malo 4.30) — 매뉴얼 자신의 DSM 값으로 H2 를 풀면 √((3.89/4.30)² + (1.18/2.43)²) = **1.027** 이다.

**못 한 것**: VS Code 안의 실제 실행(`@vscode/test-electron`), 사이드바 트리 아이콘 렌더, PDF 저장, 좌굴 보고서 별도 패널, 파이썬 프로세스가 죽은 뒤의 재시작, 라이트 테마. 자세히는 맨 끝.

## 하니스 — 어떻게 띄웠나, 다시 돌리는 법

위치: `C:\Users\USER\AppData\Local\Temp\claude\3df7e1c8eb560f18\99d094e4-961f-4f09-9be9-02ec03b2e201\scratchpad\verify\V4\` (저장소 밖, npm 패키지 설치 없음 — Node 22 내장 `WebSocket` · `http`).

| 파일 | 역할 |
|---|---|
| `lib.js` | `start()` — W3 의 `test/webview/panel_harness.js` 에서 `loadTs` · `makeFakeVscode` 를 빌려 `PythonBridge` · `StcfsdPanel` 을 src 에서 변환해 불러오고 진짜 `.venv` 파이썬을 띄운다. 가짜 `vscode.window.createWebviewPanel` 을 감싸 첫 패널의 `webview.postMessage` 를 브라우저로 중계(`Runtime.evaluate("window.postMessage(...)")`), 저장 · 열기 대화상자를 `ctx.dialogs.nextSave/nextOpen` 으로 가로챈다. `__testGetHtml()` 의 HTML 에서 CSP 메타를 지우고, 자원 경로(`webview/css/theme.css`, `webview/js/*.js`, `webview/js/charts/modeShape3D.js`, `media/viewer3d.js`)를 읽기 전용 로컬 HTTP 서버(127.0.0.1:47811, `webview/` · `media/` 만 허용)로 바꾸고, `<head>` 맨 앞에 `acquireVsCodeApi()`(→ CDP `Runtime.addBinding('__hostRelay')`) 와 `--vscode-*` 변수 37 개(Dark+ 값)를 넣는다. Edge `--headless=new --remote-debugging-port=9333 --user-data-dir=<scratch>`, 1400×1000. `Runtime.consoleAPICalled` · `exceptionThrown` · `Log.entryAdded` 를 모으고, `shot()` 은 탭 높이만큼 뷰포트를 늘려 `Page.captureScreenshot`. |
| `mcp.js` | 진짜 `McpBridgeServer`(src/mcp/bridge.ts)를 같은 패널에 scratch 포트 52799 로 붙이고, 진짜 번들 `media/mcp-server.js` 를 `STCFSD_MCP_PORT=52799` 로 띄워 stdio JSON-RPC(`initialize`, `tools/call`)로 부른다. |
| `serve.js` + `q.sh` | 하니스를 한 번 띄워 두고 시나리오 파일을 POST 로 돌리는 대화형 구동기(이번 검증에 쓴 방식). |
| `s01.js` … `s12.js`, `stale2/3.js`, `snap.js`, `find.js` | 시나리오(아래 표의 번호). |
| `run_all.js` | 같은 시나리오를 한 번에(결과 JSON → `out/run_all/`, 그림 → `out/shots/`). C-C 진동은 뺐다(V4-02). |
| `head_save.js` | HEAD 코드로 v1.2 `.csd` 를 만드는 보조(아래 8). `git archive HEAD` 를 scratch `head\` 에 풀고 `.venv` · `node_modules` 를 junction 으로 이어 같은 하니스로 띄웠다(끝나고 junction 은 `rmdir` 로만 지웠다). |

다시 돌리기: `cd <위 폴더> && node run_all.js` (약 15–20 분). 대화형: `node serve.js` 를 띄운 뒤 `./q.sh s04.js '{"tag":"base","pattern":false}'`, 끝낼 때 `curl -X POST http://127.0.0.1:47900/quit`.

**MCP 등록을 막은 방법**: 하니스는 `extension.ts` · `src/mcp/registration.ts` 를 불러오지 않는다(`PythonBridge` · `StcfsdPanel` · `bridge.ts` 만). 검증 중 `.mcp.json`(8-28), `Example/.mcp.json` · `Example/.claude/mcp.json`(7-12), `.claude/mcp.json`(6-24) 의 수정 시각은 바뀌지 않았다. 브라우저 · 파이썬 · MCP 자식 프로세스는 모두 종료했다(남은 `node …/media/mcp-server.js` 는 12:58 에 시작한 사용자 Claude Code 의 것).

## 시나리오별 결과

| # | 한 일 | 본 것 | 그림 (scratch `out/shots/`, ★ = `V4-shots/`) |
|---|---|---|---|
| 1 | 시작 | 기본 립 C 미리보기 · 성질 표 정상, 메시지 `webviewReady → modelLoaded → getProperties → propertiesResult`. 절점 응력 244.97 MPa(호스트 35.53 ksi) 대 Fy 칸 245, 두께 2.30124 mm 대 칸 2.3 (P3) | ★`01_startup.png` |
| 2 | 템플릿 10 종(SI 치수) | 모두 생성 · 그림 · 성질 정상, 오류 0. hat 은 H = 상판 폭 · B = 깊이로 바르게(A 450 mm²), CHS 는 `OD` 로 전송(A 1048 ≈ π·111.3·3), 형식별 H/B/D 안내문 표시 | ★`02_tpl_hat.png`, `02_tpl_*.png` |
| 3a | S-S 해석(기본) | 1.8 s, 곡선 · 극소 표시 · 모드 2D/3D 정상. 둥근 모서리 → 분류 불가 경고가 해석 경고 상자에 뜸. DSM 표 · 준비 DSM 정상 | ★`03_analysis_S-S.png` |
| 3b | C-C 해석 | `m_all:'auto'` → m_recommend, 길이당 최대 21 항, 75 s 에 끝남, 곡선 그려짐. DSM 표는 「분리하지 못함(0 — 없음이 아님)」 · C-C 경고 표시. 다만 표 칸에는 0.00 이 그대로(P3) | ★`03_cc_dsm.png`, `03_cc_curve.png` |
| 3c | 분류(둥근 모서리) | 상태 문구 「unsupported (ROUNDED_CORNER) … 분류하지 못한 반파장은 그리지 않습니다(0 % 가 아님)」, 캔버스는 비어 있음 — 0 을 그리지 않음 ✓ | `03_cc_classify.png` |
| 3d | 소성 곡면 | 정상(정규화 축, Py 124.96 kN) | `03_cc_plastic.png` |
| 3e | 진동(밀도 칸) | **C-C: 두 번 모두 5 분 시간 초과**(V4-02). S-S: 30 s, 빈 칸 → 엔진 강재 + 경고, 7850 → 같은 값, 15700 → 진동수 1/√2 (36356.6 → 25708.0 Hz) ✓ | `03_vibration_SI.png` |
| 4 | 하중 분석, II-2A (8ZS2.25x059, 1+4×25+1 ft, 랩 2.5/3.5 · 1/1, D 3 · Lr 20 · Wu 34 psf, 간격 5 ft, 관통체결 kφ 0.3, ASD, 경간별 Ix) | 다이어그램 · 표 · 반력(1.20/3.37/2.57) · 조합 · 처짐 정상, 매뉴얼 값과 같음(F7 표). I6.2.1 확인 → R 0.70, 끄면 경고 + R 없음. 패턴 · Lr 감소 켜면 `patterned_loads:['Lr']` · 까닭 표시. 자동 채움: Mu(−) 4.647(랩 끝 23.5) + Lb/Cb 49.1/1.79(랩 끝 29.5 구간) — 다른 구간끼리 섞임(보수 측, P3) | ★`04_loads_base.png` |
| 5a | 자동 계산 모드 설계(퍼린) | 구간 38–40 개 표, 세 상태, 종합 NG(H2 지배). 랩 행 Mu 가 합계(V4-13), 게이지 120 % 잘림(V4-14), 호스트 가정 목록 미표시(V4-12), β 칸은 1.300 「적용」으로 보이나 쓰이지 않음(V4-03) | ★`05_purlin_default.png` |
| 5b | 직접 입력 휨 · 압축 · 조합 · 인장 | 판정 배너 · 지배 검토 · 한계상태 표 · 경고 · 가정 · 범위(접힘) 모두 표시, 예외 0. 휨은 하중 탭에서 남은 Mu(+) 85.92 · β Lm 270 이 섞여 「F positive region」 NG(V4-17) | ★`05_direct_flexure.png` |
| 6 | Lap + 단일 접합 7 종 × (입력 완비 / 누락) | 누락이면 「⚠ 판정 없음」 · 「참고값 — 입력 필요, 판정에 쓰지 않음」, OK 가 나온 누락 경우 없음(그루브는 엔진이 J6 를 해당 없음으로 봄). Lap: Se 없는데 ✓ OK(V4-08). 빈 t2 · n → 1.5 mm · 4 로 전송(V4-06). 결과 표 값 열이 잘림(P3) | ★`06_lap_complete.png`, ★`06_screw_missing.png` |
| 7 | 보고서 · 검증 탭 | 보고서: 퍼린 구간별 판정, 종합 NG. 「Mu(−) = 62.35」 는 이용률×강도 역산(V4-15). 검증: 44 통과 / 10 주의 / 8 실패, 「종합 판정(엔진) ✗ NG」, 「I6.2.1 R 미적용」 과 「R 0.7」 이 같이 나옴(P3) | `07_report.png`, `07_validation.png` |
| 8 | `.csd` 저장 → 웹뷰 새로 고침 → 열기, 옛 파일 | v1.3 저장(입력 123 개, 해석 · 하중 · 설계 · Lap 결과). 첫 왕복: 빈 `conn-Fub/Fuf/t2/n` 이 119.95 ksi · 0.059 · 4 로 채워져 돌아옴(V4-07). 두 번째 왕복은 입력 · 세 탭 화면 글자 전부 같음. HEAD 코드로 만든 v1.2 파일: 열림, 옛 설계 결과 「✓ OK」 복원(V4-11), 파일에 없는 칸은 이전 프로젝트 값 유지(V4-10). `Example/test.csd`(v1.0): 열림 · 해석 무효 경고 — **그런데 이전 단면의 ✓ OK 카드가 그대로**(V4-01) | ★`08_stale_design_card.png`, ★`08_stale_section.png` |
| 9 | SI ↔ US (결과 표시 중) | 입력 61 칸 정확히 변환(정의 계수), DSM 표 · 설계 카드 · 하중 표 변환 ✓(51.23 kN = 11.52 kips × 4.44822). 바뀌지 않는 입력 5 칸(V4-09), 왕복 상대 오차 ≤ 5e-6(P3), 단계 수식에 in/mm 혼재(P3) | `09_SI_*.png` |
| 10 | GUI 경로 대 진짜 MCP 경로(번들 → 브리지 → 같은 패널 → 파이썬) | 압축 · 휨 · Lap · 볼트 접합: 같은 인자면 **결과 비트 단위로 같음**. 퍼린: 끝 지점 웹 크리플링 2 건이 MCP 에서 빠짐(V4-05). MCP US 대 SI: 압축 Pn 비 4.4482216152605, 휨 Mn 비 0.11298482902761668, 퍼린 구간 판정 · 이용률 같음 — 단 퍼린 SI 응답의 수치 226 개가 US 로 남음(V4-16) | — |
| 11 | 브리지 보안(scratch 포트) | 아래 B-6 | — |
| — | AI 가 MCP 로 단면 변경 | 설계 카드 ✓ OK 가 그대로(V4-01) | ★`08_stale_after_mcp_template.png` |

저장소에 옮긴 그림(★): [시작](V4-shots/01_startup.png) · [hat 템플릿](V4-shots/02_tpl_hat.png) · [S-S 해석 탭 전체](V4-shots/03_analysis_S-S.png) · [C-C DSM 표](V4-shots/03_cc_dsm.png) · [II-2A 하중 분석](V4-shots/04_loads_base.png) · [퍼린 구간 설계](V4-shots/05_purlin_default.png) · [직접 입력 휨](V4-shots/05_direct_flexure.png) · [Lap — Se 대체인데 OK](V4-shots/06_lap_complete.png) · [나사 — 입력 누락](V4-shots/06_screw_missing.png) · [V4-01 카드](V4-shots/08_stale_design_card.png) · [V4-01 실제 단면](V4-shots/08_stale_section.png) · [V4-01 MCP 단면 변경 뒤](V4-shots/08_stale_after_mcp_template.png).

## 결함

| 번호 | 심각도 | 위치 | 무엇이 틀렸나 | 증거 | 고칠 것 |
|---|---|---|---|---|---|
| **V4-01** | **P0** | `webview/js/app.js:294-303` (`analysisInvalidated`), `StcfsdPanel.ts:4257-4320` (`_loadProjectFile`) | 해석이 무효가 되면 변수(`_lastDesignResult` 등)만 비우고 **설계 카드 · 단계 · DSM 표 · Lap 결과 · 하중 결과 DOM 은 그대로** 둔다. 화면 입력을 바꿀 때만(`app.js:7600-7609`) 「입력이 변경되었습니다」 로 바뀐다. 그래서 (a) 다른 `.csd` 열기, (b) MCP `set_section_template` 등 AI 의 모델 변경 뒤에는 **새 단면 옆에 이전 단면의 「종합 판정: ✓ OK」** 가 남는다. 트리 요약은 비워진다. | `Example/test.csd`(21 절점 Z) 열기 뒤 카드 「✓ OK … G5 web crippling 95 %」(37 절점 립 C 의 결과) — `08_stale_design_card.png` + `08_stale_section.png`. MCP `generate_template`(H4 t0.03) 뒤 `before == after == "종합 판정: ✓ OK"`(`stale3.js`) — `08_stale_after_mcp_template.png`. 열린 파일에 없는 결과(Lap · 하중)도 이전 프로젝트 것이 남음 | `analysisInvalidated` · 프로젝트 `modelLoaded` 에서 `#design-summary` · 단계 · DSM 표 · `#connection-result` · 하중 결과 · 보고서를 「결과 없음 — 다시 실행」 으로 바꾸고 `_lastLapResult` · `_lastLoadAnalysis` · `lastDsmResult` 도 비운다. 호스트는 파일에 결과가 없으면 「지움」 메시지를 보낸다. 시험: 결과 표시 → `analysisInvalidated` → DOM 에 OK 문자열 없음 |
| V4-02 | P1 | `StcfsdPanel.ts:2338-2351` (`vibration` 이 `_resolvedTerms()` 사용), R8-31 | 비 S-S 모델의 진동 해석이 해석과 같은 자동 항(C-C: 길이당 최대 21 항 × 60 길이)을 써서 끝나지 않는다. 호스트 5 분 시간 초과 뒤에도 파이썬은 계속 계산해 **그 뒤 모든 엔진 호출(성질 계산 포함)이 줄을 서 화면이 멈춘다.** 묶음 2 에서 생긴 회귀(전에는 m = 1). | GUI: `runVibration` 2 회 → `vibrationError: JSON-RPC request 58/59 timed out after 300000ms`, 직후 `get_properties` 15 s 응답 없음. 따로 잰 것(`vibtime.js`, 시간 제한 해제): 25 분 · CPU 1453 s 뒤에도 끝나지 않아 중단. S-S 는 30 s | 진동은 S-S 서명(m = 1) 또는 사용자 지정 항으로, 항 수 상한 · 예상 시간 경고. 시간 초과 시 파이썬 작업 취소(R8-31) |
| V4-03 | P1 | `StcfsdPanel.ts:1550-1554` (`PURLIN_MEMBER_OPTIONS`), `1834-1850` | 퍼린 구간 설계에 §2.3.3.3 β 입력(`dist_M1_M2`, `dist_Lm`)을 보내지 않아 부모멘트 구간 F4 가 언제나 β = 1. 엔진 구간에는 M1 · M2 · Ly 가 있다. 매뉴얼 II-2A 는 랩 끝 구간에 β 1.24 / 1.23 을 쓴다. 동시에 화면의 β 칸(직접 입력용)은 「β = 1.300 (capped)」 을 보여 적용된 것처럼 보이고, 그 미리보기는 Lcrd 를 못 찾아 L = Lm 으로 계산해 1.3(매뉴얼 1.23)이다. | II-2A 안경간 랩 끝(29.5–33.59 ft, Ly 49.1, Cb 1.79): 도구 Mnd/Ω 45.29 kip-in = 3.774 kip-ft (β 1) → **NG**, 매뉴얼 3.93 ≥ 3.89 → OK. `05_purlin_default.png` 왼쪽 아래 β 칸 | 구간마다 `dist_M1_M2 = −M1/M2`(변곡점 쪽 0), `dist_Lm = Ly` 를 보내고 결과에 β 를 보인다. 자동 모드에서 β 칸을 숨기거나 「직접 입력 전용」 표시 |
| V4-04 | P1 (엔진) | `python/design/aisi_s100.py:1926` (`combined_bending_shear(Mu, design_strength, Vu, Va)`) | H2 의 Malo 자리에 지배 휨강도(F2 · F3 · F4 · R 중 최소)를 넣는다. S100-16 H2(매뉴얼 II-2A 3c): Malo = Mnℓ/Ω(F3, **Fn = Fy**). 엔진은 같은 함수에서 `Mnfo_v`(Mne = My 의 국부 강도)를 이미 계산해 둔다(1909). | 안경간 랩 끝: 엔진 √((46.70/45.29)² + (1.187/2.43)²) = 1.141; Malo = 85.95/1.67 = 51.47 kip-in 이면 1.030; 매뉴얼 0.925(유효폭법 Mnℓ 99 kip-in). 위 「요약」의 H2 항목 | `Mao = Mnfo_v/Ω`(LRFD φ) 로. R 경로 · 랩(두 부재)에서도 같은 정의. 회귀: II-2B 의 Mnℓ 86.2 로 1.027 |
| V4-05 | P1 | `src/mcp/server.ts:1053-1061` (`design_purlin` 스키마) ↔ `StcfsdPanel.ts:1686-1692` | MCP `design_purlin` 스키마에 `wc_*` · `use_inelastic_reserve` · `use_cold_work` 가 없어 zod 가 지운다. 호스트는 그 키를 받는데(W3 표) MCP 경로로는 **웹 크리플링을 결코 평가할 수 없다**(늘 「wc_N 이 없음」). 같은 부재가 GUI 와 MCP 에서 다른 답(R8-08). W2 · W3 기록은 서로 「일치」 라고 적었다. `panel_host_contract.scenarioPurlinRegions` 는 `handleMcpAction` 을 직접 불러 스키마를 지나지 않으므로 못 잡았다. | GUI 의 `runPurlinDesign` 인자를 그대로 MCP 에 넣으면 38 구간 중 2 곳이 다름: GUI `negative-1` = [M_max 0.448 OK, **support 2 G5 1.2835 NG**], MCP `negative-1` = [M_max 0.448 OK] 만(`s10d.js`) | 스키마에 `PURLIN_MEMBER_OPTIONS` 13 키(+ SI 변환 `wc_N` · `wc_R` · `wc_overhang` · … mm) 추가, 설명에 「wc_N 이 없으면 웹 크리플링 미평가」. 시험은 MCP 서버 → 진짜 패널로 |
| V4-06 | P1 | `app.js:67-117`(`DEFAULTS`) + `3499-3510`(`getNum`), `4215`, `1013-1023`, `1042-1075`, `3943-3974`, `4199-4248` | 칸을 비워도 `getNum` 이 `DEFAULTS` 의 SI 값을 돌려줘 **지어낸 공학 입력이 엔진으로 간다**. 칸은 비어 보인다. | SI 화면에서 S · D · 간격 · Fy · wc_N · 데크 t 와 첫 경간을 비우고 하중 분석: 보낸 값 `S: 34.26 plf`(0.5 kPa 적설), `D: 20.56`, `spacing_ft 3.28`, 첫 경간 **82.02 ft**(`||25` 가 표시 단위 m 로), `section.Fy 35.53`, 설계 `wc_N 3.504 in` → 웹 크리플링 평가됨(`s12.js`). 단일 접합 빈 t2 · n → `t2 0.05906`, `n 4`(`s06` `screw_blank_t2_n`) | 필수 입력(Fy · t · 경간 · 하중 성분이 아닌 칸)은 비면 검증 오류, 선택 입력은 보내지 않음(`_optNum` 처럼). 하중 성분은 비면 0 이 맞다(그러나 0.5 kPa 는 아님) |
| V4-07 | P1 | `webview/js/designState.js:137-150` | `.csd` 수집이 `getNum` 을 써서 빈 `conn-Fub` · `conn-Fuf` 를 827 MPa(119.95 ksi), 빈 `conn-t2` 를 1.5 mm, `conn-n` 을 4 로 저장한다. 다시 열면 칸이 채워져 이후 접합 검토가 **사용자가 넣지 않은 Fub · Fuf(제조사 값이어야 할)** 로 판정한다 — W3 가 없앤 「Fub · Fuf 지어내기」 가 저장 경로로 되돌아옴. | 첫 왕복 입력 차이: `conn-Fub "" → 119.946`, `conn-Fuf "" → 119.946`, `conn-t2 "" → 0.0590`, `conn-n "" → 4`(`s08.json`) | 이 칸들도 v1.3 의 `optVal`(빈 칸 null)로 |
| V4-08 | P1 | `app.js:990-1005, 1027-1028` | Lap 의 유효단면계수가 없으면(설계 결과에 `Se` · `Mnl` 없음 — 예: 마지막 설계가 인장이거나 아직 없음) 총단면 `Sx` 를 `Se` 로 보낸다. 엔진은 Se 가 있으니 휨을 검토해 **✓ OK**. 화면에는 「비보수적일 수 있음」 주의 문구만. W2 · F6 계약은 「Se 없으면 NOT_CHECKED」. | `06_lap_complete.png`: 주의 문구 + 「종합 판정: ✅ ✓ OK (휨 DCR = 0.411, Mn/Ω = 127.72 = 2×Se×Fy)」, 보낸 `Se = Sf = 1.939` | Se 를 모르면 보내지 않아 엔진이 휨 판정 없음으로. 또는 같은 단면의 국부 강도로 `Se = Mnl/Fy` 를 호스트가 계산 |
| V4-09 | P1 | `app.js:154-186` (`refreshUnits` 의 `inputUnitMap`) | 단위 전환 때 값이 바뀌지 않는 입력: `design-dist-Lm`(길이), `design-May-strength`(모멘트), `design-wc-Lo` · `design-wc-edge-distance` · `design-wc-fastener-spacing`(길이). 라벨만 바뀌어 40 in 이 40 mm 가 된다 — β · 웹 크리플링(EOF/IOF 판단 포함) · 약축 강도가 조용히 틀림. | US→SI→US: 위 5 칸 비 = 1(기대 25.4 · 0.11298), 나머지 61 칸은 정확(`s09.json`) | 표에 추가. 표를 손으로 두지 말고 `data-unit` 라벨에서 만들 것 |
| V4-10 | P1 | `designState.restoreDesignInputs` / `StcfsdPanel.ts:4290-4306` | 열린 파일에 없는 칸은 이전 프로젝트 값이 남는다(옛 v1.0–1.2 파일은 v1.3 칸이 없고, v1.3 이라도 null 이 아닌 키만 덮음). 그 값이 새 프로젝트의 재검토에 들어간다. | HEAD 로 만든 v1.2 파일을 열고 「설계 검토 실행」: 이전 프로젝트의 `design-Mx-pos 84.92`, β `M1/M2 −0.012` · `Lm 49.1` 이 남아 「F positive region 1.328 ✗ NG」; Mu(+) 를 0 으로 지우면 「✓ OK 0.945」(`s08d/e`) | 복원 전에 모든 입력을 화면 기본 · 빈 칸으로 되돌린 뒤 파일 값을 얹는다. V4-01 과 함께 |
| V4-11 | P1 | `StcfsdPanel.ts:4278-4313` | 옛 버전(1.0–1.2) 파일의 `designResult` · `preparedDesignDsm` 을 서명만 맞으면 지금 결과로 복원 · 표시한다. 옛 엔진 결과는 세 상태 · `not_evaluated` · `limit_state_checks` 가 없고(묶음 1 이전의 조용한 합격 포함 가능) 화면에 「이전 버전 결과」 표시가 없다. | HEAD v1.2 파일: `designResult.pass true, util 0.9288` 이 「✓ OK」 로 복원, 경고 없음. 같은 입력의 현재 엔진은 0.945(이 예는 같은 판정) | `version < 1.3` 이면 설계 · 준비 DSM 결과를 버리고 「다시 실행」 안내 |
| V4-12 | P2 | `app.js:2114-2134` (`_pickGoverningPurlinDesign`), `5308` | 퍼린 결과의 호스트 `assumptions`(랩 = 두 부재 반씩, 랩 안 LTB · 뒤틀림 제외, Vu 선택, 하중 가정 6 건 — 8 건)과 `load_not_evaluated`(I6.4.1 정착, 처짐 한계)가 설계 화면에 나오지 않는다(WAVE2 규칙 2). | 설계 탭 글자에서 「겹친 두 부재의 강도 합」 · 「I6.4.1」 · 「Deflection limits」 0 건(`find.js`) | `purlin_assumptions` · `purlin_load_not_evaluated` 를 넘겨 가정 · 미평가 블록에 |
| V4-13 | P2 | `app.js:5138`, `StcfsdPanel.ts:1897` | 랩 행의 Mu 는 두 부재 합(105.01 kip-in), Mn/Ω 는 한 부재(51.47), 이용률 107 % — 표만 보면 204 % 여야 한다 | `05_purlin_default.png` 랩 행 | 행에 「부재당 Mu = 52.5」 또는 ΣMn/Ω 를 |
| V4-14 | P2 | `app.js:5228-5232`, `5268` | 이용률 게이지 라벨이 `Math.min(util·100, 120)` 이라 137.6 %, 189.6 %, 426.6 % 가 모두 「120 % ✗ NG」 로 보인다 | `05_purlin_default.png`, `05_direct_flexure.png` | 막대 폭만 자르고 글자는 실제 값 |
| V4-15 | P2 | `app.js:6196` | 보고서가 `Mu = utilization × design_strength` 로 소요 모멘트를 역산 — H2 · G5 가 지배하면 없는 값(「Mu(−) = 62.35」, 실제 55.76)을 「F flexure」 판정 옆에 쓴다 | `s07.json` `reportVerdicts[0]` | 결과의 `Mu`(또는 구간 `Mu_checked`)를 쓰고 비는 해당 검토의 `ratio` |
| V4-16 | P2 | `src/mcp/siUnits.ts` (`SI_OUT_PURLIN`) | MCP `design_purlin` 의 SI 응답에서 수치 226 개가 US 로 남는다(`regions[].start_ft` · `end_ft` · `Ly_in` · `result.Mu_checked` · `Vu_checked` · `checks[]` …) — 같은 구간 객체에 `Mu`(kN-m)와 `Ly_in`(in)이 섞임. `si_unconverted` 로 경로를 알리긴 한다(W2 가 「묶음 응답은 종단 시험 없음」 이라 적은 곳) | `s10e.js`: `unconvCount 226`, 구간 0: Mu 61.27 → 6.92(변환), Ly · start 그대로 | 구간 · 검토점 표를 추가하고 종단 시험에 `design_purlin` 포함 |
| V4-17 | P2 | `app.js:4855-4945` (하중 결과 자동 채움) ↔ 직접 입력 모드 | 자동 계산 모드의 하중 분석이 채운 `design-Mx-pos` · `design-Lb-pos` · β(M1/M2 · Lm) 가 직접 입력 모드로 바꿔도 남아 직접 입력 휨 · 조합에 들어간다(정모멘트 구간 검토 · β). 칸은 하중 탭 아래에 보이긴 한다 | 직접 휨(Mu 40, Lb 60): 「F positive region 1.896 NG」(Mu(+) 85.92 는 양력 지점 모멘트), `Mcrd … [β=1.072]`(Lm 270 은 패턴 하중 실행의 구간) | 모드 전환 때 자동 채움 칸을 비우거나 「하중 분석에서 채움」 표지 |
| V4-18 | P2 | `aisi_s100.py:2071-2072`(엔진) · `app.js:3962-3975` | 직접 입력 휨 · 조합은 언제나 G5 · H3 를 검토한다(채워진 N 89 mm). 반력 P 칸이 없어 엔진이 `wc_P → Vu → Pu` 순으로 대신 쓰는데 `assumptions` 에 없다. MCP(wc 안 줌)는 G5 를 안 한다 → 같은 부재의 지배 검토가 GUI 「G5 0.945」, MCP 「H2 0.570」 | `s10.json` flexure | 화면에 반력 칸 · 「웹 크리플링 검토」 선택, 엔진은 대체를 `assumptions` 로 |
| V4-19 | P2 | `src/extension.ts:59-60, 297-330` | 활성화 때 `setupMcpConfig` 가 워크스페이스 `.mcp.json` · 확장 폴더 · `~/.claude/mcp.json` 에 쓴다 — 시험 모드 가드가 없다. `test/vscode`(전자 시험, 아무도 돌리지 않음)를 돌리면 포트가 달라질 때 사용자 설정을 실제로 다시 쓴다(R8-22). 내용이 같으면 쓰지 않는 부분(W3)은 확인 | 코드 | `STCFSD_TEST_MODE` · `extensionMode === Test` 이면 건너뜀 |
| V4-20 | P2 | `StcfsdPanel.ts:1842, 1861` | 퍼린 구간 Ly 가 없으면 `Lb = 0`(완전 구속), 지점 M 을 모르면 `Mu = 0` — 비보수 채우기(이번 입력에서는 발생 안 함) | 코드 | 없으면 그 검토를 미평가로 |
| V4-21 | P3 | `app.js:202` | 단위 전환이 `toPrecision(6)` 로 칸 값을 다시 써 왕복 상대 오차 ≤ 5e-6(G 11346.15 → 11346.2, Lr 20.8855 → 20.8854 psf) | `s09.json` | 내부 US 값을 따로 들고 표시만 바꿈 |
| V4-22 | P3 | `StcfsdPanel.ts:1730-1732` 외 | 구간 라벨은 엔진의 0 기반 지점 번호(「지점 2 left」 = 26 ft), 같은 결과의 미평가 문장은 「지점 3 (1st interior)」, 화면 경간 표 · 검증 탭은 1 기반 | `s05a` 출력 | 한 번호 체계로 |
| V4-23 | P3 | `app.js` 검증 탭(§I6.2.1 항목) | 자동 모드에서 엔진이 R 0.70 을 적용했는데 같은 탭에 「§I6.2.1 R-factor 미적용 — 양력 하중이 없거나…」(직접 입력 체크박스 기준) | `s07.json` `valEngine` | 퍼린 결과의 `uplift_R` 로 |
| V4-24 | P3 | 여러 곳 | `select-r-value` 에 0.70 두 개; C-C 곡선 축 「Half-wavelength」 · 범례 「Mode 1 (설계값)」; DSM 표의 미분리 값을 0.00 으로 칸에; 단계 수식 SI 에 「(48.0 in/14.3 mm)²」 혼재; 접합 결과 표 값 열 잘림; 퍼린 결과가 있는데 상단 「FSM 좌굴값 없음」; 소성 곡면 · 성질 표 소수점이 로캘(헤드리스 Edge 는 쉼표) | 그림들 | — |
| V4-25 | P3 | `app.js:7383-7396` | 검증 탭의 랩 길이 1.5d 검사를 엔진(`check_lap_length`) 대신 자체 계산: 한쪽 0 이면 `|| 999` 로 다른 쪽만 보고 통과, d 는 템플릿 칸(`tpl-H`, 비면 100 mm) | 코드 | 엔진 결과의 세 상태(`ok` null)로 |

## 변경 검토 (B 1–6)

### B-1 판정 표시

W3 표의 곳들(Lap · 단일 접합 · 도면 색 · 트리 · 퍼린 지배 선택 · 설계 카드 · 보고서 · 검증)은 화면에서 세 상태로 보였다: `null` 은 「⚠ 판정 없음 (미검토)」 주황, 가정값 지배는 「참고값 — 입력 필요, 판정에 쓰지 않음」, 트리 아이콘은 OK 외에는 warning(코드). `utils.verdictOf` 는 `error` 를 판정 없음으로, `verification_complete:false` 를 OK 가 아니게 다룬다. 남은 곳:

- **화면에 남는 옛 판정** — V4-01(P0). 판정 함수는 맞지만 무효가 된 결과를 지우지 않는다. 트리(`passOrFail`)는 비워지는데 카드는 남아 둘이 어긋난다.
- **옛 파일의 결과** — V4-11. `.csd` 의 `designResult` 는 옛 엔진의 두 상태 결과일 수 있다.
- **Lap 의 지어낸 Se 로 낸 OK** — V4-08.
- **검증 탭의 자체 판정**: 랩 길이(V4-25, `lapOK ? 'pass' : 'fail'`), 정모멘트 Fcre 휴리스틱(`app.js` 약 7286 `_posR.Lb === 0 ? 'pass' : (Fcre ≥ 2.78Fy ? 'pass' : 'warn')`), 「반파장 최댓값」 등은 엔진 결과가 아니라 화면 규칙이다. 판정 없음이 pass 로 가는 경로는 없었다(`_statusFromVerdict`).
- `_checkVerdict(res, name, ratio)`(`app.js:1253-1258`)는 이름이 없으면 비(ratio) 와 전체 `pass === true` 로 — 전체가 OK 일 때만 OK 이므로 안전.
- MCP 응답 · `.csd` 는 엔진 `pass` 를 그대로 싣는다(바꾸지 않음) — 확인.

### B-2 지어낸 값

- 화면: V4-06(`getNum` + `DEFAULTS`, 경간 `|| 25`, 접합 t2 · n · d · 용접 치수 · Fy · Fu), V4-07(저장), V4-08(Se), V4-17(자동 채움 잔류), V4-18(반력 = Vu, 엔진). 템플릿 버튼도 빈 칸이면 `DEFAULTS`(100 · 50 · 20 · 2.3 · 4 mm)를 보낸다. `_autoPrepareDesignDsm` · 플라스틱 버튼의 Fy 도 같은 규칙.
- 호스트: `StcfsdPanel.ts:671`(템플릿 기준응력 35.53 — 경고로 밝힘, 수용), `1842` · `1861`(V4-20), `1843` `Cb || 1.0`(보수 측), `2032`·`2995-2997`(길이 · GBTcon 기본 — `assumptions` 로 밝힘), `506`(재료 없으면 29500/0.3 — 상태 조회용).
- MCP(W2 가 지운 것): 스키마에서 `|| 35.53` · `D || 1` · `Fuf || 120` 등은 없어졌다(`server.ts` 확인, 진짜 MCP 호출에서 생략 인자가 전송되지 않음). 엔진 `lap_connection` 의 기본값 5 개(W2 후속)는 남아 있으나 MCP · 화면은 늘 보낸다.

### B-3 단위

- 진짜 핸들러로: 압축(Pn 비 4.4482216152605), 휨(Mn 비 0.11298482902761668), 퍼린(구간 판정 · 이용률 38 개 같음), 볼트 접합 · Lap(같은 인자 → 비트 같음). 퍼린 SI 응답의 미변환 226 개(V4-16).
- 화면 `UNIT` 대 `siUnits.US_TO_SI`: length 25.4, area 645.16, inertia 25.4⁴, modulus 25.4³, stress 6.894757293168361, force 4.4482216152605, moment 0.1129848290276167, moment_ft K·0.3048, pressure K/1000/0.3048², linload K/1000/0.3048, rotStiff K, latStiff K/0.0254², density K·1000/0.0254⁴ — **같은 정의**. 화면 쪽 문제는 변환 누락 칸(V4-09)과 왕복 반올림(V4-21).

### B-4 퍼린 흐름 대 매뉴얼 II-2A/B

같은 단면 하나(8ZS2.25x059)로 모형화하므로 끝 경간(매뉴얼 0.070)의 판정은 원래 비교 대상이 아니다(W3 기록대로).

| 구간 | 도구 (M · V · Ly · Cb · R · 단면 · 한계상태) | 매뉴얼 | 판단 |
|---|---|---|---|
| 정모멘트 안경간 33.6–46.1 ft | 2.233 kip-ft, Ly 0(관통체결), DSM+ (kφ 0.3 스프링), F3 · F4, Ma 4.30 | 2.23, Ma 4.35(F4, kφ 반영) | 맞음 |
| 랩 끝 부모멘트 29.5–33.6 | M 3.892 · V 1.187(같은 위치), Ly 49.1, Cb 1.79, DSM−, F2 · F3 · F4 · H2, 한 부재 | M 3.89 · V 1.18, Ly 49.1, Cb 1.67(보수), **β 1.23**, F4 Ma 3.93 | β 누락(V4-03), H2 분모(V4-04) |
| 랩 안 23.5–29.5 | 두 부재 M · V 반씩, Lb 0, F4 제외, H2 · F3 | 두 부재 강도 합 9.88 kip-ft, H2 0.834(다른 두께 섞임) | 가정 일치(II-2A (a)–(c)); 결과는 DSM 대 EWM 차이 |
| 지점 웹 크리플링 | 반력 1.205 / 3.375 / 2.571, EOF/IOF, 랩 안 지점은 미평가, 끝 지점은 화면 N(기본 3.5 in) | 같은 반력 · 형식, 랩 안은 두 부재로 검토 | 랩 안 미평가는 밝힘. MCP 경로는 전부 미평가(V4-05) |
| 양력 하부압축 1.05–19.9 / 33.6–46.1 | Ly 226.1 / 149.6, R 0.70(적격 구간만), Mn = R·Mnlo, Ma 3.00 | R 0.70(§4a), 끝 경간은 0.070 | 맞음(V3-21 3.01) |
| 양력 지점부 상부압축 | 양력 포락 M, 랩 경계에서 자름, Ly 0 | 매뉴얼 별도 검토 없음 | 보수 측 추가 검토 |

**H2 원인(W3 의 1.16)**: (1) 쓰는 휨강도 — 엔진이 지배 강도 Mnd/Ω(뒤틀림, β 없음) 45.29 kip-in 을 씀, 기준 · 매뉴얼은 Mnℓ(Fn = Fy)/Ω. **엔진(`aisi_s100.py:1926`) 결함**. (2) M · V 짝 — 호스트가 구간 최대 M 과 그 위치 V 를 짝지음(3.892 · 1.187) = 매뉴얼. 맞음. (3) 전단강도 — Vn 3.90, Va 2.43 = 매뉴얼. 맞음. (4) 남는 1.03 대 0.925 — 유효폭법(II-2A) 대 DSM(II-2B) 의 Mnℓ 차이(99 대 86.2 kip-in), 정당한 차이. W3 의 1.16 은 경간별 Ix 를 주지 않아 M 3.97 이던 때 값.

### B-5 시험

- `verdict_display_contract.js`: 순수 함수(`verdictOf` · `combineVerdicts` · 목록)는 동작 시험, 나머지는 `app.js` 문자열 tripwire(패턴 금지 · 함수 존재). 렌더 결과는 보지 않는다.
- `panel_host_contract.js`: **정직하다** — 진짜 호스트 + 진짜 파이썬, 기대값을 엔진 직접 호출 · 닫힌 식에서. 다만 MCP 스키마를 지나지 않아(`handleMcpAction` 직접) V4-05 를 못 잡고, 웹뷰가 없다.
- `design_state_v13_contract.js`: 가짜 document 로 수집 · 복원을 실제로 돌림(동작). 빈 `conn-Fub` 경우가 없어 V4-07 을 못 잡음.
- `mcp_si_chain.js`(W2): 진짜 MCP · 브리지 · 파이썬, 패널은 대역. `design_purlin` 의 SI 묶음 응답은 시험하지 않음(V4-16).
- **시험이 없는 묶음 2 동작**: 무효화 때 화면 결과 지우기(V4-01), 파일 열기 전 입력 초기화(V4-10), 단위 전환의 새 칸(V4-09), 빈 칸 처리(V4-06), MCP 도구 스키마 → 패널 인자 일치(V4-05), 비 S-S 진동 실행 시간(V4-02), Lap Se 출처(V4-08), 보고서 수치(V4-15), 퍼린 β(V4-03). 이 하니스(`lib.js` + 시나리오)를 저장소 시험으로 올리면 V4-01 · 05 · 06 · 07 · 09 · 10 을 바로 고정할 수 있다.

### B-6 브리지 보안 · 등록

진짜 `McpBridgeServer` 를 scratch 포트 52799 에 붙여 시험(`s11.js`):

| 요청 | 응답 |
|---|---|
| POST `application/json` | 200(패널 도달) |
| `Origin: http://evil.example` / `Origin: null` | 403 |
| `text/plain` · `x-www-form-urlencoded` · Content-Type 없음 | 415 |
| `Host: evil.example:52799` · `attacker.localhost:52799` | 403 |
| 깨진 JSON | 400 |
| `OPTIONS`(Origin 포함) | 403, `Access-Control-Allow-Origin` 머리 없음 |
| `text/plain` 으로 `set_bc C-C`(CSRF 꼴) | 415, 모델 BC 그대로 |
| GET `/status`(Origin 없음) | 200 — 읽기 전용, 브라우저는 응답을 읽을 수 없음(CORS 머리 없음) |

진짜 번들 `media/mcp-server.js`(`STCFSD_MCP_PORT=52799`)의 `get_status` · 설계 도구는 정상 통과. 등록: 하니스는 `extension.ts` 를 불러오지 않으므로 설정 파일을 쓰지 않았다(수정 시각 확인). 시험 코드 중 실제 경로에 쓰는 것은 없다(`mcp_registration_contract.js` 는 가상 경로) — 단 `test/vscode` 를 돌리면 활성화가 실제로 쓴다(V4-19).

## 확인하지 못한 것

- VS Code 안의 실제 웹뷰(`vscode-webview://` CSP, `retainContextWhenHidden`, 테마 변수의 실제 값, 라이트 테마) — 하니스는 CSP 를 지웠다. CSP 위반은 이 방법으로 볼 수 없다(`script-src 'nonce-…' 'unsafe-eval'` · `img-src data: blob:` 은 코드로 보아 문제없어 보임).
- 사이드바 트리(`ProjectExplorerProvider`) 렌더 · 아이콘, 좌굴 보고서 패널, PDF 저장, `capture_section_preview` 의 실제 PNG 왕복(호스트 경로만 W3 시험).
- 파이썬이 죽은 뒤 재시작(R8-17), 6 분 MCP 시간 초과 문구.
- C-C 진동의 실제 소요 시간(25 분에서 중단).
- `.csd` 의 v1.1 파일(HEAD 의 v1.2 · `Example/test.csd` v1.0 만), 매우 큰 단면 · 사용자 단면(custom) 경로의 GUI.
- 퍼린의 II-2A 전체 판정(두께가 다른 끝 경간 — 도구가 단면 하나만 다룸).
- `run_all.js` 는 대화형으로 돌린 시나리오를 한데 묶은 것이고, 묶은 뒤 전체를 한 번에 다시 돌려 보지는 않았다(각 시나리오는 대화형 구동기로 실행 · 확인).

## 재검증 (수정 뒤)

대상: 「V4 검증 뒤 고친 것」(W3 · W2 · F4 · F3 · F6 · F7) 이 반영된 작업 트리. 방법은 처음과 같다 — 같은 하니스(scratch `verify\V4\lib.js`, 저장소 파일은 읽기만), 진짜 호스트 · 파이썬 · 헤드리스 Edge · 진짜 MCP 번들 + 브리지(scratch 포트 52799). 결과 JSON 은 scratch 의 `r2_*.json` · `r3_*.json`, 그림은 `out2\shots\` · `out3\shots\`(새 그림 8 장을 `V4-shots/r_*.png` 로 옮김). 처음 시나리오 파일(`s01`–`s12`)을 그대로 썼고, 새로 `s03d`(큰 진동 확인), `s13`(처음 사용자 경로), `s14`(II-2A, N = 5 in), `s15`(호스트 시간 초과), `s10f`(GUI 본문 → MCP), `regr1`(보기 칸 회귀), `v410`(입력 없는 파일)을 더했다. 전 과정 **페이지 예외 0, 콘솔 오류 0**(favicon 404 만), 화면 문자열의 `undefined`/`NaN`/`null`/`[object Object]` 0.

### 결함별 상태

| 번호 | 상태 | 증거 (내 시나리오 · 숫자 · 그림) |
|---|---|---|
| V4-01 | **닫힘** | MCP `generate_template` 뒤 · HEAD 판 v1.2 파일 · `Example/test.csd`(v1.0) 열기 뒤 설계 카드 · Lap · DSM 표 모두 「결과 없음 — … 다시 실행하세요」, 메시지 `resultsCleared` 가 먼저. 단, 같은 지우기가 너무 넓게 걸린다 — V4-28 |
| V4-02 | 닫힘 (작은 새 문제 V4-35) | C-C 60 길이 · 21 항: **46 s** 에 끝남(전 5 분 × 2 시간 초과), 결과에 「크기: 길이 60개 · 최대 21항 · 최대 DOF 3108 (예상 약 35 s)」(`r_vibration_cc.png`). 150 길이: 실행 전 「진동 해석이 큽니다 … 예상 약 87 s」 + 「그래도 실행」 단추(`r_vibration_confirm.png`), 눌러서 116 s 에 150 길이 결과. 기본 밀도는 이제 가정(경고 상자에 안 뜸). **시간 초과 뒤 재시작**(`s15.js`, C-C 900 길이, 예상 433 s, 「그래도 실행」): 300 s 에 `vibrationError` 「… timed out after 300000ms — the Python engine was restarted to cancel it」, 바로 다음 엔진 호출 1.5 s 에 응답(전: 15 s 넘게 응답 없음). 확장 창 알림(`onStatus`)은 `extension.ts` 를 불러오지 않는 하니스라 못 봄 |
| V4-03 | 닫힘 | II-2A 안경간 랩 끝(29.5–33.59 ft): β 1.238, Mnd/Ω 49.06 kip-in = 4.088 kip-ft(β 1 일 때 3.774; 매뉴얼 3.93 — FSM Mcrd 대 부록 2 식, +4 %). 구간 표에 β 열. 자동 모드의 β 칸은 「이 칸은 설계에 쓰지 않습니다」, Lcrd 를 모르면 미리보기를 계산하지 않음(`r_first_user_design.png`) |
| V4-04 | 닫힘 | 같은 구간 H2: Malo 51.47 kip-in(= Mnℓo 85.95/1.67), 1.141 → **1.030**. 매뉴얼 II-2B(DSM) 값으로 손계산 1.027 |
| V4-05 | 닫힘 (작은 새 문제 V4-31) | GUI 가 보낸 `runPurlinDesign` 본문 그대로 MCP `design_purlin` → **MCP 스키마 오류**(`wc_support_fastener_spacing: 0`, >0 이어야 함). 0 인 wc 칸 3 개를 빼면 38 구간 모두 같음(이용률 · 판정 · 검토점 · β), 끝 지점 G5 가 MCP 에도 있음(`s10f`) |
| V4-06 | 닫힘 (새 문제 V4-29 · V4-32) | SI 화면에서 S · D · 간격 · Fy · wc_N · 데크 t · 첫 경간을 비움: 하중 분석은 보내지 않고 「하중 분석: 입력이 비어 있습니다 — 부재 간격, 설계 Fy, 경간 1 길이」, 설계는 「설계 Fy」 로 막힘. 채운 뒤 빈 S → 0, 빈 wc_N → 보내지 않음 → 「§G5 · §H3 (지압 길이 wc_N 이 없음)」 미평가. 단일 접합 빈 t2 · n 은 보내지 않음 — 그러나 엔진이 조용히 채움(V4-29). 막힘 문구가 하중 탭에 보이지 않음(V4-32) |
| V4-07 | 닫힘 | `.csd` 저장 → 새로 고침 → 열기: 입력 124 개 · 세 탭 글자 모두 같음(바뀐 것은 모드 형상 길이 선택 하나). 빈 `conn-Fub` 등 빈 칸 그대로 |
| V4-08 | 닫힘 | 설계 결과에 Se 가 없을 때 Lap 본문에 Se · Sf 없음, 「유효단면계수 Se 가 없어 Lap 휨 … 판정 없음」(`r_lap_without_Se.png`). 휨 설계 뒤에는 Se = Mnl/Fy 로 PASS, GUI = MCP |
| V4-09 | 닫힘 | US→SI→US 로 숫자 칸 68 개 전부 정의 계수로 변환, 왕복 차 0. 처음 빠졌던 5 칸 포함 |
| V4-10 | **일부** | 입력 기록이 있는 파일(HEAD v1.2): 이전 Mu(+) 84.92 · β Lm 270 이 처음 값으로 돌아감 ✓. **입력 기록이 없는 파일**(`Example/test.csd` v1.0, MCP 원시 모델 `.stcfsd`/`.json`)은 `restoreDesignInputs` 를 보내지 않아 초기화도 일어나지 않는다 — 열기 뒤 `design-Mx-pos=84.92`, `conn-Fub=120`, `design-dist-Lm=270`, 템플릿 칸 `lippedc H 8`(모델은 21 절점 Z) 그대로(`v410.js`). W3 시나리오는 합성한 1.2 파일(입력 있음)만 써서 이 길을 보지 않았다. 고칠 것: `resultsCleared`(all) 에서 `_initialInputs` 로 되돌림 |
| V4-11 | 닫힘 | HEAD 로 만든 진짜 v1.2 파일 · v1.0 파일: 「Results stored in this file were computed by an older engine/file version (1.2) and were not restored」, 해석 · 설계 · 준비 DSM 없음(`r_open_v12.png`) |
| V4-12 | 닫힘 | 설계 카드 「가정」 에 랩 두 부재 분담 · Vu 짝짓기 · 하중 가정, 「평가하지 못한 항목」 에 [하중 분석] I6.4.1 · 처짐 |
| V4-13 | 닫힘 | 랩 행 「52.50 /부재 · 합 105.01」, 강도 열 「(부재당)」 |
| V4-14 | 닫힘 | 「138 % ✗ NG」(이용률 1.3754) |
| V4-15 | 닫힘 (새 문제 V4-30) | 보고서 「Mu(−) / Mn(−)/Ω = 49.55 / 36.03 = 137.5 %」 — 실제 구간 Mu |
| V4-16 | 일부 | 퍼린 SI 응답 미변환 226 → **6**: `load_analysis.{governing,gravity,uplift}.locations[].overhang_ft` (내민 경간이 있을 때). `si_unconverted` 로 알림 |
| V4-17 | 닫힘 | 자동 → 직접 입력 전환 뒤 직접 휨 본문 `Mu_pos 0`, β 없음; 결과에 「F positive region」 없음 |
| V4-18 | 일부 | 화면에 반력 칸 `design-wc-P` 가 생겼고, N 이 비면 G5/H3 은 `not_checked`. 그러나 반력 칸을 비우면 엔진이 여전히 Vu 를 반력으로 쓴다(`aisi_s100.py` `wc_P → Vu → Pu`) — 직접 휨(Vu 1 kip): 「G5 1.065 NG, H3 1.303 NG」, 가정 목록에는 wc_M 대체 한 줄뿐 |
| V4-19 | 닫힘(코드) | `extension.ts:33, 60-61` — 시험 모드 · `ExtensionMode.Test` 에서 설정 파일을 쓰지 않음. 실행은 못 봄 |
| V4-20 | 닫힘(코드) | `StcfsdPanel.ts:1854-1858, 1884-1887` |
| V4-21 | 닫힘 | 왕복 차 0 (V4-09 시험) |
| V4-22 | 닫힘 | 구간 라벨 「부모멘트 19.90–23.50 ft (지점 3 왼쪽)」 = 미평가 문장의 「지점 3 (1st interior)」 |
| V4-23 | 닫힘 | 검증 탭 「§I6.2.1 R-factor R = 0.7 — R 감소계수 적용됨」, 「양력 R 0.7」 과 일치 |
| V4-24 | 일부 · 철회 1 | 「0.70 두 개」 는 내 잘못 — 단순(≤6.5 in)과 연속 Z 의 서로 다른 행이다(`data-span`). DSM 미분리 「— (분리 안 됨)」 은 코드로 확인. 단계 수식 SI 의 「(48.0 in/22.2 mm)²」 혼재는 그대로 |
| V4-25 | 닫힘 | 검증 탭 「양쪽 Lap ≥ 1.5d … 부족하면 R 계수법 · J3 슬롯 예외를 쓸 수 없음」 |

**W3 시나리오(`test/rendered/run.js`)가 내 것보다 약한 곳**: V4-01/10/11 은 현재 파일을 고쳐 만든 합성 1.2 파일(입력 기록 있음)만 연다 — 진짜 옛 코드가 만든 파일과 입력 기록 없는 파일을 열지 않아 V4-10 의 남은 길을 못 본다. V4-05 는 렌더 시험에 없고 `mcp_si_chain` 은 MCP 결과를 패널 직접 호출과 비교할 뿐 **GUI 가 실제로 보내는 본문**을 MCP 에 넣어 보지 않아 V4-31 을 못 본다. V4-06 은 S · Fy · 경간만 — 접합 t2 · n 을 보지 않는다. V4-02 는 BC 를 MCP 로만 C-C 로 바꾸는데, 화면의 「해석 실행」 은 드롭다운의 BC 를 다시 보내 S-S 로 돌아간다(내 첫 재시험이 이 함정에 걸렸다) — 시나리오는 해석을 다시 돌리지 않아 통과하지만 사용자 흐름과 다르다. V4-12–V4-25 대부분은 「코드」 확인뿐이다.

### 새 결함

| 번호 | 심각도 | 위치 | 무엇이 틀렸나 | 증거 | 고칠 것 |
|---|---|---|---|---|---|
| V4-26 | P3 | `StcfsdPanel.ts` `addRegions`(양력 지점부 조각 두 번 부름) | 구간 id 가 겹친다: `uplift_support-1` … `-6` 이 랩 밖 조각과 랩 안 조각에 두 번씩. 지배 구간 굵은 행 · MCP 사용자의 id 참조가 모호(처음부터 있던 것) | `r2_s05a.json` 구간 목록 | 종류별 이름(`uplift_support_lap-…`) |
| V4-27 | P2 | `app.js` 설계 카드(강도 카드 3 개) | R 경로(§I6.2.1) 구간이 지배일 때 카드가 쓰이지 않은 F2 · F3 값을 그대로 보인다: 「Global 12.75 · Local 12.75 · Distort. 76.93 kip-in」 바로 아래 「Mn/Ω = 36.03 (R = 0.7)」 — Mn = 60.2 가 카드의 Mne · Mnl(12.75)보다 크다. 단계 카드는 「[참고 — §I6.2.1 이 대신함]」 으로 표시하는데 강도 카드는 표시 없음 | `cards.js` 출력, `r_purlin_regions.png` 아래쪽 | R 경로면 카드를 「Mnℓo 85.95 · R 0.70 · Mn 60.16」 으로, 또는 「참고」 표시 |
| V4-28 | P2 | `app.js:7735-7744` + `clearStaleResults` | `tab-design` · `tab-preprocessor` 의 **모든** change 가 설계 입력 변경으로 처리된다. 보기만 하는 칸 — 모드 형상의 길이 · 모드 선택, 진동 밀도 · 진동 길이, 소성 fy, cFSM 체크 — 을 바꿔도 설계 카드 · 단계 · **Lap 결과** · 보고서 · 검증이 지워지고 호스트 `_lastDesignResult` 도 버려진다(저장에서도 빠짐). 지우기 범위가 V4-01 수정으로 넓어졌다 | 직접 인장 결과 「✓ OK」 → 모드 형상 길이 드롭다운 한 칸 바꿈 → 「결과 없음 — 입력이 변경되었습니다」, 메시지 `invalidateDerivedResults`(`regr1.js`) | 설계 결과에 쓰이는 입력에만(`data-design-input` 표시나 designState 의 FIELDS 표로) 묶음 |
| V4-29 | P2 (t2 쪽은 비보수 가능) | `python/design/connections.py:2435-2436, 2456` | 화면이 이제 빈 t2 · n 을 보내지 않는데, 엔진이 `t2 = t1`, `n = 1` 로 조용히 채운다 — `assumptions` · `warnings` 에 없다. 나사(t1 0.059, 빈 t2 · n, Pu 2): 「✗ NG, 이용률 326.8 %, Rn/Ω 0.31 kips」(n = 1 의 값). t2 = t1 은 실제 t2 가 더 얇으면 비보수 | `r2_s06.json` `screw_blank_t2_n`, 결과 `assumptions` 4 줄에 t2 · n 없음 | n 이 없으면 오류(또는 패스너 1 개당 강도만 보이고 판정 없음), t2 없으면 오류 또는 `assumptions` |
| V4-30 | P2 | `app.js` 보고서 단계 5(약 6186 행, `_rptFlexure`) | R 경로 지배일 때 보고서가 「Mn(−) = min(Mne, Mnl, Mnd) = min(12.75, 12.75, 76.93) = 60.16 kip-in」 — 식과 값이 맞지 않는다(앱의 단계 카드에는 5a · 5b 가 바르게 있음). 보고서 머리의 「지배 하중조합은 3: D+Lr」 도 지배 구간(양력 7: 0.6D+0.6W)과 다름 | `r2_s07.json` 보고서 글 | R 경로면 「Mn = R·Mnℓo = 0.7 × 85.95」, 지배 조합은 지배 구간의 조합 |
| V4-31 | P3 | `src/mcp/server.ts` `PURLIN_WC` 스키마 | MCP 는 `wc_support_fastener_spacing`(등)을 `> 0` 으로 받는데 화면은 같은 칸의 0 을 보낸다(엔진은 0 을 받음). GUI 에서 가져온 입력을 AI 가 그대로 넘기면 스키마 오류 | `s10b` 의 `mcpErr` | 스키마를 `>= 0`(0 = 없음) 또는 화면이 0 을 보내지 않게 |
| V4-32 | P2 (사용성) | `app.js` `_blockIfMissing` · 하중 분석 버튼 | 하중 분석이 빈 필수 칸으로 막히면 문구가 `#analysis-status`(설계 탭) · `#design-validation`(설계 탭)에만 간다. **하중 탭에서는 아무 일도 일어나지 않고**, 결과 칸에는 「결과 없음 — 입력이 변경되었습니다. 하중 분석을 다시 실행하세요.」 만 남아 다시 눌러도 같다. 필요한 칸에 「설계 Fy」(①탭에서 정하는 읽기 전용 칸)도 있어 하중 탭에서는 찾을 수 없다 | `r_loads_blocked.png`, 하중 탭 글자에 「입력이 비어」 없음 | 하중 탭 결과 칸(또는 버튼 옆)에 같은 문구, 빈 칸 강조, 「설계 Fy」 는 「①탭의 Fy」 로 |
| V4-33 | P3 | 여러 곳 | 사용자 글에 영어 · 엔진 인자 이름이 섞임: 「결과 없음 — Section template changed / project opened」, 진동 「종방향 항: current buckling analysis」, 진동 확인 문구 「그대로 실행하려면 confirm_large 로 다시 요청하세요」(GUI 사용자에게 MCP 인자), 가정 · 경고의 `I_span_in4` · `i621_conditions_confirmed` · `pattern_loading=False`(화면 칸 이름은 「경간별 Ix」 · 「§I6.2.1 조건 확인」 · 「활하중 부분재하」). 처음 시작 화면의 진동 칸이 한 번도 돌리지 않았는데 「Section template changed」. SI 화면의 퍼린 구간 라벨이 ft. 분류 상태 문구는 「DSM 극소는 곡선 모양으로 정했습니다」, 경고 상자는 「반파장 순서로 정함」 | 그림 `r_first_user_design.png`, `r_vibration_confirm.png` | 사용자 문구 표 |
| V4-34 | P3 | `app.js` 하중 결과 「Auto Parameters」 · 해석 경고 상자 | F7 이 `scope_notes` 로 옮긴 「Deck restraint estimates are preliminary…」 가 「Auto Parameters」 상자에서 여전히 경고 색(옛 키 `auto_params.deck.warning`). 해석 경고 상자는 경고가 0 이어도 정보 줄(종방향 항 · 분류 가정)만으로 빨간 오류 상자 모양 | `04_loads_base.png`(out2), `r_first_user_design.png` | `deck.warnings` 를 쓰고 범위 안내는 접힌 글로, 정보만 있으면 중립 색 |

| V4-35 | P3 | `app.js` 진동 결과 칸 · `StcfsdPanel.ts:2409` | 예상 시간이 호스트 제한(300 s)을 이미 넘는데(433 s) 「그래도 실행 (예상 433 s)」 을 내놓는다 — 누르면 반드시 취소된다. 시간 초과 뒤에도 진동 칸은 「진동 해석 실행 중 — 예상 433 s」 그대로이고, 오류는 설계 탭 위 상태줄에만 | `r3_s15b.json` `box` | 예상 > 제한이면 실행 단추 대신 줄이는 방법만, `vibrationError` 때 진동 칸에 오류 |

### 회귀 훑기 (처음 12 시나리오)

| # | 결과 |
|---|---|
| 1 시작 | 같음(P3 두 개 그대로: 응력 244.97 대 Fy 245, 두께 2.30124) |
| 2 템플릿 10 종 | 모두 생성, 면적 처음과 같음(립 C 0.7905 in² … 립 앵글 0.6286), 오류 0 |
| 3 해석 · 분류 · 소성 · 진동 | S-S 1.8 s, C-C 78 s(21 항) — 경고 상자는 정보 줄만(분류 불가는 가정 한 줄). 분류 「unsupported」 문구 · 빈 캔버스, 소성 정상, C-C 진동 46 s(V4-02) |
| 4 하중 II-2A | 처음과 같은 값(지배 3: D+Lr, 양력 7: 0.6D+0.6W, R 0.70, 구간 Ly · Cb · M 동일), 경고 0, 가정 6, 미평가 2 |
| 5 퍼린 · 직접 입력 | 퍼린 38 구간(β 열 · 부재당 Mu), 종합 NG(지배 끝 경간 양력 R 경로 137.5 %). 직접 휨 · 압축 · 조합 · 인장 정상(휨 「H3 1.303 NG」 — V4-18 의 반력 = Vu) |
| 6 접합 8 종 | 처음과 같은 판정. 누락 → 판정 없음 · 참고값. Lap 은 Se 없이 판정 없음(V4-08). 빈 t2 · n 은 V4-29 |
| 7 보고서 · 검증 | 보고서 Mu 실제 값(V4-15), R 경로 단계 5 식 모순(V4-30). 검증 45 통과 / 6 주의 / 9 실패, R 항목 일치 |
| 8 `.csd` | 왕복 같음. v1.2 · v1.0 결과 버림 + 알림. 입력 없는 파일의 입력 잔류(V4-10) |
| 9 단위 | 68 칸 변환 · 왕복 0, 결과 카드 · DSM 표 변환 ✓, 단계 수식 in/mm 혼재(P3) |
| 10 GUI = MCP | 압축 · 휨 · Lap · 볼트 같음, 퍼린 38 구간 같음(0 인 wc 칸 제외 — V4-31), MCP US/SI 비 정확 |
| 11 브리지 | 처음과 같음(403/415/400, CSRF 꼴 차단, MCP 클라이언트 통과) |
| 12 빈 칸 | V4-06 행 |

화면을 열어 본 바뀐 곳: 퍼린 설계 탭(β 열 · 부재당 Mu · 가정 · 미평가 블록, 빈 알림 블록 없음, 단계 「[참고 — §I6.2.1 이 대신함]」 표시 · 흐리게 그리지는 않으나 「지배」 표지는 5b · 6 에만), Lap(Se 문구가 위 배너 · 미평가 · 경고에 세 번 — 중복, 「⚠ ⚠」 아이콘 두 개), 진동(크기 줄 · 확인 단추), 옛 파일 열기, 처음 사용자 설계 화면. 판정 색 모순 · `undefined` 없음.

### 빈 칸 규칙을 쓰는 처음 사용자 경로

새로 띄운 화면(SI, 기본 립 C)에서 보이는 것만으로: 해석 실행 → 하중 계산(기본: 지붕 퍼린, 3 경간 5 m, 데크 없음, D 0.3 · Lr 1.0 · S 0.5 · Wu 1.0 kPa) → 설계 검토 → Lap → 단일 접합 → 보고서 → 검증. **막힘 없이 끝까지 간다**(`s13.js`): 하중 지배 1.2D+1.6Lr, 퍼린 「✗ NG」(데크 없음 → Ly = 경간 5001 mm, 280 %), Lap 「✗ NG」(Se = Mnl/Fy 로 휨 검토), 단일 접합 「판정 없음」 + 보이는 칸(e · s · Pnvs · 폭)으로 해결 가능한 까닭. 막다른 곳:

- V4-32 — 하중 탭에서 빈 칸으로 막히면 아무 표시가 없다(가장 큰 사용성 문제).
- 경고 · 가정이 엔진 인자 이름으로 말한다(V4-33): 「i621_conditions_confirmed 가 없거나 조건 밖」 → 사용자는 하중 탭의 「§I6.2.1 조건 확인」 체크를 찾아야 한다; 「give I_span_in4」 → 「경간별 Ix」 칸.
- 직접 휨의 웹 크리플링: N 칸(89 mm)이 처음부터 채워져 있어 늘 G5/H3 을 검토하고, 반력 칸을 비우면 Vu 를 반력으로 쓴다(V4-18) — 「반력을 넣지 않았다」 는 알림이 없어 사용자가 왜 G5 가 NG 인지 알 수 없다.
- 단일 접합의 빈 t2 · n 은 엔진이 알리지 않고 채워 「✗ NG 326 %」(V4-29) — 사용자는 n 을 넣어야 한다는 것을 알 수 없다.

### 예제 II-2A — GUI 와 MCP `design_purlin`

입력: 8ZS2.25x059(Fy 55, Fu 70), 1 + 4×25 + 1 ft, 랩 2.5/3.5 · 1/1 · 3.5/2.5, D 3 · Lr 20 · Wu 34 psf × 5 ft, 관통체결 kφ 0.3, ASD, 경간별 Ix [9.18, 9.18, 7.76, 7.76, 9.18, 9.18], §I6.2.1 확인, 매뉴얼의 지압 길이 N = 5 in · R 0.1875 · 내민 12 in(`s14.js`, `r_ii2a_N5.png`). **GUI 결과 = MCP 결과(38 구간의 이용률 · 판정 같음, 0 인 wc 칸만 뺌).**

| 검토 | 매뉴얼 II-2A | 도구 | 판단 |
|---|---|---|---|
| 하중 · 반력 · 변곡점 · Ly | F7 표의 값 | 같음(Mu 2.233 · 3.892 · 4.950, R 1.205/3.375/2.571, Ly 43.2/49.1/47.3) | 맞음 |
| 안경간 +M | M 2.23, Ma 4.35 | M 2.233, Ma 51.62 kip-in = 4.30 | 맞음(FSM+kφ 대 부록 2, −1 %) |
| 안경간 랩 끝 F4 | Ly 49.1, Cb 1.67(선형 가정), β 1.23, Ma 3.93 ≥ 3.89 | Ly 49.1, Cb 1.79(F2.1.1-2), β 1.238, Mnd/Ω 4.088 | 정당(FSM Mcrd, Cb 정밀식) |
| 안경간 랩 끝 H2 | Malo 4.94(유효폭법), Va 2.43 → **0.925 OK** | Malo 51.47 kip-in = 4.29(DSM), Va 2.43 → **1.030 NG** | 정당(방법) — II-2B DSM 값으로 1.027. 결론이 뒤집힌다는 것은 사용자에게 알릴 만함 |
| 안경간 중앙 쪽 랩 끝(46–50 ft) | 「by inspection」 | H2 0.992 OK | — |
| 끝 경간 랩 끝 · 첫 내부 지점 랩 · 끝 경간 +M · 끝 지점 웹 크리플링 · 끝 경간 양력 | 끝 부재 0.070: H2 0.838 · 0.834, M+ 5.11, Pa 1.69 > 1.21 | 0.059 하나: H2 1.246 · 1.071, M+ 1.187, G5 1.122 NG(Pn 1.88 = 매뉴얼 식을 0.059 로 푼 값과 같음), 양력 137.5 % | 정당(단면 하나 — GUI · MCP 모두 경간별 두께를 받지 못함). G5 는 매뉴얼의 내민 계수 α 1.13(G5-2)도 못 씀 — 엔진은 `bearing_case='overhang_bearing'` 일 때만, 그리고 Lo/h ≤ 1.5 에서만 쓰는데 화면 · 퍼린 도구에 그 입력이 없다(보수 측) |
| 중앙 지점 랩 H2 | 0.567 (유효폭 Mnℓ 합 9.88) | 0.635 (DSM, 부재당) | 정당(방법) |
| 내부 지점 웹 크리플링 · H3(겹친 Z, 두 부재) | 0.871 · 0.672 OK | **평가하지 않음**(밝힘) | 도구 범위 밖 — 「평가하지 못한 항목」 에 있어 판정은 null 쪽. 정당하지만 매뉴얼이 다루는 검토를 못 함 |
| 양력 R | 0.70, Mn = R·Mnℓo | 0.70, 5b 단계 「0.7 × 85.95 = 60.16」, Ma 3.00 kip-ft | 맞음 |

정당하지 않은 차이는 없다. 남은 차이는 (1) DSM 대 유효폭법(H2 · 랩), (2) 단면 하나, (3) 겹친 Z 지점의 웹 크리플링 미모형, (4) 내민 지압 α 를 쓸 입력 없음 — 모두 결과에 밝혀지거나 보수 측이다.

### 고친 코드를 읽고 본 것

- `clearStaleResults` 의 범위(V4-28), 파일 열기 초기화가 `restoreDesignInputs` 안에만 있음(V4-10 의 남은 길), 엔진 접합의 t2 · n 대체가 화면 수정으로 드러남(V4-29), MCP `PURLIN_WC` 의 `> 0`(V4-31).
- `_designPurlin` 의 β: `dist_M1_M2 = −(작은/큰)` — 같은 부호(단일 곡률)면 음, 반대면 양, 변곡점 쪽 0 이면 0 — S100-16 부록 2 §2.3.3.3 의 부호 규약과 맞다. 내민 구간(Ly 12 in)에도 β 1.3 이 붙고, R 경로 구간에도 β 가 넘어가지만 그 경로는 F4 를 쓰지 않아 결과에 영향 없음.
- `reqNum` · `zeroNum` · `_optNum` 의 구분은 맞게 쓰였다(하중 성분 0, 필수 막음, 선택 생략). 막힘 문구의 표시 위치만 문제(V4-32).

### 확인하지 못한 것 (재검증)

- VS Code 안의 실제 실행, 트리 아이콘, PDF, 라이트 테마, `test/vscode`(V4-19 의 가드 실행).
- `npm run test:rendered` 자체를 돌리지는 않았다(조정자 보고로 8/8) — 그 시나리오를 읽고 내 시나리오와 비교만 했다.
