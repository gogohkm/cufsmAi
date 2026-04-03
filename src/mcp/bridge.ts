/**
 * CUFSM MCP Bridge — HTTP 서버로 MCP Server ↔ CufsmPanel 연결
 *
 * MCP Server (stdio) ─HTTP→ Bridge (localhost:52790) ─직접호출→ CufsmPanel
 */

import * as http from 'http';

/** CufsmPanel이 구현해야 하는 인터페이스 */
export interface McpPanelInterface {
    handleMcpAction(options: any): Promise<any>;
    getStatus(): any;
}

export class McpBridgeServer {
    private _server: http.Server | null = null;
    private _port: number;
    private _getPanel: () => McpPanelInterface | undefined;

    constructor(getPanel: () => McpPanelInterface | undefined, port: number = 52790) {
        this._getPanel = getPanel;
        this._port = port;
    }

    start(): void {
        if (this._server) { return; }

        this._server = http.createServer(async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');

            try {
                let result: any;

                if (req.method === 'GET' && req.url === '/status') {
                    const panel = this._getPanel();
                    if (!panel) {
                        result = { error: 'No active CUFSM panel. Open Section Designer first.' };
                    } else {
                        result = panel.getStatus();
                    }
                } else if (req.method === 'POST' && req.url === '/action') {
                    const body = await this._readBody(req);
                    const panel = this._getPanel();
                    if (!panel) {
                        result = { error: 'No active CUFSM panel. Open Section Designer first.' };
                    } else {
                        result = await panel.handleMcpAction(body);
                    }
                } else {
                    result = { error: `Unknown endpoint: ${req.method} ${req.url}` };
                }

                res.writeHead(200);
                res.end(JSON.stringify(result, _jsonReplacer));
            } catch (err: any) {
                res.writeHead(200);
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
    }

    get port(): number { return this._port; }

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

function _jsonReplacer(key: string, value: any): any {
    // NaN, Infinity 처리
    if (typeof value === 'number' && !isFinite(value)) { return null; }
    return value;
}
