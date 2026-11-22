# R8 — 경계층 (Python JSON-RPC 서버 · 확장 호스트 · MCP 서버 · 단위 변환 · 웹뷰 계산 경로)

## 요약

발견사항 수: **P0 0 · P1 11 · P2 12 · P3 8** (총 31).

엔진이 받는 값과 돌려주는 값 자체는 JSON-RPC 경계에서 손상되지 않는다. `python/server.py` 의 29개 메서드 중 28개를 실제 서버(`.venv` python, `cwd=python`, `-u server.py`, 줄 단위 JSON)로 호출해 같은 인자로 엔진 함수를 직접 부른 결과와 비교했고 수치가 모두 같았다(유일한 차이는 `spec_sections` 순서가 해시 시드에 따라 바뀌는 것). `signature_ss` 메서드는 상대 import 때문에 항상 실패한다(R8-24). 문제는 엔진 **앞뒤**에 있다.

1. **기준응력 fy 의 불일치.** DSM 추출(`Pcrl = LF × Py(fy)`)과 설계(`Py`·`My` 를 DSM 에서 받음)는 해석에 쓴 기준응력과 같은 fy 를 써야 한다. MCP `get_dsm_values` 는 fy 를 항상 보낸다(생략 시 35.53, SI 에서도 변환하지 않음). 설계 경로는 해석 fy 의 Py/My 를 설계 Fy 와 섞는다. 그 결과 Mcrl 이 0.71×–9.7× 로 틀리고(R8-01), 휨·압축 강도가 +25% 비보수로 나온다(R8-02).
2. **응력분포와 하중 family 표지의 불일치.** 템플릿을 바꾸면 응력은 균일압축으로 바뀌는데 `loadCase` 는 이전 값(초기값 `bending_xx_pos`)으로 남는다. 그러면 압축 곡선이 Mxx 로 추출된다: Mcrl 은 참값의 0.19×, Mcrd 는 0 이 된다(R8-03).
3. **MCP SI 출력은 일부만 변환된다.** `units:'SI'` 로 표시된 응답 안에 kip-in·kips 값이 섞여 있다(R8-04). Z 단면의 폐형식 전체좌굴은 `section_type` 이 전달되지 않아 C 식으로 계산된다: Mcre 2.0×, Pcre 2.24×(R8-05).
4. **같은 계산이 GUI 와 MCP 에서 다르게 조립된다.** Lap 접합 휨 검토 누락 시에도 PASS(R8-06), 퍼린 설계 알고리즘이 경로마다 다름(R8-08), 하중 분석에서 Wp·단면 누락(R8-13), 휨 설계에서 전단·웹크리플링 누락(R8-14).
5. **오류가 성공으로 보고된다.** `load_project` / `save_project` 는 실패해도 "Project loaded/saved" 를 돌려준다(R8-07). 미리보기 캡처가 실패하면 이전 PNG 경로를 성공으로 돌려준다(R8-18).
6. **로컬 HTTP 브리지에 인증이 없다.** 브리지는 CORS 를 `*` 로 열어 두었고 Content-Type 을 검사하지 않는다. 그래서 브라우저 페이지가 도구를 구동할 수 있고, `save_project` 로 임의 경로에 파일을 쓸 수 있다(R8-09).

MCP parity 실패는 CRLF 가설이 **절반만 맞다**(R8-20). 이 PC 의 해시는 CRLF 바이트로 계산되어 LF 체크아웃과 다르다. 그런데 커밋된 번들의 해시 `47fb26b50874` 는 어느 커밋의 LF·CRLF·파일별 혼합 조합과도 맞지 않는다. 번들은 커밋되지 않은 입력 상태에서 빌드된 것이다. 그래서 줄바꿈 정규화만으로는 통과하지 않고, 정규화 뒤에 한 번 다시 빌드해야 한다.

---

## 발견사항

### R8-01 [P1] [확인] `get_dsm_values` 가 해석 기준응력과 다른 fy 로 DSM 을 추출한다 (생략 시 35.53, SI 에서는 MPa 그대로)
- 위치: `src/mcp/server.ts:161-164` (`fy: fy || 35.53`, SI 분기 `:154-160` 은 길이만 변환), `src/webview/StcfsdPanel.ts:1199` (`const aFy = options.fy || this._getAnalysisFy()`), `python/engine/dsm.py:76-96,209` (`Pcrl = LF × P_ref(fy)`)
- 현상: 좌굴곡선의 LF 는 절점 응력(최대 = 해석 fy)을 기준으로 한 배수다. DSM 은 `crl = LF × Py(fy 인자)` 로 계산한다. 그래서 fy 인자가 해석 fy 와 다르면 crl·crd·P_y 가 fy 인자/해석 fy 비율만큼 틀린다. MCP 는 fy 를 생략해도 35.53 을 보낸다. 그래서 패널의 `_getAnalysisFy()` 대체가 한 번도 실행되지 않는다. `units:'SI'` 에서도 fy 는 변환되지 않는다(설명문은 "Converts the effective lengths").
- 근거: `scratchpad/review/R8/boundary_cases.py` 케이스 (a)(a2). 8×2.5×0.059 립 C, 해석 응력 50 ksi 의 Mxx 곡선:
  - MCP 기본(fy=35.53) Mcrl 62.05 / 참값 87.32 kip-in = **0.711×**
  - 해석 35.53, SI 로 fy=345(MPa) 를 넘기면 Mcrl 847.8 / 87.32 = **9.71×**
  - 해석 35.53 에서 AI 가 설계 Fy=50 을 넘기면 1.41× 로 비보수
- 영향: `get_dsm_values` 의 Pcrl·Pcrd·Mcrl·Mcrd·Py·My. 방향은 fy 인자 > 해석 fy 이면 비보수, 반대면 보수. AI 는 보통 "설계 Fy" 를 넣는다.
- 수정안:
  - server.ts 에서 `fy` 기본값을 없앤다(`fy` 가 undefined 면 키를 보내지 않음). 패널은 `options.fy` 를 무시하고 언제나 `this._lastAnalysisResult._meta.fy` 로 추출한다.
  - fy 를 따로 받으려면 `fy_ref` 로 이름을 바꾸고, 해석 fy 와 다르면 오류를 낸다.
  - SI 분기에서도 응력을 변환하거나, SI 에서 fy 입력을 금지한다.
  - 응답에 `fy_used`(이미 있음)와 함께 `units` 를 넣고, SI 면 결과 힘·모멘트를 변환한다.
- 회귀 시험: 해석 fy=50(bending_xx_pos) → `get_dsm_values(load_type='Mxx')` 를 fy 없이 호출 → Mcrl = 87.32 kip-in(±0.1%). fy=35.53 을 명시하면 오류가 나야 한다.

### R8-02 [P1] [확인] 설계 호출에 해석 fy 기준 DSM Py/My 를 넘기고 설계 Fy 는 따로 써서 강도가 비보수로 나온다
- 위치:
  - `src/webview/StcfsdPanel.ts:1469-1506`: 준비된 DSM 이 없을 때의 대체 경로로, MCP 경로는 항상 여기를 지난다. `aFy = this._getAnalysisFy()` 로 추출한 `Py: dsmP.P_y`, `My: dsmM.P_y` 를 넘긴다.
  - `python/design/aisi_s100.py:483-484` (`Py = Py_dsm if Py_dsm>0 else Ag*Fy`, `Ag_eff = Py/Fy`), `:822-825` (`My = My_dsm*scale`, `scale = Fy_eval/Fy_original` = 1)
- 현상: MCP `set_load_case` 기본 fy=35.53, `aisi_design_*` 기본 Fy=35.53 이고 둘은 서로 독립이다. 해석 fy 가 설계 Fy 와 다르면 설계는 Py(해석 fy)와 Fy(설계)를 섞어 Ag_eff·My·λ 를 틀리게 만든다. 이 경로에는 경고도 없다.
- 근거: `boundary_cases.py` 케이스 (b)(c).

  | 경우 | Mn (kip-in) | Pn (kips) |
  |---|---|---|
  | 일관(설계 Fy=35.53, DSM@35.53) | 57.27 | 13.30 |
  | 설계 Fy=35.53, DSM@50 | **71.41 (+24.7%)** | **16.70 (+25.6%)** |
  | 설계 Fy=50, DSM@35.53 | — | 11.15 (참 15.69 의 −29%) |

  설계 Fy=35.53, DSM@50 경우의 My 는 95.6 (= Sf×50) 이다.
- 영향: 휨·압축·조합 설계 강도와 합격 판정. 해석 fy > 설계 Fy 이면 비보수, 크기 ≈ fy비 (+41% 까지).
- 수정안:
  - 패널은 DSM 을 **설계 Fy 로 다시 추출**한다. `dsm` 메서드에 `fy=designFy` 를 주고, 곡선은 해석 fy 기준이므로 LF 를 `analysisFy/designFy` 로 보정한다. 가장 간단한 길은 `Pcrl`, `Pcrd`, `Mcrl`, `Mcrd` 는 해석 fy 로 추출하고(탄성값이라 fy 와 무관), `Py`·`My` 는 보내지 않는 것이다. 그러면 엔진이 `Ag·Fy`, `Sf·Fy` 를 쓴다.
  - 엔진은 `dsm.fy_ref` 를 받아 `My_dsm*Fy/fy_ref` 로 맞춘다.
- 회귀 시험: 해석 fy=50, 설계 Fy=35.53, Lb=24 in → Mn = 57.27 kip-in(현재 71.41).

### R8-03 [P1] [확인] 템플릿·절점 편집이 응력을 바꾸지만 `loadCase` 를 그대로 둔다 → 압축 곡선이 Mxx 로 추출된다
- 위치:
  - `StcfsdPanel.ts:1004-1016`: `generate_template` 은 모든 절점 응력을 `loadFy` 균일로 두는데 `loadCase` 는 바꾸지 않는다.
  - 초기 상태: `:178-180` → `set_stress pure_bending` 이 `loadCase='bending_xx_pos'` 로 둔다(`:1115`).
  - 같은 부류: `set_node_stress :2140-2159`, `modify_node(stress) :2270-2300`, `set_nodes :2188-2213`, `add_node`, `load_project :2096-2109`(파일에 loadCase 가 없으면 이전 값 유지). 모두 응력을 바꾸면서 family 는 그대로 둔다.
