// K1 (2026-11-22): MCP 포트 파일 + 토큰 + 재시작 뒤 막기의 종단 시험 — 진짜 프로세스, 임시 폴더, 빈 포트.
//
// 무엇을 덮나
//   - 호스트: src/mcp/bridge.ts 의 McpBridgeServer 를 transpile 해 **별도 Node 프로세스**로 띄운다(패널은 대역 —
//     받은 요청을 stdout 에 한 줄씩 적는다). 포트 파일은 `bridgeOptionsFromEnv(STCFSD_MCP_PORT_FILE)` 로.
//   - MCP 서버: 커밋된 번들 media/mcp-server.js 를 MCP SDK 클라이언트로 stdio 로 부른다(cwd = 드라이브 뿌리).
//   - 독립 프로그램(STCFSD_MCP_STANDALONE=1): 꺼져 있음 → 쉬운 말 오류, 토큰 없음 · 틀림 → 401, 강제 종료로 남은 파일
//     (pid 죽음) → 꺼져 있음, 파일은 있는데 연결 거부 → 쉬운 말 오류(ECONNREFUSED 아님), 다른 포트로 다시 켜짐 →
//     get_status 만 통과(알림) · 다른 호출은 보내기 전에 거절(동시 두 건, 상태 조회가 날아가는 중의 쓰기 포함) → 확인 뒤 통과,
//     정상 종료 · 프로세스 종료 때 파일 지움, 마지막 AI 호출 기록(클라이언트 이름), STCFSD_MCP_PORT 로 짐작하지 않음.
//   - legacy(변수 없음): 고정 포트 · 토큰 없음 · 문구가 전과 같다.
//   - 등록 항목 그대로(standaloneMcpEntry) 확장 폴더 밖으로 옮긴 번들을 띄운다 — 번들이 node_modules · 확장 배치에
//     기대지 않는다. 번들의 require 는 Node 내장뿐이다.
//   - 진짜 설정 파일은 열지 않는다(real_config_guard.js — 크기 · 수정 시각).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const cp = require('child_process');
const process = require('process');
const { setTimeout: delay } = require('timers/promises');

const ROOT = path.resolve(__dirname, '..', '..');
const { Client } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'index.js'));
const { StdioClientTransport } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'stdio.js'));
const { snapshotRealConfigs } = require('./real_config_guard.js');

const BUNDLE = path.join(ROOT, 'media', 'mcp-server.js');
const DRIVE_ROOT = path.parse(os.tmpdir()).root;

function transpile(outDir) {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of ['bridge', 'portFile', 'hostConnection', 'claudeDesktop']) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp', `${f}.ts`), 'utf8');
    const js = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    fs.writeFileSync(path.join(outDir, `${f}.js`), js);
  }
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// 호스트 대역 프로세스: 진짜 McpBridgeServer + 받은 것을 적는 패널.
const HOST_SCRIPT = `
const { McpBridgeServer, bridgeOptionsFromEnv } = require(process.argv[2]);
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const statusDelay = Number(process.env.K1_STATUS_DELAY_MS || 0);
const panel = {
  getStatus() {
    say({ ev: 'status' });
    if (statusDelay) { const until = Date.now() + statusDelay; while (Date.now() < until) { /* 상태 조회가 오래 걸리는 호스트 */ } }
    return { panel: 'stand-in', host_pid: process.pid };
  },
  async handleMcpAction(body) { say({ ev: 'action', body }); return { ok: true, action: body.action, host_pid: process.pid }; },
};
// V5-S2: 패널이 듣기 시작한 뒤 늦게 생기는 호스트(독립 프로그램의 시작 순서 — 다리 → Python → 패널)
const panelAt = Date.now() + Number(process.env.K1_PANEL_DELAY_MS || 0);
const bridge = new McpBridgeServer(() => (Date.now() >= panelAt ? panel : undefined), 0, bridgeOptionsFromEnv(process.env));
bridge.start().then(() => say({ ev: 'ready', port: bridge.port, pid: process.pid }), (e) => { say({ ev: 'failed', error: String(e) }); process.exit(3); });
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  if (d.includes('stop')) { bridge.stop(); say({ ev: 'stopped' }); setTimeout(() => process.exit(0), 20); }
  if (d.includes('exit')) { process.exit(0); }
});
`;

function startHost(tmp, portFile, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv, STCFSD_MCP_PORT_FILE: portFile };
  delete env.STCFSD_MCP_STANDALONE;
  const child = cp.spawn(process.execPath, [path.join(tmp, 'host.js'), path.join(tmp, 'bridge.js')],
    { env, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const events = [];
  let buf = '';
  let onReady;
  const ready = new Promise((resolve, reject) => {
    onReady = resolve;
    child.once('exit', (code) => reject(new Error(`host exited early (${code})`)));
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.startsWith('{')) { continue; }   // 브리지의 console.log 줄
      const ev = JSON.parse(line);
      events.push(ev);
      if (ev.ev === 'ready') { onReady(ev); }
    }
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  return {
    child, events, exited,
    ready: ready.then((ev) => { ready.catch(() => {}); return ev; }),
    actions: () => events.filter((e) => e.ev === 'action').map((e) => e.body.action),
    statuses: () => events.filter((e) => e.ev === 'status').length,
    send: (cmd) => child.stdin.write(cmd + '\n'),
  };
}

function cleanEnv(extra) {
  // 바깥 셸의 STCFSD_* 가 새지 않게 — SDK 가 안전한 기본 환경(PATH 등)을 더한다.
  return { ...extra };
}

async function mcpClient(env, cwd = DRIVE_ROOT, script = BUNDLE, command = process.execPath, name = 'k1-test-client') {
  const transport = new StdioClientTransport({ command, args: [script], env: cleanEnv(env), cwd, stderr: 'pipe' });
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content[0].text;
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { isError: !!r.isError, data, text };
  };
  return { client, call, close: () => client.close().catch(() => {}) };
}

