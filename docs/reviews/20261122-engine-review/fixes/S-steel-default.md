# S — 기본 강종 SGC400 = 295/400 MPa (R5-31 사용자 결정) 수정 기록

## 요약

사용자 결정(2026-11-22): 사내 기본 강종은 **SGC400, Fy 295 / Fu 400 MPa** (KS D 3506 SGC295Y).
전: 프로그램의 SGC400 은 245/400 MPa(35.53/58.02 ksi) — Fy 는 한 등급 아래 SGC340 의 값(R5-31, F5 기록).
KS D 3506 구조용 강종을 KDS 41 30 30 표 3.2-2 한 표로 맞췄다. 다른 기준(SSC400 · ASTM)과 SGC570(§A3.1.3)은 그대로.
"기본 강종"은 이제 화면 재료 칸의 처음 값과 강종 표의 첫 항목만 뜻한다 — 계산 경로는 빠진 Fy 를 채우지 않는다.
옛 .csd 는 옮기지 않는다: 245 로 저장한 파일은 245 로 연다(강종 표시만 Manual).

| 강종 | 전 | 후 |
|---|---|---|
| SGC340 | 없음 | 245 / 340 MPa (추가) |
| SGC400 | 245 / 400 | **295 / 400** |
| SGC440 | 295 / 440 | 335 / 440 |
| SGC490 | 365.0 / 490.1 (52.94/71.08 ksi 반올림) | 365 / 490 (정확) |
| SGC570 | §A3.1.3 감소값 60/62 ksi | 그대로 |

값은 MPa / KSI_TO_MPA 를 반올림 없이 ksi 로 저장한다(KSI_TO_MPA = 4.4482216152605·1000/25.4², 웹뷰 `UNIT.stress`
· MCP `siUnits.US_TO_SI.stress` 와 같은 식) — × KSI_TO_MPA 가 정확히 295 · 400 으로 돌아온다(화면 "295", `Fy_MPa` 295.0).

## 바꾼 곳

| 파일 | 무엇을 |
|---|---|
| `python/design/steel_grades.py` | `KSI_TO_MPA`, `DEFAULT_GRADE='SGC400'`(표 첫 항목), `_ks_d3506(MPa)`, SGC340 추가 · SGC400/440/490 값, note = 옛 이름 → 현행 이름 대응. `list_grades` 에 `Fy_MPa`·`Fu_MPa` |
| `src/webview/steelGrades.ts` (새) | 화면 강종 표 하나: 드롭다운 `<option data-fy data-fu data-restricted>`, 기본 강종, `mpaField` |
| `src/webview/StcfsdPanel.ts` | 초기 `loadFy` = 기본 강종 Fy, 드롭다운 · Fy/Fu 칸(전처리 · 해석 표시 · 소성 · 설계 · 접합)의 처음 값이 그 표에서. 템플릿 기준응력 35.53 지어내기 삭제(아래), 응력 없는 해석 거절 |
| `webview/js/app.js` | `gradeMap` 삭제 → 드롭다운 data 값 읽기(12 자리 표시), .csd 복원 뒤 강종 표지가 파일 Fy/Fu 와 다르면 Manual + 알림. 표시 · 검증 경로의 `|| 35.53` · `getNum(…, 35.53/58.02)` 삭제 |
| `src/mcp/server.ts` → `media/mcp-server.js` | `steel_grades` 설명: ksi + MPa, 첫 항목은 화면 처음 값일 뿐 |
| `python/design/aisi_s100.py`, `lap_connection.py`, `engine/dsm.py` | 계산 경로의 Fy/Fu 기본값 삭제(아래) |
| `test/rendered/mcp.js` | 렌더 MCP 사슬이 `portFile` · `hostConnection` 도 transpile(커밋 8937def 뒤 V4-03/04 가 "Cannot find module './portFile'" 로 멈춰 있었다) |

README · MCP instructions 에는 기본 강종 문장이 없다(W2 에서 삭제) — 바꿀 것 없음.

## 아직 강재를 짐작하던 계산 경로 (결함 — 고침)

