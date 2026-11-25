"""CUFSM 헬퍼 함수 모음

원본: Ref_Source/helpers/ 및 Ref_Source/analysis/ 내 유틸리티
      doubler.m, add_corner.m, master_slave.m, signature_ss.m,
      firstyield.m, energy_recovery.m, stress_to_action.m, msort.m
"""

import math

import numpy as np
from design.notices import N as _nt  # noqa: E402


def doubler(node: np.ndarray, elem: np.ndarray) -> tuple:
    """메시 세분화 — 각 요소의 중간점에 절점 삽입하여 요소 수 2배

    Args:
        node: (nnodes, 8), elem: (nelems, 5) — MATLAB 1-based

    Returns:
        (node_out, elem_out)
    """
    nnodes = node.shape[0]
    nelems = elem.shape[0]

    new_nodes = []
    new_elems = []

    # 기존 절점 복사
    for i in range(nnodes):
        new_nodes.append(node[i].copy())

    # 각 요소마다 중간점 생성
    mid_node_id = nnodes + 1  # 1-based
    for e in range(nelems):
        ni = int(elem[e, 1])
        nj = int(elem[e, 2])
        t = elem[e, 3]
        mat = elem[e, 4]

        # 중간점 좌표/응력 평균
        xi = node[ni - 1, 1]
        zi = node[ni - 1, 2]
        xj = node[nj - 1, 1]
        zj = node[nj - 1, 2]
        si = node[ni - 1, 7]
        sj = node[nj - 1, 7]

        xm = (xi + xj) / 2.0
        zm = (zi + zj) / 2.0
        sm = (si + sj) / 2.0

        new_nodes.append([mid_node_id, xm, zm, 1, 1, 1, 1, sm])

        # 2개 하위 요소
        new_elems.append([len(new_elems) + 1, ni, mid_node_id, t, mat])
        new_elems.append([len(new_elems) + 1, mid_node_id, nj, t, mat])

        mid_node_id += 1

    node_out = np.array(new_nodes)
    elem_out = np.array(new_elems)
    # elem 번호 재정렬
    elem_out[:, 0] = np.arange(1, elem_out.shape[0] + 1)

    return node_out, elem_out


