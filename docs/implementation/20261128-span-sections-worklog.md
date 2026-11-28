# 경간마다 다른 퍼린 단면 — 작업문서

- 시작: 2026-11-28
- 요청: 「지금은 경간이 여러 경간이라도 검토할 퍼린 단면은 동일한 단면만 가능해. 경간마다 퍼린 단면을 다르게 지정 가능한 방법이 있을까?」 → 권장안을 보인 뒤 「네 권장안대로 진행해줘」
- 방식: 오케스트레이터 + Opus 서브에이전트. 단계가 끝날 때마다 이 문서를 고친다.
- 브랜치: `feature/desktop-program`. 단계마다 커밋. 푸시는 사용자가 말할 때.
- 기준점: `253adb1`(구멍 · 보강재 · 비틀림까지 — master `a9fe2e5` 보다 9 커밋 앞, 푸시 전)

---

## 1. 지금 상태(코드에서 확인)

- 검토 대상 하나 = 단면 모델 하나(`this._model`). 퍼린 사슬(`StcfsdPanel._designPurlin`)이 그 단면의 성질 · 서명곡선 좌굴값(정 · 부 두 번)으로 모든 구간(정모멘트 · 부모멘트 · 랩 · 양압)을 검토한다.
- 하중 해석(`analyze_loads`)은 경간별 Ix(`I_span_in4` — 화면의 「경간별 Ix」 `spanIxIn4`)를 받는다. 랩 구간의 Ix 는 양쪽 부재의 합(설계 매뉴얼 II-1A · II-2A 의 가정 (b)). 그러나 데크 강성 · §I6.2.1 조건 · 양압의 R 은 `section` 하나로 본다.
- 랩 구간은 「같은 부재 둘」 — 각 부재가 M · V 의 절반(`share = 0.5`, 매뉴얼 II-2A 의 가정 (a) – (c): 두 부재 강도의 합).
- 랩 안 지점의 웹 크리플링은 모형화하지 않는다(「평가하지 못함」).

---

## 2. 정한 것(사용자가 고른 권장안)

| # | 무엇 | 정한 값 | 까닭 |
|---|---|---|---|
| S1 | 단면을 주는 방법 | 검토 대상의 **단면 목록** — 첫째(S1)는 지금의 단면 모델, 그 뒤(S2 …)는 같은 템플릿의 치수(H · B · D · t · r …)로. 경간 표에 경간마다 단면을 고르는 칸. 처음 값은 모든 경간이 S1(지금의 결과와 본문이 바이트까지 같다) | 실무의 흔한 꼴(같은 춤에 단부 경간만 두껍게). 완전히 다른 종류의 단면을 자유롭게 넣는 것은 「단면 하나」 의 전제를 편집기 · 해석 화면 · 파일 · 기록까지 바꿔야 해 하지 않는다 |
| S2 | 템플릿 | 추가 단면은 S1 과 같은 템플릿 종류여야 한다. S1 이 직접 그린 단면이면 이 기능을 쓸 수 없다(모든 경간이 S1) | 겹침(랩)은 같은 종류의 부재끼리다. 치수로 만든 단면만 웹 · 플랜지를 가려낼 수 있다 |
| S3 | 랩에서 두 부재의 몫 | **강성(Ix)의 비로 나눠 각 부재를 따로 검토** — M_i = M·I_i/(I_1 + I_2), V 도 같은 비. 두 단면이 같으면 지금처럼 절반씩(결과가 그대로다) | 기준에 식이 없는 설계 가정. 강도의 합(매뉴얼의 가정)은 두 부재가 같이 한계에 이를 때의 값이라 다른 부재끼리는 강성으로 나누는 쪽이 안전측이다 — 강도의 합으로 본 값은 참고로 함께 낸다 |
| S4 | 춤이 다른 부재의 랩 | 겹친 두 부재의 춤이 다르면 그 랩 구간은 「평가하지 못함」 과 까닭 | 매뉴얼의 가정은 같은 춤의 겹친 부재다 |
| S5 | 랩 패스너 | 지압은 얇은 쪽 두께로, 우력의 팔은 불리한 쪽으로(엔진이 정하고 결과에 적는다) | 안전측 |
| S6 | 경간별 Ix | 단면을 경간마다 주면 Ix 는 그 단면에서 저절로. 「경간별 Ix」 를 사람이 따로 넣었으면 그 값을 쓰되, 단면의 값과 1 % 넘게 다르면 알린다 | 넣은 값을 말없이 버리지 않는다 |
| S7 | 데크 강성 · §I6.2.1 · 양압의 R | 경간마다 그 단면으로 | 그 값들은 단면의 치수에 달렸다 |
| S8 | 좌굴 해석 보기 | 끼운 화면의 해석 탭은 지금처럼 S1 의 모델로. 퍼린 결과에 단면마다의 성질 · 좌굴값(정 · 부) · 서명곡선을 싣고, 검토 화면에서 단면을 골라 본다 | 해석 탭이 모델을 바꾸면 「단면 하나」 의 전제가 흔들린다 |
| S9 | 구멍 · 보강재 | 지금의 입력이 모든 단면에 같이 적용된다(구간의 검토에 그 구간 단면의 모델을 싣는다). §H4 는 퍼린 사슬에 없다(그대로) | 단면마다 다른 구멍은 이번 범위 밖 |
| S10 | 맞대 볼 것 | 설계 매뉴얼 II-1A · II-2A(경간마다 부재가 다른 예제)의 소요 강도 · 구간 검토 | 엔진의 `I_span_in4` 가 그 예제의 가정을 따르려고 들어간 것이다 |

