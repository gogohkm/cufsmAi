# 2026-11-22 수정 묶음 2 — 경계층 (서버 · MCP · 호스트 · 화면)

작업문서: [`docs/implementation/20261122-desktop-program-worklog.md`](../../implementation/20261122-desktop-program-worklog.md) · 묶음 1 의 규칙: [`FIXES.md`](FIXES.md) — §2(무엇을 고치나) · §3(지켜야 할 규칙) · §5(기록)는 이 묶음에도 그대로다. 먼저 읽는다.

## 무엇을 하는 묶음인가

묶음 1 에서 파이썬 엔진 7영역을 고쳤다(`fixes/F1` – `F7`). 엔진은 이제 빠진 입력을 기본값으로 채우지 않고 오류나 「평가하지 못함」으로 답하고, 새 인자와 새 결과 키가 생겼다. 그런데 엔진을 부르는 쪽 — `python/server.py`, MCP 서버, 확장 호스트, 웹뷰 — 은 아직 옛 계약으로 부른다. 이 묶음은 **부르는 쪽을 고친 엔진에 맞추고**, 경계층 리뷰(R8)의 발견사항을 고친다.

할 일의 출처는 셋이다.

1. [`R8-boundary-layer.md`](R8-boundary-layer.md) — R8-01 – R8-31.
2. 묶음 1 기록의 「후속」 절 — [`fixes/F1-fsm-core.md`](fixes/F1-fsm-core.md) · [`F2-section.md`](fixes/F2-section.md) · [`F3-cfsm.md`](fixes/F3-cfsm.md) · [`F4-member-design.md`](fixes/F4-member-design.md) · [`F5-dsm-shear.md`](fixes/F5-dsm-shear.md) · [`F6-connections.md`](fixes/F6-connections.md) · [`F7-loads.md`](fixes/F7-loads.md). 각 기록에서 자기 파일에 해당하는 항목을 전부 찾는다.
3. 다른 리뷰 보고서가 경계층에 넘긴 것 — R2 – R7 보고서 끝의 "다른 리뷰어 영역에 걸친 것" 가운데 R8 · 서버 · MCP · 화면에 해당하는 항목.

## 하지 않는 것

독립 프로그램 구성안([`20261122-desktop-interface-proposal.md`](../../implementation/20261122-desktop-interface-proposal.md))의 일은 사용자 승인 뒤에 한다. 이 묶음에서는 하지 않는다.

- 설계 입력을 화면에서 호스트로 옮기기(K2), 검증 70항목 · 보고서를 호스트로 옮기기(K3)
- 포트 파일 · 토큰 방식의 MCP 연결, Claude Desktop 등록(K1). 다만 **R8-09 의 보안 결함은 지금 닫는다** — 토큰 없이 할 수 있는 만큼: CORS 허용 헤더를 없애고, `Content-Type: application/json` 이 아니거나 `Origin` 머리가 붙은 요청(브라우저가 보낸 것)을 거절한다. 지금의 MCP 클라이언트(`media/mcp-server.js`)는 그대로 통과해야 한다.
- `app.js` 나누기, 화면 다시 짜기. 필요한 입력 칸 · 표시만 지금 구조 안에 더한다.

## 파일 소유

| 담당 | 고칠 수 있는 파일 | 시험 |
|---|---|---|
| W1 | `python/server.py`, `python/__main__.py`, `python/fileio/` | `test/python/test_review_1122_server.py` (새로) |
| W2 | `src/mcp/` 전부, `scripts/mcp-source-hash.cjs`, `scripts/check-mcp-parity.cjs`, `media/mcp-server.js` · `.map`(다시 빌드), `README.md` 의 MCP 부분, `.gitattributes` | `test/webview/si_units_roundtrip.js`, `mcp_registration_contract.js`, `parity_contract.js` + 필요하면 새 `test/webview/*.js`(`package.json` 의 `test:webview` 에 잇는다) |
| W3 | `src/webview/` 전부, `src/extension.ts`, `src/bridge/`, `src/models/types.ts`, `webview/js/`, `webview/css/` | `test/webview/` 의 나머지 계약 시험, `test/vscode/` + 필요하면 새 `test/webview/*.js`(등록은 W2 에게 「후속」으로 넘기지 말고 `package.json` 의 `test:webview` 줄 끝에 직접 덧붙인다 — 그 한 줄만) |

