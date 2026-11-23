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
import { watchRealConfig } from '../../host/test/lib/realConfig.mjs';

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
/** --only=<절 id,…> — 「1b」 또는 「1c」(둘은 한 묶음 — 1c 가 1b 의 도우미를 쓴다) · 「2b」 가운데 준 것만 돈다(1 · 2 · 3 은 늘 — 띄우기 · 끝내기 · 저장소 확인) */
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7).split(',').map(x => x.trim()).filter(Boolean);
const want = id => !ONLY.length || ONLY.includes(id);
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

function shellEnv() {
  const env = { ...process.env, STCFSD_SHELL_TEST: '1', STCFSD_DOCUMENTS: docs, STCFSD_CLAUDE_CONFIG: fakeClaude };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
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
  const real = watchRealConfig(repoRoot);
  const repoBefore = repoSnapshot();
  let A;
  try {
    section('1. 창에서 새 검토 화면(--ui) — 보이지 않게');
    let t = Date.now();
    A = await launch(['--ui', FILE], 'U');
    check('앱이 뜨고 창은 새 검토 화면(/ui/)을 싣는다', A.stage.stage === 'running' && A.stage.screen === '/ui/', `${Date.now() - t} ms · ${A.stage.origin}${A.stage.screen}`);
    // 창의 첫 이동이 확정되기 전에 물으면 빈 주소다 — 확정을 기다린다
    const url = await until(() => A.ev('return ctx.win.webContents.getURL() || null;'), 15_000);
    check('창의 주소는 토큰 없는 /ui/', url === `${A.stage.origin}/ui/`, url);
    const ready = await until(() => A.page(`(()=>{const u=window.__stcfsdUi; if(!u||!u.state.ready) return null; const s=u.state;
      return s.file.path && u.ui.screen==='review' && s.full && s.nodes.length>0 ? {file:s.file.name, nodes:s.nodes.length, fname:document.querySelector('#tbar .fname').textContent,
        tree:document.querySelectorAll('#tree .row').length, info:document.getElementById('info').innerText.length} : null;})()`), 90_000);
    check('명령줄의 .csd 를 열어 검토 화면으로 — 트리 · 정보 창 · 제목 표시줄', ready?.file === path.basename(FILE) && ready.fname === path.basename(FILE) && ready.tree > 5 && ready.info > 50,
      short(ready));
    // 끼운 웹뷰는 다른 출처(다리의 웹뷰 서버) — 주 프로세스가 그 프레임(WebFrameMain)에서 직접 본다
    const wv = await until(async () => (await A.ev(`const mf = ctx.win.webContents.mainFrame;
      const f = mf.framesInSubtree.find(x => x !== mf && x.url.includes('/wv/' + encodeURIComponent(ctx.host.designer.id) + '/'));
      return f ? await f.executeJavaScript("document.documentElement.getAttribute('data-stcfsd-bridge')==='connected' && document.documentElement.hasAttribute('data-stcfsd-replayed') && document.querySelectorAll('.tab-btn').length>=6", true) : false;`))
      ? A.page(`getComputedStyle(document.getElementById('edit')).visibility`) : null, 60_000);
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
    // U3 — AI 따라가기: 켜 두고 AI 의 focus 를 따라가도 창은 보이지 않고 포커스를 받지 않는다(구성안 3.9 · 보기 계약 5절)
    await A.page(`(()=>{document.querySelector('[data-act="follow"]').click(); return 1;})()`);
    await until(() => A.page(`window.__stcfsdUi.ui.idleMs > 5300 || null`), 20_000);
    const hostAction = body => A.ev(`const r = await fetch('http://127.0.0.1:' + ctx.host.mcp.port + '/action', { method: 'POST', headers: { Authorization: 'Bearer ' + ctx.host.mcp.token, 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }); return await r.json();`);
    const fr = await hostAction({ action: 'focus', item: { kind: 'model', id: 'material' }, reason: '창 시험' });
    const moved = await until(() => A.page(`window.__stcfsdUi.ui.sel === 'mat' ? window.__stcfsdUi.ui.tab : null`), 15_000);
    const gv = await until(async () => { const v = await hostAction({ action: 'get_view' }); return v?.last_focus?.response ? v : null; }, 15_000);
    const sf = await A.ev('return { visible: ctx.win.isVisible(), focused: ctx.win.isFocused(), show: ctx.diag.showEvents, focus: ctx.diag.focusEvents };');
    check('AI 따라가기 켬 → MCP focus 를 따라간다 · get_view 가 그렇다고 말한다 · 창은 보이지 않고 포커스를 받지 않는다',
      fr?.forwarded === true && moved === 'model' && gv?.last_focus?.response?.followed === true && gv?.current?.by === 'focus' && !sf.visible && !sf.focused && sf.show === 0 && sf.focus === 0,
      `forwarded ${fr?.forwarded} · 화면 ${moved}/mat · followed ${gv?.last_focus?.response?.followed} · by ${gv?.current?.by} · ${JSON.stringify(sf)}`);
    await A.page(`(()=>{document.querySelector('[data-act="follow"]').click(); return 1;})()`);
    const s = await A.ev('return { visible: ctx.win.isVisible(), focused: ctx.win.isFocused(), show: ctx.diag.showEvents, focus: ctx.diag.focusEvents };');
    check('창은 보이지 않고 포커스를 받은 적이 없다', !s.visible && !s.focused && s.show === 0 && s.focus === 0, JSON.stringify(s));

    const unsavedLog = () => A.ev('return ctx.diag.unsaved.slice();');
    if (want('1b') || want('1c')) {
    section('1b. 저장 안 한 변경 — 닫기 · 메뉴의 열기 · 다시 실행(파일 연결) 앞에서 묻는다(V5-12c, K2 §7)');
    const pageDialog = () => until(() => A.page(`(()=>{const d=document.querySelector('#dialog-host .dialog'); return d && /저장하지 않은 변경/.test(d.textContent) ? d.textContent.replace(/\\s+/g,' ') : null;})()`), 15_000);
    // 답한 뒤 그 물음이 화면에서 걷힐 때까지 — 다음 단계가 걷히기 전의 옛 물음을 새 물음으로 알고 누르지 않게
    const answerPage = async item => {
      const ok = await A.page(`(()=>{const b=document.querySelector('#dialog-host [data-item="${item}"]'); if(b){b.click(); return true;} return false;})()`);
      await until(async () => ((await A.page(`!!document.querySelector('#dialog-host [data-item="${item}"]')`)) ? undefined : true), 10_000);
      return ok;
    };
    // 깨끗할 때는 묻지 않는다
    const n0 = (await unsavedLog()).length;
    await A.ev(`return ctx.menuClick('file-open');`);
    await sleep(1200);
    const l0 = (await unsavedLog()).slice(n0);
    const asked0 = await A.page(`!!document.querySelector('#dialog-host .dialog')`);
    check('저장 안 한 변경이 없으면 묻지 않는다(메뉴 열기 → 곧바로 열기 대화상자)', l0.length === 1 && l0[0].how === 'none' && !asked0, JSON.stringify(l0));
    // 더럽힌다(AI 의 set_case_inputs — 호스트의 상태)
    await hostAction({ action: 'set_case_inputs', inputs: { Lb: 61 }, reason: '창 시험' });
    const dirty1 = await hostAction({ action: 'get_unsaved_changes' });
    const marker = await until(() => A.page(`document.querySelector('#tbar .fname').dataset.dirty==='1' ? document.querySelector('#tbar .fname').textContent : null`), 10_000);
    check('제목 표시줄에 저장 안 한 변경 표시(파일 이름 + ●)', dirty1?.dirty === true && /●$/.test(marker ?? ''), `${marker} · dirty ${dirty1?.dirty}`);
    // 메뉴 열기 → 화면 안의 물음 → 취소: 열기 대화상자를 띄우지 않고 그대로
    const osBefore = await A.ev('return ctx.diag.osDialogs.length;');
    const nLog1 = (await unsavedLog()).length;
    await A.ev(`return ctx.menuClick('file-open');`);
    const q1 = await pageDialog();
    await A.capture('u4_unsaved_prompt');
    const clicked1 = await answerPage('취소');
    const tA = Date.now();
    // 답을 받은 뒤 물음의 기록이 남을 때까지(고정 시간이 아니라 기록으로) — 걸린 시간을 적는다
    await until(async () => ((await unsavedLog()).length > nLog1 ? true : undefined), 15_000);
    const lag1 = Date.now() - tA;
    const dlgAfter = await A.page(`[...document.querySelectorAll('#dialog-host .dialog')].map(d=>d.textContent.slice(0,40))`);
    const osAfter = await A.ev('return ctx.diag.osDialogs.length;');
    const dirty2 = await hostAction({ action: 'get_unsaved_changes' });
    const l1 = (await unsavedLog()).pop();
    check('메뉴 열기 · 저장 안 한 변경 있음 → 화면 안에서 묻고(저장 · 저장 안 함 · 취소) 「취소」면 아무것도 바꾸지 않는다',
      /저장하지 않은 변경/.test(q1 ?? '') && l1?.where === 'open' && l1.how === 'page' && l1.answer === 'cancel' && osAfter === osBefore && dirty2?.dirty === true,
      `「${short(q1, 80)}」 · ${JSON.stringify(l1)} · 열기 대화상자 ${osAfter - osBefore} · 여전히 더러움 ${dirty2?.dirty} · 단추 눌림 ${clicked1} · 기록까지 ${lag1} ms · 남은 물음 ${JSON.stringify(dlgAfter)}`);
    // 메뉴 열기 → 「저장 안 함」 → 열기 대화상자로 간다(시험의 가짜 대화상자는 취소로 답한다)
    await A.ev(`return ctx.menuClick('file-open');`);
    await pageDialog();
    await answerPage('저장 안 함');
    await until(() => A.ev(`return ctx.diag.osDialogs.length > ${osAfter} ? true : null;`), 10_000);
    const l2 = (await unsavedLog()).pop();
    check('「저장 안 함」 → 계속한다(열기 대화상자가 뜬다)', l2?.answer === 'discard', JSON.stringify(l2));
    // 다시 실행(파일 연결과 같은 길) → 「저장」 → 지금 파일에 저장하고 넘어온 파일을 연다
    const other = path.join(tmp, '다른 사본 U2.csd');
    fs.copyFileSync(FILE, other);
    const mtime0 = fs.statSync(FILE).mtimeMs;
    const opened0 = await A.ev('return ctx.diag.opened.length;');
    const second = spawn(electronPath, [shellDir, '--user-data', userData, other], { stdio: 'ignore', env: shellEnv(), windowsHide: true });
    const q3 = await pageDialog();
    await answerPage('저장');
    const opened = await until(() => A.ev(`return ctx.diag.opened.length > ${opened0} ? ctx.diag.opened[ctx.diag.opened.length-1] : null;`), 30_000);
    await Promise.race([new Promise(r => second.once('exit', r)), sleep(20_000)]);
    const l3 = (await unsavedLog()).pop();
    const savedAgain = fs.statSync(FILE).mtimeMs > mtime0 ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
    check('다시 실행 · 파일 연결(.csd 두 번 누름) → 화면 안에서 묻고 「저장」 → 지금 파일에 저장(v1.4, Lb 61 in · 출처 ai) 뒤 넘어온 파일을 연다',
      /저장하지 않은 변경/.test(q3 ?? '') && ['file-association', 'second-instance'].includes(l3?.where) && l3?.answer === 'save' && savedAgain?.version === '1.4'
        && Math.abs(Number(savedAgain?.case?.inputs?.Lb) - 61) < 1e-9 && savedAgain?.case?.sources?.Lb === 'ai' && opened?.file === other && opened.ok,
      `${JSON.stringify(l3)} · 저장본 v${savedAgain?.version} Lb ${savedAgain?.case?.inputs?.Lb}(${savedAgain?.case?.sources?.Lb}) · 연 파일 ${path.basename(opened?.file ?? '')}`);
    // 창 닫기 → OS 물음(시험은 정해 둔 답) → 「취소」 = 창도 프로그램도 그대로
    await hostAction({ action: 'set_case_inputs', inputs: { Lb: 62 }, reason: '창 시험' });
    await A.ev(`ctx.diag.unsavedTestAnswers.push('cancel'); ctx.win.close(); return true;`);
    await sleep(1500);
    const stillOpen = await A.ev('return !!ctx.win && !ctx.win.isDestroyed();');
    const l4 = (await unsavedLog()).pop();
    check('창 닫기 · 저장 안 한 변경 있음 → OS 물음(창을 닫는 것은 사람의 동작) — 「취소」면 창이 그대로', stillOpen && l4?.where === 'close' && l4.how === 'native' && l4.answer === 'cancel',
      `${JSON.stringify(l4)} · 창 ${stillOpen ? '그대로' : '닫힘'}`);
    section('1c. V7-41 · 42 · 44 · 46 · S3 — 열기의 모든 길 · 「저장」의 자리 · 닫기 직전의 입력 · 읽지 못함 · 세션 끝');
    const frameJs = js => A.ev(`const mf = ctx.win.webContents.mainFrame;
      const f = mf.framesInSubtree.find(x => x !== mf && x.url.includes('/wv/' + encodeURIComponent(ctx.host.designer.id) + '/'));
      return f ? await f.executeJavaScript(${JSON.stringify(js)}, true) : null;`);
    const noDialog = () => until(async () => ((await A.page(`!!document.querySelector('#dialog-host .dialog')`)) ? null : true), 10_000);
    // 길마다: 저장 안 한 변경 있음 → 화면 안의 물음 → 「취소」 = 열기 대화상자 없음 · 그대로 더러움 / 「저장 안 함」 = 열기 대화상자
    const paths = [
      ['새 화면의 Ctrl+O', () => A.page(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'o',ctrlKey:true,bubbles:true})); true`)],
      ['시작 화면의 「파일만 열기」', () => A.page(`document.querySelector('#start [data-act="open"]').click(); true`)],
      ['제목 표시줄 「검토 대상 ▾ › 열기」', () => A.page(`(async()=>{document.querySelector('#tbar [data-act="file"]').click(); await new Promise(r=>setTimeout(r,200)); const it=[...document.querySelectorAll('.ci[data-i]')].find(x=>/열기/.test(x.textContent)); it&&it.click(); return !!it;})()`)],
      ['끼운 설계 화면의 Open 단추', () => frameJs(`document.getElementById('btn-file-open').click(); true`)],
    ];
    for (const [label, go] of paths) {
      await hostAction({ action: 'set_case_inputs', inputs: { Lb: 63 }, reason: '열기 길 시험' });
      for (const ans of ['취소', '저장 안 함']) {
        const os0 = await A.ev('return ctx.diag.osDialogs.length;');
        const n1 = (await unsavedLog()).length;
        await go();
        const q = await pageDialog();
        await answerPage(ans);
        await noDialog();
        if (ans === '저장 안 함') { await until(() => A.ev(`return ctx.diag.osDialogs.length > ${os0} ? true : null;`), 10_000); } else { await sleep(800); }
        const os1 = await A.ev('return ctx.diag.osDialogs.length;');
        const lg = (await unsavedLog()).slice(n1);
        const d = await hostAction({ action: 'get_unsaved_changes' });
        const okAns = ans === '취소' ? os1 === os0 && d?.dirty === true : os1 > os0;
        check(`V7-41 · ${label} → 묻는다 · 「${ans}」 ${ans === '취소' ? '= 열기 대화상자 없음 · 그대로' : '= 계속(열기 대화상자)'}`, /저장하지 않은 변경/.test(q ?? '') && lg.length === 1 && lg[0].how === 'page' && okAns,
          `「${short(q, 50)}」 · ${JSON.stringify(lg)} · 열기 대화상자 ${os1 - os0} · 더러움 ${d?.dirty}`);
      }
    }
    // V7-42: AI 의 load_project 가 정한 경로(원시 모델 .json)에 닫기의 「저장」이 묻지 않고 쓰지 않는다 — 저장 자리를 묻는다
    const raw = path.join(tmp, 'AI 가 연 원시 모델.json');
    const sp = await hostAction({ action: 'save_project', filepath: raw });
    const lp = await hostAction({ action: 'load_project', filepath: raw });
    await hostAction({ action: 'set_case_inputs', inputs: { Lb: 66 }, reason: 'V7-42' });
    const rawBefore = fs.readFileSync(raw, 'utf8');
    const osS = await A.ev('return ctx.diag.osDialogs.filter(d => d.kind === "save").length;');
    await A.ev(`ctx.diag.unsavedTestAnswers.push('save'); ctx.win.close(); return true;`);
    await sleep(2000);
    const after42 = { raw: fs.readFileSync(raw, 'utf8') === rawBefore, open: await A.ev('return !!ctx.win && !ctx.win.isDestroyed();'),
      asked: (await A.ev('return ctx.diag.osDialogs.filter(d => d.kind === "save").length;')) - osS, log: (await unsavedLog()).pop() };
    check('V7-42 · AI 가 load_project 로 연 .json 이 지금 파일 → 닫기 「저장」 = 그 파일에 쓰지 않고 저장 자리를 묻는다(시험의 답: 취소 → 창 그대로)',
      !sp?.error && !lp?.error && after42.raw && after42.open && after42.asked === 1 && after42.log?.answer === 'save',
      `원시 모델 그대로 ${after42.raw} · 저장 자리 물음 ${after42.asked} · 창 ${after42.open ? '그대로' : '닫힘'} · ${JSON.stringify(after42.log)}`);
    // 사람이 고른 자리로 저장 — 저장 자리 물음의 답이 .json 이어도 .csd 로만 쓴다
    const pick = path.join(tmp, '사람이 고른 자리.json');
    await A.ev(`ctx.diag.saveTestPaths.push(${JSON.stringify(pick)}); ctx.diag.unsavedTestAnswers.push('save'); ctx.win.close(); return true;`);
    const closed42 = await Promise.race([A.exited.then(() => true), sleep(20_000).then(() => false)]);
    // 창이 닫혔으면 다시 띄운다(이 절의 나머지 · 2절이 창을 쓴다)
    check('V7-42 · 저장 자리를 고르면 그 자리에 .csd 로 쓰고(.json 이 아니다) 닫힌다', closed42 && fs.existsSync(`${pick}.csd`) && !fs.existsSync(pick) && JSON.parse(fs.readFileSync(`${pick}.csd`, 'utf8')).version === '1.4',
      `닫힘 ${closed42} · ${path.basename(pick)}.csd ${fs.existsSync(`${pick}.csd`)} · ${path.basename(pick)} ${fs.existsSync(pick)}`);
    if (closed42) {
      A = await launch([FILE], 'A2');
      await until(() => A.page(`(()=>{const s=window.__stcfsdUi&&window.__stcfsdUi.state; return s && s.file.path ? 1 : null;})()`), 90_000);
      await until(async () => (await frameJs(`document.documentElement.getAttribute('data-stcfsd-bridge')==='connected' && document.documentElement.hasAttribute('data-stcfsd-replayed')`)) ? 1 : null, 60_000);
    }
    // V7-44: 닫기 직전 300 ms 안에 친 글자 — 깨끗한 상태에서 칸에 쳐서 곧바로 닫으면 밀린 입력을 먼저 보내고 묻는다
    const clean = await hostAction({ action: 'get_unsaved_changes' });
    await frameJs(`(()=>{document.querySelector('.tab-btn[data-tab="design"]').click(); const e=document.getElementById('design-Lb'); e.focus(); e.value='4321'; e.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
    await A.ev(`ctx.diag.unsavedTestAnswers.push('cancel'); ctx.win.close(); return true;`);
    await sleep(2000);
    const l44 = (await unsavedLog()).pop();
    const d44 = await hostAction({ action: 'get_unsaved_changes' });
    check('V7-44 · 깨끗한 상태 → 칸에 쳐서(300 ms 모음 안) 곧바로 닫기 → 밀린 입력을 먼저 호스트로 · 묻는다(취소 → 그대로)',
      clean?.dirty === false && l44?.where === 'close' && l44.how === 'native' && l44.answer === 'cancel' && l44.flushed === true && d44?.dirty === true && (d44.inputs_changed ?? []).includes('Lb'),
      `앞 더러움 ${clean?.dirty} · ${JSON.stringify(l44)} · 뒤 ${JSON.stringify(d44?.inputs_changed)}`);
    // V7-46: 읽지 못하면 묻는다(fail closed) · 물음이 떠 있는 동안 ✕ 를 또 눌러도 물음은 하나 · 지나치지 않는다
    await A.ev('ctx.diag.failUnsavedQuery = true; return true;');
    const qBefore = await A.ev('return ctx.diag.unsavedTestAnswers.length;');
    await A.ev(`ctx.diag.unsavedTestAnswers.push('cancel'); ctx.win.close(); ctx.win.close(); return true;`);
    await sleep(2000);
    const l46 = (await unsavedLog()).slice(-2);
    const left46 = await A.ev('return ctx.diag.unsavedTestAnswers.length;');
    const open46 = await A.ev('return !!ctx.win && !ctx.win.isDestroyed();');
    await A.ev('ctx.diag.failUnsavedQuery = false; return true;');
    check('V7-46 · get_unsaved_changes 를 읽지 못함 → 묻는다(「확인할 수 없다」) · ✕ 두 번 → 물음 하나 · 취소면 창 그대로',
      l46.every(x => x.where === 'close' && x.failed === true && x.answer === 'cancel') && left46 === qBefore && open46,
      `${JSON.stringify(l46)} · 남은 시험 답 ${left46} · 창 ${open46 ? '그대로' : '닫힘'}`);
    // V7-S3: 로그오프 · 종료 — 막지 않고 복구본(사용자 폴더 안)을 쓴다 · 다음 실행에 알린다
    await hostAction({ action: 'set_case_inputs', inputs: { Lb: 67 }, reason: 'S3' });
    const fileBefore = (await hostAction({ action: 'get_unsaved_changes' }))?.file;
    await A.ev(`ctx.win.emit('query-session-end', { preventDefault(){}, reasons: ['logoff'] }); return true;`);
    const rec = await until(() => A.ev('return ctx.diag.recovery.length ? ctx.diag.recovery[ctx.diag.recovery.length-1] : null;'), 20_000);
    const recDir = await A.ev('return ctx.recoveryDir;');
    const inUser = !!rec?.file && path.resolve(rec.file).toLowerCase().startsWith(path.resolve(userData).toLowerCase());
    const recJson = rec?.file && fs.existsSync(rec.file) ? JSON.parse(fs.readFileSync(rec.file, 'utf8')) : null;
    const afterRec = await hostAction({ action: 'get_unsaved_changes' });
    check('V7-S3 · 세션 끝(query-session-end) · 저장 안 한 변경 있음 → 사용자 폴더의 recovery/ 에 복구본(.csd 1.4, Lb 67 in) — 지금 파일 · 저장 안 한 변경은 그대로(writeRecoveryCopy)',
      rec?.ok === true && inUser && path.dirname(rec.file) === recDir && recJson?.version === '1.4' && Math.abs(Number(recJson?.case?.inputs?.Lb) - 67) < 1e-9
        && afterRec?.file === fileBefore && afterRec?.dirty === true,
      `${path.relative(userData, rec?.file ?? '')} · ${JSON.stringify({ ok: rec?.ok, dirty: rec?.dirty })} · 지금 파일 그대로 ${afterRec?.file === fileBefore} · 여전히 저장 안 함 ${afterRec?.dirty}`);

    // 그 밖의 확인 — 창은 보이지 않고 포커스를 받지 않았다(물음이 창을 앞으로 꺼내지 않는다)
    const sf2 = await A.ev('return { visible: ctx.win.isVisible(), focused: ctx.win.isFocused(), show: ctx.diag.showEvents, focus: ctx.diag.focusEvents };');
    check('물음 내내 창은 보이지 않고 포커스를 받지 않는다', !sf2.visible && !sf2.focused && sf2.show === 0 && sf2.focus === 0, JSON.stringify(sf2));

    }
    section('2. 끝내기 — 창 닫기 · 「저장 안 함」');
    const kids = descendants(A.pid);
    await A.ev(`ctx.diag.unsavedTestAnswers.push('discard'); setTimeout(() => ctx.win.close(), 50); return true;`).catch(() => undefined);
    const exitByClose = await Promise.race([A.exited, sleep(30_000).then(() => undefined)]);
    check('창 닫기 → 「저장 안 함」 → 창이 닫히고 프로그램이 끝난다(코드 0)', exitByClose?.code === 0, exitByClose ? `코드 ${exitByClose.code}` : '안 끝남');
    const exit = exitByClose ?? await Promise.race([A.exited, sleep(30_000).then(() => undefined)]);
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
  if (want('2b')) {
  section('2b. 기본 화면 = 새 검토 화면(스위치 없이) · 예전의 틀은 --ui classic');
  for (const [label, extra, want] of [['스위치 없이', [], '/ui/'], ['--ui classic', ['--ui', 'classic'], '/']]) {
    let B;
    try {
      B = await launch([...extra, FILE], label === '스위치 없이' ? 'D' : 'C');
      const url = await until(() => B.ev('return ctx.win.webContents.getURL() || null;'), 15_000);
      const what = await until(() => B.page(`window.__stcfsdUi ? 'ui' : (window.__stcfsdFrame ? 'frame' : null)`), 30_000);
      check(`창 ${label} → ${want === '/ui/' ? '새 검토 화면(/ui/)' : '예전의 틀(/)'}`, B.stage.screen === want && url === `${B.stage.origin}${want}` && what === (want === '/ui/' ? 'ui' : 'frame'),
        `${B.stage.screen} · ${url?.replace(B.stage.origin, '')} · ${what}`);
      await B.ev('setTimeout(() => ctx.app.quit(), 50); return true;').catch(() => undefined);
      const ex = await Promise.race([B.exited, sleep(30_000).then(() => undefined)]);
      if (!ex) { spawnSync('taskkill', ['/PID', String(B.pid), '/T', '/F'], { windowsHide: true }); }
    } catch (err) {
      check(`창 ${label}`, false, String(err?.message ?? err).slice(0, 300));
      if (B) { spawnSync('taskkill', ['/PID', String(B.pid), '/T', '/F'], { windowsHide: true }); }
    }
  }

  }
  section('3. 진짜 설정 · 저장소');
  const changed = real.changed();
  check('진짜 Claude Desktop 설정 · ~/.claude · %APPDATA%\\StCFSD 가 그대로(크기 · 시각, ~/.claude.json 은 MCP 등록만)', changed.length === 0, changed.join(', ') || `${real.list.length}곳`);
  const after = repoSnapshot();
  const diff = [...after].filter(([k, v]) => repoBefore.get(k) !== v).map(([k]) => k).concat([...repoBefore.keys()].filter(k => !after.has(k)));
  check('desktop/ 밖 저장소 그대로', diff.length === 0, diff.slice(0, 5).join(', ') || '그대로');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 잠금 */ }
  const failed = results.filter(r => !r.ok);
  process.stdout.write(`\n결과: ${results.length - failed.length}/${results.length} 통과 · ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  if (failed.length) { process.stdout.write(`실패: ${failed.map(f => f.name).join(' / ')}\n`); process.exitCode = 1; }
}

main().catch(err => { process.stdout.write(`시험 예외: ${err?.stack ?? err}\n`); process.exitCode = 1; });
