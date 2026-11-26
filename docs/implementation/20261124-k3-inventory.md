# K3 목록 — 검증 항목 · 보고서 (2026-11-24)

K3(「검증 · 보고서를 호스트로」)의 0단계 목록. 설계: [`20261124-k3-design.md`](20261124-k3-design.md). 기계가 읽는 판: [`20261124-k3-inventory.json`](20261124-k3-inventory.json).

## 어떻게 만들었나 · 빠짐이 없음을 어떻게 보았나

- **코드에서 만든다**: `node test/rendered/k3/inventory.js` 가 `webview/js/review.js`(K3-1 이 `app.js` 에서 글 그대로 옮긴 검증 · 보고서 모듈)를 읽어(괄호 · 글자열 · 주석 · 정규식을 건너뛰는 작은 스캐너) `runAllValidationChecks` 안의 `checks.push({...})` **자리 전부**를 찾고, 자리마다 분류(그 위의 `const cat… =`) · 항목 이름 · 판정식 · 그 자리를 품은 조건(`if` · `forEach`) · 읽는 화면 칸(`getNum` · `getElementById` · `_optNum` — `designState.FIELDS` 로 검토 상태 키에) · 읽는 결과 필드(지역 변수를 세 겹까지 따라가서)를 적는다. 보고서는 `generateDetailedReport` 와 그것이 부르는 `_rpt*` · 그림(`renderBeamSchematic` · `renderDiagramSVG`) · 좌굴 보고서(`_buildBucklingReportHtml` · `_canvasPng`)의 제목 · 읽는 칸 · 결과 필드 · 화면이 만든 수(정해 둔 꼴 16 — 상수 E · ν · φ · Ω, 면압 × 간격, 감소율, 2.78Fy · 0.56Fy, 비 × 강도, 기본값, 「ksi」 글, 칸의 글).
- **손으로 적은 것**은 항목마다의 주석(무엇을 보나 · 엔진과의 관계 · 박힌 공학 한계 · K3 에서 갈 곳 · 결함) — 스크립트의 `NOTE` 표, 항목 이름으로 붙는다. 주석 없는 자리가 있으면 `--check` 가 실패한다.
- **맞대기 셋**: ① 자리의 수(72) = 소스의 `checks.push` 수(스캐너와 `grep -c` 가 같다). ② 렌더 시험(`npm run test:k3`, 14 흐름 × 단위)이 화면에서 되읽은 항목 모두가 목록의 자리 하나에 맞는다(맞지 않는 것 0 — 이름이 식인 자리는 그 안의 글자열 조각으로). ③ 한 번도 나오지 않은 자리를 적는다(조건이 맞는 흐름이 없는 것 — 아래 머리글). `npm run test:k3` 의 끝에서 `inventory.js --check` 가 목록이 지금 코드와 같은지(자리 · 이름 · 보고서 제목)를 본다 — 코드가 바뀌면 목록을 다시 만들라고 실패한다.
- 「70 항목」 은 자리의 수(72)에 가깝다. 한 번에 나오는 항목은 흐름에 따라 27(빈 화면) – 61(퍼린 + 랩)이다 — 조건(`if (dM)` · `forEach`)에 따라 빠지고 늘어난다.

## 요약

