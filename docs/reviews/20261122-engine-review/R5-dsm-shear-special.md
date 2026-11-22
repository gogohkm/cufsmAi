# R5 — DSM 입력 추출(dsm.py) · 전단/웹 크리플링(shear.py) · 특수 주제(special_topics.py) · 강종표(steel_grades.py)

## 요약

발견사항 수: **P0 1 · P1 7 · P2 9 · P3 5** (합계 22).

가장 무거운 것은 `dsm.py` 의 cFSM 분류 경로다(R5-01). 서명곡선에 극소가 하나뿐일 때 그 극소에 붙은 cFSM 라벨 하나로 "다른 모드는 없다"를 확정해 `local_detected=False`(또는 `dist_detected=False`) 와 `classification_method='cfsm_modal'` 을 돌려주고, 하류(`aisi_s100.py:455,771`)는 이것을 "부재 확인됨(absence verified)"으로 읽어 국부(또는 뒤틀림) 감소를 아예 적용하지 않는다. 템플릿 기본처럼 둥근 코너(r>0)가 있는 모델에서는 현재 cFSM 분류가 교과서적인 국부 극소를 D 94–99 % 로 표시하므로, UI 기본 흐름에서 9CS2.5x059·600S162-54 같은 흔한 립 C 압축재의 국부좌굴이 사라진다. 실측: 600S162-54 스터드(KxLx=120, KyLy=KtLt=60 in) Pn 11.47 kips → 올바른 9.08 kips 대비 **+26 % 비보수**, 9CS2.5x059(KL=144 in) **+32 %**. 직각 코너 모델에서는 라벨이 맞지만(L 96.8 %) 단일 극소이므로 이번에는 뒤틀림이 "부재 확인"이 되어 Pnd 를 건너뛴다(9CS2.5x059, KL=12 in +6 %). 두 극소가 있는 단면은 모두 같은 라벨(D)이 붙어 `cfsm_modal_ordering_tiebreak`(= 사실상 휴리스틱)로 우연히 맞는다. 매뉴얼 단면 수치(9CS2.5x059 휨 Mcrl/My 0.668·Mcrd/My 0.850, 매뉴얼 0.67·0.85; 362S162-54 압축 0.750·1.117, 매뉴얼 0.75·1.11)는 FSM·추출 모두 정확하다 — 문제는 값이 아니라 라벨 해석이다.

`shear.py` 의 G5 표 393 셀을 원문과 전수 대조했다. 계수 C·CR·CN·Ch·Ω·φ·φLSD 는 원문 행에 대해서는 **모두 일치**한다. 그러나 원문에 없는 행 10개가 들어 있고(그중 built-up I 의 fastened ETF/ITF 2행은 근거 없는 계수로 원문 최근접 행 대비 Pn +203 %/+39 %, R5-10), rowspan 으로 묶인 R/t 한계 5칸이 빠졌거나 틀렸으며, built-up I 의 N/h 한계가 1.0 이 아니라 2.0 이다. 단면명 정규화가 템플릿 이름 `lippedz` 를 C 표(G5-2)로 보내 Z 의 무체결 EOF φPn 을 +67 % 과대평가한다(R5-11). 특수 주제에서는 shear lag 파단이 Table J6-1(볼트 Ω 2.22/φ 0.65 등)이 아니라 D3 계수(2.00/0.75)를 쓰고(매뉴얼 Example IV-10 대비 +11 %), 볼트 앵글·채널 식(J6.2-6/-8)이 없어 일반식 1−x̄/L 로 떨어진다(Example IV-10 +53 %). 강종표는 A3.1.3(연신율 3 % 미만) 강종인 A653 SS80·A792 Gr80(그리고 SGC570)을 Fy=80–81 ksi 그대로 내준다(규정상 0.75Fsy ≤ 60 ksi, 다중 웨브 데크 한정; R5-30).

## 발견사항

### R5-01 [P0] [확인] cFSM 경로: 단일 극소 하나의 라벨로 다른 모드의 "부재"를 확정 → 하류가 국부(또는 뒤틀림) 감소를 생략
- 위치: `python/engine/dsm.py:184-223`(라벨링·플래그), `:263`(method 문자열); 소비처 `python/design/aisi_s100.py:452-456, 543, 596, 768-776`
- 현상:
  - cFSM 분류 배열이 주어지면(`mode_classifications`) 각 극소에 `_gdlo_label` 로 L/D/None 을 붙이고, L 로 붙은 극소만 Pcrl, D 로 붙은 극소만 Pcrd 로 쓴다. 극소가 하나뿐이면 한쪽 플래그는 반드시 `False` 가 되고 `classification='cfsm_modal'` 이 된다. 동률 해소 규칙(`:202-215`)은 "극소 2개 이상 + 모두 같은 라벨"일 때만 동작한다.
  - 하류는 `classification_method.startswith('cfsm_modal') and *_detected is False` 를 "부재 확인(absence verified)"으로 읽고 해석적 대체도 건너뛴다(`aisi_s100.py:455-456` → `:543` Pcrl 대체 생략, `:596` Pcrd 대체 생략; 휨은 `:771-775`). 결과적으로 Pnl=Pne 또는 Pnd=Py.
  - 서명곡선의 극소 하나는 "다른 모드가 분리되지 않았다(not isolated)"는 뜻이지 "없다"는 뜻이 아니다. App. 2 §2.2 해설과 E3/E4 해설은 분리되지 않은 모드를 cFSM 순수모드 해석이나 폐형식으로 따로 구하라고 한다.
  - 여기에 현재 cFSM 분류 결과가 겹친다(R3 영역): 둥근 코너(r>0) 모델에서 국부 극소가 D 로 분류된다. 9CS2.5x059 압축 극소(6.25 in) GDLO=[0.0, 94.4, 5.3, 0.2], 600S162-54 압축(4.71 in) [0.0, 98.8, 1.2, 0.1], 9CS2.5x059 휨 국부(4.71 in) [0.1, 97.2, 2.5, 0.3]. 같은 단면을 r=0 으로 만들면 [0.3, 2.4, 96.8, 0.5] 로 맞게 나온다. UI 기본 단면(`StcfsdPanel.ts:165-167`, r=0.157 in)과 `aisi_s100._auto_generate_props`(`:2382-2392`)가 모두 둥근 코너 모델에 이 분류를 넣는다.
- 근거: AISI S100-16 App. 2 §2.2(모드 식별), E3.2/E4·F3.2/F4 (Pcrl·Pcrd 는 각각 필요). 수치 재현:
  - `scratchpad/review/R5/s1_manual_sections.py`, `s3_scan.py`(로그 `s3_scan.log`), `s6_case_6x2.py`, `s9_sharp.py`, `s7_design_impact.py`
  - 9CS2.5x059, Fy=55, 압축, UI 50점 격자: 휴리스틱 `single_minimum` LFl=0.125 @6.25 in; cFSM 경로 `cfsm_modal` LFl=0, LFd=0.125, `local_detected=False`.
  - `design_member` 압축(KL=KxLx=KyLy=KtLt): KL=96 in Pn 12.91(cFSM 경로) vs 10.99(Pcrl=Pcrd=단일극소, 올바른 보수 처리) → **+17.5 %**; KL=144 in 8.58 vs 6.49 → **+32 %**.
  - 600S162-54, Fy=50, KxLx=120·KyLy=KtLt=60 in: Pn 11.47 vs 9.08 → **+26 %**; KxLx=96: 11.47 vs 10.95 (+5 %).
  - 직각 코너(r=0) 9CS2.5x059 압축: cFSM 경로는 L 만 검출 → `dist_detected=False` → Pnd=Py. KL=12 in Pn 19.36 vs 18.26(휴리스틱 + §2.3.1.3 대체) → +6 %.
