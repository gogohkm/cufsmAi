"""2026-11-24 V6-13 — 계산 과정(design_checks[].steps)을 그 단계의 입력만으로 다시 계산한다.

엔진의 함수를 부르지 않는다. 식은 AISI S100-16 본문 · 부록에서 이 파일에 새로 옮겨 적었다(엔진 코드를 보고
옮기지 않았다). 단계마다:
- 계산 단계(yield · elastic_buckling · slenderness · equation · modifier · demand): FORMULAS[expr](입력) = 결과
- 갈래(branch): CONDITIONS 또는 일반 비교식으로 조건을 다시 판정해 holds 와 같아야 한다
- 설계강도(design_strength): 공칭 × φ 또는 공칭 / Ω (계수가 없으면 입력의 곱)
- 판정(verdict): 비 = 소요 / 강도(지수 n 이 있으면 ^(1/n)), 판정 = 비 ≤ 1
모르는 식이 나오면 실패한다 — 새 계산 과정을 더하면 이 표에도 원문 식을 더해야 한다(그래야 '숫자를 어떻게
얻었는지' 잘못 말하는 단계가 시험을 지나지 못한다). 표에서 값을 읽는 단계(LOOKUPS)는 그 까닭을 적고
입력 = 결과(그대로 옮김)만 확인한다.
"""

import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), 'python'))
sys.path.insert(0, HERE)

import contract_cases_1123 as cases  # noqa: E402

pi = math.pi
sqrt = math.sqrt
REL = 1e-9


def _v(step):
    d = {}
    for i in step['inputs']:
        val = i.get('value')
        if val is None and i.get('unbounded'):
            val = math.inf
        d.setdefault(i['symbol'], val)
    return d


def _clamp(x, lo, hi):
    return max(min(x, hi), lo)


# ---- Table 2.3.1.3-1 (부록 2) — 립 각도 θ 인 플랜지 + 립, 중심선 치수 b · d · t
def _flange(v, key):
    b, d, t = v['b'], v['d'], v['t']
    th = math.radians(v['θ'])
    c, s = math.cos(th), math.sin(th)
    return {
        'Af': (b + d) * t,
        'Jf': b * t ** 3 / 3 + d * t ** 3 / 3,
        'Ixf': t * (t * t * b * b + 4 * b * d ** 3 - 4 * b * d ** 3 * c * c + t * t * b * d + d ** 4 - d ** 4 * c * c)
        / (12 * (b + d)),
        'Iyf': t * (b ** 4 + 4 * d * b ** 3 + 6 * d * d * b * b * c + 4 * d ** 3 * b * c * c + d ** 4 * c * c)
        / (12 * (b + d)),
        'Ixyf': t * b * d * d * s * (b + d * c) / (4 * (b + d)),
        'xof': (b * b - d * d * c) / (2 * (b + d)),
        'hxf': -(b * b + 2 * d * b + d * d * c) / (2 * (b + d)),
        'yof': -d * d * s / (2 * (b + d)),
    }[key]


def _lcrd(v, flex):
    dx = v['xof'] - v['hxf']
    br = v['Ixf'] * dx ** 2 + v['Cwf'] - v['Ixyf'] ** 2 / v['Iyf'] * dx ** 2
    if flex:
        return (4 * pi ** 4 * v['ho'] * (1 - v['μ'] ** 2) / v['t'] ** 3 * br + pi ** 4 * v['ho'] ** 4 / 720) ** 0.25
    return (6 * pi ** 4 * v['ho'] * (1 - v['μ'] ** 2) / v['t'] ** 3 * br) ** 0.25


def _kwg_flex(v):
    ho, t, L, xi = v['ho'], v['t'], v['L'], v['ξweb']
    num = (45360 * (1 - xi) + 62160) * (L / ho) ** 2 + 448 * pi ** 2 + (ho / L) ** 2 * (53 + 3 * (1 - xi)) * pi ** 4
    den = pi ** 4 + 28 * pi ** 2 * (L / ho) ** 2 + 420 * (L / ho) ** 4
    return ho * t * pi ** 2 / 13440 * num / den


def _wc(v):  # Eq. G5-1
    return (v['C'] * v['t'] ** 2 * v['Fy'] * math.sin(math.radians(v['θ'])) * (1 - v['CR'] * sqrt(v['R'] / v['t']))
            * (1 + v['CN'] * sqrt(v['N'] / v['t'])) * (1 - v['Ch'] * sqrt(v['h'] / v['t'])))


def _usl(expr):
    def f(v):
        if expr.startswith('Usl = 0.9 + 0.1 d/s'):
            return min(0.9 + 0.1 * v['d'] / v['s'], 1.0)
        if expr.startswith('Usl = 1 − 1.20'):
            return _clamp(1 - 1.20 * v['x̄'] / v['L'], 0.4, 0.9)
        if expr.startswith('Usl = 1 − 0.36'):
            return _clamp(1 - 0.36 * v['x̄'] / v['L'], 0.5, 0.9)
        if expr.startswith('Usl = 1/(1.1 + 0.5'):
            return min(1 / (1.1 + 0.5 * v['b1'] / (v['b2'] + v['b1']) + 2 * v['x̄'] / v['L']), 1.0)
        if expr.startswith('Usl = 1/(1.1 + bf'):
            return min(1 / (1.1 + v['bf'] / (v['bw'] + 2 * v['bf']) + v['x̄'] / v['L']), 1.0)
        if expr.startswith('Usl = Usl,min'):
            return v['Usl,min']
        if expr.startswith('Usl = 1.0'):
            return 1.0
        raise KeyError(expr)
    return f


def _bearing_C(d, t, oversized):
    """Table J3.3.1-1 — 표준 구멍 / 과대 · 짧은 슬롯 구멍."""
    r = d / t
    if oversized:
        return 3.0 if r < 7 else (1 + 14 / r if r <= 18 else 1.8)
    return 3.0 if r < 10 else (4 - 0.1 * r if r <= 22 else 1.8)


def _dsm_l(sym_ne, sym_cr):
    def f(v):
        r = v[sym_cr] / v[sym_ne]
        return (1 - 0.15 * r ** 0.4) * r ** 0.4 * v[sym_ne]
    return f


