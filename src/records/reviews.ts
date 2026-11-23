/**
 * 기록(R4-1) · 확인 표시 `log/reviews` — 설계 §2.4.8 · §2.6 · §3.5, 결정 D5 · D6 · D7 · D15 · D16.
 *
 *  - 쓰는 이는 **사람뿐**(행위자 표 — `mark` · `unmark` → person). 줄을 짓는 것은 데스크의 사람 얼굴(`person.review`)이고, 그 얼굴은
 *    호스트가 지금 대상에서 풀어 준 대상(지금 지문 · 판정 · 실행)만 받는다 — 화면이 보인 지문(`shown`)이 지금 것과 다르면 거절(층 5).
 *  - 대상: `check`(검토 항목 — 열쇠 · 지문 · 실행 · 사본) · `result`(결과 하나) · `group`(입력 묶음) · `change`(변경 묶음) ·
 *    `work` · `assumption`(그 항목의 판 seq — 가정의 사람 확인 D7 · 답한 판단 요청의 확인).
 *  - 유효성은 줄에 쓰지 않고 매번 계산한다(`markValidity`) — **지문이 같은지가 아니라 확인한 항목과 지금 항목을 견준다**(D16,
 *    `compareItems`). 지문이 같으면 비교 없이 유효(빠른 길).
 *  - 접기는 세는 줄(`ok` — 서명 · 자리 · 믿는 작성자 · 표 안의 행위자)만. 믿지 않는 작성자의 줄은 「아직 믿지 않음」 으로 따로(D5).
 * 서명이 증명하는 것(D15): 그 줄을 이 PC 의 StCFSD(또는 같은 사용자 권한의 프로그램)가 썼다는 것까지 — 누가 눌렀는지를 증명하는 전자서명이 아니다.
 * 파일을 읽거나 쓰지 않는다.
 */
import { canonicalJson, FP_RE } from './canonical';
import { checkKey } from './fp';
import { countable, type LogSpec, type RecordLine, type LineStatus } from './log';
import { cleanHeaderText, ID_RE } from './names';
import { eventsOf } from './policy';
import { CASE_ID_RE } from './project';
import { RUN_KINDS } from './runs';

export const REVIEW_EVENTS = eventsOf('reviews');
export const REVIEW_LIMITS = { targets: 200 };
const SHA_RE = /^[0-9a-f]{64}$/;
const SCOPES = ['member', 'purlin', 'connection', 'lap'] as const;

/** 확인 표시를 설명하는 곳마다 두는 말(D15) */
export const REVIEW_MEANING_KO = '확인 표시는 이 PC 의 StCFSD 사람 화면에서 누른 기록입니다. 서명은 그 줄을 이 PC 의 StCFSD(또는 같은 사용자 권한의 프로그램)가 썼다는 것까지만 증명하며, 누가 눌렀는지를 증명하는 전자서명이 아닙니다 — 사무소의 책임 기록입니다.';
export const REVIEW_MEANING_EN = 'A review mark records that it was clicked in the person screen of StCFSD on this PC. Its signature proves only that StCFSD on this PC (or a program with the same user rights) wrote the line — it is not an electronic signature of who clicked; it is an office accountability record.';

export type ReviewTarget =
    | { type: 'check'; caseId: string; key: string; scope: typeof SCOPES[number]; id: string; location: unknown; combination: string | null;
        checkFp: string; runId: string | null; resultBlob: string | null; verdict: string; ratio: number | null }
    | { type: 'result'; caseId: string; kind: string; resultFp: string; runId: string | null; resultBlob: string | null }
    | { type: 'group'; caseId: string; group: string; groupFp: string }
    | { type: 'change'; caseId: string; changeId: string }
    | { type: 'work'; id: string; seq: number }
    | { type: 'assumption'; id: string; seq: number };

