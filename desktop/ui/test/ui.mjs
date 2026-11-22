// U1 시험 — 새 검토 화면(desktop/ui). serve CLI 를 `--ui` 로 자식 프로세스로 띄우고(진짜 호스트 · 진짜 Python),
// 이 PC 의 Edge(없으면 Chrome)를 headless 로 띄워 DevTools 프로토콜로 화면을 본다. AI 의 일은 진짜 MCP 클라이언트
// (media/mcp-server.js, stdio — Claude Desktop 이 쓰는 그 서버)로 한다. 화면의 수는 그 MCP 도구가 돌려준 수와 하나하나 대조한다.
//
//   cd desktop && npm run test:ui        (빌드 뒤 이 파일)
//   node desktop/ui/test/ui.mjs          (UI_VERBOSE=1 이면 serve 의 stderr)
//
// 창 · 포커스: 브라우저는 headless 라 창이 없다. 모델은 임시 폴더 사본만, Claude 설정은 임시 폴더의 없는 경로만 준다.
// 그림은 ui/test/out/(git 에 넣지 않음).
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const SERVE = path.join(repoRoot, 'desktop', 'host', 'dist', 'serve.js');
const MCP_SERVER = path.join(repoRoot, 'media', 'mcp-server.js');
const OUT = path.join(here, 'out');
const VERBOSE = process.env.UI_VERBOSE === '1';
const { US_TO_SI } = require(path.join(repoRoot, 'out', 'mcp', 'siUnits.js'));
let W = 1920, H = 1080;

