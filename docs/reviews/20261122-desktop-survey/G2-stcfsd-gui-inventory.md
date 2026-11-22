# G2. StCFSD 현행 GUI·호스트 기능 인벤토리 (데스크톱 전환 사전조사)

- 작성일: 2026-11-22 / 대상 커밋: `6540354` (master, 2026-09-28)
- 범위: VS Code 확장 StCFSD의 웹뷰 GUI·확장 호스트·MCP 서버. **읽기 전용 조사**이며 코드 변경은 없다.
- 정독한 파일: `src/extension.ts`(536행), `src/webview/StcfsdPanel.ts`(3640), `src/webview/ProjectExplorerProvider.ts`(372), `src/webview/viewer3d/*.ts`, `src/bridge/*.ts`, `src/models/types.ts`, `src/mcp/*.ts`(server.ts 1344), `webview/js/app.js`(7043), `designState.js`(386), `utils.js`(46), `charts/modeShape3D.js`(197), `webview/css/theme.css`(877), `package.json`, webpack·tsconfig, `.vscodeignore`, `scripts/*.cjs`, `test/webview/*.js`, `test/vscode/**`, `python/server.py`(386, 메서드 목록). 문서는 `0926코드개선방안.md`, `설계탭수정필요.md`, `Example/인터페이스개선안.md`, `작업내용01.md`, `작업내용02.md`, `프로젝트개요.md`, `README.md`.
- 표기: `P:n` = `src/webview/StcfsdPanel.ts` n행, `app:n` = `webview/js/app.js` n행, `ext:n` = `src/extension.ts`, `srv:n` = `src/mcp/server.ts`, `br:n` = `src/mcp/bridge.ts`, `PE:n` = `ProjectExplorerProvider.ts`, `DS:n` = `designState.js`.
- 본문(§0–§9)은 종합이다. 파일별 세부 대장(입력 id 전체, 함수 목록 전체, MCP 액션별 표 등)은 **부록 A–E**에 그대로 실었다. 본문과 부록이 다르면 본문이 우선이다(교차 확인을 거쳐 보정했다).

---

## 0. 한눈에 보기

```
┌───────────────────── VS Code 확장 호스트 (Node) ─────────────────────┐
│ extension.ts ── 명령 8개, 트리뷰, Python 기동, MCP HTTP 브리지 기동    │
│ StcfsdPanel (싱글턴) ── _model·결과 캐시 보유 = "단일 진실원"          │
│   ├ _handleMessage (웹뷰 메시지 23종)                                  │
│   ├ handleMcpAction (MCP 액션 60여 종, 1468행 switch)                  │
│   └ _getHtmlForWebview (HTML 778행 템플릿)                             │
│ McpBridgeServer  127.0.0.1:52790~ (GET /status, POST /action)          │
│ PythonBridge ── stdin/stdout 줄단위 JSON-RPC ── python/server.py(무상태)│
└───────────────▲──────────────────────────────▲────────────────────────┘
     postMessage│{command,data}                 │HTTP (무인증)
┌───────────────┴─────────────┐   ┌─────────────┴──────────────┐
│ 웹뷰: app.js 단일 IIFE        │   │ media/mcp-server.js (stdio) │
│ 입력값은 DOM에만, 결과는 클로저 │   │ 도구 59개, 계산 없음         │
└─────────────────────────────┘   └─────────────▲──────────────┘
                                                 │stdio MCP
                                         Claude Code / (Desktop 미등록)
```

- 탭 6개: **① 단면·재료 → ② 하중계산 → ③ 좌굴해석·부재설계(A 해석 / B 결과 / C 부재설계) → ④ 접합부 → 보고서 → 검증**. 부가로 좌굴해석 보고서 별도 패널과 사이드바 트리가 있다.
- UI 언어는 **한국어 위주에 영어를 병기**한다(예 "단면 입력 (Section Input)", `<html lang="ko">` P:2733). 파일 버튼(Open/Save)과 일부 결과 표 라벨, 호스트 오류 메시지는 영어다.
- 단위: 내부는 **항상 US**(in, ksi, kip, kip-in)이고, 화면 기본은 **SI**(`_unitSystem='SI'` app:36)다. 변환은 입력·표시 층에서만 한다.

---

## 1. 화면별 기능 인벤토리

### 1.0 공통 골격

| 요소 | 위치 | 내용 |
|---|---|---|
| 탭 바 | P:2749-2761 | `.tab-btn[data-tab]` 6개, 구분선 2개, 오른쪽에 `btn-file-open` "Open", `btn-file-save` "Save". `switchTab()`(app:415-422)은 클래스만 토글하며 **선행조건 게이트가 없다**. P:2748의 주석은 예전 3그룹 구조를 설명하고 있어 현재 코드와 맞지 않는다. |
| 상태줄 | `#analysis-status`, `setStatus()` app:3134 | running/success/warn/error 클래스 |
| 단위 토글 | ① 탭 상단 `btn-unit-US`/`btn-unit-SI` (P:2769) | §1.8 |
| 레이아웃 | theme.css | `body{height:100vh;overflow:hidden;display:flex}`, 탭마다 `.panel-left`/`.panel-right` 2열(min 300px). 좁은 폭에 대한 반응형 처리는 없다. |
| 접기 UI | `h3.collapsible`(app:3176), `.conn-collapsible`(app:856) | CSP 때문에 inline onclick 대신 리스너를 쓴다. |

### 1.1 ① 단면·재료 `tab-preprocessor` (P:2766-2866)

**목적**: 단면 형상(템플릿 또는 절점·요소)과 재료를 정의한다. 단면 성질도 여기서 표시한다. 재료의 단일 소스가 이 탭이다.

| 입력 | id | 단위 | 기본값 |
|---|---|---|---|
| 템플릿 | `select-template` | – | `lippedc`. 선택지 "직접 입력"(빈 값), lippedc, lippedz, track, hat, rhs, chs, angle, isect, tee, lipped_angle (10종) |
| 치수 | `tpl-H`, `tpl-B`, `tpl-D`, `tpl-t`, `tpl-r` | mm | 100, 50, 20, 2.3, 4 |
| 립 각도 | `tpl-qlip` (lippedc/lippedz/lipped_angle일 때만 표시, app:2170) | deg | 90 (0–180) |
| 강종 | `input-steel-grade` | – | SGC400. 선택지 Manual, SGC400/440/490/570, A653-33/50/80. JS `gradeMap`(app:3282)에는 SSC400, A653-55, A792-33/50/80, A1003-33/50도 있다(HTML에는 없음). |
| Fy, Fu | `input-fy`, `input-fu` | MPa | 245, 400 |
| E, ν, G | `input-E`, `input-v`, `input-G` | MPa, – | 203395, 0.3, 77911. G는 E·ν에서 자동 계산(`updateG` app:2394) |
| 냉간가공 | `chk-cold-work` (§A3.3.2) | – | checked |
| 절점 표 | `#node-table` (#, x, z, stress) | mm, MPa | 편집하면 `updateModel` + `getProperties` 전송(app:535-563) |
| 요소 표 | `#elem-table` (#, ni, nj, t) | mm | t만 편집 가능 |

- 버튼: `btn-generate-template` "단면 생성"(app:2204 → `generateTemplate`), `btn-add-node`, `btn-add-elem`. 뒤의 두 버튼은 **핸들러가 없는 죽은 버튼**이다(`webview/js` 전체에서 `add-node`/`add-elem` 0건). 절점 추가·삭제는 MCP에서만 할 수 있다.
- 출력:
  - 단면 미리보기 SVG `#section-svg`: 요소, 절점 번호, 도심 축, 주축과 θp (`renderSectionSVG` app:617, `renderSectionAxes` app:669).
  - 단면 성질 표 `#section-props`: A, Ixx, Izz, Ixz, Sx, Sz, Zx, Zz, rx, rz, xcg, zcg, θp, I11, I22 (`updatePropertiesTable` app:738).
- 동작: `modelLoaded`를 받거나 표를 편집할 때마다 `getProperties`를 자동 요청한다(app:495). 강종을 바꾸면 Fy/Fu/E/G가 세팅되고(app:3369-3381), `syncFyValue`/`syncFuValue`가 `design-fy`, `plastic-fy`, `conn-Fy`/`conn-Fu`로 값을 전파한다(app:3291-3303). Fu<Fy이면 invalid 표시(app:3342).

### 1.2 ② 하중계산 `tab-loads` (P:2869-3028)

**목적**: 퍼린·장선·거트·스터드의 연속보 하중을 분석한다(ASCE 7 조합). 그 결과로 소요강도와 비지지 길이를 결정한다. **부재 유형 선택이 이 탭에 있고, 이 선택이 ③ 설계 탭의 모드까지 바꾼다.**

| 그룹 | 입력 id | 단위 | 기본값 |
|---|---|---|---|
| 부재 유형 | `select-member-type` | – | `roof-purlin`. [자동계산] roof-purlin, floor-joist, wall-girt, wall-stud / [직접입력] flexure, compression, combined, tension. 현재 모드는 배지 `member-mode-badge`로 표시 |
| 부재 구성 | `select-span-type`(simple, cantilever, cont-2, **cont-3**, cont-4, cont-n), `config-n-spans`(cont-n일 때, 2–20), `config-spacing` | –, –, m | cont-3, 5, 1.0 |
| 스팬 표 | `#span-config-tbody` (`buildSpanTable` app:3433): 지점별 `.span-tbl-sup`(P/R/F/N), `.span-tbl-len`, `.span-tbl-lapl`, `.span-tbl-lapr` | m | 스팬 5, 랩 0 |
| 데크·가새 | `select-deck-type`(through-fastened/standing-seam/**none**), `deck-t-panel`, `deck-fastener-spacing`, `deck-kphi-override`, `deck-kx-override` | mm, mm, kN-m/rad/m, kN/m/m | none, 0.5, 300, 빈칸(auto), 빈칸(auto) |
| 사용하중(면압) | `load-D-psf`, `load-Lr-psf`, `load-S-psf`, `load-Wu-psf`(양력↑), `load-Wp-psf`(정압↓), `load-L-psf`(floor-joist만) | kPa (id는 psf지만 SI 표시) | 0.3, 1.0, 0.5, 1.0, 0, 0 |
| 선하중 표시 | `load-*-plf` (`updatePLF` app:3400, 면압×간격) | kN/m | 실시간 계산 |
| **소요강도** (항상 표시) | `design-P`, `design-V`, `design-Mx-pos`, `design-Mx`, `design-My`, `design-May-strength` | kN, kN-m | 0. **id 접두사는 design-인데 위치는 ② 탭**이다. 인장 Tu도 `design-P`를 같이 쓴다. |

- 버튼: `btn-analyze-loads` "하중 분석 실행"(app:3784 → `analyzeLoads`). 자동계산 모드가 아니면 아무 동작도 하지 않는다.
- payload(app:3784-3901): member_app, span_type, span_ft, spans_ft[], supports[], laps_per_support[], spacing_ft, loads{D,Lr,S,W(=−Wu·s),Wp,L} plf, design_method, deck{…}, section{depth, flange_width, thickness, lip_depth, R_corner, type, Fy, Fu, **Ixx=lastProps.Ixx**}.
  - section.type은 `select-template` 문자열에서 추정한다(app:3800).
  - Ixx가 없으면 처짐을 계산하지 않는다.
- 출력 `renderLoadAnalysisResult` app:4163-4566 (404행) → `#load-analysis-result`:
  - 보 개략도 SVG (`renderBeamSchematic` app:3906)
  - 모멘트도와 전단력도 SVG: 변곡점–지점 사이 Ly 치수선, Lap end 주석 포함 (`renderDiagramSVG` app:4018)
  - 지배조합 표(Location/Mu/Vu/Ru), 중력·양력 표, ASCE 7 하중조합 상세 표(조합식은 JS에서 문자열로 조립)
  - 처짐도와 스팬별 L/δ 표
  - Auto Parameters 박스(kφ, kx, Ly, Cb, R)
- **자동 채움**(하중 → 다른 탭, app:4404-4529, 4568-4612):
  - ② `design-Mx`: 부모멘트 |Mu|×12, 랩이 있으면 Lap end 값. `design-Mx-pos`, `design-V`도 채운다.
  - ③ `design-Lb`/`design-Cb`(+ 근거 `design-Lb-calc`/`design-Cb-calc`), `design-Lb-pos`/`design-Cb-pos`, β(`chk-beta-dist`, M1/M2, Lm), 양력 지배 시 R(`chk-r-factor`, `select-r-value`).
  - ④ `conn-lap-left/right`(최대 랩), `conn-Mu`(`StcfsdDesignState.selectLapGoverningMoment`×12, 근거는 title에), `conn-Vu`.
- 이동 버튼:
  - `btn-goto-design` "→ ③…": 탭만 전환한다.
  - `btn-goto-lap-design` "→ ④…": 탭을 전환하고 `btn-run-lap-design.click()`으로 **실행까지 자동으로** 한다.
- 결과 무효화: `#tab-loads`의 change 이벤트가 `invalidateDerivedResults('load')`를 호출한다(app:7019-7026). 자동 채움은 `setValueAndNotify`가 input 이벤트만 일으키므로 무효화를 유발하지 않는다.

### 1.3 ③ 좌굴해석·부재설계 `tab-design` (P:3031-3384)

상단에는 스텝 표시기 `design-step-indicator`(1 입력 → 2 하중 분석 → 3 설계 검토, 표시만 하고 클릭은 안 됨, `setDesignStep` app:3189)와 FSM 연동 상태 스트립 `design-dsm-status`(`updateDesignDsmStatus` app:3306)가 있다.

**A. 좌굴해석(FSM)** `sec-fsm` (기본 펼침)

| 입력 | id | 단위 | 기본값 |
|---|---|---|---|
| 하중 케이스 | `select-load-case` | – | compression. 선택지 bending_xx_pos/neg, bending_zz_pos/neg, custom |
| custom 하중 | `input-load-P`, `input-load-Mxx`, `input-load-Mzz` (custom일 때 표시) | kN, kN-m | 0 |
| Fy 표시 | `analysis-fy-display` (읽기 전용) | MPa | 245 |
| 경계조건 | `select-bc` | – | S-S. 선택지 C-C, S-C, C-F, C-G |
| 반파장 | `input-len-min`, `input-len-max`, `input-len-n` | mm, – | 10, 10000, 60. 호스트 초기 모델은 1–1000 in 50점이라 UI와 다르다(P:186). |
| 고유치 수 | `input-neigs` | – | 10 (MCP는 1–50, DOF 상한 검증 P:1127) |
| cFSM | `chk-cfsm-enable`, `chk-cfsm-G/D/L/O` | – | 모두 checked |

- 버튼:
  - `btn-run-analysis` "해석 실행"(app:2410-2465): JS가 logspace 길이, `m_all`, `prop`, `stressOpts` 매핑을 만들어 **모델 전체를 `runAnalysis`로 보낸다**.
  - `btn-view-buckling-report` "좌굴해석 결과 보고서"(§1.7).
- 출력: 응력 분포 프리뷰 SVG `#stress-preview-svg`(`renderStressPreview` app:2216, **JS가 간이 응력을 계산**하며 bbox 중앙 기준 선형분포)와 상태줄.
- 해석이 끝나면(`analysisComplete`, app:246-266) B 섹션을 펼치고, 곡선·셀렉트·2D·3D를 렌더하고, `switchTab('design')`을 호출한 뒤 **`_autoPrepareDesignDsm()`**(app:426)가 `prepareDesignDsm`을 자동으로 보낸다. 호스트는 부재 유형에 필요한 하중 family(P/Mxx)별로 임시 FSM을 돌려 DSM을 준비한다(P:1216-1274). 결과는 `designDsmPrepared`로 돌아와 "설계 검토 실행 가능"으로 표시된다.

**B. 좌굴해석 결과** `sec-fsm-res` (기본 접힘)

| 출력 | id | 렌더러 |
|---|---|---|
| DSM 설계값 표 (Py/Pcrl/Pcrd/Pcre, My/Mcrl/Mcrd/Mcre, 약축; 값·반파장·LF, 극소점 목록, "Basis: family") | `dsm-table-container` | `renderDsmResults` app:772 |
| 좌굴곡선 (반로그, 모드 5개, DSM 극점 마커, 십자 커서와 좌표) | `buckling-curve-canvas` 700×400 | `renderBucklingCurve` app:2470 |
| 모드 분류 G/D/L/O 누적 그래프 (버튼 `btn-run-classify`) | `classify-curve-canvas` 700×200 | `renderClassifyCurve` app:2982 |
| 소성 P-M 곡면 (`plastic-fy` 245 MPa, 버튼 `btn-run-plastic`) | `plastic-surface-canvas` 700×420 | `renderPlasticSurface` app:1920 → `_drawPMChart` app:2002 |
| 자유진동 (버튼 `btn-run-vibration`, ρ=1.0 고정) | `vibration-result` 표 (상위 20개) | `renderVibrationResult` app:1896 |
| 2D 모드형상 (`select-length`, `select-mode`) | `mode-shape-canvas` 600×340 | `renderModeShape2D` app:2730 (u→x, w→z 단순 대입 근사) |
| 3D 모드형상 (드래그 회전, 휠 줌) | `mode-shape-3d-canvas` 600×400 | `renderModeShape3DWrapper` app:3073 → `window.CufsmViewer3D`(Babylon) 또는 `window.renderModeShape3D`(Canvas 폴백) |

기본 반파장은 DSM Mxx의 min(Lcrl, Lcrd)에 가장 가까운 점으로 고른다(`populatePostSelects` app:2852).

**C. 부재 설계** `sec-member-design` (기본 펼침)

| 그룹 | id | 단위 | 기본값 |
|---|---|---|---|
| 재료(읽기 전용 미러) | `design-fy`, `design-fu` | MPa | 245, 400 |
| 설계법 | `select-design-method` | – | LRFD (ASD). 해석법은 DSM 고정 |
| 부재 유형 에코 | `design-membertype-echo` | – | ② 탭 선택값 |
| 좌굴 길이 (압축/조합) | `design-KxLx`, `design-KyLy`, `design-KtLt` | mm | 3000 |
| 정모멘트 구간 | `design-Cb-pos`, `design-Lb-pos` | –, mm | 1.0, 0 (0 = 데크 구속) |
| 부모멘트 구간 | `design-Cb`, `design-Lb` (근거 span `*-calc`) | –, mm | 1.0, 3000 |
| β 보정 §2.3.3.3 | `chk-beta-dist`, `design-dist-M1M2`, `design-dist-Lm`, 미리보기 `design-beta-result` | –, mm | ✓, 0, 0 |
| Cm (조합) | `design-Cmx`, `design-Cmy` | – | 1.00 |
| 웹 크리플링 §G5 (휨/조합) | `design-wc-N`, `-R`, `-support`(EOF/IOF/ETF/ITF), `-fastened`, `-web-config`, `-family`, `-flange-condition`, `-Lo`, `-edge-distance`, `-nwebs`, `-fastener-spacing` | mm 등 | 89, 4.8, …, 1 |
| 고급 옵션 | `chk-inelastic-reserve`(§F2.4.2), `cold-work-status`(① 탭 에코), `chk-r-factor` + `select-r-value` (0/0.70/0.65/0.50/0.40/**0.60**/0.70 — **value "0.70"이 2개**, P:3341, 3346) | – | off, 0.60 |

- 필드 표시 규칙은 `updateDesignFieldVisibility` app:3501-3576이 부재 유형별로 정한다. 입력 범위 검증은 `VALIDATION_RULES` app:3205이며 `.input-invalid` 클래스만 붙고 메시지는 없다.
- 버튼:
  - `btn-run-design` "▶ 설계 검토 실행"(app:3583-3677): `collectDesignRunPayload` → `runDesign` → 호스트 `aisi_design` 전처리(P:1385-1632) → Python.
    - 조합이고 Muy>0인데 May=0이면 실행을 막고 `#design-validation` 경고와 포커스 이동을 한다.
    - `model`이 없고 직접입력 모드면 아무 피드백 없이 return한다(app:3657).
  - `btn-copy-report`: Python 평문 보고서를 클립보드로 복사한다.
- 출력 `renderDesignResult` app:4629-5017 (389행), 대상 `#design-summary`, `#design-steps`, `#design-interaction`, `#design-reference`:
  - 강도 카드 3장(Global/Local/Dist., 지배 배지)과 설계강도 라인
  - **이용률 게이지 바**(≤0.75 녹색 / ≤1.0 주황 / 초과 빨강)
  - 3상태 판정 OK/NG/미검토(NOT_CHECKED)
  - 미평가 배지(local/distortional/E2.2/B4)와 경고 박스(warnings, dsm_warning)
  - 단계별 계산 카드(Python steps, 정모멘트 구간은 JS가 다시 조립), §H1.2 조합표, 웹 크리플링/H3, 규준 참조 툴팁(`specRefSpan` app:3275)
  - 퍼린 결과는 `_pickGoverningPurlinDesign`(app:1845)이 정/부/랩/양력 중 **이용률 최대**를 지배로 고른다(JS 판정).

### 1.4 ④ 접합부 `tab-connection` (P:3387-3455)

**Lap Splice** (§I6.2.1, §J3, §J4)

| 입력 | id | 단위 | 기본값 |
|---|---|---|---|
| 랩 길이 좌/우 | `conn-lap-left`, `conn-lap-right` | mm | 305 |
| 지점 Mu, Vu | `conn-Mu`, `conn-Vu` | kN-m, kN | 0 (하중분석이 자동으로 채움) |
| 패스너 | `conn-fastener-type`(screw/bolt), `conn-fastener-dia`, `conn-n-rows`(1–4), `conn-edge-dist`(0=자동 1.5d) | mm | screw, 4.8, 2, 0 |

- 버튼 `btn-run-lap-design`(app:873-921). 다른 탭에 대한 의존이 있다.
  - d, t는 **`tpl-H`, `tpl-t`를 직접 읽는다**. 사용자 정의 단면이면 틀린 값이 된다.
  - Sf=`lastProps.Sx`.
  - Se=`_lastDesignResult.Se` → 없으면 Mnl/Fy → 없으면 Sx로 대체하고 경고한다. Mnd, Vn도 설계 결과에서 가져온다. → **③ 설계를 먼저 실행해야 정확하다.**
- 출력 `renderLapConnectionResult` app:995:
  - 경고
  - **Lap SVG**: 측면도와 Cut A-A, `_drawLapSvg` app:1176
  - 종합판정: 패스너 DCR, 휨 DCR
  - 결과표: 최소 랩, 전달 전단, φRn, 필요/배치 수, 간격, 단부거리, Lap 휨강도
  - 패스너 한계상태 표, 계산 단계

**단일 접합부** (Chapter J, 7종)

| 입력 | id | 단위 | 기본값 |
|---|---|---|---|
| 유형 | `conn-single-type`: screw §J4, bolt §J3, paf §J5, fillet_weld §J2.5, arc_spot §J2.2, arc_seam §J2.3, groove §J2.1/J2.6. 힌트는 `conn-single-hint` | – | screw |
| 판 두께, 직경, 개수 | `conn-t1`, `conn-t2`, `conn-d`, `conn-n` | mm | 1.5, 1.5, 4.8, 4 |
| 재료 | `conn-Fy`, `conn-Fu` (① 탭과 동기화한 뒤 수정 가능) | MPa | 245, 400 |
| 유형별 | `conn-weld-L`, `conn-weld-size` / `conn-groove-type`(CJP/PJP) / `conn-Fub`(bolt 827, screw 689 MPa 자동 전환) / `conn-Fuf` 827 | mm, MPa | – |
| 소요 | `conn-Pu` (0이면 강도만 조회) | kN | 0 |

- 버튼 `btn-run-single-conn`(app:923-956) → `runConnection`.
- 출력 `renderConnectionResult` app:1111: SVG(`_drawConnectionSvg` app:1477), Rn·설계강도·지배모드·3상태 판정·이용률, 한계상태 표.
- **Lap과 단일 접합부 결과가 같은 `#connection-result`를 덮어쓴다.** 두 결과를 동시에 볼 수 없다.

### 1.5 보고서 `tab-report` (P:3458-3466)

- 버튼은 `btn-generate-report` "상세 보고서 생성"과 `btn-print-report` "PDF 저장"(보고서를 생성한 뒤에 나타남)이고, 출력 영역은 `#report-container`다.
- 생성: `generateDetailedReport()` app:5122가 **웹뷰 JS에서 HTML 문자열**을 만든다. 하중 결과와 설계 결과가 모두 없으면 오류를 표시한다. 한국어(일부 영어 표 헤더)이고, 제목은 "CUFSM — 냉간성형강 설계 보고서"다(StCFSD가 아닌 CUFSM 브랜딩).
- 구성:
  1. 단면 `_rptSection` 5171: 단면 SVG, 제원(**현재 DOM의 tpl-* 값**), 성질
  2. 탄성좌굴 `_rptBuckling` 5233: 시그니처 곡선 SVG(화면용 Canvas와 별도 구현)와 DSM 표
  3. 설계 입력 `_rptDesignInput` 5334: E=29500 ksi, ν=0.30이 고정 표기되어 실제 입력과 다를 수 있다.
  4. 하중분석 `_rptLoadAnalysis` 5418: 개략도, M/V도, 조합표, 자동 결정 매개변수, 처짐
  5. 설계 계산 `_rptDesignCalc` 5565 → `_rptFlexure`(185행)/`_rptCompression`/`_rptCombined`/`_rptTension`: Cold Work 표, Lap 표, §H1.2, §H2
  6. 설계 요약 `_rptSummary` 5872
- 보고서에 들어가지 않는 것: 단일 접합부, 모드형상, 분류, 소성곡면, 진동, 검증 결과, 프로젝트 파일명. 커버·쪽번호·서명란도 없다. 압축은 이용률을 표시하지 않고, H1.2 표의 소요/저항 열은 비어 있다.
- 내보내기(app:5078-5113):
  - report innerHTML을 독립 HTML로 감싸면서 `--vscode-*` 7개를 라이트 값으로 재정의하고 `@media print`를 넣은 뒤 `saveReportPdf{html}`을 보낸다.
  - 호스트 `_saveReportPdf` P:2536-2622가 `showSaveDialog`(PDF/HTML)를 연다. .html이면 그대로 저장한다. .pdf면 **시스템 Edge/Chrome을 headless `--print-to-pdf`로 실행**(`_findBrowser` P:2630)하고, 브라우저가 없으면 HTML로 대신 저장한다. `window.print()`는 쓰지 않는다.
- 단위를 토글하면 보고서가 열려 있을 때 다시 생성한다(app:219).
- MCP `generate_report`(P:1657)는 **JSON 데이터 묶음만** 반환한다. HTML이나 PDF는 MCP로 만들 수 없다.

### 1.6 검증 `tab-validation` (P:3469-3477)

- 버튼은 `btn-run-validation` "설계 검증 실행"이고, 출력은 `validation-summary-badge`(통과/주의/실패 수)와 `validation-container`다. 결과 수는 `treeUpdate{validationPass/Warn/Fail}`로 트리에도 보낸다(app:5982-5999).
- 엔진 `runAllValidationChecks()` app:6005-6902는 **898행, 70개 검사**다. 전부 웹뷰 JS에서 돌고 Python은 호출하지 않는다. 입력은 DOM 값과 클로저 결과 7종이다. 범주는 다음과 같다.
  - A 단면 입력: t, w/t, b/t, d/t, R/t. 템플릿 파라미터 기반이라 사용자 정의 단면이면 생략된다.
  - B 재료: Fy≤95, Fu/Fy≥1.08
  - C 좌굴해석: 반파장 범위·개수, 하중 케이스와 부재의 일치, 해석·DSM 추출, Mcrl/Mcrd 식별
  - D 단면 성질
  - E 하중 입력: 스팬 판정 기준이 status는 40 ft, note는 33 ft로 서로 다르다.
  - F 하중분석: Mu/Vu, Ly/Cb, R, Lap end, 처짐 L/δ (IBC 1604.3)
  - G 설계 결과: Mne/Mnl/Mnd 관계, IR/Cold Work 배타, λ 재계산, 이용률, 저항계수, H1.2, 경고
  - G2 Lap: 2겹 휨, 랩≥1.5d, DCR
  - H 일관성: "Fy 일관성"과 "해석 최신성"은 **사실상 항상 pass**다. 실제로 서명을 비교하지 않는다.
- 표시 `renderValidationDashboard(checks)` app:6904는 **순수 함수**(checks → HTML)다.
- MCP `validate_design`(P:1756)은 `checks: []`를 비워 두고 원자료만 돌려준다. **GUI와 MCP의 판정이 비대칭이다.**

### 1.7 좌굴해석 보고서 (별도 웹뷰 패널)

- `btn-view-buckling-report` → `_buildBucklingReportHtml()` app:2934. 해석 조건 표, DSM 표 HTML 복사본, 캔버스 5개의 `toDataURL` PNG(3000 B 미만이면 빈 캔버스로 보고 제외)로 구성한다.
- `showBucklingReport{html}`을 보내면 호스트가 `stcfsd.bucklingReport` 패널을 `ViewColumn.Beside`에 연다(P:2485-2534). 이 패널에는 인라인 스크립트와 `btn-pdf`가 있고, `savePdf`(P:2501)가 같은 PDF 파이프라인을 쓴다.

### 1.8 단위계 토글 (app:33-229, 406-475)

- `UNIT` 표(app:38-55)는 15유형이다: length, length_ft, area, inertia, modulus, stress, force, moment, moment_ft, pressure, linload, thickness, radius, rotStiff, latStiff.
- 변환 함수는 `toDisplay`/`fromDisplay`/`unitLabel`/`unitDec`/`fmtVal`(app:111-137)이다.
- `DEFAULTS`(app:58-108)는 SI 기준 기본값 39개다. `getNum(id, fallback)`(app:3156)은 입력이 비어 있으면 DEFAULTS를 현재 단위로 환산해 쓴다. 그래서 코드에 적힌 US fallback은 대부분 쓰이지 않는다.
- `refreshUnits`(app:143-229)의 동작:
  - 하드코딩된 입력 맵 58개와 스팬 표 셀의 값을 변환한다.
  - `[data-unit]`과 `.conn-unit-*` 라벨을 교체한다.
  - 표, 프리뷰, DSM 표, 설계 결과, 보고서, 하중 결과를 다시 렌더한다.
- 누락과 결함:
  - `conn-edge-dist`가 맵에 없다.
  - 캔버스 3종과 접합부 결과는 다시 그리지 않는다.
  - 분류 곡선 x축은 항상 US로 표시된다(app:3060).
  - Python이 만든 수식 문자열은 `_convertFormulaUnits`(app:5027)가 **단위 라벨만** 바꾸고 수치는 US 그대로 둔다.
- 영속성: `.csd`의 `designInputs.unitSystem`에만 저장된다. 웹뷰를 다시 만들면 SI로 돌아간다.
- MCP 쪽은 따로 `src/mcp/siUnits.ts`를 쓰며, SI 옵션을 받는 도구는 7개뿐이다. 웹뷰 체계와 MCP 체계가 **이원화**되어 있다.

### 1.9 프로젝트 열기/저장 (.csd)

- **저장** 흐름: `btn-file-save` → `saveProject`(app:6997) → 호스트 `collectDesignData` → 웹뷰 `collectAllDesignInputs()`(app:6954 → `StcfsdDesignState.collectDesignInputs`) → `designDataCollected` → `_saveProject` P:3495-3549 → `showSaveDialog` → `fs.writeFileSync`.
  - 저장 시 Python `dsm`, `get_properties`를 다시 호출한다.
  - 저장 직전에 서명을 다시 확인한다.
- **열기** 흐름: `btn-file-open` → `openProject`(app:6992) → `_openProject` P:3552-3621 → `modelLoaded` → 서명이 같으면 `analysisComplete`+`dsmResult`, 다르면 `analysisInvalidated` → `loadAnalysisComplete`(무조건) → `designResult`(서명 일치 시) → `propertiesResult` → **마지막에** `restoreDesignInputs`. **아무것도 다시 계산하지 않는다.**
- 스키마는 §3.2에 정리했다.

### 1.10 사이드바 트리(ProjectExplorer)와 명령

- 뷰 컨테이너 `stcfsd-explorer` 아래에 뷰 "Section Designer"(`stcfsd.projectExplorer`)가 있다(package.json:74-109, ext:58).
- 루트 노드(PE:156-219):
  - 전처리: 템플릿, 치수, 재료, 절점/요소, 성질
  - 해석: BC, 반파장, cFSM, 해석 실행 — context `section-analysis`
  - 후처리: 좌굴곡선, 2D/3D, 분류, DSM P/M
  - 설계: 부재유형, 스팬, 간격, 하중 D/Lr/S/L/W, Lb, 하중분석 결과(지배조합, maxMu, maxVu, 처짐), 설계 결과(지배모드, Mn, Pn, 이용률)
  - 접합부: Lap, 단일
  - 보고서
  - 검증: 실패/주의/통과, 검증 실행
  - MCP 서버: 등록 / 상태 / 해제
  
  트리 분류는 탭 구성과 맞지 않는다. 트리에는 하중계산 루트가 없고, 해석과 후처리가 나뉘어 있다.
- 트리의 데이터는 **웹뷰가 만든 표시 문자열 약 40개 필드**(`sendTreeUpdate` app:1790-1843 → `treeUpdate` → `_updateTreeView` P:200 → `updateProjectData` PE:112)다. 트리 자체에는 계산이 없다. 패널을 닫아도 옛 요약이 계속 표시된다.
- 클릭(ext:110-143): 패널이 없으면 Python과 패널을 만든 뒤 **800 ms 후**에 `showSection`을 보낸다(경쟁 조건 가능). 웹뷰의 `handleShowSection`(app:1716)은 `tabMap` 22개와 `focusMap` 26개로 탭을 전환하고 해당 입력으로 스크롤·포커스한다. `run-analysis`/`run-validation`은 버튼 클릭까지 한다.
- 명령 8개(ext:65-107):

| 명령 | 동작 |
|---|---|
| `stcfsd.openDesigner` | Python 기동을 시도하고 패널을 연다 |
| `stcfsd.newProject` | openDesigner와 **같은 코드**다. 새 모델을 만들지 않는다 |
| `stcfsd.navigateSection` | 숨김 명령, showSection |
| `stcfsd.refreshProjects` | 트리 새로고침 |
| `stcfsd.runAnalysis` | 섹션 이동만 한다. 해석을 직접 실행하지 않는다 |
| `stcfsd.registerMcpServer` | QuickPick으로 범위를 고르고 `.mcp.json`/`~/.claude/mcp.json`에 병합 등록 |
| `stcfsd.unregisterMcpServer` | 등록 해제 |
| `stcfsd.showMcpStatus` | 등록 상태 표시 |

  상태 표시줄 항목과 `contributes.configuration`은 없다. 다른 확장의 설정 `python.defaultInterpreterPath` 하나만 읽는다(ext:525).

### 1.11 탭 간 의존관계·데이터 흐름

```
① 단면·재료 ─ model(node/elem, 호스트 소유) ─┬─────────────────────────────┐
   │ Fy/Fu(단일 소스 → design-fy, plastic-fy, conn-Fy/Fu)                 │
   │ lastProps(Ixx, Sx)                                                   │
   ▼                                                                      ▼
③A FSM 해석 ──analysisComplete──▶ ③B 결과(곡선·모드·분류·소성·진동)    ② 하중계산 (Ixx 필요, tpl-* 사용)
   │ dsmResult(표시용 lastDsmResult)                                      │ loadAnalysisComplete
   │ [자동] prepareDesignDsm ─▶ 호스트 _preparedDesignDsm(family별 DSM)    │ [자동 채움]
   ▼                                                                      ▼
③C 부재설계 runDesign ◀── design-Mx/Mx-pos/V, Lb/Cb(±), β, R ────────────┤
   │ _lastDesignResult(Se, Mnl, Mnd, Vn)                                  │
   ▼                                                                      ▼
④ Lap 설계 ◀── Se/Sf/Mnd/Vn ────────────────── conn-lap-L/R, conn-Mu, conn-Vu
   │ _lastLapResult
   ▼
보고서(설계 또는 하중 결과 필요; Lap 결과 있으면 포함)   검증(전 결과 + DOM)
```

- FSM 해석과 하중분석은 **서로 독립인 두 가지 흐름**이며 ③C 설계에서 합류한다(부록 E §3-1). 탭 순서(② 하중 → ③ 해석)는 이 의존관계를 드러내지 못한다.
- 무효화 규칙: 모델이 바뀌면 `_invalidateAnalysisState`(P:686)가 캐시를 지우고 `analysisInvalidated`를 보낸다. 입력이 바뀌면 `invalidateDerivedResults`(app:7002)가 `_derivedInputRevision++`(P:264)를 일으킨다. 장시간 연산은 시작할 때의 서명·리비전과 끝날 때 값을 비교해 다르면 결과를 버린다(P:715-725). `_lastLapResult`와 ④ 탭 변경은 무효화 대상이 아니다.

---

## 2. 메시지 프로토콜

공통 형식은 `{command, data}`다(`type` 키가 아님). 호스트 → 웹뷰는 `_postMessage`(P:2702-2712)를 거치며, 패널이 dispose되면 보내지 않고 테스트 모드에서는 최근 100건을 기록한다. 웹뷰 → 호스트는 `vscode.postMessage`로 보내고 호스트는 `_handleMessage`(P:215-389)에서 받는다. Python은 `PythonBridge.call(method, params)`(줄단위 JSON-RPC, 요청마다 5분 timeout)로 호출한다.

### 2.1 웹뷰 → 호스트 (23종)

"TS 로직"은 호스트 TypeScript 쪽에 계산이나 후처리가 있다는 뜻이다. ★ 표시는 대량 로직이다.

| command | 송신 (app) | payload | 처리 (P) | Python | 회신 | TS 로직 |
|---|---|---|---|---|---|---|
| `webviewReady` | 7041 | – | 217 → 162-197 | generate_section, get_properties, stresgen | modelLoaded | 있음: 기본 C단면 100×50×20×2.3과 기본 길이를 하드코딩. **다시 수신하면 모델을 기본값으로 덮어쓴다** |
| `runAnalysis` | 2463 | 모델 전체 + lengths, m_all, prop, BC, neigs, loadCase, stressOpts | 222-248 → 392-453 | (get_properties, stresgen), analyze, classify, dsm | analysisStarted, analysisInvalidated, classifyResult, analysisComplete(+_meta), dsmResult / analysisError | 있음: node/elem은 호스트 것을 쓴다. neigs 검증, 서명 경합 폐기, family 판별 |
| `setStress` | **송신처 없음** | {type, fy, P, Mxx, Mzz} | 250 → 1109 | get_properties, stresgen | analysisInvalidated, modelLoaded | 있음(응력 스케일). GUI에서는 죽은 경로 |
| `getProperties` | 496, 555, 562 | {node, elem} | 254 → 456 | get_properties | propertiesResult / propertiesError | 없음 |
| `updateModel` | 554, 561 | {node} 또는 {elem} | 258 | – | analysisInvalidated | 얕은 병합이며 **검증하지 않는다**(MCP set_nodes와 달리 validator를 거치지 않음) |
| `invalidateDerivedResults` | 7015 | {scope: 'load' 또는 'design'} | 264 | – | – | 리비전++, 캐시 폐기 |
| `saveProject` | 6997 | – | 272 | – | collectDesignData | 2단계 왕복 |
| `designDataCollected` | 398 | designInputs | 278 → 3495 | dsm, get_properties | (toast) | ★ .csd 조립 |
| `openProject` | 6992 | – | 286 → 3552 | – | modelLoaded, analysisComplete, dsmResult, analysisInvalidated, loadAnalysisComplete, designResult, propertiesResult, restoreDesignInputs | 서명으로 유효성 판정 |
| `showBucklingReport` | 2978 | {html} | 290 → 2485 | – | (별도 패널) | 래핑만 |
| `saveReportPdf` | 5111 (보고서 패널은 `savePdf` P:2501) | {html} | 294 → 2536 | – | – | ★ Edge/Chrome headless PDF, 500 ms×10 폴링, HTML 폴백 |
| `generateTemplate` | 2204 | {section_type, params{H,B,D,t,r,qlip}} | 298 → 2673 | generate_section | analysisInvalidated, templateGenerated / templateError | 유형 정규화. **MCP 경로와 달리 응력 설정과 modelLoaded 전송이 없다**(웹뷰가 응력=Fy로 직접 세팅, app:284) |
| `applyStress` | **송신처 없음** | stresgen 인자 | 302 → 2691 | stresgen | stressApplied / stressError | 호스트 모델을 갱신하지 않는다. 죽은 경로 |
| `classifyModes` | 2919 | {} | 306 → 2655 | classify | classifyResult / classifyError | 최신성 검사가 없다(MCP classify와 다름) |
| `runPlastic` | 1879 | {node, elem, fy} | 310 → 2465 | plastic | plasticResult / plasticError | 없음 |
| `runVibration` | 1892 | – | 314 → 2474 → vibration 액션 | vibration (ρ=1.0) | vibrationResult / vibrationError | 없음 |
| `runLapConnection` | 919 | {d,t,Fy,Fu,lap_left_in,lap_right_in,Mu_support,Vu_support,fastener_type,fastener_dia,n_rows,end_distance,design_method,Se,Sf,Mnd,Vn} | 318 | lap_connection | lapConnectionResult | 없음 (Se 유도는 웹뷰 JS) |
| `runConnection` | 954 | {connection_type,t1,t2,d,n,Fy,Fu,Pu,design_method,…} | 327 | design_connection | connectionResult{request,…} | 요청을 결과에 병합(도면용) |
| `runDesign` | 3677 | collectDesignRunPayload 필드 약 40개 | 339 → 1385-1632 | get_properties, cutwp, (dsm×2), aisi_design | designResult | ★ 성질·cutwp 병합, xo/ro, DSM 소스 결정, depth·flange·lip·웹 수 추정, 평판폭 |
| `prepareDesignDsm` | 430 | {member_type, Fy} | 347 → 1216 | family별 get_properties, stresgen, analyze, classify, dsm | designDsmPrepared | ★ 부재 → family 매핑, 임시 모델, 서명 캐시 |
| `analyzeLoads` | 3901 | §1.2 payload | 356 → 1649 | analyze_loads | loadAnalysisComplete | 리비전 검사 |
| `treeUpdate` | 1842, 5995 | 표시 문자열 약 40개 / validation 수 | 365 → 200 | – | (트리) | 없음 |
| `sectionPreviewResult` | 571-609 | {png_base64,width,height} / {error} | 370-386 | – | – | base64를 `%TEMP%/cufsm_section_preview.png`로 저장하고 MCP 대기를 resolve |

### 2.2 호스트 → 웹뷰 (28종, 수신은 app:234-404 한 곳)

| command | payload | 발신 (P) | 웹뷰 처리 (app) |
|---|---|---|---|
| `modelLoaded` | StcfsdModel 전체 | 195, 1014, 1040 … 3576 (24곳) | 237: model 교체, 전처리 렌더(+getProperties), 응력 프리뷰, 트리 |
| `analysisStarted` | null | 393 | 243 |
| `analysisComplete` | {curve, shapes, …, classifications?, _meta{load_type, load_family, fy, signature, timestamp}} | 411, 1158, 2135, 3584 | 246: 곡선·셀렉트·2D·3D, design 탭 전환, 자동 prepareDesignDsm |
| `analysisInvalidated` | {reason, invalidateLoads} | 695, 3590 | 267: 결과 null, DSM 상태, 트리 |
| `analysisError` | {error} | 233, 450 | 303 |
| `classifyResult` / `classifyError` | 길이×모드 [G,D,L,O]% | 409, 1156, 1358, 2666 / 2658, 2668 | 329 / 313 |
| `dsmResult` | {P, Mxx, Mzz, load_family} | 433, 1170, 3586 | 342: 표, 곡선 마커, 기본 반파장, 트리 |
| `propertiesResult` / `propertiesError` | props | 459, 3612 / 461 | 276 / 280 |
| `templateGenerated` / `templateError` | 단면 | 2684 / 2686 | 284 / 299 |
| `stressApplied` / `stressError` | node | 2695 / 2697 | 318(노드 표만) / 307(console만) |
| `plasticResult` / `plasticError` | {P, M11, M22, …} | 1380, 2468 / 2470 | 333 / 310(console만, 사용자 피드백 없음) |
| `vibrationResult` / `vibrationError` | {frequencies} | 2477 / 2479 | 336 / 339 |
| `lapConnectionResult` | lap 결과 | 321, 323, 1310 | 356 |
| `connectionResult` | 결과(+request) | 333, 335, 1320 | 360 |
| `designResult` | aisi_design(+dsm_warning) | 343, 1389, 1399, 1630, 3607 | 363 (퍼린이면 지배 선택) |
| `designPurlinResult` | {load_analysis, dsm_±, design_positive/negative/lap/uplift, …} | 2085 (MCP 전용) | 374 |
| `designDsmPrepared` | {success, member_type, load_cases, dsm, message} | 350, 352 | 387 |
| `loadAnalysisComplete` | analyze_loads 결과 | 359, 361, 3604 | 383 → renderLoadAnalysisResult와 자동 채움 |
| `showSection` | {sectionId} | 105 | 324 |
| `captureSection` | null | 1737 | 380 → SVG를 PNG로 |
| `collectDesignData` | null | 274 | 397 |
| `restoreDesignInputs` | designInputs | 3617 | 400 |

### 2.3 웹뷰 JS 쪽 계산·판정 로직 (Python이 아닌 곳)

- 해석 요청 전처리: logspace, m_all, prop, loadCase → stressOpts (app:2415-2458)
- 응력 프리뷰 간이 응력 (app:2239-2262), G 자동 계산 (app:2394)
- 퍼린 지배 결과 선택 (app:1845), 최대 Mu/Vu 추출 (app:1689)
- Lap Se = Mnl/Fy 유도 (app:884), 랩≥1.5d
- β 미리보기 (app:3743), 정모멘트 Fcre 영역 판정과 φ/Ω 하드코드 (app:4857-4922, 5618, 5804)
- 하중조합식 문자열 조립 (app:4336, 5478)
- 수식 단위 정규식 치환 (app:5027)
- 검증 70개 규칙 (app:6005) 전체와 상세 보고서 전체 (app:5122)
- `verdictOf`가 세 번 정의되어 있다 (app:1101, 4659, 5876)

---

## 3. 상태 소유

### 3.1 어디에 무엇이 있나

| 상태 | 소유자 | 위치 |
|---|---|---|
| 정본 모델 `_model`(node, elem, prop, lengths, m_all, BC, springs, constraints, GBTcon, neigs, loadCase, loadFy, sectionType, sectionParams, cornerRadius) | **호스트 패널 인스턴스** | P:33-45, 타입 `src/models/types.ts` |
| 결과 캐시 `_lastAnalysisResult`, `_lastLoadAnalysis`, `_lastDesignResult`/`Request`, `_preparedDesignDsm`/`Sig`, `_derivedInputRevision` | 호스트 패널 | P:36-41 |
| 모델 사본과 결과 사본 `model`, `analysisResult`, `lastDsmResult`, `_lastDesignResult`, `lastProps`, `_lastLoadAnalysis`, `_lastLapResult`, `_unitSystem`, `_lastReport` | **웹뷰 IIFE 클로저** | app:18-36, 4615 |
| 설계·하중·접합부 **입력값** | **웹뷰 DOM에만** 있다. 호스트로는 저장할 때만 넘어간다 | – |
| `_lastLapResult`, 단일 접합부·분류·소성·진동·검증 결과 | 웹뷰에만 있다(호스트에 없음) | – |
| 트리 요약 | 호스트 `ProjectSummary`(표시 문자열) | PE:40-119 |
| Python | **무상태**, 단일 스레드 순차 처리, 취소 불가 | python/server.py:368 |

- 최신성 판정: `_modelSignature`(P:530-546)는 모델 주요 필드의 JSON이다. `_isAnalysisCurrent`(P:762)가 서명을 비교하고, 서명이 다른 결과는 쓰지 않는다.
- `vscode.getState/setState`는 사용하지 않는다(0건). `WebviewPanelSerializer`도 없다. `retainContextWhenHidden:true`(P:67)이므로 탭이 가려졌을 때만 상태가 유지된다.

### 3.2 `.csd` v1.2 스키마 (P:3504-3541)

```jsonc
{
  "version": "1.2", "format": "cufsm-section-design", "timestamp": "ISO",
  "model": { /* StcfsdModel 전체: node[[id,x,z,dx,dz,dy,dq,stress]], elem[[id,ni,nj,t,mat]], prop[[mat,Ex,Ey,vx,vy,G]], lengths, m_all, BC, neigs, springs?, constraints?, GBTcon?, loadCase?, loadFy?, sectionType?, sectionParams?, cornerRadius? */ },
  "derivedStateSignature": "저장 시점 모델 서명",
  "analysisResult": { /* 최신일 때만, _meta.signature 포함 */ } | null,
  "loadAnalysis": {…} | null,
  "designResult": {…} | null,
  "designInputs": { /* designState.js 수집, US 내부값 ≈ 110개 DOM id */ } | null,
  "dsm": { "P":…, "Mxx":…, "Mzz":…, "load_family":…, "warning":… },   // 선택
  "preparedDesignDsm": {…},                                       // 선택(Fy 일치 시)
  "properties": {…}                                               // 선택
}
```

- `designInputs`의 주요 키(DS:8-153): unitSystem, fy/fu/fyLoad/presteelGrade, designMethod, memberType, spanType/nSpans/spacing/spans[]/supports[]/lapsPerSupport[], loadD…L, deck*, KxLx/KyLy/KtLt/Lb/Cb/Cmx/Cmy, Pu/Vu/Mux/Muy/MayStrength, wc*, template·tpl*, analysis*(BC, loadCase, neigs, lenMin/Max/N, P/Mxx/Mzz), chk*, conn* 20개.
- **저장되지 않는 입력**: `design-Mx-pos`, `design-Lb-pos`, `design-Cb-pos`, `design-dist-M1M2`, `design-dist-Lm`, `select-r-value`, `conn-edge-dist`, `input-E`, `input-G`. Lap 결과, 단일 접합부·분류·소성·진동·검증 결과도 저장되지 않는다.
- `analysisLoadP/Mxx/Mzz`는 표시값 그대로 저장하므로 단위계가 바뀌면 왜곡된다.
- 버전 검사나 마이그레이션은 없다. `projectData.model`이 있는지만 확인한다.
- 복원할 때 이벤트를 발화하지 않으므로 다음 파생 UI가 갱신되지 않는다: `updateDesignFieldVisibility`, `updatePLF`, `toggleBeta`, custom 하중 표시. 스팬 값은 **100 ms setTimeout**으로 채운다(DS:207-227). 호스트가 `designResult`를 `restoreDesignInputs`보다 먼저 보내므로, 결과 라벨이 복원 전의 DOM 값을 표시한다.

### 3.3 GUI–MCP 동기화

- 둘 다 같은 `StcfsdPanel.currentPanel._model`을 직접 바꾸고, 바꾼 뒤 **전체 모델을 `modelLoaded`로 push**한다. 버전이나 충돌 검사는 없다(마지막에 쓴 쪽이 이긴다).
- 웹뷰 입력 위젯 중 하중 케이스, BC, 길이 입력은 `modelLoaded`로 갱신되지 않는다. `renderPreprocessor`는 node/elem과 E/ν/G만 다시 반영한다. 그래서 **MCP로 설정한 BC나 길이가 GUI 입력란에는 보이지 않을 수 있고, GUI에서 "해석 실행"을 누르면 DOM 값으로 덮어쓴다.**
- MCP 설계(`aisi_design_*`)는 결과만 push하고 입력란은 갱신하지 않는다. 그 결과 화면의 입력과 결과가 서로 맞지 않을 수 있다.
- push하지 않는 MCP 결과: analyze_loads, vibration, get_dsm, prepare_design_dsm, generate_report, validate_design, cutwp, energy_recovery, web_crippling, calc_deck_stiffness, check_lap_length, shear_lag, block_shear, cold_work, flange_curling.

### 3.4 웹뷰(패널)를 닫으면

- `_dispose`(P:3623)가 `currentPanel=undefined`로 만든다. 그러면 **모델과 결과가 모두 사라진다.** 다시 열면 기본 C단면으로 시작한다.
- **MCP 도구 59개 중 58개가 "No active CUFSM panel"로 실패한다**(br:36-49). 정적 텍스트인 `custom_section_guide`만 동작한다. 모델이 필요 없는 계산 도구(steel_grades, cold_work 등)도 패널 인스턴스를 거치므로 같이 실패한다.
- 트리는 옛 요약을 그대로 표시한다. Python 프로세스는 살아 있다.
- MCP 경로는 Python을 기동하지 않는다. Python이 죽어 있으면 "Python process is not running" 오류가 난다.

---

## 4. MCP 측

### 4.1 연결 방식

`Claude 클라이언트 ─stdio→ node media/mcp-server.js ─HTTP→ 127.0.0.1:$STCFSD_MCP_PORT (52790~52809, ext:471) ─→ StcfsdPanel.currentPanel.handleMcpAction(body) / getStatus()`

- 엔드포인트는 `GET /status`와 `POST /action` 두 개다. HTTP 상태는 항상 200이고, 오류는 body의 `error` 키로 전달한다. MCP 쪽 `textResult`(srv:62)가 이를 `isError`로 바꾼다.
- 인증이 없고 `Access-Control-Allow-Origin: *`다(br:30). MCP `save_project`가 **임의 경로에 쓴다**(P:2090).
- 등록(registration.ts)은 `<ws>/.mcp.json`, `<ws>/.claude/mcp.json`, `~/.claude/mcp.json`에만 한다. **Claude Desktop의 `%APPDATA%\Claude\claude_desktop_config.json`에는 등록하지 않는다.** 실행 명령이 `node`라서 PATH에 node가 있어야 한다. 여러 VS Code 창이 같은 파일을 덮어쓰므로 마지막 창이 이긴다.

### 4.2 도구 59개 (그룹, 패널 필요 여부, GUI 반영)

| 그룹 | 도구 (→ 패널 액션) | 패널 필요 | GUI 반영 |
|---|---|---|---|
| A 상태·조회 (5) | get_status(GET /status), get_full_state, get_section_properties(→get_properties), get_dsm_values(→get_dsm), get_buckling_curve(→get_curve) | 예 | 없음 |
| B 단면 정의 (6) | set_section_template(→generate_template, 10종), set_custom_section(→generate_template custom), build_section(→custom_builder), get_section_preview(→capture_section_preview), custom_section_guide(정적), set_material | 예 (guide 제외). **preview는 웹뷰 DOM 렌더가 필요** | modelLoaded / captureSection 왕복(5초) |
| C 하중·경계·길이 (4) | set_load_case, set_stress, set_boundary_condition(→set_bc), set_lengths | 예 | modelLoaded. 단, 입력 위젯은 갱신되지 않음 |
| D 해석 (3) | run_analysis, run_signature_curve(→signature_ss: S-S 강제, 100점), classify_modes | 예 | analysisComplete, dsmResult, classifyResult |
| E 절점·요소 (12) | get_nodes, get_elements, set_node_stress, set_nodes, set_elements, add_node, add_element, modify_node, delete_node, modify_element, delete_element, double_mesh(→doubler) | 예 | modelLoaded |
| F 고급 해석 (4) | get_cutwp, run_plastic_surface, run_vibration, get_energy_recovery | 예 | plastic만 push. vibration, cutwp, energy는 반영되지 않음 |
| G 구속·cFSM (3) | set_springs, set_constraints, set_gbtcon | 예 | modelLoaded |
| H 프로젝트 (2) | save_project, load_project | 예 | load는 modelLoaded. **원시 모델만** 다룬다(.csd 래퍼, 결과, designInputs 없음). save는 응답을 보지 않고 항상 "saved"를 반환한다(srv:703) |
| I AISI 부재설계 (7) | aisi_design_compression/flexure/combined/tension/connection(→aisi_design), steel_grades, aisi_design_guide(→aisi_guide) | 예 | designResult (입력란은 갱신되지 않음) |
| J 하중·데크·퍼린 (4) | get_web_crippling, analyze_loads, calc_deck_stiffness, design_purlin(★ TS 오케스트레이션 P:1812-2087) | 예 | analyze_loads는 push하지 않음. design_purlin은 designPurlinResult |
| K 보고서·검증 (2) | generate_report(JSON), validate_design(원자료, checks:[]) | 예 | 없음 |
| L 접합부 (5) | design_lap_connection, check_lap_length, design_connection, check_shear_lag, check_block_shear | 예 | lap과 connection만 push |
| M 특수 주제 (2) | cold_work, flange_curling | 예 | 없음 |

- SI 옵션을 지원하는 도구는 7개뿐이다(get_dsm_values의 길이, set_section_template, aisi_design_* 5종). analyze_loads(ft/plf), set_lengths, lap, connection 등은 US 전용이다.
- MCP 도구 안에는 계산이 없다. 예외는 set_material의 G 계산(srv:438)과 SI 변환이다. 주요 오케스트레이션은 패널 TS에 있다: design_purlin, aisi_design 전처리, prepare/get_dsm, generate_report, validate_design, 노드 편집, get_full_state의 곡선 극소점 탐색.

### 4.3 GUI 전용 기능과 MCP 전용 기능

- **GUI만 가능**:
  - 상세 HTML 보고서와 PDF, 좌굴 보고서 패널
  - 검증 70개 규칙의 판정
  - `.csd`(설계 입력과 결과 포함) 저장·열기
  - 하중 → 설계/Lap 입력 자동 채움
  - 단위 토글, 차트 상호작용, 트리 내비게이션
  - `invalidateDerivedResults`
  - 해석이 끝난 뒤 자동 `prepareDesignDsm` (MCP에는 prepare_design_dsm 도구가 없다)
  - 패널 액션 `apply_deck_springs`(P:1799)에 대응하는 MCP 도구가 없다
- **MCP만 가능**:
  - 절점·요소 개별 추가·삭제·이동 (GUI의 추가 버튼은 죽어 있고 표에서는 값 편집만 된다)
  - springs, constraints, GBTcon 원시 입력 (GUI에는 cFSM 체크박스만 있다)
  - set_custom_section, build_section, custom_section_guide, aisi_design_guide
  - cutwp, energy_recovery, shear_lag, block_shear, cold_work, flange_curling, web_crippling, deck stiffness 단독 호출
  - **design_purlin 원샷 워크플로**
  - get_section_preview PNG, run_signature_curve, 일부 SI 입력
- 패리티 검사가 실제로 보는 범위:
  - `scripts/check-mcp-parity.cjs`: **소스와 번들(media/mcp-server.js)이 일치하는지만** 본다. 버전+소스해시, 도구 이름 집합, 스키마, 설명을 비교하며 GUI는 보지 않는다.
  - `test/webview/parity_contract.js`: 문자열 tripwire다. MCP에 load_project, cold_work, flange_curling이 있는지, 패널에 해당 case가 있는지, GUI 진동해석이 배선되어 있는지만 확인한다.
  - **GUI와 MCP 사이의 기능 대응을 검사하는 장치는 없다.**

### 4.4 서버 instructions (srv:96-112)

- 단위 기본은 US이고 `units="SI"` 옵션이 있다. 기본 강재는 SGC400이다.
- 워크플로는 **FSM 6단계만** 설명한다: get_status → set_section_template → set_material/BC/lengths → run_analysis → get_dsm_values → get_buckling_curve.
- 끝에 "All changes are reflected in the VS Code WebView in real-time."라고 적혀 있다.
- 설계, 하중, 퍼린, 접합부, 보고서·검증 흐름과 "패널을 먼저 열어야 한다"는 전제는 instructions에 없다. AI는 개별 도구 설명과 `aisi_design_guide`로만 이를 알 수 있다.

---

## 5. VS Code 결합도 — 이식 전략 판단 근거

### 5.1 호스트 측 `vscode.*` 사용 (총 111회, 3개 파일)

| 파일 | 횟수 | API (용도) |
|---|---|---|
| `extension.ts` | 33 | `ExtensionContext`(4), `commands.registerCommand`(8)/`executeCommand`(1), `window.createTreeView`(1), `show{Information(4, 일부 modal), Warning(3), Error(3)}Message`, `showQuickPick`(2), `withProgress`+`ProgressLocation`(pip 설치), `env.openExternal`+`Uri.parse`(python.org), `workspace.getConfiguration('python')`, `workspaceFolders`, `onDidChangeWorkspaceFolders`(MCP 설정 재기록) |
| `ProjectExplorerProvider.ts` | 42 | `TreeItem`(상속), `TreeDataProvider`, `EventEmitter`, `TreeItemCollapsibleState`(19), `ThemeIcon`(19, codicon 이름) |
| `StcfsdPanel.ts` | 36 | `createWebviewPanel`(2: 본 패널, 좌굴 보고서), `WebviewPanel`(타입 3), `Uri`(3)/`joinPath`(8)/`file`(1), `ViewColumn`(3), `activeTextEditor`(2), `showSaveDialog`(2), `showOpenDialog`(1), `workspace.fs.writeFile`(1), show*Message(10). 인스턴스 멤버: `webview.html`, `postMessage`, `onDidReceiveMessage`, `onDidDispose`, `reveal`, `asWebviewUri`(6), `cspSource`(3) |
| `bridge/*`, `mcp/*`, `models/*`, `viewer3d/*` | 0 | vscode에 의존하지 않는다 (mcp/server.ts는 별도 node 프로세스) |

### 5.2 웹뷰 측 결합

- `acquireVsCodeApi()`는 app:12에서 **1회** 호출하고 **`postMessage`만** 쓴다. 수신은 표준 `window.addEventListener('message')`(app:234)다. 좌굴 보고서 패널의 인라인 스크립트(P:2532)도 이 API를 쓴다.
- `--vscode-*` CSS 변수: **총 213회 참조, 37종**(theme.css 97회/32종, app.js 86회/15종, StcfsdPanel.ts 28회/10종, modeShape3D.js 2회).
  - theme.css의 62회와 app.js 인라인 SVG·style의 대부분은 **fallback이 없다**. VS Code 밖에서는 배경이 투명해지고 테두리가 사라진다.
  - Canvas는 `getComputedStyle(document.body).getPropertyValue('--vscode-…')`로 색을 읽는다(app:1929, 2507-2511, 2767, 3045). 이쪽은 다크 fallback이 있다.
  - `body.vscode-dark/light` 클래스와 `prefers-color-scheme`는 쓰지 않는다(0건). 그런데도 하드코딩 색 약 212개(app.js)가 **다크 테마를 전제**로 한다(#4fc3f7, 캡처 배경 #1e1e1e, 소성 정보 패널 rgba(30,30,30,.85)). Babylon 배경은 반대로 라이트 고정(0.95)이다.
  - PDF 래퍼(app:5083-5091)가 `--vscode-*` 7개를 라이트 값으로 재정의해 쓰고 있다. 이것이 "변수 셋 주입" 방식의 선례다.
- CSP(P:2736-2742): `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-…' 'unsafe-eval'; img-src ${cspSource} data: blob:`. nonce는 32자다(P:3633).
  - 메인 패널에는 인라인 스크립트가 없다. 인라인 `style=` 속성은 패널에 224개, app.js에 213개 있다.
  - viewer3d는 `document.currentScript.nonce`를 `__webpack_nonce__`로 넘겨 지연 청크도 CSP를 통과하게 한다(viewer3d/index.ts:13-17).
- 리소스: `asWebviewUri` 6개(theme.css, designState.js, utils.js, app.js, charts/modeShape3D.js(defer), media/viewer3d.js(defer)). 로드 순서에 의존한다. `localResourceRoots`는 media와 webview다(P:68-71). HTML은 TS 템플릿 리터럴(`_getHtmlForWebview`)로 만들어지며 **정적 HTML 파일이 없다**.
- 그 밖에 VS Code를 가정하는 부분:
  - `navigator.clipboard`(보안 컨텍스트 필요)
  - `--vscode-font-family` 폰트
  - 테스트 훅 `__testDispatchMessage/__testGetPostedMessages/__testGetState/__testGetHtml`(P:113-159, `STCFSD_TEST_MODE=1`). 이 훅은 패널을 웹뷰 없이 메시지 주입으로 구동할 수 있다는 증거이기도 하다(`test/vscode/suite/designDsmPreparation.test.js`).

### 5.3 옵션별 판정

| 옵션 | 판정 | 쉬운 이유 | 어려운 이유와 해야 할 일 |
|---|---|---|---|
| **(a) 기존 호스트를 가짜 `vscode` 모듈로 plain Node(Electron main)에서 그대로 실행** | **실현 가능 — 중간 난이도.** 핵심 작업은 WebviewPanel 에뮬레이터 1개 | host 로직(서명, 오케스트레이션 약 1500행, MCP 브리지, PythonBridge, registration)이 vscode와 독립이다. `out/`은 CommonJS이므로 `Module._resolveFilename` 훅으로 스텁을 주입할 수 있다. 스텁 약 30종 중 대부분이 1–5행짜리다(commands Map, show*Message → 셸 대화상자, Uri.joinPath/file, EventEmitter, ThemeIcon, TreeItem). PDF는 vscode가 아니라 Edge를 spawn하는 방식이므로 그대로 동작한다. | ① `createWebviewPanel`/`Webview` 구현: html setter → BrowserWindow/iframe, 양방향 postMessage(IPC), `asWebviewUri`→custom protocol, `cspSource`, `onDidDispose`. 패널이 2종(본 패널, 좌굴 보고서)이다. ② `createTreeView` + `TreeDataProvider` → 셸 사이드바에 JSON으로 직렬화하고 codicon 아이콘을 매핑. ③ show{Save,Open}Dialog, modal 메시지 → Electron dialog. ④ "패널 = 상태" 구조(창을 닫으면 상태 소실, MCP 실패)는 그대로 따라온다. ⑤ MCP 등록을 Claude Desktop 설정으로 확장하고, `node` 대신 `ELECTRON_RUN_AS_NODE`를 쓰고, 브리지에 인증을 추가해야 한다. |
| **(b) 기존 웹뷰 HTML을 일반 브라우저/iframe에 `acquireVsCodeApi` 스텁으로 로드** | **쉬움** | API 사용이 `postMessage` 하나뿐이고 수신은 표준 message 이벤트다. getState/setState를 쓰지 않는다. viewer3d 지연 청크가 publicPath:'auto'다. | ① HTML이 TS 함수 안에 있으므로 `_getHtmlForWebview`를 가짜 webview(`asWebviewUri`=상대 URL, `cspSource`="'self'")로 호출해 HTML을 뽑거나 정적 HTML로 추출해야 한다. ② **`--vscode-*` 37종을 정의하는 테마 시트**(라이트/다크 2벌)를 만들어야 한다. ③ 트리뷰는 웹뷰 밖에 있으므로 새로 그려야 한다. ④ `navigator.clipboard`는 https 또는 custom protocol에서만 동작한다. ⑤ CSP 메타 태그의 nonce는 서버 쪽에서 채워야 한다. |
| **(c) 일부만 새 셸에 임베드 (단면 캔버스, 좌굴곡선, 3D 모드형상 등)** | **부품마다 다르다. 대부분 리팩터링이 필요하다** | 순수에 가까운 부품: `ModeShape3DRenderer` 클래스(canvas 주입, 데이터 → 그림), `window.renderModeShape3D`(전역 순수 함수), `utils.js`, `designState.js`(DI이지만 id 하드코딩), `_drawPMChart(ctx,…)`, `_drawConnectionSvg(r)`, `renderValidationDashboard(checks)`, `specRefSpan`, `renderBeamSchematic`, `_verdictOf` | app.js가 **하나의 IIFE**이고 `window.*` export가 0건이며 `getElementById`를 204회 쓴다. 렌더러들이 클로저 전역(`model`, `analysisResult`, `lastDsmResult`, `_unitSystem`, `_lastLoadAnalysis`)과 고정 id를 직접 읽는다. 예: `renderBucklingCurve`(256행)는 `analysisResult`, `lastDsmResult`, `#buckling-curve-canvas`를 읽고, `renderSectionSVG`는 `model`과 `#section-svg`를 읽는다. `CufsmViewer3D.render`조차 canvas id `'mode-shape-3d-canvas'`를 하드코딩한다(viewer3d/index.ts:57). `_drawLapSvg`는 DOM `tpl-B/D`를 읽는다. → 함수를 (data, units, theme) 인자형으로 추출하는 리팩터링이 필요하다. 하나당 수십~수백 행이다. |

**권장 판단 근거 요약**

- (b)의 "웹뷰 전체를 하나의 화면으로 띄우기"는 이틀 정도 작업으로 동작 가능할 것으로 보인다. (a)와 (b)를 결합하면 기존 기능을 100% 유지할 수 있다.
- 다만 새 인터페이스(위저드나 대시보드, Claude Desktop 병행)로 가려면 (c) 방식의 추출이 필수다. 추출 우선순위는 다음과 같다.
  1. 3D 렌더러, 소성곡선, 접합 SVG, 검증 대시보드(이미 순수)
  2. 단면 SVG, 좌굴곡선, 분류 곡선, M/V도(전역 1–3개를 인자로 바꾸면 됨)
  3. 설계 결과, 하중 결과, 보고서, 검증 엔진(대형이고 DOM 입력을 섞어 읽음)

---

## 6. 재사용 가능한 시각 컴포넌트

| 컴포넌트 | 진입 함수 (위치) | 입력 | 출력 | 순수성 | 기술 |
|---|---|---|---|---|---|
| 단면 미리보기 | `renderSectionSVG()` app:617 + `renderSectionAxes(props)` app:669 | 전역 `model`, props | `#section-svg` innerHTML | 비순수(전역, 고정 id, 호출 순서 의존). 로직은 약 110행으로 짧아 추출하기 쉽다 | SVG 문자열 |
| 단면 PNG 캡처 | `captureSectionPreview()` app:568 | `#section-svg` DOM | PNG base64 (MCP용) | DOM 의존. 배경 #1e1e1e 고정 | Canvas, Blob |
| 단면 성질 표 / DSM 표 / 진동 표 | `updatePropertiesTable` app:738 / `renderDsmResults` app:772 / `renderVibrationResult` app:1896 | 결과 객체 | HTML | 거의 순수(단위 전역만) | HTML |
| 응력 분포 프리뷰 | `renderStressPreview()` app:2216 | model + DOM 입력 4개 | `#stress-preview-svg` | 비순수(+JS 간이 응력 계산) | SVG |
| 좌굴곡선 | `renderBucklingCurve()` app:2470 (내부 `drawChart` app:2504) | 전역 `analysisResult.curve`, `lastDsmResult` | `#buckling-curve-canvas` | 비순수. 십자 커서와 DSM 마커 포함 | Canvas 2D |
| 보고서용 좌굴곡선 | `_rptBuckling` app:5233 | 동일 | SVG 500×220 | 추출 쉬움. **화면용과 별도 구현** | SVG |
| 2D 모드형상 | `renderModeShape2D()` app:2730 | 전역, 셀렉트 DOM | `#mode-shape-canvas` | 비순수. u/w 근사 | Canvas 2D |
| 3D 모드형상 | `new ModeShape3DRenderer(canvas).render({nodes,elems,modeVec,length,BC,scale})` (src/webview/viewer3d/ModeShape3DRenderer.ts), 전역 `window.CufsmViewer3D.render` (index.ts) | 데이터 | canvas | **클래스는 순수**하고 래퍼만 id를 하드코딩한다. 회전·팬·줌, BC별 형상함수, 정점색. 배경이 라이트 고정이다 | Babylon.js 7 (지연 청크 1.0 MB) |
| 3D 폴백 | `window.renderModeShape3D(canvas,…)` charts/modeShape3D.js:27 | 동일 | 등각 와이어프레임 | **순수** | Canvas 2D |
| 모드 분류 누적 그래프 | `renderClassifyCurve(clas)` app:2982 | clas + 전역 curve | `#classify-curve-canvas` | 비순수. x축 라벨은 US 고정 | Canvas 2D |
| 소성 P-M 곡면 | `renderPlasticSurface(data)` app:1920 → `_drawPMChart(ctx,hull,…)` app:2002 | data | `#plastic-surface-canvas` 2분할 | `_drawPMChart`는 **순수** | Canvas 2D (convexHull은 utils.js) |
| (사용 안 함) 3D 소성곡면 | `PlasticSurfaceRenderer.ts` (226행) | – | – | **어디서도 import하지 않는 죽은 코드** | Babylon |
| 보 개략도 | `renderBeamSchematic(data)` app:3906 | 하중 결과 | SVG 480×80 | 거의 순수 | SVG |
| M/V/처짐도 | `renderDiagramSVG(values,label,color,flip,dimLines,annotations,xCoords)` app:4018 | 배열 | SVG | 반순수(지점 마커를 위해 `_lastLoadAnalysis`를 읽음) | SVG |
| Lap 접합 도면 | `_drawLapSvg(r)` app:1176 (280행) | lap 결과 + **DOM tpl-B/D** | SVG 540×310 (측면도, Cut A-A, 치수) | 반순수 | SVG |
| 단일 접합 도면 | `_drawConnectionSvg(r)` app:1477 (210행) | 결과 | SVG 440×220 (나사, 볼트, PAF, 필릿, 아크스폿, 아크시임, 그루브) | **순수**. `<marker id="arrowR">`가 중복 정의된다 | SVG |
| 강도 카드, 이용률 게이지, 경고 배지, 계산 단계 카드 | `renderDesignResult` app:4629 내부 인라인 | 결과 + DOM 입력 | `#design-*` | 결합. 분리된 함수가 없다 | HTML/CSS |
| 3상태 판정 | `_verdictOf(dd)` app:1101 | {pass, verification_complete} | {state,label,cls} | 순수 | – |
| 규준 툴팁 | `specRefSpan(sec)` app:3275 + CSS theme.css:744 | 조항 | span | 순수 | CSS |
| 상세 보고서 | `generateDetailedReport()` app:5122 + `_rpt*` 11개 | 클로저 7종 + DOM | HTML 문자열 | 결합(문자열이라 출력 위치는 자유) | HTML |
| 검증 대시보드 | `renderValidationDashboard(checks)` app:6904 / 엔진 `runAllValidationChecks` app:6005 | checks / DOM+클로저 | HTML / checks[] | **표시 함수는 순수**, 엔진은 강결합 | HTML |
| 좌굴 보고서 | `_buildBucklingReportHtml()` app:2934 | DOM + 캔버스 PNG | HTML | 강결합 | HTML |

---

## 7. 기록된 문제·요구와 현재 코드 상태

판정: **유효**(아직 사실) / **부분** / **해소**. 근거는 현재 행 번호다. 전체 표는 부록 E에 있다.

| # | 문제·요구 | 출처 | 현 상태 | 근거 |
|---|---|---|---|---|
| 1 | 탭이 평행 나열되어 순서가 보이지 않고 선행조건이 강제되지 않음 → **단계형 위저드 + 결과 대시보드**(stepper, 완료 체크, 대시보드 홈) | 0926 §5.2-1, §5.3 안 A, §5.4 | **유효(미이행)**. 0926 §9/§10이 미이행을 명시한다 | app:415-422 `switchTab` 무조건 전환, app:2914/2975/5068 사후 오류문 |
| 2 | 결과가 흩어져 있음(좌굴·DSM·이용률·랩 DCR·하중·종합) | 0926 §5.2-2, IF | **부분**. ③에 해석과 설계를 합쳤지만 ②, ④, 보고서, 검증으로 여전히 분산되어 있다 | P:3031, app:4690 |
| 3 | app.js 모놀리스 → ES 모듈 분할(파일당 ≤800행) | 0926 §2, §5.5-1 | **유효(악화)**: 6833 → 7043행. 분리된 것은 utils.js와 modeShape3D.js뿐 | – |
| 4 | StcfsdPanel.ts가 HTML, 브리지, 결과 가공을 겸함 | 0926 §2, §5.1 | **유효(악화)**: 2936 → 3640행. 퍼린, 랩 ×12, 양력 설계가 TS에 있다 | P:1812-2087 |
| 5 | 다크모드: 범례 배경 고정 | 0926 §5.2-4 | **해소**(Canvas 배경은 변수를 읽음) | app:2507 |
| 6 | 다크모드: 곡선, 마커, 판정 색 하드코딩 | 0926 §5.2-4, §5.5-2 | **유효**: hex 약 212개, 인라인 style 약 437개(app+panel). Babylon 배경은 라이트 고정 | app:2529, 2581, 1011-1026 |
| 7 | 테마 토큰을 VS Code 변수에 위임 | 0926 §5.5-2 | **해소됐으나 VS Code 의존이 깊어졌다**. 이식할 때 37종을 정의해야 한다 | theme.css |
| 8 | 표준 오류 계약 `{code,message,field,action}` | 0926 §5.5-4 | **유효(미구현)** | grep 0건 |
| 9 | Lb 기본값(120 in) 사용 시 입력란 옆 인라인 경고 | 0926 §3.4, §5.2-6 | **부분**: 결과 경고 박스에만 표시 | app:4813 |
| 10 | May 누락 시 Python 오류만 남 | 0926 §5.2-6 | **해소**: 사전 차단, 경고 박스, 포커스 | app:3640-3668 |
| 11 | 필수 입력이 덜 되면 Run 비활성화 | IF §2.5-C | **부분**: 클릭할 때 검사한다. 직접입력 모드에서 model이 없으면 무반응 | app:3657 |
| 12 | 섹션 완료 체크마크 | IF §2.2-C | **유효** | grep 0건 |
| 13 | 결과 비교 히스토리 | IF §2.9, C2 | **유효** | grep 0건 |
| 14 | M/V 다이어그램 호버 값 | IF C3 | **유효**: 호버는 좌굴곡선에만 있다 | app:2714 |
| 15 | 다중 위치 설계검토(이용률) 표 | IF C5 | **부분**: 위치별 Mu/Vu만 있다 | app:4220 |
| 16 | design_purlin 다단계 진행 표시 | IF §2.6-B | **유효**: 스피너뿐이다 | – |
| 17 | SI 모드에서 수식 문자열이 US로 남음 | IF §7.4 | **부분**: 라벨만 치환하고 수치는 US | app:5027 |
| 18 | 웹뷰와 MCP의 단위 변환 이원화 | 0926 §5.1, P1-7 | **부분**: MCP는 siUnits.ts로 정리했고 웹뷰는 별도 | – |
| 19 | kip-ft ↔ kip-in 12배 오류 | 설계탭 2B·6, W01 §6 | **해소**, tripwire 있음 | app:4448, lap_governing_contract.js |
| 20 | 보고서 품질(가정 정리, 계산서, 인쇄, PDF) | 0926 §5.2-7, §5.4 | **부분**: HTML과 PDF는 있다. CUFSM 브랜딩, 압축 이용률 없음, H1.2 빈 열, 접합부·모드·분류·소성 누락, E/ν 고정 표기. PDF가 시스템 Edge/Chrome에 의존 | app:5122, P:2536 |
| 21 | 단면 프리뷰에 치수(d/b/c/t/R) 오버레이, 임의단면 winding 오류 표시 | 0926 §5.4 | **유효(미구현)** | – |
| 22 | 3D/2D 렌더러 팩토리와 폴백 일원화 | 0926 §5.2-5, §5.5-6 | **부분**: 폴백은 있지만 팩토리는 없다 | app:3097-3127 |
| 23 | 접근성(Canvas 대체 텍스트, 키보드, 대비) | 0926 §5.2-8, IF §2.10 | **부분**: canvas 5개에 aria-label이 있다 | P:3150-3160 |
| 24 | 영/한 혼용 | W02 B4 | **부분**: Open/Save와 일부 표 라벨이 영문 | P:2759, app:4984 |
| 25 | 기본값(SGC400 등)이 여러 곳에 하드코딩 | IF §8.1 | **유효**: app DEFAULTS/getNum fallback, HTML, server.ts, Python, 호스트 초기 모델(길이 범위도 UI와 다름). E도 203395(HTML)와 203000(MCP instructions)으로 다르다 | app:58, P:186 |
| 26 | MCP enum과 UI select를 같은 소스에서 | 0926 §3.4 | **유효(구조적)** | – |
| 27 | 설계 탭 안의 스텝 표시기 | IF §2.1 | **해소**. 다만 ②가 탭으로 분리된 뒤에는 의미가 겹치고 클릭할 수도 없다 | app:3189 |
| 28 | 이중 실행("설계용 FSM 준비") 제거 | W02 C1, D2 | **해소**: 자동 prepareDesignDsm | app:426 |
| 29 | 하중 → 접합부 수동 왕복 | W02 B3 | **해소**: 이동/자동 실행 버튼 | app:4550 |
| 30 | Fy 단일 소스 | IF §6 | **해소**. 단, 복원할 때 design-fy가 input-fy를 덮어써 원천이 뒤집힌다 | DS:169 |
| 31 | README의 낡은 기술(도구 20/59개, 템플릿 8/10종, Postprocessor 탭) | README | **유효** | README:22-31, 69, 100 |

**이번 조사에서 새로 확인한 문제** (문서에 없음)

- 상태와 동기화
  - 패널을 닫으면 상태가 사라지고 MCP 58개 도구가 실패한다. Serializer도 없다(§3.4).
  - MCP 설정이 웹뷰 입력 위젯(BC, 길이, 하중 케이스)에 반영되지 않아, GUI에서 실행하면 덮어쓰인다(§3.3).
  - 웹뷰의 `updateModel`은 검증하지 않는다. `webviewReady`를 다시 받으면 모델이 초기화된다.
  - MCP `save_project`/`load_project`와 GUI `.csd`의 형식이 다르다.
- 저장
  - `.csd`에 9개 입력과 Lap 결과가 저장되지 않는다. 복원할 때 파생 UI가 갱신되지 않고 100 ms 타이머에 의존한다.
- 결과 표시
  - 결과 렌더러가 **현재 DOM 입력값**을 섞어 표시한다(app:4675, 5623, `_rptSection`). 그래서 입력과 결과가 어긋나도 알 수 없다.
  - Lap 설계와 검증 A 범주가 템플릿 입력 `tpl-*`를 읽어 사용자 정의 단면에서 틀린 값을 낸다.
  - Lap과 단일 접합부 결과가 서로 덮어쓴다.
- 죽은 요소
  - 버튼 `btn-add-node`, `btn-add-elem`
  - 호스트 핸들러 `setStress`, `applyStress`(웹뷰가 보내지 않음)
  - `PlasticSurfaceRenderer.ts`
  - 미사용 Python 메서드 7개(`fcfsm`, `load_mat`, `yieldMP`, `firstyield`, `signature_ss`, `save_project`, `load_project`)
- 오류 피드백
  - `plasticError`와 `stressError`는 console에만 찍히고 사용자에게 보이지 않는다.
  - `select-r-value`에 같은 value가 2개 있다.
  - `newProject` 명령이 새 프로젝트를 만들지 않는다.
- 트리
  - 트리 분류가 탭과 다르다.
  - 패널을 연 뒤 800 ms 경쟁 조건이 있다.
  - 닫힌 패널의 옛 요약을 계속 보여준다.
- 보안: 브리지에 인증이 없고 CORS가 *이며, `save_project`로 임의 경로에 쓸 수 있다.
- MCP 등록과 안내
  - Claude Desktop 설정 파일에 등록하지 않으며 node PATH에 의존한다.
  - 서버 instructions가 FSM 6단계만 설명한다.
- 하중·설계 흐름
  - `wall-stud`가 flexure로 매핑된다(스터드의 압축·조합 검토 경로가 없음).
  - `load-Wp-row`, `design-Cb-pos-row`, `design-Lb-pos-row`가 표시 규칙에서 빠져 있다.
  - 하중분석 버튼 라벨이 "📊 하중 분석 실행"으로 복원되어 HTML 원문과 다르다.

---

## 8. 규모·복잡도 지표

| 항목 | 값 |
|---|---|
| `webview/js/app.js` | **7043행**, 단일 IIFE(`// @ts-check`). `function` 키워드 128개(이름 붙은 함수 약 105개, 내부 함수 포함 스캐너 기준 118개), 화살표 함수 215개, `getElementById` 204회, `innerHTML` 44회, `addEventListener` 51회, `postMessage` 29행, hex 색 리터럴 212개, 인라인 `style="` 213개, `--vscode-*` 86회 |
| app.js 최상위 선언 | 약 58개(1–3175행 24개 + 3170–7043행 34개). 그중 **가변 상태 11개**(model, analysisResult, lastDsmResult, _lastDesignResult, lastProps, _lastLoadAnalysis, _lastLapResult, _unitSystem, _lapSeIsGross, _lastReport, vscode), 상수표 약 8개(UNIT, DEFAULTS, VALIDATION_RULES, SPEC_TIPS, gradeMap, CALC_MODES …), 나머지는 DOM 핸들이다. `window.*` 대입은 **0건** |
| app.js 최대 함수 | `runAllValidationChecks` **898행**(6005), `renderLoadAnalysisResult` 404(4163), `renderDesignResult` 389(4629), `_drawLapSvg` 280(1176), `renderBucklingCurve` 256(2470, 내부 drawChart 205), `_drawConnectionSvg` 210(1477), `_rptFlexure` 185(5616), 메시지 스위치 171(234), `_drawPMChart` 158(2002), `renderStressPreview` 155(2216), `renderDiagramSVG` 143(4018), `_rptLoadAnalysis` 143(5418) |
| `src/webview/StcfsdPanel.ts` | **3640행**, 메서드 63개. `handleMcpAction` **1468행**(995-2462; 그중 design_purlin 276, aisi_design 248), `_getHtmlForWebview` **778행**(2715-3492), `_handleMessage` 175, `_saveReportPdf` 87, `_openProject` 70 |
| 생성 HTML | `id=` **226개**(메인 225 + 보고서 패널 `btn-pdf`), `<input>` 83, `<select>` 19, `<button>` 26(id 20 + 탭 6), `<canvas>` 5, `<svg>` 2, 인라인 `style=` 224, `--vscode-*` 28회 |
| 기타 소스 | `src/mcp/server.ts` 1344행(도구 59개), `extension.ts` 536(함수 16개, `activate` 117행), `ProjectExplorerProvider.ts` 372, `PythonBridge.ts` 181, `JsonRpcProtocol.ts` 91, `mcp/bridge.ts` 104, `registration.ts` 141, `siUnits.ts` 138, viewer3d 4파일 695행, `designState.js` 386(관리하는 DOM id 약 110개), `utils.js` 46, `modeShape3D.js` 197, `theme.css` 877(`--vscode-*` 97회/32종, fallback 없는 것 62회), `python/server.py` 386(RPC 메서드 31개, 그중 미사용 7개) |
| `media/` 번들 | `mcp-server.js` **407,702 B**(map 1,738,837), `viewer3d.js` **3,452 B**(map 17,389), `viewer3d.mode-shape-renderer.js` **1,023,144 B**(Babylon 지연 청크, map 4,676,760), `stcfsd-icon.svg` 461 B. 확장 호스트는 webpack이 아니라 `tsc` 출력(`out/`)이고, `webview/js`와 css는 빌드 없이 원본 그대로 로드한다 |
| 빌드와 테스트 | `compile`(tsc), `build:webview`, `build:mcp`, `check:mcp-parity`, `test:webview`(node 계약 8개), `test:vscode`(@vscode/test-electron, 1개 시나리오), `test:python`. VSIX에는 Python 런타임과 numpy/scipy가 포함되지 않는다(사용자 PC Python + pip 설치 제안) |

---

## 9. 새 인터페이스가 잃어서는 안 되는 것 (우선순위)

1. **FSM → DSM → 설계 자동 연계**: 해석이 끝나면 `prepareDesignDsm`을 자동으로 보내고, 부재 유형별 family(P/Mxx)에 맞춘 DSM을 준비한다. 모델 서명(`_modelSignature`)과 입력 리비전으로 오래된 결과를 자동 폐기한다(P:1216, 530, 686, 715).
2. **하중분석 → 설계·Lap 입력 자동 채움과 그 근거 표시**: Mu(±)×12, V, Lb/Cb(±), β(M1/M2, Lm), 양력 R, 랩 길이, 지점 부모멘트 기준 `conn-Mu`, Lap end 처리. `*-calc` 근거 문자열과 title도 포함한다(app:4404-4612).
3. **호스트 TS의 설계 전처리와 오케스트레이션**: `aisi_design` 입력 조립(성질+cutwp 병합, xo/ro, 평판폭, 웹 수, 립 깊이, through_fastened)과 `design_purlin` 전체 흐름(정/부 FSM 2회, 영역별 Mu, Lap 2겹 강도, 양력). Python에 없으므로 옮기거나 그대로 재사용해야 한다(P:1385-1632, 1812-2087).
4. **설계 결과의 공학적 투명성**: 강도 카드와 지배 배지, 이용률 게이지, 3상태 판정(OK/NG/NOT_CHECKED), 미평가 배지, dsm_warning, 단계별 계산 카드, 규준 툴팁, §H1.2, 웹 크리플링/H3 상세(app:4629-5017).
5. **검증 70개 규칙과 대시보드**: GUI에만 있다. MCP에도 같은 판정이 보이도록 공유 모듈이나 Python으로 옮기는 것이 바람직하다(app:6005-6948).
6. **상세 계산서 보고서와 PDF, 좌굴해석 보고서(차트 5종 PNG)**: 보고서 생성 로직은 웹뷰 JS에만 있다(app:5122-5973, 2934; P:2536).
7. **.csd v1.2 프로젝트 파일**: 모델, 서명 게이트된 결과, designInputs 약 110필드. 하위 호환을 유지하고, 누락된 9개 입력과 Lap 결과는 보완해야 한다(P:3495-3621, designState.js).
8. **시각화 세트**:
   - 좌굴곡선(DSM 극점 마커, 십자 커서)
   - 2D/3D 모드형상(Babylon, 회전·줌, BC별 형상함수)
   - G/D/L/O 분류
   - P-M 소성곡면, 응력 프리뷰
   - 보 개략도와 M/V/처짐도
   - Lap 도면(측면도와 Cut A-A), 단일 접합 도면 7종
9. **단위 체계**: 내부 US, 표시 SI 기본, 15유형, SI 기준 DEFAULTS, 토글 시 재렌더. 그리고 **GUI와 MCP가 같은 단일 모델을 공유하며 실시간 반영**되는 것(`modelLoaded` push, `get_section_preview` PNG, 59개 도구).
10. **입력 체계의 세부 기능**:
    - 부재 유형에 따른 모드 전환(자동계산/직접입력)과 필드 표시 규칙
    - 연속보 스팬·지점·랩 표, 데크 kφ/kx override
    - 웹 크리플링 11개 입력, IR / Cold Work / R / β 옵션
    - 접합부 7종 유형별 필드
    - 트리의 26개 포커스 내비게이션(경고·결과 → 입력 위치로 이동)

---
---

# 부록 (파일별 세부 대장)

아래는 파일을 나누어 정독한 원본 기록이다(행 번호는 커밋 `6540354` 기준). 본문과 다르면 본문이 우선이다. 특히 MCP 도구가 패널 없이 동작하는 수는 부록 A의 "전부 실패"가 아니라 "58개 실패, `custom_section_guide`만 동작"이 맞다.


---

## 부록 A — StcfsdPanel.ts (호스트 메시지·MCP 액션·HTML 빌더·.csd)

### (원제) Fork A — `src/webview/StcfsdPanel.ts` 전수 조사 초안 (3640행, 전체 정독)

표기: `P:nnn` = `src/webview/StcfsdPanel.ts` 행 번호. Python 메서드는 `PythonBridge.call(method, params)` (JSON-RPC over stdio, `src/bridge/PythonBridge.ts:141-155`)의 method 이름. `analyze()` → `'analyze'`, `getProperties()` → `'get_properties'` (`PythonBridge.ts:133-139`). `call()`은 params의 `action` 키를 제거하고 전달(`PythonBridge.ts:143-147`).
단위: 패널(호스트) 내부는 **항상 US 단위(in, ksi, kip, kip-in)**. 이 파일에는 SI↔US 변환 코드가 없다(변환은 webview `app.js`와 MCP `src/mcp/siUnits.ts` 담당). 유일한 단위 연산은 design_purlin의 kip-ft→kip-in `×12`(P:1940, 1963, 2010, 2047).

---

### 1. Webview → Host 메시지 (`_handleMessage`, P:215-389)

| command | payload (message.data) | 처리 위치 | Python 호출 | 회신 (host→webview) | TS측 로직 |
|---|---|---|---|---|---|
| `webviewReady` | 없음 | P:217 → `_initializeWithDefaultSection` P:162-197 | `generate_section`{section_type:'lippedc', params:{H:3.937,B:1.969,D:0.787,t:0.0906,r:0.157}} → `set_stress`(pure_bending, fy=35.53) 경유 `get_properties`+`stresgen` | `modelLoaded`(전체 model) | **있음**: 기본 단면 하드코딩(100×50×20×2.3, r=4mm, SGC400 Fy=35.53ksi), 기본 길이 50점 로그분포 10^0~10^3 in(P:186-193), m_all=[[1]]… **주의: webview가 재로드되어 webviewReady가 다시 오면 node/elem이 기본 단면으로 덮어써짐** |
| `runAnalysis` | `{prop?, lengths?, m_all?, BC?, neigs?, loadCase?, stressOpts?{type,fy,P,Mxx,Mzz}}` | P:222-248 → `_runAnalysis` P:392-453 | (stressOpts 있으면 `_applyStressToModel`: `get_properties`+`stresgen`) → `analyze` → `classify`{model,shapes} → `dsm`{node,elem,curve,fy,load_type,classifications} (해석 family 1종만) | `analysisStarted`(null), `analysisInvalidated`, `classifyResult`(분류배열), `analysisComplete`(result+`_meta`), `dsmResult`{P,Mxx,Mzz,load_family}; 실패 시 `analysisError`{error} + `showErrorMessage` | **있음**: node/elem은 호스트 모델 것을 쓰고 나머지만 병합(P:223-245); neigs 양의 정수 검증(P:231-239); 모델 서명(signature)으로 경합 결과 폐기(P:405, 432); load family 판별(P:939-946) |
| `setStress` | `{type:'uniform_compression'|'pure_bending'|'custom', fy, P?, Mxx?, Mzz?}` | P:250 → `handleMcpAction({action:'set_stress'})` P:1109 | `get_properties`, `stresgen` (pure_bending/custom) | `analysisInvalidated`, `modelLoaded` | **있음**: 응력 fy 정규화 스케일(P:583-589, 601-610), uniform은 TS에서 n[7]=fy 직접 대입(P:571-572), loadCase 추론(P:1112-1120, 923-928) |
| `getProperties` | `{node, elem}` | P:254 → `_getProperties` P:456-463 | `get_properties` | `propertiesResult`(props) / `propertiesError`{error} | 없음(webview가 보낸 node/elem 사용, 호스트 모델 미사용) |
| `updateModel` | 임의 부분 model 객체 | P:258-262 | 없음 | `analysisInvalidated`{reason:'Model updated', invalidateLoads:true} | 얕은 병합 `{...model, ...data}` — 검증 없음(MCP set_nodes 계열의 validator를 거치지 않음) |
| `invalidateDerivedResults` | `{scope?:'load'|...}` | P:264-270 | 없음 | 없음 | `_derivedInputRevision++`, load 결과·설계 결과 캐시 폐기 |
| `saveProject` | 없음 | P:272-276 | 없음 | `collectDesignData`(null) — webview가 설계탭 입력을 모아 `designDataCollected`로 회신 | 2단계 왕복 |
| `designDataCollected` | designInputs 객체(webview `designState.js`가 수집) | P:278-284 → `_saveProject` P:3495-3549 | `dsm`(현재 해석 family), `get_properties` | 없음 (`showInformationMessage`) | **있음**: .csd 조립(§5) |
| `openProject` | 없음 | P:286 → `_openProject` P:3552-3621 | 없음 | `modelLoaded`, `analysisComplete`, `dsmResult`, `analysisInvalidated`, `loadAnalysisComplete`, `designResult`, `propertiesResult`, `restoreDesignInputs` | 서명 비교로 저장된 해석결과 유효성 판정 |
| `showBucklingReport` | `{html}` (webview가 만든 좌굴 보고서 HTML, 캔버스 PNG data URI 포함) | P:290 → `_showBucklingReport` P:2485-2506 | 없음 | 별도 WebviewPanel `stcfsd.bucklingReport` 생성 | 보고서 HTML은 webview에서 생성, 호스트는 래핑만(P:2519-2534) |
| `saveReportPdf` | `{html}` (완결 HTML 문서) | P:294 → `_saveReportPdf` P:2536-2622 | 없음 | 없음 | **있음**: Edge/Chrome headless `--print-to-pdf` 스폰(P:2578-2586), 브라우저 탐색(P:2630-2652), PDF flush 폴링 500ms×10(P:2595-2614), 브라우저 없으면 HTML 폴백(P:2558-2567) |
| `generateTemplate` | `{section_type, params{H,B,D,t,r,qlip?...}}` (US 단위) | P:298 → `_generateTemplate` P:2673-2688 | `generate_section` | `analysisInvalidated`, `templateGenerated`(result{node,elem,...}) / `templateError` | sectionType 정규화(P:958-966), sectionParams/cornerRadius 저장. **MCP 경로(generate_template P:999)와 달리 응력 n[7]=fy 설정과 `modelLoaded` 전송을 하지 않음** |
| `applyStress` | stresgen 파라미터 `{node, props, loads}` | P:302 → `_applyStress` P:2691-2699 | `stresgen` | `analysisInvalidated`, `stressApplied`(result) / `stressError` | **호스트 `_model.node`를 갱신하지 않음** — webview가 결과를 받아 `updateModel`로 다시 보내야 반영 |
| `classifyModes` | `{GBTcon?}` | P:306 → `_classifyModes` P:2655-2670 | `classify`{model, shapes, GBTcon} | `classifyResult` / `classifyError`(한국어 오류 "해석 결과가 없습니다…") | `_lastAnalysisResult` 존재만 검사(서명 current 검사 없음 — MCP `classify` P:1350과 다름) |
| `runPlastic` | `{node, elem, fy}` | P:310 → `_runPlastic` P:2465-2472 | `plastic` | `plasticResult` / `plasticError` | webview 데이터 사용 |
| `runVibration` | 없음 | P:314 → `_runVibration` P:2474-2481 → `handleMcpAction({action:'vibration', rho:1.0})` | `vibration`{node,elem,prop,lengths,BC,m_all,rho} | `vibrationResult` / `vibrationError` | rho 1.0 고정 |
| `runLapConnection` | lap 입력 객체(그대로 전달) | P:318-325 | `lap_connection` | `lapConnectionResult`(result 또는 {error}) | 없음 |
| `runConnection` | 단일 접합부 입력 `{type,t1,t2,d,n,Fy,Fu,...}` | P:327-337 | `design_connection` | `connectionResult`{request, ...request, ...result} | 요청 입력을 결과에 병합(SVG 도면용, P:330-333) |
| `runDesign` | 설계 입력 `{member_type, design_method, Fy, Fu, Lb, Cb, KxLx..., Mu, Vu, P, ...}` | P:339-345 → `aisi_design` 케이스 P:1385-1632 | `get_properties`, `cutwp`, (필요시) `dsm`×2, `aisi_design` | `designResult`(result 또는 {error}) | **대량 TS 로직** (§3 aisi_design) |
| `prepareDesignDsm` | `{fy|Fy, member_type}` | P:347-354 → P:1216-1274 | 가상 하중케이스별 `get_properties`+`stresgen`(휨) → `analyze` → `classify` → `dsm` | `designDsmPrepared`{success, member_type, load_cases, dsm{P?,Mxx?}, message} / {error} | **있음**: 부재유형→필요 family 매핑(P:1223-1229), 임시 모델 복제로 현재 해석뷰 보존 |
| `analyzeLoads` | 하중 입력 `{member_app, span_type, spans, laps, loads{D,Lr,S,Wu,Wp,L,Fy,...}, deck, design_method,...}` | P:356-363 → P:1649-1655 | `analyze_loads` | `loadAnalysisComplete`(result 또는 {error}) | 입력 revision 검사 후 `_lastLoadAnalysis` 저장 |
| `treeUpdate` | 임의 extra 필드 | P:365-368 → `_updateTreeView` P:200-212 | 없음 | 없음 (사이드바 트리 갱신) | 없음 |
| `sectionPreviewResult` | `{png_base64}` (SVG→PNG 캡처 결과) | P:370-386 | 없음 | 없음 | base64 → `%TEMP%/cufsm_section_preview.png` 저장, 대기 중 Promise resolve (MCP `capture_section_preview`용) |

총 23종 (P:217-370).

### 2. Host → Webview 메시지 (`_postMessage` P:2702-2712 → `webview.postMessage({command, data})`)

`_disposed`면 전송 생략(P:2709). 테스트 모드면 최근 100개 기록(P:2703-2708).

| command | payload | 발신 위치 |
|---|---|---|
| `showSection` | `{sectionId}` | P:105 (트리/명령에서 호출, `extension.ts:82,92,134,141`) |
| `modelLoaded` | 전체 `StcfsdModel`(node,elem,prop,lengths,m_all,BC,springs,constraints,GBTcon,neigs,loadCase,loadFy,sectionType,sectionParams,cornerRadius) | P:195, 1014, 1040, 1047, 1078, 1105, 1122, 1296, 1807, 2106, 2125, 2157, 2174, 2183, 2207, 2222, 2242, 2261, 2296, 2327, 2347, 2365, 2455, 3576 |
| `analysisStarted` | null | P:393 |
| `analysisComplete` | FSM result{curve, shapes, n_lengths, ..., classifications?, `_meta`{load_type, load_family, fy, signature, timestamp}} | P:411, 1158, 2135, 3584 |
| `analysisError` | `{error}` | P:233, 450 |
| `analysisInvalidated` | `{reason, invalidateLoads}` | P:695 (`_invalidateAnalysisState` — 모든 모델 변경에서 호출), P:3590 |
| `classifyResult` | 분류 결과 배열(길이×모드별 G/D/L/O %) | P:409, 1156, 1358, 2666 |
| `classifyError` | `{error}` | P:2658, 2668 |
| `dsmResult` | `{P, Mxx, Mzz, load_family}` (각 항목: `{crl, crd, P_y, Lcrl, Lcrd, classification_method, local_detected, dist_detected, ...}` 또는 null) | P:433, 1170, 3586 |
| `propertiesResult` / `propertiesError` | props(A, Ixx, Izz, Ixz, xcg, zcg, Sx, Sz, rx, rz, J, Cw…) / `{error}` | P:459/461, 3612 |
| `templateGenerated` / `templateError` | generate_section 결과 / `{error}` | P:2684 / 2686 |
| `stressApplied` / `stressError` | stresgen 결과 / `{error}` | P:2695 / 2697 |
| `plasticResult` / `plasticError` | plastic 결과 / `{error}` | P:1380, 2468 / 2470 |
| `vibrationResult` / `vibrationError` | vibration 결과 / `{error}` | P:2477 / 2479 (GUI 경로만; MCP `vibration`은 GUI로 push하지 않음) |
| `lapConnectionResult` | lap 결과 / `{error}` | P:321, 323, 1310 |
| `connectionResult` | `{request, ...request, ...result}` (GUI) / result만 (MCP, P:1320) | P:333, 335, 1320 |
| `designResult` | aisi_design 결과(+dsm_warning) / `{error, member_type?}` | P:343, 1389, 1399, 1630, 3607 |
| `designPurlinResult` | `{load_analysis, dsm_positive, dsm_negative, design_positive, design_negative, design_lap, design_uplift, uplift_R, props, cutwp, deck, span_type}` | P:2085 (MCP `design_purlin` 전용) |
| `designDsmPrepared` | prepare_design_dsm 결과 / `{error}` | P:350, 352 |
| `loadAnalysisComplete` | analyze_loads 결과 / `{error}` | P:359, 361, 3604 (MCP `analyze_loads`는 push 안 함) |
| `collectDesignData` | null | P:274 |
| `restoreDesignInputs` | 저장된 designInputs | P:3617 |
| `captureSection` | null | P:1737 |

총 28종. `webview/js/app.js:237-400` 메시지 스위치가 위 28종을 모두 처리함(grep 확인).

별도 패널 `stcfsd.bucklingReport`(P:2492-2505): webview→host `savePdf` 1종(P:2501), 인라인 스크립트(P:2532)가 `acquireVsCodeApi()` 사용.

### 3. MCP 브리지 명령 (`handleMcpAction` P:995-2462)

#### 도착 경로
`src/mcp/bridge.ts`: 확장 호스트 안에서 `http.createServer`가 `127.0.0.1:52790`(기본) 리슨(bridge.ts:20, 76). `GET /status` → `panel.getStatus()`(bridge.ts:35-41), `POST /action` body JSON → `panel.handleMcpAction(body)`(bridge.ts:42-49), 응답은 HTTP 200 + JSON(NaN/Infinity→null, bridge.ts:100-104). 패널 조회 함수는 `() => StcfsdPanel.currentPanel`(extension.ts:45). **패널이 없으면 모든 명령이 `{error:'No active CUFSM panel. Open Section Designer first.'}`** (bridge.ts:37-38, 45-46). 즉 **모델이 패널 인스턴스(`this._model`)에 있으므로 MCP 59개 도구 전부가 패널 열림을 필요로 한다** (계산 전용 도구 — steel_grades, aisi_guide, shear_lag 등 — 도 예외 없음). MCP 서버 프로세스(stdio, `media/mcp-server.js`)는 이 HTTP 엔드포인트로 POST만 한다.

#### 명령별 표 ("GUI push" = 처리 후 webview에 보내는 메시지; "웹뷰 왕복" = webview 응답이 있어야 완료)

| action | 행 | Python | GUI push | 웹뷰 왕복 | TS측 로직 / 비고 |
|---|---|---|---|---|---|
| `generate_template` | 999-1018 | `generate_section` | analysisInvalidated, `modelLoaded`, 트리 | 아니오 | sectionType/Params/cornerRadius 저장, 모든 절점 n[7]=loadFy(기본 35.53) 균일 응력, 하중 캐시까지 무효화 |
| `set_material` | 1020-1042 | — | modelLoaded | 아니오 | E>0, -1<v<0.5, G 미지정 시 E/2(1+v) 계산; prop=[[100,E,E,v,v,G]] (등방성만) |
| `set_bc` | 1044-1050 | — | modelLoaded | 아니오 | BC 문자열 검증 없음 |
| `set_lengths` | 1052-1081 | — | modelLoaded | 아니오 | min>0, max≥min, 1≤n≤10000 검증; **로그 등간격 생성 TS**; m_all=[[1]] 초기화 |
| `set_load_case` | 1083-1107 | `get_properties`, `stresgen` | modelLoaded | 아니오 | load_case→응력옵션 매핑(P:623-644), custom은 원 하중으로 응력 생성 후 family 추론(P:1092-1097) |
| `set_stress` | 1109-1124 | `get_properties`, `stresgen` | modelLoaded | 아니오 | §1 setStress와 동일 |
| `run_analysis` | 1126-1177 | `analyze`, `classify`, `dsm` | classifyResult, `analysisComplete`, `dsmResult` | 아니오 | neigs 1..50 및 자유도×m항 상한 검증(P:1127-1142, TS에서 자유 DOF 계수); 반환에 dsm_P/Mxx/Mzz, neigs_requested/actual |
| `get_dsm` | 1179-1214 | `dsm` (Cb, section_type, KxLx/KyLy/KtLt 또는 Lb 전달) | 없음 | 아니오 | 요청 family = 해석 family 강제(P:1190-1198) |
| `prepare_design_dsm` | 1216-1274 | `get_properties`,`stresgen`,`analyze`,`classify`,`dsm` (family별) | 없음(GUI 경로는 P:350에서 `designDsmPrepared`) | 아니오 | 설계 DSM 캐시(`_preparedDesignDsm`)를 응력 제외 서명으로 관리(P:552-563) |
| `get_properties` | 1276-1278 | `get_properties` | 없음 | 아니오 | |
| `get_nodes` / `get_elements` | 1280-1286 | — | 없음 | 아니오 | |
| `doubler` | 1288-1300 | `doubler` | modelLoaded | 아니오 | (MCP 도구 `double_mesh`) |
| `cutwp` | 1302-1306 | `cutwp` | 없음 | 아니오 | |
| `lap_connection` | 1308-1312 | `lap_connection` | `lapConnectionResult` | 아니오 | |
| `check_lap_length` | 1314-1316 | `check_lap_length` | 없음 | 아니오 | |
| `design_connection` | 1318-1322 | `design_connection` | `connectionResult`(요청 병합 없음 → GUI SVG가 입력치수를 못 그릴 수 있음) | 아니오 | |
| `shear_lag`/`block_shear`/`cold_work`/`flange_curling` | 1324-1347 | 동명 메서드 | 없음 | 아니오 | 함수별 인자 allowlist(P:1329-1337), 미허용 키는 오류 |
| `classify` | 1349-1360 | `classify` | classifyResult | 아니오 | current 해석 필요 |
| `vibration` | 1363-1372 | `vibration` (rho 기본 1.0) | 없음(MCP) | 아니오 | |
| `plastic` | 1375-1382 | `plastic` (fy 기본 35.53) | `plasticResult` | 아니오 | |
| `aisi_design` | 1385-1632 | `get_properties`, `cutwp`, `dsm`(P/Mxx, 조건부), `aisi_design` | `designResult` | 아니오 | **아래 상세** |
| `aisi_guide` | 1634-1637 | `aisi_guide` | 없음 | 아니오 | |
| `steel_grades` | 1639-1642 | `steel_grades` | 없음 | 아니오 | |
| `web_crippling` | 1644-1647 | `web_crippling` | 없음 | 아니오 | |
| `analyze_loads` | 1649-1655 | `analyze_loads` | **없음** (GUI 경로만 P:359에서 push) | 아니오 | `_lastLoadAnalysis` 갱신 |
| `generate_report` | 1657-1731 | `get_properties`, `cutwp`, `dsm`, (선택)`analyze_loads`, (캐시 불일치 시) 재귀 `aisi_design` | 없음 | 아니오 | **보고서 "데이터 묶음(JSON)"만 반환** — GUI의 HTML 계산서(app.js Report 탭)와 별개. 포함: timestamp, model_summary(getStatus), section_props, cutwp_props, dsm_basis, dsm_P/Mxx/Mzz, curve_length, analysis_meta, prepared_design_dsm, load_analysis, design_result, design_cache_hit. `_designCacheMatches`(P:700-713)로 캐시 재사용 판단 |
| `capture_section_preview` | 1733-1749 | — | `captureSection` | **예** — webview가 SVG→PNG 후 `sectionPreviewResult` 회신(P:370-386); 5초 타임아웃(P:1739-1744) | `%TEMP%/cufsm_section_preview.png` 경로 반환. webview가 숨김이어도 `retainContextWhenHidden:true`(P:67)라 동작 |
| `calc_deck_stiffness` | 1751-1754 | `calc_deck_stiffness` | 없음 | 아니오 | |
| `validate_design` | 1756-1797 | `get_properties`, `cutwp`, `dsm` | 없음 | 아니오 | **검증 "데이터 수집"만** (checks:[] 빈 배열로 반환, P:1758). 실제 검증 규칙(대시보드)은 webview app.js Validation 섹션에 있음 → MCP에는 GUI 검증 판정이 없음 |
| `apply_deck_springs` | 1799-1810 | — | modelLoaded | 아니오 | `_deckSpringsForFlange`(P:776-790): 상/하부 플랜지 극단 z 절점 전체에 kφ,kx 균등분배, 10열 spring 행 [#, nodei, 0, ku, 0, 0, kq, 0, 0, 0] **TS 계산** |
| `design_purlin` | 1812-2087 | `analyze_loads`, `get_properties`/`stresgen`×2, `analyze`×2, `classify`×2, `dsm`×2, `get_properties`, `cutwp`, `aisi_design` 최대 4회 | `designPurlinResult` | 아니오 | **대량 TS 설계 오케스트레이션** (아래) |
| `save_project` | 2090-2094 | — | 없음 | 아니오 | **`this._model`만 JSON으로 기록** (GUI .csd v1.2 래퍼·해석결과·설계입력 없음); `fs.writeFileSync(options.filepath)` 임의 경로 |
| `load_project` | 2096-2109 | — | modelLoaded | 아니오 | 원시 model 또는 `.csd`의 `{model}` 둘 다 허용; **해석결과·하중·설계 입력(designInputs) 복원 안 함**(GUI `_openProject`와 다름) |
| `signature_ss` | 2112-2137 | `analyze` | modelLoaded, analysisComplete | 아니오 | BC='S-S' 강제, 길이 100점 1~1000 in 고정(TS), classify·dsm 미실행(GUI로 classifyResult/dsmResult 없음) |
| `set_node_stress` | 2140-2159 | — | modelLoaded | 아니오 | 유효 id만 갱신, invalid_ids 보고 |
| `get_curve` | 2162-2167 | — | 없음 | 아니오 | current 해석 필요 |
| `set_springs` / `set_constraints` | 2170-2185 | — | modelLoaded | 아니오 | 행 검증 없음 |
| `set_nodes` | 2188-2213 | — | modelLoaded | 아니오 | 8열/ID=위치/유한/DOF 0·1 검증(P:869-889), 요소와 교차검증(P:892-907), elements 동시교체 가능 |
| `set_elements` | 2216-2228 | — | modelLoaded | 아니오 | 5열, 끝점·두께·0길이 검증 |
| `add_node` / `add_element` | 2231-2267 | — | modelLoaded | 아니오 | DOF 1111 고정, matnum=prop[0][0] |
| `modify_node` | 2270-2301 | — | modelLoaded | 아니오 | 이동 후 연결요소 0길이 검사(P:2277-2290) |
| `delete_node` | 2304-2330 | — | modelLoaded | 아니오 | 연결요소 삭제+절점/요소 번호 재부여 **TS** |
| `modify_element` / `delete_element` | 2333-2368 | — | modelLoaded | 아니오 | |
| `energy_recovery` | 2371-2409 | `energy_recovery` | 없음 | 아니오 | shapes에서 mode 벡터 추출·인덱스 검증 TS |
| `get_full_state` | 2412-2440 | — | 없음 | 아니오 | getStatus + **곡선 극소점 탐색 TS**(P:2426-2431) |
| `set_gbtcon` | 2443-2457 | — | modelLoaded | 아니오 | GBTcon{ospace,norm,couple,orth,glob,dist,local,other} |
| default | 2459-2460 | | | | `{error:'Unknown action'}` |

`getStatus()` (P:466-521, `GET /status`): nnodes, nelems, BC, nlengths, hasModel, hasAnalysis, analysisStale, section{width,height,xRange,zRange}(TS bbox), material{E,v,G}, stress{min,max}, lengths{min,max,n}, GBTcon, nsprings, nconstraints.

#### `aisi_design` 상세 (P:1385-1632) — TS에 있는 설계 전처리
1. `member_type==='connection'`이면 바로 Python 호출(P:1387-1391).
2. 단면 없으면 오류(P:1394-1401).
3. 서명·입력 revision 스냅샷(P:1403-1404) → 끝에서 변경 시 결과 폐기(P:1622-1623).
4. `get_properties` + `cutwp` 병합(P:1407-1445): rx, ry, xo(=cutwp.xo 또는 Xs−xcg), ro=√(rx²+ry²+xo²) fallback, NaN 방어 `safeNum`, Python 이름 매핑 Sf/Sxx←Sx, Sy/Szz←Sz, ry←rz.
5. DSM 값 결정(P:1449-1522): ① prepared 캐시가 현재 모델/Fy와 일치하면 사용 → ② current 해석 없으면 경고문 → ③ current 해석 family가 P/Mxx면 `dsm` 재호출; 불일치 family/극소점 없음 경고문 생성(영문+한국어 "해석 실행" 혼용).
6. 단면 기하 추정(P:1524-1593): depth, flange_width(유형별 Hat/Track=전폭, Z=전폭/2), thickness, type, qlip, `_estimateWebCount`(P:968-992, dz≥0.35·depth 이고 dx≤0.9dz인 요소 수), family_hint(hat/built_up_i/Z/C/multi_web), lip_depth(xMin 근처 하단 15% 절점 z범위 휴리스틱, sectionParams.D 우선), R_corner.
7. through_fastened = springs 존재 여부(P:1596-1597).
8. 평판 폭 계산(P:1599-1608): h_web = depth−2(r+t), b_flange = B−(립有 2:1)(r+t), d_lip = D−(r+t).
9. `aisi_design` 호출, `dsm_warning` 첨부, 성공 시 `_lastDesignRequest/_lastDesignResult` 캐시.

#### `design_purlin` 상세 (P:1812-2087) — 퍼린 전체 워크플로를 TS가 오케스트레이션
Step1 `analyze_loads` → Step2 deck{kphi,kx} → Step3 정모멘트 모델(bending_xx_pos + 상부 플랜지 데크 스프링) `analyze`/`classify`/`dsm` → Step4 부모멘트 모델(스프링 없음, bending_xx_neg) 동일 → Step5 props/cutwp → Step6 영역별 설계: Fu 기본 Fy×1.34(P:1871), posRegion/negRegion(Ly_in, Cb 기본 1.0/1.67), gravity locations에서 정 Mu·Vu 최대, 지점/“Lap end” 위치 구분해 부 Mu(P:1913-1931); 6a 정모멘트 `aisi_design`, 6b 부모멘트, 6c **Lap 구간 강도 = 단일 Mnl×2 합산·이용률·pass를 TS에서 계산**(P:1983-2028, 반올림 포함), 6d 양력(uplift_bracing, R_uplift)(P:2031-2063). 결과는 `_lastLoadAnalysis`, `_lastDesignResult`에 저장, `_lastDesignRequest=null`.
→ GUI의 하중탭·설계탭은 이 경로를 쓰지 않음(GUI는 `analyzeLoads`→`runDesign`을 따로 호출). **GUI 버튼 없이 MCP 전용 복합 기능** (결과만 `designPurlinResult`로 GUI에 표시).

### 4. HTML 빌더 (`_getHtmlForWebview` P:2715-3492)

#### 로딩/보안
- `<html lang="ko">`(P:2733), 제목 "StCFSD Section Designer".
- CSP(P:2736-2742): `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-…' 'unsafe-eval'; img-src ${cspSource} data: blob:; font-src ${cspSource}`. nonce = 32자 랜덤(P:3633-3640). `'unsafe-eval'`은 three.js 번들 때문으로 추정.
- `asWebviewUri` 리소스 6개: `webview/css/theme.css`(P:2719), `webview/js/designState.js`(2722), `webview/js/utils.js`(2725), `webview/js/app.js`(2728), `webview/js/charts/modeShape3D.js`(3485, defer), `media/viewer3d.js`(3488, defer). 로드 순서: designState → utils → app → (defer) modeShape3D → viewer3d. (viewer3d.js가 동적으로 `viewer3d.mode-shape-renderer.js` 청크를 불러오는 것으로 보임 — fork 범위 밖.)
- `localResourceRoots`: `media`, `webview`(P:68-71). `enableScripts`, `retainContextWhenHidden:true`(P:66-67).
- 인라인 `<script>` 없음(메인 패널). 인라인 `style="..."` 속성 223개(HTML 범위). 
- `--vscode-*` CSS 변수: HTML 본문 19회 (panel-border, descriptionForeground, editor-background, editor-selectionBackground, editorWarning-foreground); 파일 전체 28회(버클링 보고서 래퍼 P:2523-2528 포함: font-family, editor-foreground, editor-background, foreground, panel-border, button-background/foreground). 대부분 fallback 없음 → 일반 브라우저에서는 투명/기본값이 됨.
- `id="` 225개(HTML 범위 P:2732-3491; 파일 전체 226 — P:2530 `btn-pdf`). `<input>` 83, `<select>` 19, `<button>` 26, `<canvas>` 5, `<svg>` 2.
- UI 문자열 언어: **한국어 주, 영어 병기**(예 "단면 입력 (Section Input)"). 단위 라벨은 `<span data-unit="length|thickness|radius|stress|force|moment|pressure|length_ft|rotStiff|latStiff">`로 표시되고 초기값은 SI(mm, MPa, kN, kN-m, kPa, m). 접합부 탭은 `class="conn-unit-*"` 별도 체계. 호스트 오류 메시지는 영어(일부 한국어 혼용).

#### 상단 탭 바 (P:2749-2761)
순서: `preprocessor` "① 단면·재료" | `loads` "② 하중계산" | 구분선 | `design` "③ 좌굴해석·부재설계" | `connection` "④ 접합부" | 구분선 | `report` "보고서" | `validation` "검증" | (오른쪽) `btn-file-open` "Open", `btn-file-save` "Save".
(주석 P:2748은 "[좌굴해석 ①②③] | [부재설계 ④⑤] | [출력]"이라 하나 실제 탭 번호는 ①~④ — 이전 구조의 흔적.)

#### ① 단면·재료 `tab-preprocessor` (P:2766-2866)
- 단위계 토글: `btn-unit-US` "US (ksi, in)", `btn-unit-SI` "SI (MPa, mm)" (SI가 초기 active, P:2769-2770).
- 좌측 `panel-left`:
  - 단면 템플릿 `select-template`: ""(직접 입력), `lippedc`(기본 selected), `lippedz`, `track`, `hat`, `rhs`, `chs`, `angle`, `isect`, `tee`, `lipped_angle`. 버튼 `btn-generate-template` "단면 생성".
  - `template-params`: `tpl-H`=100 mm, `tpl-B`=50 mm, `tpl-D`=20 mm, `tpl-t`=2.3 mm, `tpl-r`=4 mm, `tpl-qlip`=90° (그룹 `tpl-qlip-group` 숨김, 0~180).
  - 재료: `input-steel-grade` (""Manual, `SGC400` selected 245/400 MPa, `SGC440` 295/440, `SGC490` 365/490, `SGC570` 560/570, `A653-33` 33/45 ksi, `A653-50` 50/65, `A653-80` 80/82); `input-fy`=245 MPa, `input-fu`=400, `input-E`=203395, `input-v`=0.3, `input-G`=77911; `chk-cold-work` §A3.3.2 냉간가공(기본 checked). 힌트: "여기서 설정한 Fy/Fu가 … 전체에 적용됩니다 (단일 소스)".
    - 주의: HTML 기본 E=203395 MPa(=29500 ksi), MCP 지시문은 203000 MPa로 표기.
  - 절점 표 `node-table`(# x z stress), 버튼 `btn-add-node` "+ 추가", 컨테이너 `node-table-container`.
  - 요소 표 `elem-table`(# ni nj t), `btn-add-elem`, `elem-table-container`.
- 우측 `panel-right`: `section-preview` > `section-svg`(viewBox -1 -1 12 12), `section-props`(성질 표시).

#### ② 하중계산 `tab-loads` (P:2869-3028)
- 안내문 + `loads-tab-hint`(직접입력 모드 경고, 숨김).
- 부재 유형 `select-member-type`: [적용(자동 계산)] `roof-purlin`(기본=첫 항목), `floor-joist`, `wall-girt`, `wall-stud`; [일반(직접 입력)] `flexure`, `compression`, `combined`, `tension`. 배지 `member-mode-badge`.
- `calc-mode-section`(자동 계산 모드에서만 표시, 기본 숨김):
  - "부재 구성"(collapsible): `select-span-type`(`simple`, `cantilever`, `cont-2`, `cont-3` selected, `cont-4`, `cont-n`), `config-n-spans`=5(2~20, cont-n일 때), `config-spacing`=1.0 m(간격). 표 `span-config-table`/`span-config-tbody`(#, 지점 P/R/F/N, 스팬 m, 랩L m, 랩R m — JS 동적 생성), `span-table-container`.
  - "데크 & 가새": `select-deck-type`(`through-fastened`, `standing-seam`, `none` selected), `deck-detail-row`: `deck-t-panel`=0.5 mm, `deck-fastener-spacing`=300 mm; `deck-kphi-override`(빈값=auto, kN-m/rad/m), `deck-kx-override`(auto, kN/m/m).
  - "사용하중 입력"(미계수 면압 kPa): `load-D-psf`=0.3, `load-Lr-psf`=1.0, `load-S-psf`=0.5, `load-Wu-psf`=1.0(↑양력), `load-Wp-psf`=0(↓), `load-L-psf`=0(행 `load-L-row` 숨김); 각 옆에 선하중 환산 표시 `load-*-plf`. 행 id: `load-Lr-row`, `load-S-row`, `load-W-row`, `load-Wp-row`, `load-L-row`. (id는 psf/plf지만 SI 기본값.)
  - 버튼 `btn-analyze-loads` "하중 분석 실행".
- "소요강도" (항상 표시): `design-P`(Pu kN)=0, `design-V`(Vu kN)=0, `design-Mx-pos`(Mu(+) kN-m)=0, `design-Mx`(Mu(-))=0, `design-My`(Muy)=0, `design-May-strength`(May 약축 가용강도 직접입력)=0. **설계탭 입력이 하중탭에 있음** (id 접두사 design-).
- 우측: `load-analysis-section`(숨김) > `load-analysis-result`(결과 HTML).

#### ③ 좌굴해석·부재설계 `tab-design` (P:3031-3384)
- 스텝 표시 `design-step-indicator`: 1 입력 / `step-line-12` / 2 하중 분석(`step-item-2`) / `step-line-23` / 3 설계 검토.
- 상태 배지 `design-dsm-status`: 초기 "FSM 좌굴값 없음 — 아래 'A. 좌굴해석' 섹션에서 해석을 실행하세요".
- **A. 좌굴해석 (FSM)** `sec-fsm`/`sec-fsm-body` (펼침):
  - 하중 케이스 `select-load-case`: `compression`(selected), `bending_xx_pos`, `bending_xx_neg`, `bending_zz_pos`, `bending_zz_neg`, `custom`; `analysis-fy-display` "Fy: 245 MPa"; `custom-load-inputs`(숨김): `input-load-P`=0 kN, `input-load-Mxx`=0 kN-m, `input-load-Mzz`=0.
  - 경계조건 `select-bc`: `S-S`(selected), `C-C`, `S-C`, `C-F`, `C-G`.
  - 반파장 범위: `input-len-min`=10 mm, `input-len-max`=10000 mm, `input-len-n`=60 (상세 한국어 가이드 P:3088-3090). (호스트 기본값은 1~1000 in 50점 — UI와 다름.)
  - 고유치 수 `input-neigs`=10.
  - cFSM: `chk-cfsm-enable`, `chk-cfsm-G`, `chk-cfsm-D`, `chk-cfsm-L`, `chk-cfsm-O` (모두 checked).
  - 버튼 `btn-run-analysis` "해석 실행", `btn-view-buckling-report` "좌굴해석 결과 보고서".
  - 우측 응력 프리뷰 `stress-preview` > `stress-preview-svg`(190×220), 범례 `stress-legend`(압축 #ef5350 / 인장 #42a5f5).
  - 상태줄 `analysis-status`.
- **B. 좌굴해석 결과** `sec-fsm-res`/`sec-fsm-res-body` (기본 접힘, display:none):
  - `dsm-results` > `dsm-table-container`(DSM 설계값 표).
  - 좌: `buckling-curve-canvas`(700×400, 좌굴곡선), "모드 분류" `btn-run-classify` + `classify-curve-canvas`(700×200, G/D/L/O 누적), 소성 P-M 곡면: `plastic-fy`=245 MPa + `btn-run-plastic` "곡면 생성" + `plastic-surface-canvas`(700×420), 자유진동 `btn-run-vibration` + `vibration-result`.
  - 우: `mode-shape-container`: `select-length`, `select-mode`, `mode-shape-canvas`(600×340, 2D); `mode-shape-3d-canvas`(600×400, 3D, 드래그 회전/스크롤 확대).
- **C. 부재 설계** `sec-member-design`/`sec-member-design-body` (펼침):
  - 재료(읽기전용) `sec-material`/`sec-material-body`: `design-fy`=245, `design-fu`=400 (readonly, ①탭에서 설정).
  - 설계 방법 `sec-method`/`sec-method-body`: `select-design-method` (`LRFD`, `ASD`), "해석법: DSM".
  - `design-membertype-echo`(②탭 부재유형 에코).
  - 좌굴 길이 `design-lengths-title`: `design-KxLx`=3000 mm, `design-KyLy`=3000, `design-KtLt`=3000 (행 `design-KxLx-row`, `design-KtLt-row`); 정모멘트 `design-Cb-pos`=1.0 (+`design-Cb-pos-calc`), `design-Lb-pos`=0 mm (+`design-Lb-pos-calc` "데크 구속 시 0"); 부모멘트 `design-Cb`=1.0 (+`design-Cb-calc`), `design-Lb`=3000 mm (+`design-Lb-calc`). 행 id `design-Cb-pos-row`, `design-Lb-pos-row`, `design-Cb-row`, `design-Lb-row`.
  - §2.3.3.3 β: `chk-beta-dist`(checked), `design-beta-inputs`: `design-dist-M1M2`=0, `design-dist-Lm`=0 mm, `design-beta-result`. 행 `design-beta-row`.
  - `design-Cm-row`(숨김): `design-Cmx`=1.00, `design-Cmy`=1.00.
  - 웹 크리플링 `design-wc-section`(숨김): `design-wc-N`=89 mm, `design-wc-R`=4.8 mm, `design-wc-support`(EOF/IOF/ETF/ITF), `design-wc-fastened`(fastened/unfastened), `design-wc-web-config`(single/nested_z/multi_web), `design-wc-family`(auto/built_up_i/C/Z/hat/multi_web), `design-wc-flange-condition`(stiffened/unstiffened), `design-wc-Lo`=0, `design-wc-edge-distance`=0, `design-wc-nwebs`=1, `design-wc-fastener-spacing`=0.
  - 고급 옵션: `chk-inelastic-reserve` §F2.4.2(미체크), `cold-work-notice`/`cold-work-status`(①탭 설정 에코), `chk-r-factor` §I6.2.1 + `select-r-value`(0 미적용, 0.70, 0.65, 0.50, 0.40, 0.60 selected — C continuous, 0.70 — Z continuous; **value "0.70" 중복 2개**).
  - `design-validation`(role=alert, 숨김), 버튼 `btn-run-design` "▶ 설계 검토 실행".
  - 우측: `design-loading`(스피너), `design-summary`, `design-steps`(단계별 계산, max-height 450), `design-interaction-title`/`design-interaction`(H1.2 조합, 숨김), `design-reference`(규준 참조), `btn-copy-report` "보고서 클립보드 복사"(숨김).

#### ④ 접합부 `tab-connection` (P:3387-3455)
- 접이식 헤더 `.conn-collapsible`/`.conn-collapse-body`(id 없음, CSP 호환 토글).
- Lap Splice(§I6.2.1, §J3, §J4): `conn-lap-left`=305, `conn-lap-right`=305 (길이; 단위 `conn-unit-length`), `conn-Mu`=0(모멘트), `conn-Vu`=0(힘), `conn-fastener-type`(screw selected/bolt), `conn-fastener-dia`=4.8, `conn-n-rows`=2(1~4), `conn-edge-dist`=0(0=자동 1.5d). 버튼 `btn-run-lap-design` "Lap 접합부 설계".
- 단일 접합부(Chapter J 7종): `conn-single-type` (기계적: `screw` §J4, `bolt` §J3, `paf` §J5; 용접: `fillet_weld` §J2.5, `arc_spot` §J2.2, `arc_seam` §J2.3, `groove` §J2.1/J2.6), `conn-single-hint`; `conn-t1`=1.5, `conn-t2`=1.5, `conn-d`=4.8, `conn-n`=4, `conn-Fy`=245, `conn-Fu`=400 ("전처리 재료와 자동 동기화"), `conn-weld-row`(숨김): `conn-weld-L`=50, `conn-weld-size`=3; `conn-groove-row`: `conn-groove-type`(complete CJP / partial PJP); `conn-bolt-row`: `conn-Fub`=827 (+`conn-Fub-hint`); `conn-paf-row`: `conn-Fuf`=827; `conn-Pu`=0. 버튼 `btn-run-single-conn` "접합부 강도 계산".
- 우측 결과 `connection-result`.

#### 보고서 `tab-report` (P:3458-3466)
`btn-generate-report` "상세 보고서 생성", `btn-print-report` "PDF 저장"(숨김→생성 후 표시), `report-container`(보고서 HTML 렌더 영역). 안내: "먼저 설계 검토를 실행한 후 …".

#### 검증 `tab-validation` (P:3469-3477)
`btn-run-validation` "설계 검증 실행", `validation-summary-badge`, `validation-container`.

#### 버튼 전체 (26): btn-file-open, btn-file-save, btn-unit-US, btn-unit-SI, btn-generate-template, btn-add-node, btn-add-elem, btn-analyze-loads, btn-run-analysis, btn-view-buckling-report, btn-run-classify, btn-run-plastic, btn-run-vibration, btn-run-design, btn-copy-report, btn-run-lap-design, btn-run-single-conn, btn-generate-report, btn-print-report, btn-run-validation + 탭 버튼 6 (id 없음, data-tab).

### 5. 상태 소유 (패널 클래스)

필드(P:23-45): `currentPanel`(static 싱글턴), `_panel`, `_extensionUri`, `_pythonBridge`, `_treeProvider`, `_disposed`, `_currentSection`, **`_model: StcfsdModel`**(정본 모델), `_lastAnalysisResult`(FSM 결과+`_meta`+classifications), `_lastLoadAnalysis`, `_lastDesignResult`, `_lastDesignRequest`, `_preparedDesignDsm`, `_preparedDesignDsmSig`, `_derivedInputRevision`, `_lastPreviewPath`, `_previewResolve`, `_testPostedMessages`, `_bucklingReportPanel`, `_bucklingReportHtml`.

- **정본 모델은 호스트 패널 인스턴스 메모리**. webview는 `modelLoaded`로 사본을 받고 `updateModel`/`runAnalysis`/`setStress` 등으로 변경을 다시 보냄. 설계/하중/접합부 **입력값은 webview DOM에만** 있고 호스트에는 저장 시(`designDataCollected`)에만 넘어옴. Python 프로세스는 무상태 계산기.
- 신선도(staleness) 관리: `_modelSignature`(P:530-546) = prop,node,elem,lengths,springs,constraints,BC,m_all,GBTcon,neigs,loadCase,loadFy의 JSON. 모든 결과 조회는 `_isAnalysisCurrent`(P:762-768)로 서명 비교. 모든 모델 변경은 `_invalidateAnalysisState`(P:686-697)로 캐시 폐기+`analysisInvalidated` push+트리 갱신. 장기 연산은 시작 시 서명·`_derivedInputRevision`을 잡고 끝에 다르면 결과 폐기(P:715-725).
- GUI–MCP 동기화: 둘 다 같은 `_model`을 직접 변경 → 변경 후 `modelLoaded`(전체 모델) push. 하지만 webview 쪽 입력 위젯(하중케이스 select, BC select, 길이 입력 등)이 modelLoaded로 갱신되는지는 app.js 의존(범위 밖). MCP가 push하지 않는 결과: `analyze_loads`, `vibration`, `get_dsm`, `prepare_design_dsm`, `generate_report`, `validate_design`, `check_lap_length`, `web_crippling`, `calc_deck_stiffness`, `energy_recovery`, `cutwp`, shear_lag 등 → GUI에 보이지 않음.
- **패널 dispose(P:3623-3630)**: `currentPanel=undefined`, `_disposed=true`, 대기 캡처 resolve(error). 모델·결과가 인스턴스와 함께 소멸 → 재오픈 시 새 인스턴스가 `createDefaultModel()` + webviewReady에서 기본 C단면으로 초기화. **MCP는 패널이 닫히면 전부 실패**(bridge.ts:37,45). 직렬화(WebviewPanelSerializer) 없음 → VS Code 재시작 시 복원 안 됨. `retainContextWhenHidden:true`라 탭 숨김 시에는 webview 상태 유지.

#### `.csd` 저장 (`_saveProject` P:3495-3549, GUI 전용)
흐름: Save 버튼 → `saveProject` → host `collectDesignData` → webview `designDataCollected(designInputs)` → `showSaveDialog`(필터 csd) → 조립 → `fs.writeFileSync`(require('fs') 재선언 P:3545).
스키마(JSON, 들여쓰기 2):
```
{
  version: "1.2",
  format: "cufsm-section-design",
  timestamp: ISO,
  model: StcfsdModel 사본 {node[[id,x,z,dofx,dofz,dofy,dofrot,stress]], elem[[id,ni,nj,t,mat]], prop[[mat,Ex,Ey,vx,vy,G]], lengths[], m_all[[]], BC, neigs, springs?, constraints?, GBTcon?, loadCase?, loadFy?, sectionType?, sectionParams?, cornerRadius?},
  derivedStateSignature: 저장 시점 모델 서명 문자열,
  analysisResult: current일 때만 FSM 결과(+_meta.signature) | null,
  loadAnalysis: analyze_loads 결과 | null,
  designResult: aisi_design 또는 purlin 결과 | null,
  designInputs: webview 수집 객체 | null,
  dsm?: {P, Mxx, Mzz, load_family, warning}   // current 해석일 때
  preparedDesignDsm?: {...}                    // 현재 Fy와 일치할 때
  properties?: get_properties 결과
}
```
저장 직전 서명 재확인(P:3543) — 저장 중 모델이 바뀌면 예외.

#### `.csd` 열기 (`_openProject` P:3552-3621)
`showOpenDialog` → JSON 파싱 → `model` 병합(`{...현재, ...저장}`) → `modelLoaded` → `analysisResult._meta.signature`가 현재 서명과 같으면 `analysisComplete`+`dsmResult` 재전송(재계산 없음), 아니면 `analysisInvalidated`. `loadAnalysis`는 무조건 복원(`loadAnalysisComplete`), `designResult`/`preparedDesignDsm`은 `derivedStateSignature` 일치 시만. `properties` → `propertiesResult`(재계산 없음), `designInputs` → `restoreDesignInputs`. **재계산되는 것은 없음**(서명 불일치 시 사용자가 재해석). classifications는 analysisResult 내부에 포함되어 복원되나 `classifyResult`는 별도로 push하지 않음(webview가 analysisComplete에서 처리하는지 app.js 확인 필요).

### 6. `vscode.*` API 사용 (이 파일, 36행)

| API | 횟수 | 행 | 용도 |
|---|---|---|---|
| `import * as vscode` | 1 | 8 | |
| `vscode.WebviewPanel` (타입) | 3 | 26, 44, 79 | 패널 참조 |
| `vscode.Uri` (타입) | 3 | 27, 48, 80 | extensionUri |
| `vscode.window.activeTextEditor` | 2 | 52-53 | 열 위치 결정 |
| `vscode.window.createWebviewPanel` | 2 | 61, 2492 | 메인 패널 / 좌굴 보고서 패널 |
| `vscode.ViewColumn.One` / `.Beside` | 1 / 2 | 64 / 2489, 2495 | |
| `vscode.Uri.joinPath` | 8 | 69, 70, 2720, 2723, 2726, 2729, 3485, 3488 | 리소스 경로 |
| `vscode.Uri.file` | 1 | 2539 | 저장 기본 파일명 |
| `vscode.window.showErrorMessage` | 5 | 282, 451, 2620, 3565, 3570 | 오류 토스트 |
| `vscode.window.showInformationMessage` | 4 | 2549, 2618, 3548, 3620 | 저장/열기 완료 |
| `vscode.window.showWarningMessage` | 1 | 2563 | 브라우저 없음 HTML 폴백 |
| `vscode.window.showSaveDialog` | 2 | 2538, 3496 | PDF/HTML, .csd 저장 |
| `vscode.window.showOpenDialog` | 1 | 3553 | .csd 열기 |
| `vscode.workspace.fs.writeFile` | 1 | 2548 | HTML 보고서 저장 |
| webview 인스턴스 메서드 | — | 90 `webview.html`, 92 `onDidReceiveMessage`, 96 `onDidDispose`, 57/2489 `reveal`, 2710 `postMessage`, 2719-2729/3484-3488 `asWebviewUri`, 2738-2741 `cspSource`, 2499-2500 보고서 패널 이벤트 | |

결론: 호스트 로직 대부분(handleMcpAction, 서명, 설계 조립)은 vscode 비의존이며, vscode 의존은 ① 패널 생성/HTML 주입/메시지 채널, ② 파일 대화상자, ③ 토스트, ④ asWebviewUri/cspSource에 국한. 얇은 가짜 `vscode` 모듈(window.* 다이얼로그·토스트, Uri.joinPath/file, WebviewPanel 대체 객체 {webview:{html, postMessage, onDidReceiveMessage, asWebviewUri, cspSource}, reveal, onDidDispose})로 대체 가능. Node `fs/path/os/child_process` 사용(PDF용 Edge 스폰)은 데스크톱에서도 그대로 동작.

### 7. 큰 메서드 (근사 행 범위)

| 메서드 | 범위 | 행수 |
|---|---|---|
| `handleMcpAction` | 995-2462 | ~1468 (59개 도구의 단일 switch) |
| └ `design_purlin` case | 1812-2087 | ~276 |
| └ `aisi_design` case | 1385-1632 | ~248 |
| └ `generate_report` case | 1657-1731 | ~75 |
| └ `prepare_design_dsm` case | 1216-1274 | ~59 |
| └ `run_analysis` case | 1126-1177 | ~52 |
| `_getHtmlForWebview` (HTML 템플릿) | 2715-3492 | ~778 |
| `_handleMessage` | 215-389 | ~175 |
| `_saveReportPdf` | 2536-2622 | ~87 |
| `_openProject` | 3552-3621 | ~70 |
| `_runAnalysis` | 392-453 | ~62 |
| `getStatus` | 466-521 | ~56 |
| `_saveProject` | 3495-3549 | ~55 |
| `_applyStressToModel` | 569-616 | ~48 |

### 8. 부가 관찰 (이식 시 주의)
- GUI 경로와 MCP 경로의 동작 차이: generateTemplate(GUI)은 응력/modelLoaded 없음 vs generate_template(MCP)은 균일응력+modelLoaded; classifyModes(GUI)는 current 검사 없음; connectionResult 페이로드 형태 차이; save/load_project(MCP)는 .csd 래퍼·결과·입력 미포함.
- `updateModel`은 검증 없는 병합 → webview가 잘못된 node를 보내도 그대로 들어감 (MCP 쪽엔 validator 존재).
- `webviewReady` 재수신 시 모델 초기화(데이터 손실 위험).
- 하중계산 탭 입력 id가 `design-P/V/Mx...`(설계 접두사) — 탭 간 소유 혼재.
- 보고서/검증 판정 로직은 webview(app.js)에 있으며 호스트는 데이터 묶음만 제공 → MCP `generate_report`/`validate_design` 결과는 GUI 보고서/검증 대시보드와 내용이 다름.
- 테스트 훅 `__testDispatchMessage/__testGetPostedMessages/__testGetState/__testGetHtml`(P:113-159, `STCFSD_TEST_MODE=1`).
- `select-r-value`에 value="0.70" 옵션이 두 개(P:3341, 3346) — 선택 복원 시 구분 불가.

---

## 부록 B — app.js 1–3175 (단면·해석·후처리·접합부·트리·단위)

### (원제) B — `webview/js/app.js` 1–3175행 인벤토리 (초안)

범위: `webview/js/app.js` L1–3175 전부 정독. 이후 구간(설계 탭 L3171~, 하중 L3781~, 보고서 L5057~, 검증 L5975~, 저장/복원 L6950~)은 범위 밖이며 이름만 참조.
파일 전체는 단일 IIFE `(function () { ... })()` (L9). `// @ts-check` (L8).

---

### 0. 핵심 요약

- 메시지 키는 `type`이 아니라 **`command`** + `data` (`vscode.postMessage({ command, data })`, 수신 `msg.command`) — L234–404.
- 모델(`model`)과 모든 결과(`analysisResult`, `lastDsmResult`, `_lastDesignResult`, `lastProps`, `_lastLoadAnalysis`, `_lastLapResult`)는 IIFE 클로저 변수(L18–30). `vscode.getState/setState` **미사용**(파일 전체 grep 0건) → 웹뷰가 닫히면 웹뷰측 상태 소실, 호스트가 `modelLoaded`/`restoreDesignInputs`로 다시 넣어줘야 함.
- 내부 저장 단위는 항상 **US(in, ksi, kips, kip-in)**, 화면 기본 단위계는 **SI** (`_unitSystem = 'SI'`, L36). 변환은 입력/표시 레이어에서만(`toDisplay`/`fromDisplay`, L111–119).
- 그리기 함수는 모두 **DOM id 고정 + 클로저 전역 참조** 방식. 순수 함수에 가까운 것은 `_drawLapSvg(r)`, `_drawConnectionSvg(r)`, `_drawPMChart(ctx, hull, …)`(SVG/Canvas 문자열·컨텍스트 입력) 정도이며, 이들도 `fmtVal/unitLabel`(→`_unitSystem`)과 일부는 DOM(`tpl-B`, `tpl-D`)을 읽음.
- VS Code 결합: `acquireVsCodeApi()` 1회(L12), `--vscode-*` CSS 변수 26회(L1–3175 내, 8종), `getComputedStyle(document.body).getPropertyValue('--vscode-…')`로 Canvas 색 결정(L1929, 2508–2511, 2767, 3045). 모두 fallback 값이 있어 브라우저에서도 동작은 함(단 일부 SVG 텍스트 fill은 fallback 없음 — L662).

---

### 1. 화면/서브패널별 기능 (이 구간이 담당하는 부분)

탭 버튼 `.tab-btn[data-tab]` → `switchTab(tabId)` (L409–422): `.tab-btn`/`.tab-panel` `active` 클래스 토글, 패널 id = `tab-${tabId}`. 탭: `preprocessor`, `loads`, `design`, `connection`, `report`, `validation` (HTML은 StcfsdPanel.ts).

#### 1.1 상단 공통 — 단위 토글, 상태바
- 버튼 `btn-unit-US` / `btn-unit-SI` → `switchToUS()`/`switchToSI()` (L453–470) → `refreshUnits(oldSys)` (L143–229).
- 초기화: SI면 `refreshUnits(null)` 호출로 라벨만 갱신 (L473–475). HTML 기본값이 이미 SI.
- 상태바 `#analysis-status` ← `setStatus(text, cls)` (L3134–3140), 클래스 `status-bar running|success|warn|error`.

#### 1.2 ① 단면·재료 탭 (`tab-preprocessor`)
**템플릿 생성** (L2166–2209)
- 입력: `select-template`(단면 종류), `tpl-H`, `tpl-B`, `tpl-D`(length), `tpl-t`(thickness), `tpl-r`(radius), `tpl-qlip`(립 각도, deg, 기본 90).
  - SI 기본값(DEFAULTS, L60–64): H=100 mm, B=50 mm, D=20 mm, t=2.3 mm, r=4 mm. JS fallback(US): 3.93701/1.9685/0.7874/0.09055/0.09055 in (L2187–2191).
  - `tpl-qlip-group`은 lippedc/lippedz/lipped_angle일 때만 표시 (L2170–2177).
  - CHS는 `params.D = params.H` (직경) (L2200–2202).
- 버튼 `btn-generate-template` → `postMessage({command:'generateTemplate', data:{section_type, params:{H,B,D,t,r,[qlip]}}})` (L2204–2207). 값은 US로 변환 후 전송.
- 응답 `templateGenerated` → `model.node/elem` 교체, 모든 노드 응력(n[7])을 `input-fy`로 초기화, `renderPreprocessor()`+`renderStressPreview()`+`sendTreeUpdate()` (L284–298). `templateError` → 상태바 (L299–302).

**재료 입력**
- `input-E`(stress, SI 기본 203395 MPa), `input-v`(무차원, fallback 0.3), `input-G`(stress, 77911 MPa), `input-fy`(245 MPa), `input-fu`(400 MPa) (DEFAULTS L66–69).
- `updateG()` (L2394–2405): `input-E`/`input-v` input 이벤트 → G = E/(2(1+v)) 자동계산(표시단위 그대로).
- `renderPreprocessor()` (L480–498)가 `model.prop[0]`의 E, v, G를 입력란에 역반영(L487–492).
- `input-fy` 변경 → 응력 프리뷰 갱신 (L2382–2385). (Fy/Fu의 설계탭 전파 `propagateFyFuFromPreprocessor`는 L3342, 범위 밖.)

**노드/요소 표** (L500–563)
- `#node-table tbody`: 열 = 번호, x(length), z(length), 응력 n[7](stress). `#elem-table tbody`: 번호, 절점 i, j(읽기 전용), t(thickness).
- 편집: 테이블 위임 `change` 리스너 `_wireTableEdit` (L535–547). 노드 편집 → `model.node[row][col]` 갱신, SVG/응력 프리뷰 재그림, `updateModel{node}` + `getProperties{node,elem}` 전송 (L548–556). 요소 t 편집 → `updateModel{elem}` + `getProperties` (L557–563).
- 노드/요소 추가·삭제 버튼은 이 구간에 없음(MCP `add_node` 등만 존재 가능 — 다른 포크 확인 필요).

**단면 미리보기 SVG** `#section-svg` — `renderSectionSVG()` (L617–666) + `renderSectionAxes(props)` (L669–727).
- 요소 = line, 절점 = circle + 번호 text, z축 반전. 도심 x/z 축(점선, 화살표, "CG"), 주축 1/2(θp≠0일 때) 및 θp 라벨.

**단면 성질 표** `#section-props` — `renderProperties(props)` (L732–736) → `updatePropertiesTable` (L738–767).
- 출력 15행: A, Ixx, Izz, Ixz, Sx, Sz, Zx, Zz, rx, rz, xcg, zcg, θp, I11, I22 (단위 변환 적용). `lastProps`에 보관.
- 트리거: `renderPreprocessor()`가 노드가 있으면 자동 `getProperties` 전송(L495–497) → 응답 `propertiesResult` (L276–279). 오류 `propertiesError`(L280–283).

**응력 분포 프리뷰 SVG** `#stress-preview-svg` (190×220) — `renderStressPreview()` (L2216–2370).
- 입력: `select-load-case`(compression | bending_xx_pos | bending_xx_neg | bending_zz_pos | bending_zz_neg | custom), `input-fy`, custom일 때 `input-load-P`(force), `input-load-Mxx`, `input-load-Mzz`(moment).
- **JS 측 간이 계산**: 해석 전 프리뷰용으로 절점별 응력을 직접 계산(도심이 아닌 bbox 중앙 기준 선형분포, custom은 부호만 사용) (L2239–2262). 실제 해석 응력과 다를 수 있음.
- 화살표(압축=빨강 #ef5350, 인장=파랑 #42a5f5, 인접 요소 평균 법선 방향), 절점 색 그라데이션, 하중케이스 한글 라벨 + Fy.
- `select-load-case` change → `custom-load-inputs` 표시 토글 + 재그림 (L2372–2391). 초기 `setTimeout(renderStressPreview, 500)` (L2408).
- (위치: 하중 케이스 선택은 HTML상 설계 탭 A섹션일 수 있음 — StcfsdPanel.ts 포크 확인.)

#### 1.3 ③ 좌굴해석·부재설계 탭 (`tab-design`) — 이 구간 담당분
**A. 좌굴해석 실행** — 버튼 `btn-run-analysis` (L2410–2465)
- 입력: `input-len-min`(length, SI 10 mm / fallback 0.394 in), `input-len-max`(10000 mm / 393.7 in), `input-len-n`(점 수, 60), `input-neigs`(고유치 수, 10), `select-bc`(경계조건, 기본 'S-S'), `input-E`, `input-v`, `input-G`, `select-load-case`, `input-fy`, custom 하중.
- **JS 측 전처리 로직**: `logspace(log10(min), log10(max), n)`로 반파장 배열 생성, `m_all = [[1],…]`, `model.prop = [[100,E,E,v,v,G]]`, `model.BC`, `model.neigs` 설정 (L2422–2434). Load case → `stressOpts` 매핑(L2440–2458):
  - compression → `{type:'uniform_compression', fy}`; bending_xx_pos → `{type:'pure_bending', fy}`; xx_neg → `{type:'custom',P:0,Mxx:-1,Mzz:0,fy}`; zz_pos/neg → `Mzz:±1`; custom → `{type:'custom', P, Mxx, Mzz}`(US 변환, fy 없음).
- 전송: `postMessage({command:'runAnalysis', data: model})` — **모델 전체**(node, elem, prop, lengths, m_all, BC, neigs, loadCase, stressOpts)를 단일 메시지로 (L2461–2463, 레이스 방지 주석).
- 흐름: `analysisStarted` → 상태 "Running…" (L243–245); `analysisComplete` (L246–266) → curve 이중배열 정규화(L249–256), `sec-fsm-res` 접이식 펼침, `renderBucklingCurve`, `populatePostSelects`, `renderModeShape2D`, `renderModeShape3DWrapper`, **`switchTab('design')`**, **`_autoPrepareDesignDsm()`** (L426–437: `select-member-type`가 tension이 아니면 `prepareDesignDsm{member_type, Fy(design-fy)}` 전송; calc 모드는 flexure로 치환). `analysisError` (L303–306).
- 무효화: `analysisInvalidated` → analysisResult/lastDsmResult/_lastDesignResult null, `invalidateLoads`면 `_lastLoadAnalysis`도 null, 경고 상태, `updateDesignDsmStatus()`, 트리 갱신 (L267–275).

**DSM 설계값 표** `#dsm-table-container` — `renderDsmResults(data)` (L772–835), `_dsmHeader`/`_dsmRow` (L837–851).
- 입력 data: `{P, Mxx, Mzz, load_family, …}` 각 항목 `{Py|P_y, crl, crd, cre, Lcrl, Lcrd, Lcre, LF_local, LF_dist, LF_global, n_minima, minima[{length, load_factor}]}`.
- 출력: Compression(Py, Pcrl, Pcrd, Pcre), Bending(My, Mcrl, Mcrd, Mcre), Weak-axis bending 블록 — 값/반파장/LF 3열, "Basis: {load_family} analysis" 주석(R2-05), 극소점 목록.
- 수신: `dsmResult` (L342–355) → 저장 + 표 + 좌굴곡선 재그림(극점 마커) + 기본 반파장 재선택 + `updateDesignDsmStatus()` + 트리. `designDsmPrepared` (L387–396) → 성공 시 상태바 + `updateDesignDsmStatus('✓ 좌굴해석 연동 + 설계용 좌굴값 준비 완료 (cases) — 설계 검토 실행 가능', true)`.
- **흐름(중요)**: 해석 → `analysisComplete` → 자동 `prepareDesignDsm` → 호스트가 부재 유형별 P/Mxx 좌굴값 준비 → `designDsmPrepared` → 설계 검토 가능. DSM 값(`lastDsmResult`)은 좌굴곡선 마커, 2D/3D 기본 반파장, 트리(Pcrl/Pcrd/Mcrl/Mcrd), 보고서에 사용.

**후처리 — 좌굴곡선** `#buckling-curve-canvas` — `renderBucklingCurve()` (L2470–2725). §5 참조.
**후처리 — 2D/3D 모드형상** 셀렉트 `select-length`, `select-mode` (`populatePostSelects`, L2852–2899: 기본 반파장 = DSM Mxx의 min(Lcrl,Lcrd)에 가장 가까운 점, 모드 최대 10개, `onchange` 할당으로 리스너 누적 방지). 캔버스 `mode-shape-canvas`, `mode-shape-3d-canvas`.
**모드 분류** 버튼 `btn-run-classify` (L2905–2921): 해석 결과 없으면 오류, 버튼 "분류 중..." 비활성 → `classifyModes{}` (payload 비어 있음; 호스트가 저장된 결과 사용). 응답 `classifyResult` → `renderClassifyCurve` + 버튼 복구 (L329–332); `classifyError` (L313–317). 주석: 과거엔 MCP로만 채워지던 고아 UI였음(L2905).
**소성 곡면** 버튼 `btn-run-plastic` (L1874–1884): 입력 `plastic-fy`(없으면 `input-fy`) → `runPlastic{node, elem, fy}`. 응답 `plasticResult` → `renderPlasticSurface` (L333–335); `plasticError`는 console만(L310–312, 사용자 피드백 없음).
**자유진동 해석** 버튼 `btn-run-vibration` (L1886–1894) → `runVibration` (data 없음, 호스트 모델 사용). 응답 `vibrationResult` → `renderVibrationResult` (L1896–1918): `#vibration-result`에 반파장별 고유진동수(rad/s) 표, 상위 20개; `vibrationError` (L339–341).
**좌굴해석 보고서** 버튼 `btn-view-buckling-report` (L2971–2980): `_buildBucklingReportHtml()` (L2934–2969) — 해석조건 표(단면명/H/B/D/t, Fy/Fu, 하중케이스, BC, 반파장 범위, 절점/요소 수) + `dsm-table-container.innerHTML` 복사 + 5개 캔버스(`buckling-curve-canvas`, `classify-curve-canvas`, `mode-shape-canvas`, `mode-shape-3d-canvas`, `plastic-surface-canvas`)를 `toDataURL` PNG로 캡처(`_canvasPng`, 3000바이트 미만=빈 캔버스 제외, L2924–2932) → `showBucklingReport{html}` 전송 → 호스트가 **별도 웹뷰 패널**로 띄움(PDF 저장은 호스트 `saveReportPdf`, 범위 밖). 주의: Babylon 3D 캔버스는 `preserveDrawingBuffer` 여부에 따라 빈 PNG일 수 있음(확인 필요).

#### 1.4 ④ 접합부 탭 (`tab-connection`)
- 접이식 헤더 `#tab-connection .conn-collapsible` 클릭 토글(▶/▼), CSP 때문에 inline onclick 대신 리스너(L856–869).

**Lap Splice(겹침이음) 설계** — 버튼 `btn-run-lap-design` (L873–921)
- 입력(US 변환 후 전송): `tpl-H`→d, `tpl-t`→t (**단면 탭 템플릿 입력을 직접 읽음** — 사용자 정의 단면이면 부정확), `design-fy`, `design-fu`, `conn-lap-left`/`conn-lap-right`(length, SI 305 mm), `conn-Mu`(moment), `conn-Vu`(force), `conn-fastener-type`(기본 screw), `conn-fastener-dia`(4.8 mm), `conn-n-rows`(2), `conn-edge-dist`(length, 0이면 undefined), `select-design-method`(LRFD/ASD, 설계 탭).
- **다른 탭 결과 의존**: `Sf = lastProps.Sx`; `Se` = `_lastDesignResult.Se` → 없으면 `Mnl/Fy_used` → 없으면 Sx (`_lapSeIsGross=true`로 경고) (L877–893); `Mnd`, `Vn`도 설계 결과에서 (L896–899). → **③ 설계 검토를 먼저 실행해야 정확**. `conn-Mu`/`conn-Vu`는 하중 분석 결과에서 자동 채움되는지는 범위 밖(L3781~ 확인 필요).
- 전송 `runLapConnection{d,t,Fy,Fu,lap_left_in,lap_right_in,Mu_support,Vu_support,fastener_type,fastener_dia,n_rows,end_distance,design_method,Se,Sf,Mnd,Vn}` (L900–919).
- 응답 `lapConnectionResult` → `_lastLapResult` 저장 + `renderLapConnectionResult` (L356–359, L995–1096): `#connection-result`에 경고 박스, Se 대체 경고, Lap SVG, 종합판정(OK/NG + 패스너 DCR, 휨 DCR=`flexure_dcr_governing`), 결과표(최소 랩길이 검증, 전달 전단력, 패스너 설계강도 φRn 또는 Rn/Ω, 필요 수, 배치 가능 최대, 실제 배치 rows×per_row, 용량, 간격, 단부거리, Lap 휨강도 §F3/F4/H2), 패스너 한계상태 표(지배 ★), 단계별 계산 steps(formula; SI일 때 "수식은 US 기준" 고지).

**단일 접합부 강도** — 버튼 `btn-run-single-conn` (L923–956)
- 입력: `conn-single-type`(screw|bolt|paf|fillet_weld|arc_spot|arc_seam|groove), `conn-t1`/`conn-t2`(1.5 mm), `conn-d`(4.8 mm), `conn-n`(4), `conn-Fy`(245), `conn-Fu`(400), `conn-Pu`(force, 0=강도조회), 용접일 때 `conn-weld-L`(50 mm), `conn-weld-size`(3 mm), groove일 때 `conn-groove-type`(complete), bolt/screw일 때 `conn-Fub`(bolt 827 / screw 689 MPa), paf일 때 `conn-Fuf`(827 MPa), `select-design-method`.
- 유형 변경 UI `updateConnTypeUI` (L959–993): `conn-weld-row`/`conn-groove-row`/`conn-bolt-row`/`conn-paf-row` 표시 토글, Fub 기본값 자동 전환(bolt 120 / screw 100 ksi), `conn-Fub-hint`, 유형별 입력 의미 힌트 `conn-single-hint`(CONN_TYPE_HINTS L962–970, 한국어 + 조항).
- 전송 `runConnection{connection_type,t1,t2,d,n,Fy,Fu,Pu,design_method,[weld_length,weld_size],[groove_type],[Fub],[Fuf]}` (L954).
- 응답 `connectionResult` → `renderConnectionResult` (L1111–1171): 제목(유형 표시명 매핑 L1121–1125), 접합 SVG, 요약표(Rn, 설계강도, 지배모드, 3상태 판정 `_verdictOf`(PASS/FAIL/NOT_CHECKED, L1101–1109), 이용률 %), 한계상태 표, 경고, SI 수식 고지.
- 두 결과 모두 같은 `#connection-result`에 덮어씀(동시 표시 불가).

#### 1.5 사이드바 트리 연동
- `sendTreeUpdate()` (L1790–1843): 약 40개 필드의 **표시용 문자열**(단위 포함)을 `treeUpdate{…}`로 호스트에 전송 → ProjectExplorer 트리 갱신. 필드: sectionType, H, B, D, t, steelGrade(`input-steel-grade`), Fy, Fu, A, Ixx, Sx, rx, rz, Pcrl, Pcrd, Mcrl, Mcrd, memberType, spanType, designMethod, spanLength(첫 `.span-tbl-len`), spacing, loadD/Lr/S/Wu(↑)/Wp(↓)/L, hasLoadAnalysis, gravityCombo, maxMu, maxVu(`_getMaxMuFromAll/_getMaxVuFromAll` L1689–1712), maxDeflection, deflectionRatio, hasDesignResult, designMn, designPn, controllingMode, utilization, passOrFail. → **트리는 웹뷰가 계산한 문자열의 거울**이며 웹뷰가 없으면 갱신 불가.
- 호출 지점: modelLoaded, analysisInvalidated, propertiesResult, templateGenerated, dsmResult, designResult, designPurlinResult, loadAnalysisComplete.
- 트리 → 웹뷰 `showSection{sectionId}` → `handleShowSection` (L1716–1787): `tabMap`(22개 sectionId→탭), `focusMap`(26개 `focus-*` → [탭, 요소id], scrollIntoView+focus, 100 ms 지연). `run-analysis`는 `btn-run-analysis.click()`, `run-validation`은 `btn-run-validation.click()` 자동실행. 섹션 이름 'analysis','boundary-condition','lengths','cfsm-settings','postprocessor','buckling-curve','mode-shape-2d/3d','classification','plastic-surface'는 모두 그냥 design 탭으로만 전환(스크롤 없음).

#### 1.6 퍼린 설계 결과 선택 (설계 탭 연동, JS 측 후처리)
- `_pickGoverningPurlinDesign(data)` (L1845–1869): `design_positive/negative/lap/uplift` 중 **이용률 최대**를 지배로 골라 `controlling_mode`에 "정모멘트/부모멘트/랩 구간/양력:" 접두, `purlin_mode:true`, 하위 결과 보존. **TS/Python이 아닌 웹뷰 JS의 판정 로직.**
- 수신 `designResult`(design_positive 있으면 퍼린 모드) / `designPurlinResult` → `_lastLoadAnalysis` 갱신 + `renderDesignResult` (L363–379; 렌더러는 L4629, 범위 밖).

#### 1.7 MCP 전용 경로
- `captureSection` 수신 → `captureSectionPreview()` (L568–612): `#section-svg` 복제 + 배경 #1e1e1e, XMLSerializer → Blob URL → Image → 400×400 canvas → PNG dataURL → `sectionPreviewResult{png_base64,width,height}` 또는 `{error}`. MCP `get_section_preview`용. **웹뷰가 열려 있고 렌더링되어야만 동작.** SVG 내부 `var(--vscode-…)`는 이미지로 직렬화 시 해석되지 않아 fallback 값 사용, fallback 없는 `--vscode-descriptionForeground`(L662) 절점 번호는 기본색(검정)으로 그려짐.
- `collectDesignData` 수신 → `designDataCollected{collectAllDesignInputs()}` 회신 (L397–399; 저장용, 함수는 L6954).
- `restoreDesignInputs` 수신 → `restoreAllDesignInputs(data)` (L400–402; L6968).

---

### 2. 메시지 프로토콜 (L1–3175 내)

#### 2.1 웹뷰 → 호스트 (`vscode.postMessage({command, data})`)
| command | payload | 위치 | 트리거 |
|---|---|---|---|
| `designDataCollected` | `collectAllDesignInputs()` 결과 | L398 | 호스트 `collectDesignData` 요청 응답 |
| `prepareDesignDsm` | `{member_type, Fy}` (US ksi) | L430–436 | `analysisComplete` 후 자동 |
| `getProperties` | `{node, elem}` | L496, 555, 562 | 모델 렌더/노드·요소 편집 |
| `updateModel` | `{node}` 또는 `{elem}` | L554, 561 | 노드/요소 표 편집 (호스트가 해석 무효화 → `analysisInvalidated`) |
| `sectionPreviewResult` | `{png_base64, width:400, height:400}` 또는 `{error}` | L571, 595, 602–605, 609 | `captureSection` 응답 |
| `runLapConnection` | `{d,t,Fy,Fu,lap_left_in,lap_right_in,Mu_support,Vu_support,fastener_type,fastener_dia,n_rows,end_distance,design_method,Se,Sf,Mnd,Vn}` | L919 | Lap 설계 버튼 |
| `runConnection` | `{connection_type,t1,t2,d,n,Fy,Fu,Pu,design_method,weld_length?,weld_size?,groove_type?,Fub?,Fuf?}` | L954 | 단일 접합부 버튼 |
| `treeUpdate` | 표시용 문자열 ~40필드 (§1.5) | L1842 | 여러 결과 수신 후 |
| `runPlastic` | `{node, elem, fy}` | L1879–1882 | 소성곡면 버튼 |
| `runVibration` | (없음) | L1892 | 진동해석 버튼 |
| `generateTemplate` | `{section_type, params:{H,B,D,t,r,qlip?}}` | L2204–2207 | 템플릿 버튼 |
| `runAnalysis` | `model` 전체 + `lengths, m_all, prop, BC, neigs, loadCase, stressOpts` | L2463 | 해석 실행 버튼 |
| `classifyModes` | `{}` | L2919 | 모드 분류 버튼 |
| `showBucklingReport` | `{html}` (PNG dataURL 포함 HTML 문자열) | L2978 | 좌굴 보고서 버튼 |

(설계/하중/보고서/검증/파일 관련 송신 — `runDesign`, `analyzeLoads`, `saveProject`, `openProject`, `saveReportPdf`, `invalidateDerivedResults`, `setStress`, `applyStress`, `webviewReady` 등 — 은 L3175 이후 또는 다른 파일. `setStress`/`applyStress`는 이 구간에서 송신 없음.)

#### 2.2 호스트 → 웹뷰 (window `message`, `msg.command`) — L234–404 전부
| command | 처리 | 위치 |
|---|---|---|
| `modelLoaded` | `model = data`; renderPreprocessor(+getProperties 자동 송신); renderStressPreview; sendTreeUpdate | L237–242 |
| `analysisStarted` | 상태 running | L243–245 |
| `analysisComplete` | curve 정규화, 결과 저장, 곡선/셀렉트/2D/3D 렌더, design 탭 전환, 자동 prepareDesignDsm | L246–266 |
| `analysisInvalidated` | 결과 null(옵션 `invalidateLoads`), 경고, DSM 상태, 트리 | L267–275 |
| `propertiesResult` | renderProperties(표+축) + 트리 | L276–279 |
| `propertiesError` | 상태 error | L280–283 |
| `templateGenerated` | node/elem 교체, 응력=Fy, 재렌더, 트리 | L284–298 |
| `templateError` | 상태 error | L299–302 |
| `analysisError` | 상태 error | L303–306 |
| `stressError` | console만 | L307–309 |
| `plasticError` | console만 | L310–312 |
| `classifyError` | 상태 error + 버튼 복구 | L313–317 |
| `stressApplied` | `model.node` 교체 + 노드표 재렌더 (SVG/프리뷰 재그림 없음) | L318–323 |
| `showSection` | handleShowSection(sectionId) | L324–328 |
| `classifyResult` | renderClassifyCurve + 버튼 복구 | L329–332 |
| `plasticResult` | renderPlasticSurface | L333–335 |
| `vibrationResult` | renderVibrationResult | L336–338 |
| `vibrationError` | 상태 error | L339–341 |
| `dsmResult` | 저장, DSM 표, 곡선 재그림, 셀렉트/2D/3D 재선택, DSM 상태, 트리 | L342–355 |
| `lapConnectionResult` | 저장 + renderLapConnectionResult | L356–359 |
| `connectionResult` | renderConnectionResult | L360–362 |
| `designResult` | 퍼린 모드면 지배 선택 후 렌더, 아니면 그대로 렌더; 트리 | L363–373 |
| `designPurlinResult` | load_analysis 갱신, 지배 선택, 렌더, 트리 | L374–379 |
| `captureSection` | captureSectionPreview → sectionPreviewResult | L380–382 |
| `loadAnalysisComplete` | renderLoadAnalysisResult (L4163) + 트리 | L383–386 |
| `designDsmPrepared` | 성공/실패 상태 + updateDesignDsmStatus | L387–396 |
| `collectDesignData` | designDataCollected 회신 | L397–399 |
| `restoreDesignInputs` | restoreAllDesignInputs | L400–402 |

총 28종 수신. 다른 메시지 리스너가 L3175 이후에 있는지는 다른 포크 확인 필요(이 구간엔 1개뿐).

---

### 3. 단위계

- 정의 `UNIT` (L38–55): 15개 유형 — length(×25.4, in/mm), length_ft(×0.3048, ft/m), area, inertia, modulus, stress(×6.89476 ksi/MPa), force(×4.44822 kips/kN), moment(×0.11298 kip-in/kN-m), moment_ft(×1.35582 kip-ft/kN-m), pressure(×0.04788 psf/kPa), linload(×0.01459 plf/kN/m), thickness, radius, rotStiff(kip-in/rad/in ↔ kN-m/rad/m), latStiff(kip/in/in ↔ kN/m/m). 각 유형별 표시 소수 자리(us/si).
- 내부 저장 = 항상 US. `toDisplay` (US→표시), `fromDisplay` (표시→US), `unitLabel`, `unitDec`, `fmtVal` (L111–137; null/NaN → '—').
- `DEFAULTS` (L58–108): **SI 네이티브** 기본값 39개 [값, 단위유형]. `getNum(id, fallback)` (L3156–3167): 입력이 비어/NaN이면 DEFAULTS를 현재 단위계로 환산해 반환, 없으면 fallback(대개 US 값). → 코드의 fallback 인자는 DEFAULTS에 있는 id에선 무시됨(예: `getNum('tpl-H', 8)` L901의 8은 쓰이지 않음).
- 토글 `refreshUnits(oldSys)` (L143–229):
  1. 입력값 변환 — `inputUnitMap` 하드코딩 58개 id (L145–173) + 동적 `.span-tbl-len/.span-tbl-lapl/.span-tbl-lapr`(length_ft) (L175–177). 값 0 또는 NaN은 건너뜀, `toPrecision(6)` 후 trailing 0 제거.
  2. `[data-unit]` 비입력 요소 텍스트를 단위 라벨로 교체(L194–198), `.conn-unit-length|thickness|stress|force|moment` 라벨(L200–204).
  3. 재렌더: 노드/요소 표, 응력 프리뷰, `propagateFyFuFromPreprocessor`, DSM 표, 설계 결과, 보고서(`#report-container`가 채워져 있으면 `generateDetailedReport()` 재생성), 성질표, 하중해석 결과, `updatePLF` (L205–228).
  - 그래프 캔버스(좌굴곡선, 소성곡면, 모드형상)는 토글 시 **재그림 안 됨** — 다음 렌더/마우스 이동 시 갱신(좌굴곡선은 mousemove 시 drawChart 재호출로 라벨 갱신됨). 접합부 결과(`#connection-result`)도 재렌더 안 됨(이전 단위 표시 유지).
  - `inputUnitMap`에 없는 단위 입력(예: `conn-edge-dist`, `plastic-fy`는 있음, `conn-edge-dist` 없음)은 토글 시 값 변환 누락 → 잠재 버그. 확인: `conn-edge-dist`(L912, length)는 맵에 없음.
- 영속화: `_unitSystem`은 메모리만. `designState.js`가 `data.unitSystem = getUnitSystem()` 저장(L14) / `setUnitSystem` 복원(L169–170) — 해당 getter/setter는 범위 밖(L3175 이후 또는 designState 쪽) 확인 필요. 웹뷰 재생성 시 기본 SI로 돌아감.
- 상세 수식 문자열(steps/formula)은 Python이 US로 생성 → SI 모드에서 "US 기준" 고지만 표시(L1086–1088, 1166–1168).

---

### 4. 전역(클로저 최상위) 변수 — L1–3175

IIFE 최상위 `let/const/var`(DOM 핸들 포함) 24개:

| 행 | 이름 | 의미 |
|---|---|---|
| 12 | `vscode` | `acquireVsCodeApi()` 핸들 |
| 15 | `fmt`, `logspace`, `_convexHull` | `globalThis.StcfsdUtils`에서 구조분해 (utils.js 선로드 필요) |
| 18 | `model` | CUFSM 모델 `{node[[no,x,z,dofx,dofz,dofy,dofq,stress]], elem[[no,i,j,t,mat]], prop, lengths, m_all, BC, neigs, loadCase, stressOpts, …}` |
| 20 | `analysisResult` | FSM 결과 `{curve[[L, lf1..lfn]], shapes[len][ndof][nmode], n_lengths, …}` |
| 22 | `lastDsmResult` | DSM 값 `{P, Mxx, Mzz, load_family}` |
| 24 | `_lastDesignResult` | 설계 결과(보고서·Lap 입력·트리) |
| 26 | `lastProps` | 단면 성질 |
| 28 | `_lastLoadAnalysis` | 하중 분석 결과 |
| 30 | `_lastLapResult` | Lap 결과 |
| 36 | `_unitSystem` | 'SI' / 'US' |
| 38 | `UNIT` | 단위 변환표 |
| 58 | `DEFAULTS` | SI 기본값표 |
| 874 | `_lapSeIsGross` (var) | Lap Se가 Sx로 대체됐는지 |
| 873, 923, 959, 1874, 1887, 2170, 2171, 2179, 2372, 2402, 2403, 2410, 2910, 2971 | `btnLapDesign`, `btnSingleConn`, `connTypeSelect`, `btnPlastic`, `btnVibration`, `selTemplateEl`, `qlipGroup`, `btnGenTemplate`, `selLoadCase`, `elE`, `elV`, `btnRun`, `btnClassify`, `btnViewBucklingReport` | DOM 핸들(상태 아님) |

- 상태성 전역 = 10개(model, analysisResult, lastDsmResult, _lastDesignResult, lastProps, _lastLoadAnalysis, _lastLapResult, _unitSystem, _lapSeIsGross + vscode). 상수 2(UNIT, DEFAULTS), DOM 핸들 14, 유틸 3.
- `window.*` 대입: **0건**(파일 전체). 반대로 읽는 외부 전역: `globalThis.StcfsdUtils`(L15), `window.CufsmViewer3D`(L3097, Babylon 번들 `media/viewer3d.js`), `window.renderModeShape3D`(L3118, `webview/js/charts/modeShape3D.js`), `acquireVsCodeApi`(L12).
- 함수 내 지역 상수 중 사실상 설정값: `CONN_TYPE_HINTS` (L962), `CONN_DISPLAY_NAMES` (L1121), `tabMap`/`focusMap` (L1718/1734), `caseLabels` (L2358).

---

### 5. 시각 컴포넌트

| 컴포넌트 | 진입 함수 (행) | 입력 | 출력 대상 | 순수성 / 결합 | 라이브러리 |
|---|---|---|---|---|---|
| 단면 미리보기 | `renderSectionSVG()` L617–666 | 전역 `model.node/elem` | `#section-svg` innerHTML (viewBox=모델 좌표) | 비순수: 전역 model + 고정 id. 로직 자체는 node/elem→SVG 문자열로 쉽게 분리 가능 | 없음(SVG 문자열) |
| 도심·주축 오버레이 | `renderSectionAxes(props)` L669–727 | props(xcg,zcg,thetap) + 전역 model | `#section-svg` innerHTML += | 비순수(전역 model, 기존 SVG에 append — renderSectionSVG 후 호출 순서 의존) | 없음 |
| 단면 PNG 캡처 | `captureSectionPreview()` L568–612 | `#section-svg` DOM | postMessage PNG | DOM 의존 | Canvas/Blob |
| 단면 성질 표 | `updatePropertiesTable(props)` L738–767 | props | `#section-props` | 거의 순수(props→HTML), 단위 전역 | 없음 |
| DSM 표 | `renderDsmResults(data)` L772–835 | dsm data | `#dsm-table-container` | 거의 순수, 단위 전역, 인라인 스타일에 `--vscode-panel-border/descriptionForeground` | 없음 |
| 응력 분포 프리뷰 | `renderStressPreview()` L2216–2370 | 전역 model + DOM(`select-load-case`, `input-fy`, custom 하중) | `#stress-preview-svg` (190×220) | 비순수(입력값을 DOM에서 직접 읽음 + JS 간이 응력계산 내장) | 없음 |
| 좌굴곡선(Signature curve) | `renderBucklingCurve()` L2470–2725 (내부 `drawChart(mx,my)` L2504) | 전역 `analysisResult.curve`, `lastDsmResult` | `#buckling-curve-canvas` | 비순수(전역 2개 + 고정 id). 반로그 x축, 최대 5개 모드(1차 굵게), 범례, DSM 극점 마커(Pcrl/Pcrd 또는 Mcrl/Mcrd, 없으면 곡선 최소점), 마우스 십자 커서 스냅 + 좌표 표시(`canvas.onmousemove/onmouseleave`). DSM 마커는 Mxx→P→Mzz 순 1개 family만. 색은 `--vscode-editor-foreground/panel-border/editor-background` | Canvas 2D 직접 |
| 2D 모드형상 | `renderModeShape2D()` L2730–2849 | 전역 analysisResult.shapes/curve, model, DOM `select-length/select-mode` | `#mode-shape-canvas` | 비순수. **근사 표시**: x변위=u(멤브레인), z변위=w(면외)로 단순 대입(요소 법선 변환 없음, L2809–2818) → 실제 단면 변형과 다를 수 있음. 스케일 = 단면 크기 15% | Canvas 2D |
| 3D 모드형상 | `renderModeShape3DWrapper()` L3073–3129 (async) | 전역 analysisResult, model, DOM 셀렉트 | `window.CufsmViewer3D.render({nodes,elems,modeVec,length,BC,scale:0.3})` 우선(Babylon.js, `src/webview/viewer3d/*` 번들), 실패/미로드 시 `window.renderModeShape3D(canvas,node,elem,modeVec,length,BC)` (등각투영 Canvas 폴백, `mode-shape-3d-canvas`) | 래퍼는 비순수, 하위 렌더러 2종은 **입력 인자 기반(순수에 가까움)** — 재사용 후보 1순위 | Babylon.js / Canvas |
| 모드 분류 stackplot | `renderClassifyCurve(clasData)` L2982–3068 | clasData [[G,D,L,O]%…] + 전역 analysisResult.curve(반파장) | `#classify-curve-canvas` | 비순수(전역 curve). G=#e57373, D=#ffb74d, L=#4fc3f7, O=#b0bec5 누적 영역, 범례, x축 10^n 눈금(**단위 변환 없이 US 값 출력** — SI 모드에서 라벨 불일치, L3060–3062), y축 0/100% | Canvas 2D |
| 소성 P-M 곡면 | `renderPlasticSurface(data)` L1920–1984 → `_drawPMChart(ctx,hull,ox,oy,cw,ch,title,xLabel,yLabel,color,colorBase,fg,gridColor)` L2002–2159 | data{P,M11,M22,Py,M11_y,M22_y,Mxx_y,Mzz_y,fy,thetap} → `_convexHull`로 외곽 | `#plastic-surface-canvas`, 좌: P/Py–M11/M11y, 우: P/Py–M22/M22y, 하단 정보 패널(Py, M11y, M22y, θp, fy, Mxxy, Mzzy) | `_drawPMChart`는 **순수**(ctx+데이터 인자). 상위는 고정 id + 단위 전역. 하단 패널 배경 `rgba(30,30,30,0.85)` 하드코딩(라이트 테마에서 어둡게 보임) | Canvas 2D |
| 진동 결과 표 | `renderVibrationResult(data)` L1896–1918 | data.frequencies | `#vibration-result` | 거의 순수 | 없음 |
| Lap Splice 도면 | `_drawLapSvg(r)` L1176–1455 (+`_dimLineArrow` L1457–1475) | Lap 결과 r(d,t,lap_left/right_in,n_per_row,n_rows,spacing,edge_distance,fastener_dia/type/label,pass,min_lap,lap_ok,V_transfer,capacity,utilization) + **DOM `tpl-B`, `tpl-D`**(플랜지/립) | SVG 문자열 반환(540×310) — 측면도(M1/M2 C형강 겹침, 랩 경계, 지점, 패스너 nRows×nPerRow, 치수 lap/s/e/d, 절단선 A-A) + 단면도 CUT A-A(nested C 2개, 패스너, d/b/t/c 치수) + 하단 V/Cap/DCR | 반환형은 순수에 가깝지만 DOM 2개 읽음 + 단위 전역 | SVG 문자열 |
| 단일 접합 도면 | `_drawConnectionSvg(r)` L1477–1686 | 접합 결과 r(connection_type,t1,t2,d,n,weld_size,weld_length,groove_type,Rn,design_strength,utilization,governing_mode,pass,design_method) | SVG 문자열(440×220) — 기계적(screw/bolt/paf 겹침판 단면, 패스너 최대 6개 표시), 용접(fillet 삼각형+AWS 심볼, arc spot 원형 너겟, arc seam 타원), groove(CJP/PJP V형) | **순수**(r→문자열), 단위 전역만. `<marker id="arrowR">`가 결과마다 중복 정의(id 충돌 가능) | SVG 문자열 |
| 좌굴해석 보고서 HTML | `_buildBucklingReportHtml()` L2934–2969 | DOM 입력값 + `#dsm-table-container` HTML + 5개 캔버스 PNG | HTML 문자열 → 호스트 별도 패널 | 강하게 DOM 결합 | 없음 |
| 3상태 판정 | `_verdictOf(dd)` L1101–1109 | `{pass, verification_complete}` | `{state,label,cls,short}` | **순수** | — |

---

### 6. VS Code 결합 (이 구간)

- `acquireVsCodeApi()` L12 — 유일한 API 호출. 사용 메서드는 `postMessage`뿐. `getState`/`setState` 사용 0건 → 브라우저용 스텁은 `{postMessage(m){…}}`만 있으면 됨.
- 수신은 표준 `window.addEventListener('message')` (L234) → 다른 호스트에서도 `window.postMessage({command,data})`로 그대로 주입 가능.
- `--vscode-*` CSS 변수: L1–3175에 26회, 8종 — `--vscode-descriptionForeground`(7), `--vscode-panel-border`(7), `--vscode-editor-background`(4), `--vscode-editor-foreground`(4), `--vscode-foreground`(3), `--vscode-focusBorder`(2), `--vscode-charts-blue`(1), `--vscode-charts-orange`(1).
  - SVG 속성/인라인 style 내 `var(--vscode-…)`: 대부분 fallback 없음(예: L662, 782, 815, 838, 1052, 1092, 1200–1201, 1224, 1269, 1484–1485, 1496, 1528, 2366–2367) → VS Code 밖에서는 변수 정의(theme.css 매핑 또는 shim CSS)가 필요.
  - Canvas는 `getComputedStyle(document.body).getPropertyValue('--vscode-…')`로 읽고 fallback(`'#ccc'`, `'#333'`, `'#1e1e1e'`) 있음 (L1928–1930, 2507–2511, 2766–2767, 3044–3045) → 변수 미정의 시 다크 색으로 그려짐(라이트 배경에서 대비 문제).
- 하드코딩 다크 색: 캡처 배경 `#1e1e1e`(L582, 596), 소성곡면 정보 패널 `rgba(30,30,30,0.85)`(L1965), 다수 고정 색(#4fc3f7, #ff9800, #e57373 …). `vscode-dark/vscode-light` body 클래스 참조 0건.
- CSP 의식: 접합부 collapsible은 inline handler 대신 리스너(L856–858 주석 "CSP 호환"). 모든 동적 HTML은 `innerHTML` 문자열 + 인라인 `style=` 사용(CSP `style-src 'unsafe-inline'` 필요 가능성 — StcfsdPanel 포크 확인).
- 외부 전역 의존: `globalThis.StcfsdUtils`(utils.js), `window.CufsmViewer3D`(media/viewer3d.js, Babylon), `window.renderModeShape3D`(charts/modeShape3D.js) — 스크립트 로드 순서 가정.
- 결론(이 구간): 브라우저/iframe 이식 난이도 **낮음** — `acquireVsCodeApi` 스텁 + `--vscode-*` 변수 정의 CSS만 있으면 동작. 부분 임베드(좌굴곡선·3D 등)는 전역 클로저 변수와 고정 DOM id 때문에 **함수 단위 추출 리팩터링 필요**(IIFE 안에 갇혀 외부에서 호출 불가; `window.*` export 0건).

---

### 7. 함수 목록 (L1–3175, 53개 named function) 및 대형 함수

| 시작행 | 함수 | 대략 길이(행) |
|---|---|---|
| 111 | toDisplay | 4 |
| 116 | fromDisplay | 4 |
| 121 | unitLabel | 5 |
| 127 | unitDec | 5 |
| 133 | fmtVal | 5 |
| 143 | refreshUnits | 87 |
| 415 | switchTab | 8 |
| 426 | _autoPrepareDesignDsm | 12 |
| 440 | _expandCollapsible | 9 |
| 453 | switchToUS | 8 |
| 461 | switchToSI | 8 |
| 480 | renderPreprocessor | 19 |
| 500 | renderNodeTable | 15 |
| 516 | renderElemTable | 15 |
| 535 | _wireTableEdit | 13 |
| 568 | captureSectionPreview | 45 |
| 617 | renderSectionSVG | 50 |
| 669 | renderSectionAxes | 59 |
| 732 | renderProperties | 5 |
| 738 | updatePropertiesTable | 30 |
| 772 | renderDsmResults | 64 |
| 837 | _dsmHeader | 3 |
| 841 | _dsmRow | 11 |
| 995 | renderLapConnectionResult | 102 |
| 1101 | _verdictOf | 9 |
| 1111 | renderConnectionResult | 61 |
| 1176 | **_drawLapSvg** | **280** |
| 1457 | _dimLineArrow | 19 |
| 1477 | **_drawConnectionSvg** | **210** |
| 1689 | _getMaxMuFromAll | 11 |
| 1702 | _getMaxVuFromAll | 11 |
| 1716 | handleShowSection | 72 |
| 1790 | sendTreeUpdate | 54 |
| 1845 | _pickGoverningPurlinDesign | 25 |
| 1896 | renderVibrationResult | 23 |
| 1920 | renderPlasticSurface | 65 |
| 2002 | _drawPMChart | 158 |
| 2216 | renderStressPreview | 155 |
| 2277 | toSvg (renderStressPreview 내부) | 3 |
| 2394 | updateG | 8 |
| 2470 | **renderBucklingCurve** | **256** |
| 2504 | drawChart (renderBucklingCurve 내부) | 205 |
| 2730 | renderModeShape2D | 120 |
| 2852 | populatePostSelects | 48 |
| 2906 | _resetClassifyBtn | 4 |
| 2924 | _canvasPng | 9 |
| 2934 | _buildBucklingReportHtml | 36 |
| 2982 | renderClassifyCurve | 87 |
| 3073 | renderModeShape3DWrapper (async) | 57 |
| 3134 | setStatus | 7 |
| 3142 | setValue | 4 |
| 3148 | setValueAndNotify | 7 |
| 3156 | getNum | 12 |

추가로 익명 이벤트 핸들러: 메시지 스위치(L234–404, 171행), 탭 버튼, 단위 버튼, Lap 버튼(L876–920, 45행), 단일 접합 버튼(L925–955), updateConnTypeUI 화살표 함수(L971–990), 소성/진동/템플릿/해석(L2412–2464, 53행)/분류/보고서 버튼, load-case change.

대형 함수 상위: `_drawLapSvg` 280, `renderBucklingCurve` 256(내부 drawChart 205), `_drawConnectionSvg` 210, 메시지 핸들러 171, `_drawPMChart` 158, `renderStressPreview` 155, `renderModeShape2D` 120, `renderLapConnectionResult` 102.

---

### 8. 이 구간에서 발견한 문제/주의점 (현재 코드 기준)

1. 웹뷰 상태 비영속: `getState/setState` 미사용 → 패널 재생성 시 결과 전부 소실, 단위계 SI로 리셋 (L12, L36).
2. 트리뷰 데이터는 웹뷰가 만든 표시 문자열(`treeUpdate`) → 웹뷰 없이는 트리 갱신 불가 (L1790–1843).
3. MCP `get_section_preview`는 웹뷰 DOM 렌더링에 의존 (L568–612).
4. JS 측 계산/판정 로직 존재: 응력 프리뷰 간이 응력(L2239–2262), 반파장 logspace·prop 구성·loadCase→stressOpts 매핑(L2415–2458), 퍼린 지배 결과 선택(L1845–1869), Lap 입력 Se 유도 `Mnl/Fy`(L884–893), G 자동계산(L2394), 최대 Mu/Vu 추출(L1689–1712), DSM 기준 기본 반파장 선택(L2860–2875).
5. Lap 설계가 템플릿 입력(`tpl-H`, `tpl-t`, `tpl-B`, `tpl-D`)을 직접 읽음 — 사용자 정의(노드 편집/MCP set_nodes) 단면과 불일치 가능 (L901–902, 1181–1187).
6. 단위 토글 누락: `conn-edge-dist` 등 맵에 없는 입력 변환 안 됨(L145–173 vs L912); 캔버스·접합 결과는 토글 시 재그림 안 됨; 분류 곡선 x축 라벨 US 고정(L3060–3062).
7. 2D 모드형상은 u/w 단순 대입 근사 (L2809–2818).
8. `plasticError`/`stressError`는 console만 — 사용자 피드백 없음 (L307–312).
9. `stressApplied`는 노드표만 갱신, 단면/응력 프리뷰 미갱신 (L318–323).
10. 다크 고정 색: 캡처 배경 #1e1e1e, 소성곡면 정보 패널, 캔버스 fallback 색 → 라이트 테마/브라우저에서 대비 문제 (L582, 596, 1965, 1929, 2508).
11. Lap/단일 접합 결과가 같은 `#connection-result`를 덮어씀.
12. `_drawConnectionSvg`가 매번 `<marker id="arrowR">` 정의 — 문서 내 id 중복 (L1667).

---

## 부록 C — app.js 3170–7043 + designState·utils·modeShape3D·theme.css (설계·하중·보고서·검증·저장)

### (원제) C-app2 — `webview/js/app.js` 3170–7043 + designState/utils/modeShape3D/theme.css 인벤토리 초안 (fork C)

범위: `webview/js/app.js` 3170–7043행 전체 정독, `webview/js/designState.js`(387행), `webview/js/utils.js`(47행), `webview/js/charts/modeShape3D.js`(198행), `webview/css/theme.css`(878행) 전체 정독. 입력 기본값(HTML)은 `src/webview/StcfsdPanel.ts` 2869–3472 의 ②하중계산/③설계/④접합부/보고서/검증 탭 마크업을 함께 대조함.

공통 전제
- `app.js` 전체는 하나의 IIFE(`(function(){ ... })();`, 끝 7043행)이다. 아래 "전역"은 진짜 `window` 전역이 아니라 **IIFE 클로저 변수**다. 외부에서 접근 불가 → 부분 임베드 시 가장 큰 장애.
- 내부 저장 단위는 항상 US(in, kip, ksi, kip-in, ft, psf, plf). 표시/입력 레이어만 변환(`toDisplay`/`fromDisplay`/`unitLabel`/`unitDec`/`fmtVal`, app.js:111–133). 초기 단위계는 **SI** (`let _unitSystem = 'SI'`, app.js:36). HTML 기본값은 SI 표시값(예: `config-spacing`=1.0 m, `design-Lb`=3000 mm), `getNum(id, fallback)`(app.js:3156)은 빈 값이면 `DEFAULTS`(app.js:58, SI 원값 + 단위타입) → 없으면 JS 리터럴 fallback(US 값) 순으로 사용.
- 상태 결과 전역(클로저): `lastDsmResult`(22), `_lastDesignResult`(24), `_lastLoadAnalysis`(28), `_lastLapResult`(30), `model`, `analysisResult`, `lastProps` — 선언은 범위 밖(1–35행)이지만 이 범위의 렌더러·보고서·검증이 모두 이 변수들을 직접 읽는다.

---

### 1. ③ 설계 탭 (`#tab-design`) — "A. 좌굴해석 / B. 좌굴해석 결과 / C. 부재 설계"

탭 구조(마크업 StcfsdPanel.ts:3031–3384). A·B(FSM 입력·결과)는 범위 밖(fork B) 코드가 처리하고, 이 범위는 **C. 부재 설계**와 스텝 표시기·재료 동기화를 담당.

#### 1.1 공통 UI 장치
| 장치 | 위치 | 동작 |
|---|---|---|
| Collapsible `h3.collapsible` | app.js:3176–3186 | `#tab-design .collapsible` 클릭 → 다음 형제 표시/숨김, `data-expanded`, 아이콘 ▸/▾ |
| 스텝 표시기 `#design-step-indicator` (1 입력 → 2 하중 분석 → 3 설계 검토) | 마크업 3033–3039, `setDesignStep(stepNum, markDone)` app.js:3189–3202 | 하중분석 클릭 시 2, 설계 실행 시 3. 직접입력 모드면 step2 숨김(3571–3574). **클릭 불가**(표시만, CSS는 cursor:pointer) |
| FSM/DSM 연동 상태 스트립 `#design-dsm-status` | `updateDesignDsmStatus(overrideText, ok)` app.js:3306–3327 | `lastDsmResult.P / .Mxx` 존재 시 "✓ 좌굴해석(①~③) 결과 연동됨 — P: Pcrl/Pcrd, Mxx: Mcrl/Mcrd" + 녹색 테두리. 없으면 안내문. `designDsmPrepared` 수신 시 override 텍스트(app.js:393) |
| 입력 검증 규칙 `VALIDATION_RULES` | app.js:3205–3213, `validateDesignInput` 3215–3226 | `design-fy`(1–100 ksi), `design-fu`(1–120), `design-KxLx/KyLy/KtLt`(0.1–10000 in), `design-Lb`(0–10000), `design-Cb`(1.0–3.0). min/max는 US 정의 → SI 표시로 변환. 위반 시 `.input-invalid` 클래스만(메시지 없음). |
| Enter → 다음 입력 포커스 | app.js:3239–3249 | `#tab-design input[type=number]` |
| 규준 툴팁 `SPEC_TIPS` + `specRefSpan(section)` | app.js:3252–3278 | E2, E3.2(.1), E4(.1), F2(.1), F3.2(.1), F4(.1), G2.1, G5, H1.2, H2, H3, I6.2.1, D2, D3, C1 → `<span class="spec-ref" data-tip>` (CSS `::after` 툴팁, theme.css:744–769) |

#### 1.2 재료(Fy/Fu) 단일 소스 동기화
- 원본: ①단면·재료 탭 `input-fy`, `input-fu`, 강종 `input-steel-grade`. 설계 탭 `design-fy`/`design-fu`는 **readonly 미러**(마크업 3193–3195, 기본 245/400 MPa).
- `gradeMap` app.js:3282–3289: SGC400[35.53,58.02], SGC440[42.79,63.82], SGC490[52.94,71.08], SGC570[81.22,82.67], SSC400, A653-33/50/55/80, A792-33/50/80, A1003-33/50 (ksi). 강종 변경 시 Fy/Fu + E=29500, G=11300 ksi 세팅(3369–3381).
- `syncFyValue` 3291–3297 → `input-fy`, `design-fy`, `plastic-fy`, `conn-Fy`; `syncFuValue` 3299–3303 → `input-fu`, `design-fu`, `conn-Fu`.
- `propagateFyFuFromPreprocessor` 3342–3357: Fu<Fy면 `input-fu`에 invalid 표시. `propagateFyFromPlastic` 3359–3366: 소성곡면 탭 `plastic-fy` 편집 시 역방향 동기.
- `updateAnalysisFyDisplay` 3329–3340: `#analysis-fy-display`에 "Fy: x MPa", 해석결과 있으면 경고색(재해석 필요 암시 — 텍스트 경고는 없음).

#### 1.3 부재 유형(모드 전환) — 선택 UI는 ②하중계산 탭에 있음
- `select-member-type`(마크업 2876–2889, ②탭): 자동계산(Calculator) 모드 `roof-purlin`(기본 선택=첫 옵션), `floor-joist`, `wall-girt`, `wall-stud` / 직접입력 모드 `flexure`, `compression`, `combined`, `tension`.
- `CALC_MODES`, `isCalcMode` app.js:3396–3397. Calculator 모드는 설계 시 `member_type='flexure'`로 매핑(3586, 3534). ※ `wall-stud`도 flexure로 매핑됨(스터드 압축/조합 검토 경로 없음 — 확인 필요).
- `updateDesignFieldVisibility` app.js:3501–3576 (76행) 이 제어하는 것:
  - `#calc-mode-section`, `#load-analysis-section` (②탭) 표시 = Calculator 모드, `#loads-tab-hint` = 직접입력 모드.
  - `#design-membertype-echo` ③탭에 "부재 유형: … (②하중계산 탭에서 선택)".
  - 하중 행: floor-joist → `load-L-row`만, 그 외 Calculator → `load-Lr-row`,`load-S-row`; `load-W-row`는 Calculator 공통. (`load-Wp-row`는 제어 안 됨 — 항상 표시)
  - 길이 행: compression/combined → `design-KxLx-row`,`design-KtLt-row`; flexure/combined → `design-Cb-row`,`design-Lb-row`; combined → `design-Cm-row`; flexure/combined → `design-wc-section`(웹크리플링). 제목 `design-lengths-title` 3종 문구.
  - `#member-mode-badge`: "자동 계산 모드: 하중 분석 → 소요강도 자동 입력 → ③탭 설계 검토" / "직접 입력 모드: Pu·Vu·Mu 직접 입력 → ③탭…".
  - ※ `design-Cb-pos-row`, `design-Lb-pos-row`(정모멘트 구간)은 visibility 제어 대상이 아님(항상 표시).

#### 1.4 C. 부재 설계 입력 전체 (마크업 StcfsdPanel.ts:3188–3357 + ②탭 2996–3018)
| 그룹 | DOM id | 단위타입 | HTML 기본(SI) | JS fallback(US) | 비고 |
|---|---|---|---|---|---|
| 재료 | `design-fy`, `design-fu` | stress | 245, 400 MPa | 35.53, 58.02 ksi | readonly |
| 설계법 | `select-design-method` | – | LRFD | 'LRFD' | LRFD/ASD. 해석법 DSM 고정(마크업 3206) |
| 좌굴길이 | `design-KxLx`,`design-KyLy`,`design-KtLt` | length | 3000 mm | 118.11 in | 압축/조합 |
| 정모멘트 | `design-Cb-pos`, `design-Lb-pos` | –, length | 1.0, 0 | 1.0, 0 | Lb(+)=0 → 데크 구속 |
| 부모멘트 | `design-Cb`, `design-Lb` | –, length | 1.0, 3000 mm | 1.0, 118.11 in | `design-Cb-calc`, `design-Lb-calc` 근거 표시 span |
| β 보정 §2.3.3.3 | `chk-beta-dist`(기본 checked), `design-dist-M1M2`, `design-dist-Lm` | –, length | ✓, 0, 0 | | `design-beta-result` 실시간 미리보기 |
| 모멘트 계수 | `design-Cmx`, `design-Cmy` | – | 1.00 | 1.0 | combined만 표시 |
| 웹크리플링 §G5 | `design-wc-N`(89 mm), `design-wc-R`(4.8 mm, radius), `design-wc-support`(EOF/IOF/ETF/ITF), `design-wc-fastened`(fastened/unfastened), `design-wc-web-config`(single/nested_z/multi_web), `design-wc-family`(auto/built_up_i/C/Z/hat/multi_web), `design-wc-flange-condition`(stiffened/unstiffened), `design-wc-Lo`, `design-wc-edge-distance`, `design-wc-nwebs`(1), `design-wc-fastener-spacing` | length 등 | 표 참조 | 0 등 | flexure/combined만 |
| 고급 옵션 | `chk-inelastic-reserve`(§F2.4.2), `chk-cold-work`(§A3.3.2, ①탭에 있음 — ③탭은 `cold-work-status` 알림만), `chk-r-factor` + `select-r-value`(0/0.70/0.65/0.50/0.40/**0.60 기본**/0.70) | – | off/off/off, 0.60 | | Cold Work+IR 동시 시 경고 문구(3686–3700) |
| 소요강도(②탭) | `design-P`(Pu, force), `design-V`(Vu), `design-Mx-pos`(Mu+), `design-Mx`(Mu−), `design-My`(Muy), `design-May-strength`(May 직접입력) | force/moment | 0 | 0 | 위치는 ②탭이지만 설계 payload 구성요소 |
| 단면(①탭) | `tpl-r`, `tpl-t` | radius/thickness | | 0 | payload `R`, `t` (Cold work 등) |

보조 UI
- β 미리보기 `updateBetaPreview` app.js:3743–3761: L=min(Lcrd, Lm), β = 1 + 0.4(L/Lm)^0.7 (1+M1/M2)^0.7, 1.0≤β≤1.3. **TS/JS 측 계산 로직**(표시용 — 실제 설계 β는 Python). Lcrd는 `lastDsmResult.Mxx.Lcrd`.
- 체크 시 자동 채움 `toggleBeta` 3712–3740: `_lastLoadAnalysis.auto_params.negative_regions[0]`의 M1/M2, Ly_in → M1/M2 = −|M1|/|M2|, Lm=Ly. 하중분석 없으면 Lm=Lb, M1/M2=0.
- Cb 도우미 3769–3779: Cb=1.0 → "(균일 모멘트)", 아니면 "§F2.1.1".

#### 1.5 실행 버튼 `btn-run-design` ("▶ 설계 검토 실행")
- payload 구성 `collectDesignRunPayload()` app.js:3583–3638 (US 변환 후) — 필드: `member_type, design_method, Fy, Fu, KxLx, KyLy, KtLt, Lb, Cb, Lb_pos, Cb_pos, Cmx, Cmy, Pu, Mu(=Mux), Mu_pos, Mux, Muy, May_strength, Vu, Tu(=design-P), wc_N, wc_R, wc_support, wc_fastened, wc_web_config, wc_section_family(auto→undefined), wc_flange_condition, wc_overhang, wc_edge_distance, wc_n_webs, wc_support_fastener_spacing, use_inelastic_reserve, use_cold_work, dist_M1_M2, dist_Lm(β 체크 시만), R, t, R_uplift(R 체크 시만)`.
  - `model` 없고 Calculator 모드도 아니면 null → 아무 반응 없이 return(3657) — **무피드백**.
  - 인장의 `Tu`는 `design-P`를 재사용(별도 입력 없음).
- 사전 차단 3661–3667: combined & Muy>0 & May_strength=0 → `#design-validation`(role=alert) 문구 + 포커스.
- 실행 시 `#design-loading` 스피너, 버튼 "Calculating…" disabled, step 3, `vscode.postMessage({command:'runDesign', data})` (3677).
- 호스트: `runDesign` → `handleMcpAction({action:'aisi_design', ...})` StcfsdPanel.ts:339–345 → `aisi_design` 핸들러 1385–1633(대형 TS 로직: 단면 확인, DSM 준비/캐시, 퍼린 경로 등) → Python `aisi_design`. 결과 `designResult` 또는 퍼린 `design_positive` 포함 시 `_pickGoverningPurlinDesign`(app.js:1845, 범위 밖) 로 지배 결과 선택(app.js:363–379).

#### 1.6 설계 결과 출력 `renderDesignResult(data)` app.js:4629–5017 (389행)
출력 대상 DOM: `#design-summary`, `#design-steps`, `#design-interaction-title`, `#design-interaction`, `#design-reference`, `#btn-copy-report`.
- 3상태 판정 `verdictOf` (4659–4667, 함수 내 중복 정의 — `_verdictOf` app.js:1101 과 동일 규칙): pass===true && verification_complete!==false → "✓ OK", pass===false → "✗ NG", 그 외 "⚠ 미검토 (NOT_CHECKED)".
- member_type별 요약:
  - compression/flexure: **강도 카드 3장**(Global/Local/Distort.: Pne/Pnl/Pnd 또는 Mne/Mnl/Mnd, 지배 카드 `governing` + "지배" 배지) + 설계강도 라인(φPn/φMn 또는 Pn/Ω, Mn/Ω) + 지배 모드. flexure & positive_region이면 "부모멘트 구간 (-M) — Mu(-), Lb, Cb" 라벨(이 값은 결과가 아니라 **현재 DOM 입력값**을 읽음 4675–4678 — 결과와 입력 불일치 위험).
  - tension: Tn(항복)/Tn(파단)/지배 모드/설계강도 표.
  - combined: Pn, 설계Pn, Mn(x), 설계Mn(x), [Mn(y)], §C1 αx/αy, [Vn] 표.
  - connection: limit_states 각 설계강도 + 지배 배지 + 설계강도.
- **이용률 게이지 바** `.utilization-bar` (4750–4757): pct=min(util×100,120), 색 ok≤0.75 / warn≤1.0 / fail. 라벨에 3상태 판정.
- 정모멘트 구간(+M): 동일 양식 카드+게이지(4760–4798).
- 미평가 배지 `.warn-badge`(4801–4810): `local_not_evaluated`, `distortional_not_evaluated`, `ft_not_evaluated`(E2.2), `b4_limits_exceeded`.
- 경고 박스(4813–4822): `warnings`, `dsm_warning`, `flexure_x.warnings`.
- 단계별 카드 `.calc-step`(4827–4939): Python `steps[]`(step, name, equation→specRefSpan, formula→`_convertFormulaUnits`, value/unit→`_mapUSUnit`). 정모멘트 구간 7단계(My, Mne(+) Fcre 판정, Mnl(+), Mnd(+), Mn(+), φMn(+), 이용률)는 **JS가 문자열로 재구성**(4857–4922; φ=0.90/Ω=1.67 하드코드, Fcre 영역 판정 2.78Fy/0.56Fy JS 계산). steps 없고 limit_states 있으면 한계상태 카드.
- 조합 검토(4942–4961): P/Pa, Mx/Max, My/May, Total ≤1.0, OK/NG, Eq.
- 웹크리플링/H3(4964–4992): Pn, Equation, Table, Section family, Support, Fastened, Lo, ITF edge, Assumptions, Warnings, H3 P-term/M/Mnfo/Total/Result 또는 미적용 사유.
- 규준 참조(4995–5010): `spec_sections` 툴팁 목록 + `dsm_warnings` 목록.
- `_lastReport = data.report`(Python 평문 보고서) → `btn-copy-report` 표시(5013–5016). 클릭 시 `navigator.clipboard.writeText` (4616–4626).
- 보조: `_summaryRow` 5019–5024, `_convertFormulaUnits` 5027–5038(SI일 때 수식 문자열의 kip-in/kip-ft/kips/ksi/in⁴/in³/in²/in을 정규식 치환 — **문자열 후처리 로직**), `_mapUSUnit` 5041–5055.

#### 1.7 결과 무효화
- `invalidateDerivedResults(scope)` app.js:7002–7017: `_lastLoadAnalysis`(load일 때)·`_lastDesignResult` null, 결과 영역에 "입력이 변경되었습니다…" 문구, `design-interaction` 숨김, 호스트에 `invalidateDerivedResults` 전송, `sendTreeUpdate()`.
- 트리거: `#tab-loads`의 `change` → 'load'(7019–7026); `#tab-design`,`#tab-preprocessor`의 `change` → 'design'(7027–7036). `setValueAndNotify`는 `input` 이벤트만 발생 → 자동입력은 무효화를 유발하지 않음(의도).
- ※ `#tab-connection` 변경은 무효화 대상 아님, `_lastLapResult`는 무효화되지 않음.

---

### 2. ② 하중계산 탭 (`#tab-loads`, Calculator 모드)

#### 2.1 입력 (마크업 StcfsdPanel.ts:2869–3018)
| 그룹 | DOM id | 단위타입 | 기본(SI) |
|---|---|---|---|
| 부재 유형 | `select-member-type` | – | roof-purlin |
| 스팬 유형 | `select-span-type` simple/cantilever/cont-2/**cont-3(기본)**/cont-4/cont-n, `config-n-spans`(5, 2–20, cont-n일 때만 표시) | – | |
| 간격(분담폭) | `config-spacing` | length_ft | 1.0 m |
| 스팬 테이블 `#span-config-tbody` (`buildSpanTable` app.js:3433–3489) | 행=지점(n+1): `.span-tbl-sup`(P/R/F/N, 캔틸레버 F–N), `.span-tbl-len`(스팬, 기본 5 m, step 0.5), `.span-tbl-lapl`/`.span-tbl-lapr`(랩 좌/우, 단순·캔틸레버는 없음, 기본 0) | length_ft | |
| 데크 & 가새 | `select-deck-type`(through-fastened/standing-seam/**none**), `deck-t-panel`(0.5 mm), `deck-fastener-spacing`(300 mm), `deck-kphi-override`(빈칸=auto, rotStiff), `deck-kx-override`(빈칸=auto, latStiff) | | |
| 사용하중(미계수 면압) | `load-D-psf`(0.3 kPa), `load-Lr-psf`(1.0), `load-S-psf`(0.5), `load-Wu-psf`(1.0, 양력↑), `load-Wp-psf`(0, 정압↓), `load-L-psf`(0, floor만) | pressure | |
| 선형하중 표시 | `load-*-plf` span: `updatePLF` app.js:3400–3416 psf×spacing → plf/kN/m 실시간 | | |
| 소요강도 | 1.4절 표 참조 (`design-P/V/Mx-pos/Mx/My/May-strength`) | | |

#### 2.2 실행 `btn-analyze-loads` ("하중 분석 실행") app.js:3784–3903
- Calculator 모드 아니면 무시. 스팬/지점/랩 수집 → US ft. 등스팬이면 span_ft=첫 값, 아니면 최대값. 내부 지점 랩 최대값 `laps.left_ft/right_ft`.
- payload: `member_app, span_type(cont-n→'cont-N'), span_ft, spans_ft[], supports[], laps_per_support[{left_ft,right_ft}], spacing_ft, loads{D,Lr,S,W(=−Wu·s, 음수=양력),Wp,L}(plf), design_method, laps{left_ft,right_ft}, deck{type,t_panel,fastener_spacing,kphi_override,kx_override}, section{depth,flange_width,thickness,lip_depth,R_corner,type(C/Z/Hat/Track 문자열 추정),Fy,Fu,Ixx(lastProps)}`.
  - `section.type`은 `select-template` 값 문자열에 'z'/'hat'/'track' 포함 여부로 추정(3800–3806) — 템플릿이 아닌 사용자정의 단면은 'C'로 간주.
  - `Ixx`는 `lastProps`(①탭 성질 계산 결과) 필요 → 없으면 0 → 처짐 미계산.
- `vscode.postMessage({command:'analyzeLoads', data})` (3901). 호스트 StcfsdPanel.ts:356–363 → `handleMcpAction('analyze_loads')` 1649–1655 → Python `analyze_loads`, `_lastLoadAnalysis` 호스트에도 저장(입력 리비전 검사 `_requireDerivedRevision`). 응답 `loadAnalysisComplete`.

#### 2.3 출력 `renderLoadAnalysisResult(data)` app.js:4163–4566 (404행) → `#load-analysis-result`
1. **보 개략도 SVG** `renderBeamSchematic(data)` 3906–4015: 부등스팬, 지점기호 P(삼각+선)/R(삼각+원)/F(채움+해치)/N(점선원), 랩 구간 굵은 하늘색 + 랩 치수, 스팬 치수선.
2. **모멘트도 SVG** `renderDiagramSVG(...)` 4018–4160: 지배조합 M_diagram(kip-ft, 부호 반전 표시), 변곡점–지점 비지지 치수선 `Ly=…`(negative_regions, 주황), Lap end 주석(보라), 실제 x좌표 `x_diagram` 사용, max/min 라벨.
3. **전단력도 SVG**: V_diagram + Lap end 주석.
4. 지배 조합 표: Location / Mu / Vu / Ru (`gov.locations`).
5. 중력 지배가 다르면 `<details>` 접이식 표, 양력(Uplift) Mu 표.
6. 입력 하중(plf) 요약 + **하중조합 상세 표**(ASCE 7, LRFD/ASD): 조합명, 조합 수식("1.2×D(…) + 1.6×Lr(…)" JS 조립), |M|max, |V|max, 지배 표시(★지배/중력▲/양력▼).
7. **처짐도 SVG** + 스팬별 최대처짐 표(위치, δ, L/δ) — `deflection.valid!==false`일 때.
8. Auto Parameters 박스: 데크 kφ/kx(+경고), Positive braced, Negative Ly/Cb, Uplift R.
9. **자동 채움(하중→설계)** 4404–4529:
   - `design-Mx` ← 부모멘트 |Mu|×12(kip-ft→kip-in). 랩이 있고 Lap end 값이 있으면 **Lap end 부모멘트**를 단일단면 검토용으로 사용(4430–4432).
   - `design-Mx-pos` ← 최대 정모멘트, `design-V` ← 최대 |Vu|.
   - `design-Lb`/`design-Cb` ← 지배 부모멘트 구간(양력 지배면 `uplift_bracing.negative_region`) Ly/Cb, `design-Lb-calc`/`design-Cb-calc` 근거(Cb 식 전개 문자열).
   - β: `chk-beta-dist` 체크 + M1/M2, Lm.
   - R: 양력 지배 & uplift_R>0이면 `chk-r-factor` 체크 + `select-r-value`.
   - `design-Lb-pos`/`design-Cb-pos` ← positive_region(+근거).
   - 상태바 "지배 조합: … (Mu=…)".
   - (setValueAndNotify로 input 이벤트 발화 → 검증/미리보기 반응)
10. 네비게이션 버튼: `btn-goto-design`("→ ③좌굴해석·부재설계 탭에서 설계 검토 실행", `switchTab('design')`만 — 실행은 안 함).
11. **하중→Lap 자동 채움** `_autoFillLapInputs(data)` 4568–4612: `conn-lap-left/right` ← 최대 랩(ft→in), `conn-Mu` ← `StcfsdDesignState.selectLapGoverningMoment(locations)`(Lap end·정모멘트 제외, 지점 부모멘트 최대 |Mu|)×12, `conn-Mu.title`에 근거, `conn-Vu` ← 최대 |Vu|. 랩>0이면 `btn-goto-lap-design` 버튼("→ ④접합부 탭에서 Lap 접합부 설계 실행": 탭 전환 + `btn-run-lap-design.click()` **자동 실행**).
12. 버튼 복원("📊 하중 분석 실행" — HTML 원문은 "하중 분석 실행", 문구 불일치).

#### 2.4 흐름 요약
`①단면(tpl-*, lastProps.Ixx, Fy/Fu)` → `②하중 분석(analyze_loads)` → [자동] `②소요강도 design-Mx/Mx-pos/V`, `③Lb/Cb/Lb-pos/Cb-pos/β/R` , `④conn-lap-left/right, conn-Mu, conn-Vu` → `③설계 검토(aisi_design)` → `④Lap 설계(lap_connection)` → 보고서/검증.
- 설계 시 DSM 값: ③A 해석 실행(analysisComplete) → `_autoPrepareDesignDsm()`(app.js:426, 범위 밖)이 `prepareDesignDsm` 전송 → 호스트 `prepare_design_dsm`(StcfsdPanel.ts:1216) → `designDsmPrepared`. `aisi_design` 핸들러가 준비된 DSM(`_preparedDesignDsm`)을 사용. 웹뷰 `lastDsmResult`는 표시·β 미리보기·보고서·검증용.

---

### 3. 보고서 탭 (`#tab-report`)

- 마크업 StcfsdPanel.ts:3458–3466: `btn-generate-report`("상세 보고서 생성"), `btn-print-report`("PDF 저장", 생성 후 표시), `#report-container`.
- 생성 `generateDetailedReport()` app.js:5122–5166 → **HTML 문자열**을 `report-container.innerHTML`에. 설계·하중 결과 둘 다 없으면 오류 문구(5067–5070).
- 언어: 한국어 본문(일부 영어 표 헤더 혼재 — 압축 단계 "Condition/Equation" 5811–5829). 제목 "CUFSM — 냉간성형강 설계 보고서"(StCFSD가 아닌 CUFSM 브랜딩), 날짜 `toLocaleString()`, 푸터 "CUFSM 냉간성형강 단면 설계 프로그램 — AISI S100-16 DSM".
- 섹션 구성:
  1. **단면** `_rptSection` 5171–5228: 180×180 단면 SVG(model.node/elem, 절점 주황점), 단면 제원 표(단면 유형 한글명 lippedc/lippedz/hat/track/rhs/chs/angle/isect/tee, H/B/D/t/r은 **DOM tpl-* 현재 표시값**, 절점/요소 수), 계산 단면성질 표(A, Ixx, Izz, Ixz, Sx, Sz, Zx, Zz, rx, rz, xcg, zcg, θp, I11, I22 — `lastProps`).
  2. **탄성 좌굴 해석** `_rptBuckling` 5233–5329: 500×220 **시그니처 곡선 SVG**(log-x, 선형 y, 그리드), DSM 극점 마커(Pcrl/Mcrl 빨강, Pcrd/Mcrd 주황, Pcre/Mcre 보라 — `lastDsmResult` 우선 Mxx, 없으면 P), DSM 설계값 표(Py, Pcrl, Pcrd, Pcre / My, Mcrl, Mcrd, Mcre + 반파장 + 하중계수), 최솟값 개수·목록.
  3. **설계 입력** `_rptDesignInput` 5334–5413: 재료(강종명, Fy, Fu, E=29500ksi 고정, ν=0.30 고정 — 실제 입력 E/G 반영 안 함), 부재 구성(부재 적용, 스팬 유형·경간수, 스팬 길이, 분담폭, 설계법, 랩 좌/우), 설계 하중 표(psf→plf), 데크 정보.
  4. **하중 분석 결과** `_rptLoadAnalysis` 5418–5560 (la 있을 때): 보 개략도, M/V도(밝은 색 버전), 지배조합 표(위치, x, Mu, Vu, Ru, 구간), 양력 표, 하중조합 상세 표, **자동 결정 설계 매개변수 표**(kφ/kx 산정 근거 "Chen & Moen 기반 예비설계 근사치"/"RP17-2 Ex II-1C 보정 0.0379"/시험값, Ly(+)/Cb(+), Ly(−)/Cb(−) 식, R §I6.2.1, 변곡점), 처짐도 + 스팬별 표 + E, Ixx.
  5. **설계 계산** `_rptDesignCalc` 5565–5614 → `_rptFlexure`(5616–5800, 185행: 단계1 My, 단계2 F2 Fcre 3영역 표, 단계3 λl 0.776, 단계4 λd 0.673, 단계5 Mn·φ/Ω·DCR, 정모멘트 구간 동일 5단계, **종합 판정 표**, §A3.3.2 Cold Work 표(Fyv/Fya/Bc/m/C/R/t), **Lap Splice 접합부 표**(`_lastLapResult`: 랩 길이≥1.5d, 패스너 n·행·간격, 전달 전단, 용량 DCR, 2겹 휨 DCR, 종합)), `_rptCompression`(5802–5839: Py, E2 λc 1.5, E3.2, E4 λd 0.561, Pn, φ=0.85/Ω=1.80 — **이용률 미표시**), `_rptCombined`(5841–5857: Pn, Mn(x), §C1 PEx/αx/Mux,amp — My/Vn 미표시), `_rptTension`(5859–5867). 공통: §H1.2 조합표(소요/저항 열은 **빈칸**), §H2 휨+전단 SRSS 표, 계산 단계 요약 표(Python steps).
  6. **설계 요약** `_rptSummary` 5872–5973: 서술문(부재유형·설계법·경간·지배조합·지배모드), 요약표(기준, 해석법, 부재유형, 설계법, 지배모드, Mn/φMn/DCR 정·부, Pn, 종합, 조합검토, 참조 조항), 설계 경고 목록, NOT_CHECKED 안내.
- **누락**: 단일 접합부(④ `connectionResult`) 결과, 모드형상(2D/3D), cFSM 모드분류, 소성 P-M 곡면, 진동해석, 웹크리플링 상세(요약표에만 일부), 검증 대시보드 결과, 입력 버전/프로젝트 파일명. 커버 페이지·페이지 번호·서명란 없음.
- 단위 토글 시 보고서가 열려 있으면 재생성(app.js:219–222).
- **PDF 저장** `btn-print-report` app.js:5078–5113: report innerHTML을 독립 HTML 문서로 래핑 — `:root`에서 `--vscode-*` 7개 변수를 **라이트 값으로 재정의**(foreground #222, editor-background #fff 등) + 인쇄 CSS(`@media print`) → `vscode.postMessage({command:'saveReportPdf', data:{html}})`. 호스트 `_saveReportPdf` StcfsdPanel.ts:2536–2622: `showSaveDialog`(PDF/HTML) → .html이면 그대로 저장, .pdf면 임시 HTML → **시스템 Edge/Chrome headless `--print-to-pdf`**(`_findBrowser` 2630–2652, Windows Program Files 경로) → 없으면 HTML 폴백. `window.print()`는 사용하지 않음(webview에서 불가).
- 보조: "보고서 클립보드 복사"(③탭, Python `report` 평문) — 상세 HTML 보고서와 별개 산출물.
- **MCP와의 관계**: MCP `generate_report`(StcfsdPanel.ts:1657–1731)는 **데이터 JSON만 반환**(section_props, cutwp, dsm, load_analysis, design_result). 위 HTML 보고서(`generateDetailedReport`)는 웹뷰 JS 전용 — MCP/AI로 생성·저장 불가.

---

### 4. 검증 탭 (`#tab-validation`) — 설계 검증 대시보드

- 마크업 StcfsdPanel.ts:3469–3475: `btn-run-validation`("설계 검증 실행"), `#validation-summary-badge`, `#validation-container`.
- 클릭 app.js:5982–5999: `runAllValidationChecks()` → `renderValidationDashboard(checks)` → 배지 "통과 n / 주의 n / 실패 n" → `treeUpdate {validationPass, validationWarn, validationFail}` 전송(사이드바 트리에 반영).
- **전부 웹뷰 JS 로직** (`runAllValidationChecks` app.js:6005–6902, **898행 — 범위 최대 함수**, `checks.push` 70곳). Python 호출 없음. 입력: DOM(`tpl-H/B/D/t/r`, `design-fy/fu`, `input-fy`, `input-len-min/max/n`, `select-bc`, `select-load-case`, `select-member-type`, `config-spacing`, `.span-tbl-len`, `load-*-psf`, `design-Lb/Cb`) + 클로저 결과(`model`, `lastProps`, `analysisResult`, `lastDsmResult`, `_lastLoadAnalysis`, `_lastDesignResult`, `_lastLapResult`).
- 항목(check = {category,item,status pass|warn|fail,value,criterion,note}):
  - A. 단면 입력: 단면 정의, 두께 t(0.018–0.5 in), 웹 w/t(≤200 pass, ≤500 warn), 플랜지 b/t(≤60/≤160), 립 d/t(≤60), R/t(≤10/≤20). (※ w/t 계산은 표시단위 그대로 H−2(t+r))/t — 단위 무관 비율이라 OK, 템플릿 파라미터 기반이라 사용자정의 단면은 0 → 생략)
  - B. 재료: Fy≤95 ksi, Fu/Fy≥1.08, Fu>Fy.
  - C. 좌굴 해석: 반파장 최솟값 ≤0.8H, 최댓값 ≥ max(Lb, 최대스팬, 120in)(1.5배 권장), 개수≥30, BC(항상 pass, 안내), Load Case–부재유형 일치, 해석 실행 여부, DSM 추출, Mcrl 식별, Mcrd 식별(§2.3.3.3 fallback 가능 여부).
  - D. 단면 성질: 계산 여부, Sx>0, rx/rz>0.
  - E. 하중 입력: 스팬(≤40ft pass, §I6.2.1 33ft 문구 — 기준값 불일치: status는 40ft, note는 33ft), 간격(≤8ft), D>0, 중력 활/적설, 풍 양력(정보).
  - F. 하중 분석: 실행 여부, 최대 Mu, Vu 존재, Ly(−)/Cb(−), 양력 R(기본 0.60 경고), Ly(+)/Cb(+) 또는 데크 구속, Lap end Mu 추출, **처짐 L/δ**(IBC Table 1604.3: floor-joist L/360·L/240, 그 외 L/240·L/180 — 활하중 한계만 판정), 처짐 해석 실패/미계산.
  - G. 설계 결과: 실행 여부, Mne vs My(IR 고려), §F2.4.2 IR, §I6.2.1 R, §A3.3.2 Cold Work 4상태, Cold Work↔IR 배타, Mnl vs Mne, Mnd vs My, "모든 Mn 동일" 진단(λl/λd 재계산 — **JS 측 공학 계산**), 정모멘트 φMn(+)·LTB, Pnl/Pnd(압축), 이용률(−)/(+)(≤0.95 pass, ≤1.0 warn), Lb/Cb, 저항계수(LRFD만), §H1.2, DSM 경고, 설계 경고(§2.3.3.3 fallback은 pass로 표시), DSM 추출 경고.
  - G2. Lap 접합부(flexure & 랩 있음): 2겹 휨(`d.design_lap`), 지점별 랩≥1.5d(H 기준 JS 계산), 패스너 전단 DCR, Lap 휨 DCR, 종합, 미실행 시 fail.
  - H. 일관성: 해석 Fy(`input-fy`) vs 설계 Fy(`design-fy`) — 둘은 동기화되므로 사실상 항상 pass; "해석 최신성"은 결과 존재 시 **무조건 pass**(실제 시그니처 비교 없음 — 호스트에는 `_isAnalysisCurrent()`가 있음).
- 표시 `renderValidationDashboard(checks)` 6904–6948 (순수: checks→HTML): 카테고리별 헤더(좌측 색 띠, 통과/주의/실패 카운트) + 표(아이콘 ✓/!/✗, 항목, 값(monospace), 기준) + note 행(→ 이탤릭).
- **MCP와의 관계**: MCP `validate_design`(StcfsdPanel.ts:1756–1797)은 원자료(props, cutwp, dsm, last_load_analysis, last_design_result, status)만 반환 — 위 70개 판정 규칙은 GUI 전용. GUI/MCP 판정 비대칭.

---

### 5. 설계 입력 수집/복원 (`.csd`의 `designInputs`)

#### 5.1 경로
- 저장: `btn-file-save` → `saveProject`(app.js:6997) → 호스트가 `collectDesignData` 요청(StcfsdPanel.ts:272–276) → 웹뷰 `collectAllDesignInputs()`(app.js:6954–6966) → `designDataCollected` → `_saveProject(designData)`(StcfsdPanel.ts:3495–3549).
- 열기: `btn-file-open` → `openProject`(app.js:6992) → `_openProject`(3552–3621) → `modelLoaded`, [`analysisComplete`+`dsmResult` 또는 `analysisInvalidated`], `loadAnalysisComplete`, `designResult`, `propertiesResult`, **마지막에** `restoreDesignInputs` → `restoreAllDesignInputs(data)`(app.js:6968–6984).
- 실제 로직은 `StcfsdDesignState`(designState.js, UMD)에 DI(`document, fromDisplay, getNum, getUnitSystem` / `document, toDisplay, buildSpanTable, setTimeoutFn, updateAnalysisFyDisplay, setUnitSystem`)로 위임 — node 테스트 `test/webview/design_state_roundtrip.js`로 왕복 검증.

#### 5.2 `.csd` 최상위 스키마 (StcfsdPanel.ts:3504–3541, version '1.2')
`version:'1.2', format:'cufsm-section-design', timestamp, model, derivedStateSignature, analysisResult(현재 시그니처일 때만), loadAnalysis, designResult, designInputs, dsm{P,Mxx,Mzz,load_family,warning}(옵션), preparedDesignDsm(옵션), properties(옵션)`.
- 열기 시 버전 검사·마이그레이션 없음(`projectData.model` 존재만 확인). analysisResult는 `_meta.signature` 일치 시만 복원, designResult/preparedDesignDsm은 `derivedStateSignature` 일치 시만.
- **`_lastLapResult`(Lap 접합부 결과)와 단일 접합부 결과, 검증 결과, 소성/진동/분류 결과는 저장되지 않음** → 재열기 후 보고서의 Lap 섹션·검증 G2가 "미실행"으로 바뀜.

#### 5.3 `designInputs` 필드 (designState.js:8–153, 모두 US 내부값)
| 분류 | 키 → DOM id |
|---|---|
| 단위 | `unitSystem` |
| 재료 | `fy`←design-fy, `fu`←design-fu, `fyLoad`←input-fy, `presteelGrade`←input-steel-grade |
| 방법 | `designMethod`←select-design-method, `analysisMethod`='DSM' 고정, `memberType`←select-member-type |
| 부재 구성 | `spanType`, `nSpans`←config-n-spans, `spacing`←config-spacing(ft), `spans[]`, `supports[]`, `lapsPerSupport[{left,right}]`(ft) |
| 하중 | `loadD/Lr/S/Wu/Wp/L`(psf) |
| 데크 | `deckType`, `deckTPanel`, `deckFastenerSpacing`, `deckKphiOverride`, `deckKxOverride`(null=auto) |
| 길이·계수 | `KxLx, KyLy, KtLt, Lb, Cb, Cmx, Cmy` |
| 소요강도 | `Pu`←design-P, `Vu`, `Mux`←design-Mx, `Muy`←design-My, `MayStrength` |
| 웹크리플링 | `wcN, wcR, wcSupport, wcFastened, wcWebConfig, wcFamily, wcFlangeCondition, wcLo, wcEdgeDistance, wcNWebs, wcFastenerSpacing` |
| 템플릿 | `templateType`←select-template, `tplH, tplB, tplD, tplT, tplR, tplQlip` |
| 해석 설정 | `analysisBC, analysisLoadCase, analysisNeigs, analysisLenMin, analysisLenMax, analysisLenN, analysisLoadP, analysisLoadMxx, analysisLoadMzz`(※ P/Mxx/Mzz는 **변환 없이 표시값 저장** — 단위계 바뀌면 왜곡) |
| 체크박스 | `chkColdWork, chkInelasticReserve, chkBetaDist, chkRFactor, chkCfsmEnable, chkCfsmG/D/L/O` |
| 접합부 | `connFastenerType, connSingleType, connGrooveType, connLapLeft, connLapRight, connT1, connT2, connD, connFy, connFu, connFub, connFuf, connPu, connMu, connVu, connWeldL, connWeldSize, connFastenerDia, connNRows, connN` |

**저장 누락 입력(확인됨, grep 0건)**: `design-Mx-pos`(Mu+), `design-Lb-pos`, `design-Cb-pos`, `design-dist-M1M2`, `design-dist-Lm`, `select-r-value`(R 값), `conn-edge-dist`, `input-E`, `input-G`. → 재열기 시 정모멘트 구간 검토·β·R 값·볼트 단부거리가 기본값으로 돌아감. 테스트(`design_state_roundtrip.js`)도 이들을 다루지 않음.

#### 5.4 복원 동작과 결함
- 단위계 먼저(`switchToUS/SI`) → 값 setValue(이벤트 미발화) → `buildSpanTable()` → **100ms setTimeout** 후 스팬/지점/랩 값 채움(designState.js:207–227, 타이밍 의존).
- 이벤트를 발화하지 않으므로 다음 파생 UI가 **갱신되지 않음**: `updateDesignFieldVisibility`(부재유형별 섹션 표시 — 저장값이 직접입력 모드여도 Calculator 섹션이 보이는 등), `updatePLF`, `toggleBeta`(β 입력 표시), `updateColdWorkNotice`, Load Case `custom-load-inputs` 표시, 검증 규칙 표시. (`updateAnalysisFyDisplay`만 직접 호출)
- `design-fu`·`input-fu`는 복원하지만 `conn-Fu`는 별도 키로 복원. `input-fy`는 `fy` 우선으로 덮어씀(design-fy가 원천처럼 취급됨 — 원래 단일소스는 input-fy).
- 호스트가 `designResult`를 `restoreDesignInputs`보다 먼저 보내므로 `renderDesignResult`의 "부모멘트 구간 Mu(−), Lb, Cb" 라벨은 복원 전 DOM 값을 표시.

---

### 6. 이 범위의 메시지

#### 6.1 webview → host (`vscode.postMessage`)
| command | payload | app.js | host 처리 (StcfsdPanel.ts) | Python |
|---|---|---|---|---|
| `runDesign` | `collectDesignRunPayload()` 필드(1.5절) | 3677 | 339–345 → `handleMcpAction('aisi_design')` 1385–1633 (TS 대형 전처리: 단면/DSM 준비·캐시, 퍼린 분기) | `aisi_design` (+ DSM 준비 시 analysis 관련) |
| `analyzeLoads` | 2.2절 payload | 3901 | 356–363 → `analyze_loads` 1649–1655 (리비전 검사) | `analyze_loads` |
| `saveReportPdf` | `{html}` (라이트 테마 래핑 HTML) | 5111 | 294–296 → `_saveReportPdf` 2536–2622 (save dialog, headless Edge/Chrome PDF) | 없음 |
| `treeUpdate` | `{validationPass, validationWarn, validationFail}` | 5995–5997 | 365–368 → `_updateTreeView(data)` | 없음 |
| `openProject` | – | 6992 | 286–288 → `_openProject` 3552 | 없음 (fs) |
| `saveProject` | – | 6997 | 272–276 → `collectDesignData` 요청 | `_saveProject`에서 `get_properties` |
| `designDataCollected` | `collectAllDesignInputs()` | 398 (범위 밖 수신부에서 응답) | 278–284 → `_saveProject` 3495 | `get_properties`, DSM 추출 |
| `invalidateDerivedResults` | `{scope:'load'|'design'}` | 7015 | 264–270 (`_derivedInputRevision++`, 결과 null) | 없음 |
| `webviewReady` | – | 7041 | 217 | 없음 |
(`sendTreeUpdate()`는 app.js:1790 정의, 범위 밖 — 이 범위에서 7016 등에서 호출)

#### 6.2 host → webview (이 범위 함수가 소비하는 것; 수신 switch는 app.js:234–404, 범위 밖)
| command | 소비 함수 | 수신 위치 |
|---|---|---|
| `designResult` / `designPurlinResult` | `renderDesignResult` (퍼린은 `_pickGoverningPurlinDesign`) | app.js:363–379 |
| `loadAnalysisComplete` | `renderLoadAnalysisResult` (+자동 채움) | 383–386 |
| `lapConnectionResult` | `_lastLapResult` → 보고서/검증 | 356–359 |
| `dsmResult` | `lastDsmResult` → `updateDesignDsmStatus`, β 미리보기, 보고서 | 342–355 |
| `designDsmPrepared` | `updateDesignDsmStatus(override)` | 387–396 |
| `analysisInvalidated` | 결과 초기화 + `updateDesignDsmStatus` | 267–275 |
| `collectDesignData` | `collectAllDesignInputs` → `designDataCollected` | 397–399 |
| `restoreDesignInputs` | `restoreAllDesignInputs` | 400–402 |

---

### 7. 전역/상태 변수와 함수 목록 (범위 3170–7043)

#### 7.1 IIFE 최상위 선언 34개 (`const/let/var` 들여쓰기 4칸)
상수/테이블: `VALIDATION_RULES`(3205), `SPEC_TIPS`(3252), `gradeMap`(3282), `CALC_MODES`(3396).
DOM 캐시: `designInputs`(3239), `selGradePre`(3369), `fyPreEl`,`fuPreEl`,`fyPlasticEl`(3384–3386), `selSpanType`(3422), `selMemberType`(3499), `btnDesign`(3582), `chkIR`,`chkCW`,`cwStatusEl`(3683–3685), `chkBeta`,`betaInputs`,`betaResult`(3706–3708), `cbEl`,`cbCalcEl`(3769–3770), `btnAnalyze`(3784), `btnCopyReport`(4616), `btnGenReport`,`btnPrintReport`,`reportContainer`(5061–5063), `btnValidation`,`validationContainer`,`validationBadge`(5978–5980), `btnFileOpen`,`btnFileSave`(6988–6989), `loadsPanel`(7019).
함수 변수: `updateColdWorkNotice`(3686), `updateBetaPreview`(var, 3710 — 재할당됨).
**가변 상태: `_lastReport`(let, 4615)** — 이 범위 신규 상태는 이것 하나. 나머지 결과 상태(`model, analysisResult, lastProps, lastDsmResult, _lastDesignResult, _lastLoadAnalysis, _lastLapResult, _unitSystem`)는 범위 밖 선언이지만 이 범위에서 읽고 씀(쓰기: `_lastLoadAnalysis` 4172, 7004 / `_lastDesignResult` 7008).
**진짜 window 전역**: 이 범위에는 신규 없음. 읽는 전역: `globalThis.StcfsdDesignState`(4595, 6955, 6969), `window.setTimeout`(6977), `navigator.clipboard`(4620), `vscode`(acquireVsCodeApi 결과, 범위 밖). 별도 파일: `globalThis.StcfsdUtils`, `globalThis.StcfsdDesignState`, `window.renderModeShape3D`.

#### 7.2 함수 52개 (스캐너 기준, 이름·시작–끝·행수)
setDesignStep 3189–3202(14) · validateDesignInput 3215–3226(12) · specRefSpan 3275–3278(4) · syncFyValue 3291–3297 · syncFuValue 3299–3303 · updateDesignDsmStatus 3306–3327(22) · updateAnalysisFyDisplay 3329–3340 · propagateFyFuFromPreprocessor 3342–3357 · propagateFyFromPlastic 3359–3366 · isCalcMode 3397 · updatePLF 3400–3411 · getSpanCount 3424–3431 · buildSpanTable 3433–3489(57) · updateDesignFieldVisibility 3501–3576(76) · collectDesignRunPayload 3583–3638(56) · showDesignValidation 3639–3649 · clearDesignValidation 3650–3653 · updateColdWorkNotice 3686–3700 · updateBetaPreview 3710/3743–3761 · toggleBeta 3712–3740(29) · normalizedSectionType 3800–3806 · **renderBeamSchematic 3906–4015(110)** · ftToX 3938 · **renderDiagramSVG 4018–4160(143)** · idxToPixelX 4035–4040 · **renderLoadAnalysisResult 4163–4566(404)** · _autoFillLapInputs 4568–4612(45) · **renderDesignResult 4629–5017(389)** · verdictOf 4659–4667 · _summaryRow 5019–5024 · _convertFormulaUnits 5027–5038 · _mapUSUnit 5041–5055 · _rv 5116 · _ruv 5118 · _rul 5120 · generateDetailedReport 5122–5166(45) · _rptSection 5171–5228(58) · _rptBuckling 5233–5329(97) · _rptDesignInput 5334–5413(80) · **_rptLoadAnalysis 5418–5560(143)** · _rptDesignCalc 5565–5614(50) · **_rptFlexure 5616–5800(185)** · _rptCompression 5802–5839 · _rptCombined 5841–5857 · _rptTension 5859–5867 · _rptSummary 5872–5973(102) · verdictOf 5876–5884 · **runAllValidationChecks 6005–6902(898)** · renderValidationDashboard 6904–6948(45) · collectAllDesignInputs 6954–6966 · restoreAllDesignInputs 6968–6984 · invalidateDerivedResults 7002–7017.
최대 함수 Top 5: runAllValidationChecks 898, renderLoadAnalysisResult 404, renderDesignResult 389, _rptFlexure 185, renderDiagramSVG/_rptLoadAnalysis 143.
기타 규모: 범위 내 인라인 `style=` 157회, 하드코딩 hex 색 132개, `var(--vscode-*)` 인라인 50회(fallback 있는 것 5회).

#### 7.3 중복 로직
- `verdictOf` 3중 정의(app.js:1101 `_verdictOf`, 4659, 5876 — 주석 "VM 추출 실행 대비").
- 랩 존재 판정 `laps_per_support.some(...)` 4413, 6425, 6796.
- Lap end 주석 생성 4214–4232, 4246–4259, 5422–5434 (3회).
- 하중조합 수식 조립 4336–4346 vs 5478–5484, 조합표 화면용/보고서용 2벌.
- 정모멘트 구간 단계 문자열 화면용(4857–4922) vs 보고서용(5686–5753) 2벌.
- φ/Ω 상수 하드코드: 0.90/1.67(4862, 5618), 0.85/1.80(5804) — Python 결과값과 별도.

---

### 8. 시각 컴포넌트 (범위 + 별도 파일)

| 컴포넌트 | 진입 함수 | 입력 | 출력 | 순수성 |
|---|---|---|---|---|
| 보 개략도(지점·랩·치수) | `renderBeamSchematic(data)` app.js:3906 | load analysis 결과(`n_spans, spans_ft, supports, laps_per_support, gravity.locations`) | SVG 문자열(480×80) | 거의 순수 — `fmtVal/unitLabel`(클로저 `_unitSystem`), 색은 `var(--vscode-foreground/descriptionForeground)` |
| M/V/처짐도 | `renderDiagramSVG(values,label,color,flipSign,dimLines,annotations,xCoords)` 4018 | 값 배열, 치수선·주석 배열, x좌표 | SVG 문자열(480×130–170) | **반순수** — 지점 마커를 위해 클로저 `_lastLoadAnalysis`를 직접 읽음(4065–4082); 배경/테두리 `--vscode-*` |
| 하중분석 결과 패널 | `renderLoadAnalysisResult(data)` 4163 | 결과 | `#load-analysis-result` innerHTML + **다른 탭 입력 자동 기입**(design-*, conn-*) + 버튼 생성 | 강한 결합(DOM id 20여 개, 상태 쓰기) |
| 강도 카드/이용률 게이지/경고 배지/단계 카드 | `renderDesignResult(data)` 4629 내부 HTML 문자열 | 설계 결과 + 일부 DOM 입력 | `#design-summary`, `#design-steps`, `#design-interaction`, `#design-reference` | 결합 — 분리 함수 없음(카드·게이지 생성이 인라인) |
| 규준 툴팁 | `specRefSpan(section)` 3275 | 조항 문자열 | HTML span | 순수(CSS 툴팁 theme.css:744) |
| β 미리보기 | `updateBetaPreview` 3743 | DOM + `lastDsmResult` | `#design-beta-result` | 결합 |
| 상세 보고서 | `generateDetailedReport()` 5122 (+ `_rpt*`) | 클로저 7종 + DOM 다수 | HTML 문자열 | 결합(문자열 반환이므로 렌더 위치는 자유) |
| 보고서 단면도 | `_rptSection` 5171–5187 | `model.node/elem` | SVG 180×180 | 추출 쉬움(+DOM tpl-* 표) |
| 보고서 시그니처 곡선 | `_rptBuckling` 5233–5297 | `analysisResult.curve`, `lastDsmResult` | SVG 500×220 (정적, 라이트 색 하드코드) | 추출 쉬움 — 화면용 Canvas 곡선(범위 밖 `renderBucklingCurve`)과 **별도 구현** |
| 검증 대시보드 | `renderValidationDashboard(checks)` 6904 | checks 배열 | HTML 문자열 | **순수** |
| 검증 규칙 엔진 | `runAllValidationChecks()` 6005 | DOM + 클로저 7종 | checks 배열 | 강한 결합(898행) |
| 3D 모드형상(캔버스 폴백) | `window.renderModeShape3D(canvas,nodes,elems,modeVec,length,BC)` modeShape3D.js:27 | 캔버스, 절점/요소, 모드벡터, 반파장, BC | 2D canvas 등각 와이어프레임(반파 반복, 변위 크기 색상 파랑→빨강) | **순수**(전역 함수, `getComputedStyle(document.body)`의 `--vscode-editor-foreground`, fallback '#ccc'). 주 렌더러는 `media/viewer3d.js`의 `CufsmViewer3D`, 이 파일은 폴백(app.js:3112–3127) |

---

### 9. theme.css / utils.js / modeShape3D.js / designState.js

#### 9.1 theme.css (878행)
- `--vscode-*` 참조 **97회, 32종**. fallback 있는 것 35회, **fallback 없는 것 62회**. 최다: `--vscode-panel-border` 22, `--vscode-descriptionForeground` 9, `--vscode-foreground` 8, `--vscode-button-background` 7, `--vscode-button-foreground` 5.
- fallback 없는 핵심: `body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground) }`(14–16), 탭바 `--vscode-editorGroupHeader-tabsBackground`, 입력 `--vscode-input-background/foreground`, `.btn-primary` `--vscode-button-background/foreground/hoverBackground`, 표 테두리 `--vscode-panel-border`, 캔버스 배경. → **VS Code 밖에서는 투명 배경·기본 검정 글자·테두리 없음**으로 렌더(라이트에서 우연히 읽힘, 다크 불가).
- 다크/라이트: 전적으로 VS Code 변수에 위임. `body.vscode-dark/vscode-light`, `prefers-color-scheme`, `data-vscode-theme-kind` 사용 **0건**. 그러나 **하드코딩 색이 다크 전제**: `.calc-step-value`/`.sc-value` #4fc3f7(하늘색), `.governing-badge` #ffab40, 보고서 h2 #4fc3f7, `.btn-file` #e65100, `.btn-action-green` #2e7d32, `.utilization-fill` 그라디언트 — 라이트 테마에서 대비 부족. app.js 범위 내에도 hex 132개(#4fc3f7, #ff8a65, #ab47bc, #aaa 표 라벨 등).
- `@media print`(437–449): body 흰 배경/검정, 검증박스·복사버튼·로딩 숨김, **모든 `.tab-panel` 표시**(웹뷰에서 인쇄 경로는 실제로 쓰이지 않음 — PDF는 별도 HTML 래핑).
- 폰트: `--vscode-font-family`, `--vscode-font-size`, `--vscode-editor-fontFamily`(fallback 있음). CSP로 외부 폰트 차단 주석(7–9).
- 레이아웃: `body {height:100vh; overflow:hidden; display:flex}`, `.tab-content {overflow:auto}`, `.panel-row` flex 2열(min-width 300px), `#tab-design/#tab-loads .panel-left` 전용 정렬 규칙(215–272) — 좁은 폭 반응형 없음.
- 클래스 계약: `.tab-btn/.tab-panel.active`, `.collapsible/.collapse-icon`, `.step-*`, `.utilization-*`, `.calc-step*`, `.strength-card*`, `.governing-badge`, `.warn-badge`, `.validation-box`, `.input-invalid`, `.input-readonly`, `.spec-ref`, `#report-container *`.

#### 9.2 utils.js (47행)
- UMD: 브라우저 `globalThis.StcfsdUtils`, node `module.exports`. 내용 `fmt(v)`(비숫자 '-', |v|<0.01 지수 3자리, 나머지 toFixed(4)), `logspace(a,b,n)`, `convexHull(points)`(Andrew monotone chain, 소성곡면용). DOM 무의존, `test/webview/utils_contract.js`로 검증. 그대로 재사용 가능.

#### 9.3 designState.js (387행)
- UMD `globalThis.StcfsdDesignState = { collectDesignInputs, restoreDesignInputs, selectLapGoverningMoment }`. DOM은 주입받지만 **DOM id 하드코딩**(약 110개 id) — 새 UI가 id를 바꾸면 깨짐. 스키마 버전 필드 없음(.csd 최상위 version '1.2'만). 값은 US 내부단위로 저장(단, analysisLoadP/Mxx/Mzz, Cb, Cmx, nSpans 등 무차원/미변환).
- `selectLapGoverningMoment(locations)`(361–379): 순수함수, `test/webview/lap_governing_contract.js`.

#### 9.4 modeShape3D.js (198행)
- 비모듈 스크립트, `defer` 로드(StcfsdPanel.ts:3484–3486), `window.renderModeShape3D` 전역 노출(195–197). 주석은 Babylon/WebGL을 언급하나 실제는 Canvas 2D 등각 와이어프레임. `--vscode-editor-foreground` 1회(fallback 있음). 변위 스케일 0.3×단면크기 고정, 회전/줌 없음(마크업 힌트의 "드래그=회전"은 주 렌더러 viewer3d 기준).

#### 9.5 스크립트 로드 순서 (StcfsdPanel.ts:3481–3489)
`designState.js` → `utils.js` → `app.js` → `modeShape3D.js`(defer) → `media/viewer3d.js`(defer), 모두 `nonce` + `asWebviewUri`. app.js는 `acquireVsCodeApi()`(범위 밖 상단)에 의존.

---

### 10. 이 범위에서 확인된 문제/주의 (새 인터페이스 설계 시 반영)
1. 저장 누락 입력 9종(5.3) — Mu(+), Lb(+), Cb(+), β M1/M2·Lm, R 값, conn-edge-dist, E, G. Lap 결과 미저장.
2. 복원 시 파생 UI 미갱신(5.4) — 부재유형 섹션 표시 오류 가능, 100ms 타이머 의존.
3. 상세 HTML 보고서·70개 검증 규칙이 **웹뷰 JS 전용** — MCP의 `generate_report`/`validate_design`은 원자료만 반환(GUI/MCP 비대칭). 새 앱에서 이 로직을 공유 모듈(또는 Python)로 옮기지 않으면 AI 측은 같은 판정을 볼 수 없음.
4. 결과 렌더러가 **현재 DOM 입력값**을 섞어 표시(renderDesignResult 4675–4677, _rptFlexure 5623–5625, _rptSection tpl-*, _rptDesignInput 전체) — 결과와 입력이 어긋나도 감지 불가. 결과 객체에 입력 에코가 필요.
5. JS 측 공학 계산: β 미리보기, 정모멘트 Fcre 영역 판정·φ/Ω 하드코드, λl/λd 재계산, Lap ≥1.5d, w/t·b/t, 하중조합 수식 문자열, 수식 단위 정규식 치환.
6. 직접입력 모드에서 `model` 없으면 설계 버튼 무반응(3657). 인장 Tu=design-P 공유. wall-stud가 flexure로 매핑.
7. 검증 "해석 최신성"·"Fy 일관성"은 사실상 항상 pass(형식적 체크). 스팬 한계 status 40ft vs note 33ft 불일치.
8. 보고서: CUFSM 브랜딩, 압축 이용률 없음, H1.2 표 소요/저항 열 공란, 접합부(단일)·모드형상·분류·소성곡면·진동 미포함, E/ν 고정값 표기, 한/영 혼용.
9. 테마: fallback 없는 `--vscode-*` 62회 + 다크 전제 하드코딩 색 → VS Code 외부 실행 시 변수 셋 주입 필요(보고서 PDF 래퍼 5083–5091이 이미 7개 변수 재정의로 그 패턴을 보여줌).
10. 하중분석 버튼 라벨 복원 문구 불일치("📊 하중 분석 실행" vs HTML "하중 분석 실행"), Wp 행 visibility 미제어, `step-item` 클릭 불가.

### 11. 이식성 메모 (이 범위 한정)
- `vscode.postMessage` 사용처 9곳(6.1)뿐이고 수신은 `window.addEventListener('message')` — `acquireVsCodeApi` 스텁 + 호스트 브리지로 대체 쉬움.
- `navigator.clipboard`는 일반 브라우저에서 보안 컨텍스트 필요(file:// 불가 가능성).
- PDF 경로는 호스트의 Edge/Chrome headless 의존 — 데스크톱 셸(Electron/WebView2)에서는 `printToPDF` 계열로 대체 가능.
- 부분 임베드 후보(쉬움→어려움): `renderValidationDashboard`, `specRefSpan`, `utils.js`, `modeShape3D.js`, `_rptSection`/`_rptBuckling` SVG 부분, `renderBeamSchematic` > `renderDiagramSVG`(`_lastLoadAnalysis` 의존 제거 필요) > `renderDesignResult`/`renderLoadAnalysisResult`/`runAllValidationChecks`/`generateDetailedReport`(IIFE 클로저 + DOM id 의존, 추출하려면 상태 객체·단위 함수 주입 리팩터 필요).

---

## 부록 D — extension·트리·브리지·MCP 서버·빌드·테스트

### (원제) D. 호스트·MCP·빌드 조사 초안 (fork D)

범위: `src/extension.ts`(536행), `src/webview/ProjectExplorerProvider.ts`(372), `src/webview/viewer3d/*.ts`, `src/bridge/*.ts`, `src/models/types.ts`, `src/mcp/*.ts`(server.ts 1344행), `package.json`, webpack/tsconfig, `.vscodeignore`, `scripts/*.cjs`, `test/webview/*.js`, `test/vscode/**`, `python/server.py`(386행).
StcfsdPanel.ts 내부는 다른 fork 담당. 다만 MCP 경로 판단에 필요한 부분만 행 번호로 인용했다.

---

### 1. extension.ts — 활성화·명령·Python·MCP 연결

#### 1.1 활성화 순서 (`activate`, extension.ts:31-147)
1. `STCFSD_TEST_MODE=1`이면 의존성 검사 생략 (:33, :37).
2. `getPythonPath()`(:511-536)로 Python 경로 결정 → `checkAndInstallDependencies()`(:157-244).
3. `new PythonBridge(extensionPath, pythonPath)`(:41). **이 시점에는 프로세스를 띄우지 않는다.** 패널을 열 때 `ensurePythonRunning()`(:246-259)이 띄운다.
4. MCP HTTP 브릿지 시작: `findAvailablePort(52790)`(:44, :471-492. 52790부터 20개 포트 순차 시도, 127.0.0.1 bind 테스트) → `new McpBridgeServer(() => StcfsdPanel.currentPanel, port)`(:45) → `start()`(:46).
5. `setupMcpConfig()`(:52, :285-321): MCP 클라이언트 설정 파일에 **병합 쓰기**. 대상은 ① 워크스페이스 `.mcp.json`과 `.claude/mcp.json`(:494-509), ② 확장 설치 폴더 `.mcp.json`(:299-305), ③ `~/.claude/mcp.json`(:307-317). 워크스페이스가 바뀌면 다시 쓴다(:294).
6. 트리뷰 `stcfsd.projectExplorer` 등록(:58-62), 명령 8개 등록(:65-107), 트리 선택 핸들러(:110-143), 빈 트리로 초기화(:146).
- `deactivate()`(:149-152): 브릿지 stop, Python dispose.
- `package.json:33`의 `activationEvents: []`는 VS Code ≥1.74의 암시적 활성화(뷰·명령 기여)에 의존한다.

#### 1.2 명령 목록
| 명령 id | 제목(package.json) | 핸들러 | 동작 |
|---|---|---|---|
| `stcfsd.openDesigner` | StCFSD: Open Section Designer (`$(tools)`) | extension.ts:66 | Python 시작을 시도하고(실패해도 패널은 연다) `StcfsdPanel.createOrShow` 호출 |
| `stcfsd.newProject` | StCFSD: New Project | :73 | openDesigner와 **동일 코드**. 새 모델을 만들지 않으며, 패널이 이미 있으면 reveal만 한다 |
| `stcfsd.navigateSection` | (팔레트 숨김) | :80 | `currentPanel.showSection(id)` |
| `stcfsd.refreshProjects` | Refresh Projects (`$(refresh)`) | :86 | `projectExplorer.refresh()` |
| `stcfsd.runAnalysis` | Run Analysis (`$(play)`, 트리 context `section-analysis`) | :90 | `showSection('run-analysis')`. 해석을 직접 실행하지 않고 웹뷰에 섹션 이동만 지시한다 |
| `stcfsd.registerMcpServer` | Register Local MCP Server (`$(plug)`) | :96 → `runMcpRegister` :353-404 | 범위 QuickPick(둘 다/워크스페이스/글로벌) → 병합 쓰기 → 번들 존재·`node --version`·`GET /status`를 검증하고 모달로 보고 |
| `stcfsd.unregisterMcpServer` | Unregister Local MCP Server | :100 → `runMcpUnregister` :406-438 | 확인 QuickPick → 우리 키만 제거 |
| `stcfsd.showMcpStatus` | Show MCP Registration Status | :104 → `runMcpStatus` :440-469 | 파일별 등록 여부, 포트 일치 여부, 브릿지 핑 결과를 모달로 표시 |

메뉴(package.json:74-109): view/title에 openDesigner·refresh·register, view/item/context에 runAnalysis(`viewItem == section-analysis`), commandPalette에서 navigateSection·runAnalysis 숨김. 활동 막대 컨테이너는 `stcfsd-explorer`(아이콘 `media/stcfsd-icon.svg`), 뷰 이름은 "Section Designer".

#### 1.3 Python 프로세스 수명주기
- **경로 탐색** `getPythonPath`(:511-536). 우선순위: ① `<extensionPath>/.venv/Scripts/python.exe` 또는 `.venv/bin/python`, ② VS Code 설정 `python.defaultInterpreterPath`(값이 'python'이 아닐 때), ③ `python`(win32) 또는 `python3`.
- **의존성 검사**(:157-244): `python --version`(실패 시 python.org 열기 제안), `import numpy`/`import scipy`를 검사하고, 없으면 확인을 받아 `pip install`을 실행한다(withProgress 알림, 5분 timeout).
- **기동** `PythonBridge.start()`(PythonBridge.ts:24-121): `spawn(python, ['-u','server.py'], cwd=<ext>/python, PYTHONUNBUFFERED=1)`(:53-57). 2초 뒤 `ping`을 보내 'pong'을 받으면 `_started=true`(:100-117). exit/error가 나면 대기 중인 요청을 모두 reject한다(:65-81). stderr는 콘솔로 흘린다.
- **재기동**: 자동 재시작은 없다. 다음 `openDesigner`나 트리 클릭 때 `ensurePythonRunning`이 `isRunning`을 보고 다시 띄운다(extension.ts:246-259). MCP 경로(`handleMcpAction`)는 Python 시작을 보장하지 않으므로, 프로세스가 죽으면 "Python process is not running"(PythonBridge.ts:152-155) 오류가 난다.
- 프로세스는 확장 전체에서 1개(extension.ts:26 전역 `pythonBridge`)이고 패널 수명과 무관하다. 패널을 닫아도 Python은 살아 있다.

#### 1.4 MCP ↔ 확장 연결(IPC): **localhost HTTP** (정확한 방식)
```
Claude 클라이언트 ─stdio(MCP JSON-RPC)→ node media/mcp-server.js
   ─HTTP (http://localhost:$STCFSD_MCP_PORT)→ McpBridgeServer(확장 호스트, 127.0.0.1:52790~52809)
   ─직접 메서드 호출→ StcfsdPanel.currentPanel.handleMcpAction(body) / getStatus()
   ─stdin/stdout 줄단위 JSON-RPC→ python server.py
```
- 브릿지 엔드포인트(mcp/bridge.ts:28-60)는 두 개뿐이다. `GET /status` → `panel.getStatus()`, `POST /action` (JSON body `{action, ...}`) → `panel.handleMcpAction(body)`.
- 패널이 없으면 **두 엔드포인트 모두** `{error:'No active CUFSM panel. Open Section Designer first.'}`를 돌려준다(bridge.ts:36-49).
- 상태 코드는 항상 200이다. 오류는 body의 `error` 키로만 표시되며, MCP 쪽 `textResult`가 최상위 `error` 키를 보고 `isError:true`로 바꾼다(server.ts:62-72). NaN/Infinity는 null로 직렬화한다(bridge.ts:100-104).
- 인증과 CORS 제한이 없다(`Access-Control-Allow-Origin: *`, bridge.ts:30). 같은 PC의 어떤 프로세스든 POST로 모델을 바꾸거나 `save_project`로 **임의 경로에 파일을 쓸** 수 있다(StcfsdPanel.ts:2090-2094).
- 포트는 MCP 서버 프로세스에 환경변수 `STCFSD_MCP_PORT`로 전달된다(registration.ts:25-31, server.ts:23). 포트가 52790에서 밀리면(다른 VS Code 창 등) 설정 파일의 포트도 바뀐다. 여러 VS Code 창이 같은 `~/.claude/mcp.json`을 덮어쓰므로 **마지막에 활성화된 창이 이긴다**.

#### 1.5 상태 표시줄·설정
- 상태 표시줄 항목은 **없다**(`createStatusBarItem` 미사용).
- `contributes.configuration`이 **없다**. 읽는 설정은 다른 확장의 `python.defaultInterpreterPath` 하나뿐이다(extension.ts:525).
- 환경변수: `STCFSD_TEST_MODE`(확장·패널 테스트 훅), `STCFSD_MCP_PORT`(MCP 서버).

---

### 2. ProjectExplorerProvider — 사이드바 트리

- `StcfsdTreeItem extends vscode.TreeItem`(:10-38). 필드는 `sectionId`, description, tooltip, `ThemeIcon`, contextValue, `commandId`(있으면 클릭 시 VS Code 명령 실행).
- 상태는 `ProjectSummary`(:40-87): 이름, 절점/요소 수, 단면 유형, H/B/D/t, 강종/Fy/Fu, BC, 길이 수, 결과 유무, A/Ixx/Sx/rx/rz, Pcrl/Pcrd/Mcrl/Mcrd, 부재유형/스팬/설계법/스팬길이/간격, 하중 D/Lr/S/W/L, 설계 결과(Mn/Pn/지배모드/이용률/OK), 하중분석(지배조합/maxMu/maxVu/처짐/L비), 검증 통과/주의/실패 수. **전부 표시용 문자열이며 계산은 없다.**
- 갱신 경로: `updateProjectData(partial)`(:112-119)가 이전 요약에 덮어 병합하고 `onDidChangeTreeData` 이벤트를 낸다. 호출자는 `StcfsdPanel._updateTreeView(extra)`(StcfsdPanel.ts:200~)이며, 웹뷰의 `treeUpdate` 메시지(StcfsdPanel.ts:365-368)와 MCP 모델 변경 액션 다수(generate_template, set_bc, set_lengths, doubler, set_nodes 등)가 이를 부른다.
- 패널이 닫혀도(`_dispose`, StcfsdPanel.ts:3623-3630) 트리를 비우지 않는다. **닫힌 뒤에도 옛 요약이 계속 표시된다.**

#### 트리 구조
요약이 없을 때(:145-154): "단면 미로드"(info, 클릭 시 `open-designer`)와 "MCP 서버".
요약이 있을 때(:156-194). 루트 7개와 MCP:

| 루트 (sectionId, icon) | 자식 → sectionId (icon, description) |
|---|---|
| 전처리 `preprocessor` (symbol-structure, "유형 N절점") Expanded | 단면 템플릿 `focus-template`, 치수 `focus-tpl-H`, 재료 `focus-design-fy`, 절점/요소 `node-elem`, 단면 성질 `focus-props` (:222-233) |
| 해석 `analysis` (beaker, "결과 있음", context `section-analysis`) | 경계조건 `boundary-condition`, 반파장 `lengths`, cFSM 설정 `cfsm-settings`, 해석 실행 `run-analysis`(play, context section-analysis) (:236-248) |
| 후처리 `postprocessor` (graph) | 좌굴 곡선 `buckling-curve`, 모드 형상 2D `mode-shape-2d`, 3D `mode-shape-3d`, 모드 분류 `classification`, (DSM 있을 때) DSM 압축 `focus-dsm-P`, DSM 휨 `focus-dsm-M` (:251-262) |
| 설계 `design` (tools, OK/NG) Expanded | 부재 유형 `focus-member-type`, 스팬 구성 `focus-span-type`, 간격 `focus-spacing`, 하중 `design-loads`(→ D/Lr/S/L/W `focus-load-*`), 비지지 길이 `focus-design-Lb`, 하중 분석 결과 `design-load-results`(→ `focus-gravity-combo`, `focus-max-Mu`, `focus-max-Vu`, `focus-deflection`), 설계 결과 `design-results`(→ `focus-controlling-mode`, `focus-design-Mn`, `focus-design-Pn`, `focus-utilization`) (:265-333) |
| 접합부 `connection` (plug) | Lap Splice 설계 `lap-connection`, 단일 접합부 `single-connection` (:336-341) |
| 보고서 `report` (file-text) | 없음 |
| 검증 `validation` (checklist, "n통과 n주의 n실패") | 실패 `focus-validation-fail`, 주의 `focus-validation-warn`, 통과 `focus-validation-pass`, 검증 실행 `run-validation` (:344-357) |
| MCP 서버 `mcp-server` (plug, "로컬 등록") | 등록 / 상태 보기 / 등록 해제. 각각 commandId로 해당 명령 실행 (:205-219) |

- 클릭 처리(extension.ts:110-143): `mcp-server`는 무시하고, `open-designer`는 openDesigner를 실행한다. 패널이 없으면 Python을 시작하고 패널을 만든 뒤 **800ms setTimeout 후** `showSection(sectionId)`을 호출한다(경쟁 조건 가능). 패널이 있으면 바로 `showSection`. 실제 포커스와 섹션 이동은 웹뷰의 `showSection` 처리(app.js, 다른 fork)가 맡는다.
- 주석(:4-5)은 "6개 탭(전처리·해석·후처리·설계·보고서·검증)"이라고 적혀 있지만, 현재 웹뷰 탭은 ①단면·재료 ②하중계산 ③좌굴해석·부재설계 ④접합부, 보고서, 검증이다(StcfsdPanel.ts:2750-2757). **트리 분류와 탭 구성이 일치하지 않는다**(트리에 "하중계산" 루트가 없고 해석/후처리가 분리돼 있음).

---

### 3. PythonBridge / JsonRpcProtocol / python/server.py

- 프로토콜(JsonRpcProtocol.ts): 요청은 `{method, params, id}` + `\n`(PythonBridge.ts:157-161), 응답은 `{id, result}` 또는 `{id, error, traceback}`. 줄 단위로 버퍼링하고 파싱한다(:48-64). 파싱에 실패한 줄은 로그만 남기고 버린다.
- **타임아웃 300 000 ms(5분)**는 요청마다 걸린다(PythonBridge.ts:21). 응답의 `error` 문자열만 Error로 reject하고 `traceback`은 버린다(JsonRpcProtocol.ts:76-80).
- `call()`은 params에서 `action` 키를 제거한다(F08, PythonBridge.ts:141-149).
- Python 쪽(server.py:368-382)은 **단일 스레드로 순차 처리**한다. 긴 FSM 해석이 돌면 뒤에 온 GUI/MCP 요청은 모두 줄을 선다. 취소 수단은 없다.
- **Python은 무상태다.** 모든 메서드가 node/elem/prop 등을 params로 받는다. 모델 상태는 TS 패널이 갖는다.

#### server.py RPC 메서드 전체 (handle_request, :28-358)
| 메서드 | 구현 | 행 | TS에서 사용 |
|---|---|---|---|
| `analyze` | engine.fsm_solver.stripmain | :35 | 사용 (`PythonBridge.analyze`, 패널 6곳) |
| `get_properties` | engine.properties.grosprop | :51 | 사용 |
| `generate_section` | engine.template.generate_section | :57 | 사용 |
| `stresgen` | engine.stress.stresgen | :66 | 사용 (3곳) |
| `yieldMP` | engine.stress.yieldMP | :82 | **미사용** |
| `classify` | cfsm.classify | :94 | 사용 |
| `fcfsm` | fcfsm.solver.stripmain_fcfsm | :103 | **미사용** |
| `vibration` | vibration.solver.stripmain_vib | :117 | 사용 |
| `plastic` | plastic.pmm_plastic | :139 | 사용 |
| `load_mat` | fileio.mat_loader (CUFSM .mat) | :159 | **미사용**(GUI/MCP 노출 없음) |
| `save_project` / `load_project` | fileio.project_io | :164/:170 | **미사용**(TS가 fs로 직접 저장·로드) |
| `doubler` | engine.helpers.doubler | :175 | 사용 |
| `signature_ss` | engine.helpers.signature_ss | :181 | **미사용**(TS가 lengths를 만들고 `analyze` 호출, StcfsdPanel.ts:2112-2135) |
| `firstyield` | engine.helpers.firstyield | :189 | **미사용** |
| `dsm` | engine.dsm.extract_dsm_values | :196 | 사용 (13곳) |
| `cutwp` | engine.cutwp.cutwp_prop | :214 | 사용 |
| `energy_recovery` | engine.helpers.energy_recovery | :220 | 사용 |
| `aisi_design` | design.aisi_s100.design_member | :236 | 사용 (6곳) |
| `aisi_guide` | design.aisi_s100.design_guide | :241 | 사용 |
| `steel_grades` | design.steel_grades.list_grades | :246 | 사용 |
| `web_crippling` | design.shear.web_crippling | :250 | 사용 |
| `analyze_loads` | design.loads.required_strength.analyze_loads | :273 | 사용 |
| `calc_deck_stiffness` | design.loads.bracing (kφ, kx 근사 또는 override) | :292 | 사용 |
| `lap_connection` | design.lap_connection.design_lap_connection | :319 | 사용 |
| `shear_lag` / `block_shear` / `cold_work` / `flange_curling` | design.special_topics | :324-338 | 사용 (패널 allowlist 경유) |
| `design_connection` | design.connections.design_connection | :340 | 사용 |
| `check_lap_length` | design.lap_connection.check_lap_length | :345 | 사용 |
| `ping` | 'pong' | :354 | 기동 확인 |

총 31개 메서드, 이 중 7개는 TS에서 쓰지 않는다. **Python에 없는 복합 워크플로우는 TS(StcfsdPanel)에 구현되어 있다**: `design_purlin`(:1812-2085, 하중분석 → 정/부모멘트 FSM 2회 → DSM → aisi_design 최대 4회), `prepare_design_dsm`(:1216), `get_dsm`(:1179), `generate_report`(:1657-1731), `validate_design`(:1756-1798), `aisi_design` 전처리(:1385-1630, 단면성질·cutwp·DSM을 모아 design 파라미터 구성), 노드/요소 편집 전부(:2140-2370), `get_full_state`(:2412), `set_gbtcon`(:2443). 데스크톱 이식 때 이 TS 로직을 잃지 않아야 한다(또는 Python으로 옮겨야 한다).

---

### 4. MCP 서버 (src/mcp/server.ts)

- `McpServer({name:'stcfsd-section-designer', version:`${pkg.version}+src.${srcHash}`})`(server.ts:92-113). stdio transport(:1339-1344). zod 스키마 사용.
- **도구 59개 확인**(`server.tool(` 59회). 모든 도구가 브릿지 `POST /action` 또는 `GET /status`를 거친다. 도구 안에 계산은 없다. 예외는 `set_material`의 G 자동계산(:438), SI→US 입력 변환, US→SI 출력 변환, 그리고 `custom_section_guide`의 정적 텍스트뿐이다.

#### 4.1 서버 instructions (server.ts:96-112) 요지
"StCFSD - Cold-Formed Steel Section Buckling Analysis Tool." 단위 기본은 US이고 주요 설계 도구는 `units='SI'`(mm, MPa, kN, kN-m)를 받는다. 기본 강재는 SGC400(Fy 35.53 ksi/245 MPa, Fu 58.02/400, E 29500/203000). 워크플로우는 다음 6단계다.
1 get_status → 2 set_section_template(10종) → 3 set_material/set_boundary_condition/set_lengths → 4 run_analysis → 5 get_dsm_values → 6 get_buckling_curve.
끝에 "All changes are reflected in the VS Code WebView in real-time."
→ 설계(aisi_design_*), 하중(analyze_loads/design_purlin), 접합부, 보고서·검증 단계는 instructions에 **언급되지 않는다**. AI는 개별 도구 설명과 `aisi_design_guide`/`custom_section_guide`로만 그 흐름을 알게 된다. 패널을 먼저 열어야 한다는 전제도 instructions에 없고, 오류 메시지에만 나온다.

#### 4.2 도구 그룹 · 브릿지 action · GUI 반영

| 그룹 | 도구 (→ bridge action) | GUI 반영(웹뷰로 보내는 메시지, StcfsdPanel.ts) |
|---|---|---|
| A. 상태·조회 (5) | get_status(GET /status), get_full_state(→get_full_state), get_section_properties(→get_properties), get_dsm_values(→get_dsm, SI 길이 변환 :153-160), get_buckling_curve(→get_curve) | 없음(조회 전용) |
| B. 단면 정의 (6) | set_section_template(→generate_template, 10종, SI 변환 :195-200), set_custom_section(→generate_template `custom`), build_section(→generate_template `custom_builder`), get_section_preview(→capture_section_preview), custom_section_guide(정적 텍스트, 브릿지 호출 없음 :297-429), set_material(→set_material) | generate_template/set_material은 `modelLoaded`와 트리 갱신(:1014-1015, :1040). preview는 웹뷰에 `captureSection`을 보내고 `sectionPreviewResult`를 기다린다(5초 timeout, :1733-1749). **웹뷰 DOM이 살아 있어야 동작한다** |
| C. 하중·경계·길이 (4) | set_load_case(→set_load_case, stresgen), set_stress(→set_stress), set_boundary_condition(→set_bc), set_lengths(→set_lengths) | `modelLoaded` (:1047, :1078, :1105, :1122) |
| D. 해석 (3) | run_analysis(→run_analysis, neigs), run_signature_curve(→signature_ss), classify_modes(→classify) | run_analysis는 `classifyResult`, `analysisComplete`, `dsmResult`(:1156-1170). signature는 `modelLoaded`와 `analysisComplete`(:2125, :2135). classify는 `classifyResult`(:1358) |
| E. 절점·요소 편집 (11) | get_nodes, get_elements, set_node_stress, set_nodes, set_elements, add_node, add_element, modify_node, delete_node, modify_element, delete_element, double_mesh(→doubler) | 편집 계열은 모두 `modelLoaded`(:2157~:2366, :1296) |
| F. 고급 해석 (4) | get_cutwp(→cutwp), run_plastic_surface(→plastic), run_vibration(→vibration), get_energy_recovery(→energy_recovery) | plastic은 `plasticResult`(:1380). **vibration·cutwp·energy는 GUI에 반영되지 않는다**(:1363-1372, 반환만) |
| G. 구속·스프링·cFSM (3) | set_springs, set_constraints, set_gbtcon | `modelLoaded` (:2174, :2183, :2455) |
| H. 프로젝트 파일 (2) | save_project(→save_project), load_project(→load_project) | save: `JSON.stringify(this._model)`를 **원시 모델 그대로** `fs.writeFileSync`(:2090-2094). GUI의 .csd 래퍼(설계 입력·결과 포함, :3496~)와 형식이 다르다. 도구 쪽은 응답을 보지 않고 항상 "saved"를 반환한다(server.ts:703-704, 오류가 가려짐). load: `{model}` 래퍼와 원시 모델 둘 다 허용하고 해석 무효화 후 `modelLoaded`(:2096-2108). **GUI 설계 입력은 복원하지 않는다** |
| I. AISI 부재설계 (7) | aisi_design_compression / _flexure / _combined / _tension(→aisi_design member_type), aisi_design_connection(→aisi_design connection), steel_grades, aisi_design_guide(→aisi_guide) | aisi_design은 `designResult`(:1389, :1630). 웹뷰 설계 결과 영역에 표시되지만 **웹뷰 설계 입력칸은 갱신되지 않는다**(입력·결과 불일치 가능) |
| J. 하중·데크·퍼린 (4) | get_web_crippling(→web_crippling), analyze_loads(→analyze_loads), calc_deck_stiffness, design_purlin(→design_purlin, TS 오케스트레이션) | analyze_loads는 `_lastLoadAnalysis`에 저장만 하고 **웹뷰에 보내지 않는다**(:1649-1655). GUI의 analyzeLoads 경로(:356)는 별도 처리. design_purlin은 `designPurlinResult`(:2085) |
| K. 보고서·검증 (2) | generate_report(→generate_report: JSON 패킷이며 HTML 아님), validate_design(→validate_design: 세션 상태 수집이며 pass/fail 평가 아님) | 없음. GUI 보고서 탭과 검증 대시보드는 웹뷰 JS에서 생성되므로 MCP로는 HTML/PDF 보고서를 만들 수 없다 |
| L. 접합부 (6) | design_lap_connection(→lap_connection), check_lap_length, design_connection, check_shear_lag(→shear_lag), check_block_shear(→block_shear) | lap은 `lapConnectionResult`(:1310), design_connection은 `connectionResult`(:1320). 나머지는 반환만 |
| M. 특수 주제 (2) | cold_work, flange_curling | 반환만 (allowlist :1324-1346) |

합계: A5 + B6 + C4 + D3 + E12(double_mesh 포함) + F4 + G3 + H2 + I7 + J4 + K2 + L5 + M2 = 59. server.ts 주석의 그룹 수("STATUS & INFO (4 tools)", "NODE/ELEMENT EDITING (11 tools)" 등)는 실제 수와 맞지 않는다.

#### 4.3 패널이 닫혀 있을 때
- **59개 전부 동작하지 않는다.** custom_section_guide만 예외다(브릿지를 호출하지 않는 정적 텍스트). 근거는 bridge.ts:36-49가 `StcfsdPanel.currentPanel` 부재 시 `GET /status`까지 오류로 돌려준다는 점이다. 순수 계산 도구(steel_grades, cold_work, web_crippling, check_block_shear 등. 모델이 필요 없음)도 패널 인스턴스의 `handleMcpAction`을 거치므로 똑같이 실패한다.
- 모델 상태(`_model`, `_lastAnalysisResult`, `_lastLoadAnalysis`, `_lastDesignResult`, `_preparedDesignDsm`. StcfsdPanel.ts:33-45)는 **패널 인스턴스 필드**다. 패널을 닫으면 전부 사라진다(`_dispose`는 currentPanel=undefined만 수행). 다시 열면 기본 모델로 시작한다.
- `retainContextWhenHidden: true`(StcfsdPanel.ts:66)이므로 탭이 가려진 상태에서는 웹뷰 JS 상태가 유지된다.
- MCP 경로는 Python을 기동하지 않는다. 패널이 Python 없이 열렸다면 도구 호출은 "Python process is not running"으로 실패한다.

#### 4.4 MCP 호출이 GUI에 보이는 경로
`handleMcpAction` → `this._model` 변경 → `_postMessage('modelLoaded', this._model)`(StcfsdPanel.ts:2702-2712 → `webview.postMessage`) → app.js가 전체 모델을 다시 그림 + `_updateTreeView()`로 트리 갱신. 결과형 액션은 `analysisComplete`/`dsmResult`/`classifyResult`/`designResult`/`plasticResult`/`lapConnectionResult`/`connectionResult`/`designPurlinResult`를 보낸다.
반대 방향(GUI → 공유 상태): 웹뷰의 `updateModel`/`runAnalysis`/`setStress`/`runDesign`/`analyzeLoads` 메시지가 같은 `this._model`을 바꾸거나 `handleMcpAction`을 재사용한다(StcfsdPanel.ts:222-358). 따라서 **단일 진실원은 확장 호스트의 패널 인스턴스**이고, 동기화는 "변경 후 전체 모델 push" 방식이다. 버전/충돌 검사는 없다. `_derivedInputRevision`(:40)과 `_requireDerivedRevision`이 하중·설계 결과의 신선도만 검사한다.

#### 4.5 siUnits.ts
- 상수 `SI_TO_US`/`US_TO_SI`: length(25.4), area, stress(6.89476), force(4.44822), moment(0.11298 kN-m/kip-in), pressure(0.04788), linload(0.01459), length_ft(0.3048)(:9-29).
- `convertInputSI`(반올림 없음), `convertOutputSI`(소수 4자리), `convertOutputSINested`.
- 도구별 맵: COMPRESSION/FLEXURE/CONNECTION/TENSION/COMBINED(+NESTED) 출력, TENSION/COMBINED/CONNECTION 입력(:66-138).
- SI를 지원하는 도구는 get_dsm_values(길이만), set_section_template, aisi_design_compression/flexure/combined/tension/connection **7개뿐**이다. 그 밖의 도구(set_lengths, analyze_loads(ft/PLF 고정), design_lap_connection, design_connection, web_crippling, cold_work 등)는 US 전용이다. 엔진 내부도 US 전용이다.

#### 4.6 registration.ts (로컬 MCP 등록)
- 순수 함수이며 vscode 의존이 없다. `MCP_SERVER_KEY='stcfsd-section-designer'`(:8). `buildServerConfig(path, port)` → `{command:'node', args:[<ext>/media/mcp-server.js], env:{STCFSD_MCP_PORT}}`(:25-31). `mergeServerConfig`는 깨진 JSON이나 객체가 아닌 값은 덮어쓰지 않는다(:34-65). `removeServerConfig`는 우리 키만 지운다(:68-87). `configPathsForScope`가 다루는 경로는 `<ws>/.mcp.json`, `<ws>/.claude/mcp.json`, `<home>/.claude/mcp.json`(:101-111)이다. `inspectRegistration`(:122-141).
- **Claude Desktop 설정(`%APPDATA%\Claude\claude_desktop_config.json`)에는 등록하지 않는다.** 대상은 Claude Code/프로젝트용 `.mcp.json` 계열뿐이다. 데스크톱 연계를 하려면 새로 추가해야 한다.
- 시스템 PATH에 `node`가 있어야 한다(command 'node'. extension.ts:344-351에서 검사만 함). Claude Desktop 환경에서는 PATH 문제가 생길 수 있다.

#### 4.7 번들
- `webpack.mcp.config.js`: entry `src/mcp/server.ts` → `media/mcp-server.js`(약 408 KB, map 1.7 MB). target node, 단일 청크. DefinePlugin `__STCFSD_BUILD__={version, srcHash}`. srcHash는 `scripts/mcp-source-hash.cjs`가 server.ts, siUnits.ts, package.json, tsconfig.mcp.json, webpack.mcp.config.js의 내용으로 계산한 sha256 앞 12자리다.
- MCP SDK와 zod가 번들 안에 포함되므로, 실행에는 node만 있으면 되고 node_modules는 필요 없다.

---

### 5. 패리티 검사

- `scripts/check-mcp-parity.cjs`(102행): src/mcp를 임시 폴더(`.parity-tmp`)에 tsc로 transpile한다. 소스 서버와 `media/mcp-server.js` 번들을 각각 stdio로 띄우고(`STCFSD_MCP_PORT=1`, 브릿지 불필요) `initialize`+`listTools`를 비교한다. 비교 항목은 ① 번들 version이 `pkg.version+src.<현재 소스 해시>`인지, ② name, ③ 도구명 집합, ④ 도구별 inputSchema·description 일치다. 불일치 시 exit 1. **GUI 기능과의 패리티는 검사하지 않는다**(소스 ↔ 번들 일치만 본다).
- `test/webview/parity_contract.js`(32행): 문자열 tripwire. ① MCP에 load_project·cold_work·flange_curling이 있는지, ② 패널에 `case 'load_project'`/`'cold_work'`/flange_curling 처리가 있는지, ③ GUI 진동해석 배선(`btn-run-vibration`, `vibration-result`, `runVibration` 라우팅, app.js의 `runVibration` 전송, `vibrationResult` 처리, `renderVibrationResult` 정의)이 있는지 확인한다.

#### GUI 전용 기능 (MCP 불가)
- HTML 상세 보고서 생성, 인쇄, PDF 저장(웹뷰 생성 HTML → Edge/Chrome headless 인쇄, StcfsdPanel.ts:2538-2643), 좌굴 보고서 별도 패널(`showBucklingReport`, :2489-2495)
- 검증 대시보드의 pass/warn/fail 평가 (MCP validate_design은 원시 상태 수집만 함)
- .csd 프로젝트 저장·열기(설계 입력, 스팬 표, 하중, 데크, 결과까지 포함. 대화상자 :3496-3620) ↔ MCP save/load는 원시 모델만 다룸
- 단위 토글 표시, 차트·3D 상호작용, 트리 내비게이션
- analyze_loads 결과의 화면 표시와 하중 → 설계/lap 입력 자동 채움(app.js `_autoFillLapInputs`, 공용 `selectLapGoverningMoment`)
- `invalidateDerivedResults`(입력 변경 시 하중·설계 결과 무효화), `prepareDesignDsm` 자동 준비(해석 완료 후. MCP에는 prepare_design_dsm 도구가 없지만 패널 action은 있음)
- `apply_deck_springs` 패널 action(:1799)도 MCP 도구가 없다
#### MCP 전용 기능 (GUI 노출 없음 또는 미반영)
- 절점/요소 개별 편집 11종, set_springs/set_constraints/set_gbtcon 원시 배열 입력(GUI에서 가능한 범위는 다른 fork에서 확인 필요)
- set_custom_section / build_section(외곽 모서리, 빌더 단계 기반 임의 단면), custom_section_guide, aisi_design_guide
- get_energy_recovery, get_cutwp 상세값(GUI 표시 여부는 다른 fork에서 확인), check_shear_lag, check_block_shear, cold_work, flange_curling, calc_deck_stiffness 단독 호출, get_web_crippling 단독
- get_section_preview(PNG 파일 경로 반환, AI 시각 검증용)
- SI 입력 옵션(일부 도구)

---

### 6. viewer3d (Babylon.js. three.js 아님)

- **사용 라이브러리는 `@babylonjs/core` ^7.43.2**(package.json:158)다. three.js는 쓰지 않는다.
- 진입 `src/webview/viewer3d/index.ts`(51행) → `media/viewer3d.js`(3.4 KB). 렌더러 본체는 동적 `import()` 지연 청크 `media/viewer3d.mode-shape-renderer.js`(1.0 MB)로 분리되어 있다(webpack.config.js: LimitChunkCount 2, chunkFilename `viewer3d.[name].js`, publicPath 'auto').
- CSP nonce 전달: `document.currentScript.nonce`를 `__webpack_nonce__`에 넣는다(index.ts:13-17). 지연 청크 `<script>`도 같은 nonce를 받아야 VS Code CSP를 통과하기 때문이다.
- 전역 API는 `window.CufsmViewer3D = { init(canvasId), render(data) }`(index.ts:27-60). `render`는 내부에서 **canvas id `'mode-shape-3d-canvas'`를 하드코딩**한다(:57). 즉 DOM id에 결합되어 있다.
- 웹뷰 로드는 StcfsdPanel.ts:3485-3488(`asWebviewUri`로 `webview/js/charts/modeShape3D.js`와 `media/viewer3d.js`)에서 한다. app.js:3097-3126은 `CufsmViewer3D`가 있으면 사용하고, 없으면 `renderModeShape3D`(Canvas 2D 폴백, modeShape3D.js)를 쓰며, 둘 다 없으면 오류를 낸다.
- `ModeShape3DRenderer`(314행): 입력 `{nodes, elems, modeVec, length, BC, scale}`. 반파장 수를 자동으로 늘리고(단면 크기 2배 이상 표시), BC별 형상함수(S-S sin, C-C sin², C-F, S-C)를 쓴다. 변위 크기로 은색→구리색 정점색을 입히고 양 끝 단면 윤곽선을 그린다. 마우스 조작은 회전, 팬(우클릭/Shift), 휠 줌, 더블클릭 리셋. ResizeObserver를 쓴다. 미변형 와이어프레임 루프는 계산만 하고 그리지 않는다(:225-235, 죽은 코드). 배경색이 `Color4(0.95,0.95,0.95)`로 고정되어 다크모드를 따르지 않는다(:68).
- **순수성**: 생성자가 `HTMLCanvasElement`를 받으므로 클래스 자체는 데이터 → 그림의 **순수 컴포넌트**다. 다른 셸에 그대로 재사용하기 쉽다. 전역 래퍼(index.ts)만 DOM id에 결합되어 있다.
- `PlasticSurfaceRenderer`(195행): P-M11-M22 곡면. 정규화, 그리드 삼각화 추정, 축선을 그린다. **어디에서도 import되지 않는 죽은 코드**다(index.ts에 미노출, grep 결과 정의만 있음). 웹뷰의 소성곡면은 app.js의 Canvas(`plastic-surface-canvas`) 구현을 쓴다(다른 fork에서 확인).
- `vertexColorMaterial.ts`(47행): 조명 없는 정점색 ShaderMaterial(양면). 번들 축소용이다.

---

### 7. `vscode.*` API 사용 표 (StcfsdPanel.ts 제외)

| 파일 | API | 횟수 | 용도 (행) |
|---|---|---|---|
| extension.ts | `vscode.ExtensionContext` | 4 | extensionPath, extensionUri, subscriptions (:31, :158, :285, :353) |
| extension.ts | `commands.registerCommand` | 8 | 명령 8개 (:66-106) |
| extension.ts | `commands.executeCommand` | 1 | 트리에서 openDesigner 실행 (:121) |
| extension.ts | `window.createTreeView` (+ `onDidChangeSelection`) | 1 | 사이드바 트리 (:58, :110) |
| extension.ts | `window.showWarningMessage` | 3 | Python 없음, 패키지 없음, 워크스페이스 없음 (:171, :200, :376) |
| extension.ts | `window.showErrorMessage` | 3 | pip 실패, Python 기동 실패, 브릿지 미시작 (:228, :252, :368) |
| extension.ts | `window.showInformationMessage` | 4 | pip 완료, MCP 등록/해제/상태 **모달**(`{modal, detail}`) (:234, :399, :437, :468) |
| extension.ts | `window.showQuickPick` | 2 | 등록 범위, 해제 확인 (:354, :407) |
| extension.ts | `window.withProgress` + `ProgressLocation.Notification` | 1 | pip 설치 진행 (:211-213) |
| extension.ts | `env.openExternal` + `Uri.parse` | 1 | python.org (:177) |
| extension.ts | `workspace.getConfiguration('python')` | 1 | defaultInterpreterPath (:525) |
| extension.ts | `workspace.workspaceFolders` | 1 | MCP 설정을 쓸 워크스페이스 루트 (:277) |
| extension.ts | `workspace.onDidChangeWorkspaceFolders` | 1 | MCP 설정 재기록 (:294) |
| ProjectExplorerProvider.ts | `TreeItem`(상속), `TreeDataProvider`, `EventEmitter`, `TreeItemCollapsibleState`(19회), `ThemeIcon`(19회) | 42 | 트리 데이터 모델 (:8-372) |
| bridge/*, mcp/*, models/types.ts, viewer3d/* | 없음 | 0 | vscode 비의존 (mcp/server.ts는 별도 node 프로세스) |

참고(다른 fork 범위. 요약만): StcfsdPanel.ts의 vscode 참조는 36개다. `createWebviewPanel` 2(본 패널 + 좌굴보고서 패널), `WebviewPanel` 3, `Uri.joinPath` 8, `asWebviewUri` 6, `cspSource` 3, `ViewColumn` 3, `activeTextEditor` 2, `showSaveDialog` 2, `showOpenDialog` 1, `workspace.fs.writeFile` 1, show*Message 10, `Uri.file` 1, `webview.postMessage`, `onDidReceiveMessage`, `onDidDispose`, `reveal`.

---

### 8. 옵션 (a): 호스트를 가짜 `vscode` 모듈로 plain Node에서 그대로 실행

- **로딩**: `out/`은 tsc CommonJS 출력이고 `require('vscode')`를 쓴다. `Module._resolveFilename` 훅이나 `node_modules/vscode/index.js` 스텁으로 가짜를 주입할 수 있다. 쉬움.
- **쉬운 스텁** (단순 함수·클래스): `ExtensionContext`({extensionPath, extensionUri, subscriptions:[]}), `Uri.file/parse/joinPath`(fsPath 보유 객체), `commands.registerCommand/executeCommand`(Map), `window.show{Information,Warning,Error}Message`(로그나 셸 대화상자로 전달. modal+detail 옵션과 버튼 반환값 Promise 지원 필요), `showQuickPick`, `withProgress`, `ProgressLocation`, `env.openExternal`, `workspace.getConfiguration`(get만), `workspaceFolders`(셸이 정한 작업 폴더나 undefined), `onDidChangeWorkspaceFolders`(no-op), `ViewColumn`, `window.activeTextEditor`(undefined), `EventEmitter`(간단 구현), `ThemeIcon`, `TreeItem`, `TreeItemCollapsibleState`.
- **중간 난이도**:
  - `window.createTreeView` + `onDidChangeSelection`: `ProjectExplorerProvider`가 순수 데이터 제공자이므로(getChildren/getTreeItem) 가짜 TreeView는 provider를 받아 `onDidChangeTreeData` 때마다 트리를 JSON으로 직렬화해 새 셸 사이드바로 보내면 된다. 선택 이벤트는 셸에서 되돌려 받는다. ThemeIcon id는 codicon 이름이므로 아이콘 매핑(또는 @vscode/codicons 폰트)이 필요하다.
  - `showSaveDialog`/`showOpenDialog`/`workspace.fs.writeFile`: 셸이 Electron이면 `dialog`/fs로 1:1 대응된다. 셸이 브라우저면 호스트 측 대화상자가 필요하다.
- **어려움 (핵심)**: `window.createWebviewPanel` → `WebviewPanel`/`Webview`. 다음을 구현해야 한다. `webview.html` setter(HTML 문자열을 실제 브라우저 창이나 iframe에 띄움), `webview.postMessage` ↔ 웹뷰 `acquireVsCodeApi().postMessage`(양방향 채널: Electron IPC나 WebSocket), `onDidReceiveMessage`, `asWebviewUri`(로컬 파일을 HTTP나 custom protocol URL로 매핑), `cspSource`(그 origin 문자열), `reveal`, `onDidDispose`(창 닫기 → 상태 소실 동작 유지). 웹뷰 쪽에는 `acquireVsCodeApi` 스텁과 `--vscode-*` CSS 변수 값 주입이 필요하다(다른 fork에서 개수 확인). 패널이 두 종류다(본 패널, 좌굴 보고서 `ViewColumn.Beside` 패널).
  - PDF 저장은 VS Code가 아니라 Edge/Chrome 실행파일을 spawn하는 방식이라(StcfsdPanel.ts:2576-2643) 그대로 동작한다. Electron 셸이라면 `webContents.printToPDF`로 대체할 수 있다.
- **전역 경로 의존**: `path.join(extensionPath, 'python')`, `media/mcp-server.js`, `.venv` 탐색. 앱 설치 폴더를 extensionPath로 주면 그대로 동작한다.
- **판정**: 스텁할 API는 약 30종(extension.ts 15종 + Provider 5종 + Panel 10여종)이다. 그중 실질 작업은 WebviewPanel 에뮬레이션 1개다. 호스트 TS 로직(StcfsdPanel의 계산·오케스트레이션 약 1500행, MCP 브릿지, Python 브릿지, 등록 로직)을 **수정 없이 재사용할 수 있으므로 (a)는 실현 가능성이 높다.** 추가로 고려할 점: ① MCP 등록 대상을 Claude Desktop 설정 파일로 확장, ② 패널이 닫히면 상태가 사라지는 동작(데스크톱 앱에서는 "창=패널"이므로 앱 종료 시만 소실되도록 자연스럽게 해결 가능), ③ 브릿지 무인증 문제, ④ `node` PATH 의존(Electron 자체 node를 `ELECTRON_RUN_AS_NODE`로 쓰는 방안).
- 이미 존재하는 근거: 테스트 훅 `__testDispatchMessage/__testGetPostedMessages/__testGetState`(StcfsdPanel.ts:113-160)와 `test/vscode/suite/designDsmPreparation.test.js`가 웹뷰 없이 패널을 `handleMcpAction`과 메시지 주입으로 구동한다. 호스트 로직이 웹뷰 DOM과 독립적이라는 증거다. 예외는 `capture_section_preview`(웹뷰가 SVG를 PNG로 렌더해야 함)다.

---

### 9. 빌드·스크립트·테스트

#### 빌드
- `compile`: `tsc -p ./` → `out/`(extension, PythonBridge, StcfsdPanel, ProjectExplorer, mcp/bridge·registration 등. `src/webview/viewer3d`와 `src/mcp/server.ts`는 제외, tsconfig.json:15). 대상 CommonJS ES2022. **확장 호스트는 webpack 번들이 아니라 tsc 산출물**이다(main `./out/extension.js`).
- `build:webview`: webpack.config.js → `media/viewer3d.js`와 지연 청크(ts-loader, tsconfig.webview.json, lib DOM). 성능 한도 maxAsset 1.1 MB, entry 250 KB.
- `build:mcp`: webpack.mcp.config.js → `media/mcp-server.js`.
- `build` = 위 셋. `package` = build + `vsce package`. `lint` = eslint(src, webview/js, test/webview). `typecheck`.
- **webview/js/*.js와 css는 빌드하지 않는다.** 원본 그대로 `asWebviewUri`로 로드한다(app.js 7043행 단일 파일, 비모듈 스크립트).
- `.vscodeignore`: src, **/*.ts, *.map, node_modules, test, Example, .venv, 각종 md를 제외한다. VSIX에는 `out/`, `media/`, `webview/`, `python/`(소스), package.json이 들어간다. **Python 런타임과 numpy/scipy는 포함되지 않으며** 사용자 PC Python에 의존한다(활성화 시 pip 설치 제안).
- 의존성(package.json:157-161): `@babylonjs/core`, `@modelcontextprotocol/sdk` ^1.29, `zod` ^4.3.6. 엔진은 `vscode ^1.85.0`.

#### 테스트 스크립트
- `test:webview`: node 단독으로 아래 8개를 실행한다. 대부분 소스 문자열 tripwire이고, 일부는 순수 함수 단위 테스트다.
  - `design_prepare_contract.js`: 별도 "설계용 FSM 준비" 버튼 제거, `prepareDesignDsm`/`prepare_design_dsm` 경로, `_autoPrepareDesignDsm`, 하중 패밀리별 DSM 추출(`family === 'P'`/`'Mxx'`), 퍼린 설계 signature 검사, 양력 설계는 dsmNeg 사용, `deck-kx-override` UI/저장, `invalidateDerivedResults`, custom load case, neigs, MCP combined Cmx/Cmy 기본 1.0.
  - `design_state_roundtrip.js`: `designState.collectDesignInputs/restoreDesignInputs`를 FakeDocument로 SI 표시값 → US 내부 → SI 왕복 검증. 웹크리플링 입력, 스팬/지점/lap 표, Fy 동기화(design-fy, input-fy, plastic-fy)를 포함한다. **designState.js는 DOM 주입형이라 단독 실행이 가능하다**는 증거다.
  - `lap_governing_contract.js`: `selectLapGoverningMoment`(부모멘트만 선택, 'Lap end' 제외, 없으면 null)를 검증한다. app.js가 이를 사용하며 kip-ft → kip-in 12배 변환을 하는지, 패널의 `negMuSupport * 12`도 확인한다.
  - `si_units_roundtrip.js`: siUnits 상수 역원 관계, 입출력 왕복, 출력 맵 키 고정, 무차원 키 배제, server.ts 인라인 맵 금지.
  - `gui_contract_0926.js`: `design-validation` 박스와 Muy>0인데 May 없음 가드, 차트가 `--vscode-editor-background` 토큰을 쓰는지(고정 흰/검 금지), `local_not_evaluated` + `.warn-badge`, `.validation-box`, 3D 폴백 로그, canvas 5개 id와 aria-label, `@media print`.
  - `utils_contract.js`: `webview/js/utils.js`(fmt/logspace/convexHull) 단위 테스트. app.js에 정의가 없고 `globalThis.StcfsdUtils`를 쓰는지, utils.js가 app.js보다 먼저 로드되는지.
  - `parity_contract.js`: §5 참조.
  - `mcp_registration_contract.js`: registration.ts 병합/해제/조회 단위 테스트, 명령 3종 기여·등록, 덮어쓰기 패턴 제거, 트리 MCP 노드·title 메뉴 tripwire.
- `test:vscode`: `@vscode/test-electron`으로 로컬 Code.exe를 찾고, 실패하면 1.85.0을 내려받아 실행한다. `STCFSD_TEST_MODE=1`. 테스트는 `designDsmPreparation.test.js` 1개다. 패널을 열고 기본 단면이 초기화될 때까지 기다린 뒤 set_lengths(12점) → set_load_case(compression) → run_analysis → `prepareDesignDsm`(flexure) 주입 → 표시 해석 스냅샷 보존을 검증하고 → `runDesign` → dsm_warning이 없는지 확인한 다음 패널을 닫는다.
- `test:python`: `python3 test/python/run_all.py`(test_design_verification 1426행, test_regression_0926 513행 등).
- `check:mcp-parity`: §5.

---

### 핵심 요약 (부모용)
1. IPC는 MCP(stdio) → localhost HTTP 브릿지(52790~, `/status`, `/action`) → `StcfsdPanel.currentPanel.handleMcpAction`이다. 패널이 없으면 59개 도구 전부(정적 가이드 1개 제외) 실패한다. 상태는 패널 인스턴스에만 있고 닫으면 사라진다. Python은 무상태이며 단일 스레드다.
2. Python에 없는 오케스트레이션(design_purlin, aisi_design 전처리, prepare/get_dsm, report/validate 수집, 노드 편집)이 StcfsdPanel.ts TS에 있다. Python 메서드 31개 중 7개(fcfsm, load_mat, yieldMP, firstyield, signature_ss, save/load_project)는 미사용이다.
3. 등록 대상은 `.mcp.json`/`~/.claude/mcp.json`뿐이고 Claude Desktop 설정은 미지원이다. `node` PATH에 의존하고, 브릿지는 무인증·CORS *이며, save_project로 임의 경로 쓰기가 가능하다.
4. MCP save/load는 원시 모델이고 GUI .csd(설계 입력 포함)와 형식이 다르다. MCP analyze_loads·vibration·cutwp 결과는 GUI에 반영되지 않는다. MCP 설계는 결과만 보내고 GUI 입력칸은 갱신하지 않는다. instructions는 FSM 6단계만 설명한다.
5. extension.ts와 Provider의 vscode API는 약 20종으로 단순하고, viewer3d(Babylon, three.js 아님)는 canvas 주입형 순수 클래스다. 가짜 vscode로 호스트를 그대로 돌리는 (a)는 WebviewPanel 에뮬레이션(html, postMessage, asWebviewUri, cspSource) 하나가 핵심 작업이며 실현 가능하다. PlasticSurfaceRenderer는 죽은 코드다.

---

## 부록 E — 기존 문서의 문제·요구 대조

### (원제) E. 기존 문서에 기록된 GUI/UX 문제·요구사항 — 현행 코드 대조 (fork E 초안)

대상 문서: `0926코드개선방안.md`(이하 0926), `설계탭수정필요.md`(이하 설계탭), `Example/인터페이스개선안.md`(이하 IF, 1262행), `작업내용01.md`(W01), `작업내용02.md`(W02), `프로젝트개요.md`, `README.md`.
판정 기호: **유효**(아직 사실) / **부분**(일부 해소) / **해소**(코드로 확인). 문서 속 행번호는 과거 기준이므로, 증거는 현재 코드 행번호로 다시 적었다.
현재 규모: `webview/js/app.js` 7043행, `src/webview/StcfsdPanel.ts` 3640행 (0926 작성 시점 6833/2936행, W02 시점 6537/2839행 → 계속 증가).

---

### 1. 문제·요구사항 목록과 현행 상태

#### 1.1 워크플로·정보구조

| # | 문제/요구 | 출처 | 현행 상태 | 증거 |
|---|---|---|---|---|
| W-1 | 탭이 평행 나열되어 "단면→해석→설계→보고" 순서를 알 수 없고 선행조건이 강제되지 않음 | 0926 §5.2-1 | **부분** — 탭에 번호(①~④)와 구분선이 붙었지만 탭 전환에 선행조건 게이트가 없음. `switchTab`은 클래스만 바꾼다. 선행조건은 버튼을 누른 뒤 오류 문구로만 안내 | `StcfsdPanel.ts:2750-2757`(번호 탭), `app.js:415-422`(`switchTab` 무조건 전환), `app.js:2914,2975,5068`("먼저 …실행하세요" 사후 메시지) |
| W-2 | 단계형 위저드 + 결과 대시보드(Step 5, 지배모드 카드·이용률 게이지·경고 목록·다음 액션), stepper 완료 체크 | 0926 §5.3 안 A(권장), §5.4 "결과 대시보드" | **유효(미이행)** — 0926 §9 이행기록이 "위저드 개편 미이행"이라고 명시, §10 후속-1도 "DOM 결합부 분할·위저드 잔여". 앱 수준 대시보드는 없고, 검증 탭의 "Validation Dashboard"만 존재 | 0926:310, 0926:331; `app.js:5976-5990`(검증 대시보드만) |
| W-3 | 설계 탭 내부 스텝 인디케이터 ①입력→②하중→③설계 | IF §2.1, B2 | **해소(설계 탭 한정)** — 단, ②하중계산이 별도 탭으로 분리된 뒤(W02 D2)에도 설계 탭 안에 인디케이터가 남아 있어 탭 구조와 의미가 겹친다 | `StcfsdPanel.ts:3033`, `app.js:3189-3200 setDesignStep`, 호출 `app.js:3575,3676` |
| W-4 | 결과 분석 동선 부재: 좌굴곡선·모드형상·DSM값·이용률이 화면별로 흩어져 "어느 모드가 지배인가"를 한눈에 판단 불가 | 0926 §5.2-2 | **부분** — W02 D2로 해석결과(B 섹션)와 부재설계(C 섹션)를 ③ 한 탭에 모았고, 설계 요약에 강도 카드+지배 배지가 있음. 그러나 이용률은 ③ 설계, 랩 DCR은 ④ 접합부, 하중 결과는 ②, 종합은 보고서/검증 탭으로 여전히 흩어져 있음. 통합 요약 화면 없음 | `app.js:4690-4697`(strength-cards+지배 배지), `StcfsdPanel.ts:3031`(통합 ③ 탭) |
| W-5 | 해석↔설계 중복감, "FSM 해석"과 "설계용 FSM 준비" 이중 실행 | W02 C1, D2, E-3 | **해소** — 준비 버튼 제거, 해석 완료 시 `_autoPrepareDesignDsm()` 자동 실행. 설계 탭 상단 FSM/DSM 연동 상태 스트립 | `app.js:265,426`, `app.js:3680`(제거 주석), `StcfsdPanel.ts:3041`(`#design-dsm-status`), `app.js:3307` |
| W-6 | 탭 재편 이력: 6탭(전처리/해석/후처리/설계/접합/보고/검증) → 3그룹 → 현행 ① 단면·재료 / ② 하중계산 / ③ 좌굴해석·부재설계(A 좌굴해석·B 결과·C 부재설계) / ④ 접합부 / 보고서 / 검증 | W02 C1→D2→E-4 | **현행 구조** — 단, 탭바 위 HTML 주석은 구 3그룹(①②③/④⑤)을 그대로 적고 있음(주석 낡음) | `StcfsdPanel.ts:2748`(낡은 주석), `2750-2757`(실제) |
| W-7 | 부재 유형에 따라 입력 체계(자동계산/직접입력)가 몰래 바뀜 | W02 B4 | **해소** — `#member-mode-badge`로 상시 표시, 설계 탭에 부재유형 읽기전용 에코 | `StcfsdPanel.ts:2891`, `app.js:3563`; `StcfsdPanel.ts:3210`, `app.js:3516` |
| W-8 | 하중분석 → 접합부 탭 수동 왕복 | W02 B3, D2 | **해소** — 하중분석 결과에 "→ ④ Lap 접합부 설계"/"→ ③ 설계 검토" 이동 버튼 | `app.js:4550`(`btn-goto-lap-design`) |
| W-9 | 한 파라미터(Fy)가 여러 탭에 중복(`input-fy-load`, `design-fy`, 후처리 `input-fy`) — "앞 탭에서 정한 것은 뒤 탭에서 반복하지 않는다" | IF §6 (Phase D) | **해소** — `input-fy-load` 없음. 전처리 재료가 단일 소스, 설계 탭 Fy/Fu는 읽기전용, 접합부 `conn-Fy/Fu`는 동기화 후 수정 가능 | grep `input-fy-load` 0건; W02 B3(`syncFyValue/syncFuValue`) |
| W-10 | Fy/재료 변경 시 기존 해석 무효화·재해석 알림 | IF §6.3-C | **해소** — `invalidateDerivedResults` → 확장 `analysisInvalidated` 회신 | `app.js:553,7002`, `StcfsdPanel.ts:264,695` |
| W-11 | 결과 비교 히스토리(최근 2~3회 결과 비교) | IF §2.9, C2 | **유효(미구현)** | grep `designHistory` 0건 |
| W-12 | 다중 위치 검토 결과 표(Calculator 모드) | IF C5 | **부분** — 하중분석 결과·보고서에 지배조합 위치별 Mu/Vu 표는 있음(`gov.locations`), 위치별 설계검토(이용률) 표는 없음 | `app.js:4220,4251,5426-5458` |
| W-13 | Connection 전용 입력 패널, 유형별 동적 필드 | IF §2.8, C1 | **해소** — ④ 접합부 탭(랩 + 단일 접합부), 유형별 힌트 `#conn-single-hint` | `StcfsdPanel.ts:3387`; W02 C3 |

#### 1.2 결과 표시·가독성

| # | 문제/요구 | 출처 | 현행 상태 | 증거 |
|---|---|---|---|---|
| R-1 | 단계별 계산이 단색 monospace → 카드형, 지배 단계 강조 | IF §2.3-A, B1 | **해소** | `app.js:4838-4845`(`.calc-step`), `theme.css:629-644` |
| R-2 | 이용률 게이지 바(0-75 녹/75-100 주황/100+ 적) | IF §2.3-B, A2 | **해소** | `app.js:4753,4793`, `theme.css:592` |
| R-3 | 강도 비교 카드(Global/Local/Dist + GOVERNS) | IF §2.11, B3, A6 | **해소** (배지 문구 "지배") | `app.js:4690-4697,4771-4778`, `theme.css:663-690` |
| R-4 | 기준 조항 툴팁 | IF §2.12, B5 | **해소** | `app.js:3252 SPEC_TIPS`, `3275 specRefSpan` |
| R-5 | M/V 다이어그램 360×80px로 읽기 불가 → 확대·최대/최소 라벨·지점 마커 | IF §2.4, A5 | **해소** — 랩 끝 주석(annotations)·치수선까지 추가(W01 §9-10) | `app.js:4018 renderDiagramSVG(values,label,color,flipSign,dimLines,annotations,xCoords)` |
| R-6 | M/V 다이어그램 호버 값 표시(인터랙티브) | IF C3 | **유효(미구현)** — 마우스 상호작용은 좌굴곡선 캔버스에만 있음 | `app.js:2714`(유일한 `onmousemove`) |
| R-7 | 처짐 그래프 방향 반전(아래로 처짐이 위로 그려짐) | IF §7.1 | **해소**(flipSign=true) | IF:1168 |
| R-8 | formula 문자열의 US 단위가 SI 모드에서 그대로 표시 | IF §7.4 | **부분** — `_convertFormulaUnits`가 ksi→MPa 등 단위 **라벨만** 치환하고 수치는 US 그대로. W02 C3에서 "SI 모드에서 US 단위 수식 문자열" 안내 문구를 추가했다는 점이 한계를 인정 | `app.js:4845,4934,5027` |
| R-9 | 테이블 구분선·입력칸 폭 | IF §7.2-7.3 | **해소** | IF:1172-1189 |
| R-10 | 미평가(DSM 무감소 폴백) 한계상태가 결과에 묻힘 → 배지 | 0926 P1-2, §3.4 | **해소** — 국부/뒤틀림/E2.2/B4 배지 | `app.js:4800-4810`, `theme.css:424` |
| R-11 | 패스너 한계상태 표, 지배 모드 공개 | W02 C3, D1 | **해소** | W02:160,196 |
| R-12 | 랩 오류 응답 시 기본값 도면 + NG를 그림 | W02 C3 | **해소**(오류 메시지 표시) | W02:158 |

#### 1.3 입력 검증·피드백

| # | 문제/요구 | 출처 | 현행 상태 | 증거 |
|---|---|---|---|---|
| V-1 | 실시간 범위 검증·Fu≥Fy 검증 | IF §2.5 A/B, A4 | **해소** — Fu≥Fy는 W02 B3에서 편집 가능한 전처리 `input-fu`로 이동 | `app.js:3215 validateDesignInput`, `3231` |
| V-2 | 필수 입력 미완료 시 Run Design 비활성화 | IF §2.5-C | **부분** — 버튼 비활성화는 실행 중 상태용. 사전 비활성화 대신 클릭 시 검사 | `app.js:3675`(실행 중 disabled), `3640-3668` |
| V-3 | `May_strength` 등 필수값 누락 시 Python 에러만 나고 UI 메시지·포커스 없음 | 0926 §5.2-6, §5.4 설계 | **해소(해당 건)** — 제출 차단 + `#design-validation` 박스 + 포커스 이동 | `app.js:3640-3668` |
| V-4 | `Lb` 기본값(120 in) 사용 시 노란 인라인 경고 + 입력 유도 | 0926 §3.4 P3, §5.2-6, §5.4 | **부분** — 경고는 Python warnings로 결과 경고 박스에만 표시. 입력란 옆 인라인 경고는 없음 | `app.js:4813-4822`(결과 경고 박스); 입력측 grep 결과 없음 |
| V-5 | 섹션 완료 체크마크(✓) | IF §2.2-C, B4 | **유효(보류 그대로)** | grep `section-complete` 0건; IF:1044 |
| V-6 | 로딩 스피너·진행 단계 표시 | IF §2.6 A/B, A3 | **부분** — 스피너(오버레이)는 있음. design_purlin 다단계 진행률(✓/●/○)은 없음 | `StcfsdPanel.ts:3361`, `app.js:3670,4638` |
| V-7 | 표준 에러 계약 `{code,message,field,action}` + 필드 포커스·토스트·대시보드 동시 반영 | 0926 §5.5-4 | **유효(미구현)** — 에러는 상태줄 문자열/개별 박스 | grep 0건 |
| V-8 | 자동입력(`setValue`)이 input 이벤트를 안 일으켜 검증/미리보기 미반응 | W02 B2 | **해소** | `app.js:3148 setValueAndNotify`, `4448-4451` |
| V-9 | 편집 가능해 보이는 절점/요소 표가 모델에 미반영(죽은 UI) | W02 B1 | **해소** — 위임 리스너 → `updateModel` | W02:75 |
| V-10 | 모드 분류 캔버스가 MCP로만 채워지는 고아 UI | W02 B1 | **해소** — "모드 분류 실행" 버튼 | `app.js:2908-2918` |

#### 1.4 테마·다크모드·접근성

| # | 문제/요구 | 출처 | 현행 상태 | 증거 |
|---|---|---|---|---|
| T-1 | 범례 배경 `rgba(255,255,255,0.85)` 고정 → 다크 테마 파손 | 0926 §5.2-4 | **해소** — `getComputedStyle(document.body)`로 `--vscode-editor-background/foreground/panel-border` 취득 | `app.js:2507-2511`(그 외 `1928,2766,3044`) |
| T-2 | 마커·곡선 고정색(`#ff5722` 등) | 0926 §5.2-4 | **유효** — 곡선·마커는 여전히 하드코딩 팔레트. app.js 안 hex 색 리터럴 약 212개, 인라인 `style=` 약 213개; StcfsdPanel.ts 인라인 `style="` 224개 | `app.js:2529`(modeColors), `2581`(markerColors), `5005`, `5281` |
| T-3 | 경고/판정 색 하드코딩 (`#f44`, `#f90`, `rgba(255,0,0,…)`) | (0926 §5.5-2 테마 토큰 원칙) | **유효** — 접합부 결과·검증 배지 등 | `app.js:1011-1026,1077-1079,1162`, `5990-5992` |
| T-4 | 테마 토큰을 VS Code CSS 변수로 | 0926 §5.5-2; IF 전반 CSS가 `var(--vscode-*)` 전제 | **해소(VS Code 의존 심화)** — 데스크톱 이식 시 `--vscode-*` 변수 전체를 자체 토큰으로 정의해야 함 | `theme.css` 전반, `app.js:2508-2511` |
| T-5 | CSP가 차단하는 구글 폰트 `@import` | W02 B2 | **해소**(제거, VS Code 폰트 변수 사용) | W02:87 |
| T-6 | 접근성: Canvas 대체 텍스트, 키보드 순서, ARIA | 0926 §5.2-8, §5.5-7; IF §2.10 | **부분** — 캔버스 `role="img" aria-label` 5곳, 설계 입력 Enter→다음 필드. 데이터 테이블 대체·tabindex 순서·대비율 실측은 없음 | `StcfsdPanel.ts:3150-3160`, `app.js:3241-3245` |
| T-7 | 영/한 라벨 혼용 | W02 B4 | **부분** — 주요 제목은 "한글 (English)" 병기로 정리. 파일 버튼은 영문 "Open/Save"(`title="Open .csd file"`), 일부 결과 표 라벨 영문(`_summaryRow('Warnings',…)`, "DSM Applicability Warnings") | `StcfsdPanel.ts:2759-2760`, `app.js:4984,5005` |

#### 1.5 3D/2D 렌더러

| # | 문제/요구 | 출처 | 현행 상태 | 증거 |
|---|---|---|---|---|
| D-1 | Babylon 3D와 Canvas 2D 폴백 초기화·로그 분산, 실패 시 빈 화면 | 0926 §5.2-5, §5.4 해석 | **부분** — 실패 시 상태줄 메시지 + 2D 등각투영 폴백. 렌더러 팩토리/폴백 체인 일원화(§5.5-6)와 Babylon 이중 로드 점검은 미이행 | `app.js:3109-3123` |

#### 1.6 보고서·인쇄

| # | 문제/요구 | 출처 | 현행 상태 | 증거 |
|---|---|---|---|---|
| P-1 | 보고서가 화면 캡처 수준, 인쇄 CSS·PDF·계산서(steps) 미흡 | 0926 §5.2-7, §5.4 보고서 | **부분** — 상세 보고서 HTML 생성(`generateDetailedReport`), 보고서 내 `@media print`, `theme.css:437` 인쇄 CSS, "PDF 저장"은 확장이 **Edge/Chrome headless `--print-to-pdf`** 를 띄워 변환. 계산서 steps 포함. "가정(기본값/해석대체) 한 문서 정리"는 경고 수준 | `app.js:5061-5111,5122`; `StcfsdPanel.ts:2483-2643`(msedge.exe/chrome.exe 경로 탐색) |
| P-2 | 좌굴해석 결과만 별도 보고서(조건·DSM 표·차트 5종 PNG) | W02 E-3 | **해소** — 별도 웹뷰 패널 + 같은 PDF 파이프라인 | `app.js:2934 _buildBucklingReportHtml`, `2978`; `StcfsdPanel.ts:290,2485,2502` |
| P-3 | 설계 결과 클립보드 복사 | IF §1.1 | **현존** | `app.js:4616-4620`, `StcfsdPanel.ts:3380` |
| P-4 | 트리뷰·보고서 강종 공란(존재하지 않는 `select-steel-grade` 참조) | W02 B1 | **해소** | `app.js:1794,5339` 주석 |

#### 1.7 도면(SVG)

| # | 문제/요구 | 출처 | 현행 상태 | 증거 |
|---|---|---|---|---|
| S-1 | 랩 접합부 도면: 고정 픽셀, 측면도만, 패스너 위치·크기 부정확, Cut A-A 없음 | 설계탭 이슈 3; 0926 §4-3 | **해소 기록** — 전면 재작성(비례 스케일, Cut A-A, d/b/c/t 치수, 패스너 직경 비례). W02 C3에서 패스너 수 2배·부재 연장·단부거리 기준 등 추가 수정. 0926 §4 "스냅샷 테스트" 회귀고정은 없음 | `app.js:1176 _drawLapSvg` |
| S-2 | 단일 접합부 도면(나사/볼트/PAF/용접 기호) 키 불일치로 일부 미표시 | W01 §12, W02 C3 | **해소** | `app.js:1477 _drawConnectionSvg` |
| S-3 | 단면 프리뷰에 치수 오버레이(d/b/c/t/R), 임의단면 winding 오류 구간 하이라이트 | 0926 §5.4 단면 | **유효(미구현으로 보임)** — 0926 §9 이행 목록에 없음 | (0926:189-190, 이행기록 미포함) |

#### 1.8 단위계

| # | 문제/요구 | 출처 | 현행 상태 | 증거 |
|---|---|---|---|---|
| U-1 | 단위 토글 US/SI(내부 US, 표시층만 변환) | IF §2.7, C4 | **해소** — 내부 US 저장, 표시/입력층 변환 | `app.js:33-34`(주석 "내부 저장: 항상 US"), `app.js:406` 단위 토글 |
| U-2 | 단위 토글 시 전체 재렌더(현재 부분 변환 주의) | 0926 §5.4 설계 | **확인 필요** — 다른 fork 범위 | — |
| U-3 | kip-ft ↔ kip-in 12배 오류(랩 이용률, 설계 Mu, conn-Mu) | 설계탭 2B·6, W01 §6 | **해소** + tripwire(0926 §9) | `app.js:4448-4451`(`absMu * 12`) |
| U-4 | 단위 변환이 `designState.js`와 MCP `server.ts` SI 분기로 이원화 | 0926 §5.1, P1-7 | **부분** — MCP는 `src/mcp/siUnits.ts`로 중앙화+왕복 테스트, 웹뷰는 별도 `designState.js`/app.js 변환표. 두 체계가 여전히 공존 | 0926:304; `test/webview/si_units_roundtrip.js` |
| U-5 | SI 모드 "→15 PLF" 하드코딩 문구 | W02 B4 | **해소** | W02:108 |

#### 1.9 구조(모놀리스)·품질

| # | 문제/요구 | 출처 | 현행 상태 | 증거 |
|---|---|---|---|---|
| M-1 | `app.js` 단일 파일 모놀리스(수정 시 사이드이펙트 추적 불가, 순수함수 미분리) → `charts/ draw/ results/ inputs/ bridge/` ES 모듈 분할, 파일당 ≤800행 | 0926 §2, §5.2-3, §5.5-1 | **유효(악화)** — 6833→7043행. 분리된 것은 `utils.js`(43행: fmt/logspace/convexHull)와 `charts/modeShape3D.js`뿐. 0926 §9/§10이 "브라우저 실행 검증 없이 안전 분할 불가"로 보류 | 0926:310,331; `webview/js/utils.js` |
| M-2 | `StcfsdPanel.ts`가 HTML 템플릿+브릿지 호출+결과 가공 겸함 | 0926 §2, §5.1 | **유효(악화)** — 2936→3640행. 설계 후처리(정/부모멘트 설계, 랩 이용률 ×12 변환, 양력 설계 등)가 TS에 있음 | 설계탭 2B/5/6(StcfsdPanel.ts 내부 계산 기술) |
| M-3 | 상태관리: `designState.js`를 단일 진실 공급원으로, 반환에 errors[]/warnings[] | 0926 §5.5-3 | **유효(미구현)** | — |
| M-4 | 리스너 누적, dsmResult 도착 순서 race, sloppy-mode 호이스팅 의존 | W02 B2 | **해소** | W02:84-86 |
| M-5 | runAnalysis가 프론트엔드의 낡은 model을 사용해 응력 미반영 | IF §8.4 | **해소** — node/elem은 확장측 `this._model` 사용(호스트가 모델 소유) | IF:1245-1249 |
| M-6 | 초기 단면이 UI 기본값과 불일치 | IF §8.3 | **해소** | `StcfsdPanel.ts:161` |
| M-7 | 기본 강종 SGC400·기본값 14+7+20곳 분산 하드코딩 | IF §8.1 | **유효(구조적)** — 기본값이 app.js `getNum(...,35.53)`, Panel HTML, server.ts, Python에 중복 | `app.js:6011-6012`(`getNum('design-fy',35.53)` 등) |

#### 1.10 MCP 동기화 관련 기록

| # | 문제/요구 | 출처 | 현행 상태 |
|---|---|---|---|
| X-1 | "All changes are reflected in the WebView GUI in real-time" — MCP 변경이 GUI에 즉시 반영된다는 약속 | README:80, MCP 서버 instructions | 문서상 약속. 구현·한계(패널 닫힘 시)는 다른 fork 범위 |
| X-2 | 모드 분류가 MCP 경유로만 채워졌음(GUI 버튼 부재) — GUI/MCP 기능 비대칭 사례 | W02 B1 | 해소. 패리티 점검은 `scripts/check-mcp-parity.cjs` (다른 fork) |
| X-3 | `check_block_shear` MCP 스키마에 `design_method` 없어 ASD 불가 — MCP 스키마와 GUI select 값 불일치 | W02 A2; 0926 §3.4 "MCP enum과 UI select 동일 소스" | 해당 건 해소. "동일 소스" 원칙은 구조적으로 미이행(스키마·HTML 별도 작성) |
| X-4 | MCP 번들(`media/mcp-server.js`) 재빌드 후 클라이언트 재연결 + VS Code 창 리로드 필요 | README:117-138 | 현행 운영 절차. 데스크톱 전환 시 같은 문제가 남음 |

---

### 2. 문서 내 오기·낡은 기술(새 인터페이스 설계 시 주의)

- README: MCP 도구 "20 tools"(README:69, 표 README:105-113)와 "59 tool schemas"(README:130)가 한 문서 안에서 서로 다름. 실제는 59개(MCP 도구 목록 기준).
- README: 템플릿 "8 built-in"(README:22-31) — 실제 `select-template` 옵션은 10종: lippedc, lippedz, track, hat, rhs, chs, angle, isect, tee, lipped_angle (`StcfsdPanel.ts:2780-2792`).
- README Getting Started: "Generate → Run Analysis → Postprocessor tab"(README:100-101) — 현재 버튼은 "단면 생성"(`StcfsdPanel.ts:2793`), "해석 실행"(`3115`), 후처리 탭은 없고 ③ 탭의 "B. 좌굴해석 결과" 섹션.
- README Features 표(README:13-18)는 "Preprocessor/Postprocessor" 2분할 — 하중계산·부재설계·접합부·보고서·검증 기능이 README에 전혀 없음.
- `프로젝트개요.md`는 원본 MATLAB CUFSM 개요(Ref_Source 구조, v5.68) 문서로, StCFSD GUI 자체 기능 목록은 없음. "fcFSM·진동은 배치 전용"(§2, §5.5)은 원본 기준이며, StCFSD GUI에는 "자유 진동 해석" 버튼이 있음(`StcfsdPanel.ts:3161`).
- IF 문서는 파일명을 `CufsmPanel.ts`로 적음(구 이름, 현 `StcfsdPanel.ts`). IF §1.1 화면 구성(좌측 320px 패널에 Analyze Loads·Run Design 공존)은 W02 D2 이전 구조.
- `StcfsdPanel.ts:2748` 탭바 주석이 구 3그룹 배치를 설명(코드와 불일치).

---

### 3. 문서에 담긴 향후 워크플로·화면 배치 제안 (새 데스크톱 인터페이스 반영 후보)

1. **단계형 위저드 + 결과 대시보드(0926 §5.3 안 A, 권장안)**
   Step 1 단면(템플릿/임의형상, 프리뷰, 물성) → Step 2 해석(하중케이스·BC·좌굴곡선+모드) → Step 3 설계(Lb/KL/Cb, 설계법, DSM→강도) → Step 4 접합(랩/볼트/나사, 도면) → Step 5 결과 대시보드(지배모드·이용률·경고·계산서) + [보고서][검증]. 상단 stepper(완료 체크), 선행조건 충족 시 다음 단계 활성화. 대시보드를 "홈"으로, 경고 클릭 시 해당 입력으로 스크롤·포커스. — 미이행, 새 앱에서 가장 큰 설계 기회.
   ※ 현행 탭 순서(②하중계산이 ③좌굴해석보다 앞)는 0926 안(해석 → 설계)과 다름. W02 D2는 "하중계산을 부재설계에서 떼어 앞으로" 뺀 사용자 제안의 결과이므로, 위저드 설계 시 두 순서 중 무엇을 택할지 결정이 필요(FSM 해석은 하중과 독립이고 하중분석은 FSM과 독립 → 병렬 가지 후 설계에서 합류하는 구조가 실제 의존관계에 맞음).
2. **결과 대시보드 카드 4종**(0926 §5.4): ① 지배모드·공칭강도(Pn=min(Pne,Pnl,Pnd) 미니 바) ② 설계강도·이용률·PASS/FAIL ③ 경고(미검출/기본값/해석대체/단위) ④ 다음 액션(보고서/접합/재설계).
3. **설계 입력 그룹화**(0926 §5.4): 재료 / 부재조건(KL, Lb, Cb, Cm) / 소요강도(Pu, Mu, Vu) / 웹크리플링, 그룹별 접기. IF §2.2-B: 모드별 초기 펼침/접힘 규칙(직접입력 vs 계산기 모드).
4. **정보 단일 소스 원칙**(IF §6.2): "앞에서 정한 것은 뒤에서 반복하지 않는다" — 재료(강종·Fy·Fu·E·ν)는 ①에만, 뒤 탭은 읽기전용 에코. FSM BC(반파장 단부 구속)와 부재 지점조건(경간/연속)은 다른 개념임을 UI에서 분리 표기(IF §6.4; 캔틸레버만 C-F 필요).
5. **해석 결과 화면**(0926 §5.4 해석): 좌굴곡선 Mode1 강조 + L/D/G 극소 마커(Mcrl/Mcrd 라벨) + 호버 툴팁(반파장·LF·분류근거 %D/%L), DSM 카드에 `classification_method`(cfsm_modal/heuristic)+미검출 배지.
6. **접합부**(0926 §5.4): Mu 자동입력 근거 표시("지점 B 부모멘트 -1.7 kip-ft 사용" — W02/0926 §9에서 근거 타이틀 이행), 측면도+Cut A-A, SVG 스냅샷 테스트.
7. **보고서**(0926 §5.4): 계산서 steps + 입력 요약 + 가정(기본값/해석대체)을 한 문서로, 인쇄 CSS + PDF. 검증 탭에 AISI Manual 예제 대조표 + 테스트 상태 배지(예: 50/50). — 현재 PDF는 Edge/Chrome headless 의존(`StcfsdPanel.ts:2633-2643`), 데스크톱 앱에서는 내장 브라우저 엔진 인쇄로 대체 가능.
8. **기술 실행안**(0926 §5.5): app.js 모듈 분할(charts/draw/results/inputs/bridge, ≤800행, 순수함수 우선), 테마 토큰(Canvas도 토큰 팔레트), designState 단일 진실 공급원, 에러 계약 `{code,message,field,action}`, 단위 계약 한 표 + 왕복 테스트, 3D/2D 렌더러 팩토리(`createModeRenderer({preferred:'babylon'})`)+폴백 체인, 인쇄/a11y.
9. **미구현 잔여 제안**(IF §5.3): 섹션 완료 체크(B4), 결과 비교 히스토리(C2), M/V 다이어그램 호버(C3), 다중 위치 검토 표(C5), design_purlin 다단계 진행 표시(§2.6-B).
10. **설계 의도 원칙**(IF §5.4): 점진적 공개, 시각적 계층(강도 카드·게이지·지배 배지), 즉각 피드백, 테마 일관성.

---

### 4. 공식 기능 목록·사용자 워크플로 (README / 프로젝트개요) — 인벤토리 대조용

#### 4.1 README가 말하는 기능
- Section Designer(WebView): 파라메트릭 템플릿, 절점/요소 표 편집, SVG 단면 프리뷰, 재료·BC 선택 / 좌굴곡선(semilog), 2D·3D 모드형상, G/D/L/O 모드 분류, DSM 설계값 표 (README:11-18).
- DSM 자동 추출: Py, My, Pcrl/Mcrl, Pcrd/Mcrd, Pcre/Mcre + 각 반파장·하중계수 (README:33-45).
- BC 5종 S-S, C-C, S-C, C-F, C-G (README:47-57).
- 3D 모드형상(Babylon.js): 드래그 회전·스크롤 줌, 변위 컬러맵, 짧은 반파장 다중 반파 표시, Canvas 2D 등각 폴백 (README:59-65).
- MCP(Claude Code/Cursor/Codex): "AI 변경이 GUI에 실시간 반영" (README:67-80). 도구 범주 Status/Section/Analysis/Edit/Advanced (README:105-113 — 20개 기준의 낡은 표).
- 요구사항: Python 3.10+ numpy/scipy, 프로젝트 `.venv` 자동 탐지 (README:84-91).
- 엔진: klocal/kglocal, 희소 조립+스프링, BC 5종, scipy eig, cFSM, fcFSM, 진동, 소성곡면, CUTWP (README:142-154).
- MCP 번들 릴리스 정책: `media/mcp-server.js` 커밋 산출물, version=패키지버전+소스해시, `npm run build:mcp` → `npm run check:mcp-parity`, CI 검사, 클라이언트 재연결·창 리로드 (README:117-138).

#### 4.2 README가 말하는 사용자 워크플로 (낡음)
Activity Bar StCFSD 아이콘 → 트리뷰 툴바 "Open Section Designer" → 템플릿 선택 → Generate → Run Analysis → Postprocessor 탭 (README:95-101).

#### 4.3 문서들에서 재구성한 실제 워크플로 (현행 코드 기준)
1. ① 단면·재료: 템플릿(10종)/절점·요소 편집 → "단면 생성" → 단면 프리뷰·성질. 재료(강종·Fy·Fu·E·ν)는 여기서만 입력(단일 소스).
2. ② 하중계산(계산기 모드 부재일 때): 부재 유형 → 부재 구성(스팬/지점/랩) → 데크&가새 → 사용하중(D, L, Lr, S, Wu↑, Wp↓; 면압×간격) → "하중 분석 실행" → 결과(M/V/처짐 다이어그램, 지배조합, 위치별 Mu/Vu, Lb/Cb 자동, 양력용 Lb/Cb) → 소요강도 자동 채움 → "③ 설계 검토"/"④ Lap 설계" 이동 버튼. 직접입력 모드면 소요강도 직접 입력.
3. ③ 좌굴해석·부재설계: A. 좌굴해석(하중케이스·BC·반파장·cFSM·해석 실행·응력 프리뷰) → 완료 시 설계용 DSM 값 자동 준비(`_autoPrepareDesignDsm`) + B 섹션 자동 펼침 → B. 결과(DSM 표, 좌굴곡선, 모드분류 실행, 소성곡면, 진동 해석, 모드형상 2D/3D, "좌굴해석 결과 보고서" 별도 패널·PDF) → C. 부재설계(유효길이·Lb(+/-)·Cb(+/-)·β, 웹크리플링 → "설계 검토 실행" → 강도 카드·게이지·계산 카드·H1.2·규준참조·경고 배지·클립보드 복사).
4. ④ 접합부: Lap 접합부(하중분석·설계 결과로 랩길이·Mu·Vu·Se·Mnd·Vn 자동 전달) / 단일 접합부(볼트·나사·필릿·아크스폿·아크시임·그루브·PAF) → 결과 + SVG 도면.
5. 보고서: "상세 보고서 생성"(하중분석·설계 결과 필요) → "PDF 저장"(Edge/Chrome headless).
6. 검증: "검증 실행" → 8개 범주(A 단면 입력, B 재료, C 좌굴해석, D 단면성질, E 하중입력, F 하중분석, G 설계결과, H 일관성) 점검 대시보드 + 통과/주의/실패 배지 + 트리뷰 전송 (`app.js:6005-6880`, `5976-6000`).
7. 파일: 탭바 우측 Open/Save(.csd) (`StcfsdPanel.ts:2759-2760`).

의존관계 요약(문서 근거): FSM 해석 → DSM 값(Pcrl/Pcrd/Mcrl/Mcrd) → 설계 / 하중분석 → 소요강도·Lb·Cb·랩 Mu → 설계·접합부 / 설계 결과(Se=Mnl/Fy, Mnd, Vn) → 랩 접합부 휨·전단 검토(W02 C3, D1) / 재료 변경 → 해석 무효화(IF §6.3-C).
