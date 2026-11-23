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
/**
 * K4b: 엔진의 글은 제품의 하나뿐인 그리기(webview/js/notices.js)로 — 시험도 같은 파일을 따로 불러 화면이 보일 글을 낸다(한국어 · SI).
 * 알림이 붙은 묶음은 lines, 붙지 않은 묶음의 옛 글은 같은 결과 나무 안의 알림(textMap) — 화면과 같은 규칙(보기 계약 4d)
 */
const NOTICES = require(path.join(repoRoot, 'webview', 'js', 'notices.js'));
const NO = { units: 'SI', lang: 'ko' };
const isNoticeArr = v => Array.isArray(v) && v.some(n => n && typeof n === 'object' && ('template' in n || 'template_ko' in n || n.kind === 'group' || 'list' in n));
function engList(root, o, list) {
  if (!o || typeof o !== 'object') { return []; }
  if (isNoticeArr(o.notices)) { return NOTICES.lines(o, { ...NO, lists: [list] }).map(l => ({ text: l.subject ? `${l.subject} — ${l.text}` : l.text, code: l.code ?? null })).filter(x => x.text || x.code); }
  const tm = NOTICES.textMap(root, NO);
  return (Array.isArray(o[list]) ? o[list] : []).map(x => (typeof x === 'string' ? { text: tm(x) } : { text: x?.name ? `${x.name} — ${tm(String(x.reason ?? ''))}` : tm(String(x?.reason ?? '')) })).filter(x => x.text);
}
/** 검토 항목의 이유 — 화면이 보일 글(한국어 · SI) */
const engReason = c => NOTICES.reason(c, NO);
/** SI 로 읽는 글에 남은 US 수(엔진 · 호스트의 글) — notices.js 의 단위 글자와 같은 경계 */
const US_NUM = /\d\s?(kip-in|kips|kip|ksi|in\.?)(?![A-Za-z0-9*·^\/])/;
const SERVE = path.join(repoRoot, 'desktop', 'host', 'dist', 'serve.js');
const MCP_SERVER = path.join(repoRoot, 'media', 'mcp-server.js');
const OUT = path.join(here, 'out');
const VERBOSE = process.env.UI_VERBOSE === '1';
const { US_TO_SI, caseValueToSI } = require(path.join(repoRoot, 'out', 'mcp', 'siUnits.js'));
/** 검토 상태(K2)의 칸 표 — 제품의 하나뿐인 표(webview/js/designState.js FIELDS)의 단위 종류 */
const CASE_KIND = new Map(require(path.join(repoRoot, 'webview', 'js', 'designState.js')).FIELDS.map(f => [f[0], f[2]]));
let W = 1920, H = 1080;

