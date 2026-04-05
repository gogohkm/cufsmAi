/**
 * Python 해석 엔진 브릿지
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { JsonRpcProtocol } from './JsonRpcProtocol';
import { CufsmModel, CufsmResult, SectionProperties } from '../models/types';

export class PythonBridge {
    private _process: ChildProcess | null = null;
    private _protocol: JsonRpcProtocol;
    private _extensionPath: string;
    private _pythonPath: string;
    private _started = false;

    constructor(extensionPath: string, pythonPath: string = 'python') {
        this._extensionPath = extensionPath;
        this._pythonPath = pythonPath;
        this._protocol = new JsonRpcProtocol(300000);  // 5분 (큰 메시 FSM 해석용)
    }

    async start(): Promise<void> {
        if (this._process && this._started) {
            return;
        }

        const enginePath = path.join(this._extensionPath, 'python');
        console.log(`[CUFSM] Starting Python: ${this._pythonPath} -u server.py`);
        console.log(`[CUFSM] CWD: ${enginePath}`);

        return new Promise<void>((resolve, reject) => {
            try {
                this._process = spawn(this._pythonPath, ['-u', 'server.py'], {
                    cwd: enginePath,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, PYTHONUNBUFFERED: '1' },
                });
            } catch (err: any) {
                console.error('[CUFSM] Failed to spawn Python:', err.message);
                reject(err);
                return;
            }

            // 프로세스 즉시 종료 감지
            this._process.on('error', (err) => {
                console.error('[CUFSM] Python process error:', err.message);
                this._process = null;
                this._started = false;
                reject(err);
            });

            this._process.on('exit', (code, signal) => {
                console.log(`[CUFSM] Python process exited: code=${code}, signal=${signal}`);
                this._process = null;
                this._started = false;
            });

            this._process.stdout!.setEncoding('utf-8');
            this._process.stdout!.on('data', (data: string) => {
                this._protocol.onData(data);
            });

            this._process.stderr!.setEncoding('utf-8');
            this._process.stderr!.on('data', (data: string) => {
                console.error('[CUFSM Python stderr]', data.trim());
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
                    console.error(`[CUFSM] ${msg}`);
                    reject(new Error(msg));
                    return;
                }
                try {
                    const result = await this.ping();
                    console.log(`[CUFSM] Python engine ready: ${result}`);
                    this._started = true;
                    resolve();
                } catch (err: any) {
                    const msg = `Ping failed. stderr: ${stderrBuffer.substring(0, 500)}`;
                    console.error(`[CUFSM] ${msg}`);
                    this._started = true;
                    resolve(); // 에러여도 계속 시도 허용
                }
            }, 2000);
        });
    }

    stop(): void {
        this._protocol.dispose();
        if (this._process) {
            this._process.kill();
            this._process = null;
        }
        this._started = false;
    }

    async ping(): Promise<string> {
        return this._call('ping', {});
    }

    async analyze(model: CufsmModel): Promise<CufsmResult> {
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
            console.error(`[CUFSM] _call(${method}): Python process not running`);
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
}