F = {
    # ---- 부록 2 · §E2 / §F2 전체 좌굴
    'σex = π² E / (KxLx / rx)²': lambda v: pi ** 2 * v['E'] / (v['KxLx'] / v['rx']) ** 2,
    'σey = π² E / (KyLy / ry)²': lambda v: pi ** 2 * v['E'] / (v['KyLy'] / v['ry']) ** 2,
    'σt = [G J + π² E Cw / (KtLt)²] / (A ro²)':
        lambda v: (v['G'] * v['J'] + pi ** 2 * v['E'] * v['Cw'] / v['KtLt'] ** 2) / (v['A'] * v['ro'] ** 2),
    'σe,min = π² E / (KyLy / r_min)²': lambda v: pi ** 2 * v['E'] / (v['KyLy'] / v['r_min']) ** 2,
    'r_min = (I22 / A)^0.5': lambda v: sqrt(v['I22'] / v['A']),
    'ro = (rx² + ry² + xo²)^0.5': lambda v: sqrt(v['rx'] ** 2 + v['ry'] ** 2 + v['xo'] ** 2),
    'β = 1 − (xo / ro)²': lambda v: 1 - (v['xo'] / v['ro']) ** 2,
    'Fcre,ft = [(σex + σt) − ((σex + σt)² − 4 β σex σt)^0.5] / (2 β)':
        lambda v: ((v['σex'] + v['σt']) - sqrt((v['σex'] + v['σt']) ** 2 - 4 * v['β'] * v['σex'] * v['σt']))
        / (2 * v['β']),
    'Fcre = min(σex, σey, σt)': lambda v: min(v['σex'], v['σey'], v['σt']),
    'Fcre = min(σey, Fcre,ft)': lambda v: min(v['σey'], v['Fcre,ft']),
    'Fcre = min(σt, σe,min)  (point-symmetric, §E2.3)': lambda v: min(v['σt'], v['σe,min']),
    'Fcre = Cb ro A / Sf (σey σt)^0.5': lambda v: v['Cb'] * v['ro'] * v['A'] / v['Sf'] * sqrt(v['σey'] * v['σt']),
    'Fcre = Cb ro A / (2 Sf) (σey σt)^0.5':
        lambda v: v['Cb'] * v['ro'] * v['A'] / (2 * v['Sf']) * sqrt(v['σey'] * v['σt']),
    'Lu = 0.36 Cb π / (Fy Sf) (E G J Iy)^0.5':
        lambda v: 0.36 * v['Cb'] * pi / (v['Fy'] * v['Sf']) * sqrt(v['E'] * v['G'] * v['J'] * v['Iy']),
    'Fcre = Cb π / (Ky Ly Sf) (E G J Iy)^0.5':
        lambda v: v['Cb'] * pi / (v['Ky'] * v['Ly'] * v['Sf']) * sqrt(v['E'] * v['G'] * v['J'] * v['Iy']),
    'Fcre → ∞ (Lb = 0: compression flange fully braced, no LTB)': lambda v: math.inf,
    'Fcre → ∞ (Lb ≤ Lu: lateral-torsional buckling not considered)': lambda v: math.inf,
    # ---- §E2 · §E3.2.1 · §E4.1
    'λc = (Fy / Fcre)^0.5': lambda v: sqrt(v['Fy'] / v['Fcre']),
    'Fn = 0.658^(λc²) Fy': lambda v: 0.658 ** (v['λc'] ** 2) * v['Fy'],
    'Fn = (0.877 / λc²) Fy': lambda v: 0.877 / v['λc'] ** 2 * v['Fy'],
    'Pne = Ag Fn': lambda v: v['A'] * v['Fn'],
    'Py = Ag Fy': lambda v: v['A'] * v['Fy'],
    'λℓ = (Pne / Pcrl)^0.5': lambda v: sqrt(v['Pne'] / v['Pcrl']),
    'Pnℓ = Pne': lambda v: v['Pne'],
    'Pnℓ = [1 − 0.15 (Pcrl/Pne)^0.4] (Pcrl/Pne)^0.4 Pne': _dsm_l('Pne', 'Pcrl'),
    'λd = (Py / Pcrd)^0.5': lambda v: sqrt(v['Py'] / v['Pcrd']),
    'Pnd = Py': lambda v: v['Py'],
    'Pnd = [1 − 0.25 (Pcrd/Py)^0.6] (Pcrd/Py)^0.6 Py':
        lambda v: (1 - 0.25 * (v['Pcrd'] / v['Py']) ** 0.6) * (v['Pcrd'] / v['Py']) ** 0.6 * v['Py'],
    'Pcrl = Fcrl A': lambda v: v['Fcrl'] * v['A'],
    'Pcrd = Fcrd A': lambda v: v['Fcrd'] * v['A'],
    'Pcrd = max(Pcrd, single-minimum floor)  (§4.1: the lone minimum is a floor)':
        lambda v: max(v['Pcrd'], v['Pcrd,floor']),
    # ---- §F2 · §F3.2 · §F4 · §F2.3 · §F2.4.2
    'Fn = Fy': lambda v: v['Fy'],
    'Fn = Fcre': lambda v: v['Fcre'],
    'Fn = (10/9) Fy [1 − 10 Fy / (36 Fcre)]': lambda v: 10 / 9 * v['Fy'] * (1 - 10 * v['Fy'] / (36 * v['Fcre'])),
    'Fn = [0.970 + 0.020 (E/Fy)/(D/t)] Fy': lambda v: (0.970 + 0.020 * (v['E'] / v['Fy']) / v['D/t']) * v['Fy'],
    'Fn = 1.25 Fy': lambda v: 1.25 * v['Fy'],
    'Fn = 0.328 E / (D/t)': lambda v: 0.328 * v['E'] / v['D/t'],
    'Mne = Sf Fn ≤ My': lambda v: v['Sf'] * v['Fn'],
    'Mne = Sf Fn': lambda v: v['Sf'] * v['Fn'],
    'My = Sf Fy': lambda v: v['Sf'] * v['Fy'],
    'My = Sf Fy  (Mne = My, Fn = Fy)': lambda v: v['Sf'] * v['Fy'],
    'Mp = Zf Fy': lambda v: v['Zf'] * v['Fy'],
    'Mcre = Sf Fcre': lambda v: v['Sf'] * v['Fcre'],
    'Mne = Mp − (Mp − My) [(My/Mcre)^0.5 − 0.23] / 0.37 ≤ Mp':
        lambda v: min(v['Mp'] - (v['Mp'] - v['My']) * (sqrt(v['My'] / v['Mcre']) - 0.23) / 0.37, v['Mp']),
    'λℓ = (Mne / Mcrl)^0.5': lambda v: sqrt(v['Mne'] / v['Mcrl']),
    'λℓ = (My / Mcrl)^0.5': lambda v: sqrt(v['My'] / v['Mcrl']),
    'Mnℓ = Mne': lambda v: v['Mne'],
    'Mnℓ = [1 − 0.15 (Mcrl/Mne)^0.4] (Mcrl/Mne)^0.4 Mne': _dsm_l('Mne', 'Mcrl'),
    'Mnℓo = [1 − 0.15 (Mcrl/My)^0.4] (Mcrl/My)^0.4 My': _dsm_l('My', 'Mcrl'),
    'Mnℓo = My': lambda v: v['My'],
    'λd = (My / Mcrd)^0.5': lambda v: sqrt(v['My'] / v['Mcrd']),
    'Mnd = My': lambda v: v['My'],
    'Mnd = [1 − 0.22 (Mcrd/My)^0.5] (Mcrd/My)^0.5 My':
        lambda v: (1 - 0.22 * (v['Mcrd'] / v['My']) ** 0.5) * (v['Mcrd'] / v['My']) ** 0.5 * v['My'],
    'Cyd = (0.673 / λd)^0.5 ≤ 3': lambda v: min(sqrt(0.673 / v['λd']), 3.0),
    'Mnd = My + (1 − 1/Cyd²) (Mp − My)': lambda v: v['My'] + (1 - 1 / v['Cyd'] ** 2) * (v['Mp'] - v['My']),
    'Cyℓ = (0.776 / λℓ)^0.5 ≤ 3': lambda v: min(sqrt(0.776 / v['λℓ']), 3.0),
    'Mnℓ = My + (1 − 1/Cyℓ²) (Mp − My)': lambda v: v['My'] + (1 - 1 / v['Cyℓ'] ** 2) * (v['Mp'] - v['My']),
    'Mcrd = Fcrd Sf': lambda v: v['Fcrd'] * v['Sf'],
    'Mcrl = Fcrl Sf': lambda v: v['Fcrl'] * v['Sf'],
    'Mcrd = β Mcrd': lambda v: v['β'] * v['Mcrd'],
    'β = 1 + 0.4 (L/Lm)^0.7 (1 + M1/M2)^0.7, 1.0 ≤ β ≤ 1.3':
        lambda v: _clamp(1 + 0.4 * (v['L'] / v['Lm']) ** 0.7 * (1 + v['M1/M2']) ** 0.7, 1.0, 1.3),
    'Mn(+) = min(Mne, Mnℓ, Mnd)': lambda v: min(v['Mne'], v['Mnℓ'], v['Mnd']),
    'Mn = R Mnℓo': lambda v: v['R'] * v['Mnℓo'],
    'Fya = C Fyc + (1 − C) Fyv ≤ Fuv  (cold work of forming)':
        lambda v: min(v['C'] * v['Fyc'] + (1 - v['C']) * v['Fyv'], v['Fuv']),
    'Mcrd = max(Mcrd, single-minimum floor)  (§4.1: the lone minimum is a floor)':
        lambda v: max(v['Mcrd'], v['Mcrd,floor']),
    'Mcrl = max(Mcrl, single-minimum floor)  (§4.1: the lone minimum is a floor)':
        lambda v: max(v['Mcrl'], v['Mcrl,floor']),
    'Pcrl = max(Pcrl, single-minimum floor)  (§4.1: the lone minimum is a floor)':
        lambda v: max(v['Pcrl'], v['Pcrl,floor']),
    # ---- 부록 1 Eq. 1.1-4 · 부록 2 §2.3.1.3 / §2.3.3.3
    'c = R + t  (corner allowance per side)': lambda v: v['R'] + v['t'],
    'c = t / 2  (R not given)': lambda v: v['t'] / 2,
    'w = ho − 2c': lambda v: v['ho'] - 2 * v['c'],
    'w = bo − 2c': lambda v: v['bo'] - 2 * v['c'],
    'w = bo − c': lambda v: v['bo'] - v['c'],
    'w = do − c': lambda v: v['do'] - v['c'],
    'Fcrl = min over the elements': lambda v: min(x for k, x in v.items()),
    'b = bo − t  (centreline flange)': lambda v: v['bo'] - v['t'],
    'd = do − t/2  (centreline lip)': lambda v: v['do'] - v['t'] / 2,
    'L = min(Lcrd, Lm)': lambda v: min(v['Lcrd'], v['Lm']),
    'Lcrd = {(4π⁴ ho (1−μ²)/t³)[Ixf (xof−hxf)² + Cwf − (Ixyf²/Iyf)(xof−hxf)²] + π⁴ ho⁴/720}^0.25':
        lambda v: _lcrd(v, True),
    'Lcrd = {(6π⁴ ho (1−μ²)/t³)[Ixf (xof−hxf)² + Cwf − (Ixyf²/Iyf)(xof−hxf)²]}^0.25': lambda v: _lcrd(v, False),
    'kφfe = (π/L)⁴ [E Ixf (xof−hxf)² + E Cwf − E (Ixyf²/Iyf)(xof−hxf)²] + (π/L)² G Jf':
        lambda v: (pi / v['L']) ** 4 * (v['E'] * v['Ixf'] * (v['xof'] - v['hxf']) ** 2 + v['E'] * v['Cwf']
                                       - v['E'] * v['Ixyf'] ** 2 / v['Iyf'] * (v['xof'] - v['hxf']) ** 2)
        + (pi / v['L']) ** 2 * v['G'] * v['Jf'],
    'kφwe = E t³ / [6 ho (1 − μ²)]': lambda v: v['E'] * v['t'] ** 3 / (6 * v['ho'] * (1 - v['μ'] ** 2)),
    'kφwe = E t³/(12(1−μ²)) [3/ho + (π/L)² 19 ho/60 + (π/L)⁴ ho³/240]':
        lambda v: v['E'] * v['t'] ** 3 / (12 * (1 - v['μ'] ** 2))
        * (3 / v['ho'] + (pi / v['L']) ** 2 * 19 * v['ho'] / 60 + (pi / v['L']) ** 4 * v['ho'] ** 3 / 240),
    'k̃φfg = (π/L)² [Af ((xof−hxf)² (Ixyf/Iyf)² − 2 yof (xof−hxf)(Ixyf/Iyf) + hxf² + yof²) + Ixf + Iyf]':
        lambda v: (pi / v['L']) ** 2 * (v['Af'] * ((v['xof'] - v['hxf']) ** 2 * (v['Ixyf'] / v['Iyf']) ** 2
                                                   - 2 * v['yof'] * (v['xof'] - v['hxf']) * (v['Ixyf'] / v['Iyf'])
                                                   + v['hxf'] ** 2 + v['yof'] ** 2) + v['Ixf'] + v['Iyf']),
    'k̃φwg = (π/L)² t ho³ / 60': lambda v: (pi / v['L']) ** 2 * v['t'] * v['ho'] ** 3 / 60,
    ('k̃φwg = ho t π²/13440 {[45360(1−ξweb) + 62160](L/ho)² + 448π² + (ho/L)² [53 + 3(1−ξweb)] π⁴} / '
     '[π⁴ + 28π² (L/ho)² + 420 (L/ho)⁴]'): _kwg_flex,
    'Fcrd = (kφfe + kφwe + kφ) / (k̃φfg + k̃φwg)':
        lambda v: (v['kφfe'] + v['kφwe'] + v['kφ']) / (v['k̃φfg'] + v['k̃φwg']),
    'Fcrd = β (kφfe + kφwe + kφ) / (k̃φfg + k̃φwg)  (β = 1 here; the moment-gradient β is applied to Mcrd)':
        lambda v: v['β'] * (v['kφfe'] + v['kφwe'] + v['kφ']) / (v['k̃φfg'] + v['k̃φwg']),
    # ---- §G2 · §G5 · §H2 · §H3
    'Vy = 0.6 Aw Fy, Aw = h t': lambda v: 0.6 * v['h'] * v['t'] * v['Fy'],
    'Vcr = Aw π² E kv / [12 (1 − μ²) (h/t)²], μ = 0.3':
        lambda v: v['h'] * v['t'] * pi ** 2 * v['E'] * v['kv'] / (12 * (1 - 0.3 ** 2) * (v['h'] / v['t']) ** 2),
    'λv = (Vy / Vcr)^0.5': lambda v: sqrt(v['Vy'] / v['Vcr']),
    'Vn = Vy': lambda v: v['Vy'],
    'Vn = Vcr': lambda v: v['Vcr'],
    'Vn = 0.815 (Vcr Vy)^0.5': lambda v: 0.815 * sqrt(v['Vcr'] * v['Vy']),
    'Vn = n_webs Vn,web': lambda v: v['n_webs'] * v['Vn,web'],
    'Pn = C t² Fy sinθ (1 − CR (R/t)^0.5)(1 + CN (N/t)^0.5)(1 − Ch (h/t)^0.5)': _wc,
    'Pn = n_webs Pn,web': lambda v: v['n_webs'] * v['Pn,web'],
    '[(M/Maℓo)² + (V/Va)²]^0.5 ≤ 1.0': lambda v: sqrt((v['M'] / v['Maℓo']) ** 2 + (v['Vu'] / v['Va']) ** 2),
    '0.6 (M/Maℓo) + V/Va ≤ 1.3': lambda v: 0.6 * v['M'] / v['Maℓo'] + v['Vu'] / v['Va'],
    '0.91 (P/Pn) + M/Mnℓo': lambda v: 0.91 * v['P'] / v['Pn'] + v['M'] / v['Mnℓo'],
    '0.88 (P/Pn) + M/Mnℓo': lambda v: 0.88 * v['P'] / v['Pn'] + v['M'] / v['Mnℓo'],
    '0.86 (P/Pn) + M/Mnℓo': lambda v: 0.86 * v['P'] / v['Pn'] + v['M'] / v['Mnℓo'],
    # ---- §C1.2.1.1 · §H1
    'Pe1x = π² E A / (KxLx / rx)²': lambda v: pi ** 2 * v['E'] * v['A'] / (v['KxLx'] / v['rx']) ** 2,
    'Pe1y = π² E A / (KyLy / ry)²': lambda v: pi ** 2 * v['E'] * v['A'] / (v['KyLy'] / v['ry']) ** 2,
    'Cmx = 0.6 − 0.4 (M1/M2)': lambda v: 0.6 - 0.4 * v['M1/M2'],
    'Cmy = 0.6 − 0.4 (M1/M2)': lambda v: 0.6 - 0.4 * v['M1/M2'],
    'B1x = Cmx / (1 − α P / Pe1x) ≥ 1.0': lambda v: max(v['Cmx'] / (1 - v['α'] * v['P'] / v['Pe1x']), 1.0),
    'B1y = Cmy / (1 − α P / Pe1y) ≥ 1.0': lambda v: max(v['Cmy'] / (1 - v['α'] * v['P'] / v['Pe1y']), 1.0),
    'Mx,amp = B1x Mx': lambda v: v['B1x'] * v['Mx'],
    'My,amp = B1y My': lambda v: v['B1y'] * v['My'],
    'PL/1000 = P L / 1000  (angle: additional eccentricity moment, §H1.2)': lambda v: v['P'] * v['L'] / 1000,
    'My,ecc = B1y (My + PL/1000)': lambda v: v['B1y'] * (v['My'] + v['PL/1000']),
    'Mnxt = Sft Fy': lambda v: v['Sft'] * v['Fy'],
    # ---- Chapter D
    'Tn = Ag Fy': lambda v: v['Ag'] * v['Fy'],
    'Tn = An Fu': lambda v: v['An'] * v['Fu'],
    'An = Ag − n_holes dh t': lambda v: max(v['Ag'] - v['n_holes'] * v['dh'] * v['t'], 0.0),
    # ---- J2 용접
    'L / t': lambda v: v['L'] / v['t'],
    'Pnv1 = 0.75 t1 L Fu1': lambda v: 0.75 * v['t1'] * v['L'] * v['Fu1'],
    'Pnv2 = 0.75 t2 L Fu2': lambda v: 0.75 * v['t2'] * v['L'] * v['Fu2'],
    'Pnv1 = (1 − 0.01 L/t1) L t1 Fu1': lambda v: (1 - 0.01 * v['L'] / v['t1']) * v['L'] * v['t1'] * v['Fu1'],
    'Pnv2 = (1 − 0.01 L/t2) L t2 Fu2': lambda v: (1 - 0.01 * v['L'] / v['t2']) * v['L'] * v['t2'] * v['Fu2'],
    'Pnv1 = t1 L Fu1': lambda v: v['t1'] * v['L'] * v['Fu1'],
    'Pnv2 = t2 L Fu2': lambda v: v['t2'] * v['L'] * v['Fu2'],
    'Pnv = min(Pnv1, Pnv2) n_welds': lambda v: min(v['Pnv1'], v['Pnv2']) * v['n'],
    'tw = 0.707 min(w1, w2)': lambda v: 0.707 * min(v['w1'], v['w2']),
    'Pn = 0.75 tw L Fxx n_welds': lambda v: 0.75 * v['tw'] * v['L'] * v['Fxx'] * v['n'],
    'da = d − t': lambda v: v['d'] - v['t'],
    'de = 0.7 d − 1.5 t ≤ 0.55 d': lambda v: min(max(0.7 * v['d'] - 1.5 * v['t'], 0.0), 0.55 * v['d']),
    'de = 0.7 d − 1.5 t  (≥ 0)': lambda v: max(0.7 * v['d'] - 1.5 * v['t'], 0.0),
    'de = min(de, 0.55 d)  (in-house conservative cap, A1.2 — not in Eq. J2.3.2.1-3)':
        lambda v: min(v['de'], 0.55 * v['d']),
    'λ = (E / Fu)^0.5': lambda v: sqrt(v['E'] / v['Fu']),
    'da / t': lambda v: v['da'] / v['t'],
    'Pnv = (π de² / 4) 0.75 Fxx n': lambda v: pi * v['de'] ** 2 / 4 * 0.75 * v['Fxx'] * v['n'],
    'Pnv = 2.20 t da Fu n': lambda v: 2.20 * v['t'] * v['da'] * v['Fu'] * v['n'],
    'Pnv = 0.280 [1 + 5.59 λ / (da/t)] t da Fu n':
        lambda v: 0.280 * (1 + 5.59 * v['λ'] / v['da/t']) * v['t'] * v['da'] * v['Fu'] * v['n'],
    'Pnv = 1.40 t da Fu n': lambda v: 1.40 * v['t'] * v['da'] * v['Fu'] * v['n'],
    'Pnv = 1.65 t da Fu n': lambda v: 1.65 * v['t'] * v['da'] * v['Fu'] * v['n'],
    'Pnt1 = (π de² / 4) Fxx': lambda v: pi * v['de'] ** 2 / 4 * v['Fxx'],
    'Pnt2 = 0.8 (Fu/Fy)² t da Fu': lambda v: 0.8 * (v['Fu'] / v['Fy']) ** 2 * v['t'] * v['da'] * v['Fu'],
    'Pnt = min(Pnt1, Pnt2) × r  (r: 0.5 eccentric, 0.7 sidelap)': lambda v: min(v['Pnt1'], v['Pnt2']) * v['r'],
    'Pnt,total = n Pnt': lambda v: v['n'] * v['Pnt'],
    'Pnv = (π de² / 4 + L de) 0.75 Fxx n': lambda v: (pi * v['de'] ** 2 / 4 + v['L'] * v['de']) * 0.75 * v['Fxx'] * v['n'],
    'Pnv = 2.5 t Fu (0.25 L + 0.96 da) n': lambda v: 2.5 * v['t'] * v['Fu'] * (0.25 * v['L'] + 0.96 * v['da']) * v['n'],
    'L ≤ 3d': lambda v: min(v['L'], 3 * v['d']),
    'Pn = 0.833 t L Fu': lambda v: 0.833 * v['t'] * v['L'] * v['Fu'],
    'Pn = 1.50 t L Fu': lambda v: 1.50 * v['t'] * v['L'] * v['Fu'],
    'Pn = 0.75 t L Fu': lambda v: 0.75 * v['t'] * v['L'] * v['Fu'],
    'Pn,weld = 0.75 tw L Fxx': lambda v: 0.75 * v['tw'] * v['L'] * v['Fxx'],
    'Pn = min(Pn, Pn,weld)': lambda v: min(v['Pn'], v['Pn,weld']),
    'te = t (complete joint penetration)': lambda v: v['t'],
    'te = 0.5 t (reference only — no basis in the Specification)': lambda v: 0.5 * v['t'],
    'Pn = L te Fy': lambda v: v['L'] * v['te'] * v['Fy'],
    'Pn2 = L te 0.6 Fxx  (weld metal)': lambda v: v['L'] * v['te'] * 0.6 * v['Fxx'],
    'Pn3 = L te Fy / √3  (base metal)': lambda v: v['L'] * v['te'] * v['Fy'] / sqrt(3),
    'Pn = Pn3': lambda v: v['Pn3'],
    'Pn = Pn2': lambda v: v['Pn2'],
    # ---- J3 볼트 · App. A J3.4
    'Ab = π d² / 4': lambda v: pi * v['d'] ** 2 / 4,
    'Pnv = n Ab Fnv': lambda v: v['n'] * v['Ab'] * v['Fnv'],
    'Pnt = n Ab Fnt': lambda v: v['n'] * v['Ab'] * v['Fnt'],
    'Pnb = n C mf d t Fu': lambda v: v['n'] * v['C'] * v['mf'] * v['d'] * v['t'] * v['Fu'],
    'Pnb = n (4.64 α t + 1.53) d t Fu': lambda v: v['n'] * (4.64 * v['α'] * v['t'] + 1.53) * v['d'] * v['t'] * v['Fu'],
    'fv = V / (n Ab)': lambda v: v['V'] / (v['n'] * v['Ab']),
    "F'nt = 1.3 Fnt − (Fnt / (φv Fnv)) fv, 0 ≤ F'nt ≤ Fnt":
        lambda v: _clamp(1.3 * v['Fnt'] - v['Fnt'] / (v['φv'] * v['Fnv']) * v['fv'], 0.0, v['Fnt']),
    "F'nt = 1.3 Fnt − (Ωv Fnt / Fnv) fv, 0 ≤ F'nt ≤ Fnt":
        lambda v: _clamp(1.3 * v['Fnt'] - v['Ωv'] * v['Fnt'] / v['Fnv'] * v['fv'], 0.0, v['Fnt']),
    "Pnt' = n Ab F'nt": lambda v: v['n'] * v['Ab'] * v["F'nt"],
    "Pnov = 1.5 t d'w Fu n  (Eq. J4.4.2-1 form, A1.2(c))": lambda v: 1.5 * v['t'] * v["d'w"] * v['Fu'] * v['n'],
    'Pnov = n Pnov,bolt  (test / rational value, A1.2(c) factors)': lambda v: v['n'] * v['Pnov,bolt'],
    # ---- J4 나사
    't2/t1': lambda v: v['t2'] / v['t1'],
    'Pnv1 = 4.2 (t2³ d)^0.5 Fu2 n  (tilting)': lambda v: 4.2 * sqrt(v['t2'] ** 3 * v['d']) * v['Fu2'] * v['n'],
    'Pnv2 = 2.7 t1 d Fu1 n': lambda v: 2.7 * v['t1'] * v['d'] * v['Fu1'] * v['n'],
    'Pnv3 = 2.7 t2 d Fu2 n': lambda v: 2.7 * v['t2'] * v['d'] * v['Fu2'] * v['n'],
    'Pnv = min(Pnv1, Pnv2, Pnv3)': lambda v: min(v['Pnv1'], v['Pnv2'], v['Pnv3']),
    'Pnv = min(Pnv2, Pnv3)  (Eq. J4.3.1-4/-5)': lambda v: min(v['Pnv2'], v['Pnv3']),
    'Pnv = (1 − k) min(Pnv1, Pnv2, Pnv3) + k min(Pnv2, Pnv3), k = (t2/t1 − 1)/1.5':
        lambda v: (1 - (v['t2/t1'] - 1) / 1.5) * min(v['Pnv1'], v['Pnv2'], v['Pnv3'])
        + (v['t2/t1'] - 1) / 1.5 * min(v['Pnv2'], v['Pnv3']),
    'Pnvs,total = n Pnvs': lambda v: v['n'] * v['Pnvs'],
    'Pnts,total = n Pnts': lambda v: v['n'] * v['Pnts'],
    'Pnvs ≈ 0.5 Fub As n (in-house estimate, not a specification value)': lambda v: 0.5 * v['Fub'] * v['As'] * v['n'],
    'Pnot = 0.85 tc d Fu2 n': lambda v: 0.85 * v['tc'] * v['d'] * v['Fu2'] * v['n'],
    'Pnot = 0.85 tc d Fu2': lambda v: 0.85 * v['tc'] * v['d'] * v['Fu2'],
    'Pnot = n Pnot,test': lambda v: v['n'] * v['Pnot,test'],
    "Pnov = 1.5 t1 d'w Fu1 n": lambda v: 1.5 * v['t1'] * v["d'w"] * v['Fu1'] * v['n'],
    'Pnov = 1.5 t1 dw Fu1': lambda v: 1.5 * v['t1'] * v['dw'] * v['Fu1'],
    "d'w = min(d'w, d'w,max)": lambda v: min(v["d'w"], v["d'w,max"]),
    'Pnv = 2.7 t1 d Fu1': lambda v: 2.7 * v['t1'] * v['d'] * v['Fu1'],
    'Pnv = 4.2 (t2³ d)^0.5 Fu2': lambda v: 4.2 * sqrt(v['t2'] ** 3 * v['d']) * v['Fu2'],
    'V/Pnv + 0.71 T/Pnov  (per screw)': lambda v: v['V'] / v['Pnv'] + 0.71 * v['T'] / v['Pnov'],
    'V/Pnv + T/Pnot  (per screw)': lambda v: v['V'] / v['Pnv'] + v['T'] / v['Pnot'],
    'V/Pnvs + T/Pnts  (per screw)': lambda v: v['V'] / v['Pnvs'] + v['T'] / v['Pnts'],
    'V/Pnv + T/Pnov  (per screw, Commentary C-J4.5.1-1 as A1.2(c))': lambda v: v['V'] / v['Pnv'] + v['T'] / v['Pnov'],
    'V/Pnv + T/Pnot  (per screw, Commentary C-J4.5.1-1 as A1.2(c))': lambda v: v['V'] / v['Pnv'] + v['T'] / v['Pnot'],
    'limit = φ': lambda v: v['φ'],
    'limit = 1 / Ω': lambda v: 1 / v['Ω'],
    # ---- J5 PAF
    'F_uh = F_bs e^(HRC/40)': lambda v: v['F_bs'] * math.exp(v['HRC'] / 40),
    'F_uh = min(F_uh, F_uh,alt)  (engine takes the smaller — conservative)': lambda v: min(v['F_uh'], v['F_uh,alt']),
    'Pntp = π (ds/2)² F_uh n': lambda v: pi * (v['ds'] / 2) ** 2 * v['F_uh'] * v['n'],
    'Pnvp = 0.6 π (ds/2)² F_uh n': lambda v: 0.6 * pi * (v['ds'] / 2) ** 2 * v['F_uh'] * v['n'],
    'Pnb = αb ds t1 Fu1 n': lambda v: v['αb'] * v['ds'] * v['t1'] * v['Fu1'] * v['n'],
    "Pnov = αw t1 d'w Fu1 n": lambda v: v['αw'] * v['t1'] * v["d'w"] * v['Fu1'] * v['n'],
    'Pnos = dae^1.8 t2^0.2 (Fy2 E²)^(1/3) / 30 n':
        lambda v: v['dae'] ** 1.8 * v['t2'] ** 0.2 * (v['Fy2'] * v['E'] ** 2) ** (1 / 3) / 30 * v['n'],
    # ---- J2.2.4 · C-J5.4 상호작용 (원문의 좌변)
    '(T / Pat)^1.5  (per weld)': lambda v: (v['T'] / v['Pat']) ** 1.5,
    'value = (T/Pat)^1.5': lambda v: v['(T/Pat)^1.5'],
    '(V/Pav)^1.5 + (T/Pat)^1.5  (per weld)': lambda v: (v['V'] / v['Pav']) ** 1.5 + v['(T/Pat)^1.5'],
    '(T/Pat)^1 + (V/Pav)^1': lambda v: v['T'] / v['Pat'] + v['V'] / v['Pav'],
    '(T/Pat)^2 + (V/Pav)^2': lambda v: (v['T'] / v['Pat']) ** 2 + (v['V'] / v['Pav']) ** 2,
    # ---- J6
    'e_net = (e − dh/2) + (n_rows − 1)(pitch − dh)':
        lambda v: (v['e'] - v['dh'] / 2) + (v['n_rows'] - 1) * (v['pitch'] - v['dh']),
    'Anv = 2 n t e_net': lambda v: 2 * v['n'] * v['t'] * v['e_net'],
    'Pnv = 0.6 Fu Anv': lambda v: 0.6 * v['Fu'] * v['Anv'],
    'Ant = Ag − n dh t': lambda v: max(v['Ag'] - v['n'] * v['dh'] * v['t'], 0.0),
    "Ant = Ag − n dh t + t s'² / (4 g + 2 dh)  (staggered)":
        lambda v: max(v['Ag'] - v['n'] * v['dh'] * v['t'] + v['t'] * v["s'"] ** 2 / (4 * v['g'] + 2 * v['dh']), 0.0),
    'Pnt = Fu Usl Ant': lambda v: v['Fu'] * v['Usl'] * v['Ant'],
    'Pnr1 = 0.6 Fy Agv + Ubs Fu Ant': lambda v: 0.6 * v['Fy'] * v['Agv'] + v['Ubs'] * v['Fu'] * v['Ant'],
    'Pnr2 = 0.6 Fu Anv + Ubs Fu Ant': lambda v: 0.6 * v['Fu'] * v['Anv'] + v['Ubs'] * v['Fu'] * v['Ant'],
    'Pnr = min(Pnr1, Pnr2)': lambda v: min(v['Pnr1'], v['Pnr2']),
    # ---- 랩(사내 합리적 해석 §A1.2(c), 두 겹 부재)
    'arm = d − t': lambda v: v['d'] - v['t'],
    'V_flange = Mu / arm  (in-house rational model, §A1.2(c))': lambda v: v['Mu'] / v['arm'],
    'V_transfer = max(V_flange, Vu)': lambda v: max(v['V_flange'], v['Vu']),
    'V_transfer = Vu': lambda v: v['Vu'],
    'n = ceil(ceil(V_transfer/Pns) / rows) · rows':
        lambda v: math.ceil(math.ceil(v['V_transfer'] / v['Pns']) / v['rows']) * v['rows'],
    'n_used = min(n/rows, n_fit/row) · rows': lambda v: min(v['n'] / v['rows'], v['n_fit/row']) * v['rows'],
    'Mnℓ = Se Fy  (one member; laterally braced in the lap)': lambda v: v['Se'] * v['Fy'],
    'Mn,lap = 2 Mnℓ  (two lapped members, Manual II-2A assumption)': lambda v: 2 * v['Mnℓ'],
    'Mnd,lap = 2 Mnd': lambda v: 2 * v['Mnd'],
    'Vn,lap = 2 Vn  (two lapped members)': lambda v: 2 * v['Vn'],
    '[(Mu / φbMn,lap)² + (Vu / φvVn,lap)²]^0.5':
        lambda v: sqrt((v['Mu'] / v['φbMn,lap']) ** 2 + (v['Vu'] / v['φvVn,lap']) ** 2),
    '[(Mu / Mn,lap/Ωb)² + (Vu / Vn,lap/Ωv)²]^0.5':
        lambda v: sqrt((v['Mu'] / v['Mn,lap/Ωb']) ** 2 + (v['Vu'] / v['Vn,lap/Ωv']) ** 2),
    'Mx/Maxt + T/Ta  (no weak-axis moment)': lambda v: v['Mx'] / v['Maxt'] + v['T'] / v['Ta'],
    'Mx/Max − T/Ta  (no weak-axis moment)': lambda v: v['Mx'] / v['Max'] - v['T'] / v['Ta'],
    'Mx/Maxt + My/Mayt + T/Ta': lambda v: v['Mx'] / v['Maxt'] + v['My'] / v['Mayt'] + v['T'] / v['Ta'],
    'Mx/Max + My/May − T/Ta': lambda v: v['Mx'] / v['Max'] + v['My'] / v['May'] - v['T'] / v['Ta'],
}

