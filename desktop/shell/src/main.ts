/**
 * StCFSD 독립 프로그램 — Electron 주 프로세스(S3). (StAnal `desktop/shell/src/main.ts` 를 옮겨 StCFSD 에 맞춤)
 *
 * 순서: 인자 · 사용자 폴더 → 단일 인스턴스 잠금 → 로그 → 파일 · Python 확인 → 자식 콘솔 숨김
 *       → 플랫폼(`createBridgePlatform` + OS 대화상자) → `startHost`(같은 프로세스) → `startBridge` → 창.
 * 하나라도 실패하면 무엇이 실패했는지와 로그 파일 경로를 적은 오류 창을 띄우고 끝낸다.
 *
 * 지키는 것:
 *  - 인증은 쿠키에 기대지 않는다. 창의 세션(저장하지 않는 partition)이 다리 출처로 보내는 모든 요청에
 *    `Authorization: Bearer <다리 토큰>` 을 붙인다. 창에는 토큰 없는 주소(`/`, `--ui` 면 새 검토 화면 `/ui/`)를 싣는다.
 *  - 포커스를 가져가지 않는다. 창을 보이는 것은 처음 뜰 때와 사용자가 프로그램을 다시 실행했을 때(second-instance)뿐이다.
 *    호스트의 물음은 창을 앞으로 꺼내지 않는다 — 제목(「● 응답 필요」, 틀이 쓴다)과 작업 표시줄 깜빡임(`flashFrame`)으로만 알린다.
 *  - 다리 출처가 아닌 곳으로 이동 · 새 창 · 네트워크 요청은 막는다. http/https 링크는 OS 브라우저로.
 *  - 닫을 때 「저장하지 않은 변경」은 묻지 않는다 — 호스트(StcfsdPanel)는 고친 표시를 내놓지 않고, 설계 탭 입력은
 *    웹뷰에만 있다(K2 전). 알 수 없는 것을 매번 묻지 않는다(README).
 *
 * 시험 모드(`STCFSD_SHELL_TEST=1`): 창을 보이지 않고(show:false, 한 번도 show · focus 하지 않는다), 대화상자는 기본으로
 * "취소"를 돌려주는 가짜로 바꾼다. 부모가 IPC 로 띄웠으면 주 프로세스 안에서 코드를 돌리는 제어 통로를 연다(시험만).
 */
import { app, BrowserWindow, dialog, Menu, screen, session, shell, type MenuItemConstructorOptions } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as HostApi from '../../host/src/index';
import { parseArgs } from './args';
import { createLogger, type ShellLogger } from './log';
import { findPython, missingFiles, resolveLayout, type Layout } from './layout';
import { hideChildConsoles } from './winConsole';
import { placeWindow, readWindowState, writeWindowState, type Placement } from './windowState';

const TEST = process.env.STCFSD_SHELL_TEST === '1';
const DEV = !app.isPackaged;
const IS_WIN = process.platform === 'win32';
const VERSION = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).version ?? ''); }
  catch { return ''; }
})();

// ─── 준비되기 전에 정할 것 ───────────────────────────────────────────
const args = parseArgs(process.argv, process.cwd(), Boolean(process.defaultApp));
app.setName('StCFSD');
// 사용자 폴더: 기본 %APPDATA%\StCFSD. 시험 · 개발은 --user-data. 로그 · 창 위치 · 호스트 설정 · MCP 포트 파일이 여기 있다.
const userData = args.userData ?? path.join(app.getPath('appData'), 'StCFSD');
app.setPath('userData', userData);
// Chromium 의 자기 파일(캐시 · Local State · 충돌 기록)도 이 폴더 안에 몰아 둔다.
app.setPath('sessionData', path.join(userData, 'chromium'));
app.setPath('crashDumps', path.join(userData, 'crashes'));
app.setAppLogsPath(path.join(userData, 'logs'));
app.enableSandbox();
/** MCP 포트 파일 — 실제 실행이면 표준 자리 %APPDATA%\StCFSD\mcp\stcfsd-mcp-port(= K1 standardPortFile(appDataDir())), 시험은 그 사용자 폴더 안 */
const portFile = path.join(userData, 'mcp', 'stcfsd-mcp-port');
const windowFile = path.join(userData, 'window.json');
const prefsFile = path.join(userData, 'shell.json');

// ─── 한 번만 실행 ──────────────────────────────────────────────────
// 잠금은 사용자 폴더마다다(Chromium 의 ProcessSingleton) — 시험의 임시 폴더는 사용자의 실행과 섞이지 않는다.
const gotLock = app.requestSingleInstanceLock({ open: args.open ?? null });
if (!gotLock) {
  // 첫 프로세스가 'second-instance' 로 넘겨준 파일을 연다. 이 프로세스는 곧 끝난다.
  app.exit(0);
}

