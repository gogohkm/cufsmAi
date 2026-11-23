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
