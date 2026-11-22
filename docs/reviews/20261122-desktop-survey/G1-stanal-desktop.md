# G1 · StAnal 독립 프로그램(`desktop/`) 조사 — StCFSD 이식 설계용 요약

2026-11-22 · 조사 대상: StAnal 저장소 커밋 `c9582d8a`(브랜치 커밋, 작업 트리에 없음) · 상태: **조사 기록**(설계안 아님)

- 읽은 것: `desktop/` 전부(README · `host/` + `BRIDGE.md` · `ui/` + README · `shell/` + README · `installer/` + README · `design/` 10장 + README + 스크린샷 6장),
  `docs/implementation/20261122-desktop-program-worklog.md`(전부), `docs/implementation/20261121-project-collaboration-direction.md`(전부),
  `docs/reviews/20261121-interface-review.md`(요약 · G절 · 4 · 5장), `Ref/design_review_first_ui/README.md`(앞부분).
  `desktop/` 밖은 `git show c9582d8a:<경로>` 로 `mcp-server/connectionInfo.ts` · `mcp-server/extensionRequest.ts` · `src/mcp/McpHttpServer.ts` · `src/mcp/registerConfig.ts` 를 읽었다.
- 경로 표기: 따로 적지 않으면 StAnal 저장소 기준(`desktop/…`). 줄 번호는 `c9582d8a` 기준.
- 줄 수는 빈 줄을 포함한 실제 줄 수(`ReadAllLines`)다.
- **문서와 코드가 다른 곳은 코드를 따랐고 10절에 모았다.**
- StCFSD(cufsmAi) 쪽 사실은 이식 판단에 필요한 만큼만 확인했다(3.6절). GUI 목록은 다른 조사(G2)의 몫이다.

---

## 0. 한 장 요약

```
 Claude Desktop (Cowork)                                     직원이 연 StAnal 창
   │ stdio (MCP JSON-RPC)                                         ▲ BrowserWindow(sandbox, 메모리 세션)
   ▼                                                              │ HTTP 127.0.0.1:<다리 포트>  Bearer <다리 토큰>
 StAnal.exe  app-root\mcp-server\dist\index.js                    │  ├ /ui/…        새 화면(desktop/ui)
  (ELECTRON_RUN_AS_NODE=1, Claude Desktop 이 띄움)                 │  ├ /wv/<id>/    3D 웹뷰(iframe, embed=1)
   │ 광고 파일 %APPDATA%\StAnal\mcp\stanal-mcp-port 읽기             │  ├ /api/events  SSE
   │ HTTP 127.0.0.1:<MCP 포트>  Bearer <MCP 토큰>                    │  └ /api/mcp/…   → MCP HTTP 로 중계(같은 값)
   ▼                                                              │
 ┌ StAnal.exe 주 프로세스 (단일 인스턴스) ────────────────────────────┴──────────────┐
 │ desktop/shell  Electron 45 · 메뉴 · 창 위치 · 저장 확인 · OS 대화상자              │
 │ desktop/host   vscode 대체 모듈 + 적재기 ── require('vscode') 가로채기               │
 │                └ dist/extension.js (VS Code 확장 번들, 한 줄도 안 고침) activate()   │
 │                    └ Model · McpRouter · McpHttpServer(광고 파일 씀) · PyniteBridge │
 │ desktop/host/src/bridge  화면 다리 HTTP 서버(같은 프로세스)                          │
 └───────────────────────────────────────┬──────────────────────────────────────┘
                                         │ child_process (windowsHide 를 껍데기가 강제)
                                         ▼
                          resources\python\python.exe  pynite\cli.py (솔버 worker)
```

핵심 판단 세 가지(작업문서 3.1, 결정 표 첫 줄들):

1. **확장 호스트를 떼어 내지 않고 그대로 돌린다** — `vscode` 모듈을 대신하는 모듈(약 1,830줄)을 끼워 `dist/extension.js` 를 Node 에서 `activate()`.
2. **3D 는 지금 웹뷰 번들을 `<iframe>` 으로 끼운다** — 웹뷰 HTML 을 돌려줄 때만 고쳐 쓰고(주입), 틀은 CSS 로 숨긴다.
3. **새 화면은 MCP 와 같은 길로 읽는다** — 다리가 호스트의 MCP HTTP 로 중계. 화면 값 = AI 가 보는 값.

---

## 1. 실행 구조 — 프로세스와 통로

### 1.1 프로세스

| # | 프로세스 | 누가 띄우나 | 수명 | 근거 |
|---|---|---|---|---|
| P1 | `StAnal.exe` 주 프로세스(Electron main). 안에 **껍데기 · 호스트(확장 번들) · MCP HTTP 서버 · 화면 다리**가 모두 같은 Node 이벤트 루프에서 돈다 | 사용자(바로 가기 · `.sfem` 두 번 누르기 · 설치 끝 `runAfterFinish`) | 창을 닫을 때까지. 닫기 = `bridge.dispose()`(5초 제한) → `host.dispose()`(10초 제한, deactivate → Python worker 정리) | `shell/src/main.ts:480-499`, `:545-594` |
| P2 | Electron 렌더러(BrowserWindow) — 새 화면 + 같은 출처 iframe(3D 웹뷰) | P1 | P1 과 같음 | `shell/src/main.ts:414-437` |
| P3 | Python 솔버 worker(`resources\python\python.exe …\app-root\pynite\cli.py`), 계산서 조판기 | P1 안의 확장 코드(`PyniteBridge`) | 확장 코드가 관리 | `installer/README.md:152` |
| P3' | 계산서 CLI(`StAnal.exe` + `ELECTRON_RUN_AS_NODE`) → 그 안에서 Python 조판기 | P1 안의 확장 코드(`PyniteBridge.renderSubmissionReport`) | 한 번 | `installer/README.md:66` |
| P4 | MCP stdio 서버 `StAnal.exe <resources>\app-root\mcp-server\dist\index.js`(`ELECTRON_RUN_AS_NODE=1`) | **Claude Desktop**(설정 파일의 등록 항목) | Claude Desktop 이 떠 있는 동안. StAnal 창을 닫아도 남는다 | `installer/README.md:37, 154-156` |
| P5 | Claude Desktop | 사용자 | — | — |

- 작업 관리자에는 `StAnal.exe` 가 둘(창 + MCP 서버) 보이는 것이 정상이다(`installer/README.md:154`). 덮어 설치 · 제거 전에 Claude Desktop 도 꺼야 하는 까닭이다(같은 README 알려진 문제 6).
- 호스트가 주 프로세스에서 도는 것은 의도한 단순화다. 431절점 모델에서 최대 지연 108 ms. 수천 부재에서 굳으면 호스트 · 다리를 `utilityProcess` 로 뺄 수 있게 다리를 HTTP 로 만들어 두었다(작업문서 6절 D4).

### 1.2 통로 ① Claude Desktop ⇄ MCP 서버(P5 ⇄ P4)

- stdio, MCP SDK. 바뀐 것 없음. 도구 95개(85 → 95, 더한 10개: `get_project_status` · `open_project` · `list_changes` · `work_items` · `get_view` · `focus` · `sources` · `assumptions` · `alternatives` · `deliverables`).
- 쓰기 도구 12개에 선택 인자 `reason`, `work`(업무 항목 id). MCP 서버가 HTTP 머리(`X-StAnal-Reason` · `X-StAnal-Work` · `X-StAnal-Client`)로 넘긴다(작업문서 결정 「reason …」 · `src/mcp/McpHttpServer.ts:339-342`).

### 1.3 통로 ② MCP 서버 → 호스트 MCP HTTP(P4 → P1)

| 항목 | 내용 |
|---|---|
| 주소 | `http://127.0.0.1:<port>/<route>`(예: `GET model/summary`, `POST analyze`, `GET project/status`). 라우터는 `src/mcp/McpRouter.ts` 의 `handleGet` · `handlePost` |
| 포트 | 호스트의 설정 `structFem.mcpPort`(시험은 0 = 빈 포트). 실제 값은 광고 파일로만 알린다 |
| 토큰 | `McpHttpServer` 가 생성 때 `crypto.randomBytes(32).toString('hex')`(`McpHttpServer.ts:98`). 광고 파일에만 적힌다. 검사는 `sha256("Bearer "+token)` 비교(`:272-273`, timing-safe) |
| 광고 파일 | 내용 `{ port, token, pid, workspace?, timeoutMs? }`, mode 0600(`:130`). 두 개를 쓴다: **공용 파일** = `STANAL_MCP_PORT_FILE`(없으면 `os.tmpdir()/stanal-mcp-port`, `:12-18`)과 **인스턴스 파일** = `<dirname(공용)>/stanal-mcp/<pid>.json`(폴더 0700, `:100-101, :138`). 공용 파일은 비었거나 죽은 프로세스 것일 때만 차지한다 |
| 독립 프로그램의 경로 | 껍데기가 호스트를 띄우기 **전에** `prepareHostEnvironment({ appDir: userData, singleInstance: true })`(`shell/src/main.ts:545`) → `process.env.STANAL_MCP_PORT_FILE = %APPDATA%\StAnal\mcp\stanal-mcp-port`, 인스턴스 파일은 `%APPDATA%\StAnal\mcp\stanal-mcp\<pid>.json`, `STANAL_MCP_TRACE = %APPDATA%\StAnal\mcp\host-trace.jsonl`(`host/src/claude/connect.ts:263-290`, `paths.ts:49-71`) |
| 요청 머리 | `Authorization: Bearer <token>`, `X-StAnal-Request-Id`, `X-StAnal-Attempt`(`mcp-server/extensionRequest.ts:187-192`), 선택 `X-StAnal-Client/Reason/Work` |
| 적재기가 포트를 아는 법 | `startHost` 가 활성화 뒤 인스턴스 광고 파일(`mcpAdvertFile()` = `<dirname(STANAL_MCP_PORT_FILE)>/stanal-mcp/<process.pid>.json`)을 15초까지 기다려 읽는다(`host/src/loader.ts:117-120, 236-247`) |

**"작업 폴더와 무관하게 실행 중인 프로그램 하나에 붙기"** (작업문서 결정 11-22 「Claude 연결은 제품 코드를 고치지 않고」):
- 확장 원래 규칙: MCP 클라이언트는 자기 cwd 가 VS Code 창의 작업 폴더 안일 때 그 창의 인스턴스 파일을 고른다. Claude Desktop 대화에는 작업 폴더가 없어 붙지 못한다(방향 문서 9.1, 부록 A).
- 독립 프로그램: Claude 설정 항목의 `env.STANAL_MCP_PORT_FILE` 에 **프로그램과 같은 공용 파일 경로**를 넣는다. 클라이언트는 이 변수가 있으면(`explicitPortFile`) 인스턴스 폴더를 훑지 않고 그 파일 하나만 읽는다(`mcp-server/connectionInfo.ts:113-139`). 프로그램은 단일 인스턴스라 그 파일 = 실행 중인 프로그램 하나.
- 광고 파일 소유자 확인(`ownedByThisUser`, Windows 는 건너뜀), 크기 16 KiB 상한, 죽은 pid 면 파일을 지운다(`connectionInfo.ts:70-91, 113-139`).

**프로그램 재시작 뒤 다시 붙기 · 호출 막기**(D5b, 제품 코드를 고친 첫 변경 — `mcp-server/` 세 파일 +89/−7):
- 원래 클라이언트는 처음 붙은 호스트(pid · port · token)에 **끝까지 묶였다**. 직원은 프로그램을 자주 껐다 켜므로 Claude Desktop 을 매번 다시 시작해야 했다.
- 고친 것: `STANAL_MCP_STANDALONE=1` **이고** 명시 광고 파일이 있을 때만(`connectionInfo.ts:149`) — 묶인 호스트가 죽었고 같은 파일이 새 살아 있는 호스트를 광고하면 그쪽으로 다시 묶고 `restartUnconfirmed = true`.
- **막기 규칙**: 그 뒤 `get_model_summary` 만 보내고(결과에 `STANDALONE_RESTARTED_NOTICE` 를 붙인다), 그것이 **성공할 때까지** 다른 모든 요청은 보내기 전에 `STANDALONE_RESTARTED` 로 거절한다(`connectionInfo.ts:151-155, 209-211`). 까닭: 새 프로세스는 세션 · 리비전 번호가 1부터 다시 시작해 옛 맥락의 쓰기를 걸러 주지 못하고, "첫 호출 하나만 실패"로는 동시에 보낸 두 번째 쓰기가 통과한다(작업문서 결정 표).
- 변수가 없으면 확장의 동작 그대로. 고치기 전 · 후를 무작위 시나리오 1,200개로 비교해 차이 0(작업문서 검토 D5b).

**프로그램이 꺼져 있을 때**:
- 클라이언트 오류 문구가 `STANDALONE_NOT_RUNNING` = "The StAnal program is not running. Ask the user to start StAnal, then try again. No request was sent."(`connectionInfo.ts:43-44`). 원래 문구 "Open the target VS Code window…" 는 AI 가 직원에게 VS Code 를 열라고 시키게 되어 바꿨다(작업문서 6절 D5).
- **자동으로 띄우지는 않는다.** 방향 문서 9.2 · 5.5 의 "꺼져 있으면 띄운다"는 구현되지 않았다(10절).
- 연결 도중 끊김: `STANDALONE_REFUSED`. 안내문(`INSTRUCTIONS`)에는 아직 "VS Code" · "window reload" 가 남아 있다(작업문서 6절 D5b).

**단일 인스턴스**: `app.requestSingleInstanceLock({ open })`(`shell/src/main.ts:78`). 두 번째 실행은 곧 끝나고, 첫 프로세스가 `second-instance` 에서 창을 앞으로 꺼내고 넘겨받은 모델을 연다(`:642-652`). 잠금을 쥔 프로세스는 앞선 실행이 남긴 광고 파일을 **pid 와 무관하게** 지운다 — 죽은 pid 를 다른 프로세스가 물려받으면 `McpHttpServer` 가 그 파일을 "살아 있는 남의 것"으로 보고 차지하지 않아, 클라이언트가 낡은 포트로 가기 때문(`connect.ts:239-245`).

### 1.4 통로 ③ 호스트 ⇄ 화면 다리(P1 안)

