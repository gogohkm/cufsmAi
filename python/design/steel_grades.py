"""냉간성형강 강재 등급 데이터베이스

KS D 3506, KS D 3530, AISI S100-16 Chapter A3 참조
내부 저장 단위: ksi (US)

기본 표(STEEL_GRADES)에는 §A3.1.1 처럼 제한 없이 쓸 수 있는 강종만 둔다.
연신율 3 % 미만(§A3.1.3) 강종은 다중 웨브(데크·지붕·벽 패널) 전용이고 설계값이
감소하므로 LOW_DUCTILITY_GRADES 에 따로 두며, 그 'Fy'/'Fu' 는 감소한 설계값이다.
"""

# 공통 물성 (모든 강재) — AISI S100-16 §A3.1
E = 29500.0   # ksi — 탄성계수 (203,395 MPa)
G = 11300.0   # ksi — 전단탄성계수 (77,900 MPa) — AISI S100-16 §A3.1 published constant (rounded, not E/(2*(1+nu))=11346)
nu = 0.30     # 포아송비

# ksi → MPa. MCP siUnits.US_TO_SI.stress · 웹뷰 UNIT.stress 와 같은 정의식(1 kip = 4.4482216152605 kN,
# 1 in = 25.4 mm) — 같은 부동소수가 나온다. MPa 로 정해진 강종은 MPa / KSI_TO_MPA 를 반올림하지 않고
# 저장한다: 화면 · SI 응답에서 × KSI_TO_MPA 하면 295 · 400 이 정확히 돌아온다.
KSI_TO_MPA = 4.4482216152605 * 1000 / (25.4 * 25.4)   # 6.894757293168361

# 기본 강종(사내 결정 2026-11-22): SGC400, Fy 295 / Fu 400 MPa. 화면 재료 칸의 처음 값 ·
# 호스트 초기 기준응력 · 이 표의 첫 항목이 이것이다. 계산 경로는 빠진 Fy 를 이것으로 채우지 않는다.
DEFAULT_GRADE = 'SGC400'

# KS D 3506 구조용(KDS 41 30 30 표 3.2-2): 옛 명칭 → 현행 명칭. Fy · Fu 는 현행 표의 한 행이다.
# 값의 출처(2026-11-25 다시 확인): 현행 이름의 Fy/Fu 는 KDS 41 30 30:2022 표 3.2-2, 옛 이름(JIS G 3302 와 같은
# 이름)의 항복점/인장강도 하한은 JIS G 3302 표(일본제철 카탈로그 U023en 'Mechanical Properties (JIS Standards)'
# 의 인용) — 두 표의 값이 짝마다 같다. KS D 3506 옛 판의 원문은 보지 못했다.
_KS_NAME_NOTE = ('KS D 3506 structural grades, former name = current name with the same minimum Fy/Fu: '
                 'SGC340 = SGC245Y (245/340 MPa), SGC400 = SGC295Y (295/400), SGC440 = SGC335Y (335/440), '
                 'SGC490 = SGC365Y (365/490), SGC570 = SGC560Y (560/570). Current-name values: KDS 41 30 30 '
                 'Table 3.2-2; former-name values: JIS G 3302. Confirm Fy and Fu against the mill certificate.')


def _ks_d3506(Fy_MPa: float, Fu_MPa: float) -> dict:
    """KS D 3506 구조용 강종 — MPa 로 정해진 값을 ksi 로(반올림 없음)."""
    return {'Fy': Fy_MPa / KSI_TO_MPA, 'Fu': Fu_MPa / KSI_TO_MPA, 'coating': '용융아연도금', 'spec': 'KS D 3506',
            'elongation_group': 'A3.1.1', 'note': _KS_NAME_NOTE}


