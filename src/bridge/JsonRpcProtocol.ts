/**
 * JSON-RPC 프로토콜 — 줄 단위 JSON 통신
 *
 * 참조: 컨버전전략.md §3 데이터 흐름
 * Python server.py와 stdin/stdout으로 통신
 */

import { JsonRpcRequest, JsonRpcResponse } from '../models/types';

export type ResponseCallback = (response: JsonRpcResponse) => void;

export class JsonRpcProtocol {
    private _nextId = 1;
    private _pending = new Map<number, {
        resolve: (value: any) => void;
        reject: (reason: any) => void;
        timer: NodeJS.Timeout;
    }>();
    private _buffer = '';
    private _timeoutMs: number;
    /** 시간 초과 알림(R8-31 · V4-02): 호스트가 엔진을 다시 시작해 그 계산을 취소할 수 있게. */
    private _onTimeout: ((id: number, method: string) => void) | null;
    private _methods = new Map<number, string>();

    constructor(timeoutMs: number = 30000, onTimeout?: (id: number, method: string) => void) {
        this._timeoutMs = timeoutMs;
        this._onTimeout = onTimeout || null;
    }

    /** 요청 하나의 시간 제한(ms). */
    get timeoutMs(): number {
        return this._timeoutMs;
    }

    /** 요청 생성 (id 자동 부여) */
    createRequest(method: string, params: any): JsonRpcRequest {
        return {
            method,
            params,
            id: this._nextId++,
        };
    }

    /** 요청 등록 — Promise 반환, 응답 수신 시 resolve */
    registerRequest(id: number, method: string = ''): Promise<any> {
        this._methods.set(id, method);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                this._methods.delete(id);
                reject(new Error(`JSON-RPC request ${id} (${method || 'call'}) timed out after ${this._timeoutMs}ms — `
                    + 'the Python engine was restarted to cancel it; run it again with a smaller request.'));
                if (this._onTimeout) { this._onTimeout(id, method); }
            }, this._timeoutMs);

            this._pending.set(id, { resolve, reject, timer });
        });
    }

    /** stdout 데이터 수신 — 줄 단위 파싱 */
    onData(chunk: string): void {
        this._buffer += chunk;
        const lines = this._buffer.split('\n');
        // 마지막 불완전한 줄은 버퍼에 유지
        this._buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) { continue; }
            try {
                const response: JsonRpcResponse = JSON.parse(trimmed);
                this._handleResponse(response);
            } catch {
                console.error('[StCFSD] Failed to parse JSON-RPC response:', trimmed.substring(0, 200));
            }
        }
    }

    private _handleResponse(response: JsonRpcResponse): void {
        const pending = this._pending.get(response.id);
        if (!pending) {
            console.warn(`[StCFSD] No pending request for id ${response.id}`);
            return;
        }

        clearTimeout(pending.timer);
        this._pending.delete(response.id);
        this._methods.delete(response.id);

        if (response.error) {
            // error 는 문자열(서버 계약). error_code(INVALID_PARAMS 등)는 Error 객체에 실어 호출자가 구분한다.
            const err: Error & { code?: string } = new Error(String(response.error));
            if (response.error_code) { err.code = response.error_code; }
            pending.reject(err);
        } else {
            pending.resolve(response.result);
        }
    }

    /** 모든 보류 요청 취소 */
    dispose(reason: string = 'Protocol disposed'): void {
        for (const pending of this._pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
        }
        this._pending.clear();
    }
}
