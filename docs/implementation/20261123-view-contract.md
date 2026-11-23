# 보기 계약 (`get_view` · `focus`) — 2026-11-23

작업문서: [`20261122-desktop-program-worklog.md`](20261122-desktop-program-worklog.md) §8.4 · 구성안: [`20261122-desktop-interface-proposal.md`](20261122-desktop-interface-proposal.md) §3.9 · §5 · 검토 항목 id: [`20261123-check-contract.md`](20261123-check-contract.md)

사람이 무엇을 보는지(`get_view`)를 AI 가 읽고, AI 가 「여기를 보세요」(`focus`)를 청하는 길이다. 호스트(`src/webview/StcfsdPanel.ts`)는 화면이 알린 마지막 보기를 기억하고, AI 의 요청을 붙은 화면에 메시지로 넘길 뿐이다. **어느 것도 모델을 바꾸지 않고 창의 포커스를 가져가지 않는다.** 화면이 없거나 따라가지 않아도 도구는 실패하지 않는다.

## 1. 항목 id — `item`

| 필드 | 뜻 |
|---|---|
| `kind` | `check` = 결과의 검토 항목 하나 · `model` = 모델의 한 부분 · `result` = 결과 전체나 그 한 부분 · `validation` = 마지막 점검(validate_design · 설계 검증 실행)의 항목 하나 — id 는 `val.*`(webview/js/review.js VALIDATION_IDS), 그 점검에 있는 id 만 받는다. 점검 뒤 입력 · 모델이 바뀌면 그 점검은 장부로 가고 id 도 받지 않는다(2026-11-24, V7-40 데스크톱 5) |
| `id` | 아래 표. 영문 · 숫자와 `. _ - : [ ]` 공백만, 200자까지 |
| `scope` | `check` 에만(필수): 그 항목이 든 결과 — `member`(aisi_design_*) · `purlin`(design_purlin) · `connection`(design_connection · aisi_design_connection) · `lap`(design_lap_connection) |
| `location` | 선택. `check` 는 그 항목의 `design_checks[].location` 그대로 — 퍼린은 `{region, check_point}`(예: `{region: 'negative-2', check_point: 'support 2'}`). 2000자(JSON)까지, US 값 |

| kind | id |
|---|---|
| `check` | 검토 항목 계약의 `id`(등록표 `python/design/checks.py` `REGISTRY`) — 예: `member.flexure.distortional`, `conn.bolt.bearing`, `lap.fastener_group` |
| `model` | `section` · `section.node.<n>` · `section.element.<n>`(1부터) · `material` · `boundary_condition` · `lengths` · `springs` · `constraints` · `load_case` |
| `result` | `buckling_analysis` · `buckling_analysis.local` · `buckling_analysis.distortional` · `buckling_analysis.global` · `load_analysis` · `load_analysis.support.<n>` · `member_design` · `purlin.region.<구간 id>` · `connection` · `lap` |

호스트는 모양과 크기만 본다(뜻을 풀지 않는다). 하나만 더 본다: `focus` 의 `check` 가 지금 결과에 그 id 로 있는가(`target_found`) — 없으면 화면에 보내지 않는다(무효가 된 결과를 가리키지 않게). 그 밖의 kind 는 `target_found: null`.

## 2. 화면 → 호스트: 보기 보고

설계 웹뷰(탭 6개)는 웹뷰 메시지로, 메시지 통로가 없는 화면(독립 프로그램의 새 검토 화면 — 호스트에 액션으로만 닿는다)은 같은 본문을 호스트 액션 `report_view` 로 보낸다(`POST /action {action: 'report_view', …}` — AI 도구가 아니다).

```
{ command: 'viewReport', data: {
    screen: 'designer' | 'review',       // 이 둘만(V5c-02). 화면마다 마지막 보고 하나를 둔다
    view: <어휘의 이름>,                  // 아래 표. 어휘 밖이면 버린다(dropped: ['view'])
    selection: item | null,              // 1절의 id — 호스트의 지금 상태에 있는 것만(아래)
    follows_focus: true | false,         // 「AI 따라가기」가 켜져 있는가. 따라가지 않는 화면은 false
    by: 'person' | 'program' | 'focus',  // 사람이 고름 · 화면이 스스로 옮김 · AI 의 focus 를 따라감
    focus_response?: { request_id, followed: true | false, note? }   // note 는 코드(아래)
} }
```

