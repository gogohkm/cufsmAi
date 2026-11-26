/**
 * 기록(R2-1) · 변경 묶음 — 설계 §2.4.4. 행동 하나의 앞뒤 스냅숏을 비교해 변경 줄의 몸을 만든다. 쓰지 않는다(쓰기는 log.ts).
 *
 * 끊는 법(`ChangeBatcher` — 호스트가 R2-2 에서 부른다):
 *  - MCP 요청 하나 = 묶음 하나(`run`). 같은 행위자의 겹친 요청은 바깥 것이 닫을 때 한 묶음.
 *  - 편집 상태(F2) 시작 → 끝 = 「사용자 변경」 하나(`sessionStart` · `sessionEnd`), 버리기는 묶음 없음(`sessionDiscard`).
 *  - 그 밖의 화면 변경은 조용한 시간(기본 2 초)으로(`touch` · `tick`).
 *  - D4: 열린 묶음이 없을 때 끼운 화면의 연동(mirror · unit-toggle)만으로 바뀐 것은 행위자 `program` 의 줄 하나(호스트가 `touch` 하고 바로 `flush`) —
 *    사람 · AI 의 묶음과 행위자가 달라 그 묶음에 들지도 그것을 닫지도 않는다(열린 묶음이 있으면 호스트는 이 길로 오지 않는다).
 *  - 사람의 묶음(편집 상태 · 조용한 시간)이 열린 동안의 요청: 바꾼 것이 없으면(읽기 — 누구의 것이든) 묶음을 그대로 둔다. 같은 행위자가
 *    바꾸면 그 묶음에 든다. 다른 행위자가 바꾸면 사람 묶음을 그 요청 직전까지로 닫고 요청 묶음을 내고, 편집 상태면 그 뒤 새 묶음으로 다시 연다
 *    (행위자가 섞인 묶음은 없다).
 *  - **요청은 겹친다**(호스트의 요청 처리는 비동기다 — AI 의 긴 계산이 도는 동안 화면의 읽기 · 보기 보고 · 사람의 편집이 들어온다):
 *    · 읽기(`run(…, {readOnly: true})`)는 묶음을 열지도 닫지도 않는다.
 *    · 도는 요청의 묶음은 다른 것이 닫지 못한다. 그 위에 온 다른 행위자의 요청은 **손님** — 끝날 때 그 요청이 도는 동안 바뀐 것만 갈라 낸다
 *      (열린 묶음의 몫은 그 요청이 오기 전까지). 묶음이 하나 나가면 아직 도는 것들은 거기서부터 센다(같은 변경이 두 줄에 들지 않는다).
 *    · 요청이 도는 동안 사람이 편집(`touch` · `sessionStart`)하면 그 요청을 손님으로 돌리고(지금까지 바뀐 것은 그 요청의 줄로) 사람의 묶음을 연다.
 *      `touch` 한 편집의 동기 부분이 끝나면 `touchDone` — 그 편집은 도는 요청의 줄에 들지 않는다.
 *    두 행위자가 같은 동안에 함께 바꾼 것은 스냅숏으로 가를 수 없다 — 먼저 끝난 쪽의 줄에 든다(사라지지는 않는다).
 * 시계 · 스냅숏 · 내보내기는 주입한다 — 순수하게 시험한다.
 */
import { contentFp } from './fp';
import { diffSnapshots, FieldChange, FieldInfoFn, Snapshot } from './differ';
import { changeTitle, DisplayUnits, LabelFn } from './changeText';
import { cleanText, ID_RE } from './names';
import type { Actor } from './log';

