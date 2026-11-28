"""휨 + 비틀림 — AISI S100-16 §H4 (Eq. H4-1), 2026-11-26 EB.

원문(스킬 data/specification/Chapter_H_Combined_Forces_Torsion.md §H4):
  "For torsionally unrestrained flexural members subjected to both bending and torsional loading, the available
  flexural strength calculated in accordance with Section F3 with Fn = Fy or Mne = My shall be multiplied by a
  reduction factor, R." — R = f_bending_max / (f_bending + f_torsion) ≤ 1 (Eq. H4-1).
  · f_bending_max: 극단 섬유의 휨 응력(f_bending 과 중립축의 같은 쪽)
  · f_bending · f_torsion: 휨 + 비틀림 뒤틀림 응력의 합이 가장 큰 자리의 휨 응력 · 뒤틀림 수직응력
  · 한정: 일축 · 이축 대칭 단면이 대칭축에 대해 휘고 이축 휨이 없을 때만(그 밖은 합리적 해석)
  · 응력은 감소하지 않은 전단면 성질로. 연단 보강 플랜지의 C 단면에서 최대 합응력이 웹-플랜지 이음에 생기면
    R 을 15 % 올려도 된다(R ≤ 1.0). §I6.2.1 · §I6.2.2 를 쓰면 이 조항은 적용하지 않는다.
해설(Commentary H4): R 은 F2 · F4 를 줄이지 않는 따로 된 한계상태이고, H1 · H2 · H3 상호작용에도 넣지 않는다.

비틀림 해(계산 길 ②): Design Manual Example II-11 이 쓰는 AISC Design Guide 9 의 닫힌 식 —
  Case 4 (등분포 비틀림 t, 양 끝 비틀림 단순 지지: 회전 구속 · 뒤틀림 자유)
    θ = (t a²/GJ)[(L²/2a²)(z/L − z²/L²) + cosh(z/a) − tanh(L/2a) sinh(z/a) − 1]
    θ'' = (t/GJ)[−1 + cosh(z/a) − tanh(L/2a) sinh(z/a)]
  Case 3 (집중 비틀림 T, z = αL, 같은 지지), 0 ≤ z ≤ αL:
    θ = (TL/GJ)[(1 − α) z/L + (a/L)(sinh(αL/a)/tanh(L/a) − cosh(αL/a)) sinh(z/a)]
    θ'' = (T/aGJ)[(sinh(αL/a)/tanh(L/a) − cosh(αL/a)) sinh(z/a)]
  a = (E Cw / G J)^0.5 (DG 9 Eq. 3.12). 둘 다 E Cw θ'''' − G J θ'' = m_t 와 θ = θ'' = 0(양 끝)을 푼다(시험이 수치해로 확인).
  아래 구현은 같은 식을 넘침이 없는 꼴로 쓴 것이다: cosh u − tanh c sinh u = cosh(c − u)/cosh c,
  sinh(αλ)/tanh λ − cosh(αλ) = −sinh((1 − α)λ)/sinh λ.
뒤틀림 수직응력: σw = −E ωn θ'' (축 변위 u = −ωn θ'). ωn 은 전단중심에 대한 정규화한 부채꼴 좌표
  (dω = (r × ds)·e_y, r = 전단중심에서 잰 위치; ∫ωn dA = 0) — 이 모듈이 절점 모델에서 직접 만들고, 그 Cw = ∫ωn² dA 가
  엔진의 cutwp Cw 와 같은지 확인한다. 휨 응력: σb = −M (z − zcg)/Ixx (아래로 미는 하중의 정모멘트가 +z 쪽을 누른다).
  비틀림 m_t = (x_L − xs)·q_z (반시계 +, q_z 는 z 방향 하중) — 하중의 부호를 바꾸면 두 응력이 같이 바뀌어 R 은 그대로다.
"""

import math

import numpy as np

from design.steel_grades import E as E_STEEL, G as G_STEEL

H4_INCREASE = 1.15       # §H4: "the R factor is permitted to be increased by 15 percent"


# ---------------------------------------------------------------- Eq. H4-1 (계산 길 ① — 응력을 직접)

