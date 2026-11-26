"""DSM 강도 곡선 — AISI S100-16 Chapters E3, E4, F3, F4

Direct Strength Method 공칭강도 계산 함수.
모든 함수는 dict를 반환하며, 계산 과정의 중간값과 적용 조항을 포함한다.
"""

import math


# ============================================================
# 압축 (Compression) — Chapter E
# ============================================================

def compression_local(Pne: float, Pcrl: float) -> dict:
    """DSM 국부좌굴 압축강도 (§E3.2.1)

    Args:
        Pne: 전체좌굴 공칭강도 (kips), 양수여야 함
        Pcrl: 탄성 국부좌굴 임계하중 (kips)
    """
    # 입력 양성 가드: 음수 Pne는 잘못된 상위 결과이므로 min(...)에 음의 강도가
    # 섞여 들어가지 않도록 명시적으로 거부한다 (강건성 강화, 규정 영향 없음).
    if Pne < 0:
        raise ValueError(f"Pne must be non-negative, got {Pne}")
    if Pcrl <= 0:
        # Pcrl 미산정: 국부좌굴이 평가되지 않았음을 명시. E3.2.1-1(λ≤0.776
        # 항복지배)이 만족됐다는 의미가 아니므로 'evaluated': False로 표시한다.
        return {'Pnl': Pne, 'lambda_l': 0, 'equation': 'N/A (no Pcrl)',
                'evaluated': False}

    lam = math.sqrt(Pne / Pcrl)

    if lam <= 0.776:
        Pnl = Pne
        eq = 'E3.2.1-1'
    else:
        ratio = (Pcrl / Pne) ** 0.4
        Pnl = (1 - 0.15 * ratio) * ratio * Pne
        eq = 'E3.2.1-2'

    return {'Pnl': Pnl, 'lambda_l': lam, 'equation': eq}


def compression_distortional(Py: float, Pcrd: float) -> dict:
    """DSM 왜곡좌굴 압축강도 (§E4.1)

    Args:
        Py: 항복하중 = Ag * Fy (kips), 양수여야 함
        Pcrd: 탄성 왜곡좌굴 임계하중 (kips)
    """
    # 입력 양성 가드: 음수 Py는 잘못된 입력 (강건성 강화, 규정 영향 없음).
    if Py < 0:
        raise ValueError(f"Py must be non-negative, got {Py}")
    if Pcrd <= 0:
        # Pcrd 미산정: 왜곡좌굴이 평가되지 않았음. E4.1-1(λd≤0.561 항복지배)이
        # 지배했다는 의미가 아니므로 'evaluated': False로 표시한다.
        return {'Pnd': Py, 'lambda_d': 0, 'equation': 'N/A (no Pcrd)',
                'evaluated': False}

    lam = math.sqrt(Py / Pcrd)

    if lam <= 0.561:
        Pnd = Py
        eq = 'E4.1-1'
    else:
        ratio = (Pcrd / Py) ** 0.6
        Pnd = (1 - 0.25 * ratio) * ratio * Py
        eq = 'E4.1-2'

    return {'Pnd': Pnd, 'lambda_d': lam, 'equation': eq}


# ============================================================
# 휨 (Flexure) — Chapter F
# ============================================================

def flexure_local(Mne: float, Mcrl: float) -> dict:
    """DSM 국부좌굴 휨강도 (§F3.2.1)

    Args:
        Mne: 전체좌굴 공칭 휨강도 (kip-in), 양수여야 함
        Mcrl: 탄성 국부좌굴 임계모멘트 (kip-in)
    """
    # 입력 양성 가드: 음수 Mne는 잘못된 입력 (강건성 강화, 규정 영향 없음).
    if Mne < 0:
        raise ValueError(f"Mne must be non-negative, got {Mne}")
    if Mcrl <= 0:
        # Mcrl 미산정: 국부좌굴이 평가되지 않았음을 명시 (F3.2.1-1 지배 아님).
        return {'Mnl': Mne, 'lambda_l': 0, 'equation': 'N/A (no Mcrl)',
                'evaluated': False}

    lam = math.sqrt(Mne / Mcrl)

    if lam <= 0.776:
        Mnl = Mne
        eq = 'F3.2.1-1'
    else:
        ratio = (Mcrl / Mne) ** 0.4
        Mnl = (1 - 0.15 * ratio) * ratio * Mne
        eq = 'F3.2.1-2'

    return {'Mnl': Mnl, 'lambda_l': lam, 'equation': eq}


