# desktop/host — VS Code 없이 확장 호스트를 돌리는 호스트 (S1 · S2 · S4)

2026-11-22 · 상태: **S1 끝(연기 시험 53 / 53)** · **S2 끝(다리 시험 59 / 59)** · **S4 끝(연결 시험 22 / 22)** — 창은 [`../shell/`](../shell/README.md)(S3). 화면 다리의 API 는 [`BRIDGE.md`](BRIDGE.md).

지금의 확장 호스트(`out/extension.js`, 루트 `tsc -p ./` 출력)를 **한 글자도 고치지 않고** Node 에서 `activate()` 한다.
`require('vscode')` 자리에 대체 모듈을 넣고, 설계 패널을 만들어 프로그램이 끝날 때까지 쥐고 있는다.
모델 · 해석 · 설계 · MCP 도구 59개는 확장과 같은 코드다. StAnal `desktop/host` 를 옮겨 StCFSD 에 맞춘 것이다.

## 있는 것

| 파일 | 내용 |
|---|---|
| `src/vscode/` | `vscode` 대체 모듈(아래 표). 없는 멤버에 닿으면 `[vscode-shim] 미구현: …` 을 한 번 남기고 목록에 올린다 |
| `src/platform.ts` | `HostPlatform` — 호스트가 사용자 · OS 에 묻는 **유일한** 길(알림 · 고르기 · 입력 · 열기/저장 대화상자 · 진행 · 외부 주소 · 보이기). headless 구현, `withScriptedAnswers`(다음 대화상자의 답을 미리 넣는 감싸개) |
| `src/loader.ts` | `startHost()` — 갈고리 · 포트 파일 방식 · 활성화 · 설계 패널 고정 · 웹뷰 대역 · `openProject`/`saveProject` · 정리 |
| `src/standin.ts` | 화면이 없을 때 설계 패널의 웹뷰 대역(`webviewReady` · `collectDesignData` 에만 답한다) |
| `src/headless.ts` | 화면 없는 CLI |
| `src/bridge/` | **화면 다리(S2)** — 127.0.0.1 + 토큰의 HTTP: 웹뷰 HTML 고쳐 쓰기(`inject.ts`) · 테마(`theme.ts`) · 호스트 ↔ 웹뷰 통로와 새로 고침 다시 보내기(`channel.ts`) · 호스트의 물음을 화면으로(`platform.ts`) · MCP 중계 · Claude 상태(`claude.ts`) · SSE(`sse.ts`) · 인증(`http.ts`). [`BRIDGE.md`](BRIDGE.md) |
| `src/serve.ts` | 호스트 + 다리 CLI(브라우저로 열 주소를 출력) |
| `frame/` | 틀(`/`): 제목 표시줄(파일 이름 · Claude 연결 상태) + 설계 패널 iframe + 좌굴 보고서 칸 + 호스트의 물음 · 알림. 빌드 없이 다리가 그대로 내준다 |
| `src/index.ts` | 공개 API(시험 · 뒤의 다리 · 껍데기가 이것만 쓴다) |
| `build.mjs` | esbuild — `dist/index.js` · `dist/headless.js` · `dist/serve.js`(Node 20 CJS 한 파일씩). `out/` 은 묶지 않고 실행 때 require. 빌드 뒤 웹뷰가 쓰는 `--vscode-*` 변수가 다리 테마에 모두 있는지 보고, 빠지면 멈춘다 |
| `test/smoke.mjs` | 연기 시험 — 화면 없이(아래) |
| `test/bridge.mjs` | 다리 시험 — 진짜 화면을 headless Edge/Chrome 으로(아래). 그림 · PDF 는 `test/out/`(git 에 넣지 않음) |
| `test/connect.mjs` | Claude 연결 시험(S4) — `/api/claude/*` 를 가짜 Claude 설정으로: 미설치 · 새 파일 · 다른 서버 보존(BOM · CRLF · 백업 = 원본 바이트) · 다른 설치를 가리킴 → 고침 · 끊기는 우리 것만 · 깨진 JSON 은 손대지 않음 · 쓰는 길은 화면의 세션뿐(MCP 쪽에서 닿지 않음) · 진짜 설정 자리 그대로 |

## 돌리기

