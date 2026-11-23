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
        maxRatio: d ? num(d.utilization) : null,
        pass: d && typeof d.pass === 'boolean' ? d.pass : null,
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
    };
}
