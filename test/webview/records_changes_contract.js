/* global process, Buffer, setTimeout */
// R2-2 — 변경 묶음과 그 행위자(기록 설계 §2.4.4 · §3.3 · §5.4, §6.1 R2-2 줄). 진짜 패널 · 파이썬 · MCP 다리(포트 파일 + 토큰) · 진짜 MCP 서버(소스).
//  ① 끊는 곳: MCP 요청 하나 = 묶음 하나, 편집 상태 시작 → 끝 = 사람 묶음 하나(되돌리기도 새 묶음), 편집 상태 밖은 조용한 2 초,
//     다른 행위자가 끼면 지금 묶음을 닫는다, 파일을 열면 기준선(연 요청이 옛 파일 → 새 파일을 한 묶음으로 내지 않는다), 밖에서 바뀐 것 = external
//  ② 증거: AI 의 두께 변경이 「두께 t 2 → 2.3 mm · AI」 한 줄이고 다시 열어도 남는다. get_case_inputs 의 last_change 가 기록에서
//  ③ 쓰기 도구의 reason · work · source(→ 머리 → 문맥 → 줄). 프로젝트 밖은 메모리만(아무것도 쓰지 않는다)
//  ④ ⚔ 요청 id 머리 없이 토큰으로 쓴 변경은 ai, 화면으로 위장 못 함, 질의 문자열의 reason 무시, 제어 문자 · 2만 자 reason
//  ⑤ 스냅숏 비교의 시간(잰다)
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createPanel } = require('./panel_harness');
const { transpileMcp } = require('./mcp_transpile');