# 계수가 식 안에 숫자로 있는 한계(나사 J4.5 · H3) — 'limit = k φ' / 'limit = k / Ω'
_LIMIT = re.compile(r'^limit = ([\d.]+) (φ|/ Ω)$')
# H1.2: 'P/Pa + Mx…/Max [+ My…/May]'
_H12 = re.compile(r'^P/Pa \+ (Mx(?:,amp)?)/Max(?: \+ (My(?:,amp|,used)?)/May)?$')
# 판좌굴 'Fcrl,<element> = k π² E / [12 (1 − μ²)] (t / w)²[ × s]'
_FCRL = re.compile(r'^Fcrl,(\w+) = k π² E / \[12 \(1 − μ²\)\] \(t / w\)²( × s)?$')
# 표 2.3.1.3-1 의 플랜지 성질
_FLANGE = re.compile(r'^(Af|Jf|Ixf|Iyf|Ixyf|xof|hxf|yof) \(flange \+ lip\)$')
# 표 B4.1-1 의 비 'web h/t' 등 — 입력 둘의 비
_RATIO = re.compile(r'.* (\S+)/(\S+)$')

# 표에서 값을 읽거나 사용자 · 해석이 준 값을 그대로 옮기는 단계 — 입력 = 결과만 확인한다(이유).
LOOKUPS = {
    'Mcrl (elastic local buckling moment)': 'FSM / user buckling value carried as given',
    'Mcrd (elastic distortional buckling moment)': 'FSM / user buckling value carried as given',
    'Mcrl (same section)': 'same value as the negative-region section',
    'Mcrd (β = 1 in the positive region)': 'same value, β = 1',
    'Pcrl (elastic local buckling load)': 'FSM / user buckling value carried as given',
    'Pcrd (elastic distortional buckling load)': 'FSM / user buckling value carried as given',
    'Fcre = rational elastic buckling stress (input)': 'user-supplied Fcre',
    'R from Table I6.2.1-1': 'user-supplied R (table row in the source)',
    'de (input — verified by the welding procedure)': 'user-supplied de',
    'Usl (input)': 'user-supplied Usl',
    'F_uh (input)': 'user-supplied F_uh',
}
# 값을 다시 계산할 수 없는(입력이 식을 이루지 않는) 서술 단계 — 결과가 숫자라는 것만 본다(이유).
DESCRIPTIVE = {
    'tw = (w2 + twf − R + (2 R w1 − w1²)^0.5) w1/wf − η R w2/wf, wf = (w1² + w2²)^0.5':
        'flare-bevel throat: the process-dependent twf/R and η are one combined table input (Table J2.6-1)',
    'tw = min(twf − d1, twf − d2), twf = k R': 'flare-V throat with twf = k R from Table J2.6-1',
}


