# installer — Windows 설치 파일 · 함께 묶는 Python (S5 · V5)

2026-11-23 · 결과는 `build/dist/StCFSD-Setup-<판>-x64.exe` 하나 — 사용자 단위(관리자 권한 없음) NSIS 설치 파일.
출력은 모두 `build/`(git 이 무시한다 · 약 0.8 GiB) — 커밋하지 않는다.

## 만들기

저장소 루트에서(먼저 `cd desktop/shell && npm install` — Electron 45.2.3 · electron-builder 26.18.0):

```
cd desktop && npm run installer                 # = 아래 셋을 차례로(node installer/build.mjs --all --win)
node desktop/installer/stage.mjs                # 1. 실을 것을 모두 다시 빌드하고(아래) 모은다 → build/stage/ (manifest.json)
node desktop/installer/python.mjs               # 2. Python + numpy · scipy 묶음 → build/python-win-x64/ (받은 파일은 build/downloads/ 에 캐시)
node desktop/installer/build.mjs --win          # 3. electron-builder → build/dist/ (설치 파일 + win-unpacked/ + nsis-script.nsi)
cd desktop && npm run test:packaged             # 확인(설치하지 않는다 — 아래)
cd desktop && node installer/test/unit.mjs      # 단위(고정값 · 실행 모드 · 고지 · 인자) — desktop 의 npm test 끝에도 있다
```

**낡은 빌드를 싣지 않는다.** `stage.mjs` 는 실을 것을 모두 지금의 소스에서 다시 만든다(저장소의 `out/` · `media/` 는 건드리지 않는다):
확장 호스트는 빈 폴더(`build/out-fresh`)에 `tsc`, MCP 서버 · 3D 뷰어 번들은 루트의 webpack 설정 그대로 빈 폴더(`build/media-fresh`)에,
호스트 · 껍데기 · 새 검토 화면은 각자의 `build.mjs`. `manifest.json` 의 `source` 에 git HEAD 와 **커밋 안 된 변경 목록**(`src` · `python` ·
`webview` · `media` · 루트 설정 · `desktop/` 전부 — V5-17)을 적는다.

## 들어 있는 것 · 크기

| | 크기 |
|---|---|
| 설치 파일 `StCFSD-Setup-0.1.1-x64.exe` | **147.3 MiB** (7z 압축) |
| 설치 뒤(= `win-unpacked/`) | **454.9 MiB** |
| ├ Electron 45.2.3(`StCFSD.exe` 239 MiB · DLL · 한국어 · 영어 언어 묶음만) | 309.1 MiB |
| ├ `resources/python/` — CPython 3.13.14 + numpy 2.4.4 + scipy 1.17.1 | 141.8 MiB (scipy 72 · numpy.libs 21 · scipy.libs 20 · numpy 13 · Python 20) |
| ├ `resources/app-root/` — 확장 호스트(`out/`) · 엔진(`python/`) · `webview/` · `media/`(mcp-server.js) · `THIRD_PARTY_NOTICES.txt` | 3.4 MiB |
| └ `resources/app/` — 껍데기(main · preload) · 호스트 묶음 · 틀 · 새 검토 화면(`ui/`) · 제거 도우미(`uninstall/disconnect.js`) | 0.4 MiB |

`resources/` 배치는 `desktop/shell/src/layout.ts` 의 `installed` 와 같아야 한다(바꾸면 둘을 같이). 그 밖에 electron-builder 가 스스로 두는 것은
`resources/elevate.exe`(NSIS 틀 — 사용자 단위 설치에선 쓰지 않음)와 `resources/default_app.asar`(Electron 기본 앱 — 읽히지 않음)뿐이다.

넣지 않는 것: 저장소의 `node_modules` · `src/`(TS 원본) · `docs` · `Example` · `test` · `.venv` · `*.map` · `__pycache__` · 엔진의 시험 파일.
배포용 `app-root/package.json` 에서는 `repository` · `bugs` · `homepage` · `scripts` · `devDependencies` 를 뺀다. 실은 `.js` 끝의
`//# sourceMappingURL=` 은 뺀다(그 맵을 싣지 않는다 — V5-17).

