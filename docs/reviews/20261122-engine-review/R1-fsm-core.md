# R1 — FSM 코어 (CUFSM MATLAB 이식부)

## 요약

발견사항 수: **P0 0 · P1 2 · P2 4 · P3 4** (총 10)

`klocal` · `kglocal` · `BC_I1_5` · `BC_I1_5_atpoint` · `trans` · `spring_*` · `assemble` · `stresgen` · `yieldMP` 를 MATLAB 원본과 한 줄씩 대조했다. 식, 인덱스(1 → 0), 블록 위치, 전치는 모두 원본과 같다. `BC_I1_5` 의 다섯 경계조건 적분은 m, n = 1..8 범위에서 가우스 구적과 1e-13 수준으로 일치했다. 닫힌 해 검증(판 좌굴계수, 오일러, 횡비틀림, 휨비틀림, 스프링, 구속)도 모두 0.5 % 안쪽으로 맞았다. 요소 수준의 이식 오류는 찾지 못했다.

틀린 결과는 요소 행렬이 아니라 그 바깥에서 나온다.
1. **일반 경계조건의 종방향 항 기본값** (R1-01). GUI · MCP 는 BC 와 상관없이 언제나 `m_all=[1]` 을 보낸다. 엔진에는 `m_recommend` 가 이식되어 있지 않다. 그래서 C-C · S-C · C-G · C-F 해석은 국부 · 뒤틀림 좌굴을 거의 놓친다. 물리 길이 100 in 립 C형강의 1차 하중계수가 최대 5배 과대로 나온다(비안전측).
2. **`msort` 누락** (R1-02). MATLAB `stripmain.m:82` 는 `msort` 로 m 항을 정리하지만 Python `stripmain` 은 정리하지 않는다. m 항이 중복되면 특이 행렬쌍이 되어 임의의 고유치를 `success=True` 로 돌려준다(34배 과대 또는 8배 과소).

그 밖에 다음 문제가 있다.
- 아주 긴 길이에서 조용히 수치가 무너진다(R1-03).
- 조립이 느려서 다항 해석을 실제로 쓸 수 없다(R1-04).
- `signature_ss` RPC 는 항상 ImportError 로 실패한다(R1-05).
- 1차원 `springs` 를 조용히 버린다(R1-06).
- 죽은 헬퍼 코드가 틀렸다(R1-07).
- 입력 검증이 없다(R1-08).
- 유지보수 문제가 있다(R1-09).
- 닫힌 해 회귀 시험이 하나도 없다(R1-10).

## 발견사항

### R1-01 [P1] [확인] 일반 경계조건(C-C · S-C · C-F · C-G)에서 종방향 항이 `[1]` 하나뿐 — 국부 · 뒤틀림 좌굴을 놓치고 전체좌굴도 과대
- 위치
  - 엔진: `python/engine/fsm_solver.py:63`. 호출자가 준 `m_all[length_idx]` 를 그대로 쓰고, 항 수가 충분한지 검사하지 않는다. `Ref_Source/helpers/m_recommend.m` 은 이식되지 않았다.
  - 기본값을 만드는 곳: `src/webview/StcfsdPanel.ts:192`, `:1076`(set_lengths), `:2123`, `webview/js/app.js:2423`. 모두 `lengths.map(() => [1])` 이다. `set_bc` 는 `StcfsdPanel.ts:1044-1050` 에서 BC 만 바꾸고 `m_all` 은 그대로 둔다.
  - `python/models/data.py:130`: `m_all` 이 없으면 `[]` 가 된다(R1-08 참조).
- 현상: S-S 가 아닌 경계조건에서 FSM 은 물리 부재 길이 a 하나에 대해 여러 종방향 항 m 을 겹쳐야 반파장이 짧은 국부 · 뒤틀림 모드를 표현한다. CUFSM 은 `m_recommend` 로 `ceil(a/Lcr)±3` 과 1..7 을 넣는다. 지금은 m=1 하나만 들어가므로 길이 a 전체가 반파 하나인 모드만 계산된다.
- 근거: 수치 재현
  - 길이 100 in 립 C형강 국부 · 뒤틀림 (`scratchpad/review/R1/c2c_defaultm.py`). 단면은 H6 × B2.5 × D0.75 × t0.06, 균일압축 1 ksi 이다. S-S 시그니처 곡선의 최소점은 L = 4.47(국부, 15.09)과 25.1(뒤틀림, 32.47)이다. m_recommend 방식 14항(1..7, 20..26)과 비교한 결과는 아래와 같다.

    | BC | m=[1] lf1 | 14항 lf1 | 과대 배율 |
    |---|---|---|---|
    | C-C | 75.68 | 15.11 | **5.01** |
    | S-C | 47.08 | 15.07 | **3.12** |
    | C-G | 20.42 | 15.07 | 1.36 |
    | C-F | 6.08 | 5.74 | 1.06 |

  - 정사각관 오일러 기둥 (`c2_euler.py`). 단면은 4 × 4 × 0.1, L = 400 이고 FSM/닫힌해 비를 항 수 M 에 따라 구했다.

    | BC | M=1 | M=5 | M=15 |
    |---|---|---|---|
    | S-S | 1.0004 | 1.0004 | 1.0004 |
    | C-C (4π²EI/L²) | 1.061 | 1.023 | 1.008 |
    | S-C (2.046) | **1.263** | 1.084 | 1.031 |
    | C-F (0.25) | 1.083 | 1.019 | 1.007 |
    | C-G (1.0) | 1.065 | 1.017 | 1.006 |

  - C-C 는 m=1 형상 sin²(πy/a) 가 정확한 클램프 오일러 모드인데도 6 % 과대다. 이식 오류는 아니다(BC 적분은 구적과 일치). 막 변위 u 가 Y_m 을 따르므로 Y″ ∝ Y 가 성립하지 않는 BC 에서는 포아송 수축이 길이 방향으로 맞춰지지 못한다. 그 결과 E 와 E/(1−ν²) 사이로 강성이 증가한다. 항을 늘리면 수렴한다.
