/**
 * 적재기 — `require('vscode')` 를 대체 모듈로 가로채고, 지금의 확장 호스트(`<repoRoot>/out/extension.js`,
 * 루트의 `tsc -p ./` 출력)를 고치지 않고 Node 에서 `activate()` 한다.
 *
 * `out/` 은 번들이 아니라 파일 여럿이다(`extension.js` · `webview/StcfsdPanel.js` · `mcp/bridge.js` …).
 * 그중 `vscode` 를 가져오는 것이 셋이어도 `Module._resolveFilename` 한 군데만 가로채면 된다 — 'vscode' 를
 * 가짜 파일 이름으로 돌리고, 그 이름의 모듈을 `require.cache` 에 미리 넣어 둔다.
 *
 * 활성화의 끝은 `await activate(context)` 로 안다(StCFSD 의 activate 는 async 이고 안에서 다 끝낸다).
 *
 * 설계 패널 — StCFSD 에서는 모델과 결과가 패널 객체(`StcfsdPanel`)의 필드이고, MCP 다리는
 * `StcfsdPanel.currentPanel` 에 일을 넘긴다. 패널이 없으면 MCP 도구 59개 가운데 58개가 실패한다.
 * 그래서 활성화 뒤 곧바로 `stcfsd.openDesigner` 로 패널을 만들고 `hub.pin()` 으로 고정한다 —
 * 프로그램이 끝날 때까지 없어지지 않는다(닫기 요청은 숨김이 된다, `vscode/webview.ts`).
 *
 * MCP 연결 — 포트 파일 방식(K1)으로만 띄운다. 활성화 **전에** `process.env.STCFSD_MCP_PORT_FILE` 을 둔다.
 * 그러면 확장의 다리가 빈 포트에서 듣고, 프로세스마다 토큰을 만들고, 그 파일에 `{port, token, pid, …}` 를
 * 쓴다(멈추거나 프로세스가 끝나면 지운다). 적재기는 활성화 뒤 그 파일을 읽어 포트 · 토큰을 안다
 * (`out/mcp/portFile.js` 의 `readPortFile`). 다리의 모든 요청에 `Authorization: Bearer <토큰>` 이 있어야 한다.
 * 호스트 · 화면의 조회는 `X-StCFSD-Request-Id` 를 붙이지 않는다 — 그 머리는 AI 의 호출 표시다(`GET /last-call`).
 *
 * MCP 설정 파일 — 확장은 지금 방식(변수 없음)에서 활성화 때 `.mcp.json` · `.claude/mcp.json`(작업 폴더) ·
 * `<확장 폴더>/.mcp.json` · `~/.claude/mcp.json` 을 쓴다(`src/extension.ts` `setupMcpConfig`). 포트 파일 방식이면
 * 그 분기에 가지 않는다(K1) — 독립 프로그램은 그 파일들을 쓰지 않는다. 작업 폴더도 없다(`workspaceFolders` =
 * undefined). 활성화 앞뒤로 그 파일들의 수정 시각을 비교해 바뀌었으면 크게 남긴다(`mcpConfigWrites`).
 * 확장의 등록 명령(`stcfsd.registerMcpServer` · `unregisterMcpServer` · `showMcpStatus`)은 지금 방식의 항목(`node` ·
 * 고정 포트)을 사용자 설정 파일에 쓰거나 그것을 기준으로 보이므로 막는다(`commands.block`). Claude Desktop 등록은 S4 의 일이다.
 */
import Module from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHeadlessPlatform, withScriptedAnswers, type HostPlatform, type NotifyRequest } from './platform';
import { attachScreenlessStandIn, type ScreenlessStandIn } from './standin';
import { createVscodeShim, type ShimRuntime, type WebviewResourceMapper } from './vscode';
import { createExtensionContext } from './vscode/context';
import { ExtensionMode } from './vscode/types';