def add_corner(node: np.ndarray, elem: np.ndarray,
               e1_idx: int, e2_idx: int, r: float, n_arc: int = 4) -> tuple:
    """코너에 필릿(호) 추가

    Args:
        node, elem: 모델 데이터 (1-based)
        e1_idx, e2_idx: 공유 절점을 가진 두 요소 번호 (1-based)
        r: 필릿 반경
        n_arc: 호 분할 수

    Returns:
        (node_out, elem_out)
    """
    node = node.copy()
    elem = elem.copy()

    # 공유 절점 찾기
    e1 = elem[e1_idx - 1]
    e2 = elem[e2_idx - 1]
    ni1, nj1 = int(e1[1]), int(e1[2])
    ni2, nj2 = int(e2[1]), int(e2[2])

    shared = set([ni1, nj1]) & set([ni2, nj2])
    if not shared:
        return node, elem
    k = shared.pop()  # 공유 절점 (1-based)

    # 먼 절점
    far1 = nj1 if ni1 == k else ni1
    far2 = nj2 if ni2 == k else ni2

    xk, zk = node[k - 1, 1], node[k - 1, 2]
    x1, z1 = node[far1 - 1, 1], node[far1 - 1, 2]
    x2, z2 = node[far2 - 1, 1], node[far2 - 1, 2]

    a1 = math.atan2(xk - x1, zk - z1)  # e1 방향 (k→far1 반대)
    a2 = math.atan2(x2 - xk, z2 - zk)  # e2 방향

    # 두 방향 사이 각도
    d_ang = a2 - a1
    while d_ang > math.pi:
        d_ang -= 2 * math.pi
    while d_ang < -math.pi:
        d_ang += 2 * math.pi

    theta = abs(d_ang)
    if theta < 0.01:
        return node, elem  # 거의 직선

    # 접선 길이
    d = r * math.tan(theta / 2)

    # 접점 A (e1 쪽), B (e2 쪽)
    dir1x = x1 - xk
    dir1z = z1 - zk
    len1 = math.sqrt(dir1x**2 + dir1z**2)
    dir2x = x2 - xk
    dir2z = z2 - zk
    len2 = math.sqrt(dir2x**2 + dir2z**2)

    if d > len1 * 0.9 or d > len2 * 0.9:
        return node, elem  # 반경 너무 큼

    ax = xk + d * dir1x / len1
    az = zk + d * dir1z / len1
    bx = xk + d * dir2x / len2
    bz = zk + d * dir2z / len2

    # 호 중심
    # 각 이등분선 방향
    bisect_x = (dir1x / len1 + dir2x / len2) / 2
    bisect_z = (dir1z / len1 + dir2z / len2) / 2
    bisect_len = math.sqrt(bisect_x**2 + bisect_z**2)
    if bisect_len < 1e-12:
        return node, elem

    R = r / math.cos(theta / 2)
    cx = xk + R * bisect_x / bisect_len
    cz = zk + R * bisect_z / bisect_len

    # 호 절점 생성
    start_ang = math.atan2(az - cz, ax - cx)
    end_ang = math.atan2(bz - cz, bx - cx)
    # 짧은 호 선택
    arc_span = end_ang - start_ang
    while arc_span > math.pi:
        arc_span -= 2 * math.pi
    while arc_span < -math.pi:
        arc_span += 2 * math.pi

    t = e1[3]  # 두께
    mat = e1[4]

    new_nodes = list(node)
    new_elems = list(elem)
    arc_node_ids = []

    for i in range(n_arc + 1):
        frac = i / n_arc
        ang = start_ang + arc_span * frac
        nx = cx + r * math.cos(ang)
        nz = cz + r * math.sin(ang)
        stress = node[k - 1, 7]

        nid = len(new_nodes) + 1
        new_nodes.append(np.array([nid, nx, nz, 1, 1, 1, 1, stress]))
        arc_node_ids.append(nid)

    # e1의 끝을 접점 A (첫 번째 호 절점)으로 변경
    for i in range(len(new_elems)):
        if int(new_elems[i][1]) == k:
            new_elems[i] = new_elems[i].copy()
            new_elems[i][1] = arc_node_ids[0]
        if int(new_elems[i][2]) == k:
            new_elems[i] = new_elems[i].copy()
            new_elems[i][2] = arc_node_ids[0]

    # e2의 시작을 접점 B (마지막 호 절점)으로 변경
    for i in range(len(new_elems)):
        if int(new_elems[i][0]) == e2_idx:
            if int(new_elems[i][1]) == k:
                new_elems[i] = new_elems[i].copy()
                new_elems[i][1] = arc_node_ids[-1]
            if int(new_elems[i][2]) == k:
                new_elems[i] = new_elems[i].copy()
                new_elems[i][2] = arc_node_ids[-1]

    # 호 요소 추가
    for i in range(n_arc):
        eid = len(new_elems) + 1
        new_elems.append(np.array([eid, arc_node_ids[i], arc_node_ids[i + 1], t, mat]))

    node_out = np.array(new_nodes)
    elem_out = np.array(new_elems)
    elem_out[:, 0] = np.arange(1, elem_out.shape[0] + 1)

    return node_out, elem_out


def master_slave(master: int, slave_nodes: list,
                 node: np.ndarray) -> np.ndarray:
    """Master-slave 구속 방정식 생성

    slave 절점의 변위를 master 절점의 변위+회전으로 구속

    Args:
        master: master 절점 번호 (1-based)
        slave_nodes: slave 절점 번호 리스트 (1-based)
        node: (nnodes, 8)

    Returns:
        constraints: (5*n_slaves, 5) [node_e, dof_e, coeff, node_k, dof_k]
    """
    xm = node[master - 1, 1]
    zm = node[master - 1, 2]

    rows = []
    for sn in slave_nodes:
        xs = node[sn - 1, 1]
        zs = node[sn - 1, 2]

        dx = xs - xm
        dz = zs - zm
        r = math.sqrt(dx**2 + dz**2)
        theta = math.atan2(dz, dx) if r > 0 else 0

        uq = -r * math.sin(theta)  # = -(zs - zm)
        wq = r * math.cos(theta)   # = (xs - xm)

        # CUFSM DOF 코드: 1 = x(u), 2 = z(w), 3 = y(v), 4 = θ (stripmain.m:14).
        # master_slave.m:21-25 처럼 u, w, θ 만 묶고 v(종방향)는 묶지 않는다.
        # 두 항 구속식(u_s = uq·θ_m + u_m)은 같은 dof_e 의 두 행으로 쓴다
        # (constr_user 가 같은 소거 DOF 의 행을 누적한다).
        rows.append([sn, 1, 1.0, master, 1])   # u_s ← u_m
        rows.append([sn, 1, uq, master, 4])    # u_s ← uq·θ_m
        rows.append([sn, 2, 1.0, master, 2])   # w_s ← w_m
        rows.append([sn, 2, wq, master, 4])    # w_s ← wq·θ_m
        rows.append([sn, 4, 1.0, master, 4])   # θ_s ← θ_m

    return np.array(rows) if rows else np.array([]).reshape(0, 5)