def _recompute(step):
    e = step['expr']
    v = _v(step)
    if e in F:
        return F[e](v)
    if e.startswith('Usl = '):
        return _usl(e)(v)
    m = _LIMIT.match(e)
    if m:
        k = float(m.group(1))
        return k * v['φ'] if m.group(2) == 'φ' else k / v['Ω']
    m = _H12.match(e)
    if m:
        out = v['P'] / v['Pa'] + v[m.group(1)] / v['Max']
        if m.group(2):
            out += v[m.group(2)] / v['May']
        return out
    m = _FCRL.match(e)
    if m:
        w = v['w,' + m.group(1)]
        out = v['k'] * pi ** 2 * v['E'] / (12 * (1 - v['μ'] ** 2)) * (v['t'] / w) ** 2
        return out * v['s'] if m.group(2) else out
    m = _FLANGE.match(e)
    if m:
        return _flange(v, m.group(1))
    if e.startswith('C from Table J3.3.1-1'):
        return _bearing_C(v['d'], v['t'], 'oversized' in str(step['result'].get('source') or '')
                          or v.get('hole') == 'oversized')
    if e in LOOKUPS:
        assert len(step['inputs']) == 1
        return step['inputs'][0]['value']
    if e in DESCRIPTIVE:
        return step['result']['value']
    # 표 B4.1-1 의 비(이름 + 'a/b'): 첫 입력 / 둘째 입력
    m = _RATIO.match(e)
    if m and len(step['inputs']) == 2 and step['kind'] == 'equation' and step['result']['symbol'] == \
            f'{m.group(1)}/{m.group(2)}':
        return step['inputs'][0]['value'] / step['inputs'][1]['value']
    raise KeyError(e)


