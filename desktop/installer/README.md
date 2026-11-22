# installer — Windows 설치 파일 · 함께 묶는 Python (S5)

2026-11-22 · 첫 배포판의 마지막 단계. 결과는 `build/dist/StCFSD-Setup-<판>-x64.exe` 하나 — 사용자 단위(관리자 권한 없음) NSIS 설치 파일.
출력은 모두 `build/`(git 이 무시한다 · 약 0.8 GiB) — 커밋하지 않는다.

## 만들기

저장소 루트에서(먼저 `cd desktop/shell && npm install` — Electron 45.2.3 · electron-builder 26.18.0):

```
node desktop/installer/build.mjs --all          # = 아래 셋을 차례로
node desktop/installer/stage.mjs                # 1. 빌드를 다시 돌리고(확장 호스트는 빈 폴더에 새로) 실을 파일을 모은다 → build/stage/
node desktop/installer/python.mjs               # 2. Python + numpy · scipy 묶음 → build/python-win-x64/ (받은 파일은 build/downloads/ 에 캐시)
node desktop/installer/build.mjs --win          # 3. electron-builder → build/dist/ (설치 파일 + win-unpacked/)
node desktop/installer/build.mjs --win --dir    #    풀린 폴더만
node desktop/installer/test/packaged.mjs        # 확인(설치하지 않는다 — 아래)
```

`npm run installer` · `npm run test:packaged`(desktop/ 에서)도 같다. 처음 한 번은 python.org · PyPI 에서 약 40 MiB 를 받는다.
electron-builder 는 NSIS(3.0.4.1)를 자기 캐시(`%LOCALAPPDATA%\electron-builder\Cache`)에서 쓴다 — 없으면 npm/GitHub 의 electron-builder-binaries 에서 받는다.

## 들어 있는 것 · 크기

| | 크기 |
|---|---|
| 설치 파일 `StCFSD-Setup-0.1.1-x64.exe` | **147.2 MiB** (7z 압축) |
| 설치 뒤(= `win-unpacked/`) | **454.7 MiB** |
| ├ Electron 45.2.3(`StCFSD.exe` 239 MiB · DLL · 한국어 · 영어 언어 묶음만) | 309.1 MiB |
| ├ `resources/python/` — CPython 3.13.14 + numpy 2.4.4 + scipy 1.17.1 | 141.8 MiB (scipy 72 · numpy.libs 21 · scipy.libs 20 · numpy 13 · Python 20) |
| ├ `resources/app-root/` — 확장 호스트(`out/`) · 엔진(`python/`) · `webview/` · `media/`(mcp-server.js) | 3.4 MiB |
| └ `resources/app/` — 껍데기(main · preload) · 호스트 묶음 · 틀 | 0.2 MiB |

`resources/` 배치는 `desktop/shell/src/layout.ts` 의 `installed` 와 같아야 한다(바꾸면 둘을 같이). 실은 파일 · 크기 · sha256 은
`build/stage/manifest.json`, Python 쪽은 `build/python-win-x64/STCFSD_PYTHON.json` 에 남는다. 그 밖에 electron-builder 가 스스로 두는 것은
`resources/elevate.exe`(NSIS 틀 — 사용자 단위 설치에선 쓰지 않음)와 `resources/default_app.asar`(Electron 기본 앱 — 읽히지 않음)뿐이다.

넣지 않는 것: 저장소의 `node_modules` · `src/`(TS 원본) · `docs` · `Example` · `test` · `.venv` · `*.map` · `__pycache__` · 엔진의 시험 파일.

## 고정한 판

| | 판 | 출처 · 확인 |
|---|---|---|
| Electron | 45.2.3 | `desktop/shell/package.json`(정확한 판) — `electronDist` 로 이미 받은 것을 쓴다 |
| electron-builder | 26.18.0 | 같은 곳(개발 의존성). `npm audit` 이 그 의존성에서 moderate 6건을 보고한다 — 빌드할 때만 쓰고 설치본에는 들어가지 않는다 |
| CPython | 3.13.14 embeddable amd64 | python.org · python.exe 의 Authenticode 서명(Python Software Foundation) 확인 · sha256 기록 |
| numpy | 2.4.4 (cp313 win_amd64 휠) | PyPI · PyPI 가 알려 준 sha256 과 맞춰 봄 |
| scipy | 1.17.1 (cp313 win_amd64 휠) | 같음. 의존성은 numpy 하나 |

