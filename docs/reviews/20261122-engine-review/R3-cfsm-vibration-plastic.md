# R3 — 구속 FSM(cFSM) · 힘 기반 cFSM(fcFSM) · 자유진동 · 소성곡면

## 요약

발견사항 수: **P0 1 · P1 3 · P2 9 · P3 4** (계 17)

`python/cfsm/` 이식부는 MATLAB 원본과 줄 단위로 대조했고, 기저벡터 공간의 차원·계수(rank)·GBT 역학 조건(횡방향 막변형 0, 면내 전단 0, L 모드의 v=0·u=0), 주축 회전(`rot.T`)은 수치로 맞다고 확인했다. 예리한 모서리의 립 C·Z 에서는 분류 참여율 합이 100 %, 국부 극소 ≈97 % L, 뒤틀림 극소 ≈93 % D, 긴 길이 100 % G 로 정상이다. **`rot.T` 는 옳다**: Z 단면에서 자연기저 G2·G3 가 주축 방향으로 정확히 놓이고(K 결합 3×10⁻⁶), 전치를 빼면 결합 0.76 으로 틀린다.

문제는 이식 정확도보다 **적용 범위**에 있다. 고전 cFSM 은 예리한 모서리를 전제하는데, 이 프로그램의 템플릿은 보통 둥근 모서리(r>0)로 단면을 만들고, AISI 자동 DSM 경로(`design/aisi_s100.py:_auto_generate_props`)가 그 단면에 cFSM 분류를 그대로 쓴다. 둥근 모서리 립 C 의 국부 극소가 96 % D 로 분류되고, 그 결과 `Pcrl=0` · `local_absence_verified=True` 가 되어 **국부좌굴 감소를 건너뛰고** 국부 임계하중을 `Pcrd` 로 쓴다(R3-01, P0). 그밖에 진동 해석의 종방향 질량에 적분 `I4` 를 `I5` 대신 쓴 이식 오류(R3-02), GUI/MCP 의 무단위 밀도 기본값 1.0(R3-03), 원주 ±π 근처에서 부절점 판정이 틀어지는 문제(R3-04)가 있다. `fcfsm/` 은 MATLAB fcFSM 의 이식이 아니라 이름만 같은 다른 계산이다(R3-05).

## 발견사항

### R3-01 [P0] [확인] 둥근 모서리 단면에서 국부 모드가 D 로 분류 → 자동 DSM 이 국부좌굴을 "없음"으로 확정
- 위치: `python/cfsm/node_utils.py:51-85`(굽은 모서리의 호 절점을 모두 모서리 주절점으로 분류) · `python/cfsm/classify.py:16-91` · 호출부 `python/design/aisi_s100.py:2336-2392`(둥근 모서리 단면에 `classify` 적용) · 소비부 `python/engine/dsm.py:173-186, 420-431` · `python/design/aisi_s100.py:455, 543`
- 현상: 둥근 모서리(호를 4 요소로 나눔)에서는 호의 모든 절점이 "모서리 주절점"이 되어 nmno 6→22, nD 2→18 이 된다. 그러면 국부 판 좌굴의 모서리 근처 변형이 D 기저로 표현되어 국부 극소가 D 우세로 분류된다. 극소가 하나뿐인 곡선에서 dsm 은 이를 D 로 라벨링하고(`Pcrl=0`, `Pcrd`=국부값, `P_local_detected=False`, `classification_method='cfsm_modal'`), `aisi_s100.py:455` 는 이것을 "국부좌굴 부재가 cFSM 으로 확인됨"으로 받아들여 App.1 판좌굴 대체식도 쓰지 않는다. 결국 `Pnl = Pne`.
- 근거: 
  - 분류(스크립트 `…\scratchpad\review\R3\check3_classify.py`): 립 C 9×5×1×0.1, 압축, L=7.02(국부 극소) — 예리한 모서리 [G,D,L,O]=[0.3,1.4,97.5,0.9] %, r=0.1875 → [0.0,**96.5**,3.2,0.2] %(기본 orth=1), CUFSM 기본 orth=2/norm=1 에서도 [0.5,59.6,39.6,0.4]. 같은 길이의 순수 L 구속해 27.59 vs FSM 18.27(+51 %) — 둥근 모서리에서는 cFSM 의 L 공간 정의가 깨진다.
  - dsm 계약(`check9_dsm_contract.py`): AISI 예제 단면 8×2.5×0.625×0.059, r=0.157 — 극소 1 개(L=5.79), 분류 [0,95.9,3.9,0.1] → `Pcrl=0, Pcrd=6.889`; 같은 곡선을 분류 없이 넣으면 `Pcrl=6.889, Pcrd=0`; r=0 이면 분류 [0.2,2.3,96.9,0.6] → `Pcrl=6.923`. 무립 트랙 6×2×0.06, r=0.1 도 같은 현상(99.4 % D).
  - 설계(`check10_e2e.py`, `check10b_e2e.py`): 같은 단면, Fy=50, KL=24 in — 자동 경로 `Pcrl=0 → Pnl=Pne=38.12`, `Pnd=12.76`(국부 Pcr 을 D 식에 넣은 값), `Pn=12.76`. 이 길이에서는 D 식이 더 낮아 우연히 보수측이다. KL 이 길어 Pne<Py 가 되면 국부-전체 상호작용(Pnl 이 Pne 를 기준으로 함)을 잃어 비안전측이 된다. 손계산 예: Pne=0.4Py, Pcr=0.2Py 이면 올바른 Pnl=0.269Py, 오분류 시 min(Pne=0.4Py, Pnd=0.349Py)=0.349Py → 30 % 과대. 수치 재현: KL=100 in 에서 자동 Pn=12.76 kips, 라벨만 L 로 고친 Pn ≤ 9.99 kips → **≥28 % 비안전측**(아래 "KL 별 결과" 표).
