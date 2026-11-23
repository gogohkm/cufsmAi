// S2 시험 — 화면 다리 + 지금의 웹뷰. CLI(`host/dist/serve.js`)를 자식 프로세스로 띄우고(진짜 호스트 · 진짜 Python),
// HTTP 로 인증 · 격리를 보고, 이 PC 의 Edge/Chrome 을 headless 로 띄워 DevTools 프로토콜(CDP, Node 의 WebSocket)로
// 진짜 화면(탭 6개)을 DOM 으로 조작한다(`test/rendered/lib.js` 와 같은 방식 — 그 파일은 읽기만 했다).
//
//   cd desktop && npm test          (형 검사 · 빌드 · smoke 뒤에 이 파일)
//   node desktop/host/test/bridge.mjs
//
// 브라우저가 없으면 화면 단계는 건너뛴다고 분명히 적고 HTTP 단계만 돈다. 브라우저는 STCFSD_BROWSER 로 지정할 수 있다.
// 그림은 host/test/out/(git 에 넣지 않음). 모델 파일은 임시 폴더 사본만 쓴다. Claude 설정은 임시 폴더의 가짜 경로만 준다.
import { spawn, spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const SERVE = path.join(here, '..', 'dist', 'serve.js');
const OUT = path.join(here, 'out');
const VERBOSE = process.env.SMOKE_VERBOSE === '1';
const W = 1400, H = 1000;

const results = [];
const started = Date.now();
/** --only=<단계 id,…>(예: --only=s14f) — 준 단계만(앞 단계의 상태에 기대면 그 id 도 준다) */
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7).split(',').map(x => x.trim()).filter(Boolean);
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  process.stdout.write(`${ok ? '  통과' : '  실패'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
  return !!ok;
}
const skip = (name, why) => { results.push({ name, ok: true, skipped: true }); process.stdout.write(`  건너뜀 ${name} — ${why}\n`); };
const section = title => process.stdout.write(`\n▶ ${title}  (+${((Date.now() - started) / 1000).toFixed(1)} s)\n`);
const short = (v, n = 200) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 저장소 · 설정 파일 (smoke 와 같은 방식) ─────────────────────────────
function repoSnapshot() {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8' });
  const map = new Map();
  const parts = r.stdout.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i].slice(0, 2);
    const file = parts[i].slice(3);
    if (status[0] === 'R' || status[0] === 'C') { i++; }
    if (file.startsWith('desktop/')) { continue; }
    let st = 'none';
    try { const s = fs.statSync(path.join(repoRoot, file)); st = `${s.size}:${s.mtimeMs}`; } catch { /* 지워짐 */ }
    map.set(file, `${status}|${st}`);
  }
  return map;
}
const diffSnapshots = (a, b) => {
  const out = [];
  for (const [k, v] of b) { if (a.get(k) !== v) { out.push(k); } }
  for (const k of a.keys()) { if (!b.has(k)) { out.push(`${k}(사라짐)`); } }
  return out;
};
const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const USER_CONFIG_FILES = [
  path.join(repoRoot, '.mcp.json'), path.join(repoRoot, '.claude', 'mcp.json'),
  path.join(repoRoot, 'Example', '.mcp.json'), path.join(repoRoot, 'Example', '.claude', 'mcp.json'),
  path.join(HOME, '.claude', 'mcp.json'), path.join(APPDATA, 'Claude', 'claude_desktop_config.json'),
  path.join(APPDATA, 'StCFSD', 'mcp', 'stcfsd-mcp-port'),
];
const statOf = f => { try { const s = fs.statSync(f); return `${s.size}:${s.mtimeMs}`; } catch { return '없음'; } };

function descendants(rootPid) {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], { encoding: 'utf8' });
  let rows = [];
  try { rows = JSON.parse(r.stdout).map(p => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name })); } catch { rows = []; }
  const found = [];
  const queue = [rootPid];
  while (queue.length) {
    const p = queue.shift();
    for (const row of rows) { if (row.ppid === p && !found.some(f => f.pid === row.pid)) { found.push(row); queue.push(row.pid); } }
  }
  return found;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const portIsFree = port => new Promise(resolve => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/**
 * 날것 HTTP(V5-16a) — fetch 는 `%2e%2e` · `/./` 를 보내기 전에 정리한다. 경로를 손대지 않고 소켓에 그대로 쓴다.
 * → { status, headers(소문자 이름), body }
 */
function rawHttp(port, method, rawPath, headers = {}, body = '') {
  return new Promise(resolve => {
    const s = net.connect(port, '127.0.0.1', () => {
      const h = { Host: `127.0.0.1:${port}`, Connection: 'close', ...headers };
      if (body) { h['Content-Length'] = Buffer.byteLength(body); }
      s.write(`${method} ${rawPath} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${body}`);
    });
    let d = Buffer.alloc(0);
    s.on('data', c => { d = Buffer.concat([d, c]); });
    s.on('end', () => {
      const text = d.toString('utf8');
      const [head, ...rest] = text.split('\r\n\r\n');
      const lines = head.split('\r\n');
      const headersOut = {};
      for (const l of lines.slice(1)) { const i = l.indexOf(':'); if (i > 0) { headersOut[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); } }
      resolve({ status: Number(lines[0].split(' ')[1]) || 0, headers: headersOut, body: rest.join('\r\n\r\n') });
    });
    s.on('error', e => resolve({ status: 0, headers: {}, body: String(e) }));
  });
}

function findBrowser() {
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const c = [process.env.STCFSD_BROWSER,
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')];
  return c.find(p => p && fs.existsSync(p));
}

/** 웹뷰가 쓰는 --vscode-* 이름(빌드의 확인과 같은 출처) */
function usedVariables() {
  const { usedThemeVariables } = require('../dist/index.js');
  const texts = [fs.readFileSync(path.join(repoRoot, 'src', 'webview', 'StcfsdPanel.ts'), 'utf8')];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); } else if (/\.(js|css|html)$/.test(e.name)) { texts.push(fs.readFileSync(p, 'utf8')); }
  } };
  walk(path.join(repoRoot, 'webview'));
  return usedThemeVariables(texts);
}

// ── CLI ─────────────────────────────────────────────────────────────────
function startServe(args) {
  const child = spawn(process.execPath, [SERVE, ...args], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const lines = [];
  let err = '';
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', c => { buf += c; let nl; while ((nl = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, nl).replace(/\r$/, '')); buf = buf.slice(nl + 1); } });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', c => { err = (err + c).slice(-30_000); if (VERBOSE) { process.stderr.write(c); } });
  let seq = 0;
  const pending = new Map();
  child.on('message', m => { const p = pending.get(m?.id); if (p) { pending.delete(m.id); p(m); } });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const ipc = (type, extra = {}, timeoutMs = 60_000) => new Promise((resolve, reject) => {
    seq += 1;
    const id = seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`IPC ${type} 답 없음`)); }, timeoutMs);
    pending.set(id, m => { clearTimeout(timer); m.ok ? resolve(m.result) : reject(new Error(m.error)); });
    child.send({ id, type, ...extra });
  });
  const waitLine = async (re, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = lines.find(l => re.test(l));
      if (hit) { return hit; }
      if (child.exitCode !== null) { throw new Error(`serve 가 끝났다(코드 ${child.exitCode}): ${err.slice(-1500)}`); }
      if (Date.now() > deadline) { throw new Error(`${re} 줄이 없다: ${lines.join(' | ').slice(-800)}`); }
      await sleep(50);
    }
  };
  return { child, lines, stderr: () => err, ipc, waitLine, exited };
}

// ── CDP ─────────────────────────────────────────────────────────────────
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); if (m.error) { p.rej(new Error(m.error.message)); } else { p.res(m.result); } }
      else if (m.method) { for (const h of this.handlers) { h(m.method, m.params); } }
    });
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  on(h) { this.handlers.push(h); }
}

async function startBrowser(exe, profile) {
  const port = await freePort();
  const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-gpu', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 150 && !target; i++) {
    await sleep(200);
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = l.find(t => t.type === 'page'); } catch { /* 다시 */ }
  }
  if (!target) { throw new Error('브라우저가 뜨지 않았다'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const cdp = new Cdp(ws);
  const log = { console: [], exceptions: [] };
  // 프레임마다의 기본 실행 문맥 — 끼운 웹뷰는 다른 출처(다리의 웹뷰 서버)라 맨 위 문서에서 contentDocument 로 닿지 않는다.
  // DevTools 프로토콜로 그 프레임의 문맥에서 직접 돌린다(사람이 그 화면에서 하는 것과 같은 자리).
  const contexts = new Map();
  cdp.on((method, p) => {
    if (method === 'Runtime.executionContextCreated' && p.context.auxData?.isDefault) { contexts.set(p.context.auxData.frameId, p.context.id); }
    else if (method === 'Runtime.executionContextDestroyed') { for (const [k, v] of contexts) { if (v === p.executionContextId) { contexts.delete(k); } } }
    else if (method === 'Runtime.executionContextsCleared') { contexts.clear(); }
  });
  cdp.on((method, p) => {
    if (method === 'Runtime.consoleAPICalled') {
      const text = (p.args || []).map(a => (a.value !== undefined ? (typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value)) : (a.description || a.type))).join(' ');
      log.console.push({ type: p.type, text });
    } else if (method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails;
      log.exceptions.push({ text: (d.exception && d.exception.description) || d.text, url: d.url, line: d.lineNumber });
    } else if (method === 'Log.entryAdded') {
      log.console.push({ type: `log-${p.entry.level}`, text: `${p.entry.text} ${p.entry.url || ''}` });
    }
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  /** url 에 `part` 가 든 iframe 의 문맥에서 식을 돌린다 */
  const frameEval = async (part, expr, notPart) => {
    const tree = (await cdp.send('Page.getFrameTree')).frameTree;
    const all = []; const walk = n => { all.push(n.frame); for (const c of n.childFrames ?? []) { walk(c); } }; walk(tree);
    const f = all.find(x => x.parentId && x.url.includes(part) && (!notPart || !x.url.includes(notPart)));
    if (!f) { throw new Error(`프레임 없음: ${part}`); }
    const contextId = contexts.get(f.id);
    if (!contextId) { throw new Error(`프레임 문맥 없음: ${part}`); }
    const r = await cdp.send('Runtime.evaluate', { expression: expr, contextId, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) { throw new Error(`frame eval: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`); }
    return r.result.value;
  };
  return {
    cdp, log, pid: browser.pid, frameEval, profile,
    /** 브라우저를 정상으로 닫는다(방문 기록 등을 디스크에 쓰게) */
    async closeGracefully() {
      try { await Promise.race([cdp.send('Browser.close'), sleep(5000)]); } catch { /* */ }
      for (let i = 0; i < 50 && alive(browser.pid); i++) { await sleep(100); }
      try { ws.close(); } catch { /* */ }
    },
    async close() {
      try { ws.close(); } catch { /* */ }
      try { spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* */ }
      try { browser.kill(); } catch { /* */ }
    },
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) { if (f.endsWith('.png') || f.endsWith('.pdf')) { fs.rmSync(path.join(OUT, f), { force: true }); } }
  const repoBefore = repoSnapshot();
  const configBefore = new Map(USER_CONFIG_FILES.map(f => [f, statOf(f)]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-s2-bridge-'));
  const portFile = path.join(tmp, 'mcp', 'stcfsd-mcp-port');
  const docs = path.join(tmp, 'Documents');
  const claudeConfig = path.join(tmp, 'Claude', 'claude_desktop_config.json');

  section('0. 빌드 확인 — 테마 변수');
  const used = usedVariables();
  const { missingThemeVariables, themeVariables } = require('../dist/index.js');
  const missing = missingThemeVariables(used);
  check(`웹뷰가 쓰는 --vscode-* ${used.length}종이 dark · light 에 모두 정의됐다`, missing.length === 0 && used.length >= 30,
    missing.map(m => `${m.theme}:${m.name}`).join(', ') || `${Object.keys(themeVariables('dark')).length}개 정의`);

  section('1. serve CLI 시작');
  let t = Date.now();
  // U4: 기본 화면은 새 검토 화면이다 — 이 시험은 예전의 틀을 그 스위치(`--ui classic`)로 띄워 그대로 돌린다
  const serve = startServe(['--repo', repoRoot, '--user-data', path.join(tmp, 'userData'), '--port-file', portFile,
    '--documents', docs, '--claude-config', claudeConfig, '--ui', 'classic']);
  let ready;
  try { ready = JSON.parse((await serve.waitLine(/^STCFSD_BRIDGE_READY /, 150_000)).slice('STCFSD_BRIDGE_READY '.length)); }
  catch (err) { check('serve 가 준비 줄을 낸다', false, String(err.message)); serve.child.kill(); return finish(); }
  check('serve 가 준비 줄을 낸다', true, `${Date.now() - t} ms · ${ready.origin} · MCP ${ready.mcpPort}`);
  const origin = ready.origin;
  const wvOrigin = ready.webviewOrigin;
  const wvPort = Number(new URL(wvOrigin).port);
  const token = new URL(ready.url).searchParams.get('t');
  const writeKey = ready.writeKey;
  const mcpToken = JSON.parse(fs.readFileSync(portFile, 'utf8')).token;
  /** 틀 서버 — 읽기는 Bearer, 쓰기(GET 아닌 것)는 쓰기 열쇠도(화면이 하는 그대로). key:false 면 열쇠를 빼고 */
  const api = async (method, route, body, headers = {}, { key = method !== 'GET', base = origin } = {}) => {
    const res = await fetch(`${base}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Connection: 'close',
      ...(key ? { 'X-StCFSD-Key': writeKey } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, text, json };
  };
  const wvApi = (method, route, body, headers = {}) => api(method, route, body, headers, { key: false, base: wvOrigin });
  const status0 = (await api('GET', '/api/state')).json?.data;
  const designerId = status0?.designer;
  const wvPath = `/wv/${encodeURIComponent(designerId)}/`;
  check('웹뷰는 다른 출처(다리의 웹뷰 서버)에서 — 상태의 웹뷰 주소 · 출처', wvOrigin !== origin && status0?.webviewOrigin === wvOrigin
    && status0.webviews.every(w => w.url.startsWith(`${wvOrigin}/wv/`)), `틀 ${origin} · 웹뷰 ${wvOrigin}`);

  section('2. 인증 · 격리 (HTTP)');
  const noTokenRoutes = [[origin, '/'], [origin, '/frame/frame.js'], [origin, '/api/state'], [origin, '/api/events'], [origin, '/api/mcp/status'],
    [origin, '/api/claude/status'], [origin, '/api/wv-key'], [origin, '/nowhere'], [wvOrigin, wvPath], [wvOrigin, '/res/webview/js/app.js'],
    [wvOrigin, '/res/media/viewer3d.js'], [wvOrigin, `/api/wv/${encodeURIComponent(designerId)}/out`]];
  const noTok = [];
  for (const [b, r] of noTokenRoutes) { const res = await fetch(`${b}${r}`, { headers: { Connection: 'close' } }); noTok.push(`${b === wvOrigin ? '웹뷰' : '틀'}${r} ${res.status}`); await res.arrayBuffer(); }
  check('토큰 없는 요청은 두 서버의 모든 경로에서 401', noTok.every(x => / 401$/.test(x)), noTok.filter(x => !/ 401$/.test(x)).join(', ') || `${noTok.length}개 경로`);
  const post401 = await fetch(`${origin}/api/platform/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('토큰 없는 POST 도 401', post401.status === 401, `HTTP ${post401.status}`);
  const boot = await fetch(ready.url, { redirect: 'manual' });
  const setCookie = boot.headers.get('set-cookie') ?? '';
  const cookiePair = setCookie.split(';')[0];
  const cookieVal = cookiePair.split('=').slice(1).join('=');
  const bootBody = await boot.text();
  check('?t= 교환 — HttpOnly · SameSite=Strict 쿠키(값은 토큰이 아니다) + 쓰기 열쇠는 본문 스크립트가 sessionStorage 에, 주소 · 쿠키에는 없다',
    boot.status === 200 && /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie) && !!cookieVal && cookieVal !== token && cookieVal !== writeKey
    && !boot.headers.get('location') && bootBody.includes(writeKey) && bootBody.includes('sessionStorage') && !bootBody.includes(token),
    `${boot.status} · ${setCookie.split(';').slice(1).join(';')} · 본문 ${bootBody.length}자`);
  // V5-10: 정리하면 `//evil.example/x` 가 되는 경로 — 돌아갈 곳은 늘 이 출처 안의 정해진 화면이다(날것으로 보낸다)
  const evil = await rawHttp(ready.port, 'GET', `/.//evil.example/x?t=${encodeURIComponent(token)}`);
  const evilTarget = /location\.replace\(("[^"]*")\)/.exec(evil.body)?.[1];
  check('V5-10 · `/.//evil.example/x?t=` 교환 뒤 돌아갈 곳이 이 출처의 `/` 다(다른 곳으로 튕기지 않는다)', evil.status === 200 && !evil.headers.location
    && evilTarget === '"/"', `${evil.status} · Location ${evil.headers.location ?? '없음'} · 돌아갈 곳 ${evilTarget}`);
  const evil2 = await rawHttp(ready.port, 'GET', `//evil.example/x?t=${encodeURIComponent(token)}`);
  const evil2Target = /location\.replace\(("[^"]*")\)/.exec(evil2.body)?.[1];
  check('V5-10 · `//evil.example/x?t=`(날것) 도 `/` 로', !evil2.headers.location && (evil2Target === '"/"' || evil2.status >= 400), `${evil2.status} · ${evil2Target}`);
  // V5-16a: 경로 넘나들기 — fetch 를 거치지 않고 날것으로(서버가 받은 그대로 막는지)
  const trav = [[wvPort, '/res/webview/..%2F..%2Fpackage.json'], [wvPort, '/res/webview/%2e%2e/%2e%2e/package.json'], [wvPort, '/res/webview/../../package.json'],
    [wvPort, '/res/webview/js/..%5C..%5C..%5Cpackage.json'], [wvPort, '/res/media/..%2Fsrc%2Fextension.ts'], [wvPort, '/res/src/extension.ts'],
    [wvPort, '/res/webview/C:%5CWindows%5Cwin.ini'], [wvPort, '/res/webview/%252e%252e/%252e%252e/package.json'], [ready.port, '/frame/..%2Fsrc%2Fserve.ts'],
    [ready.port, '/frame/../src/serve.ts'], [ready.port, '/ui/../src/main.ts'], [wvPort, '/res/denied']];
  const travRes = [];
  for (const [p, r] of trav) { const x = await rawHttp(p, 'GET', r, { Authorization: `Bearer ${token}` }); travRes.push(`${r} ${x.status}`); }
  check('리소스 경로로 뿌리 밖을 읽을 수 없다(날것으로 보낸 경로 넘나들기 거절)', travRes.every(x => !/ 200$/.test(x)), travRes.filter(x => / 200$/.test(x)).join(', ') || `${trav.length}건 모두 404/400`);
  const okRes = await wvApi('GET', '/res/webview/js/app.js');
  check('허용 뿌리 안의 리소스는 웹뷰 서버에서 읽힌다', okRes.status === 200 && okRes.text.includes('acquireVsCodeApi'), `app.js ${okRes.text.length}자`);
  const resOnFrame = await api('GET', '/res/webview/js/app.js');
  const wvOnFrame = await api('GET', wvPath);
  check('틀 서버에는 웹뷰 문서 · 리소스가 없다(웹뷰가 틀과 같은 출처에서 돌 길이 없다)', resOnFrame.status === 404 && wvOnFrame.status === 404, `${resOnFrame.status} · ${wvOnFrame.status}`);

  const claude = (await api('GET', '/api/claude/status')).json?.data;
  check('/api/claude/status — 가짜 설정 경로 · 읽기만', claude?.configPath === claudeConfig && claude.state === 'not-installed' && !fs.existsSync(path.dirname(claudeConfig)),
    `${claude?.state} · ${claude?.text}`);
  // V5-04 · 쓰기에는 쓰기 열쇠가 있어야 한다 — Bearer · 쿠키만으로는 거절. 가짜 Claude 설정을 만들어 정말 쓰일 수 있는 조건에서 본다.
  fs.mkdirSync(path.dirname(claudeConfig), { recursive: true });
  fs.writeFileSync(claudeConfig, `${JSON.stringify({ mcpServers: { other: { command: 'other.exe', env: { API_KEY: 'keep-me' } } } }, null, 2)}\n`);
  const cfgBytes = () => fs.readFileSync(claudeConfig);
  const before04 = cfgBytes();
  const writes = [['POST', '/api/claude/connect'], ['POST', '/api/claude/disconnect'], ['POST', '/api/mcp/action'], ['POST', '/api/platform/answer'],
    ['POST', `/api/webviews/${encodeURIComponent(designerId)}/close`], ['GET', '/api/wv-key']];
  const bearerOnly = [];
  for (const [m, r] of writes) { const x = await api(m, r, m === 'POST' ? { action: 'save_project', filepath: claudeConfig } : undefined, {}, { key: false }); bearerOnly.push(`${m} ${r} ${x.status}`); }
  check('V5-04 · 쓰기 열쇠 없는 쓰기는 모두 403(Bearer 만으로는 안 된다)', bearerOnly.every(x => / 403$/.test(x)) && before04.equals(cfgBytes()),
    bearerOnly.filter(x => !/ 403$/.test(x)).join(', ') || `${writes.length}개 경로 · 설정 그대로`);
  const cookieRead = await fetch(`${origin}/api/state`, { headers: { Cookie: cookiePair, Connection: 'close' } });
  const cookieWrites = [];
  for (const [m, r] of writes) {
    const x = await fetch(`${origin}${r}`, { method: m, headers: { Cookie: cookiePair, 'Content-Type': 'application/json', Connection: 'close' }, body: m === 'POST' ? '{}' : undefined });
    cookieWrites.push(`${m} ${r} ${x.status}`); await x.arrayBuffer();
  }
  const wvIn = await fetch(`${wvOrigin}/api/wv/${encodeURIComponent(designerId)}/in?conn=x`, { method: 'POST', headers: { Cookie: cookiePair, 'Content-Type': 'application/json' }, body: '[{"command":"saveProject"}]' });
  const wvOut = await fetch(`${wvOrigin}/api/wv/${encodeURIComponent(designerId)}/out`, { headers: { Cookie: cookiePair } });
  check('V5-04 · 쿠키만으로는 읽기만 — 틀의 모든 쓰기 · 웹뷰 통로(in · out)는 403', cookieRead.status === 200 && cookieWrites.every(x => / 403$/.test(x))
    && wvIn.status === 403 && wvOut.status === 403 && before04.equals(cfgBytes()),
  `읽기 ${cookieRead.status} · ${cookieWrites.filter(x => !/ 403$/.test(x)).join(', ') || '쓰기 모두 403'} · 웹뷰 in ${wvIn.status} · out ${wvOut.status}`);
  await cookieRead.arrayBuffer(); await wvIn.arrayBuffer(); try { await wvOut.body?.cancel(); } catch { /* */ }
  const wvWrite = await wvApi('POST', '/api/claude/connect', {});
  check('웹뷰 서버에는 쓰기 경로가 없다(Claude 연결 · MCP 중계 · 물음 답)', wvWrite.status === 404 && (await wvApi('POST', '/api/mcp/action', {})).status === 404
    && (await wvApi('POST', '/api/platform/answer', {})).status === 404 && before04.equals(cfgBytes()), `connect ${wvWrite.status}`);
  const keyed = await api('GET', `/api/wv-key?id=${encodeURIComponent(designerId)}`, undefined, {}, { key: true });
  check('쓰기 열쇠가 있으면 웹뷰 열쇠를 받는다', keyed.status === 200 && typeof keyed.json?.data?.key === 'string' && keyed.json.data.key !== writeKey && keyed.json.data.origin === wvOrigin);
  const connected = await api('POST', '/api/claude/connect', {});
  const afterConnect = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
  await api('POST', '/api/claude/disconnect', {});
  const afterDisconnect = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
  check('대조 — 쓰기 열쇠가 있으면 「연결」 · 「끊기」가 된다(다른 항목 그대로)', connected.json?.data?.result?.ok === true && !!afterConnect.mcpServers.stcfsd
    && !afterDisconnect.mcpServers.stcfsd && afterDisconnect.mcpServers.other?.env?.API_KEY === 'keep-me', short(connected.json?.data?.result?.message, 80));
  // V5-18a · 페이지가 보낸 문자열에 섞인 다른 nonce 는 새 nonce 로 바뀌지 않는다
  {
    const { injectWebviewHtml } = require('../dist/index.js');
    const src = `<html><head><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-ORIG'"></head><body><script nonce="ORIG">ok()</script><div><script nonce="FOREIGN">evil()</script><script nonce='ORIG'>ok2()</script></div></body></html>`;
    const o = injectWebviewHtml(src, { webviewId: 'x', viewType: 'v', theme: 'dark', roots: [], frameOrigin: origin });
    check('V5-18a · 원래 nonce 를 단 태그만 새 nonce — 다른 값(FOREIGN)은 그대로라 돌지 않는다', o.html.includes(`nonce="${o.nonce}">ok()`) && o.html.includes(`nonce="${o.nonce}">ok2()`)
      && o.html.includes('nonce="FOREIGN">evil()') && !o.html.includes('ORIG'), short(o.csp, 80));
  }
  const badHost = await new Promise(resolve => {
    const s = net.connect(ready.port, '127.0.0.1', () => { s.write(`GET /api/state HTTP/1.1\r\nHost: evil.example:${ready.port}\r\nAuthorization: Bearer ${token}\r\nConnection: close\r\n\r\n`); });
    let d = ''; s.on('data', c => { d += c; }); s.on('end', () => resolve(d.split('\r\n')[0])); s.on('error', e => resolve(String(e)));
  });
  check('다른 Host 머리는 403(DNS rebinding)', /403/.test(badHost), badHost);
  const badOrigin = await api('GET', '/api/state', undefined, { Origin: 'http://evil.example' });
  const crossSite = await api('GET', '/api/state', undefined, { 'Sec-Fetch-Site': 'cross-site' });
  check('다른 Origin · 다른 사이트 요청은 403', badOrigin.status === 403 && crossSite.status === 403, `Origin ${badOrigin.status} · Sec-Fetch-Site ${crossSite.status}`);
  const relayed = await api('GET', '/api/mcp/status');
  check('MCP 중계 — 다리 토큰으로 호스트 MCP 를 읽는다', relayed.status === 200 && relayed.json && 'nnodes' in relayed.json, short(relayed.text, 90));
  const leak = [relayed.text, (await api('GET', '/api/state')).text, (await api('GET', '/api/claude/status')).text, (await wvApi('GET', wvPath)).text,
    (await api('GET', '/')).text, (await api('GET', '/frame/frame.js')).text, bootBody];
  check('MCP 토큰이 화면에 가는 어디에도 없다(중계 · 상태 · 웹뷰 HTML · 틀)', leak.every(x => !x.includes(mcpToken)), `${leak.length}곳`);
  const html = (await wvApi('GET', wvPath)).text;
  const cspMeta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(cspMeta)?.[1];
  const scriptNonces = [...html.matchAll(/<script[^>]*\snonce="([^"]*)"/g)].map(m => m[1]);
  check('웹뷰 HTML — CSP 는 다리 출처 · 새 nonce · connect-src, 리소스는 /res/ 로', !!nonce && cspMeta.includes("connect-src 'self'")
    && !html.includes('vscode-cdn.net') && !html.includes('vscode-resource') && scriptNonces.length >= 6 && scriptNonces.every(n => n === nonce)
    && /src="\/res\/webview\/js\/app\.js"/.test(html), short(cspMeta, 160));
  const html2 = (await wvApi('GET', wvPath)).text;
  check('nonce 는 요청마다 새것', /'nonce-([^']+)'/.exec(html2)?.[1] !== nonce);
  const pages = [(await api('GET', '/')).text, (await api('GET', '/frame/frame.js')).text, (await api('GET', '/api/state')).text, html,
    (await api('GET', '/ui/')).text, (await wvApi('GET', '/res/webview/js/app.js')).text];
  check('쓰기 열쇠는 틀 · 새 화면 · 상태 · 웹뷰 HTML 어디에도 없다(교환 응답의 본문에만)', pages.every(x => !x.includes(writeKey) && !x.includes(token)), `${pages.length}곳`);
  const wvHead = await fetch(`${wvOrigin}${wvPath}`, { headers: { Authorization: `Bearer ${token}` } });
  check('웹뷰 문서는 틀 서버만 끼울 수 있다(frame-ancestors = 틀 출처)', wvHead.headers.get('content-security-policy') === `frame-ancestors ${origin}`
    && !wvHead.headers.get('x-frame-options'), wvHead.headers.get('content-security-policy'));
  await wvHead.arrayBuffer();

  // ── 화면 ────────────────────────────────────────────────────────────
  const exe = findBrowser();
  let br;
  if (!exe) {
    skip('화면 단계(3 – 9)', '이 PC 에 Edge/Chrome 이 없다 — STCFSD_BROWSER 로 실행 파일을 줄 수 있다');
  } else {
    br = await startBrowser(exe, path.join(tmp, 'browser-profile'));
    try { await screenSteps({ br, serve, api, origin, ready, tmp, docs, used, designerId, wvOrigin, writeKey, token, claudeConfig, mcpToken }); }
    catch (err) { check('화면 단계가 예외 없이 끝난다', false, String(err?.stack ?? err).slice(0, 1500)); }
    finally {
      // V5-S4 · 정상으로 닫아 방문 기록을 디스크에 쓰게 한 뒤, ?t= 주소(토큰)가 기록에 남았는지 본다
      await br.closeGracefully();
      await br.close();
      await sleep(500);
      const histFile = path.join(br.profile, 'Default', 'History');
      const hist = fs.existsSync(histFile) ? fs.readFileSync(histFile) : undefined;
      const inHistory = !!hist && hist.includes(Buffer.from(token));
      process.stdout.write(`  정보   V5-S4 · 브라우저 방문 기록(${hist ? `${hist.length} B` : '없음'})에 ?t= 토큰이 ${inHistory ? '남는다 — 개발 길의 한계로 BRIDGE.md 에 적었다' : '남지 않았다'}\n`);
      check('V5-S4 · 방문 기록에 쓰기 열쇠 · 쿠키 값은 없다', !hist || (!hist.includes(Buffer.from(writeKey)) && !hist.includes(Buffer.from(cookieVal))), inHistory ? '토큰은 있음(알려진 한계)' : '');
    }
  }

  section('10. 끝내기 — 프로세스 · 포트가 남지 않는다');
  const st = await serve.ipc('status');
  check('미구현 vscode API 에 닿은 곳이 없다', st.unimplemented.length === 0, st.unimplemented.map(u => u.name).join(', ') || '0종');
  check('활성화 중 MCP 설정 파일 쓰기 0', st.mcpConfigWrites.length === 0, st.mcpConfigWrites.join(', ') || '0건');
  const kids = descendants(serve.child.pid);
  t = Date.now();
  await serve.ipc('shutdown', {}, 10_000).catch(() => undefined);
  const exit = await Promise.race([serve.exited, sleep(30_000).then(() => undefined)]);
  check('IPC shutdown 뒤 스스로 끝난다(코드 0)', exit?.code === 0, exit ? `${Date.now() - t} ms · 코드 ${exit.code}` : '30 초 안에 끝나지 않음');
  if (!exit) { serve.child.kill(); }
  for (let i = 0; i < 100 && kids.some(k => alive(k.pid)); i++) { await sleep(50); }
  const left = kids.filter(k => alive(k.pid));
  check('남은 자식 프로세스(Python · PDF 용 브라우저)가 없다', left.length === 0, left.map(k => `${k.name}#${k.pid}`).join(', ') || `${kids.length}개 모두 끝남`);
  check('다리 · MCP 포트가 풀렸다', await portIsFree(ready.port) && await portIsFree(ready.mcpPort), `${ready.port} · ${ready.mcpPort}`);
  check('MCP 포트 파일이 지워졌다', !fs.existsSync(portFile));

  section('11. 저장소 · 사용자 설정 파일');
  const changed = diffSnapshots(repoBefore, repoSnapshot());
  check('desktop/ 밖에서 저장소가 바뀌지 않았다', changed.length === 0, changed.slice(0, 8).join('; ') || '그대로');
  const cfgChanged = USER_CONFIG_FILES.filter(f => statOf(f) !== configBefore.get(f));
  check('사용자 MCP · Claude Desktop 설정 · 앱 데이터 포트 파일이 그대로다', cfgChanged.length === 0, cfgChanged.join(', ') || `${USER_CONFIG_FILES.length}개 경로 그대로`);
  const stray = fs.readdirSync(path.join(here, '..', 'src'), { recursive: true }).filter(f => String(f).endsWith('.js'));
  check('host/src 에 tsc 출력이 섞이지 않았다', stray.length === 0, stray.join(', ') || '0개');
  fs.rmSync(tmp, { recursive: true, force: true });
  return finish(serve);
}

function finish(serve) {
  const failed = results.filter(r => !r.ok);
  process.stdout.write(`\n결과: ${results.length - failed.length}/${results.length} 통과 · ${((Date.now() - started) / 1000).toFixed(1)} s · 그림 ${OUT}\n`);
  if (failed.length) {
    process.stdout.write(`실패: ${failed.map(f => f.name).join(' / ')}\n`);
    if (serve) { process.stdout.write(`serve stderr 끝:\n${serve.stderr().split('\n').filter(l => !l.startsWith('[StCFSD Python stderr]')).slice(-30).join('\n')}\n`); }
    process.exitCode = 1;
  }
}

// ── 화면 단계 ───────────────────────────────────────────────────────────
async function screenSteps({ br, serve, api, origin, ready, tmp, docs, used, designerId, wvOrigin, writeKey, token, claudeConfig, mcpToken }) {
  const { cdp, log } = br;
  const evalTop = async expr => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) { throw new Error(`eval: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`); }
    return r.result.value;
  };
  const designerPart = `/wv/${encodeURIComponent(designerId)}/`;
  /** 설계 웹뷰(iframe, 다른 출처) 안에서 — D = document, W = window. 그 프레임의 문맥에서 돈다 */
  const wv = body => br.frameEval(designerPart, `(async()=>{const W=window;const D=document;${body}})()`);
  /** 보고서 웹뷰(두 번째 iframe) 안에서 */
  const side = body => br.frameEval('/wv/', `(async()=>{const W=window;const D=document;${body}})()`, designerPart);
  const setVal = (id, v) => wv(`const e=D.getElementById(${JSON.stringify(id)}); if(!e) return 'MISSING';
    if(e.type==='checkbox'){e.checked=!!${JSON.stringify(v)};} else {e.value=${JSON.stringify(String(v))};}
    e.dispatchEvent(new W.Event('input',{bubbles:true})); e.dispatchEvent(new W.Event('change',{bubbles:true})); return 'ok';`);
  const click = sel => wv(`const e=D.querySelector(${JSON.stringify(sel)}); if(!e) return 'MISSING'; e.click(); return 'ok';`);
  const tab = name => click(`.tab-btn[data-tab="${name}"]`);
  const text = sel => wv(`const e=D.querySelector(${JSON.stringify(sel)}); return e? e.innerText : null;`);
  const reveal = id => wv(`const e=D.getElementById(${JSON.stringify(id)}); if(e){e.scrollIntoView({block:'start'});} return !!e;`);
  const counts = async () => (await serve.ipc('status')).messageCounts;
  const waitMsg = async (command, since, timeout = 300_000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const c = (await counts())[command] ?? 0;
      if (c > since) { await sleep(400); return c; }
      if (Date.now() > deadline) { throw new Error(`${command} 가 ${timeout} ms 안에 오지 않았다`); }
      await sleep(150);
    }
  };
  const cnt = async command => (await counts())[command] ?? 0;
  const mark = () => ({ con: log.console.length, exc: log.exceptions.length });
  const problems = m => ({
    exceptions: log.exceptions.slice(m.exc).map(e => short(e.text, 160)),
    errors: log.console.slice(m.con).filter(c => c.type === 'error' || c.type === 'log-error' || c.type === 'assert').map(c => short(c.text, 160)),
  });
  const badTokens = () => wv(`const t=D.body.innerText; const out=[]; const re=/(undefined|NaN|\\[object Object\\])/g; let m;
    while((m=re.exec(t))){out.push(t.slice(Math.max(0,m.index-50), m.index+30).replace(/\\n/g,' | '));} return out;`);
  const shots = [];
  const shot = async name => {
    await sleep(300);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, `${name}.png`);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    shots.push(f);
    return f;
  };
  /** 한 단계: 실행 → 보이는 것 확인 → 그림 → 예외 · 콘솔 오류 · 깨진 글자 0 */
  const step = async (name, fn) => {
    if (ONLY.length && !ONLY.includes(String(name).split(' ')[0])) { return; }
    const m = mark();
    let detail = '';
    let ok = false;
    const t0 = Date.now();
    try { const r = await fn(); ok = r?.ok !== false; detail = r?.detail ?? ''; }
    catch (err) { ok = false; detail = String(err?.message ?? err).slice(0, 400); }
    const f = await shot(name.replace(/[^0-9a-zA-Z가-힣_-]+/g, '_').slice(0, 60));
    const p = problems(m);
    const bad = await badTokens().catch(() => []);
    check(name, ok, `${((Date.now() - t0) / 1000).toFixed(1)} s · ${detail}`);
    check(`  └ 페이지 예외 · 콘솔 오류 · undefined/NaN/[object Object] 0`, p.exceptions.length === 0 && p.errors.length === 0 && bad.length === 0,
      [...p.exceptions, ...p.errors, ...bad.map(b => `글자: ${b}`)].join(' / ') || path.basename(f));
  };
  const dialogAnswer = async (kind, value, shotName, timeout = 30_000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const got = await evalTop(`(()=>{const d=document.querySelector('#dialog-host .dialog[data-kind="fileDialog"]'); if(!d) return null;
        return {title:d.querySelector('h2').textContent, value:d.querySelector('input').value};})()`);
      if (got) {
        if (shotName) { await shot(shotName); }
        await evalTop(`(()=>{const d=document.querySelector('#dialog-host .dialog'); const i=d.querySelector('input'); i.value=${JSON.stringify(value)};
          d.querySelector('[data-role="ok"]').click(); return true;})()`);
        return got;
      }
      if (Date.now() > deadline) { throw new Error(`${kind} 물음이 틀에 뜨지 않았다`); }
      await sleep(100);
    }
  };
  const waitFor = async (expr, timeout = 30_000, what = expr) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const v = await evalTop(expr).catch(() => undefined);
      if (v) { return v; }
      if (Date.now() > deadline) { throw new Error(`기다림 시간 초과: ${what}`); }
      await sleep(150);
    }
  };
  const waitWv = async (body, timeout, what) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const v = await wv(body).catch(() => undefined);
      if (v) { return v; }
      if (Date.now() > deadline) { throw new Error(`기다림 시간 초과: ${what}`); }
      await sleep(150);
    }
  };
  const designerReady = () => waitWv(`const h=D.documentElement; return h.getAttribute('data-stcfsd-bridge')==='connected' && h.hasAttribute('data-stcfsd-replayed') && !!D.getElementById('section-svg');`,
    60_000, '설계 웹뷰 연결 · 다시 보내기');
  const svgShapes = () => wv(`const s=D.querySelector('#section-svg svg')||D.querySelector('#section-svg'); return s? s.querySelectorAll('line,polyline,path,circle,polygon').length : 0;`);
  const svgHist = () => wv(`const s=D.querySelector('#section-svg'); const h={}; if(s){s.querySelectorAll('*').forEach(e=>{const k=e.tagName+(e.getAttribute('class')?'.'+e.getAttribute('class'):'')+(e.getAttribute('stroke')?'['+e.getAttribute('stroke')+']':'');h[k]=(h[k]||0)+1;});} return h;`);
  const canvasInk = id => wv(`const c=D.getElementById(${JSON.stringify(id)}); if(!c||!c.width) return 0; const g=c.getContext('2d');
    const d=g.getImageData(0,0,c.width,c.height).data; const r0=d[0],g0=d[1],b0=d[2]; let n=0;
    for(let i=0;i<d.length;i+=16){ if(Math.abs(d[i]-r0)+Math.abs(d[i+1]-g0)+Math.abs(d[i+2]-b0)>60) n++; } return n;`);

  section('3. 틀 · 설계 웹뷰 · 기본 단면');
  await step('s01 틀이 뜨고 설계 웹뷰가 기본 단면을 그린다', async () => {
    await cdp.send('Page.navigate', { url: ready.url });
    await designerReady();
    await sleep(800);
    const shapes = await svgShapes();
    const title = await evalTop(`document.getElementById('file-name').textContent + ' | ' + document.getElementById('claude-status').textContent`);
    return { ok: shapes > 3, detail: `단면 도형 ${shapes}개 · 제목 표시줄 "${title}"` };
  });
  await step('s02 --vscode-* 변수가 웹뷰 안에서 모두 값이 있다', async () => {
    const empty = await wv(`const cs=W.getComputedStyle(D.documentElement); return ${JSON.stringify(used)}.filter(n=>!cs.getPropertyValue('--vscode-'+n).trim());`);
    // 표본 요소의 계산된 색이 투명이 아니다(정의가 빠지면 배경이 투명해진다)
    const sample = await wv(`const out={}; for(const s of ['body','.tab-bar','.tab-btn','input','select','button']){const e=D.querySelector(s); if(e){const c=W.getComputedStyle(e); out[s]=c.color+' / '+c.backgroundColor;}} return out;`);
    const transparentText = Object.values(sample).filter(v => /^rgba\(0, 0, 0, 0\) \//.test(v));
    return { ok: empty.length === 0 && transparentText.length === 0, detail: empty.length ? `빈 변수: ${empty.join(', ')}` : `${used.length}종 · ${short(sample, 150)}` };
  });

  section('3b. 끼운 웹뷰 · 다른 로컬 포트 — 쓰기 경로에 닿지 않는다(V5-18b · V5-04)');
  const cfgBefore = fs.readFileSync(claudeConfig);
  {
    // 웹뷰(iframe) 안의 스크립트가 할 수 있는 모든 길로 「연결」을 시도한다
    const r = await wv(`const out={};
      const tryIt=async(k,f)=>{try{const x=await f(); out[k]=typeof x==='object'&&x&&'status' in x?('HTTP '+x.status+(x.type==='opaque'?' opaque':'')):String(x);}catch(e){out[k]='거절: '+e.name;}};
      await tryIt('같은 출처 상대 경로', ()=>fetch('/api/claude/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
      await tryIt('틀 출처로 fetch', ()=>fetch(${JSON.stringify(origin)}+'/api/claude/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'include'}));
      await tryIt('틀 출처로 no-cors', ()=>fetch(${JSON.stringify(origin)}+'/api/claude/connect',{method:'POST',mode:'no-cors',body:'{}',credentials:'include'}));
      await tryIt('MCP 중계', ()=>fetch(${JSON.stringify(origin)}+'/api/mcp/action',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"save_project"}',credentials:'include'}));
      await tryIt('웹뷰 열쇠 받기', ()=>fetch(${JSON.stringify(origin)}+'/api/wv-key',{credentials:'include'}));
      await tryIt('부모 문서', ()=>W.parent.document.title);
      await tryIt('부모 fetch', ()=>W.parent.fetch('/api/claude/connect',{method:'POST'}));
      await tryIt('부모 저장소', ()=>W.parent.sessionStorage.length);
      out.ownStorageHasWriteKey=JSON.stringify(Object.keys(sessionStorage).map(k=>sessionStorage.getItem(k))).includes(${JSON.stringify(writeKey)});
      out.origin=location.origin;
      return out;`);
    await sleep(500);
    const fine = v => /^거절/.test(v) || /HTTP 40[34]/.test(v) || / opaque$/.test(v);
    const st = (await api('GET', '/api/claude/status')).json?.data;
    check('V5-18b · 끼운 웹뷰 안에서는 어떤 길로도 「연결」 · MCP 중계 · 열쇠 · 부모 문서에 닿지 않는다(설정 바이트 그대로)',
      r.origin === wvOrigin && Object.entries(r).filter(([k]) => !['origin', 'ownStorageHasWriteKey'].includes(k)).every(([, v]) => fine(v)) && r.ownStorageHasWriteKey === false
      && cfgBefore.equals(fs.readFileSync(claudeConfig)) && st?.state === 'not-registered', short(r, 400));
  }
  {
    // 같은 브라우저로 127.0.0.1 의 다른 포트를 열면 그 서버가 다리 쿠키를 받는다(쿠키는 포트를 가리지 않는다) — 그것으로 무엇을 할 수 있나
    let got = '';
    const other = http.createServer((q, s) => { got = q.headers.cookie ?? ''; s.end('<!doctype html><title>other</title>other'); });
    await new Promise(r => other.listen(0, '127.0.0.1', r));
    const top = await evalTop(`(()=>{try{return sessionStorage.getItem('stcfsd.bridge.key.'+location.port)===${JSON.stringify(writeKey)};}catch(e){return 'err';}})()`);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${other.address().port}/` });
    await sleep(1200);
    other.close();
    const pair = got.split(';').map(x => x.trim()).find(x => x.startsWith(`stcfsd_bridge_${ready.port}=`)) ?? '';
    const val = pair.split('=').slice(1).join('=');
    const H = { Cookie: pair, 'Content-Type': 'application/json', Connection: 'close' };
    const read = await fetch(`${origin}/api/state`, { headers: H });
    const results04 = {};
    for (const r of ['/api/claude/connect', '/api/mcp/action', '/api/platform/answer', `/api/webviews/${encodeURIComponent(designerId)}/close`]) {
      const x = await fetch(`${origin}${r}`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'save_project', filepath: claudeConfig }) });
      results04[r] = x.status; await x.arrayBuffer();
    }
    const k = await fetch(`${origin}/api/wv-key`, { headers: H }); results04['/api/wv-key'] = k.status; await k.arrayBuffer();
    const bootAgain = await fetch(`${origin}/?t=${encodeURIComponent(val)}`, { redirect: 'manual' }); results04['?t=<쿠키 값>'] = bootAgain.status; await bootAgain.arrayBuffer();
    const pagesWithKey = [];
    for (const r of ['/', '/ui/', '/frame/frame.js', '/api/state']) { const t = await (await fetch(`${origin}${r}`, { headers: H })).text(); if (t.includes(writeKey)) { pagesWithKey.push(r); } }
    check('V5-04 · 다른 포트가 받은 쿠키로는 읽기만 — 모든 쓰기 · 열쇠 · ?t= 교환은 거절, 그 쿠키로 받은 페이지에 쓰기 열쇠 없음',
      top === true && !!val && val !== token && val !== writeKey && read.status === 200 && Object.values(results04).every(s => s === 403 || s === 401)
      && pagesWithKey.length === 0 && cfgBefore.equals(fs.readFileSync(claudeConfig)),
      `틀 탭 sessionStorage 에 열쇠 ${top} · 받은 쿠키 ${pair ? '있음(값 ≠ 토큰)' : '없음'} · 읽기 ${read.status} · ${JSON.stringify(results04)}`);
    await read.arrayBuffer();
    await cdp.send('Page.navigate', { url: `${origin}/` });
    await designerReady();
  }

  section('4. 화면을 DOM 으로 — 단면 → 좌굴 → 하중 → 설계 → Lap → 보고서 → 검증');
  await step('s03 단면 템플릿(립 Z 8ZS2.25×059) 생성', async () => {
    await click('#btn-unit-US');
    await tab('preprocessor');
    await setVal('select-template', 'lippedz');
    for (const [k, v] of Object.entries({ 'tpl-H': 8, 'tpl-B': 2.25, 'tpl-D': 0.91, 'tpl-t': 0.059, 'tpl-r': 0.1875, 'tpl-qlip': 50 })) { await setVal(k, v); }
    // 재료는 기본 강종에 기대지 않고 분명히 준다.
    await setVal('input-fy', 55); await setVal('input-fu', 70);
    const before = await cnt('templateGenerated');
    await click('#btn-generate-template');
    await waitMsg('templateGenerated', before, 60_000);
    const shapes = await svgShapes();
    return { ok: shapes > 3, detail: `단면 도형 ${shapes}개 · ${short(await text('#status-message') ?? '', 80)}` };
  });
  await step('s04 좌굴 해석 — 곡선이 그려진다', async () => {
    await tab('design');
    const before = await cnt('analysisComplete');
    await click('#btn-run-analysis');
    await waitMsg('analysisComplete', before, 300_000);
    await sleep(1500);
    const ink = await canvasInk('buckling-curve-canvas');
    const dsm = await text('#dsm-table-container');
    await reveal('buckling-curve-canvas');
    return { ok: ink > 50 && /\d/.test(dsm ?? ''), detail: `곡선 캔버스 잉크 ${ink}점 · DSM 표 ${short(dsm ?? '', 60)}` };
  });
  await step('s05 하중 해석(6경간 연속 퍼린, ASD)', async () => {
    await tab('loads');
    for (const [k, v] of Object.entries({ 'select-member-type': 'roof-purlin', 'select-design-method': 'ASD', 'select-span-type': 'cont-n',
      'config-n-spans': 6, 'config-spacing': 5 })) { await setVal(k, v); }
    await wv(`const L=[1,25,25,25,25,1]; const sup=['N','P','P','P','P','P','N']; const lap=[[0,0],[0,0],[2.5,3.5],[1,1],[3.5,2.5],[0,0],[0,0]];
      D.querySelectorAll('.span-tbl-len').forEach((e,i)=>{e.value=L[i];e.dispatchEvent(new W.Event('change',{bubbles:true}));});
      D.querySelectorAll('.span-tbl-sup').forEach((e,i)=>{e.value=sup[i];e.dispatchEvent(new W.Event('change',{bubbles:true}));});
      D.querySelectorAll('.span-tbl-lapl').forEach(e=>{const i=+e.dataset.idx;e.value=lap[i][0];e.dispatchEvent(new W.Event('change',{bubbles:true}));});
      D.querySelectorAll('.span-tbl-lapr').forEach(e=>{const i=+e.dataset.idx;e.value=lap[i][1];e.dispatchEvent(new W.Event('change',{bubbles:true}));}); return 1;`);
    for (const [k, v] of Object.entries({ 'select-deck-type': 'through-fastened', 'deck-kphi-override': 0.3, 'load-D-psf': 3, 'load-Lr-psf': 20,
      'load-S-psf': 0, 'load-Wu-psf': 34, 'load-Wp-psf': 0, 'load-L-psf': 0, 'chk-pattern-loading': false, 'chk-lr-reduced': false,
      'chk-i621-confirmed': true, 'span-Ix-list': '9.18, 9.18, 7.76, 7.76, 9.18, 9.18' })) { await setVal(k, v); }
    const before = await cnt('loadAnalysisComplete');
    await click('#btn-analyze-loads');
    await waitMsg('loadAnalysisComplete', before, 300_000);
    const r = await text('#load-analysis-result');
    await reveal('load-analysis-result');
    return { ok: (r ?? '').length > 100 && !/오류|error/i.test((r ?? '').slice(0, 80)), detail: short(r ?? '', 90) };
  });
  await step('s06 설계 검토(퍼린 구간별)', async () => {
    await tab('design');
    const before = await cnt('designPurlinResult');
    await click('#btn-run-design');
    await waitMsg('designPurlinResult', before, 600_000);
    await sleep(800);
    const card = await text('#design-summary');
    await reveal('design-summary');
    return { ok: /OK|NG|판정 없음/.test(card ?? ''), detail: short(card ?? '', 100) };
  });
  await step('s07 Lap 접합부 결과', async () => {
    await tab('connection');
    const before = await cnt('lapConnectionResult');
    await click('#btn-run-lap-design');
    await waitMsg('lapConnectionResult', before, 120_000);
    await sleep(600);
    const r = await text('#connection-result');
    await reveal('connection-result');
    return { ok: (r ?? '').length > 40 && !/error|오류/i.test((r ?? '').slice(0, 60)), detail: short(r ?? '', 100) };
  });
  await step('s08 보고서 생성', async () => {
    await tab('report');
    await click('#btn-generate-report');
    await sleep(1500);
    const r = await text('#report-container');
    return { ok: (r ?? '').length > 500, detail: `${(r ?? '').length}자 · ${short((r ?? '').split('\n')[0], 60)}` };
  });
  await step('s09 검증 실행', async () => {
    await tab('validation');
    await click('#btn-run-validation');
    await sleep(2500);
    const badge = await text('#validation-summary-badge');
    const body = await text('#validation-container');
    return { ok: (body ?? '').length > 100 && !!badge, detail: `${badge} · ${(body ?? '').length}자` };
  });

  section('5. 저장 · 열기 (GUI 단추 → 틀의 경로 물음 → 임시 경로)');
  const saved = path.join(tmp, 'saved', 'gui-save.csd');
  let savedJson;
  await step('s10 Save 단추 → 저장 물음(문서\\StCFSD 기본값) → 임시 경로', async () => {
    await tab('design');
    await click('#btn-file-save');
    const q = await dialogAnswer('저장', saved, 's10a_저장_물음');
    for (let i = 0; i < 100 && !fs.existsSync(saved); i++) { await sleep(100); }
    savedJson = fs.existsSync(saved) ? JSON.parse(fs.readFileSync(saved, 'utf8')) : undefined;
    const n = Object.keys(savedJson?.designInputs ?? {}).length;
    const defaultOk = q.value.startsWith(path.join(docs, 'StCFSD')) && q.value.endsWith('.csd');
    await sleep(500);
    const fileName = await evalTop(`document.getElementById('file-name').textContent`);
    return { ok: !!savedJson && n > 50 && !!savedJson.analysisResult && !!savedJson.loadAnalysis && !!savedJson.designResult && defaultOk
      && fileName === 'gui-save.csd' && !fs.existsSync(path.join(docs, 'StCFSD')),
      detail: `기본 경로 ${q.value} · 설계 입력 ${n}칸 · 결과(해석 ${!!savedJson?.analysisResult} · 하중 ${!!savedJson?.loadAnalysis} · 설계 ${!!savedJson?.designResult} · Lap ${!!savedJson?.lapResult}) · 제목 "${fileName}" · 문서 폴더 만들지 않음 ${!fs.existsSync(path.join(docs, 'StCFSD'))}` };
  });
  await step('s11 다른 단면으로 바꾼 뒤 Open 단추 → 저장본 → 입력 · 결과가 돌아온다', async () => {
    await tab('preprocessor');
    await setVal('select-template', 'lippedc');
    for (const [k, v] of Object.entries({ 'tpl-H': 6, 'tpl-B': 2, 'tpl-D': 0.5, 'tpl-t': 0.06, 'tpl-r': 0.1 })) { await setVal(k, v); }
    const before = await cnt('templateGenerated');
    await click('#btn-generate-template');
    await waitMsg('templateGenerated', before, 60_000);
    await setVal('config-spacing', 7);
    const restoreBefore = await cnt('restoreDesignInputs');
    await click('#btn-file-open');
    // V7-41: 단면을 바꿨으니(모델 — 저장 안 한 변경) 다리가 열기 앞에 묻는다 — 「저장 안 함」이면 열기 물음으로
    const asked = await waitFor(`(()=>{const d=document.querySelector('#dialog-host .dialog'); return d && /저장하지 않은 변경/.test(d.textContent) ? d.textContent : null;})()`, 20_000, '저장 안 한 변경 물음');
    await evalTop(`document.querySelector('#dialog-host [data-item="저장 안 함"]').click(); true`);
    await dialogAnswer('열기', saved);
    await waitMsg('restoreDesignInputs', restoreBefore, 60_000);
    await sleep(1500);
    const spacing = await wv(`return D.getElementById('config-spacing').value;`);
    const tpl = await wv(`return D.getElementById('select-template').value + ' ' + D.getElementById('tpl-H').value;`);
    await tab('design');
    const card = await text('#design-summary');
    const ink = await canvasInk('buckling-curve-canvas');
    return { ok: Number(spacing) === Number(savedJson.designInputs?.['config-spacing'] ?? 5) && /OK|NG|판정 없음/.test(card ?? '') && ink > 50,
      detail: `열기 앞 물음 「${short(asked, 50)}」 → 저장 안 함 · 간격 ${spacing} · 템플릿 ${tpl} · 설계 카드 ${short(card ?? '', 60)} · 곡선 잉크 ${ink}` };
  });

  section('6. 좌굴 보고서 패널(두 번째 웹뷰) · PDF');
  await step('s12 좌굴 보고서가 두 번째 웹뷰로 열리고 PDF 단추가 PDF 를 쓴다', async () => {
    await tab('design');
    await click('#btn-view-buckling-report');
    await waitFor(`!document.getElementById('side').hidden`, 30_000, '보고서 칸');
    for (let i = 0; i < 200; i++) {
      if (await side(`return !!D.getElementById('btn-pdf') && D.documentElement.getAttribute('data-stcfsd-bridge')==='connected';`).catch(() => false)) { break; }
      await sleep(150);
    }
    const head = `${await evalTop(`document.getElementById('side-title').textContent`)} | ${await side('return D.body.innerText.slice(0,60);')}`;
    const pdf = path.join(tmp, 'saved', 'buckling.pdf');
    await side(`D.getElementById('btn-pdf').click(); return 1;`);
    await dialogAnswer('PDF', pdf);
    for (let i = 0; i < 200 && !(fs.existsSync(pdf) && fs.statSync(pdf).size > 0); i++) { await sleep(150); }
    const ok = fs.existsSync(pdf) && fs.readFileSync(pdf).subarray(0, 4).toString() === '%PDF';
    if (ok) { fs.copyFileSync(pdf, path.join(OUT, 'buckling-report.pdf')); }
    // V5b-06 · 웹뷰마다 자기 열쇠 — 보고서 웹뷰의 열쇠로는 설계 웹뷰의 통로에 붙지도 · 넣지도 못한다
    const sideId = (await api('GET', '/api/state')).json.data.webviews.find(w => w.id !== designerId)?.id;
    const kSide = (await api('GET', `/api/wv-key?id=${encodeURIComponent(sideId)}`, undefined, {}, { key: true })).json?.data?.key;
    const kDes = (await api('GET', `/api/wv-key?id=${encodeURIComponent(designerId)}`, undefined, {}, { key: true })).json?.data?.key;
    const dOut = await fetch(`${wvOrigin}/api/wv/${encodeURIComponent(designerId)}/out?k=${encodeURIComponent(kSide)}`, { headers: { Authorization: `Bearer ${token}` } });
    const dIn = await fetch(`${wvOrigin}/api/wv/${encodeURIComponent(designerId)}/in?conn=x`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-StCFSD-Webview-Key': kSide }, body: '[{"command":"saveProject"}]' });
    const noId = await api('GET', '/api/wv-key', undefined, {}, { key: true });
    const keysOk = !!sideId && !!kSide && !!kDes && kSide !== kDes && dOut.status === 403 && dIn.status === 403 && noId.status === 400;
    try { await dOut.body?.cancel(); } catch { /* */ } await dIn.arrayBuffer();
    return { ok: ok && keysOk, detail: `${head} · PDF ${ok ? fs.statSync(pdf).size + ' bytes' : '없음'} · V5b-06 보고서 열쇠로 설계 out ${dOut.status} · in ${dIn.status} · 열쇠 다름 ${kSide !== kDes} · id 없는 열쇠 요청 ${noId.status}` };
  });
  await step('s13 보고서 탭의 PDF 저장(호스트가 Edge headless 로 인쇄)', async () => {
    await evalTop(`document.getElementById('side-close').click()`);
    await waitFor(`document.getElementById('side').hidden`, 10_000, '보고서 패널 닫힘');
    await tab('report');
    await click('#btn-generate-report');
    await sleep(1200);
    const pdf = path.join(tmp, 'saved', 'report.pdf');
    await click('#btn-print-report');
    await dialogAnswer('PDF', pdf);
    for (let i = 0; i < 200 && !(fs.existsSync(pdf) && fs.statSync(pdf).size > 0); i++) { await sleep(150); }
    const ok = fs.existsSync(pdf) && fs.readFileSync(pdf).subarray(0, 4).toString() === '%PDF';
    if (ok) { fs.copyFileSync(pdf, path.join(OUT, 'design-report.pdf')); }
    const st = (await api('GET', '/api/state')).json.data;
    return { ok: ok && st.webviews.length === 1, detail: `PDF ${ok ? fs.statSync(pdf).size + ' bytes' : '없음'} · 웹뷰 ${st.webviews.length}개(보고서 닫힘)` };
  });

  section('7. MCP 중계로 바꾼 것이 화면에 보인다');
  await step('s14 set_section_template(중계) → 단면이 바뀌고 낡은 결과가 지워진다', async () => {
    await tab('design');
    const before = await svgShapes();
    const tmplBefore = await wv(`return D.getElementById('tpl-H').value;`);
    const r = await api('POST', '/api/mcp/action', { action: 'generate_template', section_type: 'lippedc', params: { H: 4, B: 1.5, D: 0.5, t: 0.03, r: 0.1 } });
    await sleep(1500);
    const card = await text('#design-summary');
    const dsm = await text('#dsm-table-container');
    await reveal('design-summary');
    const tmplAfter = await wv(`return D.getElementById('tpl-H').value;`);
    return { ok: r.json?.success === true && /결과 없음/.test(card ?? '') && /결과 없음/.test(dsm ?? '') && !/✓ OK|✗ NG/.test(card ?? ''),
      detail: `도형 ${before} → ${await svgShapes()} · tpl-H ${tmplBefore} → ${tmplAfter} · 카드 ${short(card ?? '', 50)} · DSM ${short(dsm ?? '', 40)}` };
  });

  await step('s14b get_section_preview(중계) — 화면이 붙어 있으면 웹뷰가 그린 PNG 가 온다', async () => {
    const r = await api('POST', '/api/mcp/action', { action: 'capture_section_preview' });
    const file = r.json?.file_path;
    const ok = r.json?.success === true && !!file && fs.existsSync(file) && fs.readFileSync(file).subarray(1, 4).toString() === 'PNG';
    if (ok) { fs.copyFileSync(file, path.join(OUT, 's14b_section_preview_from_mcp.png')); fs.rmSync(file, { force: true }); }
    return { ok, detail: ok ? `${r.json.width}×${r.json.height} PNG` : short(r.text, 160) };
  });

  await step('s14c focus(중계) — 한 번만: 다시 보내기 기록에 없고, 이벤트 host:message 에 본문(focus)이 한 번 실린다(U3)', async () => {
    const evs = [];
    const ac = new AbortController();
    const res = await fetch(`${origin}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) { break; }
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
            try { evs.push(JSON.parse(data)); } catch { /* hello 등 */ }
          }
        }
      } catch { /* 끊음 */ }
    })();
    await sleep(300);
    const f = await api('POST', '/api/mcp/action', { action: 'focus', item: { kind: 'result', id: 'buckling_analysis' }, reason: '시험' });
    await sleep(900);
    ac.abort();
    await pump;
    const hits = evs.filter(e => e.type === 'host:message' && e.data?.command === 'focusRequest');
    const kept = (await api('GET', `/api/wv/${encodeURIComponent(designerId)}/last?command=focusRequest`)).json?.data?.focusRequest ?? null;
    const others = evs.filter(e => e.type === 'host:message' && e.data?.command !== 'focusRequest' && 'focus' in (e.data ?? {}));
    return { ok: f.json?.forwarded === true && hits.length === 1 && hits[0].data.focus?.request_id === f.json.request_id && hits[0].data.focus?.reason === '시험' && kept === null && others.length === 0,
      detail: `${f.json?.request_id} · 이벤트 ${hits.length}번(본문 ${short(hits[0]?.data?.focus?.item, 60)}) · 다시 보내기 기록 ${kept === null ? '없음' : '있음'} · 다른 이벤트에 본문 ${others.length}` };
  });

  await step('s14h R2-3 — AI(MCP 토큰)의 호스트 동작은 ai:work 시작 · 끝(도구 이름만), 화면의 중계는 아니다 · /api/person/edit-session(사람의 길만 — MCP 토큰 401, 쓰기 열쇠 없음 403, 틀의 Origin 이면 받는다)', async () => {
    const evs = [];
    const ac = new AbortController();
    const res = await fetch(`${origin}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) { break; }
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
            try { evs.push(JSON.parse(data)); } catch { /* hello 등 */ }
          }
        }
      } catch { /* 끊음 */ }
    })();
    await sleep(300);
    // AI — MCP 포트에 MCP 토큰으로(다리를 거치지 않는다 — Claude Desktop 의 MCP 서버와 같은 길)
    const ai = await fetch(`http://127.0.0.1:${ready.mcpPort}/action`, { method: 'POST', headers: { Authorization: `Bearer ${mcpToken}`, 'Content-Type': 'application/json', 'X-StCFSD-Request-Id': 'bridge-s14h-1', Connection: 'close' },
      body: JSON.stringify({ action: 'get_full_state' }) }).then(r => r.status);
    // 화면 — 다리의 중계(화면 비밀 머리를 다리가 싣는다)
    const scr = await api('POST', '/api/mcp/action', { action: 'get_full_state' });
    await sleep(600);
    const work = evs.filter(e => e.type === 'ai:work');
    const pair = work.filter(e => e.data?.tool === 'get_full_state').map(e => e.data.phase).join(',');
    const leak = work.some(e => Object.keys(e.data ?? {}).some(k => !['phase', 'tool', 'request_id', 'at'].includes(k)));
    // 사람의 길 — edit-session
    const personH = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
    const viaMcpToken = await fetch(`${origin}/api/person/edit-session`, { method: 'POST', headers: { Authorization: `Bearer ${mcpToken}`, 'Content-Type': 'application/json', ...personH, Connection: 'close' }, body: '{"state":"start"}' }).then(r => r.status);
    const noKey = (await api('POST', '/api/person/edit-session', { state: 'start' }, personH, { key: false })).status;
    const badState = (await api('POST', '/api/person/edit-session', { state: 'open' }, personH)).status;
    const start = await api('POST', '/api/person/edit-session', { state: 'start' }, personH);
    const end = await api('POST', '/api/person/edit-session', { state: 'end' }, personH);
    ac.abort();
    await pump;
    return { ok: ai === 200 && scr.status === 200 && pair === 'begin,end' && work.length === 2 && !leak && viaMcpToken === 401 && noKey === 403 && badState === 400
      && start.json?.success === true && end.json?.success === true,
      detail: `AI ${ai} → ai:work ${pair}(모두 ${work.length} — 화면의 중계는 없음) · 실린 키 ${leak ? '넘침' : 'phase · tool · request_id · at'} · edit-session: MCP 토큰 ${viaMcpToken} · 열쇠 없음 ${noKey} · state 틀림 ${badState} · start ${start.json?.success} · end ${end.json?.success}` };
  });

  await step('s14i R5-3 — 발행 미리보기 · 발행 · 내보내기 · 대안 · 발행본 열기는 사람의 길만(MCP 토큰 401 · 쓰기 열쇠 없음 403 · 다른 Origin 403 · 본문의 꼴) · 문서 읽기(GET doc-file)도 MCP 토큰은 401 · 중계의 documents issue 는 없다', async () => {
    const personH = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
    const routes = [['issue/preview', {}], ['issue', { fingerprint: 'x', nonce: 'y' }], ['export', {}], ['alternative', { op: 'keep', label: 'x' }], ['open-doc', { item: 'D-1' }]];
    const out = {};
    for (const [r, b] of routes) {
      const viaMcp = await fetch(`${origin}/api/person/${r}`, { method: 'POST', headers: { Authorization: `Bearer ${mcpToken}`, 'Content-Type': 'application/json', ...personH, Connection: 'close' }, body: JSON.stringify(b) }).then(x => x.status);
      const noKey = (await api('POST', `/api/person/${r}`, b, personH, { key: false })).status;
      const foreign = (await api('POST', `/api/person/${r}`, b, { Origin: 'http://127.0.0.1:1', 'Sec-Fetch-Site': 'cross-site' })).status;
      out[r] = [viaMcp, noKey, foreign];
    }
    const badOp = (await api('POST', '/api/person/alternative', { op: 'delete' }, personH)).status;
    const noNonce = (await api('POST', '/api/person/issue', { fingerprint: 'x' }, personH)).status;
    const docMcp = await fetch(`${origin}/api/person/doc-file?item=D-1`, { headers: { Authorization: `Bearer ${mcpToken}`, Connection: 'close' } }).then(x => x.status);
    const docBad = (await api('GET', '/api/person/doc-file?item=..%2F..%2Fx')).json;
    const relay = (await api('POST', '/api/mcp/action', { action: 'documents', op: 'issue' })).json;
    const layers = Object.values(out).every(([m, k, f]) => m === 401 && k === 403 && f === 403);
    return { ok: layers && badOp === 400 && noNonce === 400 && docMcp === 401 && docBad?.success === false && /issue|발행/.test(JSON.stringify(relay)) && !!(relay?.data?.error ?? relay?.error ?? relay?.data?.reply?.error ?? JSON.stringify(relay).includes('error')),
      detail: `${Object.entries(out).map(([r, v]) => `${r} ${v.join('/')}`).join(' · ')} · 대안 op 틀림 ${badOp} · 숫자 없음 ${noNonce} · doc-file MCP 토큰 ${docMcp} · doc-file 경로 ${docBad?.success === false ? '거절' : '받음'} · 중계 documents issue ${short(JSON.stringify(relay), 80)}` };
  });

  await step('s14d derivedResultsInvalidated — MCP analyze_loads 의 바뀐 입력이 지운 부재 설계 · 랩 결과는 다시 보내기 기록에서도 빠진다(U3)', async () => {
    const loads = { member_app: 'roof-purlin', span_type: 'simple', span_ft: 20, loads: { D: 10, Lr: 20 }, design_method: 'LRFD', spacing_ft: 5, Fy: 55, Fu: 70 };
    const last = async cmds => (await api('GET', `/api/wv/${encodeURIComponent(designerId)}/last?${cmds.map(c => `command=${c}`).join('&')}`)).json?.data ?? {};
    const a1 = await api('POST', '/api/mcp/action', { action: 'analyze_loads', ...loads });
    const lap = await api('POST', '/api/mcp/action', { action: 'lap_connection', d: 8, t: 0.06, Fy: 55, Fu: 70, lap_left_in: 24, lap_right_in: 24, Mu_support: 40, Vu_support: 2,
      fastener_type: 'bolt', fastener_dia: 0.5, n_rows: 2, end_distance: 1.4, design_method: 'LRFD', Se: 1.5, Mnd: 60, Vn: 8 });
    await sleep(400);
    const before = await last(['lapConnectionResult', 'loadAnalysisComplete', 'derivedResultsInvalidated']);
    const a2 = await api('POST', '/api/mcp/action', { action: 'analyze_loads', ...loads, loads: { D: 12, Lr: 20 } });
    await sleep(600);
    const after = await last(['lapConnectionResult', 'designResult', 'designPurlinResult', 'loadAnalysisComplete', 'derivedResultsInvalidated']);
    return { ok: !a1.json?.error && !lap.json?.error && !a2.json?.error && !!before.lapConnectionResult && !after.lapConnectionResult && !after.designResult && !after.designPurlinResult
      && !!after.loadAnalysisComplete && after.derivedResultsInvalidated?.message?.data?.reason === 'Load analysis inputs changed',
      detail: `앞: 랩 ${!!before.lapConnectionResult} · 뒤: 랩 ${!!after.lapConnectionResult} · 설계 ${!!after.designResult} · 퍼린 ${!!after.designPurlinResult} · 하중 ${!!after.loadAnalysisComplete}`
        + ` · 「${after.derivedResultsInvalidated?.message?.data?.reason}」(${short(after.derivedResultsInvalidated?.message?.data?.cause, 80)})` };
  });

  await step('s14e K3 — 페이지의 runValidation · generateReport 가 호스트에 가고 validationResult · reportResult 가 돌아온다 · 보고서는 기록에 남지 않고 점검은 호스트가 쥔 동안만 남는다(4b99968) · 보고서 파일은 호스트가 정한 곳(/api/report)', async () => {
    const last = async cmds => (await api('GET', `/api/wv/${encodeURIComponent(designerId)}/last?${cmds.map(c => `command=${c}`).join('&')}`)).json?.data ?? {};
    // 페이지의 「설계 검증 실행」 — 호스트가 만든 항목이 페이지의 검증 칸에
    await wv(`D.getElementById('btn-run-validation').click(); return 1;`);
    const rows = await waitWv(`const c=D.getElementById('validation-container'); return c && c.querySelectorAll('tr').length>3 ? c.querySelectorAll('tr').length : null;`, 15_000, '페이지의 검증 칸');
    await wv(`D.getElementById('btn-generate-report').click(); return 1;`);
    const rpt = await waitWv(`const c=D.getElementById('report-container'); return c && c.textContent.trim().length>20 ? c.textContent.trim().length : null;`, 20_000, '페이지의 보고서 칸');
    const kept = await last(['validationResult', 'reportResult']);
    const mcpVal = (await api('POST', '/api/mcp/action', { action: 'validate_design', detail: 'full', report_units: 'SI' })).json;
    // 새로 고침 — 다시 실린 페이지는 검증 · 보고서를 다시 받지 않는다(빈 칸) — 다시 묻는다
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitWv(`return D.documentElement.hasAttribute('data-stcfsd-replayed') ? 1 : null;`, 30_000, '다시 실린 페이지');
    await sleep(800);
    const after = await wv(`const c=D.getElementById('validation-container'); return c ? c.querySelectorAll('tr').length : -1;`);
    // 점검 뒤 입력이 바뀌면 호스트가 점검을 장부로(kinds ['validation']) — 기록에서도 지운다
    const sc = await api('POST', '/api/mcp/action', { action: 'set_case_inputs', inputs: { Cb: 1.07 }, reason: '점검 낡음' });
    await sleep(600);
    const keptAfter = await last(['validationResult', 'derivedResultsInvalidated']);
    const resV = (await api('POST', '/api/mcp/action', { action: 'get_full_state' })).json?.results?.validation ?? null;
    // 다리의 /api/report — 화면은 경로를 주지 않는다(주어도 읽지 않는다), 호스트가 쓴 HTML 파일을 다리가 읽어 준다
    const rep = await api('POST', '/api/report', { kind: 'design', format: 'html', units: 'SI', folder: 'C:\\Windows', file_path: 'C:\\x.html' });
    const f = rep.json?.data?.reply?.files?.html;
    const onDisk = f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    const shaOk = !!onDisk && crypto.createHash('sha256').update(onDisk, 'utf8').digest('hex') === rep.json?.data?.sha256 && rep.json.data.html === onDisk;
    const notWindows = !!f && !/^c:\\windows/i.test(f);
    const invKinds = keptAfter.derivedResultsInvalidated?.message?.data?.kinds ?? [];
    return { ok: !!rows && !!rpt && !!kept.validationResult && !kept.reportResult && Array.isArray(mcpVal?.items) && mcpVal.items.length > 10 && after > 3 && sc.json?.success === true
      && !keptAfter.validationResult && !resV && rep.json?.success === true && shaOk && notWindows,
      detail: `페이지 검증 칸 ${rows}줄 · 보고서 ${rpt}자 · 다시 보내기 기록: 검증 ${kept.validationResult ? '있음' : '없음'} · 보고서 ${kept.reportResult ? '있음' : '없음'} · MCP 항목 ${mcpVal?.items?.length}`
        + ` · 입력이 바뀜 → kinds ${JSON.stringify(invKinds)} · 기록의 검증 ${keptAfter.validationResult ? '있음' : '없음'} · 호스트 results.validation ${resV ? '있음' : '없음'}`
        + ` · 새로 고침 뒤 검증 칸 ${after}줄 · /api/report ${rep.json?.success} → ${f ? path.basename(f) : '없음'}(${rep.json?.data?.reply?.folder}) · 파일 = 응답 HTML(sha256) ${shaOk}` };
  });

  // V7-40 · V7-45 — 다시 보내기 기록은 지금 것의 근거가 아니다: 호스트가 지운 판정은 새로 고침 뒤 되살아나지 않고, 범위 밖 결과는 남는다
  const lastOf = async cmds => (await api('GET', `/api/wv/${encodeURIComponent(designerId)}/last?${cmds.map(c => `command=${c}`).join('&')}`)).json?.data ?? {};
  const hostResults = async () => (await api('POST', '/api/mcp/action', { action: 'get_full_state' })).json?.results ?? {};
  const flexUS = { action: 'aisi_design', member_type: 'flexure', Fy: 50, Fu: 65, Mu: 30, Vu: 2, Lb: 60, design_method: 'LRFD' };
  const reloadDesigner = async () => {
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitWv(`return D.documentElement.hasAttribute('data-stcfsd-replayed') ? 1 : null;`, 30_000, '다시 실린 페이지');
    await sleep(1200);
  };
  await step('s14f V7-40 — 설계 → 편집 화면에서 Lb 를 바꿈(호스트가 판정을 지움 — 화면이 시작한 무효화) → 새로 고침 → 지운 「종합 판정」 이 다시 나오지 않는다(칸은 새 값)', async () => {
    const d = await api('POST', '/api/mcp/action', flexUS);
    await waitWv(`return /종합/.test(D.getElementById('design-summary').textContent) ? 1 : null;`, 20_000, '설계 결과 카드');
    const before = await lastOf(['designResult']);
    await wv(`D.querySelector('.tab-btn[data-tab="design"]').click(); const e=D.getElementById('design-Lb'); e.value='9999'; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
    let res = {};
    for (let i = 0; i < 60; i++) { res = await hostResults(); if (!res.member_design) { break; } await sleep(200); }
    await reloadDesigner();
    const after = await lastOf(['designResult']);
    const page = await wv(`return {sum:D.getElementById('design-summary').textContent.replace(/\\s+/g,' ').trim(), lb:D.getElementById('design-Lb').value};`);
    // V8-05: 시작 때 열기의 resultsCleared {reason: 'project opened'} 는 그 뒤에 결과가 오면 지난 일이다 — 다시 보내지 않는다(카드가 「프로젝트를 열었습니다」 로 까닭을 바꾸지 않게)
    const keptCleared = (await lastOf(['resultsCleared'])).resultsCleared;
    return { ok: !d.json?.error && !!before.designResult && !res.member_design && !after.designResult && !/종합 판정|종합판정/.test(page.sum) && !/프로젝트를 열었습니다/.test(page.sum) && !keptCleared
      // V8-05 페이지 쪽(daca0ac): 다시 실린 페이지의 카드는 장부의 까닭(사람의 입력 변경)을 쓴다 — 옛 지우기 메시지(템플릿 · 열기)의 까닭이 아니다
      && /입력/.test(page.sum) && !/템플릿/.test(page.sum),
      detail: `설계 ${d.json?.pass} → 기록에 designResult ${!!before.designResult} → Lb 9999(페이지) → 호스트 결과 member_design ${res.member_design ? '있음' : '없음'} → 새로 고침 → 기록 ${after.designResult ? '있음' : '없음'} · 카드 「${short(page.sum, 70)}」 · 새로 고친 뒤 Lb 칸 ${page.lb}(하중 해석이 있으면 그 Ly 로 자동 — 페이지의 일)` };
  });
  await step('s14g V7-45 — 접합 범위의 무효화(set_case_inputs connT1)는 단일 접합만 지운다 — 부재 설계는 기록 · 새로 고친 페이지에 남는다', async () => {
    await api('POST', '/api/mcp/action', flexUS);
    const c = await api('POST', '/api/mcp/action', { action: 'design_connection', connection_type: 'bolt', t1: 0.06, t2: 0.06, Fu: 65, Fy: 50, d: 0.5, n: 2, s: 1.5, e: 1.0, Pu: 3, design_method: 'LRFD' });
    await sleep(600);
    const a1 = await lastOf(['designResult', 'connectionResult']);
    const sc = await api('POST', '/api/mcp/action', { action: 'set_case_inputs', inputs: { connT1: 0.07 }, reason: '시험 — 접합 판 두께' });
    await sleep(600);
    const a2 = await lastOf(['designResult', 'connectionResult', 'derivedResultsInvalidated']);
    const res = await hostResults();
    await reloadDesigner();
    const page = await wv(`return D.getElementById('design-summary').textContent.replace(/\\s+/g,' ').trim();`);
    return { ok: !c.json?.error && sc.json?.success === true && !!a1.designResult && !!a1.connectionResult && !!a2.designResult && !a2.connectionResult && (a2.derivedResultsInvalidated?.message?.data?.scope === 'connection' || (a2.derivedResultsInvalidated?.message?.data?.scope === 'kinds' && (a2.derivedResultsInvalidated.message.data.kinds ?? []).includes('connection') && !(a2.derivedResultsInvalidated.message.data.kinds ?? []).includes('member_design')))
      && !!res.member_design && !res.connection && /종합/.test(page),
      detail: `앞: 설계 ${!!a1.designResult} · 접합 ${!!a1.connectionResult} → connT1(범위 ${a2.derivedResultsInvalidated?.message?.data?.scope}) → 기록: 설계 ${!!a2.designResult} · 접합 ${!!a2.connectionResult} · 호스트 결과: 설계 ${!!res.member_design} · 접합 ${!!res.connection} · 새로 고친 페이지의 설계 카드 「${short(page, 50)}」` };
  });

  section('8. 새로 고침 — 지금 모델과 결과로 돌아온다');
  await step('s15 해석(중계)한 뒤 새로 고침 → 같은 단면 · 곡선 · DSM 이 다시 그려진다', async () => {
    await api('POST', '/api/mcp/action', { action: 'set_load_case', load_case: 'bending_xx_pos', fy: 50 });
    const run = await api('POST', '/api/mcp/action', { action: 'run_analysis' });
    await sleep(1500);
    const nodesHost = (await api('GET', '/api/mcp/status')).json.nnodes;
    const histBefore = await svgHist();
    const before = { shapes: await svgShapes(), ink: await canvasInk('buckling-curve-canvas'), dsm: await text('#dsm-table-container') };
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(500);
    await designerReady();
    await sleep(2500);
    const replay = await wv(`return D.documentElement.getAttribute('data-stcfsd-replayed');`);
    await tab('design');
    await sleep(800);
    const histAfter = await svgHist();
    const after = { shapes: await svgShapes(), ink: await canvasInk('buckling-curve-canvas'), dsm: await text('#dsm-table-container') };
    const nodesPage = await wv(`return D.querySelectorAll('#node-table tbody tr').length || null;`);
    const nodesAfterHost = (await api('GET', '/api/mcp/status')).json.nnodes;
    return { ok: run.json?.success === true && after.shapes === before.shapes && after.ink > 50 && /\d/.test(after.dsm ?? '') && !/결과 없음/.test(after.dsm ?? '')
      && nodesAfterHost === nodesHost && nodesPage === nodesHost && JSON.stringify(histBefore) === JSON.stringify(histAfter),
      detail: `다시 보냄 ${short(JSON.parse(replay || '{}').commands, 110)} · 도형 ${before.shapes}/${after.shapes} · 곡선 잉크 ${before.ink}/${after.ink} · 호스트 절점 ${nodesHost}/${nodesAfterHost}(기본 단면으로 돌아가지 않음) · 표 ${nodesPage ?? '-'}` };
  });

  section('8b. 설계 탭 입력 — 테마 · 새로 고침 뒤에도 그대로(V5-03 의 뜻, K2: 호스트가 쥔다)');
  const caseFy = async () => (await api('POST', '/api/mcp/action', { action: 'get_case_inputs', keys: ['fy'] })).json ?? {};
  await step('s15b 설계 탭에 Fy 77.7 → 호스트의 검토 상태로(출처 user) → 밝은 테마 → 그대로 → 새로 고침 → 호스트가 다시 보낸 값 그대로', async () => {
    await tab('design');
    const typed = await setVal('design-fy', '77.7');
    const v0 = await wv(`return D.getElementById('design-fy').value;`);
    await evalTop(`window.__stcfsdFrame.setTheme('light'); 1`);
    await waitWv(`return D.documentElement.getAttribute('data-stcfsd-theme')==='light';`, 10_000, '웹뷰 테마');
    const afterTheme = await wv(`return {fy: D.getElementById('design-fy').value, kind: D.body.getAttribute('data-vscode-theme-kind'), bg: W.getComputedStyle(D.documentElement).getPropertyValue('--vscode-editor-background').trim(), nav: performance.getEntriesByType('navigation').length};`);
    const frameLight = await evalTop(`document.documentElement.classList.contains('light')`);
    // 페이지는 칸 변경을 caseEdit 로 곧바로(글자는 300 ms 모아) 호스트에 보낸다 — 호스트의 상태가 그 값인지
    let hostFy = null;
    for (let i = 0; i < 40 && !(hostFy && hostFy.sources?.fy === 'user'); i++) { hostFy = await caseFy(); await sleep(150); }
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(500);
    await designerReady();
    await waitWv(`return D.getElementById('design-fy').value==='77.7';`, 15_000, '호스트가 다시 보낸 상태');
    const afterReload = await wv(`return {fy: D.getElementById('design-fy').value, preserved: D.documentElement.getAttribute('data-stcfsd-preserved'), keep: Object.keys(sessionStorage).filter(k=>/preserve/.test(k)).length};`);
    const pending = (await api('GET', '/api/state')).json?.data?.platform?.pending ?? [];
    await evalTop(`window.__stcfsdFrame.setTheme('dark'); 1`);
    return { ok: typed === 'ok' && v0 === '77.7' && afterTheme.fy === '77.7' && afterTheme.kind === 'vscode-light' && frameLight === true && hostFy?.sources?.fy === 'user'
      && afterReload.fy === '77.7' && afterReload.preserved === null && afterReload.keep === 0 && afterTheme.nav === 1 && pending.length === 0,
      detail: `입력 ${v0} → 호스트 fy ${hostFy?.inputs?.fy}(${hostFy?.sources?.fy}) → 테마 뒤 ${afterTheme.fy}(${afterTheme.kind}, 다시 싣기 없음 ${afterTheme.nav === 1}, 틀 밝음 ${frameLight}) → 새로 고침 뒤 ${afterReload.fy}`
        + ` · 옛 되살림 흔적 ${afterReload.preserved ?? '없음'} · sessionStorage 보존 ${afterReload.keep} · 뜬 물음 ${pending.length}개` };
  });

  await step('s15c 설계 웹뷰가 사라진 사이 호스트가 다른 파일 Y 를 열면 — 다시 뜬 화면은 Y 의 입력(호스트의 상태)이고 옛 입력이 되살아나지 않는다(V5b-02 의 뜻)', async () => {
    // Y = 저장본 사본, 설계 Fy 만 50 MPa(엔진 단위 ksi)
    const yFile = path.join(tmp, 'saved', 'Y 파일.csd');
    const y = JSON.parse(fs.readFileSync(saved, 'utf8'));
    y.designInputs = { ...(y.designInputs ?? {}), fy: 50 / 6.894757 };
    // K2: 1.4 는 case 를 읽는다(designInputs 는 옛 빌드용) — 둘 다 같은 값으로
    if (y.case && y.case.inputs) { y.case.inputs.fy = 50 / 6.894757; }
    fs.writeFileSync(yFile, JSON.stringify(y));
    await tab('design');
    await setVal('design-fy', '77.7');
    const typed = await wv(`return D.getElementById('design-fy').value;`);
    // 설계 웹뷰만 내린다(pagehide → 입력을 모은다) — 그사이 호스트가 Y 를 연다(확장의 「열기」 길)
    await evalTop(`document.getElementById('designer').src='about:blank'; 1`);
    await sleep(600);
    const opened = await serve.ipc('open', { file: yFile }, 120_000);
    await sleep(800);
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(500);
    await designerReady();
    await sleep(1500);
    const s = await wv(`return {fy: D.getElementById('design-fy').value, unit: D.querySelector('#btn-unit-SI.active') ? 'SI' : 'US', preserved: D.documentElement.getAttribute('data-stcfsd-preserved')};`);
    const fy = Number(s.fy);
    const isY = s.unit === 'SI' ? Math.abs(fy - 50) < 0.05 : Math.abs(fy - 7.2519) < 0.005;
    const host = await caseFy();
    // 값이 Y 의 것인지만 본다 — 출처는 페이지가 다시 실린 뒤 칸을 다시 알리면서 바뀔 수 있다(K2 의 일, 보고에 적음)
    const hostY = Math.abs(Number(host.inputs?.fy) - 50 / 6.894757) < 1e-6;
    return { ok: typed === '77.7' && opened?.ok === true && isY && hostY && s.preserved === null,
      detail: `입력 ${typed} → (웹뷰 내림) 호스트가 Y 를 엶(${opened?.ok}) → 다시 뜬 화면 design-fy=${s.fy} ${s.unit}(Y 의 값 ${isY}) · 호스트 fy ${host.inputs?.fy}(${host.sources?.fy}) · 옛 되살림 ${s.preserved ?? '없음'}` };
  });

  section('9. 밝은 · 어두운 테마');
  const contrast = () => wv(`
    const lum=c=>{const m=c.match(/[\\d.]+/g).map(Number); const a=m.length>3?m[3]:1; const f=v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);};
      return {l:0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]), a};};
    const bgOf=e=>{for(let x=e;x;x=x.parentElement){const b=W.getComputedStyle(x).backgroundColor; const L=lum(b); if(L.a>0.5) return b;}
      return W.getComputedStyle(D.documentElement).backgroundColor;};
    const out=[]; const sel=['body','.tab-btn','.tab-btn.active','label','h3','.section-group','input[type=number]','select','button.btn-primary','#design-summary','#status-message','.hint','table td'];
    for(const s of sel){const e=D.querySelector(s); if(!e||!e.offsetParent&&s!=='body') continue; const fg=W.getComputedStyle(e).color, bg=bgOf(e);
      const a=lum(fg).l, b=lum(bg).l; const r=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05); out.push({s, r:+r.toFixed(2), fg, bg});}
    return out;`);
  for (const th of ['light', 'dark']) {
    await step(`s16 ${th === 'light' ? '밝은' : '어두운'} 테마 — 본 화면의 글자 대비`, async () => {
      await cdp.send('Page.navigate', { url: `${origin}/?theme=${th}` });
      await designerReady();
      await sleep(1500);
      await tab('preprocessor');
      await sleep(500);
      const c = await contrast();
      const kind = await wv(`return D.body.getAttribute('data-vscode-theme-kind') + ' ' + W.getComputedStyle(D.documentElement).getPropertyValue('--vscode-editor-background');`);
      const low = c.filter(x => x.r < 3);
      return { ok: c.length >= 6 && low.length === 0, detail: `${kind} · 최저 대비 ${Math.min(...c.map(x => x.r))} (${c.length}곳)${low.length ? ` · 낮음: ${short(low, 200)}` : ''}` };
    });
  }
  process.stdout.write(`  그림 ${shots.length}장: ${OUT}\n`);
}

main().catch(err => {
  process.stdout.write(`\n실패  예외: ${err?.stack ?? err}\n`);
  process.exit(1);
});
