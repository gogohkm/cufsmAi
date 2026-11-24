# R2 — 단면 생성과 단면 성질 (template · cfs_centerline · properties · cutwp · data)

## 요약

발견사항 수: **P0 1 · P1 6 · P2 10 · P3 3** (계 20, 확인 19 · 의심 1).

파라메트릭 템플릿 10종의 기하와 성질을 닫힌 해 · 독립 적분기 · AISI Design Manual 2017 Part I 표(Table I-1/I-2/I-3/I-4/I-6/I-8)와 수치로 대조했다. **lippedc · track · lippedz(90°) · hat · rhs · angle** 은 치수 규약(out-to-out 입력 → 중심선, r = 내측 반경 → r_c = r + t/2)이 MATLAB `template_build_model.m` · AISI 와 맞고, 날카로운 모서리(r=0)에서 A · I · J · Cw · xo · j(B2/2) 가 AISI 닫힌 식과 0.00 % 로 일치한다. 둥근 모서리 표값과도 A · I · xo · ro · J 는 0.3 % 안쪽이다(Cw 3 – 13 % 차이는 AISI 가 Cw 를 각진 모서리 근사로 계산하기 때문이며 엔진 오류가 아니다 — Part I §3 (2)).

틀린 것은 주로 가장자리에 있다. 가장 큰 것은 **임의 단면(set_custom_section / build_section) 경로가 직선부 하나를 요소 하나로 만든다**는 것이다(R2-01). 9CS2.5x059 를 이 경로로 만들면 성질은 템플릿과 같지만 FSM 국부좌굴 Mcrl 이 24 % 높게 나와 DSM Mnl 이 약 7 % 비보수적이 된다. 그 밖에: Z · hat 은 외측 꼭짓점 한 면 offset 방식으로 원리상 맞게 만들 수 없고(R2-02), 립 앵글은 코너 반경을 엉뚱한 코너에 넣으며(R2-03), 폐단면에 가지가 붙으면 열린 단면으로 분류되어 J 가 1/1600 이 되고 Cw 가 허위로 커진다(R2-06). MCP 의 CHS 는 지름을 "Lip length" 인자 D(기본 1)에서 읽어 1 in 관이 된다(R2-10). hat 의 H/B 뜻은 MCP 설명과 반대다(R2-11). outer_side 의 글 규칙은 코드와 반대다(R2-14).

`test/python/` 에는 단면 성질 값을 검사하는 시험이 없다(템플릿 8종의 "절점 수 > 0" 만 본다). cutwp · cfs_centerline · custom · custom_builder · track · lipped_angle 시험은 하나도 없다.

## 발견사항

### R2-01 [P0] [확인] 임의 단면 경로는 직선부(flat)를 요소 1개로 만든다 → FSM 국부좌굴 과대(비보수)
- 위치: `python/engine/template.py:782-792` (`_gen_custom` 이 `section.get_coords()` 의 연속점을 그대로 요소로 만듦), `python/engine/cfs_centerline.py:192-356` (`apply_fillet` 은 자유단 · 호 절점만 만들고 직선부를 나누지 않음)
- 현상: custom C(9CS2.5x059 외측 꼭짓점, R=0.1875, n_arc=4)의 요소 길이는 `[0.526, 0.085×4, 2.007, 0.085×4, 8.507, …]` — 웹 8.5 in 이 요소 **1개**, 플랜지 1개, 립 1개다. 템플릿(웹 8, 플랜지 4, 립 2, 코너 4)과 A · Ix 는 같지만(0.8808 / 10.2912) 판 좌굴을 표현할 자유도가 없다.
- 근거: `scratchpad/review/R2/t6_mesh_fsm.py` — 순수 휨(최외단 50 ksi), S-S
  - 템플릿 lippedc: 국부 최소 하중계수 0.736 (L=5 in), 뒤틀림 0.936 (L=25)
  - custom C: 국부 최소 0.912 (L=5), 뒤틀림 0.957
  - 국부 비 1.240, 뒤틀림 비 1.022
- 영향: set_custom_section · build_section 으로 만든 모든 단면(시그마, 랙, 변형 C/Z 등 — 이 경로를 쓰는 주된 까닭인 단면들)의 Mcrl · Pcrl 이 과대. λℓ 가 줄어 Mnℓ 가 비보수(이 예에서 Mnℓ/My 0.768 → 0.824, +7 %). 판정이 합격 쪽으로 틀릴 수 있다.
- 수정안: `_gen_custom` 에서 연속한 두 좌표가 직선부(`seg_info` 의 다음 점이 다른 코너의 호 시작)일 때 그 구간을 `n_flat` 개로 나눈다. 기본값은 템플릿과 같은 밀도(예: `n_flat = max(2, ceil(L / (h_web/8)))`, 또는 요소 길이 ≤ 최장 직선부/8)로 하고 MCP 인자로 노출한다.
- 회귀 시험: custom C(위 좌표, R=0.1875) 와 `lippedc(H=9,B=2.5,D=0.773,t=0.059,r=0.1875)` 의 순수 휨 국부 최소 하중계수 차이 ≤ 2 %, 요소 수 ≥ 30.

