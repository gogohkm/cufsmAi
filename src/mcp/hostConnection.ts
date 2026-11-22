/**
 * K1 · MCP 서버(stdio) 쪽 — 호스트를 어떻게 찾고, 호스트가 다시 켜졌을 때 무엇을 막는가.
 *
 * 두 방식:
 *  - legacy(지금): `STCFSD_MCP_PORT`(없으면 52790)를 시작할 때 한 번 읽는다. 토큰 없음. 이 모듈은 포트만 돌려준다 —
 *    오류 문구 · 동작은 server.ts 의 원래 코드 그대로.
 *  - port-file: `STCFSD_MCP_PORT_FILE` 이 있으면 **호출마다** 그 파일을 읽어 포트 · 토큰을 얻는다. 다른 포트를
 *    짐작하지 않는다(legacy 변수도 보지 않는다). 작업 폴더와 무관하게 그 파일의 호스트 하나에 붙는다.
 *    `STCFSD_MCP_STANDALONE=1` 이면 오류 문구가 "StCFSD 프로그램" 기준이다(사용자에게 그대로 전할 수 있게).
 *
 * 재시작 뒤 막기(StAnal D5b 의 규칙 그대로):
 *  처음 붙은 호스트(pid · instanceId · port · token)를 기억한다. 파일이 다른 호스트를 가리키면 그쪽으로 다시 묶고
 *  `restartUnconfirmed` 를 켠다. 그 뒤로는 상태 조회(`get_status` = `GET /status`)만 보내고(결과에 알림을 붙인다),
 *  그 조회가 **성공할 때까지** 다른 요청은 보내기 전에 거절한다.
 *  까닭: 새 프로세스의 모델(단면 · 해석 결과 · 입력 리비전)은 AI 의 맥락이 가리키는 그것이 아니다. 옛 맥락으로 계획한
 *  쓰기가 새 프로그램에서 검사 없이 돌면 안 된다. "재시작 뒤 첫 호출 하나만 거절" 로는 모자라다 — AI 가 동시에 보낸
 *  두 번째 쓰기(또는 첫 거절을 받기 전에 보낸 다음 호출)가 그대로 통과한다. 그래서 "상태 조회가 성공했다" 는 사건이
 *  풀어 줄 때까지 막는다. 그 조회가 날아가는 동안 동시에 온 쓰기도 막힌다(확인은 응답이 온 뒤에야 된다).
 *
 * port-file 방식에서는 STANDALONE 이 아니어도 이 막기를 한다 — 재시작한 호스트를 따라가면서 막지 않는 길은 두지 않는다.
 *
 * V5-08 · 기준을 프로세스 너머로: 이 MCP 서버가 **확인한** 호스트(`confirmed`)의 instanceId 를 포트 파일 옆에 클라이언트
 *  이름별로 남긴다(portFile.ts 의 `clientRecordFile`). 새 MCP 서버(Claude Desktop 을 다시 켬)는 첫 접촉에서 그 기록을 본다.
 *   - 기록 없음(이 클라이언트가 처음) → 지금 호스트를 그대로 받아들인다(헛 알림 없음).
 *   - 기록 = 지금 호스트 → 그대로(프로그램은 그사이 다시 켜지지 않았다).
 *   - 기록 ≠ 지금 호스트, 또는 기록을 읽을 수 없음 → 재시작으로 본다: get_status 만 통과, 그것이 성공하면 풀고 기록을 고친다.
 *  막기는 늘 get_status 로 풀린다(그 길은 막지 않는다). 기록을 쓰지 못해도 메모리의 막기는 그대로 돈다.
 *
 * V5-09 · 상대가 그 인스턴스인가: 포트 파일의 pid 가 살아 있어도 그 포트에서 듣는 것이 StCFSD 라는 보장은 없다(강제 종료 뒤
 *  pid · 포트 재사용, 남이 쓴 파일). 아직 확인하지 않은 호스트에는 먼저 `GET /hello` 하나만 보내 증명
 *  (`instanceProof` — 토큰으로 만든 HMAC, instanceId 와 nonce 에 묶임)을 받는다. 틀리면 "실행 중이 아님" 으로 답하고
 *  그 호스트에는 더 아무것도 보내지 않는다. 확인한 뒤에도 모든 응답의 증명을 본다(server.ts).
 *
 * vscode 비의존. MCP 번들(media/mcp-server.js)에 들어간다.
 */