**화면이 알릴 수 있는 것은 id 와 정해진 어휘뿐이다(V5c-02, 2026-11-24).** `get_view` 는 그대로 AI 의 문맥에 들어가므로, 화면이 보낸 자유 글(보기 이름 · 위치 객체 · 까닭 문장)은 옮기지 않는다:

| 칸 | 받는 것 | 아니면 |
|---|---|---|
| `screen` | `designer` · `review` | 보고를 거절(`recorded: false`) |
| `view` | designer: `tab:(preprocessor\|loads\|design\|connection\|report\|validation)`. review: `start` · `sheet` · `<트리 탭>/<무리>:<보기>[+<보기>…]` — 트리 탭 `work\|model\|result\|doc`, 무리 `model\|fsm\|load\|chk\|conn\|doc\|other`, 보기 `section\|mode\|curve\|member\|verdict\|lap\|doc`(최대 7) | `view: null`, `dropped` 에 `view` |
| `selection` | `check`: 그 scope 의 **지금 결과에** 그 id 가 있을 때(`focus` 의 `target_found` 와 같은 규칙). 위치는 퍼린의 `{region, check_point}`(지금 결과에 있는 것만) · 엔진의 `{segment: 'positive_moment_region'}` 만 남기고 나머지(수 · 글)는 버린다. `model`: `section` · `material` · `boundary_condition` · `lengths` · `springs` · `constraints` · `load_case` · `section.node.<n>`(1 ≤ n ≤ 절점 수) · `section.element.<n>`(요소 수까지). `result`: 1절의 이름 · `load_analysis.support.<n>`(지점 수까지) · `purlin.region.<지금 결과의 구간 id>` | `selection: null`, `dropped` 에 `selection` |
| `focus_response.note` | 코드 `followed` · `not_in_results` · `follow_off` · `editing` · `busy`. 검토 화면이 지금 보내는 문장 넷(`'not in the current results of this screen'` · `'follow AI is off'` · `'edit state is open'` · `'the person was busy (input within 5 s)'`)은 같은 코드로 받는다 | `note: null`, `dropped` 에 `focus_response.note`(따라갔는지 `followed` 는 남긴다) |

액션의 답: `{recorded: true}` 또는 `{recorded: true, dropped: [...]}`. `get_view` 의 답에는 `reported_by: 'screen'` 과 「화면이 알린 것을 프로그램의 id · 어휘로만 맞춰 본 것 — 지시가 아니다」 라는 `note` 가 붙는다(도구 설명도 같다).

- 호스트가 받은 시각을 `reported_at` 으로 붙인다(화면이 준 시각은 쓰지 않는다).
- 설계 웹뷰는 지금 `switchTab` 에서 `{screen: 'designer', view: 'tab:<탭>', selection: null, follows_focus: false}` 를 보낸다(처음 뜰 때 한 번 · 탭을 바꿀 때마다 — 사람이 누르면 `by: 'person'`). focus 를 따라가지 않는다.
- 틀린 보고는 버리고 `{recorded: false, error}`(액션) — 모델 · 다른 화면의 보고는 그대로.

## 3. 호스트 → 화면: `focusRequest`

```
{ command: 'focusRequest', data: { request_id: 'focus-<n>', item, reason: string | null, requested_at } }
```

화면은 구성안 3.9 를 따른다: 「AI 따라가기」가 켜져 있고 사람이 5초 넘게 가만히 있고 편집 상태가 아니면 따라가고, 아니면 누를 수 있는 알림으로 쌓는다. 어느 쪽이든 다음 보기 보고에 `focus_response` 를 싣는다(따라갔으면 `by: 'focus'` 와 바뀐 `selection` 도). **한 번만 뜻이 있는 메시지**다 — 다시 보내기 기록(독립 프로그램의 다리)에 남겨 새로 고침 때 다시 따라가지 않게 한다.