---

## 3. 단계표

| 단계 | 내용 | 닿는 곳 | 상태 |
|---|---|---|---|
| E | 엔진 — 하중 해석의 경간별 단면(데크 강성 · §I6.2.1 · 양압 R · Ix), 구간 기록에 경간, 랩 접합의 두 부재 | `python/**` | 끝(`11e0fb2`) |
| H | 호스트 — 검토 상태의 단면 목록 · 경간의 단면, 편집 화면의 칸, 퍼린 사슬(단면마다 성질 · 좌굴값, 구간마다 그 단면, 랩의 몫), MCP 인자, 읽는 곳, 파일 · 기록, 고정값 | `src/**`, `webview/**`, `test/**` | 끝 |
| D | 데스크톱 — 단면 목록 · 경간의 단면 보기, 구간의 단면 표시, 단면을 골라 보는 좌굴값 · 곡선, 시험 | `desktop/**` | 진행 중 |
| V | 독립 검증 — 구간과 단면의 짝, 랩의 몫, 경간별 데크 강성 · R, 매뉴얼 예제 | 읽기만 | 진행 중 |
| M | 마일스톤 — 닿는 시험 전부 한 번(`test:rendered` 포함), 설치 파일 · 포장본 | — | |

---

## 4. 단계별 기록

### E — 엔진(끝, 커밋 `11e0fb2`)

**하중 해석의 `span_sections`.** 경간마다 단면 하나(지금의 `section` 과 같은 꼴 + `id`). 없으면 결과는 바이트까지 그대로, 모든 경간이 같은 단면이면 한 단면의 결과와 같다(시험). Ix 는 그 단면에서 — `I_span_in4` 를 따로 주면 그 값을 쓰고 1 % 넘게 다른 경간마다 경고. 데크 강성(`deck_by_span`) · §I6.2.1 의 조건과 양압 R(`i621_by_span` · `uplift_R_by_span`)은 경간마다. 단부 지점의 웹 크리플링 경우는 그 지점의 깊은 쪽 부재로. E 는 첫 단면의 것(재료는 모든 경간이 같다고 본다).

