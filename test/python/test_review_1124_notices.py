"""2026-11-24 K4b — 알림(경고 · 가정 · 범위 · 미평가 · 이유)의 code · 한국어 · 물리량 붙은 매개변수 (계약 §16).

계약 사례 전부를 서버 처리기로 돌려(엄격 JSON 왕복) 결과의 `notices` 와 검토 항목의 `reason_*` 를 본다:
- 나온 알림마다 등록된 code 가 있다(code None 이 없다).
- `text` = 계약 §16.3 의 문법으로 템플릿 + 매개변수를 다시 그린 글(이 파일의 렌더러 — 엔진의 것과 따로).
- `text_ko` = 한국어 템플릿을 같은 문법으로 그린 글. 한국어 템플릿이 없는 code 가 없다.
- 템플릿의 자리표마다 매개변수가 있고, 매개변수마다 자리표가 있다.
등록표 쪽: code 의 모양, kind, 두 템플릿의 자리표가 같은지, 용어표(영어에서 옮긴 한국어 템플릿).
사례에서 나오지 않는 code 는 목록으로 둔다(실패하지 않음) — 대신 엔진 소스에 그 code 를 쓰는 자리가 있어야 한다.
호스트가 읽는 고정값: test/python/notice_render_fixture.json (템플릿 · 매개변수 · 기대 글 쌍) — 이 파일이 만들고 확인한다.
"""

import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'python'))
sys.path.insert(0, HERE)

from design.notice_registry import REGISTRY, KINDS  # noqa: E402
from design.checks import SOURCE_KINDS, BUCKLING_METHODS  # noqa: E402
import contract_cases_1123 as cases  # noqa: E402

FIXTURE = os.path.join(HERE, 'notice_render_fixture.json')
CODE_RE = re.compile(r'^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z0-9][a-z0-9_]*$')
PH = re.compile(r'\{\{|\}\}|\{([A-Za-z_]\w*)\}')
HANGUL = re.compile('[가-힣]')


# ------------------------------------------------------------------ 렌더러 (계약 §16.3 — 호스트가 옮겨 쓸 규칙)
def _piece(p, ko):
    """매개변수 하나의 글. 숫자는 format(값, fmt) (conv 'r' 이면 repr 먼저), 글 매개변수는 value 그대로,
    알림을 품은 매개변수는 그 알림의 글(한국어면 text_ko). 그 뒤 sep + unit_text."""
    if ko and p.get('notice') and p['notice'].get('text_ko') is not None:
        s = p['notice']['text_ko']
    elif p.get('fmt') == 'raw':
        s = p.get('text', p['value']) if p.get('quantity') else p['value']
        s = str(s)
    elif p.get('quantity') is not None and isinstance(p['value'], (int, float)) and not isinstance(p['value'], bool):
        v = p['value']
        x = repr(v) if p.get('conv') == 'r' else (str(v) if p.get('conv') == 's' else v)
        s = format(x, p.get('fmt') or '')
    else:
        s = str(p['value'])
    if p.get('unit_text'):
        s += p.get('sep', '') + p['unit_text']
    return s


def render(template, params, ko=False):
    by = {p['symbol']: p for p in params}

    def sub(m):
        if m.group(0) == '{{':
            return '{'
        if m.group(0) == '}}':
            return '}'
        return _piece(by[m.group(1)], ko)
    return PH.sub(sub, template)


def check_entry(e, where, errors, codes):
    if e.get('kind') == 'group':
        texts = [p['text'] for p in e['parts']]
        if e['text'] != e.get('prefix', '') + e['sep'].join(texts):
            errors.append((where, 'group text', e['text'][:80]))
        for p in e['parts']:
            check_entry(p, where, errors, codes)
        return
    if e.get('code') is None:
        errors.append((where, 'no code', e['text'][:160]))
        return
    codes.add(e['code'])
    ent = REGISTRY.get(e['code'])
    if ent is None:
        errors.append((where, 'unknown code', e['code']))
        return
    if e['template'] != ent['template'] or e['template_ko'] != ent['template_ko']:
        errors.append((where, 'template differs from registry', e['code']))
    if not e.get('template_ko'):
        errors.append((where, 'no Korean template', e['code']))
    names = [m.group(1) for m in PH.finditer(e['template']) if m.group(1)]
    syms = [p['symbol'] for p in e['params']]
    if sorted(set(names)) != sorted(syms):
        errors.append((where, 'placeholders vs params', e['code'], names, syms))
        return
    for p in e['params']:
        if p.get('quantity') is not None and not isinstance(p['value'], (int, float)):
            errors.append((where, 'quantity on a non-number', e['code'], p['symbol']))
        if p.get('notice'):
            check_entry(p['notice'], where + '/' + p['symbol'], errors, codes)
    text = e.get('prefix', '') + render(e['template'], e['params'])
    if text != e['text']:
        errors.append((where, 'text != rendered template', e['code'], e['text'][:120], text[:120]))
    if e.get('template_ko'):
        tko = e.get('prefix_ko', e.get('prefix', '')) + render(e['template_ko'], e['params'], ko=True)
        if tko != e['text_ko']:
            errors.append((where, 'text_ko != rendered template_ko', e['code'], e['text_ko'][:120], tko[:120]))


