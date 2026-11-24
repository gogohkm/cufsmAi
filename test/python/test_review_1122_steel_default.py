"""기본 강종 결정(2026-11-22, S-steel-default): SGC400 = KS D 3506 SGC295Y, Fy 295 / Fu 400 MPa.

- KS D 3506 구조용 표(SGC340 · SGC400 · SGC440 · SGC490)를 MPa 로 고정한다. 기대값은 KDS 41 30 30
  표 3.2-2 의 정수 MPa 이고, 환산은 정의값(1 kip = 4.4482216152605 kN, 1 in = 25.4 mm)에서 따로 만든다.
  허용오차 1e-9 MPa — 245 와 295(또는 반올림 ksi 35.53 → 244.97)를 가른다.
- 다른 기준의 강종(SSC400 · ASTM)은 바뀌지 않았다.
- 계산 경로는 빠진 Fy · Fu 를 기본 강종으로 채우지 않는다(랩 접합 · 냉간가공 Fu · DSM fy).
화면 · 호스트와의 대조는 test/webview/panel_host_contract.js(scenarioDefaultSteelAgrees)가 한다.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'python'))

# 정의값에서 따로 만든 ksi → MPa (엔진 상수를 쓰지 않는다)
_KSI_MPA = 4448.2216152605 / 25.4 ** 2
_TOL = 1e-9

_KS_TABLE = {           # KDS 41 30 30 표 3.2-2: 옛 이름 → (Fy, Fu) MPa
    'SGC340': (245, 340),
    'SGC400': (295, 400),
    'SGC440': (335, 440),
    'SGC490': (365, 490),
}


def test_S1_ks_d3506_structural_grades_pinned_in_mpa():
    from design.steel_grades import KSI_TO_MPA, get_grade, list_grades
    assert abs(KSI_TO_MPA - _KSI_MPA) < 1e-12 and abs(KSI_TO_MPA - 6.894757293168361) < 1e-15
    for gid, (fy, fu) in _KS_TABLE.items():
        g = get_grade(gid)
        assert g is not None, gid
        assert abs(g['Fy'] * _KSI_MPA - fy) < _TOL and abs(g['Fu'] * _KSI_MPA - fu) < _TOL, (gid, g['Fy'], g['Fu'])
        assert g['spec'] == 'KS D 3506' and g['elongation_group'] == 'A3.1.1'
    # 화면 · SI 응답이 쓰는 같은 상수로는 정확히 정수 MPa(반올림 꼬리 없음)
    rows = {r['id']: r for r in list_grades()}
    for gid, (fy, fu) in _KS_TABLE.items():
        assert (rows[gid]['Fy_MPa'], rows[gid]['Fu_MPa']) == (float(fy), float(fu)), rows[gid]
        assert rows[gid]['Fy'] * KSI_TO_MPA == fy and rows[gid]['Fu'] * KSI_TO_MPA == fu
    # 옛 값이 남지 않았다(245/400 짝 · 295/440 짝)
    assert abs(get_grade('SGC400')['Fy'] * _KSI_MPA - 245) > 1
    assert abs(get_grade('SGC440')['Fy'] * _KSI_MPA - 295) > 1


def test_S2_default_grade_is_first_entry_sgc400_295_400():
    from design.steel_grades import DEFAULT_GRADE, STEEL_GRADES, list_grades
    assert DEFAULT_GRADE == 'SGC400'
    assert next(iter(STEEL_GRADES)) == DEFAULT_GRADE
    first = list_grades()[0]
    assert first['id'] == DEFAULT_GRADE and (first['Fy_MPa'], first['Fu_MPa']) == (295.0, 400.0)
    assert list_grades(True)[0]['id'] == DEFAULT_GRADE


def test_S3_other_grades_unchanged_and_notes_map_names():
    from design.steel_grades import get_grade, list_grades
    assert (get_grade('SSC400')['Fy'], get_grade('SSC400')['Fu']) == (35.53, 58.02)
    for gid, fy, fu in (('A653-33', 33, 45), ('A653-50', 50, 65), ('A792-50', 50, 65), ('A1003-50', 50, 65)):
        assert (get_grade(gid)['Fy'], get_grade(gid)['Fu']) == (fy, fu), gid
    sgc570 = get_grade('SGC570', include_restricted=True)
    assert (sgc570['Fy'], abs(sgc570['Fu'] - 62.0) < 1e-9, sgc570['Fsy_specified']) == (60.0, True, 81.22)
    note = get_grade('SGC400')['note']
    for pair in ('SGC340 = SGC245Y', 'SGC400 = SGC295Y', 'SGC440 = SGC335Y', 'SGC490 = SGC365Y', 'SGC570 = SGC560Y'):
        assert pair in note, pair
    # 어떤 note 도 SGC400 을 섞인 짝(245/400)으로 적지 않는다
    for r in list_grades(True):
        n = str(r.get('note', ''))
        assert '245/400' not in n and 'different rows' not in n and '서로 다른 행' not in n, r['id']


def test_S4_lap_connection_requires_member_fy_fu():
    from design.lap_connection import design_lap_connection
    base = dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=12, lap_right_in=12, Mu_support=120,
                Vu_support=4.0, fastener_type='bolt', fastener_dia=0.5, n_rows=2)
    assert 'error' not in design_lap_connection(dict(base))
    for k in ('Fy', 'Fu'):
        p = dict(base)
        p.pop(k)
        r = design_lap_connection(p)
        assert 'error' in r and k in r['error'], (k, r)
        r0 = design_lap_connection(dict(base, **{k: 0}))
        assert 'error' in r0, k


def test_S5_cold_work_flexure_requires_fu_and_dsm_requires_fy():
    import inspect

    from design.aisi_s100 import _design_flexure, check_dsm_limits
    from engine.dsm import extract_dsm_values
    props = {'A': 0.5, 'Sf': 1.2, 'Sxx': 1.2, 'Ixx': 4.0, 'rx': 3.0, 'ry': 0.8, 'J': 0.0006, 'Cw': 1.5,
             'xo': -1.2, 'R': 0.1, 't': 0.059}
    r = _design_flexure({'Fy': 50.0, 'use_cold_work': True, 'props': dict(props)})
    assert 'error' in r and 'Fu' in r['error'], r
    assert inspect.signature(extract_dsm_values).parameters['fy'].default is inspect.Parameter.empty
    # Fy 가 없으면 Fy 한계 줄만 없다(강종을 짐작해 검토하지 않는다)
    sect = {'type': 'C', 'depth': 8.0, 'flange_width': 2.5, 'lip_depth': 0.625, 'thickness': 0.059, 'R_corner': 0.1}
    assert not any('Fy' in w for w in check_dsm_limits({'props': {'A': 1.0}, 'section': sect}, 'flexure'))
    assert any('Fy' in w for w in check_dsm_limits({'Fy': 95.0, 'props': {'A': 1.0}, 'section': sect}, 'flexure'))
