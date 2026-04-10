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
import * as net from 'net';
import { PythonBridge } from './bridge/PythonBridge';
import { StcfsdPanel } from './webview/StcfsdPanel';
import { ProjectExplorerProvider, StcfsdTreeItem } from './webview/ProjectExplorerProvider';
import { McpBridgeServer } from './mcp/bridge';

let pythonBridge: PythonBridge | undefined;
let mcpBridge: McpBridgeServer | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('StCFSD extension activating...');
    const isTestMode = process.env.STCFSD_TEST_MODE === '1';

    // Python 환경 자동 검사 + 설치
    const pythonPath = getPythonPath(context.extensionPath);
    if (!isTestMode) {
        await checkAndInstallDependencies(context, pythonPath);
    }

    pythonBridge = new PythonBridge(context.extensionPath, pythonPath);

    // MCP Bridge 시작
    const mcpPort = await findAvailablePort(52790);
    mcpBridge = new McpBridgeServer(() => StcfsdPanel.currentPanel || undefined, mcpPort);
    await mcpBridge.start();

    // .mcp.json 자동 생성
    setupMcpConfig(context, mcpPort);

    // Step 1: 트리 프로바이더 생성
    const projectExplorer = new ProjectExplorerProvider();

    // Step 2: 트리뷰 등록
    const treeView = vscode.window.createTreeView('stcfsd.projectExplorer', {
        treeDataProvider: projectExplorer,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // Step 3: 커맨드 등록
    context.subscriptions.push(
        vscode.commands.registerCommand('stcfsd.openDesigner', async () => {
            try { await ensurePythonRunning(); } catch (e) {
                console.warn('[StCFSD] Python not available — panel opens without engine');
            }
            StcfsdPanel.createOrShow(context.extensionUri, pythonBridge!, projectExplorer);
        }),

        vscode.commands.registerCommand('stcfsd.newProject', async () => {
            try { await ensurePythonRunning(); } catch (e) {
                console.warn('[StCFSD] Python not available — panel opens without engine');
            }
            StcfsdPanel.createOrShow(context.extensionUri, pythonBridge!, projectExplorer);
        }),

        vscode.commands.registerCommand('stcfsd.navigateSection', (sectionId: string) => {
            if (StcfsdPanel.currentPanel) {
                StcfsdPanel.currentPanel.showSection(sectionId);
            }
        }),

        vscode.commands.registerCommand('stcfsd.refreshProjects', () => {
            projectExplorer.refresh();
        }),

        vscode.commands.registerCommand('stcfsd.runAnalysis', () => {
            if (StcfsdPanel.currentPanel) {
                StcfsdPanel.currentPanel.showSection('run-analysis');
            }
        }),
    );

    // Step 4: 트리 아이템 클릭 → WebView 네비게이션
    treeView.onDidChangeSelection(async e => {
        if (e.selection.length === 0) { return; }
        const item = e.selection[0] as StcfsdTreeItem;
        const sectionId = item.sectionId;
        if (!sectionId) { return; }

        // 'open-designer' → 패널 열기
        if (sectionId === 'open-designer') {
            vscode.commands.executeCommand('stcfsd.openDesigner');
            return;
        }

        // 패널이 없으면 먼저 생성
        const panelExisted = !!StcfsdPanel.currentPanel;
        if (!panelExisted) {
            try {
                await ensurePythonRunning();
                StcfsdPanel.createOrShow(context.extensionUri, pythonBridge!, projectExplorer);
                // WebView 초기화 대기 후 섹션 이동
                setTimeout(() => {
                    if (StcfsdPanel.currentPanel) {
                        StcfsdPanel.currentPanel.showSection(sectionId);
                    }
                }, 800);
            } catch (err) {
                console.error(`[StCFSD] Tree navigation blocked while starting Python for section ${sectionId}`);
            }
        } else {
            StcfsdPanel.currentPanel!.showSection(sectionId);
        }
    });

    // 초기 트리 데이터 (빈 상태)
    projectExplorer.updateProjectData(null);
}

export function deactivate() {
    mcpBridge?.stop();
    pythonBridge?.dispose();
}

// ============================================================
// Python 의존성 자동 검사 + 설치
// ============================================================
async function checkAndInstallDependencies(
    context: vscode.ExtensionContext, pythonPath: string
): Promise<void> {
    const { execSync, exec } = require('child_process');

    // 1) Python 존재 여부 확인
    let hasPython = false;
    try {
        execSync(`"${pythonPath}" --version`, { stdio: 'pipe', timeout: 10000 });
        hasPython = true;
        console.log(`[StCFSD] Python found: ${pythonPath}`);
    } catch {
        console.warn(`[StCFSD] Python not found at: ${pythonPath}`);
    }

    if (!hasPython) {
        const action = await vscode.window.showWarningMessage(
            'StCFSD: Python을 찾을 수 없습니다. 해석 엔진을 사용하려면 Python 3.10+ 설치가 필요합니다.',
            'Python 다운로드 페이지 열기',
            '무시'
        );
        if (action === 'Python 다운로드 페이지 열기') {
            vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
        }
        return;
    }

    // 2) numpy / scipy 설치 여부 확인
    let missingPackages: string[] = [];
    for (const pkg of ['numpy', 'scipy']) {
        try {
            execSync(`"${pythonPath}" -c "import ${pkg}"`, { stdio: 'pipe', timeout: 10000 });
        } catch {
            missingPackages.push(pkg);
        }
    }

    if (missingPackages.length === 0) {
        console.log('[StCFSD] All Python dependencies OK');
        return;
    }

    console.warn(`[StCFSD] Missing packages: ${missingPackages.join(', ')}`);

    // 3) 사용자에게 설치 여부 질문
    const install = await vscode.window.showWarningMessage(
        `StCFSD: 필수 Python 패키지가 없습니다: ${missingPackages.join(', ')}. 자동 설치하시겠습니까?`,
        '설치',
        '나중에'
    );

    if (install !== '설치') {
        return;
    }

    // 4) 터미널에서 pip install 실행
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'StCFSD: Python 패키지 설치 중...',
            cancellable: false,
        },
        async (progress) => {
            const pkgList = missingPackages.join(' ');
            progress.report({ message: pkgList });

            return new Promise<void>((resolve) => {
                exec(
                    `"${pythonPath}" -m pip install ${pkgList}`,
                    { timeout: 300000 },
                    (error: any, stdout: string, stderr: string) => {
                        if (error) {
                            console.error('[StCFSD] pip install failed:', stderr);
                            vscode.window.showErrorMessage(
                                `StCFSD: 패키지 설치 실패. 수동으로 실행하세요:\n` +
                                `${pythonPath} -m pip install ${pkgList}`
                            );
                        } else {
                            console.log('[StCFSD] pip install success:', stdout.trim());
                            vscode.window.showInformationMessage(
                                `StCFSD: ${pkgList} 설치 완료!`
                            );
                        }
                        resolve();
                    }
                );
            });
        }
    );
}