def r_factor_direct(f_bending: float, f_torsion: float, f_bending_max: float | None = None,
                    at_web_flange_junction: bool = False, edge_stiffened_c: bool = False) -> dict:
    """Eq. H4-1 — 응력을 직접 받은 R. 응력은 부호 있는 값(같은 부호 규약, ksi). 하중 크기와 무관(비).

    f_bending_max 를 주지 않으면 f_bending 과 같다고 둔다(그 자리가 극단 섬유 — R 이 작아지는 쪽).
    돌려주는 dict: R, R_raw(15 % 전 · 상한 전), increased, f_combined, f_bending_max_defaulted, error.
    """
    out = {'f_bending': f_bending, 'f_torsion': f_torsion, 'f_bending_max': f_bending_max,
           'f_bending_max_defaulted': f_bending_max is None}
    fbm = f_bending if f_bending_max is None else f_bending_max
    out['f_bending_max'] = fbm
    if f_bending != 0 and fbm != 0 and (f_bending > 0) != (fbm > 0):
        out['error'] = 'sides'
        return out
    comb = f_bending + f_torsion
    out['f_combined'] = comb
    if comb == 0 or fbm == 0:
        out['error'] = 'zero'
        return out
    R_raw = abs(fbm) / abs(comb)                       # Eq. H4-1 (부호가 같은 두 응력의 비)
    inc = bool(at_web_flange_junction and edge_stiffened_c)
    R = min((H4_INCREASE * R_raw) if inc else R_raw, 1.0)
    out.update(R_raw=R_raw, R=R, increased=inc, capped=R < (H4_INCREASE * R_raw if inc else R_raw))
    return out


# ---------------------------------------------------------------- 단면 모델

def _ends(elem):
    e = np.asarray(elem, dtype=float)
    return [(int(r[1]) - 1, int(r[2]) - 1, float(r[3])) for r in e]


def section_topology_ok(node, elem) -> str | None:
    """열린 나무 꼴(이어져 있고 고리 없음)이면 None, 아니면 까닭('closed' | 'disconnected' | 'empty')."""
    ends = _ends(elem)
    n = len(node)
    if n == 0 or not ends:
        return 'empty'
    used = sorted({i for a, b, _ in ends for i in (a, b)})
    parent = {i: i for i in used}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for a, b, _ in ends:
        ra, rb = find(a), find(b)
        if ra == rb:
            return 'closed'
        parent[ra] = rb
    if len({find(i) for i in used}) != 1:
        return 'disconnected'
    return None


def sectorial_coordinate(node, elem, xs: float, zs: float) -> tuple:
    """전단중심 (xs, zs) 에 대한 정규화한 부채꼴 좌표 ωn(절점마다, in²)과 Cw = ∫ωn² dA (in⁶).

    요소 i→j 에서 Δω = (x_i − xs)(z_j − z_i) − (z_i − zs)(x_j − x_i) (= r_i × Δr, 요소 안에서 일정한 r × t).
    열린 나무를 아무 절점에서나 따라가 ω 를 만들고, ∫ω dA / A 를 빼서 정규화한다. 쓰지 않는 절점은 nan.
    """
    nd = np.asarray(node, dtype=float)
    x, z = nd[:, 1], nd[:, 2]
    ends = _ends(elem)
    adj = {}
    for k, (a, b, _t) in enumerate(ends):
        adj.setdefault(a, []).append((b, k))
        adj.setdefault(b, []).append((a, k))
    w = np.full(len(nd), np.nan)
    start = ends[0][0]
    w[start] = 0.0
    stack = [start]
    while stack:
        i = stack.pop()
        for j, _k in adj.get(i, []):
            if np.isnan(w[j]):
                w[j] = w[i] + (x[i] - xs) * (z[j] - z[i]) - (z[i] - zs) * (x[j] - x[i])
                stack.append(j)
    A = sum(math.hypot(x[b] - x[a], z[b] - z[a]) * t for a, b, t in ends)
    Sw = sum(math.hypot(x[b] - x[a], z[b] - z[a]) * t * (w[a] + w[b]) / 2.0 for a, b, t in ends)
    wn = w - Sw / A
    Cw = sum(math.hypot(x[b] - x[a], z[b] - z[a]) * t * (wn[a] ** 2 + wn[a] * wn[b] + wn[b] ** 2) / 3.0
             for a, b, t in ends)
    return wn, Cw