def signature_ss(prop: np.ndarray, node: np.ndarray,
                 elem: np.ndarray, neigs: int = 10, GBTcon=None) -> dict:
    """시그니처 곡선 계산 (S-S 경계조건)

    원본: Ref_Source/helpers/signature_ss.m — 길이는 최소 요소폭 … 1000 × 최대
    요소폭의 로그 간격 100 개, 길이마다 m = [1].

    Args:
        prop, node, elem: 모델 데이터
        neigs: 고유치 수
        GBTcon: cFSM 모드 구속 (기본: 없음)

    Returns:
        dict: {'curve': list, 'shapes': list, 'lengths': np.ndarray,
               'diagnostics': list}
    """
    from .properties import elemprop
    from .fsm_solver import stripmain
    from models.data import GBTConfig

    ep = elemprop(node, elem)
    widths = ep[:, 1]
    min_w = np.min(widths)
    max_w = np.max(widths)

    lengths = np.logspace(np.log10(min_w), np.log10(1000 * max_w), 100)
    m_all = [np.array([1.0]) for _ in lengths]

    result = stripmain(prop, node, elem, lengths, np.array([]), np.array([]),
                       GBTcon if GBTcon is not None else GBTConfig(),
                       'S-S', m_all, neigs)

    return {
        'curve': result.curve,
        'shapes': result.shapes,
        'lengths': lengths,
        'diagnostics': result.diagnostics,
    }


# 설계용 서명곡선의 반파장 격자(결정 R8, 2026-11-25) — 엔진이 정하는 하나의 규칙. 모델의 보기용 격자와 따로다.
# 측정(작업 E-5): 날카로운 · 둥근 모서리 립 C(3.625 · 8 · 9 in)와 립 Z(8 in), P · Mxx 의 국부 · 뒤틀림 극소가
# 같은 범위 1200점 기준값과 0.11 % 안에서 같다(옛 1 – 1000 in 60점은 0.49 % 까지, 12점 10 – 200 in 은 64 % 까지).
DESIGN_SIGNATURE_PER_DECADE = 30
DESIGN_SIGNATURE_RANGE = (0.05, 100.0)    # × D (단면 중심선의 가장 큰 폭)


def design_signature_lengths(node, elem=None) -> dict:
    """설계용 DSM 값(Pcrl · Pcrd · Mcrl · Mcrd 의 극소)을 뽑을 S-S 서명곡선의 반파장 (in).

    D = 절점 좌표(중심선)의 x · z 범위 가운데 큰 것. 길이는 0.05 D … 100 D 의 로그 간격, 10 배마다 30 점
    (그래서 점 수는 단면과 상관없이 같다). 모델의 보기용 길이 · 단부 조건과 상관없다.

    Returns: {'lengths': ndarray, 'D': float, 'per_decade', 'range_factor', 'rule'}
    """
    nd = np.asarray(node, dtype=float)
    if nd.ndim != 2 or nd.shape[0] < 2 or nd.shape[1] < 3:
        raise ValueError('design_signature_lengths: node must be an (n, 8) array with at least two nodes')
    D = float(max(np.ptp(nd[:, 1]), np.ptp(nd[:, 2])))
    if not (D > 0 and np.isfinite(D)):
        raise ValueError('design_signature_lengths: the section has no extent (all nodes coincide)')
    lo, hi = DESIGN_SIGNATURE_RANGE
    n = int(np.ceil(DESIGN_SIGNATURE_PER_DECADE * np.log10(hi / lo))) + 1
    lengths = np.logspace(np.log10(lo * D), np.log10(hi * D), n)
    return {
        'lengths': lengths, 'D': D, 'per_decade': DESIGN_SIGNATURE_PER_DECADE, 'range_factor': [lo, hi],
        'rule': (f'design signature curve (S-S, m = 1): {n} log-spaced half-wavelengths from {lo:g} D to {hi:g} D, '
                 f'{DESIGN_SIGNATURE_PER_DECADE} per decade, D = largest centreline extent of the section '
                 f'({D:.4g} in) — independent of the model lengths'),
    }


