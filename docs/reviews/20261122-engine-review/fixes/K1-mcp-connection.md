# K1 — MCP 연결 보강 (포트 파일 · 토큰 · 재시작 뒤 막기 · Claude Desktop 등록) 수정 기록

2026-11-22 · 근거: [구성안](../../../implementation/20261122-desktop-interface-proposal.md) §2.3 · §4(K1), [G1 StAnal 조사](../../20261122-desktop-survey/G1-stanal-desktop.md) §1 – §2, StAnal `c9582d8a` 의 `mcp-server/connectionInfo.ts` · `extensionRequest.ts` · `desktop/host/src/claude/{connect,paths,registerConfig,lastCall}.ts` · `desktop/host/test/connect.mjs`(읽기만), [W2](W2-mcp.md).

## 요약

`STCFSD_MCP_PORT_FILE` 이 있을 때만 켜지는 포트 파일 방식을 더했다. 호스트(브리지)는 빈 포트에서 듣고, 프로세스마다 토큰을 만들어 모든 요청에 `Bearer` 를 요구하고, 포트 파일을 원자적으로 쓰고 지운다. MCP 서버는 호출마다 그 파일을 읽고(다른 포트를 짐작하지 않는다), 프로그램이 꺼져 있으면 사용자에게 그대로 전할 문장을 돌려주고, 프로그램이 다시 켜지면 `get_status` 가 성공할 때까지 다른 호출을 보내기 전에 거절한다. Claude Desktop 등록 도우미(`src/mcp/claudeDesktop.ts`, vscode 비의존, 확장은 부르지 않음)를 더했다. 변수가 없으면 확장의 동작은 그대로다. 도구 59 개의 이름 · 스키마 · 설명은 바뀌지 않았다(안내문의 TRANSPORT 문단만 고침).

| 파일 | 무엇 |
|---|---|
| `src/mcp/portFile.ts` (새) | 환경 변수 · 머리 이름, 포트 파일 형식 · 읽기 · 원자적 쓰기 · 자기 것만 지우기, pid 생존 |
| `src/mcp/hostConnection.ts` (새) | MCP 서버 쪽: 방식 고르기, 호출마다 파일 읽기, 재시작 판정 · 막기, 오류 문구 |
| `src/mcp/claudeDesktop.ts` (새) | Claude Desktop 설정 후보 · 항목 · 상태 · 연결 · 끊기 |
| `src/mcp/bridge.ts` | 옵션 `McpBridgeOptions`(포트 파일 · 토큰 · `onAiCall`), `bridgeOptionsFromEnv`, `checkBridgeRequest(…, token?)` 의 401, 포트 0, 포트 파일 쓰기 · 지우기(멈춤 · 프로세스 종료), `GET /last-call`, 게터 `token` · `portFile` · `instanceId` · `lastAiCall` |
| `src/mcp/server.ts` | `bridgeRequest` 가 `CONNECTION.resolve()` 를 지난다, 토큰 · 클라이언트 머리, 401 · 거부 · 끊김 · 시간 초과 문구(포트 파일 방식만), 재시작 알림, 안내문 TRANSPORT |
| `src/extension.ts` | 브리지 시작 부분만: `bridgeOptionsFromEnv(process.env)` 가 있으면 포트 0 + 옵션, 설정 파일 자동 쓰기 안 함 |
| `scripts/mcp-source-hash.cjs` | 번들 입력에 `hostConnection.ts` · `portFile.ts` |
| `test/webview/mcp_si_chain.js` | transpile 목록에 두 파일(한 줄 — server · bridge 가 import 하므로) |
| `media/mcp-server.js` · `.map` | 다시 빌드(`0.1.1+src.67cffa23c217`) |
| 시험(새) | `test/webview/mcp_port_file_contract.js`, `claude_desktop_contract.js`, `real_config_guard.js` |
| `README.md` | MCP 절에 「Connecting to the host」 표, 해시 입력 목록 |

## 계약

### 환경 변수

| 이름 | 누가 읽나 | 뜻 | 기본 |
|---|---|---|---|
| `STCFSD_MCP_PORT_FILE` | 호스트(`bridgeOptionsFromEnv`, extension.ts) · MCP 서버 | 포트 파일 경로. 있으면(빈 문자열 아님) 포트 파일 방식 | 없음 = 지금 방식 |
| `STCFSD_MCP_STANDALONE` | MCP 서버 | `"1"` 이면 오류 문구가 "StCFSD 프로그램" 기준(사용자에게 그대로 전할 말) | 없음 = 개발 호스트 문구(파일 경로를 밝힘) |
| `STCFSD_MCP_PORT` | MCP 서버 | legacy 고정 포트. **포트 파일 방식에서는 읽지 않는다** | 52790 |
| `ELECTRON_RUN_AS_NODE` | Electron | `StCFSD.exe` 가 MCP 서버를 Node 처럼 돌린다(등록 항목에 넣는다) | — |

재시작 뒤 막기는 `STANDALONE` 과 무관하게 포트 파일 방식이면 늘 한다(재시작한 호스트를 따라가면서 막지 않는 길을 두지 않으려고). 작업 폴더는 보지 않는다(파일 하나 = 호스트 하나).

### 포트 파일

- 경로(독립 프로그램): `%APPDATA%\StCFSD\mcp\stcfsd-mcp-port` = `standardPortFile(appDataDir())`. macOS `~/Library/Application Support/StCFSD/mcp/…`, 그 밖 `$XDG_CONFIG_HOME/StCFSD/mcp/…`.
- 내용(UTF-8 JSON, 16 KiB 상한):

```json
{ "app": "stcfsd", "version": 1, "port": 51234, "token": "<64 hex>", "pid": 12345,
  "instanceId": "<32 hex — 시작마다 새로>", "startedAt": "2026-11-22T09:30:00.000Z" }
```

- 쓰기: 브리지가 **듣기 시작한 뒤**, 같은 폴더 임시 파일(`*.stcfsd-tmp-<pid>-<hex>`) + rename, Windows `EPERM/EBUSY/EACCES` 는 50 · 100 · 150 · 200 ms 기다려 다시. 폴더 0700, 파일 0600(POSIX). 쓰지 못하면 `start()` 가 실패한다. 이미 있는 파일은 덮어쓴다(단일 인스턴스는 껍데기의 일).
- 지우기: `stop()` 과 프로세스 `exit` 때, 파일의 `instanceId` 가 자기 것일 때만. 강제 종료는 파일을 남긴다 — MCP 서버가 pid 가 죽은 것을 보고 "실행 중이 아님" 으로 답하고, 다음 호스트가 덮어쓴다(클라이언트는 지우지 않는다).
- 읽기 검사: 크기 · POSIX 소유자 · `app`/`version`/`port`(1–65535)/`pid`/`token`(hex 32–256)/`instanceId`/`startedAt`. 틀리면 "읽을 수 없는 파일" = 실행 중 아님.