import * as fs from 'fs';
import {
    PORT_FILE_ENV, STANDALONE_ENV, LEGACY_PORT_ENV,
    readPortFile, pidAlive, sameHost, type PortFileInfo,
    clientRecordFile, writeClientRecord, processRecordFile, listClientRecords, markStaleRecords,
} from './portFile';

/** 독립 프로그램 문구 — 사용자에게 그대로 전할 수 있게 쉬운 말로. */
export const STANDALONE_NOT_RUNNING = 'The StCFSD program is not running. Ask the user to start StCFSD, '
    + 'then try again. No request was sent.';
export const STANDALONE_REFUSED = 'Cannot connect to the StCFSD program; it may have just been closed. '
    + 'Ask the user to start StCFSD, then try again.';
export const STANDALONE_UNAUTHORIZED = 'The StCFSD program did not accept this connection (it may have just '
    + 'restarted). Try again; if it keeps failing, ask the user to close and start StCFSD again.';
export const STANDALONE_RESTARTED = 'The StCFSD program was restarted since your last call. The open section, '
    + 'model and analysis results may differ from before, so this request was not sent. Call get_status to '
    + 'check the current state, then continue.';
export const STANDALONE_RESTARTED_NOTICE = 'The StCFSD program was restarted since your last call. This status '
    + 'is from the restarted program; the section, model and analysis results may differ from before. '
    + 'Re-check them (get_full_state) before changing the model or reporting results.';
/**
 * V5b-10 · 새 MCP 서버가 첫 접촉에서 이어짐을 증명하지 못했다(같은 앱의 앞선 세션이 다른 프로그램 실행을 봤거나, 그 기록을
 * 읽을 수 없다). 「your last call」 은 이 프로세스에 없으므로 문구를 따로 둔다.
 */
export const STANDALONE_RESTARTED_EARLIER = 'The StCFSD program has been restarted since an earlier session of this AI '
    + 'app last used it (or that cannot be ruled out), so the open section, model and analysis results may differ from '
    + 'what earlier conversations saw. This request was not sent. Call get_status to check the current state, then continue.';
export const STANDALONE_RESTARTED_EARLIER_NOTICE = 'The StCFSD program has been restarted since an earlier session of '
    + 'this AI app last used it (or that cannot be ruled out). This status is from the program running now; the section, '
    + 'model and analysis results may differ from what earlier conversations saw. Re-check them (get_full_state) before '
    + 'changing the model or reporting results.';
export const STANDALONE_DROPPED = (code: string) => `The connection to the StCFSD program broke before it answered `
    + `(${code}); it may have been closed. The request may or may not have run there and was not re-sent. `
    + 'If StCFSD is not running, ask the user to start it; then call get_status before retrying.';
export const STANDALONE_TIMEOUT = (minutes: number) => `No reply from the StCFSD program within ${minutes} min. `
    + 'The calculation may still finish in StCFSD and change its state; call get_status before relying on the model.';
/** V5-09 · 연결 확인(`/hello`)에 답이 없거나 끊김 — 요청은 보내지 않았다. */
export const STANDALONE_NO_ANSWER = (code: string) => `The StCFSD program did not answer the connection check (${code}). `
    + 'No request was sent. Try again in a moment; if it keeps failing, ask the user to close and start StCFSD again.';

/** port-file 방식이지만 독립 프로그램이 아닐 때(개발 · 시험 호스트) — 어느 파일인지 밝힌다. */
const hostNotRunning = (file: string, why: string) => `The StCFSD host named by ${PORT_FILE_ENV} (${file}) is `
    + `not running (${why}). Start the StCFSD host that writes this file, then try again. No request was sent; `
    + 'no other port was tried.';
const hostRefused = (file: string, port: number) => `Cannot connect to the StCFSD host at 127.0.0.1:${port} `
    + `(from ${file}); it may have just been closed. Start it again, then retry. No other port was tried.`;
const hostUnauthorized = (file: string) => `The StCFSD host rejected the token from ${file} (it may have just `
    + 'restarted). Try again.';
const hostRestarted = 'The StCFSD host named by the port file was restarted since your last call. The model and '
    + 'analysis results may differ from before, so this request was not sent. Call get_status to check the '
    + 'current state, then continue.';
const hostRestartedEarlier = 'The StCFSD host may have been restarted since an earlier session of this MCP client '
    + 'used it, so this request was not sent. Call get_status to check the current state, then continue.';
