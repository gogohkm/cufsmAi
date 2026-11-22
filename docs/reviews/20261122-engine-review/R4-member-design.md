# R4 — 부재 설계 (AISI S100-16 D·E·F·H, C1, A3.3.2, I6.2.1)

## 요약

발견사항 수: **P0 0 · P1 6 · P2 9 · P3 3** (총 18).

강도식 자체(E2-2/-3, E2.1, E2.2-1, E2.3, E3.2.1, E4.1, F2.1-3~-5, F2.1.1-1, F2.1.3-1, F2.1.4-1/-2, F2.3-2~-4, F2.4.2-1, F3.2.1, F3.2.3-1, F4.1, F4.3-1, D2, D3, H1.1, H1.2, H2-1, H3-1~-3, C1.2.1.1-3/-4, Appendix 2 β)와 φ/Ω는 원문과 맞는다. 매뉴얼 예제 11개(III-3, III-14, II-1A/1B/1C, II-2B, II-4A/4B, II-8, II-9, III-6, III-11)를 공개 진입점 `design_member`(server.py `aisi_design`)로 끝까지 돌려 모든 중간값이 매뉴얼 인쇄값과 ±0.6% 안에서 맞았다(EWM 대 DSM 차이 1건만 1.6%).

결함은 식이 아니라 **입력이 빠지거나 어긋났을 때 조용히 쓰는 대체값**과 **판정을 합치는 방식**에 있다. 비안전측으로 확인한 것은 다음과 같다. (1) Pcrl/Mcrl=0 이면 국부좌굴을 경고 없이 건너뛰고 합격을 낸다(이용률 1.21 → 0.98 합격). (2) H3 에 웹 크리플링 단독 검토(P̄≤Pa)가 없어 반력 1.15φPn 이 합격한다. (3) DSM 해석 Fy 와 설계 Fy 가 다르면 Py·My 를 해석 Fy 값 그대로 써서 Pne 가 +40%, Mne 가 Sf·Fy 를 넘는다. (4) 전단중심 편심이 z 방향인 단축대칭 단면은 휨-비틀림좌굴을 건너뛰고 플래그도 세우지 않는다(Pne +31%). (5) 앵글의 (P)L/1000 이 Muy=0 이면 May=1e10 으로 나뉘어 효과가 없다. (6) props 가 없으면 기본 C 단면을 경고 없이 설계한다. 보수측이지만 고칠 것도 있다. 폐단면(RHS/CHS)·트랙은 E4/F4 가 적용되지 않는 단면인데도 거의 항상 `pass=None` 이 된다. NG 판정을 `pass=None` 이 덮어쓴다.

## 발견사항

### R4-01 [P1] [확인] Pcrl/Mcrl=0 이면 국부좌굴(E3/F3)을 경고 없이 건너뛰고 합격 판정
- 위치: `python/design/aisi_s100.py:543-577`(압축), `:853-874`, `:909-911`(휨), `:475-479`, `:811-815`(경고는 둘 다 0일 때만), `:730-741`, `:1357-1380`(pass 무효화는 왜곡만)
- 현상: 압축은 `Pcrl==0`, 휨은 `Mcrl==0` 일 때 해석적 fallback 이 C/Z/track 이면서 `h_web`·`b_flange`·`t` 가 있을 때만 돈다. 아니면 `Pnl=Pne`(`Mnl=Mne`)가 된다. 다음 경우가 여기에 해당한다. ① C/Z 인데 기하가 없을 때, ② I·RHS·CHS·hat·angle 처럼 fallback 범위 밖일 때, ③ fallback 이 예외로 실패했을 때(이때는 경고 문자열만 있다). 결과에는 `local_not_evaluated=True` 만 남고, `pass`·`utilization_valid` 는 그대로다. 경고도 Pcrd/Mcrd 까지 0일 때만 생긴다. 왜곡(E4/F4) 쪽은 같은 상황에서 `pass=None` 으로 막는데 국부 쪽은 막지 않아 서로 맞지 않는다.
- 근거: E3 "All members shall be checked for potential reduction … due to interaction … with local buckling", F3 도 같다. 수치: `scratchpad/review/R4/probes.py` A.
  - III-3 단면(362S162-54), KL=24 in, Pu=15 kips, Pcrl=0, Pcrd=40 → Pn=17.96, util=0.983, **pass=True**, warnings=[]. 같은 부재에 Pcrl=0.75Py → Pn=14.64, util=1.206, pass=False.
  - RHS 6×6×⅛, Pcrl=0 → Pnl=Pne=113.5, pass=True, warnings=[]. 조합(probes2 T)에서도 pass=True 가 전파된다.
- 영향: 비안전측. 국부좌굴이 지배하는 단면에서 강도를 최대 Pne/Pnl 배 과대평가한다(예에서 23%). FSM 곡선에서 국부 극소를 찾지 못한 경우나 API·데스크톱에서 기하 없이 호출한 경우에 생긴다.
- 수정안: `local_absence_verified` 가 아니고 결과적으로 `Pcrl<=0`(또는 `Mcrl<=0`)이면 다음을 모두 한다. `warnings` 에 "E3(F3) 미평가" 문구를 넣고 `pass=None`, `utilization_valid=False` 로 둔다(이미 False 인 판정은 유지, R4-08 참조). round-HSS F3.1.1 스킵은 예외로 둔다. fallback 이 성공한 경우에도 `dsm_source` 와 함께 경고를 유지한다(지금도 있음).
- 회귀 시험: III-3 props, KxLx=KyLy=KtLt=24, Pu=15, dsm={Pcrl:0, Pcrd:40, Py:21.1}, section 없음 → `pass is None`, `utilization_valid is False`, 경고에 'E3'. 휨도 같은 꼴(9CS2.5x059, Mcrl=0, section 없음).