### R2-02 [P1] [확인] Z · hat 은 외측 꼭짓점 + 한 면 offset 으로 맞게 만들 수 없다 (깊이 H, 폭 2B 로 t 만큼 큼)
- 위치: `python/engine/cfs_centerline.py:81-185` (`offset_to_centerline` 은 경로 전체에 한쪽 법선만 씀), `:1181-1270` (`make_z_section` · `make_hat_section`), MCP 안내 `src/mcp/server.ts:345-349`, `Example/CFS_CENTERLINE_ALGORITHM.md:57-63` (Z, Hat → `right`)
- 현상: Z 의 아래 플랜지 바깥면(아래면)과 위 플랜지 바깥면(윗면)은 판의 서로 다른 면이다. 한 면을 따라 t/2 offset 하면 한 플랜지는 안으로, 다른 플랜지는 밖으로 간다. hat 도 같다(브림 아랫면과 상판 윗면이 서로 다른 면).
- 근거: `t5_centerline.py`
  - Z 외측 꼭짓점 `[(-2.25,0.91),(-2.25,0),(0,0),(0,8),(2.25,8),(2.25,7.09)]`, t=0.059: `outer_side='left'` 와 `'right'` 가 **같은** 중심선 범위 (4.500, 8.000) 를 낸다. 맞는 값은 (2B−t=4.441, H−t=7.941). Ix 7.753 대 템플릿 lippedz(90°) 7.478 (+3.7 %).
  - `make_hat_section(H=3, …, t=0.048)` 중심선 깊이 3.000 (맞는 값 2.952).
- 영향: 임의 단면으로 만든 Z · hat · 점대칭 랙 단면의 Ix · Sx · My 가 t/H 정도 과대(비보수), 플랜지 폭도 큼. 경고 없음.
- 수정안: (1) `outer_side` 에 구간별 목록(길이 N−1)을 받게 하고 offset 을 구간별 법선으로 한 뒤 이웃 구간 offset 선의 교점을 꼭짓점으로 삼는다. (2) 쉬운 대안: offset 결과의 bounding box 가 입력 외측 꼭짓점의 bounding box 를 벗어나면 오류로 거부하고 "Z/hat 은 lippedz/hat 템플릿을 쓰라"고 안내한다. (3) 문서 표의 Z/Hat 행을 고친다.
- 회귀 시험: 위 Z 꼭짓점을 구간별 side 로 넣었을 때 중심선 범위 (4.441, 7.941) ± 1e-6, Ix 가 `lippedz(H=8,B=2.25,D=0.91,t=0.059,r=0.1875,qlip=90)` 과 0.5 % 안쪽.

### R2-03 [P1] [확인] lipped_angle: 코너 반경이 립-다리 코너에 들어가고 주 코너는 각진 채로 남는다
- 위치: `python/engine/template.py:710-716` — `radii=[0, r, 0]` 에서 0 을 걸러 `[r]` 로 만든 뒤 `_snakey` 에 넘김. `_snakey` 는 radii[0] 을 0번 코너(립1–다리1)로 해석한다. 같은 걸러내기가 `_gen_sigma` (`:667-673`, 현재 generators 에 없음)에도 있다.
- 근거: `t3_lip_angle.py` 절점 출력 — 호 절점(3–7)이 (0.2175,3.94)→(0,3.7225), 즉 위 립 코너에 있고 주 코너 (0,0) 은 각진 절점이며 아래 립 코너 (3.94,0) 도 각져 있다. 4LS4x060(H=B=4, D=0.5, t=0.06, R=0.1875) 대 AISI Table I-6: A 0.5235/0.512 (+2.24 %), Ix 0.972/0.959 (+1.35 %), J +2.14 %, **Iy2 0.4197/0.397 (+5.72 %)**, xo −0.14 %. A 의 초과분은 각진 코너 2개의 중심선 길이 증가(2 × 0.093 in)와 정확히 같다.
- 영향: 최소 주축 I · r 과대 → 압축 휨좌굴 Fcre 비보수(≈ +5.7 %). 형상 자체가 비대칭이 되어 등변 앵글의 대칭이 깨진다.
- 수정안: 걸러내지 말고 코너 수만큼 그대로 넘긴다: `radii=[r, r, r]; rn=[4,4,4]; rt=[t]*3; rid=[100]*3` (AISI 는 세 코너 모두 둥글다). `_snakey` 는 r=0 항목을 이미 건너뛰므로 일부만 둥글게 하려면 0 을 그 자리에 두면 된다. `_gen_sigma` 도 같은 방식으로 고친다.
- 회귀 시험: `lipped_angle(H=4,B=4,D=0.5,t=0.06,r=0.1875)` → A 0.512 ± 0.5 %, Ix 0.959 ± 0.5 %, I22 0.397 ± 1.5 %, Ixx == Izz.

