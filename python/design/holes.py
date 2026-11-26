"""구멍이 있는 부재 — AISI S100-16 §E2.5 · §E3.2.2 · §E4.2 · §F2.2 · §F3.2.2 · §F4.2 와 부록 2 의 탄성 좌굴.

기준의 글(이 세션에서 aisi-cold-formed-steel 스킬로 연 원문 전사)
- §E2.5 / §F2.2: "For shapes whose cross-sections have holes, Fcre shall consider the influence of holes in
  accordance with Appendix 2."
- §E3.2.2: Pnℓ by §E3.2.1 "except Pcrℓ shall be determined including the influence of holes and:
  Pnℓ ≤ Pynet (Eq. E3.2.2-1), Pynet = Anet Fy (Eq. E3.2.2-2)", Anet = "Net area of cross-section at the location of a hole".
- §F3.2.2: Mnℓ ≤ Mynet (Eq. F3.2.2-1), Mynet = Sfnet Fy (Eq. F3.2.2-2), Sfnet = "Net section modulus referenced to
  the extreme fiber at first yield".
- §E4.2 / §F4.2: the net-section transition (Eqs. E4.2-1 … -8, F4.2-1 … -6) — design.dsm_strength.
- 부록 2 §2.1: Pcr = Ag Fcr (Eq. 2.1-1), Mcr = Sf Fcr (Eq. 2.1-2) — 총단면 Ag · Sf 로 바꾼다.
- 부록 2 §2.2: "Any numerical elastic buckling solution that includes the relevant mechanics … is permitted".
  해설 §2.2.6 (Moen and Schafer 2009c) 의 유한스트립 근사 — 이 프로그램의 FSM 으로 한다(결정 T2):
  · 국부: Pcrℓ = min(Pcrℓnh, Pcrℓh) (Eq. C-2.2.6-1), Pcrℓh = 순단면 FSM, 구멍 길이보다 짧은 반파장만
    (Lh < Lcrℓh 이면 Lh 에서의 값, Lh ≥ Lcrℓh 이면 극소). 휨도 같다 — Mcrℓ = min(Mcrℓnh, Mcrℓh). 같은 기준 하중으로
    (순단면에 순단면의 응력분포를 주고 하중계수 × 기준 하중) — 부록 2 §2.3.2.2 / §2.3.4.2 의 Anet/Ag · Sfnet/Sf 환산과 같다.
  · 뒤틀림: 총단면 FSM 의 Lcrd 에서, 웹 두께 t 를 tr = t (1 − Lh/Lcrd)^(1/3) (Eq. 2.3.2.3-1 · 2.3.4.3-1 · C-2.2.6-2)
    으로 웹 전체 깊이에서 줄인 단면을 그 한 길이 Lcrd 에서만 다시 푼다.
  · 전체: 해설 "A general approach to including the influence of holes for global buckling in a finite strip analysis
    is not available … the analytical solutions of Specification Sections 2.3.2.1 and 2.3.4.1 … are preferred" —
    표 2.3.2-1 의 길이 가중 평균 성질(Iavg · Javg · xo,avg · ro,avg)과 Cw,net 으로 Eq. 2.3.2.1.1-1 · 2.3.2.1.2-1~-4 ·
    2.3.4.1.1-1 · 2.3.4.1.2-1 (design.global_buckling 의 식에 그 성질을 넣는다).
- 순단면 성질: 해설 §2.3.2.1.2 "all net section properties … can be readily calculated with the built-in section
  property calculator in … CUFSM … by setting the element thicknesses to zero at the holes" — 이 엔진의 cutwp 는
  두께 0 을 받지 않으므로 구멍 띠의 웹 요소를 두께 1e-6 t 로 둔다(연결은 그대로 — 뒤틀림 좌표가 이어진다).
  국부 FSM 은 그 띠 요소를 지운 순단면으로(Manual II-14: "The zero thickness element is then deleted").

입력(design_member · RPC hole_elastic_buckling 공통, 모두 in):
  hole_shape ('circular' | 'noncircular'), hole_depth (dh, 웹을 가로지르는 치수 — 원형은 지름), hole_length
  (Lh, 부재 방향 — 원형은 dh 와 같다, 주지 않으면 dh), hole_spacing (s, 중심 간격), hole_end_distance (끝단에서 가까운
  구멍 가장자리까지의 순거리 — 이 조항들은 쓰지 않는다, §G6 이 쓴다), hole_web_offset (웹 중앙에서 구멍 중심까지,
  모델 z 가 커지는 쪽이 +, 기본 0), hole_edge_stiffened (참이면 평가하지 못함).
"""

import math

import numpy as np

from design.notices import N as _nt

HOLE_KEYS = ('hole_shape', 'hole_depth', 'hole_length', 'hole_spacing', 'hole_end_distance',
             'hole_web_offset', 'hole_edge_stiffened')
HOLE_SHAPES = ('circular', 'noncircular')
# 같은 hole_shape 를 §G3 · §G6 (design.shear._norm_shape) 도 읽는다 — 별칭을 같게 둔다
_SHAPE_ALIASES = {'circular': 'circular', 'circle': 'circular', 'round': 'circular',
                  'noncircular': 'noncircular', 'rectangular': 'noncircular', 'slotted': 'noncircular',
                  'oval': 'noncircular', 'diamond': 'noncircular'}