def _first_load_factors(sig: dict) -> np.ndarray:
    """서명 곡선의 길이별 1차 하중계수. 실패한 길이는 NaN (극소로 잡히지 않게)."""
    failed = {d.get('length_index') for d in sig.get('diagnostics', [])
              if d.get('severity') == 'error'}
    out = np.full(len(sig['lengths']), np.nan)
    for i, row in enumerate(sig['curve']):
        r = np.asarray(row, dtype=float).reshape(-1)
        if i not in failed and len(r) > 1 and r[1] > 0:
            out[i] = r[1]
    return out


def _curve_minima(lengths: np.ndarray, lf: np.ndarray) -> list:
    """m_recommend.m 의 극소 판정: load2 < load1 and load2 <= load3."""
    wl = []
    for xx in range(len(lf) - 2):
        load1, load2, load3 = lf[xx], lf[xx + 1], lf[xx + 2]
        if load2 < load1 and load2 <= load3:
            wl.append(float(lengths[xx + 1]))
    return wl


_LCR_CACHE = {}
_LCR_CACHE_MAX = 16


def characteristic_half_wavelengths(prop: np.ndarray, node: np.ndarray,
                                    elem: np.ndarray) -> dict:
    """국부 · 뒤틀림 좌굴의 특성 반파장 Lcrl, Lcrd (m_recommend.m 의 앞부분)

    S-S 서명 곡선의 극소가 꼭 두 개면 작은 쪽이 Lcrl, 큰 쪽이 Lcrd. 아니면
    MATLAB 처럼 cFSM 국부 전용 · 뒤틀림 전용 서명 곡선의 첫 극소를 쓴다.

    MATLAB 과 다른 점
      - m_recommend.m 의 cFSM 분기는 두 루프가 극소 카운터 cr 를 같이 써서 국부
        극소가 있으면 wl_dist(1) 이 0 이 된다(Lcrd = 0 → 무한대 항). 여기서는 각
        곡선의 첫 극소를 그대로 쓴다.
      - 고전 cFSM 이 성립하지 않는 모델(cfsm.node_utils.check_cfsm_model: 둥근
        모서리 · 닫힌 · 가지 단면 등)에서는 cFSM 분기를 쓰지 않는다. G/D/L 공간이
        물리적 모드가 아니어서 반파장이 엉뚱해진다(둥근 립 C 의 Lcrd 5.3 vs 27).
      - 두 극소로 정하지 못한 경우(cFSM 분기 · 대체)에는 서명 곡선의 모든 극소를
        'extra_lengths' 로 더해 그 근처 항도 넣는다. 항을 더하는 쪽은 고유치를
        낮추거나 그대로 둘 뿐이므로 MATLAB 결과보다 비안전측이 될 수 없다.
      - 극소가 하나도 없으면(예리한 앵글 · 티 압축: 곡선이 단조 감소 — 가장 긴
        반파장의 모드가 가장 낮다) 오류 대신 Lcrl = Lcrd = None, 항 1..7 (m_recommend
        의 ceil(a/Lcr) <= 4 묶음)과 경고를 낸다.

    같은 (prop, node, elem) 에 대한 결과는 작은 캐시에 둔다(서버와 stripmain
    진단이 같은 모델로 두 번 부르는 경우).

    Returns:
        dict: {'Lcrl', 'Lcrd', 'method': 'signature' | 'cfsm' | 'signature_fallback'
               | 'no_minimum', 'minima': list, 'extra_lengths': list,
               'cfsm_check': None | 코드, 'warnings': list}
    """
    import copy

    prop = np.asarray(prop, dtype=float)
    node = np.asarray(node, dtype=float)
    elem = np.asarray(elem, dtype=float)
    key = tuple((a.shape, a.tobytes()) for a in (prop, node, elem))
    hit = _LCR_CACHE.get(key)
    if hit is not None:
        return copy.deepcopy(hit)
    out = _characteristic_half_wavelengths(prop, node, elem)
    if len(_LCR_CACHE) >= _LCR_CACHE_MAX:
        _LCR_CACHE.pop(next(iter(_LCR_CACHE)))
    _LCR_CACHE[key] = copy.deepcopy(out)
    return out