- 영향: 템플릿에 r>0 을 주는 보통의 사용(AISI 자동 DSM, `server.py` 의 `classify`→`dsm` 경로)에서 압축 Pn(및 같은 구조인 휨 Mn)이 틀린다. 짧은 부재에서는 보수측, 전체좌굴이 끼는 길이에서는 비안전측이다.
- 수정안: (1) 근본: 둥근 모서리 단면에는 고전 cFSM 분류를 쓰지 않는다. 분류 전에 `node_utils.meta_elems` 결과로 "모서리 주절점 수 > 날카로운 모서리 수"(호 감지 = 인접 요소 각 변화가 작고 연속)를 검사해 `classification_method='cfsm_unsupported_rounded'` 를 돌려주고 dsm 이 휴리스틱으로 돌아가게 한다. 또는 분류용으로만 호를 날카로운 모서리로 바꾼 단면(같은 중심선 교점)을 만들어 그 기저로 분류한다(CUFSM 관행). (2) 계약: `aisi_s100.py:455` 의 `local_absence_verified` 는 cFSM 이 "L 극소 없음"을 확인했다는 뜻으로 쓰이므로, 분류가 지원되지 않는 단면에서는 False 가 되어야 한다. (3) fcFSM 을 제대로 이식하면(R3-05) 둥근 모서리용으로 쓸 수 있다.
- 회귀 시험: `lippedc H=8,B=2.5,D=0.625,t=0.059,r=0.157`, Fy=50, 압축, `_auto_generate_props` → `dsm['Pcrl'] > 0`, `dsm['P_local_detected'] is True`(현재 0 / False). 같은 단면 r=0 과 Pcrl 차이 < 2 %(현재 6.889 vs 6.923 이므로 라벨만 맞으면 통과).

### R3-02 [P1] [확인] 진동 질량행렬의 종방향(v) 성분에 `I4` 를 씀 — MATLAB 은 `I5`
- 위치: `python/vibration/solver.py:55-59`
- 현상: `mm[1,1] = ρ t b I4 a²/(3 um up)` 등. v 변위는 `(a/mπ)·Y'_m` 형상이므로 운동에너지 적분은 ∫Y'_m Y'_p = `I5` 이다. `I4`(=∫Y''_m Y''_p)를 쓰면 v-질량이 (mπ/a)² 배가 된다.
- 근거: MATLAB `Ref_Source/analysis/vibration/mlocal.m:45-46` `mm_mp(2,2)=b*(a^2)*I5/(3*um*up)`. 수치(`check6_vib.py`): a=100, m=1 의 강체 v 질량 1.4499e-8 vs 기대 1.4691e-5(비 9.87e-4 = (π/a)²); C-C 3.95e-3. 축방향 진동만 남긴 평판(L=100): 33435 Hz vs 닫힌 해 1002–1050 Hz(**33 배**), L=10 에서도 33435 Hz — 길이와 무관하게 나오는 것 자체가 오류의 증거.
- 영향: 축방향 모드, 짧은 파장의 막 모드, 보 회전관성 항이 틀린다. 긴 보의 휨 1차 진동수는 영향이 작다(L=1000: 0.581 Hz = 오일러-베르누이 0.581). 설계 판정에는 쓰이지 않으나 사용성 검토 값으로 쓰면 틀린다.
- 수정안: `mm[1,1]`, `mm[1,3]`, `mm[3,1]`, `mm[3,3]` 의 `I4` → `I5`. (참고: MATLAB `mlocal.m:57` 의 `mf_mp(2,1)=11*t*(b^2)*I1/210` 에는 여분의 `t` 가 있는 원본 버그가 있고, 파이썬은 `22 ρ t b² I1/420` 으로 바르게 썼다 — 이 부분은 그대로 둔다.)
- 회귀 시험: 축방향 막만 남긴 평판(4 요소, w·θ·u 고정), ρ=7.345e-7, L=100, S-S → f₁ ≈ (1/2L)√(E/(1−ν²)/ρ) = 1050 Hz(±1 %). 현재 33435 Hz.

