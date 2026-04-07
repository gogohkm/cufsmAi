"""냉간성형강 강재 등급 데이터베이스

KS D 3506, KS D 3530, AISI S100-16 Chapter A3 참조
내부 저장 단위: ksi (US)
"""

# 공통 물성 (모든 강재) — AISI S100-16 §A3.1
E = 29500.0   # ksi — 탄성계수 (203,395 MPa)
G = 11346.0   # ksi — 전단탄성계수 (78,230 MPa) = E / (2*(1+nu))
nu = 0.30     # 포아송비

STEEL_GRADES = {
    # KS D 3506 — 용융 아연 도금 강판 (Hot-Dip Zinc-Coated)
    'SGC400':   {'Fy': 35.53, 'Fu': 58.02, 'coating': '용융아연도금', 'spec': 'KS D 3506'},
    'SGC440':   {'Fy': 42.79, 'Fu': 63.82, 'coating': '용융아연도금', 'spec': 'KS D 3506'},
    'SGC490':   {'Fy': 52.94, 'Fu': 71.08, 'coating': '용융아연도금', 'spec': 'KS D 3506'},
    'SGC570':   {'Fy': 81.22, 'Fu': 82.67, 'coating': '용융아연도금', 'spec': 'KS D 3506'},
    # KS D 3530 — 일반 구조용 경량 형강
    'SSC400':   {'Fy': 35.53, 'Fu': 58.02, 'coating': 'None', 'spec': 'KS D 3530'},
    # ASTM A653 — Hot-Dip Galvanized
    'A653-33':  {'Fy': 33, 'Fu': 45, 'coating': 'Galvanized', 'spec': 'ASTM A653'},
    'A653-37':  {'Fy': 37, 'Fu': 52, 'coating': 'Galvanized', 'spec': 'ASTM A653'},
    'A653-40':  {'Fy': 40, 'Fu': 55, 'coating': 'Galvanized', 'spec': 'ASTM A653'},
    'A653-50':  {'Fy': 50, 'Fu': 65, 'coating': 'Galvanized', 'spec': 'ASTM A653'},
    'A653-55':  {'Fy': 55, 'Fu': 70, 'coating': 'Galvanized', 'spec': 'ASTM A653'},
    'A653-80':  {'Fy': 80, 'Fu': 82, 'coating': 'Galvanized', 'spec': 'ASTM A653'},
    # ASTM A792 — Aluminum-Zinc Coated
    'A792-33':  {'Fy': 33, 'Fu': 45, 'coating': 'Al-Zn', 'spec': 'ASTM A792'},
    'A792-37':  {'Fy': 37, 'Fu': 52, 'coating': 'Al-Zn', 'spec': 'ASTM A792'},
    'A792-50':  {'Fy': 50, 'Fu': 65, 'coating': 'Al-Zn', 'spec': 'ASTM A792'},
    'A792-80':  {'Fy': 80, 'Fu': 82, 'coating': 'Al-Zn', 'spec': 'ASTM A792'},
    # ASTM A1003 — Structural Steel
    'A1003-33': {'Fy': 33, 'Fu': 45, 'coating': 'Various', 'spec': 'ASTM A1003'},
    'A1003-40': {'Fy': 40, 'Fu': 55, 'coating': 'Various', 'spec': 'ASTM A1003'},
    'A1003-50': {'Fy': 50, 'Fu': 65, 'coating': 'Various', 'spec': 'ASTM A1003'},
    'A1003-80': {'Fy': 80, 'Fu': 82, 'coating': 'Various', 'spec': 'ASTM A1003'},
}


def get_grade(grade_id: str) -> dict:
    """강재 등급 조회. 없으면 None 반환."""
    return STEEL_GRADES.get(grade_id)


def list_grades() -> list:
    """사용 가능한 강재 등급 목록 반환."""
    return [{'id': k, **v} for k, v in STEEL_GRADES.items()]
