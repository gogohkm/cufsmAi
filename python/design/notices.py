"""알림(경고 · 가정 · 범위 · 미평가 · 이유) 등록표를 쓰는 도구 — 계약 docs/implementation/20261123-check-contract.md §16.

엔진의 알림 문자열은 모두 N('code', name=value, …) 로 만든다. N 이 돌려주는 것은 str 의 하위형(Notice)이라
옛 목록(warnings · assumptions · scope_notes · not_evaluated · check.reason)에는 예전과 바이트 단위로 같은 글이 들어가고,
그 글이 어느 code · 어떤 매개변수에서 왔는지도 함께 들고 다닌다. 결과를 내보낼 때 attach(result) 가 그 목록들을
읽어 구조화된 목록(`notices`)을 만들고, 검토 항목마다 reason_* 필드를 단다.

자리표 문법(템플릿): `{name}` 하나뿐. `{{` · `}}` 는 글자 그대로의 중괄호. 자리표의 글은
    format(값, fmt)            (conv 가 'r' 이면 repr(값), 's' 이면 str(값)을 먼저)
    + sep + unit_text         (매개변수에 unit_text 가 있을 때 — US 단위 글자. SI 로 다시 그릴 때는 quantity 의 SI 단위)
이다(Python 의 f-string 과 같은 규칙 — 그래서 옛 글과 같다). 숫자가 아닌 매개변수(이름 · 목록 · 문장 조각)는 글 그대로,
알림이 알림을 품으면(매개변수 값이 또 하나의 알림) 그 매개변수에 `notice` 로 안쪽 항목을 싣는다.

조립: prefixed(머리, 알림) — 하위 결과를 옮길 때 붙이는 머리('[압축] ', 'G5: ', 'Tension Rupture (J6.2): ' …).
joined(sep, 알림들) — 검토 항목의 이유처럼 여러 알림을 이은 글. 둘 다 옛 글을 바꾸지 않는다.
"""

import math
import re

from design.notice_registry import REGISTRY, KINDS
from design.glossary import localize

# 용어표의 한 줄(예: 웹 크리플링)을 바꾸면 템플릿에도 — 저장된 꼴과 같으면 아무것도 바뀌지 않는다(계약 §16.5)
for _e in REGISTRY.values():
    _e['template'] = localize(_e['template'])
    _e['template_ko'] = localize(_e['template_ko'])

_PH = re.compile(r'\{\{|\}\}|\{([A-Za-z_]\w*)\}')
_HANGUL = re.compile(r'[가-힣]')


class Notice(str):
    """옛 글과 같은 문자열 + 출처(code · 매개변수). prefix 는 하위 결과를 옮길 때 붙인 머리, prefix_ko 는 그 한국어."""

    def __new__(cls, text, code, values, prefix='', prefix_ko=None):
        obj = str.__new__(cls, text)
        obj.code = code
        obj.values = values
        obj.prefix = prefix
        obj.prefix_ko = prefix if prefix_ko is None else prefix_ko
        return obj

    def __reduce__(self):
        return (Notice, (str(self), self.code, self.values, self.prefix, self.prefix_ko))


class NoticeGroup(str):
    """여러 알림을 sep 으로 이은 글(검토 항목의 이유 '…; …'). parts 는 Notice · NoticeGroup 또는 str."""

    def __new__(cls, text, parts, sep, prefix='', prefix_ko=None):
        obj = str.__new__(cls, text)
        obj.parts = list(parts)
        obj.sep = sep
        obj.prefix = prefix
        obj.prefix_ko = prefix if prefix_ko is None else prefix_ko
        return obj

    def __reduce__(self):
        return (NoticeGroup, (str(self), self.parts, self.sep, self.prefix, self.prefix_ko))


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) or (
        hasattr(v, 'dtype') and getattr(v, 'ndim', 1) == 0 and v.dtype.kind in 'if')


class _Raw(str):
    """되짚어 읽은(recognize) 알림의 매개변수 — 옛 글에서 잘라 낸 글자 그대로(형식을 다시 입히지 않는다)."""