### R3-03 [P1] [확인] 진동 밀도 기본값 1.0 · 단위 없음 — GUI 는 항상 1.0
- 위치: `src/webview/StcfsdPanel.ts:1368`(`rho: options.rho ?? 1.0`), `:2476`(`_runVibration` 이 `rho: 1.0` 고정), `src/mcp/server.ts:693-695`("Material density (default 1.0)"), `python/server.py:117-131`
- 현상: 엔진 내부 단위(kip, in, s)에서 강재 질량밀도는 0.2836 lb/in³ ÷ 386.09 in/s² = **7.345×10⁻⁷ kip·s²/in⁴** 이다. 기본 1.0 이면 진동수가 √(7.345e-7) 배, 즉 1/1167 로 나온다. MCP 의 `units="SI"` 경로도 rho 를 변환하지 않는다. 무게밀도(0.2836 lb/in³)나 kg/m³(7850)를 넣어도 g 인수·단위가 맞지 않아 조용히 틀린다.
- 근거: `check6_vib.py` — 립 C L=200: ρ=1.0 → 0.0089 Hz, ρ=7.345e-7 → 10.336 Hz(비 1166.8).
- 영향: GUI 진동 결과는 항상 틀린 절대값이다(모드 순서·비율만 의미가 있다).
- 수정안: 기본값을 없애고 재료에서 질량밀도를 받는다(강재 7.345e-7 kip·s²/in⁴). 입력은 "질량밀도 [kip·s²/in⁴]"로 명시하고, SI(kg/m³) 입력은 경계에서 `ρ[kip·s²/in⁴] = ρ[kg/m³] × 9.357e-11` 로 변환한다(7850 kg/m³ → 7.345e-7). 무게밀도(lb/in³)를 받으면 g=386.09 in/s² 로 나누고 1000 으로 나눈다. 결과에 단위(Hz)와 사용 밀도를 함께 돌려준다.
- 회귀 시험: 단순지지 평판 폭 6, t=0.1, a=6, ρ=7.345e-7 → f₁₁ = (π/2)(1/a²+1/b²)√(D/ρt) = 529.22 Hz(현재 엔진은 ρ 를 바르게 주면 1.0000 비로 통과). GUI 경로에서 같은 값이 나와야 한다.

### R3-04 [P1] [확인] 부절점 판정의 atan2 경계(±π) 문제 — 수치 잡음으로 일직선 절점이 "모서리"가 되고 Rx·Rz 가 0 행으로 남음
- 위치: `python/cfsm/node_utils.py:80-85`(MATLAB `meta_elems.m:57-62` 그대로), `python/cfsm/constraints.py:73-81, 114-117`(평행 요소만 있는 "모서리"에서 `k += 1; continue` 로 Rx·Rz 행을 0 으로 둠), `constraints.py:364-365, 397-398`
- 현상: `a1=atan2(z2−z1, x2−x1)`, `a2=atan2(z1−z3, x1−x3)` 를 `|a1−a2|<1e-7` 로 비교한다. 요소가 −x 방향이면 각이 ±π 이고, z 에 10⁻¹³ 수준의 잡음만 있어도 한쪽은 +π, 다른 쪽은 −π 가 되어 차이가 2π 가 된다. 그 절점은 모서리 주절점이 되고, `constr_xz_y` 는 비평행 요소를 찾지 못해 해당 행을 0 으로 남긴 채 계속한다(MATLAB 은 `while` 에서 배열 밖 접근으로 멈춘다 — 파이썬이 오류를 조용한 쓰레기로 바꿨다).
- 근거: `check8b_wrap.py` — 같은 C(윗 플랜지가 +x 로 진행, 아랫 플랜지가 −x 로 진행)에 z 잡음 0 / 1e-13 / 1e-9: nmno 6/9/9, nD 2/5/5, Rx 0 행 0/3/0. L=7(국부) 분류: 잡음 0 → [0.3,1.3,98.2,0.2]; **1e-13 → [41.7,28.1,0.0,30.2]**; 1e-9 → [0.3,27.7,71.9,0.1]. FSM 하중계수는 같다(17.657).
- 영향: DXF·사용자 좌표·회전된 단면처럼 좌표에 반올림 잡음이 있는 경우 분류가 틀리고, R3-01 과 같은 경로로 dsm 의 극소 라벨이 바뀐다.
- 수정안: 방향 비교를 각도 차가 아니라 단위벡터로 한다: `d1=(n2−n1)/|…|`, `d2=(n1−n3)/|…|`, 일직선 조건 `abs(cross(d1,d2)) < tol and dot(d1,d2) > 0`(tol 1e-7). `constr_xz_y`·`constr_yu_yd` 에서 비평행 요소를 찾지 못하면 `continue` 대신 오류를 낸다(지금 상태에서는 그 경우가 오직 판정 오류로만 생긴다).
- 회귀 시험: `check8b_wrap.py` 의 C(잡음 1e-13) → nsno=9, nD=2, L=7 분류 L ≥ 95 %.

