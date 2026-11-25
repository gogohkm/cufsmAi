/**
 * 기록(R1-2) · 색인 `index/<caseId>.json` — 설계 §2.4.11.
 *
 * 시작 화면 한 줄의 재료 + 그것을 만든 `.csd` 의 sha256. **서명하지 않는 파생 자료** — `.csd` 의 해시가 맞지 않거나 없으면
 * `.csd` 를 읽어(20 MB 까지) 다시 짓는다. 저장할 때 원자적으로 바꿔 쓴다. 글은 화면이 글자로만 그린다.
 * `summarizeCsd` 는 `.csd` 의 알려진 자리만 읽는다(값을 지어내지 않는다 — 없으면 null).
 * VS Code 를 쓰지 않는다.
 */
import * as path from 'path';
import { assertSingleLink, mkdirInside, readBounded, writeAtomic } from './fsx';
import { DATA_DIR } from './log';
import { cleanHeaderText } from './names';
import { CASE_ID_RE } from './project';

export const INDEX_DIR = 'index';
export const INDEX_SCHEMA = 'stcfsd-index/1';
export const CSD_MAX_BYTES = 20 * 1024 * 1024;
const SHA_RE = /^[0-9a-f]{64}$/;

export interface CaseIndex {
    schema: typeof INDEX_SCHEMA; caseId: string; csdSha: string;
    memberType: string | null; section: string | null; steel: string | null; nodes: number | null; elems: number | null;
    maxRatio: number | null; pass: boolean | null; savedAt: string | null;
    /** 그 저장에 든 결과의 종류(시작 화면의 「진행」) — RESULT_KINDS 의 부분 */
    results: string[];
    /** 작은 단면 그림(시작 화면의 그림) — 선 몇 줄, 각 줄은 [x0, z0, x1, z1, …] 의 0 – 1000 정수(폭 · 높이 비는 aspect = 폭/높이) */
    outline: { paths: number[][]; aspect: number } | null;
}
/** 색인에 적는 결과 종류(.csd 의 칸 → 이름) */
export const RESULT_KINDS: Array<[string, string]> = [['analysisResult', 'buckling_analysis'], ['preparedDesignDsm', 'design_dsm'],
    ['loadAnalysis', 'load_analysis'], ['designResult', 'member_design'], ['lapResult', 'lap']];
/** 그림의 한계 — 줄 8 개, 점 모두 96 개 */
export const OUTLINE_MAX_PATHS = 8;
export const OUTLINE_MAX_POINTS = 96;

/** 모델의 절점 · 요소 → 작은 그림(요소를 차례로 이어 선으로, 끊기면 새 줄, 점이 많으면 고르게 덜어 낸다) */
export function outlineOf(node: unknown, elem: unknown): { paths: number[][]; aspect: number } | null {
    if (!Array.isArray(node) || !Array.isArray(elem) || node.length < 2 || elem.length < 1 || node.length > 5000 || elem.length > 5000) { return null; }
    const xy = new Map<number, [number, number]>();
    for (const n of node) {
        if (!Array.isArray(n) || !Number.isFinite(n[0]) || !Number.isFinite(n[1]) || !Number.isFinite(n[2])) { return null; }
        xy.set(n[0], [n[1], n[2]]);
    }
    const lines: Array<Array<[number, number]>> = [];
    let cur: Array<[number, number]> = [];
    let last: number | null = null;
    for (const e of elem) {
        if (!Array.isArray(e)) { return null; }
        const a = xy.get(e[1]), b = xy.get(e[2]);
        if (!a || !b) { return null; }
        if (last !== e[1]) { if (cur.length > 1) { lines.push(cur); } cur = [a]; }
        cur.push(b);
        last = e[2];
    }
    if (cur.length > 1) { lines.push(cur); }
    if (!lines.length) { return null; }
    const pts = lines.flat();
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const span = Math.max(x1 - x0, z1 - z0) || 1;
    const total = pts.length;
    const keep = Math.min(1, OUTLINE_MAX_POINTS / total);
    const paths = lines.slice(0, OUTLINE_MAX_PATHS).map((ln) => {
        const want = Math.max(2, Math.round(ln.length * keep));
        const pick: Array<[number, number]> = [];
        for (let i = 0; i < want; i += 1) { pick.push(ln[Math.round(i * (ln.length - 1) / (want - 1))]); }
        return pick.flatMap(([x, z]) => [Math.round((x - x0) / span * 1000), Math.round((z1 - z) / span * 1000)]);
    });
    return { paths, aspect: Math.round(((x1 - x0) / ((z1 - z0) || span)) * 1000) / 1000 };
}