### R4-02 [P1] [확인] §H3 에 웹 크리플링 단독 검토(P̄ ≤ Pa, M̄ ≤ Malo)가 없어 크리플링 NG 가 합격
- 위치: `aisi_s100.py:1527-1552`, `interaction.py:62-165`
- 현상: `web_crippling()` 결과(`phi_Pn`, `Pa`)는 `result['web_crippling']` 에 저장만 되고, 판정에는 H3 상호작용식만 들어간다(`_merge_governing_check(..., 'H3 ...')`). H3 의 우변은 1.33φ(H3 φ=0.90)이고 웹 크리플링 φw 는 0.75~0.9 사이다. 그래서 M≈0 이면 P̄ 가 φwPn 을 넘어도 통과한다. H3 의 M̄ 자리에는 반력 위치의 모멘트가 아니라 부재 최대 `Mu` 를 쓴다.
- 근거: §H3 첫 문단 "…shall be designed such that … $\overline{M} \le M_{a\ell o}$ and $\overline{P} \le P_a$. In addition, … Eq. H3-1…". 수치: `probes.py` E. 9CS2.5x059(t=0.059), Fy=50, EOF, N=3 in → Pn=1.39, φw=0.85, φPn=1.18 kips. 반력 P=1.357(=1.15φPn), Mu=1 kip-in → H3 total=0.898 ≤ 1.197, **pass=True, utilization=0.75**.
- 영향: 비안전측. 끝 지점(EOF, M≈0)에서 웹 크리플링 강도를 최대 1.33·0.90/(0.91·φw) 배까지 과대 허용한다(φw=0.85 이면 1.55배). 지금은 `Mu`(최대 모멘트)를 M 항에 넣기 때문에 보통의 보에서는 이 효과가 가려진다. 그래서 M 이 작은 경우에만 드러난다.
- 수정안: H3 앞에 `wc_check = {'total': P/Pa, 'pass': P <= Pa}` 를 만들어 `_merge_governing_check(result, wc_check, 'G5 web crippling')` 를 부른다. 여기서 Pa 는 LRFD 면 φwPn, ASD 면 Pn/Ωw 다. M̄≤Malo 도 같은 방식으로 넣는다(Malo=φ·Mnfo 또는 Mnfo/Ω). M̄ 은 반력 위치 모멘트를 받는 별도 키(`wc_M`)로 바꾸고, 없을 때만 `Mu` 를 쓰고 경고를 남긴다.
- 회귀 시험: 위 입력(Pu=1.357, Mu=1.0, wc_N=3, wc_R=0.1875, EOF) → `pass is False`, `governing_check=='G5 web crippling'`, utilization≈1.15.

### R4-03 [P1] [확인] DSM 의 Py·My 를 해석 Fy 기준값 그대로 사용 — 설계 Fy 와 다르면 Ag·Sf 가 바뀜
- 위치: `aisi_s100.py:481-484`(`Py = Py_dsm if Py_dsm>0 else Ag*Fy`, `Ag_eff = Py/Fy`), `:502`(`Pne = Ag_eff·Fn`), `:639`, `:824-825`(`My = My_dsm*scale`, `Sf_eff = My/Fy_eval`). 경계 쪽 원인은 `src/webview/StcfsdPanel.ts:1469-1499` 다. prepared DSM 이 설계 Fy 와 맞지 않으면 **해석 Fy(aFy)** 로 다시 추출해 그 Py·My 를 그대로 넘긴다.
- 현상: 엔진이 `Py_dsm` 과 `Ag·Fy` 를 비교하지 않는다. 해석 Fy 가 설계 Fy 보다 크면 유효 면적·단면계수가 그 비율만큼 커진다. 주석의 "Pcrl = LF×Py_dsm 이므로 Py 도 같은 값을 써야 λ 가 일관"이라는 논리는 틀렸다. Pcrl·Mcrl 은 절대값이므로 Py 는 Eq. E4.1-4(Py=AgFy), My 는 Eq. F2.1-2/F4.1-4(My=SfyFy)로 설계 Fy 에서 잡아야 한다.
- 근거: Eq. E2-1, E4.1-4, F2.1-1/-2. 수치: `probes2.py` P. III-3, 설계 Fy=50.
  - dsm.Py 를 Fy=70 에서 뽑은 값(29.54)으로 주면 → Pne=9.60 (정답 6.86, **+40%**), Pnd=20.11 (정답 16.48).
  - 9CS2.5x059 휨, 설계 Fy=55, dsm.My 를 Fy=70 에서 뽑으면 → My=Mne=160.3 kip-in (> Sf·Fy=126), Mn=107.4 (정답 92.6, **+16%**).
  - 반대 방향(해석 Fy<설계 Fy)은 과소평가(보수측)다.
- 영향: 비안전측. VS Code 확장 경로에서 해석 Fy 와 설계 Fy 를 다르게 두면 생긴다.
- 수정안: 엔진에서 `Py = Ag*Fy`, `My = Sfy*Fy` 로 늘 다시 계산한다. `Py_dsm`·`My_dsm` 은 비교용으로만 쓴다: `abs(Py_dsm/(Ag*Fy)-1) > 0.02` 이면 경고, 비대칭 단면의 My 는 `My_dsm*(Fy/Fy_analysis)` 로 비례 보정. dsm 딕셔너리에 `fy_analysis` 를 실어 보내도록 확장 쪽 계약을 바꾼다(R8).
- 회귀 시험: III-3 props, Fy=50, dsm.Py=0.422×70 → Pne=6.86±0.05. 휨 Fy=55, dsm.My=2.29×70 → My=125.95, Mn=92.55.

### R4-04 [P1] [확인] 단축대칭 판정이 x 방향 xo 에만 의존 — z 방향 전단중심 편심 단면은 휨-비틀림좌굴(E2.2) 누락, 플래그도 없음
- 위치: `global_buckling.py:15-51`(`resolve_xo_ro`: `Xs-xcg` 만 봄), `:188-204`(`use_ft`, `ft_not_evaluated`), `:217-222`(σex 를 대칭축으로 가정). 확장 쪽 `StcfsdPanel.ts:1435` 는 cutwp 가 실패하면 `Xs = xcg` 로 채워 `xo_source='Xs-xcg'` 를 만든다. 그러면 'zero' 판정(P1-1 플래그)이 무력화된다.
- 현상: C·트랙을 웹 수평으로 모델링하면(사용자 정의 단면, 회전 배치) 전단중심 편심이 z 축 방향에 생긴다. 이때 `Xs==xcg` 라서 xo=0 이 되고, `xo_source='Xs-xcg'` 이므로 `ft_not_evaluated=False` 다. 결국 이중대칭 분기 min(σex,σey,σt) 를 탄다. E2.2 의 "x-axis shall be the axis of symmetry" 를 확인하는 코드가 없다.
- 근거: §E2.2 Eq. E2.2-1, "For singly-symmetric sections, the x-axis shall be selected as the axis of symmetry." 수치: `probes.py` C. III-3 성질, xo 대신 Xs=xcg=2.0, zcg=1.28 → Fcre=24.42 (torsional), Pne=8.96, pass=True, ft_not_evaluated=False. 정답(매뉴얼 III-3)은 Fcre=18.5, Pne=6.88 → **+31%**.
- 영향: 비안전측. 템플릿 C(웹 수직)는 해당이 없다. 사용자 정의·회전 단면과 cutwp 실패 때 생긴다.
- 수정안: `resolve_xo_ro` 가 `(Xs-xcg, Zs-zcg)` 를 모두 보게 한다. |Zs-zcg| > tol 이고 |Xs-xcg|≈0 이면 대칭축을 z 로 보고 σex↔σey(rx↔ry, KxLx↔KyLy)를 바꿔 E2.2 를 적용한다. 둘 다 0이 아니면 E2.4(비대칭) unsupported 로 보낸다. 주축 회전(thetap≠0, Ixz≠0)인 단축대칭은 주축 성질(I11/I22)로 rx, ry 를 잡는다. 확장 쪽 `Xs` 기본값 채우기는 없앤다(R8).
- 회귀 시험: III-3 성질에서 xo 를 빼고 Xs=xcg=2.0, Zs=0, zcg=1.28 → Fcre=18.5±0.2, Pne=6.86±0.05(또는 unsupported 경고와 Pn=0).

