"""접합부 설계 — AISI S100-16 Chapter J

볼트(J3), 나사(J4), 필릿용접(J2.5), 아크스팟(J2.2), 그루브(J2.1 버트/J2.6 플레어),
PAF(J5) 접합부의 공칭강도 계산. 각 파괴 모드별 강도를 계산하고 지배 모드를 결정한다.
J6 파단(전단파단/순단면 인장파단/블록전단) 한계상태를 모든 패스너 접합에 포함하며,
member_tension=True 시 §D1 요구에 따라 Chapter D 부재 인장강도(D2/D3)로도 제한한다.
"""

import math

# 강재 탄성계수 (ksi) — 아크스팟 슬렌더니스 분기에 사용
E_STEEL = 29500.0

# ============================================================
# 안전/저항 계수
# ============================================================

PHI_BOLT = {
    'bearing':  0.60,    # J3.3.1 (Eq. J3.3.1-1)
    'shear':    0.75,    # J3.4 (Appendix A): φ=0.75
    'tension':  0.75,    # J3.4 (Appendix A): φ=0.75
}
OMEGA_BOLT = {
    'bearing':  2.50,
    'shear':    2.00,    # J3.4 (Appendix A): Ω=2.00
    'tension':  2.00,
}

# J6 파단 한계상태 계수 (Table J6-1)
PHI_RUPTURE = {
    'weld':   0.60,
    'bolt':   0.65,
    'screw':  0.50,
    'paf':    0.50,
}
OMEGA_RUPTURE = {
    'weld':   2.50,
    'bolt':   2.22,
    'screw':  3.00,
    'paf':    3.00,
}

# Table J3.4-1 (Appendix A): 볼트 공칭 전단/인장강도 Fnv, Fnt (ksi)
# 키: (grade, threads_excluded). 'small' = 1/4<=d<1/2 in, 'large' = d>=1/2 in.
# threaded_parts 는 Fu(볼트 인장강도) 계수로 표기.
_BOLT_TABLE_J34_1 = {
    # A307 Grade A — 나사 전단면 통과 (note b)
    ('A307', False): {'Fnv_small': 24.0, 'Fnv_large': 27.0, 'Fnt_small': 40.0, 'Fnt_large': 45.0},
    ('A307', True):  {'Fnv_small': 24.0, 'Fnv_large': 27.0, 'Fnt_small': 40.0, 'Fnt_large': 45.0},
    # A325 (F3125) — small(d<1/2) = NA
    ('A325', False): {'Fnv_small': None, 'Fnv_large': 54.0, 'Fnt_small': None, 'Fnt_large': 90.0},
    ('A325', True):  {'Fnv_small': None, 'Fnv_large': 68.0, 'Fnt_small': None, 'Fnt_large': 90.0},
    # A354 Grade BD
    ('A354BD', False): {'Fnv_small': 61.0, 'Fnv_large': 68.0, 'Fnt_small': 101.0, 'Fnt_large': 113.0},
    ('A354BD', True):  {'Fnv_small': 61.0, 'Fnv_large': 84.0, 'Fnt_small': 101.0, 'Fnt_large': 113.0},
    # A449
    ('A449', False): {'Fnv_small': 48.0, 'Fnv_large': 54.0, 'Fnt_small': 81.0, 'Fnt_large': 90.0},
    ('A449', True):  {'Fnv_small': 48.0, 'Fnv_large': 68.0, 'Fnt_small': 81.0, 'Fnt_large': 90.0},
    # A490 (F3125) — small(d<1/2) = NA
    ('A490', False): {'Fnv_small': None, 'Fnv_large': 68.0, 'Fnt_small': None, 'Fnt_large': 113.0},
    ('A490', True):  {'Fnv_small': None, 'Fnv_large': 84.0, 'Fnt_small': None, 'Fnt_large': 113.0},
}


def _bolt_Fnv_Fnt(d: float, Fub: float, bolt_grade: str = None,
                  threads_excluded: bool = False) -> tuple:
    """Table J3.4-1 (Appendix A)로부터 Fnv, Fnt (ksi) 산정.

    bolt_grade 가 표에 있으면 표값을 사용하고, 없거나 None이면
    "Threaded Parts" 행(Fu 계수)을 사용한다 (Fnv=0.450·Fu 나사통과,
    0.563·Fu 나사제외; Fnt=0.75·Fu, d<1/2은 0.675·Fu).
    """
    small = d < 0.5  # 1/4 in <= d < 1/2 in
    key = (str(bolt_grade).upper().replace('-', '').replace(' ', ''), threads_excluded) if bolt_grade else None
    # 정규화 키 매칭
    norm_map = {
        'A307': 'A307', 'A307A': 'A307',
        'A325': 'A325', 'F3125A325': 'A325', 'A325M': 'A325',
        'A354BD': 'A354BD', 'A354': 'A354BD',
        'A449': 'A449',
        'A490': 'A490', 'F3125A490': 'A490', 'A490M': 'A490',
    }
    if key is not None and norm_map.get(key[0]) is not None:
        row = _BOLT_TABLE_J34_1[(norm_map[key[0]], threads_excluded)]
        Fnv = row['Fnv_small'] if small else row['Fnv_large']
        Fnt = row['Fnt_small'] if small else row['Fnt_large']
        if Fnv is not None and Fnt is not None:
            return Fnv, Fnt, f'{norm_map[key[0]]}'
    # Threaded Parts (Fu = 볼트 인장강도 Fub) — 보수적 fallback
    fnv_coef = 0.563 if threads_excluded else 0.450
    Fnv = fnv_coef * Fub
    Fnt = (0.75 if not small else 0.675) * Fub
    return Fnv, Fnt, 'Threaded Parts'


def _bolt_hole_dia(d: float) -> float:
    """표준 구멍 직경 dh (Table J3-1, in)."""
    if d < 0.5:
        return d + 1.0 / 32.0
    elif d < 1.0:
        return d + 1.0 / 16.0
    elif d == 1.0:
        return 1.125
    else:
        return d + 1.0 / 8.0

PHI_SCREW = {
    'bearing':  0.50,    # J4.3.1
    'pullout':  0.50,    # J4.4.1
    'pullover': 0.50,    # J4.4.2
    'shear':    0.50,    # J4.3
    'tilting':  0.50,    # J4.3.1
}
OMEGA_SCREW = {
    'bearing':  3.00,
    'pullout':  3.00,
    'pullover': 3.00,
    'shear':    3.00,
    'tilting':  3.00,
}

PHI_WELD = {
    'weld_shear':  0.60,    # J2.1
    'sheet_shear': 0.60,    # J2.2.2.1
    'sheet_tear':  0.60,    # J2.2.2.1
}
OMEGA_WELD = {
    'weld_shear':  2.50,
    'sheet_shear': 2.50,
    'sheet_tear':  2.50,
}


# ============================================================
# J6 파단 한계상태 (전단파단/순단면 인장파단/블록전단)
# ============================================================