- 영향: GUI 나 MCP 에서 S-S 가 아닌 BC 를 고른 모든 해석. 탄성 좌굴하중이 비안전측으로 최대 5배(국부), 전체좌굴은 6 – 26 % 과대로 나온다. 이 곡선을 DSM(Pcrl · Pcrd · Pcre)에 쓰면 강도가 비안전측이 된다. DSM 이 S-S 가 아닌 곡선을 실제로 소비하는지는 R5 확인 사항이다. 소비한다면 P0 으로 올린다.
- 수정안
  1. `engine/helpers.py` 에 `m_recommend(prop, node, elem, lengths)` 를 이식한다(`m_recommend.m` 그대로). S-S 시그니처 곡선의 국부 · 뒤틀림 최소 반파장 `Lcrl` · `Lcrd` 에서 `ceil(a/Lcr)-3 … +3` 과 `1..7`, `1..3` 을 합치고 `msort` 한다. 원본 101행의 `ceil(L/Lcrl)+3` 오타(Lcrd 자리에 Lcrl)는 의도대로 Lcrd 로 고칠지 결정해야 한다.
  2. `stripmain` 에서 `BC != 'S-S'` 이고 어떤 길이의 `len(m_a) < 기준`(예: `ceil(a/Lcrl)+3` 미만이거나 1 항뿐)이면 `diagnostics` 에 `severity:'warning', code:'INSUFFICIENT_LONGITUDINAL_TERMS'` 를 넣는다. 아니면 호출측이 `m_all` 을 주지 않았을 때 엔진이 `m_recommend` 로 채운다.
  3. TS 쪽 `set_bc` · `set_lengths` 는 BC 가 S-S 가 아니면 `m_all` 을 `m_recommend` 결과로 다시 만든다(R8 영역).
- 회귀 시험
  - 정사각관 4 × 4 × 0.1, L = 400, `m_all=[1..15]`. C-C/4Pe ≤ 1.01, C-F/0.25Pe ≤ 1.01, C-G/Pe ≤ 1.01, S-C/2.046Pe ≤ 1.035.
  - 립 C형강, C-C, L = 100, 권장 항: lf1 ≈ 15.1(± 1 %). 기본 경로가 75 근처 값을 내면 실패로 본다.

### R1-02 [P1] [확인] `stripmain` 이 `msort` 를 부르지 않음 — 중복 m 항이면 임의 고유치를 성공으로 반환하고, 0 항이면 실패하며, 정렬이 안 되면 `classify` 와 DOF 배치가 어긋남
- 위치: `python/engine/fsm_solver.py:61-65`. 원본은 `Ref_Source/analysis/stripmain.m:82` `[m_all]=msort(m_all);` 이다. 서버 `python/server.py:35-48` 과 `python/fileio/mat_loader.py:70-80`(.mat 의 m_all 을 그대로 읽음)도 정리하지 않는다. `python/cfsm/classify.py:45` 만 `msort` 를 부른다.
- 현상: MATLAB 은 해석 전에 m 항의 중복 · 0 · 순서를 정리한다. Python 은 하지 않는다.
  - 중복 항(예: `[1,1]`): 두 항의 기저가 같아 K 와 Kg 가 같은 방향으로 특이해진다. 특이 행렬쌍이므로 QZ 고유치 전체가 정의되지 않는다. 그런데 결과는 오류 없이 `success=True` 로 돌아온다.
  - 0 항: c1 = 0 으로 나누어 inf/NaN 이 되고 `EIGENSOLVE_FAILED` 가 난다.
  - 정렬 안 된 항(예: `[2,1]`): 고유치 자체는 맞다. 그러나 shapes 는 사용자 순서이고 `classify` 는 정렬된 순서로 기저를 만들므로 모드 분류가 엉뚱한 DOF 에 대해 계산된다.