### R4-05 [P1] [확인] 앵글 §H1.2 (P)L/1000 — Muy=0 이면 May=1e10 으로 무력화, B1 미적용, 립앵글 오면제, 압축 전용 경로 누락
- 위치: `aisi_s100.py:1612-1625`(Muy=0 → `May_strength=1e10`), `:1656`, `:1661-1682`
- 현상:
  ① Muy=0 이면 `May=1e10` 이다. 그래서 `Muy_amp + P·L/1000` 을 넣어도 비율이 0이다. 그런데 `angle_l1000` 메모에는 "…이 지배"라고 적힌다.
  ② 추가 편심 모멘트가 증폭(B1) 뒤에 더해져 증폭되지 않는다. 매뉴얼 III-5B 는 B1·(P̄L/1000) 으로 쓴다.
  ③ `angle_exempt = Pnl >= Pne` 를 립앵글을 포함한 모든 앵글에 적용한다. 원문에서 면제는 "singly-symmetric **unstiffened** angle … Pnl=Pne" 에만 해당하고, 그 밖의 앵글은 늘 검토해야 한다.
  ④ `member_type='compression'` 인 앵글은 L/1000 을 전혀 고려하지 않는다(E3.1 주, III-5B 는 DSM 에서도 H1.2 로 검토).
- 근거: §H1.2 둘째 문단, 매뉴얼 III-5B p.488 Eq. H1.2-1 `{1.0/[1-1.60P/356]}(0.018)P/4.97`. 수치: `probe_angle.py`. lipped_angle, Muy=0, P=3, L=18 → My_ratio=0.0, total=0.862. 같은 부재에 Muy=1e-6, May=4.97 → My_ratio=0.0109, total=0.873.
- 영향: 비안전측. 앵글 기둥에서 약축 편심 모멘트 항이 모두 빠진다(세장 앵글에서는 수 %~수십 %). 앵글은 Fcre 사용자값이 있을 때만 계산되므로 범위는 좁다.
- 수정안: 앵글이고 면제가 아니면 Muy 와 상관없이 May_strength 를 필수로 받는다. 없으면 error 를 내거나, 약축 Mne=My 와 사용자 Mcrl 로 산정한다. Padd 를 `Muy + P·L/1000` 에 더한 다음 B1y 를 곱한다. 면제 조건은 `section_type in ('ANGLE',)`(무보강)이면서 Pnl≥Pne 인 경우로 좁힌다. compression 경로에서 앵글이면 H1.2(L/1000)를 요구하는 경고를 남기거나 combined 로 보낸다.
- 회귀 시험: III-5B 수치(ASD, Pa=3.84, May=4.97, Pe1y=356, L=18) → 매뉴얼 허용 P̄ 와 같은 H1.2 total. lipped_angle, Muy=0, May 없음 → error.

### R4-06 [P1] [확인] props 가 없거나 A=0 이면 기본 8×2.5×0.625×0.0451 립C 를 경고 없이 설계
- 위치: `aisi_s100.py:287-291`, `:2241-2246`, `:2415-2416`
- 현상: `params['props']` 가 없거나 `props['A']` 가 0이면 `_auto_generate_props` 가 `section_type='lippedc'`, H=8, B=2.5, D=0.625, t=0.0451 기본값으로 단면을 만든다. 그 단면으로 설계한 결과에는 이 대체를 알리는 문구가 없다. 생성이 실패하면 `print` 만 하고 넘어간다.
- 근거: README 4절 "빠진 입력을 기본값으로 채움". 수치: `probes.py` J. props, H, B, t 없이 compression 을 부르면 Py=31.73, pass=True, 기본 단면 경고 없음.
- 영향: 비안전측 가능성. 전혀 다른 단면의 강도를 합격으로 보고한다. 확장 경로는 props 를 넣지만, grosprop 이 A=0 을 돌려주는 단면이나 독립 프로그램·직접 API 호출에서는 바로 드러난다.
- 수정안: H·B·t(또는 D·t) 가운데 하나라도 명시되지 않으면 `{'error': 'Section properties missing'}` 를 낸다. 자동 생성을 했으면 `warnings` 와 `auto_generated_section: {type, H, B, D, t, r}` 를 결과에 싣는다.
- 회귀 시험: `design_member({'member_type':'compression','Fy':50,'KxLx':96,'KyLy':48,'KtLt':48,'Pu':3})` → `'error' in r` 또는 `r['auto_generated_section']` 과 경고.

### R4-07 [P2] [확인] 냉간가공 Fya 가 G2 전단·G5 웹 크리플링·H3 에도 들어감 (A3.3.2 적용 장 제한 위반)
- 위치: `aisi_s100.py:1092`(`Fy = state['Fy']` = Fya), `:1390`(shear_strength Fy), `:1511`(web_crippling Fy), `:1538-1542`(H3, Mnfo 도 Fya 기준)
- 근거: §A3.3.2 "Such increase shall be limited to Chapters D, E, F (excluding Section F2.4), Sections H1, I4, and I6.2…". 수치: `probes.py` F. Fy=33, Fu=45, R=0.0885 → Fya=34.33. 웹 크리플링 Pn 은 1.05 (virgin 1.01, **+4%**). 전단은 이 예에서 탄성좌굴이 지배해 같은 값이다.
- 영향: 비안전측. Fya/Fy 비율만큼 G5·항복지배 G2 를 과대평가한다(보통 수 %, 코너가 많은 단면에서는 10% 이상).
- 수정안: G2, G5, H2, H3 계산에는 `Fy_original` 을 넘긴다. Mnfo 도 virgin 상태(`_calc_flexure_state(Fy_original, ...)`)에서 가져온다.
- 회귀 시험: 위 입력 use_cold_work True/False → `web_crippling.Pn` 과 `shear.Vn` 이 같아야 한다.

### R4-08 [P2] [확인] `pass=None` 이 불합격(False) 판정을 덮어씀
- 위치: `aisi_s100.py:315`(B4 초과), `:739-741`, `:1378-1380`, `:1405-1407`, `:1524-1526`. 반면 `:1776` 조합은 False 를 보존한다.
- 현상: 미평가나 B4 초과 표시를 위해 `result['pass']=None` 으로 무조건 덮어쓴다. 그래서 이용률이 3~6 인 부재도 `pass=None`(미검토)으로 나온다. `generate_report` 는 None 을 'NG' 로 찍어 화면과 JSON 이 서로 다르다(`:2186`).
- 근거: 수치 `probe4.py`. RHS, Pu=300 → util=3.33, pass=None. C, R/t=25.4, Mu=500 → util=6.54, pass=None, 보고서는 "653.6% → NG".
- 영향: 판정 표시 결함이다. UI 나 MCP 가 None 을 '—' 로 보이면 명백한 NG 가 가려진다.
- 수정안: `result['pass'] = None if result.get('pass') is not False else False` 를 공통 헬퍼로 만들어 다섯 곳에 쓴다.
- 회귀 시험: 위 두 입력 → `pass is False`, `utilization_valid is False`.

