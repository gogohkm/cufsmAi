# 2026-11-22 엔진 수정 단계 — 수정 담당 공통 지침

작업문서: [`docs/implementation/20261122-desktop-program-worklog.md`](../../implementation/20261122-desktop-program-worklog.md) · 리뷰 지침: [`README.md`](README.md)

리뷰어 8명이 읽기만 하고 낸 보고서(`R1` – `R8`)가 이 폴더에 있다. 수정 담당은 **자기 영역의 보고서를 끝까지 읽고**, 발견사항마다 재현 → 수정 → 회귀 시험 → 기록을 한다. 구조 기술자가 이 엔진의 값을 실제 부재 검토에 쓴다. 고친 것이 새 오류를 만들면 안 고친 것보다 나쁘다.

## 1. 파일 소유 — 같은 작업 폴더에서 여럿이 동시에 고친다

| 담당 | 고칠 수 있는 파일 | 새 시험 파일 | 보고서 |
|---|---|---|---|
| F1 | `python/engine/` 의 `fsm_solver` · `element` · `assembly` · `boundary` · `stress` · `transform` · `vectorized` · `helpers` | `test/python/test_review_1122_fsm.py` | R1 |
| F2 | `python/engine/` 의 `template` · `cfs_centerline` · `properties` · `cutwp`, `python/models/data.py`, `Example/cfs_centerline.py`, `Example/*.md`(문서 오류만) | `test/python/test_review_1122_section.py` | R2 (R2-06 · 07 · 08 · 17 은 F3) |
| F3 | `python/cfsm/` · `python/fcfsm/` · `python/vibration/` · `python/plastic/` | `test/python/test_review_1122_cfsm.py` | R3 + R2-06 · 07 · 08 · 17 (R3-09 의 `GBTConfig.is_active` 는 F2 의 `models/data.py`) |
| F4 | `python/design/` 의 `aisi_s100` · `dsm_strength` · `global_buckling` · `interaction` | `test/python/test_review_1122_member.py` | R4 + R7-17 의 호출자 쪽 + R8-02 · R8-11 의 엔진 쪽 + R5-25 |
| F5 | `python/engine/dsm.py`, `python/design/` 의 `shear` · `steel_grades` | `test/python/test_review_1122_dsm_shear.py` | R5-01 – R5-16, R5-30, R5-31 |
| F6 | `python/design/` 의 `connections` · `lap_connection` · `special_topics` | `test/python/test_review_1122_connections.py` | R6 + R5-20 – R5-24 |
| F7 | `python/design/loads/` 전부 | `test/python/test_review_1122_loads.py` | R7 (R7-17 의 호출자 쪽은 F4, R7-23 · R7-25 는 다음 묶음) |

- **자기 파일 말고는 고치지 않는다.** `python/server.py`, `src/`, `webview/`, `media/` 는 이번 묶음에서 아무도 고치지 않는다(다음 묶음). 다른 담당의 파일에서 고칠 것을 보면 기록의 「후속」에 적는다.
- 예외: 기존 시험 파일(`test_design_verification.py`, `test_regression_0926.py`, `test_solver.py`, `test_element.py`)은 **틀린 동작을 잠그고 있는 시험을 바로잡을 때만**, 그 시험 함수 안에서만, Edit 도구로 좁게 고친다. 다른 담당도 같은 파일의 다른 함수를 고치고 있을 수 있다. 파일을 통째로 다시 쓰지 않는다.
- **git 으로 작업 폴더나 인덱스를 바꾸지 않는다**(`stash` · `checkout` · `restore` · `reset` · `add` · `commit` 금지). 다른 담당의 작업이 날아간다. `git diff` · `git status` · `git log` 로 읽는 것은 된다.
- `.mcp.json`, `Example/.mcp.json`, `Example/.claude/`, `.claude/` 는 사용자의 미커밋 변경이다. 건드리지 않는다.

## 2. 무엇을 고치나