- 근거: 수치 재현 (`c6_robust.py`, 인라인 스크립트)
  - 립 C형강 L = 10: `m=[1]` 은 26.178, `m=[1,1]` 은 **892.22**(34배 과대, 비안전측)
  - 정사각관 L = 10: `m=[1]` 은 140.01, `m=[1,1]` 은 **16.72**(8.4배 과소)
  - 서버 `analyze` 에 `m_all=[[1,1]]` 을 주면 `success: True` 와 함께 16.72 를 돌려준다.
  - `m=[0,1]` 은 `EIGENSOLVE_FAILED` 다. MATLAB 은 0 항을 지우고 정상으로 해석한다.
- 영향: CUFSM .mat 파일에서 불러온 m_all, 사용자가 직접 넣은 m_all, 앞으로 생길 m_recommend 출력처럼 m 항이 정리되지 않은 입력. 비안전측인지 안전측인지 예측할 수 없다.
- 수정안: `stripmain` 첫머리에 `from .helpers import msort; m_all = msort(m_all)` 을 넣는다(MATLAB 과 같게). `len(m_all) != len(lengths)` 이거나 정리 후 빈 배열인 길이가 있으면 `ValueError` 를 낸다. 정리한 m_all 을 결과에 실어(`CufsmResult.m_all`) shapes 와 classify 가 같은 순서를 쓰게 한다.
- 회귀 시험
  - 립 C형강 L = 10, `m_all=[[1,1]]` → lf1 = 26.178(± 1e-6, `[1]` 과 같음)
  - `[[0,1]]` → 26.178
  - `[[2,1]]` → `[[1,2]]` 와 같은 고유치, 같은 shapes 순서

### R1-03 [P2] [확인] 아주 긴 길이에서 수치가 무너져 틀린 1차 고유치를 정상값으로 반환함
- 위치: `python/engine/fsm_solver.py:335-349`(`scipy.linalg.eig(K, Kg)`), `:250-254`(필터)
- 현상: 막 강성 대 휨 강성 비 때문에 cond(K) 가 L⁴ 에 비례해 커진다. L ≳ 7000 in 부터 고유치가 틀리기 시작하고, 진단은 남지 않는다.
- 근거: `c6b_long.py`. 립 C형강 S-S m=[1]. 비교 기준은 약축 오일러 σ = π²EI_zz/(AL²) 이다.

  | L | FSM/Euler | cond(K) |
  |---|---|---|
  | 1e3 | 1.0015 | 1.8e11 |
  | 5e3 | 1.0022 | |
  | 1e4 | 0.973 | 1.8e15 |
  | 2e4 | 0.859 | |
  | 5e4 | **10.3** | |
  | 1e5 | **1037** | |

  - 같은 L 에서 실행 경로에 따라 값이 흔들린다(L = 1e4 에서 0.973 과 0.956). 대각 스케일링으로는 해결되지 않았다(L = 2e4 에서 0.18).
- 영향: 실무 길이(≤ 1000 in)에서는 문제가 없다. 그러나 `helpers.signature_ss` 와 MATLAB 시그니처 곡선은 길이 상한이 `1000 × 최대 요소폭` 이라, 요소폭이 10 in 를 넘는 모델(세분하지 않은 데크 · 넓은 판)은 붕괴 구간에 들어간다. 사용자가 SI 길이를 변환하지 않고 in 자리에 넣어도 마찬가지다. 2e4 까지는 값이 낮게(안전측) 나오고, 5e4 이상에서는 비안전측이 된다.
- 수정안: 길이마다 `np.linalg.cond(Kff)`(또는 LAPACK `rcond`)를 추정한다. 1e14 를 넘으면 `diagnostics` 에 `severity:'warning', code:'ILL_CONDITIONED'` 를 넣고, 1e16 을 넘으면 그 길이를 `error` 로 처리한다. 덧붙여 `a / max(element width) > 2000` 이면 경고한다.
- 회귀 시험: 립 C형강 L = 5e4 → diagnostics 에 `ILL_CONDITIONED` 가 있을 것. L = 1000 → 경고 없이 0.2604(± 0.5 %).

### R1-04 [P2] [확인] 조립 성능 — `lil_matrix` 슬라이스 `+=` 가 시간의 95 %를 차지해 다항 해석이 사실상 불가능함
- 위치: `python/engine/assembly.py:59-130`(m-p 쌍 × 요소마다 슬라이스 32회), `:156-189`. `python/engine/fsm_solver.py:68-69`, `:155-156`(어차피 dense 로 바꿈).
- 현상과 근거: cProfile 결과 `assemble` 이 20.5 s / 21.6 s 를 차지했다. 이 가운데 `lil.__setitem__` 과 `tocoo` 가 대부분이다.
  - 21 절점 립 C형강, m=[1], 50 길이: 11.7 s
  - C-C, m = 1..10, 1 길이: 19 s
  - 14 항, 1 길이: 37 – 56 s

  m_recommend 수준(15 – 20 항) × 50 길이면 한 시간이 넘는다. 그래서 R1-01 의 올바른 해법을 실제로 쓸 수 없고, 사용자는 m=[1] 로 밀린다.
