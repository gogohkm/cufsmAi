/* global process */
// 남은 작업(2026-11-25) 독립 검증의 호스트 지적 1 – 5(docs/implementation/20261125-remaining-work-worklog.md 3절 「V — 호스트 지적」). 진짜 패널 · 파이썬.
//   node test/webview/design_chain_verify_contract.js
//  V1 cFSM 모드 구속(GBTcon)은 설계 좌굴값에 들지 않는다 — 설계 준비의 해석 본문에 GBTcon 이 없고 값은 구속 없는 것과 같다, 구속을 켜고 꺼도
//     준비된 값은 낡지 않는다(서명에 없다), 결과의 가정 · 알림(host.design.dsm_unconstrained)과 buckling_values 의 글, 구속한 지금 해석은 대체로
//     쓰지 않는다, 퍼린 사슬도 같다
//  V2 준비가 실패했는데 지금 해석이 값을 채우면 dsm_warning 이 실패를 말하고 buckling_values.source = analysis-fallback(그 해석의 길이 · 경계조건)
//  V3 화면의 자동 준비(prepareDesignDsm)는 화면이 알렸으면 검토 상태의 설계 Fy 로 — 되돌려 온 49.99999999993936 이 아니라 50, 한 번 풀고
//     부재 검토는 다시 풀지 않는다. 알린 적 없는 옛 화면은 그 수 그대로
//  V4 저장한 준비 값은 서명(design_signature)과 함께 — 지금 것일 때만 쓰고, 열 때 서명이 같아야 되살린다. 서명이 없거나 다르면 장부에 한 줄
//  V5 design_purlin 과 같은 인자의 analyze_loads 는 퍼린 결과를 지우지 않는다(Fy · Fu 의 자리만 다르다), 다른 인자는 지운다
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPanel } = require('./panel_harness');

