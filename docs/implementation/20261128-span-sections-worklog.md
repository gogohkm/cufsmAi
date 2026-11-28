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

**2026-11-28 오후 — S3 · S7 을 설계 매뉴얼의 방식으로 바꿈.** 보고에 「매뉴얼의 가정과 다른 두 곳」 을 적었고 사용자가 「메뉴얼 방식으로 변경해줘」 라고 했다. 위 표의 S3 · S7 은 아래로 바뀐다(6절에 단계와 기록).

| # | 무엇 | 바꾼 값 | 까닭 |
|---|---|---|---|
| S3′ | 랩에서 두 부재의 강도 | **두 부재 강도의 합**(설계 매뉴얼 II-1A · II-2A 의 가정 (c)) — 휨 Mu ≤ Σ φMn,i, 전단 Vu ≤ Σ φVn,i, 휨 + 전단(§H2)도 합한 강도로. 구현은 「각 부재가 제 강도의 비만큼 받는다」(M 은 휨 설계 강도의 비, V 는 전단 설계 강도의 비로 나눠 부재마다 엔진이 검토 — 판정비가 강도의 합으로 본 값과 같다). 두 단면이 같으면 몫이 0.5 라 결과가 그대로다. 강성(Ix)비로 나눈 값은 참고로 낸다(판정에 쓰지 않음) | 사용자의 결정. 매뉴얼의 예제와 같은 값이 나온다 |
| S7′ | 데크 강성 | **한 번 계산해 모든 경간에** — 쓰이는 단면 가운데 kφ 가 가장 작게 나오는 단면의 값(두께만 다르면 얇은 쪽 — 설계 매뉴얼 II-1C 의 「안전측의 근사」). 어느 단면의 값인지 결과에 적고, 단면마다의 값은 참고로. §I6.2.1 의 조건과 양압의 R 은 앞과 같이 경간마다 그 단면으로 | 사용자의 결정 |

랩 패스너(S5) · 춤이 다른 랩(S4) · 랩의 Ix = 두 Ix 의 합(가정 (b))은 그대로다.

---

## 3. 단계표

| 단계 | 내용 | 닿는 곳 | 상태 |
|---|---|---|---|
| E | 엔진 — 하중 해석의 경간별 단면(데크 강성 · §I6.2.1 · 양압 R · Ix), 구간 기록에 경간, 랩 접합의 두 부재 | `python/**` | 끝(`11e0fb2`) |
| H | 호스트 — 검토 상태의 단면 목록 · 경간의 단면, 편집 화면의 칸, 퍼린 사슬(단면마다 성질 · 좌굴값, 구간마다 그 단면, 랩의 몫), MCP 인자, 읽는 곳, 파일 · 기록, 고정값 | `src/**`, `webview/**`, `test/**` | 끝(`63e32bd`) |
| D | 데스크톱 — 단면 목록 · 경간의 단면 보기, 구간의 단면 표시, 단면을 골라 보는 좌굴값 · 곡선, 시험 | `desktop/**` | 끝(`a256693`) |
| V | 독립 검증 — 구간과 단면의 짝, 랩의 몫, 경간별 데크 강성 · R, 매뉴얼 예제 | 읽기만 → 찾은 아홉을 고침 | 끝(`6846715`) |
| M | 마일스톤 — 닿는 시험 전부 한 번(`test:rendered` 포함), 설치 파일 · 포장본 | — | 끝 |

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

### D — 데스크톱 검토 화면(끝, 커밋 `a256693`)

호스트는 건드리지 않았다(단면의 Ix 는 다리가 이미 쥐고 있던 `sectionListInfo` 를 화면이 읽는 명령에 더함 — `store.ts`). 새 모듈 `desktop/ui/src/spansecs.ts`.

