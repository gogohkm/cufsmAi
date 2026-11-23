# V6b — 검토 항목 계약(V6) 처리의 재검증

검증 대상: `feature/desktop-program` 커밋 **`f08e10e`**.
- 엔진 수정: `b288448`(V6 엔진 항목), `6b283a5`(`envelope_source`, `engine_id`).
- 경계층 수정: `b60e62d`.
- 그 뒤 `f08e10e`(K3)가 `StcfsdPanel.ts` · `server.ts` 를 넓게 고쳤다. python 은 `6b283a5` 뒤로 바뀌지 않았다(`git diff --stat 6b283a5 f08e10e -- python` 이 비어 있음).

작업 트리가 아니라 `git archive f08e10e` 사본(`v6\b\srcF`)과 `git archive 790492e` 사본(`v6\b\src790`, python · test/python 만)에서 돌렸다.
저장소에서 고친 것은 이 보고서 하나다. 스크립트는 `C:\Users\USER\AppData\Local\Temp\claude\3df7e1c8eb560f18\99d094e4-961f-4f09-9be9-02ec03b2e201\scratchpad\v6\` (아래 `v6\`)와 `v6\b\boundary\`(경계층) 에 있다.
처리 주장은 작업문서 §6.11, 계약 문서 §4 · §6 · §14.2 · §15 를 기준으로 봤다. 기준 원문은 `aisi-cold-formed-steel` 스킬의 S100-16 본문 · 부록 · Design Manual 이다.

## 요약

**20건 가운데 16건이 닫혔고, 셋은 일부만 닫혔다(V6-13 엔진 · 경계층, V6-16). S-3 은 다시 보지 않았다.**

- 강도는 하나도 바뀌지 않았다.
  - `790492e` → `f08e10e` 의 옛 키 변화는 계약 사례에서 정확히 18 값이다(§14.2 (가)와 같다). 내 경계 사례 97개에서는 6 값이다.
  - `design_checks` 의 capacity · nominal 은 값이 바뀐 것이 0이고, reference 로 옮겨진 것만 16개다.
- 전체 판정이 바뀐 것은 Mnd 없는 랩뿐이다(계약 2, 내 사례 2).
- 엔진 쪽 추가 확인:
  - 계산 과정 단계 6,367개 가운데 4,658개를 원문 식으로 다시 계산했다. 어긋난 것은 0이다(새 단계 꼴 30여 개를 식 사전에 더함).
  - 갈래 870개, 지수 비 `(value/limit)^(1/n)`, 식 번호, quantity, 뿌리 입력도 모두 맞다.
  - Manual 중간값(III-3 부록 2, IV-2, IV-9, IV-11, IV-12)도 그대로다.
- 회귀(경계층 포크가 사본에서 돌림): `run_all.py` 336 PASS, pytest 436 passed, ruff 통과, `test:webview` 통과, `check:mcp-parity` OK(65 도구).

**새 결함은 P0 1 · P1 1 · P2 3 · P3 4 건이다.**
- **V6b-01 [P0]** 퍼린의 지점 위 검토점이 지점 한쪽 면의 전단만 쓴다. 랩 구간의 H2 가 0.995 "합격"인데, 같은 조합의 그 면 전단으로는 1.010(불합격)이다. 이 결함 때문에 "포락선 짝짓기는 안전 측" 결정도 그대로는 성립하지 않는다.
- **V6b-02 [P1]** 약축 Cmy 를 강축 뒤틀림용 `dist_M1_M2` 에서 만든다. Cmy 는 1.0 → 0.4, B1y 는 1.22 → 1.00 이다(비보수). 옛 동작인데 이번 수정으로 계산 과정에 드러났다.

## 처리 상태

| 번호 | 상태 | 증거 |
|---|---|---|
| V6-01 | 닫힘 | H1.2 계산 과정에 `Pe1x/Pe1y`(C1.2.1.1-5), `Cmx/Cmy`(-4), `B1x/B1y`(-3), `Mx,amp` · `My,amp` · 앵글 `PL/1000` · `My,ecc ≥ My,amp` 갈래가 선다. `audit_steps_b.py` 로 모두 다시 계산했다(`combined Mx My LRFD`: B1y 1.0232, `combined angle (P)L/1000`: B1y 1.0564, My,ecc 0.05705). `audit_roots.py` 의 Muy 불일치 0. 단 V6b-02 |
| V6-02 | 닫힘 | (포크) 단일 결과 145개 × US/SI × 요약/검토 수준에서 빠진 알림 · 불합격/미검토/지배 id 0. 퍼린 7개도 0. 남은 것: 하중 해석의 `note` 문장(처짐 "풍 1.0" 등)이 요약에 없음 — V6b-09 |
| V6-03 | 닫힘 | `set_governing` 이 무리 상태로 고른다(불합격 > 미검토 > 통과) + `governs_basis` · `highest_evaluated`. `bolt assumed e`: J6.1(미검토, 참고 1.216) 지배, highest_evaluated 지압 0.658. 요약 쪽 `governs_basis` · `reference_ratio` · `utilization_caveat` 도 있다(포크). 남은 것: 범위 밖 나사의 caveat 이 범위 밖 지압 0.167 을 "평가한 최대"로 부름 — V6b-09 |
| V6-04 | 닫힘 | `screw out of scope d` · `bolt thick` 의 범위 밖 항목이 `not_evaluated`, `out_of_scope: J4 / J3/J6`, 값은 `reference`. 원문이 막지 않는 J6(나사, t ≤ 3/16)은 통과로 남는다 — 맞다. 남은 것: 범위 밖 식으로 낸 **불합격**은 불합격으로 남는데(규칙대로) `out_of_scope` 표지가 없음 — V6b-09 |
| V6-05 | 닫힘 | `Vn,lap = 2 Vn` 단계, F'nt 입력 Fnt · φv/Ωv · Fnv · fv · n · Ab, J2.2.2.1-3 에 λ · da/t. 손계산: LRFD F'nt = 58.5 − 45/(0.75·27)·19.353 = 15.493, ASD 24.547 — 일치 |
| V6-06 | 닫힘 | J2.2.4 · C-J5.4-1 의 비가 (값/한계)^(1/n). IV-2 ASD 0.737 → 0.8159, LRFD 0.9376 → 0.9579, multi sheet 0.6716 → 0.7669. 내 재계산과 차이 0, 합격 · 불합격 같다. 다른 상호작용(H1 · H2 · H3 · J4.5 · App. A J3.4)은 선형이거나 √꼴이라 같은 종류가 없다 |
| V6-07 | 닫힘(규칙대로) | Mnd 가 없으면 미검토, `distortion_restrained: true` 를 주면 해당 없음(출처: 사용자 입력). 확인: 입력을 주면 `lap bolt Se e=2` 가 PASS. **"옛 합격이 틀렸다"는 지나치다** — Manual II-1A · II-2A 가 "The lapped section is assumed to be sufficiently restrained against … distortional buckling" 을 가정으로 밝히고 쓴다. 옛 합격은 그 가정을 말하지 않고 썼을 뿐이다. 새 동작은 FIXES §3.1 에 맞다. 그러나 V6b-04(호스트 랩 구간은 같은 가정을 자동으로 씀) |
| V6-08 | 닫힘 | (포크) 진짜 조합 이름이 붙은 검토점 90개를 독립 보 해석으로 다시 풀었다 — M · V 가 그 조합과 맞다. 나머지는 `envelope`. 호스트는 아직 `envelope_source` 를 쓰지 않는다(주장대로) |
| V6-09 | 닫힘 | (포크) 패턴 사례 정모멘트 구간 V_max 점 Mu 112.4 → 62.72. 지점 면의 전단은 다른 문제다 — V6b-01 |
| V6-10 | 닫힘 | (포크) 패스너 줄 7개가 모두 남고, `moved_to_top` 은 실제로 옮긴 하나 |
| V6-11 | 닫힘 | 엔진: 단위 있는 상수는 모두 `quantity` 입력(Usl, F_uh,alt 260, d'w,max, t,lim, B4 Fy). 남은 식 숫자는 무차원 계수뿐(`v6\b\invF.txt` 조사). J3.3.2-1 은 α 입력 + `expr_units: US`. 경계층: SI 알림 문장도 고쳐졌다(포크) |
| V6-12 | 닫힘 | (포크) `support` · `span` 둘 다 1-기준, `region_support` 추가 |
| V6-13 | **일부** | 엔진: 새 시험(`test_review_1124_trace_recompute.py`)은 식을 원문에서 따로 옮겨 적었다(표 2.3.1.3-1 의 θ 일반식 등, 엔진 코드와 꼴이 다름). 심은 오류 넷 가운데 **둘만** 잡는다 — V6b-05. 경계층: 위치 시험이 하중 해석 격자와 대조하지만, 격자가 지점에서 한쪽 전단만 가져 V6b-01 을 굳힌다(포크) |
| V6-14 | 닫힘 | `probe_govcheck_rounding.py`: F 0.50003 · 정모멘트 0.50002 → `governing_check = F flexure`(옳음) |
| V6-15 | 닫힘 | `de = 0.7d − 1.5t (≥ 0)` 가 J2.3.2.1-3 이고, `min(de, 0.55d)` 는 식 번호 없는 사내 단계다. 걸리면 `assumptions` 에 한 줄(d 0.75, t 0.03 으로 확인) |
| V6-16 | **일부** | `design_checks` 안에서는 `{value: null, unbounded: true}`, SI 에서도 환산하지 않는다. 그러나 옛 결과의 `steps[].value`(Fcre 1e6 ksi)는 SI 에서 6,894,757 MPa 로 여전히 바뀐다(II-9 RHS, III-11 RHS ASD/LRFD, cold work + shear + wc, band H1.2 — 포크) |
| V6-17 | 닫힘 | (포크) 145 사례에서 `si_unconverted` 비어 있음. Lu 1659.5 in → 42,152 mm |
| V6-18 | 닫힘 | J4.5.x-1a/b, Pcrl(2.3.1.2-1) · Pcrd(2.3.1.3-1) · Mcrd(2.3.3.3-1) 식 번호가 붙었다. `audit_eqlabels.py` 가 새로 찾은 것은 `H1.1-3` 하나(원문은 -3a/-3b) — V6b-09 |
| V6-19 | 닫힘 | §14.1 에 다섯 사례 15 값 |
| V6-20 | 닫힘 | `I6.2.1 R exceeds table`: F2 · F3 · F4 도 미검토, 이유 "§I6.2.1 cannot be applied" |
| S-1 (랩 J6.3) | 처리됨(결정) | `lap.block_shear`(미검토, `counts: false`) + `scope_notes`. 결정은 아래 검토 |
| S-2 (조합 섞임) | 닫힘 | `envelope_source` 와 검토점 `combination`/`envelope` 로. 짝짓기 결정은 아래 검토 |
| S-3 (1e-9 허용오차) | 다시 보지 않음 | 코드 변화 없음 |

### §14.2 의 완전성

- (가) 옛 키 18 값: 내 비교와 하나하나 같다.
- (나) `design_checks` 칸: 내 비교에서는 161 칸이 바뀌었다(`v6\s142_complete.py`). §14.2 는 155 칸이다. 빠진 **6 칸**은 범위 밖으로 바뀐 항목의 `nominal`(값 → null — 값은 `reference.capacity` 와 계산 과정에 남음)이다. 사례는 `bolt thick (AISC scope)` 의 `conn.bolt.shear` · `conn.j6.*` 셋, `screw out of scope d` 의 `conn.screw.bearing_tilting` · `conn.screw.shear` 다. 값이 바뀐 강도는 0 이다.
- 전체 판정 변화는 `lap bolt Se e=2` · `lap bolt short lap`(계약), 내 `lap short length LRFD/ASD` 뿐이다. 넷 다 Mnd 없는 랩이다.

## 결정 네 가지에 대한 의견

1. **랩 블록 전단(J6.3)을 밝히되 판정에 세지 않는다 — 조건부로 받아들일 수 있다. 다만 까닭이 틀렸고, 더 나은 길이 있다.**
   - Manual 의 랩 예제(II-1A, II-2A)는 랩 패스너를 전혀 검토하지 않는다. 가정 (a) "The purlins are connected within the lapped portions in a manner that achieves full continuity" 로 접합부를 예제 밖에 둔다. 그래서 Manual 로는 어느 쪽도 정해지지 않는다.
   - 결정의 까닭("웹 볼트 랩은 **수직** 전달력이라 블록이 플랜지를 찢어야 한다")은 엔진 자신의 모델과 맞지 않는다.
     - 엔진은 `V_transfer = Mu/(d − t)` 를 부재 축 방향(수평)으로 놓는다.
     - `lap.block_shear` 의 이유 문장도 "shear planes along the lap from the member end, tension plane between the fastener rows" 다.
   - 엔진의 모델과 배치(패스너를 랩 전체에 s 간격으로 펼침)대로 J6.3 을 손으로 계산했다(`v6\probe_lap_j63.py`, Eq. J6.3-1/-2, 표 J6-1). 줄 사이 게이지 g 를 1–6 in 으로 바꿔도, J6.3 비가 패스너 무리 비보다 낮았다.
     - II-2A 같은 볼트 랩: 0.571 대 0.903.
     - 촘촘한 #12 나사 랩 Mu 185: 0.972 대 0.999. 이 경우는 랩 휨이 이미 1.04 로 불합격이다.
   - 랩을 펼쳐 놓는 한 J6.3 은 랩 휨이 막는 전달력 근처까지 와도 넘지 않았다. 그러나 이는 배치 가정(전체에 고루) 위에 서 있다. 실제 상세가 패스너를 랩 끝에 모으면 전단면이 짧아져 J6.3 이 지배할 수 있다.
   - **권고:** 장력면을 무시한 하한 Pnr ≥ min(0.6 Fy Agv, 0.6 Fu Anv)(Ant = 0)은 엔진이 이미 아는 e · s · n · t · dh 만으로 계산된다. 그것으로 J6.3 을 **평가하고 판정에 넣으면** "입력으로 풀 수 없다"는 반대가 사라진다(보수 쪽). 그대로 두려면 결과에 "패스너가 랩 전체에 펼쳐진 배치 가정에서만 J6.3 이 지배하지 않는다"는 근거를 적어야 한다.
   - V6-07 은 같은 종류의 가정(뒤틀림 구속)을 "입력으로 풀 수 있는 미검토"로 처리했다. 두 결정이 반대 규칙을 쓴다.

2. **Mu/Vu 포락선 짝짓기 — 조합을 섞는 논리는 맞다. 결정 전체로는 V6b-01 때문에 틀렸다.** (포크)
   - H2-1 은 |M| · |V| 에 대해 단조 증가한다. Maℓo · Va 는 조합과 무관하다.
   - 호스트는 검토하는 플랜지 부호의 모멘트만 짝짓는다(V6-09 수정 뒤). 그래서 반대 부호 상태가 섞이지 않는다.
   - H2-2 는 퍼린에서 쓰이지 않는다(호스트가 `transverse_stiffeners` 를 넘기지 않음). 그래서 H2-2 의 갈래(M/Maℓo > 0.5 그리고 V/Va > 0.7)가 짝짓기로 켜지는 일은 없다.
   - H3 은 지점 반력 포락선 P 와 지점 모멘트 포락선을 짝짓는다. 둘 다 식을 키운다. 랩 안 지점의 웹 크리플링 · H3 은 미검토로 밝힌다.
   - 따라서 같은 플랜지에 대해서는 포락선 짝이 어느 한 조합보다 작지 않다.
   - **반례는 조합이 아니라 지점의 어느 면 전단을 쓰느냐에서 나온다(V6b-01).** 의심: H2 는 M_max · V_max · 지점 점에서만 보고, 그 사이를 찾지 않는다.

3. **아크 심 0.55d 상한을 사내 보수 단계로 둔다 — 받아들인다.**
   - 상한은 d > 10t(얇은 판)일 때만 걸린다. 그때는 판 찢김(J2.3.2.1-2)이 용접 전단보다 한 자리 작아 지배한다.
     - d 0.75, t 0.03 의 공칭: 판 찢김 3.6 kips, 용접 전단 33.9 kips.
   - 그래서 상한이 결과를 바꾸는 일은 사실상 없다.
   - 작업문서의 "약 1.3 % 보수"는 일반값이 아니다. 같은 예에서 de 는 14 %, 용접 전단 강도는 16 % 낮아진다. 하지만 그 한계상태가 지배하지 않으니 영향은 없다.

4. **지배 규칙(불합격 > 미검토 > 통과 + `highest_evaluated`) — 받아들인다.**
   - FIXES §3.1 과 같은 순서다. 구현(`checks.py` `set_governing`)이 무리마다 하나만 고르는 것을 계약 · 경계 사례 전부에서 확인했다.
   - 남는 것 두 가지(V6b-09):
     - 범위 밖 식의 불합격이 `out_of_scope` 표지 없이 지배한다.
     - 요약 caveat 의 표현이 어긋난다.

## 새 결함

| 번호 | 심각도 | 위치 | 한 줄 |
|---|---|---|---|
| V6b-01 | **P0** | `src/webview/StcfsdPanel.ts` 2629–2649, 2951–2959 (포크) | 지점 위 검토점의 V 가 격자의 한쪽 면 값 — 랩 구간 H2 0.995 합격, 그 면의 같은 조합으로는 1.010 |
| V6b-02 | **P1** | `python/design/aisi_s100.py:2535-2540` | Cmy 미입력이면 강축 뒤틀림용 `dist_M1_M2` 로 Cmy = 0.6 − 0.4·M1/M2 — 약축 증폭을 줄임(비보수) |
| V6b-03 | P2 | `member_checks.py` (소요 0 처리) + `aisi_s100` 의 `pass` | Mu = 0, Vu > 0 이면 F2–F4 가 `not_evaluated`(counts) 인데 결과 `pass` 는 True — 접기 ≠ 옛 pass |
| V6b-04 | P2 | `StcfsdPanel.ts:2919-2924` vs `lap_connection.py:396-410` | 같은 "랩 뒤틀림 구속" 가정을 퍼린 랩 구간은 자동으로, 랩 도구는 사용자 진술이 있어야 씀 |
| V6b-05 | P2 | `test/python/test_review_1124_trace_recompute.py` | 심은 오류 중 quantity 오표기 · 식 번호 오표기를 못 잡음(식 번호는 Manual III-3 시험이 우연히 잡음) |
| V6b-06 | P3 | `server.ts` 요약 크기 (포크) | cont-6 LRFD + Wp + 패턴, 43 구간: 요약 42.8 KB(US) / 44.9 KB(SI) > 40 KB — 상한은 시험에서만 |
| V6b-07 | P3 | `python/design/loads/required_strength.py` (포크) | 모든 조합이 0 인 측점(끝 지점 M, 대칭 V=0)에서 `envelope_source` 가 부동소수 잡음으로 조합을 고름 — 23 측점에서 문서 규칙(목록 첫째) 위반 |
| V6b-08 | P3 | `python/server.py` `_engine_sources` (포크) | `engine_id` 는 폴더 전체가 없을 때만 `unknown` — 파일 하나를 지우면 그럴듯한 다른 id. numpy/scipy 판 · 비-.py 는 해시 밖 |
| V6b-09 | P3 | 여러 곳 | `H1.1-3`(원문 -3a/-3b), 범위 밖 불합격에 `out_of_scope` 없음, §14.2 의 6 칸, 범위 밖 나사의 caveat 표현, 하중 해석 `note` 가 요약에 없음 |

### V6b-01 [P0] 지점 위 검토점이 지점의 한쪽 면 전단만 쓴다 (경계층 포크가 재현)

- 하중 해석 격자는 지점 측점마다 V 를 하나만 가진다(격자에 따라 왼쪽 또는 오른쪽 면).
- 호스트는 M_max · V_max 검토점에서 그 격자값을 읽는다. 지점 양쪽 면 전단(`Vu_left`/`Vu_right`)은 "support N" 점에서만 쓴다. 그 점은 웹 크리플링 입력이 있고 지점이 랩 안에 있지 않을 때만 생긴다.
- 사례 `flip`: cont-4, 25 ft, D 15 / Lr 102.2 / W −170 plf, 랩 0.5/0.5 ft, ASD, 립 Z 0.059.
  - lap-1 구간 H2 는 0.995, 합격이다.
  - 같은 조합 D+Lr 의 x = 25 ft 바로 왼쪽 면 전단은 부재당 0.894(쓴 값 0.788)이다. 그것으로 H2 = **1.010, 불합격**이다.
- 다른 사례:
  - 랩 없는 cont-3: x = 50 ft 오른쪽 면에서 1.778 → 1.820.
  - 모든 lap-1 구간의 G2 단독도 약 3.4 % 낮다(0.685 → 0.709).
- 재현: `v6\b\boundary\pairing_side.js`, `region_vmax.js`, `purlin_probe.js`(사례 flip, nolap3).
- 판정이 바뀌는 크기는 작지만, 보통 쓰임(퍼린 설계)에서 불합격을 합격으로 낸다.
- 고칠 방향:
  - 지점 위 검토점은 그 구간 쪽 면의 전단을 쓴다.
  - V_max 탐색에 지점 면 값을 넣는다.
  - 시험은 양쪽 면 값과 대조한다.

### V6b-02 [P1] 약축 Cmy 를 강축 뒤틀림용 M1/M2 에서 만든다

- 위치: `aisi_s100.py:2535-2540`. `Cmy` 가 없고 `dist_M1_M2` 가 있으면 `Cmy = 0.6 − 0.4·M1_M2` 다.
  - `dist_M1_M2` 는 부록 2 Eq. 2.3.3.3-3 의 β 용이다. 강축 휨, 뒤틀림 비지지 구간 Lm 의 끝 모멘트 비다.
  - C1.2.1.1-4 의 Cm 은 "그 굽힘 평면의 비지지 구간" 끝 모멘트 비다. 약축 모멘트의 기울기는 강축과 관계가 없다.
- 사례(`v6\probe_cmy.py`): C9, LRFD, Pu 4, Mux 5, Muy 2, May 10, KyLy 96. Cmy 를 주지 않고 dist_M1_M2 = 0.5 를 주었다.

  | 입력 | Cmy | B1y | H1.2 |
  |---|---|---|---|
  | dist_M1_M2 = 0.5 | 0.40 | 1.00 | 0.488 |
  | M1/M2 없음, 또는 Cmy = 1.0 | 1.0 | 1.222 | 0.532 |

  - P/Pey 가 크면 차이도 커진다. αP/Pe = 0.5 이면 B1 은 2.0 대 1.0 이다.
- 계산 과정은 `Cmy` 의 출처를 `user_input dist_M1_M2` 로 적는다. 옛 동작이고, V6-01 수정으로 이제 보인다. 엔진 경고(`aisi_s100.py:2704`)도 "Cmy 또는 dist_M1_M2 를 입력하세요"라고 권한다.
- Cmx 쪽은 굽힘 평면은 같지만, Lm(뒤틀림 구간)과 C1 의 면내 비지지 구간이 다를 수 있다.
- 고칠 방향: Cmy 는 `Cmy` 입력이나 약축 끝 모멘트 비가 없으면 1.0 으로 둔다. Cmx 에 `dist_M1_M2` 를 쓰는 것은 구간이 같을 때만으로 하고 `assumptions` 에 적는다.

### V6b-03 [P2] Mu = 0 이고 Vu > 0 이면 접기 ≠ 옛 pass

- 사례(`v6\probe_mu0.py`): C9, LRFD, Mu = 0, Vu = 1.0.
  - `pass = True` 인데 `design_checks` 를 접으면 `not_evaluated` 다.
  - F2 · F3 · F4 가 "no required flexural strength (Mu = 0)" 로 `not_evaluated`, `counts: true` 이고, 뒤틀림이 지배(미검토)다.
- `790492e` 에서도 같았다. 내 V6 접기 시험은 Mu = 0 을 Vu 없이만 돌려서 놓쳤다.
- 퍼린의 V_max · 지점 점(Mu = 0)에서는 통과 구간 안에 미검토 휨 id 가 114개 나온다(포크, 퍼린 5개).
- 고칠 방향: 휨 소요가 없고 다른 소요가 있으면 F2–F4 는 `not_applicable`(소요 없음)이다. 소요가 하나도 없을 때만 `not_evaluated` 로 둔다.

### V6b-04 [P2] 같은 랩 뒤틀림 가정을 두 길이 다르게 다룬다

- 랩 도구(`lap_connection.py:396-410`)는 Mnd 가 없으면 미검토다. `distortion_restrained: true` 로만 푼다(V6-07).
- 퍼린의 랩 구간(`StcfsdPanel.ts:2919-2924`)은 늘 `distortional_not_applicable = true` 를 넘긴다. 엔진은 `assumptions` 에 "F4 … explicitly excluded … Mnd = My" 를 적고 합격으로 접는다.
- 같은 물리적 가정(Manual II-2A 가정 (f))이 한 길에서는 자동, 다른 길에서는 사용자 진술을 요구한다.
- 고칠 방향: 한 규칙으로 맞춘다. FIXES §3.1 쪽이면 퍼린 랩 구간도 진술(또는 `design_purlin` 입력)이 있어야 해당 없음이다.

### V6b-05 [P2] 새 계산 과정 재계산 시험이 잡지 못하는 오류

`v6\plant_trace_errors.sh` 가 `f08e10e` 사본 넷에 오류를 하나씩 심는다(`member_checks.py` E2 단계).

| 심은 오류 | `test_review_1124_trace_recompute` | 1123 · 1124 시험 전체 |
|---|---|---|
| 갈래 쪽을 뒤집음(`holds = not holds`) | **잡음**(holds 불일치 목록) | 잡음 |
| 입력 하나(Fy)를 뺌 | **잡음** — 다만 "모르는 식"으로 실패해 원인이 가려짐 | 잡음 |
| `Pne` 의 quantity 를 `force` → `moment` | **못 잡음** | 못 잡음(SI 에서는 kN·m 로 바뀐다) |
| 갈래의 식 번호를 늘 `E2-2` 로 | **못 잡음** | `test_manual_E_III_3_trace` 만 잡음(그 사례가 E2-3 이라서) |

- 시험의 식은 원문에서 따로 옮겨 적었다. 예: 표 2.3.1.3-1 을 θ 일반식으로 썼고, 엔진은 90° 식과 θ 식을 나눈다.
- 표 값(G5 계수 · 표 I6.2.1-1 R)은 "입력 = 결과"만 본다. 플레어 베벨 tw 는 서술 단계로 두어 다시 계산하지 않는다.
- 고칠 방향:
  - 결과 기호마다 기대 quantity 를 둔다(예: P* → force, M* → moment).
  - 갈래의 식 번호를 조건과 짝지은 표로 확인한다.
  - 입력이 빠지면 "모르는 식"이 아니라 "입력 없음"으로 실패하게 한다.

### V6b-06 ~ V6b-09 [P3]

- **V6b-06** (포크) 요약 크기 상한 40 KB 가 실제로 넘는다. cont-6 LRFD + Wp + 패턴, 43 구간에서 42.8 KB(US) / 44.9 KB(SI)이고, 상한은 시험에서만 검사한다.
- **V6b-07** (포크) 모든 조합이 0 인 측점에서 `envelope_source` 가 부동소수 잡음으로 조합을 고른다. 23 측점에서 문서 규칙(동률이면 목록 첫째, 경간 기여가 0 이면 "재하 안 함")을 어긴다.
- **V6b-08** (포크) `engine_id` 는 안정하다. 상수 하나(0.815 → 0.816)를 바꾸면 바뀌고, CRLF/LF 에 무관하며, 폴더가 없으면 `unknown` 이다. 그러나 파일 하나(`design/lap_checks.py`)를 지우면 그럴듯한 다른 id 가 나온다. 계약 §15 의 "일부 파일만으로 만든 해시는 내지 않는다"는 폴더 단위에서만 참이다. numpy/scipy 판(FSM 고유값)은 id 밖이다.
- **V6b-09** 작은 표기들:
  - 단계 식 번호 `H1.1-3`(`member_checks.py:1225`) — 원문은 H1.1-3a/-3b 뿐이다.
  - 범위 밖 식으로 낸 불합격(나사 d 0.375, Pu 3 → 지압 2.81)에 `out_of_scope` 표지가 없다. 독자는 그 불합격이 적용되지 않는 식 위에 선 것을 모른다.
  - §14.2 에 6 칸이 없다(위).
  - (포크) 범위 밖 나사의 `utilization_caveat` 이 범위 밖 지압 0.167 을 "평가한 최대"라 부른다. 실제 평가한 최대는 J6.1 0.107 이다.
  - (포크) 하중 해석 `note`(처짐의 풍 1.0 · auto_params)가 요약에 실리지 않는다.

## 경계층 · 새 엔진 출력 (포크 요약)

- **요약 대 full** (`summary_audit.js`, `strict_notices.js`): 단일 결과 145개(US/SI, summary · checks)와 퍼린 7개(R 양력, 패턴, 랩 포함)에서 다음이 모두 0 이다.
  - 빠진 알림 글
  - 빠진 불합격 · 미검토 · 지배 id
  - 빠진 미검토 이유

  랩 사례(Mnd 없음 → 미검토, `lap.block_shear` 진술)와 미검토가 지배하는 무리(e 없는 볼트, Pnvs 없는 나사)의 요약에도 결론을 바꿀 정보가 모두 있다. 남은 것은 V6b-06 · V6b-09 다.
- **`envelope_source`** (`envsrc_check.py`, `combo_label_check.py`): 포크 자신의 유한요소 보 해석 + 모든 조합 × 모든 경간 부분집합 전수로 4,104 측점을 대조했다.
  - 다섯 사례를 썼다: cont-5 Lr 감소 + 랩 + W, cont-3 바닥 L + 랩(LRFD), 20 + 5 ft 내민보, 대칭 D 만(동률), 12/20/14 ft 부등 경간.
  - 이름 붙은 조합 · 패턴이 그 측점의 포락선 값을 재현한다. 처짐 출처 1,642 측점도 맞다.
  - 예외는 V6b-07 이다. 적설 사례는 전수하지 않았다.
- `f08e10e`(K3)는 `b60e62d` 를 되돌리지 않았다. 다만 `generate_report` · `validate_design` 이 호스트가 쓴 파일(PDF)을 돌려주게 바뀌었고, 그 파일은 보지 않았다.

## 회귀 (사본 `v6\b\srcF`, 메인 `.venv` Python)

- `test/python/run_all.py`: 336 PASS, 0 FAIL, exit 0 (`v6\b\boundary\run_all.log`).
- pytest 게이트: 436 passed (98.7 s) (`pytest.log`).
- ruff: All checks passed (`ruff.log`).
- `npm run test:webview`: 모두 통과(mcp_si_chain SI 대조 63) (`webview2.log`). 새 사본에서는 `npm run compile` 이 먼저 필요하다 — 첫 실행은 `out/extension.js` 가 없어 `mcp_port_file_contract` 만 실패했다.
- `npm run check:mcp-parity`: OK, 65 도구 (`parity.log`).
- 참고: 심은 오류 사본에서 `test_review_1122_section.py` 의 두 시험(R2-18, R2-19)이 실패했다. 사본의 폴더 배치에 기대는 시험으로 보이고, 원 사본의 `run_all` · pytest 게이트는 통과했다.

## 확인하지 못한 것

- `test:k2` · `test:rendered`, K3 의 `generate_report` · `validate_design` 이 쓰는 파일(PDF), 독립 프로그램.
- 적설 하중의 `envelope_source` 전수.
- H2 를 검토점 사이에서 찾지 않는 것이 놓치는 최대(의심).
- LSD, 유효폭법, 구멍, FSM 곡선 자체(V6 과 같음).
- S-3(1e-9 절대 허용오차) 재현.

## 스크립트

| 파일 | 하는 일 |
|---|---|
| `v6\audit_steps_b.py <capture>` | `audit_steps.py` 에 새 단계 꼴 30여 개(원문에서)를 더한 재계산, 지수 비 확인 |
| `v6\audit_branches.py`, `audit_roots.py`, `audit_eqlabels.py`, `audit_quantities.py` | V6 와 같음(한계 없는 값 처리 추가) |
| `v6\probe_edges.py <python root> <out>` | 경계 사례 97개(`v6\b\edgesF.json`) |
| `v6\s142_complete.py <전> <후> <계약>` | §14.2 칸 완전성 |
| `v6\plant_trace_errors.sh <v6\b>` | V6b-05 의 오류 심기 |
| `v6\probe_lap_j63.py <src>` | 랩 J6.3 손계산 |
| `v6\probe_cmy.py <src>` | V6b-02 |
| `v6\probe_mu0.py <src>` | V6b-03 |
| `v6\probe_govcheck_rounding.py <src>` | V6-14 |
| `v6\b\boundary\*.js`, `*.py` | 경계층 · `envelope_source` · `engine_id` · 회귀(포크) |

캡처는 `contract_cases_1123.py capture` 로 다시 만든다(`v6\b\capF.json`, `v6\b\cap790F.json`).
소스 사본(`v6\b\srcF` · `v6\b\src790`)은 지웠다. 다시 만들려면 `git -C C:\Coding_Works\cufsmAi archive f08e10e | tar -x -C v6\b\srcF` 처럼 한다.
