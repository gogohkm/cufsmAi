/**
 * K1 · MCP 포트 파일 — 호스트(브리지)와 MCP 서버(stdio)가 함께 쓰는 계약.
 *
 * 환경 변수 `STCFSD_MCP_PORT_FILE` 이 있으면(독립 프로그램):
 *  - 호스트는 브리지가 듣기 시작한 뒤 이 파일에 `{app, version, port, token, pid, instanceId, startedAt}` 를
 *    원자적으로(같은 폴더 임시 파일 + rename) 쓰고, 끝날 때 자기 것이면 지운다.
 *  - MCP 서버는 호출마다 이 파일을 읽어 포트와 토큰을 얻는다. 다른 포트를 짐작하지 않는다.
 * 변수가 없으면 이 파일은 쓰이지 않는다 — 확장의 고정 포트(`STCFSD_MCP_PORT`) 방식 그대로.
 *
 * vscode 비의존(확장 · MCP 번들 · 독립 프로그램 호스트가 함께 쓴다).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** 포트 파일 경로. 있으면 포트 파일 방식(빈 포트 + 토큰). */
export const PORT_FILE_ENV = 'STCFSD_MCP_PORT_FILE';
/** "1" 이면 독립 프로그램: 오류 문구를 프로그램 기준으로 낸다(MCP 서버 쪽만 읽는다). */
export const STANDALONE_ENV = 'STCFSD_MCP_STANDALONE';
/** 확장의 고정 포트(지금 방식). 포트 파일 방식에서는 읽지 않는다. */
export const LEGACY_PORT_ENV = 'STCFSD_MCP_PORT';

/** MCP 서버가 요청마다 붙이는 머리 — 호스트가 AI 호출과 화면의 조회를 가른다. (소문자 = Node 의 req.headers 키) */
export const CLIENT_HEADER = 'x-stcfsd-client';
export const REQUEST_ID_HEADER = 'x-stcfsd-request-id';

export const PORT_FILE_APP = 'stcfsd';
export const PORT_FILE_VERSION = 1;
const MAX_PORT_FILE_BYTES = 16 * 1024;

export interface PortFileInfo {
    app: typeof PORT_FILE_APP;
    version: number;
    port: number;
    token: string;
    pid: number;
    /** 호스트 프로세스마다 새로 만든다. pid 를 다른 프로세스가 물려받아도 재시작을 알아본다. */
    instanceId: string;
    /** ISO 시각 */
    startedAt: string;
}

export type PortFileRead =
    | { ok: true; info: PortFileInfo }
    | { ok: false; problem: 'absent' | 'invalid'; detail?: string };

export function newToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

export function newInstanceId(): string {
    return crypto.randomBytes(16).toString('hex');
}

/** 같은 호스트인가 — pid · 시작 식별자 · 포트 · 토큰이 모두 같을 때만. */
export function sameHost(a: PortFileInfo, b: PortFileInfo): boolean {
    return a.pid === b.pid && a.instanceId === b.instanceId && a.port === b.port && a.token === b.token;
}

/** pid 가 살아 있는가. EPERM = 남의 프로세스지만 살아 있음. */
export function pidAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** 다른 사용자가 만들어 둔 파일은 읽지 않는다(공용 임시 폴더를 쓰는 POSIX). Windows 는 uid 가 없어 건너뛴다. */
function ownedByThisUser(stat: fs.Stats): boolean {
    const getuid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
    if (typeof getuid !== 'function') { return true; }
    return stat.uid === getuid.call(process);
}

export function parsePortFile(text: string): PortFileInfo | undefined {
    let j: any;
    try { j = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { return undefined; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) { return undefined; }
    if (j.app !== PORT_FILE_APP || !Number.isInteger(j.version)) { return undefined; }
    if (!Number.isInteger(j.port) || j.port < 1 || j.port > 65535) { return undefined; }
    if (!Number.isSafeInteger(j.pid) || j.pid <= 0) { return undefined; }
    if (typeof j.token !== 'string' || !/^[0-9a-f]{32,256}$/.test(j.token)) { return undefined; }
    if (typeof j.instanceId !== 'string' || j.instanceId.length === 0 || j.instanceId.length > 128) { return undefined; }
    if (typeof j.startedAt !== 'string') { return undefined; }
    return {
        app: PORT_FILE_APP, version: j.version, port: j.port, token: j.token, pid: j.pid,
        instanceId: j.instanceId, startedAt: j.startedAt,
    };
}

export function readPortFile(file: string): PortFileRead {
    let stat: fs.Stats;
    try { stat = fs.statSync(file); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') { return { ok: false, problem: 'absent' }; }
        return { ok: false, problem: 'invalid', detail: (err as Error).message };
    }
    if (!stat.isFile() || stat.size > MAX_PORT_FILE_BYTES) { return { ok: false, problem: 'invalid', detail: 'not a small file' }; }
    if (!ownedByThisUser(stat)) { return { ok: false, problem: 'invalid', detail: 'owned by another user' }; }
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
        // 호스트가 rename 하는 순간 · 지운 직후
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') { return { ok: false, problem: 'absent' }; }
        return { ok: false, problem: 'invalid', detail: (err as Error).message };
    }
    const info = parsePortFile(text);
    return info ? { ok: true, info } : { ok: false, problem: 'invalid', detail: 'not a StCFSD port file' };
}

/** 동기 대기(이벤트 루프를 돌리지 않는 짧은 재시도용). */
export function sleepSync(ms: number): void {
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
    catch { const until = Date.now() + ms; while (Date.now() < until) { /* 기다린다 */ } }
}

/**
 * 같은 폴더의 임시 파일에 쓰고 rename 한다. Windows 에서 다른 프로그램(백신 · 색인 · Claude Desktop)이
 * 잠깐 쥐고 있으면 EPERM/EBUSY/EACCES 가 나므로 50 ms 씩 늘려 네 번 더 해 본다.
 */
export function atomicWriteFile(file: string, text: string, mode?: number, tmpTag = 'stcfsd-tmp'): void {
    const tmp = `${file}.${tmpTag}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
        fs.writeFileSync(tmp, text, { encoding: 'utf8', ...(mode !== undefined ? { mode } : {}) });
        for (let attempt = 0; ; attempt++) {
            try { fs.renameSync(tmp, file); return; } catch (err) {
                const code = (err as NodeJS.ErrnoException).code;
                if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) { throw err; }
                sleepSync(50 * (attempt + 1));
            }
        }
    } finally {
        try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch { /* 무시 */ }
    }
}

/** 호스트 쪽: 포트 파일을 쓴다. 폴더는 0700, 파일은 0600(POSIX 에서만 뜻이 있다). */
export function writePortFile(file: string, info: PortFileInfo): void {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    atomicWriteFile(file, JSON.stringify(info, null, 2) + '\n', 0o600);
    // rename 은 임시 파일의 mode 를 가져간다. umask 가 넓혀 놓았을 경우를 위해 한 번 더.
    try { fs.chmodSync(file, 0o600); } catch { /* Windows 등 */ }
}

/** 호스트 쪽: 파일이 아직 이 호스트의 것일 때만 지운다(뒤이어 뜬 호스트의 파일을 지우지 않는다). */
export function removePortFileIfOwned(file: string, instanceId: string): boolean {
    const r = readPortFile(file);
    if ('problem' in r || r.info.instanceId !== instanceId) { return false; }
    try { fs.unlinkSync(file); return true; } catch { return false; }
}
