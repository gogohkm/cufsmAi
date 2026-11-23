// S1 연기 시험 — CLI 와 똑같이 화면 없는 호스트(host/dist/headless.js)를 자식 프로세스로 띄우고,
// MCP 서버가 쓰는 길(MCP 다리의 GET /status · POST /action)로 단면 → 좌굴 해석 → DSM,
// .csd 열기 → 하중 해석 → 퍼린 설계 → 부재 설계 → 저장(호스트의 저장 대화상자 길) → 다시 열기를 확인한다.
// 진짜 Python 엔진(.venv)을 쓴다. 끝나면 Python 프로세스 · 포트가 남지 않고, 저장소에 쓴 것이 없어야 한다.
//
//   cd desktop && npm test        (형 검사 · 빌드 후 이 파일을 돈다)
//   node desktop/host/test/smoke.mjs
//
// 모델 파일은 임시 폴더의 사본만 연다 — 저장소의 파일을 직접 열지 않는다.
// 호스트의 기록(stderr)은 실패할 때 끝부분을 보인다. 모두 보려면 SMOKE_VERBOSE=1.
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const HEADLESS = path.join(here, '..', 'dist', 'headless.js');
const MCP_SERVER = path.join(repoRoot, 'media', 'mcp-server.js');
const EXAMPLE_CSD = path.join(repoRoot, 'Example', 'test.csd');
// 지금 코드가 쓴 .csd(웹뷰 · 호스트가 쓴 설계 입력) — 화면 시험(npm run test:rendered)이 남긴다. 없으면 건너뛴다.
const CURRENT_CSD_CANDIDATES = [
  path.join(repoRoot, 'test', 'rendered', 'out', 'r_blank.csd'),
  path.join(repoRoot, 'test', 'rendered', 'out', 'r_proj13.csd'),
];
const VERBOSE = process.env.SMOKE_VERBOSE === '1';

const results = [];
const started = Date.now();
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  process.stdout.write(`${ok ? '  통과' : '  실패'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
  return !!ok;
}
const section = title => process.stdout.write(`\n▶ ${title}  (+${((Date.now() - started) / 1000).toFixed(1)} s)\n`);
const short = (v, n = 220) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 저장소 · 설정 파일의 모습 ─────────────────────────────────────────────
/** desktop/ 밖에서 git 이 보는 변경 · 추적 안 된 파일과 그 크기 · 수정 시각 */
function repoSnapshot() {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) { throw new Error(`git status 실패: ${r.stderr}`); }
  const map = new Map();
  const parts = r.stdout.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i].slice(0, 2);
    const file = parts[i].slice(3);
    if (status[0] === 'R' || status[0] === 'C') { i++; }   // 이름 바뀜: 다음 칸이 옛 이름
    if (file.startsWith('desktop/')) { continue; }
    let st = 'none';
    try { const s = fs.statSync(path.join(repoRoot, file)); st = `${s.size}:${s.mtimeMs}`; } catch { /* 지워진 파일 */ }
    map.set(file, `${status}|${st}`);
  }
  return map;
}
function diffSnapshots(a, b) {
  const out = [];
  for (const [k, v] of b) { if (a.get(k) !== v) { out.push(`${k} (${a.get(k) ?? '없음'} → ${v})`); } }
  for (const k of a.keys()) { if (!b.has(k)) { out.push(`${k} (사라짐)`); } }
  return out;
}
const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();
const MCP_CONFIG_FILES = [
  path.join(repoRoot, '.mcp.json'), path.join(repoRoot, '.claude', 'mcp.json'),
  path.join(repoRoot, 'Example', '.mcp.json'), path.join(repoRoot, 'Example', '.claude', 'mcp.json'),
  path.join(HOME, '.claude', 'mcp.json'),
];
const statOf = f => { try { const s = fs.statSync(f); return `${s.size}:${s.mtimeMs}`; } catch { return '없음'; } };

/** 이 pid 아래의 모든 자손 프로세스(Windows: CIM, 그 밖: ps) */
function descendants(rootPid) {
  let rows = [];
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], { encoding: 'utf8' });
    try { rows = JSON.parse(r.stdout).map(p => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name })); } catch { rows = []; }
  } else {
    const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' });
    rows = r.stdout.split('\n').map(l => l.trim().split(/\s+/)).filter(a => a.length >= 3)
      .map(([pid, ppid, ...name]) => ({ pid: Number(pid), ppid: Number(ppid), name: name.join(' ') }));
  }
  const found = [];
  const queue = [rootPid];
  while (queue.length) {
    const p = queue.shift();
    for (const row of rows) { if (row.ppid === p && !found.some(f => f.pid === row.pid)) { found.push(row); queue.push(row.pid); } }
  }
  return found;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

function portIsFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

// ── 호스트(자식 프로세스) ────────────────────────────────────────────────
function startCli(args) {
  const child = spawn(process.execPath, [HEADLESS, ...args], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const stdoutLines = [];
  let stderrTail = '';
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', c => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { stdoutLines.push(buf.slice(0, nl).replace(/\r$/, '')); buf = buf.slice(nl + 1); }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', c => {
    stderrTail = (stderrTail + c).slice(-20_000);
    if (VERBOSE) { process.stderr.write(c); }
  });
  let seq = 0;
  const pending = new Map();
  child.on('message', m => { const p = pending.get(m?.id); if (p) { pending.delete(m.id); p(m); } });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const ipc = (type, extra = {}, timeoutMs = 120_000) => new Promise((resolve, reject) => {
    seq += 1;
    const id = seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`IPC ${type}: ${timeoutMs} ms 안에 답이 없다`)); }, timeoutMs);
    pending.set(id, m => { clearTimeout(timer); m.ok ? resolve(m.result) : reject(new Error(m.error)); });
    child.send({ id, type, ...extra });
  });
  const waitLine = async (re, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = stdoutLines.find(l => re.test(l));
      if (hit) { return hit; }
      if (child.exitCode !== null) { throw new Error(`호스트가 끝났다(코드 ${child.exitCode}) — stderr 끝: ${stderrTail.slice(-1500)}`); }
      if (Date.now() > deadline) { throw new Error(`${timeoutMs} ms 안에 ${re} 줄이 없다 — stdout: ${stdoutLines.join(' | ').slice(-800)}`); }
      await sleep(50);
    }
  };
  return { child, stdoutLines, stderr: () => stderrTail, ipc, waitLine, exited };
}

/** MCP stdio 클라이언트(media/mcp-server.js, 줄 단위 JSON-RPC) */
function startMcpClient(clientEnv) {
  // CLI 가 출력한 환경 그대로(포트 파일 · standalone). 옛 고정 포트 변수는 지운다 — 섞여 들면 안 된다.
  const env = { ...process.env, ...clientEnv };
  delete env.STCFSD_MCP_PORT;
  const child = spawn(process.execPath, [MCP_SERVER], { env, stdio: ['pipe', 'pipe', 'pipe'] });
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
  const request = (method, params, timeoutMs = 30_000) => new Promise((resolve, reject) => {
    seq += 1;
    const id = seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 시간 초과. stderr: ${stderr.slice(-500)}`)); }, timeoutMs);
    pending.set(id, msg => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  const close = () => new Promise(resolve => {
    if (child.exitCode !== null) { resolve(); return; }
    child.once('exit', () => resolve());
    child.stdin.end();
    setTimeout(() => child.kill(), 2000).unref();
  });
  return { request, notify, close };
}