def _j6_rupture_limit_states(conn: str, Fu: float, t: float, dh: float,
                             n: int, e: float, Fy: float = None,
                             Ag: float = None, width: float = None,
                             d: float = None, s: float = None,
                             g: float = None, s_pitch: float = None,
                             include_block_shear: bool = True) -> tuple:
    """J6 파단 한계상태 목록을 생성한다.

    모든 패스너 접합(볼트/나사/PAF)에 적용. 반환: (limit_states, warnings)

    Args:
        conn: 'bolt' | 'screw' | 'paf' | 'weld' (Table J6-1 계수 선택)
        Fu: 모재 인장강도 (ksi)
        t: 모재 두께 (in) — 임계단면 두께
        dh: 구멍 직경 (in) (PAF는 1.10·ds)
        n: 임계단면 패스너 개수
        e: 끝단(end) 거리 (in) — J6.1 e_net = e - dh/2 산정용
        Fy: 항복강도 (ksi) — 블록전단용
        Ag: 부재 총단면적 (in^2) — J6.2 인장파단용 (없으면 width·t 시도)
        width: 부재 폭 (in) — Ag/Usl 산정용
        d: 패스너 직경 (in) — Usl=0.9+0.1·d/s 산정용
        s: 단면 내 1개 구멍당 시트 폭 (in) = width/구멍수
        g: 게이지 (블록전단 Agv/Ant)
        s_pitch: 길이방향 피치 (stagger)
        include_block_shear: J6.3 (볼트/용접만 True)
    """
    ls = []
    warnings = []
    phi_r = PHI_RUPTURE.get(conn, 0.50)
    omega_r = OMEGA_RUPTURE.get(conn, 3.00)

    # --- J6.1 전단파단 (Eq. J6.1-1, J6.1-2) ---
    # Anv = 2n·t·e_net, e_net = e - dh/2 (개별 패스너가 끝단으로 인열)
    e_net = max(e - dh / 2.0, 0.0)
    Anv = 2.0 * n * t * e_net
    Pnv = 0.6 * Fu * Anv
    ls.append({
        'name': 'Shear Rupture (J6.1)',
        'Rn': round(Pnv, 3),
        'phi': phi_r,
        'omega': omega_r,
        'formula': f'Pnv = 0.6×{Fu}×Anv, Anv=2×{n}×{t}×(e-dh/2)={Anv:.4f} = {Pnv:.3f}',
        'equation': 'J6.1-1',
    })

    # --- J6.2 순단면 인장파단 (Eq. J6.2-1..-4) ---
    if Ag is None and width is not None:
        Ag = width * t
    if Ag is not None and Ag > 0:
        # 단면 내 구멍 수: 보수적으로 n (한 임계단면의 구멍 수)
        n_holes_cross = max(int(n), 1)
        Ant = Ag - n_holes_cross * dh * t
        # stagger 항 (있을 때)
        if s_pitch and g and g > 0:
            Ant += t * (s_pitch ** 2) / (4.0 * g + 2.0 * dh)
            Usl = 1.0  # staggered pattern (Table J6.2-1 항목 2)
        else:
            # 평판, stagger 없음: Usl = 0.9 + 0.1·d/s (Eq. J6.2-4)
            if d and s and s > 0:
                Usl = 0.9 + 0.1 * d / s
            else:
                # s = width / 구멍수 로 추정
                s_est = (width / n_holes_cross) if width else None
                if d and s_est and s_est > 0:
                    Usl = 0.9 + 0.1 * d / s_est
                else:
                    Usl = 0.9  # 보수적 (d/s→0 하한 근사)
                    warnings.append('J6.2 인장파단: 게이지 s 미지정 — Usl=0.9 보수적 가정')
        Usl = max(min(Usl, 1.0), 0.0)
        Ant = max(Ant, 0.0)
        Ae = Usl * Ant
        Pnt = Fu * Ae
        ls.append({
            'name': 'Tension Rupture (J6.2)',
            'Rn': round(Pnt, 3),
            'phi': phi_r,
            'omega': omega_r,
            'formula': f'Pnt = {Fu}×Usl×Ant, Usl={Usl:.3f}, Ant={Ant:.4f} = {Pnt:.3f}',
            'equation': 'J6.2-1',
        })
    else:
        warnings.append(
            'J6.2 순단면 인장파단 미평가: 부재 총단면적(Ag) 또는 폭(width) 미입력 — '
            '접합 적정성은 인장파단 검토 없이는 확정 불가')

    # --- J6.3 블록전단 (볼트/용접만, Eq. J6.3-1/-2) ---
    if include_block_shear and conn in ('bolt', 'weld'):
        if Fy is not None and width is not None and g is not None:
            # 단순 1열 패턴 가정: Agv=2·e·t (양측 전단경로)
            Agv = 2.0 * e * t
            Anv_bs = 2.0 * e_net * t
            Ant_bs = max((g - dh) * t, 0.0)
            Ubs = 1.0  # 코핑 보 + 다열 외 일반 (Eq. J6.3 정의)
            Pnr1 = 0.6 * Fy * Agv + Ubs * Fu * Ant_bs
            Pnr2 = 0.6 * Fu * Anv_bs + Ubs * Fu * Ant_bs
            Pnr = min(Pnr1, Pnr2)
            ls.append({
                'name': 'Block Shear (J6.3)',
                'Rn': round(Pnr, 3),
                'phi': phi_r,
                'omega': omega_r,
                'formula': f'Pnr = min(0.6Fy·Agv+Fu·Ant, 0.6Fu·Anv+Fu·Ant) = {Pnr:.3f}',
                'equation': 'J6.3-1/-2',
            })
        else:
            warnings.append(
                'J6.3 블록전단 미평가: Fy/폭(width)/게이지(g) 미입력 — '
                '블록전단이 지배할 수 있으므로 별도 검토 필요')

    return ls, warnings


# Chapter D 인장 한계상태 계수
PHI_TENSION = {'yield': 0.90, 'rupture': 0.75}   # D2 / D3 (LRFD)
OMEGA_TENSION = {'yield': 1.67, 'rupture': 2.00}  # D2 / D3 (ASD)


def _chapter_d_tension_caps(Fy: float, Fu: float, t: float, dh: float,
                            n: int, Ag: float = None, width: float = None,
                            Ae: float = None) -> tuple:
    """Chapter D 부재 인장 한계상태(D2 항복/D3 순단면 파단)를 한계상태로 반환.

    §J3/J4/J5 는 패스너 접합 공칭강도가 Chapter D 부재 인장강도(D2/D3)로도
    제한됨을 요구한다(§D1). 부재 총단면적 Ag(또는 폭 width)가 주어질 때만 평가하며,
    인장(축력)이 작용하는 부재에만 의미가 있다. 반환: (limit_states, warnings)

    Args:
        Fy, Fu: 부재 항복/인장강도 (ksi)
        t: 부재 두께 (in)
        dh: 구멍 직경 (in) — 순단면 An 산정용
        n: 임계단면 패스너 개수
        Ag: 부재 총단면적 (in^2). None이면 width·t.
        width: 부재 폭 (in).
        Ae: 유효 순단면적 (in^2). None이면 An=Ag-n·dh·t 사용 (shear-lag 미반영, 보수적 상한).
    """
    ls = []
    warnings = []
    if Ag is None and width is not None:
        Ag = width * t
    if Ag is None or Ag <= 0:
        return ls, warnings
    # D2 총단면 항복 (Eq. D2-1): Tn = Ag·Fy
    Tn_y = Ag * Fy
    ls.append({
        'name': 'Member Tension Yield (D2)',
        'Rn': round(Tn_y, 3),
        'phi': PHI_TENSION['yield'],
        'omega': OMEGA_TENSION['yield'],
        'formula': f'Tn = Ag({Ag:.4f})×Fy({Fy}) = {Tn_y:.3f}',
        'equation': 'D2-1',
    })
    # D3 순단면 파단 (Eq. D3-1): Tn = An·Fu (Ae 미입력 시 shear-lag 미반영 — 상한)
    An = Ae if Ae is not None else max(Ag - n * dh * t, 0.0)
    Tn_r = An * Fu
    ls.append({
        'name': 'Member Tension Rupture (D3)',
        'Rn': round(Tn_r, 3),
        'phi': PHI_TENSION['rupture'],
        'omega': OMEGA_TENSION['rupture'],
        'formula': f'Tn = An({An:.4f})×Fu({Fu}) = {Tn_r:.3f}',
        'equation': 'D3-1',
    })
    if Ae is None:
        warnings.append(
            'Chapter D 캡: 유효순단면 Ae 미입력 — An=Ag−n·dh·t 사용(전단지연 미반영, '
            '비보수적일 수 있음). 부재 인장 시 §J6 전단지연계수로 Ae 산정 권장.')
    return ls, warnings