### R4-09 [P2] [확인] E4/F4 가 적용되지 않는 단면(RHS·CHS 압축·트랙·무립 I)에서 Pcrd/Mcrd=0 → 늘 `pass=None`
- 위치: `aisi_s100.py:630-636`, `:730-741`(압축), `:953-960`, `:1378-1380`(휨, round HSS 만 예외)
- 현상: "C/Z fallback 범위 밖 + Pcrd=0" 이면 `distortional_not_evaluated` 와 `pass=None` 이 된다. 그런데 E4·F4 는 원문상 "flanges with edge stiffeners" 를 가진 개단면에만 적용된다. 폐단면과 무립 단면은 처음부터 E4/F4 대상이 아니다. 예제 재현에서 III-11(RHS 기둥-보), III-6(CHS 기둥-보), II-9(RHS 보)는 모두 `pass=None`, `utilization_valid=False` 가 나왔다.
- 근거: §E4 "shall apply to I-, Z-, C-, Hat, and other open cross-section members that employ flanges with edge stiffeners", §F4 도 같다. 매뉴얼 II-4A "distortional buckling does not need to be considered"(트랙), III-11 "not subject to … distortional buckling".
- 영향: 보수측(판정 불가)이다. 폐단면 부재는 사실상 판정이 나오지 않는다.
- 수정안: `_distortional_applicable(params)` 를 만든다. RHS/CHS/BOX/HSS/PIPE/TUBE 와 무립(TRACK, d_lip=0인 C/I)은 False 다. False 면 `Pnd=Py`(`Mnd=My`), `equation='N/A (E4/F4 not applicable)'` 로 두고 미평가로 표시하지 않는다.
- 회귀 시험: III-11 입력(ASD, P=45, M=15) → `pass is True`, `utilization_valid` 는 False 가 아님, compression.Pn≈106.1 (DSM, Pcrl=Fcrl·A).

### R4-10 [P2] [확인] CHS: 외경 `D` 를 립 깊이로 읽어 거짓 B4 위반 → `pass=None`. F2.3 경로의 경고·단계 문구도 틀림
- 위치: `aisi_s100.py:83`(`lip_o = section.lip_depth or params['D']`), `:86`, `:98-100`, `:386-390`. 확장 쪽 `StcfsdPanel.ts:1587-1589`(`storedSection.D` → `lip_depth`)도 원인이다. F2.3 경로에서 `compute_beam_Fcre` 가 CHS 를 unsupported 로 표시하는 부분은 `:835-836`, `:1170-1172`, `global_buckling.py:420-436`, 단계 문구는 `aisi_s100.py:1200-1215` 다.
- 현상: CHS 8.0×0.1 → `dsm_warnings=['Lip d/t = 79.0 > 60']`, `b4_limits_exceeded=True`, `pass=None`. 압축(probes M)과 휨(II-8) 모두 그렇다. 휨에서는 Mne 를 F2.3-3 으로 바르게 구하면서도 "§F2.1.5: Section type 'CHS' is outside implemented …" 경고를 붙인다. 단계 2 문구에는 "Fcre=0.00 ≤ 0.56Fy → Fn = Fcre = 48.12" 라고 찍힌다.
- 근거: Table B4.1-1 에는 원형관 D/t 항목이 없다. F2.3 은 별도 식이다. 수치: `chk_ii8.py`, `probes.py` M, `probes2.py` U-CHS.
- 영향: 보수측(판정 불가)이고 계산서가 틀리게 찍힌다.
- 수정안: `_section_geometry` 에서 원형관이면 `lip_o=d_lip=0` 으로 둔다(`params['D']` 를 립으로 읽지 않음). round 이면 `compute_beam_Fcre` 를 부르지 않고 `fcre_detail={'equation':'F2.3'}` 로 둔다. F2.3 이면 단계 2 문구를 `D/t` 구간 문구로 바꾼다. 확장은 CHS 의 D 를 `section.diameter` 로 넘긴다(R8).
- 회귀 시험: II-8(D=8, t=0.1, Fy=42, section_type='CHS', D=8) → `dsm_warnings` 없음, `pass is True`(Mu=1), warnings 에 'F2.1.5' 없음, φMn=221.2.

### R4-11 [P2] [확인] Table B4.1-1: 무립 플랜지(트랙·C 무립·앵글 다리)를 연단보강 한계 160 으로만 검사
- 위치: `aisi_s100.py:378-383`
- 현상: `b_flange/t ≤ 160` 하나로 검사한다. 립이 없는 플랜지는 "unstiffened element d/t ≤ 60" 을 적용해야 한다. RHS·hat 의 보강 플랜지는 w/t ≤ 500 이어야 하는데 160 으로 검사한다(과엄격).
- 근거: Table B4.1-1. 수치: `probes.py` L. 트랙 b/t=100 → `dsm_warnings=None`, pass=True.
- 영향: 비안전측. 적용 한계를 벗어난 단면에 Chapter E~H 의 φ/Ω 를 그대로 쓴다.
- 수정안: `has_lip`(d_lip>0)이면 160, 무립 개단면이면 60(unstiffened), 폐단면·hat 상부판이면 500 을 적용한다.
- 회귀 시험: 트랙 t=0.03, b_flange=3.0 → `'unstiffened' in dsm_warnings[0]`, `pass is None`.

### R4-12 [P2] [확인] 경고 없는 기본값·누락 성질 대체 (인장 An·Fu, KtLt, Lb_pos, rx/ry, Z 의 I22, Cb)
- 위치:
  - `aisi_s100.py:1896`, `:1902`(인장 `Fu=58.02`, `An=Ag`, 결과에 `warnings` 키 없음)
  - `:459-473`(KxLx·KyLy·KtLt 중 하나만 있어도 나머지 120 in 을 경고 없이 씀)
  - `:1414-1420`(`Lb_pos` 미지정 → 0 → 정모멘트 구간 완전 횡지지)
  - `global_buckling.py:129-130`, `:151-152`(rx·ry 가 없고 Ixx·Izz 도 없으면 σ=1e10)
  - `:137-138`, `:209`(I22 가 없으면 E2.3 이 기하 ry 를 씀)
  - `aisi_s100.py:756`(Cb 범위·캔틸레버 검사 없음)