/** 대상의 열쇠(같은 대상의 표시 · 취소가 겹친다) */
export function targetKey(t: ReviewTarget): string {
    switch (t.type) {
        case 'check': return `check:${t.caseId}:${t.key}`;
        case 'result': return `result:${t.caseId}:${t.kind}`;
        case 'group': return `group:${t.caseId}:${t.group}`;
        case 'change': return `change:${t.changeId}`;
        case 'work': return `work:${t.id}`;
        case 'assumption': return `assumption:${t.id}`;
    }
}

/** 검토 항목 하나의 열쇠(설계 §2.3 `checkKey`) — 결과에서 항목을 셀 때와 같은 꼴 */
export function itemKey(scope: string, item: any, location: unknown): string {
    return checkKey({ scope, id: String(item?.id ?? ''), location: location ?? null, combination: typeof item?.combination === 'string' ? item.combination : null });
}

/**
 * 결과의 검토 항목들(판정에 드는 줄 — 「확인 n/N」 의 분모). 범위마다:
 *  member · connection: `design_checks`(위치 = 항목의 location), lap: 거기에 `fastener_design.design_checks`(위치에 part),
 *  purlin: 구간마다 검토 지점마다(위치 = {region, check_point}).
 */
export function enumerateChecks(scope: string, result: any): Array<{ key: string; scope: string; id: string; location: unknown; combination: string | null; item: any }> {
    const out: Array<{ key: string; scope: string; id: string; location: unknown; combination: string | null; item: any }> = [];
    if (!result || typeof result !== 'object') { return out; }
    const push = (item: any, location: unknown) => {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string') { return; }
        out.push({ key: itemKey(scope, item, location), scope, id: item.id, location: location ?? null, combination: typeof item.combination === 'string' ? item.combination : null, item });
    };
    if (scope === 'purlin') {
        for (const g of Array.isArray(result.regions) ? result.regions : []) {
            for (const pt of Array.isArray(g?.result?.checks) ? g.result.checks : []) {
                for (const c of Array.isArray(pt?.design_checks) ? pt.design_checks : []) { push(c, { region: g.id, check_point: pt.check_point }); }
            }
        }
        return out;
    }
    for (const c of Array.isArray(result.design_checks) ? result.design_checks : []) { push(c, c?.location ?? null); }
    if (scope === 'lap' && result.fastener_design) {
        for (const c of Array.isArray(result.fastener_design.design_checks) ? result.fastener_design.design_checks : []) {
            push(c, { ...(c?.location && typeof c.location === 'object' ? c.location : {}), part: 'fastener_design' });
        }
    }
    return out;
}

// ── 비교(D16) ────────────────────────────────────────────────────────
export const COMPARE_TOL = { normal: 1e-6, longWavelengthGlobal: 1e-4 } as const;
/** 정규 값이 같아야 하는 입력의 출처(사람 · 기준 · 재료 · 엔진 기본값 · 다른 항목의 결과가 아닌 것) */
const EXACT_SOURCES = new Set(['user_input', 'specification', 'material', 'engine_default']);
const GLOBAL_SYMBOL_RE = /^(F|M|P)[a-z]{0,3}cre$|^LF_global$|cre_signature$/i;

/** 항목이 FSM 의 긴 반파장 전체좌굴 값을 쓰는가(그 항목의 모든 수에 1e-4) — 엔진에 따로 표지가 없어 기호 · 출처로 고른다 */
export function usesLongWavelengthGlobal(item: unknown): boolean {
    let hit = false;
    const walk = (o: any, depth: number) => {
        if (hit || !o || typeof o !== 'object' || depth > 30) { return; }
        if (Array.isArray(o)) { o.forEach((x) => walk(x, depth + 1)); return; }
        if (typeof o.symbol === 'string' && GLOBAL_SYMBOL_RE.test(o.symbol) && o.source && o.source.kind === 'buckling_analysis'
            && typeof o.source.method === 'string' && /^fsm/.test(o.source.method)) { hit = true; return; }
        for (const v of Object.values(o)) { if (v && typeof v === 'object') { walk(v, depth + 1); } }
    };
    walk(item, 0);
    return hit;
}

export interface ItemDifference { path: string; reviewed: unknown; current: unknown; why: 'text' | 'number' | 'input' | 'shape' }

