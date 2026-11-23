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
 * 설치본은 시험 모드 · 개발 덮어쓰기 변수를 따르지 않는다 — `<resources>/stcfsd-verification.json` 이 있는 확인용 복사본만(mode.ts, V5-13).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell, type MenuItemConstructorOptions } from 'electron';
import { vetOpen } from '../../host/src/bridge/openable';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as HostApi from '../../host/src/index';
import { parseArgs, PROJECT_EXT } from './args';
import { createLogger, type ShellLogger } from './log';
import { findPython, missingFiles, resolveLayout, type Layout } from './layout';
import { effectiveEnv, questionSignal, runMode, userDataProblem, VERIFICATION_MARKER, verificationMarkerValid } from './mode';
import { hideChildConsoles } from './winConsole';
import { placeWindow, readWindowState, writeWindowState, type Placement } from './windowState';

// 설치본은 시험 · 개발 길을 따르지 않는다 — 확인용 복사본(표시 파일)만 예외(mode.ts, V5-13)
const MODE = runMode({
  packaged: app.isPackaged, env: process.env,
  // 표시 파일은 이 빌드의 주 번들(지금 돌고 있는 이 main.js)의 sha256 을 담은 정해진 꼴일 때만 — 모델 파일 · 다른 JSON 은 무시
  verificationMarker: app.isPackaged && verificationMarkerValid(path.join(process.resourcesPath, VERIFICATION_MARKER), __filename),
});
const ENV = effectiveEnv(process.env, MODE);
const TEST = MODE.test;
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

// ─── 사용자 폴더 점검(V5-11) ───────────────────────────────────────
// 쓸 수 없으면 아래의 단일 인스턴스 잠금이 실패해 「이미 떠 있다」로 보고 말없이 끝났다. 잠금 전에 보고, 안 되면 까닭을 보인다.
// 이것은 사용자가 반드시 봐야 하는 시작 실패다 — 이 프로그램에서 창이 포커스를 가져가도 되는 단 한 곳(오류 상자).
const udProblem = userDataProblem(userData);
if (udProblem) {
  const detail = `사용자 폴더에 쓸 수 없어 StCFSD 를 시작할 수 없습니다.\n\n폴더: ${userData}\n까닭: ${udProblem}\n\n`
    + '폴더의 권한을 확인하거나(다른 프로그램 · 보안 프로그램이 막는지), 관리자에게 문의해 주십시오.';
  if (TEST) {
    // 시험은 아무것도 보이지 않는다 — 오류 상자로 갈 길을 탔다는 것만 알린다
    if (process.send) { process.send({ type: 'fatal', kind: 'userdata', title: '사용자 폴더에 쓸 수 없습니다', detail }); }
    process.stderr.write(`STCFSD_SHELL_FATAL ${JSON.stringify({ kind: 'userdata', detail })}\n`);
  } else {
    dialog.showErrorBox('StCFSD — 시작할 수 없습니다', detail);
  }
  app.exit(4);
}

