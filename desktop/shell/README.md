# desktop/shell — StCFSD 독립 창 (S3) · Claude 연결 (S4) · 새 검토 화면 스위치 (U1)

2026-11-22 · 상태: **S3 · S4 끝(시험: 단위 19 / 19, 창 44 / 44 — 보이지 않는 창으로)** · **U1: `--ui` 로 새 검토 화면(창 시험 12 / 12)** — 기본은 여전히 틀이다(U4 에서 바꾼다).

Electron 주 프로세스 하나가 **같은 프로세스에서** 호스트(`../host` — 확장 호스트 `out/extension.js` 를 고치지 않고 돌린다)와
화면 다리를 띄우고, 창 하나에 다리의 틀(`/` — 제목 표시줄 + 지금의 설계 화면 탭 6개)을 싣는다. 자체 `package.json` 이라
Electron 은 호스트 · 확장의 의존성에 섞이지 않는다. StAnal `desktop/shell` 을 옮겨 StCFSD 에 맞춘 것이다.

## 돌리기(개발)

```
npx tsc -p ./                                   # 저장소 루트 — out/
cd desktop && npm install && npm run build      # 호스트 · 다리(host/dist)
cd shell && npm install                         # Electron 45.2.3 (+ esbuild · typescript)
npm start -- --open <파일.csd>                  # 창. 맨 인자로 줘도 된다: npm start -- a.csd
npm start -- --ui <파일.csd>                    # 새 검토 화면(U1, desktop/ui — cd desktop && npm run build 가 먼저). npm run start:ui 도 같다
npm test                                        # 형 검사 → 빌드 → 단위 시험 → 창 시험 → 새 화면 창 시험(모두 보이지 않는 창)
```

`npm install` 뒤 `node_modules/electron/dist/` 가 없으면(설치 스크립트가 돌지 않았으면) `node node_modules/electron/install.js` 를 한 번 돌린다(이 PC 는 Electron 내려받기 캐시 `%LOCALAPPDATA%\electron\Cache` 에 45.2.3 이 있어 거기서 풀었다).

인자: `[파일.csd]` · `--open <파일>` · `--user-data <폴더>` · `--theme dark|light` · `--ui`(새 검토 화면 — 창에 `/ui/` 를 싣는다. 다리에 `desktop/ui` 를 줄 때도 이때뿐이다. 설치본은 아직 `ui/` 를 묶지 않으므로 그 폴더가 없으면 로그에 남기고 틀을 연다). 환경 변수: `STCFSD_PYTHON`(다른 Python), `STCFSD_REPO_ROOT`(개발판의 저장소), `STCFSD_CLAUDE_CONFIG`(Claude 설정 파일을 바꿔 끼움 — 시험), `STCFSD_DOCUMENTS`(열기 · 저장의 기본 폴더의 부모 — 시험).

## 있는 것

| 파일 | 내용 |
|---|---|
| `src/main.ts` | 주 프로세스: 인자 · 사용자 폴더 → 단일 인스턴스 → 로그 → 파일 · Python 확인 → 자식 콘솔 숨김 → `createBridgePlatform`(OS 대화상자 · 외부 열기 · 시작 중 알림 갈고리) → `startHost` → `startBridge` → 창 · 메뉴. 시작 실패는 무엇이 · 로그가 어디인지 적은 오류 창 |
| `src/args.ts` | 명령줄(파일 연결 꼴 `StCFSD.exe a.csd` 포함) |
| `src/layout.ts` | 개발 · 설치본의 파일 자리(설치본은 S5 에서 정한다) |
| `src/windowState.ts` | 창 위치 · 크기 · 최대화 · 모니터 기억, 모니터 구성이 바뀌면 주 모니터 안으로(StAnal 그대로) |
| `src/winConsole.ts` | Windows: 자식 프로세스(Python 엔진 · 시작 점검의 `execSync`)에 콘솔 창이 뜨지 않게 `child_process` 를 감싼다(StAnal 그대로) |
| `src/log.ts` | `사용자 폴더\logs\main-<날짜>.log`(8 MiB 넘기면 다음 파일, 14일 · 64 MiB 넘는 것은 지움) |
| `src/preload.ts` | 화면에 `window.stcfsdShell = {isElectron, platform, version}` 만 |
| `test/winConsole.mjs` | 단위: 콘솔 숨김 · 인자 · 창 자리 |
| `test/shell.mjs` | 진짜 앱을 보이지 않게 띄우는 시험(아래) |
| `test/ui.mjs` | U1 — `--ui` 로 띄워 새 검토 화면을 보는 시험(아래 「새 검토 화면(U1)」) |

## 지키는 것