### R2-04 [P2] [확인] 경사 립(qlip≠90°)의 중심선 치수 환산이 90° 용 그대로다
- 위치: `python/engine/template.py:343-346, 378-381, 698-701`
- 현상: b̄ = B − t, c̄ = D − t/2 를 각도와 무관하게 쓴다. AISI Example I-3(8ZS2.25x059, γ=50°): b̄ = B′ − t/2 − (t/2)tan(γ/2), c̄ = C′ − (t/2)tan(γ/2). MATLAB `Ref_Source/helpers/template_out_to_in.m:30-41` 도 같은 식이다(`template_build_model.m` 의 lippedz 는 Python 과 같은 단순식).
- 근거: `t2_aisi.py`, `t3_lip_angle.py` — lippedz qlip=50 대 Table I-4: A −0.47 %, Ix −0.69 %, Iy −3.28 %, Ixy −1.80 %, Imin −2.66 %, θ −1.5 %, J −0.49 %. AISI 환산값(b̄=2.2067, c̄=0.8962)을 넣으면 A −0.02, Ix −0.05, Iy −0.38, Ixy +0.07, Imin −0.14, J −0.04 % 로 붙는다.
- 영향: 대체로 과소(보수)지만 표준 Z(γ=50°) 의 약축 · 최소 주축 3 % 오차. 비교 검증을 흐린다.
- 수정안: 세 생성기에서 `q = radians(qlip)` 로 `b = B - t/2 - (t/2)*tan(q/2)`, `d = D - (t/2)*tan(q/2)` (90° 에서 기존식과 같아진다). 코너 트림은 `_snakey` 가 r_c·tan(Δθ/2) 로 이미 한다.
- 회귀 시험: `lippedz(H=8,B=2.25,D=0.910,t=0.059,r=0.1875,qlip=50)` → A 0.822 ± 0.3 %, Ixx 7.76 ± 0.3 %, Izz 1.08 ± 0.6 %, |Ixz| 2.08 ± 0.3 %, I22 0.481 ± 0.5 %.

### R2-05 [P2] [확인] qlip 의 뜻이 C 와 Z 에서 반대다
- 위치: `template.py:349` (C: `angles=[180+qlip, …, -qlip]`), `:384` (Z: `[-qlip, …, -qlip]`)
- 현상: Z 는 qlip<90 이면 립이 플랜지 안쪽(웹 쪽)으로 기운다(AISI γ 와 같음). C 는 qlip<90 이면 **바깥쪽**으로 기운다. `t3_lip_angle.py`: lippedc qlip=60 의 중심선 폭 2.813 > B−t=2.441(립 끝이 플랜지 밖), qlip=135 는 안쪽으로 기움. MCP 는 하나의 `qlip` "Lip angle in degrees (default 90)" 만 설명한다(`src/mcp/server.ts:189`). lipped_angle 은 `[90+qlip, …, qlip]` 로 또 다른 규약이다. MATLAB lippedc 는 각도 인자가 없다.
- 영향: AISI 의 γ=50° 를 C 에 넣으면 립이 바깥으로 뻗은 다른 단면이 조용히 만들어진다(뒤틀림 좌굴 거동이 바뀜).
- 수정안: 모든 템플릿에서 qlip 을 "플랜지와 립 사이 각, 90 미만이면 안쪽으로 기움"으로 통일한다(C: `angles=[180+(180-qlip) …]` 등, 또는 C 를 Z 규약으로 다시 씀). MCP 설명에 규약을 적는다.
- 회귀 시험: lippedc qlip=50 의 립 끝 x 좌표 < 플랜지 끝 x 좌표(안쪽). lippedc qlip=90 결과 불변.

### R2-06 [P1] [확인] 폐합 셀에 가지가 붙은 단면을 열린 단면으로 계산한다 (J 1/1600, Cw 허위)
- 위치: `python/cfsm/base_vectors.py:37-56` (2-요소 절점 수로 분류, 그 밖은 모두 'open'), `:141-299` (열린 단면 traversal), 원본 `Ref_Source/analysis/cutwp_prop2.m:91-103` (같은 한계, 'arbitrary' 는 주석 처리)
- 근거: `t4_closed.py` — RHS 6×4×0.1(셀만: J = 10.805, Bredt 일치) 에 0.5 in 립 하나를 붙이면 J = 0.0067 (1/1600), Cw = 155.6 in⁶ (관의 Cw 는 거의 0), 전단중심도 루프를 끊은 traversal 값.
- 영향: 중공 플랜지 보, 립 붙은 각관, 두 C 를 맞댄 상자 등. J 과소는 보수지만 Cw 허위 과대는 σt = (GJ + π²ECw/KtLt²)/(A ro²) 를 키워 **비틀림 · 휨-비틀림 좌굴이 비보수**가 된다. 경고 없음.
- 수정안: 연결 그래프에서 간선 수 ≥ 절점 수이면(사이클 존재) 'arbitrary' 로 분류해 J = Bredt(셀) + Σ(가지 b t³/3), Cw · xs · ys · B1 · B2 = NaN 과 진단 코드를 돌려준다. `cutwp_prop` · 설계 경로는 NaN 을 0 으로 바꾸지 말고 비틀림 관련 한계상태를 "계산 불가"로 표시한다.
- 회귀 시험: 위 RHS+립 → section='arbitrary', J ≈ 10.805 + 0.5·0.1³/3, Cw 가 NaN 으로 표시되고 설계 경로가 Fcre 비틀림 항을 쓰지 않음.