- **입력.** 모델 › 부재 가지에 「단면」(S1 · S2 · S2 · S1 과 출처) · 「단면 목록」(단면마다 한 가지), 경간 표의 「단면」 열, 단면 목록 표(S1 = 모델 — 읽기만, S2 … 는 이름 · H · B · D · t · r · 립 각도(mm)와 Ix). 모든 경간이 S1 이고 목록이 비면(`designState.sectionsAreDefault`) 아무것도 보이지 않는다(s01).
- **퍼린 결과.** 구간 이름의 단면 표시(`S2`, 랩 `S1|S2`, 단면이 바뀌는 곳을 넘는 구간 `S1·S2`), 서랍의 구간 표에 「단면」 열, 검토 점에 「단면 Sx · 몫 %」. 정보 창의 「단면 · 랩의 두 부재」 — 부재마다 단면 · 경간 · 역할 · 몫 · Mu · Vu · 판정비 · 판정, 지배 부재, 몫의 근거. 강도의 합은 「참고 — 판정에 쓰지 않음」. 평가하지 못한 구간은 까닭과 함께(판정비 없음 — 합격으로 그리지 않는다).
- **단면마다 보기.** 결과 › 「퍼린 단면」 가지 — 단면마다 치수 · 성질 · 좌굴값(정 · 부, 데크 강성마다) · 경간의 데크 강성, 가운데에 그 단면의 서명곡선(단면 고르기 · 곡선 고르기). 해석 탭은 S1 그대로(S8).
- **랩 접합.** 「랩 — 두 부재」 블록(부재의 t · d · Se · Ix · 몫, 검토마다 정한 부재, 강도의 합 참고), 저절로 고른 랩의 「어느 랩」.
- **변경 목록.** 「단면 S2 추가」 · 「경간 2 단면 S1 → S2」 · 「단면 S2 H 228.6 → 254 mm」 — 「단면 목록」 구역 아래.
- **시험.** `ui.mjs` 7i(s01 – s07, 설계 매뉴얼 II-1A 사례) — 에이전트의 전체 실행 403/403.

### V — 독립 검증(읽기만)과 찾은 결함 고침(커밋 `6846715`)

**검증이 맞다고 본 것.** 구간과 단면의 짝 — 부재 검토 50 회를 그 단면 하나로 돌린 것과 견줘 어긋남 0(성질 · 부모멘트 좌굴값 · 그 경간의 데크 스프링으로 푼 정모멘트 좌굴값). 랩의 몫은 계산된 Ix 의 비(II-1A 0.5418 / 0.4582), 같은 단면은 정확히 0.5. §I6.2.1 은 경간마다(d/t 가 넘는 경간이 다른 경간의 R 을 물려받지 않는다). II-1A · II-2A 를 호스트 길로 — 소요 모멘트 · 반력 · 양압 모멘트 모두 0.5 % 안, 부재 강도 φMnℓ 9.32 대 9.42(x070) · 7.02 대 7.02(x059). 단면을 쓰지 않는 길은 `253adb1` 의 코드와 나란히 돌려 엔진 본문 · 결과 · 요약 · 점검 · 파일 · 지문이 같다(변경 기록 한 줄만 달랐다 — 아래 5). 기억과 무효화(S2 를 고치면 다시, S1 을 고쳐도 S2 그대로). **보지 못한 것:** 브라우저 화면 · 데스크톱(→ 진짜 화면 시험 · 데스크톱 시험이 본다), 웹 구멍 + 경간별 단면, 계산서 HTML(코드로만).

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

고친 뒤 새 알림 16(`host.purlin.support_section_change` · `support_section_unchecked` · `sections_listed_unused`, `host.case.section_dims_from_s1` · `section_dims_missing` · `span_sections_reset` …, `host.lap.members_from_list` · `governing_support_partial` …). 고정값은 뒤집은 것 없음. 엔진(`python/**`)은 `11e0fb2` 뒤로 그대로.

### M — 마일스톤(끝, 2026-11-28)

오케스트레이터가 한 번에 차례로 돌림(커밋 `6846715` 에서).