export interface ChangeContext {
    caseId: string;
    actor: Actor;
    trigger: string;
    reason?: string | null;
    work?: string | null;
    source?: string | null;
    /** V9b-05: 그 묶음에서 화면 연동(mirror) · 단위 바꿈(unit-toggle)으로 바뀐 것이 있었다 — 사람의 편집에 딸린 것 */
    via?: string[];
    /** 그 묶음의 요청(MCP 동작 하나 · 화면의 실행 하나) 안에서 적힌 실행 id — 묶음이 실행보다 늦게 적혀도 그 실행에 들어간 변경이다 */
    runs?: string[];
}
export interface FollowChange { path: string; from: unknown; to: unknown; by: 'load-analysis' | 'mirror' }
export interface InvalidatedResult { kind: string; id?: string; reason: string }
export interface ChangeBody {
    caseId: string; trigger: string; reason?: string; work?: string; source?: string;
    /** V9b-05: 화면 연동 · 단위 바꿈으로 바뀐 것이 그 묶음에 있었다(via: mirror · unit-toggle) */
    via?: string[];
    /** 같은 요청이 남긴 실행 id(있을 때만 — 옛 줄에는 없다: 읽는 쪽은 시각으로) */
    runs?: string[];
    before: { contentFp: string; modelFp: string; caseFp: string };
    after: { contentFp: string; modelFp: string; caseFp: string };
    fields: FieldChange[]; fieldsOmitted?: number;
    follows?: FollowChange[]; invalidated?: InvalidatedResult[];
    title: string;
}

/**
 * 읽어서 내보낼 때의 행위자(결정 D4 — 통일안 6.5). 적힌 줄은 고쳐 쓰지 않는다:
 *  - 옛 줄의 사람 + trigger mirror · unit-toggle(끼운 화면의 연동만으로 생긴 줄) → `program`
 *  - `screen`(새 화면의 중계) → `person`
 *  - `external`(밖에서 바뀜) → `file` 은 `file: true` 일 때만(work_log — list_changes 는 external 그대로)
 */
export function shownActorKind(kind: unknown, trigger: unknown, opts: { file?: boolean } = {}): string {
    const k = String(kind ?? '');
    if (k === 'person' && (trigger === 'mirror' || trigger === 'unit-toggle')) { return 'program'; }
    if (k === 'screen') { return 'person'; }
    if (k === 'external' && opts.file) { return 'file'; }
    return k;
}

/** 변경 줄의 몸. 다른 것이 없으면(따라 바뀐 것도) null */
export function buildChange(ctx: ChangeContext, before: Snapshot, after: Snapshot, opts: {
    fieldInfo?: FieldInfoFn; labelOf?: LabelFn; units?: DisplayUnits; follows?: FollowChange[]; invalidated?: InvalidatedResult[];
} = {}): ChangeBody | null {
    const d = diffSnapshots(before, after, opts.fieldInfo);
    const follows = (opts.follows || []).slice(0, 60);
    if (!d.fields.length && !follows.length) { return null; }
    const body: ChangeBody = {
        caseId: ctx.caseId, trigger: String(ctx.trigger).slice(0, 80),
        before: contentFp(before.model, before.case), after: contentFp(after.model, after.case),
        fields: d.fields,
        title: changeTitle(d.fields, opts.units ?? 'SI', opts.labelOf) ?? (follows.length ? '따라 바뀐 칸' : ''),
    };
    if (ctx.reason) {
        const r = cleanText(ctx.reason, 300, { field: 'reason', optional: true });
        if (!r.ok) { throw new Error(r.error); }
        if (r.text.trim()) { body.reason = r.text; }
    }
    if (ctx.work) { if (!ID_RE.test(ctx.work)) { throw new Error('bad work item id'); } body.work = ctx.work; }
    if (ctx.source) { if (!ID_RE.test(ctx.source)) { throw new Error('bad source id'); } body.source = ctx.source; }
    if (d.omitted) { body.fieldsOmitted = d.omitted; }
    if (ctx.via && ctx.via.length) { body.via = [...new Set(ctx.via)].filter((v) => v === 'mirror' || v === 'unit-toggle'); }
    if (ctx.runs && ctx.runs.length) { const rs = [...new Set(ctx.runs)].filter((x) => ID_RE.test(x)).slice(-20); if (rs.length) { body.runs = rs; } }
    if (follows.length) { body.follows = follows; }
    if (opts.invalidated?.length) { body.invalidated = opts.invalidated.slice(0, 40).map((x) => ({ kind: String(x.kind).slice(0, 40), ...(x.id ? { id: String(x.id).slice(0, 80) } : {}), reason: String(x.reason).slice(0, 300) })); }
    return body;
}