### R3-05 [P2] [확인] `fcfsm/` 은 MATLAB fcFSM 의 이식이 아님 — 길이·BC·m 과 무관한 cFSM 기저로 분류
- 위치: `python/fcfsm/section_analysis.py:51-56`(항상 `a=100, m=[1], BC='S-S'` 로 `base_column`), `:68-93`(곡선 요소 판정 결과는 어디에도 안 쓰임), `python/fcfsm/solver.py:160-209`(자연기저 최소제곱 + 계수 제곱합, 실패 시 `except: pass`, 기저가 없으면 25 % 균등)
- 현상: MATLAB `stripmain_fcFSM.m:301, 513-533, 662-673` 은 판(plate) 단위 힘 [q] 로 `J_GD`, `C_L=null(J_GD')`, `C_D=K\J_GD*J_D`, `C_G=K\J_GD*J_G` 를 **각 길이의 K** 로 만들고, 변형에너지 비율로 분류한다(4 번째 열은 O 가 아니라 오차). 파이썬은 이 중 아무것도 하지 않는다. 고유치는 보통 FSM 그대로이고(구속 없음), 분류만 다른 방식이다. 스프링도 무시한다(MATLAB 은 반영).
- 근거: `check5_fcfsm.py` — 예리한 립 C, L=1000(전체): fcFSM [86.9,0,0,**13.1**] vs cFSM [100,0,0,0]; 둥근 모서리 L=1000: [66.6,0,0,**33.4**]; 둥근 모서리 국부 L=7.02: fcFSM [0,**99.9**,0.1,0] (fcFSM 의 존재 이유인 굽은 모서리에서 정반대). 예리한 C 에서도 "곡선 요소" 8 개로 판정(모서리 이웃 요소를 곡선으로 잡음).
- 영향: 현재 UI·MCP 호출자는 없다(`server.py:103` 의 `fcfsm` 메서드만). README·NEWS 가 기능으로 광고하므로 독립 프로그램이 쓰기 시작하면 틀린 분류가 나간다.
- 수정안: `SecAnal_fcFSM.m` 과 `stripmain_fcFSM.m` 의 #1–#3 블록을 그대로 옮긴다(cornerStrips 입력 포함, 다중 m 블록 대각 확장, 에너지 비 분류). 그 전까지는 `fcfsm` 메서드를 "미구현"으로 막는다.
- 회귀 시험: 예리한 립 C, L=1000 → fcFSM G ≥ 99 %; L=7.02 → L ≥ 95 %; MATLAB `examples/batchcufsm5_fcFSM.m` 예제 값과 비교.

### R3-06 [P2] [확인] `couple=2`(결합 기저) + `orth=1`(자연기저) → 기저가 0 행렬 → 분류 25/25/25/25 % 를 조용히 반환
- 위치: `python/cfsm/base_vectors.py:818-949`(결합 분기에서 `orth in (2,3)` 이 아니면 `b_v` 를 채우지 않음), `python/cfsm/classify.py:146-150, 171-175`
- 현상: MATLAB `base_update.m:172-362` 도 같은 경우 `b_v` 를 채우지 않는다(원본 결함; MATLAB 은 `normal==1` 이면 0/0=NaN 이 된다). 파이썬은 singular → `lstsq` → 0 → `NormSum=0` → **25 % 균등**을 돌려준다. 구속 해석은 R=0 이 되어 오류. MCP `set_gbtcon` 의 기본 orth=1 에 couple=2 만 주면 바로 이 경우다.
- 근거: `check1_basis.py` — couple=2·orth=1 의 기저 rank 0(252 열 전부 0); `check8_robust.py` — 분류 [25,25,25,25].
- 영향: 그럴듯한 분류값이 나가 오해를 부른다.
- 수정안: 결합 분기에서 `orth==1` 이고 `ospace==1` 이면 `b_v = b_v_l` 로 둔다(결합 기저라도 자연기저는 블록대각 그대로가 맞다). `mode_class` 의 `NormSum≈0` 은 NaN 또는 예외로 바꾼다.
- 회귀 시험: 립 C, L=7, `GBTConfig(couple=2)` → 분류가 `GBTConfig(couple=1)` 과 같음([0.3,1.4,97.5,0.9]).

### R3-07 [P2] [확인] 결합 기저 `ospace=3` 다중 m 에서 배열 대입이 전치되어 실패 · 결합/비결합 ospace 번호 불일치
- 위치: `python/cfsm/base_vectors.py:869-877`, `:878-886`, MCP 설명 `src/mcp/server.ts:745`
- 현상: `b_v[행 범위, :] = b_v_O[…].T` 로 **행**에 넣는다. MATLAB `base_update.m:251-253` 은 열 `b_v(:, …)=b_v_O(:, …)` 이다. totalm>1 이면 모양 불일치로 실패한다(totalm=1 에서는 뒤의 직교화가 열을 덮어써 드러나지 않음). 또 MATLAB 자체가 비결합에서는 ospace 2=K·3=Kg·4=벡터, 결합에서는 3=K·4=Kg·5=벡터로 번호가 하나씩 밀려 있고(결합 ospace=2 는 아무 일도 안 함), MCP 설명은 비결합 기준만 적었다.
- 근거: `check8_robust.py` — C-C, m=1..3, `GBTConfig(ospace=3, couple=2, orth=2)` → `ValueError: could not broadcast input array from shape (40,84) into shape (40,252)`.
- 수정안: 열 대입으로 고치고(`b_v[:, c0:c1] = b_v_O[:, ml*nom:(ml+1)*nom]`), 결합 분기 번호를 비결합과 같게(2=K, 3=Kg, 4=벡터) 맞춘 뒤 MATLAB 과의 차이를 주석으로 남긴다.
- 회귀 시험: C-C, m=1..3, couple=2, ospace=3, orth=2 → 예외 없이 rank=252, 분류 합 100 %.