LISTS = ('warnings', 'assumptions', 'scope_notes', 'not_evaluated', 'not_checked', 'reasons', 'dsm_warnings')
FIELD_PREFIXES = ('reason', 'label', 'value', 'steps_unavailable')   # 글 하나에 붙는 필드(계약 §16.2)


def _field_entry(d, prefix):
    e = {'text': d[prefix], 'code': d.get(f'{prefix}_code'), 'kind': d.get(f'{prefix}_kind'),
         'text_ko': d.get(f'{prefix}_ko'), 'template': d.get(f'{prefix}_template'),
         'template_ko': d.get(f'{prefix}_template_ko'), 'params': d.get(f'{prefix}_params'),
         'parts': d.get(f'{prefix}_parts'), 'sep': d.get(f'{prefix}_sep')}
    if d.get(f'{prefix}_prefix') is not None:
        e['prefix'], e['prefix_ko'] = d[f'{prefix}_prefix'], d[f'{prefix}_prefix_ko']
    return e


def walk_result(r, where, errors, codes, stats):
    if isinstance(r, dict):
        has_lists = any(isinstance(r.get(k), list) for k in LISTS)
        if isinstance(r.get('notices'), list):
            stats['results'] += 1
            for e in r['notices']:
                stats['notices'] += 1
                check_entry(e, where + ':' + str(e.get('list')), errors, codes)
            # 옛 목록과 하나씩 맞는다(같은 순서, 같은 글)
            olds = []
            for key in LISTS:
                for x in r.get(key) or []:
                    if isinstance(x, dict):
                        if x.get('reason') is not None:
                            olds.append(x['reason'])
                    else:
                        olds.append(x)
            if olds != [e['text'] for e in r['notices']]:
                errors.append((where, 'notices do not match the old lists one to one'))
        elif has_lists and any(r.get(k) for k in LISTS):
            errors.append((where, 'a block with notice lists has no notices'))     # 하위 블록도 자기 notices
        for prefix in [k for k in r if f'{k}_kind' in r]:          # 글 하나에 붙는 필드(reason · label · basis …)
            if r[prefix] is not None:
                stats['reasons'] += 1
                check_entry(_field_entry(r, prefix), where + ':' + str(r.get('id', prefix)), errors, codes)
        for k, v in r.items():                                      # 글로 된 사전 · 목록의 {key}_notices (계약 §16.11)
            if not k.endswith('_notices'):
                continue
            src = r.get(k[:-len('_notices')])
            items = list(v.values()) if isinstance(v, dict) else [
                e for x in v for e in (x.values() if isinstance(x, dict) and 'code' not in x else [x])]
            for e in items:
                stats['labels'] = stats.get('labels', 0) + 1
                check_entry(e, where + ':' + k, errors, codes)
            if isinstance(v, dict) and isinstance(src, dict) and any(src[kk] != e['text'] for kk, e in v.items()):
                errors.append((where, k, 'label text differs from the source value'))
        for k in ('governing_check', 'controlling_mode'):
            if isinstance(r.get(k), str) and r.get(f'{k}_id') is None:
                errors.append((where, k, 'no check id for', r[k]))
        for k in r:
            if (k == 'governing_mode' or k.endswith('_governing_mode')) and isinstance(r[k], str)                     and r.get(f'{k}_id') is None:
                errors.append((where, k, 'no check id for', r[k]))
        for c in r.get('design_checks') or []:
            if c.get('reason') is not None and 'reason_kind' not in c:
                errors.append((where, c['id'], 'reason without reason_* fields'))
        if r.get('kind') in SOURCE_KINDS and isinstance(r.get('note'), str) and 'note_code' not in r:
            errors.append((where, 'source note without a code', r['note'][:80]))      # 계약 §16.12
        is_check = 'verdict' in r and 'id' in r
        for k, v in r.items():
            if k == 'notices' or k.endswith('_notices') or (k == 'steps' and not is_check):
                continue                    # 옛 steps[] 는 알려진 밖; 검토 항목의 계산 과정 steps 는 본다
            walk_result(v, where + '.' + k if isinstance(v, dict) else where, errors, codes, stats)
    elif isinstance(r, list):
        for v in r:
            walk_result(v, where, errors, codes, stats)