| 시험 | 결과 |
|---|---|
| 파이썬 전체 | 598(엔진 커밋 `11e0fb2` 에서 — 그 뒤 엔진은 그대로) |
| `test:quick` · `span_sections_contract` | 통과(고침 뒤 다시) |
| `test:webview`(전체 사슬) | 통과 |
| `test:k3` | 5/5, 불일치 0, 목록 검사 통과 |
| `test:k2` | 21/21, 불일치 0 |
| `test:rendered` | 15/15 · 11/11 · 3/3 |
| 데스크톱 smoke · bridge · connect | 53/53 · 94/94 · 28/28 |
| 데스크톱 `ui.mjs` | 첫 실행 402/403 — s05 가 「어느 랩」 알림을 옛 code(`governing_support`)로만 기대(고침 9 로 양력이 있는 사례는 `governing_support_partial`) → 시험이 둘 다 받게 고침. 다시 돌려 401/403 — s05 통과, 남은 둘은 알려진 `net::ERR_NETWORK_CHANGED`(콘솔 오류 0 의 두 줄, 첫 실행에서는 통과). 403 단계 모두 두 전체 실행 가운데 하나에서 통과, s 단계만으로는 60/60 |
| 데스크톱 설치 단위 | 11/11 |
| 셸 | 47/47 |
| 설치 파일 | `desktop\installer\build\dist\StCFSD-Setup-0.1.1-x64.exe` 2026-11-28 13:18(148.0 MiB — 이 PC 에만, 설치하지 않음) |
| 포장본 | 59/59 |

---

## 5. 남은 것

**사용자가 볼 것(설계 매뉴얼의 가정과 다른 두 곳 — 권장안 그대로 둠).**
- 랩의 강도(S3): 매뉴얼(II-1A · II-2A 의 가정 (c))은 두 부재 강도의 합, 여기는 강성비로 나눠 부재마다(II-1A 의 둘째 지점 랩 0.8607 대 강도의 합 0.7367). 강도의 합은 참고로 같이 낸다.
- 데크 강성(S7): 매뉴얼(II-1C)은 얇은 쪽 하나로 한 번(「안전측의 근사」), 여기는 경간마다 그 단면으로.

**범위 밖으로 둔 것.**
- 다른 템플릿 종류 · 직접 그린 단면은 단면 목록에 쓸 수 없다(S2). 춤이 다른 두 부재의 랩은 평가하지 못함(S4). 재료(Fy · E)는 모든 단면이 같다. 구멍 · 보강재의 입력은 모든 단면에 같이 적용(S9) — 웹 구멍과 경간별 단면을 함께 쓴 경우는 검증에서 돌려 보지 않았다.
- 랩 안 지점의 웹 크리플링은 앞과 같이 모형화하지 않는다(「평가하지 못함」).

**작은 것.**
- 편집 화면의 단면 목록에서 D · r · 립 각도 칸을 사람이 비우면 엔진의 템플릿 규칙(r 0 · 립 90°)이 쓰인다(칸의 풍선말에 적음 — 추가할 때는 S1 의 값이 채워져 있다). AI 도구는 빠진 치수를 S1 의 값으로 채우고 답에 적는다.
- 랩 도구에 `Mnd_2` · `h_web_2` 를 보내지 않는다(첫째 부재의 것도 지금 보내지 않는다).
- 단면마다의 서명곡선은 메모리에만 기억 — 파일을 열면 쓰이는 단면마다 다시 푼다.
- `get_full_state` · 보기 계약에 단면 목록이 없다(`get_case_inputs` 에 있다).
- 좁은 왼쪽 단에서 단면 목록 표가 옆으로 밀린다.
- 답의 크기: 4 경간 · 3 단면의 요약 40,511 B(예산 40 KiB = 40,960 B 바로 아래 — 넘으면 줄이는 단계가 돈다), `get_case_inputs` 는 단면 19 개에서 13.5 KB(12 KB 를 넘는다 — 목록은 20 개까지).
- 데스크톱의 단면 목록 Ix 는 호스트가 마지막으로 알린 값 — 고친 직후 잠깐 앞의 값일 수 있다. `host.purlin.i621_r_some_spans` 는 데스크톱 시험이 직접 띄우지 않는다(날 code 가 없다는 것만).
- 엔진이 바뀌었다(`11e0fb2`) — 저장된 결과는 「다른 엔진」 으로 버려지고 [다시 계산] 으로 돌아온다.

---

## 6. 설계 매뉴얼의 방식으로(S3′ · S7′ — 2026-11-28 오후)

기준점: `f2b4f5d`. 5절의 「사용자가 볼 것」 둘은 이 절로 풀린다.