1. **「확인」 P0 – P2 는 자기 파일 안에서 고칠 수 있으면 전부 고친다.** P3 는 손쉬우면 고치고 아니면 까닭과 함께 보류한다.
2. **「의심」은 먼저 가른다.** 확정되면 고치고, 확정하지 못하면 고치지 않고 무엇이 모자랐는지 적는다.
3. 고치기 전에 **재현한다.** 리뷰어의 스크립트가 `C:\Users\USER\AppData\Local\Temp\claude\3df7e1c8eb560f18\99d094e4-961f-4f09-9be9-02ec03b2e201\scratchpad\review\R<n>\` 에 있다. 재현되지 않으면 고치지 않고 「기각」으로 적는다(리뷰어가 틀릴 수 있다).
4. 계수 · 한계 · φ/Ω 는 **원문으로** 확인한다(Skill `aisi-cold-formed-steel` · `asce7-loads-design` · `aisc-steel-design`, `Ref_Source/`, `Example/*.md`). 보고서에 적힌 숫자도 원문으로 다시 본다.
5. 보고서의 「수정안」은 제안이다. 더 좁고 안전한 길이 있으면 그 길로 가고 까닭을 적는다.

## 3. 지켜야 할 규칙

### 3.1 조용한 합격을 없앤다 — 판정의 뜻을 하나로

결과의 `pass`(또는 그에 해당하는 판정 필드)는 어디서나 이렇게 정한다.

- 평가한 한계상태 가운데 **하나라도 불합격이면 `False`**. 미평가 항목이 있어도 불합격이 이긴다.
- 불합격은 없지만 **해당하는데 평가하지 못한 한계상태가 있으면 `None`**(판정 없음). `True` 로 두지 않는다.
- 해당하는 한계상태를 모두 평가했고 모두 만족할 때만 `True`.
- 해당하지 않는 한계상태(예: 립 없는 단면의 뒤틀림 좌굴)는 「평가하지 못함」이 아니다. 판정을 `None` 으로 끌어내리지 않는다.
- 평가하지 못한 것 · 기본값으로 채운 입력 · 적용 범위 밖 사용은 결과의 `warnings`(이미 있는 목록)에 사람이 읽는 문장으로 남긴다. 화면과 MCP 가 그대로 보여 준다.
- 빠지면 계산이 뜻을 잃는 입력(단면 성질, 두께, 강도 등)은 기본값으로 채우지 말고 `{'error': ...}` 또는 예외로 분명히 거절한다. 지금 호출자가 그 기본값에 기대고 있으면 「후속」에 적는다.

### 3.1.1 경고 · 가정 · 범위 안내를 나눈다 (검증 V2-10 뒤에 더함)

늘 뜨는 경고는 읽히지 않는다. 결과의 알림을 셋으로 나눈다(모두 문자열 목록, 없으면 빈 목록).

| 키 | 넣는 것 | 예 |
|---|---|---|
| `warnings` | **이 실행에서 값이나 판정을 바꾼 것**, 사용자가 손봐야 하는 것 | 적용 한계 밖, 평가하지 못한 한계상태와 까닭, 입력끼리 어긋남, 버려진 길이 |
| `assumptions` | **이 실행이 가정한 것** — 틀리지는 않았지만 사용자가 알아야 판정을 믿을 수 있는 것 | 기본값으로 채운 입력, 해석식으로 대체한 좌굴값(출처), 표에 없는 조합에 쓴 안전측 대체 행, 자체 해석(A1.2(c)) |
| `scope_notes` | **입력과 상관없이 늘 참인 범위 안내** — 이 프로그램이 다루지 않는 것 | 구멍, H4 비틀림, C1 의 B2(P-Δ), D1 |

평가하지 못한 한계상태의 목록(`not_evaluated`)은 그대로 두고 `warnings` 에도 한 줄 남긴다. 같은 문장을 하위 결과와 상위 결과에 되풀이하지 않는다(조합 검토가 압축 · 휨의 경고를 다시 싣지 않게 — 한 번만).

### 3.2 호출 계약은 덧붙이기만

- 함수 이름, 지금 있는 인자, 지금 있는 결과 키의 뜻을 바꾸지 않는다. 새 인자는 기본값을 두고, 새 결과 키는 덧붙인다. `python/server.py` 와 TypeScript 호출자는 다음 묶음에서 따라오므로 그때까지 지금 그대로 돌아야 한다.
- 결과 **값**이 바뀌는 것은 괜찮다(그것이 수정이다). 값이 바뀌는 수정은 기록에 「전 → 후」를 적는다.
- 내부 단위는 US(in, kip, ksi)다.

### 3.3 구현하지 않은 조항

- 틀린 합격을 막는 데 필요한 조항은 구현하거나, 구현하지 않을 거면 그 한계상태를 「평가하지 못함」으로 결과에 올려 판정이 `True` 가 되지 않게 한다. 조용히 건너뛰는 것만 안 된다.
- 기준에 없는 자체 가정은 숫자를 바꾸기 전에 결과에 **가정임을 밝힌다**. 가정 자체를 바꾸는 것은 사용자가 정할 일이므로 「사용자 결정 필요」로 기록한다(예: R6-13 랩 패스너의 힘 분배 모델 — 모델은 그대로 두고 밝히기만 한다).

### 3.4 시험

- 발견사항마다 회귀 시험을 자기 시험 파일에 넣는다. `def test_<번호>_<내용>():` 꼴의 함수, 실패는 `assert` 로. `test/python/review_suites.py` 가 `test_review_*.py` 를 자동으로 모아 두 게이트에 넘긴다 — 따로 등록하지 않는다.
- **기대값은 코드가 낸 값을 베끼지 않는다.** 원문의 식을 시험 안에서 따로 계산하거나, 매뉴얼 예제의 인쇄값, 닫힌 해, 독립 해를 쓴다. 허용오차와 출처를 주석으로 적는다.
- 틀린 동작을 잠그고 있던 기존 시험은 바로잡고 까닭을 주석 한 줄로 남긴다.
- 실행
  - 자기 것만: `C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe -m pytest -q -k test_review_1122_<이름>` (저장소 루트에서)
  - 전체: `C:\Coding_Works\cufsmAi\.venv\Scripts\python.exe test\python\run_all.py` (2분쯤)
  - 린트: `C:\Coding_Works\cufsmAi\.venv\Scripts\ruff.exe check python test`
- 다른 담당이 같은 때에 다른 모듈을 고치고 있다. 전체 시험에서 **자기 영역 밖**의 실패가 보이면 한 번 더 돌려 본다. 자기 변경 때문이면 고치고, 남의 변경 때문이면 고치지 말고 「후속」에 적는다.

### 3.5 코드

- 주변 코드의 방식(이름, 주석 언어, 오류 처리)을 따른다. 주석은 "왜"만 쓴다. 조항 번호는 좋고, 리뷰 번호(R6-01 등)는 코드가 아니라 시험의 docstring 에 적는다.
- 요청받지 않은 리팩터링, 이름 바꾸기, 파일 재배치는 하지 않는다.

## 4. 영역을 가로지르는 계약

담당들이 동시에 일하므로, 서로 기대는 곳의 모양을 여기서 정한다. **각 담당은 자기 쪽만 고쳐도 틀린 합격이 닫히게 한다**(상대가 아직 옛 코드여도).

### 4.1 좌굴 모드 식별 — R3-01 · R3-04 · R3-14 · R5-01 · R5-02 · R5-04 · R4-01 · R4-09

지금의 P0: 둥근 모서리(r > 0) 단면에서 cFSM 이 국부 극소를 D 94 – 99 % 로 분류하고, `dsm.py` 가 극소 하나의 라벨로 다른 모드를 `*_detected=False` + `classification_method='cfsm_modal'` 로 돌려주고, `aisi_s100.py:455,771` 이 그것을 "부재 확인"으로 읽어 국부(또는 뒤틀림) 감소를 건너뛴다(Pn +26 – 32 %).

- **F3 `cfsm.classify`**: 믿을 수 없는 분류는 숫자로 내지 않는다. 고전 cFSM 의 전제가 깨지는 모델(호를 요소 여럿으로 나눈 둥근 모서리, 닫힌 단면, 가지 단면)과 분류 실패는 그 행을 **NaN** 으로 낸다(25 % 균등 · 0 행 금지). 둥근 모서리를 제대로 분류하는 길(호의 절점을 부절점으로 다루기, 날카로운 모서리 등가 기저 등)을 넣어도 좋지만, 같은 단면의 r = 0 모델 결과(국부 극소 L ≥ 90 %, 뒤틀림 극소 D ≥ 85 %)와 맞는 것을 시험으로 보인 경우에만. 보이지 못하면 NaN.
- **F5 `engine.dsm.extract_dsm_values`**: NaN / None 분류 행은 "미분류"로 다뤄 그 극소는 휴리스틱으로 정한다. `local_detected` · `dist_detected` 가 False 인 것은 "이 곡선에서 분리되지 않았다"는 뜻일 뿐이다. 결과에 `local_absence_verified` · `dist_absence_verified` 를 새 키로 덧붙이되, 곡선과 분류만으로는 부재를 확정할 수 없으므로 **언제나 False** 다. 두 모드 가운데 하나라도 라벨로 정해지지 않았으면 `classification_method` 가 `'cfsm_modal'` 로 시작하지 않게 한다(옛 호출자가 "부재 확인"으로 읽지 못하게).
- **F4 `aisi_s100`**: `classification_method` 문자열에서 부재를 추론하지 않는다. `Pcrl` · `Mcrl` 이 없으면 부록 2 해석식 대체(출처를 `dsm_source` 등에 표시), 그것도 못 하면 「평가하지 못함」. 뒤틀림은 **단면 형상**으로 해당 여부를 정한다(연단 보강 플랜지가 있는 단면만 해당). 해당하는데 값이 없으면 해석식 대체 → 못 하면 「평가하지 못함」.

### 4.2 기준 응력의 일관성 — R1 의 메모 · R5-03

- **F4**: `aisi_s100._auto_generate_props`(`:2347-2370` 부근)에서 항복 모멘트와 휨 응력 분포를 같은 `unsymm` 가정으로 만든다(Z 단면에서 응력 최댓값이 fy 가 아닌 문제).
- **F5**: `extract_dsm_values` 가 절점 응력의 최댓값과 기준(fy)이 맞는지 확인한다. 어긋나면 일관된 기준으로 환산하고 경고를 남기거나 오류를 낸다.

### 4.3 냉간가공 Fya 는 G 장 · H3 에 쓰지 않는다 — R4-07 · R5-25

- **F4**(호출자): 전단 · 웹 크리플링 · H3 에는 Fy 를 넘긴다.
- **F6**(`special_topics.cold_work_strength`): R5-22. 단독 호출의 `applicable` 이 조건을 실제로 반영하게.

### 4.4 J6 파단 계수와 전단지연 — R5-20 · R5-21 · R6-12 — 전부 F6

`special_topics.py` 는 F6 의 파일이다. 표 J6-1 의 φ / Ω(`connections.PHI_RUPTURE` · `OMEGA_RUPTURE`)와 표 J6.2-1 의 Usl 식은 한 곳에만 두고 `connections.py` 와 `special_topics.py` 가 같은 것을 쓴다. `special_topics.shear_lag` · `block_shear` · `cold_work_strength` · `flange_curling` 의 이름과 지금 인자는 그대로 둔다(`server.py` 와 `aisi_s100.py` 가 부른다).

### 4.5 종방향 항 — R1-01 · R1-02 (F1)

엔진에 `m_recommend` 를 옮기고, `stripmain` 이 `msort` 를 부르고, 단부 조건이 S-S 가 아닌데 항이 모자라면 `diagnostics` 에 경고를 낸다. **호출자가 준 `m_all` 을 엔진이 몰래 바꾸지는 않는다** — 다음 묶음에서 `server.py` 와 호스트가 `m_recommend` 로 항을 고르게 한다(「후속」에 필요한 것을 적는다). 조립 성능(R1-04)을 먼저 고쳐야 여러 항 해석을 시험할 수 있다.

### 4.6 템플릿 치수의 뜻 — R2-10 · R2-11 (F2)

`.csd` 파일과 화면이 지금의 치수 뜻에 기대고 있다. 있는 인자의 뜻을 뒤집지 말고(햇의 H / B, CHS 의 `D`), 화면(`src/webview/StcfsdPanel.ts`, `webview/js/app.js`)이 실제로 무엇을 보내는지 읽어서 확인한 다음, 엔진에는 분명한 이름의 인자를 **덧붙이고**(예: CHS 의 바깥지름) MCP 설명 · 화면을 고칠 것은 「후속」에 적는다.

### 4.7 `print()` — R4-17

`python/server.py` 는 stdout 으로 JSON-RPC 를 말한다. 엔진 코드의 `print()` 는 프로토콜을 깨뜨린다. 자기 파일의 `print()` 는 없애거나 `sys.stderr` 로 보낸다(시험 파일은 상관없다).

## 5. 기록

끝나면 `docs/reviews/20261122-engine-review/fixes/F<n>-<영역>.md` 를 쓴다(한국어).

```
# F<n> — <영역> 수정 기록

## 요약
(고침 n · 보류 n · 기각 n · 사용자 결정 필요 n. 전체 시험 결과 한 줄)

## 발견사항별

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| R?-01 | 고침 / 보류 / 기각 / 사용자 결정 필요 | … | … | `test_…` |

## 후속 — 다른 곳이 따라와야 하는 것
(`python/server.py` · TypeScript 호출자 · MCP 스키마 · 화면이 새 인자 · 새 키 · 새 오류를 쓰려면 무엇을 해야 하나. 파일:줄과 함께)

## 사용자 결정 필요
(무엇을, 왜, 선택지)

## 못 한 것
```

오케스트레이터에게 돌려줄 말은 50줄 안쪽: 처리 건수, 값이 크게 바뀐 수정, 후속 · 사용자 결정 항목, 전체 시험 결과(명령과 마지막 줄).