### R3-08 [P2] [확인] 폐단면 J: 요소 방향이 섞이면 틀림 — MATLAB 의 폐단면 재정렬 블록 누락
- 위치: `python/cfsm/base_vectors.py:124-139`(`_cutwp_prop2`, `engine/cutwp.py:28` 이 공용으로 씀)
- 현상: MATLAB `Ref_Source/analysis/cutwp_prop2.m` 은 `section=='close'` 일 때 요소를 고리 순서로 재배열하고 방향을 뒤집는다(`ends(i+1,:)=en(m,[2 1 3])`). 파이썬은 이 블록이 없어서 한 요소라도 방향이 반대면 p 의 부호가 뒤집혀 둘러싼 면적이 틀린다.
- 근거: `check11_closedJ.py` — 4×4 각관 t=0.1: 일관 방향 6.400(Bredt 6.400), 순서만 섞음 6.400, **한 요소 방향 반대 3.600**(−44 %); `engine.cutwp.cutwp_prop` 도 3.6.
- 영향: 템플릿 RHS/CHS 는 방향이 일관되어 영향 없음. 사용자 정의 폐단면에서 J 가 작게 나와 대개 보수측이다(R2 영역의 소비자).
- 수정안: MATLAB 재배열 루프를 옮기거나, 면적을 Σ(xᵢzⱼ−xⱼzᵢ)/2 를 고리 순회 순서로 계산한다.
- 회귀 시험: 위 각관, 요소 4 방향 반대 → J=6.400.

### R3-09 [P2] [확인] 선택 벡터가 모두 0 이어도 cFSM 이 "활성" — MATLAB 은 합>0 일 때만
- 위치: `python/models/data.py:41-44`(`is_active` 는 길이>0 만 봄), 소비 `python/engine/fsm_solver.py:153`
- 현상: MATLAB `stripmain.m` 은 `sum(GBTcon.glob)+…>0` 일 때만 cFSM 을 켠다. CUFSM `.mat` 은 보통 `glob=[0 0 0 0]` 처럼 0 벡터를 저장하고 `mat_loader.py:86-89` 가 그대로 읽으므로, 그런 파일을 열면 모든 길이가 `NO_FREE_DOF` 로 실패한다.
- 근거: `check12_zeros.py` — 0 선택: `is_active=True`, curve `[[7., 0.]]`, 진단 `NO_FREE_DOF`; 보통 FSM 은 18.042.
- 수정안: `is_active = any(np.sum(v) > 0 for v in (glob, dist, local, other))`.
- 회귀 시험: 0 선택 GBTConfig → 보통 FSM 과 같은 lf(18.042).

### R3-10 [P2] [확인] 분류 기본 설정이 CUFSM 기본과 다름(orth=1·norm=0 vs orth=2·norm=1)
- 위치: `python/models/data.py:37-40`, 사용처 `python/design/aisi_s100.py:2373`(`GBTConfig()`), `python/server.py:97-99`
- 현상: CUFSM 은 분류 기본으로 축하중 모달 기저·벡터 노름을 쓴다(`Ref_Source/helpers/loader.m:135-145`, `examples/batchcufsm5.m:169`). 파이썬 기본은 비직교 자연기저·노름 없음이다. 비직교 기저에서는 계수 분해가 기저 척도와 상호 각에 좌우된다.
- 근거: `check3_classify.py` — 예리한 립 C 휨 국부: 기본 [0.5,3.3,91.8,**4.5**] vs CUFSM 기본 [0.5,3.5,95.5,**0.5**]; 둥근 모서리 압축 국부: 기본 D **96.5 %** vs 59.6 %.
- 수정안: 분류 전용 기본을 `GBTConfig(orth=2, norm=1)` 로 두고(구속 해석용 선택 벡터와 분리), 보고서에 쓴 설정을 결과에 담는다.
- 회귀 시험: `classify(..., GBTConfig())` 와 `GBTConfig(orth=2,norm=1)` 이 같은 결과를 내도록(기본값 변경 후) — 예리한 립 C 휨 L=4.92 → O ≤ 1 %.

### R3-11 [P2] [확인] 소성곡면: 두께 방향 섬유 없음 → 평판 약축 Mp=0, M22_y=0 이면 정규화를 조용히 건너뜀
- 위치: `python/plastic/pmm_plastic.py:130-174`(중심선 위 길이 방향 섬유만), `:110-112`(항복값이 0 이면 정규화 없이 반환)
- 현상: MATLAB `fiber4elem.m:279-306` 은 요소 중앙에서 **두께 방향** 섬유를 만든다(길이 방향 분할은 요소 분할에 맡김). 파이썬은 길이 방향만 나눠 두께 방향 모멘트(b t²/4 항)를 잃는다. 얇은 단면에서는 (t/h)² 차수라 무시할 만하나, 평판·플랫바·약축에서는 0 이 된다. 또 `M22_y` 가 0 이면 그 축만 정규화되지 않은 값이 섞여 나가고, 같은 평판을 30° 돌리면 `M22_y=100`(stress 쪽 산정이 각도에 따라 흔들림)이 된다.
- 근거: `check7_plastic.py` — 6×0.25 평판: Np 75.000 = A·Fy, 강축 Mp 112.500 = t b²/4·Fy(정확), **약축 Mp 0.000 vs 4.6875**; M22_y 0°: 0.0, 30°: 100.0.
- 영향: 소성곡면은 설계 판정에 쓰이지 않는다(표시용). 평판·두꺼운 단면에서 틀린 곡면이 보인다.
- 수정안: 섬유를 (길이 방향 n) × (두께 방향 NL) 격자로 만든다. 항복값이 0 이면 정규화 생략 대신 "해당 축 미정의" 플래그를 돌려준다.
- 회귀 시험: 6×0.25 평판 → 약축 Mp = 4.6875(두께 방향 10 섬유에서 ±1 %).

