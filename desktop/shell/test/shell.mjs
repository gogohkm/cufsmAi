// S3 · S4 시험 — Electron 껍데기(진짜 앱, 진짜 호스트 · Python).
//
// 이 PC 는 소유자의 작업 PC 다 — 사용자의 화면을 건드리지 않는다: 시험 모드(STCFSD_SHELL_TEST=1)는 창을 한 번도
// 보이지 않고(show:false, show() · focus() 를 부르지 않는다) 그 사실을 단계마다 확인한다. 자식(Python)은 콘솔 창 없이 뜬다.
// 사용자 폴더는 임시 폴더(--user-data, 공백 · 한글 포함), Claude 설정은 임시 폴더의 가짜, 모델은 임시 폴더의 사본만 연다.
//
//   cd desktop/shell && npm test
//   node desktop/shell/test/shell.mjs        (SHELL_VERBOSE=1 이면 껍데기 출력을 다 찍는다)
//
// 그림: desktop/shell/test/out/*.png(git 에 넣지 않음). 창은 보이지 않으므로 DevTools 프로토콜로 찍는다.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watchRealConfig } from '../../host/test/lib/realConfig.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const shellDir = path.resolve(here, '..');
const repoRoot = path.resolve(shellDir, '..', '..');
const OUT = path.join(here, 'out');
const VERBOSE = process.env.SHELL_VERBOSE === '1';
const electronPath = require(path.join(shellDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-shell-'));
const userData = path.join(tmp, 'user data 사용자');
const docs = path.join(tmp, 'Documents');
const modelDir = path.join(tmp, '모델 폴더');
const fakeClaudeDir = path.join(tmp, 'fake', 'Claude');
const fakeClaude = path.join(fakeClaudeDir, 'claude_desktop_config.json');
fs.mkdirSync(modelDir, { recursive: true });
fs.mkdirSync(docs, { recursive: true });
fs.mkdirSync(fakeClaudeDir, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) { if (f.endsWith('.png')) { fs.rmSync(path.join(OUT, f), { force: true }); } }
const copy = (src, name) => { const f = path.join(modelDir, name); fs.copyFileSync(src, f); return f; };
const FILE_A = copy(path.join(repoRoot, 'Example', 'test.csd'), '검토 사본 A.csd');
const FILE_B = copy(path.join(repoRoot, 'Example', 'test.csd'), '검토 사본 B.csd');
const FILE_C = copy(path.join(repoRoot, 'Example', 'test.csd'), '검토 사본 C.csd');
const portFile = path.join(userData, 'mcp', 'stcfsd-mcp-port');

const results = [];
const started = Date.now();
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  process.stdout.write(`${ok ? '  통과' : '  실패'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
  return !!ok;
}
const section = t => process.stdout.write(`\n▶ ${t}  (+${((Date.now() - started) / 1000).toFixed(1)} s)\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = (v, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };
async function until(probe, timeoutMs, stepMs = 150) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let v; try { v = await probe(); } catch { v = undefined; }
    if (v) { return v; }
    if (Date.now() > deadline) { return undefined; }
    await sleep(stepMs);
  }
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const statOf = f => { try { const s = fs.statSync(f); return `${s.size}:${s.mtimeMs}`; } catch { return '없음'; } };
const portFree = port => new Promise(resolve => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });

/** 이 PC 의 모든 프로세스(pid · ppid · 이름 · 창 핸들) */
function processTable() {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; [pscustomobject]@{pid=$_.ProcessId; ppid=$_.ParentProcessId; name=$_.Name; hwnd=$(if($p){[int64]$p.MainWindowHandle}else{0})} } | ConvertTo-Json -Compress"],
  { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch { return []; }
}
function descendants(rootPid, table = processTable()) {
  const out = []; const q = [rootPid];
  while (q.length) { const p = q.shift(); for (const row of table) { if (row.ppid === p && !out.some(o => o.pid === row.pid)) { out.push(row); q.push(row.pid); } } }
  return out;
}

function repoSnapshot() {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  const m = new Map();
  for (const part of r.stdout.split('\0').filter(Boolean)) {
    const file = part.slice(3);
    if (file.startsWith('desktop/')) { continue; }
    m.set(file, `${part.slice(0, 2)}|${statOf(path.join(repoRoot, file))}`);
  }
  return m;
}

// ── 앱 띄우기 ─────────────────────────────────────────────────────────
const launched = [];
function shellEnv() {
  const env = { ...process.env, STCFSD_SHELL_TEST: '1', STCFSD_DOCUMENTS: docs, STCFSD_CLAUDE_CONFIG: fakeClaude };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
async function launch(args, label) {
  const child = spawn(electronPath, [shellDir, '--user-data', userData, ...args], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: shellEnv(), windowsHide: true });
  launched.push(child);
  let out = '';
  const take = c => { out = (out + c).slice(-40_000); if (VERBOSE) { process.stdout.write(`    [${label}] ${c}`); } };
  child.stdout.on('data', take); child.stderr.on('data', take);
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let seq = 0;
  const pending = new Map();
  let stage;
  child.on('message', m => {
    if (m?.type === 'stage' || m?.type === 'fatal') { stage = m; return; }
    const p = pending.get(m?.id); if (p) { pending.delete(m.id); p(m); }
  });
  const call = (msg, timeoutMs = 120_000) => new Promise((resolve, reject) => {
    seq += 1; const id = seq;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${msg.type} 답 없음`)); }, timeoutMs);
    pending.set(id, m => { clearTimeout(t); m.ok ? resolve(m.result) : reject(new Error(m.error)); });
    child.send({ id, ...msg });
  });
  const ev = (code, timeoutMs) => call({ type: 'eval', code }, timeoutMs);
  const page = (js, timeoutMs) => ev(`return await ctx.win.webContents.executeJavaScript(${JSON.stringify(js)}, true);`, timeoutMs);
  // 끼운 설계 웹뷰는 다른 출처(다리의 웹뷰 서버)라 틀 문서에서 닿지 않는다 — 주 프로세스가 그 프레임(WebFrameMain)에서 직접 돌린다
  const designer = body => ev(`const mf = ctx.win.webContents.mainFrame;
    const f = mf.framesInSubtree.find(x => x !== mf && x.url.includes('/wv/' + encodeURIComponent(ctx.host.designer.id) + '/'));
    if (!f) { throw new Error('설계 웹뷰 프레임 없음'); }
    return await f.executeJavaScript(${JSON.stringify('(async()=>{const W=window;const D=document;BODY})()')}.replace('BODY', ${JSON.stringify(body)}), true);`);
  const capture = name => call({ type: 'capture', file: path.join(OUT, `${name}.png`) }).then(() => path.join(OUT, `${name}.png`));
  const ok = await until(() => stage, 120_000, 200);
  if (!ok || stage.type === 'fatal') { throw new Error(`앱이 뜨지 않았다(${label}): ${short(stage ?? out.slice(-1500), 1500)}`); }
  return { child, pid: child.pid, stage, ev, page, designer, capture, exited, out: () => out };
}
async function quit(app, label) {
  const kids = descendants(app.pid);
  await app.ev('setTimeout(() => ctx.app.quit(), 50); return true;').catch(() => undefined);
  const exit = await Promise.race([app.exited, sleep(30_000).then(() => undefined)]);
  for (let i = 0; i < 100 && kids.some(k => alive(k.pid)); i++) { await sleep(100); }
  const left = kids.filter(k => alive(k.pid));
  check(`${label}: 끝내기 → 코드 0 · 자식(Electron 보조 · Python) 0`, exit?.code === 0 && left.length === 0,
    `${exit ? `코드 ${exit.code}` : '30 초 안에 안 끝남'} · 자식 ${kids.length}개(${[...new Set(kids.map(k => k.name))].join(', ')}) 중 남음 ${left.map(k => `${k.name}#${k.pid}`).join(', ') || '0'}`);
  if (!exit) { spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true }); }
}
/** 화면 배율(DPI)에 따라 창 크기가 1 – 몇 px 반올림된다 */
const near = (a, b, tol = 8) => Math.abs(a - b) <= tol;
const quiet = async (app, when) => {
  const s = await app.ev('return { visible: ctx.win.isVisible(), focused: ctx.win.isFocused(), show: ctx.diag.showEvents, focus: ctx.diag.focusEvents, front: ctx.diag.broughtToFront, minimized: ctx.win.isMinimized() };');
  check(`창은 보이지 않고 포커스를 받은 적이 없다 — ${when}`, !s.visible && !s.focused && s.show === 0 && s.focus === 0, JSON.stringify(s));
  return s;
};

/** MCP stdio 클라이언트 — 이 Electron 실행 파일을 ELECTRON_RUN_AS_NODE=1 로(Claude Desktop 이 하는 그대로) */
function startMcpClient(entry) {
  const env = { ...process.env, ...entry.env };
  delete env.STCFSD_MCP_PORT;
  const child = spawn(entry.command, entry.args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buf = ''; let err = '';
  const pending = new Map(); let seq = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', c => {
    buf += c; let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) { continue; }
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  child.stderr.on('data', c => { err += c; });
  const request = (method, params, timeoutMs = 60_000) => new Promise((resolve, reject) => {
    seq += 1; const id = seq;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 시간 초과 ${err.slice(-300)}`)); }, timeoutMs);
    pending.set(id, m => { clearTimeout(t); resolve(m); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const tool = async (name, args = {}) => {
    const r = await request('tools/call', { name, arguments: args });
    return { isError: !!r.result?.isError, text: r.result?.content?.find(c => c.type === 'text')?.text ?? JSON.stringify(r.error ?? r) };
  };
  const close = () => new Promise(resolve => { if (child.exitCode !== null) { resolve(); return; } child.once('exit', () => resolve()); child.stdin.end(); setTimeout(() => child.kill(), 2000).unref(); });
  return { child, request, tool, notify: (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`), close };
}

/** 실린 MCP 서버 묶음이 내놓는 도구 수 — 묶음 안의 `<서버>.tool("이름",` 를 센다(숫자를 박아 두지 않는다) */
function declaredTools(bundle) {
  const src = fs.readFileSync(bundle, 'utf8');
  return new Set([...src.matchAll(/\.tool\("([a-z0-9_]+)",/g)].map(m => m[1])).size;
}

async function main() {
  const real = watchRealConfig(repoRoot, [path.join(process.env.APPDATA || '', 'stcfsd-shell'), path.join(process.env.APPDATA || '', 'Electron')]);
  const repoBefore = repoSnapshot();
  let A; let B; let C; let mcp;
  try {
    section('0. 쓸 수 없는 사용자 폴더 — 말없이 끝나지 않고 오류 상자 길로(V5-11, 시험은 보이지 않는다)');
    {
      const asFile = path.join(tmp, '사용자 폴더 자리에 파일');
      fs.writeFileSync(asFile, 'x');
      const denied = path.join(tmp, '쓰기 거부 폴더');
      fs.mkdirSync(denied);
      const acl = spawnSync('icacls', [denied, '/deny', `${process.env.USERNAME}:(OI)(CI)(W,AD,WD)`], { windowsHide: true, encoding: 'utf8' });
      const runBad = ud => new Promise(resolve => {
        const c = spawn(electronPath, [shellDir, '--user-data', ud], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: shellEnv(), windowsHide: true });
        launched.push(c);
        const msgs = []; let err = '';
        c.on('message', m => msgs.push(m)); c.stderr.on('data', d => { err += d; }); c.stdout.on('data', () => {});
        const timer = setTimeout(() => c.kill(), 30_000);
        c.on('exit', code => { clearTimeout(timer); resolve({ code, fatal: msgs.find(m => m.type === 'fatal'), stage: msgs.find(m => m.type === 'stage'), err }); });
      });
      for (const [label, ud] of [['자리에 파일', asFile], ['쓰기 거부 ACL', denied]]) {
        const r = await runBad(ud);
        check(`V5-11 · 사용자 폴더 ${label} → 오류 상자 길(폴더 · 까닭을 알림), 창 없이 끝남`, r.code === 4 && r.fatal?.kind === 'userdata' && r.fatal.detail.includes(ud) && /까닭:/.test(r.fatal.detail) && !r.stage,
          `코드 ${r.code} · ${short(r.fatal?.detail?.split('\n').slice(2, 4).join(' / '), 160)}${label.includes('ACL') && acl.status !== 0 ? ` · icacls 실패 ${acl.stderr}` : ''}`);
      }
      spawnSync('icacls', [denied, '/remove:d', process.env.USERNAME], { windowsHide: true });
    }

    section('1. 띄우기 — 파일 연결 꼴(StCFSD.exe 파일.csd), 보이지 않게');
    let t = Date.now();
    A = await launch([FILE_A], 'A');
    check('앱이 뜬다(호스트 · 다리 · 창이 한 프로세스)', A.stage.stage === 'running', `${Date.now() - t} ms · ${A.stage.origin}`);
    check('MCP 포트 파일이 시험의 사용자 폴더 안에', A.stage.portFile === portFile && fs.existsSync(portFile), portFile);
    const opened = await until(() => A.ev('return ctx.diag.opened.length ? ctx.diag.opened : null;'), 30_000);
    check('명령줄의 .csd 를 연다', opened?.[0]?.ok && opened[0].file === FILE_A, short(opened?.[0]?.message ?? '', 100));
    const loaded = await until(async () => (await A.designer(`return D.documentElement.getAttribute('data-stcfsd-bridge')==='connected' && D.documentElement.hasAttribute('data-stcfsd-replayed')
        && D.querySelectorAll('#section-svg circle').length > 3;`)) ? A.page(`document.getElementById('file-name').textContent`) : null, 60_000);
    check('창 안에서 틀과 설계 화면이 뜨고 단면이 그려진다(Bearer 머리 · 쿠키 없음)', loaded === path.basename(FILE_A), `제목 표시줄 파일 이름 "${loaded}"`);
    const cookies = await A.ev('return (await ctx.win.webContents.session.cookies.get({})).length;');
    const sec = await A.ev(`const p = ctx.win.webContents.getLastWebPreferences(); return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webviewTag: p.webviewTag, persist: ctx.win.webContents.session.isPersistent() };`);
    check('보안 설정 — contextIsolation · sandbox · nodeIntegration 없음 · 메모리 세션 · 쿠키 0', sec.contextIsolation && sec.sandbox && !sec.nodeIntegration && !sec.webviewTag && !sec.persist && cookies === 0, `${JSON.stringify(sec)} · 쿠키 ${cookies}`);
    // 페이지의 바깥 요청은 다리 페이지의 CSP(connect-src 'self')가 먼저 막는다. 세션의 둘째 울타리(webRequest)는 그 세션으로 직접 요청해 본다.
    const nav = await A.ev(`const before = ctx.diag.blockedNavigations.length;
      await ctx.win.webContents.executeJavaScript("window.open('https://example.com/x'); location.href='https://example.com/nav'; 1").catch(()=>0);
      let fetchErr = ''; try { await ctx.win.webContents.session.fetch('https://example.com/y'); } catch (e) { fetchErr = String(e && e.message || e); }
      await new Promise(r=>setTimeout(r,800));
      return { blocked: ctx.diag.blockedNavigations.slice(before), external: ctx.diag.externalOpened, url: ctx.win.webContents.getURL(), fetchErr };`);
    check('바깥 주소는 막는다 — 새 창 · 이동(OS 브라우저로 넘김, 시험은 열지 않음) · 세션의 바깥 요청', nav.blocked.some(b => /window https:\/\/example\.com\/x/.test(b))
      && nav.blocked.some(b => /navigate https:\/\/example\.com\/nav/.test(b)) && /BLOCKED|blocked/i.test(nav.fetchErr) && nav.url.startsWith(A.stage.origin),
    `${short(nav.blocked, 140)} · 세션 요청 "${short(nav.fetchErr, 60)}" · 창 주소 ${nav.url}`);
    // V5-18b (Electron) — 끼운 웹뷰 안의 스크립트는 쓰기 경로 · 틀 문서에 닿지 않는다. 쓰기 열쇠는 주 프로세스가 맨 위 프레임 요청에만 붙인다.
    {
      const cfgSnap = () => (fs.existsSync(fakeClaude) ? fs.readFileSync(fakeClaude).toString('base64') : '없음');
      const cfgBefore = cfgSnap();
      const r = await A.designer(`const out={}; const o=${JSON.stringify(A.stage.origin)};
        const t=async(k,f)=>{try{const x=await f(); out[k]=x&&typeof x==='object'&&'status' in x?'HTTP '+x.status+(x.type==='opaque'?' opaque':''):String(x);}catch(e){out[k]='거절: '+e.name;}};
        await t('상대 경로', ()=>fetch('/api/claude/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
        await t('틀 출처', ()=>fetch(o+'/api/claude/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
        await t('틀 출처 no-cors', ()=>fetch(o+'/api/claude/connect',{method:'POST',mode:'no-cors',body:'{}'}));
        await t('열쇠', ()=>fetch(o+'/api/wv-key'));
        await t('부모 문서', ()=>W.parent.document.title);
        out.origin=location.origin; return out;`);
      await sleep(400);
      const keyed = await A.ev('return ctx.diag.keyedRequests;');
      const fine = v => /^거절/.test(v) || /HTTP 40[34]/.test(v) || / opaque$/.test(v);
      check('V5-18b(창) · 끼운 웹뷰는 다른 출처 — 어떤 길로도 「연결」 · 열쇠 · 틀 문서에 닿지 않는다(설정 그대로) · 쓰기 열쇠는 맨 위 프레임 요청에만',
        r.origin !== A.stage.origin && Object.entries(r).filter(([k]) => k !== 'origin').every(([, v]) => fine(v)) && cfgBefore === cfgSnap() && keyed > 0,
        `${short(r, 260)} · 열쇠 붙인 요청 ${keyed}`);
    }
    // V5b-04 (창) — 끼운 웹뷰가 맨 위 창을 옮기려 해도(top.location · target=_top 폼 · window.open(_top) · target=_top 링크)
    // 창은 앱 화면에 머물고, 쓰기 열쇠를 단 요청은 하나도 나가지 않는다(열쇠는 맨 위 문서의 fetch/XHR 에만)
    {
      const cfgSnap = () => (fs.existsSync(fakeClaude) ? fs.readFileSync(fakeClaude).toString('base64') : '없음');
      const cfg0 = cfgSnap();
      const url0 = await A.ev('return ctx.win.webContents.getURL();');
      const k0 = await A.ev('return (ctx.diag.keyedLog ?? []).length;');
      const b0 = await A.ev('return ctx.diag.blockedNavigations.length;');
      const o = A.stage.origin;
      const tries = [
        `W.top.location = ${JSON.stringify(`${o}/api/wv-key?id=x`)};`,
        `const f=D.createElement('form'); f.method='POST'; f.action=${JSON.stringify(`${o}/api/claude/connect`)}; f.target='_top'; D.body.appendChild(f); f.submit();`,
        `W.open(${JSON.stringify(`${o}/api/claude/connect`)}, '_top');`,
        `const a=D.createElement('a'); a.href=${JSON.stringify(`${o}/api/wv-key?id=y`)}; a.target='_top'; D.body.appendChild(a); a.click();`,
      ];
      for (const t of tries) { await A.designer(`try{${t}}catch(e){} await new Promise(r=>setTimeout(r,700)); return 1;`).catch(() => undefined); }
      await sleep(800);
      const after = await A.ev(`return { url: ctx.win.webContents.getURL(), keyed: (ctx.diag.keyedLog ?? []).slice(${k0}), blocked: ctx.diag.blockedNavigations.slice(${b0}) };`);
      const keyedNav = after.keyed.filter(k => k.type !== 'xhr' || /\/api\/(claude\/connect|wv-key)/.test(k.path));
      const stillApp = after.url === url0 && await A.page(`!!document.getElementById('designer')`).catch(() => false);
      check('V5b-04 · 끼운 웹뷰가 맨 위 창을 옮기려는 네 길 — 창은 앱 화면 그대로 · 막은 이동 4 · 쓰기 열쇠를 단 이동 · 열쇠 요청 0 · 설정 그대로',
        stillApp && after.blocked.filter(b => /^navigate /.test(b)).length >= 4 && keyedNav.length === 0 && cfg0 === cfgSnap(),
        `창 ${after.url === url0 ? '그대로' : after.url} · 막음 ${short(after.blocked, 200)} · 열쇠 단 것 ${short(after.keyed, 160)}`);
    }
    const shot1 = await A.capture('s3_01_window_loaded');
    check('보이지 않는 창의 화면을 찍는다(invalidate → DevTools 프로토콜)', fs.statSync(shot1).size > 20_000, `${path.basename(shot1)} ${fs.statSync(shot1).size} bytes`);
    await quiet(A, '띄운 뒤');

    section('2. 창 안에서 해석 → 설계(DOM)');
    const S = (id, v) => A.designer(`const e=D.getElementById(${JSON.stringify(id)}); if(!e) return 'MISSING'; if(e.type==='checkbox'){e.checked=!!${JSON.stringify(v)};} else {e.value=${JSON.stringify(String(v))};}
      e.dispatchEvent(new W.Event('input',{bubbles:true})); e.dispatchEvent(new W.Event('change',{bubbles:true})); return 'ok';`);
    const click = sel => A.designer(`const e=D.querySelector(${JSON.stringify(sel)}); if(!e) return 'MISSING'; e.click(); return 'ok';`);
    const count = cmd => A.ev(`return ctx.host.messageCounts()[${JSON.stringify(cmd)}] ?? 0;`);
    const waitCount = async (cmd, n, ms = 300_000) => until(async () => ((await count(cmd)) > n ? true : undefined), ms, 300);
    await click('#btn-unit-US');
    await click('.tab-btn[data-tab="preprocessor"]');
    await S('select-template', 'lippedc');
    for (const [k, v] of Object.entries({ 'tpl-H': 8, 'tpl-B': 2.5, 'tpl-D': 0.625, 'tpl-t': 0.059, 'tpl-r': 0.1 })) { await S(k, v); }
    await S('input-fy', 50); await S('input-fu', 65);
    let n = await count('templateGenerated');
    await click('#btn-generate-template');
    await waitCount('templateGenerated', n, 60_000);
    await click('.tab-btn[data-tab="design"]');
    n = await count('analysisComplete');
    t = Date.now();
    await click('#btn-run-analysis');
    const analysed = await waitCount('analysisComplete', n);
    check('해석 실행 단추 → 좌굴 해석', analysed, `${Date.now() - t} ms`);
    await click('.tab-btn[data-tab="loads"]');
    await S('select-member-type', 'flexure');
    await click('.tab-btn[data-tab="design"]');
    for (const [k, v] of Object.entries({ 'design-Mx': 40, 'design-V': 1, 'design-Lb': 60, 'design-Cb': 1.0, 'design-P': 0 })) { await S(k, v); }
    n = await count('designResult');
    await click('#btn-run-design');
    await waitCount('designResult', n, 300_000);
    await sleep(800);
    const card = await A.designer(`const e=D.getElementById('design-summary'); e.scrollIntoView(); return e.innerText;`);
    check('설계 검토 실행 단추 → 판정 카드', /OK|NG|판정 없음/.test(card ?? ''), short(card, 100));
    await A.capture('s3_02_design');

    section('3. 메뉴 「저장」 · 「열기」 — OS 대화상자(시험이 답을 넣는다)');
    const saved = path.join(tmp, 'saved', '메뉴 저장.csd');
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    await A.ev(`ctx.dialog.showSaveDialog = async (...a) => { const o = a.length > 1 ? a[1] : a[0]; ctx.diag.lastSaveOptions = o; return { canceled: false, filePath: ${JSON.stringify(saved)} }; }; return ctx.menuClick('file-save');`);
    const savedOk = await until(() => (fs.existsSync(saved) ? true : undefined), 30_000);
    const sj = savedOk ? JSON.parse(fs.readFileSync(saved, 'utf8')) : {};
    const saveOpts = await A.ev('return ctx.diag.lastSaveOptions;');
    await sleep(500);
    const title1 = await A.page(`document.getElementById('file-name').textContent`);
    check('메뉴 저장 → 화면이 입력을 모으고 → OS 저장 대화상자 → 파일', savedOk && Object.keys(sj.designInputs ?? {}).length > 50 && !!sj.analysisResult && !!sj.designResult,
      `설계 입력 ${Object.keys(sj.designInputs ?? {}).length}칸 · 해석 ${!!sj.analysisResult} · 설계 ${!!sj.designResult}`);
    check('저장 대화상자의 기본 자리 = 문서 폴더(문서\\StCFSD 가 없으면 만들지 않고 문서)', saveOpts?.defaultPath === path.join(docs, 'project.csd') && !fs.existsSync(path.join(docs, 'StCFSD'))
      && /csd/.test(JSON.stringify(saveOpts.filters)), `${saveOpts?.defaultPath} · 제목 표시줄 "${title1}"`);
    await A.ev(`ctx.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(FILE_B)}] }); return ctx.menuClick('file-open');`);
    const title2 = await until(async () => { const v = await A.page(`document.getElementById('file-name').textContent`); return v === path.basename(FILE_B) ? v : undefined; }, 30_000);
    check('메뉴 열기 → OS 열기 대화상자 → 파일이 열리고 제목 표시줄이 따라간다', title2 === path.basename(FILE_B), title2 ?? '바뀌지 않음');

    section('3b. 아직 호스트에 가지 않은 설계 탭 입력 — 메뉴의 테마 · 새로 고침 뒤에도 그대로(V5-03)');
    await S('design-Lb', 77.7);
    const lb0 = await A.designer(`return D.getElementById('design-Lb').value;`);
    await A.ev(`return ctx.menuClick('theme-light');`);
    const themed = await until(() => A.designer(`return D.documentElement.getAttribute('data-stcfsd-theme')==='light' ? {lb: D.getElementById('design-Lb').value, kind: D.body.getAttribute('data-vscode-theme-kind')} : null;`), 10_000);
    const frameLight = await A.page(`document.documentElement.classList.contains('light')`);
    await A.ev(`return ctx.menuClick('reload');`);
    await sleep(800);
    const restored = await until(() => A.designer(`return D.documentElement.getAttribute('data-stcfsd-preserved')==='restored' ? D.getElementById('design-Lb').value : null;`), 30_000);
    const pendingQ = await A.ev('return ctx.platform.snapshot().pending.length;');
    check('V5-03 · 설계 탭 Lb 77.7 → 메뉴 「밝은 테마」(다시 싣지 않음) → 그대로 → 메뉴 「새로 고침」 → 그대로(저장 물음 없음)',
      lb0 === '77.7' && themed?.lb === '77.7' && themed.kind === 'vscode-light' && frameLight === true && restored === '77.7' && pendingQ === 0,
      `입력 ${lb0} → 테마 뒤 ${themed?.lb}(${themed?.kind}, 틀 밝음 ${frameLight}) → 새로 고침 뒤 ${restored} · 뜬 물음 ${pendingQ}`);
    await A.ev(`return ctx.menuClick('theme-dark');`);
    await quiet(A, '테마 · 새로 고침 뒤');

    section('4. 호스트의 물음 — 창을 앞으로 꺼내지 않고 제목 · 작업 표시줄로만');
    const before = await A.ev('return { q: ctx.diag.questionSignals, f: ctx.diag.flashCalls };');
    await A.ev(`ctx.__q = ctx.platform.notify({ severity: 'warning', message: '시험 물음 — 계속할까요?', items: ['예', '아니오'], modal: false }); globalThis.__shellQ = ctx.__q; return true;`);
    const shown = await until(() => A.page(`(()=>{const d=document.querySelector('#dialog-host .dialog'); return d ? document.title : null;})()`), 15_000);
    await A.capture('s3_03_question');
    const winTitle = await A.ev('return ctx.win.getTitle();');
    await A.page(`document.querySelector('#dialog-host [data-item="예"]').click(); 1`);
    const answer = await A.ev('return await globalThis.__shellQ;');
    await until(() => A.ev("return /응답 필요/.test(ctx.win.getTitle()) ? null : true;"), 10_000);
    const after = await A.ev('return { q: ctx.diag.questionSignals, f: ctx.diag.flashCalls, title: ctx.win.getTitle() };');
    check('물음이 뜨면 창 제목에 「● 응답 필요」, 작업 표시줄 깜빡임 신호(포커스 없음)', /^● 응답 필요/.test(shown ?? '') && /^● 응답 필요/.test(winTitle)
      && after.q === before.q + 1 && after.f === before.f + 1, `제목 "${winTitle}" · 깜빡임 ${before.f}→${after.f}`);
    check('화면에서 답하면 호스트에 그 답이 가고 표시가 사라진다', answer === '예' && !/응답 필요/.test(after.title), `답 ${answer} · 제목 "${after.title}"`);
    await quiet(A, '물음 뒤');

    section('5. 한 번만 실행 — 두 번째 실행은 파일을 넘기고 끝난다');
    t = Date.now();
    const second = spawn(electronPath, [shellDir, '--user-data', userData, FILE_C], { stdio: 'ignore', env: shellEnv(), windowsHide: true });
    launched.push(second);
    const secondExit = await Promise.race([new Promise(r => second.once('exit', c => r(c))), sleep(30_000).then(() => 'timeout')]);
    const handed = await until(() => A.ev(`return ctx.diag.opened.find(o => o.file === ${JSON.stringify(FILE_C)}) ?? null;`), 30_000);
    const si = await A.ev('return { second: ctx.diag.secondInstances, front: ctx.diag.broughtToFront };');
    check('두 번째 실행은 곧 끝나고(코드 0) 첫 프로세스가 그 파일을 연다', secondExit === 0 && handed?.ok && si.second.some(s => s.open === FILE_C),
      `${Date.now() - t} ms · 코드 ${secondExit} · 받은 것 ${short(si.second, 120)}`);
    await quiet(A, '두 번째 실행 뒤(시험은 앞으로 꺼내지 않는다)');
    // V5-12b · 여러 파일을 한 번에 넘기면 첫 것만 열고 나머지는 열지 않았다고 알린다
    const openedBefore = await A.ev('return ctx.diag.opened.length;');
    const multi = spawn(electronPath, [shellDir, '--user-data', userData, FILE_B, FILE_A], { stdio: 'ignore', env: shellEnv(), windowsHide: true });
    launched.push(multi);
    await Promise.race([new Promise(r => multi.once('exit', r)), sleep(30_000)]);
    const mOpened = await until(() => A.ev(`return ctx.diag.opened.some((o, i) => i >= ${openedBefore} && o.file === ${JSON.stringify(FILE_B)} && o.ok) && ctx.diag.notOpened.length ? ctx.diag : null;`), 30_000);
    const mToast = await until(() => A.page(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).find(t=>/한 번에 하나만/.test(t)) || null`), 10_000);
    check('V5-12b · 여러 파일 → 첫 파일만 열고 「열지 않았다」 알림(파일 이름 포함)', !!mOpened && mOpened.notOpened.includes(FILE_A) && /검토 사본 A\.csd/.test(mToast ?? ''),
      `열지 않음 ${short(mOpened?.notOpened, 120)} · 알림 "${short(mToast, 120)}"`);

    section('6. 창 위치 · 크기 기억');
    await A.ev('ctx.win.setBounds({ x: 137, y: 91, width: 1213, height: 777 }); return true;');
    await sleep(900);
    await quiet(A, 'setBounds 뒤');
    await quit(A, 'A');
    const ws = JSON.parse(fs.readFileSync(path.join(userData, 'window.json'), 'utf8'));
    check('끝낼 때 window.json 에 위치 · 크기(배율 반올림 ±8 px)', near(ws.bounds.x, 137) && near(ws.bounds.y, 91) && near(ws.bounds.width, 1213) && near(ws.bounds.height, 777), JSON.stringify(ws.bounds));
    check('끝낸 뒤 포트 파일이 지워졌다', !fs.existsSync(portFile));

    // V5-12a · 시작 중(호스트 · Python 이 뜨는 동안)에 다른 파일로 다시 실행 → 버리지 않고 차례로 연다
    const bLaunch = launch([FILE_A], 'B');
    await sleep(1500);
    const early = spawn(electronPath, [shellDir, '--user-data', userData, FILE_B], { stdio: 'ignore', env: shellEnv(), windowsHide: true });
    launched.push(early);
    const earlyExit = await Promise.race([new Promise(r => early.once('exit', c => r(c))), sleep(30_000).then(() => 'timeout')]);
    B = await bLaunch;
    const bOpened = await until(() => B.ev(`return ctx.diag.opened.length >= 2 ? { opened: ctx.diag.opened.map(o => o.file), ok: ctx.diag.opened.every(o => o.ok), queued: ctx.diag.queuedWhileStarting } : null;`), 30_000);
    check('V5-12a · 시작 중의 두 번째 파일을 버리지 않는다 — 명령줄 파일 다음에 차례로 연다', earlyExit === 0 && !!bOpened && bOpened.ok
      && bOpened.opened[0] === FILE_A && bOpened.opened[1] === FILE_B && bOpened.queued.includes(FILE_B),
      `두 번째 프로세스 코드 ${earlyExit} · 연 차례 ${short(bOpened?.opened.map(f => path.basename(f)), 120)} · 시작 중 받은 것 ${short(bOpened?.queued.map(f => path.basename(f)), 80)}`);
    const pb = await B.ev('return { placement: ctx.placement, bounds: ctx.win.getBounds() };');
    check('다시 띄우면 저장한 자리 · 크기', pb.placement.where === 'saved' && near(pb.bounds.x, ws.bounds.x) && near(pb.bounds.y, ws.bounds.y) && near(pb.bounds.width, ws.bounds.width) && near(pb.bounds.height, ws.bounds.height), `저장 ${JSON.stringify(ws.bounds)} → ${JSON.stringify(pb.bounds)}`);

    section('7. Claude 연결(S4) — 「연결」 단추 · 진짜 Electron 실행 파일로 MCP 서버');
    const st0 = await until(() => B.page(`(()=>{const b=document.getElementById('claude-action'); return b && !b.hidden ? {status:document.getElementById('claude-status').textContent, button:b.textContent, disabled:b.disabled, tip:b.title} : null;})()`), 20_000);
    check('제목 표시줄: 「Claude 등록 안 됨」 + 「연결」(풍선 도움말)', /등록 안 됨/.test(st0?.status ?? '') && st0.button === '연결' && !st0.disabled && /등록/.test(st0.tip), JSON.stringify(st0));
    await B.page(`document.getElementById('claude-action').click(); 1`);
    const st1 = await until(() => B.page(`(()=>{const s=document.getElementById('claude-status').textContent; const toast=[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' | '); return /다시 시작/.test(s) && /다시 시작/.test(toast) ? {status:s, button:document.getElementById('claude-action').textContent, toast:[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' | ')} : null;})()`), 15_000);
    const cfg = JSON.parse(fs.readFileSync(fakeClaude, 'utf8'));
    const entry = cfg.mcpServers?.stcfsd;
    check('「연결」 → 가짜 설정에 mcpServers.stcfsd = 이 Electron 실행 파일 + ELECTRON_RUN_AS_NODE + MCP 서버 + 포트 파일',
      entry?.command === electronPath && entry.args?.[0] === path.join(repoRoot, 'media', 'mcp-server.js') && entry.env?.ELECTRON_RUN_AS_NODE === '1'
      && entry.env?.STCFSD_MCP_PORT_FILE === portFile && entry.env?.STCFSD_MCP_STANDALONE === '1', short(entry, 260));
    check('「연결」 뒤: 「Claude Desktop 다시 시작 필요」를 알리고 단추는 「끊기」', !!st1 && st1.button === '끊기' && /다시 시작/.test(st1.toast), JSON.stringify(st1));
    await B.capture('s3_04_connected');

    t = Date.now();
    mcp = startMcpClient(entry);
    const init = await mcp.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-desktop-sim', version: '0' } });
    mcp.notify('notifications/initialized', {});
    const tools = await mcp.request('tools/list', {});
    const gs = await mcp.tool('get_status');
    check('그 항목 그대로 Electron 실행 파일(ELECTRON_RUN_AS_NODE=1)로 MCP 서버 → initialize · tools/list · get_status',
      !!init.result && (tools.result?.tools?.length ?? 0) === declaredTools(entry.args[0]) && declaredTools(entry.args[0]) >= 60 && !gs.isError && /"nnodes"/.test(gs.text),
      `${Date.now() - t} ms · ${init.result?.serverInfo?.name} · 도구 ${tools.result?.tools?.length} / 묶음이 내놓는 ${declaredTools(entry.args[0])} · ${short(gs.text.replace(/\s+/g, ' '), 60)}`);
    const st2 = await until(() => B.page(`(()=>{const s=document.getElementById('claude-status').textContent; return /연결됨/.test(s) ? s : null;})()`), 20_000, 500);
    check('AI 호출 뒤 제목 표시줄: 「Claude 연결됨 · 마지막 호출 <시각> · <클라이언트>」', /연결됨 · 마지막 호출 \d\d:\d\d · claude-desktop-sim/.test(st2 ?? ''), st2 ?? '바뀌지 않음');
    await B.capture('s3_05_last_call');
    await quiet(B, 'Claude 연결 뒤');

    section('8. 프로그램이 꺼지면 · 다시 켜지면(같은 MCP 클라이언트)');
    await quit(B, 'B');
    const down = await mcp.tool('get_status');
    check('꺼진 동안: AI 가 쉬운 말의 오류를 받는다(요청을 보내지 않음)', down.isError && /The StCFSD program is not running/.test(down.text), short(down.text, 140));
    // 창 자리를 화면 밖으로 옮겨 두고 다시 띄운다 — 모니터 구성이 바뀐 경우
    fs.writeFileSync(path.join(userData, 'window.json'), JSON.stringify({ bounds: { x: 60000, y: 40000, width: 1300, height: 800 }, maximized: false, displayId: 999999 }));
    C = await launch([], 'C');
    const pc = await C.ev('return { placement: ctx.placement, bounds: ctx.win.getBounds(), work: ctx.screen.getPrimaryDisplay().workArea };');
    const inside = pc.bounds.x >= pc.work.x && pc.bounds.y >= pc.work.y && pc.bounds.x + pc.bounds.width <= pc.work.x + pc.work.width + 1;
    check('모니터 밖에 저장된 자리면 주 모니터 안으로(같은 크기)', pc.placement.where === 'primary-fallback' && inside && near(pc.bounds.width, 1300) && near(pc.bounds.height, 800), `${JSON.stringify(pc.bounds)} · 작업 영역 ${JSON.stringify(pc.work)}`);
    const gated = await mcp.tool('get_dsm_values', { load_type: 'P' });
    check('다시 켠 뒤 첫 다른 호출은 거절(다시 시작 막기)', gated.isError && /restarted since your last call/.test(gated.text), short(gated.text, 120));
    const status2 = await mcp.tool('get_status');
    check('get_status 는 통과하고 restart_notice 를 붙인다', !status2.isError && /restart_notice/.test(status2.text), short(status2.text.replace(/\s+/g, ' '), 100));
    const after2 = await mcp.tool('get_dsm_values', { load_type: 'P' });
    check('그 뒤 다른 호출은 이 프로그램에 간다', !/restarted since your last call|not running/.test(after2.text), short(after2.text.replace(/\s+/g, ' '), 100));
    await mcp.close(); mcp = undefined;

    section('9. 「끊기」 · 끝');
    await until(() => C.page(`(()=>{const b=document.getElementById('claude-action'); return b && b.textContent==='끊기' && !b.disabled ? true : null;})()`), 20_000);
    await C.page(`document.getElementById('claude-action').click(); 1`);
    const disc = await until(() => C.page(`(()=>{const s=document.getElementById('claude-status').textContent; return /등록 안 됨/.test(s) ? s : null;})()`), 15_000);
    const cfg2 = JSON.parse(fs.readFileSync(fakeClaude, 'utf8'));
    check('「끊기」 → 우리 항목만 지운다', !!disc && !('stcfsd' in (cfg2.mcpServers ?? {})), `${disc} · ${JSON.stringify(cfg2)}`);
    const pyHidden = descendants(C.pid).filter(r => /python|conhost/i.test(r.name));
    check('Python 자식에 콘솔 창이 없다(MainWindowHandle 0)', pyHidden.some(r => /python/i.test(r.name)) && pyHidden.every(r => Number(r.hwnd) === 0),
      pyHidden.map(r => `${r.name}#${r.pid} hwnd=${r.hwnd}`).join(', '));
    const consoleErrs = await C.ev(`return ctx.diag.rendererConsole.filter(c => c.level === 'error');`);
    check('창의 콘솔 오류 0', consoleErrs.length === 0, consoleErrs.map(c => short(c.message, 100)).join(' / ') || '0');
    await quiet(C, '끝내기 전');
    const ports = { bridge: Number(new URL(C.stage.origin).port), mcp: JSON.parse(fs.readFileSync(portFile, 'utf8')).port };
    await quit(C, 'C');
    check('다리 · MCP 포트가 풀리고 포트 파일이 지워졌다', await portFree(ports.bridge) && await portFree(ports.mcp) && !fs.existsSync(portFile), JSON.stringify(ports));
  } catch (err) {
    check('시험이 예외 없이 끝난다', false, String(err?.stack ?? err).slice(0, 1500));
  } finally {
    try { await mcp?.close(); } catch { /* */ }
    for (const p of launched) { if (p.exitCode === null && p.pid) { spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }); } }
  }

  section('10. 남은 것 · 진짜 설정 자리 · 저장소');
  await sleep(500);
  const table = processTable();
  const leftovers = launched.flatMap(p => [p.pid, ...descendants(p.pid, table).map(d => d.pid)]).filter(pid => pid && alive(pid));
  check('띄운 Electron · Python 이 하나도 남지 않았다', leftovers.length === 0, leftovers.join(', ') || `${launched.length}번 띄움`);
  const changed = real.changed();
  check('진짜 Claude Desktop · MCP 설정 · %APPDATA%\\StCFSD 그대로(크기 · 시각, ~/.claude.json 은 MCP 등록만)', changed.length === 0, changed.join(', ') || `${real.list.length}곳`);
  const repoChanged = [...repoSnapshot()].filter(([k, v]) => repoBefore.get(k) !== v).map(([k]) => k);
  check('desktop/ 밖에서 저장소가 바뀌지 않았다', repoChanged.length === 0, repoChanged.join(', ') || '그대로');
  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = results.filter(r => !r.ok);
  process.stdout.write(`\n결과: ${results.length - failed.length}/${results.length} 통과 · ${((Date.now() - started) / 1000).toFixed(1)} s · 그림 ${OUT}\n`);
  if (failed.length) { process.stdout.write(`실패: ${failed.map(f => f.name).join(' / ')}\n`); process.exitCode = 1; }
}

main().catch(err => { process.stdout.write(`실패  예외: ${err?.stack ?? err}\n`); process.exit(1); });