### R2-07 [P2] [확인] 폐단면 J 가 요소 방향에 따라 달라진다 (MATLAB 재정렬 블록 누락)
- 위치: `python/cfsm/base_vectors.py:124-132`; 원본 `cutwp_prop2.m:105-119` (폐단면이면 요소를 이어지게 다시 놓고 방향을 뒤집음)이 이식되지 않았다.
- 근거: `t4_closed.py` — RHS 6×4×0.1 정상 J = 10.805, 요소 하나 뒤집음 9.497 (−12.1 %), 네 요소 뒤집음 2.701 (−75 %).
- 영향: 템플릿(rhs, chs)은 방향이 일관되어 영향 없음. set_nodes/set_elements · 불러온 프로젝트의 폐단면은 J 과소(보수)지만 값이 틀림.
- 수정안: 재정렬 블록을 이식하거나, 루프를 한 번 순회해 정렬된 꼭짓점 열로 신발끈 공식 A0 를 계산(`J = 4A0²/Σ(L/t)`).
- 회귀 시험: RHS 의 임의 요소들의 ni/nj 를 뒤집어도 J = 10.8053.

### R2-08 [P2] [의심] 폐단면 전단중심을 도심으로, Cw · B1 · B2 를 0 으로 둔다
- 위치: `python/engine/cutwp.py:40-52`
- 현상: `_cutwp_prop2` 가 폐단면에 NaN 을 주면 Xs=xcg, Zs=zcg, Cw=0, B1=B2=0, warp=0 으로 바꾼다. 이중대칭 RHS · CHS 에는 맞다. 일축대칭 폐단면(두께가 다른 상자, 립 없는 맞댄 C 상자 등)은 전단중심이 도심과 다르다 — 크기는 재지 못했다.
- 영향: 사용자 정의 일축대칭 폐단면의 xo · β 가 0 → FTB 대신 휨좌굴만 검토될 수 있음(폐단면은 비틀림 강성이 커서 실무 영향은 작을 것으로 봄).
- 수정안: 폐단면 전단중심 · Cw 를 셀 전단류 해석으로 계산하거나, 대칭이 아니면 NaN + 진단을 넘긴다.
- 회귀 시험: 4×6 상자(좌측 벽 t=0.3, 나머지 0.1) 의 Xs ≠ xcg (독립 계산값과 비교).

### R2-09 [P2] [확인] isect · tee 의 플랜지 폭이 t 만큼 짧다 (그리고 tf/tw 구분 없음)
- 위치: `template.py:524, 591` — `half_b = (B - t)/2`. 플랜지 끝은 자유단이므로 중심선 폭 = B (MATLAB `template_build_model.m` isect/tee: `bf/2` 두 조각).
- 근거: `t1_sharp.py` — isect H=10, B=5, t=0.1: x 범위 ±2.45 (기대 ±2.5); A −1.01 %, Ixx −1.50 %, Izz −5.88 %, J −1.01 %, Cw −5.88 % (Cw = t(B−t)³h²/24 로 정확히 설명됨). tee H=8, B=6: A −0.72 %, zcg −0.29 %, Ixx −0.54 %, Izz −4.92 %. 전단중심(I: 중앙, T: 접합점)과 Cw(T=0)는 맞다 — 가지 단면 traversal 자체는 정상.
- 영향: 약축 · Cw 과소(보수). MCP 는 B 를 "flange width, out-to-out" 으로 설명한다.
- 수정안: `half_b = B/2`. MATLAB 처럼 `tf`, `tw` 를 받는다(없으면 t).
- 회귀 시험: isect(H=10,B=5,t=0.1) → A = 0.1·(9.9+10) = 1.99, Cw = 0.1·5³·9.9²/24 = 51.047.

### R2-10 [P1] [확인] CHS 지름을 "Lip length" 인자 D 에서 읽는다 → MCP 에서는 늘 1 in 관
- 위치: `template.py:465-477` (`D = params.get('D', 6.0)` 를 바깥지름으로 씀), `src/mcp/server.ts:186, 204` (`D` = "Lip length", 전달은 `D: D || 1`), `python/design/aisi_s100.py:2244-2249` (`D` 기본 0.625 로 generate_section 호출)
- 근거: `t4_closed.py` — MCP 가 만드는 인자 `{H:6, B:6, D:1, t:0.1}` → 중심선 범위 ±0.45 (지름 1 in). 설계 경로 기본값 → ±0.262 (지름 0.625 in). H · B 는 무시된다.
- 영향: MCP 로 CHS 를 만들면 사용자가 준 H/B 와 무관한 단면이 조용히 만들어진다. 강도는 대개 작게(보수) 나오지만 결과는 틀린 단면의 값이다.
- 수정안: chs 는 `OD`(없으면 H) 를 받고, 지름 인자가 없으면 오류. MCP 는 type 별로 인자 설명을 나누고 `D || 1` 대체를 없앤다(lippedc 등에서 D 누락 시에도 1 in 립이 조용히 생긴다 — R8).
- 회귀 시험: MCP `set_section_template(type='chs', H=6, B=6, t=0.1)` → 중심선 지름 5.9, A = π·5.9·0.1 ± 0.5 %.

