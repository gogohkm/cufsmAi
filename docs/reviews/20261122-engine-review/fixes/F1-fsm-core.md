# F1 — FSM 코어 수정 기록

## 요약

고침 10 (R1-09 는 일부 보류) · 보류 0 · 기각 0 · 사용자 결정 필요 2 (2 번은 결정됨 — 낮은 항 1..7 로 넓힘, 반영함). V1 검증 뒤 V1-01 · V1-04 · V1-05 · W1 · R3-15 · 시험 정직성 6 건을 더 고쳤다(「V1 검증 뒤 고친 것」).

- 자기 시험: `.venv\Scripts\python.exe -m pytest -q test/python/test_review_1122_fsm.py test/python/test_solver.py test/python/test_element.py` → 47 passed (약 15 s, 이 파일 27 함수).
- 전체(마지막 실행, 낮은 항 결정 반영 뒤): `.venv\Scripts\python.exe test\python\run_all.py` → `Ran 374 tests in 54.235s` · `FAILED (failures=3)`. 실패 3 건은 W3 의 TS · JS 파일을 읽는 계약 시험이다: `test_design_verification.test_purlin_uplift_r_and_governing_wiring_contract`, `test_webview_design_prepare_contract`, `test_webview_design_state_roundtrip`(Node). 첫 묶음 때 실행(실패 3 – 17 건)도 모두 접합 · 하중 · 부재 · 진동 영역이었다. `aisi_s100` 이 부르는 `stripmain` 을 감싸 예외를 세어 보았고 0 건이었다. FSM 관련 시험은 전부 통과했다.
- 린트: `.venv\Scripts\ruff.exe check python test` → `All checks passed!`

## 발견사항별