def _characteristic_half_wavelengths(prop, node, elem) -> dict:
    sig = signature_ss(prop, node, elem, neigs=1)
    lengths = sig['lengths']
    wl = _curve_minima(lengths, _first_load_factors(sig))
    warnings = []
    if len(wl) == 2:
        return {'Lcrl': wl[0], 'Lcrd': wl[1], 'method': 'signature',
                'minima': wl, 'extra_lengths': [], 'cfsm_check': None,
                'warnings': warnings}

    try:
        from cfsm.node_utils import check_cfsm_model
        chk = check_cfsm_model(node, elem)
    except Exception as exc:
        chk = {'supported': False, 'code': 'CHECK_FAILED',
               'message': _nt('fsm_solver.warning.exception', exc_type=type(exc).__name__, exc=exc)}

    Lcrl = Lcrd = None
    if chk.get('supported'):
        try:
            from cfsm.node_utils import base_properties
            from models.data import GBTConfig

            nnodes = node.shape[0]
            bp = base_properties(node, elem)
            ndm, nlm = int(bp[7]), int(bp[8])
            ngm = 4
            nom = 2 * (nnodes - 1)
            if nlm > 0:
                gl = GBTConfig(glob=np.zeros(ngm), dist=np.zeros(ndm),
                               local=np.ones(nlm), other=np.zeros(nom),
                               ospace=1, couple=1, orth=1, norm=0)
                s_l = signature_ss(prop, node, elem, neigs=1, GBTcon=gl)
                wl_l = _curve_minima(lengths, _first_load_factors(s_l))
                if wl_l:
                    Lcrl = wl_l[0]
            if ndm > 0:
                gd = GBTConfig(glob=np.zeros(ngm), dist=np.ones(ndm),
                               local=np.zeros(nlm), other=np.zeros(nom),
                               ospace=1, couple=1, orth=1, norm=0)
                s_d = signature_ss(prop, node, elem, neigs=1, GBTcon=gd)
                wl_d = _curve_minima(lengths, _first_load_factors(s_d))
                if wl_d:
                    Lcrd = wl_d[0]
        except Exception as exc:
            warnings.append(_nt('fsm.warning.cfsm_signature_curves_failed', exc_type=type(exc).__name__, exc=exc))
    else:
        warnings.append(
            _nt('fsm.warning.classical_cfsm_does_apply', code=chk.get("code")))

    if Lcrl is not None and Lcrd is not None:
        return {'Lcrl': float(Lcrl), 'Lcrd': float(Lcrd), 'method': 'cfsm',
                'minima': wl, 'extra_lengths': list(wl), 'cfsm_check': None,
                'warnings': warnings}

    found = [n for n, v in (('Lcrl', Lcrl), ('Lcrd', Lcrd)) if v is not None]
    if Lcrl is None and wl:
        Lcrl = wl[0]
    if Lcrd is None and wl:
        Lcrd = wl[-1]
    if Lcrl is None and Lcrd is None:
        warnings.append(
            _nt('fsm.warning.no_interior_minimum_on'))
        return {'Lcrl': None, 'Lcrd': None, 'method': 'no_minimum', 'minima': wl,
                'extra_lengths': [], 'cfsm_check': chk.get('code'),
                'warnings': warnings}
    if Lcrl is None:
        Lcrl = Lcrd
    if Lcrd is None:
        Lcrd = Lcrl
    warnings.append(
        _nt('fsm.warning.taken_from_plain_signature', text=_nt('fsm.fragment.from_cfsm_curves', found=' and '.join(found)) if found else '', value=[round(x, 4) for x in wl], Lcrl=Lcrl, Lcrd=Lcrd))
    return {'Lcrl': float(Lcrl), 'Lcrd': float(Lcrd), 'method': 'signature_fallback',
            'minima': wl, 'extra_lengths': list(wl), 'cfsm_check': chk.get('code'),
            'warnings': warnings}


