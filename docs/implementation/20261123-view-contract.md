# 보기 계약 (`get_view` · `focus`) — 2026-11-23

작업문서: [`20261122-desktop-program-worklog.md`](20261122-desktop-program-worklog.md) §8.4 · 구성안: [`20261122-desktop-interface-proposal.md`](20261122-desktop-interface-proposal.md) §3.9 · §5 · 검토 항목 id: [`20261123-check-contract.md`](20261123-check-contract.md)

사람이 무엇을 보는지(`get_view`)를 AI 가 읽고, AI 가 「여기를 보세요」(`focus`)를 청하는 길이다. 호스트(`src/webview/StcfsdPanel.ts`)는 화면이 알린 마지막 보기를 기억하고, AI 의 요청을 붙은 화면에 메시지로 넘길 뿐이다. **어느 것도 모델을 바꾸지 않고 창의 포커스를 가져가지 않는다.** 화면이 없거나 따라가지 않아도 도구는 실패하지 않는다.

## 1. 항목 id — `item`

| 필드 | 뜻 |
|---|---|
| `kind` | `check` = 결과의 검토 항목 하나 · `model` = 모델의 한 부분 · `result` = 결과 전체나 그 한 부분 |
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
    screen: 'designer' | 'review' | …,   // 소문자 · 숫자 · _ · -, 32자까지. 화면마다 마지막 보고 하나를 둔다(8개까지)
    view: 'tab:design' | 'checks' | …,   // 화면이 정한 보기 이름(120자까지)
    selection: item | null,              // 1절의 id
    follows_focus: true | false,         // 「AI 따라가기」가 켜져 있는가. 따라가지 않는 화면은 false
    by: 'person' | 'program' | 'focus',  // 사람이 고름 · 화면이 스스로 옮김 · AI 의 focus 를 따라감
    focus_response?: { request_id, followed: true | false, note? }   // 마지막 focus 요청에 대한 답
} }
```

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

## 5. 하지 않는 것

- 창 · 패널을 앞으로 가져오지 않는다(`reveal` 을 부르지 않는다). 모델 · 결과 · 입력 리비전을 바꾸지 않는다(시험: `panel_host_contract` K4aView 가 모델 서명을 맞댄다).
- 보기 보고는 저장하지 않는다(파일 · `.csd` 에 들어가지 않는다). 호스트가 다시 시작하면 비어 있다.
- 화면이 무엇을 보이는지를 호스트가 짐작하지 않는다 — 화면이 알린 것만 돌려준다.

## 6. 독립 프로그램의 다음 단계가 할 일

- 다리: `focusRequest` 를 다시 보내기 기록에서 한 번만 뜻이 있는 것으로(`TRANSIENT`), `resultsLedger`(무효 장부)는 마지막 것을 남기는 것으로.
- 새 검토 화면: 고를 때 · 보기를 바꿀 때 `report_view` 를 부르고(`screen: 'review'`, `follows_focus` = 「AI 따라가기」), `focusRequest` 를 받아 3.9 대로 따르거나 알림으로 쌓고, 그 결과를 `focus_response` 로 알린다.
