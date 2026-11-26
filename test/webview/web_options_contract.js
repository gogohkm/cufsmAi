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
    assert.deepStrictEqual(DS.memberWebOptions(get({}), s), { data: {}, missing: [] }, `defaults send nothing (${s})`);
  }
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
    assert(codes.includes('member.reason.holes_web_not_identified') || codes.includes('member.reason.holes_section_not_covered'), 'reason: web not identified / section not covered ' + codes);
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
    // 예산(mcp_si_chain 의 단일 부재 12 KB): 구멍(§G3 · §G6 포함) 한 사례 · §H4 한 사례. 셋을 한꺼번에 준 사례는 크기만 적는다(알림 글이 셋의 합)
    const allIn = sum.bytes;
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