_RUN = {}


def _corpus():
    if not _RUN:
        errors, codes, stats = [], set(), {'results': 0, 'notices': 0, 'reasons': 0}
        samples = {}
        for name, method, params in cases.all_cases():
            r = cases.run_case(method, params)
            walk_result(r, name, errors, codes, stats)
            _collect_samples(r, samples)
        _RUN.update(errors=errors, codes=codes, stats=stats, samples=samples)
    return _RUN


def _collect_samples(r, samples):
    if isinstance(r, dict):
        for e in r.get('notices') or []:
            _sample(e, samples)
        for c in r.get('design_checks') or []:
            if c.get('reason_code') and c['reason_code'] not in samples:
                samples[c['reason_code']] = {
                    'code': c['reason_code'], 'template': c['reason_template'],
                    'template_ko': c['reason_template_ko'], 'params': c['reason_params'],
                    'text': c['reason'][len(c.get('reason_prefix') or ''):],
                    'text_ko': c['reason_ko'][len(c.get('reason_prefix_ko') or ''):]}
            for p in c.get('reason_parts') or []:
                _sample(p, samples)
        for v in r.values():
            _collect_samples(v, samples)
    elif isinstance(r, list):
        for v in r:
            _collect_samples(v, samples)


def _sample(e, samples):
    if e.get('kind') == 'group':
        for p in e['parts']:
            _sample(p, samples)
        return
    if not e.get('code') or e['code'] in samples:
        return
    samples[e['code']] = {'code': e['code'], 'template': e['template'], 'template_ko': e['template_ko'],
                          'params': e['params'], 'text': e['text'][len(e.get('prefix') or ''):],
                          'text_ko': e['text_ko'][len(e.get('prefix_ko') or ''):]}
    for p in e['params']:
        if p.get('notice'):
            _sample(p['notice'], samples)


# ------------------------------------------------------------------ 시험
def test_registry_shape():
    """code 모양 · kind · 두 템플릿의 자리표 · 매개변수 사양이 맞는다. 한국어 템플릿이 없는 code 가 없다."""
    bad = []
    for code, e in REGISTRY.items():
        if not CODE_RE.match(code):
            bad.append(('code shape', code))
        if e['kind'] not in KINDS:
            bad.append(('kind', code, e['kind']))
        if not e.get('template_ko'):
            bad.append(('no Korean template', code))
            continue
        a = sorted({m.group(1) for m in PH.finditer(e['template']) if m.group(1)})
        b = sorted({m.group(1) for m in PH.finditer(e['template_ko']) if m.group(1)})
        if a != b or a != sorted(e['params']):
            bad.append(('placeholders', code, a, b, sorted(e['params'])))
        for k, p in e['params'].items():
            if p['quantity'] not in (None, 'force', 'moment', 'stress', 'length', 'area', 'section_modulus',
                                     'moment_of_inertia', 'torsion_constant', 'warping_constant',
                                     'force_per_length', 'rotational_stiffness', 'dimensionless', 'angle', 'count',
                                     'mass_density', 'pressure'):
                bad.append(('quantity outside the vocabulary', code, k, p['quantity']))
    assert not bad, bad[:20]


def test_glossary_one_form_per_term():
    """용어표(design/glossary.py, 계약 §16.5): 검토 항목 이름(name_ko)과 한국어 템플릿(옛 글이 한국어인 template 포함)에
    띄어 쓴 꼴 · 다른 말(국부 좌굴, 횡좌굴, 왜곡좌굴, 블록 전단, 적용 범위 …)이 없다."""
    from design.checks import REGISTRY as CHECKS
    from design.glossary import violations, WEB_CRIPPLING, localize
    bad = []
    for cid, r in CHECKS.items():
        bad += [(cid, 'name_ko', v) for v in violations(r['name_ko'])]
    for code, e in REGISTRY.items():
        bad += [(code, 'template_ko', v) for v in violations(e['template_ko'])]
        if HANGUL.search(e['template']):
            bad += [(code, 'template', v) for v in violations(e['template'])]
    assert not bad, bad[:20]
    # 웹 크리플링은 한 곳(glossary.WEB_CRIPPLING)에서 — 이름과 템플릿이 그 꼴을 쓴다
    assert CHECKS['member.web_crippling']['name_ko'] == WEB_CRIPPLING
    assert localize('웹 크리플링') == WEB_CRIPPLING


