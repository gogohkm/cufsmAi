/**
 * CUFSM VS Code Extension 진입점
 *
 * epvscode 패턴 따름:
 * - createTreeView로 사이드바 트리뷰 등록
 * - onDidChangeSelection으로 트리 클릭 → WebView 네비게이션
 * - 커맨드 등록 (openDesigner, navigateSection, runAnalysis 등)
 */

import * as vscode from 'vscode';
import { PythonBridge } from './bridge/PythonBridge';
import { CufsmPanel } from './webview/CufsmPanel';
import { ProjectExplorerProvider, CufsmTreeItem } from './webview/ProjectExplorerProvider';

let pythonBridge: PythonBridge | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('CUFSM extension activating...');

    const pythonPath = getPythonPath(context.extensionPath);
    pythonBridge = new PythonBridge(context.extensionPath, pythonPath);

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