# ============================================================
# 볼트 접합 (J3)
# ============================================================

def bolt_connection(t1: float, t2: float, d: float,
                    Fy: float, Fu: float, Fub: float,
                    e: float = None, s: float = None,
                    n: int = 1,
                    design_method: str = 'LRFD',
                    bolt_grade: str = None,
                    threads_excluded: bool = False,
                    mf: float = None,
                    hole_type: str = 'standard',
                    pattern_length: float = None,
                    Ag: float = None, width: float = None,
                    g: float = None, s_pitch: float = None,
                    Vu: float = None, Tu: float = None,
                    member_tension: bool = False, Ae: float = None) -> dict:
    """볼트 접합 설계 (§J3 + §J6)

    Args:
        t1, t2: 연결판 두께 (in)
        d: 볼트 직경 (in)
        Fy, Fu: 모재 항복/인장강도 (ksi)
        Fub: 볼트 인장강도 (ksi) — 표에 없는 등급의 Threaded Parts fallback에 사용
        e: 끝단 거리 (in, None이면 1.5d 최소값 가정 — J3.2)
        s: 볼트 간격 (in, None이면 3d 가정 — J3.1)
        n: 볼트 개수
        design_method: 'ASD' or 'LRFD'
        bolt_grade: 'A307'|'A325'|'A354BD'|'A449'|'A490' (None이면 Threaded Parts)
        threads_excluded: 전단면에서 나사 제외 여부 (Table J3.4-1)
        mf: 지압 수정계수 (Table J3.3.1-2). None이면 단전단/와셔없음 보수값 0.75
        hole_type: 'standard'|'oversized' (Table J3.3.1-1 C 산정)
        pattern_length: 패스너 패턴 길이 (in) — >38 in 이면 end-loaded Fnv×0.833 (note a)
        Ag, width, g, s_pitch: J6 순단면/블록전단 평가용 부재 기하 (선택)
        Vu: 소요 전단력 (kips) — J3.4 전단-인장 상호작용용 (선택)
        Tu: 소요 인장력 (kips) — 주어지면 J3.4 전단-인장 상호작용 검토 수행 (선택)
        member_tension: True이면 §D1 요구에 따라 Chapter D 부재 인장강도(D2/D3)로
            접합 강도를 제한한다. 부재가 축인장을 받는 경우에만 의미 있음. (선택)
        Ae: 유효 순단면적 (in^2) — Chapter D D3 파단용. None이면 An=Ag-n·dh·t 사용.
    """
    if e is None:
        e = 1.5 * d  # J3.2 최소 끝단거리
    if s is None:
        s = 3.0 * d  # J3.1 최소 간격

    t_min = min(t1, t2)
    limit_states = []
    warnings = []

    # (a) 지압 강도 (J3.3.1, Eq. J3.3.1-1): Pnb = C·mf·d·t·Fu
    # C 는 Table J3.3.1-1 에 따라 d/t 비의 함수 (끝단/간격 비가 아님)
    dt = d / t_min if t_min > 0 else float('inf')
    if hole_type in ('oversized', 'short_slotted', 'short-slotted'):
        if dt < 7:
            C = 3.0
        elif dt <= 18:
            C = 1.0 + 14.0 / dt
        else:
            C = 1.8
    else:  # standard holes
        if dt < 10:
            C = 3.0
        elif dt <= 22:
            C = 4.0 - 0.1 * dt
        else:
            C = 1.8
    # mf: Table J3.3.1-2. 미지정 시 단전단/와셔 없음 보수값 0.75 가정
    if mf is None:
        mf = 0.75  # 보수적: 단전단 + 와셔 없음 (Table J3.3.1-2)
    Pnb_per = C * mf * d * t_min * Fu
    Pnb = n * Pnb_per
    limit_states.append({
        'name': 'Bearing (J3.3.1)',
        'Rn': round(Pnb, 3),
        'phi': PHI_BOLT['bearing'],
        'omega': OMEGA_BOLT['bearing'],
        'formula': f'Pnb = {n}×C×mf×d×t×Fu, C={C:.3f}(d/t={dt:.2f}), mf={mf} = {Pnb:.3f}',
        'equation': 'J3.3.1-1',
    })

    # (b) 볼트 전단 (J3.4, Appendix A, Eq. J3.4-1): Pn = Ab·Fnv (Table J3.4-1)
    Ab = math.pi / 4 * d ** 2
    Fnv, Fnt, grade_label = _bolt_Fnv_Fnt(d, Fub, bolt_grade, threads_excluded)
    # note (a): end-loaded 패턴 길이 > 38 in 이면 Fnv 83.3%로 감소
    if pattern_length is not None and pattern_length > 38.0:
        Fnv *= 0.833
    Pns = n * Ab * Fnv
    limit_states.append({
        'name': 'Bolt Shear (J3.4)',
        'Rn': round(Pns, 3),
        'phi': PHI_BOLT['shear'],
        'omega': OMEGA_BOLT['shear'],
        'formula': f'Pns = {n}×{Ab:.4f}×Fnv({grade_label})={Fnv:.1f} = {Pns:.3f}',
        'equation': 'J3.4-1 (Appendix A)',
    })

    # (c) J6 파단 한계상태 (전단파단/순단면 인장파단/블록전단)
    dh = _bolt_hole_dia(d)
    j6_ls, j6_warn = _j6_rupture_limit_states(
        conn='bolt', Fu=Fu, t=t_min, dh=dh, n=n, e=e, Fy=Fy,
        Ag=Ag, width=width, d=d, s=None, g=g, s_pitch=s_pitch,
        include_block_shear=True)
    limit_states.extend(j6_ls)
    warnings.extend(j6_warn)

    # (c-2) §D1: 접합 강도는 Chapter D 부재 인장강도(D2/D3)로도 제한 (인장 부재 시)
    if member_tension:
        d_ls, d_warn = _chapter_d_tension_caps(
            Fy=Fy, Fu=Fu, t=t_min, dh=dh, n=n, Ag=Ag, width=width, Ae=Ae)
        limit_states.extend(d_ls)
        warnings.extend(d_warn)

    # (d) J3.4 전단-인장 상호작용 (Eq. J3.4-2 ASD / J3.4-3 LRFD)
    # Tu(소요 인장력)가 주어지면, 소요 전단응력 fv에 의해 감소된 공칭 인장응력 F'nt로
    # 볼트 인장 적정성을 검토한다. fv = Vu/(n·Ab). F'nt ≤ Fnt 상한.
    shear_tension = None
    if Tu is not None and Tu > 0:
        phi_v = PHI_BOLT['shear']
        omega_v = OMEGA_BOLT['shear']
        phi_t = PHI_BOLT['tension']
        omega_t = OMEGA_BOLT['tension']
        V_req = abs(Vu) if Vu else 0.0
        fv = V_req / (n * Ab) if (n > 0 and Ab > 0) else 0.0  # 소요 전단응력 (ksi)
        st_warn = []
        # fv는 허용/설계 전단응력을 초과할 수 없음
        fv_cap = phi_v * Fnv if design_method == 'LRFD' else Fnv / omega_v
        if fv > fv_cap:
            st_warn.append(
                f'§J3.4: 소요 전단응력 fv={fv:.2f} ksi가 허용 전단응력 {fv_cap:.2f} ksi 초과 — '
                f'전단 단독으로 볼트 부적합')
        # 감소된 공칭 인장응력 F'nt
        if design_method == 'LRFD':
            Fnt_red = 1.3 * Fnt - (Fnt / (phi_v * Fnv)) * fv if Fnv > 0 else 0.0
        else:
            Fnt_red = 1.3 * Fnt - (omega_v * Fnt / Fnv) * fv if Fnv > 0 else 0.0
        Fnt_red = max(min(Fnt_red, Fnt), 0.0)
        Pnt_prime = n * Ab * Fnt_red  # 감소된 공칭 인장강도 (kips)
        avail_T = phi_t * Pnt_prime if design_method == 'LRFD' else Pnt_prime / omega_t
        ratio = (Tu / avail_T) if avail_T > 0 else float('inf')
        shear_tension = {
            'V_required': round(V_req, 3),
            'T_required': round(Tu, 3),
            'fv': round(fv, 3),
            'Fnt': round(Fnt, 2),
            'Fnv': round(Fnv, 2),
            'Fnt_reduced': round(Fnt_red, 3),
            'Pnt_prime': round(Pnt_prime, 3),
            'available_tension': round(avail_T, 3),
            'ratio': round(ratio, 4),
            'pass': ratio <= 1.0,
            'equation': 'J3.4-3 (LRFD)' if design_method == 'LRFD' else 'J3.4-2 (ASD)',
        }
        if st_warn:
            shear_tension['warnings'] = st_warn
            warnings.extend(st_warn)

    # 각 한계상태별 설계강도
    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    # 지배 모드
    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    spec_sections = ['J3.3.1', 'J3.4', 'J6.1', 'J6.2', 'J6.3']
    if member_tension:
        spec_sections += ['D2', 'D3']
    result = {
        'connection_type': 'bolt',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': spec_sections,
    }
    if shear_tension is not None:
        result['shear_tension_interaction'] = shear_tension
    if warnings:
        result['warnings'] = warnings
        result['j6_verified'] = False
    else:
        result['j6_verified'] = True
    return result