### R2-11 [P1] [확인] hat 의 H/B 뜻이 MCP 설명과 반대다
- 위치: `template.py:399-430` (H = 상판(웹) 폭, B = 깊이(플랜지), D = 브림 — MATLAB `template_section_params.m:49-56` 의 C 규약 그대로), `src/mcp/server.ts:184-185` ("H: Height (web height)", "B: Width (flange width)")
- 근거: `t2_aisi.py` — 3HU4.5x135 를 엔진 규약(H=4.5, B=3.0, D=1.67) 으로 넣으면 Table I-8 과 A −0.29 %, Ix(대칭축) −0.04 %, Iy −0.19 %, J +0.38 %, ro −0.40 %, |xo| −0.8 %. MCP 설명대로(H=3 높이, B=4.5 폭) 넣으면 A +11 %, Ix −42 %, **Iy +121 %**, Cw +43 %, ro +25 %. 생성 형상은 폭 6.07 × 깊이 4.37.
- 영향: MCP 사용자가 그림의 높이/폭을 넣으면 다른 단면이 된다. 주 휨축 강성이 2배 넘게 과대될 수 있음(비보수).
- 수정안: MCP 설명에 hat 은 "H = 상판 out-to-out 폭, B = 전체 깊이, D = 브림 길이"라고 적거나, hat 만 이름 있는 인자(width, depth, brim)를 쓰게 한다.
- 회귀 시험: MCP 로 3HU4.5x135 를 문서대로 넣었을 때 Ixx(수평축) = 2.47 ± 1 %.

### R2-12 [P2] [확인] 퇴화 입력을 조용히 받아들인다
- 위치: `template.py:118-124` (`L_eff = max(L_eff, 0)`), `:345` (D=0 → d=−t/2), `:521, 588` (nseg 하한 없음), `cfs_centerline.py:298-304` (45 % 규칙), `:348-349` (n_arc=0)
- 근거: `t4_closed.py`, `t5_centerline.py`
  - lippedc D=0, r=0.2: 립 길이는 0 이지만 립 코너 호(90°)가 남아 허상 립이 생김 — A 0.9761 대 track 0.9580 (+1.9 %). D=0, r=0 이면 플랜지 중심선이 B−t(트랙은 B−t/2).
  - track B=0.6, r=0.8: 직선부가 0 으로 잘리고 호는 그대로 → 플랜지 out-to-out 0.9 (입력 0.6).
  - lippedc B=1, D=0.3, r=0.5: 범위 1.1 × 2.9 (입력 out-to-out 1.0 × 3).
  - custom 립 D=0.4 / 0.3, R=0.1875: 실제 호 반경 0.167 / 0.122 (요청 0.217), 경고 없음. 템플릿(반경 유지 · 형상 팽창)과 custom(반경 축소)의 처리가 서로 다르다.
  - t=0 허용(A=0, grosprop 이 Sx · Zx 등 키가 빠진 dict 를 돌려줌 `properties.py:158-159`), isect nseg=0 → ZeroDivisionError, custom n_arc=0 → ZeroDivisionError.
- 영향: 잘못된 형상이 조용히 해석된다(허상 립은 뒤틀림 좌굴을 막아 비보수 가능).
- 수정안: 생성 전에 검사 — t>0, nseg ≥ 1, n_arc ≥ 1, D=0 이면 립 · 립 코너 모두 제거(트랙으로 위임), 각 직선부 `L_flat − Σ r_c·tan(Δθ/2) < 0` 이면 오류, custom 반경 축소 시 경고를 결과에 넣기. grosprop 0 면적은 오류로.
- 회귀 시험: 위 입력마다 ValueError; `lippedc(D=0,r=0.2)` 가 `track` 과 같은 A.

### R2-13 [P2] [확인] custom 의 "자동 검증" 결과를 버린다
- 위치: `template.py:774-780` — `validate_section(...)` 의 반환값을 쓰지 않음. `expected_A` 비교, 립 방향, 경로 교차가 모두 결과에 나타나지 않는다(교차만 stderr 로 출력).
- 근거: `t5_centerline.py` — `expected_A=0.2`(실제 ≈ 0.43, 비 2.2)를 줘도 예외 · 경고 없음. 자기 교차 경로(5점)도 해석 모델로 만들어짐. 립 방향 휴리스틱(`cfs_centerline.py:621-660`)은 꼭짓점 평균 쪽을 향하는지만 봐서, 문서 예제 시그마의 아래 립이 플랜지 밖(y=−1)으로 나가도 'inward' 로 통과.
- 영향: 사용자 · AI 가 틀린 경로를 알아챌 기회가 없다.
- 수정안: `_gen_custom` 이 `validation` 을 반환 dict 에 넣고, 교차 · 면적비 실패는 오류로. 립 검사는 립 끝이 인접 플랜지의 안쪽 반평면에 있는지로 바꾼다.
- 회귀 시험: 자기 교차 경로 → ValueError; expected_A 비 0.5 → 결과에 status='fail'.

### R2-14 [P1] [확인] outer_side 의 글 규칙이 코드와 반대다
- 위치: 코드 `cfs_centerline.py:125-183` (점을 `outer_side` 쪽 법선으로 t/2 옮김 → 'left' 는 사실상 "판 안쪽(재료)이 진행방향 왼쪽"), 설명 `src/mcp/server.ts:221, 345-349`, `cfs_centerline.py:96-98`, `Example/CFS_CENTERLINE_ALGORITHM.md:55`, `Example/임의단면형상모델링방안.md:186` ("바깥면이 왼쪽이면 'left'")
- 근거: `t5_centerline.py` — 웹이 오른쪽인 C 경로(아래 립 → 아래 플랜지 +x 진행)에서 바깥면(−y)은 진행방향 오른쪽이므로 글 규칙은 'right'. 'right' 를 넣으면 중심선 범위 (2.559, 9.059) (맞는 값 2.441, 8.941), A +3.2 %, Ix +6.9 %. 'left' 만 맞다(문서 표의 "C → left" 는 규칙이 아니라 코드와 맞춘 값).
- 영향: 설명을 따르는 사용자는 단면이 t 만큼 부푼 모델을 얻는다(Ix · My 비보수). 안내문이 "부풀면 바꿔 보라"고 하지만 부푼 정도가 t 라 그림으로 알아보기 어렵다.
- 수정안: 이름과 설명을 코드에 맞춘다(`'left'` = "판 재료(안쪽)가 진행방향 왼쪽") 또는 자동 판별: 두 방향 모두 offset 해 중심선이 입력 외측 꼭짓점의 bounding box 안에 남는 쪽을 고르고, 둘 다 벗어나면 오류(R2-02 의 검사와 같이).
- 회귀 시험: 위 C 경로에 outer_side 미지정 → 중심선 범위 (2.441, 8.941).