# 권장 항에 언제나 넣는 전체좌굴용 낮은 항 (MATLAB 은 1, 2, 3 — recommended_terms 참고)
GLOBAL_TERMS = tuple(range(1, 8))
M_RECOMMEND_RULE = (
    'terms ceil(a/Lcr)-3..+3 (or 1..7 when ceil(a/Lcr) <= 4) for Lcrl, Lcrd and any '
    'extra signature minima, plus global terms 1..7 (CUFSM m_recommend.m uses 1..3)')


def recommended_terms(a: float, Lcrl, Lcrd, extra=()) -> np.ndarray:
    """길이 a 에 권장하는 종방향 항 (m_recommend.m:89-107)

    ceil(a/Lcr) > 4 이면 ceil(a/Lcr)-3 … +3, 아니면 1..7 을 Lcrl · Lcrd 각각에
    대해 모으고 전체좌굴용 낮은 항 GLOBAL_TERMS(1..7)를 더해 정렬한다. Lcr 가
    None 이면(극소 없음) 1..7. extra 의 반파장마다 같은 묶음을 더한다.

    MATLAB 과 다른 점 (둘 다 항을 더하기만 하므로 MATLAB 보다 비안전측이 될 수 없다)
      - m_recommend.m:101 의 마지막 항 ceil(a/Lcrl)+3 은 ceil(a/Lcrd)+3 의 오타로
        보고 Lcrd 를 쓴다. MATLAB 쪽 항은 국부 묶음에 이미 들어 있어 빠질 뿐이다.
      - 의도한 변경: MATLAB 은 낮은 항으로 1, 2, 3 만 넣는다(m_recommend.m:105).
        S-S 가 아닌 BC 의 전체좌굴은 낮은 항에 천천히 수렴하므로 1..7 을 늘 넣는다.
        정사각관 4×4×0.1, L=400 의 오일러 닫힌 해 대비: S-C 1.127 → 1.063,
        C-C 1.034 → 1.017, C-G 1.026 → 1.012, C-F 1.007 → 1.006. 비용은 대략
        항 수의 세제곱(립 C 14 → 18 항이면 약 2 배).
      - 그래도 긴 길이의 전체좌굴 값은 급수 절단 때문에 수 % 높게(비안전측) 남는다.
        S-S 가 아닌 곡선의 긴 길이 값을 Pcre · Mcre 로 쓰지 않는다 — 설계 경로는
        전체좌굴을 닫힌 해(AISI S100 E2 · F2)에서 구한다.
    """
    terms = []
    for Lcr in (Lcrl, Lcrd, *extra):
        c = None if Lcr is None else math.ceil(a / Lcr)
        if c is not None and c > 4:
            terms.extend(range(c - 3, c + 4))
        else:
            terms.extend(range(1, 8))
    terms.extend(GLOBAL_TERMS)
    return np.unique(np.array(terms, dtype=float))


def terms_from_half_wavelengths(a: float, lcr: dict) -> np.ndarray:
    """characteristic_half_wavelengths 결과로 길이 a 의 권장 항."""
    return recommended_terms(a, lcr['Lcrl'], lcr['Lcrd'], lcr.get('extra_lengths', ()))


def m_recommend_details(prop: np.ndarray, node: np.ndarray, elem: np.ndarray,
                        lengths) -> dict:
    """m_recommend 와 같지만 Lcrl · Lcrd · 판정 방법 · 경고를 함께 돌려준다.

    결과 dict 를 그대로 stripmain(..., half_wavelengths=결과) 에 넘기면
    항 부족 진단이 서명 곡선을 다시 풀지 않는다.

    Returns:
        dict: {'m_all': list[np.ndarray], 'Lcrl', 'Lcrd', 'method', 'minima',
               'extra_lengths', 'cfsm_check', 'warnings', 'global_terms', 'rule'}
    """
    lcr = characteristic_half_wavelengths(prop, node, elem)
    lengths = np.atleast_1d(np.asarray(lengths, dtype=float))
    m_all = msort([terms_from_half_wavelengths(a, lcr) for a in lengths])
    return {'m_all': m_all, **lcr, 'global_terms': list(GLOBAL_TERMS),
            'rule': M_RECOMMEND_RULE}