# 더는 내보내지 않는 옛 범위 알림(등록표에는 남긴다 — 저장된 결과 · 옛 호스트가 그 code 를 그린다):
# 구멍의 압축 · 휨이 구현되기 전의 「구멍 감소 미구현」 두 줄. 구멍을 입력하지 않으면 member.scope.holes_not_entered,
# §G3/§G6 의 남은 범위는 member.scope.not_checked_holes_g3_g6.
RETIRED_NOTICE_CODES = ('member.scope.e2_5_e2_e3_e4_f2', 'member.scope.not_checked_holes')
# 구멍 띠 웹 요소의 두께(순단면 성질용) — CUFSM 의 "thickness zero" 를 cutwp 가 받는 가장 작은 꼴로
ZERO_T_FACTOR = 1e-6
# 이 엔진이 웹 하나를 가려 구멍을 넣는 단면(템플릿의 요소 자리 'web' 가 한 줄)
SUPPORTED_SECTIONS = ('C', 'Z', 'TRACK')
FSM_PROP_DEFAULT = [[100, 29500.0, 29500.0, 0.3, 0.3, 11300.0]]   # 엔진 자동 경로와 같은 재료(§A3.1)


# ---------------------------------------------------------------- 입력

def given(params: dict) -> bool:
    """구멍 입력(hole_* — §G3 · §G6 이 더 읽는 hole_corner_radius · hole_bearing_distance … 포함)이 하나라도 있는가.
    없으면 결과는 지금과 바이트까지 같다(결정 T4)."""
    return any(params.get(k) is not None for k in HOLE_KEYS) or any(
        str(k).startswith('hole_') and v is not None for k, v in params.items())


def _num(params, key, *, positive=True, required=True):
    v = params.get(key)
    if v is None:
        if required:
            raise ValueError(f'{key} is required when a hole is described (in)')
        return None
    if isinstance(v, bool):
        raise ValueError(f'{key} must be a number (in), got {v!r}')
    try:
        v = float(v)
    except (TypeError, ValueError):
        raise ValueError(f'{key} must be a number (in), got {v!r}')
    if not math.isfinite(v) or (positive and v <= 0) or (not positive and v < 0):
        raise ValueError(f'{key} must be {"> 0" if positive else ">= 0"} (in), got {v!r}')
    return v


def parse(params: dict) -> dict:
    """정규화한 구멍 입력. 형식이 틀리면 ValueError(짐작해 채우지 않는다)."""
    shape = params.get('hole_shape')
    if shape is None:
        raise ValueError("hole_shape is required when a hole is described ('circular' or 'noncircular')")
    shape = _SHAPE_ALIASES.get(str(shape).strip().lower().replace('-', '').replace('_', '').replace(' ', ''))
    if shape not in HOLE_SHAPES:
        raise ValueError("hole_shape must be 'circular' or 'noncircular' (aliases: circle, round; rectangular, "
                         f"slotted, oval, diamond), got {params.get('hole_shape')!r}")
    dh = _num(params, 'hole_depth')
    Lh = _num(params, 'hole_length', required=False)
    if shape == 'circular':
        if Lh is None:
            Lh = dh
        elif abs(Lh - dh) > 1e-9 * max(dh, 1.0):
            raise ValueError(f'circular hole: hole_length ({Lh}) must equal hole_depth (the diameter, {dh}) '
                             'or be left out')
    elif Lh is None:
        raise ValueError('hole_length (Lh, along the member) is required for a noncircular hole')
    s = _num(params, 'hole_spacing')
    if s <= Lh:
        raise ValueError(f'hole_spacing (centre-to-centre, {s}) must be larger than hole_length ({Lh}) — '
                         'overlapping holes are not discrete holes')
    end = _num(params, 'hole_end_distance', positive=False, required=False)
    off = params.get('hole_web_offset')
    if off is None:
        off = 0.0
    else:
        try:
            off = float(off)
        except (TypeError, ValueError):
            raise ValueError(f'hole_web_offset must be a number (in), got {off!r}')
        if not math.isfinite(off):
            raise ValueError('hole_web_offset must be finite')
    st = params.get('hole_edge_stiffened')
    if st is not None and not isinstance(st, bool):
        raise ValueError(f'hole_edge_stiffened must be true or false, got {st!r}')
    return {'shape': shape, 'dh': dh, 'Lh': Lh, 's': s, 'end_distance': end, 'web_offset': off,
            'edge_stiffened': bool(st)}


# ---------------------------------------------------------------- 웹 · 순단면 모델

def _web_chain(node, elem, roles):
    """요소 자리 'web' 의 요소가 한 줄로 이어진 곧은 판인가. (order, s_nodes, p0, u, h, t) 또는 (None, 까닭 코드)."""
    if roles is None or len(roles) != len(elem):
        return None, 'roles'
    web = [i for i, r in enumerate(roles) if r == 'web']
    if not web:
        return None, 'roles'
    # 이어진 한 줄인지: 끝점 차수
    deg = {}
    for i in web:
        for n in (int(elem[i, 1]), int(elem[i, 2])):
            deg[n] = deg.get(n, 0) + 1
    ends = [n for n, d in deg.items() if d == 1]
    if len(ends) != 2 or any(d > 2 for d in deg.values()):
        return None, 'chain'
    xy = {n: np.array([node[n - 1, 1], node[n - 1, 2]], dtype=float) for n in deg}
    a, b = ends
    if (xy[a][1], xy[a][0]) > (xy[b][1], xy[b][0]):
        a, b = b, a                     # 아래(z 작은) 끝에서 시작
    p0 = xy[a]
    d = xy[b] - p0
    h = float(np.hypot(*d))
    if h <= 0:
        return None, 'chain'
    u = d / h
    # 곧은가: 모든 절점이 a–b 선 위에
    for n, p in xy.items():
        dv = p - p0
        off = abs(float(u[0] * dv[1] - u[1] * dv[0]))
        if off > 1e-6 * h:
            return None, 'straight'
    ts = {round(float(elem[i, 3]), 12) for i in web}
    if len(ts) != 1:
        return None, 'thickness'
    return {'elems': web, 'p0': p0, 'u': u, 'h': h, 't': float(elem[web[0], 3]),
            's_of': {n: float(np.dot(xy[n] - p0, u)) for n in deg}}, None