def _piece(spec, v):
    if spec.get('text') is not None:     # 상수 매개변수 — US 글은 등록표의 글자 그대로(3/16 · 0.60 …)
        return spec['text'] + ((spec.get('sep') or '') + spec['unit'] if spec.get('unit') else '')
    if isinstance(v, _Raw):
        return str(v) + ((spec.get('sep') or '') + spec['unit'] if spec.get('unit') else '')
    conv, fmt = spec.get('conv'), spec.get('spec') or ''
    x = repr(v) if conv == 'r' else (str(v) if conv == 's' else v)
    out = format(x, fmt)
    if spec.get('unit'):
        out += (spec.get('sep') or '') + spec['unit']
    return out


def text_ko(n):
    """알림의 한국어 글(한국어 템플릿이 없으면 None). 그냥 str 은 None."""
    if isinstance(n, NoticeGroup):
        parts = [text_ko(x) for x in n.parts]
        return n.prefix_ko + n.sep.join(k if k is not None else str(x) for k, x in zip(parts, n.parts))
    if isinstance(n, Notice):
        ent = REGISTRY[n.code]
        if not ent['template_ko']:
            return None
        return n.prefix_ko + render(ent['template_ko'], n.code, n.values, ko=True)
    return None


def render(template: str, code: str, values: dict, ko: bool = False) -> str:
    """템플릿 + 매개변수 → 글. ko=True 면 알림을 품은 매개변수는 그 한국어 글로."""
    specs = REGISTRY[code]['params']

    def sub(m):
        if m.group(0) == '{{':
            return '{'
        if m.group(0) == '}}':
            return '}'
        name = m.group(1)
        v = values[name]
        if ko and isinstance(v, (Notice, NoticeGroup)):
            k = text_ko(v)
            if k is not None:
                v = k
        return _piece(specs[name], v)
    return _PH.sub(sub, template)


def N(_code: str, /, **values) -> Notice:
    """등록된 알림 하나 — 옛 f-string 과 같은 글. (매개변수 이름 'code' 와 겹치지 않게 첫 인자는 위치 전용)"""
    ent = REGISTRY[_code]
    for k, sp in ent['params'].items():      # 상수 매개변수(템플릿의 치수 상수)는 등록표가 채운다
        if 'const' in sp and k not in values:
            values[k] = sp['const']
    missing = [k for k in ent['params'] if k not in values]
    extra = [k for k in values if k not in ent['params']]
    if missing or extra:
        raise KeyError(f'notice {_code}: missing {missing}, unexpected {extra}')
    return Notice(render(ent['template'], _code, values), _code, values)


_RECOGNIZE = None


def _literal_len(template):
    return len(re.sub(r'\W', '', _PH.sub('', template)))


def _compile_recognizers():
    out = []
    for code, ent in REGISTRY.items():
        tpl = ent['template']
        if ent['kind'] == 'fragment' or _literal_len(tpl) < 8:
            continue                       # 글자가 거의 없는 템플릿('{label} {item}')은 되짚지 않는다
        parts, pos, names = [], 0, []
        for m in _PH.finditer(tpl):
            parts.append(re.escape(tpl[pos:m.start()]))
            if m.group(1) is None:
                parts.append(re.escape(m.group(0)[0]))
            else:
                name = m.group(1)
                sp = ent['params'][name]
                unit = re.escape((sp.get('sep') or '') + sp['unit']) if sp.get('unit') else ''
                if sp.get('text') is not None:
                    parts.append(re.escape(sp['text']) + unit)
                    pos = m.end()
                    continue
                g = f'p{len(names)}'
                names.append(name)
                parts.append(f'(?P<{g}>.*?)' + unit)
            pos = m.end()
        parts.append(re.escape(tpl[pos:]))
        out.append((_literal_len(tpl), code, re.compile(''.join(parts), re.S), names))
    out.sort(key=lambda x: -x[0])          # 글자가 많은 템플릿부터
    return out