**구간의 경간.** `span_sections` 를 준 때만 구간 기록에 `span`(그 구간의 최대 모멘트가 있는 경간) · `spans` · `crosses_support` 가 붙는다(없으면 「모든 경간이 S1」). 랩 구간에는 두 부재(`lap_members` — 단면 · Ix · 춤 · 두께 · 몫 · 이어지는 쪽 / 끝나는 쪽), `share_by_stiffness`(반올림 전 I_i/(I_1 + I_2)), `depth_mismatch` · `lap_evaluable`. `span_map`(경간 · 랩의 자리와 단면). 양압의 상부 압축 구간을 호스트가 자르던 그대로 자른 `uplift_bracing.positive_pieces`.

**랩 접합 · 랩 길이의 둘째 부재**(`t_2` · `d_2` · `Se_2` · `Sf_2` · `Mnd_2` · `Vn_2` · `h_web_2` · `Ixx_2`). 패스너는 두 판의 차례를 둘 다 보고 작은 Pns, 우력의 팔은 d − t 가운데 작은 것, 블록전단은 얇은 판, 랩의 휨은 강성비의 몫으로 부재마다(Mn,lap = min(Mnℓ,i / s_i) — 강도의 합은 `flexure_reference_sum_of_strengths` 로 참고), H2 는 부재마다. 춤이 다르면 모든 검토가 「평가하지 못함」. 둘째 부재의 값이 없으면 지금과 같다.

**설계 매뉴얼이 겹친 부재에 대해 말하는 것**(에이전트가 II-1A · II-1C · II-2A 를 열어 봄): (a) 겹친 부분은 완전 연속으로 이어졌다 (b) 전단 · 모멘트 그림은 단면이 변하는 연속 부재의 것이고 겹친 부분의 Ix 는 두 부재 Ix 의 합 (c) **겹친 부분의 강도는 두 부재 강도의 합.** 두 예제 모두 경간마다 부재가 다르다(II-1A: 단부 9CS2.5x070 · 내부 x059, Ix 12.2 / 10.3. II-2A: 8ZS2.25x070 · x059, Ix 9.18 / 7.76). 첫 내부 지점의 랩에서 매뉴얼은 다른 두 부재의 강도를 그대로 더한다 — II-1A: φMnℓ = 0.90·(11.3 + 8.66) = 18.0 kip-ft(Mu 12.0), φVn = 0.95·(5.76 + 3.44) = 8.74 kips. **결정 S3 는 이와 다르다**(강성비로 나눠 부재마다 — 같은 랩에서 얇은 쪽 0.705, 강도의 합으로는 0.667): 사용자가 고른 안전측의 규칙이고, 강도의 합은 참고로 같이 낸다. 데크 강성도 매뉴얼(II-1C)은 얇은 쪽 하나로 한 번 계산하고 「안전측의 근사」 라고 한다 — 결정 S7 은 경간마다(두꺼운 단부 경간의 kφ 0.1417 대 0.1126 kip-in/rad/in).

**맞대 본 값**(매뉴얼 → 엔진, kip-ft · kips). II-1A(1.2D + 1.6Lr): 단부 경간 +M 7.36 → 7.355, 첫 내부 지점 12.0 → 12.033, 내부 경간 +M 3.16 → 3.171, 가운데 지점 7.16 → 7.165, 반력 1.54 · 4.74 · 3.66 → 1.544 · 4.726 · 3.661, 양압(0.9D + 1.0W) −5.93 → −5.925 · −2.56 → −2.554(R 0.60). II-2A(D + Lr, 1 ft 내민 끝): +M 5.11 → 5.106, 첫 내부 지점 8.75 → 8.751, 가운데 지점 4.95 → 4.950, 반력 1.21 · 3.37 · 2.58 → 1.205 · 3.375 · 2.571, 양압 −4.13 → −4.129(R 0.70). 랩 접합(0.070 / 0.059 판, 지압이 지배하게): Pns 0.918 kip(두꺼운 판이 머리 쪽) 대 1.004(반대) · 1.187(0.070 둘). 랩의 휨: 강성비로 227.1 kip-in(둘째 부재가 지배), 강도의 합으로 239.8.

**시험.** 파이썬 전체 598 통과(오케스트레이터가 직접 — 새 12, `test_review_1128_span_sections.py` · 앞 커밋의 결과를 담은 기준 10 사례). 고친 기대값 없음.