STEEL_GRADES = {
    # KS D 3506 — 용융 아연 도금 강판 (Hot-Dip Zinc-Coated). 첫 항목 = DEFAULT_GRADE.
    'SGC400':   _ks_d3506(295, 400),
    'SGC340':   _ks_d3506(245, 340),
    'SGC440':   _ks_d3506(335, 440),
    'SGC490':   _ks_d3506(365, 490),
    # KS D 3530 — 일반 구조용 경량 형강 (현행 명칭 SSC275: 275/410 MPa)
    'SSC400':   {'Fy': 35.53, 'Fu': 58.02, 'coating': 'None', 'spec': 'KS D 3530',
                 'elongation_group': 'A3.1.1',
                 'note': 'KS D 3530 current name is SSC275 (275/410 MPa, KDS 41 30 30 Table 3.2-1).'},
    # ASTM A653 — Hot-Dip Galvanized
    'A653-33':  {'Fy': 33, 'Fu': 45, 'coating': 'Galvanized', 'spec': 'ASTM A653', 'elongation_group': 'A3.1.1'},
    'A653-37':  {'Fy': 37, 'Fu': 52, 'coating': 'Galvanized', 'spec': 'ASTM A653', 'elongation_group': 'A3.1.1'},
    'A653-40':  {'Fy': 40, 'Fu': 55, 'coating': 'Galvanized', 'spec': 'ASTM A653', 'elongation_group': 'A3.1.1'},
    'A653-50':  {'Fy': 50, 'Fu': 65, 'coating': 'Galvanized', 'spec': 'ASTM A653', 'elongation_group': 'A3.1.1'},
    'A653-55':  {'Fy': 55, 'Fu': 70, 'coating': 'Galvanized', 'spec': 'ASTM A653', 'elongation_group': 'A3.1.1'},
    # ASTM A792 — Aluminum-Zinc Coated
    'A792-33':  {'Fy': 33, 'Fu': 45, 'coating': 'Al-Zn', 'spec': 'ASTM A792', 'elongation_group': 'A3.1.1'},
    'A792-37':  {'Fy': 37, 'Fu': 52, 'coating': 'Al-Zn', 'spec': 'ASTM A792', 'elongation_group': 'A3.1.1'},
    'A792-50':  {'Fy': 50, 'Fu': 65, 'coating': 'Al-Zn', 'spec': 'ASTM A792', 'elongation_group': 'A3.1.1'},
    # ASTM A1003 — Structural Steel (§A3.1.1 lists ST33H–ST50H)
    'A1003-33': {'Fy': 33, 'Fu': 45, 'coating': 'Various', 'spec': 'ASTM A1003', 'elongation_group': 'A3.1.1'},
    'A1003-40': {'Fy': 40, 'Fu': 55, 'coating': 'Various', 'spec': 'ASTM A1003', 'elongation_group': 'A3.1.1'},
    'A1003-50': {'Fy': 50, 'Fu': 65, 'coating': 'Various', 'spec': 'ASTM A1003', 'elongation_group': 'A3.1.1'},
}


def a313_design_values(Fsy: float, Fu: float) -> dict:
    """§A3.1.3(b)(c): 연신율 3 % 미만 강종의 감소 설계값 (ksi).

    Fy = min(0.75 Fsy, 60 ksi) — Appendix 1 및 Chapters C–J(§F2.4 제외)
    Fu = min(0.75 Fu, 62 ksi)  — Chapter J
    """
    return {'Fy': min(0.75 * Fsy, 60.0), 'Fu': min(0.75 * Fu, 62.0)}