# ============================================================
# 나사 접합 (J4)
# ============================================================

def screw_connection(t1: float, t2: float, d: float,
                     Fy: float, Fu: float, Fub: float,
                     n: int = 1,
                     design_method: str = 'LRFD',
                     Fu1: float = None, Fu2: float = None,
                     tc: float = None, dw: float = None,
                     e: float = None,
                     Ag: float = None, width: float = None,
                     g: float = None,
                     member_tension: bool = False, Ae: float = None) -> dict:
    """나사 접합 설계 (§J4 + §J6)

    AISI S100-16 §J4 표기:
        t1: 나사 머리/와셔와 접촉하는 부재 두께 (in)
        t2: 나사 머리/와셔와 접촉하지 않는 (far) 부재 두께 (in)
        Fu1, Fu2: t1/t2 부재의 인장강도 (ksi). None이면 Fu 사용.
        tc: 풀아웃 관입깊이와 t2 중 작은 값 (in). None이면 t2 사용 (보수적).
    d: 나사 직경 (in)
    Fub: 나사 전단강도 Pnvs 산정용 (ksi)
    dw: 유효 풀오버 직경 d'w (in, J4.4.2). None이면 보수 추정.
    e: 끝단 거리 (in). None이면 1.5d (J4.2 최소).
    Ag, width, g: J6 순단면 평가용 (선택)
    member_tension: True이면 §J4 요구(접합 강도는 Chapter D로도 제한)에 따라
        Chapter D 부재 인장강도(D2/D3) 캡을 적용한다. 부재 축인장 시에만 의미. (선택)
    Ae: 유효 순단면적 (in^2) — Chapter D D3 파단용. None이면 An=Ag-n·dh·t. (선택)
    """
    if Fu1 is None:
        Fu1 = Fu
    if Fu2 is None:
        Fu2 = Fu
    if e is None:
        e = 1.5 * d  # J4.2 최소 끝단거리

    limit_states = []
    warnings = []

    # (a) 전단 지압/tilting — J4.3.1
    # t2/t1 비에 따라 분기; 각 항은 해당 부재 두께·강도(Fu1/Fu2) 사용
    ratio = t2 / t1 if t1 > 0 else float('inf')
    Pns_eq1 = 4.2 * math.sqrt(max(t2 ** 3 * d, 0.0)) * Fu2 * n  # Eq. J4.3.1-1
    Pns_eq2 = 2.7 * t1 * d * Fu1 * n                            # Eq. J4.3.1-2
    Pns_eq3 = 2.7 * t2 * d * Fu2 * n                            # Eq. J4.3.1-3
    if ratio <= 1.0:
        Pns = min(Pns_eq1, Pns_eq2, Pns_eq3)
        eq_bear = 'J4.3.1-1/2/3'
    elif ratio >= 2.5:
        Pns = min(Pns_eq2, Pns_eq3)  # Eq. J4.3.1-4/-5
        eq_bear = 'J4.3.1-4/5'
    else:
        Pn_ratio_1 = min(Pns_eq1, Pns_eq2, Pns_eq3)
        Pn_ratio_25 = min(Pns_eq2, Pns_eq3)
        interp = (ratio - 1.0) / 1.5
        Pns = (1 - interp) * Pn_ratio_1 + interp * Pn_ratio_25
        eq_bear = 'J4.3.1 (linear interpolation)'

    limit_states.append({
        'name': 'Bearing/Tilting (J4.3.1)',
        'Rn': round(Pns, 3),
        'phi': PHI_SCREW['bearing'],
        'omega': OMEGA_SCREW['bearing'],
        'formula': f'Pns = {Pns:.3f} kips (t2/t1={ratio:.2f})',
        'equation': eq_bear,
    })

    # (b) 나사 전단 (J4.3.2) — Pnvs (제조사값). 보수적으로 0.5·Fub·As.
    As = math.pi / 4 * d ** 2
    Pss = 0.50 * Fub * As * n
    limit_states.append({
        'name': 'Screw Shear (J4.3.2)',
        'Rn': round(Pss, 3),
        'phi': PHI_SCREW['shear'],
        'omega': OMEGA_SCREW['shear'],
        'formula': f'Pss = 0.5×{Fub}×{As:.4f}×{n} = {Pss:.3f}',
        'equation': 'J4.3.2',
    })

    # (c) 풀아웃 (J4.4.1, Eq. J4.4.1-1): Pnot = 0.85·tc·d·Fu2 (far member)
    # tc = 관입깊이와 t2 중 작은 값. 미지정 시 t2(far member) 보수 사용.
    tc_eff = tc if tc is not None else t2
    Pnot = 0.85 * tc_eff * d * Fu2 * n
    limit_states.append({
        'name': 'Pull-out (J4.4.1)',
        'Rn': round(Pnot, 3),
        'phi': PHI_SCREW['pullout'],
        'omega': OMEGA_SCREW['pullout'],
        'formula': f'Pnot = 0.85×tc({tc_eff})×{d}×Fu2({Fu2})×{n} = {Pnot:.3f}',
        'equation': 'J4.4.1-1',
    })

    # (d) 풀오버 (J4.4.2, Eq. J4.4.2-1): Pnov = 1.5·t1·d'w·Fu1 (head-side member)
    if dw is None:
        dw = min(d * 2.0, 0.75)  # 와셔 없는 경우 d'w=dh<=3/4 in (J4.4.2(b))
    else:
        dw = min(dw, 0.75)
    Pnov = 1.5 * t1 * dw * Fu1 * n
    limit_states.append({
        'name': 'Pull-over (J4.4.2)',
        'Rn': round(Pnov, 3),
        'phi': PHI_SCREW['pullover'],
        'omega': OMEGA_SCREW['pullover'],
        'formula': f'Pnov = 1.5×t1({t1})×{dw:.3f}×Fu1({Fu1})×{n} = {Pnov:.3f}',
        'equation': 'J4.4.2-1',
    })

    # (e) J6 파단 (나사: J6.1 전단파단 + J6.2 인장파단, 블록전단 제외)
    # 임계단면 두께는 얇은 부재로 보수적 평가
    t_crit = min(t1, t2)
    Fu_crit = Fu1 if t1 <= t2 else Fu2
    dh = d  # 나사는 별도 구멍이 없으므로 직경 d로 보수 평가
    j6_ls, j6_warn = _j6_rupture_limit_states(
        conn='screw', Fu=Fu_crit, t=t_crit, dh=dh, n=n, e=e,
        Ag=Ag, width=width, d=d, g=g, include_block_shear=False)
    limit_states.extend(j6_ls)
    warnings.extend(j6_warn)

    # (f) §J4: 나사 접합 공칭강도는 Chapter D 부재 인장강도(D2/D3)로도 제한
    if member_tension:
        d_ls, d_warn = _chapter_d_tension_caps(
            Fy=Fy, Fu=Fu_crit, t=t_crit, dh=dh, n=n, Ag=Ag, width=width, Ae=Ae)
        limit_states.extend(d_ls)
        warnings.extend(d_warn)

    # 설계강도 계산
    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    spec_sections = ['J4.3.1', 'J4.3.2', 'J4.4.1', 'J4.4.2', 'J6.1', 'J6.2']
    if member_tension:
        spec_sections += ['D2', 'D3']
    result = {
        'connection_type': 'screw',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': spec_sections,
    }
    if warnings:
        result['warnings'] = warnings
        result['j6_verified'] = False
    else:
        result['j6_verified'] = True
    return result


