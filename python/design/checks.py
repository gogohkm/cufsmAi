"""검토 항목(design_checks) 계약 — 등록표와 만드는 도구.

설계 결과마다 `design_checks` 목록을 덧붙인다. 항목 하나가 한 한계상태(또는 상호작용 ·
상세 · 적용 조건)이고, 고정 id · 조항 · 식 · 이름(영/한) · 소요 / 설계강도 · 판정 · 계산 과정
(steps)을 싣는다. 계약 문서: docs/implementation/20261123-check-contract.md.

원칙
- id 는 표시 문구와 무관하게 이 파일의 REGISTRY 에서만 정한다.
- steps 의 값은 계산이 실제로 쓴 변수 그대로다(같은 자리에서 만든다 — 다시 계산하지 않는다).
- 단위는 엔진 내부 US(kip, in, ksi)이고 값마다 quantity 를 붙인다. 숫자를 꾸미거나 바꾸지 않는다.
- 판정: fail > not_evaluated > pass. not_applicable 은 판정을 끌어내리지 않는다(FIXES §3.1).
"""

import math

# ---------------------------------------------------------------- 어휘

VERDICTS = ('pass', 'fail', 'not_evaluated', 'not_applicable')

# 계산 과정 한 단계의 종류
STEP_KINDS = (
    'yield',             # 항복 강도(Py, My, Vy, Ag·Fy …)
    'elastic_buckling',  # 탄성 좌굴값(Fcre, Pcrl, Mcrd, Vcr …)과 그 출처
    'slenderness',       # 세장비 λ
    'branch',            # 식의 갈래 — condition, holds, equation
    'equation',          # 강도식 · 중간량의 계산
    'modifier',          # 보정(β, Cb, R, B1, Usl, 냉간가공 Fya, 상한 …)
    'demand',            # 소요강도(입력 · 하중 해석)
    'design_strength',   # φRn 또는 Rn/Ω
    'verdict',           # 소요/설계강도 비와 판정
)

# 값의 물리량 종류와 엔진 내부 US 단위(경계층이 SI 로 바꿀 때 쓴다)
QUANTITIES = {
    'force': 'kip',
    'moment': 'kip-in',
    'stress': 'ksi',
    'length': 'in',
    'area': 'in^2',
    'section_modulus': 'in^3',
    'moment_of_inertia': 'in^4',
    'torsion_constant': 'in^4',
    'warping_constant': 'in^6',
    'force_per_length': 'kip/in',
    'rotational_stiffness': 'kip-in/rad/in',
    'dimensionless': '-',
    'angle': 'deg',
    'count': '-',
}

# 단계 입력의 출처
SOURCE_KINDS = (
    'step',               # 같은 검토의 앞 단계 결과 — {'kind': 'step', 'step': i}
    'check',              # 다른 검토 항목의 결과 — {'kind': 'check', 'id': ...}
    'section_property',   # 단면 성질(props · section). generated=True 면 템플릿 자동 생성
    'material',           # 재료 강도(Fy, Fu …) — 입력
    'buckling_analysis',  # 좌굴 해석(FSM) 또는 그 대체 — method · half_wavelength · label
    'load_analysis',      # 하중 해석이 준 소요강도(호출자가 check_combination 을 준 경우)
    'user_input',         # 사용자가 준 설계 입력(길이, Cb, 지압 길이, 소요강도 …)
    'engine_default',     # 입력이 없어 엔진이 채운 값(경고 · 가정에 밝힌 것)
    'specification',      # 기준이 정한 상수 · 계수 · 표값(φ, Ω, 표 G5 행, E, G …)
)

# 좌굴값 출처의 method
BUCKLING_METHODS = (
    'fsm_minimum',                 # FSM 서명곡선의 극소(국부 · 뒤틀림)
    'fsm_single_minimum',          # 극소가 하나뿐인 곡선에서 이 모드로 배정된 값
    'analytic',                    # 부록 1 · 2 해석식(엔진이 계산)
    'analytic_raised_to_floor',    # 해석식이 곡선 하한보다 낮아 하한으로 올린 값(§4.1)
    'closed_form',                 # 전체 좌굴 폐형식(§E2 · §F2)
    'user_supplied',               # 사용자가 준 Fcre(합리적 해석)
)

# ---------------------------------------------------------------- 등록표
# 이름(name · name_ko)은 이 표 한 곳에만 둔다 — 화면 · MCP 는 여기서 받아 쓴다(2026-11-23 오케스트레이터가
# 표를 그대로 채택). 'member.flexure.global' 의 「횡좌굴」은 승인된 화면 시안의 말이다. 기준의 정식 용어는
# 「횡비틀림좌굴」(lateral-torsional buckling)이며, 바꾸려면 이 표의 name_ko 하나만 고치면 된다.

def _r(clause, equations, name, name_ko, group):
    return {'clause': clause, 'equations': list(equations), 'name': name, 'name_ko': name_ko,
            'group': group}


