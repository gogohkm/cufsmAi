/**
 * 기록(R3-1) · 원자료 — 설계 §2.4.7. `01_원자료/` 안의 파일을 id · sha256 으로 가리킨다.
 *
 *  - 등록하는 경로는 프로젝트 기준 상대경로 · `01_원자료/` 아래만(`resolveInside` — 절대 · 드라이브 · `..` · `:` · 링크 · junction 거절).
 *  - **내용은 읽어 주지 않는다** — 해시만(크기 한도 512 MB). Cowork 는 연결한 폴더를 직접 읽는다.
 *  - 등록 안 된 파일 목록은 깊이 4 · 2,000 개까지, 링크 · 숨김 이름은 건너뛴다. 하드 링크는 등록하지 않는다(V7-32).
 *  - 접기 · 다음 번호는 세는 줄(`ok`)만(V7-23 · 30).
 * VS Code 를 쓰지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { countable, type LogSpec, type RecordLine, type LineStatus } from './log';
import { cleanText, hiddenCharError, segmentError } from './names';
import { FOLDERS } from './project';
import { hashFile, resolveInside } from './fsx';

export const SOURCE_EVENTS = ['register', 'update'] as const;
export const SOURCE_KINDS = ['drawing', 'product', 'other'] as const;
export const SOURCE_MAX_BYTES = 512 * 1024 * 1024;
const ITEM_RE = /^S-[1-9][0-9]{0,3}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export class SourceInputError extends Error {}

export interface SourceBody { item: string; path?: string; sha256?: string; size?: number; title?: string; kind?: typeof SOURCE_KINDS[number] }
export interface Source {
    item: string; path: string; sha256: string; size: number; title: string; kind: typeof SOURCE_KINDS[number];
    writer: string; at: string; status_line: LineStatus;
}

export function nextSourceId(lines: RecordLine[]): string {
    let max = 0;
    for (const l of lines) { if (countable(l) && l.event === 'register' && typeof l.body.item === 'string' && ITEM_RE.test(l.body.item)) { max = Math.max(max, Number(l.body.item.slice(2))); } }
    const next = `S-${max + 1}`;
    if (!ITEM_RE.test(next)) { throw new SourceInputError('no more source ids in this project'); }
    return next;
}

/** 등록 · 갱신(다시 해시). `register {path, title?, kind?}` · `update {item, title?, kind?, rehash?}` */
export function prepareSource(rootReal: string, event: string, args: any, lines: RecordLine[]): { id: string; event: string; body: SourceBody } {
    if (!(SOURCE_EVENTS as readonly string[]).includes(event)) { throw new SourceInputError(`unknown action '${String(event).slice(0, 20)}'`); }
    const a = args && typeof args === 'object' ? args : {};
    const title = (raw: unknown) => { const r = cleanText(raw, 120, { field: 'title', optional: true }); if (!r.ok) { throw new SourceInputError(r.error); } return r.text; };
    const kind = (raw: unknown) => { if (raw === undefined) { return 'other' as const; } if (!(SOURCE_KINDS as readonly string[]).includes(raw as string)) { throw new SourceInputError('kind must be drawing | product | other'); } return raw as typeof SOURCE_KINDS[number]; };
    const folded = foldSources(lines);
    if (event === 'register') {
        let r: { abs: string; rel: string };
        try { r = resolveInside(rootReal, a.path, { under: FOLDERS.sources }); } catch (e: any) { throw new SourceInputError(e?.message || String(e)); }
        const dup = folded.find((s) => s.path.toLowerCase() === r.rel.toLowerCase());
        if (dup) { throw new SourceInputError(`${r.rel} is already registered as ${dup.item}`); }
        let h: { sha256: string; size: number };
        try { h = hashFile(r.abs, SOURCE_MAX_BYTES); } catch (e: any) { throw new SourceInputError(e?.code === 'ENOENT' ? 'no such file' : (e?.message || String(e))); }
        const id = nextSourceId(lines);
        return { id, event, body: { item: id, path: r.rel, sha256: h.sha256, size: h.size, title: title(a.title) || path.posix.basename(r.rel), kind: kind(a.kind) } };
    }
    if (typeof a.item !== 'string' || !ITEM_RE.test(a.item)) { throw new SourceInputError('item must be an id like S-1'); }
    const cur = folded.find((s) => s.item === a.item);
    if (!cur) { throw new SourceInputError(`no source ${a.item}`); }
    const body: SourceBody = { item: a.item };
    if (a.title !== undefined) { body.title = title(a.title); }
    if (a.kind !== undefined) { body.kind = kind(a.kind); }
    if (a.rehash) {
        const r = resolveInside(rootReal, cur.path, { under: FOLDERS.sources });
        const h = hashFile(r.abs, SOURCE_MAX_BYTES);
        body.sha256 = h.sha256; body.size = h.size;
    }
    if (Object.keys(body).length === 1) { throw new SourceInputError('nothing to update'); }
    return { id: a.item, event, body };
}

