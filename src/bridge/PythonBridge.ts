/**
 * Python 해석 엔진 브릿지
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { JsonRpcProtocol } from './JsonRpcProtocol';
import { StcfsdModel, StcfsdResult, SectionProperties } from '../models/types';

/** server.py `selftest` 결과 (protocol_version 2) */
export interface PythonSelftest {
    ok: boolean;
    python?: string;
    python_ok?: boolean;
    import_errors?: Array<{ module?: string; error?: string } | string> | Record<string, string>;
    protocol_version?: number;
    /** 엔진 자신의 소스에 대한 sha256(읽지 못하면 'unknown') — 저장한 결과가 이 엔진의 것인지(StcfsdPanel resultsEngine) */
    engine_id?: string;
    methods?: string[];
}

/** 시작 점검 실패: 사용자에게 보일 문장을 message 에 담는다. */
export class PythonStartupError extends Error {
    constructor(message: string, public readonly selftest?: PythonSelftest, public readonly stderr?: string) {
        super(message);
        this.name = 'PythonStartupError';
    }
}

/** stderr 를 계속 비우되 마지막 일부만 남긴다(파이프가 차면 서버가 막힌다). */
const STDERR_TAIL_CHARS = 8000;

export class PythonBridge {
    private _process: ChildProcess | null = null;
    private _protocol: JsonRpcProtocol;
    private _extensionPath: string;
    private _pythonPath: string;
    private _started = false;
    private _startupPromise: Promise<void> | null = null;
    private _stderrTail = '';
    private _selftest: PythonSelftest | null = null;
    /** 정상 시작 뒤 예기치 않게 죽었는가 (stop() 으로 끈 것은 아님) */
    private _crashed = false;
    private _lastExit = '';
    /** 죽은 프로세스를 다시 띄운 횟수. 한 번 다시 띄운 뒤 또 죽으면 더 띄우지 않는다. */
    private _restarts = 0;
    private _stopping = false;
    private _killingForTimeout = false;
    private _needsRestart = false;
    private _onStatus: ((kind: 'restarted' | 'restart_failed' | 'exited', message: string) => void) | null = null;

    constructor(extensionPath: string, pythonPath: string = 'python') {
        this._extensionPath = extensionPath;
        this._pythonPath = pythonPath;
        // 5분 (큰 메시 FSM 해석용). 시간 초과면 엔진을 다시 띄워 그 계산을 취소한다 — 파이썬은 단일 스레드라
        // 그대로 두면 뒤의 모든 요청이 그 계산 뒤에 줄을 서 화면이 멈춘다(V4-02, R8-31).
        this._protocol = new JsonRpcProtocol(300000, (_id, method) => this._handleTimeout(method));
    }

    /** 시간 초과 — 계산을 취소(프로세스 종료)하고 다음 호출에서 새로 띄운다. 알림으로 상태를 보인다. */
    private _handleTimeout(method: string): void {
        if (!this._process) { return; }
        this._killingForTimeout = true;
        this._onStatus?.('exited', `StCFSD: Python 계산(${method || 'call'})이 5 분 안에 끝나지 않아 엔진을 다시 시작합니다 — `
            + '그 계산은 취소되었습니다. 요청을 줄여(길이 수 · 종방향 항 · 메시) 다시 실행하세요.');
        this._protocol.dispose(`Python engine restarted after a timeout in ${method || 'call'}`);
        this._cleanupProcess();
        this._needsRestart = true;
    }

    /** 프로세스 종료·재시작을 사용자에게 알릴 콜백 (확장이 정보창으로 보인다). */
    onStatus(cb: (kind: 'restarted' | 'restart_failed' | 'exited', message: string) => void): void {
        this._onStatus = cb;
    }

    /** 엔진 호출 하나의 시간 제한(ms) — 넘으면 엔진을 다시 시작해 취소한다. */
    get timeoutMs(): number {
        return this._protocol.timeoutMs;
    }

    get selftest(): PythonSelftest | null {
        return this._selftest;
    }

    get pythonPath(): string {
        return this._pythonPath;
    }

    /** 최근 stderr (진단용) */
    get stderrTail(): string {
        return this._stderrTail;
    }

