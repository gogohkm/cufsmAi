"""
AISI Cold-Formed Steel Design Manual 2017 예제 전체 검증
cfs_centerline.py 모듈의 단면물성 계산 정확도를 AISI 참조값과 비교

검증 대상:
  - A (단면적)
  - Ix (강축 관성모멘트)
  - Sx (단면계수 = Ix / y_max)
  - Py = A * Fy (항복 축력)
  - My = Sx * Fy (항복 모멘트)
"""

import sys
sys.path.insert(0, '.')
from cfs_centerline import (
    ColdFormedSection, make_c_section, make_z_section, make_hat_section
)


def calc_section_moduli(section):
    """Sx_top, Sx_bot, Sy 계산"""
    coords = section.get_coords()  # 도심 원점
    props = section.properties
    ys = [c[1] for c in coords]
    xs = [c[0] for c in coords]
    y_top = max(ys)
    y_bot = min(ys)
    x_max = max(abs(min(xs)), abs(max(xs)))
    Sx_top = props['Ix'] / abs(y_top) if abs(y_top) > 1e-10 else 0
    Sx_bot = props['Ix'] / abs(y_bot) if abs(y_bot) > 1e-10 else 0
    Sy = props['Iy'] / x_max if x_max > 1e-10 else 0
    return Sx_top, Sx_bot, Sy


def verify(name, computed, reference, unit="", tol_pct=5.0):
    """단일 항목 검증"""
    if reference == 0:
        err_pct = 0 if abs(computed) < 1e-10 else float('inf')
    else:
        err_pct = (computed - reference) / reference * 100
    status = "PASS" if abs(err_pct) <= tol_pct else "FAIL"
    print(f"  {name:20s}: {computed:10.4f} vs {reference:10.4f} {unit:8s}  "
          f"err={err_pct:+6.2f}%  [{status}]")
    return status == "PASS"