판은 저장소의 `.venv`(개발에 쓰는 것)와 같다. 바꾸려면 `python.mjs` 의 `PINS` 만 고친다.

**Python 이 어떻게 자기 것만 쓰나.** embeddable 배포판의 `python313._pth` 가 sys.path 를 정한다:
`python313.zip` · `.` · `Lib\site-packages` · `..\app-root\python`(엔진 — ._pth 모드에선 스크립트 폴더가 sys.path 에 들어가지 않는다).
모두 상대 경로라 폴더째 어디로 옮겨도 된다. ._pth 가 있으면 PYTHONPATH · PYTHONHOME · 사용자 site-packages 를 보지 않는다.
껍데기는 `resources\python\python.exe` 를 `python.defaultInterpreterPath` 로 넘긴다(사용자 PC 의 Python 을 찾지 않는다).

**덜어 낸 것**(`python.mjs` 의 `TRIM`): numpy · scipy 의 자체 시험(`*/tests`), numpy C 헤더 · 정적 라이브러리 — 22.8 MiB · 48곳. 목록은
`STCFSD_PYTHON.json` 의 `removed` 와 `THIRD_PARTY_NOTICES.txt` 에. 라이선스 원문은 `resources/python/licenses/`(Python · numpy · scipy —
함께 묶인 OpenBLAS · libgfortran 등의 고지 포함).

## 설정에서 정한 것(`electron-builder.config.cjs`)

- **appId `local.stcfsd.desktop` — 절대 바꾸지 않는다.** Windows 의 AppUserModelID 이고 NSIS 가 이것으로 설치 GUID(제거 정보 키)를
  만든다. 바꾸면 새 판이 옛 판을 덮어 설치하지 못하고 둘이 따로 남는다. 꼴은 같은 사람의 StAnal(`local.stanal.desktop`)을 따랐다.
- 제품 이름 · 실행 파일 `StCFSD`, Windows x64, NSIS 한 번 누르기 · 사용자 단위(`%LOCALAPPDATA%\Programs\StCFSD`, 권한 올리기 없음), 한국어.
- 시작 메뉴 · 바탕 화면 바로 가기, 제거 프로그램(설정 → 앱에 「StCFSD」). 제거해도 `%APPDATA%\StCFSD`(설정 · 창 위치 · 로그)는 남긴다.
- `.csd` 파일 연결(StCFSD.Project) — 두 번 누르면 `StCFSD.exe "<파일>"`(이미 떠 있으면 그 창이 연다).
- **asar 를 쓰지 않는다.** Python(`python.exe` · `server.py`)과 Claude Desktop 이 띄우는 MCP 서버(`mcp-server.js`)는 디스크의 진짜 파일이어야
  해서 어차피 asar 밖이다. asar 에 넣을 수 있는 것은 0.2 MiB 의 껍데기뿐이라 얻는 것이 없고, 다리가 틀 파일을 `realpath` · 스트림으로
  내주므로 asar 의 fs 흉내에 기대지 않는 편이 안전하다. electron-builder 의 경고 「asar usage is disabled」는 이 이유로 무시한다.
- **Electron 퓨즈를 건드리지 않는다**(특히 RunAsNode 를 켜 둔다): Claude Desktop 은 `StCFSD.exe <resources>\app-root\media\mcp-server.js`
  + `ELECTRON_RUN_AS_NODE=1` 로 MCP 서버를 띄운다. 끄면 Claude 연결이 깨진다.
- **서명하지 않는다.** 인증서가 없다. 앱 아이콘도 아직 없다(`icons/icon.ico` 를 두면 실행 파일 · 설치 파일 · 파일 연결에 쓴다 — 지금은 Electron 기본 아이콘).

## SmartScreen

서명하지 않은 설치 파일이라 처음 받은 PC 에서 「Windows의 PC 보호」가 뜬다 → **추가 정보 → 실행**. 사내 배포라면 사내 공유 폴더 ·
메신저로 넘기고 이렇게 안내한다. 경고를 없애려면 코드 서명 인증서(OV/EV)로 `StCFSD.exe` 와 설치 파일을 서명해야 한다 —
설정의 `win` 에 인증서를 주면 electron-builder 가 서명한다(묶은 `python.exe` 는 이미 PSF 서명이 있다).