같은 프로세스의 함수 호출이다. 다리가 쓰는 손잡이(`HostHandle`, `loader.ts:61-76`):
- `webviews`(= `WebviewHub`): 웹뷰 생김 · 없어짐 · HTML 대입 · 호스트 → 웹뷰 메시지를 듣고, `deliver(id, msg)` 로 웹뷰 → 호스트 메시지를 넣는다(`vscode/webview.ts:36-88`).
- `commands.execute`, `runtime.commands.registerBuiltin`(다리가 내장 명령 `stanal.desktop.viewState` · `focus` · `workChanged` · `recordLink` 을 등록 — `bridge/screen.ts:45-84`). 확장 번들의 `src/project/WorkDesk.ts` 가 `vscode.commands.executeCommand` 로 부른다. VS Code 확장에서는 그 명령이 없어 던지고, 확장은 그것을 삼킨다.
- `documents.openWithRedirect`: `.sfem` 커스텀 편집기를 만들지 않고 Designer 패널 하나로 돌린다(`bridge/index.ts:193-194`, BRIDGE.md §1 「3D 표면」).
- 화면용 조회는 다리가 **호스트의 MCP HTTP 를 직접 부른다**: `/api/mcp/<경로>` → `http://127.0.0.1:<mcp.port>/<경로>` + `Authorization: Bearer <mcp.token>`(`bridge/index.ts:364-367`). `X-StAnal-Request-Id` 를 **보내지 않는다** — 보내면 화면 조회가 "Claude 의 마지막 호출"로 세어진다(작업문서 6절 D5).
- 사람만 하는 쓰기(확인 표시 · 발행 · 안 열기 · 원자료 열기)는 MCP 라우터에 경로가 없다. 호스트가 조회 경로를 지날 때 `stanal.desktop.recordLink` 로 함수 묶음을 다리에 건네고, 다리는 뜰 때 그 조회(`GET /project/reviews`)를 한 번 부른다(`bridge/index.ts:354`, BRIDGE.md 「확인 표시를 쓰는 길은 하나다」).

### 1.5 통로 ④ 화면(렌더러) ⇄ 다리(P2 ⇄ P1)

| 항목 | 내용 |
|---|---|
| 주소 | `http://127.0.0.1:<port>`, `port: 0`(빈 포트, `bridge/index.ts:337`). 디스크에 적지 않는다 — 껍데기는 같은 프로세스에서 `bridge.origin` · `bridge.token` 을 받는다 |
| 토큰 | 다리 세션 토큰 24바이트 무작위(BRIDGE.md §1). MCP 토큰과 다르다. 화면은 MCP 토큰을 모른다 |
| 브라우저 인증 | 첫 주소 `/?t=<토큰>` → `HttpOnly; SameSite=Strict` 쿠키 `stanal_bridge_<포트>` 로 바꾸고 `t` 를 뗀 주소로 303. 그 뒤 iframe · 청크 · EventSource · fetch 는 쿠키 |
| Electron 인증 | **쿠키를 쓰지 않는다.** `session.fromPartition('stanal-bridge', { cache: false })`(`persist:` 없음 = 메모리) + `webRequest.onBeforeSendHeaders` 가 다리 출처로 가는 모든 요청에 `Authorization: Bearer <다리 토큰>`. 창은 토큰 없는 `http://127.0.0.1:<포트>/` 를 싣는다. 다리 출처 밖의 http/https/ws 요청은 `onBeforeRequest` 가 취소(`shell/src/main.ts:302-322`) |
| 출처 검사 | Host 가 `127.0.0.1:<포트>`/`localhost:<포트>` 가 아니면 403(DNS rebinding). Origin 은 다리 출처만. `Sec-Fetch-Site` 는 `same-origin` · `none` 만(같은 PC 다른 포트도 막음). POST 는 `Content-Type: application/json` 만(415). 모든 응답 `X-Frame-Options: SAMEORIGIN` · `nosniff` · `no-store` · `Referrer-Policy: no-referrer`(BRIDGE.md §1, `bridge/http.ts`) |
| 응답 | `{ success, data?, error? }` |
| 이벤트 | `GET /api/events`(SSE). 첫 줄 `event: hello` `{ lastSeq, surface, platform: { progress, statusBars, pending } }`, 그 뒤 `{ seq, at, type, source(host·webview·bridge·platform), data }`. 끊기면 `Last-Event-ID` · `?since=` 로 최근 500개 안에서 다시 보낸다. 15초마다 `: ping`(`bridge/sse.ts`) |
| 큰 메시지 | `model:sync`(170 KB) · `analysis:result`(2 MB)는 이벤트에 요약만 — 본문은 `GET /api/surface/model`, `GET /api/surface/last?type=…[&optional=1]`. 그 밖도 256 KiB 넘으면 요약 |
| 경로 전체 | BRIDGE.md §2. 요약: 정적(`/ui/…`, `/wv/<id>/?embed=1&theme=`, `/res/webview/…`, `/res/resources/…`), 3D(`/api/surface`, `/api/surface/policy`, `/api/view`, `/api/view/state`), 파일 · 물음(`/api/file`, `/api/platform/answer`), Claude(`/api/claude/status|connect|disconnect`), MCP 중계(`/api/mcp/*`), 화면 상태(`/api/ui/view`), 사람만(`/api/review`, `/api/issue`, `/api/alternatives/open`, `/api/sources/open`, `/api/deliverables/open`, `/api/project/export`, `/api/edit/undo`) |

### 1.6 통로 ⑤ 3D iframe ⇄ 다리 ⇄ 호스트의 웹뷰

- 호스트 → 웹뷰: SSE `/api/wv/<id>/out`. 주입한 수신부가 `window.dispatchEvent(new MessageEvent('message', { data }))` 로 넣는다(웹뷰 코드는 그대로 `window.addEventListener('message')`).
- 웹뷰 → 호스트: `acquireVsCodeApi()` 대체물의 `postMessage` → POST 묶음 `/api/wv/<id>/in`(한 번에 한 POST, 쌓인 것을 묶는다). `getState/setState` → `sessionStorage['stanal.wv.state.<viewType>']`. 두 번 부르면 VS Code 처럼 던진다.
- 웹뷰가 `ready` 를 보내기 전 호스트 메시지는 버린다(호스트가 `ready` 에 모델 · 결과를 다시 보내므로). 단 `webview:request`(MCP 가 답을 기다리는 일회성)는 50개까지 쥐었다가 `ready` 뒤 보낸다. 호스트가 `ready` 때 다시 보내지 않는 `limit:mechanism` · `member:overlay` 는 다리가 마지막 것을 다시 보낸다(VS Code 의 `retainContextWhenHidden` 를 브라우저 새로 고침에서 흉내).
- 같은 웹뷰에 두 번째 연결이 붙으면 앞의 것은 `superseded`(POST 409). 3D 하나에 연결 하나.
- 화면 ⇄ iframe(같은 출처): 3D 우클릭은 웹뷰 메뉴를 막고 `embed:contextmenu {x, y, hover}` 로 넘긴다. 화면은 그 좌표에 **합성 좌클릭**을 iframe 캔버스에 넣어 웹뷰가 개체를 고르게 하고, 돌아온 `selection:sync` 로 개체를 안다. 막은 `keydown` 은 `postMessage({ stanalEmbedKey })` 로 부모에 넘긴다(BRIDGE.md §4).

### 1.7 통로 ⑥ 호스트 ⇄ Python