| 무엇 | 어떻게 |
|---|---|
| 보안 | `contextIsolation: true` · `sandbox: true`(`app.enableSandbox()`) · `nodeIntegration: false` · `webviewTag: false` · `webSecurity: true` · 개발자 도구는 개발판만. 다리 출처가 아닌 곳으로의 이동 · 리디렉트 · 새 창 · iframe 이동은 막고, http/https 는 OS 브라우저로(`shell.openExternal`). 세션의 바깥 네트워크 요청(http · ws · ftp)은 `webRequest` 에서 끊는다 — 원격 내용 없음. 권한은 「클립보드 쓰기」만 |
| 인증 | 쿠키를 쓰지 않는다. 메모리 세션(`session.fromPartition('stcfsd-bridge')` — `persist:` 없음, 캐시 없음)이 다리 출처로 보내는 모든 요청에 `Authorization: Bearer <다리 토큰>` 을 붙인다. 창에는 토큰 없는 주소를 싣는다 |
| 포커스 | 창을 보이는 것은 사용자가 실행했을 때 한 번과 다시 실행했을 때(second-instance)뿐. 호스트 · AI 의 변화로는 앞으로 꺼내지 않는다. **호스트의 물음**(단추 있는 알림 · 고르기 · 입력)은 틀 안의 상자로 뜨고, 창 제목이 「● 응답 필요 — …」 로 바뀌며, 창에 포커스가 없으면 작업 표시줄 단추만 깜빡인다(`flashFrame`) — 다른 프로그램에서 타이핑하는 사용자를 끌어오지 않는다 |
| 한 번만 실행 | `requestSingleInstanceLock` — 두 번째 실행은 넘겨받은 `.csd` 경로를 첫 프로세스에 주고 곧 끝난다. 첫 프로세스가 그 파일을 열고 창을 앞으로(사용자가 한 일이다). 잠금은 사용자 폴더마다다 |
| 창 자리 | `사용자 폴더\window.json`. 저장한 모니터가 없거나 창이 화면 밖이면 같은 크기로 주 모니터 가운데. 작업 영역보다 크면 줄인다 |
| 열기 · 저장 | 메뉴 「파일 › 열기 · 저장」은 화면의 Open · Save 단추와 같은 길(웹뷰 메시지 → 호스트 → **OS 대화상자**). 기본 자리는 문서\StCFSD — 그 폴더가 아직 없으면 만들지 않고 문서 폴더에서 연다. 명령줄 · 다시 실행 · 파일 연결로 넘어온 파일은 대화상자 없이 같은 「열기」 길로 연다 |
| 사용자 폴더 | `%APPDATA%\StCFSD`(`--user-data` 로 바꾼다 — 시험은 모두 바꾼다): 로그 · `window.json` · `shell.json`(테마) · `host\`(호스트 설정) · `chromium\`(Chromium 의 자기 파일) · `crashes\` · **MCP 포트 파일 `mcp\stcfsd-mcp-port`**(= K1 의 표준 자리) |
| 끝내기 | 창을 닫거나 메뉴 「끝내기」 → 다리 닫기 → 호스트 정리(MCP 다리 멈춤 · 포트 파일 지움 · Python 끝냄) → 끝. 남는 프로세스 · 포트 · 포트 파일 없음(시험이 센다) |
| 닫을 때 저장 확인 | **하지 않는다.** 호스트(`StcfsdPanel`)는 「고친 표시」를 내놓지 않고, 설계 탭 입력은 웹뷰에만 있다(K2 전). 모르는 것을 닫을 때마다 묻지 않는다. K2 가 입력을 호스트로 옮기면 넣을 수 있다 |
| Python 콘솔 창 | 확장은 `spawn(python)` · `execSync(python --version)` 에 `windowsHide` 를 주지 않는다 — 껍데기가 호스트를 읽기 전에 `child_process` 를 감싸 채운다(시험: Python 자식의 창 핸들 0) |

메뉴: **파일** 열기(Ctrl+O) · 저장(Ctrl+S) · 끝내기 / **보기** 새로 고침(Ctrl+R) · 어두운 · 밝은 테마 · 개발자 도구(개발판만) / **도움말** 버전 · 로그 폴더 열기. Windows 에서는 Alt 를 누를 때만 메뉴 막대가 보인다.

## Claude 연결(S4)

제목 표시줄 오른쪽에 상태 글과 「연결」 / 「끊기」 단추(설명은 풍선 도움말). 상태는 K1 의 `checkClaudeDesktop` + 호스트 MCP 다리의 `GET /last-call`:

| 글 | 뜻 | 단추 |
|---|---|---|
| Claude Desktop 없음 | 이 사용자 계정에 Claude 설정 폴더가 없다 | 「연결」(누를 수 없음) |
| Claude 설정 파일을 읽을 수 없음 | 깨진 JSON — 손대지 않는다 | 「연결」(누를 수 없음) |
| Claude 등록 안 됨 | `mcpServers.stcfsd` 가 없다 | 「연결」 |
| Claude 다른 설치를 가리킴 | `mcpServers.stcfsd` 가 다른 실행 파일 · 서버 · 포트 파일 | 「연결」(이 프로그램으로 고침) |
| Claude 등록됨 · Claude Desktop 다시 시작 필요 | 방금 「연결」했고 아직 Claude 가 부르지 않았다 | 「끊기」 |
| Claude 등록됨 · 아직 호출 없음 | 등록돼 있다 | 「끊기」 |
| Claude 연결됨 · 마지막 호출 16:20 · claude-ai/0.1 | 등록돼 있고 AI 가 이 프로그램을 불렀다 | 「끊기」 |

**「연결」이 쓰는 것** — 사용자가 단추를 눌렀을 때만, 화면 다리의 `POST /api/claude/connect`(화면의 세션만 — MCP 쪽에서는 닿지 않는다):
`%APPDATA%\Claude\claude_desktop_config.json`(또는 MSIX 설치의 같은 파일 — K1 이 고른다)의 `mcpServers.stcfsd` 하나를

```json
{ "command": "<이 프로그램의 실행 파일 — 설치본 StCFSD.exe, 개발판 electron.exe>",
  "args": ["<이 배치의 media\\mcp-server.js>"],
  "env": { "ELECTRON_RUN_AS_NODE": "1", "STCFSD_MCP_PORT_FILE": "%APPDATA%\\StCFSD\\mcp\\stcfsd-mcp-port", "STCFSD_MCP_STANDALONE": "1" } }
