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
import * as os from 'os';
import * as fs from 'fs';
import * as net from 'net';
import * as http from 'http';
import { execSync, exec, execFile } from 'child_process';
import { PythonBridge, PythonStartupError } from './bridge/PythonBridge';
import { StcfsdPanel } from './webview/StcfsdPanel';
import { ProjectExplorerProvider, StcfsdTreeItem } from './webview/ProjectExplorerProvider';
import { McpBridgeServer, bridgeOptionsFromEnv } from './mcp/bridge';
import {
    MCP_SERVER_KEY, buildServerConfig, mergeServerConfig,
    removeServerConfig, inspectRegistration, configPathsForScope,
    type RegisterScope,
} from './mcp/registration';

let pythonBridge: PythonBridge | undefined;
let mcpBridge: McpBridgeServer | undefined;
let mcpPortValue = 0;
let mcpServerPathValue = '';

export async function activate(context: vscode.ExtensionContext) {
    console.log('StCFSD extension activating...');
    const isTestMode = process.env.STCFSD_TEST_MODE === '1';
    // K1: STCFSD_MCP_PORT_FILE 이 있으면(독립 프로그램) 빈 포트 + 토큰 + 포트 파일. 없으면 지금 그대로(52790…, 토큰 없음).
    const portFileOptions = bridgeOptionsFromEnv(process.env);
    // V7-01: 결과를 봉인하는 이 PC 의 기록자 열쇠 폴더. 독립 프로그램은 STCFSD_WRITER_KEY_DIR(프로그램의 사용자 자료 폴더)로 주고,
    // VS Code 확장은 확장의 사용자별 저장 폴더 아래 writer. 시험 모드에서는 시험이 준 것만(진짜 폴더를 쓰지 않는다).
    const keyEnv = process.env.STCFSD_WRITER_KEY_DIR;
    StcfsdPanel.writerKeyDir = keyEnv && path.isAbsolute(keyEnv) ? keyEnv
        : (!isTestMode && context.globalStorageUri ? path.join(context.globalStorageUri.fsPath, 'writer') : null);
    // R1-2: 프로젝트를 두는 뿌리 — STCFSD_PROJECT_ROOTS(절대 경로, path.delimiter 로 여럿) 또는 기본 「문서\StCFSD 프로젝트」(기록 설계 §2.1 · 구성안 결정 6).
    // 기록의 열쇠 자리는 위의 writerKeyDir(봉인과 같은 열쇠). 시험 모드에서는 시험이 준 것만 — 진짜 문서 폴더를 보지 않는다.
    const rootsEnv = (process.env.STCFSD_PROJECT_ROOTS || '').split(path.delimiter).map((r) => r.trim()).filter((r) => r && path.isAbsolute(r));
    StcfsdPanel.projectRoots = rootsEnv.length > 0 ? rootsEnv : (!isTestMode ? [path.join(os.homedir(), 'Documents', 'StCFSD 프로젝트')] : []);
    StcfsdPanel.projectRootsIsDefault = rootsEnv.length === 0 && !isTestMode;

    // Python 환경 자동 검사 + 설치
    // V5-S3: 독립 프로그램(포트 파일 방식)은 묶어 넣은 Python 을 쓴다 — python.org · pip 을 권하지 않는다.
    const pythonPath = getPythonPath(context.extensionPath);
    if (!isTestMode) {
        await checkAndInstallDependencies(context, pythonPath, !!portFileOptions);
    }

    pythonBridge = new PythonBridge(context.extensionPath, pythonPath);
    // R8-17: 엔진 프로세스가 죽거나 다시 시작되면 알린다(다음 호출에서 한 번 다시 띄움).
    pythonBridge.onStatus((kind, message) => {
        if (kind === 'restarted') {
            vscode.window.showInformationMessage(message);
        } else {
            vscode.window.showWarningMessage(message);
        }
    });

    // MCP Bridge 시작 (portFileOptions 는 위에서 — K1)
    const mcpPort = portFileOptions ? 0 : await findAvailablePort(52790);
    mcpBridge = new McpBridgeServer(() => StcfsdPanel.currentPanel || undefined, mcpPort, portFileOptions);
    await mcpBridge.start();
    mcpPortValue = mcpBridge.port;
    mcpServerPathValue = path.join(context.extensionPath, 'media', 'mcp-server.js')
        .replace(/\\/g, '/');

    // .mcp.json 자동 생성 (병합 기반, 기존 설정 보존)
    // V4-19: 시험(STCFSD_TEST_MODE · VS Code 시험 실행)에서는 사용자 설정 파일(.mcp.json · ~/.claude/mcp.json …)을 쓰지 않는다.
    // K1: 포트 파일 방식에서도 쓰지 않는다 — 그 파일들의 고정 포트 · 토큰 없는 항목으로는 이 호스트에 붙을 수 없다.
    if (portFileOptions) {
        console.log(`[StCFSD] port-file mode (${portFileOptions.portFile}) — MCP config files are not written`);
    } else if (!isTestMode && context.extensionMode !== vscode.ExtensionMode.Test) {
        setupMcpConfig(context, mcpPort);
    } else {
        console.log('[StCFSD] test mode — MCP config files are not written');
    }

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
            try { await ensurePythonRunning(); } catch {
                console.warn('[StCFSD] Python not available — panel opens without engine');
            }
            StcfsdPanel.createOrShow(context.extensionUri, pythonBridge!, projectExplorer);
        }),

        vscode.commands.registerCommand('stcfsd.newProject', async () => {
            try { await ensurePythonRunning(); } catch {
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

        vscode.commands.registerCommand('stcfsd.registerMcpServer', async () => {
            await runMcpRegister(context);
        }),

        vscode.commands.registerCommand('stcfsd.unregisterMcpServer', async () => {
            await runMcpUnregister();
        }),

        vscode.commands.registerCommand('stcfsd.showMcpStatus', async () => {
            await runMcpStatus();
        }),
    );

    // Step 4: 트리 아이템 클릭 → WebView 네비게이션
    treeView.onDidChangeSelection(async e => {
        if (e.selection.length === 0) { return; }
        const item = e.selection[0] as StcfsdTreeItem;
        const sectionId = item.sectionId;
        if (!sectionId) { return; }

        // 'mcp-server' → 자식 명령 실행용 컨테이너, 패널 네비게이션 없음
        if (sectionId === 'mcp-server') { return; }

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
            } catch {
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
/** V5-S3 · 독립 프로그램의 문구 — 묶어 넣은 Python(embeddable, pip 없음)이 망가졌으면 다시 설치가 답이다. */
export const STANDALONE_PYTHON_BROKEN = (pythonPath: string) =>
    `StCFSD: 프로그램에 들어 있는 해석 엔진(Python)을 실행할 수 없습니다 (${pythonPath}). `
    + '백신 프로그램이 파일을 격리했거나 설치가 손상됐을 수 있습니다. StCFSD 를 다시 설치하세요.';
export const STANDALONE_PACKAGES_BROKEN = (missing: string[]) =>
    `StCFSD: 해석 엔진에 필요한 구성 요소(${missing.join(', ')})를 불러올 수 없습니다. `
    + '백신 프로그램이 파일을 격리했거나 설치가 손상됐을 수 있습니다. StCFSD 를 다시 설치하세요.';

// V5-S3: 시험이 부를 수 있게 내보낸다(동작은 그대로 — standalone 이 false 면 전과 같은 길).
export async function checkAndInstallDependencies(
    context: vscode.ExtensionContext, pythonPath: string, standalone = false
): Promise<void> {
    // 1) Python 존재 여부 확인
    let hasPython = false;
    try {
        execSync(`"${pythonPath}" --version`, { stdio: 'pipe', timeout: 10000 });
        hasPython = true;
        console.log(`[StCFSD] Python found: ${pythonPath}`);
    } catch {
        console.warn(`[StCFSD] Python not found at: ${pythonPath}`);
    }

    if (!hasPython && standalone) {
        // 단추 없이 알리고 기다리지 않는다 — 활성화(= MCP 다리 · 포트 파일)를 알림 상자 뒤에 세우지 않는다.
        void vscode.window.showErrorMessage(STANDALONE_PYTHON_BROKEN(pythonPath));
        return;
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
    const missingPackages: string[] = [];
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
    if (standalone) {
        // embeddable Python 에는 pip 이 없다 — 설치를 묻지 않는다.
        void vscode.window.showErrorMessage(STANDALONE_PACKAGES_BROKEN(missingPackages));
        return;
    }

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
            // R8-21: selftest 가 파이썬 버전·엔진 import 를 확인한다. 그 문장을 그대로 보인다.
            const detail = err instanceof PythonStartupError
                ? err.message
                : `StCFSD: Failed to start Python engine (${pythonBridge.pythonPath}). ` +
                  `Ensure Python 3.10+ is installed with numpy and scipy.\n${err.message}`;
            vscode.window.showErrorMessage(detail);
            throw err;
        }
    }
}

function _mergeIntoFile(filePath: string, key: string, config: { command: string; args: string[]; env: Record<string, string> }): string {
    let existing: string | undefined;
    if (fs.existsSync(filePath)) {
        existing = fs.readFileSync(filePath, 'utf-8');
    }
    const merged = mergeServerConfig(existing, key, config);
    if (!merged.ok) {
        throw new Error(`${filePath}: ${merged.error}`);
    }
    // R8-22 (W2 후속 2): 내용이 같으면 쓰지 않는다 — 활성화마다 사용자 설정 파일의 mtime 을 바꾸지 않게.
    if (!merged.changed && existing !== undefined) { return 'unchanged'; }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(filePath, merged.text);
    return merged.changed ? 'updated' : 'unchanged';
}

function _workspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return (folders && folders.length > 0) ? folders[0].uri.fsPath : undefined;
}

function _homeDir(): string {
    return process.env.USERPROFILE || process.env.HOME || '';
}

function setupMcpConfig(context: vscode.ExtensionContext, port: number): void {
    const serverPath = mcpServerPathValue
        || path.join(context.extensionPath, 'media', 'mcp-server.js').replace(/\\/g, '/');
    const config = buildServerConfig(serverPath, port);

    // 1) 워크스페이스 폴더에 병합 쓰기 (기존 서버 보존 — 덮어쓰기 금지)
    _writeMcpToWorkspace(config);

    // 2) 워크스페이스 변경 시 다시 쓰기
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        _writeMcpToWorkspace(config);
    }));

    // 3) Extension 설치 디렉토리 자체에도 쓰기 (폴백)
    try {
        const extMcpPath = path.join(context.extensionPath, '.mcp.json');
        _mergeIntoFile(extMcpPath, MCP_SERVER_KEY, config);
        console.log(`[StCFSD] MCP config (extension dir): ${extMcpPath}`);
    } catch {
        // 무시
    }

    // 4) 사용자 홈 디렉토리 — Claude Code 글로벌 설정 (병합)
    try {
        const homeDir = _homeDir();
        if (homeDir) {
            const claudeMcpPath = path.join(homeDir, '.claude', 'mcp.json');
            _mergeIntoFile(claudeMcpPath, MCP_SERVER_KEY, config);
            console.log(`[StCFSD] Claude global MCP: ${claudeMcpPath}`);
        }
    } catch (err) {
        console.warn('[StCFSD] Failed to write global MCP config:', err);
    }

    console.log(`[StCFSD] MCP server path: ${serverPath}`);
    console.log(`[StCFSD] MCP bridge port: ${port}`);
}