- 현상: MCP 기본 워크플로(서버 instructions: `set_section_template → … → run_analysis → get_dsm_values`)를 그대로 따라도 다음 상태가 된다. 해석 곡선은 균일압축인데 `_meta.load_family='Mxx'`. `run_analysis` 응답의 `dsm_Mxx` 와 그 뒤 `aisi_design_flexure` 가 압축 곡선의 극소값 × My 를 Mcrl 로 쓴다. `get_dsm_values(load_type='P')`(기본값)은 "family 불일치" 로 거절되어 AI 가 Mxx 로 다시 부르게 된다.
- 근거: `boundary_cases.py` 케이스 (d)(d2).

  | 값 | 참값(휨 곡선) | 압축 곡선을 Mxx 로 표지 |
  |---|---|---|
  | Mcrl (kip-in) | 87.32 | 16.41 (0.188×) |
  | Mcrd (kip-in) | 84.91 | 0 (미검출 → 해석식 대체) |
  | 설계 Mn (kip-in) | 57.27 | 35.21 |

- 영향: 이 단면에서는 보수(−39%)다. 그러나 보고되는 DSM 값은 틀리다. 임의의 `set_node_stress` 분포가 'compression'/'Mxx' 로 표지되면 어느 쪽으로든 틀릴 수 있다.
- 수정안: 응력을 바꾸는 모든 액션에서 `loadCase` 를 다시 정한다. `generate_template` 은 `loadCase='compression'` 으로 둔다(균일 응력을 넣으므로). 또는 이전 loadCase 로 응력을 다시 생성한다(`_setLoadCaseOnModel`). 절점 응력을 직접 편집하면 `loadCase='custom'` 으로 둔다. `load_project` 는 파일의 loadCase 가 없으면 'custom' 으로 둔다.
- 회귀 시험: 초기화 → `set_section_template(lippedc 8×2.5×0.625×0.059)` → `run_analysis` → `load_family` 는 'P' 여야 한다. `get_dsm_values('Mxx')` 는 거절되어야 한다.

### R8-04 [P1] [확인] MCP `units:'SI'` 응답에서 중첩·보조 수치가 US 로 남는다
- 위치: `src/mcp/siUnits.ts:66-129` (최상위 키 맵만 있음), `server.ts:803-807, 839-843, 883-889, 915-919, 981-985`
- 현상: 실제 MCP 서버(현 소스 번들)를 가짜 브리지와 Python 서버에 연결해 같은 부재를 US/SI 로 돌렸다(`scratchpad/review/R8/si_mcp_test.cjs`). 입력 변환과 최상위 강도 키는 맞다(이용률 US=SI). 다음 키는 US 값 그대로이고 응답의 `units` 만 'SI' 다.

  | 도구 | US 로 남는 키 |
  |---|---|
  | flexure | `positive_region.{Mne,Mnl,Mnd,Mn,phi_Mn,Fcre}`, `Fcre_detail.*`(Lb·Sf·J·Cw·σ), `Fy_used`, `Fy_original`, `steps[].value` |
  | combined | `compression.design_strength`, `flexure_x.design_strength`(중첩 맵은 Pn·Mn 만 변환), `shear.{Vn,Vy,Vcr,design_strength,Vu}`, `amplification.{PEx,PEy,Mux_amp}`, `steps[].value` |
  | connection | `limit_states[].{Rn,design_strength}` (최상위 Rn 은 kN 인데 같은 응답의 한계상태 목록은 kips) |
  | compression / tension | `steps[].value` |
  | 공통 | `report` 문자열 전체가 kips/kip-in 표기 |
  | get_dsm_values | 출력 전체 무변환(R8-01) |

- 근거: `si_mcp_test.cjs` 출력의 "numeric keys left in US units" 목록. 예: flexure `positive_region.Mn` US 57.27 = SI 57.27.
- 영향: AI 가 `flexure_x.design_strength` 나 `positive_region.phi_Mn` 을 kN-m 로 읽으면 실제(kip-in×0.113)의 **8.85배**로 읽는다(비보수). kips 를 kN 으로 읽으면 0.225배(보수). 계산서에 섞인 단위가 그대로 옮겨진다.
- 수정안: 키 목록 방식을 버린다. Python 결과 dict 를 재귀로 순회하는 `convertOutputSIDeep(result, keyUnit)` 를 만든다. 키 이름 규칙(`^(P|T|V|R)n|design_strength|Rn|Vn|PE` → force, `^M` → moment, `^F(y|u|n|cr|cre)|sigma` → stress, `^L|Lb|Ly|Lt` → length, `Sf|S[xyz]` → in³, `J` → in⁴, `Cw` → in⁶)와 `steps[].unit` 를 보고 변환한다. `report` 는 SI 응답에서 빼거나 "US units" 머리말을 붙인다. 계약 시험은 엔진 실제 출력의 모든 수치 leaf 를 열거해 미분류 키가 없는지 검사한다.
- 회귀 시험: `aisi_design_combined` SI(위 입력) → `flexure_x.design_strength` = US 값 × 0.11298.

### R8-05 [P1] [확인] `get_dsm_values` 폐형식 전체좌굴에 모델의 단면 형식을 넘기지 않아 Z 단면을 C 식으로 계산한다
- 위치: `StcfsdPanel.ts:1201-1205` (`section_type: options.section_type` — 모델의 `sectionType` 대체 없음), `server.ts:150` (기본 'C'), `python/engine/dsm.py:306,337`, `design/global_buckling.py:160-211,349,381`
- 현상: AI 가 Z 단면에서 `Lb` 나 `KxLx…` 를 주고 `section_type` 을 생략하면 엔진 기본 'C' 가 쓰인다. 그러면 F2.1.3 의 /2 와 E2.3 점대칭 분기(약주축 r_minor)가 빠진다.
- 근거: `boundary_cases.py` 케이스 (e). 8×2.5 립 Z, L=120 in:

  | 값 | section_type 'C'(기본) | section_type 'Z' | 비 |
  |---|---|---|---|
  | Mcre (kip-in) | 64.27 | 32.14 | 2.00 |
  | Pcre (kips) | 18.64 | 8.30 | 2.24 |

- 영향: Z 단면 전체좌굴값(`cre`)이 비보수. 휨은 2배, 압축은 2.24배. 설계 경로(`aisi_design`)는 `sectionInfo.type` 을 넘기므로 해당 없다.
- 수정안: 패널에서 `section_type: options.section_type ?? (this._model as any).sectionType` 로 둔다. `custom`/불명 형식은 폐형식 분기를 거절하고 오류를 낸다.
- 회귀 시험: lippedz 템플릿 → bending 해석 → `get_dsm_values('Mxx', Lb=120)` → cre = 32.14 kip-in.

### R8-06 [P1] [확인] MCP `design_lap_connection` 은 Se/Sf/Mnd/Vn/design_method 를 받지 못해 Lap 휨 검토 없이 PASS 를 낸다
- 위치: `server.ts:1204-1223` (스키마에 Se, Sf, Mnd, Vn, end_distance, design_method 없음), `python/design/lap_connection.py:300,323,329-435,437` (`flexure_ok=True` 초기값, Se 없으면 경고만)
- 현상: GUI(`app.js:900-918`)는 `Se`(Mnl/Fy)·`Sf`·`Mnd`·`Vn`·`design_method` 를 보낸다. MCP 는 보낼 수 없다. 그래서 `Se=0` 이 되고 §F/§F4/§H2 검토를 통째로 건너뛰는데 `pass` 는 True 다.
- 근거: d=8, t=0.059, Fy=50, Lap 24/24 in, Mu_support=200 kip-in, Vu=2 kips.
  - MCP 와 같은 입력: `pass=True`, `flexure_dcr=None`(경고 1줄)
  - GUI 와 같은 입력(Se=1.0): `pass=False`, DCR = **2.22**
- 영향: Lap 접합부 합격 판정이 비보수로 틀린다. 지점 부모멘트가 큰 연속 퍼린이 해당한다.
- 수정안: MCP 스키마에 `Se`, `Sf`, `Mnd`, `Vn`, `design_method`, `end_distance` 를 추가한다. Python 은 `Mu>0 and Se<=0` 이면 `pass=None`, `verdict='NOT_CHECKED'` 로 둔다(접합 J 계열의 `verification_complete` 규약과 같게).
- 회귀 시험: 위 MCP 입력 → `pass is None`, 그리고 Se=1.0 을 주면 `pass is False`.

### R8-07 [P1] [확인] MCP `load_project` / `save_project` 가 브리지 응답을 버리고 언제나 성공 문구를 돌려준다
- 위치: `server.ts:700-714` (`await callBridgePost(...)` 결과를 버리고 `textResult("Project loaded from …")`), `StcfsdPanel.ts:2090-2109` (`readFileSync`·`JSON.parse`·검증 실패 시 throw → `bridge.ts:56-58` 이 `{error}` 로 응답)
- 현상: 존재하지 않는 경로로 `load_project` 를 불렀더니 AI 가 받은 응답은 `isError:false`, `"Project loaded from Z:/does/not/exist.stcfsd"` 였다(`si_mcp_test.cjs` 마지막 줄). 모델은 이전 단면 그대로다. 같은 F12/F15 문제는 다른 도구에서는 이미 고쳐져 있다.
- 영향: AI 가 이후 해석·설계를 엉뚱한 단면으로 수행하고 결과를 불러온 프로젝트의 결과로 보고한다. save 실패를 놓치면 데이터 손실.
- 수정안: `const r = await callBridgePost(...); if (r?.error) return textResult(JSON.stringify(r));` (`set_boundary_condition`·`set_lengths` 와 같게).
- 회귀 시험: 없는 경로 → `isError: true`.

### R8-08 [P1] [확인] 퍼린 설계가 GUI 와 MCP 에서 다른 알고리즘·다른 입력으로 실행된다
- 위치: MCP `design_purlin` `server.ts:1119-1152` → `StcfsdPanel.ts:1812-2087`. GUI 는 `design_purlin` 을 쓰지 않고 `app.js:3583-3637` → `aisi_design(member_type='flexure', Lb_pos, Mu_pos, Lb, Mu, Vu, wc_*)` 단일 호출(`aisi_s100.py:1414-1417` 두 영역 처리)을 한다.
- 현상:
  1. 알고리즘이 다르다. MCP 는 정모멘트 해석(데크 스프링 ON)과 부모멘트 해석(OFF)을 따로 돌려 영역별 DSM 을 쓰고, Lap 은 2겹 합산, 양력은 R 을 적용한다. GUI 는 준비된 DSM 하나(스프링은 모델에 있는 그대로)로 두 영역을 검토한다.
  2. MCP 스키마에 `section`, `laps_per_support`, `supports`, `spans_ft`, `Fu`, `Wp` 가 없다. zod 가 이 키들을 지운다(브리지에 도착한 실제 본문: `{"action":"design_purlin","member_app":"roof-purlin","span_type":"cont-3","span_ft":25,"loads":{"D":25}}`).
  3. 그래서 패널은 `secInput={}` → `h_web=b_flange=d_lip=0` 이 되고 `designSection={type,qlip}` 만 남는다(`:1889-1911`). 휨 설계는 전단(§G2)·휨-전단(§H2)을 수행하지 못한다(`pass=None`, 경고 1줄).
  4. `Fu` 기본은 `fy*1.34` 로 SGC400 의 58.02 와 다르다(`:1871`).