### HTTP

| 머리 | 언제 |
|---|---|
| `Authorization: Bearer <token>` | 포트 파일 방식의 모든 요청. 없거나 틀리면 **401** + `WWW-Authenticate: Bearer`, 본문 `{"error":"Missing or wrong bearer token. …"}`. 비교는 sha256 의 `timingSafeEqual`. Origin(403) · Host(403) · content-type(415) 검사가 먼저다 |
| `X-StCFSD-Request-Id: <pid36>-<seq36>` | MCP 서버가 **늘**(두 방식 모두) 보낸다. 이것이 붙은 요청 = AI 호출 |
| `X-StCFSD-Client: <clientInfo.name>/<version>` | MCP 서버가 늘 보낸다(initialize 의 클라이언트 이름, 인쇄 가능한 ASCII 120 자) |

`GET /last-call`(포트 파일 방식만, 토큰 필요) → `{ lastAiCall: {at, client, method, endpoint, action?} | null, aiCalls, pid, startedAt }`. 요청 id 머리가 없는 요청(화면의 조회)과 `/last-call` 은 세지 않는다. 같은 프로세스에서는 `onAiCall` 콜백 · `lastAiCall` 게터로도 받는다. 기록은 메모리뿐(재시작 너머로 남기는 것은 S4 몫).

### 재시작 뒤 막기 — 상태 기계

상태: `pinned`(처음 붙은 호스트 `{pid, instanceId, port, token}`), `restartUnconfirmed`(처음 false). 호출마다(`resolve(statusRead)`, `statusRead` = `GET /status` = `get_status`):

1. 파일 없음 · 읽을 수 없음 · pid 죽음 → 거절 **NOT_RUNNING**(요청 안 보냄). 상태는 그대로.
2. `pinned` 없음 → `pinned = 지금 것`(첫 접촉은 막지 않는다).
3. `pinned` 와 넷 중 하나라도 다름 → `pinned = 지금 것`, `restartUnconfirmed = true`.
4. `restartUnconfirmed` 이고 상태 조회가 아님 → 거절 **RESTARTED**(요청 안 보냄).
5. `restartUnconfirmed` 이고 상태 조회 → 보낸다(`restarted` 표시). 응답이 200 · 객체 · `error` 없음이면 그때 `confirmStatus` — 그 대상이 **아직** `pinned` 와 같을 때만 `restartUnconfirmed = false` — 그리고 결과 맨 앞에 `restart_notice` 를 붙인다.

**첫 호출만 막는 것으로 모자란 까닭**(StAnal 작업문서 결정 표, D5b): 새 프로세스의 모델(단면 · 해석 결과 · 입력 리비전)은 AI 의 맥락이 가리키는 그것이 아니다. "재시작 뒤 첫 호출 하나를 거절" 이면, AI 가 동시에 보낸 두 번째 쓰기(또는 첫 거절을 받기 전에 이미 보낸 다음 호출)가 그대로 새 프로그램에 가서 옛 맥락으로 모델을 바꾼다. 그래서 풀어 주는 사건을 "시간" 이나 "횟수" 가 아니라 **"상태 조회가 그 호스트에서 성공했다"** 로 정했고, 확인은 응답이 온 뒤에야 되므로 조회가 날아가는 동안 온 쓰기도 막힌다. 실제로 막기를 "첫 호출만" 으로 바꾼 번들을 만들어 돌리면 시험이 `two concurrent calls both refused` 에서 실패한다(아래 「변이 시험」).

### AI 가 받는 오류 문구 (그대로)

독립 프로그램(`STCFSD_MCP_STANDALONE=1`) — 도구 오류(`isError: true`, 본문 `{"error": …}`):

| 경우 | 문구 |
|---|---|
| 파일 없음 · 깨짐 · pid 죽음 | `The StCFSD program is not running. Ask the user to start StCFSD, then try again. No request was sent.` |
| 파일은 살아 있는 pid 인데 연결 거부 | `Cannot connect to the StCFSD program; it may have just been closed. Ask the user to start StCFSD, then try again.` |
| 401 | `The StCFSD program did not accept this connection (it may have just restarted). Try again; if it keeps failing, ask the user to close and start StCFSD again.` |
| 재시작 뒤 상태 조회 전의 다른 호출 | `The StCFSD program was restarted since your last call. The open section, model and analysis results may differ from before, so this request was not sent. Call get_status to check the current state, then continue.` |
| `get_status` 결과의 `restart_notice` | `The StCFSD program was restarted since your last call. This status is from the restarted program; the section, model and analysis results may differ from before. Re-check them (get_full_state) before changing the model or reporting results.` |
| 연결 뒤 답 전에 끊김 | `The connection to the StCFSD program broke before it answered (<code>); it may have been closed. The request may or may not have run there and was not re-sent. If StCFSD is not running, ask the user to start it; then call get_status before retrying.` |
| 6 분 무응답 | `No reply from the StCFSD program within 6 min. The calculation may still finish in StCFSD and change its state; call get_status before relying on the model.` |

`STANDALONE` 없는 포트 파일 방식은 같은 자리에 파일 경로와 "no other port was tried" 를 밝히는 개발용 문구(`hostConnection.ts`). legacy 문구(`StCFSD bridge not reachable at 127.0.0.1:<port> (<code>). Start VS Code …`)는 그대로다.

안내문 TRANSPORT 문단: 독립 프로그램 또는 VS Code 패널이 떠 있어야 한다, "실행 중이 아님" 이면 사용자에게 그대로 말하고 StCFSD 를 켜 달라고 할 것(되풀이 금지), "다시 시작됨" 이면 `get_status` 먼저(그것만 통과) · 모델을 다시 확인.

### 등록 도우미 `src/mcp/claudeDesktop.ts`

