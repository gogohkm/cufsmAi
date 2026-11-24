"""DSM (Direct Strength Method) 설계값 추출

좌굴 곡선에서 국부/뒤틀림/전체 좌굴 임계 하중을 자동 추출한다.

핵심 출력값:
  Py, My          — 항복 하중/모멘트
  Pcrl, Mcrl      — 국부 좌굴 임계값 (cFSM modal 또는 휴리스틱으로 식별)
  Pcrd, Mcrd      — 뒤틀림 좌굴 임계값 (cFSM modal 또는 휴리스틱으로 식별)
  Pcre, Mcre      — signature-curve(S-S) 장파장 점근값.
                    주의: AISI S100-16 Eq.E2-4 의 설계용 글로벌 Fcre/Pcre 가
                    아니다(부재 비지지길이/유효길이계수 KL·K 의 함수). 설계용
                    전체좌굴값은 compute_column_Fcre/compute_beam_Fcre 로 별도
                    계산한다. 결과 dict 'global_is_signature_asymptote'=True.

관계식:
  Pcrl = LF_local_min × (σmax/fy) × P_ref
  (σmax = 해석에 넣은 절점 응력의 최대 |σ|, P_ref = 같은 응력분포의 첫 항복 하중)

모드 식별 규칙 (AISI S100-16 App. 2 §2.2, Commentary E3/E4):
  서명곡선의 극소는 "그 모드가 이 곡선에서 분리되었다"는 뜻일 뿐이다. 극소가
  하나뿐이거나 없다고 해서 다른 모드가 "없다"는 것은 아니다. 따라서 이 함수는
  모드의 부재(absence)를 확정하지 않는다 — 'local_absence_verified' 와
  'dist_absence_verified' 는 언제나 False 다.
"""

import math

import numpy as np
from .properties import grosprop
from .stress import stresgen, yieldMP
from design.notices import N as _nt  # noqa: E402


_LOAD_TYPES = ('P', 'Mxx', 'Mzz')
# 절점 응력 형상 비교 허용오차(최대 |σ| 로 정규화한 절점별 차이의 최댓값)
_SHAPE_TOL = 1e-2
# 최대 |σ| 와 fy 의 상대 차이가 이보다 크면 환산 사실을 경고한다
_SCALE_TOL = 1e-3
# 표본 극소와 포물선 보간 극소의 차이가 이보다 크면 격자가 성기다고 경고한다
_GRID_TOL = 0.01
_FLOOR_NOTE = ('lower bound of the critical load of the mode that was not isolated; '
               'use as a floor, never as the value')