const hostRestartedEarlierNotice = 'The StCFSD host may have been restarted since an earlier session of this MCP client '
    + 'used it. Re-check the model before changing it.';
const hostRestartedNotice = 'The StCFSD host was restarted since your last call. This status is from the '
    + 'restarted host; the model and analysis results may differ from before. Re-check them before changing the model.';
const hostDropped = (code: string) => `The connection to the StCFSD host broke before it answered (${code}). `
    + 'The request may or may not have run and was not re-sent; call get_status before retrying.';
const hostTimeout = (minutes: number) => `No reply from the StCFSD host within ${minutes} min. The calculation may `
    + 'still finish and change its state; call get_status before relying on the model.';
const hostNoAnswer = (file: string, port: number, code: string) => `The StCFSD host at 127.0.0.1:${port} (from ${file}) `
    + `did not answer the connection check (${code}). No request was sent; try again.`;

export type ConnectionMode =
    | { kind: 'legacy'; port: number }
    | { kind: 'port-file'; file: string; standalone: boolean };

/** 환경 변수 → 방식. `STCFSD_MCP_PORT_FILE` 이 있으면 port-file(그때 `STCFSD_MCP_PORT` 는 보지 않는다). */
export function connectionModeFromEnv(env: NodeJS.ProcessEnv, defaultPort: number): ConnectionMode {
    const file = env[PORT_FILE_ENV];
    if (file && file.trim()) {
        return { kind: 'port-file', file, standalone: env[STANDALONE_ENV] === '1' };
    }
    return { kind: 'legacy', port: parseInt(env[LEGACY_PORT_ENV] || String(defaultPort)) };
}

/** 이번 요청을 어디로 보낼까. */
export interface HostTarget {
    port: number;
    /** port-file 방식에서만 */
    token?: string;
    /** port-file 방식에서만 — 확인(confirmStatus)에 쓴다 */
    host?: PortFileInfo;
    /** 재시작 뒤 아직 확인 전이고 이 요청이 상태 조회다 — 결과에 알림을 붙이고, 성공하면 confirmStatus */
    restarted?: true;
    /** V5b-10 · 그 막기가 이 프로세스 안의 재시작이 아니라 앞선 세션의 기록 때문이다(알림 문구가 다르다) */
    earlier?: true;
    /** V5-09 · 이 호스트가 포트 파일의 그 인스턴스인지 아직 모른다 — 요청 전에 `/hello` 로 증명을 받는다 */
    verify?: true;
}

export type Resolved = { ok: true; target: HostTarget } | { ok: false; error: string };

export interface HostConnection {
    readonly mode: ConnectionMode;
    /** 호출마다 부른다. `statusRead` = 이 요청이 상태 조회(get_status)인가. */
    resolve(statusRead: boolean): Resolved;
    /** 상태 조회가 그 호스트에서 성공했다 — 다른 요청을 다시 보낸다. 그 사이 또 바뀐 호스트면 풀지 않는다. */
    confirmStatus(target: HostTarget): void;
    /** V5-09 · `/hello` 의 증명이 맞았다 */
    markVerified(target: HostTarget): void;
    /**
     * V5-09 · 확인하지 못했다. `impostor` = 답은 왔지만 증명이 틀림(남의 프로그램) — 그 호스트(포트 파일 내용)에는 더 보내지
     * 않는다. 아니면 연결 문제(거부 · 끊김 · 무응답) — 다음 호출에서 다시 확인한다. 어느 쪽이든 첫 접촉으로 받아들인 것은 되돌린다.
     */
    verificationFailed(target: HostTarget, impostor: boolean): void;
    /** V5-09 · 증명이 틀린 상대 — "실행 중이 아님" 문구 */
    notStcfsdMessage(target: HostTarget): string;
    /** V5-09 · `/hello` 에 답이 없음 · 끊김(요청은 보내지 않았다) */
    noAnswerMessage(target: HostTarget, code: string): string;
    /** port-file 방식의 오류 문구(legacy 에서는 쓰지 않는다 — server.ts 의 원래 문구) */
    refusedMessage(target: HostTarget): string;
    unauthorizedMessage(): string;
    /** 연결이 된 뒤 답을 받기 전에 끊김(ECONNRESET 등) — 실행됐는지 모른다 */
    droppedMessage(code: string): string;
    timeoutMessage(minutes: number): string;
    /** 재시작 알림. `target.earlier` 면 앞선 세션 기준의 문구(V5b-10) */
    restartedNotice(target?: HostTarget): string;
}

