// U1 — 창(Electron)에서 새 검토 화면(`--ui`). 진짜 앱 · 진짜 호스트 · Python, 창은 한 번도 보이지 않는다(shell.mjs 와 같은 방식).
//
//   cd desktop/shell && npm test        (shell.mjs 뒤에 이 파일)
//   node desktop/shell/test/ui.mjs      (SHELL_VERBOSE=1 이면 껍데기 출력)
//
// 확인: `--ui` 면 창이 /ui/ 를 싣고(Bearer · 쿠키 0), 새 화면이 다리를 읽어 명령줄의 .csd 를 검토 화면으로 보이며, 끼운 설계 웹뷰가
// 붙어 있고 F2 로 보인다 · 창은 보이지 않고 포커스를 받지 않는다 · 끝내면 자식 · 포트 파일이 남지 않는다 · 진짜 설정 · 저장소 그대로.
// 스위치 없는 기본(틀 `/`)은 shell.mjs 가 본다.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const shellDir = path.resolve(here, '..');
const repoRoot = path.resolve(shellDir, '..', '..');
const OUT = path.join(here, 'out');
const VERBOSE = process.env.SHELL_VERBOSE === '1';
const electronPath = require(path.join(shellDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-shell-ui-'));
const userData = path.join(tmp, 'user data 사용자');
const docs = path.join(tmp, 'Documents');
const fakeClaude = path.join(tmp, 'fake', 'Claude', 'claude_desktop_config.json');
fs.mkdirSync(docs, { recursive: true });
fs.mkdirSync(path.dirname(fakeClaude), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const FILE = path.join(tmp, '검토 사본 U.csd');
fs.copyFileSync(path.join(repoRoot, 'Example', 'test.csd'), FILE);
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
function realConfigPaths() {
  const home = process.env.USERPROFILE || os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return [path.join(appData, 'Claude', 'claude_desktop_config.json'), path.join(home, '.claude', 'mcp.json'), path.join(home, '.claude.json'),
    path.join(repoRoot, '.mcp.json'), path.join(repoRoot, '.claude', 'mcp.json'), path.join(repoRoot, 'Example', '.mcp.json'),
    path.join(repoRoot, 'Example', '.claude', 'mcp.json'), path.join(appData, 'StCFSD'), path.join(appData, 'StCFSD', 'mcp', 'stcfsd-mcp-port')];
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

async function launch(args, label) {
  const env = { ...process.env, STCFSD_SHELL_TEST: '1', STCFSD_DOCUMENTS: docs, STCFSD_CLAUDE_CONFIG: fakeClaude };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [shellDir, '--user-data', userData, ...args], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env, windowsHide: true });
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
  const capture = name => call({ type: 'capture', file: path.join(OUT, `${name}.png`) }).then(() => path.join(OUT, `${name}.png`));
  const ok = await until(() => stage, 120_000, 200);
  if (!ok || stage.type === 'fatal') { throw new Error(`앱이 뜨지 않았다(${label}): ${short(stage ?? out.slice(-1500), 1500)}`); }
  return { child, pid: child.pid, stage, ev, page, capture, exited, out: () => out };
}

async function main() {
  const real = realConfigPaths();
  const realBefore = new Map(real.map(f => [f, statOf(f)]));
  const repoBefore = repoSnapshot();
  let A;
  try {
    section('1. 창에서 새 검토 화면(--ui) — 보이지 않게');
    let t = Date.now();
    A = await launch(['--ui', FILE], 'U');
    check('앱이 뜨고 창은 새 검토 화면(/ui/)을 싣는다', A.stage.stage === 'running' && A.stage.screen === '/ui/', `${Date.now() - t} ms · ${A.stage.origin}${A.stage.screen}`);
    const url = await A.ev('return ctx.win.webContents.getURL();');
    check('창의 주소는 토큰 없는 /ui/', url === `${A.stage.origin}/ui/`, url);
    const ready = await until(() => A.page(`(()=>{const u=window.__stcfsdUi; if(!u||!u.state.ready) return null; const s=u.state;
      return s.file.path && u.ui.screen==='review' && s.full && s.nodes.length>0 ? {file:s.file.name, nodes:s.nodes.length, fname:document.querySelector('#tbar .fname').textContent,
        tree:document.querySelectorAll('#tree .row').length, info:document.getElementById('info').innerText.length} : null;})()`), 90_000);
    check('명령줄의 .csd 를 열어 검토 화면으로 — 트리 · 정보 창 · 제목 표시줄', ready?.file === path.basename(FILE) && ready.fname === path.basename(FILE) && ready.tree > 5 && ready.info > 50,
      short(ready));
    const wv = await until(() => A.page(`(()=>{const f=document.getElementById('designer'); const d=f&&f.contentDocument;
      return d && d.documentElement.getAttribute('data-stcfsd-bridge')==='connected' && d.documentElement.hasAttribute('data-stcfsd-replayed') && d.querySelectorAll('.tab-btn').length>=6
        ? getComputedStyle(document.getElementById('edit')).visibility : null;})()`), 60_000);
    check('지금의 설계 화면(탭 6개)이 끼워져 붙어 있고 숨겨져 있다', wv === 'hidden', `편집 칸 ${wv}`);
    const cookies = await A.ev('return (await ctx.win.webContents.session.cookies.get({})).length;');
    check('인증은 Bearer — 쿠키 0', cookies === 0, `쿠키 ${cookies}`);
    const f2 = await A.page(`(async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true})); await new Promise(r=>setTimeout(r,300));
      const on=getComputedStyle(document.getElementById('edit')).visibility; document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}));
      await new Promise(r=>setTimeout(r,300)); return on+' → '+getComputedStyle(document.getElementById('edit')).visibility;})()`);
    check('F2 — 편집 상태가 열리고 닫힌다', f2 === 'visible → hidden', f2);
    await A.page('window.__themeMark = 1; true');
    await A.ev(`return ctx.menuClick('theme-light');`);
    const th = await until(() => A.page(`document.documentElement.dataset.theme === 'light' ? (window.__themeMark === 1 ? 'same-page' : 'reloaded') : null`), 10_000);
    await A.ev(`return ctx.menuClick('theme-dark');`);
    const th2 = await until(() => A.page(`document.documentElement.dataset.theme === 'dark' && window.__themeMark === 1`), 10_000);
    check('메뉴의 테마 — 새 화면은 페이지를 다시 싣지 않고 바뀐다', th === 'same-page' && th2 === true, `밝게 ${th} · 어둡게 ${th2}`);
    const errs = await A.ev(`return ctx.diag.rendererConsole.filter(c => c.level === 'error' || c.level === '3').map(c => c.message);`);
    check('창의 콘솔 오류 0', errs.length === 0, errs.slice(0, 3).join(' / ') || '0');
    const shot = await A.capture('u1_window_ui');
    check('보이지 않는 창의 화면을 찍는다', fs.statSync(shot).size > 20_000, `${path.basename(shot)} ${fs.statSync(shot).size} bytes`);
    const s = await A.ev('return { visible: ctx.win.isVisible(), focused: ctx.win.isFocused(), show: ctx.diag.showEvents, focus: ctx.diag.focusEvents };');
    check('창은 보이지 않고 포커스를 받은 적이 없다', !s.visible && !s.focused && s.show === 0 && s.focus === 0, JSON.stringify(s));

    section('2. 끝내기');
    const kids = descendants(A.pid);
    await A.ev('setTimeout(() => ctx.app.quit(), 50); return true;').catch(() => undefined);
    const exit = await Promise.race([A.exited, sleep(30_000).then(() => undefined)]);
    for (let i = 0; i < 100 && kids.some(k => alive(k.pid)); i++) { await sleep(100); }
    const left = kids.filter(k => alive(k.pid));
    check('끝내기 → 코드 0 · 자식 0 · 포트 파일 지움', exit?.code === 0 && left.length === 0 && !fs.existsSync(portFile),
      `${exit ? `코드 ${exit.code}` : '안 끝남'} · 자식 ${kids.length}개 중 남음 ${left.length}`);
    if (!exit) { spawnSync('taskkill', ['/PID', String(A.pid), '/T', '/F'], { windowsHide: true }); }
    A = undefined;
  } catch (err) {
    check('창 시험(--ui)이 예외 없이 끝난다', false, String(err?.stack ?? err).slice(0, 1200));
    if (A) { spawnSync('taskkill', ['/PID', String(A.pid), '/T', '/F'], { windowsHide: true }); }
  }
  section('3. 진짜 설정 · 저장소');
  const changed = real.filter(f => statOf(f) !== realBefore.get(f));
  check('진짜 Claude Desktop 설정 · ~/.claude · %APPDATA%\\StCFSD 가 그대로(열지 않음)', changed.length === 0, changed.join(', ') || `${real.length}곳`);
  const after = repoSnapshot();
  const diff = [...after].filter(([k, v]) => repoBefore.get(k) !== v).map(([k]) => k).concat([...repoBefore.keys()].filter(k => !after.has(k)));
  check('desktop/ 밖 저장소 그대로', diff.length === 0, diff.slice(0, 5).join(', ') || '그대로');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 잠금 */ }
  const failed = results.filter(r => !r.ok);
  process.stdout.write(`\n결과: ${results.length - failed.length}/${results.length} 통과 · ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  if (failed.length) { process.stdout.write(`실패: ${failed.map(f => f.name).join(' / ')}\n`); process.exitCode = 1; }
}

main().catch(err => { process.stdout.write(`시험 예외: ${err?.stack ?? err}\n`); process.exitCode = 1; });