// ============================================================
// 로컬 MCP 서버 등록/해제/상태 명령
// ============================================================

function _checkBridgeStatus(port: number, timeoutMs = 3000): Promise<{ ok: boolean; detail: string }> {
    return new Promise((resolve) => {
        const req = http.get(
            { host: '127.0.0.1', port, path: '/status', timeout: timeoutMs },
            (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    resolve({ ok: res.statusCode === 200, detail: `HTTP ${res.statusCode} ${body.slice(0, 200)}` });
                });
            }
        );
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, detail: 'timeout' }); });
        req.on('error', (e: any) => { resolve({ ok: false, detail: e.message }); });
    });
}

function _checkNode(): Promise<{ ok: boolean; detail: string }> {
    return new Promise((resolve) => {
        execFile('node', ['--version'], { timeout: 5000 }, (err, stdout) => {
            if (err) { resolve({ ok: false, detail: 'PATH에 node 없음' }); return; }
            resolve({ ok: true, detail: String(stdout).trim() });
        });
    });
}

async function runMcpRegister(context: vscode.ExtensionContext): Promise<void> {
    const scopePick = await vscode.window.showQuickPick(
        [
            { label: '워크스페이스 + 글로벌', description: '권장', scope: 'both' as RegisterScope },
            { label: '워크스페이스만', description: '.mcp.json + .claude/mcp.json', scope: 'workspace' as RegisterScope },
            { label: '글로벌만', description: '~/.claude/mcp.json (Claude Code)', scope: 'global' as RegisterScope },
        ],
        { placeHolder: 'MCP 서버 등록 범위 선택' }
    );
    if (!scopePick) { return; }

    const serverPath = mcpServerPathValue
        || path.join(context.extensionPath, 'media', 'mcp-server.js').replace(/\\/g, '/');
    const port = mcpPortValue;
    if (!port) {
        vscode.window.showErrorMessage('StCFSD: MCP 브릿지가 시작되지 않았습니다. 확장을 다시 로드하세요.');
        return;
    }
    const config = buildServerConfig(serverPath, port);
    const targets = configPathsForScope(scopePick.scope, {
        workspaceRoot: _workspaceRoot(), homeDir: _homeDir(),
    });
    if (targets.length === 0) {
        vscode.window.showWarningMessage('StCFSD: 열린 워크스페이스가 없어 워크스페이스 등록을 건너뜁니다. 글로벌을 선택하세요.');
        return;
    }

    const results: string[] = [];
    for (const target of targets) {
        try {
            const state = _mergeIntoFile(target, MCP_SERVER_KEY, config);
            results.push(`✓ ${target} (${state === 'updated' ? '등록됨' : '이미 등록됨'})`);
        } catch (err: any) {
            results.push(`✗ ${target} (${err.message})`);
        }
    }

    // 검증: 번들·node·브릿지
    const bundleOk = fs.existsSync(path.join(context.extensionPath, 'media', 'mcp-server.js'));
    results.push(bundleOk ? '✓ MCP 서버 번들 존재' : '✗ MCP 서버 번들 없음 (media/mcp-server.js) — npm run build:mcp 필요');
    const nodeCheck = await _checkNode();
    results.push(`${nodeCheck.ok ? '✓' : '✗'} node: ${nodeCheck.detail}`);
    const bridgeCheck = await _checkBridgeStatus(port);
    results.push(`${bridgeCheck.ok ? '✓' : '✗'} 브릿지(127.0.0.1:${port}): ${bridgeCheck.detail}`);
    results.push('다음: MCP 클라이언트(Claude Code 등)를 재시작하면 stcfsd-section-designer가 나타납니다.');

    vscode.window.showInformationMessage(
        `StCFSD MCP 등록 완료 (포트 ${port})`, { modal: true, detail: results.join('\n') }, '상태 보기'
    ).then((action) => {
        if (action === '상태 보기') { runMcpStatus(); }
    });
}