- 영향: 정확도에 간접 영향(R1-01 을 고착시킴). 독립 프로그램에서는 UI 가 멈춘다.
- 수정안: K · Kg 를 `np.zeros((ndof, ndof))` dense 배열로 만든다. 요소마다 전역 DOF 인덱스 벡터 `idx`(8 × totalm, MATLAB `stripmain.m:196` 의 `assembleLoc` 과 같은 순서: 각 m 블록에서 `[2ni-2, 2ni-1, 2nj-2, 2nj-1, skip+2ni-2, …]`)를 만들고, `K[np.ix_(idx, idx)] += k` 한 번으로 더한다. 절점이 중복되지 않으므로 `ix_` 누적을 써도 안전하다. ndof 가 수천을 넘으면 COO 삼중항을 모아 한 번에 CSR 로 만든다.
- 회귀 시험: 새 조립 결과가 기존 `assemble` 과 `max|ΔK| / max|K| < 1e-14` 로 같을 것(여러 BC, m = 1..5). 21 절점, m = 1..10 한 길이가 2 s 안에 끝날 것.

### R1-05 [P2] [확인] `helpers.signature_ss` 가 항상 ImportError — 서버 `signature_ss` RPC 가 동작하지 않음
- 위치: `python/engine/helpers.py:264` `from ..models.data import GBTConfig`
- 현상: `engine` 이 최상위 패키지라 `..models` 는 패키지 밖을 가리킨다.
- 근거: `handle_request({'method':'signature_ss', …})` 를 호출하면 `{'error': 'attempted relative import beyond top-level package'}` 가 돌아온다. 현재 패널은 이 RPC 대신 `analyze` 를 쓰므로 드러나지 않았다(`StcfsdPanel.ts:2112-2131`). 독립 프로그램이 `signature_ss` 를 쓰면 바로 실패한다.
- 수정안: `from models.data import GBTConfig` 로 바꾼다(다른 모듈과 같은 방식).
- 회귀 시험: 정사각관 모델로 서버 `signature_ss` 를 호출하면 `result.curve` 의 길이가 100 이고 오류가 없을 것.

### R1-06 [P2] [확인] 스프링 입력 — 1차원 배열을 조용히 버리고, 열 수 · 절점 번호 오류에는 알아보기 힘든 예외를 냄
- 위치: `python/engine/fsm_solver.py:112` `if springs is not None and springs.size > 0 and springs.ndim == 2`, `:115-122`
- 현상
  - MATLAB 은 1 × 10 행 하나(스프링 하나)를 정상 입력으로 받는다(`stripmain.m:226`). Python 은 `ndim == 1` 이면 아무 경고 없이 스프링을 무시한다.
  - 열이 10 개보다 적으면 `IndexError: index 8 is out of bounds` 가 난다.
  - 범위를 벗어난 절점 번호는 `ValueError: operands could not be broadcast …` 가 난다.
  - MATLAB 의 `springs(1,1)~=0` 검사도 빠졌다(영향은 작다).
- 근거: `c6_robust.py`, 인라인 재검. 립 C형강 웨브 중앙 절점에 ku = kw = 10 인 접지 스프링 하나를 주었다.

  | L | 스프링 없음 | 1차원 입력 | (1, 10) 입력 |
  |---|---|---|---|
  | 10 | 26.178 | 26.178 | 123.00 |
  | 25 | 32.48 | 32.48 | 71.40 |

  1차원 입력이면 스프링이 통째로 사라진다.
- 영향: 스프링이 빠지면 강성이 줄어 대개 안전측이지만, 사용자는 반영된 줄 안다. 구속 효과를 기대한 설계 검토가 틀린다.
- 수정안: `springs = np.atleast_2d(springs)` 를 넣는다. `shape[1] != 10` 이면 `ValueError('springs must be (n,10) …')` 를 낸다. 절점 번호가 1..nnodes(nodej 는 0 허용) 밖이면 `ValueError` 를 낸다. `discrete` 이면 `0 ≤ ys ≤ 1` 인지 검사한다.
- 회귀 시험: 1차원 스프링 하나가 같은 값의 (1, 10) 입력과 같은 고유치를 낼 것. 8열 입력은 명시적 `ValueError` 를 낼 것.

### R1-07 [P3] [확인] `helpers.master_slave` 의 DOF 코드가 틀림 (죽은 코드지만 공개 함수)
- 위치: `python/engine/helpers.py:207-248`
- 현상: CUFSM DOF 코드는 1 = x(u), 2 = z(w), 3 = y(v), 4 = θ 이다(`stripmain.m:14`, `python/cfsm/constraints.py:558-575`). Python 은 다음과 같이 만든다.
  - `[sn, 2, 1.0, master, 2]` 에 'v' 라는 주석을 달았지만 실제로는 w_slave = w_master 이고, wq·θ 항이 빠졌다.
  - `[sn, 3, 1.0, master, 3]` 과 `[sn, 3, wq, master, 4]` 는 v_slave = v_master + wq·θ 가 되어, 축방향 변위에 있어서는 안 되는 항이 붙는다.

  원본 `Ref_Source/helpers/master_slave.m:21-25` 는 u(1) = uq·θ + u_m, w(2) = wq·θ + w_m, θ(4) = θ_m 만 두고 v 는 구속하지 않는다.