def recognize(text):
    """엔진 밖을 한 번 거쳐 str 로 돌아온 알림(예: 호스트가 dsm 결과를 aisi_design 에 다시 넘김)을 등록표로
    되짚는다. 템플릿과 글자 그대로 맞고, 다시 그린 글이 원래 글과 같을 때만 Notice — 아니면 None."""
    global _RECOGNIZE
    if isinstance(text, (Notice, NoticeGroup)):
        return text
    if not isinstance(text, str):
        return None
    if _RECOGNIZE is None:
        _RECOGNIZE = _compile_recognizers()
    for _, code, rx, names in _RECOGNIZE:
        m = rx.fullmatch(text)
        if not m:
            continue
        vals = {n: _Raw(m.group(f'p{i}')) for i, n in enumerate(names)}
        vals.update({k: sp['const'] for k, sp in REGISTRY[code]['params'].items() if 'const' in sp})
        if render(REGISTRY[code]['template'], code, vals) == text:
            n = Notice(text, code, vals)
            n.recognized = True
            return n
    return None


def prefixed(prefix: str, item, prefix_ko: str | None = None):
    """하위 결과의 알림에 머리를 붙인다 — 글은 prefix + 옛 글, 출처는 그대로. 그냥 str 은 등록표로 되짚어 본다."""
    pk = prefix if prefix_ko is None else prefix_ko
    if not isinstance(item, (Notice, NoticeGroup)):
        item = recognize(item) or item
    if isinstance(item, Notice):
        out = Notice(prefix + str(item), item.code, item.values, prefix + item.prefix, pk + item.prefix_ko)
        if getattr(item, 'recognized', False):
            out.recognized = True
        return out
    if isinstance(item, NoticeGroup):
        return NoticeGroup(prefix + str(item), item.parts, item.sep, prefix + item.prefix, pk + item.prefix_ko)
    return prefix + str(item)


def joined(sep: str, items) -> str:
    """sep.join 과 같은 글. 알림이 하나라도 있으면 NoticeGroup(이은 조각을 기억)."""
    items = list(items)
    text = sep.join(items)
    if any(isinstance(x, (Notice, NoticeGroup)) for x in items):
        return NoticeGroup(text, items, sep)
    return text


def name_ko_prefix(name: str, sep: str = ': ') -> str:
    """접합부 한계상태 이름(엔진의 영어 이름) → 한국어 머리. 이름이 이미 한국어면 그대로.
    검토 항목 등록표(checks.REGISTRY)의 name_ko 와 조항 — 한 곳의 이름을 쓴다."""
    s = str(name or '')
    if _HANGUL.search(s):
        return s + sep
    from design.checks import REGISTRY as CHECKS, connection_check_id, _PART2
    cid = connection_check_id(s)
    if cid is None or cid not in CHECKS:
        return s + sep
    r = CHECKS[cid]
    m = re.search(r'\(([^()]*)\)', s)
    clause = m.group(1) if m else r['clause']
    return f"{r['name_ko']} ({clause})" + (_PART2 if s.endswith(_PART2) else '') + sep


def _num(v):
    if hasattr(v, 'item') and getattr(v, 'ndim', 1) == 0:
        v = v.item()
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def params_of(n: Notice) -> list:
    """매개변수 목록 [{symbol, value, quantity, fmt, (conv), (unit_text, sep), (notice)}]."""
    out = []
    for name, spec in REGISTRY[n.code]['params'].items():
        v = n.values.get(name)
        if spec.get('text') is not None:
            # 템플릿의 치수 상수: value = 엔진 단위(US)의 수, text = US 글자(3/16 · 33 …) — SI 는 value 를 바꾼다
            p = {'symbol': name, 'value': _num(spec['const']), 'quantity': spec.get('quantity'), 'fmt': 'raw',
                 'text': spec['text'], 'const': True}
            if spec.get('unit'):
                p['unit_text'] = spec['unit']
                p['sep'] = spec.get('sep') or ''
            out.append(p)
            continue
        if isinstance(v, _Raw):
            try:
                num = float(v)
            except ValueError:
                num = None
            if num is not None and math.isfinite(num) and spec.get('quantity'):
                p = {'symbol': name, 'value': num, 'quantity': spec.get('quantity'), 'text': str(v)}
            else:
                p = {'symbol': name, 'value': str(v), 'quantity': None}
            p['fmt'] = 'raw'
            if spec.get('unit'):
                p['unit_text'] = spec['unit']
                p['sep'] = spec.get('sep') or ''
            out.append(p)
            continue
        if _is_number(v):
            p = {'symbol': name, 'value': _num(v), 'quantity': spec.get('quantity')}
        else:
            p = {'symbol': name, 'value': _piece(dict(spec, unit=None), v), 'quantity': None}
        p['fmt'] = spec.get('spec') or ''
        if spec.get('conv'):
            p['conv'] = spec['conv']
        if spec.get('unit'):
            p['unit_text'] = spec['unit']
            p['sep'] = spec.get('sep') or ''
        if isinstance(v, (Notice, NoticeGroup)):
            p['notice'] = entry(v)
        out.append(p)
    return out