**제3자 고지(V5-07)**: `app-root/THIRD_PARTY_NOTICES.txt` — 실은 번들(`media/mcp-server.js` · `media/viewer3d*.js` · `app/host/index.js` ·
`app/dist/*.js` · `app/ui/dist/main.js`)의 **소스맵에서** 묶인 npm 패키지를 뽑아(손으로 적은 목록이 아니다) 이름 · 판 · 라이선스 원문을,
NOTICE 가 있으면 그것도(Babylon.js — Apache-2.0) 싣는다. 지금 9개: @babylonjs/core 7.54.3 · @modelcontextprotocol/sdk 1.29.0 · ajv 8.18.0 ·
ajv-formats 3.0.1 · fast-deep-equal 3.1.3 · fast-uri 3.1.3 · json-schema-traverse 1.0.0 · zod 4.3.6 · zod-to-json-schema 3.25.2.
라이선스 원문이 없는 묶인 패키지가 있으면 `stage.mjs` 가 멈춘다. `out/` 은 Node 내장 모듈과 `vscode`(호스트의 대체 모듈) 말고는 require 하지 않는지 본다.
Python 쪽은 `resources/python/THIRD_PARTY_NOTICES.txt` · `licenses/`, Electron · Chromium 은 설치 폴더의 `LICENSE.electron.txt` · `LICENSES.chromium.html`.

## 고정한 판 · 확인하는 것(V5-14)

| | 판 | 고정 · 확인 |
|---|---|---|
| Electron | 45.2.3 | `desktop/shell/package.json`(정확한 판) — `electronDist` 로 이미 받은 것을 쓴다 |
| electron-builder | 26.18.0 | 같은 곳(개발 의존성). `npm audit` 이 그 의존성에서 moderate 6건을 보고한다 — 빌드할 때만 쓰고 설치본에는 들어가지 않는다 |
| CPython | 3.13.14 embeddable amd64 | 주소 · **sha256 을 `python.mjs` 의 `PINS` 에 고정**. 받은 파일 · 캐시 모두 그것과 맞춰 보고 다르면 멈춘다. 그 zip 안의 .exe · .dll · .pyd **30개 모두** Authenticode 서명이 유효(PSF, vcruntime 은 Microsoft)한지 빌드마다 본다. 고정값은 2026-11-22 python.org 에서 처음 받은 것의 sha256 이다(그때도 30개 모두 서명 유효) |
| numpy | 2.4.4 (cp313 win_amd64 휠) | 주소 · sha256 고정(= PyPI 가 공개한 digest). 휠 안의 DLL(OpenBLAS 등)은 서명이 없다 — sha256 고정이 확인의 전부다 |
| scipy | 1.17.1 (cp313 win_amd64 휠) | 같음. 의존성은 numpy 하나 |

받는 중에는 임시 이름(`.part`)에 쓰고 맞으면 이름을 바꾼다. HTTP 200 이 아니면 멈춘다. 받는 곳은 python.org · files.pythonhosted.org 뿐.
판은 저장소의 `.venv`(개발에 쓰는 것)와 같다. 바꾸려면 `PINS` 의 판 · 주소 · sha256 을 함께 고친다.

**Python 이 어떻게 자기 것만 쓰나.** embeddable 배포판의 `python313._pth` 가 sys.path 를 정한다:
`python313.zip` · `.` · `Lib\site-packages` · `..\app-root\python`(엔진 — ._pth 모드에선 스크립트 폴더가 sys.path 에 들어가지 않는다).
모두 상대 경로라 폴더째 어디로 옮겨도 된다. ._pth 가 있으면 PYTHONPATH · PYTHONHOME · 사용자 site-packages 를 보지 않는다 — 포장본 시험이
PATH 맨 앞의 가짜 `python.exe` · 가짜 numpy · sitecustomize · PYTHONSTARTUP · 사용자 site 의 `.pth` 를 둔 환경으로 이것을 본다.
껍데기는 `resources\python\python.exe` 를 `python.defaultInterpreterPath` 로 넘긴다(사용자 PC 의 Python 을 찾지 않는다).

**덜어 낸 것**(`python.mjs` 의 `TRIM`): numpy · scipy 의 자체 시험(`*/tests`), numpy C 헤더 · 정적 라이브러리 — 22.8 MiB · 48곳(+ 휠의 빈 항목이 풀린 0 바이트 `.whl`).

## 설정에서 정한 것(`electron-builder.config.cjs`)

- **appId `local.stcfsd.desktop` — 절대 바꾸지 않는다.** Windows 의 AppUserModelID 이고 NSIS 가 이것으로 설치 GUID(제거 정보 키)를
  만든다. 바꾸면 새 판이 옛 판을 덮어 설치하지 못하고 둘이 따로 남는다. 꼴은 같은 사람의 StAnal(`local.stanal.desktop`)을 따랐다.