def _insert_web_nodes(node, elem, roles, chain, s_cuts):
    """웹 위의 거리 s_cuts 에 절점을 넣는다(이미 있으면 그것). 새 (node, elem, roles, s_of)."""
    node = [list(map(float, r)) for r in node]
    elem = [list(map(float, r)) for r in elem]
    roles = list(roles)
    s_of = dict(chain['s_of'])
    tol = 1e-9 * chain['h']
    for sc in s_cuts:
        if any(abs(sv - sc) <= tol for sv in s_of.values()):
            continue
        for ei, e in enumerate(elem):
            if roles[ei] != 'web':
                continue
            ni, nj = int(e[1]), int(e[2])
            si, sj = s_of[ni], s_of[nj]
            if min(si, sj) + tol < sc < max(si, sj) - tol:
                p = chain['p0'] + chain['u'] * sc
                f = (sc - si) / (sj - si)
                stress = node[ni - 1][7] + f * (node[nj - 1][7] - node[ni - 1][7])
                nk = len(node) + 1
                node.append([nk, float(p[0]), float(p[1]), 1, 1, 1, 1, stress])
                s_of[nk] = sc
                elem[ei] = [e[0], ni, nk, e[3], e[4]]
                elem.insert(ei + 1, [e[0], nk, nj, e[3], e[4]])
                roles.insert(ei + 1, 'web')
                break
    for i, e in enumerate(elem):
        e[0] = i + 1
    return np.array(node), np.array(elem), roles, s_of


def _drop_elements(node, elem, drop):
    """요소를 지우고 남은 요소가 쓰지 않는 절점을 뺀 뒤 번호를 다시 매긴다. (node, elem, old→new)"""
    keep = [i for i in range(len(elem)) if i not in drop]
    used = sorted({int(elem[i, 1]) for i in keep} | {int(elem[i, 2]) for i in keep})
    remap = {old: k + 1 for k, old in enumerate(used)}
    nn = np.array([node[old - 1] for old in used], dtype=float)
    nn[:, 0] = np.arange(1, len(used) + 1)
    ne = np.array([[k + 1, remap[int(elem[i, 1])], remap[int(elem[i, 2])], elem[i, 3], elem[i, 4]]
                   for k, i in enumerate(keep)], dtype=float)
    return nn, ne, remap


def section_properties(node, elem) -> dict:
    """grosprop + cutwp 의 성질(설계 엔진의 자동 경로와 같은 키 — xo = |Xs − xcg|, Sf = Sx)."""
    from engine.properties import grosprop
    from engine.cutwp import cutwp_prop
    p = dict(grosprop(node, elem))
    cw = cutwp_prop(node, elem)
    p['J'] = float(cw['J'])
    p['Cw'] = float(cw['Cw'])
    p['Xs'] = float(cw['Xs'])
    p['Zs'] = float(cw['Zs'])
    p['xo'] = abs(p['Xs'] - p['xcg'])
    p['Sf'] = p['Sx']
    return {k: (v.item() if hasattr(v, 'item') else v) for k, v in p.items()}


def build_models(node, elem, roles, hole: dict) -> dict:
    """구멍 자리의 모델들: 총단면 성질, 순단면 성질(띠 두께 ≈ 0), 국부 FSM 용 순단면(띠를 지움), 웹 요소."""
    node = np.asarray(node, dtype=float)
    elem = np.asarray(elem, dtype=float)
    chain, why = _web_chain(node, elem, roles)
    if chain is None:
        return {'ok': False, 'why': why}
    h, t = chain['h'], chain['t']
    sc = h / 2.0 + hole['web_offset']
    s1, s2 = sc - hole['dh'] / 2.0, sc + hole['dh'] / 2.0
    if not (s1 > 1e-9 * h and s2 < h - 1e-9 * h):
        return {'ok': False, 'why': 'outside', 'h': h, 't': t}
    n2, e2, r2, s_of = _insert_web_nodes(node, elem, roles, chain, (s1, s2))
    tol = 1e-9 * h
    band = [i for i in range(len(e2)) if r2[i] == 'web'
            and s1 - tol <= 0.5 * (s_of[int(e2[i, 1])] + s_of[int(e2[i, 2])]) <= s2 + tol]
    e_thin = e2.copy()
    e_thin[band, 3] = t * ZERO_T_FACTOR
    gross = section_properties(node, elem)
    net = section_properties(n2, e_thin)
    n_fsm, e_fsm, remap = _drop_elements(n2, e2, set(band))
    return {'ok': True, 'h': h, 't': t, 's1': s1, 's2': s2, 'web_elems': chain['elems'],
            'gross': gross, 'net': net, 'node_net': n2, 'elem_net': e_thin, 'band': band,
            'node_fsm': n_fsm, 'elem_fsm': e_fsm, 'remap': remap}


# ---------------------------------------------------------------- 응력 · FSM

def _bending_nodes(node, props, Fy, sign=1):
    """구속 휨(unsymm = 0)의 기준 응력(최대 |σ| = Fy) — aisi_s100._bending_reference_nodes 와 같은 규약.
    (node, M_ref) — M_ref = 그 분포의 모멘트(첫 항복)."""
    from engine.stress import stresgen, yieldMP
    yv = yieldMP(node.copy(), Fy, props['A'], props['xcg'], props['zcg'], props['Ixx'], props['Izz'],
                 props['Ixz'], props['thetap'], props['I11'], props['I22'], unsymm=0)
    M = float(yv.get('Mxx_y', 0.0)) * (1 if sign >= 0 else -1)
    out = stresgen(node.copy(), P=0.0, Mxx=M, Mzz=0.0, M11=0.0, M22=0.0, A=props['A'], xcg=props['xcg'],
                   zcg=props['zcg'], Ixx=props['Ixx'], Izz=props['Izz'], Ixz=props['Ixz'],
                   thetap=props['thetap'], I11=props['I11'], I22=props['I22'], unsymm=0)
    return out, abs(M)