# ============================================================
# 필릿 용접 (J2.1)
# ============================================================

def fillet_weld_connection(t1: float, t2: float,
                          weld_size: float, weld_length: float,
                          Fy: float, Fu: float,
                          Fxx: float = 60,
                          n_welds: int = 1,
                          design_method: str = 'LRFD',
                          load_direction: str = 'longitudinal',
                          Fu1: float = None, Fu2: float = None,
                          w1: float = None, w2: float = None) -> dict:
    """필릿 용접 접합 설계 (§J2.5)

    Args:
        t1, t2: 연결판 두께 (in)
        weld_size: 용접 레그 크기 (in) — w1,w2 미지정 시 양쪽에 사용
        weld_length: 용접 길이 L (in)
        Fy, Fu: 모재 항복/인장강도 (ksi)
        Fxx: 용접봉 강도 (ksi, 기본 E60)
        n_welds: 용접선 수 (양면 용접 = 2)
        load_direction: 'longitudinal' | 'transverse' (J2.5(a)/(b))
        Fu1, Fu2: 각 연결판 인장강도 (None이면 Fu)
        w1, w2: 각 용접 레그 (in). None이면 weld_size 사용. lap joint w1<=t1.
    """
    if Fu1 is None:
        Fu1 = Fu
    if Fu2 is None:
        Fu2 = Fu
    if w1 is None:
        w1 = weld_size
    if w2 is None:
        w2 = weld_size
    L = weld_length
    t_min = min(t1, t2)
    limit_states = []

    longitudinal = str(load_direction).lower().startswith('long')

    # (a/b) 모재 전단강도 — 연결판별 Pnv1(t1,Fu1), Pnv2(t2,Fu2)의 작은 값 (J2.5)
    def _sheet_pnv(t_i, Fu_i):
        if longitudinal:
            Lt = L / t_i if t_i > 0 else float('inf')
            if Lt < 25:  # Eq. J2.5-1/-2
                return (1.0 - 0.01 * L / t_i) * L * t_i * Fu_i, 0.60, 2.55, 'J2.5-1/2'
            else:        # Eq. J2.5-3/-4
                return 0.75 * t_i * L * Fu_i, 0.50, 3.05, 'J2.5-3/4'
        else:            # Eq. J2.5-5/-6 (transverse)
            return t_i * L * Fu_i, 0.65, 2.35, 'J2.5-5/6'

    Pnv1, phi_s, omega_s, eq_s = _sheet_pnv(t1, Fu1)
    Pnv2, _, _, _ = _sheet_pnv(t2, Fu2)
    Pnv_sheet = min(Pnv1, Pnv2) * n_welds
    limit_states.append({
        'name': 'Sheet Strength (J2.5)',
        'Rn': round(Pnv_sheet, 3),
        'phi': phi_s,
        'omega': omega_s,
        'formula': f'Pnv = min(Pnv1={Pnv1:.3f}, Pnv2={Pnv2:.3f})×{n_welds} = {Pnv_sheet:.3f}',
        'equation': eq_s,
    })

    # 용접금속 한계 (Eq. J2.5-7): t = min(t1,t2) > 0.10 in 인 경우에만 적용
    if t_min > 0.10:
        tw = 0.707 * min(w1, w2)  # 유효 목두께
        Pn_weld = 0.75 * tw * L * Fxx * n_welds
        limit_states.append({
            'name': 'Weld Metal (J2.5)',
            'Rn': round(Pn_weld, 3),
            'phi': 0.60,
            'omega': 2.55,
            'formula': f'Pn = 0.75×tw({tw:.4f})×{L}×{Fxx}×{n_welds} = {Pn_weld:.3f}',
            'equation': 'J2.5-7',
        })

    # 설계강도 계산
    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    return {
        'connection_type': 'fillet_weld',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J2.5'],
    }


# ============================================================
# 아크 스팟 용접 (J2.2.1)
# ============================================================

def arc_spot_weld_connection(t1: float, t2: float,
                             da: float, Fy: float, Fu: float,
                             Fxx: float = 60,
                             n: int = 1,
                             design_method: str = 'LRFD',
                             E: float = E_STEEL) -> dict:
    """아크 스팟 용접 (퍼들 용접) 접합 설계 (§J2.2.2.1)

    Args:
        t1, t2: 연결판 두께 (in)
        da: 용접 가시(visible) 직경 d (in) — 외부 표면 직경
        Fy, Fu: 모재 강도 (ksi)
        Fxx: 용접봉 강도 (ksi)
        n: 용접점 개수
        E: 강재 탄성계수 (ksi)
    Note:
        입력 da 는 가시 직경 d 로 취급한다. 평균직경 da_avg = d - t (Eq. J2.2.2.1).
    """
    d_vis = da  # 가시 직경 d
    # t: 전단 전달면 위 시트의 총 기재 두께. 단일 시트는 시트 두께(보수적으로 t_min).
    t_min = min(t1, t2)
    da_avg = max(d_vis - t_min, 0.0)  # 평균직경 (Eq. J2.2.2.1)
    limit_states = []

    # 유효 직경 de = 0.7d - 1.5t <= 0.55d (Eq. J2.2.2.1-5)
    de = min(max(0.7 * d_vis - 1.5 * t_min, 0.0), 0.55 * d_vis)

    # (a) 용접 너겟 전단 (Eq. J2.2.2.1-1): Pnv = (π de²/4)·0.75·Fxx, φ=0.60/Ω=2.55
    Ae_weld = math.pi / 4 * de ** 2
    Rn_weld = 0.75 * Fxx * Ae_weld * n
    limit_states.append({
        'name': 'Weld Nugget Shear (J2.2.2.1)',
        'Rn': round(Rn_weld, 3),
        'phi': 0.60,
        'omega': 2.55,
        'formula': f'Pnv = 0.75×{Fxx}×π/4×de({de:.3f})²×{n} = {Rn_weld:.3f}',
        'equation': 'J2.2.2.1-1',
    })

    # (b) 모재 전단/인열 (Eq. J2.2.2.1-2/-3/-4) — da/t 슬렌더니스 분기
    lam = math.sqrt(E / Fu) if Fu > 0 else float('inf')
    dt = da_avg / t_min if t_min > 0 else float('inf')
    if dt <= 0.815 * lam:  # Eq. J2.2.2.1-2
        Rn_tear = 2.20 * t_min * da_avg * Fu * n
        phi_t, omega_t, eq_t = 0.70, 2.20, 'J2.2.2.1-2'
    elif dt < 1.397 * lam:  # Eq. J2.2.2.1-3
        Rn_tear = 0.280 * (1.0 + 5.59 * math.sqrt(lam / dt)) * t_min * da_avg * Fu * n
        phi_t, omega_t, eq_t = 0.55, 2.80, 'J2.2.2.1-3'
    else:  # Eq. J2.2.2.1-4
        Rn_tear = 1.40 * t_min * da_avg * Fu * n
        phi_t, omega_t, eq_t = 0.50, 3.05, 'J2.2.2.1-4'
    limit_states.append({
        'name': 'Sheet Tear (J2.2.2.1)',
        'Rn': round(Rn_tear, 3),
        'phi': phi_t,
        'omega': omega_t,
        'formula': f'Pnv (da/t={dt:.2f}, 0.815λ={0.815*lam:.2f}, 1.397λ={1.397*lam:.2f}) = {Rn_tear:.3f}',
        'equation': eq_t,
    })

    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    return {
        'connection_type': 'arc_spot_weld',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J2.2.2.1'],
    }