- 근거: `boundary_cases.py` 케이스 (h). Vu=2 kips 일 때 단면 기하가 있으면 H2 total 0.946, pass=True. MCP 경로와 같은 입력이면 `shear=None`, `H2=None`, `pass=None`.
- 영향: 같은 퍼린·하중이 경로에 따라 다른 강도와 판정을 낸다. MCP 결과는 전단·H2·웹크리플링이 없는 미완 판정이다.
- 수정안: 한 경로로 통합한다. GUI 도 `design_purlin` 을 쓰거나 MCP 도 GUI 와 같은 단일 호출을 쓴다. 패널은 `options.section` 이 없으면 모델의 `sectionParams`(H,B,D,t,r)로 채운다. MCP 스키마에 `section`/`laps_per_support`/`supports`/`spans_ft`/`Fu`/`Wp` 를 추가한다.
- 회귀 시험: 같은 cont-3 25 ft, D/Lr/W 입력으로 GUI 경로와 MCP 경로의 design_positive.phi_Mn 과 H2 결과가 같아야 한다.

### R8-09 [P1] [확인(코드)] 로컬 브리지에 인증이 없고 CORS 가 `*` 라서 웹 페이지가 도구를 구동하고 임의 경로에 파일을 쓸 수 있다
- 위치: `src/mcp/bridge.ts:28-60,87-97`, `StcfsdPanel.ts:2090-2094` (`fs.writeFileSync(options.filepath, …)`)
- 현상: `127.0.0.1` 바인딩은 맞다. 그러나 다음 셋이 겹친다.
  - 토큰·Origin·Host 검사가 없다.
  - `Access-Control-Allow-Origin: *` 이다.
  - 본문을 Content-Type 과 무관하게 `JSON.parse` 한다.

  그래서 브라우저의 아무 페이지나 `fetch('http://127.0.0.1:52790/action',{method:'POST',body:'{"action":"save_project","filepath":"C:/…"}'})` 를 보낼 수 있다(text/plain 단순 요청이라 preflight 가 없다). 이 요청으로 임의 경로에 모델 JSON 을 덮어쓰고, 응답(`get_full_state` 등)을 읽고, 모델을 바꿀 수 있다. Host 검사가 없으니 DNS rebinding 도 막지 못한다.
- 영향: 보안(파일 덮어쓰기, 설계 상태 변조). 브라우저를 쓰는 기술자 PC 라면 누구나 해당한다.
- 수정안: 시작할 때 무작위 토큰을 만들고 MCP 서버 env(`STCFSD_MCP_TOKEN`)로 전달한다. `Authorization` 헤더를 검사한다. CORS 헤더를 없앤다. `Content-Type: application/json` 을 강제한다. `Host` 가 `127.0.0.1:port`/`localhost:port` 인지 검사한다. `save_project` 경로는 작업 폴더 아래로 제한하거나 확장자를 검사한다.
- 회귀 시험: 토큰 없는 POST → 401. `Origin: http://evil` → 403.

### R8-10 [P1] [확인] MCP `analyze_loads` 가 GUI 와 다른 입력 집합을 받는다 (Wp·단면·E 누락)
- 위치: `server.ts:1053-1096` (loads 에 `Wp` 없음, `section`/`E` 없음), GUI `app.js:3859-3896` (`loads.Wp`, `section{depth,flange_width,thickness,lip_depth,R_corner,type,Fy,Fu,Ixx}`), `server.py:273-290`
- 현상: 브리지에 도착한 MCP 본문에서 `loads.Wp` 가 지워졌다(`{"loads":{"D":25}}`). `section` 이 None 이면 Python 은 §I6.2.1 의 R 산정과 처짐(Ixx)을 할 수 없다. GUI 는 둘을 보낸다.
- 영향: 정압 풍하중(Wp) 조합이 MCP 경로에서 **빠진다**(그 조합이 지배하면 소요강도가 비보수). 양력 R 과 처짐 검토는 경로에 따라 다르다.
- 수정안: 스키마에 `loads.Wp`, `section`, `E` 를 추가한다. 패널은 `section` 이 없으면 모델 sectionParams 와 `get_properties` 의 Ixx 로 채운다.
- 회귀 시험: `loads={D:25, Wp:40}` → 브리지 본문에 Wp=40 이 있어야 하고 하중조합 목록에 Wp 조합이 있어야 한다.

### R8-11 [P1] [확인] 엔진 `design_member` 는 props 가 없으면 기본 C 단면으로 조용히 계산한다 (desktop 직접 호출의 함정)
- 위치: `python/design/aisi_s100.py:287-291, 2230-2416` (`_auto_generate_props`: H=8, B=2.5, D=0.625, t=0.0451 기본)
- 현상: `aisi_design` 에 props 없이 `{'member_type':'compression','Fy':50,'KxLx':120,…}` 를 보내면 `Pn=9.34` 를 경고 **없이** 돌려준다(warnings `[]`, 출처 표시 키 없음). 지금은 VS Code 패널이 늘 props 를 채우므로 드러나지 않는다. 그러나 이 서버를 그대로 쓰는 독립 프로그램이나 다른 클라이언트가 props 를 빠뜨리면 다른 단면의 답을 받는다.
- 영향: 다른 단면의 강도를 합격 근거로 쓰게 된다(비보수일 수 있음). README 의 "빠진 입력을 기본값으로 채움" 그 자체다.
- 수정안: props(또는 H/B/t 단면 치수)가 없으면 `{'error': 'props required'}` 를 돌려준다. 자동 생성을 남기려면 명시 플래그(`auto_section=True`)가 있을 때만 하고, `warnings` 와 `section_source='auto-default'` 를 넣는다.
- 회귀 시험: props 없는 compression 호출 → `error` 키.

### R8-12 [P2] [확인] SI 입력을 `×(1/25.4)` 로 되돌려 경계값 비교가 뒤집힌다 (볼트 d=0.5 in)
- 위치: `siUnits.ts:9-18,34-45` (곱셈 상수 `1/25.4`), `python/design/connections.py` 볼트 구멍 치수 분기(J6 계열)
- 현상: 12.7 mm × (1/25.4) = **0.49999999999999994** in 이다. 볼트 표준구멍 치수의 `d < 0.5` 같은 분기가 뒤집혀 J6 한계상태가 바뀐다.
- 근거: `boundary_cases.py` 케이스 (f), `si_mcp_test.cjs` 볼트 케이스. 원인은 d 하나다(culprit_d).

  | 한계상태 | US (kips) | SI→US (kips) | 차 |
  |---|---|---|---|
  | Shear Rupture (J6.1) | 11.217 | 11.361 | +1.3% |
  | Tension Rupture (J6.2) | 56.134 | 56.356 | +0.4% |
  | Block Shear (J6.3) | 10.823 | 10.943 | +1.1% |

- 영향: SI 경로의 접합 강도가 약간 비보수이고 US 와 다르다. 다른 임계 비교(t ≤ 0.1875, d ≥ 0.5 등)에도 같은 위험이 있다.
- 수정안: 입력은 `value / US_TO_SI[k]` 로 나눈다(12.7/25.4 = 0.5 정확). 변환 뒤 상대 1e-12 로 반올림한다(`Number(x.toPrecision(15))`). 엔진의 표 경계 비교에는 `+1e-9` 허용오차를 둔다.
- 회귀 시험: SI d=12.7 mm 볼트 → limit_states 의 Rn 이 US d=0.5 결과와 같아야 한다.

### R8-13 [P2] [확인] `set_section_template` 이 생략된 립 D 를 1 in 으로 채운다 (SI 에서도)
- 위치: `server.ts:193-205` (`params: { …, D: D || 1, t, r: r || 0, qlip }`)
- 현상: SI 로 `H=203.2, B=63.5, t=1.4986` 만 주면 브리지 본문은 `{"H":8,"B":2.5,"D":1,"t":0.059,"r":0}` 이다(`si_mcp_test.cjs`). 립 25.4 mm 가 조용히 들어간다. 립이 없는 형식(track/rhs 등)은 엔진이 무시하는지 형식별로 다르다.
- 영향: 사용자가 의도하지 않은 립 길이로 단면이 정의된다.
- 수정안: lippedc/lippedz/lipped_angle/hat 에서는 `D` 를 필수로 검증하고, 그 밖의 형식에는 보내지 않는다.
- 회귀 시험: lippedc 에서 D 를 생략하면 오류.

### R8-14 [P2] [확인] MCP 휨·압축 도구는 전단·웹크리플링·Fcre·β 입력을 받지 않아 해당 검토를 늘 생략한다
- 위치: `server.ts:811-845` (Vu, wc_*, use_inelastic_reserve, use_cold_work, dist_M1_M2, Lb_pos, Mu_pos 없음). GUI 는 `app.js:3589-3637` 에서 모두 보낸다. `aisi_s100.py:1384-1560` 은 Vu=0, wc_N=0 이면 검토를 건너뛴다.
- 현상: AI 가 `aisi_design_flexure` 로 보 검토를 하면 §G2/§H2/§G5 결과가 없다. 그런데도 `pass` 는 휨만으로 정해진다.
- 영향: 판정이 완결되지 않는다. 같은 입력이라도 GUI 에서는 FAIL, MCP 에서는 PASS 가 될 수 있다.
- 수정안: 스키마에 `Vu`, `wc_*`, `use_inelastic_reserve`, `use_cold_work`, `dist_M1_M2`, `dist_Lm`, `Lb_pos`/`Cb_pos`/`Mu_pos` 를 추가한다. 응답에는 `checks_not_evaluated: ['G2','H2','G5']` 를 넣는다.
- 회귀 시험: Vu=2 를 주면 `shear`, `combined_shear` 키가 있어야 한다.

### R8-15 [P2] [확인] 접합 직접 경로가 design_method 를 검증하지 않는다 ('lrfd' → ASD). MCP 두 도구는 ASD 를 고를 수 없다
- 위치: `server.py:340-343` (`design_connection` 직행, `design_member` 의 정규화를 거치지 않음), `connections.py:1221`, `lap_connection.py:33`. MCP `design_connection`(`server.ts:1238-1258`)과 `design_lap_connection` 에는 design_method 가 없다.
- 근거: `rpc_driver.py` 에서 screw 4개 `design_strength` 를 보면 'LRFD' 1.238, **'lrfd' 0.826**(= ASD 값), 'ASD' 0.826 이었다.
- 영향: 표기 차이 하나로 계수가 조용히 바뀐다. MCP 사용자는 ASD 검토를 할 수 없다(늘 LRFD).
- 수정안: `design_connection` / `design_lap_connection` 첫머리에서 `design_member` 와 같은 정규화·거절(LSD 포함)을 한다. MCP 스키마에 `design_method` enum 을 추가한다.
- 회귀 시험: 'lrfd' → LRFD 값 또는 오류. 'XYZ' → 오류.

