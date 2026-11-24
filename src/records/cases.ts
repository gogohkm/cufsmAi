/**
 * 기록(R1-2) · 검토 대상 줄 `log/cases` — 설계 §2.4.2 · §2.5 · §2.6(행위자 표 — `policy.ts`).
 *
 * 사건과 몸:
 *  - `create` · `import` · `discovered` `{caseId, name, file, kind, sourceName?, sourceSha?}` — 대상이 생김(`import` 는 밖의 `.csd` 사본)
 *  - `opened {caseId, fileSha, snapshot?}` · `saved {caseId, fileSha, contentFp, bytes, snapshot?}` · `external {caseId, fileSha, contentFp, snapshot?}`
 *    (snapshot = 그 바이트의 모델 · 입력 사본의 해시 — 밖에서 바뀐 것을 비교하는 기준)
 *  - `relink {caseId, file}` · `archive {caseId}` · `unarchive {caseId}` — 사람만
 * `file` 은 프로젝트 기준 상대경로(`/`, NFC) — **`02_검토대상/` 아래만**. 접기는 세는 줄(`ok`)만(V7-23).
 * 두 작성자가 같은 파일을 따로 등록하면 먼저 적힌 것(`at` 차례)이 이긴다 — 뒤의 대상 id 는 그 대상의 다른 이름으로 접힌다.
 * VS Code 를 쓰지 않는다.
 */
import { FP_RE } from './canonical';
import type { LogSpec, RecordLine } from './log';
import { countable } from './log';
import { cleanHeaderText, segmentError } from './names';
import { eventsOf } from './policy';
import { CASE_ID_RE, FOLDERS } from './project';

export const CASE_EVENTS = eventsOf('cases');
export const CASE_KINDS = ['roof-purlin', 'wall-girt', 'floor-joist', 'wall-stud', 'section-only', 'flexure', 'compression', 'combined', 'tension', 'connection'] as const;
const SHA_RE = /^[0-9a-f]{64}$/;

/** 프로젝트 기준 상대경로가 `02_검토대상/<이름>.csd`(아래 폴더 한 단계까지) 꼴인가 */
export function caseFileOk(rel: unknown): rel is string {
    if (typeof rel !== 'string' || rel.length > 400 || rel !== rel.normalize('NFC')) { return false; }
    const segs = rel.split('/');
    if (segs[0] !== FOLDERS.cases || segs.length < 2 || segs.length > 3 || !/\.csd$/i.test(segs[segs.length - 1])) { return false; }
    return segs.every((s) => !segmentError(s));
}

const STREAM_RE = /^w[a-z2-7]{20}(?:-[2-9])?$/;
const LOG_TYPES = ['cases', 'changes', 'runs', 'work', 'assumptions', 'sources', 'reviews', 'alternatives', 'documents'];
function readCaseBody(event: string, b: Record<string, any>): Record<string, any> | null {
    // V9b-04: 대상이 아니라 기록 줄 파일에 대한 사람의 줄 — 어느 종류의 어느 줄 파일 · 옮긴 파일(이름 · 해시 · 크기) · 옮긴 곳 · 본 끝
    if (event === 'quarantine' || event === 'accept-shrunk') {
        if (!b || !LOG_TYPES.includes(b.type) || typeof b.streamName !== 'string' || !STREAM_RE.test(b.streamName)) { return null; }
        const out: Record<string, any> = { type: b.type, streamName: b.streamName };
        if (event === 'quarantine') {
            if (!Array.isArray(b.files) || b.files.length > 1000 || typeof b.movedTo !== 'string' || b.movedTo.length > 300) { return null; }
            out.files = [];
            for (const f of b.files) {
                if (!f || typeof f.name !== 'string' || f.name.length > 80 || typeof f.sha256 !== 'string' || !SHA_RE.test(f.sha256) || !Number.isSafeInteger(f.size)) { return null; }
                out.files.push({ name: f.name, sha256: f.sha256, size: f.size });
            }
            out.movedTo = b.movedTo;
            out.damage = { broken: Number(b.damage?.broken) || 0, chainBreaks: Number(b.damage?.chainBreaks) || 0, shrunk: b.damage?.shrunk === true };
        } else {
            if (!Number.isSafeInteger(b.expectedSeq) || !Number.isSafeInteger(b.foundSeq)) { return null; }
            out.expectedSeq = b.expectedSeq; out.foundSeq = b.foundSeq;
        }
        return out;
    }
    if (!b || typeof b.caseId !== 'string' || !CASE_ID_RE.test(b.caseId)) { return null; }
    const out: Record<string, any> = { caseId: b.caseId };
    if (event === 'create' || event === 'import' || event === 'discovered') {
        const name = cleanHeaderText(b.name, 60);
        if (!name || !caseFileOk(b.file)) { return null; }
        out.name = name; out.file = b.file;
        out.kind = typeof b.kind === 'string' && (CASE_KINDS as readonly string[]).includes(b.kind) ? b.kind : 'section-only';
        if (event === 'import') {
            const sn = cleanHeaderText(b.sourceName, 120); if (sn) { out.sourceName = sn; }
            if (typeof b.sourceSha === 'string' && SHA_RE.test(b.sourceSha)) { out.sourceSha = b.sourceSha; }
        }
        return out;
    }
    if (event === 'opened' || event === 'saved' || event === 'external') {
        if (typeof b.fileSha !== 'string' || !SHA_RE.test(b.fileSha)) { return null; }
        out.fileSha = b.fileSha;
        if (event !== 'opened') {
            if (typeof b.contentFp === 'string' && FP_RE.test(b.contentFp)) { out.contentFp = b.contentFp; }
            if (event === 'saved' && Number.isSafeInteger(b.bytes) && b.bytes >= 0) { out.bytes = b.bytes; }
        }
        // R2-2: 그 바이트의 모델 · 입력 사본(밖에서 바뀐 것을 비교할 기준) — 저장 · 열기 · 밖에서 바뀜 모두(R2-3 고침: 저장 없이 연 대상도)
        if (typeof b.snapshot === 'string' && SHA_RE.test(b.snapshot)) { out.snapshot = b.snapshot; }
        return out;
    }
    if (event === 'relink') { if (!caseFileOk(b.file)) { return null; } out.file = b.file; return out; }
    if (event === 'archive' || event === 'unarchive') { return out; }
    return null;
}

