/**
 * 기록(R3-1) · 업무 항목 — 설계 §2.4.5. 지시(I-n — 사람이 대화에서 한 말을 AI 가 옮겨 적은 것) · 보고(R-n) · 판단 요청(Q-n).
 *
 *  - 쓰는 이는 AI(MCP `work_items` — R3-2 에서 잇는다). 이 모듈은 쓸 줄의 몸을 만들고(`prepareWork` — 한도를 넘으면 **거절**,
 *    자르지 않는다), 읽은 줄을 접는다(`foldWork` — **세는 줄(`ok`)만**: 서명 없는 · 믿지 않는 · 자리가 틀린 · 표 밖 행위자의 줄은
 *    상태를 바꾸지 않는다, V7-23. 그 줄들은 `log.unverifiedEntries` 로 따로 보인다).
 *  - 판단 요청이 발행을 막는지는 `questionBlocksIssue` — 답 · 닫기는 AI 가 쓸 수 있지만 사람의 확인이 그 판에 있어야 풀린다(설계 §2.6).
 *  - 판단 요청의 답(`said`)은 「AI 가 옮겨 적은 사람의 말」이다 — 프로그램은 대화를 듣지 않는다.
 *  - 두 작성자가 같은 id(Q-3)를 만들면 뒤의 것은 `Q-3~<작성자 앞 4자>` 로 보인다(같은 작성자의 뒤 사건은 자기 것에 붙는다).
 * 파일을 읽거나 쓰지 않는다.
 */
import { countable, type LogSpec, type RecordLine, type LineStatus } from './log';
import { cleanText, ID_RE } from './names';
import { CASE_ID_RE } from './project';
import { Ref, sanitizeRefs } from './refs';
import { FP_RE } from './canonical';

export const WORK_KINDS = { instruction: 'I', report: 'R', question: 'Q' } as const;
export type WorkKind = keyof typeof WORK_KINDS;
export const WORK_EVENTS = ['add', 'answer', 'update', 'close', 'reopen'] as const;
export const WORK_LIMITS = { title: 120, body: 8000, items: 50, itemText: 300, options: 8, optionLabel: 120, optionConsequence: 600, refs: 40, said: 4000 };
const ITEM_RE = /^[IRQ]-[1-9][0-9]{0,4}$/;

export class WorkInputError extends Error {}

export interface WorkReportItem { text: string; status: 'done' | 'assumed' | 'open'; refs: Ref[] }
export interface WorkOption { label: string; consequence: string }
export interface WorkBody {
    item: string; kind?: WorkKind; caseId?: string | null; title?: string; body?: string;
    items?: WorkReportItem[]; options?: WorkOption[]; refs?: Ref[];
    answer?: { said: string; chosen: number | null };
    basis?: { contentFp: string; runs: string[] };
}

function text(raw: unknown, max: number, field: string, optional = false): string {
    const r = cleanText(raw, max, { field, optional });
    if (!r.ok) { throw new WorkInputError(r.error); }
    return r.text;
}

function items(raw: unknown): WorkReportItem[] {
    if (raw === undefined) { return []; }
    if (!Array.isArray(raw) || raw.length > WORK_LIMITS.items) { throw new WorkInputError(`items: at most ${WORK_LIMITS.items}`); }
    return raw.map((it: any, i) => {
        if (!it || typeof it !== 'object') { throw new WorkInputError(`items[${i}] must be an object`); }
        if (!['done', 'assumed', 'open'].includes(it.status)) { throw new WorkInputError(`items[${i}].status must be done | assumed | open`); }
        const refs = sanitizeRefs(it.refs, 10);
        if (!refs) { throw new WorkInputError(`items[${i}].refs is not valid`); }
        return { text: text(it.text, WORK_LIMITS.itemText, `items[${i}].text`), status: it.status, refs };
    });
}