def _first_lf(prop, node, elem, lengths, springs):
    from engine.fsm_solver import stripmain
    from models.data import GBTConfig
    sp = np.asarray(springs, dtype=float) if springs is not None and len(springs) else np.array([])
    res = stripmain(np.asarray(prop, dtype=float), node, elem, np.asarray(lengths, dtype=float), sp,
                    np.array([]), GBTConfig(), 'S-S', [np.array([1.0]) for _ in lengths], neigs=10)
    bad = {d.get('length_index') for d in res.diagnostics if d.get('severity') == 'error'}
    lf = []
    for i, row in enumerate(res.curve):
        r = np.asarray(row, dtype=float).reshape(-1)
        lf.append(float(r[1]) if i not in bad and len(r) > 1 and r[1] > 0 else float('nan'))
    return np.array(lf)


def _gross_dsm(prop, node, elem, Fy, family, springs, section_type):
    """총단면 설계 서명곡선(엔진 자동 경로와 같은 규칙: design_signature_lengths, S-S, m = 1, 분류) — Lcrd 를 위해."""
    from engine.fsm_solver import stripmain
    from engine.dsm import extract_dsm_values
    from engine.helpers import design_signature_lengths
    from cfsm.classify import classify
    from models.data import GBTConfig
    prop = np.asarray(prop, dtype=float)
    if family == 'P':
        nd = node.copy()
        nd[:, 7] = Fy
    else:
        nd, _ = _bending_nodes(node, section_properties(node, elem), Fy)
    lengths = design_signature_lengths(node)['lengths']
    m_all = [np.array([1.0]) for _ in lengths]
    sp = np.asarray(springs, dtype=float) if springs is not None and len(springs) else np.array([])
    res = stripmain(prop, nd, elem, lengths, sp, np.array([]), GBTConfig(), 'S-S', m_all, neigs=10)
    cls = classify(prop, nd, elem, lengths, res.shapes, None, 'S-S', m_all)
    return extract_dsm_values(res.curve, nd, elem, Fy, 'P' if family == 'P' else 'Mxx',
                              mode_classifications=cls, section_type=section_type)


def local_net(models, prop, Fy, family, Lh, springs=None, sign=1) -> dict:
    """순단면 국부좌굴(해설 §2.2.6): 반파장 ≤ Lh 의 1차 하중계수 최소 × 기준 하중."""
    from engine.helpers import hole_local_lengths
    net = models['net']
    nd = models['node_net'].copy()
    if family == 'P':
        nd[:, 7] = Fy
        ref = Fy * net['A']                   # 순단면의 균일 응력 Fy 의 힘
    else:
        nd, ref = _bending_nodes(nd, net, Fy, sign)
    # 띠를 지운 FSM 모델로 응력을 옮긴다(같은 절점 — 번호만 다시)
    fs = models['node_fsm'].copy()
    for old, new in models['remap'].items():
        fs[new - 1, 7] = nd[old - 1, 7]
    grid = hole_local_lengths(fs, Lh)
    sp = _remap_springs(springs, models) if springs is not None and len(springs) else None
    lf = _first_lf(prop, fs, models['elem_fsm'], grid['lengths'], sp)
    ok = np.isfinite(lf)
    if not ok.any():
        return {'ok': False, 'why': 'fsm'}
    i = int(np.nanargmin(lf))
    return {'ok': True, 'value': float(lf[i] * ref), 'LF': float(lf[i]), 'ref': float(ref),
            'L': float(grid['lengths'][i]), 'at_hole_length': i == len(lf) - 1, 'boundary': i == 0,
            'n_lengths': int(len(lf)), 'grid_rule': grid['rule'], 'ref_basis': (
                'P_ref = Fy Anet (uniform Fy on the net section)' if family == 'P' else
                'M_ref = first-yield moment of the net section (restrained bending, max |σ| = Fy)')}


def _remap_springs(springs, models):
    """스프링의 절점 번호를 순단면 FSM 모델로(지운 절점에 걸린 스프링은 뺀다)."""
    out = []
    for row in np.atleast_2d(np.asarray(springs, dtype=float)):
        r = row.copy()
        ni, nj = int(r[1]), int(r[2])
        if ni not in models['remap'] or (nj != 0 and nj not in models['remap']):
            continue
        r[1] = models['remap'][ni]
        r[2] = models['remap'][nj] if nj != 0 else 0
        out.append(r)
    return np.array(out) if out else None


def distortional_reduced(node, elem, web_elems, prop, Fy, family, Lh, Lcrd, springs=None, sign=1) -> dict:
    """웹 두께 tr = t (1 − Lh/Lcrd)^(1/3) (Eq. 2.3.2.3-1 / 2.3.4.3-1 · C-2.2.6-2) 의 단면을 L = Lcrd 한 길이에서 푼다.

    기준 하중은 두께를 줄인 그 단면에 준다(해설 §2.2.6 "loaded with a reference force to account for the reduced area";
    Manual Example II-14 의 Mcrd = 20.5 kip-in 이 이 규약으로 나온다 — 총단면의 응력을 그대로 두면 21.2):
    압축 P_ref = Fy Ar (균일 Fy), 휨 M_ref = 줄인 단면의 첫 항복 모멘트(구속 휨). Pcrd · Mcrd = λ × 기준 하중."""
    t = float(elem[web_elems[0], 3])
    tr = t * (1.0 - Lh / Lcrd) ** (1.0 / 3.0)
    e_r = np.asarray(elem, dtype=float).copy()
    e_r[web_elems, 3] = tr
    pr = section_properties(node, e_r)
    if family == 'P':
        nd = np.asarray(node, dtype=float).copy()
        nd[:, 7] = Fy
        ref = Fy * pr['A']
    else:
        nd, ref = _bending_nodes(np.asarray(node, dtype=float), pr, Fy, sign)
    lf = _first_lf(prop, nd, e_r, [Lcrd], springs)
    if not np.isfinite(lf[0]):
        return {'ok': False, 'why': 'fsm', 't': t, 'tr': tr}
    return {'ok': True, 'value': float(lf[0] * ref), 'LF': float(lf[0]), 'ref': float(ref), 't': t, 'tr': tr,
            'Lcrd': float(Lcrd), 'method': 'fsm', 'A_r': pr['A'],
            'ref_basis': ('P_ref = Fy Ar (uniform Fy on the section with web thickness tr)' if family == 'P' else
                          'M_ref = first-yield moment of the section with web thickness tr (restrained bending)')}