def run_all():
    total_pass = 0
    total_checks = 0

    # ================================================================
    # Example I-8B: 9CS2.5x059 (Lipped C)
    # AISI: A=0.881, Ix=10.3, Sx=2.29, Py=48.5, My=126
    # ================================================================
    print("=" * 70)
    print("Example I-8B: 9CS2.5x059 (Lipped C)")
    print("=" * 70)
    sec = make_c_section(H=9.0, B=2.5, D=0.773, t=0.059, R=0.1875)
    p = sec.properties
    Sx_top, Sx_bot, Sy = calc_section_moduli(sec)
    Sx = min(Sx_top, Sx_bot)
    Fy = 55.0
    checks = [
        verify("A (in²)", p['A'], 0.881, "in²"),
        verify("Ix (in⁴)", p['Ix'], 10.3, "in⁴"),
        verify("Sx (in³)", Sx, 2.29, "in³"),
        verify("Py (kips)", p['A'] * Fy, 48.5, "kips"),
        verify("My (kip-in)", Sx * Fy, 126.0, "kip-in"),
        verify("Ixy (symm→0)", p['Ixy'], 0.0, "in⁴", tol_pct=0.1),
    ]
    total_pass += sum(checks)
    total_checks += len(checks)

    # ================================================================
    # Example II-2B / III-7B: 8ZS2.25x059 (Lipped Z)
    # AISI: Ag=0.822, Py=45.2, My=107
    # ================================================================
    print("\n" + "=" * 70)
    print("Example II-2B / III-7B: 8ZS2.25x059 (Lipped Z)")
    print("=" * 70)
    sec = make_z_section(H=8.0, B_top=2.25, B_bot=2.25, D=0.91, t=0.059, R=0.1875)
    p = sec.properties
    Sx_top, Sx_bot, Sy = calc_section_moduli(sec)
    Sx = min(Sx_top, Sx_bot)
    Fy = 55.0
    checks = [
        verify("A (in²)", p['A'], 0.822, "in²"),
        verify("Sx (in³)", Sx, 107.0 / 55.0, "in³"),
        verify("Py (kips)", p['A'] * Fy, 45.2, "kips"),
        verify("My (kip-in)", Sx * Fy, 107.0, "kip-in"),
    ]
    total_pass += sum(checks)
    total_checks += len(checks)

    # ================================================================
    # Example II-4B: 550T125-54 (Track, unlipped C)
    # AISI: Sx=0.668, My=22.0
    # ================================================================
    print("\n" + "=" * 70)
    print("Example II-4B: 550T125-54 (Track, unlipped C)")
    print("=" * 70)
    sec = make_c_section(H=5.698, B=1.25, D=0, t=0.0566, R=0.0849)
    p = sec.properties
    Sx_top, Sx_bot, Sy = calc_section_moduli(sec)
    Sx = min(Sx_top, Sx_bot)
    Fy = 33.0
    checks = [
        verify("Sx (in³)", Sx, 0.668, "in³"),
        verify("My (kip-in)", Sx * Fy, 22.0, "kip-in"),
        verify("Ixy (symm→0)", p['Ixy'], 0.0, "in⁴", tol_pct=0.1),
    ]
    total_pass += sum(checks)
    total_checks += len(checks)

    # ================================================================
    # Example II-5: 800S200-54 (Lipped C)
    # AISI: Sf=1.64, My=82.0
    # ================================================================
    print("\n" + "=" * 70)
    print("Example II-5: 800S200-54 (Lipped C)")
    print("=" * 70)
    sec = make_c_section(H=8.0, B=2.0, D=0.625, t=0.0566, R=0.0849)
    p = sec.properties
    Sx_top, Sx_bot, Sy = calc_section_moduli(sec)
    Sx = min(Sx_top, Sx_bot)
    Fy = 50.0
    checks = [
        verify("Sx (in³)", Sx, 1.64, "in³"),
        verify("My (kip-in)", Sx * Fy, 82.0, "kip-in"),
        verify("Ixy (symm→0)", p['Ixy'], 0.0, "in⁴", tol_pct=0.1),
    ]
    total_pass += sum(checks)
    total_checks += len(checks)

    # ================================================================
    # Example II-7B: 3HU4.5x135 (Hat)
    # AISI convention: depth=3 (web), width=4.5 (top plate), brim=1.67
    # AISI: Sy=1.52, My=76.0
    #
    # template.py 매핑 주의:
    #   template H → top plate width, template B → web height
    #   AISI에서 H=3(depth), B=4.5(width)를 template에 전달하면
    #   실제 모델: top_plate=3, web=4.5 (반대)
    # ================================================================
    print("\n" + "=" * 70)
    print("Example II-7B: 3HU4.5x135 (Hat) - AISI 표준 해석")
    print("=" * 70)
    # AISI 표준: web=3(depth), plate=4.5(width)
    sec_aisi = make_hat_section(H=3.0, B_top=4.5, B_bot=4.5 + 2 * 1.67, t=0.135, R=0.1875)
    p = sec_aisi.properties
    Sx_top, Sx_bot, Sy = calc_section_moduli(sec_aisi)
    Fy = 50.0
    Sx_aisi = min(Sx_top, Sx_bot)
    print(f"  [INFO] AISI 표준 (web=3, plate=4.5): Ix={p['Ix']:.4f}, Sx_min={Sx_aisi:.4f}")
    checks = [
        verify("Sx_min (in³)", Sx_aisi, 1.52, "in³"),
        verify("My (kip-in)", Sx_aisi * Fy, 76.0, "kip-in"),
        verify("Ixy (symm→0)", p['Ixy'], 0.0, "in⁴", tol_pct=0.1),
    ]
    total_pass += sum(checks)
    total_checks += len(checks)

    print("  [NOTE] Hat: template.py H/B swap (H->plate, B->web).")
    print("         AISI .mat 파일의 정확한 외측 치수 확보 필요.")

    # ================================================================
    # Example III-3: 362S162-54 (Lipped Z, compression)
    # AISI: Ag=0.422, Py=21.1
    # ================================================================
    print("\n" + "=" * 70)
    print("Example III-3: 362S162-54 (Lipped Z)")
    print("=" * 70)
    sec = make_z_section(H=3.625, B_top=1.625, B_bot=1.625, D=0.5, t=0.0566, R=0.0849)
    p = sec.properties
    Fy = 50.0
    checks = [
        verify("A (in²)", p['A'], 0.422, "in²"),
        verify("Py (kips)", p['A'] * Fy, 21.1, "kips"),
    ]
    total_pass += sum(checks)
    total_checks += len(checks)

    # ================================================================
    # Example III-5B: 4LS4x060 (Lipped Angle)
    # AISI: Ag=0.512, Py=25.6, Iy2=0.397
    # 외측 꼭짓점 경로:
    #   lip1_tip → lip1-leg1 → main_corner → leg2-lip2 → lip2_tip
    #   (D,H) → (0,H) → (0,0) → (B,0) → (B,D)
    # R은 main corner에만 적용, lip-leg 접합부는 sharp (R=0)
    # ================================================================
    print("\n" + "=" * 70)
    print("Example III-5B: 4LS4x060 (Lipped Angle)")
    print("=" * 70)
    H_a, B_a, D_a = 4.0, 4.0, 0.5
    t_a = 0.06
    R_a = 3 / 32  # 0.09375
    corners = [
        (D_a, H_a),    # lip1 tip (내측, 수직 다리 상단)
        (0, H_a),      # lip1-leg1 접합 (수직 다리 상단)
        (0, 0),        # main corner (수직-수평 교차)
        (B_a, 0),      # leg2-lip2 접합 (수평 다리 끝)
        (B_a, D_a),    # lip2 tip (내측, 수평 다리 끝)
    ]
    sec = ColdFormedSection(
        outer_corners=corners, t=t_a,
        corner_radii=[0, R_a, 0],  # lip-leg: sharp, main: R, leg-lip: sharp
        n_arc=10, outer_side='left',
        labels=["립1 끝", "립1-다리1", "코너", "다리2-립2", "립2 끝"],
    )
    p = sec.properties
    Fy = 50.0
    checks = [
        verify("A (in²)", p['A'], 0.512, "in²"),
        verify("Py (kips)", p['A'] * Fy, 25.6, "kips"),
    ]
    total_pass += sum(checks)
    total_checks += len(checks)

    # ================================================================
    # 종합 결과
    # ================================================================
    print("\n" + "=" * 70)
    print(f"종합: {total_pass}/{total_checks} PASS "
          f"({total_pass/total_checks*100:.1f}%)")
    print("=" * 70)

    return total_pass, total_checks


if __name__ == "__main__":
    run_all()
