# V5b — 독립 프로그램 재검증 (커밋 `cfaee9f`)

대상: `feature/desktop-program` 의 `cfaee9f`(고침 `4497b34` · `51e617f` · `cfaee9f`, 사이의 새 화면 `475c9e2` 포함). 처리 표는 작업문서 §6.9. 설치본은 본 트리 `desktop/installer/build/`(manifest `gitHead = cfaee9f…`, `gitDirty:false`)를 읽기만 했다. 검증자는 코드를 고치지 않았고 이 보고서만 썼다. 옛 번호는 V5-xx, 새 결함은 V5b-xx.

## 요약

- **옛 18 + 의심 5**: 닫힘 13 · 일부 7(V5-01 · 02 · 03 · 04 · 08 · 09 · 18b) · 열림(의도) 3(V5-12c · S1 · S4 — V5-12 의 a · b 는 닫힘). 표는 아래.
- **새 결함 11 건 — P0 0 · P1 1 · P2 1 · P3 9.** (V5b-06 은 코드 읽기, 나머지는 실행으로 확인)
  - **V5b-01 (P1)** — V5-01 은 「덮어쓰기」만 막았다. **없는 파일은 여전히 아무 곳에나 만들고, 그 내용을 공격자가 정할 수 있다**: `load_project` 가 모델의 모르는 최상위 키를 그대로 들여오고(`_checkLoadedModel` 의 `{ ...model }`) `save_project` 가 그것을 쓴다. 동료에게 받은 `.csd` 에 `mcpServers` · `hooks` 를 넣어 두면, AI 가 그 파일을 연 뒤 없는 `claude_desktop_config.json` 자리에 저장하는 것만으로 `mcpServers.evil.command = calc.exe` 가 든 설정 파일이 생긴다(확인). 설치 폴더의 `resources\stcfsd-verification.json`(V5-13 의 표식)도 같은 길로 만들 수 있다.
  - V5b-03 (P2) — `save_project` · `load_project` 가 UNC 경로(`\\호스트\공유\x.json`)를 받는다 → AI 가 고른 호스트로 SMB 연결(Windows 는 NTLM 자격 증명을 보낸다), 모델 내용이 그 공유로 간다. `\\127.0.0.1\C$\…` 로 쓰기 · 읽기 둘 다 성공을 확인(외부 호스트는 이 PC 의 네트워크 제한으로 시험하지 않음).
- **시험 줄**: `cd desktop && npm test` → smoke **51/51** · bridge **76/76** · connect **25/25** · ui **63/63** · installer unit **10/10**. `cd desktop/shell && npm test` → winConsole **19/19** · shell **51/51** · ui **13/13**(지난번 실패하던 `~/.claude.json` 감시는 Claude Code 가 도는 중에도 통과). 포장본(본 트리 빌드, 시험 자체가 이제 적대적 환경) **45/45**. 루트: `npx tsc -p ./ --noEmit` 0 · `npx eslint src webview/js test/webview` 0 · `npm run test:webview` 전부 PASS(사본에 `.venv` 가 없어 `panel_host_contract` 는 SKIP, `mcp_si_chain` 의 실제 패널 사슬도 건너뜀 — `panel_host_contract` 는 `.venv` junction 을 두고 따로 돌려 **PASS 9.2 s**) · `npm run check:mcp-parity` OK.
- **되돌리기 점검**(작성자 주장 표본): V5-01 의 `_refuseModelOverwrite` 를 끄면 `panel_host_contract` 가 assert 로 실패, V5-06 의 rename 앞 지문 확인을 지우면 `claude_desktop_contract` 가 실패 — 두 주장 모두 맞다.
- 진짜 설정 그대로: `%APPDATA%\Claude\…json` 2793 B · 2026-09-22 21:35:38, MSIX `…\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\…json` 8495 B · 2026-11-22 05:22:09, `~/.claude/mcp.json` 426 B · 2026-08-24. `%APPDATA%\StCFSD` 없음, Claude 폴더에 `*stcfsd*` 없음.

## 어떻게 돌렸나