/**
 * 확인한 항목과 지금 항목 — 같은 내용인가(D16). 글 · 참거짓 · null 은 같아야 하고(id · 판정 · 조항 · 식 · 갈래 · 조건 글),
 * 입력 가운데 정규 값이 같아야 하는 출처의 값은 같아야 하고, 그 밖의 수는 상대 tol 안. 다른 곳은 20 개까지.
 */
export function compareItems(reviewed: unknown, current: unknown): { same: boolean; tol: number; differences: ItemDifference[] } {
    const tol = usesLongWavelengthGlobal(reviewed) || usesLongWavelengthGlobal(current) ? COMPARE_TOL.longWavelengthGlobal : COMPARE_TOL.normal;
    const diffs: ItemDifference[] = [];
    let count = 0;
    const add = (d: ItemDifference) => { count += 1; if (diffs.length < 20) { diffs.push(d); } };
    const close = (a: number, b: number) => a === b || Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
    const walk = (a: any, b: any, p: string, exact: boolean) => {
        if (typeof a === 'number' && typeof b === 'number') {
            if (exact ? canonicalJson(a) !== canonicalJson(b) : !(Number.isFinite(a) && Number.isFinite(b) ? close(a, b) : Object.is(a, b))) {
                add({ path: p, reviewed: a, current: b, why: exact ? 'input' : 'number' });
            }
            return;
        }
        if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
            if (a !== b) { add({ path: p, reviewed: a ?? null, current: b ?? null, why: typeof a === typeof b ? 'text' : 'shape' }); }
            return;
        }
        if (Array.isArray(a) !== Array.isArray(b)) { add({ path: p, reviewed: '(shape)', current: '(shape)', why: 'shape' }); return; }
        if (Array.isArray(a)) {
            if (a.length !== b.length) { add({ path: `${p}.length`, reviewed: a.length, current: b.length, why: 'shape' }); }
            for (let i = 0; i < Math.min(a.length, b.length); i += 1) { walk(a[i], b[i], `${p}[${i}]`, exact); }
            return;
        }
        // 입력 물리량: 출처가 사람 · 기준 · 재료 · 기본값이면 값은 정규 값이 같아야
        const exactHere = exact || (!!a.source && typeof a.source === 'object' && EXACT_SOURCES.has(a.source.kind) && 'value' in a);
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of keys) {
            if (!(k in a) || !(k in b)) { add({ path: `${p}.${k}`, reviewed: k in a ? '(present)' : '(absent)', current: k in b ? '(present)' : '(absent)', why: 'shape' }); continue; }
            walk(a[k], b[k], p ? `${p}.${k}` : k, exactHere && k === 'value' ? true : exact);
        }
    };
    walk(reviewed, current, '', false);
    return { same: count === 0, tol, differences: diffs };
}

