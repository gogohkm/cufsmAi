/**
 * 기록(R1-2) · 실행 이력 `log/runs` — 설계 §2.4.3.
 *
 * `run` 한 줄 = 엔진이 낸 결과 하나를 호스트가 받아들인 순간. 몸:
 *  `{caseId, kind, engineId, modelFp, caseFp, requestFp, resultFp, blob, snapshot, caseRev, ms, status, error?, summary}`
 *  - `kind` 는 호스트의 결과 종류와 같은 이름(여섯 자리 + 소성 · 진동 · 검증, 서명곡선은 해석과 따로).
 *  - `requestFp` = 엔진에 보낸 요청 **바이트**의 지문, `resultFp` = 결과의 정규 JSON 지문(시각 키는 뺀다).
 *  - `blob` = 결과 사본(내용 주소 · gzip)의 sha256, `snapshot` = 모델 + 검토 입력 사본의 sha256 — 없으면 null.
 *  - `summary` 는 4 KB 까지(판정 · 최대 판정비 · 지배 항목 · 판정 수 — 시작 목록 · 07 의 「먼저 한 것」 이 읽는 것).
 * VS Code 를 쓰지 않는다.
 */
import { canonicalJson, FP_RE } from './canonical';
import type { LogSpec, RecordLine } from './log';
import { countable } from './log';
import { cleanHeaderText, ID_RE } from './names';
import { eventsOf } from './policy';
import { CASE_ID_RE } from './project';

export const RUN_KINDS = ['buckling_analysis', 'signature_ss', 'design_dsm', 'load_analysis', 'member_design', 'connection', 'lap',
    'plastic_surface', 'vibration', 'validation'] as const;
export type RunKind = typeof RUN_KINDS[number];
export const RUN_EVENTS = eventsOf('runs');
export const SUMMARY_MAX_BYTES = 4096;
const SHA_RE = /^[0-9a-f]{64}$/;

export interface RunSummary {
    pass: boolean | null;
    maxRatio: number | null;
    governing: Array<{ id: string; ratio: number | null; verdict: string; location?: string }>;
    counts: { pass: number; fail: number; not_evaluated: number; other: number };
    regions?: number;
    /** 그 실행이 쓴 단면 성질 몇 개(엔진 US — in · in² · in⁴ · in³ · in⁶) — 07 의 「먼저 한 것」 전 → 후 */
    props?: Record<string, number>;
}
/** 실행 요약에 남기는 단면 성질(있는 것만) */
export const SUMMARY_PROPS = ['A', 'Ixx', 'Izz', 'Sx', 'Sxx', 'Sf', 'J', 'Cw', 't'] as const;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 결과에서 작은 요약을 짓는다(엔진 결과의 꼴에 기대지 않는 것만 — 없으면 빈 값) */
export function runSummary(result: any, props?: any): RunSummary {
    const s: RunSummary = { pass: null, maxRatio: null, governing: [], counts: { pass: 0, fail: 0, not_evaluated: 0, other: 0 } };
    if (props && typeof props === 'object') {
        const p: Record<string, number> = {};
        for (const k of SUMMARY_PROPS) { const v = num(props[k]); if (v !== null) { p[k] = v; } }
        if (Object.keys(p).length) { s.props = p; }
    }
    if (!result || typeof result !== 'object') { return s; }
    s.pass = typeof result.pass === 'boolean' ? result.pass : null;
    s.maxRatio = num(result.utilization);
    const checks: any[] = [];
    const collect = (r: any) => { if (r && Array.isArray(r.design_checks)) { checks.push(...r.design_checks); } };
    collect(result);
    if (Array.isArray(result.regions)) {
        s.regions = result.regions.length;
        for (const g of result.regions) { collect(g?.result); }
    }
    for (const c of checks) {
        if (!c || typeof c !== 'object') { continue; }
        const v = String(c.verdict);
        if (v === 'pass') { s.counts.pass += 1; } else if (v === 'fail') { s.counts.fail += 1; }
        else if (v === 'not_evaluated') { s.counts.not_evaluated += 1; } else { s.counts.other += 1; }
        const r = num(c.ratio);
        if (r !== null && (s.maxRatio === null || r > s.maxRatio) && result.utilization === undefined) { s.maxRatio = r; }
        if (c.governs === true && s.governing.length < 12) {
            const id = typeof c.id === 'string' && ID_RE.test(c.id) ? c.id : null;
            if (id) {
                const loc = c.location && typeof c.location === 'object' ? cleanHeaderText([c.location.region, c.location.check_point].filter(Boolean).join(' '), 60) : null;
                s.governing.push({ id, ratio: r, verdict: cleanHeaderText(v, 20) ?? '', ...(loc ? { location: loc } : {}) });
            }
        }
    }
    while (s.governing.length > 0 && Buffer.byteLength(canonicalJson(s), 'utf8') > SUMMARY_MAX_BYTES) { s.governing.pop(); }
    return s;
}