### R3-12 [P2] [확인] 진동 해석이 스프링·사용자 구속을 무시
- 위치: `python/vibration/solver.py:88-90`(시그니처에 springs·constraints 없음), `:160-165`(고정 DOF 만 제거), `python/server.py:117-131`
- 현상: MATLAB `stripmain_vib.m:1` 은 `springs, constraints, GBTcon` 을 받아 K 에 스프링을 더하고 R 로 구속을 넣는다. 파이썬은 조용히 뺀다.
- 수정안: `engine/fsm_solver.py` 와 같은 스프링 조립·`constr_user`/R 경로를 공유한다. 당장은 springs/constraints 가 있으면 경고를 진단에 넣는다.
- 회귀 시험: 플랜지 끝에 큰 스프링(kw=1e6)을 준 립 C L=200 → 스프링 없는 경우보다 f₁ 증가.

### R3-13 [P2] [확인] 폐단면 분류가 알 수 없는 오류로 실패
- 위치: `python/cfsm/base_vectors.py:124-139`(폐단면 warping 을 NaN 으로 둠) → `yDOFs` → `la.null_space` 에서 `ValueError: array must not contain infs or NaNs`
- 현상: GBT/cFSM 은 폐단면을 지원하지 않으므로(MATLAB 주석 "the cross-section must not be closed") 실패 자체는 맞다. 다만 사용자에게 원인이 보이지 않는다. 분지 단면(I, T), ㄱ형, 단일 판은 nD=0 으로 정상 동작했다.
- 근거: `check8_robust.py` — rhs: `classify ERR ValueError: array must not contain infs or NaNs`; isect nD=0, 분류 합 100 %.
- 수정안: `base_properties` 직후 폐단면(모든 절점 차수=2 또는 고리 존재)을 검사해 "cFSM 분류는 개단면만 지원" 오류를 낸다. dsm 쪽은 분류 없이(휴리스틱) 진행하게 한다.
- 회귀 시험: rhs → 명시적 `ValueError('cFSM ... open sections only')`.

### R3-14 [P3] [확인] 분류 실패의 조용한 대체값
- 위치: `python/cfsm/classify.py:69-71`(빈 모드 → 0 행), `:132-135, 154-157`(singular → lstsq), `:147-150, 172-175`(NormSum=0 → 25 % 균등), `python/fcfsm/solver.py:172, 200-207`
- 현상: 실패를 그럴듯한 숫자로 바꾼다. MATLAB 은 NaN 이 된다.
- 수정안: NaN 을 돌려주고 진단을 남긴다.
- 회귀 시험: 0 벡터 모드 → NaN.

### R3-15 [P3] [확인] 순수 G 구속해 = 고전 해 × 1/(1−ν²)
- 위치: 이론적 성질(ε_x=0 가정, `stiffness.py` 의 E1=E/(1−ν²))
- 현상: 순수 G 구속 해석값은 오일러·휨비틀림 고전해보다 일관되게 9.9 % 높다. MATLAB CUFSM 도 같다. 비구속 FSM 은 고전해와 0.3 % 안쪽으로 맞는다.
- 근거: `check4_global.py` — 립 C L=1000: cFSM-G 1.0898, FSM 0.9932, 고전(E) 0.9916 → 비 1.0990; Z L=200: 15.2071 vs 13.8418 → 1.0986 = 1/(1−0.3²).
- 영향: 현재 설계 경로는 구속 G 를 Pcre 로 쓰지 않는다. 사용자가 cFSM G-only 결과를 Pcre 로 쓰면 약 10 % 비안전측이다.
- 수정안: UI·MCP 의 cFSM 결과에 "순수 G 값은 ν 효과로 약 1/(1−ν²) 높음 — Pcre 로 쓰지 말 것"을 표시한다.

### R3-16 [P3] [확인] 입력 검증·계약의 작은 결함
- 위치: `python/cfsm/base_vectors.py:987-1000`(`if_g/if_d/if_l` 길이 미검사 → `IndexError`), `:406-419`(여분의 뒤틀림 벡터를 앞의 ndm 개만 조용히 사용; MATLAB 은 크기 불일치 오류), `python/server.py:94-101`(패널이 보내는 별도 `GBTcon` 파라미터를 무시하고 `model.GBTcon` 만 씀 — `StcfsdPanel.ts:1353-1357, 2661-2665`), `stiffness.py:266-269, 589-592`(재료 번호가 없으면 0 번 재료로 대체; FSM·fcFSM·진동은 예외를 냄)
- 수정안: 길이 검사 후 명시적 오류, `params.get('GBTcon')` 우선 사용, 재료 미존재 시 예외.
- 회귀 시험: `GBTConfig(glob=[1.0])` → "glob must have length ngm=4" 오류.