_CMP = {'≤': lambda a, b: a <= b, '<': lambda a, b: a < b, '≥': lambda a, b: a >= b, '>': lambda a, b: a > b}
_COND = re.compile(r'^(\S+) (≤|<|≥|>) (?:([\d.]+) ?)?(\S+)?$')

CONDITIONS = {
    '0.0714 E/Fy < D/t ≤ 0.318 E/Fy': lambda v: 0.0714 * v['E'] / v['Fy'] < v['D/t'] <= 0.318 * v['E'] / v['Fy'],
    'D/t ≤ 0.0714 E/Fy': lambda v: v['D/t'] <= 0.0714 * v['E'] / v['Fy'],
    '0.318 E/Fy < D/t ≤ 0.441 E/Fy': lambda v: 0.318 * v['E'] / v['Fy'] < v['D/t'] <= 0.441 * v['E'] / v['Fy'],
    '0.815 λ < da/t < 1.397 λ': lambda v: 0.815 * v['λ'] < v['da/t'] < 1.397 * v['λ'],
    '1.0 < t2/t1 < 2.5 (linear interpolation)': lambda v: 1.0 < v['t2/t1'] < 2.5,
    'M/Maℓo > 0.5 and V/Va > 0.7': lambda v: v['M'] / v['Maℓo'] > 0.5 and v['Vu'] / v['Va'] > 0.7,
    'Pn2/1.90 ≤ Pn3/1.70': lambda v: v['Pn2'] / 1.90 <= v['Pn3'] / 1.70,
    '0.80 Pn2 ≤ 0.90 Pn3': lambda v: 0.80 * v['Pn2'] <= 0.90 * v['Pn3'],
    'tw ≥ 2t and h ≥ L (longitudinal)': lambda v: v['tw'] >= 2 * v['t'] and v.get('h', -1) >= v['L'],
    'My,ecc ≥ My,amp  (the larger moment gives the smaller allowable P — §H1.2 angle)':
        lambda v: v['My,ecc'] >= v['My,amp'],
}
# 조건이 입력으로 다시 판정할 수 있는 식이 아닌 서술 갈래(하중 방향 · 사용자 진술) — 이유
BRANCH_DESCRIPTIVE = {
    'exponent 2 when PAF tension and pin shear govern, else 1': 'which limit states govern (named in the inputs)',
    'transverse load': 'load direction stated by the caller',
    'transverse load (flare bevel)': 'load direction stated by the caller',
}


