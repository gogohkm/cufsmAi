/**
 * 기록(R2-1) · 스냅숏 비교 — 설계 §2.4.4. 명령 글을 풀지 않고 **모델과 검토 입력을 비교**한다(StAnal 방향 문서 5.2 와 같다).
 *
 * 스냅숏 = `{model, case: {inputs, spans, mcpOnly}}`(호스트의 `_model` 과 `CaseState` 의 그 부분). 값은 US 그대로 둔다 —
 * 단위 종류(`siUnits` 의 `UnitKey`)를 함께 적고, 사람 말 제목(changeText.ts)이 표시 단위로 바꾼다.
 *  - 템플릿으로 다시 만든 단면은 절점 · 요소가 모두 달라진다 — 그것은 요약(`summary`) 한 줄이고, 뜻은 `sectionParams` 의 칸이 말한다.
 *  - 손으로 고친 단면은 번호(배열 차례)로 비교한다(uid 없음 — 구성안 §6).
 *  - 칸은 200 개까지(넘으면 `omitted`).
 * 파일을 읽거나 쓰지 않는다. VS Code 를 쓰지 않는다.
 */
import { canonicalJson } from './canonical';
import { CASE_UNIT_KIND, UnitKey } from '../mcp/siUnits';

export interface Snapshot {
    model: any;
    case: { inputs?: Record<string, unknown>; spans?: any; mcpOnly?: Record<string, Record<string, unknown>> } | null;
}
export interface FieldInfo { group: string; unit: string | null }
export type FieldInfoFn = (key: string) => FieldInfo | null;

export interface ArraySummary {
    count: { from: number; to: number }; changed: number; added: number; removed: number; indices: number[]; columns?: string[];
}
export interface FieldChange {
    path: string; group: string; unit: UnitKey | null;
    from?: unknown; to?: unknown;
    summary?: ArraySummary;
}
export interface DiffResult { fields: FieldChange[]; omitted: number }

export const MAX_FIELDS = 200;
const MAX_INDICES = 200;

/** 템플릿 치수의 단위(엔진 US: in). 모르는 키는 단위 없음 */
const SECTION_PARAM_UNITS: Record<string, UnitKey> = {
    H: 'length', B: 'length', D: 'length', t: 'length', r: 'length', B1: 'length', B2: 'length', D1: 'length', D2: 'length',
    tf: 'length', tw: 'length', d: 'length', b: 'length', h: 'length',
};
const NODE_COLS = ['id', 'x', 'z', 'dofx', 'dofz', 'dofy', 'dofq', 'stress'];
const ELEM_COLS = ['id', 'i', 'j', 't', 'mat'];

function same(a: unknown, b: unknown): boolean {
    if (a === b) { return true; }
    try { return canonicalJson(a ?? null) === canonicalJson(b ?? null); } catch { return JSON.stringify(a) === JSON.stringify(b); }
}

function rows(v: unknown): unknown[][] { return Array.isArray(v) ? v.map((r) => (Array.isArray(r) ? r : [r])) : []; }

function arraySummary(a: unknown, b: unknown, cols?: string[]): ArraySummary | null {
    const A = rows(a), B = rows(b);
    if (same(A, B)) { return null; }
    const n = Math.min(A.length, B.length);
    const indices: number[] = [];
    const colSet = new Set<string>();
    let changed = 0;
    for (let i = 0; i < n; i += 1) {
        if (!same(A[i], B[i])) {
            changed += 1;
            if (indices.length < MAX_INDICES) { indices.push(i + 1); }
            if (cols) {
                const w = Math.max(A[i].length, B[i].length);
                for (let c = 0; c < w; c += 1) { if (!same(A[i][c], B[i][c])) { colSet.add(cols[c] ?? `c${c}`); } }
            }
        }
    }
    const s: ArraySummary = { count: { from: A.length, to: B.length }, changed, added: Math.max(0, B.length - A.length), removed: Math.max(0, A.length - B.length), indices };
    if (cols) { s.columns = [...colSet].sort(); }
    return s;
}