```
npx tsc -p ./                       # 저장소 루트 — out/ 이 src/ 보다 오래됐으면(적재기가 경고한다)
cd desktop
npm install
npm test                            # 형 검사 → 빌드 → 연기 시험 → 다리 시험 → 연결 시험
npm run serve -- --open <파일.csd>  # 호스트 + 화면 다리. 출력된 「화면:」 주소(?t=토큰)를 브라우저로 연다
npm run headless -- --open <파일.csd> [--open <또 하나>] [--port-file <경로>] [--port <n>] [--python <python.exe>] [--user-data <폴더>]
```

CLI 는 stdout 에 자기 줄만 쓴다(확장 · Python 의 console 은 stderr). 출력:

```
StCFSD headless 호스트 — 명령 5개, 활성화 1368 ms, 설계 패널 1572 ms
Python: C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe (.venv)
MCP 다리: http://127.0.0.1:2311  (Bearer 토큰 · GET /status · POST /action · GET /last-call)
포트 파일: C:\Users\…\Temp\stcfsd-desktop\stcfsd-mcp-port
MCP 클라이언트: STCFSD_MCP_PORT_FILE=C:\Users\…\stcfsd-mcp-port STCFSD_MCP_STANDALONE=1 node C:\…\media\mcp-server.js
Claude Desktop 항목(등록하지 않음): {"stcfsd":{"command":"…node.exe","args":["…mcp-server.js"],"env":{…}}}
열기 …\a.csd: 성공 — Project loaded: …
STCFSD_HOST_READY {"pid":…,"mcpPort":…,"portFile":…,"env":{…},…}
```

- 끝내기: 콘솔의 Ctrl+C(SIGINT) · Ctrl+Break(SIGBREAK) · SIGTERM(POSIX), 또는 IPC `shutdown`. 다리를 멈추고(포트 파일을 지우고) Python 을 끝낸 뒤 스스로 끝난다. Windows 에서 다른 프로세스가 보내는 SIGTERM 은 받을 수 없다(곧바로 죽는다) — 그때 포트 파일이 남지만 MCP 서버는 pid 가 죽은 것을 보고 "실행 중이 아님" 으로 답한다(K1).
- IPC(부모가 `stdio: [..., 'ipc']` 로 띄웠을 때): `{id, type:'status'|'open'|'save'|'shutdown', file?}` → `{id, ok, result|error}`. 부모가 끊기면 끝낸다. 토큰은 IPC 로도 내지 않는다.

## MCP 연결 — 포트 파일 방식(K1)

적재기는 활성화 **전에** `STCFSD_MCP_PORT_FILE` 을 둔다. 확장의 다리가 빈 포트에서 듣고, 프로세스마다 토큰을 만들고, 그 파일에 `{app, version, port, token, pid, instanceId, startedAt}` 을 쓴다. 적재기는 그 파일을 읽어(`out/mcp/portFile.js` `readPortFile`, `pid === process.pid`) 포트 · 토큰을 안다. 모든 요청에 `Authorization: Bearer <토큰>` 이 있어야 한다(없으면 401). 호스트 · 화면의 조회는 `X-StCFSD-Request-Id` 를 붙이지 않는다 — 그 머리는 AI 호출 표시다(`GET /last-call`).