| 내보냄 | 뜻 |
|---|---|
| `CLAUDE_DESKTOP_SERVER_KEY = 'stcfsd'`, `APP_DIR_NAME = 'StCFSD'`, `PORT_FILE_NAME`, `MCP_SERVER_REL_PATH = ['media','mcp-server.js']` | 이름 |
| `appDataDir(override?, PathOptions)`, `standardPortFile(appDir, …)`, `mcpServerScript(appRoot, …)` | 경로(`PathOptions = {platform, home, env}` 주입) |
| `claudeDesktopConfigPath(platform, home, appData?)`, `claudeConfigCandidates(…)`, `pickClaudeConfig(…)` | 후보: standard(`%APPDATA%\Claude\…` · macOS · `~/.config/Claude/…`) + Windows MSIX(`%LOCALAPPDATA%\Packages\<claude…>\LocalCache\Roaming\Claude\…`, 실물 미확인). 순서: 파일 있는 MSIX → 폴더 있는 standard → 폴더 있는 MSIX → standard |
| `standaloneMcpEntry({command, serverScript, portFile, electron = true})` → `McpEntry` | 넣을 항목(아래) |
| `checkClaudeDesktop({entry, configPath?, pathOptions?})` → `{state, configPath, configKind, candidates, configExists, configError?, current?, expected, others}` | `state`: `not-installed` · `invalid-config` · `not-registered` · `registered-elsewhere` · `registered` |
| `connectClaudeDesktop(opts)` → `{ok:true, action: unchanged·created·added·updated, wrote, backupPath?, previous?, others, restartRequired, entry}` 또는 `{ok:false, reason: claude-not-installed·invalid-config·write-failed, error?, backupPath?}` | 폴더 없으면 만들지 않음, 깨진 JSON · 루트/`mcpServers` 가 객체 아님 → 손대지 않고 백업도 없음, 같으면 쓰지 않음, 백업(`<파일>.stcfsd-backup-YYYYMMDD-HHMMSS[-n]`, `COPYFILE_EXCL`) → 임시 파일 + rename(재시도) → 다시 읽어 우리 항목 = 기대값 · 다른 키 = 전과 같음을 확인. 원문의 BOM · 줄바꿈(CRLF) · 들여쓰기 · 키 순서를 따른다(값은 JSON 이 허락하는 만큼 — 숫자 표기 · 중복 키 · 정수 꼴 키 순서는 JSON.parse 를 따른다) |
| `disconnectClaudeDesktop(opts)` → `{action: removed·absent·kept, …}` | `sameEntry` 일 때만 지운다(env 키 순서 무관, 다른 키가 더 있으면 다름 → `kept`) |

넣는 항목(설치본):

```jsonc
"mcpServers": { "stcfsd": {
  "command": "C:\\Users\\…\\AppData\\Local\\Programs\\StCFSD\\StCFSD.exe",
  "args": ["C:\\…\\resources\\app-root\\media\\mcp-server.js"],
  "env": { "ELECTRON_RUN_AS_NODE": "1",
           "STCFSD_MCP_PORT_FILE": "C:\\Users\\…\\AppData\\Roaming\\StCFSD\\mcp\\stcfsd-mcp-port",
           "STCFSD_MCP_STANDALONE": "1" } } }
```

번들은 Node 내장(`crypto` · `fs` · `http` · `path` · `node:process`)만 require 하고 `__dirname` · `__filename` · `execPath` · `import.meta` 를 쓰지 않는다 — 실행 파일 · 확장 폴더 배치를 가정하지 않는다(시험이 확인).

## 독립 프로그램 호스트가 할 일 (S1 · S4)

1. 확장 번들을 활성화하기 **전에** `process.env.STCFSD_MCP_PORT_FILE = standardPortFile(appDataDir())`. 호스트에는 `STCFSD_MCP_STANDALONE` 이 필요 없다. 단일 인스턴스 잠금은 껍데기(S3)가 — 호스트는 파일을 덮어쓴다.
2. 포트 · 토큰은 활성화 뒤 그 파일을 읽어 얻는다(`pid === process.pid` 가 될 때까지). `out/mcp/portFile.js` 의 `readPortFile` 을 써도 된다(`npm run compile` 이 만든다).
3. 화면 다리의 조회는 `Authorization: Bearer <token>` 만 붙이고 `X-StCFSD-Request-Id` 는 붙이지 않는다(붙이면 AI 호출로 센다). 「마지막 호출」은 `GET /last-call`.
4. 「연결」: `connectClaudeDesktop({ entry: standaloneMcpEntry({ command: process.execPath, serverScript: mcpServerScript(<resources>/app-root), portFile }) })`, 상태 `checkClaudeDesktop`, 끊기 `disconnectClaudeDesktop`. 시험은 `configPath` 또는 `pathOptions` 로 가짜 파일을 준다. `restartRequired` 이면 "Claude Desktop 을 다시 시작" 안내.
5. 포트 파일 방식에서는 확장이 `.mcp.json` · `~/.claude/mcp.json` 을 쓰지 않는다. 확장 명령 `stcfsd.registerMcpServer` 등은 legacy 항목(`node` · 고정 포트)을 쓰므로 독립 프로그램에서 내놓지 말 것.

## 확장의 기본 경로가 그대로라는 증거

- `extension.ts`: 변수가 없으면 `findAvailablePort(52790)` → `new McpBridgeServer(…, mcpPort, undefined)` → 전과 같은 `setupMcpConfig(context, mcpPort)` 분기. `mcpPortValue = mcpBridge.port` 는 legacy 에서 `mcpPort` 그대로(포트 갱신은 옵션이 있을 때만). 시험이 이 두 줄을 소스에서 확인한다.
- 브리지: 옵션이 없으면 토큰 검사 없음 · 파일 없음 · `/last-call` 은 전처럼 `{"error":"Unknown endpoint: GET /last-call"}`. `checkBridgeRequest(method, headers, port)` 는 전과 같다.
- MCP 서버: 변수가 없으면 `STCFSD_MCP_PORT` 하나, 토큰 없음, 연결 실패 · 시간 초과 · 비 JSON 문구가 바이트 그대로(시험이 문구 전체를 비교). 달라진 것은 요청에 붙는 두 머리(`X-StCFSD-Request-Id` · `X-StCFSD-Client`)뿐 — 확장의 브리지는 기록만 하고(내놓지 않음) 동작은 같다.
- 기존 시험이 그대로 통과: `mcp_si_chain.js`(legacy 브리지 · 실제 패널 · Python, 28 US/SI 비교, 호스트 ↔ 스키마 §3b), `mcp_registration_contract.js`, `panel_host_contract.js` 외 전부. 도구 59 개 스키마 · 설명 패리티 OK.

## 시험