- 근거:
  - D3("An = Net area"). 수치 `probes.py` I: Tu=30, An·Fu 미지정 → `controlling_mode='Rupture'`, Ta=38.34, `warnings=None`.
  - `probe3.py`: III-3 에서 rx 가 없으면 Pne=10.41 (정답 6.86, **+52%**), 경고 없음.
  - `probes.py` D: Z 기둥 I22 가 없으면 Pne=15.69, 있으면 3.77 (×4.2), 경고 없음.
  - F2.1.1 "For cantilevers … Cb shall be taken as unity": Cb=3.0 을 경고 없이 받음.
- 영향: 비안전측 가능성. 확장 경로는 grosprop 성질을 다 넘기므로 rx·I22 누락은 직접 API·데스크톱에서 생긴다. An 과 Lb_pos 는 일반 사용에서 생긴다.
- 수정안: An 이 없으면 `warnings.append('D3: An=Ag 가정 — 볼트 구멍 등 순단면 공제 확인')`. Fu 가 없으면 기본값 경고. 길이 세 개를 따로 검사해 빠진 것마다 경고. `Mu_pos>0` 인데 `Lb_pos` 가 없으면 경고. `rx`/`ry`/`J`/`Cw`(E2·F2 에 필요)가 없으면 Fcre 를 계산하지 말고 error 나 unsupported 로 보낸다(1e10 금지). point-symmetric 인데 I22 가 없으면 Ixx·Izz·Ixz 로 계산하고, 그것도 없으면 error. Cb>3 이나 cantilever 플래그가 있으면 경고.
- 회귀 시험: 인장 {A:0.881, Tu:30} → warnings 에 'An'. III-3 에서 rx 를 빼면 → 'error' 또는 unsupported. Z(I22 없음, Ixx/Izz/Ixz 있음) → Pne=3.77.

### R4-13 [P2] [확인] §I6.2.1 R 을 적용 조건 (a)~(o)와 표 값 검증 없이 그대로 적용
- 위치: `aisi_s100.py:1263-1288`
- 현상: 사용자 `R_uplift` 를 아무 값이나 받는다(R=1.0 이면 Mn=R·Mnlo 가 F4 를 제외해 Mn_dsm 보다 커짐). 깊이 ≤12 in, 60≤d/t≤170, 2.8≤d/b≤5.5, b≥2.125 in, 16≤w/t≤43, Fu/Fy≥1.08, 연단보강 플랜지, 단면이 C/Z 일 것 같은 조건과 Table I6.2.1-1 상한(0.40~0.70)을 확인하지 않는다. "연속보 지점 인접 변곡점 사이 구간·캔틸레버에는 적용 안 함"도 검사하지 않는다. 판정에서 Mne(LTB)를 함께 min 하는 것은 원문(Mn=R·Mnlo)보다 보수적이다.
- 근거: §I6.2.1. 수치: `probes.py` K. R=1.0 → Mn=93.62 > Mn_dsm=92.57, I6.2 경고 없음.
- 영향: 비안전측 가능성(R 을 크게 넣거나 범위 밖 단면에 적용할 때).
- 수정안: `_check_i621_limits(geom, Fy, Fu, section_type)` 를 만들어 위반 목록을 경고로 남기고 `utilization_valid=False` 로 둔다. `R_uplift > 0.70` 이면 경고한다. section_type 이 C/Z 가 아니면 error.
- 회귀 시험: 9CS2.5x059(d/t=152, d/b=3.6 OK), R=0.8 → 경고 'Table I6.2.1-1'. hat 에 R → error.

### R4-14 [P2] [확인] 이용률·지배 판정·보고서가 실제 판정과 다름
- 위치: `aisi_s100.py:1482-1490`(정모멘트 NG 가 pass 만 False 로 바꾸고 utilization·governing_check 는 그대로), `:1687-1777`(조합은 flex_x 의 positive_region NG 를 반영하지 않음), `:2184-2187`, `:2199-2205`(H3 라벨이 늘 '0.91(P/Pn)'), `:2213-2219`(보고서는 `dsm_warnings` 만 출력)
- 현상:
  - `probes.py` H: Mu_pos=110 > φMn(+)=83.3 이면 pass=False 지만 utilization 은 주 구간 값(≈0.59)이고 governing_check 는 비어 있다.
  - 텍스트 보고서에는 ft_not_evaluated, 기본 길이, fallback 실패 같은 `warnings` 가 하나도 찍히지 않는다.
  - H3-2/H3-3 도 "0.91(P/Pn)" 으로 찍힌다(값은 맞음).
- 영향: 사용자가 보는 이용률·사유가 판정과 맞지 않는다. 보고서만 보면 미평가 경고를 놓친다.
- 수정안: 정모멘트 검토를 `_merge_governing_check(result, {'total':util_pos,'pass':pass_pos}, 'F positive region')` 로 합친다. 조합에서 `flex_x.get('positive_region')` 도 합친다. 보고서에 `warnings` 전체 섹션을 넣고 `h3['P_term_label']` 을 쓴다. `pass is None` 이면 'N/A' 로 찍는다.
- 회귀 시험: probes H 입력 → `utilization≈1.32`, `governing_check=='F positive region'`. 보고서 문자열에 경고 문구가 들어 있어야 한다.

### R4-15 [P2] [확인] hat·angle·tee·사용자 단면의 E2/F2 는 Fcre=0 → Pn=Mn=0 (사용자 Fcre 없으면 판정 불능)
- 위치: `global_buckling.py:160-186`(supported_open 에 HAT 없음), `:420-436`, `aisi_s100.py:519-528`
- 현상: hat 은 단축대칭이라 E2.2 를 바로 적용할 수 있다(대칭축이 z 라서 R4-04 와 같은 축 바꾸기가 필요). 그런데 unsupported 로 Pn=0, pass=False 가 된다(`probes.py` N). 'C-section', 'Cee', 'stud' 같은 표기도 E2 에서 unsupported 가 되고(probes2 V), 휨에서 'Z-section', 'zee', 'ZS' 는 F2.1.5 unsupported 가 된다(Mne=0). 압축에서는 같은 표기를 Z 로 인식해 압축과 휨의 인식이 서로 다르다.
- 영향: 보수측(0 강도 불합격)이다. 일반 단면 템플릿(hat)을 쓸 수 없다.
- 수정안: 단면명 정규화를 하나로 만든다(`_canonical_section_type`: C/Z/TRACK/HAT/I/RHS/CHS/ANGLE…). E2.2 를 축을 바꿔 hat 에 적용한다. F2.1.2 를 구현하거나 FSM Mcre 를 쓰라는 안내를 error 문구에 넣는다.
- 회귀 시험: 매뉴얼 III-9B(hat DSM 기둥) → Pne 매뉴얼값. section_type 'Z-section' 휨 → F2.1.3.

