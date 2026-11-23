# 화면 다리(S2 · S4 · U1 · V5) — API

2026-11-22 · `desktop/host/src/bridge/` · CLI `src/serve.ts` · 시험 `test/bridge.mjs` · 새 검토 화면(U1)의 시험 `../ui/test/ui.mjs`

호스트가 127.0.0.1 의 빈 포트 **둘**에 여는 HTTP 서버다. 지금의 웹뷰(탭 6개)를 **고치지 않고** 보통 브라우저에서 돌린다 — 바꾸는 것은 모두 다리가 HTML 을 내줄 때다. S3 의 Electron 창은 같은 다리를 연다.

```
브라우저 / (S3) Electron 창
  ├ 틀 서버  http://127.0.0.1:<포트>          (origin)
  │   ├ GET /                 틀: 제목 표시줄 + 설계 패널 iframe + 오른쪽 칸(좌굴 보고서) + 호스트의 물음
  │   ├ GET /ui/              새 검토 화면(U1, desktop/ui — uiDir 를 줄 때만). 설계 패널 iframe 을 안에 늘 끼워 둔다
  │   ├ GET /api/events       틀 · 새 화면이 받는 이벤트(SSE)
  │   └ POST /api/…           쓰기 — 읽기 인증 + 쓰기 열쇠(1절)
  └ 웹뷰 서버 http://127.0.0.1:<다른 포트>    (webviewOrigin — 쓰기 경로가 없다)
      └ iframe /wv/<id>/      웹뷰 HTML  ── GET /api/wv/<id>/out?k= (SSE) · POST /api/wv/<id>/in(웹뷰 열쇠)
                                          └ /res/webview/… · /res/media/…
다리 ── hub(대체 모듈의 WebviewHub) ── StcfsdPanel(확장 호스트, 고치지 않음)
     └ /api/mcp/* ── 호스트의 MCP 다리(포트 파일 방식, 토큰은 다리가 붙인다)
```

**브라우저 모드(`npm run serve`)는 개발 · 시험 길이다.** 사용자가 쓰는 것은 Electron 창(`desktop/shell`)이다 — 쿠키를 쓰지 않고(Bearer), 쓰기 열쇠는 주 프로세스만 안다. 브라우저 모드의 남은 한계는 1절 끝.

## 1. 인증 · 출처 · 쓰기 열쇠 (V5-04 · V5-18)

| 무엇 | 규칙 |
|---|---|
| 토큰(읽기) | 다리마다 무작위 24 바이트(base64url). MCP 다리의 토큰과 **따로**다. `Authorization: Bearer <토큰>`(Electron · 시험 · CLI). 두 서버가 같은 토큰을 받는다 |
| 브라우저 쿠키(읽기) | 첫 주소 `http://127.0.0.1:<포트>/?t=<토큰>` → 작은 페이지(200) + `Set-Cookie: stcfsd_bridge_<포트>=<쿠키 값>; HttpOnly; SameSite=Strict; Path=/`. **쿠키 값은 토큰이 아니다**(따로 만든 무작위 값) — 쿠키는 포트를 가리지 않아 127.0.0.1 의 다른 포트로도 가므로, 그것을 받은 곳이 `?t=` 를 다시 할 수 없게. 쿠키로는 읽기만 된다 |
| 쓰기 열쇠 | 다리마다 무작위 24 바이트. 틀 서버의 **GET 이 아닌 모든 요청**(`/api/claude/*` · `/api/mcp/*` · `/api/platform/answer` · `/api/webviews/<id>/close`)과 `GET /api/wv-key` 는 읽기 인증에 더해 `X-StCFSD-Key: <쓰기 열쇠>` 가 있어야 한다. 없으면 403. 열쇠가 가는 곳: **브라우저** — `?t=` 교환 응답의 본문 스크립트가 그 탭의 sessionStorage(틀 출처, 이름 `stcfsd.bridge.key.<포트>`)에 넣고 `/`(또는 `/ui/`)로 간다. 주소 · 쿠키 · 기록 · 웹뷰에는 없다. **Electron** — 주 프로세스가 `webRequest` 로 틀 서버로 가는 요청 가운데 **맨 위 프레임 문서의 스크립트가 낸 fetch/XHR**(`resourceType === 'xhr'`, `details.frame.parent === null`, 그 프레임의 문서가 틀 출처)에만 머리로 붙인다. 이동(맨 위 · 하위 프레임 — 끼운 웹뷰가 `top.location` · `target=_top` 으로 일으킬 수 있는 것)에는 붙이지 않는다(V5b-04). 페이지는 열쇠를 모른다. 그리고 창은 **페이지가 시작한 맨 위 이동 · 리디렉트를 모두 막는다**(다리 주소여도) — 앱이 스스로 하는 `loadURL` · 메뉴의 새로 고침만 맨 위 창을 옮긴다. 끼운 웹뷰(하위 프레임)는 웹뷰 서버 안에서만 움직인다(`desktop/shell/src/main.ts` `guardContents`) |
| 웹뷰 열쇠 | **웹뷰마다 다르다**(V5b-06 — 다리의 비밀과 웹뷰 id 로 만든 HMAC). 그 웹뷰의 `/api/wv/<id>/` 통로에서만 맞는다 — `out` 은 `?k=`, `in` 은 `X-StCFSD-Webview-Key`. 틀(또는 새 화면)이 쓰기 열쇠로 `GET /api/wv-key?id=<id>` 에서 받아, **자기 iframe**(설계 · 보고서, 웹뷰 서버 출처)이 postMessage 로 `need-key` 를 물을 때 그 iframe 에 **틀이 실은** 웹뷰 id(iframe 의 `src` 에서 — iframe 이 대는 id 는 믿지 않는다)의 열쇠만 건넨다. 그래서 보고서 웹뷰는 설계 웹뷰를 빼앗거나 그 대신 메시지를 넣지 못하고, 쿠키만 가진 곳은 어느 것도 못 한다 |
| 두 출처 | 웹뷰(iframe)는 틀과 **다른 출처**(웹뷰 서버)에서 돈다 — VS Code 의 웹뷰도 다른 출처다. 그래서 웹뷰 안의 스크립트는 틀의 문서 · sessionStorage(쓰기 열쇠) · 스크립트에 닿지 못하고, 틀 서버로 보내는 요청은 Origin 이 웹뷰 서버라 거절된다(브라우저는 CORS 로도 막는다). 웹뷰 서버에는 쓰기 경로가 없다(404). 웹뷰 문서의 `frame-ancestors` 는 틀 출처뿐이다 |
| 거절 | 토큰 없음 401(두 서버의 모든 경로) · Host 가 그 서버의 `127.0.0.1:<포트>` / `localhost:<포트>` 가 아님 403(DNS rebinding) · Origin 이 그 서버의 출처가 아님 403 · `Sec-Fetch-Site` 가 `same-origin` · `none` 이 아님 403 — 예외 하나: 웹뷰 서버의 `GET /wv/<id>/` 를 틀이 iframe 으로 싣는 것(`same-site` + `Sec-Fetch-Dest: iframe`, Origin 없음). 쓰기 열쇠 없는 쓰기 403. CORS 머리는 내지 않는다 |
| `?t=` 교환 뒤 | 늘 이 출처의 정해진 화면(`/` 또는 `/ui/`, `?theme=` 만 넘긴다)으로 간다 — 요청 경로를 그대로 쓰지 않는다(V5-10: `/.//evil.example/x` 는 정리하면 `//evil.example/x`) |
| 공통 머리 | `X-Content-Type-Options: nosniff` · `Cache-Control: no-store` · `Referrer-Policy: no-referrer` · `Cross-Origin-Resource-Policy: same-origin` · `X-Frame-Options: SAMEORIGIN`(웹뷰 문서만 빼고 — 그것은 `frame-ancestors <틀 출처>`) |

