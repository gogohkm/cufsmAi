// S5 확인 — 설치하지 않고 설치본을 확인한다.
//
// 이 PC 는 소유자의 작업 PC 다: 설치 파일을 돌리지 않는다(레지스트리 · 시작 메뉴 · 파일 연결 · 전역 설치 없음).
// 대신
//  1. electron-builder 가 만든 풀린 폴더(win-unpacked)를 공백 · 한글이 든 임시 경로(…\시험 폴더 (공백)\StCFSD)로 복사해
//     그 StCFSD.exe 를 **보이지 않게**(시험 모드 — 창 show:false, 한 번도 show · focus 하지 않음) 띄운다. 사용자 폴더는 임시.
//     PATH 에서 Python 이 든 자리를 모두 빼고 PYTHON* 변수를 지운다 — 묶은 Python 만 쓸 수 있게. 저장소의 .venv 는 복사본에 없다.
//  2. 설치 파일(NSIS)은 들여다보기만 한다: 크기, Bandizip 콘솔(bz.exe)로 목록, 안의 app-64.7z 를 임시 폴더에 꺼내 목록을 만들어
//     묶음 준비 목록(stage/manifest.json) · Python 묶음과 맞춰 본다.
//  3. 저장소(desktop/ 밖) · 사용자의 진짜 설정 · %APPDATA%\StCFSD 가 그대로인지 본다.
//
//   node desktop/installer/test/packaged.mjs      (먼저 node desktop/installer/build.mjs --all 또는 stage · python · build --win)
import { spawn, spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const installerDir = path.resolve(here, '..');
const repoRoot = path.resolve(installerDir, '..', '..');
const buildDir = path.join(installerDir, 'build');
const unpackedSrc = path.join(buildDir, 'dist', 'win-unpacked');
const OUT = path.join(here, 'out');
const BZ = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Bandizip', 'bz.exe');
const VERBOSE = process.env.SMOKE_VERBOSE === '1';

const results = [];
const started = Date.now();
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); process.stdout.write(`${ok ? '  통과' : '  실패'}  ${name}${detail ? ` — ${detail}` : ''}\n`); return !!ok; };
const skip = (name, why) => { process.stdout.write(`  건너뜀 ${name} — ${why}\n`); };
const section = t => process.stdout.write(`\n▶ ${t}  (+${((Date.now() - started) / 1000).toFixed(1)} s)\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = (v, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };
const human = n => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MiB` : `${(n / 1024).toFixed(0)} KiB`);
const statOf = f => {
  // ~/.claude.json 은 Claude Code 가 쉼 없이 고쳐 쓰는 상태 파일이다 — 그 안의 MCP 등록(맨 위 · 프로젝트별 mcpServers)만 본다
  if (path.basename(f) === '.claude.json') {
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return `mcp:${crypto.createHash('sha256').update(JSON.stringify([j.mcpServers ?? null, Object.entries(j.projects ?? {}).map(([k, v]) => [k, v?.mcpServers ?? null])])).digest('hex')}`; }
    catch { return fs.existsSync(f) ? '읽지 못함' : '없음'; }
  }
  try { const s = fs.statSync(f); return `${s.size}:${s.mtimeMs}`; } catch { return '없음'; }
};
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const inside = (child, parent) => { const r = path.relative(parent, child); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
async function until(probe, ms, step = 200) { const d = Date.now() + ms; for (;;) { let v; try { v = await probe(); } catch { v = undefined; } if (v) { return v; } if (Date.now() > d) { return undefined; } await sleep(step); } }
function duBytes(p) { let st; try { st = fs.lstatSync(p); } catch { return 0; } if (!st.isDirectory()) { return st.size; } let n = 0; for (const x of fs.readdirSync(p)) { n += duBytes(path.join(p, x)); } return n; }
function listFiles(root, rel = '') {
  const out = [];
  for (const n of fs.readdirSync(path.join(root, rel))) { const r = rel ? `${rel}/${n}` : n; if (fs.statSync(path.join(root, r)).isDirectory()) { out.push(...listFiles(root, r)); } else { out.push(r); } }
  return out;
}
function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name); const b = path.join(dest, e.name);
    if (e.isDirectory()) { copyTree(a, b); } else { fs.copyFileSync(a, b); }
  }
}
function processTable() {
  // 출력은 UTF-8 로(한글 경로) — Windows PowerShell 5 의 기본 출력은 OEM 코드 페이지라 경로가 깨진다
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; [pscustomobject]@{pid=$_.ProcessId; ppid=$_.ParentProcessId; name=$_.Name; exe=$_.ExecutablePath; hwnd=$(if($p){[int64]$p.MainWindowHandle}else{0})} } | ConvertTo-Json -Compress"],
  { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PSModulePath: undefined } });
  try { return JSON.parse(r.stdout); } catch { return []; }
}
function descendants(rootPid, table = processTable()) {
  const out = []; const q = [rootPid];
  while (q.length) { const p = q.shift(); for (const row of table) { if (row.ppid === p && !out.some(o => o.pid === row.pid)) { out.push(row); q.push(row.pid); } } }
  return out;
}
const portFree = port => new Promise(resolve => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
function realConfigPaths() {
  const home = process.env.USERPROFILE || os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const list = [path.join(appData, 'Claude', 'claude_desktop_config.json'), path.join(home, '.claude', 'mcp.json'), path.join(home, '.claude.json'),
    path.join(repoRoot, '.mcp.json'), path.join(repoRoot, 'Example', '.mcp.json'), path.join(appData, 'StCFSD'), path.join(local, 'Programs', 'StCFSD'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StCFSD.lnk'), path.join(home, 'Desktop', 'StCFSD.lnk')];
  try { for (const d of fs.readdirSync(path.join(local, 'Packages'))) { if (/claude/i.test(d)) { list.push(path.join(local, 'Packages', d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json')); } } } catch { /* 없음 */ }
  return list;
}
function repoSnapshot() {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  const m = new Map();
  for (const part of r.stdout.split('\0').filter(Boolean)) { const f = part.slice(3); if (!f.startsWith('desktop/')) { m.set(f, `${part.slice(0, 2)}|${statOf(path.join(repoRoot, f))}`); } }
  return m;
}
/** bz l 의 목록 — Name 열의 자리로 자른다(이름에 공백이 있을 수 있다) */
function bzList(archive) {
  const r = spawnSync(BZ, ['l', archive], { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  const lines = r.stdout.split(/\r?\n/);
  const head = lines.find(l => /\bName\s*$/.test(l));
  if (!head) { return { ok: false, raw: r.stdout.slice(0, 400) + r.stderr.slice(0, 400) }; }
  const col = head.indexOf('Name');
  const entries = lines.filter(l => /^\d{4}-\d\d-\d\d /.test(l) && l.length > col && !/\d+ files?, \d+ folders?\s*$/.test(l))
    .map(l => ({ name: l.slice(col).trim().replace(/\\/g, '/'), attr: l.slice(20, 24), size: Number(l.slice(25, 37).trim()) }));
  return { ok: true, entries };
}

/** 묶은 Python 만 쓸 수 있는 환경: PATH 에서 Python · 가상환경 · Microsoft Store 의 python 별칭 자리를 빼고 PYTHON* 를 지운다 */
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  const sep = ';';
  env.PATH = (env.PATH || env.Path || '').split(sep).filter(p => p && !/python|\.venv|venv|conda|pyenv|WindowsApps/i.test(p)).join(sep);
  delete env.Path;
  for (const k of Object.keys(env)) { if (/^(PYTHON|VIRTUAL_ENV|CONDA|UV_|PIP_)/i.test(k)) { delete env[k]; } }
  for (const k of ['STCFSD_PYTHON', 'STCFSD_REPO_ROOT', 'ELECTRON_RUN_AS_NODE', 'PSModulePath']) { delete env[k]; }
  return { ...env, ...extra };
}

async function launch(exe, args, env, label) {
  const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env, windowsHide: true, cwd: os.tmpdir() });
  let out = '';
  const take = c => { out = (out + c).slice(-40_000); if (VERBOSE) { process.stdout.write(`    [${label}] ${c}`); } };
  child.stdout.on('data', take); child.stderr.on('data', take);
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let seq = 0; const pending = new Map(); let stage;
  child.on('message', m => { if (m?.type === 'stage' || m?.type === 'fatal') { stage = m; return; } const p = pending.get(m?.id); if (p) { pending.delete(m.id); p(m); } });
  const call = (msg, ms = 120_000) => new Promise((resolve, reject) => {
    seq += 1; const id = seq;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${msg.type} 답 없음`)); }, ms);
    pending.set(id, m => { clearTimeout(t); m.ok ? resolve(m.result) : reject(new Error(m.error)); });
    child.send({ id, ...msg });
  });
  const ev = (code, ms) => call({ type: 'eval', code }, ms);
  const page = js => ev(`return await ctx.win.webContents.executeJavaScript(${JSON.stringify(js)}, true);`);
  const designer = body => page(`(()=>{const W=document.getElementById('designer').contentWindow;const D=W.document;${body}})()`);
  const capture = name => call({ type: 'capture', file: path.join(OUT, `${name}.png`) });
  if (!await until(() => stage, 120_000)) { throw new Error(`앱이 뜨지 않았다(${label}): ${out.slice(-2000)}`); }
  if (stage.type === 'fatal') { throw new Error(`앱이 시작에 실패했다(${label}): ${short(stage, 1500)}`); }
  return { child, pid: child.pid, stage, ev, page, designer, capture, exited, out: () => out };
}

function startMcp(entry, env) {
  const child = spawn(entry.command, entry.args, { env: { ...env, ...entry.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: os.tmpdir() });
  let buf = ''; let err = ''; const pending = new Map(); let seq = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', c => { buf += c; let nl; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) { continue; } let m; try { m = JSON.parse(line); } catch { continue; } if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
  child.stderr.on('data', c => { err += c; });
  const request = (method, params, ms = 300_000) => new Promise((resolve, reject) => {
    seq += 1; const id = seq;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 시간 초과 ${err.slice(-300)}`)); }, ms);
    pending.set(id, m => { clearTimeout(t); resolve(m); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const tool = async (name, args = {}) => {
    const r = await request('tools/call', { name, arguments: args });
    const text = r.result?.content?.find(c => c.type === 'text')?.text ?? JSON.stringify(r.error ?? r);
    let json; try { json = JSON.parse(text); } catch { json = undefined; }
    return { isError: !!r.result?.isError, text, json };
  };
  const close = () => new Promise(resolve => { if (child.exitCode !== null) { resolve(); return; } child.once('exit', () => resolve()); child.stdin.end(); setTimeout(() => child.kill(), 2000).unref(); });
  return { child, request, tool, close, notify: (m, p) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: m, params: p })}\n`) };
}

async function quit(app, label) {
  const kids = descendants(app.pid);
  await app.ev('setTimeout(() => ctx.app.quit(), 50); return true;').catch(() => undefined);
  const exit = await Promise.race([app.exited, sleep(30_000).then(() => undefined)]);
  for (let i = 0; i < 100 && kids.some(k => alive(k.pid)); i++) { await sleep(100); }
  const left = kids.filter(k => alive(k.pid));
  check(`${label}: 끝내기 → 코드 0 · 자식(Electron 보조 · Python) 0`, exit?.code === 0 && left.length === 0,
    `${exit ? `코드 ${exit.code}` : '안 끝남'} · 자식 ${kids.length}개 · 남음 ${left.map(k => k.name).join(', ') || '0'}`);
  if (!exit) { spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true }); }
}
const quiet = async (app, when) => {
  const s = await app.ev('return { visible: ctx.win.isVisible(), focused: ctx.win.isFocused(), show: ctx.diag.showEvents, focus: ctx.diag.focusEvents };');
  check(`창은 보이지 않고 포커스를 받은 적이 없다 — ${when}`, !s.visible && !s.focused && s.show === 0 && s.focus === 0, JSON.stringify(s));
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) { fs.rmSync(path.join(OUT, f), { force: true }); }
  const real = realConfigPaths();
  const realBefore = new Map(real.map(f => [f, statOf(f)]));
  const repoBefore = repoSnapshot();
  const manifest = JSON.parse(fs.readFileSync(path.join(buildDir, 'stage', 'manifest.json'), 'utf8'));
  const pyInfo = JSON.parse(fs.readFileSync(path.join(buildDir, 'python-win-x64', 'STCFSD_PYTHON.json'), 'utf8'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-s5-'));
  const appDir = path.join(tmp, '시험 폴더 (공백)', 'StCFSD');
  const userData = path.join(tmp, '사용자 data');
  const docs = path.join(tmp, 'Documents');
  const fakeClaude = path.join(tmp, 'fake', 'Claude', 'claude_desktop_config.json');
  const models = path.join(tmp, '모델');
  for (const d of [docs, path.dirname(fakeClaude), models]) { fs.mkdirSync(d, { recursive: true }); }
  const fileA = path.join(models, '퍼린 검토.csd');
  fs.copyFileSync(path.join(repoRoot, 'Example', 'test.csd'), fileA);
  let A; let B; let mcp;
  const launched = [];

  try {
    section('1. 풀린 폴더를 공백 · 한글 경로로 복사');
    let t = Date.now();
    // fs.cpSync 는 이 크기(455 MiB) · 한글 경로에서 Node 를 죽였다(segfault) — 파일 하나씩 복사한다
    copyTree(unpackedSrc, appDir);
    const exe = path.join(appDir, 'StCFSD.exe');
    const res = path.join(appDir, 'resources');
    check('복사본 — StCFSD.exe · resources/app(asar 아님) · app-root · python', fs.existsSync(exe) && fs.existsSync(path.join(res, 'app', 'dist', 'main.js'))
      && !fs.existsSync(path.join(res, 'app.asar')) && fs.existsSync(path.join(res, 'app-root', 'media', 'mcp-server.js')) && fs.existsSync(path.join(res, 'python', 'python.exe')),
    `${Date.now() - t} ms · ${appDir} · ${human(duBytes(appDir))}`);
    check('복사본에 .venv 도 저장소로 가는 길도 없다', !fs.existsSync(path.join(res, 'app-root', '.venv')) && !inside(appDir, repoRoot));
    const vi = spawnSync('pwsh', ['-NoProfile', '-Command', `$v=(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo; "$($v.ProductName)|$($v.FileDescription)|$($v.ProductVersion)"`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
    check('실행 파일의 버전 정보 = StCFSD', /^StCFSD\|StCFSD\|/.test(vi), vi);
    const sig = spawnSync('pwsh', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${path.join(res, 'python', 'python.exe').replace(/'/g, "''")}').Status`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
    check('묶은 python.exe 의 PSF 서명이 그대로(electron-builder 가 고치지 않았다)', sig === 'Valid', sig);
    const env = cleanEnv({ STCFSD_SHELL_TEST: '1', STCFSD_DOCUMENTS: docs, STCFSD_CLAUDE_CONFIG: fakeClaude });
    const where = spawnSync('where', ['python'], { env, encoding: 'utf8', windowsHide: true });
    check('시험 환경의 PATH 로는 python 을 찾을 수 없다(PYTHON* 변수도 없음)', where.status !== 0 && !Object.keys(env).some(k => /^PYTHON/i.test(k)), where.stdout.trim() || '찾지 못함');

    section('2. 처음 실행 — 기본 단면 · 기본 강재(낡은 빌드를 싣지 않았다)');
    t = Date.now();
    A = await launch(exe, ['--user-data', userData], env, 'A'); launched.push(A.child);
    check('설치본이 뜬다(보이지 않게)', A.stage.stage === 'running', `${Date.now() - t} ms · ${A.stage.origin}`);
    const lay = await A.ev('return { kind: ctx.layout.kind, appRoot: ctx.layout.appRoot, python: ctx.layout.python, hostPython: ctx.host.python, mcpServer: ctx.layout.mcpServer, portFile: ctx.portFile };');
    check('배치 = installed · 모두 복사본 안', lay.kind === 'installed' && inside(lay.appRoot, appDir) && inside(lay.mcpServer, appDir) && inside(lay.portFile, userData), short(lay, 220));
    const procs = await until(() => { const d = descendants(A.pid).filter(r => /python/i.test(r.name)); return d.length ? d : undefined; }, 30_000);
    check('엔진 Python = 묶은 python(복사본의 resources\\python 안)', !!procs && procs.every(p => p.exe && inside(p.exe, path.join(res, 'python'))) && lay.hostPython.source === 'python.defaultInterpreterPath',
      (procs ?? []).map(p => p.exe).join(' · '));
    const dflt = await until(() => A.designer(`const v=id=>D.getElementById(id)?.value; const h=v('tpl-H'); if(!h) return null;
      return {H:v('tpl-H'),B:v('tpl-B'),D:v('tpl-D'),t:v('tpl-t'),r:v('tpl-r'),fy:v('input-fy'),fu:v('input-fu'),grade:v('input-steel-grade'),unit:D.querySelector('#btn-unit-SI.active')?'SI':'US'};`), 30_000);
    const near = (s, x) => Math.abs(Number(s) - x) <= 1e-9;
    check('처음 화면의 기본 단면 H 100 mm(1e-9) · B 50 · D 20 · t 2.3 · r 4 mm', !!dflt && dflt.unit === 'SI' && near(dflt.H, 100) && near(dflt.B, 50) && near(dflt.D, 20) && near(dflt.t, 2.3) && near(dflt.r, 4), JSON.stringify(dflt));
    check('처음 화면의 기본 강재 295 / 400 MPa', !!dflt && Number(dflt.fy) === 295 && Number(dflt.fu) === 400, `${dflt?.grade} · Fy ${dflt?.fy} · Fu ${dflt?.fu}`);
    await A.capture('s5_01_fresh_start');
    const hidden = descendants(A.pid).filter(r => /python|conhost/i.test(r.name));
    check('Python 자식에 콘솔 창이 없다(창 핸들 0)', hidden.length > 0 && hidden.every(r => Number(r.hwnd) === 0), hidden.map(r => `${r.name}=${r.hwnd}`).join(', '));
    await quiet(A, '처음 실행');
    await quit(A, 'A');

    section('3. 명령줄의 .csd 로 실행 → 좌굴 → 하중 → 퍼린 설계(MCP 서버 = 설치본의 StCFSD.exe) → 저장 · 다시 열기');
    t = Date.now();
    B = await launch(exe, ['--user-data', userData, fileA], env, 'B'); launched.push(B.child);
    const opened = await until(() => B.ev('return ctx.diag.opened.length ? ctx.diag.opened[0] : null;'), 30_000);
    check('명령줄의 .csd 를 연다', opened?.ok && opened.file === fileA, `${Date.now() - t} ms · ${short(opened?.message, 80)}`);
    const entry = await B.ev('return ctx.entry;');
    check('MCP 항목 = 복사본의 StCFSD.exe + ELECTRON_RUN_AS_NODE + 복사본의 media\\mcp-server.js', entry.command === exe && entry.args[0] === path.join(res, 'app-root', 'media', 'mcp-server.js')
      && entry.env.ELECTRON_RUN_AS_NODE === '1' && entry.env.STCFSD_MCP_PORT_FILE === lay.portFile && entry.env.STCFSD_MCP_STANDALONE === '1', short(entry, 260));
    t = Date.now();
    mcp = startMcp(entry, cleanEnv());
    const init = await mcp.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'packaged-check', version: '0' } });
    mcp.notify('notifications/initialized', {});
    const tools = await mcp.request('tools/list', {});
    const gs = await mcp.tool('get_status');
    check('StCFSD.exe(ELECTRON_RUN_AS_NODE=1) 로 띄운 MCP 서버 — 도구 59개 · get_status(열린 파일의 21 절점)', !!init.result && tools.result?.tools?.length === 59 && !gs.isError && gs.json?.nnodes === 21,
      `${Date.now() - t} ms · ${init.result?.serverInfo?.name} · 도구 ${tools.result?.tools?.length} · nnodes ${gs.json?.nnodes}`);
    const steps = [];
    const T = async (name, args) => { const s = Date.now(); const r = await mcp.tool(name, args); steps.push(`${name} ${Date.now() - s} ms`); return r; };
    const tpl = await T('set_section_template', { type: 'lippedz', H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 });
    const lc = await T('set_load_case', { load_case: 'compression', fy: 55 });
    const run = await T('run_analysis', {});
    check('좌굴 해석(묶은 Python)', !tpl.isError && !lc.isError && !run.isError && run.json?.success === true, short(run.text.replace(/\s+/g, ' '), 100));
    const loads = { member_app: 'roof-purlin', span_type: 'simple', span_ft: 20, loads: { D: 10, Lr: 20 }, design_method: 'LRFD', spacing_ft: 5, Fy: 55, Fu: 70 };
    const la = await T('analyze_loads', loads);
    check('하중 해석', !la.isError && !!la.json?.governing?.combo, short(la.json?.governing?.combo ?? la.text, 100));
    const pur = await T('design_purlin', loads);
    const regions = pur.json?.regions ?? [];
    check('퍼린 설계 — 구간별 판정', !pur.isError && regions.length > 0 && regions.every(g => typeof g.result?.pass === 'boolean'), `${steps.join(' · ')} · 구간 ${regions.length} · pass=${pur.json?.pass} · 이용률 ${pur.json?.utilization}`);
    const saved = path.join(tmp, '저장', '설치본 저장.csd');
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    await B.ev(`ctx.dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(saved)} }); return ctx.menuClick('file-save');`);
    const savedOk = await until(() => (fs.existsSync(saved) ? true : undefined), 30_000);
    const j1 = savedOk ? JSON.parse(fs.readFileSync(saved, 'utf8')) : {};
    check('메뉴 저장 → 파일(모델 · 하중 해석 · 퍼린 결과 · 설계 입력)', savedOk && j1.model?.node?.length > 0 && !!j1.loadAnalysis && !!j1.designResult && Object.keys(j1.designInputs ?? {}).length > 50,
      `${human(fs.statSync(saved).size)} · 설계 입력 ${Object.keys(j1.designInputs ?? {}).length}칸`);
    await mcp.tool('set_section_template', { type: 'lippedc', H: 6, B: 2, D: 0.5, t: 0.06, r: 0.1 });
    await B.ev(`ctx.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(saved)}] }); return ctx.menuClick('file-open');`);
    const back = await until(async () => { const s = await mcp.tool('get_nodes'); return s.json && JSON.stringify(s.json).length && (await B.page(`document.getElementById('file-name').textContent`)) === path.basename(saved) ? s : undefined; }, 30_000);
    const nodes = await mcp.tool('get_nodes');
    const n1 = j1.model?.node?.map(r => [r[1], r[2]]);
    const n2 = (nodes.json?.nodes ?? nodes.json)?.map?.(r => (Array.isArray(r) ? [r[1], r[2]] : [r.x, r.z]));
    check('메뉴 열기 → 저장한 모델이 돌아온다(절점 좌표가 같다)', !!back && Array.isArray(n2) && n2.length === n1.length && isDeepStrictEqual(n2.map(p => p.map(v => +Number(v).toFixed(9))), n1.map(p => p.map(v => +Number(v).toFixed(9)))),
      `절점 ${n2?.length} / ${n1?.length}`);
    await B.capture('s5_02_after_reopen');

    section('4. Claude 연결 — 설치본이 쓸 항목(가짜 설정)');
    await until(() => B.page(`(()=>{const b=document.getElementById('claude-action'); return b && !b.hidden && b.textContent==='연결' && !b.disabled ? true : null;})()`), 20_000);
    await B.page(`document.getElementById('claude-action').click(); 1`);
    const written = await until(() => { try { return JSON.parse(fs.readFileSync(fakeClaude, 'utf8')).mcpServers?.stcfsd; } catch { return undefined; } }, 15_000);
    check('「연결」이 쓰는 항목은 모두 복사본 안의 경로(가짜 설정에)', !!written && written.command === exe && written.args[0] === entry.args[0] && inside(written.args[0], appDir)
      && written.env.ELECTRON_RUN_AS_NODE === '1', short(written, 240));
    await quiet(B, '연결 뒤');
    await mcp.close(); mcp = undefined;
    const port = Number(new URL(B.stage.origin).port);
    const mcpPort = JSON.parse(fs.readFileSync(lay.portFile, 'utf8')).port;
    await quit(B, 'B');
    check('포트가 풀리고 포트 파일이 지워졌다', await portFree(port) && await portFree(mcpPort) && !fs.existsSync(lay.portFile));
  } catch (err) {
    check('설치본 실행 확인이 예외 없이 끝난다', false, String(err?.stack ?? err).slice(0, 1500));
  } finally {
    try { await mcp?.close(); } catch { /* */ }
    for (const p of launched) { if (p.exitCode === null && p.pid) { spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }); } }
  }

  section('5. 설치 파일 — 들여다보기만(실행하지 않는다)');
  const setup = fs.readdirSync(path.join(buildDir, 'dist')).find(n => /^StCFSD-Setup-.*-x64\.exe$/.test(n));
  if (!setup) { check('설치 파일이 있다', false, path.join(buildDir, 'dist')); }
  else {
    const setupPath = path.join(buildDir, 'dist', setup);
    check('설치 파일이 있다', true, `${setup} · ${human(fs.statSync(setupPath).size)}`);
    if (!fs.existsSync(BZ)) { skip('설치 파일 목록', `Bandizip 콘솔(${BZ})이 없다`); }
    else {
      const outer = bzList(setupPath);
      const names = outer.entries?.map(e => e.name) ?? [];
      check('NSIS 목록 — app-64.7z · 제거 프로그램 · NSIS 플러그인', outer.ok && names.includes('$PLUGINSDIR/app-64.7z') && names.some(n => /Uninstall StCFSD\.exe$/.test(n)), names.join(', '));
      const xdir = path.join(tmp, 'installer-x');
      spawnSync(BZ, ['x', '-y', `-o:${xdir}`, setupPath, '$PLUGINSDIR\\app-64.7z'], { encoding: 'utf8', windowsHide: true });
      const inner7z = listFiles(xdir).find(r => r.endsWith('app-64.7z'));
      const inner = inner7z ? bzList(path.join(xdir, inner7z)) : { ok: false };
      const files = new Set((inner.entries ?? []).filter(e => !/D/.test(e.attr)).map(e => e.name));
      // electron-builder · Electron 이 resources/ 에 스스로 두는 것: elevate.exe(NSIS 틀의 권한 올리기 도우미 — 사용자 단위 설치에선 쓰지 않는다),
      // default_app.asar(Electron 의 기본 앱 — resources/app 이 있으면 읽히지 않는다)
      const builtin = ['resources/elevate.exe', 'resources/default_app.asar'];
      const expected = [
        ...manifest.files.map(f => `resources/${f.path}`),
        ...listFiles(path.join(buildDir, 'python-win-x64')).map(r => `resources/python/${r}`),
        ...builtin,
      ];
      const missing = expected.filter(f => !files.has(f));
      const extraRes = [...files].filter(f => f.startsWith('resources/') && !expected.includes(f));
      check('설치 파일 안의 resources = 묶음 준비 목록 + Python 묶음(빠짐 · 더함 없음)', inner.ok && missing.length === 0 && extraRes.length === 0,
        `파일 ${files.size}개 · 기대 ${expected.length}개 · 빠짐 ${missing.slice(0, 5).join(', ') || 0} · 더함 ${extraRes.slice(0, 5).join(', ') || 0}`);
      const unpackedFiles = new Set(listFiles(unpackedSrc));
      const diff = [...files].filter(f => !unpackedFiles.has(f)).concat([...unpackedFiles].filter(f => !files.has(f)));
      check('설치 파일의 내용 = 풀린 폴더(win-unpacked) 와 같은 목록', diff.length === 0, diff.slice(0, 5).join(', ') || `${unpackedFiles.size}개`);
      const sizeA = manifest.files.reduce((n, f) => n + f.size, 0);
      process.stdout.write(`    · 설치 파일 ${human(fs.statSync(setupPath).size)} · 풀린 폴더 ${human(duBytes(unpackedSrc))} (Electron ${human(duBytes(unpackedSrc) - duBytes(path.join(unpackedSrc, 'resources')))} · Python ${human(pyInfo.sizes.totalBytes)} · 앱 ${human(sizeA)})\n`);
    }
  }

  section('6. 남은 것 · 진짜 설정 · 저장소');
  await sleep(500);
  const table = processTable();
  const left = table.filter(r => r.exe && inside(r.exe, tmp));
  check('복사본에서 뜬 프로세스가 하나도 남지 않았다', left.length === 0, left.map(r => `${r.name}#${r.pid}`).join(', ') || '0');
  const changed = real.filter(f => statOf(f) !== realBefore.get(f));
  check('진짜 Claude · MCP 설정 · %APPDATA%\\StCFSD · 설치 자리(%LOCALAPPDATA%\\Programs\\StCFSD) · 바로 가기 그대로', changed.length === 0, changed.join(', ') || `${real.length}곳`);
  const repoChanged = [...repoSnapshot()].filter(([k, v]) => repoBefore.get(k) !== v).map(([k]) => k);
  check('desktop/ 밖에서 저장소가 바뀌지 않았다', repoChanged.length === 0, repoChanged.join(', ') || '그대로');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 잠긴 파일 — 임시 폴더라 둔다 */ }

  const failed = results.filter(r => !r.ok);
  process.stdout.write(`\n결과: ${results.length - failed.length}/${results.length} 통과 · ${((Date.now() - started) / 1000).toFixed(1)} s · 그림 ${OUT}\n`);
  if (failed.length) { process.stdout.write(`실패: ${failed.map(f => f.name).join(' / ')}\n`); process.exitCode = 1; }
}

main().catch(err => { process.stdout.write(`실패  예외: ${err?.stack ?? err}\n`); process.exit(1); });