/**
 * 열린 묶음 하나 — 주인(`open`)이거나 손님(`guests`: 열린 묶음 위에서 도는 다른 행위자의 요청).
 * `before` 는 이 묶음이 가져갈 변경의 시작이다(그 앞은 이미 누군가의 줄이 되었다). `depth` 는 그 안에서 도는 요청 수.
 */
interface OpenBatch { ctx: ChangeContext; before: Snapshot; depth: number; kind: 'request' | 'session' | 'quiet'; lastTouch: number }

export interface BatcherDeps {
    snapshot(): Snapshot;
    /** 묶음 하나(그 묶음을 연 행동의 문맥과 함께 — 행위자 · 까닭) */
    emit(body: ChangeBody, ctx: ChangeContext): void;
    now(): number;
    quietMs?: number;
    build?: (ctx: ChangeContext, before: Snapshot, after: Snapshot) => ChangeBody | null;
}

const sameActor = (a: ChangeContext, b: ChangeContext): boolean => a.actor.kind === b.actor.kind && a.caseId === b.caseId;

/**
 * 묶음 문맥에 칸을 더한 새 문맥 — 호스트가 붙인 열거되지 않는 표지(`__t0` — 묶음이 열린 때, 그 뒤의 무효를 그 묶음에 싣는다)를 잇는다.
 * N-7a: 펼침(`{...ctx}`)이 그 표지를 떨어뜨려 실행이 든 사람 묶음의 `invalidated` 가 비었다
 */
function extendCtx(ctx: ChangeContext, patch: Partial<ChangeContext>): ChangeContext {
    const out: ChangeContext = { ...ctx, ...patch };
    for (const k of Object.getOwnPropertyNames(ctx)) {
        const d = Object.getOwnPropertyDescriptor(ctx, k);
        if (d && !d.enumerable && !(k in patch)) { Object.defineProperty(out, k, d); }
    }
    return out;
}

export class ChangeBatcher {
    private open: OpenBatch | null = null;
    /**
     * 손님 — 열린 묶음(도는 요청 · 사람의 묶음) 위에서 도는 다른 행위자의 요청(같은 행위자의 겹친 요청은 한 손님). 열린 묶음을 닫지 않고,
     * 끝날 때 그 요청이 도는 동안 바뀐 것만 갈라 낸다. 온 차례대로. 손님의 `before` 는 열린 묶음의 `before` 보다 앞서지 않는다.
     */
    private guests: OpenBatch[] = [];
    private session: ChangeContext | null = null;
    /** 요청의 문맥 → 그 요청이 든 묶음(`noteRun` 이 실행 id 를 그 묶음에 싣는다 — 겹친 요청은 저마다의 문맥으로 찾는다) */
    private owner = new WeakMap<ChangeContext, OpenBatch>();
    constructor(private readonly d: BatcherDeps) {}

    /**
     * 요청(`run` 에 준 문맥) 안에서 실행 하나가 적혔다 — 그 요청이 든 묶음의 줄에 `runs` 로 싣는다. 사람의 묶음(조용함 · 편집 상태)에 든
     * 화면의 실행이면 그 묶음은 그 실행까지다(뒤의 편집은 새 묶음 — `touch`).
     */
    noteRun(ctx: ChangeContext, runId: string): void {
        const b = this.owner.get(ctx);
        if (!b || !runId) { return; }
        b.ctx = extendCtx(b.ctx, { runs: [...(b.ctx.runs || []), runId] });
    }

    private build(ctx: ChangeContext, before: Snapshot, after: Snapshot): ChangeBody | null {
        return (this.d.build ?? ((c, x, y) => buildChange(c, x, y)))(ctx, before, after);
    }
    /** 묶음이 하나 나갔다(또는 기준선이 옮겨졌다) — 아직 도는 손님은 여기서부터 센다(같은 변경이 두 줄에 들지 않게) */
    private rebaseGuests(to: Snapshot): void { for (const g of this.guests) { g.before = to; } }

