/**
 * Python 해석 엔진 브릿지
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { JsonRpcProtocol } from './JsonRpcProtocol';
import { StcfsdModel, StcfsdResult, SectionProperties } from '../models/types';

export class PythonBridge {
    private _process: ChildProcess | null = null;
    private _protocol: JsonRpcProtocol;
    private _extensionPath: string;
    private _pythonPath: string;
    private _started = false;
    private _startupPromise: Promise<void> | null = null;

    constructor(extensionPath: string, pythonPath: string = 'python') {
        this._extensionPath = extensionPath;
        this._pythonPath = pythonPath;
        this._protocol = new JsonRpcProtocol(300000);  // 5분 (큰 메시 FSM 해석용)
    }

    async start(): Promise<void> {
        if (this._process && this._started) {
            return;
        }
        if (this._startupPromise) {
            return this._startupPromise;
        }

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

            try {
                this._process = spawn(this._pythonPath, ['-u', 'server.py'], {
                    cwd: enginePath,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, PYTHONUNBUFFERED: '1' },
                });
            } catch (err: any) {
                console.error('[StCFSD] Failed to spawn Python:', err.message);
                finishReject(err);
                return;
            }

            // 프로세스 즉시 종료 감지
            this._process.on('error', (err) => {
                console.error('[StCFSD] Python process error:', err.message);
                finishReject(err instanceof Error ? err : new Error(String(err)));
            });

            this._process.on('exit', (code, signal) => {
                console.log(`[StCFSD] Python process exited: code=${code}, signal=${signal}`);
                this._process = null;
                this._started = false;
                if (!settled) {
                    finishReject(new Error(`Python exited during startup (code=${code}, signal=${signal ?? 'none'})`));
                }
            });

            this._process.stdout!.setEncoding('utf-8');
            this._process.stdout!.on('data', (data: string) => {
                this._protocol.onData(data);
            });

            this._process.stderr!.setEncoding('utf-8');
            this._process.stderr!.on('data', (data: string) => {
                console.error('[StCFSD Python stderr]', data.trim());
            });

            // stderr에서 import 에러 등을 감지
            let stderrBuffer = '';
            this._process.stderr!.on('data', (chunk: string) => {
                stderrBuffer += chunk;
            });

            // ping으로 시작 확인 (2초 대기)
            setTimeout(async () => {
                if (!this._process || this._process.exitCode !== null) {
                    const msg = `Python exited immediately. stderr: ${stderrBuffer.substring(0, 500)}`;
                    console.error(`[StCFSD] ${msg}`);
                    finishReject(new Error(msg));
                    return;
                }
                try {
                    const result = await this.ping();
                    console.log(`[StCFSD] Python engine ready: ${result}`);
                    this._started = true;
                    finishResolve();
                } catch (err: any) {
                    const msg = `Ping failed. stderr: ${stderrBuffer.substring(0, 500)}`;
                    console.error(`[StCFSD] ${msg}`);
                    finishReject(new Error(msg));
                }
            }, 2000);
        });

        return this._startupPromise;
    }

    stop(): void {
        this._protocol.dispose();
        this._startupPromise = null;
        this._cleanupProcess();
    }

    async ping(): Promise<string> {
        return this._call('ping', {});
    }

    async analyze(model: StcfsdModel): Promise<StcfsdResult> {
        return this._call('analyze', model);
    }

    async getProperties(node: number[][], elem: number[][]): Promise<SectionProperties> {
        return this._call('get_properties', { node, elem });
    }

    async call(method: string, params: any): Promise<any> {
        return this._call(method, params);
    }

    private async _call(method: string, params: any): Promise<any> {
        if (!this._process || !this._process.stdin) {
            console.error(`[StCFSD] _call(${method}): Python process not running`);
            throw new Error(`Python process is not running (method: ${method})`);
        }

        const request = this._protocol.createRequest(method, params);
        const promise = this._protocol.registerRequest(request.id);

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
            this._process.kill();
            this._process = null;
        }
        this._started = false;
    }
}
