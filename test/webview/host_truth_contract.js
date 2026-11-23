/* global process, setTimeout */
// 4 번째 멈춤 — 호스트가 결과의 참을 쥔다(V7-40 호스트 쪽)와 데스크톱 작성자의 다섯 가지:
//  1. 호스트가 결과를 지울 때마다 derivedResultsInvalidated {kinds, scope:'kinds', reason, cause}(종류 이름 = 장부의 kind)
//  2. 둘째 hello(다시 싣기)에는 무엇보다 먼저 지금의 참(resultsLedger: 있는 결과 · 장부)
//  3. get_unsaved_changes.file_origin — person(사람이 연 · 저장한) · ai(load_project)
//  4. 경로에 매이지 않는 복구 사본(writeRecoveryCopy — MCP 로 닿지 않는다): 지금 경로 · 저장 기준을 바꾸지 않고, 새 파일만, root 안, 링크 거절
//  5. 마지막 점검이 results · 장부에(입력이 바뀌면 낡음), AI 가 돌린 점검도 화면에 validationResult
//  6. 보기 계약의 선택 종류 validation(val.* — 마지막 점검에 있는 id 만)
//  7. status 의 case.results_signed
//  8. u33: 하중 해석 뒤에 AI 가 쓴 값을 그 해석의 자동 채움(origin load-analysis)이 덮지 않는다
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPanel } = require('./panel_harness');