| 시험 | 덮는 것 | 결과 |
|---|---|---|
| `mcp_port_file_contract.js` | 진짜 호스트 프로세스(transpile 한 `McpBridgeServer` + 패널 대역) · 진짜 `media/mcp-server.js`(stdio, cwd = 드라이브 뿌리) · 임시 폴더 · 빈 포트. ① 번들 require = 내장뿐 ② 파일 없음 → NOT_RUNNING(모든 도구) ③ 파일 형식 · 키 · 0600/0700(POSIX) · 임시 파일 없음 · 52790 아님 ④ 토큰으로 도구 성공 ⑤ 토큰 없음 · 틀림 · `Bearer` 빠짐 → 401, Origin · Host · content-type 은 토큰이 있어도 403/403/415, 거절된 요청은 패널에 안 닿음 ⑥ `/last-call`: 클라이언트 `k1-test-client/1.0.0`, action, 화면식 조회는 안 셈, 토큰 필요 ⑦ 강제 종료(파일 남음, pid 죽음) → NOT_RUNNING ⑧ 살아 있는 pid · 닫힌 포트 → REFUSED(ECONNREFUSED 글자 없음) ⑨ 다른 pid · 포트 · 토큰으로 다시 켜짐: 쓰기 거절, 동시 두 건 모두 거절, 호스트에 아무것도 안 감, 상태 조회가 호스트에서 도는 400 ms 동안 보낸 쓰기 거절, 상태 조회는 `restart_notice` 와 함께 통과, 그 뒤 쓰기 통과, 알림은 한 번 ⑩ `stop()` · 프로세스 종료가 파일을 지움, 남의 파일은 안 지움 ⑪ `standaloneMcpEntry` 항목 그대로, 확장 밖으로 옮긴 번들(공백 · 한글 경로)을 드라이브 뿌리에서 → 59 도구 · 같은 프로그램 ⑫ 포트 파일 방식은 `STCFSD_MCP_PORT`(미끼 브리지)에 한 번도 안 감, 개발 문구에 파일 경로 ⑬ legacy 그대로 ⑭ 상태 기계 단위(같은 pid · 새 instanceId = 재시작, 확인 전 또 재시작이면 옛 조회가 풀지 못함) ⑮ 진짜 설정 79 경로 그대로 | PASS (15 묶음) |
| `claude_desktop_contract.js` | 가짜 Windows 사용자(홈 · APPDATA · LOCALAPPDATA = 임시). 미설치(폴더 안 만듦) · 새 파일 · 이미 같음(mtime 그대로, 백업 없음) · 다른 항목 보존(BOM · CRLF · 4 칸 · 키 순서 · 값) + 백업 = 원본 바이트 · 낡은 항목 → `registered-elsewhere` → 자리 그대로 고침 + 같은 초 두 번째 백업 `-2` · env 순서 무관 · 다른 키가 있으면 다름 · 끊기는 다르면 `kept`(쓰지 않음), 같으면 그것만 · 깨진 JSON / 배열 루트 / `mcpServers` 배열 · 글자 → 손대지 않고 백업 없음 · 빈 파일 = `{}` · MSIX 후보와 순서 · `configPath` 직접 · vscode 비의존 · 확장이 부르지 않음 · 진짜 설정 그대로 | PASS |
| `real_config_guard.js` | 저장소 `.mcp.json` · `.claude/` · `Example/.mcp.json` · `Example/.claude/`, `~/.claude/mcp.json`, 이 PC 의 Claude Desktop 설정(standard + MSIX 후보)의 크기 · 수정 시각을 열지 않고 비교. Claude Desktop 설정은 스스로 고쳐 쓸 수 있어 시각이 바뀌면 우리 흔적(`*.stcfsd-backup-*` · `*.stcfsd-tmp-*` 새 이름)이 없을 때 경고만 | 두 시험에서 79 경로 그대로, 경고 없음 |

**변이 시험.** `hostConnection.ts` 에서 거절할 때 `restartUnconfirmed = false` 로(= 첫 호출만 막기) 바꿔 번들을 다시 빌드하고 돌리면 `AssertionError: two concurrent calls both refused` 로 실패했다. 소스 · 번들을 되돌린 뒤 패리티 OK(해시 `67cffa23c217` 그대로).

## 게이트 (마지막 실행)

| 게이트 | 마지막 줄 |
|---|---|
| `.venv\Scripts\python.exe test\python\run_all.py` | `Ran 386 tests in 48.613s` / `OK` |
| `npx tsc -p ./ --noEmit` | 출력 없음(종료 0) — 작업 중 한때 S1 의 `desktop/host/src/vscode/*.ts` 가 `rootDir` 밖이라 TS6059 가 났다가 마지막 실행에서는 없어졌다(내 파일 무관) |
| `npx eslint src webview/js test/webview` | 출력 없음(종료 0) |
| `npm run test:webview` | `… mcp_si_chain: PASS (28 US/SI comparisons …)` … `design_state_v13_contract: PASS`, `mcp_port_file_contract: PASS (15 groups …)`, `claude_desktop_contract: PASS (fake configs only; 79 real config paths untouched)` |
| `npm run build:mcp` | `webpack 5.105.4 compiled successfully` |
| `npm run check:mcp-parity` | `MCP parity OK: deployed bundle matches source definitions` (bundle `0.1.1+src.67cffa23c217`, 59 tools) |

## 잔여 위험 · 못 한 것

- **Electron 으로 돌려 보지 못했다.** 이 저장소에 Electron 이 없다. `ELECTRON_RUN_AS_NODE=1` 은 Node 로 같은 항목을 돌려 대신 확인했고(번들의 require 는 내장뿐), 진짜 `StCFSD.exe` 로는 S3/S5 에서 확인할 것.
- **진짜 Claude Desktop 미확인.** 등록은 가짜 파일로만. MSIX 경로는 StAnal 과 같이 실물로 확인하지 못했다. Claude Desktop 이 떠 있는 동안 자기 설정을 메모리에서 다시 쓰면 우리 항목이 지워질 수 있다 — 「연결」 뒤 Claude Desktop 을 다시 시작하라고 안내(`restartRequired`).
- **첫 접촉은 막지 않는다.** MCP 서버 프로세스가 대화 도중 다시 떠서(Claude Desktop 이 서버를 재시작) 이미 다시 켜진 프로그램에 처음 붙으면 재시작을 알 수 없다 — StAnal 과 같은 한계.
- **Windows 의 파일 권한.** 0600/0700 은 POSIX 에서만 뜻이 있다. Windows 에서는 `%APPDATA%` 의 사용자 ACL 에 기댄다. 토큰은 같은 사용자의 다른 프로세스로부터는 지키지 못한다(그 사용자는 파일을 읽을 수 있다) — 브라우저 · 다른 사용자 · 네트워크로부터 지키는 것이 목적.
- **강제 종료 뒤 남은 파일 · pid 재사용.** pid 가 다른 프로세스에 재사용되면 "살아 있음" 으로 보여 연결 거부 문구(REFUSED)가 나간다 — 뜻은 같다(켜 달라). 새 호스트는 덮어쓰고, `instanceId` 로 재시작을 알아본다.
- 마지막 AI 호출은 메모리에만(프로그램 재시작 너머로 남기지 않음). 화면이 「어제 16:20」 을 보이려면 S4 에서 `onAiCall` 을 받아 파일에 남길 것.
- 같은 사용자 계정으로 확장(VS Code)과 독립 프로그램이 함께 떠도 서로 섞이지 않는다 — 확장은 변수가 없어 고정 포트 · 토큰 없음, 독립 프로그램은 자기 파일. 다만 Claude Desktop 에 legacy 이름(`stcfsd-section-designer`)이 손으로 등록돼 있으면 두 서버가 다 보인다(`checkClaudeDesktop` 의 `others` 에 나온다).


