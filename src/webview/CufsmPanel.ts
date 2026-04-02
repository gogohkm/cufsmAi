/**
 * CUFSM WebView 패널
 *
 * 참조: 컨버전전략.md §5.3 WebView, §11 VS Code 테마 연동
 * stgen dxfEditorProvider.ts 패턴 참조
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { PythonBridge } from '../bridge/PythonBridge';
import { CufsmModel, CufsmResult, WebviewToExtMessage, createDefaultModel } from '../models/types';

export class CufsmPanel {
    public static readonly viewType = 'cufsm.designer';
    private static _instance: CufsmPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _pythonBridge: PythonBridge;
    private _disposed = false;

    private _model: CufsmModel;

    public static createOrShow(extensionUri: vscode.Uri, pythonBridge: PythonBridge): CufsmPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (CufsmPanel._instance) {
            CufsmPanel._instance._panel.reveal(column);
            return CufsmPanel._instance;
        }

        const panel = vscode.window.createWebviewPanel(
            CufsmPanel.viewType,
            'CUFSM Section Designer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'webview'),
                ],
            }
        );

        CufsmPanel._instance = new CufsmPanel(panel, extensionUri, pythonBridge);
        return CufsmPanel._instance;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        pythonBridge: PythonBridge
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._pythonBridge = pythonBridge;
        this._model = createDefaultModel();

        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.webview.onDidReceiveMessage(
            (message: WebviewToExtMessage) => this._handleMessage(message)
        );

        this._panel.onDidDispose(() => this._dispose());
    }

    /** WebView에서 수신한 메시지 처리 */
    private async _handleMessage(message: WebviewToExtMessage): Promise<void> {
        switch (message.command) {
            case 'webviewReady':
                // WebView 초기화 완료 → 기본 모델 전송
                this._postMessage('modelLoaded', this._model);
                break;

            case 'runAnalysis':
                await this._runAnalysis(message.data);
                break;

            case 'getProperties':
                await this._getProperties(message.data);
                break;

            case 'updateModel':
                this._model = { ...this._model, ...message.data };
                break;
        }
    }

    /** 좌굴 해석 실행 */
    private async _runAnalysis(model: CufsmModel): Promise<void> {
        this._postMessage('analysisStarted', null);
        try {
            const result = await this._pythonBridge.analyze(model);
            this._postMessage('analysisComplete', result);
        } catch (err: any) {
            this._postMessage('analysisError', { error: err.message });
            vscode.window.showErrorMessage(`CUFSM Analysis Error: ${err.message}`);
        }
    }

    /** 단면 성질 계산 */
    private async _getProperties(data: { node: number[][]; elem: number[][] }): Promise<void> {
        try {
            const props = await this._pythonBridge.getProperties(data.node, data.elem);
            this._postMessage('propertiesResult', props);
        } catch (err: any) {
            this._postMessage('propertiesError', { error: err.message });
        }
    }

    /** WebView로 메시지 전송 */
    private _postMessage(command: string, data: any): void {
        if (!this._disposed) {
            this._panel.webview.postMessage({ command, data });
        }
    }

    /** WebView HTML 생성 */
    private _getHtmlForWebview(): string {
        const webview = this._panel.webview;
        const nonce = getNonce();

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'css', 'theme.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'js', 'app.js')
        );

        return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}';
        img-src ${webview.cspSource} data: blob:;
        font-src ${webview.cspSource};
    ">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>CUFSM Section Designer</title>
</head>
<body>
    <!-- 탭 바 -->
    <div class="tab-bar">
        <button class="tab-btn active" data-tab="preprocessor">Preprocessor</button>
        <button class="tab-btn" data-tab="analysis">Analysis</button>
        <button class="tab-btn" data-tab="postprocessor">Postprocessor</button>
    </div>

    <!-- 탭 내용 -->
    <div class="tab-content">
        <!-- 전처리 탭 -->
        <div id="tab-preprocessor" class="tab-panel active">
            <div class="panel-row">
                <div class="panel-left">
                    <h3>Section Input</h3>
                    <div class="section-group">
                        <label>Material</label>
                        <div class="input-row">
                            <label>E</label><input type="number" id="input-E" value="29500" step="100">
                            <label>v</label><input type="number" id="input-v" value="0.3" step="0.01">
                            <label>G</label><input type="number" id="input-G" value="11346" step="100">
                        </div>
                    </div>
                    <div class="section-group">
                        <label>Nodes <button id="btn-add-node" class="btn-small">+ Add</button></label>
                        <div id="node-table-container" class="table-container">
                            <table id="node-table">
                                <thead><tr><th>#</th><th>x</th><th>z</th><th>stress</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="section-group">
                        <label>Elements <button id="btn-add-elem" class="btn-small">+ Add</button></label>
                        <div id="elem-table-container" class="table-container">
                            <table id="elem-table">
                                <thead><tr><th>#</th><th>ni</th><th>nj</th><th>t</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="panel-right">
                    <h3>Cross Section Preview</h3>
                    <div id="section-preview">
                        <svg id="section-svg" viewBox="-1 -1 12 12" preserveAspectRatio="xMidYMid meet"></svg>
                    </div>
                    <div id="section-props" class="props-display"></div>
                </div>
            </div>
        </div>

        <!-- 해석 탭 -->
        <div id="tab-analysis" class="tab-panel">
            <div class="section-group">
                <label>Boundary Condition</label>
                <select id="select-bc">
                    <option value="S-S" selected>S-S (Simply-Simply)</option>
                    <option value="C-C">C-C (Clamped-Clamped)</option>
                    <option value="S-C">S-C (Simply-Clamped)</option>
                    <option value="C-F">C-F (Clamped-Free)</option>
                    <option value="C-G">C-G (Clamped-Guided)</option>
                </select>
            </div>
            <div class="section-group">
                <label>Lengths (half-wavelengths)</label>
                <div class="input-row">
                    <label>Min</label><input type="number" id="input-len-min" value="1" step="1">
                    <label>Max</label><input type="number" id="input-len-max" value="1000" step="100">
                    <label>N</label><input type="number" id="input-len-n" value="50" step="10">
                </div>
            </div>
            <div class="section-group">
                <label>Number of eigenvalues</label>
                <input type="number" id="input-neigs" value="20" step="1">
            </div>
            <div class="button-row">
                <button id="btn-run-analysis" class="btn-primary">Run Analysis</button>
            </div>
            <div id="analysis-status" class="status-bar"></div>
        </div>

        <!-- 후처리 탭 -->
        <div id="tab-postprocessor" class="tab-panel">
            <div class="panel-row">
                <div class="panel-left">
                    <h3>Buckling Curve</h3>
                    <canvas id="buckling-curve-canvas" width="700" height="400"></canvas>
                </div>
                <div class="panel-right">
                    <h3>Mode Shape</h3>
                    <div id="mode-shape-container">
                        <div class="input-row">
                            <label>Length</label>
                            <select id="select-length"></select>
                            <label>Mode</label>
                            <select id="select-mode"></select>
                        </div>
                        <canvas id="mode-shape-canvas" width="400" height="300"></canvas>
                        <h3>3D Mode Shape</h3>
                        <canvas id="mode-shape-3d-canvas" width="500" height="400"></canvas>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}" src="${webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'js', 'charts', 'modeShape3D.js')
        )}"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _dispose(): void {
        CufsmPanel._instance = undefined;
        this._disposed = true;
        this._panel.dispose();
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
