/**
 * CUFSM VS Code Extension 진입점
 *
 * 참조: 컨버전전략.md §2 전체 아키텍처, §8 package.json
 */

import * as vscode from 'vscode';
import { PythonBridge } from './bridge/PythonBridge';
import { CufsmPanel } from './webview/CufsmPanel';
import { ProjectExplorerProvider } from './webview/ProjectExplorerProvider';

let pythonBridge: PythonBridge | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('CUFSM extension activating...');

    // Python 경로 탐지
    const pythonPath = getPythonPath();

    // PythonBridge 초기화
    pythonBridge = new PythonBridge(context.extensionPath, pythonPath);

    // 프로젝트 탐색기 등록
    const projectExplorer = new ProjectExplorerProvider();
    vscode.window.registerTreeDataProvider('cufsm.projectExplorer', projectExplorer);

    // 커맨드 등록
    context.subscriptions.push(
        vscode.commands.registerCommand('cufsm.openDesigner', async () => {
            try {
                if (!pythonBridge!.isRunning) {
                    await pythonBridge!.start();
                }
                CufsmPanel.createOrShow(context.extensionUri, pythonBridge!);
            } catch (err: any) {
                vscode.window.showErrorMessage(
                    `CUFSM: Failed to start Python engine. ` +
                    `Ensure Python is installed with numpy and scipy.\n${err.message}`
                );
            }
        }),
        vscode.commands.registerCommand('cufsm.newProject', () => {
            vscode.window.showInformationMessage('CUFSM: New Project - Coming soon');
        }),
        vscode.commands.registerCommand('cufsm.refreshProjects', () => {
            projectExplorer.refresh();
        })
    );
}

export function deactivate() {
    pythonBridge?.dispose();
}

/** Python 경로 탐지 */
function getPythonPath(): string {
    // VS Code Python 확장이 설정한 경로 시도
    const config = vscode.workspace.getConfiguration('python');
    const configPath = config.get<string>('defaultInterpreterPath');
    if (configPath) {
        return configPath;
    }
    // 기본값
    return process.platform === 'win32' ? 'python' : 'python3';
}
