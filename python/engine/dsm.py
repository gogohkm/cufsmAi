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
                        fy: float = 35.53, load_type: str = 'P') -> dict:
    """좌굴 곡선에서 DSM 설계값 추출

    Args:
        curve: list of np.ndarray — curve[i] = [length, lf1, lf2, ...] (1st mode 사용)
        node: (nnodes, 8)
        elem: (nelems, 5)
        fy: 항복 응력
        load_type: 'P' (축력), 'Mxx' (강축 휨), 'Mzz' (약축 휨)

    Returns:
        dict with DSM design values
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

    # 2) 좌굴 곡선에서 1st 모드 추출 → (length, load_factor) 배열
    points = []
    for c in curve:
        if c is None:
            continue
        row = c
        if isinstance(c, np.ndarray):
            row = c.flatten().tolist() if c.ndim > 1 else c.tolist()
        elif isinstance(c, list) and len(c) > 0 and isinstance(c[0], list):
            row = c[0]

        if len(row) >= 2 and row[1] > 0:
            points.append((row[0], row[1]))

    if len(points) < 3:
        return _empty_result(Py, My_xx, My_zz, label, P_ref)

    points.sort(key=lambda p: p[0])
    lengths = [p[0] for p in points]
    lf_vals = [p[1] for p in points]

    # 3) 극소점 찾기 (3-point comparison)
    minima = []
    for i in range(1, len(lf_vals) - 1):
        if lf_vals[i] < lf_vals[i - 1] and lf_vals[i] < lf_vals[i + 1]:
            minima.append({
                'length': lengths[i],
                'load_factor': lf_vals[i],
                'index': i,
            })

    # 3b) 경계 극소 검출 (첫/마지막 점이 인접 점보다 작은 경우)
    if len(lf_vals) >= 2:
        if lf_vals[0] < lf_vals[1]:
            minima.insert(0, {'length': lengths[0], 'load_factor': lf_vals[0], 'index': 0})
        if lf_vals[-1] < lf_vals[-2]:
            minima.append({'length': lengths[-1], 'load_factor': lf_vals[-1], 'index': len(lf_vals)-1})

    # 4) 극소점을 국부/뒤틀림으로 분류 (반파장 휴리스틱)
    # 일반 CFS: 국부 Lcrl < ~20 in (웹/플랜지 폭 수준)
    #           뒤틀림 Lcrd ~10-50 in (플랜지+립 회전)
    # 분류 기준: 가장 짧은 극소 = 국부, 그다음 = 뒤틀림
    # 단일 극소 시: 반파장 > 10 in이면 뒤틀림으로 재분류
    Pcrl = Pcrd = Pcre = 0.0
    Lcrl = Lcrd = Lcre = 0.0
    classification = 'auto'

    # 전체 좌굴: 가장 긴 파장 영역의 값
    Pcre = lf_vals[-1] * P_ref
    Lcre = lengths[-1]

    if len(minima) >= 2:
        # 2개 이상: 짧은 쪽 = 국부, 긴 쪽 = 뒤틀림
        Pcrl = minima[0]['load_factor'] * P_ref
        Lcrl = minima[0]['length']
        Pcrd = minima[1]['load_factor'] * P_ref
        Lcrd = minima[1]['length']
        classification = 'two_minima'
    elif len(minima) == 1:
        L_min = minima[0]['length']
        # 단일 극소: 반파장이 짧으면 국부, 길면 뒤틀림
        if L_min > 10.0:
            # 긴 파장 극소 → 뒤틀림으로 분류, 국부 없음
            Pcrd = minima[0]['load_factor'] * P_ref
            Lcrd = L_min
            classification = 'single_distortional'
        else:
            # 짧은 파장 극소 → 국부
            Pcrl = minima[0]['load_factor'] * P_ref
            Lcrl = L_min
            classification = 'single_local'
    else:
        # 극소 0개: 단조 감소 곡선 → 곡선 최소값을 국부로
        min_idx = int(np.argmin(lf_vals))
        Pcrl = lf_vals[min_idx] * P_ref
        Lcrl = lengths[min_idx]
        classification = 'monotone'

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

    }

    return result


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
    }