지난번과 같다: `git archive -o … cfaee9f` → scratch 에 풀기 → `npm ci` · `tsc` · `build:mcp` · `build:webview` · `desktop` · `desktop/shell` 설치(Electron 캐시). Python 은 `STCFSD_PYTHON=<본 트리 .venv>`. 시험의 git 스냅숏은 `GIT_DIR=<내 worktree gitdir>` · `GIT_WORK_TREE=<사본>` · `GIT_OPTIONAL_LOCKS=0`. 포장본 시험과 `panel_host_contract` 에만 본 트리 `build/` · `.venv` 로 가는 junction 을 두었고(`.venv` 쪽은 `PYTHONDONTWRITEBYTECODE=1`), 끝나고 링크만 지웠다. 탐침(scratch, 모두 지움): `bridge2.mjs`(두 출처 · 열쇠 · 쿠키 범위 · `/ui/` · AI 파일 공격, 원시 소켓), `cfg2/3.cjs`(설정 쓰기), `mcp2.mjs`(진짜 MCP 서버 stdio · 재시작 기록 · `/hello` · 강제 종료), `reload2.mjs` · `ui.mjs`(헤드리스 Edge + CDP), `shell_iframe.mjs` · `ro.mjs`(Electron 시험 모드 — 창 보이지 않음), `uninst.mjs`(win-unpacked 사본의 제거 도우미, 늘 `--config` 가짜), python.mjs 캐시 변조(사본).

## 옛 결함 · 의심의 지금 상태

