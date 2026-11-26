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
    // 판정이 아닌 결과의 비(엔진이 가정한 길이 — length_assumed, 주 소요가 빠짐 — utilization_valid false)는 최대 판정비도 지배 항목도 아니다
    // (화면은 호스트의 값 그대로 「판정 없음」 을 보인다). 그런 결과가 NG(pass false — 평가한 한계상태가 넘는다)이면 넘은 항목(fail)의 비 · 그 항목만
    const noVerdictRatio = noVerdictUtilization(result);
    const failOnly = noVerdictRatio && result.pass === false;
    s.maxRatio = noVerdictRatio ? null : num(result.utilization);
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
        const counted = noVerdictRatio ? (failOnly && v === 'fail' && c.trusted !== false) : result.utilization === undefined;
        if (r !== null && counted && (s.maxRatio === null || r > s.maxRatio)) { s.maxRatio = r; }
        if (((c.governs === true && !noVerdictRatio) || (failOnly && v === 'fail' && c.trusted !== false)) && s.governing.length < 12) {
            const id = typeof c.id === 'string' && ID_RE.test(c.id) ? c.id : null;
            if (id) {
                const loc = c.location && typeof c.location === 'object' ? cleanHeaderText([c.location.region, c.location.check_point].filter(Boolean).join(' '), 60) : null;
                s.governing.push({ id, ratio: r, verdict: cleanHeaderText(v, 20) ?? '', ...(loc ? { location: loc } : {}) });
            }
        }
    }
    // 엔진(2026-11-25 둘째 판): 빈 길이에서 길이와 상관없는 하한(가장 유리한 길이의 엔진 강도)이 넘은 NG — 그 하한의 비와 그 항목이 판정비 · 지배다
    // (그 항목이 가정한 길이의 검토로 trusted false 여도 — 하한은 길이와 상관없다). 다른 넘은 항목은 그 뒤에
    // 2026-11-26: 같은 규칙에 「구멍 없는 강도로도 넘음」(구멍 조항을 평가하지 못한 확실한 불합격). 퍼린 묶음은 구간의 결과마다
    const bounds = [lengthBoundFailure(result), ...(Array.isArray(result.regions) ? result.regions.map((g: any) => lengthBoundFailure(g?.result)) : [])]
        .filter((b): b is NonNullable<ReturnType<typeof lengthBoundFailure>> => b !== null)
        .sort((a, b) => a.ratio - b.ratio);
    for (const bound of bounds) {
        if (s.maxRatio === null || bound.ratio > s.maxRatio) { s.maxRatio = bound.ratio; }
        if (bound.id) {
            s.governing = [{ id: bound.id, ratio: bound.ratio, verdict: 'fail' }, ...s.governing.filter((g) => g.id !== bound.id)].slice(0, 12);
        }
    }
    while (s.governing.length > 0 && Buffer.byteLength(canonicalJson(s), 'utf8') > SUMMARY_MAX_BYTES) { s.governing.pop(); }
    return s;
}

export const FAILS_WITHOUT_HOLES = 'member.reason.fails_without_holes';
/** 구멍 없는 강도의 상한으로 낸 확실한 불합격 검토(trusted false 이지만 판정이다) */
export function failsWithoutHoles(c: any): boolean {
    return !!c && typeof c === 'object' && c.verdict === 'fail' && c.reason_code === FAILS_WITHOUT_HOLES;
}
export interface BoundFailure { ratio: number; id: string | null; basis: 'length' | 'holes'; source: string }