- 분류: A 단면 입력 6 · B 재료 3 · C 좌굴 해석 9 · D 단면 성질 3 · E 하중 입력 5 · F 하중 분석 14 · G 설계 결과 24 · G2 Lap 6 · H 일관성 2.
- 엔진과의 관계(`eng`): 엔진 판정을 옮김 18 · 화면만의 점검 30 · 엔진이 이미 정하는 것을 다시(같음) 10 · 다시 정하는데 다를 수 있음 8 · 늘 같은 판정 6.
- K3 에서 갈 곳(`to`): 호스트 모듈 55 · 엔진의 몫(K3 에서 옮기지 않고 표시만) 9 · 지움 / 엔진 항목으로 바꿈 8.
- **박힌 공학 한계: 항목 26 · 한계 39**(아래 표의 「박힌 한계」 열 — t 0.018 – 0.5 in, w/t 200 / 500, b/t 60 / 160, d/t 60, R/t 10 / 20, Fy 95 ksi, Fu/Fy 1.08, 반파장 0.8·H · 120 in · 1.5× · 30 점, 스팬 40 / 33 ft, 간격 8 ft, Cb 1.0 / 2.3 / 2.5, L/240 · L/180 · L/360 · 1.1×, Mne ≤ 1.01My · 1.5My, 2.78 · 0.776 · 0.673, φb 0.90 · φc 0.85, 랩 1.5d, Fy 일관 0.1 …).
- **보고서에서 화면이 스스로 만든 수 · 박힌 값: 16**(아래 보고서 표의 마지막 열). 엔진의 결과와 **다른 수**는 둘 — 상수 E 29500 ksi · ν 0.30(모델 값이 아니다, D8), 칸의 Lb · Cb(그 결과가 쓴 값이 아니다, D15). 나머지는 결과 필드를 옮기거나(강도 · 비 · 판정), 화면이 셈한 보조 수(감소율 · 2.78Fy 의 구간 판별 · 면압 × 간격 · 비 × 강도의 Mu)다.
- 단위: 검증 항목의 `value` · `criterion` 과 보고서의 표 값은 **화면 단위의 글**로 만들어진다(`_ruv` · `getNum` 의 표시값) — SI · US 고정값이 따로 있는 까닭. 엔진 단계의 `formula` 는 US 글이라 SI 보고서에 US 단위가 섞인다(D10).
- 보고서 셋: 상세 보고서(설계 · 하중 — 웹뷰 HTML), 좌굴해석 결과 보고서(별도 패널 — 칸의 글 + DSM 표 사본 + 캔버스 PNG 5), 엔진의 글 보고서(`result.report`, 「보고서 클립보드 복사」 — US 영문, 엔진 `aisi_s100.generate_report`). 상세 보고서에 들지 않는 것: 단일 접합, 검증 결과, 모드 형상 · 분류 · 소성 곡면 · 진동, 파일 이름. 결과 없이 단위를 바꾸면 빈 보고서가 생긴다(D9).

<!-- inventory:begin -->
생성: `node test/rendered/k3/inventory.js` (2026-11-26). 손으로 고치지 않는다 — 이 표 밖의 글만 손으로 쓴다.

### 검증 항목 — `checks.push` 자리 69 (review.js 251–1252)

분류별: A. 단면 입력 7 · B. 재료 3 · C. 좌굴 해석 9 · D. 단면 성질 3 · E. 하중 입력 4 · F. 하중 분석 13 · G. 설계 결과 22 · G2. Lap 접합부 6 · H. 일관성 2

엔진과의 관계: engine 26 · page 32 · dup 11 · K3 에서 갈 곳: host 66 · engine 3

박힌 공학 한계: 항목 20 · 한계 28. 결함 표시가 있는 항목 12.

렌더 시험이 본 항목: 520(흐름 14). 정적 목록에 없는 것: 없음. 한 번도 보지 못한 자리: V-F-33 양력 R 계수 (§I6.2.1); V-F-34 비지지 길이 Ly(+) (정모멘트); V-F-35 모멘트 구배 Cb(+); V-F-38 처짐 검토; V-F-39 처짐 검토; V-G-46 §A3.3.2 ↔ §F2.4.2 배타 관계; V-G-52 item; V-G-58 조합 검토 (§H1.2); V-G-59 DSM 경고 #(i1); V-G-60 isFallback ? 뒤틀림좌굴 해석적 Fallback : 설계 경고 #(i1); V-G-61 DSM 추출 경고.