def distortional_analytic(an: dict, Lh: float, *, flexure: bool, kphi=0.0, Lm=None, beta=1.0) -> dict:
    """부록 2 §2.3.2.3 / §2.3.4.3 의 해석식: Eq. 2.3.1.3-4 · -6 (압축) 또는 2.3.3.3-5 · -6 (휨)의 t 를
    tr = t (1 − Lh/Lcrd)^(1/3) 로(Eq. 2.3.2.3-1 / 2.3.4.3-1). Lcrd 는 총단면의 Eq. 2.3.1.3-7 / 2.3.3.3-4,
    L = min(Lcrd, Lm). 플랜지 항(kφfe · k̃φfg)은 그대로. an: 엔진의 총단면 해석식 대체가 쓴 입력(ho · b · d · t · θ)."""
    from design.loads.distortional_params import calc_flange_properties, calc_Lcrd, calc_distortional_stiffness
    t = an['t']
    fp = calc_flange_properties(an['b'], an['d'], t, an['theta'], an.get('sec_type', 'C'))
    Lcrd = calc_Lcrd(an['ho'], t, fp, flexure=flexure)
    if not Lh < Lcrd:
        return {'ok': False, 'why': 'Lh', 'Lcrd': Lcrd, 't': t}
    tr = t * (1.0 - Lh / Lcrd) ** (1.0 / 3.0)
    L = min(Lcrd, Lm) if Lm else Lcrd
    xi = 2 if flexure else 0
    st = calc_distortional_stiffness(an['ho'], tr, fp, L, xi)      # 플랜지 항은 fp(두께 t)로 — 웹 항만 tr
    den = st['k_tilde_phi_fg'] + st['k_tilde_phi_wg']
    F = (beta if flexure else 1.0) * (st['k_phi_fe'] + st['k_phi_we'] + kphi) / den if den > 0 else 0.0
    return {'ok': F > 0, 'F': F, 'Lcrd': Lcrd, 'L': L, 't': t, 'tr': tr, 'stiff': st, 'fp': fp, 'kphi': kphi,
            'method': 'analytic', 'flexure': flexure}


# ---------------------------------------------------------------- 길이 가중 평균 (표 2.3.2-1)

def holes_in_length(L: float, Lh: float, s: float) -> int:
    """비지지 길이 L 안의 구멍 수 — 간격 s 로 고르게 놓인 구멍 가운데 L 에 들 수 있는 가장 많은 수
    n = floor((L − Lh)/s) + 1 (L < Lh 이면 1, 구멍이 L 을 다 덮음). Manual III-4: L = 96, 48 in, s = 24, Lh = 4.5 → 4, 2."""
    if L <= Lh:
        return 1
    return int(math.floor((L - Lh) / s + 1e-12)) + 1


def net_fraction(L: float, hole: dict) -> dict:
    n = holes_in_length(L, hole['Lh'], hole['s'])
    Lnet = min(n * hole['Lh'], L)
    return {'L': L, 'n': n, 'Lnet': Lnet, 'Lg': L - Lnet}


def _avg(g, nt, fr):
    return (g * fr['Lg'] + nt * fr['Lnet']) / fr['L']


def column_average_props(hc: dict, KxLx, KyLy, KtLt) -> dict:
    """표 2.3.2-1 의 가중 평균 성질 → design.global_buckling.compute_column_Fcre 가 읽는 꼴.

    σex = π² E Ix,avg/(Ag (KxLx)²) (Eq. 2.3.2.1.2-2) = π² E/(KxLx/rx)² 로 rx = (Ix,avg/Ag)^0.5,
    σey (Eq. 2.3.2.1.1-1/2.3.2.1.4-3) 같은 꼴, σt = [G Javg + π² E Cw,net/(KtLt)²]/(Ag ro,avg²) (Eq. 2.3.2.1.2-3),
    β = 1 − (xo,avg/ro,avg)² (Eq. 2.3.2.1.2-4). 점대칭(Z, §2.3.2.1.3)의 약축 = I22,avg.
    길이: Ix,avg 는 KxLx, Iy,avg(·I22,avg) 는 KyLy, Javg · xo,avg · Aavg 는 KtLt 의 구멍 수로(Manual III-4)."""
    g, nt, hole = hc['gross'], hc['net'], hc['hole']
    fx, fy, ft = net_fraction(KxLx, hole), net_fraction(KyLy, hole), net_fraction(KtLt, hole)
    Ag = hc['Ag']
    Ix = _avg(g['Ixx'], nt['Ixx'], fx)
    Iy = _avg(g['Izz'], nt['Izz'], fy)
    I22 = _avg(g['I22'], nt['I22'], fy)
    J = _avg(g['J'], nt['J'], ft)
    xo = _avg(g['xo'], nt['xo'], ft)
    A_avg = _avg(g['A'], nt['A'], ft)
    Ix_t = _avg(g['Ixx'], nt['Ixx'], ft)
    Iy_t = _avg(g['Izz'], nt['Izz'], ft)
    ro = math.sqrt(xo ** 2 + (Ix_t + Iy_t) / A_avg)
    props = {'A': Ag, 'rx': math.sqrt(Ix / Ag), 'ry': math.sqrt(Iy / Ag), 'J': J, 'Cw': nt['Cw'], 'xo': xo,
             'ro': ro, 'I22': I22, 'Ixx': Ix, 'Izz': Iy, 'Ixz': nt.get('Ixz', 0.0),
             'section_type': hc['section_type']}
    trace = {'fx': fx, 'fy': fy, 'ft': ft, 'Ix_avg': Ix, 'Iy_avg': Iy, 'I22_avg': I22, 'J_avg': J,
             'xo_avg': xo, 'A_avg': A_avg, 'Ix_avg_t': Ix_t, 'Iy_avg_t': Iy_t, 'ro_avg': ro, 'Cw_net': nt['Cw']}
    return {'props': props, 'trace': trace}