/** 기록의 사람만 하는 얼굴(src/records/desk.ts PersonFace) — MCP · 화면 문맥 안에서 부르면 PersonOnlyError */
export interface RecordsPersonFace {
  openFolder(dirAbs: string): { name: string; projectId: string; readOnly: boolean; warnings: string[]; cases: number };
  createProject(rootAbs: string, name: string): { name: string; projectId: string; readOnly: boolean; warnings: string[]; cases: number };
  takeLock(caseId: string): unknown;
  archive(caseId: string, archived: boolean): void;
  /** 뿌리 · 최근의 프로젝트 — 폴더 경로는 사람의 얼굴로만(215cb5a) */
  projects(): Array<{ name: string; dir: string; cases: number; lastWork: string | null; open: boolean }>;
  currentProject(): { name: string; dir: string; readOnly: boolean } | null;
  /** 옮긴 · 이름을 바꾼 대상을 사람이 고른 파일(02_검토대상 안의 .csd)에 다시 잇는다 */
  relink(caseId: string, fileAbs: string): { caseId: string; file: string };
  writerName(): string;
  setWriterName(name: string): string;
  /** 밖에서 바뀐 파일을 덮어써도 된다 — external 줄을 남기고 다음 저장의 대조를 지금 파일로 */
  allowOverwrite(): { fileSha: string };
  /** R4: 확인 표시(사람만) — 대상 {type, key | kind | group | changeId | id, shown}. shown 이 지금 지문과 다르면 던진다 */
  review(req: { mark: boolean; targets: unknown[] }): { event: 'mark' | 'unmark'; targets: number; line: string };
  /** R4: 다른 작성자를 믿는다 / 믿지 않는다(그 작성자 소개가 프로젝트에 있어야) */
  trust(writerId: string, trust: boolean): { writerId: string; name: string; trusted: boolean };
}

/** R2-2: 편집 상태의 시작 · 끝 · 버리기(StcfsdPanel.editSession — 사람의 길로만, MCP 문맥에서는 ok false) */
export type EditSessionState = 'start' | 'end' | 'discard';
/** AI 의 호스트 동작 하나(시작 · 끝) — 「AI 작업 중 · <도구> · 경과」 띠 */
export interface AiWork { phase: 'begin' | 'end'; tool: string; requestId: string | null; client: string | null; at: string }

export interface StartHostOptions {
  /** 저장소 루트(뒤에 설치본에서는 리소스 폴더). `out/extension.js` · `python/` · `media/` · `webview/` · `.venv` 가 여기 있다 */
  repoRoot: string;
  /** settings.json · globalStorage 를 둘 곳(폴더는 쓸 때 만든다) */
  userDataDir: string;
  platform?: HostPlatform;
  /** 파일에 쓰지 않는 설정 덮어쓰기. 예: { 'python.defaultInterpreterPath': 'C:\\…\\python.exe' } */
  settings?: Record<string, unknown>;
  /**
   * 묶어 넣은 Python 을 가리킨다(설치본). 설정 `python.defaultInterpreterPath` 로 넘긴다.
   * 확장은 `<repoRoot>/.venv` 를 먼저 보므로 `.venv` 가 있으면 쓰이지 않는다(경고를 남긴다).
   * 주지 않으면 환경 변수 `STCFSD_PYTHON` 을 본다.
   */
  pythonPath?: string;
  /**
   * MCP 포트 파일(K1). 꼭 준다 — 기본값을 두지 않아 시험 · 개발판이 사용자의 진짜 앱 데이터 폴더에 쓰지 않게 한다.
   * 설치본은 `standardPortFile(appDataDir())` = `%APPDATA%\StCFSD\mcp\stcfsd-mcp-port` 를 준다.
   */
  portFile: string;
  /** MCP 다리 포트를 정한다(개발용). 주지 않으면 빈 포트(포트 파일 방식의 기본) */
  mcpPort?: number;
  /** 화면이 없다 — 설계 패널에 웹뷰 대역을 붙인다(`standin.ts`). 기본 true. S2 의 다리는 false 로 준다 */
  screenless?: boolean;
  webviewResources?: WebviewResourceMapper;
  /** 적재기·대체 모듈의 기록 */
  log?: (line: string) => void;
  /** activate · 패널 준비를 기다리는 상한(ms) */
  activationTimeoutMs?: number;
}

export interface McpEndpoint {
  port: number;
  /** 다리의 Bearer 토큰(포트 파일에도 있다). 화면 다리 · 시험이 쓴다 — 출력하지 않는다 */
  token: string;
  /** 포트 파일의 절대 경로 */
  portFile: string;
  /** MCP 서버(`media/mcp-server.js`)가 부르는 주소 — `GET /status` · `POST /action` · `GET /last-call` */
  url: string;
  /** MCP 클라이언트가 띄울 서버 */
  serverScript: string;
  /** 그 서버에 줄 환경 변수(`STCFSD_MCP_PORT_FILE` · `STCFSD_MCP_STANDALONE`) */
  env: Record<string, string>;
  /** Claude Desktop 설정에 넣을 항목(K1 `standaloneMcpEntry`, 개발판은 command = 이 node). 쓰지 않는다 — S4 의 일 */
  entry?: unknown;
}

