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
| `ratio` | `demand / capacity` (엔진과 같은 연산). 소요가 없거나 강도 0 이면 `null` |
| `verdict` | `pass` · `fail` · `not_evaluated` · `not_applicable` |
| `reason` | `not_evaluated` · `not_applicable` 이면 늘 있다. 믿을 수 없는 값으로 `fail` 이면 그 까닭 |
| `governs` | 그 무리의 지배 항목이면 `true` (4절) |
| `counts` | 판정에 드는가(기본 `true`). 적용 조건(랩 길이)만 `false` |
| `location` · `combination` | 위치 · 하중 조합(6절). 모르면 `null` |
| `steps` | 계산 과정(3절). 없으면 `[]` 이고 `steps_unavailable` 에 까닭 |
| `mirrors` | 이 항목의 값이 옛 결과의 어느 필드와 같은지 — `{field: {path, digits}}`. 시험이 이것으로 옛 값과 맞댄다 |
| `reference` | `not_evaluated`(또는 `not_applicable`) 인데 엔진이 계산은 한 값 — `{capacity, nominal, ratio}` 참고용 |
| `trusted` | `false` 면 값은 있으나 엔진이 판정에 믿지 않는 값(가정한 입력 · §4.1 의 의심 좌굴값)으로 낸 것 |
| 그 밖 | 접합부: `direction`('shear'·'tension'), `basis`, `assumed`, `steps_note`; 상호작용: `equation_used`; 조합 결과로 옮긴 하위 항목: `part_of`('compression'·'flexure_x'·'tension'·'fastener_design') |

## 3. 계산 과정 `steps`

단계 하나: `{kind, expr, equation, inputs: [...], result, …}`

- `expr` — 단위 없는 기호식(예: `Mnd = [1 − 0.22 (Mcrd/My)^0.5] (Mcrd/My)^0.5 My`). 숫자를 넣은 문자열을 만들지 않는다 — 대입은 화면이 `inputs` 로 한다.
- `equation` — 그 단계가 쓴 식 번호(없으면 `null`).
- `inputs` — `{symbol, value, quantity, source}`. **값은 계산이 실제로 쓴 바로 그 변수**다(같은 자리에서 만든다. 다시 계산한 값이 아니다).
- `result` — `{symbol, value, quantity}` 또는 `null`(갈래 단계).
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

엔진은 숫자를 꾸미거나 단위를 바꾸지 않는다. 경계층은 `quantity` 로 SI 를 만든다(9절).

### 3.3 `source` 어휘

| kind | 뜻 | 덧붙는 것 |
|---|---|---|
| `step` | 같은 항목의 앞 단계 결과 | `step`(번호) |
| `check` | 다른 항목의 결과(예: F3 의 Mne ← F2) | `id`, `rounded_to` |
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
- **지배(`governs`):** 무리마다 하나. 평가한(pass/fail) 항목 중 `ratio` 가 가장 큰 것, 같으면 엔진이 고른 지배 모드(`controlling_mode`). 소요가 없어 비가 없는 무리는 (참고) 설계강도가 가장 작은 것.
- **모드별 검토.** 엔진은 F2 · F3 · F4 의 최소 Mn 으로 하나의 비를 냈다. 계산서는 Manual 예제(II-1B: φMne 113, φMnℓ 84.2, φMnd 89.9)처럼 모드마다 설계강도와 비를 낸다. 지배 모드 항목의 비는 옛 이용률과 같은 연산이다(`mirrors.ratio`).
- **소요가 없으면**(Pu = 0 등) 해당 항목은 `not_evaluated`(reason: 소요 없음), 설계강도는 `reference`. 접합부에서 한 방향만 소요가 있으면 다른 방향의 한계상태는 `not_applicable`.

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

`member.applicability.b4` 는 이제 E–H 장 부재마다 나온다: 한계를 넘으면 `not_evaluated`(판정에 든다), 넘지 않으면 `pass` 이고 `counts: false`(엔진은 한계를 넘을 때만 판정을 바꾼다). 대조하지 못한 요소가 있으면 `reason` 에 적는다.

## 9. 경계층이 할 일

0. **지금 깨지는 경계 시험:** `npm run test:webview` 의 `mcp_si_chain` 이 SI 출력에서 단위 표가 없는 숫자 키(`design_checks[*]…value`)를 잡아 실패한다 — SI 모드 MCP 결과에 US 값이 섞여 나가는 것을 막는 시험이므로 옳은 실패다. 아래 1 이 끝나면 닫힌다. 나머지 웹뷰 계약은 모두 통과한다.
1. **SI 변환:** `design_checks[*]` 안의 `{symbol, value, quantity}` 꼴(`demand` · `nominal` · `capacity` · `reference.*` · `steps[*].inputs[*]` · `steps[*].result` · `source.half_wavelength`)을 `quantity` 로 바꾼다. `ratio` · `factor.value` 는 무차원. `rounded_to` 는 US 값의 반올림 자리이므로 SI 로 옮길 때 같이 바꾸거나(×) 버린다. 결과의 `display_rounding` 은 US 표시 자리수다 — SI 로 바꾼 값에는 맞지 않으므로 SI 출력에서는 버리거나 자체 표시 규칙으로 바꾼다. 문자열(`expr`, `condition`)은 단위가 없어 그대로.
2. **MCP 스키마:** `aisi_design` · `design_connection` · `lap_connection` 출력에 `design_checks`, `generate_section` 출력에 `element_roles` 를 덧붙이고, 입력에 `check_location` · `check_combination` 을 연다.
3. **호스트(`StcfsdPanel`):** 퍼린 구간 결과가 `{...pick, checks: …}` 로 대표 검토 지점의 결과만 남긴다 — 구간마다 검토 지점별 `design_checks` 를 함께 넘기고, 각 호출에 `check_location`(구간 · 지점) · `check_combination`(구간의 `combo`)을 준다. 랩 구간의 Mu · Vu 절반 가정은 호스트가 만든 것이므로 그 사실은 호스트가 덧붙인다.
4. 이름은 `name_ko` 를 쓰고, 경고 문구(`warnings`)는 이번 계약 밖이다(여전히 영 · 한 혼용).

## 10. 소비자가 가정해도 되는 것 / 안 되는 것

가정해도 된다:
- `id` 는 바뀌지 않고, 한 결과 안에서 유일하며, 모두 `REGISTRY` 에 있다.
- `verdict` 를 접은 값 = 옛 `pass`. 지배 항목의 비 = 옛 이용률(반올림 자리까지 — `mirrors`).
- `pass`/`fail` 항목에서 `ratio == demand.value / capacity.value`, 마지막 `design_strength` 단계의 결과 = `capacity`(물리량 강도일 때).
- 단계의 모든 입력에 `source` 가 있고, `source.kind == 'step'` 이면 그 단계 결과와 값 · 물리량이 같다. 단계의 결과는 뒤 단계의 입력이거나 항목의 소요 · 강도 · 비 · 참고값이다(떠도는 숫자가 없다).
- 엄격 JSON(NaN · Infinity 없음).

가정하면 안 된다:
- `steps` 의 `expr` 를 계산해 같은 값이 나온다고 — 입력 가운데 반올림해 넘어온 값(냉간가공 Fya 등, `rounded_to`)이 있다. 화면은 `result` 를 보여야 한다.
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
