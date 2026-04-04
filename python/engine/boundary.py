"""경계조건 적분 계산

참조: 프로젝트개요.md §6 경계조건 지원 (S-S, C-C, S-C, C-F, C-G)
원본: Ref_Source/analysis/BC_I1_5.m

I1 = ∫₀ᵃ Yₘ·Yₙ dx
I2 = ∫₀ᵃ Yₘ″·Yₙ dx
I3 = ∫₀ᵃ Yₘ·Yₙ″ dx
I4 = ∫₀ᵃ Yₘ″·Yₙ″ dx
I5 = ∫₀ᵃ Yₘ′·Yₙ′ dx
"""

import math

PI = math.pi


def BC_I1_5(BC: str, kk: float, nn: float, a: float) -> tuple:
    """경계조건에 따른 5개 적분값 계산 (닫힌 형태)

    Args:
        BC: 경계조건 문자열 ('S-S', 'C-C', 'S-C', 'C-F', 'C-G')
        kk: 종방향 조화항 인덱스 m
        nn: 종방향 조화항 인덱스 n
        a: 종방향 길이

    Returns:
        (I1, I2, I3, I4, I5) 튜플
    """
    I1 = I2 = I3 = I4 = I5 = 0.0

    if BC == 'S-S':
        # Simply-Simply supported: Ym = sin(m*pi*x/a)
        if kk == nn:
            I1 = a / 2.0
            I2 = -kk**2 * PI**2 / a / 2.0
            I3 = -nn**2 * PI**2 / a / 2.0
            I4 = PI**4 * kk**4 / 2.0 / a**3
            I5 = PI**2 * kk**2 / 2.0 / a

    elif BC == 'C-C':
        # Clamped-Clamped
        if kk == nn:
            if kk == 1:
                I1 = 3.0 * a / 8.0
            else:
                I1 = a / 4.0
            I2 = -(kk**2 + 1) * PI**2 / 4.0 / a
            I3 = -(nn**2 + 1) * PI**2 / 4.0 / a
            I4 = PI**4 * ((kk**2 + 1)**2 + 4 * kk**2) / 4.0 / a**3
            I5 = (1 + kk**2) * PI**2 / 4.0 / a
        elif kk - nn == 2:
            I1 = -a / 8.0
            I2 = (kk**2 + 1) * PI**2 / 8.0 / a - kk * PI**2 / 4.0 / a
            I3 = (nn**2 + 1) * PI**2 / 8.0 / a + nn * PI**2 / 4.0 / a
            I4 = -(kk - 1)**2 * (nn + 1)**2 * PI**4 / 8.0 / a**3
            I5 = -(1 + kk * nn) * PI**2 / 8.0 / a
        elif kk - nn == -2:
            I1 = -a / 8.0
            I2 = (kk**2 + 1) * PI**2 / 8.0 / a + kk * PI**2 / 4.0 / a
            I3 = (nn**2 + 1) * PI**2 / 8.0 / a - nn * PI**2 / 4.0 / a
            I4 = -(kk + 1)**2 * (nn - 1)**2 * PI**4 / 8.0 / a**3
            I5 = -(1 + kk * nn) * PI**2 / 8.0 / a

    elif BC in ('S-C', 'C-S'):
        # Simply-Clamped
        if kk == 0 or nn == 0:
            return (0.0, 0.0, 0.0, 0.0, 0.0)
        if kk == nn:
            I1 = (1 + (kk + 1)**2 / kk**2) * a / 2.0
            I2 = -(kk + 1)**2 * PI**2 / a
            I3 = -(kk + 1)**2 * PI**2 / a
            I4 = (kk + 1)**2 * PI**4 * ((kk + 1)**2 + kk**2) / 2.0 / a**3
            I5 = (1 + kk)**2 * PI**2 / a
        elif kk - nn == 1:
            I1 = (kk + 1) * a / 2.0 / kk
            I2 = -(kk + 1) * kk * PI**2 / 2.0 / a
            I3 = -(nn + 1)**2 * PI**2 * (kk + 1) / 2.0 / a / kk
            I4 = (kk + 1) * kk * (nn + 1)**2 * PI**4 / 2.0 / a**3
            I5 = (1 + kk) * (1 + nn) * PI**2 / 2.0 / a
        elif kk - nn == -1:
            I1 = (nn + 1) * a / 2.0 / nn
            I2 = -(kk + 1)**2 * PI**2 * (nn + 1) / 2.0 / a / nn
            I3 = -(nn + 1) * nn * PI**2 / 2.0 / a
            I4 = (kk + 1)**2 * nn * (nn + 1) * PI**4 / 2.0 / a**3
            I5 = (1 + kk) * (1 + nn) * PI**2 / 2.0 / a

    elif BC in ('C-F', 'F-C'):
        # Clamped-Free
        if kk == nn:
            I1 = 3.0 * a / 2.0 - 2.0 * a * (-1)**(kk - 1) / (kk - 0.5) / PI
            I2 = (kk - 0.5)**2 * PI**2 * ((-1)**(kk - 1) / (kk - 0.5) / PI - 0.5) / a
            I3 = (nn - 0.5)**2 * PI**2 * ((-1)**(nn - 1) / (nn - 0.5) / PI - 0.5) / a
            I4 = (kk - 0.5)**4 * PI**4 / 2.0 / a**3
            I5 = (kk - 0.5)**2 * PI**2 / 2.0 / a
        else:
            I1 = a - a * (-1)**(kk - 1) / (kk - 0.5) / PI - a * (-1)**(nn - 1) / (nn - 0.5) / PI
            I2 = (kk - 0.5)**2 * PI**2 * ((-1)**(kk - 1) / (kk - 0.5) / PI) / a
            I3 = (nn - 0.5)**2 * PI**2 * ((-1)**(nn - 1) / (nn - 0.5) / PI) / a
            I4 = 0.0
            I5 = 0.0

    elif BC in ('C-G', 'G-C'):
        # Clamped-Guided
        if kk == nn:
            if kk == 1:
                I1 = 3.0 * a / 8.0
            else:
                I1 = a / 4.0
            I2 = -((kk - 0.5)**2 + 0.25) * PI**2 / a / 4.0
            I3 = -((kk - 0.5)**2 + 0.25) * PI**2 / a / 4.0
            I4 = ((kk - 0.5)**2 + 0.25)**2 * PI**4 / 4.0 / a**3 + (kk - 0.5)**2 * PI**4 / 4.0 / a**3
            I5 = (kk - 0.5)**2 * PI**2 / a / 4.0 + PI**2 / 16.0 / a
        elif kk - nn == 1:
            I1 = -a / 8.0
            I2 = ((kk - 0.5)**2 + 0.25) * PI**2 / a / 8.0 - (kk - 0.5) * PI**2 / a / 8.0
            I3 = ((nn - 0.5)**2 + 0.25) * PI**2 / a / 8.0 + (nn - 0.5) * PI**2 / a / 8.0
            I4 = -nn**4 * PI**4 / 8.0 / a**3
            I5 = -nn**2 * PI**2 / 8.0 / a
        elif kk - nn == -1:
            I1 = -a / 8.0
            I2 = ((kk - 0.5)**2 + 0.25) * PI**2 / a / 8.0 + (kk - 0.5) * PI**2 / a / 8.0
            I3 = ((nn - 0.5)**2 + 0.25) * PI**2 / a / 8.0 - (nn - 0.5) * PI**2 / a / 8.0
            I4 = -kk**4 * PI**4 / 8.0 / a**3
            I5 = -kk**2 * PI**2 / 8.0 / a

    return (I1, I2, I3, I4, I5)