def symmetric_about_horizontal(node, elem, zc: float, tol: float = 1e-6) -> bool:
    """단면이 수평선 z = zc 에 대해 거울 대칭인가(절점 집합 · 요소 두께로). Mxx 는 그 축(대칭축)에 대한 휨이다."""
    nd = np.asarray(node, dtype=float)
    ends = _ends(elem)
    used = sorted({i for a, b, _ in ends for i in (a, b)})
    span = max(np.ptp(nd[used, 1]), np.ptp(nd[used, 2]), 1e-12)
    eps = tol * span * 1e3

    def mirror_of(i):
        xm, zm = nd[i, 1], 2.0 * zc - nd[i, 2]
        d = np.hypot(nd[used, 1] - xm, nd[used, 2] - zm)
        k = int(np.argmin(d))
        return used[k] if d[k] <= eps else None
    mp = {}
    for i in used:
        m = mirror_of(i)
        if m is None:
            return False
        mp[i] = m
    have = {(min(a, b), max(a, b)): t for a, b, t in ends}
    for (a, b), t in have.items():
        key = (min(mp[a], mp[b]), max(mp[a], mp[b]))
        if key not in have or abs(have[key] - t) > 1e-9 * max(t, 1.0):
            return False
    return True


def web_flange_junction_nodes(node, elem, roles) -> set | None:
    """웹-플랜지 이음의 절점(0 기준). roles 가 없으면 None(가려낼 수 없음).

    날카로운 모서리: 웹 요소와 플랜지 요소가 함께 닿는 절점. 둥근 모서리: 웹 끝과 플랜지 끝을 잇는 'corner'
    요소 사슬의 모든 절점(웹 · 플랜지 끝 절점 포함) — 원호 전체를 이음으로 본다.
    """
    if not roles or len(roles) != len(elem):
        return None
    ends = _ends(elem)
    by_node = {}
    for k, (a, b, _t) in enumerate(ends):
        by_node.setdefault(a, set()).add(k)
        by_node.setdefault(b, set()).add(k)

    def kind(k):
        r = str(roles[k] or '').lower()
        return 'web' if r == 'web' else ('flange' if 'flange' in r else ('corner' if r == 'corner' else 'other'))
    out = set()
    for i, ks in by_node.items():
        kinds = {kind(k) for k in ks}
        if 'web' in kinds and 'flange' in kinds:
            out.add(i)
    seen = set()
    for k0, _ in enumerate(ends):
        if kind(k0) != 'corner' or k0 in seen:
            continue
        comp, stack = set(), [k0]
        while stack:
            k = stack.pop()
            if k in comp:
                continue
            comp.add(k)
            for i in ends[k][:2]:
                for kk in by_node[i]:
                    if kind(kk) == 'corner' and kk not in comp:
                        stack.append(kk)
        seen |= comp
        nodes = {i for k in comp for i in ends[k][:2]}
        touch = {kind(kk) for i in nodes for kk in by_node[i]}
        if 'web' in touch and 'flange' in touch:
            out |= nodes
    return out


# ---------------------------------------------------------------- DG 9 닫힌 식 (Design Manual Example II-11)

def phi_pp_uniform(z: float, L: float, a: float, GJ: float, t_r: float) -> float:
    """Case 4 θ''(z) — t_r 등분포 비틀림(kip-in/in), 양 끝 비틀림 단순 지지."""
    c, u = L / (2.0 * a), z / a
    g = (math.exp(-u) + math.exp(u - 2.0 * c)) / (1.0 + math.exp(-2.0 * c)) - 1.0   # cosh(c−u)/cosh c − 1
    return t_r / GJ * g


