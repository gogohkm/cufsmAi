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
import { CASE_UNIT_KIND, SI_INPUT_TABLES, UnitKey } from '../mcp/siUnits';

export interface Snapshot {
    model: any;
    case: { inputs?: Record<string, unknown>; spans?: any; mcpOnly?: Record<string, Record<string, unknown>>; sections?: any[] } | null;
}
export interface FieldInfo { group: string; unit: string | null }
export type FieldInfoFn = (key: string) => FieldInfo | null;

export interface ArraySummary {
    count: { from: number; to: number }; changed: number; added: number; removed: number; indices: number[]; columns?: string[];
    /** 줄의 번호(첫 칸 — 절점 · 요소 번호)가 수이면 바뀐 · 더한 · 뺀 줄의 번호(각 200 개까지) — 화면이 강조한다(R2-3) */
    ids?: { changed: number[]; added: number[]; removed: number[] };
}
export interface FieldChange {
    path: string; group: string; unit: UnitKey | null;
    from?: unknown; to?: unknown;
    summary?: ArraySummary;
    /** 이름 꼴 밖의 키(V7-24 ⑤) — 이름과 값은 싣지 않고 바뀐 수만 */
    odd?: number;
    /**
     * 절점 · 요소 요약이 템플릿 치수의 변경으로 설명되는가(제목의 「외 n」 에 세지 않는다) — 조건: 치수가 바뀌었고, 손 편집 표지가
     * 없고, 요소 두께가 바뀌었다면 모든 요소의 두께 = 치수 t. 아니면 이 칸은 따로 센다(V7-24 ②).
     */
    explainedBy?: 'sectionParams';
}
/** 비교의 규칙(하나): **허용 오차 없음** — 두 값의 정규 JSON 이 다르면 바뀐 것이다(지문 · 비교 · 제목이 같은 규칙) */
export const NO_TOLERANCE = true;
const PARAM_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;
const INPUT_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
export interface DiffResult { fields: FieldChange[]; omitted: number }

export const MAX_FIELDS = 200;
const MAX_INDICES = 200;

