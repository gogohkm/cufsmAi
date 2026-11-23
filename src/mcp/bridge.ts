/**
 * StCFSD MCP Bridge — HTTP 서버로 MCP Server ↔ StcfsdPanel 연결
 *
 * MCP Server (stdio) ─HTTP→ Bridge (127.0.0.1:52790…) ─직접호출→ StcfsdPanel
 *
 * R8-09 (토큰 없이 할 수 있는 만큼): 브라우저가 보낸 요청은 받지 않는다.
 * - CORS 허용 헤더를 내지 않는다(브라우저 페이지가 응답을 읽지 못함).
 * - `Origin` 머리가 붙은 요청은 403 — 브라우저는 교차 출처 요청(그리고 POST)에 언제나 Origin 을 붙인다.
 * - POST 는 `Content-Type: application/json` 만 받는다(415) — text/plain 같은 "단순 요청"으로는
 *   preflight 없이 본문을 밀어 넣을 수 없게 한다.
 * - `Host` 는 127.0.0.1 / localhost (포트 포함) 만 — DNS rebinding 을 막는다.
 * - 본문은 8 MB 까지, 깨진 JSON 은 400(전: `{}` 로 보고 실행).
 * MCP 클라이언트(media/mcp-server.js)는 Origin 없이 application/json 으로 보내므로 그대로 통과한다.
 *
 * K1 · 포트 파일 방식(`STCFSD_MCP_PORT_FILE` — 독립 프로그램). 옵션 `portFile` 을 주면:
 * - 프로세스마다 무작위 토큰을 만들고 모든 요청에 `Authorization: Bearer <토큰>` 을 요구한다(없거나 틀리면 401).
 *   위의 Origin · content-type · Host 검사는 그대로 먼저 한다.
 * - 포트는 0(빈 포트)이어도 된다. 듣기 시작한 뒤 `{app, version, port, token, pid, instanceId, startedAt}` 를
 *   그 파일에 원자적으로 쓰고(0600), 멈출 때 · 프로세스가 끝날 때 아직 자기 것이면 지운다.
 * - `GET /last-call` 이 마지막 AI 호출(언제 · 어느 클라이언트)을 돌려준다. MCP 서버는 요청마다
 *   `X-StCFSD-Request-Id` · `X-StCFSD-Client` 를 붙이고, 화면의 조회는 붙이지 않는다 — 붙은 것만 AI 호출로 센다.
 * - V5-09 · 토큰을 통과한 응답에는 요청의 `X-StCFSD-Nonce` 로 만든 `X-StCFSD-Proof`(instanceProof)를 붙이고,
 *   `GET /hello` 가 패널에 닿지 않고 그것만 돌려준다 — MCP 서버가 이 포트의 상대가 포트 파일의 그 인스턴스인지 본다.
 * - V5-S2 · 설계 패널이 아직 없으면(프로그램이 듣기 시작한 뒤 패널을 만들기 전) VS Code 문구 대신 "아직 시작 중 —
 *   잠시 뒤 get_status 를 다시" 라고 답한다(`HOST_STARTING`).
 * 옵션이 없으면 지금 그대로(토큰 없음, 파일 없음, /last-call · /hello 없음, 문구도 같음).
 */

import * as crypto from 'crypto';
import { contextFromHeaders, runAs } from './actorScope';
import * as http from 'http';
import {
    PORT_FILE_ENV, PORT_FILE_APP, PORT_FILE_VERSION, CLIENT_HEADER, REQUEST_ID_HEADER,
    NONCE_HEADER, PROOF_HEADER, HELLO_ENDPOINT, validNonce, instanceProof,
    newToken, newInstanceId, writePortFile, removePortFileIfOwned, type PortFileInfo,
} from './portFile';

/** VS Code 확장(지금 방식)의 패널 없음 문구 — 바뀌지 않는다. */
export const NO_PANEL = 'No active CUFSM panel. Open Section Designer first.';
/**
 * V5-S2 · 포트 파일 방식(독립 프로그램)에서 패널이 아직 없을 때. 독립 프로그램은 패널을 스스로 만들고 닫지 않으므로
 * 패널이 없는 때는 시작 중뿐이다. get_status 로 다시 물으면 되므로 재시작 막기도 그 길로 풀린다.
 */