// ── 줄 ──────────────────────────────────────────────────────────────
function cleanTarget(raw: any): ReviewTarget | null {
    if (!raw || typeof raw !== 'object') { return null; }
    const sha = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'string' && SHA_RE.test(v) ? v : undefined);
    const idOrNull = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'string' && ID_RE.test(v) ? v : undefined);
    switch (raw.type) {
        case 'check': {
            if (!CASE_ID_RE.test(String(raw.caseId)) || typeof raw.key !== 'string' || raw.key.length > 400 || !(SCOPES as readonly string[]).includes(raw.scope)
                || typeof raw.id !== 'string' || !/^[A-Za-z0-9_.]{1,200}$/.test(raw.id) || typeof raw.checkFp !== 'string' || !FP_RE.test(raw.checkFp)) { return null; }
            const runId = idOrNull(raw.runId), blob = sha(raw.resultBlob);
            if (runId === undefined || blob === undefined) { return null; }
            let location: unknown = null;
            if (raw.location !== undefined && raw.location !== null) { const t = canonicalJson(raw.location); if (t.length > 2000) { return null; } location = JSON.parse(t); }
            if (raw.key !== checkKey({ scope: raw.scope, id: raw.id, location, combination: typeof raw.combination === 'string' ? raw.combination : null })) { return null; }
            return { type: 'check', caseId: raw.caseId, key: raw.key, scope: raw.scope, id: raw.id, location, combination: typeof raw.combination === 'string' ? raw.combination.slice(0, 200) : null,
                checkFp: raw.checkFp, runId, resultBlob: blob, verdict: cleanHeaderText(raw.verdict, 20) ?? '', ratio: typeof raw.ratio === 'number' && Number.isFinite(raw.ratio) ? raw.ratio : null };
        }
        case 'result': {
            if (!CASE_ID_RE.test(String(raw.caseId)) || !(RUN_KINDS as readonly string[]).includes(raw.kind) || typeof raw.resultFp !== 'string' || !FP_RE.test(raw.resultFp)) { return null; }
            const runId = idOrNull(raw.runId), blob = sha(raw.resultBlob);
            if (runId === undefined || blob === undefined) { return null; }
            return { type: 'result', caseId: raw.caseId, kind: raw.kind, resultFp: raw.resultFp, runId, resultBlob: blob };
        }
        case 'group':
            if (!CASE_ID_RE.test(String(raw.caseId)) || typeof raw.group !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(raw.group) || typeof raw.groupFp !== 'string' || !FP_RE.test(raw.groupFp)) { return null; }
            return { type: 'group', caseId: raw.caseId, group: raw.group, groupFp: raw.groupFp };
        case 'change':
            if (!CASE_ID_RE.test(String(raw.caseId)) || typeof raw.changeId !== 'string' || !ID_RE.test(raw.changeId)) { return null; }
            return { type: 'change', caseId: raw.caseId, changeId: raw.changeId };
        case 'work':
            if (typeof raw.id !== 'string' || !/^[IRQ]-[1-9][0-9]{0,4}$/.test(raw.id) || !Number.isSafeInteger(raw.seq) || raw.seq < 0) { return null; }
            return { type: 'work', id: raw.id, seq: raw.seq };
        case 'assumption':
            if (typeof raw.id !== 'string' || !/^A-[0-9]{2,4}$/.test(raw.id) || !Number.isSafeInteger(raw.seq) || raw.seq < 0) { return null; }
            return { type: 'assumption', id: raw.id, seq: raw.seq };
    }
    return null;
}

export interface ReviewBody {
    targets: ReviewTarget[]; reviewer: { name: string; writerId: string }; via: 'person'; engineId: string | null;
}
export function readReviewBody(event: string, b: Record<string, any>): Record<string, any> | null {
    if (event !== 'mark' && event !== 'unmark') { return null; }
    if (!Array.isArray(b.targets) || b.targets.length === 0 || b.targets.length > REVIEW_LIMITS.targets) { return null; }
    const targets: ReviewTarget[] = [];
    for (const t of b.targets) { const c = cleanTarget(t); if (!c) { return null; } targets.push(c); }
    if (b.via !== 'person' || !b.reviewer || typeof b.reviewer.writerId !== 'string' || !/^w[a-z2-7]{20}$/.test(b.reviewer.writerId)) { return null; }
    const engineId = b.engineId === null || b.engineId === undefined ? null : typeof b.engineId === 'string' && FP_RE.test(b.engineId) ? b.engineId : undefined;
    if (engineId === undefined) { return null; }
    return { targets, reviewer: { name: cleanHeaderText(b.reviewer.name, 60) ?? '', writerId: b.reviewer.writerId }, via: 'person', engineId };
}
export const REVIEWS_SPEC: LogSpec = { type: 'reviews', major: 1, events: REVIEW_EVENTS, sanitize: readReviewBody };

/** 쓸 줄의 몸 — 데스크의 사람 얼굴이 호스트가 풀어 준 대상으로 부른다. 틀리면 던진다 */
export function prepareReview(event: 'mark' | 'unmark', targets: ReviewTarget[], reviewer: { name: string; writerId: string }, engineId: string | null): ReviewBody {
    const body = readReviewBody(event, { targets, reviewer, via: 'person', engineId });
    if (!body) { throw new Error('the review targets are not valid'); }
    return body as ReviewBody;
}