def _branch_holds(step):
    c = step['condition']
    v = _v(step)
    if c in CONDITIONS:
        return CONDITIONS[c](v)
    if c in BRANCH_DESCRIPTIVE:
        return step['holds']
    core = c.split('  (')[0].split(' (')[0].strip()
    m = _COND.match(core)
    if not m:
        raise KeyError(c)
    lhs, op, k, sym = m.groups()
    a = v[lhs]
    if k is not None and sym is None:
        b = float(k)
    elif k is not None:
        b = float(k) * v[sym]
    elif sym in v:
        b = v[sym]
    else:
        b = float(sym)
    if len(step['inputs']) >= 2 and step['inputs'][1]['symbol'] == 'limit':
        b = step['inputs'][1]['value']           # 표 B4.1-1: 한계는 입력에도 있다
    return _CMP[op](a, b)


def _close(a, b):
    if a is None or b is None:
        return a is b
    if math.isinf(a) or math.isinf(b):
        return a == b
    return abs(a - b) <= REL * max(1.0, abs(a), abs(b))


def _checks(result):
    out = list(result.get('design_checks') or [])
    out += list((result.get('fastener_design') or {}).get('design_checks') or [])
    return out


def _all():
    for name, method, params in cases.all_cases():
        if method not in ('aisi_design', 'design_connection', 'lap_connection'):
            continue
        r = cases.run_case(method, params)
        if 'error' in r:
            continue
        yield name, r