| 번호 | 상태 | 근거(내 탐침) |
|---|---|---|
| V5-01 | **일부** | 덮어쓰기는 막힘: 있는 Claude 설정(BOM · CRLF) 바이트 그대로, `.JSON` 대소문자 · 하드 링크 · junction 너머 · 끝 점 · 끝 공백 · `::$DATA` · 8.3 이름 모두 거절. 그러나 **없는 파일 만들기 + 내용 주입**은 남음 → V5b-01, UNC → V5b-03, 실패 때 찌꺼기 → V5b-08 |
| V5-02 | **일부** | 파일 내용은 더 새지 않는다(`notes.json` → `is not valid JSON`). 남은 것: 있음/없음/폴더/JSON 여부를 가르는 오라클(`ENOENT` · `EISDIR` · `is not valid JSON` · `Invalid nodes`), 읽는 크기 상한 없음(정적) → V5b-11 |
| V5-03 | **일부** | 테마 바꾸기 · 새로 고침 뒤 77.7 그대로(확인). 다만 보존한 입력이 **다른 파일 위에** 되살아난다 → V5b-02 |
| V5-04 | **일부** | 쓰기는 닫힘: 쿠키만 · Bearer 만으로 `POST` 7 경로 모두 403, 쿠키 값 ≠ 토큰, `/api/wv-key` 열쇠 없이 403. 남은 것: 쿠키만 가진 다른 로컬 포트(브라우저 모드)는 여전히 **읽는다** — `/api/state` · `/api/wv/<id>/last?command=modelLoaded`(모델 전체, 절점 75 행) · `/api/mcp/status` · `/api/claude/status` · `/api/events` 모두 200. 개발용 모드에 한정(P3 잔여) |
| V5-05 | 닫힘 | 만들어진 `nsis-script.nsi` 에 `!include …installer.nsh`, `${ifNot} ${isUpdated}` 안에서만. 사본의 `StCFSD.exe`(RUN_AS_NODE) + `disconnect.js`: 우리 항목 removed(691 ms) · 다른 설치 kept · 대소문자만 다름 removed · 사용자가 env 를 고친 항목 kept · 깨진 JSON invalid-config(종료 0) · `STCFSD_CLAUDE_CONFIG` · `NODE_OPTIONS=--require 없는것` 무시(퓨즈 꺼짐이 실행으로도 보임). 실제 제거는 돌리지 않음 |
| V5-06 | 닫힘(잔여는 문서대로) | 백업 쓰는 사이에 끼어든 Claude 의 서버가 남는다, 계속 바뀌면 `config-busy` · 쓰지 않음 · 백업 0. rename 바로 그때 끼어든 쓰기는 여전히 사라짐(작성자가 밝힌 µs 틈 — 확인) |
| V5-07 | 닫힘 | `app-root/THIRD_PARTY_NOTICES.txt` 9 패키지. 내가 소스맵에서 뽑은 묶음 패키지(`mcp-server` 7개 + `@babylonjs/core`) ⊂ 9 |
| V5-08 | **일부** | Claude Desktop 만 다시 켬 → 쓰기 통과(헛 알림 없음), 둘 다 다시 켬 → 동시 쓰기 거절 · 상태에 알림 · 그 뒤 통과, 망가진(10 KB) 기록 → 한 번 막히고 `get_status` 로 풀림(잠김 없음). 남은 것 → V5b-10 |
| V5-09 | **일부** | 산 pid + 남의 포트: 「실행 중이 아님」, 남이 받은 것은 `GET /hello` 하나. 그러나 그 `/hello` 에 **Bearer 토큰이 실려 간다** → V5b-05 |
| V5-10 | 닫힘 | `/.//evil.example/x?t=` → 200 교환 쪽, 이동 대상 `"/"` |
| V5-11 | 닫힘 | 쓸 수 없는 사용자 폴더: 종료 코드 4, IPC `fatal kind:userdata`(폴더 · 까닭). 시험 모드라 상자는 보지 못함 |
| V5-12 | (a)(b) 닫힘 · (c) 열림(의도) | 코드: 시작 중 열기는 차례(`pendingOpens`), 두 번째 실행의 `extra` 도 넘김 |
| V5-13 | 닫힘(아래 단서) | 다시 만든 exe 에서 되읽음: RunAsNode on, NODE_OPTIONS · inspect 인자 · file 특권 off. 표식은 win-unpacked 에 없고 설치 파일 목록 = manifest + Python + 2(포장본 시험). 표식 없는 설치본이 `STCFSD_*` 를 무시하는 것은 창을 띄우지 않고는 실행으로 보일 수 없다 — `main.ts:33-38`(`runMode` → `effectiveEnv` 로 `ENV` 를 만든 뒤에만 읽는다, 로더는 `pythonPath` 를 받아 `process.env.STCFSD_PYTHON` 에 닿지 않는다)를 읽어 확인. **단서**: 그 표식을 AI 가 만들 수 있다(V5b-01) |
| V5-14 | 닫힘 | 사본의 캐시 zip 한 바이트를 바꿔 `python.mjs` → 받기 전에 `캐시 파일의 sha256 이 고정값과 다르다` 로 멈춤(종료 1, 네트워크 없음). 본 트리 캐시의 zip · 휠 둘의 sha256 = PINS |
| V5-15 | 닫힘 | 중복 키: `"a"` · `"\u0061"` 같이 봄, 중첩 env 중복도, 배열 속 다른 객체의 같은 키는 정상. 하드 링크 유지(nlink 2, 링크도 우리 항목). 대소문자 · `..` 같은 경로 = 같음, 다른 exe = kept. 새 가장자리 → V5b-07 · V5b-09 |
| V5-16 | 닫힘 | 원시 바이트 경로 시험, `~/.claude.json` 은 MCP 부분만(shell 51/51), 포장본 시험이 적대적 환경, 수 고침. 포커스는 단위 시험뿐(작성자도 밝힘) |
| V5-17 | 닫힘 | 설치본 `app` · `app-root`(새 `ui/` 포함)에 `Coding_Works` · `Users\USER` · GitHub 이름 · 이메일 · `sourceMappingURL` · `.map` 0 |
| V5-18 | (a) 닫힘 · (b) 일부 | (a) 원래 nonce 값만 바꿈(코드). (b) iframe 은 다른 출처 — `/wv/` 문서에 열쇠 · 토큰 없음, 웹뷰 서버에 틀 경로 없음(404), 틀은 웹뷰 열쇠 · F2 만 건넨다. 그러나 Electron 은 **iframe 이 일으킨 맨 위 프레임 이동에도 쓰기 열쇠를 붙인다** → V5b-04 |
| V5-S1 | 열림(의도) | 덮어 설치는 끝내고 제거는 확인을 띄운다는 설명, 손 점검 목록. 실행하지 않음 |
| V5-S2 | 닫힘(시험으로만) | `mcp_port_file_contract` 의 V5-S2 묶음 PASS. 따로 탐침하지 않음 |
| V5-S3 | 닫힘(시험으로만) | 같은 시험의 V5-S3 묶음 PASS |
| V5-S4 | 열림(문서) | 작성자 확인: `?t=` 가 방문 기록에 남는다 — 브라우저 모드의 한계로 문서화 |
| V5-S5 | 닫힘 | `samePath` 로 비교(V5-15 확인과 같음) |

