"""한국어 용어표 — 검토 항목의 이름(name_ko)과 알림의 한국어 글이 쓰는 말의 한 곳(계약 §16.5).

한 개념에 한 낱말. 붙여 쓰는 꼴(KDS 의 표기)을 쓴다. VARIANTS 의 꼴(띄어 쓴 꼴 · 다른 말)은 이름과 한국어 템플릿에
나오면 안 된다 — 시험(test_review_1124_notices.py)이 확인한다.

용어 하나를 바꾸려면(예: 「웹 크리플링」 → 「웨브 크리플링」) 아래 WEB_CRIPPLING 한 줄을 고친다 — 등록표의 글은
저장된 꼴('웹 크리플링')로 두고, 읽어 들일 때 localize 가 바꿔 넣는다(검토 항목 이름 · 알림 템플릿).
"""

import re

# 한 줄로 바꿀 수 있는 용어(저장된 꼴 → 지금 쓰는 꼴)
WEB_CRIPPLING = '웹 크리플링'
_STORED = {'웹 크리플링': WEB_CRIPPLING}

# (영어, 한국어, 쓰지 않는 꼴의 정규식들)
TERMS = (
    ('local buckling', '국부좌굴', (r'국부\s+좌굴',)),
    ('distortional buckling', '뒤틀림좌굴', (r'뒤틀림\s+좌굴', r'왜곡\s*좌굴')),
    ('lateral-torsional buckling', '횡비틀림좌굴', (r'횡\s+비틀림', r'횡비틀림\s+좌굴', r'횡좌굴')),
    ('flexural buckling', '휨좌굴', (r'휨\s+좌굴',)),
    ('torsional buckling', '비틀림좌굴', (r'(?<![횡휨])비틀림\s+좌굴',)),
    ('flexural-torsional buckling', '휨비틀림좌굴', (r'휨\s*-\s*비틀림', r'휨\s+비틀림\s*좌굴')),
    ('global buckling', '전체좌굴', (r'전체\s+좌굴', r'전체\s+탄성좌굴')),
    ('web crippling', WEB_CRIPPLING, ()),
    ('effective width', '유효폭', (r'유효\s+폭',)),
    ('effective section modulus', '유효단면계수', (r'유효\s+단면\s*계수', r'단면\s+계수')),
    ('net section', '순단면', (r'순\s+단면',)),
    ('gross section', '총단면', (r'총\s+단면',)),
    ('shear lag', '전단지연', (r'전단\s+지연',)),
    ('block shear', '블록전단', (r'블록\s+전단',)),
    ('block shear rupture', '블록전단파단', (r'블록전단\s+파단',)),
    ('rupture', '파단', ()),
    ('bearing', '지압', ()),
    ('pull-over · pull-out', '풀오버 · 뽑힘', ()),
    ('end distance', '끝단 거리', (r'끝단거리',)),
    ('edge distance', '연단 거리', (r'연단거리',)),
    ('unbraced length', '비지지 길이', (r'비지지길이',)),
    ('required strength', '소요강도', (r'소요\s+강도',)),
    ('nominal strength', '공칭강도', (r'공칭\s+강도',)),
    ('design / available strength', '설계강도 · 가용강도', (r'설계\s+강도', r'가용\s+강도')),
    ('shear · tensile · compressive · flexural strength', '전단강도 · 인장강도 · 압축강도 · 휨강도',
     (r'(?<![가-힣])(전단|인장|압축|휨)\s+강도',)),
    ('limit state', '한계상태', (r'한계\s+상태',)),
    ('applicability limit', '적용한계', (r'적용\s+한계',)),
    ('scope', '적용범위', (r'적용\s+범위',)),
    ('half-wavelength', '반파장', (r'반\s+파장',)),
    ('signature curve', '서명곡선', (r'서명\s+곡선',)),
    ('load factor', '하중계수', (r'하중\s+계수',)),
    ('not evaluated · not given · not applicable', '미평가 · 미입력 · 해당 없음', ()),
    ('braced · bracing', '횡지지 · 가새', (r'횡\s+지지',)),
    ('lap · lapped section', '랩 · 겹친 단면', ()),
    ('uplift', '양력', ()),
    ('conservative · unconservative', '보수측 · 비보수', ()),
    ('reference only', '참고값', ()),
)

# 웹 크리플링은 지금 쓰는 꼴이 아닌 것을 모두 막는다
_WEB_VARIANTS = tuple(v for v in ('웹 크리플링', '웹크리플링', '웨브 크리플링', '웨브크리플링') if v != WEB_CRIPPLING)
VARIANTS = tuple(re.compile(p) for _, _, ps in TERMS for p in ps) + tuple(re.compile(re.escape(v))
                                                                            for v in _WEB_VARIANTS)


def localize(text):
    """저장된 꼴을 지금 쓰는 꼴로(WEB_CRIPPLING 을 바꾼 경우에만 글이 달라진다)."""
    if not isinstance(text, str):
        return text
    for stored, now in _STORED.items():
        if stored != now:
            text = text.replace(stored, now)
    return text


def violations(text):
    """용어표에 없는 꼴 — [(쓰지 않는 꼴, 찾은 글)]."""
    out = []
    for rx in VARIANTS:
        for m in rx.finditer(text or ''):
            out.append((rx.pattern, m.group(0)))
    return out