REGISTRY = {
    # ---- 부재 (Chapters B, D – I)
    'member.applicability.b4': _r('B4.1', ('Table B4.1-1',),
                                  'Dimensional limits for Chapters E–H factors', '적용 한계 (표 B4.1-1)',
                                  'member.applicability'),
    'member.tension.yielding': _r('D2', ('D2-1',), 'Yielding of gross section', '총단면 항복',
                                  'member.tension'),
    'member.tension.rupture': _r('D3', ('D3-1',), 'Rupture of net section', '순단면 파단', 'member.tension'),
    'member.compression.global': _r('E2', ('E2-1', 'E2-2', 'E2-3', 'E2-4', 'E2.1-1', 'E2.2-1', 'E2.2-3',
                                           'E2.2-5'),
                                    'Yielding and global buckling', '항복 및 전체 좌굴', 'member.compression'),
    'member.compression.local': _r('E3.2.1', ('E3.2.1-1', 'E3.2.1-2', 'E3.2.1-3'),
                                   'Local buckling', '국부 좌굴', 'member.compression'),
    'member.compression.distortional': _r('E4.1', ('E4.1-1', 'E4.1-2', 'E4.1-3', 'E4.1-4'),
                                          'Distortional buckling', '뒤틀림 좌굴', 'member.compression'),
    'member.flexure.global': _r('F2', ('F2.1-1', 'F2.1-3', 'F2.1-4', 'F2.1-5', 'F2.1.1-1', 'F2.1.3-1',
                                       'F2.1.4-1', 'F2.1.4-2', 'F2.3-1', 'F2.4.2-1'),
                                'Yielding and lateral-torsional buckling', '항복 및 횡좌굴', 'member.flexure'),
    'member.flexure.local': _r('F3.2.1', ('F3.2.1-1', 'F3.2.1-2', 'F3.2.1-3', 'F3.2.3-1'),
                               'Local buckling', '국부 좌굴', 'member.flexure'),
    'member.flexure.distortional': _r('F4.1', ('F4.1-1', 'F4.1-2', 'F4.1-3', 'F4.1-4', 'F4.3-1'),
                                      'Distortional buckling', '뒤틀림 좌굴', 'member.flexure'),
    'member.flexure.uplift_r': _r('I6.2.1', ('I6.2.1-1',),
                                  'Flexure of through-fastened C/Z under uplift (R factor)',
                                  '관통 체결 C·Z 양력 휨 (R 계수)', 'member.flexure'),
    'member.flexure.positive_region': _r('F2', ('F2.1-1', 'F3.2.1-2', 'F4.1-2'),
                                         'Flexure, positive-moment region', '정모멘트 구간 휨',
                                         'member.flexure_positive'),
    'member.shear': _r('G2.1', ('G2.1-1', 'G2.1-2a', 'G2.1-3a', 'G2.1-4', 'G2.1-5', 'G2.3-1', 'G2.3-2'),
                       'Shear', '전단', 'member.shear'),
    'member.web_crippling': _r('G5', ('G5-1', 'G5-2'), 'Web crippling', '웹 크리플링',
                               'member.web_crippling'),
    'member.bending_shear': _r('H2', ('H2-1', 'H2-2'), 'Combined bending and shear', '휨 + 전단',
                               'member.bending_shear'),
    'member.bending_web_crippling': _r('H3', ('H3-1a', 'H3-1b', 'H3-2a', 'H3-2b', 'H3-3a', 'H3-3b'),
                                       'Combined bending and web crippling', '휨 + 웹 크리플링',
                                       'member.bending_web_crippling'),
    'member.axial_bending': _r('H1.2', ('H1.2-1', 'C1.2.1.1-3', 'C1.2.1.1-4'),
                               'Combined compressive axial load and bending', '압축 + 휨',
                               'member.axial_bending'),
    'member.tension_bending.flange_yield': _r('H1.1', ('H1.1-1', 'H1.1-3a', 'H1.1-3b'),
                                              'Combined tension and bending — tension flange yielding',
                                              '인장 + 휨 (인장 플랜지 항복)', 'member.tension_bending'),
    'member.tension_bending.buckling': _r('H1.1', ('H1.1-2',),
                                          'Combined tension and bending — compression flange buckling',
                                          '인장 + 휨 (압축 측 좌굴)', 'member.tension_bending'),

    # ---- 접합부 (Chapter J, App. A J3.4, Chapter D 캡)
    'conn.bolt.bearing': _r('J3.3.1', ('J3.3.1-1',), 'Bolt bearing', '볼트 지압', 'conn.shear'),
    'conn.bolt.bearing_deformation': _r('J3.3.2', ('J3.3.2-1',), 'Bolt bearing with hole deformation',
                                        '볼트 지압 (구멍 변형 고려)', 'conn.shear'),
    'conn.bolt.shear': _r('J3.4', ('J3.4-1',), 'Bolt shear', '볼트 전단', 'conn.shear'),
    'conn.bolt.tension': _r('J3.4', ('J3.4-1',), 'Bolt tension', '볼트 인장', 'conn.tension'),
    'conn.bolt.pullover': _r('J3.4', (), 'Sheet pull-over at bolt head', '볼트 머리 풀오버',
                             'conn.tension'),
    'conn.bolt.shear_tension': _r('J3.4', ('J3.4-2', 'J3.4-3'), "Bolt tension with reduced F'nt (shear + tension)",
                                  '볼트 전단 + 인장', 'conn.interaction'),
    'conn.screw.bearing_tilting': _r('J4.3.1', ('J4.3.1-1', 'J4.3.1-2', 'J4.3.1-3', 'J4.3.1-4', 'J4.3.1-5'),
                                     'Screw bearing / tilting', '나사 지압 · 틸팅', 'conn.shear'),
    'conn.screw.shear': _r('J4.3.2', (), 'Screw shear', '나사 전단', 'conn.shear'),
    'conn.screw.pullout': _r('J4.4.1', ('J4.4.1-1',), 'Screw pull-out', '나사 뽑힘 (풀아웃)', 'conn.tension'),
    'conn.screw.pullover': _r('J4.4.2', ('J4.4.2-1', 'J4.4.2-2'), 'Screw pull-over', '나사 머리 풀오버',
                              'conn.tension'),
    'conn.screw.tension': _r('J4.4.3', (), 'Screw tension', '나사 인장', 'conn.tension'),
    'conn.screw.shear_pullover': _r('J4.5.1', ('J4.5.1-1a', 'J4.5.1-1b', 'C-J4.5.1-1'),
                                    'Combined shear and pull-over', '전단 + 풀오버', 'conn.interaction'),
    'conn.screw.shear_pullout': _r('J4.5.2', ('J4.5.2-1a', 'J4.5.2-1b', 'C-J4.5.1-1'),
                                   'Combined shear and pull-out', '전단 + 풀아웃', 'conn.interaction'),
    'conn.screw.shear_tension': _r('J4.5.3', ('J4.5.3-1a', 'J4.5.3-1b'),
                                   'Combined shear and tension in screws', '나사 전단 + 인장', 'conn.interaction'),
    'conn.fillet.sheet': _r('J2.5', ('J2.5-1', 'J2.5-2', 'J2.5-3', 'J2.5-4', 'J2.5-5', 'J2.5-6'),
                            'Fillet weld — sheet strength', '필릿 용접 — 판 강도', 'conn.shear'),
    'conn.fillet.weld': _r('J2.5', ('J2.5-7',), 'Fillet weld — weld metal', '필릿 용접 — 용접 금속',
                           'conn.shear'),
    'conn.arc_spot.weld_shear': _r('J2.2.2.1', ('J2.2.2.1-1',), 'Arc spot weld — weld shear',
                                   '아크 스폿 용접 — 용접 전단', 'conn.shear'),
    'conn.arc_spot.sheet_tear': _r('J2.2.2.1', ('J2.2.2.1-2', 'J2.2.2.1-3', 'J2.2.2.1-4'),
                                   'Arc spot weld — sheet tearing', '아크 스폿 용접 — 판 찢김', 'conn.shear'),
    'conn.arc_spot.sheet_to_sheet': _r('J2.2.2.2', ('J2.2.2.2-1', 'J2.2.2.2-2'),
                                       'Arc spot weld — sheet-to-sheet shear', '아크 스폿 용접 — 판-판 전단',
                                       'conn.shear'),
    'conn.arc_spot.tension': _r('J2.2.3', ('J2.2.3-1', 'J2.2.3-2'), 'Arc spot weld — tension',
                                '아크 스폿 용접 — 인장', 'conn.tension'),
    'conn.arc_spot.shear_tension': _r('J2.2.4', ('J2.2.4-1',), 'Arc spot weld — combined shear and tension',
                                      '아크 스폿 용접 — 전단 + 인장', 'conn.interaction'),
    'conn.arc_seam.weld_shear': _r('J2.3.2.1', ('J2.3.2.1-1',), 'Arc seam weld — weld shear',
                                   '아크 심 용접 — 용접 전단', 'conn.shear'),
    'conn.arc_seam.sheet_tear': _r('J2.3.2.1', ('J2.3.2.1-2',), 'Arc seam weld — sheet tearing',
                                   '아크 심 용접 — 판 찢김', 'conn.shear'),
    'conn.arc_seam.sheet_to_sheet': _r('J2.3.2.2', ('J2.3.2.2-1', 'J2.3.2.2-2'),
                                       'Arc seam weld — sheet-to-sheet shear', '아크 심 용접 — 판-판 전단',
                                       'conn.shear'),
    'conn.groove.shear': _r('J2.1', ('J2.1-2', 'J2.1-3'), 'Groove weld in butt joint — shear',
                            '맞대기 그루브 용접 — 전단', 'conn.shear'),
    'conn.groove.tension_compression': _r('J2.1', ('J2.1-1',), 'Groove weld in butt joint — tension/compression',
                                          '맞대기 그루브 용접 — 인장 · 압축', 'conn.shear'),
    'conn.flare_groove.shear': _r('J2.6', ('J2.6-1', 'J2.6-2', 'J2.6-3', 'J2.6-4'),
                                  'Flare groove weld — shear', '플레어 그루브 용접 — 전단', 'conn.shear'),
    'conn.paf.pin_shear': _r('J5.3.1', ('J5.3.1-1',), 'PAF shear (pin)', 'PAF 전단 (핀)', 'conn.shear'),
    'conn.paf.bearing_tilting': _r('J5.3.2', ('J5.3.2-1',), 'PAF bearing / tilting', 'PAF 지압 · 틸팅',
                                   'conn.shear'),
    'conn.paf.pullout_shear': _r('J5.3.3', ('J5.3.3-1',), 'PAF pull-out in shear', 'PAF 전단 뽑힘',
                                 'conn.shear'),
    'conn.paf.tension': _r('J5.2.1', ('J5.2.1-1', 'J5.2.1-2'), 'PAF tension (pin)', 'PAF 인장 (핀)',
                           'conn.tension'),
    'conn.paf.pullout_tension': _r('J5.2.2', (), 'PAF pull-out in tension', 'PAF 인장 뽑힘',
                                   'conn.tension'),
    'conn.paf.pullover': _r('J5.2.3', ('J5.2.3-1',), 'PAF pull-over', 'PAF 머리 풀오버', 'conn.tension'),
    'conn.paf.shear_tension': _r('J5.4', ('C-J5.4-1',), 'PAF combined shear and tension', 'PAF 전단 + 인장',
                                 'conn.interaction'),
    'conn.j6.shear_rupture': _r('J6.1', ('J6.1-1', 'J6.1-2'), 'Shear rupture', '전단 파단', 'conn.shear'),
    'conn.j6.tension_rupture': _r('J6.2', ('J6.2-1', 'J6.2-3', 'J6.2-4', 'J6.2-5', 'J6.2-6', 'J6.2-7',
                                           'J6.2-8'),
                                  'Tension rupture of net section (shear lag)', '순단면 인장 파단 (전단 지연)',
                                  'conn.shear'),
    'conn.j6.block_shear': _r('J6.3', ('J6.3-1', 'J6.3-2'), 'Block shear rupture', '블록 전단 파단',
                              'conn.shear'),
    'conn.j6.shear_rupture.part2': _r('J6.1', ('J6.1-1', 'J6.1-2'), 'Shear rupture — second part',
                                      '전단 파단 — 두 번째 판', 'conn.shear'),
    'conn.j6.tension_rupture.part2': _r('J6.2', ('J6.2-1',), 'Tension rupture — second part',
                                        '순단면 인장 파단 — 두 번째 판', 'conn.shear'),
    'conn.j6.block_shear.part2': _r('J6.3', ('J6.3-1', 'J6.3-2'), 'Block shear rupture — second part',
                                    '블록 전단 파단 — 두 번째 판', 'conn.shear'),
    'conn.j6.inputs': _r('J6', (), 'Rupture checks — required geometry', '파단 검토 — 필요한 기하',
                         'conn.shear'),
    'conn.member.tension_yield': _r('D2', ('D2-1',), 'Connected member — tension yielding',
                                    '접합 부재 — 총단면 항복', 'conn.shear'),
    'conn.member.tension_rupture': _r('D3', ('D3-1',), 'Connected member — tension rupture',
                                      '접합 부재 — 순단면 파단', 'conn.shear'),
    'conn.member.tension': _r('D2', ('D2-1', 'D3-1'), 'Connected member — tension (Chapter D)',
                              '접합 부재 — 인장 (D 장)', 'conn.shear'),
    'conn.scope': _r('J1', (), 'Scope of Chapter J (thickness, fastener size)', '적용 범위 (두께 · 패스너 지름)',
                     'conn.scope'),
    'conn.shear_strength': _r('J1', (), 'In-plane shear strength (any verified limit state)',
                              '면내 전단 강도 (평가된 한계상태)', 'conn.scope'),
    'conn.tension_strength': _r('J1', (), 'Out-of-plane tension strength (any verified limit state)',
                                '축방향 인장 강도 (평가된 한계상태)', 'conn.scope'),
    'conn.out_of_plane_tension': _r('J1', (), 'Out-of-plane tension of this connection type',
                                    '면외 인장 (이 접합 유형)', 'conn.tension'),
    'conn.shear_tension': _r('J1', (), 'Combined shear and tension (not implemented for this type)',
                             '전단 + 인장 (이 유형은 미구현)', 'conn.interaction'),
    'conn.weld.min_effective_diameter': _r('J2.2', (), 'Arc spot weld — minimum effective diameter',
                                           '아크 스폿 용접 — 최소 유효 지름', 'conn.detailing'),
    'conn.weld.pjp_throat': _r('J2.1', (), 'Partial-joint-penetration groove — effective throat',
                               '부분 용입 그루브 — 유효 목두께', 'conn.shear'),
    'conn.flare_groove.transverse_v': _r('J2.6', (), 'Flare V-groove — transverse load', '플레어 V 그루브 — 횡하중',
                                         'conn.shear'),
    'conn.flare_groove.weld_metal_cap': _r('J2.6', ('J2.6-4',), 'Flare groove — weld metal cap',
                                           '플레어 그루브 — 용접 금속 상한', 'conn.shear'),
    'conn.paf.fastener_strength': _r('J5.2.1', (), 'PAF steel strength F_uh', 'PAF 강도 F_uh', 'conn.scope'),
    'conn.detail.bolt_end_distance': _r('J3.2', (), 'Bolt end distance e ≥ 1.5d', '볼트 끝단 거리 e ≥ 1.5d',
                                        'conn.detailing'),
    'conn.detail.bolt_hole_to_end': _r('J3.2', (), 'Bolt hole edge to end ≥ d', '볼트 구멍 가장자리 → 끝단 ≥ d',
                                       'conn.detailing'),
    'conn.detail.bolt_edge_distance': _r('J3.2', (), 'Bolt edge distance ≥ 1.5d', '볼트 연단 거리 ≥ 1.5d',
                                         'conn.detailing'),
    'conn.detail.bolt_spacing': _r('J3.1', (), 'Bolt spacing s ≥ 3d', '볼트 간격 s ≥ 3d', 'conn.detailing'),
    'conn.detail.bolt_clear_spacing': _r('J3.1', (), 'Clear distance between bolt holes ≥ 2d',
                                         '볼트 구멍 순간격 ≥ 2d', 'conn.detailing'),
    'conn.detail.screw_end_distance': _r('J4.2', (), 'Screw end distance e ≥ 1.5d', '나사 끝단 거리 e ≥ 1.5d',
                                         'conn.detailing'),
    'conn.detail.screw_spacing': _r('J4.1', (), 'Screw spacing ≥ 3d', '나사 간격 ≥ 3d', 'conn.detailing'),
    'conn.detail.weld_end_distance': _r('J2.2.1', (), 'Arc spot weld centre to end ≥ 1.5d',
                                        '아크 스폿 용접 중심 → 끝단 ≥ 1.5d', 'conn.detailing'),
    'conn.detail.weld_clear_end': _r('J2.2.1', (), 'Arc spot weld edge to end ≥ 1.0d',
                                     '아크 스폿 용접 → 끝단 순거리 ≥ 1.0d', 'conn.detailing'),
    'conn.detail.weld_clear_spacing': _r('J2.2.1', (), 'Clear distance between arc spot welds ≥ 1.0d',
                                         '아크 스폿 용접 사이 순거리 ≥ 1.0d', 'conn.detailing'),
    'conn.detail.seam_end_distance': _r('J2.3.1', (), 'Arc seam weld centre to end ≥ 1.5d',
                                        '아크 심 용접 중심 → 끝단 ≥ 1.5d', 'conn.detailing'),
    'conn.detail.seam_clear_end': _r('J2.3.1', (), 'Arc seam weld edge to end ≥ 1.0d',
                                     '아크 심 용접 → 끝단 순거리 ≥ 1.0d', 'conn.detailing'),
    'conn.detail.paf_edge_distance': _r('J5.1', ('Table J5.1-1',), 'PAF edge distance', 'PAF 연단 거리',
                                        'conn.detailing'),
    'conn.detail.paf_spacing': _r('J5.1', ('Table J5.1-1',), 'PAF spacing', 'PAF 간격', 'conn.detailing'),

    # ---- 랩 접합 (패스너 힘 분배는 사내 합리적 해석 §A1.2(c))
    'lap.fastener_group': _r('A1.2(c)', (), 'Lap fasteners — transfer force (in-house rational model)',
                             '랩 패스너 — 전달력 (사내 합리적 해석)', 'lap.fasteners'),
    'lap.fastener_count': _r('A1.2(c)', (), 'Lap fasteners — required number fits in the lap',
                             '랩 패스너 — 필요 개수 배치', 'lap.fasteners'),
    'lap.fastener_spacing': _r('J3.1', (), 'Lap fasteners — spacing ≥ 3d', '랩 패스너 — 간격 ≥ 3d',
                               'lap.fasteners'),
    'lap.length_condition': _r('I6.2.1', ('I6.2.1(g)',), 'Lap length ≥ 1.5d each side (applicability condition)',
                               '랩 길이 ≥ 1.5d (적용 조건)', 'lap.condition'),
    'lap.flexure.local': _r('F3.1', ('F3.1-1',), 'Lap flexure — two members, Se·Fy', '랩 구간 휨 (2겹, Se·Fy)',
                            'lap.flexure'),
    'lap.flexure.distortional': _r('F4.1', ('F4.1-2',), 'Lap flexure — distortional, two members',
                                   '랩 구간 뒤틀림 좌굴 (2겹)', 'lap.flexure'),
    'lap.bending_shear': _r('H2', ('H2-1',), 'Lap combined bending and shear', '랩 구간 휨 + 전단',
                            'lap.flexure'),
    'lap.block_shear': _r('J6.3', ('J6.3-1', 'J6.3-2'), 'Lap fasteners — block shear rupture of the fastener group',
                          '랩 패스너 무리 — 블록 전단 파단', 'lap.fasteners'),
}

