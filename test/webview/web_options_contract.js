/* global process, Buffer */
// 2026-11-26 구멍 · 횡방향 웹 보강재 · 비틀림(§H4) — 호스트 단계 H(docs/implementation/20261126-holes-stiffeners-torsion-worklog.md 결정 T1 – T7).
// 진짜 패널 · 파이썬 · MCP 다리(포트 파일 + 토큰) · 진짜 MCP 서버(소스).
//   node test/webview/web_options_contract.js
//  W0 순수: 세 구역이 「없음」 이면 본문에 아무것도 없다(처음 본문 = 새 칸이 없던 본문), 고른 구역의 키 · 차례, 빈 dh 는 막고 빈 간격은 보내지 않는다,
//     압축은 §E 의 키만, 퍼린 범위는 §H4 를 넣지 않는다, MCP 인자 → 검토 상태(구역을 연다 · 모양 없는 구멍 인자는 계산하지 않는다)
//  W1 구멍(템플릿 C): 화면 단추와 MCP aisi_design_flexure 의 엔진 본문이 같다(키 · 단위 · 단면 모델 node · elem · element_roles · prop),
//     holes 를 평가 — §F2.2 · §F3.2.2 · §F4.2 · §G3 · §G6 의 조항 갈래, 검증 목록 · 보고서의 줄. 압축도
//  W2 요소 자리가 없는 단면(직접 그린 단면) — 「웹을 가려낼 수 없음」 으로 평가하지 못함, 검증 목록이 그 까닭을 적는다
//  W3 보강재: 자료 없이 「있음」 → 보강된 웹의 전단 · §G4.1 평가하지 못함(참고값), 자료가 있으면 §G2.2 · §G4.1 판정
//  W4 §H4: 길 ① 응력 · 길 ② 편심 하중(단면 모델) — 화면 본문 = MCP 본문, R · 지배 점
//  W5 퍼린 사슬: 구간 검토에 구멍 · 보강재 키와 단면 모델이 가고 §H4 는 가지 않는다, 정모멘트 구간은 데크 스프링과 함께
//  W6 SI: mm · MPa 로 준 인자가 US 와 같은 엔진 본문, 새 묶음(holes · torsion · web_stiffeners · shear · web_crippling)에 모르는 수가 없다,
//     요약에 근거(holes_basis …)와 새 검토 줄, 예산 안. 무효화 범위 design · 준비된 총단면 좌굴값은 남는다
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
const DS = require(path.join(ROOT, 'webview', 'js', 'designState.js'));
const notes = [];
const KB = 1024;

function pureChecks() {
  const get = (o) => (k) => (k in o ? o[k] : DS.defaultValue(k));
  // 처음 값: 아무것도 없다
  for (const s of ['compression', 'flexure', 'combined', 'purlin', 'tension']) {
    assert.deepStrictEqual(DS.memberWebOptions(get({}), s), { data: {}, missing: [], invalid: [] }, `defaults send nothing (${s})`);
  }
  // H2 후속: 칸의 규칙(validateValue — 엔진의 값 규칙과 같다) — 0 이하 · 음수는 상태가 받지 않고, 화면 · 호스트 본문은 보내지 않고 막는다
  for (const [k, bad, good] of [['stiffenerFy', -50, 50], ['stiffenerFy', 0, 36], ['stiffenerIs', 0, 0.05], ['stiffenerArea', -1, 0.5], ['stiffenerSpacing', 0, 10],
    ['holeDepth', 0, 1.5], ['holeLength', -4.5, 4.5], ['holeSpacing', 0, 24], ['torsionSpan', -1, 300], ['holeEndDistance', -1, 0], ['holeCornerRadius', -0.1, 0]]) {
    assert(/0 (보다 커야|이상이어야)/.test(DS.validateValue(k, bad) || ''), `${k} = ${bad} rejected: ${DS.validateValue(k, bad)}`);
    assert.strictEqual(DS.validateValue(k, good), null, `${k} = ${good} accepted`);
  }
  assert.strictEqual(DS.validateValue('holeWebOffset', -0.3), null, 'the hole offset may be negative');
  assert.strictEqual(DS.validateValue('torsionEccentricity', -1.05), null, 'the eccentricity may be negative');
  const inv = DS.memberWebOptions(get({ stiffenerMode: 'present', stiffenerSpacing: 10, stiffenerKind: 'pair', stiffenerIs: 0.05, stiffenerArea: 0.5, stiffenerFy: -50 }), 'flexure');
  assert(!('stiffener_Fy' in inv.data) && inv.invalid.length === 1 && inv.invalid[0].key === 'stiffenerFy' && inv.invalid[0].label === '보강재 Fy'
    && inv.invalid[0].rule === 'positive' && inv.missing.length === 0, 'invalid stiffener Fy: not sent, named ' + JSON.stringify(inv));
  const invDh = DS.memberWebOptions(get({ holeShape: 'circular', holeDepth: 0 }), 'compression');
  assert(invDh.invalid.length === 1 && invDh.missing.length === 0 && !('hole_depth' in invDh.data), 'dh = 0: invalid, not reported as blank too');
  // 엔진의 잘못된 입력 오류 → 사람이 읽는 글(어느 구역 · 칸 · 무엇이)
  const U = require(path.join(ROOT, 'webview', 'js', 'utils.js'));
  const et = U.inputErrorText('stiffeners: stiffener_Fy must be > 0 (ksi), got -1');
  assert(/횡방향 웹 보강재/.test(et) && /「보강재 Fy」/.test(et) && /0 보다 큰 수여야/.test(et), 'input error text ' + et);
  assert.strictEqual(U.inputErrorText('No section defined.'), null, 'other errors are left to the caller');
  const holes = { holeShape: 'noncircular', holeDepth: 1.5, holeLength: 4.5, holeSpacing: null, holeCornerRadius: 0.25, holeEndDistance: 9.75,
    holeBearingDistance: 7.25, holeWebOffset: null, holeWithinBearing: false, holeEdgeStiffened: false };
  const f = DS.memberWebOptions(get(holes), 'flexure');
  assert.deepStrictEqual(f.data, { hole_shape: 'noncircular', hole_depth: 1.5, hole_length: 4.5, hole_end_distance: 9.75, hole_corner_radius: 0.25,
    hole_bearing_distance: 7.25 }, 'flexure: hole keys in order, blank spacing / offset absent ' + JSON.stringify(f.data));
  const c = DS.memberWebOptions(get(holes), 'compression');
  assert.deepStrictEqual(Object.keys(c.data), ['hole_shape', 'hole_depth', 'hole_length'], 'compression: §E keys only');
  const circ = DS.memberWebOptions(get({ ...holes, holeShape: 'circular' }), 'flexure');
  assert(!('hole_length' in circ.data) && !('hole_corner_radius' in circ.data), 'circular: Lh = dh and no corner radius sent');
  const miss = DS.memberWebOptions(get({ holeShape: 'noncircular' }), 'flexure');
  assert.deepStrictEqual(miss.missing.map((m) => m.key), ['holeDepth', 'holeLength'], 'blank dh / Lh with a shape are blocked');
  const st = DS.memberWebOptions(get({ stiffenerMode: 'present' }), 'flexure');
  assert.deepStrictEqual(st.data, { transverse_stiffeners: true }, 'stiffeners without data: only the statement (the engine reports not evaluated)');
  assert.deepStrictEqual(DS.memberWebOptions(get({ stiffenerMode: 'present' }), 'compression').data, {}, 'no stiffeners in compression');
  const ta = { torsionMode: 'direct', torsionFBending: -4.1, torsionFTorsion: -1.29, torsionEccentricity: 1, torsionAtJunction: true };
  assert.deepStrictEqual(DS.memberWebOptions(get(ta), 'combined').data, { torsion_f_bending: -4.1, torsion_f_torsion: -1.29, torsion_at_web_flange_junction: true },
    'route (a) keys only');
  assert.deepStrictEqual(DS.memberWebOptions(get(ta), 'purlin').data, {}, 'no §H4 in the purlin chain (T6)');
  const tb = { torsionMode: 'eccentric', torsionEccentricity: 1.05, torsionSpan: 300, torsionLoad: 'uniform', torsionSupport: 'simple', torsionFBending: 3 };
  assert.deepStrictEqual(DS.memberWebOptions(get(tb), 'flexure').data, { torsion_eccentricity: 1.05, torsion_span: 300, torsion_load: 'uniform', torsion_support: 'simple' },
    'route (b) keys only');
  // 표: 세 구역의 칸은 모두 설계 범위(낡히는 것은 부재 설계)
  const keys = DS.FIELDS.filter((r) => ['holes', 'stiffeners', 'torsion'].includes(r[4].group)).map((r) => r[0]);
  assert.strictEqual(keys.length, 25, 'new fields ' + keys.length);
  assert.deepStrictEqual(DS.invalidationScope(keys), { scope: 'design', analysisAtRun: false }, 'invalidation scope design');
  notes.push(`W0: ${keys.length} fields, none → nothing sent, keys / order / missing / scopes as designed`);
}