def entry(n, list_name=None, check_id=None) -> dict:
    """구조화된 알림 하나. 등록되지 않은 글(옛 str)은 code None — 시험이 잡는다."""
    extra = {}
    if list_name:
        extra['list'] = list_name
    if check_id:
        extra['check_id'] = check_id
    if isinstance(n, NoticeGroup):
        parts = [entry(x) for x in n.parts]
        out = {'code': None, 'kind': 'group', 'text': str(n), 'text_ko': text_ko(n), 'sep': n.sep, 'parts': parts}
        if n.prefix:
            out['prefix'], out['prefix_ko'] = n.prefix, n.prefix_ko
        out.update(extra)
        return out
    if not isinstance(n, Notice):
        r = recognize(n)
        if r is None:
            return {'code': None, 'kind': None, 'text': str(n), 'text_ko': None, **extra}
        n = r
    ent = REGISTRY[n.code]
    out = {
        'code': n.code, 'kind': ent['kind'], 'text': str(n), 'text_ko': text_ko(n),
        'template': ent['template'], 'template_ko': ent['template_ko'],
        'params': params_of(n),
    }
    if n.prefix:
        out['prefix'], out['prefix_ko'] = n.prefix, n.prefix_ko
    if getattr(n, 'recognized', False):
        out['recognized'] = True
    out.update(extra)
    return out


NOTICE_LISTS = ('warnings', 'assumptions', 'scope_notes', 'not_evaluated', 'not_checked', 'reasons', 'dsm_warnings')


def notices_of(result: dict, lists=NOTICE_LISTS) -> list:
    """결과의 문자열 목록들 → 구조화된 목록. 접합부 not_evaluated 의 dict 항목({name, reason, …})은 그 reason 을
    싣고 subject 에 이름을 둔다."""
    out = []
    for key in lists:
        for item in result.get(key) or []:
            if isinstance(item, dict):
                r = item.get('reason')
                if r is None:
                    continue
                e = entry(r, key)
                e['subject'] = item.get('name')
                out.append(e)
            else:
                out.append(entry(item, key))
    return out


_REASON_KEYS = ('reason_code', 'reason_kind', 'reason_ko', 'reason_template', 'reason_template_ko',
                'reason_params', 'reason_parts', 'reason_sep', 'reason_prefix', 'reason_prefix_ko')


def fields(n, prefix: str) -> dict:
    """글 하나(이유 · 이름표 …) → {prefix}_code · _kind · _ko · _template(_ko) · _params (이은 글은 _parts · _sep,
    머리는 _prefix · _prefix_ko). 검토 항목의 reason_* 와 같은 모양(계약 §16.2)."""
    if n is None:
        return {}
    e = entry(n)
    out = {f'{prefix}_code': e['code'], f'{prefix}_kind': e['kind'], f'{prefix}_ko': e['text_ko']}
    if e['kind'] == 'group':
        out[f'{prefix}_parts'] = e['parts']
        out[f'{prefix}_sep'] = e['sep']
    elif e['code'] is not None:
        out[f'{prefix}_template'] = e['template']
        out[f'{prefix}_template_ko'] = e['template_ko']
        out[f'{prefix}_params'] = e['params']
    if 'prefix' in e:
        out[f'{prefix}_prefix'], out[f'{prefix}_prefix_ko'] = e['prefix'], e['prefix_ko']
    return out


def reason_fields(reason) -> dict:
    """검토 항목의 reason → reason_code · reason_ko · reason_template(_ko) · reason_params, 이은 이유는
    reason_parts · reason_sep(조각마다 같은 모양)."""
    return fields(reason, 'reason')


_SU_KEYS = tuple('steps_unavailable' + k[len('reason'):] for k in _REASON_KEYS)
_NO_DESCEND = ('notices', 'design_checks', 'steps', 'lap_section')


