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
        Pne: 전체좌굴 공칭강도 (kips)
        Pcrl: 탄성 국부좌굴 임계하중 (kips)
    """
    if Pcrl <= 0:
        return {'Pnl': Pne, 'lambda_l': 0, 'equation': 'E3.2.1-1 (Pcrl=0)'}

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
        Py: 항복하중 = Ag * Fy (kips)
        Pcrd: 탄성 왜곡좌굴 임계하중 (kips)
    """
    if Pcrd <= 0:
        return {'Pnd': Py, 'lambda_d': 0, 'equation': 'E4.1-1 (Pcrd=0)'}

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
        Mne: 전체좌굴 공칭 휨강도 (kip-in)
        Mcrl: 탄성 국부좌굴 임계모멘트 (kip-in)
    """
    if Mcrl <= 0:
        return {'Mnl': Mne, 'lambda_l': 0, 'equation': 'F3.2.1-1 (Mcrl=0)'}

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
        My: 항복모멘트 = Sf * Fy (kip-in)
        Mcrd: 탄성 왜곡좌굴 임계모멘트 (kip-in)
    """
    if Mcrd <= 0:
        return {'Mnd': My, 'lambda_d': 0, 'equation': 'F4.1-1 (Mcrd=0)'}

    lam = math.sqrt(My / Mcrd)

    if lam <= 0.673:
        Mnd = My
        eq = 'F4.1-1'
    else:
        ratio = (Mcrd / My) ** 0.5
        Mnd = (1 - 0.22 * ratio) * ratio * My
        eq = 'F4.1-2'

    return {'Mnd': Mnd, 'lambda_d': lam, 'equation': eq}
