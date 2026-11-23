/**
 * 기록(R3-1) · 가정 등록부 — 설계 §2.4.6, 결정 D7.
 *
 *  - AI 가 쓰는 가정(origin `ai`) — `prepareAssumption`(한도를 넘으면 거절).
 *  - 호스트가 자동으로 쓰는 가정 — 계산하지 않고 고르기만 한다:
 *    (a) `planDefaultAssumptions`: 실행의 엔진 요청에 든 키 가운데 출처가 `default` 이고 「손으로 정한 공학 기본값」인 것을
 *        표의 묶음마다 한 항목(「<묶음>: <칸들> — 입력 기본값 그대로」). 값이 정해지면 닫는다.
 *    (b) `planEngineAssumptions`: 결과가 밝힌 엔진 자체 가정 · 범위 알림을 결과 종류 + 부호(없으면 글의 해시)마다 한 항목. 사라지면 닫는다.
 *  - 「확정」 · 「해당 없음」 · AI 가 닫은 것은 사람이 그 판(마지막 seq)에 확인 표시를 해야 발행을 막는 것에서 빠진다
 *    (`blocksIssue` — 결정 D7 · 설계 §2.6). 프로그램이 닫은 자동 가정만 확인 없이 풀린다.
 *  - 접기는 세는 줄(`ok`)만 — 검증 안 된 줄은 상태를 바꾸지 못한다(V7-23). 다음 번호도 세는 줄에서만(V7-30).
 * 파일을 읽거나 쓰지 않는다.
 */
import { countable, type LogSpec, type RecordLine, type LineStatus } from './log';
import { cleanText, ID_RE } from './names';
import { CASE_ID_RE } from './project';
import { Ref, sanitizeRefs } from './refs';
import { sha256Hex } from './canonical';

export const ASSUMPTION_STATUS = ['provisional', 'firm', 'field-check', 'not-applicable'] as const;
export type AssumptionStatus = typeof ASSUMPTION_STATUS[number];
export const ASSUMPTION_ORIGINS = ['ai', 'program-default', 'program-engine'] as const;
export type AssumptionOrigin = typeof ASSUMPTION_ORIGINS[number];
export const ASSUMPTION_EVENTS = ['add', 'update', 'close'] as const;
export const ASSUMPTION_LIMITS = { text: 300, basis: 2000, impact: 600, scope: 40, sources: 10, originKey: 120 };
const ITEM_RE = /^A-[0-9]{2,4}$/;
const SOURCE_ID_RE = /^S-[1-9][0-9]{0,3}$/;

export class AssumptionInputError extends Error {}

export interface AssumptionSourceRef { id: string; page?: string; area?: string }
export interface AssumptionBody {
    item: string; caseId?: string | null; text?: string; basis?: string; status?: AssumptionStatus; scope?: Ref[];
    sources?: AssumptionSourceRef[]; impact?: string; origin?: AssumptionOrigin; originKey?: string; closedBy?: string;
}

function txt(raw: unknown, max: number, field: string, optional = false): string {
    const r = cleanText(raw, max, { field, optional });
    if (!r.ok) { throw new AssumptionInputError(r.error); }
    return r.text;
}
function sources(raw: unknown): AssumptionSourceRef[] {
    if (raw === undefined) { return []; }
    if (!Array.isArray(raw) || raw.length > ASSUMPTION_LIMITS.sources) { throw new AssumptionInputError(`sources: at most ${ASSUMPTION_LIMITS.sources}`); }
    return raw.map((s: any, i) => {
        if (!s || typeof s.id !== 'string' || !SOURCE_ID_RE.test(s.id)) { throw new AssumptionInputError(`sources[${i}].id must be like S-1`); }
        const o: AssumptionSourceRef = { id: s.id };
        if (s.page !== undefined) { o.page = txt(s.page, 20, `sources[${i}].page`); }
        if (s.area !== undefined) { o.area = txt(s.area, 80, `sources[${i}].area`); }
        return o;
    });
}

export interface Assumption {
    key: string; item: string; caseId: string | null; text: string; basis: string; status: AssumptionStatus; scope: Ref[];
    sources: AssumptionSourceRef[]; impact: string; origin: AssumptionOrigin; originKey: string | null;
    closed: boolean; closedBy: string | null;
    /** 닫은 줄의 행위자가 프로그램인가(자동 가정의 원인이 사라져 닫힘 — 확인 없이 풀리는 유일한 경우) */
    closedByProgram: boolean;
    writer: string; createdAt: string; lastSeq: number; lastAt: string; status_line: LineStatus;
    history: Array<{ event: string; at: string; writer: string; status?: AssumptionStatus; status_line: LineStatus }>;
}

