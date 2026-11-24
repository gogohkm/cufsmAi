# desktop/ — StCFSD 독립 프로그램

2026-11-23 · 상태: **S5 끝(첫 배포판 준비) · U1 끝(새 검토 화면의 틀) · U2 끝(보기) · U3 끝(계산 시트 · 메뉴 · 찾기 · AI 따라가기 · 3D) · U4 끝(편집 상태 · 새 화면이 기본 · K2 따라가기) · U5 끝(호스트가 만든 점검 · 계산서 — K3) · 독립 검증 V5 의 desktop 몫 고침** — 화면 템플릿(`design/`), 화면 없는 호스트(S1), 화면 다리(S2), 독립 창(S3 — Electron), Claude Desktop 연결(S4), Windows 설치 파일 + 함께 묶은 Python(S5), 새 검토 화면(U1 틀 · U2 보기 — `ui/`, `--ui` 로만 연다)이 있다. 기본 화면은 아직 틀(`/`)이다 — U4 에서 바꾼다. **기본 화면은 새 검토 화면이다(U4).** 예전의 틀(제목 표시줄 + 설계 화면 탭 6개)은 한 판 동안 스위치로 연다 — 창 `StCFSD.exe --ui classic`(개발판 `cd shell && npm run start:classic`), 브라우저 길 `npm run serve:classic`(= `serve --ui classic`).

Windows 용 독립 프로그램을 만드는 자리다. 직원은 모니터 하나에 StCFSD, 다른 모니터에 Claude Desktop 을 띄우고, 대화는 Claude Desktop 에서만 한다. 둘은 로컬 MCP 서버로 잇는다.

- 구성안: [`docs/implementation/20261122-desktop-interface-proposal.md`](../docs/implementation/20261122-desktop-interface-proposal.md)
- 진행: [`docs/implementation/20261122-desktop-program-worklog.md`](../docs/implementation/20261122-desktop-program-worklog.md)
- 같은 방식으로 먼저 한 프로젝트: StAnal 의 `desktop/`

지금의 VS Code 확장은 그대로 둔다. 이 디렉토리의 작업은 확장을 깨지 않는다.

## 지금 있는 것

| 경로 | 내용 | 단계 |
|---|---|---|
| `design/` | 화면 템플릿(정적 HTML). `design/index.html` 을 브라우저로 연다. 설명은 `design/README.md` | T1 |
| `host/` | 지금의 확장 호스트(`out/extension.js`)를 고치지 않고 VS Code 없이 Node 에서 돌린다. `vscode` 대체 모듈(`host/src/vscode/`), 적재기(`loader.ts` — 포트 파일 방식의 MCP, 설계 패널을 끝까지 쥔다), 사용자 · OS 에 묻는 접점(`platform.ts`), 화면 없는 CLI(`headless.ts`), 연기 시험. [`host/README.md`](host/README.md) | S1 |
| `host/src/bridge/` · `host/frame/` | 화면 다리(+ S4 의 「연결」 · 「끊기」 — `POST /api/claude/*`, 화면의 세션만): 127.0.0.1 + 토큰의 HTTP 로 지금의 웹뷰를 고치지 않고 브라우저에 내준다(리소스 주소 · CSP · `acquireVsCodeApi` 대체 · 테마 변수), 호스트 ↔ 웹뷰 메시지와 새로 고침 다시 보내기, 호스트의 물음(알림 · 고르기 · 열기/저장), MCP 중계, Claude 상태(읽기만). 틀(`/`)은 제목 표시줄 + 설계 화면. CLI `serve.ts`, 시험 `test/bridge.mjs`(headless Edge). [`host/BRIDGE.md`](host/BRIDGE.md) | S2 |
| `shell/` | 독립 창(Electron 45, 자체 `package.json`): 한 프로세스에 호스트 · 다리 · 창, 메모리 세션 + Bearer, 단일 인스턴스(두 번째 실행은 파일을 넘김), 창 자리 기억, 포커스를 가져가지 않기(물음은 제목 · 작업 표시줄로), OS 열기 · 저장 대화상자, 메뉴, 파일 연결 진입점, 자식 콘솔 숨김, 제목 표시줄의 Claude 연결. [`shell/README.md`](shell/README.md) | S3 · S4 |
| `ui/` | **새 검토 화면(U1)** — 템플릿 00 · 01 · 04 를 실제 데이터로: 제목 표시줄(진행 띠 · Claude 연결), 트리 탭 4개, 축척대로 그린 단면 + 절점 · 요소 표, 판정비 표, 정보 창(값 · 단위 · 출처 꼬리표 · 경고 / 가정 / 범위), 시작 화면, 풍선 도움말. 값은 다리의 MCP 중계(AI 와 같은 도구)와 호스트 → 웹뷰 메시지에서 읽고, AI 가 바꾸면 새로 고침 없이 따라간다. 지금의 설계 화면은 늘 끼워 두고 F2 로 연다. 보기(U2): 단면 치수선 · 주축 · 전단 중심 · 응력, 좌굴 곡선 · 엔진의 극소 · 분류 띠 · 2D 모드 형상(3D 는 꺼진 칩 — 다리가 줘야 할 것), 부재 M · V · 처짐 · 반력 · 판정비 띠, 랩 접합 도면, 표 서랍. `serve --ui` · 창 `--ui` 로만 연다. [`ui/README.md`](ui/README.md) | U1 · U2 |
| `installer/` | Windows 설치 파일(NSIS · 사용자 단위 · 서명 없음, appId `local.stcfsd.desktop`)과 함께 묶은 Python 3.13.14 + numpy 2.4.4 + scipy 1.17.1(python.org · PyPI — 주소 · sha256 을 저장소에 고정, 받은 것 · 캐시 모두 맞춰 봄, zip 안의 실행 파일 · DLL 30개 서명 확인 — V5-14). 묶음 준비(`stage.mjs` — 빌드를 다시 돌린다), Python(`python.mjs`), 묶기(`build.mjs`), 설치하지 않고 확인(`test/packaged.mjs`). 출력은 `installer/build/`(git 무시). [`installer/README.md`](installer/README.md) | S5 |