/** 템플릿 치수의 단위(엔진 US: in). 모르는 키는 단위 없음 */
const SECTION_PARAM_UNITS: Record<string, UnitKey> = {
    H: 'length', B: 'length', D: 'length', t: 'length', r: 'length', B1: 'length', B2: 'length', D1: 'length', D2: 'length',
    tf: 'length', tw: 'length', d: 'length', b: 'length', h: 'length',
    // V9a-08: 원형 · 사용자 단면 · 기타 템플릿의 치수(엔진 template.py 의 params 키)
    OD: 'length', Ds: 'length', Ws: 'length', R_inner: 'length', outer_side: 'length',
};
/** AI 도구만의 인자(mcpOnly)의 단위 — 그 도구의 SI 입력 표(같은 표가 MCP 의 SI 입력을 바꾼다). 모르면 단위 없음 */
function mcpArgUnit(tool: string, arg: string): UnitKey | null {
    const t: any = (SI_INPUT_TABLES as any)[tool];
    const spec = t && Object.prototype.hasOwnProperty.call(t, arg) ? t[arg] : undefined;
    return typeof spec === 'string' && spec !== 'none' ? spec as UnitKey : null;
}
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
    const idOf = (r: unknown[] | undefined) => (r && typeof r[0] === 'number' && Number.isFinite(r[0]) ? r[0] as number : null);
    if ([...A, ...B].every((r) => idOf(r) !== null)) {
        const cap = (xs: number[]) => xs.slice(0, MAX_INDICES);
        s.ids = { changed: cap(indices.map((i) => idOf(B[i - 1])!)), added: cap(B.slice(n).map((r) => idOf(r)!)), removed: cap(A.slice(n).map((r) => idOf(r)!)) };
    }
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
    let oddParams = 0;
    for (const k of [...new Set([...Object.keys(p0), ...Object.keys(p1)])].sort()) {
        if (same(p0[k], p1[k])) { continue; }
        if (!PARAM_KEY_RE.test(k)) { oddParams += 1; continue; }
        push({ path: `model.sectionParams.${k}`, group: 'section', unit: SECTION_PARAM_UNITS[k] ?? null, from: p0[k] ?? null, to: p1[k] ?? null });
    }
    if (oddParams) { push({ path: 'model.sectionParams.(other)', group: 'section', unit: null, odd: oddParams }); }
    const paramsChanged = out.some((f) => f.path.startsWith('model.sectionParams.'));
    if (!same(!!m0.sectionEdited, !!m1.sectionEdited)) {
        push({ path: 'model.sectionEdited', group: 'section', unit: null, from: !!m0.sectionEdited, to: !!m1.sectionEdited });
    }
    let elemUnexplained = false;   // 요소가 설명되지 않으면 절점도 설명되지 않는다(템플릿으로 다시 만든 단면이 아니다)
    for (const [key, cols] of [['elem', ELEM_COLS], ['node', NODE_COLS]] as const) {
        const s = arraySummary(m0[key], m1[key], cols as unknown as string[]);
        if (!s) { continue; }
        const f: FieldChange = { path: `model.${key}`, group: 'section', unit: null, summary: s };
        const tAfter = Number(p1.t);
        const thicknessOk = key !== 'elem' || !(s.columns || []).includes('t')
            || (Number.isFinite(tAfter) && rows(m1.elem).every((e) => e[3] === tAfter));
        const onlyGeometry = key !== 'elem' || (s.columns || []).every((c) => c === 't' || c === 'i' || c === 'j' || c === 'id');
        if (paramsChanged && !m1.sectionEdited && same(m0.sectionTemplate ?? null, m1.sectionTemplate ?? null) && thicknessOk && onlyGeometry && !(key === 'node' && elemUnexplained)) {
            f.explainedBy = 'sectionParams';
        }
        if (key === 'elem' && !f.explainedBy) { elemUnexplained = true; }
        push(f);
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
    let oddInputs = 0;
    for (const k of [...new Set([...Object.keys(i0), ...Object.keys(i1)])].sort()) {
        if (same(i0[k], i1[k])) { continue; }
        if (!INPUT_KEY_RE.test(k)) { oddInputs += 1; continue; }
        const info = fieldInfo(k);
        const kind = info?.unit ?? null;
        push({ path: `case.inputs.${k}`, group: info?.group ?? 'case', unit: kind ? (CASE_UNIT_KIND[kind] ?? null) : null, from: i0[k] ?? null, to: i1[k] ?? null });
    }
    if (oddInputs) { push({ path: 'case.inputs.(other)', group: 'case', unit: null, odd: oddInputs }); }
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
    // 2026-11-28 결정 S1: 경간의 단면(없는 기록 · 이 기능이 없던 상태는 모두 S1)과 단면 목록(S2 …) — 추가 · 삭제 · 치수마다
    const SEC_ID = /^S[1-9][0-9]?$/;
    const ss0: unknown[] = Array.isArray(s0.spanSections) ? s0.spanSections : sp0.map(() => 'S1');
    const ss1: unknown[] = Array.isArray(s1.spanSections) ? s1.spanSections : sp1.map(() => 'S1');
    // 없는 자리(경간 수가 바뀐 쪽)도 S1 — 단면 목록이 없는 처음 길의 기록은 이 기능 전과 같은 필드만 낸다(경간 수를 바꿔도 「경간 n 단면」 이 생기지 않는다)
    for (let i = 0; i < Math.max(ss0.length, ss1.length); i += 1) {
        const a = ss0[i] ?? 'S1', b = ss1[i] ?? 'S1';
        if (!same(a, b)) { push({ path: `case.spans.spanSections[${i}]`, group: 'member', unit: null, from: a, to: b }); }
    }
    const se0: any[] = Array.isArray(c0.sections) ? c0.sections : [], se1: any[] = Array.isArray(c1.sections) ? c1.sections : [];
    const secIds = [...new Set([...se0, ...se1].map((x) => x && x.id).filter((x) => typeof x === 'string' && SEC_ID.test(x)))];
    for (const id of secIds) {
        const a = se0.find((x) => x && x.id === id), b = se1.find((x) => x && x.id === id);
        if (!a || !b) { push({ path: `case.sections[${id}]`, group: 'member', unit: null, from: a ? id : null, to: b ? id : null }); continue; }
        for (const k of ['name', 'template'] as const) {
            if (!same(a[k] ?? null, b[k] ?? null)) { push({ path: `case.sections[${id}].${k}`, group: 'member', unit: null, from: a[k] ?? null, to: b[k] ?? null }); }
        }
        const pa = a.params || {}, pb = b.params || {};
        for (const k of [...new Set([...Object.keys(pa), ...Object.keys(pb)])]) {
            if (same(pa[k] ?? null, pb[k] ?? null) || !INPUT_KEY_RE.test(k)) { continue; }
            push({ path: `case.sections[${id}].params.${k}`, group: 'member', unit: k === 'qlip' ? null : 'length', from: pa[k] ?? null, to: pb[k] ?? null });
        }
    }
    const mo0 = c0.mcpOnly || {}, mo1 = c1.mcpOnly || {};
    let oddMcp = 0;
    for (const tool of [...new Set([...Object.keys(mo0), ...Object.keys(mo1)])].sort()) {
        const a = mo0[tool] || {}, b = mo1[tool] || {};
        for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
            if (same(a[k], b[k])) { continue; }
            if (!INPUT_KEY_RE.test(tool) || !INPUT_KEY_RE.test(k)) { oddMcp += 1; continue; }
            push({ path: `case.mcpOnly.${tool}.${k}`, group: 'mcp', unit: mcpArgUnit(tool, k), from: a[k] ?? null, to: b[k] ?? null });
        }
    }
    if (oddMcp) { push({ path: 'case.mcpOnly.(other)', group: 'mcp', unit: null, odd: oddMcp }); }
    const omitted = Math.max(0, out.length - MAX_FIELDS);
    return { fields: out.slice(0, MAX_FIELDS), omitted };
}