export const HOST_STARTING = 'The StCFSD program is still starting (its design panel is not ready yet). '
    + 'Nothing was changed. Wait a few seconds, then call get_status again.';

/** StcfsdPanel이 구현해야 하는 인터페이스 */
export interface McpPanelInterface {
    handleMcpAction(options: any): Promise<any>;
    getStatus(): any;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;

class BridgeHttpError extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
}

/** K1 · 포트 파일 방식의 옵션. 없으면 지금 방식. */
export interface McpBridgeOptions {
    /** 포트 파일 경로. 주면 토큰을 요구하고 듣기 시작한 뒤 이 파일을 쓴다. */
    portFile: string;
    /** 시험용 — 주지 않으면 프로세스마다 무작위(32 바이트 hex) */
    token?: string;
    /** AI 호출(요청 id 머리가 붙은 요청)이 들어올 때마다 */
    onAiCall?: (call: McpAiCall) => void;
}

/** 마지막 AI 호출 — 화면의 「마지막 호출」 표시용. 모델 내용은 담지 않는다. */
export interface McpAiCall {
    /** ISO 시각 */
    at: string;
    /** MCP 서버가 보낸 클라이언트 이름(`<initialize clientInfo.name>/<version>`), 없으면 'unknown' */
    client: string;
    method: string;
    endpoint: string;
    /** POST /action 의 action 이름 */
    action?: string;
}

/** `STCFSD_MCP_PORT_FILE` 이 있으면 포트 파일 방식의 옵션, 없으면 undefined(= 지금 방식). */
export function bridgeOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): McpBridgeOptions | undefined {
    const file = env[PORT_FILE_ENV];
    return file && file.trim() ? { portFile: file } : undefined;
}

function digest(s: string): Buffer {
    return crypto.createHash('sha256').update(s, 'utf8').digest();
}

/** `Authorization: Bearer <token>` 인가. 길이에 따라 시간이 달라지지 않게 해시를 비교한다. */
export function bearerMatches(header: string | string[] | undefined, token: string): boolean {
    if (typeof header !== 'string') { return false; }
    return crypto.timingSafeEqual(digest(header.trim()), digest(`Bearer ${token}`));
}

/** 머리 값 하나를 기록용으로 줄인다(인쇄 가능한 ASCII, 120 자). */
function headerText(v: string | string[] | undefined): string | undefined {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s !== 'string' || !s) { return undefined; }
    return s.replace(/[^\x20-\x7e]/g, '?').slice(0, 120);
}

/**
 * 요청 머리를 검사한다. 통과하면 null, 아니면 [status, message]. (시험에서 직접 부른다)
 * `token` 을 주면(포트 파일 방식) 앞의 검사를 다 지난 뒤 Bearer 토큰도 본다 — 없거나 틀리면 401.
 */
export function checkBridgeRequest(
    method: string | undefined, headers: http.IncomingHttpHeaders, port: number, token?: string
): [number, string] | null {
    if (headers.origin !== undefined) {
        return [403, 'Requests with an Origin header (browser requests) are not accepted by the StCFSD bridge.'];
    }
    const host = String(headers.host || '').toLowerCase();
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1', 'localhost'];
    if (!allowedHosts.includes(host)) {
        return [403, `Host '${host}' is not accepted by the StCFSD bridge.`];
    }
    if (method === 'POST') {
        const ct = String(headers['content-type'] || '').toLowerCase();
        if (ct.split(';')[0].trim() !== 'application/json') {
            return [415, 'POST requests to the StCFSD bridge must use Content-Type: application/json.'];
        }
    }
    if (token !== undefined && !bearerMatches(headers.authorization, token)) {
        return [401, 'Missing or wrong bearer token. The StCFSD bridge accepts only the MCP server that read its port file.'];
    }
    return null;
}

export class McpBridgeServer {
    private _server: http.Server | null = null;
    private _port: number;
    private _getPanel: () => McpPanelInterface | undefined;
    private readonly _options: McpBridgeOptions | undefined;
    private readonly _token: string | undefined;
    private _instanceId: string | undefined;
    private _startedAt = '';
    private _lastAiCall: McpAiCall | undefined;
    private _aiCalls = 0;
    private _exitHook: (() => void) | undefined;

