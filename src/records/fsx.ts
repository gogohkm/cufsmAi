/**
 * 기록(R1-1) · 프로젝트 안의 파일 다루기 — 설계 §4.1 · §4.2, 작업문서 §5(V5 · V5b · V5c 의 규칙).
 *
 *  - 파일에서 읽은 것이 쓰는 자리를 정하지 않는다: 쓰는 자리는 늘 (사람이 고른) 뿌리 + 프로그램의 상수 + 규칙을 지난 이름.
 *  - 링크 · junction 을 따라가지 않는다: 뿌리 아래 경로의 마디를 하나씩 `lstat` 으로 보고 링크면 거절한다. 뿌리 자신은
 *    사람이 고른 곳이라 그 진짜 경로(`realpath`)에서 시작한다.
 *  - 새 파일은 `wx`(있으면 실패). 바꿔 쓰는 파일은 같은 폴더의 예측할 수 없는 임시 이름(`wx`) → rename, 실패하면 임시 파일을 지운다.
 *  - 읽기는 보통 파일만 · 크기 한도까지.
 * VS Code 를 쓰지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { segmentError } from './names';

export class RecordsPathError extends Error {}

/** 사람이 고른 폴더의 진짜 경로(폴더여야 한다) */
export function realRoot(root: string): string {
    const real = fs.realpathSync.native(path.resolve(root));
    if (!fs.statSync(real).isDirectory()) { throw new RecordsPathError('the project root is not a folder'); }
    return real;
}