### R4-16 [P3] [확인] 계산서 단계 문구·조항 인용 불일치
- 위치: `aisi_s100.py:1173-1197`(F2.1.4 폐단면에도 개단면 σey·σt 식을 0.00 으로 찍음, probes2 U), `:1146-1147`(`through_fastened` 이면 I6.1.2 를 인용하지만 계산은 하지 않음), `:1185`(E=29500 을 하드코딩한 문구)
- 수정안: 단계 '2a' 를 equation 별로 나눈다(F2.1.4 는 Lu·√(EGJIy) 문구). I6.1.2 는 실제로 적용할 때만 인용한다.
- 회귀 시험: II-9 RHS, Lb=2000 → step 2a formula 에 'σey' 가 없고 'Lu' 가 있어야 한다.

### R4-17 [P3] [확인] `_auto_generate_props` 의 `print()` 가 JSON-RPC stdout 에 섞임, `_last_detail` 은 함수 속성 전역 상태
- 위치: `aisi_s100.py:2268`, `:2409`, `:2416`, `global_buckling.py:363`, `:408`, `:425`, `:475`
- 현상: server.py 는 stdout 을 응답 채널로 쓴다. 지금 확장의 `JsonRpcProtocol.onData` 는 파싱 실패 줄을 버리므로 통신이 깨지지는 않는다. 다만 경고가 결과에 실리지 않는다. 독립 프로그램이 다른 전송을 쓰면 위험하다. `compute_beam_Fcre._last_detail` 은 동시 호출에서 다른 요청의 상세를 섞을 수 있다.
- 수정안: `print` 를 `sys.stderr` 나 결과 `warnings` 로 옮긴다. `compute_beam_Fcre` 가 (Fcre, detail) 을 함께 돌려주게 한다.

### R4-18 [P3] [확인] 원문 조항 미구현이 사용자에게 알려지지 않음
- 위치: 해당 분기 없음
- 현상: §H4(휨+비틀림, 플랜지 하중 C 퍼린), §E2.1.1(연신율 3~10% 폐단면 Rr), 구멍(E2.5/E3.2.2/E4.2/F2.2/F3.2.2/F4.2), §F2.1.2, §H2-2(전단보강), §C1 B2(P-Δ), 약축 DSM, LSD 가 구현되어 있지 않다. LSD 만 명시적으로 거부하고, 나머지는 경고가 없다. B4.1 검사가 인장(D장) 부재에도 적용되어 `pass=None` 을 만든다(`:305-322`). B4.1 은 E~H 에만 해당한다. H2 는 Malo 대신 Ma(φMn, LTB 포함)를 써서 보수측이다.
- 수정안: `design_member` 결과에 `not_checked: ['H4 torsion', 'holes', ...]` 를 늘 싣는다. 인장은 check_dsm_limits 에서 뺀다.

## 조항별 대조표

| 조항/식 | 코드 위치 | 판정 |
|---|---|---|
| D2 Tn=AgFy, Ω1.67/φ0.90 | aisi_s100.py:1910-1912, 1929-1934 | 일치 |
| D3 Tn=AnFu, Ω2.00/φ0.75 | :1920-1934 | 일치. An 기본값=Ag 경고 없음(R4-12) |
| D1 연결부 강도 한도(J장) | — | 미구현(경고 없음) |
| E2 Pne=AgFn, E2-2/E2-3/E2-4, Ω1.80/φ0.85 | global_buckling.py:58-79, aisi_s100.py:670-705 | 일치. Ag 대신 Py_dsm/Fy(R4-03) |
| E2.1 휨좌굴 | global_buckling.py:82-89, 213-216 | 일치. rx/ry 누락이면 1e10(R4-12) |
| E2.1.1 폐단면 Rr | — | 미구현 |
| E2.2-1/-3/-4/-5/-6 FT | :92-113, 217-222 | 일치(III-3 0.16%). 대칭축 x 가정을 검증하지 않음(R4-04) |
| E2.2 이중대칭 비틀림 min(E2.1, σt) | :213-216 | 일치 |
| E2.2 무보강 앵글 최소 r 예외 | — | 미구현(앵글 unsupported) |
| E2.3 점대칭 min(σt, 약주축 휨) | :206-212 | 일치(I22 있을 때). 없으면 기하 ry(R4-12) |
| E2.4 비대칭 | :171-186 | unsupported 로 거부(Pn=0). hat 도 여기로 빠짐(R4-15) |
| E2.5 구멍 | — | 미구현 |
| E3.2.1-1/-2/-3 | dsm_strength.py:14-41 | 일치. Pcrl=0 이면 무경고 생략(R4-01) |
| E3.2.2 구멍 | — | 미구현 |
| E4.1-1~-4 (Ω1.80/φ0.85) | dsm_strength.py:44-70 | 일치. 적용 단면 판별 없음(R4-09) |
| E4.2 구멍 | — | 미구현 |
| F2.1-1 Mne=SfFn≤My, F2.1-3/-4/-5 | global_buckling.py:297-312 | 일치 |
| F2.1.1-1/-3/-4/-5 | :438-466 | 일치(II-4A 0.07%, II-1A 0.03%). Ly=Lt=Lb, Ky=Kt=1 고정 |
| F2.1.1-2 Cb | 입력 | 범위·캔틸레버 검사 없음(R4-12) |
| F2.1.1-6, F2.1.3-2 (Iyc 대안식) | — | 미구현(허용 대안이므로 결함 아님) |
| F2.1.2 | :423-436 | 미구현, unsupported 처리 |
| F2.1.3-1 (÷2) | :468-472 | 일치(비 0.5 확인). 표기 인식이 압축과 다름(R4-15) |
| F2.1.4-1/-2 | :385-414 | 일치(II-9 Lu 0.03%, Mne 0.09%) |
| F2.1.5 | :422-436 | unsupported. CHS 에 거짓 경고(R4-10) |
| F2.3-1~-4, φ0.95/Ω1.67 | :276-295, aisi_s100.py:1293-1297 | 일치(II-8 0.05%). D/t>0.441E/Fy 이면 Mne=0(보수) |
| F2.4.1 요소기반 IR | — | 미구현(DSM 만) |
| F2.4.2-1/-2/-3 | :315-332 | 일치. 조건 Mcre>2.78My 만 있음(원문과 같음) |
| F3.1.1 원형관 국부 생략 | aisi_s100.py:882-890 | 일치 |
| F3.2.1-1~-3 | dsm_strength.py:77-102 | 일치. Mcrl=0 이면 무경고(R4-01) |
| F3.2.3-1/-3/-4 (a) | aisi_s100.py:896-908 | 일치. (b) 인장 선항복은 미구현이지만 (a) 가 보수 |
| F4.1-1~-5 | dsm_strength.py:105-130 | 일치(II-1B/II-2B/II-4B) |
| F4.3-1/-3/-4 (a) | aisi_s100.py:989-999 | 일치 |
| App.2 2.3.3.3-3 β | :966-983 | 일치(II-1B β=1.227 대 1.23) |
| A3.3.2 Fya, 국부/왜곡 비지배 게이트, F2.4 배제 | :1046-1090 | 게이트·F2.4 배제 일치. G2/G5/H3 에 Fya 유입(R4-07) |
| B4.1 Table B4.1-1 | :335-422 | 대부분 일치. 무립 플랜지 60 누락(R4-11), CHS 거짓 위반(R4-10), 인장 적용(R4-18) |
| C1.2.1.1-3 B1, α=1.0/1.6 | :1628-1651 | 일치(III-11 B1 1.271/1.257, III-6 1.101/1.051). Pe1 은 입력 KL 사용 |
| C1.2.1.1-4 Cm | :1582-1594 | 일치. 미지정이면 1.0+경고(MCP 는 1.0 을 명시 전달) |
| C1.2.1.1-6 B2 | — | 미구현(경고 없음) |
| H1.1-1/-2/-3 | :1781-1886 | 일치. Sft 대신 Sf 대체 |
| H1.2-1 | interaction.py:14-38 | 일치. 개별비≤1 은 합≤1 로 포함됨 |
| H1.2 앵글 L/1000 | aisi_s100.py:1661-1682 | 적용 범위 이탈(R4-05) |
| H2-1 | interaction.py:41-59, aisi_s100.py:1384-1404 | 식 일치. Malo 대신 Ma(보수) |
| H2-2 | — | 미구현(보수측 H2-1 로 대체) |
| H3-1/-2/-3, Ω1.70/φ0.90 (LSD 0.75/0.80) | interaction.py:62-165 | 식·계수 일치. P̄≤Pa, M̄≤Malo 누락(R4-02) |
| H4 | — | 미구현(R4-18) |
| I6.2.1-1, Ω1.67/φ0.90 | aisi_s100.py:1263-1288 | 식 일치. 적용 조건 미검사(R4-13) |
| LSD 전체 | :269-277 | 명시 거부(안전) |

