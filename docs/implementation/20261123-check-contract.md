# 검토 항목 계약 (`design_checks`) — 2026-11-23

작업문서: [`20261122-desktop-program-worklog.md`](20261122-desktop-program-worklog.md) §8.4 (K4: 검토 항목에 고정 id · 조항 · 소요 / 설계강도 · 계산 과정이 없다) · 엔진 규칙: [`FIXES.md`](../reviews/20261122-engine-review/FIXES.md) §3.1 · §4.1

새 검토 화면(`desktop/ui/`)은 계산하지 않는다. 화면의 판정 목록(04)과 계산 시트(05 「3. 한계상태별 계산」), 접합부 화면(06)에 보이는 숫자는 모두 이 목록에서 온다. 이 문서는 파이썬 엔진이 내는 모양을 정한다. 경계층(SI 변환 · MCP 스키마 · 호스트)은 이 문서를 따라온다.

## 1. 어디에 붙나

| 결과 | 만드는 곳 | 키 |
|---|---|---|
| 부재 설계 `design_member` (압축 · 휨 · 조합 · 인장) — 서버 `aisi_design` | `python/design/member_checks.py` (aisi_s100 의 각 설계 함수가 계산한 자리에서 부른다) | `design_checks` |
| 접합부 `design_connection` — 서버 `design_connection`, `aisi_design(member_type='connection')` | `python/design/connection_checks.py` | `design_checks` |
| 랩 접합 `design_lap_connection` — 서버 `lap_connection` | `python/design/lap_checks.py` (안의 `fastener_design` 에도 접합부 목록이 있다) | `design_checks` |
| 단면 템플릿 `generate_section` | `python/engine/template.py` | `element_roles` (7절) |

등록표(id · 조항 · 식 · 이름)는 `python/design/checks.py` 의 `REGISTRY` 한 곳에만 있다.

**왜 `checks` 가 아닌가.** `checks` 라는 키는 이미 두 곳에서 다른 모양으로 쓰인다 — 접합부 결과의 `checks`(방향별 지배 검토 `{name, demand, capacity, ratio, pass}`)와 퍼린 구간 결과의 `checks`(`StcfsdPanel` 이 구간의 검토 지점마다 `{check_point, Mu, Vu, utilization, …}` 로 덮어쓴다). 옛 키의 뜻을 바꾸지 않으므로 새 목록은 `design_checks` 다.

**덧붙이기만.** 옛 키는 하나도 빠지거나 이름 · 값이 바뀌지 않았다(9절의 기준선 비교 — 135 사례, 비교한 값 23,168 개, 차이 0).

## 2. 항목 하나

| 필드 | 뜻 |
|---|---|
| `id` | 고정 id(등록표). 표시 문구와 무관하다. 한 결과 안에서 유일하다 |
| `group` | 지배를 가르는 무리(예: `member.flexure` 의 F2 · F3 · F4 는 같은 무리) |
| `clause` · `equations` | AISI S100-16 조항과 이 한계상태의 식 번호(목록). 실제로 쓴 식은 단계의 `equation` |
| `name` · `name_ko` | 영문 · 한글 이름(등록표 그대로) |
| `design_method` | `'LRFD'` · `'ASD'` |
| `demand` | 소요 `{symbol, value, quantity, source}` 또는 `null` |
| `nominal` | 공칭강도 `{symbol, value, quantity}` (상호작용 · 상세 항목은 `null`) |
| `factor` | `{symbol, value, kind: 'phi'|'omega', source}` — 설계 방법에 맞는 하나 |
| `capacity` | 설계강도(LRFD φRn, ASD Rn/Ω) 또는 상호작용의 한계값(1.0, 1.33φ …) `{symbol, value, quantity}` |
| `ratio` | `demand / capacity` (엔진과 같은 연산). 소요가 없거나 강도 0 이면 `null`. **비는 하중 배율로 견줄 수 있는 꼴이다** — 원문의 좌변이 소요의 n 제곱이면(J2.2.4 의 1.5, C-J5.4-1 의 2) `ratio = (value/limit)^(1/n)` 이고 `ratio_form` 에 그 꼴을 적는다(`demand` 는 원문의 좌변 그대로, 4절) |
| `verdict` | `pass` · `fail` · `not_evaluated` · `not_applicable` |
| `reason` | `not_evaluated` · `not_applicable` 이면 늘 있다. 믿을 수 없는 값으로 `fail` 이면 그 까닭 |
| `governs` · `governs_basis` · `highest_evaluated` | 그 무리의 지배 항목이면 `governs: true` 와 그 까닭 `governs_basis`(`fail` · `not_evaluated` · `ratio` · `capacity`). 까닭이 `not_evaluated` 면 `highest_evaluated: {id, ratio, verdict}`(평가한 항목 중 비 최대, 없으면 `null`) — 4절 |
| `counts` | 판정에 드는가(기본 `true`). 적용 조건(랩 길이)만 `false` |
| `location` · `combination` | 위치 · 하중 조합(6절). 모르면 `null` |
| `steps` | 계산 과정(3절). 없으면 `[]` 이고 `steps_unavailable` 에 까닭 |
| `mirrors` | 이 항목의 값이 옛 결과의 어느 필드와 같은지 — `{field: {path, digits}}`. 시험이 이것으로 옛 값과 맞댄다 |
| `reference` | `not_evaluated`(또는 `not_applicable`) 인데 엔진이 계산은 한 값 — `{capacity, nominal, ratio}` 참고용 |
| `trusted` | `false` 면 값은 있으나 엔진이 판정에 믿지 않는 값(가정한 입력 · §4.1 의 의심 좌굴값)으로 낸 것 |
| 그 밖 | 접합부: `direction`('shear'·'tension'), `basis`, `assumed`, `steps_note`, `out_of_scope`(적용범위 밖에서 계산한 항목 — 그 범위의 조항, 4절); 상호작용: `equation_used`, `ratio_form`; 랩 뒤틀림: `restraint_source`(구속을 밝힌 입력); 조합 결과로 옮긴 하위 항목: `part_of`('compression'·'flexure_x'·'tension'·'fastener_design') |

## 3. 계산 과정 `steps`

단계 하나: `{kind, expr, equation, inputs: [...], result, …}`