def beam_average_props(hc: dict, Lb) -> dict:
    """§2.3.4.1.1 · 2.3.4.1.2: Fcre = Cb ro,avg Ag/Sf (σey σt)^0.5 (Z 는 /2) — σey 는 Iy,avg, σt 는 Javg · Cw,net ·
    ro,avg. design.global_buckling.compute_beam_Fcre_detail 이 읽는 꼴(ry = (Iy,avg/Ag)^0.5, ro = ro,avg, Sf = 총단면)."""
    g, nt, hole = hc['gross'], hc['net'], hc['hole']
    f = net_fraction(Lb, hole)
    Ag = hc['Ag']
    Iy = _avg(g['Izz'], nt['Izz'], f)
    Ix = _avg(g['Ixx'], nt['Ixx'], f)
    J = _avg(g['J'], nt['J'], f)
    xo = _avg(g['xo'], nt['xo'], f)
    A_avg = _avg(g['A'], nt['A'], f)
    ro = math.sqrt(xo ** 2 + (Ix + Iy) / A_avg)
    props = {'A': Ag, 'Sf': hc['Sf'], 'ry': math.sqrt(Iy / Ag), 'rx': math.sqrt(Ix / Ag), 'J': J,
             'Cw': nt['Cw'], 'xo': xo, 'ro': ro, 'Izz': Iy, 'Ixx': Ix}
    trace = {'f': f, 'Iy_avg': Iy, 'Ix_avg': Ix, 'J_avg': J, 'xo_avg': xo, 'A_avg': A_avg, 'ro_avg': ro,
             'Cw_net': nt['Cw']}
    return {'props': props, 'trace': trace}


# ---------------------------------------------------------------- 한 번의 계산(설계 · RPC 공통)

def _fail(hc, reason, fam=None):
    """평가하지 못함. fam 을 주면 그 하중군(P · M)만, 아니면 모두. hc['evaluated'] = 모든 하중군을 평가했는가."""
    for f in ([fam] if fam else hc.get('families', [])):
        hc.setdefault(f, {})['evaluated'] = False
        hc[f].setdefault('reasons', [])
        if reason not in hc[f]['reasons']:
            hc[f]['reasons'].append(reason)
    if reason not in hc.setdefault('reasons', []):
        hc['reasons'].append(reason)
    hc['evaluated'] = all(hc.get(f, {}).get('evaluated', True) for f in hc.get('families', []))
    return hc


def family_ok(hc, fam) -> bool:
    return bool(hc) and bool((hc.get(fam) or {}).get('evaluated'))


def evaluate(params: dict, families, *, section_type: str, Ag: float, Sf: float | None, Fy: float,
             dsm: dict | None = None, moment_sign: int = 1) -> dict:
    """구멍의 영향을 넣은 탄성 좌굴값과 순단면 성질. families: ('P',) · ('M',) · ('P', 'M').

    돌려주는 값(hc): hole(정규화 입력), evaluated(bool), reasons([알림]), 그리고 평가했으면
    gross · net(모델의 성질), Anet · Sfnet, P/M 마다 {crl_h, crl_h_detail, crd_h, crd_h_detail, Lcrd, Lcrd_source}.
    입력 형식 오류는 ValueError(호출자가 error 로)."""
    hole = parse(params)
    hc = {'hole': hole, 'evaluated': True, 'reasons': [], 'section_type': section_type, 'Ag': float(Ag),
          'Sf': float(Sf) if Sf else None, 'Fy': float(Fy), 'families': list(families)}
    for fam in families:
        hc[fam] = {'evaluated': True, 'reasons': []}
    if section_type not in SUPPORTED_SECTIONS:
        return _fail(hc, _nt('member.reason.holes_section_not_covered', section_type=section_type))
    if hole['edge_stiffened']:
        return _fail(hc, _nt('member.reason.holes_edge_stiffened'))
    node, elem, roles = params.get('node'), params.get('elem'), params.get('element_roles')
    if node is None or elem is None:
        return _fail(hc, _nt('member.reason.holes_model_missing'))
    if roles is None:
        return _fail(hc, _nt('member.reason.holes_web_not_identified'))
    try:
        node = np.asarray(node, dtype=float)
        elem = np.asarray(elem, dtype=float)
        models = build_models(node, elem, list(roles), hole)
    except Exception as e:          # 모델이 성질 계산을 거절(끊어진 모델 등)
        return _fail(hc, _nt('member.reason.holes_fsm_failed', error=str(e)))
    if models['ok'] and abs(hole['web_offset']) > 1e-9 * models['h']:
        # 가운데가 아닌 구멍: 순단면이 x 축 대칭(C · 트랙) · 점대칭(Z)을 잃는다(yo,net ≠ 0) — 이 프로그램의 전체좌굴은
        # 부록 2 §2.3.2.1.2 · 2.3.2.1.3 · 2.3.4.1.1 · 2.3.4.1.2(대칭 단면)뿐이다. §2.3.2.1.4(yo,avg 의 3차식)는 구현하지 않았다.
        return _fail(hc, _nt('member.reason.holes_offset_unsymmetric', offset=hole['web_offset']))
    if not models['ok']:
        if models['why'] == 'outside':
            return _fail(hc, _nt('member.reason.holes_outside_web', dh=hole['dh'], offset=hole['web_offset'],
                                 h=models['h']))
        return _fail(hc, _nt('member.reason.holes_web_not_identified'))
    prop = params.get('prop') or FSM_PROP_DEFAULT
    springs = params.get('springs')
    if springs is not None and len(springs) == 0:
        springs = None
    g, nt = models['gross'], models['net']
    hc.update(gross=g, net=nt, h_web=models['h'], t_web=models['t'], band=(models['s1'], models['s2']),
              Anet=nt['A'], Sfnet=nt['Sf'], A_model=g['A'], Sf_model=g['Sf'])
    if hc['Sf'] is None:
        hc['Sf'] = g['Sf']
    dsm = dsm or {}
    for fam in families:
        out = hc[fam]
        try:
            loc = local_net(models, prop, Fy, fam, hole['Lh'], springs, moment_sign)
        except Exception as e:
            _fail(hc, _nt('member.reason.holes_fsm_failed', error=str(e)), fam)
            continue
        if not loc['ok']:
            _fail(hc, _nt('member.reason.holes_fsm_failed', error='no positive load factor'), fam)
            continue
        if loc['boundary']:
            _fail(hc, _nt('member.reason.holes_net_local_boundary', L=loc['L']), fam)
            continue
        out['crl_h'] = loc['value']
        out['crl_h_detail'] = loc
        # 뒤틀림의 총단면 Lcrd — 받은 dsm 의 값(설계 서명곡선의 뒤틀림 극소 반파장). 없으면 distortional_fsm 이 푼다.
        keys = ('P_Lcrd',) if fam == 'P' else ('M_Lcrd', 'Lcrd')
        Lcrd = next((float(dsm[k]) for k in keys if isinstance(dsm.get(k), (int, float)) and dsm.get(k) > 0), None)
        out['Lcrd'] = Lcrd
        out['Lcrd_source'] = 'dsm input' if Lcrd else None
    return hc