- 근거: `c5_springs.py` 출력. master (0,0), slave (3,4) 일 때 `[[2,1,1,1,1],[2,1,-4,1,4],[2,2,1,1,2],[2,3,1,1,3],[2,3,3,1,4],[2,4,1,1,4]]` 이 나온다. 세 번째 행에 `[2,2,3,1,4]` 가 있어야 하고, 네 번째와 다섯 번째 행은 없어야 한다.
- 영향: 지금은 호출하는 곳이 없다(grep 결과). 독립 프로그램이 이 함수로 강체 연결을 만들면 틀린 구속이 된다.
- 수정안: 슬레이브 하나에 `[sn,1,1.0,m,1]`, `[sn,1,uq,m,4]`, `[sn,2,1.0,m,2]`, `[sn,2,wq,m,4]`, `[sn,4,1.0,m,4]` 다섯 행을 만든다. 쓰지 않을 함수라면 지운다.
- 회귀 시험: master (0,0), slave (3,4) → 위 다섯 행이 나올 것. 판 중간에 중복 절점을 두고 4 DOF 를 `master_slave` 로 묶은 판(dx = dz = 0)이 연속판 k = 4.000 을 재현할 것.

### R1-08 [P3] [확인] `stripmain` 의 입력 검증이 없음 (crash 나 잘못된 성공)
- 위치: `python/engine/fsm_solver.py:61-65`, `:218-219`, `python/engine/boundary.py:30-127`(모르는 BC 이면 0 반환), `python/models/data.py:130`
- 현상과 근거(`c6_robust.py`, 서버 호출 스크립트)
  - `m_all` 이 비었거나 lengths 보다 짧으면 `IndexError`. 서버에서 `m_all` 을 빠뜨리면 `'list index out of range'` 가 난다.
  - m_all 이 lengths 보다 길면 조용히 잘린다.
  - L = 0 은 `EIGENSOLVE_FAILED`. L = −10 은 L = 10 과 같은 값을 정상으로 돌려준다.
  - m 이 정수가 아니면(1.5) S-S 끝단 조건을 만족하지 않는데도 17.40(정상 26.18)을 정상으로 돌려준다.
  - BC 가 `'s-s'` · `'SS'` · `'CC'` 이면 모든 적분이 0 이 되어 K = Kg = 0 이고, 일반 메시지 `NO_POSITIVE_EIGENVALUE` 만 남는다.
  - `neigs=0` 이면 곡선 행이 `[a]`(고유치 없음)인데 `success=True` 다.
  - 폭 0 요소(같은 좌표의 절점 두 개를 잇는 요소)는 일반 메시지 `EIGENSOLVE_FAILED` 만 남는다.
  - 요소가 절점 0 을 참조하면 broadcast `ValueError` 가 난다.
- 영향: GUI · MCP 는 BC enum 과 neigs 를 검사하지만, 독립 프로그램이 엔진을 직접 부르면 이 보호가 없다.
- 수정안: `stripmain` 첫머리에서 다음을 검사하고 모두 `ValueError` 를 낸다.
  - `BC in {'S-S','C-C','S-C','C-S','C-F','F-C','C-G','G-C'}`
  - `len(m_all) == len(lengths)`
  - 모든 `a > 0` 이고 유한
  - m 항이 양의 정수
  - `neigs ≥ 1`
  - 요소 절점이 1..nnodes 안
  - 요소 폭 > 1e-12

  `BC_I1_5` 는 모르는 BC 를 받으면 `ValueError` 를 낸다.
- 회귀 시험: 각 잘못된 입력에 `pytest.raises(ValueError)`.

### R1-09 [P3] [확인] 원본과 다른 점 · 죽은 코드 (유지보수)
- `fsm_solver.py:282-289`: 모드 정규화. MATLAB(`stripmain.m:386-389`)은 절댓값이 가장 큰 성분이 +1 이 되도록 부호까지 맞춘다. Python 은 `max|·|` 로만 나누므로 최대 성분이 −1 일 수 있다. 3D 모드형상의 부호와 이전 결과와의 비교가 달라진다. `mode / mode[argmax|mode|]` 로 바꾼다.
- `fsm_solver.py:219`: `n_eigs` 는 계산하지만 `scipy.linalg.eig` 는 전 고유치를 구하므로 쓰이지 않는다. 혼동을 일으키므로 지우거나 주석을 단다. 전 고유치를 구하는 쪽이 MATLAB `eigs(...,'SM')` 보다 양의 고유치를 놓칠 위험이 적다(장점).
- `vectorized.py` 전체: 호출하는 곳이 없다. 이름과 달리 벡터화되어 있지 않다(스칼라와 같은 이중 루프). 스칼라와 다른 점은 m = 0 에서 `kglocal_vec` 이 0 을 주는 반면 스칼라는 inf/NaN 을 준다는 것 하나뿐이다. 무작위 100 경우에서 상대차는 4.0e-16 이었다(`c4_vec.py`). 지우거나 R1-04 의 실제 벡터화 조립으로 바꾼다.
- `helpers.doubler:52`: 새 중간 절점의 DOF 플래그를 `[1,1,1,1]` 로 둔다. MATLAB `doubler.m:29` 는 nodei 의 플래그를 복사한다. 절점 번호도 MATLAB 은 홀짝 재번호, Python 은 끝에 덧붙인다. Python 쪽이 물리적으로 더 타당하고 스프링 · 구속 번호도 유지되지만, 원본과 다르다는 것을 문서에 적는다.
- `helpers.firstyield:284-297`: MATLAB `firstyield.m`(PMM 공간의 βy)과 이름은 같고 기능은 다르다(yieldMP 래퍼, `unsymm=0` 고정). Z형강 같은 비대칭 단면에서 MATLAB 원본은 `unsymm=1` 을 쓴다. 이름을 바꾸거나 `unsymm` 인자를 노출한다.
- `helpers.add_corner`, `helpers.stress_to_action`: 호출하는 곳이 없다. 대조는 했지만 수치 검증은 하지 않았다.