- 제품 이름 · 실행 파일 `StCFSD`, Windows x64, NSIS 한 번 누르기 · 사용자 단위(`%LOCALAPPDATA%\Programs\StCFSD`, 권한 올리기 없음), 한국어.
- 시작 메뉴 · 바탕 화면 바로 가기, 제거 프로그램(설정 → 앱에 「StCFSD」), `.csd` 파일 연결(StCFSD.Project).
- **asar 를 쓰지 않는다.** Python(`python.exe` · `server.py`)과 Claude Desktop 이 띄우는 MCP 서버(`mcp-server.js`) · 제거 도우미는 디스크의 진짜 파일이어야
  해서 어차피 asar 밖이다. asar 에 넣을 수 있는 것은 0.4 MiB 의 껍데기뿐이라 얻는 것이 없고, 다리가 틀 파일을 `realpath` · 스트림으로
  내주므로 asar 의 fs 흉내에 기대지 않는 편이 안전하다. 그래서 asar 무결성 · 「asar 에서만 싣기」 퓨즈는 켤 수 없다. electron-builder 의
  경고 「asar usage is disabled」는 이 이유로 무시한다.
- **퓨즈(V5-13)**: RunAsNode **켬**(Claude Desktop 이 `StCFSD.exe <resources>\app-root\media\mcp-server.js` + `ELECTRON_RUN_AS_NODE=1` 로 MCP
  서버를 띄우고, 제거 도우미도 그 길로 돈다). **끔**: NODE_OPTIONS 환경 변수(`--require` 로 코드 넣기) · `--inspect` 류 명령줄 인자(디버거 붙이기) ·
  file:// 의 추가 특권(이 프로그램은 file:// 을 싣지 않는다). 포장본 시험이 설치 파일의 `StCFSD.exe` 에서 다시 읽는다.
- **서명하지 않는다.** 인증서가 없다. 앱 아이콘도 아직 없다(`icons/icon.ico` 를 두면 실행 파일 · 설치 파일 · 파일 연결에 쓴다 — 지금은 Electron 기본 아이콘).
- **제거 단계(V5-05, `installer.nsh` → `nsis.include`)**: 제거 프로그램이 설치 폴더의 파일을 지우기 **바로 앞**(`customUnInstall`)에
  `ELECTRON_RUN_AS_NODE=1 "$INSTDIR\StCFSD.exe" "$INSTDIR\resources\app\uninstall\disconnect.js"` 를 보이지 않게(nsExec, 15 초 제한) 돌린다 —
  제목 표시줄의 「끊기」와 같은 K1 도우미로, Claude Desktop 설정의 `mcpServers.stcfsd` 가 **이 설치본의 항목과 같을 때만** 지운다(다른 항목 ·
  다른 설치를 가리키는 stcfsd · 깨진 설정은 그대로). 무엇이 실패해도 종료 코드 0 — 제거를 막지 않는다. **덮어 설치(새 판이 옛 판의 제거
  프로그램을 `--updated` 로 부름)에서는 하지 않는다** — 설치 자리가 같아 등록이 그대로 맞다. 만든 NSIS 스크립트는 `build/dist/nsis-script.nsi`
  (electron-builder 의 디버그 기록에서 꺼냄)에 두고 `build.mjs` · 포장본 시험이 그 연결을 본다.