### H — 호스트(끝)

**상태.** `CaseState.sections` 에 S2 부터(`{id, name, template, params {H, B, D, t, r, qlip}}`, US 인치). S1 은 저장하지 않는다 — 언제나 모델이다. 경간의 단면은 경간 표의 넷째 키 `spans.spanSections`(처음 값은 모두 `'S1'`). 출처 · 판은 `spanSections` · `sections` 로 따로. 함께 쓰는 규칙은 `designState.js`(`validateSections` · `validateSpanTable(…, ids)` · `spanSectionsPayload` · `collectSections` · `sectionsShownSame`). 두 키가 바뀌면 하중 해석부터 아래가 무효.

**파일.** `case.spans.spanSections` · `case.sections` 는 처음 값이 아닐 때만 적는다 — 처음 값의 파일 · `caseFp` · 결과 봉인은 앞과 바이트까지 같고, 옛 파일은 모든 경간이 S1 로 열린다.

**편집 화면.** 경간 표에 경간마다 고르는 칸(`.span-tbl-sec`), 그 아래 「단면 목록」(`#sec-list-block` · `#btn-sec-add` · 행 `.sec-row[data-sec-id]` 에 치수 칸 `.sec-p[data-p]` · 이름 · 지우기 · 계산된 Ix).

**정한 규칙.**
- 지운 단면을 쓰던 경간은 S1 로(변경 묶음에 보인다). 경간 수 · 경간 종류가 바뀌면 모든 경간이 S1(단면 목록은 남는다).
- 템플릿 종류가 바뀌었거나 저장된 단면이 모델과 맞지 않으면 그 단면은 남기되 막는다 — 행을 표시하고, 실행하면 그 단면을 이름으로 든 오류. 말없이 버리지 않는다.
- 직접 그린 · 고친 · 원형관 모델이면 추가 단추가 까닭과 함께 꺼지고, `set_case_inputs` 는 `sections` 를 거절한다(`host.case.sections_need_template`).
- 랩 없이 단면이 바뀌는 지점을 넘는 구간은 닿는 단면마다 그 구간의 소요 강도 전부로 검토 — 불합격이 이기고, 그다음 평가하지 못함(`host.purlin.section_change_rule`).
- 랩 접합 도구가 보는 랩은 `connLapSupport`. 비었고 마지막 퍼린 결과에 경간별 단면이 있으면 그 결과의 지배 랩을 쓰고 결과에 그렇게 적는다.

**사슬.** 쓰이는 단면마다 모델의 사본 + `generate_section` 으로 모델을 만들어 성질 · 형상(절점 / 요소로 기억). 서명곡선은 (단면 모델의 서명, 하중, Fy, 스프링)으로 기억 — 부모멘트는 단면마다 하나, 정모멘트는 (단면, 그 경간의 데크 강성)마다 하나. 하중 해석에 `span_sections`(S1 은 본문의 `section`, 나머지도 같은 함수 `loadSectionFromParams` 로 — S1 과 치수가 같은 S2 는 같은 엔진 단면). `I_span_in4` 는 사람이 넣은 때만. 양압의 R 은 그 구간의 `uplift_R`, 조각은 `positive_pieces`. 경간이 없는 구간, 부재나 몫이 없는 랩, 춤이 다른 랩은 「평가하지 못함」 — 합격이 아니다.

**랩.** 부재마다 `share_i·M` · `share_i·V` 를 그 부재의 단면으로 검토, 지배 부재가 구간의 판정과 판정비. II-1A 의 둘째 지점 왼쪽 랩: 몫 0.5418(S1, x070) · 0.4582(S2, x059), 부재의 판정비 0.7426 · 0.8607 → S2 가 지배. 강도의 합(매뉴얼의 가정 (c), 참고): 144.42 / (111.81 + 84.23) = 0.7367. 두 부재가 같으면 몫이 정확히 0.5 이고 모든 구간의 판정비 · 판정 · 강도가 한 단면의 실행과 같다(시험).