export interface DesignerPanel {
  /** 웹뷰 id(hub) */
  id: string;
  /** hub 에 있고 `StcfsdPanel.currentPanel` 이 이 패널이다 */
  alive(): boolean;
  /** 웹뷰 → 호스트 메시지를 넣는다(화면이 하는 일) */
  deliver(message: unknown): boolean;
}

export interface FileResult {
  ok: boolean;
  file: string;
  /** 호스트가 끝에 낸 알림 */
  severity?: NotifyRequest['severity'];
  message?: string;
}

export interface HostHandle {
  /** 확장이 받은 것과 같은 vscode 대체 모듈 */
  vscode: unknown;
  runtime: ShimRuntime;
  context: ReturnType<typeof createExtensionContext>;
  commands: {
    ids(): string[];
    execute<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  /** 화면 다리의 접점 — 웹뷰 목록·HTML·메시지 넣기/듣기 */
  webviews: ShimRuntime['hub'];
  designer: DesignerPanel;
  /** 화면 없이 띄웠다(웹뷰 대역이 붙어 있다) — 화면 다리는 false 인 호스트에만 붙는다 */
  screenless: boolean;
  mcp: McpEndpoint;
  /** 확장이 쓸 Python(확장의 `getPythonPath` 와 같은 순서로 판단한 것) */
  python: { path: string; source: '.venv' | 'python.defaultInterpreterPath' | 'PATH' };
  activationMs: number;
  /** activate 끝 → 설계 패널 준비(기본 단면)까지 */
  panelMs: number;
  /** 호스트 → 웹뷰 메시지 수(명령별). 화면이 없어도 만들어진다 */
  messageCounts(): Record<string, number>;
  /** 활성화 중에 바뀐 MCP 설정 파일(있으면 안 된다) */
  mcpConfigWrites(): string[];
  /** `.csd` 를 연다 — 확장의 「열기」 길(openProject → 열기 대화상자 → `_loadProjectFile`)을 그대로 탄다 */
  openProject(file: string): Promise<FileResult>;
  /** `.csd` 로 저장한다 — 「저장」 길(saveProject → 저장 대화상자 → `_writeProjectFile` — K2: 입력은 호스트의 검토 상태에서) */
  saveProject(file: string): Promise<FileResult>;
  /**
   * 복구 사본(V7-S3 — 4b99968 의 `StcfsdPanel.writeRecoveryCopy`): root 안의 새 `.csd` 하나. 지금 파일 · 저장 기준 · 화면을 바꾸지 않는다.
   * 같은 프로세스의 셸만 부른다(MCP 에는 없다)
   */
  writeRecoveryCopy(file: string, root: string): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  /**
   * R1-3: 기록의 사람만 하는 얼굴(`StcfsdPanel.currentPanel.recordsPerson` — openFolder · createProject · takeLock · archive).
   * 같은 프로세스의 다리만 받는다(HTTP 로 드러나지 않는다 — 설계 §3.5 층 2). 열쇠 자리가 없으면 null
   */
  recordsPerson(): RecordsPersonFace | null;
  /** R1-3: 프로젝트 뿌리(`StcfsdPanel.projectRoots` — STCFSD_PROJECT_ROOTS) */
  projectRoots(): string[];
  /**
   * R1-3: 이 프로세스의 화면 비밀(`out/mcp/actorScope.js` SCREEN_SECRET) — 다리의 중계가 `X-StCFSD-Screen` 에 실어 새 화면이 시작한
   * 실행을 사람의 것으로 적게 한다. 파일 · 포트 파일 · 화면에 쓰지 않는다. 없으면(옛 out/) null
   */
  screenSecret(): string | null;
  /** R2-3: 편집 상태의 시작 · 끝 · 버리기를 호스트에(사람의 길 — 다리만 부른다). 패널이 없으면 null */
  editSession(state: EditSessionState): { ok: boolean; backToStart?: boolean; restored?: string[] } | null;
  /** R2-3: AI(MCP 문맥)의 호스트 동작이 시작 · 끝날 때 — 띠 「AI 작업 중 · <도구> · 경과」 */
  onAiWork(cb: (w: AiWork) => void): void;
  unimplemented():Array<{ name: string; count: number }>;
  dispose(): Promise<void>;
}

const SHIM_FILENAME = path.join(__dirname, '__stcfsd_vscode_shim__.js');
const DESIGNER_VIEW_TYPE = 'stcfsd.designer';
let active: { runtime: ShimRuntime } | undefined;

type ResolveFn = (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;
const ModuleInternals = Module as unknown as {
  _resolveFilename: ResolveFn;
  _cache: Record<string, NodeJS.Module>;
};

function installVscodeHook(api: unknown): () => void {
  const original = ModuleInternals._resolveFilename;
  const patched: ResolveFn = function (this: unknown, request, parent, isMain, options) {
    if (request === 'vscode') { return SHIM_FILENAME; }
    return original.call(this, request, parent, isMain, options);
  };
  ModuleInternals._resolveFilename = patched;
  const m = new Module(SHIM_FILENAME);
  m.filename = SHIM_FILENAME;
  m.exports = api;
  m.loaded = true;
  ModuleInternals._cache[SHIM_FILENAME] = m;
  return () => {
    if (ModuleInternals._resolveFilename === patched) { ModuleInternals._resolveFilename = original; }
    delete ModuleInternals._cache[SHIM_FILENAME];
  };
}

/** out/ 의 모듈을 require.cache 에서 지운다 — 다시 startHost 하면 새 모듈 전역(StcfsdPanel.currentPanel 등)으로 시작한다. */
function purgeOutCache(outDir: string): void {
  for (const key of Object.keys(ModuleInternals._cache)) {
    if (key.startsWith(outDir + path.sep)) { delete ModuleInternals._cache[key]; }
  }
}

/**
 * `out/extension.js` 가 `src/` 보다 오래됐는가. src 가 없으면(설치본) false.
 * tsc 는 빌드마다 모든 출력을 다시 쓰므로 extension.js 하나의 시각으로 본다.
 * `src/mcp/server.ts` 는 tsc 대상이 아니다(webpack → media/mcp-server.js) — 뺀다.
 */
export function isOutStale(repoRoot: string): { stale: boolean; newest?: string } {
  const entry = path.join(repoRoot, 'out', 'extension.js');
  const srcDir = path.join(repoRoot, 'src');
  if (!fs.existsSync(srcDir)) { return { stale: false }; }
  let outTime = 0;
  try { outTime = fs.statSync(entry).mtimeMs; } catch { return { stale: true, newest: '(out/extension.js 없음)' }; }
  const skip = new Set([path.join(srcDir, 'mcp', 'server.ts'), path.join(srcDir, 'webview', 'viewer3d')]);
  let newest: { file: string; t: number } | undefined;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (skip.has(p)) { continue; }
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.ts')) { continue; }
      const t = fs.statSync(p).mtimeMs;
      if (!newest || t > newest.t) { newest = { file: p, t }; }
    }
  };
  walk(srcDir);
  return newest && newest.t > outTime ? { stale: true, newest: path.relative(repoRoot, newest.file) } : { stale: false };
}