const results = [];
const started = Date.now();
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  process.stdout.write(`${ok ? '  통과' : '  실패'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
  return !!ok;
}
const section = title => process.stdout.write(`\n▶ ${title}  (+${((Date.now() - started) / 1000).toFixed(1)} s)\n`);
const short = (v, n = 200) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 저장소 · 설정 파일 · 프로세스 (bridge.mjs 와 같은 방식) ───────────────
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
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true });
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

// ── serve CLI · MCP 클라이언트 ─────────────────────────────────────────────
function startServe(args) {
  const child = spawn(process.execPath, [SERVE, ...args], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
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

/** 진짜 MCP 클라이언트(media/mcp-server.js, stdio, 줄 단위 JSON-RPC) — AI 의 자리 */
function startMcpClient(portFile) {
  const env = { ...process.env, STCFSD_MCP_PORT_FILE: portFile, STCFSD_MCP_STANDALONE: '1' };
  delete env.STCFSD_MCP_PORT;
  const child = spawn(process.execPath, [MCP_SERVER], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buf = '';
  let stderr = '';
  const pending = new Map();
  let seq = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) { continue; }
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', c => { stderr += c; });
  const request = (method, params, timeoutMs = 300_000) => new Promise((resolve, reject) => {
    seq += 1;
    const id = seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 시간 초과. stderr: ${stderr.slice(-500)}`)); }, timeoutMs);
    pending.set(id, msg => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  /** 도구 하나 — 응답 글(JSON)을 객체로 */
  const tool = async (name, args = {}) => {
    const r = await request('tools/call', { name, arguments: args });
    const text = r.result?.content?.find(c => c.type === 'text')?.text ?? '';
    let json; try { json = JSON.parse(text); } catch { json = { error: text || JSON.stringify(r.error ?? r) }; }
    return json;
  };
  const close = () => new Promise(resolve => {
    if (child.exitCode !== null) { resolve(); return; }
    child.once('exit', () => resolve());
    child.stdin.end();
    setTimeout(() => child.kill(), 2000).unref();
  });
  return { request, notify, tool, close, pid: child.pid };
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
    '--no-default-browser-check', '--disable-extensions', '--disable-gpu', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
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
  // 끼운 웹뷰는 다른 출처(다리의 웹뷰 서버)라 contentDocument 로 닿지 않는다 — 그 프레임의 실행 문맥에서 직접 돌린다
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
  const frameEval = async (part, expr) => {
    const tree = (await cdp.send('Page.getFrameTree')).frameTree;
    const all = []; const walk = n => { all.push(n.frame); for (const c of n.childFrames ?? []) { walk(c); } }; walk(tree);
    const fr = all.find(x => x.parentId && x.url.includes(part));
    if (!fr) { throw new Error(`프레임 없음: ${part}`); }
    const contextId = contexts.get(fr.id);
    if (!contextId) { throw new Error(`프레임 문맥 없음: ${part}`); }
    const r = await cdp.send('Runtime.evaluate', { expression: expr, contextId, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) { throw new Error(`frame eval: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`); }
    return r.result.value;
  };
  return {
    cdp, log, pid: browser.pid, frameEval,
    async close() {
      try { ws.close(); } catch { /* */ }
      try { spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* */ }
      try { browser.kill(); } catch { /* */ }
    },
  };
}

// ── 값 대조 ──────────────────────────────────────────────────────────────
const at = (obj, p) => p.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
const relClose = (a, b, tol = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
/** 보인 글자 → 수(공백 · 유니코드 빼기) */
const parseShown = t => Number(String(t).replace(/[\s\u00a0\u202f]/g, '').replace(/−/g, '-'));
const decimalsOf = t => { const m = /\.(\d+)/.exec(String(t)); return m ? m[1].length : 0; };

/**
 * 화면의 수 하나 대조. src 의 앞부분 → 기대값:
 *  props · cutwp · dsm · design = 그 MCP 도구가 units:"SI" 로 돌려준 값 그대로
 *  full · nodes · elems = SI 인자가 없는 MCP 도구(get_full_state · get_nodes · get_elements)의 값 × US_TO_SI[종류]
 *  model:sectionParams.K = 시험이 set_section_template 에 준 SI 값(그 값을 돌려주는 MCP 도구가 없다)
 */
function expectedOf(src, u, ctx) {
  const i = src.indexOf(':');
  const pre = src.slice(0, i), p = src.slice(i + 1);
  const f = u === 'none' ? 1 : US_TO_SI[u];
  switch (pre) {
    case 'props': return at(ctx.propsSI, p);
    case 'cutwp': return at(ctx.cutwpSI, p);
    case 'dsm': return ctx.dsmSI ? at(ctx.dsmSI, p) : undefined;
    case 'design': return ctx.designSI ? at(ctx.designSI, p) : undefined;
    case 'full': { const v = at(ctx.full, p); return typeof v === 'number' ? v * f : undefined; }
    case 'nodes': { const [r, c] = p.split('.').map(Number); const v = ctx.nodes?.[r]?.[c]; return typeof v === 'number' ? v * f : undefined; }
    case 'elems': { const [r, c] = p.split('.').map(Number); const v = ctx.elems?.[r]?.[c]; return typeof v === 'number' ? v * f : undefined; }
    case 'model': return p.startsWith('sectionParams.') ? ctx.params?.[p.slice('sectionParams.'.length)] : undefined;
    // U2 — 곡선(MCP get_buckling_curve, US: 0 열 = 반파장 in) · 분류(호스트의 analysisComplete) · 하중 해석 · 퍼린 · 랩 · 접합(MCP 의 SI 응답)
    case 'curve': { const [r, c] = p.split('.').map(Number); const v = ctx.curve?.[r]?.[c]; return typeof v === 'number' ? v * f : undefined; }
    case 'cls': { const [r, m, k] = p.split('.').map(Number); const v = ctx.classes?.[r]?.[m]?.[k]; return typeof v === 'number' ? v : undefined; }
    case 'loads': return ctx.loadsSI ? at(ctx.loadsSI, p) : undefined;
    case 'purlin': return ctx.purlinSI ? at(ctx.purlinSI, p) : undefined;
    case 'lap': return ctx.lapSI ? at(ctx.lapSI, p) : undefined;
    case 'conn': return ctx.connSI ? at(ctx.connSI, p) : undefined;
    default: return undefined;
  }
}

function compareNumbers(items, ctx) {
  const bad = [];
  let compared = 0, skipped = 0;
  const bySrc = {};
  for (const it of items) {
    const exp = expectedOf(it.src, it.u, ctx);
    const pre = it.src.split(':')[0];
    if (exp === undefined) { skipped++; if (!['const', 'model'].includes(pre)) { bad.push(`${it.src}: 기대값 없음(화면 ${it.text})`); } continue; }
    compared++;
    bySrc[pre] = (bySrc[pre] ?? 0) + 1;
    if (!relClose(it.v, exp)) { bad.push(`${it.src}: data-v ${it.v} ≠ MCP ${exp}`); continue; }
    const shown = parseShown(it.text);
    if (it.ratio) {
      // 판정비: 소수 3 자리, NG 는 올림 · 그 밖은 내림
      const okRound = Math.abs(shown - it.v) < 0.001 + 1e-9 && (it.ratio === 'ng' ? shown >= it.v - 1e-9 : shown <= it.v + 1e-9);
      if (!okRound) { bad.push(`${it.src}: 판정비 글자 ${it.text} ↔ ${it.v}`); }
      continue;
    }
    const scaled = it.v / 10 ** it.x;
    const half = 0.5 * 10 ** -decimalsOf(it.text) + 1e-12 * Math.max(1, Math.abs(scaled));
    if (!(Math.abs(shown - scaled) <= half)) { bad.push(`${it.src}: 글자 ${it.text} ↔ ${scaled}`); }
  }
  return { bad, compared, skipped, bySrc };
}

// ── 본 시험 ──────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) { if (f.endsWith('.png')) { fs.rmSync(path.join(OUT, f), { force: true }); } }
  const repoBefore = repoSnapshot();
  const configBefore = new Map(USER_CONFIG_FILES.map(f => [f, statOf(f)]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-u1-ui-'));
  const portFile = path.join(tmp, 'mcp', 'stcfsd-mcp-port');
  const claudeConfig = path.join(tmp, 'Claude', 'claude_desktop_config.json');
  const csd = path.join(tmp, '검토 대상 P1.csd');
  fs.copyFileSync(path.join(repoRoot, 'Example', 'test.csd'), csd);

  section('0. 빌드 확인');
  const uiDist = path.join(repoRoot, 'desktop', 'ui', 'dist');
  check('새 화면 빌드가 있다(ui/dist: main.js · 템플릿 CSS 셋)', ['main.js', 'review.css', 'app.css', 'cfsd.css'].every(f => fs.existsSync(path.join(uiDist, f))),
    fs.existsSync(path.join(uiDist, 'main.js')) ? `${fs.statSync(path.join(uiDist, 'main.js')).size} bytes` : 'cd desktop && npm run build');
  const sameCss = ['review.css', 'app.css', 'cfsd.css'].every(f => fs.readFileSync(path.join(uiDist, f), 'utf8') === fs.readFileSync(path.join(repoRoot, 'desktop', 'design', 'assets', f), 'utf8'));
  check('템플릿 CSS 셋은 design/assets 와 한 글자도 다르지 않다', sameCss);

  section('1. serve --ui 시작');
  let t = Date.now();
  const serve = startServe(['--ui', '--repo', repoRoot, '--user-data', path.join(tmp, 'userData'), '--port-file', portFile,
    '--documents', path.join(tmp, 'Documents'), '--claude-config', claudeConfig]);
  let ready;
  try { ready = JSON.parse((await serve.waitLine(/^STCFSD_BRIDGE_READY /, 150_000)).slice('STCFSD_BRIDGE_READY '.length)); }
  catch (err) { check('serve 가 준비 줄을 낸다', false, String(err.message)); serve.child.kill(); return finish(); }
  const screenLine = serve.lines.find(l => l.startsWith('화면: ')) ?? '';
  check('serve --ui 가 준비 줄을 내고 「화면:」 은 /ui/ 주소다', ready.screen === 'ui' && /\/ui\/\?t=/.test(screenLine) && /\/\?t=/.test(ready.url) && !/\/ui\//.test(ready.url),
    `${Date.now() - t} ms · screen=${ready.screen} · 기본 url 은 틀 그대로`);
  const origin = ready.origin;
  const token = new URL(ready.url).searchParams.get('t');
  const mcpToken = JSON.parse(fs.readFileSync(portFile, 'utf8')).token;
  const api = async (method, route, body, headers = {}) => {
    // 쓰기(GET 아닌 것)에는 화면의 쓰기 열쇠도(V5-04 — 화면이 하는 그대로)
    const res = await fetch(`${origin}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Connection: 'close',
      ...(method === 'GET' ? {} : { 'X-StCFSD-Key': ready.writeKey }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, text, json, headers: res.headers };
  };
  const st0 = (await api('GET', '/api/state')).json?.data;
  const designerId = st0?.designer;

  section('2. 인증 · 격리 — 새 경로');
  const newRoutes = ['/ui/', '/ui/index.html', '/ui/dist/main.js', '/ui/style/ui.css', `/api/wv/${encodeURIComponent(designerId)}/last?command=modelLoaded`,
    `/api/wv/${encodeURIComponent(designerId)}/first?command=modelLoaded`];
  const no = [];
  for (const r of newRoutes) { const res = await fetch(`${origin}${r}`, { headers: { Connection: 'close' } }); no.push(`${r} ${res.status}`); await res.arrayBuffer(); }
  check('토큰 없는 요청은 새 경로 모두 401', no.every(x => / 401$/.test(x)), no.filter(x => !/ 401$/.test(x)).join(', ') || `${no.length}개`);
  const noWrite = await api('POST', '/api/file/open', {});
  check('새 화면을 위해 상태를 바꾸는 다리 경로를 더하지 않았다(열기 · 저장은 끼운 화면의 단추로)', noWrite.status === 404, `POST /api/file/open ${noWrite.status}`);
  const evil = await api('GET', '/ui/', undefined, { Origin: 'http://evil.example' });
  const cors = await api('GET', '/ui/dist/main.js');
  check('다른 Origin 은 403 · CORS 머리 없음', evil.status === 403 && !cors.headers.get('access-control-allow-origin') && !evil.headers.get('access-control-allow-origin'),
    `Origin ${evil.status} · ACAO ${cors.headers.get('access-control-allow-origin') ?? '없음'}`);
  const uiHtml = await api('GET', '/ui/');
  check('/ui/ — 새 화면 HTML 과 틀의 CSP(script-src \'self\', 인라인 스크립트 없음)', uiHtml.status === 200 && uiHtml.text.includes('dist/main.js')
    && /script-src 'self'/.test(uiHtml.headers.get('content-security-policy') ?? '') && !/<script>(?!<\/script>)/.test(uiHtml.text),
    short(uiHtml.headers.get('content-security-policy'), 90));
  const hidden = ['/ui/src/main.ts', '/ui/test/ui.mjs', '/ui/build.mjs', '/ui/..%2Fhost%2Fsrc%2Fserve.ts', '/ui/dist/..%2F..%2Fhost%2FBRIDGE.md', '/ui/style/%2e%2e/build.mjs'];
  const hid = [];
  for (const r of hidden) { const x = await api('GET', r); hid.push(`${r} ${x.status}`); }
  check('새 화면의 소스 · 시험 · 뿌리 밖은 내주지 않는다', hid.every(x => / 404$/.test(x)), hid.filter(x => !/ 404$/.test(x)).join(', ') || `${hidden.length}건 404`);
  const lastMl = await api('GET', `/api/wv/${encodeURIComponent(designerId)}/last?command=modelLoaded&command=designResult`);
  check('/api/wv/<id>/last — 다시 보내기 기록의 마지막 메시지(결과 없으면 null)', lastMl.json?.success && lastMl.json.data.modelLoaded?.message?.command === 'modelLoaded'
    && lastMl.json.data.designResult === null && Number.isInteger(lastMl.json.seq), `seq ${lastMl.json?.seq} · 절점 ${lastMl.json?.data?.modelLoaded?.message?.data?.node?.length}`);
  const leak = [uiHtml.text, cors.text, (await api('GET', '/api/state')).text, lastMl.text, (await api('GET', '/ui/style/ui.css')).text];
  check('MCP 토큰이 새 화면에 가는 어디에도 없다', leak.every(x => !x.includes(mcpToken)), `${leak.length}곳`);
  const frame = await api('GET', '/');
  check('기본 화면(/)은 그대로 틀이다', frame.status === 200 && frame.text === fs.readFileSync(path.join(repoRoot, 'desktop', 'host', 'frame', 'index.html'), 'utf8'),
    '/frame/frame.js · 설계 패널 iframe');

  const mcp = startMcpClient(portFile);
  const init = await mcp.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stcfsd-u1-ui', version: '0' } });
  mcp.notify('notifications/initialized', {});
  check('진짜 MCP 클라이언트(AI 의 자리)가 이 호스트에 붙는다', !!init.result, init.result?.serverInfo?.name ?? short(init.error));

  const exe = findBrowser();
  if (!exe) {
    check('Edge/Chrome 이 있다(화면 단계)', false, 'STCFSD_BROWSER 로 실행 파일을 줄 수 있다');
  } else {
    const br = await startBrowser(exe, path.join(tmp, 'browser-profile'));
    try { await screenSteps({ br, serve, api, ready, token, tmp, csd, mcp, designerId, mcpToken }); }
    catch (err) { check('화면 단계가 예외 없이 끝난다', false, String(err?.stack ?? err).slice(0, 1500)); }
    finally { await br.close(); }
  }
  await mcp.close();

  section('8. 끝내기 — 프로세스 · 포트가 남지 않는다');
  const st = await serve.ipc('status');
  check('미구현 vscode API 에 닿은 곳이 없다', st.unimplemented.length === 0, st.unimplemented.map(u => u.name).join(', ') || '0종');
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

  section('9. 스위치 없이 띄우면 기본 화면은 그대로');
  const plainPortFile = path.join(tmp, 'mcp2', 'port');
  const plain = startServe(['--repo', repoRoot, '--user-data', path.join(tmp, 'userData2'), '--port-file', plainPortFile, '--documents', path.join(tmp, 'Documents'),
    '--claude-config', claudeConfig]);
  try {
    const r2 = JSON.parse((await plain.waitLine(/^STCFSD_BRIDGE_READY /, 150_000)).slice('STCFSD_BRIDGE_READY '.length));
    const line2 = plain.lines.find(l => l.startsWith('화면: ')) ?? '';
    const tok2 = new URL(r2.url).searchParams.get('t');
    const root2 = await fetch(`${r2.origin}/`, { headers: { Authorization: `Bearer ${tok2}`, Connection: 'close' } });
    const html2 = await root2.text();
    check('--ui 없이: 「화면:」 은 틀(/) 주소 · / 는 틀 HTML', r2.screen === 'frame' && line2 === `화면: ${r2.url}` && /\/\?t=/.test(line2) && html2.includes('/frame/frame.js'),
      `screen=${r2.screen} · ${line2.replace(/t=.*/, 't=…')}`);
    const kids2 = descendants(plain.child.pid);
    await plain.ipc('shutdown', {}, 10_000).catch(() => undefined);
    const e2 = await Promise.race([plain.exited, sleep(30_000).then(() => undefined)]);
    if (!e2) { plain.child.kill(); }
    for (let i = 0; i < 100 && kids2.some(k => alive(k.pid)); i++) { await sleep(50); }
    check('그 serve 도 남기는 것 없이 끝난다', e2?.code === 0 && kids2.every(k => !alive(k.pid)) && await portIsFree(r2.port) && await portIsFree(r2.mcpPort) && !fs.existsSync(plainPortFile),
      `코드 ${e2?.code}`);
  } catch (err) { check('--ui 없는 serve', false, String(err.message)); plain.child.kill(); }

  section('10. 저장소 · 사용자 설정 파일');
  const changed = diffSnapshots(repoBefore, repoSnapshot());
  check('desktop/ 밖에서 저장소가 바뀌지 않았다', changed.length === 0, changed.slice(0, 8).join('; ') || '그대로');
  const cfgChanged = USER_CONFIG_FILES.filter(f => statOf(f) !== configBefore.get(f));
  check('사용자 MCP · Claude Desktop 설정 · 앱 데이터 포트 파일이 그대로다', cfgChanged.length === 0, cfgChanged.join(', ') || `${USER_CONFIG_FILES.length}개 경로 그대로`);
  check('Claude 설정은 임시 폴더의 없는 경로만 — 만들지 않았다', !fs.existsSync(path.dirname(claudeConfig)));
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
async function screenSteps({ br, serve, api, ready, token, tmp, csd, mcp, designerId, mcpToken }) {
  const { cdp, log } = br;
  const ev = async expr => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) { throw new Error(`eval: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`); }
    return r.result.value;
  };
  /** 끼운 설계 웹뷰(다른 출처)의 문맥에서 — D = document */
  const wv = body => br.frameEval(`/wv/${encodeURIComponent(designerId)}/`, `(()=>{const D=document;${body}})()`);
  const waitWv = async (body, timeout, what) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const v = await wv(body).catch(() => undefined);
      if (v) { return v; }
      if (Date.now() > deadline) { throw new Error(`기다림 시간 초과: ${what}`); }
      await sleep(150);
    }
  };
  const waitFor = async (expr, timeout = 30_000, what = expr) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const v = await ev(expr).catch(() => undefined);
      if (v) { return v; }
      if (Date.now() > deadline) { throw new Error(`기다림 시간 초과: ${what}`); }
      await sleep(150);
    }
  };
  const mark = () => ({ con: log.console.length, exc: log.exceptions.length });
  const problems = m => ({
    exceptions: log.exceptions.slice(m.exc).map(e => short(e.text, 160)),
    errors: log.console.slice(m.con).filter(c => c.type === 'error' || c.type === 'log-error' || c.type === 'assert').map(c => short(c.text, 160)),
  });
  // 새 화면과 끼운 웹뷰(다른 출처 — 그 프레임의 문맥에서) 모두의 글자에서 깨진 값
  const SCAN = `const out=[]; const scan=(t,w)=>{const re=/(undefined|NaN|\\[object Object\\])/g; let m; while((m=re.exec(t))){out.push(w+': '+t.slice(Math.max(0,m.index-50), m.index+30).replace(/\\n/g,' | '));}};`;
  const badTokens = async () => [...await ev(`(()=>{${SCAN} scan(document.body.innerText,'화면'); return out;})()`),
    ...await wv(`${SCAN} if(D.body){scan(D.body.innerText,'웹뷰');} return out;`).catch(() => [])];
  const shot = async name => {
    await sleep(400);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, `${name}.png`);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  };
  const step = async (name, shotName, fn) => {
    const m = mark();
    let detail = '';
    let ok = false;
    const t0 = Date.now();
    try { const r = await fn(); ok = r?.ok !== false; detail = r?.detail ?? ''; }
    catch (err) { ok = false; detail = String(err?.message ?? err).slice(0, 600); }
    const f = shotName ? await shot(shotName) : null;
    const p = problems(m);
    const bad = await badTokens().catch(() => []);
    check(name, ok, `${((Date.now() - t0) / 1000).toFixed(1)} s · ${detail}`);
    check('  └ 페이지 예외 · 콘솔 오류(CSP 포함) · undefined/NaN/[object Object] 0', p.exceptions.length === 0 && p.errors.length === 0 && bad.length === 0,
      [...p.exceptions, ...p.errors, ...bad.map(b => `글자: ${b}`)].join(' / ') || (f ? path.basename(f) : ''));
  };
  const S = `window.__stcfsdUi`;
  const seq = () => ev(`${S}.state.msgSeq`);
  /** 화면이 다리를 다시 읽어 조건을 만족할 때까지 */
  const settle = (cond, what, timeout = 60_000) => waitFor(`(()=>{const s=${S}.state; return ${cond};})()`, timeout, what);
  const select = async (tab, key) => { await ev(`${S}.select(${JSON.stringify(tab)}, ${JSON.stringify(key)})`); await sleep(250); };
  const click = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'MISSING'; e.click(); return 'ok';})()`);
  const text = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); return e? e.innerText : null;})()`);
  const numbers = (root = '#review') => ev(`[...document.querySelectorAll(${JSON.stringify(root)} + ' [data-src]')].map(e=>({src:e.dataset.src,u:e.dataset.u,v:Number(e.dataset.v),x:Number(e.dataset.x||0),ratio:e.dataset.ratio||null,text:e.textContent}))`);
  /** 지금 상태의 MCP 값(도구로 — AI 와 같은 길) */
  const mcpNow = async () => ({
    full: await mcp.tool('get_full_state'), propsSI: await mcp.tool('get_section_properties', { units: 'SI' }), cutwpSI: await mcp.tool('get_cutwp', { units: 'SI' }),
    nodes: (await mcp.tool('get_nodes')).nodes, elems: (await mcp.tool('get_elements')).elements,
    curve: (await mcp.tool('get_buckling_curve')).curve,
    // 화면이 지금 보여 주는 해석 계열의 DSM 값(보기의 극소 표지 · 정보 창이 이것을 쓴다)
    dsmSI: await (async () => { const fam = await ev(`${S}.state.dsm && ${S}.state.dsm.family`).catch(() => null); return fam ? mcp.tool('get_dsm_values', { load_type: fam, units: 'SI' }) : undefined; })(),
    classes: (await api('GET', `/api/wv/${encodeURIComponent(designerId)}/last?command=analysisComplete`)).json?.data?.analysisComplete?.message?.data?.classifications,
  });
  const marker = () => ev('window.__noReload');

  section('3. 시작 화면(템플릿 00) → .csd 열기');
  await cdp.send('Page.navigate', { url: ready.uiUrl });
  await waitFor(`!!window.__stcfsdUi && ${S}.state.ready`, 60_000, '새 화면이 다리를 처음 읽음');
  await step('u01 파일 없이 뜨면 시작 화면 — 최근 검토 · Claude 연결 · 새 검토', 'u01_start', async () => {
    const s = await ev(`({screen:${S}.ui.screen, start:!document.getElementById('start').hidden, title:document.getElementById('tbar').innerText,
      txt:document.getElementById('start').innerText, status:document.querySelector('.status .msg').textContent, steps:document.querySelectorAll('#start .step').length,
      newc:document.querySelectorAll('#start .newc > div').length, row:document.querySelector('#start .rows tr')?.innerText})`);
    const ok = s.screen === 'start' && s.start && /최근 검토/.test(s.txt) && /Claude Desktop 연결/.test(s.txt) && /새 검토/.test(s.txt) && s.steps === 3 && s.newc === 4
      && /열린 검토 대상 없음/.test(s.status) && /Claude Desktop 없음/.test(s.title) && /립 C 100×50×20×2\.3/.test(s.row ?? '') && /프로그램 기본 단면/.test(s.row ?? '');
    return { ok, detail: `${s.screen} · 단계 ${s.steps} · 새 검토 ${s.newc} · 지금 모델 「${short((s.row ?? '').replace(/\s+/g, ' '), 70)}」` };
  });
  await ev('window.__noReload = 1');
  await step('u02 「파일만 열기 (.csd)」 → 열기 물음 → 경로 → 검토 화면으로', 'u02_opened', async () => {
    await waitWv(`return D.documentElement.getAttribute('data-stcfsd-bridge')==='connected' && !!D.getElementById('btn-file-open');`, 60_000, '끼운 웹뷰 연결');
    await click('#start .foot a[data-act="open"]');
    await waitFor(`!!document.querySelector('#dialog-host .dialog[data-kind="fileDialog"]')`, 30_000, '열기 물음');
    const title = await ev(`document.querySelector('#dialog-host .dialog h2').textContent`);
    await ev(`(()=>{const d=document.querySelector('#dialog-host .dialog'); d.querySelector('input').value=${JSON.stringify(csd)}; d.querySelector('[data-role="ok"]').click(); return 1;})()`);
    await settle(`s.file.path===${JSON.stringify(csd)} && ${S}.ui.screen==='review' && s.full && s.full.nnodes===21`, '파일이 열리고 검토 화면');
    const s = await ev(`({fname:document.querySelector('#tbar .fname').textContent, docTitle:document.title, startHidden:document.getElementById('start').hidden,
      info:document.getElementById('info').innerText})`);
    return { ok: s.fname === path.basename(csd) && s.startHidden && /템플릿 치수 없음/.test(s.info) && /검토 대상 P1\.csd — StCFSD/.test(s.docTitle),
      detail: `물음 「${title}」 · 제목 표시줄 ${s.fname} · 템플릿 기록이 없는 단면은 「템플릿 치수 없음」` };
  });

  section('4. 템플릿 01 — AI 가 단면을 정한다 · 화면의 수 = MCP');
  const params1 = { H: 150, B: 65, D: 20, t: 2, r: 3 };
  const tpl1 = await mcp.tool('set_section_template', { type: 'lippedc', ...params1, units: 'SI' });
  check('AI: set_section_template(립 C 150×65×20×2.0 r3, SI)', tpl1.success === true, short(tpl1.error ?? `절점 ${tpl1.nnodes} · 요소 ${tpl1.nelems}`));
  await step('u03 모델 · 단면 — 트리 · 정보 창 · 단면 그림이 새 단면을 따라온다(새로 고침 없이)', 'u03_section', async () => {
    await settle(`s.model && s.model.sectionTemplate==='lippedc' && s.nodes.length===${tpl1.nnodes} && s.propsSI`, '새 단면');
    await select('model', 'sec');
    const s = await ev(`({tree:document.getElementById('tree').innerText, info:document.getElementById('info').innerText, share:document.querySelector('#share b').textContent})`);
    const ok = (await marker()) === 1 && /립 C 150×65×20×2/.test(s.tree) && /종류 · 치수/.test(s.info) && /단면 성질/.test(s.info) && /요소 분할/.test(s.info) && /재료/.test(s.tree)
      && /해석 조건/.test(s.tree) && /단면 「립 C 150×65×20×2」/.test(s.share);
    return { ok, detail: `트리 · 정보 · 「Claude 가 보는 선택」 = ${s.share} · 새로 고침 없음 ${(await marker()) === 1}` };
  });
  {
    const ctx = { ...(await mcpNow()), params: params1 };
    const items = await numbers();
    const r = compareNumbers(items, ctx);
    check('화면의 수(트리 · 정보 창 · 절점/요소 표 · 그림 치수) = MCP 도구의 값(SI 변환 뒤)', r.bad.length === 0 && r.compared >= 100,
      r.bad.slice(0, 6).join(' / ') || `${r.compared}개 대조 · ${JSON.stringify(r.bySrc)} · 건너뜀 ${r.skipped}(상수 · 모델 기본)`);
    const geo = await ev(`(()=>{const g=document.querySelector('#center .sec-geo'); const cs=[...g.querySelectorAll('circle[data-n]')].map(c=>({x:+c.dataset.x,z:+c.dataset.z,cx:+c.getAttribute('cx'),cy:+c.getAttribute('cy')}));
      return {n:+g.dataset.nodes, e:+g.dataset.elems, lines:g.querySelectorAll('line[data-e]').length, bbox:g.dataset.bbox.split(',').map(Number), cs};})()`);
    const xs = ctx.nodes.map(n => n[1] * US_TO_SI.length), zs = ctx.nodes.map(n => n[2] * US_TO_SI.length);
    const bbox = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
    const a = geo.cs[0], b = geo.cs.reduce((m, c) => (Math.hypot(c.x - a.x, c.z - a.z) > Math.hypot(m.x - a.x, m.z - a.z) ? c : m), a);
    const sx = (b.cx - a.cx) / ((b.x - a.x) || 1e-9), sz = (b.cy - a.cy) / ((b.z - a.z) || 1e-9);
    const scale = Math.abs(b.x - a.x) > Math.abs(b.z - a.z) ? sx : -sz;
    const maxErr = Math.max(...geo.cs.map(c => Math.hypot(a.cx + scale * (c.x - a.x) - c.cx, a.cy - scale * (c.z - a.z) - c.cy)));
    check('단면 그림 = 절점 · 요소(MCP get_nodes · get_elements): 수 · 경계 상자 · 축척(같은 비율, 위가 +z)', geo.n === ctx.nodes.length && geo.e === ctx.elems.length
      && geo.lines === ctx.elems.length && geo.cs.length === ctx.nodes.length && geo.bbox.every((v, i) => relClose(v, bbox[i])) && maxErr < 0.2,
      `절점 ${geo.n}/${ctx.nodes.length} · 요소 ${geo.e}/${ctx.elems.length} · 상자 ${geo.bbox.map(v => v.toFixed(2)).join(',')} mm · 최대 어긋남 ${maxErr.toFixed(3)} px`);
  }
  await step('u03b 트리에서 고르면 정보 창이 따라온다(재료 · 해석 조건 · 절점)', null, async () => {
    await click('#tree .row[data-k="mat"] .nm');
    await sleep(200);
    const mat = await text('#info');
    await click('#tree .row[data-k="cond"] .nm');
    await sleep(200);
    const cond = await text('#info');
    await ev(`(()=>{const r=document.querySelector('#tree .row[data-k="sec"] .tw'); r.click(); return 1;})()`);
    await sleep(150);
    await ev(`(()=>{const r=document.querySelector('#tree .row[data-k="sec"] .tw'); r.click(); return 1;})()`);
    await sleep(150);
    await click('#tree .row[data-k="snode"] .nm');
    await sleep(200);
    const sel = await ev(`document.querySelector('#tree .row.on')?.dataset.k`);
    return { ok: /탄성 상수/.test(mat) && /설계 강도/.test(mat) && /편집 상태의 입력 칸에만 있다/.test(mat) && /경계조건/.test(cond) && /반파장 범위/.test(cond) && sel === 'snode',
      detail: `재료: E · ν · G + 「Fy · Fu 편집 상태의 입력 칸에만」 · 해석 조건: 경계조건 · 반파장 · 응력 · 고른 줄 ${sel}` };
  });

  section('5. AI 를 따라간다 — 해석 · 검토 뒤 단면을 바꾸면 결과는 낡음');
  const lc = await mcp.tool('set_load_case', { load_case: 'bending_xx_pos', fy: 295, units: 'SI' });
  const run1 = await mcp.tool('run_analysis');
  const flex = await mcp.tool('aisi_design_flexure', { Fy: 295, Lb: 1500, Mu: 2, units: 'SI' });
  check('AI: set_load_case(정휨, 295 MPa) → run_analysis → aisi_design_flexure(SI)', lc.success && run1.success && !flex.error && typeof flex.pass === 'boolean',
    short(flex.error ?? `pass=${flex.pass} · 이용률 ${flex.utilization}`));
  await step('u04a 진행 띠: 좌굴 해석 ● · 부재 검토 ● (새로 고침 없이)', null, async () => {
    await settle(`s.stages.fsm.state==='ok' && s.stages.chk.state==='ok' && s.dsm && s.runs.length>0`, '해석 · 검토 결과');
    const pipe = await ev(`[...document.querySelectorAll('#tbar .pipe .ps')].map(e=>e.dataset.stage+':'+e.dataset.state).join(' ')`);
    return { ok: /fsm:ok/.test(pipe) && /chk:ok/.test(pipe) && (await marker()) === 1, detail: pipe };
  });
  {
    const dsmSI = await mcp.tool('get_dsm_values', { load_type: 'Mxx', units: 'SI' });
    await select('result', 'fsm');
    const ctx = { ...(await mcpNow()), params: params1, dsmSI, designSI: flex };
    const r = compareNumbers(await numbers(), ctx);
    check('결과 · 좌굴 해석의 수 = MCP get_dsm_values(SI)', r.bad.length === 0 && (r.bySrc.dsm ?? 0) >= 12, r.bad.slice(0, 6).join(' / ') || `${r.compared}개 · dsm ${r.bySrc.dsm}`);
  }
  const params2 = { H: 200, B: 75, D: 20, t: 2.3, r: 4 };
  const tpl2 = await mcp.tool('set_section_template', { type: 'lippedc', ...params2, units: 'SI' });
  await step('u04 AI 가 단면을 바꾸면 — 트리 · 정보 · 그림은 새 단면, 좌굴 · 검토는 낡음(옛 수가 남지 않는다)', 'u04_stale', async () => {
    await settle(`s.nodes.length===${tpl2.nnodes} && s.model.sectionParams && Math.abs(s.model.sectionParams.H*25.4-200)<1e-9 && s.stages.fsm.state==='stale' && s.stages.chk.state==='stale'`, '낡음');
    await select('result', 'chk');
    const s = await ev(`({pipe:[...document.querySelectorAll('#tbar .pipe .ps')].map(e=>e.dataset.stage+':'+e.dataset.state).join(' '),
      tree:document.getElementById('tree').innerText, center:document.getElementById('center').innerText, info:document.getElementById('info').innerText,
      old:document.querySelectorAll('[data-src^="design:"],[data-src^="dsm:"]').length, nodes:+document.querySelector('#center .sec-geo')?.dataset.nodes || null})`);
    await select('model', 'sec');
    const sec = await ev(`({n:+document.querySelector('#center .sec-geo').dataset.nodes, info:document.getElementById('info').innerText})`);
    const ok = /fsm:stale/.test(s.pipe) && /chk:stale/.test(s.pipe) && /좌굴 해석\s*낡음/.test(s.tree) && /부재 검토\s*낡음/.test(s.tree) && /낡음 — 결과를 지웠다/.test(s.center)
      && /Section template changed/.test(s.info) && s.old === 0 && sec.n === tpl2.nnodes && /립 C 200×75×20×2\.3/.test(sec.info) && (await marker()) === 1;
    await select('result', 'chk');
    return { ok, detail: `${s.pipe} · 옛 결과의 수 ${s.old}개 · 그림 절점 ${sec.n} · 까닭 「Section template changed」` };
  });
  {
    const ctx = { ...(await mcpNow()), params: params2 };
    await select('model', 'sec');
    const r = compareNumbers(await numbers(), ctx);
    check('바뀐 단면의 수도 MCP 와 같다', r.bad.length === 0 && r.compared >= 100, r.bad.slice(0, 6).join(' / ') || `${r.compared}개 대조`);
  }

  section('6. 템플릿 04 — 부재 검토: 판정비 · 판정 · 경고 / 가정 / 범위');
  const lc2 = await mcp.tool('set_load_case', { load_case: 'compression', fy: 295, units: 'SI' });
  const run2 = await mcp.tool('run_analysis');
  check('AI: set_load_case(압축) → run_analysis', lc2.success && run2.success, short(run2.error ?? `길이 ${run2.lengths_analyzed}`));
  // KtLt 를 주지 않으면 엔진은 E2 휨-비틀림을 평가하지 않는다(not_evaluated) — Pu 를 크게 주면 평가한 한계상태는 NG
  const compNg = await mcp.tool('aisi_design_compression', { Fy: 295, KxLx: 3000, KyLy: 3000, Pu: 400, units: 'SI' });
  check('AI: aisi_design_compression(KtLt 없음 · Pu 400 kN) — 엔진: NG 와 미검토가 함께', compNg.pass === false && (compNg.not_evaluated ?? []).length > 0
    && (compNg.limit_state_checks ?? []).some(x => x.pass === false), short(compNg.error ?? `pass=${compNg.pass} · ${JSON.stringify(compNg.limit_state_checks)} · 미검토 ${JSON.stringify(compNg.not_evaluated)}`, 260));
  const verify04 = async (res, label) => {
    await settle(`s.runs.length>0 && s.runs[0].us && s.runs[0].us.pass===${JSON.stringify(res.pass)} && s.runs[0].rows.length===${(res.limit_state_checks ?? []).length + (res.not_evaluated ?? []).length}`, `${label} 결과`);
    const firstNg = (res.limit_state_checks ?? []).findIndex(x => x.pass === false);
    await select('result', firstNg >= 0 ? `design#ls${firstNg}` : 'design#ne0');
    const s = await ev(`(()=>{const rows=[...document.querySelectorAll('#center table.vt tr.ck')].map(r=>({k:r.dataset.k, v:r.dataset.verdict, ratio:r.querySelector('[data-ratio]')?.textContent??null, verdict:r.lastElementChild.textContent.trim()}));
      const secs={}; document.querySelectorAll('#info .sec').forEach(s=>{const h=s.querySelector('h4'); if(h){const name=h.childNodes[0]?.textContent?.trim(); secs[name]=[...s.querySelectorAll('li')].map(l=>l.textContent);}});
      return {rows, secs, treeChk:document.querySelector('#tree .row[data-k="chk"] .vl')?.textContent, head:document.querySelector('#info .hd').textContent.replace(/\s+/g,' '), tree:document.getElementById('tree').innerText, out:document.querySelectorAll('#center tr.out').length};})()`);
    const exp = [...(res.limit_state_checks ?? []).map(x => (x.pass === true ? 'ok' : x.pass === false ? 'ng' : 'un')), ...(res.not_evaluated ?? []).map(() => 'ne')];
    const rowsOk = JSON.stringify(s.rows.map(r => r.v)) === JSON.stringify(exp)
      && s.rows.filter(r => r.v === 'ne').every(r => r.verdict === '미검토' && r.ratio === null);
    const wl = [...(res.warnings ?? [])], al = [...(res.assumptions ?? [])], sl = [...(res.scope_notes ?? [])];
    for (const [k, v] of Object.entries(res)) { if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'region' && k !== 'force_model') {
      for (const x of v.warnings ?? []) { wl.push(`[${k}] ${x}`); } for (const x of v.assumptions ?? []) { al.push(`[${k}] ${x}`); } for (const x of v.scope_notes ?? []) { sl.push(`[${k}] ${x}`); } } }
    if (res.dsm_warning) { wl.push(`[DSM] ${res.dsm_warning}`); }
    const listsOk = JSON.stringify(s.secs['경고'] ?? []) === JSON.stringify(wl) && JSON.stringify(s.secs['가정'] ?? []) === JSON.stringify(al) && JSON.stringify(s.secs['범위'] ?? []) === JSON.stringify(sl);
    const overall = res.pass === false ? 'NG' : res.pass === true ? 'OK' : '판정 없음';
    const cnt = { ng: exp.filter(x => x === 'ng').length, un: exp.filter(x => x === 'un' || x === 'ne').length, ok: exp.filter(x => x === 'ok').length };
    const treeOk = s.treeChk === `NG ${cnt.ng} · 미검토 ${cnt.un} · OK ${cnt.ok}`;
    if (!treeOk) { s.rows.push({ v: `트리 「${s.treeChk}」` }); }
    const headOk = s.head.includes(`검토 전체 ${overall}`);
    if (!headOk) { s.rows.push({ v: `머리 「${s.head.slice(0, 80)}」` }); }
    const ctx = { ...(await mcpNow()), params: params2, designSI: res };
    const r = compareNumbers(await numbers(), ctx);
    return {
      ok: rowsOk && listsOk && headOk && treeOk && r.bad.length === 0 && (r.bySrc.design ?? 0) >= 3 && s.out === (res.not_checked ?? []).length,
      detail: `트리 「${s.treeChk}」 · 줄 ${s.rows.map(x => `${x.v}${x.ratio ? ` ${x.ratio}` : ''}`).join(' · ')} · 전체 ${overall} · 경고 ${wl.length} / 가정 ${al.length} / 범위 ${sl.length} 따로 · 범위 밖 ${s.out}`
        + ` · 수 ${r.compared}개 = MCP(design ${r.bySrc.design ?? 0})${r.bad.length ? ` · 어긋남 ${r.bad.slice(0, 3).join(' / ')}` : ''}${!rowsOk ? ` · 기대 ${exp.join(',')}` : ''}${!listsOk ? ` · 목록 ${short(s.secs, 200)}` : ''}`,
    };
  };
  await step('u05 NG + 미검토 — 엔진의 판정 그대로(NG > 미검토 > OK), 판정비 = MCP', 'u05_checks_ng', () => verify04(compNg, 'NG'));
  const compNe = await mcp.tool('aisi_design_compression', { Fy: 295, KxLx: 3000, KyLy: 3000, Pu: 5, units: 'SI' });
  check('AI: aisi_design_compression(KtLt 없음 · Pu 5 kN) — 엔진: 평가한 것은 OK, 전체는 판정 없음', compNe.pass === null && (compNe.limit_state_checks ?? []).every(x => x.pass === true)
    && (compNe.not_evaluated ?? []).length > 0, short(compNe.error ?? `pass=${compNe.pass}`));
  await step('u06 OK + 미검토 — 「판정 없음」(OK 로 보이지 않는다)', 'u06_checks_ne', () => verify04(compNe, '판정 없음'));

  section('7. 테마 · 좁은 창');
  const contrast = () => ev(`(()=>{const lum=c=>{const m=c.match(/[\\d.]+/g).map(Number); const f=v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]);};
    const bg=e=>{for(let x=e;x;x=x.parentElement){const b=getComputedStyle(x).backgroundColor; const m=b.match(/[\\d.]+/g); if(m&&(m.length<4||+m[3]>0.5)) return b;} return getComputedStyle(document.body).backgroundColor;};
    const out={}; for(const [k,s] of Object.entries({tree:'#tree .row .nm', info:'#info .ttl', infoNum:'#info .num', status:'.status .msg', title:'#tbar .fname', tab:'#ttabs a.on', vt:'#center table.vt td'})){
      const e=document.querySelector(s); if(!e){out[k]=null; continue;} const a=lum(getComputedStyle(e).color), b=lum(bg(e)); out[k]=+((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2);} return out;})()`);
  await step('u08 어두운 테마 — 글자 대비', 'u08_dark', async () => {
    await select('result', 'design#ls0');
    const c = await contrast();
    const vals = Object.values(c).filter(v => v !== null);
    return { ok: vals.length >= 6 && vals.every(v => v >= 4.5), detail: JSON.stringify(c) };
  });
  await step('u09 밝은 테마 — 페이지를 다시 싣지 않고 바꾼다(끼운 화면도 그대로) · 글자 대비', 'u09_light', async () => {
    const src0 = await ev(`document.getElementById('designer').src`);
    await ev(`${S}.setTheme('light')`);
    await sleep(300);
    await select('result', 'design#ls0');
    const c = await contrast();
    const vals = Object.values(c).filter(v => v !== null);
    const th = await ev(`document.documentElement.dataset.theme`);
    const same = (await ev(`document.getElementById('designer').src`)) === src0 && (await marker()) === 1;
    return { ok: th === 'light' && same && vals.length >= 6 && vals.every(v => v >= 4.5), detail: `${th} · 다시 싣지 않음 ${same} · ${JSON.stringify(c)}` };
  });
  await step('u09b 밝은 테마 — 모델 · 단면', 'u09b_light_section', async () => {
    await select('model', 'sec');
    const c = await contrast();
    return { ok: Object.values(c).filter(v => v !== null).every(v => v >= 4.5), detail: JSON.stringify(c) };
  });
  await ev(`${S}.setTheme('dark')`);
  W = 960; H = 900;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await step('u10 960 px 창 — 트리가 접히고 보기 · 정보 창, 가로 스크롤 없음', 'u10_960', async () => {
    await select('result', 'design#ls0');
    await sleep(300);
    const s = await ev(`({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth, left:getComputedStyle(document.getElementById('left')).display,
      info:document.getElementById('info').getBoundingClientRect().width, center:document.getElementById('center').getBoundingClientRect().width,
      tbar:document.getElementById('tbar').scrollWidth - document.getElementById('tbar').clientWidth, short:getComputedStyle(document.querySelector('#tbar .pipe .ps .sh')).display})`);
    return { ok: s.sw <= s.cw && s.left === 'none' && s.info >= 300 && s.center >= 400 && s.tbar <= 1 && s.short !== 'none',
      detail: `scrollWidth ${s.sw} / ${s.cw} · 트리 ${s.left} · 보기 ${Math.round(s.center)} · 정보 ${Math.round(s.info)} · 진행 띠 짧은 이름` };
  });
  await step('u10b 960 px — 모델 · 단면', 'u10b_960_section', async () => {
    await select('model', 'sec');
    const s = await ev(`({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth})`);
    return { ok: s.sw <= s.cw, detail: `scrollWidth ${s.sw} / ${s.cw}` };
  });
  W = 1920; H = 1080;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // ── U2 — 보기 ─────────────────────────────────────────────────────────
  section('7c. U2 보기 — 단면 · 좌굴 · 부재 · 판정비 띠 · 접합 도면 · 표 서랍(그림의 수 = 엔진)');
  const hostMsg = async cmd => (await api('GET', `/api/wv/${encodeURIComponent(designerId)}/last?command=${cmd}`)).json?.data?.[cmd]?.message?.data;
  const dsmFam = async () => ev(`${S}.state.dsm && ${S}.state.dsm.family`);
  await step('u10c 하중 해석이 아직 없을 때 — 하중 · 접합 보기는 그리지 않고 밝힌다(K4: analyze_loads 는 화면에 오지 않는다)', 'u10c_no_loads', async () => {
    await select('result', 'load');
    const g = await ev(`({t:document.getElementById('center').innerText, dg:document.querySelectorAll('#center g.dg').length, loads:!!${S}.state.loads})`);
    await select('result', 'conn');
    const c = await ev(`document.getElementById('center').innerText`);
    return { ok: !g.loads && g.dg === 0 && /하중 해석 결과 없음/.test(g.t) && /analyze_loads/.test(g.t) && /접합부 검토 결과 없음/.test(c),
      detail: `「${short(g.t.replace(/\s+/g, ' '), 80)}」 · 「${short(c.replace(/\s+/g, ' '), 40)}」` };
  });
  // 01 단면 — 치수선 · 주축 · 전단 중심 · 응력 · 맞춤
  await step('u11 단면 보기(템플릿 01) — 치수 H · B · D · t · r · 주축 θp · 도심 · 전단 중심 = 엔진, 응력 띠 = 절점 응력, 확대 · 맞춤', 'u11_section', async () => {
    await select('model', 'sec');
    const ctx = { ...(await mcpNow()), params: params2 };
    const g = await ev(`(()=>{const q=s=>document.querySelector(s); const L=[...document.querySelectorAll('#center .lead')].map(e=>({k:e.dataset.k,a:e.dataset.a.split(',').map(Number),b:e.dataset.b.split(',').map(Number)}));
      return {L, th:+q('#center .paxes')?.dataset.theta, sc:q('#center .sc')?[+q('#center .sc').dataset.x,+q('#center .sc').dataset.z]:null, cg:q('#center .cg')?[+q('#center .cg').dataset.x,+q('#center .cg').dataset.z]:null};})()`);
    const t = ctx.elems[0][3] * US_TO_SI.length;
    const zs = ctx.nodes.map(n => n[2] * US_TO_SI.length), xs = ctx.nodes.map(n => n[1] * US_TO_SI.length);
    const H = g.L.find(l => l.k === 'H'), B = g.L.find(l => l.k === 'B');
    // 치수선의 길이 = 템플릿 치수(바깥-바깥, 둥근 모서리 r 4) — 그림의 자리 규칙이 맞으면 같아야 한다
    const okH = H && relClose(Math.abs(H.a[1] - H.b[1]), params2.H, 1e-6) && relClose(Math.abs(H.a[1] - H.b[1]), Math.max(...zs) - Math.min(...zs) + t, 1e-9);
    const okB = B && relClose(Math.abs(B.a[0] - B.b[0]), params2.B, 1e-6);
    const keys = g.L.map(l => l.k).sort().join(',');
    // D = 윗 플랜지 바깥면부터 윗 립 끝 절점까지(템플릿의 D 는 바깥-바깥이라 이 길이와 같다)
    const Dl = g.L.find(l => l.k === 'D'), Dlen = Dl ? Math.abs(Dl.a[1] - Dl.b[1]) : NaN;
    const okD = relClose(Dlen, params2.D, 1e-6);
    const okAx = relClose(g.th, ctx.propsSI.thetap) && g.sc && relClose(g.sc[0], ctx.cutwpSI.Xs) && relClose(g.sc[1], ctx.cutwpSI.Zs) && g.cg && relClose(g.cg[0], ctx.propsSI.xcg) && relClose(g.cg[1], ctx.propsSI.zcg);
    await ev(`document.querySelector('#center [data-opt="stress"]').click()`);
    await sleep(250);
    const st = await ev(`[...document.querySelectorAll('#center polygon.st')].map(p=>({e:+p.dataset.e,si:+p.dataset.si,sj:+p.dataset.sj}))`);
    const byId = new Map(ctx.nodes.map(n => [n[0], n[7] * US_TO_SI.stress]));
    const okSt = st.length === ctx.elems.length && st.every(p => { const e = ctx.elems.find(x => x[0] === p.e); return e && relClose(p.si, byId.get(e[1])) && relClose(p.sj, byId.get(e[2])); });
    const r = compareNumbers(await numbers('#center'), ctx);
    await ev(`document.querySelector('#center [data-opt="stress"]').click()`);
    await sleep(200);
    // 확대(휠) → viewBox 바뀜 → 「전체 맞춤」 → 처음
    const z = await ev(`(async()=>{const svg=document.querySelector('#center .dv[data-zoom="section"] svg'); const b0=svg.getAttribute('viewBox'); const r=svg.getBoundingClientRect();
      svg.dispatchEvent(new WheelEvent('wheel',{deltaY:-300,clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,cancelable:true})); await new Promise(x=>setTimeout(x,50));
      const b1=svg.getAttribute('viewBox'); document.querySelector('#center [data-fit="section"]').click(); await new Promise(x=>setTimeout(x,50)); return {b0,b1,b2:document.querySelector('#center .dv[data-zoom="section"] svg').getAttribute('viewBox')};})()`);
    return { ok: okH && okB && okD && keys === 'B,D,H,r,t' && okAx && okSt && r.bad.length === 0 && z.b1 !== z.b0 && z.b2 === z.b0,
      detail: `치수 ${keys} · H ${H ? Math.abs(H.a[1] - H.b[1]).toFixed(3) : '-'} = ${params2.H} ${okH} · B ${B ? Math.abs(B.a[0] - B.b[0]).toFixed(3) : '-'} = ${params2.B} ${okB} · D 윗 립 ${Dlen.toFixed(3)} = ${params2.D} ${okD} · θp ${g.th} = props ${ctx.propsSI.thetap} · 전단 중심 · 도심 ${okAx} · 응력 띠 ${st.length}/${ctx.elems.length} ${okSt}`
        + ` · 수 ${r.compared}개 = MCP${r.bad.length ? ` · ${r.bad.slice(0, 3).join(' / ')}` : ''} · 확대 ${z.b0} → ${z.b1} → 맞춤 ${z.b2 === z.b0}` };
  });
  // 02 좌굴 — 둥근 모서리(분류 없음)
  const lcB = await mcp.tool('set_load_case', { load_case: 'bending_xx_pos', fy: 295, units: 'SI' });
  const runB = await mcp.tool('run_analysis');
  check('AI: set_load_case(정휨) → run_analysis(둥근 모서리 r 4)', lcB.success && runB.success, short(runB.error ?? runB.classification_status?.code));
  await step('u12 좌굴(템플릿 02) — 곡선 점 = get_buckling_curve, 극소 = get_dsm_values, 모드 형상 = 호스트의 모드 벡터, 분류 없음(둥근 모서리)', 'u12_buckling', async () => {
    await settle(`s.stages.fsm.state==='ok' && s.analysis && s.dsm && s.dsm.family==='Mxx'`, '해석 결과');
    await select('result', 'fsm');
    const curve = (await mcp.tool('get_buckling_curve')).curve;
    const dsmSI = await mcp.tool('get_dsm_values', { load_type: 'Mxx', units: 'SI' });
    const ac = await hostMsg('analysisComplete');
    const g = await ev(`(()=>{const pts=[...document.querySelectorAll('#center circle.cp')].map(c=>[+c.dataset.i,+c.dataset.len,+c.dataset.lf]);
      const mn=[...document.querySelectorAll('#center g.mn')].map(m=>({k:m.dataset.k,L:+m.dataset.len,lf:+m.dataset.lf}));
      const dv=document.querySelector('#center .dv[data-draw="mode"]'); const md=[...document.querySelectorAll('#center circle.md')].map(c=>[+c.dataset.n,+c.dataset.u,+c.dataset.w]);
      return {pts, mn, hm:document.querySelectorAll('#center polyline.hm').length, len:+dv.dataset.len, mode:+dv.dataset.mode, md, cls:document.querySelector('#center g.cls')?.dataset.state,
        clsHud:document.querySelector('#center [data-cls]')?.textContent, info:document.getElementById('info').innerText};})()`);
    const okPts = g.pts.length === curve.length && g.pts.every(([i, L, lf]) => relClose(L, curve[i][0] * US_TO_SI.length) && relClose(lf, curve[i][1]));
    const M = dsmSI.Mxx;
    const mnOk = (k, L, lf) => { const m = g.mn.find(x => x.k === k); return m && relClose(m.L, L) && relClose(m.lf, lf); };
    const okMn = mnOk('local', M.Lcrl, M.LF_local) && mnOk('dist', M.Lcrd, M.LF_dist) && mnOk('global', M.Lcre, M.LF_global);
    const nn = ac.shapes[g.len][0].length ? ac.shapes[g.len].length / 4 : 0;
    const okMd = g.md.length === nn && g.md.every(([, u, w], k) => relClose(u, ac.shapes[g.len][2 * k][g.mode - 1]) && relClose(w, ac.shapes[g.len][2 * nn + 2 * k][g.mode - 1]));
    const nModes = curve[0].length - 1;
    const r = compareNumbers(await numbers('#review'), { ...(await mcpNow()), params: params2, dsmSI, curve });
    return { ok: okPts && okMn && okMd && g.hm === nModes - 1 && g.cls === 'none' && /분류 없음/.test(g.clsHud ?? '') && /둥근 모서리/.test(g.info) && r.bad.length === 0,
      detail: `${okPts ? '' : `[첫 어긋남 ${JSON.stringify(g.pts.find(([i, L, lf]) => !(relClose(L, curve[i][0] * US_TO_SI.length) && relClose(lf, curve[i][1]))))} vs ${JSON.stringify(curve[g.pts.find(([i, L, lf]) => !(relClose(L, curve[i][0] * US_TO_SI.length) && relClose(lf, curve[i][1])))?.[0]])}] `}${okMn ? '' : `[극소 ${JSON.stringify(g.mn)} vs ${JSON.stringify(M)}] `}곡선 점 ${g.pts.length}/${curve.length} ${okPts} · 고차 모드 ${g.hm} · 극소 국부 · 뒤틀림 · 전체 = get_dsm_values ${okMn} · 모드 형상 길이 #${g.len} 모드 ${g.mode} 절점 ${g.md.length} = 호스트 모드 벡터 ${okMd}`
        + ` · 분류 ${g.cls} 「${short(g.clsHud, 40)}」 · 수 ${r.compared}개 = MCP${r.bad.length ? ` · ${r.bad.slice(0, 3).join(' / ')}` : ''}` };
  });
  await step('u12b 곡선의 반파장을 누르면 모드 형상 · 정보 창이 그 길이로(보기 → 정보 창)', null, async () => {
    const k = 30;
    await ev(`document.querySelector('#center rect[data-pick="len:${k}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    await sleep(300);
    const s = await ev(`({len:+document.querySelector('#center .dv[data-draw="mode"]').dataset.len, sel:+document.querySelector('#center g.sel')?.dataset.i, info:document.getElementById('info').innerText})`);
    const curve = (await mcp.tool('get_buckling_curve')).curve;
    const Lmm = curve[k][0] * US_TO_SI.length;
    return { ok: s.len === k && s.sel === k && s.info.includes('고른 반파장'), detail: `모드 형상 #${s.len} · 곡선 표지 #${s.sel} · 정보 창 「고른 반파장」 ${Lmm.toFixed(1)} mm` };
  });
  // 02 — 각진 모서리(분류 있음) + 100 길이 × 10 모드 성능
  const tplS = await mcp.tool('set_section_template', { type: 'lippedc', H: 200, B: 75, D: 20, t: 2.3, units: 'SI' });
  const lcS = await mcp.tool('set_load_case', { load_case: 'bending_xx_pos', fy: 295, units: 'SI' });
  const lenS = await mcp.tool('set_lengths', { min: 10, max: 10000, n: 100, units: 'SI' });
  const runS = await mcp.tool('run_analysis');
  check('AI: 각진 모서리 립 C · 반파장 100 개 · run_analysis', tplS.success && lcS.success && !lenS.error && runS.success, short(lenS.error ?? runS.error ?? `길이 ${runS.lengths_analyzed} · 분류 ${runS.classification_status?.status ?? '—'}`));
  const paramsS = { H: 200, B: 75, D: 20, t: 2.3 };
  await step('u13 분류 띠(cFSM, 엔진이 낼 때) · 100 길이 × 10 모드 다시 그리기 시간', 'u13_buckling_classes', async () => {
    await settle(`s.stages.fsm.state==='ok' && s.analysis && s.analysis.curve.length===${runS.lengths_analyzed ?? 100}`, '100 길이 해석', 120_000);
    const times = [];
    for (let i = 0; i < 5; i++) { times.push(await ev(`(()=>{const t0=performance.now(); ${S}.select('result','fsm'); return performance.now()-t0;})()`)); }
    await sleep(200);
    const ac = await hostMsg('analysisComplete');
    const g = await ev(`({cls:document.querySelector('#center g.cls')?.dataset.state, bands:document.querySelectorAll('#center g.cls rect').length, pts:document.querySelectorAll('#center circle.cp').length, hm:document.querySelectorAll('#center polyline.hm').length, info:[...document.querySelectorAll('#info .clsk span')].map(e=>e.textContent).join(' ')})`);
    const classes = ac.classifications;
    const r = compareNumbers(await numbers('#review'), { ...(await mcpNow()), params: paramsS, classes });
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    return { ok: g.cls === 'bands' && g.bands > 0 && g.pts === (runS.lengths_analyzed ?? 100) && g.hm >= 9 && /G [\d.]+%/.test(g.info) && r.bad.length === 0 && mean < 500,
      detail: `분류 ${g.cls} · 정보 창 「${g.info}」 · 띠 조각 ${g.bands} · 곡선 점 ${g.pts} · 고차 모드 ${g.hm} · 다시 그리기 평균 ${mean.toFixed(0)} ms(최대 ${Math.max(...times).toFixed(0)}) · 수 ${r.compared}개 = 엔진(분류 % 포함)${r.bad.length ? ` · ${r.bad.slice(0, 3).join(' / ')}` : ''}` };
  });
  // 03 · 04 — 퍼린(3 연속, 랩, 양압 — NG 구간이 생긴다)
  const purlinArgs = { member_app: 'roof-purlin', span_type: 'cont-3', span_ft: 6, laps: { left_ft: 0.6, right_ft: 0.6 }, loads: { D: 0.44, Lr: 1.17, W: -2.9 },
    design_method: 'LRFD', spacing_ft: 1.2, Fy: 295, Fu: 400, deck: { type: 'through-fastened' }, units: 'SI' };
  const pur = await mcp.tool('design_purlin', purlinArgs);
  const failing = (pur.regions ?? []).findIndex(x => x.result?.pass === false);
  check('AI: design_purlin(SI · 3 연속 · 랩 · 양압) — 엔진: 구간마다 판정, NG 구간 있음', !pur.error && (pur.regions ?? []).length > 5 && failing >= 0,
    short(pur.error ?? `구간 ${pur.regions.length} · NG ${pur.regions.filter(x => x.result?.pass === false).length} · 판정 없음 ${pur.regions.filter(x => x.result?.pass == null).length}`));
  await step('u14 하중 해석(템플릿 03) — M · V · 처짐 점 · 지점 반력 · 이름 붙은 위치 = 엔진(design_purlin 의 load_analysis, SI)', 'u14_loads', async () => {
    await settle(`s.loads && s.regions.length===${pur.regions.length}`, '퍼린 결과');
    await select('result', 'load');
    const la = pur.load_analysis;
    const g = await ev(`(()=>{const d=k=>{const e=document.querySelector('#center g.dg[data-k="'+k+'"]'); return e?{xs:e.dataset.xs.split(',').map(Number), ys:e.dataset.ys.split(',').map(Number)}:null;};
      return {M:d('M'), V:d('V'), D:d('D'), rx:[...document.querySelectorAll('#center g.rx')].map(e=>[+e.dataset.i,+e.dataset.r]), loc:[...document.querySelectorAll('#center g.loc')].map(e=>[+e.dataset.i,+e.dataset.x,+e.dataset.m])};})()`);
    const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => relClose(v, b[i]));
    const okM = g.M && same(g.M.xs, la.governing.x_diagram) && same(g.M.ys, la.governing.M_diagram);
    const okV = g.V && same(g.V.ys, la.governing.V_diagram);
    const okD = g.D && same(g.D.ys, la.deflection.D_diagram);
    const okR = g.rx.length === la.governing.R_envelope_max.length && g.rx.every(([i, r]) => relClose(r, la.governing.R_envelope_max[i]));
    const okL = g.loc.length > 0 && g.loc.every(([i, x, m]) => relClose(x, la.governing.locations[i].x_ft) && relClose(m, la.governing.locations[i].Mu));
    const ext = [Math.max(...la.governing.M_diagram), Math.min(...la.governing.M_diagram)];
    const r = compareNumbers(await numbers('#review'), { ...(await mcpNow()), params: paramsS, loadsSI: la, purlinSI: pur });
    return { ok: okM && okV && okD && okR && okL && r.bad.length === 0,
      detail: `M ${g.M?.ys.length}점 ${okM} (극값 ${ext.map(v => v.toFixed(3)).join(' / ')} 이 그 점에 있다) · V ${okV} · 처짐 ${okD} · 반력 ${g.rx.length} ${okR} · 위치 ${g.loc.length} ${okL} · 수 ${r.compared}개 = MCP${r.bad.length ? ` · ${r.bad.slice(0, 3).join(' / ')}` : ''}` };
  });
  await step('u15 부재 검토 + 판정비 띠(템플릿 04) — 구간 판정비 = 엔진, NG 구간, 띠를 누르면 그 검토로(보기 → 트리 · 정보 창), 트리 → 보기 강조', 'u15_checks_band', async () => {
    const run = `purlin:${failing}`;
    await select('result', `${run}#ls0`);
    const bd = await ev(`[...document.querySelectorAll('#center rect.bd')].map(e=>({run:e.dataset.run,r:e.dataset.r===''?null:+e.dataset.r,pass:e.dataset.pass,fill:e.getAttribute('fill')}))`);
    const okBd = bd.length === pur.regions.length && bd.every((b, i) => b.run === `purlin:${i}` && (pur.regions[i].result?.utilization == null ? b.r === null : relClose(b.r, pur.regions[i].result.utilization))
      && b.pass === (pur.regions[i].result?.pass === true ? 'ok' : pur.regions[i].result?.pass === false ? 'ng' : 'un'));
    const ngFill = bd.filter(b => b.pass === 'ng').every(b => b.fill === 'var(--r6)');
    const sel1 = await ev(`(()=>{const r=document.querySelector('#center rect.selr'); return r?[+r.dataset.a,+r.dataset.b]:null;})()`);
    const okSel = sel1 && relClose(sel1[0], pur.regions[failing].start_ft) && relClose(sel1[1], pur.regions[failing].end_ft);
    // 띠의 다른 구간을 누른다 → 트리 · 정보 창 · 강조가 그 구간으로
    const other = pur.regions.findIndex((x, i) => i !== failing && x.result?.pass === true);
    await ev(`document.querySelector('#center rect.bd[data-run="purlin:${other}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    await sleep(350);
    const after = await ev(`({tree:document.querySelector('#tree .row.on')?.dataset.k, info:document.querySelector('#info .ttl')?.textContent, selr:(()=>{const r=document.querySelector('#center rect.selr'); return r?[+r.dataset.a,+r.dataset.b]:null;})()})`);
    const okClick = (after.tree ?? '').startsWith(`purlin:${other}#`) && after.selr && relClose(after.selr[0], pur.regions[other].start_ft);
    await select('result', `${run}#ls0`);
    const r = compareNumbers(await numbers('#review'), { ...(await mcpNow()), params: paramsS, loadsSI: pur.load_analysis, purlinSI: pur });
    return { ok: okBd && ngFill && okSel && okClick && r.bad.length === 0,
      detail: `띠 ${bd.length} 구간 = 엔진 ${okBd} · NG ${bd.filter(b => b.pass === 'ng').length} 개 빨강 ${ngFill} · 고른 구간 강조 ${okSel} · 띠 누름 → 트리 ${after.tree} · 정보 「${short(after.info, 40)}」 ${okClick}`
        + ` · 판정 없음 구간 ${bd.filter(b => b.pass === 'un').length}(엔진이 이 입력에서 내지 않음 — 빗금은 u20 에서) · 수 ${r.compared}개${r.bad.length ? ` · ${r.bad.slice(0, 3).join(' / ')}` : ''}` };
  });
  await step('u15b 표 서랍 — 도표 점 표를 M 으로 정렬 · 복사(TSV)', null, async () => {
    await select('result', 'load');
    // 서랍은 템플릿처럼 03 만 펼쳐져 있다 — 접혀 있으면 펼친다
    const wasClosed = await ev(`(()=>{const d=document.querySelector('#center .drawer.closed [data-drawer="toggle"]'); if(d){d.click(); return true;} return false;})()`);
    await sleep(150);
    await ev(`document.querySelector('#center [data-dtab="stations"]').click()`);
    await sleep(150);
    await ev(`document.querySelector('#center .drawer th[data-sort="2"]').click()`);
    await sleep(150);
    const vals = await ev(`[...document.querySelectorAll('#center .drawer tbody tr')].map(r=>+r.children[2].querySelector('[data-v]').dataset.v)`);
    const sortedOk = vals.length === pur.load_analysis.governing.M_diagram.length && vals.every((v, i) => i === 0 || v >= vals[i - 1]);
    await ev(`document.querySelector('#center [data-copy]').click()`);
    await sleep(200);
    const tsv = await ev('window.__uiLastCopy || ""');
    if (wasClosed) { await ev(`document.querySelector('#center [data-drawer="toggle"]').click()`); }  // 다시 접는다(뒤의 그림은 기본 모습)
    await ev(`document.querySelector('#center [data-dtab="locations"]')?.click()`);
    await sleep(150);
    const lines = tsv.split('\n');
    return { ok: sortedOk && lines.length === vals.length + 1 && /^#\tx m\tM kN·m/.test(lines[0]), detail: `${vals.length} 줄 오름차순 ${sortedOk} · 복사 ${lines.length} 줄 「${short(lines[0], 40)}」` };
  });
  // 06 접합 — 랩
  const lapArgs = { d: 200, t: 2.3, Fy: 295, Fu: 400, lap_left_in: 600, lap_right_in: 600, Mu_support: 12, Vu_support: 11, fastener_type: 'bolt', fastener_dia: 12,
    n_rows: 2, end_distance: 36, design_method: 'LRFD', Se: 49000, Mnd: 9, Vn: 45, units: 'SI' };
  const lap = await mcp.tool('design_lap_connection', lapArgs);
  check('AI: design_lap_connection(SI)', !lap.error && typeof lap.n_total === 'number', short(lap.error ?? `n ${lap.n_total} · ${lap.n_rows}열 × ${lap.n_per_row} · DCR ${lap.utilization}`));
  await step('u16 접합 도면(템플릿 06) — 랩 길이 · d · 패스너 수 · 자리 = 엔진(배치 규칙은 웹뷰와 같다), 「자체 가정」, Cut A-A 「개략」', 'u16_connection', async () => {
    await settle(`!!s.lap`, '랩 결과');
    await select('result', 'conn:lap');
    const g = await ev(`(()=>{const l=document.querySelector('#center g.lap'); return {l:l?[+l.dataset.l,+l.dataset.r,+l.dataset.d,+l.dataset.n]:null, fs:[...document.querySelectorAll('#center circle.fs')].map(c=>[+c.dataset.x,+c.dataset.row]),
      txt:document.getElementById('center').innerText + document.querySelector('#center svg').textContent, info:document.getElementById('info').innerText};})()`);
    const exp = [];
    const nLeft = Math.ceil(lap.n_per_row / 2), nRight = lap.n_per_row - nLeft;
    for (let i = 0; i < nLeft; i++) { for (let rr = 0; rr < lap.n_rows; rr++) { exp.push([-lap.lap_left_in + lap.edge_distance + i * lap.spacing, rr]); } }
    for (let i = 0; i < nRight; i++) { for (let rr = 0; rr < lap.n_rows; rr++) { exp.push([lap.lap_right_in - lap.edge_distance - i * lap.spacing, rr]); } }
    const okFs = g.fs.length === lap.n_total && g.fs.length === exp.length && g.fs.every(([x, rr], i) => relClose(x, exp[i][0]) && rr === exp[i][1]);
    const okL = g.l && relClose(g.l[0], lap.lap_left_in) && relClose(g.l[1], lap.lap_right_in) && relClose(g.l[2], lap.d);
    const r = compareNumbers(await numbers('#review'), { ...(await mcpNow()), params: paramsS, lapSI: lap, purlinSI: pur, loadsSI: pur.load_analysis });
    return { ok: okFs && okL && /개략/.test(g.txt) && /자체 가정/.test(g.txt) && /자체 가정/.test(g.info) && r.bad.length === 0,
      detail: `패스너 ${g.fs.length}/${lap.n_total} 자리 ${okFs} · 랩 ${g.l?.join(' | ')} ${okL} · 「개략」 · 「자체 가정」 · 수 ${r.compared}개 = MCP${r.bad.length ? ` · ${r.bad.slice(0, 3).join(' / ')}` : ''}` };
  });
  // AI 를 따라간다 — 경계조건을 바꾸면 해석 · 퍼린 · 랩 결과가 지워지고 보기도 낡음, 새 해석이면 곡선이 돌아온다
  const bc = await mcp.tool('set_boundary_condition', { BC: 'C-C' });
  check('AI: set_boundary_condition(C-C)', !bc.error, short(bc.error ?? JSON.stringify(bc).slice(0, 60)));
  await step('u17 AI 가 경계조건을 바꾸면 — 좌굴 · 접합 보기는 낡음, 띠는 사라진다(새로 고침 없이)', 'u17_views_stale', async () => {
    await settle(`s.stages.fsm.state==='stale' && !s.lap && s.regions.length===0`, '무효');
    await select('result', 'fsm');
    const f = await ev(`({t:document.getElementById('center').innerText, pts:document.querySelectorAll('#center circle.cp').length})`);
    await select('result', 'conn');
    const c = await ev(`({t:document.getElementById('center').innerText, fs:document.querySelectorAll('#center circle.fs').length})`);
    await select('result', 'chk');
    const b = await ev(`document.querySelectorAll('#center rect.bd').length`);
    return { ok: /낡음/.test(f.t) && f.pts === 0 && /낡음/.test(c.t) && c.fs === 0 && b === 0, detail: `좌굴 「${short(f.t.split('\n')[0], 30)}」 점 ${f.pts} · 접합 패스너 ${c.fs} · 띠 ${b}` };
  });
  // 하중 해석을 AI 가 analyze_loads 로만 돌리면 화면에 오지 않는다 — 보기는 그것을 밝힌다(그리지 않는다)
  const al = await mcp.tool('analyze_loads', { member_app: 'roof-purlin', span_type: 'cont-3', span_ft: 6, loads: { D: 0.44, Lr: 1.17 }, design_method: 'LRFD', spacing_ft: 1.2, units: 'SI' });
  await step('u17c AI 의 analyze_loads — 결과는 화면에 오지 않는다: 하중도는 그 전 design_purlin 의 것 그대로(경계조건은 하중 해석과 무관 — 호스트도 지우지 않는다)', 'u17c_loads_not_on_screen', async () => {
    await sleep(800);
    await select('result', 'load');
    const g = await ev(`(()=>{const e=document.querySelector('#center g.dg[data-k="M"]'); return {ys:e?e.dataset.ys.split(',').map(Number):[], st:${S}.state.stages.load.state};})()`);
    const same = (a, b) => Array.isArray(b) && a.length === b.length && a.every((v, k) => relClose(v, b[k]));
    const isPur = same(g.ys, pur.load_analysis.governing.M_diagram), isAl = same(g.ys, al.governing?.M_diagram);
    return { ok: !al.error && isPur && !isAl, detail: `analyze_loads ${al.error ? `오류 ${short(al.error)}` : `성공(Mmax ${Math.max(...(al.governing?.M_diagram ?? [0])).toFixed(3)} kN·m)`} · 화면 M = design_purlin ${isPur} · = analyze_loads ${isAl} · 단계 ${g.st}` };
  });
  await mcp.tool('set_boundary_condition', { BC: 'S-S' });
  const runC = await mcp.tool('run_analysis');
  await step('u17b 새 해석(S-S 로 되돌려) — 곡선이 새로 고침 없이 돌아온다', null, async () => {
    await settle(`s.stages.fsm.state==='ok' && s.analysis`, '새 해석', 120_000);
    await select('result', 'fsm');
    const pts = await ev(`document.querySelectorAll('#center circle.cp').length`);
    return { ok: runC.success && pts === runC.lengths_analyzed, detail: `곡선 점 ${pts} · BC ${runC.m_all_selection?.BC ?? ''}` };
  });
  // 템플릿마다 그림 — 1920 · 960, 어두운 · 밝은 테마(퍼린 · 랩 결과를 다시 만든다)
  const pur2 = await mcp.tool('design_purlin', purlinArgs);
  const lap2 = await mcp.tool('design_lap_connection', lapArgs);
  check('AI: 다시 해석 · 퍼린 · 랩(그림용)', !pur2.error && !lap2.error);
  await settle(`s.stages.fsm.state==='ok' && s.regions.length>0 && !!s.lap`, '그림용 결과', 120_000);
  const views = [['01', 'model', 'sec'], ['02', 'result', 'fsm'], ['03', 'result', 'load'], ['04', 'result', `purlin:${(pur2.regions ?? []).findIndex(x => x.result?.pass === false)}#ls0`], ['06', 'result', 'conn:lap']];
  for (const [w, h] of [[1920, 1080], [960, 900]]) {
    W = w; H = h;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    for (const th of ['dark', 'light']) {
      await ev(`${S}.setTheme(${JSON.stringify(th)})`);
      for (const [tpl, tab, key] of views) {
        await step(`u18 템플릿 ${tpl} · ${w}px · ${th === 'dark' ? '어두운' : '밝은'}`, `u18_${tpl}_${w}_${th}`, async () => {
          await select(tab, key);
          await sleep(200);
          const s = await ev(`({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth, svgs:document.querySelectorAll('#center svg').length})`);
          return { ok: s.sw <= s.cw && s.svgs >= 1, detail: `scrollWidth ${s.sw}/${s.cw} · 그림 ${s.svgs}` };
        });
      }
    }
  }
  await ev(`${S}.setTheme('dark')`);
  W = 1920; H = 1080;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await step('u20 판정 없음 구간은 빗금 · NG 구간은 빨강 — 엔진이 구간 판정을 null 로 낼 때(시험이 화면 상태의 한 구간을 null 로 바꿔 그린다)', 'u20_band_hatched', async () => {
    const k = (pur2.regions ?? []).findIndex(x => x.result?.pass === true);
    await ev(`(()=>{const r=${S}.state.regions[${k}]; r.us={...r.us, result:{...r.us.result, pass:null, utilization:null}}; r.si={...r.si, result:{...r.si.result, pass:null, utilization:null}}; return 1;})()`);
    await select('result', 'chk');
    const b = await ev(`[...document.querySelectorAll('#center rect.bd')].map(e=>({run:e.dataset.run, pass:e.dataset.pass, fill:e.getAttribute('fill')}))`);
    const un = b.find(x => x.run === `purlin:${k}`), ng = b.filter(x => x.pass === 'ng');
    return { ok: un && un.pass === 'un' && /hatch/.test(un.fill ?? '') && ng.length > 0 && ng.every(x => x.fill === 'var(--r6)'), detail: `구간 ${k} → ${un?.pass} ${un?.fill} · NG ${ng.length} 개 ${ng[0]?.fill}` };
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // 지금의 웹뷰와 나란히 — 편집 상태에서 같은 상태의 곡선 · 하중도 · 랩 도면
  await step('u19 지금의 웹뷰(편집 상태)의 곡선 · 하중도 · 랩 도면 — 같은 상태', null, async () => {
    await waitWv(`const h=D.documentElement; return h.getAttribute('data-stcfsd-bridge')==='connected' && D.querySelectorAll('.tab-btn').length>=6;`, 60_000, '끼운 웹뷰 연결');
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    await sleep(400);
    await wv(`D.querySelector('.tab-btn[data-tab="design"]').click(); return 1;`);
    await sleep(600);
    await wv(`const e=D.getElementById('buckling-curve-canvas'); if(e){e.scrollIntoView({block:'start'});} return !!e;`);
    await shot('u19_webview_curve');
    await wv(`D.querySelector('.tab-btn[data-tab="loads"]').click(); return 1;`);
    await sleep(600);
    await wv(`const e=D.getElementById('load-analysis-result'); if(e){e.scrollIntoView({block:'start'});} return !!e;`);
    await shot('u19_webview_loads');
    await wv(`D.querySelector('.tab-btn[data-tab="connection"]').click(); return 1;`);
    await sleep(600);
    await wv(`const e=D.getElementById('connection-result'); if(e){e.scrollIntoView({block:'start'});} return !!e;`);
    await shot('u19_webview_lap');
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    await sleep(300);
    return { ok: true, detail: 'u19_webview_curve · u19_webview_loads · u19_webview_lap' };
  });
  await select('result', 'fsm');

  section('7b. 편집 상태(F2) — 끼운 지금의 화면이 그대로 돈다');
  await step('u07 끼운 웹뷰가 붙어 있다(숨김) · F2 로 보이고 · 그 「해석 실행」 결과를 새 화면이 받는다', 'u07_edit', async () => {
    await waitWv(`const h=D.documentElement; return h.getAttribute('data-stcfsd-bridge')==='connected' && h.hasAttribute('data-stcfsd-replayed') && D.querySelectorAll('.tab-btn').length>=6;`, 60_000, '끼운 웹뷰 연결');
    const hiddenBefore = await ev(`getComputedStyle(document.getElementById('edit')).visibility`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    await sleep(300);
    const shown = await ev(`({vis:getComputedStyle(document.getElementById('edit')).visibility, editing:${S}.ui.editing, btn:document.querySelector('#tbar [data-act="edit"]').textContent,
      badge:!document.querySelector('#tbar .ebadge').hidden, w:document.getElementById('designer').getBoundingClientRect().width})`);
    const before = await seq();
    await wv(`D.querySelector('.tab-btn[data-tab="design"]').click(); return 1;`);
    await sleep(300);
    await wv(`D.getElementById('btn-run-analysis').click(); return 1;`);
    await settle(`s.msgSeq>${before} && s.stages.fsm.state==='ok' && s.dsm`, '웹뷰의 해석 결과', 300_000);
    const fam = await ev(`${S}.state.dsm.family`);
    const chk = await ev(`${S}.state.stages.chk`);
    return { ok: chk.state === 'stale' && hiddenBefore === 'hidden' && shown.vis === 'visible' && shown.editing && shown.badge && /편집 마치기/.test(shown.btn) && shown.w > 800,
      detail: `숨김 ${hiddenBefore} → F2 ${shown.vis} · 「${shown.btn}」 · 웹뷰 너비 ${Math.round(shown.w)} px · 웹뷰의 해석 → 진행 띠 좌굴 ● (${fam}) · 부재 검토는 낡음(${chk.note})` };
  });
  await step('u07b F2 다시 → 숨김, 새 화면의 좌굴 해석 = MCP', null, async () => {
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    await sleep(300);
    const vis = await ev(`getComputedStyle(document.getElementById('edit')).visibility`);
    const fam = await ev(`${S}.state.dsm.family`);
    await select('result', 'fsm');
    const dsmSI = await mcp.tool('get_dsm_values', { load_type: fam, units: 'SI' });
    const r = compareNumbers(await numbers(), { ...(await mcpNow()), params: params2, dsmSI });
    return { ok: vis === 'hidden' && r.bad.length === 0 && (r.bySrc.dsm ?? 0) >= 12, detail: `${vis} · dsm ${r.bySrc.dsm} 개 = MCP${r.bad.length ? ` · ${r.bad.slice(0, 3).join(' / ')}` : ''}` };
  });

  const inDom = await ev(`document.documentElement.outerHTML.includes(${JSON.stringify(mcpToken)})`)
    || await wv(`return D.documentElement.outerHTML.includes(${JSON.stringify(mcpToken)});`);
  check('MCP 토큰이 화면 DOM(새 화면 · 끼운 웹뷰)에 없다', inDom === false);
  const allErr = log.console.filter(c => c.type === 'error' || c.type === 'log-error' || c.type === 'assert');
  check('시험 내내 페이지 예외 · 콘솔 오류(CSP 위반 포함) 0', log.exceptions.length === 0 && allErr.length === 0,
    [...log.exceptions.map(e => short(e.text, 120)), ...allErr.map(c => short(c.text, 120))].slice(0, 4).join(' / ') || `콘솔 ${log.console.length}줄 중 오류 0`);
  void serve; void api; void token; void tmp; void designerId;
}

main().catch(err => {
  process.stdout.write(`시험 예외: ${err?.stack ?? err}\n`);
  process.exitCode = 1;
});
