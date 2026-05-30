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
  Pcrl = LF_local_min × Py
  Mcrl = LF_local_min × My
"""

import numpy as np
from .properties import grosprop
from .stress import yieldMP


def extract_dsm_values(curve: list, node: np.ndarray, elem: np.ndarray,
                        fy: float = 35.53, load_type: str = 'P',
                        mode_shapes: list = None,
                        classify_fn=None,
                        KxLx: float = None, KyLy: float = None,
                        KtLt: float = None, Lb: float = None,
                        Cb: float = 1.0, section_type: str = 'C') -> dict:
    """좌굴 곡선에서 DSM 설계값 추출

    Args:
        curve: list of np.ndarray — curve[i] = [length, lf1, lf2, ...] (1st mode 사용)
        node: (nnodes, 8)
        elem: (nelems, 5)
        fy: 항복 응력
        load_type: 'P' (축력), 'Mxx' (강축 휨), 'Mzz' (약축 휨)
        mode_shapes: (선택) curve 와 정렬된 list — mode_shapes[i] = (ndof, nmodes)
                     좌굴 모드형상. 제공되면 cFSM modal 참여율(%D/%L)로 각 극소를
                     국부/뒤틀림으로 확정한다 (반파장 순서 휴리스틱 대체).
                     하위호환: 미제공(None) 시 개선된 휴리스틱으로 폴백한다.
        classify_fn: (선택) callable(length, mode_vector) -> [%G, %D, %L, %O]
                     (예: cfsm.classify.mode_class 래퍼). mode_shapes 와 함께
                     제공될 때만 사용된다. 미제공 시 휴리스틱 폴백.
        KxLx, KyLy, KtLt: (선택) 압축(load_type='P') 부재의 강축/약축 유효좌굴
                     길이 K·L (in) 및 비틀림 유효길이 Kt·Lt (in). 제공되면 전체
                     좌굴값을 signature-curve 점근값이 아니라 AISI S100-16
                     Eq.E2-4 의 폐형식 Fcre 로 산정한다 (compute_column_Fcre).
        Lb: (선택) 휨(load_type='Mxx'/'Mzz') 부재의 횡방향 비지지길이 (in).
                     제공되면 §F2.1 폐형식 Fcre 로 Mcre 를 산정한다
                     (compute_beam_Fcre).
        Cb: 휨 모멘트 구배계수 (기본 1.0). Lb 와 함께 사용.
        section_type: 단면형식 ('C', 'Z', 'RHS', ... 기본 'C'). 폐형식 전체좌굴
                     분기(점대칭 Z / 폐합 박스 등) 판정에 사용. 길이 미제공 시 무시.

        하위호환: KxLx/KyLy/KtLt/Lb 가 모두 None(미제공)이면 동작은 종전과 정확히
        동일하다 — 전체좌굴값은 signature-curve 장파장 점근값이고
        결과 dict 'global_is_signature_asymptote'=True 로 유지된다. 기존 위치인자
        호출자(예: aisi_s100._auto_generate_props)는 이 인자들을 넘기지 않으므로
        영향받지 않는다.

    Returns:
        dict with DSM design values. 결과 dict 에는 모드 검출 플래그가 추가된다:
          'local_detected' (bool), 'dist_detected' (bool),
          'classification_method' (str: 'cfsm_modal' | 'heuristic' | ...).
        모드가 분리(isolate)되지 않으면 해당 Pcrl/Pcrd 는 0.0 으로 유지된다
        (하위호환). 다운스트림은 *_detected 플래그로 '미검출'을 '비세장(정당한
        무감소)'과 구분할 수 있다.
    """
    # 1) 항복 하중 계산
    props = grosprop(node, elem)
    yield_vals = yieldMP(node, fy,
                         props['A'], props['xcg'], props['zcg'],
                         props['Ixx'], props['Izz'], props['Ixz'],
                         props['thetap'], props['I11'], props['I22'])

    Py = yield_vals['Py']
    My_xx = yield_vals['Mxx_y']
    My_zz = yield_vals['Mzz_y']

    # 기준 하중 선택
    if load_type == 'P':
        P_ref = Py
        label = 'P'
    elif load_type == 'Mxx':
        P_ref = My_xx
        label = 'Mxx'
    else:
        P_ref = My_zz
        label = 'Mzz'

    # 2) 좌굴 곡선에서 1st 모드 추출 → (length, load_factor, curve_index) 배열
    # curve_index 는 mode_shapes 와 정렬을 맞추기 위한 원본 curve 위치.
    points = []
    for ci, c in enumerate(curve):
        if c is None:
            continue
        row = c
        if isinstance(c, np.ndarray):
            row = c.flatten().tolist() if c.ndim > 1 else c.tolist()
        elif isinstance(c, list) and len(c) > 0 and isinstance(c[0], list):
            row = c[0]

        if len(row) >= 2 and row[1] > 0:
            points.append((row[0], row[1], ci))

    if len(points) < 3:
        return _empty_result(Py, My_xx, My_zz, label, P_ref)

    points.sort(key=lambda p: p[0])
    lengths = [p[0] for p in points]
    lf_vals = [p[1] for p in points]
    curve_idx = [p[2] for p in points]

    # 3) 극소점 찾기 (3-point comparison)
    minima = []
    for i in range(1, len(lf_vals) - 1):
        if lf_vals[i] < lf_vals[i - 1] and lf_vals[i] < lf_vals[i + 1]:
            minima.append({
                'length': lengths[i],
                'load_factor': lf_vals[i],
                'index': i,
                'curve_index': curve_idx[i],
            })

    # 3b) 경계 극소 검출 (첫 점이 인접 점보다 작은 경우)
    # 짧은 끝(index 0)만 국부 후보로 삽입한다. 긴 끝(index -1)은 전체좌굴
    # 장파장 꼬리(global tail)로, S-S 곡선이 단조 감소하는 인공물일 뿐
    # 물리적 국부/뒤틀림 극소가 아니다. 이를 minima 에 넣으면 뒤틀림으로
    # 오분류되어 Pcrd 를 오염시키므로 삽입하지 않는다. 장파장 꼬리값은
    # 아래 Pcre/Lcre 로 이미 포착된다.
    # (AISI S100-16 Appendix 2 §2.2: 모드 메커니즘이 적절해야 함 —
    #  격자 경계 인공물을 물리 모드로 취급 금지)
    if len(lf_vals) >= 2:
        if lf_vals[0] < lf_vals[1]:
            minima.insert(0, {'length': lengths[0], 'load_factor': lf_vals[0],
                              'index': 0, 'curve_index': curve_idx[0]})

    # 4) 극소점을 국부/뒤틀림으로 분류
    # 우선순위:
    #   (a) mode_shapes + classify_fn 제공 → cFSM modal 참여율(%D/%L)로 확정
    #       (AISI S100-16 App 2 / E3,E4: 모드 성격으로 Pcrl/Pcrd 식별이 정석)
    #   (b) 미제공 → 개선된 휴리스틱(반파장 순서). 하드코딩 10.0 in 임계 제거.
    Pcrl = Pcrd = Pcre = 0.0
    Lcrl = Lcrd = Lcre = 0.0
    classification = 'auto'
    local_detected = False
    dist_detected = False

    # 전체 좌굴(SIGNATURE-CURVE 점근값 — 주의: AISI 설계용 글로벌 Pcre 아님):
    #   여기서 Pcre 는 단순지지(S-S) signature curve 의 가장 긴 샘플 반파장
    #   에서의 하중비일 뿐, 부재 실제 비지지길이(KxLx/KyLy/KtLt)에서의 탄성
    #   전체좌굴값이 아니다. AISI S100-16 Eq. E2-4 의 Fcre 와 lambda_c
    #   =sqrt(Fy/Fcre) 는 (KL/r)^2, (KtLt)^2 의 함수이므로 부재 길이/유효길이
    #   계수 없이는 구할 수 없다(Appendix 2 §2.3.1.1 Eq.2.3.1.1-3..5).
    #   따라서 설계 경로(design/aisi_s100.py)는 이 값을 사용하지 않고
    #   compute_column_Fcre / compute_beam_Fcre 로 폐형식 Fcre 를 재계산한다.
    #   본 키(cre/Lcre/LF_global)는 signature-curve 점근 정보로만 제공되며,
    #   결과 dict 의 'global_is_signature_asymptote'=True 로 명시한다.
    #   부재 설계용 전체좌굴값이 필요하면 KL 과 K 계수를 별도 폐형식 경로에
    #   공급해야 한다.
    Pcre = lf_vals[-1] * P_ref
    Lcre = lengths[-1]

    # 각 극소에 대해 cFSM modal 라벨을 시도한다.
    # 라벨: 'L' (국부 %L 우세), 'D' (뒤틀림 %D 우세), None (분류 불가/미제공)
    modal_available = mode_shapes is not None and callable(classify_fn)
    if modal_available:
        for mn in minima:
            mn['mode_class'] = _classify_minimum(mn, mode_shapes, classify_fn)

    if modal_available and len(minima) >= 1:
        # (a) cFSM modal 확정: %D/%L 우세도로 라벨링 → 길이 순서에 의존하지 않음
        classification = 'cfsm_modal'
        for mn in minima:
            lbl = mn.get('mode_class')
            val = mn['load_factor'] * P_ref
            if lbl == 'L':
                # 가장 작은(임계) 국부 극소 채택
                if not local_detected or val < Pcrl:
                    Pcrl, Lcrl, local_detected = val, mn['length'], True
            elif lbl == 'D':
                if not dist_detected or val < Pcrd:
                    Pcrd, Lcrd, dist_detected = val, mn['length'], True
        # modal 라벨이 하나도 확정되지 않은 경우(예: 모두 G/O 우세 또는 동률)
        # 휴리스틱으로 폴백한다.
        if not local_detected and not dist_detected:
            modal_available = False

    if not modal_available:
        # (b) 휴리스틱 폴백: 반파장 순서. 임의 인치 임계(구 10.0) 미사용.
        if len(minima) >= 2:
            # 2개 이상: 가장 짧은 파장 극소 = 국부, 그 외(더 긴 파장) 극소 중
            # 임계(최저 하중비) 극소 = 뒤틀림.
            # minima[0]/minima[1] 을 고정 인덱싱하지 않는다: 3개 이상 극소나
            # index 1 의 스퍼리어스/2차 국부 극소가 진짜 뒤틀림 극소(index 2)를
            # 가리지 않도록, 국부 이후 구간 전체에서 최저 하중비를 선택한다.
            # (AISI S100-16 Appendix 2 §2.3.1.3: 뒤틀림 임계 하중)
            minima_sorted = sorted(minima, key=lambda m: m['length'])
            local_min = minima_sorted[0]
            Pcrl = local_min['load_factor'] * P_ref
            Lcrl = local_min['length']
            local_detected = True
            # 국부보다 긴 파장의 극소들 중 최저 하중비를 뒤틀림으로 채택
            longer = [m for m in minima_sorted[1:]]
            dist_min = min(longer, key=lambda m: m['load_factor'])
            Pcrd = dist_min['load_factor'] * P_ref
            Lcrd = dist_min['length']
            dist_detected = True
            classification = 'two_minima'
        elif len(minima) == 1:
            # 단일 극소: 모드형상 없이는 국부/뒤틀림을 신뢰성 있게 구분할 수
            # 없다. 보수적으로 국부로 채택(짧은 파장 가정)하되, 뒤틀림은
            # '미분리(not isolated)'로 두어(Pcrd=0) 다운스트림이 dist_detected
            # =False 로 폴백/경고하도록 한다. (구 하드코딩 L>10 in 재분류 제거)
            Pcrl = minima[0]['load_factor'] * P_ref
            Lcrl = minima[0]['length']
            local_detected = True
            classification = 'single_minimum'
        else:
            # 극소 0개: 단조 감소 곡선 → 곡선 최소값을 국부로
            min_idx = int(np.argmin(lf_vals))
            Pcrl = lf_vals[min_idx] * P_ref
            Lcrl = lengths[min_idx]
            local_detected = True
            classification = 'monotone'

    classification_method = 'cfsm_modal' if classification == 'cfsm_modal' else 'heuristic'

    # ── 전체좌굴(GLOBAL) 폐형식 산정 (선택, 유효길이 제공 시) ─────────────────
    # 기본값: signature-curve 장파장 점근값(Pcre_sig/Lcre_sig)을 전체좌굴값으로
    #         사용 (하위호환). global_is_signature_asymptote=True.
    # 유효길이가 제공되면: AISI S100-16 Eq.E2-4(압축) / §F2.1(휨)의 폐형식 Fcre로
    #         전체좌굴값(Pcre=A·Fcre / Mcre=Sf·Fcre)을 재산정하고, 종전 점근값은
    #         참조용으로 'cre_signature'/'Lcre_signature' 에 보존한다.
    # 지연 import: engine↔design 순환 import 위험 회피.
    Pcre_sig = Pcre          # signature-curve 점근값 (참조 보존)
    Lcre_sig = Lcre
    global_is_signature_asymptote = True
    global_source = 'signature_asymptote'

    if load_type == 'P':
        length_provided = (KxLx is not None) or (KyLy is not None) or (KtLt is not None)
    else:
        length_provided = (Lb is not None)

    if length_provided:
        try:
            from .cutwp import cutwp_prop
            from design.global_buckling import (compute_column_Fcre,
                                                compute_beam_Fcre)

            # 전체 단면성질: grosprop + cutwp 비틀림성질 병합 후 compute_*가 기대하는
            # 키로 매핑 (aisi_s100._auto_generate_props 와 동일 규약).
            gprops = dict(props)
            try:
                cw = cutwp_prop(node, elem)
            except Exception:
                cw = {}
            gprops['J'] = cw.get('J', gprops.get('J', 0))
            gprops['Cw'] = cw.get('Cw', gprops.get('Cw', 0))
            gprops['Xs'] = cw.get('Xs', gprops.get('Xs', 0))
            gprops['Zs'] = cw.get('Zs', gprops.get('Zs', 0))
            # 회전반경/단면계수 키 별칭 매핑
            gprops.setdefault('ry', gprops.get('rz', 0))
            gprops.setdefault('Sf', gprops.get('Sx', 0))
            gprops.setdefault('Iy', gprops.get('Izz', 0))
            # xo = |Xs - xcg| (도심~전단중심 x거리) — compute_*에서 fallback도 있으나 명시.
            if 'xo' not in gprops:
                gprops['xo'] = abs(gprops.get('Xs', 0) - gprops.get('xcg', 0))
            gprops['section_type'] = section_type

            if load_type == 'P':
                # 미지정 유효길이는 제공된 길이로 채워 보수적으로 처리(전부 동일 가정).
                provided = [v for v in (KxLx, KyLy, KtLt) if v is not None]
                fill = max(provided) if provided else 0.0
                _KxLx = KxLx if KxLx is not None else fill
                _KyLy = KyLy if KyLy is not None else fill
                _KtLt = KtLt if KtLt is not None else fill
                col = compute_column_Fcre(gprops, fy, _KxLx, _KyLy, _KtLt)
                Fcre = col.get('Fcre', 0.0)
                A_g = gprops.get('A', 0)
                if Fcre > 0 and A_g > 0:
                    Pcre = A_g * Fcre
                    # 지배 유효길이 = controlling 좌굴모드의 길이
                    btype = col.get('buckling_type', '')
                    if btype == 'torsional':
                        Lcre = _KtLt
                    elif btype == 'flexural-torsional':
                        Lcre = max(_KxLx, _KtLt)
                    else:  # flexural
                        # σex(=KxLx) 와 σey(=KyLy) 중 작은 응력(긴 유효길이)이 지배
                        Lcre = _KyLy if col.get('sigma_ey', 1e30) <= col.get('sigma_ex', 1e30) else _KxLx
                    global_is_signature_asymptote = False
                    global_source = 'closed_form_E2'
            else:
                # 휨: §F2.1 Fcre, Mcre = Sf·Fcre
                Fcre = compute_beam_Fcre(gprops, Cb, Lb, section_type=section_type)
                Sf = gprops.get('Sf', 0) or gprops.get('Sxx', 0) or gprops.get('Sx', 0)
                if Fcre > 0 and Sf > 0:
                    Pcre = Sf * Fcre
                    Lcre = Lb
                    global_is_signature_asymptote = False
                    global_source = 'closed_form_F2'
        except Exception as e:
            # 폐형식 산정 실패 시 signature 점근값으로 폴백 (하위호환 안전).
            Pcre = Pcre_sig
            Lcre = Lcre_sig
            global_is_signature_asymptote = True
            global_source = f'signature_asymptote (closed_form failed: {e})'

    result = {
        # 항복 하중
        'Py': Py,
        'My_xx': My_xx,
        'My_zz': My_zz,

        # 단면 성질
        'A': props['A'],
        'Ixx': props['Ixx'],
        'Izz': props['Izz'],

        # 기준 하중 종류
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

        # 전체 좌굴 — 주의: 아래 값은 signature-curve(S-S) 장파장 점근값이며
        # AISI S100-16 Eq.E2-4 의 설계용 글로벌 Fcre/Pcre 가 아니다.
        # 부재 설계값은 KL/K 계수를 사용하는 폐형식(compute_column/beam_Fcre)
        # 으로 별도 계산해야 한다. 'global_is_signature_asymptote' 플래그로 명시.
        f'{label}cre': Pcre,
        'cre': Pcre,
        'Lcre': Lcre,
        'LF_global': Pcre / P_ref if P_ref > 0 else 0,
        'global_is_signature_asymptote': global_is_signature_asymptote,
        'global_source': global_source,
        # signature-curve(S-S) 장파장 점근값 (참조 보존). 유효길이가 제공되어
        # 위 cre/Lcre 가 폐형식으로 대체된 경우에도 종전 점근값을 여기서 확인 가능.
        'cre_signature': Pcre_sig,
        'Lcre_signature': Lcre_sig,

        # 기준 항복값 (load_type에 무관한 정규화 키)
        'P_y': P_ref,

        # 극소점 목록
        'minima': minima,
        'n_minima': len(minima),
        'classification': classification,

        # 모드 검출 플래그 (Contract #3, 추가 키 — 하위호환)
        # local_detected/dist_detected=False 이면 해당 Pcrl/Pcrd 는 0.0 으로,
        # 다운스트림(aisi_s100.py)이 '미검출(폴백 필요)'을 '비세장(정당한
        # 무감소)'과 구분하도록 한다.
        'local_detected': local_detected,
        'dist_detected': dist_detected,
        'classification_method': classification_method,

    }

    return result


def _classify_minimum(minimum: dict, mode_shapes: list, classify_fn) -> str:
    """단일 극소를 cFSM modal 참여율로 'L'/'D'/None 라벨링.

    minimum['curve_index'] 위치의 mode_shapes 에서 1차(최저) 모드형상 벡터를
    꺼내 classify_fn(length, mode_vector) -> [%G, %D, %L, %O] 를 호출한 뒤,
    %L 우세이면 'L'(국부), %D 우세이면 'D'(뒤틀림), 그 외(G/O 우세 또는
    분류 불가)이면 None 을 반환한다.

    AISI S100-16 App 2 / Comm. E3, E4: Pcrl/Pcrd 는 좌굴 모드 성격(국부 vs
    뒤틀림)으로 식별하는 것이 정석이며, 본 함수는 cFSM modal 참여율을 그
    확정 근거로 사용한다.
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
    if gdlo is None:
        return None
    gdlo = np.asarray(gdlo, dtype=float).ravel()
    if gdlo.size < 4:
        return None
    pct_d = gdlo[1]
    pct_l = gdlo[2]
    # 국부/뒤틀림 중 우세한 쪽으로 라벨. 둘 다 미미하면(G/O 우세) None.
    if pct_l <= 0 and pct_d <= 0:
        return None
    if pct_l >= pct_d:
        return 'L'
    return 'D'


def _empty_result(Py, My_xx, My_zz, label, P_ref):
    return {
        'Py': Py, 'My_xx': My_xx, 'My_zz': My_zz,
        'A': 0, 'Ixx': 0, 'Izz': 0,
        'load_type': label, 'P_ref': P_ref,
        f'{label}crl': 0, 'crl': 0, 'Lcrl': 0, 'LF_local': 0,
        f'{label}crd': 0, 'crd': 0, 'Lcrd': 0, 'LF_dist': 0,
        f'{label}cre': 0, 'cre': 0, 'Lcre': 0, 'LF_global': 0,
        'global_is_signature_asymptote': True,
        'P_y': P_ref,
        'minima': [], 'n_minima': 0,
        # 모드 검출 플래그 (Contract #3, 추가 키 — 하위호환)
        'local_detected': False,
        'dist_detected': False,
        'classification_method': 'none',
    }
