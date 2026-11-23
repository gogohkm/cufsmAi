/**
 * 기록(R5-1 · R5-2) · 문서 · 발행 `log/documents` — 설계 §2.4.10 · §3.5 · §4.2 · §5.2, 결정 D3 · D4 · D14 · D15.
 *
 *  - 사건: `draft`(초안 — AI 의 generate_report · documents draft, 사람의 「초안 만들기」) · `export`(사람) · `issue`(사람만) ·
 *    `issue-failed`(프로그램 — 반쯤 만든 발행 폴더를 「실패한 발행」으로 남긴다, 차수로 세지 않는다).
 *  - 초안: `{item: 'D-n', caseId, kind, files[{path, sha256, size}], docFp, doc(ReportDoc 사본), basis {contentFp, engineId, runs, registerFp},
 *    stamp {kind: 'draft', label, notChecked}}` — 파일은 `03_계산서/` 안, 덮어쓰지 않는다.
 *  - 발행: `{item: 'R<n>', revision, caseId, folder, manifest {sha256, size}, files[{path, sha256, size, role}], check {fingerprint, warnings},
 *    issuedBy {name, writerId}, from: 'D-n'}` — 폴더 `04_발행본/<대상>/R<n>/`(배타적으로), 목록 파일 `manifest.json` 은 마지막에.
 *  - 첫 발행은 R0(D3). 다음 차수 = 발행된 것의 최대 + 1(실패한 발행은 세지 않는다 — 그 폴더는 다음 시도 전에 옆으로 옮긴다).
 *  - 볼 때마다 파일의 해시를 목록과 견준다(`checkIssue`): 그대로 · 고쳐짐 · 없어짐 · 더해짐.
 * 접기 · 다음 번호는 세는 줄(`ok`)만. 파일을 쓰지 않는다(읽기는 `checkIssue` 만).
 */
import * as fs from 'fs';
import * as path from 'path';
import { FP_RE } from './canonical';
import { hashFile } from './fsx';
import { countable, type LogSpec, type RecordLine, type LineStatus } from './log';
import { cleanHeaderText, segmentError } from './names';
import { eventsOf } from './policy';
import { CASE_ID_RE, FOLDERS } from './project';

export const DOC_EVENTS = eventsOf('documents');
export const DOC_KINDS = ['calc', 'buckling', 'validation'] as const;
export type DocKind = typeof DOC_KINDS[number];
const DRAFT_RE = /^D-[1-9][0-9]{0,4}$/;
const ISSUE_RE = /^R(0|[1-9][0-9]{0,3})$/;
const SHA_RE = /^[0-9a-f]{64}$/;
export const ISSUE_FILE_MAX = 256 * 1024 * 1024;

export interface DocFile { path: string; sha256: string; size: number; role?: string }
export interface Draft {
    item: string; caseId: string; kind: DocKind; files: DocFile[]; docFp: string; doc: string;
    basis: { contentFp: string; engineId: string | null; runs: Record<string, string>; registerFp: string };
    stamp: { kind: 'draft'; label: string; notChecked: number };
    writer: string; actor: string; at: string; status: LineStatus;
}
export interface Issue {
    item: string; revision: number; caseId: string; folder: string; manifest: { sha256: string; size: number }; files: DocFile[];
    check: { fingerprint: string; warnings: string[] }; issuedBy: { name: string; writerId: string }; from: string | null;
    writer: string; at: string; status: LineStatus;
}
export interface FailedIssue { revision: number; label: string; caseId: string; folder: string; reason: string; at: string; movedTo: string | null }

function relOk(p: unknown, top: string): p is string {
    if (typeof p !== 'string' || p.length > 400 || p !== p.normalize('NFC')) { return false; }
    const segs = p.split('/');
    return segs[0] === top && segs.length >= 2 && segs.length <= 5 && segs.every((s) => !segmentError(s));
}
function files(raw: unknown, top: string): DocFile[] | null {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) { return null; }
    const out: DocFile[] = [];
    for (const f of raw) {
        if (!f || !relOk(f.path, top) || typeof f.sha256 !== 'string' || !SHA_RE.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0) { return null; }
        out.push({ path: f.path, sha256: f.sha256, size: f.size, ...(typeof f.role === 'string' && /^[a-z][a-z-]{0,29}$/.test(f.role) ? { role: f.role } : {}) });
    }
    return out;
}

