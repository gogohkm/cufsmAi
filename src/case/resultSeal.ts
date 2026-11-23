/**
 * V7-01: .csd 의 결과 봉인 — 파일의 결과를 「지금 결과」 로 되살리는 것은 셋이 모두 맞을 때만:
 *   (a) engine_id 가 돌고 있는 엔진과 같다(호출자가 본다),
 *   (b) 결과 종류마다, 파일 자신의 모델 · 검토 입력으로 **지금** 만든 엔진 요청의 지문이 저장할 때의 지문과 같고, 결과의 지문도 같다,
 *   (c) 봉인(모델 지문 · 입력 지문 · engine_id · 요청 지문 · 결과 지문)에 **이 PC 의 기록자 열쇠**(src/records/writer.ts)로 한 서명이 맞다.
 * 지문 · 서명은 기록 갈래의 함수 그대로(src/records/fp.ts · canonical.ts · writer.ts — 가져다 쓴다, 고치지 않는다).
 * 열쇠 폴더는 호출자가 준다(확장: 확장의 사용자별 저장 폴더, 독립 프로그램: 프로그램의 사용자 자료 폴더). 없으면 봉인하지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { canonicalJson } from '../records/canonical';
import { caseFp, modelFp, requestFp, resultFp } from '../records/fp';
import { KEY_FILE, KeyUnavailableError, loadOrCreateWriter, verifySig, Writer } from '../records/writer';
import { CaseState } from './caseState';
import { buildDesignRequest, buildLapRequest, buildLoadRequest, buildPurlinRequest, modelDrafts, RequestContext } from './requests';

export const SEAL_SCHEMA = 'stcfsd-results-seal/1';
const SEAL_PREFIX = SEAL_SCHEMA + '\n';

/** 봉인하는 결과 — .csd 의 칸 이름 */
export const RESULT_FIELDS = ['analysisResult', 'dsm', 'properties', 'loadAnalysis', 'designResult', 'preparedDesignDsm', 'lapResult'] as const;
export type ResultField = typeof RESULT_FIELDS[number];

export interface ResultsSeal {
    schema: string; engine_id: string; model: string; case: string;
    requests: Record<string, string>; results: Record<string, string>;
    writer: string; public_key: string; sig: string;
}

/** 저장한 모양 그대로(JSON 왕복 — Infinity → null 등) */
const asSaved = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** 결과 종류마다 「그 결과를 만들 요청」 — 파일의 모델 · 입력만으로(화면 · 다른 결과 없이) 같은 함수로 만든다 */
function requestFor(field: ResultField, model: any, st: CaseState, result: any): unknown {
    const ctx: RequestContext = { drafts: modelDrafts(model), props: null, lastDesign: null };
    const m = modelFp(model);
    const safe = (f: () => any) => { try { const b = f(); return { data: asSaved(b?.data ?? null), missing: b?.missing ?? [], error: b?.error ?? null }; } catch (e: any) { return { error: String(e?.message || e) }; } };
    switch (field) {
        case 'analysisResult': case 'dsm': case 'properties': return { field, model: m };
        case 'loadAnalysis': return { field, model: m, request: safe(() => buildLoadRequest(st, ctx)) };
        case 'designResult': {
            const purlin = !!result && typeof result === 'object' && (Array.isArray(result.regions) || result.design_positive !== undefined);
            return { field, model: m, purlin, request: safe(() => (purlin ? buildPurlinRequest(st, ctx) : buildDesignRequest(st, ctx))) };
        }
        case 'preparedDesignDsm': return { field, model: m, request: safe(() => buildDesignRequest(st, ctx)) };
        case 'lapResult': return { field, model: m, request: safe(() => buildLapRequest(st, ctx)) };
    }
    return { field, model: m };
}

export interface SealParts { engine_id: string; model: string; case: string; requests: Record<string, string>; results: Record<string, string> }