def m_recommend(prop: np.ndarray, node: np.ndarray, elem: np.ndarray,
                lengths) -> list:
    """권장 종방향 항 (원본: Ref_Source/helpers/m_recommend.m, Z. Li 2010)

    S-S 서명 곡선(node 의 응력 분포 그대로)에서 국부 · 뒤틀림 특성 반파장을
    찾아 길이마다 권장 m 항을 만든다. S-S 가 아닌 경계조건의 해석에 쓴다.
    전체좌굴용 낮은 항은 MATLAB 의 1..3 대신 1..7 이다(recommended_terms 참고).
    이 항으로도 S-S 가 아닌 곡선의 긴 길이 값에는 수 % 의 급수 절단 오차가 높은
    쪽으로 남으므로 Pcre · Mcre 로 쓰지 않는다(설계 경로는 닫힌 해를 쓴다).

    Args:
        prop, node, elem: 모델 (node[:,7] 의 응력 분포를 쓴다)
        lengths: 물리 부재 길이 배열

    Returns:
        m_all: list[np.ndarray] — 길이마다 정렬된 양의 정수 항
    """
    return m_recommend_details(prop, node, elem, lengths)['m_all']


def firstyield(node: np.ndarray, elem: np.ndarray, fy: float,
               unsymm: int = 0) -> dict:
    """초기 항복 하중 (yieldMP 래퍼)

    MATLAB firstyield.m(PMM 공간의 βy)과 이름만 같고 기능은 yieldMP 다.
    unsymm=0 은 Ixz 를 0 으로 두는 yieldMP 기본값이다. Z형강처럼 Ixz ≠ 0 인
    단면의 Mxx_y · Mzz_y 는 unsymm=1 로 구해야 휨 응력장(stresgen unsymm=1)과 맞는다.

    Returns:
        dict: {'Py', 'Mxx_y', 'Mzz_y', 'M11_y', 'M22_y'}
    """
    from .properties import grosprop
    from .stress import yieldMP

    props = grosprop(node, elem)
    return yieldMP(node, fy,
                   props['A'], props['xcg'], props['zcg'],
                   props['Ixx'], props['Izz'], props['Ixz'],
                   props['thetap'], props['I11'], props['I22'],
                   unsymm=unsymm)


def energy_recovery(prop: np.ndarray, node: np.ndarray, elem: np.ndarray,
                    mode: np.ndarray, L: float,
                    m_a: np.ndarray = None, BC: str = 'S-S') -> np.ndarray:
    """요소별 변형 에너지 계산

    Args:
        prop, node, elem: 모델
        mode: 전체 DOF 변위 벡터
        L: half-wavelength
        m_a: 종방향 항 배열 (기본값: [1.0])
        BC: 경계조건 문자열 (기본값: 'S-S')

    Returns:
        (nelems, 2) [membrane_energy, bending_energy]
    """
    from .element import klocal
    from .properties import elemprop

    nnodes = node.shape[0]
    nelems = elem.shape[0]
    ep = elemprop(node, elem)
    skip = 2 * nnodes

    se = np.zeros((nelems, 2))
    if m_a is None:
        m_a = np.array([1.0])
    m_a = np.asarray(m_a, dtype=float).reshape(-1)
    totalm = len(m_a)
    expected_dofs = 4 * nnodes * totalm
    mode = np.asarray(mode, dtype=float).reshape(-1)
    if totalm == 0:
        raise ValueError('energy_recovery requires at least one longitudinal term in m_a')
    if len(mode) != expected_dofs:
        raise ValueError(
            f'energy_recovery mode length {len(mode)} does not match '
            f'4*nnodes*len(m_a)={expected_dofs}'
        )

    for e in range(nelems):
        ni = int(elem[e, 1]) - 1
        nj = int(elem[e, 2]) - 1
        t = elem[e, 3]
        matnum = int(elem[e, 4])

        mat_idx = np.where(prop[:, 0] == matnum)[0]
        if len(mat_idx) == 0:
            raise ValueError(
                f'Element {int(elem[e, 0])} references undefined material {matnum}'
            )
        mat_idx = mat_idx[0]
        Ex, Ey = prop[mat_idx, 1], prop[mat_idx, 2]
        vx, vy = prop[mat_idx, 3], prop[mat_idx, 4]
        G = prop[mat_idx, 5]

        b = ep[e, 1]
        alpha = ep[e, 2]

        # 전체 벡터에서 모든 종방향 항의 요소 DOF를 추출한다.
        d_global = np.zeros(8 * totalm)
        global_term_dofs = 4 * nnodes
        for m_idx in range(totalm):
            gb = m_idx * global_term_dofs
            lb = m_idx * 8
            d_global[lb + 0] = mode[gb + 2 * ni]              # u1
            d_global[lb + 1] = mode[gb + 2 * ni + 1]          # v1
            d_global[lb + 2] = mode[gb + 2 * nj]              # u2
            d_global[lb + 3] = mode[gb + 2 * nj + 1]          # v2
            d_global[lb + 4] = mode[gb + skip + 2 * ni]       # w1
            d_global[lb + 5] = mode[gb + skip + 2 * ni + 1]   # theta1
            d_global[lb + 6] = mode[gb + skip + 2 * nj]       # w2
            d_global[lb + 7] = mode[gb + skip + 2 * nj + 1]   # theta2

        # 로컬 변환 (d_local = gamma.T @ d_global)
        c = math.cos(alpha)
        s = math.sin(alpha)
        d_local = d_global.copy()
        for m_idx in range(totalm):
            r = 8 * m_idx
            d_local[r + 0] = c * d_global[r + 0] + s * d_global[r + 4]
            d_local[r + 4] = -s * d_global[r + 0] + c * d_global[r + 4]
            d_local[r + 2] = c * d_global[r + 2] + s * d_global[r + 6]
            d_local[r + 6] = -s * d_global[r + 2] + c * d_global[r + 6]

        # 로컬 강성
        k = klocal(Ex, Ey, vx, vy, G, t, L, b, BC, m_a)

        # 모든 m-p 결합항을 포함한 멤브레인/휨 에너지
        mem_idx = np.array([8 * m + i for m in range(totalm) for i in range(4)])
        bend_idx = np.array([8 * m + i for m in range(totalm) for i in range(4, 8)])
        dm = d_local[mem_idx]
        df = d_local[bend_idx]
        se[e, 0] = 0.5 * dm @ k[np.ix_(mem_idx, mem_idx)] @ dm
        se[e, 1] = 0.5 * df @ k[np.ix_(bend_idx, bend_idx)] @ df

    return se