const results = [];
const started = Date.now();
/** --only=<단계 id,…>(예: --only=u5f,u33) — 고친 것을 덮는 단계만 돈다(나머지 단계는 건너뛴다 — 그 단계가 앞 단계의 상태에 기대면 그 id 도 준다) */
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7).split(',').map(x => x.trim()).filter(Boolean);
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  process.stdout.write(`${ok ? '  통과' : '  실패'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
  return !!ok;
}
/** 그 단계가 이번 실행에서 도는가(--only 가 없으면 모두) */
const ran = id => !ONLY.length || ONLY.includes(id);
/** 앞 단계에 기대는 단계 밖 검사 — --only 로 그 단계를 거르면 「건너뜀」(통과도 실패도 아니다 — 걸러 낸 실행이 진짜 까닭으로만 붉어지게) */
const skippedChecks = [];
function skipCheck(name, needs) {
  skippedChecks.push({ name, needs });
  process.stdout.write(`  건너뜀  ${name} — 앞 단계 ${needs.join(', ')} 를 이번 실행에서 거름(--only)\n`);
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
    // U4 — 검토 상태(호스트의 get_case_inputs, US) → 제품의 caseValueToSI(표의 단위 종류) · 경간 표는 ft → m
    case 'case': {
      const parts = p.split('.');
      if (parts[0] === 'inputs') {
        let v = ctx.caseUS?.inputs?.[parts[1]];
        if (parts.length > 2) { v = Array.isArray(v) ? v[Number(parts[2])] : undefined; }
        return typeof v === 'number' ? caseValueToSI(v, CASE_KIND.get(parts[1]) ?? null) : undefined;
      }
      if (parts[0] === 'spans') { const v = at(ctx.caseUS?.spans, parts.slice(1).join('.')); return typeof v === 'number' ? v * US_TO_SI.length_ft : undefined; }
      return undefined;
    }
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

  {
    // 부재 보기의 분포 하중 화살표는 경간마다 엔진이 준 지배 하중의 부호를 따른다 — 양압(음, 예: 6: 0.9D+1.0W)이면 위로
    const esbuild = require('esbuild');
    const out = esbuild.buildSync({ entryPoints: [path.join(here, '..', 'src', 'member.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
    const la = w => ({ spans_ft: [6, 6], supports: ['P', 'P', 'P'], auto_params: { unbraced: { supports_ft: [0, 6, 12], lap_ends_ft: [], inflection_points_ft: [] } },
      governing: { combo: '6: 0.9D+1.0W', governing_span_loads_plf: w, x_diagram: [0, 6, 12], M_diagram: [0, 1, 0], V_diagram: [1, 0, -1], R_envelope_max: [1, 2, 1], locations: [] } });
    const dirs = w => {
      const svg = mod.exports.memberSvg({ w: 900, la: la(w), rows: ['beam'], regions: [] }).svg;
      return [...svg.matchAll(/<path data-dir="(up|down)" d="M([\d.]+) /g)].map(m => ({ dir: m[1], x: Number(m[2]) }));
    };
    const allUp = dirs([-1.2, -1.2]), allDown = dirs([0.8, 0.8]), mixed = dirs([-1.2, 0.8]);
    const mid = (mixed[0].x + mixed[mixed.length - 1].x) / 2;
    check('부재 보기 — 양압 조합(wu 음)의 분포 하중 화살표는 위로, 중력(양)은 아래로, 경간마다 그 경간의 부호',
      allUp.length > 5 && allUp.every(a => a.dir === 'up') && allDown.every(a => a.dir === 'down')
      && mixed.filter(a => a.x < mid - 1).every(a => a.dir === 'up') && mixed.filter(a => a.x > mid + 1).every(a => a.dir === 'down'),
      `모두 음 → 위 ${allUp.filter(a => a.dir === 'up').length}/${allUp.length} · 모두 양 → 아래 ${allDown.filter(a => a.dir === 'down').length}/${allDown.length} · 첫 경간 음 · 둘째 양 → ${mixed.map(a => a.dir[0]).join('')}`);
  }

  section('1. serve 시작 — 스위치 없이(U4: 기본 화면이 새 검토 화면)');
  let t = Date.now();
  const serve = startServe(['--repo', repoRoot, '--user-data', path.join(tmp, 'userData'), '--port-file', portFile,
    '--documents', path.join(tmp, 'Documents'), '--claude-config', claudeConfig]);
  let ready;
  try { ready = JSON.parse((await serve.waitLine(/^STCFSD_BRIDGE_READY /, 150_000)).slice('STCFSD_BRIDGE_READY '.length)); }
  catch (err) { check('serve 가 준비 줄을 낸다', false, String(err.message)); serve.child.kill(); return finish(); }
  const screenLine = serve.lines.find(l => l.startsWith('화면: ')) ?? '';
  check('스위치 없는 serve 가 준비 줄을 내고 「화면:」 은 /ui/ 주소다(기본 화면 = 새 검토 화면)', ready.screen === 'ui' && /\/ui\/\?t=/.test(screenLine) && /\/\?t=/.test(ready.url) && !/\/ui\//.test(ready.url),
    `${Date.now() - t} ms · screen=${ready.screen}`);
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
  const rootRes = await fetch(`${origin}/?theme=light`, { headers: { Authorization: `Bearer ${token}`, Connection: 'close' }, redirect: 'manual' });
  await rootRes.text();
  check('기본 화면(/)은 새 검토 화면이다(U4) — / 는 /ui/ 로 보낸다(303, 질의 그대로)', rootRes.status === 303 && rootRes.headers.get('location') === '/ui/?theme=light',
    `${rootRes.status} → ${rootRes.headers.get('location')}`);

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

  section('9. --ui classic 으로 띄우면 예전의 틀(한 판 동안 남긴다)');
  const plainPortFile = path.join(tmp, 'mcp2', 'port');
  const plain = startServe(['--repo', repoRoot, '--user-data', path.join(tmp, 'userData2'), '--port-file', plainPortFile, '--documents', path.join(tmp, 'Documents'),
    '--claude-config', claudeConfig, '--ui', 'classic']);
  try {
    const r2 = JSON.parse((await plain.waitLine(/^STCFSD_BRIDGE_READY /, 150_000)).slice('STCFSD_BRIDGE_READY '.length));
    const line2 = plain.lines.find(l => l.startsWith('화면: ')) ?? '';
    const tok2 = new URL(r2.url).searchParams.get('t');
    const root2 = await fetch(`${r2.origin}/`, { headers: { Authorization: `Bearer ${tok2}`, Connection: 'close' } });
    const html2 = await root2.text();
    check('--ui classic: 「화면:」 은 틀(/) 주소 · / 는 틀 HTML', r2.screen === 'frame' && line2 === `화면: ${r2.url}` && /\/\?t=/.test(line2) && html2.includes('/frame/frame.js'),
      `screen=${r2.screen} · ${line2.replace(/t=.*/, 't=…')}`);
    const kids2 = descendants(plain.child.pid);
    await plain.ipc('shutdown', {}, 10_000).catch(() => undefined);
    const e2 = await Promise.race([plain.exited, sleep(30_000).then(() => undefined)]);
    if (!e2) { plain.child.kill(); }
    for (let i = 0; i < 100 && kids2.some(k => alive(k.pid)); i++) { await sleep(50); }
    check('그 serve 도 남기는 것 없이 끝난다', e2?.code === 0 && kids2.every(k => !alive(k.pid)) && await portIsFree(r2.port) && await portIsFree(r2.mcpPort) && !fs.existsSync(plainPortFile),
      `코드 ${e2?.code}`);
  } catch (err) { check('--ui classic serve', false, String(err.message)); plain.child.kill(); }

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
  process.stdout.write(`\n결과: ${results.length - failed.length}/${results.length} 통과${skippedChecks.length ? ` · 건너뜀 ${skippedChecks.length}(앞 단계를 거름)` : ''} · ${((Date.now() - started) / 1000).toFixed(1)} s · 그림 ${OUT}\n`);
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
    if (ONLY.length && !ONLY.includes(String(name).split(' ')[0])) { return; }
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
  /** 그 실행의 첫 NG(없으면 첫) 검토 항목의 키 — 검토 항목 계약의 고정 id 로 만든 키(design#<id> · purlin:<i>#<p>:<id>) */
  const firstKey = run => ev(`(()=>{const r=${S}.state.runs.find(x=>x.key===${JSON.stringify(run)}); const w=r&&(r.rows.find(x=>x.pass===false)||r.rows[0]); return w?w.key:null;})()`);
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
      detail: `물음 「${title}」 · 제목 표시줄 ${s.fname} · 창 제목 「${s.docTitle}」 · 시작 화면 숨김 ${s.startHidden} · 템플릿 기록이 없는 단면은 「템플릿 치수 없음」 ${/템플릿 치수 없음/.test(s.info)}` };
  });

  section('4. 템플릿 01 — AI 가 단면을 정한다 · 화면의 수 = MCP');
  const params1 = { H: 150, B: 65, D: 20, t: 2, r: 3 };
  const tpl1 = await mcp.tool('set_section_template', { type: 'lippedc', ...params1, units: 'SI' });
  check('AI: set_section_template(립 C 150×65×20×2.0 r3, SI)', tpl1.success === true, short(tpl1.error ?? `절점 ${tpl1.nnodes} · 요소 ${tpl1.nelems}`));
  await step('u03 모델 · 단면 — 트리 · 정보 창 · 단면 그림이 새 단면을 따라온다(새로 고침 없이)', 'u03_section', async () => {
    await settle(`s.model && s.model.sectionTemplate==='lippedc' && s.nodes.length===${tpl1.nnodes} && s.propsSI`, '새 단면');
    await select('model', 'sec');
    // 칩은 호스트가 받아 적은 보고(get_view 가 돌려줄 것)라 보고(0.4 초 모음)가 돌아온 뒤에 바뀐다
    await waitFor(`/단면 「립 C 150×65×20×2/.test(document.querySelector('#share b').textContent)`, 10_000, '보기 보고');
    const s = await ev(`({tree:document.getElementById('tree').innerText, info:document.getElementById('info').innerText, share:document.querySelector('#share b').textContent})`);
    const ok = (await marker()) === 1 && /립 C 150×65×20×2/.test(s.tree) && /종류 · 치수/.test(s.info) && /단면 성질/.test(s.info) && /요소 분할/.test(s.info) && /재료/.test(s.tree)
      && /해석 조건/.test(s.tree) && /단면 「립 C 150×65×20×2」/.test(s.share);
    return { ok, detail: `트리 · 정보 · 「Claude 가 보는 선택」 = ${s.share} · 새로 고침 없음 ${(await marker()) === 1}` };
  });
  if (!ran('u03')) {
    skipCheck('화면의 수(트리 · 정보 창 · 절점/요소 표 · 그림 치수) = MCP 도구의 값(SI 변환 뒤)', ['u03']);
    skipCheck('단면 그림 = 절점 · 요소(MCP get_nodes · get_elements): 수 · 경계 상자 · 축척(같은 비율, 위가 +z)', ['u03']);
  } else {
    // u03 이 새 단면을 기다리고 단면 보기를 고른 뒤의 화면을 잰다
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
    return { ok: /탄성 상수/.test(mat) && /재료/.test(mat) && /설계 Fy/.test(mat) && /해석 기준 응력/.test(mat) && !/편집 상태의 입력 칸에만/.test(mat) && /경계조건/.test(cond) && /반파장 범위/.test(cond) && sel === 'snode',
      detail: `재료: E · ν · G + 설계 Fy · Fu(검토 상태 — K2) + 해석 기준 응력 · 해석 조건: 경계조건 · 반파장 · 응력 · 고른 줄 ${sel}` };
  });

  section('5. AI 를 따라간다 — 해석 · 검토 뒤 단면을 바꾸면 결과는 낡음');
  const lc = await mcp.tool('set_load_case', { load_case: 'bending_xx_pos', fy: 295, units: 'SI' });
  const run1 = await mcp.tool('run_analysis');
  const flex = await mcp.tool('aisi_design_flexure', { detail: 'full', Fy: 295, Lb: 1500, Mu: 2, units: 'SI' });
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
  const compNg = await mcp.tool('aisi_design_compression', { detail: 'full', Fy: 295, KxLx: 3000, KyLy: 3000, Pu: 400, units: 'SI' });
  check('AI: aisi_design_compression(KtLt 없음 · Pu 400 kN) — 엔진: NG 와 미검토가 함께', compNg.pass === false && (compNg.not_evaluated ?? []).length > 0
    && (compNg.limit_state_checks ?? []).some(x => x.pass === false), short(compNg.error ?? `pass=${compNg.pass} · ${JSON.stringify(compNg.limit_state_checks)} · 미검토 ${JSON.stringify(compNg.not_evaluated)}`, 260));
  const verify04 = async (res, label) => {
    // 줄 = 엔진의 design_checks(검토 항목 계약) — 고정 id 로
    const dcs = res.design_checks ?? [];
    await settle(`s.runs.length>0 && s.runs[0].us && s.runs[0].us.pass===${JSON.stringify(res.pass)} && s.runs[0].rows.length===${dcs.length}`, `${label} 결과`);
    const first = dcs.find(x => x.verdict === 'fail') ?? dcs.find(x => x.verdict === 'not_evaluated') ?? dcs[0];
    await select('result', `design#${first.id}`);
    const s = await ev(`(()=>{const rows=[...document.querySelectorAll('#center table.vt tr.ck')].map(r=>({k:r.dataset.k, v:r.dataset.verdict, ratio:r.querySelector('[data-ratio]')?.textContent??null, verdict:r.lastElementChild.textContent.trim()}));
      const secs={}; document.querySelectorAll('#info .sec').forEach(s=>{const h=s.querySelector('h4'); if(h){const name=h.childNodes[0]?.textContent?.trim(); secs[name]=[...s.querySelectorAll('li')].map(l=>l.textContent);}});
      return {rows, secs, treeChk:document.querySelector('#tree .row[data-k="chk"] .vl')?.textContent, head:document.querySelector('#info .hd').textContent.replace(/\s+/g,' '), tree:document.getElementById('tree').innerText, out:document.querySelectorAll('#center tr.out').length};})()`);
    const exp = dcs.map(x => (x.verdict === 'pass' ? 'ok' : x.verdict === 'fail' ? 'ng' : x.verdict === 'not_applicable' ? 'na' : 'ne'));
    const rowsOk = JSON.stringify(s.rows.map(r => r.v)) === JSON.stringify(exp)
      && s.rows.filter(r => r.v === 'ne').every(r => r.verdict === '미검토' && r.ratio === null)
      && s.rows.filter(r => r.v === 'na').every(r => r.verdict === '해당 없음');
    // 엔진의 결과(호스트가 화면에 보낸 US 결과 그대로)를 notices.js 로 — 화면이 보여야 할 한국어 · SI 글
    const usRaw = await ev(`${S}.state.runs[0].us`);
    const wl = [], al = [], sl = [];
    const add = (o, pre) => { wl.push(...engList(usRaw, o, 'warnings').map(x => pre + x.text)); al.push(...engList(usRaw, o, 'assumptions').map(x => pre + x.text)); sl.push(...engList(usRaw, o, 'scope_notes').map(x => pre + x.text)); };
    add(usRaw, '');
    if (usRaw.dsm_warning) { wl.push(`[DSM] ${NOTICES.textMap(usRaw, NO)(usRaw.dsm_warning)}`); }
    for (const [k, v] of Object.entries(usRaw)) { if (v && typeof v === 'object' && !Array.isArray(v) && !['region', 'force_model', 'request'].includes(k)) { add(v, `[${k}] `); } }
    const listsOk = JSON.stringify(s.secs['경고'] ?? []) === JSON.stringify(wl) && JSON.stringify(s.secs['가정'] ?? []) === JSON.stringify(al) && JSON.stringify(s.secs['범위'] ?? []) === JSON.stringify(sl);
    const usLeft = [...wl, ...al, ...sl].filter(t => US_NUM.test(t));
    const codes = await ev(`[...document.querySelectorAll('#info li[data-code]')].length`);
    const wantCodes = (usRaw.notices ?? []).filter(n => n && n.code && ['warnings', 'assumptions', 'scope_notes'].includes(n.list)).length;
    const overall = res.pass === false ? 'NG' : res.pass === true ? 'OK' : '판정 없음';
    const cnt = { ng: exp.filter(x => x === 'ng').length, un: exp.filter(x => x === 'ne').length, ok: exp.filter(x => x === 'ok').length };
    const treeOk = s.treeChk === `NG ${cnt.ng} · 미검토 ${cnt.un} · OK ${cnt.ok}`;
    if (!treeOk) { s.rows.push({ v: `트리 「${s.treeChk}」` }); }
    const headOk = s.head.includes(`검토 전체 ${overall}`);
    if (!headOk) { s.rows.push({ v: `머리 「${s.head.slice(0, 80)}」` }); }
    const ctx = { ...(await mcpNow()), params: params2, designSI: res };
    const r = compareNumbers(await numbers(), ctx);
    return {
      ok: rowsOk && listsOk && headOk && treeOk && r.bad.length === 0 && (r.bySrc.design ?? 0) >= 3 && s.out === (res.not_checked ?? []).length && usLeft.length === 0 && codes >= wantCodes,
      detail: `트리 「${s.treeChk}」 · 줄 ${s.rows.map(x => `${x.v}${x.ratio ? ` ${x.ratio}` : ''}`).join(' · ')} · 전체 ${overall} · 경고 ${wl.length} / 가정 ${al.length} / 범위 ${sl.length} 따로(notices.js · 한국어 · SI) · code ${codes}/${wantCodes} · US 수 남음 ${usLeft.length}${usLeft.length ? ` 「${short(usLeft[0], 80)}」` : ''} · 범위 밖 ${s.out}`
        + ` · 수 ${r.compared}개 = MCP(design ${r.bySrc.design ?? 0})${r.bad.length ? ` · 어긋남 ${r.bad.slice(0, 3).join(' / ')}` : ''}${!rowsOk ? ` · 기대 ${exp.join(',')}` : ''}${!listsOk ? ` · 목록 ${short(s.secs, 200)}` : ''}`,
    };
  };
  await step('u05 NG + 미검토 — 엔진의 판정 그대로(NG > 미검토 > OK), 판정비 = MCP', 'u05_checks_ng', () => verify04(compNg, 'NG'));
  const compNe = await mcp.tool('aisi_design_compression', { detail: 'full', Fy: 295, KxLx: 3000, KyLy: 3000, Pu: 5, units: 'SI' });
  check('AI: aisi_design_compression(KtLt 없음 · Pu 5 kN) — 엔진: 평가한 것은 OK, 전체는 판정 없음', compNe.pass === null && (compNe.limit_state_checks ?? []).every(x => x.pass === true)
    && (compNe.not_evaluated ?? []).length > 0, short(compNe.error ?? `pass=${compNe.pass}`));
  await step('u06 OK + 미검토 — 「판정 없음」(OK 로 보이지 않는다)', 'u06_checks_ne', () => verify04(compNe, '판정 없음'));

  section('7. 테마 · 좁은 창');
  const contrast = () => ev(`(()=>{const lum=c=>{const m=c.match(/[\\d.]+/g).map(Number); const f=v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]);};
    const bg=e=>{for(let x=e;x;x=x.parentElement){const b=getComputedStyle(x).backgroundColor; const m=b.match(/[\\d.]+/g); if(m&&(m.length<4||+m[3]>0.5)) return b;} return getComputedStyle(document.body).backgroundColor;};
    const out={}; for(const [k,s] of Object.entries({tree:'#tree .row .nm', info:'#info .ttl', infoNum:'#info .num', status:'.status .msg', title:'#tbar .fname', tab:'#ttabs a.on', vt:'#center table.vt td'})){
      const e=document.querySelector(s); if(!e){out[k]=null; continue;} const a=lum(getComputedStyle(e).color), b=lum(bg(e)); out[k]=+((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2);} return out;})()`);
  await step('u08 어두운 테마 — 글자 대비', 'u08_dark', async () => {
    await select('result', await firstKey('design'));
    const c = await contrast();
    const vals = Object.values(c).filter(v => v !== null);
    return { ok: vals.length >= 6 && vals.every(v => v >= 4.5), detail: JSON.stringify(c) };
  });
  await step('u09 밝은 테마 — 페이지를 다시 싣지 않고 바꾼다(끼운 화면도 그대로) · 글자 대비', 'u09_light', async () => {
    const src0 = await ev(`document.getElementById('designer').src`);
    await ev(`${S}.setTheme('light')`);
    await sleep(300);
    await select('result', await firstKey('design'));
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
    await select('result', await firstKey('design'));
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
  await step('u10c 하중 해석이 아직 없을 때 — 하중 · 접합 보기는 그리지 않고 밝힌다(어떻게 돌리는지: analyze_loads · design_purlin · 편집 상태)', 'u10c_no_loads', async () => {
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
  const purlinArgs = { detail: 'full', member_app: 'roof-purlin', span_type: 'cont-3', span_ft: 6, laps: { left_ft: 0.6, right_ft: 0.6 }, loads: { D: 0.44, Lr: 1.17, W: -2.9 },
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
    await select('result', await firstKey(run));
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
    await select('result', await firstKey(run));
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
  const lapArgs = { detail: 'full', d: 200, t: 2.3, Fy: 295, Fu: 400, lap_left_in: 600, lap_right_in: 600, Mu_support: 12, Vu_support: 11, fastener_type: 'bolt', fastener_dia: 12,
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
  const al = await mcp.tool('analyze_loads', { detail: 'full', member_app: 'roof-purlin', span_type: 'cont-3', span_ft: 6, loads: { D: 0.44, Lr: 1.17 }, design_method: 'LRFD', spacing_ft: 1.2, units: 'SI' });
  await step('u17c AI 의 analyze_loads — 이제 화면에 온다(loadAnalysisComplete, K4a): 하중도 = analyze_loads 의 것(SI), 진행 띠 「하중 해석」 일치', 'u17c_loads_on_screen', async () => {
    await settle(`!!s.loads && s.loads.from==='loads' && s.stages.load.state==='ok'`, 'analyze_loads 결과');
    // 퍼린 설계도 같은 메시지(loadAnalysisComplete)를 보냈다 — 화면이 analyze_loads 의 것을 다시 읽을 때까지
    await settle(`!!s.loads && JSON.stringify(s.loads.si.governing.M_diagram)===${JSON.stringify(JSON.stringify(al.governing?.M_diagram ?? []))}`, 'analyze_loads 의 하중도', 20_000).catch(() => undefined);
    await select('result', 'load');
    const g = await ev(`(()=>{const e=document.querySelector('#center g.dg[data-k="M"]'); return {ys:e?e.dataset.ys.split(',').map(Number):[], st:${S}.state.stages.load.state};})()`);
    const same = (a, b) => Array.isArray(b) && a.length === b.length && a.every((v, k) => relClose(v, b[k]));
    const isPur = same(g.ys, pur.load_analysis.governing.M_diagram), isAl = same(g.ys, al.governing?.M_diagram);
    return { ok: !al.error && isAl && !isPur && g.st === 'ok', detail: `analyze_loads ${al.error ? `오류 ${short(al.error)}` : `성공(Mmax ${Math.max(...(al.governing?.M_diagram ?? [0])).toFixed(3)} kN·m)`} · 화면 M = analyze_loads ${isAl} · = 그 전 design_purlin ${isPur} · 단계 ${g.st}` };
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
  const views = [['01', 'model', 'sec'], ['02', 'result', 'fsm'], ['03', 'result', 'load'], ['04', 'result', await firstKey(`purlin:${(pur2.regions ?? []).findIndex(x => x.result?.pass === false)}`)], ['06', 'result', 'conn:lap']];
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

  // ── U3 — 계산 시트 · 우클릭 메뉴 · 찾기 · AI 따라가기 · 3D ─────────────────────────────
  section('7d. U3 — 계산 시트(= 호스트의 design_checks) · 우클릭 메뉴 · 찾기 · AI 따라가기 · 3D · 무효 장부');
  const SIU = require(path.join(repoRoot, 'out', 'mcp', 'siUnits.js'));
  const conv = (v, t) => (v && typeof v === 'object' ? SIU.convertOutputSIDeep(v, SIU[t]).value : undefined);
  /** 호스트가 화면에 보낸 마지막 결과(US) — 시험이 제품 표로 따로 SI 로 바꾼다(화면과 같은 「말한 변환」) */
  const hostRes = async () => {
    const q = (await api('GET', `/api/wv/${encodeURIComponent(designerId)}/last?command=designResult&command=designPurlinResult&command=lapConnectionResult&command=connectionResult&command=loadAnalysisComplete`)).json?.data ?? {};
    const d = k => q[k]?.message?.data;
    return { us: { design: d('designResult'), purlin: d('designPurlinResult'), lap: d('lapConnectionResult'), conn: d('connectionResult') },
      designSI: conv(d('designResult'), 'SI_OUT_MEMBER'), purlinSI: conv(d('designPurlinResult'), 'SI_OUT_PURLIN'), lapSI: conv(d('lapConnectionResult'), 'SI_OUT_MEMBER'),
      connSI: conv(d('connectionResult'), 'SI_OUT_MEMBER'), loadsSI: conv(d('loadAnalysisComplete'), 'SI_OUT_LOADS') };
  };
  const keyOf = (pred) => ev(`(()=>{const r=${S}.state.runs.flatMap(r=>r.rows).find(${pred}); return r?r.key:null;})()`);
  const viewNow = async () => { const r = await mcp.tool('get_view'); return r?.json ?? r ?? {}; };
  const verdictOfEngine = v => (v === 'pass' ? 'pass' : v === 'fail' ? 'fail' : v === 'not_applicable' ? 'not_applicable' : 'not_evaluated');

  /** 시트를 열고: 덩어리(id · 판정 · governs · 단계 수) = 엔진, 고른 덩어리의 단계 차례(kind) = 엔진, 판정 줄 = 엔진, 시트의 수 = 호스트 값(SI) */
  const verifySheet = async (key, engineList, label) => {
    await ev(`${S}.openSheet(${JSON.stringify(key)})`);
    await sleep(400);
    const g = await ev(`(()=>{const cards=[...document.querySelectorAll('#sheet [data-card]')].map(c=>({key:c.dataset.card,id:c.dataset.id,v:c.dataset.verdict,gov:c.dataset.governs==='true',n:+c.dataset.nsteps,open:!!c.querySelector('.cbody')}));
      const sel=document.querySelector('#sheet [data-card].on'); const kinds=sel?[...sel.querySelectorAll('[data-step]')].map(x=>x.dataset.kind):[];
      const hv=document.querySelector('#sheet .hd .verdict')?.dataset.verdict; const reason=sel?.querySelector('[data-reason]')?.textContent??null;
      return {cards, kinds, hv, reason, sheet:${S}.ui.sheet, title:document.querySelector('#sheet h2')?.textContent};})()`);
    const selId = await ev(`(()=>{const r=${S}.state.runs.flatMap(r=>r.rows).find(x=>x.key===${JSON.stringify(key)}); return r&&r.id;})()`);
    const eng = engineList.find(c => c.id === selId);
    const cardsOk = g.cards.length === engineList.length && g.cards.every((c, i) => c.id === engineList[i].id && c.v === verdictOfEngine(engineList[i].verdict)
      && c.gov === (engineList[i].governs === true) && c.n === (engineList[i].steps ?? []).length);
    const kindsOk = JSON.stringify(g.kinds) === JSON.stringify((eng?.steps ?? []).map(s => s.kind));
    const govOk = JSON.stringify(g.cards.filter(c => c.gov).map(c => c.id)) === JSON.stringify(engineList.filter(c => c.governs).map(c => c.id));
    const vOk = g.hv === verdictOfEngine(eng?.verdict) && g.sheet === key && g.cards.find(c => c.key === key)?.open;
    const reasonOk = eng && ['not_evaluated', 'not_applicable'].includes(eng.verdict) ? g.reason === (engReason(eng) ?? '엔진이 까닭을 적지 않았다') && !US_NUM.test(g.reason ?? '') : true;
    const ctx = { ...(await mcpNow()), params: paramsS, ...(await hostRes()) };
    const r = compareNumbers(await numbers('#sheet'), ctx);
    return { ok: cardsOk && kindsOk && govOk && vOk && reasonOk && r.bad.length === 0 && r.compared > 0, g, eng, r,
      detail: `${label} 「${short(g.title, 60)}」 · 덩어리 ${g.cards.length}/${engineList.length} (id · 판정 · governs · 단계 수) ${cardsOk} · 단계 ${g.kinds.length} 개 차례 ${kindsOk} · 지배 ${govOk} · 판정 ${g.hv} = 엔진 ${eng?.verdict} ${vOk}`
        + `${reasonOk ? '' : ` · 까닭 「${short(g.reason, 60)}」`} · 수 ${r.compared}개 = 호스트(SI)${r.bad.length ? ` · ${r.bad.slice(0, 3).join(' / ')}` : ''}` };
  };
  /** 정보 창의 수(같은 항목) = 호스트 값, 그리고 시트와 같은 경로의 값이 같다 */
  const verifyInfoSame = async key => {
    await ev(`${S}.closeSheet()`);
    await select('result', key);
    const ctx = { ...(await mcpNow()), params: paramsS, ...(await hostRes()) };
    const items = await numbers('#info');
    const r = compareNumbers(items, ctx);
    const pre = await ev(`(()=>{const r=${S}.state.runs.flatMap(r=>r.rows).find(x=>x.key===${JSON.stringify(key)}); return r&&r.src;})()`);
    const mine = items.filter(x => x.src.startsWith(pre));
    return { ok: r.bad.length === 0 && mine.length >= 1, detail: `정보 창 수 ${r.compared}개 = 호스트 · 이 항목의 값 ${mine.length}개(${mine.map(x => x.src.slice(pre.length)).slice(0, 4).join(', ')})${r.bad.length ? ` · ${r.bad.slice(0, 2).join(' / ')}` : ''}` };
  };

  // 퍼린 — 결과가 지금 것(위 u18 에서 만든 퍼린 · 랩)
  await settle(`s.regions.length>0 && s.runs.some(r=>r.area==='purlin' && r.rows.length)`, '퍼린 결과', 60_000);
  const hp = await hostRes();
  const ngKey = await keyOf(`x=>x.scope==='purlin' && x.verdict==='fail'`);
  await step('u21 계산 시트 — 퍼린 구간 검토 지점의 NG 항목: 덩어리 · 단계 · 지배 · 판정 · 수 = 호스트의 design_checks', 'u21_sheet_purlin_ng', async () => {
    const m = /^purlin:(\d+)#(\d+):/.exec(ngKey ?? '');
    const list = hp.us.purlin?.regions?.[+m[1]]?.result?.checks?.[+m[2]]?.design_checks ?? [];
    const r = await verifySheet(ngKey, list, `퍼린 ${ngKey}`);
    return { ok: r.ok, detail: r.detail };
  });
  await step('u21b 정보 창 = 시트(같은 항목의 소요 · 설계강도 · 비)', null, () => verifyInfoSame(ngKey));
  // 접합(나사) — 미검토 · 해당 없음 항목
  const conn = await mcp.tool('design_connection', { detail: 'full', connection_type: 'screw', t1: 1.4376, t2: 1.4376, Fu: 400, Fy: 295, d: 4.826, n: 4, s: 38.1, e: 25.4, Pu: 5.34, design_method: 'LRFD', units: 'SI' });
  check('AI: design_connection(나사 · SI)', !conn.error, short(conn.error ?? `판정 ${conn.pass}`));
  await settle(`!!s.conn && s.runs.some(r=>r.key==='conn' && r.rows.length)`, '접합 결과');
  const hc = await hostRes();
  const neKey = await keyOf(`x=>x.scope==='connection' && x.verdict==='not_evaluated'`);
  const naKey = await keyOf(`x=>x.scope==='connection' && x.verdict==='not_applicable'`);
  await step('u22 계산 시트 — 접합의 미검토 항목: 덩어리는 「미검토 — 까닭」, 까닭 = 엔진의 reason', 'u22_sheet_conn_ne', async () => {
    const r = await verifySheet(neKey, hc.us.conn?.design_checks ?? [], `접합 ${neKey}`);
    return { ok: r.ok, detail: r.detail };
  });
  await step('u22b 계산 시트 — 접합의 해당 없음 항목', null, async () => {
    const r = await verifySheet(naKey, hc.us.conn?.design_checks ?? [], `접합 ${naKey}`);
    return { ok: r.ok && !!naKey, detail: r.detail };
  });
  const lapKey = await keyOf(`x=>x.scope==='lap' && x.id==='lap.fastener_group'`);
  await step('u23 계산 시트 — 랩 접합의 패스너 무리 항목', 'u23_sheet_lap', async () => {
    const r = await verifySheet(lapKey, hc.us.lap?.design_checks ?? [], `랩 ${lapKey}`);
    return { ok: r.ok, detail: r.detail };
  });
  // 부재(휨) — 이 결과가 퍼린 결과를 대신한다(호스트의 부재 검토는 하나)
  const flexR = await mcp.tool('aisi_design_flexure', { detail: 'full', Fy: 295, Fu: 400, Mu: 13.56, Vu: 13.3, Lb: 1524, design_method: 'LRFD', units: 'SI' });
  check('AI: aisi_design_flexure(SI) — 엔진: 뒤틀림 · 휨+전단 NG', !flexR.error, short(flexR.error ?? `판정 ${flexR.pass}`));
  await settle(`s.runs.some(r=>r.key==='design' && r.rows.length) && !s.runs.some(r=>r.area==='purlin')`, '휨 결과');
  const hm = await hostRes();
  const flexNg = await keyOf(`x=>x.scope==='member' && x.verdict==='fail'`);
  await step('u24 계산 시트 — 부재 휨의 NG 항목(지배 덩어리 펼침 · 대입 · 식 번호 · 출처)', 'u24_sheet_member', async () => {
    const r = await verifySheet(flexNg, hm.us.design?.design_checks ?? [], `부재 ${flexNg}`);
    const mcpSame = Array.isArray(flexR.design_checks) ? flexR.design_checks.every((c, i) => c.id === hm.designSI.design_checks[i].id && (c.capacity?.value ?? null) === (hm.designSI.design_checks[i].capacity?.value ?? null)) : null;
    return { ok: r.ok && mcpSame !== false, detail: `${r.detail} · MCP 의 SI 답 = 호스트(SI) ${mcpSame === null ? '— MCP 답에 design_checks 없음(요약)' : mcpSame}` };
  });
  await step('u24b 정보 창 = 시트(부재) · 「소요 / 설계강도」 열(템플릿 04)', 'u24b_info_member', async () => {
    const r = await verifyInfoSame(flexNg);
    const dc = await ev(`[...document.querySelectorAll('#info td.dc')].map(t=>t.textContent.trim())`);
    return { ok: r.ok && dc.length >= 3 && dc.some(t => /\//.test(t)), detail: `${r.detail} · 소요 / 설계강도 칸 ${dc.length} 「${short(dc[0], 30)}」` };
  });
  await step('u24c 시트의 앞 · 다음(Alt+← →) · 덩어리 머리를 누르면 그 항목 · 닫기(Esc)', null, async () => {
    await ev(`${S}.openSheet(${JSON.stringify(flexNg)})`);
    await sleep(300);
    const next = await ev(`[...document.querySelectorAll('#sheet [data-sheet-go]')].pop()?.dataset.sheetGo`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}))`);
    await sleep(300);
    const after = await ev(`${S}.ui.sheet`);
    const other = await ev(`[...document.querySelectorAll('#sheet [data-card-head]')].map(x=>x.dataset.cardHead).find(k=>k!==${S}.ui.sheet)`);
    await ev(`(()=>{const h=[...document.querySelectorAll('#sheet [data-card-head]')].find(x=>x.dataset.cardHead!==window.__stcfsdUi.ui.sheet); h&&h.click(); return 1;})()`);
    await sleep(300);
    const clicked = await ev(`${S}.ui.sheet`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(300);
    const closed = await ev(`${S}.ui.sheet`);
    return { ok: !!next && after === next && clicked === other && closed === null, detail: `다음 ${short(next, 50)} → ${after === next} · 머리 누름 → ${short(clicked, 50)} · Esc → ${closed}` };
  });

  // 「Claude 가 보는 선택」 — 누른 것 = get_view
  const localKey = await keyOf(`x=>x.scope==='member' && x.id==='member.flexure.local'`);
  const distKey = await keyOf(`x=>x.scope==='member' && x.id==='member.flexure.distortional'`);
  await step('u25 누른 항목 = get_view 의 current.selection(by person) = 정보 창 아래 칩', 'u25_share', async () => {
    await ev(`(()=>{const r=[...document.querySelectorAll('#tree .row')].find(x=>x.dataset.k===${JSON.stringify(localKey)}); r&&r.click(); return !!r;})()`);
    // 누른 뒤에도 화면은 계속 다시 그려질 수 있다(결과 · 상태 · Claude 연결이 잇달아 올 때) — 0.15 초마다 다시 그려도 보고는 0.4 초 뒤에 나가야 한다.
    // 이전에는 다시 그릴 때마다 0.4 초 시계를 새로 걸어 보고가 밀렸고, get_view 가 옛 고른 것을 돌려주었다(전체 실행의 u25 실패)
    await ev(`(()=>{const u=window.__stcfsdUi; const m=u.modeSel; let n=0; const t=setInterval(()=>{u.setLen(m.len,m.mode); if(++n>=10) clearInterval(t);},150); return 1;})()`);
    // 기다리는 신호: 호스트가 그 보고를 받아 적었다는 답(화면의 reported) — 누른 뒤 1.2 초 안(0.4 초 모음 + 왕복)
    const t0 = Date.now();
    await waitFor(`${S}.reported?.sent?.selection?.id==='member.flexure.local'`, 1200, '보고의 답').catch(() => {});
    const waited = Date.now() - t0;
    const v = await viewNow();
    const chip = await ev(`({item:document.getElementById('share').dataset.item, text:document.querySelector('#share b').textContent})`);
    const sel = v.current?.selection;
    const ok = v.current?.screen === 'review' && sel?.kind === 'check' && sel.id === 'member.flexure.local' && sel.scope === 'member' && v.current.by === 'person'
      && JSON.stringify(JSON.parse(chip.item)) === JSON.stringify(sel) && /국부\s?좌굴/.test(chip.text);
    return { ok, detail: `다시 그리는 중에 보고의 답까지 ${waited} ms · get_view ${short(v.current, 180)} · 칩 「${short(chip.text, 60)}」` };
  });
  // AI 따라가기 — 꺼져 있으면 움직이지 않고 알림
  const foc1 = await mcp.tool('focus', { item: { kind: 'check', id: 'member.flexure.distortional', scope: 'member' }, reason: '뒤틀림이 지배한다' });
  await step('u26 AI 따라가기 꺼짐 — focus 를 따르지 않고 「AI 가 가리킴」 알림(누르면 그리로) · get_view 는 사실 그대로', 'u26_ai_pointed', async () => {
    await waitFor(`!!document.querySelector('#aipoint:not([hidden])[data-request]')`, 10_000, '가리킴 알림');
    await sleep(800);
    const sel = await ev(`${S}.ui.sel`);
    const v = await viewNow();
    const ok1 = foc1.target_found === true && sel === localKey && v.current?.selection?.id === 'member.flexure.local' && v.last_focus?.response?.followed === false && v.last_focus?.response?.note === 'follow_off';
    const box = await ev(`document.getElementById('aipoint').innerText`);
    await shot('u26_ai_pointed_1920_dark');
    await ev(`document.querySelector('#aipoint [data-ai="go"]').click()`);
    await sleep(1200);
    const sel2 = await ev(`${S}.ui.sel`);
    const v2 = await viewNow();
    return { ok: ok1 && sel2 === distKey && v2.current?.selection?.id === 'member.flexure.distortional' && v2.current.by === 'person' && /AI 가 가리킴/.test(box),
      detail: `focus → target_found ${foc1.target_found} · 화면 그대로 ${sel === localKey} · get_view followed ${v.last_focus?.response?.followed} · 알림 「${short(box.replace(/\s+/g, ' '), 70)}」 · 「가기」 → ${short(sel2, 40)} (by ${v2.current?.by})` };
  });
  await step('u27 AI 따라가기 켬 — 5 초 가만히 있으면 focus 를 따라간다(트리 · 보기 · 시트), 까닭을 보인다 · 창 포커스 · 편집 상태 · 모델 그대로', 'u27_ai_followed', async () => {
    await ev(`document.querySelector('[data-act="follow"]').click()`);
    await ev(`${S}.openSheet(${JSON.stringify(localKey)})`);
    await waitFor(`${S}.ui.idleMs > 5300`, 15_000, '5 초 가만히');
    const before = await mcp.tool('get_full_state');
    const f = await mcp.tool('focus', { item: { kind: 'check', id: 'member.flexure.distortional', scope: 'member' }, reason: '뒤틀림 좌굴이 지배' });
    await waitFor(`${S}.ui.sheet===${JSON.stringify(distKey)}`, 10_000, '따라감');
    await sleep(900);
    const s = await ev(`({sel:${S}.ui.sel, sheet:${S}.ui.sheet, tree:document.querySelector('#tree .row.on')?.dataset.k, card:document.querySelector('#sheet [data-card].on')?.dataset.id,
      note:document.getElementById('aipoint').innerText, editing:${S}.ui.editing, focus:document.hasFocus()})`);
    const v = await viewNow();
    const after = await mcp.tool('get_full_state');
    const same = before.nnodes === after.nnodes && JSON.stringify(before.results?.member_design) === JSON.stringify(after.results?.member_design);
    return { ok: f.target_found === true && s.sheet === distKey && s.card === 'member.flexure.distortional' && v.current?.by === 'focus' && v.current?.selection?.id === 'member.flexure.distortional'
      && v.current?.follows_focus === true && v.last_focus?.response?.followed === true && v.last_focus?.response?.note === 'followed' && /뒤틀림 좌굴이 지배/.test(s.note) && !s.editing && same,
      detail: `시트 ${short(s.sheet, 40)} · 덩어리 ${s.card} · get_view by ${v.current?.by} · followed ${v.last_focus?.response?.followed} · 까닭 「${short(s.note.replace(/\s+/g, ' '), 60)}」 · 편집 ${s.editing} · 모델 · 결과 그대로 ${same}` };
  });
  await step('u28 지금 결과에 없는 검토 항목을 가리키면 — 호스트가 거절(target_found false), 화면은 움직이지 않는다', null, async () => {
    const before = await ev(`${S}.ui.sheet`);
    const f = await mcp.tool('focus', { item: { kind: 'check', id: 'member.compression.local', scope: 'member' }, reason: '없는 항목' });
    await sleep(1500);
    const after = await ev(`${S}.ui.sheet`);
    return { ok: f.target_found === false && f.forwarded === false && before === after, detail: `target_found ${f.target_found} · forwarded ${f.forwarded} · 「${short(f.note, 80)}」 · 화면 그대로 ${before === after}` };
  });
  await step('u28b 화면이 찾지 못하는 항목(없는 퍼린 구간) — 따르지 않고 그렇다고 보인다 · get_view 에 followed false', 'u28b_ai_missing', async () => {
    const f = await mcp.tool('focus', { item: { kind: 'result', id: 'purlin.region.no-such-region' }, reason: '구간 보기' });
    await waitFor(`!!document.querySelector('#aipoint.miss')`, 10_000, '찾지 못함 알림');
    await sleep(900);
    const v = await viewNow();
    const box = await ev(`document.getElementById('aipoint').innerText`);
    await ev(`document.querySelector('#aipoint [data-ai="dismiss"]').click()`);
    await ev(`document.querySelector('[data-act="follow"]').click()`);
    return { ok: f.forwarded === true && v.last_focus?.response?.followed === false && v.last_focus?.response?.note === 'not_in_results' && /없다/.test(box), detail: `forwarded ${f.forwarded} · followed ${v.last_focus?.response?.followed} (${short(v.last_focus?.response?.note, 50)}) · 「${short(box.replace(/\s+/g, ' '), 70)}」` };
  });
  await ev(`${S}.closeSheet()`);

  // 우클릭 메뉴 — 마우스 · 키보드
  await step('u29 우클릭 메뉴(트리의 검토 항목) — 템플릿의 항목 · 단축키, 확인 표시는 꺼짐, 「계산 시트 열기」', 'u29_menu_tree', async () => {
    await select('result', distKey);
    await ev(`(()=>{const r=document.querySelector('#tree .row.on'); const b=r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+150,clientY:b.top+12})); return 1;})()`);
    await sleep(250);
    const items = await ev(`[...document.querySelectorAll('.ctx .ci')].map(c=>c.querySelector('span').textContent+'|'+c.querySelector('kbd').textContent+'|'+(c.classList.contains('off')?'off':'on'))`);
    await shot('u29_menu_tree_1920_dark');
    const want = ['보기에서 찾기|F|on', '이 위치만 보기|I|on', '계산 시트 열기|Enter|on', '표에서 보기||on', '확인 표시|Space|off', '이름 복사|Ctrl+C|on'];
    await ev(`[...document.querySelectorAll('.ctx .ci')].find(c=>c.textContent.startsWith('계산 시트 열기')).click()`);
    await sleep(300);
    const sheet = await ev(`${S}.ui.sheet`);
    await ev(`${S}.closeSheet()`);
    return { ok: JSON.stringify(items) === JSON.stringify(want) && sheet === distKey, detail: `${items.join(' · ')} · 「계산 시트 열기」 → ${short(sheet, 40)}` };
  });
  await step('u29b 키보드 — Shift+F10 로 메뉴 · ↓ · Enter(이 위치만 보기) · Esc 로 풀기 · Enter 로 시트 · F · Space · Ctrl+C', null, async () => {
    await select('result', distKey);
    const key = (k, o = {}) => ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true,cancelable:true,${Object.entries(o).map(([a, b]) => `${a}:${b}`).join(',')}}))`);
    await key('F10', { shiftKey: true });
    await sleep(200);
    const open1 = await ev(`${S}.ui.menu`);
    await key('ArrowDown'); await key('ArrowDown');
    const cur = await ev(`document.querySelector('.ctx .ci.sel span')?.textContent`);
    await key('Enter');
    await sleep(300);
    const filt = await ev(`({f:${S}.ui.filter, rows:[...document.querySelectorAll('#tree .row')].filter(r=>r.dataset.k.includes('#')).length, head:document.querySelector('#tree .row[data-k="chk:filter"]')?.textContent})`);
    await key('Escape');
    await sleep(250);
    const unf = await ev(`${S}.ui.filter`);
    await key('Enter');
    await sleep(300);
    const sh = await ev(`${S}.ui.sheet`);
    await key('Escape');
    await sleep(200);
    await key('f');
    await sleep(250);
    await key(' ');
    await sleep(200);
    const toastTxt = await ev(`document.querySelector('#status .toasts')?.textContent ?? ''`);
    await key('c', { ctrlKey: true });
    await sleep(200);
    const copied = await ev('window.__uiLastCopy || ""');
    return { ok: open1 === true && cur === '이 위치만 보기' && !!filt.f && /이 위치만/.test(filt.head ?? '') && unf === null && sh === distKey && /확인 표시/.test(toastTxt) && /뒤틀림\s?좌굴/.test(copied),
      detail: `메뉴 ${open1} · ↓↓ ${cur} · 걸러진 줄 ${filt.rows} 「${short(filt.head, 30)}」 · Esc → ${unf} · Enter → 시트 ${sh === distKey} · Space 「${short(toastTxt, 40)}」 · Ctrl+C 「${short(copied, 40)}」` };
  });
  await step('u29c 우클릭 메뉴 — 정보 창의 수(출처 보기 · 표에서 보기 · 복사) · 표의 줄 · 그림', 'u29c_menu_value', async () => {
    await select('result', distKey);
    const ctxAt = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const b=e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+4,clientY:b.top+4})); return [...document.querySelectorAll('.ctx .ci span')].map(s=>s.textContent);})()`);
    const v = await ctxAt('#info td.dc [data-src]');
    await ev(`[...document.querySelectorAll('.ctx .ci')].find(c=>c.textContent.startsWith('출처 보기')).click()`);
    await sleep(250);
    const tipTxt = await ev(`document.querySelector('.tipbox, .tip, #tip')?.textContent ?? [...document.querySelectorAll('body > div')].map(d=>d.textContent).find(t=>/^출처:/.test(t)) ?? ''`);
    await shot('u29c_menu_value_1920_dark');
    const t = await ctxAt('#center table.vt tr.ck');
    await ev(`${S}.closeMenu()`);
    const d = await ctxAt('#center .dv[data-draw="mode"]');
    await ev(`${S}.closeMenu()`);
    return { ok: JSON.stringify(v) === JSON.stringify(['출처 보기', '표에서 보기', '복사']) && /출처: 부재 검토 결과/.test(tipTxt) && (t === null || t.includes('행 복사')) && JSON.stringify(d) === JSON.stringify(['전체 맞춤', '표시 항목', '그림 복사']),
      detail: `값 ${v?.join(' · ')} → 「${short(tipTxt, 70)}」 · 표 줄 ${t?.join(' · ') ?? '(판정비 표 없음)'} · 그림 ${d?.join(' · ')}` };
  });
  // 찾기
  await step('u30 찾기(Ctrl+F) — id 로 검토 항목을 찾아 Enter → 그 항목 · 「절점 3」 → 절점 표의 그 줄', 'u30_find', async () => {
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}))`);
    await sleep(200);
    await ev(`(()=>{const i=document.getElementById('find-q'); i.value='flexure.local'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
    await sleep(200);
    const hits = await ev(`[...document.querySelectorAll('#find .fi')].map(x=>x.textContent)`);
    await shot('u30_find_1920_dark');
    await ev(`document.getElementById('find-q').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await sleep(400);
    const sel = await ev(`${S}.ui.sel`);
    await ev(`document.querySelector('[data-act="find"]').click()`);
    await sleep(150);
    await ev(`(()=>{const i=document.getElementById('find-q'); i.value='절점 3'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
    await sleep(200);
    await ev(`document.getElementById('find-q').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await sleep(500);
    const node = await ev(`({sel:${S}.ui.sel, tab:${S}.ui.tab, row:document.querySelector('table[data-table="nodes"] tr.on td')?.textContent, open:!document.getElementById('find').hidden})`);
    return { ok: hits.length >= 1 && sel === localKey && node.sel === 'snode' && node.row === '3' && !node.open, detail: `찾음 ${hits.length} 「${short(hits[0], 50)}」 → ${short(sel, 40)} · 「절점 3」 → ${node.tab}/${node.sel} 줄 ${node.row}` };
  });
  // 3D
  await step('u31 3D 모드 형상 — 칩을 켜면 제품의 렌더러가 /ui/ 의 CSP 아래에서 그린다(위반 0) · 2D 가 기본', 'u31_3d', async () => {
    const m0 = log.console.length;
    await select('result', 'fsm');
    const def = await ev(`({chip:document.querySelector('#center [data-opt="mode3d"]')?.className, slot:!!document.querySelector('[data-v3d]')})`);
    await ev(`document.querySelector('#center [data-opt="mode3d"]').click()`);
    await waitFor(`document.querySelector('[data-v3d]')?.dataset.state==='drawn'`, 30_000, '3D 그림');
    const r = await ev(`(()=>{const i=window.CufsmViewer3D&&window.CufsmViewer3D._modeInstance; const sc=i&&i._scene; const ms=sc?sc.meshes.filter(x=>x.getTotalVertices&&x.getTotalVertices()>0):[]; return {meshes:ms.length, verts:ms.reduce((n,x)=>n+x.getTotalVertices(),0), len:+document.querySelector('[data-v3d]').dataset.len};})()`);
    const csp = log.console.slice(m0).filter(c => /Content Security Policy|Refused to/i.test(c.text));
    return { ok: def.slot === false && !/\bon\b/.test(def.chip) && r.meshes > 0 && r.verts > 100 && csp.length === 0, detail: `기본 2D ${!def.slot} · 메시 ${r.meshes} · 꼭짓점 ${r.verts} · 반파장 #${r.len} · CSP 위반 ${csp.length}` };
  });
  // 템플릿 05 와 견줄 그림 — 시트(지배 펼침 · 미검토), 메뉴, 가리킴, 3D — 1920 · 960, 어두운 · 밝은
  for (const [w, h] of [[1920, 1080], [960, 900]]) {
    W = w; H = h;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    for (const th of ['dark', 'light']) {
      await ev(`${S}.setTheme(${JSON.stringify(th)})`);
      await step(`u32 그림 ${w}px · ${th === 'dark' ? '어두운' : '밝은'} — 시트 · 미검토 덩어리 · 3D`, null, async () => {
        await ev(`${S}.openSheet(${JSON.stringify(flexNg)})`);
        await sleep(400);
        await shot(`u32_sheet_${w}_${th}`);
        await ev(`${S}.openSheet(${JSON.stringify(neKey)})`).catch(() => null);
        await sleep(400);
        await shot(`u32_sheet_ne_${w}_${th}`);
        await ev(`${S}.closeSheet()`);
        await select('result', distKey);
        await ev(`(()=>{const r=document.querySelector('#tree .row.on')||document.querySelector('#center table.vt tr.ck'); const b=r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+120,clientY:b.top+12})); return 1;})()`);
        await sleep(250);
        await shot(`u32_menu_${w}_${th}`);
        await ev(`${S}.closeMenu()`);
        await select('result', 'fsm');
        await sleep(1500);
        await shot(`u32_3d_${w}_${th}`);
        const s = await ev(`({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth})`);
        return { ok: s.sw <= s.cw, detail: `scrollWidth ${s.sw}/${s.cw}` };
      });
    }
  }
  await ev(`${S}.setTheme('dark')`);
  await ev(`(()=>{const c=document.querySelector('#center [data-opt="mode3d"]'); if(c&&c.classList.contains('on')) c.click(); return 1;})()`);
  W = 1920; H = 1080;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  // ── U4 — 검토 상태(K2) · 출처 · 편집 상태 · 저장 안 함 · 엔진 계약의 표시 ─────────────────
  section('7e. U4 — 모델 탭의 부재 · 하중 · 설계 조건 · 접합부 = 호스트의 검토 상태(출처 포함) · 편집 상태 · 저장 안 함 · 엔진 계약');
  const caseHost = async () => (await api('POST', '/api/mcp/action', { action: 'get_case_inputs' })).json;
  /** 정보 창 · 트리의 출처 꼬리표 = get_case_inputs.sources, AI 가 주지 않은 칸 = 「AI: 주지 않음」 */
  const verifyCase = async (key, label) => {
    await select('model', key);
    await sleep(300);
    const host = await caseHost();
    const r = compareNumbers(await numbers('#info'), { ...(await mcpNow()), params: paramsS, caseUS: host });
    const tags = await ev(`[...document.querySelectorAll('#info tr[data-k^="case:"]')].map(tr=>({k:tr.dataset.k.slice(5), src:tr.querySelector('.tag[data-source]')?.dataset.source, blank:!!tr.querySelector('[data-blank="ai"]'), txt:tr.children[1].textContent.trim()}))`);
    const badTag = tags.filter(t => !['spans', 'supports', 'laps'].includes(t.k) && (t.src !== host.sources[t.k] || t.blank !== (host.inputs[t.k] === null && host.sources[t.k] === 'ai')));
    const tree = await ev(`[...document.querySelectorAll('#tree .row[data-k^="case:"]')].map(r=>({k:r.dataset.k.slice(5), src:r.querySelector('.tag[data-source]')?.dataset.source}))`);
    const badTree = tree.filter(t => !['spans', 'supports', 'laps'].includes(t.k) && t.src !== undefined && t.src !== host.sources[t.k]);
    // 수가 아닌 값(선택지 · 체크) = 호스트의 값 그대로
    const texts = await ev(`[...document.querySelectorAll('#info [data-ckey]')].map(e=>({k:e.dataset.ckey, t:e.dataset.text, b:e.dataset.bool}))`);
    const badText = texts.filter(x => x.t !== undefined ? String(host.inputs[x.k]) !== x.t : (host.inputs[x.k] ? '1' : '0') !== x.b);
    return { ok: r.bad.length === 0 && (r.bySrc.case ?? 0) >= 1 && tags.length >= 3 && badTag.length === 0 && badTree.length === 0 && badText.length === 0, tags, host,
      detail: `${label}: 수 ${r.bySrc.case ?? 0}개 = get_case_inputs(SI) · 선택지 · 체크 ${texts.length}개${badText.length ? ` 어긋남 ${JSON.stringify(badText.slice(0, 2))}` : ' = 호스트'} · 출처 꼬리표 ${tags.length}칸(트리 ${tree.length}) = sources${badTag.length ? ` · 어긋남 ${JSON.stringify(badTag.slice(0, 3))}` : ''}${badTree.length ? ` · 트리 어긋남 ${JSON.stringify(badTree.slice(0, 3))}` : ''}`
        + ` · AI 빈칸 ${tags.filter(t => t.blank).length}${r.bad.length ? ` · ${r.bad.slice(0, 3).join(' / ')}` : ''}` };
  };
  const setCase = await mcp.tool('set_case_inputs', { inputs: { Lb: 1500, Cb: 1.2 }, units: 'SI', reason: '시험 — 설계 길이' });
  const purU4 = await mcp.tool('design_purlin', purlinArgs);
  check('AI: set_case_inputs(SI) · design_purlin(묶음을 상태에 쓴다)', setCase.success === true && !purU4.error && typeof purU4.case_rev === 'number',
    short(`set rev ${setCase.rev} · purlin case_rev ${purU4.case_rev} · 쓴 ${purU4.case_inputs_written?.length} · 못 쓴 ${JSON.stringify(purU4.case_inputs_not_written ?? []).slice(0, 80)}`));
  await settle(`s.caseIn && s.caseIn.rev>=${purU4.case_rev}`, '검토 상태의 새 판');
  for (const [key, label, shotName] of [['mem', '부재', 'u40_model_member'], ['ld', '하중', 'u40_model_loads'], ['dc', '설계 조건', 'u40_model_design'], ['cj', '접합부', null], ['mat', '재료 · 설계 강도', null]]) {
    await step(`u40 모델 탭 · ${label} — 값 · 단위 · 출처 꼬리표(기본값 · 지정 · AI · 파일 · 하중 해석 · 재료) = 호스트의 get_case_inputs`, shotName, async () => {
      const r = await verifyCase(key, label);
      return { ok: r.ok, detail: r.detail };
    });
  }
  // 보기 계약 2절(b60e62d) — 화면은 id · 어휘만 알린다. 칩은 호스트가 받아 적은 것(버린 것이 있으면 그렇다고)
  await step('u43a 퍼린 검토 항목을 고르면 — 보고의 위치는 {region, check_point} 뿐 · 호스트가 버린 것 없음 · 어휘 밖 보기 · 없는 항목은 호스트가 버리고 칩이 그렇다고', 'u43a_view_report', async () => {
    const k = await keyOf(`x=>x.scope==='purlin' && x.locUS && x.locUS.region && x.us`);
    await select('result', k);
    await sleep(1200);
    const v1 = await viewNow();
    const r1 = await ev(`${S}.reported`);
    const locKeys = Object.keys(v1.current?.selection?.location ?? {});
    await ev(`${S}.reportNow('result/no-such-group:nothing', {kind:'check', id:'member.no.such.check', scope:'member'})`);
    await waitFor(`(${S}.reported?.dropped||[]).length>0`, 10_000, '버린 것');
    const r2 = await ev(`${S}.reported`);
    const chip = await ev(`({text:document.querySelector('#share b').textContent, dropped:document.getElementById('share').dataset.dropped, item:document.getElementById('share').dataset.item})`);
    const v2 = await viewNow();
    await shot('u43a_dropped_chip_1920_dark');
    await select('result', k);
    await sleep(1200);
    return { ok: v1.current?.selection?.id && locKeys.length >= 1 && locKeys.every(x => ['region', 'check_point'].includes(x)) && r1.dropped.length === 0
      && r2.dropped.includes('view') && r2.dropped.includes('selection') && r2.view === null && r2.selection === null && /호스트가 버림/.test(chip.text) && chip.item === 'null'
      && v2.current?.view === null && v2.current?.selection === null,
      detail: `고른 것 ${v1.current?.selection?.id} · 위치 ${JSON.stringify(v1.current?.selection?.location)} · 버린 것 ${JSON.stringify(r1.dropped)} → 어휘 밖 보고: 버린 것 ${JSON.stringify(r2.dropped)} · 칩 「${short(chip.text, 70)}」 · get_view view ${v2.current?.view} selection ${v2.current?.selection}` };
  });
  await step('u43b 퍼린 검토 지점 — 지점 · 경간(1 부터) · 구간의 지점 · 소요 근거 = 호스트, 조합 envelope 은 「포락선」, 시트의 가정 칸 = 그 지점 자신의 알림', 'u43b_point', async () => {
    const pts = [];
    (purU4.regions ?? []).forEach((rg, i) => (rg.result?.checks ?? []).forEach((c, p) => pts.push({ i, p, c })));
    const env = pts.find(x => x.c.design_checks?.some(d => d.combination === 'envelope')) ?? pts[0];
    const d = env.c.design_checks.find(x => x.combination === 'envelope') ?? env.c.design_checks[0];
    const k = await keyOf(`x=>x.run==='purlin:${env.i}' && x.point===${env.p} && x.id===${JSON.stringify(d.id)}`);
    await ev(`${S}.openSheet(${JSON.stringify(k)})`);
    await sleep(500);
    const sh = await ev(`({loc:document.querySelector('#sheet tr[data-loc]')?.dataset.loc, locTxt:document.querySelector('#sheet tr[data-loc]')?.textContent, combo:document.querySelector('#sheet tr[data-combination]')?.dataset.combination,
      comboTxt:document.querySelector('#sheet tr[data-combination] td.r')?.textContent, notes:[...document.querySelectorAll('#sheet tr[data-point-note]')].map(t=>t.dataset.pointNote)})`);
    await ev(`${S}.closeSheet()`);
    const L = d.location ?? {};
    const loc = JSON.parse(sh.loc ?? '{}');
    const want = { support: L.support ?? null, span: L.span ?? null, region_support: L.region_support ?? null, demand_basis: L.demand_basis ?? null };
    const nNotes = ['warnings', 'assumptions', 'scope_notes', 'not_checked'].reduce((a, x) => a + (Array.isArray(env.c[x]) ? env.c[x].length : 0), 0);
    const notesOk = nNotes === 0 ? sh.notes.length === 1 && sh.notes[0] === '' : sh.notes.length === nNotes;
    const oneBased = (L.support === null || L.support >= 1) && (L.span === null || L.span >= 1) && (L.support === null) !== (L.span === null);
    return { ok: JSON.stringify(loc) === JSON.stringify(want) && oneBased && sh.combo === d.combination && (d.combination === 'envelope' ? sh.comboTxt === '포락선' : sh.comboTxt === d.combination) && notesOk,
      detail: `${k} · 위치 ${sh.loc} = 호스트 ${JSON.stringify(want)} · 「${short((sh.locTxt ?? '').replace(/\s+/g, ' '), 70)}」 · 조합 ${d.combination} → 「${sh.comboTxt}」 · 지점 알림 ${sh.notes.length}줄(호스트 ${nNotes})` };
  });
  await step('u40b AI 가 정한 해석 기준 응력이 재료 자리에(출처 AI) · 계산 시트의 「설계 가정과 출처」에 검토 상태의 출처', null, async () => {
    await mcp.tool('set_load_case', { load_case: 'bending_xx_pos', fy: 295, units: 'SI' });
    await settle(`s.model && s.model.loadFySource==='ai'`, '기준 응력 출처');
    await select('model', 'mat');
    const ref = await ev(`(()=>{const tr=[...document.querySelectorAll('#info tr')].find(t=>/기준 응력/.test(t.textContent)); return tr?{v:tr.querySelector('[data-v]')?.dataset.v, tag:tr.querySelector('.tag[data-source]')?.dataset.source}:null;})()`);
    await mcp.tool('aisi_design_flexure', { detail: 'full', Fy: 295, Fu: 400, Mu: 13.56, Vu: 13.3, Lb: 1524, design_method: 'LRFD', units: 'SI' });
    await settle(`s.runs.some(r=>r.key==='design' && r.rows.length)`, '휨 결과');
    const k = await keyOf(`x=>x.scope==='member' && x.id==='member.flexure.global'`);
    await ev(`${S}.openSheet(${JSON.stringify(k)})`);
    await sleep(400);
    const srcs = await ev(`[...document.querySelectorAll('#sheet .cols table.t tr')].map(t=>({sym:t.children[0]?.textContent.trim(), tag:[...t.querySelectorAll('.tag[data-source]')].map(x=>x.dataset.source).join(',')})).filter(x=>x.tag)`);
    await ev(`${S}.closeSheet()`);
    const host = await caseHost();
    const fyRow = srcs.find(x => /^Fy/.test(x.sym)), lbRow = srcs.find(x => /^Lb|^KyLy/.test(x.sym));
    return { ok: !!ref && Math.abs(Number(ref.v) - 295) < 1e-6 && ref.tag === 'ai' && srcs.length >= 1 && (!fyRow || fyRow.tag === host.sources.fy),
      detail: `기준 응력 ${ref?.v} MPa · 출처 ${ref?.tag} · 시트의 출처 ${srcs.map(x => `${x.sym}:${x.tag}`).join(' · ')}${lbRow ? '' : ''}` };
  });
  // 사람이 편집 상태에서 정한 값을 AI 의 설계 도구가 바꾸면 — 「AI 가 바꾼 사람의 값」, 주지 않은 칸은 「AI: 주지 않음」
  await step('u41 편집 상태의 사람 값(Cb, 출처 지정) → AI 의 aisi_design_flexure(Cb 를 주지 않음) → Cb 「AI: 주지 않음」 · 「AI 가 바꾼 사람의 값」 · 새로 고침 없이', 'u41_ai_replaced', async () => {
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    await sleep(500);
    await wv(`D.querySelector('.tab-btn[data-tab="design"]').click(); return 1;`);
    await sleep(400);
    await wv(`const e=D.getElementById('design-Cb'); e.value='1.1'; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
    let h = null;
    for (let i = 0; i < 40 && h?.sources?.Cb !== 'user'; i++) { h = await caseHost(); await sleep(150); }
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    const flexB = await mcp.tool('aisi_design_flexure', { detail: 'full', Fy: 295, Fu: 400, Mu: 13.56, Vu: 13.3, Lb: 1524, design_method: 'LRFD', units: 'SI' });
    await settle(`s.caseIn && s.caseIn.rev>=${flexB.case_rev}`, '검토 상태의 새 판');
    await select('model', 'case:Cb');
    await sleep(300);
    const s = await ev(`({cb:[...document.querySelectorAll('#info tr[data-k="case:Cb"]')].map(t=>t.children[1].textContent.trim()+'|'+(t.querySelector('.tag[data-source]')||{}).dataset?.source)[0], rep:[...document.querySelectorAll('#info [data-replaced] li')].map(l=>l.dataset.key+':'+l.textContent)})`);
    const replaced = (flexB.case_inputs_replaced ?? []).map(x => x.key);
    return { ok: h?.sources?.Cb === 'user' && replaced.includes('Cb') && /AI: 주지 않음\|ai/.test(s.cb ?? '') && s.rep.some(x => /^Cb:/.test(x)),
      detail: `편집 상태 Cb → 호스트 ${h?.inputs?.Cb}(${h?.sources?.Cb}) · AI 응답 case_inputs_replaced ${JSON.stringify(replaced)} · 화면 「${s.cb}」 · 「AI 가 바꾼 사람의 값」 ${short(s.rep, 120)}` };
  });
  await step('u42 편집 상태(템플릿 09) — 띠 「이번 편집 — 바뀐 것 N」 · 설계 Fy 를 고치면 뒤의 트리 · 정보 창이 곧바로 · 제목 줄 ● · 저장하면 ● 가 사라진다', 'u42_edit_state', async () => {
    await select('model', 'mat');
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    await sleep(500);
    await wv(`D.querySelector('.tab-btn[data-tab="preprocessor"]').click(); return 1;`);
    await sleep(300);
    await wv(`const e=D.getElementById('design-fy')||D.getElementById('input-fy'); const t=D.getElementById('design-fy'); t.value='305'; t.dispatchEvent(new Event('input',{bubbles:true})); t.dispatchEvent(new Event('change',{bubbles:true})); return !!e;`);
    await waitFor(`!!${S}.state.caseIn && ${S}.state.caseIn.sources.fy==='user'`, 15_000, '호스트의 fy');
    await sleep(500);
    const st = await ev(`({strip:document.getElementById('editstrip').innerText, chips:[...document.querySelectorAll('#editstrip [data-change]')].map(c=>c.dataset.change), hidden:document.getElementById('editstrip').hidden,
      tree:[...document.querySelectorAll('#tree .row[data-k="case:fy"]')].map(r=>r.querySelector('[data-v]')?.dataset.v+'|'+r.querySelector('.tag[data-source]')?.dataset.source)[0], fname:document.querySelector('#tbar .fname').textContent})`);
    await shot('u42_edit_state_1920_dark');
    const host = await caseHost();
    const fySI = host.inputs.fy * US_TO_SI.stress;
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(300);
    const after = await ev(`({editing:${S}.ui.editing, sel:${S}.ui.sel, tab:${S}.ui.tab})`);
    const file = path.join(tmp, 'u4-saved.csd');
    const sv = await serve.ipc('save', { file }, 60_000);
    await waitFor(`document.querySelector('#tbar .fname').dataset.dirty==='0'`, 15_000, '저장 뒤 ● 사라짐');
    const fname2 = await ev(`document.querySelector('#tbar .fname').textContent`);
    return { ok: !st.hidden && st.chips.includes('fy') && /바뀐 것 [1-9]/.test(st.strip) && Math.abs(Number(st.tree?.split('|')[0]) - fySI) < 1e-6 && /\|user$/.test(st.tree ?? '') && /●$/.test(st.fname)
      && after.editing === false && after.sel === 'mat' && after.tab === 'model' && sv?.ok && !/●/.test(fname2),
      detail: `띠 「${short(st.strip.replace(/\s+/g, ' '), 80)}」 · 칩 ${st.chips.join(',')} · 트리 설계 Fy ${st.tree} (호스트 ${fySI.toFixed(3)} MPa) · 제목 「${st.fname}」 · Esc → 편집 ${after.editing} · 고른 것 ${after.tab}/${after.sel} 그대로 · 저장 ${sv?.ok} → 「${fname2}」` };
  });
  // 엔진 계약(b288448)의 표시 — 각 경우를 호스트 값과
  const cs = async (label, args) => { const r = await mcp.tool(args.tool, { detail: 'full', ...args.p, units: 'SI' }); check(`AI: ${label}`, !r.error, short(r.error ?? `판정 ${r.pass}`)); return r; };
  await cs('design_connection 볼트(e 가정 — J6.1 미평가가 지배)', { tool: 'design_connection', p: { connection_type: 'bolt', t1: 2.286, t2: 2.286, Fu: 400, Fy: 295, d: 12.7, n: 2, s: 38.1, Pu: 13.34, design_method: 'LRFD' } });
  await settle(`s.runs.some(r=>r.key==='conn' && r.rows.some(x=>x.id==='conn.j6.shear_rupture'))`, '볼트 결과');
  await step('u44a 무리의 지배가 미검토 — 「지배 — 미검토」 · 「미검토 (참고 판정비 r)」 · 「평가한 최대」 줄(머리 비로 쓰지 않는다)', 'u44a_governs_not_evaluated', async () => {
    const hc = await hostRes();
    const eng = hc.us.conn.design_checks.find(c => c.governs && c.governs_basis === 'not_evaluated' && c.highest_evaluated);
    const k = await keyOf(`x=>x.scope==='connection' && x.id===${JSON.stringify(eng?.id)}`);
    await ev(`${S}.openSheet(${JSON.stringify(k)})`);
    await sleep(400);
    const c = await ev(`(()=>{const c=document.querySelector('#sheet [data-card].on'); return {basis:c?.querySelector('[data-governs-basis]')?.dataset.governsBasis, gov:c?.querySelector('[data-governs-basis]')?.textContent, head:c?.querySelector('header')?.textContent, high:c?.querySelector('[data-highest]')?.dataset.highest};})()`);
    await ev(`${S}.closeSheet()`);
    await select('result', k);
    const inf = await ev(`({un:document.querySelector('#info [data-un-head]')?.textContent, big:!!document.querySelector('#info .hd .big [data-ratio]'), high:document.querySelector('#info [data-highest]')?.textContent})`);
    const rr = hc.connSI.design_checks.find(x => x.id === eng.id)?.reference?.ratio;
    const refTxt = typeof rr === 'number' ? /참고 판정비/.test(c.head ?? '') : true;
    return { ok: !!eng && c.basis === 'not_evaluated' && /지배 — 미검토/.test(c.gov ?? '') && c.high === eng.highest_evaluated.id && refTxt && /미검토/.test(inf.un ?? '') && !inf.big && /평가한 최대/.test(inf.high ?? ''),
      detail: `${eng?.id} · 「${c.gov}」 · 머리 「${short((c.head ?? '').replace(/\s+/g, ' '), 70)}」 · 평가한 최대 ${c.high}(엔진 ${eng?.highest_evaluated?.id}) · 정보 창 「${inf.un}」 머리 비 없음 ${!inf.big} · 「${short(inf.high, 60)}」` };
  });
  await cs('design_connection 두꺼운 볼트(적용범위 밖)', { tool: 'design_connection', p: { connection_type: 'bolt', t1: 6.35, t2: 6.35, Fu: 400, Fy: 295, d: 12.7, n: 2, s: 38.1, e: 25.4, Pu: 13.34, design_method: 'LRFD' } });
  await settle(`s.conn && s.runs.some(r=>r.key==='conn' && r.rows.some(x=>x.us && x.us.out_of_scope))`, '범위 밖 결과');
  await step('u44b 적용 범위 밖 항목 — 미검토, 그 수는 「참고 — 적용 범위 밖」으로만', 'u44b_out_of_scope', async () => {
    const hc = await hostRes();
    const eng = hc.us.conn.design_checks.find(c => c.out_of_scope && c.reference);
    const k = await keyOf(`x=>x.scope==='connection' && x.id===${JSON.stringify(eng?.id)}`);
    await ev(`${S}.openSheet(${JSON.stringify(k)})`);
    await sleep(400);
    const c = await ev(`(()=>{const c=document.querySelector('#sheet [data-card].on'); return {v:c?.dataset.verdict, head:c?.querySelector('header')?.textContent, ref:c?.querySelector('[data-reference]')?.textContent};})()`);
    const r = compareNumbers(await numbers('#sheet'), { ...(await mcpNow()), params: paramsS, ...hc });
    await ev(`${S}.closeSheet()`);
    return { ok: !!eng && c.v === 'not_evaluated' && /적용 범위 밖/.test(c.head ?? '') && /참고 — 적용 범위 밖/.test(c.ref ?? '') && r.bad.length === 0,
      detail: `${eng?.id}(out_of_scope ${eng?.out_of_scope}) · 「${short((c.head ?? '').replace(/\s+/g, ' '), 70)}」 · 「${short(c.ref, 70)}」 · 수 ${r.compared}개 = 호스트` };
  });
  await cs('design_connection 아크 스폿(비의 꼴)', { tool: 'design_connection', p: { connection_type: 'arc_spot', t1: 1.524, t2: 6.35, Fu: 400, Fy: 295, d: 19.05, n: 2, Pu: 13.34, Tu: 4.45, Fxx: 482.6, design_method: 'LRFD' } });
  await settle(`s.runs.some(r=>r.key==='conn' && r.rows.some(x=>x.us && x.us.ratio_form))`, '아크 스폿 결과');
  await step('u44c 비의 꼴(ratio_form) — 원문 좌변 · 견줄 비 · 꼴을 함께', 'u44c_ratio_form', async () => {
    const hc = await hostRes();
    const eng = hc.us.conn.design_checks.find(c => c.ratio_form);
    const k = await keyOf(`x=>x.scope==='connection' && x.id===${JSON.stringify(eng?.id)}`);
    await ev(`${S}.openSheet(${JSON.stringify(k)})`);
    await sleep(400);
    const c = await ev(`(()=>{const c=document.querySelector('#sheet [data-card].on'); return {rf:c?.querySelector('[data-ratio-form]')?.dataset.ratioForm, fin:c?.querySelector('[data-final]')?.textContent ?? c?.textContent};})()`);
    await ev(`${S}.closeSheet()`);
    return { ok: !!eng && c.rf === eng.ratio_form && /원문 좌변|견줄 비|비의 꼴/.test(c.fin ?? ''), detail: `${eng?.id} · 꼴 ${c.rf} = 엔진 ${eng?.ratio_form} · 「${short((c.fin ?? '').replace(/\s+/g, ' '), 90)}」` };
  });
  await cs('aisi_design_flexure Lb 0(횡좌굴 없음 — 끝없는 값)', { tool: 'aisi_design_flexure', p: { Fy: 295, Fu: 400, Mu: 6.78, Vu: 8.9, Lb: 0, design_method: 'LRFD' } });
  await settle(`s.runs.some(r=>r.key==='design' && r.rows.some(x=>JSON.stringify(x.us).includes('"unbounded":true')))`, '끝없는 값');
  await step('u44d 끝없는 값(unbounded) — 「∞」, SI 로 바꾸지 않는다', 'u44d_unbounded', async () => {
    const k = await keyOf(`x=>x.scope==='member' && JSON.stringify(x.us).includes('"unbounded":true')`);
    await ev(`${S}.openSheet(${JSON.stringify(k)})`);
    await sleep(400);
    const n = await ev(`[...document.querySelectorAll('#sheet [data-card].on [data-unbounded]')].map(x=>x.textContent)`);
    const bad = await ev(`/1000000|1e\\+6|6894757/.test(document.getElementById('sheet').textContent)`);
    await ev(`${S}.closeSheet()`);
    return { ok: n.length >= 1 && n.every(x => x === '∞') && !bad, detail: `${k} · ∞ ${n.length}곳 · 1e6 · 그 SI 값이 글에 없음 ${!bad}` };
  });
  await cs('design_lap_connection Mnd 없이', { tool: 'design_lap_connection', p: { d: 200, t: 2.3, Fy: 295, Fu: 400, lap_left_in: 600, lap_right_in: 600, Mu_support: 11.98, Vu_support: 11.12,
    fastener_type: 'bolt', fastener_dia: 12.7, n_rows: 2, end_distance: 35.56, design_method: 'LRFD', Se: 49160, Vn: 44.48 } });
  await settle(`s.lap && s.runs.some(r=>r.key==='lap' && r.rows.some(x=>x.id==='lap.block_shear'))`, '랩 결과');
  await step('u44e 랩 — 블록 전단 항목의 판정 = 엔진 · 뒤틀림 미검토의 까닭(랩 구간 구속 진술 없음 등) = 엔진의 글 그대로', 'u44e_lap', async () => {
    const hc = await hostRes();
    const bs = hc.us.lap.design_checks.find(c => c.id === 'lap.block_shear');
    const ld = hc.us.lap.design_checks.find(c => c.id === 'lap.flexure.distortional');
    const k = await keyOf(`x=>x.scope==='lap' && x.id==='lap.block_shear'`);
    await select('result', k);
    const inf = await ev(`({scope:[...document.querySelectorAll('#info .sec')].filter(s=>/범위/.test(s.querySelector('h4')?.textContent??'')).map(s=>s.textContent).join(' '), rows:[...document.querySelectorAll('#info tr[data-id]')].map(t=>t.dataset.id+':'+t.lastElementChild.textContent.trim())})`);
    await ev(`${S}.openSheet(${JSON.stringify(await keyOf(`x=>x.scope==='lap' && x.id==='lap.flexure.distortional'`))})`);
    await sleep(300);
    const reason = await ev(`document.querySelector('#sheet [data-card].on [data-reason]')?.textContent`);
    await ev(`${S}.closeSheet()`);
    // 엔진이 낸 그대로(65e5ed6 · 17ad004 뒤 블록 전단은 평가되고, 뒤틀림은 「랩 구간 구속 진술 없음」으로 미검토) — 화면의 판정 · 까닭 = 엔진
    const KO = { pass: 'OK', fail: 'NG', not_evaluated: '미검토', not_applicable: '해당 없음' };
    const bsRow = inf.rows.find(x => x.startsWith('lap.block_shear:')) ?? '';
    const bsOk = bs?.verdict === 'not_evaluated' ? /^lap\.block_shear:미검토/.test(bsRow) : bsRow.includes(KO[bs?.verdict] ?? '?') || /\d/.test(bsRow);
    return { ok: !!bs && bsOk && ld?.verdict === 'not_evaluated' && reason === engReason(ld) && reason.length > 10 && !US_NUM.test(reason),
      detail: `블록 전단 ${bs?.verdict}(counts ${bs?.counts}) → 정보 창 「${short(bsRow, 50)}」 · 범위 글에 J6.3 ${/J6\.3/.test(inf.scope)} · 뒤틀림 ${ld?.verdict} 「${short(reason, 90)}」 = 엔진의 까닭` };
  });
  // AI 의 load_project 가 저장하지 않은 변경을 버리면 — 막지 않고 알린다
  await step('u45 저장하지 않은 변경이 있는데 AI 가 load_project — 막지 않고 화면에 알린다(caseDiscarded)', 'u45_discarded', async () => {
    await mcp.tool('set_case_inputs', { inputs: { Lb: 1600 }, units: 'SI', reason: '시험' });
    await waitFor(`document.querySelector('#tbar .fname').dataset.dirty==='1'`, 10_000, '더러움');
    const lp = await mcp.tool('load_project', { filepath: csd });
    const seen = await waitFor(`(()=>{const t=[...document.querySelectorAll('#status .toast')].map(t=>t.textContent).find(t=>/저장하지 않은 변경을 버리고/.test(t)); const c=${S}.state.lastChange; return t || (c && /버리고 열었다/.test(c.text) ? '(상태 줄) '+c.text : null);})()`, 15_000, '알림').catch(() => null);
    return { ok: !lp.error && !!lp.discarded_unsaved_changes && !!seen, detail: `load_project ${lp.error ? lp.error : '성공'} · discarded ${short(lp.discarded_unsaved_changes, 80)} · 알림 「${short(seen, 70)}」` };
  });
  // 그림 — 편집 상태 · 모델 탭 · 제목 줄 ● — 1920 · 960, 어두운 · 밝은
  await mcp.tool('set_case_inputs', { inputs: { Lb: 1500 }, units: 'SI', reason: '그림' });
  for (const [w, h] of [[1920, 1080], [960, 900]]) {
    W = w; H = h;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    for (const th of ['dark', 'light']) {
      await ev(`${S}.setTheme(${JSON.stringify(th)})`);
      await step(`u46 그림 ${w}px · ${th === 'dark' ? '어두운' : '밝은'} — 모델 탭(부재 · 출처) · 편집 상태 · 제목 줄 ●`, null, async () => {
        await select('model', 'mem');
        await sleep(300);
        await shot(`u46_model_${w}_${th}`);
        await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
        await sleep(600);
        await wv(`D.querySelector('.tab-btn[data-tab="loads"]').click(); return 1;`);
        await sleep(500);
        await shot(`u46_edit_${w}_${th}`);
        await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
        await sleep(300);
        const s = await ev(`({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth})`);
        return { ok: s.sw <= s.cw, detail: `scrollWidth ${s.sw}/${s.cw}` };
      });
    }
  }
  await ev(`${S}.setTheme('dark')`);
  W = 1920; H = 1080;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  // ── U5 — 호스트가 만든 점검 · 계산서(K3) ─────────────────────────────────────────────
  section('7f. U5 — 점검(validate_design) · 계산서 · 좌굴 해석 보고서(generate_report) · 출처 꼬리표 · 가정의 자리');
  const valMcp = async () => { const r = await mcp.tool('validate_design', { detail: 'full', units: 'SI' }); return r?.json ?? r; };
  /** 화면의 점검 표 · 트리 = 호스트의 validate_design(같은 차례 · id · 판정 · 글 · 수) */
  const valCompare = async () => {
    const host = await valMcp();
    // MCP 의 validate_design 은 호스트가 그 점검을 화면에도 보낸다(by ai) — 화면이 그 판을 읽을 때까지
    await settle(`!!s.val && s.val.caseRev===${JSON.stringify(host.case_rev ?? null)} && s.val.items.length===${(host.items ?? []).length}`, '화면의 점검 = 호스트', 15_000).catch(() => undefined);
    await sleep(300);
    const scr = await ev(`[...document.querySelectorAll('#center table.valt tr.vr')].map(tr=>({k:tr.dataset.k, id:tr.dataset.id, status:tr.dataset.status, item:tr.children[1].textContent, value:tr.querySelector('[data-value]').textContent, criterion:tr.querySelector('[data-criterion]').textContent,
      note:(tr.nextElementSibling && tr.nextElementSibling.classList.contains('vn') ? tr.nextElementSibling.querySelector('[data-note]').textContent.replace(/^→ /,'') : '')}))`);
    const items = host.items ?? [];
    const bad = [];
    if (scr.length !== items.length) { bad.push(`줄 수 ${scr.length} ≠ ${items.length}`); }
    items.forEach((it, i) => {
      const s = scr[i];
      if (!s) { return; }
      for (const f of ['id', 'status', 'item', 'value', 'criterion', 'note']) {
        const want = String(it[f] ?? '');
        if (String(s[f] ?? '') !== want) { bad.push(`${i} ${f}: 「${String(s[f]).slice(0, 40)}」 ≠ 「${want.slice(0, 40)}」`); }
      }
    });
    const cnt = { pass: 0, warn: 0, fail: 0 };
    items.forEach(it => { cnt[it.status] = (cnt[it.status] ?? 0) + 1; });
    const tree = await ev(`(()=>{const r=document.querySelector('#tree .row[data-k="val"] .vl'); return r?r.textContent:null;})()`);
    const ko = { fail: '실패', warn: '주의', pass: '통과' };
    const wantTree = ['fail', 'warn', 'pass'].filter(s => cnt[s]).map(s => `${ko[s]} ${cnt[s]}`).join(' · ');
    if (!tree || !tree.endsWith(wantTree)) { bad.push(`트리 수 「${tree}」 ≠ 「${wantTree}」`); }
    for (const s of ['pass', 'warn', 'fail']) { if ((host.counts?.[s] ?? 0) !== cnt[s]) { bad.push(`호스트 counts.${s} ${host.counts?.[s]} ≠ 항목 ${cnt[s]}`); } }
    return { bad, host, scr, cnt, tree };
  };
  const flexArgs = (Mu, Vu = 8.9) => ({ detail: 'full', Fy: 295, Fu: 400, Mu, Vu, Lb: 1524, design_method: 'LRFD', units: 'SI' });
  // 판정 없음: 소요가 없으면(Mu 0 · V 0) 엔진이 휨 항목을 미평가로 낸다(K3 고정값 notEvaluated 와 같은 꼴)
  for (const [label, Mu, Vu, shotName] of [['합격(Mu 6.78 kN·m)', 6.78, 8.9, 'u50_val_pass'], ['불합격(Mu 271 kN·m)', 271, 8.9, 'u50_val_fail'], ['판정 없음(Mu 0 · V 0)', 0, 0, 'u50_val_noverdict']]) {
    await step(`u50 점검 — ${label}: 화면의 항목(차례 · id · 판정 · 값 · 기준 · 주석) · 트리의 수 = 호스트 validate_design`, shotName, async () => {
      const r = await mcp.tool('aisi_design_flexure', flexArgs(Mu, Vu));
      const ne = (r.design_checks ?? []).filter(c => c.verdict === 'not_evaluated' && /^member\.flexure/.test(c.id)).length;
      await settle(`s.runs.some(x=>x.key==='design')`, '휨 결과');
      await sleep(600);
      await ev(`${S}.validate()`);
      await settle(`!!s.val && !s.valRunning`, '점검');
      await select('result', 'val');
      await sleep(300);
      const c = await valCompare();
      const st = await ev(`${S}.state.stages.val`);
      const strip = await ev(`document.querySelector('#tbar [data-stage="val"]')?.dataset.state ?? null`);
      const kindOk = Mu === 0 ? ne > 0 : Mu > 100 ? r.pass === false : r.pass === true;
      return { ok: !r.error && kindOk && c.bad.length === 0 && c.scr.length > 10 && st.state === 'ok' && strip === 'ok',
        detail: `엔진 판정 ${r.pass} · 미평가 휨 항목 ${ne} · 항목 ${c.scr.length} = 호스트 ${c.host.items?.length} · 수 ${JSON.stringify(c.cnt)} · 트리 「${c.tree}」 · 진행 띠 「점검」 ${strip}(${short(st.note, 50)})${c.bad.length ? ` · ${c.bad.slice(0, 3).join(' / ')}` : ''}` };
    });
  }
  await step('u51 점검 항목을 고르면 정보 창 = 그 항목(id · 판정 · 값 · 기준 · 주석) · 분류를 고르면 분류의 수', 'u51_val_item', async () => {
    const host = await valMcp();
    const it = host.items.find(x => x.status !== 'pass' && x.note) ?? host.items[0];
    const k = await ev(`(()=>{const tr=[...document.querySelectorAll('#center tr.vr')].find(t=>t.dataset.id===${JSON.stringify(it.id)}); return tr?tr.dataset.k:null;})()`);
    await select('result', k);
    await sleep(300);
    const inf = await ev(`({id:document.querySelector('#info [data-val-id]')?.textContent, st:document.querySelector('#info .hd [data-status]')?.dataset.status, v:document.querySelector('#info [data-value]')?.textContent,
      c:document.querySelector('#info [data-criterion]')?.textContent, n:document.querySelector('#info [data-note]')?.textContent, treeOn:document.querySelector('#tree .row.on')?.dataset.k, rowOn:document.querySelector('#center tr.vr.on')?.dataset.k})`);
    await select('result', 'val:cat:0');
    await sleep(200);
    const catHost = host.items.filter(x => x.category === host.items[0].category);
    const cat = await ev(`({total:document.querySelector('#info [data-count="total"]')?.textContent, ttl:document.querySelector('#info .ttl')?.textContent})`);
    return { ok: inf.id === it.id && inf.st === it.status && inf.v === (it.value || '—') && inf.c === (it.criterion || '—') && inf.n === it.note && inf.treeOn === k && inf.rowOn === k && Number(cat.total) === catHost.length && cat.ttl === host.items[0].category,
      detail: `${it.id} · ${it.status} · 「${short(it.note, 50)}」 · 트리 · 표가 같은 줄 ${inf.treeOn === k && inf.rowOn === k} · 분류 「${cat.ttl}」 ${cat.total} 항목 = 호스트 ${catHost.length}` };
  });
  await step('u52 점검 뒤 입력이 바뀌면 진행 띠 「점검」 · 트리 · 정보 창이 낡음(무엇이 바뀌었는지) — 다시 점검하면 일치', 'u52_val_stale', async () => {
    const before = await ev(`${S}.state.stages.val.state`);
    const sc = await mcp.tool('set_case_inputs', { inputs: { Cb: 1.15 }, units: 'SI', reason: '점검 낡음 시험' });
    await settle(`s.stages.val.state==='stale'`, '점검 낡음');
    await select('result', 'val');
    const a = await ev(`({st:${S}.state.stages.val, banner:document.querySelector('#center [data-val-stale]')?.textContent, tree:document.querySelector('#tree .row[data-k="val"] .vl')?.textContent, strip:document.querySelector('#tbar [data-stage="val"]')?.dataset.state})`);
    await shot('u52_val_stale_1920_dark');
    await ev(`document.querySelector('#center [data-act="val-run"]').click()`);
    await settle(`!!s.val && !s.valRunning && s.stages.val.state==='ok'`, '다시 점검');
    const c = await valCompare();
    const b = await ev(`${S}.state.stages.val`);
    return { ok: before === 'ok' && sc.success === true && a.st.state === 'stale' && /점검 뒤 바뀌었다/.test(a.st.note) && /점검 뒤 바뀌었다/.test(a.banner ?? '') && /^낡음/.test(a.tree ?? '') && a.strip === 'stale' && b.state === 'ok' && c.bad.length === 0,
      detail: `앞 ${before} → set_case_inputs → ${a.st.state}(「${short(a.st.note, 70)}」) · 트리 「${short(a.tree, 30)}」 → 「점검 실행」 → ${b.state} · 항목 = 호스트 ${c.bad.length === 0}` };
  });
  await step('u53 편집 상태의 검증 탭에서 「설계 검증 실행」 → 이 화면의 점검도 다시 읽힌다(호스트가 그 페이지에 보낸 validationResult)', null, async () => {
    await mcp.tool('set_case_inputs', { inputs: { Cb: 1.2 }, units: 'SI', reason: '점검 낡음 시험 2' });
    await settle(`s.stages.val.state==='stale'`, '점검 낡음');
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    await sleep(500);
    await wv(`D.querySelector('.tab-btn[data-tab="validation"]').click(); return 1;`);
    await sleep(300);
    await wv(`D.getElementById('btn-run-validation').click(); return 1;`);
    await settle(`!!s.val && s.val.by==='page' && s.stages.val.state==='ok'`, '페이지의 검증으로 다시 읽음');
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    const pageRows = await wv(`return D.getElementById('validation-container').querySelectorAll('tr').length;`);
    return { ok: pageRows > 10, detail: `페이지의 검증 표 ${pageRows}줄 · 이 화면 점검 by page · 일치` };
  });
  // 계산서 — 호스트가 쓴 HTML 파일 = 미리보기(sandbox iframe 의 srcdoc), 스크립트는 돌지 않는다, PDF 는 호스트의 보이지 않는 인쇄
  await mcp.tool('aisi_design_flexure', flexArgs(6.78));
  await settle(`s.runs.some(x=>x.key==='design')`, '휨 결과');
  await step('u54 문서 탭 · 계산서 — 「만들기」 → 호스트가 열린 .csd 의 폴더에 쓴 HTML = 미리보기(sha256) · sandbox="" · 쓴 곳 · 발행 · 검토 도장은 꺼짐(까닭)', 'u54_report', async () => {
    await select('doc', 'rpt');
    await ev(`document.querySelector('#center [data-act="rpt-make"]').click()`);
    await settle(`!!s.reports.design && !!s.reports.design.html`, '계산서', 120_000);
    await sleep(500);
    const fr = await ev(`(async()=>{const f=document.querySelector('#center iframe.rframe'); const html=f.getAttribute('srcdoc'); const h=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
      return {sandbox:f.getAttribute('sandbox'), sandboxTokens:f.sandbox.length, sha:[...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join(''), attrSha:f.dataset.sha256, len:html.length};})()`);
    const rep = await ev(`${S}.state.reports.design.reply`);
    const file = rep?.files?.html;
    const disk = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const diskSha = disk ? crypto.createHash('sha256').update(disk, 'utf8').digest('hex') : null;
    const inf = await ev(`({folder:document.querySelector('#info [data-report-folder]')?.dataset.reportFolder, files:[...document.querySelectorAll('#info tr[data-file]')].map(t=>t.dataset.file+':'+t.querySelector('.path').textContent), pub:!!document.querySelector('#info [data-publish].off'), stamp:!!document.querySelector('#info .rv.off'), tree:document.querySelector('#tree .row[data-k="rpt"] .vl')?.textContent})`);
    const inCaseFolder = !!file && path.dirname(file).toLowerCase() === path.dirname(csd).toLowerCase();
    return { ok: fr.sandbox === '' && fr.sandboxTokens === 0 && !!diskSha && fr.sha === diskSha && fr.attrSha === diskSha && rep.folder === 'case_folder' && inCaseFolder && inf.folder === 'case_folder'
      && inf.files.some(x => x.startsWith('HTML:') && x.includes(path.basename(file))) && inf.pub && inf.stamp && /^초안/.test(inf.tree ?? ''),
      detail: `파일 ${path.basename(file ?? '')}(열린 .csd 의 폴더 ${inCaseFolder}) · 미리보기 sha256 ${fr.sha?.slice(0, 12)} = 파일 ${diskSha?.slice(0, 12)} · sandbox="${fr.sandbox}"(토큰 ${fr.sandboxTokens}) · ${fr.len}자 · 절 ${rep.sections?.length} · 트리 「${inf.tree}」 · 발행 · 도장 꺼짐 ${inf.pub && inf.stamp}` };
  });
  await step('u55 미리보기 틀은 스크립트를 돌리지 않는다 — 제품이 그린 iframe(sandbox="")에 스크립트 · onerror · 바깥 요청을 넣어도 실행 0 · 바깥 문서에 닿지 않음', null, async () => {
    const m0 = log.console.length;
    await ev(`(()=>{window.__k3ran=0; window.addEventListener('message', e=>{ if(e.data==='ran'||e.data==='ran2'||e.data==='ran3') window.__k3ran++; }); return 1;})()`);
    await ev(`(()=>{const f=document.querySelector('#center iframe.rframe'); f.setAttribute('srcdoc', '<p>시험</p><script>parent.postMessage(\\'ran\\',\\'*\\'); try{parent.document.title=\\'x\\'}catch(e){}<\\/script><img src="x" onerror="parent.postMessage(\\'ran2\\',\\'*\\')"><script src="/ui/dist/main.js"><\\/script><svg onload="parent.postMessage(\\'ran3\\',\\'*\\')"></svg>'); return 1;})()`);
    await sleep(1500);
    const ran = await ev(`window.__k3ran`);
    const title = await ev(`document.title`);
    const blocked = log.console.slice(m0).filter(x => /Blocked script execution in 'about:srcdoc'|sandboxed and the 'allow-scripts' permission is not set/.test(x.text));
    // 막힌 실행의 알림(Chromium 의 콘솔 줄)은 바라던 결과 — 이 단계의 콘솔 오류 검사에서 뺀다(그 수를 증거로 적는다)
    log.console.splice(m0, log.console.length - m0, ...log.console.slice(m0).filter(x => !blocked.includes(x)));
    await ev(`${S}.select('doc','brpt')`); await ev(`${S}.select('doc','rpt')`);
    const sb = await ev(`(()=>{const f=document.querySelector('#center iframe.rframe'); return f ? {attr:f.getAttribute('sandbox'), n:f.sandbox.length} : null;})()`);
    return { ok: ran === 0 && title !== 'x' && sb?.attr === '' && sb.n === 0,
      detail: `실행 ${ran}(인라인 스크립트 · 같은 출처 스크립트 파일 · img onerror · svg onload) · 바깥 제목 그대로 · 틀 sandbox="${sb?.attr}"(허락 ${sb?.n}) · 콘솔에 남은 막힘 알림 ${blocked.length}건` };
  });
  await step('u56 「PDF 저장」 — 호스트의 길(보이지 않는 Edge 인쇄)로 같은 폴더에 PDF · 쪽 수 = 파일의 쪽', 'u56_report_pdf', async () => {
    await select('doc', 'rpt');
    await ev(`document.querySelector('#center [data-act="rpt-pdf"]').click()`);
    await settle(`!!s.reports.design && !!s.reports.design.pdfAt && !!(s.reports.design.reply.files||{}).pdf`, 'PDF', 180_000);
    const rep = await ev(`${S}.state.reports.design.reply`);
    const pdf = rep.files.pdf;
    const buf = fs.existsSync(pdf) ? fs.readFileSync(pdf) : null;
    const pages = buf ? (buf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) || []).length : 0;
    const shown = await ev(`[...document.querySelectorAll('#info tr[data-file="PDF"]')].map(t=>t.textContent)[0]`);
    return { ok: !!buf && buf.slice(0, 5).toString() === '%PDF-' && pages >= 1 && rep.pages === pages && path.dirname(pdf).toLowerCase() === path.dirname(csd).toLowerCase() && new RegExp(`${pages}쪽`).test(shown ?? ''),
      detail: `${path.basename(pdf)} · ${Math.round((buf?.length ?? 0) / 1024)} KB · 쪽 ${rep.pages} = 파일 ${pages} · 정보 창 「${short(shown, 80)}」` };
  });
  await step('u57 좌굴 해석 보고서 — 호스트가 쓴 파일 = 미리보기(화면 없이 만든 것이라 서명곡선 SVG 와 그 말)', 'u57_buckling_report', async () => {
    await mcp.tool('set_load_case', { load_case: 'bending_xx_pos', fy: 295, units: 'SI' });
    await mcp.tool('run_analysis', {});
    await settle(`s.stages.fsm.state==='ok'`, '좌굴 해석', 240_000);
    await select('doc', 'brpt');
    await ev(`document.querySelector('#center [data-act="rpt-make"]').click()`);
    await settle(`!!s.reports.buckling && (!!s.reports.buckling.html || !!s.reports.buckling.error)`, '좌굴 보고서', 120_000);
    const r = await ev(`${S}.state.reports.buckling`);
    const disk = r.reply?.files?.html && fs.existsSync(r.reply.files.html) ? fs.readFileSync(r.reply.files.html, 'utf8') : null;
    const sha = await ev(`(async()=>{const f=document.querySelector('#center iframe.rframe'); const h=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(f.getAttribute('srcdoc'))); return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');})()`);
    const diskSha = disk ? crypto.createHash('sha256').update(disk, 'utf8').digest('hex') : null;
    return { ok: !r.error && !!disk && sha === diskSha && /<svg/i.test(disk), detail: `${path.basename(r.reply?.files?.html ?? '')} · sha256 일치 ${sha === diskSha} · SVG ${/<svg/i.test(disk ?? '')} · ${r.error ?? ''}` };
  });
  await step('u58 출처 꼬리표 — 꼬리표의 말은 호스트 sources 의 값마다 하나(mirror = 「연동」, 「재료」 아님) · β · 냉간가공의 출처를 적는다', null, async () => {
    await select('model', 'dc');
    await sleep(300);
    const host = await caseHost();
    const tags = await ev(`[...document.querySelectorAll('#info .tag[data-source]')].map(t=>({src:t.dataset.source, t:t.textContent}))`);
    const label = { default: '기본값', user: '지정', ai: 'AI', file: '파일', 'load-analysis': '하중 해석', mirror: '연동' };
    const wrong = tags.filter(x => label[x.src] !== undefined && label[x.src] !== x.t);
    return { ok: wrong.length === 0 && tags.length > 5,
      detail: `꼬리표 ${tags.length}개 — 말 어긋남 ${wrong.length} · 호스트 sources: chkBetaDist=${host.sources?.chkBetaDist}(값 ${host.inputs?.chkBetaDist}) · chkColdWork=${host.sources?.chkColdWork}(값 ${host.inputs?.chkColdWork}) · 연동 꼬리표 ${tags.filter(x => x.src === 'mirror').length}` };
  });
  await step('u59 가정 가지 — 줄마다 어느 결과 · 구간 · 검토 지점의 것인지(엔진의 글은 그대로)', 'u59_assumptions', async () => {
    await mcp.tool('design_purlin', purlinArgs);
    await settle(`s.regions.length>0`, '퍼린 결과');
    await select('model', 'asm');
    await sleep(300);
    const t = await ev(`({tree:[...document.querySelectorAll('#tree .row[data-k^="asm:"]')].map(r=>r.querySelector('.nm').textContent).filter(x=>!/프로그램 기본/.test(x)), info:[...document.querySelectorAll('#info li[data-asm-where]')].map(l=>l.dataset.asmWhere)})`);
    const bare = t.tree.filter(x => !/ — /.test(x));
    return { ok: t.tree.length > 0 && bare.length === 0 && t.info.length === t.tree.length && t.info.every(Boolean), detail: `가정 ${t.tree.length}줄 · 자리 없는 줄 ${bare.length} · 예: 「${short(t.tree[0], 90)}」` };
  });
  await step('u60 엔진의 글(K4b) — 화면에 보인 경고 · 가정 · 범위 · 미검토 · 범위 밖 · 이유 = notices.js(한국어 · SI) · code 를 단다 · SI 글에 US 수 없음(엔진에 알림이 없는 글은 목록으로)', null, async () => {
    // 지금 화면이 쥔 결과마다(퍼린 · 랩 · 접합 …) 정보 창을 차례로 열어 보인 글을 모은다
    const keys = await ev(`${S}.state.runs.map(r=>{const w=r.rows.find(x=>x.kind==='ne'||x.kind==='na')||r.rows[0]; return w?w.key:null;}).filter(Boolean)`);
    const seen = [];
    for (const k of keys) {
      await select('result', k);
      seen.push(...await ev(`[...document.querySelectorAll('#info li, #info [data-reason], #center tr.out td.faint')].map(e=>({t:e.textContent.trim(), code:e.closest('[data-code]')?.dataset.code ?? null})).filter(x=>x.t)`));
    }
    const hangul = /[가-힣]/;
    const usLeft = seen.filter(x => US_NUM.test(x.t));
    const english = [...new Set(seen.filter(x => !hangul.test(x.t.replace(/^\[[^\]]*\]\s*/, ''))).map(x => `${x.code ?? '(code 없음)'}: ${short(x.t, 70)}`))];
    const coded = seen.filter(x => x.code).length;
    return { ok: seen.length > 0 && usLeft.length === 0 && coded > 0,
      detail: `글 ${seen.length}줄 · code ${coded} · SI 글의 US 수 ${usLeft.length}${usLeft.length ? ` 「${short(usLeft[0].t, 80)}」` : ''} · 한국어가 아닌 글 ${english.length}${english.length ? ` — ${english.join(' | ')}` : ''}` };
  });
  await step('u5a V7-43 — 편집 중에 AI 만 바꾸면 「이번 편집 — 바뀐 것 0」, AI 가 바꾼 값은 오른쪽에 「AI」 칩으로 따로 · 사람이 고친 것만 왼쪽', 'u5a_edit_ai_chips', async () => {
    await select('model', 'dc');
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    await sleep(500);
    const sc = await mcp.tool('set_case_inputs', { inputs: { Lb: 1778, Cb: 1.3 }, units: 'SI', reason: 'V7-43' });
    await settle(`s.caseIn && s.caseIn.rev>=${sc.rev}`, '검토 상태');
    await sleep(300);
    const a = await ev(`({head:document.querySelector('#editstrip b')?.textContent, person:[...document.querySelectorAll('#editstrip [data-change]')].map(c=>c.dataset.change), ai:[...document.querySelectorAll('#editstrip [data-ai-change]')].map(c=>c.dataset.aiChange), wait:document.querySelector('#editstrip [data-ai-waiting]')?.textContent})`);
    await wv(`D.querySelector('.tab-btn[data-tab="design"]').click(); const e=D.getElementById('design-Cb'); e.value='1.05'; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
    await waitFor(`${S}.state.caseIn && ${S}.state.caseIn.sources.Cb==='user'`, 15_000, '사람의 Cb');
    await sleep(400);
    const b = await ev(`({head:document.querySelector('#editstrip b')?.textContent, person:[...document.querySelectorAll('#editstrip [data-change]')].map(c=>c.dataset.change), ai:[...document.querySelectorAll('#editstrip [data-ai-change]')].map(c=>c.dataset.aiChange)})`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}))`);
    return { ok: sc.success === true && a.head === '이번 편집 — 바뀐 것 0' && a.person.length === 0 && a.ai.includes('Lb') && a.ai.includes('Cb') && /AI 가 바꿈 2/.test(a.wait ?? '')
      && b.person.includes('Cb') && !b.ai.includes('Cb') && b.ai.includes('Lb'),
      detail: `AI 만: 「${a.head}」 · 사람 ${JSON.stringify(a.person)} · AI ${JSON.stringify(a.ai)} · 「${short(a.wait, 40)}」 → 사람이 Cb: 사람 ${JSON.stringify(b.person)} · AI ${JSON.stringify(b.ai)}` };
  });
  await step('u5b V7-41 — 브라우저 길: 저장 안 한 변경이 있는데 끼운 화면의 Open(새 화면의 Ctrl+O 도 이것을 누른다) → 다리가 먼저 묻는다 · 「취소」 = 열기 물음 없음 · 「저장 안 함」 = 열기 물음', 'u5b_page_open_guard', async () => {
    await mcp.tool('set_case_inputs', { inputs: { Lb: 1600 }, units: 'SI', reason: 'V7-41' });
    const ask = () => waitFor(`(()=>{const d=document.querySelector('#dialog-host .dialog'); return d && /저장하지 않은 변경/.test(d.textContent) ? d.textContent : null;})()`, 15_000, '저장 안 한 변경 물음');
    const click = item => ev(`(()=>{const b=document.querySelector('#dialog-host [data-item="${item}"]'); if(b){b.click(); return true;} return false;})()`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'o',ctrlKey:true,bubbles:true}))`);
    const q1 = await ask();
    await click('취소');
    await sleep(1200);
    const fd1 = await ev(`!!document.querySelector('#dialog-host .dialog[data-kind="fileDialog"]')`);
    const d1 = (await caseHost()).dirty;
    await wv(`D.getElementById('btn-file-open').click(); return 1;`);
    await ask();
    await click('저장 안 함');
    const fd2 = await waitFor(`!!document.querySelector('#dialog-host .dialog[data-kind="fileDialog"]')`, 15_000, '열기 물음').catch(() => false);
    await ev(`(()=>{const d=document.querySelector('#dialog-host .dialog[data-kind="fileDialog"]'); const c=d&&(d.querySelector('[data-role="cancel"]')||[...d.querySelectorAll('button,[data-item]')].find(b=>/취소/.test(b.textContent))); c&&c.click(); return !!c;})()`);
    await sleep(500);
    return { ok: /저장하지 않은 변경/.test(q1) && !fd1 && d1 === true && !!fd2, detail: `Ctrl+O → 물음 「${short(q1, 50)}」 → 취소: 열기 물음 ${fd1} · 더러움 ${d1} · Open 단추 → 저장 안 함 → 열기 물음 ${fd2}` };
  });
  // ── 4b99968 — 호스트가 쥔 점검 · 보기 계약의 validation · 글 방향 문자 · 결과 봉인 ─────────────
  await step('u5c AI 의 validate_design → 이 화면이 누르지 않아도 점검이 보인다(by ai) · 새로 고쳐도 마지막 점검(호스트의 results.validation + 다리가 남긴 항목)', 'u5c_val_ai', async () => {
    const r = await valMcp();
    const got = await settle(`!!s.val && s.val.by==='ai' && s.stages.val.state==='ok'`, 'AI 의 점검').then(() => true, () => false);
    if (!got) {
      const fx = await mcp.tool('get_full_state');
      return { ok: false, detail: `AI 의 점검이 화면에 없다 · validate_design 판 ${r.case_rev} · 호스트 판 ${fx?.case?.rev} · results.validation ${JSON.stringify(fx?.results?.validation ?? null)} · 장부 ${JSON.stringify((fx?.invalidated ?? []).filter(e => e.kind === 'validation').slice(-2).map(e => [e.reason, e.cause, e.invalidated_at]))} · 화면 ${JSON.stringify(await ev(`({val:!!${S}.state.val, by:${S}.state.val&&${S}.state.val.by, st:${S}.state.stages.val})`))}` };
    }
    await select('result', 'val');
    const a = await ev(`({by:document.querySelector('#info [data-val-by]')?.dataset.valBy, n:document.querySelectorAll('#center tr.vr').length})`);
    const ciBefore = await caseHost();
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitFor(`!!window.__stcfsdUi && window.__stcfsdUi.state.ready && window.__stcfsdUi.state.full`, 60_000, '다시 실림');
    await ev(`${S}.review()`);
    await sleep(1500);
    const ciAfter = await caseHost();
    const reloadDiff = Object.keys(ciAfter?.inputs ?? {}).filter(k => JSON.stringify(ciBefore?.inputs?.[k]) !== JSON.stringify(ciAfter.inputs[k]) || ciBefore?.sources?.[k] !== ciAfter.sources?.[k])
      .map(k => `${k}: ${JSON.stringify(ciBefore?.inputs?.[k])}(${ciBefore?.sources?.[k]}) → ${JSON.stringify(ciAfter.inputs[k])}(${ciAfter.sources?.[k]})`);
    const spansDiff = JSON.stringify(ciBefore?.spans) !== JSON.stringify(ciAfter?.spans);
    const trace = [`reload: 판 ${ciBefore?.rev} → ${ciAfter?.rev} · 바뀐 칸 ${JSON.stringify(reloadDiff)} · 경간 표 바뀜 ${spansDiff}`];
    const t0r = Date.now();
    let back = false;
    for (let i = 0; i < 30 && !back; i++) {
      const x = await ev(`(()=>{const s=${S}.state; return {val:s.val&&s.val.by, hv:!!(s.full&&s.full.results&&s.full.results.validation), msg:!!s.msgs.validationResult, ready:s.ready};})()`).catch(e => ({ err: String(e).slice(0, 60) }));
      if (i === 0 || i === 5) {
        const lv = (await api('GET', `/api/wv/${encodeURIComponent(designerId)}/last?command=validationResult`)).json?.data?.validationResult;
        const hf = (await api('POST', '/api/mcp/action', { action: 'get_full_state' })).json;
        x.bridge = lv ? lv.seq : null; x.hostV = !!hf?.results?.validation; x.rev = hf?.case?.rev; x.revBefore = r.case_rev;
        x.led = (hf?.invalidated ?? []).filter(e => e.kind === 'validation').slice(-1).map(e => [e.reason, e.cause]);
        const ci = (await api('POST', '/api/mcp/action', { action: 'get_case_inputs' })).json;
        x.changedSince = ci?.dirty_since ?? null;
      }
      trace.push(`${((Date.now() - t0r) / 1000).toFixed(0)}s:${JSON.stringify(x)}`);
      back = x?.val === 'ai';
      if (!back) { await sleep(1000); }
    }
    await select('result', 'val');
    const c = await valCompare();
    const fs2 = await mcp.tool('get_full_state');
    const host = fs2?.results?.validation;
    if (!back) {
      const lastV = (await api('GET', `/api/wv/${encodeURIComponent(designerId)}/last?command=validationResult`)).json?.data?.validationResult;
      const scr = await ev(`(()=>{const s=${S}.state; const m=s.msgs.validationResult; return {msg:!!m, seq:m&&m.seq, items:m&&m.message&&m.message.data&&Array.isArray(m.message.data.items)?m.message.data.items.length:null, hv:s.full&&s.full.results&&s.full.results.validation&&s.full.results.validation.by, val:s.val&&s.val.by, st:s.stages.val.state, scr:s.ui===undefined?null:1, msgSeq:s.msgSeq};})()`);
      return { ok: false, detail: `흔적 ${[...new Set(trace.map(t => t.replace(/^\d+s:/, '')))].map(v => `${trace.find(t => t.endsWith(v))?.split(':')[0]}=${v}`).join(' | ')} · 화면 ${JSON.stringify(scr)} · 새로 고친 뒤 점검 없음 · 호스트 results.validation ${JSON.stringify(host ?? null)} · 장부 ${JSON.stringify((fs2?.invalidated ?? []).filter(e => e.kind === 'validation').slice(-1))} · 다리의 기록 ${lastV ? `seq ${lastV.seq}` : '없음'}` };
    }
    return { ok: Array.isArray(r.items) && a.by === 'ai' && a.n === r.items.length && c.bad.length === 0 && host?.by === 'ai',
      detail: `AI 점검 ${r.items?.length} 항목 → 화면 ${a.n}(by ${a.by}) · 새로 고침 뒤 항목 = 호스트 ${c.bad.length === 0}${c.bad.length ? ` (${c.bad.slice(0, 3).join(' / ')})` : ''} · results.validation ${JSON.stringify(host?.counts)} by ${host?.by}` };
  });
  await step('u5d 보기 계약 kind validation — 점검 항목을 고르면 get_view 에 {kind: validation, id: val.*} · AI 의 focus 도 그 항목으로', null, async () => {
    const it = state => state;
    void it;
    const k = await ev(`(()=>{const tr=document.querySelector('#center tr.vr[data-id^="val."]'); return tr?tr.dataset.k:null;})()`);
    await select('result', k);
    await sleep(1200);
    const v = await viewNow();
    const id = k.slice(4);
    const f = await mcp.tool('focus', { item: { kind: 'validation', id }, reason: '점검 항목' });
    await waitFor(`!!${S}.pointed || ${S}.ui.sel===${JSON.stringify(k)}`, 10_000, 'focus');
    const pt = await ev(`${S}.pointed ? ${S}.pointed.target : null`);
    await ev(`(()=>{const b=document.querySelector('#aipoint [data-ai="dismiss"]'); b&&b.click(); return 1;})()`);
    const fsD = await mcp.tool('get_full_state');
    const diag = `호스트: 판 ${fsD?.case?.rev} · results.validation ${JSON.stringify(fsD?.results?.validation ? { case_rev: fsD.results.validation.case_rev, by: fsD.results.validation.by } : null)} · 장부 ${JSON.stringify((fsD?.invalidated ?? []).filter(e => e.kind === 'validation').slice(-1).map(e => [e.reason, e.cause]))} · 화면 점검 판 ${await ev(`${S}.state.val ? ${S}.state.val.caseRev : null`)}`;
    return { ok: v.current?.selection?.kind === 'validation' && v.current.selection.id === id && (v.dropped ?? []).length === 0 && f.forwarded === true && (pt?.key === k || pt === null),
      detail: `고른 것 ${JSON.stringify(v.current?.selection)} · focus forwarded ${f.forwarded} target_found ${f.target_found} · 화면의 목표 ${pt?.key ?? '(바로 따라감)'} · ${diag}` };
  });
  await step('u5e 글 방향 제어 문자(U+202E 등) — 파일 이름 · 알림 · 엔진 글이 거꾸로 읽히지 않게 보이는 대체 문자로(호스트의 그리기와 같은 규칙)', 'u5e_bidi', async () => {
    const base = path.join(tmp, 'u5e-base.csd');
    await serve.ipc('save', { file: base }, 60_000);
    const evil = path.join(tmp, `검토\u202Efdp.csd`);
    fs.copyFileSync(base, evil);
    const o = await serve.ipc('open', { file: evil }, 60_000);
    await settle(`s.file.name && s.file.name.includes('\u202E')`, '파일 이름');
    await sleep(300);
    const t = await ev(`({fname:document.querySelector('#tbar .fname').textContent, title:document.title, status:document.querySelector('#status .msg, #status')?.textContent,
      esc:(()=>{const d=document.createElement('div'); d.innerHTML=${S}.state.file.name ? '' : ''; return 1;})()})`);
    const hasRaw = /[\u202A-\u202E\u2066-\u2069]/.test(t.fname) || /[\u202A-\u202E\u2066-\u2069]/.test(t.status ?? '');
    await serve.ipc('open', { file: base }, 60_000);
    await settle(`s.file.path===${JSON.stringify(base)}`, '원래 상태(서명된 사본)');
    return { ok: !!o?.ok && !hasRaw && t.fname.includes('\uFFFD'), detail: `제목 표시줄 「${t.fname}」 · 상태 줄에 날 글자 ${hasRaw}` };
  });
  await step('u5f 결과 봉인(82194ef) — 저장 → 다시 열기 = 결과가 돌아온다(서명) · 입력을 고친 파일 = 「입력만 열었습니다 — …」 띠와 「다시 계산」 하나 → 결과가 다시', 'u5f_seal', async () => {
    const A = path.join(tmp, 'u5f-sealed.csd');
    // 앞 단계의 입력 변경이 부재 검토를 지웠다 — 저장 전에 화면의 입력으로 한 번 돌린다(그 결과가 봉인되어 돌아오는지 본다)
    const rc = await mcp.tool('run_case_check', { what: 'member' });
    await settle(`!!s.full && !!s.full.results && !!s.full.results.member_design`, '부재 검토', 120_000).catch(() => undefined);
    const sv = await serve.ipc('save', { file: A }, 60_000);
    const jA = JSON.parse(fs.readFileSync(A, 'utf8'));
    await serve.ipc('open', { file: A }, 60_000);
    await sleep(800);
    const f1 = await mcp.tool('get_full_state');
    const res1 = Object.keys(f1?.results ?? {}).filter(k => f1.results[k] && k !== 'validation');
    const B = path.join(tmp, 'u5f-tampered.csd');
    const jB = JSON.parse(JSON.stringify(jA));
    if (jB.case?.inputs && typeof jB.case.inputs.Lb === 'number') { jB.case.inputs.Lb += 1; } else if (jB.case?.inputs) { jB.case.inputs.Lb = 50; }
    fs.writeFileSync(B, JSON.stringify(jB, null, 2));
    await serve.ipc('open', { file: B }, 60_000);
    const note = await waitFor(`(()=>{const e=document.getElementById('opennotice'); return e && !e.hidden ? e.textContent : null;})()`, 20_000, '입력만 열었다는 띠').catch(() => null);
    if (!note) {
      const fx = await mcp.tool('get_full_state');
      return { ok: false, detail: `띠 없음 · 저장 ${sv?.ok} 봉인 ${!!jA.resultsSeal} · 다시 열기 결과 ${res1.join(', ')} · 고친 파일의 결과 ${Object.keys(fx?.results ?? {}).filter(k => fx.results[k]).join(', ') || '없음'} · 장부 ${JSON.stringify((fx?.invalidated ?? []).filter(e => e?.cause?.action === 'open_project').map(e => [e.kind, String(e.reason).slice(0, 60)]))}` };
    }
    await shot('u5f_open_notice_1920_dark');
    const f2 = await mcp.tool('get_full_state');
    const res2 = Object.keys(f2?.results ?? {}).filter(k => f2.results[k]);
    await ev(`document.querySelector('#opennotice [data-act="recompute"]').click()`);
    await waitFor(`document.getElementById('opennotice').hidden`, 120_000, '다시 계산 뒤 띠가 사라짐');
    const f3 = await mcp.tool('get_full_state');
    // 뒤의 단계가 결과를 쓴다 — 서명된 사본(결과가 되살아난다)으로 돌아간다
    await serve.ipc('open', { file: A }, 60_000);
    await settle(`s.file.path===${JSON.stringify(A)}`, '서명된 사본');
    return { ok: sv?.ok && !!jA.resultsSeal && f1?.case?.results_signed === true && res1.includes('member_design') && res2.filter(k => k !== 'validation').length === 0
      && /입력만 열었습니다 — 파일의 결과가 함께 저장된 모델 · 입력과 맞지 않습니다/.test(note) && !!f3?.results?.member_design,
      detail: `run_case_check ${rc?.error ? rc.error : '성공'} · 저장(봉인 ${!!jA.resultsSeal}) → 다시 열기: 결과 ${res1.join(', ')} · 서명 ${f1?.case?.results_signed} → 입력을 고친 파일: 결과 ${res2.join(', ') || '없음'} · 「${short(note, 80)}」 → 다시 계산: 부재 검토 ${!!f3?.results?.member_design}` };
  });
  await step('u5g 지금 저장하면 결과에 서명이 붙지 않으면(열쇠 파일이 비었음) — 저장 단추 옆에 조용히 「결과 서명 안 됨」(까닭은 풍선) · 고치면 사라진다', 'u5g_unsigned', async () => {
    const key = path.join(tmp, 'userData', 'writer', 'writer.key');
    const keep = fs.existsSync(key) ? fs.readFileSync(key) : null;
    fs.writeFileSync(key, '');
    await mcp.tool('set_case_inputs', { inputs: { Cb: 1.11 }, units: 'SI', reason: '새로 읽게' });
    const a = await waitFor(`(()=>{const e=document.querySelector('#tbar .sealtag'); return e && !e.hidden ? {t:e.textContent, tip:e.dataset.tip} : null;})()`, 15_000, '서명 안 됨 표시');
    await shot('u5g_unsigned_1920_dark');
    if (keep) { fs.writeFileSync(key, keep); } else { fs.unlinkSync(key); }
    await mcp.tool('set_case_inputs', { inputs: { Cb: 1.12 }, units: 'SI', reason: '새로 읽게' });
    await waitFor(`document.querySelector('#tbar .sealtag').hidden`, 15_000, '표시가 사라짐');
    const dialogs = await ev(`document.querySelectorAll('#dialog-host .dialog').length`);
    return { ok: a.t === '결과 서명 안 됨' && /empty or not a file/.test(a.tip ?? '') && dialogs === 0, detail: `「${a.t}」 · 풍선 「${short(a.tip, 90)}」 · 물음 ${dialogs}` };
  });
  // 그림 — 점검 보기 · 문서 탭, 1920 · 960, 어두운 · 밝은
  for (const [w, h] of [[1920, 1080], [960, 900]]) {
    W = w; H = h;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    for (const th of ['dark', 'light']) {
      await ev(`${S}.setTheme(${JSON.stringify(th)})`);
      await step(`u5g 그림 ${w}px · ${th === 'dark' ? '어두운' : '밝은'} — 점검 · 계산서`, null, async () => {
        await select('result', 'val'); await sleep(300); await shot(`u5g_val_${w}_${th}`);
        await select('doc', 'rpt'); await sleep(600); await shot(`u5g_doc_${w}_${th}`);
        const s = await ev(`({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth})`);
        return { ok: s.sw <= s.cw, detail: `scrollWidth ${s.sw}/${s.cw}` };
      });
    }
  }
  await ev(`${S}.setTheme('dark')`);
  W = 1920; H = 1080;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

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
    // 사람이 하중 케이스를 고르고 실행한다 — 앞 단계(u45 가 연 파일)의 케이스가 조합이면 웹뷰의 해석은 설계용 무리가 없는 사용자 분포가 된다
    await wv(`const e=D.getElementById('select-load-case'); e.value='bending_xx_pos'; e.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
    await sleep(300);
    await wv(`D.getElementById('btn-run-analysis').click(); return 1;`);
    await settle(`s.msgSeq>${before} && s.stages.fsm.state==='ok' && s.dsm`, '웹뷰의 해석 결과', 120_000);
    const fam = await ev(`${S}.state.dsm.family`);
    const chk = await ev(`${S}.state.stages.chk`);
    return { ok: ['stale', 'none'].includes(chk.state) && hiddenBefore === 'hidden' && shown.vis === 'visible' && shown.editing && shown.badge && /편집 마치기/.test(shown.btn) && shown.w > 800,
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

  // 3D 모드 형상 — 제품의 렌더러 번들을 새 화면의 출처(/ui/viewer3d/)에서, 화면의 CSP(script-src 'self') 그대로 싣고
  // analysisComplete.shapes 의 첫 모양을 그린다(최소 증명 — 화면에 붙이는 것은 다음 단계). CSP 위반 · 예외 0
  await step('u3d 3D 렌더러 번들이 /ui/ 의 CSP 아래 같은 출처에서 실리고 analysisComplete.shapes 로 모양을 그린다', 'u3d_viewer3d', async () => {
    const m0 = log.console.length;
    const r = await ev(`(async()=>{
      const s=document.createElement('script'); s.src='/ui/viewer3d/viewer3d.js'; document.head.appendChild(s);
      await new Promise((ok,no)=>{s.onload=ok; s.onerror=()=>no(new Error('번들을 싣지 못함'));});
      const c=document.createElement('canvas'); c.id='mode-shape-3d-canvas'; c.width=480; c.height=320;
      c.style.cssText='position:fixed;right:8px;bottom:8px;width:480px;height:320px;z-index:2147483647;background:#000';
      document.body.appendChild(c);
      const q=await (await fetch('/api/wv/'+encodeURIComponent(${JSON.stringify(designerId)})+'/last?command=analysisComplete&command=modelLoaded',{credentials:'same-origin'})).json();
      const a=q.data.analysisComplete.message.data, m=q.data.modelLoaded.message.data;
      const shape=a.shapes[0]; const modeVec=Array.isArray(shape[0])?shape.map(row=>row[0]||0):shape;
      await window.CufsmViewer3D.render({nodes:m.node, elems:m.elem, modeVec, length:a.curve[0][0], BC:m.BC||'S-S', scale:0.3});
      const inst=window.CufsmViewer3D._modeInstance;
      const scene=inst&&inst._scene; const meshes=scene?scene.meshes.filter(x=>x.getTotalVertices&&x.getTotalVertices()>0):[];
      // 실린 조각 — 새 화면의 3D 칩(u31)이 먼저 실었으면 그때의 것이다(웹팩이 조각의 script 태그를 지운다) — 자원 기록으로 본다
      const chunk=[...new Set([...document.scripts].map(x=>x.src).concat(performance.getEntriesByType('resource').map(e=>e.name)).filter(u=>/viewer3d/.test(u)))];
      return {meshes: meshes.length, vertices: meshes.reduce((n,x)=>n+x.getTotalVertices(),0), nodes:m.node.length, chunk};
    })()`);
    await sleep(600);
    const shotFile = await shot('u3d_viewer3d_canvas');
    const csp = log.console.slice(m0).filter(c => /Content Security Policy|Refused to/i.test(c.text));
    await ev(`(()=>{const c=document.getElementById('mode-shape-3d-canvas'); if(c){c.remove();} return 1;})()`);
    const v404 = await api('GET', '/ui/viewer3d/mcp-server.js');
    const v404b = await api('GET', '/ui/viewer3d/viewer3d.js.map');
    return { ok: r.meshes > 0 && r.vertices > 100 && r.chunk.some(u => /\/ui\/viewer3d\/viewer3d\.mode-shape-renderer\.js$/.test(u)) && csp.length === 0
      && v404.status === 404 && v404b.status === 404,
    detail: `메시 ${r.meshes} · 꼭짓점 ${r.vertices} · 절점 ${r.nodes} · 실린 조각 ${r.chunk.map(u => u.replace(/^.*\/ui\//, '/ui/')).join(', ')} · CSP 위반 ${csp.length} · 다른 파일 ${v404.status}/${v404b.status} · ${path.basename(shotFile)}` };
  });

  // 무효 장부 — 낡음은 호스트가 말한다(화면은 기억하지 않는다): 새로 고침해도 낡음 그대로
  const bc2 = await mcp.tool('set_boundary_condition', { BC: 'C-C' });
  await step('u33 낡음 = 호스트의 무효 장부 — 까닭 · 원인, 페이지를 새로 고쳐도 그대로(화면의 기억이 아니다)', 'u33_ledger', async () => {
    await settle(`s.stages.fsm.state==='stale' && s.stages.chk.state==='stale'`, '장부의 낡음');
    const a = await ev(`({fsm:${S}.state.stages.fsm.note, chk:${S}.state.stages.chk.note, inv:(${S}.state.full.invalidated||[]).map(e=>e.kind+':'+e.reason), ci:JSON.stringify([${S}.state.caseIn.inputs]), wvFy:null})`);
    a.wvFy = await wv(`return D.getElementById('design-fy').value;`).catch(() => null);
    // 입력은 호스트의 것으로 맞댄다(화면의 사본은 읽은 때에 따라 한 판 늦을 수 있다) — 새로 고침이 호스트의 입력을 바꾸지 않아야 한다
    const hostA = await caseHost();
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitFor(`!!window.__stcfsdUi && window.__stcfsdUi.state.ready && window.__stcfsdUi.state.full`, 60_000, '다시 실림');
    await ev(`${S}.review()`);
    await settle(`s.stages.fsm.state==='stale'`, '새로 고친 뒤 낡음', 30_000);
    await settle(`!!s.caseIn`, '검토 상태');
    const b = await ev(`({fsm:${S}.state.stages.fsm.note, chk:${S}.state.stages.chk.state, seen:(()=>{try{return sessionStorage.getItem('stcfsd.ui.seen.v1');}catch{return 'x';}})(), tree:document.getElementById('tree').innerText, ci:JSON.stringify([${S}.state.caseIn.inputs])})`);
    // 끼운 설계 화면도 다시 실렸다 — 호스트가 두 번째 caseHello 에 다시 보낸 상태로 칸이 그대로(옛 되살림 기법 없이)
    const wvFy2 = await waitWv(`const v=D.getElementById('design-fy'); return v && v.value===${JSON.stringify(a.wvFy)} ? v.value : null;`, 30_000, '설계 화면의 칸').catch(() => null);
    await sleep(1500);
    const hostB = await caseHost();
    const diffKeys = Object.keys(hostA.inputs ?? {}).filter(k => JSON.stringify(hostA.inputs[k]) !== JSON.stringify(hostB.inputs?.[k]));
    const spansSame = JSON.stringify(hostA.spans) === JSON.stringify(hostB.spans);
    await settle(`s.caseIn && s.caseIn.rev===${hostB.rev}`, '화면의 검토 상태 = 호스트', 15_000).catch(() => undefined);
    const scrCi = await ev(`JSON.stringify(${S}.state.caseIn.inputs)`);
    await select('result', 'fsm');
    return { ok: !bc2.error && a.inv.length >= 2 && /호스트가 결과를 지웠다/.test(a.fsm) && b.fsm === a.fsm && b.chk === 'stale' && b.seen === null && diffKeys.length === 0 && spansSame && scrCi === JSON.stringify(hostB.inputs) && wvFy2 === a.wvFy,
      detail: `장부 ${a.inv.slice(0, 3).join(' · ')} · 「${short(a.fsm, 70)}」 · 새로 고침 뒤 같은 까닭 ${b.fsm === a.fsm} · 부재 검토 ${b.chk} · 화면 기억(sessionStorage) ${b.seen}`
        + ` · 호스트의 입력 새로 고침 앞뒤 같음 ${diffKeys.length === 0 && spansSame}${diffKeys.length ? `(바뀐 칸 ${diffKeys.slice(0, 5).map(k => `${k}: ${JSON.stringify(hostA.inputs[k])} → ${JSON.stringify(hostB.inputs[k])} (${hostB.sources?.[k]})`).join(', ')})` : ''} · 판 ${hostA.rev} → ${hostB.rev} · 화면 = 호스트 ${scrCi === JSON.stringify(hostB.inputs)} · 설계 화면 설계 Fy ${a.wvFy} → ${wvFy2}` };
  });
  // ── R1-3 — 기록 갈래가 화면에: 프로젝트 · 검토 대상 · 사람만 하는 일(/api/person/*) ─────────────────────────────
  section('7g. R1-3 — 시작 화면의 최근 검토 · 새 프로젝트 · 새 검토(카드) · 프로젝트로 만들기 · 제목 표시줄 · 띠 · 사람의 길만');
  const dlgInput = async (value) => {
    const q = await waitFor(`(()=>{const d=document.querySelector('#dialog-host .dialog'); const i=d&&d.querySelector('[data-role="value"]'); return i ? d.querySelector('h2')?.textContent || '물음' : null;})()`, 20_000, '이름 물음');
    await ev(`(()=>{const d=document.querySelector('#dialog-host .dialog'); const i=d.querySelector('[data-role="value"]'); i.value=${JSON.stringify(value)}; d.querySelector('[data-role="ok"]').click(); return 1;})()`);
    return q;
  };
  const answerIfUnsaved = async () => {
    const asked = await waitFor(`(()=>{const d=document.querySelector('#dialog-host .dialog'); return d && /저장하지 않은 변경/.test(d.textContent) ? 1 : null;})()`, 2_500, '').catch(() => null);
    if (asked) { await ev(`document.querySelector('#dialog-host [data-item="저장 안 함"]').click()`); }
    return !!asked;
  };
  const recNow = async () => (await api('POST', '/api/mcp/action', { action: 'list_cases' })).json;
  const projRoot = path.join(tmp, 'Documents', 'StCFSD 프로젝트');
  await step('r10 새 프로젝트(시작 화면) — 이름 물음 → 뿌리(문서 › StCFSD 프로젝트) 아래에 · 제목 표시줄 「프로젝트 ▾」 · 대상 수 = list_cases', 'r10_new_project', async () => {
    await ev(`${S}.start()`);
    await sleep(300);
    await ev(`document.querySelector('#start [data-rec="new-project"]').click()`);
    const q = await dlgInput('시험 물류창고');
    await settle(`!!s.full && !!s.full.project && s.full.project.inProject && s.full.project.project.name==='시험 물류창고'`, '열린 프로젝트', 30_000);
    const lc = await recNow();
    const t = await ev(`({proj:document.querySelector('#tbar .pick.proj')?.hidden===false ? document.querySelector('#tbar .pname').textContent : null, foot:document.querySelector('#start [data-foot-count]')?.textContent})`);
    const made = fs.existsSync(path.join(projRoot, '시험 물류창고'));
    return { ok: made && t.proj === '시험 물류창고' && Array.isArray(lc.cases) && String(lc.cases.length) === (t.foot ?? String(lc.cases.length)),
      detail: `물음 「${q}」 · 폴더 ${made} · 제목 표시줄 「${t.proj}」 · 바닥 줄 대상 ${t.foot} = list_cases ${lc.cases?.length}` };
  });
  await step('r11 새 검토 카드(지붕 퍼린) — 이름 물음 → 새 대상을 만들고 연다 · 시작 화면의 줄 수 = list_cases · 「검토 대상 <이름> ▾」', 'r11_new_case', async () => {
    await ev(`document.querySelector('#start [data-rec="new-case"][data-kind="roof-purlin"]').click()`);
    await dlgInput('퍼린 P1');
    await answerIfUnsaved();
    await settle(`!!s.full && !!s.full.project && !!s.full.project.case && s.full.project.case.name==='퍼린 P1'`, '연 대상', 60_000);
    const lc = await recNow();
    const t = await ev(`({fname:document.querySelector('#tbar .fname').textContent, label:document.querySelector('#tbar .flabel').textContent, band:document.getElementById('recband').hidden})`);
    await ev(`${S}.start()`);
    const ci = await caseHost();
    return { ok: lc.cases?.some(c => c.name === '퍼린 P1' && c.kind === 'roof-purlin' && c.open) && /퍼린 P1/.test(t.fname) && t.label === '검토 대상' && t.band === true && ci.inputs?.memberType === 'roof-purlin',
      detail: `list_cases ${JSON.stringify(lc.cases?.map(c => `${c.name}:${c.kind}:${c.open}`))} · 제목 「${t.label} ${t.fname}」 · 띠 숨김 ${t.band} · 부재 유형 ${ci.inputs?.memberType}(${ci.sources?.memberType})` };
  });
  await step('r12 프로젝트 밖의 파일 → 띠 「프로젝트 밖 — 작업 기록이 남지 않음」 · 「프로젝트로 만들기」 → 열린 프로젝트에 복사(원본 그대로) · 대상 수 = list_cases', 'r12_make_project', async () => {
    const outside = path.join(tmp, 'outside-copy.csd');
    fs.copyFileSync(csd, outside);
    const before = fs.readFileSync(outside);
    await serve.ipc('open', { file: outside }, 60_000);
    await settle(`!!s.full && !(s.full.project && s.full.project.case)`, '프로젝트 밖', 15_000).catch(() => undefined);
    const band = await waitFor(`(()=>{const b=document.getElementById('recband'); return b && !b.hidden ? b.getAttribute('data-kind')+'|'+b.textContent : null;})()`, 15_000, '띠');
    await shot('r12_outside_band_1920_dark');
    await ev(`document.querySelector('#recband [data-rec="make-project"]').click()`);
    // 프로젝트 밖의 파일을 열면 프로젝트도 닫힌다 — 「어느 프로젝트로」 목록(최근 · 뿌리)에서 고르면 이어서 이름을 묻는다
    const menu = await waitFor(`(()=>{const m=document.querySelector('.ctx'); return m ? m.textContent : null;})()`, 10_000, '프로젝트 고르기').catch(() => null);
    if (menu) { await ev(`(()=>{const it=[...document.querySelectorAll('.ctx .ci')].find(x=>/시험 물류창고/.test(x.textContent)); it&&it.click(); return !!it;})()`); }
    await dlgInput('가져온 퍼린');
    await settle(`!!s.full && !!s.full.project && !!s.full.project.case && s.full.project.case.name==='가져온 퍼린'`, '가져온 대상', 60_000);
    const lc = await recNow();
    const after = fs.readFileSync(outside);
    await ev(`${S}.start()`);
    await sleep(300);
    const foot = await ev(`document.querySelector('#start [data-foot-count]')?.textContent`);
    return { ok: /^outside\|/.test(band) && /작업 기록이 남지 않음/.test(band) && lc.cases?.length === 2 && Buffer.compare(before, after) === 0 && (foot === undefined || foot === '2'),
      detail: `띠 「${short(band, 60)}」 → 「프로젝트로 만들기」 → list_cases ${lc.cases?.map(c => c.name).join(', ')} · 원본 그대로 ${Buffer.compare(before, after) === 0} · 바닥 줄 ${foot}` };
  });
  await step('r13 새 화면의 중계로 돌린 실행 = 사람(screen)의 것 · MCP 토큰의 실행 = ai(실행 기록의 by)', null, async () => {
    // 화면의 중계(다리 /api/mcp/action — 쓰기 열쇠) = 사람
    await api('POST', '/api/mcp/action', { action: 'validate_design', detail: 'summary', report_units: 'SI' });
    const s1 = (await api('POST', '/api/mcp/action', { action: 'get_case_status', detail: 'runs' })).json;
    const byScreen = s1?.results?.validation?.last_run?.by ?? s1?.runs?.find?.(r => r.kind === 'validation')?.by;
    await mcp.tool('validate_design', { detail: 'summary', units: 'SI' });
    const s2 = (await api('POST', '/api/mcp/action', { action: 'get_case_status', detail: 'runs' })).json;
    const byAi = s2?.results?.validation?.last_run?.by ?? s2?.runs?.find?.(r => r.kind === 'validation')?.by;
    return { ok: !!byScreen && byScreen !== 'ai' && byAi === 'ai', detail: `화면의 중계 → by ${byScreen} · MCP 도구 → by ${byAi} · 결과 ${short(JSON.stringify(s2?.results ?? null), 200)} · runs ${short(JSON.stringify(s2?.runs ?? null), 200)} · ${short(s2?.error ?? '', 80)}` };
  });
  await step('r14 ⚔ 사람만 하는 길 — 끼운 웹뷰의 fetch · top.location · postMessage / MCP 토큰 / 쓰기 열쇠 없음 / Origin 다름 / open-folder 본문의 경로 — 모두 거절 · 아무것도 바뀌지 않음', 'r14_person_refusals', async () => {
    const before = JSON.stringify((await recNow()).cases);
    const origin = await ev('location.origin');
    const outsideDir = path.join(tmp, '남의 폴더');
    fs.mkdirSync(outsideDir, { recursive: true });
    // (a) 끼운 웹뷰(다른 출처)에서 fetch — 쿠키 포함 · no-cors
    const a = await br.frameEval(`/wv/${encodeURIComponent(designerId)}/`, `fetch(${JSON.stringify(origin)} + '/api/person/archive', {method:'POST', mode:'no-cors', credentials:'include', headers:{'Content-Type':'text/plain'}, body:'{"archived":true}'}).then(r=>'status '+r.status+' '+r.type).catch(e=>'blocked '+String(e).slice(0,40))`).catch(e => `eval ${String(e).slice(0, 40)}`);
    // (b) top.location 으로 사람 경로 — GET 만 되고 POST 가 아니라 405, 화면은 그대로
    const b = await br.frameEval(`/wv/${encodeURIComponent(designerId)}/`, `(()=>{try{top.location.href=${JSON.stringify(origin)}+'/api/person/open-folder'; return 'set';}catch(e){return 'blocked '+String(e).slice(0,40);}})()`).catch(e => `eval ${String(e).slice(0, 40)}`);
    await sleep(800);
    const stillUi = await ev(`!!window.__stcfsdUi`).catch(() => false);
    // (c) postMessage 로 화면에 사람의 일을 시키려 함 — 화면은 그런 메시지를 받지 않는다
    const c = await br.frameEval(`/wv/${encodeURIComponent(designerId)}/`, `(()=>{top.postMessage({stcfsdBridge:1,type:'person',act:'archive'},'*'); top.postMessage({command:'archive'},'*'); return 'sent';})()`).catch(e => `eval ${String(e).slice(0, 40)}`);
    await sleep(500);
    // (d) MCP 토큰 · (e) 쓰기 열쇠 없음 · (f) Origin 다름 — 다리에 직접(node)
    const raw = (p, headers, body = '{}') => new Promise(res => {
      const u = new URL(p, origin);
      const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, x => { x.resume(); x.on('end', () => res(x.statusCode)); });
      r.on('error', () => res(-1)); r.end(body);
    });
    const d = await raw('/api/person/archive', { Authorization: `Bearer ${mcpToken}` });
    const e = await raw('/api/person/archive', { Authorization: `Bearer ${token}` });
    const f = await raw('/api/person/archive', { Authorization: `Bearer ${token}`, Origin: 'http://127.0.0.1:1', 'Sec-Fetch-Site': 'cross-site', 'X-StCFSD-Key': 'x' });
    // (g) open-folder 본문의 경로는 쓰지 않는다 — 폴더 물음이 뜬다(취소)
    const gp = ev(`fetch('/api/person/open-folder',{method:'POST',credentials:'same-origin',headers:Object.assign({'Content-Type':'application/json'}, (()=>{try{const k=sessionStorage.getItem('stcfsd.bridge.key.'+location.port); return k?{'X-StCFSD-Key':k}:{};}catch{return {};}})()), body:JSON.stringify({dir:${JSON.stringify(outsideDir)}, dirAbs:${JSON.stringify(outsideDir)}, path:${JSON.stringify(outsideDir)}})}).then(r=>r.json())`);
    const fd = await waitFor(`(()=>{const d=document.querySelector('#dialog-host .dialog[data-kind="fileDialog"]'); return d ? d.querySelector('h2').textContent : null;})()`, 15_000, '폴더 물음').catch(() => null);
    await ev(`(()=>{const d=document.querySelector('#dialog-host .dialog[data-kind="fileDialog"]'); const c=d&&d.querySelector('[data-role="cancel"]'); c&&c.click(); return !!c;})()`);
    const g = await gp;
    const after = JSON.stringify((await recNow()).cases);
    const projNow = (await api('POST', '/api/mcp/action', { action: 'get_full_state' })).json?.project?.project?.name;
    const declared = fs.existsSync(path.join(outsideDir, 'stcfsd-project.json'));
    // 끼운 웹뷰의 공격이 남긴 콘솔 줄(CSP 가 막음 · 거절된 요청)은 바라던 결과 — 이 단계의 콘솔 오류 검사에서 뺀다(수를 적는다)
    const ATTACK = /api\/person\/|Unsafe attempt to initiate navigation/;
    const blockedLines = log.console.filter(x => ATTACK.test(x.text));
    log.console.splice(0, log.console.length, ...log.console.filter(x => !ATTACK.test(x.text)));
    return { ok: before === after && stillUi && [401, 403].includes(d) && e === 403 && f === 403 && !!fd && g?.data?.cancelled === true && projNow === '시험 물류창고' && !declared,
      detail: `막힘의 콘솔 줄 ${blockedLines.length} · (a) 웹뷰 fetch ${a} · (b) top.location ${b} → 화면 그대로 ${stillUi} · (c) postMessage ${c} · (d) MCP 토큰 ${d} · (e) 열쇠 없음 ${e} · (f) Origin 다름 ${f} · (g) 본문 경로 → 폴더 물음 「${fd}」 · 취소 ${g?.data?.cancelled} · 그 폴더에 선언 ${declared} · 대상 목록 그대로 ${before === after} · 프로젝트 ${projNow}` };
  });
  await step('r15 발행본(04_발행본 안의 파일) → 띠 「읽기 전용 — 발행본이다」 · 「새 검토 대상으로」 · 입력을 고쳐도 받지 않음', 'r15_readonly_band', async () => {
    const pdir = path.join(projRoot, '시험 물류창고');
    const src = fs.readdirSync(path.join(pdir, '02_검토대상')).find(f => /퍼린 P1/.test(f));
    const issuedDir = path.join(pdir, '04_발행본', '퍼린 P1', 'R0');
    fs.mkdirSync(issuedDir, { recursive: true });
    const issued = path.join(issuedDir, '퍼린 P1.csd');
    fs.copyFileSync(path.join(pdir, '02_검토대상', src), issued);
    await serve.ipc('open', { file: issued }, 60_000);
    const band = await waitFor(`(()=>{const b=document.getElementById('recband'); return b && !b.hidden && b.getAttribute('data-kind')==='readonly' ? b.textContent+'|'+(b.querySelector('[data-ro-reason]')?.dataset.roReason||'') : null;})()`, 20_000, '읽기 전용 띠').catch(() => null);
    if (!band) {
      const fx = (await api('POST', '/api/mcp/action', { action: 'get_full_state' })).json;
      const cs = (await api('POST', '/api/mcp/action', { action: 'get_case_status' })).json;
      return { ok: false, detail: `띠 없음 · project ${JSON.stringify(fx?.project)} · case_status ${short(JSON.stringify(cs), 300)} · 화면 띠 ${await ev(`document.getElementById('recband').getAttribute('data-kind')+'|'+document.getElementById('recband').hidden`)}` };
    }
    await shot('r15_readonly_1920_dark');
    const sc = await mcp.tool('set_case_inputs', { inputs: { Cb: 1.3 }, units: 'SI', reason: '읽기 전용 시험' });
    return { ok: /읽기 전용/.test(band) && /발행본/.test(band) && /새 검토 대상으로/.test(band) && !!sc.error,
      detail: `띠 「${short(band, 90)}」 · AI 의 set_case_inputs → ${short(sc.error ?? '받음', 80)}` };
  });
  await step('r16 시작 화면(템플릿 00) — 열린 프로젝트의 대상 줄 · 바닥 줄(이름 · 수) · 새 검토 카드 넷 · 그림', 'r16_start', async () => {
    await mcp.tool('open_project', { name: '시험 물류창고' });
    await api('POST', '/api/mcp/action', { action: 'open_case', name: '퍼린 P1', report_units: 'SI' });
    await settle(`!!s.full && !!s.full.project && !!s.full.project.case`, '대상', 30_000);
    await ev(`${S}.start()`);
    await sleep(600);
    const lc = await recNow();
    const t = await ev(`({rows:[...document.querySelectorAll('#start .rows tr[data-rec="open-case"]')].map(r=>r.dataset.name), foot:document.querySelector('#start [data-foot-count]')?.textContent, cards:document.querySelectorAll('#start .newc [data-rec="new-case"]').length})`);
    await shot('r16_start_1920_dark');
    await ev(`${S}.review()`);
    return { ok: t.rows.length === lc.cases.length && String(lc.cases.length) === t.foot && t.cards >= 4,
      detail: `줄 ${t.rows.join(', ')} = list_cases ${lc.cases.map(c => c.name).join(', ')} · 바닥 줄 ${t.foot} · 카드 ${t.cards}` };
  });
  await step('r17 남이 쥔 대상(다른 작성자의 잠금) → 띠: 까닭 · 잠금 · 「입력 · 모델을 고치거나 다른 모델로 해석을 돌려도 받지 않는다」 · 「새 검토 대상으로」 · 「넘겨받기」, AI 의 모델 편집도 거절(a730256)', 'r17_locked_band', async () => {
    const pdir = path.join(projRoot, '시험 물류창고');
    const act = (body) => api('POST', '/api/mcp/action', body).then(r => r.json);
    // 「가져온 퍼린」의 caseId 를 안 뒤 다른 대상을 열어 내 잠금을 놓는다 — 그 자리에 다른 작성자의 잠금을 심는다(남의 PC 에서 열려 있는 것처럼)
    await act({ action: 'open_case', name: '가져온 퍼린', report_units: 'SI' });
    const caseId = (await act({ action: 'get_full_state' }))?.project?.case?.caseId;
    await act({ action: 'open_case', name: '퍼린 P1', report_units: 'SI' });
    const lockFile = path.join(pdir, '.stcfsd', 'locks', `${caseId}.lock`);
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify({ schema: 'stcfsd-lock/1', caseId, writer: 'wabcdefghijklmnopqrst', name: '다른 설계자', host: 'OTHER-PC', pid: 4242, at: new Date().toISOString(), sig: 'x' }));
    try {
      await act({ action: 'open_case', name: '가져온 퍼린', report_units: 'SI' });
      const band = await waitFor(`(()=>{const b=document.getElementById('recband'); return b && !b.hidden && b.getAttribute('data-kind')==='readonly' ? {text:b.textContent, reason:b.querySelector('[data-ro-reason]')?.dataset.roReason||'', scope:!!b.querySelector('[data-ro-scope]'),
        btns:[...b.querySelectorAll('[data-rec]')].map(x=>x.dataset.rec+':'+x.textContent)} : null;})()`, 30_000, '읽기 전용 띠').catch(() => null);
      if (!band) { return { ok: false, detail: `띠 없음 · project ${short(JSON.stringify((await act({ action: 'get_full_state' }))?.project), 300)}` }; }
      await shot('r17_locked_1920_dark');
      // AI 의 모델 편집(MCP 의 모델 동작) — 호스트가 거절하고 모델은 그대로
      const before = await mcp.tool('get_full_state');
      const sm = await mcp.tool('set_material', { E: 210000, v: 0.3, units: 'SI' });
      const after = await mcp.tool('get_full_state');
      const same = JSON.stringify(before.material) === JSON.stringify(after.material);
      return { ok: band.reason === 'locked-by-other-writer' && /다른 작성자가 잠그고 있다/.test(band.text) && /다른 설계자/.test(band.text) && band.scope && /입력 · 모델을 고치거나 다른 모델로 해석을 돌려도 받지 않는다/.test(band.text)
        && band.btns.includes('as-new:새 검토 대상으로') && band.btns.includes('take-lock:넘겨받기') && !!sm.error && same,
      detail: `띠 「${short(band.text.replace(/\s+/g, ' '), 140)}」 · 단추 ${band.btns.join(', ')} · AI 의 set_material → ${short(sm.error ?? '받음', 90)} · 재료 그대로 ${same}` };
    } finally {
      // 심은 잠금을 걷고 내 대상으로 돌아간다(뒤의 해석이 읽기 전용에 걸리지 않게)
      try { fs.rmSync(lockFile, { force: true }); } catch { /* 없음 */ }
      await act({ action: 'open_case', name: '퍼린 P1', report_units: 'SI' });
      await settle(`!!s.full && !!s.full.project && !!s.full.project.case && s.full.project.case.name==='퍼린 P1' && !s.full.project.case.readOnly`, '내 대상', 30_000).catch(() => undefined);
    }
  });

  await mcp.tool('set_boundary_condition', { BC: 'S-S' });
  await mcp.tool('run_analysis');
  await settle(`s.stages.fsm.state==='ok'`, '다시 해석', 120_000);
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