- `expr` — 기호식(예: `Mnd = [1 − 0.22 (Mcrd/My)^0.5] (Mcrd/My)^0.5 My`). 숫자를 넣은 문자열을 만들지 않는다 — 대입은 화면이 `inputs` 로 한다. 식 안의 수는 원문의 무차원 계수뿐이다(0.6, 2.7, 0.815 …). **단위가 있는 상수**(260 ksi, d'w ≤ 0.75 in, t > 0.10 in, Fy < 95 ksi …)는 식에 쓰지 않고 `quantity` 가 있는 입력으로 둔다(`F_uh,alt`, `d'w,max`, `t,lim`, `Fy,limit`). 원문 식 자체가 US 단위로 쓰인 단계에는 `expr_units: 'US'` 와 `units_note` 가 붙는다 — 지금은 Eq. J3.3.2-1 `Pnb = n (4.64 α t + 1.53) d t Fu` 하나(α = 1 for t in in.; SI 는 α = 0.0394, t in mm). SI 화면은 이 표시가 있는 식을 'US 단위로 쓴 식'이라고 밝혀야 한다.
- **단계마다 입력만으로 결과가 나온다.** 곱해지는 값(두 겹 부재의 2, Ab · Fnt · Fnv · φ, λ …)은 모두 입력이거나 그 기호를 만든 단계가 있다. 시험 `test_review_1124_trace_recompute.py` 가 계약 사례의 단계 전부를 엔진 코드 없이 원문 식으로 다시 계산한다(10절).
- `equation` — 그 단계가 쓴 식 번호(없으면 `null`).
- `inputs` — `{symbol, value, quantity, source}`. **값은 계산이 실제로 쓴 바로 그 변수**다(같은 자리에서 만든다. 다시 계산한 값이 아니다).
- `result` — `{symbol, value, quantity}` 또는 `null`(갈래 단계). **끝없는 값**(횡좌굴 없음 → Fcre = ∞, 그로부터 Mcre)은 숫자로 싣지 않는다: `{value: null, unbounded: true, reason}`. 그 결과를 쓰는 뒤 단계의 입력에도 `unbounded: true` 가 붙는다(엔진 안의 1e6 ksi 는 '없음'의 표지일 뿐 — SI 로 바꾸지 않는다).
- 갈래(`branch`): `condition`(예: `λd ≤ 0.673`), `holds`(참 · 거짓), `equation`(그 결과로 쓴 식).
- 그 밖: `verdict`(판정 단계), `rounded_to`(엔진이 반올림한 값을 썼다 — 5절), `untraced`(공칭강도의 입력을 단계로 풀지 못함 — 8절), `note`, `detail_unavailable`, `buckling_type`, `path`(블록 전단 경로) 등.

### 3.1 `kind` 어휘

| kind | 쓰는 곳 |
|---|---|
| `yield` | 항복 강도 Py · My · Mp · Vy · Ag·Fy |
| `elastic_buckling` | 탄성 좌굴값 σex · σey · σt · Fcre · Pcrl · Mcrd · Vcr · Pe1 — 출처와 함께 |
| `slenderness` | λc · λℓ · λd · λv |
| `branch` | 식의 갈래 (`condition`, `holds`, `equation`) |
| `equation` | 강도식 · 중간량 |
| `modifier` | 보정 · 표값 · 상한 — β(Eq. 2.3.3.3-3), R(표 I6.2.1-1), B1(C1.2.1.1-3), Usl, 냉간가공 Fya(A3.3.2-1), 표 C · mf, 반올림 |
| `demand` | 소요를 만드는 단계(B1·Mx, 랩의 전달력 V_transfer) |
| `design_strength` | φRn 또는 Rn/Ω |
| `verdict` | 비와 판정(`verdict` 필드) |

### 3.2 `quantity` 어휘와 엔진 단위(US)

| quantity | US 단위 | | quantity | US 단위 |
|---|---|---|---|---|
| `force` | kip | | `moment_of_inertia` | in⁴ |
| `moment` | kip-in | | `torsion_constant` | in⁴ |
| `stress` | ksi | | `warping_constant` | in⁶ |
| `length` | in | | `force_per_length` | kip/in |
| `area` | in² | | `rotational_stiffness` | kip-in/rad/in |
| `section_modulus` | in³ | | `angle` | deg |
| `dimensionless` | — | | `count` | 개 |
| `mass_density` | kip·s²/in⁴ (`kip*s^2/in^4`) | | `pressure` | psf |

`mass_density`(2026-11-24 K4c): 진동 해석의 질량밀도 `rho`. SI 는 kg/m³ — 1 kip·s²/in⁴ = 4448.2216 N·s² / (0.0254 m)⁴ ≈ 1.06870 × 10¹⁰ kg/m³ (호스트의 단위 표).

`pressure`(2026-11-24 K4d): 면 하중 — 지금은 지붕 활하중 저감 한계 `20 psf`(ASCE 7-22 Sec. 4.3.3.1) 하나. SI 는 kPa — 1 psf = 0.0478803 kPa. **호스트의 단위 표에 더해야 한다**(엔진은 바꾸지 않는다).

엔진은 숫자를 꾸미거나 단위를 바꾸지 않는다. 경계층은 `quantity` 로 SI 를 만든다(9절).

### 3.3 `source` 어휘

한국어 이름(계산서가 값 옆에 찍는 말)은 용어표 `design.glossary.SOURCE_KINDS_KO` · `BUCKLING_METHODS_KO` 한 곳 — §16.12 의 표. 시험이 이 어휘와 그 표의 키가 같음을 확인한다.

| kind | 뜻 | 덧붙는 것 |
|---|---|---|
| `step` | 같은 항목의 앞 단계 결과 | `step`(번호) |
| `check` | 다른 항목의 결과(예: F3 의 Mne ← F2, §H1.2 의 Pa ← 압축 무리에서 설계강도가 가장 작은 항목) | `id`(등록 id — 모르면 없음), `group`, `note` |
| `section_property` | 단면 성질 | `key`, `generated: true`(템플릿 자동 생성), `basis`(out-to-out 등) |
| `material` | 재료 강도 Fy · Fu | `key`, `note` |
| `buckling_analysis` | 좌굴 해석 또는 그 대체 | `method`, `label`, `half_wavelength`(`{symbol:'L', value, quantity:'length'}`, 엔진이 받은 경우), `isolated`, `classification` |
| `load_analysis` | 하중 해석의 소요(호출자가 `check_combination` 을 준 경우) | `key`, `combination` |
| `user_input` | 사용자 입력 | `key`, `note` |
| `engine_default` | 없어서 엔진이 채운 값(경고 · 가정에 밝힌 것) | `key`, `note` |
| `specification` | 기준의 상수 · 계수 · 표값(φ, Ω, E, G, 표 G5 · J3.3.1 · J3.4) | `table`, `row`, `equation`, `note` |

`buckling_analysis.method` (FIXES §4.1 식별 계약): `fsm_minimum`(서명곡선 극소), `fsm_single_minimum`(극소 하나를 이 모드로 배정 — 다른 모드의 하한일 뿐), `analytic`(부록 1 Eq. 1.1-4 · 부록 2 §2.3.1.3 / §2.3.3.3, 엔진 계산), `analytic_raised_to_floor`(해석식이 곡선 하한보다 낮아 하한으로 올림), `closed_form`, `user_supplied`. 반파장은 호출자가 `dsm` 에 `P_Lcrl` · `P_Lcrd` · `M_Lcrl` · `M_Lcrd`(또는 `Lcrd`)를 준 경우에만 실린다 — 지금 `StcfsdPanel._dsmForDesign` 은 이 키를 넘기므로 화면 경로에서는 실린다.

## 4. 판정 · 지배 · 참고값

- **판정 규칙(FIXES §3.1):** 무리와 결과 전체에서 `fail > not_evaluated > pass`. `not_applicable` 은 판정을 끌어내리지 않는다. `counts: false` 는 빼고 접는다. 결과 전체를 접은 값은 옛 `pass`(True→pass, False→fail, None→not_evaluated)와 같다 — 시험이 모든 사례에서 확인한다.
- **믿을 수 없는 값.** 엔진이 값은 냈지만 판정에 믿지 않는 경우(기본 길이 120 in, 격자 하한 극소, 기준 응력 불일치, 다른 부호의 DSM 값, E2.2 미평가 …): 비가 1 을 넘으면 `fail`(엔진도 불합격이 이긴다), 아니면 `not_evaluated` 이고 값은 `reference` 로만. `trusted: false` 로 표시한다.
- **`not_evaluated` 는 `capacity` · `ratio` 를 싣지 않는다.** 엔진의 자리 표시 값(예: Pcrl 이 없을 때의 Pnl = Pne)은 어디에도 싣지 않는다.
- **지배(`governs`, 2026-11-24 V6-03):** 무리마다 하나. 무리의 상태가 정한다 — 판정과 같은 순서 `fail > not_evaluated > pass`:
  1. 판정에 드는 `fail` 이 있으면 → 그 가운데 비가 가장 큰 것. `governs_basis: 'fail'`.
  2. 없고, 판정에 드는 `not_evaluated` 가 있으면 → **그 미평가 항목**(참고 비가 가장 큰 것; 참고 비가 없으면 참고 설계강도가 가장 작은 것; 둘 다 없으면 엔진 순서). `governs_basis: 'not_evaluated'`, 그리고 평가한 항목 가운데 비가 가장 큰 것을 `highest_evaluated: {id, ratio, verdict}` 로 따로 싣는다(없으면 `null`). 평가한 낮은 비가 '지배'로 읽혀 무리의 실제 상태(미평가)를 가리지 않게 하려는 것이다(예: 볼트 지압 0.66 합격, J6.1 은 e = 1.5d 가정이라 미평가 · 참고 비 1.22 → 지배는 J6.1).
  3. 모두 평가했으면 → 비가 가장 큰 것, 같으면 엔진이 고른 지배 모드(`controlling_mode`). `governs_basis: 'ratio'`.
  4. 평가했으나 비가 없으면(소요 0) → 설계강도가 가장 작은 것. `governs_basis: 'capacity'`.
  `counts: false` 항목은 1 · 2 에 들지 않는다. 부재 · 접합부 · 랩의 모든 무리에 같은 규칙(`checks.set_governing`). 옛 키 `governing_check` · `utilization` · `governing_mode` 는 그대로(엔진의 옛 뜻).
- **적용범위 밖(2026-11-24 V6-04):** 접합부의 적용범위 항목(`conn.scope`, '적용범위 (J4)' 등)이 미평가이면, 그 범위의 조항으로 계산한 항목 가운데 `pass` 인 것을 `not_evaluated` 로 내리고(`reason` 에 범위, `out_of_scope: '<조항>'`), 계산한 강도 · 비는 `reference` 로만 둔다(판정에 쓰지 않음). 범위 → 조항: J3/J6 → J3 · J6, J2 → J2 · J6 (J6 머리글의 3/16 in 한계가 같다), J2.2 → J2.2, J4 → J4, J5 → J5. Chapter D(부재 인장)는 범위에 걸리지 않는다. 불합격은 그대로 둔다(불합격이 이긴다).
- **비의 꼴(2026-11-24 V6-06):** 다른 비와 견주거나 max 하는 `ratio` 는 모두 하중 배율로 선형이다. 원문 좌변이 비선형인 상호작용 — J2.2.4 (지수 1.5), Commentary C-J5.4-1 (지수 2 일 때), 랩 · 부재 H2-1 (√ 꼴, 이미 선형) — 은 `ratio = (value/limit)^(1/n)` 이고 판정(≤ 1)은 같다. 엔진 전체를 찾아본 결과는 작업 보고에 있다(H1.2 의 B1, App. A J3.4 의 F'nt 처럼 강도 · 증폭이 소요에 따라 바뀌는 식은 원문의 꼴 그대로 둔다 — 그 순간의 소요에 대한 선형 비다).
- **모드별 검토.** 엔진은 F2 · F3 · F4 의 최소 Mn 으로 하나의 비를 냈다. 계산서는 Manual 예제(II-1B: φMne 113, φMnℓ 84.2, φMnd 89.9)처럼 모드마다 설계강도와 비를 낸다. 지배 모드 항목의 비는 옛 이용률과 같은 연산이다(`mirrors.ratio`).
- **소요가 없으면**(2026-11-24 V6b-03): 한계상태의 소요가 0 이고 결과의 다른 소요는 있어 무엇이든 평가했으면 그 항목은 `not_applicable`(reason `no required … — no demand for this limit state (the other demands are checked)`, 설계강도는 `reference`). 소요가 하나도 없으면 `not_evaluated`(소요 없음). 예: Mu = 0 · Vu > 0 이면 F2–F4 는 해당 없음, G2 만 평가. 이렇게 해서 `design_checks` 를 접은 판정이 결과의 `pass` 와 늘 같다(시험: 계약 사례 전부 + 소요 0 조합 격자). 접합부에서 한 방향만 소요가 있으면 다른 방향의 한계상태는 `not_applicable`.
- **Cm (§C1.2.1.1, 2026-11-24 V6b-02):** `Cmx` · `Cmy` 를 주면 그 값. 없으면 그 축의 끝 모멘트 비 `Cmx_M1_M2` · `Cmy_M1_M2`(그 굽힘 평면의 비지지 구간 끝, 작은/큰, 역곡률 +)로 Eq. C1.2.1.1-4. 그것도 없거나 `transverse_load: true` 면 1.0(Eq. C1.2.1.1-4 의 상한이자 (b) 가 허용하는 값 — `assumptions` 에 조항과 함께). `dist_M1_M2` 는 부록 2 β 의 입력이라 Cm 에 쓰지 않는다. 계산 과정의 Cm 출처: `user_input Cmx`, `user_input Cm?_M1_M2`(단계 C1.2.1.1-4), `specification`(1.0).

## 5. 반올림 — 판정은 반올림하지 않은 값으로 (2026-11-23 두 번째 묶음, 작업문서 §8.3.1)

**지금 참인 것:** 모든 판정 · 비 · 지배 모드 선택과 `design_checks` 의 값은 반올림하지 않은 값으로 정한다. 결과의 옛 키 가운데 사람이 읽도록 반올림해 싣는 것은 결과마다 `display_rounding`(`{decimals: {경로: 자리수}, note}`) 에 적었다 — 그 키들은 **표시용**이다(예: 접합부 `limit_states[].design_strength` 3자리, 부재 `design_strength` 2자리, `utilization` 4자리).

예전에 반올림한 값으로 판정하던 곳과 고친 뒤:

| 곳 | 예전 | 지금 |
|---|---|---|
| 접합부 한계상태의 설계강도 | `round(φRn, 3)` 로 지배 모드를 고르고 소요와 비교 | 반올림 전 φRn(또는 Rn/Ω)으로. 표시 키는 3자리 그대로 |
| 랩의 Pns · 용량 | 접합부의 반올림된 설계강도 × n | 반올림 전 값 × n (`Pns` 키는 표시용 3자리) |
| 조합 §H1.2 · §H1.1 의 Pa · Max · Ta · May | 하위 결과의 `round(…, 2)` | 하위 설계의 반올림 전 설계강도(결과에 남기지 않는 내부 키로 넘김) |
| 웹 크리플링 Pn | `round(Pn, 3)` 로 Pa · H3 계산, `web_crippling.Pn` 은 2자리로 표시 | 반올림 전 Pn 으로 계산, `web_crippling.Pn` 은 표시용 2자리 |
| 정모멘트 구간 판정 | 비를 소수 4자리로 반올림한 뒤 1.0 과 비교 | 반올림 전 비로(`positive_region.utilization` 은 표시용 4자리) |
| 랩 지점부 H2 | 제곱합 (M/Ma)² + (V/Va)² 을 "DCR" 로 | 부재 H2 와 같은 √((M/Ma)² + (V/Va)²) — 판정은 같고 비는 다른 비와 견줄 수 있다 |
| 냉간가공 Fya · C · Fyc | `special_topics.cold_work_strength` 가 2 · 4자리로 반올림한 Fya 를 휨에 쓴다 | **그대로**(이번 수정 대상 아님 — 강도를 바꾸므로 따로 정할 일). 입력 `rounded_to` 로 밝힌다 |

이 수정으로 바뀐 기준선 값 전부는 부록(14절)에 있다.

## 6. 위치 · 조합

- 엔진이 아는 위치만 채운다: 정모멘트 구간 검토 → `location: {segment: 'positive_moment_region', Lb, Cb}`.
- **새 선택 입력**(값을 바꾸지 않는다): `check_location`(아무 JSON 값), `check_combination`(문자열)을 `aisi_design` · `design_connection` · `lap_connection` 에 주면 모든 항목에 그대로 붙는다. `check_combination` 이 있으면 소요의 `source.kind` 는 `load_analysis`. 퍼린 구간 설계(호스트 `StcfsdPanel`)가 구간 · 검토 지점(`M_max` · `V_max` · `support B`) · 대표 조합을 여기에 넣으면 된다(9절). 이 두 키는 `design.checks.CONTEXT_KEYS` 에 있고 접합부의 `_KNOWN_KEYS` 에는 **아직 넣지 않았다** — MCP 스키마가 열기 전에 넣으면 V4-05 호스트 ↔ 스키마 대조(`test/webview/mcp_si_chain.js`)가 '호스트만 받는 인자'로 잡는다. 스키마를 열 때 함께 옮긴다.

### 6.1 하중 해석 포락선의 출처 (`analyze_loads`, 2026-11-24 V6-08)

포락선의 값마다 그 값을 만든 **조합과 활하중 패턴**을 덧붙였다(옛 키 · 값은 그대로 — 기준선 8 사례, 값 46,576 개 비교, 차이 0).

**`governing` · `gravity` · `uplift` 결과마다 `envelope_source`:**

```
envelope_source = {
  "M_max": [[start, count, combo_index, pattern_index], …],   # M_envelope_max 의 격자점
  "M_min": […], "V_max": […], "V_min": […],                     # M_envelope_min · V_envelope_max/min (x_diagram 격자)
  "R_max": […], "R_min": […],                                   # R_envelope_max/min (지점 번호, 0 부터)
  "patterns": [ {}, {"Lr": "spans 1,3 loaded"}, {"S": "<snow case>"}, … ]
}
```

- 런 길이: 격자점 `start … start+count−1` 의 값이 `combos[combo_index]`(같은 결과의 `combos` 목록)와 `patterns[pattern_index]` 에서 왔다. 런은 빈틈없이 이어져 배열 전체를 덮는다.
- 패턴은 하중 키 → 재하. 부분재하하지 않는 하중(D, W, …)은 싣지 않는다(= 모든 경간). `'spans i,j loaded'`(1 부터) · `'not acting'` · 눈 하중은 `pattern_loading.snow_cases` 의 이름. 위치 항목의 `pattern` 과 같은 말이다.
- **그 조합 · 패턴의 도표(계수 × 하중을 그 경간에만 실은 보)를 풀면 그 점의 값이 포락값과 같다** — 시험 `test_review_1124_envelope_source.py` 가 보 해석기로 다시 풀어 확인한다(중력 · 양력 · Lr · L · S 부분재하 · 랩 · 내다지).
- **동률 규칙:** '같다'는 그 물리량(M · V · R · VL · VR)의 허용오차 `tol = 1e-9 × max(1, 모든 조합 · 측점의 |포락값| 최대)` 안이다(V6b-07: 모든 조합이 0 인 측점에서 부동소수 잡음으로 고르지 않게). 극값에서 tol 안의 조합 가운데 `combos` 에서 먼저 나온 것. 경간의 기여가 tol 이하면 그 경간은 싣지 않는다(예: 끝 지점의 M — `{}` 또는 `'not acting'`). 눈 하중 경우가 tol 안에서 같으면 먼저 나온 경우. 처짐 출처도 같은 꼴(그 하중의 |단위 처짐| 최대 × 1e-9). 옛 위치 키 `combo` · `pattern` · `combo_R` 은 허용오차 없이 그대로다(값 불변). 같은 규칙으로 **어느 측점이 최대인지**도 고른다(2026-11-24): 이름 붙은 위치의 경간 ±M 측점과 비지지 구간의 `x_M_max_ft` 는 극값에서 tol 안의 첫 측점이다. 보 유한요소(랩 · 경간별 I · 고정/자유 지점)의 풀이는 띠 Cholesky(LAPACK dpbsv)로 — 전의 `np.linalg.solve` 는 OpenBLAS 스레드 수에 따라 끝자리(상대 1e-11)가 바뀌어 실행마다 답이 달랐다.
- **수치 라이브러리 스레드 = 1 (2026-11-24 V8-04):** 엔진 프로세스는 numpy 를 가져오기 전에 `python/numeric_threads.py` 를 가져와 `OPENBLAS_NUM_THREADS` · `OMP_NUM_THREADS` · `MKL_NUM_THREADS` · `BLIS_NUM_THREADS` · `VECLIB_MAXIMUM_THREADS` · `NUMEXPR_NUM_THREADS` 를 `1` 로 덮어쓴다(진입: `server.py` 맨 앞, `engine` · `design` 꾸러미의 `__init__`, 시험의 `run_all.py` · `conftest.py`). FSM 고유치 풀이(서명곡선 · DSM 추출)의 끝자리가 스레드 수에 따라 달랐다(Mcre 상대 7e-6, 검토 비 1e-10). `selftest` 의 `numeric_threads: {threads: 1, variables, pinned_before_numpy}` — `pinned_before_numpy: false` 면 다른 무엇이 numpy 를 먼저 올려 고정이 늦었다는 뜻이다(엔진을 모듈로 직접 쓰는 스크립트가 numpy 를 먼저 가져오면 그 프로세스는 고정되지 않는다).
  - **보장하는 것:** 같은 PC · 같은 런타임(`engine_runtime` 의 numpy · scipy 판)에서 같은 입력은 환경 변수 · 코어 수와 무관하게 같은 바이트(시험: 하위 프로세스 `OPENBLAS_NUM_THREADS` 1 · 4 · 8 · 없음에서 서명곡선 둘 + DSM 추출 + 부재 설계의 한 해시).
  - **보장하지 않는 것:** 다른 PC 사이. OpenBLAS(DYNAMIC_ARCH)는 CPU 마다 다른 커널(Haswell · SkylakeX · Zen …)을 고르므로 끝자리가 다를 수 있다 — **국부 · 뒤틀림 값은 상대 1e-9 안, 긴 반파장의 전체좌굴 값(서명곡선 끝의 `Mxxcre` · `LF_global` · `Pcre`, 길이 ≥ 약 400 in)은 상대 1e-5 안(다섯째 유효숫자)**. 판정 · 4자리 표시값이 바뀌는 것은 반올림 경계에 걸린 값뿐이다. 결과 지문을 PC 사이에서 견주는 쪽은 이것을 감안해야 한다.
  - **왜 전체좌굴만 1e-5 인가(2026-11-24 측정, 8ZS2.25×059 ±M · 8CS2.5×059 P, 서명곡선 100 길이):** 긴 반파장에서 K 의 조건이 L⁴ 로 나빠져(막 강성 ≫ 휨 강성) 1차 고유치가 K 성분의 반올림에 민감하다. K 의 성분마다 ±1 ulp 섭동(조립 반올림의 크기)만으로 하중계수가 L = 402 / 644 / 938 in 에서 상대 0.4 – 2 × 10⁻⁶ / 0.5 – 1 × 10⁻⁵ / 2 – 3.4 × 10⁻⁵ 움직인다 — 스레드 1 · 4 · 8 차(≤ 7 × 10⁻⁶)는 그 안이다. 엔진의 반올림 추정 `err_est`(fsm_solver, eps·cond)는 같은 길이에서 5 × 10⁻⁶ – 2.6 × 10⁻⁴ 로 그 흔들림을 위에서 묶는다. 짧은 반파장(국부 · 뒤틀림, L < 100 in)은 섭동 ≤ 2 × 10⁻⁹.
  - **풀이를 바꿔도 줄지 않는다:** 흔들림은 K 를 double 로 조립할 때 이미 있다(위 섭동 시험은 풀이를 그대로 두고 K 만 1 ulp 흔든 것). 엔진은 이미 대칭 정부호 일반 고유치(eigh/sygvx, 가장 큰 μ = 1/λ 몇 개만)로 풀고 대각 스케일에 불변이다 — 다른 풀이 · 스케일 · 낮은 모드만 풀기로는 1e-10 에 닿지 않는다. 닿으려면 K 를 더 높은 정밀도로 조립해야 한다(값싸지 않다).
  - **정확도의 기준:** 그 값의 물리 모형 오차가 훨씬 크다 — 8CS2.5×059 압축의 서명곡선 전체좌굴 응력은 L = 402 / 644 / 938 in 에서 약축 오일러 π²E/(L/ry)² 와 +2.0 × 10⁻⁴ / +7.4 × 10⁻⁴ / +8.9 × 10⁻⁴ 다르다(판 이론 대 보 이론). 다섯째 자리의 반올림 흔들림은 그 1/20 – 1/90 이다.
  - 시간: 1 스레드가 더 빠르다(이 PC, 32 코어): 서명곡선 하나(Z 8 in, 100 길이) 기본 스레드 0.49 – 0.89 s → 0.38 – 0.41 s.
- 랩 · 6경간(격자 301점)에서 `envelope_source` 셋을 합쳐 약 4.7 KB, 위치 항목의 덧붙임을 합쳐 결과 전체가 약 9 KB(4 %) 늘었다.

**이름 붙은 위치(`locations[]`)에 덧붙인 키:**

| 키 | 뜻 |
|---|---|
| `combo_V` · `pattern_V` | 그 위치의 `Vu` 를 만든 조합 · 패턴. 경간 ±M 위치는 그 격자점의 \|V\| 최대, 지점은 왼쪽 · 오른쪽 전단 가운데 큰 쪽 |
| `V_side` | 지점의 `Vu` 가 지점 왼쪽(`'left'`)인지 오른쪽(`'right'`)인지 |
| `source_stations` | 랩 끝: 값이 격자점 `[k, k+1]` 사이의 선형 보간이라는 뜻. 두 점의 출처는 `envelope_source` 에서 읽는다 — 두 점의 조합 · 패턴이 같을 때만 그 조합의 값이다(다르면 포락값). 이 위치의 옛 `combo` · `pattern` 은 가까운 격자점의 것 |

(옛 키 `combo` · `pattern` 은 `Mu` 의, `combo_R` · `pattern_R` · `combo_R_uplift` 는 반력의 출처 — 그대로.)

**지점 위치의 면마다(2026-11-24, V6b-01 뒤 — 호스트는 그 구간 쪽 면을 쓴다):**

| 키 | 뜻 |
|---|---|
| `Vu_left_unrounded` · `Vu_right_unrounded` | 지점 왼쪽 · 오른쪽 면 전단 포락의 크기 max(\|최대\|, \|최소\|), **반올림하지 않은 값** — 판정은 이것으로. 옛 키 `Vu_left` · `Vu_right`(소수 3자리)는 표시용으로 그대로 |
| `V_left_source` · `V_right_source` | 그 면 값의 출처 `[combo_index, pattern_index, sense]` — `combos` · `envelope_source.patterns` 의 자리(`envelope_source` 와 같은 인코딩), `sense` +1 = 최대 포락, −1 = 최소 포락에서 온 크기 |
| `M_source` | 지점 M(최대 · 최소 가운데 크기가 큰 쪽, 옛 `Mu` 와 같은 쪽)의 출처 `[combo_index, pattern_index, sense]` |

동률 규칙은 위와 같다(허용오차 tol, 먼저 나온 조합; 끝 지점의 바깥 면처럼 모든 조합이 0 이면 첫 조합 · `'not acting'`). 시험이 모든 지점(끝 지점 · 내다지 · 랩이 붙은 지점)의 두 면과 M 을 그 조합 · 패턴으로 다시 풀어 확인한다. 크기: 6경간 랩 사례에서 약 3.1 KB(결과 전체 +3.4 KB).

하중 해석 결과에 `display_rounding`(`{decimals: {'locations[].Vu_left': 3, …}, note}`)이 새로 있다 — 반올림해 실은 위치 키 목록이다.

**반올림하지 않은 값 — `unrounded` 하위 객체(2026-11-24):** 소비자가 소요 · 길이로 쓸 수 있는 반올림 키는 같은 이름으로 반올림하지 않은 값을 그 레코드의 `unrounded` 에 함께 싣는다. 판정 · 길이 계산은 이것으로(반올림 키는 표시용 — `display_rounding` 에 목록).

| 레코드 | `unrounded` 의 키 |
|---|---|
| `governing` · `gravity` · `uplift` 의 `locations[]` — 경간 ±M | `x_ft`, `Mu`, `Vu` |
| 같은 목록 — 지점 | `x_ft`, `Mu`(끝 지점의 0 은 null), `Vu`, `Ru`, `Mu_max`, `Mu_min`, `Vu_left`, `Vu_right`, `R_max`, `R_min`, `R_bearing`, `R_uplift` (앞의 `Vu_left_unrounded` · `Vu_right_unrounded` 도 그대로) |
| 같은 목록 — 랩 끝 | `x_ft`, `Mu`, `Vu`, `Mu_max`, `Mu_min` |
| `auto_params.unbraced` · `auto_params.uplift_bracing.unbraced` 의 `positive_regions[]` · `negative_regions[]` · `lap_regions[]` | `start_ft`, `end_ft`, `Ly_in`, `Lt_in`, `Cb`, `M1`, `M2`, `M_max_abs`, `x_M_max_ft` |
| `auto_params.positive_region` · `negative_region` (· `negative_region_gov`), 그 `regions[]` | 지배 구간의 같은 키 |
| `wc_reactions[]` | `Pu`, `x_ft` |
| `uplift_reactions[]` | `R_uplift`, `x_ft` |
| `auto_params.unbraced` (· `uplift_bracing.unbraced`) | 목록 `inflection_points_ft_unrounded` · `inflection_points_min_envelope_ft_unrounded` |

**변곡점의 정의(2026-11-24):** M 의 부호가 부재 **안에서** 실제로 바뀌는 점. 측점의 부호는 M > tol → +, M < −tol → −, 그 밖은 0, `tol = 1e-7 × max(1, max|M|)`(비지지 구간을 가르는 `_sign_zones` 와 같은 허용오차). 0 이 아닌 두 측점 사이에서 부호가 바뀔 때만: 이웃한 두 측점이면 그 사이의 선형보간 영점, 사이에 0 인 측점들이 끼면(모멘트 0 구간) 그 0 구간의 가운데. 그래서 자유단 · 핀 끝 지점의 M = 0, 실리지 않은 내다지의 M = 0 구간은 변곡점이 아니다. 비지지 구간(`_sign_zones`)은 전부터 같은 허용오차를 써서 영향이 없다. 바뀐 옛 값: 랩이 있는 유한요소 사례에서 끝의 0.0 ft 가 빠졌다(`cont-4 laps D L W ASD` 네 목록, `analyze_loads II-2A purlin with laps` 두 목록 — 각 목록의 첫 원소 0.0 만).

**처짐 포락(`deflection_cases[]`)** 가운데 부분재하가 든 것(L · Lr(감소) · S 와 D + 그것)에 `D_envelope_source = {"D_max": [[start, count, pattern_index], …], "D_min": […], "patterns": [{"loads": {"D": "all spans", "L": "spans 1,3 loaded"}}, …]}`. 처짐은 비계수 하중이라 조합 칸이 없다.

**호스트가 쓸 것:** 검토 지점의 소요가 포락선 격자점 i 에서 왔으면 `'envelope'` 대신 `combos[ci]` + `patterns[pi]`(`_comboLabel` 과 같은 꼴). 같은 검토 지점의 M 과 V 의 출처가 다르면(아래 6.2) 그 지점은 하나의 하중 상태가 아니다.

### 6.2 한 검토 지점의 M · V 는 같은 하중 상태가 아닐 수 있다

포락선은 값마다 따로 최대를 고른다. 같은 격자점의 M 최대와 |V| 최대는 다른 조합 · 패턴에서 올 수 있다 — 따로 하는 검토(휨 단독, 전단 단독)에는 맞는 방법이지만, §H2 · §H3 의 상호작용은 **동시에 작용하는 값**(같은 하중 조합의 M 과 V)을 요구한다. `combo` 와 `combo_V`(또는 격자점의 두 출처)가 다르면 그 짝은 동시 값이 아니다(작업 보고 2026-11-24 에 예가 있다).

### 6.3 랩 구간의 구속 — 사람이 밝힌다, 한 진술이 횡비틀림 · 뒤틀림 둘 다 (2026-11-24 V6b-04, 최종)

AISI Design Manual 의 연속 퍼린 예제는 이 가정을 **가정으로 밝히고** 쓴다(스킬 원문에서 옮김):

- Example II-1A · II-2A (랩 구간 검토마다): **"The lapped section is assumed to be sufficiently restrained against lateral-torsional buckling and distortional buckling and therefore:"** (그 뒤 Fn = Fy, Mne = Mnd = My).
- 같은 예제의 설계 가정 (f): **"For gravity loads, the region at and near the interior supports is assumed to be not subject to lateral-torsional or distortional buckling between the support and the ends of the laps."**

엔진과 호스트는 이 가정을 스스로 쓰지 않는다. 사람이 밝히면 엔진이 Manual 대로 쓴다(§I6.2.1 의 `i621_conditions_confirmed` 와 같은 꼴). **진술 하나가 두 반쪽(횡비틀림 · 뒤틀림)을 함께 덮는다.**

**입력 이름 — 어디서나 `lap_restrained`** (`true` · `false` · 없음; 없음 = 밝히지 않음). `distortion_restrained` 는 같은 뜻의 옛 이름으로 **별칭**이다(구간 설계 · 랩 도구 모두 받음 — 새 호출은 `lap_restrained`).

**구간 설계 `aisi_design` / `design_member`** (`member_type` 'flexure' · 'combined'):

| 입력 | 뜻 |
|---|---|
| `lap_region: true` | 이 구간이 겹친 두 부재의 랩 구간. 호스트는 랩 구간 호출에 이것을 준다 |
| `lap_restrained` | 사람의 진술(위). 호스트는 그 진술을 그대로 넘긴다 — 지어내지 않는다 |

**호스트가 보낼 것(랩 구간):** `lap_region: true` + 사람의 `lap_restrained`. **`Lb = 0` · `Cb = 1.0` · `distortional_not_applicable` · `dsm.Mcrd` 지우기를 호스트가 정하지 않는다** — 엔진이 진술을 보고 가정을 쓴다. (사람이 랩 구간의 실제 비지지 길이 `Lb` 나 `Mcrd` 를 따로 줬다면 그 값을 넘겨도 된다 — 아래 표.)

| `lap_region` | `lap_restrained` | `Lb` · `Mcrd` | `member.flexure.global` (F2) | `member.flexure.distortional` (F4) | 결과 |
|---|---|---|---|---|---|
| `true` | `true` | 무관 | 엔진이 Lb = 0, Cb = 1.0 으로 평가(Fcre → ∞, Fn = Fy). 계산 과정의 Lb · Cb 출처 `{kind: 'user_input', key: 'lap_restrained', note: …}`. 준 Lb(≠ 0) · Cb(≠ 1.0)는 쓰지 않고 `warnings` 에 한 줄씩 | `not_applicable`, `restraint_source: {kind: 'user_input', key: 'lap_restrained'}`, Mnd = My — **`dsm` 에 Mcrd 가 있어도**(퍼린 경로는 단일 단면으로 계산한 dsm 전부를 넘긴다). 쓰지 않는 dsm 값: `Mcrd` · `M_Lcrd` · `Lcrd` (엔진 상수 `LAP_IGNORED_DSM`)와 β 입력 `dist_M1_M2` · `dist_Lm` — 준 것은 `warnings` 에 한 줄. `Mcrl` · `M_Lcrl` · `My` · `M_sign` 은 그대로 쓴다(국부 좌굴은 가정 밖) | `assumptions` 에 아래 (가) |
| `true` | 없음 · `false` | Lb 줌 | 그 Lb 로 평가(보통 구간) | Mcrd 줌 → 평가 | — |
| `true` | 없음 · `false` | Lb 없음 | `not_evaluated`, reason 에 (나). 엔진은 길이를 짓지 않는다(120 in 기본값을 쓰지 않음): Lb = 0 을 **상한**(Mne ≤ My)으로만 계산해 참고값으로 두고(출처 `engine_default`, note 에 상한), 그 상한으로도 1 을 넘으면 `fail`(가정 없이 강도는 더 작다) | Mcrd 없음 → `not_evaluated`, reason 에 (다) | 불합격이 없으면 `pass` None, `not_evaluated` 목록에 (나) · (다) |
| `true` | — | — | `distortional_not_applicable` 을 함께 주면 무시하고 `warnings` 에 `lap_region: distortional_not_applicable is ignored for a lap region — the restraint must be stated as lap_restrained = true` | | |
| 없음 | — | — | 지금과 같음(랩 구간이 아닌 곳 · 옛 호출) | | |

**랩 도구 `lap_connection` / `design_lap_connection`:** 같은 진술 `lap_restrained`(별칭 `distortion_restrained`). 랩 휨 `lap.flexure.local`(Mnℓ = Se·Fy — Fn = Fy, 곧 횡비틀림 없음)과 Mnd 가 없을 때의 `lap.flexure.distortional` 이 이 가정에 선다:
- 진술 있음 → 국부 휨 평가(단계 `Mnℓ = Se Fy` 에 `assumption_source: {kind: 'user_input', key: 'lap_restrained'}`), 뒤틀림 `not_applicable`(출처 같음) — **준 `Mnd` 와 무관하게**(2026-11-24 V8-01, 구간 설계가 `dsm.Mcrd` 를 쓰지 않는 것과 같다; Manual 의 읽기는 랩 안에서 Mnd = My). 준 Mnd 는 `warnings` 에 한 줄: `lap_restrained = true: the given Mnd = <값> kip-in is not used — F4 distortional buckling is not applicable under the Manual assumption (lapped section restrained against distortional buckling; Mnd = My in the lap)`.
- 진술 없음 → 국부 휨 `not_evaluated`(1 을 넘으면 `fail`), reason 아래 (라); 뒤틀림은 Mnd 를 주면 평가, 없으면 `not_evaluated` · reason (다). 판정 None. 구간 설계의 진술 없는 랩 구간과 같은 꼴이다(F2 상한 · F3 은 미평가, F4 는 준 Mcrd 로만).
- §H2(`lap.bending_shear`)는 원문대로 Mnℓo(Fy 기준)를 쓰므로 이 가정에 서지 않는다 — 진술과 무관하게 평가.

**랩 도구의 `Se` · `Mnd` · `Vn` 은 어디서 오나(V8-01, 호스트가 지킬 규칙):** 랩이 걸친 **그 지점의 랩 단면** 값이다 — 퍼린 결과의 그 지점 `lap` 구간(부모멘트, 하부 플랜지 압축)이지 「지배 구간」이 아니다.
- `Se` = 그 랩 구간의 Mnℓ / Fy, Mnℓ 은 **Fn = Fy**(Mne = My — `lap_restrained: true` 로 부른 랩 구간이 그렇게 낸다)에서, 비탄성 여유(`use_inelastic_reserve`) · 냉간 가공 없이. 그러면 랩 도구의 국부 비 = 그 랩 구간의 국부 비(도구: 두 부재 · Mu, 구간: 부재 하나 · Mu/2). 다른 구간의 Mnℓ(횡비틀림 · 뒤틀림으로 줄인 값, 정모멘트 쪽 값)을 쓰지 않는다. 엔진은 받은 Se 의 출처를 알 수 없다 — 지키는 것은 호출하는 쪽이다.
- `Mnd`: 진술이 있으면 보내지 않는다(보내도 쓰지 않음). 진술이 없을 때만 그 랩 단면의 Mnd(랩 구간 결과의 것)를.
- `Vn`: 그 랩 단면 한 부재의 §G2 전단강도(없으면 엔진이 d · t · Fy 로 §G2.1 을 계산).
- 시험(`test_review_1124_v8_fixes.py`): II-2A 첫 안쪽 지점(Mu 105 kip-in, Se = 85.9/55 = 1.562) → `lap.flexure.local` 1.0207 = 퍼린 `lap-1` 구간; 같은 진술의 구간 설계에서 읽은 Mnℓ/Fy 를 넘기면 두 비가 1e-12 안에서 같다.

**랩 단면 강도 블록 `lap_section` (2026-11-24) — 랩 검토가 단면 강도를 가져갈 곳은 이것이다, 구간 자신의 검토 항목이 아니다.** `lap_region: true` 와 진술(`lap_restrained: true`)로 부른 휨 구간 결과에 붙는다. 구간의 `member.flexure.local` · `Mnl` 은 비탄성 여유(§F3.2.3) · 냉간가공(§A3.3.2, Fya)을 품을 수 있다(그 선택이 켜져 있으면 랩으로 그 증가가 옮겨 간다 — V8-S2). 블록은 그 선택과 무관하게 언제나 같은 기준이다:

| 키 | 뜻 |
|---|---|
| `basis` | 'Manual II-1A / II-2A lapped section: Fn = Fy (Mne = My), §F3.2.1 local buckling only, no inelastic reserve (§F3.2.3), no cold work (§A3.3.2); Se = Mnℓ / Fy; Vn = §G2.1, one member' |
| `clause` · `equations` | `F3.2.1` · F2.1-2, F3.2.1-1/-2/-3, G2.1-1/-2a/-3a |
| `statement_source` | `{kind: 'user_input', key: 'lap_restrained'}` |
| `available` | Mcrl 이 있어 Mnℓ 을 냈는가. 없으면 `false`, `Mnl` · `Se` 는 `null`, `reason`(`member.reason.no_mcrl`) |
| `My` · `Mnl` · `Se` · `Vn` | 물리량 붙은 값 `{symbol, value, quantity}` — `My = Sf·Fy`(virgin Fy), `Mnℓ` (Eq. F3.2.1-1/-2, Mne = My), `Se = Mnℓ / Fy` (section_modulus), `Vn` = 그 단면 한 부재(웹 하나)의 §G2.1 (force) |
| `steps` | 계산 과정(§3 의 단계 — 출처 · 식 번호, 검토 항목과 같은 꼴) |

- 랩 도구 `design_lap_connection` 에는 `Se = lap_section.Se.value`, `Vn = lap_section.Vn.value` 를 그대로 넘긴다. `available: false` 면 `Se` 를 짓지 않는다(랩 휨은 판정 없음).
- 같은 단면 · 같은 진술이면 블록의 `Mnl` = 두 선택을 끈 구간의 `member.flexure.local` 공칭값(1e-12), 랩 도구의 국부 비 = 그 구간의 국부 비.
- 시험: 두 선택을 켜서 구간의 Mnℓ 이 176.8 → 212.9 (여유) · 194.0 (냉간가공) kip-in 으로 올라가도 블록은 176.8 그대로(lippedz 8×2.25×0.105). II-2A 의 `lap-1`(호스트 기록 `test/rendered/k3/golden/purlin.json`: Mcrl 90.85, My 106.64 kip-in) — 냉간가공을 켜도 블록 Mnℓ 85.95, **Se 1.5627 in³**, Vn 3.895 kips, 랩 국부 비 **1.0201** = 그 구간의 1.020. (위 1.0207 은 Mnℓ 을 85.9 로 반올림해 넣은 값이다.)

**랩 도구의 맨 위 `utilization`(2026-11-24 V8-01에서 바뀜):** 판정을 낸(`pass` · `fail`) 랩 **강도** 항목 — `lap.fastener_group` · `lap.block_shear` · `lap.flexure.local` · `lap.flexure.distortional` · `lap.bending_shear` (엔진 상수 `LAP_STRENGTH_CHECKS`) — 가운데 가장 큰 비(4자리), 그 항목 id 는 새 키 `governing_check`. 상세(간격 · 끝단 거리)와 적용 조건(랩 길이)의 비는 넣지 않는다. 그런 항목이 없으면 `null`. 패스너 무리의 비(옛 `utilization`)는 새 키 **`fastener_utilization`** 이고, `lap.fastener_group` 의 `mirrors.ratio.path` 가 그 키를 가리킨다. 다른 결과(부재 · 접합)의 `utilization` 과 같은 뜻이 되었다 — 전에는 휨이 6.9 로 불합격이어도 0.9025 였다.

문장(엔진 상수 — 호스트 · 화면은 그대로 보인다):
- (가) `design.aisi_s100.LAP_STATED`: `Lap region: lap_restrained = true (user statement) — AISI Design Manual Examples II-1A / II-2A: "The lapped section is assumed to be sufficiently restrained against lateral-torsional buckling and distortional buckling" (assumption (f): "the region at and near the interior supports is assumed to be not subject to lateral-torsional or distortional buckling between the support and the ends of the laps"). F2 uses Lb = 0 (no lateral-torsional buckling, Fn = Fy) and F4 is not applicable (Mnd = My).`
- (나) `design.aisi_s100.LAP_LTB_UNSTATED`: `F2 lateral-torsional buckling — lap region: restraint not stated. Give lap_restrained = true to apply the Manual assumption (AISI Design Manual Examples II-1A / II-2A: "The lapped section is assumed to be sufficiently restrained against lateral-torsional buckling and distortional buckling" (assumption (f): "the region at and near the interior supports is assumed to be not subject to lateral-torsional or distortional buckling between the support and the ends of the laps")), or give Lb for the lap region.`
- (다) `design.aisi_s100.LAP_DIST_UNSTATED`: `F4 distortional buckling — lap region: restraint not stated. Give lap_restrained = true to apply the Manual assumption (AISI Design Manual Examples II-1A / II-2A: "The lapped section is assumed to be sufficiently restrained against lateral-torsional buckling and distortional buckling" (assumption (f): "the region at and near the interior supports is assumed to be not subject to lateral-torsional or distortional buckling between the support and the ends of the laps")), or give Mcrd for the lapped section.`
- (라) `design.lap_checks.LAP_LTB_UNSTATED_TOOL`: `lap flexure Mnℓ = Se Fy (Fn = Fy, no lateral-torsional buckling) rests on the Manual assumption — restraint not stated. Give lap_restrained = true to apply it (AISI Design Manual Examples II-1A / II-2A: "The lapped section is assumed to be sufficiently restrained against lateral-torsional buckling and distortional buckling" (assumption (f): "the region at and near the interior supports is assumed to be not subject to lateral-torsional or distortional buckling between the support and the ends of the laps")).`
- 공통 인용 `design.aisi_s100.LAP_MANUAL_ASSUMPTION`: `AISI Design Manual Examples II-1A / II-2A: "The lapped section is assumed to be sufficiently restrained against lateral-torsional buckling and distortional buckling" (assumption (f): "the region at and near the interior supports is assumed to be not subject to lateral-torsional or distortional buckling between the support and the ends of the laps")`

호스트(K3)가 할 일: (1) 랩 구간 호출에서 `Lb = 0` · `Cb = 1.0` · `distortional_not_applicable` · `dsm.Mcrd` 삭제를 빼고 `lap_region: true` 와 `lap_restrained` 를 넘긴다. (2) 퍼린 입력(화면 · `design_purlin` MCP 스키마)과 랩 도구 스키마(`design_lap_connection`)에 `lap_restrained` 를 둔다(뜻: 위 인용 문장을 사람이 확인). (3) 호스트의 랩 가정 문장은 진술이 있을 때만 — 엔진이 (가)를 싣는다.

## 7. 단면 요소의 자리 `element_roles`

템플릿 생성 결과에 요소 순서대로 붙는다(`len == len(elem)`). 손으로 만든 단면(`custom` · `custom_builder`)에는 **붙이지 않는다**(짐작하지 않는다).

| 템플릿 | 자리 |
|---|---|
| lippedc · lippedz | `bottom_lip` `bottom_flange` `web` `top_flange` `top_lip` (+ `corner`) — D = 0 이면 track 과 같음 |
| track | `bottom_flange` `web` `top_flange` (+ `corner`) |
| hat | `brim` `web` `top_flange` `web` `brim` (+ `corner`) |
| rhs | `bottom_flange` `web` `top_flange` `web` (+ `corner`) |
| chs | `wall` |
| angle · lipped_angle | `leg` (+ `lip`, `corner`) |
| isect | `bottom_flange` `top_flange` `web` |
| tee | `top_flange` `web` |

위 · 아래는 모델 z 축 기준이다(정모멘트에서 압축인 쪽이 `top_*`).

## 8. 계산 과정이 비었거나 일부인 항목

2026-11-23 두 번째 묶음에서 용접(J2.1 · J2.2 · J2.3 · J2.5 · J2.6) · PAF(J5) · 용접 경로 J6.2 / J6.3 · 볼트 머리 풀오버, 나사 J4.5.1–J4.5.3 · 아크 스폿 J2.2.4 · PAF J5.4 상호작용, 표 B4.1-1(한계마다 비 · 한계 · 행을 `branch` 단계로), 부록 1 Eq. 1.1-4 의 요소별 판좌굴(평탄폭 · k · 외연 환산)과 부록 2 의 플랜지 · 립 성질 · Lcrd · 회전강성 넷 · Fcrd 를 모두 단계로 풀었다(계산한 자리의 값 그대로). `untraced` · `detail_unavailable` 단계는 이제 없다(시험 사례 전부).

남은 것:

| 항목 | 상태 | 까닭 |
|---|---|---|
| 플레어 베벨 목두께 tw (Eq. J2.6-5) | 공정을 주지 않으면 표 J2.6-1 의 공정마다 tw 를 구해 최소를 쓴다 — 단계는 그 최소값 하나(공정별 값은 단계로 나누지 않음) | 계산은 같다. 필요하면 공정마다 단계를 더할 수 있다 |
| 표 B4.1-1 의 보강재 개수 한계(n_f · n_le · n_w) | 단계 없음(경고 문구만) | 개수는 템플릿 입력에서 오고 지금 사례에서 늘 0 |
| `member.applicability.b4` 에 두께가 없을 때 | `not_evaluated`, `counts: false` | 대조할 치수가 없다 — 엔진은 이것으로 판정을 내리지 않는다 |
| 미평가 항목(`not_evaluated` · `not_applicable`) | `steps: []` 가 많다 | 계산한 것이 없다. 까닭은 `reason` · `steps_unavailable` |
| `lap.block_shear` (J6.3, 랩 패스너 무리의 블록 전단) | 평가 · 판정에 든다(2026-11-24) — 장력면을 뺀 하한 `Pnr = min(0.6 Fy Agv, 0.6 Fu Anv)`, `basis: lower_bound_tension_plane_ignored`, 결과 `assumptions` 에 한 줄 | 행 간격 · 웹 끝까지의 거리가 입력이 아니어서 장력면(Ubs Fu Ant ≥ 0)을 뺐다 — 보수. 두 치수가 입력이 되면 Eq. J6.3-1/-2 그대로로 바꾼다. 나사 접합은 `not_applicable`(J6 머리글: 나사 · PAF 는 J6.1 · J6.2) |

`member.applicability.b4` 는 이제 E–H 장 부재마다 나온다: 한계를 넘으면 `not_evaluated`(판정에 든다), 넘지 않으면 `pass` 이고 `counts: false`(엔진은 한계를 넘을 때만 판정을 바꾼다). 대조하지 못한 요소가 있으면 `reason` 에 적는다.

## 9. 경계층이 할 일

0. **지금 깨지는 경계 시험:** `npm run test:webview` 의 `mcp_si_chain` 이 SI 출력에서 단위 표가 없는 숫자 키(`design_checks[*]…value`)를 잡아 실패한다 — SI 모드 MCP 결과에 US 값이 섞여 나가는 것을 막는 시험이므로 옳은 실패다. 아래 1 이 끝나면 닫힌다. 나머지 웹뷰 계약은 모두 통과한다.
1. **SI 변환:** `design_checks[*]` 안의 `{symbol, value, quantity}` 꼴(`demand` · `nominal` · `capacity` · `reference.*` · `steps[*].inputs[*]` · `steps[*].result` · `source.half_wavelength`)을 `quantity` 로 바꾼다. `ratio` · `factor.value` 는 무차원. `rounded_to` 는 US 값의 반올림 자리이므로 SI 로 옮길 때 같이 바꾸거나(×) 버린다. 결과의 `display_rounding` 은 US 표시 자리수다 — SI 로 바꾼 값에는 맞지 않으므로 SI 출력에서는 버리거나 자체 표시 규칙으로 바꾼다. 문자열(`expr`, `condition`)은 단위가 없어 그대로.
2. **MCP 스키마:** `aisi_design` · `design_connection` · `lap_connection` 출력에 `design_checks`, `generate_section` 출력에 `element_roles` 를 덧붙이고, 입력에 `check_location` · `check_combination` 을 연다.
3. **호스트(`StcfsdPanel`):** 퍼린 구간 결과가 `{...pick, checks: …}` 로 대표 검토 지점의 결과만 남긴다 — 구간마다 검토 지점별 `design_checks` 를 함께 넘기고, 각 호출에 `check_location`(구간 · 지점) · `check_combination`(구간의 `combo`)을 준다. 랩 구간의 Mu · Vu 절반 가정은 호스트가 만든 것이므로 그 사실은 호스트가 덧붙인다.
4. 이름은 `name_ko` 를 쓰고, 경고 문구(`warnings`)는 이번 계약 밖이다(여전히 영 · 한 혼용).
5. **지배 표시(V6-03):** 요약의 '지배 검토'는 `governs: true` 항목을 그대로 쓴다. `governs_basis == 'not_evaluated'` 이면 '지배: <이름> — 미평가(<reason>), 참고 비 <reference.ratio>' 로 쓰고, `highest_evaluated` 가 있으면 '평가한 최대: <id> <ratio>' 를 따로 한 줄. 그 무리의 비를 머리 이용률로 쓰지 않는다. `fail` · `ratio` 는 지금처럼.
6. **적용범위 밖(V6-04):** `out_of_scope` 가 있는 항목은 미평가로 보이고, `reference` 의 값은 '참고(범위 밖)'으로만.
7. **비의 꼴(V6-06):** `ratio_form` 이 있으면 '원문 좌변 <demand.value> ≤ <capacity.value>, 견줄 비 <ratio>' 로. 이 비를 다른 비와 max 해도 된다.
8. **끝없는 값(V6-16):** `unbounded: true` 인 값은 SI 로 바꾸지 말고 '∞' 로. 옛 키 `positive_region.Fcre` · `Fcre_detail.Fcre` 는 웹뷰(`app.js`)가 숫자로 비교하므로 1e6 그대로 두고 `Fcre_unbounded: true` 를 옆에 붙였다(옛 계산서 `steps[]` 가운데 값이 1e6 인 단계에도 `unbounded: true` — V6b) — 화면이 이 표시를 읽게 되면 옛 키도 `null` 로 바꿀 수 있다. SI 변환은 `Fcre_unbounded` 가 참이면 `Fcre` 를 바꾸지 않아야 한다.
9. **US 단위 식(V6-11):** `expr_units: 'US'` 단계는 SI 응답에서 `units_note` 를 함께 보이고, `units_note`(SI 응답의 '식 문자열은 단위 없음' 문장)를 '식의 수는 무차원 계수뿐 — expr_units 가 US 인 단계는 예외'로 고친다.
10. **새 입력:** 랩 `distortion_restrained`(bool, 사용자가 랩 구간의 뒤틀림 구속을 밝힘 — V6-07). MCP `design_lap_connection` 스키마에 열어야 쓸 수 있다. 랩 결과에 `scope_notes`(J6.3 미검토) 키가 새로 생겼다 — 요약이 알림으로 올려야 한다.

## 10. 소비자가 가정해도 되는 것 / 안 되는 것

가정해도 된다:
- `id` 는 바뀌지 않고, 한 결과 안에서 유일하며, 모두 `REGISTRY` 에 있다.
- `verdict` 를 접은 값 = 옛 `pass`. 지배 항목의 비 = 옛 이용률(반올림 자리까지 — `mirrors`).
- `pass`/`fail` 항목에서 `ratio == demand.value / capacity.value` — `ratio_form` 이 있으면 `(demand.value / capacity.value)^(1/n)`. 마지막 `design_strength` 단계의 결과 = `capacity`(물리량 강도일 때).
- 단계의 결과는 그 단계의 입력과 `expr`(원문 식)로 다시 계산된다(`rounded_to` 가 있으면 그 자리까지). 시험이 계약 사례 전부에서 엔진 없이 확인한다.
- 무리마다 `governs` 는 하나이고 `governs_basis` 가 그 까닭이다. `governs_basis: 'not_evaluated'` 면 그 무리는 미평가다.
- 단계의 모든 입력에 `source` 가 있고, `source.kind == 'step'` 이면 그 단계 결과와 값 · 물리량이 같다. 단계의 결과는 뒤 단계의 입력이거나 항목의 소요 · 강도 · 비 · 참고값이다(떠도는 숫자가 없다).
- 엄격 JSON(NaN · Infinity 없음).

가정하면 안 된다:
- `steps` 의 `expr` 를 SI 로 바꾼 입력으로 계산해 같은 값이 나온다고 — `expr_units: 'US'` 단계(Eq. J3.3.2-1)는 US 단위로 쓴 식이다. 반올림해 넘어온 값(냉간가공 Fya, `rounded_to`)도 있다. 화면은 `result` 를 보여야 한다.
- `unbounded: true` 인 값이 숫자라고(`value` 는 `null`).
- 항목의 순서가 화면 순서라고 — 순서는 엔진 순서다.
- `not_evaluated` 항목에 강도가 있다고(`reference` 만 참고).
- 무리 이름이 화면 분류와 같다고 — `group` 은 지배를 가르는 엔진 무리다.
- `equations` 가 모두 쓰였다고 — 쓴 식은 단계의 `equation`.
- 단위가 SI 라고(엔진 출력은 US).

## 11. id 등록표

판정 · 계산 목록에 보이는 이름. `name_ko` 는 승인된 화면 시안(뒤틀림 좌굴 · 국부 좌굴 · 횡좌굴 · 휨 + 전단 · 웹 크리플링)을 먼저 따르고, 나머지는 국내 강구조 설계 실무에서 흔히 쓰는 말로 골랐다(기준 원문 대조는 하지 않았다 — 검토 대상).

| id | 조항 | 식 | name | name_ko | group |
|---|---|---|---|---|---|
| `member.applicability.b4` | B4.1 | Table B4.1-1 | Dimensional limits for Chapters E–H factors | 적용 한계 (표 B4.1-1) | `member.applicability` |
| `member.tension.yielding` | D2 | D2-1 | Yielding of gross section | 총단면 항복 | `member.tension` |
| `member.tension.rupture` | D3 | D3-1 | Rupture of net section | 순단면 파단 | `member.tension` |
| `member.compression.global` | E2 | E2-1, E2-2, E2-3, E2-4, E2.1-1, E2.2-1, E2.2-3, E2.2-5 | Yielding and global buckling | 항복 및 전체 좌굴 | `member.compression` |
| `member.compression.local` | E3.2.1 | E3.2.1-1, E3.2.1-2, E3.2.1-3 | Local buckling | 국부 좌굴 | `member.compression` |
| `member.compression.distortional` | E4.1 | E4.1-1, E4.1-2, E4.1-3, E4.1-4 | Distortional buckling | 뒤틀림 좌굴 | `member.compression` |
| `member.flexure.global` | F2 | F2.1-1, F2.1-3, F2.1-4, F2.1-5, F2.1.1-1, F2.1.3-1, F2.1.4-1, F2.1.4-2, F2.3-1, F2.4.2-1 | Yielding and lateral-torsional buckling | 항복 및 횡좌굴 | `member.flexure` |
| `member.flexure.local` | F3.2.1 | F3.2.1-1, F3.2.1-2, F3.2.1-3, F3.2.3-1 | Local buckling | 국부 좌굴 | `member.flexure` |
| `member.flexure.distortional` | F4.1 | F4.1-1, F4.1-2, F4.1-3, F4.1-4, F4.3-1 | Distortional buckling | 뒤틀림 좌굴 | `member.flexure` |
| `member.flexure.uplift_r` | I6.2.1 | I6.2.1-1 | Flexure of through-fastened C/Z under uplift (R factor) | 관통 체결 C·Z 양력 휨 (R 계수) | `member.flexure` |
| `member.flexure.positive_region` | F2 | F2.1-1, F3.2.1-2, F4.1-2 | Flexure, positive-moment region | 정모멘트 구간 휨 | `member.flexure_positive` |
| `member.shear` | G2.1 | G2.1-1, G2.1-2a, G2.1-3a, G2.1-4, G2.1-5, G2.3-1, G2.3-2 | Shear | 전단 | `member.shear` |
| `member.web_crippling` | G5 | G5-1, G5-2 | Web crippling | 웹 크리플링 | `member.web_crippling` |
| `member.bending_shear` | H2 | H2-1, H2-2 | Combined bending and shear | 휨 + 전단 | `member.bending_shear` |
| `member.bending_web_crippling` | H3 | H3-1a, H3-1b, H3-2a, H3-2b, H3-3a, H3-3b | Combined bending and web crippling | 휨 + 웹 크리플링 | `member.bending_web_crippling` |
| `member.axial_bending` | H1.2 | H1.2-1, C1.2.1.1-3, C1.2.1.1-4 | Combined compressive axial load and bending | 압축 + 휨 | `member.axial_bending` |
| `member.tension_bending.flange_yield` | H1.1 | H1.1-1, H1.1-3a, H1.1-3b | Combined tension and bending — tension flange yielding | 인장 + 휨 (인장 플랜지 항복) | `member.tension_bending` |
| `member.tension_bending.buckling` | H1.1 | H1.1-2 | Combined tension and bending — compression flange buckling | 인장 + 휨 (압축 측 좌굴) | `member.tension_bending` |
| `conn.bolt.bearing` | J3.3.1 | J3.3.1-1 | Bolt bearing | 볼트 지압 | `conn.shear` |
| `conn.bolt.bearing_deformation` | J3.3.2 | J3.3.2-1 | Bolt bearing with hole deformation | 볼트 지압 (구멍 변형 고려) | `conn.shear` |
| `conn.bolt.shear` | J3.4 | J3.4-1 | Bolt shear | 볼트 전단 | `conn.shear` |
| `conn.bolt.tension` | J3.4 | J3.4-1 | Bolt tension | 볼트 인장 | `conn.tension` |
| `conn.bolt.pullover` | J3.4 | — | Sheet pull-over at bolt head | 볼트 머리 풀오버 | `conn.tension` |
| `conn.bolt.shear_tension` | J3.4 | J3.4-2, J3.4-3 | Bolt tension with reduced F'nt (shear + tension) | 볼트 전단 + 인장 | `conn.interaction` |
| `conn.screw.bearing_tilting` | J4.3.1 | J4.3.1-1 – J4.3.1-5 | Screw bearing / tilting | 나사 지압 · 틸팅 | `conn.shear` |
| `conn.screw.shear` | J4.3.2 | — | Screw shear | 나사 전단 | `conn.shear` |
| `conn.screw.pullout` | J4.4.1 | J4.4.1-1 | Screw pull-out | 나사 뽑힘 (풀아웃) | `conn.tension` |
| `conn.screw.pullover` | J4.4.2 | J4.4.2-1, J4.4.2-2 | Screw pull-over | 나사 머리 풀오버 | `conn.tension` |
| `conn.screw.tension` | J4.4.3 | — | Screw tension | 나사 인장 | `conn.tension` |
| `conn.screw.shear_pullover` | J4.5.1 | J4.5.1-1a, J4.5.1-1b, C-J4.5.1-1 | Combined shear and pull-over | 전단 + 풀오버 | `conn.interaction` |
| `conn.screw.shear_pullout` | J4.5.2 | J4.5.2-1a, J4.5.2-1b, C-J4.5.1-1 | Combined shear and pull-out | 전단 + 풀아웃 | `conn.interaction` |
| `conn.screw.shear_tension` | J4.5.3 | J4.5.3-1a, J4.5.3-1b | Combined shear and tension in screws | 나사 전단 + 인장 | `conn.interaction` |
| `conn.fillet.sheet` | J2.5 | J2.5-1 – J2.5-6 | Fillet weld — sheet strength | 필릿 용접 — 판 강도 | `conn.shear` |
| `conn.fillet.weld` | J2.5 | J2.5-7 | Fillet weld — weld metal | 필릿 용접 — 용접 금속 | `conn.shear` |
| `conn.arc_spot.weld_shear` | J2.2.2.1 | J2.2.2.1-1 | Arc spot weld — weld shear | 아크 스폿 용접 — 용접 전단 | `conn.shear` |
| `conn.arc_spot.sheet_tear` | J2.2.2.1 | J2.2.2.1-2, -3, -4 | Arc spot weld — sheet tearing | 아크 스폿 용접 — 판 찢김 | `conn.shear` |
| `conn.arc_spot.sheet_to_sheet` | J2.2.2.2 | J2.2.2.2-1, -2 | Arc spot weld — sheet-to-sheet shear | 아크 스폿 용접 — 판-판 전단 | `conn.shear` |
| `conn.arc_spot.tension` | J2.2.3 | J2.2.3-1, -2 | Arc spot weld — tension | 아크 스폿 용접 — 인장 | `conn.tension` |
| `conn.arc_spot.shear_tension` | J2.2.4 | J2.2.4-1 | Arc spot weld — combined shear and tension | 아크 스폿 용접 — 전단 + 인장 | `conn.interaction` |
| `conn.arc_seam.weld_shear` | J2.3.2.1 | J2.3.2.1-1 | Arc seam weld — weld shear | 아크 심 용접 — 용접 전단 | `conn.shear` |
| `conn.arc_seam.sheet_tear` | J2.3.2.1 | J2.3.2.1-2 | Arc seam weld — sheet tearing | 아크 심 용접 — 판 찢김 | `conn.shear` |
| `conn.arc_seam.sheet_to_sheet` | J2.3.2.2 | J2.3.2.2-1, -2 | Arc seam weld — sheet-to-sheet shear | 아크 심 용접 — 판-판 전단 | `conn.shear` |
| `conn.groove.shear` | J2.1 | J2.1-2, J2.1-3 | Groove weld in butt joint — shear | 맞대기 그루브 용접 — 전단 | `conn.shear` |
| `conn.groove.tension_compression` | J2.1 | J2.1-1 | Groove weld in butt joint — tension/compression | 맞대기 그루브 용접 — 인장 · 압축 | `conn.shear` |
| `conn.flare_groove.shear` | J2.6 | J2.6-1 – J2.6-4 | Flare groove weld — shear | 플레어 그루브 용접 — 전단 | `conn.shear` |
| `conn.paf.pin_shear` | J5.3.1 | J5.3.1-1 | PAF shear (pin) | PAF 전단 (핀) | `conn.shear` |
| `conn.paf.bearing_tilting` | J5.3.2 | J5.3.2-1 | PAF bearing / tilting | PAF 지압 · 틸팅 | `conn.shear` |
| `conn.paf.pullout_shear` | J5.3.3 | J5.3.3-1 | PAF pull-out in shear | PAF 전단 뽑힘 | `conn.shear` |
| `conn.paf.tension` | J5.2.1 | J5.2.1-1, -2 | PAF tension (pin) | PAF 인장 (핀) | `conn.tension` |
| `conn.paf.pullout_tension` | J5.2.2 | — | PAF pull-out in tension | PAF 인장 뽑힘 | `conn.tension` |
| `conn.paf.pullover` | J5.2.3 | J5.2.3-1 | PAF pull-over | PAF 머리 풀오버 | `conn.tension` |
| `conn.paf.shear_tension` | J5.4 | C-J5.4-1 | PAF combined shear and tension | PAF 전단 + 인장 | `conn.interaction` |
| `conn.j6.shear_rupture` | J6.1 | J6.1-1, J6.1-2 | Shear rupture | 전단 파단 | `conn.shear` |
| `conn.j6.tension_rupture` | J6.2 | J6.2-1, J6.2-3 – J6.2-8 | Tension rupture of net section (shear lag) | 순단면 인장 파단 (전단 지연) | `conn.shear` |
| `conn.j6.block_shear` | J6.3 | J6.3-1, J6.3-2 | Block shear rupture | 블록 전단 파단 | `conn.shear` |
| `conn.j6.shear_rupture.part2` · `tension_rupture.part2` · `block_shear.part2` | J6.1 · J6.2 · J6.3 | 위와 같음 | … — second part | … — 두 번째 판 | `conn.shear` |
| `conn.j6.inputs` | J6 | — | Rupture checks — required geometry | 파단 검토 — 필요한 기하 | `conn.shear` |
| `conn.member.tension_yield` | D2 | D2-1 | Connected member — tension yielding | 접합 부재 — 총단면 항복 | `conn.shear` |
| `conn.member.tension_rupture` | D3 | D3-1 | Connected member — tension rupture | 접합 부재 — 순단면 파단 | `conn.shear` |
| `conn.member.tension` | D2 | D2-1, D3-1 | Connected member — tension (Chapter D) | 접합 부재 — 인장 (D 장) | `conn.shear` |
| `conn.scope` | J1 | — | Scope of Chapter J (thickness, fastener size) | 적용 범위 (두께 · 패스너 지름) | `conn.scope` |
| `conn.shear_strength` | J1 | — | In-plane shear strength (any verified limit state) | 면내 전단 강도 (평가된 한계상태) | `conn.scope` |
| `conn.tension_strength` | J1 | — | Out-of-plane tension strength (any verified limit state) | 축방향 인장 강도 (평가된 한계상태) | `conn.scope` |
| `conn.out_of_plane_tension` | J1 | — | Out-of-plane tension of this connection type | 면외 인장 (이 접합 유형) | `conn.tension` |
| `conn.shear_tension` | J1 | — | Combined shear and tension (not implemented for this type) | 전단 + 인장 (이 유형은 미구현) | `conn.interaction` |
| `conn.weld.min_effective_diameter` | J2.2 | — | Arc spot weld — minimum effective diameter | 아크 스폿 용접 — 최소 유효 지름 | `conn.detailing` |
| `conn.weld.pjp_throat` | J2.1 | — | Partial-joint-penetration groove — effective throat | 부분 용입 그루브 — 유효 목두께 | `conn.shear` |
| `conn.flare_groove.transverse_v` | J2.6 | — | Flare V-groove — transverse load | 플레어 V 그루브 — 횡하중 | `conn.shear` |
| `conn.flare_groove.weld_metal_cap` | J2.6 | J2.6-4 | Flare groove — weld metal cap | 플레어 그루브 — 용접 금속 상한 | `conn.shear` |
| `conn.paf.fastener_strength` | J5.2.1 | — | PAF steel strength F_uh | PAF 강도 F_uh | `conn.scope` |
| `conn.detail.bolt_end_distance` | J3.2 | — | Bolt end distance e ≥ 1.5d | 볼트 끝단 거리 e ≥ 1.5d | `conn.detailing` |
| `conn.detail.bolt_hole_to_end` | J3.2 | — | Bolt hole edge to end ≥ d | 볼트 구멍 가장자리 → 끝단 ≥ d | `conn.detailing` |
| `conn.detail.bolt_edge_distance` | J3.2 | — | Bolt edge distance ≥ 1.5d | 볼트 연단 거리 ≥ 1.5d | `conn.detailing` |
| `conn.detail.bolt_spacing` | J3.1 | — | Bolt spacing s ≥ 3d | 볼트 간격 s ≥ 3d | `conn.detailing` |
| `conn.detail.bolt_clear_spacing` | J3.1 | — | Clear distance between bolt holes ≥ 2d | 볼트 구멍 순간격 ≥ 2d | `conn.detailing` |
| `conn.detail.screw_end_distance` | J4.2 | — | Screw end distance e ≥ 1.5d | 나사 끝단 거리 e ≥ 1.5d | `conn.detailing` |
| `conn.detail.screw_spacing` | J4.1 | — | Screw spacing ≥ 3d | 나사 간격 ≥ 3d | `conn.detailing` |
| `conn.detail.weld_end_distance` | J2.2.1 | — | Arc spot weld centre to end ≥ 1.5d | 아크 스폿 용접 중심 → 끝단 ≥ 1.5d | `conn.detailing` |
| `conn.detail.weld_clear_end` | J2.2.1 | — | Arc spot weld edge to end ≥ 1.0d | 아크 스폿 용접 → 끝단 순거리 ≥ 1.0d | `conn.detailing` |
| `conn.detail.weld_clear_spacing` | J2.2.1 | — | Clear distance between arc spot welds ≥ 1.0d | 아크 스폿 용접 사이 순거리 ≥ 1.0d | `conn.detailing` |
| `conn.detail.seam_end_distance` | J2.3.1 | — | Arc seam weld centre to end ≥ 1.5d | 아크 심 용접 중심 → 끝단 ≥ 1.5d | `conn.detailing` |
| `conn.detail.seam_clear_end` | J2.3.1 | — | Arc seam weld edge to end ≥ 1.0d | 아크 심 용접 → 끝단 순거리 ≥ 1.0d | `conn.detailing` |
| `conn.detail.paf_edge_distance` | J5.1 | Table J5.1-1 | PAF edge distance | PAF 연단 거리 | `conn.detailing` |
| `conn.detail.paf_spacing` | J5.1 | Table J5.1-1 | PAF spacing | PAF 간격 | `conn.detailing` |
| `lap.fastener_group` | A1.2(c) | — | Lap fasteners — transfer force (in-house rational model) | 랩 패스너 — 전달력 (사내 합리적 해석) | `lap.fasteners` |
| `lap.fastener_count` | A1.2(c) | — | Lap fasteners — required number fits in the lap | 랩 패스너 — 필요 개수 배치 | `lap.fasteners` |
| `lap.fastener_spacing` | J3.1 | — | Lap fasteners — spacing ≥ 3d | 랩 패스너 — 간격 ≥ 3d | `lap.fasteners` |
| `lap.length_condition` | I6.2.1 | I6.2.1(g) | Lap length ≥ 1.5d each side (applicability condition) | 랩 길이 ≥ 1.5d (적용 조건) | `lap.condition` |
| `lap.flexure.local` | F3.1 | F3.1-1 | Lap flexure — two members, Se·Fy | 랩 구간 휨 (2겹, Se·Fy) | `lap.flexure` |
| `lap.flexure.distortional` | F4.1 | F4.1-2 | Lap flexure — distortional, two members | 랩 구간 뒤틀림 좌굴 (2겹) | `lap.flexure` |
| `lap.bending_shear` | H2 | H2-1 | Lap combined bending and shear | 랩 구간 휨 + 전단 | `lap.flexure` |
| `lap.block_shear` | J6.3 | J6.3-1, J6.3-2 | Lap fasteners — block shear rupture of the fastener group (lower bound, tension plane ignored — 8절) | 랩 패스너 무리 — 블록 전단 파단 | `lap.fasteners` |

비탄성 예비강도(F2.4.2 · F3.2.3 · F4.3)와 냉간가공(A3.3.2)은 따로 된 검토가 아니라 각 모드 강도의 다른 식이다 — 해당 항목의 `branch` · `modifier` 단계로 나온다(한 한계상태를 두 번 세지 않는다).

## 12. 예 — Manual Example II-1B, 부모멘트 구간의 뒤틀림 좌굴 (LRFD, 줄임)

입력: 9CS2.5x059, Fy 55, Mu 60 kip-in, `dsm = {Mcrl: 84.4, Mcrd: 107.1, My: 126, Lcrd: 25, M_Lcrd: 25}`, `dist_M1_M2 = 0`, `dist_Lm = 56.3`, `check_combination = 'D+Lr'`.

```json
{
 "id": "member.flexure.distortional", "group": "member.flexure",
 "clause": "F4.1", "equations": ["F4.1-1", "F4.1-2", "F4.1-3", "F4.1-4", "F4.3-1"],
 "name": "Distortional buckling", "name_ko": "뒤틀림 좌굴", "design_method": "LRFD",
 "demand":   {"symbol": "Mu", "value": 60.0, "quantity": "moment",
              "source": {"kind": "load_analysis", "key": "Mu", "combination": "D+Lr"}},
 "nominal":  {"symbol": "Mnd", "value": 99.7298, "quantity": "moment"},
 "factor":   {"symbol": "φb", "value": 0.9, "kind": "phi", "source": {"kind": "specification"}},
 "capacity": {"symbol": "φbMnd", "value": 89.7568, "quantity": "moment"},
 "ratio": 0.66847, "verdict": "pass", "reason": null, "governs": false, "counts": true,
 "location": {"segment": "negative_moment_region", "support": "B"}, "combination": "D+Lr",
 "steps": [
  {"kind": "yield", "expr": "My = Sf Fy", "equation": "F4.1-4",
   "inputs": [{"symbol": "Sf", "value": 2.29, "quantity": "section_modulus", "source": {"kind": "section_property", "key": "Sf"}},
              {"symbol": "Fy", "value": 55.0, "quantity": "stress", "source": {"kind": "material", "key": "Fy"}}],
   "result": {"symbol": "My", "value": 125.95, "quantity": "moment"}},
  {"kind": "elastic_buckling", "expr": "Mcrd (elastic distortional buckling moment)", "equation": null,
   "inputs": [{"symbol": "Mcrd", "value": 107.1, "quantity": "moment",
               "source": {"kind": "buckling_analysis", "method": "fsm_minimum", "label": "FSM",
                          "half_wavelength": {"symbol": "L", "value": 25.0, "quantity": "length"}}}],
   "result": {"symbol": "Mcrd", "value": 107.1, "quantity": "moment"}},
  {"kind": "modifier", "expr": "β = 1 + 0.4 (L/Lm)^0.7 (1 + M1/M2)^0.7, 1.0 ≤ β ≤ 1.3", "equation": "2.3.3.3-3", "…": "…",
   "result": {"symbol": "β", "value": 1.2266, "quantity": "dimensionless"}},
  {"kind": "modifier", "expr": "Mcrd = β Mcrd", "…": "…", "result": {"symbol": "Mcrd", "value": 131.369, "quantity": "moment"}},
  {"kind": "slenderness", "expr": "λd = (My / Mcrd)^0.5", "equation": "F4.1-3", "…": "…",
   "result": {"symbol": "λd", "value": 0.9792, "quantity": "dimensionless"}},
  {"kind": "branch", "expr": null, "equation": "F4.1-2", "condition": "λd ≤ 0.673", "holds": false,
   "inputs": [{"symbol": "λd", "value": 0.9792, "quantity": "dimensionless", "source": {"kind": "step", "step": 4}}], "result": null},
  {"kind": "equation", "expr": "Mnd = [1 − 0.22 (Mcrd/My)^0.5] (Mcrd/My)^0.5 My", "equation": "F4.1-2",
   "inputs": [{"symbol": "My", "…": "…", "source": {"kind": "step", "step": 0}},
              {"symbol": "Mcrd", "…": "…", "source": {"kind": "step", "step": 3}}],
   "result": {"symbol": "Mnd", "value": 99.7298, "quantity": "moment"}},
  {"kind": "design_strength", "expr": "φbMnd = φb Mnd", "…": "…", "result": {"symbol": "φbMnd", "value": 89.7568, "quantity": "moment"}},
  {"kind": "verdict", "expr": "Mu / φbMnd ≤ 1", "verdict": "pass", "…": "…", "result": {"symbol": "ratio", "value": 0.66847, "quantity": "dimensionless"}}
 ],
 "mirrors": {"nominal": {"path": "Mnd", "digits": 2}}
}
```

(값은 짧게 줄였다 — 실제 출력은 반올림하지 않은 실수.) Manual 인쇄값: My 126, βMcrd 132, λd 0.977, Mnd 99.9, φMnd 89.9 — 시험 `test_manual_F_II_1B_per_mode_design_strengths` 가 ±0.7 % 로 맞댄다(Manual 은 β 를 1.23 으로 반올림해 곱한다).

## 13. 검증

- `test/python/test_review_1123_checks.py`(두 게이트가 자동 수집): 등록 · 유일 · 어휘 · 출처 · `mirrors` 로 옛 값과 대조(300 개 넘게) · 비 = 소요/강도 · 마지막 설계강도 단계 = 강도 · 떠도는 숫자 없음 · 미평가에 강도 없음 · 무리 지배 = 최대 비 · 결과 판정 접기 = 옛 `pass` · 엄격 JSON · 서버 통과 · 위치/조합 · 요소 자리, 그리고 Manual 대조(D · E · F · G · H · I · J 장).
- `test/python/contract_cases_1123.py`: 사례 목록과 기준선 도구. 변경 전 `python/`(git HEAD 사본이면 된다)에서 `capture`, 변경 뒤 `capture`, `compare` 로 옛 키 · 값이 비트 단위로 같은지 본다.

## 14. 부록 — §8.3.1 수정(2026-11-23)으로 바뀐 기준선 값

비교 도구: `contract_cases_1123.py compare <수정 전> <수정 뒤> --ignore=design_checks,report --all`. 수정 전은 커밋 `3590808` 의 엔진. 계산 과정을 더한 일(A)만으로는 옛 값이 하나도 바뀌지 않았다(같은 비교, 차이 0).

비교: 수정 전(커밋 3590808) 140 사례, 값 24209 개 — 바뀐 값 304 개(design_checks · report 제외; report 는 아래 값을 그대로 찍는 글이라 같이 바뀐다). 나머지는 비트 단위로 같다.

**§8.3.1-1 (식 번호)** — 문자열만: `F2-1 (yielding)` → `F2.1-3 (yielding)`, `F2-1 (inelastic LTB)` → `F2.1-4 (inelastic LTB)`, `F2-1 (elastic LTB)` → `F2.1-5 (elastic LTB)` (그 문자열을 담은 `steps[].formula` 포함).
- `positive_region.equation` — 41 사례: G5 ASD, G5 alone governs LRFD, G5 load from Vu, G5 no bearing load, H2 Manual II-2A lap end ASD, H2-2 stiffened, H3 multi-web ETF Z, I6.2.1 R exceeds table, I6.2.1 uplift II-2A, II-1B C9 beta LRFD, II-1C Fcre 41.0, II-2B Z ASD, II-4A track LTB LRFD, II-4B track Fcre 56.6 ASD, II-4B track Fcre 56.6 LRFD, II-9 RHS F2.1.4, III-11 RHS combined ASD, III-11 RHS combined LRFD, RHS F2.1.4-2 long, band: H1.2 with rounded Pa/Max, band: positive region ratio 1.000004, band: web crippling Pn rounded, combined angle (P)L/1000, combined angle (P)L/1000 fails, combined positive region fails, combined tension + bending, combined with shear and M1/M2, default lippedc flexure (auto FSM), flexure B4 exceeded and fails, flexure Mcrd missing (F4 not evaluated), flexure Mcrl missing, flexure analytic Mcrd II-5, flexure cold work + shear + wc, flexure track F4 n/a, flexure unrestrained reference, positive region Lb_pos missing, positive region governs, purlin negative region (M_max), purlin positive region uplift R, purlin support with wc, sharp lippedz combined (auto FSM)
- `steps[].equation` — 46 사례: G5 ASD, G5 alone governs LRFD, G5 load from Vu, G5 no bearing load, H2 Manual II-2A lap end ASD, H2-2 stiffened, H3 multi-web ETF Z, H3-2 built-up I, I-8B lippedc ASD flexure (auto FSM), I6.2.1 R exceeds table, I6.2.1 uplift II-2A, II-1B C9 beta LRFD, II-1C Fcre 41.0, II-2B Z ASD, II-4A track LTB LRFD, II-4B track Fcre 56.6 ASD, II-4B track Fcre 56.6 LRFD, II-9 RHS F2.1.4, III-11 RHS combined ASD, III-11 RHS combined LRFD, RHS F2.1.4-2 long, band: H1.2 with rounded Pa/Max, band: positive region ratio 1.000004, band: web crippling Pn rounded, combined angle (P)L/1000, combined angle (P)L/1000 fails, combined positive region fails, combined tension + bending, combined with shear and M1/M2, default lippedc flexure (auto FSM), flexure B4 exceeded and fails, flexure Lb missing, flexure Mcrd missing (F4 not evaluated), flexure Mcrl missing, flexure analytic Mcrd II-5, flexure cold work + shear + wc, flexure hat negative sign, flexure track F4 n/a, flexure unrestrained reference, positive region Lb_pos missing, positive region governs, purlin lap region (half M), purlin negative region (M_max), purlin positive region uplift R, purlin support with wc, sharp lippedz combined (auto FSM)

**§8.3.1-2 (앵글 조합 판정)** — 5 값

| 사례 · 키 | 전 | 후 |
|---|---|---|
| `combined angle (P)L/1000.result.not_evaluated` | ["[압축] H1.2 angle (P)L/1000"] | null |
| `combined angle (P)L/1000.result.pass` | null | true |
| `combined angle (P)L/1000.result.utilization_valid` | false | null |
| `combined angle (P)L/1000 fails.result.not_evaluated` | ["[압축] H1.2 angle (P)L/1000"] | null |
| `combined angle (P)L/1000 fails.result.utilization_valid` | false | null |

**§8.3.1-3 (정모멘트 구간 판정)** — 4 값

| 사례 · 키 | 전 | 후 |
|---|---|---|
| `band: positive region ratio 1.000004.result.limit_state_checks[1].pass` | true | false |
| `band: positive region ratio 1.000004.result.pass` | true | false |
| `band: positive region ratio 1.000004.result.positive_region.pass` | true | false |
| `band: positive region ratio 1.000004.result.warnings` | 0 | 1 |

**§8.3.1-4 (접합부 · 랩 — 반올림 전 설계강도)** — 88 값

| 사례 · 키 | 전 | 후 |
|---|---|---|
| `IV-1 fillet ASD.result.checks[0].ratio` | 0.9268 | 0.9269 |
| `IV-1 fillet ASD.result.utilization` | 0.9268 | 0.9269 |
| `IV-1 fillet ASD.result.utilization_reference` | 0.9268 | 0.9269 |
| `IV-1 fillet member tension ASD.result.checks[0].ratio` | 0.9268 | 0.9269 |
| `IV-1 fillet member tension ASD.result.utilization` | 0.9268 | 0.9269 |
| `IV-1 fillet member tension ASD.result.utilization_reference` | 0.9268 | 0.9269 |
| `IV-11 screw V+T ASD.result.checks[0].ratio` | 0.8333 | 0.833 |
| `IV-11 screw V+T ASD.result.checks[1].ratio` | 0.6888 | 0.6875 |
| `IV-11 screw V+T ASD.result.utilization_reference` | 0.8333 | 0.833 |
| `IV-11 screw V+T LRFD.result.checks[0].ratio` | 0.9259 | 0.9256 |
| `IV-11 screw V+T LRFD.result.checks[1].ratio` | 0.7627 | 0.7639 |
| `IV-11 screw V+T LRFD.result.utilization_reference` | 0.9259 | 0.9256 |
| `IV-12 PAF V+T ASD.result.checks[0].ratio` | 0.3242 | 0.324 |
| `IV-12 PAF V+T ASD.result.checks[1].ratio` | 0.2864 | 0.2866 |
| `IV-12 PAF V+T ASD.result.utilization_reference` | 0.3242 | 0.324 |
| `IV-12 PAF V+T LRFD.result.checks[0].ratio` | 0.3293 | 0.3292 |
| `IV-12 PAF V+T LRFD.result.checks[1].ratio` | 0.3183 | 0.3184 |
| `IV-12 PAF V+T LRFD.result.utilization_reference` | 0.3293 | 0.3292 |
| `IV-2 arc spot LRFD.result.checks[0].ratio` | 0.5367 | 0.5368 |
| `IV-2 arc spot LRFD.result.utilization` | 0.5367 | 0.5368 |
| `IV-2 arc spot LRFD.result.utilization_reference` | 0.5367 | 0.5368 |
| `IV-2 arc spot V+T ASD.result.checks[1].ratio` | 0.5948 | 0.5949 |
| `IV-2 arc spot V+T LRFD.result.checks[0].ratio` | 0.3864 | 0.3865 |
| `IV-2 arc spot V+T LRFD.result.checks[1].ratio` | 0.8814 | 0.8813 |
| `IV-2 arc spot V+T LRFD.result.utilization_reference` | 0.8814 | 0.8813 |
| `IV-2 tension direction.result.checks[0].ratio` | 0.6609 | 0.661 |
| `IV-2 tension direction.result.utilization` | 0.6609 | 0.661 |
| `IV-2 tension direction.result.utilization_reference` | 0.6609 | 0.661 |
| `IV-4 flare bevel ASD.result.checks[0].ratio` | 0.875 | 0.8749 |
| `IV-4 flare bevel ASD.result.utilization` | 0.875 | 0.8749 |
| `IV-4 flare bevel ASD.result.utilization_reference` | 0.875 | 0.8749 |
| `IV-4 flare bevel LRFD.result.checks[0].ratio` | 0.5829 | 0.583 |
| `IV-4 flare bevel LRFD.result.utilization` | 0.5829 | 0.583 |
| `IV-4 flare bevel LRFD.result.utilization_reference` | 0.5829 | 0.583 |
| `IV-9 bolt ASD.result.checks[0].ratio` | 0.9534 | 0.9533 |
| `IV-9 bolt ASD.result.utilization` | 0.9534 | 0.9533 |
| `IV-9 bolt ASD.result.utilization_reference` | 0.9534 | 0.9533 |
| `arc spot sheet-to-sheet.result.checks[0].ratio` | 0.5711 | 0.571 |
| `arc spot sheet-to-sheet.result.utilization` | 0.5711 | 0.571 |
| `arc spot sheet-to-sheet.result.utilization_reference` | 0.5711 | 0.571 |
| `band: IV-9 J6.1 design strength rounded.result.checks[0].pass` | false | true |
| `band: IV-9 J6.1 design strength rounded.result.checks[0].ratio` | 1.0001 | 0.9999 |
| `band: IV-9 J6.1 design strength rounded.result.evaluated_pass` | false | true |
| `band: IV-9 J6.1 design strength rounded.result.pass` | false | true |
| `band: IV-9 J6.1 design strength rounded.result.utilization` | 1.0001 | 0.9999 |
| `band: IV-9 J6.1 design strength rounded.result.utilization_reference` | 1.0001 | 0.9999 |
| `band: IV-9 J6.1 design strength rounded.result.verdict` | "FAIL" | "PASS" |
| `bolt assumed e (not decided).result.checks[0].ratio` | 0.6583 | 0.6584 |
| `bolt assumed e (not decided).result.utilization` | 0.6583 | 0.6584 |
| `bolt assumed e (not decided).result.utilization_reference` | 1.2158 | 1.2156 |
| `bolt part 2 J6.result.checks[0].ratio` | 0.6079 | 0.6078 |
| `bolt part 2 J6.result.utilization` | 0.6079 | 0.6078 |
| `bolt part 2 J6.result.utilization_reference` | 0.6079 | 0.6078 |
| `bolt short e fails.result.checks[0].ratio` | 0.8953 | 0.8949 |
| `bolt short e fails.result.utilization` | 0.8953 | 0.8949 |
| `bolt short e fails.result.utilization_reference` | 0.8953 | 0.8949 |
| `bolt thick (AISC scope).result.checks[0].ratio` | 0.3843 | 0.3844 |
| `bolt thick (AISC scope).result.utilization` | 0.3843 | 0.3844 |
| `bolt thick (AISC scope).result.utilization_reference` | 0.3843 | 0.3844 |
| `lap bolt Se Mnd.result.capacity` | 16.727999999999998 | 16.726499999999998 |
| `lap bolt Se Mnd.result.steps[6].formula` | "Capacity = 6 ea × 2.788 kips = 16.728 kips, DCR = V_transfer / Capacity = 15… | "Capacity = 6 ea × 2.788 kips = 16.726 kips, DCR = V_transfer / Capacity = 15… |
| `lap bolt Se e=2.result.capacity` | 16.727999999999998 | 16.726499999999998 |
| `lap bolt Se e=2.result.steps[6].formula` | "Capacity = 6 ea × 2.788 kips = 16.728 kips, DCR = V_transfer / Capacity = 15… | "Capacity = 6 ea × 2.788 kips = 16.726 kips, DCR = V_transfer / Capacity = 15… |
| `lap bolt Sf only.result.capacity` | 16.727999999999998 | 16.726499999999998 |
| `lap bolt Sf only.result.steps[6].formula` | "Capacity = 6 ea × 2.788 kips = 16.728 kips, DCR = V_transfer / Capacity = 15… | "Capacity = 6 ea × 2.788 kips = 16.726 kips, DCR = V_transfer / Capacity = 15… |
| `lap bolt no Se.result.capacity` | 18.12 | 18.120375000000003 |
| `lap bolt no Se.result.utilization` | 0.834 | 0.8339 |
| `lap bolt short e.result.capacity` | 11.28 | 11.2749 |
| `lap bolt short e.result.steps[6].formula` | "Capacity = 16 ea × 0.705 kips = 11.280 kips, DCR = V_transfer / Capacity = 1… | "Capacity = 16 ea × 0.705 kips = 11.275 kips, DCR = V_transfer / Capacity = 1… |
| `lap bolt short e.result.utilization` | 1.3397 | 1.3403 |
| `lap bolt short e.result.warnings[5]` | "용량 부족: V_transfer = 15.111 kips > Capacity = 11.280 kips (DCR = 1.34). 패스너 수… | "용량 부족: V_transfer = 15.111 kips > Capacity = 11.275 kips (DCR = 1.34). 패스너 수… |
| `lap bolt short lap.result.capacity` | 16.727999999999998 | 16.726499999999998 |
| `lap bolt short lap.result.steps[6].formula` | "Capacity = 6 ea × 2.788 kips = 16.728 kips, DCR = V_transfer / Capacity = 15… | "Capacity = 6 ea × 2.788 kips = 16.726 kips, DCR = V_transfer / Capacity = 15… |
| `lap overload fails.result.capacity` | 27.88 | 27.877499999999994 |
| `lap overload fails.result.steps[6].formula` | "Capacity = 10 ea × 2.788 kips = 27.880 kips, DCR = V_transfer / Capacity = 2… | "Capacity = 10 ea × 2.788 kips = 27.877 kips, DCR = V_transfer / Capacity = 2… |
| `lap screw Pnvs ASD.result.capacity` | 8.568 | 8.570554665355095 |
| `lap screw Pnvs ASD.result.steps[6].formula` | "Capacity = 14 ea × 0.612 kips = 8.568 kips, DCR = V_transfer / Capacity = 8.… | "Capacity = 14 ea × 0.612 kips = 8.571 kips, DCR = V_transfer / Capacity = 8.… |
| `lap screw Pnvs ASD.result.utilization` | 0.97 | 0.9698 |
| `lap screw no Pnvs.result.capacity` | 5.651999999999999 | 5.649840000000001 |
| `lap screw no Pnvs.result.steps[6].formula` | "Capacity = 12 ea × 0.471 kips = 5.652 kips, DCR = V_transfer / Capacity = 5.… | "Capacity = 12 ea × 0.471 kips = 5.650 kips, DCR = V_transfer / Capacity = 5.… |
| `lap screw no Pnvs.result.steps[6].value` | 0.891 | 0.892 |
| `lap screw no Pnvs.result.utilization` | 0.8912 | 0.8916 |
| `screw J4.5.1 rational.result.checks[0].ratio` | 0.3356 | 0.3353 |
| `screw J4.5.1 rational.result.checks[1].ratio` | 0.1916 | 0.1917 |
| `screw J4.5.1 rational.result.utilization_reference` | 0.3356 | 0.3353 |
| `screw no Pnvs (assumed).result.checks[0].ratio` | 0.9593 | 0.9594 |
| `screw no Pnvs (assumed).result.utilization` | 0.9593 | 0.9594 |
| `screw no Pnvs (assumed).result.utilization_reference` | 1.0296 | 1.0299 |

**§8.3.1-5 (H1 의 Pa · Max · Ta)** — 23 값

| 사례 · 키 | 전 | 후 |
|---|---|---|
| `III-11 RHS combined LRFD.result.interaction.P_ratio` | 0.7651 | 0.7652 |
| `band: H1.2 with rounded Pa/Max.result.interaction.Mx_ratio` | 0.2349 | 0.2348 |
| `band: H1.2 with rounded Pa/Max.result.interaction.P_ratio` | 0.7651 | 0.7652 |
| `band: H1.2 with rounded Pa/Max.result.interaction.pass` | true | false |
| `band: H1.2 with rounded Pa/Max.result.limit_state_checks[0].pass` | true | false |
| `band: H1.2 with rounded Pa/Max.result.pass` | true | false |
| `combined angle (P)L/1000.result.interaction.P_ratio` | 0.4559 | 0.4556 |
| `combined angle (P)L/1000.result.interaction.total` | 0.4674 | 0.4671 |
| `combined angle (P)L/1000.result.limit_state_checks[0].ratio` | 0.4674 | 0.4671 |
| `combined angle (P)L/1000.result.steps[13].value` | 0.4674 | 0.4671 |
| `combined angle (P)L/1000.result.utilization` | 0.4674 | 0.4671 |
| `combined angle (P)L/1000 fails.result.interaction.P_ratio` | 0.4559 | 0.4556 |
| `combined angle (P)L/1000 fails.result.interaction.total` | 2.0976 | 2.0973 |
| `combined angle (P)L/1000 fails.result.limit_state_checks[0].ratio` | 2.0976 | 2.0973 |
| `combined angle (P)L/1000 fails.result.steps[13].formula` | "Mux = B1x×0.00 = 0.00 kip-in (B1x = 1.0213), Muy = 1.64 kip-in; P/Pa + Mx/Ma… | "Mux = B1x×0.00 = 0.00 kip-in (B1x = 1.0213), Muy = 1.64 kip-in; P/Pa + Mx/Ma… |
| `combined angle (P)L/1000 fails.result.steps[13].value` | 2.0976 | 2.0973 |
| `combined angle (P)L/1000 fails.result.utilization` | 2.0976 | 2.0973 |
| `combined positive region fails.result.interaction.Mx_ratio` | 0.6004 | 0.6003 |
| `combined with shear and M1/M2.result.interaction.Mx_ratio` | 0.2646 | 0.2647 |
| `sharp lippedz combined (auto FSM).result.interaction.total` | 0.2282 | 0.2283 |
| `sharp lippedz combined (auto FSM).result.limit_state_checks[0].ratio` | 0.2282 | 0.2283 |
| `sharp lippedz combined (auto FSM).result.steps[14].value` | 0.2282 | 0.2283 |
| `sharp lippedz combined (auto FSM).result.utilization` | 0.2282 | 0.2283 |

**§8.3.1-6 (웹 크리플링 Pn)** — 64 값

| 사례 · 키 | 전 | 후 |
|---|---|---|
| `G5 ASD.result.h3_interaction.P_term` | 0.6556 | 0.6558 |
| `G5 ASD.result.h3_interaction.total` | 0.6644 | 0.6645 |
| `G5 ASD.result.limit_state_checks[1].ratio` | 1.2608 | 1.2611 |
| `G5 ASD.result.limit_state_checks[2].ratio` | 0.8492 | 0.8493 |
| `G5 ASD.result.steps[8].value` | 1.2608 | 1.2611 |
| `G5 ASD.result.steps[9].value` | 0.6644 | 0.6645 |
| `G5 ASD.result.utilization` | 1.2608 | 1.2611 |
| `G5 ASD.result.web_crippling.ratio` | 1.2608 | 1.2611 |
| `G5 alone governs LRFD.result.h3_interaction.P_term` | 1.4424 | 1.4427 |
| `G5 alone governs LRFD.result.h3_interaction.total` | 1.4511 | 1.4515 |
| `G5 alone governs LRFD.result.limit_state_checks[1].ratio` | 1.8647 | 1.8652 |
| `G5 alone governs LRFD.result.limit_state_checks[2].ratio` | 1.2123 | 1.2126 |
| `G5 alone governs LRFD.result.steps[8].value` | 1.8647 | 1.8652 |
| `G5 alone governs LRFD.result.steps[9].formula` | "0.91(P/Pn) + M/Mnℓo = 1.442 + 1.00/114.50 = 1.451 > 1.197" | "0.91(P/Pn) + M/Mnℓo = 1.443 + 1.00/114.50 = 1.452 > 1.197" |
| `G5 alone governs LRFD.result.steps[9].value` | 1.4511 | 1.4515 |
| `G5 alone governs LRFD.result.utilization` | 1.8647 | 1.8652 |
| `G5 alone governs LRFD.result.web_crippling.ratio` | 1.8647 | 1.8652 |
| `G5 load from Vu.result.h3_interaction.P_term` | 0.3278 | 0.3279 |
| `G5 load from Vu.result.h3_interaction.total` | 0.3365 | 0.3366 |
| `G5 load from Vu.result.limit_state_checks[2].ratio` | 0.4238 | 0.4239 |
| `G5 load from Vu.result.limit_state_checks[3].ratio` | 0.2811 | 0.2812 |
| `G5 load from Vu.result.steps[9].value` | 0.4238 | 0.4239 |
| `G5 load from Vu.result.steps[10].value` | 0.3365 | 0.3366 |
| `G5 load from Vu.result.utilization` | 0.4238 | 0.4239 |
| `G5 load from Vu.result.web_crippling.ratio` | 0.4238 | 0.4239 |
| `H3 multi-web ETF Z.result.h3_interaction.P_term` | 0.8004 | 0.8005 |
| `H3 multi-web ETF Z.result.h3_interaction.total` | 0.883 | 0.8831 |
| `H3 multi-web ETF Z.result.limit_state_checks[2].ratio` | 1.0106 | 1.0108 |
| `H3 multi-web ETF Z.result.limit_state_checks[3].ratio` | 0.672 | 0.6721 |
| `H3 multi-web ETF Z.result.steps[9].value` | 1.0106 | 1.0108 |
| `H3 multi-web ETF Z.result.steps[10].value` | 0.883 | 0.8831 |
| `H3 multi-web ETF Z.result.utilization` | 1.0106 | 1.0108 |
| `H3 multi-web ETF Z.result.web_crippling.ratio` | 1.0106 | 1.0108 |
| `H3-2 built-up I.result.steps[7].formula` | "Pn = 10.443 kips (IOF, unfastened), φw×Pn = 8.877 kips, P = 1.000 kips → P/P… | "Pn = 10.443 kips (IOF, unfastened), φw×Pn = 8.876 kips, P = 1.000 kips → P/P… |
| `H3-2 built-up I.result.web_crippling.design_strength` | 8.877 | 8.876 |
| `band: web crippling Pn rounded.result.h3_interaction.P_term` | 0.7734 | 0.7736 |
| `band: web crippling Pn rounded.result.h3_interaction.total` | 0.7822 | 0.7824 |
| `band: web crippling Pn rounded.result.limit_state_checks[1].pass` | true | false |
| `band: web crippling Pn rounded.result.limit_state_checks[1].ratio` | 0.9999 | 1.0002 |
| `band: web crippling Pn rounded.result.limit_state_checks[2].ratio` | 0.6535 | 0.6536 |
| `band: web crippling Pn rounded.result.pass` | true | false |
| `band: web crippling Pn rounded.result.steps[8].value` | 0.9999 | 1.0002 |
| `band: web crippling Pn rounded.result.steps[9].formula` | "0.91(P/Pn) + M/Mnℓo = 0.773 + 1.00/114.50 = 0.782 ≤ 1.197" | "0.91(P/Pn) + M/Mnℓo = 0.774 + 1.00/114.50 = 0.782 ≤ 1.197" |
| `band: web crippling Pn rounded.result.steps[9].value` | 0.7822 | 0.7824 |
| `band: web crippling Pn rounded.result.utilization` | 0.9999 | 1.0002 |
| `band: web crippling Pn rounded.result.web_crippling.ratio` | 0.9999 | 1.0002 |
| `flexure cold work + shear + wc.result.h3_interaction.P_term` | 0.9001 | 0.8999 |
| `flexure cold work + shear + wc.result.h3_interaction.total` | 1.0324 | 1.0323 |
| `flexure cold work + shear + wc.result.limit_state_checks[2].ratio` | 1.1637 | 1.1635 |
| `flexure cold work + shear + wc.result.limit_state_checks[3].ratio` | 0.8625 | 0.8624 |
| `flexure cold work + shear + wc.result.steps[10].formula` | "Pn = 1.011 kips (EOF, fastened), φw×Pn = 0.859 kips, P = 1.000 kips → P/Pa =… | "Pn = 1.011 kips (EOF, fastened), φw×Pn = 0.860 kips, P = 1.000 kips → P/Pa =… |
| `flexure cold work + shear + wc.result.steps[10].value` | 1.1637 | 1.1635 |
| `flexure cold work + shear + wc.result.steps[11].value` | 1.0324 | 1.0323 |
| `flexure cold work + shear + wc.result.utilization` | 1.1637 | 1.1635 |
| `flexure cold work + shear + wc.result.web_crippling.design_strength` | 0.859 | 0.86 |
| `flexure cold work + shear + wc.result.web_crippling.ratio` | 1.1637 | 1.1635 |
| `purlin support with wc.result.h3_interaction.P_term` | 0.839 | 0.8389 |
| `purlin support with wc.result.h3_interaction.total` | 1.397 | 1.3969 |
| `purlin support with wc.result.limit_state_checks[2].ratio` | 1.5213 | 1.5211 |
| `purlin support with wc.result.limit_state_checks[3].ratio` | 1.7855 | 1.7854 |
| `purlin support with wc.result.steps[9].value` | 1.5213 | 1.5211 |
| `purlin support with wc.result.steps[10].value` | 1.397 | 1.3969 |
| `purlin support with wc.result.utilization` | 1.7855 | 1.7854 |
| `purlin support with wc.result.web_crippling.ratio` | 1.5213 | 1.5211 |

**§8.3.1-7 (랩 H2 를 √ 꼴로)** — 29 값

| 사례 · 키 | 전 | 후 |
|---|---|---|
| `lap bolt Se Mnd.result.flexure_dcr_governing` | 0.6667 | 0.6966 |
| `lap bolt Se Mnd.result.steps[10].formula` | "(Mu/φMn)² + (Vu/φVn)² = (120.00/297.00)² + (4.000/7.049)² = 0.485 ≤ 1.0" | "√((Mu/φMn)² + (Vu/φVn)²) = √((120.00/297.00)² + (4.000/7.049)²) = 0.697 ≤ 1.0" |
| `lap bolt Se Mnd.result.steps[10].name` | "Lap Combined Bending+Shear (§H2)" | "Lap Combined Bending+Shear (§H2, Eq. H2-1)" |
| `lap bolt Se Mnd.result.steps[10].value` | 0.485 | 0.697 |
| `lap bolt Se e=2.result.flexure_dcr_governing` | 0.4853 | 0.6966 |
| `lap bolt Se e=2.result.steps[9].formula` | "(Mu/φMn)² + (Vu/φVn)² = (120.00/297.00)² + (4.000/7.049)² = 0.485 ≤ 1.0" | "√((Mu/φMn)² + (Vu/φVn)²) = √((120.00/297.00)² + (4.000/7.049)²) = 0.697 ≤ 1.0" |
| `lap bolt Se e=2.result.steps[9].name` | "Lap Combined Bending+Shear (§H2)" | "Lap Combined Bending+Shear (§H2, Eq. H2-1)" |
| `lap bolt Se e=2.result.steps[9].value` | 0.485 | 0.697 |
| `lap bolt short e.result.flexure_dcr_governing` | 0.4853 | 0.6966 |
| `lap bolt short e.result.steps[9].formula` | "(Mu/φMn)² + (Vu/φVn)² = (120.00/297.00)² + (4.000/7.049)² = 0.485 ≤ 1.0" | "√((Mu/φMn)² + (Vu/φVn)²) = √((120.00/297.00)² + (4.000/7.049)²) = 0.697 ≤ 1.0" |
| `lap bolt short e.result.steps[9].name` | "Lap Combined Bending+Shear (§H2)" | "Lap Combined Bending+Shear (§H2, Eq. H2-1)" |
| `lap bolt short e.result.steps[9].value` | 0.485 | 0.697 |
| `lap bolt short lap.result.flexure_dcr_governing` | 0.4853 | 0.6966 |
| `lap bolt short lap.result.steps[9].formula` | "(Mu/φMn)² + (Vu/φVn)² = (120.00/297.00)² + (4.000/7.049)² = 0.485 ≤ 1.0" | "√((Mu/φMn)² + (Vu/φVn)²) = √((120.00/297.00)² + (4.000/7.049)²) = 0.697 ≤ 1.0" |
| `lap bolt short lap.result.steps[9].name` | "Lap Combined Bending+Shear (§H2)" | "Lap Combined Bending+Shear (§H2, Eq. H2-1)" |
| `lap bolt short lap.result.steps[9].value` | 0.485 | 0.697 |
| `lap overload fails.result.flexure_dcr_governing` | 16.6469 | 4.0801 |
| `lap overload fails.result.steps[9].formula` | "(Mu/φMn)² + (Vu/φVn)² = (200.00/49.50)² + (4.000/7.049)² = 16.647 ≤ 1.0" | "√((Mu/φMn)² + (Vu/φVn)²) = √((200.00/49.50)² + (4.000/7.049)²) = 4.080 ≤ 1.0" |
| `lap overload fails.result.steps[9].name` | "Lap Combined Bending+Shear (§H2)" | "Lap Combined Bending+Shear (§H2, Eq. H2-1)" |
| `lap overload fails.result.steps[9].value` | 16.647 | 4.08 |
| `lap overload fails.result.warnings[3]` | "Lap 지점부 휨-전단 상호작용(§H2) 초과: 상호작용값 = 16.65 > 1.0." | "Lap 지점부 휨-전단 상호작용(§H2) 초과: 상호작용값 = 4.08 > 1.0." |
| `lap screw Pnvs ASD.result.flexure_dcr_governing` | 0.6484 | 0.7314 |
| `lap screw Pnvs ASD.result.steps[10].formula` | "(Mu/1/ΩMn)² + (Vu/1/ΩVn)² = (66.00/118.56)² + (2.200/4.637)² = 0.535 ≤ 1.0" | "√((Mu/1/ΩMn)² + (Vu/1/ΩVn)²) = √((66.00/118.56)² + (2.200/4.637)²) = 0.731 ≤… |
| `lap screw Pnvs ASD.result.steps[10].name` | "Lap Combined Bending+Shear (§H2)" | "Lap Combined Bending+Shear (§H2, Eq. H2-1)" |
| `lap screw Pnvs ASD.result.steps[10].value` | 0.535 | 0.731 |
| `lap screw no Pnvs.result.flexure_dcr_governing` | 0.2245 | 0.3618 |
| `lap screw no Pnvs.result.steps[9].formula` | "(Mu/φMn)² + (Vu/φVn)² = (40.00/178.20)² + (2.000/7.049)² = 0.131 ≤ 1.0" | "√((Mu/φMn)² + (Vu/φVn)²) = √((40.00/178.20)² + (2.000/7.049)²) = 0.362 ≤ 1.0" |
| `lap screw no Pnvs.result.steps[9].name` | "Lap Combined Bending+Shear (§H2)" | "Lap Combined Bending+Shear (§H2, Eq. H2-1)" |
| `lap screw no Pnvs.result.steps[9].value` | 0.131 | 0.362 |

#### §14.1 덧붙임 — 둘째 묶음에서 더한 다섯 사례의 값(V6-19)

`3590808` → `790492e` 에서 바뀐 값 가운데 위 표에 없던 15 개(§8.3.1-4, 접합부 판정을 반올림 전 설계강도로 — 비의 넷째 자리):

| 사례 · 키 | 전 | 후 |
|---|---|---|
| `arc seam sheet-to-sheet.result.checks[0].ratio` | 0.8865 | 0.8868 |
| `arc seam sheet-to-sheet.result.utilization` | 0.8865 | 0.8868 |
| `arc seam sheet-to-sheet.result.utilization_reference` | 0.8865 | 0.8868 |
| `arc spot small de.result.checks[0].ratio` | 0.5336 | 0.5337 |
| `arc spot small de.result.utilization` | 0.5336 | 0.5337 |
| `arc spot small de.result.utilization_reference` | 0.5336 | 0.5337 |
| `bolt oversized holes.result.checks[0].ratio` | 0.3946 | 0.3947 |
| `bolt oversized holes.result.utilization` | 0.3946 | 0.3947 |
| `bolt oversized holes.result.utilization_reference` | 0.3946 | 0.3947 |
| `bolt part 2 J6.2 J6.3.result.checks[0].ratio` | 0.4766 | 0.4767 |
| `bolt part 2 J6.2 J6.3.result.utilization` | 0.4766 | 0.4767 |
| `bolt part 2 J6.2 J6.3.result.utilization_reference` | 0.4766 | 0.4767 |
| `screw two in a row.result.checks[0].ratio` | 0.463 | 0.4628 |
| `screw two in a row.result.utilization` | 0.463 | 0.4628 |
| `screw two in a row.result.utilization_reference` | 0.463 | 0.4628 |

#### §14.2 V6 수정(2026-11-24)으로 바뀐 값

비교: `da93885`(수정 전) 와 수정 뒤, 계약 사례 150개. 강도(Rn · φRn · Rn/Ω · Mn · Pn …)는 하나도 바뀌지 않았다.

전체 판정이 바뀐 것은 둘뿐이다 — `lap bolt Se e=2` · `lap bolt short lap`: PASS → NOT_CHECKED (V6-07). 둘 다 Mnd 없이 랩 뒤틀림(§F4)을 '구속됐다고 가정'해 합격으로 접던 것이다 — 해당하는데 평가하지 못한 한계상태이므로 판정 없음이 옳다(FIXES §3.1). 구속을 밝히면(`distortion_restrained: true`) 전과 같이 PASS. V6-14(지배 이름)와 V6-15(아크 심 0.55d 상한 — 상한은 그대로, 단계 · 가정으로만 밝힘)는 계약 사례에서 바뀐 값이 없다. 계산 과정(`steps`)이 바뀐 항목은 189개다(V6-01 · 05 · 11 · 15 · 16 · 18 — 단계를 나누거나 입력을 더했을 뿐 결과 값은 같다; 같은 시험이 모든 단계를 다시 계산한다).

**(가) 결과의 옛 키 — 18 값** (`design_checks` · `report` 제외)

| 수정 | 사례 · 키 | 전 | 후 |
|---|---|---|---|
| V6-06 | `IV-2 arc spot V+T ASD.result.checks[2].ratio` | 0.737 | 0.8159 |
| V6-06 | `IV-2 arc spot V+T ASD.result.interaction_checks[0].ratio` | 0.737 | 0.8159 |
| V6-06 | `IV-2 arc spot V+T ASD.result.utilization` | 0.737 | 0.8159 |
| V6-06 | `IV-2 arc spot V+T LRFD.result.checks[2].ratio` | 0.9376 | 0.9579 |
| V6-06 | `IV-2 arc spot V+T LRFD.result.interaction_checks[0].ratio` | 0.9376 | 0.9579 |
| V6-06 | `IV-2 arc spot V+T LRFD.result.utilization` | 0.9376 | 0.9579 |
| V6-06 | `arc spot multi sheet.result.checks[2].ratio` | 0.6716 | 0.7669 |
| V6-06 | `arc spot multi sheet.result.interaction_checks[0].ratio` | 0.6716 | 0.7669 |
| V6-06 | `arc spot multi sheet.result.utilization` | 0.6859 | 0.7669 |
| V6-07 | `lap bolt Se e=2.result.pass` | true | null |
| V6-07 | `lap bolt Se e=2.result.verdict` | "PASS" | "NOT_CHECKED" |
| V6-07 | `lap bolt Se e=2.result.warnings[1]` | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간은 Manual II-1A 처럼 … | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간의 뒤틀림 검토를 하지 못해 판정… |
| V6-07 | `lap bolt short e.result.warnings[4]` | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간은 Manual II-1A 처럼 … | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간의 뒤틀림 검토를 하지 못해 판정… |
| V6-07 | `lap bolt short lap.result.pass` | true | null |
| V6-07 | `lap bolt short lap.result.verdict` | "PASS" | "NOT_CHECKED" |
| V6-07 | `lap bolt short lap.result.warnings[2]` | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간은 Manual II-1A 처럼 … | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간의 뒤틀림 검토를 하지 못해 판정… |
| V6-07 | `lap overload fails.result.warnings[2]` | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간은 Manual II-1A 처럼 … | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간의 뒤틀림 검토를 하지 못해 판정… |
| V6-07 | `lap screw no Pnvs.result.warnings[3]` | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간은 Manual II-1A 처럼 … | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간의 뒤틀림 검토를 하지 못해 판정… |

**(나) `design_checks` 항목의 판정 · 지배 · 비 · 강도 · 참고값 — 155 칸**, 새 항목 9개


V6-03 — 94 칸

| 사례 | id | 칸 | 전 | 후 |
|---|---|---|---|---|
| G5 no bearing load | `member.web_crippling` | governs | false | true |
| G5 no bearing load | `member.bending_web_crippling` | governs | false | true |
| I6.2.1 R exceeds table | `member.flexure.uplift_r` | governs | false | true |
| IV-10 missing member_case | `conn.bolt.bearing` | governs | true | false |
| IV-10 missing member_case | `conn.j6.tension_rupture` | governs | false | true |
| IV-4 flare bevel ASD | `conn.j6.tension_rupture` | governs | false | true |
| IV-4 flare bevel ASD | `conn.flare_groove.shear` | governs | true | false |
| IV-4 flare bevel LRFD | `conn.j6.tension_rupture` | governs | false | true |
| IV-4 flare bevel LRFD | `conn.flare_groove.shear` | governs | true | false |
| PAF thin t2 not evaluated | `conn.paf.bearing_tilting` | governs | false | true |
| PAF thin t2 not evaluated | `conn.j6.shear_rupture` | governs | true | false |
| arc spot sheet-to-sheet | `conn.detail.weld_end_distance` | governs | false | true |
| arc spot sheet-to-sheet | `conn.j6.shear_rupture` | governs | false | true |
| arc spot sheet-to-sheet | `conn.arc_spot.sheet_to_sheet` | governs | true | false |
| arc spot small de | `conn.detail.weld_end_distance` | governs | true | false |
| arc spot small de | `conn.weld.min_effective_diameter` | governs | false | true |
| bolt assumed e (not decided) | `conn.detail.bolt_end_distance` | governs | false | true |
| bolt assumed e (not decided) | `conn.bolt.bearing` | governs | true | false |
| bolt assumed e (not decided) | `conn.j6.shear_rupture` | governs | false | true |
| bolt thick (AISC scope) | `conn.scope` | governs | false | true |
| combined angle (P)L/1000 | `member.flexure.global` | governs | false | true |
| combined angle (P)L/1000 fails | `member.flexure.global` | governs | false | true |
| compression Pcrl missing (E3 not evaluated) | `member.compression.local` | governs | false | true |
| compression Pcrl missing (E3 not evaluated) | `member.compression.global` | governs | true | false |
| compression angle H1.2 required | `member.axial_bending` | governs | false | true |
| compression boundary minimum | `member.compression.local` | governs | false | true |
| compression boundary minimum | `member.compression.global` | governs | true | false |
| compression hat unsupported E2 | `member.compression.distortional` | governs | true | false |
| compression hat unsupported E2 | `member.compression.global` | governs | false | true |
| compression length missing | `member.compression.distortional` | governs | true | false |
| compression length missing | `member.compression.global` | governs | false | true |
| compression no demand | `member.compression.global` | governs | false | true |
| connection no demand | `conn.bolt.tension` | governs | false | true |
| connection no demand | `conn.j6.shear_rupture` | governs | false | true |
| fillet V and T | `conn.out_of_plane_tension` | governs | false | true |
| fillet V and T | `conn.shear_tension` | governs | false | true |
| fillet angle welded | `conn.j6.block_shear` | governs | false | true |
| fillet angle welded | `conn.fillet.sheet` | governs | true | false |
| fillet member tension no Ag | `conn.member.tension` | governs | false | true |
| fillet member tension no Ag | `conn.fillet.sheet` | governs | true | false |
| fillet thick t_joint | `conn.j6.block_shear` | governs | false | true |
| fillet thick t_joint | `conn.fillet.sheet` | governs | true | false |
| flare V transverse n/e | `conn.shear_strength` | governs | false | true |
| flare V transverse n/e | `conn.flare_groove.transverse_v` | governs | false | true |
| flexure B4 exceeded and fails | `member.applicability.b4` | governs | false | true |
| flexure Lb missing | `member.flexure.distortional` | governs | true | false |
| flexure Lb missing | `member.flexure.local` | governs | false | true |
| flexure Mcrd missing (F4 not evaluated) | `member.flexure.distortional` | governs | false | true |
| flexure Mcrd missing (F4 not evaluated) | `member.flexure.local` | governs | true | false |
| flexure Mcrl missing | `member.flexure.global` | governs | true | false |
| flexure Mcrl missing | `member.flexure.local` | governs | false | true |
| flexure hat negative sign | `member.flexure.global` | governs | true | false |
| flexure hat negative sign | `member.flexure.local` | governs | false | true |
| flexure unrestrained reference | `member.flexure.global` | governs | true | false |
| flexure unrestrained reference | `member.flexure.distortional` | governs | false | true |
| groove PJP no te | `conn.shear_strength` | governs | false | true |
| groove PJP no te | `conn.groove.tension_compression` | governs | false | true |
| lap bolt Se Mnd | `fastener_design/conn.bolt.tension` | governs | false | true |
| lap bolt Se Mnd | `fastener_design/conn.bolt.bearing` | governs | false | true |
| lap bolt Se e=2 | `lap.flexure.distortional` | governs | false | true |
| lap bolt Se e=2 | `lap.bending_shear` | governs | true | false |
| lap bolt Se e=2 | `fastener_design/conn.bolt.tension` | governs | false | true |
| lap bolt Se e=2 | `fastener_design/conn.bolt.bearing` | governs | false | true |
| lap bolt Sf only | `lap.flexure.local` | governs | false | true |
| lap bolt Sf only | `fastener_design/conn.bolt.tension` | governs | false | true |
| lap bolt Sf only | `fastener_design/conn.bolt.bearing` | governs | false | true |
| lap bolt no Se | `lap.flexure.local` | governs | false | true |
| lap bolt no Se | `fastener_design/conn.j6.shear_rupture` | governs | false | true |
| lap bolt no Se | `fastener_design/conn.bolt.tension` | governs | false | true |
| lap bolt short e | `fastener_design/conn.j6.shear_rupture` | governs | false | true |
| lap bolt short e | `lap.flexure.distortional` | governs | false | true |
| lap bolt short e | `lap.bending_shear` | governs | true | false |
| lap bolt short e | `fastener_design/conn.bolt.tension` | governs | false | true |
| lap bolt short lap | `lap.flexure.distortional` | governs | false | true |
| lap bolt short lap | `lap.bending_shear` | governs | true | false |
| lap bolt short lap | `fastener_design/conn.bolt.tension` | governs | false | true |
| lap bolt short lap | `fastener_design/conn.bolt.bearing` | governs | false | true |
| lap overload fails | `fastener_design/conn.bolt.tension` | governs | false | true |
| lap overload fails | `fastener_design/conn.bolt.bearing` | governs | false | true |
| lap screw Pnvs ASD | `fastener_design/conn.screw.bearing_tilting` | governs | false | true |
| lap screw Pnvs ASD | `fastener_design/conn.screw.pullout` | governs | false | true |
| lap screw no Pnvs | `lap.fastener_group` | governs | false | true |
| lap screw no Pnvs | `fastener_design/conn.j6.shear_rupture` | governs | false | true |
| lap screw no Pnvs | `lap.fastener_count` | governs | true | false |
| lap screw no Pnvs | `lap.flexure.distortional` | governs | false | true |
| lap screw no Pnvs | `fastener_design/conn.screw.pullout` | governs | false | true |
| lap screw no Pnvs | `lap.bending_shear` | governs | true | false |
| positive region Lb_pos missing | `member.flexure.positive_region` | governs | false | true |
| screw no Pnvs (assumed) | `conn.screw.bearing_tilting` | governs | true | false |
| screw no Pnvs (assumed) | `conn.screw.shear` | governs | false | true |
| screw out of scope d | `conn.scope` | governs | false | true |
| tension no Fu | `member.tension.rupture` | governs | false | true |
| tension no Fu | `member.tension.yielding` | governs | true | false |
| tension no demand | `member.tension.rupture` | governs | false | true |

V6-04 — 50 칸

| 사례 | id | 칸 | 전 | 후 |
|---|---|---|---|---|
| bolt thick (AISC scope) | `conn.detail.bolt_end_distance` | verdict | "pass" | "not_evaluated" |
| bolt thick (AISC scope) | `conn.detail.bolt_end_distance` | ratio | 0.75 | null |
| bolt thick (AISC scope) | `conn.detail.bolt_end_distance` | capacity | 1.0 | null |
| bolt thick (AISC scope) | `conn.detail.bolt_end_distance` | reference.ratio | null | 0.75 |
| bolt thick (AISC scope) | `conn.detail.bolt_end_distance` | reference.capacity | null | 1.0 |
| bolt thick (AISC scope) | `conn.j6.block_shear` | verdict | "pass" | "not_evaluated" |
| bolt thick (AISC scope) | `conn.j6.block_shear` | ratio | 0.08579710144927537 | null |
| bolt thick (AISC scope) | `conn.j6.block_shear` | capacity | 11.655405405405405 | null |
| bolt thick (AISC scope) | `conn.j6.block_shear` | reference.ratio | null | 0.08579710144927537 |
| bolt thick (AISC scope) | `conn.j6.block_shear` | reference.capacity | null | 11.655405405405405 |
| bolt thick (AISC scope) | `conn.j6.tension_rupture` | verdict | "pass" | "not_evaluated" |
| bolt thick (AISC scope) | `conn.j6.tension_rupture` | ratio | 0.38438438438438444 | null |
| bolt thick (AISC scope) | `conn.j6.tension_rupture` | capacity | 2.6015624999999996 | null |
| bolt thick (AISC scope) | `conn.j6.tension_rupture` | reference.ratio | null | 0.38438438438438444 |
| bolt thick (AISC scope) | `conn.j6.tension_rupture` | reference.capacity | null | 2.6015624999999996 |
| bolt thick (AISC scope) | `conn.j6.shear_rupture` | verdict | "pass" | "not_evaluated" |
| bolt thick (AISC scope) | `conn.j6.shear_rupture` | ratio | 0.1143961352657005 | null |
| bolt thick (AISC scope) | `conn.j6.shear_rupture` | capacity | 8.741554054054053 | null |
| bolt thick (AISC scope) | `conn.j6.shear_rupture` | reference.ratio | null | 0.1143961352657005 |
| bolt thick (AISC scope) | `conn.j6.shear_rupture` | reference.capacity | null | 8.741554054054053 |
| bolt thick (AISC scope) | `conn.bolt.shear` | verdict | "pass" | "not_evaluated" |
| bolt thick (AISC scope) | `conn.bolt.shear` | ratio | 0.1886280807015056 | null |
| bolt thick (AISC scope) | `conn.bolt.shear` | capacity | 5.301437602932776 | null |
| bolt thick (AISC scope) | `conn.bolt.shear` | reference.ratio | null | 0.1886280807015056 |
| bolt thick (AISC scope) | `conn.bolt.shear` | reference.capacity | null | 5.301437602932776 |
| bolt thick (AISC scope) | `conn.detail.bolt_spacing` | verdict | "pass" | "not_evaluated" |
| bolt thick (AISC scope) | `conn.detail.bolt_spacing` | ratio | 0.75 | null |
| bolt thick (AISC scope) | `conn.detail.bolt_spacing` | capacity | 2.0 | null |
| bolt thick (AISC scope) | `conn.detail.bolt_spacing` | reference.ratio | null | 0.75 |
| bolt thick (AISC scope) | `conn.detail.bolt_spacing` | reference.capacity | null | 2.0 |
| bolt thick (AISC scope) | `conn.detail.bolt_edge_distance` | verdict | "pass" | "not_evaluated" |
| bolt thick (AISC scope) | `conn.detail.bolt_edge_distance` | ratio | 0.75 | null |
| bolt thick (AISC scope) | `conn.detail.bolt_edge_distance` | capacity | 1.0 | null |
| bolt thick (AISC scope) | `conn.detail.bolt_edge_distance` | reference.ratio | null | 0.75 |
| bolt thick (AISC scope) | `conn.detail.bolt_edge_distance` | reference.capacity | null | 1.0 |
| screw out of scope d | `conn.screw.bearing_tilting` | verdict | "pass" | "not_evaluated" |
| screw out of scope d | `conn.screw.bearing_tilting` | ratio | 0.09352104037109665 | null |
| screw out of scope d | `conn.screw.bearing_tilting` | capacity | 1.0692780961716688 | null |
| screw out of scope d | `conn.screw.bearing_tilting` | reference.ratio | null | 0.09352104037109665 |
| screw out of scope d | `conn.screw.bearing_tilting` | reference.capacity | null | 1.0692780961716688 |
| screw out of scope d | `conn.screw.shear` | verdict | "pass" | "not_evaluated" |
| screw out of scope d | `conn.screw.shear` | ratio | 0.04 | null |
| screw out of scope d | `conn.screw.shear` | capacity | 2.5 | null |
| screw out of scope d | `conn.screw.shear` | reference.ratio | null | 0.04 |
| screw out of scope d | `conn.screw.shear` | reference.capacity | null | 2.5 |
| screw out of scope d | `conn.detail.screw_end_distance` | verdict | "pass" | "not_evaluated" |
| screw out of scope d | `conn.detail.screw_end_distance` | ratio | 0.5625 | null |
| screw out of scope d | `conn.detail.screw_end_distance` | capacity | 1.0 | null |
| screw out of scope d | `conn.detail.screw_end_distance` | reference.ratio | null | 0.5625 |
| screw out of scope d | `conn.detail.screw_end_distance` | reference.capacity | null | 1.0 |

V6-06 — 3 칸

| 사례 | id | 칸 | 전 | 후 |
|---|---|---|---|---|
| IV-2 arc spot V+T ASD | `conn.arc_spot.shear_tension` | ratio | 0.7369623024687388 | 0.81588731706661 |
| IV-2 arc spot V+T LRFD | `conn.arc_spot.shear_tension` | ratio | 0.9375652155637353 | 0.9579312124672654 |
| arc spot multi sheet | `conn.arc_spot.shear_tension` | ratio | 0.6715612549328899 | 0.7668735425007214 |

V6-07 — 5 칸

| 사례 | id | 칸 | 전 | 후 |
|---|---|---|---|---|
| lap bolt Se e=2 | `lap.flexure.distortional` | verdict | "not_applicable" | "not_evaluated" |
| lap bolt short e | `lap.flexure.distortional` | verdict | "not_applicable" | "not_evaluated" |
| lap bolt short lap | `lap.flexure.distortional` | verdict | "not_applicable" | "not_evaluated" |
| lap overload fails | `lap.flexure.distortional` | verdict | "not_applicable" | "not_evaluated" |
| lap screw no Pnvs | `lap.flexure.distortional` | verdict | "not_applicable" | "not_evaluated" |

V6-20 — 3 칸

| 사례 | id | 칸 | 전 | 후 |
|---|---|---|---|---|
| I6.2.1 R exceeds table | `member.flexure.distortional` | verdict | "not_applicable" | "not_evaluated" |
| I6.2.1 R exceeds table | `member.flexure.local` | verdict | "not_applicable" | "not_evaluated" |
| I6.2.1 R exceeds table | `member.flexure.global` | verdict | "not_applicable" | "not_evaluated" |

새 항목(S-1): lap bolt Se Mnd → `lap.block_shear` (not_evaluated), lap bolt Se e=2 → `lap.block_shear` (not_evaluated), lap bolt Sf only → `lap.block_shear` (not_evaluated), lap bolt no Se → `lap.block_shear` (not_evaluated), lap bolt short e → `lap.block_shear` (not_evaluated), lap bolt short lap → `lap.block_shear` (not_evaluated), lap overload fails → `lap.block_shear` (not_evaluated), lap screw Pnvs ASD → `lap.block_shear` (not_evaluated), lap screw no Pnvs → `lap.block_shear` (not_evaluated)

#### §14.2 덧붙임 — 빠졌던 6 칸(V6b-09)

V6-04 로 범위 밖이 된 항목의 `nominal` 이 값 → `null` (값은 `reference.capacity` 와 계산 과정에 남음):

| 사례 | id | 칸 | 전 | 후 |
|---|---|---|---|---|
| bolt thick (AISC scope) | `conn.bolt.shear` | nominal | 10.602875205865551 | null |
| bolt thick (AISC scope) | `conn.j6.shear_rupture` | nominal | 19.40625 | null |
| bolt thick (AISC scope) | `conn.j6.tension_rupture` | nominal | 5.775468749999999 | null |
| bolt thick (AISC scope) | `conn.j6.block_shear` | nominal | 25.875 | null |
| screw out of scope d | `conn.screw.bearing_tilting` | nominal | 2.1385561923433376 | null |
| screw out of scope d | `conn.screw.shear` | nominal | 5.0 | null |

#### §14.3 재검증 V6b 수정(2026-11-24)으로 바뀐 값

비교: `b8c9187` 의 엔진과 수정 뒤, 계약 사례 150개(새로 더한 4 사례는 비교 밖). 옛 키 26 값, `design_checks` 35 칸. 전체 판정이 바뀐 사례는 없다. 강도가 바뀐 것은 Cm(V6b-02) 하나 — `combined with shear and M1/M2` 의 H1.2 0.5563 → 0.5658(dist_M1_M2 = 0.5 로 Cmx · Cmy 를 0.4 로 낮추던 것이 1.0). 랩 J6.3 은 새로 평가한 항목이다(랩 판정은 이 사례들에서 그대로; `lap overload fails` 는 이미 불합격이고 J6.3 이 1.047 로 지배). 하중 해석(8 사례, 값 51,654 개)의 옛 키 변화 0 — `envelope_source` 21 칸만 동률 규칙(허용오차)으로 바뀌었다.

**(가) 옛 키**

| 사례 · 키 | 전 | 후 |
|---|---|---|
| `combined with shear and M1/M2.result.assumptions` | 0 | 3 |
| `combined with shear and M1/M2.result.interaction.Mx_ratio` | 0.2647 | 0.2671 |
| `combined with shear and M1/M2.result.interaction.My_ratio` | 0.2 | 0.207 |
| `combined with shear and M1/M2.result.interaction.total` | 0.5563 | 0.5658 |
| `combined with shear and M1/M2.result.limit_state_checks[0].ratio` | 0.5563 | 0.5658 |
| `combined with shear and M1/M2.result.spec_sections` | 9 | 10 |
| `combined with shear and M1/M2.result.steps[15].formula` | "Mux = B1x×30.00 = 30.00 kip-in (B1x = 1.0000), Muy = 2.00 kip-in; P/… | "Mux = B1x×30.00 = 30.28 kip-in (B1x = 1.0093), Muy = 2.07 kip-in; P/… |
| `combined with shear and M1/M2.result.steps[15].value` | 0.5563 | 0.5658 |
| `combined with shear and M1/M2.result.utilization` | 0.5563 | 0.5658 |
| `lap bolt Se Mnd.result.scope_notes[0]` | "J6.3: J6.3 block shear rupture of the lap fastener group (shear plan… | "J6.3: J6.3 block shear of the lap fastener group is evaluated as a l… |
| `lap bolt Se Mnd.result.steps` | 11 | 12 |
| `lap bolt Se e=2.result.scope_notes[0]` | "J6.3: J6.3 block shear rupture of the lap fastener group (shear plan… | "J6.3: J6.3 block shear of the lap fastener group is evaluated as a l… |
| `lap bolt Se e=2.result.steps` | 10 | 11 |
| `lap bolt Sf only.result.scope_notes[0]` | "J6.3: J6.3 block shear rupture of the lap fastener group (shear plan… | "J6.3: J6.3 block shear of the lap fastener group is evaluated as a l… |
| `lap bolt Sf only.result.steps` | 9 | 10 |
| `lap bolt no Se.result.scope_notes[0]` | "J6.3: J6.3 block shear rupture of the lap fastener group (shear plan… | "J6.3: J6.3 block shear of the lap fastener group is evaluated as a l… |
| `lap bolt no Se.result.steps` | 8 | 9 |
| `lap bolt short e.result.scope_notes[0]` | "J6.3: J6.3 block shear rupture of the lap fastener group (shear plan… | "J6.3: J6.3 block shear of the lap fastener group is evaluated as a l… |
| `lap bolt short e.result.steps` | 10 | 11 |
| `lap bolt short lap.result.scope_notes[0]` | "J6.3: J6.3 block shear rupture of the lap fastener group (shear plan… | "J6.3: J6.3 block shear of the lap fastener group is evaluated as a l… |
| `lap bolt short lap.result.steps` | 10 | 11 |
| `lap overload fails.result.scope_notes[0]` | "J6.3: J6.3 block shear rupture of the lap fastener group (shear plan… | "J6.3: J6.3 block shear of the lap fastener group is evaluated as a l… |
| `lap overload fails.result.steps` | 10 | 11 |
| `lap overload fails.result.warnings` | 4 | 5 |
| `lap screw Pnvs ASD.result.scope_notes[0]` | "J6.3: J6.3 block shear rupture of the lap fastener group (shear plan… | "J6.3: J6.3 block shear of the lap fastener group is evaluated as a l… |
| `lap screw no Pnvs.result.scope_notes[0]` | "J6.3: J6.3 block shear rupture of the lap fastener group (shear plan… | "J6.3: J6.3 block shear of the lap fastener group is evaluated as a l… |

**(나) `design_checks`**

| 사례 | id | 칸 | 전 | 후 |
|---|---|---|---|---|
| combined with shear and M1/M2 | `member.axial_bending` | ratio | 0.5563286175451037 | 0.5658336897467583 |
| lap bolt Se Mnd | `lap.block_shear` | verdict | "not_evaluated" | "pass" |
| lap bolt Se Mnd | `lap.block_shear` | ratio | null | 0.5970308135215001 |
| lap bolt Se Mnd | `lap.block_shear` | counts | false | true |
| lap bolt Se Mnd | `lap.block_shear` | capacity | null | 25.311 |
| lap bolt Se e=2 | `lap.block_shear` | verdict | "not_evaluated" | "pass" |
| lap bolt Se e=2 | `lap.block_shear` | ratio | null | 0.5970308135215001 |
| lap bolt Se e=2 | `lap.block_shear` | counts | false | true |
| lap bolt Se e=2 | `lap.block_shear` | capacity | null | 25.311 |
| lap bolt Sf only | `lap.block_shear` | verdict | "not_evaluated" | "pass" |
| lap bolt Sf only | `lap.block_shear` | ratio | null | 0.5970308135215001 |
| lap bolt Sf only | `lap.block_shear` | counts | false | true |
| lap bolt Sf only | `lap.block_shear` | capacity | null | 25.311 |
| lap bolt no Se | `lap.block_shear` | verdict | "not_evaluated" | "pass" |
| lap bolt no Se | `lap.block_shear` | ratio | null | 0.5751364158718337 |
| lap bolt no Se | `lap.block_shear` | counts | false | true |
| lap bolt no Se | `lap.block_shear` | capacity | null | 26.27454375 |
| lap bolt short e | `lap.block_shear` | verdict | "not_evaluated" | "pass" |
| lap bolt short e | `lap.block_shear` | ratio | null | 0.6442515216418394 |
| lap bolt short e | `lap.block_shear` | counts | false | true |
| lap bolt short e | `lap.block_shear` | capacity | null | 23.455818750000002 |
| lap bolt short lap | `lap.block_shear` | verdict | "not_evaluated" | "pass" |
| lap bolt short lap | `lap.block_shear` | ratio | null | 0.7462885169018753 |
| lap bolt short lap | `lap.block_shear` | counts | false | true |
| lap bolt short lap | `lap.block_shear` | capacity | null | 20.2488 |
| lap overload fails | `lap.fastener_group` | governs | true | false |
| lap overload fails | `lap.block_shear` | verdict | "not_evaluated" | "fail" |
| lap overload fails | `lap.block_shear` | governs | false | true |
| lap overload fails | `lap.block_shear` | ratio | null | 1.0467964054571033 |
| lap overload fails | `lap.block_shear` | counts | false | true |
| lap overload fails | `lap.block_shear` | capacity | null | 24.05983125 |
| lap screw Pnvs ASD | `lap.block_shear` | verdict | "not_evaluated" | "not_applicable" |
| lap screw Pnvs ASD | `lap.block_shear` | counts | false | true |
| lap screw no Pnvs | `lap.block_shear` | verdict | "not_evaluated" | "not_applicable" |
| lap screw no Pnvs | `lap.block_shear` | counts | false | true |

#### §14.4 랩 구속 한 진술 · 앵글 L 가정(2026-11-24 셋째 묶음)으로 바뀐 값

비교: `699e133` 의 엔진과 수정 뒤, 계약 사례 154개. 옛 키 25 값, `design_checks` 52 칸. 강도는 바뀌지 않았다. 전체 판정이 바뀐 것: `lap bolt Se Mnd` · `lap screw Pnvs ASD` PASS → NOT_CHECKED — 랩 휨 Mnℓ = Se·Fy(Fn = Fy)가 Manual 의 랩 구속 가정에 서는데 `lap_restrained` 진술이 없다(계약 §6.3). 진술을 주면 전과 같다. 앵글 두 사례는 `assumptions` 에 (P)L/1000 의 L = KyLy 한 줄이 더해졌다.

| 사례 · 키 | 전 | 후 |
|---|---|---|
| `combined angle (P)L/1000.result.assumptions` | 1 | 2 |
| `combined angle (P)L/1000 fails.result.assumptions` | 1 | 2 |
| `lap bolt Se Mnd.result.flexure_checked` | true | false |
| `lap bolt Se Mnd.result.pass` | true | null |
| `lap bolt Se Mnd.result.steps[8].pass` | true | null |
| `lap bolt Se Mnd.result.verdict` | "PASS" | "NOT_CHECKED" |
| `lap bolt Se Mnd.result.warnings` | 1 | 3 |
| `lap bolt Se e=2.result.steps[8].pass` | true | null |
| `lap bolt Se e=2.result.warnings` | 2 | 4 |
| `lap bolt short e.result.steps[8].pass` | true | null |
| `lap bolt short e.result.warnings` | 6 | 8 |
| `lap bolt short lap.result.steps[8].pass` | true | null |
| `lap bolt short lap.result.warnings` | 4 | 6 |
| `lap overload fails.result.warnings[2]` | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간의 뒤틀림 검토를 하지 못해 판정… | "뒤틀림좌굴(§F4) 강도 Mnd(또는 Mcrd)가 미입력 — Lap 구간의 뒤틀림 검토를 하지 못해 판정… |
| `lap screw Pnvs ASD.result.flexure_checked` | true | false |
| `lap screw Pnvs ASD.result.pass` | true | null |
| `lap screw Pnvs ASD.result.steps[8].pass` | true | null |
| `lap screw Pnvs ASD.result.verdict` | "PASS" | "NOT_CHECKED" |
| `lap screw Pnvs ASD.result.warnings` | 1 | 3 |
| `lap screw no Pnvs.result.steps[8].pass` | true | null |
| `lap screw no Pnvs.result.warnings` | 4 | 6 |
| `purlin lap region stated.result.assumptions[0]` | "F4 distortional buckling not applicable in this lap region… | "Lap region: lap_restrained = true (user statement) — AISI … |
| `purlin lap region stated.result.steps[3].equation` | "N/A (F4 not applicable: lap region — distortion_restrained… | "N/A (F4 not applicable: lap region — lap_restrained = true… |
| `purlin lap region stated.result.steps[3].formula` | "N/A (F4 not applicable: lap region — distortion_restrained… | "N/A (F4 not applicable: lap region — lap_restrained = true… |
| `purlin lap region unstated.result.not_evaluated` | 1 | 2 |

| 사례 | id | 칸 | 전 | 후 |
|---|---|---|---|---|
| lap bolt Se Mnd | `lap.flexure.local` | verdict | "pass" | "not_evaluated" |
| lap bolt Se Mnd | `lap.flexure.local` | governs | false | true |
| lap bolt Se Mnd | `lap.flexure.local` | ratio | 0.40404040404040403 | null |
| lap bolt Se Mnd | `lap.flexure.local` | capacity | 297.0 | null |
| lap bolt Se Mnd | `lap.flexure.local` | reference.ratio | null | 0.40404040404040403 |
| lap bolt Se Mnd | `lap.flexure.local` | reference.capacity | null | 297.0 |
| lap bolt Se Mnd | `lap.bending_shear` | governs | true | false |
| lap bolt Se e=2 | `lap.flexure.local` | verdict | "pass" | "not_evaluated" |
| lap bolt Se e=2 | `lap.flexure.local` | governs | false | true |
| lap bolt Se e=2 | `lap.flexure.local` | ratio | 0.40404040404040403 | null |
| lap bolt Se e=2 | `lap.flexure.local` | capacity | 297.0 | null |
| lap bolt Se e=2 | `lap.flexure.local` | reference.ratio | null | 0.40404040404040403 |
| lap bolt Se e=2 | `lap.flexure.local` | reference.capacity | null | 297.0 |
| lap bolt Se e=2 | `lap.flexure.distortional` | governs | true | false |
| lap bolt short e | `lap.flexure.local` | verdict | "pass" | "not_evaluated" |
| lap bolt short e | `lap.flexure.local` | governs | false | true |
| lap bolt short e | `lap.flexure.local` | ratio | 0.40404040404040403 | null |
| lap bolt short e | `lap.flexure.local` | capacity | 297.0 | null |
| lap bolt short e | `lap.flexure.local` | reference.ratio | null | 0.40404040404040403 |
| lap bolt short e | `lap.flexure.local` | reference.capacity | null | 297.0 |
| lap bolt short e | `lap.flexure.distortional` | governs | true | false |
| lap bolt short lap | `lap.flexure.local` | verdict | "pass" | "not_evaluated" |
| lap bolt short lap | `lap.flexure.local` | governs | false | true |
| lap bolt short lap | `lap.flexure.local` | ratio | 0.40404040404040403 | null |
| lap bolt short lap | `lap.flexure.local` | capacity | 297.0 | null |
| lap bolt short lap | `lap.flexure.local` | reference.ratio | null | 0.40404040404040403 |
| lap bolt short lap | `lap.flexure.local` | reference.capacity | null | 297.0 |
| lap bolt short lap | `lap.flexure.distortional` | governs | true | false |
| lap screw Pnvs ASD | `lap.flexure.local` | verdict | "pass" | "not_evaluated" |
| lap screw Pnvs ASD | `lap.flexure.local` | governs | false | true |
| lap screw Pnvs ASD | `lap.flexure.local` | ratio | 0.5566666666666666 | null |
| lap screw Pnvs ASD | `lap.flexure.local` | capacity | 118.562874251497 | null |
| lap screw Pnvs ASD | `lap.flexure.local` | reference.ratio | null | 0.5566666666666666 |
| lap screw Pnvs ASD | `lap.flexure.local` | reference.capacity | null | 118.562874251497 |
| lap screw Pnvs ASD | `lap.bending_shear` | governs | true | false |
| lap screw no Pnvs | `lap.flexure.local` | verdict | "pass" | "not_evaluated" |
| lap screw no Pnvs | `lap.flexure.local` | governs | false | true |
| lap screw no Pnvs | `lap.flexure.local` | ratio | 0.22446689113355778 | null |
| lap screw no Pnvs | `lap.flexure.local` | capacity | 178.20000000000002 | null |
| lap screw no Pnvs | `lap.flexure.local` | reference.ratio | null | 0.22446689113355778 |
| lap screw no Pnvs | `lap.flexure.local` | reference.capacity | null | 178.20000000000002 |
| lap screw no Pnvs | `lap.flexure.distortional` | governs | true | false |
| purlin lap region unstated | `member.flexure.local` | verdict | "pass" | "not_evaluated" |
| purlin lap region unstated | `member.flexure.local` | ratio | 0.6406113376381318 | null |
| purlin lap region unstated | `member.flexure.local` | capacity | 51.51329372606425 | null |
| purlin lap region unstated | `member.flexure.local` | reference.ratio | null | 0.6406113376381318 |
| purlin lap region unstated | `member.flexure.local` | reference.capacity | null | 51.51329372606425 |
| purlin lap region unstated | `member.flexure.global` | verdict | "pass" | "not_evaluated" |
| purlin lap region unstated | `member.flexure.global` | ratio | 0.5164948453608247 | null |
| purlin lap region unstated | `member.flexure.global` | capacity | 63.89221556886228 | null |
| purlin lap region unstated | `member.flexure.global` | reference.ratio | null | 0.5164948453608247 |
| purlin lap region unstated | `member.flexure.global` | reference.capacity | null | 63.89221556886228 |

#### §14.5 재확인 V8 수정(2026-11-24: 랩 도구 · 스레드 고정)으로 바뀐 값

비교: `beb742f` 의 엔진(기본 스레드 — 이 PC 32 코어)과 수정 뒤, 계약 사례 154개, 비교한 값 131,271개, 다른 값 99개. 판정 · 4자리 표시값 · 반올림한 옛 키는 랩의 `utilization` 둘 말고는 바뀌지 않았다. 새 키(바뀐 값 아님): 랩 결과의 `fastener_utilization` · `governing_check`, `selftest` 의 `numeric_threads`.

랩 도구(V8-01) — 맨 위 `utilization` 이 랩 강도 항목의 지배 비로(§6.3):

| 사례 | 키 | 전 | 후 |
|---|---|---|---|
| lap overload fails | `utilization` | 0.9034 (패스너 무리) | 4.0801 (`lap.bending_shear`, 불합격) |
| lap screw no Pnvs | `utilization` | 0.8916 (패스너 무리 — 가정값 강도라 `not_evaluated`) | 0.3618 (판정을 낸 강도 항목의 최대) |
| 랩 9 사례 전부 | `design_checks[lap.fastener_group].mirrors.ratio.path` | `utilization` | `fastener_utilization` |

옛 `utilization` 값은 9 사례 모두 `fastener_utilization` 에 그대로 있다.

스레드 고정(V8-04) — FSM 에서 온 반올림하지 않은 값(`design_checks` 의 단계 입력 · 결과 · 비)만, 잡음 수준:

| 사례 | 다른 값 | 최대 상대 차 |
|---|---|---|
| I-8B lippedc ASD flexure (auto FSM) | 28 | 1.2e-10 (Mcrd 107.94197623729539 → 107.94197625024616, 비 0.018000798504046 → 0.018000798503243) |
| default lippedc compression (auto FSM) | 20 | 1.3e-13 |
| flexure hat negative sign | 14 | 1.7e-14 |
| rounded-corner lippedc KL100 (auto FSM) | 14 | 8.1e-15 |
| default lippedc flexure (auto FSM) | 12 | 8.0e-12 |

새 값은 스레드 1 의 값이다(전에도 `OPENBLAS_NUM_THREADS=1` 로 돌리면 이 값이었다). 기준선 파일을 다른 코어 수의 PC 에서 다시 만들면 같은 값이 나와야 한다 — 다른 CPU 에서는 §6.1 의 「보장하지 않는 것」.

## 15. 엔진 식별 `engine_id` (2026-11-24)

`selftest` 응답의 `engine_id` — 결과를 낸 엔진의 소스 전부의 해시. 저장한 결과(.csd)가 지금 엔진의 것인지 가르는 데 쓴다(손으로 올리는 번호는 잊힌다).

- 형식: `"sha256:" + 64자리 소문자 16진수`. 읽지 못하면 **`"unknown"`**(그때만 `engine_id_error` 에 까닭) — 일부 파일만으로 만든 해시는 내지 않는다. `"unknown"` 은 어떤 id 와도 같지 않은 것으로 다룬다.
- 대상: `python/` 아래 `engine/ design/ cfsm/ fcfsm/ vibration/ plastic/ fileio/ models/` 의 모든 `.py`(하위 폴더 포함, `__pycache__` · `test_*.py` · `test`/`tests` 폴더 제외)와 `server.py` · `numeric_threads.py`(2026-11-24 V8-04 — 스레드 고정도 결과를 정한다). 폴더가 없거나 그 안에 `.py` 가 하나도 없으면(컴파일만 한 배치) `"unknown"`.
- 계산: `"engine-id/2\n"`, 그다음 **결과가 기대는 실행 환경** — `python` = major.minor, `numpy` · `scipy` 의 `__version__`(scipy 가 없으면 `absent`) — 을 키 순서로 `key=value\n`, 그다음 상대 경로('/' 구분)로 정렬한 파일마다 (경로 길이 4바이트 · 경로 UTF-8 · 내용 길이 8바이트 · 내용). 내용은 CRLF → LF 로 맞춘다 — CRLF 로 꺼낸 저장소와 LF 로 꺼낸 저장소가 같은 id 다.
- 같은 id · 같은 PC 면 같은 입력이 같은 바이트다(스레드 고정, §6.1). PC 가 다르면 FSM 값의 끝자리가 다를 수 있다 — 국부 · 뒤틀림 상대 1e-9, 긴 반파장의 전체좌굴 상대 1e-5(§6.1 의 측정). 기록이 「이 결과는 기록한 실행과 같다」를 PC 사이에서 말할 때는 지문이 아니라 이 허용차로 견줘야 한다.
- 왜 판까지(2026-11-24): 설치 프로그램의 런타임은 판을 고정하지만 개발 환경은 바뀔 수 있다(고유값 · 선형대수 결과의 끝자리). 판이 바뀐 환경에서 저장한 결과를 '지금 엔진의 것'으로 되살리지 않게 한다. `selftest` 는 해시한 그 판을 `engine_runtime: {python, numpy, scipy}` 로도 돌려준다.
- 파일 하나가 없어진 트리는 다른 id 가 된다 — 의도한 동작이다(다른 트리는 다른 엔진; 저장한 결과가 '지금 것'으로 되살아나지 않는 쪽). 빠진 모듈은 보통 `selftest` 의 `import_errors` 로도 드러난다.
- 서버를 띄울 때 한 번 계산한다(54 파일, 약 12 ms). 같은 소스면 실행 · 기계와 무관하게 같고, 한 바이트라도(또는 파일 이름이) 바뀌면 다르다. 시험: `test_review_1124_engine_id.py`.

## 16. 알림 — code · 한국어 · 물리량 붙은 매개변수 (2026-11-24 K4b)

엔진이 내는 **경고 · 가정 · 범위 · 미평가 · 이유** 글마다 바뀌지 않는 `code`, 한국어 글, 그리고 글 안의 숫자를 `quantity` 가 붙은 값으로 싣는다. **옛 키와 옛 글은 바이트까지 그대로다** — 새 키만 더해진다.

### 16.1 등록표 `design.notice_registry.REGISTRY` (만드는 도구 `design.notices`)

| 필드 | 뜻 |
|---|---|
| code | 점으로 이은 소문자 `영역.종류.이름` (예: `lap.warning.mnd_not_used_lap_restrained`). **바꾸지도, 다시 쓰지도, 번호를 다시 매기지도 않는다.** 글을 고치면 같은 code 로 템플릿을 고치고, 뜻이 바뀌면 새 code |
| kind | `warning` · `assumption` · `scope` · `not_evaluated` · `reason` · `fragment` (fragment: 다른 알림의 매개변수로만 쓰는 글 조각 — 'in-plane shear' · 'The result is discarded.' 같은) |
| template | 옛 글을 그대로 그리는 템플릿 — 옛 글이 한국어였으면 한국어다(§16.8) |
| template_ko | 한국어 템플릿. 모든 code 에 있다 |
| params | 자리표마다 `{quantity, conv, spec, unit, sep}` — `quantity` 는 §3.2 어휘 또는 `None`(글 매개변수 · 어휘에 없는 물리량) |

엔진 코드는 알림을 `_nt('code', name=value, …)`(= `design.notices.N`)로 만든다. 돌려주는 것은 `str` 의 하위형 `Notice` 라서 옛 목록에 들어가는 글은 전과 같고, code 와 매개변수 값이 함께 다닌다. 하위 결과를 옮길 때의 머리('[압축] ', 'G5: ', 'Tension Rupture (J6.2): ')는 `prefixed`, 이유를 '; ' 로 잇는 것은 `joined` — 둘 다 글을 바꾸지 않는다.

### 16.2 결과에 붙는 것

**`notices`** — 옛 목록 `warnings` · `assumptions` · `scope_notes` · `not_evaluated` 를 이 순서로 한 줄씩 옮긴 목록(옛 글과 하나씩 맞는다; 접합부 `not_evaluated` 의 `{name, reason}` 항목은 그 reason 을 싣고 `subject` 에 name). 붙는 결과: 부재 `design_member`, 접합 `design_connection`(과 그 안의 결과), 랩 `design_lap_connection`(과 `fastener_design`), 하중 해석 `analyze_loads`, 그리고 서버를 거치는 나머지 결과 가운데 그 네 목록 하나라도 있는 것(DSM · 서명곡선 · 파일 · 소성 · cFSM 분류 …). 항목 하나:

```json
{"code": "lap.warning.i6_2_1_lap_i6_i6_j3", "kind": "warning", "list": "warnings",
 "text": "Lap 10.00 in < 1.5d = 12.00 in (§I6.2.1(g)) — R 계수법(I6.2.1)·J3 겹친 Z 슬롯 예외의 적용 조건 미충족",
 "text_ko": "Lap 10.00 in < 1.5d = 12.00 in (§I6.2.1(g)) — R 계수법(I6.2.1)·J3 겹친 Z 슬롯 예외의 적용 조건 미충족",
 "template": "Lap {actual} < 1.5d = {min_lap} (§I6.2.1(g)) — R 계수법(I6.2.1)·J3 겹친 Z 슬롯 예외의 적용 조건 미충족",
 "template_ko": "…같음…",
 "params": [{"symbol": "actual", "value": 10, "quantity": "length", "fmt": ".2f", "unit_text": "in", "sep": " "},
            {"symbol": "min_lap", "value": 12.0, "quantity": "length", "fmt": ".2f", "unit_text": "in", "sep": " "}]}
```

- 머리가 붙은 항목: `prefix` · `prefix_ko` (`text = prefix + 그린 글`). 접합부 한계상태 이름의 한국어 머리는 검토 항목 등록표의 `name_ko` 와 조항에서 온다.
- 이은 글: `kind: "group"`, `code: null`, `sep`, `parts`(조각마다 같은 모양), `text = (prefix) + sep.join(parts[].text)`.
- 매개변수가 또 하나의 알림이면 그 매개변수에 `notice`(같은 모양) — 한국어 글은 안쪽 알림의 `text_ko` 로 그린다.
- 엔진 밖을 한 번 거쳐 그냥 글로 돌아온 알림(호스트가 `dsm` 결과를 `aisi_design` 에 다시 넘길 때의 DSM 경고)은 등록표로 되짚는다: `recognized: true`, 매개변수는 옛 글에서 잘라 낸 글자(`fmt: "raw"`, 숫자면 `value` 는 수 · `text` 는 그 글자). 템플릿에 글자가 8 자 미만인 code 와 fragment 는 되짚지 않는다.
- 등록되지 않은 글은 `code: null` — 계약 사례에서는 하나도 없다(시험).

**검토 항목의 이유** — `design_checks[]` 에 `reason` 이 있으면 같은 필드를 그 항목에 단다: `reason_code`, `reason_kind`, `reason_ko`, `reason_template`, `reason_template_ko`, `reason_params`; 이은 이유는 `reason_kind: "group"`, `reason_parts`, `reason_sep`; 머리는 `reason_prefix` · `reason_prefix_ko`. 그 항목이 어느 검토의 것인지는 항목 자신(`id`)이다. 결과를 접어 내기 전 마지막에 단다 — 엔진이 reason 을 고치면(no demand · 적용범위 밖 …) 그 뒤의 것이 실린다.

### 16.3 템플릿 문법과 그리는 규칙 (`notice-template/1`)

- 자리표는 `{name}` 하나뿐. `{{` · `}}` 는 글자 중괄호.
- 숫자 매개변수: `format(value, fmt)` — `conv` 가 `"r"` 면 `repr(value)` 를, `"s"` 면 `str(value)` 를 먼저(Python 의 f-string 과 같은 규칙; `fmt` 가 빈 글이면 Python `str(float)`). 글 매개변수(`quantity: null`, 이름 · 조항 · 목록 · 문장 조각): `value` 그대로. `fmt: "raw"`: 잘라 낸 글자 그대로.
- 그 뒤 `unit_text` 가 있으면 `sep + unit_text` (US 단위 글자 — `in` · `ksi` · `kips` · `kip-in` · `°`).
- **US 로 그리면 `text` · `text_ko` 와 글자까지 같다**(시험이 계약 사례 전부에서, 그리고 고정값 `test/python/notice_render_fixture.json` 192 쌍에서 확인). 호스트는 이 고정값을 읽어 자기 렌더러를 시험한다.
- **SI 로 그릴 때:** `quantity` 가 길이 · 힘 · 응력 · 모멘트 … 인 숫자는 §3.2 로 바꾸고, `unit_text` 대신 그 물리량의 SI 단위 글자를 쓴다. `unit_text` 가 없는 물리량 매개변수(예: `t={t}` — 옛 글이 단위를 쓰지 않음)는 SI 에서 단위를 붙여야 한다(바꾼 수만 두면 읽는 이가 in 으로 읽는다). 자리수(`fmt`)는 US 의 것이다 — SI 자리수는 호스트가 정한다(§5 의 표시 자리와 같은 원칙). `dimensionless` · `count` · `angle` 은 바꾸지 않는다.
- **`quantity` 가 `null` 인 매개변수 — 단위계와 무관하게 받은 그대로 그린다:** `value` 를 위 규칙대로(숫자면 `format(value, fmt)`, 글이면 그대로) 쓰고, `unit_text` 가 있으면 `sep + unit_text` 를 그대로 붙인다. 바꾸지도, 단위 글자를 갈지도, 숫자를 다시 자리 맞추지도 않는다 — SI 화면에서도 'ft' · 'kip*s^2/in^4' 가 그대로 나온다. `null` 은 글 매개변수(이름 · 조항 · 목록 · 문장 조각)이거나 §3.2 어휘에 없는 물리량이다(§16.7).

### 16.4 수

- code 443: warning 178 · reason 111 · assumption 97 · not_evaluated 35 · scope 11 · fragment 11. 영역: member 156 · conn 126 · lap 39 · loads 33 · shear 25 · fsm_solver 12 · dsm 11 · file 11 · special 11 · fsm 5 · server 4 · cfsm 3 · plastic 3 · base_vectors 2 · solver 2.
- 만드는 자리 464곳(`_nt(` 호출, 21 파일). 이은 글 · 머리 붙임 40곳.
- 옛 글이 영어였던 것 215 (한국어 템플릿을 새로 씀), 한국어였던 것 228 (template = template_ko).
- 계약 사례가 닿는 code 194, 가장자리 · 하중 사례까지 204. 닿지 않는 239 code 는 엔진 소스에 그 code 를 쓰는 자리가 있고(시험), 모든 `_nt` 호출의 매개변수 이름이 등록표와 같다(정적 시험) — 글을 그려 본 시험은 없는 갈래다:
  - 부재 설계의 드문 입력 71 — 표 B4.1-1 적용한계 넘음 12, 냉간가공 · 비탄성 여유 · 해석식 대체(App. 1/2) 실패 · DSM 의 fy 불일치 15, 랩 구간 진술과 함께 준 Lb · Cb · dsm 4, 웹 크리플링 · H3 · G2 의 드문 갈래 12, 미평가 이름표 · 이유(no Pcrl · no Mcrd · 원형 HSS …) 18, 그 밖의 입력 오류(web_count · Cb 범위 · §E2.2 편심 · Fcre = 0) 10.
  - 접합부의 드문 입력 56 — 용접(J2.2 · J2.3 · J2.6 의 joint 미지정 · 적용한계 밖 · 공정 표 · 여러 시트 · 사이드랩) 23, 볼트 · 나사 · PAF 의 미입력 · 범위 밖(App. A J3.4, d'w, Pnvs/Pnts, 게이지 · 행 · 알 수 없는 입력 키) 24, J6 파단의 member_case · 둘째 판 · Usl 9.
  - FSM · cFSM · DSM 해석 옵션과 수치 갈래 32 — 고유치 풀이 · 조건 불량 · 비 S-S 길이방향 항 · cFSM 구속(fsm_solver 12, fsm 5), cFSM 기저 · 분류(cfsm 3, base_vectors 2), DSM 추출의 격자 · 기준 응력 · 단일 극소(dsm 10).
  - 전단 · 웹 크리플링 표의 드문 갈래 18 — 내민 끝(Eq. G5-2) 적용한계, 표 G5-2/4/5 의 행 대용, §H3(a)(c) 조건.
  - 랩 도구의 드문 갈래 16 — 패스너 강도 0 · 배치 불가 · 가정값 Pns, 랩 길이 미입력, 진술과 함께 준 Mnd.
  - 하중 해석의 옵션 15 — 스탠딩심 지붕(S908 R), 거트 · 스터드의 약축 · 축력, RP17-2 범위, Wp 부호, 끝 지점의 랩.
  - 특수 주제 11 — §A3.3.2 냉간가공 입력(코너 · 면적 · Fu/Fy), Table J6-1 계수 · A1.2 사용자 계수.
  - 파일 읽기(옛 CUFSM .mat · 머리글 없는 JSON) 11.
  - 서버 입력(kphi · kx 기본값, signature_ss 의 쓰지 않는 입력, 모든 길이 버림) 4.
  - 진동 해석의 질량밀도 2, 소성 곡면의 정규화 3.

### 16.5 용어표 — 한 곳: `python/design/glossary.py` (2026-11-24 오케스트레이터 결정: 붙여 쓰는 꼴)

한 개념에 한 낱말, KDS 의 표기(붙여 씀). 검토 항목 이름(`name_ko`, §11)과 알림의 한국어 템플릿(옛 글이 한국어인 `template` 포함)이 이 표를 따른다. 표는 `design.glossary.TERMS` 하나이고, 아래는 그 사본이다. **시험**(`test_review_1124_notices.test_glossary_one_form_per_term`)이 이름과 템플릿 전부에서 오른쪽 열의 꼴(띄어 쓴 꼴 · 다른 말)을 찾으면 실패한다.

| 영어 | 한국어 | 쓰지 않는 꼴(정규식) |
|---|---|---|
| local buckling | 국부좌굴 | `국부\s+좌굴` |
| distortional buckling | 뒤틀림좌굴 | `뒤틀림\s+좌굴` · `왜곡\s*좌굴` |
| lateral-torsional buckling | 횡비틀림좌굴 | `횡\s+비틀림` · `횡비틀림\s+좌굴` · `횡좌굴` |
| flexural buckling | 휨좌굴 | `휨\s+좌굴` |
| torsional buckling | 비틀림좌굴 | `(?<![횡휨])비틀림\s+좌굴` |
| flexural-torsional buckling | 휨비틀림좌굴 | `휨\s*-\s*비틀림` · `휨\s+비틀림\s*좌굴` |
| global buckling | 전체좌굴 | `전체\s+좌굴` · `전체\s+탄성좌굴` |
| web crippling | 웹 크리플링 |  |
| effective width | 유효폭 | `유효\s+폭` |
| effective section modulus | 유효단면계수 | `유효\s+단면\s*계수` · `단면\s+계수` |
| net section | 순단면 | `순\s+단면` |
| gross section | 총단면 | `총\s+단면` |
| shear lag | 전단지연 | `전단\s+지연` |
| block shear | 블록전단 | `블록\s+전단` |
| block shear rupture | 블록전단파단 | `블록전단\s+파단` |
| rupture | 파단 |  |
| bearing | 지압 |  |
| pull-over · pull-out | 풀오버 · 뽑힘 |  |
| end distance | 끝단 거리 | `끝단거리` |
| edge distance | 연단 거리 | `연단거리` |
| unbraced length | 비지지 길이 | `비지지길이` |
| required strength | 소요강도 | `소요\s+강도` |
| nominal strength | 공칭강도 | `공칭\s+강도` |
| design / available strength | 설계강도 · 가용강도 | `설계\s+강도` · `가용\s+강도` |
| shear · tensile · compressive · flexural strength | 전단강도 · 인장강도 · 압축강도 · 휨강도 | `(?<![가-힣])(전단|인장|압축|휨)\s+강도` |
| limit state | 한계상태 | `한계\s+상태` |
| applicability limit | 적용한계 | `적용\s+한계` |
| scope | 적용범위 | `적용\s+범위` |
| half-wavelength | 반파장 | `반\s+파장` |
| signature curve | 서명곡선 | `서명\s+곡선` |
| load factor | 하중계수 | `하중\s+계수` |
| not evaluated · not given · not applicable | 미평가 · 미입력 · 해당 없음 |  |
| braced · bracing | 횡지지 · 가새 | `횡\s+지지` |
| lap · lapped section | 랩 · 겹친 단면 |  |
| uplift | 양력 |  |
| conservative · unconservative | 보수측 · 비보수 |  |
| reference only | 참고값 |  |

- **「웹 크리플링」은 한 줄로 바꿀 수 있다:** `design.glossary.WEB_CRIPPLING`. 등록표 · 이름은 저장된 꼴 ('웹 크리플링')로 두고 `localize` 가 읽어 들일 때(알림 템플릿 · `checks._r`) 바꿔 넣는다. 그 꼴이 아닌 것(웹크리플링 · 웨브 크리플링 …)은 시험이 막는다. (주인이 「웨브 크리플링」을 고르면 이 한 줄과 바뀐 글의 부록.)
- 조항 번호 · 식 번호 · 기호 · 입력 이름(`lap_restrained` …)과 Manual 인용문은 옮기지 않는다.
- 「끝단 거리 · 연단 거리 · 비지지 길이」는 띄어 쓴 꼴이 표의 꼴이다 — 접합부 한계상태 이름(`끝단 거리 (J3.2)` …)이 엔진의 식별 이름(`checks.connection_check_id`)이라 그쪽을 바꾸지 않는다.
- 알림이 아닌 옛 글(옛 `steps[].formula` · `steps[].name` 의 한국어, 코드 주석)은 이 결정의 범위 밖이다.
- 바뀐 옛 글: §16.9.

### 16.6 이름표 안의 숫자

이름표 글은 그대로 두고 옆에 숫자를 싣는다.
- 랩 `fastener_label` ('Bolt d=0.500 in', 'Screw #10') → `fastener_label_parts: {template, template_ko, params, values}` — 볼트 `Bolt d={d}` (`d`: length, `.3f`, `in`), 나사 `Screw #{gauge}`(게이지는 글) + `values` 에 지름 `d`(length).
- §I6.2.1 조건(`analyze_loads` 의 R 조건 `conditions[]`, 이름표 '(a) d <= 12 in.' …) → `limits: [{op, value, (times), (accepted)}]`, `value_quantity`, `value_unit_text`. 상수표 `design.loads.bracing.I621_LIMITS`. (h) 경간 '≤ 33 ft' 는 이름표 · 값이 ft 라 `quantity: null`, `unit_text` · `value_unit_text: 'ft'` 로 그대로 두고, **같은 값을 엔진의 길이 단위로 함께 싣는다** — `limits[0].as_length: {value: 396.0, quantity: 'length', unit_text: 'in'}`, 조건의 `value_as_length: {value: 경간 × 12, quantity: 'length', unit_text: 'in'}` (1 ft = 12 in, 정확). SI 화면은 `as_length` 를 §3.2 로 m 에 바꿔 보이면 된다 — 새 어휘가 필요 없다.
- 찾았지만 바꾸지 않은 것: 옛 `steps[].formula` · `steps[].name` 글(예: 'Positive-moment region (Lb_pos = 120.0 in, Cb = 1.00)', 'Fastener Strength (Bolt d=0.500 in)') — 옛 계산서 글이고, 같은 숫자는 `design_checks` 의 단계에 물리량과 함께 있다.

### 16.7 어휘에 없는 물리량 (새로 짓지 않음)

알림 매개변수에는 없다(kip-ft · plf · psf · ft 는 알림 글에 자리표 뒤 단위로 나오지 않는다). 이름표 · 글 매개변수로 남은 것: §I6.2.1 (h) 경간 한계 `ft`(→ 위의 `as_length` 로 길이로도 실린다), 진동 해석 경고의 질량밀도 `rho`(kip·s²/in⁴ — `quantity: null`, §16.3 의 규칙대로 받은 그대로). **호스트 작성자에게 — 어휘에 더할 후보:** `mass_density` (US `kip·s²/in⁴`, SI `kg/m³`; 1 kip·s²/in⁴ = 4448.2216 N·s² / (0.0254 m)⁴ ≈ 1.06870 × 10¹⁰ kg/m³). 엔진은 이 환산을 하지 않는다 — 어휘에 들어오면 등록표의 `rho` 에 그 이름을 단다. 서명곡선 극소 목록 `{value}`(길이의 목록)는 글 매개변수다(목록은 물리량을 싣지 않는다).

### 16.8 남은 것

- 옛 글이 한국어였던 228 code 는 `template` 이 한국어다 — 영어 템플릿은 없다(옛 글이 영어인 것만 영어). 영어 화면이 필요하면 `template_en` 을 따로 더해야 한다.
- 글 매개변수 가운데 문장 조각이 엔진 안의 글(예외 메시지 `{exc}`, 하위 결과의 이유 `{reason}`, Manual 인용 `{manual_quote}`)이면 한국어 글에도 그 원문이 들어간다.
- 스레드 고정(§6.1)은 알림을 내지 않는다(`selftest` 의 `numeric_threads` 로만).

### 16.9 부록 — 용어표로 바뀐 옛 글 (2026-11-24)

§16.5 의 결정으로 **낱말만** 바꿨다(띄어쓰기, 「왜곡좌굴」 → 「뒤틀림좌굴」, 「횡좌굴」 → 「횡비틀림좌굴」, 「전체 탄성좌굴」 → 「탄성 전체좌굴」). 숫자 · 뜻 · 자리표는 그대로다. 고정한 글이 있는 쪽은 이 까닭으로 다시 받으면 된다. 영어 글 · 값 · 판정은 바뀌지 않았다.

**알림 — 옛 글(한국어 원문, `template` = `template_ko`)이 바뀐 code 11:**

| code | 옛 템플릿 (옛 글) | 새 템플릿 |
|---|---|---|
| `conn.assumption.j2_3_2_1_de_capped_0_55d` | J2.3.2.1: de = 0.7d − 1.5t = {de_eq} 을 0.55d = {value} 로 낮춤 — 원문 Eq. J2.3.2.1-3 에 없는 사내 보수 상한(A1.2, 아크 스폿 Eq. J2.2.2.1-5 와 Figure J2.3.2.2-1 의 주석을 따름). 용접 너겟 전단 강도가 원문보다 낮다(보수). | J2.3.2.1: de = 0.7d − 1.5t = {de_eq} 을 0.55d = {value} 로 낮춤 — 원문 Eq. J2.3.2.1-3 에 없는 사내 보수 상한(A1.2, 아크 스폿 Eq. J2.2.2.1-5 와 Figure J2.3.2.2-1 의 주석을 따름). 용접 너겟 전단강도가 원문보다 낮다(보수). |
| `lap.warning.f4_f4_lap_restrained_true` | 뒤틀림좌굴(§F4): lap_restrained = true — 사용자가 겹친 부분이 횡비틀림 · 뒤틀림 좌굴에 충분히 구속된다고 밝혔으므로(Manual II-1A / II-2A) §F4 검토를 하지 않았습니다. | 뒤틀림좌굴(§F4): lap_restrained = true — 사용자가 겹친 부분이 횡비틀림 · 뒤틀림좌굴에 충분히 구속된다고 밝혔으므로(Manual II-1A / II-2A) §F4 검토를 하지 않았습니다. |
| `lap.warning.j6_3_lap_j6` | Lap 패스너 무리 블록 전단(§J6.3, 장력면 무시 하한) 초과: {ratio_bs} > 1.0 | Lap 패스너 무리 블록전단(§J6.3, 장력면 무시 하한) 초과: {ratio_bs} > 1.0 |
| `lap.warning.lap_mn_se_fy` | Lap 구간 휨(Mnℓ = Se·Fy)은 겹친 부분이 횡비틀림 좌굴에 구속된다는 Manual II-1A / II-2A 가정에 선다 — lap_restrained = true 로 그 가정을 밝히지 않아 판정하지 않습니다. | Lap 구간 휨(Mnℓ = Se·Fy)은 겹친 부분이 횡비틀림좌굴에 구속된다는 Manual II-1A / II-2A 가정에 선다 — lap_restrained = true 로 그 가정을 밝히지 않아 판정하지 않습니다. |
| `lap.warning.se_lap` | Se(유효 단면계수)가 미입력 — Lap 구간 휨강도 검토를 수행하지 못했습니다(판정 없음). 설계 탭에서 단면 정보를 확인하세요. | Se(유효단면계수)가 미입력 — Lap 구간 휨강도 검토를 수행하지 못했습니다(판정 없음). 설계 탭에서 단면 정보를 확인하세요. |
| `lap.warning.sf_only_reference` | Sf(총단면 계수)만 입력 — 국부좌굴을 반영하지 않은 참고값만 계산했고 휨 판정은 하지 않음. Se 를 입력하세요. | Sf(총단면계수)만 입력 — 국부좌굴을 반영하지 않은 참고값만 계산했고 휨 판정은 하지 않음. Se 를 입력하세요. |
| `member.assumption.e2_2_e2_ex_kyly_ry` | §E2.2: 전단중심 편심이 z 방향 — 대칭축을 z 로 보고 σex(대칭축)=π²E/(KyLy/ry)², σey=π²E/(KxLx/rx)², xo=\|Zs−zcg\| 로 휨-비틀림좌굴을 산정했습니다. | §E2.2: 전단중심 편심이 z 방향 — 대칭축을 z 로 보고 σex(대칭축)=π²E/(KyLy/ry)², σey=π²E/(KxLx/rx)², xo=\|Zs−zcg\| 로 휨비틀림좌굴을 산정했습니다. |
| `member.warning.a3_3_2_a3_fy_mnl_mne` | §A3.3.2: Fy 응력 수준에서 국부 또는 왜곡좌굴이 강도를 감소시키거나 확인되지 않아 (Mnl≠Mne 또는 Mnd≠My) 냉간가공 강도증가를 적용할 수 없습니다. Virgin Fy를 사용합니다. | §A3.3.2: Fy 응력 수준에서 국부 또는 뒤틀림좌굴이 강도를 감소시키거나 확인되지 않아 (Mnl≠Mne 또는 Mnd≠My) 냉간가공 강도증가를 적용할 수 없습니다. Virgin Fy를 사용합니다. |
| `member.warning.a3_3_2_a3_fya_virgin_fy` | §A3.3.2: Fya 응력 수준에서 국부 또는 왜곡좌굴이 강도를 감소시키므로 냉간가공 강도증가를 적용할 수 없습니다. Virgin Fy를 사용합니다. | §A3.3.2: Fya 응력 수준에서 국부 또는 뒤틀림좌굴이 강도를 감소시키므로 냉간가공 강도증가를 적용할 수 없습니다. Virgin Fy를 사용합니다. |
| `member.warning.e2_2_e2_xo_xo_xs` | §E2.2: 전단중심 편심 xo를 확인할 수 없어(xo=0, Xs/xcg 미제공) 휨-비틀림좌굴이 평가되지 않았습니다. 단축대칭 개단면(C/hat/track/angle)에서는 Pne가 과대평가될 수 있으므로 xo(또는 Xs, xcg)를 제공하세요. | §E2.2: 전단중심 편심 xo를 확인할 수 없어(xo=0, Xs/xcg 미제공) 휨비틀림좌굴이 평가되지 않았습니다. 단축대칭 개단면(C/hat/track/angle)에서는 Pne가 과대평가될 수 있으므로 xo(또는 Xs, xcg)를 제공하세요. |
| `member.warning.e2_e2_fcre_fcre_pne` | §E2: 전체 탄성좌굴응력 Fcre를 계산할 수 없습니다(Fcre=0 → Pne=0 → Pn=0). 비틀림 성질 J/Cw 또는 rx/ry/ro/xo가 누락되었을 가능성이 큽니다{cutwp_note}. 0 강도를 유효한 설계로 해석하지 마십시오. | §E2: 탄성 전체좌굴응력 Fcre를 계산할 수 없습니다(Fcre=0 → Pne=0 → Pn=0). 비틀림 성질 J/Cw 또는 rx/ry/ro/xo가 누락되었을 가능성이 큽니다{cutwp_note}. 0 강도를 유효한 설계로 해석하지 마십시오. |

**알림 — 한국어 템플릿만 바뀐 code 1** (옛 글은 영어 — 그대로):

| code | 옛 template_ko | 새 template_ko |
|---|---|---|
| `lap.reason.se_effective_section_modulus` | Se (유효 단면계수) 미입력 | Se (유효단면계수) 미입력 |

**검토 항목 이름 `name_ko` 15:**

| 검토 항목 id | 옛 name_ko | 새 name_ko |
|---|---|---|
| `member.applicability.b4` | 적용 한계 (표 B4.1-1) | 적용한계 (표 B4.1-1) |
| `member.compression.global` | 항복 및 전체 좌굴 | 항복 및 전체좌굴 |
| `member.compression.local` | 국부 좌굴 | 국부좌굴 |
| `member.compression.distortional` | 뒤틀림 좌굴 | 뒤틀림좌굴 |
| `member.flexure.global` | 항복 및 횡좌굴 | 항복 및 횡비틀림좌굴 |
| `member.flexure.local` | 국부 좌굴 | 국부좌굴 |
| `member.flexure.distortional` | 뒤틀림 좌굴 | 뒤틀림좌굴 |
| `conn.j6.tension_rupture` | 순단면 인장 파단 (전단 지연) | 순단면 인장 파단 (전단지연) |
| `conn.j6.block_shear` | 블록 전단 파단 | 블록전단파단 |
| `conn.j6.block_shear.part2` | 블록 전단 파단 — 두 번째 판 | 블록전단파단 — 두 번째 판 |
| `conn.scope` | 적용 범위 (두께 · 패스너 지름) | 적용범위 (두께 · 패스너 지름) |
| `conn.shear_strength` | 면내 전단 강도 (평가된 한계상태) | 면내 전단강도 (평가된 한계상태) |
| `conn.tension_strength` | 축방향 인장 강도 (평가된 한계상태) | 축방향 인장강도 (평가된 한계상태) |
| `lap.flexure.distortional` | 랩 구간 뒤틀림 좌굴 (2겹) | 랩 구간 뒤틀림좌굴 (2겹) |
| `lap.block_shear` | 랩 패스너 무리 — 블록 전단 파단 | 랩 패스너 무리 — 블록전단파단 |

### 16.10 덧붙임 — 알림이 없던 글 (2026-11-24 K4c)

호스트가 SI · 한국어 화면에서 찾은, 알림이 없어 영어 · US 로 남던 글을 닫았다. 옛 글 · 값은 바이트까지 그대로다(`a730256` 과 견줌: 계약 사례 141,715 · 가장자리 88,554 · 하중 57,230 값 — 다른 것은 K4b 의 필드(`notices` · `*_template` · `*_params`)뿐).

- **새 목록 — `notices` 가 읽는 목록은 이제 `warnings` · `assumptions` · `scope_notes` · `not_evaluated` · `not_checked` · `reasons` · `dsm_warnings`** (이 차례, `list` 에 이름). `not_checked`(부재: 구현하지 않은 조항 9가지)는 code `member.scope.not_checked_*`, `reasons` 는 §I6.2.1 판정의 까닭(`loads.reason.i621_*`).
- **하위 블록마다 자기 `notices`:** 결과 안의 dict 가운데 위 목록을 하나라도 가진 것(계약 사례에서: `shear` · `web_crippling` · `cold_work` · `fastener_design` · `auto_params.deck` · `auto_params.unbraced` · `auto_params.i621_check`)은 그 블록의 목록으로 만든 `notices` 를 갖는다 — 같은 꼴, 위 블록의 `notices` 에는 들어가지 않는다. 같은 글을 찾아 맞출 필요가 없다. (`design_checks` · `steps` · `lap_section` 안으로는 내려가지 않는다.)
- **글 하나에 붙는 필드 — `reason_*` 와 같은 꼴, 머리말만 다르다:** `label_*`(§I6.2.1 조건 `conditions[].label`), `value_*`(그 조건의 값이 글일 때 — 'lap lengths not given' · 'Fy/Fu not given'), `steps_unavailable_*`(검토 항목의 `steps_unavailable` 이 `reason` 과 다를 때 — 지금은 표 B4.1-1 항목 하나). 필드: `{p}_code · _kind · _ko · _template · _template_ko · _params`(이은 글은 `_parts` · `_sep`, 머리는 `_prefix` · `_prefix_ko`). `i621_check.checks[]` 의 `[label, pass]` 쌍은 `conditions[]` 와 같은 차례 · 같은 이름표다.
- **새 kind `label`** — 이름표(§I6.2.1 조건 · 시스템 조건 (i)–(n)). 시스템 조건 여섯은 `(i)-(n)` 이름표의 `items` 매개변수(이은 글, 조각마다 알림).
- **템플릿의 치수 상수는 상수 매개변수다(§16.3 에 더함):** 등록표 매개변수에 `const`(엔진 단위 US 의 수)와 `text`(옛 글의 글자: `3/16` · `0.60` · `33` · `1-1/8` …). `_nt` 를 부르는 쪽은 넘기지 않는다(등록표가 채운다). 결과의 매개변수는 `{symbol, value: const, quantity, fmt: 'raw', text, const: true, (unit_text, sep)}` — **US 로는 `text` + sep + unit_text**(옛 글과 같다), **SI 로는 `value` 를 바꾼 수 + SI 단위**. `unit_text` 가 없는 상수(범위의 앞쪽 `0.08 ≤ d ≤ 0.25 in` 의 0.08 같은)는 §16.3 대로 SI 에서 단위를 붙인다. 단위 글자가 엔진 단위와 다른 상수(`33 ft`, `18 mil`)도 `value` 는 엔진 단위(in)다 — `33 ft` 의 value 는 396 in. **이렇게 바꾼 code 24 — 호스트는 이 code 들의 무늬 바꾸기를 뗄 수 있다:** `conn.assumption.e60_fxx_e60_ksi` (Fxx_min) · `conn.reason.aisi_s100_ansi_aisc` (t_lim) · `conn.reason.arc_spot_sheet_thickness_limit` (t_lim) · `conn.reason.fuf_uh_hrc_ksi` (F_uh_ref) · `conn.reason.j2_2_2_1_de_j2_de` (de_min) · `conn.reason.j4_screw_diameter_out_of_range` (d_max, d_min) · `conn.reason.table_j3_3_1_1_j3` (t_hi, t_lo) · `conn.reason.table_j3_4_1_j3` (d_min) · `conn.reason.tw_w1_w2_d1` (t_lim) · `conn.warning.j2_2_j2` (hole_min, t_lim, tw_hi, tw_lo) · `conn.warning.j3_j3_astm_a354_grade` (d_max) · `conn.warning.j4_4_j4` (dw_min) · `conn.warning.j5_3_2_j5_ds_manual_iv` (ds_cap, ds_max) · `conn.warning.j5_washer_diameter_capped` (dw_cap, dw_max) · `loads.warning.ply_thickness_outside_rp17` (t_hi, t_lo) · `member.assumption.i6_2_1_i6_ft` (span_max) · `member.ne.f2_f2_lateral_torsional_buckling_4` (Lb_default) · `member.reason.no_lateral_torsional_buckling` (Fcre_inf) · `member.warning.lb_defaulted_verify_lateral` (Lb_default) · `member.warning.table_b4_1_1_fy_ksi_b4_fy` (Fy_limit) · `shear.assumption.h3_h3_exception_interior_supports` (s_max) · `shear.warning.table_g5_5_multi_web_deck_support` (s_max) · `solver.warning.material_mass_density_outside` (rho_steel) · `solver.warning.no_mass_density_given` (rho_steel). 새 code 가운데 상수를 가진 것: `loads.label.i621_a` · `_e` · `_h` · `_j_thickness` · `_k_insulation` · `_n_spacing` · `_sys_j` · `_sys_k` · `_sys_l` · `_sys_n`. 시험이 템플릿 글자에 「숫자 + in · ksi · kips · kip-in · kip-ft · ft · psf · plf · mil」이 남지 않음을 확인한다 — 예외는 각도(°, deg)와 다른 단위계 값으로 쓴 글(`0.2836 lb/in^3`, `7850 kg/m^3`)과 단위 이름만 쓴 글(`in kip*s^2/in^4`).
- **`rho` 는 `mass_density`**(§3.2). 매개변수 `rho_steel`(7.345e-7)도.
- **수:** code 484 (새 41: not_checked 9 · 전단/웹 크리플링 범위 2 · §I6.2.1 이름표 22 · 이유 5 · B4 steps_unavailable 1 · 이름표 값 2). 템플릿을 바꾼 code 24(상수 매개변수 32 개). 계약 사례가 닿는 code 225. 고정값 `notice_render_fixture.json` 203 쌍.
- **남은 글:** §16.11 로 옮겼다(K4d 에서 다시 닫음).

### 16.11 덧붙임 — 이름표 · 방법 설명 · 출처 이름표 · 적용한계 조각 (2026-11-24 K4d)

옛 키 · 옛 글은 바이트까지 그대로다(`4cb97d5` 와 견줌: 계약 사례 146,744 · 가장자리 91,971 · 하중 57,716 값 — 다른 것은 K4b 필드의 `text_ko` 3 칸(안쪽 오류 글이 이제 한국어)뿐).

**글 하나 · 글로 된 사전 · 목록에 붙는 것(결과 어디서나, `attach` 가 걷는다):**
- 값이 알림인 키 `k` → 옆에 `{k}_code` · `_kind` · `_ko` · `_template` · `_template_ko` · `_params` (§16.10 의 `label_*` 와 같은 꼴). 예: `analysis_method`, `pattern_loading.rule`, `auto_params.*.basis` · `rule` · `note`, `deflection(_cases).basis` · `note`, `load_combination_standard.reference`, `lap_length_role`, `force_model.clause` · `description`, `limit_states[].factor_basis`, `interaction_checks[].ratio_form` · `note`, `cold_work.excluded_sections`, `rupture_factor_basis`, `Fcre_detail.error`, 검토 항목의 `note` · `reference.basis` · `ratio_form`, `lap_section.basis`, 처짐 `per_span[].L_ratio_basis`.
- 값이 알림의 사전(키를 더럽히지 않게) → 옆에 `{k}_notices: {키: 항목}` — 하중별 배치 이름표 `pattern` · `pattern_V` · `pattern_R` · `pattern_R_uplift` · `loads`, `pattern_loading.why`, `dsm_source`.
- 값이 알림의 목록 → `{k}_notices: [항목]` (`force_model.known_limitations`, `snow_cases`); 알림 사전의 목록 → `{k}_notices: [{키: 항목}]` (`envelope_source.patterns`).
- 배치 이름표 항목은 구조도 싣는다: code `loads.label.pattern_spans_loaded` 면 `spans: [1, 3]`(경간 번호). 그 밖의 배치: `pattern_all_spans` · `pattern_not_acting` · `snow_balanced` · `snow_case1` · `snow_case2`(매개변수 `side` = 조각 `loads.fragment.side_left/right`) · `snow_case3`(`s1`, `s2`).

**1. 모드 · 검토 이름(영어 이름표)** — 옆에 그 이름이 가리키는 검토 항목 id:
- `governing_check` → `governing_check_id` (이름 → 무리 → 그 무리의 `governs` 항목; 랩은 이미 id).
- `controlling_mode` → `controlling_mode_id` (부재 종류 + 모드: `member.compression.local` …) 와 모드 이름표 `controlling_mode_code` · `_ko` …(code `member.label.mode_*` 14: 국부좌굴 · 뒤틀림좌굴 · 전체좌굴(휨 · 비틀림 · 휨비틀림 · 지원하지 않는 비대칭 · 사용자/합리적 해석 · 미평가 · 그 밖) · 전체좌굴·횡비틀림좌굴 · §I6.2.1 R 계수(R) · 항복 · 파단 · 사용자가 준 약축 강도).
- 접합부 `governing_mode` · `shear_governing_mode` · `tension_governing_mode` (+ `_verified_`), 랩 `Pns_governing_mode` → `{k}_id` (한계상태 이름 → `checks.connection_check_id`). 화면은 그 id 의 `name_ko`(§11)를 보인다.

**4. 적용한계 조각(`{lim}`)** — 문자열을 잇던 자리가 이제 조각 알림의 이은 글(`kind: group`, sep ', ')이다. 조각 code(kind `fragment`) 13: `conn.fragment.lim_range_length` `{symbol}={value} ({lo}–{hi})`, `lim_le_length` · `lim_ge_length_eighth`(≥ 1/8 — 상수), `lim_screw_gauge`(`No.12·14` 는 글), `lim_le_stress` · `lim_ge_stress`, `lim_range_ratio_2f` · `lim_ge_ratio_3f` · `lim_ge_ratio_2f`, `lim_le_force_2f`(kips), `lim_fxx_gt_fu`, `lim_equal_thickness`, `lim_tdafu_le`(≤ 3 kips — 상수). `value` · `lo` · `hi` · `limit` 은 그 기호의 물리량(length · stress · force · dimensionless)이라 SI 로 바뀐다. 예외 메시지 `{exc}` 는 Python 의 글 그대로다(엔진이 짓지 않은 글 — 바꾸지 않는다).

**수:** 새 code 93 (모드 이름표 14 · 하중 해석 33 · 랩 · 출처 · 오류 33 · 적용한계 조각 13), 모두 571 → 577 (작은 글 6 더). 계약 사례가 닿는 code 270. 고정값 206 쌍. 새 물리량 `pressure`(§3.2).

**아직 덮이지 않은 글과 까닭 (K4e 뒤, 최종):**
- 옛 `steps[].formula` · `steps[].name` (알려진 것).
- 예외 메시지 `{exc}` — Python 이 지은 글.
- 검토 항목 계산 과정의 갈래 조건 `steps[].condition`('Fcre ≥ 2.78 Fy', 'R/t ≤ 20  (inside bend radius)' …) — `expr` 와 같은 기호식(오케스트레이터 결정: 기호 그대로).
- 기계 식별자 · 고유 이름: `design_method`, `basis`(`rational_A1.2c` · `manufacturer` …), `member_app`, `span_type`, `load_type`, `section_source`, `mirrors.*.path`, `load_combination_standard.edition`('ASCE/SEI 7-10'), 기호 `L`.

### 16.12 덧붙임 — 계산 과정의 출처 메모 · 출처 종류의 한국어 이름 (2026-11-24 K4e)

옛 키 · 옛 글은 바이트까지 그대로다(`3bc83d0` 과 견줌: 계약 사례 150,404 · 가장자리 93,760 · 하중 64,643 값, 다른 것 0).

- **출처 메모(`source.note`)마다 code · 한국어:** 새 kind `note` — 검토 항목 계산 과정의 `steps[].inputs[].source.note`, 항목의 `demand` · `capacity` · `reference` 의 `source.note`, 단계 자체의 `note`, 그리고 결과의 `display_rounding.note`. code 81(`member.note.*` · `conn.note.*` · `lap.note.*`), 엔진 자리 82 곳 + Table J3.3.1-2 `mf` 행 이름표 7 + 표시 반올림 메모 3. 메모가 든 `source` dict(과 단계)에 옆 필드 `note_code` · `note_kind` · `note_ko` · `note_template` · `note_template_ko` · `note_params` (§16.11 의 `{k}_*` 와 같은 꼴 — `checks.src()` · `Trace.add()` 가 단다). 숫자를 품은 메모는 매개변수(예: `governing shear: {name}`, `{name} plate buckling coefficient`); 치수 상수를 품은 메모 7은 상수 매개변수(§16.3: `{L_default}` = 120 in, `{Fxx_min}` = 60 ksi, `{F_uh}` = 120 ksi, `{Fub}` = 100 ksi, `{dw_max}` = 0.75 in). 시험이 계약 사례의 모든 검토 항목 계산 과정에서 `note` 가 있는 출처마다 `note_code` 가 있음을 확인한다.
- 「virgin Fy」는 용어표에 「원소재 Fy」.
- **출처 종류 · 좌굴값 방법의 한국어 이름(용어표 한 곳):**

| `source.kind` | 한국어 | | `buckling_analysis.method` | 한국어 |
|---|---|---|---|---|
| `step` | 앞 단계 | | `fsm_minimum` | FSM 극소 |
| `check` | 다른 검토 항목 | | `fsm_single_minimum` | FSM 단일 극소 |
| `section_property` | 단면 성질 | | `analytic` | 해석식 (부록 1 · 2) |
| `material` | 재료 | | `analytic_raised_to_floor` | 해석식 (곡선 하한으로 올림) |
| `buckling_analysis` | 좌굴 해석 | | `closed_form` | 폐형식 (§E2 · §F2) |
| `load_analysis` | 하중 해석 | | `user_supplied` | 사용자가 준 값 (합리적 해석) |
| `user_input` | 사용자 입력 | | | |
| `engine_default` | 엔진 기본값 | | | |
| `specification` | 기준 | | | |

  표지: `generated: true` → 「템플릿으로 생성」, `assumption_source` → 「가정의 근거」, `restraint_source` → 「구속의 근거」(`SOURCE_FLAGS_KO`). 「사용자 진술」은 `user_input` + `key: 'lap_restrained'` 의 출처다 — 화면은 `key` 의 입력 이름을 그대로 둔다.
- **수:** code 660 (note 81 · label 99 · fragment 26 · warning 178 · reason 122 · assumption 97 · not_evaluated 35 · scope 22). 계약 사례가 닿는 code 334. 고정값 207 쌍.
- 함께 고친 것: 하위 결과 이름이 `_params` 로 끝나면(`auto_params`) 걷지 않던 잘못 — `analyze_loads.auto_params` 안의 글(`uplift_bracing.positive_region.note`, `uplift_R_basis`, `gravity_R_basis` …)에 이제 필드가 붙는다(code `loads.label.r_basis_*` 2 더함).

### 16.13 덧붙임 — 거짓을 말하던 경고, 접합부 행의 check_id, 남은 두 글 매개변수 (2026-11-24 K4f)

**1. `lap.warning.lap_mu_mn_dcr` 「Lap 구간 휨강도 부족: Mu = … > φMn = …」이 비 0.22 – 0.56 에서 나왔다.** 원인은 조건이다: 랩 국부 휨의 판정 값 `flexure_ok` 는 진술(`lap_restrained`)이 없고 비 ≤ 1 이면 `None`(판정 없음, 계약 §6.3)인데 경고가 `if not flexure_ok:` 로 걸려 `None` 에서도 나왔다. 비교한 두 값(Mu 와 두 부재의 설계강도 2·Se·Fy·φ 또는 /Ω)은 맞았다 — 「>」와 「부족」이 거짓이었다. 이제 `flexure_ok is False`(비 > 1)일 때만 — 검토 항목 `lap.flexure.local` 이 `fail` 인 때와 같다. 함께: ASD 에서 그 값은 Mn/Ω 인데 글은 「Mn」이라 했다 — 이 경고와 `member.warning.ng_mu_mn_dcr`(정모멘트 구간 NG)의 템플릿에 매개변수 `omega`(LRFD '' · ASD '/Ω')를 더해 ASD 글이 「Mn/Ω = …」 · 「Mn(+)/Ω=…」가 된다(LRFD 글은 그대로; 계약 사례의 이 두 경고는 모두 LRFD 라 기준선 글은 바뀌지 않는다).

**같은 꼴을 찾은 것:** 시험 `test_asserted_inequalities_hold` 가 계약 사례 전부에서 알림 글이 단언하는 부등식(>, <, ≥, ≤ — 연산 바로 앞의 값과 뒤의 첫 수)을 그 알림의 매개변수로 평가한다(적용한계 조각 `conn.fragment.lim_*` 은 어긴 한계를 적는 글이라 거짓이어야 하고, 이름표 `label` 은 규칙 · 요구를 적는 글이라 보지 않는다). 고치기 전 엔진에서 거짓이 나온 알림은 이 하나뿐이었다(계약 · 가장자리 · 하중 사례). 엔진 소스를 훑은 것: 단언하는 경고를 `if not X:` 아래에서 내는 자리는 랩 도구의 여섯(`fastener_spacing_below_3d`, `transfer_capacity_dcr`, `lap_mu_mn_dcr`, `j6_3_lap_j6`, `h2_lap_h2`, `f4_lap_f4_dcr`)이고, 그 가운데 판정 값이 `None` 일 수 있는 것은 `flexure_ok` 하나다.

**기준선에서 바뀐 값(옛 글이 빠짐, 판정 · 수는 그대로):**

| 사례 | 빠진 `warnings` 글 | `lap.flexure.local` |
|---|---|---|
| lap bolt Se Mnd · lap bolt Se e=2 · lap bolt short e · lap bolt short lap | Lap 구간 휨강도 부족: Mu = 120.00 kip-in > φMn = 297.00 kip-in (DCR = 0.40) | not_evaluated |
| lap screw Pnvs ASD | Lap 구간 휨강도 부족: Mu = 66.00 kip-in > Mn = 118.56 kip-in (DCR = 0.56) | not_evaluated |
| lap screw no Pnvs | Lap 구간 휨강도 부족: Mu = 40.00 kip-in > φMn = 178.20 kip-in (DCR = 0.22) | not_evaluated |
| (가장자리) lap screw LRFD · lap short length LRFD | … Mu = 50.00 kip-in > φMn = 178.20 kip-in (DCR = 0.28) | not_evaluated |
| (가장자리) lap screw ASD · lap short length ASD | … Mu = 50.00 kip-in > Mn = 118.56 kip-in (DCR = 0.42) | not_evaluated |

그 밖의 다른 값은 K4b 필드(`notices` 등)뿐 — 계약 사례 153,721 · 가장자리 95,530 · 하중 65,134 값과 견줌(`8f52455`).

**2. 접합부 행의 check_id:** `limit_states[]` · `detailing_checks[]` · `interaction_checks[]` 의 행마다 `check_id`(`checks.connection_check_id(name)`)와 `name_ko`(§11). 시험이 계약 사례의 모든 행(접합 · 랩의 `fastener_design` · 부재)에 id 와 그 `name_ko` 가 있음을 확인한다.

**3. 마지막 두 글 매개변수:** `member.warning.effective_length_defaulted_verify.items` 는 조각 `member.fragment.length_default_item` `{symbol}={L_default}`(L_default = 120 in 상수)의 이은 글, `member.warning.i6_2_1_i6_k2.i621_issues` 는 조각 `member.fragment.i621_*` 12(깊이 · 비 · 플랜지 폭은 물리량, (a) 12 in · (e) 2.125 in 은 상수, 「span type unknown」은 조각)의 이은 글. 옛 글은 그대로다. 이제 엔진 글에 호스트의 무늬 바꾸기가 필요한 매개변수는 없다.

**수:** code 674 (조각 14 더함). 고정값 210 쌍.