def stress_to_action(node: np.ndarray, xcg: float, zcg: float,
                     thetap: float, A: float, I11: float, I22: float,
                     w: np.ndarray = None, Cw: float = 0.0) -> dict:
    """절점 응력으로부터 하중 성분 (P, M11, M22, B) 역산

    sigma = P/A + M11*y/I11 - M22*x/I22 + B*w/Cw

    Returns:
        dict: {'P', 'M11', 'M22', 'B', 'error'}
    """
    nnodes = node.shape[0]
    stresses = node[:, 7]

    # 주축 좌표 변환
    th = math.radians(thetap)
    c = math.cos(th)
    s = math.sin(th)
    x_rel = node[:, 1] - xcg
    z_rel = node[:, 2] - zcg
    x_princ = c * x_rel + s * z_rel
    y_princ = -s * x_rel + c * z_rel

    # G 행렬 구성
    n_cols = 3
    G = np.zeros((nnodes, n_cols))
    G[:, 0] = 1.0 / A if A != 0 else 0
    G[:, 1] = y_princ / I11 if I11 != 0 else 0
    G[:, 2] = -x_princ / I22 if I22 != 0 else 0

    if w is not None and Cw > 0:
        n_cols = 4
        G = np.column_stack([G, w / Cw])

    # 최소자승 풀이
    f, residuals, _, _ = np.linalg.lstsq(G, stresses, rcond=None)
    err = np.linalg.norm(G @ f - stresses)

    result = {'P': f[0], 'M11': f[1], 'M22': f[2], 'error': err}
    if n_cols == 4:
        result['B'] = f[3]
    else:
        result['B'] = 0.0

    return result


def msort(m_all: list) -> list:
    """종방향 항 정렬/정리

    중복 제거, 0 제거, 오름차순 정렬.
    P2 가드: None/빈 입력은 빈 리스트로, NaN/inf 항은 제거한다
    (하류 조립에서 비정상 항이 행렬을 오염시키는 것을 방지).
    """
    if m_all is None:
        return []
    cleaned = []
    for m in m_all:
        arr = np.array(m, dtype=float)
        arr = arr[arr != 0]          # 0 제거
        arr = arr[np.isfinite(arr)]  # NaN/inf 제거
        arr = np.unique(arr)         # 중복 제거 + 정렬
        cleaned.append(arr)
    return cleaned