def extract_dsm_values(curve: list, node: np.ndarray, elem: np.ndarray,
                        fy: float, load_type: str = 'P',
                        mode_shapes: list = None,
                        classify_fn=None,
                        mode_classifications: list = None,
                        KxLx: float = None, KyLy: float = None,
                        KtLt: float = None, Lb: float = None,
                        Cb: float = 1.0, section_type: str = 'C',
                        BC: str = None, unsymm: int = None) -> dict:
    """좌굴 곡선에서 DSM 설계값 추출

    Args:
        curve: list of np.ndarray — curve[i] = [length, lf1, lf2, ...] (1st mode 사용)
        node: (nnodes, 8) — 8번째 열은 해석에 넣은 절점 응력
        elem: (nelems, 5)
        fy: 항복 응력(ksi, 필수 — 기본 강종으로 채우지 않는다)
        load_type: 'P' (축력), 'Mxx' (강축 휨), 'Mzz' (약축 휨). 그 밖은 ValueError.
        mode_shapes: (선택) curve 와 정렬된 list — mode_shapes[i] = (ndof, nmodes)
                     좌굴 모드형상. classify_fn 과 함께 주면 극소마다 cFSM
                     참여율(%D/%L)로 라벨을 붙인다.
        classify_fn: (선택) callable(length, mode_vector) -> [%G, %D, %L, %O]
        mode_classifications: (선택) curve와 정렬된 cFSM 분류 배열.
                      mode_classifications[i][mode] = [%G, %D, %L, %O].
                      NaN/None 행은 "미분류"로 다룬다(그 극소는 반파장 순서로 정함).
        KxLx, KyLy, KtLt: (선택) 압축 부재 유효좌굴길이 (in). 주면 전체좌굴값을
                     Eq.E2-4 폐형식 Fcre 로 산정한다 (compute_column_Fcre).
        Lb: (선택) 휨 부재 횡방향 비지지길이 (in). §F2.1 폐형식 Fcre 로 Mcre 산정.
        Cb: 휨 모멘트 구배계수 (기본 1.0). Lb 와 함께 사용.
        section_type: 단면형식 ('C', 'Z', 'RHS', ... 기본 'C'). 폐형식 분기용.
        BC: (선택) 곡선을 만든 단부 조건. 'S-S' 가 아니면 서명곡선이 아니므로
                     Pcrl/Pcrd 를 극소에서 뽑지 않는다(경고). None 이면 S-S 로 가정하고
                     그 가정을 결과 'signature_curve'=None 으로 남긴다.
        unsymm: (선택) 휨 응력분포의 가정(0=구속 휨, 1=비구속 휨). None 이면 절점
                     응력의 형상에 맞는 쪽을 고른다. P_ref 는 고른 분포의 첫 항복값이다.

    Returns:
        dict. 지금까지의 키(Py, My_xx, Pcrl/crl, LF_local, Lcrl, ... ,
        local_detected, dist_detected, classification, classification_method)에
        다음이 덧붙는다.
          local_detected / dist_detected: 해당 Pcr 값을 이 곡선에서 정했는가.
              False 는 "이 곡선에서 분리되지 않았다"는 뜻일 뿐이다(Pcr=0).
          local_absence_verified / dist_absence_verified: 언제나 False.
          local_isolated / dist_isolated: 서로 다른 극소로 분리되어 정해졌는가.
          local_basis / dist_basis: 'cfsm_label' | 'wavelength_order' |
              'wavelength_bound'(어느 모드인지 모르는 극소들의 최저 — 하한) |
              'single_minimum_assumed_local' | 'not_isolated'
          single_minimum, LF_single_minimum
          single_minimum_bound / crl_floor / crd_floor: 분리되지 않은 모드 임계값의
              **하한(floor)** — 그 모드의 값이 아니다. 해석식 등으로 구한 값의 아래
              한계로만 쓴다(값으로 쓰면 과소, V2-04).
          boundary_minimum: 국부 값이 격자의 첫 길이에서 정해졌다(실제 최소가 더 짧을 수 있음)
          LF_local_interp / LF_dist_interp: log L 포물선 보간 극소(표본 극소 이하)
          stress_scale, reference_distribution, reference_unsymm,
          reference_stress_consistent, reference_is_restrained, P_ref_restrained:
              P_ref 가 구속 휨 첫 항복(Sf·Fy 와 같은 기준)이 아니면 reference_is_restrained
              =False — 이때 Pcr 을 Sf·Fy 로 만든 My 와 섞지 말 것.
          signature_curve, BC, classification_note
          dsm_applicable: 원형관(section_type 'CHS')이면 False — 극소에 L/D 이름표 없음, crl · crd 0,
              scope_notes 에 「DSM 비적용 — 원형관 조항 사용」
          warnings / assumptions / scope_notes (FIXES §3.1.1)
        classification_method 은 국부·뒤틀림 둘 다 cFSM 라벨로 서로 다른 극소에서
        정해졌을 때만 'cfsm_modal' 이다. 하나라도 라벨이 아니면 'cfsm_partial'
        (라벨이 한쪽에만 쓰임) 또는 'heuristic' 이다.
    """
    if load_type not in _LOAD_TYPES:
        raise ValueError(f"load_type must be one of {_LOAD_TYPES}, got {load_type!r}")
    label = load_type
    # FIXES §3.1.1: warnings = 이 실행에서 값/판정을 바꾼 것·손봐야 할 것,
    # assumptions = 이 실행이 가정한 것, scope_notes = 늘 참인 범위 안내.
    warnings: list[str] = []
    assumptions: list[str] = []
    scope_notes: list[str] = [_nt('dsm.scope.signature_curve_isolation_only')]

    # 1) 항복 하중 계산 (지금까지와 같은 구속 휨 기준값 — 'Py','My_xx','My_zz')
    node = np.asarray(node, dtype=float)
    props = grosprop(node, elem)
    yield_vals = yieldMP(node, fy,
                         props['A'], props['xcg'], props['zcg'],
                         props['Ixx'], props['Izz'], props['Ixz'],
                         props['thetap'], props['I11'], props['I22'])

    Py = yield_vals['Py']
    My_xx = yield_vals['Mxx_y']
    My_zz = yield_vals['Mzz_y']

    # 1b) 기준 응력의 일관성 (App. 2 §2.2: Pcr/Mcr 와 Py/My 는 같은 응력분포 기준)
    ref = _check_reference_stress(node, fy, load_type, props, unsymm)
    warnings.extend(ref['warnings'])
    assumptions.extend(ref['assumptions'])
    P_ref = ref['P_ref']
    scale = ref['stress_scale']

    # 2) 좌굴 곡선에서 1st 모드 추출 → (length, load_factor, curve_index)
    points = []
    for ci, c in enumerate(curve or []):
        if c is None:
            continue
        row = c
        if isinstance(c, np.ndarray):
            row = c.flatten().tolist() if c.ndim > 1 else c.tolist()
        elif isinstance(c, list) and len(c) > 0 and isinstance(c[0], list):
            row = c[0]
        if len(row) >= 2 and row[1] is not None and np.isfinite(row[1]) and row[1] > 0:
            points.append((float(row[0]), float(row[1]), ci))

    points.sort(key=lambda p: p[0])
    lengths = [p[0] for p in points]
    lf_vals = [p[1] for p in points]
    curve_idx = [p[2] for p in points]

    signature_curve = None
    if BC is not None:
        signature_curve = str(BC).strip().upper() == 'S-S'
        if not signature_curve:
            warnings.append(
                _nt('dsm.warning.app_2_bc_pcrl_pcrd', BC=BC))

    # 3) 극소점 찾기 — 평탄 구간(같은 값 연속)도 극소로 본다. 짧은 끝(index 0)은
    # 경계 극소로 넣는다. 긴 끝은 전체좌굴 장파장 꼬리이므로 넣지 않는다.
    minima = _find_minima(lengths, lf_vals, curve_idx) if len(points) >= 3 else []

    # 원형관(CHS): AISI S100-16 은 원형관에 DSM 의 국부 · 뒤틀림 구분을 쓰지 않는다 — 원형관 조항(압축 §E3.1.1.1,
    # 휨 §F2.3 · §F3.1.1)으로 설계하고, 뒤틀림(§E4 · §F4)은 연단 보강 플랜지가 있는 개단면에만 해당한다.
    # 곡선의 극소는 원통의 원주 방향 모드다 — 극소에 L/D 이름표를 붙이지 않고 crl · crd 를 DSM 값으로 내지 않는다.
    from design.global_buckling import canonical_section_name
    round_tube = canonical_section_name(section_type) == 'CHS'

    # 각 극소에 cFSM 라벨 ('L', 'D', None=미분류/G·O 우세/NaN)
    classifications_available = mode_classifications is not None and not round_tube
    shape_classifier_available = mode_shapes is not None and callable(classify_fn) and not round_tube
    modal_available = classifications_available or shape_classifier_available
    for mn in minima:
        if classifications_available:
            mn['mode_class'] = _classify_minimum_from_classifications(mn, mode_classifications)
            if mn['mode_class'] is None and _classification_row_is_nan(mn, mode_classifications):
                mn['label_status'] = 'nan'
        elif shape_classifier_available:
            mn['mode_class'] = _classify_minimum(mn, mode_shapes, classify_fn)
        else:
            mn['mode_class'] = None

    # 4) 모드 배정
    local_min = dist_min = None
    local_basis = dist_basis = 'not_isolated'
    single_minimum = False
    classification = 'no_minimum'
    classification_note = None
    if modal_available and minima and all(m['mode_class'] is None and m.get('label_status') == 'nan'
                                          for m in minima):
        # cFSM 이 이 모델을 분류하지 않았다(F3: 둥근 모서리 등은 NaN) — 예정된 동작이므로 알림이 아니라 기록만.
        classification_note = 'cFSM classification rows are NaN for this model; wavelength order is used.'

    if round_tube:
        classification = 'not_applicable_round_tube'
        local_basis = dist_basis = 'not_applicable'
        scope_notes.append(_nt('dsm.scope.round_tube_not_applicable'))
    elif len(points) < 3:
        classification = 'insufficient_points'
        warnings.append(_nt('dsm.warning.fewer_than_three_points'))
    elif signature_curve is False:
        classification = 'not_signature_curve'
    elif len(minima) == 0:
        classification = 'no_minimum'
        warnings.append(
            _nt('dsm.warning.app_2_pcrl_pcrd_cfsm'))
    elif len(minima) == 1:
        single_minimum = True
        classification = 'single_minimum'
        mn = minima[0]
        # 극소 하나는 한 모드만 분리한다. 그 모드에 값을 주고(라벨 D 면 뒤틀림, 아니면
        # 짧은 반파장 가정으로 국부), 다른 모드는 분리되지 않음(0)으로 둔다. 서명곡선은
        # 순수모드 곡선의 아래 포락선이므로 이 값은 다른 모드 임계값의 하한일 뿐이다 —
        # 다른 모드의 값으로 쓰면 과소(V2: 9CS2.5x059 압축 Pa −34 %)가 된다.
        if mn['mode_class'] == 'D':
            dist_min, dist_basis = mn, 'cfsm_label'
            other = 'Pcrl'
        else:
            local_min = mn
            local_basis = 'cfsm_label' if mn['mode_class'] == 'L' else 'single_minimum_assumed_local'
            other = 'Pcrd'
        assumptions.append(
            _nt('dsm.assumption.app_2_lf_floor', length=mn['length'], text='뒤틀림(cFSM D 라벨)' if other == 'Pcrl' else '국부', other=other, other_2=other, other_3=other, value=mn['load_factor'] * scale))
    else:
        local_min, local_basis, dist_min, dist_basis, notes = _assign_two_or_more(minima)
        for kind, text in notes:
            (warnings if kind == 'warning' else assumptions).append(text)
        if local_basis == 'cfsm_label' and dist_basis == 'cfsm_label':
            classification = 'cfsm_modal'
        elif local_basis == 'cfsm_label' or dist_basis == 'cfsm_label':
            classification = 'cfsm_partial'
        elif modal_available:
            classification = 'cfsm_ordering_tiebreak'
        else:
            classification = 'two_minima'
        if (modal_available and classification_note is None
                and (local_basis != 'cfsm_label' or dist_basis != 'cfsm_label')):
            assumptions.append(
                _nt('dsm.assumption.cfsm_labels_not_separating'))

    boundary_minimum = bool(local_min is not None and local_min['index'] == 0)
    if boundary_minimum:
        warnings.append(
            _nt('dsm.warning.local_minimum_at_first_length', lengths=lengths[0]))

    Pcrl = local_min['load_factor'] * scale * P_ref if local_min else 0.0
    Lcrl = local_min['length'] if local_min else 0.0
    Pcrd = dist_min['load_factor'] * scale * P_ref if dist_min else 0.0
    Lcrd = dist_min['length'] if dist_min else 0.0
    local_detected = local_min is not None
    dist_detected = dist_min is not None
    local_isolated = (local_basis in ('cfsm_label', 'wavelength_order')
                      and not boundary_minimum and not single_minimum)
    dist_isolated = dist_basis in ('cfsm_label', 'wavelength_order') and not single_minimum
    # 분리되지 않은 모드의 하한(floor): 같은 곡선의 극소 값. 값으로 쓰지 않는다.
    lf_lowest = min(m['load_factor'] for m in minima) * scale * P_ref if minima else None
    # 원형관은 국부 · 뒤틀림 값이 없다(분리되지 않은 것이 아니다) — 하한도 내지 않는다.
    crl_floor = lf_lowest if (local_min is None and signature_curve is not False and not round_tube) else None
    crd_floor = lf_lowest if (dist_min is None and signature_curve is not False and not round_tube) else None

    if round_tube:
        classification_method = 'not_applicable'
    elif local_basis == 'cfsm_label' and dist_basis == 'cfsm_label' and not single_minimum:
        classification_method = 'cfsm_modal'
    elif local_basis == 'cfsm_label' or dist_basis == 'cfsm_label':
        classification_method = 'cfsm_partial'
    elif len(points) < 3:
        classification_method = 'none'
    else:
        classification_method = 'heuristic'

    # 표본 극소 대 보간 극소 — 보간 값은 표본 값을 넘지 않는다(_parabolic_min).
    LF_local_interp = (local_min['load_factor_interp'] * scale) if local_min else None
    LF_dist_interp = (dist_min['load_factor_interp'] * scale) if dist_min else None
    for tag, mn in (('국부', local_min), ('뒤틀림', dist_min)):
        if mn is None or mn['index'] == 0:
            continue
        lf_s, lf_i = mn['load_factor'], mn['load_factor_interp']
        if lf_s > 0 and (lf_s - lf_i) / lf_s > _GRID_TOL:
            warnings.append(
                _nt('dsm.warning.coarse_grid_near_minimum', tag=tag, value=lf_s * scale, value_2=lf_i * scale, value_3=100 * (lf_s - lf_i) / lf_s))

    # 전체 좌굴(SIGNATURE-CURVE 점근값 — 주의: AISI 설계용 글로벌 Pcre 아님)
    if points:
        Pcre = lf_vals[-1] * scale * P_ref
        Lcre = lengths[-1]
    else:
        Pcre = Lcre = 0.0

    # ── 전체좌굴(GLOBAL) 폐형식 산정 (선택, 유효길이 제공 시) ─────────────────
    # 지연 import: engine↔design 순환 import 위험 회피.
    Pcre_sig = Pcre          # signature-curve 점근값 (참조 보존)
    Lcre_sig = Lcre
    global_is_signature_asymptote = True
    global_source = 'signature_asymptote'

    if load_type == 'P':
        length_provided = (KxLx is not None) or (KyLy is not None) or (KtLt is not None)
    else:
        length_provided = (Lb is not None)

    if length_provided and len(points) >= 3:
        try:
            from .cutwp import cutwp_prop
            from design.global_buckling import (compute_column_Fcre,
                                                compute_beam_Fcre)

            gprops = dict(props)
            try:
                cw = cutwp_prop(node, elem)
            except Exception:
                cw = {}
            gprops['J'] = cw.get('J', gprops.get('J', 0))
            gprops['Cw'] = cw.get('Cw', gprops.get('Cw', 0))
            gprops['Xs'] = cw.get('Xs', gprops.get('Xs', 0))
            gprops['Zs'] = cw.get('Zs', gprops.get('Zs', 0))
            gprops.setdefault('ry', gprops.get('rz', 0))
            gprops.setdefault('Sf', gprops.get('Sx', 0))
            gprops.setdefault('Iy', gprops.get('Izz', 0))
            if 'xo' not in gprops:
                gprops['xo'] = abs(gprops.get('Xs', 0) - gprops.get('xcg', 0))
            gprops['section_type'] = section_type

            if load_type == 'P':
                provided = [v for v in (KxLx, KyLy, KtLt) if v is not None]
                fill = max(provided) if provided else 0.0
                _KxLx = KxLx if KxLx is not None else fill
                _KyLy = KyLy if KyLy is not None else fill
                _KtLt = KtLt if KtLt is not None else fill
                col = compute_column_Fcre(gprops, fy, _KxLx, _KyLy, _KtLt)
                Fcre = col.get('Fcre', 0.0)
                A_g = gprops.get('A', 0)
                if Fcre <= 0 or A_g <= 0:
                    global_source = ('signature_asymptote (closed_form E2 Fcre<=0 — '
                                     'check J/Cw/rx/ry/ro/xo)')
                if Fcre > 0 and A_g > 0:
                    Pcre = A_g * Fcre
                    btype = col.get('buckling_type', '')
                    if btype == 'torsional':
                        Lcre = _KtLt
                    elif btype == 'flexural-torsional':
                        Lcre = max(_KxLx, _KtLt)
                    else:  # flexural
                        Lcre = _KyLy if col.get('sigma_ey', 1e30) <= col.get('sigma_ex', 1e30) else _KxLx
                    global_is_signature_asymptote = False
                    global_source = 'closed_form_E2'
            else:
                Fcre = compute_beam_Fcre(gprops, Cb, Lb, section_type=section_type)
                Sf = gprops.get('Sf', 0) or gprops.get('Sxx', 0) or gprops.get('Sx', 0)
                if Fcre <= 0 or Sf <= 0:
                    global_source = ('signature_asymptote (closed_form F2 Fcre<=0 — '
                                     'check J/Cw/Sf/ry/ro)')
                if Fcre > 0 and Sf > 0:
                    Pcre = Sf * Fcre
                    Lcre = Lb
                    global_is_signature_asymptote = False
                    global_source = 'closed_form_F2'
        except Exception as e:
            Pcre = Pcre_sig
            Lcre = Lcre_sig
            global_is_signature_asymptote = True
            global_source = f'signature_asymptote (closed_form failed: {e})'

    lf_single = (minima[0]['load_factor'] * scale) if single_minimum else None

    result = {
        # 항복 하중 (구속 휨 기준 — 지금까지와 같은 뜻)
        'Py': Py,
        'My_xx': My_xx,
        'My_zz': My_zz,

        # 단면 성질
        'A': props['A'],
        'Ixx': props['Ixx'],
        'Izz': props['Izz'],

        # 기준 하중 종류 — P_ref 는 해석에 넣은 응력분포의 첫 항복값
        'load_type': label,
        'P_ref': P_ref,

        # 국부 좌굴
        f'{label}crl': Pcrl,
        'crl': Pcrl,
        'Lcrl': Lcrl,
        'LF_local': Pcrl / P_ref if P_ref > 0 else 0,

        # 뒤틀림 좌굴
        f'{label}crd': Pcrd,
        'crd': Pcrd,
        'Lcrd': Lcrd,
        'LF_dist': Pcrd / P_ref if P_ref > 0 else 0,

        # 전체 좌굴 — signature-curve(S-S) 장파장 점근값(또는 유효길이를 주면 폐형식)
        f'{label}cre': Pcre,
        'cre': Pcre,
        'Lcre': Lcre,
        'LF_global': Pcre / P_ref if P_ref > 0 else 0,
        'global_is_signature_asymptote': global_is_signature_asymptote,
        'global_source': global_source,
        'cre_signature': Pcre_sig,
        'Lcre_signature': Lcre_sig,
        # 값 비교의 허용차(계약 §6.1 · §16.14): 서명곡선의 가장 긴 반파장에서 읽은 값은 상대 1e-4, 그 밖은 1e-6
        'numeric_tolerance': {
            'default_rel_tol': 1e-6,
            'fsm_long_wavelength': {
                'rel_tol': 1e-4, 'length': Lcre_sig,
                'keys': (['cre_signature'] + ([f'{label}cre', 'cre', 'LF_global']
                                              if global_is_signature_asymptote else [])) if points else [],
            },
        },

        # 기준 항복값 (load_type에 무관한 정규화 키)
        'P_y': P_ref,

        # 극소점 목록
        'minima': minima,
        'n_minima': len(minima),
        'classification': classification,

        # 모드 검출 플래그 — *_detected=False 는 "이 곡선에서 분리되지 않았다"일 뿐
        'local_detected': local_detected,
        'dist_detected': dist_detected,
        'classification_method': classification_method,
        'local_absence_verified': False,
        'dist_absence_verified': False,
        'local_isolated': bool(local_isolated),
        'dist_isolated': bool(dist_isolated),
        'local_basis': local_basis,
        'dist_basis': dist_basis,
        'single_minimum': single_minimum,
        'LF_single_minimum': lf_single,
        # 분리되지 않은 모드 임계값의 하한(floor) — 그 모드의 값이 아니다.
        'single_minimum_bound': (lf_single * P_ref) if lf_single is not None else None,
        'single_minimum_bound_meaning': _FLOOR_NOTE if lf_single is not None else None,
        f'{label}crl_floor': crl_floor,
        f'{label}crd_floor': crd_floor,
        'crl_floor': crl_floor,
        'crd_floor': crd_floor,
        'boundary_minimum': boundary_minimum,
        'LF_local_interp': LF_local_interp,
        'LF_dist_interp': LF_dist_interp,

        # 기준 응력 일관성
        'stress_scale': scale,
        'max_node_stress': ref['max_stress'],
        'reference_distribution': ref['distribution'],
        'reference_unsymm': ref['unsymm'],
        'reference_stress_consistent': ref['consistent'],
        # P_ref 가 구속 휨(geometric x 축, AISI Sf·Fy 와 같은 기준)의 첫 항복인가.
        # False 이면 Pcr/P_ref 를 Sf·Fy 로 만든 My 와 섞으면 안 된다.
        'reference_is_restrained': ref['unsymm'] == 0 and ref['consistent'] is not False,
        'P_ref_restrained': ref['P_ref_restrained'],
        'classification_note': classification_note,
        # 원형관이면 False — crl · crd 는 0(DSM 값이 아니다), 설계는 원형관 조항으로
        'dsm_applicable': not round_tube,

        # 곡선 종류
        'signature_curve': signature_curve,
        'BC': BC,
        'warnings': warnings,
        'assumptions': assumptions,
        'scope_notes': scope_notes,
    }

    return result