## V5 — 독립 검증 V5 의 연결 몫 (2026-11-22)

근거: [V5-desktop.md](../verify/V5-desktop.md) 의 V5-06 · V5-08 · V5-09 · V5-15(a–d), 의심 V5-S2 · S3 · S5. 모두 먼저 재현했다(scratch 탐침 — 수정 전 번들 · 소스로): V5-06 `concurrent kept=false` · V5-15a `first LOST` · 15b 하드 링크 갈라짐 · 15c 연결/끊기 5 번에 백업 13 개 · 15d `registered-elsewhere/kept` · V5-08 새 MCP 서버의 첫 쓰기 통과 · V5-09 남의 서버가 `GET /status` 와 `POST /action`(Bearer 포함)을 받고 그 답이 상태로 쓰임 · S2 `No active CUFSM panel. Open Section Designer first.` · S5 소문자 경로로 띄운 node 의 `process.execPath` = `c:\program files\nodejs\node.exe`.

### 무엇을 고쳤나

| 번호 | 파일 · 함수 | 무엇 |
|---|---|---|
| V5-06 | `claudeDesktop.ts` `changeConfig`(새, connect · disconnect 가 함께 씀), `portFile.ts` `atomicWriteFile(…, beforeRename)` | 읽을 때 한 fd 로 fstat + 내용(크기 · mtime · sha256). rename(또는 제자리 쓰기) **바로 앞에서** 다시 보고 다르면 쓰지 않고, 이번 시도의 백업을 지운 뒤 다시 읽어 우리 변경 하나만 다시 얹는다. `CLAUDE_WRITE_ATTEMPTS = 4` 번 다 바뀌면 `{ok:false, reason:'config-busy'}` — 덮어쓰지 않는다. 백업은 읽은 바이트 그대로(`wx`, 0600 — 전에는 `copyFile` 이라 복사하는 사이에 바뀐 것을 백업할 수 있었다). 남는 틈: 다시 본 때와 rename 사이(µs) — Claude Desktop 이 잠그지 않아 더 좁힐 수 없다 |
| V5-15a | `findDuplicateKey`(새) → `readConfig` | 같은 객체에 같은 키가 둘이면 `invalid-config`, `configError` 에 경로(`mcpServers.a`)와 까닭. 손대지 않고 백업 없음 |
| V5-15b | `writeTarget` · `writeInPlace`(새) | 심볼릭 링크 → `realpath` 대상의 폴더에 임시 파일 + rename. 대상을 풀 수 없으면(끊긴 링크 · 고리 · 권한) `write-failed` + "link whose target cannot be resolved … did not write it". 하드 링크(nlink > 1) → 백업 뒤 제자리 쓰기(원자적이지 않음 — 그 대신 링크가 갈라지지 않는다). 폴더 링크(junction)는 rename 이 그 안에서 일어나 그대로 |
| V5-15c | `pruneClaudeBackups`, `CLAUDE_BACKUPS_KEPT = 5` | 쓰기가 성공할 때마다 우리 백업(`<이름>.stcfsd-backup-YYYYMMDD-HHMMSS[-n]` 꼴의 **일반 파일**만 — 이름 꼴은 K1 그대로라 옛 백업도 센다)을 새것부터 다섯만 남긴다. 같은 초의 `-n` 은 수로 가른다. 꼴이 다른 이름 · 폴더 · 링크 · 다른 파일의 백업은 지우지 않는다 |
| V5-15d · S5 | `samePath`(새), `sameEntry(raw, expected, platform)` | Windows 에서는 `command` · `args` · env 의 `STCFSD_MCP_PORT_FILE` 을 `path.win32.normalize` + 소문자로 비교, 다른 OS 와 다른 env 값은 글자 그대로. 기준 OS = `pathOptions.platform ?? process.platform`. S5 는 **확인**(위) — 이 비교로 덮는다 |
| V5-08 | `hostConnection.ts` 상태 기계, `portFile.ts` `clientRecordFile` · `readClientRecord` · `writeClientRecord`, `server.ts`(클라이언트 이름을 넘김) | 아래 「재시작 기록」 |
| V5-09 | `portFile.ts` `instanceProof` · `proofMatches` · `NONCE_HEADER` · `PROOF_HEADER` · `HELLO_ENDPOINT`, `bridge.ts`(증명 머리 · `GET /hello`), `server.ts` `verifyHost` · `bridgeRequest`, `hostConnection.ts` `markVerified` · `verificationFailed` | MCP 서버는 포트 파일 방식의 모든 요청에 nonce 를 붙이고, 아직 확인하지 않은 호스트에는 **`GET /hello` 하나만** 먼저 보낸다. 호스트는 토큰을 통과한 응답에만 `X-StCFSD-Proof = HMAC-SHA256(토큰, "stcfsd-instance-proof\n<instanceId>\n<nonce>")` 를 붙인다(instanceId 는 선 위로 가지 않으므로 Bearer 를 받은 남의 서버도 못 만든다). 틀리면 `STANDALONE_NOT_RUNNING` 그대로, 그 포트 파일 내용에는 더 보내지 않는다(파일이 바뀌면 다시 확인). 확인 뒤에도 응답마다 증명을 본다. `/hello` 는 패널에 닿지 않고 AI 호출로 세지 않는다(요청 id 머리를 붙이지 않는다). 비용: MCP 서버 프로세스 × 호스트 인스턴스마다 왕복 한 번 |
| V5-S2 | `bridge.ts` `HOST_STARTING` · `NO_PANEL` | **문구는 확인**, 「막기가 영영 안 풀림」 은 **확인 안 됨** — 수정 전에도 패널이 생긴 뒤의 `get_status` 가 막기를 풀었다. 다만 AI 는 "Open Section Designer first" 를 받아 다시 물을 까닭이 없었다. 포트 파일 방식에서 패널이 없으면 `The StCFSD program is still starting (its design panel is not ready yet). Nothing was changed. Wait a few seconds, then call get_status again.` — 지금 방식(옵션 없음)의 문구는 바이트 그대로. 시작 중의 `get_status` 는 막기를 풀지 않고(모델이 아직 없다), 다시 부르면 푼다 |
| V5-S3 | `extension.ts` `checkAndInstallDependencies(context, pythonPath, standalone = false)`(내보냄), `STANDALONE_PYTHON_BROKEN` · `STANDALONE_PACKAGES_BROKEN` | **확인**(코드 길: 독립 프로그램은 `STCFSD_TEST_MODE` 없이 Production 으로 활성화되어 이 검사를 탄다). `standalone = !!bridgeOptionsFromEnv(process.env)` 일 때만 "프로그램에 들어 있는 해석 엔진 … StCFSD 를 다시 설치하세요" 를 단추 없이, **기다리지 않고**(활성화 · 포트 파일을 알림 뒤에 세우지 않게) 띄운다. python.org · pip 은 내놓지 않는다. 확장(변수 없음)은 문구 · 단추 · 순서가 전과 같다(시험이 문구 전체 비교) |