function raw(port, opts, body) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, ...opts }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* 글 */ } resolve({ status: res.statusCode, headers: res.headers, json: j }); });
    });
    req.on('error', (e) => resolve({ status: -1, error: String(e) }));
    if (body) { req.write(body); }
    req.end();
  });
}

async function waitFor(pred, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (pred()) { return; } await delay(20); }
  throw new Error(`timed out waiting for ${what}`);
}

async function main() {
  const guard = snapshotRealConfigs();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-k1-'));
  const hosts = [];
  const clients = [];
  let decoy = null;
  let legacy = null;
  const checks = [];
  const ok = (name) => checks.push(name);
  try {
    transpile(tmp);
    fs.writeFileSync(path.join(tmp, 'host.js'), HOST_SCRIPT);
    const bridgeMod = require(path.join(tmp, 'bridge.js'));
    const conn = require(path.join(tmp, 'hostConnection.js'));
    const pf = require(path.join(tmp, 'portFile.js'));
    const reg = require(path.join(tmp, 'claudeDesktop.js'));

    // 0. 번들은 Node 내장 말고 아무것도 require 하지 않는다(ajv 의 'require("ajv/…")' 는 생성 코드 안의 글자) --------
    const bundleText = fs.readFileSync(BUNDLE, 'utf8');
    const reqs = [...bundleText.matchAll(/(?<![`'"_.$\w])require\("([^"]+)"\)/g)].map((m) => m[1]);
    const builtins = new Set(require('module').builtinModules.flatMap((m) => [m, `node:${m}`]));
    assert.deepStrictEqual([...new Set(reqs.filter((r) => !builtins.has(r)))], [], 'bundle requires only Node built-ins');
    assert(reqs.length > 0, 'the require scan found the built-ins (scan works)');
    ok('bundle self-contained');

    // 미끼: legacy 브리지. 포트 파일 방식의 MCP 서버가 STCFSD_MCP_PORT 로 짐작하면 여기에 닿는다.
    const decoyPort = await freePort();
    const decoyHits = [];
    decoy = new bridgeMod.McpBridgeServer(() => ({
      getStatus: () => { decoyHits.push('status'); return { decoy: true }; },
      handleMcpAction: async (b) => { decoyHits.push(b.action); return { decoy: true }; },
    }), decoyPort);
    await decoy.start();

    const appDir = path.join(tmp, 'AppData', 'Roaming', 'StCFSD');
    const portFile = reg.standardPortFile(appDir);
    assert.strictEqual(portFile, path.join(appDir, 'mcp', 'stcfsd-mcp-port'));
    const standaloneEnv = { STCFSD_MCP_PORT_FILE: portFile, STCFSD_MCP_STANDALONE: '1', STCFSD_MCP_PORT: String(decoyPort) };
    const ai = await mcpClient(standaloneEnv);
    clients.push(ai);
    assert.strictEqual((await ai.client.listTools()).tools.length, 61, '61 tools (K4a: get_view · focus)');

    // 1. 프로그램이 꺼져 있음(파일 없음) --------------------------------------------------
    let r = await ai.call('get_status');
    assert(r.isError, 'not running → tool error');
    assert.strictEqual(r.data.error, conn.STANDALONE_NOT_RUNNING);
    assert(r.data.error.includes('The StCFSD program is not running') && !/ECONN|VS Code/.test(r.data.error));
    r = await ai.call('set_material', { E: 29500, v: 0.3 });
    assert.strictEqual(r.data.error, conn.STANDALONE_NOT_RUNNING, 'every tool, not only status');
    ok('not running (no port file) → plain words');

    // 2. 호스트 A: 포트 파일 · 토큰 ------------------------------------------------------
    const A = startHost(tmp, portFile);
    hosts.push(A);
    const readyA = await A.ready;
    const fileA = JSON.parse(fs.readFileSync(portFile, 'utf8'));
    assert.deepStrictEqual(Object.keys(fileA).sort(), ['app', 'instanceId', 'pid', 'port', 'startedAt', 'token', 'version']);
    assert.strictEqual(fileA.app, 'stcfsd');
    assert.strictEqual(fileA.version, 1);
    assert.strictEqual(fileA.pid, A.child.pid);
    assert.strictEqual(fileA.port, readyA.port);
    assert.notStrictEqual(fileA.port, 52790, 'ephemeral port, not the extension range');
    assert.match(fileA.token, /^[0-9a-f]{64}$/);
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(portFile).mode & 0o777, 0o600, 'port file 0600');
      assert.strictEqual(fs.statSync(path.dirname(portFile)).mode & 0o777, 0o700, 'port dir 0700');
    }
    assert.deepStrictEqual(fs.readdirSync(path.dirname(portFile)), ['stcfsd-mcp-port'], 'no temp file left (atomic write)');
    ok('port file schema / atomic / permissions');

    r = await ai.call('get_status');
    assert(!r.isError, `status through the port file: ${r.text}`);
    assert.strictEqual(r.data.host_pid, A.child.pid);
    assert(!('restart_notice' in r.data), 'first contact: no restart notice');
    r = await ai.call('get_nodes');
    assert(!r.isError && r.data.action === 'get_nodes', 'tool call with token succeeds');
    assert.deepStrictEqual(A.actions(), ['get_nodes']);
    ok('tool call succeeds with token');

    // 3. 토큰 없음 · 틀림 → 401, 다른 검사는 그대로 ---------------------------------------------
    const auth = { Authorization: `Bearer ${fileA.token}` };
    const before = A.events.length;
    let h = await raw(fileA.port, { method: 'GET', path: '/status' });
    assert.strictEqual(h.status, 401, 'no token → 401');
    assert.strictEqual(h.headers['www-authenticate'], 'Bearer');
    h = await raw(fileA.port, { method: 'POST', path: '/action', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + '0'.repeat(64) } }, '{"action":"save_project","filepath":"x"}');
    assert.strictEqual(h.status, 401, 'wrong token → 401');
    h = await raw(fileA.port, { method: 'POST', path: '/action', headers: { 'Content-Type': 'application/json', Authorization: fileA.token } }, '{"action":"get_nodes"}');
    assert.strictEqual(h.status, 401, 'token without Bearer → 401');
    h = await raw(fileA.port, { method: 'POST', path: '/action', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example', ...auth } }, '{"action":"get_nodes"}');
    assert.strictEqual(h.status, 403, 'Origin still rejected with a token');
    h = await raw(fileA.port, { method: 'POST', path: '/action', headers: { 'Content-Type': 'text/plain', ...auth } }, '{"action":"get_nodes"}');
    assert.strictEqual(h.status, 415, 'content type still checked');
    h = await raw(fileA.port, { method: 'GET', path: '/status', headers: { Host: `evil.example:${fileA.port}`, ...auth } });
    assert.strictEqual(h.status, 403, 'foreign Host still rejected');
    await delay(50);
    assert.strictEqual(A.events.length, before, 'rejected requests never reach the panel');
    h = await raw(fileA.port, { method: 'GET', path: '/status', headers: auth });
    assert.strictEqual(h.status, 200, 'right token → 200');
    assert.strictEqual(pf.parsePortFile(JSON.stringify({ ...fileA, token: 'x' })), undefined, 'malformed token refused by the reader');
    ok('401 without / with wrong token; Origin/Host/content-type checks kept');

    // 4. 마지막 AI 호출 — 화면의 조회(요청 id 없음)는 세지 않는다 --------------------------------------
    h = await raw(fileA.port, { method: 'GET', path: '/last-call', headers: auth });
    assert.strictEqual(h.status, 200);
    assert.strictEqual(h.json.aiCalls, 2, 'get_status + get_nodes; the raw screen-style read is not an AI call');
    assert.strictEqual(h.json.lastAiCall.client, 'k1-test-client/1.0.0', 'client identified by header');
    assert.strictEqual(h.json.lastAiCall.action, 'get_nodes');
    assert.strictEqual(h.json.lastAiCall.endpoint, '/action');
    assert(!Number.isNaN(Date.parse(h.json.lastAiCall.at)));
    assert.strictEqual(h.json.pid, A.child.pid);
    assert.strictEqual((await raw(fileA.port, { method: 'GET', path: '/last-call' })).status, 401, '/last-call needs the token');
    ok('last AI call recorded with client name');

    // 5. 강제 종료 — 파일은 남고 pid 는 죽었다 ------------------------------------------------
    A.child.kill('SIGKILL');
    await A.exited;
    assert(fs.existsSync(portFile), 'hard kill leaves the file');
    r = await ai.call('get_status');
    assert.strictEqual(r.data.error, conn.STANDALONE_NOT_RUNNING, 'stale file (dead pid) → not running');
    ok('stale port file (dead pid) → plain words');

    // 6. 파일은 살아 있는 pid 를 가리키는데 아무도 듣지 않음 → 연결 거부, 쉬운 말 ----------------------------
    const closedPort = await freePort();
    fs.writeFileSync(portFile, JSON.stringify({ ...fileA, pid: process.pid, port: closedPort, instanceId: 'listening-nobody' }));
    r = await ai.call('get_status');
    assert(r.isError);
    assert.strictEqual(r.data.error, conn.STANDALONE_REFUSED, 'refused → plain words');
    assert(!r.text.includes('ECONNREFUSED'));
    ok('connection refused → plain words, not ECONNREFUSED');

    // 7. 다른 포트 · 다른 pid 로 다시 켜짐 → 막기 ------------------------------------------------
    const B = startHost(tmp, portFile, { K1_STATUS_DELAY_MS: '400' });
    hosts.push(B);
    await B.ready;
    const fileB = JSON.parse(fs.readFileSync(portFile, 'utf8'));
    assert.notStrictEqual(fileB.pid, fileA.pid);
    assert.notStrictEqual(fileB.instanceId, fileA.instanceId);
    assert.notStrictEqual(fileB.token, fileA.token, 'new token per process');
    r = await ai.call('set_material', { E: 29500, v: 0.3 });
    assert.strictEqual(r.data.error, conn.STANDALONE_RESTARTED, 'write after restart refused before sending');
    const both = await Promise.all([ai.call('set_material', { E: 29500, v: 0.3 }), ai.call('get_nodes')]);
    assert(both.every((x) => x.isError && x.data.error === conn.STANDALONE_RESTARTED), 'two concurrent calls both refused');
    await delay(50);
    assert.deepStrictEqual(B.actions(), [], 'nothing reached the restarted host');
    assert.strictEqual(B.statuses(), 0);
    // 상태 조회가 호스트에서 도는 동안(400 ms) 보낸 쓰기도 막힌다 — 확인은 응답이 온 뒤에야 된다.
    const statusP = ai.call('get_status');
    await waitFor(() => B.statuses() === 1, 3000, 'status read to reach host B');
    const writeDuring = await ai.call('set_material', { E: 29500, v: 0.3 });
    const status = await statusP;
    assert.strictEqual(writeDuring.data.error, conn.STANDALONE_RESTARTED, 'write sent while the status read is in flight is refused');
    assert(!status.isError, `status after restart passes: ${status.text}`);
    assert.strictEqual(status.data.restart_notice, conn.STANDALONE_RESTARTED_NOTICE, 'status carries the notice');
    assert.strictEqual(status.data.host_pid, B.child.pid);
    assert.deepStrictEqual(B.actions(), [], 'still nothing but the status read');
    r = await ai.call('set_material', { E: 29500, v: 0.3 });
    assert(!r.isError && r.data.action === 'set_material', 'after a successful status read other calls pass');
    assert.deepStrictEqual(B.actions(), ['set_material']);
    r = await ai.call('get_status');
    assert(!('restart_notice' in r.data), 'notice only once');
    ok('restart on a new port: status-only gate incl. concurrent calls, then released');

    // 8. 정상 종료 → 파일 지움 → 꺼져 있음. 프로세스 종료(멈춤 없이)도 지운다 -----------------------------
    B.send('stop');
    await B.exited;
    assert(!fs.existsSync(portFile), 'stop() removes the port file');
    r = await ai.call('get_status');
    assert.strictEqual(r.data.error, conn.STANDALONE_NOT_RUNNING);
    const C = startHost(tmp, portFile);
    hosts.push(C);
    await C.ready;
    assert(fs.existsSync(portFile));
    C.send('exit');
    await C.exited;
    assert(!fs.existsSync(portFile), 'process exit removes the port file');
    // 남의 파일은 지우지 않는다
    const D0 = startHost(tmp, portFile);
    hosts.push(D0);
    await D0.ready;
    const keep = fs.readFileSync(portFile, 'utf8');
    assert.strictEqual(pf.removePortFileIfOwned(portFile, 'someone-else'), false);
    assert.strictEqual(fs.readFileSync(portFile, 'utf8'), keep, 'a successor’s file is not removed');
    ok('port file removed on stop and on process exit, only when owned');

    // 9. 등록 항목 그대로 — 확장 폴더 밖으로 옮긴 번들, 뿌리 폴더에서, 같은 프로그램에 붙는다 ---------------------
    const moved = path.join(tmp, 'Programs', 'StCFSD 프로그램', 'resources', 'app-root');
    fs.mkdirSync(path.join(moved, 'media'), { recursive: true });
    fs.copyFileSync(BUNDLE, reg.mcpServerScript(moved));
    const entry = reg.standaloneMcpEntry({ command: process.execPath, serverScript: reg.mcpServerScript(moved), portFile });
    assert.deepStrictEqual(entry.env, { ELECTRON_RUN_AS_NODE: '1', STCFSD_MCP_PORT_FILE: portFile, STCFSD_MCP_STANDALONE: '1' });
    const viaEntry = await mcpClient(entry.env, DRIVE_ROOT, entry.args[0], entry.command);
    clients.push(viaEntry);
    assert.strictEqual((await viaEntry.client.listTools()).tools.length, 61);
    r = await viaEntry.call('get_status');
    assert(!r.isError && r.data.host_pid === D0.child.pid, 'registered entry reaches the running program from any folder');
    ok('registered entry runs the moved bundle from the drive root');

    // 10. 포트 파일 방식이지만 독립 프로그램이 아님 — 어느 파일인지 밝히고 짐작하지 않는다 ------------------------
    const missing = path.join(tmp, 'nowhere', 'stcfsd-mcp-port');
    const dev = await mcpClient({ STCFSD_MCP_PORT_FILE: missing, STCFSD_MCP_PORT: String(decoyPort) });
    clients.push(dev);
    r = await dev.call('get_status');
    assert(r.isError && r.data.error.includes(missing) && r.data.error.includes('no other port was tried'));
    assert.deepStrictEqual(decoyHits, [], 'STCFSD_MCP_PORT is never used when a port file is set');
    ok('port-file mode never falls back to STCFSD_MCP_PORT');

    // 11. legacy — 변수 없음: 지금 그대로 ---------------------------------------------------
    assert.strictEqual(bridgeMod.bridgeOptionsFromEnv({}), undefined);
    assert.strictEqual(bridgeMod.bridgeOptionsFromEnv({ STCFSD_MCP_PORT_FILE: '' }), undefined);
    assert.deepStrictEqual(conn.connectionModeFromEnv({}, 52790), { kind: 'legacy', port: 52790 });
    assert.deepStrictEqual(conn.connectionModeFromEnv({ STCFSD_MCP_PORT: '52795' }, 52790), { kind: 'legacy', port: 52795 });
    const legacyPort = await freePort();
    legacy = new bridgeMod.McpBridgeServer(() => ({ getStatus: () => ({ legacy: true }), handleMcpAction: async (b) => ({ legacy: b.action }) }), legacyPort);
    await legacy.start();
    assert.strictEqual(legacy.port, legacyPort);
    assert.strictEqual(legacy.token, undefined);
    assert.strictEqual(legacy.portFile, undefined);
    h = await raw(legacyPort, { method: 'GET', path: '/status' });
    assert.strictEqual(h.status, 200, 'legacy: no token needed');
    h = await raw(legacyPort, { method: 'GET', path: '/last-call' });
    assert.deepStrictEqual([h.status, h.json], [200, { error: 'Unknown endpoint: GET /last-call' }], 'legacy: no new endpoint');
    assert.strictEqual(bridgeMod.checkBridgeRequest('GET', { host: `127.0.0.1:${legacyPort}` }, legacyPort), null);
    const old = await mcpClient({ STCFSD_MCP_PORT: String(legacyPort) });
    clients.push(old);
    r = await old.call('get_status');
    assert(!r.isError && r.data.legacy === true, 'legacy MCP → fixed port, no token');
    r = await old.call('get_nodes');
    assert.strictEqual(r.data.legacy, 'get_nodes');
    const closedLegacy = await freePort();
    const gone = await mcpClient({ STCFSD_MCP_PORT: String(closedLegacy) });
    clients.push(gone);
    r = await gone.call('get_status');
    assert.strictEqual(r.data.error, `StCFSD bridge not reachable at 127.0.0.1:${closedLegacy} (ECONNREFUSED). `
      + 'Start VS Code with the StCFSD extension and open the Section Designer panel '
      + '("StCFSD: Open Section Designer"); the MCP tools work only while that panel is open.', 'legacy error text unchanged');
    const extTs = fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
    assert(extTs.includes('const mcpPort = portFileOptions ? 0 : await findAvailablePort(52790);'), 'extension: fixed range unless port file');
    assert(/\} else if \(!isTestMode && context\.extensionMode !== vscode\.ExtensionMode\.Test\) \{\s*setupMcpConfig\(context, mcpPort\);/.test(extTs),
      'extension: config files written exactly as before when no port file');
    ok('legacy mode unchanged (fixed port, no token, same texts, no /last-call)');

    // 12. 순수 단위: 재시작 판정(시계 · pid 를 주입) -----------------------------------------------
    const fakeFile = path.join(tmp, 'unit-port');
    const write = (o) => fs.writeFileSync(fakeFile, JSON.stringify({ app: 'stcfsd', version: 1, port: 40000, token: 'a'.repeat(64), pid: 4242, instanceId: 'i1', startedAt: 'x', ...o }));
    const hc = conn.createHostConnection({ kind: 'port-file', file: fakeFile, standalone: true }, { isAlive: () => true });
    write({});
    assert(hc.resolve(false).ok, 'first contact passes');
    write({ instanceId: 'i2' });                                   // 같은 pid 를 물려받은 새 프로세스
    assert.strictEqual(hc.resolve(false).error, conn.STANDALONE_RESTARTED, 'same pid, new instanceId → restart');
    const t1 = hc.resolve(true);
    assert(t1.ok && t1.target.restarted);
    write({ instanceId: 'i3' });                                   // 확인 전에 또 재시작
    hc.confirmStatus(t1.target);
    assert.strictEqual(hc.resolve(false).error, conn.STANDALONE_RESTARTED, 'a status from an earlier host does not release the gate');
    const t2 = hc.resolve(true);
    hc.confirmStatus(t2.target);
    assert(hc.resolve(false).ok, 'released by a status of the current host');
    ok('gate state machine (unit)');

    // ─── V5 (2026-11-22): 독립 검증 V5 의 연결 몫 — 따로 둔 포트 파일(앞 묶음의 기록과 섞이지 않게) ─────────────
    const pf2 = reg.standardPortFile(path.join(tmp, 'v5', 'StCFSD'));
    const env2 = { STCFSD_MCP_PORT_FILE: pf2, STCFSD_MCP_STANDALONE: '1' };
    const v5client = async (name) => { const c = await mcpClient(env2, DRIVE_ROOT, BUNDLE, process.execPath, name); clients.push(c); return c; };
    const MAT = { E: 29500, v: 0.3 };
    const statusUntilOk = async (c, ms = 10000) => {
      const until = Date.now() + ms;
      let last;
      while (Date.now() < until) { last = await c.call('get_status'); if (!last.isError) { return last; } await delay(100); }
      throw new Error(`get_status never succeeded: ${last && last.text}`);
    };
    const portInfo = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

    // 13. V5-S2 — 듣기 시작한 뒤 패널이 생기기 전 ------------------------------------------------
    const P = startHost(tmp, pf2, { K1_PANEL_DELAY_MS: '1500' });
    hosts.push(P);
    await P.ready;
    const s2 = await v5client('v5-s2-client');
    r = await s2.call('get_status');
    assert(r.isError && r.data.error === bridgeMod.HOST_STARTING, `starting wording before the panel exists: ${r.text}`);
    assert(!/Section Designer|CUFSM/.test(r.text), 'no VS Code wording in the standalone program');
    r = await s2.call('set_material', MAT);
    assert.strictEqual(r.data.error, bridgeMod.HOST_STARTING, 'a write before the panel exists gets the same words');
    assert.deepStrictEqual(P.actions(), [], 'nothing reached a panel');
    r = await statusUntilOk(s2);
    assert(!('restart_notice' in r.data), 'first contact while starting: no restart notice afterwards');
    // 재시작 뒤 시작 중: get_status 는 시작 중 문구, 막기는 그대로, 패널이 생긴 뒤 다시 부른 get_status 가 푼다
    P.child.kill('SIGKILL');
    await P.exited;
    const Q = startHost(tmp, pf2, { K1_PANEL_DELAY_MS: '1500' });
    hosts.push(Q);
    await Q.ready;
    r = await s2.call('get_status');
    assert(r.isError && r.data.error === bridgeMod.HOST_STARTING, `restarted and still starting: ${r.text}`);
    r = await s2.call('set_material', MAT);
    assert.strictEqual(r.data.error, conn.STANDALONE_RESTARTED, 'the gate stays closed while the program is starting');
    r = await statusUntilOk(s2);
    assert.strictEqual(r.data.restart_notice, conn.STANDALONE_RESTARTED_NOTICE, 'a retried get_status opens the gate (not stranded)');
    r = await s2.call('set_material', MAT);
    assert(!r.isError && r.data.action === 'set_material');
    // 지금 방식(옵션 없음)의 패널 없음 문구는 그대로
    const noPanelPort = await freePort();
    const noPanelBridge = new bridgeMod.McpBridgeServer(() => undefined, noPanelPort);
    await noPanelBridge.start();
    h = await raw(noPanelPort, { method: 'GET', path: '/status' });
    noPanelBridge.stop();
    assert.deepStrictEqual(h.json, { error: 'No active CUFSM panel. Open Section Designer first.' }, 'legacy no-panel text unchanged');
    assert.strictEqual(bridgeMod.NO_PANEL, 'No active CUFSM panel. Open Section Designer first.');
    ok('V5-S2: starting words before the panel, gate released by a retried get_status, legacy text unchanged');

    // 14. V5-08 · V5b-10 — 재시작 기준을 MCP 서버 프로세스 너머로(프로세스별 기록) ---------------------------------
    const recsOf = (name) => pf.listClientRecords(pf.clientRecordFile(pf2, name));
    const desk1 = await v5client('claude-ai');
    r = await desk1.call('get_nodes');
    assert(!r.isError && r.data.action === 'get_nodes', `first connection ever (no record) → no false alarm: ${r.text}`);
    const fileQ = portInfo(pf2);
    let recs = recsOf('claude-ai');
    assert.strictEqual(recs.length, 1, 'one record, for this MCP server process');
    assert.strictEqual(recs[0].kind, 'process');
    assert.strictEqual(path.dirname(recs[0].file), path.dirname(pf2), 'the record lives beside the port file');
    assert.strictEqual(recs[0].read.record.instanceId, fileQ.instanceId, 'record = the program this process talked to');
    assert(!fs.readFileSync(recs[0].file, 'utf8').includes(fileQ.token), 'no token in the record');
    const desk1Rec = recs[0].file;
    await desk1.close();
    // 밤사이 프로그램이 다시 켜지고, 아침에 Claude Desktop 이 새 MCP 서버를 띄운다
    Q.child.kill('SIGKILL');
    await Q.exited;
    const R = startHost(tmp, pf2);
    hosts.push(R);
    await R.ready;
    const desk2 = await v5client('claude-ai');
    r = await desk2.call('set_material', MAT);
    assert.strictEqual(r.data.error, conn.STANDALONE_RESTARTED_EARLIER, 'a new MCP server knows an earlier session saw another program run');
    assert.deepStrictEqual(R.actions(), [], 'the write was not sent');
    r = await desk2.call('get_status');
    assert(!r.isError && r.data.restart_notice === conn.STANDALONE_RESTARTED_EARLIER_NOTICE, `notice on the first get_status: ${r.text}`);
    assert.strictEqual(R.statuses(), 1, 'the notice costs exactly one get_status');
    r = await desk2.call('set_material', MAT);
    assert(!r.isError && r.data.action === 'set_material', 'released after that one get_status');
    recs = recsOf('claude-ai');
    assert(!fs.existsSync(desk1Rec), "the ended process's record (another program) was folded …");
    assert(recs.some((x) => x.kind === 'stale'), '… into the stale marker');
    assert(recs.some((x) => x.kind === 'process' && x.read.record.instanceId === portInfo(pf2).instanceId), 'own record = confirmed program');
    // 다른 클라이언트(Claude Code)는 기록이 따로 — 처음이면 알림 없음
    const code1 = await v5client('claude-code');
    r = await code1.call('get_nodes');
    assert(!r.isError, 'another client name, first time → no alarm');
    // 또 다시 켜짐: 두 클라이언트 모두 막히고, 한쪽의 get_status 가 다른 쪽을 풀지 않는다
    R.child.kill('SIGKILL');
    await R.exited;
    const S = startHost(tmp, pf2);
    hosts.push(S);
    await S.ready;
    r = await code1.call('get_status');
    assert.strictEqual(r.data.restart_notice, conn.STANDALONE_RESTARTED_NOTICE, 'in-process restart keeps the K1 wording');
    r = await code1.call('get_nodes');
    assert(!r.isError);
    r = await desk2.call('set_material', MAT);
    assert.strictEqual(r.data.error, conn.STANDALONE_RESTARTED, "one client's get_status does not release another client's gate");
    r = await desk2.call('get_status');
    assert.strictEqual(r.data.restart_notice, conn.STANDALONE_RESTARTED_NOTICE);
    await desk2.close();
    // V5b-10 의 안전한 쪽: 이 이름의 끝난 세션이 한 번이라도 다른 프로그램을 봤으면(접힌 표시) 새 프로세스는 늘 알림 한 번
    const desk3 = await v5client('claude-ai');
    r = await desk3.call('set_material', MAT);
    assert.strictEqual(r.data.error, conn.STANDALONE_RESTARTED_EARLIER, 'cannot tell which earlier session was this one → an extra get_status, never a missed notice');
    r = await desk3.call('get_status');
    assert.strictEqual(r.data.restart_notice, conn.STANDALONE_RESTARTED_EARLIER_NOTICE);
    await desk3.close();
    // 이어짐을 증명할 수 있으면 알림 없음: 이 이름의 모든 기록이 지금 프로그램이다
    const cont1 = await v5client('v5-continuous');
    r = await cont1.call('get_nodes');
    assert(!r.isError);
    await cont1.close();
    const cont2 = await v5client('v5-continuous');
    r = await cont2.call('set_material', MAT);
    assert(!r.isError, 'program not restarted since every earlier session of this name last saw it → no alarm');
    // V5b-10 (d): 같은 이름의 두 MCP 서버. 프로그램이 다시 켜지고 B 만 확인 → 그 뒤 뜬 같은 이름의 새 서버는 A 의 기록 때문에 알림
    const twinA = await v5client('v5b10-twin');
    const twinB = await v5client('v5b10-twin');
    assert(!(await twinA.call('get_nodes')).isError && !(await twinB.call('get_nodes')).isError);
    S.child.kill('SIGKILL');
    await S.exited;
    const T = startHost(tmp, pf2);
    hosts.push(T);
    await T.ready;
    r = await twinB.call('get_status');
    assert.strictEqual(r.data.restart_notice, conn.STANDALONE_RESTARTED_NOTICE);
    const twinC = await v5client('v5b10-twin');
    r = await twinC.call('set_material', MAT);
    assert.strictEqual(r.data.error, conn.STANDALONE_RESTARTED_EARLIER,
      'V5b-10: a same-name server that confirmed the new program does not clear the notice for a later one');
    assert.deepStrictEqual(T.actions(), [], 'nothing reached the program');
    assert(recsOf('v5b10-twin').filter((x) => x.kind === 'process').length >= 2, "the live twin's record is left alone");
    // 읽을 수 없는 기록(끝난 프로세스) → 이어짐을 증명하지 못하니 알림 → 확인 뒤 접는다
    const brokenRec = pf.processRecordFile(pf.clientRecordFile(pf2, 'v5-broken'), 2147483646, 1);
    fs.writeFileSync(brokenRec, '{not json');
    const broken = await v5client('v5-broken');
    r = await broken.call('set_material', MAT);
    assert.strictEqual(r.data.error, conn.STANDALONE_RESTARTED_EARLIER, 'unreadable record → treated as restarted');
    r = await broken.call('get_status');
    assert.strictEqual(r.data.restart_notice, conn.STANDALONE_RESTARTED_EARLIER_NOTICE);
    assert(!fs.existsSync(brokenRec) && recsOf('v5-broken').some((x) => x.kind === 'stale'), 'folded after the confirmation');
    // V5 판의 이름 하나 기록(옮겨 온 설치본): 지금 프로그램이면 헛 알림 없음
    const fileT = portInfo(pf2);
    fs.writeFileSync(pf.clientRecordFile(pf2, 'v5-legacy'), JSON.stringify({ app: 'stcfsd-mcp-client', version: 1, client: 'v5-legacy',
      instanceId: fileT.instanceId, pid: fileT.pid, startedAt: fileT.startedAt, at: new Date().toISOString() }));
    const legacyRec = await v5client('v5-legacy');
    r = await legacyRec.call('set_material', MAT);
    assert(!r.isError, 'a V5 single record naming the current program still counts');
    // 기록 자리가 폴더(읽기 · 쓰기 · 지우기 모두 안 됨)여도 막기는 get_status 로 풀린다 — 교착 없음
    const roRec = pf.clientRecordFile(pf2, 'ro-client');
    fs.mkdirSync(roRec);
    const ro = await v5client('ro-client');
    r = await ro.call('set_material', MAT);
    assert.strictEqual(r.data.error, conn.STANDALONE_RESTARTED_EARLIER);
    r = await ro.call('get_status');
    assert.strictEqual(r.data.restart_notice, conn.STANDALONE_RESTARTED_EARLIER_NOTICE);
    r = await ro.call('set_material', MAT);
    assert(!r.isError, 'released even though a record cannot be read or removed');
    assert(fs.statSync(roRec).isDirectory(), 'the odd record was left alone');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(pf2)).filter((n) => n.includes('.stcfsd-tmp-')), [], 'no temp files beside the port file');
    // 단위: 자기 기록을 쓸 수 없어도(그 자리가 폴더) 확인으로 풀린다
    {
      const uf = path.join(tmp, 'v5b10-unit', 'port');
      fs.mkdirSync(path.dirname(uf), { recursive: true });
      fs.writeFileSync(uf, JSON.stringify({ app: 'stcfsd', version: 1, port: 40001, token: 'b'.repeat(64), pid: 4242, instanceId: 'now', startedAt: 'x' }));
      const pre = pf.clientRecordFile(uf, 'unit');
      fs.writeFileSync(pf.processRecordFile(pre, 77, 5), JSON.stringify({ app: 'stcfsd-mcp-client', version: 1, instanceId: 'before' }));
      fs.mkdirSync(pf.processRecordFile(pre, 88, 9));
      const hu = conn.createHostConnection({ kind: 'port-file', file: uf, standalone: true },
        { isAlive: () => true, clientName: () => 'unit', processId: 88, processStartMs: 9 });
      assert.strictEqual(hu.resolve(false).error, conn.STANDALONE_RESTARTED_EARLIER, 'a live same-name process saw another program');
      const tu = hu.resolve(true);
      assert(tu.ok && tu.target.restarted && tu.target.earlier);
      assert.strictEqual(hu.restartedNotice(tu.target), conn.STANDALONE_RESTARTED_EARLIER_NOTICE);
      hu.confirmStatus(tu.target);
      assert(hu.resolve(false).ok, 'released although the own record could not be written');
      assert(fs.existsSync(pf.processRecordFile(pre, 77, 5)), "a live process's record is never removed");
    }
    ok('V5-08/V5b-10: per-process records — no alarm first time or when every earlier session saw this program; otherwise one get_status (same-name servers, ended sessions, unreadable records), no deadlock');

    // 15. V5-09 · V5b-05 — 포트 파일의 pid 는 살아 있지만 그 포트에서 듣는 것은 남의 프로그램 ----------------------------
    const pf3 = path.join(tmp, 'v5-09', 'mcp', 'stcfsd-mcp-port');
    fs.mkdirSync(path.dirname(pf3), { recursive: true });
    const seen = [];
    const fake = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url} auth=${req.headers.authorization === undefined ? 'none' : 'SENT'} nonce=${req.headers['x-stcfsd-nonce'] ? 'yes' : 'no'}`);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-StCFSD-Proof', 'ab'.repeat(32));        // 그럴듯한 꼴이지만 증명이 아니다
      res.end('{"hasModel":true,"fake":true}');
    });
    await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
    try {
      fs.writeFileSync(pf3, JSON.stringify({ app: 'stcfsd', version: 1, port: fake.address().port, token: 'cd'.repeat(32),
        pid: process.pid, instanceId: 'stale-instance', startedAt: '2026-11-21T09:00:00.000Z' }));
      const v9 = await mcpClient({ STCFSD_MCP_PORT_FILE: pf3, STCFSD_MCP_STANDALONE: '1' }, DRIVE_ROOT, BUNDLE, process.execPath, 'v5-09-client');
      clients.push(v9);
      r = await v9.call('get_status');
      assert.strictEqual(r.data.error, conn.STANDALONE_NOT_RUNNING, `another program is not taken for StCFSD: ${r.text}`);
      r = await v9.call('set_material', MAT);
      assert.strictEqual(r.data.error, conn.STANDALONE_NOT_RUNNING);
      r = await v9.call('get_nodes');
      assert.strictEqual(r.data.error, conn.STANDALONE_NOT_RUNNING);
      assert.deepStrictEqual(seen, ['GET /hello auth=none nonce=yes'],
        'V5b-05: only the connection check reached it, without the token; nothing further was sent');
    } finally { fake.close(); }
    // 진짜 호스트의 증명: `/hello` 는 토큰 없이도(V5b-05), nonce · instanceId 에 묶여
    const nonce = pf.newNonce();
    const statusesBeforeHello = T.statuses();
    h = await raw(fileT.port, { method: 'GET', path: '/hello', headers: { 'X-StCFSD-Nonce': nonce } });
    assert.deepStrictEqual([h.status, h.json], [200, { app: 'stcfsd' }], '/hello needs no token');
    assert.strictEqual(h.headers['x-stcfsd-proof'], pf.instanceProof(fileT.token, fileT.instanceId, nonce), 'real host proves its instance');
    assert(pf.proofMatches(h.headers['x-stcfsd-proof'], fileT.token, fileT.instanceId, nonce));
    assert(!pf.proofMatches(h.headers['x-stcfsd-proof'], fileT.token, 'other-instance', nonce), 'bound to the instanceId');
    assert(!pf.proofMatches(h.headers['x-stcfsd-proof'], fileT.token, fileT.instanceId, pf.newNonce()), 'bound to the nonce');
    assert(!pf.proofMatches(h.headers['x-stcfsd-proof'], 'e'.repeat(64), fileT.instanceId, nonce), 'keyed with the token');
    h = await raw(fileT.port, { method: 'GET', path: '/hello', headers: { 'X-StCFSD-Nonce': nonce, Origin: 'http://evil.example' } });
    assert.strictEqual(h.status, 403, '/hello still refuses browser requests');
    h = await raw(fileT.port, { method: 'GET', path: '/status', headers: { 'X-StCFSD-Nonce': nonce } });
    assert.strictEqual(h.status, 401, 'everything else still needs the token');
    assert.strictEqual(h.headers['x-stcfsd-proof'], undefined, 'no proof on a refused request');
    await delay(50);
    assert.strictEqual(T.statuses(), statusesBeforeHello, '/hello never touches the panel');
    h = await raw(legacyPort, { method: 'GET', path: '/hello', headers: { 'X-StCFSD-Nonce': nonce } });
    assert.deepStrictEqual(h.json, { error: 'Unknown endpoint: GET /hello' }, 'legacy bridge: no /hello');
    assert.strictEqual(h.headers['x-stcfsd-proof'], undefined, 'legacy bridge: no proof header');
    ok('V5-09/V5b-05: a port held by another program gets one token-less /hello and is refused as "not running"; real host proves its instance');

    // 16. V5-S3 — 독립 프로그램에서 묶은 Python 이 망가졌을 때의 안내(확장의 길은 그대로) ----------------------------
    {
      const Module = require('module');
      const outExt = path.join(ROOT, 'out', 'extension.js');
      const shimFile = path.join(tmp, '__vscode_stub__.js');
      const calls = [];
      const dummy = new Proxy(function () { /* 아무것도 */ }, { get: (t, k) => (k === 'prototype' ? {} : dummy), construct: () => dummy, apply: () => dummy });
      const stub = new Proxy({
        window: {
          showErrorMessage: (...a) => { calls.push(['error', ...a]); return Promise.resolve(undefined); },
          showWarningMessage: (...a) => { calls.push(['warning', ...a]); return Promise.resolve(a[a.length - 1]); },
          showInformationMessage: (...a) => { calls.push(['info', ...a]); return Promise.resolve(undefined); },
          withProgress: () => { calls.push(['progress']); return Promise.resolve(); },
        },
        env: { openExternal: (u) => { calls.push(['open', String(u)]); return Promise.resolve(true); } },
        Uri: { parse: (s) => s, file: (s) => s, joinPath: () => '' },
        ExtensionMode: { Production: 1, Development: 2, Test: 3 },
        ProgressLocation: { Notification: 15 },
      }, { get: (t, k) => (k in t ? t[k] : dummy) });
      const origResolve = Module._resolveFilename;
      Module._resolveFilename = function (req, ...rest) { return req === 'vscode' ? shimFile : origResolve.call(this, req, ...rest); };
      require.cache[shimFile] = { id: shimFile, filename: shimFile, loaded: true, exports: stub };
      try {
        const ext = require(outExt);
        assert.strictEqual(typeof ext.checkAndInstallDependencies, 'function', 'out/extension.js is current (npx tsc -p ./)');
        const bogus = path.join(tmp, 'no-python', 'python.exe');
        const run = async (py, standalone) => { calls.length = 0; await ext.checkAndInstallDependencies({}, py, standalone); return calls.slice(); };
        assert.deepStrictEqual(await run(bogus, true), [['error', ext.STANDALONE_PYTHON_BROKEN(bogus)]],
          'standalone, no Python: reinstall wording, no python.org action');
        assert.deepStrictEqual(await run(bogus, false), [['warning',
          'StCFSD: Python을 찾을 수 없습니다. 해석 엔진을 사용하려면 Python 3.10+ 설치가 필요합니다.', 'Python 다운로드 페이지 열기', '무시']],
          'extension, no Python: exactly as before');
        // 이 node 를 "Python" 으로: --version 은 되고 `-c "import numpy"` 는 실패한다 = 패키지 없음
        assert.deepStrictEqual(await run(process.execPath, true), [['error', ext.STANDALONE_PACKAGES_BROKEN(['numpy', 'scipy'])]],
          'standalone, packages missing: reinstall wording, no pip offer');
        assert.deepStrictEqual(await run(process.execPath, false), [['warning',
          'StCFSD: 필수 Python 패키지가 없습니다: numpy, scipy. 자동 설치하시겠습니까?', '설치', '나중에']],
          'extension, packages missing: exactly as before');
        assert(!ext.STANDALONE_PYTHON_BROKEN('x').includes('pip') && ext.STANDALONE_PYTHON_BROKEN('x').includes('다시 설치'));
      } finally {
        Module._resolveFilename = origResolve;
        delete require.cache[shimFile];
      }
      const extSrc = fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
      assert(/const portFileOptions = bridgeOptionsFromEnv\(process\.env\);[\s\S]*checkAndInstallDependencies\(context, pythonPath, !!portFileOptions\)/.test(extSrc),
        'activate passes standalone = port-file mode');
      ok('V5-S3: standalone Python problems → reinstall wording without python.org / pip; extension path unchanged');
    }

    const warnings = guard.verify(assert);
    for (const w of warnings) { console.log(w); }
    ok(`real config files untouched (${guard.files.length} checked)`);
    console.log(`mcp_port_file_contract: PASS (${checks.length} groups: ${checks.join('; ')})`);
  } finally {
    for (const c of clients) { await c.close(); }
    for (const h of hosts) { try { h.child.kill('SIGKILL'); } catch { /* 이미 끝남 */ } }
    try { decoy?.stop(); } catch { /* 무시 */ }
    try { legacy?.stop(); } catch { /* 무시 */ }
    await delay(100);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows 잠금 */ }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e && e.stack || e); process.exit(1); });