### R1-10 [P3] [확인] FSM 코어에 닫힌 해 회귀 시험이 하나도 없음
- 위치: `test/python/test_solver.py`, `test/python/test_element.py`
- 현상: 지금 시험은 모양 · 대칭 · `lf > 0` · 실패 진단 코드만 본다. 이 리뷰에서 수치로 확인한 다음 동작에는 시험이 없다.
  - 판 k
  - 오일러 BC 5종
  - 횡비틀림(LTB) · 휨비틀림(FT)
  - 스프링(기초 · 이산 · 절점 사이 · local 플래그)
  - 구속(고정 · 방정식)
  - 다항 수렴
  - msort 동작
  - 긴 길이 조건수
  - 중복 m 항
  - 1차원 스프링

  `test_stripmain_all_bc` 는 m=[1] 로 `lf > 0` 만 확인하므로 R1-01 을 오히려 고착시킨다.
- 수정안: 아래 값(이 리뷰 스크립트에서 얻은 값)을 `test_fsm_closed_form.py` 로 고정한다.
  1. 판 b = 10, t = 0.1, 20 요소, 균일압축, L = b → k = 4.000(± 0.1 %). ψ = 0 → 7.81, ψ = −1 → 23.88(min L/b = 0.67, ± 0.5 %).
  2. 정사각관 4 × 4 × 0.1(16 요소), L = 400, S-S → P/Pe = 1.0004(± 0.2 %). C-C · C-F · C-G 15항 → ± 1 %, S-C 15항 → ± 3.5 %.
  3. I형강 h8 × bf4 × t0.1, 순수휨 L = 400 → Mcr = 13.39, 닫힌해 13.34(± 1 %).
  4. 립 C형강 H6 × B2.5 × D0.75 × t0.06, L = 200 압축 → lf1 = 5.716(FT 5.709), lf2 = 6.486(약축 6.499).
  5. 정사각관 + 기초 스프링 x · z 각 β = Pe·π²/L² → P = 2Pe(± 0.1 %). 중앙 이산 스프링 K = Pe·π²/(2L) → 2Pe. L/4 → 1.5Pe.
  6. 분할판 + 4 DOF 결속 구속 → k = 4.000. 결속이 없으면 2.673.
  7. 판 양 가장자리 kq = 1e6 → k = 6.971(L/b = 0.66).

## 맞다고 확인한 것