function readRunBody(event: string, b: Record<string, any>): Record<string, any> | null {
    if (event === 'prune') {
        if (!Array.isArray(b.blobs) || b.blobs.length > 2000 || !b.blobs.every((x: unknown) => typeof x === 'string' && SHA_RE.test(x))) { return null; }
        return { blobs: b.blobs };
    }
    if (event !== 'run') { return null; }
    if (!(RUN_KINDS as readonly string[]).includes(b.kind)) { return null; }
    if (b.caseId !== null && !(typeof b.caseId === 'string' && CASE_ID_RE.test(b.caseId))) { return null; }
    const fpOrNull = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'string' && FP_RE.test(v) ? v : undefined);
    const shaOrNull = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'string' && SHA_RE.test(v) ? v : undefined);
    const out: Record<string, any> = { caseId: b.caseId, kind: b.kind };
    for (const k of ['engineId', 'modelFp', 'caseFp', 'requestFp', 'resultFp']) { const v = fpOrNull(b[k]); if (v === undefined) { return null; } out[k] = v; }
    for (const k of ['blob', 'snapshot']) { const v = shaOrNull(b[k]); if (v === undefined) { return null; } out[k] = v; }
    out.caseRev = Number.isSafeInteger(b.caseRev) ? b.caseRev : null;
    out.ms = Number.isSafeInteger(b.ms) && b.ms >= 0 ? b.ms : null;
    out.status = b.status === 'failed' ? 'failed' : 'ok';
    if (out.status === 'failed') { out.error = cleanHeaderText(b.error, 300) ?? ''; }
    const sm = b.summary;
    out.summary = sm && typeof sm === 'object' && !Array.isArray(sm) && Buffer.byteLength(JSON.stringify(sm), 'utf8') <= SUMMARY_MAX_BYTES ? sm : null;
    return out;
}

export const RUNS_SPEC: LogSpec = { type: 'runs', major: 1, events: RUN_EVENTS, sanitize: readRunBody };

export interface RunEntry {
    runId: string; at: string; caseId: string | null; kind: RunKind; actor: string; client: string | null; writer: string;
    /** 그 실행을 부른 MCP 요청 id(있으면) — work_log 가 같은 요청의 변경 묶음을 그 실행에 붙인다 */
    request: string | null;
    engineId: string | null; modelFp: string | null; caseFp: string | null; requestFp: string | null; resultFp: string | null;
    blob: string | null; snapshot: string | null; caseRev: number | null; ms: number | null; status: 'ok' | 'failed'; error?: string;
    summary: RunSummary | null;
}

/** 세는 줄의 실행들(시각 차례) */
export function foldRuns(lines: RecordLine[]): RunEntry[] {
    return lines.filter((l) => countable(l) && l.event === 'run').map((l) => ({
        runId: l.id, at: l.at, caseId: l.body.caseId, kind: l.body.kind, actor: l.actor.kind, client: l.actor.client ?? null, request: l.actor.request ?? null, writer: l.sig.w,
        engineId: l.body.engineId, modelFp: l.body.modelFp, caseFp: l.body.caseFp, requestFp: l.body.requestFp, resultFp: l.body.resultFp,
        blob: l.body.blob, snapshot: l.body.snapshot, caseRev: l.body.caseRev, ms: l.body.ms, status: l.body.status,
        ...(l.body.error ? { error: l.body.error } : {}), summary: l.body.summary,
    }));
}

/** 대상 · 종류마다 마지막 실행 */
export function lastRunByKind(runs: RunEntry[], caseId: string | null): Map<RunKind, RunEntry> {
    const out = new Map<RunKind, RunEntry>();
    for (const r of runs) { if (r.caseId === caseId) { out.set(r.kind, r); } }
    return out;
}

/** 실행 사본 정리(R4-3): 대상 · 종류마다 새 것 `keepPerKind` 개 + `keepRuns`(확인 · 대안 · 발행이 가리키는 실행)는 남긴다 */
export const PRUNE_KEEP_PER_KIND = 20;
export function planPrune(runs: RunEntry[], opts: { keepRuns: Set<string>; keepBlobs: Set<string>; alreadyPruned: Set<string>; keepPerKind?: number }): string[] {
    const per = opts.keepPerKind ?? PRUNE_KEEP_PER_KIND;
    const groups = new Map<string, RunEntry[]>();
    for (const r of runs) { const k = `${r.caseId ?? ''}|${r.kind}`; groups.set(k, [...(groups.get(k) || []), r]); }
    const kept = new Set<string>();
    const dropped: RunEntry[] = [];
    for (const list of groups.values()) {
        list.forEach((r, i) => { if (i >= list.length - per || opts.keepRuns.has(r.runId)) { kept.add(r.runId); } else { dropped.push(r); } });
    }
    // 남기는 실행 · 그 밖의 기록이 가리키는 해시는 지우지 않는다(사본은 내용 주소 — 같은 해시를 여러 실행이 쓴다)
    const keep = new Set(opts.keepBlobs);
    for (const r of runs) { if (kept.has(r.runId)) { if (r.blob) { keep.add(r.blob); } if (r.snapshot) { keep.add(r.snapshot); } } }
    const out = new Set<string>();
    for (const r of dropped) {
        for (const b of [r.blob, r.snapshot]) { if (b && !keep.has(b) && !opts.alreadyPruned.has(b)) { out.add(b); } }
    }
    return [...out].sort();
}