- 빈도: 스캔 15 경우 중 압축 단일 극소 5개(9CS2.5x059, 600S162-54, 800S250-97, 600T125-54 track, hat) **전부** 국부가 사라짐(항목 4 표).
- 영향: UI 해석 탭(`StcfsdPanel.ts:404-431`), 설계 준비(`:1244-1257`), MCP `get_dsm_values`, `aisi_s100` 자동 DSM 이 모두 분류 배열을 넘기므로 보통의 사용에서 발생한다. 국부-전체 상호작용이 지배하는 중·장주(KL/r 이 큰 스터드·기둥)에서 비보수 +5 ~ +32 %(위 두 단면), 뒤틀림 지배 단면에서는 반대 방향(Pnd 생략)으로 비보수.
- 수정안:
  1. `dsm.py` 결과에 "분리 실패"와 "부재 확인"을 나누는 키를 추가한다: `local_isolated`, `dist_isolated`(극소로 직접 확인된 경우만 True) 와 `local_absence_verified`, `dist_absence_verified`(현재 구현으로는 항상 **False** — 부재를 확인하려면 순수모드 cFSM 해석으로 해당 모드의 최소 LF 가 충분히 큼을 보여야 한다).
  2. cFSM 경로에서 극소가 하나뿐이면(`len([m for m in minima if m.get('mode_class') in ('L','D')]) == 1`) 라벨과 무관하게 `classification='cfsm_modal_single_minimum'` 으로 두고, 다른 모드는 `*_detected=False, *_isolated=False` 로 돌려 하류가 해석적 대체(C/Z) 또는 "미평가" 판정으로 가게 한다. 보수적 대안: 단일 극소 값을 Pcrl 과 Pcrd 모두의 상한 후보로 반환(`single_minimum_both=True`).
  3. 하류(R4)는 `classification_method` 대신 1.의 `*_absence_verified` 만 보게 한다.
  4. 분류의 신뢰성 가드: 모델에 곡선 코너 요소(인접 요소 방향각 변화 < 90°의 연속)가 있으면 cFSM 라벨을 L/D 판정에 쓰지 말고 휴리스틱 + 경고로 간다(R3 이 기저를 고치기 전까지).
- 회귀 시험:
  - 9CS2.5x059(H 9, B 2.5, D 0.773, t 0.059, r 0.1875), Fy 55, 압축, 50점 격자 + `classify` 결과 → `extract_dsm_values(...)` 는 `local_absence_verified=False` 이고, `design_member`(KL=144) Pn ≤ 6.6 kips(현재 8.58).
  - 합성: 곡선 [(1,2.0),(5,1.0),(10,2.0)] + 분류 [[L],[D 98 %],[L]] (기존 `test_dsm_uses_modal_classification_before_wavelength_heuristic` 와 같은 입력) → `dist_detected=True` 는 유지하되 `local_absence_verified=False`.

### R5-02 [P1] [확인(논리)·의심(실단면 빈도)] cFSM 경로: G/O 우세로 분류된 뒤틀림 극소를 버리고, 결과를 "D 부재 확인"으로 돌려줌
- 위치: `python/engine/dsm.py:417-431`(`_gdlo_label`: max(D,L) < max(G,O) → None), `:184-196`
- 현상: 뒤틀림 극소의 GDLO 가 예컨대 [G 50, D 45, L 5] 이면 라벨 None → Pcrd 미채택. 국부 극소가 따로 있으면 `local_detected=True, dist_detected=False, classification='cfsm_modal'` → R5-01 과 같은 하류 경로로 Pnd=Py/Mnd=My.
- 근거: 합성곡선 `s4_synthetic.py` (h): L 극소 0.70@4.09, D 극소 0.60@29.5 (G50/D45 라벨) → `LFd=0, dist_detected=False, method=cfsm_modal`. 같은 곡선 휴리스틱은 LFd=0.60 을 잡는다. 긴 반파장의 휨 뒤틀림(횡비틀림과 결합)에서 G 참여가 큰 것은 흔하다(App. 2 해설 §2.3.3).
- 영향: 해당 조건에서 뒤틀림 한계상태 누락(비보수). 크기는 Mcrd/My 에 따라 수십 %. 이번 스캔 단면(둥근 코너)에서는 D 극소가 모두 D 90–100 % 라 실발생은 확인하지 못했다(아래 "확인하지 못한 것").
- 수정안: None 라벨 극소를 버리지 말고 "미분류 극소"로 보관해, L/D 가 하나도 없는 쪽 모드에 대해 휴리스틱 순서 규칙(국부보다 긴 반파장 중 최저)을 적용하거나 최소한 `*_isolated=False` 로 돌린다. G/O 우세 극소를 D 로 쓰는 것은 보수 측(Pcrd 를 낮게 잡음)이다.
- 회귀 시험: `s4_synthetic.py` (h) 입력 → `dist_detected=True` 이고 LFd≈0.60, 또는 `dist_absence_verified=False`.

### R5-03 [P2] [확인] 기준하중 P_ref 를 노드 응력과 무관하게 재계산 — 응력 정규화 계약을 검사하지 않음
- 위치: `python/engine/dsm.py:77-96`(항상 `yieldMP(..., unsymm=0)`), `:189,236,251,258`(Pcr = LF × P_ref)
- 현상: Pcr = LF × P_ref 가 맞으려면 FSM 에 넣은 응력이 정확히 "P_ref 를 받는 응력분포, 최대 |σ| = fy"여야 한다. `dsm.py` 는 `node[:,7]` 을 읽지 않아 이를 확인하지 않는다. UI 의 `_applyStressToModel`(`StcfsdPanel.ts:569-616`)은 최대 |σ| 를 fy 로 맞추므로 UI 경로는 맞지만, JSON-RPC `dsm`·`aisi_s100` 자동경로·사용자 `set_node_stress` 경로는 보장이 없다.
  - 예 1(합성, `s4_synthetic.py` (k)): 노드 응력 1 ksi, fy=50 → Pcrl 을 50 배(1439 kips vs 실제 28.8 kips) 과대 보고 → 이 값이 설계에 들어가면 국부 감소가 사라진다.
  - 예 2(R4 영역, 실경로): `aisi_s100._auto_generate_props:2353-2370` 은 Z(Ixz≠0)에 `unsymm=1` 로 Mxx=My_restrained 를 걸어 응력을 만든다. 8ZS2.25x059 에서 최대 |σ| = 109.4 ksi(fy 55 의 1.99 배)인데 `dsm.py` 는 P_ref=My_restrained=106.75 kip-in(`unsymm=0`)을 쓴다. Mcr 자체는 "그 분포에서의 x축 모멘트"로 맞지만, 같은 분포의 첫 항복 모멘트는 53.67 kip-in 이므로 λ=√(My/Mcr) 를 만들 때 서로 다른 응력상태의 값을 섞는다.
- 근거: S100-16 App. 2 §2.2: Pcr/Mcr 와 Py/My 는 같은 기준 응력분포에 대해 정의. 스크립트 `s4_synthetic.py`(k), 인라인 확인(8ZS2.25x059: Ixz=2.043, My_r 106.75, My_u 53.67, σmax 109.39).
- 영향: 계약 위반 시 Pcr 이 fy/σmax 배로 틀림 — 크기 제한 없음, 방향은 σmax<fy 이면 비보수. Z 자동경로는 R4 와 함께 볼 것.
- 수정안: `extract_dsm_values` 첫머리에서 `s = max|node[:,7]|` 를 구해 `P_ref_applied = P_ref × s / fy` 로 LF 를 환산하거나, `abs(s/fy − 1) > 1e-3` 이면 오류/경고를 낸다. 또한 노드 응력의 분포 형상이 `load_type` 의 순수 분포와 같은지(정규화한 차이 노름) 검사한다. `unsymm` 을 인수로 받아 `yieldMP` 에 전달한다.
- 회귀 시험: 9CS2.5x059 압축 곡선을 노드 응력 1 ksi 로 만들고 fy=55 로 추출 → 경고 또는 Pcrl 이 응력 55 ksi 경우와 같아야 함.