def phi_uniform(z: float, L: float, a: float, GJ: float, t_r: float) -> float:
    """Case 4 θ(z) (rad)."""
    lam, c, u, zeta = L / a, L / (2.0 * a), z / a, z / L
    g = (math.exp(-u) + math.exp(u - 2.0 * c)) / (1.0 + math.exp(-2.0 * c)) - 1.0
    return t_r * a * a / GJ * (lam * lam / 2.0 * (zeta - zeta * zeta) + g)


def _sinh_ratio(p: float, q: float, lam: float) -> float:
    """sinh p · sinh q / sinh λ (p, q ≥ 0, p + q ≤ λ) — 넘침 없이."""
    if lam <= 0:
        return 0.0
    return (math.exp(p + q - lam) * (1.0 - math.exp(-2.0 * p)) * (1.0 - math.exp(-2.0 * q))
            / (2.0 * (1.0 - math.exp(-2.0 * lam))))


def phi_pp_point(z: float, L: float, a: float, GJ: float, T: float, alpha: float) -> float:
    """Case 3 θ''(z) — z = αL 의 집중 비틀림 T(kip-in). z > αL 은 대칭(z → L − z, α → 1 − α)."""
    if z > alpha * L:
        z, alpha = L - z, 1.0 - alpha
    lam = L / a
    return -T / (a * GJ) * _sinh_ratio((1.0 - alpha) * lam, z / a, lam)


def phi_point(z: float, L: float, a: float, GJ: float, T: float, alpha: float) -> float:
    """Case 3 θ(z) (rad)."""
    if z > alpha * L:
        z, alpha = L - z, 1.0 - alpha
    lam = L / a
    return T / GJ * ((1.0 - alpha) * z - a * _sinh_ratio((1.0 - alpha) * lam, z / a, lam))


# ---------------------------------------------------------------- Eq. H4-1 (계산 길 ② — 하중의 편심으로)

LOADS = ('uniform', 'midspan_point')