// ─── 한 번만 실행 ──────────────────────────────────────────────────
// 잠금은 사용자 폴더마다다(Chromium 의 ProcessSingleton) — 시험의 임시 폴더는 사용자의 실행과 섞이지 않는다.
const gotLock = !udProblem && app.requestSingleInstanceLock({ open: args.open ?? null, extra: args.extra ?? [] });
if (!gotLock && !udProblem) {
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
/** 시작이 끝나기 전에 온 열 파일(명령줄 · 시작 중의 다시 실행) — 차례대로 연다(V5-12a) */
const pendingOpens: string[] = [];
let shutDown = false;
/** 프로그램이 스스로 끝내는 중(before-quit) — 창의 닫기 물음을 건너뛴다 */
let appQuitting = false;
let offBridge: (() => void) | undefined;
let theme: 'dark' | 'light' = args.theme ?? readPrefs().theme ?? 'dark';
/** 열기 · 저장의 기본 자리의 부모(문서 폴더). 시험은 STCFSD_DOCUMENTS 로 임시 폴더를 준다 */
let documentsDir = '';

/** 시험 · 진단 — 창 · 포커스 · 대화상자 기록 */
const diag = {
  stage: 'init',
  /** V9b-08 · S1: 맨 위 문서의 사람 입력(preload 의 IPC) 수 · 다른 곳에서 와서 세지 않은 수 */
  topInputs: 0, inputIgnored: 0,
  focusEvents: 0, showEvents: 0, broughtToFront: 0,
  /** 물음을 알린 차례(작업 표시줄 깜빡임) — 창을 앞으로 꺼내지 않는다 */
  questionSignals: 0, flashCalls: 0,
  titles: [] as string[],
  secondInstances: [] as Array<{ open: string | null; at: number }>,
  opened: [] as Array<{ file: string; ok: boolean; message?: string }>,
  /** 한 번에 여러 파일이 넘어와 열지 않은 것(V5-12b) — 사용자에게 알린다 */
  notOpened: [] as string[],
  queuedWhileStarting: [] as string[],
  /** 물음 신호의 규칙(questionSignal)이 낸 결과 — 시험 · 실제 길이 같은 함수다 */
  questionPolicy: [] as Array<{ flash: boolean; show: boolean; focus: boolean }>,
  osDialogs: [] as Array<{ kind: string; summary: string; answer: unknown }>,
  blockedNavigations: [] as string[],
  externalOpened: [] as string[],
  rendererConsole: [] as Array<{ level: string; message: string; source?: string }>,
  childConsolesHidden: [] as string[],
  keyedRequests: 0,
  /** 쓰기 열쇠를 붙인 요청(방법 · 경로 · 종류) — 시험이 이동에 붙지 않았는지 본다 */
  keyedLog: [] as Array<{ method: string; path: string; type: string }>,
  /** 저장 안 한 변경을 물은 기록(V5-12c) — 어디서 · 어떻게 · 답 */
  unsaved: [] as Array<{ where: UnsavedWhere; how: 'none' | 'native' | 'page'; answer: UnsavedAnswer | 'proceed'; failed?: boolean; saved?: string; note?: string; flushed?: boolean }>,
  /** 시험: 창 닫기의 OS 물음 대신 쓸 답(차례대로). 비어 있으면 '취소' — 시험은 OS 대화상자를 띄우지 않는다 */
  unsavedTestAnswers: [] as UnsavedAnswer[],
  /** 시험: 「저장」 뒤의 저장 자리 물음에 줄 답(없으면 취소) */
  saveTestPaths: [] as string[],
  /** R1-3: /api/person/* 쓰기 요청마다 — 열쇠를 붙였나 · 마지막 사람 입력에서 몇 ms */
  personRequests: [] as Array<{ path: string; keyed: boolean; sinceInput: number }>,
  /** 시험: get_unsaved_changes 가 실패한 것처럼 */
  failUnsavedQuery: false,
  /** S3: 로그오프 · 시스템 종료 때 쓴 복구본 */
  recovery: [] as Array<{ event: string; dirty: boolean | null; file?: string; ok?: boolean; message?: string }>,
};
type UnsavedWhere = HostApi.UnsavedWhere;
type UnsavedAnswer = HostApi.UnsavedAnswer;

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
type FailKind = 'userdata' | 'files' | 'python' | 'host' | 'bridge' | 'window';
const FAIL_TITLE: Record<FailKind, string> = {
  userdata: '사용자 폴더(로그)에 쓸 수 없습니다',
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

/**
 * R3-3: 프로젝트의 원자료 파일을 OS 의 기본 앱으로 연다 — 다리가 원자료 폴더 안의 파일임을 확인한 경로만 온다. 내용은 읽지 않는다(AI 에게 가지 않는다).
 * 시험에서는 열지 않고 기록만
 */
async function openLocalFile(abs: string): Promise<boolean> {
  // V9b-02: 껍데기의 마지막 문 — 진짜 경로의 진짜 마지막 확장자가 문서 형식이 아니면 shell.openPath 에 닿지 않는다(다리의 플랫폼도 본다)
  const v = vetOpen(abs);
  if (!v.ok || !v.real) { diag.externalOpened.push(`refused:${path.basename(v.real ?? abs)}`); log(`원자료 열지 않음 ${path.basename(v.real ?? abs)}: ${v.why ?? ''}`, 'warn'); return false; }
  diag.externalOpened.push(`file:${path.basename(v.real)}`);
  if (TEST) { log(`원자료 열기(시험이라 하지 않음): ${path.basename(v.real)}`); return false; }
  try { const err = await shell.openPath(v.real); if (err) { log(`원자료 열기 실패 ${path.basename(v.real)}: ${err}`, 'warn'); return false; } return true; }
  catch (err) { log(`원자료 열기 실패 ${path.basename(v.real)}: ${String(err)}`, 'warn'); return false; }
}
/** V9b-02: 탐색기에서 그 파일을 고른 채 폴더를 연다 — 아무것도 실행하지 않는다 */
async function showLocalFile(abs: string): Promise<boolean> {
  diag.externalOpened.push(`show:${path.basename(abs)}`);
  if (TEST) { log(`폴더에서 보기(시험이라 하지 않음): ${path.basename(abs)}`); return false; }
  try { shell.showItemInFolder(abs); return true; } catch (err) { log(`폴더에서 보기 실패 ${path.basename(abs)}: ${String(err)}`, 'warn'); return false; }
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
  if (!host || !bridge || !started) { pendingOpens.push(file); diag.queuedWhileStarting.push(file); return; }
  const r = await host.openProject(file);
  diag.opened.push({ file, ok: r.ok, message: r.message });
  if (r.ok) { bridge.setCurrentFile(r.file); }
  log(`열기 ${file}: ${r.ok ? '성공' : '실패'} — ${r.message ?? ''}`, r.ok ? 'info' : 'warn');
}

/**
 * 한 번에 넘어온 파일들(명령줄 · 다시 실행) — 첫 것만 열고 나머지는 열지 않았다고 알린다(V5-12b). 모델은 하나뿐이라
 * 차례로 열면 앞의 것이 말없이 바뀐다. 알림은 화면의 풍선(화면이 붙기 전이면 시작이 끝난 뒤).
 */
async function openFiles(files: string[]): Promise<void> {
  if (!files.length) { return; }
  const [first, ...rest] = files;
  await openFile(first);
  if (!rest.length) { return; }
  diag.notOpened.push(...rest);
  log(`여러 파일 — 첫 파일만 연다. 열지 않음: ${rest.join(', ')}`, 'warn');
  const tell = () => platform?.notify({
    severity: 'warning', items: [], modal: false,
    message: `파일은 한 번에 하나만 엽니다. ${path.basename(first)} 을(를) 열고, 다음 ${rest.length}개는 열지 않았습니다.`,
    detail: rest.map(f => path.basename(f)).join('\n'),
  });
  if (started) { void tell(); } else { notices.push(tell); }
}
const notices: Array<() => unknown> = [];

/** 메뉴 「열기」 · 「저장」 — 화면의 Open · Save 단추와 같은 길(웹뷰 메시지 → 호스트 → OS 대화상자) */
function fileAction(action: 'open' | 'save'): void {
  if (!host) { return; }
  if (action === 'save') { host.designer.deliver({ command: 'saveProject' }); return; }
  void confirmUnsaved('open').then(go => { if (go && host) { host.designer.deliver({ command: 'openProject' }); } });
}

// ─── 저장 안 한 변경(V5-12c · K2 §7) ─────────────────────────────────
/** 호스트 동작(MCP 다리의 /action — AI 호출로 세지 않는다) */
async function hostAction<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T | undefined> {
  if (!host) { return undefined; }
  // 시험: 저장 안 한 변경을 읽지 못하는 경우(V7-46 — 묻지 않고 닫지 않는지)
  if (TEST && diag.failUnsavedQuery && action === 'get_unsaved_changes') { return { error: '시험 — 상태를 읽지 못함' } as T; }
  try {
    const r = await fetch(`http://127.0.0.1:${host.mcp.port}/action`, { method: 'POST',
      headers: { Authorization: `Bearer ${host.mcp.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...params }) });
    return await r.json() as T;
  } catch { return undefined; }
}

/** 저장 자리 — 사람이 「저장」을 고른 뒤의 OS 대화상자(시험은 diag.saveTestPaths 의 답, 없으면 취소) */
async function askSavePath(defaultName: string): Promise<string | undefined> {
  if (TEST) { const p = diag.saveTestPaths.shift(); diag.osDialogs.push({ kind: 'save', summary: defaultName, answer: p }); return p; }
  const r = await dialog.showSaveDialog(win && !win.isDestroyed() ? win : (undefined as unknown as BrowserWindow), {
    title: '검토 대상 저장', defaultPath: path.join(documentsDir || app.getPath('documents'), 'StCFSD', defaultName),
    filters: [{ name: 'StCFSD 검토 대상', extensions: ['csd'] }] });
  return r.canceled || !r.filePath ? undefined : r.filePath;
}

/** V7-44: 끼운 설계 화면의 밀린 입력(300 ms 모음)을 호스트로 — 그 프레임에서 다리 수신부의 __stcfsdFlush 를 부른다 */
async function flushDesigner(): Promise<boolean> {
  if (!win || win.isDestroyed() || !bridge) { return false; }
  const frames = win.webContents.mainFrame.framesInSubtree.filter(f => { try { return new URL(f.url).origin === bridge!.webviewOrigin; } catch { return false; } });
  let any = false;
  for (const f of frames) {
    try { any = (await f.executeJavaScript('typeof window.__stcfsdFlush==="function" ? window.__stcfsdFlush() : false')) === true || any; } catch { /* 프레임이 없어짐 */ }
  }
  return any;
}

/**
 * 저장 안 한 변경 — 하나의 함수(host/src/unsaved.ts confirmUnsaved: 밀린 입력 → get_unsaved_changes → 묻기 → 안전한 저장).
 * 창 닫기(사람이 창을 닫는 동작)만 OS 대화상자 — 그 밖(메뉴의 열기 · 끼운 화면의 Open · Ctrl+O · 시작 화면 · 제목 표시줄 · 다시 실행 ·
 * 파일 연결)은 화면 안의 물음(다리의 알림 — 창을 앞으로 꺼내지 않는다). 시험은 OS 대화상자를 띄우지 않는다(diag.unsavedTestAnswers).
 * 「저장」은 이번 세션에 사람이 정한 .csd 에만 묻지 않고 쓴다 — AI 의 load_project 가 정한 경로면 저장 자리를 묻는다(V7-42).
 */
async function confirmUnsaved(where: UnsavedWhere): Promise<boolean> {
  if (!host || !api) { return true; }
  let how: 'native' | 'page' = where === 'close' ? 'native' : 'page';
  let flushed: boolean | undefined;
  const ctx: HostApi.UnsavedCtx = {
    hostAction: (action, params) => hostAction(action, params ?? {}),
    ask: async (w, q) => {
      if (w === 'close') {
        how = 'native';
        if (TEST) { return diag.unsavedTestAnswers.shift() ?? 'cancel'; }
        const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : (undefined as unknown as BrowserWindow), {
          type: 'warning', title: 'StCFSD', message: q.message, detail: q.detail, buttons: q.items, defaultId: 0, cancelId: 2, noLink: true });
        return (['save', 'discard', 'cancel'] as UnsavedAnswer[])[r.response] ?? 'cancel';
      }
      how = 'page';
      const picked = platform ? await platform.notify({ severity: 'warning', modal: true, items: q.items, message: q.message, detail: q.detail }) : undefined;
      return picked === q.items[0] ? 'save' : picked === q.items[1] ? 'discard' : 'cancel';
    },
    personFile: () => bridge?.personFile(),
    askSavePath,
    saveProject: async file => { const r = await host!.saveProject(file); if (r.ok) { bridge?.setCurrentFile(r.file); } return r; },
    flush: where === 'close' ? async () => { flushed = await flushDesigner(); } : undefined,
    log: line => log(line),
  };
  const r = await api.confirmUnsaved(ctx, where);
  diag.unsaved.push({ where, how: r.how === 'none' ? 'none' : how, answer: r.answer, ...(r.failed ? { failed: true } : {}), ...(r.saved ? { saved: r.saved } : {}),
    ...(r.note ? { note: r.note } : {}), ...(flushed !== undefined ? { flushed } : {}) });
  return r.proceed;
}

// ─── 사람의 입력(R1-3 층 4) ─────────────────────────────────────────
/**
 * 맨 위 틀의 **자기 문서**에 사람의 누름 · 키가 마지막으로 들어온 때(V9b-08 · S1). webContents 의 input-event 는 끼운 페이지 안의 입력도 센다 —
 * 그래서 쓰지 않는다. preload(맨 위 틀에만 돈다)가 그 문서의 capture 단계에서 isTrusted 인 pointerdown · keydown 만 IPC 로 알리고,
 * 여기서 보낸 쪽이 그 창의 mainFrame 인지 본다. 끼운 iframe 안의 입력은 맨 위 문서로 오지 않는다(스크립트의 dispatchEvent 는 isTrusted 가 아니다)
 */
let lastPersonInput = 0;
const PERSON_INPUT_MS = 2000;
const PERSON_INPUT_CHANNEL = 'stcfsd:person-input';

// ─── 로그오프 · 시스템 종료(V7-S3) ───────────────────────────────────
/**
 * Windows 가 세션을 끝내려 하면(로그오프 · 다시 시작 · 종료 — BrowserWindow 의 `query-session-end` · `session-end`) 물을 틈이 없다.
 * 끝을 막지 않고(사람이 고른 종료를 존중 — 막으면 Windows 가 「이 앱이 종료를 막고 있다」 화면을 띄운다), 저장 안 한 변경이 있으면
 * **복구본**을 이 프로그램의 사용자 폴더(`<userData>/recovery/`)에 쓴다 — AI 가 준 경로가 아니다. 다음 실행 때 그 자리를 알린다.
 * 한계: 호스트의 저장 길을 쓰므로 호스트의 「지금 파일」이 복구본으로 바뀐다(세션이 끝나지 않고 취소되면 제목에 그 이름이 보인다).
 * 경로를 바꾸지 않는 복구 쓰기는 호스트에 바란다.
 */
const recoveryDir = path.join(userData, 'recovery');
let recoveryRunning: Promise<void> | null = null;
function writeRecovery(event: string): Promise<void> {
  if (recoveryRunning) { return recoveryRunning; }
  recoveryRunning = (async () => {
    if (!host || !started) { diag.recovery.push({ event, dirty: null, message: '시작 전' }); return; }
    const u = await hostAction<{ dirty?: boolean }>('get_unsaved_changes');
    const dirty = typeof u?.dirty === 'boolean' ? u.dirty : null;
    // 읽지 못하면 쓴다(fail closed — 잃는 쪽보다 복구본이 하나 더 있는 쪽)
    if (dirty === false) { diag.recovery.push({ event, dirty }); log(`세션 끝(${event}) — 저장 안 한 변경 없음`); return; }
    try { fs.mkdirSync(recoveryDir, { recursive: true }); } catch { /* 아래에서 실패 */ }
    const file = path.join(recoveryDir, `recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.csd`);
    // 4b99968: 호스트의 복구 사본 쓰기 — 지금 파일 · 저장 기준 · 화면을 바꾸지 않는다(root 안의 새 파일만, 링크 거절)
    const w = await host.writeRecoveryCopy(file, recoveryDir);
    const r = { ok: w.ok, message: w.ok ? undefined : w.error };
    diag.recovery.push({ event, dirty, file: w.ok ? w.path : file, ok: r.ok, message: r.message });
    log(`세션 끝(${event}) — 저장 안 한 변경을 복구본으로: ${file} (${r.ok ? '씀' : `실패 ${r.message ?? ''}`})`, r.ok ? 'warn' : 'error');
  })().finally(() => { recoveryRunning = null; });
  return recoveryRunning;
}
/** 다음 실행 — 남은 복구본을 알린다(열지 않는다 — 사람이 고른다) */
function tellRecovery(): void {
  let files: string[] = [];
  try { files = fs.readdirSync(recoveryDir).filter(f => /^recovery-.*\.csd$/.test(f)).sort().reverse(); } catch { return; }
  if (!files.length) { return; }
  void platform?.notify({ severity: 'warning', items: [], modal: false,
    message: `지난번 Windows 가 끝날 때 저장하지 않은 변경을 복구본으로 남겼습니다(${files.length}개) — 메뉴 「열기」로 열 수 있습니다.`,
    detail: files.slice(0, 5).map(f => path.join(recoveryDir, f)).join('\n') });
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

/** 다리의 두 출처(틀 서버 · 웹뷰 서버) 가운데 하나인가 */
function sameOrigin(url: string): boolean {
  try { const o = new URL(url).origin; return !!bridge && (o === bridge.origin || o === bridge.webviewOrigin); } catch { return false; }
}
function isFrameOrigin(url: string): boolean {
  try { return !!bridge && new URL(url).origin === bridge.origin; } catch { return false; }
}

/**
 * 이동 막기(V5b-04). 맨 위 창은 앱이 스스로(`loadURL` · 메뉴의 `reload`) 하는 것 말고는 **어떤 이동 · 리디렉트도** 받지 않는다 —
 * 페이지(또는 끼운 웹뷰의 `top.location` · `target=_top` 폼 · 링크 · `window.open(…, '_top')`)가 시작한 이동은 다리 주소여도 막는다.
 * (프로그램이 시작한 이동은 이 사건을 내지 않는다 — Electron.) 끼운 웹뷰(하위 프레임)는 웹뷰 서버 안에서만 움직인다.
 */
const guarded = new WeakSet<Electron.WebContents>();
function guardContents(wc: Electron.WebContents): void {
  if (guarded.has(wc)) { return; }   // 창을 만들 때와 web-contents-created 에서 두 번 온다
  guarded.add(wc);
  const refuse =(what: string, url: string, prevent: () => void) => {
    prevent();
    diag.blockedNavigations.push(`${what} ${url}`);
    log(`막음(${what}): ${url}`, 'warn');
  };
  const inWebview = (url: string) => { try { return !!bridge && new URL(url).origin === bridge.webviewOrigin; } catch { return false; } };
  // will-frame-navigate 가 먼저 온다(여기서 막으면 will-navigate 는 오지 않는다) — 맨 위 창도 여기서 막고 적는다
  wc.on('will-navigate', e => e.preventDefault());
  wc.on('will-frame-navigate', e => {
    if (e.isMainFrame) { refuse('navigate', e.url, () => e.preventDefault()); return; }
    if (inWebview(e.url) || e.url === 'about:blank') { return; }
    refuse('frame', e.url, () => e.preventDefault());
  });
  wc.on('will-redirect', (e, url) => {
    const main = (e as unknown as { isMainFrame?: boolean }).isMainFrame !== false;
    if (!main && (inWebview(url) || url === 'about:blank')) { return; }
    refuse(main ? 'redirect-top' : 'redirect', url, () => e.preventDefault());
  });
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
      if (/^(https?|wss?|ftp):$/.test(u.protocol) && u.origin !== b.origin && u.origin !== b.webviewOrigin) { cancel = true; }
    } catch { cancel = false; }
    if (cancel) { diag.blockedNavigations.push(`request ${details.url}`); }
    cb({ cancel });
  });
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const headers = details.requestHeaders;
    delete headers['X-StCFSD-Key'];
    if (sameOrigin(details.url)) { headers.Authorization = `Bearer ${b.token}`; } else { delete headers.Authorization; }
    // 쓰기 열쇠(V5-04 · V5-18 · V5b-04): 틀 서버로 가는 요청 가운데 **맨 위 프레임 문서의 스크립트가 낸 fetch/XHR** 에만.
    // 이동(mainFrame · subFrame — 끼운 웹뷰가 `top.location` · `target=_top` 으로 일으킬 수 있다)에는 붙이지 않는다. 그 프레임의
    // 문서가 틀 출처일 때만(다른 곳으로 옮겨진 맨 위 문서는 없다 — 이동을 막는다). 페이지는 열쇠를 모른다.
    const frame = (details as { frame?: Electron.WebFrameMain | null }).frame;
    const ownScript = details.resourceType === 'xhr' && !!frame && !frame.parent && isFrameOrigin(frame.url);
    // R1-3 층 4(기록 설계 §3.5): 사람만 하는 일(/api/person/* 의 쓰기)에는 맨 위 틀에서 사람의 입력(누름 · 키)이 있은 뒤 2 초 안에만 열쇠를 붙인다 —
    // 화면의 스크립트가 스스로 보낸 POST 는 열쇠가 없어 403
    let personPath = false;
    try { personPath = details.method !== 'GET' && new URL(details.url).pathname.startsWith('/api/person/'); } catch { personPath = false; }
    const personOk = !personPath || Date.now() - lastPersonInput <= PERSON_INPUT_MS;
    if (personPath) { diag.personRequests.push({ path: new URL(details.url).pathname, keyed: ownScript && personOk, sinceInput: Date.now() - lastPersonInput }); }
    if (isFrameOrigin(details.url) && ownScript && personOk) {
      headers['X-StCFSD-Key'] = b.writeKey;
      diag.keyedRequests += 1;
      diag.keyedLog.push({ method: details.method, path: new URL(details.url).pathname, type: details.resourceType });
      if (diag.keyedLog.length > 200) { diag.keyedLog.shift(); }
    }
    cb({ requestHeaders: headers });
  });
  // 권한: 보고서의 「클립보드 복사」만.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write');
  return ses;
}

/** 창에 싣는 화면의 경로 — 기본은 새 검토 화면(`/ui/`, U4). `--ui classic` 이거나 다리가 새 화면을 내주지 못하면 틀(`/`) */
function screenPath(b: HostApi.BridgeHandle): string {
  return args.screen === 'ui' && b.uiUrl ? '/ui/' : '/';
}

function setTheme(t: 'dark' | 'light'): void {
  theme = t;
  writePrefs({ theme: t });
  for (const id of ['theme-dark', 'theme-light']) {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (item) { item.checked = id === `theme-${t}`; }
  }
  if (win && !win.isDestroyed() && bridge) {
    // 페이지를 다시 싣지 않는다(V5-03) — 틀 · 새 화면 모두 그 자리에서 바꾸고, 끼운 웹뷰에는 postMessage 로 알린다.
    // 다시 실으면 아직 호스트에 가지 않은 설계 탭 입력이 사라졌다.
    const call = screenPath(bridge) === '/ui/'
      ? `window.__stcfsdUi && window.__stcfsdUi.setTheme(${JSON.stringify(t)})`
      : `window.__stcfsdFrame && window.__stcfsdFrame.setTheme(${JSON.stringify(t)})`;
    void win.webContents.executeJavaScript(call, true).catch(() => undefined);
    win.setBackgroundColor(t === 'light' ? '#ffffff' : '#1f1f1f');
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
  // 창 닫기(창의 ✕ · 메뉴의 끝내기 · Alt+F4) — 저장 안 한 변경이 있으면 먼저 묻는다(V5-12c). 프로그램이 스스로 끝낼 때
  // (시험 · 신호 · IPC shutdown — appQuitting)는 묻지 않는다.
  let closeConfirmed = false;
  w.on('close', e => {
    if (!closeConfirmed && !appQuitting && host && started) {
      e.preventDefault();
      void confirmUnsaved('close').then(go => {
        if (!go || w.isDestroyed()) { return; }
        closeConfirmed = true;
        w.close();
      });
      return;
    }
    clearTimeout(stateTimer); saveWindowState();
  });
  w.on('closed', () => { if (win === w) { win = undefined; } });
  // V9b-08 · S1: 사람의 입력은 맨 위 틀의 자기 문서에서만(preload 의 IPC — 보낸 프레임이 이 창의 mainFrame 일 때)
  ipcMain.removeAllListeners(PERSON_INPUT_CHANNEL);
  ipcMain.on(PERSON_INPUT_CHANNEL, (e) => {
    // 이 창의 맨 위 틀(mainFrame)에서 온 것만 — 끼운 iframe 에는 preload 가 없고, 다른 창 · 프레임은 세지 않는다
    if (e.sender !== w.webContents || e.senderFrame !== w.webContents.mainFrame) { diag.inputIgnored++; return; }
    lastPersonInput = Date.now(); diag.topInputs++;
  });
  // V7-S3: 로그오프 · 종료 — 막지 않고 복구본을 쓴다
  w.on('query-session-end', () => { void writeRecovery('query-session-end'); });
  w.on('session-end', () => { void writeRecovery('session-end'); });
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
    // 작업 표시줄 단추만 깜빡인다(창을 앞으로 꺼내지 않는다). 사용자가 창으로 오면(focus) 멈춘다. 규칙은 questionSignal 하나.
    const sig = questionSignal({ focused: win.isFocused(), test: TEST });
    diag.questionPolicy.push(sig);
    if (sig.count) { diag.flashCalls += 1; }
    if (sig.flash) { win.flashFrame(true); }
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
  try {
    logger = createLogger({ dir: path.join(userData, 'logs'), echo: DEV || TEST });
  } catch (err) {
    // 로그 폴더를 만들 수 없다(V5-11) — 보이는 오류 상자 길로
    return failStartup('userdata', `로그 폴더를 만들 수 없습니다.\n폴더: ${path.join(userData, 'logs')}\n까닭: ${String((err as Error)?.message ?? err)}`);
  }
  restoreConsole = logger.captureConsole();
  process.on('uncaughtException', err => log(`잡히지 않은 예외: ${err?.stack ?? err}`, 'error'));
  process.on('unhandledRejection', err => log(`처리되지 않은 거부: ${(err as Error)?.stack ?? err}`, 'error'));
  app.on('child-process-gone', (_e, d) => log(`보조 프로세스가 끝났다: ${d.type} ${d.reason} (${d.exitCode})`, d.reason === 'clean-exit' ? 'info' : 'warn'));
  const v = process.versions;
  log(`시작 pid=${process.pid} · Electron ${v.electron} · Chromium ${v.chrome} · Node ${v.node} · ${TEST ? '시험 · ' : ''}userData=${userData}`);
  if (TEST) { installTestDialogs(); }

  diag.stage = 'files';
  layout = resolveLayout({ packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath, env: ENV });
  log(`배치: ${layout.kind} · appRoot=${layout.appRoot}`);
  const missing = missingFiles(layout);
  if (missing.length) {
    await failStartup('files', `${missing.join('\n')}${layout.kind === 'dev'
      ? '\n\n저장소 루트에서 npx tsc -p ./, desktop 에서 npm run build 를 먼저 돌리십시오.' : '\n\n프로그램을 다시 설치해 주십시오.'}`);
  }
  diag.stage = 'python';
  const py = findPython(layout, ENV);
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
  documentsDir = ENV.STCFSD_DOCUMENTS ? path.resolve(ENV.STCFSD_DOCUMENTS) : app.getPath('documents');
  platform = api.createBridgePlatform({
    log: line => logger?.host(line),
    documentsDir,
    fileDialog: nativeFileDialog,
    openExternal,
    openPath: openLocalFile,
    showInFolder: showLocalFile,
    notifyWithoutScreen,
  });
  // V7-01(82194ef): 결과를 봉인하는 이 PC 의 기록자 열쇠 폴더 — 프로그램의 사용자 자료 폴더 안(<userData>\writer). 시험은 --user-data 의
  // 임시 폴더라 그 안이다(진짜 폴더가 아니다). 호스트(확장의 activate)가 읽기 전에 정한다. 밖에서 준 값(STCFSD_WRITER_KEY_DIR)은 받지 않는다 —
  // 열쇠는 이 프로그램의 자리에만
  process.env.STCFSD_WRITER_KEY_DIR = path.join(userData, 'writer');
  // R1-3: 프로젝트 뿌리 — 사람의 문서 폴더(app.getPath('documents') — 옮긴 문서 폴더를 따른다) 아래 「StCFSD 프로젝트」. 시험은 STCFSD_DOCUMENTS 의
  // 임시 폴더 안. 다른 뿌리는 사람이 「폴더에서 열기」로 고른 폴더만(최근 목록 — 호스트). 밖에서 준 값은 받지 않는다
  process.env.STCFSD_PROJECT_ROOTS = path.join(documentsDir || app.getPath('documents'), 'StCFSD 프로젝트');
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
      // 새 검토 화면이 기본(U4). 폴더가 없으면 다리가 /ui/ 를 내주지 않고 틀을 연다. `--ui classic` 은 `/` 가 예전의 틀.
      uiDir: fs.existsSync(path.join(layout.uiDir, 'index.html')) ? layout.uiDir : undefined,
      defaultScreen: args.screen,
      // V7-41: 끼운 화면의 Open(새 화면의 Ctrl+O · 시작 화면 · 제목 표시줄도 그것을 누른다)도 같은 물음으로
      beforeReplace: () => confirmUnsaved('page-open'),
    });
    if (args.screen === 'ui' && !bridge.uiUrl) { log(`새 검토 화면이 없다(${layout.uiDir}) — 틀을 연다`, 'warn'); }
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
  // 명령줄의 파일(여럿이면 첫 것 + 알림), 그다음 시작 중에 온 것을 온 차례대로(V5-12a — 앞의 것을 버리지 않는다)
  const queued = pendingOpens.splice(0);
  if (args.open) { await openFiles([args.open, ...(args.extra ?? [])]); }
  for (const f of queued) { await openFile(f); }
  for (const n of notices.splice(0)) { void n(); }
  tellRecovery();
  send({ type: 'stage', stage: 'running', pid: process.pid, origin: bridge.origin, portFile, userData, screen: screenPath(bridge) });
}

/** 시험 · 개발에서 Claude 설정 파일을 바꿔 끼운다. 시험인데 주지 않았으면 사용자 폴더 안의 없는 경로(= 설치 안 됨) */
function claudeConfigPath(): string | undefined {
  if (ENV.STCFSD_CLAUDE_CONFIG) { return path.resolve(ENV.STCFSD_CLAUDE_CONFIG); }
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
    hostAction, confirmUnsaved, writeRecovery, recoveryDir,
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
    const d = data as { open?: string | null; extra?: string[] } | undefined;
    const parsed = d && 'open' in d ? { open: d.open ?? undefined, extra: Array.isArray(d.extra) ? d.extra : [] } : parseArgs(argv, cwd, Boolean(process.defaultApp));
    const files = parsed.open ? [parsed.open, ...(parsed.extra ?? [])] : [];
    diag.secondInstances.push({ open: files[0] ?? null, at: Date.now() });
    log(`다시 실행됨${files.length ? ` — 열 파일 ${files.join(', ')}` : ''}${started ? '' : ' (아직 시작 중 — 차례에 둔다)'}`);
    bringToFront();
    // 시작 중이면 openFile 이 차례에 둔다(V5-12a). 떠 있으면 — 저장 안 한 변경이 있으면 먼저 묻는다(V5-12c, 화면 안의 물음).
    // 파일 연결(탐색기에서 .csd 두 번 누름)도 Windows 에서는 이 길(다시 실행)로 온다.
    if (files.length && started) {
      const viaAssoc = argv.some(a => PROJECT_EXT.test(a)) && !argv.includes('--open');
      void confirmUnsaved(viaAssoc ? 'file-association' : 'second-instance').then(go => { if (go) { void openFiles(files); } });
    } else { void openFiles(files); }
  });
  app.on('web-contents-created', (_e, wc) => { if (wc.getType() === 'window') { guardContents(wc); } });
  app.on('window-all-closed', () => { app.quit(); });
  // 프로그램이 스스로 끝내는 길(신호 · 시험 · IPC) — 창의 닫기 물음을 거치지 않는다
  app.on('before-quit', () => { appQuitting = true; });
  // macOS 의 파일 연결(Windows 는 다시 실행으로 온다)
  app.on('open-file', (e, file) => {
    e.preventDefault();
    if (!started) { void openFiles([file]); return; }
    void confirmUnsaved('file-association').then(go => { if (go) { void openFiles([file]); } });
  });
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