function options(raw: unknown): WorkOption[] {
    if (raw === undefined) { return []; }
    if (!Array.isArray(raw) || raw.length > WORK_LIMITS.options) { throw new WorkInputError(`options: at most ${WORK_LIMITS.options}`); }
    return raw.map((o: any, i) => ({
        label: text(o?.label, WORK_LIMITS.optionLabel, `options[${i}].label`),
        consequence: text(o?.consequence, WORK_LIMITS.optionConsequence, `options[${i}].consequence`, true),
    }));
}

function basis(raw: unknown): WorkBody['basis'] | undefined {
    if (raw === undefined) { return undefined; }
    const b = raw as any;
    if (!b || typeof b.contentFp !== 'string' || !FP_RE.test(b.contentFp)) { throw new WorkInputError('basis.contentFp is not a fingerprint'); }
    const runs = Array.isArray(b.runs) ? b.runs : [];
    if (runs.length > 20 || !runs.every((r: unknown) => typeof r === 'string' && ID_RE.test(r))) { throw new WorkInputError('basis.runs is not valid'); }
    return { contentFp: b.contentFp, runs };
}

export interface WorkItem {
    key: string; item: string; kind: WorkKind; caseId: string | null; title: string; body: string;
    items: WorkReportItem[]; options: WorkOption[]; refs: Ref[];
    answer: { said: string; chosen: number | null; at: string; transcribedBy: 'ai' } | null;
    state: 'open' | 'answered' | 'closed';
    basis: WorkBody['basis'] | null; basisDiffers: boolean;
    writer: string; createdAt: string; lastSeq: number; lastAt: string;
    status: LineStatus;
    history: Array<{ event: string; at: string; writer: string; status: LineStatus }>;
}

/** 다음 id(같은 종류의 가장 큰 번호 + 1) — **세는 줄에서만**(V7-30: 서명 없는 `add Q-99999` 가 번호를 다 쓰지 못한다) */
export function nextWorkId(kind: WorkKind, lines: RecordLine[]): string {
    const p = WORK_KINDS[kind];
    let max = 0;
    for (const l of lines) {
        if (!countable(l) || l.event !== 'add' || typeof l.body.item !== 'string' || !ITEM_RE.test(l.body.item) || l.body.item[0] !== p) { continue; }
        max = Math.max(max, Number(l.body.item.slice(2)));
    }
    const next = `${p}-${max + 1}`;
    if (!ITEM_RE.test(next)) { throw new WorkInputError(`no more ${kind} ids in this project`); }
    return next;
}

/**
 * 판단 요청이 발행을 막는가 — 답했거나 닫혔어도(AI 의 줄로 바뀔 수 있다) 사람이 **그 판(lastSeq)** 에 확인 표시를 해야 풀린다
 * (설계 §2.6 의 표 — 결정 D7 과 같은 규칙). 판단 요청이 아니면 막지 않는다.
 */
export function questionBlocksIssue(item: WorkItem, personConfirmedSeq: number | null): boolean {
    if (item.kind !== 'question') { return false; }
    return !(item.state !== 'open' && personConfirmedSeq === item.lastSeq);
}

/**
 * 쓸 줄 — `{id, event, body}`(log.append 에 넘긴다). 틀리면 `WorkInputError`(아무것도 쓰지 않는다).
 * `args`: add `{kind, title, body?, items?, options?, refs?, caseId?, basis?}` · answer `{item, said, chosen?}` ·
 * update `{item, title?, body?, items?, options?, refs?}` · close / reopen `{item}`
 */