### R8-16 [P2] [확인] `set_load_case(custom)` 은 응력을 fy 로 재척도하고, `set_stress(custom)`·GUI custom 은 하지 않는다. 같은 하중에서 LF 의 의미가 다르다
- 위치: `server.ts:455-459` (fy 기본 35.53 전송), `StcfsdPanel.ts:592-612,1087-1097` (`options.fy` 가 있으면 max|σ|=fy 로 척도), `:1097` (`_inferCustomLoadCase` 로 순수 family 추론). GUI 는 `app.js:2451-2457` 에서 fy 없이 보내 실제 응력을 쓰고, family 는 'custom' 이다.
- 근거: `boundary_cases.py` 케이스 (i). P=30 kips 의 실제 최대응력은 37.30 ksi 이다. MCP 는 35.53 으로 척도한다(×0.953). `P` 단독은 'compression' family 가 된다.
- 영향: 스키마는 "P: Axial force for custom (kips)" 라고 적는다. 그러나 MCP 의 LF 는 P 가 아니라 fy 분포 기준이다. AI 가 `Pcr = LF × P` 로 읽으면 P 가 fy·A 보다 클 때 비보수가 된다. GUI 와 MCP 의 곡선 값도 서로 다르다.
- 수정안: custom 은 재척도하지 않는다(실하중 LF). 응답에 `reference: 'applied loads'` 를 넣는다. 순수 family 추론은 fy 척도를 적용하는 별도 case 에서만 한다.
- 회귀 시험: custom P=30 → 절점 최대응력 37.30 ksi 보존.

### R8-17 [P2] [확인] Python 서버가 dict 가 아닌 요청이나 직렬화 불가 결과에 프로세스째 죽고, 호스트는 다시 띄우지 않는다
- 위치: `server.py:28-32` (`request.get` 이 try 밖), `:370-382` (`json.dumps` 예외는 JSONDecodeError 만 잡음; complex/set 등은 `_json_serializer` 의 TypeError 가 main 밖으로 나감), `PythonBridge.ts:71-81` (exit 시 null, 재시작 없음)
- 근거: `rpc_driver.py` 에서 `[1,2,3]` 한 줄을 보냈더니 `AttributeError: 'list' object has no attribute 'get'` 로 서버가 종료되었고, 다음 ping 은 `[Errno 22]` 였다.
- 영향: 한 번의 이상 응답으로 GUI 와 MCP 모두 "Python process is not running" 이 된다. 다시 시작하려면 사용자가 패널을 다시 열어야 한다(`ensurePythonRunning` 은 openDesigner 에서만 호출).
- 수정안: main 루프 전체를 try/except 로 감싸 오류 응답을 돌려준다. 직렬화 실패는 `{'id':…, 'error':'serialization: …'}` 로 응답한다. complex 는 실수부만 받거나 오류로 처리한다. `_call` 에서 프로세스가 없으면 `start()` 를 한 번 시도한다.
- 회귀 시험: `[1]` 다음 ping → 'pong'.

### R8-18 [P2] [확인] `get_section_preview` 가 캡처 실패나 시간 초과 때 이전 PNG 경로를 성공으로 돌려준다
- 위치: `StcfsdPanel.ts:1733-1748` (`{ success: true, file_path: this._lastPreviewPath, ...result }`), `server.ts:289-293` (`file_path` 가 있으면 성공 문구), 고정 경로 `os.tmpdir()/cufsm_section_preview.png` (`:376`)
- 현상: 웹뷰가 `{error:'No section defined'}` 를 주거나 5 초가 지나면 `_lastPreviewPath` 가 그대로 남는다. 그러면 MCP 는 "Section preview saved to: …" 를 돌려준다. 창이 둘이면 같은 파일을 서로 덮어쓴다.
- 영향: AI 가 이전 단면 그림을 보고 형상을 "검증" 한다(custom 단면 지침이 이 검증을 필수 단계로 둔다).
- 수정안: 이번 캡처에서 파일을 쓴 경우에만 path 를 돌려준다(요청마다 고유 파일명). `result.error` 가 있으면 error 로 응답한다.
- 회귀 시험: 단면이 없을 때 → `isError:true`.

### R8-19 [P2] [확인] 진동 해석의 밀도 기본값이 1.0(단위 없음)이라 진동수가 약 1/1166 이 된다
- 위치: `server.ts:692-698` ("Material density (default 1.0)"), `StcfsdPanel.ts:1368, 2476` (GUI 도 1.0 고정), `server.py:117-137`
- 근거: `rpc_driver.py` 에서 L 인덱스 25 의 1차 진동수를 비교했다. ρ=7.35e-7 kip·s²/in⁴(강재) 일 때 77.30, ρ=1.0 일 때 0.0663 이다. 비 **1166.4**.
- 영향: 진동 결과가 물리 단위와 무관한 값이다(설계 판정에는 쓰이지 않음).
- 수정안: 기본 ρ = 7.345e-7 kip·s²/in⁴ (0.2836 lb/in³ / 386.09) 로 둔다. 단위를 스키마와 GUI 에 적는다. SI 입력(kg/m³)은 변환한다.
- 회귀 시험: 기본 ρ 로 위 진동수 = 77.30.

### R8-20 [P2] [확인] MCP parity 실패 — 원인과 최소 수정
- 위치: `scripts/mcp-source-hash.cjs:22-31` (원시 바이트 해시), `.gitattributes` (`* text=auto`), `core.autocrlf=true`
- 실험(`scratchpad/review/R8/hash_exp.cjs`, `hash_commits.cjs`, `hash_brute.cjs`):

  | 해시 대상 | 값 |
  |---|---|
  | 이 PC 작업트리 원시 바이트(CRLF; server.ts 1344, siUnits 138, package.json 162, webpack 42 줄이 CRLF, tsconfig.mcp.json 만 LF) | `fea1f9f28c05` = 검사의 "expected" |
  | CRLF→LF 정규화 | `a6ead3ce3d17` = `git show HEAD:` blob 해시와 같음 |
  | 커밋된 번들 내장값 (`media/mcp-server.js` 의 `If="47fb26b50874"`) | `47fb26b50874` |

  최근 7 커밋 × 파일별 LF/CRLF 32 조합, 그리고 병합 커밋과 두 부모의 파일별 혼합(6^5 조합)을 모두 계산했다. **어느 것도 `47fb26b50874` 와 같지 않았다**.
- 판정: CRLF 가설은 **부분 확인**. 이 PC 에서는 CRLF 때문에 LF 기준(`a6ead3…`)과 다른 해시가 나온다. 그러나 번들이 맞지 않는 직접 원인은 번들이 커밋된 어떤 입력과도 다른, 커밋되지 않은 상태에서 빌드되었다는 것이다. 빌드할 때의 package.json 등이 달랐던 것으로 보인다.
- 기능 패리티는 문제없다. 같은 검사에서 도구 이름 59/59, inputSchema, description 이 모두 일치한다(`npm run check:mcp-parity` 출력에 실패 항목이 버전 1개뿐). 현 소스를 스크래치로 webpack 빌드하면 최신 변경(`Cmx ?? 1.0` 등)이 번들에 들어 있다.
- 최소 수정:
  1. `mcp-source-hash.cjs` 에서 `h.update(fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'))` 로 바꾼다(빌드와 검사가 같은 헬퍼를 쓰므로 양쪽이 동시에 바뀐다).
  2. 현 소스로 `npm run build:mcp` 를 한 번 하고 커밋한다. 그러면 내장값이 `a6ead3ce3d17` 이 되고 Windows·Linux 모두 통과한다.
  3. (선택) `.gitattributes` 에 `media/mcp-server.js* -text` 를 추가해 번들 자체의 줄바꿈 변환을 막는다.
- 회귀 시험: CRLF 체크아웃과 LF 체크아웃에서 `node -e "console.log(require('./scripts/mcp-source-hash.cjs').mcpSourceHash())"` 결과가 같아야 한다.

### R8-21 [P2] [확인(코드)] Python 인터프리터 탐색: 배포본에는 `.venv` 가 없고 버전 검사도 없다 (3.10+ 필요)
- 위치: `src/extension.ts:511-536` (`<ext>/.venv` → `python.defaultInterpreterPath` → `'python'`), `.vscodeignore:2` (`.venv/**` 제외), `extension.ts:157-244` (numpy/scipy 만 검사), `python/design/aisi_s100.py:163` (`-> int | None`, `from __future__ import annotations` 없음)
- 현상:
  - VSIX 설치본은 언제나 `'python'` 이나 설정값을 쓴다. Windows 에서 Store 별칭 `python.exe` 는 `--version` 에 실패해 경고만 띄운다.
  - Python 3.9 에서는 ping 이 성공한다. 그 뒤 `aisi_design` 이 처음 import 될 때 TypeError 로 매번 실패한다.
  - 자동 `pip install` 은 그 인터프리터(전역)에 설치한다.
  - `defaultInterpreterPath` 의 `${workspaceFolder}` 같은 변수를 풀지 않는다.
- 영향: 다른 PC 에서 설계 기능만 실패한다(오류는 드러난다). desktop 이식 때 같은 함정이 된다.
- 수정안: 시작할 때 `sys.version_info >= (3,10)` 과 엔진 전체 import 를 확인하는 `selftest` 메서드를 ping 대신 호출한다. 실패하면 정확한 안내를 띄운다. 배포본은 내장 Python 또는 venv 생성 마법사를 쓴다.

### R8-22 [P2] [의심] MCP 등록이 Claude Code 가 읽지 않는 위치에 쓰고, 활성화할 때마다 추적 파일을 고쳐 쓰며, 창이 여럿이면 포트가 어긋난다
- 위치: `extension.ts:51-52, 285-321, 494-509`, `registration.ts:101-111`
- 현상:
  - 활성화할 때마다 확인 없이 네 곳에 병합 쓰기를 한다: `<ws>/.mcp.json`, `<ws>/.claude/mcp.json`, `<ext>/.mcp.json`, `~/.claude/mcp.json`. 이 저장소의 `git status` 에서 `.mcp.json`, `Example/.mcp.json`, `Example/.claude/mcp.json` 이 수정됨으로 나오는 것이 그 흔적이다.
  - Claude Code 의 프로젝트 범위는 `.mcp.json` 이 맞다. 그러나 사용자 범위는 `~/.claude.json` 이다(`claude mcp add -s user`). `~/.claude/mcp.json` 과 `<ws>/.claude/mcp.json` 은 내가 아는 한 표준 위치가 아니다(Claude Desktop 은 `%APPDATA%\Claude\claude_desktop_config.json`). 이 판단은 문서로 확인하지 못했다.
  - 창 A=52790, 창 B=52791 이면 B 가 전역 파일을 52791 로 덮는다. B 를 닫으면 전역 등록은 죽은 포트를 가리킨다. MCP 서버는 시작할 때 env 로 포트를 고정하므로, VS Code 를 다시 시작하면 클라이언트도 다시 시작해야 한다.
