# 화면 다리(S2 · S4) — API

2026-11-22 · `desktop/host/src/bridge/` · CLI `src/serve.ts` · 시험 `test/bridge.mjs`

호스트가 127.0.0.1 의 빈 포트에 여는 HTTP 서버다. 지금의 웹뷰(탭 6개)를 **고치지 않고** 보통 브라우저에서 돌린다 — 바꾸는 것은 모두 다리가 HTML 을 내줄 때다. S3 의 Electron 창은 같은 다리를 연다.

```
브라우저 / (S3) Electron 창
  ├ GET /                 틀: 제목 표시줄 + 설계 패널 iframe(/wv/<id>/) + 오른쪽 칸(좌굴 보고서) + 호스트의 물음
  ├ GET /api/events       틀이 받는 이벤트(SSE)
  └ iframe /wv/<id>/      웹뷰 HTML  ── GET /api/wv/<id>/out (SSE) · POST /api/wv/<id>/in
                                      └ /res/webview/… · /res/media/…
다리 ── hub(대체 모듈의 WebviewHub) ── StcfsdPanel(확장 호스트, 고치지 않음)
     └ /api/mcp/* ── 호스트의 MCP 다리(포트 파일 방식, 토큰은 다리가 붙인다)
```

## 1. 인증 · 출처

| 무엇 | 규칙 |
|---|---|
| 토큰 | 다리마다 무작위 24 바이트(base64url). MCP 다리의 토큰과 **따로**다 |
| 브라우저 | 첫 주소 `http://127.0.0.1:<포트>/?t=<토큰>` → `Set-Cookie: stcfsd_bridge_<포트>=<토큰>; HttpOnly; SameSite=Strict; Path=/` + 303 으로 `t` 를 뗀 주소. 그 뒤 iframe · 리소스 · EventSource · fetch 는 같은 출처라 쿠키가 따라간다 |
| 시험 · Electron | `Authorization: Bearer <토큰>` |
| 거절 | 토큰 없음 401(모든 경로) · Host 가 `127.0.0.1:<포트>` / `localhost:<포트>` 가 아님 403(DNS rebinding) · Origin 이 다리 출처가 아님 403 · `Sec-Fetch-Site` 가 `same-origin` · `none` 이 아님 403. CORS 머리는 내지 않는다 |
| 공통 머리 | `X-Content-Type-Options: nosniff` · `Cache-Control: no-store` · `Referrer-Policy: no-referrer` · `Cross-Origin-Resource-Policy: same-origin` · `X-Frame-Options: SAMEORIGIN` |

**쿠키를 고른 까닭(StAnal 과 같은 결정)**: 보통 브라우저는 iframe · `<script src>` · `EventSource` 에 머리를 붙일 수 없다. 주소에 토큰을 계속 달면 기록 · Referer · 화면 캡처에 남는다. 그래서 첫 주소의 토큰을 HttpOnly(페이지 스크립트가 못 읽음) · SameSite=Strict(다른 사이트에서 온 요청에 안 붙음) 쿠키로 바꾸고 주소에서 뗀다. 쿠키 이름에 포트를 넣어 여러 다리가 섞이지 않게 한다. Electron(S3)은 메모리 세션에 같은 쿠키를 넣거나 `webRequest` 로 Bearer 를 붙이면 된다 — StAnal 의 껍데기는 Bearer 를 붙였다.

## 2. 경로

