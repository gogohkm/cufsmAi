/**
 * 기록(R2-1) · 변경 묶음 — 설계 §2.4.4. 행동 하나의 앞뒤 스냅숏을 비교해 변경 줄의 몸을 만든다. 쓰지 않는다(쓰기는 log.ts).
 *
 * 끊는 법(`ChangeBatcher` — 호스트가 R2-2 에서 부른다):
 *  - MCP 요청 하나 = 묶음 하나(`run`). 같은 행위자의 겹친 요청은 바깥 것이 닫을 때 한 묶음.
 *  - 편집 상태(F2) 시작 → 끝 = 「사용자 변경」 하나(`sessionStart` · `sessionEnd`), 버리기는 묶음 없음(`sessionDiscard`).
 *  - 그 밖의 화면 변경은 조용한 시간(기본 2 초)으로(`touch` · `tick`).
 *  - 다른 행위자의 행동이 끼면 지금 묶음을 먼저 닫는다(행위자가 섞인 묶음은 없다). 편집 상태가 이어지면 그 뒤 새 묶음으로 다시 연다.
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
}
export interface FollowChange { path: string; from: unknown; to: unknown; by: 'load-analysis' | 'mirror' }
export interface InvalidatedResult { kind: string; id?: string; reason: string }
export interface ChangeBody {
    caseId: string; trigger: string; reason?: string; work?: string; source?: string;
    before: { contentFp: string; modelFp: string; caseFp: string };
    after: { contentFp: string; modelFp: string; caseFp: string };
    fields: FieldChange[]; fieldsOmitted?: number;
    follows?: FollowChange[]; invalidated?: InvalidatedResult[];
    title: string;
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
    if (follows.length) { body.follows = follows; }
    if (opts.invalidated?.length) { body.invalidated = opts.invalidated.slice(0, 40).map((x) => ({ kind: String(x.kind).slice(0, 40), ...(x.id ? { id: String(x.id).slice(0, 80) } : {}), reason: String(x.reason).slice(0, 300) })); }
    return body;
}

interface OpenBatch { ctx: ChangeContext; before: Snapshot; depth: number; kind: 'request' | 'session' | 'quiet'; lastTouch: number }

export interface BatcherDeps {
    snapshot(): Snapshot;
    /** 묶음 하나(그 묶음을 연 행동의 문맥과 함께 — 행위자 · 까닭) */
    emit(body: ChangeBody, ctx: ChangeContext): void;
    now(): number;
    quietMs?: number;
    build?: (ctx: ChangeContext, before: Snapshot, after: Snapshot) => ChangeBody | null;
}

export class ChangeBatcher {
    private open: OpenBatch | null = null;
    private session: ChangeContext | null = null;
    constructor(private readonly d: BatcherDeps) {}

    private close(): void {
        const b = this.open;
        if (!b) { return; }
        this.open = null;
        const after = this.d.snapshot();
        const body = (this.d.build ?? ((c, x, y) => buildChange(c, x, y)))(b.ctx, b.before, after);
        if (body) { this.d.emit(body, b.ctx); }
    }

    private ensure(ctx: ChangeContext, kind: OpenBatch['kind']): OpenBatch {
        const o = this.open;
        if (o) {
            const sameActor = o.ctx.actor.kind === ctx.actor.kind && o.ctx.caseId === ctx.caseId;
            const nest = kind === 'request' && o.kind === 'request' && o.depth > 0 && sameActor;
            const joinQuiet = kind === 'quiet' && o.kind === 'quiet' && sameActor;
            if (!nest && !joinQuiet) { this.close(); }
        }
        if (!this.open) { this.open = { ctx, before: this.d.snapshot(), depth: 0, kind, lastTouch: this.d.now() }; }
        return this.open;
    }

    /** MCP 요청 하나(또는 같은 행위자의 겹친 요청) */
    async run<T>(ctx: ChangeContext, fn: () => T | Promise<T>): Promise<T> {
        const b = this.ensure(ctx, 'request');
        b.depth += 1;
        try { return await fn(); } finally {
            b.depth -= 1;
            if (b.depth === 0 && this.open === b) {
                this.close();
                if (this.session) { this.open = { ctx: this.session, before: this.d.snapshot(), depth: 0, kind: 'session', lastTouch: this.d.now() }; }
            }
        }
    }

    sessionStart(ctx: ChangeContext): void {
        if (this.open && this.open.kind !== 'session') { this.close(); }
        this.session = ctx;
        if (!this.open) { this.open = { ctx, before: this.d.snapshot(), depth: 0, kind: 'session', lastTouch: this.d.now() }; }
    }

    sessionEnd(): void {
        if (this.open?.kind === 'session') { this.close(); }
        this.session = null;
    }

    /** 버리기 — 묶음을 내지 않는다. 들어올 때의 내용과 같아졌는지 돌려준다(호스트가 확인) */
    sessionDiscard(): { backToStart: boolean } {
        const b = this.open?.kind === 'session' ? this.open : null;
        this.open = null; this.session = null;
        if (!b) { return { backToStart: true }; }
        const now = this.d.snapshot();
        return { backToStart: contentFp(b.before.model, b.before.case).contentFp === contentFp(now.model, now.case).contentFp };
    }

    /** 편집 상태 밖의 화면 변경 — 조용한 시간으로 묶는다 */
    touch(ctx: ChangeContext): void {
        if (this.open?.kind === 'session' && this.open.ctx.actor.kind === ctx.actor.kind) { this.open.lastTouch = this.d.now(); return; }
        const b = this.ensure(ctx, 'quiet');
        b.lastTouch = this.d.now();
    }

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
        if (this.open) { this.open.before = this.d.snapshot(); this.open.lastTouch = this.d.now(); }
    }

    /** 다른 대상으로 — 묶음 밖의 열린 것(조용함 · 편집 상태)은 지금의 것으로 닫고, 편집 상태를 끝낸다 */
    closeForSwitch(): void {
        if (this.open && this.open.depth === 0) { this.close(); }
        this.session = null;
    }
}