확장 코드 그대로(`PyniteBridge`). 독립 프로그램이 바꾼 것은 둘:
- Python 경로를 설정 덮어쓰기 `structFem.pythonPath` 로 넘긴다: `STANAL_PYTHON` → `<resources>/python/python.exe`. 설치본은 `.venv` 를 찾지 않는다. 호스트를 띄우기 전에 `PYTHONHOME` · `PYTHONPATH` · `PYTHONSTARTUP` 을 지우고 `PYTHONNOUSERSITE=1`(`shell/src/layout.ts` `applyPythonEnv`, `installer/README.md:88`).
- Windows 에서 `child_process` 를 감싸 `windowsHide` 를 주지 않은 호출에 `true` 를 채운다(`shell/src/winConsole.ts`, 56줄). 계산서 CLI(P3')는 별도 프로세스라 닿지 않아 제품 코드 한 줄(`packages/stanal-submission-report/src/cli.ts:448`)을 고쳤다.

---

## 2. Claude Desktop 등록

### 2.1 설정 파일 위치(`host/src/claude/paths.ts`)

| 종류 | 경로 | 비고 |
|---|---|---|
| standard · Windows | `%APPDATA%\Claude\claude_desktop_config.json`(`APPDATA` 없으면 `<home>\AppData\Roaming\…`) | 제품의 `claudeDesktopConfigPath` 그대로(`src/mcp/registerConfig.ts`) |
| standard · macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` | |
| standard · 그 밖 | `~/.config/Claude/claude_desktop_config.json` | |
| msix · Windows | `%LOCALAPPDATA%\Packages\<이름에 claude 가 든 폴더>\LocalCache\Roaming\Claude\claude_desktop_config.json` | **실제 MSIX 설치본으로 확인하지 못함**(`paths.ts:88-97`) |

고르는 순서(`pickClaudeConfig`, `:123-128`): 파일이 있는 msix → 폴더가 있는 standard → 폴더가 있는 msix → standard(폴더 없음 = 미설치).

### 2.2 등록 항목(`describeEntry`, `connect.ts:106-125`)

```jsonc
// mcpServers.stanal — 설치본(Windows)
{
  "command": "C:\\Users\\…\\AppData\\Local\\Programs\\StAnal\\StAnal.exe",
  "args": ["C:\\Users\\…\\Programs\\StAnal\\resources\\app-root\\mcp-server\\dist\\index.js"],
  "env": {
    "ELECTRON_RUN_AS_NODE": "1",
    "STANAL_MCP_PORT_FILE": "C:\\Users\\…\\AppData\\Roaming\\StAnal\\mcp\\stanal-mcp-port",
    "STANAL_MCP_STANDALONE": "1"
  }
}
```

- 키 이름 `SERVER_KEY = 'stanal'`, 서버 상대경로 `SERVER_REL_PATH = ['mcp-server','dist','index.js']` 는 제품 `src/mcp/registerConfig.ts` 의 것을 `require` 로 가져다 쓴다(`host/src/claude/registerConfig.ts` — tsconfig `rootDir` 문제로 형만 다시 적음).
- 개발판(`kind:'dev'`)은 `command` = `process.execPath`(Electron 이면 `ELECTRON_RUN_AS_NODE=1` 추가), `args` = 저장소 `mcp-server/dist/index.js`.
- 설치본 판별 `detectRuntime`(`connect.ts:74-85`): `process.versions.electron` 이 있고 `process.defaultApp` 이 아니고 `resourcesPath` 가 있으면 installed. 껍데기는 짐작한 서버 경로가 배치(`layout.mcpServer`)와 다르면 경고만(`shell/src/main.ts:582-588`).
- 경로는 OS 모양 그대로(JSON 의 `\\`). 인자 배열이라 공백 · 한글에 따옴표가 필요 없다.
- 확장의 VS Code 등록은 버전 무관 런처(`~/.stanal/stanal-mcp.cjs`)를 쓰지만 독립 프로그램은 런처를 쓰지 않는다(설치 경로가 고정).

### 2.3 연결 · 끊기 · 상태(`connect.ts`)

**`connect()`**(`:444-494`):
1. 설정 **폴더**가 없으면 `claude-not-installed` — 폴더를 만들지 않는다.
2. 읽기: BOM 제거, 빈 파일은 `{}`. JSON 이 아니거나 루트가 객체가 아니거나 `mcpServers` 가 객체가 아니면 `invalid-config` — **손대지 않고 백업도 하지 않는다**.
3. 지금 항목을 분류(`classifyEntry`, `:201-213`): `absent` · `current`(같음) · `ours-stale`(같은 `STANAL_MCP_PORT_FILE` 이지만 실행 파일 · 서버 · env 가 다름 — 프로그램을 옮겼거나 D5b 전 항목) · `vscode-launcher`(args 가 `stanal-mcp.cjs` 로 끝남) · `foreign`.
4. `current` 면 아무것도 쓰지 않고 `unchanged`.
5. 아니면 `<파일>.stanal-backup-YYYYMMDD-HHMMSS[-n]` 로 백업(`COPYFILE_EXCL`) → 제품의 `upsertMcpJson` 으로 병합(다른 최상위 키 · 다른 서버 그대로) → **같은 폴더 임시 파일 + rename**, Windows 의 `EPERM/EBUSY/EACCES` 는 50 ms 씩 늘려 4번 다시(`:402-417`), 파일 mode 유지 → 다시 읽어 항목이 같은지 확인.
6. `%APPDATA%\StAnal\mcp\registration.json` 에 `{ registeredAt, configPath }`.
7. 결과 `{ action: created|added|updated, backupPath, replaced?, others, restartRequired: true }`. **어떤 종류든 덮어쓴다**(VS Code 런처 항목도) — 이전 값은 `replaced` 와 백업에 남는다.

**`disconnect()`**(`:509-540`): 항목이 지금 `describeEntry()` 와 **같을 때만** 지운다. 다르면 `kept`(알리기만). 백업 · 원자적 쓰기 · `registration.json` 삭제.

**`checkConnection()`**(`:351-382`) → `ConnectionStatus`: `configPath` · `configKind` · `candidates` · `claudeInstalled` · `configError` · `registered` · `upToDate` · `entryKind` · `other` · `expected` · `portFile` · `programAdvertised`(광고 파일 pid 가 살아 있나) · `programPid/Port` · `lastCallAt` · `registeredAt`.
다리의 `GET /api/claude/status` 는 여기에 `restartRequired`(= 등록 뒤로 호출이 한 번도 없음)를 더한다(BRIDGE.md 「Claude Desktop 연결」).

**"마지막 호출" 의 근거**(`claude/lastCall.ts`): `McpHttpServer` 는 `STANAL_MCP_TRACE=<파일>` 이면 요청마다 `{"ev":"host.accept","id":…,"path":…}` 한 줄을 쓴다. MCP 클라이언트는 `X-StAnal-Request-Id` 를 **늘** 보내므로 `id` 가 있는 줄 = Claude 의 호출. 감시자가 새 줄만 읽어 `%APPDATA%\StAnal\mcp\last-call.json` 에 남기고(재시작 너머로), 1 MiB 넘으면 `.1` 로 돌린다. 다리 이벤트 `claude:call`.

화면의 「연결」 상자(템플릿 00): ① 설정에 등록됨 [연결] ② Claude Desktop 다시 시작 ③ 마지막 호출 「어제 16:20」. 제목 표시줄에 `● Claude 연결됨`.

### 2.4 시험에서 진짜 설정을 건드리지 않는 법

- 모든 경로 함수가 `{ platform, home, env }` 를 인자로 받는다 — `path.win32` / `path.posix` 를 골라 macOS 에서 Windows 경로 모양을 시험(`paths.ts:13-30`).
- `startBridge({ claude: { configPath } })` · 껍데기의 `STANAL_CLAUDE_CONFIG` 로 가짜 설정 파일을 준다. 껍데기 시험 모드(`STANAL_SHELL_TEST=1`)인데 주지 않으면 `userData/no-claude/Claude/claude_desktop_config.json`(= 미설치)(`shell/src/main.ts:620-624`).
- `host/test/connect.mjs`(63): 가짜 설정 7가지(미설치 · 새로 만들기 · 다른 항목 보존과 백업 · 이미 같음 · 확장 런처 덮어쓰기 · 깨진 JSON 손대지 않음 · 끊기), **등록 항목 그대로** cwd=`/` 에서 MCP 클라이언트를 띄워 도구 85/95개 · 모델 요약, 확장이 함께 떠 있어도 독립 프로그램에만 붙는가, 재시작 뒤 첫 쓰기 거절 → 요약 통과 + 알림 → 통과.
- 진짜 설정 파일은 **열지 않고** 크기 · 수정 시각만 본다(`ui/test/helpers.mjs` `statSafe`). 주의: `ui/test/ui.mjs:24` 의 진짜 설정 경로가 **macOS 경로로 하드코딩**되어 Windows 에서는 이 확인이 빈 확인이 된다.
- 사고 기록: B3 시험 중 "진짜 설정은 그대로" 가 한 번 실패 — Claude Desktop 이 떠 있으면서 자기 설정 파일을 고쳐 썼다(같은 때 `Cookies` · `fcache` 도 바뀜). 내용은 읽지 않고 `stanal` 글자 0번 · 임시 경로 0번 · 백업 파일 없음으로 판단(작업문서 검토 B3).

---

## 3. 호스트 방식 — 고치지 않은 확장 번들을 Node 에서

### 3.1 적재기(`host/src/loader.ts`, 267줄)

1. `Module._resolveFilename` 을 감싸 요청이 `'vscode'` 면 가짜 파일 이름 `__stanal_vscode_shim__.js` 로 돌리고, 그 이름의 `Module` 을 `require.cache` 에 미리 넣어 `exports = api`(`:89-105`). 번들이 `externals: { vscode: 'commonjs vscode' }` 라 가로챌 곳이 한 군데다.
2. `createVscodeShim()`(대체 모듈) + `createExtensionContext()`(`extensionPath = repoRoot`, globalState/workspaceState JSON 파일).
3. `require('<repoRoot>/dist/extension.js').activate(context)`.
4. **활성화 끝을 아는 법은 StAnal 전용이다**: `bootstrap.ts` 의 `activate()` 는 패널 제공자만 등록하고 곧 돌아오고 본체는 비동기로 읽힌다. 끝을 알리는 공개 수단이 없어, 시작 패널 제공자 `structFem.panel` 의 `setDelegate`(성공) · `showFailure`(실패)를 감싸고, `console.error` 를 감싸 `'[StAnal] extension core activation failed'` 를 잡는다(`:184-233`). `bootstrap.ts` 모양이 바뀌면 경고를 남긴다.
5. MCP 인스턴스 광고 파일을 기다려 `{ port, token, pid }` 를 얻는다(`:236-247`).
6. 작업 폴더가 프로젝트를 따라간다: 확장이 모델을 열거나 저장할 때 고치는 globalState `stanal.recentModels.v1` 의 맨 앞 파일로 프로젝트 루트를 찾아 `workspace.setProjectDir` → `onDidChangeWorkspaceFolders`, workspaceState 파일을 `<프로젝트>/.stanal/workspaceState.json` 로 옮긴다(`:168-178`).
7. `dispose()`: deactivate → `context.subscriptions` 역순 dispose → 런타임 정리 → 훅 제거 → 번들 청크를 `require.cache` 에서 지움(같은 프로세스에서 다시 `startHost` 가능). 한 프로세스에 호스트 하나(`active` 검사).

### 3.2 대체 모듈(`host/src/vscode/`, 14파일 1,831줄)

| 파일 | 줄 | 흉내(화면 없음) | 진짜로 구현 |
|---|---|---|---|
| `index.ts` | 128 | `env`(appName 'StAnal', machineId 'stanal-desktop', uriScheme 'stanal', uiKind Desktop, 원격 없음), 내장 명령 `vscode.openWith` · `workbench.action.files.save` · `setContext` · `vscode.open` · `<viewId>.focus`(보이기 요청 + 웹뷰 뷰 resolve) | 네임스페이스 조립, 모든 네임스페이스를 `guard()` Proxy 로 감쌈, `version: '1.95.0-stanal-shim'` |
| `commands.ts` | 57 | — | 명령 등록부(같은 id 두 번이면 던짐 — VS Code 와 같게), 내장 명령 표, 실행 기록 200건 |
| `configuration.ts` | 100 | — | `getConfiguration`: 기본값 = 저장소 `package.json` `contributes.configuration`, 사용자 값 = `<userData>/host/settings.json`(평평한 키), 시작 덮어쓰기(파일에 안 씀), `onDidChangeConfiguration` |
| `context.ts` | 94 | `ExtensionContext` 의 나머지 | `FileMemento`(globalState · workspaceState → JSON 파일, `retarget`) |
| `documents.ts` | 213 | 커스텀 텍스트 편집기(가짜 패널) | `TextDocument`(텍스트 · offset · line · dirty · version), `workspace.applyEdit`(뒤에서부터 적용), 저장(임시 + rename, `onWillSave.waitUntil`), `openWithRedirect` 갈고리 |
| `events.ts` | 113 | — | `Disposable` · `EventEmitter` · `CancellationTokenSource` · `CancellationError` |
| `statusbar.ts` | 88 | `StatusBarItem`(상태를 `platform.statusBar` 로), `OutputChannel`(`platform.outputLine` 로) | — |
| `tree.ts` | 81 | `TreeView`(선택 · 보임 사건만, 화면 없음). 제공자는 등록부에 남겨 새 화면이 `getChildren` 을 부를 수 있게 | — |
| `types.ts` | 139 | — | 열거형 15종, `ThemeIcon` · `ThemeColor` · `Position` · `Range` · `Selection` · `WorkspaceEdit` · `MarkdownString` · `TreeItem` · `DataTransfer` |
| `unimplemented.ts` | 52 | — | `guard()` Proxy: **없는 멤버를 읽으면** `[vscode-shim] 미구현: window.xxx` 를 한 번 남기고 `undefined`. 키가 있고 값이 undefined 인 것은 기록하지 않음. `then` · `toJSON` 등 탐색용 이름은 무시. `tracker.list()` |
| `uri.ts` | 190 | — | `Uri`(`file` · `parse` · `from` · `joinPath` · `with` · `fsPath`), **`toString()` 은 VS Code `URI.toString()` 과 같은 인코딩**(`! ' ( ) *` · `:` 인코딩, 드라이브 문자 소문자 — D7 에서 고침) |
| `webview.ts` | 289 | `WebviewPanel` · `WebviewView`(보임 · 포커스는 바깥이 정함) | `WebviewHub`(id = `<kind>:<viewType>:<seq>`, 생김 · 없어짐 · HTML 대입 · postMessage 사건, `deliver()`), `asWebviewUri`(기본 `https://file+.vscode-resource.vscode-cdn.net/<경로>`), `WebviewViewRegistry.resolve()` |
| `window.ts` | 153 | `activeTextEditor: undefined`, `activeColorTheme: {kind:2}`, `state.focused: true` | 알림 · `showQuickPick` · `showInputBox`(validateInput 실패면 취소) · `showOpen/SaveDialog` · `withProgress` → 모두 `HostPlatform` 으로; `createWebviewPanel` · `registerWebviewViewProvider` · `registerCustomEditorProvider` · `createTreeView` · `registerTreeDataProvider` |
| `workspace.ts` | 134 | `isTrusted: true`, `workspaceFile: undefined` | `workspaceFolders`(읽을 때마다 지금 값, `WorkspaceControl.setProjectDir`), `workspace.fs`(readFile · writeFile · rename · delete · stat · createDirectory · readDirectory · copy, `FileSystemError` 코드), `openTextDocument`, 문서 사건 |

**미구현 추적**: 연기 시험(`host/test/smoke.mjs`)이 목록을 출력하고 확인한다. D1 에서 닿은 곳 0. 원칙: "조용히 undefined 를 돌려주는 것이 가장 위험하다"(`unimplemented.ts:6-8`).

**VS Code 화면 API 는 재현하지 않는다**: 모델 트리 · 사이드바 · 상태바는 객체만 있다(desktop/README 규칙 3).

### 3.3 물음 · 알림 · 진행 · 파일 대화상자의 길(`HostPlatform`)

`host/src/platform.ts`(189줄)의 인터페이스 하나로 모은다: `notify` · `pick` · `input` · `fileDialog` · `openExternal` · `revealFile` · `clipboardWrite/Read` · `progress` · `statusBar` · `outputLine` · `reveal`. 구현 셋:

| 구현 | 파일 | 하는 일 |
|---|---|---|
| headless | `host/src/platform.ts` | 기록만, 물음은 시험이 준 답 또는 취소. 출력 5,000줄 보관 |
| 다리 | `host/src/bridge/platform.ts`(160) | 단추 있는 알림 · 고르기 · 입력 · 대화상자 → 이벤트 `platform:question {qid, kind, request, at}` → 화면이 `POST /api/platform/answer {qid, answer}`(알림 = 단추 제목, 고르기 = 번호(배열), 입력 = 문자열, 대화상자 = 절대 경로 배열, `null` = 취소). **시간 제한 없음**(VS Code 와 같게). 화면이 하나도 없으면 headless 처럼 취소, 물음 뒤 화면이 모두 떨어지면 취소. 단순 알림 · 진행 · 상태바 · 보이기 · 외부 열기 · 클립보드는 이벤트만(`platform:notify|progress|status|reveal|openExternal|revealFile|clipboard`) |
| 껍데기 | `shell/src/platform.ts`(153) | 다리 구현을 감싸 **파일 대화상자 · 외부 열기 · 폴더 열기 · 클립보드는 OS(Electron `dialog` · `shell` · `clipboard`)**, 알림 · 고르기 · 입력 · 진행은 화면. 화면이 아직 없을 때의 modal 알림은 `dialog.showMessageBox`. "확장이 활성화되었습니다" 알림은 걸러 버린다 |

위험 기록: 화면이 modal 물음을 그리지 않으면 호스트가 끝없이 기다린다(작업문서 6절 D4) — 새 화면 `ui/src/dialogs.ts` 가 반드시 그린다.

### 3.4 웹뷰 HTML 끼워 넣기(`host/src/bridge/inject.ts`, 277줄)

확장의 HTML 생성 코드(`src/ui/webviewHtml.ts`)는 고치지 않고 **돌려줄 때만** 바꾼다:
1. 리소스 주소 `https://file+.vscode-resource.vscode-cdn.net/<절대경로>`(`%2B` 꼴 포함) → `/res/<뿌리>/<상대>`. 허용 뿌리 밖이면 `/res/denied`. Windows `/c:/…` 처리.
2. CSP 다시 쓰기: `default-src 'none'; script-src 'nonce-<새것>' 'self'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'`(`:106-115`). 원래 nonce 는 요청마다 새것으로.
3. `<head>` 앞: `--vscode-*` 변수 50여 개(Dark/Light Modern 기본 색, `bridge/theme.ts` 137줄), `acquireVsCodeApi` 대체물 + SSE 수신부.
4. `<body>` 클래스 `vscode-dark`/`vscode-light`.
5. `?embed=1` 이면 숨김 CSS: `EMBED_HIDDEN_SELECTORS`(`#dock #status-bar #notice-host #selection-filter #perf-hud #load-display-evidence #empty-state-card #collaboration-history #stale-banner #stage-guidance #next-action #workflow-stepper #quick-access`) — `display:none` 이지 지우지 않는다(main.ts 가 `getElementById(...)!` 로 잡음). 편집 상태에서만 `#toolbar #context-bar #command-line` 을 보이고, 기능 메뉴는 `model · properties · loads` 분류만(`:38-77`).
6. 막기(review 상태 기본): 단축키는 capture 단계에서 멈춤, 우클릭 메뉴 막음, 모델 · 파일을 바꾸는 웹뷰 → 호스트 메시지(`command:execute` · `input:key` · `file:*` · `*:commit` · `cleanup:fix` · `retrofit:command`)를 다리가 넘기지 않고 `embed:blocked` 로 알림. F2 · Ctrl/⌘+S · Ctrl/⌘+O 는 정책과 무관하게 부모로. 웹뷰 알림 · 상태줄 글은 `embed:notice` · `embed:status` 로 넘김.
7. 정책: `POST /api/surface/policy { keys?, edits?, mode: 'review'|'edit' }`. 편집 상태로 들어갈 때 iframe 을 다시 읽지 않고 `<html class="stanal-edit">` 만 바꿔 카메라 · 선택이 남는다. 웹뷰 대화상자가 3D 안에 뜨게 하려고 다리가 resolve 해 둔 사이드바 패널을 **닫는다**(호스트가 패널이 없으면 웹뷰 안 팝업으로 연다 — 확장 코드의 기존 갈래를 이용).

없는 3D 기능은 만들지 않았다(BRIDGE.md §5): 지점 표시 끄기, 선택과 별개인 강조 · 흐리게, 개체에 맞춘 확대(→ 새 화면 `ui/src/fit.ts` 가 절점 좌표로 경계 구를 구해 `op:'camera'` 로 넣어 해결), 3D 밖으로 범례 빼기. `isolate` · `hide` · `show` 는 3D 가 해석 결과를 버려서 메뉴에 넣지 않았다.

### 3.5 이 방식이 StAnal 에서 맞았던 까닭(작업문서 3.1 · 결정 표 · 방향 문서 9.4 고침)

- `extension.ts` 1만 5,800줄, `vscode.` 호출 452곳, `activate` 는 **3,650줄짜리 클로저**이고 그 안에 MCP 조립 2,200줄 · 웹뷰 메시지 처리 1,200줄 · 결과(전역 변수) · 신선도 키가 있다. 떼어 내면 몇 주, 확장이 깨질 위험이 크다.
- 호스트 170개 파일 중 `vscode` 를 가져오는 것은 15개. 공유 계산부 · 웹뷰 · Python · MCP 라우터 · HTTP 서버는 VS Code 와 무관.
- 웹뷰 `main.ts` 1만 3,700줄, 전역 상태 233개에 3D 가 묶임, 시험 65개가 소스 문자열에 기댐 → 3D 를 공용 모듈로 떼지 않고 번들째 iframe.
- 이미 갖춘 것: MCP HTTP 서버(127.0.0.1 + 토큰 + 광고 파일), GUI 와 MCP 가 같은 명령 해석기 · undo 스택, 웹뷰가 `acquireVsCodeApi()` 통로 하나로만 호스트와 말함(`webview/main.ts:382-388`), 등록 도우미가 VS Code 비의존.
- 결과: 모델 · 명령 · 설계 계산 · MCP 도구 95개가 확장과 **글자 그대로 같은 코드**. D1 에서 `activate()` 가 VS Code 밖에서 처음 돌았고 미구현 API 0.

### 3.6 StCFSD 에 옮길 때 판단 재료(cufsmAi 에서 확인한 사실)

| StCFSD 사실(확인) | 의미 |
|---|---|
| `src/extension.ts` 536줄(`vscode.` 33곳), `src/webview/StcfsdPanel.ts` 3,640줄(36곳), `src/webview/ProjectExplorerProvider.ts` 372줄(42곳 — TreeItem · ThemeIcon), `webview/js/app.js` 7,043줄 | StAnal 의 "떼어 내기가 너무 위험" 논거는 약하다. 그러나 쓰는 API(명령 등록 · 알림 · QuickPick · `withProgress` · `getConfiguration` · `workspaceFolders`/`onDidChangeWorkspaceFolders` · `createTreeView` · `createWebviewPanel` · `showOpen/SaveDialog` · `Uri.joinPath` · `ThemeIcon` · `TreeItem` · `EventEmitter` · `workspace.fs` · `activeTextEditor`)는 **모두 StAnal 대체 모듈에 이미 있다** — 대체 모듈 쪽 비용이 거의 없다 |
| `package.json` `main: ./out/extension.js`(tsc 출력, 번들 아님) | `require('vscode')` 가 여러 파일에 있어도 `_resolveFilename` 갈고리는 그대로 된다. `purgeBundleCache` 의 대상 폴더만 `out/` 으로 |
| `activate` 는 `export async function activate(context)`(`src/extension.ts:31`), MCP 다리는 그 안에서 `new McpBridgeServer(() => StcfsdPanel.currentPanel …, mcpPort)`(`:45`) | StAnal 의 `setDelegate` 감싸기(활성화 끝 감지)는 필요 없다 — `await activate()` 로 충분하다(확인은 G2 몫) |
| MCP 다리 `src/mcp/bridge.ts`: **고정 포트 52790**, `127.0.0.1`, **토큰 없음**, `Access-Control-Allow-Origin: *`, 경로 `GET /status` · `POST /action` 둘, 처리는 `StcfsdPanel.currentPanel.handleMcpAction()` — 패널이 없으면 "No active CUFSM panel. Open Section Designer first." | ① StAnal 의 광고 파일 · 토큰 · 명시 포트 파일 · 재시작 막기는 **StCFSD 제품에 없다** — 들여오려면 `src/mcp/bridge.ts` · `src/mcp/server.ts` 를 고쳐야 한다(StAnal 도 D5b 에서 `mcp-server/` 를 기본값 꺼짐 변수로 고쳤다). ② MCP 처리가 **패널 객체에 붙어 있다** → 독립 프로그램은 뜰 때 패널을 반드시 만들어 두어야 한다(StAnal 은 호스트가 패널 없이도 MCP 를 처리). ③ 고정 포트는 VS Code 확장과 독립 프로그램이 동시에 뜨면 충돌한다. ④ CORS `*` + 토큰 없음은 다리 보안 규칙(1.5)과 맞지 않는다 |
| MCP 서버 `src/mcp/server.ts`(1,344줄): `STCFSD_MCP_PORT`(기본 52790)만 읽고 `http://localhost:<port>` 로 부른다. 등록 `src/mcp/registration.ts`: `command: 'node'`, `env: { STCFSD_MCP_PORT }` | 직원 PC 에는 Node 가 없다 — StAnal 처럼 `StCFSD.exe` + `ELECTRON_RUN_AS_NODE=1` 로 띄워야 한다(퓨즈 RunAsNode 유지). 꺼져 있을 때 문구도 지금은 패널/VS Code 기준 |
| 웹뷰 HTML 을 패널 클래스가 인라인으로 만든다 | `inject.ts` 의 방식(돌려줄 때 리소스 주소 · CSP · nonce 고쳐 쓰기, `acquireVsCodeApi` 대체 주입)은 문자열만 보므로 그대로 쓸 수 있다. 숨김 선택자 · 테마 변수 목록은 StCFSD 의 DOM 에 맞춰 새로 정해야 한다 |
| 솔버가 Python(`src/bridge/PythonBridge.ts` 181줄, JSON-RPC) | 설치본의 Python 묶음 · 경로 덮어쓰기 · `windowsHide` 문제가 그대로 생긴다(6절) |

---

## 4. 새 화면(`desktop/ui`)

### 4.1 원칙

| 원칙 | 출처 | 화면에서 |
|---|---|---|
| **대화는 Claude Desktop 한 곳에서만** | 방향 3.1 — 사내 배포에서 확장이 쓰이지 않은 까닭이 "대화창이 여러 곳"이었다. StAnal 안에 대화 패널을 두면 그 장애를 다시 만든다 | 대화 패널 없음. MCP Apps(대화 안 화면)도 쓰지 않음 |
| **검토 중심, 모델링 중심 아님** | 인터페이스 리뷰 0장 — 기능 214개 중 작성용 55.6%, 검증용 3.7%. "AI 가 무엇을 바꿨나 · 부재 계산 과정 · 검토 기록"은 데이터가 없었다 | 기본 상태 = 읽기. 편집 상태(F2)만 그리기 |
| **화면은 정보를 주고 요청은 말로** | 방향 3.7(다섯 번째 고침) — 양식은 만든 사람이 떠올린 답만 받는다 | 정보 창에 단추 · 입력 칸 · 양식 0개(시험이 센다). 값 수정 · 재해석 · 대안 만들기 · 판단 요청의 답은 Claude 에게 말로 |
| **사람만 하는 것** | 방향 3.5 · 3.7, 작업문서 결정 | 확인 표시(한 번 누르기), 발행(단추 + 확인 물음), 편집 상태의 그리기, Claude 「연결」. MCP 로는 못 한다(라우터에 경로 없음 + 다리의 화면 세션 토큰만, MCP 토큰은 401, MCP 요청 비동기 문맥 안이면 거절) |
| **「Claude 가 보는 선택」** | 방향 3.7 — "이거", "지금 보는 것" | 오른쪽 맨 아래 한 줄. 화면이 고른 줄 · 탭 · 표 · 편집 · 따라가기 · 마지막 조작을 0.06초 모아 `POST /api/ui/view`(32 KiB 까지)로 올리고 AI 의 `get_view` 가 그대로 읽는다. 개체가 아닌 줄을 고르면 호스트의 3D 선택은 푼다 |
| **AI 따라가기 — 한 길** | 방향 4.4 | AI 의 선택 · 변경 묶음 · 업무 항목 · 가정 · 초안 · `focus` 가 모두 `aiFollow` 로(`ui/src/main.ts:142`). 켜져 있고 · 편집 상태가 아니고 · 사람이 **5초**(`IDLE_MS`) 넘게 가만히 있으면 탭 · 줄 · 3D 선택 · 맞춤을 따라가고, 아니면 제목 표시줄의 누를 수 있는 한 줄로 쌓인다(가장 새 것 + 「+n」). `focus` 응답의 `outcome`(follow/notice/no-screen)은 다리가 화면의 마지막 상태로 짐작한 것이다 |
| **포커스를 가져가지 않는다** | 방향 4.1 · 9.2 — 사람은 다른 모니터의 Cowork 에 글을 쓰는 중 | 창을 앞으로 내는 코드는 세 곳뿐: 처음 뜰 때(`ready-to-show`), 사용자가 다시 실행(`second-instance`), macOS dock(`activate`). 호스트의 `reveal` 은 화면 안 이벤트로만. 시험이 포커스 사건 0 을 센다 |
| **설명은 풍선 도움말** | 방향 3.7 끝 | 화면에 「…하세요」 문장 없음. `data-tip`(`ui/src/tips.ts`). 시험이 안내 문장을 찾는다 |
| **화면은 계산하지 않는다 · 지어내지 않는다** | ui/README | 값은 모두 다리 경로로 읽는다. 데이터가 없는 것은 그리지 않는다(README 「데이터가 없어 아직 없는 것」). 판정비 글자는 제품의 `formatVerdictRatioV1`(NG 올림 · 그 밖 내림 · 소수 3자리) |
| **AI 글은 글자로만** | 방향 5.3 | `esc()` — `<script>` · `<img onerror>` 가 글자로 보인다(시험) |

### 4.2 틀

```
┌ 제목 표시줄(36px): StAnal · 프로젝트 ▾ · 안 ▾ · ● 해석 #7 과 일치 ····· 찾기 · AI 따라가기 · 편집 F2 · ● Claude 연결됨 ┐
├ 진행 띠 ───────────────────────────────────────────────────────────────────────────────────────┤
├ 왼쪽 280 ─────────┬ 가운데 ─────────────────────────────┬ 오른쪽 380 ────────────────────┤
│ 업무|모델|결과|문서 │ 칩 줄(판정비 · 변형 · 지점 · 하중 · 부재력도) │ 정보 창(읽는 곳)                  │
│ 트리(이름 + 개수)   │ 3D = <iframe /wv/<id>/?embed=1>        │ 값 · 근거 · 영향                   │
│                  │  (│ 계산 시트 — 3D 옆, 끌어서 너비)       │ [편집 줄 — 편집 상태만]            │
│                  ├────────────────────────────────────┤                                │
│                  │ 표 서랍(반력 · 변위 · 부재력 · 검토표 · 대안 비교) │ ● Claude 가 보는 선택  부재 M14     │
└──────────────────┴────────────────────────────────────┴────────────────────────────────┘
 상태 표시줄: 글 · 잠깐 뜨는 글 · 마지막 호출
```

- `ui/index.html`(34줄) 그대로: `#tbar` · `.pbar` · `#review`(`#left` · `.center`(`#v3` · `#vsplit` · `#sheet` · `#drawer`) · `.right`(`#info` · `#editbar` · `#share`)) · `#startScreen` · `#status`.
- 1100px 보다 좁은 창: 트리와 정보 중 하나(템플릿 README), 시트는 3D 아래. 시험 960px 스크린샷.
- 트리 탭과 가지(midas Gen Tree Menu 의 탭 + Works Tree 를 따름. Menu Tree(명령)는 버림 — 그 일은 Claude 에게 말로):

| 탭 | 가지 |
|---|---|
| 업무 | 판단 요청(답 없는 수, 주황) · 지시 · 보고 · (있으면) 요청 · 변경(기준점마다 「해석 #2 이후 3」 · 「보고 R-1 이후」 · 「발행 R1 이후」) · 점검 |
| 모델 | 재료 · 단면 · 절점 · 부재(기둥 · 보 · 가새) · 지점 · 하중 케이스 · 하중 · 하중조합 · 가정(상태별) |
| 결과 | 해석(실행 이력 #n) · 표 · 부재 검토(NG · 미검토 · OK, 「확인 n/N」) · 대안 · (있으면) 보강 시나리오 |
| 문서 | 원자료(도면 · 사진) · 성과품 · 발행(R1, R2 …) |

- 한 줄 = 이름 + 오른쪽 끝 개수(또는 상태). 접힌 채 시작, 500줄씩 그림. 키보드 ↑↓←→ Enter, Ctrl+F 찾기.
- **우클릭 메뉴**(`ui/src/ctxmenus.ts` 226줄 · `menu.ts` 81줄): 트리 줄 · 3D 개체/빈 곳 · 표 줄 · 편집 상태. 같은 개체는 트리와 3D 에서 같은 메뉴. 들어가는 것은 **보는 일**(선택에 맞춤 · 계산 시트 · 표에서 보기 · 트리에서 찾기 · 복사)과 확인 표시뿐. 값 수정 · 재해석 · 대안 만들기는 넣지 않는다 — 메뉴가 요청 양식이 되면 안 된다(결정 표 마지막 줄).
- **시작 화면**(`start.ts`): 프로젝트 목록(뿌리 폴더 + 최근 연 것, 누르면 `open_project`) + Claude 연결 상자.
- **편집 상태**(F2, `edit.ts` 137줄): 다리 정책 `mode:'edit'` → 3D 웹뷰의 기능 메뉴(모델 · 속성 · 하중) · 도구 줄 · 명령줄 · 대화상자 · 단축키 · 그립 끌기 · 우클릭이 그대로 돈다. 제목 표시줄 · 3D 테두리 주황, 창 제목 `● 파일 · 편집 — StAnal`, 오른쪽 아래 「이번 편집 n」 · 「편집 마치기 F2」 · 「버리기」. 「버리기」는 들어올 때의 **모델 내용 해시**까지 실행 취소를 한 번씩 하며 매번 해시 확인, 한도는 편집 중 늘어난 실행 취소 깊이, 편집 중 Claude 가 바꾼 것이 있으면 하지 않는다. Electron 메뉴 「보기 › 편집 상태」도 같은 길(화면에 F2 를 넣음).
- **호스트의 물음**(`dialogs.ts` 187줄): 알림 단추 · 고르기 · 입력 · 파일, 진행 띠, 잠깐 뜨는 글.

### 4.3 데이터 길과 상태

- `ui/src/bridge.ts`(69줄): `api(method, path, body)` — `fetch(credentials:'same-origin')`, `mcpGet('model/summary')` = `GET /api/mcp/model/summary`, `view(body)` = `POST /api/view`, `lastMessage(type)` = `/api/surface/last?type=&optional=1`, `connectEvents()` = `EventSource('/api/events')`.
- `ui/src/store.ts`(604줄): 화면 상태 한 곳. 모델 = `/api/surface/model`(호스트가 3D 에 보낸 `SerializedModel`), 판정 = `design:ratios`, 해석 상태 · 반력 · 부재력 = MCP `analysis/results`, 점검 = MCP `board`, 대안 = MCP `scenarios`, 프로젝트 기록 = MCP `project/*`. 사건(`model:sync` · `model:patch` · `analysis:result` · `results:reset` · `design:ratios` · `file:info` · `collaboration:receipt`, `work:changed`, `review:changed`, `issue:changed`) 뒤 0.45 – 0.6 초에 다시 읽는다(BRIDGE.md 각 절의 「화면이 다시 읽는 때」). 「문서」 탭은 열 때와 15초마다(밖에서 바뀐 파일).
- 프레임워크 · 가상 DOM 없음. `emit/on` 으로 부분을 다시 그린다(`main.ts`).
- 화면이 제품의 순수 함수를 가져다 묶는다: `shared/modelTypes`(형), `shared/DesignRatioBands.ts`.

### 4.4 기술 · 크기

| 항목 | 내용 |
|---|---|
| 언어 · 틀 | TypeScript, **프레임워크 없음**(결정: 저장소의 웹뷰 · 템플릿과 같은 방식, 의존성이 늘지 않는다) |
| 묶기 | esbuild — `src/main.ts` → `dist/main.js` 한 파일, ESM, `target chrome110`, sourcemap(`ui/build.mjs`). 다리 CSP 가 `script-src 'self'` 라 인라인 스크립트 없음 |
| CSS | `style/app.css` 한 파일 380줄. 토큰(`--bg-app #181818` …), 어두운 테마 기본 · `<html data-theme="light">` 로 밝은 테마. 글꼴은 `var(--font)` / `var(--mono)`(숫자 `tabular-nums`) |
| 3D 테마 | `--vscode-*` 변수를 다리가 주입(Segoe UI · Malgun Gothic · Consolas), `?theme=light` |
| 크기 | 소스 TS 약 5,950줄(main 736 · tree/data 643 · store 604 · info/ 8파일 1,314 · sheet 361 · tree/view 337 · table 246 · ctxmenus 226 · titlebar 220 · view3d 209 · dialogs 187 · format 150 · edit 137 · viewstate 93 · fit 86 · menu 81 · start 69 · bridge 69 · dom 53 · tips 47 · refs 43 · classify 39). 설치본의 `ui/` 약 0.2 MiB(230 KB) |
| 시험 페이지 | `ui/dev/embed-test.html` · `.js`(3D 만 끼운 단순 페이지 — 화면이 없을 때 다리의 기본 진입) |

### 4.5 화면 템플릿 10장(`desktop/design/`, 정적 HTML · 1920×1080 스크린샷)

공통: `assets/shell.js`(369줄 — 제목 표시줄 · 트리 내용 `trees()` · 우클릭 메뉴 `MENUS` 15종 · 풍선 · 3D 자리 그림), `assets/app.css`(146) · `review.css`(267). 점선 「예시」 = 지어낸 수치, **보라색 점선 칸 = 엔진이 저장하지 않는 값**(화면을 고쳐서는 못 채운다).

| 장 | 내용 |
|---|---|
| `00-start` | 프로젝트 표(이름 · 기준 「기존안 · 해석 #7 / 지금 모델과 일치」 · 다음 판단 「판단 요청 1」 · 마지막 작업 · 누가) + 「폴더에서 열기」 「새 프로젝트」, 오른쪽에 Claude Desktop 연결 세 단계(설정에 등록됨 [연결] · 다시 시작 · 마지막 호출). 모델 파일만 열기 링크 |
| `01-work` | 업무 › 판단 요청 「주각의 구속조건을 무엇으로 볼까요」. 정보 창: 질문 · AI 설명 · 근거(원자료 S-201 · 가정 A-03 임시 · 대상 · 걸린 범위) · AI 가 미리 본 경우(고정 0.31 / 핀 0.58 표) · 답 「아직 없음」. 「Claude 가 보는 선택」 풍선을 펼쳐 둔 유일한 장 |
| `02-changes` | 업무 › 변경. AI 와 사람의 변경이 같은 목록, 「지난 보고 이후」 기준점, AI 가 작업 중인 모습. 정보 창: 누가 · 왜(reason) · 바뀐 것 표 · 해석 입력 바뀜 · 영향 |
| `03-inputs` | 모델 › 가정 A-03. 서술 · 상태 꼬리표 · 근거 · 원자료 · 적용 범위(누르면 3D) · 지금 값 · 이력. 우클릭 메뉴 펼친 모습 |
| `04-analysis` | 결과 › 해석 #7. 무엇으로 돌렸나(모델 상태 · 종류 · 조합 · 실행 주체 · 엔진) · 평형 검산 · 경고 |
| `05-members` | 결과 › 부재 검토 › M14. 3D 에 판정비 색 + 고른 부재 강조 + Lb 표시, 정보 창 머리(OK 0.055 · 지배 조합 · 미검토 1 · 확인 □), 설계 가정과 출처 꼬리표(기본값 · AI), 한계상태 표(소요 / 설계강도 · 판정비, 「계산 시트 →」). 우클릭 메뉴(선택에 맞춤 F · 이것만 보기 I · 숨기기 H · 계산 시트 Enter · 표에서 보기 · 트리에서 찾기 · 확인 표시 Space · 이름 복사). 960px 판 `05-members-960.png` |
| `06-member-sheet` | 3D 옆(약 1/3 : 2/3)의 M14 계산 시트: 1 부재와 가정(단면 성능 · 설계 가정과 출처) · 2 소요강도(항목 · 조합 · 위치) · 3 한계상태별 계산(절마다 조항 · 구간 · 식 · 대입 · 설계강도 · 판정, 지배 절 펼침, 미검토 절) · 이전/다음 부재 · 시트 닫기 |
| `07-alternatives` | 결과 › 보강안 A. 무엇이 다른가(파생 출발 상태 대비 단면 · 개체) · 안별 비교(최대 판정비 · NG · 미검토 · 강재량 · 최대 변위) · 부재별 이전 → 이후 · 영향. 수치는 모두 예시 |
| `08-deliverables` | 문서 › 성과품 › 구조계산서. 가운데 문서 미리보기(쪽 썸네일 · 설계 가정 · 부재 검토표), 정보 창: 상태 초안 · 대상 안 · 근거 해석 · 발행을 막는 것 n(미검토 · 검토 기록 · 열린 판단 요청 · 밝히지 않은 임시 가정 · 도면 대응 · 사후 확인) · 발행본에 묶이는 것(→ `04_발행본/R1/`) · 「R1 발행」(꺼짐) |
| `09-edit` | 편집 상태(F2): 주황 테두리, 위 도구 줄(그리기 절점/부재 · 고치기 이동/복사/삭제/분할 · 스냅 · 격자 · 작업 평면), 3D 에 이번 편집에서 더한 부재(초록 점선), 편집 우클릭(이동 · 복사 · 분할 · 삭제 · 단면 바꾸기 · 단부 해제 · 속성), 명령줄 「> 부재 › 시작 절점」, 정보 창 형상 입력 · 「이번 편집 2」 · 「AI 변경 거부됨」 · 「편집 마치기 F2」 「버리기」 |

템플릿과 구현이 다른 곳: 템플릿 08 은 미검토를 막는 쪽에 두었으나 구현은 **경고**(안전성 검토는 NG 결론을 담아 발행하는 것이 정상), 09 의 정보 창 입력 칸은 구현에 없음(편집은 3D 웹뷰의 대화상자로), 05 의 「이것만 보기 · 숨기기」는 빠짐(3.4 끝), 06 의 3D 검토 위치 표시 · 이전/다음 단추 · 단부 조건 칸은 만들지 않음.

이전 판: `Ref/design_review_first_ui/`(VS Code 틀, 8장, 1600×1000) — 렌즈 탭 7개 + 목록 + 상세 양식 + 「AI 에게 보내기」. 사용자 지적 셋(오른쪽이 정형 양식이라 정해진 답만, 왼쪽이 한눈에 안 들어옴, 설명이 너무 많음)으로 지금 판으로 바뀌었다(방향 문서 다섯 번째 고침).

---

## 5. 일하는 방식과 프로젝트 기록 층

### 5.1 사람과 AI 의 나눔(방향 3.7 · 5.3 · 9.2)

- 직원: 모니터 하나에 StAnal(전체 화면, 1920×1080 에서 트리 280 + 정보 380 + 3D 약 1,260px), 다른 모니터에 Claude Desktop(Cowork). 모니터가 하나면 반쪽(약 960px)도 받는다.
- AI 가 하는 것: 모델링 · 해석 · 부재 검토 · 계산서 초안 · 대안 만들기, 보고 · 판단 요청 남기기, 사용자의 답을 **원문 그대로** 기록, "여기를 보세요"(`focus`).
- 사람이 하는 것: 대화(지시 · 답 · 수정 요청 · 이의), StAnal 에서 보고 고르기, 확인 표시, 발행, 필요하면 편집 상태에서 직접 그리기.
- Cowork 의 결과(9.2): Cowork 는 격리 환경에서 연결한 폴더를 `/sessions/…/mnt/<폴더>` 로 본다 → **경로를 주고받지 않는다**. 프로젝트는 이름으로(`open_project`), 파일은 프로젝트 폴더 기준 상대경로로. MCP 응답에 절대경로를 넣지 않는다. Cowork 에 프로젝트 폴더를 연결하면 AI 가 원자료를 직접 읽는다(그래서 MCP 는 작은 글 파일만 준다).
- MCP 는 AI 가 묻는 방향으로만 흐른다 — 화면에서 무엇을 눌러도 AI 가 깨어나지 않는다. 사람이 대화창에서 한마디 해야 한다.
- 프로젝트 뿌리: 설정 `structFem.projects.root` → `STANAL_PROJECTS_ROOT` → Windows `문서\StAnal 프로젝트`(macOS 개발판은 userData 아래 — 문서 폴더 권한 물음 회피). 프로젝트 이름 = 폴더 이름(NFC, 대소문자 무시).
- 프로젝트 폴더: `stanal-project.yaml`(선언 — 만든 뒤 프로그램이 다시 쓰지 않는다) · `01_원자료/` · `02_구조모델/*.sfem` · `03_설계문서/` · `04_발행본/R<n>/` · `.stanal/`(프로그램만 쓴다). 선언 파일이 있을 때만 기록 층이 켜진다(없으면 확장 동작 그대로).

### 5.2 기록 층(공용 코드 `src/project/`, 24파일 약 7,000줄 — `desktop/` 밖)

모든 기록은 **덧붙이기만 하는 JSONL**(SQLite 아님 — native 의존성 없음, AI 와 사람이 도구 없이 읽음, git 으로 차이, 쓰는 주체는 호스트 하나라 잠금 불필요). 지금 상태는 사건 줄을 접어서 얻는다. 개체는 `{kind, id, uid?}` + 모델 상태 해시로 가리킨다.

| 기록 | 파일 · MCP | 무엇 | 일반성 |
|---|---|---|---|
| 프로젝트 선언 · 경로 규칙 | `stanal-project.yaml`, `projectPaths.ts` · `ProjectDeclaration.ts`, MCP `open_project` · `get_project_status` | 이름 · 설계 기준 · 폴더 역할. 새 대화의 AI 가 먼저 부르는 상태 요약 | **일반** |
| 실행 기록(runs) | `.stanal/runs/<n>/run.json` · `design.json` · `design.demand.json.gz` · `design.calc.json.gz` · `result.json.gz`, `.stanal/snapshots/<해시>.sfem` | 해석에 쓴 모델 상태 사본 + 무엇으로 돌렸나 + 평가 결과. 다시 열면 "해석 #n 과 일치"이고 결과 · 판정을 **저장본에서** 복원(다시 계산하지 않는다 — 솔버의 동시발생 부재력이 새 프로세스에 없어 판정이 달라졌다: M5 1.043 → 1.050) | **일반**(무엇을 저장하나는 제품별) |
| 변경 묶음 | `.stanal/changes.jsonl`, MCP `list_changes` | 확정마다 직전 · 지금 모델을 **개체 단위로 비교**(명령 문장을 해석하지 않는다). 행위자(gui · mcp+클라이언트 이름 · external · project), 이유, 기준점(해석 · 보고 · 발행), 바뀐 필드 이전 → 이후, 사람 말 제목 「절점 N22 · Fz 0 → −5」. 끊는 규칙: MCP 요청 문맥 + 영수증 + 0.4초 조용함 + undo 깊이. 값의 출처(AI 선언 · 사용자 · 가져옴 · 기본값)는 따로 저장하지 않고 여기서 계산 | **일반**(모델 비교기는 제품별) |
| 업무 항목 | `.stanal/work.jsonl`, MCP `work_items` | 지시(I-n, 사용자 말 원문) · 보고(R-n, 항목별 완료/가정하여 입력/미결 + 개체 참조) · 판단 요청(Q-n, 질문 · 선택지별 결과 · 걸린 범위 — 그 범위만 멈춤) · 요청(U-n). 답은 사용자의 말 원문. 기준 모델 상태가 지금과 다르면 표시. 본문 8,000자 넘으면 거절(자르지 않음) | **일반** |
| 가정 등록부 | `.stanal/assumptions.jsonl`, MCP `assumptions` | 서술 · 근거 · 원자료 참조 · 적용 범위(개체 + 필드) · 상태(확정 · 임시 · 현장 확인 필요 · 해당 없음) · 영향. 가정문서(Markdown)의 원본 | **일반**(범위의 개체 종류는 제품별) |
| 원자료 | `.stanal/sources.jsonl`, MCP `sources` | 도면 · 사진 등을 id + sha256 으로 등록, 바뀜 · 옮겨짐 · 없어짐 · 등록 안 됨 | **일반** |
| 확인 표시 | `.stanal/reviews.jsonl`(화면만 씀 — `POST /api/review`) | 부재별 확인 · 취소, 검토자(설정 → `STANAL_REVIEWER` → OS 사용자). 1단계: 해석 입력 해시 + 설계 입력 해시 + 모델 경로가 바뀌면 「다시 확인」. 2단계: 재해석 뒤 부재별 입력 지문과 판정이 같고 소요 · 내력이 상대 1e-6 안이면 되살림(`revive` 줄) | **일반**(지문 정의는 제품별) |
| 대안 | `.stanal/alternatives.jsonl`, MCP `alternatives` | 안 = 모델 파일 하나, 파생 관계는 사건 줄. 비교는 모델 둘을 열지 않고 실행 기록 둘의 `design.json` 을 부재로 맞춘다 | 개념은 **일반**, 비교 내용(부재별 판정비 · 강재량 · 변위)은 골조 해석 쪽 |
| 성과품 · 발행 | `.stanal/deliverables.jsonl`, MCP `deliverables`(list · get · check · draft · register — issue 는 없음), `04_발행본/R<n>/`(문서 · 모델 사본 · run · design · 가정 · 확인 · 원자료 요약 · `manifest.json` 해시) | 초안의 「낡음」은 모델 **내용** 해시로. 발행 전 점검: 막는 것(저장 안 한 변경 · 재해석 필요 · 검토 기록 없음 · 낡은 초안 · 열린 판단 요청 · 밝히지 않은 임시 가정 · 원자료 바뀜 · 지난 발행과 같음) / 경고(NG · 미검토 · 확인 진행 · 밝힌 임시 가정). 차수 폴더는 배타적으로 만들고 덮어쓰지 않는다. 프로젝트 묶음 zip 내보내기 | **일반**(점검 항목 일부는 제품별) |
| 계산 과정(부재 계산 시트) | `runs/<n>/design.calc.json.gz`, MCP `get_member {calc:true}` | 판정 뒤 지배 상태를 같은 함수로 한 번 더 돌려 단계(기호 · 식 · 대입 · 값 · 출처)를 기록. 판정과 **비트까지 같을 때만** 붙인다. 판정 결과 · 지문은 그대로 | 생각은 **일반**, 내용은 설계 엔진별(StCFSD 는 AISI S100 단계가 된다) |
| 개체 uid | 파일 형식 1.12, `src/project/entityResolve.ts` | 이름 변경 · 재번호 · 분할에도 기록이 같은 개체를 가리키게. `u` + Crockford base32 20자, 호스트만 만든다, 사람 · AI 에게 숨김, 지문에서 뺀다. 옛 파일은 `kind:id` sha256 으로 결정적 | **일반**(모델에 개체 id 가 있으면) — 절점 · 요소가 다시 번호 매겨지는 StCFSD 에도 해당 가능 |
| 화면 상태 · 여기를 보세요 | MCP `get_view` · `focus`, 다리 내장 명령 | 사람이 보는 것을 AI 가 읽기, AI 가 화면을 가리키기(따라가기 규칙) | **일반** |

D-3 까지가 기록 갈래다. 모두 확장에도 들어가는 공용 코드이고, 확장에는 이 기록을 보이는 화면이 없다(`webview/components/featureRegistry.ts` 에 "MCP 전용" 사유로 등록 — 기능 장부 시험).

---

## 6. 껍데기와 설치 파일

### 6.1 Electron 껍데기(`desktop/shell`, 1,316줄)

| 항목 | 값 |
|---|---|
| 판 | Electron **45.2.3**(Node 24.22.2 · Chromium 156), 자체 `package.json`(`stanal-shell`, `productName: StAnal`, devDeps electron · electron-builder 26.18.0 · @electron/fuses 2.1.3 · esbuild · typescript). 확장 · 호스트의 의존성에 섞이지 않게 |
| 시작 순서 | 단일 인스턴스 잠금 → 로그 → 파일 · Python 확인 → `prepareHostEnvironment` → 플랫폼 → `startHost` → `startBridge` → 메뉴 · 창. 단계마다 실패하면 단계별 오류 창(로그 경로 포함, `STANAL_SHELL_FATAL` 한 줄을 stderr 로) 뒤 끝(`main.ts:4-5`) |
| userData | `%APPDATA%\StAnal`(`app.setPath('userData', …)`, `STANAL_USER_DATA` 로 바꿈). 호스트의 userData 는 그 아래 `host/` |
| 창 | `BrowserWindow{ show:false, minWidth 900, minHeight 600, backgroundColor '#1f1f1f', autoHideMenuBar:true, webPreferences{ session, preload, contextIsolation:true, sandbox:true, nodeIntegration:false, nodeIntegrationInSubFrames:false, webSecurity:true, webviewTag:false, spellcheck:false, devTools: DEV, backgroundThrottling: !TEST } }`, `ready-to-show` 에서 `show()`(`:414-474`) |
| 창 지키기 | `will-navigate` · `will-frame-navigate` · `will-redirect` 를 다리 출처 밖이면 막고 웹 주소는 외부 브라우저로, `will-attach-webview` 막음, `setWindowOpenHandler` → deny(`:276-295`). 권한은 `clipboard-sanitized-write` 만 |
| 인증 | 1.5 「Electron 인증」 — 쿠키 0개(시험이 센다). macOS 는 늘 `--use-mock-keychain`(`:44`) |
| 포커스 | 1 「포커스를 가져가지 않는다」. Windows 포그라운드 잠금 때문에 다시 실행했을 때 작업 표시줄만 깜빡일 수 있다 — 필요하면 `setAlwaysOnTop(true); focus(); setAlwaysOnTop(false)` 우회(README 확인 2, 미확인) |
| 창 위치 | `userData/window.json`(위치 · 크기 · 최대화 · 모니터), 모니터가 없어졌으면 주 모니터 가운데(`windowState.ts` 88줄). 0.5초 모아 저장 |
| 닫기 | dirty 면 저장 / 저장 안 함 / 취소. 저장은 `structFem.saveCurrentFile` 을 부르고 그 뒤 `dirty === false` 로 판단(대화상자 취소면 안 닫음) |
| 메뉴 | 파일(열기 Ctrl+O · 저장 Ctrl+S · 다른 이름 · 끝내기) · 편집(역할 메뉴) · 보기(편집 상태 체크 F2 — `registerAccelerator:false`, 새로 고침, 개발자 도구(DEV), 확대/축소) · 도움말(로그 폴더 열기 · 정보). Windows 는 Alt 를 눌러야 보인다. 메뉴의 파일 일은 웹뷰 파일 메뉴와 같은 길(`file:*` 를 표면에서 온 것처럼) |
| 모델 열기 | `--open` · 두 번째 실행 · 파일 연결 → 호스트 MCP HTTP `POST /model/open`(`X-StAnal-Request-Id` 없이) — dirty 면 먼저 묻고, 저장 안 함이면 `force:true` |
| 다리 사건 | `bridge.on()` 으로 `file:info`(창 제목 · dirty) · `surface:policy`(편집 상태) — 웹뷰 허브를 직접 듣지 않는다(D7 정리). 다리가 뜨는 동안 난 사건은 `bridge.events.recent()` 로 먼저 |
| 로그 | `userData/logs/main-<날짜>.log`, 8 MiB 넘으면 `.1.log`, 14일 · 합 64 MiB 넘는 것 지움. 터미널에는 껍데기 줄과 경고 · 오류만(`log.ts` 142줄) |
| preload | `window.stanalShell = { isElectron, platform, version }` 만(17줄). 화면은 이것 없이도(브라우저) 돈다 |
| 껍데기 환경 변수 | `STANAL_REPO_ROOT` · `STANAL_USER_DATA` · `STANAL_PYTHON` · `STANAL_CLAUDE_CONFIG` · `STANAL_SHELL_ENTRY` · `STANAL_THEME` · `STANAL_SHELL_TEST` · `STANAL_PROJECTS_ROOT` |

### 6.2 설치 파일(`desktop/installer`, 스크립트 783줄 + 시험 554줄)

| 항목 | 값 |
|---|---|
| 도구 | electron-builder 26.18.0, NSIS(`toolsets: { nsis: '1.2.1' }` = makensis 3.12 — 기본 3.0.4.1 의 macOS makensis 가 x86_64 전용이라 Apple Silicon 에서 막힘), wine 불필요(아이콘 · 버전 정보는 `resedit`) |
| 형식 | NSIS x64, `oneClick` · `perMachine:false` · `allowElevation:false` → `%LOCALAPPDATA%\Programs\StAnal`(관리자 권한 없음), 한국어(`ko_KR`, 1042), 유니코드, 바로 가기(시작 메뉴 · 바탕 화면), 파일 연결 `.sfem` · `.stanal5`, `deleteAppDataOnUninstall:false`, `runAfterFinish`, 서명 없음(SmartScreen 「추가 정보 › 실행」), 자동 업데이트 없음(`publish: null`, 덮어 설치), `appId: 'local.stanal.desktop'`(**바꾸지 말 것** — 설치 GUID 의 근원) |
| 배치 | `resources\app.asar`(껍데기 `dist/main.js` · `preload.js` · `host/index.js` — 6항목) · `resources\app-root\`(asar 밖 — 확장 배포물 `.vscodeignore` 246개 그대로, 호스트의 repoRoot, `mcp-server/` 포함) · `resources\ui\`(asar 밖) · `resources\python\`(asar 밖). asar 밖의 까닭: Python 이 읽는 파일, Claude 설정에 적는 MCP 서버 경로는 실제 파일이어야 함, ESM `"type":"module"` 판정, 다리의 `realpath` 경로 검사 |
| 퓨즈 | **건드리지 않는다** — `RunAsNode` on(Claude Desktop 의 MCP 서버 · 계산서 CLI 가 기댐), `OnlyLoadAppFromAsar` off. 시험이 `@electron/fuses` 로 확인 |
| 단계 | `stage.mjs`(329줄 — 빌드 확인 · 출처 검사, `.vscodeignore` 를 읽어 고르고 `vsce ls --no-dependencies` 와 대조, `manifest.json` 에 sha256) → `python.mjs`(305줄) → `build.mjs`(59줄, `--win` · `--win --dir` · `--mac`) |
| Python 묶음 | **uv 만**(pip 를 부르지 않음, 저장소에 `.venv`/`pyproject.toml` 을 만들지 않음): `uv python install cpython-3.12.16-windows-x86_64-none --install-dir build/uv-python --no-bin --no-registry --no-config` + `uv pip install --target …/Lib/site-packages --python-platform x86_64-pc-windows-msvc --python-version 3.12 --only-binary :all: --link-mode copy --no-config -r pynite/requirements.lock -r …/requirements.lock`. python-build-standalone `install_only_stripped`(재배치 가능, vcruntime 포함). 확인: 잠금 판 = dist-info, 휠 태그 `win_amd64`/`any`, `.so/.dylib` 0, numpy `.pyd` 19개 `cp312-win_amd64`. 뺀 것 75항목 40.1 MiB(헤더 · Tcl/Tk · idlelib · ensurepip · `_test*.pyd` · 모든 `tests/` · `bin/` · `share/`). 표준 라이브러리 `__pycache__` 는 남김. `STANAL_PYTHON.json` 에 출처 · 판 · 뺀 것 |
| 크기(0.1.0) | 설치 파일 **186.7 MiB**(마지막 재빌드 186.8), 설치 폴더 585.2 MiB = Electron 약 309(`StAnal.exe` 238) + Python 245.0(파일 5,047, scipy 88 MB) + app-root 30.7 + ui 0.2 + asar 0.2. 경로 최장 120자(+ 설치 폴더 60 < 260) |

### 6.3 사람이 Windows 에서 확인할 것(남은 일)

Windows 에서 **한 번도 실행하지 않았다**(개발 PC 는 macOS arm64). `installer/README.md` 「처음 확인할 것」 1–10 과 `shell/README.md` 「Windows 에서 사람이 확인할 것」 1–11:
설치(UAC 안 뜸 · 한국어 · 바로 가기) · 실행 로그 첫머리(배치 installed · Python 3.12.16 · 콘솔 숨김) · `.sfem` 파일 연결과 포그라운드 잠금 · 해석 때 **검은 콘솔 창이 안 뜨는가**(numpy · scipy DLL 로딩, 한글 사용자 이름 경로) · 「연결」 → `claude_desktop_config.json` 항목 · Claude Desktop 재시작 → `stanal` running, `%APPDATA%\Claude\logs\mcp-server-stanal.log` · 대화로 해석(포커스는 Claude 에 그대로) · 끄고 다시 켜면 Claude Desktop 재시작 없이 답 · 덮어 설치 · 제거(`%APPDATA%\StAnal` 남음, Claude 설정의 `stanal` 항목도 남음) · Defender/SmartScreen 의 `ELECTRON_RUN_AS_NODE` 반응 · 방화벽 경고 없음(루프백) · 모니터 두 대 · 배율 125/150 % · 대화상자의 한글 · `D:\` · `\\server\` · MSIX 판 설정 위치 · Cowork 가 로컬 MCP 를 쓰는 방식.

---

## 7. 빌드와 시험

### 7.1 빌드

| 명령 | 하는 일 |
|---|---|
| 저장소 루트 `npm run build` · `npm run build:mcp` | 확장 번들 `dist/extension.js` · 웹뷰 · MCP 서버 — **먼저 돼 있어야 한다** |
| `desktop/ npm run build` | `host/build.mjs`(esbuild: `index` · `headless` · `serve` → Node 20 CJS 한 파일씩, 확장 번들은 묶지 않음 — 실행 때 require) + `ui/build.mjs` |
| `desktop/ npm run typecheck` | `tsc --noEmit -p tsconfig.json && -p ui/tsconfig.json` |
| `npm run headless -- --open <모델> [--app-dir]` | 화면 없이. MCP 주소와 클라이언트 줄(`STANAL_MCP_PORT_FILE=… STANAL_MCP_STANDALONE=1 node …/mcp-server/dist/index.js`)을 출력 |
| `npm run serve -- --open <모델> [--claude-config] [--app-dir]` | 호스트 + 다리, `?t=` 붙은 주소 출력 — 보통 브라우저로 화면이 열린다 |
| `desktop/shell npm start` / `npm test` / `npm run test:unit` | 창 / 숨긴 창 시험 / `winConsole` 단위 시험 |
| 설치 파일 | `node desktop/installer/stage.mjs && node desktop/installer/python.mjs && node desktop/installer/build.mjs --win`, 확인 `test/verify-win.mjs`, macOS 실행 확인 `build.mjs --mac` + `test/packaged.mjs [--paren-path]` |

### 7.2 시험 장치

- 시험 파일은 전부 **의존성 없는 `.mjs` 스크립트**(jest 아님). `makeCheck()` 가 `통과/실패  이름 — 자세한 것` 을 찍는다(`ui/test/helpers.mjs`). 스크린샷은 `test/out/*.png`(추적 안 함), 사람(오케스트레이터)이 눈으로 본다.
- 화면 시험: 저장소 루트의 `playwright-core` + **이 PC 의 Chrome**(`chromium.launch({ channel:'chrome', headless:true, args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist'] })`) — 3D WebGL 을 소프트웨어로 그린다. 호스트 + 다리를 시험 프로세스 안에서 띄운다.
- 창 시험: `playwright-core` 의 `_electron.launch` + `STANAL_SHELL_TEST=1`(show:false, dock 숨김, 가짜 키체인, 대화상자는 "취소"로 답하는 가짜, `globalThis.__stanalShell` 진단 객체 — 포커스 · show · restore 사건 수, 막은 요청, 닫기 물음 등).
- 격리 규칙: 모델은 **임시 폴더 사본만**(D1 에서 명령을 모두 실행해 보다가 저장소의 `test/codextest01.sfem` 을 덮어쓴 사고 뒤), userData · Claude 설정 · 광고 폴더 · 프로젝트 뿌리 모두 임시 폴더. 끝난 뒤 남은 프로세스 · 광고 파일 0 을 센다.
- 숫자 대조형 시험이 많다: 트리 개수 = MCP, 98개 부재 판정비 전수 일치, 표 줄 수 = MCP, 시트 = MCP = 정보 창, 오른쪽 창 컨트롤 0개, 안내 문장 0개, uid 가 DOM 에 0번.

### 7.3 시험 수(작업문서 검토 기록의 마지막 수)

| 부분 | 파일(항목 수) |
|---|---|
| 호스트 13 | `smoke` 25(활성화 49 ms · 명령 98 · 실제 솔버 · 저장/다시 열기 · 미구현 0 · 남은 핸들 0) · `bridge` 50(웹뷰 ready → model:sync · CSP 위반 0 · 캔버스 141색 · 선택 왕복 · 거부해야 할 요청 14가지) · `paths` 11(괄호 · 따옴표 설치 경로) · `connect` 63 · `project` 36 · `changes` 25 · `work` 39 · `records` 47 · `alternatives` 43 · `deliverables` 43 · `sheet` 29 · `legacy` 28(uid 이전 빌드로 만든 프로젝트 고정물 1.1 MB) · `uid` 33 |
| 화면 9 | `ui`(+`edit`) 76 · `project` 25 · `changes` 22 · `work` 32 · `records` 43 · `alternatives` 26 · `deliverables` 32 · `sheet` 31 · `uid` 17 |
| 껍데기 | `shell` 62(0 Python 없음 · 1 창 · 2 쿠키 0/토큰 없는 주소/머리 없는 요청 401 · 3 MCP 해석 중 포커스 사건 0 · 4 가짜 대화상자로 열기 · 5 두 번째 실행 · 6 창 크기 · 없는 모니터 · 7 닫기 세 답 · 8 SIGKILL 뒤 낡은 광고 · 9 RunAsNode MCP 서버 · 10 편집 상태) · `winConsole` 14 |
| 설치 | `verify-win` 32 · `packaged` 39(+ `--paren-path` 39) |

### 7.4 단계마다의 관문

각 단계 뒤 오케스트레이터가 직접 돌렸다(작업문서 2 · 5절): 루트 `npm run typecheck`, 루트 `npx jest`(최종 920 스위트 · 12,754 시험), `npm run test:mcp-connection`(확장 연결 회귀), `npm run test:architecture`(시험이 제품 소스 글을 읽는 「소스 결합」 한도 166), **번들 크기 한도**(확장 본체 1,966,802 / 2,150,400 · 기록 조각 `dist/project-records.js` 170,436 / 204,800 · MCP 서버 708,472 / 870,400 · 호스트 합계 4,441,828 / 4,608,000 — 한도를 올리지 않고 `src/project/` 를 따로 읽는 조각으로 뺐다), `desktop npm test` 전부, `shell npm test`, 스크린샷 눈으로 보기, `git diff` 로 제품 코드 변경 줄 읽기. 확장 E2E(진짜 VS Code)는 돌리지 않았다. 엔진을 건드린 D-1 은 따로 맡긴 독립 검증(고치기 전 · 후 엔진 비트 비교, 숫자 449만 – 518만 개 중 차이 0).

---

## 8. 결정 · 되돌린 것 · 함정 · 남은 것

### 8.1 시도했다 되돌린 것

| 처음 | 바꾼 것 | 까닭 |
|---|---|---|
| S1 "호스트를 제자리에서 떼어 낸다"(방향 9.4) | 대체 모듈로 번들 그대로 | 3.5 |
| S2 "3D 를 공용 모듈로 뺀다" | 웹뷰 번들 iframe | 3.5 |
| 템플릿 첫 판: 렌즈 탭 7개 · 목록 + 상세 양식 · 「AI 에게 보내기」 · 판단 요청에 화면에서 답 · 상세 창에서 값 수정 | 탭 4개 트리 + 읽기 전용 정보 창 + 풍선 | 사용자 지적 셋(4.5 끝) |
| uid 를 지금 넣지 않는다(P1 결정) | U1 에서 넣음 | 사용자가 약한 곳(끝번호 재사용 · 분할 · 밖에서 고친 파일)을 듣고 지시. 그동안 쌓인 기록은 고쳐 쓰지 않고 읽을 때 잇는다 |
| 편집 상태 「버리기」 뺌(D3b) | B2 에서 모델 내용 해시로 넣음 | 되돌리는 것이 이번 편집의 것인지 해시로 확인 |
| 「이것만 보기 · 숨기기」(템플릿) | 뺌 | 호스트 명령이 3D 해석 결과를 버리고 파일을 「저장 안 함」으로 만든다 |
| 방향 문서 "쓰기 도구의 기대 리비전 필수" | 하지 않음 | 기존 사용을 깬다 |
| 템플릿 08 "미검토면 발행 막기" | 경고 | 안전성 검토는 NG 결론을 담아 발행하는 것이 정상 |
| 기록 층을 확장 본체에 | 별도 조각 `dist/project-records.js` | 번들 한도 |

### 8.2 함정과 교훈

| 함정 | 무슨 일 | 대응 |
|---|---|---|
| 경로 인코딩 | 설치 경로에 `)` · `'` 가 있으면 3D 가 안 그려짐 — 대체 모듈의 `Uri.toString()` 이 VS Code 와 달랐다 | VS Code `URI.toString()` 규칙(`! ' ( ) *` · `:` 인코딩, 드라이브 문자 소문자) + `host/test/paths.mjs`(`StAnal (시험)'s` 폴더). 다리는 `%2B` · `+` 둘 다 받는다 |
| MCP 서버 위치 짐작 | `detectRuntime()` 이 설치본 배치를 몰랐다 | `process.resourcesPath/app-root/mcp-server/dist/index.js`, 껍데기가 배치와 대조해 경고 |
| 키체인 물음 | macOS Chromium 이 쿠키 암호화로 키체인을 찾다 대화상자(사용자가 다른 프로그램에서 실제로 겪음) | 메모리 세션 + Bearer 머리, `--use-mock-keychain`, 통합 로그에 키체인 흔적 0 을 시험 |
| 클라이언트가 옛 호스트에 묶임 | 프로그램을 껐다 켜면 Claude Desktop 재시작 필요 | D5b 다시 붙기 + 막기 규칙 |
| pid 재사용 | 죽은 프로세스의 pid 를 다른 프로세스가 받으면 공용 광고 파일을 차지하지 못함 | 단일 인스턴스 잠금을 쥐면 pid 무관하게 지움 |
| 화면 조회가 "Claude 호출"로 셈 | 다리 · 껍데기가 같은 MCP HTTP 를 부름 | `X-StAnal-Request-Id` 를 보내지 않는다(MCP 클라이언트만 보냄) |
| 해시 안정성 | uid 를 지문에 섞으면 저장된 승인 기록이 한 번씩 「낡음」 | 지문 5곳에서 투영마다 `stripUid`, 일괄 무시 금지(다른 뜻의 `uid` 키). 굳힌 리터럴 64개로 증명 |
| 상태 해시 vs 내용 해시 | 저장만 해도 상태 해시가 바뀌어 초안이 거짓 「낡음」. 표시 상태(숨김)가 해석 입력 해시에 들어 있다 | 「낡음」 · 「밖에서 바뀜」은 **내용** 해시로, 옛 줄은 uid 뺀 상태 해시도 같은 것으로 |
| 결과를 다시 계산해 복원 | 솔버의 동시발생 부재력이 새 프로세스에 없어 판정이 달라짐 | 결과는 저장한다(`design.demand.json.gz`), 근거 없는 복원 위에서 검토 요청은 거절 |
| 판정비 표기 | 3D 범례 4.591 vs 정보 창 4.590, 요약 1.145 vs 1.146 | 제품 규칙 `formatVerdictRatioV1` 하나 |
| Windows 콘솔 창 | 확장의 `spawn(python.exe)` 에 `windowsHide` 없음 | 껍데기의 `child_process` 감싸기 + 제품 한 줄 |
| 작업 폴더 없음 | MCP 쓰기 정책이 "작업 폴더 또는 임시 폴더"라 계산서를 임시 폴더에만 | B1 프로젝트 폴더가 작업 폴더가 되게(적재기 3.1-6) |
| 활성화 알림 · 로그 홍수 | "확장이 활성화되었습니다" · 단면 DB 로그 수백 줄 | 껍데기 플랫폼이 거르고, 로그는 파일에만 |
| 화면 없을 때 MCP 화면 요청 | 스크린샷 · 보기 상태가 10초 뒤 실패 | 다리가 `webview:request` 50개를 쥐었다 `ready` 뒤 보냄 |
| modal 물음 | 화면이 그리지 않으면 호스트가 끝없이 기다림 | 화면이 반드시 그린다(시험) |
| 부재력도 조회 무한 고리 | 조회가 거절되면 해석을 다시 읽고 다시 조회 | 결과 하나에 한 번만 묻는다(`view3d.ts`) |
| 진짜 Claude 설정 | Claude Desktop 이 떠 있으면 스스로 고쳐 써서 시험이 거짓 실패 | 내용을 읽지 않고 흔적(키 이름 · 백업 파일)만 보고 판단 |
| 저장소 파일 덮어쓰기 | D1 에서 `structFem.saveCurrentFile` 이 저장소 모델을 덮어씀 | 이후 모든 지시에 "저장소의 모델 파일을 직접 열지 말 것" |
| macOS 에서 Windows 설치 파일 | NSIS makensis x86_64 전용 | `toolsets.nsis: '1.2.1'` |
| 문서 폴더 권한 | macOS 가 문서 폴더 읽기에 권한 물음 | 개발판 프로젝트 뿌리를 userData 아래로 |

### 8.3 열린 것 · 사람만 확인할 수 있는 것(작업문서 6절 · 7절)

- **Windows 실기 전부**(6.3), **진짜 Claude Desktop 에서의 사용**(AI 가 재시작 알림을 받고 `get_model_summary` 를 다시 부르는가, 업무 기록을 원문대로 쓰는가, `calc:true` 를 어떻게 쓰는가, 보내는 클라이언트 이름), **확장 E2E**.
- MSIX 설정 위치, Cowork 가 로컬 MCP 를 쓰는 방식, 회사 관리 설정이 로컬 MCP 를 막는가, Claude Desktop 이 떠 있는 동안 설정 파일을 되쓰는가.
- 제거해도 Claude 설정 항목이 남는다(NSIS `customUnInstall` 에서 `--disconnect-claude` 같은 단계 필요 — 미구현). 아이콘 없음(Electron 기본).
- 안내문(`INSTRUCTIONS`)에 "VS Code" 문구가 남음. 업무 기록 안내문이 열 줄쯤 늘었다.
- 성능 미측정: 큰 모델에서 SSE `model:sync`, 화면 사건마다 기록 재조회, 부재별 입력 지문. 편집마다 약 70 ms(부재 8,912 에서 약 210 ms)의 비교 작업이 호스트를 막는다 — 더 크면 워커.
- 같은 프로젝트를 두 프로그램이 함께 열면 묶음 순번이 겹칠 수 있다(방향 문서 3.2 의 잠금 파일은 없다).
- 결과 JSON 저장에서 NaN → null.
- 남은 큰 일: E(정리 — 중복 진입점 · 용어 통일). 커밋은 사용자가 말할 때만(작업문서 2절) — 지금 커밋 `c9582d8a` 하나로 묶였다.

---

## 9. 재사용 지도(두 번째 제품 기준)

판정: **일반**(거의 그대로 복사) · **조정**(같은 모양, 제품 내용만 바꿈) · **StAnal 전용**(해당 없음).
"이름"은 하드코딩된 StAnal 이름 · 경로 · 변수(바꾸면 되는 것).

### 9.1 `desktop/host/src`

| 파일 | 줄 | 판정 | 한 줄 까닭 · 하드코딩 |
|---|---|---|---|
| `vscode/events.ts` · `types.ts` · `commands.ts` · `unimplemented.ts` · `uri.ts` · `tree.ts` · `statusbar.ts` · `workspace.ts` | 113 · 139 · 57 · 52 · 190 · 81 · 88 · 134 | **일반** | VS Code API 흉내 그 자체. 제품 이름 없음 |
| `vscode/webview.ts` · `window.ts` · `configuration.ts` | 289 · 153 · 100 | **일반** | 같은 까닭. `configuration` 은 `package.json` `contributes.configuration` 을 읽으므로 제품에 맞춰 저절로 바뀐다 |
| `vscode/documents.ts` | 213 | **일반**(StCFSD 는 커스텀 편집기가 없어 덜 쓰임) | `.json` 이 아니면 languageId `yaml` 로 둔다 |
| `vscode/context.ts` | 94 | **일반** | 주석에 `.stanal` 만 |
| `vscode/index.ts` | 128 | **조정** | `env.appName 'StAnal'` · `machineId 'stanal-desktop'` · `uriScheme 'stanal'` · `version '1.95.0-stanal-shim'`, `<viewId>.focus` 내장 명령의 id 목록 `['structFem.panel','structFem.modelExplorer']` |
| `platform.ts` | 189 | **일반** | `HostPlatform` 인터페이스 + headless |
| `loader.ts` | 267 | **조정** | 갈고리 · 정리 · 컨텍스트는 일반. StAnal 전용: 활성화 끝 감지(`structFem.panel` 의 `setDelegate/showFailure`, `'[StAnal] extension core activation failed'`), `dist/extension.js` 경로, `structFem.mcpEnabled`, MCP 광고 파일 대기(`STANAL_MCP_PORT_FILE`, `stanal-mcp`), 최근 목록 키 `stanal.recentModels.v1`, `src/project/projectPaths` import, 가짜 파일 이름 `__stanal_vscode_shim__.js`, `structFem.projects.root` |
| `index.ts` | 12 | **일반** | 공개 API 목록 |
| `headless.ts` · `serve.ts` | 96 · 105 | **조정** | CLI 골격은 일반. `/model/open` 경로 · `structFem.mcpPort` · `mcp-server/dist/index.js` · `STANAL_*` 출력 |
| `bridge/http.ts` | 159 | **일반** | 토큰 · 쿠키 · 출처 검사 · 정적 파일. 쿠키 이름 접두 `stanal_bridge_` 만 |
| `bridge/sse.ts` | 121 | **일반** | 이벤트 흐름 · 다시 보내기 |
| `bridge/platform.ts` | 160 | **일반** | 물음을 이벤트로 · 답을 POST 로 |
| `bridge/theme.ts` | 137 | **일반**(목록 점검) | VS Code 기본 색. 웹뷰가 쓰는 `--vscode-*` 변수를 그 제품 소스에서 다시 grep 해 덮는다 |
| `bridge/zip.ts` | 83 | **일반** | 의존성 없는 zip 기록기 |
| `bridge/claude.ts` | 67 | **일반** | `/api/claude/*` 세 경로 |
| `bridge/inject.ts` | 277 | **조정** | 리소스 주소 고쳐 쓰기 · CSP · `acquireVsCodeApi` 대체 · 수신부 · 키 막기 · 정책은 일반. 숨김 선택자(`#dock` …) · 편집 선택자 · 기능 메뉴 분류 · 막을 메시지 종류(`command:execute` · `*:commit` …) · `stanal-edit` 클래스 · `sessionStorage` 키는 StAnal 웹뷰 DOM/메시지 전용 |
| `bridge/edit.ts` | 64 | **조정** | 정책 모양은 일반, 패널을 닫아 대화상자를 3D 안으로 보내는 기법은 StAnal 호스트의 갈래에 기댐 |
| `bridge/view.ts` | 142 | **StAnal 전용**(모양만 참고) | `__result_*` · `__select_entity` · `view:apply` 등 StAnal 웹뷰 명령으로 번역 |
| `bridge/screen.ts` | 86 | **조정** | `get_view` · `focus` · 업무 알림의 길은 일반. 명령 id `stanal.desktop.*` 과 `RecordLink`(확인 · 발행 · 안 열기) 모양은 제품 기록 층에 묶임 |
| `bridge/index.ts` | 703 | **조정** | 서버 · 라우팅 · 웹뷰 중계 · MCP 중계 · 물음 · 파일은 일반 뼈대. StAnal 전용: Designer 패널 고정(`openWithRedirect`, `structFemViewer`), `/api/review` · `/api/issue` · `/api/alternatives/open` · `/api/sources/open` · `/api/deliverables/open` · `/api/project/export` · `/api/edit/undo`(`structFem.undo`), 뜰 때 `GET /project/reviews`, `limit:mechanism` · `member:overlay` 다시 보내기, 큰 메시지 종류 |
| `claude/paths.ts` | 128 | **조정** | 로직 일반. `APP_DIR_NAME = 'StAnal'`, 파일 이름 `stanal-mcp-port` · `host-trace.jsonl` · `last-call.json` |
| `claude/connect.ts` | 540 | **조정** | 등록 · 백업 · 원자적 쓰기 · 분류 · 상태 · 광고 정리는 일반. `STANAL_MCP_PORT_FILE` · `STANAL_MCP_STANDALONE` · `STANAL_MCP_TRACE`, 백업 접미 `.stanal-backup-`, `vscode-launcher` 판별(`stanal-mcp.cjs`), `INSTALLED_APP_ROOT='app-root'`. **전제: 제품의 MCP 서버가 광고 파일 · 명시 포트 파일 · standalone 다시 붙기를 지원해야 한다** — StCFSD 는 지금 고정 포트라 그대로는 쓸 수 없다(3.6) |
| `claude/lastCall.ts` | 116 | **조정** | 전제: 제품 HTTP 서버의 계측 기록(`host.accept` 줄)과 MCP 클라이언트만 보내는 요청 id 머리 |
| `claude/registerConfig.ts` | 34 | **조정** | 제품의 등록 도우미를 require 하는 어댑터(StCFSD 는 `src/mcp/registration.ts` 가 다른 모양) |
| `claude/index.ts` | 15 | **일반** | 내보내기 |

### 9.2 `desktop/ui`

| 파일(묶음) | 줄 | 판정 | 까닭 |
|---|---|---|---|
| `bridge.ts` · `dom.ts` · `tips.ts` · `menu.ts` · `dialogs.ts` | 69 · 53 · 47 · 81 · 187 | **일반** | 다리 클라이언트 · 도우미 · 풍선 · 메뉴 그리기 · 호스트 물음 상자(Claude 연결 상자 포함) |
| `viewstate.ts` | 93 | **일반** | 「Claude 가 보는 선택」을 올리는 길 |
| `titlebar.ts` · `start.ts` · `edit.ts` · `tree/view.ts` | 220 · 69 · 137 · 337 | **조정** | 틀은 같고 내용(안 ▾ · 해석 상태 · 프로젝트 목록 · 편집 카운터 · 트리 그리기)은 제품 |
| `main.ts` | 736 | **조정** | 사건 → 상태 → 다시 그리기, `aiFollow`(5초 규칙), 단축키는 일반. 사건 종류 · 따라갈 대상은 제품 |
| `store.ts` | 604 | **조정** | 상태 한 곳 · "다리로만 읽는다"는 일반. 형(`SerializedModel` · 판정 · 영수증)과 MCP 경로는 StAnal |
| `ctxmenus.ts` | 226 | **조정** | "보는 일만" 원칙은 일반, 메뉴 내용은 제품 |
| `tree/data.ts` | 643 | **StAnal 전용**(구조만 참고) | 탭 4개 가지의 내용 — 골조 모델 · 하중 · 부재 검토 |
| `info/*`(8파일) | 1,314 | **StAnal 전용**(부품 `parts.ts` · `records.ts` 의 기록 표시는 조정) | 부재 · 절점 · 해석 · 대안 · 성과품 정보 창 |
| `sheet.ts` | 361 | **조정** | 시트 틀(머리 · 절 · 단계 줄 · 출처 꼬리표 · 3D 옆 분할)은 계산 과정 스키마만 맞으면 재사용. StCFSD 의 AISI 계산에 맞는 형태 |
| `table.ts` | 246 | **조정** | 표 서랍 틀 일반, 표 내용(반력 · 변위 · 부재력)은 StAnal |
| `view3d.ts` · `fit.ts` · `refs.ts` · `classify.ts` · `format.ts` | 209 · 86 · 43 · 39 · 150 | **StAnal 전용** | 3D 칩 · 골조 카메라 맞춤 · uid 참조 표시 · 기둥/보 분류 · 판정비 글자 |
| `style/app.css` · `index.html` | 380 · 34 | **조정** | 토큰 · 틀 · 부품은 그대로 쓸 만하다. 3D 대신 단면 그림 · 좌굴 곡선이 가운데에 오면 칸 이름만 바꿈 |
| `build.mjs` · `tsconfig.json` | 18 · 15 | **일반** | |
| `dev/embed-test.*` | 140 | **조정** | 웹뷰만 끼운 시험 페이지 |

### 9.3 `desktop/shell`

| 파일 | 줄 | 판정 | 까닭 · 하드코딩 |
|---|---|---|---|
| `windowState.ts` | 88 | **일반** | 모니터 · 최대화 기억 |
| `log.ts` | 142 | **일반** | 돌리기 · 보관 규칙 |
| `winConsole.ts` | 56 | **일반** | `child_process` 감싸기(Python 을 띄우는 제품이면 필요) |
| `preload.ts` | 17 | **일반** | `window.stanalShell` 이름만 |
| `platform.ts` | 153 | **일반**(거르기 글만 조정) | OS 대화상자 · 외부 열기 · 클립보드 |
| `layout.ts` | 163 | **조정** | 개발 · 설치본 경로, Python 찾기 · 환경 정리. `STANAL_REPO_ROOT` · `STANAL_PYTHON`, `app-root` · `ui` · `python` 배치 |
| `main.ts` | 697 | **조정** | 단일 인스턴스 · 세션(Bearer) · 창 지키기 · 포커스 규칙 · 닫기 확인 · 메뉴 · 시작/끝 순서는 거의 그대로. StAnal: `structFem.saveCurrentFile`, `/model/open`, `.sfem` 인자, `STANAL_*` 변수 8개, 「StAnal 프로젝트」 폴더, 거르는 알림 글 |
| `package.json` · `build.mjs` · `tsconfig.json` | 24 · 22 · 17 | **조정** | 이름 · productName |

### 9.4 `desktop/installer`

| 파일 | 줄 | 판정 | 까닭 · 하드코딩 |
|---|---|---|---|
| `electron-builder.config.cjs` | 90 | **조정** | `appId 'local.stanal.desktop'` · productName · 파일 연결(`.sfem` · `.stanal5`) · `artifactName` · `STANAL_WIN_EDIT_EXE`. NSIS 설정 · 퓨즈 방침 · `toolsets` 는 그대로 |
| `build.mjs` | 59 | **일반**(이름만) | |
| `stage.mjs` | 329 | **조정** | `.vscodeignore` → `vsce ls` 대조 · manifest 는 일반. 빌드 출처 검사(`tools/build-provenance.cjs`), 계산서 패키지 빌드 확인은 StAnal |
| `python.mjs` | 305 | **조정** | uv 절차 · 휠 태그 검사 · 덜어 내기 규칙은 일반. 잠금 파일 경로(`pynite/requirements.lock` …), import 확인 모듈 목록, `STANAL_PYTHON.json`, PyNiteFEA 포함 사유는 StAnal |
| `test/verify-win.mjs` · `test/packaged.mjs` | 174 · 380 | **조정** | 확인 항목 모양은 일반, 기대 파일 · MCP 시나리오는 StAnal |

### 9.5 `desktop/design`, 문서 · 시험

| 묶음 | 판정 | 까닭 |
|---|---|---|
| `design/assets/shell.js` · `app.css` · `review.css` | **조정** | 정적 템플릿 틀(제목 표시줄 · 트리 · 우클릭 · 풍선 · 정보 창 부품). StCFSD 템플릿을 빨리 그리는 데 쓸 만하다 |
| `design/0x-*.html` | **StAnal 전용**(구성 참고) | 골조 내용 |
| `README.md`(규칙 6개) | **일반** | "껍데기와 화면만 · 의존은 한 방향 · 확장 호스트 그대로 · 확장 화면 동작 불변 · 확장 배포물에 안 들어감 · 지금 시험을 계속 돌림" |
| `host/BRIDGE.md` | **조정** | 1 · 3 · 4절(인증 · 통로 · 주입 · 숨은 틀의 부작용)은 일반 설계 기록 |
| `host/test/*` · `ui/test/*` · `shell/test/*` | **조정** | 장치(`makeCheck` · `until` · Chrome · `_electron` · 가짜 설정 · 임시 폴더)는 일반. 항목은 제품. `ui/test/ui.mjs:24` 의 macOS 하드코딩 경로는 고칠 것 |

### 9.6 `desktop/` 밖에 있으나 같은 방식에 필요했던 것

| 곳 | 판정 | 까닭 |
|---|---|---|
| `mcp-server/connectionInfo.ts` 의 standalone 갈래(+65줄) · 문구 4개 | **일반 개념, 제품 코드** | 명시 포트 파일 · 다시 붙기 · 재시작 막기 · "프로그램이 꺼져 있음" 문구. StCFSD MCP 서버에 같은 갈래를 넣어야 한다 |
| `src/mcp/McpHttpServer.ts` 의 광고 파일 · 토큰 · 계측 | **일반 개념, 제품 코드** | StAnal 에는 원래 있었다. StCFSD 는 없음(고정 포트 · 토큰 없음) |
| `src/project/`(약 7,000줄) | 개념 **일반** / 코드 **StAnal 전용** | 기록 층(5.2). 모델 비교 · 지문 · 대상 개체가 제품 모델에 묶임 |
| `webview/components/featureRegistry.ts`(+17) | **일반 개념** | 새 MCP 도구를 "MCP 전용"으로 장부에 올림 — cufsmAi 의 배선 tripwire 와 같은 종류 |

---

## 10. 문서와 코드가 다른 곳(코드를 따름)

| 문서 | 문서의 말 | 코드 |
|---|---|---|
| 방향 9.2 · 5.5(`open_project`) | AI 가 도구를 부를 때 StAnal 이 꺼져 있으면 **띄운다** | 띄우지 않는다. 클라이언트가 `STANDALONE_NOT_RUNNING`("사용자에게 StAnal 을 켜 달라") 오류를 낸다(`mcp-server/connectionInfo.ts:43-44`) |
| 방향 3.1 · 9.2 · 4.5 부록 B | `wait_for_decision`(사람이 StAnal 에서 답하면 도구가 돌려줌), 「AI 에게 보내기」(클립보드) | 둘 다 없다. 다섯 번째 고침(3.7)으로 답은 대화에서 말로. `mcp-server/index.ts` 에 `wait_for_decision` 없음 |
| 방향 3.2 | 같은 프로젝트를 창 둘로 열 때 창마다 잠금 표시 파일 | `src/project/` 에 잠금 없음. 실행 번호가 겹치지 않는 것만 시험(작업문서 6절 B1) |
| 방향 3.3 · 6장 A2 | 기본 상태 상세 창에서 값 수정 | 만들지 않음(3.7 — 값은 Claude 에게 말로). 정보 창 컨트롤 0개가 시험 조건 |
| 방향 5.1 | 해시 규칙을 하나로 통일 | 하지 않음 — 새 기록에만 새 이름공간(방향 6장 진행 상태에 적혀 있음) |
| 작업문서 D3b 검토 · README 규칙 4 | 제품 코드(`src/` · `webview/` · `shared/`)는 그대로 | 최종 커밋은 `webview/components/featureRegistry.ts`(+17, MCP 전용 도구 등록) · `src/extension.ts`(+289) · `src/mcp/McpRouter.ts`(+260) · `src/core/*` · `mcp-server/`(+597) 등 90파일 +11,632 줄을 바꿨다. "확장 동작 불변"은 기록 층이 선언 파일이 있을 때만 켜지는 것으로 지킨다 |
| BRIDGE.md §1 「인증」 | 쿠키로 바꾼다 | 브라우저는 쿠키, **Electron 은 쿠키를 쓰지 않고 Bearer**(`shell/src/main.ts:302-322`). 둘 다 맞지만 Electron 경로는 `shell/README.md` 에만 |
| `ui/README.md` 「시험은 진짜 설정을 크기 · 수정 시각만 본다」 | 진짜 설정을 지킨다 | `ui/test/ui.mjs:24` 의 진짜 설정 경로가 macOS 고정 — Windows 에서는 없는 파일을 본다 |
| 방향 9.4 · desktop/README | MCP 도구 85개 | 95개(기록 단계 10개 더함) — 앞 문서가 이른 시점 |