**쿠키를 쓰는 까닭과 한계 — 정한 것(V5-04 남은 몫)**: 보통 브라우저는 iframe · `<script src>` · `EventSource` 에 머리를 붙일 수 없어 읽기에는 쿠키가 필요하다. 쿠키는 포트를 가리지 않는다 — 같은 브라우저로 127.0.0.1 의 다른 포트(개발 서버 · 다른 로컬 도구)를 열면 그 서버가 쿠키를 받는다. 그래서 쿠키 값은 토큰이 아니고, 쿠키로는 **읽기만** 된다. 그 읽기는 그대로 둔다: 쿠키를 받은 다른 포트는 `/api/state` · `/api/wv/<id>/last`(모델 전체) · `/api/mcp/status` · `/api/claude/status` · `/api/events` 를 **읽을 수 있다**. 읽기까지 막으려면 틀 · 새 화면의 정적 파일 · SSE 에도 쿠키 아닌 무엇이 필요한데, 그것은 브라우저 모드 전체를 다시 짜는 일이고 이 길은 개발 · 시험용이다 — **이것은 브라우저 모드(`serve`)만의 알려진 한계다. 사용자가 쓰는 Electron 창은 쿠키를 쓰지 않아(Bearer) 해당하지 않는다.** serve 는 시작할 때 이 한 줄을 알린다(「알림: 브라우저로 여는 이 화면은 개발 · 시험 길입니다 …」). 쓰기 · 열쇠 · 웹뷰 통로는 쿠키로 되지 않는다(시험). **방문 기록(V5-S4)**: 처음 여는 `?t=<토큰>` 주소는 브라우저의 방문 기록에 남는다(헤드리스 Edge 프로필의 History 파일에서 확인 — `test/bridge.mjs` 가 매번 알린다). 그 serve 가 떠 있는 동안 그 토큰으로 다시 교환할 수 있다. 브라우저 프로필을 읽을 수 있는 같은 사용자의 프로그램은 MCP 포트 파일도 읽을 수 있으므로 더 넓어지지는 않지만, 공용 PC 에서는 serve 를 쓰지 않는다. 쓰기 열쇠 · 쿠키 값은 기록에 없다(시험이 본다).

## 2. 경로

틀 서버:

| 경로 | 하는 일 |
|---|---|
| `GET /` | 틀(`host/frame/index.html`). CSP `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' <웹뷰 출처>; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`. `?theme=dark|light` |
| `GET /?t=<토큰>` · `/ui/?t=` | 브라우저의 첫 진입 — 1절 |
| `GET /frame/<파일>` | 틀의 스크립트 · 스타일 |
| `GET /api/wv-key?id=<웹뷰 id>` | **V5 · V5b-06** — 그 웹뷰의 열쇠 `{id, key, origin}`. 쓰기 열쇠가 있어야 한다. `id` 가 없으면 400, 없는 웹뷰면 404 |
| `GET /api/events` | 틀의 이벤트(SSE). 첫 사건 `hello {lastSeq, state}`, 그 뒤 `{seq, at, type, source, data}`. `Last-Event-ID` 로 최근 500건 다시 받기 |
| `GET /api/state` | `{designer, webviews[{id, viewType, title, pinned, visible, connected, ready, url}], theme, ui, webviewOrigin, currentFile, currentName, platform{progress, pending}, lastSeq}` — `url` 은 웹뷰 서버의 절대 주소, `ui` = `/ui/` 를 내주는가(U1) |
| `POST /api/platform/answer` | `{qid, answer}` — 4절. 형식이 틀리면 400 과 까닭. 쓰기 열쇠 |
| `POST /api/webviews/<id>/close` | 웹뷰 닫기(좌굴 보고서 칸의 ✕). 설계 패널은 고정이라 숨김이 될 뿐 없어지지 않는다(S1). 쓰기 열쇠 |
| `GET·POST /api/mcp/<경로>` | 호스트 MCP 다리로 중계(`/status` · `/action` · `/last-call`). 다리가 MCP 토큰을 붙인다 — 화면에는 그 토큰이 가지 않는다. 화면의 머리(쿠키 · Origin)는 넘기지 않고, AI 호출 표시 `X-StCFSD-Request-Id` 도 붙이지 않는다(이 조회는 「마지막 호출」로 세지 않는다). POST 는 쓰기 열쇠. MCP 다리의 `GET /hello` · `X-StCFSD-Proof`(K1 V5-09)는 MCP 서버가 쓰는 것이라 중계는 쓰지 않는다 |
| `GET /ui/viewer3d/viewer3d.js` · `/ui/viewer3d/viewer3d.mode-shape-renderer.js` | 새 검토 화면의 3D 모드 형상(아래 「3D 렌더러를 새 화면에서」) — 제품의 렌더러 번들(`media/` 의 이 두 파일만, 다른 이름 · `.map` 은 404)을 화면과 같은 출처로. `uiDir` 를 줄 때만 |
| `POST /api/report` | **U5(K3)** — `{kind: 'design' \| 'buckling', format: 'html' \| 'pdf' \| 'both', units: 'SI' \| 'US'}` 만 받는다(그 밖의 키 — 경로 · 폴더 — 는 읽지 않는다). 다리가 호스트 동작 `generate_report` 를 부르고(자리 · 이름은 호스트가 정한다: 열린 `.csd` 의 폴더 · 없으면 임시 폴더의 `stcfsd-reports`), 호스트가 쓴 HTML 파일을 읽어 `{reply, html, sha256}` 로 준다 — 새 화면의 미리보기(sandbox iframe 의 srcdoc). 쓰기 열쇠가 있어야 한다 |
| `GET /` | **U4** — 기본 화면: 새 검토 화면이 있으면 `/ui/` 로 303(질의 그대로). `startBridge({ defaultScreen: 'classic' })`(serve · 창의 `--ui classic`)이면 예전의 틀 HTML |
| `GET /ui/` · `/ui/index.html` · `/ui/dist/<파일>` · `/ui/style/<파일>` | **U1** — 새 검토 화면(`startBridge({ uiDir })`, serve 는 `<저장소>/desktop/ui`, 설치본은 `resources/app/ui` — 껍데기의 `--ui` 일 때). HTML 의 CSP 는 틀과 같다. 소스(`src/`) · 시험 · `build.mjs` 는 내주지 않는다(404). `uiDir` 를 주지 않으면 이 경로는 없다(404). 기본 화면 `/` 는 이것과 상관없이 틀이다 |
| `GET /api/wv/<id>/last?command=a&command=b` | **U1** — 다시 보내기 기록(5절)에 남은 그 명령의 마지막 메시지 `{success, data: {a: {seq, message: {command, data}} \| null, …}, seq}`. 페이지가 새로 고침하면 받을 것과 같다: 결과를 지우는 메시지가 지운 결과는 `null`, 한 번만 뜻이 있는 명령(`collectDesignData` · `propertiesResult` …)은 늘 `null`. 40 개까지 |
| `GET /api/wv/<id>/first?command=modelLoaded` | **U1** — 그 명령의 첫 메시지(다리가 처음 보낸 webviewReady 에 호스트가 채운 기본 모델) |
| (새 화면의 「열기」 · 「저장」) | 끼운 설계 화면의 Open · Save 단추를 누른다 — 다른 출처라 문서에 닿지 않으므로 postMessage `{type:'click', id}` 로 다리의 수신부에 부탁한다(정해 둔 둘: `btn-file-open` · `btn-file-save`) |
| `GET /api/claude/status` | `{state, ui, configPath, configKind, configExists, configError?, otherServers, lastAiCall, aiCalls, canConnect, canDisconnect, restartNeeded, text, tooltip}` — K1 `checkClaudeDesktop`(설정을 읽기만) + MCP `GET /last-call`. 9절 |
| `POST /api/claude/connect` · `POST /api/claude/disconnect` | **S4** — 본문 `{}`(JSON 이어야 한다). 읽기 인증 + 쓰기 열쇠. `{result: {ok, action, reason?, error?, wrote, backupPath?, restartRequired, message}, status}`. 9절 |

웹뷰 서버:

| 경로 | 하는 일 |
|---|---|
| `GET /wv/<id>/?theme=` | 웹뷰 HTML(3절). `<id>` 는 hub 의 id(`panel:stcfsd.designer:1` 꼴, URL 인코딩). 머리 CSP 는 `frame-ancestors <틀 출처>` 만(본 정책은 meta) |
| `GET /res/webview/<경로>` · `/res/media/<경로>` | 웹뷰 리소스. 뿌리는 이 둘뿐(패널의 localResourceRoots). `..` · 빈 마디 · `\` · NUL · `:` · 심볼릭 링크로 뿌리 밖을 가리키면 404(시험은 경로를 날것으로 보낸다 — `fetch` 는 `%2e%2e` 를 먼저 정리한다) |
| `GET /api/wv/<id>/out?k=<웹뷰 열쇠>` | 호스트 → 웹뷰(SSE). 첫 사건 `hello {conn, webview, viewType}`, 다시 보내기를 마치면 `replayed {count, commands}`, 그 뒤 `data:` = 호스트가 보낸 `{command, data}` 그대로. 다른 페이지가 같은 웹뷰를 열면 앞의 것에 `superseded` |
| `POST /api/wv/<id>/in?conn=<conn>` | 웹뷰 → 호스트(`X-StCFSD-Webview-Key`). 본문은 메시지 배열. `conn` 이 지금 연결이 아니면 409 |

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
| `file:current` | `{file, name}` — 지금 파일. 호스트의 사건 `panel.onCaseFile` (열기 · 저장 · 놓음, 8459629)과 `panel.caseFile()` 에서만 — 알림 글 · 대화상자의 답으로 짐작하지 않는다 |
| `claude:status` | `GET /api/claude/status` 와 같은 것 — 「연결」 · 「끊기」 뒤 |
| `host:message` | **U1** — 호스트가 설계 패널에 메시지를 보낼 때마다 `{id, viewType, command, seq}`(본문 없음 — `/api/wv/<id>/last` 로 읽는다). **U3**: `focusRequest`(AI 의 「여기를 보세요」 — 보기 계약 3절)는 본문을 `focus` 로, **U4**: `caseDiscarded`(저장하지 않은 변경을 버리고 열었다 — K2-6)는 본문을 `discarded` 로 싣는다. **U5**: `validationResult` 는 `validation: {case_rev, items: 수}` 만(본문은 싣지 않는다 — 새 화면은 그것을 신호로 호스트 동작 `validate_design` 을 다시 읽는다) — 다시 보내기 기록에 남지 않으므로(아래 ③) 새 화면은 이 이벤트로 한 번만 받는다. 다시 붙은 같은 페이지가 `Last-Event-ID` 로 다시 받으면 화면이 `request_id` 로 한 번만 따른다 |

### 틀 ↔ 끼운 웹뷰 (postMessage, `{stcfsdBridge: 1, type, …}`)

| 쪽 | type | 뜻 |
|---|---|---|
| 웹뷰 → 틀 | `need-key` | 웹뷰 열쇠를 달라. 틀은 그 창이 자기 iframe 이고 웹뷰 서버 출처일 때만 답한다 |
| 웹뷰 → 틀 | `keydown {key: 'F2'}` | 웹뷰 안에서 누른 F2(새 화면의 편집 상태) |
| 틀 → 웹뷰 | `key {key}` | 웹뷰 열쇠 — 받으면 통로를 연다 |
| 틀 → 웹뷰 | `theme {theme}` | 테마를 새로 고침 없이 바꾼다(V5-03): 테마 `<style>` · `<body>` 클래스 · `data-vscode-theme-kind` |
| 틀 → 웹뷰 | `click {id}` | 정해 둔 단추를 누른다(`btn-file-open` · `btn-file-save`) |

웹뷰의 수신부는 틀 출처 · 부모 창에서 온 것만 받고, 이 메시지들은 페이지(app.js)에 넘기지 않는다.

## 3. 웹뷰 HTML 고쳐 쓰기(`inject.ts`)

확장 소스 `src/webview/StcfsdPanel.ts`(`_getHtmlForWebview` · `_wrapBucklingReport`)와 `webview/` 는 한 글자도 바꾸지 않는다. 내줄 때만:

1. **리소스 주소** `https://file+.vscode-resource.vscode-cdn.net/<절대경로>`(`%2B` 꼴 포함) → `/res/<뿌리>/<상대>`. 밖이면 `/res/denied`(404).
2. **CSP** — 패널이 쓴 정책을 그대로 두고 셋만 바꾼다: `cspSource`(`https://*.vscode-cdn.net`) → `'self'`(= 웹뷰 서버), `'nonce-…'` → 요청마다 새 nonce, `connect-src 'self'` 더하기. 설계 패널의 `'unsafe-eval'`(3D 뷰어)은 그대로. **원래 nonce 와 같은 값**을 단 태그만 새 nonce 로 바꾼다(V5-18a) — 좌굴 보고서 HTML 처럼 페이지가 보낸 문자열에 다른 nonce 를 단 `<script>` 가 섞여도 새 정책에 맞지 않아 돌지 않는다(VS Code 와 같다).
3. **CSP meta 바로 뒤**(웹뷰 스타일 · 스크립트보다 앞): 테마 `<style>`(`--vscode-*` 변수 + VS Code 기본 웹뷰 스타일) · 수신부 `<script>`(`acquireVsCodeApi()` 대체: `postMessage` → `/in`, `getState`/`setState` → sessionStorage, 받는 것은 표준 `message` 사건, 웹뷰 열쇠 · 테마 · 단추(2절 끝), 새로 고침 앞의 입력 보존(5절)).
4. **`<body>`** `vscode-dark` / `vscode-light` 클래스 + `data-vscode-theme-kind`.

테마(`theme.ts`): 웹뷰가 쓰는 변수 38종(theme.css · webview/js · 패널 HTML 을 훑은 목록)을 Dark Modern / Light Modern 값으로 모두 정의한다. 빠진 것이 있으면 `host/build.mjs` 가 빌드를 멈추고 `test/bridge.mjs` 가 실패한다. 웹뷰 안의 하드코딩 색(대부분 어두운 테마 전제, 약 200곳)은 그대로다 — 밝은 테마는 본 화면의 글자 대비를 시험으로 본다(최저 10.6, 어두운 테마 6.1). 테마 바꾸기는 페이지를 다시 싣지 않는다 — 두 테마의 CSS 를 수신부가 들고 있다가 갈아 끼운다. 이미 그린 캔버스 · 그래프는 다음에 그릴 때 새 색이 된다.

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

## 5. 메시지와 새로 고침 — 다시 보내기(`channel.ts`) · 입력 보존(`inject.ts`)

VS Code 웹뷰는 `retainContextWhenHidden` 이라 다시 뜨지 않는다. 호스트는 모델 · 결과를 **밀어 줄 뿐** 다시 보내는 길이 없고, `webviewReady` 를 다시 받으면 모델을 기본 단면으로 덮어쓴다. 그래서:

- 설계 패널의 `webviewReady` 는 다리가 뜰 때 **한 번만** 호스트에 보낸다(VS Code 에서 패널이 처음 뜬 때와 같은 자리). 페이지가 보내는 `webviewReady` 는 넘기지 않고 "받을 준비 됨" 으로만 쓴다. 그래서 `serve --open` 으로 화면보다 먼저 연 파일도 지워지지 않는다.
- 호스트 → 웹뷰 메시지는 번호와 함께 기록된다. 페이지가 준비되면(처음이든 새로 고침이든, 다른 탭이든) 줄인 기록을 차례대로 보내고(`replayed`), 그 뒤로는 오는 대로 보낸다.
- 줄이는 규칙: ① 같은 명령은 마지막 것만(남은 것끼리는 원래 차례) ② `resultsCleared` · `analysisInvalidated` · `derivedResultsInvalidated`(U3 — 호스트가 MCP `analyze_loads` 의 바뀐 입력으로 부재 설계 · 랩 결과를 지웠다: `designResult` · `designPurlinResult` · `lapConnectionResult` 를 뺀다, 새로 고침이 낡은 판정을 되살리지 않게) 가 오면 그것이 지우는 앞의 결과를 뺀다 ③ 한 번만 뜻이 있는 `collectDesignData`(다시 보내면 저장이 돈다) · `captureSection` · `showSection` · `focusRequest`(U3 — 새로 고침 때 화면이 다시 따라가지 않게) · K2 의 `caseState` · `caseAck` · `caseDiscarded` · `restoreDesignInputs` · K3 의 `validationResult {items}` · `reportResult {html}`(페이지가 `runValidation` · `generateReport` 로 물은 것의 답 — 다시 실린 페이지는 다시 묻는다)는 남기지 않는다 — 다시 실린 페이지는 그 페이지의 `caseHello` 에 호스트가 지금 상태를 새로 보낸다(다리가 뜰 때 입력 없는 첫 `caseHello` 를 한 번 내므로 페이지의 것은 늘 「두 번째」다). 붙었지만 다시 보내기를 마치지 않은 페이지에 온 한 번만 뜻이 있는 메시지는 다시 보내기 뒤에 그 페이지에만 보낸다(다음 페이지에는 가지 않는다). `caseDirty` · `caseReference` 는 마지막 것만 ④ 웹뷰가 그릴 때마다 스스로 다시 묻는 `propertiesResult` · `propertiesError` 는 남기지 않는다(남기면 도심 축이 두 번 그려졌다 — 시험에서 봄).
- 좌굴 보고서 패널은 `webviewReady` 를 보내지 않으므로 붙자마자 준비된 것으로 본다.
- SSE 가 끊겼다 다시 붙으면 페이지가 스스로 다시 읽는다(두 번째 `hello`) — 위의 다시 보내기로 돌아온다.
- **(U4 에서 걷어 냄 — K2 가 대신한다) 아직 호스트에 가지 않은 설계 탭 입력(V5-03)**: 설계 탭 입력은 칠 때마다 호스트의 검토 상태로 간다(`caseEdit`). 수신부는 `pagehide` 에 지금 칸의 밀린 변경(300 ms 모음)만 `change` 로 내게 해 `keepalive` 로 보낸다. 아래는 예전의 기법이다(지난 값을 파일에서 온 것처럼 다시 쓸 수 있어 없앴다): 새로 고침 · 다시 싣기 앞(`pagehide`)에 수신부가 페이지 자신의 저장 길로 입력을 모은다 — 페이지에 `collectDesignData` 를 호스트가 보낸 것처럼 넣고, 페이지가 돌려주는 `designDataCollected`(파일에 저장하는 것과 같은 꼴, 단위계 포함)를 **호스트로 보내지 않고** 이 탭의 sessionStorage(웹뷰 출처)에 둔다. 다시 뜬 페이지는 다시 보내기를 마친 뒤 그것을 `restoreDesignInputs`(파일을 열 때와 같은 길)로 되돌린다(`<html data-stcfsd-preserved="restored">`). **같은 파일일 때만(V5b-02)**: 모을 때 그 페이지가 마지막으로 받은 `resultsCleared` · `restoreDesignInputs` 의 순서 번호(SSE `id` — 호스트가 다른 파일을 열 때마다 이 둘을 새로 보낸다)를 함께 두고, 다시 보내기의 것과 다르면(그사이 호스트가 다른 파일을 열었으면) 버리고 페이지의 상태 줄에 「새로 고침하는 동안 다른 파일이 열려 … 되살리지 않았습니다 — 지금 파일의 값입니다」 를 쓴다(`data-stcfsd-preserved="dropped-other-file"`). 10 분 넘은 것도 버린다(`dropped-stale`). AI 의 `load_project`(모델만 바꾸고 설계 탭 입력은 건드리지 않는다)는 파일 바뀜으로 치지 않는다 — 페이지가 떠 있을 때와 같다. 테마 바꾸기는 다시 싣지 않으므로 이 길도 필요 없다. 남는 것: 탭 · 창을 닫거나 프로그램이 끝나면 sessionStorage 도 사라진다(저장하지 않은 입력은 파일에만 남는다).

## 6. PDF · 보고서

- 보고서 탭 「PDF 저장」(`saveReportPdf`)과 좌굴 보고서 패널의 「PDF / HTML 저장」(`savePdf`)은 호스트가 처리한다 — 저장 물음(4절) → 이 PC 의 Edge/Chrome 을 `--headless=new --print-to-pdf` 로 띄워 인쇄(`StcfsdPanel._saveReportPdf`). 다리에서 그대로 돈다(시험: 두 PDF 모두 `%PDF`).
- **S3 가 바꿀 것**: 설치본 PC 에 Edge 가 없을 수 있고, 따로 띄운 브라우저 프로필이 느리다. Electron 의 `webContents.printToPDF` 로 바꾸려면 호스트가 브라우저를 찾는 길(`_findBrowser`)을 대신할 갈고리가 필요하다 — 지금 확장 코드에는 없다(제품 쪽 공용 변경 후보: "PDF 인쇄기" 주입점, 기본값은 지금의 Edge headless).

## 7. CLI

```
node desktop/host/dist/serve.js [--open <파일.csd>]… [--theme dark|light] [--port <다리 포트>] [--port-file <MCP 포트 파일>]
                                [--python <python.exe>] [--user-data <폴더>] [--documents <폴더>] [--claude-config <파일>] [--repo <루트>] [--ui [classic]]
```

출력: `화면: http://127.0.0.1:<포트>/?t=<토큰>` — 브라우저로 연다(개발 길 — 1절). `--ui` 면 `화면: http://127.0.0.1:<포트>/ui/?t=<토큰>`(새 검토 화면 — U1). serve 는 두 경우 모두 `/ui/` 를 내준다(`desktop/ui/index.html` 이 있으면). 마지막 시작 줄 `STCFSD_BRIDGE_READY {pid, url, uiUrl, screen, origin, port, webviewOrigin, writeKey, mcpPort, portFile, designer}` — 기계(시험)가 읽는 줄이라 쓰기 열쇠가 들어 있다(주소 · 쿠키에는 없다). `url` 은 언제나 틀(`/`)의 주소, `uiUrl` 은 새 화면의 주소(없으면 null), `screen` = `frame` · `ui`. 끝내기: Ctrl+C · Ctrl+Break · IPC `shutdown`(IPC `status` 는 미구현 · 메시지 수 · 통로 · 물음 기록). 다리 → 호스트 순서로 정리한다.

## 8. 아직 다리로 안 되는 것