## 새 결함

| 번호 | 심각도 | 위치 | 무엇 (시나리오 → 일어나는 일 → 있어야 할 일) | 재현 · 증거 | 고칠 방향 |
|---|---|---|---|---|---|
| **V5b-01** | **P1** | `src/webview/StcfsdPanel.ts:1541-1558`(`_refuseModelOverwrite` — 없으면 `null`), `:1577`(`_checkLoadedModel` 의 `const out = { ...model }`), `:2732-2755` · `:2757-2789` | (1) 공격자가 동료의 `.csd` 처럼 보이는 파일의 `model` 에 `mcpServers` · `hooks` 같은 키를 넣는다. (2) AI 가 그 파일을 연다(`load_project`, 또는 사람이 화면에서 연다 — 같은 `_checkLoadedModel`). 모르는 키가 그대로 `_model` 에 들어간다. (3) AI 가 프롬프트 주입 · 실수로 `save_project` 를 **아직 없는** 설정 자리(다른 앱의 `settings.json`, MSIX 를 쓰는 PC 의 비어 있는 표준 `%APPDATA%\Claude\claude_desktop_config.json`, `~/.claude/settings.json`, 프로젝트 `.mcp.json`, 설치 폴더의 `stcfsd-verification.json` …)에 부른다 → 「새 파일」이라 통과, 공격자가 고른 최상위 키가 든 JSON 이 생긴다. 있어야 할 것: 모델은 알려진 키만 들이고, `save_project` 는 문서 폴더 아래 · `.stcfsd` 로 좁힌다. | `load crafted .csd -> {"success":true}` → `then save to absent claude_desktop_config.json -> {"success":true}` → `planted file top keys: format,version,prop,node,…,mcpServers,hooks · mcpServers.evil.command=C:\Windows\System32\calc.exe · hooks=true`. 다른 앱 폴더의 없는 `Code\User\settings.json` 생성 `created=true`. `<install>\resources\stcfsd-verification.json` 생성 `{"success":true}` | `_checkLoadedModel` 은 허용 키 목록만 복사, `save_project` 는 독립 모드에서 문서 폴더(또는 열린 파일 폴더) 안의 `.stcfsd` 만 · 기존 형식 확인 유지 · `%APPDATA%` · `%LOCALAPPDATA%` · 프로그램 폴더 · 숨은 점 파일 거절 |
| V5b-02 | P3 | `desktop/host/src/bridge/inject.ts:128,162-171,180-185`(보존 · 복원) | 설계 탭에 77.7 → 페이지가 사라짐(새로 고침 · iframe 다시 싣기 · SSE 재연결의 `location.reload()`) → 그사이 호스트가 다른 파일 Y(설계 Fy 50)를 연다 → 다시 뜬 페이지는 다시 보내기의 `restoreDesignInputs`(Y) 뒤 50 ms 에 **보존한 옛 입력을 덮는다** → 화면은 Y 의 모델에 옛 파일 · 옛 화면의 입력, 그대로 저장하면 Y 의 입력이 바뀐다. 저장한 `at` 은 쓰지 않는다(나이 · 모델 확인 없음). 창은 보통 짧다(새로 고침 동안 열기가 겹칠 때). | `reload2`: `Y file designInputs.fy=7.2519(=50 MPa)` · 다시 보내기에 `restoreDesignInputs` 있음 · 알림 `Project loaded` · 그런데 `page shows design-fy='77.7' -> PRESERVED OLD VALUE ON THE NEW FILE` | 보존할 때 모델 서명(또는 마지막 `restoreDesignInputs`/`modelLoaded` 의 seq)을 함께 두고, 다시 보내기의 것과 다르면 버린다. 몇 초 넘은 것도 버린다 |
| V5b-03 | P2 | 같은 두 경로(`path.isAbsolute` 만 봄) | AI 가 `save_project`/`load_project` 에 `\\공격자\공유\a.json` 을 주면 Windows 가 그 호스트로 SMB 를 연다(NTLM 해시가 간다), 모델은 그 공유에 쓰인다 · 거기서 읽힌다. | `\\127.0.0.1\C$\…\unc.json` 쓰기 `{"success":true}` · 읽기 `{"success":true}`(외부 호스트로는 시험하지 않음 — 이 PC 의 네트워크 한계) | 로컬 드라이브 경로만(`\\` · `//` · `\\?\UNC\` · 매핑된 네트워크 드라이브 거절) |
| V5b-04 | P3 | `desktop/shell/src/main.ts:325-333`(`frame && !frame.parent` 이면 열쇠), `:293-303`(다리 두 출처로의 맨 위 이동 허용) | 끼운 웹뷰(다른 출처) 안의 스크립트가 `<form target=_top method=POST action=<틀>/api/claude/connect>` 이나 `top.location = <틀>/api/wv-key` 를 하면 그 이동 요청은 **맨 위 프레임의 요청**이라 Electron 이 `X-StCFSD-Key` 와 Bearer 를 붙인다. 막는 것은 다리의 `Origin`/`Sec-Fetch-Site` 검사 하나뿐이다. 그리고 iframe 이 앱 창 전체를 JSON 오류 페이지로 바꿔 놓는다(UI 가 사라짐). | Electron 시험 모드: A `keyed requests +1`, 응답 `{"error":"다른 출처의 요청: null"}`, 설정 안 바뀜 · 창 주소 `…/api/claude/connect`. B `keyed +1`, `{"error":"다른 사이트의 요청(Sec-Fetch-Site: same-site)"}` · 창 주소 `…/api/wv-key` | 열쇠는 맨 위 프레임 **문서의 출처에서 시작한** 요청(`details.frame` 의 출처 = 틀 출처, 이동이면 initiator 확인)에만. 맨 위 이동은 `/` · `/ui/` 만 허용 |
| V5b-05 | P3 | `src/mcp/server.ts:66-95,101-123`(`httpCall` 이 늘 `Authorization` 을 붙임) | 확인 전 상대에게 보내는 `GET /hello` 에 Bearer 토큰이 실린다 — 「확인 안 된 포트에는 토큰을 보내지 않는다」 가 아니다. 남의 포트(강제 종료 뒤 pid · 포트 재사용, 다른 Windows 사용자의 프로그램)는 그 포트 파일의 토큰을 받는다. 지금은 그 토큰의 주인이 죽었으므로 피해는 작다. 증명은 instanceId + nonce 만 묶고 **응답 본문은 묶지 않는다**(코드) — 같은 사용자 권한의 중계자는 본문을 바꿀 수 있다. | 가짜 서버가 받은 것: `GET /hello auth=Bearer abababab… nonce=yes body=0` | `/hello` 는 토큰 없이 nonce 만 보내고 HMAC 으로 답을 본다(호스트도 `/hello` 는 토큰 없이 증명만). 증명에 본문 해시를 넣는다 |
| V5b-06 | P3 | `inject.ts:103-189`, `bridge/index.ts:419-433` | 웹뷰 열쇠 하나를 설계 패널과 좌굴 보고서가 함께 쓴다 — 보고서 문서(설계 페이지가 보낸 HTML)도 `/api/wv/<설계 id>/out?k=` 로 붙어 설계 페이지를 `superseded` 시키고 그 대신 메시지를 넣을 수 있다. 지금 보고서에 사용자 문자열이 없어 잠재적. | 코드 읽기(열쇠는 출처 하나에 하나, 통로는 id 를 검사하지 않음) | 웹뷰 id 마다 열쇠(틀이 그 iframe 의 id 에 맞는 것만 건넨다) |
| V5b-07 | P3 | `src/mcp/claudeDesktop.ts:537-554,594-606` | 하드 링크된 설정의 제자리 쓰기에서 `ftruncate` 뒤 실패(디스크 가득 · 전원)하면 설정이 **0 바이트**로 남고, 결과는 `write-failed` + 백업 경로뿐 — 되돌리지 않는다. 빈 파일은 `{}` 로 읽혀 다음 「연결」 이 그 위에 우리 항목 하나만 쓴다(다른 서버는 백업에만). 또, 아주 깊이 중첩된 설정(배열 5000 겹)은 `findDuplicateKey` 를 지나 `JSON.stringify` 에서 스택이 넘쳐 **예외가 밖으로** 나간다(파일은 그대로). | `cfg3`: `crash after truncate: write-failed · config now 0 bytes · backup=…` → `check now: not-registered · next connect … added · other server present after=false`. `deep 5000: THROWS RangeError` | 실패하면 백업에서 제자리로 되돌린다. 빈 파일인데 백업이 있으면 `invalid-config` 로. 깊이 상한 · 예외를 `invalid-config` 로 |
| V5b-08 | P3 | `StcfsdPanel.ts:2746-2753`(`save_project` 의 tmp + rename, 실패 때 지우지 않음) | 덮어쓸 수 있는 모델이 읽기 전용이면 `ro.json.tmp-<pid>` 가 남는다. `claude_desktop_config.json:evil.json` 처럼 ADS 이름을 주면 rename 은 `EINVAL` 로 실패하지만 **Claude 설정 파일에 `evil.json.tmp-<pid>` 스트림이 붙은 채** 남는다(본문은 그대로). | `leftovers=ro.json.tmp-106116`, `streams=:$DATA,evil.json.tmp-106116` · `main stream unchanged=true` | `:` 가 든 경로 거절, 실패하면 tmp 를 지운다 |
| V5b-09 | P3 | `claudeDesktop.ts:437-460`(`CLAUDE_BACKUPS_KEPT = 5`) | 연결 · 끊기 다섯 번이면 **StCFSD 가 처음 손대기 전의 원본 백업**이 지워진다(가장 오래된 것부터). 주석의 「연결 전 사본이 남을 만큼」 과 다르다. 우리 이름 꼴이 아닌 파일 · 폴더 · 다른 설정의 백업은 건드리지 않는다(확인). | 백업 3 개(2020) + 새로 6 번 → 남은 것 2026 의 5 개 + 폴더 · `…-manual` · `other.json…`, 2020 의 셋 삭제 | 처음 백업(우리 첫 쓰기 전 원본)은 따로 이름 붙여 늘 남긴다 |
| V5b-10 | P3 | `src/mcp/hostConnection.ts:164-216`, `portFile.ts:218-223` | 기록은 `clientInfo.name` 으로만 가른다. 같은 이름을 쓰는 다른 MCP 서버(Claude Code 의 다른 세션, 이름을 흉내 낸 프로세스)가 다시 켠 프로그램에 `get_status` 를 하면 기록이 새 프로그램으로 바뀌어, 그 뒤 뜬 같은 이름의 새 MCP 서버(옛 대화를 이어 가는 세션)는 알림 없이 쓴다. 또 MCP 서버 하나를 여러 대화가 함께 쓰므로 한 대화의 `get_status` 가 옛 맥락의 다른 대화도 풀어 준다(설계상 한계 — 문서에 없음). | `(d) … real client write -> err=false (false = notice lost)` · `(c) unseen client name after restart: write -> err=false` | 기록에 MCP 서버 pid · 시작 시각을 남겨 「같은 이름의 다른 서버가 확인한 것」 은 이어짐의 근거로 쓰지 않기. 한계를 K1 문서 · 도구 설명에 |
| V5b-11 | P3 | `StcfsdPanel.ts:2757-2779` | 남은 오라클: AI 는 아무 `.json/.csd/.stcfsd` 경로가 없음(`ENOENT`) · 폴더(`EISDIR`) · JSON 아님 · JSON 이지만 모델 아님(`Invalid nodes`)을 가를 수 있고, 문구에 전체 경로가 돌아온다. 읽는 크기에 상한이 없다(`save` 쪽 확인은 64 MiB 상한이 있다) — 큰 파일 하나로 호스트가 멈춘다(정적). | `load absent -> (ENOENT)` · `dir -> (EISDIR)` · `not json -> is not valid JSON` · `other json -> Invalid nodes: array required` | 하나의 문구(「StCFSD 모델 파일을 읽지 못했다」), 크기 상한, V5b-01 의 폴더 제한 |

## 새 설계를 공격했지만 건전했던 것

- **두 출처 다리**: 틀 서버의 `POST` 는 쿠키만 · Bearer 만이면 7 경로 모두 403, `PUT/DELETE/OPTIONS/PATCH` 405, 사전 요청에 CORS 머리 없음. `/api/wv-key` 는 열쇠 없이 403. 교환 페이지: `no-store`, 자체 nonce CSP · `frame-ancestors 'none'`, 쿠키 값 ≠ 토큰, 열쇠는 본문 스크립트에만. 웹뷰 서버: 틀 경로 없음(404), 문서에 쓰기 열쇠 · 토큰 · 웹뷰 열쇠 · MCP 토큰 없음, `frame-ancestors <틀>`, 같은-사이트 예외는 `GET /wv/` + `Sec-Fetch-Dest: iframe` + Origin 없음일 때만(빈 dest · Origin 있음 · `/res/` 는 403), `out` 은 `?k=` 없이 403, `in` 은 열쇠 없이 403 · 다른 conn 409. 틀 서버는 `/wv/` 를 내주지 않는다. WebSocket 업그레이드 처리기 없음(평범한 GET 으로 다뤄짐). iframe → 부모: 틀 · 새 화면 모두 출처 · `e.source` 를 보고 웹뷰 열쇠와 F2 만. 새 화면 `/ui/`: `index.html` · `dist/` · `style/` 만(소스 · 시험 · README · 경로 넘나들기 404), CSP `script-src 'self'`(인라인 없음).
- **Electron**: 웹뷰 안에서 부모 문서 · 저장소 · 틀 출처 fetch 는 모두 막힘(작성자 시험과 같음). 위 V5b-04 의 길도 다리 검사가 막았다(설정 그대로).
- **새 화면의 글**: 호스트 · 엔진 문자열은 모두 `esc()`(속성은 `tip()` 안의 `esc`, 「결과 없음」 칸은 `none()` 안의 `esc`). 인라인 스크립트가 CSP 로 막혀 있어 주입이 있어도 실행되지 않는다. AI 가 MCP 로 해석 → 단면 바꾸기를 하면 띠가 `fsm:ok → fsm:stale`, 새로 고침 뒤에도 `stale`. sessionStorage 에는 쓰기 열쇠(브라우저 모드의 설계)와 본 결과 기록 둘.
- **재시작 기록 · 증명**: 클라이언트 이름은 `[a-z0-9._-]` 로 줄이고 원래 이름의 해시 8 자 — 경로 넘나들기 없음. 기록 4 KiB 상한, 남의 것 · 깨짐 · 너무 큼 = 재시작으로 한 번, 잠김 없음. 증명 비교는 `timingSafeEqual`, nonce 는 요청마다 16 바이트.
- **강제 종료**: `taskkill /F` 뒤 Python 자식 0, 포트 파일은 남지만 「실행 중이 아님」.
- **설정 쓰기 · 제거 도우미 · 핀 · 고지 · 퓨즈** — 위 표.

## 못 본 것

- 설치 파일 실행(제거 훅이 실제 제거에서 도는지, 「실행 중입니다」 확인) — 금지. 도우미는 사본에서 직접.
- 표식 없는 설치본이 `STCFSD_*` 를 무시하는 것의 실행 확인 — 무시되면 창이 보이게 뜨므로 이 PC 에서 할 수 없다(코드로만).
- V5-11 의 알림 상자 자체(시험 모드라 뜨지 않음).
- 외부 호스트로의 UNC/SMB(V5b-03) — 이 PC 에서 외부 네트워크를 쓰지 않는다.
- 진짜 Claude Desktop · Claude Code 가 V5b-01 로 심은 파일을 어떻게 읽는지(진짜 설정 자리를 건드릴 수 없다).
- 심볼릭 링크 설정(권한 없음).

## 정리

- 띄운 serve · headless · Electron(시험 모드) · 헤드리스 Edge · MCP 서버 · Python 모두 끝남: `electron.exe` · `StCFSD.exe` 없음, 내 명령줄을 가진 프로세스 없음(남은 `node …/media/mcp-server.js` #31396 은 검증 전부터 있던 사용자의 것). `v5b-*` 임시 폴더 0, scratch 사본 · 탐침 · junction 삭제(링크만 지운 뒤 대상 그대로 확인).
- git 쓰기 없음. 하니스가 본 트리 쓰기를 막아 이 보고서는 내 worktree 의 같은 상대 경로(`docs\reviews\20261122-engine-review\verify\V5b-desktop-reverify.md`)에 썼다. 그 밖에는 아무것도 쓰지 않았다. `C:\Coding_Works\StAnal` 에는 닿지 않았다.