async function runMcpUnregister(): Promise<void> {
    const confirm = await vscode.window.showQuickPick(['해제한다', '취소'], {
        placeHolder: '워크스페이스·글로벌 설정에서 stcfsd-section-designer를 제거합니다 (다른 서버는 유지)',
    });
    if (!confirm || confirm === '취소') { return; }

    const targets = configPathsForScope('both', {
        workspaceRoot: _workspaceRoot(), homeDir: _homeDir(),
    });
    const results: string[] = [];
    for (const target of targets) {
        try {
            if (!fs.existsSync(target)) {
                results.push(`- ${target} (파일 없음)`);
                continue;
            }
            const removed = removeServerConfig(fs.readFileSync(target, 'utf-8'), MCP_SERVER_KEY);
            if (!removed.ok) {
                results.push(`✗ ${target} (${removed.error})`);
                continue;
            }
            if (removed.removed) {
                fs.writeFileSync(target, removed.text);
                results.push(`✓ ${target} (제거됨)`);
            } else {
                results.push(`- ${target} (등록 안 됨)`);
            }
        } catch (err: any) {
            results.push(`✗ ${target} (${err.message})`);
        }
    }
    vscode.window.showInformationMessage('StCFSD MCP 등록 해제', { modal: true, detail: results.join('\n') });
}