/** 읽은 그림을 믿지 않는다 — 수만 · 0 – 1000 정수 · 한계 안(그리기에만 쓴다) */
function readOutline(o: any): { paths: number[][]; aspect: number } | null {
    if (!o || typeof o !== 'object' || !Array.isArray(o.paths) || o.paths.length > OUTLINE_MAX_PATHS) { return null; }
    let n = 0;
    const paths: number[][] = [];
    for (const p of o.paths) {
        if (!Array.isArray(p) || p.length % 2 !== 0 || p.length < 4) { return null; }
        n += p.length / 2;
        if (n > OUTLINE_MAX_POINTS + OUTLINE_MAX_PATHS * 2) { return null; }
        if (!p.every((v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1000)) { return null; }
        paths.push(p.slice());
    }
    const aspect = Number.isFinite(o.aspect) && o.aspect > 0 && o.aspect < 1000 ? o.aspect : 1;
    return { paths, aspect };
}

export function indexPath(rootReal: string, caseId: string): string {
    if (!CASE_ID_RE.test(caseId)) { throw new Error('bad case id'); }
    return path.join(rootReal, DATA_DIR, INDEX_DIR, `${caseId}.json`);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `.csd`(1.4) 바이트 → 색인 재료. JSON 이 아니면 null */
export function summarizeCsd(bytes: Buffer): Omit<CaseIndex, 'schema' | 'caseId' | 'csdSha' | 'savedAt'> | null {
    let p: any;
    try { p = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { return null; }
    if (!p || typeof p !== 'object' || Array.isArray(p)) { return null; }
    const model = p.model && typeof p.model === 'object' ? p.model : {};
    const inputs = p.case?.inputs && typeof p.case.inputs === 'object' ? p.case.inputs : (p.designInputs && typeof p.designInputs === 'object' ? p.designInputs : {});
    const d = p.designResult && typeof p.designResult === 'object' ? p.designResult : null;
    return {
        memberType: cleanHeaderText(inputs.memberType, 40),
        section: cleanHeaderText(model.sectionTemplate ?? model.section_template ?? inputs.templateType, 40),
        steel: cleanHeaderText(inputs.presteelGrade, 40),
        nodes: Array.isArray(model.node) ? model.node.length : null,
        elems: Array.isArray(model.elem) ? model.elem.length : null,
        // 판정이 아닌 비(가정한 길이 · 빠진 주 소요)는 색인의 최대 판정비가 아니다(runs.noVerdictUtilization)
        maxRatio: d && !(d.length_assumed === true || d.utilization_valid === false) ? num(d.utilization) : null,
        pass: d && typeof d.pass === 'boolean' ? d.pass : null,
        results: RESULT_KINDS.filter(([k]) => p[k] && typeof p[k] === 'object').map(([, name]) => name),
        outline: outlineOf(model.node, model.elem),
    };
}

/** 색인을 쓴다(원자적) */
export function writeIndex(rootReal: string, caseId: string, csdSha: string, data: Omit<CaseIndex, 'schema' | 'caseId' | 'csdSha'>): CaseIndex {
    if (!SHA_RE.test(csdSha)) { throw new Error('bad csd sha'); }
    const file = indexPath(rootReal, caseId);
    mkdirInside(rootReal, path.dirname(file));
    const doc: CaseIndex = { schema: INDEX_SCHEMA, caseId, csdSha, ...data };
    writeAtomic(rootReal, file, JSON.stringify(doc, null, 1) + '\n');
    return doc;
}

/** 색인을 읽는다 — 꼴 · 대상 id · `.csd` 해시가 맞을 때만, 아니면 null(부르는 쪽이 다시 짓는다) */
export function readIndex(rootReal: string, caseId: string, csdSha: string): CaseIndex | null {
    let buf: Buffer | null;
    try { const f = indexPath(rootReal, caseId); assertSingleLink(f); buf = readBounded(f, 64 * 1024); } catch { return null; }
    if (!buf) { return null; }
    let raw: any;
    try { raw = JSON.parse(buf.toString('utf8')); } catch { return null; }
    if (!raw || raw.schema !== INDEX_SCHEMA || raw.caseId !== caseId || raw.csdSha !== csdSha) { return null; }
    return {
        schema: INDEX_SCHEMA, caseId, csdSha,
        memberType: cleanHeaderText(raw.memberType, 40), section: cleanHeaderText(raw.section, 40), steel: cleanHeaderText(raw.steel, 40),
        nodes: Number.isSafeInteger(raw.nodes) ? raw.nodes : null, elems: Number.isSafeInteger(raw.elems) ? raw.elems : null,
        maxRatio: num(raw.maxRatio), pass: typeof raw.pass === 'boolean' ? raw.pass : null,
        savedAt: typeof raw.savedAt === 'string' ? raw.savedAt.slice(0, 40) : null,
        results: Array.isArray(raw.results) ? RESULT_KINDS.map(([, n]) => n).filter((n) => raw.results.includes(n)) : [],
        outline: readOutline(raw.outline),
    };
}