| 번호 | 처리 | 무엇을 바꿨나 (파일:함수) | 값의 변화 (전 → 후, 기준값) | 회귀 시험 |
|---|---|---|---|---|
| R1-01 | 고침 (엔진 쪽. 호스트 쪽은 후속) | `helpers.py`: `m_recommend` · `m_recommend_details` · `characteristic_half_wavelengths` · `recommended_terms` 를 새로 이식했다(`m_recommend.m`). `fsm_solver.py:_longitudinal_term_diagnostics`: BC ≠ S-S 이면 길이마다 권장 항이 다 들어 있는지 본다. 항이 7 개보다 적거나 {1,2,3} 이 없으면 서명 곡선을 풀지 않고 바로 경고한다. 그 밖에는 Lcrl · Lcrd 를 한 번 구해 빠진 항을 `missing_terms` 로 낸다. 코드는 `warning` / `INSUFFICIENT_LONGITUDINAL_TERMS` 이다. 호출자가 준 `m_all` 은 바꾸지 않는다 | 엔진 값은 그대로이고 경고만 늘었다. 권장 항으로 풀면 립 C형강 L=100 C-C 의 lf1 이 75.68 → 15.106 이다(S-S 국부 극소 15.09, 리뷰어 15.11). S-C 47.08 → 15.07, C-G 20.42 → 15.07, C-F 6.08 → 5.74. 정사각관 L=400, 15 항의 오일러 비는 C-C 1.008, C-F 1.007, C-G 1.006, S-C 1.031 | `test_R1_01_euler_tube_all_bc_converges_with_terms`, `test_R1_01_non_ss_single_term_warns`, `test_R1_01_m_recommend_lipped_c_clamped_finds_local`, `test_R1_01_recommended_terms_lcrd_typo`, `test_solver.py::test_stripmain_all_bc`(바로잡음) |
| R1-02 | 고침 | `fsm_solver.py:stripmain`: 검사 직후 `msort` 를 적용한다(MATLAB `stripmain.m:82`). 정리로 바뀐 길이에는 `info` / `LONGITUDINAL_TERMS_SORTED` 를 남긴다. 정리 뒤 빈 길이는 `ValueError`. 정리한 항은 `result.m_all` 에 싣는다(인스턴스 속성. 데이터클래스 필드는 F2 후속). shapes 의 DOF 배치가 이 순서를 따르므로 `classify` 의 정렬과 맞는다 | 립 C형강 L=10 `[1,1]`: 892.22(성공) → 26.178. 정사각관 L=10 `[1,1]`: 16.72 → 140.01. `[0,1]`: `EIGENSOLVE_FAILED` → 26.178. `[2,1]`: 고유치는 같고 shapes 는 `[1,2]` 순서 | `test_R1_02_msort_duplicate_zero_unsorted_terms` |
| R1-03 | 고침 (진단. 정확도 회복은 불가 — 아래 근거) | `fsm_solver.py:_rounding_error_estimate`: 1차 고유치의 반올림 상대오차를 `max(eps·cond₂(K), eps·‖K‖₂‖x‖²/|xᵀKx|)` 로 추정한다. 전부 0 인 행(연결 안 된 절점)은 빼고 본다. 추정이 1e-2 를 넘으면 `warning`, 0.25 를 넘으면 `error` (`ILL_CONDITIONED`, `error_estimate` 키). `error` 인 길이는 다른 실패와 같이 `[a, 0.0]` 행 · 0 모드로 내고 `success=False` 가 된다. 조건수 항이 필요한 까닭: 진짜 1차 고유치가 음수 · 복소수로 밀려 걸러지면 더 높은 모드가 1차로 나오는데, 그 모드 자신의 섭동 한계는 작다(관찰: RHS L=3e4 에서 오일러의 9.2e6 배, 모드 추정만으로는 진단 없음) | 립 C형강 r=0: L=1e4 0.956 – 0.973×오일러(성공) → 오류 · 0 행. 5e4 10.3× → 오류. 1e5 1037× → 오류. L=5000 은 경고(추정 2.5e-2, 실제 ±0.5 %). r=0.1 둥근 모서리 립 C형강은 L=5000 에서 오류다(추정 0.54, DOF 순서만 바꿔도 −10 % … +2.5 % 흔들림을 확인함). **V1 뒤 고침**: 대각 스케일 추정 · 폐기 경계 0.1 로 바꿨다. 경고 · 오류가 시작되는 길이는 아래 「V1 검증 뒤 고친 것」 표에 있다 | `test_R1_03_very_long_length_is_flagged_not_returned`, `test_R1_03_garbage_at_long_length_never_success` |
| R1-04 | 고침 | `assembly.py:element_dofs` · `assemble` · `spring_assemble`: `np.ndarray` 를 받으면 요소 DOF 색인 한 번(`np.ix_`, 중복 색인이면 `np.add.at`)으로 더한다. lil 을 받으면 원래의 2×2 블록 경로를 그대로 쓴다(F3 의 vibration · fcfsm 이 lil 을 쓴다). `fsm_solver.py`: K · Kg 를 dense 로 만든다. 고유치는 K 가 양의 정부호이면 대칭 정부호 문제 `eigh(Kg, K, subset_by_index=…)`(μ = 1/λ, 큰 μ 부터 neigs 개)로 푼다. 아니면(연결 안 된 절점 등) 원래 QZ `eig(K, Kg)` 경로로 푼다 | 조립 결과는 원래와 **비트 단위로 같다**(5 BC × m=1,3,5 + 스프링 3 종, 최대 차 0). 고유치 풀이 변경에 따른 차이는 수정 전 솔버(사본)와 30 경우(BC 5 종, 압축 · 휨, 스프링, 구속, 고정, cFSM 3 종)를 비교해 확인했다. 짧은 길이에서 1e-11 – 1e-8, L=600 에서 ≤ 1.4e-4 이다. 길이에 따라 커지는 반올림 한계 안이다(cFSM 은 1e-13). 시간: 50 길이 m=[1] 11.7 s → 0.16 s. C-C m=1..10 은 19 s → 0.6 s. 14 항은 37 – 56 s → 0.9 s | `test_R1_04_dense_assembly_matches_block_assembly`, `test_R1_04_multi_term_uses_fast_paths`, `test_R1_09_orphan_node_uses_fallback_solver` |
| R1-05 | 고침 | `helpers.py:signature_ss`: `from models.data import GBTConfig`. 덧붙인 것: 선택 인자 `GBTcon=None`(MATLAB 의 iGBTcon), 결과 키 `diagnostics` | 서버 `signature_ss` RPC: 언제나 ImportError → 100 점 곡선 | `test_R1_05_signature_ss_rpc_works` |
| R1-06 | 고침 | `fsm_solver.py:_normalize_springs`: (10,) 은 `atleast_2d` 로 바꾸고, 0 하나 또는 전부 0 이면 "스프링 없음"으로 본다(MATLAB `springs(1,1)~=0` 표시). 다음은 모두 `ValueError` 다: 열 ≠ 10, nodei ∉ 1..n, nodej ∉ 0..n, discrete ∉ {0,1}, discrete 인데 ys ∉ [0,1], 비유한 값 | 1차원 스프링 하나: 무시(26.178) → 반영(이 파일의 시험 모델에서 1.5 배 이상, 리뷰어 예 123.0) | `test_R1_06_one_dimensional_spring_not_dropped` |
| R1-07 | 고침 | `helpers.py:master_slave`: 슬레이브마다 `[s,1,1,m,1] [s,1,uq,m,4] [s,2,1,m,2] [s,2,wq,m,4] [s,4,1,m,4]` 다섯 행(`master_slave.m:21-25`, v 는 묶지 않음) | master (0,0) · slave (3,4) 의 행: 틀린 6 행 → 원본과 같은 5 행. 분할판을 `master_slave` 로 묶으면 k = 4.000 | `test_R1_07_master_slave_rows_match_matlab`, `test_R1_07_master_slave_ties_split_plate` |
| R1-08 | 고침 | `fsm_solver.py:_validate_inputs` · `_normalize_constraints`, `boundary.py:BC_I1_5` · `BC_I1_5_atpoint`(`VALID_BCS` 밖이면 `ValueError`). 다음을 모두 `ValueError` 로 거절한다. BC 철자. prop 모양 · 비유한 · Ex/Ey/G ≤ 0. node 모양 · 비유한(응력 NaN 포함). elem 모양 · 절점 범위 · 두께 ≤ 0 · 폭 0. lengths 비었음 · ≤ 0 · 비유한. `len(m_all) ≠ len(lengths)`(긴 쪽도). m 항 비유한 · 음수 · 비정수, 정리 후 빈 항. `neigs < 1` · 비정수. 구속식 모양 · 절점 범위 · DOF 코드 | 전: IndexError · 조용한 잘림 · L=−10 을 10 으로 · m=1.5 → 17.40 · `'s-s'` → K=0 · neigs=0 성공. 후: 모두 명시적 `ValueError` | `test_R1_08_invalid_input_rejected` |
| R1-09 | 고침 (일부 보류) | `fsm_solver.py`: 모드를 `mode/mode[argmax|mode|]` 로 정규화해 부호까지 MATLAB 과 같게 했다(`stripmain.m:386-389`). `n_eigs` 는 풀이 개수를 줄이지 않는다는 주석을 달았다(QZ 대체 경로에서만 쓰임). `helpers.firstyield` 에 `unsymm=0` 인자를 덧붙이고, MATLAB `firstyield.m` 과 기능이 다르다는 것을 docstring 에 적었다. 보류한 것: `vectorized.py`(호출자 없음, 지우지 않음), `doubler` 의 새 절점 DOF 플래그 · 번호(Python 쪽이 물리적으로 더 타당해 그대로 둠), `add_corner` · `stress_to_action`(호출자 없음, 수치 검증 안 함) | 모드형상 최대 성분이 −1 이던 경우 부호가 뒤집힌다(값의 크기 · 고유치는 그대로) | `test_R1_09_mode_normalised_to_plus_one`, `test_R1_09_firstyield_unsymm_consistent_with_stresgen` |
| R1-10 | 고침 | `test/python/test_review_1122_fsm.py` (21 함수, 약 8 s). 단면은 이 파일에서 직접 만든다(template.py 에 기대지 않음). 휨비틀림 시험의 단면 성질(A, I, 전단중심, J, Cw)도 이 파일의 부채꼴 좌표 적분으로 따로 계산한다. `test_solver.py::test_stripmain_all_bc` 는 m=[1] 로 모든 BC 를 "lf>0" 으로 통과시키고 있었으므로 S-S 밖은 `m_recommend` 항으로 풀고 경고가 없음을 보게 바로잡았다 | 시험 기대값(모두 시험 안의 닫힌 해): 판 k = 4.000 (±0.1 %), ψ=0 → 7.81, ψ=−1 → 23.9 (±0.5 %). 오일러 S-S 1.0004 (±0.2 %). I형강 횡비틀림 ±1 %. 립 C형강 FT · 약축 ±0.5 % (측정 1.0011 · 0.9976). 탄성지반 · 중앙 이산 → 2Pe, L/4 → 1.5Pe (±0.1 %). 회전 스프링 판 6.97 (±0.5 %) | `test_R1_10_*` 7 함수 |

