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

/** 수 하나의 글 — 유효숫자 6 자리, 끝의 0 지움 */
export function formatNumber(v: number): string {
    if (!Number.isFinite(v)) { return String(v); }
    if (v === 0) { return '0'; }
    return String(Number(v.toPrecision(6)));
}

/** 값 하나의 글(표시 단위로) */
export function formatValue(v: unknown, unit: UnitKey | null, units: DisplayUnits): string {
    if (v === null || v === undefined || v === '') { return '(빈 칸)'; }
    if (typeof v === 'boolean') { return v ? '켬' : '끔'; }
    if (typeof v === 'number') { return formatNumber(unit && units === 'SI' ? toSI(v, unit) : v); }
    if (Array.isArray(v)) {
        if (v.length <= 4 && v.every((x) => typeof x === 'number' || x === null)) { return v.map((x) => formatValue(x, unit, units)).join(', '); }
        return `${v.length}개`;
    }
    if (typeof v === 'string') { return [...v].length > 40 ? [...v].slice(0, 40).join('') + '…' : v; }
    return '(값)';
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
    if (f.summary) { return summaryText(label, f.summary); }
    const u = unitLabel(f.unit, units);
    return `${label} ${formatValue(f.from, f.unit, units)} → ${formatValue(f.to, f.unit, units)}${u ? ` ${u}` : ''}`;
}

/** 변경 하나의 제목 — 뜻이 있는 칸(요약이 아닌 것) 하나 + 「외 n」. 칸이 없으면 null */
export function changeTitle(fields: FieldChange[], units: DisplayUnits = 'SI', labelOf?: LabelFn): string | null {
    if (!fields.length) { return null; }
    const primary = fields.find((f) => !f.summary) ?? fields[0];
    const rest = fields.filter((f) => f !== primary && !(f.summary && fields.some((g) => !g.summary && g.group === f.group))).length;
    return fieldText(primary, units, labelOf) + (rest > 0 ? ` 외 ${rest}` : '');
}