`ClaudeFailReason` 에 `'config-busy'` 를 더했다(덧붙임). 기존 결과 키 · 이름 · 인자는 그대로(`sameEntry` 의 세 번째 인자는 기본값이 있다).

### 재시작 기록(V5-08) 설계

- **무엇 · 어디**: MCP 서버가 **확인한** 프로그램의 `{instanceId, pid, startedAt, at, client}` — 토큰은 남기지 않는다. 포트 파일 옆 `<포트 파일>.client-<이름 조각>-<sha256(이름) 8자>`(설치본: `%APPDATA%\StCFSD\mcp\stcfsd-mcp-port.client-claude-ai-xxxxxxxx`). Claude 설정에는 아무것도 쓰지 않는다. 임시 파일 + rename, 0600, 폴더는 만들지 않는다(호스트가 만든 `mcp` 폴더).
- **여러 클라이언트**: 이름(initialize 의 `clientInfo.name`)마다 파일이 따로다 — 한 파일을 함께 고치면 읽고-고치고-쓰기 사이에 남의 줄이 지워지고, 한쪽의 확인이 다른 쪽의 알림을 지운다. 각 MCP 서버의 막기는 여전히 자기 메모리(`confirmed`)이고 기록은 **첫 접촉의 기준**으로만 쓰므로, Claude Desktop 과 Claude Code 는 서로의 막기를 걸지도 풀지도 않는다(시험이 확인). 같은 이름의 두 프로세스(Claude Code 두 창)는 한 기록을 나눈다 — 나중 것이 이긴다(둘 다 자기가 확인한 값).
- **판정(첫 접촉)**: 기록 없음 → 받아들임(헛 알림 없음 — 이 클라이언트로는 처음) · 기록 = 지금 instanceId → 받아들임 · 기록 ≠ 지금 → 재시작 · 기록을 읽을 수 없음(깨짐 · 남의 것 · 크기 · 폴더) → 이어짐을 증명하지 못하니 재시작. 「오래된 기록」 은 따로 가르지 않는다 — 가리키는 프로그램이 없어졌으면 그것이 곧 재시작이고, 값은 `get_status` 한 번이다.
- **값**: 재시작으로 본 새 MCP 서버는 `get_status` 만 통과시키고 그 결과에 `restart_notice` 를 붙인다 — 새 대화에는 `get_status` 한 번(시험: `R.statuses() === 1`). 안내문의 흐름이 `get_status` 로 시작하므로 보통은 더 드는 것이 없다.
- **교착 없음**: `get_status` 는 늘 보낸다. 확인되면 메모리에서 풀리고 기록을 고친다. 기록을 쓸 수 없어도(시험: 그 이름이 폴더) 메모리로 풀린다 — 다음 새 MCP 서버가 알림을 한 번 더 받을 뿐. 시작 중(패널 없음)의 `get_status` 는 풀지 않지만 그 문구가 다시 부르라고 한다.
- **상태 기계(K1 의 `pinned`/`restartUnconfirmed` 를 바꿈)**: `confirmed` = 다른 요청을 보내도 되는 호스트. 지금 포트 파일의 호스트가 `confirmed` 와 `sameHost` 가 아니면 상태 조회만(알림), 성공하면 `confirmed = 그 호스트`. K1 의 「확인 전에 또 재시작하면 옛 조회가 풀지 못함」 은 그대로 성립한다(옛 호스트를 `confirmed` 로 해도 지금 파일과 다르다 — 단위 시험 그대로 통과). 첫 접촉으로 받아들인 것은 `/hello` 확인이 실패하면 되돌린다(남의 프로그램을 기준으로 삼지 않게).

### 시험 (더함 — 기존 단언은 그대로)

- `mcp_port_file_contract.js`(15 → 19 묶음): S2(패널이 1.5 s 늦는 호스트: 시작 중 문구 · 쓰기도 같은 문구 · 재시작 + 시작 중이면 막기 유지 → 다시 부른 `get_status` 가 품 · 지금 방식 문구 그대로) · V5-08(첫 연결 알림 없음 · 기록 위치 · 토큰 없음 · 프로그램 재시작 뒤 새 MCP 서버의 쓰기 거절 · `get_status` 한 번 · Claude Code 와 독립 · 한쪽 확인이 다른 쪽을 풀지 않음 · 재시작 없으면 새 서버도 알림 없음 · 깨진 기록 → 한 번 · 쓸 수 없는 기록에도 풀림) · V5-09(살아 있는 pid + 남의 서버 → 세 도구 모두 NOT_RUNNING, 그 서버가 받은 것은 `GET /hello` 하나 · 진짜 호스트의 증명이 instanceId · nonce 에 묶임 · 토큰 없으면 401 에 증명 없음 · `/hello` 는 패널에 안 닿음 · legacy 에는 `/hello` · 증명 없음) · S3(`out/extension.js` 를 vscode 대역으로: 독립 프로그램 두 경우의 문구 · 단추 없음, 확장 두 경우의 문구 · 단추 그대로, activate 가 포트 파일 방식을 넘김 — `out/` 이 새것이어야 한다). 기존 묶음의 `aiCalls === 2` 가 `/hello` 를 세지 않음도 덮는다.
- `claude_desktop_contract.js` V5 묶음: 끼어든 쓰기(연결 · 끊기) 보존 + 백업 = 실제로 바꾼 내용 + 버린 시도의 백업 없음 · 계속 바뀌면 `config-busy`(시도 4 번, 남의 마지막 쓰기 그대로, 백업 · 임시 파일 없음) · 중복 키 단위 4 건 + 두 설정 손대지 않음 · 하드 링크(nlink 2 유지, 두 이름 같은 내용) · 심볼릭 링크(만들 수 있을 때만 — 이 PC 는 `EPERM` 으로 건너뜀) · 백업 12 번 쓰기 → 5 개, 남의 이름 · 폴더 그대로, `-10 > -9` · Windows 대소문자 · 구분자 비교, 다른 OS 는 그대로, 경로가 아닌 env 는 그대로 · S5 실측(소문자로 띄운 node 의 `execPath`)과 그 항목이 `registered`.
- **변이 시험**(scratch `mutate.js` — `media/` 는 건드리지 않고 되돌린 번들을 scratch 로 빌드해 시험 사본이 그것을 쓰게): V5-06 다시 보기 없앰 → `V5-06: a change written between our read and our rename is kept` 에서 실패 · V5-08 첫 접촉에서 기록을 보지 않음 → `a new MCP server knows the program it last saw is gone` 에서 실패(기록 쓰기 자체를 끄면 기록 파일 확인에서 먼저 실패) · V5-09 `proofMatches` 가 늘 참 → `another program is not taken for StCFSD` 에서 실패. 소스를 되돌린 뒤 패리티 OK.