const OUT = path.join(__dirname, '..', 'rendered', 'out', 'host_truth');
const tick = () => new Promise((r) => setTimeout(r, 20));

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('host_truth_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const Panel = p.constructor;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const posted = () => p.__testGetPostedMessages();
  const since = (n) => posted().slice(n);
  const lines = [];
  try {
    await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 } });
    await p.handleMcpAction({ action: 'set_load_case', load_case: 'compression', fy: 50 });
    await p.handleMcpAction({ action: 'run_analysis' });
    const d = await p.handleMcpAction({ action: 'aisi_design', member_type: 'compression', design_method: 'LRFD', Fy: 50, Fu: 65, KxLx: 96, KyLy: 48, KtLt: 48, Pu: 4 });
    assert(!d.error, d.error);

    // 1. 화면이 시작한 지움(입력 변경)도 종류를 실은 알림 — 브리지 · 둘째 화면이 읽는다
    let n = posted().length;
    // 화면은 칸이 바뀌면 caseEdit 와 invalidateDerivedResults(그 범위) 를 보낸다 — 화면이 시작한 지움
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { KxLx: 120 } } });
    await p.__testDispatchMessage({ command: 'invalidateDerivedResults', data: { scope: 'design', reason: 'design input changed' } });
    await tick();
    const drop =since(n).find((m) => m.command === 'derivedResultsInvalidated' && m.data && m.data.scope === 'kinds');
    assert(drop && drop.data.kinds.includes('member_design') && drop.data.reason && drop.data.cause, `a page-started drop names the kinds: ${JSON.stringify(drop && drop.data)}`);
    assert(!p._lastDesignResult, 'the host dropped the design');
    lines.push(`drop message kinds ${JSON.stringify(drop.data.kinds)}`);

    // 2. 둘째 hello: 첫 메시지가 지금의 참
    n = posted().length;
    await p.__testDispatchMessage({ command: 'webviewReady' });
    const first = since(n)[0];
    assert(first && first.command === 'resultsLedger' && first.data.results && Array.isArray(first.data.invalidated), `the reload starts with the truth (${first && first.command})`);
    assert(first.data.results.member_design === null && first.data.invalidated.some((e) => e.kind === 'member_design'), 'the truth says the design is gone and why');

    // 5. 점검: 화면이 돌림 → results 에; 입력이 바뀌면 장부로; AI 가 돌리면 화면에도
    await p.__testDispatchMessage({ command: 'runValidation', data: { unitSystem: 'US' } });
    let st = p.getStatus();
    const rs = p._resultsStatus();
    assert(rs.validation && rs.validation.by === 'page' && rs.validation.counts.total > 0 && rs.validation.case_rev === p.__testGetCase().state.rev, `validation in results: ${JSON.stringify(rs.validation)}`);
    // 6. 보기 계약: 마지막 점검의 id 를 고를 수 있다(없는 id 는 버린다)
    const vid = p._lastValidation.ids.find((x) => /^val\./.test(x));
    await p.__testDispatchMessage({ command: 'viewReport', data: { screen: 'review', view: 'sheet', selection: { kind: 'validation', id: vid }, by: 'person' } });
    let v = await p.handleMcpAction({ action: 'get_view' });
    const sel = JSON.stringify(v).includes(vid);
    assert(sel, `get_view reports the selected validation item ${vid}: ${JSON.stringify(v).slice(0, 300)}`);
    await p.__testDispatchMessage({ command: 'viewReport', data: { screen: 'review', view: 'sheet', selection: { kind: 'validation', id: 'val.nope.nothing' }, by: 'person' } });
    v = await p.handleMcpAction({ action: 'get_view' });
    assert(!JSON.stringify(v).includes('val.nope.nothing'), 'an unknown validation id is not reported');
    const fo = await p.handleMcpAction({ action: 'focus', item: { kind: 'validation', id: vid } });
    assert(!fo.error, `focus accepts a validation item: ${JSON.stringify(fo).slice(0, 200)}`);
    // 입력 변경 → 점검은 낡음(장부)
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { KyLy: 60 } } });
    await tick();
    assert(p._resultsStatus().validation === null && p._ledgerList().some((e) => e.kind === 'validation'), 'an input change moves the validation to the ledger');
    // AI 가 돌린 점검도 화면으로
    n = posted().length;
    await p.handleMcpAction({ action: 'validate_design' });
    const vr = since(n).find((m) => m.command === 'validationResult');
    assert(vr && vr.data.by === 'ai' && Array.isArray(vr.data.items), 'an AI-run validation is posted to the page');
    assert(p._resultsStatus().validation.by === 'ai', 'and recorded');
    lines.push('validation in results / ledger, AI run posted, val.* selection + focus');

    // 7. 서명 상태
    st = p.getStatus();
    assert.strictEqual(st.case.results_signed, true, `signed with the test key folder (${JSON.stringify(st.case)})`);
    const keep = Panel.writerKeyDir;
    Panel.writerKeyDir = null;
    st = p.getStatus();
    assert(st.case.results_signed === false && /no writer key folder/.test(st.case.results_signed_reason), 'no key folder → unsigned, with the reason');
    Panel.writerKeyDir = keep;

    // 3. 파일을 누가 정했나
    const f1 = path.join(OUT, 'a.csd');
    await p.__testWriteProjectFile(f1);
    assert.strictEqual(p.__testLoadProjectFile(f1).error, undefined);
    assert.strictEqual((await p.handleMcpAction({ action: 'get_unsaved_changes' })).file_origin, 'person', 'opened by the person → person');
    const lp = await p.handleMcpAction({ action: 'load_project', filepath: f1 });
    assert(lp.success, JSON.stringify(lp));
    assert.strictEqual((await p.handleMcpAction({ action: 'get_unsaved_changes' })).file_origin, 'ai', 'opened by load_project → ai');
    p.__testLoadProjectFile(f1);

    // 4. 복구 사본
    const root = path.join(OUT, 'userdata');
    fs.mkdirSync(root, { recursive: true });
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { KxLx: 100 } } });
    const before = await p.handleMcpAction({ action: 'get_unsaved_changes' });
    const rc = await p.writeRecoveryCopy(path.join(root, 'recovery', 'r1.csd'), root);
    assert(rc.ok && fs.existsSync(rc.path), JSON.stringify(rc));
    const after = await p.handleMcpAction({ action: 'get_unsaved_changes' });
    assert.deepStrictEqual([after.file, after.dirty, after.since, after.file_origin], [before.file, before.dirty, before.since, before.file_origin], 'the recovery copy changes neither the path nor the dirty baseline');
    assert.strictEqual(JSON.parse(fs.readFileSync(rc.path, 'utf8')).case.inputs.KxLx, 100, 'it holds the current inputs');
    assert(!(await p.writeRecoveryCopy(rc.path, root)).ok, 'an existing file is never replaced');
    assert(!(await p.writeRecoveryCopy(path.join(OUT, 'outside.csd'), root)).ok, 'outside the root is refused');
    const jn = path.join(root, 'linked');
    fs.symlinkSync(OUT, jn, 'junction');
    assert(!(await p.writeRecoveryCopy(path.join(jn, 'x.csd'), root)).ok, 'a linked folder is refused');
    const viaMcp = await p.handleMcpAction({ action: 'write_recovery_copy', filePath: path.join(root, 'm.csd'), root });
    assert(viaMcp.error && !fs.existsSync(path.join(root, 'm.csd')), `not reachable through MCP / the bridge (${JSON.stringify(viaMcp).slice(0, 120)})`);
    lines.push('recovery copy: path-neutral, new files only, inside root, no links, not through MCP');

    // 8. u33(호스트 단위): 하중 해석 뒤 AI 가 쓴 Lb 를 그 해석의 채움이 덮지 않는다
    await p.handleMcpAction({ action: 'analyze_loads', member_app: 'roof-purlin', span_type: 'simple', span_ft: 20, loads: { D: 10, Lr: 60 }, design_method: 'ASD', Fy: 55, Fu: 70 });
    const before8 = p.__testGetCase().state.inputs.Lb;
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'load-analysis', changes: { Lb: 111 } } });
    assert.strictEqual(p.__testGetCase().state.inputs.Lb, 111, `a fill right after the analysis is accepted (was ${before8})`);
    await p.handleMcpAction({ action: 'set_case_inputs', inputs: { Lb: 62.99 } });
    n = posted().length;
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'load-analysis', changes: { Lb: 184.3 } } });
    assert.strictEqual(p.__testGetCase().state.inputs.Lb, 62.99, 'a replayed fill does not replace the newer AI value');
    const ack = since(n).find((m) => m.command === 'caseAck');
    assert(ack && ack.data.rejected.some((x) => x.key === 'Lb') && since(n).some((m) => m.command === 'caseState'), 'the page is told and given the host value');
    lines.push('u33: replayed load-analysis fill rejected for a newer AI value');
  } finally { ctx.close(); }
  console.log(`host_truth_contract: PASS (${lines.join('; ')})`);
}
main().catch((e) => { console.error('host_truth_contract: FAIL', e && e.message ? e.message : e); process.exitCode = 1; });