export function prepareWork(event: string, args: any, lines: RecordLine[]): { id: string; event: string; body: WorkBody } {
    if (!(WORK_EVENTS as readonly string[]).includes(event)) { throw new WorkInputError(`unknown action '${String(event).slice(0, 20)}'`); }
    const a = args && typeof args === 'object' ? args : {};
    if (event === 'add') {
        if (typeof a.kind !== 'string' || !Object.prototype.hasOwnProperty.call(WORK_KINDS, a.kind)) { throw new WorkInputError('kind must be instruction | report | question'); }
        const kind = a.kind as WorkKind;
        const refs = sanitizeRefs(a.refs, WORK_LIMITS.refs);
        if (!refs) { throw new WorkInputError('refs is not valid'); }
        if (a.caseId !== undefined && a.caseId !== null && (typeof a.caseId !== 'string' || !CASE_ID_RE.test(a.caseId))) { throw new WorkInputError('caseId is not valid'); }
        const id = nextWorkId(kind, lines);
        const body: WorkBody = { item: id, kind, caseId: a.caseId ?? null, title: text(a.title, WORK_LIMITS.title, 'title'),
            body: text(a.body, WORK_LIMITS.body, 'body', kind !== 'instruction'), refs };
        if (kind === 'report') { body.items = items(a.items); } else if (a.items !== undefined) { throw new WorkInputError('items are only for a report'); }
        if (kind === 'question') { body.options = options(a.options); } else if (a.options !== undefined) { throw new WorkInputError('options are only for a question'); }
        const b = basis(a.basis);
        if (b) { body.basis = b; }
        return { id, event, body };
    }
    if (typeof a.item !== 'string' || !ITEM_RE.test(a.item)) { throw new WorkInputError('item must be an id like Q-3'); }
    const folded = foldWork(lines);
    const it = folded.find((w) => w.item === a.item);
    if (!it) { throw new WorkInputError(`no work item ${a.item}`); }
    if (event === 'answer') {
        if (it.kind !== 'question') { throw new WorkInputError('only a question can be answered'); }
        let chosen: number | null = null;
        if (a.chosen !== undefined && a.chosen !== null) {
            if (!Number.isSafeInteger(a.chosen) || a.chosen < 0 || a.chosen >= it.options.length) { throw new WorkInputError('chosen is not one of the options'); }
            chosen = a.chosen;
        }
        return { id: a.item, event, body: { item: a.item, answer: { said: text(a.said, WORK_LIMITS.said, 'said'), chosen } } };
    }
    if (event === 'update') {
        const body: WorkBody = { item: a.item };
        if (a.title !== undefined) { body.title = text(a.title, WORK_LIMITS.title, 'title'); }
        if (a.body !== undefined) { body.body = text(a.body, WORK_LIMITS.body, 'body', true); }
        if (a.items !== undefined) { if (it.kind !== 'report') { throw new WorkInputError('items are only for a report'); } body.items = items(a.items); }
        if (a.options !== undefined) { if (it.kind !== 'question') { throw new WorkInputError('options are only for a question'); } body.options = options(a.options); }
        if (a.refs !== undefined) { const r = sanitizeRefs(a.refs, WORK_LIMITS.refs); if (!r) { throw new WorkInputError('refs is not valid'); } body.refs = r; }
        if (Object.keys(body).length === 1) { throw new WorkInputError('nothing to update'); }
        return { id: a.item, event, body };
    }
    if (event === 'close' && it.state === 'closed') { throw new WorkInputError(`${a.item} is already closed`); }
    if (event === 'reopen' && it.state !== 'closed') { throw new WorkInputError(`${a.item} is not closed`); }
    return { id: a.item, event, body: { item: a.item } };
}