**결과의 새 키**(경간별 단면을 쓴 때만). 맨 위 `span_sections` · `span_map` · `sections[]`(`{id, name, template, params, source, spans, props, geometry, dsm_pos, dsm_neg, dsm_pos_by_deck?, deck[], curves{pos, neg, pos_by_deck?}}`). 구간에 `section_id` 와 엔진의 경간 키, 랩 구간에 `lap_members[]`(단면 · 경간 · 역할 · 몫 · 판정 · 판정비 · 지배 검토 · Mu · Vu · 설계 강도) · `governing_member` · `share_basis` · `reference_sum_of_strengths`, 넘는 구간에 `sections_checked[]` · `section_rule`, 평가하지 못한 구간에 `not_evaluated_reason`.

**MCP.** `design_purlin` · `analyze_loads` 에 `sections: [{id?, name?, H, B, D, t, r, qlip}]`(부른 쪽의 단위) · `span_sections: ['S1','S2',…]`. `sections` 는 통째로, `span_sections` 도 통째로 — 경간 표를 주면서 `span_sections` 를 안 주면 모든 경간이 S1(`I_span_in4` 와 같은 묶음 규칙). `set_case_inputs` 는 `spans.spanSections` 와 `sections` 전체를, `get_case_inputs` 는 둘 다(SI 면 mm). 요약 답의 구간 줄에 `section_id` · 간추린 `lap_members` / `sections_checked` · `governing_member` · `reference_sum_of_strengths_ratio`, `sections[]` 는 곡선 · 형상 없이. 크기(32 구간의 II-1A, SI): `run_case_check` 요약 39,384 B(예산 40 KB — 한 단면일 때 37,547 B), `get_case_inputs` 12,070 B(12 KB). **여유가 얇다 — 검증에서 본다.**

**알림.** `host.purlin.sections_per_span` · `lap_two_members_stiffness` · `lap_stiffness_share` · `section_change_rule` · `region_not_evaluated` · `i621_r_some_spans` · `sum_of_strengths_reference` · `host.lap.two_sections` · `host.lap.governing_support`. 검증 항목 `val.load_analysis.span_sections` · `deck_section.N` · `dsm_section.N` · `uplift_r_span` · `lap_members`.

**고정값 · 시험.** k2 는 `defaults.json` 만(새 칸과 처음 입력의 `spanSections` / `sections` — 까닭을 적어 뒤집음), k3 는 바뀐 것 없음. 목록 문서(k2 · k3) 다시 만듦. 고친 시험: `design_prepare_contract`(부모멘트 면을 글이 아니라 값으로) · `k2_case_state` · `mcp_si_chain` · 두 `inventory.js`. 새 시험: `test/webview/span_sections_contract.js`(`test:webview` 에) · `test/rendered/span_sections.js`(`test:rendered` 에). 에이전트의 마지막 실행: `test:quick` · `test:webview` 의 모든 스크립트 · 기록 155 · `test:rendered` 15 + 11 + 3 · `test:k2` 21/21 · `test:k3` 불일치 0. 오케스트레이터가 다시 본 것: `test:quick` · 새 계약 시험 · 제어 문자 / CRLF 없음.

**하지 않은 것.** 랩 도구에 `Mnd_2` · `h_web_2` 는 보내지 않는다(첫째 부재의 것도 지금 보내지 않는다). 서명곡선의 기억은 메모리뿐(파일을 열면 단면마다 다시 푼다). `get_full_state` 와 보기 계약에 단면 목록이 없다. 좁은 왼쪽 단에서 단면 목록 표가 옆으로 밀린다. `I_span_in4` 를 사람이 넣으면 랩의 몫은 넣은 값에서(엔진을 따른다).

### V — 독립 검증이 찾은 결함 고침(커밋 전)