# 접합부 limit_states / not_evaluated / interaction / detailing 의 엔진 이름 → id.
# 이름의 ' [part 2]' 꼬리는 conn.j6.*.part2 로 간다.
_CONN_NAME_IDS = {
    'Bearing (J3.3.1)': 'conn.bolt.bearing',
    'Bearing w/ Hole Deformation (J3.3.2)': 'conn.bolt.bearing_deformation',
    'Bolt Shear (J3.4)': 'conn.bolt.shear',
    'Bolt Tension (J3.4)': 'conn.bolt.tension',
    'Sheet Pull-over at Bolt Head (App. A J3.4)': 'conn.bolt.pullover',
    "Bolt tension with F'nt (App. A J3.4)": 'conn.bolt.shear_tension',
    '전단-인장 상호작용 (App. A J3.4)': 'conn.bolt.shear_tension',
    'Bearing/Tilting (J4.3.1)': 'conn.screw.bearing_tilting',
    'Screw Shear (J4.3.2)': 'conn.screw.shear',
    'Pull-out (J4.4.1)': 'conn.screw.pullout',
    'Pull-over (J4.4.2)': 'conn.screw.pullover',
    'Screw Tension (J4.4.3)': 'conn.screw.tension',
    '전단+풀오버 (J4.5.1)': 'conn.screw.shear_pullover',
    '전단+풀아웃 (J4.5.2)': 'conn.screw.shear_pullout',
    '나사 전단+인장 (J4.5.3)': 'conn.screw.shear_tension',
    'Sheet Strength (J2.5)': 'conn.fillet.sheet',
    'Weld Metal (J2.5)': 'conn.fillet.weld',
    'Weld Nugget Shear (J2.2.2.1)': 'conn.arc_spot.weld_shear',
    'Sheet Tear (J2.2.2.1)': 'conn.arc_spot.sheet_tear',
    'Sheet Tear Sheet-to-Sheet (J2.2.2.2)': 'conn.arc_spot.sheet_to_sheet',
    'Weld Tension (J2.2.3)': 'conn.arc_spot.tension',
    '전단+인장 (J2.2.4)': 'conn.arc_spot.shear_tension',
    'Weld Seam Shear (J2.3.2.1)': 'conn.arc_seam.weld_shear',
    'Sheet Tear (J2.3.2.1)': 'conn.arc_seam.sheet_tear',
    'Sheet Tear Sheet-to-Sheet (J2.3.2.2)': 'conn.arc_seam.sheet_to_sheet',
    'Groove Weld Shear (J2.1)': 'conn.groove.shear',
    'Groove Weld Tension/Compression (J2.1)': 'conn.groove.tension_compression',
    'Groove Weld (J2.1) PJP 목두께': 'conn.weld.pjp_throat',
    'Flare Groove Shear (J2.6)': 'conn.flare_groove.shear',
    'Flare V-Groove Transverse (J2.6)': 'conn.flare_groove.transverse_v',
    'Flare Groove (J2.6-4) 용접금속 상한': 'conn.flare_groove.weld_metal_cap',
    'Pin Shear (J5.3.1)': 'conn.paf.pin_shear',
    'Bearing/Tilting (J5.3.2)': 'conn.paf.bearing_tilting',
    'Pull-out in Shear (J5.3.3)': 'conn.paf.pullout_shear',
    'Pull-over (J5.2.3)': 'conn.paf.pullover',
    'PAF Tension (J5.2.1)': 'conn.paf.tension',
    'Pull-out in Tension (J5.2.2)': 'conn.paf.pullout_tension',
    '전단+인장 (J5.4)': 'conn.paf.shear_tension',
    'PAF 강도 F_uh (J5.2.1)': 'conn.paf.fastener_strength',
    'Shear Rupture (J6.1)': 'conn.j6.shear_rupture',
    'Tension Rupture (J6.2)': 'conn.j6.tension_rupture',
    'Block Shear (J6.3)': 'conn.j6.block_shear',
    'J6 파단': 'conn.j6.inputs',
    'J6.1/J6.3': 'conn.j6.inputs',
    'J6': 'conn.j6.inputs',
    'Member Tension Yield (D2)': 'conn.member.tension_yield',
    'Member Tension Rupture (D3)': 'conn.member.tension_rupture',
    'Member Tension (D2/D3)': 'conn.member.tension',
    '면외 인장': 'conn.out_of_plane_tension',
    '전단(면내) 강도': 'conn.shear_strength',
    '인장(축방향) 강도': 'conn.tension_strength',
    '전단+인장 조합': 'conn.shear_tension',
    '최소 유효직경 (J2.2)': 'conn.weld.min_effective_diameter',
    '끝단 거리 e ≥ 1.5d (J3.2)': 'conn.detail.bolt_end_distance',
    '끝단 거리 (J3.2)': 'conn.detail.bolt_end_distance',
    '구멍 가장자리 → 끝단 ≥ d (J3.2)': 'conn.detail.bolt_hole_to_end',
    '연단 거리 ≥ 1.5d (J3.2)': 'conn.detail.bolt_edge_distance',
    '볼트 간격 s ≥ 3d (J3.1)': 'conn.detail.bolt_spacing',
    '볼트 간격 (J3.1)': 'conn.detail.bolt_spacing',
    '구멍 순간격 ≥ 2d (J3.1)': 'conn.detail.bolt_clear_spacing',
    '끝단 거리 e ≥ 1.5d (J4.2)': 'conn.detail.screw_end_distance',
    '끝단 거리 (J4.2)': 'conn.detail.screw_end_distance',
    '나사 간격 ≥ 3d (J4.1)': 'conn.detail.screw_spacing',
    '나사 간격 (J4.1)': 'conn.detail.screw_spacing',
    '용접 중심 → 끝단 ≥ 1.5d (J2.2.1)': 'conn.detail.weld_end_distance',
    '끝단 거리 (J2.2.1)': 'conn.detail.weld_end_distance',
    '용접 → 끝단 순거리 ≥ 1.0d (J2.2.1)': 'conn.detail.weld_clear_end',
    '용접 사이 순거리 ≥ 1.0d (J2.2.1)': 'conn.detail.weld_clear_spacing',
    '시임 중심 → 끝단 ≥ 1.5d (J2.3.1)': 'conn.detail.seam_end_distance',
    '끝단 거리 (J2.3.1)': 'conn.detail.seam_end_distance',
    '시임 → 끝단 순거리 ≥ 1.0d (J2.3.1)': 'conn.detail.seam_clear_end',
    '연단 거리 (Table J5.1-1)': 'conn.detail.paf_edge_distance',
    'PAF 간격 (Table J5.1-1)': 'conn.detail.paf_spacing',
}

