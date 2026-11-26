/* global process, Buffer */
// 통일안 6.3 – 6.6(결정 D2 · D3 · D4 · D6) — 진짜 패널 · 파이썬 · MCP 다리 · 진짜 MCP 서버(소스).
//  ① 행위자: 끼운 화면의 연동만의 줄 = program(trigger mirror), AI 설계 호출의 묶음에서 Fy 를 따른 접합 Fy 는 program 의 줄로 갈린다(AI 줄 바로 뒤)
//  ② 같은 요청이 남긴 실행: AI 설계 호출의 묶음에 runs = 그 실행 id, 그 뒤 work_status.calc = match(changes_since_run 0)
//  ③ work_status · work_log(summary · fields · actor · since) · show(= focus) 의 꼴, 프로젝트 밖
//  ④ 실행 이력의 no · auto, AI 의 run_analysis 뒤 자동 준비(design_dsm)의 행위자 = ai
//   node test/webview/records_worklog_contract.js        (WL_PRINT=1 이면 응답 예를 찍는다)
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
const show = (label, v) => { if (process.env.WL_PRINT) { console.log(`--- ${label} (${Buffer.byteLength(JSON.stringify(v))} B)\n${JSON.stringify(v, null, 1)}`); } };

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('records_worklog_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const S = ctx.StcfsdPanel;
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_wl_'));
  const root = path.join(box, 'roots'); fs.mkdirSync(root);
  const saveKey = S.writerKeyDir; const saveRoots = S.projectRoots;
  S.writerKeyDir = path.join(box, 'key'); S.projectRoots = [root];
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
  const client = new Client({ name: 'wl-test', version: '1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(mdir, 'server.js')], env, stderr: 'pipe' }));
  const tool = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content && r.content[0] && r.content[0].text) || '';
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (r.isError) { throw new Error(`${name}: ${text.slice(0, 300)}`); }
    return Object.defineProperty(data, '__bytes', { value: Buffer.byteLength(text), enumerable: false });
  };
  const page = (command, data) => p.__testDispatchMessage({ command, data });
  try {
    // ── 도구 목록: 새 이름 셋, 있는 이름은 그대로 ──
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ['work_status', 'work_log', 'show', 'get_case_status', 'list_changes', 'focus']) { assert(names.includes(n), n); }

    // ── 프로젝트 밖 ──
    await tool('set_section_template', { type: 'lippedc', H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 });
    const ws0 = await tool('work_status', {});
    assert(ws0.in_project === false && ws0.session_changes.persisted === false && ws0.session_changes.count >= 1 && ws0.todo === null && /outside a project/.test(ws0.note), JSON.stringify(ws0));
    const wl0 = await tool('work_log', {});
    assert(wl0.persisted === false && wl0.entries.every((e) => e.type === 'change') && /runs are recorded only/.test(wl0.note), JSON.stringify(wl0).slice(0, 400));
    show('work_status outside', ws0); show('work_log outside', wl0);
    notes.push(`outside: work_status session_changes ${ws0.session_changes.count}, work_log ${wl0.total} changes, no runs (${ws0.__bytes} B / ${wl0.__bytes} B)`);

    // ── 프로젝트 · 대상 ──
    await tool('open_project', { name: 'WL', create: true });
    await tool('new_case', { name: 'C', kind: 'section-only', from: 'current' });
    // B4(2026-11-25): new_case 가 부재 종류로 정한 부재 유형의 출처 = 대상을 만든 이(AI 의 도구 → ai, 사람의 길 → user)
    {
      await tool('new_case', { name: 'G', kind: 'wall-girt' });
      await p.handleMcpAction({ action: 'new_case', name: 'J', kind: 'floor-joist' });
      const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) { walk(q); } else if (/\.csd$/.test(e.name)) { files.push(q); } } }; walk(root);
      const rec = (n) => { const f = files.find((x) => path.basename(x).startsWith(n)); assert(f, `case file ${n}: ${files.map((x) => path.basename(x))}`); return JSON.parse(fs.readFileSync(f, 'utf8')).case; };
      const g = rec('G'), j = rec('J');
      assert(g.inputs.memberType === 'wall-girt' && g.sources.memberType === 'ai', 'AI new_case: member type source ai ' + JSON.stringify([g.inputs.memberType, g.sources.memberType]));
      assert(j.inputs.memberType === 'floor-joist' && j.sources.memberType === 'user', 'person new_case: member type source user ' + JSON.stringify([j.inputs.memberType, j.sources.memberType]));
      notes.push(`new_case member type source: ai (tool) · user (person path)`);
    }
    await tool('open_case', { name: 'C' });
    // 끼운 화면이 연 파일의 값을 다시 적어 알린 메아리(origin file) — 여는 창이 닫힌다(그 뒤의 연동이 값을 바꾼다)
    await page('caseEdit', { origin: 'file', changes: {} });
    await tool('set_load_case', { load_case: 'bending_xx_pos', fy: 50 });
    await tool('run_analysis', {});
    // 끼운 화면의 자동 준비(사람의 문맥에서 오는 메시지) — 그 실행의 행위자는 해석을 부른 쪽(ai)
    await page('prepareDesignDsm', { member_type: 'flexure', Fy: 50 });
    let cs = await tool('get_case_status', { detail: 'runs' });
    const dsmRun = cs.history.find((h) => h.kind === 'design_dsm');
    assert(dsmRun && dsmRun.by === 'ai' && dsmRun.auto === true, 'design_dsm after an AI run_analysis: by ai, auto: ' + JSON.stringify(cs.history));
    assert.deepStrictEqual(cs.history.map((h) => h.no), cs.history.map((_, i) => cs.history.length - i), 'no counts 1.. in time order');
    assert(cs.history.filter((h) => h.kind !== 'design_dsm').every((h) => !('auto' in h)), 'auto only on design_dsm');

    // ① 끼운 화면의 연동만의 줄 = program
    await page('caseEdit', { origin: 'mirror', seenRev: p.__testGetCase().state.rev, changes: { connFy: 45 } });
    let lc = await tool('list_changes', {});
    assert(lc.changes[0].by.kind === 'program' && lc.changes[0].trigger === 'mirror', 'the linkage-only line is the program\'s: ' + JSON.stringify(lc.changes[0]));

    // ①② AI 의 설계 호출 하나 — Fy 를 따른 접합 Fy 는 program 의 줄, 두 줄 다 그 실행을 안다
    const fl = await tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 55, Lb: 60, Cb: 1.14, Mu: 30, Vu: 1, reason: 'Fy 55 로 다시 검토' });
    assert(!fl.error, JSON.stringify(fl).slice(0, 300));
    cs = await tool('get_case_status', { detail: 'runs' });
    const memberRun = cs.history.find((h) => h.kind === 'member_design');
    lc = await tool('list_changes', { detail: 'fields' });
    const [prog, aiLine] = lc.changes;
    assert(aiLine.by.kind === 'ai' && aiLine.reason === 'Fy 55 로 다시 검토' && !aiLine.field_changes.some((f) => f.key === 'connFy') && aiLine.field_changes.some((f) => f.key === 'fy'),
      'the AI line has fy but not connFy: ' + JSON.stringify(aiLine));
    assert(prog.by.kind === 'program' && prog.trigger === 'mirror' && prog.field_changes.length === 1 && prog.field_changes[0].key === 'connFy' && !prog.reason,
      'connFy follows fy on a program line right after it: ' + JSON.stringify(prog));
    // 그 실행의 기록은 그 계산에 쓴(합친 뒤의) 검토 상태를 담는다 — 합치기 전의 상태가 아니다(대안 · 확인 표시 · 발행 점검이 읽는다)
    const FP = ctx.load(path.join('src', 'records', 'fp.ts'));
    const runRec = p._desk.runsOf().find((r) => r.runId === memberRun.run);
    const snapRun = p._desk.readSnapshot(runRec.snapshot);
    assert(snapRun && snapRun.case.inputs.Lb === 60 && snapRun.case.inputs.fy === 55, 'the run copy has the merged Lb 60 · Fy 55: ' + JSON.stringify(snapRun && { Lb: snapRun.case.inputs.Lb, fy: snapRun.case.inputs.fy }));
    assert.strictEqual(runRec.caseFp, FP.contentFp(p._model, p.__testGetCase().state).caseFp, 'the run caseFp = the case after the call');
    // 결정 R1(2026-11-25 H-A): 그 요청의 부재 검토가 설계용 FSM 값(Fy 55)을 그 자리에서 준비했다 — 그 design_dsm 실행도 같은 묶음에
    const prepRun = cs.history.find((h) => h.kind === 'design_dsm' && h.no === memberRun.no - 1);
    const reqRuns = prepRun ? [prepRun.run, memberRun.run] : [memberRun.run];
    assert(prepRun && prepRun.by === 'ai', 'the prepare run of this request, by ai: ' + JSON.stringify(cs.history.slice(0, 3)));
    assert.deepStrictEqual(aiLine.runs, reqRuns, 'the AI bundle knows the runs of its request (prepare + member check)');
    assert.deepStrictEqual(prog.runs, reqRuns, 'and so does the split program line');
    notes.push(`AI design call: 「${aiLine.title}」 by ai + 「${prog.title}」 by program, runs → ${memberRun.run.slice(0, 12)}…`);

    // ③ work_status: 계산 직후 = match
    let ws = await tool('work_status', {});
    assert(ws.calc.state === 'match' && ws.calc.changes_since_run === 0, 'right after the design call: ' + JSON.stringify(ws.calc));
    assert(ws.last_run.kind === 'member_design' && ws.last_run.by === 'ai' && ws.last_run.no === memberRun.no && ['ok', 'ng', 'incomplete'].includes(ws.last_run.verdict.status), JSON.stringify(ws.last_run));
    assert(ws.todo.unacknowledged_ai_changes >= 2 && typeof ws.todo.questions === 'number' && typeof ws.todo.provisional_assumptions === 'number', JSON.stringify(ws.todo));
    assert(ws.case.name === 'C' && 'results' in ws && 'records' in ws, 'everything of get_case_status is there');
    // B4: 종류별 일치 — 부재 검토 · 좌굴 해석 둘 다 지금 것
    assert(ws.calc_by_kind && ws.calc_by_kind.member_design.state === 'current' && ws.calc_by_kind.member_design.changes === 0
      && ws.calc_by_kind.buckling_analysis.state === 'current', 'calc_by_kind right after the design call: ' + JSON.stringify(ws.calc_by_kind));
    show('work_status', ws);

    // work_log summary · fields
    const wl = await tool('work_log', {});
    const e0 = wl.entries[0];
    assert(e0.type === 'run' && e0.id === memberRun.run && e0.no === memberRun.no && e0.changes.includes(aiLine.id) && e0.changes.includes(prog.id), 'the run lists the bundles that went into it: ' + JSON.stringify(e0));
    const wAi = wl.entries.find((e) => e.id === aiLine.id);
    assert(wAi.type === 'change' && wAi.actor.kind === 'ai' && wAi.actor.trigger === 'aisi_design' && typeof wAi.fields === 'number' && wAi.ack === null
      && wAi.verdict_delta.after === e0.verdict.ratio && Array.isArray(wAi.invalidated) && /data, not/.test(wl.text_note), JSON.stringify(wAi));
    const wDsm = wl.entries.find((e) => e.type === 'run' && e.kind === 'design_dsm');
    assert(wDsm && wDsm.auto === true && wDsm.actor.kind === 'ai' && wDsm.verdict === null, JSON.stringify(wDsm));
    show('work_log summary', wl);
    const wf = await tool('work_log', { detail: 'fields', limit: 5 });
    const fAi = wf.entries.find((e) => e.id === aiLine.id);
    const fy = fAi.fields.find((f) => f.path === 'case.inputs.fy');
    assert(fy && typeof fy.label === 'string' && fy.unit === 'MPa' && / → /.test(fy.display) && Math.abs(fy.to - 55 * 6.894757293168361) < 1e-6, JSON.stringify(fy));
    show('work_log fields', wf);
    const wp = await tool('work_log', { actor: 'program' });
    assert(wp.entries.length >= 2 && wp.entries.every((e) => e.actor.kind === 'program'), JSON.stringify(wp.entries.map((e) => e.actor)));
    const ws2 = await tool('work_log', { since: aiLine.id });
    assert(ws2.entries.every((e) => e.id !== aiLine.id) && ws2.entries.some((e) => e.id === prog.id), 'since = an id: newer ones only');
    assert(!JSON.stringify(wf).includes(box), 'no paths');
    notes.push(`work_log ${wl.total} entries: summary ${wl.__bytes} B (20), fields ${wf.__bytes} B (5)`);

    // 사람이 그 뒤 바꾸면 changed
    await tool('set_case_inputs', { inputs: { Lb: 70 } });
    ws = await tool('work_status', {});
    assert(ws.calc.state === 'changed' && ws.calc.changes_since_run === 1, JSON.stringify(ws.calc));
    // B4: Lb 는 부재 검토만 낡게 한다 — 좌굴 해석은 지금 것(work_status 하나로 가린다)
    assert(ws.calc_by_kind.member_design.state === 'stale' && typeof ws.calc_by_kind.member_design.why === 'string' && ws.calc_by_kind.member_design.changes >= 1
      && ws.calc_by_kind.buckling_analysis.state === 'current', 'calc_by_kind after Lb: ' + JSON.stringify(ws.calc_by_kind));
    notes.push(`calc_by_kind after Lb: ${JSON.stringify(ws.calc_by_kind)}`);
    // 연동만의 줄은 세지 않는다
    await page('caseEdit', { origin: 'mirror', seenRev: p.__testGetCase().state.rev, changes: { connFy: 40 } });
    ws = await tool('work_status', {});
    assert.strictEqual(ws.calc.changes_since_run, 1, 'program lines are not counted');
    notes.push(`work_status ${ws.__bytes} B: calc match right after the AI call, then changed 1 (a program line not counted)`);

    // show = focus
    const a = await tool('focus', { item: { kind: 'model', id: 'section' }, reason: 'look' });
    const b = await tool('show', { item: { kind: 'model', id: 'section' }, reason: 'look' });
    assert.deepStrictEqual(Object.keys(b).sort(), Object.keys(a).sort(), 'show answers like focus');
    show('show', b);
    notes.push(`show = focus (${b.__bytes} B)`);
  } finally {
    try { await client.close(); } catch { /* */ }
    try { bridge.stop(); } catch { /* */ }
    ctx.close();
    S.writerKeyDir = saveKey; S.projectRoots = saveRoots;
    try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`records_worklog_contract: PASS (${notes.join('; ')})`);
}
main().catch((e) => { console.error('records_worklog_contract: FAIL', e && e.stack ? e.stack : e); process.exitCode = 1; });