    /** 열린 묶음을 지금으로 닫는다 */
    private close(): void {
        const b = this.open;
        if (!b) { return; }
        this.open = null;
        const after = this.d.snapshot();
        const body = this.build(b.ctx, b.before, after);
        if (body) { this.d.emit(body, b.ctx); }
        this.rebaseGuests(after);
    }

    /** 열린 것이 없을 때 새 묶음. 주인 없이 돌던 손님이 그 사이 바꾼 것은 그 손님의 줄로 먼저 낸다(새 묶음이 가져가지 않게) */
    private start(ctx: ChangeContext, kind: OpenBatch['kind']): OpenBatch {
        const now = this.d.snapshot();
        if (this.guests.length) {
            const g = this.guests[0];
            const body = this.build(g.ctx, g.before, now);
            if (body) { this.d.emit(body, g.ctx); }
            this.rebaseGuests(now);
        }
        this.open = { ctx, before: now, depth: 0, kind, lastTouch: this.d.now() };
        return this.open;
    }

    /** 요청 하나가 그 묶음(주인 · 손님) 안에서 돈다 — 마지막 요청이 끝나면 닫는다(주인) · 갈라 낸다(손님) */
    private async fly<T>(t: OpenBatch, fn: () => T | Promise<T>): Promise<T> {
        t.depth += 1;
        try { return await fn(); } finally {
            t.depth -= 1;
            if (t.depth === 0) {
                if (this.open === t) {
                    this.close();
                    if (this.session) { this.open = { ctx: this.session, before: this.d.snapshot(), depth: 0, kind: 'session', lastTouch: this.d.now() }; }
                } else { this.leave(t); }
            }
        }
    }

    /**
     * 손님이 끝났다. 도는 동안 바뀐 것이 없으면(묻기만 했다) 열린 묶음은 그대로다. 있으면: 열린 묶음의 몫(그 요청이 오기 전까지)을 먼저 내고
     * 그 요청의 줄을 낸다 — 도는 요청은 이어 가고, 편집 상태는 그 뒤 새 묶음으로 다시 열고, 조용한 묶음은 거기서 끝난다.
     */
    private leave(g: OpenBatch): void {
        const i = this.guests.indexOf(g);
        if (i < 0) { return; }
        this.guests.splice(i, 1);
        const after = this.d.snapshot();
        const body = this.build(g.ctx, g.before, after);
        if (!body) { return; }
        const host = this.open;
        if (host) {
            const mine = this.build(host.ctx, host.before, g.before);
            if (mine) { this.d.emit(mine, host.ctx); }
        }
        this.d.emit(body, g.ctx);
        if (host) {
            if (host.kind === 'request') { host.before = after; }
            else { this.open = host.kind === 'session' && this.session ? { ctx: this.session, before: after, depth: 0, kind: 'session', lastTouch: this.d.now() } : null; }
        }
        this.rebaseGuests(after);
    }

    /** 도는 요청의 묶음을 손님으로 돌린다(사람이 그 사이 편집을 시작했다) — 지금까지 바뀐 것은 그 요청의 줄로 내고, 그 뒤는 끝날 때 갈린다 */
    private demote(o: OpenBatch): void {
        const now = this.d.snapshot();
        const body = this.build(o.ctx, o.before, now);
        if (body) { this.d.emit(body, o.ctx); }
        this.open = null;
        this.guests.push(o);
        this.rebaseGuests(now);
    }

    /** 열린 묶음의 주인이 손대기 직전 — 도는 손님이 지금까지 바꾼 것을 그 손님의 줄로 가른다(주인의 편집이 손님의 줄에 들지 않게) */
    private cutGuests(): void {
        if (!this.guests.length) { return; }
        const now = this.d.snapshot();
        const g = this.guests[0];
        const body = this.build(g.ctx, g.before, now);
        if (body) {
            const host = this.open;
            if (host) {
                const mine = this.build(host.ctx, host.before, g.before);
                if (mine) { this.d.emit(mine, host.ctx); }
                host.before = now;
            }
            this.d.emit(body, g.ctx);
        }
        this.rebaseGuests(now);
    }

