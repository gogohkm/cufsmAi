/**
 * 기록(R2-1) · 변경의 사람 말 제목 — 설계 §2.4.4 · §5.1. 제목은 **프로그램이 칸에서 짓는다**(AI 글이 아니다).
 *
 *  - 「<이름> <전> → <후> <단위>」 만 말한다. 좋다 · 나쁘다 · 안전측 같은 공학 판단을 넣지 않는다.
 *  - 단위는 제품의 `src/mcp/siUnits.ts`(`toSI` · `UNIT_LABEL`)로 바꾼다 — 값은 US 로 저장돼 있다.
 *  - 수는 유효숫자 6 자리에서 끝의 0 을 지운 꼴(반올림이 판단을 만들지 않게 — 값은 기록에 그대로 있다).
 *  - 검토 키의 이름은 호스트가 넘긴다(`labelOf` — 입력 목록의 이름). 없으면 키 그대로.
 * 파일을 읽거나 쓰지 않는다.
 */
import { toSI, UNIT_LABEL, UnitKey } from '../mcp/siUnits';
import type { ArraySummary, FieldChange } from './differ';

export type DisplayUnits = 'SI' | 'US';
export type LabelFn = (path: string) => string | null;

const MODEL_LABELS: Record<string, string> = {
    'model.sectionTemplate': '단면 템플릿', 'model.sectionParams.H': '높이 H', 'model.sectionParams.B': '폭 B',
    'model.sectionParams.D': '립 D', 'model.sectionParams.t': '두께 t', 'model.sectionParams.r': '안쪽 반지름 r',
    'model.sectionEdited': '단면 손 편집', 'model.node': '절점', 'model.elem': '요소',
    'model.prop.E': '탄성계수 E', 'model.prop.Ey': '탄성계수 Ey', 'model.prop.nu': '푸아송비 ν', 'model.prop.nuy': '푸아송비 νy',
    'model.prop.G': '전단탄성계수 G', 'model.prop.rows': '재료 줄',
    'model.BC': '경계조건', 'model.neigs': '고유치 수', 'model.loadCase': '하중 경우', 'model.loadFy': '기준 응력',
    'model.sectionParams.(other)': '치수', 'case.inputs.(other)': '입력', 'case.mcpOnly.(other)': 'MCP 인자',
    'model.lengths': '반파장', 'model.m_all': '종방향 항', 'model.springs': '스프링', 'model.constraints': '구속', 'model.GBTcon': 'cFSM 설정',
};

/** 칸의 이름 */
export function fieldLabel(path: string, labelOf?: LabelFn): string {
    const given = labelOf?.(path);
    if (given) { return given; }
    if (MODEL_LABELS[path]) { return MODEL_LABELS[path]; }
    let m = /^model\.sectionParams\.(.+)$/.exec(path);
    if (m) { return `치수 ${m[1]}`; }
    m = /^case\.spans\.spans\[(\d+)\]$/.exec(path);
    if (m) { return `경간 ${Number(m[1]) + 1}`; }
    m = /^case\.spans\.supports\[(\d+)\]$/.exec(path);
    if (m) { return `지점 ${Number(m[1]) + 1}`; }
    m = /^case\.spans\.lapsPerSupport\[(\d+)\]\.(left|right)$/.exec(path);
    if (m) { return `지점 ${Number(m[1]) + 1} 랩 ${m[2] === 'left' ? '왼쪽' : '오른쪽'}`; }
    m = /^case\.inputs\.(.+)$/.exec(path);
    if (m) { return m[1]; }
    m = /^case\.mcpOnly\.([^.]+)\.(.+)$/.exec(path);
    if (m) { return `${m[1]} · ${m[2]}`; }
    return path;
}

/** 수 하나의 글 — 유효숫자 `digits`(기본 6) 자리, 끝의 0 지움 */
export function formatNumber(v: number, digits = 6): string {
    if (!Number.isFinite(v)) { return String(v); }
    if (v === 0) { return '0'; }
    return String(Number(v.toPrecision(Math.min(Math.max(digits, 1), 17))));
}

/** 글 값 — 제어 · 글 방향 · 줄바꿈 글자를 지우고, 화살표를 바꾸고, 「」 로 감싼다(값이 제목의 꼴을 흉내 내지 못하게 — V7-24 ④ · ⑥) */
function quoteText(v: string): string {
    // eslint-disable-next-line no-control-regex
    let t = v.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/g, ' ').replace(/[\u2192\u21d2\u2794\u27f6]/g, '->').trim();
    if ([...t].length > 40) { t = [...t].slice(0, 40).join('') + '…'; }
    return `「${t}」`;
}