const notes = [];

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('design_chain_verify_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const S = ctx.StcfsdPanel;
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_vh_'));
  const root = path.join(box, 'roots'); fs.mkdirSync(root);
  const saveKey = S.writerKeyDir; const saveRoots = S.projectRoots;
  S.writerKeyDir = path.join(box, 'key'); S.projectRoots = [root];
  const scope = ctx.load(path.join('src', 'mcp', 'actorScope.ts'));
  const ai = (o) => scope.runAs({ kind: 'ai', client: 'vh-test/1' }, () => p.handleMcpAction(o));
  const page = (command, data) => scope.runAs({ kind: 'person' }, () => p.__testDispatchMessage({ command, data }));
  const ok = (r, what) => { assert(r && !r.error, `${what}: ${JSON.stringify(r).slice(0, 500)}`); return r; };
  const engine = [];
  const realCall = p._pythonBridge.call.bind(p._pythonBridge);
  p._pythonBridge.call = (method, params) => { engine.push({ method, params: JSON.parse(JSON.stringify(params ?? null)) }); return realCall(method, params); };
  const realAnalyze = p._pythonBridge.analyze.bind(p._pythonBridge);
  p._pythonBridge.analyze = (params) => { engine.push({ method: 'analyze*', params: JSON.parse(JSON.stringify(params)) }); return realAnalyze(params); };
  const sent = (method) => engine.filter((e) => e.method === method);
  const designDsm = () => { const e = sent('aisi_design').pop(); return e && e.params.dsm; };
  const clearPrepared = () => { p._preparedDesignDsm = null; p._preparedDesignDsmSig = ''; p._preparedDesignDsmAt = null; };
  const NOTICE = 'host.design.dsm_unconstrained';
  const NOTICES = require(path.join(__dirname, '..', '..', 'webview', 'js', 'notices.js'));
  const noticeText = NOTICES.hostNotice(NOTICE).text;
  const check = async (what) => { engine.length = 0; return ok(await ai({ action: 'run_case_check', what: 'member' }), what); };
  try {
    ok(await ai({ action: 'open_project', name: 'VH', create: true }), 'open_project');

    // ── V5 · V1(퍼린): 같은 하중 요청은 퍼린 결과를 지우지 않는다, 퍼린 서명곡선은 구속하지 않는다 ──
    ok(await ai({ action: 'new_case', name: 'P', kind: 'roof-purlin' }), 'new_case P');
    ok(await ai({ action: 'open_case', name: 'P' }), 'open P');
    ok(await ai({ action: 'generate_template', section_type: 'lippedz', params: { H: 8, B: 2.5, D: 0.7, t: 0.059, r: 0.1 } }), 'Z');
    ok(await ai({ action: 'set_gbtcon', dist: [1, 1] }), 'set_gbtcon (P)');
    const pargs = { member_app: 'roof-purlin', span_type: 'simple', span_ft: 20, spacing_ft: 5, loads: { D: 30, Lr: 60, W: -80 }, Fy: 50, Fu: 65 };
    engine.length = 0;
    const pr = ok(await ai({ action: 'design_purlin', ...pargs }), 'design_purlin');
    const sol = sent('analyze*');
    assert(sol.length === 2 && sol.every((e) => !('GBTcon' in e.params)), 'purlin signature curves are solved without GBTcon ' + JSON.stringify(sol.map((e) => e.params.GBTcon)));
    assert((pr.assumptions || []).includes(noticeText) && (pr.notices || []).some((n) => n.code === NOTICE), 'purlin result names the view-only constraint');
    assert(p._presentKinds().includes('member_design'), 'purlin result present');
    const same = ok(await ai({ action: 'analyze_loads', ...pargs }), 'analyze_loads same args');
    assert(p._presentKinds().includes('member_design') && !p._ledgerList().some((e) => e.kind === 'member_design'),
      'same load request keeps the purlin result ' + JSON.stringify({ k: p._presentKinds(), l: p._ledgerList(), inv: same.case_results_invalidated }));
    ok(await ai({ action: 'analyze_loads', ...pargs, span_ft: 22 }), 'analyze_loads span 22');
    const led = p._ledgerList().find((e) => e.kind === 'member_design');
    assert(!p._presentKinds().includes('member_design') && led && led.cause.inputs.includes('span_ft') && !led.cause.inputs.includes('Fy'),
      'a changed load request still drops it (span_ft, not Fy) ' + JSON.stringify(led));
    notes.push('V5: analyze_loads = design_purlin args keeps the purlin result, span_ft 22 drops it; V1: purlin solves without GBTcon, assumption named');

    // ── 부재 대상 C ──
    ok(await ai({ action: 'new_case', name: 'C', kind: 'section-only' }), 'new_case C');
    ok(await ai({ action: 'open_case', name: 'C' }), 'open C');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0 } }), 'lipped C r 0');
    ok(await ai({ action: 'set_case_inputs', inputs: { memberType: 'flexure', fy: 50, fu: 65, Lb: 60, Cb: 1, Mux: 20, Vu: 1, wcN: null } }), 'inputs C');

    // ── V3(옛 화면): 알린 적 없는 화면의 준비는 그 수 그대로 ──
    const F = require(path.join(__dirname, '..', '..', 'webview', 'js', 'designState.js')).UNIT_FACTORS;
    const fyRT = Number((50 * F.stress).toPrecision(12)) / F.stress;
    assert(fyRT !== 50, 'the round trip changes the number ' + fyRT);
    await page('prepareDesignDsm', { member_type: 'flexure', Fy: fyRT });
    assert.strictEqual(p._preparedDesignDsm.fy_analysis, fyRT, 'old page (no caseHello): its own Fy');
    clearPrepared();

    // ── V1: 구속 없이 기준값 ──
    const r0 = await check('base check');
    const base = designDsm();
    assert(r0.case_check.buckling_values.source === 'fsm-prepared-now' && base.Mcrl > 0 && base.Mcrd > 0, 'base prepared ' + JSON.stringify(r0.case_check));
    assert(!(r0.assumptions || []).includes(noticeText), 'no constraint notice without a constraint');
    const prep0 = p._preparedDesignDsm; const sig0 = p._preparedDesignDsmSig;
    const GBT = { glob: [0, 0, 0, 0], dist: [1, 1], local: Array(38).fill(0), other: Array(40).fill(0) };
    ok(await ai({ action: 'set_gbtcon', ...GBT }), 'set_gbtcon dist only');
    assert(p._preparedDesignDsm === prep0 && p._preparedDesignDsmSig === sig0 && !p._ledgerList().some((e) => e.kind === 'design_dsm'),
      'a mode constraint does not make the prepared values stale');
    const r1 = await check('check with GBTcon on');
    const d1 = designDsm();
    assert.strictEqual(sent('analyze*').length, 0, 'no new solve');
    assert(d1.Mcrl === base.Mcrl && d1.Mcrd === base.Mcrd, `design values unconstrained: Mcrl ${d1.Mcrl} / ${base.Mcrl}, Mcrd ${d1.Mcrd} / ${base.Mcrd}`);
    assert(r1.case_check.buckling_values.source === 'fsm-current' && /GBTcon/.test(r1.case_check.buckling_values.note), 'buckling_values note names it ' + JSON.stringify(r1.case_check.buckling_values));
    assert((r1.assumptions || []).includes(noticeText), 'result assumption ' + JSON.stringify(r1.assumptions));
    const lines = NOTICES.lines(r1, { lists: ['assumptions'], units: 'US', lang: 'ko' });
    assert(lines.some((l) => l.code === NOTICE && /서명곡선/.test(l.text)), 'the notice lines carry the code (Korean text on the screen) ' + JSON.stringify(lines.slice(-2)));
    clearPrepared();
    const r2 = await check('prepare with GBTcon on');
    const sol2 = sent('analyze*');
    assert(sol2.length === 1 && !('GBTcon' in sol2[0].params), 'the design solve has no GBTcon ' + JSON.stringify(sol2.map((e) => Object.keys(e.params))));
    const d2 = designDsm();
    assert(r2.case_check.buckling_values.source === 'fsm-prepared-now' && d2.Mcrl === base.Mcrl && d2.Mcrd === base.Mcrd, 'prepared with the constraint on = unconstrained values');
    notes.push(`V1: GBTcon (local out) — design Mcrl ${base.Mcrl.toFixed(3)} / Mcrd ${base.Mcrd.toFixed(3)} unchanged, no GBTcon in the solve, values stay current, notice named`);

    // ── V1: 구속한 지금 해석은 대체로 쓰지 않는다 ──
    ok(await ai({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 50 }), 'set_load_case');
    ok(await ai({ action: 'run_analysis' }), 'constrained run_analysis');
    clearPrepared();
    const realSig = p._signatureDsm;
    p._signatureDsm = async () => { throw new Error('forced failure'); };
    const rc = await check('prep fails, constrained analysis current');
    p._signatureDsm = realSig;
    assert(rc.dsm_basis_by_family.Mxx === 'none' && /forced failure/.test(rc.dsm_warning || '') && /constrained by the model's cFSM mode constraint/.test(rc.dsm_warning || '')
      && rc.case_check.buckling_values.source === 'analytical', 'a constrained analysis is not a design fallback ' + JSON.stringify({ w: rc.dsm_warning, b: rc.dsm_basis_by_family, cc: rc.case_check.buckling_values }));
    notes.push('V1: a constrained current analysis is not used as the fallback (analytical + dsm_warning)');

    // ── V2: 준비 실패 + 구속 없는 지금 해석 → analysis-fallback ──
    ok(await ai({ action: 'set_gbtcon' }), 'set_gbtcon cleared');
    ok(await ai({ action: 'run_analysis' }), 'run_analysis');
    clearPrepared();
    p._signatureDsm = async () => { throw new Error('forced failure'); };
    const rf = await check('prep fails, analysis current');
    p._signatureDsm = realSig;
    const bv = rf.case_check.buckling_values;
    assert(rf.dsm_basis_by_family.Mxx === 'current_analysis', 'the family is from the current analysis ' + JSON.stringify(rf.dsm_basis_by_family));
    assert(/Preparing the S-S signature-curve FSM values failed \(forced failure\)/.test(rf.dsm_warning || '') && /current buckling analysis instead/.test(rf.dsm_warning || ''),
      'dsm_warning says the preparation failed ' + JSON.stringify(rf.dsm_warning));
    assert(bv.source === 'analysis-fallback' && /forced failure/.test(bv.note) && /boundary condition/.test(bv.note) && bv.by_family.Mxx === 'current_analysis',
      'buckling_values: analysis-fallback ' + JSON.stringify(bv));
    const rok = await check('check prepares again');
    assert(rok.case_check.buckling_values.source === 'fsm-prepared-now' && !rok.dsm_warning, 'next check prepares');
    notes.push('V2: prep failure + current analysis → dsm_warning names it, source analysis-fallback');

    // ── V3: 화면이 알렸으면 검토 상태의 Fy ──
    await page('caseHello', { inputs: null, drafts: { templateType: 'lippedc', tplH: 8, tplB: 2.5, tplD: 0.625, tplT: 0.059, tplR: 0 } });
    clearPrepared();
    const runs0 = (await ai({ action: 'get_case_status', detail: 'runs' })).history.filter((x) => x.kind === 'design_dsm').length;
    engine.length = 0;
    await page('prepareDesignDsm', { member_type: 'flexure', Fy: fyRT });
    assert.strictEqual(sent('analyze*').length, 1, 'page prepare solves once');
    assert.strictEqual(p._preparedDesignDsm.fy_analysis, 50, 'prepared with the host Fy ' + p._preparedDesignDsm.fy_analysis);
    assert(p._preparedDesignDsmSig.endsWith('"fy":50}'), 'the signature (the run\'s request) carries Fy 50');
    const runs1 = (await ai({ action: 'get_case_status', detail: 'runs' })).history.filter((x) => x.kind === 'design_dsm').length;
    assert.strictEqual(runs1, runs0 + 1, 'one design_dsm run');
    const r3 = await check('member check after the page prepare');
    assert(sent('analyze*').length === 0 && r3.case_check.buckling_values.source === 'fsm-current', 'the member check reuses it (no second solve) ' + JSON.stringify(r3.case_check.buckling_values));
    notes.push(`V3: page Fy ${fyRT} → prepared with 50, one solve, member check fsm-current`);

    // ── V4: 저장 · 열기 ──
    const file = path.join(box, 'v4.csd');
    const prepSaved = p._preparedDesignDsm;
    ok(await p.__testWriteProjectFile(file), 'save');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(saved.preparedDesignDsm && /^sha256:[0-9a-f]{64}$/.test(saved.preparedDesignDsm.design_signature), 'saved with its signature');
    const reopen = (f) => { const r = p.__testLoadProjectFile(f); assert(!r.error, 'open ' + r.error); return r; };
    reopen(file);
    assert(p._preparedDesignDsm && !('design_signature' in p._preparedDesignDsm) && p._preparedDesignDsmSig === sig0
      && !p._ledgerList().some((e) => e.kind === 'design_dsm'), 'reopen restores the current values (signature matches)');
    assert.deepStrictEqual(p._preparedDesignDsm.Mxx, prepSaved.Mxx, 'same values');
    const r4 = await check('check after reopen');
    assert(sent('analyze*').length === 0 && r4.case_check.buckling_values.source === 'fsm-current', 'reused after reopen');
    // 서명을 바꿔 저장(봉인은 그 값과 함께 — 정직한 봉인) → 되살리지 않는다
    const realHash = S._designDsmSigHash;
    const variant = async (name, h) => { S._designDsmSigHash = h; try { return await p.__testWriteProjectFile(path.join(box, name)); } finally { S._designDsmSigHash = realHash; } };
    ok(await variant('v4-other.csd', () => 'sha256:' + '0'.repeat(64)), 'save with another signature');
    reopen(path.join(box, 'v4-other.csd'));
    let l = p._ledgerList().find((e) => e.kind === 'design_dsm');
    assert(!p._preparedDesignDsm && l && /do not match the opened model/.test(l.reason), 'a different signature is not restored ' + JSON.stringify(l));
    ok(await check('prepare again'), 'prepare again');
    ok(await variant('v4-old.csd', () => undefined), 'save like an older build (no signature)');
    const old = JSON.parse(fs.readFileSync(path.join(box, 'v4-old.csd'), 'utf8'));
    assert(old.preparedDesignDsm && !('design_signature' in old.preparedDesignDsm), 'the old-build file has no signature');
    reopen(path.join(box, 'v4-old.csd'));
    l = p._ledgerList().find((e) => e.kind === 'design_dsm');
    assert(!p._preparedDesignDsm && l && /carry no signature/.test(l.reason), 'an old file without a signature is not restored ' + JSON.stringify(l));
    // 지금 것이 아닌 값은 쓰지 않는다
    ok(await check('prepare once more'), 'prepare once more');
    p._preparedDesignDsmSig = 'not-current';
    ok(await p.__testWriteProjectFile(path.join(box, 'v4-stale.csd')), 'save stale');
    assert(!JSON.parse(fs.readFileSync(path.join(box, 'v4-stale.csd'), 'utf8')).preparedDesignDsm, 'values that are not current are not written');
    notes.push('V4: saved with design_signature; reopen restores only when it matches; other / missing signature → not restored + ledger; stale values not written');
  } finally {
    ctx.close();
    S.writerKeyDir = saveKey; S.projectRoots = saveRoots;
    try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`design_chain_verify_contract: PASS (${notes.join('; ')})`);
}
main().catch((e) => { console.error('design_chain_verify_contract: FAIL', e && e.stack ? e.stack : e); process.exitCode = 1; });