def _check_reference_stress(node: np.ndarray, fy: float, load_type: str,
                            props: dict, unsymm) -> dict:
    """해석에 넣은 절점 응력과 기준 하중(P_ref)의 일관성 확인.

    FSM 하중계수 LF 는 "넣은 응력 × LF" 에서 좌굴한다는 뜻이다. Pcr = LF × P_ref 가
    맞으려면 넣은 응력이 P_ref 를 받는 분포(최대 |σ| = fy)여야 한다. 최대 |σ| 가
    fy 와 다르면 LF 를 σmax/fy 로 환산하고, 형상은 load_type 의 순수 분포와 비교해
    맞는 분포(구속/비구속 휨)의 첫 항복값을 P_ref 로 쓴다.
    """
    key = {'P': 'Py', 'Mxx': 'Mxx_y', 'Mzz': 'Mzz_y'}[load_type]
    out = {'warnings': [], 'assumptions': [], 'stress_scale': 1.0, 'max_stress': None,
           'distribution': 'unverified', 'unsymm': 0, 'consistent': None}
    args = (props['A'], props['xcg'], props['zcg'], props['Ixx'], props['Izz'],
            props['Ixz'], props['thetap'], props['I11'], props['I22'])

    def _p_ref(u):
        return yieldMP(node, fy, *args, unsymm=u)[key]

    stress = node[:, 7] if node.ndim == 2 and node.shape[1] >= 8 else None
    s_max = float(np.max(np.abs(stress))) if stress is not None and stress.size else 0.0
    if not np.isfinite(s_max) or s_max <= 0 or fy <= 0:
        u0 = 0 if unsymm is None else int(unsymm)
        out['P_ref'] = _p_ref(u0)
        out['P_ref_restrained'] = _p_ref(0)
        out['unsymm'] = u0
        out['assumptions'].append(
            _nt('dsm.assumption.pcr_lf_ref_fy'))
        return out

    out['max_stress'] = s_max
    candidates = [0, 1] if unsymm is None else [int(unsymm)]
    if load_type == 'P' or abs(props.get('Ixz', 0.0)) < 1e-9:
        candidates = candidates[:1]
    loads = {'P': (1.0, 0.0, 0.0), 'Mxx': (0.0, 1.0, 0.0), 'Mzz': (0.0, 0.0, 1.0)}[load_type]
    shape = stress / s_max
    matched = None
    best = math.inf
    for u in candidates:
        ref_s = stresgen(node, loads[0], loads[1], loads[2], 0.0, 0.0, *args, unsymm=u)[:, 7]
        r_max = float(np.max(np.abs(ref_s)))
        if r_max <= 0:
            continue
        r = ref_s / r_max
        diff = min(float(np.max(np.abs(shape - r))), float(np.max(np.abs(shape + r))))
        best = min(best, diff)
        if diff <= _SHAPE_TOL:
            matched = u
            break

    scale = s_max / fy
    out['stress_scale'] = scale
    out['P_ref_restrained'] = _p_ref(0)
    if matched is not None:
        out['P_ref'] = _p_ref(matched)
        out['unsymm'] = matched
        out['consistent'] = True
        if load_type == 'P':
            out['distribution'] = 'P'
        else:
            out['distribution'] = f"{load_type}_{'unrestrained' if matched == 1 else 'restrained'}"
        if matched == 1:
            out['warnings'].append(
                _nt('dsm.warning.unsymm_ref_my', load_type=load_type, P_ref=out["P_ref"], value=_p_ref(0)))
    else:
        u0 = 0 if unsymm is None else int(unsymm)
        out['P_ref'] = _p_ref(u0)
        out['unsymm'] = u0
        out['consistent'] = False
        out['distribution'] = 'unmatched'
        out['warnings'].append(
            _nt('dsm.warning.load_type_pcr_ref', load_type=load_type, best=best))
    if abs(scale - 1.0) > _SCALE_TOL:
        out['assumptions'].append(
            _nt('dsm.assumption.fy_max_fy_pcr', s_max=s_max, fy=fy, scale=scale))
    return out