export interface HostConnectionOptions {
    /** 시험용 */
    isAlive?: (pid: number) => boolean;
    /** V5-08 · 기록 파일을 가를 MCP 클라이언트 이름(initialize 의 clientInfo.name). 없으면 'unknown' */
    clientName?: () => string;
    /** V5-08 · 포트 파일 옆의 기록을 읽고 쓴다(기본 true) */
    persist?: boolean;
    /** V5b-10 · 이 MCP 서버 프로세스(기록 파일 이름). 기본 process.pid · 프로세스 시작 시각 — 시험용 */
    processId?: number;
    processStartMs?: number;
}

export function createHostConnection(mode: ConnectionMode, opts: HostConnectionOptions = {}): HostConnection {
    const alive = opts.isAlive ?? pidAlive;
    const persist = opts.persist !== false;
    const clientName = () => { try { return opts.clientName?.() || 'unknown'; } catch { return 'unknown'; } };
    // 막기: 지금 포트 파일의 호스트가 `confirmed` 와 같을 때만 다른 요청을 보낸다(같지 않으면 get_status 만).
    let confirmed: PortFileInfo | undefined;
    // confirmed 가 첫 접촉으로 받아들인 것이고 아직 그 호스트를 확인(/hello)하지 못했다 — 확인이 틀리면 되돌린다.
    let adopted = false;
    // V5b-10 · 이 프로세스가 마지막으로 남긴 instanceId(같으면 다시 쓰지 않는다), 막기의 까닭
    let written: string | undefined;
    let gateEarlier = false;
    const processId = opts.processId ?? process.pid;
    const processStartMs = opts.processStartMs ?? Math.round(Date.now() - process.uptime() * 1000);
    // V5-09 · 증명을 받은 호스트 · 증명이 틀린 호스트
    let verified: PortFileInfo | undefined;
    let rejected: PortFileInfo | undefined;
    const file = mode.kind === 'port-file' ? mode.file : '';
    const standalone = mode.kind === 'port-file' && mode.standalone;
    const notRunning = (why: string) => standalone ? STANDALONE_NOT_RUNNING : hostNotRunning(file, why);
    const prefix = () => clientRecordFile(file, clientName());
    const ownFile = () => processRecordFile(prefix(), processId, processStartMs);

    /**
     * V5-08 · V5b-10 · 첫 접촉에서 이 호스트를 알림 없이 받아들여도 되는가. 같은 이름의 기록이 하나도 없으면(처음) 예,
     * 모든 기록(살아 있든 끝났든, 자기 것은 빼고)이 읽히고 이 instanceId 면 예, 그 밖(다름 · 읽을 수 없음 · 접힌 표시)은 아니오.
     */
    const continuous = (info: PortFileInfo): boolean => {
        if (!persist) { return true; }
        const own = ownFile();
        return listClientRecords(prefix()).filter((r) => r.file !== own).every((r) =>
            r.kind !== 'stale' && r.read.kind === 'present' && r.read.record.instanceId === info.instanceId);
    };
    /**
     * 이 호스트를 「이 프로세스가 마지막으로 확인한 프로그램」 으로 남기고(자기 파일만), 끝난 프로세스의 기록을 접는다:
     * 지금 프로그램이 아닌 것 · 읽을 수 없는 것 → `.stale` 표시를 둔 뒤 지운다(표시를 못 두면 지우지 않는다),
     * 지금 프로그램인 것 → 하나만 남긴다. 살아 있는 다른 프로세스의 기록 · 접힌 표시는 건드리지 않는다.
     */
    const remember = (host: PortFileInfo) => {
        if (!persist || written === host.instanceId) { return; }
        if (!writeClientRecord(ownFile(), clientName(), host, new Date(), { pid: processId, startMs: processStartMs })) { return; }
        written = host.instanceId;
        const own = ownFile();
        let keptCurrent = false;
        for (const r of listClientRecords(prefix())) {
            if (r.file === own || r.kind === 'stale') { continue; }
            const ended = r.kind === 'legacy' || (r.pid !== undefined && r.pid !== processId && !alive(r.pid));
            if (!ended) { continue; }
            if (r.read.kind === 'present' && r.read.record.instanceId === host.instanceId) {
                if (!keptCurrent) { keptCurrent = true; continue; }
                try { fs.unlinkSync(r.file); } catch { /* 다음 번에 */ }
            } else if (markStaleRecords(prefix())) {
                try { fs.unlinkSync(r.file); } catch { /* 폴더 등 — 그대로 둔다 */ }
            }
        }
    };

    const resolve = (statusRead: boolean): Resolved => {
        if (mode.kind === 'legacy') { return { ok: true, target: { port: mode.port } }; }
        const read = readPortFile(file);
        // 'in' 으로 가른다 — MCP 패리티 검사의 tsc 는 strict 가 아니라 ok 리터럴로는 좁혀지지 않는다.
        if ('problem' in read) {
            return { ok: false, error: notRunning(read.problem === 'absent' ? 'no port file' : `unreadable port file: ${read.detail ?? ''}`) };
        }
        const info: PortFileInfo = read.info;
        if (!alive(info.pid)) {
            // 강제 종료로 남은 파일. 지우지 않는다 — 다음 호스트가 덮어쓴다.
            return { ok: false, error: notRunning(`process ${info.pid} has exited`) };
        }
        if (rejected && sameHost(rejected, info)) {
            // V5-09 · 증명을 못 한 상대. 파일이 바뀔 때까지 아무것도 보내지 않는다.
            return { ok: false, error: notRunning(`the program at 127.0.0.1:${info.port} did not prove it is the StCFSD instance named in the port file`) };
        }
        if (!confirmed) {
            // 첫 접촉. V5-08 · V5b-10 · 이어짐을 기록으로 증명할 때만 그대로 받아들인다. 아니면 get_status 만(앞선 세션 기준 문구).
            if (continuous(info)) {
                confirmed = info;
                adopted = true;
                gateEarlier = false;
            } else {
                gateEarlier = true;
            }
        } else if (!sameHost(confirmed, info)) {
            gateEarlier = false;
        }
        const target: HostTarget = {
            port: info.port, token: info.token, host: info,
            ...(verified && sameHost(verified, info) ? {} : { verify: true as const }),
        };
        if (confirmed && sameHost(confirmed, info)) { return { ok: true, target }; }
        if (statusRead) { return { ok: true, target: { ...target, restarted: true, ...(gateEarlier ? { earlier: true as const } : {}) } }; }
        if (gateEarlier) { return { ok: false, error: standalone ? STANDALONE_RESTARTED_EARLIER : hostRestartedEarlier }; }
        return { ok: false, error: standalone ? STANDALONE_RESTARTED : hostRestarted };
    };

    return {
        mode,
        resolve,
        confirmStatus(target: HostTarget): void {
            // 그 사이 파일이 또 다른 호스트를 가리키면, 다음 resolve 가 confirmed 와 달라 다시 막는다.
            if (!target.host) { return; }
            confirmed = target.host;
            adopted = false;
            remember(target.host);
        },
        markVerified(target: HostTarget): void {
            if (!target.host) { return; }
            verified = target.host;
            if (confirmed && sameHost(confirmed, target.host)) {
                adopted = false;
                remember(target.host);
            }
        },
        verificationFailed(target: HostTarget, impostor: boolean): void {
            if (!target.host) { return; }
            if (impostor) { rejected = target.host; }
            if (verified && sameHost(verified, target.host)) { verified = undefined; }
            if (adopted && confirmed && sameHost(confirmed, target.host)) { confirmed = undefined; adopted = false; }
        },
        notStcfsdMessage(target: HostTarget): string {
            return notRunning(`the program at 127.0.0.1:${target.port} did not prove it is the StCFSD instance named in the port file`);
        },
        noAnswerMessage(target: HostTarget, code: string): string {
            return standalone ? STANDALONE_NO_ANSWER(code) : hostNoAnswer(file, target.port, code);
        },
        refusedMessage(target: HostTarget): string {
            return standalone ? STANDALONE_REFUSED : hostRefused(file, target.port);
        },
        unauthorizedMessage(): string {
            return standalone ? STANDALONE_UNAUTHORIZED : hostUnauthorized(file);
        },
        droppedMessage(code: string): string {
            return standalone ? STANDALONE_DROPPED(code) : hostDropped(code);
        },
        timeoutMessage(minutes: number): string {
            return standalone ? STANDALONE_TIMEOUT(minutes) : hostTimeout(minutes);
        },
        restartedNotice(target?: HostTarget): string {
            if (target?.earlier) { return standalone ? STANDALONE_RESTARTED_EARLIER_NOTICE : hostRestartedEarlierNotice; }
            return standalone ? STANDALONE_RESTARTED_NOTICE : hostRestartedNotice;
        },
    };
}