### R1-01 의 Lcrl / Lcrd 줄 — 결정: Lcrd 로 고쳐 쓴다

`m_recommend.m:101` 의 뒤틀림 묶음 마지막 항 `ceil(a/Lcrl)+3` 은 `ceil(a/Lcrd)+3` 의 오타로 판단하고 Lcrd 를 쓴다(`recommended_terms` 의 docstring 에 적음). 까닭은 셋이다.

- 같은 줄의 나머지 여섯 항이 모두 Lcrd 다.
- MATLAB 이 넣는 `ceil(a/Lcrl)+3` 은 국부 묶음(`>4` 이면 c−3 … c+3, 아니면 1..7)에 언제나 이미 들어 있다. msort 뒤에 지워지므로 그 결과는 `ceil(a/Lcrd)+3` 항 하나를 빠뜨리는 것뿐이다.
- 고친 쪽은 MATLAB 쪽 항의 상위집합이다. Rayleigh–Ritz 에서 항을 더하면 고유치는 같거나 낮아질(정확해질) 뿐이므로 MATLAB 결과보다 비안전측이 될 수 없다.

### m_recommend 이식에서 MATLAB 과 다른 점

- `m_recommend.m` 의 cFSM 분기(극소가 꼭 2 개가 아닐 때)는 국부 · 뒤틀림 두 루프가 극소 카운터 `cr` 를 같이 쓴다. 그래서 국부 극소가 있으면 `wl_dist(1)` 이 0 이 되고(Lcrd = 0 → 항 = ∞), 극소가 하나도 없으면 `wl` 이 정의되지 않아 오류가 난다. Python 은 각 cFSM 곡선의 첫 극소를 그대로 쓴다. cFSM 곡선에서도 못 찾거나 cFSM 이 실패하면(닫힌 단면, 뒤틀림 모드 0 개 등) 일반 서명 곡선의 극소(첫째 → Lcrl, 마지막 → Lcrd)로 대신하고 `method='signature_fallback'` 과 경고를 낸다. (V1 뒤 고침: 고전 cFSM 이 성립하지 않는 모델에서는 cFSM 분기를 건너뛴다. 극소가 하나도 없으면 `ValueError` 대신 `method='no_minimum'`, 항 1..7, 경고를 낸다. 아래 「V1 검증 뒤 고친 것」 참고.)
- 서명 곡선에서 실패한 길이(`error` 진단, lf = 0)는 NaN 으로 두어 극소로 잡히지 않게 했다. 긴 쪽 끝의 `ILL_CONDITIONED` 가 0 행으로 떨어져 가짜 극소가 생기는 것을 막는다.
- 확인한 판정 경로(V1 뒤): 이 시험 파일의 립 C형강 · 정사각관 · 호 3 요소 둥근 립 C(6×2.5)는 `signature`. 날카로운 햇은 `cfsm`. 둥근 모서리 립 C 8×2.5×0.625 r=0.1875(극소 1 개)는 `signature_fallback`(ROUNDED_CORNER). I형강 · 티는 `signature_fallback` 또는 `no_minimum`(BRANCHED_SECTION). 날카로운 앵글 압축은 `no_minimum`. 1 회 비용은 0.1 – 1.6 s 이고 같은 모델은 캐시에서 바로 나온다.