### R5-04 [P2] [확인] 휴리스틱 경로의 단일 극소 처리 — 항상 "국부"로 확정
- 위치: `python/engine/dsm.py:246-254`
- 현상: 극소 하나는 무조건 국부(Pcrl), 뒤틀림은 미분리(Pcrd=0, `dist_detected=False`)로 둔다. 하류는 C/Z 에만 §2.3.1.3/§2.3.3.3 폐형식을 대체로 쓰고, 그 밖의 단면(hat, track 이외 개단면 등)은 "미평가" 경고 + `pass=None`(`aisi_s100.py:630-636`)로 간다.
- 근거/결과: 9CS2.5x059 압축은 국부와 뒤틀림이 하나의 극소로 합쳐진다(순수모드 cFSM 최소 L 0.161, D 0.167, 비구속 0.125 @6.25 in). 휴리스틱 경로는 KL=24 in 에서 Pn 18.26 kips(Pnd 는 폐형식 대체)인데 단일 극소 값을 Pcrd 로도 쓰면 12.91 kips — 단일 극소가 실제로는 L-D 상호작용 모드인 경우 휴리스틱 경로는 짧은 부재에서 +41 % 높다. 폐형식 Pcrd 가 실제 뒤틀림을 맞게 주면 문제가 없으나, `dsm.py` 는 "극소가 하나였다"는 정보를 플래그로 남기지 않는다(`classification='single_minimum'` 문자열만 있음).
- 영향: 하류가 폐형식 Pcrd 를 쓰는 동안은 규정에 맞는 대체이므로 P2. 단일 극소가 "국부+뒤틀림 결합"인 경우의 비보수 가능성은 남는다.
- 수정안: 단일 극소일 때 `single_minimum=True` 와 그 LF 를 함께 반환해 하류가 min(폐형식 Pcrd, 단일극소×P_ref) 을 보수적 상한으로 쓸 수 있게 한다.
- 회귀 시험: 9CS2.5x059 압축(위 R5-01 입력, 분류 없음) → `single_minimum=True`, `LF_single=0.125±0.002`.

### R5-05 [P2] [확인] 표본점 최소만 사용(보간 없음), 격자 하한 1 in 경계 극소를 국부로 채택
- 위치: `python/engine/dsm.py:121-143`
- 현상: 극소는 3점 비교(엄격한 `<`)로 찾고, 극소값은 표본점의 값이다. 짧은 끝 첫 점이 둘째 점보다 작으면 경계 극소로 넣어 국부 후보가 된다 — 실제 국부 최소가 격자 하한(UI 기본 1 in, `StcfsdPanel.ts:187-190`) 아래에 있으면 1 in 의 LF 가 Pcrl 이 된다.
- 근거: UI 기본 50점(1–1000 in, 공비 1.151) 대 400점 비교(`s1_manual_sections.py`): 9CS2.5x059 휨 국부 +0.08 %, 뒤틀림 +0.01 %; 362S162-54 압축 국부 +0.17 %, 뒤틀림 +0.52 %; 9CS2.5x059 압축 단일극소 +0.8 %(0.125 vs 0.124). 즉 기본 격자 오차는 작고 항상 비보수 방향이다. 경계 극소 합성 예(`s4_synthetic.py` (e)): 실제 국부 최소 0.80 @0.6 in → 보고 1.255 @1.00 in (**+57 %**), 경고 없음. 362S162-54 휨은 국부 극소가 이미 1.76 in 으로 하한에 가깝다.
- 영향: 일반 단면에서는 <1 %(비보수). 소형·후판 단면(국부 반파장 ≈ 1 in)에서는 큰 비보수 가능.
- 수정안: (1) 극소 주변 3점으로 log L 에 대한 포물선 보간 값(하한)을 쓰거나 두 이웃의 최소값을 상한으로 비교 보고. (2) 경계 극소(index 0)가 채택되면 `boundary_minimum=True` 경고 + "격자 하한을 낮추어 재해석" 안내, 하류는 이 경우 Pcrl 을 신뢰하지 않게.
- 회귀 시험: `s4_synthetic.py` (e) 곡선 → `boundary_minimum=True` 경고.