_PART2 = ' [part 2]'


def connection_check_id(name: str) -> str | None:
    """엔진의 한계상태 · 미평가 · 상세 이름 → 등록 id. 모르는 이름은 None(시험이 잡는다)."""
    s = str(name or '')
    part2 = s.endswith(_PART2)
    if part2:
        s = s[:-len(_PART2)]
    if s.startswith('적용범위 ('):
        return 'conn.scope'
    if s.endswith(' — A1.2(c) 직선식'):
        s = s[:-len(' — A1.2(c) 직선식')]
    base = _CONN_NAME_IDS.get(s)
    if base is None:
        return None
    if part2:
        p2 = base + '.part2'
        return p2 if p2 in REGISTRY else (base if base == 'conn.j6.inputs' else None)
    return base


# ---------------------------------------------------------------- 값 · 단계 · 항목

def _num(v):
    """JSON 엄격 규칙: 유한하지 않은 실수는 None. numpy 스칼라는 파이썬 수로."""
    if v is None or isinstance(v, bool):
        return v
    if hasattr(v, 'item') and getattr(v, 'ndim', 1) == 0:
        v = v.item()
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def q(symbol: str, value, quantity: str, source: dict | None = None, **extra) -> dict:
    """{symbol, value, quantity[, source]} — 값은 계산이 쓴 그 변수(꾸미지 않음)."""
    if quantity not in QUANTITIES:
        raise ValueError(f'unknown quantity {quantity!r}')
    out = {'symbol': symbol, 'value': _num(value), 'quantity': quantity}
    if source is not None:
        out['source'] = source
    for k, v in extra.items():
        if v is not None:
            out[k] = v
    return out