### R1-03 에서 정확도를 되살리지 못하는 근거

`scratchpad\fix\F1\exp4.py` 의 실험이다. 같은 K 의 성분마다 ±eps 만큼 무작위 섭동을 주었더니, 둥근 모서리 립 C형강 L=5000 의 1차 고유치가 QZ 에서 −8 … +21 %, Cholesky 기반 `eigh` 에서 −8 … +9 % 흔들렸다. K 를 만드는 순간(막 늘음 항 E·I1/b 에 작은 전단 · 휨 항을 더할 때) 정보가 사라진다는 뜻이다. 대각 스케일링, 역수 문제, 순열 모두 같은 결과였다. 그래서 수정은 신뢰할 수 있는 진단과 결과 폐기로 했다. (V1 뒤) 추정은 대각 스케일한 K 로 계산하고, 실측 흔들림(최대 − 최소)의 1.2 – 5 배다. 경고 1e-2 · 폐기 0.1 이다.

## V1 검증 뒤 고친 것

| V1 | 처리 | 무엇을 바꿨나 | 값의 변화 | 회귀 시험 |
|---|---|---|---|---|
| V1-01 (P2) 큰 스프링에서 정확한 결과를 버림 | 고침 | `fsm_solver.py:_stiffness_info` · `_rounding_error_estimate`. eigh(Cholesky) 경로는 대각 스케일한 K(`Kd = D K D`, `D = diag(K)^-1/2`)로 조건수 · 모드 항을 계산한다. QZ 대체 경로는 스케일하지 않은 식 그대로다. 정부호 판정도 스케일 고유치로 한다(합동이라 같음). 스케일 추정은 실측 흔들림의 1.2 – 5 배로 예전(3 – 10 배)보다 덜 비관적이다. 그래서 폐기 경계를 0.25 → **0.1** 로 낮췄다(경고 1e-2 는 그대로) | 립 C 9×5×1×0.1, 절점 1 의 접지 스프링 ku = kw = 1e12 · 1e14 · 1e16: L=300 의 0 행(error) → 59.0899, L=100 은 76.7993. 진단이 없고, 1e6 스프링과 같은 값이다. 긴 길이 판정은 남는다. 이 파일의 립 C 는 L=1e4 가 error(스케일 추정 0.16, 실측 흔들림 11.5 %), 5e4 가 error | `test_R1_03_stiff_spring_not_flagged`(DOF 고정 정확해와 1e-6), `test_R1_03_very_long_length_is_flagged_not_returned`, `test_R1_03_garbage_at_long_length_never_success` |
| V1-04 (P3) 기록의 "L ≤ 1000 은 경고 없음" 이 틀림 | 고침(기록 정정 + 재측정) | 위 R1-03 행과 아래 표 | — | — |
| V1-05 (P3) 둥근 모서리의 cFSM 분기, 극소 없음 → ValueError | 고침 | `helpers.py:characteristic_half_wavelengths`. 서명 곡선 극소가 2 개가 아니면 F3 의 `cfsm.node_utils.check_cfsm_model` 로 고전 cFSM 이 성립하는지 본다(판정 논리는 옮기지 않았다). 성립하지 않으면 cFSM 분기를 건너뛰고 서명 곡선 극소를 쓴다(`signature_fallback`, `cfsm_check` 에 코드). 두 극소로 정하지 못한 모든 경우에는 서명 곡선의 모든 극소를 `extra_lengths` 로 더해 그 근처 항도 넣는다(상위집합). 극소가 없으면 `no_minimum`: `Lcrl` = `Lcrd` = None, 항 1..7(m_recommend 의 ceil(a/Lcr) ≤ 4 묶음), 경고. 근거: 곡선이 단조 감소하면 가장 긴 반파장의 모드가 가장 낮다. `recommended_terms(a, Lcrl, Lcrd, extra=())` 는 None · extra 를 받는다(덧붙임). 새 함수 `terms_from_half_wavelengths(a, lcr)` | 둥근 립 C 8×2.5×0.625×0.059 r=0.1875: cfsm Lcrl 4.84 · Lcrd 5.31 → signature_fallback 5.84. C-C 1차는 권장/전부(1..N) 1.0004 (L=100) · 1.0001 (L=200). 12×3.5×1×0.0346 r=0.0712 은 1.0002 · 1.0001, 6×1.625 는 1.0001 · 1.0000. 휨 · 뒤틀림 지배 8×3.5×0.4×0.1 r=0.2 는 1.0010 · 1.0005. 앵글 2×2×0.0346 · 티 8×6×0.1 압축은 ValueError → 항 1..7 이고, 전부 대비 C-C ≤ 1.0013, C-F ≤ 1.0091 | `test_R1_01_m_recommend_other_branches`(cfsm · 둥근 · 가지 · 극소 없음), `test_R1_01_recommended_terms_lcrd_typo` |
| W1 m_recommend 두 번 · 느림 | 고침 | `stripmain(..., half_wavelengths=None)` 인자를 덧붙였다. `m_recommend_details` 결과 dict 를 주면 항 부족 진단이 그것을 쓴다(키가 없으면 `ValueError`). `characteristic_half_wavelengths` 는 (prop, node, elem) 바이트를 키로 하는 캐시(16 개, deepcopy)를 둔다. 느린 까닭은 이 모델들이 cFSM 분기(서명 곡선 3 개 = 300 번 풀이, 길이마다 cFSM 기저 생성)를 탔기 때문이다. 둥근 모서리 모델은 이제 그 분기를 건너뛰어 곡선 1 개다. 조립의 색인 경로도 다듬었다(`_add_dense(distinct=True)`, `element_dofs` 벡터화) | GUI 기본형 둥근 립 C(37 절점): 2.5 s → 0.6 s(부하 없을 때). 날카로운 립 C 의 cfsm 분기는 1.6 s. 두 번째 호출은 캐시라 ≈ 0 | `test_R1_01_precomputed_half_wavelengths_skip_recomputation`(서명 곡선 호출 수를 센다) |
| R3-15 (F3 / V1) G 만 구속한 해 | 고침(진단) | `fsm_solver.py:_cfsm_constraint_diagnostics`. GBTcon 이 G 만 고르면 `CFSM_GLOBAL_ONLY` 경고, `check_cfsm_model` 이 지원 밖이면 `CFSM_MODEL_NOT_SUPPORTED` 경고(`cfsm_code`)를 낸다. 값은 바꾸지 않는다 | 이 파일의 립 C L=800: G 구속 / 무구속 = 1.0975 = 1/(1−ν²) (1.0989) 와 0.2 % 안 | `test_R3_15_cfsm_constraint_warnings` |
| 시험 정직성 | 고침 | `test_R1_03_garbage_…`: 같은 실행의 L=400 이 진단 없이 오일러 ±0.5 % 여야 한다. `test_R1_09_orphan_…`: QZ 경로 호출 수(2 · 0)와 오일러 닫힌 해 ±0.2 %. `test_R1_04_multi_term_runtime` → `test_R1_04_multi_term_uses_fast_paths`: 벽시계 대신 dense 조립 횟수 = 요소 수, lil 0, QZ 0 을 세고, m=1..25 C-C 국부 ≈ S-S 국부 극소 ±2 %. 오일러 BC 시험: m_recommend 항으로 상한(C-C 1.04 · C-F 1.01 · C-G 1.03 · S-C 1.13) 안이고, m=[1] 은 네 BC 모두 그 상한을 넘는다(수정 전 코드에는 m_recommend 가 없어 실패) | — | 위 시험들 |

