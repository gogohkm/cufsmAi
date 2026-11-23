// S5 확인 — 설치하지 않고 설치본을 확인한다.
//
// 이 PC 는 소유자의 작업 PC 다: 설치 파일을 돌리지 않는다(레지스트리 · 시작 메뉴 · 파일 연결 · 전역 설치 없음).
// 대신
//  1. **설치 파일 안의 것을 그대로** 꺼낸다 — Bandizip 콘솔(bz.exe)로 NSIS 안의 app-64.7z 를 꺼내, 그것을 공백 · 한글이 든 임시 경로
//     (…\시험 폴더 (공백)\StCFSD)에 푼다(설치가 $INSTDIR 에 하는 일과 같다). 그 모든 파일의 sha256 이 electron-builder 의 풀린 폴더
//     (win-unpacked)와 같은지, 묶음 준비 목록(stage/manifest.json) · Python 묶음과 맞는지 본다.
//  2. 그 폴더에 **확인용 표시 파일 하나**(resources/stcfsd-verification.json)만 더한다 — 설치본은 이것이 있을 때만 시험 모드
//     (창을 보이지 않음 · IPC 제어 통로 · 시험용 경로 덮어쓰기)를 연다(V5-13, desktop/shell/src/mode.ts). 배포물에는 없다(이것도 본다).
//     그래서 띄우는 것 = 설치 파일의 내용 + 표시 파일 하나. 띄우기 전과 끝난 뒤 다른 모든 파일이 설치 파일의 것과 같은지 다시 본다.
//  3. 그 StCFSD.exe 를 **보이지 않게** 띄운다. 사용자 폴더 · 문서 · Claude 설정은 임시 · 가짜. 환경은 **적대적**이다(V5-16d): PATH 맨 앞에
//     가짜 python.exe, PYTHONPATH(가짜 numpy · sitecustomize) · PYTHONHOME · PYTHONSTARTUP · PYTHONUSERBASE(.pth) — 그래도 묶은 Python 만 쓰고
//     그것들은 하나도 돌지 않아야 한다.
//  4. 퓨즈를 실행 파일에서 다시 읽는다(V5-13), 만든 NSIS 스크립트에 제거 단계가 들어갔는지 본다(V5-05), 제거 도우미를 그 폴더의
//     StCFSD.exe(node 로)로 가짜 설정에 돌려 본다.
//  5. 저장소(desktop/ 밖) · 사용자의 진짜 설정 · %APPDATA%\StCFSD · 설치 자리 · 바로 가기가 그대로인지 본다.
//
//   node desktop/installer/test/packaged.mjs      (먼저 node desktop/installer/build.mjs --all)
import { spawn, spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { watchRealConfig } from '../../host/test/lib/realConfig.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const installerDir = path.resolve(here, '..');
const repoRoot = path.resolve(installerDir, '..', '..');
const buildDir = path.join(installerDir, 'build');
const unpackedSrc = path.join(buildDir, 'dist', 'win-unpacked');
const OUT = path.join(here, 'out');
const BZ = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Bandizip', 'bz.exe');
const VERBOSE = process.env.SMOKE_VERBOSE === '1';
const MARKER = 'stcfsd-verification.json';
const require = createRequire(path.join(repoRoot, 'desktop', 'shell', 'package.json'));

const results = [];
const started = Date.now();
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); process.stdout.write(`${ok ? '  통과' : '  실패'}  ${name}${detail ? ` — ${detail}` : ''}\n`); return !!ok; };
const section = t => process.stdout.write(`\n▶ ${t}  (+${((Date.now() - started) / 1000).toFixed(1)} s)\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = (v, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };
const human = n => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MiB` : `${(n / 1024).toFixed(0)} KiB`);
const statOf = f => { try { const s = fs.statSync(f); return `${s.size}:${s.mtimeMs}`; } catch { return '없음'; } };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const inside = (child, parent) => { const r = path.relative(parent, child); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
async function until(probe, ms, step = 200) { const d = Date.now() + ms; for (;;) { let v; try { v = await probe(); } catch { v = undefined; } if (v) { return v; } if (Date.now() > d) { return undefined; } await sleep(step); } }
function duBytes(p) { let st; try { st = fs.lstatSync(p); } catch { return 0; } if (!st.isDirectory()) { return st.size; } let n = 0; for (const x of fs.readdirSync(p)) { n += duBytes(path.join(p, x)); } return n; }
function listFiles(root, rel = '') {
  const out = [];
  for (const n of fs.readdirSync(path.join(root, rel))) { const r = rel ? `${rel}/${n}` : n; if (fs.statSync(path.join(root, r)).isDirectory()) { out.push(...listFiles(root, r)); } else { out.push(r); } }
  return out;
}
const hashTree = root => new Map(listFiles(root).map(r => [r, sha(path.join(root, r))]));
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
function repoSnapshot() {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
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

/**
 * 적대적 환경(V5-16d): PATH 에서 진짜 Python · 가상환경을 빼고 **맨 앞에 가짜 python.exe**, PYTHON* 은 모두 해로운 값으로.
 * 묶은 Python 은 ._pth 모드라 이것들을 보지 않아야 한다. 가짜가 돌면 표시 파일(`hit-*`)을 남긴다.
 */
function hostileEnv(h, extra = {}) {
  const env = { ...process.env };
  const sep = ';';
  const rest = (env.PATH || env.Path || '').split(sep).filter(p => p && !/python|\.venv|venv|conda|pyenv|WindowsApps/i.test(p));
  env.PATH = [h.fakeBin, ...rest].join(sep);
  delete env.Path;
  for (const k of Object.keys(env)) { if (/^(PYTHON|VIRTUAL_ENV|CONDA|UV_|PIP_)/i.test(k)) { delete env[k]; } }
  for (const k of ['STCFSD_PYTHON', 'STCFSD_REPO_ROOT', 'ELECTRON_RUN_AS_NODE', 'PSModulePath', 'STCFSD_SHELL_TEST']) { delete env[k]; }
  Object.assign(env, { PYTHONPATH: h.pyPath, PYTHONHOME: h.pyHome, PYTHONSTARTUP: h.startup, PYTHONUSERBASE: h.userBase, PYTHONNOUSERSITE: '' });
  return { ...env, ...extra };
}
function makeHostile(tmp) {
  const root = path.join(tmp, 'hostile');
  const fakeBin = path.join(root, 'bin');
  const pyPath = path.join(root, 'pypath');
  const pyHome = path.join(root, 'pyhome');
  const userBase = path.join(root, 'userbase');
  const hits = path.join(root, 'hits');
  for (const d of [fakeBin, pyPath, pyHome, userBase, hits]) { fs.mkdirSync(d, { recursive: true }); }
  // 가짜 python.exe — 돌면 아무 일도 하지 않는 다른 프로그램(PATH 로 찾으면 해석이 실패한다)
  fs.copyFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'), path.join(fakeBin, 'python.exe'));
  const touch = n => `open(${JSON.stringify(path.join(hits, n))}, 'w').write('ran')`;
  fs.writeFileSync(path.join(pyPath, 'numpy.py'), `${touch('hit-fake-numpy')}\nraise SystemExit('fake numpy')\n`);
  fs.writeFileSync(path.join(pyPath, 'sitecustomize.py'), `${touch('hit-sitecustomize')}\n`);
  const startup = path.join(root, 'startup.py');
  fs.writeFileSync(startup, `${touch('hit-startup')}\n`);
  const usp = path.join(userBase, 'Python313', 'site-packages');
  fs.mkdirSync(usp, { recursive: true });
  fs.writeFileSync(path.join(usp, 'evil.pth'), `import builtins; ${touch('hit-user-pth')}\n`);
  return { root, fakeBin, pyPath, pyHome, userBase, startup, hits };
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
  // 끼운 설계 웹뷰는 다른 출처(다리의 웹뷰 서버) — 주 프로세스가 그 프레임에서 직접 돌린다
  const designer = body => ev(`const mf = ctx.win.webContents.mainFrame;
    const f = mf.framesInSubtree.find(x => x !== mf && x.url.includes('/wv/' + encodeURIComponent(ctx.host.designer.id) + '/'));
    if (!f) { throw new Error('설계 웹뷰 프레임 없음'); }
    return await f.executeJavaScript(${JSON.stringify('(async()=>{const W=window;const D=document;BODY})()')}.replace('BODY', ${JSON.stringify(body)}), true);`);
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

/** 설치본의 제거 도우미를 그 폴더의 StCFSD.exe(node 로)로 — 보이지 않게, 가짜 설정 · 임시 사용자 폴더 */
function runDisconnect(exe, res, config, userData, env) {
  const r = spawnSync(exe, [path.join(res, 'app', 'uninstall', 'disconnect.js'), '--config', config, '--user-data', userData],
    { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  const line = (r.stdout || '').split(/\r?\n/).find(l => l.startsWith('STCFSD_UNINSTALL_DISCONNECT '));
  return { code: r.status, out: line ? JSON.parse(line.slice('STCFSD_UNINSTALL_DISCONNECT '.length)) : null, raw: (r.stdout || '') + (r.stderr || '') };
}

/** 실린 MCP 서버 묶음이 내놓는 도구 수 — 묶음 안의 `<서버>.tool("이름",` 를 센다(숫자를 박아 두지 않는다) */
function declaredTools(bundle) {
  const src = fs.readFileSync(bundle, 'utf8');
  return new Set([...src.matchAll(/\.tool\("([a-z0-9_]+)",/g)].map(m => m[1])).size;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) { fs.rmSync(path.join(OUT, f), { force: true }); }
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const real = watchRealConfig(repoRoot, [path.join(local, 'Programs', 'StCFSD'), path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StCFSD.lnk'),
    path.join(os.homedir(), 'Desktop', 'StCFSD.lnk')]);
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
  fs.writeFileSync(fakeClaude, `${JSON.stringify({ mcpServers: { other: { command: 'other.exe', env: { API_KEY: 'keep-me' } } } }, null, 2)}\n`);
  const fileA = path.join(models, '퍼린 검토.csd');
  fs.copyFileSync(path.join(repoRoot, 'Example', 'test.csd'), fileA);
  const h = makeHostile(tmp);
  let A; let B; let mcp;
  const launched = [];
  const exe = path.join(appDir, 'StCFSD.exe');
  const res = path.join(appDir, 'resources');
  let shippedHashes;

  section(`0. 설치 파일 — 무엇을 묶었나(git ${manifest.source.gitHead.slice(0, 7)}${manifest.source.gitDirty ? ` + 커밋 안 된 변경 ${manifest.source.dirtyFiles?.length ?? '?'}개` : ' · 커밋 안 된 변경 없음'})`);
  const setup = fs.readdirSync(path.join(buildDir, 'dist')).find(n => /^StCFSD-Setup-.*-x64\.exe$/.test(n));
  const setupPath = setup && path.join(buildDir, 'dist', setup);
  check('설치 파일이 있다', !!setup, setup ? `${setup} · ${human(fs.statSync(setupPath).size)}` : path.join(buildDir, 'dist'));
  check('Bandizip 콘솔이 있다(설치 파일 안을 꺼내 그것을 띄운다)', fs.existsSync(BZ), BZ);
  if (!setup || !fs.existsSync(BZ)) { return finish(tmp); }

  try {
    section('1. 설치 파일 안의 것을 공백 · 한글 경로에 꺼낸다(설치가 하는 일) — 배포물 = 풀린 폴더 = 묶음 목록');
    let t = Date.now();
    const outer = bzList(setupPath);
    const names = outer.entries?.map(e => e.name) ?? [];
    check('NSIS 목록 — app-64.7z · 제거 프로그램 · NSIS 플러그인', outer.ok && names.includes('$PLUGINSDIR/app-64.7z') && names.some(n => /Uninstall StCFSD\.exe$/.test(n)), names.join(', '));
    const xdir = path.join(tmp, 'installer-x');
    spawnSync(BZ, ['x', '-y', `-o:${xdir}`, setupPath, '$PLUGINSDIR\\app-64.7z'], { encoding: 'utf8', windowsHide: true });
    const inner7z = listFiles(xdir).find(r => r.endsWith('app-64.7z'));
    fs.mkdirSync(appDir, { recursive: true });
    const ex = spawnSync(BZ, ['x', '-y', `-o:${appDir}`, path.join(xdir, inner7z)], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    shippedHashes = hashTree(appDir);
    const unpacked = hashTree(unpackedSrc);
    const diffU = [...new Set([...shippedHashes.keys(), ...unpacked.keys()])].filter(k => shippedHashes.get(k) !== unpacked.get(k));
    check('설치 파일 안의 모든 파일 = 풀린 폴더(win-unpacked)의 파일(sha256)', ex.status === 0 && shippedHashes.size > 1000 && diffU.length === 0,
      `${Date.now() - t} ms · ${shippedHashes.size}개 · 다름 ${diffU.slice(0, 5).join(', ') || 0} · ${human(duBytes(appDir))}`);
    const builtin = ['resources/elevate.exe', 'resources/default_app.asar'];
    const expected = [...manifest.files.map(f => `resources/${f.path}`), ...listFiles(path.join(buildDir, 'python-win-x64')).map(r => `resources/python/${r}`), ...builtin];
    const shippedRes = [...shippedHashes.keys()].filter(f => f.startsWith('resources/'));
    const missing = expected.filter(f => !shippedHashes.has(f));
    const extra = shippedRes.filter(f => !expected.includes(f));
    const stageMismatch = manifest.files.filter(f => shippedHashes.get(`resources/${f.path}`) !== f.sha256).map(f => f.path);
    check('resources = 묶음 준비 목록(sha256 까지) + Python 묶음 + electron-builder 의 둘(elevate.exe · default_app.asar)', missing.length === 0 && extra.length === 0 && stageMismatch.length === 0,
      `기대 ${expected.length} · 빠짐 ${missing.slice(0, 4).join(', ') || 0} · 더함 ${extra.slice(0, 4).join(', ') || 0} · 내용 다름 ${stageMismatch.slice(0, 4).join(', ') || 0}`);
    check('확인용 표시 파일은 배포물(설치 파일 · 풀린 폴더)에 없다', !shippedHashes.has(`resources/${MARKER}`) && !unpacked.has(`resources/${MARKER}`));

    // V5-13 · 퓨즈 — 실행 파일에서 다시 읽는다
    const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
    const wire = await getCurrentFuseWire(exe);
    // 실행 파일의 퓨즈 줄 — 글자 '1'(49) = 켬, '0'(48) = 끔
    const fuse = k => (wire[FuseV1Options[k]] === 49 ? 'on' : wire[FuseV1Options[k]] === 48 ? 'off' : String(wire[FuseV1Options[k]]));
    const fuses = Object.fromEntries(['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments', 'GrantFileProtocolExtraPrivileges',
      'EnableCookieEncryption', 'OnlyLoadAppFromAsar', 'EnableEmbeddedAsarIntegrityValidation'].map(k => [k, fuse(k)]));
    check('V5-13 · 퓨즈(설치 파일의 StCFSD.exe) — RunAsNode 켬, NODE_OPTIONS · --inspect 인자 · file:// 특권 끔', fuses.RunAsNode === 'on'
      && fuses.EnableNodeOptionsEnvironmentVariable === 'off' && fuses.EnableNodeCliInspectArguments === 'off' && fuses.GrantFileProtocolExtraPrivileges === 'off', JSON.stringify(fuses));
    const mainJs = fs.readFileSync(path.join(res, 'app', 'dist', 'main.js'), 'utf8');
    check('V5-13 · 설치본의 main.js 는 시험 모드를 표시 파일로 가른다(그 이름 · 실행 모드 함수가 들어 있다)', mainJs.includes(MARKER) && /verificationMarker/.test(mainJs));

    // V5-05 · 만든 NSIS 스크립트에 제거 단계
    const nsiFile = path.join(buildDir, 'dist', 'nsis-script.nsi');
    const nsi = fs.existsSync(nsiFile) ? fs.readFileSync(nsiFile, 'utf8') : '';
    const inc = fs.readFileSync(path.join(installerDir, 'installer.nsh'), 'utf8');
    const unTpl = fs.readFileSync(path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates', 'nsis', 'uninstaller.nsh'), 'utf8');
    const uninstallerInSetup = names.some(n => /Uninstall StCFSD\.exe$/.test(n));
    check('V5-05 · 만든 NSIS 스크립트가 installer.nsh(customUnInstall)와 uninstaller.nsh 를 싣고, 그 제거 구역이 파일 지우기(RMDir) 앞에 customUnInstall 을 부른다 · 제거 프로그램이 컴파일됐다',
      /!include ".*installer\.nsh"/.test(nsi) && /!include "uninstaller\.nsh"/.test(nsi) && /!macro customUnInstall/.test(inc)
      && /!ifmacrodef customUnInstall\s+!insertmacro customUnInstall/.test(unTpl) && unTpl.indexOf('!insertmacro customUnInstall') < unTpl.indexOf('RMDir /r $INSTDIR')
      && /disconnect\.js/.test(inc) && /\$\{ifNot\} \$\{isUpdated\}/.test(inc) && /nsExec::Exec \/TIMEOUT=/.test(inc) && uninstallerInSetup,
      `스크립트 ${nsi.split('\n').length}줄 · 덮어 설치에서는 건너뜀 · nsExec(창 없음) · 15 s 제한 · 설치 파일 안에 Uninstall StCFSD.exe ${uninstallerInSetup}`);

    // V5-17 · V5-07 · 묶음 메타
    const shippedPkg = JSON.parse(fs.readFileSync(path.join(res, 'app-root', 'package.json'), 'utf8'));
    const mapComments = [...shippedHashes.keys()].filter(f => f.startsWith('resources/app') && f.endsWith('.js') && /sourceMappingURL=/.test(fs.readFileSync(path.join(appDir, f), 'utf8').slice(-400)));
    check('V5-17 · 배포용 package.json 에 저장소 주소 · 개발 스크립트 없음 · 싣지 않은 .map 을 가리키는 주석 없음',
      !shippedPkg.repository && !shippedPkg.bugs && !shippedPkg.homepage && !shippedPkg.scripts && !!shippedPkg.contributes && mapComments.length === 0, mapComments.slice(0, 3).join(', ') || '0곳');
    const notices = fs.readFileSync(path.join(res, 'app-root', 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    check('V5-07 · 제3자 고지 — 묶인 패키지(소스맵에서) 모두 이름 · 판 · 라이선스 원문, Babylon.js 의 NOTICE 포함',
      manifest.thirdParty.length >= 5 && manifest.thirdParty.every(p => notices.includes(`${p.name} ${p.version}`) && p.files.length > 0)
      && ['@modelcontextprotocol/sdk', 'zod', '@babylonjs/core'].every(n => manifest.thirdParty.some(p => p.name === n)) && /--- NOTICE/i.test(notices),
      manifest.thirdParty.map(p => `${p.name}@${p.version}`).join(', '));
    check('새 검토 화면 · 제거 도우미가 실렸다', fs.existsSync(path.join(res, 'app', 'ui', 'index.html')) && fs.existsSync(path.join(res, 'app', 'uninstall', 'disconnect.js')));
    const vi = spawnSync('pwsh', ['-NoProfile', '-Command', `$v=(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo; "$($v.ProductName)|$($v.FileDescription)|$($v.ProductVersion)"`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
    check('실행 파일의 버전 정보 = StCFSD', /^StCFSD\|StCFSD\|/.test(vi), vi);
    const sig = spawnSync('pwsh', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${path.join(res, 'python', 'python.exe').replace(/'/g, "''")}').Status`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
    check('묶은 python.exe 의 PSF 서명이 그대로', sig === 'Valid', sig);

    // 확인용 표시 파일 하나만 더한다 — 이 빌드의 주 번들 sha256 을 담은 정해진 꼴(V5-13 후속, shell/src/mode.ts)
    const mainSha = sha(path.join(res, 'app', 'dist', 'main.js'));
    {
      // 설치본의 판정 함수 그대로(mode.ts 를 묶어 읽는다)로: 모델 모양 JSON 은 표시가 아니다 — 창을 띄우지 않고 보인다
      const esbuild = require('esbuild');
      const out = esbuild.buildSync({ entryPoints: [path.join(repoRoot, 'desktop', 'shell', 'src', 'mode.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
      const mod = { exports: {} };
      new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
      const probe = path.join(tmp, 'marker-probe.json');
      fs.writeFileSync(probe, fs.readFileSync(path.join(repoRoot, 'Example', 'test.csd')));
      const modelVerdict = mod.exports.verificationMarkerValid(probe, path.join(res, 'app', 'dist', 'main.js'));
      fs.writeFileSync(probe, JSON.stringify({ schema: mod.exports.VERIFICATION_SCHEMA, mainBundleSha256: mainSha, node: [[1, 0, 0]], elem: [] }));
      const mixedVerdict = mod.exports.verificationMarkerValid(probe, path.join(res, 'app', 'dist', 'main.js'));
      fs.writeFileSync(path.join(res, MARKER), `${JSON.stringify({ schema: mod.exports.VERIFICATION_SCHEMA, mainBundleSha256: mainSha,
        note: 'desktop/installer/test/packaged.mjs 의 확인용 복사본 — 배포물에는 없다', createdAt: new Date().toISOString() })}\n`);
      const goodVerdict = mod.exports.verificationMarkerValid(path.join(res, MARKER), path.join(res, 'app', 'dist', 'main.js'));
      check('V5-13 후속 · 표시 자리에 둔 모델 파일 · 모델 키를 섞은 표시는 설치본의 main.js 에 대해 「표시 아님」 — 주 번들 sha256 을 담은 표시만 맞다',
        modelVerdict === false && mixedVerdict === false && goodVerdict === true, `모델 ${modelVerdict} · 섞음 ${mixedVerdict} · 이 빌드의 표시 ${goodVerdict} · main.js ${mainSha.slice(0, 12)}…`);
    }
    const env = hostileEnv(h, { STCFSD_SHELL_TEST: '1', STCFSD_DOCUMENTS: docs, STCFSD_CLAUDE_CONFIG: fakeClaude });
    const where = spawnSync('where', ['python'], { env, encoding: 'utf8', windowsHide: true });
    check('V5-16d · 적대적 환경: PATH 로 찾은 python 은 가짜다 · PYTHONPATH · PYTHONHOME · PYTHONSTARTUP · PYTHONUSERBASE 가 설정됨',
      where.status === 0 && where.stdout.split(/\r?\n/)[0].trim() === path.join(h.fakeBin, 'python.exe') && ['PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP', 'PYTHONUSERBASE'].every(k => env[k]),
      where.stdout.split(/\r?\n/)[0].trim());

    section('2. 처음 실행 — 기본 단면 · 기본 강재(낡은 빌드를 싣지 않았다)');
    t = Date.now();
    A = await launch(exe, ['--user-data', userData], env, 'A'); launched.push(A.child);
    check('설치본이 뜬다(보이지 않게, 확인용 표시 파일로 시험 모드)', A.stage.stage === 'running', `${Date.now() - t} ms · ${A.stage.origin}`);
    // U4: 설치본의 기본 화면은 새 검토 화면(resources/app/ui — 묶음 준비가 싣는다). 예전의 틀은 --ui classic(아래 3 이 그 길)
    const aUrl = await until(() => A.ev('return ctx.win.webContents.getURL() || null;'), 15_000);
    check('설치본의 기본 화면 = 새 검토 화면(/ui/ — 스위치 없이)', A.stage.screen === '/ui/' && aUrl === `${A.stage.origin}/ui/`, `${A.stage.screen} · ${aUrl}`);
    const lay = await A.ev('return { kind: ctx.layout.kind, appRoot: ctx.layout.appRoot, python: ctx.layout.python, hostPython: ctx.host.python, mcpServer: ctx.layout.mcpServer, portFile: ctx.portFile, wvOrigin: ctx.bridge.webviewOrigin };');
    check('배치 = installed · 모두 그 폴더 안', lay.kind === 'installed' && inside(lay.appRoot, appDir) && inside(lay.mcpServer, appDir) && inside(lay.portFile, userData), short(lay, 220));
    const procs = await until(() => { const d = descendants(A.pid).filter(r => /python/i.test(r.name)); return d.length ? d : undefined; }, 30_000);
    check('엔진 Python = 묶은 python(그 폴더의 resources\\python 안 — PATH 의 가짜가 아니다)', !!procs && procs.every(p => p.exe && inside(p.exe, path.join(res, 'python'))) && lay.hostPython.source === 'python.defaultInterpreterPath',
      (procs ?? []).map(p => p.exe).join(' · '));
    const dflt = await until(() => A.designer(`const v=id=>D.getElementById(id)?.value; const h=v('tpl-H'); if(!h) return null;
      return {H:v('tpl-H'),B:v('tpl-B'),D:v('tpl-D'),t:v('tpl-t'),r:v('tpl-r'),fy:v('input-fy'),fu:v('input-fu'),grade:v('input-steel-grade'),unit:D.querySelector('#btn-unit-SI.active')?'SI':'US', origin: location.origin};`), 30_000);
    const near = (s, x) => Math.abs(Number(s) - x) <= 1e-9;
    check('처음 화면의 기본 단면 H 100 mm(1e-9) · B 50 · D 20 · t 2.3 · r 4 mm', !!dflt && dflt.unit === 'SI' && near(dflt.H, 100) && near(dflt.B, 50) && near(dflt.D, 20) && near(dflt.t, 2.3) && near(dflt.r, 4), JSON.stringify(dflt));
    check('처음 화면의 기본 강재 295 / 400 MPa', !!dflt && Number(dflt.fy) === 295 && Number(dflt.fu) === 400, `${dflt?.grade} · Fy ${dflt?.fy} · Fu ${dflt?.fu}`);
    check('끼운 웹뷰는 웹뷰 서버(다른 출처)에서 돈다', dflt?.origin === lay.wvOrigin && dflt.origin !== A.stage.origin, `${dflt?.origin} ≠ ${A.stage.origin}`);
    await A.capture('s5_01_fresh_start');
    const hidden = descendants(A.pid).filter(r => /python|conhost/i.test(r.name));
    check('Python 자식에 콘솔 창이 없다(창 핸들 0)', hidden.length > 0 && hidden.every(r => Number(r.hwnd) === 0), hidden.map(r => `${r.name}=${r.hwnd}`).join(', '));
    await quiet(A, '처음 실행');
    await quit(A, 'A');

    section('3. 명령줄의 .csd 로 실행 → 좌굴 → 하중 → 퍼린 설계(MCP 서버 = 설치본의 StCFSD.exe) → 저장 · 다시 열기');
    t = Date.now();
    // 이 절은 예전의 틀(제목 표시줄의 파일 이름 · Claude 단추)을 본다 — 한 판 동안 남긴 스위치로
    B = await launch(exe, ['--user-data', userData, '--ui', 'classic', fileA], env, 'B'); launched.push(B.child);
    const opened = await until(() => B.ev('return ctx.diag.opened.length ? ctx.diag.opened[0] : null;'), 30_000);
    check('명령줄의 .csd 를 연다', opened?.ok && opened.file === fileA, `${Date.now() - t} ms · ${short(opened?.message, 80)}`);
    const entry = await B.ev('return ctx.entry;');
    check('MCP 항목 = 그 폴더의 StCFSD.exe + ELECTRON_RUN_AS_NODE + 그 폴더의 media\\mcp-server.js', entry.command === exe && entry.args[0] === path.join(res, 'app-root', 'media', 'mcp-server.js')
      && entry.env.ELECTRON_RUN_AS_NODE === '1' && entry.env.STCFSD_MCP_PORT_FILE === lay.portFile && entry.env.STCFSD_MCP_STANDALONE === '1', short(entry, 260));
    t = Date.now();
    // Claude Desktop 이 띄우는 그대로 — 사용자 환경(적대적)에서, 시험 변수 없이
    mcp = startMcp(entry, hostileEnv(h));
    const init = await mcp.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'packaged-check', version: '0' } });
    mcp.notify('notifications/initialized', {});
    const tools = await mcp.request('tools/list', {});
    const gs = await mcp.tool('get_status');
    check('StCFSD.exe(ELECTRON_RUN_AS_NODE=1, 퓨즈 적용) 로 띄운 MCP 서버 — 도구 = 묶음이 내놓는 수 · get_status(열린 파일의 21 절점)', !!init.result && tools.result?.tools?.length === declaredTools(entry.args[0]) && declaredTools(entry.args[0]) >= 60 && !gs.isError && gs.json?.nnodes === 21,
      `${Date.now() - t} ms · ${init.result?.serverInfo?.name} · 도구 ${tools.result?.tools?.length} / 묶음 ${declaredTools(entry.args[0])} · nnodes ${gs.json?.nnodes}`);
    const steps = [];
    const T = async (name, args) => { const s = Date.now(); const r = await mcp.tool(name, args); steps.push(`${name} ${Date.now() - s} ms`); return r; };
    const tpl = await T('set_section_template', { type: 'lippedz', H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 });
    const lc = await T('set_load_case', { load_case: 'compression', fy: 55 });
    const run = await T('run_analysis', {});
    check('좌굴 해석(묶은 Python, 적대적 환경)', !tpl.isError && !lc.isError && !run.isError && run.json?.success === true, short(run.text.replace(/\s+/g, ' '), 100));
    const loads = { member_app: 'roof-purlin', span_type: 'simple', span_ft: 20, loads: { D: 10, Lr: 20 }, design_method: 'LRFD', spacing_ft: 5, Fy: 55, Fu: 70 };
    const la = await T('analyze_loads', loads);
    check('하중 해석', !la.isError && !!la.json?.governing?.combo, short(la.json?.governing?.combo ?? la.text, 100));
    // MCP 의 글 답은 기본이 요약이다(f96f94c) — 구간마다의 결과를 읽으려면 detail 'full'
    const pur = await T('design_purlin', { ...loads, detail: 'full' });
    const regions = pur.json?.regions ?? [];
    check('퍼린 설계 — 구간별 판정', !pur.isError && regions.length > 0 && regions.every(g => typeof g.result?.pass === 'boolean'), `${steps.join(' · ')} · 구간 ${regions.length} · pass=${pur.json?.pass} · 이용률 ${pur.json?.utilization}`);
    const saved = path.join(tmp, '저장', '설치본 저장.csd');
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    await B.ev(`ctx.dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(saved)} }); return ctx.menuClick('file-save');`);
    const savedOk = await until(() => (fs.existsSync(saved) ? true : undefined), 30_000);
    const j1 = savedOk ? JSON.parse(fs.readFileSync(saved, 'utf8')) : {};
    check('메뉴 저장 → 파일(모델 · 하중 해석 · 퍼린 결과 · 설계 입력)', savedOk && j1.model?.node?.length > 0 && !!j1.loadAnalysis && !!j1.designResult && Object.keys(j1.designInputs ?? {}).length > 50,
      `${savedOk ? human(fs.statSync(saved).size) : '없음'} · 설계 입력 ${Object.keys(j1.designInputs ?? {}).length}칸`);
    await mcp.tool('set_section_template', { type: 'lippedc', H: 6, B: 2, D: 0.5, t: 0.06, r: 0.1 });
    // U4: 저장 안 한 변경(모델이 바뀜)이 있으면 메뉴 열기 앞에서 화면 안에서 묻는다 — 「취소」면 아무것도 바꾸지 않고, 「저장 안 함」이면 연다
    const pageAsk = () => until(() => B.page(`(()=>{const d=document.querySelector('#dialog-host .dialog'); return d && /저장하지 않은 변경/.test(d.textContent) ? d.textContent.replace(/\\s+/g,' ') : null;})()`), 20_000);
    const answer = item => B.page(`(()=>{const b=document.querySelector('#dialog-host [data-item="${item}"]'); if(b){b.click(); return true;} return false;})()`);
    const dirtyA = await B.ev('return await ctx.hostAction("get_unsaved_changes");');
    const nodesA = await mcp.tool('get_nodes');
    const nameA = await B.page(`document.getElementById('file-name').textContent`);
    await B.ev(`ctx.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(saved)}] }); return ctx.menuClick('file-open');`);
    const q1 = await pageAsk();
    await answer('취소');
    await sleep(1500);
    const dirtyB = await B.ev('return await ctx.hostAction("get_unsaved_changes");');
    const nodesB = await mcp.tool('get_nodes');
    const nameB = await B.page(`document.getElementById('file-name').textContent`);
    check('저장 안 한 변경(모델) → 메뉴 열기 앞에서 화면 안에서 묻는다 · 「취소」면 모델 · 파일 · 저장 안 한 변경이 그대로',
      dirtyA?.dirty === true && /저장하지 않은 변경/.test(q1 ?? '') && dirtyB?.dirty === true && nameB === nameA && JSON.stringify(nodesB.json) === JSON.stringify(nodesA.json),
      `물음 「${short(q1, 70)}」 · 취소 뒤 더러움 ${dirtyB?.dirty} · 파일 ${nameB} · 모델 그대로 ${JSON.stringify(nodesB.json) === JSON.stringify(nodesA.json)}`);
    await B.ev("return ctx.menuClick('file-open');");
    await pageAsk();
    await answer('저장 안 함');
    const back = await until(async () => ((await B.page(`document.getElementById('file-name').textContent`)) === path.basename(saved) ? true : undefined), 30_000);
    const nodes = await mcp.tool('get_nodes');
    const n1 = j1.model?.node?.map(r => [r[1], r[2]]);
    const n2 = (nodes.json?.nodes ?? nodes.json)?.map?.(r => (Array.isArray(r) ? [r[1], r[2]] : [r.x, r.z]));
    check('메뉴 열기 → 저장한 모델이 돌아온다(절점 좌표가 같다)', !!back && Array.isArray(n2) && n2.length === n1?.length && isDeepStrictEqual(n2.map(p => p.map(v => +Number(v).toFixed(9))), n1.map(p => p.map(v => +Number(v).toFixed(9)))),
      `절점 ${n2?.length} / ${n1?.length}`);
    await B.capture('s5_02_after_reopen');
    // V7-01(82194ef): 설치본의 기록자 열쇠는 <userData>\writer — 저장한 결과가 서명되어 다시 열면 되살아난다
    const st1 = await B.ev('return await ctx.hostAction("get_full_state");');
    const keyFile = path.join(userData, 'writer', 'writer.key');
    check('V7-01 · 설치본의 저장 = 서명(열쇠 <userData>\\writer\\writer.key) · 저장 → 메뉴 열기 → 결과(하중 해석 · 부재 검토)가 되살아난다',
      !!j1.resultsSeal && fs.existsSync(keyFile) && fs.statSync(keyFile).size > 0 && st1?.case?.results_signed === true && !!st1?.results?.member_design && !!st1?.results?.load_analysis,
      `봉인 ${!!j1.resultsSeal} · 열쇠 ${fs.existsSync(keyFile)} · results_signed ${st1?.case?.results_signed} · 되살린 결과 ${Object.keys(st1?.results ?? {}).filter(k => st1.results[k]).join(', ')}`);
    const hits = fs.readdirSync(h.hits);
    check('V5-16d · 적대적 환경의 가짜 numpy · sitecustomize · PYTHONSTARTUP · 사용자 site .pth 가 하나도 돌지 않았다', hits.length === 0, hits.join(', ') || '0');

    section('4. Claude 연결 — 설치본이 쓸 항목(가짜 설정) · 제거 도우미(V5-05)');
    await until(() => B.page(`(()=>{const b=document.getElementById('claude-action'); return b && !b.hidden && b.textContent==='연결' && !b.disabled ? true : null;})()`), 20_000);
    await B.page(`document.getElementById('claude-action').click(); 1`);
    const written = await until(() => { try { return JSON.parse(fs.readFileSync(fakeClaude, 'utf8')).mcpServers?.stcfsd; } catch { return undefined; } }, 15_000);
    check('「연결」(맨 위 프레임 · 주 프로세스가 붙인 쓰기 열쇠)이 쓰는 항목은 모두 그 폴더 안의 경로(가짜 설정에)', !!written && written.command === exe && written.args[0] === entry.args[0] && inside(written.args[0], appDir)
      && written.env.ELECTRON_RUN_AS_NODE === '1', short(written, 240));
    await quiet(B, '연결 뒤');
    await mcp.close(); mcp = undefined;
    const port = Number(new URL(B.stage.origin).port);
    const mcpPort = JSON.parse(fs.readFileSync(lay.portFile, 'utf8')).port;
    await quit(B, 'B');
    check('포트가 풀리고 포트 파일이 지워졌다', await portFree(port) && await portFree(mcpPort) && !fs.existsSync(lay.portFile));
    // V7-01: 다른 열쇠(다른 사용자 폴더 = 다른 PC 와 같다)로 서명된 파일 — 입력만 열고 까닭을 알린다
    const userData2 = path.join(tmp, '다른 사용자');
    const C = await launch(exe, ['--user-data', userData2, '--ui', 'classic', saved], env, 'C'); launched.push(C.child);
    const openedC = await until(() => C.ev('return ctx.diag.opened.length ? ctx.diag.opened[0] : null;'), 30_000);
    const stC = await until(async () => { const f = await C.ev('return await ctx.hostAction("get_full_state");'); return f && Array.isArray(f.invalidated) ? f : undefined; }, 30_000);
    const dropC = (stC?.invalidated ?? []).filter(e => e?.cause?.action === 'open_project');
    const resC = Object.keys(stC?.results ?? {}).filter(k => stC.results[k]);
    check('V7-01 · 다른 열쇠로 서명된 .csd → 입력만 연다(결과 0) · 까닭 「이 PC 에서 이 프로그램이 계산한 것이 아님」 · 입력은 그대로',
      !!openedC?.ok && resC.length === 0 && dropC.length > 0 && dropC.every(e => /not computed by this program on this PC/i.test(String(e.reason))) && (stC?.nnodes ?? 0) === (j1.model?.node?.length ?? -1),
      `열기 ${openedC?.ok} · 남은 결과 ${resC.join(', ') || '없음'} · 장부 ${dropC.map(e => e.kind).join(', ')} 「${short(dropC[0]?.reason, 70)}」 · 절점 ${stC?.nnodes}`);
    await quit(C, 'C');
    section('3b. 기록 갈래 — 설치본이 고른 프로젝트 뿌리(시험의 임시 문서 폴더 — 확인 표시가 있을 때만 받는 STCFSD_DOCUMENTS)에서 대상 · 실행 · 저장 → 다시 열기 · 한국어 알림 · 초안 · 발행(진짜 인쇄)');
    {
      t = Date.now();
      const R = await launch(exe, ['--user-data', userData], env, 'R'); launched.push(R.child);
      await until(() => R.page('!!(window.__stcfsdUi && window.__stcfsdUi.state.ready)'), 60_000);
      const root = path.join(docs, 'StCFSD 프로젝트');
      const where = await R.ev('return { roots: process.env.STCFSD_PROJECT_ROOTS, key: process.env.STCFSD_WRITER_KEY_DIR };');
      check('기록의 자리 = 설치본이 정한 것 — 프로젝트 뿌리 <문서>\\StCFSD 프로젝트(시험의 임시 문서 폴더) · 열쇠 <사용자 자료>\\writer', where.roots === root && where.key === path.join(userData, 'writer') && inside(root, tmp),
        short(where, 200));
      fs.mkdirSync(root, { recursive: true });   // 문서 폴더 아래 뿌리 — 사람이 처음 「새 프로젝트」 할 때 화면이 만드는 것과 같다
      const pj = await R.ev(`return ctx.host.recordsPerson().createProject(${JSON.stringify(root)}, '설치본 시험');`).catch(e => ({ error: String(e) }));
      const pdir = path.join(root, '설치본 시험');
      // 설치본의 MCP 서버(그 폴더의 StCFSD.exe) — AI 의 몫(대상 · 실행 · 설계 · 가정의 「확정」 을 옮겨 적기 · 초안)
      const entryR = await R.ev('return ctx.entry;');
      const mr = startMcp(entryR, hostileEnv(h));
      await mr.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'packaged-records', version: '0' } });
      mr.notify('notifications/initialized', {});
      const nc = await mr.tool('new_case', { name: 'P1', kind: 'section-only' });
      const oc = await mr.tool('open_case', { name: 'P1' });
      const csd = path.join(pdir, '02_검토대상', 'P1.csd');
      const logText = () => { const out = []; const walk = d => { for (const n of (fs.existsSync(d) ? fs.readdirSync(d) : [])) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) { walk(p); } else { out.push(fs.readFileSync(p, 'utf8')); } } }; walk(path.join(pdir, '.stcfsd')); return out.join('\n'); };
      check('프로젝트를 만들고(stcfsd-project.json) 02_검토대상 의 .csd 를 연다 → 기록에 opened 줄', !pj?.error && fs.existsSync(path.join(pdir, 'stcfsd-project.json')) && fs.existsSync(csd) && !nc.isError && !oc.isError && /"event":"opened"/.test(logText()),
        `${Date.now() - t} ms · ${short(pj?.error ?? pj?.name, 40)} · new_case ${nc.isError ? short(nc.text, 60) : 'ok'} · open_case ${oc.isError ? short(oc.text, 60) : 'ok'}`);
      await mr.tool('set_section_template', { type: 'lippedc', H: 150, B: 65, D: 20, t: 2.3, r: 3, units: 'SI' });
      await mr.tool('set_load_case', { load_case: 'bending_xx_pos', fy: 295, units: 'SI' });
      const run = await mr.tool('run_analysis', {});
      const st1 = await R.ev('return await ctx.hostAction("get_case_status", { detail: "runs" });');
      check('좌굴 해석 → 실행 줄(runs)', !run.isError && Array.isArray(st1?.runs) && st1.runs.length > 0 && st1?.results?.buckling_analysis?.state === 'match',
        `실행 ${st1?.runs?.length ?? 0} · buckling_analysis ${st1?.results?.buckling_analysis?.state}`);
      await mr.tool('save_case', {});
      await mr.tool('new_case', { name: 'P2', kind: 'section-only' });
      await mr.tool('open_case', { name: 'P2' });
      await mr.tool('open_case', { name: 'P1' });
      const st2 = await R.ev('return await ctx.hostAction("get_case_status", {});');
      check('저장 → 다른 대상 → 다시 열기 → get_case_status: 좌굴 해석 「match」(기록한 실행과 같은 결과)', st2?.results?.buckling_analysis?.state === 'match', short(st2?.results, 160));
      // 화면의 한국어 · SI 알림 — 묶음 안의 notices.js 가 그린다
      await R.page(`(()=>{ window.__stcfsdUi.review(); window.__stcfsdUi.select('result', 'fsm'); return 1; })()`);
      const info = await until(() => R.page(`(()=>{ const t = document.getElementById('info')?.innerText ?? ''; return /좌굴/.test(t) && /mm|MPa/.test(t) ? t : null; })()`), 20_000);
      check('화면의 한국어 · SI 알림(묶음의 notices.js · 새 화면) — 정보 창에 「좌굴」 · SI 단위, undefined · [object Object] 없음', !!info && !/undefined|\[object Object\]/.test(info), short(info?.replace(/\s+/g, ' '), 120));
      // 설계(AI) → 가정의 「확정」(AI 가 옮겨 적음) → 사람의 확인(사람의 얼굴 — 이 프로세스 안) → 저장 → 초안(AI) → 미리보기 · 발행(사람)
      const fr = await mr.tool('aisi_design_flexure', { detail: 'full', Fy: 295, Fu: 400, Mu: 3, Vu: 3, Lb: 1524, design_method: 'LRFD', units: 'SI' });
      const asms = (await R.ev('return await ctx.hostAction("assumptions", { op: "list" });'))?.items ?? [];
      for (const a of asms.filter(x => x.blocks_issue)) { await mr.tool('assumptions', { action: 'update', item: a.item, status: 'firm' }); }
      const asms2 = (await R.ev('return await ctx.hostAction("assumptions", { op: "list" });'))?.items ?? [];
      const gr = await R.ev('return await ctx.hostAction("get_reviews", { limit: 200 });');
      const targets = [...(gr?.items ?? []).filter(x => x.type === 'check' && x.fp && x.key).map(x => ({ type: 'check', key: x.key, shown: x.fp })),
        ...asms2.filter(x => x.blocks_issue).map(x => ({ type: 'assumption', id: x.item, shown: x.seq }))];
      const mk = await R.ev(`return ctx.host.recordsPerson().review({ mark: true, targets: ${JSON.stringify(targets)} });`).catch(e => ({ error: String(e) }));
      await mr.tool('save_case', {});
      const draft = await mr.tool('generate_report', { kind: 'design', format: 'html', report_units: 'SI' });
      const ck = await R.ev('return await ctx.hostAction("documents", { op: "check" });');
      check('설계 · 확인 · 저장 · 초안(설치본 안의 그리기) → 발행 전 점검의 막는 것 0', !fr.isError && !mk?.error && !draft.isError && ck?.blocked === false,
        `확인 ${targets.length} · 표시 ${short(mk?.error ?? mk?.event, 40)} · 초안 ${draft.isError ? short(draft.text, 60) : short(draft.json?.draft, 20)} · 막는 것 ${(ck?.blockers ?? []).map(b => b.code).join(',') || '없음'}`);
      t = Date.now();
      const iss = ck?.blocked === false ? await R.ev(`const p = ctx.host.recordsPerson(); const pv = p.issuePreview(); const r = await p.issue({ fingerprint: pv.fingerprint, nonce: pv.nonce }); return { label: pv.label, folder: r.folder, files: r.files.map(f => ({ path: f.path, role: f.role })) };`, 300_000).catch(e => ({ error: String(e) })) : { error: '막는 것이 있어 발행하지 않음' };
      const files = iss?.files ?? [];
      const pdfs = files.filter(f => /\.pdf$/i.test(f.path)).map(f => fs.readFileSync(path.join(pdir, ...f.path.split('/'))).subarray(0, 5).toString('latin1'));
      const csdCopy = files.find(f => f.role === 'case-file');
      check('발행 R0 — 설치본의 보이지 않는 진짜 인쇄(PDF) · 묶음(계산서 · 검증표 · .csd 사본 · 목록 파일)', !iss?.error && iss.label === 'R0' && pdfs.length >= 2 && pdfs.every(x => x === '%PDF-') && !!csdCopy
        && sha(path.join(pdir, ...csdCopy.path.split('/'))) === sha(csd),
        `${Date.now() - t} ms · ${short(iss?.error, 120) ?? ''}${iss?.folder ?? ''} · 파일 ${files.map(f => f.role).join(', ')} · PDF ${pdfs.join(',')}`);
      await R.capture?.('s5_03_records');
      await mr.close();
      await quit(R, 'R');
    }
    // 제거 도우미 — 제거 프로그램이 부르는 것 그대로(그 폴더의 StCFSD.exe 를 node 로), 다만 설정 · 사용자 폴더는 가짜 · 임시
    const plainEnv = hostileEnv(h);
    const d1 = runDisconnect(exe, res, fakeClaude, userData, plainEnv);
    const afterD1 = JSON.parse(fs.readFileSync(fakeClaude, 'utf8'));
    check('V5-05 · 제거 도우미 → 이 설치본의 stcfsd 항목만 지운다(다른 항목 · 비밀 그대로) · 종료 코드 0', d1.code === 0 && d1.out?.ok && d1.out.action === 'removed'
      && !afterD1.mcpServers.stcfsd && afterD1.mcpServers.other?.env?.API_KEY === 'keep-me', short(d1.out ?? d1.raw, 200));
    const d2 = runDisconnect(exe, res, fakeClaude, userData, plainEnv);
    check('V5-05 · 다시 돌리면 「없음」 — 쓰지 않는다', d2.code === 0 && d2.out?.action === 'absent' && d2.out.wrote === false, short(d2.out, 120));
    const elsewhere = { mcpServers: { stcfsd: { command: 'C:\\Other\\StCFSD.exe', args: ['C:\\Other\\resources\\app-root\\media\\mcp-server.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }, other: { command: 'o' } } };
    fs.writeFileSync(fakeClaude, JSON.stringify(elsewhere, null, 2));
    const before3 = fs.readFileSync(fakeClaude);
    const d3 = runDisconnect(exe, res, fakeClaude, userData, plainEnv);
    check('V5-05 · 다른 설치를 가리키는 stcfsd 는 그대로(kept) — 파일 바이트 그대로', d3.code === 0 && d3.out?.action === 'kept' && before3.equals(fs.readFileSync(fakeClaude)), short(d3.out, 120));
    fs.writeFileSync(fakeClaude, '{ "mcpServers": ');
    const d4 = runDisconnect(exe, res, fakeClaude, userData, plainEnv);
    check('V5-05 · 깨진 설정이어도 제거를 막지 않는다(종료 코드 0, 손대지 않음)', d4.code === 0 && d4.out?.ok === false && fs.readFileSync(fakeClaude, 'utf8') === '{ "mcpServers": ', short(d4.out, 120));
  } catch (err) {
    check('설치본 실행 확인이 예외 없이 끝난다', false, String(err?.stack ?? err).slice(0, 1500));
  } finally {
    try { await mcp?.close(); } catch { /* */ }
    for (const p of launched) { if (p.exitCode === null && p.pid) { spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }); } }
  }

  section('5. 띄운 것이 배포물이었나 · 남은 것 · 진짜 설정 · 저장소');
  if (shippedHashes) {
    const now = hashTree(appDir);
    // Python 은 돌 때 모듈 옆 __pycache__ 에 바이트코드 캐시를 쓴다(엔진 소스 · numpy 의 몇 모듈 — 제품 동작, 확장에서도 같다). 새로 생긴 .pyc 는 따로 센다.
    const pycAdded = [...now.keys()].filter(k => !shippedHashes.has(k) && /^resources\/(app-root\/python|python)\/(.+\/)?__pycache__\/[^/]+\.pyc$/.test(k));
    const changedFiles = [...new Set([...now.keys(), ...shippedHashes.keys()])]
      .filter(k => k !== `resources/${MARKER}` && !pycAdded.includes(k) && now.get(k) !== shippedHashes.get(k));
    check('끝난 뒤에도 배포한 파일은 모두 그대로 · 더해진 것은 표시 파일과 엔진의 바이트코드 캐시(__pycache__)뿐', changedFiles.length === 0 && now.has(`resources/${MARKER}`),
      changedFiles.slice(0, 5).join(', ') || `${shippedHashes.size}개 그대로 + 표시 파일 · 엔진이 쓴 .pyc ${pycAdded.length}개(제거 때 폴더와 함께 지워진다)`);
    process.stdout.write(`    · 설치 파일 ${human(fs.statSync(setupPath).size)} · 설치 뒤 ${human(duBytes(unpackedSrc))} (Electron ${human(duBytes(unpackedSrc) - duBytes(path.join(unpackedSrc, 'resources')))} · Python ${human(pyInfo.sizes.totalBytes)} · 앱 ${human(manifest.totals.bytes)})\n`);
  }
  await sleep(500);
  const table = processTable();
  const left = table.filter(r => r.exe && inside(r.exe, tmp));
  check('그 폴더에서 뜬 프로세스가 하나도 남지 않았다', left.length === 0, left.map(r => `${r.name}#${r.pid}`).join(', ') || '0');
  const changed = real.changed();
  check('진짜 Claude · MCP 설정 · %APPDATA%\\StCFSD · 설치 자리(%LOCALAPPDATA%\\Programs\\StCFSD) · 바로 가기 그대로', changed.length === 0, changed.join(', ') || `${real.list.length}곳`);
  const repoChanged = [...repoSnapshot()].filter(([k, v]) => repoBefore.get(k) !== v).map(([k]) => k);
  check('desktop/ 밖에서 저장소가 바뀌지 않았다', repoChanged.length === 0, repoChanged.join(', ') || '그대로');
  return finish(tmp);
}

function finish(tmp) {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 잠긴 파일 — 임시 폴더라 둔다 */ }
  const failed = results.filter(r => !r.ok);
  process.stdout.write(`\n결과: ${results.length - failed.length}/${results.length} 통과 · ${((Date.now() - started) / 1000).toFixed(1)} s · 그림 ${OUT}\n`);
  if (failed.length) { process.stdout.write(`실패: ${failed.map(f => f.name).join(' / ')}\n`); process.exitCode = 1; }
}

main().catch(err => { process.stdout.write(`실패  예외: ${err?.stack ?? err}\n`); process.exit(1); });
