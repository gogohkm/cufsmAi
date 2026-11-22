// S4 시험 — 화면 다리의 Claude Desktop 연결(`/api/claude/status` · `connect` · `disconnect`).
// `serve` CLI 를 자식 프로세스로 띄우고 `--claude-config <임시 폴더의 가짜 설정>` 을 준다 — 진짜 Claude 설정에는
// 닿지 않는다(시작 · 끝에 진짜 자리들의 크기 · 수정 시각을 **열지 않고** 비교한다, test/webview/real_config_guard.js 와 같은 생각).
//
//   cd desktop && npm test          (smoke · bridge 뒤)
//   node desktop/host/test/connect.mjs
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const SERVE = path.join(here, '..', 'dist', 'serve.js');
const results = [];
const started = Date.now();
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  process.stdout.write(`${ok ? '  통과' : '  실패'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
}
const section = t => process.stdout.write(`\n▶ ${t}\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 이 PC 의 진짜 설정 자리 — 열지 않고 크기 · 수정 시각만 */
function realConfigPaths() {
  const home = process.env.USERPROFILE || os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const list = [
    path.join(appData, 'Claude', 'claude_desktop_config.json'), path.join(home, '.claude', 'mcp.json'), path.join(home, '.claude.json'),
    path.join(repoRoot, '.mcp.json'), path.join(repoRoot, '.claude', 'mcp.json'), path.join(repoRoot, 'Example', '.mcp.json'),
    path.join(repoRoot, 'Example', '.claude', 'mcp.json'), path.join(appData, 'StCFSD'),
  ];
  try {
    for (const d of fs.readdirSync(path.join(local, 'Packages'))) {
      if (/claude/i.test(d)) { list.push(path.join(local, 'Packages', d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json')); }
    }
  } catch { /* MSIX 없음 */ }
  return list;
}
const statOf = f => { try { const s = fs.statSync(f); return `${s.size}:${s.mtimeMs}`; } catch { return '없음'; } };
/** Claude 폴더의 백업 · 임시 파일(우리 흔적) */
const traces = dir => { try { return fs.readdirSync(dir).filter(n => /stcfsd-(backup|tmp)/.test(n)); } catch { return []; } };

async function main() {
  const real = realConfigPaths();
  const realBefore = new Map(real.map(f => [f, statOf(f)]));
  const realDirs = [...new Set(real.map(f => path.dirname(f)))];
  const realTracesBefore = new Map(realDirs.map(d => [d, traces(d).length]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-s4-connect-'));
  const claudeDir = path.join(tmp, 'AppData', 'Roaming', 'Claude');
  const config = path.join(claudeDir, 'claude_desktop_config.json');
  const portFile = path.join(tmp, 'mcp', 'stcfsd-mcp-port');

  const child = spawn(process.execPath, [SERVE, '--repo', repoRoot, '--user-data', path.join(tmp, 'ud'), '--port-file', portFile,
    '--documents', path.join(tmp, 'docs'), '--claude-config', config], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let out = '';
  let err = '';
  child.stdout.on('data', c => { out += c; });
  child.stderr.on('data', c => { err = (err + c).slice(-20_000); });
  const exited = new Promise(r => child.once('exit', code => r(code)));
  let ready;
  for (let i = 0; i < 600 && !ready; i++) {
    const m = /STCFSD_BRIDGE_READY (\{.*\})/.exec(out);
    if (m) { ready = JSON.parse(m[1]); }
    if (child.exitCode !== null) { break; }
    await sleep(100);
  }
  if (!ready) { check('serve 준비', false, err.slice(-800)); return finish(); }
  const token = new URL(ready.url).searchParams.get('t');
  const api = async (method, route, body) => {
    const r = await fetch(`${ready.origin}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: r.status, json, text };
  };
  const status = async () => (await api('GET', '/api/claude/status')).json?.data;
  const connect = async () => (await api('POST', '/api/claude/connect', {})).json?.data;
  const disconnect = async () => (await api('POST', '/api/claude/disconnect', {})).json?.data;
  const readCfg = () => JSON.parse(fs.readFileSync(config, 'utf8').replace(/^\uFEFF/, ''));
  // 이 호스트가 넣는 항목(개발판: node 로 띄움). 다리의 상태로 거꾸로 확인한다.
  const st0 = await status();

  section('1. Claude Desktop 없음(설정 폴더가 없다)');
  check('상태: Claude Desktop 없음 · 「연결」 불가', st0?.ui === 'not-installed' && st0.canConnect === false && st0.configPath === config, `${st0?.text}`);
  let r = await connect();
  check('「연결」 거절 — 폴더를 만들지 않는다', r?.result.ok === false && r.result.reason === 'claude-not-installed' && !fs.existsSync(claudeDir), r?.result.message);

  section('2. 설치됨 · 설정 파일 없음 → 새로 만들기');
  fs.mkdirSync(claudeDir, { recursive: true });
  let st = await status();
  check('상태: 등록 안 됨 · 「연결」 가능', st.ui === 'not-registered' && st.canConnect && !st.canDisconnect, st.text);
  r = await connect();
  const created = fs.existsSync(config) ? readCfg() : undefined;
  const entry = created?.mcpServers?.stcfsd;
  check('「연결」 → 파일을 새로 만들고 mcpServers.stcfsd 를 넣는다', r.result.ok && r.result.action === 'created' && !!entry
    && entry.args?.[0]?.endsWith(path.join('media', 'mcp-server.js')) && entry.env?.STCFSD_MCP_PORT_FILE === portFile && entry.env?.STCFSD_MCP_STANDALONE === '1',
  `${r.result.message} · ${JSON.stringify(entry)}`);
  check('「연결」 뒤: 다시 시작 필요를 알린다 · 「끊기」 가능', r.status.ui === 'restart-needed' && /다시 시작/.test(r.result.message) && r.status.canDisconnect, r.status.text);
  r = await connect();
  check('다시 「연결」 → 이미 같음(쓰지 않음)', r.result.ok && r.result.action === 'unchanged' && r.result.wrote === false, r.result.message);

  section('3. 다른 서버가 있는 파일 → 그것들을 지키며 더하기');
  const others = '\uFEFF{\r\n    "globalShortcut": "Ctrl+Space",\r\n    "mcpServers": {\r\n        "other-a": { "command": "x.exe", "args": ["--a"], "env": { "K": "1" } },\r\n        "other-b": { "command": "y" }\r\n    },\r\n    "preferences": { "z": 1 }\r\n}\r\n';
  fs.writeFileSync(config, others);
  for (const n of traces(claudeDir)) { fs.rmSync(path.join(claudeDir, n)); }
  st = await status();
  check('상태: 등록 안 됨(다른 서버 2개)', st.ui === 'not-registered' && st.otherServers === 2, st.text);
  r = await connect();
  const after = readCfg();
  const backups = traces(claudeDir).filter(n => /backup/.test(n));
  const bytesKept = backups.length === 1 && fs.readFileSync(path.join(claudeDir, backups[0]), 'utf8') === others;
  check('「연결」 → 더함 · 다른 서버 · 최상위 키 그대로 · 백업 = 원본 바이트', r.result.ok && r.result.action === 'added'
    && isDeepStrictEqual(after.mcpServers['other-a'], { command: 'x.exe', args: ['--a'], env: { K: '1' } }) && isDeepStrictEqual(after.mcpServers['other-b'], { command: 'y' })
    && after.globalShortcut === 'Ctrl+Space' && isDeepStrictEqual(after.preferences, { z: 1 }) && isDeepStrictEqual(after.mcpServers.stcfsd, entry) && bytesKept,
  `${r.result.message} · 백업 ${backups.join(', ')}`);
  const raw = fs.readFileSync(config, 'utf8');
  check('원문의 BOM · CRLF · 4칸 들여쓰기를 따른다', raw.startsWith('\uFEFF') && raw.includes('\r\n    "mcpServers"'));

  section('4. 다른 설치를 가리키는 항목 → 고치기');
  const stale = { mcpServers: { stcfsd: { command: 'C:\\Old\\StCFSD.exe', args: ['C:\\Old\\media\\mcp-server.js'], env: { STCFSD_MCP_PORT_FILE: 'C:\\old', STCFSD_MCP_STANDALONE: '1' } }, keep: { command: 'k' } } };
  fs.writeFileSync(config, JSON.stringify(stale, null, 2));
  st = await status();
  check('상태: 다른 설치를 가리킴 · 「연결」 가능 · 「끊기」 불가', st.ui === 'registered-elsewhere' && st.canConnect && !st.canDisconnect, st.text);
  r = await disconnect();
  check('「끊기」를 억지로 불러도 남의 항목은 그대로(kept, 쓰지 않음)', r.result.ok && r.result.action === 'kept' && r.result.wrote === false
    && isDeepStrictEqual(readCfg(), stale), r.result.message);
  r = await connect();
  check('「연결」 → 이 프로그램으로 고침 · 다른 서버 그대로', r.result.ok && r.result.action === 'updated' && isDeepStrictEqual(readCfg().mcpServers.stcfsd, entry)
    && isDeepStrictEqual(readCfg().mcpServers.keep, { command: 'k' }), r.result.message);

  section('5. 「끊기」 — 우리 항목만 지운다');
  st = await status();
  check('상태: 등록됨 · 「끊기」 가능', (st.ui === 'restart-needed' || st.ui === 'registered') && st.canDisconnect, st.text);
  r = await disconnect();
  const afterDisc = readCfg();
  check('「끊기」 → stcfsd 만 지우고 다른 서버는 그대로', r.result.ok && r.result.action === 'removed' && !('stcfsd' in afterDisc.mcpServers)
    && isDeepStrictEqual(afterDisc.mcpServers.keep, { command: 'k' }), r.result.message);
  st = await status();
  check('끊은 뒤 상태: 등록 안 됨', st.ui === 'not-registered', st.text);

  section('6. 깨진 JSON — 손대지 않는다');
  const broken = '{ "mcpServers": { "a": ';
  fs.writeFileSync(config, broken);
  for (const n of traces(claudeDir)) { fs.rmSync(path.join(claudeDir, n)); }
  const brokenStat = statOf(config);
  st = await status();
  check('상태: 설정 파일을 읽을 수 없음 · 「연결」 불가', st.ui === 'invalid-config' && !st.canConnect, st.text);
  r = await connect();
  check('「연결」 거절 · 파일 그대로 · 백업 없음', r.result.ok === false && r.result.reason === 'invalid-config' && statOf(config) === brokenStat
    && fs.readFileSync(config, 'utf8') === broken && traces(claudeDir).length === 0, r.result.message);

  section('7. 쓰는 길은 화면의 세션뿐');
  fs.writeFileSync(config, '{}');
  const noTok = await fetch(`${ready.origin}/api/claude/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const viaGet = await api('GET', '/api/claude/connect');
  const viaForm = await fetch(`${ready.origin}/api/claude/connect`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  const viaOrigin = await fetch(`${ready.origin}/api/claude/connect`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: '{}' });
  const viaRelay = await api('POST', '/api/mcp/claude/connect', {});
  const mcpPort = JSON.parse(fs.readFileSync(portFile, 'utf8'));
  const direct = await fetch(`http://127.0.0.1:${mcpPort.port}/api/claude/connect`, { method: 'POST', headers: { Authorization: `Bearer ${mcpPort.token}`, 'Content-Type': 'application/json' }, body: '{}' });
  const directText = await direct.text();
  check('토큰 없음 401 · GET 405 · 폼 전송 415 · 다른 Origin 403', noTok.status === 401 && viaGet.status === 405 && viaForm.status === 415 && viaOrigin.status === 403,
    `${noTok.status} · ${viaGet.status} · ${viaForm.status} · ${viaOrigin.status}`);
  check('MCP 쪽(AI)에서는 닿지 않는다 — 중계 · MCP 다리 모두 그런 경로가 없다', !/"ok":true/.test(viaRelay.text) && /Unknown endpoint/.test(viaRelay.text + directText)
    && fs.readFileSync(config, 'utf8') === '{}', `중계 ${viaRelay.status} ${viaRelay.text.slice(0, 60)} · 직접 ${direct.status}`);

  section('8. 끝 · 진짜 설정 자리');
  child.send({ id: 1, type: 'shutdown' });
  const code = await Promise.race([exited, sleep(30_000).then(() => 'timeout')]);
  check('serve 가 깨끗이 끝난다', code === 0, String(code));
  const changed = real.filter(f => statOf(f) !== realBefore.get(f));
  check('진짜 Claude Desktop · MCP 설정 · %APPDATA%\\StCFSD 의 크기 · 수정 시각 그대로(열지 않고 봄)', changed.length === 0, changed.join(', ') || `${real.length}곳`);
  const newTraces = realDirs.filter(d => traces(d).length !== realTracesBefore.get(d));
  check('진짜 자리에 우리 백업 · 임시 파일이 생기지 않았다', newTraces.length === 0, newTraces.join(', ') || '0');
  fs.rmSync(tmp, { recursive: true, force: true });
  return finish();
}

function finish() {
  const failed = results.filter(r => !r.ok);
  process.stdout.write(`\n결과: ${results.length - failed.length}/${results.length} 통과 · ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  if (failed.length) { process.stdout.write(`실패: ${failed.map(f => f.name).join(' / ')}\n`); process.exitCode = 1; }
}

main().catch(e => { process.stdout.write(`실패  예외: ${e?.stack ?? e}\n`); process.exit(1); });