def src(kind: str, **detail) -> dict:
    if kind not in SOURCE_KINDS:
        raise ValueError(f'unknown source kind {kind!r}')
    out = {'kind': kind}
    for k, v in detail.items():
        if v is not None:
            out[k] = _num(v) if not isinstance(v, (dict, list, str)) else v
    return out


def spec() -> dict:
    return {'kind': 'specification'}


class Trace:
    """한 검토 항목의 계산 과정. add() 가 단계 번호를 돌려주고, ref() 가 그 결과를 다음 단계의 입력으로 쓴다."""

    def __init__(self):
        self.steps = []

    def add(self, kind: str, expr: str | None = None, *, equation: str | None = None,
            inputs=(), result: dict | None = None, **extra) -> int:
        if kind not in STEP_KINDS:
            raise ValueError(f'unknown step kind {kind!r}')
        step = {'kind': kind, 'expr': expr, 'equation': equation,
                'inputs': [i for i in inputs if i is not None], 'result': result}
        for k, v in extra.items():
            if v is not None:
                step[k] = v
        self.steps.append(step)
        return len(self.steps) - 1

    def ref(self, i: int, symbol: str | None = None) -> dict:
        """앞 단계 i 의 결과를 입력으로(같은 값 · 같은 물리량, 출처 = 그 단계)."""
        r = self.steps[i]['result']
        out = {'symbol': symbol or r['symbol'], 'value': r['value'], 'quantity': r['quantity'],
               'source': {'kind': 'step', 'step': i}}
        if r.get('unbounded'):
            out['unbounded'] = True
        return out

    def branch(self, condition: str, holds: bool, equation: str | None, inputs=(), **extra) -> int:
        return self.add('branch', None, equation=equation, inputs=inputs, result=None,
                        condition=condition, holds=bool(holds), **extra)