# ============================================================
# 그루브 용접 (J2.1 Butt-Joint, J2.6 Flare Groove)
# ============================================================

def groove_weld_connection(t1: float, t2: float,
                           weld_length: float,
                           Fy: float, Fu: float,
                           Fxx: float = 60,
                           groove_type: str = 'complete',
                           design_method: str = 'LRFD',
                           load_direction: str = 'tension',
                           te: float = None,
                           w1: float = None, w2: float = None,
                           R: float = None, h: float = None,
                           process: str = None) -> dict:
    """그루브 용접 접합 설계

    버트조인트 그루브 용접은 §J2.1, 플레어 그루브 용접은 §J2.6 을 적용한다.
    (AISI S100-16: 그루브 용접은 J2.1, 플레어 그루브는 J2.6 — 과거 'J2.3' 라벨은 오기)

    Args:
        t1, t2: 연결판 두께 (in)
        weld_length: 용접 길이 L (in)
        Fy, Fu: 모재 항복/인장강도 (ksi)
        Fxx: 용접봉 강도 (ksi)
        groove_type: 'complete'(CJP) | 'partial'(PJP) | 'flare_bevel' | 'flare_v'
        load_direction: 'tension'|'compression'|'shear' (J2.1) /
                        'transverse'|'longitudinal' (J2.6 플레어)
        te: 유효 목두께 (in, J2.1). None이면 CJP는 t_min, PJP는 0.5·t_min(추정)으로 가정.
        w1, w2: 플레어 그루브 용접 레그 (in, J2.6-5)
        R: 굽힘 외측 반경 (in, J2.6-5)
        h: 립 높이 (in, J2.6 longitudinal 분기 h<L 판정)
        process: 용접 프로세스 (Table J2.6-1/-2 twf/η 선택) — 미구현 시 보수 추정
    """
    t_min = min(t1, t2)
    limit_states = []
    warnings = []

    flare = str(groove_type).lower().startswith('flare')

    if not flare:
        # --- §J2.1 Groove Welds in Butt Joints ---
        # 유효 목두께 te: CJP는 모재 두께, PJP는 입력값 또는 0.5·t 추정(비-코드 traceable)
        if te is None:
            if groove_type == 'complete':
                te = t_min  # CJP: 유효목두께 = 모재 두께
            else:
                te = 0.5 * t_min  # PJP: 실 유효목두께 입력 부재 시 보수 추정
                warnings.append(
                    '§J2.1 PJP: 유효 목두께 te 미입력 — te=0.5·t 추정값 사용 '
                    '(코드 traceable 아님; 실제 용접 디테일로 te 산정 필요)')
        L = weld_length
        sval = str(load_direction).lower()
        if sval.startswith('shear'):
            # J2.1(b): 전단 = min(J2.1-2, J2.1-3)
            Rn_2 = L * te * 0.6 * Fxx     # Eq. J2.1-2 (용접금속 전단)
            Rn_3 = L * te * Fy / math.sqrt(3.0)  # Eq. J2.1-3 (모재 전단)
            if Rn_2 / 1.90 <= Rn_3 / 1.70:  # ASD 가용강도 기준 지배 판정
                Rn_g, phi_g, omega_g, eq_g = Rn_2, 0.80, 1.90, 'J2.1-2'
            else:
                Rn_g, phi_g, omega_g, eq_g = Rn_3, 0.90, 1.70, 'J2.1-3'
            limit_states.append({
                'name': 'Groove Weld Shear (J2.1)',
                'Rn': round(Rn_g, 3),
                'phi': phi_g,
                'omega': omega_g,
                'formula': f'Pn = min(L·te·0.6Fxx, L·te·Fy/√3) = {Rn_g:.3f} (te={te:.4f})',
                'equation': eq_g,
            })
        else:
            # J2.1(a): 인장/압축 = L·te·Fy (Eq. J2.1-1), φ=0.90/Ω=1.70
            Rn_g = L * te * Fy
            limit_states.append({
                'name': 'Groove Weld Tension/Compression (J2.1)',
                'Rn': round(Rn_g, 3),
                'phi': 0.90,
                'omega': 1.70,
                'formula': f'Pn = L({L})×te({te:.4f})×Fy({Fy}) = {Rn_g:.3f}',
                'equation': 'J2.1-1',
            })
    else:
        # --- §J2.6 Flare Groove Welds ---
        t = t_min  # 용접 부재 두께 (Fig. J2.6-1..3)
        L = weld_length
        # 유효 목두께 tw (Eq. J2.6-5 플레어 베벨). w1,w2,R 입력 시 산정, 미입력 시 추정.
        if w1 is not None and w2 is not None and R is not None and w1 > 0:
            # 보수적: twf≈0, η≈0 (Table J2.6-1/-2 미구현 — 플러시 채움 가정 하한)
            wf = math.sqrt(w1 ** 2 + w2 ** 2)  # Eq. J2.6-6 face width
            tw = (w2 - R + math.sqrt(max(2.0 * R * w1 - w1 ** 2, 0.0))) * (w1 / wf)
            tw = max(tw, 0.0)
            tw_note = f'tw(J2.6-5)={tw:.4f}'
        else:
            tw = 0.707 * t  # 레그/반경 미입력 시 보수 추정 (코드 traceable 아님)
            tw_note = f'tw≈0.707t={tw:.4f} (추정)'
            warnings.append(
                '§J2.6 플레어 그루브: 레그(w1,w2)/반경(R) 미입력 — '
                'tw≈0.707t 추정값 사용 (Eq. J2.6-5/-7 미적용)')
        sval = str(load_direction).lower()
        if sval.startswith('trans'):
            # (a) 플레어 베벨, 횡방향 하중 (Eq. J2.6-1)
            Pnv = 0.833 * t * L * Fu
            phi_f, omega_f, eq_f = 0.60, 2.55, 'J2.6-1'
        else:
            # (b) 종방향 하중: tw>=2t & h>=L 이면 J2.6-3, 아니면 J2.6-2
            if tw >= 2.0 * t and (h is not None and h >= L):
                Pnv = 1.50 * t * L * Fu      # Eq. J2.6-3
                eq_f = 'J2.6-3'
            else:
                Pnv = 0.75 * t * L * Fu      # Eq. J2.6-2
                eq_f = 'J2.6-2'
            phi_f, omega_f = 0.55, 2.80
        # (c) t>0.10 in 이면 용접금속 한계 Eq. J2.6-4 로 상한
        if t > 0.10:
            Pn_cap = 0.75 * tw * L * Fxx
            if Pn_cap < Pnv:
                Pnv = Pn_cap
                eq_f = f'{eq_f}≤J2.6-4'
                phi_f, omega_f = 0.60, 2.55
        limit_states.append({
            'name': 'Flare Groove Shear (J2.6)',
            'Rn': round(Pnv, 3),
            'phi': phi_f,
            'omega': omega_f,
            'formula': f'Pnv = {Pnv:.3f} ({tw_note}, t={t})',
            'equation': eq_f,
        })

    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    result = {
        'connection_type': 'groove_weld',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J2.6'] if flare else ['J2.1'],
    }
    if warnings:
        result['warnings'] = warnings
    return result


# ============================================================
# 아크 시임 용접 (J2.2.2)
# ============================================================