async function main() {
  pureChecks();
  const ctx = await createPanel();
  if (!ctx) { console.log('web_options_contract: PASS (pure part) — SKIP the panel part: no .venv python'); return; }
  const p = ctx.panel;
  const S = ctx.StcfsdPanel;
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_web_'));
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
  const client = new Client({ name: 'web-test', version: '1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(mdir, 'server.js')], env, stderr: 'pipe' }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content && r.content[0] && r.content[0].text) || '';
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { isError: !!r.isError, data, bytes: Buffer.byteLength(text), text };
  };
  const tool = async (name, args) => {
    const r = await call(name, args);
    if (r.isError || (r.data && r.data.error)) { throw new Error(`${name}: ${r.text.slice(0, 600)}`); }
    return r;
  };
  const scope = ctx.load(path.join('src', 'mcp', 'actorScope.ts'));
  const ai = (o) => scope.runAs({ kind: 'ai', client: 'web-test/1' }, () => p.handleMcpAction(o));
  const page = (command, data) => scope.runAs({ kind: 'person' }, () => p.__testDispatchMessage({ command, data }));
  const ok = (r, what) => { assert(r && !r.error, `${what}: ${JSON.stringify(r).slice(0, 600)}`); return r; };
  const R = ctx.load(path.join('src', 'case', 'requests.ts'));
  const engine = [];
  const realCall = p._pythonBridge.call.bind(p._pythonBridge);
  p._pythonBridge.call = (method, params) => {
    engine.push({ method, params: JSON.parse(JSON.stringify(params ?? null)) });
    return realCall(method, params);
  };
  const sent = (method) => engine.filter((e) => e.method === method);
  const check = (r, id) => (r.design_checks || []).find((c) => c.id === id) || null;
  const lines = (r, id) => (r.check_lines || []).find((c) => c.id === id) || null;
  const valItems = async () => { const v = ok(await ai({ action: 'validate_design', detail: 'full' }), 'validate'); return v.items || v.validation || []; };
  /** 화면 단추(사람)의 엔진 본문과 결과 — 본문은 호스트가 검토 상태로 만든다(화면이 보내는 것과 같다 — k2 그림자) */
  const pressDesign = async () => {
    const body = p._caseRequest(R.buildDesignRequest, await p._caseHostProps());
    assert(body.data && body.missing.length === 0, 'screen body builds ' + JSON.stringify(body.missing));
    p.__testClearPostedMessages();
    engine.length = 0;
    await page('runDesign', body.data);
    const res = ctx.posted('designResult').pop().data;
    return { body: body.data, res, eng: sent('aisi_design').pop().params };
  };
  try {
    ok(await ai({ action: 'open_project', name: 'WEB', create: true }), 'open_project');
    ok(await ai({ action: 'new_case', name: 'H', kind: 'section-only' }), 'new_case H');
    ok(await ai({ action: 'open_case', name: 'H' }), 'open H');
    // Design Manual II-14 · III-4 의 단면(550S162-33) — 부록 2 의 예제 단면, 구멍 1.5 × 4.5 in, s = 24 in
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 5.5, B: 1.625, D: 0.5, t: 0.0346, r: 0.0764 } }), 'template');
    ok(await ai({ action: 'set_case_inputs', inputs: { memberType: 'flexure', designMethod: 'LRFD', fy: 33, fu: 45, Lb: 0.0001, Cb: 1, Mux: 10, Vu: 0.5, wcN: null } }), 'inputs');
    // 처음 본문: 새 키 · 단면 모델이 없다
    const d0 = await pressDesign();
    assert(!Object.keys(d0.body).some((k) => /^(hole_|stiffener_|torsion_|transverse_stiffeners)/.test(k)), 'default body has no new key');
    assert(!('node' in d0.eng) && !('element_roles' in d0.eng) && !('holes' in d0.res), 'default engine body has no section model, result no holes');
    // 준비된 총단면 좌굴값의 서명(구멍 칸은 그것을 낡게 하지 않는다)
    const prepSig = p._preparedDesignDsmSig;
    assert(prepSig, 'prepared design DSM');

    // ── W1: 구멍 — 화면 단추 ──
    const holeIn = { holeShape: 'noncircular', holeDepth: 1.5, holeLength: 4.5, holeSpacing: 24, holeCornerRadius: 0.25 };
    const sci = ok(await ai({ action: 'set_case_inputs', inputs: holeIn }), 'hole inputs');
    assert(sci.invalidated.includes('design') && !sci.invalidated.includes('load'), 'scope design ' + JSON.stringify(sci.invalidated));
    assert.strictEqual(p._preparedDesignDsmSig, prepSig, 'hole inputs keep the prepared gross DSM values');
    const d1 = await pressDesign();
    assert.deepStrictEqual(Object.fromEntries(Object.entries(d1.body).slice(-5)), { hole_shape: 'noncircular', hole_depth: 1.5, hole_length: 4.5, hole_spacing: 24,
      hole_corner_radius: 0.25 }, 'screen body tail (keys, order, US values)');
    for (const k of ['node', 'elem', 'element_roles', 'prop']) { assert(Array.isArray(d1.eng[k]) && d1.eng[k].length > 0, `engine body carries ${k}`); }
    assert.strictEqual(d1.eng.element_roles.length, d1.eng.elem.length, 'roles per element');
    assert(d1.eng.dsm && d1.eng.dsm.M_Lcrd > 0 && d1.eng.dsm.Mcrl > 0, 'gross dsm with M_Lcrd ' + JSON.stringify(d1.eng.dsm).slice(0, 200));
    const r1 = d1.res;
    // 엔진: s = 24 in 가 총단면 Lcrd 보다 짧으면 뒤틀림은 평가하지 못함 — 어느 쪽이든 그 까닭을 싣는다
    assert(r1.holes && typeof r1.holes.Anet === 'number' && r1.holes.Mcrl_h > 0, 'holes block ' + JSON.stringify(r1.holes).slice(0, 300));
    const ap1 = check(r1, 'member.applicability.holes');
    assert(ap1 && ['pass', 'not_evaluated'].includes(ap1.verdict), 'applicability check ' + JSON.stringify(ap1 && ap1.verdict));
    const fl = check(r1, 'member.flexure.local');
    assert(fl.clause === 'F3.2.2' && fl.clause_variant === 'holes', 'F3.2.2 holes variant ' + JSON.stringify({ c: fl.clause, v: fl.clause_variant }));
    const sh1 = check(r1, 'member.shear');
    assert(sh1 && sh1.clause === 'G3' && sh1.clause_variant === 'web_holes', 'shear §G3 ' + JSON.stringify(sh1 && { c: sh1.clause, v: sh1.verdict }));
    notes.push(`W1: screen body + node/elem/roles/prop; holes Anet ${r1.holes.Anet.toFixed(4)} in², Mcrl,h ${r1.holes.Mcrl_h} kip-in, applicability ${ap1.verdict}, F3.2.2 · G3 variants`);
    // MCP 같은 입력(인자로) — 엔진 본문이 화면 단추와 같다
    ok(await ai({ action: 'set_case_inputs', inputs: { holeShape: 'none', holeDepth: null, holeLength: null, holeSpacing: null, holeCornerRadius: null } }), 'clear holes');
    engine.length = 0;
    const m1 = await tool('aisi_design_flexure', { Fy: 33, Lb: 0.0001, Mu: 10, Vu: 0.5, hole_shape: 'noncircular', hole_depth: 1.5, hole_length: 4.5, hole_spacing: 24, hole_corner_radius: 0.25, detail: 'full' });
    assert.deepStrictEqual(sent('aisi_design').pop().params, d1.eng, 'MCP engine body = screen button engine body');
    const st = p.__testGetCase().state.inputs;
    assert(st.holeShape === 'noncircular' && st.holeDepth === 1.5 && st.holeSpacing === 24, 'MCP args written to the case state');
    assert.deepStrictEqual((m1.data.design_checks || []).map((c) => [c.id, c.verdict, c.ratio]), (r1.design_checks || []).map((c) => [c.id, c.verdict, c.ratio]), 'same checks');
    // 빈 필수 칸: 모양 없는 구멍 인자 · 빈 dh
    ok(await ai({ action: 'set_case_inputs', inputs: { holeShape: 'none' } }), 'shape none');
    const noShape = await call('aisi_design_flexure', { Fy: 33, Lb: 0.0001, Mu: 10, hole_depth: 1.5 });
    assert(noShape.isError || noShape.data.error, 'hole args without a shape are refused');
    assert(/hole_shape/.test(noShape.text) && p.__testGetCase().state.inputs.holeShape === 'none', 'refusal names hole_shape, nothing written ' + noShape.text.slice(0, 200));
    ok(await ai({ action: 'set_case_inputs', inputs: { holeDepth: null, holeSpacing: null } }), 'dh · s blank');
    const noDh = await call('aisi_design_flexure', { Fy: 33, Lb: 0.0001, Mu: 10, hole_shape: 'circular' });
    assert((noDh.isError || noDh.data.error) && /holeDepth/.test(noDh.text), 'blank dh is a blank required input ' + noDh.text.slice(0, 200));
    // 빈 간격은 보내지 않는다(엔진이 말한다 — 지금은 「holes: hole_spacing is required」)
    engine.length = 0;
    const noS = await call('aisi_design_flexure', { Fy: 33, Lb: 0.0001, Mu: 10, hole_shape: 'circular', hole_depth: 1.5 });
    const bodyNoS = sent('aisi_design').pop();
    assert(bodyNoS && !('hole_spacing' in bodyNoS.params), 'blank spacing is not sent');
    notes.push(`W1b: MCP body = screen body; no shape → refused; blank dh → missing; blank s → not sent (engine: ${String((noS.data && noS.data.error) || 'evaluated').slice(0, 60)})`);
    // 검증 목록 · 보고서
    await tool('aisi_design_flexure', { Fy: 33, Lb: 0.0001, Mu: 10, Vu: 0.5, hole_shape: 'noncircular', hole_depth: 1.5, hole_length: 4.5, hole_spacing: 30, hole_corner_radius: 0.25 });
    const items = await valItems();
    const vh = items.find((c) => c.item === '웹 구멍 적용 범위 (부록 2)');
    const vs = items.find((c) => c.item === '전단 (보강된 웹 · 구멍이 있는 웹)');
    assert(vh && vh.id === 'val.design.holes' && /Anet/.test(vh.value) && vs && vs.id === 'val.design.shear_web', 'validation items ' + JSON.stringify([vh, vs]));
    const rv = p.__testReview('SI');
    assert(/웹 구멍 — 부록 2/.test(rv.reportHtml) && /Pynet|Mynet/.test(rv.reportHtml) && /mm²/.test(rv.reportHtml), 'report section in SI');
    assert(/웹 구멍 \(부록 2/.test(rv.reportHtml), 'report input table');
    notes.push(`W1c: validation 「${vh.item}」 ${vh.status} (${vh.value.slice(0, 60)}), report sections (SI)`);
    // 압축
    engine.length = 0;
    const comp = await tool('aisi_design_compression', { Fy: 33, KxLx: 96, KyLy: 48, KtLt: 48, Pu: 2, detail: 'full' });
    const ce = sent('aisi_design').pop().params;
    assert(ce.hole_shape === 'noncircular' && !('hole_corner_radius' in ce) && Array.isArray(ce.node), 'compression body: §E keys + model');
    const cg = check(comp.data, 'member.compression.global');
    assert(cg.clause === 'E2.5', 'E2.5 ' + cg.clause);
    notes.push(`W1d: compression E2.5 / ${check(comp.data, 'member.compression.local').clause}, Pynet ${comp.data.holes && comp.data.holes.Pynet}`);

    // ── W2: 요소 자리가 없는 단면 ──
    ok(await ai({ action: 'new_case', name: 'X', kind: 'section-only' }), 'new_case X');
    ok(await ai({ action: 'open_case', name: 'X' }), 'open X');
    ok(await ai({ action: 'generate_template', section_type: 'custom', params: { outer_corners: [[1.625, 0.5], [1.625, 0], [0, 0], [0, 5.5], [1.625, 5.5], [1.625, 5.0]], t: 0.0346 } }), 'custom section');
    assert(!p._model.elementRoles, 'custom section has no element roles');
    engine.length = 0;
    const x = await tool('aisi_design_flexure', { Fy: 33, Lb: 0.0001, Mu: 5, hole_shape: 'circular', hole_depth: 1.5, hole_spacing: 30, detail: 'full' });
    const xe = sent('aisi_design').pop().params;
    assert(Array.isArray(xe.node) && !('element_roles' in xe), 'no roles sent');
    const xap = check(x.data, 'member.applicability.holes');
    assert(xap && xap.verdict === 'not_evaluated' && x.data.pass !== true, 'not evaluated ' + JSON.stringify(xap && xap.verdict));
    const codes = (x.data.holes.notices || []).map((n) => n.code);
    // 엔진 H2 후속: 요소 자리가 없는 직접 그린 단면은 그 까닭(템플릿으로 만들라는 글)
    assert(codes.includes('member.reason.holes_custom_section_no_web'), 'reason: hand-drawn section without element roles ' + codes);
    const xi = (await valItems()).find((c) => c.item === '웹 구멍 적용 범위 (부록 2)');
    assert(xi && xi.status === 'warn' && /판정 없음/.test(xi.note), 'validation: no verdict with the reason ' + JSON.stringify(xi));
    notes.push(`W2: hand-drawn section → ${codes.join(', ')}; validation ${xi.status}`);
    // 템플릿 C 의 절점을 손으로 고친 단면 — 요소 자리를 버린다 → 엔진: 웹을 가려낼 수 없음
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 5.5, B: 1.625, D: 0.5, t: 0.0346, r: 0.0764 } }), 'template C for the edit');
    const n1 = p._model.node[0];
    ok(await ai({ action: 'modify_node', node_id: 1, x: n1[1] + 1e-4, z: n1[2] }), 'edit a node');
    assert(!p._model.elementRoles, 'an edited section has no element roles');
    engine.length = 0;
    const y = await tool('aisi_design_flexure', { Fy: 33, Lb: 0.0001, Mu: 5, hole_shape: 'circular', hole_depth: 1.5, hole_spacing: 30, detail: 'full' });
    const ye = sent('aisi_design').pop().params;
    const ycodes = (y.data.holes.notices || []).map((n) => n.code);
    assert(Array.isArray(ye.node) && !('element_roles' in ye) && ycodes.includes('member.reason.holes_web_not_identified')
      && check(y.data, 'member.applicability.holes').verdict === 'not_evaluated', 'edited C: web not identified ' + ycodes);
    const yr = JSON.stringify(y.data.not_evaluated || []);
    assert(/web|웹/.test(yr), 'not_evaluated names the reason ' + yr.slice(0, 200));
    notes.push(`W2b: edited template C (no roles) → ${ycodes.join(', ')}`);

    // ── W3: 보강재 ──
    ok(await ai({ action: 'new_case', name: 'S', kind: 'section-only' }), 'new_case S');
    ok(await ai({ action: 'open_case', name: 'S' }), 'open S');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1875 } }), 'C8');
    const s0 = await tool('aisi_design_flexure', { Fy: 50, Lb: 0.0001, Mu: 20, Vu: 2, wc_N: 0, transverse_stiffeners: true, detail: 'full' });
    assert(s0.data.shear.reference_only === true && check(s0.data, 'member.shear').verdict === 'not_evaluated' && check(s0.data, 'member.web_stiffeners').verdict === 'not_evaluated' && s0.data.pass === null,
      'stiffeners without data: not evaluated');
    assert.strictEqual(p.__testGetCase().state.inputs.stiffenerMode, 'present', 'transverse_stiffeners → stiffenerMode present');
    engine.length = 0;
    const s1 = await tool('aisi_design_flexure', { Fy: 50, Lb: 0.0001, Mu: 20, Vu: 2, wc_N: 0, stiffener_spacing: 10, stiffener_kind: 'pair', stiffener_Is: 0.05, stiffener_area: 0.5, stiffener_Fy: 50, detail: 'full' });
    const se = sent('aisi_design').pop().params;
    assert(se.transverse_stiffeners === true && se.stiffener_kind === 'pair' && !('node' in se), 'stiffener body: no section model needed');
    const sb = await pressDesign();
    assert.deepStrictEqual(sb.eng, se, 'stiffeners: screen body = MCP body');
    assert.deepStrictEqual(Object.fromEntries(Object.entries(sb.body).slice(-6)), { transverse_stiffeners: true, stiffener_spacing: 10, stiffener_kind: 'pair',
      stiffener_Is: 0.05, stiffener_area: 0.5, stiffener_Fy: 50 }, 'stiffener body tail (keys, order, US values)');
    assert(s1.data.shear.curve === 'G2.2' && check(s1.data, 'member.shear').clause_variant === 'stiffened_web' && check(s1.data, 'member.web_stiffeners').verdict === 'pass', 'G2.2 · G4.1');
    const sv = (await valItems()).find((c) => c.item === '횡방향 웹 보강재 (§G4.1)');
    assert(sv && sv.status === 'pass' && sv.id === 'val.design.web_stiffeners', 'validation G4.1 ' + JSON.stringify(sv));
    notes.push(`W3: no data → shear / G4.1 not evaluated (reference Vn ${s0.data.shear.Vn}); data → G2.2 kv ${s1.data.shear.kv.toFixed(3)}, G4.1 ${check(s1.data, 'member.web_stiffeners').ratio}`);

    // ── W4: §H4 ──
    ok(await ai({ action: 'set_case_inputs', inputs: { stiffenerMode: 'none' } }), 'stiffeners off');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 9, B: 2.5, D: 0.773, t: 0.059, r: 0.1875 } }), 'C9');
    ok(await ai({ action: 'set_case_inputs', inputs: { designMethod: 'ASD', fy: 55, fu: 70, Lb: 0.0001, Mux: 40, Vu: null,
      torsionMode: 'direct', torsionFBending: -4.1, torsionFTorsion: -1.29 } }), 'torsion (a) inputs');
    const ta = await pressDesign();
    assert.deepStrictEqual(Object.fromEntries(Object.entries(ta.body).slice(-2)), { torsion_f_bending: -4.1, torsion_f_torsion: -1.29 }, 'route (a) body');
    assert(Array.isArray(ta.eng.node), 'torsion sends the section model (symmetry)');
    const h4a = check(ta.res, 'member.bending_torsion');
    assert(h4a && ['pass', 'fail'].includes(h4a.verdict) && Math.abs(ta.res.torsion.R - 0.7607) < 2e-3, 'route (a) R ' + JSON.stringify(ta.res.torsion));
    engine.length = 0;
    ok(await ai({ action: 'set_case_inputs', inputs: { torsionMode: 'none' } }), 'torsion off');
    await tool('aisi_design_flexure', { Fy: 55, Lb: 0.0001, Mu: 40, torsion_f_bending: -4.1, torsion_f_torsion: -1.29 });
    assert.deepStrictEqual(sent('aisi_design').pop().params, ta.eng, 'route (a): MCP body = screen body');
    engine.length = 0;
    const tb = await tool('aisi_design_flexure', { Fy: 55, Lb: 0.0001, Mu: 40, torsion_eccentricity: 1.05, torsion_span: 300, torsion_load: 'uniform', torsion_support: 'simple', detail: 'full' });
    const tbe = sent('aisi_design').pop().params;
    assert(tbe.torsion_eccentricity === 1.05 && !('torsion_f_bending' in tbe) && Array.isArray(tbe.element_roles), 'route (b) body: its keys + model ' + Object.keys(tbe).filter((k) => k.startsWith('torsion')));
    assert.strictEqual(p.__testGetCase().state.inputs.torsionMode, 'eccentric', 'route (b) args → torsionMode eccentric');
    const tbb = await pressDesign();
    assert.deepStrictEqual(tbb.eng, tbe, 'route (b): screen body = MCP body');
    assert(tb.data.torsion.route === 'computed' && tb.data.torsion.increased_15pct === true && tb.data.torsion.node > 0, 'route (b) result ' + JSON.stringify(tb.data.torsion).slice(0, 200));
    const tv = (await valItems()).find((c) => c.item === '휨 + 비틀림 (§H4)');
    assert(tv && tv.id === 'val.design.bending_torsion' && /R /.test(tv.value), 'validation H4 ' + JSON.stringify(tv));
    const rvT = p.__testReview('US');
    assert(/휨 \+ 비틀림 \(§H4\)/.test(rvT.reportHtml) && /지배 절점/.test(rvT.reportHtml), 'report H4 section');
    notes.push(`W4: route (a) R ${ta.res.torsion.R} ${h4a.verdict}; route (b) R ${tb.data.torsion.R} at node ${tb.data.torsion.node}, ratio ${tb.data.torsion.ratio}; screen = MCP`);

    // ── W6: SI · 요약 · 예산 ──
    ok(await ai({ action: 'set_case_inputs', inputs: { torsionMode: 'none', designMethod: 'LRFD' } }), 'reset');
    const usArgs = { Fy: 55, Lb: 0.0001, Mu: 40, Vu: 2, wc_N: 3, wc_R: 0.1875, wc_P: 1, wc_support: 'IOF', hole_shape: 'noncircular', hole_depth: 1.5, hole_length: 4.5,
      hole_spacing: 30, hole_corner_radius: 0.25, hole_end_distance: 12, hole_bearing_distance: 6, torsion_eccentricity: 1.05, torsion_span: 300, torsion_load: 'uniform', torsion_support: 'simple' };
    const mm = (v) => v * 25.4;
    const siArgs = { ...usArgs, Fy: 55 * 6.894757293168361, Lb: mm(0.0001), Mu: 40 * 0.1129848290276167, Vu: 2 * 4.4482216152605, wc_N: mm(3), wc_R: mm(0.1875), wc_P: 4.4482216152605,
      hole_depth: mm(1.5), hole_length: mm(4.5), hole_spacing: mm(30), hole_corner_radius: mm(0.25), hole_end_distance: mm(12), hole_bearing_distance: mm(6),
      torsion_eccentricity: mm(1.05), torsion_span: mm(300), units: 'SI' };
    engine.length = 0;
    const us = await tool('aisi_design_flexure', { ...usArgs, detail: 'full' });
    const usBody = sent('aisi_design').pop().params;
    engine.length = 0;
    const si = await tool('aisi_design_flexure', { ...siArgs, detail: 'full' });
    assert.deepStrictEqual(sent('aisi_design').pop().params, usBody, 'SI args reach the engine as the US body');
    assert(!si.data.si_unconverted, 'no unconverted numeric key: ' + JSON.stringify(si.data.si_unconverted || []).slice(0, 600));
    const ratio = (a, b) => (b === 0 ? 1 : a / b);
    const near = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));
    const U = us.data.display_unrounded || {};
    assert(near(si.data.holes.Anet, (U.holes ? U.holes.Anet : us.data.holes.Anet) * 645.16), 'holes.Anet mm² ' + ratio(si.data.holes.Anet, us.data.holes.Anet));
    assert(near(si.data.torsion.L, us.data.torsion.L * 25.4) && near(si.data.torsion.f_bending, (U.torsion ? U.torsion.f_bending : us.data.torsion.f_bending) * 6.894757293168361), 'torsion L mm, f MPa');
    assert(near(si.data.web_crippling.Rc, U.web_crippling && U.web_crippling.Rc !== undefined ? U.web_crippling.Rc : us.data.web_crippling.Rc) && near(si.data.web_crippling.g6.x, us.data.web_crippling.g6.x * 25.4),
      'g6 Rc unchanged (unrounded), x mm ' + JSON.stringify({ si: si.data.web_crippling.Rc, us: us.data.web_crippling.Rc, u: U.web_crippling }));
    assert(near(si.data.shear.c, us.data.shear.c * 25.4), 'shear.c mm');
    const sum = await tool('aisi_design_flexure', { ...siArgs });
    assert(sum.data.holes_basis && sum.data.torsion_basis && sum.data.shear_basis && sum.data.web_crippling_basis, 'summary carries the bases ' + Object.keys(sum.data).join(','));
    assert(lines(sum.data, 'member.bending_torsion') && lines(sum.data, 'member.applicability.holes'), 'summary check lines');
    const topKeys = (d) => Object.entries(d || {}).map(([k, v]) => [k, JSON.stringify(v).length]).sort((a, b) => b[1] - a[1]).slice(0, 12).map((x) => x.join(' ')).join(', ');
    // 엔진 H2 후속: §H4 의 위치 · θ'' 는 물리량(location_q · steps 의 *_q) — SI 로 바뀐다(per_area 1/in² → 1/mm²), 모르는 수가 없다
    const lq = si.data.torsion.location_q, lqU = us.data.torsion.location_q;
    assert(lq && near(lq.z.value, lqU.z.value * 25.4) && lq.node.value === lqU.node.value && near(lq.theta_pp.value, lqU.theta_pp.value / 645.16),
      'torsion location_q in SI ' + JSON.stringify({ lq, lqU }));
    assert(near(si.data.torsion.theta_pp, (U.torsion && U.torsion.theta_pp !== undefined ? U.torsion.theta_pp : us.data.torsion.theta_pp) / 645.16), 'torsion.theta_pp 1/mm²');
    assert(!sum.data.si_unconverted, 'summary: no unconverted key ' + JSON.stringify(sum.data.si_unconverted));
    // 요약의 근거 묶음은 지배 머리 · 검토 줄에 있는 것을 다시 싣지 않는다(크기)
    assert(!('Mn' in sum.data.torsion_basis) && !('ratio' in sum.data.torsion_basis) && sum.data.torsion_basis.R > 0, 'torsion basis without repeated values ' + JSON.stringify(sum.data.torsion_basis));
    const gT = (sum.data.governing_checks || []).find((g) => g.id === 'member.bending_torsion');
    // 머리의 위치는 전체 결과의 위치 그대로(mcp_si_chain 의 계약) — 맨 수와 물리량이 같은 값(SI)
    assert(!gT || (gT.location && near(gT.location.z, gT.location.z_q.value) && gT.location.node === gT.location.node_q.value), 'head location: z = z_q (SI) ' + JSON.stringify(gT && gT.location));
    const gH = (sum.data.governing_checks || []).find((g) => g.id === 'member.flexure.local');
    assert(gH && !('location' in gH) && !('combination' in gH), 'head without a location / combination omits them (null)');
    assert(!(sum.data.check_lines || []).some((l) => l.governs && 'governs_basis' in l), 'governing lines: governs_basis is in the head');
    // 예산(mcp_si_chain 의 단일 부재 12 KB): 구멍(§G3 · §G6 포함) · §H4 · 셋을 한꺼번에
    const allIn = sum.bytes;
    assert(allIn <= 12 * KB, `all three summary ${allIn} B within 12 KB (largest: ${topKeys(sum.data)})`);
    const { torsion_eccentricity: _te, torsion_span: _ts, torsion_load: _tl, torsion_support: _tsu, ...holeOnly } = siArgs;
    void _te; void _ts; void _tl; void _tsu;
    ok(await ai({ action: 'set_case_inputs', inputs: { torsionMode: 'none' } }), 'torsion off for the budget');
    const sumH = await tool('aisi_design_flexure', holeOnly);
    assert(sumH.bytes <= 12 * KB, `holes summary ${sumH.bytes} B within 12 KB (largest: ${topKeys(sumH.data)})`);
    ok(await ai({ action: 'set_case_inputs', inputs: { holeShape: 'none', wcN: null } }), 'holes off for the budget');
    const sumT = await tool('aisi_design_flexure', { Fy: 55, Lb: 0.0001, Mu: 40, Vu: 2, torsion_eccentricity: 1.05, torsion_span: 300, torsion_load: 'uniform', torsion_support: 'simple', units: 'SI' });
    assert(sumT.bytes <= 12 * KB, `torsion summary ${sumT.bytes} B within 12 KB (largest: ${topKeys(sumT.data)})`);
    // 웹 크리플링 단독 도구(§G6)
    const wc = await tool('get_web_crippling', { h: 3.644, t: 0.0713, R: 0.1069, N: 5, Fy: 50, support: 'IOF', fastened: 'fastened', section_type: 'C', d: 4,
      hole_shape: 'noncircular', hole_depth: 1.5, hole_length: 4.5, hole_spacing: 24, hole_corner_radius: 0.25, hole_end_distance: 9.75, hole_bearing_distance: 7.25 });
    assert(Math.abs(wc.data.Pn - 4.72) < 0.02 && Math.abs(wc.data.Rc - 0.986) < 0.002, 'Example II-10 §G6 via the tool ' + JSON.stringify({ Pn: wc.data.Pn, Rc: wc.data.Rc }));
    notes.push(`W6: SI body = US body, no unconverted key, summary holes ${sumH.bytes} B · torsion ${sumT.bytes} B (all three at once ${allIn} B) with holes / torsion / shear / web_crippling bases; get_web_crippling §G6 Pn ${wc.data.Pn}`);

    // ── W5: 퍼린 사슬 ──
    ok(await ai({ action: 'new_case', name: 'P', kind: 'roof-purlin' }), 'new_case P');
    ok(await ai({ action: 'open_case', name: 'P' }), 'open P');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1875 } }), 'C purlin');
    const loadArgs = { member_app: 'roof-purlin', span_type: 'cont-2', span_ft: 20, spacing_ft: 5, loads: { D: 30, Lr: 60, W: -80 }, Fy: 50, Fu: 65,
      laps: { left_ft: 1, right_ft: 1 }, deck: { type: 'through-fastened', t_panel: 0.018, fastener_spacing: 12 } };
    engine.length = 0;
    const pr = await tool('design_purlin', { ...loadArgs, hole_shape: 'circular', hole_depth: 1.5, hole_spacing: 30, stiffener_spacing: 10, stiffener_kind: 'pair',
      stiffener_Is: 0.05, stiffener_area: 0.5, stiffener_Fy: 50, detail: 'full' });
    const regCalls = sent('aisi_design');
    assert(regCalls.length > 0 && regCalls.every((c) => c.params.hole_shape === 'circular' && c.params.transverse_stiffeners === true && Array.isArray(c.params.node)
      && !Object.keys(c.params).some((k) => k.startsWith('torsion_'))), 'every region check carries holes / stiffeners + model, no torsion');
    const withSprings = regCalls.filter((c) => Array.isArray(c.params.springs) && c.params.springs.length > 0);
    assert(withSprings.length > 0 && withSprings.every((c) => c.params.moment_sign === '+'), 'positive regions with the deck springs ' + withSprings.length);
    const regs = pr.data.regions || [];
    const lapReg = regs.find((rg) => rg.kind === 'lap');
    if (lapReg) {
      const lapHoles = lapReg.result && lapReg.result.holes;
      assert(lapHoles && lapHoles.evaluated === false && /lap/.test(JSON.stringify(lapHoles.notices || [])), 'lap region with holes: not evaluated ' + JSON.stringify(lapHoles).slice(0, 300));
    }
    const st5 = p.__testGetCase().state.inputs;
    assert(st5.holeShape === 'circular' && st5.stiffenerMode === 'present' && st5.stiffenerKind === 'pair', 'purlin MCP args written');
    engine.length = 0;
    ok(await ai({ action: 'run_case_check', what: 'member' }), 'run_case_check purlin');
    const reg2 = sent('aisi_design');
    assert(reg2.length === regCalls.length && reg2.every((c, i) => JSON.stringify(c.params) === JSON.stringify(regCalls[i].params)), 'screen request = MCP request (purlin chain)');
    const prs = await tool('design_purlin', { ...loadArgs });
    assert(prs.bytes <= 40 * KB, `purlin summary ${prs.bytes} B within 40 KB`);
    notes.push(`W5: ${regCalls.length} region checks with holes + stiffeners + model (${withSprings.length} with deck springs), lap holes ${lapReg ? 'not evaluated' : 'n/a'}; summary ${prs.bytes} B`);
    const prh = await tool('design_purlin', { ...loadArgs, hole_shape: 'circular', hole_depth: 1.5, hole_spacing: 30 });
    assert(prh.bytes <= 40 * KB, `purlin summary with holes ${prh.bytes} B within 40 KB`);
    notes.push(`W5b: purlin summary with holes ${prh.bytes} B`);

    // ── W7: 확실한 불합격(구멍 조항을 평가하지 못했지만 구멍 없는 강도의 상한으로도 넘음 — 엔진 8f9126e) ──
    // 화면 단추와 MCP 가 같은 본문 · 같은 결과, 읽는 곳(실행 요약 · 검증 목록 · 보고서 · MCP 요약)이 같은 비 · 같은 검토(utils · runs · server 의 같은 규칙)
    const RUNS = ctx.load(path.join('src', 'records', 'runs.ts'));
    const UT = require(path.join(ROOT, 'webview', 'js', 'utils.js'));
    const history = async () => (await ai({ action: 'get_case_status', detail: 'runs' })).history || [];
    const agree = (res, what) => {
      const ub = UT.lengthBoundFailure(res), rb = RUNS.lengthBoundFailure(res);
      assert(ub && rb && ub.basis === 'holes' && rb.basis === 'holes' && ub.ratio === rb.ratio && ub.governing_check === rb.id && ub.source === rb.source && ub.ratio > 1,
        `${what}: page and host rules agree ` + JSON.stringify({ ub, rb }));
      const gc = check(res, ub.governing_check);
      assert(gc && gc.verdict === 'fail' && gc.trusted === false && gc.reason_code === 'member.reason.fails_without_holes' && gc.ratio === ub.ratio,
        `${what}: the governing check is the bound fail ` + JSON.stringify(gc && { v: gc.verdict, t: gc.trusted, r: gc.ratio }));
      return ub;
    };
    ok(await ai({ action: 'new_case', name: 'F', kind: 'section-only' }), 'new_case F');
    ok(await ai({ action: 'open_case', name: 'F' }), 'open F');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 5.5, B: 1.625, D: 0.5, t: 0.0346, r: 0.0764 } }), 'template F');
    ok(await ai({ action: 'set_case_inputs', inputs: { memberType: 'flexure', designMethod: 'LRFD', fy: 33, fu: 45, Lb: 0.0001, Cb: 1, Mux: 40, Vu: null, wcN: null,
      holeShape: 'noncircular', holeDepth: 1.5, holeLength: 4.5, holeSpacing: 24, holeEdgeStiffened: true } }), 'certain-failure inputs');
    const f1 = await pressDesign();
    const b1 = agree(f1.res, 'screen');
    assert(f1.res.pass === false && f1.res.holes_strength_bound && f1.res.holes_strength_bound.ratio === b1.ratio && b1.source === 'holes_strength_bound', 'screen: NG on holes_strength_bound');
    const runF = (await history())[0];
    assert(runF.kind === 'member_design' && runF.max_ratio === b1.ratio && (runF.governing || {}).id === b1.governing_check, 'run summary: bound ratio + check ' + JSON.stringify(runF));
    const itemsF = await valItems();
    const negF = itemsF.find((c) => c.item === '이용률 — 부모멘트 (-M)');
    assert(negF && negF.status === 'fail' && negF.value.startsWith((b1.ratio * 100).toFixed(1) + '%') && /구멍 없는 강도로도 넘음/.test(negF.value), 'validation DCR item ' + JSON.stringify(negF));
    const lclF = itemsF.find((c) => c.item === '웹 구멍 적용 범위 (부록 2)');
    assert(lclF && lclF.status === 'warn', 'validation: holes applicability not evaluated ' + JSON.stringify(lclF));
    const rvF = p.__testReview('US');
    assert(rvF.reportDoc.verdict.state === 'fail' && rvF.reportDoc.verdict.utilization.value === b1.ratio && rvF.reportDoc.verdict.governing === b1.governing_check,
      'report verdict: the bound ratio and check ' + JSON.stringify(rvF.reportDoc.verdict));
    assert(/구멍 없는 강도로도 넘음/.test(rvF.reportHtml) && /구멍 없는 강도의 상한/.test(rvF.reportHtml) && !/믿지 않는 값/.test(rvF.reportHtml), 'report: the bound text, not 「믿지 않는 값」');
    // MCP: 같은 입력(인자로) — 같은 본문 · 같은 결과, 요약의 utilization_note 가 그 비 · 검토(server.boundFailure)
    ok(await ai({ action: 'set_case_inputs', inputs: { holeShape: 'none', holeDepth: null, holeLength: null, holeSpacing: null, holeEdgeStiffened: false } }), 'clear F holes');
    engine.length = 0;
    const fm = await tool('aisi_design_flexure', { Fy: 33, Lb: 0.0001, Mu: 40, hole_shape: 'noncircular', hole_depth: 1.5, hole_length: 4.5, hole_spacing: 24, hole_edge_stiffened: true, detail: 'full' });
    assert.deepStrictEqual(sent('aisi_design').pop().params, f1.eng, 'certain failure: MCP engine body = screen engine body');
    assert.deepStrictEqual(agree(fm.data, 'MCP'), b1, 'MCP result: the same bound');
    const fs1 = await tool('aisi_design_flexure', { Fy: 33, Lb: 0.0001, Mu: 40 });
    const note = String(fs1.data.utilization_note || '');
    assert(fs1.data.pass === false && note.includes('FAILS even on the strength without holes') && note.includes(b1.governing_check) && note.includes(String(Number(b1.ratio.toFixed(4)))),
      'MCP summary note names the bound ' + note);
    assert(fs1.data.holes_strength_bound && fs1.data.holes_strength_bound.ratio === b1.ratio && !('note' in fs1.data.holes_strength_bound), 'summary: compact holes_strength_bound');
    const hd = (fs1.data.governing_checks || []).find((g) => g.id === b1.governing_check);
    assert(hd && hd.verdict === 'fail' && hd.trusted === false && hd.reason_code === 'member.reason.fails_without_holes', 'summary head: fail, trusted false, its reason code');
    const runM = (await history())[0];
    assert(runM.max_ratio === b1.ratio && (runM.governing || {}).id === b1.governing_check, 'MCP run summary: the same bound');
    // SI: 새 묶음(holes_strength_bound)에 모르는 수가 없다
    const fsi = await tool('aisi_design_flexure', { Fy: 33 * 6.894757293168361, Lb: 0.00254, Mu: 40 * 0.1129848290276167, units: 'SI', detail: 'full' });
    assert(!fsi.data.si_unconverted && near(fsi.data.holes_strength_bound.Mn, fm.data.holes_strength_bound.Mn * 0.1129848290276167)
      && near(fsi.data.holes_strength_bound.checks['member.flexure.local'].value, fm.data.holes_strength_bound.checks['member.flexure.local'].value * 0.1129848290276167),
      'SI holes_strength_bound ' + JSON.stringify(fsi.data.si_unconverted || []));
    notes.push(`W7a: flexure, edge-stiffened holes, Mu 40 → NG on holes_strength_bound ${b1.governing_check} ${b1.ratio.toFixed(3)} — screen = MCP body, run · validation · report · MCP note agree`);
    // 전단(§G3 한계 밖) · 웹 크리플링(지압 안의 구멍) · 조합 — 세 사본(utils · runs · MCP 요약)이 같은 검토 · 비
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 4, B: 1.625, D: 0.5, t: 0.0713, r: 0.1069 } }), 'C4');
    ok(await ai({ action: 'set_case_inputs', inputs: { designMethod: 'ASD', fy: 50, fu: 65, Mux: 5 } }), 'C4 inputs');
    const C4H = { Fy: 50, Lb: 0.0001, Mu: 5, hole_shape: 'noncircular', hole_depth: 1.5, hole_length: 4.6, hole_spacing: 24, hole_corner_radius: 0.25, hole_edge_stiffened: false };
    for (const [what, extra, src] of [['shear §G3(f)', { Vu: 8 }, 'shear.bound_without_holes'],
      ['web crippling within bearing', { hole_length: 4.5, Vu: 0.5, wc_N: 5, wc_R: 0.1069, wc_support: 'IOF', wc_M: 5, wc_P: 10, hole_end_distance: 9.75, hole_bearing_distance: 7.25, hole_within_bearing: true }, 'web_crippling.bound_without_holes']]) {
      const full = await tool('aisi_design_flexure', { ...C4H, ...extra, detail: 'full' });
      const bb = agree(full.data, what);
      assert.strictEqual(bb.source, src, `${what}: source`);
      const sm = await tool('aisi_design_flexure', { ...C4H, ...extra });
      assert(String(sm.data.utilization_note || '').includes(bb.governing_check) && String(sm.data.utilization_note).includes(src), `${what}: MCP note ` + sm.data.utilization_note);
      assert((await history())[0].max_ratio === bb.ratio, `${what}: run max_ratio`);
      notes.push(`W7b ${what}: ${bb.governing_check} ${bb.ratio.toFixed(3)} (${src})`);
    }
    ok(await ai({ action: 'set_case_inputs', inputs: { holeWithinBearing: false, holeBearingDistance: null, holeEndDistance: null, wcN: null, wcP: null, Vu: null } }), 'C4 reset');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 5.5, B: 1.625, D: 0.5, t: 0.0346, r: 0.0764 } }), 'template for combined');
    const cb = await tool('aisi_design_combined', { Fy: 33, design_method: 'LRFD', KxLx: 96, KyLy: 48, KtLt: 48, Lb: 48, Pu: 3, Mux: 8, hole_shape: 'noncircular', hole_depth: 1.5, hole_length: 4.5,
      hole_spacing: 24, hole_edge_stiffened: true, detail: 'full' });
    const bc = agree(cb.data, 'combined');
    assert(bc.source === 'interaction_holes_bound' && bc.governing_check === 'member.axial_bending', 'combined: H1.2 on the bound');
    notes.push(`W7c combined: ${bc.governing_check} ${bc.ratio.toFixed(3)} (interaction_holes_bound)`);

    // ── W8: 잘못된 입력 — 오류가 사람(화면 글)과 AI(도구 오류)에 가고, 검토 상태 · 앞 결과는 그대로 ──
    ok(await ai({ action: 'new_case', name: 'E', kind: 'section-only' }), 'new_case E');
    ok(await ai({ action: 'open_case', name: 'E' }), 'open E');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1875 } }), 'C8 E');
    ok(await ai({ action: 'set_case_inputs', inputs: { memberType: 'flexure', designMethod: 'LRFD', fy: 50, fu: 65, Lb: 0.0001, Mux: 20, Vu: 2, wcN: null } }), 'E inputs');
    await tool('aisi_design_flexure', { Fy: 50, Lb: 0.0001, Mu: 20, Vu: 2, stiffener_spacing: 10, stiffener_kind: 'pair', stiffener_Is: 0.05, stiffener_area: 0.5, stiffener_Fy: 50 });
    const st0 = JSON.parse(JSON.stringify(p.__testGetCase().state));
    const last0 = p._lastDesignResult;
    // ① 보강재 Fy ≤ 0: MCP 인자 · 상태 쓰기 모두 받지 않는다(엔진에 가지 않는다), 상태 그대로
    engine.length = 0;
    const badFy = await call('aisi_design_flexure', { Fy: 50, Lb: 0.0001, Mu: 20, Vu: 2, stiffener_Fy: -50 });
    assert(badFy.isError || (badFy.data && badFy.data.error), 'stiffener_Fy -50: a tool error ' + badFy.text.slice(0, 200));
    assert(/stiffener_Fy/.test(badFy.text) && sent('aisi_design').length === 0, 'the error names stiffener_Fy and nothing reached the engine ' + badFy.text.slice(0, 300));
    const sciBad = await ai({ action: 'set_case_inputs', inputs: { stiffenerFy: 0 } });
    assert(sciBad.rejected && sciBad.rejected.some((x) => x.key === 'stiffenerFy' && /0 보다 커야/.test(x.reason)), 'set_case_inputs stiffenerFy 0 rejected ' + JSON.stringify(sciBad.rejected));
    assert.deepStrictEqual(p.__testGetCase().state.inputs, st0.inputs, 'case inputs unchanged after the refused values');
    assert.strictEqual(p._lastDesignResult, last0, 'the last result is kept (it still matches the case state)');
    // ② 칸의 규칙은 맞지만 엔진이 오류로 답하는 값(간격 ≤ Lh — 두 칸의 관계): 도구 오류 'holes: …', 상태에 쓰지 않음, 앞 결과 그대로, 화면에 그 글
    p.__testClearPostedMessages();
    engine.length = 0;
    const badS = await call('aisi_design_flexure', { Fy: 50, Lb: 0.0001, Mu: 20, Vu: 2, hole_shape: 'noncircular', hole_depth: 1.5, hole_length: 4.5, hole_spacing: 3 });
    assert((badS.isError || (badS.data && badS.data.error)) && /holes: hole_spacing/.test(badS.text), 'engine error reaches the AI ' + badS.text.slice(0, 300));
    assert(sent('aisi_design').length === 1, 'the engine was asked once');
    const stE = p.__testGetCase().state;
    assert(stE.inputs.holeShape === 'none' && stE.inputs.holeSpacing === null && stE.rev === st0.rev, 'case state not written on the engine error ' + JSON.stringify({ s: stE.inputs.holeShape, sp: stE.inputs.holeSpacing, rev: stE.rev, rev0: st0.rev }));
    assert.strictEqual(p._lastDesignResult, last0, 'host keeps the last good result (the case state did not change)');
    const postedE = ctx.posted('designResult').pop();
    assert(postedE && postedE.data && /^holes:/.test(postedE.data.error), 'the page gets the error result (it shows it and clears the old cards) ' + JSON.stringify(postedE && postedE.data).slice(0, 200));
    const shown = UT.inputErrorText(postedE.data.error);
    assert(/웹 구멍\(천공\)/.test(shown) && /「웹 구멍 중심 간격 s」/.test(shown), 'page text names the section and the field: ' + shown);
    notes.push(`W8: stiffener_Fy -50 → tool error before the engine, set_case_inputs 0 rejected, state unchanged; hole_spacing ≤ Lh → engine 'holes:' error, state rev ${stE.rev} unchanged; page: 「${shown.slice(0, 70)}…」`);

    // ── W9: 구멍 하나(간격 없음) ──
    const one = await tool('aisi_design_compression', { Fy: 50, KxLx: 96, KyLy: 48, KtLt: 48, Pu: 1, hole_shape: 'circular', hole_depth: 1.5, detail: 'full' });
    assert(one.data.holes.single_hole === true && one.data.holes.s === null && (one.data.notices || []).some((n) => n.code === 'member.assumption.holes_single_hole'), 'single hole result');
    assert(p.__testGetCase().state.inputs.holeSpacing === null, 'no spacing written');
    const oneS = await tool('aisi_design_compression', { Fy: 50, KxLx: 96, KyLy: 48, KtLt: 48, Pu: 1, hole_shape: 'circular', hole_depth: 1.5 });
    assert(oneS.data.holes_basis && oneS.data.holes_basis.single_hole === true, 'summary holes_basis.single_hole');
    const rvO = p.__testReview('SI');
    assert(/비지지 길이마다 구멍 하나/.test(rvO.reportHtml), 'report: single hole in the input table and the holes section');
    notes.push('W9: blank spacing → holes.single_hole, assumption holes_single_hole, summary · report say so');
  } finally {
    try { await client.close(); } catch { /* */ }
    try { await bridge.stop(); } catch { /* */ }
    ctx.close();
    S.writerKeyDir = saveKey; S.projectRoots = saveRoots;
    try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`web_options_contract: PASS (${notes.join('; ')})`);
}

main().catch((e) => { console.error('web_options_contract: FAIL', e && e.stack || e); process.exit(1); });