def flexure_distortional(My: float, Mcrd: float) -> dict:
    """DSM 왜곡좌굴 휨강도 (§F4.1)

    Args:
        My: 항복모멘트 = Sf * Fy (kip-in), 양수여야 함
        Mcrd: 탄성 왜곡좌굴 임계모멘트 (kip-in)
    """
    # 입력 양성 가드: 음수 My는 잘못된 입력 (강건성 강화, 규정 영향 없음).
    if My < 0:
        raise ValueError(f"My must be non-negative, got {My}")
    if Mcrd <= 0:
        # Mcrd 미산정: 왜곡좌굴이 평가되지 않았음을 명시 (F4.1-1 지배 아님).
        return {'Mnd': My, 'lambda_d': 0, 'equation': 'N/A (no Mcrd)',
                'evaluated': False}

    lam = math.sqrt(My / Mcrd)

    if lam <= 0.673:
        Mnd = My
        eq = 'F4.1-1'
    else:
        ratio = (Mcrd / My) ** 0.5
        Mnd = (1 - 0.22 * ratio) * ratio * My
        eq = 'F4.1-2'

    return {'Mnd': Mnd, 'lambda_d': lam, 'equation': eq}


# ============================================================
# 구멍이 있는 부재 (Members With Holes) — §E3.2.2 · §E4.2 · §F3.2.2 · §F4.2
# ============================================================

def compression_distortional_holes(Py: float, Pynet: float, Pcrd: float) -> dict:
    """DSM 뒤틀림좌굴 압축강도, 구멍이 있는 기둥 (§E4.2)

    §E4.1 로 계산하되 Pcrd 는 구멍의 영향을 넣은 값이고, λd ≤ λd2 이면
      λd ≤ λd1: Pnd = Pynet                                                     (Eq. E4.2-1)
      λd1 < λd ≤ λd2: Pnd = Pynet − [(Pynet − Pd2)/(λd2 − λd1)](λd − λd1)       (Eq. E4.2-2)
    λd = (Py/Pcrd)^0.5 (E4.2-3), λd1 = 0.561 (Pynet/Py) (E4.2-4),
    λd2 = 0.561 [14.0 (Py/Pynet)^0.4 − 13.0] (E4.2-5),
    Pd2 = [1 − 0.25 (1/λd2)^1.2] (1/λd2)^1.2 Py (E4.2-6), Py = Ag Fy (E4.2-7), Pynet = Anet Fy (E4.2-8).
    """
    if Py < 0 or Pynet < 0:
        raise ValueError(f"Py and Pynet must be non-negative, got {Py}, {Pynet}")
    if Pcrd <= 0:
        return {'Pnd': Py, 'lambda_d': 0, 'equation': 'N/A (no Pcrd)', 'evaluated': False}
    # 순단면 항복은 총단면 항복을 넘지 않는다(Anet ≤ Ag) — 받은 값이 넘으면 Py 로(독립 검증 6: 섞인 두 단면의 값을 막는다)
    capped = Pynet > Py
    Pynet = min(Pynet, Py)
    lam = math.sqrt(Py / Pcrd)
    ld1 = 0.561 * (Pynet / Py)
    ld2 = 0.561 * (14.0 * (Py / Pynet) ** 0.4 - 13.0)
    Pd2 = (1 - 0.25 * (1 / ld2) ** 1.2) * (1 / ld2) ** 1.2 * Py
    out = {'lambda_d': lam, 'lambda_d1': ld1, 'lambda_d2': ld2, 'Pd2': Pd2, 'Pynet': Pynet, 'Py': Py}
    if capped:
        out['Pynet_capped_to_Py'] = True
    # 원문의 갈래 순서: "if λd ≤ λd2 then: for λd ≤ λd1 … ; for λd1 < λd ≤ λd2 …" — 아니면 §E4.1
    if lam <= ld2:
        if lam <= ld1:
            out.update(Pnd=Pynet, equation='E4.2-1')
        else:
            out.update(Pnd=Pynet - ((Pynet - Pd2) / (ld2 - ld1)) * (lam - ld1), equation='E4.2-2')
    else:
        base = compression_distortional(Py, Pcrd)
        out.update(Pnd=base['Pnd'], equation=base['equation'])      # λd > λd2 → §E4.1
    return out