/** 확장이 활성화 때 쓰는 MCP 설정 파일 후보(`setupMcpConfig`). 작업 폴더는 없으니 둘이다. */
export function mcpConfigCandidates(repoRoot: string): string[] {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return [path.join(repoRoot, '.mcp.json'), ...(home ? [path.join(home, '.claude', 'mcp.json')] : [])];
}

const statKey = (file: string) => { try { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}`; } catch { return 'none'; } };

/** 확장의 `getPythonPath` 와 같은 순서(.venv → python.defaultInterpreterPath → PATH 의 python) */
function describePython(repoRoot: string, configured: string | undefined): HostHandle['python'] {
  for (const p of [path.join(repoRoot, '.venv', 'Scripts', 'python.exe'), path.join(repoRoot, '.venv', 'bin', 'python')]) {
    if (fs.existsSync(p)) { return { path: p, source: '.venv' }; }
  }
  if (configured && configured !== 'python') { return { path: configured, source: 'python.defaultInterpreterPath' }; }
  return { path: process.platform === 'win32' ? 'python' : 'python3', source: 'PATH' };
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = probe();
    if (v !== undefined) { return v; }
    if (Date.now() > deadline) { throw new Error(`${what}: ${timeoutMs}ms 안에 오지 않았다`); }
    await new Promise(r => setTimeout(r, 25));
  }
}

/** 이 프로세스의 자식 프로세스 핸들 수(Python 이 끝났는지 본다) */
const processHandles = () => process.getActiveResourcesInfo().filter(h => h === 'ProcessWrap').length;

export async function startHost(opts: StartHostOptions): Promise<HostHandle> {
  if (active) { throw new Error('이 프로세스에는 이미 호스트가 떠 있다. 먼저 dispose() 하라.'); }
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const repoRoot = path.resolve(opts.repoRoot);
  const outDir = path.join(repoRoot, 'out');
  const entry = path.join(outDir, 'extension.js');
  if (!fs.existsSync(entry)) { throw new Error(`확장 호스트가 없다: ${entry} — 저장소 루트에서 npx tsc -p ./`); }
  const staleness = isOutStale(repoRoot);
  if (staleness.stale) { log(`[host] 경고: out/ 이 src/ 보다 오래됐다(${staleness.newest}) — 저장소 루트에서 npx tsc -p ./`); }
  const userDataDir = path.resolve(opts.userDataDir);
  const timeoutMs = opts.activationTimeoutMs ?? 90_000;

  const scripted = withScriptedAnswers(opts.platform ?? createHeadlessPlatform({ log }), log);
  const pythonOverride = opts.pythonPath ?? process.env.STCFSD_PYTHON;
  const settings = { ...(opts.settings ?? {}),
    ...(pythonOverride ? { 'python.defaultInterpreterPath': path.resolve(pythonOverride) } : {}) };
  const { api, runtime } = createVscodeShim({
    platform: scripted.platform,
    packageJsonPath: path.join(repoRoot, 'package.json'),
    settingsFile: path.join(userDataDir, 'settings.json'),
    settingOverrides: settings,
    webviewResources: opts.webviewResources,
    log,
    appRoot: repoRoot,
  });
  const python = describePython(repoRoot, runtime.config.value<string>('python.defaultInterpreterPath'));
  if (pythonOverride && python.source === '.venv') {
    log(`[host] 경고: ${python.path} 이 있어 확장이 그것을 먼저 쓴다 — 지정한 Python(${pythonOverride})은 쓰이지 않는다`);
  }
  const context = createExtensionContext({
    extensionPath: repoRoot,
    userDataDir,
    extensionMode: ExtensionMode.Production,
  }, runtime.tracker);
  // 지금 방식의 등록 명령은 사용자 설정 파일에 `node` · 고정 포트 항목을 쓴다 — 독립 프로그램에서 막는다(머리말).
  for (const id of ['stcfsd.registerMcpServer', 'stcfsd.unregisterMcpServer', 'stcfsd.showMcpStatus']) {
    runtime.commands.block(id, 'VS Code 확장의 MCP 등록(고정 포트 · .mcp.json)이다. 독립 프로그램은 포트 파일로 붙는다(Claude Desktop 연결은 S4)');
  }

  // 포트 파일 방식 — 활성화 전에 둔다. 활성화가 끝나면 되돌린다(같은 프로세스의 다른 코드에 새지 않게).
  if (!opts.portFile) { throw new Error('portFile 이 없다 — 포트 파일 방식으로만 띄운다'); }
  const portFile = path.resolve(opts.portFile);
  const PORT_FILE_ENV = 'STCFSD_MCP_PORT_FILE';
  const prevPortFileEnv = process.env[PORT_FILE_ENV];

  // 호스트 → 웹뷰 메시지 수. 패널이 생기기 전부터 센다.
  const counts: Record<string, number> = {};
  const countSub = runtime.hub.onDidPostMessage.event(({ message }) => {
    const cmd = String((message as { command?: unknown } | undefined)?.command ?? '(command 없음)');
    counts[cmd] = (counts[cmd] ?? 0) + 1;
  });
  const refuseSub = runtime.hub.onDidRefuseDispose.event(info => {
    log(`[host] 고정된 패널(${info.viewType})을 닫으려 했다 — 없애지 않고 숨겼다`);
  });

  const configFiles = mcpConfigCandidates(repoRoot);
  const configBefore = new Map(configFiles.map(f => [f, statKey(f)]));
  const changedConfigs = () => configFiles.filter(f => statKey(f) !== configBefore.get(f));

  const unhook = installVscodeHook(api);
  active = { runtime };
  const processHandlesBefore = processHandles();
  let ext: { activate(ctx: unknown): unknown; deactivate(): Promise<void> | void } | undefined;
  let standIn: ScreenlessStandIn | undefined;
  let restoreBridge = () => { /* 감싸지 않았다 */ };
  const restoreEnv = () => {
    if (prevPortFileEnv === undefined) { delete process.env[PORT_FILE_ENV]; } else { process.env[PORT_FILE_ENV] = prevPortFileEnv; }
  };

  const teardown = async () => {
    restoreEnv();
    standIn?.dispose();
    try { await ext?.deactivate(); } catch (err) { log(`[host] deactivate 예외: ${String(err)}`); }
    // VS Code 와 같이 deactivate 뒤에 subscriptions 를 역순으로 정리한다.
    for (const d of [...context.subscriptions].reverse()) {
      try { await d.dispose(); } catch (err) { log(`[host] subscription dispose 예외: ${String(err)}`); }
    }
    context.subscriptions.length = 0;
    countSub.dispose();
    refuseSub.dispose();
    runtime.dispose();
    restoreBridge();
    unhook();
    purgeOutCache(outDir);
    active = undefined;
    // deactivate 가 Python 을 kill 한다(PythonBridge.dispose). 실제로 끝날 때까지 잠시 기다린다.
    const deadline = Date.now() + 5_000;
    while (processHandles() > processHandlesBefore && Date.now() < deadline) { await new Promise(r => setTimeout(r, 25)); }
    if (processHandles() > processHandlesBefore) { log('[host] 경고: 5 초 안에 Python 프로세스가 끝나지 않았다'); }
  };

  try {
    purgeOutCache(outDir);
    // 포트 지정(개발용 --port)만 다리 클래스의 start 를 감싸 listen 전에 바꾼다. 포트 파일에는 실제 포트가 적힌다.
    // 주지 않으면 아무것도 감싸지 않는다 — 설치본의 길이다.
    if (opts.mcpPort !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bridgeMod = require(path.join(outDir, 'mcp', 'bridge.js')) as { McpBridgeServer?: { prototype: { start(): Promise<void> } } };
      const proto = bridgeMod.McpBridgeServer?.prototype;
      if (proto && typeof proto.start === 'function') {
        const origStart = proto.start;
        const port = opts.mcpPort;
        proto.start = function (this: { _port?: number }) {
          if (typeof this._port === 'number') { this._port = port; } else {
            log('[host] 경고: McpBridgeServer 의 모양이 바뀌었다(_port 없음) — 포트 지정을 무시한다');
          }
          return origStart.apply(this);
        };
        restoreBridge = () => { proto.start = origStart; };
      } else {
        log('[host] 경고: out/mcp/bridge.js 에 McpBridgeServer 가 없다 — 포트 지정을 무시한다');
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const portFileMod = require(path.join(outDir, 'mcp', 'portFile.js')) as {
      readPortFile(file: string): { ok: true; info: { port: number; token: string; pid: number } } | { ok: false; problem: string; detail?: string };
    };
    process.env[PORT_FILE_ENV] = portFile;
    const started = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ext = require(entry);
    await withTimeout(Promise.resolve(ext!.activate(context)), timeoutMs, '확장 activate');
    const activationMs = Date.now() - started;
    restoreEnv();
    // 다리는 듣기 시작한 뒤 파일을 쓴다 — activate 가 끝났으면 있어야 한다. 이 프로세스의 것일 때까지 기다린다.
    const portInfo = await waitFor(() => {
      const r = portFileMod.readPortFile(portFile);
      return r.ok && r.info.pid === process.pid ? r.info : undefined;
    }, 5_000, `MCP 포트 파일(${portFile})`);
    const writes = changedConfigs();
    if (writes.length) { log(`[host] 경고: 활성화 중에 MCP 설정 파일이 바뀌었다 — ${writes.join(', ')}`); }

    // 설계 패널 — 만들고 고정한다. openDesigner 는 Python 을 띄운 뒤 패널을 만든다.
    const panelStarted = Date.now();
    await withTimeout(runtime.commands.execute('stcfsd.openDesigner'), timeoutMs, 'stcfsd.openDesigner');
    const info = runtime.hub.list().find(w => w.viewType === DESIGNER_VIEW_TYPE);
    if (!info) { throw new Error(`stcfsd.openDesigner 뒤에 ${DESIGNER_VIEW_TYPE} 패널이 없다`); }
    runtime.hub.pin(info.id);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const panelMod = require(path.join(outDir, 'webview', 'StcfsdPanel.js')) as { StcfsdPanel?: { projectRoots?: string[]; prototype?: Record<string, unknown>;
      currentPanel?: { writeRecoveryCopy?: (f: string, r: string) => Promise<any>; recordsPerson?: RecordsPersonFace | null;
        editSession?: (s: string) => { ok: boolean; backToStart?: boolean; restored?: string[] }; onAiActivity?: (l: (e: any) => void) => () => void } } };
    let screenSecretValue: string | null = null;
    let currentActor: (() => { kind?: string; tool?: string; requestId?: string; client?: string } | undefined) | null = null;
    let runAsPerson: (<T>(fn: () => T) => T) | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const scope = require(path.join(outDir, 'mcp', 'actorScope.js')) as { SCREEN_SECRET?: unknown; currentActor?: () => any; runAs?: <T>(ctx: unknown, fn: () => T) => T };
      screenSecretValue = typeof scope.SCREEN_SECRET === 'string' && scope.SCREEN_SECRET.length >= 32 ? scope.SCREEN_SECRET : null;
      currentActor = typeof scope.currentActor === 'function' ? scope.currentActor : null;
      // 편집 상태의 신호는 사람의 문맥에서(웹뷰의 editSession 메시지와 같은 행위자 — 그 묶음은 「사용자 변경」)
      runAsPerson = typeof scope.runAs === 'function' ? <T>(fn: () => T): T => scope.runAs!({ kind: 'person' }, fn) : null;
    } catch { screenSecretValue = null; }
    // R2-3: AI 동작의 시작 · 끝 — 호스트의 panel.onAiActivity(373d81f, 보기 계약 4f). 엔진은 진행률을 내지 않는다(시작 · 끝뿐)
    const aiWorkCbs: Array<(w: AiWork) => void> = [];
    let aiSubscribed = false;
    const subscribeAi = (): void => {
      const p = panelMod.StcfsdPanel?.currentPanel;
      if (aiSubscribed || !p || typeof p.onAiActivity !== 'function') { return; }
      aiSubscribed = true;
      p.onAiActivity((e: any) => {
        const w: AiWork = { phase: e?.phase === 'start' ? 'begin' : 'end', tool: String(e?.tool ?? e?.action ?? '').slice(0, 80), requestId: typeof e?.id === 'string' ? e.id : null,
          client: typeof e?.client === 'string' ? e.client : null, at: String(e?.phase === 'start' ? e?.started_at : (e?.ended_at ?? e?.started_at) ?? new Date().toISOString()) };
        for (const cb of aiWorkCbs) { try { cb(w); } catch { /* 띠가 동작을 막지 않는다 */ } }
      });
    };
    void currentActor;
    const designer: DesignerPanel = {
      id: info.id,
      alive: () => runtime.hub.has(info.id) && !!panelMod.StcfsdPanel?.currentPanel,
      deliver: message => runtime.hub.deliver(info.id, message),
    };

    if (opts.screenless !== false) {
      // 웹뷰 대역이 webviewReady 를 보낸다 — 기본 단면이 만들어져 modelLoaded 가 올 때까지 기다린다.
      let ready = false;
      const readySub = runtime.hub.onDidPostMessage.event(({ id, message }) => {
        if (id === info.id && (message as { command?: string })?.command === 'modelLoaded') { ready = true; }
      });
      standIn = attachScreenlessStandIn(runtime.hub, info.id, log);
      try {
        await waitFor(() => (ready ? true : undefined), timeoutMs, '설계 패널의 기본 단면(modelLoaded)');
      } finally { readySub.dispose(); }
    }
    const panelMs = Date.now() - panelStarted;

    /**
     * 웹뷰 메시지 하나로 시작해 대화상자 하나를 거쳐 알림 하나로 끝나는 확장의 파일 길을 탄다.
     * 대화상자의 답은 미리 넣는다(아래 플랫폼에는 묻지 않는다). 끝 = 대화상자 뒤의 첫 알림.
     */
    let fileOp: Promise<FileResult> = Promise.resolve({ ok: true, file: '' });
    const runFileOp = (kind: 'open' | 'save', file: string, message: unknown): Promise<FileResult> => {
      const run = async (): Promise<FileResult> => {
        const abs = path.resolve(file);
        if (!designer.alive()) { return { ok: false, file: abs, message: '설계 패널이 없다' }; }
        let dialogDone = false;
        let notice: NotifyRequest | undefined;
        scripted.clearDialogs();
        scripted.queueDialog({ kind, paths: [abs] });
        scripted.onDialog = req => { if (req.kind === kind) { dialogDone = true; } };
        scripted.onNotify = req => { if (dialogDone && !notice) { notice = req; } };
        try {
          designer.deliver(message);
          await waitFor(() => notice, timeoutMs, `${kind === 'open' ? '열기' : '저장'}(${abs})의 끝 알림`);
        } finally {
          scripted.onDialog = undefined;
          scripted.onNotify = undefined;
          scripted.clearDialogs();
        }
        return { ok: notice!.severity !== 'error', file: abs, severity: notice!.severity, message: notice!.message };
      };
      // 파일 길은 한 번에 하나 — 대화상자 답과 끝 알림이 섞이지 않게.
      fileOp = fileOp.then(run, run);
      return fileOp;
    };

    const port = portInfo.port;
    const serverScript = path.join(repoRoot, 'media', 'mcp-server.js');
    let clientEntry: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cd = require(path.join(outDir, 'mcp', 'claudeDesktop.js')) as {
        standaloneMcpEntry(input: { command: string; serverScript: string; portFile: string; electron?: boolean }): unknown;
      };
      // 개발판은 이 node 로 띄운다(electron: false). 설치본은 StCFSD.exe + ELECTRON_RUN_AS_NODE(S4 · S5).
      clientEntry = cd.standaloneMcpEntry({ command: process.execPath, serverScript, portFile, electron: false });
    } catch (err) { log(`[host] 경고: out/mcp/claudeDesktop.js 를 읽지 못했다 — ${String(err)}`); }
    return {
      vscode: api,
      runtime,
      context,
      commands: {
        ids: () => runtime.commands.registeredIds(),
        execute: (id, ...args) => runtime.commands.execute(id, ...args),
      },
      webviews: runtime.hub,
      designer,
      screenless: opts.screenless !== false,
      mcp: {
        port,
        token: portInfo.token,
        portFile,
        url: `http://127.0.0.1:${port}`,
        serverScript,
        env: { STCFSD_MCP_PORT_FILE: portFile, STCFSD_MCP_STANDALONE: '1' },
        entry: clientEntry,
      },
      python,
      activationMs,
      panelMs,
      messageCounts: () => ({ ...counts }),
      mcpConfigWrites: () => changedConfigs(),
      openProject: file => runFileOp('open', file, { command: 'openProject' }),
      saveProject: file => runFileOp('save', file, { command: 'saveProject' }),
      recordsPerson: () => panelMod.StcfsdPanel?.currentPanel?.recordsPerson ?? null,
      projectRoots: () => (Array.isArray(panelMod.StcfsdPanel?.projectRoots) ? [...panelMod.StcfsdPanel!.projectRoots!] : []),
      screenSecret: () => screenSecretValue,
      editSession: (state) => {
        const p = panelMod.StcfsdPanel?.currentPanel;
        if (!p || typeof p.editSession !== 'function' || !runAsPerson) { return null; }
        return runAsPerson(() => p.editSession!(state));
      },
      onAiWork: (cb) => { aiWorkCbs.push(cb); subscribeAi(); },
      writeRecoveryCopy: async (file, root) => {
        const p = panelMod.StcfsdPanel?.currentPanel;
        if (!p || typeof p.writeRecoveryCopy !== 'function') { return { ok: false, error: '설계 패널이 없거나 이 판의 호스트에 복구 사본 쓰기가 없다' }; }
        try { return await p.writeRecoveryCopy(file, root); } catch (err) { return { ok: false, error: String((err as Error)?.message ?? err) }; }
      },
      unimplemented: () => runtime.tracker.list(),
      dispose: teardown,
    };
  } catch (err) {
    await teardown();
    throw err;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: ${ms}ms 안에 끝나지 않았다`)), ms); }),
  ]);
}

/** 개발판의 기본 사용자 폴더 — `%APPDATA%\StCFSD\desktop`(Windows), 그 밖은 `~/.stcfsd-desktop` */
export function defaultUserDataDir(): string {
  return process.platform === 'win32' && process.env.APPDATA
    ? path.join(process.env.APPDATA, 'StCFSD', 'desktop')
    : path.join(os.homedir(), '.stcfsd-desktop');
}
