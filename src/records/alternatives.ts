/**
 * 기록(R4-3) · 대안 `log/alternatives` — 설계 §2.4.9 · §5.5, 결정 D9.
 *
 * 대안 = 같은 검토 대상의 **실행 묶음에 붙인 이름**(모델 · 입력 사본 + 종류마다 결과 사본) — 파일이 아니다.
 *  - 사건: `keep`(지금 상태 · 마지막 실행들을 대안으로 — AI) · `rename` · `drop`(숨김) · `undrop`(되살림). 행위자 표: ai.
 *  - 비교(`compareAlternative`): 모델을 열지 않고 결과 사본과 지금 결과를 **검토 열쇠로 맞춘다** — 줄마다 판정비 · 판정, 머리에 최대 판정비 ·
 *    NG 수 · 미검토 수 · 단면적 A(실행 요약의 단면 성질). 무게를 짓지 않는다(D12).
 *  - 되돌리기는 호스트가(스냅숏을 알려진 키만 얹고 — V5b-01 — 결과는 다시 돌린다, 사본을 결과로 넣지 않는다).
 * 접기 · 다음 번호는 세는 줄(`ok`)만. 파일을 읽거나 쓰지 않는다.
 */
import { FP_RE } from './canonical';
import { countable, type LogSpec, type RecordLine, type LineStatus } from './log';
import { cleanText, ID_RE } from './names';
import { eventsOf } from './policy';
import { CASE_ID_RE } from './project';
import { RUN_KINDS } from './runs';
import { enumerateChecks } from './reviews';

export const ALT_EVENTS = eventsOf('alternatives');
export const ALT_LIMITS = { label: 80 };
const ITEM_RE = /^ALT-[1-9][0-9]{0,3}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export class AlternativeInputError extends Error {}

export interface AltBody {
    item: string; caseId?: string; label?: string; contentFp?: string; snapshot?: string;
    runs?: Record<string, { runId: string; blob: string | null }>;
}
export interface Alternative {
    item: string; caseId: string; label: string; contentFp: string; snapshot: string;
    runs: Record<string, { runId: string; blob: string | null }>;
    dropped: boolean; writer: string; createdAt: string; lastAt: string; status_line: LineStatus;
    /** 둔 쪽(keep 줄의 행위자 — ai · person) */
    by: string;
}

export function nextAltId(lines: RecordLine[]): string {
    let max = 0;
    for (const l of lines) { if (countable(l) && l.event === 'keep' && typeof l.body.item === 'string' && ITEM_RE.test(l.body.item)) { max = Math.max(max, Number(l.body.item.slice(4))); } }
    const next = `ALT-${max + 1}`;
    if (!ITEM_RE.test(next)) { throw new AlternativeInputError('no more alternative ids in this project'); }
    return next;
}

function label(raw: unknown, fallback: string): string {
    const r = cleanText(raw, ALT_LIMITS.label, { field: 'label', optional: true });
    if (!r.ok) { throw new AlternativeInputError(r.error); }
    return r.text.trim() ? r.text : fallback;
}

/** `keep {caseId, label?, contentFp, snapshot, runs}` · `rename {item, label}` · `drop {item}` · `undrop {item}` */
export function prepareAlternative(event: string, args: any, lines: RecordLine[]): { id: string; event: string; body: AltBody } {
    if (!(ALT_EVENTS as readonly string[]).includes(event)) { throw new AlternativeInputError(`unknown action '${String(event).slice(0, 20)}'`); }
    const a = args && typeof args === 'object' ? args : {};
    if (event === 'keep') {
        if (typeof a.caseId !== 'string' || !CASE_ID_RE.test(a.caseId)) { throw new AlternativeInputError('no case'); }
        if (typeof a.contentFp !== 'string' || !FP_RE.test(a.contentFp) || typeof a.snapshot !== 'string' || !SHA_RE.test(a.snapshot)) { throw new AlternativeInputError('no snapshot of the current state'); }
        const runs: Record<string, { runId: string; blob: string | null }> = {};
        for (const [k, v] of Object.entries(a.runs && typeof a.runs === 'object' ? a.runs : {})) {
            const r = v as any;
            if (!(RUN_KINDS as readonly string[]).includes(k) || !r || typeof r.runId !== 'string' || !ID_RE.test(r.runId) || !(r.blob === null || (typeof r.blob === 'string' && SHA_RE.test(r.blob)))) {
                throw new AlternativeInputError(`runs.${k.slice(0, 30)} is not valid`);
            }
            runs[k] = { runId: r.runId, blob: r.blob };
        }
        const id = nextAltId(lines);
        return { id, event, body: { item: id, caseId: a.caseId, label: label(a.label, id), contentFp: a.contentFp, snapshot: a.snapshot, runs } };
    }
    if (typeof a.item !== 'string' || !ITEM_RE.test(a.item)) { throw new AlternativeInputError('item must be an id like ALT-2'); }
    const cur = foldAlternatives(lines).find((x) => x.item === a.item);
    if (!cur) { throw new AlternativeInputError(`no alternative ${a.item}`); }
    if (event === 'rename') { return { id: a.item, event, body: { item: a.item, label: label(a.label, '') || (() => { throw new AlternativeInputError('label is required'); })() } }; }
    if (event === 'drop' && cur.dropped) { throw new AlternativeInputError(`${a.item} is already hidden`); }
    if (event === 'undrop' && !cur.dropped) { throw new AlternativeInputError(`${a.item} is not hidden`); }
    return { id: a.item, event, body: { item: a.item } };
}