- **`klocal`** (`element.py:19-114` ↔ `klocal.m:27-98`): 막 4 × 4 16 항, 휨 4 × 4 16 항이 계수 · 부호 · I2/I3 위치까지 원본과 같다. `kf[3,2]` 의 비대칭 표기("not symmetric")도 같다. 8 × 8 블록 `[km 0; 0 kf]` 위치도 같다.
- **`kglocal`** (`element.py:117-177` ↔ `kglocal.m`): 같다. `/210/2` = `/420`, `/2/420` = `/840`, `/140/2` = `/280` 이다.
- **`BC_I1_5`**: 5종 모두 원본과 같다. 구적 대조(m, n = 1..8, a = 37)에서 최대 상대오차는 5.4e-14 다(`c2b_bcint.py`). S-C 의 m = 0 보호는 원본에 없는 추가 가드이고 무해하다.
- **`BC_I1_5_atpoint`**: `Ym_at_ys.m` · `Ymprime_at_ys.m` 과 같다. Python 은 ys 를 비율로 받아 `y = ys·a` 로 바꾸고, MATLAB 은 `stripmain.m:235` 에서 `springs(i,10)*a` 로 넘긴 뒤 `ys/a` 로 쓴다. 결과가 같다. 5종 BC 점값이 해석 미분과 일치했다.
- **`spring_klocal`**: 원본과 같다(이산 스프링이면 I4 = 0, kv 는 I5 사용). `um*up == 0` 가드는 추가된 것이다.
- **`trans` · `spring_trans`**: γ 행렬과 `γ k γᵀ` 가 같다. `energy_recovery` 의 `d_local = γᵀ d_global` 은 원본 `gammait(−α)` 와 같다.
- **`assemble` · `spring_assemble`**: 16개 2 × 2 블록의 행 · 열 오프셋(`nd*i + mi/fi`)이 원본 `4*nnodes*(i-1)+nodei*2-1` 과 같다(0 기준 변환 포함). 접지 스프링은 11 · 33 · 13 · 31 블록만 더한다(원본과 같음). 원본은 `K2(...) = k`(대입) 후 합산하고 Python 은 `+=` 를 쓰지만, 절점이 서로 다르면 결과가 같다.
- **`stripmain` 흐름**: 재료 검색(없으면 즉시 실패), `Ty = σ·t`, 스프링 방향(`width<1e-10` 또는 local 플래그 0 이면 α = 0), `constr_BCFlag`, R 행렬(`null(Ruser')` → `null(Ru0')`, cFSM 결합 `null([Rm0 Ru0]')`), `R'KR` 가 원본 `stripmain.m:226-319` 와 같다. 고유치 필터 `|imag| < 1e-5 & real > 0 & isfinite` 는 원본(`imag(abs(lf))` 는 항상 0)보다 엄격하다. 응력 크기를 1 에서 1e-9 까지 바꿔도 lf × σ 가 6 자리까지 변하지 않아 스케일 의존성이 없음을 확인했다. 오름차순 정렬, neigs 로 자르기, neigs > DOF(84) 처리, 정렬 안 된 lengths, 전 응력 0 · 전 인장(`NO_POSITIVE_EIGENVALUE` 진단)이 모두 정상이다.
- **`stresgen`**: `inv([c −s; s c])` = `[c s; −s c]` 로 원본과 같다. 판 순수휨(stresgen Mxx 경로) k_min = 23.88 이다. 원본과 같은 규약상의 특이점이 있다. thetap = 0 에서 Mxx 양(+)이면 위쪽이 압축이고 M11 양(+)이면 아래쪽이 압축이다(부호가 반대). 이식은 충실하다.
- **`yieldMP`**: 원본과 같다(NaN → 0 대체도 같다).
- **`energy_recovery`**: 다항 결합항을 포함하고 모드 길이를 검사한다.
- **수치 검증 요약**
  - 판 k: 균일 4.0000(20 요소). ψ = +0.5 → 5.319(EN 근사식 5.290), 0 → 7.810, −0.5 → 13.377, −1 → 23.881.
  - 오일러 S-S 1.0004.
  - I형강 LTB 1.0034 – 1.0040, 축력 약축 1.005.
  - 립 C형강 FT 1.001 · 약축 0.998 – 1.001(L ≥ 200). L = 100 에서는 FT 0.996, 약축 0.966(단면 뒤틀림 상호작용).
  - 스프링: 기초 1.00017, 이산 중앙 1.00017, L/4 1.00026, 강한 중앙 가새 → 3.988Pe. 절점-고정절점 스프링 = 접지 스프링. local 플래그 회전이 맞다. 판 회전스프링 → 6.971.
  - 구속: 분할판 결속 → 4.00001, 계수 0 구속 → 고정과 같다.
  - 벡터화 경로와 스칼라 경로의 요소 행렬 상대차는 4e-16 이다.
  - S-S 다항은 서로 분리된다(M = 1..15 비가 같음).

## 확인하지 못한 것

- MATLAB 실행 비교: MATLAB 이 없어 CUFSM 원본 결과와 직접 비교하지 못했다. 닫힌 해와 원문 줄 대조로 대신했다. C-C m = 1 의 +6 % 가 CUFSM 원본에서도 나온다는 것은 식이 같다는 데서 추론한 것이다(BC 적분이 맞고 klocal 이 원본과 같음).
- cFSM 경로(`GBTcon` 활성, `base_column` · `base_update` · `mode_select` · `constr_user`): R3 영역이다. `stripmain` 의 R 결합 논리만 원본과 대조했다.
- `helpers.add_corner`, `helpers.stress_to_action`: 호출하는 곳이 없어 수치 검증을 하지 않았다.
- 대규모 모델(ndof ≫ 5000)의 메모리: dense `toarray()` 와 `null_space` 의 O(n³) 비용은 시간 · 메모리를 추정만 했다(ndof 12000 이면 행렬 하나가 1.15 GB).

## 다른 리뷰어 영역에 걸치는 것 (메모)

- **R5 (dsm.py)**
  - S-S 가 아닌 BC 의 곡선(R1-01, m=[1])이 DSM 에 들어가는지 확인해야 한다.
  - `dsm.py:110` 은 `row[1] > 0` 인 행만 쓰므로 실패한 길이(lf = 0 행)를 조용히 건너뛴다. 국부 최소점 부근 길이가 실패하면 Pcrl 이 과대(비안전측)가 될 수 있다. TS 의 `success` 검사에만 기대고 있다.