def factor(design_method: str, phi, omega, phi_symbol='φ', omega_symbol='Ω') -> dict:
    """설계 방법에 맞는 계수 하나(φ 또는 Ω)."""
    if design_method == 'LRFD':
        return {'symbol': phi_symbol, 'value': _num(phi), 'kind': 'phi', 'source': spec()}
    return {'symbol': omega_symbol, 'value': _num(omega), 'kind': 'omega', 'source': spec()}


def design_strength_step(tr: Trace, design_method: str, nominal_ref: dict, phi, omega, value,
                         cap_symbol: str, quantity: str, *, rounded_to=None,
                         phi_symbol='φ', omega_symbol='Ω') -> int:
    """설계강도 단계 — value 는 엔진이 만든 그 설계강도(φRn 또는 Rn/Ω)."""
    if design_method == 'LRFD':
        expr = f'{cap_symbol} = {phi_symbol} {nominal_ref["symbol"]}'
        f = q(phi_symbol, phi, 'dimensionless', spec())
    else:
        expr = f'{cap_symbol} = {nominal_ref["symbol"]} / {omega_symbol}'
        f = q(omega_symbol, omega, 'dimensionless', spec())
    return tr.add('design_strength', expr, inputs=[nominal_ref, f],
                  result=q(cap_symbol, value, quantity), rounded_to=rounded_to)