def arc_seam_weld_connection(t1: float, t2: float,
                              d: float, L_seam: float,
                              Fy: float, Fu: float,
                              Fxx: float = 60,
                              n: int = 1,
                              design_method: str = 'LRFD') -> dict:
    """아크 시임 용접 접합 설계 (§J2.2.2)

    Args:
        t1, t2: 연결판 두께 (in)
        d: 용접 너비 (in)
        L_seam: 시임 용접 길이 (in)
        Fy, Fu: 모재 강도 (ksi)
        Fxx: 용접봉 강도 (ksi)
        n: 용접선 수
    """
    t_min = min(t1, t2)
    limit_states = []

    # 유효 너비
    de = min(max(0.7 * d - 1.5 * t_min, 0.0), 0.55 * d)

    # (a) 용접부 전단 (J2.2.2.1)
    # Rn = 0.75 × Fxx × (L×de + π/4 × de²) per seam
    Ae_weld = L_seam * de + math.pi / 4 * de ** 2
    Rn_weld = 0.75 * Fxx * Ae_weld * n
    limit_states.append({
        'name': 'Weld Seam Shear (J2.2.2.1)',
        'Rn': round(Rn_weld, 3),
        'phi': 0.60,
        'omega': 2.50,
        'formula': f'Rn = 0.75×{Fxx}×({L_seam}×{de:.3f}+π/4×{de:.3f}²)×{n} = {Rn_weld:.3f}',
        'equation': 'J2.2.2.1',
    })

    # (b) 모재 인열 (J2.2.2.1)
    Rn_tear = 2.5 * t_min * Fu * (0.25 * L_seam + 0.96 * d) * n
    limit_states.append({
        'name': 'Sheet Tear (J2.2.2.1)',
        'Rn': round(Rn_tear, 3),
        'phi': 0.60,
        'omega': 2.50,
        'formula': f'Rn = 2.5×{t_min}×{Fu}×(0.25×{L_seam}+0.96×{d})×{n} = {Rn_tear:.3f}',
        'equation': 'J2.2.2.1-2',
    })

    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    return {
        'connection_type': 'arc_seam',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J2.2.2'],
    }


# ============================================================
# PAF 화약작동 체결재 (J5)
# ============================================================

# PAF φ and Ω (S100-16 §J5)
PHI_PAF = {'pin_shear': 0.60, 'bearing': 0.80, 'pullout_shear': 0.60,
           'pullout_tension': 0.40, 'pullover': 0.50}
OMEGA_PAF = {'pin_shear': 2.65, 'bearing': 2.05, 'pullout_shear': 2.55,
             'pullout_tension': 4.00, 'pullover': 3.00}

# PAF 기재응력 파라미터 Fh (J5.3.3) 및 경화강 인장강도 Fuh (J5.2.1)
PAF_FH = 66.0     # ksi (base stress parameter, J5.3.3)
PAF_FUH = 120.0   # ksi (hardened PAF tensile strength, J5.2.1 'Hb')


def paf_connection(t1: float, t2: float, d: float,
                   Fy: float, Fu: float, Fuf: float,
                   n: int = 1,
                   design_method: str = 'LRFD',
                   Fy2: float = None, Fu1: float = None,
                   dar: float = None, dw: float = None,
                   Pnot_test: float = None,
                   e: float = None,
                   Ag: float = None, width: float = None) -> dict:
    """화약작동 체결재(PAF) 접합 설계 (§J5 + §J6)

    Args:
        t1: PAF 머리/와셔와 접촉하는 부재 두께 (in)
        t2: PAF 머리/와셔와 접촉하지 않는 (far) 부재 두께 (in)
        d: PAF 핀 직경 ds (in)
        Fy, Fu: t1(머리측) 부재 강도 (ksi). Fu1 미지정 시 Fu 사용.
        Fuf: (미사용 보존) — 핀 전단은 Fuh(경화강)로 계산
        n: 체결재 개수
        Fy2: far member 항복강도 (ksi, J5.3.3). None이면 Fy 사용.
        Fu1: 머리측 부재 인장강도 (ksi). None이면 Fu.
        dar: 평균 매입직경 d_ar (in, J5.3.3). None이면 d 사용.
        dw: 풀오버 d'w (in, J5.2.3). None이면 보수 추정.
        Pnot_test: J5.2.2 인장 풀아웃 시험값 (kips). 없으면 해당 한계상태 플래그.
        e: 끝단 거리 (in). None이면 0.5 in (Table J5.1-1 최소).
        Ag, width: J6 순단면 평가용 (선택)
    """
    if Fy2 is None:
        Fy2 = Fy
    if Fu1 is None:
        Fu1 = Fu
    if dar is None:
        dar = d
    if e is None:
        e = 0.5  # Table J5.1-1 최소 edge distance (ds<0.200)

    limit_states = []
    warnings = []

    # (a) 핀 전단 (J5.3.1, Eq. J5.3.1-1): Pnvp = 0.6·(d/2)²·π·Fuh, φ=0.60/Ω=2.65
    Pns = 0.6 * (d / 2.0) ** 2 * math.pi * PAF_FUH * n
    limit_states.append({
        'name': 'Pin Shear (J5.3.1)',
        'Rn': round(Pns, 3),
        'phi': PHI_PAF['pin_shear'],
        'omega': OMEGA_PAF['pin_shear'],
        'formula': f'Pnvp = 0.6×(d/2)²π×Fuh({PAF_FUH})×{n} = {Pns:.3f}',
        'equation': 'J5.3.1-1',
    })

    # (b) 지압/tilting (J5.3.2, Eq. J5.3.2-1): Pnb = αb·ds·t1·Fu1, αb=3.2, φ=0.80/Ω=2.05
    Pnf = 3.2 * d * t1 * Fu1 * n
    limit_states.append({
        'name': 'Bearing/Tilting (J5.3.2)',
        'Rn': round(Pnf, 3),
        'phi': PHI_PAF['bearing'],
        'omega': OMEGA_PAF['bearing'],
        'formula': f'Pnb = 3.2×ds({d})×t1({t1})×Fu1({Fu1})×{n} = {Pnf:.3f}',
        'equation': 'J5.3.2-1',
    })

    # (c) 전단 풀아웃 (J5.3.3, Eq. J5.3.3-1):
    #     Pnos = dar^1.8·t2^0.2·(Fy2·Fh²)^(1/3)/30, φ=0.60/Ω=2.55
    Pnos = (dar ** 1.8) * (t2 ** 0.2) * ((Fy2 * PAF_FH ** 2) ** (1.0 / 3.0)) / 30.0 * n
    limit_states.append({
        'name': 'Pull-out in Shear (J5.3.3)',
        'Rn': round(Pnos, 3),
        'phi': PHI_PAF['pullout_shear'],
        'omega': OMEGA_PAF['pullout_shear'],
        'formula': f'Pnos = dar^1.8·t2^0.2·(Fy2·Fh²)^(1/3)/30 ×{n} = {Pnos:.3f}',
        'equation': 'J5.3.3-1',
    })

    # (d) 풀오버 (J5.2.3, Eq. J5.2.3-1): Pnov = αw·t1·d'w·Fu1, αw=1.5, φ=0.50/Ω=3.00
    # d'w(=dw) = 머리/와셔의 실제 접촉 직경 (J5.2.3 정의). 와셔 직경 <=0.875 in (§J5).
    # αw=1.5 (단순 플랫헤드/단순 PAF). 테이퍼/스프링와셔(1.25/2.0) 변형은 별도 입력 필요.
    if dw is None:
        # 실제 머리/와셔 직경 미입력 시 d'w≈2.5·ds 추정 (코드 traceable 아님).
        dw = min(d * 2.5, 0.875)
        warnings.append(
            '§J5.2.3 풀오버: 머리/와셔 실제 직경 d\'w 미입력 — d\'w≈2.5·ds 추정값 사용 '
            '(<=0.875 in 한계). 실제 머리/와셔 직경으로 d\'w 지정 권장.')
    else:
        dw = min(dw, 0.875)  # 실제 d'w, 와셔 직경 한계 적용
    Pnov = 1.5 * t1 * dw * Fu1 * n
    limit_states.append({
        'name': 'Pull-over (J5.2.3)',
        'Rn': round(Pnov, 3),
        'phi': PHI_PAF['pullover'],
        'omega': OMEGA_PAF['pullover'],
        'formula': f'Pnov = 1.5×t1({t1})×d\'w({dw:.3f})×Fu1({Fu1})×{n} = {Pnov:.3f}',
        'equation': 'J5.2.3-1',
    })

    # (e) 인장 풀아웃 (J5.2.2): 폐쇄형 식 없음 — 시험값 필요. φ=0.40/Ω=4.00.
    if Pnot_test is not None and Pnot_test > 0:
        limit_states.append({
            'name': 'Pull-out in Tension (J5.2.2)',
            'Rn': round(Pnot_test * n, 3),
            'phi': PHI_PAF['pullout_tension'],
            'omega': OMEGA_PAF['pullout_tension'],
            'formula': f'Pnot = (시험값 {Pnot_test})×{n} = {Pnot_test * n:.3f}',
            'equation': 'J5.2.2 (test)',
        })
    else:
        warnings.append(
            'J5.2.2 인장 풀아웃 미평가: 폐쇄형 식 없음 — 독립 시험값(Pnot_test) 필요 '
            '(φ=0.40, Ω=4.00). 인장(uplift) 작용 시 별도 시험 검토 필요.')

    # (f) J6 순단면/블록전단 (J5.3.4): 구멍=1.10·ds, 나사/PAF 계수(Table J6-1)
    t_crit = min(t1, t2)
    dh = 1.10 * d  # J5.3.4
    j6_ls, j6_warn = _j6_rupture_limit_states(
        conn='paf', Fu=Fu1, t=t_crit, dh=dh, n=n, e=e,
        Ag=Ag, width=width, d=d, include_block_shear=False)
    limit_states.extend(j6_ls)
    warnings.extend(j6_warn)

    for ls in limit_states:
        if design_method == 'LRFD':
            ls['design_strength'] = round(ls['phi'] * ls['Rn'], 3)
        else:
            ls['design_strength'] = round(ls['Rn'] / ls['omega'], 3)

    governing = min(limit_states, key=lambda x: x['design_strength'])
    governing['governs'] = True

    result = {
        'connection_type': 'paf',
        'limit_states': limit_states,
        'governing_mode': governing['name'],
        'design_strength': governing['design_strength'],
        'Rn': governing['Rn'],
        'spec_sections': ['J5.2.3', 'J5.3.1', 'J5.3.2', 'J5.3.3', 'J6.1', 'J6.2'],
    }
    if warnings:
        result['warnings'] = warnings
        result['j6_verified'] = False
    else:
        result['j6_verified'] = True
    return result