def _plateau_end(lf_vals: list, i: int) -> int:
    j = i
    while j + 1 < len(lf_vals) and lf_vals[j + 1] == lf_vals[i]:
        j += 1
    return j


def _find_minima(lengths: list, lf_vals: list, curve_idx: list) -> list:
    """극소 찾기. 평탄 구간은 첫 점을 극소로, 짧은 끝은 경계 극소로 넣는다."""
    n = len(lf_vals)
    minima = []
    i = 0
    while i < n - 1:
        j = _plateau_end(lf_vals, i)
        rises_after = j + 1 < n and lf_vals[j + 1] > lf_vals[i]
        falls_before = i == 0 or lf_vals[i - 1] > lf_vals[i]
        if rises_after and falls_before:
            if i == 0:
                lf_i, len_i = lf_vals[0], lengths[0]
            else:
                lf_i, len_i = _parabolic_min(lengths, lf_vals, i, j)
            minima.append({
                'length': lengths[i],
                'load_factor': lf_vals[i],
                'index': i,
                'curve_index': curve_idx[i],
                'load_factor_interp': lf_i,
                'length_interp': len_i,
            })
        i = j + 1
    return minima


def _parabolic_min(lengths: list, lf_vals: list, i: int, j: int):
    """log L 에 대한 3점 포물선의 꼭짓점. i-1, i(…j), j+1 을 쓴다.

    가운데 점이 양옆보다 작거나 같으므로 포물선은 아래로 볼록하고 꼭짓점 값은
    가운데 표본값 이하다. 수치 오차에 대비해 min(…, 표본값) 으로 한 번 더 묶는다.
    """
    y1 = lf_vals[i]
    try:
        x0, x1, x2 = (math.log(lengths[i - 1]), math.log(lengths[i]), math.log(lengths[j + 1]))
        if j > i:
            x1 = 0.5 * (math.log(lengths[i]) + math.log(lengths[j]))
        y0, y2 = lf_vals[i - 1], lf_vals[j + 1]
        d0, d2 = x0 - x1, x2 - x1
        a = ((y0 - y1) / d0 - (y2 - y1) / d2) / (d0 - d2)
        b = (y0 - y1) / d0 - a * d0
        if not (a > 0):
            return y1, lengths[i]
        xv = -b / (2 * a)
        xv = min(max(xv, d0), d2)
        yv = y1 + a * xv * xv + b * xv
        if not np.isfinite(yv):
            return y1, lengths[i]
        return min(yv, y1), math.exp(x1 + xv)
    except (ValueError, ZeroDivisionError):
        return y1, lengths[i]