| 단계 | 내용 | 닿는 곳 | 상태 |
|---|---|---|---|
| EH2 | 엔진 — 데크 강성을 한 번(가장 작은 kφ 의 단면), 랩 접합 도구의 휨을 강도의 합으로. 호스트 — 랩 구간의 판정을 강도의 합(강도비의 몫)으로, 강성비의 값은 참고, 데크 강성 하나, 읽는 곳 · MCP · 알림 · 시험 | `python/**`, `src/**`, `webview/**`, `test/**` | 끝(커밋 전 — 아래 기록) |
| D2 | 데스크톱 — 랩의 줄(강도의 합 · 부재의 강도와 몫 · 강성비 참고), 데크 강성 하나, 시험 | `desktop/**` | EH2 뒤 |
| V2 | 독립 확인 — 바뀐 두 규칙만(매뉴얼의 수와 맞대기, 합격이 아닌 것이 합격이 되지 않는지) | 읽기만 | EH2 뒤 |
| M2 | 마일스톤 — 전체 한 번, 설치 파일 · 포장본 | — | |

### EH2 — 엔진 · 호스트(끝, 커밋 전)

**랩 = 두 부재 강도의 합(S3′).** 호스트 퍼린 사슬: 랩 구간마다 먼저 강성의 몫(엔진 `lap_members[].stiffness_share`)으로 두 부재를 엔진에 검토시켜 부재마다의 휨 설계강도 φMn,i(M_max 지점 결과의 `design_strength` — 그 구간의 지배 휨강도)와 전단 설계강도 φVn,i(`shear.design_strength`)를 얻는다(강도는 소요에 달리지 않는다). 그다음 강도의 몫 M_i = M · φMn,i / Σ φMn, V_i = V · φVn,i / Σ φVn 로 다시 검토한 것이 판정 — 두 부재의 휨 비 = M / Σ φMn, 전단 비 = V / Σ φVn, §H2 는 엔진의 부재 검토 그대로(합한 강도와 같거나, 지배 휨강도가 §H2 의 Malo 가 아니면 큰 부재 비 — 조금 안전측). 두 몫이 첫 검토의 몫과 같으면(같은 두 부재 — 모두 정확히 0.5) 다시 부르지 않는다(본문 · 부르는 수 그대로). 한 부재의 강도를 얻지 못하면 그 랩은 평가하지 못함(`host.purlin.lap_strength_unknown`). 강성의 몫이 없으면(두 부재 Ix 를 모름) 첫 검토는 절반으로 강도만 얻고 참고값이 없다. 엔진의 랩 접합 도구도 같은 규칙: Mn,lap = Mnℓ,1 + Mnℓ,2, Mnd,lap = Mnd,1 + Mnd,2, §H2 의 Va = φ(Vn,1 + Vn,2) — 강성 몫의 값은 참고(`flexure_reference_stiffness_share`, 검토 항목의 `reference_stiffness_share`). 패스너 · 팔 · 블록전단 · 춤이 다른 랩은 그대로. 둘째 부재 입력이 없으면 바이트까지 그대로(기준 시험).

**데크 강성 한 번(S7′).** `analyze_loads` 가 `span_sections` 를 받으면 쓰이는 단면마다 데크 값을 계산해 kφ 가 가장 작은 단면(같으면 kx 가 작은 쪽, 그다음 앞의 단면)의 결과 전부를 `auto_params.deck` 로 — 모든 경간에. `auto_params.deck_basis {rule: 'once_smallest_kphi', section_id, reference, by_section[{section_id, spans, kphi, kx, kphi_method, kx_method, adopted}]}`(단면마다는 참고). 단면이 다르고 데크가 있으면 가정 `loads.assumption.deck_once_smallest_kphi`. 호스트는 그 한 값으로 단면마다 정모멘트 곡선 하나. §I6.2.1 · 양압 R · Ix 는 경간마다 그대로.

**맞대 본 값(II-1A, 둘째 지점 왼쪽 랩 — S1 x070 | S2 x059).** Mu 144.42 kip-in / (φMn 111.81 + 84.23 = 196.04) = **0.7367**; Vu 2.506 kips / (φVn 5.470 + 3.270 = 8.740 — 매뉴얼 0.95 (5.76 + 3.44) = 8.74) = 0.2868; 강도의 몫 M 0.5703 | 0.4297, V 0.6259 | 0.3741; 부재의 판정비(§H2 가 지배) 0.7906 | 0.7907 = √(0.7367² + 0.2868²). 참고(강성의 몫 0.5418 | 0.4582): 0.7426 | 0.8607. 랩 접합 도구(Se 2.47 / 1.89, Fy 55): φMn,lap = 0.9 (135.85 + 103.95) = 215.82 kip-in = 17.99 kip-ft(매뉴얼 18.0), Mu 12.0 kip-ft → 0.667(참고 — 강성 몫 227.08 kip-in, 0.705). 데크: kφ x070 0.1417 · x059 0.1126 kip-in/rad/in → 모든 경간 0.1126.

