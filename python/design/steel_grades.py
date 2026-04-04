"""ASTM 냉간성형강 강재 등급 데이터베이스

AISI S100-16 Chapter A3 참조
"""

# 공통 물성 (모든 강재)
E = 29500.0   # ksi — 탄성계수
G = 11300.0   # ksi — 전단탄성계수
nu = 0.30     # 포아송비

STEEL_GRADES = {
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
