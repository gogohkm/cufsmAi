/**
 * 기록(R1-2) · 행위자 문맥의 저장소 — 설계 §3.1(`mcp/bridge.ts` 가 `handleMcpAction` 을 감싼다) · §3.5 층 6.
 *
 *  - MCP 다리의 `POST /action` 은 늘 문맥 안에서 패널을 부른다: 기본 `ai`. 다리의 중계(새 화면 — `desktop/host` 의 `/api/mcp/action`)가
 *    **이 프로세스의 비밀**(`SCREEN_SECRET`)을 `X-StCFSD-Screen` 머리에 실었을 때만 `screen`(토큰만으로는 화면으로 위장하지 못한다).
 *  - 패널의 웹뷰 메시지(편집 상태의 화면 — 사람)는 `person` 문맥 안에서 처리한다.
 *  - 머리의 글(`X-StCFSD-Client` · `-Request-Id` · `-Reason` · `-Work` · `-Source`)은 `records/context.cleanContext`(→ `names.cleanHeaderText`) 로.
 * 기록 데스크는 `currentActor()` 를 주입받는다. 사람만 하는 함수는 `ai` · `screen` 문맥 안에서 던진다.
 */
import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';
import { ActorContext, cleanContext } from '../records/context';

const store = new AsyncLocalStorage<ActorContext>();

/** 이 프로세스의 화면 중계 비밀(프로세스마다 새로 — 파일 · 포트 파일에 쓰지 않는다. 같은 프로세스의 다리 중계에만 건넨다) */
export const SCREEN_SECRET: string = crypto.randomBytes(32).toString('hex');
export const SCREEN_HEADER = 'x-stcfsd-screen';
export const REASON_HEADER = 'x-stcfsd-reason';
export const WORK_HEADER = 'x-stcfsd-work';
export const SOURCE_HEADER = 'x-stcfsd-source';

export function currentActor(): ActorContext | undefined { return store.getStore(); }
export function runAs<T>(ctx: ActorContext, fn: () => T): T { return store.run(ctx, fn); }

function screenSecretMatches(v: unknown): boolean {
    if (typeof v !== 'string' || v.length !== SCREEN_SECRET.length) { return false; }
    return crypto.timingSafeEqual(Buffer.from(v), Buffer.from(SCREEN_SECRET));
}

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
/** MCP 서버가 퍼센트 부호화해 싣는 글(까닭 · 업무 · 원자료) — 풀 수 없으면 버린다 */
const decoded = (v: string | string[] | undefined): string | undefined => {
    const t = one(v);
    if (t === undefined) { return undefined; }
    try { return decodeURIComponent(t); } catch { return undefined; }
};

/** MCP 다리 요청의 머리 → 문맥(기본 ai, 비밀이 맞을 때만 screen) */
export function contextFromHeaders(h: Record<string, string | string[] | undefined>, action?: string): ActorContext {
    return cleanContext({
        kind: screenSecretMatches(one(h[SCREEN_HEADER])) ? 'screen' : 'ai',
        client: one(h['x-stcfsd-client']), requestId: one(h['x-stcfsd-request-id']), tool: action,
        reason: decoded(h[REASON_HEADER]), work: decoded(h[WORK_HEADER]), source: decoded(h[SOURCE_HEADER]),
    });
}