```

로 더하거나 고친다. 쓰기 전에 `<파일>.stcfsd-backup-<시각>` 백업, 임시 파일 + 이름 바꾸기, 다시 읽어 확인. 다른 서버 · 최상위 키 · BOM · 줄바꿈 · 들여쓰기는 그대로. 쓴 뒤 「Claude Desktop 을 한 번 다시 시작하세요」 풍선. 「끊기」는 이 프로그램의 항목과 **같은** `stcfsd` 만 지운다.

## 시험(`test/shell.mjs`, 약 60 – 100 초)

진짜 Electron 실행 파일로 진짜 앱을 띄운다(`STCFSD_SHELL_TEST=1`: 창 `show:false`, `show()` · `focus()` 를 부르지 않음, 대화상자는 「취소」 가짜 — 시험이 필요한 것만 제어 통로로 답을 넣는다). 사용자 폴더는 임시(공백 · 한글 포함), Claude 설정은 임시 폴더의 가짜, 모델은 임시 사본. 제어 통로는 부모가 IPC 로 띄웠을 때만 있다(주 프로세스에서 코드를 돌린다 — 네트워크로 열리지 않는다). 화면은 `executeJavaScript` 로 DOM 을 조작해 확인하고, 그림은 `invalidate()` + DevTools 프로토콜로 찍는다(한 번도 보이지 않은 창의 `capturePage()` 는 처음엔 실패하고 그 뒤로는 한 단계 낡은 그림을 준다 — 시험에서 봤다).

1. 파일 연결 꼴(`electron . a.csd`)로 띄움 → 포트 파일이 시험 폴더 안 → 그 파일이 열림 → 틀 · 설계 화면 · 단면(Bearer, 쿠키 0) → 보안 설정 · 바깥 주소 막기 → 그림
2. 창 안에서 DOM 으로 템플릿 → 해석 → 설계(판정 카드)
3. 메뉴 「저장」 → OS 저장 대화상자(기본 자리 = 문서, 문서\StCFSD 를 만들지 않음) → 파일(설계 입력 124칸) · 메뉴 「열기」 → 제목 표시줄
4. 호스트의 물음 → 창 제목 「● 응답 필요」 · 깜빡임 신호 · 화면에서 답 → 호스트가 받음
5. 두 번째 실행(같은 사용자 폴더 + 다른 파일) → 곧 끝남(코드 0) → 첫 프로세스가 그 파일을 엶
6. 창 자리 → 끝내기(자식 0) → `window.json` → 다시 띄우면 그 자리
7. 「연결」 → 가짜 설정에 항목 → **그 항목 그대로 Electron 실행 파일 + `ELECTRON_RUN_AS_NODE=1` 로 MCP 서버** → initialize · 도구 59개 · `get_status` → 제목 표시줄 「연결됨 · 마지막 호출 · 클라이언트」
8. 앱을 끄면 같은 MCP 클라이언트가 쉬운 말의 「실행 중이 아님」 → 화면 밖 자리를 써 두고 다시 띄우면 주 모니터 안 → 다시 시작 막기(다른 호출 거절 → `get_status` 통과 + `restart_notice` → 그 뒤 통과)
9. 「끊기」 → 우리 항목만 지움 · Python 자식의 창 핸들 0 · 창의 콘솔 오류 0 · 끝 → 포트 · 포트 파일
10. 남은 Electron · Python 0 · 진짜 Claude Desktop 설정 · `~/.claude` · `%APPDATA%\StCFSD` 의 크기 · 수정 시각 그대로(열지 않음) · 저장소 그대로

모든 단계에서 창은 보이지 않고 포커스를 받은 적이 없다(`isVisible` · `isFocused` · show · focus 사건 0 을 다섯 번 확인).

## 새 검토 화면(U1)

`--ui` 를 주면 창이 다리의 `/ui/`(`desktop/ui/`)를 싣는다 — 트리 · 보기 · 정보 창의 검토 화면이고, 지금의 설계 화면(탭 6개)은 그 안에 늘 끼워 두었다가 F2 로 연다. 메뉴의 「열기」 · 「저장」 · 새로 고침은 같은 길로 돈다. 테마는 `--ui` 면 페이지를 다시 싣지 않고 화면 안에서 바꾼다(`__stcfsdUi.setTheme` — 끼운 설계 화면의 보내지 않은 입력을 잃지 않게). 틀(`/`)은 지금처럼 다시 싣는다. 스위치가 없으면 지금처럼 틀(`/`)이다 — 기본 화면을 바꾸는 것은 U4 다. 설명은 [`../ui/README.md`](../ui/README.md).

시험(`test/ui.mjs`, 약 20 초): `--ui` + 파일 연결 꼴로 띄움 → 창의 주소가 토큰 없는 `/ui/` → 새 화면이 명령줄의 .csd 를 검토 화면(트리 · 정보 창 · 제목 표시줄)으로 → 끼운 설계 웹뷰가 연결 · 다시 보내기를 마치고 숨겨져 있다 → F2 로 열고 닫힌다 → 메뉴의 테마가 페이지를 다시 싣지 않고 바뀐다 → 쿠키 0 · 창의 콘솔 오류 0 → 그림(`test/out/u1_window_ui.png`) → 창은 보이지 않고 포커스 0 → 끝내기(코드 0 · 자식 0 · 포트 파일) → 진짜 설정 · 저장소 그대로.

## PDF

호스트의 「PDF 저장」(보고서 탭 · 좌굴 보고서 창)은 이 PC 의 Edge/Chrome 을 headless 로 띄워 인쇄한다(`StcfsdPanel._saveReportPdf`, `windowsHide: true`). 직원 PC(Windows)에는 Edge 가 있으므로 그 길을 그대로 둔다. Electron 의 인쇄(`webContents.printToPDF`)로 바꾸려면 호스트가 브라우저를 찾고 띄우는 자리(`_findBrowser` · `cp.spawn`)를 대신할 주입점이 확장 쪽에 있어야 한다 — 지금은 없다(제품 공용 변경 후보: 「PDF 인쇄기」 갈고리, 기본값은 지금의 Edge headless).

## 사람이 확인할 것(이 PC 에서, 보이는 창으로)

자동 시험은 창을 보이지 않으므로 다음은 소유자가 직접 본다.

1. `npm start -- <파일.csd>` — 창이 뜨고 제목 표시줄 · 메뉴(Alt) · 탭 6개가 보이는가, 창을 옮기고 크기를 바꾼 뒤 끄고 켜면 그 자리인가(모니터 두 대 · 화면 배율).
2. 메뉴 「저장」 · 「열기」의 OS 대화상자 모양과 기본 자리(문서 · 문서\StCFSD).
3. 다른 프로그램에서 타이핑하는 동안 StCFSD 가 물음을 내면 창이 앞으로 나오지 않고 작업 표시줄만 깜빡이는가(예: 화면의 Save 를 눌러 두고 다른 창으로 옮긴 뒤 — 또는 Claude 로 계산을 시킨 뒤).
4. 이미 떠 있을 때 탐색기에서 다른 `.csd` 로 다시 실행하면(파일 연결은 S5 의 설치 파일이 만든다 — 지금은 `npm start -- 다른.csd`) 창이 앞으로 나와 그 파일을 여는가.
5. **진짜 Claude Desktop**: 「연결」 → Claude Desktop 을 한 번 다시 시작 → 대화에서 StCFSD 도구가 보이고 `get_status` 가 되는가, 제목 표시줄이 「Claude 연결됨 · 마지막 호출」로 바뀌는가, StCFSD 를 껐다 켜면 Claude 가 「다시 시작됨」 안내를 받는가, 「끊기」 뒤 다시 시작하면 도구가 사라지는가. (개발판 항목은 `electron.exe` 를 가리킨다 — 설치본(S5)에서는 `StCFSD.exe`.)
6. 보고서의 PDF 저장(Edge headless)과 「보고서 클립보드 복사」.
7. 밝은 테마로 바꿨을 때 화면의 하드코딩된 어두운 색이 거슬리는 곳.