    constructor(getPanel: () => McpPanelInterface | undefined, port: number = 52790, options?: McpBridgeOptions) {
        this._getPanel = getPanel;
        this._port = port;
        this._options = options;
        if (options) {
            this._token = options.token ?? newToken();
            this._instanceId = newInstanceId();
        }
    }

    start(): Promise<void> {
        if (this._server) { return Promise.resolve(); }

        this._server = http.createServer(async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');

            // V5b-05 · `/hello` 는 토큰 없이 받는다 — 확인 전의 상대에게 MCP 서버가 토큰을 보내지 않게(증명 먼저, 인증은 그다음).
            // Origin · Host 검사는 그대로. 답은 증명(토큰을 열쇠로 한 HMAC)뿐이라 토큰도 instanceId 도 새지 않는다.
            const hello = !!this._options && req.method === 'GET' && req.url === HELLO_ENDPOINT;
            const rejected = checkBridgeRequest(req.method, req.headers, this._port, hello ? undefined : this._token);
            if (rejected) {
                req.resume();
                if (rejected[0] === 401) { res.setHeader('WWW-Authenticate', 'Bearer'); }
                res.writeHead(rejected[0]);
                res.end(JSON.stringify({ error: rejected[1] }));
                return;
            }
            // V5-09 · 증명은 토큰을 지난 요청과 `/hello` 에만 붙인다.
            const nonce = req.headers[NONCE_HEADER];
            if (this._options && validNonce(nonce)) {
                res.setHeader(PROOF_HEADER, instanceProof(this._token!, this._instanceId!, nonce));
            }
            const noPanel = this._options ? HOST_STARTING : NO_PANEL;

            try {
                let result: any;
                // K1 · AI 호출 = MCP 서버가 요청 id 머리를 붙인 요청. 화면의 조회 · /last-call 은 세지 않는다.
                const aiCall: McpAiCall | undefined = headerText(req.headers[REQUEST_ID_HEADER]) === undefined ? undefined : {
                    at: new Date().toISOString(),
                    client: headerText(req.headers[CLIENT_HEADER]) ?? 'unknown',
                    method: String(req.method), endpoint: String(req.url),
                };

                if (this._options && req.method === 'GET' && req.url === '/last-call') {
                    result = {
                        lastAiCall: this._lastAiCall ?? null, aiCalls: this._aiCalls,
                        pid: process.pid, startedAt: this._startedAt,
                    };
                } else if (hello) {
                    // V5-09 · 증명은 머리에. 패널에 닿지 않고 AI 호출로 세지 않는다. 토큰이 필요 없다(V5b-05).
                    result = { app: PORT_FILE_APP };
                } else if (req.method === 'GET' && req.url === '/status') {
                    if (aiCall) { this._recordAiCall(aiCall); }
                    const panel = this._getPanel();
                    if (!panel) {
                        result = { error: noPanel };
                    } else {
                        result = panel.getStatus();
                    }
                } else if (req.method === 'POST' && req.url === '/action') {
                    const body = await this._readBody(req);
                    if (aiCall) {
                        this._recordAiCall(typeof body.action === 'string'
                            ? { ...aiCall, action: body.action.slice(0, 80) } : aiCall);
                    }
                    const panel = this._getPanel();
                    if (!panel) {
                        result = { error: noPanel };
                    } else {
                        // R1-2: 행위자 문맥 — 기본 ai, 이 프로세스의 화면 비밀 머리가 맞을 때만 screen(기록의 행위자 · 사람만 하는 함수의 막음)
                        const ctx = contextFromHeaders(req.headers, typeof body.action === 'string' ? body.action.slice(0, 80) : undefined);
                        result = await runAs(ctx, () => panel.handleMcpAction(body));
                    }
                } else {
                    result = { error: `Unknown endpoint: ${req.method} ${req.url}` };
                }

                res.writeHead(200);
                res.end(JSON.stringify(result, _jsonReplacer));
            } catch (err: any) {
                const status = err instanceof BridgeHttpError ? err.status : 200;
                res.writeHead(status);
                res.end(JSON.stringify({ error: err?.message ?? String(err) }));
            }
        });