- 수정안: 자동 쓰기를 없애고 명령(`registerMcpServer`)만 남긴다. 포트를 고정 env 로 넘기지 말고 `%LOCALAPPDATA%/stcfsd/bridge-<pid>.json`(port+token) 레지스트리를 두고 MCP 서버가 살아 있는 항목을 찾게 한다. 전역 등록은 `claude mcp add` 실행이나 `~/.claude.json` 병합으로 한다.

### R8-23 [P2] [확인] `run_signature_curve` 가 사용자 BC·길이를 영구히 덮어쓰고 응력 family 를 'signature_ss'(→Mxx)로 표지한다
- 위치: `StcfsdPanel.ts:2112-2137`
- 현상: `BC='S-S'` 와 100점 1–1000 in 길이로 모델을 바꾼 뒤 되돌리지 않는다. `loadCase` 가 없으면 'signature_ss' 로 두고 `_analysisFamily` 는 이것을 Mxx 로 본다. 현재 응력이 압축이어도 그렇다. 길이 범위도 단면 크기와 무관한 고정값이다(Python `signature_ss` 는 요소폭 기반이지만 이 메서드는 쓰이지 않는다).
- 영향: 이후 run_analysis 가 사용자가 정한 BC 가 아닌 S-S 로 실행된다. R8-03 과 같은 family 오표지도 생긴다.
- 수정안: 임시 모델로만 해석하고 `this._model` 은 바꾸지 않는다. family 는 실제 loadCase 를 따른다.

### R8-24 [P3] [확인] Python `signature_ss` 메서드가 항상 실패한다
- 위치: `python/engine/helpers.py:264` (`from ..models.data import GBTConfig`)
- 근거: RPC 와 직접 호출 모두 `attempted relative import beyond top-level package`.
- 수정안: `from models.data import GBTConfig`. desktop 이 이 메서드를 쓸 경우를 대비해 계약 시험에 넣는다.

### R8-25 [P3] [확인] 직렬화가 numpy 배열의 NaN/Inf 를 0.0 으로 바꾼다 (float 는 null)
- 위치: `python/models/data.py:216-218, 251-253`
- 현상: 결과에 ndarray 가 그대로 남은 경로에서 NaN 이 0.0 이 되어 "0 강도/0 LF" 와 구별되지 않는다. 지금 메서드들은 대부분 `.tolist()` 뒤 float 이라 null 이 된다. 호스트는 `?? 0` 으로 다시 0 을 만든다(`StcfsdPanel.ts:1455-1505`).
- 수정안: 배열도 None 으로 바꾼다(`np.where(np.isfinite(a), a, None)` 를 object 로 tolist). 호스트는 null 을 "미산정" 으로 다룬다.

### R8-26 [P3] [확인] 엔진 stdout 에 `print` 가 남아 JSON-RPC 채널을 오염시킨다
- 위치: `python/design/aisi_s100.py:2268, 2409, 2416` (stdout), `engine/template.py:780` 은 stderr 라 문제없음
- 영향: 호스트가 "Failed to parse JSON-RPC response" 를 기록한다. 줄 단위라 응답은 살아남는다. 개행 없는 출력이 생기면 응답이 깨져 5분 시간 초과가 된다.
- 수정안: `file=sys.stderr` 또는 warnings 목록으로 옮긴다.

### R8-27 [P3] [확인] `spec_sections` 순서가 해시 시드에 따라 바뀐다
- 근거: 같은 입력, `PYTHONHASHSEED=1/2/3` → `['E3.2','E2']`, `['E2','E3.2']`, `['E3.2','E2']` (Pn=9.34 는 같음).
- 수정안: set 을 정렬된 list 로 바꾼다. 계산서 비교·회귀 시험의 잡음을 없앤다.

### R8-28 [P3] [확인] 그 밖의 매개변수 누락·탈락

| 위치 | 현상 |
|---|---|
| `server.ts:1189-1199`, `StcfsdPanel.ts:1756-1797` | `validate_design` 의 Fy 를 패널이 쓰지 않는다 |
| `server.ts:1157-1187` | `generate_report` 에 units 가 없다 |
| `StcfsdPanel.ts:1356`, `server.py:94-101` | `classify` 의 top-level GBTcon 은 Python 이 읽지 않는다(model.GBTcon 사용 — 결과적으로 같음) |
| `server.ts:1260-1276` | `check_shear_lag` 에 design_method 가 없어 늘 LRFD |
| `server.ts:743-754` | `set_gbtcon` 이 glob/dist/local/other 를 노출하지 않아 cFSM 제약을 켤 수 없다 |
| `StcfsdPanel.ts:958-966` | `_normalizeSectionType` 이 rhs·chs·isect·custom 을 'C' 로 만든다. CHS 는 §F2.3 원형관 분기를 잃는다(보수) |
| `StcfsdPanel.ts:2090-2094` vs `:3494-3549` | MCP `save_project` 는 `.stcfsd` 원시 모델, GUI 는 `.csd` 래퍼(version 1.2)라서 MCP 저장 파일을 GUI 에서 열 수 없다 |
| `StcfsdPanel.ts:3552-3621` | `_openProject` 는 version 을 검사하지 않고 node/elem 행을 검증하지 않는다. `_lastDesignRequest` 를 초기화하지 않는다 |

### R8-29 [P3] [의심] MCP 서버는 `localhost`, 브리지는 `127.0.0.1` 이다
- 위치: `server.ts:30,45`, `bridge.ts:76`
- 현상: Node 22(이 PC)는 autoSelectFamily 로 동작함을 확인했다. Node 17–19 는 Windows 에서 `localhost` 가 `::1` 로 먼저 풀려 ECONNREFUSED 가 날 수 있다(재현하지 않음).
- 수정안: `127.0.0.1` 로 통일한다.

### R8-30 [P3] [확인] 웹뷰 계약 시험은 문자열 tripwire 와 "현재의 불완전한" SI 키 목록을 고정할 뿐이다
- 위치: `test/webview/si_units_roundtrip.js:59-82` (출력 맵 키 집합을 정확히 고정 — 키를 추가하면 시험이 실패한다), `parity_contract.js`, `gui_contract_0926.js` (`includes()` 존재 검사)
- 현상: 도구 → 패널 → Python 인자 전달, 엔진 실제 출력 키의 단위 분류, GUI 와 MCP 의 결과 일치를 검사하는 시험이 없다. 이번 R8-04·06·08·10·14 가 모두 시험을 통과한 상태에서 존재한다.
- 수정안: 이 보고서의 `si_mcp_test.cjs`(가짜 브리지 + 실제 MCP 번들 + 실제 Python)를 시험으로 승격한다. 엔진 출력 leaf 전수 분류를 검사한다. GUI payload 와 MCP payload 를 같은 Python 호출로 비교한다.

### R8-31 [P3] [확인] 시간 초과와 경합

| 위치 | 현상 |
|---|---|
| `server.ts:28-60` | MCP → 브리지 HTTP 에 시간 초과가 없다 |
| `JsonRpcProtocol.ts:21` | 브리지 → Python 은 5분 |
| 같은 곳 | AI 클라이언트가 먼저 시간 초과로 끊어도 호스트는 계산을 끝내고 상태를 바꾼다. Python 이 늦게 응답하면 "No pending request" 로 버린다 |
| `server.py:380` | JSON 파싱 오류 응답은 `id:0` 이라 대기 중인 요청이 5분 동안 매달린다 |
| `global_buckling.py:363` | Python 에는 전역 가변 상태가 있다(`compute_beam_Fcre._last_detail`). 지금은 단일 스레드라 안전하지만 desktop 에서 스레드를 쓰면 경합한다 |

---

## 1. MCP 도구 계약표 (59개)

경로 표기: MCP 도구 → `POST /action {action}` → `StcfsdPanel.handleMcpAction` case → Python 메서드(`server.py`) → 엔진 함수.
"패널" 은 호스트 상태(`_model`, `_lastAnalysisResult`)만 쓰고 Python 을 부르지 않는다는 뜻이다. `custom_section_guide` 는 MCP 서버 안에서 끝난다.