def attach(result: dict, lists=NOTICE_LISTS) -> dict:
    """결과에 notices 를 달고, 그 결과의 design_checks 항목마다 지금의 reason 으로 reason_* 를 단다.
    알림 목록을 가진 하위 블록(fastener_design · shear · web_crippling · auto_params.i621_check …)에도 그 블록의
    notices 를 단다(계약 §16.2 — 블록마다 자기 것). 여러 번 불러도 같다(마지막 상태로 다시 만든다)."""
    if not isinstance(result, dict):
        return result
    result['notices'] = notices_of(result, lists)
    _annotate(result)
    for c in result.get('design_checks') or []:
        if not isinstance(c, dict):
            continue
        for k in _REASON_KEYS + _SU_KEYS:
            c.pop(k, None)
        c.update(reason_fields(c.get('reason')))
        _annotate(c)                         # 검토 항목의 note · reference.basis · ratio_form …(계산 과정 steps 는 빼고)
        su = c.get('steps_unavailable')
        if su is not None and str(su) != str(c.get('reason')):
            c.update(fields(su, 'steps_unavailable'))
    _attach_blocks(result, lists)
    return result


# ---------------------------------------------------------------- 이름표 · 설명 글 (계약 §16.11, K4d)
# 결과 안의 글 하나(알림)는 옆에 {key}_code · _ko · _template … (fields), 글로 된 사전 · 목록(하중별 배치 이름표, 좌굴값
# 출처, 랩의 알려진 한계 …)은 옆에 {key}_notices 를 단다 — 사전의 키를 더럽히지 않게.
_NO_ANNOTATE = ('notices', 'steps', 'design_checks', 'steps_unavailable') + NOTICE_LISTS
_GOV_GROUP = {
    'F flexure': 'member.flexure', 'E axial compression': 'member.compression', 'D tension': 'member.tension',
    'G5 web crippling': 'member.web_crippling', 'H2 bending + shear': 'member.bending_shear',
    'H3 bending + web crippling': 'member.bending_web_crippling', 'H1.2 axial + bending': 'member.axial_bending',
    'F positive region': 'member.flexure_positive', 'H1.1-1 tension + bending': 'member.tension_bending',
}
_MODES = {
    'Local Buckling': ('member.label.mode_local', 'local'),
    'Distortional Buckling': ('member.label.mode_distortional', 'distortional'),
    'Global/LTB': ('member.label.mode_global_ltb', 'global'), 'Yielding': ('member.label.mode_yielding', 'yielding'),
    'Rupture': ('member.label.mode_rupture', 'rupture'),
    'User-supplied weak-axis strength': ('member.label.mode_user_weak_axis', 'global'),
}
_GLOBAL_KINDS = {'flexural': 'member.label.mode_global_flexural', 'torsional': 'member.label.mode_global_torsional',
                 'flexural-torsional': 'member.label.mode_global_flexural_torsional',
                 'unsupported-nonsymmetric': 'member.label.mode_global_unsupported',
                 'user/rational analysis': 'member.label.mode_global_user',
                 'not evaluated': 'member.label.mode_global_not_evaluated'}


def _is_notice(x):
    return isinstance(x, (Notice, NoticeGroup))


def _label_entry(x):
    e = entry(x)
    if e.get('code') == 'loads.label.pattern_spans_loaded':
        e['spans'] = [int(v) for v in str(x.values['spans']).split(',') if v.strip()]
    return e


def _mode_notice(mode):
    """부재의 controlling_mode 글 → 이름표 알림과 그 검토 항목의 끝 이름(local · global …)."""
    m = str(mode)
    if m in _MODES:
        code, tail = _MODES[m]
        return N(code), tail
    r = re.fullmatch(r'§I6\.2\.1 R-factor \(R=(.*)\)', m)
    if r:
        return Notice(m, 'member.label.mode_r_factor', {'R': _Raw(r.group(1))}), 'uplift_r'
    g = re.fullmatch(r'Global Buckling \((.*)\)', m)
    if g:
        kind = g.group(1)
        if kind in _GLOBAL_KINDS:
            return N(_GLOBAL_KINDS[kind]), 'global'
        return N('member.label.mode_global_other', buckling_type=kind), 'global'
    return None, None