def test_every_emitted_notice_is_registered_and_renders():
    run = _corpus()
    st = run['stats']
    assert st['results'] > 140 and st['notices'] > 400 and st['reasons'] > 300, st
    assert not run['errors'], (len(run['errors']), run['errors'][:15])


def test_unreached_codes_have_a_source_site():
    """사례에서 나오지 않는 code 는 실패가 아니다 — 다만 엔진 소스가 그 code 를 쓴다(죽은 code 가 없다)."""
    run = _corpus()
    src = ''
    for f in glob.glob(os.path.join(ROOT, 'python', '**', '*.py'), recursive=True):
        if not f.endswith('notice_registry.py'):
            src += open(f, encoding='utf-8').read()
    unreached = sorted(set(REGISTRY) - run['codes'])
    dead = [c for c in unreached if repr(c) not in src and f'"{c}"' not in src]
    assert not dead, dead
    # 목록(계약 §16.7 의 수와 같아야 한다 — 사례를 더하면 줄어든다)
    print(f'notices: {len(run["codes"])} of {len(REGISTRY)} codes reached by the contract cases; '
          f'{len(unreached)} reachable only outside the corpus')


def test_dimensional_constants_in_templates_are_params():
    """계약 §16.3: 템플릿 글자에 치수 상수(숫자 + in · ksi · kips · ft · mil …)가 남지 않는다 — 상수 매개변수(const ·
    text)로 두어 SI 로 바뀐다. 각도(°, deg — 단위계와 무관)와 단위 이름만 쓴 글(kip*s^2/in^4 · lb/in^3 · kg/m^3 의
    다른 단위계 값)은 예외."""
    unit = r'(in\.?|ksi|kips?|kip-in|kip-ft|ft|psf|plf|mil)(?![A-Za-z])'
    rx = re.compile(r'(?<![A-Za-z_])(\d+-\d+/\d+|\d+/\d+|\d*\.\d+(?:e-?\d+)?|\d+)\s?' + unit)
    bad = []
    for code, e in REGISTRY.items():
        for t in (e['template'], e['template_ko']):
            lit = PH.sub('{}', t)
            bad += [(code, m.group(0)) for m in rx.finditer(lit)]
        for k, p in e['params'].items():
            if 'const' in p:
                assert p['quantity'] and isinstance(p['const'], float) and p['text'], (code, k)
    assert not bad, bad


def test_every_source_kind_and_method_has_a_korean_name():
    """계산서가 값 옆에 찍는 출처(§3.3)의 종류 · 좌굴값 방법마다 용어표에 한국어 이름이 있다(계약 §16.12)."""
    from design.glossary import SOURCE_KINDS_KO, BUCKLING_METHODS_KO, violations
    assert set(SOURCE_KINDS_KO) == set(SOURCE_KINDS), set(SOURCE_KINDS) ^ set(SOURCE_KINDS_KO)
    assert set(BUCKLING_METHODS_KO) == set(BUCKLING_METHODS), set(BUCKLING_METHODS) ^ set(BUCKLING_METHODS_KO)
    for name in list(SOURCE_KINDS_KO.values()) + list(BUCKLING_METHODS_KO.values()):
        assert name and HANGUL.search(name) and not violations(name), name


def test_every_call_site_passes_exactly_the_registered_params():
    """사례가 닿지 않는 자리도: 엔진 소스의 _nt('code', …) 호출마다 code 가 등록되어 있고 매개변수 이름이 같다."""
    import ast
    bad, n = [], 0
    for f in glob.glob(os.path.join(ROOT, 'python', '**', '*.py'), recursive=True):
        tree = ast.parse(open(f, encoding='utf-8').read())
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == '_nt':
                n += 1
                code = node.args[0].value
                if code not in REGISTRY:
                    bad.append((f, code, 'unregistered'))
                    continue
                kws = sorted(k.arg for k in node.keywords)
                ps = REGISTRY[code]['params']
                need = sorted(k for k, p in ps.items() if 'const' not in p)      # 상수 매개변수는 등록표가 채운다
                if not (set(need) <= set(kws) <= set(ps)):
                    bad.append((os.path.basename(f), node.lineno, code, kws, need))
    assert n > 400 and not bad, (n, bad[:10])