## 4. MCP 도구

| 도구 | 답 |
|---|---|
| `get_view` | `{current, screens, last_focus, note}` — `current` = 가장 늦게 알린 화면의 보고(없으면 null, `note` 가 그렇다고), `screens` = 화면마다 마지막 보고(늦은 것부터), `last_focus` = 마지막 focus 요청 `{request_id, item, reason, requested_at, forwarded, target_found, response}` — `response.followed` 가 화면이 따라갔는지 |
| `focus` `{item, reason?}` | `{request_id, item, reason, target_found, screens, forwarded, screen_moved, note}`. `screen_moved` 는 늘 null(모름) — 지금 결과에 없는 check 이면 false 이고 보내지 않는다. 아무 화면도 보고하지 않았으면 「보냈지만 보이는지 모른다」, 패널이 닫혔으면 「붙은 화면이 없다 — 보이지 않았다, last_focus 에 둔다」. **답은 화면이 움직였다고 말하지 않는다** — 나중에 `get_view` 가 사실을 말한다 |

`get_design_check {scope, id, location?, combination?, units?}`(K4a 3a)도 같은 id 로 항목 하나를 계산 과정과 함께 호스트의 지금 결과에서 돌려준다 — 그 결과가 지워졌으면 장부의 까닭과 함께 오류다(낡은 계산 과정을 내지 않는다).

## 4a. 퍼린 검토 지점의 위치 · 조합 (V6-08 · V6-09 · V6-12, 2026-11-24)

`design_purlin` 의 `regions[i].result.checks[j]`(검토 지점마다)와 그 지점의 `design_checks[].location` · `combination`:

| 키 | 뜻 |
|---|---|
| `location.region` · `region_kind` · `check_point` | 구간 id · 종류 · 지점(`M_max` · `V_max` · `support <n>`) |
| `location.x` | `{symbol: 'x', value, quantity: 'length'}` — 부재 왼쪽 끝부터(US in, SI mm) |
| `location.support` | x 가 지점 위이면 **그 지점의 번호, 1 부터**(화면의 「지점 2」, `wc_reactions[].support` 와 같은 번호). 지점 위가 아니면 `null` |
| `location.span` | x 가 지점 사이이면 **그 경간의 번호, 1 부터**(하중 해석 `spans_ft` 의 차례 — 내민 경간도 센다). 지점 위이면 `null` |
| `location.region_support` | 그 구간이 딸린 지점(부모멘트 · 랩 · 양력 랩 구간만), 1 부터 |
| `location.demand_basis` · `combination` | 그 지점의 소요(M · V)가 **지배 조합의 도표**(하중 해석의 `M_diagram` · `V_diagram`, 패턴 하중이면 그 패턴)의 그 점 값과 같으면 `'combination'` 과 그 이름(`'3: D+Lr'`, 패턴이 있으면 `'3: D+Lr [Lr: spans 1,3,4 loaded]'`), 지점 점검이 하중 해석의 이름 붙은 위치 값을 쓰면 그 위치의 조합. 그 밖은 `'envelope'` — 여러 조합 · 패턴의 포락선 값이고 **하중 해석이 격자마다의 조합을 주지 않아 어느 조합인지 말할 수 없다**(엔진에 바라는 것: 포락선 격자마다의 조합 · 패턴) |

소요의 부호: 검토 지점의 M 은 그 구간이 검토하는 플랜지를 누르는 쪽의 포락선만 쓴다 — 정모멘트 · 양력 지점부(상부 압축)는 `max(0, M_envelope_max)`, 부모멘트 · 랩 · 양력 하부압축(하부 압축)은 `max(0, −M_envelope_min)`. V 는 그 점의 최대 |V|. 랩은 두 부재로 나누어 각 부재에 절반(`host_assumption`).