**결과 키.** 하중 해석(경간별 단면일 때만): `auto_params.deck_by_span` 없앰 → `deck_basis`; 랩 구간 `lap_members[].share` → `stiffness_share`, `share_basis` 없앰 → `strength_basis: 'sum_of_strengths'`, `reference_basis` 값 `'sum_of_strengths'` → `'stiffness_share'`, `lap_evaluable` 은 춤만으로(강성 몫이 없어도 true), `span_map.laps[].shares` → `stiffness_shares`. 퍼린 결과의 랩 구간: `share_basis` · `reference_sum_of_strengths` 없앰 → `strength_basis`, `sum_of_strengths {basis, Mu, design_strengths, design_strength_sum, flexure_ratio, Vu, shear_strengths, shear_strength_sum, shear_ratio, shares_M, shares_V, label…}`, `reference_stiffness_share {basis: 'stiffness_Ix', shares, members[{section_id, share, pass, utilization, governing_check}], governing_member, ratio, pass, label…}`; `lap_members[]` 의 `share` = M 의 강도 몫(뜻이 바뀜), 더한 `share_V` · `share_stiffness` · `shear_strength`, `Vu` = V · share_V. 검토 지점 location 에 `member_share`(M 몫) · 다를 때만 `member_share_V`. 단면 블록: `deck[]` · `dsm_pos_by_deck` · `curves.pos_by_deck` 없앰 → `deck_used {kphi, kx, section_id}` · `deck_own {kphi, kx}`. 랩 접합 결과: `share_basis` · `flexure_reference_sum_of_strengths` 없앰 → `strength_basis` · `flexure_reference_stiffness_share {Mn_lap, phi_Mn_lap, dcr, governing_member, shares}`, `reference_basis: 'stiffness_share'`, `lap_members[].share` → `stiffness_share` + `Mnl` · `Vn`, `member_governing.flexure_local · flexure_distortional · bending_shear` = `'sum'`; 검토 항목 `lap.flexure.local` · `lap.bending_shear` 에 `strength_basis` · `reference_stiffness_share`(`governing_member` · `reference_sum_of_strengths` 없앰). MCP 요약: 랩 줄 `sum_of_strengths {flexure_ratio, shear_ratio}` · `reference_stiffness_share_ratio`(`reference_sum_of_strengths_ratio` 없앰) · 부재 `share_V`(다를 때), 단면 `deck_used` · `deck_own`, 하중 해석 요약 `deck_basis.by_section` 짧은 줄.

**알림 · 점검.** 호스트: `lap_two_members_stiffness` → `lap_two_members_sum`, `lap_stiffness_share` → `lap_strength_share`, `sum_of_strengths_reference` → `stiffness_share_reference`(참고), 새 `sum_of_strengths`(판정 줄의 이름표) · `lap_strength_unknown`; `sections_per_span` · `host.lap.two_sections` · `members_from_list` 글. 엔진: `loads.assumption.lap_stiffness_share` → `lap_sum_of_strengths`, 새 `deck_once_smallest_kphi`, `lap.label.sum_of_strengths_reference` → `lap.label.stiffness_share_reference`, 없앰 `lap.note.share_from_ixx` · `share_same_members` · `lap.reason.lap_shares_need_ixx` · `loads.reason.lap_shares_need_ixx`; `lap.assumption.two_members` · `span_sections_per_span` · `lap_shares_need_ixx`(경고) 글. 점검: `val.load_analysis.deck_section.N` → `deck_once`(「데크 강성 — 한 번 (kφ 가 가장 작은 단면)」), `lap_members` 의 이름 「랩 — 두 부재 (강도의 합)」. 계산서의 랩 표(M 몫 · V 몫 · 휨 · 전단 설계강도, 강도의 합 줄 = 판정, 강성의 몫 줄 = 참고)와 규칙 문장. k3 목록 문서 다시 만듦.