async function runMcpStatus(): Promise<void> {
    const lines: string[] = [
        `브릿지 포트: ${mcpPortValue || '(미시작)'}`,
        `서버 번들: ${mcpServerPathValue || '(미확인)'} ${mcpServerPathValue && fs.existsSync(mcpServerPathValue) ? '✓' : '✗'}`,
    ];
    const targets = configPathsForScope('both', {
        workspaceRoot: _workspaceRoot(), homeDir: _homeDir(),
    });
    if (targets.length === 0) {
        lines.push('열린 워크스페이스 없음 — 글로벌만 표시');
        configPathsForScope('global', { homeDir: _homeDir() })
            .forEach((t) => targets.push(t));
    }
    for (const target of targets) {
        const text = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : undefined;
        const st = inspectRegistration(target, text, MCP_SERVER_KEY);
        if (!st.exists) { lines.push(`- ${target}: 파일 없음`); }
        else if (st.error) { lines.push(`✗ ${target}: ${st.error}`); }
        else if (!st.registered) { lines.push(`- ${target}: 미등록`); }
        else {
            const portOk = st.port === String(mcpPortValue);
            lines.push(`${portOk ? '✓' : '!'} ${target}: 등록됨 (포트 ${st.port || '?'})${portOk ? '' : ' — 현재 포트와 다름, 재등록 권장'}`);
        }
    }
    if (mcpPortValue) {
        const bridgeCheck = await _checkBridgeStatus(mcpPortValue);
        lines.push(`${bridgeCheck.ok ? '✓' : '✗'} 브릿지: ${bridgeCheck.detail}`);
    }
    vscode.window.showInformationMessage('StCFSD MCP 상태', { modal: true, detail: lines.join('\n') });
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

function _writeMcpToWorkspace(config: { command: string; args: string[]; env: Record<string, string> }): void {
    const wsRoot = _workspaceRoot();
    if (!wsRoot) {
        console.log('[StCFSD] No workspace folder — .mcp.json not written to workspace');
        return;
    }
    for (const target of [path.join(wsRoot, '.mcp.json'), path.join(wsRoot, '.claude', 'mcp.json')]) {
        try {
            // 병합 쓰기 — 기존 파일의 다른 서버 설정을 보존한다
            _mergeIntoFile(target, MCP_SERVER_KEY, config);
        } catch (err) {
            console.warn(`[StCFSD] Failed to write MCP to ${target}:`, err);
        }
    }
    console.log(`[StCFSD] MCP config merged into workspace: ${wsRoot}`);
}

function getPythonPath(extensionPath: string): string {
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