- W1 이 먼저 끝난다. W2 · W3 은 W1 의 기록 `fixes/W1-server.md` 에서 RPC 의 새 인자 · 새 메서드를 읽는다.
- W2 와 W3 은 동시에 일한다. 둘이 만나는 곳은 MCP 도구의 인자 → `POST /action` → `StcfsdPanel.handleMcpAction` 이다. **인자 이름은 파이썬 함수의 인자 이름 그대로 쓴다**(묶음 1 기록에 적힌 이름). W3 이 `handleMcpAction` 과 허용 목록(`StcfsdPanel.ts` 의 allowlist)을 맡고, W2 가 도구 스키마 · 설명 · SI 변환을 맡는다. 서로의 파일을 고치지 않고, 상대가 받아야 할 것은 자기 기록의 「후속」에 적는다. 끝날 때 상대의 파일을 **읽어** 자기 쪽과 이름이 맞는지 확인한다.
- git 으로 작업 폴더나 인덱스를 바꾸지 않는다. 사용자의 미커밋 파일(`.mcp.json`, `Example/.mcp.json`, `Example/.claude/`, `.claude/`)을 건드리지 않는다 — 시험이 MCP 등록 코드를 돌릴 때 이 파일들을 다시 쓰지 않게 조심한다(R8-22).

## 지킬 것 (묶음 1 의 규칙에 더해)

1. **판정 표시.** 엔진의 `pass` 는 True / False / None 이다. None 은 「판정 없음(미검토)」이다 — 화면 · 보고서 · MCP 응답 · 트리 요약 어디에서도 OK 나 합격으로 보이면 안 된다. 불합격이 하나라도 있으면 미검토가 섞여 있어도 NG 다.
2. **경고와 미평가 목록을 버리지 않는다.** 엔진의 `warnings` · `not_evaluated`(또는 그에 해당하는 키) · `diagnostics` 는 MCP 응답과 화면에 그대로 간다.
3. **빠진 입력을 경계층이 대신 지어내지 않는다.** `D || 1`, `Fuf: 120`, `fy` 35.53 같은 채우기를 없앤다. 입력이 없으면 엔진의 오류 문장이 사용자에게 간다.
4. **같은 계산은 한 길로.** 화면 경로와 MCP 경로가 같은 입력에 같은 답을 내야 한다(R8-08). 한쪽에만 있는 조립 로직은 호스트의 한 함수로 모으고 양쪽이 그것을 부른다.
5. **단위.** 내부는 US. SI 는 입력을 바꾸면 출력도 — 중첩된 결과, 한계상태 표, 계산 단계의 수치까지 — 같은 규칙으로 바꾼다(R8-04). 바꾸지 못하는 글은 단위를 분명히 적는다. 왕복 오차로 값이 달라지지 않게 한다(R8-12).
6. 화면 · MCP 의 동작을 바꾸는 수정은 시험으로 고정한다. 웹뷰는 실제 브라우저로 띄워 볼 수 없으므로(확장 안에서만 돈다), 지금의 계약 시험 방식(소스를 읽어 확인하거나 순수 함수를 node 에서 부름)과 `STCFSD_TEST_MODE` 의 패널 시험 훅을 쓴다.

## 게이트 (끝낼 때 전부)

```
C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe test\python\run_all.py
C:\Coding_Works\cufsmAi\.venv\Scripts\ruff.exe check python test
npx tsc -p ./ --noEmit
npx eslint src webview/js test/webview
npm run test:webview
npm run build:mcp   &&   npm run check:mcp-parity        (W2)
node --check webview/js/app.js                            (W3)
```

## 기록

`fixes/W<n>-<영역>.md`, `FIXES.md` §5 의 형식. 발견사항별 표에는 R8 번호와, 묶음 1 기록에서 가져온 후속 항목(출처 `F4 후속` 처럼)을 함께 적는다.
