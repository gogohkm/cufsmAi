"""2026-11-24 — 재확인 V8 (docs/reviews/20261122-engine-review/verify/V8-milestone1-recheck.md) 의 엔진 쪽 수정.

V8-01: 랩 도구가 구간 설계와 같은 계약(§6.3)을 따른다 — 진술이 있으면 준 Mnd 와 무관하게 뒤틀림 해당 없음,
       맨 위 utilization 은 랩 강도 항목의 지배 비. V8-04: 엔진 결과가 BLAS 스레드 수에 기대지 않는다.
각 시험은 c223b80 의 엔진에서 실패한다.
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'python'))
sys.path.insert(0, HERE)

from design.aisi_s100 import design_member  # noqa: E402
from design.lap_connection import design_lap_connection, LAP_STRENGTH_CHECKS  # noqa: E402

ZP = dict(A=0.822, Sf=1.94, rx=3.04, ry=0.83, ro=3.17, J=0.000954, Cw=11.3, xo=0.0, I22=0.25, t=0.059, R=0.1875)
Z8 = dict(type='Z', depth=8.0, flange_width=2.25, lip_depth=0.91, thickness=0.059, r=0.1875)
# II-2A 첫 안쪽 지점의 랩(재확인 V8 의 b_lap_wiring.js 와 같은 입력): Mu 8.75 kip-ft, Vu 1.78, 볼트 ½ in 2열
LAP = dict(d=8.0, t=0.059, Fy=55.0, Fu=70.0, lap_left_in=30.0, lap_right_in=42.0, Mu_support=8.75 * 12,
           Vu_support=1.78, fastener_type='bolt', fastener_dia=0.5, n_rows=2, design_method='ASD', Vn=3.89)


def _c(r, cid):
    return [c for c in r['design_checks'] if c['id'] == cid][0]


def test_V8_01_stated_lap_tool_ignores_the_supplied_Mnd():
    """진술이 있으면 §F4 는 해당 없음 — 호스트가 지배 구간의 Mnd(76.83)를 보내도(전에는 1.141 불합격)."""
    r = design_lap_connection(dict(LAP, Se=0.2311, Mnd=76.83, lap_restrained=True))
    d = _c(r, 'lap.flexure.distortional')
    assert d['verdict'] == 'not_applicable', d['verdict']
    assert d['restraint_source'] == {'kind': 'user_input', 'key': 'lap_restrained'}
    assert any('Mnd = 76.83 kip-in is not used' in w for w in r['warnings'])
    # 진술이 없으면 준 Mnd 로 평가한다(구간 설계: 준 Mcrd 로 평가) — 판정은 그 값의 것
    u = design_lap_connection(dict(LAP, Se=0.2311, Mnd=76.83))
    assert _c(u, 'lap.flexure.distortional')['verdict'] == 'fail'


def test_V8_01_lap_tool_and_lap_region_give_the_same_local_ratio():
    """Se = (랩 구간의 Mnℓ, Fn = Fy)/Fy 이면 랩 도구(두 부재, Mu)의 국부 비 = 랩 구간(부재 하나, Mu/2)의 국부 비.
    II-2A 첫 안쪽 지점: Mnℓ 85.9 kip-in → Se 1.562, 105 / (2·85.9/1.67) = 1.0207 (퍼린의 lap-1 구간 1.0207)."""
    r = design_lap_connection(dict(LAP, Se=85.9 / 55.0, lap_restrained=True))
    lo = _c(r, 'lap.flexure.local')
    assert abs(lo['ratio'] - 105.0 / (2 * 85.9 / 1.67)) <= 1e-12 and round(lo['ratio'], 4) == 1.0207
    assert _c(r, 'lap.flexure.distortional')['verdict'] == 'not_applicable'
    # 같은 단면 · 같은 진술의 구간 설계(호스트가 부르는 꼴, 부재당 Mu/2)에서 Se 를 읽어 넘기면 비가 같다
    reg = design_member(dict(member_type='flexure', design_method='ASD', Fy=55.0, Fu=70, section_type='Z',
                             props=dict(ZP), section=dict(Z8), moment_sign='-', lap_region=True, lap_restrained=True,
                             dsm=dict(Mcrl=91.0, Mcrd=101.0, Lcrd=20.8, M_sign='-'), Mu=105.0 / 2, Vu=1.78 / 2))
    rl = _c(reg, 'member.flexure.local')
    t = design_lap_connection(dict(LAP, Se=rl['nominal']['value'] / 55.0, lap_restrained=True))
    assert abs(_c(t, 'lap.flexure.local')['ratio'] - rl['ratio']) <= 1e-12
    assert _c(reg, 'member.flexure.distortional')['verdict'] == 'not_applicable'


def test_V8_01_unstated_lap_tool_matches_the_unstated_region():
    """진술 없음 · 사람이 준 강도 없음: 국부 휨은 판정 없음(1 을 넘으면 불합격), 뒤틀림은 판정 없음 — 구간과 같다."""
    r = design_lap_connection(dict(LAP, Se=2.25))
    assert _c(r, 'lap.flexure.local')['verdict'] == 'not_evaluated'
    assert _c(r, 'lap.flexure.distortional')['verdict'] == 'not_evaluated'
    assert r['pass'] is None


def test_V8_01_top_level_utilization_is_the_governing_lap_strength_ratio():
    r = design_lap_connection(dict(LAP, Se=0.2311, lap_restrained=True))
    ev = [c for c in r['design_checks'] if c['id'] in LAP_STRENGTH_CHECKS and c['verdict'] in ('pass', 'fail')]
    gov = max(ev, key=lambda c: c['ratio'])
    assert r['utilization'] == round(gov['ratio'], 4) and r['governing_check'] == gov['id']
    assert r['utilization'] > 6.8 and r['pass'] is False                 # 전에는 0.9025(패스너 무리)
    fg = _c(r, 'lap.fastener_group')
    assert r['fastener_utilization'] == round(fg['ratio'], 4) == 0.9025
    assert fg['mirrors']['ratio']['path'] == 'fastener_utilization'


def _region(**kw):
    p = dict(member_type='flexure', design_method='ASD', Fy=55.0, Fu=70, moment_sign='-', lap_region=True,
             lap_restrained=True, Mu=52.5, Vu=0.89)
    p.update(kw)
    return design_member(p)


def test_lap_section_block_is_the_plain_region_whatever_reserve_or_cold_work():
    """계약 §6.3: 랩 구간 결과의 lap_section 은 Fn = Fy · 비탄성 여유 없이 · 냉간가공 없이의 단면 강도다 — 두 선택을
    켜서 구간의 Mnℓ 이 올라가도(여기 212.9 · 194.0 kip-in) 블록은 끈 구간의 값과 같다."""
    sec = dict(section_type='lippedz', H=8.0, B=2.25, D=0.91, t=0.105, r=0.1875)
    plain = _region(**sec)
    loc = _c(plain, 'member.flexure.local')
    for extra in ({'use_inelastic_reserve': True}, {'use_cold_work': True}):
        r = _region(**sec, **extra)
        assert r['Mnl'] > plain['Mnl'] + 1.0, (extra, r['Mnl'], plain['Mnl'])        # 구간 자신은 올라간다
        for k in ('Mnl', 'Se', 'Vn'):
            assert r['lap_section'][k] == plain['lap_section'][k], (extra, k)
    b = plain['lap_section']
    assert abs(b['Mnl']['value'] - loc['nominal']['value']) <= 1e-12
    assert abs(b['Se']['value'] - b['Mnl']['value'] / 55.0) <= 1e-15
    assert b['Mnl']['quantity'] == 'moment' and b['Se']['quantity'] == 'section_modulus' and b['Vn']['quantity'] == 'force'
    assert b['statement_source'] == {'kind': 'user_input', 'key': 'lap_restrained'} and b['steps']
    assert 'lap_section' not in _region(**sec, lap_restrained=None)                  # 진술이 없으면 없다


def test_lap_section_block_II_2A_first_interior_support():
    """II-2A 첫 안쪽 지점의 lap-1 (호스트 기록 test/rendered/k3/golden/purlin.json: Mcrl 90.85, My 106.64 kip-in,
    Mnℓ 85.95, 비 1.020): 블록 Se = 1.5627 in³, 그 Se · Vn 으로 랩 도구의 국부 비 = 그 구간의 국부 비."""
    zp = dict(ZP, Sf=106.64 / 55.0)
    r = _region(section_type='Z', props=zp, section=dict(Z8), dsm=dict(Mcrl=90.85, Mcrd=101.0, M_sign='-'),
                use_cold_work=True)
    b = r['lap_section']
    assert abs(b['Se']['value'] - 1.5627) <= 5e-5 and round(b['Mnl']['value'], 2) == 85.95
    lap = design_lap_connection(dict(LAP, Se=b['Se']['value'], Vn=b['Vn']['value'], lap_restrained=True))
    ratio = _c(lap, 'lap.flexure.local')['ratio']
    assert abs(ratio - _c(r, 'member.flexure.local')['ratio']) <= 1e-12 and round(ratio, 3) == 1.020
    assert _c(lap, 'lap.flexure.distortional')['verdict'] == 'not_applicable'


# ---------------------------------------------------------------- V8-04 스레드 수

# 엔진 프로세스처럼 server 를 먼저 가져온 뒤(그 맨 앞이 스레드 고정): Z 단면 정 · 부 서명곡선, DSM 추출, 부재 설계
_PROBE = r'''
import hashlib, json, sys
sys.path.insert(0, sys.argv[1])
import server
import numpy as np
from engine.template import generate_section
from engine.properties import grosprop
from engine.stress import stresgen
from engine.helpers import signature_ss
from engine.dsm import extract_dsm_values
from design.aisi_s100 import design_member
PROP = np.array([[100, 29500, 29500, 0.3, 0.3, 11346]])
sec = generate_section('lippedz', {'H': 8.0, 'B': 2.25, 'D': 0.91, 't': 0.059, 'r': 0.1875})
node, elem = sec['node'], sec['elem']
p = grosprop(node, elem)
out = {}
for sign in (1.0, -1.0):
    n2 = stresgen(node.copy(), 0, sign, 0, 0, 0, p['A'], p['xcg'], p['zcg'], p['Ixx'], p['Izz'], p['Ixz'],
                  p['thetap'], p['I11'], p['I22'], unsymm=0)
    n2[:, 7] *= 55.0 / np.max(np.abs(n2[:, 7]))
    curve = signature_ss(PROP, n2, elem)['curve']
    out['curve%+d' % sign] = [np.asarray(c).tolist() for c in curve]
    out['dsm%+d' % sign] = d = server.to_jsonable(extract_dsm_values(curve, n2, elem, 55.0, 'Mxx'), 'dsm')
m = design_member(dict(member_type='flexure', design_method='ASD', Fy=55.0, Fu=70.0, section_type='lippedz',
                       H=8.0, B=2.25, D=0.91, t=0.059, r=0.1875, Mu=52.5, Vu=0.89, Lb=60.0,
                       dsm={'Mcrl': d['Mxxcrl'], 'Mcrd': d['Mxxcrd'], 'My': d['My_xx'], 'Lcrd': d['Lcrd'],
                            'M_sign': '-'}))
out['design'] = server.to_jsonable(m, 'design')
print(hashlib.sha256(json.dumps(out, sort_keys=True, default=str).encode()).hexdigest())
'''


def test_V8_04_engine_results_do_not_depend_on_the_blas_thread_count():
    """서명곡선 · DSM · 부재 설계의 결과 전체가 OPENBLAS_NUM_THREADS 1 · 4 · 8 · (없음)에서 한 해시. 전에는 1 과 4 · 8 이
    달랐다(Mcre 상대 7e-6, 검토 비 3e-15)."""
    outs = set()
    for t in ('1', '4', '8', None):
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
        env.pop('OPENBLAS_NUM_THREADS', None)
        if t is not None:
            env['OPENBLAS_NUM_THREADS'] = t
        r = subprocess.run([sys.executable, '-c', _PROBE, os.path.join(ROOT, 'python')], env=env,
                           capture_output=True, text=True, check=True)
        outs.add(r.stdout.strip())
    assert len(outs) == 1, outs
    import server
    st = server.METHODS['selftest']({})['numeric_threads']
    assert st['threads'] == 1 and 'OPENBLAS_NUM_THREADS' in st['variables']
    assert os.environ['OPENBLAS_NUM_THREADS'] == '1'


# ---------------------------------------------------------------- 긴 반파장 값의 허용차 표지 (계약 §16.14)

def _signature_dsm(**kw):
    import numpy as np
    from engine.template import generate_section
    from engine.properties import grosprop
    from engine.stress import stresgen
    from engine.helpers import signature_ss
    from engine.dsm import extract_dsm_values
    sec = generate_section('lippedz', {'H': 8.0, 'B': 2.25, 'D': 0.91, 't': 0.059, 'r': 0.1875})
    node, elem = sec['node'], sec['elem']
    p = grosprop(node, elem)
    n2 = stresgen(node.copy(), 0, 1.0, 0, 0, 0, p['A'], p['xcg'], p['zcg'], p['Ixx'], p['Izz'], p['Ixz'],
                  p['thetap'], p['I11'], p['I22'], unsymm=0)
    n2[:, 7] *= 55.0 / np.max(np.abs(n2[:, 7]))
    curve = signature_ss(np.array([[100, 29500, 29500, 0.3, 0.3, 11346]]), n2, elem)['curve']
    return extract_dsm_values(curve, n2, elem, 55.0, 'Mxx', **kw)


def test_dsm_flags_the_values_read_at_the_long_wavelength_end():
    d = _signature_dsm()
    nt = d['numeric_tolerance']
    lw = nt['fsm_long_wavelength']
    assert nt['default_rel_tol'] == 1e-6 and lw['rel_tol'] == 1e-4 and lw['length'] == d['Lcre_signature']
    assert set(lw['keys']) == {'cre_signature', 'Mxxcre', 'cre', 'LF_global'} and d['global_is_signature_asymptote']
    # 유효길이를 주면 전체좌굴은 폐형식(§F2) — 그 값은 표지 밖, 서명곡선 끝의 참조값만 남는다
    c = _signature_dsm(Lb=60.0, section_type='Z')
    assert c['global_source'] == 'closed_form_F2' and c['numeric_tolerance']['fsm_long_wavelength']['keys'] == [
        'cre_signature']
    # 국부 · 뒤틀림 극소는 표지 밖
    assert not {'Mxxcrl', 'Mxxcrd', 'crl', 'crd'} & set(lw['keys'])


def test_long_wavelength_tolerance_propagates_down_the_trace():
    """사용자 Fcre 를 FSM 서명곡선의 긴 반파장 값이라고 밝히면(Fcre_basis) 그 입력 · 그 입력에서 나온 단계 결과 ·
    그 결과를 쓴 다른 항목까지 표지가 붙는다. 밝히지 않으면 아무 데도 없다. 값은 같다."""
    base = dict(member_type='compression', design_method='LRFD', Fy=55.0, Fu=70.0, section_type='lippedc',
                H=8.0, B=2.5, D=0.773, t=0.059, r=0.1875, Pu=5.0, KxLx=96.0, KyLy=48.0, KtLt=48.0,
                dsm=dict(Pcrl=12.0, Pcrd=15.0), Fcre=30.0)
    plain = design_member(dict(base))
    flagged = design_member(dict(base, Fcre_basis='fsm_long_wavelength'))
    assert not any('numeric_tolerance' in c for c in plain['design_checks'])
    g = _c(flagged, 'member.compression.global')
    assert g['numeric_tolerance']['rel_tol'] == 1e-4 and g['ratio'] == _c(plain, 'member.compression.global')['ratio']
    ins = [i for s in g['steps'] for i in s['inputs'] if i['symbol'] == 'Fcre']
    assert ins and ins[0]['numeric']['source'] == 'fsm_long_wavelength'
    assert any((s.get('result') or {}).get('numeric', {}).get('derived') for s in g['steps'])
    loc = _c(flagged, 'member.compression.local')                      # Pne(전체좌굴에서) 를 쓰는 항목
    assert loc.get('numeric_tolerance'), [i.get('source') for s in loc['steps'] for i in s['inputs']][:6]
    assert 'numeric_tolerance' not in _c(flagged, 'member.applicability.b4')


# ---------------------------------------------------------------- V9a-02 · V9a-03 랩의 소요와 진술

_LAPD = dict(d=8.0, t=0.059, Fy=55.0, Fu=70.0, lap_left_in=30.0, lap_right_in=42.0, fastener_type='screw',
             fastener_dia=0.25, Pnvs=2.0, n_rows=2, design_method='ASD', Se=1.8, lap_restrained=True)


def _lapd(**kw):
    p = dict(_LAPD)
    p.update(kw)
    return design_lap_connection({k: v for k, v in p.items() if v is not None})


def test_V9a_02_a_lap_needs_its_demands():
    """Mu · Vu 가 없으면 그 소요를 쓰는 항목은 미평가(이유에 입력 이름), 종합은 통과가 아니다. 0 은 밝혔을 때만 0."""
    none = _lapd()
    for cid in ('lap.flexure.local', 'lap.bending_shear', 'lap.fastener_group'):
        c = _c(none, cid)
        assert c['verdict'] in ('not_evaluated', 'fail') and c['verdict'] != 'pass', (cid, c['verdict'])
    assert _c(none, 'lap.flexure.local')['reason_code'] == 'lap.reason.demand_not_given' and none['pass'] is not True
    only_mu = _lapd(Mu_support=100.0)                                     # 전에는 0.972 로 통과
    assert _c(only_mu, 'lap.bending_shear')['verdict'] == 'not_evaluated' and only_mu['pass'] is not True
    both = _lapd(Mu_support=100.0, Vu_support=1.78)                       # 둘 다 주면 전과 같다 — 판정이 난다
    assert _c(both, 'lap.bending_shear')['verdict'] in ('pass', 'fail') and both['pass'] in (True, False)
    assert _c(both, 'lap.fastener_group')['verdict'] in ('pass', 'fail')
    zero = _lapd(Mu_support=0.0, Vu_support=1.0)                          # 밝히지 않은 0 — 믿을 수 없음
    assert _c(zero, 'lap.flexure.local')['reason_code'] == 'lap.reason.zero_demand_not_stated' and zero['pass'] is not True
    stated = _lapd(Mu_support=0.0, Vu_support=1.0, zero_demand_stated=True)
    assert _c(stated, 'lap.flexure.local')['verdict'] == 'not_applicable'
    big = _lapd(Vu_support=50.0)                                           # 준 소요로 넘으면 불합격은 그대로
    fg = _c(big, 'lap.fastener_group')
    assert fg['verdict'] == 'fail' and fg['demand_incomplete'] == ['Mu_support'] and big['pass'] is False


def test_V9a_03_h2_without_the_statement_is_not_evaluated():
    """진술 없이 Se 를 주면 국부 휨과 H2 모두 미평가(불합격은 그대로), flexure_checked 는 거짓."""
    r = design_lap_connection(dict(_LAP_A))
    assert _c(r, 'lap.flexure.local')['verdict'] == 'not_evaluated'
    h = _c(r, 'lap.bending_shear')
    assert h['verdict'] == 'not_evaluated' and h['reason_code'] == 'lap.reason.h2_unstated'
    assert abs(h['reference']['ratio'] - 0.708) < 0.001 and r['flexure_checked'] is False
    s = design_lap_connection(dict(_LAP_A, lap_restrained=True))
    assert _c(s, 'lap.bending_shear')['verdict'] == 'pass' and s['flexure_checked'] is True


_LAP_A = dict(d=8.0, t=0.059, Fy=55.0, Fu=70.0, lap_left_in=30.0, lap_right_in=42.0, Mu_support=80.0,
              Vu_support=1.0, fastener_type='bolt', fastener_dia=0.5, n_rows=2, design_method='ASD', Se=1.8)


def test_V9a_06_a_comparison_reads_true_as_printed():
    """비 1.000004 의 정모멘트 NG — 보이는 자리로 같은 두 값을 「>」 로 잇지 않는다(더 긴 자리의 판)."""
    import contract_cases_1123 as cc
    p = [x for x in cc.all_cases() if x[0] == 'band: positive region ratio 1.000004'][0]
    r = cc.run_case(p[1], p[2])
    e = [n for n in r['notices'] if n['code'].startswith('member.warning.ng_mu_mn_dcr')][0]
    assert e['code'] == 'member.warning.ng_mu_mn_dcr_precise', e['text']
    import re
    a, b = [float(x) for x in re.findall(r'=\s*([0-9.]+)', e['text'])[:2]]
    assert a > b, e['text']