const ROOT = path.join(__dirname, '..', '..');
const TOKEN = crypto.randomBytes(32).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notes = [];

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('records_changes_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const S = ctx.StcfsdPanel;
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_r22_'));
  const root = path.join(box, 'roots'); fs.mkdirSync(root);
  const saveKey = S.writerKeyDir; const saveRoots = S.projectRoots;
  S.writerKeyDir = path.join(box, 'key'); S.projectRoots = [root];
  const { McpBridgeServer } = ctx.load(path.join('src', 'mcp', 'bridge.ts'));
  const portFile = path.join(box, 'mcp', 'stcfsd-mcp-port');
  const bridge = new McpBridgeServer(() => p, 0, { portFile, token: TOKEN });
  await bridge.start();
  // 진짜 MCP 서버(소스 transpile) — 포트 파일 방식(토큰 · 요청 id · 클라이언트 머리를 그 서버가 붙인다)
  const mdir = path.join(box, 'mcpjs');
  transpileMcp(mdir, ['server', 'siUnits', 'bridge', 'portFile', 'hostConnection']);
  const { Client } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'index.js'));
  const { StdioClientTransport } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'stdio.js'));
  const env = { ...process.env, STCFSD_MCP_PORT_FILE: portFile, STCFSD_MCP_STANDALONE: '1', NODE_PATH: path.join(ROOT, 'node_modules') };
  delete env.STCFSD_MCP_PORT;
  const client = new Client({ name: 'r22-test', version: '1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(mdir, 'server.js')], env, stderr: 'pipe' }));
  const tool = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content && r.content[0] && r.content[0].text) || '';
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (r.isError) { throw new Error(`${name}: ${text.slice(0, 300)}`); }
    return Object.defineProperty(data, '__bytes', { value: Buffer.byteLength(text), enumerable: false });
  };
  // 다리에 직접(진짜 토큰) — 머리를 내가 정한다
  const post = (urlPath, body, headers = {}) => new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: bridge.port, path: urlPath, method: 'POST', headers: {
      Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } }, (res) => {
      let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* */ } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', (e) => resolve({ status: 0, error: String(e.message) }));
    req.write(payload); req.end();
  });
  const changes = async (args = {}) => tool('list_changes', args);
  const page = (command, data) => p.__testDispatchMessage({ command, data });
  const tree = () => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); out.push(path.relative(box, q)); if (e.isDirectory()) { walk(q); } } }; walk(box); return out.sort(); };
  try {
    // ── 프로젝트 밖: 메모리만 ──
    await tool('set_section_template', { type: 'lippedc', H: 203.2, B: 63.5, D: 15.875, t: 2.0, r: 4.7625, units: 'SI' });
    const before = tree();
    await tool('set_section_template', { type: 'lippedc', H: 203.2, B: 63.5, D: 15.875, t: 2.3, r: 4.7625, units: 'SI', reason: '판 두께 올림' });
    let lc = await changes();
    assert.strictEqual(lc.persisted, false, 'outside a project: in memory');
    const c0 = lc.changes[0];
    assert(/두께 t 2 → 2\.3 mm/.test(c0.title) && c0.by.kind === 'ai' && /^r22-test\//.test(c0.by.client) && c0.reason === '판 두께 올림' && c0.trigger === 'generate_template',
      'outside: the AI thickness change is one line: ' + JSON.stringify(c0));
    assert(!tree().some((x) => /\.stcfsd/.test(x)) && tree().filter((x) => !before.includes(x)).every((x) => /^mcp/.test(x)), 'outside: nothing written');
    notes.push(`outside: 「${c0.title} · ${c0.by.kind}」 in memory, nothing written`);

    // ── 프로젝트: 기록 ──
    await tool('open_project', { name: 'R22', create: true });
    await tool('new_case', { name: 'A', kind: 'roof-purlin', from: 'current' });
    await tool('new_case', { name: 'B', kind: 'section-only' });
    const oa = await tool('open_case', { name: 'A' });
    assert.strictEqual(oa.opened, 'A');
    lc = await changes();
    assert(lc.persisted === true && lc.total === 0, 'opening is the baseline — no bundle for old file → new file ' + JSON.stringify(lc).slice(0, 300));
    await tool('set_section_template', { type: 'lippedc', H: 203.2, B: 63.5, D: 15.875, t: 2.0, r: 4.7625, units: 'SI' });
    await tool('set_section_template', { type: 'lippedc', H: 203.2, B: 63.5, D: 15.875, t: 2.3, r: 4.7625, units: 'SI', reason: '판 두께 올림', work: 'Q-3', source: 'S-1' });
    lc = await changes();
    const t1 = lc.changes[0];
    assert(/^두께 t 2 → 2\.3 mm/.test(t1.title) && t1.by.kind === 'ai' && t1.reason === '판 두께 올림' && t1.work === 'Q-3' && t1.source === 'S-1', 'project: ' + JSON.stringify(t1));
    // 한 요청 = 한 묶음(템플릿 다시 만들기의 절점 · 요소는 「외 n」 에 세지 않는다)
    assert(!/외/.test(t1.title), 'the regenerated nodes / elements are explained by t: ' + t1.title);
    // set_case_inputs 의 reason · 출처 꼬리표
    await tool('set_case_inputs', { inputs: { Lb: 3000, Cb: 1.2 }, units: 'SI', reason: '도면의 횡지지 간격' });
    const gi = await tool('get_case_inputs', { units: 'SI', keys: ['Lb', 'Cb'] });
    assert(gi.last_change && gi.last_change.Lb.by === 'ai' && Math.abs(gi.last_change.Lb.to - 3000) < 1e-9 && gi.last_change.Lb.reason === '도면의 횡지지 간격',
      'get_case_inputs last_change from the records: ' + JSON.stringify(gi.last_change));
    await tool('save_case', { reason: '저장' });
    await tool('open_case', { name: 'B' });
    await tool('open_case', { name: 'A' });
    lc = await changes({ detail: 'fields' });
    assert(lc.persisted && lc.changes.some((c) => c.id === t1.id && /두께 t 2 → 2\.3 mm/.test(c.title)), 'the thickness line survives reopening');
    const flds = lc.changes.find((c) => c.id === t1.id).field_changes;
    assert(flds.some((x) => /두께 t/.test(x)), 'detail fields lists the field: ' + JSON.stringify(flds));
    const lcUS = await changes({ units: 'US' });
    assert(/두께 t 0\.0787\d* → 0\.0905\d* in/.test(lcUS.changes.find((c) => c.id === t1.id).title), 'US titles: ' + lcUS.changes.find((c) => c.id === t1.id).title);
    notes.push(`project: 「${t1.title} · AI」 (reason · work · source) survives reopening; last_change Lb by ai`);

    // ── 편집 상태: 사람 묶음 하나, 되돌리기도 새 묶음 ──
    let n0 = (await changes({ limit: 100 })).total;
    await page('editSession', { state: 'start' });
    await page('caseEdit', { origin: 'user', changes: { Lb: 100 } });
    await page('caseEdit', { origin: 'user', changes: { Cb: 1.5 } });
    await page('editSession', { state: 'end' });
    lc = await changes({ limit: 100 });
    assert.strictEqual(lc.total, n0 + 1, 'one edit session = one bundle');
    assert(lc.changes[0].by.kind === 'person' && lc.changes[0].fields === 2 && lc.changes[0].trigger === 'edit-session', 'person bundle: ' + JSON.stringify(lc.changes[0]));
    await page('editSession', { state: 'start' });
    await page('caseEdit', { origin: 'user', changes: { Lb: 3000 / 25.4 } });
    await page('editSession', { state: 'end' });
    lc = await changes({ limit: 100 });
    assert(lc.total === n0 + 2 && lc.changes[0].by.kind === 'person' && lc.changes[0].fields === 1, 'the undo is a new bundle');
    notes.push('edit session: one person bundle, the undo another');

    // ── 다른 행위자가 끼면 닫는다 ──
    n0 = lc.total;
    await page('editSession', { state: 'start' });
    await page('caseEdit', { origin: 'user', changes: { Cb: 1.1 } });
    // 묻기만 하는 요청(바뀐 것 없음)은 끼어듦이 아니다 — 사람의 묶음은 그대로
    await tool('get_case_inputs', { keys: ['Cb'] });
    await tool('get_status', {});
    assert.strictEqual(p.__testChanges().pending, 'session', 'a read-only MCP request leaves the edit session open');
    assert.strictEqual((await changes({ limit: 100 })).total, n0, 'and writes no line');
    await tool('set_case_inputs', { inputs: { Cb: 1.25 } });
    await page('caseEdit', { origin: 'user', changes: { Cb: 1.3 } });
    await page('editSession', { state: 'end' });
    lc = await changes({ limit: 100 });
    assert.deepStrictEqual(lc.changes.slice(0, 3).map((c) => c.by.kind), ['person', 'ai', 'person'], 'an AI call inside an edit session splits it: ' + JSON.stringify(lc.changes.slice(0, 3)));
    notes.push('read-only MCP requests leave the edit session open; an AI change inside it splits it (person · ai · person)');

    // ── 편집 상태 밖: 조용한 2 초 ──
    n0 = lc.total;
    await page('caseEdit', { origin: 'user', changes: { Cb: 1.0 } });
    await page('caseEdit', { origin: 'user', changes: { Lb: 120 } });
    // 상태 묻기는 조용한 묶음을 닫지 않는다(R2-2 고침 — 전에는 AI 의 질문마다 한 편집이 여러 줄로 갈렸다)
    await tool('get_status', {});
    await tool('list_changes', { limit: 1 });
    assert.strictEqual(p.__testChanges().pending, 'quiet', 'not yet closed (a status question does not cut in)');
    await sleep(2200);
    assert.strictEqual(p.__testChanges().pending, null, 'closed by 2 s of quiet');
    lc = await changes({ limit: 100 });
    assert(lc.total === n0 + 1 && lc.changes[0].by.kind === 'person' && lc.changes[0].fields === 2, 'two quick edits = one quiet bundle ' + JSON.stringify(lc.changes[0]));
    notes.push('outside an edit session: 2 s of quiet');

    // ── ⚔ 행위자 · 까닭 ──
    n0 = lc.total;
    const r1 = await post('/action', { action: 'set_case_inputs', inputs: { Cb: 1.05 }, actor: { kind: 'person' }, kind: 'person' });
    assert(r1.status === 200 && !r1.json.error, JSON.stringify(r1));
    const r2 = await post('/action', { action: 'set_case_inputs', inputs: { Cb: 1.06 } }, { 'X-StCFSD-Screen': TOKEN });
    const r3 = await post('/action?reason=evil&work=Q-9', { action: 'set_case_inputs', inputs: { Cb: 1.07 } }, { 'X-StCFSD-Request-Id': 'x-1' });
    void r2; void r3;
    lc = await changes({ limit: 100 });
    const last3 = lc.changes.slice(0, 3);
    assert(last3.every((c) => c.by.kind === 'ai'), 'token without request id / with a wrong screen secret / body actor → ai: ' + JSON.stringify(last3));
    assert(!JSON.stringify(lc).includes('evil') && !last3.some((c) => c.work), 'a reason in the query string is ignored');
    const ctl = 'x\u0007y\u202Ez' + '가'.repeat(19995);
    // 까닭의 길이는 한 규칙 — set_case_inputs 도 다른 쓰기 도구처럼 2만 자까지 받아 300 자로 자른다(거절하지 않는다)
    await tool('set_case_inputs', { inputs: { Cb: 1.08 }, reason: ctl });
    lc = await changes({ limit: 1 });
    const rs = lc.changes[0].reason || '';
    assert(lc.changes[0].by.kind === 'ai' && rs.length > 0 && rs.length <= 300 && ![...rs].some((ch) => ch.charCodeAt(0) < 0x20 || ch === '\u202E'),
      'set_case_inputs takes a 20,000-character reason and keeps 300: ' + rs.length);
    await tool('set_material', { E: 29400, v: 0.3, reason: ctl });
    lc = await changes({ limit: 1 });
    const rr = lc.changes[0].reason || '';
    assert(rr.length <= 300 && ![...rr].some((ch) => ch.charCodeAt(0) < 0x20 || ch === '\u202E') &&/^xy?z?/.test(rr), `control characters removed, 20,000 characters cut to 300 (${rr.length}): ${JSON.stringify(rr.slice(0, 20))}`);
    const big = await post('/action', { action: 'set_case_inputs', inputs: { Cb: 1.09 } }, { 'X-StCFSD-Reason': encodeURIComponent('가'.repeat(20000)) });
    lc = await changes({ limit: 100 });
    assert(big.status === 431 || big.status === 0 || (lc.changes[0].reason || '').length <= 300, `a 20,000-character reason header: HTTP ${big.status}, nothing over 300 stored`);
    notes.push(`⚔ token without request id → ai, body actor / wrong screen secret → ai, query reason ignored, control chars + 20,000 chars → ${rr.length} kept (set_case_inputs too: ${rs.length}), raw 20,000-char header → HTTP ${big.status}`);

    // ── 밖에서 바뀐 것 = external ──
    await tool('save_case', {});
    const pdir = fs.realpathSync.native(path.join(root, 'R22'));
    const aFile = path.join(pdir, '02_검토대상', 'A.csd');
    const j = JSON.parse(fs.readFileSync(aFile, 'utf8'));
    j.case.inputs.Cb = 2.0; j.designInputs.Cb = 2.0;
    fs.writeFileSync(aFile, JSON.stringify(j, null, 2));
    await tool('open_case', { name: 'B' });
    await tool('open_case', { name: 'A' });
    lc = await changes({ limit: 5, detail: 'fields' });
    const ext = lc.changes.find((c) => c.by.kind === 'external');
    assert(ext && ext.trigger === 'external' && ext.field_changes.some((x) => /Cb/.test(x)), 'the outside change is one external line: ' + JSON.stringify(lc.changes.slice(0, 2)));
    notes.push(`outside change: 「${ext.title}」 by external`);

    // ── 크기 · 경로 없음 ──
    lc = await changes({ limit: 20 });
    const lcF = await changes({ limit: 20, detail: 'fields' });
    assert(lc.__bytes <= 8 * 1024 && lcF.__bytes <= 24 * 1024, `list_changes ${lc.__bytes} B / fields ${lcF.__bytes} B`);
    assert(!JSON.stringify(lcF).includes(box) && !/[A-Za-z]:\\\\/.test(JSON.stringify(lcF)) && /data, not/.test(lcF.text_note), 'no paths, text labelled as data');
    notes.push(`list_changes ${lc.total} bundles: ${lc.__bytes} B (20), fields ${lcF.__bytes} B`);

    // ── 시간 ──
    const cost = p.__testChanges().cost;
    notes.push(`cost: ${cost.snapshots} snapshots avg ${(cost.snapMs / cost.snapshots).toFixed(2)} ms (max ${cost.snapMax}), ${cost.diffs} diffs avg ${(cost.diffMs / Math.max(1, cost.diffs)).toFixed(2)} ms (max ${cost.diffMax})`);
  } finally {
    try { await client.close(); } catch { /* */ }
    try { bridge.stop(); } catch { /* */ }
    ctx.close();
    S.writerKeyDir = saveKey; S.projectRoots = saveRoots;
    try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`records_changes_contract: PASS (${notes.join('; ')})`);
}
main().catch((e) => { console.error('records_changes_contract: FAIL', e && e.stack ? e.stack : e); process.exitCode = 1; });