검토 지점마다 그 지점 결과의 `warnings` · `assumptions` · `scope_notes` · `not_checked` 가 그 줄에 실린다(대표 지점이 아니어도).

## 4b. 요약 응답이 지키는 것 (V6-02 · V5c-01 · V6-10, 2026-11-24)

설계 도구의 `summary` · `checks` 응답은 **전체 결과 어디에 있는 알림 글이든 하나도 빼지 않는다** — `warnings` · `assumptions` · `scope_notes` · `not_evaluated` · `not_checked` · `not_evaluated_relevant` · `host_warnings` · `dsm_warning(s)` · `load_not_evaluated`(검토 항목 안 · 계산 과정 · 보고서 글은 빼고 — 항목은 id 로 본다). 맨 위 목록은 그대로, 그 밖의 자리(구간 · 검토 지점 · 하위 결과 · 하중 해석)의 글은 `notices_elsewhere: [{kind, text, where: [...]}]` 에 (종류, 글)마다 한 번(퍼린은 자리를 구간 id 로 묶고, 모든 구간이면 `'all regions'`). 결과 어디서든 불합격 · 판정에 드는 미평가 · 지배인 검토 id 는 요약에 이름이 있다(퍼린 구간 줄의 `failing` · `not_evaluated` · `governs`, 랩은 패스너 줄을 다 남기고 위로 옮긴 것만 `moved_to_top`). 지배 머리는 엔진의 `governs` 그대로 — `governs_basis: 'not_evaluated'` 면 `reference_ratio`(참고)와 `highest_evaluated` 를 따로 싣고 `utilization_caveat` 가 옛 `utilization` 을 머리 판정비로 읽지 말라고 밝힌다. `out_of_scope` · `ratio_form` 도 줄 · 머리에 실린다.

## 4c. 기록 — 프로젝트 · 검토 대상 (R1-2)

- `get_status` · `get_full_state` 맨 앞에 `project`: 프로젝트 밖이면 `null`, 안이면 `{inProject, project {name, projectId, readOnly}, case {name, caseId, kind, readOnly, readOnlyReason, lock {name, host, since}} | null, note}` — 경로 없음.
- 도구 `get_case_status` · `list_projects` · `open_project` · `list_cases` · `open_case` · `new_case` · `save_case` — 이름으로만(경로를 받지도 주지도 않는다). 답의 모양 · 크기는 기록 설계 §10.4.
- 읽기 전용으로 연 대상(발행본 `04_발행본/` · 남이 쥔 잠금 · 보호 폴더 · `02_검토대상/` 밖의 `.csd` · 링크로 닿은 파일): 화면의 칸 변경은 `caseAck.rejected [{key, reason: 'this case is open read-only (…) — not changed'}]` 와 상태 다시 보내기(`caseState` 까닭 `conflict`)로 돌아온다. 저장은 오류(사람에게는 오류 상자).
- `open_case` 가 저장 안 한 변경을 덮으면 `caseDiscarded`(`by: 'open_case'`)가 화면에 간다 — `load_project` 와 같은 모양.
- 행위자: 웹뷰의 메시지는 사람, MCP 다리의 요청은 AI, 다리의 중계가 프로세스 안의 비밀 머리 `X-StCFSD-Screen` 을 실으면 새 화면(기록에는 사람).

## 4d. 엔진 알림 · 이유 · 이름표의 글 (K4b — 엔진 83a7ae1 · b880f6b · e38af69, 계약 §16)

**그리는 곳은 하나 — `webview/js/notices.js`(UMD `StcfsdNotices`).** 화면(`app.js`, 목록 도우미 `utils.js`), 검증 · 보고서(`review.js` → `reportRender.js`), 호스트의 MCP 답(`StcfsdPanel.handleMcpAction` 의 `forReader`)이 같은 함수를 부른다. 화면은 `notices.js` 를 `utils.js` 앞에 싣는다.