def test_fixture_for_the_host_renders():
    """호스트용 고정값: 쌍마다 계약 §16.3 문법으로 그린 글이 기대 글과 같고, 템플릿이 등록표와 같다."""
    with open(FIXTURE, encoding='utf-8') as f:
        fx = json.load(f)
    assert fx['grammar'] == 'notice-template/1' and len(fx['pairs']) >= 150
    for x in fx['pairs']:
        ent = REGISTRY[x['code']]
        assert x['template'] == ent['template'] and x['template_ko'] == ent['template_ko'], x['code']
        assert render(x['template'], x['params']) == x['text'], x['code']
        assert render(x['template_ko'], x['params'], ko=True) == x['text_ko'], x['code']


def test_round_tripped_notice_is_recognized():
    """엔진 밖을 거쳐 그냥 str 로 돌아온 알림(dsm 결과를 다시 넘김)도 code 를 되찾는다 — 글은 그대로."""
    from design.notices import N, recognize, entry
    n = N('member.warning.table_b4_1_1_corner_b4_corner_limit', Rt=25.4)
    r = recognize(str(n))
    assert r is not None and r.code == n.code and str(r) == str(n)
    e = entry(str(n))
    assert e['code'] == n.code and e['recognized'] is True and e['params'][0]['value'] == 25.4
    assert recognize('free text that is not a notice') is None


def test_labels_with_units_carry_their_numbers():
    """계약 §16.6: 이름표 안의 숫자 — 랩 패스너 이름표, §I6.2.1 조건의 한계."""
    from design.lap_connection import design_lap_connection
    from design.loads.bracing import I621_LIMITS
    b = design_lap_connection(dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=30, lap_right_in=42, Mu_support=105,
                                   Vu_support=1.78, fastener_type='bolt', fastener_dia=0.5, n_rows=2,
                                   design_method='ASD', Se=1.8, lap_restrained=True))
    lp = b['fastener_label_parts']
    assert render(lp['template'], lp['params']) == b['fastener_label'] == 'Bolt d=0.500 in'
    assert lp['params'][0]['quantity'] == 'length' and lp['params'][0]['value'] == 0.5
    s = design_lap_connection(dict(d=8.0, t=0.059, Fy=55, Fu=70, lap_left_in=30, lap_right_in=42, Mu_support=105,
                                   Vu_support=1.78, fastener_type='screw', fastener_dia=0.19, n_rows=2,
                                   design_method='ASD', Se=1.8, lap_restrained=True, Pnvs=1.0))
    sp = s['fastener_label_parts']
    assert render(sp['template'], sp['params']) == s['fastener_label'] and sp['values'][0]['value'] == 0.19
    assert I621_LIMITS['(a)']['limits'][0]['value'] == 12.0 and I621_LIMITS['(h)']['quantity'] is None
    assert I621_LIMITS['(h)']['limits'][0]['as_length'] == {'value': 396.0, 'quantity': 'length', 'unit_text': 'in'}
    from design.loads.required_strength import analyze_loads
    r = analyze_loads(member_app='roof-purlin', span_type='cont-4', span_ft=25.0, loads={'D': 15, 'Lr': 100},
                      design_method='ASD', laps={'left_ft': 1.0, 'right_ft': 2.5},
                      deck={'type': 'through-fastened', 't_panel': 0.018, 'fastener_spacing': 12},
                      section={'depth': 8.0, 'flange_width': 2.25, 'thickness': 0.070, 'lip_depth': 0.91,
                               'R_corner': 0.1875, 'type': 'Z', 'Fy': 55, 'Fu': 70})

    def conds(x):
        if isinstance(x, dict):
            if isinstance(x.get('conditions'), list) and x['conditions'] and 'status' in x['conditions'][0]:
                return x['conditions']
            for v in x.values():
                c = conds(v)
                if c:
                    return c
        return None
    h = [c for c in conds(r) if c['id'] == '(h)'][0]
    assert h['value_unit_text'] == 'ft' and h['value_as_length'] == {'value': h['value'] * 12.0, 'quantity': 'length',
                                                                       'unit_text': 'in'}


def write_fixture():
    run = _corpus()
    pairs = [run['samples'][c] for c in sorted(run['samples'])]
    out = {'grammar': 'notice-template/1',
           'rule': 'docs/implementation/20261123-check-contract.md §16.3 — {name} → format(value, fmt) (conv r: repr '
                   'first; fmt raw: the text as cut from an old string) + sep + unit_text; a text parameter is its '
                   'value; a parameter carrying a notice renders that notice (text_ko in Korean); {{ }} are braces. '
                   'US values; to render SI convert value by quantity and use the SI unit label instead of unit_text.',
           'pairs': pairs}
    with open(FIXTURE, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    print('fixture', len(pairs), 'pairs')


if __name__ == '__main__':
    if '--write-fixture' in sys.argv:
        write_fixture()