| # | 무엇이 틀렸나(재현) | 고친 것 | 시험(`span_sections_contract` P0 · P6) |
|---|---|---|---|
| 1 | 랩 없이 단면이 바뀌는 지점의 §G5 · §H3 을 단면 하나로(S1\|S1\|S2\|S2, S2 t 0.050 — 지점 3 을 S1 로만 0.560 / 0.686) | 지점에서 만나는 두 경간의 단면마다 — 그 단면의 다른 구간에 지점을 붙인다(없으면 평가하지 못함 `host.purlin.support_section_unchecked`). 결과 `support_sections_checked[]`, 가정 `host.purlin.support_section_change` | 지점 3: S1 0.560 / 0.686 합격 · S2 1.158 / 1.322 불합격, 거울 꼴 · 끝 지점 |
| 2 | 주지 않은 단면 치수 → 엔진의 처음 값(qlip 90 · r 0) | `designState.fillSectionDims` — S1(모델의 템플릿 치수)의 값으로 채워 상태에 적고 답에 `host.case.section_dims_from_s1`(부른 쪽 단위). S1 에도 없으면 오류(`host.case.section_dims_missing`). design_purlin · analyze_loads · set_case_inputs | `[{t: 0.085}]` → 나머지 S1, US · SI 글, S1 을 고쳐도 S2 그대로, r 없는 모델 → 오류 |
| 3 | 퍼린 결과 없이 랩 접합 → S1 두 장(Pns 1.187) | `utils.lapMembersFromSections`(화면 · 호스트 한 함수) — 지점의 두 경간 단면의 t · 깊이(Se · Vn · Ix 는 없음 → 평가하지 못함), `host.lap.members_from_list`. 지점이 없고 단면이 다르면 거절 | 지점 2: t 0.070 · t_2 0.059 → Pns 0.918, 빈 지점 → 거절 |
| 4 | 경간 표를 span_sections 없이 → 말없이 모두 S1 | 그 답에 `host.case.span_sections_reset`, 목록이 있는데 모두 S1 인 퍼린 · 하중 결과에 `host.purlin.sections_listed_unused` | P1(그 한 줄 밖은 같다) · P6 |
| 5 | 목록이 없는 처음 길에서 경간 수를 바꾸면 「경간 n 단면」 필드 | 없는 자리는 S1 | 4 → 5 경간: 단면 필드 없음 |
| 6a | analyze_loads 기본 답 121.3 KB | 요약에 경간마다 짧은 줄(`i621_by_span` · `deck_by_span`), 맞지 않는 조건 글은 한 번, 전체는 detail:'full'(server.ts) | 95.2 KB |
| 6b | 퍼린 요약 40 KiB 를 지키는 것이 없음(6 경간 52 KB) | 넘을 때만: 합격 · 지배 아님 구간 줄을 가장 작은 꼴로, more 에 그 id 와 얻는 곳. 그래도 넘으면 more 에 | 6 경간 · 3 단면 SI 32.7 KB, 한 단면 4 경간 37,547 B 그대로 |
| 7 | 어느 경간도 S1 이 아니면 맨 위 props · cutwp(모델) 와 dsm(S2) 가 섞임 | 모두 한 단면(S1 이 쓰이면 S1, 아니면 첫 경간) + `top_level_section_id`, MCP 요약의 more 가 그 id 를 든다 | 모두 S2 → props · dsm = S2 |
| 8 | 점검: 내민 경간의 R 없음에 경고, 랩 부재 불합격에도 합격 | 내민 경간(real_span false)은 「해당 없음」, 랩: 부재 불합격 → fail, 판정 없음 · 춤 다름 → warn | 옛 review.js 로 확인(합격 · 경고) → fail · pass |
| 9 | 지점을 비운 랩 도구의 「지배 랩」 이 평가한 랩만 견준 것을 말하지 않음 | 고르는 규칙 그대로, 알림 `host.lap.governing_support_partial`(평가한 중력 랩 가운데 · 평가하지 못한 랩 · 넣지 않은 양력 랩) | 지점 3, 지점 2 · 4 의 랩을 든다 |

(뒤 단계는 끝나면 적는다)

---

## 5. 남은 것

(끝에 적는다)