φ/Ω 상수표(`aisi_s100.py:25-40`)는 모두 원문과 맞다: 압축 0.85/1.80, 휨 0.90/1.67, 원형관 휨 0.95/1.67, 인장 항복 0.90/1.67, 인장 파단 0.75/2.00, 전단 0.95/1.60.

## 매뉴얼 예제 재현 (스크립트 `scratchpad/review/R4/ex_repro.py`)

FSM 입력(Pcrl, Pcrd, Mcrl, Mcrd, FSM Fcre)은 매뉴얼 값을 넣었다.

| 예제 | 양 | 매뉴얼 | 도구 | 차이 % |
|---|---|---|---|---|
| III-3 (립C 기둥) | Fcre E2.2 FT (ksi) | 18.5 | 18.53 | +0.16 |
| III-3 | Fn (ksi) | 16.3 | 16.25 | −0.31 |
| III-3 | Pne (kips) | 6.88 | 6.86 | −0.29 |
| III-3 | Pnd (FSM Pcrd=1.11Py) | 16.49* | 16.48 | −0.03 |
| III-3 | φPn (매뉴얼은 EWM Pnl) | 5.74 | 5.83 | +1.57 |
| III-14 case 1 | Pnl / φPn / Pn/Ω | 30.9 / 26.3 / 17.2 | 30.92 / 26.28 / 17.18 | +0.06 / −0.08 / −0.12 |
| III-14 case 2 | Pne / Pnl / Pnd | 24.9 / 23.5 / 21.0 | 25.03 / 23.58 / 20.97 | +0.52 / +0.34 / −0.14 |
| III-14 case 2 | φPn / Pn/Ω | 17.9 / 11.7 | 17.83 / 11.65 | −0.39 / −0.43 |
| II-4A (트랙 LTB) | σey / σt / Fcre F2.1.1-1 | 26.28 / 36.48 / 58.6 | 26.28 / 36.48 / 58.56 | 0.00 / 0.00 / −0.07 |
| II-4A | Mne | 20.66 | 20.66 | −0.01 |
| II-4B | Mne / Mnl / Mnd | 20.5 / 19.6 / 19.0 | 20.53 / 19.62 / 19.01 | +0.15 / +0.10 / +0.05 |
| II-4B | φMn / Mn/Ω | 17.1 / 11.4 | 17.11 / 11.38 | +0.06 / −0.18 |
| II-1A (립C 보) | σey / σt / Fcre | 72.8 / 82.4 / 194 | 72.76 / 82.43 / 194.05 | −0.05 / +0.04 / +0.03 |
| II-1B | Mne / Mnl | 126 / 93.6 | 126.0 / 93.62 | 0.00 / +0.02 |
| II-1B | β / Mnd / φMn | 1.23 / 99.9 / 84.2 | 1.227 / 99.76 / 84.26 | −0.28 / −0.14 / +0.07 |
| II-1C (FSM Fcre=41.0) | Mne / Mnl / Mnd / φMn | 87.7 / 73.6 / 92.6 / 66.2 | 87.83 / 73.68 / 92.57 / 66.31 | +0.15 / +0.11 / −0.03 / +0.17 |
| II-2B (Z 보, ASD) | Mne / Mnl / Mnd / Mn/Ω | 107 / 86.2 / 81.7 / 48.9 | 107.0 / 86.19 / 81.74 / 48.94 | 0.00 / −0.01 / +0.05 / +0.08 |
| II-9 (RHS 보) | Lu / Mne | 1660 / 256 | 1659.5 / 255.76 | −0.03 / −0.09 |
| II-8 (CHS 보) | Mne / Mn/Ω / φMn(0.95) | 233 / 140 / 221 | 232.88 / 139.45 / 221.23 | −0.05 / −0.39 / +0.10 |
| III-11 (RHS 기둥-보) | Pe1 / B1 ASD / B1 LRFD | 337 / 1.27 / 1.26 | 337.4 / 1.271 / 1.257 | +0.12 / +0.10 / −0.23 |
| III-6 (CHS 기둥-보) | Pne(=A·Fn) / Pe1 / B1 ASD / B1 LRFD | 93.32 / 391 / 1.10 / 1.05 | 93.26 / 391.8 / 1.101 / 1.051 | −0.07 / +0.19 / +0.11 / +0.10 |
| III-6 | Max ASD / LRFD | 140 / 221 | 139.45 / 221.23 | −0.39 / +0.10 |
| D2/D3 손계산 | Ta LRFD / ASD | 34.13 / 22.75 | 34.12 / 22.75 | −0.01 / 0.00 |

\* 매뉴얼은 Table III-5 값(16.7)을 쓴다. 이 칸은 FSM Pcrd(1.11Py)를 E4.1-2 에 넣은 손계산값이다.

III-11·III-6·II-9 는 값은 맞지만 결과 판정이 `pass=None` 이다(R4-09, R4-10).

Z 보(F2.1.3-1 ÷2)는 매뉴얼 II-2A 가 F2.1.3-2(Iyc 식)만 쓰고 II-2B 는 FSM Mcre 를 쓴다. 그래서 닫힌식은 C 식 대비 비 0.500 으로만 확인했다(`probes2.py` V).

## SI 경로

