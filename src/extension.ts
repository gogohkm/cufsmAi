/**
 * CUFSM VS Code Extension 진입점
 *
 * epvscode 패턴 따름:
 * - createTreeView로 사이드바 트리뷰 등록
 * - onDidChangeSelection으로 트리 클릭 → WebView 네비게이션
 * - 커맨드 등록 (openDesigner, navigateSection, runAnalysis 등)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PythonBridge } from './bridge/PythonBridge';
import { CufsmPanel } from './webview/CufsmPanel';
import { ProjectExplorerProvider, CufsmTreeItem } from './webview/ProjectExplorerProvider';
import { McpBridgeServer } from './mcp/bridge';

let pythonBridge: PythonBridge | undefined;
let mcpBridge: McpBridgeServer | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('CUFSM extension activating...');

    const pythonPath = getPythonPath(context.extensionPath);
    pythonBridge = new PythonBridge(context.extensionPath, pythonPath);

    // MCP Bridge 시작
    const mcpPort = 52790;
    mcpBridge = new McpBridgeServer(() => CufsmPanel.currentPanel || undefined, mcpPort);
    mcpBridge.start();

    // .mcp.json 자동 생성
    setupMcpConfig(context, mcpPort);

    // Step 1: 트리 프로바이더 생성
    const projectExplorer = new ProjectExplorerProvider();

    // Step 2: 트리뷰 등록
    const treeView = vscode.window.createTreeView('cufsm.projectExplorer', {
        treeDataProvider: projectExplorer,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // Step 3: 커맨드 등록
    context.subscriptions.push(
        vscode.commands.registerCommand('cufsm.openDesigner', async () => {
            try {
                await ensurePythonRunning();
            } catch (e) {
                // Python 실패해도 패널은 열기 (에러는 WebView에 표시)
                console.error('[CUFSM] Python start failed, opening panel anyway');
            }
            CufsmPanel.createOrShow(context.extensionUri, pythonBridge!, projectExplorer);
        }),

        vscode.commands.registerCommand('cufsm.newProject', async () => {
            try {
                await ensurePythonRunning();
            } catch (e) {
                console.error('[CUFSM] Python start failed');
            }
            CufsmPanel.createOrShow(context.extensionUri, pythonBridge!, projectExplorer);
        }),

        vscode.commands.registerCommand('cufsm.navigateSection', (sectionId: string) => {
            if (CufsmPanel.currentPanel) {
                CufsmPanel.currentPanel.showSection(sectionId);
            }
        }),

        vscode.commands.registerCommand('cufsm.refreshProjects', () => {
            projectExplorer.refresh();
        }),

        vscode.commands.registerCommand('cufsm.runAnalysis', () => {
            if (CufsmPanel.currentPanel) {
                CufsmPanel.currentPanel.showSection('run-analysis');
            }
        }),
    );

    // Step 4: 트리 아이템 클릭 → WebView 네비게이션
    treeView.onDidChangeSelection(e => {
        if (e.selection.length === 0) { return; }
        const item = e.selection[0] as CufsmTreeItem;
        const sectionId = item.sectionId;
        if (!sectionId) { return; }

        // 'open-designer' → 패널 열기
        if (sectionId === 'open-designer') {
            vscode.commands.executeCommand('cufsm.openDesigner');
            return;
        }

        // 패널이 없으면 먼저 생성
        const panelExisted = !!CufsmPanel.currentPanel;
        if (!panelExisted) {
            ensurePythonRunning().then(() => {
                CufsmPanel.createOrShow(context.extensionUri, pythonBridge!, projectExplorer);
                // WebView 초기화 대기 후 섹션 이동
                setTimeout(() => {
                    if (CufsmPanel.currentPanel) {
                        CufsmPanel.currentPanel.showSection(sectionId);
                    }
                }, 800);
            });
        } else {
            CufsmPanel.currentPanel!.showSection(sectionId);
        }
    });

    // 초기 트리 데이터 (빈 상태)
    projectExplorer.updateProjectData(null);
}

export function deactivate() {
    mcpBridge?.stop();
    pythonBridge?.dispose();
}

async function ensurePythonRunning(): Promise<void> {
    if (!pythonBridge) { return; }
    if (!pythonBridge.isRunning) {
        try {
            await pythonBridge.start();
        } catch (err: any) {
            vscode.window.showErrorMessage(
                `CUFSM: Failed to start Python engine. ` +
                `Ensure Python is installed with numpy and scipy.\n${err.message}`
            );
            throw err;
        }
    }
}

function setupMcpConfig(context: vscode.ExtensionContext, port: number): void {
    const serverPath = path.join(context.extensionPath, 'media', 'mcp-server.js')
        .replace(/\\/g, '/');

    const mcpServerConfig = {
        command: "node",
        args: [serverPath],
        env: { CUFSM_MCP_PORT: String(port) }
    };

    const mcpJson = JSON.stringify({ mcpServers: { "cufsm-section-designer": mcpServerConfig } }, null, 2);

    // 1) 워크스페이스 폴더에 .mcp.json 쓰기
    _writeMcpToWorkspace(mcpJson);

    // 2) 워크스페이스 변경 시 다시 쓰기
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
        _writeMcpToWorkspace(mcpJson);
    });

    // 3) Extension 설치 디렉토리 자체에도 쓰기 (폴백)
    try {
        const extMcpPath = path.join(context.extensionPath, '.mcp.json');
        fs.writeFileSync(extMcpPath, mcpJson);
        console.log(`[CUFSM] MCP config (extension dir): ${extMcpPath}`);
    } catch (err) {
        // 무시
    }

    // 4) 사용자 홈 디렉토리 — Claude Code 글로벌 설정
    try {
        const homeDir = process.env.USERPROFILE || process.env.HOME || '';
        if (homeDir) {
            // ~/.claude/mcp.json (Claude Code 글로벌)
            const claudeDir = path.join(homeDir, '.claude');
            if (!fs.existsSync(claudeDir)) { fs.mkdirSync(claudeDir, { recursive: true }); }
            const claudeMcpPath = path.join(claudeDir, 'mcp.json');
            // 기존 설정 병합
            let existing: any = {};
            if (fs.existsSync(claudeMcpPath)) {
                try { existing = JSON.parse(fs.readFileSync(claudeMcpPath, 'utf-8')); } catch {}
            }
            if (!existing.mcpServers) { existing.mcpServers = {}; }
            existing.mcpServers['cufsm-section-designer'] = mcpServerConfig;
            fs.writeFileSync(claudeMcpPath, JSON.stringify(existing, null, 2));
            console.log(`[CUFSM] Claude global MCP: ${claudeMcpPath}`);
        }
    } catch (err) {
        console.warn('[CUFSM] Failed to write global MCP config:', err);
    }

    console.log(`[CUFSM] MCP server path: ${serverPath}`);
    console.log(`[CUFSM] MCP bridge port: ${port}`);
}

function _writeMcpToWorkspace(mcpJson: string): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        console.log('[CUFSM] No workspace folder — .mcp.json not written to workspace');
        return;
    }
    const wsRoot = folders[0].uri.fsPath;
    try {
        // .mcp.json
        fs.writeFileSync(path.join(wsRoot, '.mcp.json'), mcpJson);
        // .claude/mcp.json
        const claudeDir = path.join(wsRoot, '.claude');
        if (!fs.existsSync(claudeDir)) { fs.mkdirSync(claudeDir, { recursive: true }); }
        fs.writeFileSync(path.join(claudeDir, 'mcp.json'), mcpJson);
        console.log(`[CUFSM] MCP config written to workspace: ${wsRoot}`);
    } catch (err) {
        console.warn(`[CUFSM] Failed to write MCP to workspace ${wsRoot}:`, err);
    }
}

function getPythonPath(extensionPath: string): string {
    const fs = require('fs');
    const path = require('path');

    // 1) Extension 디렉토리 내 .venv 확인 (최우선)
    const venvCandidates = [
        path.join(extensionPath, '.venv', 'Scripts', 'python.exe'),  // Windows
        path.join(extensionPath, '.venv', 'bin', 'python'),          // Mac/Linux
    ];
    for (const venvPath of venvCandidates) {
        if (fs.existsSync(venvPath)) {
            console.log(`[CUFSM] Using project venv: ${venvPath}`);
            return venvPath;
        }
    }

    // 2) VS Code Python 확장 설정
    const pyConfig = vscode.workspace.getConfiguration('python');
    const pyPath = pyConfig.get<string>('defaultInterpreterPath');
    if (pyPath && pyPath !== 'python') {
        console.log(`[CUFSM] Using python.defaultInterpreterPath: ${pyPath}`);
        return pyPath;
    }

    // 3) 기본
    const fallback = process.platform === 'win32' ? 'python' : 'python3';
    console.log(`[CUFSM] Using fallback: ${fallback}`);
    return fallback;
}