    async start(): Promise<void> {
        if (this._process && this._started) {
            return;
        }
        if (this._startupPromise) {
            return this._startupPromise;
        }
        this._stopping = false;

        const enginePath = path.join(this._extensionPath, 'python');
        console.log(`[StCFSD] Starting Python: ${this._pythonPath} -u server.py`);
        console.log(`[StCFSD] CWD: ${enginePath}`);

        this._startupPromise = new Promise<void>((resolve, reject) => {
            let settled = false;
            const finishResolve = () => {
                if (settled) { return; }
                settled = true;
                this._startupPromise = null;
                resolve();
            };
            const finishReject = (err: Error) => {
                if (settled) { return; }
                settled = true;
                this._startupPromise = null;
                this._cleanupProcess();
                reject(err);
            };

            let proc: ChildProcess;
            try {
                proc = spawn(this._pythonPath, ['-u', 'server.py'], {
                    cwd: enginePath,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
                });
            } catch (err: any) {
                console.error('[StCFSD] Failed to spawn Python:', err.message);
                finishReject(new PythonStartupError(
                    `Python 을 실행하지 못했습니다 (${this._pythonPath}): ${err.message}`));
                return;
            }
            this._process = proc;
            this._stderrTail = '';

            // 프로세스 즉시 종료 감지
            proc.on('error', (err) => {
                console.error('[StCFSD] Python process error:', err.message);
                this._protocol.dispose(`Python process error: ${err.message}`);
                finishReject(new PythonStartupError(
                    `Python 을 실행하지 못했습니다 (${this._pythonPath}): ${err.message}`));
            });

            proc.on('exit', (code, signal) => {
                console.log(`[StCFSD] Python process exited: code=${code}, signal=${signal}`);
                const wasStarted = this._started;
                if (this._process === proc) {
                    this._process = null;
                    this._started = false;
                }
                this._lastExit = `code=${code}, signal=${signal ?? 'none'}`;
                this._protocol.dispose(
                    `Python process exited before completing pending requests (${this._lastExit})`
                );
                if (!settled) {
                    finishReject(new PythonStartupError(
                        `Python 엔진이 시작 중에 종료되었습니다 (${this._lastExit}). stderr: ${this._stderrTail.slice(-500)}`,
                        undefined, this._stderrTail));
                } else if (this._killingForTimeout) {
                    this._killingForTimeout = false;
                } else if (wasStarted && !this._stopping) {
                    this._crashed = true;
                    this._onStatus?.('exited',
                        `StCFSD: Python 엔진이 종료되었습니다 (${this._lastExit}). 다음 계산 때 한 번 다시 시작합니다.`);
                }
            });

            proc.stdout!.setEncoding('utf-8');
            proc.stdout!.on('data', (data: string) => {
                this._protocol.onData(data);
            });

            // 서버는 엔진 출력을 stderr 로 보낸다 — 계속 읽어 비우고 끝부분만 남긴다.
            proc.stderr!.setEncoding('utf-8');
            proc.stderr!.on('data', (chunk: string) => {
                this._stderrTail = (this._stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
                console.error('[StCFSD Python stderr]', chunk.trim());
            });

            // selftest 로 시작 확인 (파이썬 버전 + 엔진 import). 구버전 서버면 ping.
            setTimeout(async () => {
                if (!this._process || this._process.exitCode !== null) {
                    finishReject(new PythonStartupError(
                        `Python 엔진이 곧바로 종료되었습니다. stderr: ${this._stderrTail.substring(0, 500)}`,
                        undefined, this._stderrTail));
                    return;
                }
                try {
                    let st: PythonSelftest;
                    try {
                        st = await this._call('selftest', {});
                    } catch (e: any) {
                        if (e?.code !== 'METHOD_NOT_FOUND') { throw e; }
                        await this.ping();
                        st = { ok: true, protocol_version: 1 };
                    }
                    this._selftest = st;
                    if (!st || st.ok === false) {
                        finishReject(new PythonStartupError(PythonBridge.describeSelftest(st, this._pythonPath), st));
                        return;
                    }
                    console.log(`[StCFSD] Python engine ready: python ${st.python || '?'}, protocol ${st.protocol_version}`);
                    this._started = true;
                    finishResolve();
                } catch (e: any) {
                    finishReject(new PythonStartupError(
                        `Python 엔진 시작 확인(selftest)에 실패했습니다: ${e?.message || e}. stderr: ${this._stderrTail.substring(0, 500)}`,
                        undefined, this._stderrTail));
                }
            }, 1500);
        });

        return this._startupPromise;
    }

    /** selftest 실패를 사람이 읽는 문장으로 */
    static describeSelftest(st: PythonSelftest | null | undefined, pythonPath: string): string {
        if (!st) { return `Python 엔진 점검 결과가 없습니다 (${pythonPath}).`; }
        const parts: string[] = [];
        if (st.python_ok === false) {
            parts.push(`Python ${st.python || '?'} — 3.10 이상이 필요합니다 (${pythonPath})`);
        }
        const ie = st.import_errors;
        let importLines: string[] = [];
        if (Array.isArray(ie)) {
            importLines = ie.map((x: any) => typeof x === 'string' ? x : `${x.module ?? ''}: ${x.error ?? ''}`);
        } else if (ie && typeof ie === 'object') {
            importLines = Object.entries(ie).map(([k, v]) => `${k}: ${v}`);
        }
        if (importLines.length > 0) {
            parts.push(`엔진 모듈을 불러오지 못했습니다 — ${importLines.slice(0, 5).join('; ')}`
                + ' (numpy · scipy 설치와 Python 버전을 확인하세요)');
        }
        if (parts.length === 0) { parts.push('Python 엔진 점검(selftest)이 실패했습니다.'); }
        return 'StCFSD: ' + parts.join(' / ');
    }

    stop(): void {
        this._stopping = true;
        this._protocol.dispose();
        this._startupPromise = null;
        this._cleanupProcess();
    }

    async ping(): Promise<string> {
        return this._call('ping', {});
    }

    async analyze(model: StcfsdModel): Promise<StcfsdResult> {
        return this.call('analyze', model);
    }

    async getProperties(node: number[][], elem: number[][]): Promise<SectionProperties> {
        return this.call('get_properties', { node, elem });
    }

    async call(method: string, params: any): Promise<any> {
        // F08: transport 메타데이터(action)는 Python 업무 함수에 전달하지 않는다.
        if (params && typeof params === 'object' && !Array.isArray(params) && 'action' in params) {
            const { action: _action, ...rest } = params;
            void _action;
            params = rest;
        }
        await this._ensureAlive(method);
        return this._call(method, params);
    }

    /** 정상 시작 뒤 죽은 프로세스는 한 번만 다시 띄운다(R8-17). 그 뒤에도 죽으면 분명한 오류. */
    private async _ensureAlive(method: string): Promise<void> {
        if (this._process && this._process.stdin) { return; }
        if (this._startupPromise) {
            await this._startupPromise;
            return;
        }
        if (this._needsRestart) {
            this._needsRestart = false;
            await this.start();
            return;
        }
        if (!this._crashed) { return; }   // 한 번도 시작하지 않았으면 _call 이 오류를 낸다
        if (this._restarts >= 1) {
            throw new Error(`Python 엔진이 다시 시작한 뒤에도 종료되었습니다 (${this._lastExit}). `
                + `패널을 닫고 다시 여세요. (method: ${method}) stderr: ${this._stderrTail.slice(-300)}`);
        }
        this._restarts++;
        this._crashed = false;
        try {
            await this.start();
            this._onStatus?.('restarted', `StCFSD: 종료된 Python 엔진을 다시 시작했습니다 (이전 종료: ${this._lastExit}).`);
        } catch (e: any) {
            this._onStatus?.('restart_failed', `StCFSD: Python 엔진을 다시 시작하지 못했습니다: ${e?.message || e}`);
            throw e;
        }
    }

    private async _call(method: string, params: any): Promise<any> {
        if (!this._process || !this._process.stdin) {
            console.error(`[StCFSD] _call(${method}): Python process not running`);
            const why = this._selftest && this._selftest.ok === false
                ? ` — ${PythonBridge.describeSelftest(this._selftest, this._pythonPath)}` : '';
            throw new Error(`Python process is not running (method: ${method})${why}`);
        }

        const request = this._protocol.createRequest(method, params);
        const promise = this._protocol.registerRequest(request.id, method);

        const json = JSON.stringify(request) + '\n';
        this._process.stdin.write(json);

        return promise;
    }

    get isRunning(): boolean {
        return this._process !== null && this._started;
    }

    dispose(): void {
        this.stop();
    }

    private _cleanupProcess(): void {
        if (this._process) {
            const p = this._process;
            this._process = null;
            p.kill();
        }
        this._started = false;
    }
}