function isInside(child: string, root: string): boolean {
    const rel = path.relative(root, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 뿌리 아래 경로의 있는 마디가 모두 링크 · junction 이 아니고 뿌리 밖으로 나가지 않는지. 없는 마디에서 멈춘다.
 * `abs` 는 뿌리(진짜 경로) 아래의 절대 경로여야 한다.
 */
export function assertNoLinks(rootReal: string, abs: string): void {
    if (!isInside(abs, rootReal)) { throw new RecordsPathError('path leaves the project folder'); }
    const rel = path.relative(rootReal, abs);
    let cur = rootReal;
    for (const seg of rel ? rel.split(path.sep) : []) {
        cur = path.join(cur, seg);
        let st: fs.Stats;
        try { st = fs.lstatSync(cur); } catch { return; }
        if (st.isSymbolicLink()) { throw new RecordsPathError(`a link or junction is not followed: ${path.relative(rootReal, cur)}`); }
    }
    // 마지막 확인: 있는 가장 깊은 조상의 진짜 경로가 뿌리 안
    let probe = abs;
    while (!fs.existsSync(probe)) {
        const up = path.dirname(probe);
        if (up === probe) { break; }
        probe = up;
    }
    if (!isInside(fs.realpathSync.native(probe), rootReal)) { throw new RecordsPathError('path leaves the project folder'); }
}

/**
 * 프로젝트 기준 상대경로(`/` 또는 `\`) → 절대 경로. 절대 · 드라이브 · UNC · `:` · `..` · `.` · 빈 마디 · 마디 규칙 위반 ·
 * 링크 · junction · 뿌리 밖은 거절. `under` 를 주면 그 폴더(상수) 아래여야 한다.
 */
export function resolveInside(rootReal: string, relative: unknown, opts: { under?: string } = {}): { abs: string; rel: string } {
    if (typeof relative !== 'string' || !relative.trim()) { throw new RecordsPathError('a project-relative path is required'); }
    const text = relative.normalize('NFC').replace(/\\/g, '/');
    if (text.startsWith('/') || /^[A-Za-z]:/.test(text) || text.includes(':')) {
        throw new RecordsPathError('the path must be relative to the project folder (no drive, no ":" )');
    }
    const segs = text.split('/');
    for (const s of segs) {
        const err = segmentError(s);
        if (err) { throw new RecordsPathError(`path part '${s}': ${err}`); }
    }
    if (opts.under && segs[0] !== opts.under) { throw new RecordsPathError(`the path must be inside ${opts.under}/`); }
    const abs = path.join(rootReal, ...segs);
    assertNoLinks(rootReal, abs);
    return { abs, rel: segs.join('/') };
}

/** 프로젝트 기준 상대경로(`/`, NFC). 뿌리 밖이면 null */
export function projectRelative(rootReal: string, abs: string): string | null {
    const rel = path.relative(rootReal, path.resolve(abs));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { return null; }
    return rel.split(path.sep).join('/').normalize('NFC');
}

/** 폴더 만들기 — 마디마다(재귀 옵션 없이), 링크를 따라가지 않는다 */
export function mkdirInside(rootReal: string, abs: string): void {
    assertNoLinks(rootReal, abs);
    const rel = path.relative(rootReal, abs);
    let cur = rootReal;
    for (const seg of rel ? rel.split(path.sep) : []) {
        cur = path.join(cur, seg);
        try { fs.mkdirSync(cur); } catch (e: any) {
            if (e?.code !== 'EEXIST') { throw e; }
            const st = fs.lstatSync(cur);
            if (st.isSymbolicLink() || !st.isDirectory()) { throw new RecordsPathError(`not a plain folder: ${path.relative(rootReal, cur)}`); }
        }
    }
}

/** 새 파일 — 있으면 실패(`wx`) */
export function writeExclusive(rootReal: string, abs: string, data: string | Buffer, mode = 0o644): void {
    assertNoLinks(rootReal, abs);
    fs.writeFileSync(abs, data, { flag: 'wx', mode });
}

/** 바꿔 쓰기 — 임시 이름(`wx`) → rename. 실패하면 임시 파일을 남기지 않는다. 대상이 링크면 거절 */
export function writeAtomic(dirReal: string, abs: string, data: string | Buffer, mode = 0o644): void {
    assertNoLinks(dirReal, abs);
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.tmp-${randomBytes(8).toString('hex')}`);
    try {
        fs.writeFileSync(tmp, data, { flag: 'wx', mode });
        try {
            const st = fs.lstatSync(abs);
            if (st.isSymbolicLink() || !st.isFile()) { throw new RecordsPathError('the target is not a plain file'); }
        } catch (e: any) { if (e instanceof RecordsPathError) { throw e; } }
        // Windows: 다른 프로세스가 대상을 읽는 순간에는 rename 이 EPERM · EBUSY 로 실패한다 — 잠깐 기다려 몇 번 더
        for (let attempt = 0; ; attempt += 1) {
            try { fs.renameSync(tmp, abs); break; } catch (e: any) {
                if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) { throw e; }
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
            }
        }
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* 없음 */ }
        throw e;
    }
}

/** 보통 파일만 · 한도까지 읽는다. 없으면 null. 링크 · 폴더 · 너무 큰 파일은 던진다 */
export function readBounded(abs: string, maxBytes: number): Buffer | null {
    let st: fs.Stats;
    try { st = fs.lstatSync(abs); } catch (e: any) { if (e?.code === 'ENOENT') { return null; } throw e; }
    if (st.isSymbolicLink()) { throw new RecordsPathError(`a link is not read: ${path.basename(abs)}`); }
    if (!st.isFile()) { throw new RecordsPathError(`not a plain file: ${path.basename(abs)}`); }
    if (st.size > maxBytes) { throw new RecordsPathError(`file is larger than ${maxBytes} bytes: ${path.basename(abs)}`); }
    const buf = fs.readFileSync(abs);
    if (buf.length > maxBytes) { throw new RecordsPathError(`file grew past ${maxBytes} bytes: ${path.basename(abs)}`); }
    return buf;
}

/** 파일의 sha256(한도까지, 보통 파일만) — 원자료 등록 */
export function hashFile(abs: string, maxBytes: number): { sha256: string; size: number } {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink() || !st.isFile()) { throw new RecordsPathError('not a plain file'); }
    if (st.size > maxBytes) { throw new RecordsPathError(`file is larger than ${maxBytes} bytes`); }
    const { createHash } = require('crypto') as typeof import('crypto');
    const h = createHash('sha256');
    const fd = fs.openSync(abs, 'r');
    try {
        const buf = Buffer.alloc(1 << 20);
        let total = 0;
        for (;;) {
            const n = fs.readSync(fd, buf, 0, buf.length, null);
            if (n <= 0) { break; }
            total += n;
            if (total > maxBytes) { throw new RecordsPathError(`file grew past ${maxBytes} bytes`); }
            h.update(buf.subarray(0, n));
        }
        return { sha256: h.digest('hex'), size: total };
    } finally { fs.closeSync(fd); }
}