| # | 도구 | 스키마 인자 (단위) | action → Python | 탈락·개명·기본값 차이 |
|---|---|---|---|---|
| 1 | get_status | — | `GET /status` → 패널 `getStatus()` | — |
| 2 | get_full_state | — | get_full_state → 패널 | 곡선 요약은 1차 모드만 |
| 3 | get_section_properties | — | get_properties → `get_properties` → `grosprop(node,elem)` | 일치 |
| 4 | get_dsm_values | load_type{P,Mxx,Mzz}, fy(ksi), KxLx/KyLy/KtLt/Lb(in·mm), Cb, section_type, units | get_dsm → `dsm` → `extract_dsm_values(curve,node,elem,fy,load_type,mode_classifications,KxLx,KyLy,KtLt,Lb,Cb,section_type)` | **fy 는 늘 전송(35.53)·SI 무변환(R8-01)**. section_type 은 모델 값으로 채우지 않음(R8-05). P family 에서는 Lb, M family 에서는 KxLx… 를 패널이 버림(의도). 출력 SI 무변환 |
| 5 | get_buckling_curve | — | get_curve → 패널 | — |
| 6 | set_section_template | type(10종), H,B,D,t,r(in·mm), qlip(deg), units | generate_template → `generate_section(type, {H,B,D,t,r,qlip})` | **D‖1, r‖0**(R8-13). 응력을 loadFy 균일로 두면서 loadCase 는 유지(R8-03). enum 10종 = 엔진 generators 10종 |
| 7 | set_custom_section | outer_corners, t, R_inner, corner_radii, n_arc, outer_side | generate_template → `generate_section('custom', …)` | 단위 인자 없음(US 가정) |
| 8 | build_section | steps[…], t, R_inner, n_arc, outer_side, expected_center | → `generate_section('custom_builder', …)` | 위와 같음 |
| 9 | get_section_preview | — | capture_section_preview → 웹뷰 PNG | **웹뷰 JS 가 살아 있어야 함**. 이전 PNG 반환(R8-18) |
| 10 | custom_section_guide | section_type | (MCP 내부 텍스트) | — |
| 11 | set_material | E(ksi), v, G(ksi) | set_material → 패널 `prop=[[100,E,E,v,v,G]]` | SI 없음. matnum 100 고정(.mat 의 다른 matnum 요소와 어긋날 수 있음) |
| 12 | set_load_case | load_case{6}, fy(ksi), P(kips), Mxx·Mzz(kip-in) | set_load_case → `get_properties`+`stresgen` | **custom 은 fy 로 재척도 + family 추론**(R8-16) |
| 13 | set_stress | type{3}, fy, P, Mxx, Mzz | set_stress → `stresgen` | custom 은 fy 를 줄 때만 재척도 → 12 와 다른 결과 |
| 14 | set_boundary_condition | BC{S-S,C-C,S-C,C-F,C-G} | set_bc → 패널 | enum = 엔진 BC 문자열 |
| 15 | set_lengths | min,max(in, >0), n(2..10000) | set_lengths → 패널 | 패널 n 기본 50 / MCP 60 (MCP 가 늘 보냄) |
| 16 | run_analysis | neigs(1..50) | run_analysis → `analyze`(stripmain) + `classify` + `dsm` | DSM 자동 추출은 analysis fy 사용(정상). R8-03 의 family 문제 |
| 17 | run_signature_curve | — | signature_ss → **`analyze`**(Python `signature_ss` 아님) | BC·길이 영구 변경, family 표지(R8-23) |
| 18 | classify_modes | — | classify → `classify(model,shapes)` | 패널의 top-level GBTcon 은 무시됨(model 의 것이 쓰임) |
| 19–20 | get_nodes / get_elements | — | 패널 | — |
| 21 | set_node_stress | node_ids, stress | 패널 | loadCase 유지(R8-03) |
| 22 | set_nodes | nodes(8열), elements? | 패널(검증 후 원자 교체) | loadCase 유지 |
| 23 | set_elements | elements(5열) | 패널 | — |
| 24–29 | add_node / add_element / modify_node / delete_node / modify_element / delete_element | 좌표·ID·두께 | 패널 | 단위 없음(US). modify_node(stress) 는 loadCase 유지 |
| 30 | double_mesh | — | doubler → `doubler` | 일치 |
| 31 | get_cutwp | — | cutwp → `cutwp_prop` | 일치 |
| 32 | run_plastic_surface | fy(ksi) | plastic → `pmm_plastic(node,elem,fy)` | 일치 |
| 33 | run_vibration | rho | vibration → `stripmain_vib` | **ρ=1.0 기본**(R8-19) |
| 34 | save_project | filepath | 패널 fs 쓰기(`.stcfsd` 원시 모델) | **응답 무시**(R8-07). Python `save_project` 미사용 |
| 35 | load_project | filepath | 패널 fs 읽기 | **응답 무시**(R8-07). 검증 없음 |
| 36 | set_springs | springs(10열) | 패널 | 열 수·값 검증 없음 |
| 37 | set_constraints | constraints(5열) | 패널 | 검증 없음 |
| 38 | set_gbtcon | ospace,norm,couple,orth | 패널 | glob/dist/local/other 노출 없음 |
| 39 | get_energy_recovery | length_index, mode_index | energy_recovery → `energy_recovery(prop,node,elem,mode,L,m_a=[1],BC)` | m_a 는 항상 [1](MCP 길이 설정과 일치) |
| 40 | aisi_design_compression | design_method, Fy, Fu, KxLx, KyLy, KtLt(=KyLy), Pu, units | aisi_design → `get_properties`, `cutwp`, `dsm`(P), `aisi_design`→`design_member` | Py 는 해석 fy 기준(R8-02). SI 일부 무변환(R8-04) |
| 41 | aisi_design_flexure | design_method, Fy, Fu, Lb, Cb, Mu, R_uplift, units | 위와 같음(dsm Mxx) | **Vu·wc_*·IR·cold work·β 없음**(R8-14). My 해석 fy(R8-02) |
| 42 | aisi_design_combined | …, Cmx/Cmy(1.0), Pu, Mux, Muy, May_strength, Vu, units | 위와 같음(P+Mxx) | 현재 해석 family 하나만 있으면 다른 family 는 0 → 엔진 대체식 + 경고 |
| 43 | aisi_design_tension | Fy, Fu, Tu, An(in²·mm²), units | 위와 같음 | An 생략 시 Ag |
| 44 | aisi_design_connection | type{7}, Fy, Fu, t1, t2, d, Fub, n, e, s, weld_*, da, groove_type, Fxx(60/414), Fuf(120/827), Pu, Ag, width, g, s_pitch, Vu, Tu, bolt_grade, threads_excluded, hole_type, units | aisi_design(connection) → `design_member`→`design_connection` | SI 반올림 경계(R8-12). limit_states 무변환(R8-04). mf, pattern_length, Ae, member_tension, load_direction 미노출 |
| 45 | steel_grades | — | `steel_grades` → `list_grades` | 일치 |
| 46 | aisi_design_guide | query_type{5} | `aisi_guide` → `design_guide` | 일치 |
| 47 | get_web_crippling | h,t,R,N(in), Fy, theta, support{4}, fastened, section_type{C,Z,HAT,I}, section_family, flange_condition, Lo, edge_distance, n_webs, web_config, bearing_case, support_fastener_spacing | `web_crippling` → `web_crippling(...)` 17 인자 모두 전달 | 일치(RPC 검증) |
| 48 | analyze_loads | member_app, span_type, span_ft, spans_ft, supports, loads{D,L,Lr,S,W}, design_method, spacing_ft, laps, laps_per_support, deck{…} | `analyze_loads` → `analyze_loads(...)` | **Wp·section·E 없음**(R8-10) |
| 49 | calc_deck_stiffness | t_panel, t_purlin, fastener_spacing(12), flange_width(2.5), kphi_override, kx_override | `calc_deck_stiffness` → `calc_rotational_stiffness`/`calc_lateral_stiffness` | 일치(0.1936 / 1.285) |
| 50 | design_purlin | member_app, span_type(string), span_ft, loads, design_method, Fy, spacing_ft, laps, deck | analyze_loads + analyze×2 + classify×2 + dsm×2 + get_properties + cutwp + aisi_design×≤4 | **section·laps_per_support·supports·spans_ft·Fu·Wp 탈락**, GUI 와 다른 알고리즘(R8-08) |
| 51 | generate_report | member_type, design_method, Fy, Fu, Mu, Pu, Lb, Cb, KxLx, KyLy, member_app, span_type, span_ft, spacing_ft, loads | 패널 수집 + 필요 시 aisi_design | units 없음 |
| 52 | validate_design | Fy | 패널 수집 | **Fy 무시** |
| 53 | design_lap_connection | d, t, Fy, Fu, lap_left_in, lap_right_in, Mu_support, Vu_support, fastener_type, fastener_dia, n_rows | `lap_connection` → `design_lap_connection` | **Se/Sf/Mnd/Vn/design_method 없음 → 휨 미검토 PASS**(R8-06) |
| 54 | check_lap_length | d, lap_left, lap_right | `check_lap_length` | 일치 |
| 55 | design_connection | type{7}, t1, t2, d, Fy, Fu, n, Pu, weld_length, weld_size, groove_type, Fub | `design_connection` → `design_connection` | design_method 없음 → LRFD 고정, 검증 우회(R8-15). d 설명이 "weld size" 지만 fillet 은 weld_size 를 씀 |
| 56 | check_shear_lag | Ag, An_net, x_bar, L_conn, Fu, Fy, Usl, connection_case | `shear_lag(**)` (패널 allowlist) | design_method 미노출 |
| 57 | check_block_shear | Agv, Anv, Ant, Fy, Fu, Ubs, design_method, connection_type, phi/omega | `block_shear(**)` | 일치 |
| 58 | cold_work | Fyv, Fuv, R, t, n_corners, corner_angle, A_corners, A_flange, corners_per_flange | `cold_work_strength(**)` | 일치 |
| 59 | flange_curling | bf, t, h, f_avg, E, allowable_cf | `flange_curling(**)` | 일치 |

요구 인자 강제와 enum 일치:
- zod 가 필수 인자를 강제하고, 알 수 없는 키는 **오류 없이 지운다**(R8-08·10 의 원인).
- enum 은 세 층에서 일치한다: design_method(LRFD/ASD; `design_member` 가 대소문자 정규화), BC 5종, 템플릿 10종, load_type 3종, WC support 4종.
- 불일치 1: GUI `select-template` 값과 MCP template enum 은 같은 엔진으로 가지만, GUI `analyzeLoads` 의 형식 정규화(`app.js:3800-3806`)는 Z/Hat/Track/C 4종만 구분한다.
- 불일치 2: 접합 직접 경로(55)는 design_method 를 검증하지 않는다.

RPC 실측: `scratchpad/review/R8/rpc_driver.py` 가 generate_section, get_properties, cutwp, stresgen, yieldMP, firstyield, doubler, analyze, classify, dsm(P, P+KL), vibration, plastic, energy_recovery, aisi_design, aisi_guide, steel_grades, web_crippling, analyze_loads, calc_deck_stiffness, lap_connection, check_lap_length, shear_lag, block_shear, cold_work, flange_curling, design_connection, save/load_project 왕복을 서버와 직접 호출로 비교했다. 수치는 모두 일치했다(aisi_design 은 `spec_sections` 순서와 report 문자열만 다름 → R8-27). signature_ss 는 실패(R8-24). load_mat 은 .mat 표본이 없어 실행하지 못했다.

## 2. 단위 변환 감사

계수 (값·방향):

| 위치 | 항목 | 판정 |
|---|---|---|
| `siUnits.ts` `US_TO_SI` | length 25.4, area 645.16, stress 6.89476, force 4.44822, moment 0.11298(kip-in→kN-m), pressure 0.04788(psf→kPa), linload 0.01459(plf→kN/m), length_ft 0.3048 | 모두 맞음. `SI_TO_US` 는 역수 곱 → 반올림 경계(R8-12) |
| `app.js:38-55` `UNIT` | inertia 416231.0(25.4⁴=416231.43, 상대 1e-6), modulus 16387.064, moment_ft 1.35582 | 맞음 |
| 같은 곳 | rotStiff 4.44822(kip-in/rad/in = kip/rad → kN·m/rad/m), latStiff 4.44822/0.0254²(=6894.8 kN/m²) | 맞음. toDisplay=×, fromDisplay=÷ 방향 맞음 |
| 없음 | Cw(in⁶) 단위형 | 계산서 문자열의 `in⁶` 은 변환 regex 에도 없어 US 값·US 라벨 그대로(일관). 밀도 단위형 없음(R8-19) |