def _governing_check_id(d):
    name = d.get('governing_check')
    from design.checks import REGISTRY as CHECKS
    if name in CHECKS:
        return name
    g = _GOV_GROUP.get(str(name))
    if g is None:
        return None
    checks = [c for c in d.get('design_checks') or [] if isinstance(c, dict) and c.get('group') == g]
    for c in checks:
        if c.get('governs'):
            return c['id']
    ids = [k for k, r in CHECKS.items() if r['group'] == g]
    return ids[0] if len(ids) == 1 else (checks[0]['id'] if checks else None)


def _mode_fields(d, member_type):
    from design.checks import REGISTRY as CHECKS, connection_check_id
    if isinstance(d.get('governing_check'), str) and 'governing_check_id' not in d:
        d['governing_check_id'] = _governing_check_id(d)
    mode = d.get('controlling_mode')
    if isinstance(mode, str) and 'controlling_mode_code' not in d:
        n, tail = _mode_notice(mode)
        if n is not None:
            d.update(fields(n, 'controlling_mode'))
            mt = d.get('member_type', member_type)
            group = {'tension': 'member.tension', 'compression': 'member.compression'}.get(mt, 'member.flexure')
            cid = f'{group}.{tail}'
            d['controlling_mode_id'] = cid if cid in CHECKS else None
    for k in list(d):
        if not isinstance(k, str):
            continue
        if (k == 'governing_mode' or k.endswith('_governing_mode')) and isinstance(d[k], str) and f'{k}_id' not in d:
            d[f'{k}_id'] = connection_check_id(d[k])


def _is_field_key(d, k):
    """이 걸음이 단 필드인가 — {key}_notices · {key}_params · {key}_parts (auto_params 같은 이름은 아님)."""
    for suf in ('_notices', '_params', '_parts'):
        if k.endswith(suf) and (k[:-len(suf)] in d or suf == '_notices'):
            return True
    return False


def _annotate(d, member_type=None):
    if isinstance(d, list):
        for x in d:
            _annotate(x, member_type)
        return
    if not isinstance(d, dict):
        return
    vals = [x for x in d.values() if x is not None]
    if vals and all(_is_notice(x) for x in vals):
        return                               # 글로 된 사전(하중별 이름표 …) — 키를 더럽히지 않는다, 위가 {k}_notices 를 단다
    mt = d.get('member_type', member_type)
    _mode_fields(d, mt)
    for k in list(d):
        v = d[k]
        if not isinstance(k, str) or k in _NO_ANNOTATE or _is_field_key(d, k):
            continue
        if _is_notice(v):
            if f'{k}_code' not in d:
                d.update(fields(v, k))
        elif isinstance(v, dict):
            vals = [x for x in v.values() if x is not None]
            if vals and all(_is_notice(x) for x in vals):
                d[f'{k}_notices'] = {kk: _label_entry(x) for kk, x in v.items() if x is not None}
            else:
                _annotate(v, {'compression': 'compression', 'flexure_x': 'flexure', 'flexure_y': 'flexure',
                              'tension': 'tension'}.get(k, mt))
        elif isinstance(v, (list, tuple)) and v:
            if all(_is_notice(x) for x in v):
                d[f'{k}_notices'] = [_label_entry(x) for x in v]
            elif all(isinstance(x, dict) and all(_is_notice(y) for y in x.values()) for x in v) and any(v):
                d[f'{k}_notices'] = [{kk: _label_entry(y) for kk, y in x.items()} for x in v]
            else:
                _annotate(list(v), mt)


def _attach_blocks(d: dict, lists):
    for k, v in d.items():
        if k in _NO_DESCEND or not isinstance(v, dict):
            continue
        if any(isinstance(v.get(x), list) for x in lists):
            attach(v, lists)
        else:
            _attach_blocks(v, lists)


__all__ = ['N', 'Notice', 'NoticeGroup', 'prefixed', 'joined', 'name_ko_prefix', 'notices_of', 'attach',
           'reason_fields', 'fields', 'render', 'text_ko', 'entry', 'recognize', 'REGISTRY', 'KINDS', 'NOTICE_LISTS']
