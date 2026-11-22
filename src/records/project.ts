/**
 * 기록(R1-1) · 프로젝트 폴더와 선언 — 설계 §2.1 · §2.4.1 · §2.5, 결정 D1 · D2 · D13.
 *
 *  - 프로젝트 = `stcfsd-project.json` 이 있고 그 스키마가 맞는 폴더. 선언에서 읽는 것은 `projectId` · `name` · `createdAt` ·
 *    `createdBy` 뿐 — **폴더 이름 · 경로 · 역할은 읽지 않는다**(정해진 상수 `FOLDERS`).
 *  - 선언은 만들 때 `wx` 로 한 번 쓰고 다시 쓰지 않는다.
 *  - 프로젝트를 두는 뿌리는 사람이 고른다(이 모듈은 받은 뿌리 아래에만 만든다). 이름은 `checkName` 을 지나야 한다.
 *  - 만들다 실패하면 만든 것을 지운다(빈 폴더 · 선언) — 남기지 않는다.
 * VS Code 를 쓰지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { DATA_DIR } from './log';
import { assertNoLinks, readBounded, realRoot, RecordsPathError } from './fsx';
import { checkName, cleanHeaderText, nameKey } from './names';
import { base32 } from './writer';

export const DECLARATION_FILE = 'stcfsd-project.json';
export const DECLARATION_SCHEMA = 'stcfsd-project/1';
export const DECLARATION_MAX_BYTES = 16 * 1024;
export const FOLDERS = { sources: '01_원자료', cases: '02_검토대상', reports: '03_계산서', issued: '04_발행본' } as const;
export { DATA_DIR };
export const PROJECT_ID_RE = /^p[a-z2-7]{16}$/;
export const CASE_ID_RE = /^c[a-z2-7]{16}$/;

/** `p` / `c` + base32 16자(80비트) — 호스트만 만든다 */
export function newId(prefix: 'p' | 'c'): string { return prefix + base32(randomBytes(10)).slice(0, 16); }

export interface Declaration {
    schema: typeof DECLARATION_SCHEMA; projectId: string; name: string; createdAt: string; createdBy: { app: 'StCFSD'; version: string };
}
export type DeclarationRead =
    | { ok: true; decl: Declaration; readOnly: false; warnings: string[] }
    | { ok: true; decl: Declaration; readOnly: true; warnings: string[] }
    | { ok: false; error: string };

/** 폴더의 선언을 읽는다(그 폴더가 사람이 고른 뿌리 아래의 프로젝트 폴더) */
export function readDeclaration(projectDir: string): DeclarationRead {
    const file = path.join(projectDir, DECLARATION_FILE);
    let buf: Buffer | null;
    try { buf = readBounded(file, DECLARATION_MAX_BYTES); } catch (e: any) { return { ok: false, error: `declaration cannot be read (${e?.message || e})` }; }
    if (!buf) { return { ok: false, error: 'not a project (no declaration file)' }; }
    let raw: any;
    try { raw = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')); } catch { return { ok: false, error: 'declaration is not JSON' }; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return { ok: false, error: 'declaration is not an object' }; }
    const m = /^stcfsd-project\/([0-9]+)$/.exec(String(raw.schema));
    if (!m) { return { ok: false, error: 'declaration schema is not stcfsd-project' }; }
    if (typeof raw.projectId !== 'string' || !PROJECT_ID_RE.test(raw.projectId)) { return { ok: false, error: 'declaration has no valid projectId' }; }
    const name = cleanHeaderText(raw.name, 60);
    if (!name) { return { ok: false, error: 'declaration has no name' }; }
    const known = new Set(['schema', 'projectId', 'name', 'createdAt', 'createdBy']);
    const warnings = Object.keys(raw).filter((k) => !known.has(k)).map((k) => `unknown declaration key '${k.slice(0, 40)}' ignored`);
    const decl: Declaration = {
        schema: DECLARATION_SCHEMA, projectId: raw.projectId, name,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 40) : '',
        createdBy: { app: 'StCFSD', version: cleanHeaderText(raw.createdBy?.version, 40) ?? '' },
    };
    if (Number(m[1]) > 1) { return { ok: true, decl, readOnly: true, warnings: [...warnings, `declaration is version ${m[1]} — records are read-only in this build`] }; }
    return { ok: true, decl, readOnly: false, warnings };
}