- **클립보드**(`보고서 클립보드 복사` — `navigator.clipboard`): 127.0.0.1 은 보안 컨텍스트라 보통 브라우저에서는 된다. 시험(headless)에서는 확인하지 않았다.
- **사이드바 트리**(`stcfsd.projectExplorer`)는 객체만 있다 — 틀에 그리지 않는다. 새 화면(U1)은 이 트리를 쓰지 않고 자기 트리(탭 4개)를 MCP · 메시지에서 짓는다.
- **두 탭**: 같은 웹뷰를 두 탭에서 열면 뒤의 것이 이기고 앞의 것은 멈춘다(`superseded`). 물음은 붙은 틀 모두에 가고 먼저 답한 것이 쓰인다. 브라우저의 새 탭에는 쓰기 열쇠가 없다(sessionStorage 는 탭마다) — 「화면:」 주소를 그 탭에서 다시 연다.
- **보통 브라우저로 띄웠을 때(serve)의 것**: OS 파일 대화상자 · 문서 폴더(OneDrive 로 옮긴 경우)는 S3 의 창에서만. PDF 는 두 경우 모두 호스트가 Edge headless 로 인쇄(6절).

## 9. Claude Desktop 연결(S4)

틀의 제목 표시줄: 상태 글(`text`, 풍선 도움말 `tooltip`) + 단추 하나 — `canDisconnect` 면 「끊기」, `canConnect` 면 「연결」, Claude 가 없거나 설정이 깨졌으면 누를 수 없는 「연결」. 10 초마다 `/api/claude/status` 를 다시 읽는다(AI 가 처음 부르면 「연결됨」으로).