```
npx tsc -p ./                                  # 저장소 루트 — out/ 을 만든다
cd desktop && npm install && npm test          # 형 검사 → 빌드(호스트 · 새 화면) → 연기 시험 → 다리 시험(진짜 Python, headless Edge) → Claude 연결 시험 → 새 화면 시험
npm run serve -- --open <파일.csd>              # 화면 다리. 출력된 「화면:」 주소를 브라우저로 연다
npm run serve:classic -- --open <파일.csd>      # 같은 다리, 예전의 틀(/) — 한 판 동안(U4 부터 serve 의 기본은 새 검토 화면)
npm run test:ui                                # 새 검토 화면 시험(진짜 호스트 · Python · MCP 클라이언트, headless Edge)
npm run headless -- --open <파일.csd>           # 화면 없이. MCP 다리 주소와 클라이언트가 쓸 환경을 출력하고 떠 있다
cd shell && npm install && npm start -- <파일.csd>   # 창(Electron) — 새 검토 화면. npm start -- --ui classic <파일.csd> 면 예전의 틀
npm test                                       # 창 시험 — 창을 보이지 않고 돈다
cd .. && npm run installer                     # 설치 파일 → installer/build/dist/ (처음엔 Python · 휠을 받는다)
npm run test:packaged                          # 설치본 확인(설치하지 않는다)
```

`desktop/` 은 자체 `package.json`(typescript · esbuild · @types/node)을 둔다. 루트의 의존성에 섞이지 않는다. 루트 `tsconfig.json` 은 `desktop` 을 `exclude` 한다 — 루트의 `tsc` 는 여기 소스를 보지 않고, 여기 소스는 `desktop/tsconfig.json` 으로 따로 형 검사한다.

**브라우저 모드(`npm run serve`)는 개발 · 시험 길이다.** 같은 브라우저로 127.0.0.1 의 다른 포트를 열면 그 서버도 읽기 쿠키를 받아 모델 · 상태 · 이벤트를 **읽을 수 있다**(쓰기 · 열쇠 · 웹뷰 통로는 못 한다) — 알려진 한계로 두었다(`host/BRIDGE.md` 1절). 사용자가 쓰는 StCFSD 창(Electron)은 쿠키를 쓰지 않아 해당하지 않는다. serve 는 시작할 때 이것을 한 줄로 알린다.

## 만들 것

| 경로 | 내용 |
|---|---|
| `ui/` 의 나머지 | 기록(R1–R5 — 확인 표시 · 변경 · 대안 · 이번 편집 버리기 · 발행), K3-6 – 8(점검 규칙 고치기 · 보고서 계산 절을 design_checks 에서 · 단위 분리) |

## 규칙 — 디렉토리는 나누되 계산은 한 벌

1. **이 디렉토리에 두는 것은 껍데기와 화면뿐이다.** 엔진(`python/`), 설계 로직, MCP 도구(`src/mcp/`)는 복사해 오지 않는다. 복사하면 같은 단면이 확장과 독립 프로그램에서 다른 값을 낼 수 있다.
2. **의존은 한 방향이다.** `desktop/` 이 저장소의 나머지를 쓴다. 확장(`src/`, `webview/`)은 `desktop/` 을 쓰지 않는다.
3. **확장 호스트는 떼어 내지 않고 그대로 돌린다.** 독립 프로그램만을 위한 갈래를 `src/` 에 만들지 않는다. 독립 프로그램에 필요해서 `src/` · `webview/` 를 고치는 것(MCP 연결, 상태를 호스트로, 검증 · 보고서)은 확장에도 똑같이 들어가는 공용 코드로 넣는다.
4. **확장의 화면(`webview/`)은 동작을 바꾸지 않는다.** 독립 프로그램의 화면은 `desktop/ui/` 에 새로 짓는다.
5. **확장 배포물에 들어가지 않는다.** `.vscodeignore` 에서 `desktop/` 을 뺀다.
6. **지금의 시험을 계속 돌린다.** 단계마다 파이썬 전체, 웹뷰 계약, `tsc`, `eslint`, MCP 패리티를 돌려 확장이 그대로인지 본다.