        return new Promise((resolve, reject) => {
            const server = this._server!;
            const onError = (err: Error) => {
                server.off('listening', onListening);
                reject(err);
            };
            const onListening = () => {
                server.off('error', onError);
                if (this._options) {
                    // K1 · 포트 0 이면 실제 포트로(Host 검사와 포트 파일이 이 값을 쓴다).
                    const addr = server.address();
                    if (addr && typeof addr === 'object') { this._port = addr.port; }
                    try {
                        this._writePortFile();
                    } catch (err) {
                        server.close();
                        this._server = null;
                        reject(new Error(`StCFSD MCP bridge: cannot write the port file ${this._options.portFile}: ${(err as Error).message}`));
                        return;
                    }
                }
                console.log(`[StCFSD MCP Bridge] Listening on port ${this._port}${this._options ? ' (port file + token)' : ''}`);
                resolve();
            };

            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(this._port, '127.0.0.1');
        });
    }

    stop(): void {
        this._server?.close();
        this._server = null;
        this._removePortFile();
    }

    get port(): number { return this._port; }

    /** K1 · 포트 파일 방식의 토큰(지금 방식이면 undefined). 같은 프로세스의 화면 다리가 쓴다. */
    get token(): string | undefined { return this._token; }

    /** K1 · 포트 파일 경로(지금 방식이면 undefined) */
    get portFile(): string | undefined { return this._options?.portFile; }

    /** K1 · 이 호스트 프로세스의 시작 식별자(포트 파일의 instanceId) */
    get instanceId(): string | undefined { return this._instanceId; }

    /** K1 · 마지막 AI 호출(없으면 undefined) */
    get lastAiCall(): McpAiCall | undefined { return this._lastAiCall; }

    private _recordAiCall(call: McpAiCall): void {
        this._lastAiCall = call;
        this._aiCalls += 1;
        try { this._options?.onAiCall?.(call); } catch { /* 표시용 알림이 요청을 막지 않는다 */ }
    }

    private _writePortFile(): void {
        const opts = this._options!;
        // 멈췄다 다시 시작해도 MCP 서버가 재시작으로 알아보게 시작마다 새로 만든다.
        this._instanceId = newInstanceId();
        this._startedAt = new Date().toISOString();
        const info: PortFileInfo = {
            app: PORT_FILE_APP, version: PORT_FILE_VERSION, port: this._port, token: this._token!,
            pid: process.pid, instanceId: this._instanceId!, startedAt: this._startedAt,
        };
        writePortFile(opts.portFile, info);
        if (!this._exitHook) {
            // 창을 닫지 않고 프로세스가 끝나도(예: 껍데기의 종료) 남기지 않는다. 강제 종료는 남는다 —
            // 그때는 MCP 서버가 pid 가 죽었음을 보고 "실행 중이 아님" 으로 답한다.
            this._exitHook = () => { removePortFileIfOwned(opts.portFile, this._instanceId!); };
            process.once('exit', this._exitHook);
        }
    }

    private _removePortFile(): void {
        if (!this._options) { return; }
        if (this._exitHook) { process.off('exit', this._exitHook); this._exitHook = undefined; }
        removePortFileIfOwned(this._options.portFile, this._instanceId!);
    }

    private _readBody(req: http.IncomingMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            let data = '';
            let size = 0;
            req.setEncoding('utf8');
            req.on('data', (chunk: string) => {
                size += Buffer.byteLength(chunk);
                if (size > MAX_BODY_BYTES) {
                    reject(new BridgeHttpError(413, 'Request body too large.'));
                    req.destroy();
                    return;
                }
                data += chunk;
            });
            req.on('end', () => {
                let parsed: any;
                try { parsed = JSON.parse(data || '{}'); }
                catch { reject(new BridgeHttpError(400, 'Request body is not valid JSON.')); return; }
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    reject(new BridgeHttpError(400, 'Request body must be a JSON object.'));
                    return;
                }
                resolve(parsed);
            });
            req.on('error', reject);
        });
    }
}

function _jsonReplacer(key: string, value: any): any {
    // NaN, Infinity 처리
    if (typeof value === 'number' && !isFinite(value)) { return null; }
    return value;
}