경고 · 폐기가 시작되는 길이(V1-04 재측정, `scratchpad\fix\F1\sweep.py`). S-S, m=[1], 1 – 5000 in 로그 60 점, 압축 · 휨이 같다.

| 단면 | 첫 경고 | 첫 폐기 |
|---|---|---|
| 지름 1.0 · t 0.035 CHS (96 현) | 574 | 1000 (L=1000 정확히: 추정 0.107, 실측 흔들림 2 %) |
| 18 mil 트랙 1.625×1.25 | 1022 | 1820 |
| 18 mil 립 C 3.625×1.625 · 앵글 1×1×0.0188 | 1180 | 2103 |
| GUI 기본형 립 C 6×2×0.625×0.0451 r 0.09 · 립 Z · 햇 · 립 앵글 | 2103 | 3243 – 3746 |
| 립 C 12×3.5 · 트랙 6×1.25 · RHS 4×2 · 앵글 4×4 | 2429 – 2807 | 4328 – 5000 |
| CHS 6×0.1 · I 8×4 · 티 8×6 | 없음 | 없음 |

곧 호스트 범위(≤ 1000 in)에서 경고가 나는 것은 시험한 것 가운데 지름 1 in CHS(574 in 부터) 하나이고, 폐기는 그 CHS 의 1000 in 하나다. V1 이 말한 18 mil 단면의 1000 in 경고(추정 0.012 – 0.065)는 대각 스케일 추정에서 사라졌다.

