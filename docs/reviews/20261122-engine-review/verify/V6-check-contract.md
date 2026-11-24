# V6 — 검토 항목 계약(`design_checks`) · 계산 과정 · 경계층(SI · 요약) 독립 검증

검증 대상: 브랜치 `feature/desktop-program` 커밋 `790492e` (그 안의 `3590808` + `a2d5172` 엔진 계약, `7c9fe81` + `f96f94c` 경계층).
작업 트리가 아니라 `git archive 790492e` 사본에서 돌렸다. 비교 기준은 `804b716`(변경 전)과 `3590808`(§14 의 "수정 전")의 사본.
저장소에서 고친 것은 이 보고서 하나다. 스크립트는 모두
`C:\Users\USER\AppData\Local\Temp\claude\3df7e1c8eb560f18\99d094e4-961f-4f09-9be9-02ec03b2e201\scratchpad\v6\`
에 있다(아래 `v6\`). 경계층 스크립트는 `v6\boundary\` 에 있다. 소스 사본(`src790` · `src804` · `src359`)은 지웠다. 다시 만들려면
`git -C C:\Coding_Works\cufsmAi archive <커밋> | tar -x -C v6\src790` 처럼 하면 된다(경계층 node 스크립트는 그 사본에 `npm ci` 가 필요하다).
기준 원문은 `aisi-cold-formed-steel` 스킬의 S100-16 본문 · 부록 · Design Manual 예제다.

## 요약

**계산 과정의 숫자는 참이다.** 계약 사례 150개와 내가 만든 경계 사례 97개를 돌렸다. 단계 6,303개 가운데 4,588개(계산식이 있는 단계 전부)를
**엔진 코드를 쓰지 않고** 원문 식으로 단계의 입력에서 다시 계산했다(`v6\audit_steps.py`). 결과가 어긋난 단계는 없었다.
갈래 870개도 다시 판정했고, 갈래가 고른 식 번호도 맞았다(`audit_branches.py`).
뿌리 입력 4,290개는 호출자가 준 값과 대조했다(`audit_roots.py`). φ/Ω 는 원문에서 옮긴 표와 대조했다.
식 번호와 조항은 원문 식 목록 430개와 대조했다(`audit_eqlabels.py`). 결과는 다음과 같다.

- 강도를 바꾼 회귀는 없다. `804b716` → `790492e` 를 계약 사례와 내 경계 사례 모두에서 비교했다. 바뀐 값은 표시 반올림, 비의 넷째 자리, 랩 H2 의 꼴(√), 식 번호 문자열뿐이다.
- 일곱 수정은 원문대로다.
- 판정 접기(fail > not_evaluated > pass)는 옛 `pass` 와 모든 사례에서 같다.
- Manual 예제 중간값은 인쇄값과 Manual 자신의 반올림 안에서 맞는다(아래 표).

**결함은 P0 0 · P1 2 · P2 11 · P3 7 건이다.** 판정이 틀린 곳은 찾지 못했다. 문제는 "계산 과정이 숫자를 어떻게 얻었는지 잘못 말하는 곳"과
"AI 가 읽는 요약이 결론을 바꿀 정보를 빠뜨리는 곳"이다.

- **P1 V6-01** §H1.2 계산 과정의 `My` 는 B1y 로 키운 값(앵글이면 B1y·(Muy + PL/1000))인데, 출처가 `user_input Muy` 로 적혀 있다. Pe1y · B1y 단계는 없다. 사용자가 1.0 을 넣으면 화면에는 1.0232 가 "입력값"으로 보인다.
- **P1 V6-02** (경계층) 퍼린 요약이 구간마다 붙은 가정 · 범위 안내 64건을 모두 버린다. 여기에는 "§I6.2.1 조건 (g)–(n) 은 이 도구가 확인하지 않음 — 사용자가 확인해야 함"과 랩 구간의 "F4 제외, Mnd = My" 가 들어 있다. AI 가 "양력 구간 R 계수로 적합"이라고 말할 때 엔지니어가 확인해야 할 조건이 빠진다.

## 결함

| 번호 | 심각도 | 위치 | 한 줄 |
|---|---|---|---|
| V6-01 | P1 | `python/design/member_checks.py:1116-1119` | §H1.2 의 My 는 B1y·Muy(앵글은 B1y·(Muy+PL/1000))인데 출처가 `user_input Muy` 이고 B1y · Pe1y 단계가 없음 |
| V6-02 | P1 | `src/mcp/server.ts:353-408`, `src/webview/StcfsdPanel.ts:2509-2517, 2533-2584` | 퍼린 요약(`summary` · `checks`)이 구간 · 검토 지점의 warnings/assumptions/scope_notes 를 버림 |
| V6-03 | P2 | `python/design/checks.py:549-576` (`set_governing`), `server.ts:339` | 무리의 `governs` 가, 참고 비 > 1 인 미평가 항목보다 낮은 비의 항목에 붙고 요약의 "지배 검토"가 됨 |
| V6-04 | P2 | `python/design/connection_checks.py:177-207` | 적용 범위 밖(나사 d > 0.25 in, 판 t > 3/16 in)의 한계상태가 항목마다 `pass` · `governs` |
| V6-05 | P2 | `lap_checks.py:196-199`, `connection_checks.py:112-119`, `connections.py:2023` | 단계의 입력으로 결과가 나오지 않음(기호에 숨은 ×2, F'nt 의 Ab · Fnt · Fnv · φ 누락, J2.2.2.1-3 의 λ 누락) |
| V6-06 | P2 | `python/design/connections.py:3238-3262` | 지수 1.5(J2.2.4) · 2(PAF C-J5.4-1) 상호작용 값을 선형 비와 max — 고친 랩 H2 와 같은 종류 |
| V6-07 | P2 | `python/design/lap_checks.py:185-188` | Mnd 가 없을 때 랩 뒤틀림을 "구속됐다고 가정"하고 `not_applicable` 로 표시 — 가정을 해당 없음으로 숨김 |
| V6-08 | P2 | `StcfsdPanel.ts:2476-2492` | 패턴 하중에서 검토 지점의 `combination` 이 그 소요를 만든 조합 · 패턴이 아님(포락선) |
| V6-09 | P2 | `StcfsdPanel.ts:2178-2181` (`_envelopeScan`) | 포락선 탐색이 부호를 무시 — 정모멘트 구간 V_max 지점에 부모멘트 크기를 씀 |
| V6-10 | P2 | `src/mcp/server.ts:333-336` | 랩 요약이 패스너 설계 항목 줄을 모두 지우고 "이 응답의 줄에 있다"고 적음(실제로 옮긴 것은 하나) |
| V6-11 | P2 | `src/mcp/siUnits.ts:297` + 엔진의 `expr` 문자열 | SI 응답의 `units_note` 는 "expr 는 단위 없음"이라 하지만 US 상수 · US 숫자가 박힌 식이 있음 |
| V6-12 | P2 | `StcfsdPanel.ts:2465, 2480` | `location.support` 가 0-기준과 1-기준을 섞음, `location.span` 은 늘 null |
| V6-13 | P2 | `test/python/test_review_1123_checks.py`, `test/webview/mcp_si_chain.js:376-388, 963` | 시험이 계산 과정을 다시 계산하지 않고, 위치 · 조합 · 요약 시험이 자기 자신과 비교 |
| V6-14 | P3 | `python/design/aisi_s100.py:206-209` (`_merge_governing_check`) | `governing_check` 를 4자리로 반올림한 이용률과 비교해 고름(반올림 띠에서 이름이 틀림) |
| V6-15 | P3 | `connections.py:2506, 2524` | 아크 심 `de = 0.7d − 1.5t ≤ 0.55d` 를 Eq. J2.3.2.1-3 이라 표시 — 0.55d 상한은 원문에 없음(사내 보수) |
| V6-16 | P3 | `member_checks.py:467, 484` + `siUnits.ts` | Fcre "∞" 를 1e6 ksi 숫자로 싣고, SI 에서는 6,894,757 MPa 로 바꿈 |
| V6-17 | P3 | `siUnits.ts` 변환표 | `Fcre_detail.Lu` 등이 `si_unconverted` 로 감 — Lu 는 SI 응답에 in 으로 남음 |
| V6-18 | P3 | 여러 곳(아래) | 식 번호 · 출처 표기의 작은 오류 |
| V6-19 | P3 | `docs/implementation/20261123-check-contract.md` §14 | 둘째 커밋에서 더한 5 사례의 바뀐 값 15개가 목록에 없음(같은 종류) |
| V6-20 | P3 | `member_checks.py` (I6.2.1 분기) | I6.2.1 자체가 미평가인데 F2 · F3 · F4 에 "I6.2.1 로 대체됨 — not_applicable" 이유 |

### V6-01 [P1] §H1.2 의 My — 키운 값을 사용자 입력이라고 적는다

- 위치: `member_checks.py:1116-1119`.

  ```python
  ins += [q('My', ctx['Muy_amp'], 'moment', demand_source(p, 'Muy') if not ctx.get('angle_note') else
            src('user_input', key='Muy', note=ctx['angle_note'])), ...
  ```

  x 축에는 `Pe1` · `B1x` · `Mx = B1 Mx` 단계가 있다. y 축에는 그런 단계가 없다. 값은 `Muy_amp`(B1y·Muy)인데 출처는 `user_input` / `load_analysis` 의 `Muy` 다.
- 사례 1 (`v6\probe_edges.py` 의 `combined Mx My LRFD`): C9 단면, Pu 2.0, Mux 25, Muy 1.0, KxLx 96, KyLy 48, Cmy 1.0.
  - 계산 과정은 `My = 1.0232` 이고 출처를 `{kind: user_input, key: Muy}` 로 적는다.
  - 결과의 `amplification.alpha_y` 는 1.0232 다. 손계산으로 PEy = π²·29500·0.881/(48/0.89)² = 88.2 kips, B1y = 1/(1 − 2/88.2) = 1.0232 이다.
  - 값과 판정은 맞다. 계산 과정이 숫자를 어떻게 얻었는지가 틀렸다. 독자가 입력 1.0 과 1.0232 를 맞대면 설명할 길이 없다.
- 사례 2 (수정 2 의 사례 `combined angle (P)L/1000`): 사용자 Muy = 0 이다.
  - 계산 과정은 My = 0.0570 을 `user_input Muy` 로 적는다. 덧붙인 설명은 `note` 의 문장(한국어, US 반올림 숫자) 하나뿐이다.
  - PL/1000 = 3·18/1000 = 0.054 와 B1y = 1.0564 는 단계가 아니다.
  - §H1.2 는 "M̄y 또는 M̄y + PL/1000 중 허용 P̄ 가 더 작아지는 쪽"을 요구한다. 그 비교도 단계에 없다.
- 재현: `v6\audit_roots.py`(뿌리 입력 대조 — `('member.axial_bending', 'My', 'Muy')` 4건), `v6\show.py v6\edges790.json "combined Mx My LRFD" axial v`.
- 고칠 방향: y 축에도 `Pe1y` · `B1y` · (앵글이면 `PL/1000` 과 둘 중 선택) 단계를 두고, `My` 는 그 단계를 참조한다.

### V6-02 [P1] (경계층) 퍼린 요약이 구간의 가정 · 범위 안내를 버린다

- 위치는 두 곳이다.
  - `server.ts:353-408` `shapePurlin`: 구간 줄에 알림이 없다.
  - `StcfsdPanel.ts:2533-2584`: 위로 올리는 것은 구간의 `not_evaluated` 뿐이다. `:2509-2517` 은 대표 지점이 아닌 검토 지점의 알림까지 버린다.
- 사례: 8ZS2.25x059(qlip 50), cont-4, 25 ft, D 15 / Lr 100 / W −170 plf, 랩 1.0/2.5 ft, ASD, 관통 체결 데크, wc_N 3.5. 구간은 32개다.
  - 기본 요약에서 빠진 구간 알림은 64건이다.
  - 그 가운데 "§I6.2.1 conditions (g)–(n) are not checked by this tool — the user must confirm" 이 R 을 쓴 양력 구간마다 있다.
  - "F4 explicitly excluded … Mnd = My is used" 가 랩 구간 12곳에 있다.
  - 웹 구멍 범위 안내와 성긴 DSM 격자 가정도 빠졌다.
  - `detail:'checks'` 에도 없다. 도구 설명은 "all warnings / assumptions / not_evaluated" 를 약속한다.
- 재현: `v6\boundary\purlin_probe.js` → `purlin_shape.js purlin_ii2a.json`. 시험 `checkPurlinSummary`(`mcp_si_chain.js:388`)는 최상위 목록만 비교한다.
- 고칠 방향: 구간 · 검토 지점의 warnings/assumptions/scope_notes 를 구간 이름을 붙여 묶음 최상위로 올린다(`not_evaluated` 처럼). 또는 구간 줄에 싣는다.

### V6-03 [P2] 미평가 항목이 더 큰 비를 가질 때 `governs` 가 낮은 쪽에 붙는다

- 위치: `checks.py:549-576`. 계약 §4 대로 평가한 항목 중 최대만 본다. `server.ts:339` 의 `governing_checks` 가 그것을 요약의 "지배 검토"로 싣는다.
- 사례(`v6\gov_vs_reference.py v6\cap790.json v6\edges790.json`, 10건):
  - `bolt assumed e (not decided)`: 무리 `conn.shear` 의 지배는 `conn.bolt.bearing` 0.658(합격)이다. 그런데 `conn.j6.shear_rupture` 는 미평가이고 참고 비가 **1.216** 이다(e = 1.5d 최소 가정).
  - `screw no Pnvs (assumed)`: 지배는 나사 지압 0.959 다. 나사 전단(추정 Pnvs)의 참고 비는 **1.030** 이다.
  - 부재: `compression length missing` 의 지배는 뒤틀림 0.056 이다. 전체 좌굴(기본 길이)의 참고 비는 0.416 이다.
- 전체 판정은 `not_evaluated` 이고, 미평가 항목은 요약 줄에 있다. 그래서 위험한 합격은 아니다.
  하지만 요약의 머리 "governing: Bearing 0.66 pass" 와 `utilization` 0.658 은, 가정한 최소 끝단 거리에서 J6.1 이 1.22 로 불합격이라는 사실을 가린다.
- 고칠 방향: 무리에 참고 비가 지배 비보다 큰 미평가 항목이 있으면 `governs` 를 "미정"으로 표시한다. 또는 요약에 `max_reference_ratio` 와 그 id 를 함께 싣는다.

### V6-04 [P2] 적용 범위 밖의 한계상태를 항목마다 `pass` · `governs` 로 낸다

- 위치: `connection_checks.py:177-207`. `conn.scope` 는 따로 `not_evaluated` 로 서고, 개별 한계상태는 그대로 둔다.
- 사례(계약 사례):
  - `screw out of scope d` (d = 0.375 in): `conn.screw.bearing_tilting` 이 `pass`, `governs` 0.094 다. J4 는 "0.08 ≤ d ≤ 0.25 in 인 나사에만" 적용된다(J4 머리글).
  - `bolt thick (AISC scope)` (t = 0.25 in): `conn.j6.*` 셋과 볼트 전단이 `pass` 다. J6 은 "얇은 판 ≤ 3/16 in. 넘으면 ANSI/AISC 360" 이라고 한다.
- 전체 판정은 `not_evaluated` 로 옳다. 항목 판정은 원문이 적용하지 말라는 식으로 낸 합격이다. 요약의 지배 줄에도 그 항목이 오른다.
- 고칠 방향: `conn.scope` 가 미평가이면 그 범위에 걸린 항목을 `not_evaluated` 로 내리고 값은 `reference` 로 옮긴다. 원문이 적용을 막지 않는 항목(App. A J3.4 볼트 전단 등)은 그대로 둔다.

### V6-05 [P2] 단계의 입력으로 결과가 나오지 않는 곳

계약 §10 은 "단계의 결과는 그 입력과 식에서 나온다"고 약속한다. 내 재계산(`audit_steps.py`)에서 걸린 곳은 셋이다.

1. 랩 H2 의 전단 설계강도(`lap_checks.py:196-199`).
   - 입력은 `Vn = 3.710`, `φv (×2 members) = 0.95` 이고 결과는 `φvVn,lap = 7.049` 다.
   - 0.95 × 3.710 = 3.524 이다. ×2 가 기호 문자열 안에만 있다.
   - ASD 도 같다(`Ωv (×2 members)`).
   - ASD 의 H2 식은 LRFD 기호(`φbMn,lap`, `φvVn,lap`)를 쓰는데, 입력 기호는 `Mn,lap/Ωb` · `Vn,lap/Ωv` 다.
2. 볼트 전단 + 인장(`connection_checks.py:112-119`).
   - `fv = V / (n Ab)` 의 입력은 V 하나다.
   - `F'nt = 1.3 Fnt − (Fnt/(φ Fnv)) fv` 의 입력은 fv 하나다(Fnt · Fnv · φ 가 없다).
   - `Pnt' = n Ab F'nt` 의 입력은 F'nt 하나다.
3. 아크 스폿 판 찢김 Eq. J2.2.2.1-3(`connections.py:2023`): 식에 λ 가 있는데 입력은 t, da, Fu, n 뿐이다(λ 는 앞 단계에 있다).

재현: `v6\audit_steps.py v6\cap790.json`, `v6\audit_steps.py v6\edges790.json`. 지금의 시험(V6-13)은 이것을 못 잡는다.
고칠 방향: 곱해지는 상수(2 members, Ab, Fnt, Fnv, φ, λ)를 입력에 넣는다.

### V6-06 [P2] 비선형 상호작용 값을 선형 비와 같은 "이용률"로 max 한다

- 위치: `connections.py:3238-3262`. `checks` 에 J2.2.4 의 (V/Pav)^1.5 + (T/Pat)^1.5, PAF C-J5.4-1(지수 2 인 경우)을 그대로 넣고, `utilization = max(ratios)` 를 구한다.
- 랩 H2 의 제곱합을 √ 로 바꾼 수정 7 과 같은 종류인데, 남아 있다.
- 사례 `IV-2 arc spot V+T ASD`:
  - `utilization` 0.737 은 J2.2.4 의 1.5 제곱합이다.
  - 하중을 k 배 하면 값은 k^1.5 배가 된다. 선형으로 견줄 수 있는 값은 0.737^(2/3) = **0.816** 이다.
  - 다른 줄은 블록 전단 0.698, 용접 인장 0.595 다.
  - LRFD 는 0.938(선형 0.958)이다.
- 판정(≤ 1)은 같다. 지배 · 머리 이용률 · 여유는 작게 보인다.
- 고칠 방향: 랩 H2 처럼 비로 쓸 때는 값^(1/지수) 로 바꾼다. 계약에 "비 = 선형 하중 배율"이라고 적는다.

### V6-07 [P2] 랩 뒤틀림 — 입력이 없을 때의 가정을 `not_applicable` 로 낸다

- 위치: `lap_checks.py:185-188`.
- `Mnd` 가 없으면 `lap.flexure.distortional` 에 `not_applicable` 를 붙이고, 이유를 "distortion assumed restrained by the lapped member (Manual II-1A)" 로 적는다.
- FIXES §3.1 은 "해당하는데 평가하지 못한 한계상태 → None"이라고 한다. 겹친 Z 의 뒤틀림은 해당하는 한계상태다. 구속은 엔진의 가정이다(§3.1.1 의 `assumptions` 감).
- 옛 `pass` 와 맞추려고 해당 없음으로 접었다. 그러나 이 항목은 요약에서 "해당 없음"으로 읽힌다.
- 사례: `lap bolt Se e=2`, `lap screw no Pnvs`, 내 사례 `lap short length LRFD`.
- 고칠 방향: `not_evaluated`(엔진의 `pass` 도 None 으로) 로 둔다. 가정을 유지하려면 `trusted: false` 와 `assumed: true` 를 붙이고 `assumptions` 에 올린다.

### V6-08 ~ V6-12 (경계층 — `v6\boundary\` 에서 재현)

- **V6-08 [P2] 패턴 하중에서 조합 표시가 소요의 출처가 아니다** (`StcfsdPanel.ts:2476-2492`).
  - 검토 지점마다 `rg.env.combo`(포락선의 지배 조합 이름, 패턴 없음)를 붙인다. M · V 는 패턴들의 포락선에서 온다.
  - 사례: V6-02 입력에 `lr_reduced: true` 를 더했다. 지배 패턴은 "Lr: spans 1,3,4 loaded" 다.
  - 부모멘트 1 의 M_max(x = 24 ft)에서 쓴 M 은 7.59 kip-ft 인데, 표시한 조합 · 패턴의 그 지점 M 은 3.58 kip-ft 다.
  - 검토 지점 36개 중 10개가 이렇다.
  - 재현: `purlin_probe.js purlin_pattern.json pattern` → `station_check.js`.
  - 방향: 지점의 조합 · 패턴을 싣거나 "envelope of …" 로 표시한다.
- **V6-09 [P2] 포락선 탐색이 부호를 무시한다** (`_envelopeScan`, `:2178-2181`). V_max(`:2412`/`:2455`)와 양력 지점 조각(`:2340-2343`)이 max(|M_max|, |M_min|) 을 쓴다.
  - 같은 사례에서 정모멘트 1 의 V_max(x = 75 ft)는 Mu = 112.4 kip-in 을 쓴다. 이것은 부모멘트(−9.37 kip-ft)다.
  - 그 값을 정모멘트 DSM, Lb = 0 으로 검토해 비 2.307 이 나온다. 구간의 참 정모멘트 최대로 하면 1.628 이다.
  - 보수 쪽이지만 요약이 "정모멘트 구간, V_max 75 ft, 2.31 지배"로 위치와 까닭을 잘못 말한다.
- **V6-10 [P2] 랩 요약** (`server.ts:333-336`).
  - `part_of: 'fastener_design'` 이 하나라도 있으면 패스너 설계 줄을 모두 지우고 "이 응답의 줄에 있다"고 적는다. 실제로 옮긴 것은 `conn.detail.bolt_end_distance` 하나다.
  - 사례마다 6–7 줄이 사라진다. 그 가운데 `conn.j6.tension_rupture` · `conn.j6.block_shear` 의 not_evaluated 가 있다.
  - 시험이 이 동작을 굳힌다(`mcp_si_chain.js:376-377`).
  - 재현: `summary_audit.js cases790.json`.
- **V6-11 [P2] SI 응답의 `units_note` 는 `expr` · `condition` 이 단위 없는 문자열이라고 말한다** (`siUnits.ts:297`). 실제로는 US 상수 · US 숫자가 박혀 있다(`expr_units.js`).
  - `Pnb = n (4.64 t + 1.53) d t Fu` (J3.3.2-1): 원문의 단위 환산 계수 α 가 빠져 있다. SI 숫자로 다시 계산하면 틀린다.
  - `Ant = Ag − 2×0.5625×0.105` 처럼 US 숫자가 박혀 있는데, Ag 는 mm² 로 바뀐다.
  - `Usl (… 1 − 1.20×0.7850/3.0000 → 0.6860 …)`.
  - `F_uh … ≤ 260 ksi`. 원문(J5.2.1)은 "HRC ≥ 52 이면 260 ksi 로 **써도 된다**"는 대안이지 상한이 아니다. 엔진은 min(F_bs e^(HRC/40), 260) 으로 쓴다(보수).
  - `d'w ≤ 0.75 in`, `d'w ≤ 0.60 in`, `(t > 0.10 in)`, `Fy < 95 ksi`.
  - 차원이 맞아 SI 에서도 괜찮은 식: 웹 크리플링 Pn, PAF Pnos, 4.2(t2³d)^0.5 Fu2, Lu, E2/F2, 냉간가공.
  - 방향: 엔진이 식 문자열에 숫자를 넣지 않고 상한을 입력으로 둔다. 남는 것은 `expr_units: 'US'` 로 표시한다.
- **V6-12 [P2] `location.support` 의 번호** (`:2480` 은 `r.support` 0-기준, `:2465` 는 `s.support` 1-기준).
  - 정모멘트 1 의 M_max 지점은 support 0, "support 1" 지점은 support 1 이다. 둘 다 x = 0 지점이다.
  - 구간 이름은 "지점 2" 인데 `location.support` 는 1 이다. `span` 은 늘 null 이다.

### V6-13 [P2] 시험이 증명하는 것과 못 하는 것

Python 시험 — `test_review_1123_checks.py`, `_fixes.py`(24개 통과, 13 s):

- `mirrors` 대조(300 개 넘게)는 같은 함수의 반올림 전 · 뒤 값을 맞댄다. 그래서 "옛 키와 같다"는 증명이지 "옳다"는 증명이 아니다.
- `ratio == demand/capacity`, "마지막 설계강도 단계 = capacity", "떠도는 숫자 없음"은 모양 시험이다. **단계의 결과를 그 입력과 식으로 다시 계산하지 않는다.** V6-05 의 숨은 ×2 · 빠진 입력, V6-01 의 잘못된 출처가 모두 통과한다.
- 판정 접기 = 옛 `pass` 시험은 같은 엔진의 두 출력을 비교한다.
- Manual 대조(D–J 장)가 유일한 독립 근거다. 그중 III-3 의 λd 는 Pcrd 를 1.11·Py 로 넣고 λd = (1/1.11)^0.5 를 확인한다(자명). I6.2.1 시험은 손계산이지만 기대값을 같은 식으로 만든다.

경계층 시험 — `mcp_si_chain.js`:

- SI 환산은 독립 계수로 확인한다. 좋다.
- 퍼린 위치 시험(`:963`)은 "x 가 구간 안"과 "조합 = 구간의 조합"을 본다. 둘 다 같은 변수에서 오므로 동어반복이다.
- 요약 시험(`:388`)은 최상위 목록만 본다. 그래서 V6-02 · V6-10 을 못 잡는다.

고칠 방향: `v6\audit_steps.py` 같은 독립 재계산(식 사전)을 시험에 넣는다. 요약 시험은 구간별 알림 · 미평가 id 를 대조한다.

### V6-14 [P3] `governing_check` 를 반올림한 이용률과 비교해 고른다

- 위치: `aisi_s100.py:206-209`. `current = result['utilization']`(4자리로 반올림한 값)와 새 비를 비교한다.
- 사례 `v6\probe_govcheck_rounding.py`:
  - F flexure 비 0.50003 이 0.5000 으로 저장된다.
  - 정모멘트 구간의 비는 0.50002 로 더 작은데, 0.5000 보다 크다.
  - 그래서 `governing_check = 'F positive region'` 이 된다. 옳은 답은 `F flexure` 다.
- 이름만 틀리고 이용률과 판정은 맞다. 수정 3–6 과 같은 종류인데 남아 있다.
- 방향: 반올림 전 최대를 따로 들고 비교한다.

### V6-15 ~ V6-20 [P3]

- **V6-15** 아크 심 `de = 0.7 d − 1.5 t ≤ 0.55 d` 에 `equation: 'J2.3.2.1-3'` 을 붙인다. 원문 Eq. J2.3.2.1-3 은 `0.7d − 1.5t` 뿐이다(0.55d 상한은 J2.2.2.1-5, 아크 스폿).
  엔진 주석도 "0.55d 상한은 보수"라고 한다. d > 10t 이면 강도가 원문보다 낮다(보수). 계산 과정에는 "사내 상한"으로 따로 적어야 한다.
- **V6-16** `Fcre → ∞` 단계의 결과가 숫자 1e6 ksi 다. SI 에서는 6,894,757 MPa 가 된다. null 과 표지를 쓰는 편이 낫다.
- **V6-17** `Fcre_detail.Lu`(RHS F2.1.4), `shear_interaction.lhs/limit`(H2-2), `flexure_reference_dcr`, `auto_generated_section.H/B/D/r` 가 `si_unconverted` 로 간다. Lu 는 길이인데 in 으로 남는다.
- **V6-18** 표기:
  - 단계 식 번호 `J4.5.1-1` · `J4.5.2-1` · `J4.5.3-1` 에 a/b 가 없다. J4.5.3-1 은 원문에 묶음 이름으로도 없다.
  - `Pcrd = Fcrd A` · `Mcrd = Fcrd Sf` 에 식 번호(2.3.1.3-1, 2.3.3.3-1)가 없다.
  - 필릿의 `An = Ag − n dh t` 는 n = 0(구멍 수)인데 출처 key 가 `n`(용접 수 2)이다.
  - 랩 안 패스너 설계의 출처 key `d`(0.5 in)가 랩의 `d`(부재 깊이 8 in)와 겹친다.
  - `Pa` 의 출처 `{kind: check, id: 'member.compression'}` 는 무리 이름이지 등록 id 가 아니다.
  - `Cm` 의 출처가 `user_input dist_M1_M2` 인데 값은 계산한 0.6 − 0.4·M1/M2 다.
- **V6-19** §14 는 `3590808` 의 사례에 대해서는 완전하다(`v6\s14_complete.py`). 다만 둘째 커밋에서 더한 5 사례(arc seam sheet-to-sheet, arc spot small de, bolt oversized holes, bolt part 2 J6.2 J6.3, screw two in a row)의 이용률 넷째 자리 변화 15개는 없다. 같은 종류(수정 4)다.
- **V6-20** `I6.2.1 R exceeds table`: `uplift_r` 는 not_evaluated 로 옳다. 그런데 F2 · F3 · F4 는 "replaced by §I6.2.1 — not_applicable" 이다. 대체할 I6.2.1 이 성립하지 않는데 해당 없음이라고 적는 것은 이유가 틀렸다(전체 판정은 not_evaluated 로 옳다).

## 의심 (재현하지 못했거나 판단이 갈리는 것)

- **S-1 랩의 J6.3.** 랩의 `pass` 는 True 인데 안의 `fastener_design.pass` 는 None 이다(`lap bolt Se e=2`, `Se Mnd`, `short lap`, `screw Pnvs ASD`).
  - J6.2 · J6.3 은 "패스너 1개 강도가 아니다"라며 Pns 에서 뺐다. 그 뒤 랩 패스너 무리의 블록 전단(플랜지 끝으로 빠지는 경로)은 어디서도 검토하지 않는다.
  - 판정에 넣을지는 공학 판단이다. 넣지 않는다면 랩 결과에 "J6.3 무리 블록 전단 미검토"를 적어야 한다.
- **S-2 서로 다른 조합의 섞임.** 패턴만이 아니라, 조합 6a(Wp)와 3(Lr 패턴)이 지점마다 다르게 지배하면 V6-08 은 "패턴 누락"이 아니라 "틀린 조합 이름"이 된다. 하중 결과에 지점별 조합이 없어 보이지 못했다.
- **S-3 허용오차 1e-9.** 접합부 판정은 `V ≤ cap + 1e-9`(절대값, `connections.py:3219`, `connection_checks.py:88`)다. 항목 비는 V/cap 이다. 비가 1 + 1e-10 이면 `pass` 와 비 > 1 이 함께 나올 수 있다. 실제 사례는 만들지 않았다.

## 건전한 것 (증거와 함께)

- **계산 과정 = 계산.** `audit_steps.py` 로 다시 계산한 단계가 계약 150 사례에서 2,708개, 경계 97 사례에서 1,880개다. 원문 식으로 다시 계산해 상대오차 1e-7 안이었다. 다음을 모두 포함한다.
  - E2(E2.1-1, E2.2-1/-3/-4/-5/-6, §E2.3 점대칭), E3.2.1, E4.1
  - F2(F2.1-3/-4/-5, F2.1.1-1, F2.1.3-1, F2.1.4-1/-2, F2.3, F2.4.2), F3.2.1, F4.1(β 2.3.3.3-3 포함), F4.3
  - G2.1, G2.3, G5, H1.1, H1.2, H2-1/-2, H3-1/-2, I6.2.1
  - D2/D3, J2.1, J2.2.2.1-1~-4, J2.2.2.2, J2.2.3, J2.2.4, J2.3.2.1/.2, J2.5-1~-7, J2.6-1/-2/-4/-7
  - J3.3.1(C 세 범위, 과대공), J3.3.2, App. A J3.4, J4.3.1(세 갈래와 보간), J4.4, J4.5.1~.3(합리적 해석 포함), J5.2 · J5.3 · C-J5.4
  - J6.1~J6.3(J6.2-4/-5/-6), 냉간가공 A3.3.2, 부록 1 Eq. 1.1-4, 부록 2 표 2.3.1.3-1 · 2.3.1.3-2~-7 · 2.3.3.3-2/-4/-5/-6, 랩 모델
  - 단계 참조(`source.kind = step`) 불일치는 0 이다.
- **갈래.** 870개를 입력으로 다시 판정했다. `holds` 와 고른 식 번호가 모두 맞았다. 각 갈래의 양쪽을 다 지났다(F2.1 세 갈래, λℓ · λd 양쪽, λv 세 범위, 아크 스폿 세 범위, 나사 t2/t1 세 범위, CJP 전단의 용접/모재 선택 ASD · LRFD).
- **φ/Ω.** 원문 표와 대조했다. 부재 E · F · F2.3(φ 0.95) · G2 · D2/D3 · I6.2.1, 접합 J2.1/J2.2/J2.3/J2.5/J2.6, J3.3.1/J3.3.2, App. A J3.4(2.00/0.75), J4(3.00/0.50), J4.5(2.35/0.65, 2.55/0.60), J5(각 절), Table J6-1(용접 2.50/0.60 · 볼트 2.22/0.65 · 나사 · PAF 3.00/0.50)을 ASD · LRFD 모두 확인했다.
  G5 표 행(C · Z, EOF/IOF/ETF/ITF, 체결/비체결)의 C · CR · CN · Ch · φ · Ω 도 맞다. H3 의 1.33/1.46 과 Ω 1.70 / φ 0.90 도 맞다.
- **식 번호 · 조항.** 등록표와 모든 단계의 `equation` 을 원문의 식 목록 430개와 대조했다. 없는 번호는 V6-18 의 a/b 생략뿐이다. 앞의 틀린 F2-1 표기는 고쳐졌다.
- **판정 · 지배.** 계약 사례와 경계 사례 모두에서 다음이 성립한다.
  - 접기 = 옛 `pass` 다.
  - 무리당 `governs` 는 하나이고, 평가한 것 중 최대다.
  - `not_evaluated` 에 capacity · ratio 가 없다.
  - 비가 정확히 1.0 이면 pass, 1 ulp 위이면 fail, 1+1e-7(표시값 1.0000)이면 fail 이다(`probe_edges.py`).
  - 소요가 0 이면 not_evaluated(소요 없음)다. 손 단면(템플릿 없음) · B4 밖 · 앵글 · hat · RHS/CHS · 둥근/날카로운 모서리에서 예외가 없다.
- **일곱 수정.** 원문대로다.
  - F2.1-3/-4/-5 이름.
  - 앵글 PL/1000 을 넣고 판정한다(§H1.2 문장대로). 다만 V6-01 의 계산 과정 표기 문제가 있다.
  - 반올림 전 값으로 판정한다(정모멘트 구간, 접합부 · 랩, H1, 웹 크리플링).
  - 랩 H2 = √ 꼴(Eq. H2-1).
  - **강도는 바뀌지 않았다.** `804b716` → `790492e`: 계약 150 사례 319 차이, 경계 97 사례 284 차이가 모두 표시 반올림 · 비 넷째 자리 · 랩 H2 꼴 · 식 문자열이다(`cmp_804_790.txt`). §14 목록은 자기 사례에 대해 완전하다(V6-19 제외).
- **경계층(포크 검증).**
  - SI 환산 13,504 값이 독립 계수와 정확히 같다. 14 개 quantity 가 모두 나오고 모르는 것은 없다. `rounded_to` · `location.Lb` · `half_wavelength` · `location.x` 도 맞다.
  - 단일 결과 요약은 fail/not_evaluated 항목을 하나도 빠뜨리지 않았다(하위 결과에서 올린 것 포함).
  - 크기 상한은 실제 측정 11.0 KB / 12 KB, 퍼린 28.2 KB / 40 KB 다. 다만 강제는 시험에서만 한다.
  - `get_design_check` 는 현재 결과 칸에서만 내준다. 낡은 계산 과정을 내주는 경로는 없었다.
  - 패턴이 없는 퍼린의 M_max 지점 44개가 모두 부호에 맞는 최대 |M| 지점이다. 양력 "7: 0.6D+0.6W" 와 중력 "3: D+Lr" 이 서로 뒤바뀐 곳은 없다.

## Manual 대조 (중간값)

| 예제 | 값 | Manual | 엔진 | 판단 |
|---|---|---|---|---|
| III-3 | σex / σt / β / Fcre(E2.2-1) | 42.0 / 24.4 / 0.598 / 18.5 ksi | 41.93 / 24.42 / 0.5985 / 18.53 | 반올림 |
| III-3 | λc / Fn / Pne | 1.64 / 16.3 ksi / 6.88 kips | 1.643 / 16.25 / 6.858 | 반올림 |
| III-3 (부록 2 해석식, Pcrd 미입력) | kφfe / kφwe / k̃φfg / k̃φwg / Pnd | 0.348 / 0.270 / 0.00823 / 0.00251 / 16.7 | 0.3481 / 0.2703 / 0.008225 / 0.002511 / 16.72 | 일치 (`manual_iii3.py`) |
| II-1B | λℓ / Mnℓ / φMnℓ | 1.22 / 93.6 / 84.2 | 1.222 / 93.60 / 84.24 | 일치 |
| II-1B | β / βMcrd / λd / Mnd / φMnd | 1.23 / 132 / 0.977 / 99.9 / 89.9 | 1.2266 / 131.37 / 0.9792 / 99.73 / 89.76 | Manual 이 β 를 1.23 으로 반올림해 곱함 — 엔진이 맞다 |
| I-8B (자동 FSM) | Mne/Ω · Mnℓ/Ω · Mnd/Ω · λd | 75.4 · 56.0 · 55.4 · 1.09 | 75.32 · 56.08 · 55.55 · 1.079 | Mcrd 107.9 (Manual 107) 차이 — 뒤틀림 지배는 같음 |
| II-2A | Va (전단) | 2.43 | 2.4345 | 일치 |
| III-11 | Pe1 / B1 | 337 / 1.27 | 337.4 / 1.2713 | 일치 |
| IV-1 | Pnv/Ω · φPnv | 4.33 · 6.60 | 4.316 · 6.581 | 반올림(Manual 13.2 로 곱함) |
| IV-2 ASD | 용접 · 찢김 · J6.1 · J6.2 · J6.3 | 3.90 · 3.05 · 2.43 · 2.19 · 1.86 | 3.898 · 3.051 · 2.430 · 2.193 · 1.863 | 일치 |
| IV-3 ASD | 찢김 · J6.1 · J6.2 | 3.05 · 2.81 · 3.90 | 3.049 · 2.808 · **3.069** | J6.2: 엔진은 A1.2(c)(Usl = 0.9 + 0.1(L+d)/s, Ω 3.00) — 문서화된 보수, Manual 은 Usl 1.0 · Ω 2.50 |
| IV-9 ASD | J6.1 · J6.2 · J6.3 · 지압 · D2 | 3.67 · 5.68 · 4.91 · 5.67 · 8.32 | 3.672 · 5.660 · 4.895 · 5.670 · 8.299 | Manual 중간 반올림(Ant 0.302, Anv 0.151, Tn 13.9) |
| IV-11 | J4.5.1 / J4.5.2 / J4.5.3 (ASD) | 0.379 ≤ 0.468 / 0.409 ≤ 0.451 / 0.199 ≤ 0.433 | 0.3791 / 0.4681, 0.4086 / 0.4510, 0.1986 / 0.4333 | 일치 |
| IV-11 | J4.5.1 / J4.5.2 (LRFD) | 0.632 ≤ 0.715 / 0.681 ≤ 0.690 | 0.632 / 0.715, 0.681 / 0.690 | 일치 |
| IV-12 | C-J5.4 ASD / LRFD | 0.610 / 0.648 | 0.6105 / 0.6476 | 일치 |

## 확인하지 못한 것

- LSD(캐나다), EWM 경로(II-1A · II-2A 의 Se), F2.1.2, 구멍(G6 · E3.2.2 · F4.2), I6.2.2–I6.2.4. 이번 변경이 계산 과정을 붙이지 않았거나 사례가 없다.
- FSM 서명곡선 자체와 반파장 값. V1/V2 의 범위라 다시 하지 않았다. 반파장이 단계로 실리고 SI 로 바뀌는 것만 확인했다.
- 화면(`desktop/ui/`, 웹뷰)에서 이 필드들이 어떻게 그려지는지.
- V6-08 의 조합 섞임(S-2). 하중 해석 출력에 지점별 조합이 없다.
- G5 의 모든 표 행. 이번에 쓴 C · Z 10 행만 대조했고, 나머지는 V2 가 대조했다.

## 스크립트 (`v6\`)

| 파일 | 하는 일 |
|---|---|
| `audit_steps.py <capture>` | 단계 결과를 원문 식으로 다시 계산, 설계강도 · 판정 단계, 항목 비 · 판정, φ/Ω 표 |
| `audit_branches.py <capture>…` | 갈래 `holds` 와 식 번호 |
| `audit_roots.py <src> <edges>` | 뿌리 입력 = 호출자 값 |
| `audit_eqlabels.py <src/python> spec_eqs.txt <capture>…` | 식 번호 존재(`spec_eqs.txt` = 스킬 원문의 식 목록) |
| `audit_quantities.py` | 기호별 quantity 일관성 |
| `probe_edges.py <src/python> <out>` | 경계 사례 97개 + 접기 · 지배 검사 |
| `gov_vs_reference.py` | V6-03 |
| `probe_govcheck_rounding.py <src>` | V6-14 |
| `manual_iii3.py <src>` | III-3 부록 2 해석식 대조 |
| `s14_complete.py` | §14 목록 완전성 |
| `show.py`, `conn_table.py`, `inventory*.py` | 보기 도구 |
| `boundary\*.js`, `boundary\dump_cases.py` | 경계층(V6-02, V6-08~V6-12, V6-16, V6-17) |

캡처는 `contract_cases_1123.py capture` 로 다시 만든다(`cap790.json` · `cap804.json` · `cap359.json`). 경계 사례는 `probe_edges.py` 로 다시 만든다(`edges790.json` · `edges804.json`).