def test_every_step_is_recomputed_from_its_own_inputs():
    unknown, wrong, n = set(), [], 0
    for name, r in _all():
        for c in _checks(r):
            for k, st in enumerate(c['steps']):
                where = (name, c['id'], k, st.get('expr') or st.get('condition'))
                if st['kind'] == 'branch':
                    try:
                        h = _branch_holds(st)
                    except KeyError:
                        unknown.add(('branch', st['condition']))
                        continue
                    n += 1
                    if bool(h) != st['holds']:
                        wrong.append(where + ('holds', st['holds'], h))
                    continue
                if st['kind'] == 'design_strength':
                    ins = st['inputs']
                    fac = [i for i in ins if i['symbol'][:1] in ('φ', 'Ω')]
                    rest = [i for i in ins if i not in fac]
                    if fac and len(rest) != 1:
                        wrong.append(where + ('design strength is not nominal × factor', [i['symbol'] for i in ins]))
                        continue
                    if fac:
                        got = (rest[0]['value'] * fac[0]['value'] if fac[0]['symbol'][:1] == 'φ'
                               else rest[0]['value'] / fac[0]['value'])
                    else:
                        got = math.prod(i['value'] for i in ins)
                    n += 1
                    if not _close(got, st['result']['value']):
                        wrong.append(where + (got, st['result']['value']))
                    continue
                if st['kind'] == 'verdict':
                    ins = st['inputs']
                    ex = next((i['value'] for i in ins if i['symbol'] == 'exponent'), 1)
                    nums = [i for i in ins if i['symbol'] != 'exponent']
                    if nums[1]['value']:
                        got = (nums[0]['value'] / nums[1]['value']) ** (1.0 / ex)
                        n += 1
                        if not _close(got, st['result']['value']):
                            wrong.append(where + ('ratio', got, st['result']['value']))
                        if st.get('verdict') == 'pass':
                            assert got <= 1.0 + 1e-9, where
                        if st.get('verdict') == 'fail':
                            assert got > 1.0, where
                    continue
                try:
                    got = _recompute(st)
                except KeyError:
                    unknown.add((st['kind'], st['expr']))
                    continue
                n += 1
                res = st['result']
                want = math.inf if res.get('unbounded') else res['value']
                rt = st.get('rounded_to')
                if rt:
                    # 엔진이 반올림해 넘긴 값(계약 §5: rounded_to) — 그 자리까지 같아야 한다
                    if not abs(got - want) <= rt / 2 + 1e-12:
                        wrong.append(where + ('rounded_to', rt, got, want))
                    continue
                if not _close(got, want):
                    wrong.append(where + (got, want))
    assert not unknown, sorted(unknown)
    assert not wrong, wrong[:20]
    assert n > 3000, n


def test_a_misstated_trace_is_caught():
    """시험이 정말 잡는지: 단계의 입력 하나를 바꾸면(숨은 계수 · 잘못된 출처와 같은 꼴) 다시 계산이 어긋난다."""
    r = cases.run_case('design_connection', dict(cases._iv9('ASD'), Pu=1.0))
    st = [s for c in r['design_checks'] for s in c['steps'] if s['expr'] == 'Anv = 2 n t e_net'][0]
    assert _close(_recompute(st), st['result']['value'])
    bad = dict(st, inputs=[dict(i, value=i['value'] * 2) if i['symbol'] == 'n' else i for i in st['inputs']])
    assert not _close(_recompute(bad), st['result']['value'])