async function ensurePythonRunning(): Promise<void> {
    if (!pythonBridge) { return; }
    if (!pythonBridge.isRunning) {
        try {
            await pythonBridge.start();
        } catch (err: any) {
            vscode.window.showErrorMessage(
                `StCFSD: Failed to start Python engine. ` +
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
        env: { STCFSD_MCP_PORT: String(port) }
    };

    const mcpJson = JSON.stringify({ mcpServers: { "stcfsd-section-designer": mcpServerConfig } }, null, 2);

    // 1) 워크스페이스 폴더에 .mcp.json 쓰기
    _writeMcpToWorkspace(mcpJson);

    // 2) 워크스페이스 변경 시 다시 쓰기
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        _writeMcpToWorkspace(mcpJson);
    }));

    // 3) Extension 설치 디렉토리 자체에도 쓰기 (폴백)
    try {
        const extMcpPath = path.join(context.extensionPath, '.mcp.json');
        fs.writeFileSync(extMcpPath, mcpJson);
        console.log(`[StCFSD] MCP config (extension dir): ${extMcpPath}`);
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
            existing.mcpServers['stcfsd-section-designer'] = mcpServerConfig;
            fs.writeFileSync(claudeMcpPath, JSON.stringify(existing, null, 2));
            console.log(`[StCFSD] Claude global MCP: ${claudeMcpPath}`);
        }
    } catch (err) {
        console.warn('[StCFSD] Failed to write global MCP config:', err);
    }

    console.log(`[StCFSD] MCP server path: ${serverPath}`);
    console.log(`[StCFSD] MCP bridge port: ${port}`);
}

async function findAvailablePort(preferredPort: number, maxAttempts: number = 20): Promise<number> {
    for (let offset = 0; offset < maxAttempts; offset++) {
        const candidate = preferredPort + offset;
        const isFree = await new Promise<boolean>((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => {
                server.close(() => resolve(true));
            });
            server.listen(candidate, '127.0.0.1');
        });

        if (isFree) {
            if (candidate !== preferredPort) {
                console.warn(`[StCFSD] Preferred MCP port ${preferredPort} unavailable, using ${candidate}`);
            }
            return candidate;
        }
    }

    throw new Error(`StCFSD: failed to reserve an MCP bridge port near ${preferredPort}`);
}

function _writeMcpToWorkspace(mcpJson: string): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        console.log('[StCFSD] No workspace folder — .mcp.json not written to workspace');
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
        console.log(`[StCFSD] MCP config written to workspace: ${wsRoot}`);
    } catch (err) {
        console.warn(`[StCFSD] Failed to write MCP to workspace ${wsRoot}:`, err);
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
            console.log(`[StCFSD] Using project venv: ${venvPath}`);
            return venvPath;
        }
    }

    // 2) VS Code Python 확장 설정
    const pyConfig = vscode.workspace.getConfiguration('python');
    const pyPath = pyConfig.get<string>('defaultInterpreterPath');
    if (pyPath && pyPath !== 'python') {
        console.log(`[StCFSD] Using python.defaultInterpreterPath: ${pyPath}`);
        return pyPath;
    }

    // 3) 기본
    const fallback = process.platform === 'win32' ? 'python' : 'python3';
    console.log(`[StCFSD] Using fallback: ${fallback}`);
    return fallback;
}
