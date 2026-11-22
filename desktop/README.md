# desktop/ — StCFSD 독립 프로그램

2026-11-22 · 상태: **S4 끝** — 화면 템플릿(`design/`), 화면 없는 호스트(S1), 화면 다리(S2), 독립 창(S3 — Electron), Claude Desktop 연결(S4)이 있다. 다음은 `installer/`(S5) — 그 뒤 첫 배포판, 그리고 `ui/`.

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

```
npx tsc -p ./                                  # 저장소 루트 — out/ 을 만든다
cd desktop && npm install && npm test          # 형 검사 → 빌드 → 연기 시험 → 다리 시험(진짜 Python, headless Edge) → Claude 연결 시험
npm run serve -- --open <파일.csd>              # 화면 다리. 출력된 「화면:」 주소를 브라우저로 연다
npm run headless -- --open <파일.csd>           # 화면 없이. MCP 다리 주소와 클라이언트가 쓸 환경을 출력하고 떠 있다
cd shell && npm install && npm start -- <파일.csd>   # 창(Electron)
npm test                                       # 창 시험 — 창을 보이지 않고 돈다
```

`desktop/` 은 자체 `package.json`(typescript · esbuild · @types/node)을 둔다. 루트의 의존성에 섞이지 않는다. 루트 `tsconfig.json` 은 `desktop` 을 `exclude` 한다 — 루트의 `tsc` 는 여기 소스를 보지 않고, 여기 소스는 `desktop/tsconfig.json` 으로 따로 형 검사한다.

## 만들 것

| 경로 | 내용 |
|---|---|
| `ui/` | 새 화면: 트리 탭 4개(업무 · 모델 · 결과 · 문서), 보기(단면 · 좌굴 곡선 · 부재 · 접합 도면), 정보 창, 표 서랍. 지금의 웹뷰는 편집 상태(F2)에서 `<iframe>` 으로 끼운다 |
| `installer/` | Windows 설치 파일(NSIS), Python 묶음 |

## 규칙 — 디렉토리는 나누되 계산은 한 벌

1. **이 디렉토리에 두는 것은 껍데기와 화면뿐이다.** 엔진(`python/`), 설계 로직, MCP 도구(`src/mcp/`)는 복사해 오지 않는다. 복사하면 같은 단면이 확장과 독립 프로그램에서 다른 값을 낼 수 있다.
2. **의존은 한 방향이다.** `desktop/` 이 저장소의 나머지를 쓴다. 확장(`src/`, `webview/`)은 `desktop/` 을 쓰지 않는다.
3. **확장 호스트는 떼어 내지 않고 그대로 돌린다.** 독립 프로그램만을 위한 갈래를 `src/` 에 만들지 않는다. 독립 프로그램에 필요해서 `src/` · `webview/` 를 고치는 것(MCP 연결, 상태를 호스트로, 검증 · 보고서)은 확장에도 똑같이 들어가는 공용 코드로 넣는다.
4. **확장의 화면(`webview/`)은 동작을 바꾸지 않는다.** 독립 프로그램의 화면은 `desktop/ui/` 에 새로 짓는다.
5. **확장 배포물에 들어가지 않는다.** `.vscodeignore` 에서 `desktop/` 을 뺀다.
6. **지금의 시험을 계속 돌린다.** 단계마다 파이썬 전체, 웹뷰 계약, `tsc`, `eslint`, MCP 패리티를 돌려 확장이 그대로인지 본다.
