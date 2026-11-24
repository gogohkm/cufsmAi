/* global process, Buffer */
// 결정 D1 · D8(업무 탭 통일 단계 B) — MCP 설계 도구는 받은 인자의 키만 검토 상태에 합치고, 화면 단추와 같은 본문으로 계산한다.
// 진짜 패널 · 파이썬 · MCP 다리(포트 파일 + 토큰) · 진짜 MCP 서버(소스) — 응답은 server.ts 의 요약 · 단위 변환을 지난 그대로 본다.
//   node test/webview/mcp_case_merge_contract.js
//  ① 검증 문서 4.2 의 재현: 사람이 정한 wcN · wcR · wcSupport · chkBetaDist · designCbPos(+ 냉간가공)가 aisi_design_flexure(Fy, Lb, Cb, Mu, Vu)
//     뒤에 그대로이고, 그 호출의 변경 묶음에는 실제로 바뀐 칸만(같은 값을 다시 주면 줄이 없다)
//  ② 그 호출의 엔진 요청 = 그 뒤 run_case_check member 의 엔진 요청(바이트까지). 화면 칸이 없는 인자는 그 호출에만 얹힌다
//  ③ design_purlin(loads {D, S}) — 묶음째: 다른 하중 성분에 화면의 값(사람이 넣은 Lr · Wu)을 섞지 않는다
//  ④ 사람이 정한 값을 덮으면 case_inputs_replaced, 주지 않아 상태에서 온 값은 case_inputs_used(출처 · SI 변환)
//  ⑤ 읽기 전용 대상(계산은 하되 쓰지 않는다) · 필수 칸이 비면 엔진을 돌리지 않고 그 칸을 말한다
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPanel } = require('./panel_harness');
const { transpileMcp } = require('./mcp_transpile');