def r_factor_eccentric(node, elem, *, e: float, L: float, load: str, roles=None,
                       edge_stiffened_c: bool = False, Mu: float | None = None,
                       E: float = E_STEEL, G: float = G_STEEL, n_grid: int = 200) -> dict:
    """한 경간(양 끝 비틀림 단순 지지)의 R — 하중선이 전단중심에서 e 만큼 떨어진 등분포 · 중앙 집중 하중.

    e: 전단중심 → 하중선의 거리(in), 도심 쪽이 +(C 단면의 웹 위 하중이면 e = m > 0). 하중은 z 방향(웹과 나란히).
    L: 비틀림 경간(회전이 막힌 두 끝 사이, in). Mu: 경간 중앙의 소요 모멘트(응력 · 회전을 그 하중으로 보이려고).
    경간을 n_grid 칸으로 나누어 단면마다 모든 절점에서 σb + σw 를 보고, 합이 가장 큰 절점에서 R(z)(Eq. H4-1)을 만든다.
    지배 단면은 M(z)/[R(z)·Mmax] 가 가장 큰 곳(검토 비가 가장 큰 곳). 돌려주는 dict 의 error: 'topology:…' ·
    'not_symmetric' · 'cw_mismatch' · 'no_torsion_stiffness'.
    """
    from engine.cutwp import cutwp_prop
    nd = np.asarray(node, dtype=float)
    el = np.asarray(elem, dtype=float)
    topo = section_topology_ok(nd, el)
    if topo:
        return {'error': 'topology:' + topo}
    cw = cutwp_prop(nd, el)
    xs, zs, J, Cw_eng = float(cw['Xs']), float(cw['Zs']), float(cw['J']), float(cw['Cw'])
    xcg, zcg, Ixx = float(cw['xcg']), float(cw['zcg']), float(cw['Ixx'])
    if not symmetric_about_horizontal(nd, el, zcg):
        return {'error': 'not_symmetric'}
    if not (J > 0 and Cw_eng > 0 and Ixx > 0):
        return {'error': 'no_torsion_stiffness', 'J': J, 'Cw': Cw_eng}
    wn, Cw = sectorial_coordinate(nd, el, xs, zs)
    if abs(Cw - Cw_eng) > 1e-3 * Cw_eng:
        return {'error': 'cw_mismatch', 'Cw': Cw, 'Cw_engine': Cw_eng}
    used = sorted({i for a, b, _ in _ends(el) for i in (a, b)})
    side = 1.0 if (xcg - xs) >= -1e-12 else -1.0            # +e = 도심 쪽
    if abs(xcg - xs) <= 1e-9:
        side = 1.0                                              # 이축 대칭(전단중심 = 도심): +x 쪽
    dx = side * e                                               # x_L − xs
    GJ, ECw = G * J, E * Cw
    a = math.sqrt(ECw / GJ)
    junction = web_flange_junction_nodes(nd, el, roles)
    zrel = nd[:, 2] - zcg
    zmax_up = max(zrel[i] for i in used)
    zmax_dn = min(zrel[i] for i in used)
    # 단위 하중(아래로, q_z = −1 또는 P = −1): m_t = (x_L − xs) q_z
    if load == 'uniform':
        Mmax = L * L / 8.0
        t_r = -dx

        def M_at(y):
            return y * (L - y) / 2.0

        def pp(y):
            return phi_pp_uniform(y, L, a, GJ, t_r)
        rot_mid = phi_uniform(L / 2.0, L, a, GJ, t_r)
    else:
        Mmax = L / 4.0
        T = -dx

        def M_at(y):
            return (y if y <= L / 2.0 else L - y) / 2.0

        def pp(y):
            return phi_pp_point(y, L, a, GJ, T, 0.5)
        rot_mid = phi_point(L / 2.0, L, a, GJ, T, 0.5)
    ys = sorted(set([L * k / n_grid for k in range(1, n_grid)] + [L / 2.0]))
    best = None
    for y in ys:
        M = M_at(y)
        if M <= 0:
            continue
        ph2 = pp(y)
        sb = -M * zrel / Ixx
        sw = -E * wn * ph2
        tot = sb + sw
        k = max(used, key=lambda i: abs(tot[i]))
        fb, fw, fc = float(sb[k]), float(sw[k]), float(tot[k])
        fbmax = float(-M * (zmax_up if zrel[k] >= 0 else zmax_dn) / Ixx)
        if fc == 0:
            continue
        R_raw = abs(fbmax) / abs(fc)
        at_j = bool(junction is not None and k in junction)
        inc = bool(at_j and edge_stiffened_c)
        R = min(H4_INCREASE * R_raw if inc else R_raw, 1.0)
        demand = (M / Mmax) / R
        if best is None or demand > best['demand_shape'] + 1e-15:
            best = dict(y=float(y), node=int(k), f_bending=fb, f_torsion=fw, f_bending_max=fbmax, f_combined=fc,
                        R_raw=float(R_raw), R=float(R), increased=inc, at_junction=at_j, phi_pp=float(ph2),
                        M_unit=float(M), demand_shape=float(demand), omega_n=float(wn[k]), z_rel=float(zrel[k]))
    if best is None:
        return {'error': 'zero'}
    scale = (Mu / Mmax) if (Mu is not None and Mu > 0) else None
    out = dict(best)
    out.update(a=float(a), GJ=GJ, ECw=float(ECw), J=J, Cw=float(Cw), Cw_engine=Cw_eng, Ixx=Ixx, xs=xs, zs=zs, xcg=xcg, zcg=zcg,
               dx=dx, e=e, L=L, load=load, Mmax_unit=Mmax, junction_known=junction is not None,
               node_xz=(float(nd[best['node'], 1]), float(nd[best['node'], 2])),
               rotation_mid_unit=rot_mid, E=E, G=G)
    if scale is not None:
        # 소요 모멘트 Mu 에 해당하는 하중의 응력 · 경간 중앙 회전(같은 비례)
        for k in ('f_bending', 'f_torsion', 'f_bending_max', 'f_combined'):
            out[k + '_at_Mu'] = best[k] * scale
        out['rotation_mid_at_Mu'] = rot_mid * scale
        out['load_at_Mu'] = scale          # w (kip/in) 또는 P (kip)
    return out