| 곳 | 전 | 후 |
|---|---|---|
| `lap_connection.design_lap_connection` (RPC `lap_connection`) | Fy/Fu 없으면 35.53/58.02 | 오류 "Fy … is required" (MCP 스키마는 이미 필수) |
| `aisi_s100._design_flexure` 냉간가공 | Fu 없으면 58.02 로 Fya | `use_cold_work` 에 Fu 없으면 오류 |
| `engine/dsm.extract_dsm_values` | `fy=35.53` 기본 인자 | 필수 인자 |
| `StcfsdPanel._applyTemplate` (MCP `set_section_template` · GUI 템플릿) | loadFy 없으면(custom 하중 뒤) 35.53 ksi 균일 응력 → get_dsm 의 Py · My 가 그 강재 | 이전 최대 \|응력\|, 없으면 응력 0 + 경고, `_analyzeModel` 이 응력 없는 해석 거절 |
| `aisi_s100` 내부 `_design_*`, `_auto_generate_props`, `check_dsm_limits` | `get('Fy', 35.53)` (design_member 가 먼저 막아 도달 불가) | `params['Fy']` / Fy 없으면 Fy 한계 줄만 생략 |
| `app.js` 미리보기 · 검증표 · 보고서 | 빈 Fy 칸 → 35.53 | 미리보기는 모양만(1 정규화), 검증은 「Fy 미지정」 실패, 보고서는 빈 값 |

## 시험

| 시험 | 종류 | 내용 |
|---|---|---|
| `test_review_1122_dsm_shear.py::test_R5_31_…` | 바꿈 (표 값 단언) | 35.53/58.02 → 295/400 MPa, note 대응 |
| `test_review_1122_steel_default.py` (새, 5) | 표 고정 | KS 표 MPa(정의값 환산, 1e-9), 첫 항목 = SGC400, 다른 강종 · SGC570 그대로, note, 랩 Fy/Fu · 냉간가공 Fu · dsm fy 필수 |
| `panel_host_contract.js::scenarioDefaultSteelAgrees` (새) | 계약 | 호스트 loadFy · HTML 칸 처음 값 · 드롭다운 data · 엔진 `steel_grades` 가 같다, app.js 에 따로 된 강종 표 없음 |
| `panel_host_contract.js::scenarioTemplateWithoutReferenceStress` (새) | 회귀 | 기준응력 없는 템플릿이 강종을 짓지 않음, 해석 거절 |
| `test/rendered/run.js` S-steel (새, 맨 앞) | 렌더 | 새 시작 295/400 MPa(모든 탭), SGC340 → 245/340, SGC440 → 335/440, 245 로 저장한 .csd → 245(모델 기준응력 포함), 표지 Manual |

Fy 35.53 · 245 를 계산 입력으로 쓰는 시험(기대값이 식 · 매뉴얼에서 따로 온 것)은 건드리지 않았다.

## 기본 흐름의 결과 (전 → 후, SI)

새 시작 기본 단면 C 100×50×20×2.3 r4, LRFD, 설계 탭 기본(KxLx = KyLy = KtLt = Lb = 3000 mm, Cb 1), 기본 부재 유형 지붕 퍼린 · 기본 하중.

| 값 | 전 | 후 |
|---|---|---|
| 재료 칸 Fy / Fu | 245 / 400 MPa | 295 / 400 MPa |
| 호스트 초기 기준응력 | 244.97 MPa (35.53 ksi) | 295 MPa |
| Py = A·Fy | 125.04 kN | 150.57 kN |
| My = Sf·Fy (설계) | 3.865 kN·m | 4.654 kN·m |
| My_xx (해석 DSM) | 3.956 kN·m | 4.763 kN·m |
| Mcrl / Mcrd (탄성) | 32.34 / 20.13 kN·m | 같음 |
| 압축 Pne (FT, 지배) / Pnd | 35.19 / 124.77 kN | 35.19 / 147.28 kN |
| 압축 φPn | 29.89 kN | 29.89 kN (전체좌굴 지배 — 그대로) |
| 휨 Mne (LTB, 지배) / Mnd | 1.947 / 3.865 kN·m | 1.947 / 4.654 kN·m |
| 휨 φMn | 1.752 kN·m | 1.752 kN·m (탄성 LTB — Fy 무관) |
| 전단 Vn (G2.1 항복) | 29.58 kN | 35.63 kN |
| 웹 크리플링 Pn (IOF) | 19.79 kN | 23.80 kN |
| 퍼린 판정 · 이용률 | NG, 2.796 (+M 구간, 1.2D+1.6Lr) | 같음 |

## 게이트

run_all `Ran 391 tests … OK` · ruff `All checks passed!` · tsc 0 · eslint 0 · test:webview 14 PASS ·
`MCP parity OK` · `node --check` 0 · test:rendered `PASS (14/14)`.