입출력 비대칭:

| 도구 | 현상 |
|---|---|
| MCP get_dsm_values | 입력 길이만 변환, fy·출력 무변환(R8-01) |
| MCP compression/flexure/combined/tension/connection | 최상위만 변환, 중첩·steps·report 무변환(R8-04) |
| MCP set_material, set_lengths, set_load_case, set_custom_section, build_section, 절점·요소 편집, analyze_loads, design_purlin, lap/connection 직접 도구, web_crippling, special topics | SI 지원 없음(US 고정 — 설명문에 단위가 있는 경우가 대부분) |

물리 부재 US 와 SI 의 차이(8×2.5×0.625×0.059 C, Fy 50, Fu 65):

| 도구 | 판정 |
|---|---|
| compression | 일치, 최상위 ×4.4482 |
| flexure | 일치, 최상위 ×0.1130 |
| combined | 일치(이용률 0.7202) |
| tension | 일치 |
| fillet weld | 일치 |
| 볼트 | J6 계열 +0.4~1.3% (R8-12) |

중첩 무변환 목록은 R8-04.

GUI(`app.js`): 계산 payload 는 모두 `fromDisplay` 로 US 화한다. 확인한 곳:
- `collectDesignRunPayload:3583-3637`, `btnRun:2410-2464`(custom P/Mxx/Mzz 포함)
- `analyzeLoads:3784-3902`: psf→plf 는 `psf×spacing_ft` 로 US 끼리 곱함
- lap `:900-918`, 단일 접합 `:927-953`
- 자동 입력 `Mu(kip-ft)×12→kip-in` (`:4448,4451,4602`), `lap ft×12` (`:4576,6817`)

표시 쪽:
- `_convertFormulaUnits`(`:5027-5038`): 순차 regex. 이미 변환된 문자열은 다시 맞추지 않는다.
- `kip-in/rad/in` → `kN-m/rad/in` 은 혼합 표기지만 수치는 맞다.
- `in` 정규식의 `$` 가 문자 클래스 안에 있어 줄끝의 `in` 이 변환되지 않는다(US 값·US 라벨로 일관).
- `ksi` 하드코딩 표기 2곳(`:6650, 6719` Fcre)은 US 수치에 US 라벨이라 일관. SI 화면에서만 섞인다.
- `_mapUSUnit` 은 'kN','MPa','mm' 도 US 형으로 매핑한다. 엔진이 SI 단위 step 을 내면 이중 변환이 된다. 지금 엔진 step 단위는 kips/kip-in/in/ksi/''/ea 뿐이라 발생하지 않는다.
- designState 의 `analysisLoadP/Mxx/Mzz` 는 표시값으로 저장·복원한다. 단위계를 먼저 복원하므로 일관.

## 3. GUI 경로와 MCP 경로의 인자 조립 차이

| 계산 | GUI | MCP | 차이 |
|---|---|---|---|
| 단면 성질 | `getProperties` → 같은 Python | 같음 | 없음 |
| FSM 해석 | 웹뷰가 prop·lengths·BC·neigs·stressOpts 를 함께 보냄 | 패널 모델 그대로 | MCP 는 템플릿 뒤 family 오표지(R8-03). custom 하중 척도 차이(R8-16) |
| DSM 표시값 | 해석 fy, KL 없음(signature 점근) | fy 늘 전송·기본 35.53, section_type 기본 C | R8-01, R8-05 |
| 압축·휨·조합 설계 | 준비된 DSM(설계 Fy, P·Mxx 별도 해석) 우선 | 준비 경로 없음 → 현재 해석의 DSM(해석 fy) | R8-02. GUI 는 Vu·wc·IR·cold-work·β·Lb_pos 를 보냄(R8-14) |
| 인장 | Tu = design-P | Tu | 같음 |
| 전단·웹크리플링 | 휨 설계 안 wc_* | 별도 `get_web_crippling` 만 | 휨 설계 안 G5 는 MCP 에 없음 |
| 접합 | `design_connection` 직접, design_method 전송, Fub 기본 827/689 MPa | `aisi_design_connection`(design_member 경유, 검증) 또는 `design_connection`(LRFD 고정) | 기본 Fub: GUI 120/100 ksi 화면 기본 → 엔진 기본과 같음 |
| Lap | Se·Sf·Mnd·Vn·end_distance·design_method | 없음 | R8-06 |
| 하중 분석 | Wp·section(Ixx 포함)·laps_per_support·spans·supports | Wp·section 없음 | R8-10 |
| 퍼린 설계 | 단일 flexure(Lb_pos/Mu_pos) | 이중 FSM + 영역별 | R8-08 |

## 4. 오류와 상태 처리

- **Python 예외** → `{'id', 'error': str(e), 'traceback'}`. 호스트 `JsonRpcProtocol` 은 `Error(response.error)` 로 reject 하고 traceback 은 버린다. 패널은 throw 하고 브리지가 HTTP 200 `{error}` 로 응답한다. MCP `textResult` 는 최상위 `error` 키가 있으면 `isError` 로 표시한다(F15). 예외는 다음 셋이다.
  - (a) save/load_project 응답 무시(R8-07)
  - (b) preview(R8-18)
  - (c) 패널 내부의 `catch { /* optional step */ }`:

    | 위치 | 무엇이 조용히 빠지나 |
    |---|---|
    | `:1412-1416` | cutwp 실패 시 J=Cw=0 으로 진행 |
    | `:1174` | DSM 추출 실패 시 run_analysis 응답에서 dsm 키가 그냥 빠짐 |
    | `:434-436` | GUI DSM 실패는 console 만 |
    | `:670-673` | classify 실패 → 휴리스틱 |
    | `:1691, :1792` | report/validate 에서 누락 |

    이 중 cutwp 실패를 J=0 으로 처리하면 엔진 Fcre 가 0 이 되어 전체좌굴을 무시할 수 있다. 다만 엔진은 Fcre=0 일 때 Mne=0 → 보수(`global_buckling.py:297-299`).
- **NaN/Inf**: float 은 null, ndarray 는 0.0(R8-25). complex 와 비 dict 요청은 프로세스가 죽는다(R8-17). numpy 스칼라는 처리된다. MCP 브리지 replacer 는 NaN 을 null 로 바꾼다.
- **시간 초과**: Python 5분. HTTP 와 MCP 에는 없다(R8-31).
- **요청 교차·공유 상태**: Python 은 단일 스레드 직렬이고 메서드마다 상태가 없다(함수 속성 하나 예외). 호스트 `_model` 은 GUI(`updateModel`/`runAnalysis`)와 MCP 가 같이 쓴다. 해석·설계·퍼린은 시작 서명과 끝 서명을 비교해 결과를 버린다(`_requireCurrentSignature`, `_requireDerivedRevision`) — 확인함. GUI `runAnalysis` 는 웹뷰 입력칸의 prop·lengths·BC 로 MCP 가 정한 값을 덮는다(의도된 동작이지만 AI 가 정한 길이나 BC 가 사라질 수 있다).
- **크래시와 재시작**: exit 하면 대기 요청을 모두 reject 하고 `_process=null` 로 둔다. 자동 재시작은 없고, openDesigner·트리 탐색 때만 다시 띄운다.
- **인터프리터 탐색**: R8-21. `.venv` 가 없는 Windows PC 는 `python`(PATH 또는 Store 별칭)을 쓴다. Python 이 없으면 경고를 띄운 뒤 패널은 "엔진 없이" 열리고 모든 계산이 "Python process is not running" 이 된다.
- **파일**:
  - `.csd`(GUI, version 1.2, model + analysisResult(서명 일치 시에만 복원) + designInputs)
  - `.stcfsd`(MCP, 원시 모델)
  - Python `save_project`/`load_project`(.cufsm, version 1.0; 왕복 일치 확인, 호스트 미사용)
  - `load_mat`(호스트 미사용 — `.mat` 가져오기 UI 가 없다. 로더는 prop 기본 G=11300, m_all cell→list, GBTcon; curve/shapes 미로드)
  - 어느 쪽도 version 분기나 행 검증을 하지 않는다(R8-28).

## 5. 전송 구조 (독립 프로그램 설계용)

```
AI 클라이언트 ──stdio(MCP JSON-RPC, @modelcontextprotocol/sdk StdioServerTransport)──▶ node media/mcp-server.js
   media/mcp-server.js ──HTTP/1.1 평문──▶ 127.0.0.1:<STCFSD_MCP_PORT>   (확장 호스트 안의 McpBridgeServer)
        GET  /status                → panel.getStatus()
        POST /action  {action, ...} → panel.handleMcpAction(body)     (Content-Type 무시, 본문 JSON.parse 실패 시 {})
        응답: 항상 HTTP 200, JSON 본문, 오류는 {"error": "..."} (패널 없음: "No active CUFSM panel. Open Section Designer first.")
   확장 호스트(StcfsdPanel) ──stdin/stdout 줄 단위 JSON──▶ python -u server.py (cwd=<ext>/python)
        요청 {"method","params","id"} / 응답 {"id","result"} | {"id","error","traceback"}
```