export function readAltBody(event: string, b: Record<string, any>): Record<string, any> | null {
    try {
        if (typeof b.item !== 'string' || !ITEM_RE.test(b.item)) { return null; }
        const out: any = { item: b.item };
        if (event === 'keep') {
            if (typeof b.caseId !== 'string' || !CASE_ID_RE.test(b.caseId) || typeof b.contentFp !== 'string' || !FP_RE.test(b.contentFp)
                || typeof b.snapshot !== 'string' || !SHA_RE.test(b.snapshot)) { return null; }
            out.caseId = b.caseId; out.contentFp = b.contentFp; out.snapshot = b.snapshot;
            out.runs = {};
            for (const [k, v] of Object.entries(b.runs && typeof b.runs === 'object' ? b.runs : {})) {
                const r = v as any;
                if (!(RUN_KINDS as readonly string[]).includes(k) || !r || typeof r.runId !== 'string' || !ID_RE.test(r.runId)) { return null; }
                out.runs[k] = { runId: r.runId, blob: typeof r.blob === 'string' && SHA_RE.test(r.blob) ? r.blob : null };
            }
        }
        if (b.label !== undefined) { const r = cleanText(b.label, ALT_LIMITS.label, { optional: true }); if (!r.ok) { return null; } out.label = r.text; }
        return out;
    } catch { return null; }
}
export const ALTERNATIVES_SPEC: LogSpec = { type: 'alternatives', major: 1, events: ALT_EVENTS, sanitize: readAltBody };

export function foldAlternatives(lines: RecordLine[]): Alternative[] {
    const by = new Map<string, Alternative>();
    for (const l of lines.filter(countable)) {
        const b = l.body as AltBody;
        if (l.event === 'keep') {
            if (by.has(b.item)) { continue; }
            by.set(b.item, { item: b.item, caseId: b.caseId!, label: b.label ?? b.item, contentFp: b.contentFp!, snapshot: b.snapshot!, runs: b.runs ?? {},
                dropped: false, writer: l.sig.w, createdAt: l.at, lastAt: l.at, status_line: l.status, by: String(l.actor?.kind ?? 'ai') });
            continue;
        }
        const a = by.get(b.item);
        if (!a) { continue; }
        a.lastAt = l.at;
        if (l.event === 'rename' && b.label) { a.label = b.label; }
        else if (l.event === 'drop') { a.dropped = true; }
        else if (l.event === 'undrop') { a.dropped = false; }
    }
    return [...by.values()];
}

const SCOPE_OF: Record<string, string> = { member_design: 'member', connection: 'connection', lap: 'lap' };
const scopeOfResult = (kind: string, result: any) => (kind === 'member_design' && result && Array.isArray(result.regions) ? 'purlin' : SCOPE_OF[kind]);

export interface CompareRow { key: string; scope: string; id: string; location: unknown; combination: string | null;
    now: { ratio: number | null; verdict: string } | null; alt: { ratio: number | null; verdict: string } | null }
export interface CompareHead { maxRatio: number | null; ng: number; notEvaluated: number; checks: number; A: number | null }

function head(rows: Array<{ ratio: number | null; verdict: string } | null>, A: number | null): CompareHead {
    const xs = rows.filter((r): r is { ratio: number | null; verdict: string } => !!r);
    const rs = xs.map((r) => r.ratio).filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
    return { maxRatio: rs.length ? Math.max(...rs) : null, ng: xs.filter((r) => r.verdict === 'fail').length,
        notEvaluated: xs.filter((r) => r.verdict === 'not_evaluated').length, checks: xs.length, A };
}

/**
 * 대안의 결과 사본(종류 → 결과)과 지금 결과(종류 → 결과)를 검토 열쇠로 맞춘다. 줄은 판정비 차이가 큰 것부터(한쪽에만 있는 줄은 맨 앞).
 */
export function compareAlternative(alt: Record<string, unknown>, now: Record<string, unknown>, areas: { alt: number | null; now: number | null }):
{ rows: CompareRow[]; head: { now: CompareHead; alt: CompareHead } } {
    const rowsBy = new Map<string, CompareRow>();
    const fill = (side: 'now' | 'alt', results: Record<string, unknown>) => {
        for (const [kind, r] of Object.entries(results)) {
            const scope = scopeOfResult(kind, r);
            if (!scope) { continue; }
            for (const c of enumerateChecks(scope, r)) {
                const row = rowsBy.get(c.key) ?? { key: c.key, scope: c.scope, id: c.id, location: c.location, combination: c.combination, now: null, alt: null };
                row[side] = { ratio: typeof c.item.ratio === 'number' && Number.isFinite(c.item.ratio) ? c.item.ratio : null, verdict: String(c.item.verdict ?? '') };
                rowsBy.set(c.key, row);
            }
        }
    };
    fill('now', now); fill('alt', alt);
    const rows = [...rowsBy.values()];
    const w = (r: CompareRow) => (!r.now || !r.alt ? Infinity : r.now.verdict !== r.alt.verdict ? 1e9 : Math.abs((r.now.ratio ?? 0) - (r.alt.ratio ?? 0)));
    rows.sort((a, b) => w(b) - w(a) || (a.key < b.key ? -1 : 1));
    return { rows, head: { now: head(rows.map((r) => r.now), areas.now), alt: head(rows.map((r) => r.alt), areas.alt) } };
}

/** 사본이 가리키는 해시들(정리에서 지우지 않는다) */
export function altBlobs(a: Alternative): string[] {
    return [a.snapshot, ...Object.values(a.runs).map((r) => r.blob).filter((b): b is string => !!b)];
}
export function altRunIds(a: Alternative): string[] { return Object.values(a.runs).map((r) => r.runId); }
