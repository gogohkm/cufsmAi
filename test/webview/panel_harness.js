/* global process */
// W3: StcfsdPanel 을 VS Code 없이 Node 에서 띄우는 시험 도구.
// - src/*.ts 를 typescript.transpileModule 로 CommonJS 로 바꿔 메모리에서 불러온다(out/ 불필요).
// - 'vscode' 는 가짜 모듈(웹뷰 패널 · 메시지 상자 기록)로 바꾼다.
// - PythonBridge 는 진짜 파이썬 서버(.venv)로 띄운다. .venv 가 없으면 null 을 돌려준다(시험은 SKIP 을 분명히 적는다).
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..');

function pythonPath() {
  const win = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
  const nix = path.join(ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(win)) { return win; }
  if (fs.existsSync(nix)) { return nix; }
  return null;
}

function makeFakeVscode(log) {
  class Uri {
    constructor(fsPath) { this.fsPath = fsPath; this.path = fsPath; }
    static file(p) { return new Uri(p); }
    static parse(p) { return new Uri(p); }
    static joinPath(base, ...parts) { return new Uri(path.join(base.fsPath || String(base), ...parts)); }
    toString() { return this.fsPath; }
  }
  const panels = [];
  const window = {
    activeTextEditor: undefined,
    createWebviewPanel(viewType, title) {
      const listeners = { message: [], dispose: [] };
      const panel = {
        viewType, title,
        webview: {
          html: '',
          cspSource: 'vscode-test',
          asWebviewUri: (u) => u,
          onDidReceiveMessage: (cb) => { listeners.message.push(cb); return { dispose() {} }; },
          postMessage: (m) => { log.posted.push(m); return Promise.resolve(true); },
        },
        onDidDispose: (cb) => { listeners.dispose.push(cb); return { dispose() {} }; },
        reveal() {},
        dispose() { listeners.dispose.forEach((cb) => cb()); },
        _listeners: listeners,
      };
      panels.push(panel);
      return panel;
    },
    showInformationMessage: (...a) => { log.info.push(a[0]); return Promise.resolve(undefined); },
    showWarningMessage: (...a) => { log.warn.push(a[0]); return Promise.resolve(undefined); },
    showErrorMessage: (...a) => { log.error.push(a[0]); return Promise.resolve(undefined); },
    showSaveDialog: () => Promise.resolve(undefined),
    showOpenDialog: () => Promise.resolve(undefined),
  };
  return {
    Uri, window, panels,
    ViewColumn: { One: 1, Two: 2, Beside: -2 },
    workspace: { fs: { writeFile: () => Promise.resolve() }, getConfiguration: () => ({ get: () => undefined }) },
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} },
    TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  };
}

/** src 의 TS 파일을 메모리에서 CommonJS 로 불러온다. 'vscode' 는 fake 로. */
function loadTs(relFile, fakeVscode, cache = new Map()) {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  function load(absFile) {
    if (cache.has(absFile)) { return cache.get(absFile).exports; }
    const src = fs.readFileSync(absFile, 'utf8');
    const js = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: absFile,
    }).outputText;
    const mod = { exports: {} };
    cache.set(absFile, mod);
    const localRequire = (req) => {
      if (req === 'vscode') { return fakeVscode; }
      if (req.startsWith('.')) {
        const base = path.resolve(path.dirname(absFile), req);
        const cand = [base + '.ts', path.join(base, 'index.ts'), base + '.js'];
        for (const c of cand) { if (fs.existsSync(c)) { return c.endsWith('.ts') ? load(c) : require(c); } }
        throw new Error(`cannot resolve ${req} from ${absFile}`);
      }
      return Module.createRequire(absFile)(req);
    };
    new Function('exports', 'module', 'require', '__filename', '__dirname', js)(
      mod.exports, mod, localRequire, absFile, path.dirname(absFile));
    return mod.exports;
  }
  return load(path.join(ROOT, relFile));
}

/**
 * 패널 하나와 진짜 파이썬 브리지를 만든다. 반환 { panel, bridge, log, vscode, close() } 또는 null(.venv 없음).
 */
async function createPanel() {
  const py = pythonPath();
  if (!py) { return null; }
  process.env.STCFSD_TEST_MODE = '1';
  const log = { posted: [], info: [], warn: [], error: [] };
  const vscode = makeFakeVscode(log);
  const { PythonBridge } = loadTs(path.join('src', 'bridge', 'PythonBridge.ts'), vscode);
  // R1-2: 패널과 같은 모듈 저장소 — 시험이 같은 행위자 문맥(actorScope) · 다리를 불러 쓸 수 있게(load)
  const panelCache = new Map();
  const { StcfsdPanel } = loadTs(path.join('src', 'webview', 'StcfsdPanel.ts'), vscode, panelCache);
  const bridge = new PythonBridge(ROOT, py);
  await bridge.start();
  // V7-01: 결과 봉인의 열쇠 폴더는 시험의 출력 폴더(진짜 폴더 — 기록 갈래 defaultKeyDir — 는 쓰지 않는다)
  StcfsdPanel.writerKeyDir = path.join(ROOT, 'test', 'rendered', 'out', 'writer-key');
  StcfsdPanel.currentPanel = undefined;
  StcfsdPanel.createOrShow(vscode.Uri.file(ROOT), bridge, undefined);
  const panel = StcfsdPanel.currentPanel;
  await panel.__testDispatchMessage({ command: 'webviewReady' });
  // V7-17 ⑦: 시험의 임시 파일은 이 패널의 상자(mkdtemp) 안에 — close 가 상자째 지운다
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_w3_'));
  return {
    panel, bridge, log, vscode, StcfsdPanel,
    load(rel) { return loadTs(rel, vscode, panelCache); },
    posted(command) { return panel.__testGetPostedMessages().filter((m) => m.command === command); },
    tmpFile(name) { return path.join(box, name); },
    close() {
      try { vscode.panels.forEach((p) => p.dispose()); } catch { /* ignore */ }
      bridge.dispose();
      try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

module.exports = { createPanel, loadTs, makeFakeVscode, pythonPath, ROOT };
