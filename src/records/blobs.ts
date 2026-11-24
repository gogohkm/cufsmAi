/**
 * 기록(R1-2) · 사본(blob) — 설계 §2.1 · §2.4.3 · §4.1(사본) · §4.5.
 *
 * `<프로젝트>/.stcfsd/blobs/<앞 2자>/<sha256>.json.gz` — 내용 주소. 이름 = 값의 정규 JSON(UTF-8)의 sha256.
 *  - 쓰기: 정규 JSON → gzip(6) → `wx`. 이미 있으면 쓰지 않는다(같은 내용). 폴더는 마디마다 · 링크를 따라가지 않는다.
 *  - 읽기: 보통 파일 · 압축 크기 한도 · **풀린 크기 64 MB**(gunzip 의 `maxOutputLength`), 풀린 바이트의 sha256 이 이름과 같아야 하고
 *    그 글이 값의 정규 JSON 이어야 한다. 아니면 「손상」 — 값을 돌려주지 않는다.
 *  - 사본은 **보기**(대안 비교 · 07 · 계산서 근거)에만 — 호스트의 결과 자리에 되돌려 넣지 않는다(§2.4.3).
 * VS Code 를 쓰지 않는다.
 */
import * as path from 'path';
import * as zlib from 'zlib';
import { canonicalJson, parseCanonicalLine, sha256Hex } from './canonical';
import { assertSingleLink, mkdirInside, readBounded, writeExclusive } from './fsx';
import { DATA_DIR } from './log';

export const BLOB_DIR = 'blobs';
export const BLOB_MAX_UNPACKED = 64 * 1024 * 1024;
export const BLOB_MAX_PACKED = 64 * 1024 * 1024;
const SHA_RE = /^[0-9a-f]{64}$/;

export function blobPath(rootReal: string, sha: string): string {
    if (!SHA_RE.test(sha)) { throw new Error('bad blob name'); }
    return path.join(rootReal, DATA_DIR, BLOB_DIR, sha.slice(0, 2), `${sha}.json.gz`);
}

export interface PutResult { sha256: string; bytes: number; stored: number; existed: boolean }

/** 값을 사본으로 — 정규 JSON 이 아니면(NaN · ∞ · 함수 …) 던진다 */
export function putBlob(rootReal: string, value: unknown): PutResult {
    const text = canonicalJson(value);
    const raw = Buffer.from(text, 'utf8');
    if (raw.length > BLOB_MAX_UNPACKED) { throw new Error(`a run copy of ${raw.length} bytes is over ${BLOB_MAX_UNPACKED} — not stored`); }
    const sha = sha256Hex(raw);
    const file = blobPath(rootReal, sha);
    mkdirInside(rootReal, path.dirname(file));
    const packed = zlib.gzipSync(raw, { level: 6 });
    try {
        writeExclusive(rootReal, file, packed);
        return { sha256: sha, bytes: raw.length, stored: packed.length, existed: false };
    } catch (e: any) {
        if (e?.code === 'EEXIST') { return { sha256: sha, bytes: raw.length, stored: packed.length, existed: true }; }
        throw e;
    }
}

export type GetResult = { ok: true; value: unknown; bytes: number } | { ok: false; error: 'missing' | 'damaged' | 'too large' | 'unreadable' };

/** 사본을 읽는다 — 이름의 해시 · 풀린 크기 · 정규 글을 대조한다 */
export function getBlob(rootReal: string, sha: string): GetResult {
    let file: string;
    try { file = blobPath(rootReal, sha); } catch { return { ok: false, error: 'unreadable' }; }
    let packed: Buffer | null;
    try {
        assertSingleLink(file);
        packed = readBounded(file, BLOB_MAX_PACKED);
    } catch { return { ok: false, error: 'unreadable' }; }
    if (!packed) { return { ok: false, error: 'missing' }; }
    let raw: Buffer;
    try { raw = zlib.gunzipSync(packed, { maxOutputLength: BLOB_MAX_UNPACKED }); } catch (e: any) {
        return { ok: false, error: e?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|buffer/i.test(String(e?.message)) ? 'too large' : 'damaged' };
    }
    if (sha256Hex(raw) !== sha) { return { ok: false, error: 'damaged' }; }
    const parsed = parseCanonicalLine(raw.toString('utf8'));
    if (!parsed.ok) { return { ok: false, error: 'damaged' }; }
    return { ok: true, value: parsed.value, bytes: raw.length };
}