// ─── 상태 ────────────────────────────────────────────────────────
let logger: ShellLogger | undefined;
let restoreConsole: (() => void) | undefined;
let layout: Layout | undefined;
let api: typeof HostApi | undefined;
let host: HostApi.HostHandle | undefined;
let bridge: HostApi.BridgeHandle | undefined;
let platform: HostApi.BridgePlatform | undefined;
let win: BrowserWindow | undefined;
let placement: Placement | undefined;
let entry: unknown;
let started = false;
let pendingOpen: string | undefined;
let shutDown = false;
let offBridge: (() => void) | undefined;
let theme: 'dark' | 'light' = args.theme ?? readPrefs().theme ?? 'dark';
/** 열기 · 저장의 기본 자리의 부모(문서 폴더). 시험은 STCFSD_DOCUMENTS 로 임시 폴더를 준다 */
let documentsDir = '';

/** 시험 · 진단 — 창 · 포커스 · 대화상자 기록 */
const diag = {
  stage: 'init',
  focusEvents: 0, showEvents: 0, broughtToFront: 0,
  /** 물음을 알린 차례(작업 표시줄 깜빡임) — 창을 앞으로 꺼내지 않는다 */
  questionSignals: 0, flashCalls: 0,
  titles: [] as string[],
  secondInstances: [] as Array<{ open: string | null; at: number }>,
  opened: [] as Array<{ file: string; ok: boolean; message?: string }>,
  osDialogs: [] as Array<{ kind: string; summary: string; answer: unknown }>,
  blockedNavigations: [] as string[],
  externalOpened: [] as string[],
  rendererConsole: [] as Array<{ level: string; message: string; source?: string }>,
  childConsolesHidden: [] as string[],
};

