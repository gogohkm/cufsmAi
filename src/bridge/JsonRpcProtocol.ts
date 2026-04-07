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

    constructor(timeoutMs: number = 30000) {
        this._timeoutMs = timeoutMs;
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
    registerRequest(id: number): Promise<any> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`JSON-RPC request ${id} timed out after ${this._timeoutMs}ms`));
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

        if (response.error) {
            pending.reject(new Error(response.error));
        } else {
            pending.resolve(response.result);
        }
    }

    /** 모든 보류 요청 취소 */
    dispose(): void {
        for (const [id, pending] of this._pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Protocol disposed'));
        }
        this._pending.clear();
    }
}