def _assign_two_or_more(minima: list):
    """극소가 둘 이상일 때 국부·뒤틀림 배정 → (local, basis, dist, basis, notes).

    서명곡선은 순수모드 곡선의 아래 포락선이므로, 어느 극소가 어느 모드인지 모를 때는
    그 모드일 수 있는 극소 가운데 가장 낮은 값을 쓰면 보수 측이다. 규칙:

    1. D 라벨이 하나이고 가장 짧은 극소가 아니면 그것이 뒤틀림, 국부는 그보다 짧은
       극소(L 라벨·미분류) 가운데 최저.
    2. 그렇지 않고 L 라벨이 있으면 국부 = L 라벨 극소와 가장 긴 L 보다 짧은 미분류 극소
       가운데 최저, 뒤틀림 = 국부보다 긴 극소 가운데 최저(없으면 분리 안 됨).
    3. 쓸 라벨이 없으면 극소 둘: 짧은 쪽 국부·긴 쪽 뒤틀림. 셋 이상: 국부 = 가장 긴 극소를
       뺀 최저, 뒤틀림 = 가장 짧은 극소를 뺀 최저(둘 다 하한 — 'wavelength_bound').
    D 라벨이 L 라벨보다 짧으면(반파장 순서와 어긋남) 라벨을 버린다.
    """
    notes = []

    def lf(m):
        return m['load_factor']

    by_len = sorted(minima, key=lambda m: m['length'])
    shortest, longest = by_len[0], by_len[-1]
    Ls = [m for m in by_len if m['mode_class'] == 'L']
    Ds = [m for m in by_len if m['mode_class'] == 'D']
    if Ls and Ds and Ds[0]['length'] < Ls[-1]['length']:
        Ls, Ds = [], []
        notes.append(('assumption', _nt('dsm.assumption.cfsm_labels_against_wavelength_order')))

    if len(Ds) == 1 and Ds[0] is not shortest:
        dist = Ds[0]
        pool = [m for m in by_len if m['length'] < dist['length']]
        local = min(pool, key=lf)
        basis = 'cfsm_label' if local['mode_class'] == 'L' else 'wavelength_order'
        if local['mode_class'] != 'L' and any(m['mode_class'] == 'L' for m in pool):
            notes.append(('warning', _nt('dsm.warning.unlabeled_below_l_label_used_as_local', length=local['length'])))
        elif local is not pool[0] and basis != 'cfsm_label':
            notes.append(('warning', _nt('dsm.warning.lower_minimum_not_shortest_used_as_local',
                                         length=local['length'])))
        return local, basis, dist, 'cfsm_label', notes

    if Ls:
        pool = Ls + [m for m in by_len if m['mode_class'] is None and m['length'] < Ls[-1]['length']]
        local = min(pool, key=lf)
        if local['mode_class'] == 'L' and len(Ls) == 1:
            basis = 'cfsm_label'
        else:
            basis = 'wavelength_bound'
            notes.append(('warning', _nt('dsm.warning.local_lowest_of_l_and_unlabeled', length=local['length'])))
        longer = [m for m in by_len if m['length'] > local['length']]
        if not longer:
            return local, basis, None, 'not_isolated', notes
        return local, basis, min(longer, key=lf), 'wavelength_order', notes

    if len(by_len) == 2:
        return shortest, 'wavelength_order', longest, 'wavelength_order', notes
    local = min(by_len[:-1], key=lf)
    dist = min(by_len[1:], key=lf)
    notes.append(('warning', _nt('dsm.warning.three_or_more_minima_wavelength_bound', n=len(by_len))))
    return local, 'wavelength_bound', dist, 'wavelength_bound', notes


