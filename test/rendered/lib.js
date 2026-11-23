/* Rendered-webview test harness (promoted from verifier V4, W3). Opt-in: npm run test:rendered.
 * V4 harness: real StcfsdPanel (host, transpiled from src) + real Python server + real webview in headless Edge (CDP).
 * No npm packages: Node 22 built-in WebSocket + http. Repo files are only read.
 * MCP registration: extension.ts / src/mcp/registration.ts are never loaded (only PythonBridge + StcfsdPanel). */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const cp = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const HERE = __dirname;
const { loadTs, makeFakeVscode, pythonPath } = require(path.join(REPO, 'test', 'webview', 'panel_harness.js'));

const DARK_VARS = {
  '--vscode-button-background': '#0e639c', '--vscode-button-foreground': '#ffffff',
  '--vscode-button-hoverBackground': '#1177bb', '--vscode-button-secondaryBackground': '#3a3d41',
  '--vscode-button-secondaryForeground': '#ffffff', '--vscode-charts-blue': '#3794ff',
  '--vscode-charts-green': '#89d185', '--vscode-charts-orange': '#d18616',
  '--vscode-descriptionForeground': '#9d9d9d', '--vscode-editor-background': '#1e1e1e',
  '--vscode-editor-fontFamily': 'Consolas, "Courier New", monospace', '--vscode-editor-foreground': '#d4d4d4',
  '--vscode-editor-selectionBackground': '#264f78', '--vscode-editorGroupHeader-tabsBackground': '#252526',
  '--vscode-editorHoverWidget-background': '#252526', '--vscode-editorHoverWidget-border': '#454545',
  '--vscode-editorHoverWidget-foreground': '#cccccc', '--vscode-editorWarning-foreground': '#cca700',
  '--vscode-errorForeground': '#f48771', '--vscode-focusBorder': '#007fd4',
  '--vscode-font-family': '"Segoe UI", "Malgun Gothic", sans-serif', '--vscode-font-size': '13px',
  '--vscode-foreground': '#cccccc', '--vscode-input-background': '#3c3c3c', '--vscode-input-border': '#3c3c3c',
  '--vscode-input-foreground': '#cccccc', '--vscode-inputValidation-errorBackground': '#5a1d1d',
  '--vscode-inputValidation-errorBorder': '#be1100', '--vscode-inputValidation-errorForeground': '#ffffff',
  '--vscode-inputValidation-infoBackground': '#063b49', '--vscode-inputValidation-infoForeground': '#ffffff',
  '--vscode-inputValidation-warningBackground': '#352a05', '--vscode-inputValidation-warningBorder': '#b89500',
  '--vscode-inputValidation-warningForeground': '#ffffff', '--vscode-list-hoverBackground': '#2a2d2e',
  '--vscode-panel-border': '#80808059', '--vscode-textLink-foreground': '#3794ff',
};

function findBrowser() {
  const c = [process.env.V4_BROWSER, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
  for (const p of c) { if (p && fs.existsSync(p)) { return p; } }
  return null;
}
class NoBrowserError extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let s = ''; r.on('data', (d) => { s += d; }); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); })
      .on('error', rej);
  });
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); if (m.error) { p.rej(new Error(m.error.message)); } else { p.res(m.result); } }
      else if (m.method) { this.handlers.forEach((h) => h(m.method, m.params)); }
    }); }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  on(h) { this.handlers.push(h); }
}