V1-02(`GBTConfig` 기본값)와 V1-03(couple=2 ospace 번호)는 F2 · F3 의 파일이라 손대지 않았다. `characteristic_half_wavelengths` 의 cFSM 분기는 `orth=1, norm=0` 을 명시해 MATLAB `m_recommend.m` 과 같게 했으므로 V1-02 기본값 변경의 영향을 받지 않는다.

### 낮은 항 1..7 로 넓힘 (코디네이터 결정, V1 뒤)

| 무엇 | 파일:함수 | 값의 변화 | 시험 |
|---|---|---|---|
| 권장 항의 전체좌굴용 낮은 항을 1, 2, 3 → 1..7 로 넓혔다. `m_recommend.m:105` 와 다른, 의도한 변경이다. 이유와 측정값은 docstring 에 적었다. `m_recommend_details` 에 `global_terms`(=[1..7]) · `rule`(항 규칙 문장) 키를 덧붙였고, `method` · `warnings` 는 그대로다 | `helpers.py:recommended_terms` · `GLOBAL_TERMS` · `M_RECOMMEND_RULE` · `m_recommend_details` · `m_recommend`(docstring) | 정사각관 4×4×0.1, L=400, m_recommend 항(21 항), 오일러 닫힌 해 대비: C-C 1.034 → 1.017, C-F 1.007 → 1.006, C-G 1.026 → 1.012, S-C 1.127 → 1.063. 립 C(이 파일, L=100)는 뒤틀림 묶음이 이미 1..7 이라 항이 같다(14 항) | `test_R1_01_euler_tube_all_bc_converges_with_terms`: 상한을 C-C 1.02 · C-F 1.008 · C-G 1.015 · S-C 1.07 로 좁혔다. MATLAB 의 1..3 규칙이면 C-C · C-G · S-C 가, m=[1] 이면 네 BC 모두가 이 상한을 넘는다. `test_R1_01_recommended_terms_lcrd_typo`, `test_R1_01_m_recommend_*` 는 1..7 포함을 본다 |
| 항 부족 진단의 빠른 판정을 "{1,2,3} 이 없으면" → "1..7 중 하나라도 없으면"으로 바꿨다 | `fsm_solver.py:_longitudinal_term_diagnostics` | m=1..15 같은 사용자 항은 그대로 통과한다. 1..3 만 있고 4..7 이 없는 항은 이제 경고다 | `test_R1_01_non_ss_single_term_warns` |
| `INSUFFICIENT_LONGITUDINAL_TERMS` 메시지 끝에 한 문장을 붙였다: "권장 항으로도 S-S 가 아닌 곡선의 긴 길이(전체좌굴) 값은 수 % 의 급수 절단 오차가 높은 쪽으로 남으므로 Pcre/Mcre 로 쓰지 않는다(닫힌 해를 쓴다)" (`_NON_SS_GLOBAL_NOTE`). `m_recommend` · `recommended_terms` docstring 에도 같은 뜻을 적었다 | `fsm_solver.py` | 메시지 문장만 바뀜 | — |

## 후속 — 다른 곳이 따라와야 하는 것

### `python/server.py` · TypeScript 호스트 (다음 묶음, R8 영역)

