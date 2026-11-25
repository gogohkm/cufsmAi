/* global process, setTimeout */
// 재테스트 반영(2026-11-25, 단계 H — docs/implementation/20261125-retest-fixes-worklog.md 결정 E1–E3 · E7 · E8 · E9 · E10). 진짜 패널 · 파이썬.
//  N-3(E1) 다른 엔진으로 버린 대상을 열고 run_case_check member → 설계용 FSM 좌굴값을 다시 준비해 그것으로(앞과 같은 판정비), 그 design_dsm 실행의
//          행위자 = run_case_check 를 부른 쪽. FSM 이 한 번도 없던 대상은 해석식 + 안내(run_analysis → run_case_check)
//  E2     같은 서명 · 계열이 다 있으면 prepare_design_dsm 은 다시 풀지 않는다(reused, 실행 줄 없음)
//  E3     열 때의 안내가 run_case_check(부재 검토 + FSM 좌굴값) · run_analysis(해석의 보기)를 말한다
//  E7     new_case: from 없음 → 처음 모델 + 처음 입력, from current → 지금 것. 부재 종류가 부재 유형이면 둘 다 memberType = kind
//  E8     AI 의 기준응력 표지가 저장 · 열기를 지난다 — 경고 없음, 화면의 「해석 실행」 이 그 값으로. 표지 없는 옛 파일은 경고(그대로)
//  N-7a   사람 묶음(화면의 지움 → caseEdit 차례)의 invalidated 가 채워진다
//  N-7b   AI 가 연 대상의 자동 design_dsm = ai, 화면에서(사람이) 연 것 = person — 앞 대상의 행위자를 잇지 않는다
//  N-7c   변경 제목 · 칸 글의 천 단위 쉼표(「2,000 → 1,800 mm」), 구조의 from/to 는 수
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPanel } = require('./panel_harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notes = [];

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('retest_fixes_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const S = ctx.StcfsdPanel;
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_rt_'));
  const root = path.join(box, 'roots'); fs.mkdirSync(root);
  const saveKey = S.writerKeyDir; const saveRoots = S.projectRoots;
  S.writerKeyDir = path.join(box, 'key'); S.projectRoots = [root];
  const scope = ctx.load(path.join('src', 'mcp', 'actorScope.ts'));
  const ai = (o) => scope.runAs({ kind: 'ai', client: 'rt-test/1' }, () => p.handleMcpAction(o));
  const person = (o) => scope.runAs({ kind: 'person' }, () => p.handleMcpAction(o));
  const page = (command, data) => p.__testDispatchMessage({ command, data });
  const ok = (r, what) => { assert(r && !r.error, `${what}: ${JSON.stringify(r).slice(0, 400)}`); return r; };
  const history = async () => (await ai({ action: 'get_case_status', detail: 'runs' })).history || [];
  const ratios = (r) => (r.design_checks || []).map((c) => [c.id, c.ratio]);
  try {
    ok(await ai({ action: 'open_project', name: 'RT', create: true }), 'open_project');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 } }), 'template');
    // ── E7: from current = 지금 모델 + memberType = kind; from 없음 = 처음 모델 ──
    const nc1 = ok(await ai({ action: 'new_case', name: 'Z', kind: 'section-only', from: 'current' }), 'new_case Z');
    const nc2 = ok(await ai({ action: 'new_case', name: 'P', kind: 'roof-purlin', from: 'current' }), 'new_case P');
    const nc3 = ok(await ai({ action: 'new_case', name: 'N', kind: 'wall-girt' }), 'new_case N');
    assert(nc1.from === 'current' && nc3.from === 'initial' && /initial model/.test(nc3.contents) && /member type wall-girt/.test(nc3.contents), JSON.stringify([nc1, nc3]));
    const pdir = fs.realpathSync.native(path.join(root, 'RT'));
    const csd = (n) => path.join(pdir, '02_검토대상', `${n}.csd`);
    const fileOf = (n) => JSON.parse(fs.readFileSync(csd(n), 'utf8'));
    const fP = fileOf('P'), fN = fileOf('N');
    assert(Math.abs(fP.model.sectionParams.H - 8) < 1e-12 && fP.case.inputs.memberType === 'roof-purlin', 'from current: current model, member type = kind ' + JSON.stringify(fP.case.inputs.memberType));
    assert(Math.abs(fN.model.sectionParams.H - 100 / 25.4) < 1e-12 && fN.model.sectionTemplate === 'lippedc' && fN.case.inputs.memberType === 'wall-girt',
      'no from: the program\'s initial model (100 mm lipped C), member type = kind');
    assert(fN.derivedStateSignature !== fP.derivedStateSignature, 'the signature is the one of the model written');
    notes.push(`E7: from current keeps H 8 in (+memberType roof-purlin), no from gives the initial 100 mm section (+memberType wall-girt)`);

    // ── N-3: FSM 이 있던 대상 Z ──
    ok(await ai({ action: 'open_case', name: 'Z' }), 'open Z');
    ok(await ai({ action: 'set_case_inputs', inputs: { memberType: 'flexure', fy: 50, Lb: 60, Cb: 1, Mux: 20 } }), 'inputs');
    ok(await ai({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 50 }), 'set_load_case');
    ok(await page('runAnalysis', { stressOpts: { type: 'pure_bending', fy: 50 }, loadCase: 'bending_xx_pos' }) ?? {}, 'page analysis');
    const r0 = ok(await ai({ action: 'run_case_check', what: 'member' }), 'run_case_check (fresh)');
    assert(r0.dsm_basis === 'prepared' && r0.case_check.buckling_values.source === 'fsm-prepared-now', 'first check prepares (no page): ' + JSON.stringify(r0.case_check));
    ok(await ai({ action: 'save_case' }), 'save Z');
    // 다른 엔진의 결과로 만든다
    const fz = fileOf('Z'); fz.resultsEngine.engine_id = 'sha256:' + '0'.repeat(64); fs.writeFileSync(csd('Z'), JSON.stringify(fz, null, 2));
    ok(await ai({ action: 'open_case', name: 'N' }), 'open N');
    // 사람이 연다(화면) — 그 뒤 AI 가 run_case_check: 준비 실행의 행위자는 부른 쪽(ai)
    const oz = ok(await person({ action: 'open_case', name: 'Z' }), 'open Z (person)');
    const rerun = oz.warnings.find((w) => /another engine/.test(w));
    assert(rerun && /run_case_check \{what: 'member'\} re-runs the member check and re-prepares the FSM buckling values/.test(rerun) && /run_analysis/.test(rerun), 'E3 guidance: ' + rerun);
    const before = (await history()).length;
    const r1 = ok(await ai({ action: 'run_case_check', what: 'member' }), 'run_case_check (after drop)');
    const bv = r1.case_check.buckling_values;
    assert(bv.source === 'fsm-prepared-now' && bv.load_cases.includes('bending_xx_pos') && r1.dsm_basis === 'prepared', 'FSM values prepared again: ' + JSON.stringify(r1.case_check));
    assert.deepStrictEqual(ratios(r1), ratios(r0), 'same ratios as before the drop (FSM, not analytical)');
    let h = await history();
    const dsmRun = h.find((x) => x.kind === 'design_dsm');
    assert(h.length === before + 2 && dsmRun && dsmRun.by === 'ai' && h[0].kind === 'member_design', 'one design_dsm (by ai — the caller) and one member_design: ' + JSON.stringify(h.slice(0, 3)));
    notes.push(`N-3: dropped → run_case_check prepared FSM again (${bv.source}), ratios identical to the FSM run, design_dsm by ${dsmRun.by}`);
    // E2: 화면의 준비가 다시 와도 다시 풀지 않는다
    p.__testClearPostedMessages();
    await page('prepareDesignDsm', { member_type: 'flexure', Fy: 50 });
    const prepMsg = ctx.posted('designDsmPrepared').pop();
    assert(prepMsg && prepMsg.data.reused === true && prepMsg.data.success === true && prepMsg.data.dsm && prepMsg.data.load_cases[0] === 'bending_xx_pos', 'reused: ' + JSON.stringify(prepMsg && prepMsg.data).slice(0, 200));
    assert.strictEqual((await history()).length, h.length, 'no new run line for a reused prepare');
    const r2 = ok(await ai({ action: 'run_case_check', what: 'member' }), 'run_case_check (current)');
    assert(r2.case_check.buckling_values.source === 'fsm-current', 'current values are used as they are: ' + JSON.stringify(r2.case_check.buckling_values));
    assert.strictEqual((await history()).filter((x) => x.kind === 'design_dsm').length, h.filter((x) => x.kind === 'design_dsm').length, 'no further design_dsm');
    notes.push('E2: a second prepare is reused (no run line), the next check says fsm-current');

    // ── N-3: FSM 이 한 번도 없던 대상 N ──
    ok(await ai({ action: 'open_case', name: 'N' }), 'open N');
    ok(await ai({ action: 'set_case_inputs', inputs: { memberType: 'flexure', fy: 50, Lb: 60, Cb: 1, Mux: 20 } }), 'inputs N');
    const rn = ok(await ai({ action: 'run_case_check', what: 'member' }), 'run_case_check N');
    const bn = rn.case_check.buckling_values;
    assert(bn.source === 'analytical' && /no FSM buckling analysis exists for this case/.test(bn.note) && /run_analysis .* followed by run_case_check/.test(bn.note) && rn.dsm_basis === 'none',
      'never had FSM: analytical with the note ' + JSON.stringify(bn));
    assert(!(await history()).some((x) => x.kind === 'design_dsm'), 'no design_dsm run for a case without FSM');
    notes.push('N-3: a case without FSM stays analytical with the note');

    // ── N-7b: AI 가 연 대상의 화면 준비 = ai, 사람이 연 대상 = person ──
    ok(await ai({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 50 }), 'N load case');
    ok(await ai({ action: 'run_analysis' }), 'N analysis (ai)');
    ok(await ai({ action: 'save_case' }), 'save N');
    ok(await ai({ action: 'open_case', name: 'P' }), 'open P');
    await page('runAnalysis', { stressOpts: { type: 'pure_bending', fy: 50 }, loadCase: 'bending_xx_pos' });   // 사람의 해석(P)
    await person({ action: 'open_case', name: 'Z' });
    ok(await ai({ action: 'open_case', name: 'N' }), 'open N by ai');   // 저장된 해석이 되살아난다(설계용 값은 없다)
    await page('prepareDesignDsm', { member_type: 'flexure', Fy: 50 });   // 화면이 되살린 해석 뒤 저절로
    h = await history();
    assert(h[0].kind === 'design_dsm' && h[0].by === 'ai', 'the auto design_dsm after an AI open is by ai (not the person of the previous case): ' + JSON.stringify(h[0]));
    await person({ action: 'open_case', name: 'Z' });
    ok(await person({ action: 'open_case', name: 'N' }), 'open N by person');
    // 지금 것이 있으면(E2) 실행이 없다 — Fy 를 바꿔 새로 준비하게
    await page('prepareDesignDsm', { member_type: 'flexure', Fy: 45 });
    h = await history();
    assert(h[0].kind === 'design_dsm' && h[0].by === 'person', 'opened from the screen → person: ' + JSON.stringify(h[0]));
    notes.push('N-7b: auto design_dsm by the opener (ai / person)');

    // ── E8: AI 의 기준응력 표지 ──
    ok(await ai({ action: 'open_case', name: 'Z' }), 'open Z');
    ok(await ai({ action: 'set_case_inputs', inputs: { fy: 42.786 } }), 'fy 42.786');
    ok(await ai({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 50 }), 'AI reference stress 50');
    ok(await ai({ action: 'save_case' }), 'save Z');
    assert.deepStrictEqual(fileOf('Z').referenceStress, { source: 'ai', loadFy: 50 }, 'the .csd keeps the AI reference stress');
    ok(await ai({ action: 'open_case', name: 'P' }), 'open P');
    const oz2 = ok(await person({ action: 'open_case', name: 'Z' }), 'reopen Z');
    assert(p._loadFyAi === true && !oz2.warnings.some((w) => /reference stress/.test(w)), 'restored, no reference-stress warning: ' + JSON.stringify(oz2.warnings));
    assert.strictEqual(ctx.posted('modelLoaded').pop().data.loadFySource, 'ai', 'the page shows the AI tag');
    await page('runAnalysis', { stressOpts: { type: 'pure_bending', fy: 42.786 }, loadCase: 'bending_xx_pos' });
    const meta = p.__testGetState().lastAnalysisMeta;
    assert(meta && meta.fy === 50 && p.__testGetState().model.loadFy === 50, 'the screen\'s analysis after reopening uses 50 ksi: ' + JSON.stringify(meta));
    // 표지 없는 옛 파일은 알린다(그대로)
    ok(await ai({ action: 'save_case' }), 'save Z');
    ok(await ai({ action: 'open_case', name: 'P' }), 'open P');
    const fz2 = fileOf('Z'); delete fz2.referenceStress; fs.writeFileSync(csd('Z'), JSON.stringify(fz2, null, 2));
    const oz3 = ok(await person({ action: 'open_case', name: 'Z' }), 'reopen old Z');
    assert(p._loadFyAi === false && oz3.warnings.some((w) => /does not record that choice/.test(w)), 'old file: the notice stays ' + JSON.stringify(oz3.warnings));
    notes.push('E8: referenceStress {source ai, loadFy 50} survives save/open, the screen analysis uses 50 ksi; an old file without it is reported');

    // ── N-7a · N-7c: 사람 묶음(화면 차례: 지움 → caseEdit) ──
    ok(await ai({ action: 'set_case_inputs', inputs: { fy: 50, Lb: 2000 / 25.4 } }), 'Lb 2000 mm');
    ok(await ai({ action: 'run_case_check', what: 'member' }), 'design present');
    await page('invalidateDerivedResults', { scope: 'design' });
    await page('caseEdit', { origin: 'user', changes: { Lb: 1800 / 25.4 } });
    await sleep(2200);
    p.__testChanges();
    const wl = await ai({ action: 'work_log', detail: 'fields', limit: 5 });
    const ch = (wl.entries || []).find((e) => e.type === 'change' && e.actor && e.actor.kind === 'person');
    assert(ch && ch.invalidated.includes('member_design'), 'the person bundle lists member_design: ' + JSON.stringify(ch));
    assert(/2,000 → 1,800 mm/.test(ch.title), 'thousands separators in the title: ' + ch.title);
    const f = ch.fields.find((x) => /Lb/.test(x.path));
    assert(f && f.display === '2,000 → 1,800 mm' && typeof f.from === 'number' && Math.abs(f.from - 2000) < 1e-9, 'field display grouped, from/to numbers: ' + JSON.stringify(f));
    notes.push(`N-7a: person bundle invalidated [${ch.invalidated.join(', ')}]; N-7c: 「${ch.title}」`);
  } finally {
    ctx.close();
    S.writerKeyDir = saveKey; S.projectRoots = saveRoots;
    try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`retest_fixes_contract: PASS (${notes.join('; ')})`);
}
main().catch((e) => { console.error('retest_fixes_contract: FAIL', e && e.stack ? e.stack : e); process.exitCode = 1; });