### R2-15 [P2] [확인] CHS 는 24 현 내접 다각형이다
- 위치: `template.py:465-477` (MATLAB `template_build_model.m` chs 는 32 요소)
- 근거: `t1_sharp.py` — D=6, t=0.1: A −0.29 %, I −1.42 %, J −1.98 %. 다른 템플릿과 달리 좌하단 원점 이동을 하지 않는다(중심이 원점).
- 영향: 과소(보수), 작음.
- 수정안: 기본 32 이상 또는 등면적 보정(반경을 둘레가 같도록 키움).
- 회귀 시험: D=6, t=0.1 → I 가 π r_c³ t 의 0.5 % 안쪽.

### R2-16 [P2] [확인] Sx · Sz 를 중심선 극단 절점 거리로 나눈다
- 위치: `properties.py:186-196`; 설계 경로가 `Sf = Sx` 로 씀(`python/design/aisi_s100.py:2277`)
- 근거: `t2_aisi.py` — 800S200-54: 엔진 Sx 1.6538 대 AISI 1.64 (+0.84 %); 같은 Ix 를 D/2 로 나누면 1.6421. 9CS2.5x059 r=0: 2.404 대 Ix/(H/2) 2.389 (+0.66 %).
- 영향: My = Fy·Sf 가 약 t/D 만큼 비보수(AISI Sf 는 최외단 섬유). CUFSM yieldMP 도 중심선을 쓰므로 DSM 비율과의 일관성 문제와 같이 정해야 한다(R5).
- 수정안: 최외단 섬유 거리 = 중심선 극단 + t/2 (해당 극단 요소의 두께)로 Sx, Sz 를 계산하거나, 두 값을 모두 돌려주고 설계 경로가 최외단 값을 쓰게.
- 회귀 시험: 800S200-54 (r=0.0849) → Sx = 1.64 ± 0.3 %.

### R2-17 [P2] [확인] 끊어진 모델(두 덩어리)에 cutwp 가 조용히 값을 낸다
- 위치: `python/cfsm/base_vectors.py:169-178, 236-245` (한 끝도 방문하지 않은 요소를 그냥 집는 fallback — MATLAB 에는 없음)
- 근거: `t4_closed.py` — 앵글 두 개(10 in 떨어짐): Xs=2.17, Zs=1.98, Cw=17.98 를 경고 없이 반환.
- 영향: 잘못 그린 모델(연결 안 된 절점)이 그럴듯한 J · Cw · xo 를 낸다.
- 수정안: fallback 대신 "disconnected section" 오류. (R3 파일이지만 cutwp 경로 전체가 이 함수에 기댄다.)
- 회귀 시험: 위 입력 → 예외.

### R2-18 [P3] [확인] 엔진 cfs_centerline 과 Example 사본이 갈라졌다
- 위치: `python/engine/cfs_centerline.py` 대 `Example/cfs_centerline.py` (diff 532줄)
- 현상:
  1. `corner_radii` 의미: 엔진 클래스는 중심선 반경으로 그대로 씀(`:1009-1010`, docstring 은 "내측 반경"), Example 은 `+t/2` 를 더함(`Example:537`). 엔진은 `template._gen_custom:757-758` 에서 미리 더해 결과는 맞지만, 클래스를 직접 쓰면 다르다(t9: A 0.8988 대 0.8957).
  2. `make_c_section` · `make_z_section` 아래 립: 엔진 `(0,−D)` · `(B_bot,−D)` = 바깥으로 뻗음(오류), Example `(0,D)` = 안쪽. 엔진에서는 `__main__` 외 호출처가 없지만 `CFS_CENTERLINE_ALGORITHM.md:176-180` 이 쓰라고 안내한다(make_z_section 중심선 깊이 8.94).
  3. 호 방향 계산 방식은 다르지만(while+보정 대 modulo) 유효한 필렛(호 각 < π)에서는 결과가 같다(t9: 좌표 차 0.0).
  4. 엔진만 검증 함수 · SectionBuilder · sigma 팩토리를 가진다. 엔진 `__main__` 은 `/home/claude/...` 에 저장한다.
- 수정안: Example 사본을 지우거나 엔진에서 다시 만들고, 엔진 팩토리의 아래 립을 `+D` 로, `corner_radii` docstring 을 "중심선 반경" 으로.
- 회귀 시험: `make_c_section(6,2,0.625,0.054,3/16)` 첫 꼭짓점 y = +0.625.