def _spacing_rule(hc, Lcrd, fam):
    """Eq. 2.3.2.3-1 은 뒤틀림 반파장 Lcrd 하나에서 구멍 길이 Lh 하나를 뺀다(낱낱의 구멍). s < Lcrd 면 한 반파장에
    구멍이 둘 이상 — 패턴 구멍(Eq. 2.3.2.3-2 · 2.3.4.3-2)의 경우이고 여기서 구현하지 않았다."""
    if not hc['hole']['Lh'] < Lcrd:
        _fail(hc, _nt('member.reason.holes_lh_not_below_lcrd', Lh=hc['hole']['Lh'], Lcrd=Lcrd), fam)
        return False
    if hc['hole']['s'] < Lcrd:
        _fail(hc, _nt('member.reason.holes_spacing_below_lcrd', s=hc['hole']['s'], Lcrd=Lcrd), fam)
        return False
    return True


def distortional_fsm(hc: dict, fam: str, params: dict, moment_sign: int = 1) -> dict | None:
    """뒤틀림의 구멍 값 — 총단면 값이 FSM(서명곡선 극소)일 때. 평가하지 못하면 hc 를 평가하지 못함으로 두고 None."""
    hole = hc['hole']
    out = hc[fam]
    if out.get('crd_h_detail') is not None:          # 같은 실행의 다른 상태(냉간가공 · Lb = 0 상한)는 같은 값
        return out['crd_h_detail']
    node = np.asarray(params['node'], dtype=float)
    elem = np.asarray(params['elem'], dtype=float)
    prop = params.get('prop') or FSM_PROP_DEFAULT
    springs = params.get('springs')
    springs = springs if springs is not None and len(springs) else None
    Lcrd = out.get('Lcrd')
    if not Lcrd:
        try:
            gd = _gross_dsm(prop, node, elem, hc['Fy'], fam, springs, hc['section_type'])
        except Exception as e:
            _fail(hc, _nt('member.reason.holes_fsm_failed', error=str(e)), fam)
            return None
        if (gd.get('Lcrd') or 0) > 0 and (gd.get('crd') or 0) > 0:
            Lcrd = float(gd['Lcrd'])
            out['Lcrd'], out['Lcrd_source'] = Lcrd, 'engine design signature curve'
    if not Lcrd:
        _fail(hc, _nt('member.reason.holes_no_gross_lcrd'), fam)
        return None
    if not _spacing_rule(hc, Lcrd, fam):
        return None
    try:
        chain, _ = _web_chain(node, elem, list(params['element_roles']))
        d = distortional_reduced(node, elem, chain['elems'], prop, hc['Fy'], fam, hole['Lh'], Lcrd, springs,
                                 moment_sign)
    except Exception as e:
        _fail(hc, _nt('member.reason.holes_fsm_failed', error=str(e)), fam)
        return None
    if not d['ok']:
        _fail(hc, _nt('member.reason.holes_fsm_failed', error='no positive load factor at Lcrd'), fam)
        return None
    out['crd_h'] = d['value']
    out['crd_h_detail'] = d
    return d


def distortional_from_analytic(hc: dict, fam: str, an: dict, *, kphi=0.0, Lm=None) -> dict | None:
    """뒤틀림의 구멍 값 — 총단면 값이 부록 2 해석식(§2.3.1.3 / §2.3.3.3)일 때 그 식에 tr 을 넣는다."""
    flex = fam == 'M'
    if hc[fam].get('crd_h_detail') is not None:
        return hc[fam]['crd_h_detail']
    d = distortional_analytic(an, hc['hole']['Lh'], flexure=flex, kphi=kphi, Lm=Lm)
    if not d.get('Lcrd'):
        _fail(hc, _nt('member.reason.holes_no_gross_lcrd'), fam)
        return None
    hc[fam]['Lcrd'], hc[fam]['Lcrd_source'] = d['Lcrd'], ('Eq. 2.3.3.3-4' if flex else 'Eq. 2.3.1.3-7')
    if not _spacing_rule(hc, d['Lcrd'], fam):
        return None
    if not d['ok']:
        _fail(hc, _nt('member.reason.holes_fsm_failed', error='non-positive Fcrd from Eq. 2.3.1.3-2 with tr'), fam)
        return None
    area = hc['Ag'] if not flex else hc['Sf']
    d['value'] = d['F'] * area
    hc[fam]['crd_h'] = d['value']
    hc[fam]['crd_h_detail'] = d
    return d