/** 값 하나의 글(표시 단위로). 수는 `digits` 자리 */
export function formatValue(v: unknown, unit: UnitKey | null, units: DisplayUnits, digits = 6): string {
    if (v === null || v === undefined || v === '') { return '(빈 칸)'; }
    if (typeof v === 'boolean') { return v ? '켬' : '끔'; }
    if (typeof v === 'number') { return formatNumber(unit && units === 'SI' ? toSI(v, unit) : v, digits); }
    if (Array.isArray(v)) {
        if (v.length <= 4 && v.every((x) => typeof x === 'number' || x === null)) { return v.map((x) => formatValue(x, unit, units, digits)).join(', '); }
        return `${v.length}개`;
    }
    if (typeof v === 'string') { return quoteText(v); }
    return '(값)';
}

/**
 * 전 → 후 의 두 글 — **다른 값이 같은 글로 보이지 않게**(V7-24 ①). 6 자리에서 같아 보이면 17 자리까지 늘린다. 그래도 같은 글이면
 * (예: 0 과 -0, 표시 단위 바꿈의 끝자리) 「(끝자리만 다름)」 을 붙인다 — 값은 기록에 그대로 있다.
 */
export function formatPair(from: unknown, to: unknown, unit: UnitKey | null, units: DisplayUnits): [string, string] {
    let a = formatValue(from, unit, units), b = formatValue(to, unit, units);
    for (let d = 7; a === b && d <= 17; d += 1) { a = formatValue(from, unit, units, d); b = formatValue(to, unit, units, d); }
    if (a === b) { b += ' (끝자리만 다름)'; }
    return [a, b];
}

export function unitLabel(unit: UnitKey | null, units: DisplayUnits): string {
    return unit ? UNIT_LABEL[unit][units] : '';
}

function summaryText(label: string, s: ArraySummary): string {
    if (s.count.from !== s.count.to) { return `${label} ${s.count.from} → ${s.count.to}개`; }
    return `${label} ${s.count.to}개 중 ${s.changed}개 바뀜${s.columns && s.columns.length ? ` (${s.columns.join(' · ')})` : ''}`;
}

/** 칸 하나의 한 줄 */
export function fieldText(f: FieldChange, units: DisplayUnits, labelOf?: LabelFn): string {
    const label = fieldLabel(f.path, labelOf);
    if (f.odd !== undefined) { return `${label}(이름 꼴 밖) ${f.odd}개 바뀜`; }
    if (f.summary) { return summaryText(label, f.summary); }
    const u = unitLabel(f.unit, units);
    const [a, b] = formatPair(f.from, f.to, f.unit, units);
    return `${label} ${a} → ${b}${u && typeof f.to === 'number' ? ` ${u}` : ''}`;
}

/** 칸의 무게 — 상대 변화 |후 − 전| / max(|전|, |후|). 수가 아닌 변경 · 요약은 1(가장 크다고 본다) */
function weight(f: FieldChange): number {
    if (f.summary || f.odd !== undefined) { return f.explainedBy ? 0 : 1; }
    if (typeof f.from === 'number' && typeof f.to === 'number') {
        const m = Math.max(Math.abs(f.from), Math.abs(f.to));
        return m === 0 ? 0 : Math.abs(f.to - f.from) / m;
    }
    return 1;
}

/**
 * 변경 하나의 제목 — 무게가 가장 큰 칸(같으면 앞의 것) + 「외 n」(V7-24 ③). n 은 나머지 칸 전부 — 템플릿 치수로 설명되는
 * 절점 · 요소 요약(`explainedBy`)만 뺀다(②). 칸이 없으면 null.
 */
export function changeTitle(fields: FieldChange[], units: DisplayUnits = 'SI', labelOf?: LabelFn): string | null {
    if (!fields.length) { return null; }
    const candidates = fields.filter((f) => !f.explainedBy);
    const pool = candidates.length ? candidates : fields;
    let primary = pool[0];
    for (const f of pool) { if (weight(f) > weight(primary)) { primary = f; } }
    const rest = fields.filter((f) => f !== primary && !f.explainedBy).length;
    return fieldText(primary, units, labelOf) + (rest > 0 ? ` 외 ${rest}` : '');
}