### R2-19 [P3] [확인] 참고 문서의 수치 · 예제 오류
- `Example/III-3.md:84-91` 의 "Gross Section" 표(Ix 1.46, Iy 0.111, xo −1.13, J 0.000130, Cw 0.713)는 550S162-33 값이다. 362S162-54(Table I-2)는 Ix 0.873, Iy 0.154, xo −1.28, J 0.000451, Cw 0.457(엔진 0.87185 / 0.15396 / −1.2795 / 0.00045026 / 0.4318 — Cw 는 각진 모서리 근사 차). 같은 문서는 362S162-54 를 "Z-section" 으로 적었다(S = C형 스터드).
- `Example/CFS_CENTERLINE_ALGORITHM.md:40-51` 시그마 예제의 아래 립 `(0,−1)→(0,0)` 은 플랜지 아래로 나가 깊이 9 in 이 된다("8×2.5" 와 모순), 위 · 아래 립 길이도 다르다(0.875 / 1.0).
- 수정안: 표 값 교체, 예제 꼭짓점을 `(0, 1.0)` 로.

### R2-20 [P3] [확인] 직렬화 · 단위 · 기본값
- `python/models/data.py:216-218, 251-253`: ndarray 의 NaN/Inf 는 **0.0**, 스칼라는 null — 같은 인코더 안에서 규칙이 다르고, 배열 속 NaN 이 0 으로 바뀌어 "0 결과"로 보인다. `from_dict` 는 node/elem 모양을 검사하지 않는다.
- 단위 가정 상수: `properties.py:31` (`n_fib = L/0.1` — in 가정; mm 좌표면 섬유가 25배), `cfs_centerline.py:522` (`max(..., 1)` = 1 in), `:578` 메시지 "in²". 엔진 내부 단위가 US 이므로 지금은 문제없지만 desktop 이 SI 좌표를 직접 넘기면 성능 · 허용오차가 달라진다.
- `generate_section` 은 빠진 치수를 조용히 기본값으로 채운다(예: lippedc t 누락 → 0.1 in, H 누락 → 9 in; custom t 누락 → 0.0451). 필수 치수 누락은 오류가 맞다.

## 맞다고 확인한 것

- 치수 규약: lippedc · track · lippedz(90°) · hat · rhs · angle · lipped_angle 은 out-to-out 입력, r = 내측 반경 → r_c = r + t/2, 직선부 = out-to-out − 2R_o (90° 코너) — MATLAB `template_build_model.m` · AISI Part I §3 과 같다(lippedc 중심선 범위 2.441 × 8.941 = B−t × H−t).
- `_snakey` 는 MATLAB `snakey.m` 을 줄 단위로 옮겼다(1→0 기준 인덱스, wrap_pi, 코너 트림 r·tan(|Δθ|/2), 현 길이 2r sin(Δθ/2n), 폐합 처리, 좌하단 원점 이동).
- r=0 닫힌 해 대비 0.00 %: lippedc(A, Ix, Iy, J, Cw, xo — AISI 각진 모서리 식), track(같은 항목), lippedz(A, Ix, Iy, Ixz, J, Cw, xo=zo=0), hat, angle(전단중심 = 코너), lipped_angle, rhs(A, I, **Bredt J** = 10.805; 열린 단면 J 였다면 0.0065), tee(전단중심 = 접합점, Cw=0), isect(전단중심 중앙, Cw 식 — 플랜지 폭 문제 R2-09 만).
- 둥근 모서리: RHS r=0.2 의 A −0.05 %, J(Bredt, 둥근 코너 A0) +0.01 %. AISI 표 대비(9CS2.5x059, 800S200-54, 550S162-33, 362S162-54, 600T200-68, 550T125-54, 3HU4.5x135): A · Ix · Iy · x̄ · J · ro 는 0.4 % 안, xo 는 1.5 % 안. Cw 2.2 – 12.7 % 낮음은 AISI 가 Cw · m · j 를 각진 모서리 근사로 계산한 차이다(r=0 엔진값 11.906 = 표 11.9).
- j(=B2/2): 독립 적분 4.7883 = AISI 식 4.7883 = 엔진 4.7883 (9CS2.5x059 각진). 표의 5.10 은 둥근 모서리 A · I 를 섞은 근사.
- 소성단면계수 Zx(lippedc r=0) 닫힌 해와 일치.
- 주축: grosprop 와 cutwp 의 θp · I11 · I22 가 Z 에서 일치, Ixz 부호(위 플랜지 +x → Ixz>0)가 AISI 그림과 같음, 등변 앵글(Ixx=Izz) 특수 분기도 atan2 결과와 같은 45°.
- xo 부호: 템플릿 C(웹 x=0, 립 +x) 에서 xo<0 — AISI 표 부호와 같다. 설계 경로는 `abs()` 를 써 E2.2 에는 영향 없음(아래 "다른 영역" 참고).
- `_cutwp_prop2` 의 열린 단면 경로는 MATLAB `cutwp_prop2.m:190-279` 와 식 · 인덱스가 같다(전단중심 식은 따로 유도해 확인). 가지 단면(I, T)의 traversal 도 정상.
- grosprop 의 두께방향 자기관성 생략은 cutwp_prop2 박벽 관례와 같고 의도로 문서화돼 있다.
- 엔진/Example cfs_centerline 의 호 생성은 유효 입력에서 같은 좌표를 낸다.

