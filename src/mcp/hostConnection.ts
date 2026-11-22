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
 * vscode 비의존. MCP 번들(media/mcp-server.js)에 들어간다.
 */

import {
    PORT_FILE_ENV, STANDALONE_ENV, LEGACY_PORT_ENV,
    readPortFile, pidAlive, sameHost, type PortFileInfo,
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
export const STANDALONE_DROPPED = (code: string) => `The connection to the StCFSD program broke before it answered `
    + `(${code}); it may have been closed. The request may or may not have run there and was not re-sent. `
    + 'If StCFSD is not running, ask the user to start it; then call get_status before retrying.';
export const STANDALONE_TIMEOUT = (minutes: number) => `No reply from the StCFSD program within ${minutes} min. `
    + 'The calculation may still finish in StCFSD and change its state; call get_status before relying on the model.';

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
const hostRestartedNotice = 'The StCFSD host was restarted since your last call. This status is from the '
    + 'restarted host; the model and analysis results may differ from before. Re-check them before changing the model.';
const hostDropped = (code: string) => `The connection to the StCFSD host broke before it answered (${code}). `
    + 'The request may or may not have run and was not re-sent; call get_status before retrying.';
const hostTimeout = (minutes: number) => `No reply from the StCFSD host within ${minutes} min. The calculation may `
    + 'still finish and change its state; call get_status before relying on the model.';

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
}

export type Resolved = { ok: true; target: HostTarget } | { ok: false; error: string };

export interface HostConnection {
    readonly mode: ConnectionMode;
    /** 호출마다 부른다. `statusRead` = 이 요청이 상태 조회(get_status)인가. */
    resolve(statusRead: boolean): Resolved;
    /** 상태 조회가 그 호스트에서 성공했다 — 다른 요청을 다시 보낸다. 그 사이 또 바뀐 호스트면 풀지 않는다. */
    confirmStatus(target: HostTarget): void;
    /** port-file 방식의 오류 문구(legacy 에서는 쓰지 않는다 — server.ts 의 원래 문구) */
    refusedMessage(target: HostTarget): string;
    unauthorizedMessage(): string;
    /** 연결이 된 뒤 답을 받기 전에 끊김(ECONNRESET 등) — 실행됐는지 모른다 */
    droppedMessage(code: string): string;
    timeoutMessage(minutes: number): string;
    restartedNotice(): string;
}

export interface HostConnectionOptions {
    /** 시험용 */
    isAlive?: (pid: number) => boolean;
}

export function createHostConnection(mode: ConnectionMode, opts: HostConnectionOptions = {}): HostConnection {
    const alive = opts.isAlive ?? pidAlive;
    let pinned: PortFileInfo | undefined;
    let restartUnconfirmed = false;
    const file = mode.kind === 'port-file' ? mode.file : '';
    const standalone = mode.kind === 'port-file' && mode.standalone;
    const notRunning = (why: string) => standalone ? STANDALONE_NOT_RUNNING : hostNotRunning(file, why);

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
        if (!pinned) {
            pinned = info;
        } else if (!sameHost(pinned, info)) {
            pinned = info;
            restartUnconfirmed = true;
        }
        const target: HostTarget = { port: info.port, token: info.token, host: info };
        if (!restartUnconfirmed) { return { ok: true, target }; }
        if (statusRead) { return { ok: true, target: { ...target, restarted: true } }; }
        return { ok: false, error: standalone ? STANDALONE_RESTARTED : hostRestarted };
    };

    return {
        mode,
        resolve,
        confirmStatus(target: HostTarget): void {
            if (target.host && pinned && sameHost(target.host, pinned)) { restartUnconfirmed = false; }
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
        restartedNotice(): string {
            return standalone ? STANDALONE_RESTARTED_NOTICE : hostRestartedNotice;
        },
    };
}
