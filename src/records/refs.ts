/**
 * 기록(R3-1) · 기록이 가리키는 대상(`refs` · `scope`) — 설계 §2.4.5 · §2.4.6 · 스키마 `#/$defs/ref`.
 * 알려진 키만 남기고 크기를 묶는다. 맞지 않으면 null. 파일을 읽거나 쓰지 않는다.
 */
import { canonicalJson } from './canonical';
import { ID_RE } from './names';
import { CASE_ID_RE } from './project';

export const REF_KINDS = ['check', 'field', 'result', 'change', 'assumption', 'source', 'case', 'work', 'alternative', 'document'] as const;
export const RESULT_KINDS = ['buckling_analysis', 'signature_ss', 'design_dsm', 'load_analysis', 'member_design', 'connection', 'lap',
    'plastic_surface', 'vibration', 'validation'] as const;
export const CHECK_SCOPES = ['member', 'purlin', 'connection', 'lap'] as const;
const PATH_RE = /^(model|case)\.[A-Za-z0-9_.[\]-]{1,190}$/;
const CHECK_ID_RE = /^[A-Za-z0-9_.]{1,200}$/;

export interface Ref {
    kind: typeof REF_KINDS[number];
    caseId?: string; path?: string; result?: typeof RESULT_KINDS[number]; id?: string;
    check?: { scope: typeof CHECK_SCOPES[number]; id: string; location?: unknown; combination?: string | null };
}

export function sanitizeRef(raw: unknown): Ref | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
    const r = raw as any;
    if (!(REF_KINDS as readonly string[]).includes(r.kind)) { return null; }
    const out: Ref = { kind: r.kind };
    if (r.caseId !== undefined) { if (typeof r.caseId !== 'string' || !CASE_ID_RE.test(r.caseId)) { return null; } out.caseId = r.caseId; }
    if (r.path !== undefined) { if (typeof r.path !== 'string' || !PATH_RE.test(r.path)) { return null; } out.path = r.path; }
    if (r.result !== undefined) { if (!(RESULT_KINDS as readonly string[]).includes(r.result)) { return null; } out.result = r.result; }
    if (r.id !== undefined) { if (typeof r.id !== 'string' || !ID_RE.test(r.id)) { return null; } out.id = r.id; }
    if (r.check !== undefined) {
        const c = r.check;
        if (!c || typeof c !== 'object' || !(CHECK_SCOPES as readonly string[]).includes(c.scope) || typeof c.id !== 'string' || !CHECK_ID_RE.test(c.id)) { return null; }
        const check: Ref['check'] = { scope: c.scope, id: c.id };
        if (c.location !== undefined) {
            let text: string;
            try { text = canonicalJson(c.location); } catch { return null; }
            if (text.length > 2000) { return null; }
            check.location = JSON.parse(text);
        }
        if (c.combination !== undefined) {
            if (c.combination !== null && (typeof c.combination !== 'string' || c.combination.length > 200)) { return null; }
            check.combination = c.combination;
        }
        out.check = check;
    }
    if (out.kind === 'field' && !out.path) { return null; }
    if (out.kind === 'check' && !out.check) { return null; }
    if (out.kind === 'result' && !out.result) { return null; }
    if (['change', 'assumption', 'source', 'work', 'alternative', 'document'].includes(out.kind) && !out.id) { return null; }
    return out;
}

/** 대상 목록 — 하나라도 틀리면 null, 개수 한도 */
export function sanitizeRefs(raw: unknown, max: number): Ref[] | null {
    if (raw === undefined) { return []; }
    if (!Array.isArray(raw) || raw.length > max) { return null; }
    const out: Ref[] = [];
    for (const r of raw) { const s = sanitizeRef(r); if (!s) { return null; } out.push(s); }
    return out;
}