def summary(hc: dict) -> dict:
    """결과에 싣는 묶음(holes) — 입력, 평가 여부(하중군마다), 순단면 성질과 구멍의 탄성값 · 순단면 강도.
    숫자 키는 한 층(display_unrounded 가 맨 위로 옮겨진다). 하중군 접미: _P (압축), _M (휨)."""
    h = hc['hole']
    out = {'shape': h['shape'], 'dh': h['dh'], 'Lh': h['Lh'], 's': h['s'], 'end_distance': h['end_distance'],
           'web_offset': h['web_offset'], 'edge_stiffened': h['edge_stiffened'], 'evaluated': bool(hc['evaluated'])}
    for fam, key in (('P', 'compression_evaluated'), ('M', 'flexure_evaluated')):
        if fam in hc.get('families', []):
            out[key] = bool(hc[fam].get('evaluated'))
    if hc.get('reasons'):
        out['reasons'] = list(hc['reasons'])
    raw = {}

    def _put(k, v, nd=6):
        if v is None:
            return
        out[k] = round(float(v), nd)
        raw[k] = float(v)
    if 'net' in hc:
        nt, g = hc['net'], hc['gross']
        for k, v in (('Anet', nt['A']), ('Sfnet', nt['Sf']), ('Ixx_net', nt['Ixx']), ('Izz_net', nt['Izz']),
                     ('J_net', nt['J']), ('Cw_net', nt['Cw']), ('xo_net', nt['xo']),
                     ('A_gross_model', g['A']), ('Sf_gross_model', g['Sf']), ('h_web', hc['h_web'])):
            _put(k, v)
    for fam in ('P', 'M'):
        f = hc.get(fam) or {}
        c = 'P' if fam == 'P' else 'M'
        if f.get('crl_h') is not None:
            _put(f'{c}crl_h', f['crl_h'], 4)
            _put(f'Lcrl_h_{fam}', f['crl_h_detail']['L'], 4)
        if f.get('crd_h') is not None:
            _put(f'{c}crd_h', f['crd_h'], 4)
            _put(f'tr_{fam}', f['crd_h_detail']['tr'])
        if f.get('Lcrd'):
            _put(f'Lcrd_{fam}', f['Lcrd'], 4)
            out[f'Lcrd_{fam}_source'] = f.get('Lcrd_source')
        if f.get('crd_h') is not None:
            out[f'distortional_method_{fam}'] = f['crd_h_detail'].get('method')
    _put('Pynet', hc.get('Pynet'), 4)
    _put('Mynet', hc.get('Mynet'), 4)
    if raw:
        out['display_unrounded'] = raw
    return out


def elastic_buckling(params: dict) -> dict:
    """RPC hole_elastic_buckling — 단면 모델 + 구멍 입력 → 구멍의 영향을 넣은 탄성 좌굴값 · 순단면 성질(설계 엔진이 부재
    검토에서 쓰는 것과 같은 계산). 호스트는 이 값을 보이기만 하면 된다 — 부재 검토(aisi_design)는 같은 모델 · 입력을 받아
    스스로 다시 구한다.

    필수: node, elem, element_roles, Fy, section_type, hole_*(parse 의 규칙). 선택: prop, springs, dsm(총단면 설계 서명곡선의
    P_Lcrd · M_Lcrd — 주지 않으면 같은 규칙으로 푼다), families(['P', 'M'] 의 부분, 기본 둘 다), moment_sign(+1 / −1).
    뒤틀림은 FSM 방법(Lcrd 에서 웹 두께 tr)만 — 총단면 뒤틀림이 부록 2 해석식인 경우의 값은 부재 검토가 낸다."""
    from design.global_buckling import canonical_section_name
    from design.notices import attach
    for k in ('node', 'elem', 'Fy', 'section_type'):
        if params.get(k) is None:
            raise ValueError(f'hole_elastic_buckling: missing required parameter(s): {k}')
    fams = tuple(params.get('families') or ('P', 'M'))
    if any(f not in ('P', 'M') for f in fams):
        raise ValueError("hole_elastic_buckling: families must be a subset of ['P', 'M']")
    st = canonical_section_name(params['section_type'])
    sign = -1 if str(params.get('moment_sign', '+')).strip() in ('-', '-1', 'negative') else 1
    g = section_properties(np.asarray(params['node'], dtype=float), np.asarray(params['elem'], dtype=float))
    hc = evaluate(params, fams, section_type=st, Ag=g['A'], Sf=g['Sf'], Fy=float(params['Fy']),
                  dsm=params.get('dsm') or {}, moment_sign=sign)
    for fam in fams:
        if family_ok(hc, fam) and st in ('C', 'Z'):
            distortional_fsm(hc, fam, params, sign)
    if hc.get('net'):
        hc['Pynet'] = hc['Anet'] * hc['Fy'] if 'P' in fams else None
        hc['Mynet'] = hc['Sfnet'] * hc['Fy'] if 'M' in fams else None
    out = summary(hc)
    out['section_type'] = st
    out['Fy'] = hc['Fy']
    out['method'] = ('Appendix 2 §2.2 numerical (this program\'s FSM) with the Commentary §2.2.6 approximations: '
                     'local = min(gross, net section with half-wavelengths ≤ Lh); distortional = web thickness tr '
                     'at Lcrd; global = Table 2.3.2-1 weighted averages (computed per unbraced length in the member '
                     'check)')
    return attach(out)