/** 파일 내용(모델 · 검토 상태 · 결과 칸)에서 봉인할 지문들 */
export function sealParts(engineId: string, model: any, st: CaseState, project: Record<string, any>): SealParts {
    const requests: Record<string, string> = {}, results: Record<string, string> = {};
    for (const f of RESULT_FIELDS) {
        const r = project[f];
        if (r === undefined || r === null) { continue; }
        requests[f] = requestFp(canonicalJson(asSaved(requestFor(f, model, st, r))));
        results[f] = resultFp(asSaved(r));
    }
    return { engine_id: engineId, model: modelFp(model), case: caseFp(st), requests, results };
}

const signedBytes = (p: SealParts, writer: string): string =>
    SEAL_PREFIX + canonicalJson({ schema: SEAL_SCHEMA, engine_id: p.engine_id, model: p.model, case: p.case, requests: p.requests, results: p.results, writer });

/** 저장: 봉인을 만든다. 열쇠 폴더가 없거나 열쇠를 쓸 수 없으면 null 과 까닭(저장은 봉인 없이 한다) */
export function makeSeal(keyDir: string | null, parts: SealParts): { seal: ResultsSeal | null; note?: string } {
    if (!keyDir) { return { seal: null, note: 'no writer key folder is configured' }; }
    let w: Writer;
    try { w = loadOrCreateWriter(keyDir); } catch (e: any) {
        return { seal: null, note: e instanceof KeyUnavailableError ? e.message : `the writer key is unavailable (${e?.message || e})` };
    }
    return { seal: { schema: SEAL_SCHEMA, ...parts, writer: w.writerId, public_key: w.publicKey, sig: w.sign(signedBytes(parts, w.writerId)) } };
}

export type SealVerdict = { ok: true } | { ok: false; cause: 'unsigned' | 'not_this_pc' | 'inputs_differ'; detail: string };

/**
 * 열기: 파일의 봉인을 이 PC 의 열쇠와 파일 자신의 내용으로 본다. 열쇠가 없으면 만들지 않는다(파일이 없으면 「이 PC 가 아님」).
 * 결과 칸마다 봉인에 그 칸의 요청 · 결과 지문이 있어야 하고, 봉인에 있는 칸이 파일에 없어도 안 된다.
 */
export function verifySeal(keyDir: string | null, raw: unknown, now: SealParts): SealVerdict {
    const s = raw as ResultsSeal;
    if (!s || typeof s !== 'object' || s.schema !== SEAL_SCHEMA || typeof s.sig !== 'string' || typeof s.writer !== 'string') {
        return { ok: false, cause: 'unsigned', detail: 'the results carry no signature of this program' };
    }
    if (!keyDir || !fs.existsSync(path.join(keyDir, KEY_FILE))) {
        return { ok: false, cause: 'not_this_pc', detail: 'this PC has no writer key — the results were signed elsewhere' };
    }
    let w: Writer;
    try { w = loadOrCreateWriter(keyDir); } catch (e: any) { return { ok: false, cause: 'not_this_pc', detail: `this PC's writer key is unavailable (${e?.message || e})` }; }
    const signed: SealParts = { engine_id: String(s.engine_id), model: String(s.model), case: String(s.case),
        requests: s.requests && typeof s.requests === 'object' ? s.requests : {}, results: s.results && typeof s.results === 'object' ? s.results : {} };
    let bytes: string;
    try { bytes = signedBytes(signed, s.writer); } catch { return { ok: false, cause: 'unsigned', detail: 'the signature block is not readable' }; }
    if (s.writer !== w.writerId || s.public_key !== w.publicKey || !verifySig(w.publicKey, bytes, s.sig)) {
        return { ok: false, cause: 'not_this_pc', detail: 'the signature is not by this PC\'s writer key' };
    }
    const diff: string[] = [];
    if (signed.engine_id !== now.engine_id) { diff.push('engine'); }
    if (signed.model !== now.model) { diff.push('model'); }
    if (signed.case !== now.case) { diff.push('case inputs'); }
    const fields = new Set([...Object.keys(signed.requests), ...Object.keys(signed.results), ...Object.keys(now.requests), ...Object.keys(now.results)]);
    for (const f of fields) {
        if (signed.requests[f] !== now.requests[f]) { diff.push(`${f} request`); }
        if (signed.results[f] !== now.results[f]) { diff.push(`${f} result`); }
    }
    return diff.length ? { ok: false, cause: 'inputs_differ', detail: diff.join(', ') } : { ok: true };
}