### R3-17 [P3] [확인] 소성곡면 해상도 고정(n_na=21, n_theta=36) · 점구름만 반환
- 위치: `python/plastic/pmm_plastic.py:19-20, 92-95`
- 현상: MATLAB 은 `Plastic_Int.m` 으로 고른 격자로 보간하지만 파이썬은 원시 점만 돌려준다. 단축대칭 단면에서는 P=0 의 Mp 가 표본에 정확히 걸리지 않는다.
- 근거: `check7_plastic.py` — 립 C 약축: |P|≤0.02Py 표본의 max|M22| 160.02 vs 섬유 모델의 정확한 Mp 161.69(−1 %). 이중대칭 I 는 Np 194.000 = A·Fy, Mx,p 710.500 = Z·Fy 로 정확.
- 수정안: 각 θ 에서 P(e)=목표 P 가 되는 e 를 이분법으로 찾아 고른 P 격자를 만든다.

## 맞다고 확인한 것

- **MATLAB 줄 단위 대조**(인덱스 1→0, DOF 순서 `[u1 v1 … w1 θ1 …]`, DOFperm, 열 배치): `meta_elems`, `node_class`, `mode_nr`, `DOF_ordering`, `base_properties`, `constr_xz_y`, `constr_planar_xz`, `constr_ys_ym`, `constr_yd_yg`, `constr_yu_yd`, `constr_user`, `mode_constr`, `klocal_transv`(E1×1e8, I2–I5=0), `trans_single`, `assemble_single`, `Kglobal_transv`, `klocal_m`, `kglocal_m`, `trans_m`, `assemble_m`, `create_Ks`, `yDOFs`, `base_vectors`(G/D 의 km 나눔·단위 노름, L 의 회전·가장자리 x/z, O 의 "new way" 전단·횡 벡터, DOFperm 은 G/D/L 열에만), `base_column`, `base_update`(비결합 분기, dofindex, eig 정렬·실수부, 노름 0–3), `mode_select`, `classify`, `mode_class`, `mode_class2` — 위 발견사항 외에는 일치.
- **`rot.T`**: MATLAB `[x z]*rot` 행벡터 규약 = `rot.T @ v`. Z(θp=−30.54°)에서 G2·G3 병진 방향 59.458°·149.458°(=주축), K 결합 3.0e-6, Rayleigh 몫 142.21·15.207 = π²E I₁,₂/(A a²)/(1−ν²) 와 일치(142.83·15.211). 전치를 빼면 결합 0.757 로 틀림(`check2_rotT.py`). G 부분공간의 고유치는 둘 다 같다(공간이 같으므로) — 차이는 자연기저에서 개별 G 모드 선택·라벨에만 나타난다.
- **차원·계수**(`check1_basis.py`): 립 C·Z(nseg=1): 절점 21, nmno 6, ncno 4, nsno 15 → nG 4, nD 2(=6−4), nL 38(=nmno+2nsno+neno), nO 40(=2·nel), 합 84=4·nnode, rank 84, cond 28–29; nseg=2 도 rank 164. 자연기저와 orth=2/3, ospace=1/2, norm 0/1 모두 rank 유지. C-C·S-S m=1..3 블록 rank 252.
- **역학 조건**: G/D 기저의 횡방향 막변형 max 1.7e-16, 면내 전단 max 3e-17(부호 u·km·b + Δv); L 기저 v=0, 국부 u=0; G2–G4 는 면내 강체운동(잔차 ≤2e-13), D 는 강체가 아님(잔차 0.72–0.97).
- **분류**(예리한 모서리, `check3_classify.py`): 참여율 합 100.0 %. 립 C 압축 국부 L=7.02 L 98.2 %, 뒤틀림 L=41.25 D 92.9 %, L=1000 G 100 %; 휨 국부 L 95.5 %, 뒤틀림 D 92.3 %; Z 압축 L 98.2 / D 93.4 / G 100, Z 휨 L 95.5 / D 95.3 / G 100.
- **구속해 ≥ 비구속해**: 모든 경우 성립. 립 C 압축 L=7.02: 순수 L 18.097 vs FSM 18.039(+0.3 %); L=41.25: 순수 D 28.913 vs 26.652(+8.5 %); L=1000: 순수 G 1.0898 vs 0.9932. 휨·Z 도 같은 양상.
- **진동**: 평판 스트립 S-S f₁₁ 비 1.0000(a=6, 30); RHS 보 S-S 13.12 vs 13.15, C-C 29.81 vs 29.82, C-F 4.72 vs 4.69 Hz(10 항) — 휨 강성·횡 질량·일반 경계조건은 맞다. 질량행렬 u·w 강체질량 = ρ t b I1 정확, 휨 질량 계수 156/22/54/13/4/3 정확.
- **소성곡면**: Np = A·Fy(평판 75.000, I 194.000), 이중대칭 I 강축 Mp 710.500 = Z·Fy, 약축 115.2 = Z·Fy(점구름에 존재), P·M 범위 대칭(±194, ±710.5, ±115.2), Z 주축 회전 후 Σ A x₁z₁ = −2.5e-5(회전 전 14.4), M2 부호는 MATLAB 2024 수정(`M2 = M2 − F·x`)과 같음.
- 분지(I, T), ㄱ형, 무립 트랙, 햇, 단일 판, 부절점 없는 5 요소 C: 예외 없이 분류 합 100 %.

## 확인하지 못한 것