### 못 한 것 · 남은 것

- **심볼릭 링크 설정 파일**: 이 PC 에서 만들 수 없다(`EPERM` — 개발자 모드 · 관리자 없음). 코드(`lstat` → `realpath`)와 시험은 있고, 만들 수 있는 PC 에서 돈다. 이번에는 건너뛰었다.
- **V5-06 의 남은 틈**: 다시 본 때와 rename 사이. 하드 링크의 제자리 쓰기는 원자적이지 않다(백업이 있다).
- **V5-09 의 범위**: 포트 파일을 쓸 수 있는 같은 사용자의 프로그램은 막지 못한다(K1 「잔여 위험」 그대로). 막는 것은 포트 · pid 를 물려받은 남의 프로그램, 다른 사용자.
- **진짜 Claude Desktop · Electron 으로는 돌리지 않았다**(가짜 설정 · node 대역). 기록은 MCP 의 `clientInfo.name` 으로 가른다 — Claude Desktop 이 내는 실제 이름은 확인하지 못했다(무엇이든 클라이언트마다 다르면 된다).
- 같은 이름의 클라이언트 프로세스 여럿(Claude Code 창 둘, `--resume` 으로 옛 대화를 이은 새 프로세스)은 기록 하나를 나누므로, 다른 창이 이미 확인한 프로그램이면 새 프로세스는 알림을 받지 않는다 — MCP 에 대화 식별자가 없어 더 나눌 수 없다.
- 독립 프로그램 쪽(`desktop/`)이 따라올 것은 보고서의 「desktop 변경 필요」 목록(오케스트레이터에게).


## V5b — 재검증 V5b 의 연결 몫 (2026-11-23)

근거: [V5b-desktop-reverify.md](../verify/V5b-desktop-reverify.md) 의 V5b-05 · V5b-07 · V5b-09 · V5b-10(모두 P3)과 옛 표의 V5-08 · V5-09 「일부」. 고친 곳은 `src/mcp/{bridge,server,hostConnection,portFile,claudeDesktop}.ts`, 시험 두 파일, 번들.

| 번호 | 무엇을 바꿨나 | 시험 · 변이 |
|---|---|---|
| V5b-05 | **증명 먼저, 인증은 그다음.** MCP 서버의 `/hello` 는 토큰 없이 nonce 만 보낸다(`httpCall(…, withToken = false)`). 호스트는 `GET /hello` 를 토큰 검사 전에 받는다(Origin · Host 검사는 그대로) — 답은 `{app}` 과 증명뿐, 증명의 열쇠는 여전히 토큰. 다른 모든 길은 토큰이 필요하고, 거절된 요청에는 증명을 붙이지 않는다 | 가짜 서버가 받은 것 = `GET /hello auth=none nonce=yes` 하나 · `/hello` 토큰 없이 200 + 맞는 증명 · Origin 이면 403 · `/status` 는 401 · 증명은 토큰 · instanceId · nonce 에 묶임. 변이(토큰 다시 실음) → `V5b-05: only the connection check reached it, without the token` 에서 실패 |
| V5b-07 | (a) 하드 링크의 제자리 쓰기: 비운 뒤 쓰기 · fsync 가 실패하면 읽었던 바이트 그대로 되돌리고 `write-failed` 문구에 「put back as it was」(되돌리지도 못하면 「could NOT be put back; copy the backup …」). (b) 비우기 직전에 진행 표시 `<설정>.stcfsd-tmp-inplace`(백업 경로를 담음)를 두고 끝나면 지운다 — 프로세스가 그 사이 죽어 남은 **빈 · 잘린 설정 + 표시**는 `invalid-config`(「an in-place write by StCFSD was cut short (backup: …)」), 연결 · 끊기는 손대지 않는다. (c) 문자열 밖 `{`/`[` 깊이가 64 를 넘으면 `invalid-config`(되부름 없는 셈), 다시 쓸 글을 만들다 던지는 것도 `invalid-config` 로 — 밖으로 던지지 않는다 | (a) 새 글을 쓰는 첫 `writeSync` 에 ENOSPC → 설정 바이트 그대로 · nlink 2 · 표시 없음. (b) **자식 프로세스가 비운 직후 실제로 죽는다**(`process.exit(9)`) → 0 바이트 + 표시 → `invalid-config`, 다음 연결도 손대지 않음, 문구의 백업 = 원래 내용, 잘린 JSON 도 같은 안내, 사용자가 되돌리고 표시를 지우면 다시 됨. (c) 5000 겹 → 거절(던지지 않음, 그대로), 문자열 속 괄호가 섞인 60 겹은 됨. 변이(되돌리지 않음) → `could NOT be put back` 에서 실패 |
| V5b-09 | 가지치기는 **가장 오래된 우리 백업**(StCFSD 가 처음 손대기 전의 원본)을 늘 남기고, 새것 `CLAUDE_BACKUPS_KEPT = 5` 개 밖의 중간 것만 지운다(많아야 여섯). 우리 이름 꼴의 일반 파일만 본다(그대로) | 2020 년 원본 + 12 번 쓰기 → 원본 그대로 + 새것 5 · 같은 초 `-n` 에서도 꼬리 없는 첫 것이 남음. 변이(원본도 지움) → `12 writes leave the original + 5 newest, got 5` 에서 실패 |
| V5b-10 | 아래 「프로세스별 기록」 | 아래. 변이(가장 최근 기록 하나만 봄 = 이름 하나 기록과 같은 판정) → `cannot tell which earlier session was this one …` 에서 실패 |

### V5b-05 — 본문을 증명에 묶지 않은 까닭 (여기서 멈춘다)

