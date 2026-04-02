/**
 * Python 해석 엔진 브릿지
 *
 * 참조: 컨버전전략.md §2 전체 아키텍처, §5.1 Extension Host
 * stgen dxfEditorProvider 패턴 참조
 *
 * child_process.spawn()으로 Python 프로세스를 관리하고
 * JSON-RPC 프로토콜로 stdin/stdout 통신한다.
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

    constructor(extensionPath: string, pythonPath: string = 'python') {
        this._extensionPath = extensionPath;
        this._pythonPath = pythonPath;
        this._protocol = new JsonRpcProtocol(60000); // 60초 타임아웃
    }

    /** Python 프로세스 시작 */
    async start(): Promise<void> {
        if (this._process) {
            return;
        }

        const enginePath = path.join(this._extensionPath, 'python');

        this._process = spawn(this._pythonPath, ['-u', 'server.py'], {
            cwd: enginePath,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });

        this._process.stdout!.setEncoding('utf-8');
        this._process.stdout!.on('data', (data: string) => {
            this._protocol.onData(data);
        });

        this._process.stderr!.setEncoding('utf-8');
        this._process.stderr!.on('data', (data: string) => {
            console.error('[CUFSM Python]', data.trim());
        });

        this._process.on('exit', (code) => {
            console.log(`[CUFSM] Python process exited with code ${code}`);
            this._process = null;
        });

        // 시작 확인
        await this.ping();
    }

    /** Python 프로세스 종료 */
    stop(): void {
        this._protocol.dispose();
        if (this._process) {
            this._process.kill();
            this._process = null;
        }
    }

    /** 연결 확인 */
    async ping(): Promise<string> {
        return this._call('ping', {});
    }

    /** 좌굴 해석 실행 */
    async analyze(model: CufsmModel): Promise<CufsmResult> {
        return this._call('analyze', model);
    }

    /** 단면 성질 계산 */
    async getProperties(node: number[][], elem: number[][]): Promise<SectionProperties> {
        return this._call('get_properties', { node, elem });
    }

    /** JSON-RPC 요청 전송 */
    private async _call(method: string, params: any): Promise<any> {
        if (!this._process || !this._process.stdin) {
            throw new Error('Python process is not running. Call start() first.');
        }

        const request = this._protocol.createRequest(method, params);
        const promise = this._protocol.registerRequest(request.id);

        const json = JSON.stringify(request) + '\n';
        this._process.stdin.write(json);

        return promise;
    }

    /** 프로세스 실행 중인지 확인 */
    get isRunning(): boolean {
        return this._process !== null && !this._process.killed;
    }

    dispose(): void {
        this.stop();
    }
}
