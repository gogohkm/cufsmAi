/* global process, Buffer */
// 남은 작업(2026-11-25) 호스트 단계 H-A — 설계 사슬 · 새 입력(docs/implementation/20261125-remaining-work-worklog.md 결정 R1 · R2 · R4 · R8).
// 진짜 패널 · 파이썬 · MCP 다리(포트 파일 + 토큰) · 진짜 MCP 서버(소스).
//   node test/webview/design_chain_contract.js
//  A1(R1) 좌굴 해석을 한 번도 하지 않은 대상 — 화면의 「설계 검토 실행」 · MCP aisi_design_flexure · run_case_check 가 모두 그 자리에서
//         준비한 S-S 서명곡선 FSM 값으로(같은 판정비), 그 design_dsm 실행의 행위자 = 부른 쪽, 「FSM 없음」 자동 가정 · 경고가 없다.
//         원형관은 준비하지 않고 대체(해석식 + 까닭)
//  A2(R8) 설계 준비의 반파장 = 엔진의 design_signature_lengths(S-S · m = 1 · neigs 10) — 보기용 길이 · BC · 고유치 수가 달라도 같은 값,
//         그것만 바꾸면 준비된 값이 낡지 않는다. 재료 E 를 바꾸면 낡는다
//  A3(R2) 랩 — 처음 본문에 lap_force_model_confirmed 가 없다 · 패스너 무리는 판정 없음(까닭), 밝히면 본문에 true · 판정
//  A4(R4) 하중조합의 기준 — 처음 본문은 그대로, 고르면 엔진에 가고 결과가 그 기준, 모르는 값은 거절, 무효화 범위 load
//  A5     빈 길이 — 요약의 limit_state_checks 항목이 pass null · reference_only, 실행의 max_ratio · 지배가 없다, 검증 목록 · 보고서가 판정 없음
//  A6     설계 도구가 쓴 입력이 다른 결과의 입력이면 그 결과가 낡는다(그 도구가 만든 결과는 남는다)
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
  if (!ctx) { console.log('design_chain_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const S = ctx.StcfsdPanel;
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_hA_'));
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
  const client = new Client({ name: 'hA-test', version: '1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(mdir, 'server.js')], env, stderr: 'pipe' }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content && r.content[0] && r.content[0].text) || '';
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { isError: !!r.isError, data, bytes: Buffer.byteLength(text), text };
  };
  const tool = async (name, args) => {
    const r = await call(name, args);
    if (r.isError || (r.data && r.data.error)) { throw new Error(`${name}: ${r.text.slice(0, 500)}`); }
    return r.data;
  };
  const scope = ctx.load(path.join('src', 'mcp', 'actorScope.ts'));
  const ai = (o) => scope.runAs({ kind: 'ai', client: 'hA-test/1' }, () => p.handleMcpAction(o));
  const page = (command, data) => scope.runAs({ kind: 'person' }, () => p.__testDispatchMessage({ command, data }));
  const ok = (r, what) => { assert(r && !r.error, `${what}: ${JSON.stringify(r).slice(0, 500)}`); return r; };
  const history = async () => (await ai({ action: 'get_case_status', detail: 'runs' })).history || [];
  const ratios = (r) => (r.design_checks || []).map((c) => [c.id, c.verdict, c.ratio]);
  const R = ctx.load(path.join('src', 'case', 'requests.ts'));
  // 엔진 요청(파이썬으로 가는 것)
  const engine = [];
  const realCall = p._pythonBridge.call.bind(p._pythonBridge);
  p._pythonBridge.call = (method, params) => {
    engine.push({ method, params: JSON.parse(JSON.stringify(params ?? null)) });
    return realCall(method, params);
  };
  const realAnalyze = p._pythonBridge.analyze.bind(p._pythonBridge);
  p._pythonBridge.analyze = (params) => { engine.push({ method: 'analyze*', params: JSON.parse(JSON.stringify(params)) }); return realAnalyze(params); };
  const sent = (method) => engine.filter((e) => e.method === method);
  const clearPrepared = () => { p._preparedDesignDsm = null; p._preparedDesignDsmSig = ''; p._preparedDesignDsmAt = null; };
  const NO_FSM_CODES = /member\.assumption\.(mcrl_fsm_appendix|mcrd_fsm_appendix|pcrl_fsm_appendix_fcrl|pcrd_fsm_appendix_fcrd)|member\.warning\.(mcrl_mcrd_fsm_run|pcrl_pcrd_fsm_run)/;
  try {
    ok(await ai({ action: 'open_project', name: 'HA', create: true }), 'open_project');
    ok(await ai({ action: 'new_case', name: 'C', kind: 'section-only' }), 'new_case C');
    ok(await ai({ action: 'open_case', name: 'C' }), 'open C');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 } }), 'template');
    ok(await ai({ action: 'set_case_inputs', inputs: { memberType: 'flexure', fy: 50, fu: 65, Lb: 60, Cb: 1, Mux: 20, Vu: 1, wcN: null } }), 'inputs');
    assert(!p.__testGetState().lastAnalysisMeta, 'no buckling analysis in this case');

    // ── A1: 세 길 — 화면 단추(사람), MCP(AI), run_case_check(AI) ──
    let h0 = (await history()).length;
    const body = p._caseRequest(R.buildDesignRequest, await p._caseHostProps()).data;
    p.__testClearPostedMessages();
    engine.length = 0;
    await page('runDesign', body);
    const rPage = ctx.posted('designResult').pop().data;
    assert(rPage && !rPage.error && rPage.dsm_basis === 'prepared' && rPage.dsm_basis_by_family.Mxx === 'prepared' && !rPage.dsm_warning,
      'screen button: FSM values prepared on the spot ' + JSON.stringify({ b: rPage.dsm_basis, w: rPage.dsm_warning, e: rPage.error }));
    let h = await history();
    assert.strictEqual(h.length, h0 + 2, 'one design_dsm + one member_design');
    assert(h[1].kind === 'design_dsm' && h[1].by === 'person' && h[0].kind === 'member_design', 'the prepare run is by the person who pressed the button ' + JSON.stringify(h.slice(0, 2)));
    // A2: 설계 준비의 해석 = 엔진의 설계 격자 101 개 · S-S · m 자동(=1) · 고유치 10
    const grid = sent('design_signature_lengths');
    const prepAnalyses = sent('analyze*');
    assert(grid.length >= 1 && prepAnalyses.length === 1, 'one grid call and one signature solve: ' + engine.map((e) => e.method).join(','));
    const pa = prepAnalyses[0].params;
    assert(pa.lengths.length === 101 && pa.BC === 'S-S' && pa.m_all === 'auto' && pa.neigs === 10, 'design grid: ' + JSON.stringify({ n: pa.lengths.length, BC: pa.BC, m: pa.m_all, neigs: pa.neigs }));
    const designDsm = sent('aisi_design')[0].params.dsm;
    assert(designDsm.Mcrl > 0 && designDsm.Mcrd > 0, 'the engine got FSM Mcrl / Mcrd ' + JSON.stringify(designDsm).slice(0, 200));
    assert(!NO_FSM_CODES.test(JSON.stringify(rPage)), 'no "no FSM" assumption / warning codes in the result');
    clearPrepared();
    h0 = (await history()).length;
    const rMcp = await tool('aisi_design_flexure', { Fy: 50, Lb: 60, Cb: 1, Mu: 20, detail: 'full' });
    h = await history();
    assert(rMcp.dsm_basis === 'prepared' && h.length === h0 + 2 && h[1].kind === 'design_dsm' && h[1].by === 'ai', 'MCP: prepared, by ai ' + JSON.stringify(h.slice(0, 2)));
    assert.deepStrictEqual(ratios(rMcp), ratios(rPage), 'MCP = screen button (same FSM values, same ratios)');
    clearPrepared();
    const rCase = ok(await ai({ action: 'run_case_check', what: 'member' }), 'run_case_check');
    assert(rCase.case_check.buckling_values.source === 'fsm-prepared-now', 'run_case_check: prepared now ' + JSON.stringify(rCase.case_check));
    assert.deepStrictEqual(ratios(rCase), ratios(rPage), 'run_case_check = screen button');
    const rCase2 = ok(await ai({ action: 'run_case_check', what: 'member' }), 'run_case_check again');
    assert(rCase2.case_check.buckling_values.source === 'fsm-current', 'second check reuses ' + JSON.stringify(rCase2.case_check.buckling_values));
    // 자동 가정: 「FSM 없음」(엔진 자체 가정)이 등록부에 없다
    const asm = await ai({ action: 'assumptions', op: 'list' });
    assert(!NO_FSM_CODES.test(JSON.stringify(asm)), 'no automatic "no FSM" assumption: ' + JSON.stringify(asm).slice(0, 300));
    notes.push(`A1: screen / MCP / run_case_check all prepared FSM (Mcrl ${designDsm.Mcrl.toFixed(3)}, Mcrd ${designDsm.Mcrd.toFixed(3)} kip-in), same ratios, prepare runs by person / ai`);

    // ── A2: 보기용 조건만 바꾸면 준비된 값이 그대로 ──
    const prep0 = p._preparedDesignDsm; const sig0 = p._preparedDesignDsmSig;
    ok(await ai({ action: 'set_lengths', min: 1, max: 200, n: 12 }), 'set_lengths');
    ok(await ai({ action: 'set_bc', BC: 'C-C' }), 'set_bc');
    ok(await ai({ action: 'set_load_case', load_case: 'compression', fy: 50 }), 'set_load_case');
    ok(await ai({ action: 'run_analysis', neigs: 12 }), 'run_analysis');
    assert(p._preparedDesignDsm === prep0 && p._preparedDesignDsmSig === sig0, 'display lengths / BC / load case / neigs / a new analysis keep the prepared values');
    assert(!p._ledgerList().some((e) => e.kind === 'design_dsm'), 'no design_dsm line in the ledger');
    const n0 = (await history()).filter((x) => x.kind === 'design_dsm').length;
    const rAfter = ok(await ai({ action: 'run_case_check', what: 'member' }), 'check after display changes');
    assert(rAfter.case_check.buckling_values.source === 'fsm-current' && (await history()).filter((x) => x.kind === 'design_dsm').length === n0, 'no new prepare');
    assert.deepStrictEqual(ratios(rAfter), ratios(rPage), 'same ratios after the display changes');
    // 다른 보기용 격자에서 처음부터 준비해도 같은 값
    clearPrepared();
    ok(await ai({ action: 'set_bc', BC: 'S-S' }), 'set_bc S-S');
    ok(await ai({ action: 'set_lengths', min: 0.5, max: 500, n: 80 }), 'set_lengths fine');
    ok(await ai({ action: 'prepare_design_dsm', member_type: 'flexure', Fy: 50 }), 'prepare (fine display grid)');
    assert.deepStrictEqual([p._preparedDesignDsm.Mxx.crl, p._preparedDesignDsm.Mxx.crd, p._preparedDesignDsm.Mxx.Lcrl, p._preparedDesignDsm.Mxx.Lcrd],
      [prep0.Mxx.crl, prep0.Mxx.crd, prep0.Mxx.Lcrl, prep0.Mxx.Lcrd], 'prepared values do not depend on the display grid');
    // 재료 E 를 바꾸면 낡는다
    ok(await ai({ action: 'set_material', E: 29000, v: 0.3 }), 'set_material');
    assert(p._preparedDesignDsm === null && p._ledgerList().some((e) => e.kind === 'design_dsm'), 'a material change drops the prepared values');
    notes.push(`A2: design grid 101 × S-S, neigs 10; display lengths / BC / neigs / analysis keep the values, a fine display grid gives the same Mcrl ${prep0.Mxx.crl.toFixed(4)}; E drops them`);
    ok(await ai({ action: 'set_material', E: 29500, v: 0.3 }), 'set_material back');

    // ── A1: 원형관 — 준비하지 않고 대체 ──
    ok(await ai({ action: 'new_case', name: 'T', kind: 'section-only' }), 'new_case T');
    ok(await ai({ action: 'open_case', name: 'T' }), 'open T');
    ok(await ai({ action: 'generate_template', section_type: 'chs', params: { OD: 4, t: 0.1 } }), 'chs');
    ok(await ai({ action: 'set_case_inputs', inputs: { memberType: 'compression', fy: 50, fu: 65, KxLx: 100, KyLy: 100, KtLt: 100, Pu: 5 } }), 'inputs T');
    engine.length = 0;
    const rT = ok(await ai({ action: 'run_case_check', what: 'member' }), 'round tube');
    assert(sent('design_signature_lengths').length === 0 && rT.dsm_basis_by_family.P === 'none' && rT.case_check.buckling_values.source === 'analytical'
      && /round tube/.test(rT.case_check.buckling_values.note) && /Round tube/.test(rT.dsm_warning || ''), 'round tube falls back ' + JSON.stringify({ cc: rT.case_check, w: rT.dsm_warning }));
    notes.push('A1: round tube is not prepared (analytical, the note says why)');

    // ── A5: 빈 길이 — 참고 비는 판정 · 최대 판정비 · 지배가 아니다 ──
    ok(await ai({ action: 'set_case_inputs', inputs: { KtLt: null } }), 'KtLt blank');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 } }), 'lipped C for T');
    const sm = await tool('aisi_design_compression', { Fy: 50, Pu: 5, KxLx: 100, KyLy: 100 });
    const lsc = sm.limit_state_checks || [];
    const ax = lsc.find((c) => /axial/.test(c.name));
    assert(sm.pass === null && ax && ax.pass === null && ax.reference_only === true && ax.length_assumed === true && ax.reason_code === 'member.reason.assumed_length_reference_only' && ax.reason,
      'summary: the axial item is not evaluated with its reason ' + JSON.stringify(lsc));
    const last = (await history())[0];
    assert(last.kind === 'member_design' && last.max_ratio === null && (last.governing || []).length === 0, 'the run has no max_ratio / governing ' + JSON.stringify(last));
    const val = ok(await ai({ action: 'validate_design' }), 'validate');
    const dcr = (val.items || val.validation || []).find((c) => c.item === '이용률 (DCR)');
    assert(dcr && dcr.status === 'warn' && /판정 없음 — 길이를 주지 않음/.test(dcr.value), 'validation: no verdict ' + JSON.stringify(dcr));
    const rv = p.__testReview('US');
    assert(/판정 아님 — 가정한 길이의 참고 비/.test(rv.reportHtml) && rv.reportDoc.verdict.utilization === null, 'report: reference ratio, no utilization');
    notes.push(`A5: KtLt blank → summary item pass null reference_only (${ax.ratio}), run max_ratio null, validation 「${dcr.value}」`);
    // 엔진 둘째 판: 길이와 상관없는 하한이 넘는 NG — 판정비 · 지배는 그 하한의 것(맨 위 utilization 은 가정한 길이의 수)
    const bf = await tool('aisi_design_compression', { Fy: 50, Pu: 60, KxLx: 100, KyLy: 100 });
    const lib = bf.length_independent_bound;
    assert(bf.pass === false && lib && lib.ratio > 1 && bf.utilization_valid === false && bf.utilization !== lib.ratio, 'bound failure ' + JSON.stringify({ p: bf.pass, u: bf.utilization, lib }));
    assert(/FAILS at every length/.test(bf.utilization_note || '') && bf.utilization_note.includes(lib.governing_check_id || lib.governing_check), 'summary note names the bound ' + bf.utilization_note);
    const lastB = (await history())[0];
    assert(lastB.kind === 'member_design' && lastB.max_ratio === lib.ratio && (lastB.governing || {}).id === (lib.governing_check_id || lib.governing_check),
      'the run: the bound ratio and its check ' + JSON.stringify(lastB));
    const valB = ok(await ai({ action: 'validate_design' }), 'validate bound');
    const dcrB = (valB.items || valB.validation || []).find((c) => c.item === '이용률 (DCR)');
    assert(dcrB && dcrB.status === 'fail' && dcrB.value.startsWith((lib.ratio * 100).toFixed(1) + '%'), 'validation shows the bound ratio ' + JSON.stringify(dcrB));
    const rvB = p.__testReview('US');
    assert(rvB.reportDoc.verdict.utilization.value === lib.ratio && rvB.reportDoc.verdict.governing === (lib.governing_check_id || lib.governing_check), 'report verdict: bound ratio ' + JSON.stringify(rvB.reportDoc.verdict));
    notes.push(`A5b: Pu 60 with KtLt blank → NG on the bound ${lib.governing_check_id || lib.governing_check} ${lib.ratio.toFixed(3)} (run · validation · report · MCP note), not the assumed ${bf.utilization}`);

    // ── A4: 하중조합의 기준 ──
    ok(await ai({ action: 'new_case', name: 'P', kind: 'roof-purlin' }), 'new_case P');
    ok(await ai({ action: 'open_case', name: 'P' }), 'open P');
    ok(await ai({ action: 'generate_template', section_type: 'lippedz', params: { H: 8, B: 2.5, D: 0.7, t: 0.059, r: 0.1 } }), 'Z');
    const loadArgs = { member_app: 'roof-purlin', span_type: 'simple', span_ft: 20, spacing_ft: 5, loads: { D: 30, Lr: 60, W: -80 }, Fy: 50, Fu: 65 };
    engine.length = 0;
    const la0 = await tool('analyze_loads', loadArgs);
    const b0 = sent('analyze_loads')[0].params;
    assert(!('load_combination_standard' in b0) && !(la0.load_combination_standard && la0.load_combination_standard.key), 'default body unchanged (no key) ' + JSON.stringify(la0.load_combination_standard));
    for (const std of ['asce7_22', 'kds_41_12_00']) {
      engine.length = 0;
      const la = await tool('analyze_loads', { ...loadArgs, load_combination_standard: std });
      assert.strictEqual(sent('analyze_loads')[0].params.load_combination_standard, std, `${std} reaches the engine`);
      assert.strictEqual(la.load_combination_standard.key, std, `${std} result`);
      assert.strictEqual(p.__testGetCase().state.inputs.loadComboStandard, std, 'case input written');
      engine.length = 0;
      ok(await ai({ action: 'run_case_check', what: 'loads' }), 'run_case_check loads');
      assert.strictEqual(sent('analyze_loads')[0].params.load_combination_standard, std, 'the screen\'s request carries it too');
    }
    const bad = await call('analyze_loads', { ...loadArgs, load_combination_standard: 'asce7_16' });
    assert(bad.isError && /asce7_10/.test(bad.text), 'asce7_16 rejected, allowed values named ' + bad.text.slice(0, 200));
    const sci = await ai({ action: 'set_case_inputs', inputs: { loadComboStandard: 'foo' } });
    assert(sci.rejected && sci.rejected.length === 1, 'unknown value rejected ' + JSON.stringify(sci));
    const sci2 = ok(await ai({ action: 'set_case_inputs', inputs: { loadComboStandard: 'asce7_10' } }), 'back to default');
    assert(sci2.invalidated.includes('load'), 'invalidation scope load ' + JSON.stringify(sci2.invalidated));
    engine.length = 0;
    ok(await ai({ action: 'run_case_check', what: 'loads' }), 'default again');
    assert(!('load_combination_standard' in sent('analyze_loads')[0].params), 'default body has no key');
    notes.push('A4: default body without the key; asce7_22 / kds_41_12_00 reach the engine (tool and screen request); asce7_16 / foo rejected; scope load');

    // ── A3: 랩의 힘 분배 진술 ──
    const lapArgs = { d: 8, t: 0.059, Fy: 50, Fu: 65, lap_left_in: 12, lap_right_in: 12, Mu_support: 30, Vu_support: 2, fastener_type: 'screw', fastener_dia: 0.19, n_rows: 2, Pnvs: 1.2 };
    engine.length = 0;
    const lap0 = await tool('design_lap_connection', lapArgs);
    const lb0 = sent('lap_connection')[0].params;
    assert(!('lap_force_model_confirmed' in lb0), 'default lap body has no statement');
    const fg0 = (lap0.check_lines || []).find((c) => c.id === 'lap.fastener_group');
    assert(fg0 && (fg0.verdict === 'not_evaluated' || fg0.verdict === 'fail'), 'fastener group not a pass without the statement ' + JSON.stringify(fg0));
    if (fg0.verdict === 'not_evaluated') { assert(/force_model_not_confirmed/.test(JSON.stringify(lap0)), 'reason named'); }
    assert(lap0.pass !== true, 'lap cannot pass without the statement');
    if (lap0.pass === null) {
      // 엔진 둘째 판: 판정 없는 랩은 utilization_valid false — 실행의 최대 판정비 · 지배가 없다(부재와 같게)
      const lapRun = (await history())[0];
      assert(lap0.utilization_valid === false && lapRun.kind === 'lap' && lapRun.max_ratio === null && !lapRun.governing,
        'a lap result without a verdict has no max_ratio / governing ' + JSON.stringify({ uv: lap0.utilization_valid, run: lapRun }));
    }
    // 새 알림이 요약(한국어 글 + code)과 보고서에
    const fmw = JSON.stringify(lap0).match(/"code":"lap\.warning\.force_model_not_confirmed","text":"([^"]+)"/);
    assert(fmw, 'summary names lap.warning.force_model_not_confirmed with its text');
    const repLap = p.__testReview('US').reportHtml;
    assert(repLap.includes(fmw[1].slice(0, 20)), 'the report shows the force-model notice: ' + fmw[1].slice(0, 60));
    engine.length = 0;
    const lap1 = await tool('design_lap_connection', { ...lapArgs, lap_force_model_confirmed: true });
    assert.strictEqual(sent('lap_connection')[0].params.lap_force_model_confirmed, true, 'statement reaches the engine');
    assert.strictEqual(p.__testGetCase().state.inputs.lapForceModelConfirmed, true, 'case input written');
    const fg1 = (lap1.check_lines || []).find((c) => c.id === 'lap.fastener_group');
    assert(fg1 && (fg1.verdict === 'pass' || fg1.verdict === 'fail'), 'with the statement: a verdict ' + JSON.stringify(fg1));
    engine.length = 0;
    ok(await ai({ action: 'run_case_check', what: 'lap' }), 'run_case_check lap');
    assert.strictEqual(sent('lap_connection')[0].params.lap_force_model_confirmed, true, 'screen request carries the statement');
    notes.push(`A3: fastener group ${fg0.verdict} without the statement, ${fg1.verdict} with it (body key only when true)`);

    // ── A6: 랩 도구의 Fy → 부재 설계가 낡는다 · 랩은 남는다 ──
    ok(await ai({ action: 'set_case_inputs', inputs: { memberType: 'flexure', Lb: 60, Cb: 1, Mux: 20 } }), 'flexure inputs');
    ok(await ai({ action: 'run_case_check', what: 'member' }), 'member design present');
    ok(await ai({ action: 'run_case_check', what: 'lap' }), 'lap present');
    const st0 = p._resultsStatus();
    assert(st0.member_design && st0.lap, 'both present');
    const lapFy = await tool('design_lap_connection', { ...lapArgs, Fy: 55, lap_force_model_confirmed: true });
    const st1 = p._resultsStatus();
    assert(!st1.member_design && st1.lap && (lapFy.case_results_invalidated || []).includes('member_design'), 'lap tool Fy → member design stale, lap kept ' + JSON.stringify(lapFy.case_results_invalidated));
    const led = p._ledgerList().find((e) => e.kind === 'member_design');
    assert(led && led.cause.action === 'design_lap_connection' && led.cause.inputs.includes('fy'), 'ledger names the tool and fy ' + JSON.stringify(led));
    ok(await ai({ action: 'run_case_check', what: 'member' }), 'member again');
    const fl = await tool('aisi_design_flexure', { Fy: 50, Lb: 60, Cb: 1, Mu: 20 });
    const st2 = p._resultsStatus();
    assert(st2.member_design && !st2.lap && (fl.case_results_invalidated || []).includes('lap'), 'flexure tool Fy → lap stale, member kept ' + JSON.stringify(fl.case_results_invalidated));
    const same = await tool('aisi_design_flexure', { Fy: 50, Lb: 60, Cb: 1, Mu: 20 });
    assert(!same.case_results_invalidated, 'nothing written → nothing invalidated');
    notes.push('A6: design_lap_connection Fy 55 → member_design stale (lap kept); aisi_design_flexure Fy 50 → lap stale (member kept)');
  } finally {
    try { await client.close(); } catch { /* */ }
    try { await bridge.stop(); } catch { /* */ }
    ctx.close();
    S.writerKeyDir = saveKey; S.projectRoots = saveRoots;
    try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`design_chain_contract: PASS (${notes.join('; ')})`);
}
main().catch((e) => { console.error('design_chain_contract: FAIL', e && e.stack ? e.stack : e); process.exitCode = 1; });
