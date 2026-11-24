# V1 — FSM 코어 · 단면 생성/성질 · cFSM/진동/소성 독립 검증 (F1 · F2 · F3)

검증 대상: 작업 폴더의 미커밋 변경(`git diff HEAD`) 중 F1(`python/engine/` fsm_solver · assembly · boundary · helpers), F2(template · cfs_centerline · properties · cutwp · `models/data.py` · `Example/cfs_centerline.py`), F3(`python/cfsm/` · `fcfsm/` · `vibration/` · `plastic/`).
방법: 수정 전 코드는 `git archive HEAD python` 으로 스크래치에 풀어(작업 폴더 · 인덱스 불변) 같은 메시 · 같은 입력으로 옛/새 솔버를 따로 돌려 비교했다. 리뷰어 스크립트(R1 · R2 · R3)를 경로만 바꿔 옛/새 양쪽에서 다시 돌렸다. 스크립트 · 결과는 전부 `C:\Users\USER\AppData\Local\Temp\claude\3df7e1c8eb560f18\99d094e4-961f-4f09-9be9-02ec03b2e201\scratchpad\verify\V1\` 아래(`h\` = 내 스크립트, `rs\` = 리뷰어 스크립트 사본, `out\old|new\` = 그 출력, `old\python\` = HEAD 코드).

## 요약

- **고친 것의 대부분은 맞다.** 대칭 정부호 고유치 풀이(`eigh(Kg, K)`)는 옛 QZ 와 같은 고유치 · 같은 모드를 낸다: 21 단면 × 압축/휨 × 호스트 기본(1–1000 in, 50 점) · GUI 기본(0.394–393.7 in, 60 점) 길이, 그리고 인장 지배 · 순수 인장 · 혼합 부호 응력, 스프링 3 종, 절점 고정, C-C · S-C · C-F · C-G 다항(m = 1..8), 스프링 + 다항, cFSM 전 공간 구속 — 모두 상대차 ≤ 2.6e-7, 1차 모드 |cos| = 1.000000. 다른 것은 기록된 수정(master_slave, GBTConfig 기본) 뿐이다.
- 조립은 비트 단위로 같고(리뷰어 `c4_vec`, F1 시험), 판 k = 4.000 / 23.88, 오일러 BC 별 비, I형강 LTB, 립 C FT, 스프링 닫힌 해 등 리뷰어가 확인한 수치는 옛 코드와 소수 5 자리까지 같다.
- 결함 5 건(P2 2 · P3 3). **P0 · P1 없음.** 가장 중요한 것은 **V1-01**: 반올림 오차 추정의 조건수 항이 강체에 가까운 스프링(≥ 1e12)에서 정확한 결과를 `error` 로 버려 해석 전체가 `success=False` 가 된다. 대각 스케일한 조건수로 바꾸면 실제 흔들림을 2–4 배 안으로 따라가고 긴 길이 판정은 그대로 남는다(근거 · 수정안 아래).
- 시험은 대체로 정직하다(AISI 표 인쇄값, 닫힌 해, 시험 안 독립 적분기). 약한 시험 3 건과 시간 기반 시험 1 건(부하에서 실패 재현)을 적는다.
- 호출자가 따라와야 할 계약 변화가 여럿 있다 — 특히 MCP `set_section_template` 의 chs 는 이제 **항상 오류**(`D: D || 1`), GUI/호스트의 S-S 아닌 BC 는 여전히 `m=[1]` 로 비보수(엔진은 경고만), `ILL_CONDITIONED` · `INSUFFICIENT_LONGITUDINAL_TERMS` 경고가 화면에 안 보임.

## 결함

### V1-01 [P2] 반올림 오차 추정이 강한 스프링에서 정확한 결과를 버린다

- **위치**: `python/engine/fsm_solver.py:_rounding_error_estimate` (cond 항 `eps·λmax(K)/λmin(K)`), 판정 `ILL_COND_ERROR = 0.25`.
- **현상**: 접지 스프링 kw(ku = kw)가 1e12 이상이면 보통 길이에서 `ILL_CONDITIONED` 가 나고, 결과가 정확한데도 `error` 로 0 행이 되어 `success=False` → TS 가 해석 전체를 예외로 처리한다. 스프링 큰 값으로 "고정"을 흉내내는 것은 흔한 사용법이다.
- **근거** (`h\springs_cond.py`, `h\scaled_cond.py`; 립 C 9×5×1×0.1 r=0, 절점 1 에 접지 스프링, S-S, m=[1])

  | kw | L | 새 lf (진단) | 옛 lf(QZ) | 추정(현재) | 대각 스케일 추정 | 실제 흔들림* |
  |---|---|---|---|---|---|---|
  | 1e10 | 300 | 59.0899 (없음) | 59.0897 | 3.6e-3 | 2.9e-9 | 1.8e-9 |
  | 1e12 | 100 | 76.7993 (warning) | 76.669 | 4.2e-2 | 7.3e-10 | 4.0e-10 |
  | 1e12 | 300 | **0 (error, 버림)** | 59.1446 | 0.36 | 2.9e-9 | 1.8e-9 |
  | 1e14 | 100 | **0 (error)** | 77.97 | 4.2 | 7.3e-10 | 4.0e-10 |
  | 1e14 | 300 | **0 (error)** | 75.60 (+28 % 틀림) | 36 | 2.9e-9 | 1.8e-9 |

  *같은 K 에 DOF 순열 + 성분별 ±eps 섭동 6 회를 주고 `eigh` 1차 고유치의 (max−min)/median. 정답(스프링 1e6–1e10 극한)은 76.7993 · 59.0899.
  새 `eigh`(Cholesky) 풀이는 이 경우 정확하다 — 큰 값은 대각에만 있어 대각 스케일로 없어지는 조건수다(van der Sluis). 옛 QZ 는 1e14 에서 실제로 28 % 틀렸으므로 "QZ 경로의 위험"으로는 맞는 추정이지만, 새 경로에는 지나치게 비관적이다.
  같은 비교에서 긴 길이 판정은 스케일해도 유지된다: 둥근 모서리 립 C(r=0.1875) L=5000 추정 0.24 → 스케일 0.12, 실제 5.0e-2; L=1e4 추정 2.6 → 스케일 음수(정부호 아님), 실제 0.96. 예리한 립 C L=1e4 0.047 → 0.013, 실제 4.9e-3.
- **수정안**: cond 항과 mode 항을 대각 스케일한 행렬로 계산한다. `d = 1/sqrt(diag(Ks))`, `Kd = d[:,None]*Ks*d[None,:]`, `ev_d = eigvalsh(Kd)` 로 `cond_term = eps·ev_d[-1]/ev_d[0]`(ev_d[0] ≤ 0 이면 inf), mode 항은 `y = x/d` 로 `eps·‖Kd‖·‖y‖²/|yᵀKd y|`. 경계값(1e-2 / 0.25)은 그대로 두면 실제 오차 대비 여유가 2–4 배 → 4–10 배였던 것이 줄 뿐 안전 쪽이다. QZ 대체 경로(정부호 아님, 0 행)에서는 지금 식을 그대로 쓴다. 시험: 위 표의 kw=1e12 · 1e14 가 경고 · 오류 없이 76.7993 / 59.0899(±1e-6), 기존 `test_R1_03_*` 두 개는 그대로 통과해야 한다.

### V1-02 [P2] `GBTConfig()` 기본값 변경이 선택 벡터를 준 구속 해석의 뜻을 바꾼다 (계약 §3.2)

- **위치**: `python/models/data.py:GBTConfig` (`orth 1 → 2`, `norm 0 → 1`, `from_dict` 의 빠진 키 기본도).
- **현상**: `GBTConfig(glob=…, dist=…, local=…, other=…)` 처럼 orth/norm 을 주지 않고 **개별 모드**를 고르면 기저가 자연 → 모달로 바뀌어 같은 색인이 다른 모드가 된다. 기록은 "전체 공간 선택은 같은 공간"이라고만 적었다.
- **근거** (`h\cases.py`, 예리한 립 C 압축 L=200, glob=[0,1,0,0] 만): 옛 109.508 → 새 27.222. 전체 공간 G · D · L · GD 선택은 orth/norm 과 무관하게 옛 값과 1e-8 안에서 같다(같은 파일). 리뷰어 시험 `test_R3_01_sharp_lipped_z_real_modes_locks_rotT` 가 이 이유로 실패했고 시험 쪽에 `orth=1, norm=0` 을 넣어 고쳤다(F2 기록).
- **지금 영향**: 생산 호출자는 영향 없음 — TS 모델 기본(`src/models/types.ts:100-103`)과 MCP `set_gbtcon`(`src/webview/StcfsdPanel.ts:2444-2453`)이 orth/norm 을 늘 명시해 보내고, `fileio/mat_loader.py:85-94` 도 빠진 키에 옛 값(1/0)을 쓴다. 그러나 (a) `from_dict` 에 orth/norm 없이 선택 벡터를 보내는 새 호출자(다음 묶음의 MCP · 데스크톱), (b) `mat_loader` 와 `from_dict` 의 기본이 이제 서로 다르다(같은 .mat 내용을 JSON 으로 옮기면 기저가 바뀜).
- **수정안**: 기본 변경을 유지하려면 `fsm_solver.stripmain` 의 cFSM 구속 경로에서 GBTcon 이 활성이고 개별 모드 선택(어느 클래스 벡터가 0 과 1 을 섞음)일 때 `settings`(orth/norm/couple/ospace)를 진단 `info` 로 남기고, `mat_loader` 의 빠진 키 기본을 `GBTConfig` 와 같게(2/1) 하거나 명시적으로 "CUFSM .mat 에 orth 가 없으면 1" 이라는 근거를 주석으로 남긴다. MCP 스키마 설명(`src/mcp/server.ts:746-748` "default 0"/"default 1")은 엔진 기본과 다르므로 다음 묶음에서 맞춘다.

### V1-03 [P3] cFSM 결합 기저(couple=2)의 `ospace` 번호를 MATLAB 과 다르게 바꿨다

- **위치**: `python/cfsm/base_vectors.py:base_update` 결합 분기.
- **현상**: MATLAB `base_update.m:247-270` 결합 분기는 3 = K, 4 = Kg, 5 = 벡터(2 는 아무것도 하지 않음)다. F3 는 이를 비결합 · 문서 번호(2 = K, 3 = Kg, 4 = 벡터)로 바꿨다 — 기록에 "뜻이 바뀜" 으로 적혀 있다. 근거(MATLAB 쪽이 번호가 밀린 결함)는 그럴듯하지만, 수정 전 Python 은 MATLAB 과 같았으므로 이것은 **있는 인자의 뜻을 바꾼 것**이고, CUFSM 에서 저장한 couple=2 · ospace=3/4 모델은 이제 다른 O 공간으로 풀린다.
- **수정안**: 값은 그대로 두더라도 `mat_loader` 로 읽은 모델(couple=2)에서는 MATLAB 번호를 문서 번호로 옮기는 변환(3→2, 4→3, 5→4)을 넣거나, 결합 분기에서 MATLAB 번호를 받는 플래그를 둔다. 최소한 MCP `set_gbtcon` 설명에 couple=2 의 번호 차이를 적는다. 사용 빈도가 낮아 P3.

### V1-04 [P3] F1 기록의 "L ≤ 1000 은 어느 단면도 경고가 없다" 는 얇고 작은 단면에서 틀리다

- **위치**: `docs/reviews/20261122-engine-review/fixes/F1-fsm-core.md` R1-03 행, `ILL_COND_WARN = 1e-2`.
- **근거** (`h\extreme_len.py`, S-S, m=[1], 압축): 18 mil(t = 0.0188) 362 립 C r=0.0283: L=1000 경고(추정 0.012), nseg=4 이면 L=1000 경고 0.031 · L=2000 오류. 18 mil 162 트랙: L=1000 경고 0.065, L=2000 오류. 1×1×0.0188 앵글: L=600 경고 0.024, L=1000 경고 0.19. CHS OD 1.0 t 0.035(96 현): L=600 경고 0.014, L=1000 경고 0.11 — 이때 값 0.0338 은 닫힌 해 π²E(r²)/L² = 0.03389 와 0.3 % 안이다. 템플릿 21 개 · 기본 치수에서는 호스트(≤ 1000 in) · GUI(≤ 393.7 in) 범위에서 진단 0 건(`h\new_ss.json`). 오류(결과 폐기)는 어느 경우에도 1000 in 안에서 나지 않았다.
- **영향**: 지금은 경고가 화면에 나오지 않는다(F1 후속 3). 다음 묶음에서 경고를 띄우면 1000 in 끝에서 정확한 값에 "부정확할 수 있음" 이 붙는다. V1-01 의 스케일 추정으로 바꾸면 대부분 사라진다.
- **수정안**: 기록을 정정하고(얇은 단면 · 작은 단면은 600–1000 in 에서 경고), V1-01 과 함께 처리.

### V1-05 [P3] `m_recommend` 의 cFSM 분기가 둥근 모서리 단면에서 물리적이지 않은 Lcrl · Lcrd 를 쓴다

- **위치**: `python/engine/helpers.py:characteristic_half_wavelengths` (서명 곡선 극소가 2 개가 아닐 때의 cFSM 국부 · 뒤틀림 서명 곡선).
- **현상**: F3 가 정한 대로 고전 cFSM 의 L/D 공간은 둥근 모서리 모델에서 물리적 모드가 아니다(R3-01). 그런데 `m_recommend` 는 그 공간의 서명 곡선 극소로 반파장을 정한다. GUI 기본 템플릿은 r = 0.09055 in 이라 이 분기를 자주 탄다. F1 기록의 "둥근 모서리 립 C형강은 `signature`" 는 단면에 따라 다르다(8×2.5×0.625×0.059 r=0.1875 는 `cfsm`).
- **근거**: 위 표. 립 C 8×2.5 r=0.1875 압축: Lcrd 5.31(r=0 모델 27.0). 12×3.5×0.0346: Lcrl = Lcrd = 7.53, 실제 서명 극소 9.34. 8×3.5×0.4×0.1 r=0.2 휨: Lcrl 1.97(국부 반파장은 약 4.5). 그 결과 a/Lcrd_true 근처(뒤틀림) 또는 a/Lcrl_true 근처(국부) 항이 빠진다. 시험한 경우에는 지배 모드 쪽 항이 남아 있어 1차 하중계수 과대가 0.6 % 이하였지만 보장은 없다. MATLAB 원본도 같게 동작한다(이식 결함은 아님).
- **수정안**: `cfsm.node_utils.check_cfsm_model(node, elem)` 이 지원 밖(ROUNDED_CORNER · CLOSED · BRANCHED)이면 cFSM 분기를 쓰지 않고 `signature_fallback` 으로 가거나, cFSM 값과 서명 곡선 극소 값 양쪽의 항을 합집합으로 넣는다(항을 더하는 쪽은 비보수가 될 수 없다). 또 서명 곡선 극소가 하나도 없는 단면(예리한 앵글 · 티 압축)에서 `ValueError` 를 내므로 호스트가 받을 대체(예: 1..ceil(a/최소 요소폭)) 를 정해야 한다(아래 호출자 표).
- **곁가지(P3, 성능)**: `stripmain` 의 `_longitudinal_term_diagnostics` 가 S-S 아닌 BC · 항 ≥ 7 인 호출마다 이 서명 곡선 3 개(최대 300 번 풀이)를 다시 푼다 — 둥근 립 C 에서 약 3 s(부하 없을 때), 캐시 없음.

## 맞다고 확인한 수정

수치는 옛(HEAD) → 새. 근거 스크립트는 `h\`(내 것) · `rs\`(리뷰어 사본)와 그 출력 `out\`.

**F1**
- R1-04 조립 · 고유치 풀이: 같은 메시 21 종(립 C 5 · 립 Z 2 · 트랙 2 · 햇 · RHS 2 · CHS 3 · 앵글 2 · I 2 · T · 립 앵글) × 압축/휨 × 호스트 · GUI 길이, `h\compare.py ss` 결과는 아래 「옛/새 비교」. 표적 경우(`h\cases.py`, 예리한 · 둥근 립 C): 인장 지배(σ = −1 + 1.3 z/zmax), 순수 인장(둘 다 `NO_POSITIVE_EIGENVALUE`), 플랜지 혼합 부호, 접지 · 이산 · 두 절점 스프링, 절점 고정(BCFlag 경로), C-C · S-C · C-F · C-G m=1..8, C-C 휨, C-C + 이산 스프링 m=1..6, cFSM G · D · L · GD 구속(orth 1/2) — 1–3 차 고유치 최대 상대차 2.6e-7, 1차 모드 |cos| 1.000000. μ = 1/λ 의 큰 순서 = 양의 λ 작은 순서, Kg 영공간(μ = 0)과 음의 λ 는 `mu > 0` 으로 빠지는 것을 코드로 확인. 정부호가 아니면(외톨이 절점) QZ 로 돌아간다. 시간: 리뷰어 `c6_robust` 50 길이 8.27 s → 0.19 s, C-C m=1..10 16.0 s → 0.63 s; `c2c_defaultm` 14 항 28–37 s → 1 s, 값 동일.
- R1-01 `m_recommend` 이식: `m_recommend.m` 과 줄 단위 대조. 극소 판정(`load2<load1 & load2<=load3`), 극소 2 개 → (Lcrl, Lcrd), 아니면 cFSM 국부 · 뒤틀림 서명 곡선(ospace 1, couple 1, orth 1), 항 묶음(`ceil>4` 이면 c−3…c+3, 아니면 1..7, + 1,2,3, msort). Lcrl → Lcrd 오타 수정은 항의 상위집합이라 비보수가 될 수 없다는 판단에 동의. cFSM 분기의 공유 카운터 `cr` 결함을 피한 것도 맞다. 리뷰어 `c2c_defaultm` 의 14 항 결과(C-C 15.1064 등)가 새 코드와 같다. 템플릿 전반 동작은 「옛/새 비교」의 m_recommend 줄.
- R1-02 msort: `[1,1]` 892.22 → 26.178, `[0,1]` 실패 → 26.178, `[2,1]` = `[1,2]`(리뷰어 `c6_robust` 재실행).
- R1-05 `signature_ss` import · R1-06 스프링 1 차원 (26.178 → 26.530, 스프링이 반영됨) · R1-08 입력 검사(`c6_robust` 의 IndexError · 조용한 잘림 · L=−10 · m=1.5 · 's-s' 가 모두 명시적 ValueError): 재실행으로 확인.
- R1-07 `master_slave`: 새 5 행(u_s = u_m + uq·θ_m, w_s = w_m + wq·θ_m, θ_s = θ_m, v 자유)이 강체 연결로 물리적으로 맞다. 다만 "master_slave.m 과 같다" 는 정확하지 않다 — MATLAB 은 7 열 행 3 개를 내고 `constr_user.m` 은 앞 5 열만 쓰므로 MATLAB 은 병진 항(`1.0 master 1/2`)을 버린다. Python 이 더 옳다. 표적 비교에서 립 끝 두 점을 묶은 경우 1차는 같고 2 · 3 차가 바뀐다(예리 L=30: 100.52 → 66.38 이 새 1차, 둥근 L=120 2차 46.12 → 15.42) — 수정으로 설명된다.
- R1-09 모드 부호 +1 정규화: 크기 · 고유치 불변(표적 비교 |cos| = 1).
- 원래 맞던 것: 판 k 4.00053/4.00001/4.00000, ψ 표, 23.8809(리뷰어 `c1_plate` 옛/새 출력 동일), 오일러 BC 별 비(`c2_euler` C-G m=15 1.00617 → 1.00618 외 동일), BC 적분 5.4e-14(`c2b_bcint` 동일), I LTB 1.0034–1.0040 · 립 C FT(`c3_global` 동일), 스프링 닫힌 해(`c5_springs` master_slave 줄 외 동일).

**F2**
- R2-01 custom 직선부 분할: 리뷰어 `t6_mesh_fsm` 국부 극소 비 custom/템플릿 1.240 → 1.000, 뒤틀림 1.022 → 1.000. 성질 불변.
- R2-02 · R2-14 outer_side · 외측 범위 검사: C 경로에 틀린 쪽을 주면 예전엔 H 9.059 · A +3 % 단면, 지금은 ValueError, 미지정(auto)은 템플릿과 같은 A · I(`h\props_cmp.py`).
- R2-03 립 앵글 세 코너: 4LS4x060 A 0.5235 → 0.5120 (표 0.512), I2 0.4197 → 0.3966 (0.397)(리뷰어 `t2_aisi`). 등변 대칭 Ixx = Izz 회복.
- R2-04 경사 립 setback (t/2)tan(γ/2): 8ZS2.25x059 γ=50 A −0.47 → −0.02 %, Iy −3.3 → −0.4 %, Ixy −1.8 → +0.07 %, Imin −2.7 → −0.14 %(`t2_aisi`). 립 앵글 qlip=50 은 lippedc 와 같은 규약(첫 립 270−q = 45° 선의 거울상)으로 대칭 — 기하로 확인.
- R2-09 isect/tee: 중심선 플랜지 폭 B(자유단), h = H − tf / H − tf/2, Cw = t·b³·h²/24 닫힌 해. tf/tw 분리.
- R2-10 · R2-15 CHS: 48 현, D=6 I −1.42 → −0.36 %, J −1.98 → −0.50 %(`t1_sharp`).
- R2-16 최외단 Sx: 요소 직사각형 모서리(절점 ± (t/2)·|법선 성분|) — 기울어진 요소 · 자유단 · 호 요소 모두 맞는 식. 800S200-54 1.6538 → 1.6421 (표 1.64), CHS D=2 Sx = I/(D/2) 정확.
- R2-12 퇴화 입력 거절, D=0 → 무립 단면(옛 hat D=0 은 허상 브림이 남아 W 4.20 → 3.94).
- R3-09 `is_active`(합 > 0), F1 후속 `CufsmResult.m_all`.

**F3**
- R2-06 · R2-07 · R2-08 셀 단면 `_cutwp_prop2`: RHS 의 Bredt J 10.805 가 요소 방향 · 순서와 무관(리뷰어 `t4_closed`), 균일 RHS Cw = b²h²t(b−h)²/(24(b+h)) (6×4×0.1 → 0.9004). **독립 확인**(`h\box_sc.py`): 4×6 상자, 왼쪽 벽 t=0.3, 전단흐름법(열린 흐름 + 폐합 보정 + 도심 모멘트)으로 Xs = 1.00008 vs 엔진 1.00000, J = Bredt 14.4. 이 상자는 ρ − ψ/t 가 모든 벽에서 0 이라 Cw = 0 이 정답이고 엔진도 0.0 이다. 열린 단면 J · Cw 는 옛 값과 1e-6 안(`h\props_cmp.py`, 앵글 · 립 C r=0 등 동일).
- R3-02 진동 v 질량 I5: `mlocal.m:45-46` 과 같다. 휨 질량은 Hermite 일관 질량(156/22/54/13/4/3·b/420)으로 맞고, MATLAB `mlocal.m:57` 의 `mf(2,1)=11*t*(b^2)…` 여분 t 를 따르지 않은 것도 옳다.
- R3-03 강재 질량밀도 0.2836/386.09/1000 = 7.345e-7 kip·s²/in⁴ 맞음.
- R3-04 부절점 판정(단위벡터 외적, 1e-6): 분기점 없음 확인.
- R3-01 둥근 모서리 판정 규칙: 템플릿 r>0 은 모두 걸리고 r=0 은 안 걸림(경사 립 r=0, qlip 50 포함 — 립 · 플랜지가 요소 2 개 이상이라 꺾임 절점이 이웃하지 않음). 한 요소 모따기(45°) 같은 사용자 메시는 걸린다 — 휴리스틱으로 가는 안전 쪽.
- R3-11 소성 두께 방향 파이버: 중심선 법선 방향 오프셋, 면적 (L/n)(t/NL) — 평판 약축 Mp = bt²Fy/4 정확(짝수 NL 중점 규칙). R3-17 목표 P 중립축: 누적 면적 · 걸친 묶음 분할이 맞다.
- cFSM 기저 차원 · 역학, `rot.T`: 리뷰어 `check1_basis` · `check2_rotT` 재실행 결과는 「확인하지 못한 것」 참고.

## 옛/새 비교 (같은 메시, `h\compare.py`)

(아래 표는 `h\new_ss.json` · `h\old_ss.json` · `h\new_cases.json` · `h\old_cases.json` 비교 결과)

**S-S, m=[1], neigs=10, 21 단면 × 압축/휨, 호스트(1–1000 in, 50 점) · GUI(0.394–393.7 in, 60 점)** — `h\compare.py ss`

| 범위 | 1–3 차 하중계수 최대 상대차 (옛 QZ vs 새 eigh) | 진단 |
|---|---|---|
| GUI 기본 길이 전 단면 | ≤ 2.4e-5 | 양쪽 모두 0 건 |
| 호스트 기본 길이, L ≤ 500 in | ≤ 8e-5 | 0 건 |
| 호스트 기본 길이, L 650–1000 in (cond(K) 1e11–1e12) | ≤ 4.6e-4 (트랙 6×1.25×0.0346, L=655–869), 2.6e-4 (립 C nseg=2 휨 L=1000), 3.7e-4 (CHS 2×0.065 의 겹친 쌍 고유치) | 0 건 |

차이는 모두 긴 길이의 반올림 크기이고 부호가 섞여 있다(어느 쪽이 체계적으로 크지 않음). `h\scaled_cond.py` 의 섭동 실험에서 같은 조건의 실제 흔들림(5.6e-5 @ L=1000, 둥근 립 C)과 같은 크기다.

**표적 경우** — `h\compare.py cases` (`h\cases.py`, 예리한 · 둥근 립 C, L = 5 · 30 · 120)

| 경우 | 결과 |
|---|---|
| 압축 · 휨 · 인장 지배 · 순수 인장 · 플랜지 혼합 부호 | 최대 2.6e-8, 순수 인장은 둘 다 `NO_POSITIVE_EIGENVALUE` |
| 접지 · 이산 · 두 절점 스프링, 절점 고정 | ≤ 1.2e-8, 모드 cos 1.000000 |
| C-C · S-C · C-F · C-G m=1..8, C-C 휨, C-C + 이산 스프링 m=1..6 | ≤ 2.6e-7, 모드 cos 1.000000. 새 쪽에만 `INSUFFICIENT_LONGITUDINAL_TERMS` 경고(R1-01, 의도) |
| cFSM G · D · L · GD 전 공간(orth/norm 1/0 · 2/1 · 기본) | ≤ 1e-8 |
| 립 끝 두 점 `master_slave` | 1차 같음, 2·3 차 바뀜 — R1-07 로 설명 |
| `GBTConfig(glob=[0,1,0,0], …)` 기본 생성자 | 109.508 → 27.222 — R3-10 로 설명(V1-02) |

**단면 성질** — `h\props_cmp.py`, 템플릿 32 경우: 바뀐 것은 모두 기록된 수정이다(Sx/Sz 최외단 −0.6 – −2.5 %; lippedz/lippedc qlip=50 · lipped_angle · isect · tee · CHS 48 현 · hat/lippedc D=0 · RHS Cw). 앵글은 전부 같고, 립 C · 트랙 · 립 Z(q=90) · 햇 · RHS 는 Sx/Sz 외 같다. 새로 거절하는 입력: chs `{H 8, D 0.625}` · `{H 6, B 6, D 1}`(지름 모호), lippedc D 누락, isect nseg=0(예전 ZeroDivisionError), custom `outer_side='left'` 를 C 경로 반대쪽에 준 경우(예전 H 9.059 로 부푼 단면).

**m_recommend** — `h\mrec.py`, `h\mrec_round.py`, `h\mrec_dist.py`, `h\mrec_dist2.py` (C-C, 권장 항 vs m = 1..N 전부)

| 단면 (하중) | 판정 | Lcrl / Lcrd | C-C L 권장/전부 |
|---|---|---|---|
| 립 C 8×2.5×0.625×0.059 r=0.1875 (P) | cfsm | 4.84 / **5.31** | L=100 1.0008, L=200 1.0024 |
| 같은 단면 r=0 (P) | cfsm | 6.17 / 27.0 | 1.0004 / 1.0000 |
| 립 C 12×3.5×1×0.0346 r=0.0712 (P) | cfsm | 7.53 / **7.53** (서명 극소 9.34) | 1.0002 / **1.0062** |
| 립 C 6×1.625×0.5×0.0451 r=0.0712 (P) | cfsm | 4.0 / **3.62** | 1.0002 / 1.0027 |
| 립 C 8×3.5×0.4×0.1 r=0.2 (M, 뒤틀림 지배) | cfsm | **1.97** / 14.3 | L=120 1.0014 |
| 립 C 12×2×0.75×0.04 r=0.1 (P · M) | cfsm | 7.86/6.38 · 5.74/5.17 | 1.0008 · 1.0003 |
| 서명 극소 2 개인 단면(립 C r=0 · 둥근 일부, 립 Z, 정사각관 압축) | signature | 물리적 | ≤ 1.0013 |
| I · T 휨, 트랙 r=0, RHS, CHS | signature_fallback | Lcrl = Lcrd | — |
| 앵글 2×2×0.0346 r=0 (P), 티 8×6×0.1 (P) | **ValueError** (극소 없음) | — | — |

둥근 모서리 단면에서 cFSM 분기의 Lcrd 가 Lcrl 과 거의 같게 나온다(아래 V1-05). 시험한 경우의 오차는 0.6 % 이하다.

## 시험의 정직성

- 좋은 점: `test_review_1122_section.py` 는 AISI Manual Part I 표 인쇄값과 시험 안 독립 박벽 적분기(`_poly_props`, 각진 모서리 닫힌 해)를 쓴다. `test_review_1122_fsm.py` 의 판 · 오일러 · LTB · FT · 스프링 기대값은 시험 안 닫힌 해와 부채꼴 적분이다. `test_R2_01_custom_path_local_buckling_matches_template` 은 옛 동작(n_flat=1)이 +15 % 이상 틀렸다는 것까지 재현해 되돌림을 잡는다. `test_R3_01_sharp_lipped_z_real_modes_locks_rotT` 는 `rot.T` → `rot` 변이를 잡는다(F3 확인, 리뷰어 수치와 맞음).
- **약한 시험**
  1. `test_R1_03_garbage_at_long_length_never_success` — 길이마다 `error` 이면 아무것도 확인하지 않는다(세 길이 모두 폐기여도 통과). 적어도 한 길이는 숫자로 비교되도록(예: L=2e4 가 경고 이하로 남는 단면) 또는 "오류이거나 ±5 %" 를 명시적으로 세게.
  2. `test_R1_09_orphan_node_uses_fallback_solver` · `test_R1_04_multi_term_runtime` — 같은 코드의 두 실행 비교와 `lf > 0`. 앞의 것은 QZ 대체 경로가 "같다"만 보고 닫힌 해를 보지 않는다(QZ 경로와 eigh 경로가 함께 틀려도 통과). 뒤의 것은 수치 확인이 없다.
  3. `test_R1_01_euler_tube_all_bc_converges_with_terms` 는 항을 손으로 1..15 로 주므로 수정 전 코드에서도 통과한다(이식한 `m_recommend` 를 거치지 않음). m_recommend 의 수치 확인은 `test_R1_01_m_recommend_lipped_c_clamped_finds_local` 하나뿐이다 — 립 C 한 단면, `method='signature'` 경로만. `signature_fallback` · `cfsm` 경로(햇, I, 트랙)의 결과 항 검사가 없다.
- **시간 기반 시험**: `test_R1_04_multi_term_runtime`(`dt < 5 s`)은 이 검증 중 CPU 를 나눠 쓰자 실패했다(`pytest … test_review_1122_fsm.py …` → `1 failed, 91 passed in 219.70s`, 실패는 이 시험 하나). 게이트에서 다른 무거운 작업과 겹치면 거짓 실패가 난다. 한계를 넉넉히(예: 옛 19 s 의 절반) 하거나 조립 횟수 같은 결정적 지표로.
- **시험 없는 수정**: V1-01 의 스프링 경우(없음), R3-07 결합 ospace 번호 변경의 뜻(rank · 합 100 % 만 확인), `GBTConfig` 기본 변경이 개별 모드 선택 구속해에 주는 영향(V1-02 — 기본 객체가 꺼져 있다는 것만 확인), `centerline_envelope_excess` 의 거짓 거절(정상 경로가 거절되지 않는지 — 시그마 · 랙 · 햇 custom 경로).
- 되돌림 실험은 하지 않았다(작업 폴더를 바꾸지 않기 위해). 대신 각 시험의 기대값이 수정 전 코드의 출력과 다른지를 옛/새 출력으로 확인했다: R1-02 · 03 · 05 · 06 · 07 · 08, R2-01 · 03 · 04 · 09 · 10 · 12 · 15 · 16, R3-02 · 04 · 09 · 11 은 옛 출력이 기대값을 벗어나므로 되돌리면 실패한다.

## 호출자에 미치는 변화 (다음 묶음이 따라야 할 것)

| 변화 | 지금 보내는 것 → 결과 | 호출자 위치 |
|---|---|---|
| chs 지름 모호 → ValueError | MCP `{H, B, D: D \|\| 1, t}` → **언제나 오류**(D=H 를 주지 않는 한). 예전엔 1 in 관 | `src/mcp/server.ts:198-205` (`set_section_template`) — `OD: H` 를 보내거나 chs 일 때 `D: H` |
| | GUI 는 `params.D = params.H` 로 동작 | `webview/js/app.js:2199-2202` (그대로 됨) |
| | 설계 경로 기본 `{H 8, D 0.625}` → 오류 | `python/design/aisi_s100.py` `_auto_generate_props` (F4) |
| 립 단면 D 누락 · t ≤ 0 · nseg < 1 · qlip ∉ (0,180) · 코너보다 짧은 직선부 → ValueError | GUI 는 늘 H/B/D/t/r 을 보낸다(r 기본 0.09055). 짧은 플랜지 + 큰 r 은 이제 오류 | `webview/js/app.js:2185-2196` |
| custom 틀린 `outer_side` → ValueError(예전엔 부푼 단면) | MCP `outer_side \|\| 'left'` — 경로 방향에 따라 이제 오류. MCP 안내의 시그마 예제는 단일 'left' 로 오류 | `src/mcp/server.ts:210-283`, 안내문 `:311-323`, `:345-349`, `:387-423` |
| custom 결과에 `validation` · `warnings` 추가 | 서버가 node/elem 만 넘김 | `python/server.py` `generate_section` |
| `grosprop` 의 `Sx`/`Sz` = 최외단(−0.7 – −1.7 %), `Sx_cl`/`Sz_cl` 추가 | 설계 Sf · Mcre(`engine/dsm.py:298,329`)는 최외단, My 는 yieldMP(중심선) — DSM 에서 기준이 섞임 | F4 · F5 (`aisi_s100`, `dsm.py`) |
| `cutwp` RHS Cw 0 → b²h²t(b−h)²/(24(b+h)), 셀 전단중심 계산, 끊어진 · 다세포 모델 ValueError | 서버 `cutwp` 오류 응답, 설계 경로 Fcre 비틀림 항에 작은 Cw | `python/server.py` `cutwp`, `aisi_s100` |
| `stripmain` 입력 검사 ValueError: BC 철자, `len(m_all) ≠ len(lengths)`, m 비정수 · 음수, L ≤ 0, NaN 응력, neigs < 1, 스프링 10 열 · 절점 범위, 구속 DOF 코드 | TS 는 `lengths.map(() => [1])` 로 길이를 맞춰 보낸다. MCP `set_springs` 의 행 모양은 확인 필요 | `src/webview/StcfsdPanel.ts:192,1076,2123`, `webview/js/app.js:2423`, `src/mcp/server.ts` `set_springs` |
| `CufsmModel.from_dict`: node 정확히 8 열, elem 정확히 5 열 | (stripmain 은 ≥ 8 을 받는다 — 서로 다름) | `python/models/data.py` |
| S-S 아닌 BC + `m=[1]` → `INSUFFICIENT_LONGITUDINAL_TERMS` 경고만, 값은 여전히 비보수(C-C 립 C 75.68 vs 15.11) | GUI · MCP 는 BC 와 무관하게 `[1]` | 위 TS 네 곳 — `m_recommend` RPC 로 항을 고를 것(F1 후속 1) |
| `helpers.m_recommend` · `m_recommend_details` (새 함수) 는 서명 곡선 극소가 없으면 `ValueError` — 예리한 앵글 2×2 · 티 8×6 압축에서 실제로 남 | 호스트가 쓸 때 대체 항을 정해야 함 | 다음 묶음의 `m_recommend` RPC (F1 후속 1) |
| `ILL_CONDITIONED` error 길이 → `success=False` | 범위 안에서는 스프링 ≥ 1e12 에서만(V1-01) | `StcfsdPanel.ts:676-684` `_requireSuccessfulAnalysis` |
| 경고(`ILL_CONDITIONED` warning, `INSUFFICIENT_…`, `LONGITUDINAL_TERMS_SORTED`)가 화면 · MCP 에 안 나옴 | | 같은 곳 |
| `result.m_all`, `diagnostics`(signature_ss) 키 추가 | | `python/server.py` `analyze` · `signature_ss` |
| 모드형상 부호: 절댓값 최대 성분 +1 | 3D 모드 그림 부호만 | `webview/js/app.js:3104-3120` |
| `classify` NaN 행(둥근 모서리 · 폐단면 · 가지 · 끊어짐 · 외톨이), `CfsmClassification` | 서버 `[c.tolist()]` 는 유지해야 null 로 감. 화면 `renderClassifyCurve` 는 null 을 0 % 로 그림 | `python/server.py` `classify`, `webview/js/app.js:2982-3000` |
| `GBTConfig` 기본 orth 2 · norm 1 | TS 는 1/0 을 명시해 보내므로 지금은 무영향(V1-02) | `src/models/types.ts:100-103`, `StcfsdPanel.ts:2444-2453`, `src/mcp/server.ts:746-748`(설명 "default 0/1") |
| couple=2 의 ospace 번호 변경 | | V1-03 |
| 진동: `rho` 없으면 강재, 범위 밖 경고, `springs`/`constraints` 인자 | GUI/MCP 는 `rho: 1.0` 고정 → 경고 + 1/1167 배 진동수 그대로 | `StcfsdPanel.ts:1368, 2476`, `src/mcp/server.ts:693-695` |
| fcFSM: 고전 cFSM 분류, `is_fcfsm=False` 등 키 | | `python/server.py` `fcfsm` |
| 소성: 정의 안 되는 축은 정규화 NaN(→ null), `P_raw` 등 키 | | `python/server.py` `plastic` |
| hat H/B 뜻은 그대로(H = 상판 폭). 호스트는 H 를 깊이로 읽는다 | 설계 정보 · 하중 해석이 hat 의 깊이를 잘못 씀(사용자 결정 R2-11) | `StcfsdPanel.ts:1540,1556`, `app.js:3808-3811` |

## 미결 · 보류 항목에 대한 의견

- **R1-03 폐기 정책(사용자 결정)**: 엔진 (a) 전체 실패는 보수적이다. V1-01 을 고치면 GUI/호스트 기본 범위에서 폐기는 사실상 나지 않으므로 (a) 를 유지해도 사용성 문제가 작다. (b) 를 택하면 폐기 길이를 곡선에서 빼되 국부 극소 근처가 빠졌는지(Pcrl 과대) F5 가 함께 봐야 한다.
- **R1-09 일부 보류**(vectorized · add_corner · stress_to_action · doubler): 호출자가 없다는 근거에 동의.
- **R2-11 hat H/B(사용자 결정)**: 엔진 유지 + 이름 인자 추가에 동의. 다만 호스트 두 곳이 hat 의 깊이를 H 로 읽는 것은 지금도 틀린 값을 화면 · 하중에 내므로(엔진 밖) 다음 묶음 우선순위가 높다.
- **R2-20 단위 상수 보류**: 엔진 내부가 US 이고 GUI/MCP 가 바꿔 넣으므로 동의.
- **R3-05 fcFSM 이식 보류**: 결과를 fcFSM 으로 오인하지 못하게 한 것으로 충분.
- **R3-15 순수 G 구속해 경고 보류**: 동의하지 않는 쪽에 가깝다. F1 이 같은 묶음에 진단 하나(`stripmain` 에서 GBTcon 이 G 만 선택이면 `info`)를 넣을 수 있었다. 해가 1/(1−ν²) = 1.099 배 높은 것이 이론적 성질이라 P3 이지만, 사용자가 구속 G 해를 Pcre 로 쓰면 9.9 % 비보수다. 다음 묶음에 넣을 것.
- **F3 사용자 결정 1(가지 단면 NaN)**: 지금 NaN 이 안전 쪽. 동의.
- **F3 사용자 결정 2(폐단면 Cw)**: 값이 맞다(위 독립 확인). 설계에 넣어도 GJ 대비 무시할 크기라 그대로 두는 데 동의.

## 확인하지 못한 것

- MATLAB 실행 대조(MATLAB 없음). 대신 MATLAB 원본 줄 대조(m_recommend, master_slave + constr_user, mlocal, base_update 결합 분기)와 닫힌 해 · 옛 Python 을 썼다.
- 리뷰어 스크립트 재실행은 R1 9 개 · R2 9 개 · R3 check1 – check6 · check10 – 12 까지 비교했다(`out\old|new\`). 결과는 기록된 수정 외에 같다(R3 `check1_basis` rank · 역학 조건, `check2_rotT` 동일, `check3_classify` 는 기본 객체가 orth 2 가 된 것과 둥근 모서리 NaN 만, `check5_fcfsm` 은 고전 cFSM 분류 · 둥근 NaN, `check6_vib` 은 v 질량 I5 와 축 진동 10503.895 Hz = 닫힌 해). 옛 코드의 `check10*` 은 600 s 시간 제한에 걸렸다. `check7_plastic` · `check7b` 도 비교했다: Np = A·Fy 유지, I 단면(R2-09 로 bf 4.8 → 5.0) 강축 Mp 730.1 = Z·Fy, 약축 129.9 = Fy(2·tf·bf²/4 + h·tw²/4) = 50(2.5 + 0.098) — 두께 방향 웨브 항 포함으로 맞다(`h\plastic_I.py` 에서 t=0.1 · Fy=100 단면도 127.45 = 닫힌 해). 립 C 약축 P=0 Mp 160.02 → 161.6872(독립 파이버 적분과 같음), Z 주축 회전 Σ A x₁z₁ ≈ 1e-5. 평판 약축 정규화는 NaN(M22_y 정의 안 됨, R3-11 의도). `check8_robust` · `check8b_wrap` · `check9_dsm_contract` 도 비교했다: 폐단면 · 가지 단면 · 둥근 모서리 · 단일 평판이 NaN(예전: 오류 · 그럴듯한 숫자 · 25 %), couple=2 orth=1 이 rank 252 · 정상 분류(예전 25 %), C-C m=1..3 결합 ospace=3 이 broadcast 오류 → 동작, 잡음 1e-13 부절점 판정이 잡음 0 과 같음(nmno 9 → 6, 0 행 3 → 0), dsm 계약은 NaN 분류 → `single_minimum` · Pcrl 6.889(둥근) / 6.923(r=0) — 모두 기록된 수정과 같다. 단일 평판의 NaN(`CFSM_BASIS_SINGULAR`)은 예전 [0,0,100,0] 이 맞는 값이었으므로 정보 손실이지만 안전 쪽(P3, 기록됨). `check6b_vib_cc` 는 새 코드에서 600 s 제한에 걸렸는데, 부하 없이 다시 재니 RHS C-C L=200 m=1..10 이 새 38.0 s · 옛 36.5 s(f1 29.8108 vs 29.8230, I5 수정 차)로 같은 속도다 — 시간 초과는 동시 실행 부하 때문이다. 진동은 여전히 lil 조립이라 느리다(F1 후속: dense 배열을 넘기면 빠른 경로). R2 `t4_closed` · `t5_centerline` · `t7_misc` 와 R1 `c6b_long` 은 이제 거절되는 입력(지름 모호 chs, 틀린 outer_side, t=0, 비정부호 K 에 직접 eigh)에서 멈춘다 — 의도된 변화.
- `check10b_e2e` 의 새 출력에서 "label corrected" 열(9.07)은 스크립트가 Pcrl ↔ Pcrd 를 바꿔 넣는 방식이라 이제 뜻이 없다. 자동 경로 KL=100 Pn 9.99 는 리뷰어 보고서의 교정값 9.99 와 같다(R3-01 이 닫혔음). 자동 경로의 Pnd 는 여전히 12.76 으로, 국부로 라벨한 같은 극소(6.88 kips)를 뒤틀림에도 쓰는 것으로 보인다 — 보수 쪽이고 F4/F5 영역이라 더 보지 않았다.
- 대규모 모델(ndof ≫ 3000): dense K · Kg 와 조건수용 `eigvalsh`(길이마다 한 번 더) 의 메모리 · 시간. 조건수 추정이 고유치 풀이와 비슷한 비용을 한 번 더 쓴다(Cholesky 기반 추정으로 줄일 수 있음, P3).
- 되돌림 실험(작업 폴더를 바꿀 수 없어 옛 출력과 기대값 비교로 대신).
- custom 경로의 시그마 · 랙 단면 FSM 수렴(F2 도 못 함).
