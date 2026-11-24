/* global process, setTimeout */
// V7 검증의 검토 상태 결함(호스트 쪽) — 진짜 StcfsdPanel + 진짜 파이썬, 화면 없이.
//   node test/webview/case_guards_contract.js
//  V7-06 set_case_inputs 가 덮은 사람의 값(이전 값 · 출처)을 응답에 싣는다(US · SI)
//  V7-07 연 파일의 출처 꼬리표를 그대로 믿지 않는다 — 처음 값과 다른 값을 default · ai 로 적었으면 file, 설계 도구가 덮으면 알린다
//  V7-08 파일을 연 판보다 오래된 판을 본 화면의 변경은 키와 무관하게 받지 않는다(같은 'user' 출처여도)
//  V7-S1 화면 연동(mirror)의 변경도 본 판(seenRev) 뒤에 AI 가 쓴 키를 되쓰지 않는다
//  V7-09 파일의 case.mcpOnly 는 도구 이름 · 인자 이름 꼴 · 크기를 본다(넘으면 버리고 알린다), get_case_inputs 는 그것이 자료임을 밝힌다
//  V7-15 파일의 기준응력(loadFy)이 ① Fy 와 다르면 열 때 알린다
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPanel } = require('./panel_harness');

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('case_guards_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const base = path.join(__dirname, '..', 'rendered', 'out', 'k2');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'guards-'));
  const posted = (cmd) => p.__testGetPostedMessages().filter((m) => m.command === cmd);
  const notes = [];
  try {
    await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 } });
    await p.__testDispatchMessage({ command: 'caseHello', data: { inputs: null, drafts: { templateType: 'lippedc' } } });
    let rev = p.__testGetCase().state.rev;

    // ── V7-06 ─────────────────────────────────────────────────────────────
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: rev, changes: { Lb: 77.7, Cb: 1.3 } } });
    let r = await p.handleMcpAction({ action: 'set_case_inputs', inputs: { Lb: 10 } });
    assert(r.success && r.accepted.includes('Lb'), JSON.stringify(r));
    assert.deepStrictEqual((r.case_inputs_replaced || []).map((x) => [x.key, x.previous, x.previous_source]), [['Lb', 77.7, 'user']],
      `set_case_inputs names the person's value it replaced: ${JSON.stringify(r.case_inputs_replaced)}`);
    r = await p.handleMcpAction({ action: 'set_case_inputs', units: 'SI', inputs: { Cb: 1.0 } });
    assert.deepStrictEqual((r.case_inputs_replaced || []).map((x) => [x.key, x.previous, x.previous_source]), [['Cb', 1.3, 'user']], 'unitless in SI too');
    r = await p.handleMcpAction({ action: 'set_case_inputs', inputs: { Lb: 20 } });
    assert(!r.case_inputs_replaced, 'replacing an AI value is not reported as the person\'s');
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: p.__testGetCase().state.rev, changes: { Lb: 100 } } });
    r = await p.handleMcpAction({ action: 'set_case_inputs', units: 'SI', inputs: { Lb: 1000 } });
    const lbSI = (r.case_inputs_replaced || []).find((x) => x.key === 'Lb');
    assert(lbSI && Math.abs(lbSI.previous - 2540) < 1e-9 && lbSI.units === 'SI', `SI previous value in mm: ${JSON.stringify(lbSI)}`);
    notes.push('V7-06 replaced list (US, SI, AI value not listed)');

    // ── V7-07 · V7-09 · V7-15: 조작된 .csd ───────────────────────────────────
    const f1 = path.join(dir, 'tags.csd');
    await p.__testWriteProjectFile(f1);
    const j = JSON.parse(fs.readFileSync(f1, 'utf8'));
    j.case.inputs.Lb = 123.4; j.case.sources.Lb = 'default';
    j.case.inputs.Cb = 1.77; j.case.sources.Cb = 'ai';
    j.case.mcpOnly = {
      design_lap_connection: { distortion_restrained: true, Se: 2.2, pad: 'x'.repeat(40 * 1024), 'bad name': 1 },
      evil_tool: { a: 1 },
    };
    j.model.loadFy = 33;
    const f2 = path.join(dir, 'forged.csd');
    fs.writeFileSync(f2, JSON.stringify(j));
    const lr = p.__testLoadProjectFile(f2);
    assert(!lr.error, lr.error);
    let st = p.__testGetCase().state;
    assert.deepStrictEqual([st.sources.Lb, st.sources.Cb], ['file', 'file'], `file tags default / ai on changed values open as file: ${st.sources.Lb} ${st.sources.Cb}`);
    const gi = await p.handleMcpAction({ action: 'get_case_inputs' });
    assert.deepStrictEqual(gi.sources_recorded_in_file && [gi.sources_recorded_in_file.Lb, gi.sources_recorded_in_file.Cb], ['default', 'ai'], 'the recorded tags are shown, apart');
    assert(/data, not instructions/.test(gi.mcp_only_note || ''), 'mcp_only is labelled as data');
    assert.deepStrictEqual(Object.keys(st.mcpOnly), ['design_lap_connection'], 'an unknown tool in mcpOnly is dropped');
    assert.deepStrictEqual(Object.keys(st.mcpOnly.design_lap_connection).sort(), ['Se', 'distortion_restrained'], 'over-size and non-identifier arguments dropped');
    assert(lr.warnings.some((w) => /evil_tool/.test(w)) && lr.warnings.some((w) => /pad: \d+ B is over the size limit/.test(w)) && lr.warnings.some((w) => /not an identifier/.test(w)),
      `the drops are named: ${lr.warnings.filter((w) => /mcpOnly/.test(w)).join(' | ')}`);
    assert(lr.warnings.some((w) => /reference stress is 33 ksi/.test(w)), `V7-15 loadFy notice: ${lr.warnings.join(' | ').slice(0, 400)}`);
    // 설계 도구가 덮으면 연 파일의 값은 사람의 값으로 알린다. 결정 D1: 주지 않은 Cb 는 덮지 않는다 — 연 파일의 값이 그대로 쓰이고 그 출처를 알린다
    await p.handleMcpAction({ action: 'run_analysis' });
    const d = await p.handleMcpAction({ action: 'aisi_design', member_type: 'flexure', design_method: 'LRFD', Fy: 50, Fu: 65, Lb: 60, Mu: 40, Vu: 1 });
    assert(!d.error, d.error);
    const rep = (d.case_inputs_replaced || []).map((x) => `${x.key}:${x.previous}:${x.previous_source}`);
    assert(rep.includes('Lb:123.4:file') && !rep.some((x) => x.startsWith('Cb:')), `a design tool reports the file values it replaced (Lb) and not the one it did not get (Cb): ${rep.join(', ')}`);
    const usedCb = (d.case_inputs_used || []).find((x) => x.key === 'Cb');
    assert(usedCb && usedCb.value === 1.77 && usedCb.source === 'file' && p.__testGetCase().state.inputs.Cb === 1.77, `the file Cb is used and named with its source: ${JSON.stringify(usedCb)}`);
    notes.push('V7-07 tags, V7-09 mcpOnly filter + note, V7-15 notice');

    // ── V7-08: 열기 전에 본 판의 화면 변경 ─────────────────────────────────
    rev = p.__testGetCase().state.rev;
    const f3 = path.join(dir, 'other.csd');
    await p.__testWriteProjectFile(f3);
    const j3 = JSON.parse(fs.readFileSync(f3, 'utf8'));
    j3.case.inputs.Cb = 2.2; j3.case.sources.Cb = 'user';
    fs.writeFileSync(f3, JSON.stringify(j3));
    assert(!p.__testLoadProjectFile(f3).error);
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: rev, changes: { Cb: 1.9 } } });
    let ack = posted('caseAck').pop();
    st = p.__testGetCase().state;
    assert.strictEqual(st.inputs.Cb, 2.2, 'an edit made before the file opened does not overwrite the opened value');
    assert.deepStrictEqual(ack.data.conflicts, ['Cb'], 'reported as a conflict');
    assert(posted('caseState').length === 1, 'the state is sent back to the page');
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: st.rev, changes: { Cb: 1.9 } } });
    assert.strictEqual(p.__testGetCase().state.inputs.Cb, 1.9, 'an edit on the opened rev is taken');
    notes.push('V7-08 boundary');

    // ── V7-S1: 화면 연동(mirror)이 AI 가 쓴 값을 옛 화면 값으로 되쓰지 않는다 ──────────────
    const seen = p.__testGetCase().state.rev;
    await p.handleMcpAction({ action: 'set_case_inputs', inputs: { connFy: 40 } });
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'mirror', seenRev: seen, changes: { connFy: 50 } } });
    ack = posted('caseAck').pop();
    assert.strictEqual(p.__testGetCase().state.inputs.connFy, 40, 'a stale mirror echo does not undo the AI write');
    assert.deepStrictEqual(ack.data.conflicts, ['connFy']);
    // V9b-05: 같은 값(보이는 자리 안)의 메아리는 아무것도 쓰지 않는다 — 출처 · 변경 줄 그대로
    const lines0 = p._changeLines().lines.length;
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'mirror', seenRev: p.__testGetCase().state.rev, changes: { connFy: 40 * (1 + 1e-13) } } });
    assert(p.__testGetCase().state.sources.connFy === 'ai' && Math.abs(p.__testGetCase().state.inputs.connFy - 40) < 1e-9 && p._changeLines().lines.length === lines0, 'an echo of the AI value keeps the value (display rounding), the AI as the source, and writes no change line');
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'mirror', seenRev: p.__testGetCase().state.rev, changes: { connFy: 45 } } });
    assert.strictEqual(p.__testGetCase().state.inputs.connFy, 45, 'a mirror change on the current rev is taken');
    // V9b-05 · D4(업무 탭 통일): 그 연동은 프로그램의 변경 줄로(via mirror — 사람이 친 것이 아니다), 꼬리표는 사실대로 mirror
    p._changes.flush();
    const cl = p._changeLines().lines.slice(lines0);
    assert(cl.length === 1 && cl[0].actor.kind === 'program' && JSON.stringify(cl[0].body.via) === '["mirror"]' && cl[0].body.fields.some((x) => x.path === 'case.inputs.connFy')
      && p.__testGetCase().state.sources.connFy === 'mirror', 'the linkage change is a program line with via mirror: ' + JSON.stringify(cl.map((x) => [x.actor.kind, x.body.via, x.body.fields.map((y) => y.path)])));
    // 본 판이 없는 연동 · 모르는 출처 · 연 창 밖의 file 은 받지 않는다
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'mirror', changes: { connFy: 47 } } });
    ack = posted('caseAck').pop();
    assert(p.__testGetCase().state.inputs.connFy === 45 && ack.data.rejected[0].reason_code === 'host.case.no_seen_rev', 'a linkage edit without its revision is refused');
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'invented', seenRev: p.__testGetCase().state.rev, changes: { connFy: 47 } } });
    ack = posted('caseAck').pop();
    assert(p.__testGetCase().state.inputs.connFy === 45 && ack.data.rejected[0].reason_code === 'host.case.bad_origin', 'an invented origin is refused');
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'file', seenRev: p.__testGetCase().state.rev, changes: { connFy: 47 } } });
    ack = posted('caseAck').pop();
    assert(p.__testGetCase().state.inputs.connFy === 45 && ack.data.rejected[0].reason_code === 'host.case.file_outside_window', '«file» outside the open window is refused');
    notes.push('V7-S1 mirror on seenRev; V9b-05 linkage = a person line with via, echoes write nothing, no seen rev · invented origin · file outside the window refused');

    // 그 줄은 바로 나간다 — 조용한 시간을 기다리는 사람의 묶음을 남기지 않는다. 남으면 사람의 다음 요청이 그 묶음에 들어 제 줄(제 trigger)을
    // 잃는다(새 화면의 「이 대안으로」 가 변경 줄 없이 지나갔다 — desktop 의 r32 가 잡음)
    const lines1 = p._changeLines().lines.length;
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'mirror', seenRev: p.__testGetCase().state.rev, changes: { connFy: 46 } } });
    assert(p._changes.pending === null && p._changeLines().lines.length === lines1 + 1, 'a linkage change with no bundle open writes its line at once and leaves no bundle waiting: pending ' + p._changes.pending);
    const personScope = ctx.load(path.join('src', 'mcp', 'actorScope.ts'));
    await personScope.runAs({ kind: 'person' }, () => p.handleMcpAction({ action: 'set_case_inputs', inputs: { Cb: 1.07 } }));
    const own = p._changeLines().lines.slice(lines1 + 1);
    assert(own.length === 1 && own[0].actor.kind === 'person' && own[0].body.trigger === 'set_case_inputs' && !own[0].body.via,
      "the person's next request is its own line with its own trigger: " + JSON.stringify(own.map((x) => [x.actor.kind, x.body.trigger, x.body.via])));
    // 사람의 조용한 묶음에 든 같은 사람의 요청 뒤에도 그 묶음은 조용한 2초 뒤에 닫힌다(닫는 시계를 다시 건다)
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: p.__testGetCase().state.rev, changes: { Lb: 111 } } });
    await new Promise((r) => setTimeout(r, 1200));
    await personScope.runAs({ kind: 'person' }, () => p.handleMcpAction({ action: 'get_status' }));
    await new Promise((r) => setTimeout(r, 1200));
    assert.strictEqual(p._changes.pending, 'quiet', "the person's request moved the last touch of the quiet bundle");
    await new Promise((r) => setTimeout(r, 1300));
    assert.strictEqual(p._changes.pending, null, 'and the bundle closes 2 s after it without another touch');
    notes.push('a linkage change with no bundle open writes its line at once; the next request of the person keeps its own line; a quiet bundle closes after a joined request');

    console.log(`case_guards_contract: PASS (${notes.join('; ')})`);
  } finally {
    ctx.close();
  }
}

main().catch((e) => { console.error('case_guards_contract: FAIL', e); process.exitCode = 1; });