    /**
     * MCP 요청 하나(또는 같은 행위자의 겹친 요청). `readOnly` — 모델 · 입력을 바꾸지 않는 동작(읽기 · 보기 보고): 묶음을 열지도 닫지도
     * 않는다(화면의 읽기가 도는 요청의 묶음을 끊어 그 요청이 뒤에 쓴 것이 기록에서 빠지던 것).
     */
    async run<T>(ctx: ChangeContext, fn: () => T | Promise<T>, opts: { readOnly?: boolean } = {}): Promise<T> {
        if (opts.readOnly) { return await fn(); }
        // 같은 행위자의 손님이 이미 돈다 — 그 안에서(겹친 요청)
        const mate = this.guests.find((g) => sameActor(g.ctx, ctx));
        if (mate) { this.owner.set(ctx, mate); return await this.fly(mate, fn); }
        const o = this.open;
        if (!o) { const t = this.start(ctx, 'request'); this.owner.set(ctx, t); return await this.fly(t, fn); }
        if (sameActor(o.ctx, ctx)) {
            this.owner.set(ctx, o);
            // 같은 행위자의 겹친 요청 — 바깥 것이 닫을 때 한 묶음
            if (o.kind === 'request') { return await this.fly(o, fn); }
            // 사람의 묶음(조용함 · 편집 상태) 안의 같은 행위자 요청(화면 자신의 쓰기) — 그 묶음에 든다
            this.cutGuests();
            try { return await fn(); } finally {
                if (this.open === o) { o.lastTouch = this.d.now(); }
                this.touchDone();
            }
        }
        // 다른 행위자의 요청 — 열린 묶음(도는 요청 · 사람의 묶음)을 닫지 않는다. 이 요청이 도는 동안 바뀐 것만 끝날 때 갈라 낸다
        const g: OpenBatch = { ctx, before: this.d.snapshot(), depth: 0, kind: 'request', lastTouch: this.d.now() };
        this.owner.set(ctx, g);
        this.guests.push(g);
        return await this.fly(g, fn);
    }

    sessionStart(ctx: ChangeContext): void {
        const o = this.open;
        // 도는 요청은 닫지 않는다(닫으면 그 요청이 뒤에 쓴 것이 사람의 묶음에 든다) — 손님으로 돌린다
        if (o && o.kind === 'request') { this.demote(o); }
        else if (o && o.kind !== 'session') { this.close(); }
        this.session = ctx;
        if (!this.open) { this.start(ctx, 'session'); }
    }

    sessionEnd(): void {
        if (this.open?.kind === 'session') { this.close(); }
        this.session = null;
    }

    /**
     * 버리기 — 묶음을 내지 않는다. 들어올 때(마지막으로 적힌 때 — 끼어든 요청 뒤면 그 뒤)의 내용과 같아졌는지와 그 사본을 돌려준다.
     * 호스트가 되돌리고(R2-3), 되돌린 상태가 그 사본과 다르면(앞서 적힌 사람 묶음까지 되돌렸으면) recordDiscard 로 한 줄을 낸다.
     */
    sessionDiscard(): { backToStart: boolean; before: Snapshot | null; ctx: ChangeContext | null } {
        const b = this.open?.kind === 'session' ? this.open : null;
        const ctx = this.session;
        this.open = null; this.session = null;
        if (!b) { return { backToStart: true, before: null, ctx }; }
        const now = this.d.snapshot();
        return { backToStart: contentFp(b.before.model, b.before.case).contentFp === contentFp(now.model, now.case).contentFp, before: b.before, ctx: b.ctx };
    }

    /** 되돌린 버리기의 한 줄(적힌 것과 지금이 다를 때만) — 사람의 문맥, trigger 'edit-discard' */
    recordDiscard(ctx: ChangeContext, before: Snapshot): void {
        const after = this.d.snapshot();
        const body = this.build({ ...ctx, trigger: 'edit-discard' }, before, after);
        if (body) { this.d.emit(body, ctx); }
    }