/** Start host + python + browser. opts: {width, height, port} */
async function start(opts = {}) {
  const out = opts.outDir || path.join(HERE, 'out');
  fs.mkdirSync(out, { recursive: true });
  const shots = path.join(out, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const log = { posted: [], info: [], warn: [], error: [], h2w: [], w2h: [], console: [], exceptions: [], net: [], steps: [] };
  process.env.STCFSD_TEST_MODE = '1';
  const vscode = makeFakeVscode(log);
  // save/open dialog interception
  const dialogs = { nextSave: null, nextOpen: null };
  vscode.window.showSaveDialog = async () => (dialogs.nextSave ? vscode.Uri.file(dialogs.nextSave) : undefined);
  vscode.window.showOpenDialog = async () => (dialogs.nextOpen ? [vscode.Uri.file(dialogs.nextOpen)] : undefined);
  let cdp = null;
  let mainPanel = null;
  const origCreate = vscode.window.createWebviewPanel;
  vscode.window.createWebviewPanel = (...a) => {
    const p = origCreate(...a);
    if (!mainPanel) {
      mainPanel = p;
      p.webview.postMessage = (m) => {
        log.h2w.push({ t: Date.now(), command: m.command, data: m.data });
        if (cdp) { cdp.send('Runtime.evaluate', { expression: `window.postMessage(${JSON.stringify(m)}, '*')` }).catch(() => {}); }
        return Promise.resolve(true);
      };
    } else {
      p.webview.postMessage = (m) => { log.h2w.push({ t: Date.now(), side: true, command: m.command }); return Promise.resolve(true); };
    }
    return p;
  };
  const { PythonBridge } = loadTs(path.join('src', 'bridge', 'PythonBridge.ts'), vscode);
  const { StcfsdPanel } = loadTs(path.join('src', 'webview', 'StcfsdPanel.ts'), vscode);
  const py = pythonPath();
  if (!py) { throw new Error('no .venv python'); }
  const bridge = new PythonBridge(REPO, py);
  await bridge.start();
  StcfsdPanel.currentPanel = undefined;
  StcfsdPanel.createOrShow(vscode.Uri.file(REPO), bridge, undefined);
  const panel = StcfsdPanel.currentPanel;

  // --- HTML rewrite
  let html = panel.__testGetHtml();
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?">/, '<!-- CSP removed by V4 harness -->');
  const repoRe = new RegExp(REPO.replace(/\\/g, '\\\\').replace(/:/g, ':'), 'g');
  html = html.replace(repoRe, '/repo').replace(/(\/repo[^"']*)/g, (s) => s.replace(/\\/g, '/'));
  const vars = Object.entries(DARK_VARS).map(([k, v]) => `${k}:${v};`).join('');
  const inject = `<script>window.__vsState=null;window.acquireVsCodeApi=()=>({postMessage:(m)=>{try{window.__hostRelay(JSON.stringify(m));}catch(e){console.error('relay',e);}},getState:()=>window.__vsState,setState:(s)=>{window.__vsState=s;}});</script>`
    + `<style>:root{${vars}} body{background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);}</style>`;
  html = html.replace('<head>', '<head>' + inject);
  fs.writeFileSync(path.join(out, 'webview.html'), html);

  // --- static server (read-only)
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/' || u === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
    if (u.startsWith('/repo/')) {
      const rel = u.slice(6);
      const abs = path.resolve(REPO, rel);
      if (!abs.startsWith(path.join(REPO, 'webview')) && !abs.startsWith(path.join(REPO, 'media'))) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(abs)) { log.net.push('404 ' + u); res.writeHead(404); res.end(); return; }
      const ext = path.extname(abs);
      const ct = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct + '; charset=utf-8' }); res.end(fs.readFileSync(abs)); return;
    }
    res.writeHead(404); res.end();
  });
  // V5c-06: 고정 포트가 아니라 빈 포트 — 다른 프로세스가 쥔 포트로 시험 전체가 죽지 않게(opts 로 주면 그 포트).
  await new Promise((r) => server.listen(opts.httpPort || 0, '127.0.0.1', r));
  const httpPort = server.address().port;

  // --- browser
  const cdpPort = opts.cdpPort || await new Promise((resolve) => {
    const probe = require('net').createServer();
    probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
  });
  const prof = path.join(out, 'edge-profile');
  const width = opts.width || 1400, height = opts.height || 1000;
  const browserExe = findBrowser();
  if (!browserExe) { throw new NoBrowserError('no Edge/Chrome found (set V4_BROWSER to its path)'); }
  const browser = cp.spawn(browserExe, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${prof}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', `--window-size=${width},${height}`, 'about:blank'],
  { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(200);
    try { const l = await getJson(`http://127.0.0.1:${cdpPort}/json/list`); target = l.find((t) => t.type === 'page'); } catch { /* retry */ }
  }
  if (!target) { throw new Error('browser did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  cdp = new Cdp(ws);
  const fakePanel = mainPanel;
  const pendingW2H = [];
  cdp.on((method, p) => {
    if (method === 'Runtime.bindingCalled' && p.name === '__hostRelay') {
      let m; try { m = JSON.parse(p.payload); } catch { return; }
      log.w2h.push({ t: Date.now(), command: m.command, data: m.data });
      const done = Promise.resolve().then(() => Promise.all(fakePanel._listeners.message.map((cb) => cb(m))))
        .catch((e) => log.exceptions.push({ side: 'host', text: String(e && e.stack || e) }));
      pendingW2H.push(done);
    } else if (method === 'Runtime.consoleAPICalled') {
      const text = (p.args || []).map((a) => (a.value !== undefined ? (typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value)) : (a.description || a.type))).join(' ');
      log.console.push({ t: Date.now(), type: p.type, text });
    } else if (method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails;
      log.exceptions.push({ t: Date.now(), side: 'page', text: (d.exception && d.exception.description) || d.text, line: d.lineNumber, url: d.url });
    } else if (method === 'Log.entryAdded') {
      log.console.push({ t: Date.now(), type: 'log-' + p.entry.level, text: p.entry.text + ' ' + (p.entry.url || '') });
    }
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  await cdp.send('Runtime.addBinding', { name: '__hostRelay' });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/index.html` });

  const ctx = {
    panel, bridge, vscode, log, cdp, dialogs, out, shots, REPO,
    async eval(expr, awaitPromise = true) {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
      if (r.exceptionDetails) { throw new Error('eval: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)); }
      return r.result.value;
    },
    async settle(ms = 300) { // wait until host handlers finished and no new message for ms
      let n = -1;
      for (let i = 0; i < 600; i++) {
        await Promise.all(pendingW2H.splice(0));
        const cur = log.h2w.length + log.w2h.length;
        if (cur === n) { break; }
        n = cur; await sleep(ms);
      }
    },
    async waitMsg(command, sinceIdx, timeout = 120000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const m = log.h2w.slice(sinceIdx).find((x) => x.command === command);
        if (m) { await sleep(150); return m; }
        await sleep(100);
      }
      throw new Error('timeout waiting for ' + command);
    },
    /**
     * 호스트가 지금까지 보낸 메시지를 화면이 다 처리할 때까지 — 시간이 아니라 순서로(부하에 흔들리지 않게).
     * 호스트 → 화면은 Runtime.evaluate(window.postMessage) 로 차례대로 간다. 그 뒤에 표지 메시지를 같은 길로 보내고, 화면이 그것을
     * 받으면(같은 작업 출처라 앞의 메시지가 먼저) 앞의 메시지 처리기는 모두 끝난 것이다. 그 사이 화면이 보낸 것의 호스트 처리도 기다린다.
     */
    async drain() {
      await Promise.all(pendingW2H.splice(0));
      await ctx.eval(`new Promise((r)=>{const h=(e)=>{if(e.data&&e.data.__drain){window.removeEventListener('message',h);setTimeout(r,0);}};window.addEventListener('message',h);window.postMessage({__drain:1},'*');})`);
      await Promise.all(pendingW2H.splice(0));
    },
    mark() { return { h2w: log.h2w.length, w2h: log.w2h.length, con: log.console.length, exc: log.exceptions.length }; },
    since(m) {
      return { h2w: log.h2w.slice(m.h2w).map((x) => x.command), w2h: log.w2h.slice(m.w2h).map((x) => x.command),
        console: log.console.slice(m.con).filter((c) => c.type === 'error' || c.type === 'warning' || c.type === 'log-error'),
        exceptions: log.exceptions.slice(m.exc) };
    },
    async setVal(id, v) {
      return ctx.eval(`(()=>{const e=document.getElementById(${JSON.stringify(id)}); if(!e) return 'MISSING';
        if(e.type==='checkbox'){e.checked=!!${JSON.stringify(v)};} else {e.value=${JSON.stringify(String(v))};}
        e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 'ok';})()`);
    },
    async click(sel) {
      return ctx.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'MISSING'; e.click(); return 'ok';})()`);
    },
    async tab(name) { return ctx.click(`.tab-btn[data-tab="${name}"]`); },
    async text(sel) { return ctx.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); return e? e.innerText : null;})()`); },
    async shot(name, opt = {}) {
      // full-height capture of the scrolling tab content
      const dims = await ctx.eval(`(()=>{const c=document.querySelector('.tab-content'); const a=document.querySelector('.tab-panel.active');
        return {sh: Math.max(document.documentElement.scrollHeight, c? c.scrollHeight:0, a? a.scrollHeight+60:0)};})()`);
      const h = Math.min(opt.maxHeight || 6000, Math.max(height, dims.sh + 40));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(400);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const f = path.join(shots, name + '.png');
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      log.steps.push({ shot: f });
      return f;
    },
    async shotEl(name, sel) {
      const rect = await ctx.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.scrollIntoView(); const r=e.getBoundingClientRect(); return {x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height};})()`);
      if (!rect) { return null; }
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: rect.x, y: rect.y, width: Math.max(1, rect.w), height: Math.max(1, Math.min(rect.h, 8000)), scale: 1 } });
      const f = path.join(shots, name + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f;
    },
    /** scan visible text of a selector for bad tokens */
    async badTokens(sel = 'body') {
      return ctx.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const t=e.innerText;
        const out=[]; const re=/(undefined|NaN|\\[object Object\\]|\\bnull\\b|Infinity)/g; let m; while((m=re.exec(t))){out.push(t.slice(Math.max(0,m.index-60), m.index+40).replace(/\\n/g,' | '));} return out;})()`);
    },
    lastH2W(command) { const a = log.h2w.filter((x) => x.command === command); return a.length ? a[a.length - 1].data : undefined; },
    async close() {
      try { ws.close(); } catch { /* */ }
      try { browser.kill(); } catch { /* */ }
      try { cp.execSync(`taskkill /PID ${browser.pid} /T /F`, { stdio: 'ignore' }); } catch { /* */ }
      try { bridge.dispose(); } catch { /* */ }
      try { server.close(); } catch { /* */ }
    },
    browserPid: browser.pid,
  };
  // wait for webviewReady → modelLoaded
  await ctx.waitMsg('modelLoaded', 0, 60000);
  await ctx.settle();
  return ctx;
}

module.exports = { start, sleep, REPO, findBrowser, NoBrowserError };