export interface MarkState {
    key: string; marked: boolean; target: ReviewTarget; at: string; seq: number; writer: string;
    reviewer: { name: string; writerId: string }; engineId: string | null; status: LineStatus;
}

/**
 * 줄 → 대상마다 마지막 표시(세는 줄만, 사람만). 믿지 않는 작성자 · 검증 안 된 줄의 표시는 `uncounted` 로 따로(세지 않는다 — D5).
 */
export function foldReviews(lines: RecordLine[]): { marks: Map<string, MarkState>; uncounted: Array<{ key: string; marked: boolean; reviewer: string; writer: string; status: LineStatus; at: string }> } {
    const marks = new Map<string, MarkState>();
    const uncounted: Array<{ key: string; marked: boolean; reviewer: string; writer: string; status: LineStatus; at: string }> = [];
    for (const l of lines) {
        if (l.event !== 'mark' && l.event !== 'unmark') { continue; }
        const b = l.body as ReviewBody;
        if (!countable(l) || l.actor.kind !== 'person') {
            for (const t of Array.isArray(b?.targets) ? b.targets : []) {
                try { uncounted.push({ key: targetKey(t), marked: l.event === 'mark', reviewer: String(b?.reviewer?.name ?? ''), writer: l.sig?.w ?? '', status: l.status, at: l.at }); } catch { /* 모르는 꼴 */ }
            }
            continue;
        }
        for (const t of b.targets) {
            const key = targetKey(t);
            marks.set(key, { key, marked: l.event === 'mark', target: t, at: l.at, seq: l.seq, writer: l.sig.w, reviewer: b.reviewer, engineId: b.engineId, status: l.status });
        }
    }
    return { marks, uncounted };
}

export type MarkValidity =
    | { state: 'valid'; how: 'same-fingerprint' | 'same-content' | 'not-changing' }
    | { state: 'review-again'; why: 'not-in-current-results' | 'result-stale' | 'different-values' | 'copy-missing' | 'copy-damaged' | 'changed-since'; differences?: ItemDifference[] };

/**
 * 표시 하나의 지금 유효성(D16). `current` = 지금 그 대상(없으면 null — 결과가 없거나 낡음 · 항목이 없음), `stale` = 지금 결과가 낡음,
 * `reviewedItem` = 확인한 실행의 사본에서 꺼낸 항목(또는 결과) — 사본이 없으면 그 까닭.
 */
export function markValidity(m: MarkState, current: { fp: string | null; value?: unknown; seq?: number | null; stale?: boolean } | null,
    reviewed: () => { ok: true; value: unknown } | { ok: false; error: 'missing' | 'damaged' }): MarkValidity {
    const t = m.target;
    if (t.type === 'change') { return { state: 'valid', how: 'not-changing' }; }
    if (t.type === 'work' || t.type === 'assumption') {
        return current && current.seq === t.seq ? { state: 'valid', how: 'same-fingerprint' } : { state: 'review-again', why: 'changed-since' };
    }
    if (t.type === 'group') {
        return current && current.fp === t.groupFp ? { state: 'valid', how: 'same-fingerprint' } : { state: 'review-again', why: 'different-values' };
    }
    if (!current) { return { state: 'review-again', why: 'not-in-current-results' }; }
    if (current.stale) { return { state: 'review-again', why: 'result-stale' }; }
    const want = t.type === 'check' ? t.checkFp : t.resultFp;
    if (current.fp === want) { return { state: 'valid', how: 'same-fingerprint' }; }
    const r = reviewed();
    if (!r.ok) { return { state: 'review-again', why: r.error === 'damaged' ? 'copy-damaged' : 'copy-missing' }; }
    const c = compareItems(r.value, current.value);
    return c.same ? { state: 'valid', how: 'same-content' } : { state: 'review-again', why: 'different-values', differences: c.differences };
}