def flexure_distortional_holes(My: float, Mynet: float, Mcrd: float) -> dict:
    """DSM 뒤틀림좌굴 휨강도, 구멍이 있는 보 (§F4.2)

    §F4.1 로 계산하되 Mcrd 는 구멍의 영향을 넣은 값이고, λd ≤ λd2 이면
      λd ≤ λd1: Mnd = Mynet                                                      (Eq. F4.2-1)
      λd1 < λd ≤ λd2: Mnd = Mynet − [(Mynet − Md2)/(λd2 − λd1)](λd − λd1)
                      ≤ [1 − 0.22 (Mcrd/My)^0.5] (Mcrd/My)^0.5 My                (Eq. F4.2-2)
    λd = (My/Mcrd)^0.5 (F4.2-3), λd1 = 0.673 (Mynet/My)^3 (F4.2-4),
    λd2 = 0.673 [1.7 (My/Mynet)^2.7 − 0.7] (F4.2-5), Md2 = [1 − 0.22 (1/λd2)] (1/λd2) My (F4.2-6).
    """
    if My < 0 or Mynet < 0:
        raise ValueError(f"My and Mynet must be non-negative, got {My}, {Mynet}")
    if Mcrd <= 0:
        return {'Mnd': My, 'lambda_d': 0, 'equation': 'N/A (no Mcrd)', 'evaluated': False}
    # 순단면 첫 항복은 총단면 첫 항복을 넘지 않는다 — 받은 값이 넘으면 My 로(독립 검증 6)
    capped = Mynet > My
    Mynet = min(Mynet, My)
    lam = math.sqrt(My / Mcrd)
    ld1 = 0.673 * (Mynet / My) ** 3
    ld2 = 0.673 * (1.7 * (My / Mynet) ** 2.7 - 0.7)
    Md2 = (1 - 0.22 * (1 / ld2)) * (1 / ld2) * My
    out = {'lambda_d': lam, 'lambda_d1': ld1, 'lambda_d2': ld2, 'Md2': Md2, 'Mynet': Mynet, 'My': My}
    if capped:
        out['Mynet_capped_to_My'] = True
    # 원문의 갈래 순서: "when λd ≤ λd2 then: For λd ≤ λd1 … ; For λd1 < λd ≤ λd2 …" — 아니면 §F4.1
    if lam <= ld2 and lam <= ld1:
        out.update(Mnd=Mynet, equation='F4.2-1')
    elif lam <= ld2:
        r = (Mcrd / My) ** 0.5
        cap = (1 - 0.22 * r) * r * My
        interp = Mynet - ((Mynet - Md2) / (ld2 - ld1)) * (lam - ld1)
        out.update(Mnd=min(interp, cap), equation='F4.2-2', interp=interp, cap=cap)
    else:
        base = flexure_distortional(My, Mcrd)
        out.update(Mnd=base['Mnd'], equation=base['equation'])      # λd > λd2 → §F4.1
    return out