## 판 올리기 · 업데이트

판은 저장소 루트 `package.json` 의 `version` 이다(`stage.mjs` 가 앱 `package.json` 에 옮긴다 → 설치 파일 이름 · 제거 정보). 자동 업데이트는
없다(`publish: null`) — 새 설치 파일을 그냥 실행하면 같은 appId 라 제자리에 덮어 설치하고 사용자 설정은 남는다. Claude Desktop 에 등록한
경로는 설치 자리가 같으니 그대로 맞다(설치 자리를 바꾸었다면 StCFSD 제목 표시줄이 「다른 곳에 등록됨」을 보이고, 「연결」을 다시 누르면 된다).

## 확인 — `test/packaged.mjs` (설치하지 않는다)

이 PC 는 작업 PC 라 설치 파일을 돌리지 않는다(레지스트리 · 시작 메뉴 · 파일 연결을 쓰지 않음). 대신

1. `win-unpacked` 를 공백 · 한글 경로(`%TEMP%\stcfsd-s5-*\시험 폴더 (공백)\StCFSD`)로 복사, PATH 에서 Python 을 모두 빼고 PYTHON* 를 지운 채
   `StCFSD.exe` 를 **보이지 않게** 띄운다(시험 모드 — 창은 show:false, show · focus 없음. 사용자 폴더 · 문서 폴더 · Claude 설정은 임시 · 가짜).
2. 처음 화면의 기본 단면 H 100 mm(1e-9) · 강재 SGC400 295 / 400 MPa(낡은 빌드를 싣지 않았는지), 엔진 python.exe 가 복사본 안의 것인지(프로세스 표),
   Python 자식에 콘솔 창이 없는지(창 핸들 0).
3. 명령줄의 `.csd` 로 시작 → **설치본의 `StCFSD.exe` + `ELECTRON_RUN_AS_NODE=1`** 로 MCP 서버(도구 59개 · get_status) → 좌굴 해석 → 하중 해석 →
   퍼린 설계 → 메뉴 저장 → 메뉴 열기(절점이 같다). 「연결」이 가짜 Claude 설정에 쓰는 항목이 모두 복사본 안의 경로인지.
4. 깨끗한 끝내기(코드 0 · 자식 0 · 포트 · 포트 파일 정리), 설치 파일을 Bandizip 콘솔(`bz.exe`)로 들여다봐 안의 `app-64.7z` 목록 = 묶음 목록 + Python
   = `win-unpacked`, 진짜 Claude · MCP 설정 · `%APPDATA%\StCFSD` · 설치 자리 · 바로 가기 · 저장소(desktop/ 밖)가 그대로.

결과 32/32 · 약 60 s. 그림은 `test/out/`.

## 소유자가 손으로 볼 것(깨끗한 PC 또는 VM 에서)

- [ ] 설치 파일을 받아 실행 → SmartScreen 「추가 정보 → 실행」 → 권한을 묻지 않고 설치되어 StCFSD 가 뜬다.
- [ ] 시작 메뉴 · 바탕 화면의 StCFSD 바로 가기, 설정 → 앱의 「StCFSD」(제거 가능).
- [ ] 탐색기에서 `.csd` 를 두 번 누르면 StCFSD 로 열린다(떠 있으면 그 창에서). 아이콘은 아직 Electron 기본.
- [ ] Python 이 없는 PC 에서 좌굴 해석 · 퍼린 설계가 된다. 작업 관리자에 콘솔 창이 뜨지 않는다.
- [ ] Claude Desktop 설치 → 제목 표시줄 「연결」 → Claude Desktop 재시작 → Claude 에서 StCFSD 도구가 보이고 get_status 가 답한다. 「끊기」로 지워진다.
- [ ] 한글 · 공백이 든 사용자 이름(경로)에서도 위가 된다.
- [ ] 새 판 설치 파일로 덮어 설치 → 설정 · 창 위치가 남는다. 제거 → 프로그램 폴더가 지워지고 `%APPDATA%\StCFSD` 는 남는다.
- [ ] 백신 · 사내 보안 프로그램이 `StCFSD.exe`(서명 없음)나 Python 을 막지 않는지.