def BC_I1_5_atpoint(BC: str, kk: float, nn: float, a: float, ys: float) -> tuple:
    """이산 스프링용 — 특정 위치 ys에서의 I1, I5 계산

    Args:
        BC: 경계조건
        kk, nn: 조화항 인덱스
        a: 종방향 길이
        ys: 스프링 위치 (a 대비 비율, 0~1)

    Returns:
        (I1, I5) 튜플
    """
    y = ys * a

    if BC == 'S-S':
        Ym = math.sin(kk * PI * y / a)
        Yn = math.sin(nn * PI * y / a)
        Ym_p = kk * PI / a * math.cos(kk * PI * y / a)
        Yn_p = nn * PI / a * math.cos(nn * PI * y / a)
    elif BC == 'C-C':
        Ym = math.sin(kk * PI * y / a) * math.sin(PI * y / a)
        Yn = math.sin(nn * PI * y / a) * math.sin(PI * y / a)
        Ym_p = (kk * PI / a * math.cos(kk * PI * y / a) * math.sin(PI * y / a) +
                math.sin(kk * PI * y / a) * PI / a * math.cos(PI * y / a))
        Yn_p = (nn * PI / a * math.cos(nn * PI * y / a) * math.sin(PI * y / a) +
                math.sin(nn * PI * y / a) * PI / a * math.cos(PI * y / a))
    elif BC in ('S-C', 'C-S'):
        Ym = math.sin(kk * PI * y / a) + kk / (kk + 1) * math.sin((kk + 1) * PI * y / a)
        Yn = math.sin(nn * PI * y / a) + nn / (nn + 1) * math.sin((nn + 1) * PI * y / a)
        Ym_p = (kk * PI / a * math.cos(kk * PI * y / a) +
                kk * PI / a * math.cos((kk + 1) * PI * y / a))
        Yn_p = (nn * PI / a * math.cos(nn * PI * y / a) +
                nn * PI / a * math.cos((nn + 1) * PI * y / a))
    elif BC in ('C-F', 'F-C'):
        Ym = 1 - math.cos((kk - 0.5) * PI * y / a)
        Yn = 1 - math.cos((nn - 0.5) * PI * y / a)
        Ym_p = (kk - 0.5) * PI / a * math.sin((kk - 0.5) * PI * y / a)
        Yn_p = (nn - 0.5) * PI / a * math.sin((nn - 0.5) * PI * y / a)
    elif BC in ('C-G', 'G-C'):
        Ym = math.sin((kk - 0.5) * PI * y / a) * math.sin(PI * y / 2.0 / a)
        Yn = math.sin((nn - 0.5) * PI * y / a) * math.sin(PI * y / 2.0 / a)
        Ym_p = ((kk - 0.5) * PI / a * math.cos((kk - 0.5) * PI * y / a) * math.sin(PI * y / 2.0 / a) +
                math.sin((kk - 0.5) * PI * y / a) * PI / 2.0 / a * math.cos(PI * y / 2.0 / a))
        Yn_p = ((nn - 0.5) * PI / a * math.cos((nn - 0.5) * PI * y / a) * math.sin(PI * y / 2.0 / a) +
                math.sin((nn - 0.5) * PI * y / a) * PI / 2.0 / a * math.cos(PI * y / 2.0 / a))
    else:
        Ym = Yn = Ym_p = Yn_p = 0.0

    I1 = Ym * Yn
    I5 = Ym_p * Yn_p
    return (I1, I5)