**정모멘트 좌굴값(II-1A).** S1(x070): 혼자(자신의 kφ 0.1417) Mcrl 141.40 · Mcrd 196.94 → 경간별 단면(0.1126) 141.32 · 191.52 kip-in. S2(x059)는 자신의 kφ 그대로 — Mcrl 84.90 · Mcrd 140.22.

**시험(에이전트의 마지막 실행).** 파이썬 전체 598 통과(1128 시험의 기대값을 새 규칙 · 매뉴얼의 수로 고침 — 기준 파일은 그대로 통과). `test:quick` · `span_sections_contract`(P2: 같은 두 부재 몫 0.5 · 두 번째 검토 없음, P3: 0.7367 · 강성 참고 0.7426 | 0.8607 · 데크 0.1126, 새 P3c: 부재 강도가 없으면 평가하지 못함) · lap_* 셋 · mcp_* 넷 · notice_render · `build:mcp` + parity · `test:rendered` 15 + 11 + 3 · k3 목록 `--check` 통과. 고정값(k2 · k3)은 뒤집은 것 없음(한 단면 길은 그대로 — k2 · k3 전체 실행은 하지 않음).

### F2 — 독립 검증이 찾은 여섯(끝, 커밋 전)

| # | 무엇이 틀렸나(재현) | 고친 것 | 시험 |
|---|---|---|---|
| 1 | 한 부재의 전단강도가 없으면 휨이 강도의 합으로 넘어도 랩 전체가 판정 없음(II-1A, Lr 160, S2 의 shear 를 지움: Mu 244.26 / Σ 196.04 = 1.246 인데 pass null) | 판정할 수 있는 것은 판정 — 두 휨강도를 알면 휨을 합으로(넘으면 구간 불합격), 두 전단강도를 알면 전단을 합으로. 모르는 쪽 · §H2 의 엔진 판정은 쓰지 않고 그 검토 항목을 평가하지 못함(까닭)으로, 불합격이 없으면 구간은 판정 없음. 둘 다 모르면 앞과 같다. 결과 `lap_items_not_evaluated` · `sum_of_strengths.evaluated / not_evaluated`, 알림 `host.purlin.lap_items_not_evaluated`(StcfsdPanel `lapPartial` · `partialOut`) | contract P3c(휨강도 없음 → 전단만 판정, 판정 없음) · P3d(전단강도 없음 · Lr 160 → 불합격 1.246, 전단 · §H2 평가하지 못함) |
| 2 | 데크 kx 를 kφ 가 가장 작은 단면에서 — 그 단면이 플랜지가 좁은 두꺼운 부재면 kx 가 커 다른 경간에 제 값보다 큰 kx(S1 t 0.059 B 2.5: kx 1.388, S2 t 0.080 B 1.75: kx 1.829 → S1 의 정모멘트 Mcrd 140.22 → 142.18, +1.4 %) | 엔진 `_deck_once`: 가장 작은 kφ 와 가장 작은 kx 를 따로 — `deck_basis {rule: 'once_smallest_kphi_and_kx', kphi_section_id, kx_section_id, by_section[].adopted_kphi / adopted_kx}`(`section_id` · `adopted` 없앰). 데크를 계산하지 못하는 단면(두께 · 플랜지 폭 없음)은 ValueError(호스트는 늘 두 치수를 보내 닿지 않는다). 호스트 `deck_used {kphi, kx, kphi_section_id, kx_section_id}`, MCP 짧은 줄 · 설명, 점검 「데크 강성 — 한 번 (가장 작은 kφ · kx)」, 계산서 · 앱 글, 알림 `deck_once_smallest_kphi`(매개변수 kphi_section · kphi · kx_section), 데스크톱 「데크 강성」 | 파이썬 2 새 시험(따로 고름 · 치수 없는 단면은 오류), contract P3e(호스트 길: kφ S2 · kx S1, S1 Mcrd 192.81 ≤ 혼자 196.94). 재현 스크립트: S1 Mcrd+ 142.18 → 140.06(≤ 140.22) |
| 3 | 랩의 전단강도 합이 표시 반올림 값(5.47 + 3.27 = 8.74) — 엔진의 반올림 전 값은 `display_unrounded.shear.design_strength` | `_shearStrength` 가 그 자리를 읽는다. II-1A lap-1: 5.4677 + 3.2655 = 8.7332, 전단 비 0.28677 → 0.28700, V 몫 0.6259 / 0.3741 → 0.6261 / 0.3739, 부재 §H2 0.7906 | 0.7907 → 0.7906 | 0.7906. 휨강도는 이미 반올림 전 | contract P3(그 수, 엔진 부재의 전단 비 = Vu / Σ) |
| 4 | 이름표가 휨 비를 「판정」 이라 부름(0.737 — 지배는 §H2 0.791) | `host.purlin.sum_of_strengths`: 휨 · 전단의 비와 구간의 지배 검토 · 판정비(한 쪽만 알면 「평가하지 못함」), 「설계 강도」(방법에 매이지 않음). `sum_of_strengths.bending_shear_ratio` · `governing {check, check_id, ratio, pass}`. 계산서의 랩 표는 휨 · 전단 · 구간(지배 검토 · §H2) 세 줄, 점검 「랩 — 두 부재」 의 값도 셋 | contract P3(글) · 데스크톱 s03 |
| 5 | §H2 를 큰 부재 비로 보는 것을 말하지 않음 | 규칙 그대로. `host.purlin.lap_two_members_sum` 과 계산서 규칙 문장에 「강도의 몫으로 본 두 부재의 §H2 가운데 큰 값 — 지배 휨강도가 Malo 이면 합한 강도의 값과 같고, 다른 휨 한계상태가 지배하면(랩 구속을 밝히지 않음) 조금 크다」 | — |
| 6 | 점검 「Lap 구간 휨강도 (§F3, 한 부재)」 · 앱 요약이 두 단면의 랩에도 한 부재의 강도 | 서로 다른 두 단면의 랩이면 점검 「Lap 구간 휨강도 (§F3, 두 부재 강도의 합)」(`val.lap.flexure_sum` — Σ 와 그 항, 휨 · 전단 · §H2 · 구간), 앱 요약의 강도 칸은 부재마다 + Σ. 한 단면 · 같은 두 부재는 그대로(옛 항목 이름) | k3 목록에 새 항목, `--check` |