- 제거해도 `%APPDATA%\StCFSD`(설정 · 창 위치 · 로그 · `mcp\` 의 포트 파일과 MCP 클라이언트 기록 `stcfsd-mcp-port.client-*` — K1 V5-08, 토큰 없음)는
  남긴다(`deleteAppDataOnUninstall: false`). Claude 설정 폴더의 우리 백업(`*.stcfsd-backup-*`, 최근 5개)도 남는다.

## StCFSD 가 떠 있을 때의 설치 · 제거(V5-S1) — electron-builder 템플릿이 하는 일

Claude Desktop 이 떠 있으면 MCP 서버로 쓰는 `StCFSD.exe`(ELECTRON_RUN_AS_NODE)가 Claude Desktop 의 자식으로 늘 떠 있다 — 사용자가 StCFSD
창을 닫았어도 작업 관리자에 「StCFSD」 가 보인다. electron-builder 26.18.0 의 NSIS 틀(`templates/nsis/include/allowOnlyOneInstallerInstance.nsh` 의
`_CHECK_APP_RUNNING`, 설치는 `installSection.nsh`, 제거는 `uninstaller.nsh` 의 `un.onInit` · 한 번 누르기면 제거 확인 뒤)이 하는 일을 읽은 대로:

1. **실행 중 찾기**: PowerShell 이 있으면 `Get-CimInstance Win32_Process` 에서 **실행 파일 경로가 `$INSTDIR` 로 시작하는 모든 프로세스** — 창 ·
   MCP 서버(Claude Desktop 의 자식) · 묶은 `python.exe` 가 모두 걸린다. PowerShell 이 막혀 있으면 `tasklist` 로 이름 `StCFSD.exe`(사용자 단위).
2. **덮어 설치(`--updated`)**: 묻지 않고 1 초 기다린 뒤 그 프로세스들을 끝낸다(`Stop-Process`, 안 되면 `-Force`).
3. **처음 설치 · 수동 제거**: 「StCFSD이(가) 실행 중입니다. OK을 클릭하면 종료됩니다.」(확인/취소). 확인 → 위처럼 끝낸다, 취소 → 설치 · 제거 중단.
   조용한 모드(`/S`)는 확인으로 친다. 두 번 해도 남아 있으면 「닫을 수 없다 — 직접 닫고 다시」(다시 시도/취소).
4. 그래서 MCP 서버도 끝난다 — Claude Desktop 은 그 서버가 끊겼다고 보고, 다음에 StCFSD 도구를 부르면 다시 띄우려 한다(덮어 설치였으면 새 판으로
   뜬다, 제거였으면 실패하다가 Claude Desktop 을 다시 시작하면 — 제거 단계가 항목을 지웠으므로 — 사라진다).

**정한 것**: 이 동작을 그대로 쓴다. MCP 서버는 상태가 없는 통역(stdio ↔ 프로그램의 HTTP)이라 끝내도 잃는 것이 없고, 파일을 바꾸려면 어차피
끝내야 한다. 우리 NSIS include 로 따로 끝내는 단계를 넣지 않았다(이 PC 에서 설치 파일을 돌려 볼 수 없어, 템플릿과 겹치는 단계를 검증 없이
더하는 것이 더 위험하다). 사용자에게 보이는 차이는 3 의 물음이 「창을 닫았는데도」 뜰 수 있다는 것 — 손 확인 목록에 넣었다.

## 확인 — `test/packaged.mjs` (설치하지 않는다)

이 PC 는 작업 PC 라 설치 파일을 돌리지 않는다(레지스트리 · 시작 메뉴 · 파일 연결을 쓰지 않음). 대신

1. **설치 파일 안의 것을 그대로 꺼낸다** — Bandizip 콘솔(`bz.exe`)로 NSIS 안의 `app-64.7z` 를 꺼내 공백 · 한글 경로(`%TEMP%\stcfsd-s5-*\시험 폴더 (공백)\StCFSD`)에
   푼다(설치가 `$INSTDIR` 에 하는 일). 그 모든 파일의 sha256 = `win-unpacked` = 묶음 목록(`manifest.json`의 sha256) + Python 묶음 + electron-builder 의 둘.
2. 퓨즈를 그 `StCFSD.exe` 에서 다시 읽고, NSIS 스크립트의 제거 단계 연결, 배포용 package.json · sourceMappingURL · 제3자 고지 · 새 화면 · 제거 도우미를 본다.
3. **확인용 표시 파일 하나**(`resources/stcfsd-verification.json`)만 더한다 — 아래 「시험하는 것 = 배포하는 것」.
4. **적대적 환경**(PATH 맨 앞 가짜 `python.exe` · PYTHONPATH · PYTHONHOME · PYTHONSTARTUP · PYTHONUSERBASE)에서 `StCFSD.exe` 를 **보이지 않게** 띄운다.
   처음 화면의 기본 단면 H 100 mm(1e-9) · 강재 SGC400 295 / 400 MPa(낡은 빌드를 싣지 않았는지), 엔진 python.exe 가 그 폴더 안의 것(프로세스 표),
   끼운 웹뷰가 다른 출처, Python 자식에 콘솔 창 없음(창 핸들 0).
5. 명령줄의 `.csd` → **설치본의 `StCFSD.exe` + `ELECTRON_RUN_AS_NODE=1`**(퓨즈 적용)로 MCP 서버(도구 59개 · get_status) → 좌굴 → 하중 → 퍼린 설계 →
   메뉴 저장 · 열기(절점이 같다) → 가짜 numpy · sitecustomize · startup · `.pth` 가 하나도 돌지 않았다. 「연결」 이 가짜 설정에 쓰는 항목이 그 폴더 안의 경로.
6. **제거 도우미**를 그 폴더의 `StCFSD.exe`(node 로)로 가짜 설정에: 우리 항목만 지움(다른 서버의 비밀 그대로) → 다시 돌리면 「없음」 → 다른 설치를
   가리키는 stcfsd 는 그대로(바이트) → 깨진 설정이어도 코드 0.
7. 끝난 뒤 그 폴더의 배포한 파일이 모두 설치 파일의 것과 같다(더해진 것은 표시 파일과 Python 이 돌며 쓴 `__pycache__\*.pyc` — 엔진 소스 ·
   numpy 몇 모듈, 약 250개. 설치 폴더는 그 사용자가 쓸 수 있는 자리라 Python 이 바이트코드 캐시를 쓴다 — 제거 때 폴더와 함께 지워진다), 남은 프로세스 0, 진짜 Claude · MCP 설정(`~/.claude.json` 은 MCP 등록만) ·
   `%APPDATA%\StCFSD` · 설치 자리 · 바로 가기 · 저장소(desktop/ 밖)가 그대로.

### 시험하는 것 = 배포하는 것(V5-13 의 설계)

설치본은 시험 모드(창을 보이지 않음 · 주 프로세스의 IPC 제어 통로 · 가짜 대화상자)와 개발 덮어쓰기(`STCFSD_SHELL_TEST` · `STCFSD_PYTHON` ·
`STCFSD_CLAUDE_CONFIG` · `STCFSD_DOCUMENTS`)를 **따르지 않는다** — `desktop/shell/src/mode.ts` 의 `runMode`: 설치본(`app.isPackaged`)이면
`<resources>/stcfsd-verification.json` 이 **이 빌드의 표시**일 때만 연다 — 표시는 스스로를 지킨다(`verificationMarkerValid`): 정확히 `{"schema": "stcfsd-verification/1", "mainBundleSha256": <지금 돌고 있는 resources/app/dist/main.js 의 sha256>}`(+ `note` · `createdAt`)이어야 하고, 다른 키가 하나라도 있으면 아니다. StCFSD 모델 파일은 `schema` · `mainBundleSha256` 을 가질 수 없고(`save_project` 는 모델 키만 쓴다 — `de7036b`, 그리고 설치 폴더 · AppData 에는 쓰지 않는다), 다른 키가 섞이면 거절되며, sha256 이 다른 빌드의 표시 · 옛 꼴의 표시는 효과가 없다(단위 시험 `installer/test/unit.mjs` · 포장본 시험이 설치본의 main.js 로 본다). 그 파일은 설치 파일 · `win-unpacked` 에 없다(포장본 시험이 본다). 포장본 시험은 설치
파일에서 꺼낸 파일 그대로 + 그 파일 하나로 띄우고, 띄우기 전과 끝난 뒤에 나머지 모든 파일의 sha256 이 설치 파일의 것과 같은지 본다 — 시험한
실행 파일 · main.js · 호스트 · Python 은 바이트까지 배포하는 것이다. 표시 파일이 없을 때 시험 변수를 무시하는 것은 `runMode` 단위 시험과(설치본 +
표시 없음 → 시험 · 덮어쓰기 꺼짐), 설치본의 main.js 에 그 갈림이 들어 있는지로 본다 — 표시 파일 없는 설치본을 띄우면 창이 보이므로
보이지 않게 띄워 볼 수는 없다. 같은 사용자 권한의 프로그램은 그 파일을 만들 수 있지만, 그러면 설치 폴더의 main.js 도 바꿀 수 있다(사용자
단위 설치 폴더는 그 사용자가 쓸 수 있다) — 표시 파일이 그것보다 약하게 만들지 않는다.

## SmartScreen

서명하지 않은 설치 파일이라 처음 받은 PC 에서 「Windows의 PC 보호」가 뜬다 → **추가 정보 → 실행**. 사내 배포라면 사내 공유 폴더 ·
메신저로 넘기고 이렇게 안내한다. 경고를 없애려면 코드 서명 인증서(OV/EV)로 `StCFSD.exe` 와 설치 파일을 서명해야 한다 —
설정의 `win` 에 인증서를 주면 electron-builder 가 서명한다(묶은 Python 의 실행 파일 · DLL 은 이미 PSF 서명이 있다).

## 판 올리기 · 업데이트

판은 저장소 루트 `package.json` 의 `version` 이다(`stage.mjs` 가 앱 `package.json` 에 옮긴다 → 설치 파일 이름 · 제거 정보). 자동 업데이트는
없다(`publish: null`) — 새 설치 파일을 그냥 실행하면 같은 appId 라 제자리에 덮어 설치하고 사용자 설정은 남는다. Claude Desktop 에 등록한
경로는 설치 자리가 같으니 그대로 맞다(덮어 설치는 등록을 지우지 않는다). 설치 자리를 바꾸었다면 StCFSD 제목 표시줄이 「다른 설치를 가리킴」을
보이고, 「연결」을 다시 누르면 된다.

## 소유자가 손으로 볼 것(깨끗한 PC 또는 VM 에서)

- [ ] 설치 파일을 받아 실행 → SmartScreen 「추가 정보 → 실행」 → 권한을 묻지 않고 설치되어 StCFSD 가 뜬다(창이 처음 한 번 앞으로 나온다).
- [ ] 시작 메뉴 · 바탕 화면의 StCFSD 바로 가기, 설정 → 앱의 「StCFSD」.
- [ ] 탐색기에서 `.csd` 를 두 번 누르면 StCFSD 로 열린다. 떠 있을 때 다른 `.csd` 를 누르면 그 창이 앞으로 나와 **묻지 않고** 그 파일로 바뀐다(K2 전의 알려진 동작).
      막 실행한 직후(창이 뜨기 전)에 두 번째 `.csd` 를 누르면 그것도 차례로 열린다. 여러 파일을 한꺼번에 열면 첫 것만 열리고 풍선으로 알린다.
- [ ] Python 이 없는 PC 에서 좌굴 해석 · 퍼린 설계가 된다. 작업 관리자에 콘솔 창이 뜨지 않는다.
- [ ] 다른 프로그램에서 타이핑하는 동안 StCFSD 가 물음을 내면(예: Claude 로 저장을 시킨 뒤) 창이 앞으로 나오지 않고 작업 표시줄만 깜빡인다.
- [ ] 보기 › 밝은 테마 · 새로 고침 뒤에도 설계 탭에 넣은 값(예: Fy)이 그대로다.
- [ ] Claude Desktop 설치 → 제목 표시줄 「연결」 → Claude Desktop 재시작 → Claude 에서 StCFSD 도구가 보이고 get_status 가 답한다. 「끊기」로 지워진다.
- [ ] **Claude Desktop 을 띄운 채(StCFSD 도구를 한 번 부른 뒤) StCFSD 창을 닫고** 새 판으로 덮어 설치 → 묻지 않고 설치된다. Claude 에서 다시 부르면 새 판으로 답한다.
- [ ] **같은 상태에서 설정 → 앱 → 제거** → 「StCFSD이(가) 실행 중입니다」 물음이 뜰 수 있다(창을 닫았어도 — Claude Desktop 의 MCP 서버). 확인 → 제거된다.
      그 뒤 Claude Desktop 설정(`%APPDATA%\Claude\claude_desktop_config.json` 또는 MSIX 판의 같은 파일)에 `stcfsd` 가 **없고** 다른 서버는 그대로다.
      Claude Desktop 을 다시 시작하면 StCFSD 도구가 없고 오류도 없다. `%APPDATA%\StCFSD` 는 남아 있다.
- [ ] 「연결」하지 않은 채 제거해도 아무 오류 없이 끝난다.
- [ ] 한글 · 공백이 든 사용자 이름(경로)에서도 위가 된다.
- [ ] 새 판 설치 파일로 덮어 설치 → 설정 · 창 위치 · Claude 등록이 남는다.
- [ ] `%APPDATA%\StCFSD` 를 읽기 전용으로 만들거나 그 자리에 같은 이름의 파일을 두고 실행 → 폴더와 까닭을 적은 오류 상자가 뜬다(말없이 끝나지 않는다).
- [ ] 백신 · 사내 보안 프로그램이 `StCFSD.exe`(서명 없음)나 Python 을 막지 않는지, 제거 때의 `StCFSD.exe`(node 로 도는 제거 도우미)를 막지 않는지.