1. **S-S 가 아닌 BC 의 종방향 항.** 기본값은 다음 네 곳이 BC 와 상관없이 `[1]` 로 만든다: `src/webview/StcfsdPanel.ts:192`, `:1076`(set_lengths), `:2123`, `webview/js/app.js:2423`. `set_bc`(`StcfsdPanel.ts:1044-1050`)는 BC 만 바꾼다.
   - 할 일: BC ≠ 'S-S' 이고 사용자가 항을 직접 정하지 않았으면 `engine.helpers.m_recommend(prop, node, elem, lengths)` 를 불러 그 결과를 `m_all` 로 보낸다.
     - 인자: `prop` (nmats,6), `node` (nnodes,8, **해석할 응력 분포가 들어간 상태**), `elem` (nelems,5), `lengths` (물리 부재 길이 배열).
     - 반환: `list[np.ndarray]`. 길이마다 정렬된 양의 정수 항이다. JSON 으로는 `[m.tolist() for m in ...]`.
     - Lcrl · Lcrd · 판정 방법 · 경고까지 보여 주려면 `m_recommend_details(...)` 를 쓴다. 반환은 `{'m_all', 'Lcrl', 'Lcrd', 'method': 'signature'|'cfsm'|'signature_fallback'|'no_minimum', 'minima', 'extra_lengths', 'cfsm_check', 'warnings'}` 이다. (V1 뒤) 극소가 없어도 `ValueError` 를 내지 않는다. 이때 `Lcrl` · `Lcrd` 는 `None`(JSON null)이고 항은 1..7 이다. `warnings` 는 화면에 보여야 한다.
     - (결정 반영) 권장 항에는 언제나 1..7 이 들어간다. 새 키 `global_terms` · `rule` 을 화면 · MCP 에 그대로 보여도 된다. 권장 항으로 푼 S-S 가 아닌 곡선의 긴 길이 값을 Pcre · Mcre 로 쓰지 않게 한다(경고 문장에 적혀 있다).
     - **`stripmain` 에 결과를 넘긴다(W1).** `m_all='auto'` 로 이 dict(`det`)를 구했으면 `stripmain(..., m_all=det['m_all'], half_wavelengths=det)` 로 부른다(`python/server.py` `_m_analyze` ≈ :326, `_resolve_m_all` ≈ :211 이 `det` 를 돌려주게). 그러면 `INSUFFICIENT_LONGITUDINAL_TERMS` 진단이 서명 곡선을 다시 풀지 않는다. 넘기지 않아도 같은 (prop, node, elem) 은 `characteristic_half_wavelengths` 의 캐시(16 개)에서 나오므로 두 번 풀지는 않는다. `fcfsm` 등 다른 경로도 같다.
   - 가장 단순한 길은 `server.py` 에 RPC `m_recommend`(params: prop · node · elem · lengths → result: 위 dict, `m_all` 은 list of list)를 더하고, 호스트가 BC · 길이 · 단면 · 응력이 바뀔 때 다시 부르는 것이다. 응력 분포가 바뀌면(P ↔ M) 반파장도 바뀐다.
   - 이 묶음의 엔진은 m_all 을 바꾸지 않는다. 대신 m=[1] 등에 `warning` / `INSUFFICIENT_LONGITUDINAL_TERMS` 를 낸다.
2. **`analyze` 에서 `m_all` 이 빠지면** 지금은 `ValueError("m_all must give one array … use engine.helpers.m_recommend …")` 가 `{'error': …}` 로 돌아간다(전에는 IndexError). 서버가 빠진 m_all 을 BC 에 따라 `[1]`(S-S) 또는 `m_recommend` 로 채울지 정한다.
3. **새 진단 코드.** `diagnostics` 의 `severity` 는 `info` · `warning` · `error` 이다. `success` 는 지금처럼 `error` 만 본다.
   - `INSUFFICIENT_LONGITUDINAL_TERMS` (warning, `missing_terms` 가 붙을 수 있음)
   - `ILL_CONDITIONED` (warning 또는 error, `error_estimate`)
   - `LONGITUDINAL_TERMS_SORTED` (info)
   - (V1 뒤) `CFSM_GLOBAL_ONLY` (warning) — cFSM 구속을 G 공간만으로 풀었다. 값은 고전 × 1/(1−ν²)(+9.9 %)이므로 Pcre · Mcre 로 쓰면 안 된다.
   - (V1 뒤) `CFSM_MODEL_NOT_SUPPORTED` (warning, `cfsm_code`) — 고전 cFSM 밖 모델(둥근 모서리 · 가지)의 구속 해석이다.

   `StcfsdPanel.ts:676-684` `_requireSuccessfulAnalysis` 는 실패일 때만 메시지를 보이므로 warning 은 화면 · MCP 에 나타나지 않는다. 경고를 띄워야 한다.
4. **`ILL_CONDITIONED` error 의 처리.** 긴 쪽 몇 길이가 `error` 가 되면 해석 전체가 `success=False` 가 된다. W1 의 `server.py:_drop_discarded_lengths` 가 그 길이를 곡선에서 빼고 있다. (V1 뒤) 폐기 경계가 0.25 → 0.1 로 바뀌었다(추정이 대각 스케일이라 덜 비관적이므로). 호스트 범위(≤ 1000 in) 안에서 폐기가 나는 것은 시험한 단면 중 지름 1 in · t 0.035 CHS 의 L ≈ 1000 뿐이다(흔들림 2 %).
5. **`signature_ss` RPC** (`server.py:181-187`): 결과에 `diagnostics` 키가 덧붙었다. RPC 응답에도 실어야 0 행(폐기된 길이)의 까닭을 알 수 있다.
6. **MCP `set_springs`:** 스프링 행은 10 열이어야 하고 절점 번호는 범위 안이어야 한다. 아니면 이제 `ValueError` 가 난다(전에는 조용히 무시하거나 알아보기 힘든 예외). MCP 스키마 설명에 적는다.

