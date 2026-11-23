/**
 * 기록(R1-2) · 행위자 문맥 — 설계 §2.2(행위자) · §3.1(`mcp/bridge.ts` 의 `AsyncLocalStorage`) · §3.5 층 6.
 *
 * 2 걸음에서 MCP 다리가 `handleMcpAction` 을 `AsyncLocalStorage.run(ctx, …)` 로 감싼다. 이 모듈은 그 문맥의 **꼴**과
 * 다듬기 · 줄의 행위자로 바꾸기만 한다(저장소를 갖지 않는다 — 데스크는 `currentContext()` 를 주입받는다).
 *  - `ai`: MCP 서버가 요청 id 머리를 붙인 요청. `screen`: 다리의 중계가 싣는 프로세스 안 비밀 머리가 맞을 때만(새 화면이 부른 것).
 *  - `person`: 편집 상태의 웹뷰 · 사람만 하는 경로(다리의 `/api/person/*`). `program`: 호스트가 스스로. `file` · `external`: 열기 · 발견.
 *  - `reason` · `work` · `source` 는 MCP 머리(`X-StCFSD-Reason` · `-Work` · `-Source`)에서 — 제어 문자 제거 · 길이 한도.
 * VS Code 를 쓰지 않는다.
 */
import type { Actor, ActorKind } from './log';
import { cleanHeaderText, ID_RE } from './names';

export const CONTEXT_KINDS = ['ai', 'screen', 'person', 'program', 'file', 'external'] as const;
export type ContextKind = typeof CONTEXT_KINDS[number];

/** 한 행동의 문맥 — 2 걸음의 `AsyncLocalStorage` 가 이것을 나른다 */
export interface ActorContext {
    kind: ContextKind;
    /** MCP 클라이언트 이름(예: `claude-ai/0.12`) — 80자 */
    client?: string;
    /** MCP 요청 id — 기록 id 꼴(`^[A-Za-z0-9_.:-]{1,80}$`) */
    requestId?: string;
    /** 그 행동의 도구 · 동작 이름(예: `design_purlin`) — 80자 */
    tool?: string;
    /** AI 가 밝힌 이유 — 300자, 제어 문자 제거 */
    reason?: string;
    /** 업무 항목 id(`Q-3` · `R-2` …) */
    work?: string;
    /** 원자료 id(`S-1` …) */
    source?: string;
}

export const CONTEXT_LIMITS = { client: 80, tool: 80, reason: 300 } as const;

/** 받은 문맥(머리 · 다리에서 온 것)을 다듬는다 — 모르는 종류는 `ai`(가장 좁은 권한), 꼴 밖의 id 는 버린다 */
export function cleanContext(raw: unknown): ActorContext {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const kind = (CONTEXT_KINDS as readonly string[]).includes(String(r.kind)) ? r.kind as ContextKind : 'ai';
    const out: ActorContext = { kind };
    const client = cleanHeaderText(r.client, CONTEXT_LIMITS.client); if (client) { out.client = client; }
    const tool = cleanHeaderText(r.tool, CONTEXT_LIMITS.tool); if (tool) { out.tool = tool; }
    const reason = cleanHeaderText(r.reason, CONTEXT_LIMITS.reason); if (reason) { out.reason = reason; }
    for (const k of ['requestId', 'work', 'source'] as const) {
        const v = r[k];
        if (typeof v === 'string' && ID_RE.test(v)) { out[k] = v; }
    }
    return out;
}

/** MCP 길(AI 또는 새 화면의 중계)의 문맥인가 — 사람만 하는 함수는 이 안에서 부르면 던진다(§3.5 층 6) */
export function isMcpContext(ctx: ActorContext | undefined | null): boolean {
    return !!ctx && (ctx.kind === 'ai' || ctx.kind === 'screen');
}

/**
 * 줄의 행위자. 문맥이 없으면 `fallback`(호스트가 스스로 한 것 — 보통 `program`).
 * `screen`(새 화면이 중계로 부른 것)은 기록 줄에서 `person` 이다 — 그 화면의 단추를 누른 것은 사람이다(설계 §2.2 의 「screen 은
 * 쓰지 않는다」 는 읽기 · 보기 보고에 대한 것; 실행 · 저장처럼 줄이 생기는 행동은 사람의 것으로 적는다 — §10.3).
 */
export function toActor(ctx: ActorContext | undefined | null, fallback: ActorKind = 'program'): Actor {
    if (!ctx) { return { kind: fallback }; }
    const kind: ActorKind = ctx.kind === 'screen' ? 'person' : ctx.kind;
    const a: Actor = { kind };
    if (ctx.client) { a.client = ctx.client; }
    if (ctx.requestId) { a.request = ctx.requestId; }
    if (ctx.tool) { a.tool = ctx.tool; }
    return a;
}