    /** V9b-05: 지금 열린 묶음에 「화면 연동 · 단위 바꿈으로 바뀐 것」 을 적는다(그 묶음의 줄에 via) */
    markVia(via: 'mirror' | 'unit-toggle'): void {
        const o = this.open;
        if (!o) { return; }
        o.ctx = extendCtx(o.ctx, { via: [...new Set([...(o.ctx.via || []), via])] });
    }

    /** 편집 상태인가 */
    get inSession(): boolean { return this.session !== null; }

    /**
     * 화면의 편집(사람) 직전 — 편집 상태 안이면 그 묶음, 밖이면 조용한 시간으로 묶는다. 요청이 돌고 있으면: 같은 행위자의 것이면 그 묶음에
     * 들고, 다른 행위자의 것이면 그 요청을 닫지 않고 손님으로 돌린 뒤 이 편집의 묶음을 연다. 편집의 동기 부분이 끝나면 `touchDone`.
     */
    touch(ctx: ChangeContext): void {
        let o = this.open;
        // 실행이 든 사람의 묶음(화면의 실행)은 그 실행까지 — 그 뒤의 편집은 새 묶음(그 실행에 들어간 것으로 읽히지 않게)
        if (o && o.kind !== 'request' && o.depth === 0 && o.ctx.runs && o.ctx.runs.length) {
            const sess = o.kind === 'session';
            this.close();
            if (sess && this.session) { this.open = { ctx: this.session, before: this.d.snapshot(), depth: 0, kind: 'session', lastTouch: this.d.now() }; }
            o = this.open;
        }
        if (o && o.kind === 'request') {
            if (sameActor(o.ctx, ctx)) { this.cutGuests(); return; }
            this.demote(o);
        } else if (o && (o.kind === 'session' ? o.ctx.actor.kind === ctx.actor.kind : sameActor(o.ctx, ctx))) {
            this.cutGuests();
            o.lastTouch = this.d.now();
            return;
        } else if (o) { this.close(); }
        this.start(ctx, 'quiet');
    }

    /** `touch` 한 편집의 동기 부분이 끝났다 — 그 사이 바뀐 것은 그 편집의 것: 도는 손님은 여기서부터 센다(그 편집이 손님의 줄에 들지 않게) */
    touchDone(): void { if (this.guests.length) { this.rebaseGuests(this.d.snapshot()); } }

    /** 조용한 시간이 지났으면 닫는다 */
    tick(): void {
        const b = this.open;
        if (b && b.kind === 'quiet' && this.d.now() - b.lastTouch >= (this.d.quietMs ?? 2000)) { this.close(); }
    }

    /** 끝낼 때 · 파일을 바꿀 때 — 열린 것을 닫는다 */
    flush(): void { if (this.open && this.open.depth === 0) { this.close(); } }

    /** 지금 열린 묶음이 있는가(시험 · 상태) */
    get pending(): 'request' | 'session' | 'quiet' | null { return this.open ? this.open.kind : null; }

    /**
     * 파일을 열었다(기준선, 설계 §2.4.4 ④) — 열린 묶음의 「전」 을 지금으로 옮긴다. 연 요청(open_case · load_project) 이 옛 파일과 새 파일의
     * 차이를 한 묶음으로 내지 않게. 편집 상태도 새 파일 위에서 다시 시작한다
     */
    rebase(): void {
        if (!this.open && !this.guests.length) { return; }
        const now = this.d.snapshot();
        if (this.open) { this.open.before = now; this.open.lastTouch = this.d.now(); }
        this.rebaseGuests(now);
    }

    /** 다른 대상으로 — 묶음 밖의 열린 것(조용함 · 편집 상태)은 지금의 것으로 닫고, 편집 상태를 끝낸다 */
    closeForSwitch(): void {
        if (this.open && this.open.depth === 0) { this.close(); }
        this.session = null;
    }
}