const ROOT = path.join(__dirname, '..', '..');
const TOKEN = crypto.randomBytes(32).toString('hex');
const notes = [];

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('mcp_case_merge_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_d1_'));
  const { McpBridgeServer } = ctx.load(path.join('src', 'mcp', 'bridge.ts'));
  const portFile = path.join(box, 'mcp', 'stcfsd-mcp-port');
  const bridge = new McpBridgeServer(() => p, 0, { portFile, token: TOKEN });
  await bridge.start();
  const mdir = path.join(box, 'mcpjs');
  transpileMcp(mdir, ['server', 'siUnits', 'bridge', 'portFile', 'hostConnection']);
  const { Client } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'index.js'));
  const { StdioClientTransport } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'stdio.js'));
  const env = { ...process.env, STCFSD_MCP_PORT_FILE: portFile, STCFSD_MCP_STANDALONE: '1', NODE_PATH: path.join(ROOT, 'node_modules') };
  delete env.STCFSD_MCP_PORT;
  const client = new Client({ name: 'd1-test', version: '1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(mdir, 'server.js')], env, stderr: 'pipe' }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content && r.content[0] && r.content[0].text) || '';
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { isError: !!r.isError, data, bytes: Buffer.byteLength(text), text };
  };
  const tool = async (name, args) => {
    const r = await call(name, args);
    if (r.isError) { throw new Error(`${name}: ${r.text.slice(0, 400)}`); }
    return r;
  };
  // 엔진 요청(파이썬으로 가는 것) — 설계 함수만 적는다
  const engine = [];
  const realCall = p._pythonBridge.call.bind(p._pythonBridge);
  p._pythonBridge.call = (method, params) => {
    if (['aisi_design', 'analyze_loads', 'design_connection', 'lap_connection'].includes(method)) { engine.push({ method, params: JSON.stringify(params) }); }
    return realCall(method, params);
  };
  const st = () => p.__testGetCase().state;
  const lines = () => p._changeLines().lines;
  const page = (command, data) => p.__testDispatchMessage({ command, data });
  try {
    await tool('set_section_template', { type: 'lippedc', H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 });
    await tool('set_load_case', { load_case: 'bending_xx_pos', fy: 50 });
    await tool('run_analysis', {});

    // ── ① 사람이 정한 칸(검증 문서의 wcN · wcR · wcSupport · chkBetaDist · designCbPos 와 냉간가공) ──────────────────
    const person = { wcN: 3.0, wcR: 0.15, wcSupport: 'IOF', chkBetaDist: true, distM1M2: -0.5, distLm: 24, designCbPos: 1.2, chkColdWork: true, Lb: 80, Cb: 1.3 };
    // 체크 칸의 처음 값이 켬이다 — 사람이 끄고 다시 켠 것으로(출처 user)
    await page('caseEdit', { origin: 'user', baseRev: st().rev, changes: { chkBetaDist: false, chkColdWork: false } });
    await page('caseEdit', { origin: 'user', baseRev: st().rev, changes: person });
    p._changes.flush();
    for (const [k, v] of Object.entries(person)) { assert(st().inputs[k] === v && st().sources[k] === 'user', `person set ${k}`); }
    const lines0 = lines().length;
    const e0 = engine.length;
    const fl = await tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Lb: 60, Cb: 1.14, Mu: 30, Vu: 1, reason: '검증 문서 4.2 재현' });
    const fl1 = engine.slice(e0);
    assert.strictEqual(fl1.length, 1, 'one engine design request');
    for (const k of ['wcN', 'wcR', 'wcSupport', 'chkBetaDist', 'distM1M2', 'distLm', 'designCbPos', 'chkColdWork']) {
      assert(st().inputs[k] === person[k] && st().sources[k] === 'user', `${k} kept (the person's value): ${JSON.stringify([st().inputs[k], st().sources[k]])}`);
    }
    assert.deepStrictEqual([st().inputs.Lb, st().inputs.Cb, st().inputs.Mux, st().inputs.Vu, st().inputs.memberType], [60, 1.14, 30, 1, 'flexure'], 'the given keys are written');
    p._changes.flush();
    const mine = lines().slice(lines0);
    // 결정 D4(단계 C): 한 호출 = AI 의 묶음 하나 + Fy 를 따른 접합 Fy 의 program 줄(trigger mirror, 바로 뒤)
    assert.strictEqual(mine.length, 2, 'one call = one AI bundle + the program line of the followed field');
    assert.deepStrictEqual([mine[0].actor.kind, mine[1].actor.kind, mine[1].body.trigger, mine[1].body.fields.map((f) => f.path).join()], ['ai', 'program', 'mirror', 'case.inputs.connFy'],
      'connFy (following Fy) is the program\'s line right after the AI one');
    const changed = mine.flatMap((l) => l.body.fields.map((f) => f.path)).sort();
    const expectChanged = ['case.inputs.Cb', 'case.inputs.Lb', 'case.inputs.Mux', 'case.inputs.Vu', 'case.inputs.connFy', 'case.inputs.fy', 'case.inputs.memberType'];
    assert.deepStrictEqual(changed, expectChanged, 'only the fields that really changed: ' + JSON.stringify(changed));
    assert.deepStrictEqual([...fl.data.case_inputs_written].sort(), ['Cb', 'Lb', 'Mux', 'Vu', 'connFy', 'fy', 'memberType'], 'case_inputs_written = the changed keys');
    notes.push(`① flexure(Fy, Lb, Cb, Mu, Vu): ${changed.length} fields changed (${changed.map((x) => x.replace('case.inputs.', '')).join(', ')}), the person's wc / β / Cb(+) / cold work kept`);
    // 같은 값을 다시(1.14 · 60.0 · 30 — 수의 꼴만 다른 것도) — 바뀐 것이 없다 → 줄이 없다
    const lines1 = lines().length;
    const again = await tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50.0, Lb: 60.0, Cb: 1.14, Mu: 30.0, Vu: 1.0 });
    p._changes.flush();
    assert.strictEqual(lines().length, lines1, 'the same values again write no change line');
    assert.deepStrictEqual(again.data.case_inputs_written, [], 'and case_inputs_written is empty');
    notes.push('same values again (60.0 · 1.0): no change line, case_inputs_written []');

    // ── ④ 덮은 사람의 값 · 상태에서 온 값 ─────────────────────────────────────────
    const rep = (fl.data.case_inputs_replaced || []).map((x) => [x.key, x.previous, x.previous_source]).sort();
    assert.deepStrictEqual(rep, [['Cb', 1.3, 'user'], ['Lb', 80, 'user']], 'case_inputs_replaced: the person values replaced ' + JSON.stringify(rep));
    const used = Object.fromEntries((fl.data.case_inputs_used || []).map((u) => [u.key, u]));
    for (const k of ['wcN', 'wcR', 'wcSupport', 'chkBetaDist', 'distM1M2', 'distLm', 'designCbPos', 'chkColdWork']) {
      assert(used[k] && used[k].value === person[k] && used[k].source === 'user', `case_inputs_used names ${k} with its source: ${JSON.stringify(used[k])}`);
    }
    assert(used.fu && used.fu.source === 'default' && used.designMethod === undefined && used.Lb === undefined, 'defaults are named as default; given keys are not listed');
    assert(used.wcN.unit_kind === 'length' && fl.data.units === 'US' && !('unit_kind' in used.wcSupport), 'unit kind with a value that has one (the reply units say US)');
    // 화면 단추가 보내지 않는 값은 「쓴 값」 이 아니다(0 이하의 wcLo · 끈 진술 · wcFamily auto)
    assert(!used.wcLo && !used.designZeroDemandStated && !used.chkRFactor && !used.wcFamily, 'values the request does not carry are not listed');
    assert(!fl.data.case_args_not_on_screen, 'no MCP-only argument in this call');
    assert(typeof fl.data.case_inputs_used_note === 'string', 'the note says where they came from');
    const usedBytes = Buffer.byteLength(JSON.stringify(fl.data.case_inputs_used));
    assert(fl.data.case_inputs_used.length <= 30 && usedBytes < 2000, `a small list: ${fl.data.case_inputs_used.length} values, ${usedBytes} B`);
    const flSI = await tool('aisi_design_flexure', { units: 'SI', design_method: 'LRFD', Fy: 344.7378646, Lb: 1524, Cb: 1.14, Mu: 3.3895, Vu: 4.448 });
    const wcSI = flSI.data.case_inputs_used.find((u) => u.key === 'wcN');
    assert(wcSI && Math.abs(wcSI.value - 3.0 * 25.4) < 1e-9 && flSI.data.units === 'SI', `SI: the used value in mm (${JSON.stringify(wcSI)})`);
    notes.push(`④ replaced [Lb 80 user, Cb 1.3 user]; case_inputs_used ${fl.data.case_inputs_used.length} values (${usedBytes} B), SI wcN ${wcSI.value} mm; reply ${fl.bytes} B (US summary)`);
    console.log('  case_inputs_used (US) =', JSON.stringify(fl.data.case_inputs_used));
    console.log('  case_inputs_replaced (US) =', JSON.stringify(fl.data.case_inputs_replaced));

    // ── ② 그 호출의 엔진 요청 = 화면 단추(run_case_check member)의 엔진 요청 ─────────────────────────
    // 같은 상태로 돌리려고 위 SI 호출의 값을 US 로 되돌린다(같은 값을 준다)
    await tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Lb: 60, Cb: 1.14, Mu: 30, Vu: 1 });
    const e1 = engine.length;
    await tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Lb: 60, Cb: 1.14, Mu: 30, Vu: 1 });
    const aiReq = engine[e1];
    const e2 = engine.length;
    const rc = await tool('run_case_check', { what: 'member' });
    const btnReq = engine[e2];
    assert(rc.data.case_check && rc.data.case_check.tool === 'aisi_design_flexure', 'run_case_check member ran the flexure check');
    assert.strictEqual(aiReq.params, btnReq.params, 'the AI call and the screen button send the same engine request, byte for byte');
    const sent = JSON.parse(aiReq.params);
    assert(sent.use_cold_work === true && sent.wc_N === 3 && sent.wc_support === 'IOF' && sent.dist_Lm === 24 && sent.Cb_pos === 1.2, 'the person values are in it');
    notes.push(`② flexure engine request = run_case_check member request (${aiReq.params.length} B, byte for byte): use_cold_work true, wc_N 3, wc_support IOF, dist_Lm 24, Cb_pos 1.2`);
    // 화면 칸이 없는 인자는 그 호출에만
    const e3 = engine.length;
    const ms = await tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Lb: 60, Cb: 1.14, Mu: 30, Vu: 1, moment_sign: '+', check_combination: '1.2D+1.6Lr' });
    const withOnly = JSON.parse(engine[e3].params);
    assert(withOnly.moment_sign === '+' && withOnly.check_combination === '1.2D+1.6Lr', 'the MCP-only argument and the label ride on this call');
    const { moment_sign: _m, check_combination: _c, ...restOnly } = withOnly; void _m; void _c;
    assert.strictEqual(JSON.stringify(restOnly), btnReq.params, 'everything else is the screen request');
    assert.deepStrictEqual(ms.data.case_args_not_on_screen, ['moment_sign'], 'the reply names the argument that has no screen field');
    assert.deepStrictEqual(st().mcpOnly.aisi_design_flexure, { moment_sign: '+' }, 'kept as mcpOnly of the tool (not the label)');
    notes.push('MCP-only moment_sign + check_combination ride on that call only; case_args_not_on_screen [moment_sign]');
    // 이 동안 화면 단추도 같은 것을 — 사람이 냉간가공을 끄면 둘 다 끈다(검증 문서: 화면 true · AI false 가 갈렸다)
    await page('caseEdit', { origin: 'user', baseRev: st().rev, changes: { chkColdWork: false } });
    const e4 = engine.length;
    await tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Lb: 60, Cb: 1.14, Mu: 30, Vu: 1 });
    assert.strictEqual(JSON.parse(engine[e4].params).use_cold_work, false, 'the AI call follows the screen check box');

    // ── ③ design_purlin(loads {D, S}) — 묶음째 ───────────────────────────────────────────
    await page('caseEdit', { origin: 'user', baseRev: st().rev, changes: { memberType: 'roof-purlin', spacing: 5, loadLr: 20, loadWu: 30, loadD: 2 } });
    const e5 = engine.length;
    const pu = await tool('design_purlin', { member_app: 'roof-purlin', span_type: 'simple', span_ft: 20, spacing_ft: 5, loads: { D: 50, S: 100 },
      design_method: 'LRFD', Fy: 50, Fu: 65, wc_N: 3.5, wc_R: 0.1875 });
    const la = engine.slice(e5).find((x) => x.method === 'analyze_loads');
    assert(la, 'the purlin chain ran a load analysis');
    const loadsSent = JSON.parse(la.params).loads;
    assert.deepStrictEqual(loadsSent, { D: 50, Lr: 0, S: 100, W: 0, Wp: 0, L: 0 }, 'only the given D · S — the screen Lr 20 / Wu 30 not mixed in: ' + JSON.stringify(loadsSent));
    assert.deepStrictEqual([st().inputs.loadD, st().inputs.loadS, st().inputs.loadLr, st().inputs.loadWu, st().sources.loadLr], [10, 20, null, null, 'ai'], 'the bundle is written whole (left-out components blank)');
    const repP = (pu.data.case_inputs_replaced || []).map((x) => x.key).sort();
    assert(repP.includes('loadLr') && repP.includes('loadWu') && repP.includes('loadD'), 'the person loads it blanked are reported: ' + repP.join(', '));
    notes.push(`③ design_purlin loads {D 50, S 100} → engine loads ${JSON.stringify(loadsSent)}; the person Lr 20 / Wu 30 psf replaced (reported), not mixed`);

    // ── ⑤ 필수 칸이 비면 엔진을 돌리지 않는다 ───────────────────────────────────────────
    await tool('set_case_inputs', { inputs: { spacing: null } });
    const rev5 = st().rev;
    const e6 = engine.length;
    const miss = await call('analyze_loads', { member_app: 'roof-purlin', span_type: 'simple', span_ft: 20, loads: { D: 50 }, Fy: 50 });
    assert(miss.isError && /required inputs are blank/.test(miss.data.error) && /spacing/.test(miss.data.error) && /set_case_inputs/.test(miss.data.error), 'the blank input is named: ' + miss.text.slice(0, 300));
    assert.deepStrictEqual(miss.data.missing_inputs, ['spacing'], 'missing_inputs');
    assert(engine.length === e6 && st().rev === rev5, 'nothing computed, nothing written');
    notes.push(`⑤ blank spacing: «${miss.data.error.slice(0, 90)}…», no engine call, rev unchanged`);
    // 읽기 전용: 계산은 「상태 ⊕ 받은 인자」, 상태는 그대로, 알림
    const fake = path.join(box, 'ro.csd');
    p._casePath = fake; p._recordsRO = { path: path.resolve(fake), reason: 'issued-copy', lock: null };
    const rev6 = st().rev;
    const e7 = engine.length;
    const ro = await tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Lb: 33, Cb: 1.0, Mu: 20 });
    const roReq = JSON.parse(engine[e7].params);
    assert(roReq.Lb === 33 && roReq.wc_N === st().inputs.wcN && st().inputs.wcN === 3.5, 'computed from the state merged with the arguments');
    assert(st().rev === rev6 && st().inputs.Lb === 60, 'the state is not written');
    assert(ro.data.case_inputs_not_written && ro.data.case_inputs_not_written[0].arg === '*' && !('case_rev' in ro.data), 'and the reply says so');
    assert(ro.data.case_inputs_used.some((u) => u.key === 'wcN'), 'the used values are named there too');
    p._recordsRO = null; p._casePath = null;
    notes.push('⑤ read-only: computed (Lb 33 + state), state unchanged, case_inputs_not_written [*]');
    console.log(`mcp_case_merge_contract: PASS (${notes.length} notes)\n  - ${notes.join('\n  - ')}`);
  } finally {
    try { await client.close(); } catch { /* */ }
    try { bridge.stop(); } catch { /* */ }
    ctx.close();
    fs.rmSync(box, { recursive: true, force: true });
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error('mcp_case_merge_contract: FAIL', e); process.exit(1); });