| 경로 | 하는 일 |
|---|---|
| `GET /` | 틀(`host/frame/index.html`). CSP `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`. `?theme=dark|light` |
| `GET /frame/<파일>` | 틀의 스크립트 · 스타일 |
| `GET /wv/<id>/?theme=` | 웹뷰 HTML(3절). `<id>` 는 hub 의 id(`panel:stcfsd.designer:1` 꼴, URL 인코딩). 머리 CSP 는 `frame-ancestors 'self'` 만(본 정책은 meta) |
| `GET /res/webview/<경로>` · `/res/media/<경로>` | 웹뷰 리소스. 뿌리는 이 둘뿐(패널의 localResourceRoots). `..` · 빈 마디 · `\` · NUL · `:` · 심볼릭 링크로 뿌리 밖을 가리키면 404 |
| `GET /api/wv/<id>/out` | 호스트 → 웹뷰(SSE). 첫 사건 `hello {conn, webview, viewType}`, 다시 보내기를 마치면 `replayed {count, commands}`, 그 뒤 `data:` = 호스트가 보낸 `{command, data}` 그대로. 다른 페이지가 같은 웹뷰를 열면 앞의 것에 `superseded` |
| `POST /api/wv/<id>/in?conn=<conn>` | 웹뷰 → 호스트. 본문은 메시지 배열. `conn` 이 지금 연결이 아니면 409 |
| `GET /api/events` | 틀의 이벤트(SSE). 첫 사건 `hello {lastSeq, state}`, 그 뒤 `{seq, at, type, source, data}`. `Last-Event-ID` 로 최근 500건 다시 받기 |
| `GET /api/state` | `{designer, webviews[{id, viewType, title, pinned, visible, connected, ready, url}], theme, currentFile, currentName, platform{progress, pending}, lastSeq}` |
| `POST /api/platform/answer` | `{qid, answer}` — 4절. 형식이 틀리면 400 과 까닭 |
| `POST /api/webviews/<id>/close` | 웹뷰 닫기(좌굴 보고서 칸의 ✕). 설계 패널은 고정이라 숨김이 될 뿐 없어지지 않는다(S1) |
| `GET·POST /api/mcp/<경로>` | 호스트 MCP 다리로 중계(`/status` · `/action` · `/last-call`). 다리가 MCP 토큰을 붙인다 — 화면에는 그 토큰이 가지 않는다. 화면의 머리(쿠키 · Origin)는 넘기지 않고, AI 호출 표시 `X-StCFSD-Request-Id` 도 붙이지 않는다(이 조회는 「마지막 호출」로 세지 않는다) |
| `GET /api/claude/status` | `{state, ui, configPath, configKind, configExists, configError?, otherServers, lastAiCall, aiCalls, canConnect, canDisconnect, restartNeeded, text, tooltip}` — K1 `checkClaudeDesktop`(설정을 읽기만) + MCP `GET /last-call`. `ui` = `connected · registered · restart-needed · not-registered · registered-elsewhere · not-installed · invalid-config · unknown`, `text` = 제목 표시줄의 한 줄 |
| `POST /api/claude/connect` · `POST /api/claude/disconnect` | **S4** — 본문 `{}`(JSON 이어야 한다). `{result: {ok, action, reason?, error?, wrote, backupPath?, restartRequired, message}, status}`. K1 `connectClaudeDesktop` · `disconnectClaudeDesktop` 이 쓴다(9절). 화면의 세션(쿠키 · 다리 토큰)으로만 — AI 는 호스트의 MCP 다리에 붙고 거기에는 이 경로가 없다. `/api/mcp/*` 중계도 MCP 다리로만 간다(시험: 중계 · MCP 다리 직접 모두 `Unknown endpoint`) |

### 틀의 이벤트(`/api/events` 의 `type`)

| type | data |
|---|---|
| `platform:question` | `{qid, kind: notify·pick·input·fileDialog, request, at}` — 4절 |
| `platform:answered` | `{qid, answer, cancelled?}` |
| `platform:notify` | 단순 알림 `{severity, message, items: [], modal: false, detail?}` |
| `platform:progress` | `{id, title, message, percent, done, cancellable}` |
| `platform:openExternal` · `platform:reveal` | `{target}` |
| `webview:created` · `webview:disposed` · `webview:html` | `{id, viewType, title?, url?}` — 좌굴 보고서 칸을 열고 닫고 다시 읽는다 |
| `webview:client` · `webview:ready` · `webview:refused` | 페이지가 붙음 · 다시 보내기 끝 `{replayed}` · 고정 패널 닫기를 숨김으로 바꿈 |
| `file:current` | `{file, name}` — 열기 · 저장이 성공한 `.csd` |
| `claude:status` | `GET /api/claude/status` 와 같은 것 — 「연결」 · 「끊기」 뒤 |

## 3. 웹뷰 HTML 고쳐 쓰기(`inject.ts`)

확장 소스 `src/webview/StcfsdPanel.ts`(`_getHtmlForWebview` · `_wrapBucklingReport`)와 `webview/` 는 한 글자도 바꾸지 않는다. 내줄 때만:

1. **리소스 주소** `https://file+.vscode-resource.vscode-cdn.net/<절대경로>`(`%2B` 꼴 포함) → `/res/<뿌리>/<상대>`. 밖이면 `/res/denied`(404).
2. **CSP** — 패널이 쓴 정책을 그대로 두고 셋만 바꾼다: `cspSource`(`https://*.vscode-cdn.net`) → `'self'`, `'nonce-…'` → 요청마다 새 nonce, `connect-src 'self'` 더하기. 설계 패널의 `'unsafe-eval'`(3D 뷰어)은 그대로. 원래 nonce 를 단 태그(스크립트 6개 · 보고서의 인라인 스크립트)도 새 nonce.
3. **CSP meta 바로 뒤**(웹뷰 스타일 · 스크립트보다 앞): 테마 `<style>`(`--vscode-*` 변수 + VS Code 기본 웹뷰 스타일) · 수신부 `<script>`(`acquireVsCodeApi()` 대체: `postMessage` → `/in`, `getState`/`setState` → sessionStorage, 받는 것은 표준 `message` 사건).
4. **`<body>`** `vscode-dark` / `vscode-light` 클래스 + `data-vscode-theme-kind`.

테마(`theme.ts`): 웹뷰가 쓰는 변수 38종(theme.css · webview/js · 패널 HTML 을 훑은 목록)을 Dark Modern / Light Modern 값으로 모두 정의한다. 빠진 것이 있으면 `host/build.mjs` 가 빌드를 멈추고 `test/bridge.mjs` 가 실패한다. 웹뷰 안의 하드코딩 색(대부분 어두운 테마 전제, 약 200곳)은 그대로다 — 밝은 테마는 본 화면의 글자 대비를 시험으로 본다(최저 10.6, 어두운 테마 6.1).

## 4. 호스트의 물음(`platform.ts` — HostPlatform 의 다리 구현)

| kind | request | answer |
|---|---|---|
| `notify` | `{severity, message, items, modal, detail?}` (단추가 있거나 modal 일 때만 물음) | 단추 제목 하나 · `null`(닫기) |
| `pick` | `{items[{label, description?, detail?, picked?}], canPickMany, title?, placeHolder?}` | 번호 · 번호 배열 · `null` |
| `input` | `{title?, prompt?, value?, placeHolder?, password?}` | 문자열 · `null` |
| `fileDialog` | `{kind: open·save, title?, defaultPath?, filters?, canSelectMany?, openLabel?, saveLabel?, suggestedPath}` | 절대 경로 배열 · `null`. 열기는 있는 파일이어야 한다 |

- 시간 제한 없음(VS Code 와 같다). 틀이 하나도 안 붙어 있으면 headless 처럼 곧바로 취소. 물음 뒤 틀이 모두 떨어지면 취소.
- **열기/저장의 기본 폴더**: `suggestedPath` = `<문서>/StCFSD/`(+ 저장이면 `defaultPath` 의 이름 또는 `project.<첫 확장자>`). 다리는 그 폴더를 읽지도 만들지도 않는다. 사용자가 경로를 확인해 답하면 그때 호스트가 그 파일을 읽거나 쓰고, 저장이면 다리가 **그 경로의** 부모 폴더만 만든다. `<문서>` 는 `createBridgePlatform({ documentsDir })`(serve 의 `--documents`, 기본 `~/Documents`).
- 틀의 물음 그림은 경로 칸 하나다(폴더를 훑지 않는다). **S3** 는 `createBridgePlatform({ fileDialog, openExternal, notifyWithoutScreen })` 로 OS 대화상자 · OS 브라우저 · 시작 중(틀이 붙기 전) 알림 상자를 끼운다 — 같은 인터페이스, 틀의 칸은 뜨지 않는다(`desktop/shell/src/main.ts`).
- 물음이 떠 있는 동안 틀은 페이지 제목 앞에 「● 응답 필요 — 」 를 붙인다. 껍데기는 그것(창 제목)과 작업 표시줄 깜빡임으로만 알리고 창을 앞으로 꺼내지 않는다.

## 5. 메시지와 새로 고침 — 다시 보내기(`channel.ts`)

VS Code 웹뷰는 `retainContextWhenHidden` 이라 다시 뜨지 않는다. 호스트는 모델 · 결과를 **밀어 줄 뿐** 다시 보내는 길이 없고, `webviewReady` 를 다시 받으면 모델을 기본 단면으로 덮어쓴다. 그래서:

- 설계 패널의 `webviewReady` 는 다리가 뜰 때 **한 번만** 호스트에 보낸다(VS Code 에서 패널이 처음 뜬 때와 같은 자리). 페이지가 보내는 `webviewReady` 는 넘기지 않고 "받을 준비 됨" 으로만 쓴다. 그래서 `serve --open` 으로 화면보다 먼저 연 파일도 지워지지 않는다.
- 호스트 → 웹뷰 메시지는 번호와 함께 기록된다. 페이지가 준비되면(처음이든 새로 고침이든, 다른 탭이든) 줄인 기록을 차례대로 보내고(`replayed`), 그 뒤로는 오는 대로 보낸다.
- 줄이는 규칙: ① 같은 명령은 마지막 것만(남은 것끼리는 원래 차례) ② `resultsCleared` · `analysisInvalidated` 가 오면 그것이 지우는 앞의 결과를 뺀다 ③ 한 번만 뜻이 있는 `collectDesignData`(다시 보내면 저장이 돈다) · `captureSection` · `showSection` 은 남기지 않는다 ④ 웹뷰가 그릴 때마다 스스로 다시 묻는 `propertiesResult` · `propertiesError` 는 남기지 않는다(남기면 도심 축이 두 번 그려졌다 — 시험에서 봄).
- 좌굴 보고서 패널은 `webviewReady` 를 보내지 않으므로 붙자마자 준비된 것으로 본다.
- SSE 가 끊겼다 다시 붙으면 페이지가 스스로 다시 읽는다(두 번째 `hello`) — 위의 다시 보내기로 돌아온다.
- **되살리지 못하는 것**: 화면 칸에만 있고 호스트에 보낸 적 없는 설계 탭 입력(K2 전까지 웹뷰에만 있다). 파일에서 연 입력은 `restoreDesignInputs` 로 돌아온다.

## 6. PDF · 보고서

- 보고서 탭 「PDF 저장」(`saveReportPdf`)과 좌굴 보고서 패널의 「PDF / HTML 저장」(`savePdf`)은 호스트가 처리한다 — 저장 물음(4절) → 이 PC 의 Edge/Chrome 을 `--headless=new --print-to-pdf` 로 띄워 인쇄(`StcfsdPanel._saveReportPdf`). 다리에서 그대로 돈다(시험: 두 PDF 모두 `%PDF`).
- **S3 가 바꿀 것**: 설치본 PC 에 Edge 가 없을 수 있고, 따로 띄운 브라우저 프로필이 느리다. Electron 의 `webContents.printToPDF` 로 바꾸려면 호스트가 브라우저를 찾는 길(`_findBrowser`)을 대신할 갈고리가 필요하다 — 지금 확장 코드에는 없다(제품 쪽 공용 변경 후보: "PDF 인쇄기" 주입점, 기본값은 지금의 Edge headless).

## 7. CLI

```
node desktop/host/dist/serve.js [--open <파일.csd>]… [--theme dark|light] [--port <다리 포트>] [--port-file <MCP 포트 파일>]
                                [--python <python.exe>] [--user-data <폴더>] [--documents <폴더>] [--claude-config <파일>] [--repo <루트>]
```

출력: `화면: http://127.0.0.1:<포트>/?t=<토큰>` — 브라우저로 연다. 마지막 시작 줄 `STCFSD_BRIDGE_READY {pid, url, origin, port, mcpPort, portFile, designer}`. 끝내기: Ctrl+C · Ctrl+Break · IPC `shutdown`(IPC `status` 는 미구현 · 메시지 수 · 통로 · 물음 기록). 다리 → 호스트 순서로 정리한다.

## 8. 아직 다리로 안 되는 것

- **설계 탭 입력의 새로 고침** — 5절. K2 가 입력을 호스트로 옮기면 풀린다.
- **클립보드**(`보고서 클립보드 복사` — `navigator.clipboard`): 127.0.0.1 은 보안 컨텍스트라 보통 브라우저에서는 된다. 시험(headless)에서는 확인하지 않았다.
- **사이드바 트리**(`stcfsd.projectExplorer`)는 객체만 있다 — 틀에 그리지 않는다(새 화면 U1 의 일).
- **두 탭**: 같은 웹뷰를 두 탭에서 열면 뒤의 것이 이기고 앞의 것은 멈춘다(`superseded`). 물음은 붙은 틀 모두에 가고 먼저 답한 것이 쓰인다.
- **보통 브라우저로 띄웠을 때(serve)의 것**: OS 파일 대화상자 · 문서 폴더(OneDrive 로 옮긴 경우)는 S3 의 창에서만. PDF 는 두 경우 모두 호스트가 Edge headless 로 인쇄(6절).

## 9. Claude Desktop 연결(S4)

틀의 제목 표시줄: 상태 글(`text`, 풍선 도움말 `tooltip`) + 단추 하나 — `canDisconnect` 면 「끊기」, `canConnect` 면 「연결」, Claude 가 없거나 설정이 깨졌으면 누를 수 없는 「연결」. 10 초마다 `/api/claude/status` 를 다시 읽는다(AI 가 처음 부르면 「연결됨」으로).

| ui | 글 |
|---|---|
| `not-installed` | Claude Desktop 없음 |
| `invalid-config` | Claude 설정 파일을 읽을 수 없음 |
| `not-registered` | Claude 등록 안 됨 |
| `registered-elsewhere` | Claude 다른 설치를 가리킴 |
| `restart-needed` | Claude 등록됨 · Claude Desktop 다시 시작 필요(이 실행에서 「연결」했고 그 뒤 AI 호출이 없다) |
| `registered` | Claude 등록됨 · 아직 호출 없음 |
| `connected` | Claude 연결됨 · 마지막 호출 HH:MM · <클라이언트>(등록돼 있고 AI 가 이 호스트를 불렀다) |

넣는 항목(`startBridge({ claude: { entry } })`): 껍데기는 `standaloneMcpEntry({ command: process.execPath, serverScript: <배치의 media/mcp-server.js>, portFile: <사용자 폴더>/mcp/stcfsd-mcp-port, electron: true })` 를 준다 — `ELECTRON_RUN_AS_NODE=1` 이 붙는다. 주지 않으면(`serve`) 호스트의 항목(이 node 로 띄움). 쓰기의 규칙(백업 · 원자적 쓰기 · 다시 읽어 확인 · 다른 항목 그대로 · 깨진 JSON 은 손대지 않음 · 미설치면 폴더를 만들지 않음 · 끊기는 같은 항목만)은 K1 의 도우미가 지킨다(`docs/reviews/20261122-engine-review/fixes/K1-mcp-connection.md`). 시험은 `claude: { configPath }` 로 임시 폴더의 가짜 파일만 준다(`host/test/connect.mjs`, `shell/test/shell.mjs`).