export function nextAssumptionId(lines: RecordLine[]): string {
    let max = 0;
    for (const l of lines) { if (countable(l) && l.event === 'add' && typeof l.body.item === 'string' && ITEM_RE.test(l.body.item)) { max = Math.max(max, Number(l.body.item.slice(2))); } }
    const next = `A-${String(max + 1).padStart(2, '0')}`;
    if (!ITEM_RE.test(next)) { throw new AssumptionInputError('no more assumption ids in this project'); }
    return next;
}

/** AI 의 쓰기. `add {text, basis?, status, scope?, sources?, impact?, caseId?}` · `update {item, …}` · `close {item, basis?}` */
export function prepareAssumption(event: string, args: any, lines: RecordLine[], origin: AssumptionOrigin = 'ai'):
{ id: string; event: string; body: AssumptionBody } {
    if (!(ASSUMPTION_EVENTS as readonly string[]).includes(event)) { throw new AssumptionInputError(`unknown action '${String(event).slice(0, 20)}'`); }
    const a = args && typeof args === 'object' ? args : {};
    const fill = (body: AssumptionBody, partial: boolean) => {
        if (a.text !== undefined || !partial) { body.text = txt(a.text, ASSUMPTION_LIMITS.text, 'text'); }
        if (a.basis !== undefined) { body.basis = txt(a.basis, ASSUMPTION_LIMITS.basis, 'basis', true); }
        if (a.status !== undefined || !partial) {
            if (!(ASSUMPTION_STATUS as readonly string[]).includes(a.status)) { throw new AssumptionInputError('status must be provisional | firm | field-check | not-applicable'); }
            body.status = a.status;
        }
        if (a.scope !== undefined) { const s = sanitizeRefs(a.scope, ASSUMPTION_LIMITS.scope); if (!s) { throw new AssumptionInputError('scope is not valid'); } body.scope = s; }
        if (a.sources !== undefined) { body.sources = sources(a.sources); }
        if (a.impact !== undefined) { body.impact = txt(a.impact, ASSUMPTION_LIMITS.impact, 'impact', true); }
    };
    if (event === 'add') {
        if (a.caseId !== undefined && a.caseId !== null && (typeof a.caseId !== 'string' || !CASE_ID_RE.test(a.caseId))) { throw new AssumptionInputError('caseId is not valid'); }
        const id = nextAssumptionId(lines);
        const body: AssumptionBody = { item: id, caseId: a.caseId ?? null, origin };
        fill(body, false);
        if (origin !== 'ai') {
            if (typeof a.originKey !== 'string' || !a.originKey || a.originKey.length > ASSUMPTION_LIMITS.originKey) { throw new AssumptionInputError('originKey is required for a program assumption'); }
            body.originKey = a.originKey;
        }
        return { id, event, body };
    }
    if (typeof a.item !== 'string' || !ITEM_RE.test(a.item)) { throw new AssumptionInputError('item must be an id like A-01'); }
    const cur = foldAssumptions(lines).find((x) => x.item === a.item);
    if (!cur) { throw new AssumptionInputError(`no assumption ${a.item}`); }
    if (cur.closed) { throw new AssumptionInputError(`${a.item} is closed`); }
    if (event === 'update') {
        const body: AssumptionBody = { item: a.item };
        fill(body, true);
        if (Object.keys(body).length === 1) { throw new AssumptionInputError('nothing to update'); }
        return { id: a.item, event, body };
    }
    const body: AssumptionBody = { item: a.item };
    if (a.basis !== undefined) { body.basis = txt(a.basis, ASSUMPTION_LIMITS.basis, 'basis', true); }
    if (a.closedBy !== undefined) { if (typeof a.closedBy !== 'string' || !ID_RE.test(a.closedBy)) { throw new AssumptionInputError('closedBy is not an id'); } body.closedBy = a.closedBy; }
    return { id: a.item, event, body };
}