export function readDocBody(event: string, b: Record<string, any>): Record<string, any> | null {
    if (!b || typeof b.caseId !== 'string' || !CASE_ID_RE.test(b.caseId)) { return null; }
    if (event === 'draft') {
        if (typeof b.item !== 'string' || !DRAFT_RE.test(b.item) || !(DOC_KINDS as readonly string[]).includes(b.kind)) { return null; }
        const fl = files(b.files, FOLDERS.reports);
        if (!fl || typeof b.docFp !== 'string' || !FP_RE.test(b.docFp) || typeof b.doc !== 'string' || !SHA_RE.test(b.doc)) { return null; }
        const ba = b.basis;
        if (!ba || typeof ba.contentFp !== 'string' || !FP_RE.test(ba.contentFp) || typeof ba.registerFp !== 'string' || !FP_RE.test(ba.registerFp)) { return null; }
        const runs: Record<string, string> = {};
        for (const [k, v] of Object.entries(ba.runs && typeof ba.runs === 'object' ? ba.runs : {})) { if (/^[a-z_]{1,30}$/.test(k) && typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(v)) { runs[k] = v; } }
        const engineId = ba.engineId === null || ba.engineId === undefined ? null : typeof ba.engineId === 'string' && FP_RE.test(ba.engineId) ? ba.engineId : undefined;
        if (engineId === undefined) { return null; }
        const st = b.stamp && typeof b.stamp === 'object' ? b.stamp : {};
        return { item: b.item, caseId: b.caseId, kind: b.kind, files: fl, docFp: b.docFp, doc: b.doc, basis: { contentFp: ba.contentFp, engineId, runs, registerFp: ba.registerFp },
            stamp: { kind: 'draft', label: cleanHeaderText(st.label, 20) ?? b.item, notChecked: Number.isSafeInteger(st.notChecked) && st.notChecked >= 0 ? st.notChecked : 0 } };
    }
    if (event === 'issue') {
        if (typeof b.item !== 'string' || !ISSUE_RE.test(b.item) || !Number.isSafeInteger(b.revision) || `R${b.revision}` !== b.item) { return null; }
        const fl = files(b.files, FOLDERS.issued);
        if (!fl || !relOk(b.folder, FOLDERS.issued) || !b.manifest || typeof b.manifest.sha256 !== 'string' || !SHA_RE.test(b.manifest.sha256) || !Number.isSafeInteger(b.manifest.size)) { return null; }
        if (!b.check || typeof b.check.fingerprint !== 'string' || !FP_RE.test(b.check.fingerprint)) { return null; }
        if (!b.issuedBy || typeof b.issuedBy.writerId !== 'string' || !/^w[a-z2-7]{20}$/.test(b.issuedBy.writerId)) { return null; }
        return { item: b.item, revision: b.revision, caseId: b.caseId, folder: b.folder, manifest: { sha256: b.manifest.sha256, size: b.manifest.size }, files: fl,
            check: { fingerprint: b.check.fingerprint, warnings: (Array.isArray(b.check.warnings) ? b.check.warnings : []).filter((w: unknown) => typeof w === 'string' && /^[a-z-]{1,40}$/.test(w)).slice(0, 20) },
            issuedBy: { name: cleanHeaderText(b.issuedBy.name, 60) ?? '', writerId: b.issuedBy.writerId }, from: typeof b.from === 'string' && DRAFT_RE.test(b.from) ? b.from : null };
    }
    if (event === 'issue-failed') {
        if (!Number.isSafeInteger(b.revision) || b.revision < 0 || !relOk(b.folder, FOLDERS.issued)) { return null; }
        return { caseId: b.caseId, revision: b.revision, label: `R${b.revision}`, folder: b.folder, reason: cleanHeaderText(b.reason, 300) ?? '',
            ...(b.movedTo !== undefined && relOk(b.movedTo, FOLDERS.issued) ? { movedTo: b.movedTo } : {}) };
    }
    if (event === 'export') {
        const fl = files(b.files, FOLDERS.reports) ?? [];
        return { caseId: b.caseId, ...(typeof b.item === 'string' && DRAFT_RE.test(b.item) ? { item: b.item } : {}), sha256: typeof b.sha256 === 'string' && SHA_RE.test(b.sha256) ? b.sha256 : null, files: fl };
    }
    return null;
}
export const DOCUMENTS_SPEC: LogSpec = { type: 'documents', major: 1, events: DOC_EVENTS, sanitize: readDocBody };