**데스크톱.** `spansecs.ts`: 「데크 강성」 은 값마다 그 단면(같으면 한 단면), 랩의 합 줄에 §H2 줄 · 「평가하지 못함」(한 쪽 강도만 알 때) · 「평가하지 못한 항목」 줄(불합격이면 「불합격이 이긴다」). `info.ts`: 두 단면 랩의 「랩 단면 Se · Vn」 은 부재마다. `ui.mjs` s03(이름표) · s04(데크 단면 id) 고침. 데스크톱은 `out/`(루트 `npm run compile`)의 호스트를 싣는다 — 첫 실행은 옛 `out/` 이라 s04 가 실패, compile 뒤 s01 – s07 60/60. 한 쪽 강도만 아는 랩의 화면(불합격 줄 · 평가하지 못한 항목)은 데스크톱 시험이 직접 띄우지 않는다(엔진 답을 고칠 길이 없다 — 호스트 계약 P3c · P3d 가 그 데이터를 본다).

**시험.** 파이썬 전체 600(새 2). `span_sections_contract` 통과(P3 의 수 · 글, P3c · P3d · P3e 새로). 렌더 `span_sections.js` R2 의 정규식이 지배 부재 표시(＊)를 받게(F2 의 3 뒤로 II-1A 두 부재의 §H2 가 0.7906 으로 같아 S1 이 지배). k3 목록 다시 만듦. 고정값(k2 · k3)은 뒤집은 것 없음.

**결과 모양의 바뀜.** 하중 해석 `deck_basis`(위 2), 퍼린 결과 `sections[].deck_used`, 랩 구간 `sum_of_strengths.{bending_shear_ratio, governing, evaluated?, not_evaluated?}` · `lap_items_not_evaluated?`, 한 쪽 강도만 아는 랩의 부재 줄 `share` / `share_V` null · 쓰지 않은 검토 항목 `not_evaluated`. 단면 하나 · 같은 두 부재의 길은 그대로(기준 파일 · P1 · P2).