async function main() {
  section('0. 준비');
  if (!fs.existsSync(HEADLESS)) { throw new Error(`${HEADLESS} 가 없다 — desktop 에서 npm run build`); }
  const { isOutStale } = require('../dist/index.js');
  const stale = isOutStale(repoRoot);
  if (stale.stale) {
    process.stdout.write(`  out/ 이 src/ 보다 오래됐다(${stale.newest}) — 루트에서 npx tsc -p ./ 를 돈다\n`);
    const r = spawnSync('npx', ['tsc', '-p', './'], { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' });
    check('out/ 빌드(npx tsc -p ./)', r.status === 0, r.status === 0 ? '' : short(r.stdout + r.stderr, 600));
    if (r.status !== 0) { return; }
  } else {
    check('out/ 이 src/ 보다 새것이다', true);
  }
  const repoBefore = repoSnapshot();
  const configBefore = new Map(MCP_CONFIG_FILES.map(f => [f, statOf(f)]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-s1-smoke-'));
  const userDataDir = path.join(tmp, 'userData');
  const exampleCsd = path.join(tmp, 'example-test.csd');
  fs.copyFileSync(EXAMPLE_CSD, exampleCsd);
  const currentSource = CURRENT_CSD_CANDIDATES.find(f => fs.existsSync(f));
  const currentCsd = currentSource ? path.join(tmp, 'current-code.csd') : undefined;
  if (currentSource) { fs.copyFileSync(currentSource, currentCsd); }
  process.stdout.write(`  임시 폴더: ${tmp}\n  사본: ${path.relative(repoRoot, EXAMPLE_CSD)}`
    + (currentSource ? `, ${path.relative(repoRoot, currentSource)}` : ' (지금 코드가 쓴 .csd 없음 — npm run test:rendered 가 남긴다. 저장본으로 대신한다)') + '\n');
  // 포트 파일(K1)은 임시 폴더에 — 사용자의 %APPDATA%\StCFSD 에는 쓰지 않는다.
  const portFile = path.join(tmp, 'mcp', 'stcfsd-mcp-port');

  section('1. CLI 로 시작 (--open 두 번, --port-file)');
  const args = ['--repo', repoRoot, '--user-data', userDataDir, '--port-file', portFile, '--open', exampleCsd];
  if (currentCsd) { args.push('--open', currentCsd); }
  let t = Date.now();
  const cli = startCli(args);
  let ready;
  try {
    const line = await cli.waitLine(/^STCFSD_HOST_READY /, 150_000);
    ready = JSON.parse(line.slice('STCFSD_HOST_READY '.length));
  } catch (err) {
    check('호스트가 준비 줄(STCFSD_HOST_READY)을 낸다', false, String(err.message ?? err));
    cli.child.kill();
    return;
  }
  const head = cli.stdoutLines.find(l => l.startsWith('StCFSD headless')) ?? '';
  check('호스트가 준비 줄(STCFSD_HOST_READY)을 낸다', true, `${Date.now() - t} ms · ${head.replace('StCFSD headless 호스트 — ', '')}`);
  let portInfo;
  try { portInfo = JSON.parse(fs.readFileSync(portFile, 'utf8')); } catch { portInfo = undefined; }
  check('포트 파일 방식 — 파일에 이 호스트의 포트 · 토큰 · pid', portInfo?.app === 'stcfsd' && portInfo?.pid === cli.child.pid
    && portInfo?.port === ready.mcpPort && /^[0-9a-f]{32,}$/.test(portInfo?.token ?? ''),
    portInfo ? `port ${portInfo.port} · pid ${portInfo.pid} · 토큰 ${portInfo.token.length}자 · ${path.relative(tmp, portFile)}` : `${portFile} 없음`);
  const port = portInfo?.port ?? ready.mcpPort;
  const token = portInfo?.token ?? '';
  const clientLine = cli.stdoutLines.find(l => l.startsWith('MCP 클라이언트:')) ?? '';
  check('클라이언트가 쓸 환경을 출력한다(STCFSD_MCP_PORT_FILE · STANDALONE)', clientLine.includes(`STCFSD_MCP_PORT_FILE=${portFile}`)
    && clientLine.includes('STCFSD_MCP_STANDALONE=1') && clientLine.includes('mcp-server.js') && !clientLine.includes(token), clientLine);
  const entryLine = cli.stdoutLines.find(l => l.startsWith('Claude Desktop 항목')) ?? '';
  check('Claude Desktop 항목을 보이기만 한다(토큰 없음)', /"STCFSD_MCP_PORT_FILE"/.test(entryLine) && !entryLine.includes(token), short(entryLine, 160));
  check('확장의 MCP 등록 명령을 막았다', ['stcfsd.registerMcpServer', 'stcfsd.unregisterMcpServer', 'stcfsd.showMcpStatus']
    .every(id => ready.blockedCommands?.includes(id)), (ready.blockedCommands ?? []).join(', '));
  const unauth = await fetch(`http://127.0.0.1:${port}/status`, { headers: { Connection: 'close' } });
  await unauth.arrayBuffer();
  check('토큰 없는 요청은 거절된다', unauth.status === 401, `GET /status → HTTP ${unauth.status}`);
  check('Python 은 저장소의 .venv', /\.venv/.test(ready.python), ready.python);
  const openLines = cli.stdoutLines.filter(l => l.startsWith('열기 '));
  check('--open 첫째(Example/test.csd v1.0) 성공', /: 성공/.test(openLines[0] ?? ''), short(openLines[0] ?? '(줄 없음)', 160));
  if (currentCsd) { check('--open 둘째(지금 코드가 쓴 .csd) 성공', /: 성공/.test(openLines[1] ?? ''), short(openLines[1] ?? '(줄 없음)', 160)); }

  // MCP 다리 — media/mcp-server.js 와 같은 길(Origin 없음, application/json, Bearer). 이 시험은 화면처럼
  // X-StCFSD-Request-Id 를 붙이지 않는다 — 그 머리는 AI 호출 표시다.
  const noPanel = [];
  const bridge = async (method, route, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await res.json();
    if (/No active CUFSM panel|is still starting \(its design panel is not ready yet\)/i.test(JSON.stringify(j?.error ?? ''))) { noPanel.push(`${route} ${body?.action ?? ''}`); }
    return j;
  };
  const action = (name, params = {}) => bridge('POST', '/action', { action: name, ...params });
  const panelAlive = async (when) => {
    const s = await cli.ipc('status');
    check(`설계 패널이 살아 있다 — ${when}`, s.designerAlive === true, `${s.designer} · 웹뷰 ${s.webviews.length}개`);
    return s;
  };

  section('2. MCP 길: 상태 → 단면 → 좌굴 해석 → DSM');
  let status = await bridge('GET', '/status');
  check('get_status (GET /status)', !status.error && status.hasModel === true && status.nnodes > 0,
    status.error ?? `절점 ${status.nnodes} · 요소 ${status.nelems} · BC ${status.BC} · 길이 ${status.nlengths}`);
  t = Date.now();
  const tmpl = await action('generate_template', { section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0 } });
  check('set_section_template (generate_template lippedc 8×2.5×0.625×0.059)', tmpl.success === true && tmpl.nnodes > 0,
    tmpl.error ?? `절점 ${tmpl.nnodes} · ${Date.now() - t} ms`);
  // 숫자는 프로그램의 기본 강재에 기대지 않는다 — 재료(E · v)와 기준응력(fy) · 설계 Fy 를 클라이언트처럼 분명히 준다.
  // 기대값은 리터럴이 아니라 호스트가 내놓는 단면 성질에서 계산한다. 시험은 호스트가 깨질 때 실패해야 한다.
  const FY = 50;
  const mat = await action('set_material', { E: 29500, v: 0.3 });
  check('set_material(E 29500 ksi · v 0.3)', mat.success === true && mat.E === 29500, short(mat.error ?? `E ${mat.E} · v ${mat.v} · G ${Number(mat.G).toFixed(1)}`));
  const lc = await action('set_load_case', { load_case: 'bending_xx_pos', fy: FY });
  const len = await action('set_lengths', { min: 1, max: 1000, n: 30 });
  check('set_load_case · set_lengths', lc.success === true && len.success === true, short(lc.error ?? len.error ?? `${lc.load_case} fy=${lc.fy} · 길이 ${len.n}`));
  const props = await action('get_properties');
  check('get_section_properties — Sx · Sx_cl', props.Sx > 0 && props.Sx_cl > 0, short(props.error ?? `Sx ${props.Sx} · Sx_cl ${props.Sx_cl} in³`));
  t = Date.now();
  const run = await action('run_analysis');
  check('run_analysis — 실제 Python FSM', run.success === true && run.lengths_analyzed > 0,
    run.error ?? `${Date.now() - t} ms · 길이 ${run.lengths_analyzed}/${run.n_lengths}`);
  // 해석 family(굽힘 Mxx)와 같은 것을 묻는다 — 다르면 호스트가 거절한다(R2-05).
  const dsm = await action('get_dsm', { load_type: 'Mxx' });
  if (VERBOSE) { process.stderr.write(`get_dsm: ${short(dsm, 800)}\n`); }
  const mx = dsm?.Mxx ?? {};
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
  // DSM 의 My 는 해석 기준응력 × 중심선 단면계수(Sx_cl). 좌굴값은 탄성이라 양수만 본다.
  const myDsm = FY * props.Sx_cl;
  check('get_dsm_values — My = fy·Sx_cl, Mcrl · Mcrd > 0', rel(mx.My_xx, myDsm) < 1e-6 && mx.Mxxcrl > 0 && mx.Mxxcrd > 0,
    dsm.error ?? `My ${Number(mx.My_xx).toFixed(3)} (기대 ${myDsm.toFixed(3)}) · Mcrl ${Number(mx.Mxxcrl).toFixed(2)} · Mcrd ${Number(mx.Mxxcrd).toFixed(2)} kip-in`);
  const flex = await action('aisi_design', { member_type: 'flexure', design_method: 'LRFD', Fy: FY, Fu: 65, Mu: 10, Lb: 24, Cb: 1.0 });
  // 설계의 My 는 설계 Fy × 전단면 Sx, 공칭강도는 0 < Mn ≤ My.
  const myDesign = FY * props.Sx;
  check('aisi_design(휨) — My = Fy·Sx, 0 < Mn ≤ My, 판정', !flex.error && rel(Number(flex.My), myDesign) < 1e-3
    && Number(flex.Mn) > 0 && Number(flex.Mn) <= Number(flex.My) * (1 + 1e-9) && typeof flex.pass === 'boolean',
    flex.error ?? `My ${flex.My} (기대 ${myDesign.toFixed(2)}) · Mn ${flex.Mn} kip-in · 이용률 ${flex.utilization} · pass=${flex.pass}`);

  section('3. .csd: 열기(두 번째 --open 길) → 좌굴 → 하중 해석 → 퍼린 설계 → 부재 설계 → 저장 → 다시 열기');
  t = Date.now();
  const reopenExample = await cli.ipc('open', { file: exampleCsd });
  check('Example/test.csd(사본)를 다시 연다 — 열기 대화상자 길', reopenExample.ok, `${Date.now() - t} ms · ${short(reopenExample.message, 120)}`);
  status = await bridge('GET', '/status');
  check('열린 파일의 모델이 MCP 에 보인다', status.nnodes === 21 && status.nelems === 20, `절점 ${status.nnodes} · 요소 ${status.nelems}`);
  // 이 파일(v1.0)은 하중 경우 표지가 없어 응력이 custom 이다 — 부재 설계가 DSM 값을 쓰도록 압축으로 둔다.
  const lc2 = await action('set_load_case', { load_case: 'compression', fy: 35.53 });
  check('열린 단면에 하중 경우(압축)', lc2.success === true, short(lc2.error ?? `${lc2.load_case} fy=${lc2.fy}`));
  t = Date.now();
  const run2 = await action('run_analysis');
  check('열린 단면의 좌굴 해석', run2.success === true, run2.error ?? `${Date.now() - t} ms · 길이 ${run2.lengths_analyzed}`);
  const loads = { member_app: 'roof-purlin', span_type: 'simple', span_ft: 20, loads: { D: 10, Lr: 20 },
    design_method: 'LRFD', spacing_ft: 5, Fy: 35.53, Fu: 58.02 };
  t = Date.now();
  const la = await action('analyze_loads', loads);
  check('analyze_loads — 지배 조합과 Mu', !la.error && !!la.governing?.combo, la.error ?? `${Date.now() - t} ms · ${la.governing.combo} · ${la.analysis_method}`);
  t = Date.now();
  const purlin = await action('design_purlin', loads);
  const regions = Array.isArray(purlin.regions) ? purlin.regions : [];
  check('design_purlin — 구간별 판정', !purlin.error && regions.length > 0 && 'pass' in purlin,
    purlin.error ?? `${Date.now() - t} ms · 구간 ${regions.length} · pass=${purlin.pass} · 이용률 ${purlin.utilization}`);
  t = Date.now();
  const member = await action('aisi_design', { member_type: 'compression', design_method: 'LRFD', Fy: 35.53, Fu: 58.02,
    Pu: 2, KxLx: 120, KyLy: 60, KtLt: 60 });
  // 이 단면(Example/test.csd)은 템플릿 기록이 없는 비대칭 단면이라 엔진이 전체좌굴을 평가하지 않는다(Pne = 0,
  // "unsupported-nonsymmetric") — 정직한 결과다. 여기서는 설계가 돌고 FSM 의 국부 · 뒤틀림 값을 쓰는지 본다.
  check('aisi_design(압축) — 부재 설계가 FSM 값으로 돈다', !member.error && Array.isArray(member.steps) && member.steps.length > 0
    && Number(member.Py) > 0 && Number(member.Pnd) > 0 && member.dsm_source?.Pcrl === 'FSM',
    member.error ?? `${Date.now() - t} ms · Py ${member.Py} · Pnd ${member.Pnd} · Pn ${member.Pn} · 지배 ${member.controlling_mode} · pass=${member.pass}`);
  await panelAlive('해석 · 설계 뒤');

  const saved1 = path.join(tmp, 'saved', 'smoke-1.csd');
  fs.mkdirSync(path.dirname(saved1), { recursive: true });
  t = Date.now();
  const save1 = await cli.ipc('save', { file: saved1 });
  const j1 = fs.existsSync(saved1) ? JSON.parse(fs.readFileSync(saved1, 'utf8')) : undefined;
  check('저장 — 저장 대화상자를 headless 가 답한다', save1.ok && !!j1, `${Date.now() - t} ms · ${short(save1.message, 100)}`);
  check('저장본(v1.4)에 모델 · 검토 상태(case) · 하중 해석 · 설계 결과가 있다', j1?.version === '1.4' && j1?.model?.node?.length === 21
    && j1?.case?.schema === 'stcfsd-case/1' && !!j1?.loadAnalysis && !!j1?.designResult,
    j1 ? `v${j1.version} · 절점 ${j1.model?.node?.length} · case ${j1.case?.schema} rev ${j1.case?.rev} · loadAnalysis ${!!j1.loadAnalysis} · designResult ${!!j1.designResult}` : '파일 없음');
  // K2: 입력은 호스트의 검토 상태 — 화면 없이 저장해도 MCP 가 정한 입력(출처 ai)이 그대로 들어간다. 예전의 「새로 모으지 못했다」 주의는 없다.
  const aiKeys = Object.entries(j1?.case?.sources ?? {}).filter(([, v]) => v === 'ai').map(([k]) => k);
  check('화면 없는 저장에도 MCP 가 정한 입력(출처 ai)이 저장본의 case 에 있다 — 저장 주의는 없다', aiKeys.length >= 3 && !/저장 주의/.test(cli.stderr()) && !('inputsNotice' in save1),
    `ai 출처 ${aiKeys.length}키(${aiKeys.slice(0, 6).join(', ')}) · 저장 주의 ${/저장 주의/.test(cli.stderr())}`);
  const nodesBefore = await action('get_nodes');
  const reopen1 = await cli.ipc('open', { file: saved1 });
  const nodesAfter = await action('get_nodes');
  // V7-07(1d9d305): 열 때 파일의 출처 꼬리표를 그대로 믿지 않는다 — 처음 값과 다른 값이 default · ai · mirror 로 적혀 있으면 'file' 로,
  // 파일에 적혀 있던 꼬리표는 get_case_inputs.sources_recorded_in_file 에
  const ciAfter = await action('get_case_inputs');
  const recorded = ciAfter?.sources_recorded_in_file ?? {};
  const saved2 = path.join(tmp, 'saved', 'smoke-2.csd');
  const save2 = await cli.ipc('save', { file: saved2 });
  const j2 = fs.existsSync(saved2) ? JSON.parse(fs.readFileSync(saved2, 'utf8')) : undefined;
  const dirtyAfterOpen = await action('get_unsaved_changes');
  check('열자마자는 저장 안 한 변경이 없다(get_unsaved_changes) — 열기가 다시 보낸 결과는 바뀐 것이 아니다', dirtyAfterOpen?.dirty === false, short(dirtyAfterOpen, 160));
  check('저장본을 다시 열고 다시 저장한다', reopen1.ok && save2.ok && !!j2, short(`${reopen1.message} / ${save2.message}`, 160));
  const s1 = j1?.case?.sources ?? {}, s2 = j2?.case?.sources ?? {};
  const srcKeys = [...new Set([...Object.keys(s1), ...Object.keys(s2)])];
  // 출처: 같거나, 열 때 'file' 로 바뀐 것은 그 키의 파일 꼬리표(sources_recorded_in_file)가 저장본의 것과 같다. 바뀐 것은 default · ai · mirror 뿐
  const srcBad = srcKeys.filter(k => !(s1[k] === s2[k] || (s2[k] === 'file' && recorded[k] === s1[k] && ['default', 'ai', 'mirror'].includes(s1[k]))));
  const recBad = Object.keys(recorded).filter(k => s2[k] !== 'file' || recorded[k] !== s1[k]);
  const reTagged = srcKeys.filter(k => s1[k] !== s2[k]);
  check('다시 연 입력이 같다 — 모델 · 설계 입력 · Lap 결과 · 출처(V7-07: 파일의 꼬리표 default · ai · mirror 는 열 때 file, 적힌 것은 sources_recorded_in_file)', isDeepStrictEqual(j1?.model, j2?.model)
    && isDeepStrictEqual(j1?.designInputs, j2?.designInputs) && isDeepStrictEqual(j1?.case?.inputs, j2?.case?.inputs) && srcBad.length === 0 && recBad.length === 0
    && isDeepStrictEqual(j1?.lapResult, j2?.lapResult)
    && isDeepStrictEqual(nodesBefore, nodesAfter),
    `모델 키 ${Object.keys(j1?.model ?? {}).length}개 · get_nodes 같음=${isDeepStrictEqual(nodesBefore, nodesAfter)} · 입력 같음 ${isDeepStrictEqual(j1?.case?.inputs, j2?.case?.inputs)}`
      + ` · 열 때 file 로 바뀐 출처 ${reTagged.length}(${reTagged.slice(0, 5).map(k => `${k}:${s1[k]}→${s2[k]}`).join(', ')}) · 어긋남 ${JSON.stringify(srcBad.slice(0, 5))} ${JSON.stringify(recBad.slice(0, 5))}`);
  check('다시 연 결과(하중 해석 · 설계)가 같다', isDeepStrictEqual(j1?.loadAnalysis, j2?.loadAnalysis) && isDeepStrictEqual(j1?.designResult, j2?.designResult));

  if (currentCsd) {
    const src = JSON.parse(fs.readFileSync(currentCsd, 'utf8'));
    const reopenCurrent = await cli.ipc('open', { file: currentCsd });
    const saved3 = path.join(tmp, 'saved', 'smoke-current.csd');
    const save3 = await cli.ipc('save', { file: saved3 });
    const j3 = fs.existsSync(saved3) ? JSON.parse(fs.readFileSync(saved3, 'utf8')) : undefined;
    // K2: 1.3 은 열 때 검토 상태로 읽고 1.4 로 쓴다(거울 하나 — D-3). 그다음부터는 열고 저장해도 그대로여야 한다.
    const reopen3 = await cli.ipc('open', { file: saved3 });
    const saved4 = path.join(tmp, 'saved', 'smoke-current-2.csd');
    const save4 = await cli.ipc('save', { file: saved4 });
    const j4 = fs.existsSync(saved4) ? JSON.parse(fs.readFileSync(saved4, 'utf8')) : undefined;
    const n = Object.keys(j3?.case?.inputs ?? {}).length;
    check(`지금 코드가 쓴 .csd(v${src.version}) → v1.4 로 저장 → 다시 열고 저장해도 검토 상태 ${n}키 · 설계 입력 · 모델이 그대로다`, reopenCurrent.ok && save3.ok && reopen3.ok && save4.ok
      && n > 80 && j3?.version === '1.4' && isDeepStrictEqual(j3?.case?.inputs, j4?.case?.inputs) && isDeepStrictEqual(j3?.designInputs, j4?.designInputs)
      && isDeepStrictEqual(src.model?.node, j4?.model?.node),
      short(`${reopenCurrent.message} / ${save3.message} / ${save4.message}`, 160));
  }

  section('4. 설계 패널은 끝까지 살아 있다');
  const st = await panelAlive('열기 · 저장을 여러 번 한 뒤');
  check('어느 MCP 응답에도 「패널 없음」(No active CUFSM panel · 독립 모드의 HOST_STARTING 「still starting」)이 없다', noPanel.length === 0, noPanel.join(', ') || '0건');
  const designerViews = st.webviews.filter(w => w.viewType === 'stcfsd.designer');
  check('설계 패널은 하나이고 고정돼 있다', designerViews.length === 1 && designerViews[0].pinned, JSON.stringify(designerViews));

  section('5. 호스트 → 웹뷰 메시지 (화면 없음)');
  const counts = st.messageCounts;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) { process.stdout.write(`    ${String(v).padStart(4)}  ${k}\n`); }
  // K2: 열기는 검토 상태(caseState)를 보내고(옛 화면을 위한 restoreDesignInputs 도 함께 — 다리는 그것을 다시 보내지 않는다),
  // 저장은 화면에 묻지 않는다(collectDesignData 없음)
  const expected = ['modelLoaded', 'analysisComplete', 'dsmResult', 'caseState', 'loadAnalysisComplete',
    'designPurlinResult', 'designResult', 'caseDirty'];
  const gone = ['collectDesignData'].filter(k => counts[k] > 0);
  const missing = expected.filter(k => !(counts[k] > 0));
  check('메시지가 만들어진다(명령별로 센다) — K2 의 caseState · caseDirty, 옛 collectDesignData 는 없다', total > 0 && missing.length === 0 && gone.length === 0,
    `${total}건 · ${Object.keys(counts).length}종${missing.length ? ` · 없음: ${missing.join(', ')}` : ''}${gone.length ? ` · 남음: ${gone.join(', ')}` : ''}`);

  section('6. 진짜 MCP 클라이언트(media/mcp-server.js, stdio)');
  if (!fs.existsSync(MCP_SERVER)) {
    check('media/mcp-server.js 가 있다', false, '루트에서 npm run build:mcp');
  } else {
    const before = await bridge('GET', '/last-call');
    check('화면 · 시험의 조회는 AI 호출로 세지 않는다(GET /last-call)', before.aiCalls === 0 && before.lastAiCall === null,
      `aiCalls ${before.aiCalls} · ${short(before.lastAiCall)}`);
    const client = startMcpClient(ready.env);
    try {
      const init = await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stcfsd-s1-smoke', version: '0' } });
      client.notify('notifications/initialized', {});
      const tools = await client.request('tools/list', {});
      const r = await client.request('tools/call', { name: 'get_status', arguments: {} });
      const text = r.result?.content?.find(c => c.type === 'text')?.text ?? '';
      check('initialize · tools/list · get_status 가 이 호스트에 닿는다', !!init.result && (tools.result?.tools?.length ?? 0) > 0
        && !r.result?.isError && /"nnodes"/.test(text),
        `${init.result?.serverInfo?.name ?? '?'} · 도구 ${tools.result?.tools?.length ?? 0}개 · ${short(text.replace(/\s+/g, ' '), 80)}`);
      const after = await bridge('GET', '/last-call');
      check('AI 호출이 /last-call 에 남는다', after.aiCalls >= 1 && /status/.test(after.lastAiCall?.endpoint ?? ''),
        `aiCalls ${after.aiCalls} · ${short(after.lastAiCall)}`);
    } catch (err) {
      check('MCP stdio 클라이언트', false, String(err?.message ?? err));
    } finally {
      await client.close();
    }
  }

  section('7. 미구현 API · headless 가 받은 물음');
  const unimpl = st.unimplemented;
  process.stdout.write(`  미구현 API 에 닿은 것: ${unimpl.length}종\n`);
  for (const u of unimpl) { process.stdout.write(`    - ${u.name} ×${u.count}\n`); }
  check('미구현 vscode API 에 닿은 곳이 없다', unimpl.length === 0, unimpl.map(u => u.name).join(', ') || '0종');
  process.stdout.write(`  물음(알림 단추 · 고르기 · 입력 · 대화상자): ${st.questions.length}건\n`);
  for (const q of st.questions) { process.stdout.write(`    - [${q.kind}] ${short(q.summary, 110)} → ${q.answer === undefined ? '(답 없음)' : short(q.answer, 90)}\n`); }
  const errors = st.notifications.filter(n => n.severity === 'error');
  check('호스트가 오류 알림을 내지 않았다', errors.length === 0, errors.map(e => short(e.message, 100)).join(' / ') || `알림 ${st.notifications.length}건, 오류 0`);
  check('활성화 중에 MCP 설정 파일을 쓰지 않았다(호스트의 감시)', st.mcpConfigWrites.length === 0, st.mcpConfigWrites.join(', ') || '0건');

  section('8. 끝내기 — Python 프로세스 · 포트가 남지 않는다');
  const kids = descendants(cli.child.pid);
  const pythons = kids.filter(k => /python/i.test(k.name));
  check('끝내기 전: 호스트 아래에 Python 이 떠 있다', pythons.length > 0, kids.map(k => `${k.name}#${k.pid}`).join(', ') || '없음');
  t = Date.now();
  await cli.ipc('shutdown', {}, 10_000).catch(() => undefined);
  const exit = await Promise.race([cli.exited, sleep(30_000).then(() => undefined)]);
  check('IPC shutdown 뒤 스스로 끝난다(코드 0)', exit?.code === 0, exit ? `${Date.now() - t} ms · 코드 ${exit.code} · 신호 ${exit.signal}` : '30 초 안에 끝나지 않음');
  if (!exit) { cli.child.kill(); }
  check('"정리 끝" 을 출력했다', cli.stdoutLines.includes('정리 끝'), cli.stdoutLines.slice(-2).join(' | '));
  for (let i = 0; i < 100 && kids.some(k => alive(k.pid)); i++) { await sleep(50); }
  const left = kids.filter(k => alive(k.pid));
  check('남은 자식 프로세스(Python 포함)가 없다', left.length === 0, left.map(k => `${k.name}#${k.pid}`).join(', ') || `${kids.length}개 모두 끝남`);
  check('MCP 다리 포트가 풀렸다', await portIsFree(port), `127.0.0.1:${port}`);
  check('포트 파일이 지워졌다', !fs.existsSync(portFile), portFile);

  section('9. 저장소 · 사용자 MCP 설정 파일');
  const repoAfter = repoSnapshot();
  const changed = diffSnapshots(repoBefore, repoAfter);
  check('desktop/ 밖에서 저장소가 바뀌지 않았다(git status + 크기 · 수정 시각)', changed.length === 0,
    changed.length ? `${changed.length}건: ${changed.slice(0, 8).join('; ')}` : `${repoAfter.size}개 항목 그대로`);
  const configChanged = MCP_CONFIG_FILES.filter(f => statOf(f) !== configBefore.get(f));
  check('사용자 MCP 설정 파일의 수정 시각이 그대로다', configChanged.length === 0,
    configChanged.length ? configChanged.join(', ') : MCP_CONFIG_FILES.map(f => `${path.relative(repoRoot, f).startsWith('..') ? f.replace(HOME, '~') : path.relative(repoRoot, f)}(${configBefore.get(f) === '없음' ? '없음' : '있음'})`).join(', '));
  const strayJs = fs.readdirSync(path.join(here, '..', 'src')).filter(f => f.endsWith('.js'));
  check('host/src 에 tsc 출력이 섞이지 않았다', strayJs.length === 0, strayJs.join(', ') || '0개');
  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = results.filter(r => !r.ok);
  process.stdout.write(`\n결과: ${results.length - failed.length}/${results.length} 통과 · ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  if (failed.length) {
    process.stdout.write(`실패: ${failed.map(f => f.name).join(' / ')}\n`);
    process.stdout.write(`호스트 stderr 끝:\n${cli.stderr().split('\n').filter(l => !l.startsWith('[StCFSD Python stderr]')).slice(-25).join('\n')}\n`);
    if (!VERBOSE) { process.stdout.write('자세한 기록: SMOKE_VERBOSE=1 node desktop/host/test/smoke.mjs\n'); }
    process.exitCode = 1;
  }
}

main().catch(err => {
  process.stdout.write(`\n실패  예외: ${err?.stack ?? err}\n`);
  process.exit(1);
});