| ui | 글 |
|---|---|
| `not-installed` | Claude Desktop 없음 |
| `invalid-config` | Claude 설정 파일을 읽을 수 없음 — 풍선 도움말 · 「연결」 결과는 까닭마다: JSON 이 아님 · 맨 위가 객체가 아님 · mcpServers 가 객체가 아님 · **같은 이름이 두 번**(다시 쓰면 하나가 사라지므로 손대지 않는다, K1 V5-15a) |
| `not-registered` | Claude 등록 안 됨 |
| `registered-elsewhere` | Claude 다른 설치를 가리킴(경로의 대소문자 · `/`·`\` 차이는 같은 것으로 본다 — K1 V5-15d) |
| `restart-needed` | Claude 등록됨 · Claude Desktop 다시 시작 필요(이 실행에서 「연결」했고 그 뒤 AI 호출이 없다) |
| `registered` | Claude 등록됨 · 아직 호출 없음 |
| `connected` | Claude 연결됨 · 마지막 호출 HH:MM · <클라이언트>(등록돼 있고 AI 가 이 호스트를 불렀다) |

「연결」 · 「끊기」 결과 `reason`: `claude-not-installed` · `invalid-config`(위의 까닭) · `write-failed` · **`config-busy`**(K1 V5-06 — 쓰는 동안 Claude Desktop 등이 설정을 거듭 바꿔 4번 다 시도하고도 쓰지 않음, 파일 그대로 — 「잠시 뒤 다시 누르세요」).

넣는 항목(`startBridge({ claude: { entry } })`): 껍데기는 `standaloneMcpEntry({ command: process.execPath, serverScript: <배치의 media/mcp-server.js>, portFile: <사용자 폴더>/mcp/stcfsd-mcp-port, electron: true })` 를 준다 — `ELECTRON_RUN_AS_NODE=1` 이 붙는다. 주지 않으면(`serve`) 호스트의 항목(이 node 로 띄움). 쓰기의 규칙(백업 — 우리 것 최근 5개만 · 원자적 쓰기 · 심볼릭 링크는 대상에 · 하드 링크는 그 자리에 · 다시 읽어 확인 · 다른 항목 그대로 · 깨진 JSON 은 손대지 않음 · 미설치면 폴더를 만들지 않음 · 끊기는 같은 항목만)은 K1 의 도우미가 지킨다(`docs/reviews/20261122-engine-review/fixes/K1-mcp-connection.md`). 시험은 `claude: { configPath }` 로 임시 폴더의 가짜 파일만 준다(`host/test/connect.mjs`, `shell/test/shell.mjs`). 설치본을 제거하면 제거 프로그램이 같은 도우미로 이 설치본의 항목을 지운다(`desktop/installer/README.md`).

**AI(MCP 쪽)는 Claude 설정에 닿는가 — 지금 참인 것**: 등록 · 지우기 경로는 화면 다리의 두 POST 뿐이고(읽기 인증 + 쓰기 열쇠), AI 가 붙는 호스트의 MCP 다리에는 그런 경로가 없다(시험: 중계 · MCP 다리 직접 모두 `Unknown endpoint`). AI 의 도구가 파일을 쓰는 길은 `save_project` 하나다 — V5-01(공용 코드 `4497b34`)부터 그것은 이미 있는 파일을 덮어쓰지 않는다(자기가 쓴 StCFSD 모델 파일이 아니면 거절). 그래서 MCP `save_project` 로 Claude 설정 파일을 겨누면 거절되고 파일은 바이트까지 그대로다 — `test/connect.mjs` 가 화면의 중계(AI 와 같은 호스트 동작)로 시험한다. 「AI 는 Claude 설정에 닿지 않는다」 는 이 둘을 합친 말이다.

MCP 다리(호스트 쪽, 포트 파일 방식)는 K1 V5 · V5b 부터: MCP 서버가 처음 붙을 때 `GET /hello` 하나를 보낸다 — **토큰을 싣지 않는다**(V5b-05: 포트만 차지한 다른 프로그램이 토큰을 받지 못하게). 호스트는 그 응답에 `X-StCFSD-Proof`(토큰과 포트 파일의 instanceId · 요청의 nonce 로 만든 HMAC)를 붙이고, MCP 서버는 그것을 확인한 뒤에만 토큰을 싣는다 — 포트 파일의 pid 가 재사용돼 남의 서버가 그 포트에 있어도 그쪽으로 요청 · 토큰을 보내지 않게. MCP 서버는 확인한 프로그램을 포트 파일 옆에 **MCP 프로세스마다** 적는다(토큰 없음): `stcfsd-mcp-port.client-<이름>-<해시 8자>.p-<pid>-<시작 ms 36진>`, 끝난 프로세스의 기록은 `….client-<이름>-<해시>.stale` 하나로 접힌다(V5b-10). 새로 뜬 MCP 서버(Claude Desktop 재시작)는 같은 이름의 모든 기록이 지금의 프로그램을 가리킬 때만 알림 없이 쓰고, 아니면 `get_status` 한 번 전에는 다른 도구를 받지 않는다 — 그때 AI 가 받는 글은 「The StCFSD program has been restarted since an earlier session of this AI app last used it (or that cannot be ruled out) … This request was not sent. Call get_status to check the current state, then continue.」, 그 `get_status` 에는 같은 뜻의 알림이 붙는다(같은 MCP 서버 안의 재시작은 「The StCFSD program was restarted since your last call. …」). 이 기록 · `.stale` 은 `%APPDATA%\StCFSD\mcp\` 에 남고 제거해도 지우지 않는다. 화면 다리의 중계는 `/hello` · 증명 · 기록을 쓰지 않는다(다리가 토큰을 붙이는 같은 프로세스 안의 호출이다).

### 3D 렌더러를 새 화면에서(새 검토 화면의 다음 단계가 쓸 길)

제품의 모드 형상 렌더러(`src/webview/viewer3d` → webpack → `media/viewer3d.js` + 지연 조각 `viewer3d.mode-shape-renderer.js`, Babylon.js)를 `/ui/` 가 **같은 출처**에서 싣는다 — 다리가 `/ui/viewer3d/<그 두 이름>` 만 내준다. **CSP 는 넓히지 않았다**: 번들은 `eval` · `new Function`(webpack 런타임의 `globalThis` 대비 한 줄은 브라우저에선 돌지 않는다) · WebAssembly 를 쓰지 않으므로 `'unsafe-eval'` · `'wasm-unsafe-eval'` 이 필요 없고, 지연 조각은 webpack 이 `<script src>` 로 같은 자리에서 싣는다(`script-src 'self'` 로 된다). 그래서 따로 가둔 iframe 도 두지 않는다. 시험 `ui/test/ui.mjs` 의 u3d: 화면의 CSP 그대로 번들을 싣고 `analysisComplete.shapes` 의 첫 모양을 그린다(메시 · 꼭짓점 > 0, CSP 위반 · 예외 0, 다른 이름 404).

새 화면이 쓰는 법(정확히):

```js
// 1) 한 번만 — 화면의 스크립트가 <script> 를 더한다(인라인 아님)
const s = document.createElement('script'); s.src = '/ui/viewer3d/viewer3d.js'; document.head.appendChild(s);
await new Promise((ok, no) => { s.onload = ok; s.onerror = no; });
// 2) 캔버스 — render() 는 id 'mode-shape-3d-canvas' 를 찾는다(또는 먼저 CufsmViewer3D.init(<다른 id>))
// 3) 자료 — 웹뷰가 받은 것 그대로: GET /api/wv/<설계 id>/last?command=analysisComplete&command=modelLoaded
const a = last.analysisComplete.message.data, m = last.modelLoaded.message.data;
const shape = a.shapes[lengthIdx];                                    // 반파장 하나의 모드 행렬
const modeVec = Array.isArray(shape[0]) ? shape.map(r => r[modeIdx] || 0) : shape;
await window.CufsmViewer3D.render({ nodes: m.node, elems: m.elem, modeVec, length: a.curve[lengthIdx][0], BC: m.BC || 'S-S', scale: 0.3 });
```

(이것은 웹뷰의 `renderModeShape3DWrapper`(webview/js/app.js)가 하는 것과 같다. WebGL 이 없는 PC 에서는 `render` 가 던진다 — 웹뷰처럼 2D 로 물러설지는 화면이 정한다.)


## K3 — 검증 · 계산서(U5, f08e10e)

페이지 → 호스트 `runValidation {unitSystem}` · `generateReport {unitSystem, force?, reason?}` · `saveReport` · `showBucklingReport {charts, dsmHtml}`(그림은 화면에만 있는 캔버스 PNG), 호스트 → 페이지 `validationResult {items, unitSystem, case_rev}` · `reportResult {html, case_rev}` — 다리는 모두 그대로 넘긴다(받는 쪽 목록이 따로 없다). `validationResult` · `reportResult` 는 한 번만 뜻이 있는 답이라 다시 보내기 기록에 남지 않는다(2절 ③). 시험: `test/bridge.mjs` s14e(페이지의 검증 · 보고서 단추 → 답이 페이지에 · 기록에 없음 · 새로 고침 뒤 빈 칸 · `/api/report` 의 파일 = 응답 HTML 의 sha256 · 준 경로 무시).


## V7 — 다시 보내기는 지금 것의 근거가 아니다 · 열기 앞의 물음(U5)

- **결과의 다시 보내기(V7-40)**: 설계 패널의 페이지가 (다시) 실리면 다리는 기록을 보내기 **전에** 호스트 동작 `get_full_state` 의 `results` 를 읽어,
  거기 없는(좌굴 해석은 `current: false` 인) 결과의 메시지를 보내지 않고 기록에서도 지운다 — `analysisComplete` · `dsmResult` · `classifyResult` →
  `buckling_analysis`, `designDsmPrepared` → `design_dsm`, `loadAnalysisComplete` → `load_analysis`, `designResult` · `designPurlinResult` → `member_design`,
  `lapConnectionResult` → `lap`, `connectionResult` → `connection`. 읽지 못하면 결과 메시지를 모두 뺀다(기록을 믿지 않는다). `replayed` 이벤트에 `dropped`.
  호스트의 `resultsLedger {results}` 가 올 때도 같은 규칙으로 기록을 지운다(화면이 시작한 무효화 — 호스트가 결과를 지우는 메시지를 따로 보내지 않는 경우).
- **무효화의 범위(V7-45)**: `derivedResultsInvalidated {scope}` — `connection` → 단일 접합만, `lap` → 랩만, `load` → 하중 해석 + 부재 설계 · 랩,
  `design`(그 밖) → 부재 설계 · 랩(호스트 `_invalidateDerived` 와 같은 표). `kinds`(지운 결과 이름 목록)가 오면 그것을 따른다(호스트가 낼 일반 계약 자리).
- **열기 앞의 물음(V7-41)**: 페이지가 보낸 `openProject`(끼운 화면의 Open — 새 화면의 Ctrl+O · 시작 화면 · 제목 표시줄도 이 단추를 누른다)는
  넘기기 전에 `startBridge({ beforeReplace })`(창은 자기의 confirmUnsaved) 또는 다리의 기본(`host/src/unsaved.ts` confirmUnsaved — 화면 안의 물음 ·
  화면 안의 저장 자리 물음)을 부른다. 취소면 넘기지 않는다.
- **밀린 입력(V7-44)**: 수신부가 `window.__stcfsdFlush()` 를 둔다 — 지금 칸에 `change` 를 일으켜 밀린 `caseEdit` 를 내고 보내기가 끝날 때까지(1.2 초까지) 기다린다. 창이 닫기 물음 앞에 부른다.
- 시험: `test/bridge.mjs` s14f(설계 → 페이지에서 Lb → 새로 고침 → 카드 없음) · s14g(connT1 → 접합만 지움, 설계는 남음). 고치기 전의 다리로 돌리면 둘 다 실패한다(확인함).

- **4b99968 뒤**: 호스트가 결과를 지울 때마다 `derivedResultsInvalidated {kinds, scope: 'kinds'}` — 다리는 `kinds` 를 「이것을 지워라」의 근거로 쓰고(결과 이름 → 메시지: 위 표 + `validation` → `validationResult`), `get_full_state.results` 와의 맞춤은 둘째 안전으로 남긴다. `validationResult` 는 이제 결과처럼 남는다(호스트가 `results.validation` 으로 쥔 동안 — 새 화면이 새로 고친 뒤 마지막 점검의 항목을 읽는다). 시험 s14e(점검 뒤 입력 → kinds ['validation'] → 기록에서 사라짐).

## R1-3 — 기록 갈래: 화면 비밀 · 사람만 하는 길(`/api/person/*`)

- **화면 비밀**: 새 화면의 중계(`/api/mcp/*` · 다리 안의 호스트 동작)는 같은 프로세스의 `out/mcp/actorScope.js` `SCREEN_SECRET` 을 `X-StCFSD-Screen` 에 싣는다(적재기 `screenSecret()`). 들어온 요청의 머리는 넘기지 않으므로 끼운 웹뷰 · MCP 토큰을 가진 쪽은 낼 수 없다 — 새 화면이 시작한 실행은 사람(`person`)의 것, MCP 도구의 실행은 `ai` 로 적힌다.
- **`/api/person/*`**(`bridge/person.ts`): `GET recent`(사람의 얼굴 `projects()` · `currentProject()` · `writerName()` — 폴더 경로는 이 화면에만, 215cb5a) · `POST open-folder`(본문 무시 — OS 폴더 물음) · `new-project`(이름 물음 → 첫 뿌리) · `open-project {name}` · `open-case {name}`(저장 안 한 변경을 먼저 묻는다 — 하나의 함수) · `new-case {kind}`(이름 물음 → new_case → open_case) · `make-project`(열린 프로젝트에 지금 파일을 new_case from current — 원본 그대로) · `take-lock {case_id?}`(묻는다) · `archive {case_id?, archived}` · `relink {case_id?}`(파일은 OS 대화상자) · `writer-name`(이름 물음 → `setWriterName`) · `overwrite`(묻는다 → `allowOverwrite` → `save_case`) · `edit-session {state}`(R2-3 — 편집 상태의 시작 · 끝 · 버리기를 사람의 문맥에서 `panel.editSession`). `open-source {id}`(R3-3 — 01_원자료 안의 등록된 파일만 OS 로, 내용은 읽지 않는다) · `review {mark, targets[]}`(R4 — 확인 표시: 대상의 꼴만 보고 `person.review`, `shown` 이 지금 지문과 다르면 호스트가 거절) · `trust {writer_id, trust}`(R4 — `person.trust`) · `alternative {op: keep | rename | drop | undrop, item?, label?}`(R4 — `person.alternative`, de93aa9) · `issue/preview`(R5 — `person.issuePreview` + 그 초안의 HTML `draft_html`, 다리가 내준 일회용 숫자의 때만 기억) · `issue {fingerprint, nonce}`(R5 — `person.issue`, 인쇄를 기다린다. 호스트가 던지면 다리가 아는 것으로 까닭의 부호 `data.code`: `nonce-unknown | nonce-used | nonce-expired | changed | blocked | failed` 와 한국어 글) · `export {item?}`(R5 — 초안의 PDF(없으면 HTML)를 사람의 저장 대화상자로 복사, 막는 것과 무관) · `open-doc {item}`(R5 — 초안 · 발행본의 PDF 를 OS 로) · `GET doc-file?item=`(R5 — 기록에 있는 초안 · 발행본의 HTML, 03_계산서 · 04_발행본 안만, 읽기만). 호스트가 부호(`.code` — `host.review.*` 등)와 함께 던지면 답에 `error_code`. `case_id` 는 열린 프로젝트의 `list_cases` 에 있는 것만(없으면 지금 대상). 받는 요청: 읽기 인증(다리 토큰 — MCP 토큰은 401) + 쓰기 열쇠(POST) + `Origin` = 틀 + `Sec-Fetch-Site: same-origin` + JSON + 본문 4 KB. 경로 · 폴더는 본문에서 읽지 않는다. **R2-3:** AI(MCP 문맥)의 호스트 동작 하나마다 이벤트 `ai:work {phase: begin | end, tool, request_id, at}` — 적재기가 패널의 `handleMcpAction` 을 지켜보기만 한다(새 화면의 「AI 작업 중」 띠, 화면의 중계는 내지 않는다). 사람의 얼굴은 적재기의 `recordsPerson()`(같은 프로세스 — HTTP 로 드러나지 않는다). 바뀌면 이벤트 `person:changed`.
- 창(Electron)은 `/api/person/*` 의 쓰기에 맨 위 틀에서 사람의 입력(누름 · 키 — `input-event`)이 있은 뒤 2 초 안에만 열쇠를 붙인다(층 4). 새 화면의 끼운 iframe 은 `sandbox`(top navigation 없음).
- 시험: `ui/test/ui.mjs` r10 – r16, `shell/test/ui.mjs` 1d.