def make_check(cid: str, *, design_method: str | None, verdict: str, demand: dict | None = None,
               capacity: dict | None = None, nominal: dict | None = None, factor_: dict | None = None,
               ratio=None, reason: str | None = None, steps: list | None = None,
               steps_unavailable: str | None = None, location=None, combination=None,
               mirrors: dict | None = None, reference: dict | None = None, counts: bool = True,
               trusted: bool | None = None, group: str | None = None, **extra) -> dict:
    """등록표에서 조항 · 식 · 이름을 채운 검토 항목 하나."""
    if cid not in REGISTRY:
        raise KeyError(f'check id {cid!r} is not registered')
    if verdict not in VERDICTS:
        raise ValueError(f'unknown verdict {verdict!r}')
    reg = REGISTRY[cid]
    if verdict == 'not_evaluated':
        # 평가하지 못한 항목에 소요/설계강도 · 비를 지어 넣지 않는다 — 참고값은 reference 로만.
        capacity = None
        ratio = None
    out = {
        'id': cid,
        'group': group or reg['group'],
        'clause': reg['clause'],
        'equations': list(reg['equations']),
        'name': reg['name'],
        'name_ko': reg['name_ko'],
        'design_method': design_method,
        'demand': demand,
        'nominal': nominal if verdict != 'not_evaluated' else None,
        'factor': factor_ if verdict != 'not_evaluated' else None,
        'capacity': capacity,
        'ratio': _num(ratio),
        'verdict': verdict,
        'reason': reason,
        'governs': False,
        'counts': bool(counts),
        'location': location,
        'combination': combination,
        'steps': list(steps or []),
    }
    if not out['steps']:
        out['steps_unavailable'] = steps_unavailable or (
            reason if verdict in ('not_evaluated', 'not_applicable') else 'no trace')
    if mirrors and verdict == 'not_evaluated':
        # 평가하지 못한 항목은 값이 reference 에만 있다 — 거기 있는 것만 대조한다.
        mirrors = {k: v for k, v in mirrors.items() if k == 'demand' or (reference or {}).get(k) is not None}
    if mirrors and verdict != 'not_applicable':
        out['mirrors'] = mirrors
    if reference:
        out['reference'] = reference
    if trusted is not None:
        out['trusted'] = bool(trusted)
    for k, v in extra.items():
        if v is not None:
            out[k] = v
    return out


def ratio_of(demand_value, capacity_value):
    """엔진과 같은 식: 소요 / 설계강도. 소요가 없거나 0 이면 None, 강도 0 이면 None(무한)."""
    if demand_value is None or capacity_value is None:
        return None
    if demand_value <= 0:
        return None
    if capacity_value <= 0:
        return None
    return demand_value / capacity_value


def verdict_from(ratio, *, trusted: bool = True, limit: float = 1.0) -> str:
    """평가한 비로 판정: 넘으면 fail. 믿을 수 없는 값(가정 입력 · 의심스러운 좌굴값)은
    넘을 때만 fail, 아니면 not_evaluated(엔진의 '불합격이 이긴다' 규칙과 같다)."""
    if ratio is None:
        return 'not_evaluated'
    if ratio > limit:
        return 'fail'
    return 'pass' if trusted else 'not_evaluated'


def verdict_step(tr: Trace, demand_ref: dict, cap_ref: dict, ratio, verdict: str, limit=1.0) -> int:
    return tr.add('verdict', f'{demand_ref["symbol"]} / {cap_ref["symbol"]} ≤ {limit:g}',
                  inputs=[demand_ref, cap_ref], result=q('ratio', ratio, 'dimensionless'),
                  verdict=verdict)


def set_governing(checks: list, preferred: dict | None = None) -> None:
    """무리(group)마다 지배 항목 하나에 governs=True 와 그 까닭 governs_basis (계약 §4, 2026-11-24 V6-03).

    무리의 상태가 지배를 정한다 — fail > not_evaluated > pass 와 같은 순서:
    - 'fail'          판정에 드는 불합격이 있으면: 그 가운데 비가 가장 큰 것.
    - 'not_evaluated' 불합격은 없고 판정에 드는 미평가가 있으면: 그 미평가 항목(참고 비가 가장 큰 것,
                      참고 비가 없으면 참고 설계강도가 가장 작은 것, 그것도 없으면 엔진 순서). 이때
                      평가한 항목 가운데 비가 가장 큰 것은 highest_evaluated {id, ratio, verdict} 로 따로 싣는다
                      — 미평가가 무리의 상태인데 평가한 낮은 비가 '지배'로 읽히지 않게.
    - 'ratio'         모두 평가했으면: 비가 가장 큰 것(같으면 preferred[group] = 엔진이 고른 지배 모드).
    - 'capacity'      평가한 항목에 비가 없으면(소요 0 등): 설계강도가 가장 작은 것.
    """
    preferred = preferred or {}
    groups = {}
    for c in checks:
        groups.setdefault(c['group'], []).append(c)

    def _pick(cands, key, g):
        top = max(key(c) for c in cands)
        tied = [c for c in cands if key(c) == top]
        return next((c for c in tied if c['id'] == preferred.get(g)), tied[0])

    for g, items in groups.items():
        for c in items:
            c['governs'] = False
            c.pop('governs_basis', None)
            c.pop('highest_evaluated', None)
        ev = [c for c in items if c['verdict'] in ('pass', 'fail') and c['ratio'] is not None]
        fails = [c for c in ev if c['verdict'] == 'fail' and c.get('counts', True)]
        ne = [c for c in items if c['verdict'] == 'not_evaluated' and c.get('counts', True)]
        pick, basis = None, None
        if fails:
            pick, basis = _pick(fails, lambda c: c['ratio'], g), 'fail'
        elif ne:
            def _ref(c, k):
                v = (c.get('reference') or {}).get(k)
                return v.get('value') if isinstance(v, dict) else v
            with_ratio = [c for c in ne if _ref(c, 'ratio') is not None]
            with_cap = [c for c in ne if _ref(c, 'capacity') is not None]
            if with_ratio:
                pick = _pick(with_ratio, lambda c: _ref(c, 'ratio'), g)
            elif with_cap:
                pick = _pick(with_cap, lambda c: -_ref(c, 'capacity'), g)
            else:
                pick = next((c for c in ne if c['id'] == preferred.get(g)), ne[0])
            basis = 'not_evaluated'
            if ev:
                top = _pick(ev, lambda c: c['ratio'], g)
                pick['highest_evaluated'] = {'id': top['id'], 'ratio': top['ratio'], 'verdict': top['verdict']}
            else:
                pick['highest_evaluated'] = None
        elif ev:
            pick, basis = _pick(ev, lambda c: c['ratio'], g), 'ratio'
        else:
            caps = [c for c in items if c.get('capacity') and c['capacity'].get('value') is not None
                    and c['verdict'] != 'not_applicable']
            if caps:
                pick, basis = _pick(caps, lambda c: -c['capacity']['value'], g), 'capacity'
        if pick is not None:
            pick['governs'] = True
            pick['governs_basis'] = basis