export function readSourceBody(event: string, b: Record<string, any>): Record<string, any> | null {
    if (typeof b.item !== 'string' || !ITEM_RE.test(b.item)) { return null; }
    const out: any = { item: b.item };
    if (b.path !== undefined) {
        if (typeof b.path !== 'string' || b.path.length > 400) { return null; }
        const segs = b.path.split('/');
        if (segs[0] !== FOLDERS.sources || segs.some((s: string) => segmentError(s) || hiddenCharError(s))) { return null; }
        out.path = b.path;
    }
    if (b.sha256 !== undefined) { if (typeof b.sha256 !== 'string' || !SHA_RE.test(b.sha256)) { return null; } out.sha256 = b.sha256; }
    if (b.size !== undefined) { if (!Number.isSafeInteger(b.size) || b.size < 0 || b.size > SOURCE_MAX_BYTES) { return null; } out.size = b.size; }
    if (b.title !== undefined) { const r = cleanText(b.title, 120, { optional: true }); if (!r.ok) { return null; } out.title = r.text; }
    if (b.kind !== undefined) { if (!(SOURCE_KINDS as readonly string[]).includes(b.kind)) { return null; } out.kind = b.kind; }
    if (event === 'register' && (out.path === undefined || out.sha256 === undefined)) { return null; }
    return out;
}

export const SOURCE_SPEC: LogSpec = { type: 'sources', major: 1, events: SOURCE_EVENTS, sanitize: readSourceBody };

export function foldSources(lines: RecordLine[]): Source[] {
    const by = new Map<string, Source>();
    for (const l of lines.filter(countable)) {
        const b = l.body as SourceBody;
        if (l.event === 'register') {
            if (by.has(b.item)) { continue; }
            by.set(b.item, { item: b.item, path: b.path!, sha256: b.sha256!, size: b.size ?? 0, title: b.title ?? '', kind: b.kind ?? 'other', writer: l.sig.w, at: l.at, status_line: l.status });
        } else {
            const s = by.get(b.item);
            if (!s) { continue; }
            if (b.title !== undefined) { s.title = b.title; }
            if (b.kind !== undefined) { s.kind = b.kind; }
            if (b.sha256 !== undefined) { s.sha256 = b.sha256; s.size = b.size ?? s.size; s.at = l.at; }
        }
    }
    return [...by.values()];
}

/** 지금 파일과 견준 상태 */
export function sourceState(rootReal: string, s: Source): 'same' | 'changed' | 'missing' | 'unreadable' {
    try {
        const r = resolveInside(rootReal, s.path, { under: FOLDERS.sources });
        if (!fs.existsSync(r.abs)) { return 'missing'; }
        return hashFile(r.abs, SOURCE_MAX_BYTES).sha256 === s.sha256 ? 'same' : 'changed';
    } catch { return 'unreadable'; }
}

/** `01_원자료/` 안의 등록 안 된 파일(상대경로) */
export function listUnregistered(rootReal: string, registered: Source[], limits = { depth: 4, entries: 2000 }): string[] {
    const known = new Set(registered.map((s) => s.path.toLowerCase()));
    const out: string[] = [];
    let seen = 0;
    const walk = (rel: string[], depth: number) => {
        if (depth > limits.depth || seen >= limits.entries) { return; }
        let ents: fs.Dirent[];
        try { ents = fs.readdirSync(path.join(rootReal, ...rel), { withFileTypes: true }); } catch { return; }
        for (const d of ents) {
            if (++seen > limits.entries) { return; }
            if (d.isSymbolicLink() || segmentError(d.name) || hiddenCharError(d.name)) { continue; }
            const next = [...rel, d.name];
            if (d.isDirectory()) { walk(next, depth + 1); }
            else if (d.isFile()) { const p = next.join('/').normalize('NFC'); if (!known.has(p.toLowerCase())) { out.push(p); } }
        }
    };
    walk([FOLDERS.sources], 1);
    return out.sort();
}