# ============================================================
# 디스패처
# ============================================================

def design_connection(params: dict) -> dict:
    """접합부 설계 디스패처"""
    conn_type = params.get('connection_type', 'bolt')
    design_method = params.get('design_method', 'LRFD')
    Fy = params.get('Fy', 35.53)
    Fu = params.get('Fu', 58.02)
    t1 = params.get('t1', 0.059)
    t2 = params.get('t2', t1)
    Pu = params.get('Pu', 0)

    if conn_type == 'bolt':
        result = bolt_connection(
            t1=t1, t2=t2,
            d=params.get('d', 0.5),
            Fy=Fy, Fu=Fu,
            Fub=params.get('Fub', 120),
            e=params.get('e'),
            s=params.get('s'),
            n=int(params.get('n', 1)),
            design_method=design_method,
            bolt_grade=params.get('bolt_grade'),
            threads_excluded=bool(params.get('threads_excluded', False)),
            mf=params.get('mf'),
            hole_type=params.get('hole_type', 'standard'),
            pattern_length=params.get('pattern_length'),
            Ag=params.get('Ag'), width=params.get('width'),
            g=params.get('g'), s_pitch=params.get('s_pitch'),
            Vu=params.get('Vu'), Tu=params.get('Tu'),
            member_tension=bool(params.get('member_tension', False)),
            Ae=params.get('Ae'),
        )
    elif conn_type == 'screw':
        result = screw_connection(
            t1=t1, t2=t2,
            d=params.get('d', 0.190),
            Fy=Fy, Fu=Fu,
            Fub=params.get('Fub', 100),
            n=int(params.get('n', 1)),
            design_method=design_method,
            Fu1=params.get('Fu1'), Fu2=params.get('Fu2'),
            tc=params.get('tc'), dw=params.get('dw'),
            e=params.get('e'),
            Ag=params.get('Ag'), width=params.get('width'),
            g=params.get('g'),
            member_tension=bool(params.get('member_tension', False)),
            Ae=params.get('Ae'),
        )
    elif conn_type == 'fillet_weld':
        result = fillet_weld_connection(
            t1=t1, t2=t2,
            weld_size=params.get('weld_size', 0.125),
            weld_length=params.get('weld_length', 1.0),
            Fy=Fy, Fu=Fu,
            Fxx=params.get('Fxx', 60),
            n_welds=int(params.get('n', 1)),
            design_method=design_method,
            load_direction=params.get('load_direction', 'longitudinal'),
            Fu1=params.get('Fu1'), Fu2=params.get('Fu2'),
            w1=params.get('w1'), w2=params.get('w2'),
        )
    elif conn_type == 'arc_spot':
        result = arc_spot_weld_connection(
            t1=t1, t2=t2,
            da=params.get('da', params.get('d', 0.625)),
            Fy=Fy, Fu=Fu,
            Fxx=params.get('Fxx', 60),
            n=int(params.get('n', 1)),
            design_method=design_method,
            E=params.get('E', E_STEEL),
        )
    elif conn_type == 'groove':
        result = groove_weld_connection(
            t1=t1, t2=t2,
            weld_length=params.get('weld_length', 1.0),
            Fy=Fy, Fu=Fu,
            Fxx=params.get('Fxx', 60),
            groove_type=params.get('groove_type', 'complete'),
            design_method=design_method,
            load_direction=params.get('load_direction', 'tension'),
            te=params.get('te'),
            w1=params.get('w1'), w2=params.get('w2'),
            R=params.get('R'), h=params.get('h'),
            process=params.get('process'),
        )
    elif conn_type == 'arc_seam':
        result = arc_seam_weld_connection(
            t1=t1, t2=t2,
            d=params.get('da', params.get('d', 0.625)),
            L_seam=params.get('weld_length', params.get('L_seam', 1.0)),
            Fy=Fy, Fu=Fu,
            Fxx=params.get('Fxx', 60),
            n=int(params.get('n', 1)),
            design_method=design_method,
        )
    elif conn_type == 'paf':
        result = paf_connection(
            t1=t1, t2=t2,
            d=params.get('d', 0.145),
            Fy=Fy, Fu=Fu,
            Fuf=params.get('Fuf', params.get('Fub', 60)),
            n=int(params.get('n', 1)),
            design_method=design_method,
            Fy2=params.get('Fy2'), Fu1=params.get('Fu1'),
            dar=params.get('dar'), dw=params.get('dw'),
            Pnot_test=params.get('Pnot_test'),
            e=params.get('e'),
            Ag=params.get('Ag'), width=params.get('width'),
        )
    else:
        return {'error': f'Unknown connection_type: {conn_type}'}

    # 활용비
    if Pu > 0 and result.get('design_strength', 0) > 0:
        util = Pu / result['design_strength']
        result['utilization'] = round(util, 4)
        result['pass'] = util <= 1.0
    else:
        result['utilization'] = None
        result['pass'] = None

    result['member_type'] = 'connection'
    result['design_method'] = design_method
    return result