export function readAssumptionBody(event: string, b: Record<string, any>): Record<string, any> | null {
    try {
        if (typeof b.item !== 'string' || !ITEM_RE.test(b.item)) { return null; }
        const out: any = { item: b.item };
        if (event === 'add') {
            out.caseId = typeof b.caseId === 'string' && CASE_ID_RE.test(b.caseId) ? b.caseId : null;
            if (!(ASSUMPTION_ORIGINS as readonly string[]).includes(b.origin)) { return null; }
            out.origin = b.origin;
            if (b.originKey !== undefined) { if (typeof b.originKey !== 'string' || b.originKey.length > ASSUMPTION_LIMITS.originKey) { return null; } out.originKey = b.originKey; }
        }
        if (b.text !== undefined) { out.text = txt(b.text, ASSUMPTION_LIMITS.text, 'text'); }
        if (b.basis !== undefined) { out.basis = txt(b.basis, ASSUMPTION_LIMITS.basis, 'basis', true); }
        if (b.status !== undefined) { if (!(ASSUMPTION_STATUS as readonly string[]).includes(b.status)) { return null; } out.status = b.status; }
        if (b.scope !== undefined) { const s = sanitizeRefs(b.scope, ASSUMPTION_LIMITS.scope); if (!s) { return null; } out.scope = s; }
        if (b.sources !== undefined) { out.sources = sources(b.sources); }
        if (b.impact !== undefined) { out.impact = txt(b.impact, ASSUMPTION_LIMITS.impact, 'impact', true); }
        if (b.closedBy !== undefined) { if (typeof b.closedBy !== 'string' || !ID_RE.test(b.closedBy)) { return null; } out.closedBy = b.closedBy; }
        if (event === 'add' && (out.text === undefined || out.status === undefined)) { return null; }
        return out;
    } catch { return null; }
}

export const ASSUMPTION_SPEC: LogSpec = { type: 'assumptions', major: 1, events: ASSUMPTION_EVENTS, sanitize: readAssumptionBody };

export function foldAssumptions(lines: RecordLine[]): Assumption[] {
    const byKey = new Map<string, Assumption>();
    const firstWriter = new Map<string, string>();
    for (const l of lines.filter(countable)) {
        const b = l.body as AssumptionBody;
        const writer = l.sig.w;
        if (l.event === 'add') {
            const key = firstWriter.has(b.item) && firstWriter.get(b.item) !== writer ? `${b.item}~${writer.slice(1, 5)}` : b.item;
            if (byKey.has(key)) { continue; }
            if (!firstWriter.has(b.item)) { firstWriter.set(b.item, writer); }
            byKey.set(key, {
                key, item: b.item, caseId: b.caseId ?? null, text: b.text ?? '', basis: b.basis ?? '', status: b.status ?? 'provisional',
                scope: b.scope ?? [], sources: b.sources ?? [], impact: b.impact ?? '', origin: b.origin ?? 'ai', originKey: b.originKey ?? null,
                closed: false, closedBy: null, closedByProgram: false, writer, createdAt: l.at, lastSeq: l.seq, lastAt: l.at, status_line: l.status,
                history: [{ event: 'add', at: l.at, writer, status: b.status, status_line: l.status }],
            });
            continue;
        }
        const fw = firstWriter.get(b.item);
        const own = `${b.item}~${writer.slice(1, 5)}`;
        const a = byKey.get(fw && fw !== writer && byKey.has(own) ? own : b.item);
        if (!a) { continue; }
        a.history.push({ event: l.event, at: l.at, writer, status: b.status, status_line: l.status });
        a.lastSeq = l.seq; a.lastAt = l.at;
        if (l.event === 'update') {
            if (b.text !== undefined) { a.text = b.text; }
            if (b.basis !== undefined) { a.basis = b.basis; }
            if (b.status !== undefined) { a.status = b.status; }
            if (b.scope !== undefined) { a.scope = b.scope; }
            if (b.sources !== undefined) { a.sources = b.sources; }
            if (b.impact !== undefined) { a.impact = b.impact; }
        } else if (l.event === 'close') { a.closed = true; a.closedBy = b.closedBy ?? null; a.closedByProgram = l.actor.kind === 'program'; if (b.basis !== undefined) { a.basis = b.basis; } }
    }
    return [...byKey.values()];
}

