/**
 * CUFSM MCP Bridge — HTTP 서버로 MCP Server ↔ WebView 연결
 *
 * stgen bridge.ts 패턴:
 * MCP Server (stdio) ─HTTP→ Bridge (localhost:52790) ─postMessage→ WebView
 */

import * as http from 'http';
import * as vscode from 'vscode';

interface PendingRequest {
    resolve: (data: any) => void;
    reject: (err: any) => void;
    timer: NodeJS.Timeout;
}

export class McpBridgeServer {
    private _server: http.Server | null = null;
    private _port: number;
    private _getPanel: () => any | undefined;
    private _pendingRequests = new Map<string, PendingRequest>();
    private _requestId = 0;

    constructor(getPanel: () => any | undefined, port: number = 52790) {
        this._getPanel = getPanel;
        this._port = port;
    }

    start(): void {
        if (this._server) { return; }

        this._server = http.createServer(async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');

            try {
                if (req.method === 'GET') {
                    const result = await this._handleGet(req.url || '/');
                    res.writeHead(200);
                    res.end(JSON.stringify(result));
                } else if (req.method === 'POST') {
                    const body = await this._readBody(req);
                    const result = await this._handlePost(req.url || '/', body);
                    res.writeHead(200);
                    res.end(JSON.stringify(result));
                } else {
                    res.writeHead(405);
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                }
            } catch (err: any) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
            }
        });

        this._server.listen(this._port, () => {
            console.log(`[CUFSM MCP Bridge] Listening on port ${this._port}`);
        });

        this._server.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                console.warn(`[CUFSM MCP Bridge] Port ${this._port} in use, trying ${this._port + 1}`);
                this._port++;
                this._server?.listen(this._port);
            }
        });
    }

    stop(): void {
        this._server?.close();
        this._server = null;
        for (const [, pending] of this._pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Bridge stopped'));
        }
        this._pendingRequests.clear();
    }

    get port(): number { return this._port; }

    /** WebView에서 mcp_response 메시지 수신 시 호출 */
    handleMcpResponse(requestId: string, data: any): void {
        const pending = this._pendingRequests.get(requestId);
        if (pending) {
            clearTimeout(pending.timer);
            this._pendingRequests.delete(requestId);
            pending.resolve(data);
        }
    }

    // ── GET 핸들러 ──
    private async _handleGet(url: string): Promise<any> {
        switch (url) {
            case '/status':
                return this._sendToWebview('mcp_get_status', {});
            default:
                return { error: `Unknown GET endpoint: ${url}` };
        }
    }

    // ── POST 핸들러 ──
    private async _handlePost(url: string, body: any): Promise<any> {
        switch (url) {
            case '/action':
                return this._sendToWebview('mcp_action', body);
            default:
                return { error: `Unknown POST endpoint: ${url}` };
        }
    }

    // ── WebView에 메시지 전송하고 응답 대기 ──
    private async _sendToWebview(type: string, options: any): Promise<any> {
        const panel = this._getPanel();
        if (!panel) {
            return { error: 'No active CUFSM panel. Open Section Designer first.' };
        }

        const requestId = `mcp_${++this._requestId}_${Date.now()}`;

        return new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingRequests.delete(requestId);
                reject(new Error('MCP request timeout (30s)'));
            }, 30000);

            this._pendingRequests.set(requestId, { resolve, reject, timer });

            panel.postMessage('mcpRequest', {
                type,
                requestId,
                options,
            });
        });
    }

    private _readBody(req: http.IncomingMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            let data = '';
            req.on('data', chunk => data += chunk);
            req.on('end', () => {
                try { resolve(JSON.parse(data || '{}')); }
                catch { resolve({}); }
            });
            req.on('error', reject);
        });
    }
}