- **R3 (cfsm/classify.py)**: `classify.py:45` 만 `msort` 를 부르므로 정렬 안 된 m_all 에서 shapes 와 DOF 배치가 어긋난다(R1-02 수정으로 해결됨).
- **R4/R5 (design/aisi_s100.py:2347-2370)**: `yieldMP` 는 기본값 `unsymm=0`(Ixz = 0)으로 Mxx_y 를 구하는데, 휨 응력장은 `stresgen(..., unsymm=1 if Ixz≠0)` 로 만든다. Z형강에서는 기준 응력장의 최대 응력이 Fy 가 아니게 되어 My 기준이 어긋날 수 있다.
- **R8 (server.py · TS)**
  - `server.py` 의 `analyze` 는 `m_all` 이 없으면 IndexError 를 낸다. `signature_ss` RPC 는 항상 실패한다(R1-05).
  - `StcfsdPanel.ts` `set_bc` · `set_lengths` 의 `m_all=[1]` 기본값(R1-01).

## 읽은 파일

| 파일 | 줄 수 |
|---|---|
| `python/engine/fsm_solver.py` | 381 (전부) |
| `python/engine/element.py` | 241 (전부) |
| `python/engine/assembly.py` | 191 (전부) |
| `python/engine/boundary.py` | 182 (전부) |
| `python/engine/stress.py` | 148 (전부) |
| `python/engine/transform.py` | 93 (전부) |
| `python/engine/vectorized.py` | 198 (전부) |
| `python/engine/helpers.py` | 459 (전부) |
| `test/python/test_solver.py` | 248 |
| `test/python/test_element.py` | 84 |
| `python/server.py` | 1 – 330 (호출 계약) |
| `python/models/data.py` | 75 – 224 |
| `python/engine/properties.py` | `elemprop` 70 – 98 |
| `python/engine/cutwp.py` | 1 – 62 |
| `python/cfsm/constraints.py` | `constr_user` 484 – 575 |
| `python/cfsm/classify.py` | m_all 부분 |
| `python/fileio/mat_loader.py` | 70 – 108 |
| `python/design/aisi_s100.py` | 2325 – 2394 |
| `src/webview/StcfsdPanel.ts` | m_all · BC 관련 부분 |
| `webview/js/app.js` | m_all 관련 부분 |

MATLAB 원본

| 파일 | 줄 수 |
|---|---|
| `Ref_Source/analysis/stripmain.m` | 427 |
| `Ref_Source/analysis/klocal.m` | 103 |
| `Ref_Source/analysis/kglocal.m` | 81 |
| `Ref_Source/analysis/assemble.m` | 99 |
| `Ref_Source/analysis/BC_I1_5.m` | 152 |
| `Ref_Source/analysis/BC_I1_5_atpoint.m` | 21 |
| `Ref_Source/analysis/trans.m` | 24 |
| `Ref_Source/analysis/spring_klocal.m` | 65 |
| `Ref_Source/analysis/spring_assemble.m` | 69 |
| `Ref_Source/analysis/spring_trans.m` | 25 |
| `Ref_Source/analysis/constr_BCFlag.m` | 30 |
| `Ref_Source/analysis/stresgen.m` | 13 |
| `Ref_Source/analysis/msort.m` | 17 |
| `Ref_Source/analysis/Ym_at_ys.m` | 20 |
| `Ref_Source/analysis/Ymprime_at_ys.m` | 20 |
| `Ref_Source/analysis/gammait.m` | 14 |
| `Ref_Source/analysis/gammait2.m` | 9 |
| `Ref_Source/analysis/vectorized/klocal_vec.m` | 112 |
| `Ref_Source/helpers/yieldMP.m` | 55 |
| `Ref_Source/helpers/master_slave.m` | 27 |
| `Ref_Source/helpers/doubler.m` | 35 |
| `Ref_Source/helpers/signature_ss.m` | 26 |
| `Ref_Source/helpers/energy_recovery.m` | 48 |
| `Ref_Source/helpers/firstyield.m` | 46 |
| `Ref_Source/helpers/stress_to_action.m` | 33 |
| `Ref_Source/helpers/m_recommend.m` | 106 |

검증 스크립트: `C:\Users\USER\AppData\Local\Temp\claude\3df7e1c8eb560f18\99d094e4-961f-4f09-9be9-02ec03b2e201\scratchpad\review\R1\`

| 스크립트 | 내용 |
|---|---|
| `common.py` | 공통 |
| `c1_plate.py` | 판 k |
| `c2_euler.py` | 오일러 · BC 수렴 |
| `c2b_bcint.py` | BC 적분 구적 |
| `c2c_defaultm.py` | 기본 m 항 |
| `c3_global.py` | LTB · FT |
| `c4_vec.py` | 벡터화 대조 |
| `c5_springs.py` | 스프링 · 구속 |
| `c6_robust.py` | 견고성 |
| `c6b_long.py` | 긴 길이 |

인라인으로 실행한 보조 검사(서버 호출 계약, 중복 m 항, 스프링 x · z 재검사, 응력 스케일)는 위 스크립트의 함수를 그대로 썼다.