- MATLAB 실행 비교: MATLAB 이 없어 같은 입력의 MATLAB 숫자와 직접 맞추지 못했다. 대신 닫힌 해·이론 조건·내부 일관성으로 확인했다.
- `base_update` 의 orth=3(실하중 직교화)에서 Kg 부정부호 → `la.eig` 대체 경로의 정밀도, normal=2/3 의 결합 분기: 실행은 되나 기대값이 없어 정량 확인 못 함.
- R3-01 의 비안전측 크기는 한 단면(AISI 예제 치수)·세 KL 에 대해서만 재현했다. 휨(Mcrl/Mcrd)은 같은 구조로 보이나 설계값까지 따라가 보지 않았다(이 단면의 휨 곡선은 극소가 둘이라 이번에는 라벨이 맞았다: `M_local_detected=True`).
- 다중 m(일반 BC)에서 cFSM 분류의 물리적 타당성: 실행·합 100 % 까지만 확인(C-C m=1..3, L=50: L 65 %, D 34 %).

### KL 별 결과 (`check10b_e2e.py`, R3-01)

립 C 8×2.5×0.625×0.059, r=0.157, Fy=50, LRFD, 자동 DSM. "라벨 교정"은 같은 곡선의 유일한 극소(L=5.79, Pcr=6.88 kips)를 L 로 두고 D 없음으로 둔 경우다. 실제 Pn = min(Pnl, Pnd_true) ≤ 교정 Pnl 이므로, 교정값은 올바른 Pn 의 상한이다.

| KL (in) | 자동 Pne | 자동 Pnl | 자동 Pnd | 자동 Pn | 교정 Pnl | 자동/교정 |
|---|---|---|---|---|---|---|
| 24 | 38.12 | 38.12 | 12.76 | 12.76 | 17.77 | 0.718(보수측) |
| 60 | 28.33 | 28.33 | 12.76 | 12.76 | 14.72 | 0.867(보수측) |
| 100 | 15.51 | 15.51 | 12.76 | 12.76 | 9.99 | **1.277(비안전측 ≥28 %)** |

## 시험이 없는 동작 (`test/python/`)

- cFSM: 기저 차원·rank·역학 조건, `classify`/`mode_class` 의 어떤 실제 모드 분류도, 구속 L/D/G 해석, Z 단면 `rot.T`, 둥근 모서리, 결합 기저 — 시험 없음(`test_design_verification.py:1536` 은 손으로 만든 분류 배열을 dsm 에 넣는 것뿐).
- fcFSM: `test_solver.py:192` 는 고유치가 FSM 과 같은지만 본다(분류 미검사).
- 진동: `test_solver.py:209` 는 ρ 를 4 배 하면 진동수가 절반인지만 본다(닫힌 해·질량행렬·BC 없음).
- 소성곡면: 시험 없음.

## 읽은 파일

| 파일 | 줄 수 |
|---|---|
| python/cfsm/base_vectors.py | 1007 |
| python/cfsm/constraints.py | 617 |
| python/cfsm/stiffness.py | 614 |
| python/cfsm/node_utils.py | 397 |
| python/cfsm/classify.py | 227 |
| python/cfsm/__init__.py | 33 |
| python/fcfsm/solver.py | 209 |
| python/fcfsm/section_analysis.py | 93 |
| python/vibration/solver.py | 212 |
| python/plastic/pmm_plastic.py | 174 |
| Ref_Source/analysis/cFSM/*.m (base_vectors, yDOFs, base_column, base_properties, base_update, mode_select, classify, mode_class, mode_class2, create_Ks, mode_constr, constr_xz_y, constr_planar_xz, constr_yd_yg, constr_ys_ym, constr_yu_yd, constr_user, meta_elems, node_class, mode_nr, DOF_ordering, klocal_transv, klocal_m, kglocal_m, trans_single, Kglobal_transv) | 전부 |
| Ref_Source/analysis/cutwp_prop2.m, stripmain.m(255–330) | 부분/전부 |
| Ref_Source/analysis/fcFSM/SecAnal_fcFSM.m, stripmain_fcFSM.m | 160 / 539 |
| Ref_Source/analysis/vibration/mlocal.m, stripmain_vib.m(관련부) | 88 / 부분 |
| Ref_Source/analysis/plastic/PMM_Plastic.m, Plastic_Int.m, fiber4elem.m | 105 / 128 / 84 |
| 계약 확인: python/server.py(1–215), python/models/data.py(1–200), python/engine/fsm_solver.py(140–260), python/engine/dsm.py(170–260, 420–510), python/design/aisi_s100.py(445–475, 536–590, 2320–2420), src/mcp/server.ts(관련 도구), src/webview/StcfsdPanel.ts(관련 case), Ref_Source/helpers/loader.m(95–150) | 부분 |

스크립트: `C:\Users\USER\AppData\Local\Temp\claude\3df7e1c8eb560f18\99d094e4-961f-4f09-9be9-02ec03b2e201\scratchpad\review\R3\` 의 `common.py`, `check1_basis.py`, `check2_rotT.py`, `check3_classify.py`, `check4_global.py`, `check5_fcfsm.py`, `check6_vib.py`, `check6b_vib_cc.py`, `check7_plastic.py`, `check7b.py`, `check8_robust.py`, `check8b_wrap.py`, `check9_dsm_contract.py`, `check10_e2e.py`, `check10b_e2e.py`, `check11_closedJ.py`, `check12_zeros.py`.