export function nextDraftId(lines: RecordLine[]): string {
    let max = 0;
    for (const l of lines) { if (countable(l) && l.event === 'draft' && typeof l.body.item === 'string' && DRAFT_RE.test(l.body.item)) { max = Math.max(max, Number(l.body.item.slice(2))); } }
    return `D-${max + 1}`;
}

/** 줄을 접는다 — 초안 · 발행 · 실패한 발행(세는 줄만). 발행은 사람 줄만 센다 */
export function foldDocuments(lines: RecordLine[]): { drafts: Draft[]; issues: Issue[]; failed: FailedIssue[] } {
    const drafts: Draft[] = [], issues: Issue[] = [], failed: FailedIssue[] = [];
    for (const l of lines.filter(countable)) {
        const b = l.body as any;
        if (l.event === 'draft') { drafts.push({ ...b, writer: l.sig.w, actor: l.actor.kind, at: l.at, status: l.status }); }
        else if (l.event === 'issue' && l.actor.kind === 'person') {
            if (issues.some((x) => x.caseId === b.caseId && x.revision === b.revision)) { continue; }   // 같은 차수 둘 — 앞의 것
            issues.push({ ...b, writer: l.sig.w, at: l.at, status: l.status });
        } else if (l.event === 'issue-failed') { failed.push({ revision: b.revision, label: b.label, caseId: b.caseId, folder: b.folder, reason: b.reason, at: l.at, movedTo: b.movedTo ?? null }); }
    }
    return { drafts, issues, failed };
}

/** 그 대상의 다음 차수 — 발행된 것의 최대 + 1(처음은 R0, D3). 실패한 발행은 세지 않는다 */
export function nextRevision(issues: Issue[], caseId: string): number {
    const mine = issues.filter((x) => x.caseId === caseId).map((x) => x.revision);
    return mine.length ? Math.max(...mine) + 1 : 0;
}

/** 초안이 지금과 다른가 — 결과 · 입력 · 엔진 · 가정 · 업무 · 확인 가운데 무엇이 */
export function draftStaleness(d: Draft, now: { contentFp: string; engineId: string | null; runs: Record<string, string>; registerFp: string }): string[] {
    const why: string[] = [];
    if (d.basis.contentFp !== now.contentFp) { why.push('inputs or model'); }
    if ((d.basis.engineId ?? null) !== (now.engineId ?? null)) { why.push('engine'); }
    const kinds = new Set([...Object.keys(d.basis.runs), ...Object.keys(now.runs)]);
    for (const k of kinds) { if (d.basis.runs[k] !== now.runs[k]) { why.push(`results (${k})`); } }
    if (d.basis.registerFp !== now.registerFp) { why.push('assumptions, work items or reviews'); }
    return why;
}

/** 발행 폴더를 지금 파일과 견준다 — 목록 파일 · 파일마다 그대로 · 고쳐짐 · 없어짐, 폴더에 더해진 파일 */
export function checkIssue(rootReal: string, issue: Issue, cache?: Map<string, { size: number; mtimeMs: number; sha256: string }>): { state: 'same' | 'edited' | 'missing'; files: Array<{ path: string; state: 'same' | 'edited' | 'missing' }>; added: string[] } {
    const out: Array<{ path: string; state: 'same' | 'edited' | 'missing' }> = [];
    const look = (rel: string, sha: string) => {
        const abs = path.join(rootReal, ...rel.split('/'));
        try {
            const st = fs.lstatSync(abs);
            if (!st.isFile() || st.isSymbolicLink()) { return 'edited' as const; }
            const hit = cache?.get(abs);
            const got = hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs ? hit.sha256 : hashFile(abs, ISSUE_FILE_MAX).sha256;
            cache?.set(abs, { size: st.size, mtimeMs: st.mtimeMs, sha256: got });
            return got === sha ? 'same' as const : 'edited' as const;
        } catch { return 'missing' as const; }
    };
    out.push({ path: `${issue.folder}/manifest.json`, state: look(`${issue.folder}/manifest.json`, issue.manifest.sha256) });
    for (const f of issue.files) { out.push({ path: f.path, state: look(f.path, f.sha256) }); }
    const known = new Set(out.map((x) => x.path.split('/').pop()));
    let added: string[] = [];
    try { added = fs.readdirSync(path.join(rootReal, ...issue.folder.split('/'))).filter((n) => !known.has(n)).sort(); } catch { /* 폴더 없음 */ }
    const state = out.some((x) => x.state === 'missing') ? 'missing' : out.some((x) => x.state === 'edited') || added.length ? 'edited' : 'same';
    return { state, files: out, added };
}