def overall_verdict(checks: list) -> str:
    """fail > not_evaluated > pass. 판정에 드는(counts) 항목만. 아무것도 평가하지 못했으면 not_evaluated."""
    vs = [c['verdict'] for c in checks if c.get('counts', True)]
    if 'fail' in vs:
        return 'fail'
    if 'not_evaluated' in vs:
        return 'not_evaluated'
    if 'pass' in vs:
        return 'pass'
    return 'not_evaluated'


# 검토 항목에 그대로 붙이는 꼬리표 입력(설계 값을 바꾸지 않는다) — 경계층이 MCP 스키마에 열 때까지
# 접합부의 _KNOWN_KEYS 에는 넣지 않는다(V4-05 호스트 ↔ 스키마 대조가 아직 이 키를 모른다).
CONTEXT_KEYS = ('check_location', 'check_combination')


def apply_context(checks: list, params: dict) -> None:
    """호출자가 준 위치 · 조합(check_location · check_combination)을 항목에 붙인다(값은 그대로)."""
    loc = params.get('check_location')
    combo = params.get('check_combination')
    for c in checks:
        if loc is not None and c.get('location') is None:
            c['location'] = loc
        if combo is not None and c.get('combination') is None:
            c['combination'] = combo


def demand_source(params: dict, key: str) -> dict:
    """소요강도의 출처: 호출자가 하중 조합을 밝혔으면 하중 해석, 아니면 사용자 입력."""
    if params.get('check_combination') is not None:
        return src('load_analysis', key=key, combination=params.get('check_combination'))
    return src('user_input', key=key)


# ---------------------------------------------------------------- 표시용 반올림 (§8.3.1 수정 3–6 뒤)
# 결과의 이 키들은 사람이 읽도록 반올림해 실은 값이다. 판정 · 비 · 지배 모드와 design_checks 의 값은
# 모두 반올림하지 않은 값으로 정한다(2026-11-23). 경로의 [] 는 목록의 모든 원소, * 는 그 dict 의 모든 수.
DISPLAY_ROUNDING = {
    'member': {
        'decimals': {
            'Pn': 2, 'Pne': 2, 'Pnl': 2, 'Pnd': 2, 'Py': 2, 'phi_Pn': 2, 'Pn_omega': 2, 'design_strength': 2,
            'Mn': 2, 'Mn_dsm': 2, 'Mne': 2, 'Mnl': 2, 'Mnd': 2, 'My': 2, 'phi_Mn': 2, 'Mn_omega': 2, 'Mnfo': 2,
            'Fy_used': 2, 'Fy_original': 2, 'Tn': 2, 'Tn_yield': 2, 'Tn_rupture': 2, 'An_used': 4,
            'Maxt': 2, 'Mayt': 2, 'compression.*': 2, 'flexure_x.*': 2, 'flexure_y.*': 2, 'tension.*': 2,
            'utilization': 4, 'limit_state_checks[].ratio': 4, 'interaction.*': 4,
            'shear.Vn': 2, 'shear.Vn_per_web': 2, 'shear.design_strength': 2, 'shear.Vu': 2,
            'shear_interaction.*': 4, 'shear_interaction.Malo': 2, 'shear_interaction.Mnlo': 2,
            'web_crippling.Pn': 2, 'web_crippling.design_strength': 3, 'web_crippling.P': 3,
            'web_crippling.load': 3, 'web_crippling.ratio': 4, 'h3_interaction.*': 4,
            'positive_region.utilization': 4, 'positive_region.*': 2, 'amplification.alpha_x': 4,
            'amplification.alpha_y': 4, 'amplification.*': 2, 'Fcre_detail.*': '2–4',
        },
        'note': 'display only — verdicts, ratios and design_checks use unrounded values',
    },
    'connection': {
        'decimals': {
            'limit_states[].Rn': 3, 'limit_states[].design_strength': 3, 'Rn': 3, 'design_strength': 3,
            'shear_design_strength': 3, 'tension_design_strength': 3, 'shear_verified_design_strength': 3,
            'tension_verified_design_strength': 3, 'checks[].demand': 4, 'checks[].ratio': 4,
            'utilization': 4, 'utilization_reference': 4, 'interaction_checks[].value': 4,
            'interaction_checks[].limit': 4, 'interaction_checks[].ratio': 4, 'detailing_checks[].provided': 4,
            'detailing_checks[].required': 4, 'demands.*': 4, 'shear_tension_interaction.*': '2–4',
        },
        'note': 'display only — the governing mode, verdicts, ratios and design_checks use unrounded values',
    },
    'lap': {
        'decimals': {
            'Pns': 3, 'utilization': 4, 'fastener_utilization': 4, 'flexure_dcr': 4, 'flexure_dcr_governing': 4, 'flexure_reference_dcr': 4,
            'Mn_lap': 2, 'phi_Mn_lap': 2, 'Vn_used': 3, 'steps[].value': '2–3',
        },
        'note': 'display only — verdicts, ratios and design_checks use unrounded values (capacity, V_transfer, '
                'spacing are unrounded)',
    },
}


def display_rounding(kind: str) -> dict:
    d = DISPLAY_ROUNDING[kind]
    return {'decimals': dict(d['decimals']), 'note': d['note']}