`/hello` 가 토큰을 싣지 않으므로, 포트 파일이 가리키는 포트를 차지한 남(강제 종료 뒤 pid · 포트를 물려받은 프로그램, 다른 Windows 사용자)은 이제 **아무 비밀도 받지 못하고**(nonce 뿐) 증명을 만들 수 없으며(토큰도 instanceId 도 모른다), MCP 서버는 그다음 요청을 보내지 않는다. 남는 것은 그 포트에서 `/hello` 를 **진짜 호스트로 넘겨 주는 중계자**다. 그러려면 진짜 인스턴스(포트 파일에 적힌 바로 그 instanceId)가 **다른 포트**에서 떠 있어야 하는데, 인스턴스는 자기 포트를 자기가 포트 파일에 적으므로 그런 상태는 **포트 파일을 고쳐 쓸 수 있는 자**(같은 사용자의 프로그램)만 만든다. 그는 토큰과 instanceId 를 파일에서 바로 읽으므로 무엇이든 스스로 만들 수 있다 — 응답 본문을 증명에 묶어도 막는 것이 없다. 그래서 본문은 묶지 않았다. 중계자가 그래도 있다면: 할 수 있는 것 = 확인 뒤의 요청(토큰 포함)을 보고 바꾸고 본문을 바꾸는 것, 할 수 없는 것 = 그런 자리를 포트 파일 없이 만드는 것. 같은 사용자 권한의 악성 코드는 K1 「잔여 위험」 그대로 범위 밖이다.

### V5b-10 — 프로세스별 기록과 그 까닭

- **가를 것이 있나**: 「Claude Desktop 을 다시 켜도 그대로이고, 동시에 뜬 두 MCP 서버는 서로 다른」 것을 찾았지만 없다. pid · 프로세스 시작 시각 · 부모 pid 는 다시 켜면 바뀐다. `clientInfo`(이름 · 판) · 명령줄 · 환경 · 작업 폴더는 같은 앱의 두 프로세스(Claude Code 의 같은 폴더 세션 둘, 다시 뜬 서버, `--resume`)가 같다. 대화 · 세션 식별자는 MCP 서버에 오지 않는다. 그래서 새 MCP 서버는 「내 대화를 앞서 맡았던 프로세스」 를 알 수 없다.
- **고른 쪽 = 알림 한 번 더, 놓치지 않기.** 프로세스마다 자기 기록만 쓴다(`<포트 파일>.client-<이름>-<해시>.p-<pid>-<시작 ms 36진>`, 내용 = 확인한 instanceId · 그 MCP 서버의 pid · 시작 시각, 토큰 없음). 새 프로세스는 같은 이름의 기록이 **하나도 없을 때**(처음 — 헛 알림 없음) 또는 **모든 기록**(살아 있든 끝났든)이 지금 프로그램일 때만 알림 없이 받아들인다. 하나라도 다르거나 읽을 수 없으면 get_status 만 통과, 문구는 새 `STANDALONE_RESTARTED_EARLIER(_NOTICE)`(「restarted since an earlier session of this AI app last used it (or that cannot be ruled out)」 — 이 프로세스에는 「your last call」 이 없으므로). 같은 프로세스 안의 재시작은 K1 문구 그대로.
- **정리(커지지 않게)**: 확인한 프로세스가 끝난 프로세스의 기록을 접는다. 다른 프로그램을 가리키거나 읽을 수 없는 것 → `<접두>.stale` 표시를 둔 **뒤** 지운다(그 기록은 다시 같아질 수 없다 — instanceId 는 되풀이되지 않는다). 지금 프로그램을 가리키는 것 → 하나만 남긴다. 살아 있는 다른 프로세스의 기록은 건드리지 않는다. V5 판의 이름 하나 기록은 끝난 기록으로 읽는다(지금 프로그램이면 헛 알림 없음).
- **값**: 표시(`.stale`)가 생기면 — 이 이름의 어느 끝난 세션이 다른 프로그램 실행을 봤다는 뜻 — 그 뒤로 이 이름의 **새 MCP 서버마다 알림이 한 번**(get_status 한 번) 붙는다. 프로그램을 다시 켜지 않았어도 붙는다(문구는 「earlier session」 이라 거짓이 아니다). 안내문의 흐름이 get_status 로 시작하므로 보통은 더 드는 것이 없다. 이 값을 줄이려면 「앞 세션 = 나」 를 가정해야 하고, 그 가정이 틀리면 알림을 놓친다 — 고르지 않았다.
- **교착 없음**: get_status 는 늘 보낸다. 자기 기록을 쓸 수 없어도(단위 시험: 그 자리가 폴더) 메모리로 풀린다. 이상한 기록(폴더)은 지우지 못하고 그대로 둔다.
- **남는 한계(문서 · 안내문)**: MCP 서버 하나를 여러 대화가 함께 쓰면 알림은 get_status 를 부른 대화에만 간다. 안내문 TRANSPORT 에 「That notice is given once per connection, not per conversation: when you resume earlier work in a conversation, call get_status and re-check the model …」 를 더했다. 기록 폴더에 쓸 수 없으면 처음 쓰는 이름은 늘 「처음」 으로 보인다(쓸 수 없으니 남길 수도 없다). 클라이언트 이름이 바뀌는 판 올림은 새 이름 = 처음이다.

시험(`mcp_port_file_contract.js` 14 묶음 새로 씀): 처음 → 알림 없음 · 기록은 프로세스별 · 프로그램 재시작 뒤 새 서버는 `EARLIER` 문구로 거절, get_status 한 번에 알림, 끝난 기록은 `.stale` 로 접힘 · Claude Code 독립 · 한쪽 확인이 다른 쪽을 안 풂 · 접힌 뒤 새 서버는 늘 알림(안전한 쪽) · 모든 기록이 지금 프로그램이면 새 서버도 알림 없음 · **같은 이름 둘(A · B) 중 B 만 새 프로그램을 확인 → 그 뒤 뜬 같은 이름의 C 는 알림**(V5b-10 의 (d)) · 살아 있는 쌍둥이 기록은 그대로 · 깨진 끝난 기록 → 알림 → 접힘 · V5 판 기록 이어받기 · 폴더 기록에도 풀림 · 단위: 자기 기록 자리가 폴더여도 풀림, 살아 있는 남의 기록은 안 지움.

### 게이트 · 남은 것

`npx tsc -p ./ --noEmit` · `npx eslint src webview/js test/webview` · `npm run test:webview` · `npm run check:mcp-parity` (Python 은 이번 변경과 무관해 돌리지 않음). 결과 줄은 보고서에. 진짜 Claude Desktop · Electron 으로는 돌리지 않았다(가짜 설정 · node 대역). 심볼릭 링크 설정은 이 PC 에서 여전히 `EPERM` 으로 건너뛴다.