/**
 * 발행을 막는가(결정 D7 · 설계 §2.6): 임시 · 현장 확인 필요는 늘 막는다. 확정 · 해당 없음 · AI 가 닫은 것은 사람의 확인이 그 판(lastSeq)에
 * 있어야 풀린다 — AI 의 줄만으로는 풀리지 않는다. 프로그램이 닫은 자동 가정만 확인 없이 풀린다.
 * `personConfirmedSeq` = 그 가정에 유효한 사람의 확인이 가리키는 seq(R4 가 준다). 해당 없음은 막지 않는다.
 */
export function blocksIssue(a: Assumption, personConfirmedSeq: number | null): boolean {
    if (a.closed && a.closedByProgram) { return false; }   // 자동 가정의 원인이 사라짐(그 변경 id 가 적혀 있다)
    if (!a.closed && (a.status === 'provisional' || a.status === 'field-check')) { return true; }
    return personConfirmedSeq !== a.lastSeq;               // firm · not-applicable · AI 가 닫은 것 — 사람이 그 판을 확인해야 (§2.6)
}

/** (a) 기본값 가정 — 추가할 것 · 닫을 것. 글은 칸 이름을 늘어놓을 뿐(판단 없음) */
export function planDefaultAssumptions(input: {
    usedKeys: string[];
    sourceOf: (key: string) => string | undefined;
    groupOf: (key: string) => string | null;
    isHandDefault: (key: string) => boolean;
    labelOf?: (key: string) => string | null;
    groupLabel?: (group: string) => string | null;
    current: Assumption[];
    caseId: string;
    closedBy?: string;
}): { add: Array<{ originKey: string; text: string; scope: Ref[]; status: 'provisional' }>; close: Array<{ item: string; closedBy?: string }> } {
    const groups = new Map<string, string[]>();
    for (const k of [...new Set(input.usedKeys)].sort()) {
        if (input.sourceOf(k) !== 'default' || !input.isHandDefault(k)) { continue; }
        const g = input.groupOf(k) || 'case';
        groups.set(g, [...(groups.get(g) || []), k]);
    }
    const open = input.current.filter((a) => a.origin === 'program-default' && !a.closed && a.caseId === input.caseId);
    const add: Array<{ originKey: string; text: string; scope: Ref[]; status: 'provisional' }> = [];
    for (const [g, keys] of groups) {
        const originKey = `default:${g}`;
        if (open.some((a) => a.originKey === originKey)) { continue; }
        const names = keys.map((k) => input.labelOf?.(k) || k);
        const text = `${input.groupLabel?.(g) || g}: ${names.join(' · ')} — 입력 기본값 그대로`;
        add.push({ originKey, text: [...text].slice(0, ASSUMPTION_LIMITS.text).join(''), scope: keys.slice(0, ASSUMPTION_LIMITS.scope).map((k) => ({ kind: 'field' as const, path: `case.inputs.${k}`, caseId: input.caseId })), status: 'provisional' });
    }
    const close = open.filter((a) => !groups.has(String(a.originKey).replace(/^default:/, ''))).map((a) => ({ item: a.item, ...(input.closedBy ? { closedBy: input.closedBy } : {}) }));
    return { add, close };
}

/** (b) 엔진 자체 가정 — 결과의 알림(부호가 있으면 그것, 없으면 글의 해시) */
export function planEngineAssumptions(input: {
    notes: Array<{ resultKind: string; code?: string | null; text: string }>;
    current: Assumption[];
    caseId: string;
}): { add: Array<{ originKey: string; text: string; status: 'provisional' }>; close: Array<{ item: string }> } {
    const want = new Map<string, string>();
    for (const n of input.notes) {
        const code = n.code && /^[A-Za-z0-9_.-]{1,60}$/.test(n.code) ? n.code : `h${sha256Hex(n.text).slice(0, 12)}`;
        const key = `engine:${String(n.resultKind).slice(0, 30)}:${code}`;
        if (!want.has(key)) { want.set(key, [...n.text].slice(0, ASSUMPTION_LIMITS.text).join('')); }
    }
    const open = input.current.filter((a) => a.origin === 'program-engine' && !a.closed && a.caseId === input.caseId);
    const add = [...want].filter(([k]) => !open.some((a) => a.originKey === k)).map(([originKey, text]) => ({ originKey, text, status: 'provisional' as const }));
    const close = open.filter((a) => !want.has(String(a.originKey))).map((a) => ({ item: a.item }));
    return { add, close };
}