### R5-06 [P2] [확인] 극소가 없을 때 두 경로의 결과가 서로 다르고, 휴리스틱은 장파장 전체좌굴 꼬리를 "국부"로 보고
- 위치: `python/engine/dsm.py:255-261`(monotone), `:184,219-225`(cFSM 경로 무극소)
- 현상: (a) 휴리스틱: 내부·경계 극소가 없으면 곡선 최솟값(대개 마지막 1000 in 점의 전체좌굴 값)을 Pcrl 로 두고 `local_detected=True`. 합성 단조감소 곡선에서 LFl=0.010 @1000 in(`s4` (a)). 설계에 들어가면 극단적으로 보수적이지만 "국부 검출"로 잘못 표시된다. (b) cFSM 경로: 같은 곡선에서 아무 값도 정하지 않고 `classification='auto'`, `classification_method='heuristic'`(cFSM 분류를 넘겼는데도)로 돌아온다(`s4` (a')).
- 영향: 판정은 대개 보수 측이나 플래그·라벨이 사실과 다르다.
- 수정안: 무극소 시 두 경로 모두 `local_detected=False, dist_detected=False, classification='no_minimum'` 으로 통일하고 하류 대체로 보낸다. 장파장 끝점은 국부 후보로 쓰지 않는다(이미 `:132-139` 가 같은 이유로 긴 끝을 배제한다).
- 회귀 시험: `s4` (a)/(a') 입력 → 두 경우 모두 `local_detected=False`, `classification='no_minimum'`.

### R5-07 [P3] [확인] `_empty_result` 키 누락·`load_type` 미검증·경계조건 정보 없음
- 위치: `python/engine/dsm.py:489-504`, `:88-96`, 함수 시그니처
- 현상: 점이 3개 미만일 때 반환 dict 에 `classification`, `global_source`, `cre_signature`, `Lcre_signature` 가 없다(`s4` (l) 에서 `KeyError`). `load_type` 이 'P'/'Mxx' 가 아니면 무엇이든(예: 'mxx', 'M11') Mzz 로 처리한다. 경계조건(BC)을 받지 않아 C-C/C-F 곡선도 서명곡선처럼 해석한다(`s8_bc.py`: 9CS2.5x059 휨 C-C 에서 LFl=0.970 @7.20, LFd=1.423 @39.07 — S-S 0.668/0.850 과 다름, 경고 없음).
- 수정안: `_empty_result` 에 같은 키 집합을 채움; `load_type not in ('P','Mxx','Mzz')` 이면 ValueError; `BC` 인수를 받아 'S-S' 가 아니면 `warning` 키로 "서명곡선이 아님 — DSM Pcrl/Pcrd 추출 대상 아님" 표기.
- 회귀 시험: 점 2개 곡선 → `'classification' in r`; `load_type='M11'` → ValueError.

### R5-10 [P1] [확인] Table G5-1(built-up I)에 원문에 없는 fastened 2-플랜지 행(ETF·ITF) — 근거 없는 계수
- 위치: `python/design/shear.py:81-82`
- 현상: `('fastened','stiffened','ETF') = C 15.0, CR 0.14, CN 0.28, Ch 0.003, Ω 2.00, φ 0.75, φLSD 0.60, R/t≤5`, `('fastened','stiffened','ITF') = C 50.0, 0.14, 0.08, 0.04, 2.00, 0.75, 0.65, 한계 없음`. S100-16 Table G5-1 의 Fastened 그룹은 one-flange End/Interior 두 행뿐이다. 같은 모듈은 unstiffened 2-플랜지에 대해서는 원문에 없다고 오류를 내면서(`:270-274`) 이 두 행은 조용히 계산한다.
- 근거: `aisi-cold-formed-steel` data/specification/Chapter_G_Shear.md L240-260 (Table G5-1). `s2_g5_tables.py`: h=8, t=0.06, R=0.18, N=3.5, Fy=50 → fastened ETF Pn 6.197 kips vs 원문 unfastened ETF 2.042 (+203 %); fastened ITF 5.91 vs unfastened ITF 4.255 (+39 %).
- 영향: built-up I 의 체결 지점 2-플랜지 하중(조인트 상부 집중하중이 지점 바로 위에 있는 경우 등)에서 큰 비보수.
- 수정안: 두 행을 삭제하고 unstiffened 2-플랜지와 같은 `error`(“Table G5-1 has no fastened two-flange rows”)를 반환. 사용자가 원하면 unfastened 행을 명시적 보수 대체로 쓰는 옵션(경고 포함)을 둔다.
- 회귀 시험: `web_crippling(8.0,0.06,0.18,3.5,50,support='ETF',fastened='fastened',section_family='built_up_i')` → `'error' in r`.

### R5-11 [P1] [확인] 단면명 정규화가 `lippedz`/`lipped_z`/`LIPPEDZ` 를 C 표(G5-2)로, `isect` 를 C 로 보냄
- 위치: `python/design/shear.py:177-188` (`raw.startswith('z')`, `raw in (... 'i' ...)`)
- 현상: 엔진 템플릿 이름(`engine/template.py` 'lippedz', 'isect')이 그대로 들어오면 Z → G5-2, isect → G5-2 가 된다. `aisi_s100._infer_web_crippling_family:142-150` 은 'isect' 를 built_up_i 로 보내지만 'lippedz' 는 역시 'C' 로 보낸다(두 구현이 서로도 다름). UI 는 `_normalizeSectionType`(`StcfsdPanel.ts:958-966`)으로 'Z' 로 바꾸고 MCP `get_web_crippling` 은 enum ['C','Z','HAT','I'] 이라 직접 경로는 막혀 있으나, JSON-RPC `web_crippling`·`aisi_design`(`section_type` 자유 문자열)·`design_purlin`(`section.type`)은 막혀 있지 않다.
- 근거: `s2_g5_tables.py`: h 8, t 0.06, R 0.18, N 3.5, Fy 50, unfastened EOF — 'Z' Pn 0.866/φPn 0.736 vs 'lippedz' Pn 1.541/φPn 1.233 → φPn **+67 %**. (G5-3 무체결 EOF: C 5, CR .09, CN .02, Ch .001 / G5-2: C 4, CR .14, CN .35, Ch .02.)
- 영향: Z 단면 무체결·체결 ETF/ITF 및 무체결 EOF 에서 비보수(최대 위 크기), 일부 행에서는 보수.
- 수정안: 정규화를 토큰 기반으로: 소문자·구분자 제거 후 `'z' in` 또는 `in ('z','lippedz','zee','zsection')` → z; `in ('i','isect','isection','builtupi', ...)` → built_up_i; 알 수 없는 문자열은 'c' 로 조용히 보내지 말고 오류. `aisi_s100._infer_web_crippling_family` 와 같은 함수를 쓰도록 하나로 합친다.
- 회귀 시험: `web_crippling(..., section_type='lippedz')['table'] == 'G5-3'`; `section_type='isect'` → 'G5-1'; `section_type='rhs'` → error.

### R5-12 [P2] [확인] G5 적용한계 칸 오류·누락 (rowspan 셀 전사 누락)
- 위치: `python/design/shear.py:77, 84, 145, 156, 158, 160, 162`
- 현상(원문 → 코드):
  - G5-1 unfastened stiffened IOF R/t ≤ **3** → 5.0
  - G5-1 N/h ≤ **1.0** → 2.0 (`limits`)
  - G5-4 fastened ITF R/t ≤ **10** → None(미검사)
  - G5-5 fastened IOF R/t ≤ **20**, fastened ITF ≤ **10**, unfastened IOF ≤ **20**, unfastened ITF ≤ **5** → 모두 None
  - G5-2 fastened ITF 추가조건 d ≥ 4.5 in 미검사
- 근거: Chapter_G_Shear.md 표 HTML 의 rowspan 행(한계 칸이 두 행에 걸침). `s2_g5_tables.py` 출력(“R/t=25 warnings: []”).
- 영향: 경고만 빠진다(계산은 범위 밖에서도 그대로 함 — R5-15). 범위 밖 사용을 알려주지 못함.
- 수정안: 위 칸을 원문대로 고치고, `_wc_row` 에 `d_min` 인수(C F-ITF 4.5 in)를 추가해 `d`(외측 깊이)를 받으면 검사.
- 회귀 시험: multi_web fastened IOF, R/t=25 → R/t 경고; built_up_i N/h=1.5 → N/h 경고.

### R5-13 [P2] [확인] 원문에 없는 조합의 조용한 대체: C/Z fastened-unstiffened, multi-web/hat n_webs 하한 2
- 위치: `python/design/shear.py:104-107, 127-130`(fastened unstiffened 8행), `:201-212`(`max(n, base)`)
- 현상: (1) Table G5-2/G5-3 의 unstiffened 행은 Unfastened 그룹에만 있다. 코드는 fastened-unstiffened 를 unfastened 값으로 채워 경고 없이 계산한다(`s2` "C fastened unstiffened EOF: 1.576 [] []"). 값 자체는 대개 보수 측이지만 원문 밖이다. (2) hat/multi-web 은 사용자가 `n_webs=1` 을 주어도 2 로 올린다. 데크 웨브 1개당 반력을 검토하려는 입력이면 ×2 비보수.
- 수정안: (1) fastened-unstiffened 는 unfastened 값을 쓰되 `assumptions` 에 "Table G5-2/3 has no fastened unstiffened rows; unfastened coefficients used" 를 남긴다. (2) `n_webs` 가 명시되면 그대로 쓰고, 기본값만 2.
- 회귀 시험: multi_web, n_webs=1 → `Pn == Pn_per_web`.

### R5-14 [P2] [확인] Table G5-1 결과를 웨브 수로 곱하지 않음 (보수 측 ×0.5)
- 위치: `python/design/shear.py:76, 260-262, 353-354, 411`
- 현상: built-up I 는 `per_web=False`, n_webs 를 1 로 강제하고 "곱하지 않는다"고 가정을 남긴다.
- 근거: Commentary G5(data/commentary/Commentary_G_Shear_Web_Crippling.md L173): "In Specification Table G5-1, the heading was changed in 2012 to indicate that the resulting nominal web crippling strength is per web." 표 제목도 "for Built-Up Sections per Web".
- 영향: 두 채널 맞댐 I 의 Pn 을 절반으로 계산(보수). 강도 판정이 과하게 불리.
- 수정안: `per_web=True`, 기본 n_webs=2, 결과에 `Pn_per_web` 과 `Pn` 을 함께.
- 회귀 시험: built_up_i unfastened ETF(기존 시험 입력) → `Pn ≈ 2 × Pn_per_web`.

### R5-15 [P2] [확인] 적용한계 밖에서도 Pn 을 그대로 계산 (경고만)
- 위치: `python/design/shear.py:313-334`, 소비처 `aisi_s100.py:1527-1546`
- 현상: h/t > 200, N/t·N/h·R/t 초과, θ≠90°(G5-1..4), N < 0.75 in 모두 경고만 붙이고 Pn·φPn 을 반환한다. `aisi_s100` 은 경고를 붙일 뿐 `pass` 를 그대로 둔다. §G5 는 h/t > 200 웨브에 "집중하중을 웨브로 직접 전달하는 수단"을 요구한다(계산식 적용 대상이 아님).
- 영향: 표 보정 범위 밖 값을 합격 판정에 씀. 크기 미정.
- 수정안: 결과에 `within_limits: bool` 을 추가하고 h/t>200 은 `error`(또는 `Pn=None`)로, 그 밖의 한계 초과는 `within_limits=False` → 하류 `pass=None`.
- 회귀 시험: h=14, t=0.06(h/t=233) → `within_limits=False` 또는 error.

### R5-16 [P3] [확인] Chapter G 미구현 조항 — G2.2, G2.3(b) kv, G3(구멍 전단), G4, G6(구멍 크리플링)
- 위치: `python/design/shear.py:8-22`(docstring 에 G2.2·G2.3(b) 미구현 명시)
- 현상: 보강재 있는 웨브는 kv 를 넘겨도 G2.1 곡선을 쓴다(보수: a/h=1, h/t=200 에서 4.48 vs G2.2 10.60 kips). G3 qs·G6 Rc 는 입력 자체가 없어 구멍 있는 웨브에 감소가 적용되지 않는다(사용자가 구멍을 모르고 지나칠 수 있음).
- 수정안: `web_holes` 인수가 들어오면 미구현 오류를 내는 가드, 설계 결과 `assumptions` 에 "webs without holes" 명시.

### R5-20 [P1] [확인] shear lag 파단(J6.2)에 D3 계수(φ 0.75/Ω 2.00) 사용 — Table J6-1 이 맞음
- 위치: `python/design/special_topics.py:101-114`; 이를 고정하는 기존 시험 `test/python/test_design_verification.py:458-482`("phi_Tn uses D3 factor")
- 현상: Ae = Usl·Ant 를 쓰는 파단은 접합부 인장파단(J6.2, Eq. J6.2-1)이고, J6 머리글은 Table J6-1 계수를 쓰라고 한다: 용접 Ω 2.50/φ 0.60, 볼트 2.22/0.65, 나사·PAF 3.00/0.50 (LSD 0.75). 코드는 체결재 종류 인수가 없고 D3(순단면, 접합부 밖)의 2.00/0.75 를 쓴다.
- 근거: Chapter_J_Connections.md L1286-1295(Table J6-1), L1327-1340; 매뉴얼 Example IV-10(볼트 앵글/평판) "Ω = 2.22 for bolted connections". `s5_shear_special.py`: Usl=0.534 주입 시 코드 3.809 kips vs 매뉴얼 3.43 (+11 %); 평판(Usl 0.910) 코드 8.804 vs 매뉴얼 7.93 (+11 %).
- 영향: 모든 shear lag 호출. ASD 볼트 +11 %, 용접 +25 %, 나사 +50 %; LRFD 볼트 +15 %, 용접 +25 %, 나사 +50 % 비보수.
- 수정안: `connection_type`('bolted'|'welded'|'screw'|'paf') 인수(기본값 없음 — 필수)를 받아 Table J6-1 φ/Ω 로 파단을 나누고, 순단면 파단 D3(2.00/0.75, An 그대로)은 별도 항목으로 함께 보고. 기존 시험의 기대값을 바꾼다.
- 회귀 시험: Example IV-10 평판: Ag 0.485, Ant 0.430, d 0.5, s 5.0, Fu 45, ASD, bolted → 파단 가용강도 7.93 kips.

### R5-21 [P1] [확인] Table J6.2-1 의 볼트 앵글(Eq. J6.2-6)·볼트 채널(Eq. J6.2-8) 미구현 → 일반식 1−x̄/L 로 대체(비보수)
- 위치: `python/design/special_topics.py:79-88`; MCP 설명 `src/mcp/server.ts:1260-1275`
- 현상: `connection_case` 가 'bolted_angle'/'bolted_channel' 이거나 MCP 설명이 권하는 하이픈 표기('flat-sheet', 'welded-channel')이면 일반식 U = 1 − x̄/L 로 계산한다(경고는 남김). 일반식은 J6.2-6/-8 보다 훨씬 크다.
- 근거: Example IV-10(3LU3x060 볼트 앵글, x̄ 0.785, L 3.0, b1=b2=3.0): 매뉴얼 Usl 0.534, Pnt/Ω 3.43 kips. 코드(`connection_case='bolted_angle'`) U 0.738, 가용 5.266 kips → **+53 %**(U +38 % × Ω +11 %). `'welded-channel'` 도 같은 일반식(0.738).
- 영향: 볼트 앵글·채널 인장재의 접합부 파단 과대평가.
- 수정안: J6.2-6(b1, b2 입력), J6.2-8(bf, bw 입력)을 구현; `connection_case` 를 소문자·하이픈/공백→밑줄로 정규화; 알 수 없는 경우는 일반식 대신 오류(또는 `Usl` 필수).
- 회귀 시험: Example IV-10 앵글: b1=b2=3.0, x̄ 0.785, L 3.0, Ant 0.317, Fu 45, ASD → Usl 0.534, 가용 3.43 kips.

### R5-22 [P2] [확인] A3.3.2 냉간가공: Fyc 를 Fuv 로 상한(원문에 없음), 기본 C=0.15 의 "보수" 주장, `n_corners` 미사용, 단독 호출 시 `applicable=True`
- 위치: `python/design/special_topics.py:275-276, 300-306, 207, 327`
- 현상:
  - `Fyc = min(Fyc, Fuv)` — 원문은 Fya ≤ Fuv 만 둔다(Eq. A3.3.2-1). 매뉴얼 Example I-16 은 Fyc = 52.30 ksi > Fuv 45 를 그대로 쓴다. 코드는 Fyc 45, Fya 36.15 ksi(매뉴얼 38.06, −5 %, 보수).
  - 면적 미제공 시 C=0.15 를 "보수적"이라 하지만 압축부재(전단면) 실제 C 는 0.09–0.10(550S162-68 0.097, 9CS2.5x059 0.091)이라 Fya +1.6–1.8 % 비보수. 휨(제어 플랜지) C 는 0.26 수준이라 이때는 보수.
  - `n_corners` 인수(docstring "압축부재 C 자동계산용", MCP 기본 4)는 어디에서도 쓰지 않는다.
  - MCP `cold_work` 단독 호출은 "Mnl=Mne, Mnd=My(좌굴 비지배)" 전제(§A3.3.2 본문)를 확인할 수 없는데도 `applicable: True` 를 돌려준다.
- 근거: Chapter_A_General_Provisions.md L497-527, Example_I-16(Fya 38.06, C 0.262, Bc 1.714, m 0.193). `s5_shear_special.py`.
- 수정안: Fyc 상한 제거(Fya 상한만); 면적 미제공 시 압축은 `n_corners` × 코너면적 / A(A 입력 필요)로, 휨은 오류 또는 보수 C(0.0 → 증가 없음)로; 결과 키 `applicable` 을 `formula_applicable` 로 바꾸고 `buckling_precondition: 'not checked'` 추가.
- 회귀 시험: Example I-16: Fyv 33, Fuv 45, R 0.107, t 0.0713, A_corners 0.0320, A_flange 0.122 → Fyc 52.30, Fya 38.06 ±0.05.

### R5-23 [P3] [확인] shear_lag·block_shear 의 LSD 처리
- 위치: `special_topics.py:105-110`, `:176-177`
- 현상: `design_method='LSD'` 는 shear_lag 에서 ASD 분기(Ω), block_shear 에서 LRFD φ 0.65 를 쓴다(LSD φ 0.75 — 둘 다 보수). 결과 라벨 `phi_Tn` 도 ASD 값을 담는다. `design_member` 는 LSD 를 거부하는데(`aisi_s100.py:267-276`) 이 두 함수는 받는다.
- 수정안: 'LSD' 를 명시적으로 거부하거나 Table J6-1 LSD 열을 구현.

### R5-24 [P3] [확인] flange_curling 인수 명칭·박스형 wf
- 위치: `special_topics.py:340-372`
- 현상: 식(Eq. L3-1 역산)과 Example I-18 재현은 맞다(cf 0.000195 vs 0.000194). docstring 은 `h` 를 "웹 높이"라 하지만 식은 보 깊이 d 다(MCP 설명은 "Section depth"). 박스/U형에서 "웨브 사이 거리의 절반"을 `bf` 로 넘기면 다시 t 를 빼 wf 가 t 만큼 작아진다(cf ∝ wf⁴, 소폭 비보수).
- 수정안: 인수명 `d`, 박스형 플래그 `wf_is_half_clear_distance` 로 t 차감 생략.

### R5-25 [P1] [확인] (R4 교차) 냉간가공 Fya 가 Chapter G(전단·웹 크리플링)에 들어감
- 위치: `python/design/aisi_s100.py:1077-1078, 1092, 1390, 1511` (shear.py 가 받는 Fy)
- 현상: 휨 설계에서 `use_cold_work=True` 이면 `Fy = state['Fy'] = Fya` 로 바뀐 뒤 같은 Fy 를 `shear_strength`·`web_crippling` 에 넘긴다. §A3.3.2 는 증가를 Chapters D, E, F(F2.4 제외), H1, I4, I6.2 로 한정한다 — G 는 포함되지 않는다.
- 근거: Chapter_A L499. 재현(`test_cold_work_uses_estimated_corner_ratio` 입력 + Vu 1, wc_N 3.5): Vy 13.50 → 14.44 kips, 웹 크리플링 Pn 1.59 → 1.70 kips(+6.9 %).
- 수정안: 휨 루틴에서 `Fy_virgin` 을 따로 보관해 G2/G5/H3 에 넘긴다.
- 회귀 시험: 위 입력에서 `use_cold_work` 유무와 관계없이 `shear.Vy`·`web_crippling.Pn` 동일.

### R5-30 [P1] [확인] 연신율 3 % 미만 강종(A653 SS80, A792 Gr80)과 SGC570 을 감소 없이 Fy 80–81 ksi 로 제공
- 위치: `python/design/steel_grades.py:17, 26, 31, 36`; UI 드롭다운 `src/webview/StcfsdPanel.ts:2813-2819`, `webview/js/app.js:3283-3289`
- 현상: §A3.1.3 은 A653 SS Grade 80 Class 1·2, A792 Grade 80 Class 1·2 를 "다중 웨브(데크·사이딩) 전용"으로 두고 Chapter C–J 강도에 Fy = min(0.75Fsy, 60 ksi), Chapter J 에 Fu = min(0.75Fu, 62 ksi) 를 쓰게 한다(휨은 Rb). 코드는 등급별 사용 제한·감소를 전혀 담지 않고, 엔진 어디에서도 A3.1.3 을 적용하지 않는다(grep 결과 없음). SGC570(Fy 560/Fu 570 MPa, Fu/Fy 1.02 < 1.08 → A3.1.1(a) 불만족)도 같은 등급이다(KDS 41 30 30 표 3.2-2 는 SGC560Y 강도 칸을 비워 둠 — 분류는 [의심]). `A1003-80` 은 A3.1 목록(ASTM A1003 ST 33H–50H)에 없다.
- 근거: Chapter_A_General_Provisions.md L423-461(A3.1.3), L398(A1003).
- 영향: 이 강종을 고르면 항복 지배 강도가 80/60 = 1.33 배(SGC570 81.22/60 = 1.35 배) 과대, C/Z 부재에 쓸 수 없는 강종을 쓸 수 있게 함.
- 수정안: 등급 데이터에 `elongation_group`('A3.1.1'|'A3.1.2'|'A3.1.3')과 `design_Fy`, `design_Fu`(감소 반영)를 두고, 설계 경로는 `design_Fy` 를 쓰며 A3.1.3 등급은 `member_type`/`section_family` 가 다중 웨브가 아니면 오류. `A1003-80` 삭제.
- 회귀 시험: `get_grade('A653-80')['design_Fy'] == 60.0`; A3.1.3 등급 + lippedc 휨 → 오류.

### R5-31 [P3] [의심] KS 강종 명칭과 값의 불일치(SGC400·SGC440·SSC400)
- 위치: `python/design/steel_grades.py:14-19`
- 현상: KDS 41 30 30 표 3.2-1/3.2-2 의 KS D 3506 현행 명칭은 SGC245Y(245/340 MPa), SGC295Y(295/400), SGC335Y(335/440), SGC365Y(365/490), SGC560Y 이다. 코드 `SGC400` = 245/400 은 Fy 는 245 계열, Fu 는 295 계열 값이다. 사용자가 실제로 SGC245Y 를 쓰면 Fu 가 +18 %(400 vs 340) 과대(접합부 지압·파단에 비보수), 구 SGC400(=295/400) 이면 Fy 가 보수. `SGC440` 295/440 도 같은 엇갈림(현행 335/440). `SSC400`(KS D 3530) 은 현행 SSC275(275/410) — 보수.
- 근거: kds-structural-design skill, data/standards/KDS_41_30_30.md L980-1006 및 verified-qa #344(표 3.2-2 값). 구 KS(SGC340/400/440…) 값은 이번 자료에 없어 [의심].
- 수정안: 현행 명칭으로 바꾸고(구 명칭은 별칭), Fy·Fu 를 같은 행에서 가져온다. 프로젝트 기본(245/400)을 유지하려면 출처를 주석으로 남긴다.

### 다른 리뷰어 영역에 걸친 것 (본문 발견사항에 포함)
- **R3**: 둥근 코너(r>0) 모델에서 cFSM 분류가 국부 극소를 D 94–99 % 로 표시(직각 코너 모델은 L 96.8 %). 순수모드 해석도 이상: 9CS2.5x059 휨 순수 L 최소 0.954 @4.09 > 비구속 0.668, 순수 D 최소 0.837 @4.71(국부 반파장) — D 공간에 국부 변형이 섞인 것으로 보인다. 기본 GBTcon(ospace 1, orth 1, couple 1, norm 0). R5-01 의 근본 원인 중 하나.
- **R4**: (1) `aisi_s100.py:455-456, 771-776` 의 "absence verified" 판정(R5-01·R5-02). (2) `_auto_generate_props:2353-2370` 의 Z 휨 응력 `unsymm=1` 과 P_ref(`unsymm=0`) 혼용(R5-03). (3) Fya 의 G 장 유입(R5-25). (4) `_infer_web_crippling_family` 의 'lippedz' → C(R5-11). (5) `aisi_s100` 냉간가공 게이트는 virgin Fy 에서 국부/뒤틀림 비지배를 확인하는데, 매뉴얼 Example I-16 은 Fya 응력에서 다시 확인한다(§A3.3.2 원문은 "at stress level Fy").
- **R6**: shear lag·block shear 계수(R5-20·R5-21·R5-23)는 접합부 설계(`connections.py`, `lap_connection.py`)와 같은 Table J6-1 을 써야 한다.
- **R8**: MCP `check_shear_lag` 설명이 하이픈 표기(`flat-sheet`, `welded-channel`)를 권장하지만 엔진은 밑줄만 인식(R5-21). MCP `cold_work` 의 `n_corners` 는 효과 없음(R5-22). JSON-RPC `dsm` 은 노드 응력 정규화를 검사하지 않음(R5-03).

## 맞다고 확인한 것

**dsm.py — 추출 알고리즘(항목 1 정리)**
1. 기준값: `grosprop` → `yieldMP(unsymm=0)` 로 Py = fy·A, Mxx_y = fy / max|σ(Mxx=1)|, Mzz_y 같은 방식(최대 |σ| 는 인장·압축 어느 쪽이든 첫 항복 — 비대칭 단면·부모멘트에서도 첫 항복 정의로 맞음). `load_type` 으로 P_ref 선택.
2. 곡선 정리: 각 길이의 1차 모드 LF(`row[1]`)만 사용, LF ≤ 0 인 점(해석 실패 길이)은 제외, 원래 curve index 보존, 길이순 정렬. 3점 미만이면 `_empty_result`.
3. 극소: 내부 점 i 에서 `lf[i] < lf[i-1] and lf[i] < lf[i+1]`(엄격). 짧은 끝 `lf[0] < lf[1]` 이면 index 0 을 경계 극소로 맨 앞에 삽입. 긴 끝은 전체좌굴 꼬리로 보고 넣지 않음.
4. Pcre = 마지막 점 LF × P_ref(서명곡선 점근값, `global_is_signature_asymptote=True`); KxLx/KyLy/KtLt 또는 Lb 가 오면 `compute_column_Fcre`/`compute_beam_Fcre` 폐형식으로 대체(실패 시 점근값 + `global_source` 문자열).
5. 분류 경로(분류 배열 또는 shape+classify_fn 이 있고 극소 ≥ 1): 극소마다 1차 모드 GDLO → `_gdlo_label`(max(D,L) ≥ max(G,O) 일 때만 L/D, L≥D 이면 L). L 중 최저 → Pcrl, D 중 최저 → Pcrd. 분류 배열 경로에서 L/D 극소가 2개 이상인데 모두 같은 라벨이면 "가장 짧은 = L, 나머지 중 최저 = D"(`cfsm_modal_ordering_tiebreak`). 하나도 L/D 가 없으면 분류 배열 경로는 `cfsm_modal_no_ld`(값 0), callable 경로는 휴리스틱으로 폴백.
6. 휴리스틱 경로: 극소 ≥ 2 → 가장 짧은 = 국부, 그보다 긴 극소 중 최저 = 뒤틀림(`two_minima`); 1개 → 국부, 뒤틀림 미분리(`single_minimum`); 0개 → 곡선 최솟값을 국부(`monotone`).
7. 반환: Pcrl = LF·P_ref, `LF_local`, `Lcrl`, 같은 식의 D/G, `minima`, `classification`, `local_detected`/`dist_detected`, `classification_method`('cfsm_modal' 접두면 cfsm, 그 외 'heuristic').

**dsm.py — 수치(항목 2)**: 9CS2.5x059 A 0.8808(매뉴얼 0.881), Ixx 10.29(10.3), My 126.6 kip-in(126). Mcrl/My 0.668 @4.71(매뉴얼 0.67), Mcrd/My 0.850 @25.6(0.85). 손계산: 웨브 k=23.9 Fcr 27.7 ksi(0.505 My)와 압축 플랜지 k=4 62.3 ksi(1.13) 사이의 0.668 — 판 상호작용으로 타당. 362S162-54 압축 A 0.4217(0.422), Pcrl/Py 0.750 @2.68(0.75 @2.8), Pcrd/Py 1.117 @14.56(1.11 @13.5; 400점 격자 1.111 @13.66). 9CS2.5x059 압축 단일 극소 0.125(웨브 단독 k=4 손계산 0.084 — 플랜지 구속으로 높아짐, 타당). 8ZS2.25x059 구속 휨 LFl 0.847, LFd 0.767. 단위: LF 는 무차원, P_ref 는 kips/kip-in → Pcr 단위 일관.

**스트레스 시험 결과(항목 3)** — `s4_synthetic.py`, `s1`, `s8`:

| 경우 | 휴리스틱 반환 | cFSM 경로 반환 | 하류 결과의 안전성 |
|---|---|---|---|
| 내부 극소 없음(단조감소) | `monotone`, LFl = 1000 in 꼬리값 0.010, local=True | `auto`, 값 없음, method 'heuristic' | 휴리스틱 과보수(국부 오표시); cFSM 은 해석 대체로 — R5-06 |
| 극소 1개(실제 D) | `single_minimum` → 국부, dist=False | D 라벨이면 local=False → **국부 생략** | 휴리스틱: C/Z 폐형식 Pcrd 대체(규정 대체); cFSM: **비보수** — R5-01 |
| 극소 1개(L-D 결합, 9CS 압축) | 국부 0.125 | D 라벨(둥근 코너) | cFSM +17–32 % 비보수, 휴리스틱 짧은 부재 +41 % 가능 — R5-01/R5-04 |
| 매우 가까운 두 극소(4.0/5.0 in) | 표본상 1개로 합쳐짐 → `single_minimum` | — | 국부 값으로는 맞음, D 미분리 → 대체 |
| 세 번째(장파장) 극소 | 국부 다음 최저 = D. 세 번째가 더 낮으면 그것을 D 로(보수) | G 라벨 → 무시(맞음) | 보수 |
| 첫 길이 최소(실제 0.6 in) | 경계점 1.0 in 값 채택(+57 %) | 같음(tiebreak 시 국부) | **비보수**, 경고 없음 — R5-05 |
| 마지막 길이 최소 | 배제(맞음) | 배제 | 문제 없음 |
| 모드 교차(kink) | 두 극소로 잡힘 | — | 표본 의존 |
| D 극소가 G 우세 | 휴리스틱은 잡음 | **버림 → D 부재 확인** | **비보수** — R5-02 |
| 기본 격자 오차(50점 vs 400점) | 국부 +0.08–0.17 %, D +0.01–0.52 % | 같음 | 미소 비보수 — R5-05 |
| 비기본 BC(C-C, C-F, m=[1]) | 극소 2개를 그대로 추출, 경고 없음 | — | 서명곡선이 아님 — R5-07 |
| 노드 응력 ≠ fy | Pcr 이 fy/σmax 배 | 같음 | 크기 무제한 — R5-03 |

**휴리스틱 vs cFSM 일치(항목 4)** — `s3_scan.py`(UI 기본 50점, 기본 GBTcon, 둥근 코너 템플릿, 15 경우; 로그 `s3_scan.log`):

| 단면 | 하중 | 극소(L, LF, cFSM %D) | 휴리스틱 | cFSM 경로 | 일치 |
|---|---|---|---|---|---|
| 9CS2.5x059 | P | 6.25, 0.125, D 94.4 | L 0.125 | **D 0.125, L 없음** | ✗ |
| 9CS2.5x059 | Mxx | 4.71/0.668 D97.2; 25.6/0.850 D100 | L .668 D .850 | tiebreak 같음 | ○ |
| 362S162-54 | P | 2.68/0.750 D97.2; 14.56/1.117 D100 | L .750 D 1.117 | tiebreak | ○ |
| 362S162-54 | Mxx | 1.76/3.150 D98.5; 12.65/2.021 | 같음 | tiebreak | ○ |
| 600S162-54 | P | 4.71, 0.281, D 98.8 | L 0.281 | **D, L 없음** | ✗ |
| 600S162-54 | Mxx | 3.09/1.513; 12.65/1.431 | 같음 | tiebreak | ○ |
| 800S250-97 | P | 6.25, 0.504, D 98.5 | L 0.504 | **D, L 없음** | ✗ |
| 800S250-97 | Mxx | 4.71/2.643; 16.77/1.705 | 같음 | tiebreak | ○ |
| 6x2x0.5x0.06 | Mxx | 3.56/1.627; 14.56/1.224 | 같음 | tiebreak | ○ |
| C200x75x20x2.0 | P | 6.25/0.431; 25.6/0.806 | 같음 | tiebreak | ○ |
| C200x75x20x2.0 | Mxx | 4.09/2.141; 25.6/1.676 | 같음 | tiebreak | ○ |
| 8ZS2.25x059 | P | 6.25/0.158; 22.23/0.284 | 같음 | tiebreak | ○ |
| 8ZS2.25x059 | Mxx | 4.09/0.847; 22.23/0.767 | 같음 | tiebreak | ○ |
| 600T125-54 track | P | 6.25, 0.221, D 98.9 | L 0.221 | **D, L 없음** | ✗ |
| hat 3x4x1x0.06 | P | 3.56, 0.577, D 98.9 | L 0.577 | **D, L 없음** | ✗ |

일치율 10/15. 일치한 10개는 모두 "두 극소가 다 D 로 분류 → 파장 순서 tiebreak" 이므로 cFSM 분류가 결과에 기여한 경우는 **0/15** 다. 불일치 5개(모두 압축 단일 극소)는 전부 국부가 사라지는 방향이며, 최악은 9CS2.5x059 압축(Pcrl 0 vs 0.125·Py; 설계 Pn +32 %, R5-01). 이번 스캔에서 G/O 우세로 버려진 D 극소(R5-02)는 없었다.

**shear.py — 조항별 판정(항목 5·7)**

| 조항/식 | 코드 줄 | 판정 |
|---|---|---|
| G2 Ωv 1.60 / φv 0.95 / φv(LSD) 0.80 | shear.py 에는 없음, 소비처 `aisi_s100.py:31,39,1392-1394` | LRFD·ASD 맞음, LSD 는 `design_member` 가 거부(맞음) |
| Eq. G2.1-1/-2a/-3a 분기 0.815, 1.227 | 34-42 | 맞음, 경계 연속(6.0637 = 6.0637) |
| Eq. G2.1-2b/-3b 동치 | — | 0.60t²√(EkvFy)=6.0621 vs 6.0637(0.60 반올림), 0.904Ekvt³/h 2.5633 vs 2.5628 |
| Eq. G2.1-4 λv, G2.1-5 Vy=0.6AwFy, G2.1-6 Aw=ht | 29, 32 | 맞음(h 는 호출자가 평판 웨브 깊이로) |
| Eq. G2.3-1/-2 Vcr, μ 0.3 | 30 | 맞음; Example II-1A 9CS2.5x059 Vcr 3.437(매뉴얼 3.44), 9CS2.5x070 5.755(5.76) |
| G2.3(a) kv 5.34 | 9 | 맞음 |
| G2.3(b) kv(보강재), G2.2 | — | 미구현, G2.1 곡선 사용 = 보수 (R5-16) |
| G3 qs, G4, G6 Rc | — | 미구현 (R5-16) |
| Eq. G5-1 | 396-410 | 맞음: C·t²·Fy·sinθ·(1−CR√(R/t))(1+CN√(N/t))(1−Ch√(h/t)), t 와 R·N·h 같은 단위(in) → kips; 음수 항 0 으로 절단 |
| Eq. G5-2/G5-3 α, 0.5 ≤ Lo/h ≤ 1.5, h/t ≤ 154, Pnc ≤ IOF | 428-473 | 맞음(IOF 상한은 같은 체결·플랜지 조건 행) |
| 웨브 수 곱(hat, multi-web, C/Z) | 411 | hat/multi-web 맞음(단 n_webs 하한 2 — R5-13), C/Z 는 1 강제(보수), built-up I 미곱(R5-14) |
| N ≥ 0.75 in | 330-334 | 경고(클램프 안 함 — 맞는 판단) |
| ITF 끝거리 2.5h/1.5h | 335-348 | 경고로 검사(맞음) |
| multi-web 체결 간격 > 18 in → unfastened | 250-253 | 맞음 |
| θ: G5-5 45–90°, 그 외 90° | limits | 맞음(경고) |

**G5 전수 셀 대조(항목 6)** — 원문 46행 × 8칸 + 표별 한계 5칸 = 393 셀. 원문 행에 대한 C·CR·CN·Ch·Ω·φ·φLSD 는 **전부 일치**. 불일치는 R/t 한계 5칸, N/h 한계 1칸(R5-12), 원문에 없는 행 10개(built-up fastened ETF·ITF 2개 — R5-10; C·Z fastened-unstiffened 8개 — R5-13)뿐이다. hat unfastened 2-플랜지, built-up unstiffened 2-플랜지는 원문대로 미지원 → error(맞음).

**special_topics.py**: J6.2 Table J6.2-1 의 (1) Eq. J6.2-4, (2)·(3a)·(3b) U=1.0, (3c) 용접 앵글 J6.2-5 와 0.4 ≤ U ≤ 0.9, (3d) 용접 채널 J6.2-7 과 0.5 ≤ U ≤ 0.9 식은 맞다. 매뉴얼 평판 U 0.910 재현. D2 φ 0.90/Ω 1.67 맞음. J6.3 Eq. J6.3-1/-2, Ubs, Table J6-1 볼트/용접 φ·Ω 짝 맞음. A3.3.2 Eq. A3.3.2-1~-4(Bc, m), 적용조건 Fuv/Fyv ≥ 1.2, R/t ≤ 7, 각 ≤ 120°, Fya ≤ Fuv, 코너 면적 = (θ)(R+t/2)·t, Fyf = Fyv 맞음(Example I-16 Bc 1.7189/m 0.1938 vs 1.714/0.193). L3 Eq. L3-1 역산식과 Example I-18(0.000195 vs 0.000194), 허용치 미지정 시 판정 없음(해설의 5 % d 를 참고값) 맞음.

**steel_grades.py**: E 29500 ksi, G 11300 ksi, ν 0.3(§A3.1 상수) 맞음. SGC400 35.53/58.02 ksi = 245/400 MPa(프로젝트 기본값과 일치). A653 33/45, 37/52, 40/55, 50/65(Class 1), 55/70, A792 33/45, 37/52, 50/65, A1003 33/45, 40/55, 50/65 는 skill references/steel-grades-guide.md 와 일치.

## 확인하지 못한 것

- R5-02(G 우세 D 극소)의 실단면 발생: 15 경우 스캔(둥근 코너, S-S, 스프링 없음)에서는 나오지 않았다. 스프링(데크 구속)·장파장 휨 뒤틀림·비구속 Z 에서는 보지 않았다.
- 9CS2.5x059 압축처럼 극소가 하나뿐인 단면의 "참" Pcrd 는 정하지 못했다(순수 D 해석이 5.4 in 에서 최소를 내는 등 R3 기저가 의심스러움).
- 순수모드 cFSM 값(R3 영역의 기저가 의심스러워) 을 "참값"으로 쓰지 않았다. R5-01 의 영향 크기는 "단일 극소 값을 국부·뒤틀림 모두에 쓰는 보수 처리" 대비로 냈다.
- 구 KS D 3506(SGC340/400/440…) 의 Fy·Fu 는 이번 1차 자료에 없어 R5-31 은 [의심].
- Commentary 를 제외하면 built-up I 의 "per web" 를 다루는 매뉴얼 예제를 찾지 못했다(R5-14 는 해설·표 제목 근거).
- G5 표 원문은 skill 의 전사본(HTML 표)을 1차 자료로 썼다. PDF 원본과의 대조는 하지 않았다.

### 회귀 시험이 없는 동작 (`test/python/`)
- G5 표 전 셀(원문 대조 표 시험), built-up fastened ETF/ITF 가 오류여야 함, rowspan R/t 한계, built-up N/h 1.0, `section_type='lippedz'`/`'isect'` 정규화, multi-web `n_webs=1`.
- cFSM 경로: 단일 극소(D 라벨/L 라벨)에서의 "부재 확인" 의미, G 우세 D 극소, 둥근 코너 모델 분류, 무극소, 경계 극소, 노드 응력 정규화 계약, 비 S-S 경계조건.
- 매뉴얼 실단면 DSM 값(9CS2.5x059 휨 0.67/0.85, 362S162-54 압축 0.75/1.11)을 FSM 부터 끝까지 돌리는 시험(기존 `test_dsm_flexure_example_ii1b` 는 Mcrl/Mcrd 를 손으로 넣는다).
- shear lag Example IV-10(Ω 2.22, J6.2-6), 볼트 채널 J6.2-8; 기존 `test_shear_lag_design_strength_split` 은 틀린 D3 계수를 기대값으로 고정.
- 냉간가공 Example I-16(Fya 38.06), 압축부재 C, Fya 의 G 장 유입 금지.
- 강종 A3.1.3 감소·사용 제한.
- G2: Example II-1A 9CS2.5x059 Vn 3.44 는 시험 없음(기존 `test_shear_strength` 는 Vy 와 Vn>0 만 확인).

## 읽은 파일

| 파일 | 줄 수 | 범위 |
|---|---|---|
| `python/engine/dsm.py` | 504 | 전체 |
| `python/design/shear.py` | 570 | 전체 |
| `python/design/special_topics.py` | 397 | 전체 |
| `python/design/steel_grades.py` | 47 | 전체 |
| `python/engine/stress.py` | 148 | 전체(yieldMP/stresgen — P_ref 확인용) |
| `python/server.py` | 1–360 | dsm·web_crippling·special topics 분기 |
| `python/design/aisi_s100.py` | 43–60, 131–183, 215–260, 267–300, 440–640, 760–790, 870–920, 1030–1110, 1370–1550, 2300–2419 | 소비 경로 |
| `python/cfsm/classify.py` | 16–95 | 반환 형상 |
| `python/engine/fsm_solver.py` | 150–200 | cFSM 구속 경로 |
| `python/engine/template.py` | 58–117, 293–400 | 템플릿 규약 |
| `python/models/data.py` | 28–60, 143–170 | GBTConfig, curve 계약 |
| `src/webview/StcfsdPanel.ts` | 160–200, 392–453, 540–760, 900–966, 1060–1080, 1190–1270, 1324–1340, 1644–1647, 1870–1895, 2110–2130, 2805–2825 | DSM·응력·강종 배선 |
| `src/mcp/server.ts` | 1010–1045, 1240–1340 | 도구 스키마 |
| `webview/js/app.js` | 3278–3292, 3595–3640 | 강종·웹 크리플링 입력 |
| `test/python/test_design_verification.py`, `test_regression_0926.py` | 해당 시험 함수 | 기존 시험 |
| skill `data/specification/Chapter_G_Shear.md` | 418 | 전체 |
| skill `Chapter_A` L355–534, `Chapter_D` L1–50, `Chapter_J` L1280–1409, `Chapter_L` L25–45, `Commentary_G` L80–175, `Commentary_L` L20–26 | | |
| skill 예제 II-1A, II-1B, III-3, I-16, I-18, IV-10, II-12 | | |
| kds skill `KDS_41_30_30.md` L975–1006, verified-qa #344 | | |

확인 스크립트: `C:\Users\USER\AppData\Local\Temp\claude\3df7e1c8eb560f18\99d094e4-961f-4f09-9be9-02ec03b2e201\scratchpad\review\R5\` — `common.py`, `s1_manual_sections.py`, `s2_g5_tables.py`, `s3_scan.py`(+`s3_scan.log`), `s4_synthetic.py`, `s5_shear_special.py`, `s6_case_6x2.py`, `s7_design_impact.py`, `s8_bc.py`, `s9_sharp.py`.
