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
/**
 * V5-09 · 호스트가 포트 파일의 그 인스턴스임을 밝히는 머리. MCP 서버는 포트 파일 방식의 모든 요청에 무작위 nonce 를
 * 붙이고, 호스트는 토큰을 통과한 응답에 `instanceProof(token, instanceId, nonce)` 를 붙인다. 맞지 않으면 MCP 서버는
 * 그 상대를 StCFSD 로 보지 않는다(포트를 물려받은 남의 프로그램, 강제 종료 뒤 남은 파일).
 */
export const NONCE_HEADER = 'x-stcfsd-nonce';
export const PROOF_HEADER = 'x-stcfsd-proof';
/** 호스트가 맞는지만 묻는 길(포트 파일 방식만). 패널에 닿지 않고 AI 호출로 세지 않는다. */
export const HELLO_ENDPOINT = '/hello';

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

export function newNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

/** nonce 꼴(hex 32–128). 아니면 증명을 만들지 않는다. */
export function validNonce(v: unknown): v is string {
    return typeof v === 'string' && /^[0-9a-f]{32,128}$/.test(v);
}

/**
 * V5-09 · 인스턴스 증명 = HMAC-SHA256(key = 토큰, "stcfsd-instance-proof\n<instanceId>\n<nonce>") 의 hex.
 * instanceId 는 선 위로 가지 않으므로, 요청의 Bearer 토큰을 받은 남의 서버도 이 값을 만들지 못한다
 * (포트 파일을 읽을 수 있는 같은 사용자의 프로그램은 막지 못한다 — K1 「잔여 위험」 과 같다).
 */
export function instanceProof(token: string, instanceId: string, nonce: string): string {
    return crypto.createHmac('sha256', token).update(`stcfsd-instance-proof\n${instanceId}\n${nonce}`, 'utf8').digest('hex');
}

/** 받은 증명이 맞는가(시간 차가 새지 않게 비교). */
export function proofMatches(header: string | string[] | undefined, token: string, instanceId: string, nonce: string): boolean {
    if (typeof header !== 'string' || !/^[0-9a-f]{64}$/.test(header)) { return false; }
    return crypto.timingSafeEqual(Buffer.from(header, 'hex'), Buffer.from(instanceProof(token, instanceId, nonce), 'hex'));
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
 * `beforeRename`(V5-06)은 rename 바로 앞에서(재시도마다) 부른다 — 던지면 쓰지 않고 임시 파일을 지운 뒤 그대로 던진다.
 */
export function atomicWriteFile(file: string, text: string, mode?: number, tmpTag = 'stcfsd-tmp',
    beforeRename?: () => void): void {
    const tmp = `${file}.${tmpTag}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
        fs.writeFileSync(tmp, text, { encoding: 'utf8', ...(mode !== undefined ? { mode } : {}) });
        for (let attempt = 0; ; attempt++) {
            beforeRename?.();
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

// ─── V5-08 · MCP 클라이언트의 「마지막으로 본 프로그램」 기록 ───────────────────────────
//
// 재시작 막기의 기준이 MCP 서버 프로세스의 메모리에만 있으면, Claude Desktop 이 다시 뜰 때(「연결」 뒤 · 다음 날 아침)
// 새 MCP 서버는 지금 떠 있는 프로그램을 그냥 받아들인다. 그래서 MCP 서버가 **확인한** 프로그램의 instanceId 를
// 포트 파일 옆에 클라이언트 이름별로 남긴다: `<포트 파일>.client-<이름>-<해시 8자>`.
//  - 클라이언트마다 파일이 따로다 — Claude Desktop 과 Claude Code 가 같은 프로그램에 붙어도 서로의 기록을 고치지 않고
//    (한 파일을 함께 고치면 읽고-고치고-쓰기 사이에 남의 기록이 지워진다) 서로의 막기를 풀지도 않는다.
//  - 토큰은 남기지 않는다(instanceId · pid · startedAt · 쓴 시각만). Claude 설정에는 아무것도 쓰지 않는다.
//  - 쓰기는 같은 폴더 임시 파일 + rename, 0600. 쓰지 못해도 막기는 메모리에서 그대로 돈다(다음 새 MCP 서버가
//    알림을 한 번 더 받을 뿐이다).

export const CLIENT_RECORD_APP = 'stcfsd-mcp-client';
const MAX_CLIENT_RECORD_BYTES = 4 * 1024;

export interface ClientRecord {
    app: typeof CLIENT_RECORD_APP;
    version: 1;
    /** initialize 의 clientInfo.name */
    client: string;
    instanceId: string;
    pid: number;
    startedAt: string;
    /** 기록한 ISO 시각 */
    at: string;
}

export type ClientRecordRead =
    | { kind: 'absent' }
    /** 있지만 읽을 수 없다(깨짐 · 남의 것 · 너무 큼) — 이어짐을 증명하지 못하므로 재시작으로 본다 */
    | { kind: 'invalid'; detail: string }
    | { kind: 'present'; record: ClientRecord };

/** 클라이언트 이름 → 기록 파일. 이름은 파일 이름에 쓸 수 있는 글자만 남기고, 원래 이름의 해시로 겹치지 않게 한다. */
export function clientRecordFile(portFile: string, clientName: string): string {
    const name = clientName || 'unknown';
    const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 32) || 'client';
    const hash = crypto.createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 8);
    return `${portFile}.client-${slug}-${hash}`;
}

export function readClientRecord(file: string): ClientRecordRead {
    let stat: fs.Stats;
    try { stat = fs.statSync(file); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') { return { kind: 'absent' }; }
        return { kind: 'invalid', detail: (err as Error).message };
    }
    if (!stat.isFile() || stat.size > MAX_CLIENT_RECORD_BYTES) { return { kind: 'invalid', detail: 'not a small file' }; }
    if (!ownedByThisUser(stat)) { return { kind: 'invalid', detail: 'owned by another user' }; }
    let j: any;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') { return { kind: 'absent' }; }
        return { kind: 'invalid', detail: 'not JSON' };
    }
    if (!j || typeof j !== 'object' || j.app !== CLIENT_RECORD_APP || typeof j.instanceId !== 'string'
        || j.instanceId.length === 0 || j.instanceId.length > 128) {
        return { kind: 'invalid', detail: 'not a StCFSD client record' };
    }
    return {
        kind: 'present',
        record: {
            app: CLIENT_RECORD_APP, version: 1, client: String(j.client ?? ''), instanceId: j.instanceId,
            pid: Number(j.pid) || 0, startedAt: String(j.startedAt ?? ''), at: String(j.at ?? ''),
        },
    };
}

/** 기록을 쓴다. 실패는 던지지 않고 false(막기는 메모리로 돈다). 폴더는 만들지 않는다(호스트가 만든 mcp 폴더). */
export function writeClientRecord(file: string, client: string, host: PortFileInfo, now = new Date()): boolean {
    const rec: ClientRecord = {
        app: CLIENT_RECORD_APP, version: 1, client: client.slice(0, 120), instanceId: host.instanceId,
        pid: host.pid, startedAt: host.startedAt, at: now.toISOString(),
    };
    try {
        atomicWriteFile(file, JSON.stringify(rec, null, 2) + '\n', 0o600);
        return true;
    } catch { return false; }
}
