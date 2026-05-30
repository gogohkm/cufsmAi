"""DSM (Direct Strength Method) 설계값 추출

좌굴 곡선에서 국부/뒤틀림/전체 좌굴 임계 하중을 자동 추출한다.

핵심 출력값:
  Py, My          — 항복 하중/모멘트
  Pcrl, Mcrl      — 국부 좌굴 임계값 (첫 번째 극소)
  Pcrd, Mcrd      — 뒤틀림 좌굴 임계값 (두 번째 극소)
  Pcre, Mcre      — 전체 좌굴 임계값 (장파장 영역)

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
                        classify_fn=None) -> dict:
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

    # 3b) 경계 극소 검출 (첫/마지막 점이 인접 점보다 작은 경우)
    if len(lf_vals) >= 2:
        if lf_vals[0] < lf_vals[1]:
            minima.insert(0, {'length': lengths[0], 'load_factor': lf_vals[0],
                              'index': 0, 'curve_index': curve_idx[0]})
        if lf_vals[-1] < lf_vals[-2]:
            minima.append({'length': lengths[-1], 'load_factor': lf_vals[-1],
                           'index': len(lf_vals) - 1, 'curve_index': curve_idx[-1]})

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

    # 전체 좌굴: 가장 긴 파장 영역의 값
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
            # 2개 이상: 짧은 쪽 = 국부, 긴 쪽 = 뒤틀림
            Pcrl = minima[0]['load_factor'] * P_ref
            Lcrl = minima[0]['length']
            local_detected = True
            Pcrd = minima[1]['load_factor'] * P_ref
            Lcrd = minima[1]['length']
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

        # 전체 좌굴
        f'{label}cre': Pcre,
        'cre': Pcre,
        'Lcre': Lcre,
        'LF_global': Pcre / P_ref if P_ref > 0 else 0,

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
        'P_y': P_ref,
        'minima': [], 'n_minima': 0,
        # 모드 검출 플래그 (Contract #3, 추가 키 — 하위호환)
        'local_detected': False,
        'dist_detected': False,
        'classification_method': 'none',
    }