/** 두 스냅숏의 다른 칸. `fieldInfo` 는 검토 키의 묶음 · 단위 종류(호스트가 `caseState.fieldMeta` 를 넘긴다) */
export function diffSnapshots(before: Snapshot, after: Snapshot, fieldInfo: FieldInfoFn = () => null): DiffResult {
    const out: FieldChange[] = [];
    const push = (f: FieldChange) => { out.push(f); };
    const m0 = before.model || {}, m1 = after.model || {};

    // 단면
    if (!same(m0.sectionTemplate ?? null, m1.sectionTemplate ?? null)) {
        push({ path: 'model.sectionTemplate', group: 'section', unit: null, from: m0.sectionTemplate ?? null, to: m1.sectionTemplate ?? null });
    }
    const p0 = (m0.sectionParams && typeof m0.sectionParams === 'object') ? m0.sectionParams : {};
    const p1 = (m1.sectionParams && typeof m1.sectionParams === 'object') ? m1.sectionParams : {};
    for (const k of [...new Set([...Object.keys(p0), ...Object.keys(p1)])].sort()) {
        if (!same(p0[k], p1[k])) {
            push({ path: `model.sectionParams.${k}`, group: 'section', unit: SECTION_PARAM_UNITS[k] ?? null, from: p0[k] ?? null, to: p1[k] ?? null });
        }
    }
    if (!same(!!m0.sectionEdited, !!m1.sectionEdited)) {
        push({ path: 'model.sectionEdited', group: 'section', unit: null, from: !!m0.sectionEdited, to: !!m1.sectionEdited });
    }
    for (const [key, cols] of [['node', NODE_COLS], ['elem', ELEM_COLS]] as const) {
        const s = arraySummary(m0[key], m1[key], cols as unknown as string[]);
        if (s) { push({ path: `model.${key}`, group: 'section', unit: null, summary: s }); }
    }
    // 재료 — prop 첫 줄 [id, Ex, Ey, vx, vy, G]
    const r0 = rows(m0.prop)[0] || [], r1 = rows(m1.prop)[0] || [];
    const PROP: Array<[number, string, UnitKey | null]> = [[1, 'E', 'stress'], [2, 'Ey', 'stress'], [3, 'nu', null], [4, 'nuy', null], [5, 'G', 'stress']];
    for (const [i, name, unit] of PROP) {
        if (!same(r0[i], r1[i])) { push({ path: `model.prop.${name}`, group: 'material', unit, from: r0[i] ?? null, to: r1[i] ?? null }); }
    }
    if (rows(m0.prop).length > 1 || rows(m1.prop).length > 1) {
        const s = arraySummary(rows(m0.prop).slice(1), rows(m1.prop).slice(1));
        if (s) { push({ path: 'model.prop.rows', group: 'material', unit: null, summary: s }); }
    }
    // 해석 조건
    const scalar: Array<[string, UnitKey | null]> = [['BC', null], ['neigs', null], ['loadCase', null], ['loadFy', 'stress']];
    for (const [k, unit] of scalar) {
        if (!same(m0[k] ?? null, m1[k] ?? null)) { push({ path: `model.${k}`, group: 'analysis', unit, from: m0[k] ?? null, to: m1[k] ?? null }); }
    }
    for (const k of ['lengths', 'm_all', 'springs', 'constraints']) {
        const s = arraySummary(m0[k], m1[k]);
        if (s) { push({ path: `model.${k}`, group: 'analysis', unit: null, summary: s }); }
    }
    if (!same(m0.GBTcon ?? {}, m1.GBTcon ?? {})) { push({ path: 'model.GBTcon', group: 'analysis', unit: null, from: '(changed)', to: '(changed)' }); }

    // 검토 입력
    const c0 = before.case || {}, c1 = after.case || {};
    const i0 = c0.inputs || {}, i1 = c1.inputs || {};
    for (const k of [...new Set([...Object.keys(i0), ...Object.keys(i1)])].sort()) {
        if (same(i0[k], i1[k])) { continue; }
        const info = fieldInfo(k);
        const kind = info?.unit ?? null;
        push({ path: `case.inputs.${k}`, group: info?.group ?? 'case', unit: kind ? (CASE_UNIT_KIND[kind] ?? null) : null, from: i0[k] ?? null, to: i1[k] ?? null });
    }
    const s0 = c0.spans || {}, s1 = c1.spans || {};
    const sp0: unknown[] = Array.isArray(s0.spans) ? s0.spans : [], sp1: unknown[] = Array.isArray(s1.spans) ? s1.spans : [];
    const su0: unknown[] = Array.isArray(s0.supports) ? s0.supports : [], su1: unknown[] = Array.isArray(s1.supports) ? s1.supports : [];
    const la0: any[] = Array.isArray(s0.lapsPerSupport) ? s0.lapsPerSupport : [], la1: any[] = Array.isArray(s1.lapsPerSupport) ? s1.lapsPerSupport : [];
    for (let i = 0; i < Math.max(sp0.length, sp1.length); i += 1) {
        if (!same(sp0[i], sp1[i])) { push({ path: `case.spans.spans[${i}]`, group: 'member', unit: 'length_ft', from: sp0[i] ?? null, to: sp1[i] ?? null }); }
    }
    for (let i = 0; i < Math.max(su0.length, su1.length); i += 1) {
        if (!same(su0[i], su1[i])) { push({ path: `case.spans.supports[${i}]`, group: 'member', unit: null, from: su0[i] ?? null, to: su1[i] ?? null }); }
    }
    for (let i = 0; i < Math.max(la0.length, la1.length); i += 1) {
        for (const side of ['left', 'right'] as const) {
            const a = la0[i]?.[side] ?? null, b = la1[i]?.[side] ?? null;
            if (!same(a, b)) { push({ path: `case.spans.lapsPerSupport[${i}].${side}`, group: 'member', unit: 'length_ft', from: a, to: b }); }
        }
    }
    const mo0 = c0.mcpOnly || {}, mo1 = c1.mcpOnly || {};
    for (const tool of [...new Set([...Object.keys(mo0), ...Object.keys(mo1)])].sort()) {
        const a = mo0[tool] || {}, b = mo1[tool] || {};
        for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
            if (!same(a[k], b[k])) { push({ path: `case.mcpOnly.${tool}.${k}`, group: 'mcp', unit: null, from: a[k] ?? null, to: b[k] ?? null }); }
        }
    }
    const omitted = Math.max(0, out.length - MAX_FIELDS);
    return { fields: out.slice(0, MAX_FIELDS), omitted };
}