def _classification_row_is_nan(minimum: dict, mode_classifications: list) -> bool:
    ci = minimum.get('curve_index')
    if ci is None or ci < 0 or ci >= len(mode_classifications):
        return False
    row = mode_classifications[ci]
    if row is None:
        return True
    try:
        arr = np.asarray(row, dtype=float)
    except (ValueError, TypeError):
        return False
    gdlo = arr if arr.ndim == 1 else (arr[0] if arr.size else arr)
    return bool(gdlo.size == 0 or np.all(~np.isfinite(gdlo)))


def _gdlo_label(gdlo) -> str:
    """Return L/D only when that family is the dominant cFSM contribution."""
    if gdlo is None:
        return None
    try:
        values = np.asarray(gdlo, dtype=float).ravel()
    except (ValueError, TypeError):
        return None
    if values.size < 4 or not np.all(np.isfinite(values[:4])):
        return None
    pct_g, pct_d, pct_l, pct_o = values[:4]
    ld_max = max(pct_d, pct_l)
    if ld_max <= 0 or ld_max < max(pct_g, pct_o):
        return None
    return 'L' if pct_l >= pct_d else 'D'


def _classify_minimum_from_classifications(minimum: dict,
                                            mode_classifications: list) -> str:
    """Read the first-mode GDLO percentages aligned with a curve minimum."""
    ci = minimum.get('curve_index')
    if ci is None or ci < 0 or ci >= len(mode_classifications):
        return None
    class_mat = mode_classifications[ci]
    if class_mat is None:
        return None
    try:
        arr = np.asarray(class_mat, dtype=float)
    except (ValueError, TypeError):
        return None
    if arr.size == 0:
        return None
    gdlo = arr if arr.ndim == 1 else arr[0]
    return _gdlo_label(gdlo)