/** 구멍 조항을 평가하지 못했지만 구멍 없는 강도의 상한을 넘은 것(webview/js/utils.js holesBoundCandidates 와 같은 규칙) */
function holesBoundCandidates(result: any): BoundFailure[] {
    const out: BoundFailure[] = [];
    const dc: any[] = Array.isArray(result.design_checks) ? result.design_checks : [];
    const add = (id: string, blockRatio: unknown, source: string) => {
        const c = dc.find((x) => x && x.id === id) || null;
        const r = c && failsWithoutHoles(c) && num(c.ratio) !== null ? num(c.ratio) : num(blockRatio);
        if (r !== null && r > 1) { out.push({ ratio: r, id: c && ID_RE.test(id) ? id : null, basis: 'holes', source }); }
    };
    const hb = result.holes_strength_bound;
    if (hb && typeof hb === 'object') {
        const ids = Object.keys(hb.checks && typeof hb.checks === 'object' ? hb.checks : {}).filter((k) => k !== 'member.flexure.positive_region');
        const fails = dc.filter((c) => failsWithoutHoles(c) && ids.includes(c.id) && num(c.ratio) !== null).sort((a, b) => b.ratio - a.ratio);
        if (fails.length) { add(fails[0].id, hb.ratio, 'holes_strength_bound'); }
        else { const r = num(hb.ratio); if (r !== null && r > 1) { out.push({ ratio: r, id: null, basis: 'holes', source: 'holes_strength_bound' }); } }
        if (num(hb.ratio_positive) !== null) { add('member.flexure.positive_region', hb.ratio_positive, 'holes_strength_bound'); }
    }
    const sb = result.shear && typeof result.shear === 'object' ? result.shear.bound_without_holes : null;
    if (sb && typeof sb === 'object') {
        if (sb.fails === true) { add('member.shear', sb.ratio, 'shear.bound_without_holes'); }
        if (sb.h2_fails === true) { add('member.bending_shear', sb.h2_total, 'shear.bound_without_holes'); }
    }
    const wb = result.web_crippling && typeof result.web_crippling === 'object' ? result.web_crippling.bound_without_holes : null;
    if (wb && typeof wb === 'object') {
        if (wb.fails === true) { add('member.web_crippling', wb.ratio, 'web_crippling.bound_without_holes'); }
        if (wb.h3_fails === true) { add('member.bending_web_crippling', wb.h3_ratio, 'web_crippling.bound_without_holes'); }
    }
    const ih = result.interaction_holes_bound;
    if (ih && typeof ih === 'object') { add('member.axial_bending', num(ih.total_unrounded) ?? ih.total, 'interaction_holes_bound'); }
    return out;
}

/**
 * 판정비가 하한의 비인 NG 결과(webview/js/utils.js lengthBoundFailure 와 같은 규칙) — 아니면 null.
 * ① 빈 길이: 길이와 상관없는 하한(length_independent_bound · 조합의 interaction_length_bound)
 * ② 2026-11-26: 구멍 조항을 평가하지 못했지만 구멍 없는 강도의 상한으로도 넘음(holes_strength_bound · shear / web_crippling 의
 *    bound_without_holes · interaction_holes_bound — 그 검토는 trusted false · member.reason.fails_without_holes 의 fail)
 * 둘 이상이면 비가 가장 큰 것.
 */
export function lengthBoundFailure(result: any): BoundFailure | null {
    if (!result || typeof result !== 'object' || result.pass !== false || result.utilization_valid !== false) { return null; }
    let best: BoundFailure | null = null;
    const b = result.length_independent_bound;
    const ratio = b && typeof b === 'object' ? num(b.ratio) : null;
    if (ratio !== null) {
        const raw = b.governing_check_id ?? b.governing_check;
        best = { ratio, id: typeof raw === 'string' && ID_RE.test(raw) ? raw : null, basis: 'length', source: 'length_independent_bound' };
    } else {
        // 조합(H1.2): Pa · Max 를 그 하한으로 둔 H1.2 의 하한 비(interaction_length_bound)가 1 을 넘으면 — 항목 member.axial_bending
        const ib = result.interaction_length_bound;
        const t = ib && typeof ib === 'object' ? (num(ib.total_unrounded) ?? num(ib.total)) : null;
        if (t !== null && t > 1) {
            const has = Array.isArray(result.design_checks) && result.design_checks.some((c: any) => c && c.id === 'member.axial_bending');
            best = { ratio: t, id: has ? 'member.axial_bending' : null, basis: 'length', source: 'interaction_length_bound' };
        }
    }
    for (const c of holesBoundCandidates(result)) { if (!best || c.ratio > best.ratio) { best = c; } }
    return best;
}

/**
 * 결과의 맨 위 판정비가 판정이 아닌가 — 엔진이 빈 길이를 가정해 낸 것(length_assumed) 또는 주 소요가 빠져 평가한 것 가운데의 비일 뿐인 것
 * (utilization_valid false). 그 결과의 최대 판정비 · 지배 항목으로 쓰지 않는다(결정 R1 뒤의 엔진 E-1 · 계약 §6.4).
 */
export function noVerdictUtilization(result: any): boolean {
    return !!result && typeof result === 'object' && (result.length_assumed === true || result.utilization_valid === false);
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
