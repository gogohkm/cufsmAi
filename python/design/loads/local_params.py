"""국부좌굴 매개변수 (analytic fallback) — Appendix 1, Section 1.1, Eq. 1.1-4

FSM(signature curve)에서 국부좌굴 극소가 검출되지 않아 Pcrl/Mcrl=0 인 경우,
판요소(plate) 국부좌굴 공식으로 임계 국부좌굴 응력 Fcrl을 보수적으로 산정한다.

    Fcrl = k · π²E / [12(1 - μ²)] · (t/w)²              (Eq. 1.1-4)

여기서
  k = 판좌굴계수 (plate buckling coefficient)
    = 4.0  보강요소(stiffened element): 응력 방향에 평행한 양 종단이 모두
            웹/플랜지/립 등으로 지지되는 요소 (예: C/Z 단면 웹, 연단보강 플랜지)
    = 0.43 비보강요소(unstiffened element): 한쪽 종단만 지지되는 요소
            (예: 립 없는 단면의 플랜지, 립)
  w = 평탄폭(flat width) = 외-외 치수에서 코너분을 제외한 폭
  t = 두께
  μ = 포아송비 (0.3)

지배 요소 선정: 각 판요소의 Fcrl 중 최솟값이 국부좌굴을 지배한다(가장 세장한 판).
탄성 임계량 환산:
  압축: Pcrl_local = Fcrl · Ag_eff
  휨  : Mcrl_local = Fcrl · Sf
"""

import math

E_STEEL = 29500.0  # ksi
MU = 0.3           # Poisson's ratio

# §App.1 Eq. 1.1-4 plate buckling coefficients
K_STIFFENED = 4.0     # 양단 지지 보강요소 (web supported on each longitudinal edge)
K_UNSTIFFENED = 0.43  # 한단 지지 비보강요소


def calc_plate_Fcrl(w: float, t: float, k: float,
                    E: float = E_STEEL, mu: float = MU) -> float:
    """단일 판요소의 국부좌굴 응력 Fcrl (Eq. 1.1-4).

    Parameters
    ----------
    w : 평탄폭 (in.)
    t : 두께 (in.)
    k : 판좌굴계수
    """
    if w <= 0 or t <= 0:
        return 0.0
    return k * math.pi ** 2 * E / (12.0 * (1 - mu ** 2)) * (t / w) ** 2


def calc_Fcrl(ho: float, bo: float, do: float, t: float,
              R: float = 0.0,
              section_type: str = 'C',
              E: float = E_STEEL, mu: float = MU,
              flexure: bool = False) -> dict:
    """단면의 지배 국부좌굴 응력 Fcrl (analytic fallback, §App.1 Eq. 1.1-4).

    웹·플랜지(·립) 각 판요소의 Fcrl을 계산하여 최솟값(지배 요소)을 반환한다.

    기하 계약: 치수는 **외-외**(ho, bo, do)로 받는다. 이 함수가 코너분(R + t)을 빼서
    평탄폭을 만든다 — 평탄폭을 넘기면 코너를 두 번 빼게 된다.

    Parameters
    ----------
    ho : 웹 외-외 깊이 (in.)
    bo : 플랜지 외-외 폭 (in.)
    do : 립 외-외 높이 (in.); 립이 없으면 0
    t  : 두께 (in.)
    R  : 내측 굽힘반경 (in.); 0이면 코너 보정 없이 (외-외 - t) 사용
    section_type : 'C','Z','HAT','TRACK' 등 (현재 k 결정에만 사용)
    flexure : True 이면 강축 순수휨(x 축 대칭 단면, 웹 응력비 ψ = −1).
              웹 k = 4 + 2(1−ψ)³ + 2(1−ψ) = 24 (Appendix 1 응력경사 보강요소),
              압축 플랜지 k = 4 (립 있음) / 0.43, 립 k = 0.43.
              요소 임계응력을 최외연 응력으로 외삽한다(App. 2 §2.3.3.2 User Note):
              웹은 × ho/w_web, 플랜지·립은 × (ho/2)/(ho/2 − t/2). 결과 Fcrl 은
              최외연 응력이므로 Mcrl = Fcrl · Sf.

    Returns
    -------
    dict with keys:
      Fcrl          : 지배 국부좌굴 응력 (ksi); 계산 불가 시 0.0
      governing     : 지배 요소명 ('web'|'flange'|'lip')
      elements      : 요소별 {name: {w, k, Fcrl}}
    """
    if t <= 0:
        return {'Fcrl': 0.0, 'governing': None, 'elements': {}}

    # 코너 평탄폭 보정: 평탄폭 ≈ 외-외 - (요소당 코너 (R+t) 분)
    # R 미상이면 보수적으로 두께 t만 차감(평탄폭을 크게 → Fcrl 작게 → 보수적).
    corner = (R + t) if R > 0 else (t / 2.0)

    elements = {}

    # 웹: 양단(상·하 플랜지)에 지지 → 보강요소 k=4.0 (휨: 응력경사 k=24)
    if ho > 0:
        w_web = max(ho - 2.0 * corner, 0.0)
        if flexure:
            psi = -1.0
            k_web = 4.0 + 2.0 * (1.0 - psi) ** 3 + 2.0 * (1.0 - psi)
            scale = ho / w_web if w_web > 0 else 0.0
        else:
            k_web, scale = K_STIFFENED, 1.0
        elements['web'] = {
            'w': w_web, 'k': k_web, 'scale': scale,
            'Fcrl': calc_plate_Fcrl(w_web, t, k_web, E, mu) * scale,
        }
    fl_scale = (ho / 2.0) / (ho / 2.0 - t / 2.0) if (flexure and ho > t) else 1.0

    # 플랜지: 립이 있으면 (웹+립) 양단 지지 → 보강요소 k=4.0;
    #         립이 없으면 한단(웹)만 지지 → 비보강요소 k=0.43
    if bo > 0:
        has_lip = do > 0
        k_fl = K_STIFFENED if has_lip else K_UNSTIFFENED
        # 보강 플랜지: 양쪽 코너 차감; 비보강 플랜지: 웹쪽 코너 1개만 차감
        w_fl = max(bo - (2.0 * corner if has_lip else corner), 0.0)
        elements['flange'] = {
            'w': w_fl, 'k': k_fl, 'scale': fl_scale, 'corners': 2 if has_lip else 1,
            'Fcrl': calc_plate_Fcrl(w_fl, t, k_fl, E, mu) * fl_scale,
        }

    # 립(연단보강재): 한단(플랜지)만 지지 → 비보강요소 k=0.43
    if do > 0:
        w_lip = max(do - corner, 0.0)
        elements['lip'] = {
            'w': w_lip, 'k': K_UNSTIFFENED, 'scale': fl_scale,
            'Fcrl': calc_plate_Fcrl(w_lip, t, K_UNSTIFFENED, E, mu) * fl_scale,
        }

    # 지배(최소 Fcrl, 0 초과만 후보)
    candidates = {name: e['Fcrl'] for name, e in elements.items() if e['Fcrl'] > 0}
    if not candidates:
        return {'Fcrl': 0.0, 'governing': None, 'elements': elements}

    governing = min(candidates, key=candidates.get)
    return {
        'Fcrl': candidates[governing],
        'governing': governing,
        'elements': elements,
        'loading': 'flexure' if flexure else 'compression',
        # 계산서(design_checks)용 — 위 계산이 쓴 값
        'trace': {'corner': corner, 'R': R, 'E': E, 'mu': mu, 'flexure': bool(flexure)},
    }