## 확인하지 못한 것

- 일축대칭 폐단면의 실제 전단중심 · Cw 크기(R2-08) — 셀 전단류 독립 해석을 만들지 않았다.
- R2-01 의 영향을 시그마 · 랙 단면(AISI II-13, III-14)에서 재지 않았다 — FSM 실행 · 최소점 추출은 R1/R5 영역이라 9CS 한 경우만 쟀다.
- MATLAB 을 실제로 돌리지 않았다(원본 대조는 읽기로만).
- MCP 경로(SI 변환, set_custom_section 의 단위 — 이 도구에는 units 인자가 없어 mm 좌표를 넣으면 inch 로 해석될 것으로 보임)는 R8 영역이라 엔진 입력만 재현했다.
- `Example/SPECIFICATION.md` 는 검색만 했다(관련 규칙 없음). `Example/임의단면형상모델링방안.md` 는 outer_side 규칙(§4.4)만 대조했다.

## 다른 리뷰어 영역에 걸치는 것

- R8: `server.ts:204` `D: D || 1` — D 를 안 주거나 0 으로 주면 1 in 립 · 1 in CHS 가 생긴다. hat/qlip/r 설명 부족. set_custom_section 단위 인자 없음.
- R4: `aisi_s100.py:2242-2249` `_auto_generate_props` 의 기본값(H=8, B=2.5, D=0.625, t=0.0451) 으로 단면을 조용히 만든다 · chs 는 D=0.625 관. `xo = abs(Xs − xcg)` 로 부호를 버린다 — F2 의 단축대칭 항(j, Cs)에 부호가 필요하면 틀린다. cutwp NaN → 0 대체(폐단면) 후 Fcre 경로.
- R5: Sx(중심선) 와 DSM My 일관성(R2-16).
- R3: `_cutwp_prop2` 는 `cfsm/base_vectors.py` 에 있다 — R2-06 · R2-07 · R2-17 은 그 파일을 고친다.
- R1: R2-01 은 FSM 결과 정확도 문제로 나타난다(요소 분할).

## 시험이 없는 동작 (test/python/)

- 어떤 템플릿의 단면 성질 값도 검사하지 않는다(`test_solver.py:150-160` 은 8종 "절점 > 0" 만; track · lipped_angle · custom · custom_builder 는 생성조차 시험 안 함).
- `cutwp_prop` / `_cutwp_prop2` (J, Cw, 전단중심, B1/B2, 폐단면 Bredt, 가지 단면) — 시험 없음.
- `cfs_centerline` 전체(offset, fillet, 45 % 축소, 검증 함수, SectionBuilder, outer_side) — 시험 없음.
- 퇴화 입력(r > 직선부, D=0, t=0, nseg=0), 경사 립, 원점 · 절점 순서, 폐단면 요소 방향 — 시험 없음.
- `models/data.py` 직렬화(NaN 처리) — 시험 없음.
- grosprop 은 "A>0, 유한"만 본다(`test_solver.py:40-47`).

## 읽은 파일

| 파일 | 줄 수 | 범위 |
|---|---|---|
| python/engine/template.py | 857 | 전부 |
| python/engine/cfs_centerline.py | 1445 | 전부 |
| python/engine/properties.py | 211 | 전부 |
| python/engine/cutwp.py | 61 | 전부 |
| python/models/data.py | 259 | 전부 |
| python/cfsm/base_vectors.py | — | 1-300 (`_cutwp_prop2`) |
| Example/cfs_centerline.py | 967 | diff 전체 |
| Ref_Source/analysis/cutwp_prop2.m | 285 | 전부 |
| Ref_Source/interface/snakey.m | 273 | 전부 |
| Ref_Source/interface/template/template_build_model.m | 605 | 전부 |
| Ref_Source/helpers/templatecalc.m, template_out_to_in.m | — | 전부 |
| Ref_Source/interface/template/template_section_params.m | — | hat/rhs/angle/chs/isect 정의 |
| Example/CFS_CENTERLINE_ALGORITHM.md | 226 | 전부 |
| Example/I-8B, II-1C, II-2B, II-4B, II-5, II-6B, II-7B, II-13, II-14, III-3, III-5B, III-7B .md | — | 기하 · 성질 절 |
| src/mcp/server.ts | — | 170-440 |
| src/webview/StcfsdPanel.ts | — | 995-1018 |
| python/server.py | — | 40-100, 205-230 |
| python/design/aisi_s100.py | — | 2225-2335 |
| test/python/test_solver.py | — | 전부 훑음 |
| AISI skill: dimensions-properties/Section_2_Cross_Section_Tables.md (Table I-1/2/3/4/6/8 해당 행), Section_3_Property_Calculations.md (§3 주의사항), Example I-3 | — | 해당 부분 |

스크립트(스크래치): `C:\Users\USER\AppData\Local\Temp\claude\3df7e1c8eb560f18\99d094e4-961f-4f09-9be9-02ec03b2e201\scratchpad\review\R2\` — `common.py`, `polyref.py`(독립 박벽 적분기), `t1_sharp.py`, `t2_aisi.py`, `t3_lip_angle.py`, `t4_closed.py`, `t5_centerline.py`, `t6_mesh_fsm.py`, `t7_misc.py`, `t8_j.py`, `t9_copies.py`.