function readPrefs(): { theme?: 'dark' | 'light' } {
  try { const j = JSON.parse(fs.readFileSync(prefsFile, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
function writePrefs(p: { theme?: 'dark' | 'light' }): void {
  try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(prefsFile, JSON.stringify({ ...readPrefs(), ...p }, null, 2)); } catch { /* 무시 */ }
}

const log = (line: string, level: 'info' | 'warn' | 'error' = 'info') => {
  if (logger) { logger.shell(line, level); } else { process.stderr.write(`[shell] ${line}\n`); }
};
const send = (msg: unknown) => { if (TEST && process.send && process.connected) { process.send(msg); } };

// ─── 시작 실패 ─────────────────────────────────────────────────────
type FailKind = 'files' | 'python' | 'host' | 'bridge' | 'window';
const FAIL_TITLE: Record<FailKind, string> = {
  files: '프로그램 파일이 빠져 있습니다',
  python: 'Python 을 찾을 수 없습니다',
  host: '해석 엔진(호스트)을 시작하지 못했습니다',
  bridge: '화면 서버를 시작하지 못했습니다',
  window: '창을 열지 못했습니다',
};

async function failStartup(kind: FailKind, detail: string): Promise<never> {
  diag.stage = `failed:${kind}`;
  const logFile = logger?.file() ?? '(로그 없음)';
  log(`시작 실패(${kind}): ${detail}`, 'error');
  try { await shutdown(); } catch { /* 이미 반쯤 섰다 */ }
  if (TEST) {
    send({ type: 'fatal', kind, title: FAIL_TITLE[kind], detail, logFile });
    process.stderr.write(`STCFSD_SHELL_FATAL ${JSON.stringify({ kind, detail })}\n`);
    app.exit(3);
    throw new Error('exit');
  }
  const r = await dialog.showMessageBox({
    type: 'error', title: 'StCFSD', message: FAIL_TITLE[kind], detail: `${detail}\n\n로그 파일: ${logFile}`,
    buttons: ['로그 폴더 열기', '끝내기'], defaultId: 1, cancelId: 1, noLink: true,
  });
  if (r.response === 0 && logger) { await shell.openPath(logger.dir); }
  app.exit(1);
  throw new Error('exit');
}

// ─── OS 대화상자 · 외부 열기 · 시작 중 알림 (BridgePlatform 의 S3 갈고리) ──────────
function visibleWindow(): BrowserWindow | undefined {
  return win && !win.isDestroyed() && win.isVisible() ? win : undefined;
}

/**
 * 열기 · 저장 — OS 대화상자. 기본 자리는 문서\StCFSD(다리가 준 suggestedPath). 그 폴더가 아직 없으면 만들지 않고
 * 문서 폴더에서 연다(확인하기 전에는 아무것도 쓰지 않는다). 사용자가 단추 · 메뉴를 눌러 뜨는 대화상자다.
 */
async function nativeFileDialog(req: HostApi.FileDialogRequest & { suggestedPath: string }): Promise<string[] | undefined> {
  const docs = documentsDir;
  const suggested = req.defaultPath && path.isAbsolute(req.defaultPath) ? req.defaultPath : req.suggestedPath;
  const dirOf = req.kind === 'open' && suggested.endsWith(path.sep) ? suggested : path.dirname(suggested);
  const defaultPath = fs.existsSync(dirOf) ? suggested : (req.kind === 'open' ? docs : path.join(docs, path.basename(suggested)));
  const filters = req.filters ? Object.entries(req.filters).map(([name, extensions]) => ({ name, extensions })) : undefined;
  const parent = visibleWindow();
  let answer: string[] | undefined;
  if (req.kind === 'save') {
    const o: Electron.SaveDialogOptions = { title: req.title, defaultPath, buttonLabel: req.saveLabel, filters };
    const r = parent ? await dialog.showSaveDialog(parent, o) : await dialog.showSaveDialog(o);
    answer = r.canceled || !r.filePath ? undefined : [r.filePath];
  } else {
    const properties: Electron.OpenDialogOptions['properties'] = [];
    if (req.canSelectFiles !== false) { properties.push('openFile'); }
    if (req.canSelectFolders) { properties.push('openDirectory'); }
    if (req.canSelectMany) { properties.push('multiSelections'); }
    const o: Electron.OpenDialogOptions = { title: req.title, defaultPath, buttonLabel: req.openLabel, filters, properties };
    const r = parent ? await dialog.showOpenDialog(parent, o) : await dialog.showOpenDialog(o);
    answer = r.canceled || r.filePaths.length === 0 ? undefined : r.filePaths;
  }
  diag.osDialogs.push({ kind: `fileDialog:${req.kind}`, summary: `${req.title ?? req.saveLabel ?? req.openLabel ?? ''} default=${defaultPath}`, answer });
  log(`${req.kind === 'open' ? '열기' : '저장'} 대화상자 → ${answer ? answer.join(', ') : '(취소)'}`);
  return answer;
}

export function isWebUrl(target: string): boolean {
  try { const u = new URL(target); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

async function openExternal(url: string): Promise<boolean> {
  diag.externalOpened.push(url);
  if (!isWebUrl(url)) { log(`외부 열기 안 함(http/https 만): ${url}`, 'warn'); return false; }
  if (TEST) { log(`외부 열기(시험이라 하지 않음): ${url}`); return false; }
  try { await shell.openExternal(url); return true; } catch (err) { log(`외부 열기 실패 ${url}: ${String(err)}`, 'warn'); return false; }
}

/** 화면이 아직 붙기 전(시작 중)의 단추 있는 알림 — OS 알림 상자. VS Code 처럼 「취소」가 늘 있다 */
async function notifyWithoutScreen(req: HostApi.NotifyRequest): Promise<string | undefined> {
  const buttons = req.items.length > 0 ? [...req.items, '취소'] : ['확인'];
  const o: Electron.MessageBoxOptions = {
    type: req.severity === 'error' ? 'error' : req.severity === 'warning' ? 'warning' : 'info',
    title: 'StCFSD', message: req.message, detail: req.detail, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true,
  };
  const parent = visibleWindow();
  const r = parent ? await dialog.showMessageBox(parent, o) : await dialog.showMessageBox(o);
  const answer = req.items.length > 0 && r.response < req.items.length ? req.items[r.response] : undefined;
  diag.osDialogs.push({ kind: 'notify', summary: req.message.slice(0, 160), answer });
  return answer;
}

// ─── 파일 열기 · 메뉴의 파일 일 ──────────────────────────────────────
/** 명령줄 · 다시 실행 · 파일 연결로 넘어온 파일 — 확장의 「열기」 길(정해 둔 답으로 대화상자 없이) */
async function openFile(file: string): Promise<void> {
  if (!host || !bridge) { pendingOpen = file; return; }
  const r = await host.openProject(file);
  diag.opened.push({ file, ok: r.ok, message: r.message });
  if (r.ok) { bridge.setCurrentFile(r.file); }
  log(`열기 ${file}: ${r.ok ? '성공' : '실패'} — ${r.message ?? ''}`, r.ok ? 'info' : 'warn');
}

/** 메뉴 「열기」 · 「저장」 — 화면의 Open · Save 단추와 같은 길(웹뷰 메시지 → 호스트 → OS 대화상자) */
function fileAction(action: 'open' | 'save'): void {
  if (!host) { return; }
  host.designer.deliver({ command: action === 'open' ? 'openProject' : 'saveProject' });
}

// ─── 창 ─────────────────────────────────────────────────────────
function saveWindowState(): void {
  if (!win || win.isDestroyed()) { return; }
  const bounds = win.getNormalBounds();
  const d = screen.getDisplayMatching(bounds);
  writeWindowState(windowFile, { bounds, maximized: win.isMaximized(), displayId: d.id, displayBounds: d.bounds });
}

/** 사용자가 프로그램을 다시 실행했을 때만 부른다(사용자가 한 일이다) */
function bringToFront(): void {
  diag.broughtToFront += 1;
  if (!win || win.isDestroyed() || TEST) { return; }   // 시험은 사용자의 화면을 건드리지 않는다
  if (win.isMinimized()) { win.restore(); }
  win.show();
  win.focus();
}

function sameOrigin(url: string): boolean {
  try { return !!bridge && new URL(url).origin === bridge.origin; } catch { return false; }
}

function guardContents(wc: Electron.WebContents): void {
  const block = (what: string, url: string, prevent: () => void) => {
    if (sameOrigin(url) || url === 'about:blank') { return; }
    prevent();
    diag.blockedNavigations.push(`${what} ${url}`);
    log(`막음(${what}): ${url}`, 'warn');
    if (what === 'navigate' && isWebUrl(url)) { void openExternal(url); }
  };
  wc.on('will-navigate', (e, url) => block('navigate', url, () => e.preventDefault()));
  wc.on('will-frame-navigate', e => { if (!e.isMainFrame) { block('frame', e.url, () => e.preventDefault()); } });
  wc.on('will-redirect', (e, url) => block('redirect', url, () => e.preventDefault()));
  wc.on('will-attach-webview', e => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    diag.blockedNavigations.push(`window ${url}`);
    if (isWebUrl(url) && !sameOrigin(url)) { void openExternal(url); }
    return { action: 'deny' };
  });
}

function createSession(b: HostApi.BridgeHandle): Electron.Session {
  // partition 에 `persist:` 가 없다 = 메모리에만 있는 세션. 쿠키 · 캐시 · 저장소를 디스크에 쓰지 않는다.
  const ses = session.fromPartition('stcfsd-bridge', { cache: false });
  ses.webRequest.onBeforeRequest((details, cb) => {
    // 다리 출처 밖의 네트워크 요청은 보내지 않는다(원격 내용 없음).
    let cancel = false;
    try {
      const u = new URL(details.url);
      if (/^(https?|wss?|ftp):$/.test(u.protocol) && u.origin !== b.origin) { cancel = true; }
    } catch { cancel = false; }
    if (cancel) { diag.blockedNavigations.push(`request ${details.url}`); }
    cb({ cancel });
  });
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const headers = details.requestHeaders;
    if (sameOrigin(details.url)) { headers.Authorization = `Bearer ${b.token}`; } else { delete headers.Authorization; }
    cb({ requestHeaders: headers });
  });
  // 권한: 보고서의 「클립보드 복사」만.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write');
  return ses;
}

/** 창에 싣는 화면의 경로 — 기본은 틀(`/`). `--ui` 이고 다리가 새 검토 화면을 내줄 때만 `/ui/`(U1) */
function screenPath(b: HostApi.BridgeHandle): string {
  return args.ui && b.uiUrl ? '/ui/' : '/';
}

function setTheme(t: 'dark' | 'light'): void {
  theme = t;
  writePrefs({ theme: t });
  for (const id of ['theme-dark', 'theme-light']) {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (item) { item.checked = id === `theme-${t}`; }
  }
  if (win && !win.isDestroyed() && bridge) {
    if (screenPath(bridge) === '/ui/') {
      // 새 검토 화면(U1)은 페이지를 다시 싣지 않고 바꾼다 — 끼운 설계 화면의 아직 보내지 않은 입력을 잃지 않게
      void win.webContents.executeJavaScript(`window.__stcfsdUi && window.__stcfsdUi.setTheme(${JSON.stringify(t)})`, true).catch(() => undefined);
    } else {
      void win.loadURL(`${bridge.origin}/?theme=${t}`);
    }
  }
}

function about(): void {
  const v = process.versions;
  const o: Electron.MessageBoxOptions = {
    type: 'info', title: 'StCFSD 정보', message: `StCFSD ${VERSION}`,
    detail: `Electron ${v.electron} · Chromium ${v.chrome} · Node ${v.node}\n${layout?.kind === 'dev' ? `개발: ${layout.appRoot}` : '설치본'}\n사용자 폴더: ${userData}\n로그: ${logger?.dir ?? ''}`,
    buttons: ['확인'], noLink: true,
  };
  const parent = visibleWindow();
  void (parent ? dialog.showMessageBox(parent, o) : dialog.showMessageBox(o));
}

function buildMenu(): void {
  const sep: MenuItemConstructorOptions = { type: 'separator' };
  const template: MenuItemConstructorOptions[] = [
    {
      label: IS_WIN ? '파일(&F)' : '파일', submenu: [
        { id: 'file-open', label: '열기…', accelerator: 'CmdOrCtrl+O', click: () => fileAction('open') },
        { id: 'file-save', label: '저장…', accelerator: 'CmdOrCtrl+S', click: () => fileAction('save') },
        sep,
        { id: 'quit', label: '끝내기', accelerator: IS_WIN ? 'Alt+F4' : 'CmdOrCtrl+Q', click: () => { if (win) { win.close(); } else { app.quit(); } } },
      ],
    },
    {
      label: IS_WIN ? '보기(&V)' : '보기', submenu: [
        { id: 'reload', label: '새로 고침', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
        sep,
        { id: 'theme-dark', label: '어두운 테마', type: 'radio', checked: theme === 'dark', click: () => setTheme('dark') },
        { id: 'theme-light', label: '밝은 테마', type: 'radio', checked: theme === 'light', click: () => setTheme('light') },
        ...(DEV ? [sep, { id: 'devtools', label: '개발자 도구', accelerator: 'Ctrl+Shift+I', click: () => win?.webContents.toggleDevTools() }] : []),
      ],
    },
    {
      label: IS_WIN ? '도움말(&H)' : '도움말', submenu: [
        { id: 'about', label: '버전', click: about },
        { id: 'logs', label: '로그 폴더 열기', click: () => { if (logger && !TEST) { void shell.openPath(logger.dir); } } },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(b: HostApi.BridgeHandle): BrowserWindow {
  const ses = createSession(b);
  placement = placeWindow(readWindowState(windowFile), screen.getAllDisplays(), screen.getPrimaryDisplay());
  log(`창 자리: ${placement.where} ${JSON.stringify(placement.bounds)}${placement.maximized ? ' 최대화' : ''}`);
  const w = new BrowserWindow({
    ...placement.bounds,
    minWidth: 900, minHeight: 600,
    show: false,
    title: 'StCFSD',
    backgroundColor: theme === 'light' ? '#ffffff' : '#1f1f1f',
    autoHideMenuBar: true,          // Windows: 메뉴 막대는 Alt 를 누를 때만
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      devTools: DEV,
      // 시험은 창을 보이지 않으므로 그리기를 멈추지 않게 한다.
      backgroundThrottling: !TEST,
      additionalArguments: [`--stcfsd-version=${VERSION}`],
    },
  });
  guardContents(w.webContents);
  w.on('focus', () => { diag.focusEvents += 1; w.flashFrame(false); });
  w.on('show', () => { diag.showEvents += 1; });
  w.on('page-title-updated', (_e, title) => { diag.titles.push(title); if (diag.titles.length > 50) { diag.titles.shift(); } });
  let stateTimer: NodeJS.Timeout | undefined;
  const scheduleState = () => { clearTimeout(stateTimer); stateTimer = setTimeout(saveWindowState, 500); };
  w.on('resize', scheduleState);
  w.on('move', scheduleState);
  w.on('maximize', scheduleState);
  w.on('unmaximize', scheduleState);
  w.on('close', () => { clearTimeout(stateTimer); saveWindowState(); });
  w.on('closed', () => { if (win === w) { win = undefined; } });
  w.webContents.on('console-message', (e: Electron.Event & { level?: string; message?: string; sourceId?: string; lineNumber?: number }) => {
    const lv = String(e.level ?? 'info');
    const msg = String(e.message ?? '');
    diag.rendererConsole.push({ level: lv, message: msg.slice(0, 400), source: e.sourceId });
    if (diag.rendererConsole.length > 500) { diag.rendererConsole.shift(); }
    if (lv === 'error' || lv === 'warning') { logger?.host(`[renderer:${lv}] ${msg} (${e.sourceId ?? ''}:${e.lineNumber ?? ''})`); }
  });
  w.webContents.on('render-process-gone', (_e, d) => log(`화면 프로세스가 끝났다: ${d.reason} (${d.exitCode})`, 'error'));
  w.once('ready-to-show', () => {
    if (TEST) { return; }     // 시험은 한 번도 보이지 않는다
    if (placement?.maximized) { w.maximize(); }
    w.show();                 // 사용자가 프로그램을 실행했을 때 한 번
  });
  void w.loadURL(`${b.origin}${screenPath(b)}${theme === 'light' ? '?theme=light' : ''}`);
  return w;
}

// ─── 다리의 사건 — 물음은 창을 앞으로 꺼내지 않고 알린다 ───────────────────
function onBridgeEvent(ev: HostApi.BridgeEvent): void {
  if (!win || win.isDestroyed()) { return; }
  if (ev.type === 'platform:question') {
    diag.questionSignals += 1;
    // 작업 표시줄 단추만 깜빡인다(창을 앞으로 꺼내지 않는다). 사용자가 창으로 오면(focus) 멈춘다.
    if (!win.isFocused()) { diag.flashCalls += 1; if (!TEST) { win.flashFrame(true); } }
  } else if (ev.type === 'platform:answered') {
    if (!TEST) { win.flashFrame(false); }
  }
}

// ─── 끝내기 ───────────────────────────────────────────────────────
async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<undefined>(resolve => { timer = setTimeout(() => { log(`${what}: ${ms}ms 안에 끝나지 않았다 — 넘어간다`, 'warn'); resolve(undefined); }, ms); });
  try { return await Promise.race([p, t]); } finally { clearTimeout(timer); }
}

async function shutdown(): Promise<void> {
  if (shutDown) { return; }
  shutDown = true;
  diag.stage = 'shutdown';
  const b = bridge; const h = host;
  bridge = undefined; host = undefined;
  offBridge?.(); offBridge = undefined;
  if (b) { await withTimeout(b.dispose(), 5000, '다리 닫기').catch(err => log(`다리 닫기 예외: ${String(err)}`, 'warn')); }
  // host.dispose → deactivate → MCP 다리 멈춤(포트 파일 지움) · Python 끝냄
  if (h) { await withTimeout(h.dispose(), 10_000, '호스트 닫기').catch(err => log(`호스트 닫기 예외: ${String(err)}`, 'warn')); }
  log('끝');
  restoreConsole?.();
  logger?.close();
}

// ─── 시작 ────────────────────────────────────────────────────────
async function start(): Promise<void> {
  await app.whenReady();
  logger = createLogger({ dir: path.join(userData, 'logs'), echo: DEV || TEST });
  restoreConsole = logger.captureConsole();
  process.on('uncaughtException', err => log(`잡히지 않은 예외: ${err?.stack ?? err}`, 'error'));
  process.on('unhandledRejection', err => log(`처리되지 않은 거부: ${(err as Error)?.stack ?? err}`, 'error'));
  app.on('child-process-gone', (_e, d) => log(`보조 프로세스가 끝났다: ${d.type} ${d.reason} (${d.exitCode})`, d.reason === 'clean-exit' ? 'info' : 'warn'));
  const v = process.versions;
  log(`시작 pid=${process.pid} · Electron ${v.electron} · Chromium ${v.chrome} · Node ${v.node} · ${TEST ? '시험 · ' : ''}userData=${userData}`);
  if (TEST) { installTestDialogs(); }

  diag.stage = 'files';
  layout = resolveLayout({ packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath, env: process.env });
  log(`배치: ${layout.kind} · appRoot=${layout.appRoot}`);
  const missing = missingFiles(layout);
  if (missing.length) {
    await failStartup('files', `${missing.join('\n')}${layout.kind === 'dev'
      ? '\n\n저장소 루트에서 npx tsc -p ./, desktop 에서 npm run build 를 먼저 돌리십시오.' : '\n\n프로그램을 다시 설치해 주십시오.'}`);
  }
  diag.stage = 'python';
  const py = findPython(layout, process.env);
  if (!py.ok) {
    await failStartup('python', `해석에 쓰는 Python 이 없습니다.\n찾아본 곳:\n${py.tried.map(t => `  ${t}`).join('\n')}\n\n${layout.kind === 'dev'
      ? '저장소 루트에 .venv(numpy · scipy)가 있어야 합니다. 다른 Python 을 쓰려면 STCFSD_PYTHON 에 그 경로를 넣으십시오.'
      : '프로그램을 다시 설치해 주십시오.'}`);
  }
  log(`Python: ${py.path}`);

  if (IS_WIN) {
    // 호스트가 띄우는 python.exe(엔진) · 시작 점검의 execSync 에 콘솔 창이 뜨지 않게(winConsole.ts). 호스트를 읽기 전에.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    diag.childConsolesHidden = hideChildConsoles(require('node:child_process'));
    log(`자식 프로세스 콘솔 숨김: ${diag.childConsolesHidden.join(', ') || '(이미)'}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  api = require(layout.hostEntry) as typeof HostApi;

  diag.stage = 'host';
  documentsDir = process.env.STCFSD_DOCUMENTS ? path.resolve(process.env.STCFSD_DOCUMENTS) : app.getPath('documents');
  platform = api.createBridgePlatform({
    log: line => logger?.host(line),
    documentsDir,
    fileDialog: nativeFileDialog,
    openExternal,
    notifyWithoutScreen,
  });
  try {
    host = await api.startHost({
      repoRoot: layout.appRoot, userDataDir: path.join(userData, 'host'), platform, portFile, screenless: false,
      pythonPath: py.override, log: line => logger?.host(line),
    });
  } catch (err) {
    return failStartup('host', String((err as Error)?.stack ?? err));
  }
  log(`호스트: 활성화 ${host.activationMs}ms · 설계 패널 ${host.panelMs}ms · MCP 127.0.0.1:${host.mcp.port} · 포트 파일 ${portFile}`);

  diag.stage = 'bridge';
  try {
    // Claude Desktop 이 띄울 항목: 이 실행 파일(설치본 StCFSD.exe, 개발판 electron.exe) + ELECTRON_RUN_AS_NODE + 이 배치의 MCP 서버.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cd = require(path.join(layout.appRoot, 'out', 'mcp', 'claudeDesktop.js')) as {
      standaloneMcpEntry(i: { command: string; serverScript: string; portFile: string; electron?: boolean }): unknown;
    };
    entry = cd.standaloneMcpEntry({ command: process.execPath, serverScript: layout.mcpServer, portFile, electron: true });
    bridge = await api.startBridge(host, {
      platform, theme, frameDir: layout.frameDir, log: line => logger?.host(line),
      claude: { configPath: claudeConfigPath(), entry },
      // 새 검토 화면(U1)은 `--ui` 일 때만 연다. 폴더가 없으면(설치본은 아직 묶지 않는다) 다리가 /ui/ 를 내주지 않고 틀을 연다.
      uiDir: args.ui && fs.existsSync(path.join(layout.uiDir, 'index.html')) ? layout.uiDir : undefined,
    });
    if (args.ui && !bridge.uiUrl) { log(`새 검토 화면이 없다(${layout.uiDir}) — 틀을 연다`, 'warn'); }
  } catch (err) {
    return failStartup('bridge', String((err as Error)?.stack ?? err));
  }
  log(`다리: ${bridge.origin}`);
  offBridge = bridge.on(onBridgeEvent);

  diag.stage = 'window';
  try {
    buildMenu();
    win = createWindow(bridge);
  } catch (err) {
    return failStartup('window', String((err as Error)?.stack ?? err));
  }
  started = true;
  diag.stage = 'running';
  const first = args.open ?? pendingOpen;
  pendingOpen = undefined;
  if (first) { await openFile(first); }
  send({ type: 'stage', stage: 'running', pid: process.pid, origin: bridge.origin, portFile, userData, screen: screenPath(bridge) });
}

/** 시험 · 개발에서 Claude 설정 파일을 바꿔 끼운다. 시험인데 주지 않았으면 사용자 폴더 안의 없는 경로(= 설치 안 됨) */
function claudeConfigPath(): string | undefined {
  if (process.env.STCFSD_CLAUDE_CONFIG) { return path.resolve(process.env.STCFSD_CLAUDE_CONFIG); }
  if (TEST) { return path.join(userData, 'no-claude', 'Claude', 'claude_desktop_config.json'); }
  return undefined;
}

/** 시험 모드의 기본 대화상자 — 아무것도 그리지 않고 "취소" 로 답한다. 시험이 필요한 것만 제어 통로로 다시 바꾼다 */
function installTestDialogs(): void {
  const d = dialog as unknown as Record<string, unknown>;
  const note = (what: string) => log(`(시험) ${what} — 가짜 대화상자가 취소로 답함`);
  d.showOpenDialog = async () => { note('열기 대화상자'); return { canceled: true, filePaths: [] }; };
  d.showSaveDialog = async () => { note('저장 대화상자'); return { canceled: true, filePath: '' }; };
  d.showMessageBox = async (...a: unknown[]) => {
    const o = (a.length > 1 ? a[1] : a[0]) as Electron.MessageBoxOptions;
    note(`알림 "${o?.message}"`);
    return { response: o?.cancelId ?? 0, checkboxChecked: false };
  };
  d.showErrorBox = (title: string, content: string) => { note(`오류 상자 "${title}: ${content}"`); };
}

/** 시험의 제어 통로 — 부모(시험)가 IPC 로 띄웠을 때만. 주 프로세스 안에서 코드를 돌려 답한다(네트워크로 열리지 않는다) */
function installTestControl(): void {
  if (!TEST || !process.send) { return; }
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...a: string[]) => (ctx: unknown) => Promise<unknown>;
  const ctx = () => ({
    app, win, host, bridge, platform, dialog, diag, BrowserWindow, Menu, screen, layout, entry, userData, portFile, windowFile,
    openFile, fileAction, placement, started,
    menuClick: (id: string) => { const item = Menu.getApplicationMenu()?.getMenuItemById(id); if (!item) { throw new Error(`메뉴 없음: ${id}`); } item.click(); return true; },
  });
  process.on('message', (m: { id?: number; type?: string; code?: string; file?: string }) => {
    const reply = (msg: unknown) => send({ id: m.id, ...(msg as object) });
    if (m?.type === 'eval' && typeof m.code === 'string') {
      Promise.resolve().then(() => new AsyncFunction('ctx', m.code!)(ctx()))
        .then(result => reply({ ok: true, result: JSON.parse(JSON.stringify(result ?? null)) }), err => reply({ ok: false, error: String(err?.stack ?? err) }));
    } else if (m?.type === 'capture' && typeof m.file === 'string') {
      // 한 번도 보이지 않은 창은 스스로 새 그림을 만들지 않는다. capturePage() 는 처음엔 UnknownVizError, 그 뒤로는
      // **마지막으로 그린 그림**(한 단계 낡은 것)을 돌려준다 — 시험에서 봤다. 그래서 invalidate() 로 다시 그리게 하고
      // DevTools 프로토콜의 화면 찍기(새 그림을 기다린다)로 찍는다. 창은 여전히 보이지 않는다. 안 되면 capturePage().
      (async () => {
        if (!win) { throw new Error('창이 없다'); }
        let png: Buffer | undefined;
        try {
          const dbg = win.webContents.debugger;
          if (!dbg.isAttached()) { dbg.attach('1.3'); }
          win.webContents.invalidate();
          const r = await Promise.race([
            dbg.sendCommand('Page.captureScreenshot', { format: 'png' }) as Promise<{ data: string }>,
            new Promise<never>((_, j) => setTimeout(() => j(new Error('CDP 화면 찍기 시간 초과')), 15_000)),
          ]);
          png = Buffer.from(r.data, 'base64');
        } catch {
          win.webContents.invalidate();
          await new Promise(r => setTimeout(r, 400));
          const img = await win.webContents.capturePage();
          png = img.toPNG();
        }
        fs.writeFileSync(m.file!, png);
        return fs.statSync(m.file!).size;
      })().then(size => reply({ ok: true, result: size }), err => reply({ ok: false, error: String(err?.stack ?? err) }));
    }
  });
}

// ─── 앱 사건 ──────────────────────────────────────────────────────
if (gotLock) {
  installTestControl();
  app.on('second-instance', (_e, argv, cwd, data) => {
    const fromData = (data as { open?: string | null } | undefined)?.open ?? undefined;
    const file = fromData ?? parseArgs(argv, cwd, Boolean(process.defaultApp)).open;
    diag.secondInstances.push({ open: file ?? null, at: Date.now() });
    log(`다시 실행됨${file ? ` — 열 파일 ${file}` : ''}`);
    bringToFront();
    if (file) { if (started) { void openFile(file); } else { pendingOpen = file; } }
  });
  app.on('web-contents-created', (_e, wc) => { if (wc.getType() === 'window') { guardContents(wc); } });
  app.on('window-all-closed', () => { app.quit(); });
  app.on('will-quit', e => {
    if (shutDown) { return; }
    e.preventDefault();
    void shutdown().finally(() => app.exit(0));
  });
  const onSignal = (sig: string) => { log(`${sig} — 끝낸다`); app.quit(); };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('disconnect', () => { if (TEST) { onSignal('시험 부모 끊김'); } });

  start().catch(err => {
    if ((err as Error)?.message === 'exit') { return; }
    log(`시작 중 예외: ${(err as Error)?.stack ?? err}`, 'error');
    app.exit(1);
  });
}