/**
 * 사람이 고른 뿌리 아래에 프로젝트를 만든다. 이름이 이미 있으면(NFC · 대소문자 무시) 만들지 않는다.
 * 실패하면 만든 것을 지운다.
 */
export function createProject(rootDir: string, rawName: unknown, opts: { now: string; version: string }): { dir: string; decl: Declaration } {
    const n = checkName(rawName);
    if (!n.ok) { throw new RecordsPathError(n.error); }
    const root = realRoot(rootDir);
    for (const d of fs.readdirSync(root)) {
        if (nameKey(d) === n.key) { throw new RecordsPathError(`a folder named '${d}' already exists`); }
    }
    const dir = path.join(root, n.name);
    assertNoLinks(root, dir);
    const created: string[] = [];
    try {
        fs.mkdirSync(dir); created.push(dir);
        const decl: Declaration = { schema: DECLARATION_SCHEMA, projectId: newId('p'), name: n.name, createdAt: opts.now,
            createdBy: { app: 'StCFSD', version: String(opts.version).slice(0, 40) } };
        const declFile = path.join(dir, DECLARATION_FILE);
        fs.writeFileSync(declFile, JSON.stringify(decl, null, 2) + '\n', { flag: 'wx' }); created.push(declFile);
        for (const f of Object.values(FOLDERS)) { const p = path.join(dir, f); fs.mkdirSync(p); created.push(p); }
        return { dir, decl };
    } catch (e) {
        for (const p of created.reverse()) {
            try { if (fs.lstatSync(p).isDirectory()) { fs.rmdirSync(p); } else { fs.unlinkSync(p); } } catch { /* 이미 없음 */ }
        }
        throw e;
    }
}

/**
 * 파일에서 위로(최대 `depth` 단계 — `<프로젝트>/02_검토대상/x.csd`) 선언을 찾는다. 링크인 선언은 인정하지 않는다.
 * `issued: true` 면 그 파일이 발행본 폴더 안이다(발행본 — 읽기 전용 · 기록 없음으로 연다).
 */
export function findProjectFor(file: string, depth = 2): { dir: string; issued: boolean } | null {
    let dir = path.dirname(path.resolve(file));
    for (let level = 0; level <= depth; level += 1) {
        try {
            const st = fs.lstatSync(path.join(dir, DECLARATION_FILE));
            if (st.isFile() && !st.isSymbolicLink()) {
                const rel = path.relative(dir, path.resolve(file)).split(path.sep);
                return { dir, issued: rel[0] === FOLDERS.issued };
            }
        } catch { /* 없음 — 위로 */ }
        const up = path.dirname(dir);
        if (up === dir) { break; }
        dir = up;
    }
    return null;
}

/** 뿌리 아래의 프로젝트 폴더를 이름으로(NFC · 대소문자 무시). 링크 · 선언 없는 폴더는 건너뛴다 */
export function findProjectByName(rootDir: string, rawName: unknown): string | null {
    if (typeof rawName !== 'string') { return null; }
    let root: string;
    try { root = realRoot(rootDir); } catch { return null; }
    const key = nameKey(rawName);
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        if (!d.isDirectory() || nameKey(d.name) !== key) { continue; }
        const dir = path.join(root, d.name);
        if (readDeclaration(dir).ok) { return dir; }
    }
    return null;
}

/** 검토 대상 파일의 자리 — `02_검토대상/<이름>.csd` (이름 규칙을 지난 것만) */
export function caseFileFor(projectDirReal: string, rawName: unknown): { abs: string; rel: string; name: string } {
    const n = checkName(rawName);
    if (!n.ok) { throw new RecordsPathError(n.error); }
    const rel = `${FOLDERS.cases}/${n.name}.csd`;
    const abs = path.join(projectDirReal, FOLDERS.cases, `${n.name}.csd`);
    assertNoLinks(projectDirReal, abs);
    return { abs, rel, name: n.name };
}