- `startHost({ portFile })` 는 **꼭** 받는다(기본값 없음 — 시험 · 개발판이 `%APPDATA%\StCFSD\mcp\` 에 쓰지 않게). CLI 는 주지 않으면 `<임시 폴더>/stcfsd-desktop/stcfsd-mcp-port`. 설치본은 `standardPortFile(appDataDir())` 를 준다(S3 · S5).
- `--port <n>` 은 개발용이다. 주면 다리 클래스의 `start` 를 감싸 listen 전에 포트를 바꾼다(포트 파일에는 실제 포트가 적힌다). 주지 않으면 아무것도 감싸지 않는다.

## MCP 설정 파일을 쓰지 않는 법

확장은 지금 방식(변수 없음)에서 활성화 때 `.mcp.json` · `.claude/mcp.json`(작업 폴더) · `<확장 폴더>/.mcp.json` · `~/.claude/mcp.json` 을 쓴다(`setupMcpConfig`). 독립 프로그램은 쓰지 않는다:

1. 포트 파일 방식이면 확장이 그 분기에 가지 않는다(`src/extension.ts` 의 K1 분기 — `port-file mode … MCP config files are not written`). 적재기는 포트 파일 없이는 뜨지 않는다.
2. 작업 폴더가 없다(`workspaceFolders` = undefined) — 작업 폴더의 두 파일은 길이 한 번 더 막힌다.
3. 확장의 등록 명령 `stcfsd.registerMcpServer` · `stcfsd.unregisterMcpServer` · `stcfsd.showMcpStatus` 는 지금 방식의 항목(`node` · 고정 포트)을 쓰거나 그것을 기준으로 보이므로 막는다(`CommandRegistry.block` — 부르면 까닭을 담아 던진다, `commands.ids()` 에도 없다).
4. 적재기가 활성화 앞뒤로 `<저장소>/.mcp.json` · `~/.claude/mcp.json` 의 크기 · 수정 시각을 비교한다(`mcpConfigWrites()`). 연기 시험은 저장소의 네 파일과 홈의 하나를 함께 본다.

`extensionMode` 는 `Production` 이다(K1 전에는 이 막기를 위해 `Test` 를 주었다 — 이제 필요 없다). `STCFSD_TEST_MODE` 는 쓰지 않는다(패널의 시험 갈고리가 열리고 Python 점검을 건너뛴다).

## 설계 패널을 끝까지 쥐는 법

StCFSD 에서는 모델과 결과가 `StcfsdPanel` 객체의 필드이고 MCP 다리는 `StcfsdPanel.currentPanel` 에 일을 넘긴다 — 패널이 없으면 MCP 도구 59개 가운데 58개가 "No active CUFSM panel" 로 실패한다. 적재기는 활성화 뒤 곧바로 `stcfsd.openDesigner` 를 실행해 패널을 만들고 `hub.pin()` 한다. 고정된 패널의 `dispose()`(화면이 닫으려 할 때)는 숨김으로 바뀌고(`onDidRefuseDispose`), 호스트가 끝날 때(`hub.disposeAll`)만 없어진다. `host.designer.alive()` 는 hub 의 항목과 `StcfsdPanel.currentPanel` 을 함께 본다.

화면이 없으면 웹뷰 대역(`standin.ts`)이 `webviewReady` 를 보내(VS Code 에서 패널을 연 직후처럼 기본 단면이 생긴다) 그 `modelLoaded` 까지 기다리고, 저장 때 `collectDesignData` 에 마지막으로 받은 `restoreDesignInputs` · `lapConnectionResult` 로 답한다. S2 의 다리는 `screenless: false` 로 대역을 떼고 진짜 웹뷰를 붙인다.

### 화면 없이 저장한 .csd 에 들어가는 것

설계 탭 입력(부재 길이 · 하중 · 설계 Fy · 접합 입력 등, 웹뷰의 `collectAllDesignInputs()`)은 K2 전까지 **웹뷰에만 있다** — 호스트에도 MCP 에도 없다. 그래서 화면 없는 저장은:

| 저장본의 칸 | 내용 |
|---|---|
| `model` · `derivedStateSignature` · `properties` | 호스트의 지금 모델(MCP 로 바꾼 것 포함) — 화면이 있을 때와 같다 |
| `analysisResult` · `dsm` · `loadAnalysis` · `designResult` · `preparedDesignDsm` | 호스트의 지금 결과(서명이 맞는 것만) — 화면이 있을 때와 같다 |
| `designInputs` | **마지막으로 연 파일의 입력 그대로**(파일을 연 적이 없으면 null). 그 뒤 MCP 로 돌린 설계 · 하중의 조건(`aisi_design` 의 Mu · Lb, `design_purlin` 의 경간 · 하중 …)은 담기지 않는다 |
| `lapResult` | 마지막으로 받은 `lapConnectionResult`(다른 파일을 열면 지운다) |

저장할 때마다 대역이 이것을 밝히는 주의를 만든다. stderr 에 `[host] 저장 주의: 설계 탭 입력은 화면(웹뷰)에만 있어 새로 모으지 못했다 — <파일> 을(를) 열 때의 입력을 그대로 쓴다. 그 뒤 호스트가 바꾼 것(designResult, …)의 조건은 입력 칸에 들어가지 않았다 …` 를 남기고, `saveProject()` 결과(IPC `save` 의 답)의 `inputsNotice` 에도 싣는다. "바꾼 것" 은 그 파일을 연 뒤 호스트가 보낸 `modelLoaded` · `designResult` · `designPurlinResult` · `loadAnalysisComplete` · `lapConnectionResult` · `connectionResult` · `designDsmPrepared` 이다 — 열기 자체가 다시 보내는 결과는 세지 않는다. 화면(S2)이 붙으면 진짜 웹뷰가 입력을 모으고 주의는 없다.

`openProject(file)` · `saveProject(file)` 은 확장의 「열기」 · 「저장」 길을 그대로 탄다: 웹뷰 메시지(`openProject` · `saveProject`) → (저장이면 `collectDesignData` ↔ `designDataCollected`) → 열기/저장 대화상자(미리 넣은 답) → 파일 → 끝 알림. 끝 = 대화상자 뒤의 첫 알림, 한 번에 하나씩.

## 대체 모듈 — 진짜로 하는 것과 흉내

StCFSD 호스트(`src/extension.ts` · `src/webview/StcfsdPanel.ts` · `src/webview/ProjectExplorerProvider.ts`)가 쓰는 것만 둔다(grep 으로 정한 목록).

| API | 이 모듈에서 |
|---|---|
| `commands.registerCommand` · `executeCommand` · `getCommands` | 진짜(등록부, 같은 id 두 번이면 던짐, 실행 기록 200건). 없는 명령은 미구현 기록. 막은 명령은 던짐 |
| `window.showInformation/Warning/ErrorMessage`(단추 · modal · `isCloseAffordance`) · `showQuickPick` · `showInputBox` · `withProgress` · `showOpenDialog` · `showSaveDialog` | 모두 `HostPlatform` 으로. headless 는 기록하고 정해 둔 답 또는 취소를 곧바로 돌려준다 |
| `window.createWebviewPanel` · `webview.html` · `postMessage` · `onDidReceiveMessage` · `asWebviewUri` · `cspSource` · `panel.reveal` · `onDidDispose` · `onDidChangeViewState` | 진짜 객체, 화면 없음. `WebviewHub` 가 생김 · 없어짐 · HTML · 호스트 → 웹뷰 메시지를 알리고 `deliver()` 로 웹뷰 → 호스트를 넣는다. 자원 주소는 VS Code 모양(`https://file+.vscode-resource.vscode-cdn.net/…`) — S2 의 다리가 고쳐 쓴다 |
| `window.createTreeView` · `TreeItem` · `ThemeIcon` · `ThemeColor` · `TreeItemCollapsibleState` · `EventEmitter` | 객체만(화면 없음). 제공자는 `trees.provider(id)` 로 꺼낼 수 있고 선택은 `setSelection` 으로 넣는다 |
| `window.activeTextEditor` | 늘 undefined(키는 있다) |
| `Uri`(`file` · `parse` · `joinPath` · `with` · `fsPath` · `toString`) | 진짜. `toString()` 은 VS Code `URI.toString()` 과 같은 인코딩(StAnal D7) |
| `workspace.getConfiguration` · `onDidChangeConfiguration` | 진짜. 기본값 = `package.json` `contributes.configuration`(StCFSD 는 비어 있음), 사용자 값 = `<userData>/settings.json`, 그 위에 시작 덮어쓰기 |
| `workspace.workspaceFolders` · `onDidChangeWorkspaceFolders` | 작업 폴더 없음(undefined), 사건은 쏘지 않는다 |
| `workspace.fs.writeFile`(+ `readFile` · `stat` · `createDirectory`) | 진짜(`FileSystemError` 코드) |
| `env.openExternal` | `HostPlatform.openExternal`(headless 는 열지 않고 기록) |
| `ExtensionContext`(`subscriptions` · `extensionPath` · `extensionUri` · `extensionMode` · …) | 진짜. `extensionPath` = 저장소 루트 → 확장이 `python/` · `media/` · `webview/` · `.venv` 를 거기서 찾는다. `globalState` · `workspaceState` 는 두지 않았다(쓰지 않는다 — 쓰면 미구현에 뜬다) |

StAnal 에서 가져오지 않은 것: 커스텀 편집기 · 텍스트 문서 · `applyEdit`, 사이드바 웹뷰 뷰, 상태바 · 출력 채널, 클립보드, VS Code 내장 명령 흉내, Memento. 최상위 Proxy 에 `__esModule: true` 를 두었다 — tsc 의 `__importStar` 가 키를 복사해 Proxy 를 건너뛰지 않게(최상위의 없는 이름도 기록된다).

## Python

확장의 `getPythonPath` 순서 그대로: `<확장 폴더>/.venv` → 설정 `python.defaultInterpreterPath` → PATH 의 `python`. 개발판은 저장소의 `.venv` 를 찾는다. 설치본의 덮어쓰기는 `startHost({ pythonPath })` · CLI `--python` · 환경 변수 `STCFSD_PYTHON` → 설정 `python.defaultInterpreterPath`(파일에 쓰지 않는다). 확장 폴더에 `.venv` 가 있으면 확장이 그것을 먼저 쓴다 — 적재기가 경고한다. 설치본은 `.venv` 없이 묶은 python.exe 를 이 설정으로 가리키거나, 묶음을 `<앱 뿌리>/.venv` 에 두면 된다(S5 에서 정한다).

## 연기 시험(`test/smoke.mjs`)

CLI 를 자식 프로세스로(`--port-file <임시> --open <Example/test.csd 사본> --open <지금 코드가 쓴 .csd 사본>`) 띄우고, MCP 서버와 같은 길(`GET /status` · `POST /action`, Bearer)로 부른다. 진짜 Python. 마지막 실행 53 / 53, 약 9 초.

0. `out/` 이 낡았으면 `npx tsc -p ./`
1. 준비 줄 · 포트 파일(포트 · 토큰 · pid) · 클라이언트 환경 줄 · Claude Desktop 항목(토큰 없음) · 막은 명령 셋 · 토큰 없는 요청 401 · `.venv` · `--open` 두 번
2. `get_status` → `generate_template`(립 C) → `set_material`(E · v) · `set_load_case`(굽힘, fy 50) · `set_lengths` → `get_properties` → `run_analysis` → `get_dsm`: My = fy · Sx_cl(호스트가 낸 단면계수로 계산한 기대값), Mcrl · Mcrd > 0 → `aisi_design`(휨, Fy 50): My = Fy · Sx, 0 < Mn ≤ My. 프로그램의 기본 강재에 기대는 리터럴은 없다
3. `.csd` 다시 열기(IPC) → 좌굴 해석 → `analyze_loads` → `design_purlin` → `aisi_design`(압축) → 저장(저장 대화상자 길) — 주의 `inputsNotice` 가 연 파일과 그 뒤 바꾼 것(designResult …)을 밝힌다 → 다시 열기 → 다시 저장(주의에 바꾼 것 없음): 모델 · 설계 입력 · Lap · 하중 해석 · 설계 결과가 같다. 지금 코드가 쓴 `.csd`(설계 입력 124칸)도 열고 저장해 입력이 그대로다
4. 설계 패널이 살아 있고 고정돼 있다, 어느 응답에도 "No active CUFSM panel" 없음
5. 호스트 → 웹뷰 메시지를 명령별로 센다(13종 · 50여 건)
6. 진짜 MCP 클라이언트(`media/mcp-server.js`, stdio, CLI 가 출력한 환경): initialize · tools/list(59) · get_status. 시험의 조회는 `/last-call` 에 세지 않고 클라이언트의 호출은 센다
7. 미구현 0, 오류 알림 0, 활성화 중 MCP 설정 파일 쓰기 0
8. IPC `shutdown` → 코드 0 · 자손 프로세스(Python 둘: venv 실행기 + 본체) 0 · 포트 풀림 · 포트 파일 지워짐
9. `git status --untracked-files=all`(desktop/ 밖)의 항목 · 크기 · 수정 시각이 그대로, 사용자 MCP 설정 파일 다섯의 수정 시각 그대로, `src` 에 루트 tsc 의 출력 없음

`test/rendered/out/r_blank.csd`(화면 시험이 남기는 v1.3)가 없으면 그 단계는 건너뛴다.

## 다리 시험(`test/bridge.mjs`)

`serve` CLI 를 자식 프로세스로 띄우고(진짜 호스트 · Python), HTTP 로 인증 · 격리를 본 뒤, 이 PC 의 Edge/Chrome 을 headless 로 띄워
DevTools 프로토콜로 진짜 화면을 DOM 으로 조작한다(`test/rendered/` 와 같은 방식). 브라우저가 없으면 화면 단계는 건너뛴다고 적고 HTTP 단계만 돈다.
단계마다 화면을 찍고, 페이지 예외 · 콘솔 오류(CSP 위반 포함) · 화면 글자의 `undefined` / `NaN` / `[object Object]` 가 0 인지 본다. 마지막 실행 59 / 59, 약 50 초.

0. 웹뷰가 쓰는 `--vscode-*` 38종이 두 테마에 모두 정의됐다
1 – 2. serve 준비 줄 · 토큰 없음 401(11 경로 + POST) · `?t=` → HttpOnly · SameSite=Strict 쿠키 + 303 · 경로 넘나들기 8가지 거절 · 다른 Host / Origin / Sec-Fetch-Site 403 · MCP 중계는 되고 MCP 토큰은 화면 어디에도 없다 · Claude 상태(가짜 설정, 읽기만) · CSP 고쳐 쓰기와 nonce(요청마다 새것)
3. 틀과 설계 웹뷰가 기본 단면을 그린다 · `--vscode-*` 가 웹뷰 안에서 모두 값이 있다
4. DOM 으로: 립 Z 템플릿(재료 Fy 55 · Fu 70 을 분명히) → 좌굴 해석(곡선 캔버스에 그림) → 6경간 퍼린 하중 해석 → 설계 검토 → Lap 접합부 → 보고서 → 검증
5. Save 단추 → 틀의 저장 물음(기본값 문서\StCFSD, 확인 전에는 폴더를 만들지 않음) → 임시 경로(설계 입력 124칸 · 해석 · 하중 · 설계 · Lap) → 다른 단면으로 바꾼 뒤 Open → 입력 · 결과가 돌아온다
6. 좌굴 보고서가 오른쪽 칸(두 번째 웹뷰)으로 열리고 그 PDF 단추가 PDF 를 쓴다 · 보고서 탭의 PDF 저장
7. MCP 중계로 `generate_template` → 화면의 단면이 바뀌고 낡은 결과가 지워진다 · `capture_section_preview` → 웹뷰가 그린 PNG
8. 중계로 해석한 뒤 새로 고침 → 같은 단면(그림의 도형까지 같다) · 곡선 · DSM, 호스트 모델은 기본 단면으로 돌아가지 않는다
9. 밝은 · 어두운 테마 — 본 화면 열세 곳의 글자 대비 ≥ 3
10 – 11. 미구현 0 · IPC shutdown 코드 0 · 자식 프로세스 0 · 두 포트 풀림 · 포트 파일 지워짐 · desktop/ 밖 그대로 · 사용자 MCP · Claude Desktop 설정 · 앱 데이터 포트 파일 그대로

## 아는 빈 곳

- **화면 없이는 화면 캡처 없음** — headless 에서 `get_section_preview` 는 호스트의 5 초 시간 제한 오류로 끝난다(웹뷰 대역은 그리지 않는다). 화면 다리로 진짜 웹뷰가 붙어 있으면 된다(다리 시험 7).
- 화면 다리로 안 되는 것 · S3 가 바꿀 것은 [`BRIDGE.md`](BRIDGE.md) 8절.
- **설계 입력은 웹뷰에 있다** — 화면 없는 저장의 `designInputs` 는 마지막으로 연 파일의 것이다(위 「화면 없이 저장한 .csd 에 들어가는 것」, 저장마다 주의를 남긴다). K2(상태를 호스트로)의 일이다.
- **Example/test.csd 의 단면은 템플릿 기록이 없는 비대칭 단면**이라 엔진이 압축 전체좌굴을 평가하지 않고(Pne = 0) 퍼린 설계도 판정 없음(pass = null)으로 끝난다. 엔진의 정직한 결과이고, 시험은 "돌고 FSM 값을 쓴다" 까지만 본다. 판정이 나는 설계는 2단계의 립 C 로 본다.
- **Python 이 없을 때** — 확장의 `checkAndInstallDependencies` 가 묻는 「다운로드 페이지 열기」 · 「설치」 에 headless 는 답하지 않는다(취소). 묶음 Python(S5) 전에는 개발판만 된다.
- **Windows 의 SIGTERM** — 다른 프로세스가 보내면 정리 없이 죽는다(위). Python 은 stdin 이 닫혀 함께 끝났다(이 PC 에서 확인).
- `--port` 는 다리 클래스의 `start` 를 감싸는 길이라 `McpBridgeServer` 모양이 바뀌면 경고하고 무시한다.