export const CASES_SPEC: LogSpec = { type: 'cases', major: 1, events: CASE_EVENTS, sanitize: readCaseBody };

export interface CaseEntry {
    caseId: string; name: string; file: string; kind: string; archived: boolean;
    createdAt: string; createdBy: string; writer: string;
    lastOpened: { at: string; fileSha: string; snapshot?: string } | null;
    lastSaved: { at: string; fileSha: string; contentFp: string | null; bytes: number | null; writer: string; snapshot?: string } | null;
    lastExternal: { at: string; fileSha: string; snapshot?: string } | null;
    /** 같은 파일을 뒤에 등록한 다른 대상 id(접힌 것) */
    aliases: string[];
}

/** 세는 줄을 접어 지금 대상들(대상 id → 대상) */
export function foldCases(lines: RecordLine[]): Map<string, CaseEntry> {
    const byId = new Map<string, CaseEntry>();
    const byFile = new Map<string, string>();
    const alias = new Map<string, string>();
    for (const l of lines.filter(countable)) {
        const b = l.body;
        if (l.event === 'create' || l.event === 'import' || l.event === 'discovered') {
            if (byId.has(b.caseId) || alias.has(b.caseId)) { continue; }
            const fileKey = String(b.file).toLowerCase();
            const owner = byFile.get(fileKey);
            if (owner) { alias.set(b.caseId, owner); byId.get(owner)!.aliases.push(b.caseId); continue; }
            byId.set(b.caseId, { caseId: b.caseId, name: b.name, file: b.file, kind: b.kind, archived: false, createdAt: l.at,
                createdBy: l.actor.kind, writer: l.sig.w, lastOpened: null, lastSaved: null, lastExternal: null, aliases: [] });
            byFile.set(fileKey, b.caseId);
            continue;
        }
        const e = byId.get(alias.get(b.caseId) ?? b.caseId);
        if (!e) { continue; }
        if (l.event === 'opened') { e.lastOpened = { at: l.at, fileSha: b.fileSha, ...(b.snapshot ? { snapshot: b.snapshot } : {}) }; }
        else if (l.event === 'saved') { e.lastSaved = { at: l.at, fileSha: b.fileSha, contentFp: b.contentFp ?? null, bytes: b.bytes ?? null, writer: l.sig.w, ...(b.snapshot ? { snapshot: b.snapshot } : {}) }; }
        else if (l.event === 'external') { e.lastExternal = { at: l.at, fileSha: b.fileSha, ...(b.snapshot ? { snapshot: b.snapshot } : {}) }; }
        else if (l.event === 'archive') { e.archived = true; }
        else if (l.event === 'unarchive') { e.archived = false; }
        else if (l.event === 'relink') {
            byFile.delete(e.file.toLowerCase());
            e.file = b.file; byFile.set(b.file.toLowerCase(), e.caseId);
        }
    }
    return byId;
}

/** 대상의 마지막으로 알려진 파일(저장 · 열기 · 밖에서 바뀜 가운데 늦은 것) — 해시와 그 사본 */
export function lastKnown(e: CaseEntry): { fileSha: string; snapshot: string | null } | null {
    const s = e.lastSaved, o = e.lastOpened, x = e.lastExternal;
    const cands = [s, o, x].filter((v): v is { at: string; fileSha: string; snapshot?: string } => !!v).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    if (!cands.length) { return null; }
    const last = cands[cands.length - 1];
    // 같은 바이트의 사본이 늦은 줄에 없으면(옛 기록 — 열기에 사본이 없던 때) 같은 해시의 다른 줄의 사본
    const snap = last.snapshot ?? cands.filter((c) => c.fileSha === last.fileSha && c.snapshot).map((c) => c.snapshot!).pop() ?? null;
    return { fileSha: last.fileSha, snapshot: snap };
}
/** 대상의 마지막으로 알려진 파일 해시 */
export function lastKnownSha(e: CaseEntry): string | null { return lastKnown(e)?.fileSha ?? null; }
