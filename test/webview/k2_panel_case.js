/* global process */
// K2 — 호스트(진짜 StcfsdPanel + 진짜 파이썬, 화면 없이)의 검토 상태 길.
//   node test/webview/k2_panel_case.js
//  - caseEdit → caseAck(판), 검사 실패 · 충돌(baseRev 뒤에 다른 쓰는 이가 바꾼 키)
//  - .csd 1.4: 저장은 상태에서(case + 1.3 모양 designInputs), 열기는 상태로 — 조작된 .csd 의 모르는 키가 상태 · 다음 저장으로 새지 않는다
//  - 두 번째 caseHello(새로 고침)에 상태를 다시 보낸다
//  - 저장 안 한 변경(caseDirty)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPanel } = require('./panel_harness');

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('k2_panel_case: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  // 임시 파일은 이 시험의 출력 폴더에(git 밖 — test/rendered/.gitignore 의 out/)
  const base = path.join(__dirname, '..', 'rendered', 'out', 'k2');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'panel-'));
  const posted = (cmd) => p.__testGetPostedMessages().filter((m) => m.command === cmd);
  try {
    // ── caseEdit · caseAck · 충돌 ─────────────────────────────────────────
    await p.__testDispatchMessage({ command: 'caseHello', data: { inputs: null, drafts: { templateType: 'lippedc' } } });
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: 0, changes: { Lb: 72, wcSupport: 'XYZ' } } });
    let ack = posted('caseAck').pop();
    assert(ack && ack.data.rev === 1, 'rev 1 after one accepted change');
    assert.deepStrictEqual(ack.data.rejected.map((r) => r.key), ['wcSupport'], 'invalid option refused');
    let st = p.__testGetCase().state;
    assert.strictEqual(st.inputs.Lb, 72);
    assert.strictEqual(st.sources.Lb, 'user');
    // 다른 쓰는 이(파일)가 Lb 를 바꾼 뒤, 그것을 보지 못한 화면 변경(baseRev 1)은 Lb 를 덮지 않는다
    // V9b-05: 화면의 caseEdit 는 'file' 이라 말해도 값을 바꾸면 사람의 편집이다 — 다른 쓰는 이는 호스트의 길(AI 의 set_case_inputs)로
    await p.handleMcpAction({ action: 'set_case_inputs', inputs: { Lb: 96 } });
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: 1, changes: { Lb: 80, Cb: 1.2 } } });
    ack = posted('caseAck').pop();
    assert.deepStrictEqual(ack.data.conflicts, ['Lb'], 'conflict reported');
    assert(posted('caseState').length === 1, 'state pushed back to the page after a conflict');
    st = p.__testGetCase().state;
    assert.deepStrictEqual([st.inputs.Lb, st.inputs.Cb], [96, 1.2]);
    // ── V9b-05: 출처는 닫힌 집합, 메아리 출처는 값을 바꾸지 못한다(바꾸면 사람의 편집 — 출처 user) ─────────
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'anything', changes: { Cb: 1.3 } } });
    ack = posted('caseAck').pop();
    assert(ack.data.rejected[0].reason_code === 'host.case.bad_origin' && p.__testGetCase().state.inputs.Cb === 1.2, 'an invented origin is refused');
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'mirror', changes: { Cb: 1.2 * (1 + 1e-13) } } });
    st = p.__testGetCase().state;
    assert.strictEqual(st.sources.Cb, 'user', 'a mirror echo (display rounding) keeps the source');
    await p.handleMcpAction({ action: 'set_case_inputs', inputs: { Cb: 1.27 } });
    assert.strictEqual(p.__testGetCase().state.sources.Cb, 'ai');
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'file', changes: { Cb: 1.4 } } });
    st = p.__testGetCase().state;
    ack = posted('caseAck').pop();
    assert(st.inputs.Cb === 1.27 && st.sources.Cb === 'ai' && ack.data.rejected[0].reason_code === 'host.case.file_outside_window' && posted('caseState').length === 1,
      'a page «file» edit outside the open window is refused, the state re-sent: ' + JSON.stringify([st.inputs.Cb, st.sources.Cb, ack.data]));
    // V9b-08: 편집 상태는 사람의 길로만 — 화면 채널의 editSession 은 아무것도 하지 않는다
    await p.__testDispatchMessage({ command: 'editSession', data: { state: 'start' } });
    assert.strictEqual(p._session, null, 'editSession from the page channel is refused');
    assert(p.editSession('start').ok && p._session, 'the person path (panel.editSession) works');
    p.editSession('end');

    // ── 저장: 1.4, 상태에서 ───────────────────────────────────────────────
    const f1 = path.join(dir, 'a.csd');
    await p.__testWriteProjectFile(f1);
    const j1 = JSON.parse(fs.readFileSync(f1, 'utf8'));
    assert.strictEqual(j1.version, '1.4');
    assert.strictEqual(j1.case.inputs.Lb, 96);
    assert.strictEqual(j1.designInputs.Lb, 96, '1.3-shaped inputs from the state');
    assert.strictEqual(j1.designInputs.fyLoad, j1.designInputs.fy, 'mirrors written with the owner value');
    assert.strictEqual(j1.designInputs.templateType, 'lippedc', 'model keys from the page drafts');

    // ── 조작된 .csd: case · designInputs · 최상위에 남의 키 → 상태 · 다음 저장에 없다 ─────────────
    const evil = { ...j1, mcpServers: { x: { command: 'evil' } }, hooks: { a: 1 } };
    evil.case = { ...j1.case, inputs: { ...j1.case.inputs, mcpServers: { y: 1 }, analysisBC: 'C-C', Lb: 50 }, sources: { ...j1.case.sources, mcpServers: 'ai' } };
    evil.designInputs = { ...j1.designInputs, hooks: 'x', permissions: { allow: ['*'] } };
    const f2 = path.join(dir, 'evil.csd');
    fs.writeFileSync(f2, JSON.stringify(evil));
    p.__testClearPostedMessages();
    const lr = p.__testLoadProjectFile(f2);
    assert(!lr.error, lr.error);
    assert(lr.warnings.some((w) => /mcpServers/.test(w)) && lr.warnings.some((w) => /analysisBC/.test(w)), 'foreign keys named in the warnings');
    st = p.__testGetCase().state;
    assert.strictEqual(st.inputs.Lb, 50, 'the case record is read');
    assert(!('mcpServers' in st.inputs) && !('analysisBC' in st.inputs) && !('mcpServers' in st.sources), 'no foreign key in the state');
    const rst = posted('restoreDesignInputs')[0];
    assert(rst && !('hooks' in rst.data) && !('permissions' in rst.data) && !('mcpServers' in rst.data), 'no foreign key sent to the page');
    const f3 = path.join(dir, 'resaved.csd');
    await p.__testWriteProjectFile(f3);
    const t3 = fs.readFileSync(f3, 'utf8');
    for (const bad of ['mcpServers', 'hooks', 'permissions', 'evil']) { assert(!t3.includes(bad), `${bad} not in the re-saved .csd`); }
    const raw = path.join(dir, 'raw.stcfsd');
    const sr = await p.handleMcpAction({ action: 'save_project', filepath: raw });
    assert(sr && sr.success, JSON.stringify(sr));
    const tr = fs.readFileSync(raw, 'utf8');
    for (const bad of ['mcpServers', 'hooks', 'permissions']) { assert(!tr.includes(bad), `${bad} not in save_project`); }

    // ── 옛 판(1.3, case 없음) 은 designInputs 로 — 거울은 하나(D-3) ────────────────────
    const old = { ...j1, version: '1.3' };
    delete old.case;
    old.designInputs = { ...j1.designInputs, fu: 65, fuPre: 60 };
    const f4 = path.join(dir, 'old13.csd');
    fs.writeFileSync(f4, JSON.stringify(old));
    p.__testClearPostedMessages();
    assert(!p.__testLoadProjectFile(f4).error);
    const r4 = posted('restoreDesignInputs')[0].data;
    assert.deepStrictEqual([r4.fu, r4.fuPre], [65, 65], 'D-3: the page gets one Fu (65) for every tab');

    // ── 새로 고침: 두 번째 caseHello 에 상태를 다시 ─────────────────────────────────
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseHello', data: { inputs: null, drafts: {} } });
    const cs = posted('caseState');
    assert(cs.length === 1 && cs[0].data.designInputs.fu === 65, 'state pushed to a reloaded page');

    // ── 저장 안 한 변경 ──────────────────────────────────────────────────────
    const dirtyNow = () => posted('caseDirty').pop();
    p.__testClearPostedMessages();
    assert(!p.__testLoadProjectFile(f1).error);
    assert.strictEqual(dirtyNow().data.dirty, false, 'clean right after open');
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: p.__testGetCase().state.rev, changes: { Cb: 1.3 } } });
    assert.strictEqual(dirtyNow().data.dirty, true, 'dirty after an edit');
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'unit-toggle', changes: { unitSystem: 'US' } } });
    await p.__testWriteProjectFile(path.join(dir, 'b.csd'));
    assert.strictEqual(dirtyNow().data.dirty, false, 'clean after save');
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'unit-toggle', changes: { unitSystem: 'SI' } } });
    assert(!posted('caseDirty').some((m) => m.data.dirty), 'a unit toggle alone is not a change');
    // ── K2-6: 저장 안 한 변경의 물음(독립 창이 닫기 · 다른 파일 열기 전에) ──────────────────────
    p.__testClearPostedMessages();
    assert(!p.__testLoadProjectFile(f1).error);
    let u = await p.handleMcpAction({ action: 'get_unsaved_changes' });
    assert.deepStrictEqual([u.dirty, u.since, u.inputs_changed, u.model_changed, u.file], [false, null, [], false, f1], 'clean after open');
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: p.__testGetCase().state.rev, changes: { Cb: 1.25 } } });
    u = await p.handleMcpAction({ action: 'get_unsaved_changes' });
    assert(u.dirty && typeof u.since === 'string' && u.inputs_changed.includes('Cb'), `dirty with since and keys (${JSON.stringify(u)})`);
    const st0 = p.getStatus();
    assert(st0.case && st0.case.dirty === true && Number.isInteger(st0.case.rev) && st0.case.dirty_since === u.since, 'status carries case.rev / dirty / since');
    // 열기 전에 저장하지 않았으면 — 버린 것을 경고 · 화면 메시지로(묻지 않는다)
    p.__testClearPostedMessages();
    const lw = p.__testLoadProjectFile(f1);
    assert(lw.warnings.some((w) => /Unsaved changes were discarded/.test(w)), 'GUI open: the discarded changes are in the warnings');
    const disc = posted('caseDiscarded')[0];
    assert(disc && disc.data.inputs_changed.includes('Cb') && disc.data.by === 'open_project', 'caseDiscarded posted to the page');
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: p.__testGetCase().state.rev, changes: { Cb: 1.15 } } });   // 파일의 Cb(1.2)와 다른 값
    const mr = await p.handleMcpAction({ action: 'load_project', filepath: f1 });
    assert(mr.success && mr.discarded_unsaved_changes && mr.discarded_unsaved_changes.inputs_changed.includes('Cb'), 'MCP load_project: discarded changes in the reply ' + JSON.stringify(mr).slice(0, 400));
    assert.strictEqual(p.__testGetCase().state.inputs.Cb, j1.case.inputs.Cb, 'load_project of a .csd reads its case record');

    // ── 결정 3: MCP 가 정한 기준응력 — 사람이 ① Fy 를 고치면 풀린다 ─────────────────────────────
    p.__testClearPostedMessages();
    await p.handleMcpAction({ action: 'set_load_case', load_case: 'compression', fy: 50 });
    assert(p._loadFyAi === true && !('loadFySource' in p._model), 'AI reference stress recorded — outside the model (not sent to the engine, not saved)');
    assert.strictEqual(posted('modelLoaded').pop().data.loadFySource, 'ai', 'the page is told the reference stress came from the AI');
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: p.__testGetCase().state.rev, changes: { fy: 45, fyLoad: 45 } } });
    assert(p._loadFyAi === false && posted('caseReference').length === 1, 'released when the person changes Fy');

    // ── D-7: run_analysis 의 neigs 가 화면 칸에(modelLoaded) ─────────────────────────────────
    p.__testClearPostedMessages();
    await p.handleMcpAction({ action: 'run_analysis', neigs: 7 });
    const ml = posted('modelLoaded');
    assert(ml.length >= 1 && ml[0].data.neigs === 7, 'D-7: neigs reaches the page');

    // ── D-6: 두 번째 webviewReady 는 모델을 덮지 않고 다시 보낸다 ───────────────────────────────
    await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedz', params: { H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 } });
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'webviewReady' });
    assert.strictEqual(p._model.sectionTemplate, 'lippedz', 'D-6: the model survives a page reload');
    const cmds = p.__testGetPostedMessages().map((m) => m.command);
    assert(cmds.includes('modelLoaded') && cmds.includes('caseState') && cmds.indexOf('modelLoaded') < cmds.lastIndexOf('caseState'), `re-posted model then state (${cmds.join(',')})`);
    // ── 계약 §6.3(6 번째 멈춤): Lap 도구의 옛 이름 distortion_restrained 도 검토 상태의 키 lapRestrained 에(mcpOnly 가 아니다) — 호스트 본문은 lap_restrained ─────
    {
      const { loadTs, makeFakeVscode } = require('./panel_harness');
      const G = loadTs('src/case/mcpGroups.ts', makeFakeVscode());
      const R = loadTs('src/case/requests.ts', makeFakeVscode());
      const { CaseKeeper } = loadTs('src/case/caseKeeper.ts', makeFakeVscode());
      const k = new CaseKeeper();
      const lapArgs = { action: 'lap_connection', d: 8, t: 0.059, Fy: 50, Fu: 65, lap_left_in: 30, lap_right_in: 30, fastener_dia: 0.19, n_rows: 2, Pnvs: 1.1 };
      k.applyMcp(G.mcpWrite('lap_connection', { ...lapArgs, distortion_restrained: true }));
      const ctxR = { drafts: { tplH: 8, tplT: 0.059 }, lastDesign: null, props: null };
      assert.strictEqual(k.state.inputs.lapRestrained, true, 'the old name writes the case key lapRestrained');
      assert(!k.state.mcpOnly.design_lap_connection || !('distortion_restrained' in k.state.mcpOnly.design_lap_connection), 'not kept as an MCP-only argument');
      const sent = R.buildLapRequest(k.state, ctxR).data;
      assert(sent.lap_restrained === true && !('distortion_restrained' in sent), 'sent with the lap request as lap_restrained');
      k.applyMcp(G.mcpWrite('lap_connection', lapArgs));
      assert(!('lap_restrained' in R.buildLapRequest(k.state, ctxR).data), 'a later design_lap_connection without it clears it (decision 1)');
    }
  } finally {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('k2_panel_case: PASS');
}

main().then(() => process.exit(0)).catch((e) => { console.error('k2_panel_case: FAIL', e); process.exit(1); });