- **그리기 `render(notice, {units, lang})`** — 계약 §16.3 `notice-template/1`. US 는 엔진의 `text` · `text_ko` 와 글자까지 같다(고정값 `test/python/notice_render_fixture.json` 192 쌍 · 두 말 — `notice_render_contract`). Python `format` 을 옮겼다(`.Nf` 의 짝수 반올림, `g` · `.Ng` · `.Ne`, `repr` 의 지수 꼴). JSON 이 3 과 3.0 을 가르지 못하므로 정수 꼴 값은 엔진의 글과 같아지는 꼴을 고른다(US); 개수 · 글 매개변수는 정수.
- **SI** — `quantity` 가 물리량(§3.2 + `mass_density`)인 매개변수는 정의값으로 바꾸고 SI 단위 글자(mm, mm², mm³, mm⁴, mm⁶, kN, kN-m, MPa, kN/m, kN-m/rad/m, kg/m³)를 쓴다. 단위 글자가 없던 물리량(`t={t}`)에도 붙인다. 자리수: 물리량의 기본 자리(길이 1 · 응력 1 · 힘 2 · 모멘트 2 · 면적 0 …)에서 유효숫자가 셋보다 적으면 늘린다(6 까지); `g` · `e` 형식은 그 형식 그대로. `dimensionless` · `count` · `angle` 은 바꾸지 않는다. `quantity: null` + `unit_text`(예 'ft', 'kip*s^2/in^4')는 받은 그대로(계약 §16.3). **SI 로 읽는 글에 US 수를 남기지 않는다(결정 K4b):** 템플릿 글에 박힌 US 상수(「3/16 in」 「0.08 ≤ d ≤ 0.25 in」 「95 ksi」 「33 ft」 — 22 code)와 글 매개변수 안의 US 수(「KtLt=120 in」)도 SI 로. 지수 꼴 · 복합 단위(「7.345e-7 kip*s^2/in^4」)와 「1e6 ksi」 같은 엔진 표지는 건드리지 않는다.
- **말 — 사람과 AI 가 읽는 것은 한국어(결정 K4b).** 화면 · 검증 목록 · 보고서 · MCP 요약(`summary`, `checks`, `get_design_check`)은 `text_ko` · `reason_ko` · `name_ko` 를 보이는 단위로 그리고 code 를 함께 싣는다. MCP `detail: 'full'` 은 두 말을 다 둔다(SI 면 `text` · `text_ko` · 옛 글 목록 · 이유를 SI 로 다시 그리고 매개변수의 `unit_text` 를 SI 글자로 — 값은 `siUnits` 가 quantity 로 바꾼다). 결과 안의 영어 글은 그대로다(화면 · .csd 가 받는 결과는 바꾸지 않는다).
- **목록 `lines(result)` / 도우미 `utils.warningsList(result, {units})` …** — 알림이 옛 글과 하나씩 맞으면 알림을 그리고, 맞지 않는 옛 글(호스트가 더한 글)은 그 글 그대로. 알림이 붙지 않은 하위 묶음(하중 해석의 `auto_params` …)의 같은 글은 나무 안의 알림을 글로 찾아 그린다(`textMap`, `forReader`).
- **검토 항목** — 이유는 `reason_*`(묶음 · 머리 포함)로, 보고서에는 `readerCheck` 로 바꾼 항목(이유 = 한국어 · 그 단위, 구조 필드는 뺀다). MCP 요약의 지배 항목 머리는 `name_ko` · `reason` · `reason_code`, 검토 줄은 지배 항목이 아니면 `reason` · `reason_code`(지배 항목의 까닭은 머리에만 — 한국어 글이 길어 두 번 싣지 않는다).
- **이름표** — 랩 패스너 `fastener_label_parts` → `fastenerLabel`(볼트 d=12.7 mm). §I6.2.1 조건의 `value` · `limits` 는 `value_quantity` 로 SI(`i621ToSI`), `as_length` 는 quantity 로.
- **MCP 답의 모양** — MCP 서버가 도구마다 `units` · `detail` 을 `__reply` 로 본문에 싣고(엔진 인자가 아니다 — 호스트가 뺀다) 호스트가 `forReader` 로 그린 뒤 MCP 서버가 줄인다. 알림 항목은 `{code, text}`(code 가 없는 호스트 글은 글), `notices_elsewhere` 는 `{kind, code?, text, where}`. 퍼린 요약의 §I6.2.1 은 조건마다 `{id, status, value, limits, unit, value_as_length}`(이름표 목록은 `detail:'checks'`).
- 화면이 단위를 바꾸면 다시 그리는 카드(설계 · DSM · 하중 해석 · 보고서)는 새 단위로 그린다. 랩 · 접합 카드는 지금처럼 다음 실행까지 그 단위(전부터 그랬다).

