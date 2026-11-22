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