def _classify_minimum(minimum: dict, mode_shapes: list, classify_fn) -> str:
    """단일 극소를 cFSM modal 참여율로 'L'/'D'/None 라벨링.

    minimum['curve_index'] 위치의 mode_shapes 에서 1차(최저) 모드형상 벡터를
    꺼내 classify_fn(length, mode_vector) -> [%G, %D, %L, %O] 를 호출한 뒤,
    %L 우세이면 'L'(국부), %D 우세이면 'D'(뒤틀림), 그 외(G/O 우세 또는
    분류 불가)이면 None 을 반환한다.
    """
    ci = minimum.get('curve_index')
    if ci is None or ci < 0 or ci >= len(mode_shapes):
        return None
    shape_mat = mode_shapes[ci]
    if shape_mat is None:
        return None
    try:
        arr = np.asarray(shape_mat, dtype=float)
    except (ValueError, TypeError):
        return None
    if arr.size == 0:
        return None
    # 1차 모드 = 첫 열 (curve 의 최저 하중비에 대응; fsm_solver 가 오름차순 정렬)
    if arr.ndim == 1:
        mode_vec = arr
    else:
        mode_vec = arr[:, 0]
    try:
        gdlo = classify_fn(minimum['length'], mode_vec)
    except Exception:
        return None
    return _gdlo_label(gdlo)