| id | 줄 | 항목 | 점검 | 조건 · 판정 | 읽는 칸(상태 키) · 결과 필드 | 박힌 한계 | 엔진 | K3 | 결함 |
|---|---|---|---|---|---|---|---|---|---|
| V-A-01 | 272 | 표 B4.1-1 적용 한계 (엔진) | K3-6 (D17): the engine B4.1-1 verdict shown once — pass / fail / not evaluated | if (_b4) → pass/warn/fail |  |  | engine — member.applicability.b4 (check_dsm_limits) | host |  |
| V-A-02 | 281 | 단면 정의 | the model has nodes | pass/fail | model.node |  | page | host |  |
| V-A-03 | 289 | 두께 (t) | t from the template field within a "usual CFS" band | pass/warn/fail | tplT | THRESHOLDS.t_min 0.018 in; THRESHOLDS.t_max 0.5 in (warn outside — program value, no clause) | page | host |  |
| V-A-04 | 301 | 웹 w/t 비 | preliminary (H − 2(t + r))/t from the template fields; the engine row above is the verdict | if (t > 0 && H > 0) → pass/warn/fail | memberType, tplH, tplR, tplT | THRESHOLDS.web_note_b 250 (warn, Table B4.1-1 note b); THRESHOLDS.web_ht 300 / web_wt 500 (fail, Table B4.1-1) | dup — member.applicability.b4 / check_dsm_limits (web h/t ≤ 300 in bending, w/t ≤ 500 in compression) | host | fixed in K3-6 (D17): the 300 limit in bending (spec and engine) — was 200 / 500 for every member |
| V-A-05 | 311 | 플랜지 b/t 비 | preliminary (B − 2(t + r))/t | if (t > 0 && B > 0) → pass/fail | tplB, tplR, tplT | THRESHOLDS.flange_bt 160 (fail, Table B4.1-1) | dup — member.applicability.b4 (edge-stiffened b/t ≤ 160) | host | K3-6: the invented 60 warn band removed; the element-type row is the engine row (표 B4.1-1 적용 한계 (엔진)) |
| V-A-06 | 321 | 립 d/t 비 | preliminary D/t | if (t > 0 && D > 0) → pass/warn/fail | tplD, tplT | THRESHOLDS.unstiff_dt_note 30 (warn, Table B4.1-1 note b); THRESHOLDS.lip_dt 60 (fail, Table B4.1-1) | dup — member.applicability.b4 (lip d/t ≤ 60) | host |  |
| V-A-07 | 331 | 코너 R/t 비 | r/t | if (r > 0 && t > 0) → pass/fail | tplR, tplT | THRESHOLDS.corner_rt 20 (fail, Table B4.1-1) | dup — check_dsm_limits corner R/t ≤ 20 | host | K3-6 correction: S100-16 Table B4.1-1 (DSM column) does have R/t ≤ 20 (≤ 10 for the effective width method) and the engine checks it — the K3 phase-0 note said otherwise and was wrong; the 10 warn band (an EWM row) removed |
| V-B-08 | 345 | 항복강도 (Fy) | design Fy field > 0 and < 95 ksi | pass/fail | fy, tplB | THRESHOLDS.fy_max 95 ksi (fail at 95 — Table B4.1-1) | dup — check_dsm_limits Fy < 95 ksi (strict) | host | fixed in K3-6 (D17): strict < 95 (spec and engine) — was ≤ 95 |
| V-B-09 | 353 | Fu/Fy 비 | Fu/Fy ≥ 1.08 | pass/warn/fail | fu, fy, tplB | THRESHOLDS.fu_fy 1.08 (warn, §I6.2.1(o)) | dup — auto_params.i621_check (o) — §I6.2.1(o) | host |  |
| V-B-10 | 361 | 인장강도 (Fu) | Fu > Fy | pass/fail | fu, fy, tplB |  | page | host |  |
| V-C-11 | 388 | 반파장 최솟값 | shortest half-wavelength (model lengths) ≤ 0.8·H (or ≤ 5 in without H) | pass/warn/fail | tplH · model.lengths | THRESHOLDS.len_min_ratio 0.8·H; len_min_abs 5 in (program values) | page | host | fixed in K3-6 (D14 · D19): one rule in status, criterion and note; lengths from the model, not the display field |
| V-C-12 | 404 | 반파장 최댓값 | longest half-wavelength (model lengths) ≥ max(Lb, longest span, 120 in); pass at ≥ 1.5× | pass/warn/fail | Lb · .span-tbl-len · model.lengths | THRESHOLDS.len_max_ref 120 in; len_max_factor 1.5× (program values) | page | host | fixed in K3-6 (D19): the verdict no longer depends on the display units (blank field read as 1000 in US, 1000 mm in SI) |
| V-C-13 | 413 | 반파장 개수 | number of model lengths ≥ 30 | pass/warn/fail | model.lengths | THRESHOLDS.len_count 30 (program value) | page | host |  |
| V-C-14 | 433 | 경계조건 (BC) | K3-6 (D6): purlin / joist / girt / stud with a boundary condition other than S-S → warn (was always pass) |  | analysisBC |  | page | host |  |
| V-C-15 | 457 | Load Case 적합성 | flexural member with a compression load case (or the reverse) → warn; K3-6 (D3): purlin designs run their own ±M curves → pass |  | analysisLoadCase · d.dsm_basis_by_family, d.purlin_mode |  | dup — host _dsmForDesign load-family check (R2-05) | host |  |
| V-C-16 | 466 | 해석 실행 여부 | an analysis curve, or a purlin design (its own curves — K3-6 D3) | pass/fail | analysisResult.curve, d.dsm_basis_by_family, d.purlin_mode |  | page | host |  |
| V-C-17 | 478 | DSM 값 추출 | DSM P or Mxx, or a purlin design (K3-6 D3) | pass/fail | d.dsm_basis_by_family, d.purlin_mode, dP.crd, dP.crl, dsm.Mxx, dsm.P |  | page | host |  |
| V-C-18 | 488 | Mcrl 식별 (국부좌굴) | Mcrl > 0 | if (dM) → pass/warn | dM.Lcrl, dM.crl, dsm.Mxx |  | dup — design_checks source.buckling_analysis.method (fsm_minimum …) | engine |  |
| V-C-19 | 507 | Mcrd 식별 (뒤틀림좌굴) | Mcrd > 0, else analytic fallback possible from template dims | if (dM) → pass/warn | tplB, tplD, tplH, tplT · dM.Lcrd, dM.crd, dsm.Mxx |  | dup — design_checks source.buckling_analysis.method (analytic / analytic_raised_to_floor) | engine |  |
| V-D-20 | 523 | 성질 계산 여부 | page holds section properties | pass/fail | tplD · p.A |  | page | host |  |
| V-D-21 | 532 | 단면계수 Sx | Sx > 0 | if (p) → pass/fail | tplD · p.Sx |  | page | host |  |
| V-D-22 | 539 | 회전반경 rx, rz | rx, rz > 0 | if (p) → pass/warn | tplD · p.rx, p.rz |  | page | host |  |
| V-E-23 | 564 | 스팬 길이 | longest span > 0 and ≤ 33 ft |  | .span-tbl-len | THRESHOLDS.span_i621 33 ft (§I6.2.1(h)) | dup — auto_params.i621_check (h) span ≤ 33 ft | host | fixed in K3-6 (D7): status, criterion and note all 33 ft (spec §I6.2.1(h) and engine) — status used 40 ft |
| V-E-24 | 573 | 분담폭 (간격) | spacing > 0 and ≤ 8 ft | pass/warn/fail | spacing | THRESHOLDS.spacing_max 8 ft (program value) | page | host | fixed in K3-6 (D6): a blank spacing is "미설정" — was read as 3.281 |
| V-E-25 | 581 | 고정하중 (D) | D > 0 | pass/warn | loadD, tplD | "typical 5–15 psf" text | page | host |  |
| V-E-26 | 590 | 중력 활하중/적설하중 | any of Lr, S, L > 0 | pass/warn | loadL, loadLr, loadS |  | page | host |  |
| V-F-27 | 605 | 하중 분석 실행 여부 | page holds a load analysis | pass/fail | la.governing, la.gravity |  | page | host |  |
| V-F-28 | 616 | 최대 Mu | max \|Mu\| over the governing locations > 0 | if (la && (la.governing?.locations \|\| la.gravity?.locations \|\| la.uplift?.locations)) → pass/warn | la.governing, la.gravity, la.uplift |  | page | host |  |
| V-F-29 | 624 | 전단력 (Vu) | some location has Vu > 0 | if (la && (la.governing?.locations \|\| la.gravity?.locations \|\| la.uplift?.locations)) → pass/warn | la.governing, la.gravity, la.uplift |  | page | host |  |
| V-F-30 | 637 | 비지지 길이 Ly (부모멘트) | negative region Ly > 0 | if (negRegion) › if (la && la.auto_params) → pass/warn | ap.negative_region, ap.negative_region_gov, la.auto_params, negRegion.Ly_in |  | page | host |  |
| V-F-31 | 644 | 모멘트 구배 Cb | negative region Cb ≥ 1.0 (note > 2.5) | if (negRegion) › if (la && la.auto_params) → pass/warn | ap.negative_region, ap.negative_region_gov, la.auto_params, negRegion.Cb | 1.0; 2.5 | page | host |  |
| V-F-32 | 653 | 양력 R 계수 (§I6.2.1) | R > 0 when the engine gave R; warn when uplift exists without R | if (ap.uplift_R != null) › if (la && la.auto_params) → pass/warn | ap.uplift_R, ap.uplift_R_basis, la.auto_params |  | engine — auto_params.uplift_R · i621_check | host |  |
| V-F-33 | 663 | 양력 R 계수 (§I6.2.1) | R > 0 when the engine gave R; warn when uplift exists without R | else if (la.uplift) › if (la && la.auto_params) → warn | _i6.reasons, ap.i621_check, la.auto_params, la.uplift |  | engine — auto_params.uplift_R · i621_check | host |  |
| V-F-34 | 678 | 비지지 길이 Ly(+) (정모멘트) | positive region unbraced: Ly > 0 | if (!posR.braced) › if (la && la.auto_params && la.auto_params.positive_region) → pass/warn | la.auto_params, posR.Ly_in, posR.braced |  | page | host |  |
| V-F-35 | 685 | 모멘트 구배 Cb(+) | positive region Cb ≥ 1.0 | if (!posR.braced) › if (la && la.auto_params && la.auto_params.positive_region) → pass/warn | la.auto_params, posR.Cb, posR.braced | 1.0 | page | host |  |
| V-F-36 | 707 | Lap 끝단 Mu 추출 | laps exist → a "Lap end" location with Mu exists | if (_hasLaps2) › if (la && la.laps_per_support) → pass/warn | la.governing, la.gravity, la.laps_per_support |  | page | host |  |
| V-F-37 | 738 | 처짐 — 스팬(idx1)(L/δ) | per span: live-load L/δ (engine deflection_cases L · Lr · S · R alone) ≥ LL limit and total service L/δ (engine deflection) ≥ TL limit; warn within 1.1× | la.deflection.per_span.forEach((ps, idx) => › if (la && la.deflection && la.deflection.valid !== false && la.deflection.per_span) → pass/warn/fail | memberType · c.case, c.per_span, la.deflection, la.deflection_cases, ps.L_over_delta, ps.abs_delta_in | THRESHOLDS.deflection_roof L/240 · L/180; deflection_floor L/360 · L/240 (IBC Table 1604.3 — not in AISI S100, not verified here); deflection_margin 1.1× | page | host | fixed in K3-6 (D13): both limits checked, the LL limit against live load alone |
| V-F-38 | 748 | 처짐 검토 | deflection invalid (fail) or missing (warn) | else if (la && la.deflection && la.deflection.valid === false) → fail | la.deflection |  | page | host |  |
| V-F-39 | 756 | 처짐 검토 | deflection invalid (fail) or missing (warn) | else if (la && !la.deflection) → warn | la.deflection |  | page | host |  |
| V-G-40 | 770 | 설계 검토 실행 여부 | page holds a design result | pass/fail | d.design_method, d.member_type |  | page | host |  |
| V-G-41 | 782 | 종합 판정 (엔진) | engine three-state verdict → pass / warn (not evaluated) / fail | if (d && !d.error) → pass/warn/fail/(from engine verdict) | d.error, d.governing_check, d.purlin_not_evaluated, d.utilization |  | engine — result pass / verdict (fail > not_evaluated > pass) | host |  |
| V-G-42 | 804 | Mne vs My | K3-6 (D1): the engine verdict (not evaluated → warn with its reason); the old 1.01·My rule only for results without design_checks | if (_es !== null) › if (d.member_type === 'flexure') › if (d && !d.error) → pass/warn/fail | d.Mne, d.Mp, d.My, d.error, d.member_type, d.steps |  | engine — member.flexure.global | host |  |
| V-G-43 | 816 | §F2.4.2 Inelastic Reserve | inelastic reserve applied (steps contain F2.4.2) → pass, else warn | if (d.member_type === 'flexure') › if (d && !d.error) → pass/warn | d.Mne, d.My, d.error, d.member_type, d.steps, p.Zf, p.Zx | "Mcre > 2.78My" text | page | host | not applying an optional provision is shown as a caution in every flexure check |
| V-G-44 | 836 | §I6.2.1 R-factor (양력) | R applied → pass; uplift region without R → warn; else pass | if (d.member_type === 'flexure') › if (d && !d.error) →  | d.R_uplift, d.error, d.member_type, d.purlin_mode, d.purlin_regions |  | engine — member.flexure.uplift_r | host |  |
| V-G-45 | 879 | §A3.3.2 Cold Work (냉간가공) | cold work requested / applied / blocked by IR; K3-6 (D2): requested but not applied → warn with the engine reason (was fail) | if (d.member_type === 'flexure') › if (d && !d.error) →  | tplT · d.Fy_original, d.Fy_used, d.cold_work, d.error, d.member_type | "Fu/Fy ≥ 1.2, R/t ≤ 7, ≤ 120°" text (only when the engine gave no reason) | engine — design.cold_work · use_cold_work · warnings (§A3.3.2) | host |  |
| V-G-46 | 889 | §A3.3.2 ↔ §F2.4.2 배타 관계 | both options requested → warn | if (cwRequested && irActive) › if (d.member_type === 'flexure') › if (d && !d.error) → warn | d.Fy_original, d.cold_work, d.error, d.member_type, d.use_cold_work, d.use_inelastic_reserve |  | engine — design.use_cold_work · use_inelastic_reserve | host |  |
| V-G-47 | 905 | Mnl vs Mne (국부좌굴 감소) | K3-6 (D1): the engine verdict — a reduction is not a caution | if (_es !== null) › if (d.member_type === 'flexure') › if (d && !d.error) → pass/fail | d.Mne, d.Mnl, d.error, d.member_type |  | engine — member.flexure.local | host |  |
| V-G-48 | 919 | Mnd vs My (뒤틀림좌굴 감소) | K3-6 (D1): the engine verdict (not evaluated without Mcrd → warn, not pass) | if (_es !== null) › if (d.member_type === 'flexure') › if (d && !d.error) → pass/fail | d.Mnd, d.My, d.error, d.member_type |  | engine — member.flexure.distortional | host |  |
| V-G-49 | 933 | 정모멘트 φMn(+) | positive-region φMn > 0 | if (d.positive_region) › if (d.member_type === 'flexure') › if (d && !d.error) → pass/warn | d.Mn, d.error, d.member_type, d.positive_region, prV.Cb, prV.Lb, prV.Mn, prV.phi_Mn |  | engine — member.flexure.positive_region | host |  |
| V-G-50 | 950 | Pnl vs Pne (국부좌굴 감소) | K3-6 (D1): the engine verdict | if (_es !== null) › if (d.member_type === 'compression') › if (d && !d.error) → pass/fail | d.Pne, d.Pnl, d.error, d.member_type |  | engine — member.compression.local | host |  |
| V-G-51 | 964 | Pnd vs Py (뒤틀림좌굴 감소) | K3-6 (D1): the engine verdict | if (_es !== null) › if (d.member_type === 'compression') › if (d && !d.error) → pass/fail | d.Pnd, d.Py, d.error, d.member_type |  | engine — member.compression.distortional | host |  |
| V-G-52 | 982 | item | the engine verdict of each check (not evaluated → warn, not applicable → no item); value = DCR or the verdict + the hole / stiffener / torsion basis | for (const [id, item, criterion, valueOf, onlyVariant] of WEB_OPTION_CHECKS) › if (d && !d.error) →  | d.error |  | engine — member.applicability.holes · member.shear (clause variant) · member.web_stiffeners · member.web_crippling (web_holes) · member.bending_torsion | host |  |
| V-G-53 | 1002 | 이용률 — 부모멘트 (-M) | F flexure verdict and ratio | if (d.utilization != null && d.member_type === 'flexure') › if (d && !d.error) → pass/warn/fail/(from engine verdict) | d.error, d.length_assumed, d.member_type, d.pass, d.utilization |  | engine — limit_state_checks 'F flexure' / member.flexure.* | host |  |
| V-G-54 | 1010 | Lb(-) / Cb(-) (부모멘트) | design-Lb > 0 (note Cb > 2.3) — from the input fields, not from the result | if (d.utilization != null && d.member_type === 'flexure') › if (d && !d.error) → pass/warn | Cb, Lb · d.design_negative, d.error, d.member_type, d.purlin_mode, d.utilization | 2.3 | page | host | reads the current fields, not the Lb/Cb the result used (purlin regions have their own) — stale after an edit |
| V-G-55 | 1025 | 이용률 (DCR) | engine verdict with utilization | else if (d.utilization != null) › if (d && !d.error) → pass/warn/fail/(from engine verdict) | d.error, d.length_assumed, d.pass, d.utilization, d.utilization_valid |  | engine — result utilization + verdict | host |  |
| V-G-56 | 1041 | 이용률 — 정모멘트 (+M) | positive region verdict; no Mu(+) → warn | if (d.positive_region && d.member_type === 'flexure') › if (d && !d.error) → pass/warn/fail/(from engine verdict) | _posR.utilization, d.error, d.member_type, d.positive_region |  | engine — member.flexure.positive_region | host |  |
| V-G-57 | 1053 | Lb(+) / Cb(+) (정모멘트) | K3-6: the engine positive-region verdict (no 2.78·Fy re-check); an unbounded Fcre prints ∞ (D5) | if (d.positive_region && d.member_type === 'flexure') › if (d && !d.error) →  | _posR.Cb, _posR.Lb, d.error, d.member_type, d.positive_region |  | engine — member.flexure.positive_region | host |  |
| V-G-58 | 1068 | 조합 검토 (§H1.2) | interaction verdict | if (d.interaction) › if (d && !d.error) → pass/warn/fail/(from engine verdict) | d.error, d.interaction |  | engine — member.axial_bending | host |  |
| V-G-59 | 1081 | DSM 경고 #(i1) | each engine DSM warning → warn | d.dsm_warnings.map(_koText).forEach((w, i) => › if (d.dsm_warnings && d.dsm_warnings.length > 0) › if (d && !d.error) → warn | d.dsm_warnings, d.error |  | engine — dsm_warnings | host |  |
| V-G-60 | 1097 | isFallback ? 뒤틀림좌굴 해석적 Fallback : 설계 경고 #(i1) | each engine warning → warn ("뒤틀림좌굴 해석적 Fallback" when it names §2.3.3.3 / §2.3.1.3; positive-region NG warnings skipped) | _warnList(d).forEach((w, i) => › if (d.warnings && d.warnings.length > 0) › if (d && !d.error) → warn | d.error, d.warnings |  | engine — warnings | host |  |
| V-G-61 | 1109 | DSM 추출 경고 | warn | if (d.dsm_warning) › if (d && !d.error) → warn | d.dsm_warning, d.error |  | engine — dsm_warning | host |  |
| V-G2-62 | 1133 | Lap 구간 휨강도 (§F3, 한 부재) | design_lap verdict (one member — the purlin lap region; V9a-07) | if (lapDesign) › if (_hasLaps3 && d && d.member_type === 'flexure') › if (la && la.laps_per_support) → pass/warn/fail/(from engine verdict) | d.design_lap, d.member_type, la.laps_per_support, lapDesign.design_strength, lapDesign.utilization |  | engine — design.design_lap | host |  |
| V-G2-63 | 1151 | Lap 길이 (지점(idx1)) §I6.2.1(g) | min(left, right lap) ≥ 1.5·H (template field) | la.laps_per_support.forEach(function(lp, idx) › if (_hasLaps3 && d && d.member_type === 'flexure') › if (la && la.laps_per_support) → pass/warn/fail | tplH · d.member_type, la.laps_per_support | 1.5·d | dup — lap.length_condition (lap result) | engine | uses the template H field and the load-analysis laps, not the lap check of the lap result |
| V-G2-64 | 1169 | Lap 패스너 전단 (DCR) | K3-6 (D4): the engine lap.fastener_group verdict (was "not checked" unless the whole lap passed) | if (_lastLapResult && !_lastLapResult.error) › if (_hasLaps3 && d && d.member_type === 'flexure') › if (la && la.laps_per_support) → pass/warn/fail/(from engine verdict) | _lr.V_transfer, _lr.capacity, _lr.fastener_utilization, _lr.governing_check, _lr.pass, _lr.utilization, d.member_type, la.laps_per_support |  | engine — lap.fastener_group | host |  |
| V-G2-65 | 1189 | Lap 휨강도 DCR (2겹 §F3/F4/H2) | the verdicts of lap.flexure.local / lap.flexure.distortional / lap.bending_shear (V9a-03 — not flexure_checked alone); value flexure_dcr_governing | if (_lrGov != null \|\| _lfxSt.length) › if (_lastLapResult && !_lastLapResult.error) › if (_hasLaps3 && d && d.member_type === 'flexure') › if (la && la.laps_per_support) →  | _lr.flexure_dcr, _lr.flexure_dcr_governing, _lr.phi_Mn_lap, c.id, d.member_type, la.laps_per_support |  | engine — lap.flexure.* / lap.bending_shear | host |  |
| V-G2-66 | 1199 | Lap 접합부 종합 판정 | lap three-state verdict | if (_lastLapResult && !_lastLapResult.error) › if (_hasLaps3 && d && d.member_type === 'flexure') › if (la && la.laps_per_support) → pass/warn/fail/(from engine verdict) | d.member_type, la.laps_per_support |  | engine — lap result verdict | host |  |
| V-G2-67 | 1210 | Lap 접합부 설계 실행 여부 | laps + flexure result but no lap result → fail | else › if (_hasLaps3 && d && d.member_type === 'flexure') › if (la && la.laps_per_support) → fail | d.member_type, la.laps_per_support |  | page | host |  |
| V-H-68 | 1231 | Fy 일관성 (해석 vs 설계) | K3-6 (D6): the analysis reference stress (model loadFy) against the design Fy, in US units — warn when they differ | pass/warn | fy, tplH · analysisResult.curve, model.loadFy |  | page | host |  |
| V-H-69 | 1242 | 해석 최신성 | K3-6 (D6): fail when the host says the analysis is stale (was always pass) | if (model && model.node && analysisResult) → pass/fail | tplH · model.node |  | page — host _isAnalysisCurrent (model signature) | host |  |

### 보고서 — 함수 11, 화면이 스스로 만든 수 · 박힌 값 0

| 함수 | 줄 | 길이 | 제목 | 읽는 칸(상태 키) | 결과 필드 | 화면이 만든 수 · 박힌 값 |
|---|---|---|---|---|---|---|
| buildReportDoc | 1762 | 32 |  |  | d.controlling_mode, d.design_method, d.governing_check, d.member_type, d.utilization |  |
| _docSection | 1342 | 29 |  |  | model.elem, model.node, p.A, p.I11, p.I22, p.Ixx, p.Ixz, p.Izz, p.Sx, p.Sz, p.Zx, p.Zz, p.rx, p.rz, p.thetap, p.xcg, p.zcg |  |
| _docDsm | 1372 | 21 |  |  | dM.LF_dist, dM.LF_global, dM.LF_local, dM.Lcrd, dM.Lcre, dM.Lcrl, dM.P_y, dM.crd, dM.cre, dM.crl, dP.LF_dist, dP.LF_global, dP.LF_local, dP.Lcrd, dP.Lcre, dP.Lcrl, dP.Py, dP.crd, dP.cre, dP.crl, dP.n_minima |  |
| _docBuckling | 1394 | 20 |  |  | analysisResult.curve |  |
| _docDesignInput | 1415 | 80 |  | .span-tbl-lapl, .span-tbl-len | la.input_loads_plf, la.n_spans, model.prop |  |
| _docLoadAnalysis | 1497 | 99 |  |  | ap.deck, ap.i621_check, ap.negative_region, ap.positive_region, ap.unbraced, ap.uplift_R, ap.uplift_R_basis, c.basis, c.case, c.per_span, cd.factors, cd.governs_gravity, cd.governs_overall, cd.governs_uplift, cd.max_abs_M, cd.max_abs_V, cd.name, la.all_combos_detail, la.auto_params, la.deflection, la.deflection_cases, la.design_method, la.governing, la.gravity, la.input_loads_plf, la.laps_per_support, la.load_combination_standard, la.spans_ft, la.supports, la.uplift, p.L_over_delta, p.abs_delta_in, p.span, p.x_ft |  |
| _checkBlocks | 1598 | 5 |  |  |  |  |
| _noticeBlocks | 1603 | 10 |  |  |  |  |
| _docDesignCalc | 1676 | 40 |  |  | d.purlin_mode, d.purlin_regions, p.Mu, p.Vu, p.assumptions, p.check_point, p.combination, p.error, p.host_assumption, p.notices, p.pass, p.utilization |  |
| _docSummary | 1722 | 38 |  |  | c.capacity, c.clause, c.demand, c.governs, c.id, c.name_ko, c.ratio, c.verdict, d.controlling_mode, d.design_method, d.dsm_warnings, d.governing_check, d.member_type, d.purlin_governing, d.purlin_mode, d.spec_sections, d.utilization, la.governing, la.gravity |  |
| buildBucklingDoc | 1796 | 27 |  |  | model.BC, model.elem, model.lengths, model.loadCase, model.loadFy, model.node, model.prop |  |
<!-- inventory:end -->