/** 읽은 줄의 몸 — 알려진 키만, 한도 안. 맞지 않으면 null */
export function readWorkBody(event: string, b: Record<string, any>): Record<string, any> | null {
    try {
        if (typeof b.item !== 'string' || !ITEM_RE.test(b.item)) { return null; }
        const out: any = { item: b.item };
        if (event === 'add') {
            if (typeof b.kind !== 'string' || !Object.prototype.hasOwnProperty.call(WORK_KINDS, b.kind) || WORK_KINDS[b.kind as WorkKind] !== b.item[0]) { return null; }
            out.kind = b.kind;
            out.caseId = typeof b.caseId === 'string' && CASE_ID_RE.test(b.caseId) ? b.caseId : null;
        }
        if (b.title !== undefined) { out.title = text(b.title, WORK_LIMITS.title, 'title'); }
        if (b.body !== undefined) { out.body = text(b.body, WORK_LIMITS.body, 'body', true); }
        if (b.items !== undefined) { out.items = items(b.items); }
        if (b.options !== undefined) { out.options = options(b.options); }
        if (b.refs !== undefined) { const r = sanitizeRefs(b.refs, WORK_LIMITS.refs); if (!r) { return null; } out.refs = r; }
        if (b.basis !== undefined) { out.basis = basis(b.basis); }
        if (event === 'answer') {
            const said = text(b.answer?.said, WORK_LIMITS.said, 'said');
            const chosen = Number.isSafeInteger(b.answer?.chosen) ? b.answer.chosen : null;
            out.answer = { said, chosen };
        }
        if (event === 'add' && out.title === undefined) { return null; }
        return out;
    } catch { return null; }
}

export const WORK_SPEC: LogSpec = { type: 'work', major: 1, events: WORK_EVENTS, sanitize: readWorkBody };

/** 줄을 접어 지금 항목들. `nowContentFp` 를 주면 쓸 때의 기준과 다른가 */
export function foldWork(lines: RecordLine[], opts: { nowContentFp?: string } = {}): WorkItem[] {
    const byKey = new Map<string, WorkItem>();
    const firstWriter = new Map<string, string>();
    const keyFor = (item: string, writer: string): string => {
        const fw = firstWriter.get(item);
        if (!fw || fw === writer) { return item; }
        const own = `${item}~${writer.slice(1, 5)}`;
        return byKey.has(own) ? own : item;
    };
    for (const l of lines.filter(countable)) {
        const b = l.body as WorkBody;
        const writer = l.sig.w;
        if (l.event === 'add') {
            let key = b.item;
            if (firstWriter.has(b.item) && firstWriter.get(b.item) !== writer) { key = `${b.item}~${writer.slice(1, 5)}`; }
            if (byKey.has(key)) { continue; }   // 같은 작성자가 같은 id 를 두 번 — 앞의 것
            if (!firstWriter.has(b.item)) { firstWriter.set(b.item, writer); }
            byKey.set(key, {
                key, item: b.item, kind: b.kind as WorkKind, caseId: b.caseId ?? null, title: b.title ?? '', body: b.body ?? '',
                items: b.items ?? [], options: b.options ?? [], refs: b.refs ?? [], answer: null, state: 'open',
                basis: b.basis ?? null, basisDiffers: false, writer, createdAt: l.at, lastSeq: l.seq, lastAt: l.at, status: l.status,
                history: [{ event: 'add', at: l.at, writer, status: l.status }],
            });
            continue;
        }
        const it = byKey.get(keyFor(b.item, writer));
        if (!it) { continue; }
        it.history.push({ event: l.event, at: l.at, writer, status: l.status });
        it.lastSeq = l.seq; it.lastAt = l.at;
        if (l.event === 'answer' && b.answer && it.kind === 'question') {
            it.answer = { said: b.answer.said, chosen: b.answer.chosen ?? null, at: l.at, transcribedBy: 'ai' };
            if (it.state !== 'closed') { it.state = 'answered'; }
        } else if (l.event === 'update') {
            if (b.title !== undefined) { it.title = b.title; }
            if (b.body !== undefined) { it.body = b.body; }
            if (b.items !== undefined) { it.items = b.items; }
            if (b.options !== undefined) { it.options = b.options; }
            if (b.refs !== undefined) { it.refs = b.refs; }
        } else if (l.event === 'close') { it.state = 'closed'; }
        else if (l.event === 'reopen') { it.state = it.answer ? 'answered' : 'open'; }
    }
    const out = [...byKey.values()];
    if (opts.nowContentFp) { for (const it of out) { it.basisDiffers = !!it.basis && it.basis.contentFp !== opts.nowContentFp; } }
    return out;
}