엔진(`python/design/`)에는 SI 분기가 없다(`MPa`/`units` 검색 0건). SI↔US 변환은 전부 TS(`src/mcp/server.ts:775-921`, `src/mcp/siUnits.ts`)에서 한다. 엔진은 단위에 대해 선형이므로, 같은 물리 부재라면 변환 상수의 왕복(×6.89476÷6.89476)으로 같은 결과가 나온다. TS 출력 맵에서 확인한 문제는 R8 에 넘긴다.
- `SI_OUTPUT_COMBINED` 의 키(`Pa`, `Pc`, `Ma_x`, …)는 Python 결과에 없다. 중첩 `compression.Pn` 과 `flexure_x.Mn` 만 SI 로 바뀌고 `compression.design_strength`, `flexure_x.design_strength`, `flexure_y`, `amplification.Mux_amp`, `shear`, `web_crippling`, `positive_region` 은 US 그대로라서 단위가 섞인다.
- 모든 도구에서 `steps` 문구·`warnings` 수치는 US 로 남는다.

## 맞다고 확인한 것
- `dsm_strength.py` 4개 곡선의 계수·지수·경계(0.776, 0.561, 0.673), 음수 입력 가드, `evaluated:False` 표시.
- `column_global_strength` 의 λc 1.5 경계. `flexural_torsional_stress` 의 β≤0 처리. Pcrd fallback 이 실패하거나 범위 밖이면 `pass=None`. fallback 예외는 모두 경고로 표면화한다(국부는 R4-01).
- `combined_axial_bending` 과 `_demand_ratio`: 0 강도를 inf 로 처리, LRFD/ASD 일관(Pa=φPn↔Pn/Ω, Max, α=1.0↔1.6 이 같은 분기에서 결정됨, probes O).
- H1.1 두 식과 `-T/Ta` 항, Pu<0 → H1.1 분기, 인장에서 증폭 없음.
- A3.3.2: IR 과 동시 적용 차단, virgin 상태 Mnl=Mne·Mnd=My 게이트. LTB 로 줄어든 Mne 에서 게이트를 판정해도 실제 이득은 λ 경계에서만 생겨 의미가 없음을 확인했다(probes2 G2).
- F2.4.2·F3.2.3·F4.3 의 조건(Mcre>2.78My, λl=√(My/Mcrl)≤0.776 & Mne≥My, λd≤0.673)과 Cy≤3 상한. Mcrl·Mcrd 를 Fya 로 스케일하지 않음.
- 정모멘트 구간 β 미적용(`Mcrd_base`), 원형관 F3.1.1·F4 생략.
- LSD 명시 거부, 알 수 없는 design_method 거부.
- 압축 지배 모드 판정(전체좌굴이 지배할 때 국부·왜곡으로 잘못 표시하지 않음).
- `try/except` 전수: `:153`, `:166-170`, `:175-183`, `:197-211`(형상 키, 기본값 후 경고), `:550-569`/`:860-874`(국부 fallback, 경고만, R4-01), `:603-629`/`:929-952`(왜곡 fallback, pass=None), `:2248-2416`(자동 단면, print, R4-06/R4-17). 이 밖에는 없다.

## 확인하지 못한 것
- `design/loads/local_params.calc_Fcrl`, `distortional_params.calc_Fcrd` fallback 값의 정확도(R7 영역). 호출과 소비만 봤다.
- `shear.web_crippling`·`shear_strength`·`special_topics.cold_work_strength` 내부(R5 영역). 소비 측 Fy 전달만 확인했다.
- `local_detected=False`(cFSM 분류)를 근거로 E3/F3 를 통째로 생략하는 것이 타당한지는 분류 신뢰도에 달려 있다(dsm 추출, R1-R3/R5). 엔진은 그 플래그를 그대로 믿는다.
- 확장(`StcfsdPanel.ts`)의 단면 정보 추정(립 깊이 노드 탐색, Z flange_width=Δx/2)이 실제 템플릿과 맞는지(R8).
- III-1B·III-7B·III-9B 같은 through-fastened·hat 예제는 미구현 분기(I6.1.2, hat E2)라서 재현하지 않았다.

## 회귀 시험이 없는 동작 (test/python 검색 기준)
- `design_member` 경유 압축 end-to-end(E2.2 FT 수치 III-3, E2.3 Z, RHS/CHS 폐단면). 지금은 `column_global_strength` 단위 시험뿐이다.
- 인장(member_type='tension')과 H1.1(Pu<0) 전체.
- C1 B1 증폭 수치(ASD α=1.6 포함), Cm 계산, `amplification` 출력.
- 앵글 L/1000(`angle_l1000`).
- F2.1.4(Lu), F2.3(φ=0.95) design_member 경유. `test_solver.py` 의 RHS/CHS 는 FSM 이다.
- 비탄성 예비강도(`use_inelastic_reserve`), 정모멘트 구간(`Mu_pos`/`Lb_pos`), `b4_limits_exceeded` 와 pass 처리.
- Py/My 와 설계 Fy 의 일관성, Pcrl/Mcrl=0 의 국부 미평가 판정, H3 의 P̄≤Pa 단독 검토, 냉간가공 시 G2/G5 의 virgin Fy, I6.2.1 적용 한계, 자동 기본 단면 대체.
- ASD 경로의 압축·휨 end-to-end 수치.

## 읽은 파일
| 파일 | 줄 수 |
|---|---|
| python/design/aisi_s100.py | 2418 (전체) |
| python/design/dsm_strength.py | 130 (전체) |
| python/design/global_buckling.py | 485 (전체) |
| python/design/interaction.py | 165 (전체) |
| python/server.py | 200-279, 369-382 (aisi_design 분기, 입출력 루프) |
| src/mcp/server.ts | 770-930 (aisi_design_* 도구) |
| src/mcp/siUnits.ts | 139 (전체) |
| src/webview/StcfsdPanel.ts | 1380-1623 (aisi_design props/dsm/section 조립) |
| src/bridge/JsonRpcProtocol.ts | 45-75 |
| python/engine/template.py | 433-478 (rhs/chs) |
| Example/verify_all_examples.py | 231 (단면성질 전용 — 강도 검증 없음) |
| test/python/test_design_verification.py, test_regression_0926.py | 시험 목록과 관련 시험 본문 |
| AISI 스킬: Chapter_A(A3.3.2), B(B4.1), C(C1), D, E, F, H, I(I6.2.1) 명세; 예제 III-3, III-5B, III-6, III-11, III-14, II-1A, II-1B, II-1C, II-2A, II-2B, II-4A, II-4B, II-8, II-9 | 해당 절 |

확인 스크립트 (`C:\Users\USER\AppData\Local\Temp\claude\3df7e1c8eb560f18\99d094e4-961f-4f09-9be9-02ec03b2e201\scratchpad\review\R4\`): `ex_repro.py`, `probes.py`, `probes2.py`, `probe3.py`, `probe4.py`, `probe_angle.py`, `chk_ii8.py`.