def a313_flexure_Rb(w_t: float, Fsy: float, stiffened: bool = True, E: float = E) -> float | None:
    """§A3.1.3(a): Chapter F 공칭휨강도용 감소계수 Rb (Eq. A3.1.3-1/-2).

    Fsy 는 80 ksi 이하로 쓴다. 적용 범위(stiffened w/t ≤ 500, unstiffened w/t ≤ 60) 밖이면 None.
    """
    Fsy = min(Fsy, 80.0)
    if w_t <= 0 or Fsy <= 0:
        return None
    if stiffened:
        if w_t <= 0.067 * E / Fsy:
            return 1.0
        if w_t < 0.974 * E / Fsy:
            return 1.0 - 0.26 * (w_t * Fsy / E - 0.067) ** 0.4
        return 0.75 if w_t <= 500 else None
    if w_t <= 0.0173 * E / Fsy:
        return 1.0
    if w_t <= 60:
        return 1.079 - 0.6 * (w_t * Fsy / E) ** 0.5
    return None


def _low_ductility(Fsy: float, Fu: float, coating: str, spec: str, note: str) -> dict:
    red = a313_design_values(Fsy, Fu)
    return {
        'Fy': red['Fy'], 'Fu': red['Fu'],
        'Fsy_specified': Fsy, 'Fu_specified': Fu,
        'coating': coating, 'spec': spec,
        'elongation_group': 'A3.1.3',
        'restricted': True,
        'use_restriction': ('§A3.1.3: permitted only for multiple-web configurations such as roofing, '
                            'siding and floor decking — not for C/Z/hat members.'),
        'design_notes': ('Fy = min(0.75Fsy, 60 ksi) for Appendix 1 and Chapters C–J except §F2.4; '
                         'Fu = min(0.75Fu, 62 ksi) for Chapter J; Chapter F nominal flexural strength '
                         'uses Rb·Fsy (Eq. A3.1.3-1/-2, see a313_flexure_Rb).'),
        'note': note,
    }


LOW_DUCTILITY_GRADES = {
    'A653-80':  _low_ductility(80.0, 82.0, 'Galvanized', 'ASTM A653',
                               'SS Grade 80 Class 1/2 (§A3.1.3). Class 3 is §A3.1.2 (0.9Fsy, 0.9Fu).'),
    'A792-80':  _low_ductility(80.0, 82.0, 'Al-Zn', 'ASTM A792',
                               'Grade 80 Class 1/2 (§A3.1.3). Class 3 is §A3.1.2 (0.9Fsy, 0.9Fu).'),
    'SGC570':   _low_ductility(81.22, 82.67, '용융아연도금', 'KS D 3506',
                               'Fu/Fy = 1.02 < 1.08 fails §A3.1.1(a); treated as §A3.1.3 '
                               '(current KS name SGC560Y; KDS 41 30 30 gives no strength values).'),
    'A1003-80': _low_ductility(80.0, 82.0, 'Various', 'ASTM A1003',
                               'Not listed in §A3.1 (A1003 ST33H–ST50H only); Fu/Fy < 1.08, treated as §A3.1.3.'),
}


def get_grade(grade_id: str, include_restricted: bool = False) -> dict:
    """강재 등급 조회. 없으면 None 반환.

    §A3.1.3 강종은 include_restricted=True 일 때만 돌려주며, 그 'Fy'/'Fu' 는 감소 설계값이다.
    """
    grade = STEEL_GRADES.get(grade_id)
    if grade is None and include_restricted:
        grade = LOW_DUCTILITY_GRADES.get(grade_id)
    return grade


def list_grades(include_restricted: bool = False) -> list:
    """사용 가능한 강재 등급 목록 반환 (기본: 제한 없는 강종만). 첫 항목이 DEFAULT_GRADE.

    Fy/Fu 는 ksi, Fy_MPa/Fu_MPa 는 같은 값 × KSI_TO_MPA(반올림 없음 — KS 강종은 정수 MPa).
    """
    def _row(k, v):
        return {'id': k, **v, 'Fy_MPa': v['Fy'] * KSI_TO_MPA, 'Fu_MPa': v['Fu'] * KSI_TO_MPA}
    out = [_row(k, v) for k, v in STEEL_GRADES.items()]
    if include_restricted:
        out.extend(_row(k, v) for k, v in LOW_DUCTILITY_GRADES.items())
    return out