- **포트 발견**: 파일·명명 파이프·레지스트리를 쓰지 않는다. 확장이 활성화될 때 `findAvailablePort(52790..52809)` 로 포트를 고르고, 그 포트를 MCP 설정의 `env.STCFSD_MCP_PORT` 로 적는다. MCP 서버는 시작할 때 env 를 한 번 읽는다(`server.ts:22-23`, 기본 52790). MCP 서버는 확장 호스트를 찾지 않는다. 설정 파일에 적힌 포트를 믿을 뿐이다.
- **인증**: 없다(R8-09). 바인딩은 127.0.0.1, CORS 는 `*`.
- **메시지 모양**: MCP 도구 인자에 action 키를 더한 평평한 JSON. `PythonBridge.call` 이 `action` 키를 지우고 Python 에 넘긴다.
- **VS Code 창이 없을 때**: 브리지가 없으니 `ECONNREFUSED` → 도구 호출이 예외 → MCP 오류. `listTools`/initialize 는 정상이다.
- **창이 둘일 때**: 창마다 브리지 하나씩(52790, 52791…)이고 `StcfsdPanel.currentPanel` 도 창마다 하나다. 작업 폴더 `.mcp.json` 은 각자 자기 포트를 적는다. 전역 `~/.claude/mcp.json` 은 마지막에 활성화된 창의 포트로 덮인다(R8-22). MCP 서버 한 프로세스는 포트 하나에만 붙는다.
- **패널이 닫혔을 때**: `onDidDispose` → `currentPanel=undefined` → `/status`·`/action` 모두 "No active CUFSM panel". 호스트 모델 상태는 패널 객체와 함께 사라진다(다시 열면 기본 단면으로 초기화). 패널이 숨겨지기만 하면 `retainContextWhenHidden` 으로 유지된다.
- **registration.ts 가 쓰는 것**: `{ mcpServers: { "stcfsd-section-designer": { command:"node", args:[<ext>/media/mcp-server.js], env:{ STCFSD_MCP_PORT:"<port>" } } } }` 를 병합해 쓴다. 활성화할 때마다 자동으로 쓰는 곳은 넷이다: `<ws>/.mcp.json`, `<ws>/.claude/mcp.json`, `<ext>/.mcp.json`, `~/.claude/mcp.json`. 명령 `registerMcpServer` 는 workspace/global/both 범위를 고를 수 있다. Claude Desktop·Cursor 등의 설정 파일에는 쓰지 않는다.
- **도구별 필요 조건**:

  | 필요 조건 | 도구 |
  |---|---|
  | 웹뷰 JS 가 살아 있어야 함 | get_section_preview |
  | 패널 객체(호스트 모델 상태)만 필요, Python 불필요 | get_status, get_full_state, get_buckling_curve, get_nodes, get_elements, set_material, set_boundary_condition, set_lengths, set_node_stress, set_nodes, set_elements, add_/modify_/delete_node·element, set_springs, set_constraints, set_gbtcon, save_project, load_project |
  | 호스트 상태 + Python | get_section_properties, get_dsm_values, set_section_template, set_custom_section, build_section, set_load_case, set_stress, run_analysis, run_signature_curve, classify_modes, double_mesh, get_cutwp, run_plastic_surface, run_vibration, get_energy_recovery, aisi_design_compression/flexure/combined/tension, design_purlin, generate_report, validate_design |
  | Python 만으로 가능(상태 무관 — 지금은 패널이 열려 있어야 브리지가 받아 줌) | steel_grades, aisi_design_guide, get_web_crippling, analyze_loads, calc_deck_stiffness, design_lap_connection, check_lap_length, design_connection, check_shear_lag, check_block_shear, cold_work, flange_curling, aisi_design_connection |
  | MCP 서버 단독 | custom_section_guide |

  주의: 패널의 `_postMessage` 는 `_disposed` 를 확인하므로 웹뷰 없이도 호스트 상태 도구는 동작한다. 다만 브리지는 패널 객체가 있어야 응답한다.

## 6. vscode API 사용 목록 (`src/`, 파일별 횟수)

| API | extension.ts | StcfsdPanel.ts | ProjectExplorerProvider.ts |
|---|---|---|---|
| `vscode.ExtensionContext` (type; `context.extensionPath/extensionUri/subscriptions`) | 4 | | |
| `commands.registerCommand` | 8 | | |
| `commands.executeCommand` | 1 | | |
| `window.createTreeView` | 1 | | |
| `window.createWebviewPanel` | | 2 | |
| `window.showInformationMessage` | 4 | 4 | |
| `window.showErrorMessage` | 3 | 5 | |
| `window.showWarningMessage` | 3 | 1 | |
| `window.showQuickPick` | 2 | | |
| `window.showSaveDialog` | | 2 | |
| `window.showOpenDialog` | | 1 | |
| `window.withProgress` + `ProgressLocation.Notification` | 1+1 | | |
| `window.activeTextEditor` | | 2 | |
| `workspace.workspaceFolders` | 1 | | |
| `workspace.onDidChangeWorkspaceFolders` | 1 | | |
| `workspace.getConfiguration` | 1 | | |
| `workspace.fs` (writeFile) | | 1 | |
| `env.openExternal` | 1 | | |
| `Uri.parse` / `Uri.file` / `Uri.joinPath` / `Uri`(type) | 1 / – / – / – | – / 1 / 8 / 3 | |
| `ViewColumn.One` / `ViewColumn.Beside` | | 1 / 2 | |
| `WebviewPanel` (type) | | 3 | |
| 웹뷰 멤버: `webview.html`(3), `webview.onDidReceiveMessage`(2), `webview.postMessage`(1), `webview.asWebviewUri`(6), `webview.cspSource`(3), `panel.onDidDispose`(2), `panel.reveal`(1) | | ✓ | |
| `TreeDataProvider`, `TreeItem`(2), `TreeItemCollapsibleState.*`(19), `ThemeIcon`(19), `EventEmitter`(1) | | | ✓ |
| 웹뷰 쪽 `acquireVsCodeApi()`(app.js 1회, `vscode.postMessage` 29곳) | | | |

`src/mcp/*`, `src/bridge/*`, `src/models/*` 는 vscode 를 import 하지 않는다. 셈(shim)이 필요한 부분은 UI(대화상자·메시지·트리·웹뷰 패널)와 `getConfiguration('python')` 뿐이다. `StcfsdPanel` 의 계산 로직(handleMcpAction)은 `_panel.webview.postMessage` 와 대화상자만 셈으로 바꾸면 Electron/Tauri 호스트로 옮길 수 있다.

## 7. 보안 (요약)

127.0.0.1 바인딩만 맞다. 토큰, Origin·Host 검사, Content-Type 강제가 없고 CORS 는 `*` 이며, `save_project` 는 임의 경로에 쓴다 → R8-09. `capture_section_preview` 는 고정 tmp 파일을 쓰고, PDF 저장은 `--no-sandbox` headless 브라우저를 쓴다(로컬 HTML 이라 위험은 낮음).

---

## 맞다고 확인한 것

- `server.py` 29개 메서드의 인자 이름이 엔진 서명과 맞는다. RPC 와 직접 호출의 수치가 같다(위 목록, `rpc_report.json`).
- `CufsmModel.from_dict` / `to_dict` 왕복, `.cufsm` 저장과 로드 왕복이 무손실이다.
- MCP 입력 SI 변환(compression/flexure/combined/tension/connection)은 posted body 기준 US 경로와 같고, 최상위 강도 키의 출력 변환도 맞다.
- `siUnits.ts`·`app.js UNIT` 의 모든 계수 값과 방향, rotStiff·latStiff 복합 단위가 맞다.
- 패널 neigs·lengths·material·node·elem 검증(F11–F13, R2-01–03), 서명·리비전 기반 결과 폐기, `isError` 표시(F15), action 키 제거(F08), special topics allowlist 가 동작한다.
- `calc_deck_stiffness`, `web_crippling` 17 인자, `check_lap_length` 는 MCP 와 GUI 에서 같다.
- 데크 스프링 10열 생성과 `apply_deck_springs` 는 F06 계약을 지킨다.
- Mcrl=Mcrd=0 일 때 엔진은 감소 없음이 아니라 해석식(App.1/App.2)으로 대체한다(Mn 33.6 < 57.3, 경고 있음) — 경계에서 0 을 넘겨도 비보수가 아니다.
- parity 검사의 도구·스키마·설명 59/59 일치.

## 확인하지 못한 것

- 실제 VS Code 확장 호스트 안에서의 종단 실행(`@vscode/test-electron`)은 하지 않았다. 패널 동작은 코드와 같은 순서의 엔진 호출로 재현했다(R8-02·03·05·08).
- `load_mat`: `.mat` 표본이 없어 실행하지 못했다. 호스트에 `.mat` 가져오기 경로도 없다.
- 웹뷰 DOM 이 `analysisInvalidated` 뒤 이전 DSM 표를 지우는지는 렌더 함수를 끝까지 따라가지 않았다(변수는 null 로 지움).
- Claude Code 가 `~/.claude/mcp.json`, `<ws>/.claude/mcp.json` 을 읽는지는 문서로 확인하지 못했다(R8-22 의심).
- Node <20 의 `localhost` 해석(R8-29)은 재현하지 않았다.
- `app.js` 의 렌더 코드는 요청대로 계산·단위 관련 부분만 읽었다(아래).

## 읽은 파일

| 파일 | 줄 수 | 범위 |
|---|---|---|
| `python/server.py` | 386 | 전체 |
| `python/__main__.py` | 10 | 전체 |
| `python/fileio/mat_loader.py` | 108 | 전체 |
| `python/fileio/project_io.py` | 29 | 전체 |
| `python/models/data.py` | 259 | 전체 |
| `src/mcp/server.ts` | 1344 | 전체 |
| `src/mcp/siUnits.ts` | 138 | 전체 |
| `src/mcp/bridge.ts` | 104 | 전체 |
| `src/mcp/registration.ts` | 141 | 전체 |
| `src/bridge/PythonBridge.ts` | 181 | 전체 |
| `src/bridge/JsonRpcProtocol.ts` | 91 | 전체 |
| `src/models/types.ts` | 107 | 전체 |
| `src/extension.ts` | 536 | 전체 |
| `src/webview/StcfsdPanel.ts` | 3640 | 1–2714, 3480–3640 전체. 2714–3480(HTML 템플릿)은 입력 기본값만 grep |
| `webview/js/designState.js` | 386 | 전체 |
| `webview/js/app.js` | 7043 | 25–580, 860–960, 2225–2504, 3540–3910, 4840–4940, 5010–5120 및 모든 환산·단위 hit 주변 |
| `scripts/check-mcp-parity.cjs` | 112 | 전체 |
| `scripts/mcp-source-hash.cjs` | 33 | 전체 |
| `webpack.mcp.config.js` | 42 | 전체 |
| `tsconfig.mcp.json` | 15 | 전체 |
| `test/webview/*.js` | 761 | si_units_roundtrip·parity_contract·gui_contract_0926 전체, 나머지는 assert 목록 |
| `python/design/aisi_s100.py` | 2418 | 경계 관련 264–335, 429–500, 749–850 + grep |
| `python/design/connections.py` | 1357 | 1218–1357 |
| `python/design/lap_connection.py` | 536 | 15–50, 296–440 |
| `python/engine/dsm.py` | 504 | 25–155 |
| `python/design/global_buckling.py` | — | 150–440 |
| `python/engine/helpers.py` | — | 251–283 |

스크래치 스크립트(모두 `C:\Users\USER\AppData\Local\Temp\claude\3df7e1c8eb560f18\99d094e4-961f-4f09-9be9-02ec03b2e201\scratchpad\review\R8\`):

| 파일 | 내용 |
|---|---|
| `rpc_driver.py` | RPC 계약·오류 시험 |
| `si_mcp_test.cjs` | 실제 MCP 번들 + 가짜 브리지 + Python, US/SI 비교 |
| `boundary_cases.py` + `boundary_cases.out.json` | R8-01·02·03·05·08·12·16 수치 |
| `hash_exp.cjs`, `hash_commits.cjs`, `hash_brute.cjs` | parity 해시 실험 |
| `build/mcp-server.js` | 현 소스 스크래치 번들 |