### 다른 담당

- **F2 (`python/models/data.py`)**: `CufsmResult.m_all` 필드와 `to_dict()['m_all']` 이 이제 있다(F2 가 처리함). `stripmain` 은 그 필드에 정리한 항을 넣는다.
- **F3 (`cfsm/classify.py`)**: 이제 `stripmain` 의 shapes 가 `msort` 순서이므로 classify 의 자체 정렬과 맞는다. `result.m_all` 을 그대로 받아 써도 된다.
- **F3 (`vibration/solver.py`, `fcfsm/solver.py`)**: `assemble` · `spring_assemble` 에 `np.zeros((ndof, ndof))` 를 넘기면 빠른 경로를 탄다(결과는 비트 단위로 같음). lil 을 넘기면 지금처럼 느린 경로다. 또 `BC_I1_5` 는 이제 모르는 BC 에 `ValueError` 를 낸다(전에는 0 → 원인 모를 실패).
- **F3 (`test_review_1122_cfsm.py::test_R3_02_…`)**: 첫 전체 실행에서 진동 S-S 5.777 vs 5.712 로 실패했고, 두 번째에는 통과했다. vibration 은 lil 경로라 F1 변경과 무관하다.
- **F5 (`engine/dsm.py`)**: `ILL_CONDITIONED` error 길이는 `[a, 0.0]` 행으로 온다. 지금처럼 lf ≤ 0 행을 건너뛰면 되지만, 국부 극소 근처가 빠지면 Pcrl 이 과대가 될 수 있다는 R1 메모(`dsm.py:110`)는 그대로 남는다.
- **F4 (`design/aisi_s100.py:2347-2370`)**: 항복 모멘트를 `helpers.firstyield(..., unsymm=1)` 또는 `yieldMP(..., unsymm=1)` 로 구하면 `stresgen(unsymm=1)` 휨 응력장과 기준이 맞는다(R1 메모, FIXES §4.2). Z형강에서 차이를 시험으로 확인했다.

## 사용자 결정 필요

1. **긴 길이 결과의 처리와 경계값.** (V1 뒤) 경고 1e-2 · 폐기 0.1 이고, 대각 스케일 반올림 오차 추정치 기준이다. 추정은 실측 흔들림의 1.2 – 5 배다. 경고 · 폐기가 시작되는 길이는 「V1 검증 뒤 고친 것」의 표에 있다.
   - 선택지 (a) 지금처럼 폐기 길이를 `error` 로 두고 해석 전체를 실패로 본다(가장 보수적).
   - 선택지 (b) 폐기 길이만 곡선에서 빼고 전체는 성공 + 경고로 둔다(호스트 쪽 변경).
   - 선택지 (c) 경계값을 바꾼다.

   엔진 쪽은 (a) 로 구현했다. 호스트 쪽(W1)은 (b) 처럼 폐기 길이를 빼고 있다.
2. **(V1 뒤) m_recommend 의 낮은 항 — 결정됨: 넓힌다(반영함).** CUFSM `m_recommend` 는 전체좌굴용 낮은 항으로 1..3 만 넣어 S-S 가 아닌 BC 의 전체좌굴이 덜 수렴한다(정사각관 L=400 오일러 대비 C-C 1.034, C-G 1.026, S-C 1.127, C-F 1.007). 코디네이터 결정으로 `recommended_terms` 가 언제나 1..7 을 넣는다(`helpers.GLOBAL_TERMS`). 결과는 C-C 1.017, C-G 1.012, S-C 1.063, C-F 1.006 이다. 항을 더하기만 하므로 MATLAB 보다 비안전측이 될 수 없다. 이 항으로도 긴 길이의 S-S 가 아닌 곡선 값은 수 % 높게 남으므로 Pcre · Mcre 로 쓰지 않는다(설계 경로는 닫힌 해). 아래 「낮은 항 1..7 로 넓힘」 참고.

## 못 한 것

- MATLAB 실행 비교: MATLAB 이 없다. 닫힌 해와 수정 전 Python 솔버(사본)로 대신했다.
- `vectorized.py`: 호출자가 없다. 이름과 달리 벡터화되어 있지 않다(스칼라와 같은 이중 루프). 지우지 않았다. 실제 벡터화 조립은 `assembly.element_dofs` 로 대신했다.
- `helpers.add_corner` · `stress_to_action`: 호출자가 없어 수치 검증을 하지 않았다.
- `doubler` 의 원본과 다른 점(새 절점 DOF 플래그 `[1,1,1,1]`, 번호를 끝에 덧붙임)은 R1 의 판단대로 그대로 두었다. 스프링 · 구속 번호가 유지되는 장점이 있다.
- 대규모 모델(ndof ≫ 5000): dense 행렬과 `eigvalsh`(조건수 추정)의 O(n³) 비용을 실측하지 않았다. 21 절점 × 14 항(1176 DOF)은 길이 하나에 약 0.9 s 다.