**독립 프로그램(데스크톱 담당)이 따를 것:** 새 화면이 엔진 결과의 글을 보일 때 `StcfsdNotices`(같은 파일)를 쓴다 — `render` · `lines` · `reason` · `fastenerLabel`, 단위는 화면의 단위, 말은 한국어, code 를 함께. 다리의 MCP 중계는 `__reply` 를 넘겨도 되고(그대로 호스트에 간다) 넘기지 않으면 결과는 엔진 그대로다.

## 4e. 변경 묶음 · 출처 꼬리표 (R2-2)

- 화면(편집 상태)이 열고 닫을 때 호스트에 알린다: 웹뷰 메시지 `{command: 'editSession', data: {state: 'start' | 'end' | 'discard'}}` 또는 다리가 사람의 길로 `panel.editSession(state)`. 그 사이의 사람 편집은 한 묶음, 밖은 조용한 2 초, AI 요청이 끼면 나뉜다.
- `list_changes`(→ 73) — 묶음마다 누가 · 언제 · 제목(프로그램이 칸에서) · 까닭 · 업무 · 원자료 · 바뀐 칸 수 · 무효로 만든 결과, `detail: 'fields'` 면 칸마다 전 → 후. 프로젝트 밖은 `persisted: false`(이 세션만).
- `get_case_inputs.last_change` — 입력 칸마다 마지막으로 바꾼 묶음(누가 · 언제 · 전 → 후 · 까닭), 프로젝트가 열려 있을 때만.
- `get_status.project.file_read_only {reason, detail}` — 대상이 아닌 채로 읽기 전용으로 연 파일(발행본 …).
- 쓰기 도구의 공용 인자 `reason` · `work` · `source` — 머리로 가고(행위자 문맥) 줄에 실린다. 화면은 쓰지 않는다(사람의 묶음에는 까닭이 없다).

## 5. 하지 않는 것

- 창 · 패널을 앞으로 가져오지 않는다(`reveal` 을 부르지 않는다). 모델 · 결과 · 입력 리비전을 바꾸지 않는다(시험: `panel_host_contract` K4aView 가 모델 서명을 맞댄다).
- 보기 보고는 저장하지 않는다(파일 · `.csd` 에 들어가지 않는다). 호스트가 다시 시작하면 비어 있다.
- 화면이 무엇을 보이는지를 호스트가 짐작하지 않는다 — 화면이 알린 것만 돌려준다.

## 6. 독립 프로그램의 다음 단계가 할 일

- 다리: `focusRequest` 를 다시 보내기 기록에서 한 번만 뜻이 있는 것으로(`TRANSIENT`), `resultsLedger`(무효 장부)는 마지막 것을 남기는 것으로.
- 새 검토 화면: 고를 때 · 보기를 바꿀 때 `report_view` 를 부르고(`screen: 'review'`, `follows_focus` = 「AI 따라가기」), `focusRequest` 를 받아 3.9 대로 따르거나 알림으로 쌓고, 그 결과를 `focus_response` 로 알린다.
- 다리의 MCP 중계(`relayMcp` · `/api/mcp/action`): `X-StCFSD-Screen` 머리에 같은 프로세스의 `out/mcp/actorScope.js` 의 `SCREEN_SECRET` 을 싣는다(없으면 그 요청은 AI 로 적힌다). 사람만 하는 일은 패널의 `recordsPerson` 으로(R1-3 의 `/api/person/*`).
