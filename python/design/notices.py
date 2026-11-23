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
                g = f'p{len(names)}'
                names.append(name)
                unit = re.escape((sp.get('sep') or '') + sp['unit']) if sp.get('unit') else ''
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


NOTICE_LISTS = ('warnings', 'assumptions', 'scope_notes', 'not_evaluated')


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


def reason_fields(reason) -> dict:
    """검토 항목의 reason → reason_code · reason_ko · reason_template(_ko) · reason_params, 이은 이유는
    reason_parts · reason_sep(조각마다 같은 모양)."""
    if reason is None:
        return {}
    e = entry(reason)
    out = {'reason_code': e['code'], 'reason_kind': e['kind'], 'reason_ko': e['text_ko']}
    if e['kind'] == 'group':
        out['reason_parts'] = e['parts']
        out['reason_sep'] = e['sep']
    elif e['code'] is not None:
        out['reason_template'] = e['template']
        out['reason_template_ko'] = e['template_ko']
        out['reason_params'] = e['params']
    if 'prefix' in e:
        out['reason_prefix'], out['reason_prefix_ko'] = e['prefix'], e['prefix_ko']
    return out


def attach(result: dict, lists=NOTICE_LISTS) -> dict:
    """결과에 notices 를 달고, 그 결과의 design_checks 항목마다 지금의 reason 으로 reason_* 를 단다.
    하위 결과(fastener_design)에도 같은 일을 한다. 여러 번 불러도 같다(마지막 상태로 다시 만든다)."""
    if not isinstance(result, dict):
        return result
    result['notices'] = notices_of(result, lists)
    for c in result.get('design_checks') or []:
        if not isinstance(c, dict):
            continue
        for k in _REASON_KEYS:
            c.pop(k, None)
        c.update(reason_fields(c.get('reason')))
    sub = result.get('fastener_design')
    if isinstance(sub, dict):
        attach(sub, lists)
    return result


__all__ = ['N', 'Notice', 'NoticeGroup', 'prefixed', 'joined', 'name_ko_prefix', 'notices_of', 'attach',
           'reason_fields', 'render', 'text_ko', 'entry', 'recognize', 'REGISTRY', 'KINDS', 'NOTICE_LISTS']
