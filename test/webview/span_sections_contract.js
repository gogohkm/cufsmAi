/* global process, Buffer */
// 2026-11-28 경간마다 다른 퍼린 단면 — 호스트 단계 H(docs/implementation/20261128-span-sections-worklog.md 결정 S1 – S10).
// 진짜 패널 · 파이썬 · MCP 다리(포트 파일 + 토큰) · 진짜 MCP 서버(소스).
//   node test/webview/span_sections_contract.js
//  P0 순수: 처음 표(모든 경간 S1), 단면 목록의 검사, 본문의 규칙(모두 S1 → 아무것도 없다 · 템플릿이 다르면 막음 · 빈 t 는 빈 칸),
//     상태의 규칙(지운 단면 → S1 · 경간 수가 바뀌면 S1), 파일(쓸 때만 적는다 · 옛 파일 → S1), 지문(처음 상태는 이 기능이 없던 지문),
//     변경 묶음의 글(「경간 2 단면 S1 → S2」 · 「단면 S2 두께 t …」 · 추가 · 삭제), 랩 접합의 두 부재
//  P1 모든 경간 S1(S2 를 정의만) → 엔진 본문 · 결과가 단면 목록이 없을 때와 같다
//  P2 S2 = S1 의 치수 → 단면 하나의 결과와 같은 수(랩의 몫 0.5)
//  P3 설계 매뉴얼 II-1A 의 두 단면(9CS2.5x070 끝 경간 · 9CS2.5x059 안 경간): span_sections 와 단면마다의 Ixx 가 엔진에, 구간마다 그 경간의 단면,
//     정모멘트 구간의 강도 = 그 단면 하나로 푼 강도, 랩의 몫 · 두 부재의 줄 · 강도의 합(참고), 단면 블록(성질 · 좌굴값 · 곡선), 검증 · 보고서
//  P4 춤이 다른 랩 → 평가하지 못함(엔진의 까닭), 지운 단면 → S1, 직접 고친 모델 → 막음
//  P5 MCP 본문 = 화면 단추 본문, 파일 왕복, 랩 접합의 두 부재, SI 답 · 예산
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
const U = require(path.join(ROOT, 'webview', 'js', 'utils.js'));
const notes = [];
const KB = 1024;
const C070 = { H: 9, B: 2.5, D: 0.8, t: 0.070, r: 0.1875, qlip: 90 };
const C059 = { H: 9, B: 2.5, D: 0.773, t: 0.059, r: 0.1875, qlip: 90 };

function pureChecks(ctx) {
  const CS = ctx.load(path.join('src', 'case', 'caseState.ts'));
  const R = ctx.load(path.join('src', 'case', 'requests.ts'));
  const FP = ctx.load(path.join('src', 'records', 'fp.ts'));
  const DF = ctx.load(path.join('src', 'records', 'differ.ts'));
  const CT = ctx.load(path.join('src', 'records', 'changeText.ts'));
  // 처음 표 · 검사
  assert.deepStrictEqual(DS.defaultSpanTable('cont-4', 4).spanSections, ['S1', 'S1', 'S1', 'S1'], 'default: every span S1');
  assert.deepStrictEqual(DS.validateSections([{ id: 'S2', name: null, template: 'lippedc', params: { ...C059 } }]), [], 'valid section');
  for (const [bad, re] of [[{ id: 'S1', template: 'lippedc', params: {} }, /S2/], [{ id: 'S2', template: 'chs', params: {} }, /템플릿/],
    [{ id: 'S2', template: 'lippedc', params: { t: 0 } }, /0 보다 커야/], [{ id: 'S2', template: 'lippedc', params: { D: -1 } }, /0 이상/],
    [{ id: 'S2', template: 'lippedc', params: { OD: 3 } }, /치수가 아니다/]]) {
    assert(re.test(DS.validateSections([bad]).join(' ')), 'rejects ' + JSON.stringify(bad) + ': ' + DS.validateSections([bad]));
  }
  // 본문의 규칙(화면 · 호스트 한 함수)
  const S2 = { id: 'S2', name: '9CS2.5x059', template: 'lippedc', params: { ...C059 } };
  assert.deepStrictEqual(DS.spanSectionsPayload(['S1', 'S1'], [S2], 'lippedc'), { missing: [] }, 'all S1: nothing in the body');
  const pl = DS.spanSectionsPayload(['S1', 'S2', 'S2', 'S1'], [S2], 'lippedc');
  assert.deepStrictEqual(pl.data, { span_sections: ['S1', 'S2', 'S2', 'S1'], sections: [{ id: 'S2', name: '9CS2.5x059', template: 'lippedc', params: C059 }] }, 'payload');
  assert(/템플릿/.test(DS.spanSectionsPayload(['S2'], [S2], 'lippedz').error), 'template mismatch blocks');
  assert(/템플릿으로 만든/.test(DS.spanSectionsPayload(['S2'], [S2], '').error), 'hand-drawn model blocks');
  assert.deepStrictEqual(DS.spanSectionsPayload(['S2'], [{ ...S2, params: { ...C059, t: null } }], 'lippedc').missing.map((m) => m.label), ['단면 S2 두께 t'], 'blank t is a blank field');
  // 상태: 단면을 더하고 경간에 — 지운 단면 → S1(그 변경을 낸 쓰는 이), 경간 수가 바뀌면 모두 S1
  let st = CS.applyChanges(CS.createCaseState(), { spanType: 'cont-4' }, 'user').state;
  st = CS.applyChanges(st, { sections: [S2], spanSections: ['S1', 'S2', 'S2', 'S1'] }, 'user').state;
  assert.deepStrictEqual(st.spans.spanSections, ['S1', 'S2', 'S2', 'S1']);
  assert(st.sources.sections === 'user' && st.sources.spanSections === 'user', 'sources');
  const rm = CS.applyChanges(st, { sections: [] }, 'ai');
  assert.deepStrictEqual(rm.state.spans.spanSections, ['S1', 'S1', 'S1', 'S1'], 'removed section → S1');
  assert(rm.accepted.includes('sections') && rm.accepted.includes('spanSections') && rm.state.sources.spanSections === 'default', 'removal accepted ' + rm.accepted);
  const bad = CS.applyChanges(st, { spanSections: ['S1', 'S3', 'S1', 'S1'] }, 'user');
  assert(bad.rejected.some((x) => x.key === 'spanSections') && JSON.stringify(bad.state.spans.spanSections) === JSON.stringify(st.spans.spanSections), 'unknown id rejected');
  const n5 = CS.applyChanges(st, { spanType: 'cont-n', nSpans: 5 }, 'user').state;
  assert.deepStrictEqual(n5.spans.spanSections, ['S1', 'S1', 'S1', 'S1', 'S1'], 'span count change → every span S1');
  assert.strictEqual(n5.sections.length, 1, 'the section list stays');
  // 파일: 처음 상태는 그 키를 적지 않는다(이 기능이 없던 파일과 같은 바이트), 쓰면 적는다, 옛 파일 → S1
  const plain = CS.toCaseRecord(CS.createCaseState());
  assert(!('spanSections' in plain.spans) && !('sections' in plain) && !('spanSections' in plain.sources), 'default record has no new key');
  const rec = CS.toCaseRecord(st);
  assert.deepStrictEqual(rec.spans.spanSections, ['S1', 'S2', 'S2', 'S1']); assert.strictEqual(rec.sections.length, 1);
  const back = CS.readCaseRecord(JSON.parse(JSON.stringify(rec)));
  assert.deepStrictEqual(back.warnings, []); assert.deepStrictEqual(back.state.spans, st.spans); assert.deepStrictEqual(back.state.sections, st.sections);
  const old = JSON.parse(JSON.stringify(rec)); delete old.spans.spanSections; delete old.sections;
  assert.deepStrictEqual(CS.readCaseRecord(old).state.spans.spanSections, ['S1', 'S1', 'S1', 'S1'], 'old file → every span S1');
  // 지문: 처음 상태 = 그 키가 없던 상태의 지문(기록 · 봉인이 그대로 맞는다)
  const s0 = CS.createCaseState();
  const { spanSections: _x, ...spansOld } = s0.spans; void _x;
  assert.strictEqual(FP.caseFp(s0), FP.caseFp({ inputs: s0.inputs, spans: spansOld, mcpOnly: s0.mcpOnly }), 'default caseFp unchanged');
  assert.notStrictEqual(FP.caseFp(st), FP.caseFp({ ...st, sections: [] , spans: { ...st.spans, spanSections: ['S1', 'S1', 'S1', 'S1'] } }), 'sections enter the fingerprint');
  // 본문: 모든 경간 S1 — 하중 본문에 새 키가 없다
  const ctx0 = { drafts: R.modelDrafts({ sectionTemplate: 'lippedc', sectionParams: C070 }), props: { Ixx: 12.2 }, lastDesign: null };
  const stDef = CS.applyChanges(CS.createCaseState(), { memberType: 'roof-purlin', sections: [S2] }, 'user').state;
  const b0 = R.buildLoadRequest(stDef, ctx0).data;
  assert(b0 && !('span_sections' in b0) && !('sections' in b0), 'S2 defined but every span S1 → no new key');
  // 변경 묶음의 글
  const snap = (s) => ({ model: {}, case: { inputs: s.inputs, spans: s.spans, mcpOnly: {}, ...(s.sections.length ? { sections: s.sections } : {}) } });
  const st2 = CS.applyChanges(st, { sections: [{ ...S2, params: { ...C059, t: 2.3 / 25.4 } }] }, 'user').state;
  const texts = (a, b, u) => DF.diffSnapshots(snap(a), snap(b)).fields.map((f) => CT.fieldText(f, u));
  const t1 = texts(CS.applyChanges(CS.createCaseState(), { spanType: 'cont-4' }, 'user').state, st, 'SI');
  assert(t1.includes('경간 2 단면 S1 → S2') && t1.includes('단면 S2 추가'), 'labels ' + JSON.stringify(t1));
  const stT = CS.applyChanges(st, { sections: [{ ...S2, params: { ...C059, t: 2 / 25.4 } }] }, 'user').state;
  assert(texts(stT, st2, 'SI').includes('단면 S2 두께 t 2 → 2.3 mm'), 'thickness label ' + JSON.stringify(texts(stT, st2, 'SI')));
  assert(texts(st, rm.state, 'US').includes('단면 S2 삭제'), 'removal label');
  // 랩 접합의 두 부재(화면 · 호스트 한 함수)
  const purlin = { span_sections: ['S1', 'S2'], sections: [{ id: 'S1', template: 'lippedc', params: C070, props: { Sf: 2.7 } }, { id: 'S2', template: 'lippedc', params: C059, props: { Sf: 2.3 } }],
    regions: [{ id: 'lap-1', kind: 'lap', support: 1, result: { utilization: 0.8, pass: true }, lap_members: [
      { section_id: 'S1', span: 0, Ixx: 12.2, lap_section: { Se: { value: 2.47 }, Vn: { value: 5 } } }, { section_id: 'S2', span: 1, Ixx: 10.3, lap_section: { Se: { value: 1.89 }, Vn: { value: 4 } } }] }] };
  assert.strictEqual(U.governingLapSupport(purlin), 2, 'governing lap support (1-based)');
  const two = U.lapTwoMembers(purlin, null, { stated: true });
  const body = U.applyLapTwoMembers({ d: 9, t: 0.07, Se: 9, Sf: 9, Vn: 9 }, two);
  assert.deepStrictEqual(body, { d: 9, t: 0.07, Se: 2.47, Sf: 2.7, Vn: 5, t_2: 0.059, d_2: 9, Se_2: 1.89, Sf_2: 2.3, Vn_2: 4, Ixx: 12.2, Ixx_2: 10.3 }, 'two-member lap body ' + JSON.stringify(body));
  assert.strictEqual(U.lapTwoMembers({ regions: [] }, 2, {}), null, 'not a per-span result → null');
  notes.push('P0: default all S1, payload rules, state rules (removed → S1, span count → S1), file / fp unchanged by default, labels, lap two members');
}

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('span_sections_contract: SKIP — no .venv python'); return; }
  pureChecks(ctx);
  const p = ctx.panel;
  const S = ctx.StcfsdPanel;
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_span_'));
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
  const client = new Client({ name: 'span-test', version: '1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(mdir, 'server.js')], env, stderr: 'pipe' }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content && r.content[0] && r.content[0].text) || '';
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { isError: !!r.isError, data, bytes: Buffer.byteLength(text), text };
  };
  const tool = async (name, args) => {
    const r = await call(name, args);
    if (r.isError || (r.data && r.data.error)) { throw new Error(`${name}: ${r.text.slice(0, 800)}`); }
    return r;
  };
  const scope = ctx.load(path.join('src', 'mcp', 'actorScope.ts'));
  const ai = (o) => scope.runAs({ kind: 'ai', client: 'span-test/1' }, () => p.handleMcpAction(o));
  const page = (command, data) => scope.runAs({ kind: 'person' }, () => p.__testDispatchMessage({ command, data }));
  const ok = (r, what) => { assert(r && !r.error, `${what}: ${JSON.stringify(r).slice(0, 800)}`); return r; };
  const R = ctx.load(path.join('src', 'case', 'requests.ts'));
  const engine = [];
  const realCall = p._pythonBridge.call.bind(p._pythonBridge);
  p._pythonBridge.call = (method, params) => {
    engine.push({ method, params: JSON.parse(JSON.stringify(params ?? null)) });
    return realCall(method, params);
  };
  const sent = (method) => engine.filter((e) => e.method === method);
  const strip = (r) => JSON.parse(JSON.stringify(r, (k, v) => (['timestamp', 'at', '_meta', 'case_rev', 'case_inputs_written', 'case_inputs_used', 'case_inputs_replaced'].includes(k) ? undefined : v)));
  /** 화면 단추(사람)의 퍼린 본문과 결과 — 본문은 호스트가 검토 상태로 만든다(k2 그림자) */
  const pressPurlin = async () => {
    const body = p._caseRequest(R.buildPurlinRequest, await p._caseHostProps());
    assert(body.data && body.missing.length === 0 && !body.error, 'screen body builds ' + JSON.stringify(body.missing || body.error));
    engine.length = 0;
    p.__testClearPostedMessages();
    await page('runPurlinDesign', body.data);
    const res = ctx.posted('designPurlinResult').pop();
    assert(res && res.data && !res.data.error, 'purlin result ' + JSON.stringify(res && res.data).slice(0, 600));
    return { body: body.data, res: res.data, loads: sent('analyze_loads').pop().params, designs: sent('aisi_design').map((e) => e.params) };
  };
  const II1A = { member_app: 'roof-purlin', span_type: 'cont-4', span_ft: 25, spans_ft: [25, 25, 25, 25], spacing_ft: 5, loads: { D: 15, Lr: 90, W: -144 }, design_method: 'LRFD',
    laps_per_support: [null, { left_ft: 2.0, right_ft: 2.75 }, { left_ft: 1.25, right_ft: 1.25 }, { left_ft: 2.75, right_ft: 2.0 }, null],
    deck: { type: 'through-fastened', t_panel: 0.019, fastener_spacing: 12 }, i621_conditions_confirmed: true, Fy: 55, Fu: 70, wc_N: 3.5, wc_R: 0.1875,
    lap_restrained: true, use_cold_work: false };
  try {
    ok(await ai({ action: 'open_project', name: 'SPAN', create: true }), 'open_project');
    ok(await ai({ action: 'new_case', name: 'A', kind: 'roof-purlin' }), 'new_case');
    ok(await ai({ action: 'open_case', name: 'A' }), 'open_case');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { ...C070 } }), 'template x070');
    // 화면 단추로 쓸 입력(MCP 로 상태에 합친다 — 화면과 같은 칸)
    await tool('design_purlin', { ...II1A });

    // ── P1: S2 를 정의만(모든 경간 S1) → 본문 · 결과가 같다 ──
    const one = await pressPurlin();
    const sumOne = await tool('run_case_check', { what: 'member', units: 'SI' });
    assert(!('span_sections' in one.loads) && !('span_sections' in one.body) && !one.res.sections && !one.res.span_sections, 'no new key without per-span sections');
    ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [{ id: 'S2', name: '9CS2.5x059', template: 'lippedc', params: { ...C059 } }] }), 'define S2');
    const oneB = await pressPurlin();
    assert.deepStrictEqual(oneB.body, one.body, 'S2 defined, every span S1: same screen body');
    assert.deepStrictEqual(oneB.loads, one.loads, 'same analyze_loads body');
    assert.deepStrictEqual(oneB.designs, one.designs, 'same region engine bodies');
    assert.deepStrictEqual(strip(oneB.res), strip(one.res), 'same result');
    notes.push(`P1: S2 defined, every span S1 → body, ${one.designs.length} region calls and result identical`);

    // ── P2: S2 = S1 의 치수 → 단면 하나와 같은 수 ──
    ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [{ id: 'S2', name: null, template: 'lippedc', params: { ...C070 } }], spans: { spanSections: ['S1', 'S2', 'S2', 'S1'] } }), 'S2 = S1');
    const same = await pressPurlin();
    assert.deepStrictEqual(same.loads.span_sections.map((x) => x.id), ['S1', 'S2', 'S2', 'S1'], 'span_sections reach the engine');
    const { id: _i1, ...a1 } = same.loads.span_sections[0]; const { id: _i2, ...a2 } = same.loads.span_sections[1]; void _i1; void _i2;
    assert.deepStrictEqual(a2, a1, 'S2 with S1 dimensions = the same engine section');
    assert.strictEqual(same.res.regions.length, one.res.regions.length, 'same regions');
    same.res.regions.forEach((g, i) => {
      const h = one.res.regions[i];
      assert.strictEqual(g.id, h.id);
      assert.strictEqual(g.result.utilization, h.result.utilization, `${g.id} ratio`);
      assert.strictEqual(g.result.pass, h.result.pass, `${g.id} verdict`);
      assert.strictEqual(g.result.design_strength, h.result.design_strength, `${g.id} strength`);
      if (g.lap_members) { assert.deepStrictEqual(g.lap_members.map((m) => m.share), [0.5, 0.5], `${g.id} shares 0.5`); }
    });
    assert.strictEqual(same.res.pass, one.res.pass); assert.strictEqual(same.res.utilization, one.res.utilization);
    notes.push(`P2: S2 = S1 dimensions → ${same.res.regions.length} regions with the same ratio / verdict / strength, lap shares 0.5 (max ratio ${one.res.utilization})`);

    // ── P3: II-1A 의 두 단면 ──
    ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [{ id: 'S2', name: '9CS2.5x059', template: 'lippedc', params: { ...C059 } }], spans: { spanSections: ['S1', 'S2', 'S2', 'S1'] } }), 'S2 = x059');
    const two = await pressPurlin();
    const ss = two.loads.span_sections;
    const blk = Object.fromEntries(two.res.sections.map((x) => [x.id, x]));
    assert.deepStrictEqual(ss.map((x) => x.Ixx), [blk.S1.props.Ixx, blk.S2.props.Ixx, blk.S2.props.Ixx, blk.S1.props.Ixx], 'each span: its section Ixx');
    assert(Math.abs(blk.S1.props.Ixx - 12.2) < 0.1 && Math.abs(blk.S2.props.Ixx - 10.3) < 0.1, 'II-1A Ix ' + [blk.S1.props.Ixx, blk.S2.props.Ixx]);
    assert(ss[1].thickness === 0.059 && ss[0].thickness === 0.07 && !('I_span_in4' in two.loads), 'section dims in the engine body; no I_span_in4 typed');
    assert.deepStrictEqual(two.res.span_sections, ['S1', 'S2', 'S2', 'S1']);
    assert(blk.S2.deck[0].kphi < blk.S1.deck[0].kphi, 'deck kphi per section');
    assert(blk.S1.curves.pos.lengths.length > 20 && blk.S2.curves.neg.load_factors.length === blk.S2.curves.neg.lengths.length, 'signature curves per section');
    assert(blk.S2.dsm_pos.Mxxcrl > 0 && blk.S2.dsm_neg.Mxxcrd > 0, 'buckling values per section');
    for (const g of two.res.regions) {
      if (g.lap_members || g.result.pass === null && g.not_evaluated_reason) { continue; }
      const want = ['S1', 'S2', 'S2', 'S1'][g.span];
      if (!g.sections_checked) { assert.strictEqual(g.section_id, want, `${g.id} section of span ${g.span}`); }
      // 그 구간의 검토 지점 모두 그 단면으로(엔진 본문 — 두께)
      const pts = (g.result.checks || []).map((c) => c.location && c.location.section_id);
      assert(pts.every((x) => x === g.section_id || (g.sections_checked && g.sections_checked.some((m) => m.section_id === x))), `${g.id} check points ${pts}`);
    }
    const pos2 = two.res.regions.find((g) => g.kind === 'positive' && g.span === 1);
    const lap1 = two.res.regions.find((g) => g.kind === 'lap' && g.support === 1 && g.side === 'left');
    const m1 = lap1.lap_members;
    const I1 = blk.S1.props.Ixx, I2 = blk.S2.props.Ixx;
    assert(Math.abs(m1[0].share - I1 / (I1 + I2)) < 1e-12 && Math.abs(m1[1].share - I2 / (I1 + I2)) < 1e-12, 'stiffness shares ' + JSON.stringify(m1.map((m) => m.share)));
    assert.deepStrictEqual(m1.map((m) => m.section_id), ['S1', 'S2']);
    const gov = m1[lap1.governing_member - 1];
    assert(gov.utilization >= Math.max(...m1.map((m) => m.utilization)) - 1e-12 && lap1.result.utilization === gov.utilization && lap1.section_id === gov.section_id, 'governing member decides');
    const ref = lap1.reference_sum_of_strengths;
    assert(Math.abs(ref.ratio - lap1.Mu / (m1[0].design_strength + m1[1].design_strength)) < 1e-12 && ref.ratio < gov.utilization, 'sum-of-strengths reference ' + JSON.stringify(ref));
    assert(Math.abs(m1[0].Mu - lap1.Mu * m1[0].share) < 1e-9, 'member Mu = share · M');
    const lapEng = two.designs.filter((d) => d.lap_region && d.check_location.region === lap1.id && d.check_location.check_point === 'M_max');
    assert.deepStrictEqual(lapEng.map((d) => d.section.thickness).sort(), [0.059, 0.07], 'each member checked with its own section');
    notes.push(`P3: lap ${lap1.id}: shares ${m1.map((m) => m.share.toFixed(4)).join(' | ')}, ratios ${m1.map((m) => m.utilization).join(' | ')} → governing ${gov.section_id} ${gov.utilization}; `
      + `sum-of-strengths reference ${ref.ratio.toFixed(4)} (M ${lap1.Mu.toFixed(2)} / (${m1[0].design_strength.toFixed(2)} + ${m1[1].design_strength.toFixed(2)}) kip-in)`);
    // 한 단면(x059)의 단독 실행: 같은 정모멘트 구간(데크 구속, Ly 0)의 강도가 같다
    const keepCase = JSON.parse(JSON.stringify(p.__testGetCase().state));
    ok(await ai({ action: 'save_case' }), 'save case A');
    ok(await ai({ action: 'new_case', name: 'B', kind: 'roof-purlin' }), 'new_case B');
    ok(await ai({ action: 'open_case', name: 'B' }), 'open_case B');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { ...C059 } }), 'template x059');
    const solo = await tool('design_purlin', { ...II1A, detail: 'full' });
    const posSolo = solo.data.regions.find((g) => g.kind === 'positive' && Math.abs(g.start_ft - pos2.start_ft) < 3);
    assert(Math.abs(posSolo.result.design_strength - pos2.result.design_strength) < 1e-9, `span-2 positive strength ${pos2.result.design_strength} = x059 alone ${posSolo.result.design_strength}`);
    notes.push(`P3b: span-2 positive region strength with S2 = x059 alone (${pos2.result.design_strength} kip-in)`);
    ok(await ai({ action: 'open_case', name: 'A' }), 'back to A');
    assert.deepStrictEqual(p.__testGetCase().state.sections, keepCase.sections, 'case A keeps its section list');
    // 검증 · 보고서
    const v = ok(await ai({ action: 'validate_design', detail: 'full' }), 'validate');
    const items = v.items || v.validation || [];
    for (const id of ['val.load_analysis.span_sections', 'val.load_analysis.deck_section.2', 'val.load_analysis.dsm_section.2', 'val.load_analysis.lap_members']) {
      assert(items.some((c) => c.id === id), 'validation item ' + id + ' in ' + items.filter((c) => /단면|랩 —/.test(c.item)).map((c) => c.id));
    }
    const rv = p.__testReview('SI');
    assert(/경간마다 단면/.test(rv.reportHtml) && /랩 구간 — 두 부재/.test(rv.reportHtml) && /강도의 합/.test(rv.reportHtml) && /9CS2\.5x059/.test(rv.reportHtml), 'report blocks');

    // ── P4: 춤이 다른 랩 · 지운 단면 · 직접 고친 모델 ──
    ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [{ id: 'S2', name: null, template: 'lippedc', params: { ...C059, H: 10 } }] }), 'S2 deeper');
    const deep = await pressPurlin();
    const mis = deep.res.regions.filter((g) => g.kind === 'lap' && (g.support === 1 || g.support === 3));
    assert(mis.length === 4 && mis.every((g) => g.result.pass === null && g.lap_evaluable === false && /depth|깊이/.test(g.not_evaluated_reason)), 'different depths → lap not evaluated ' + JSON.stringify(mis.map((g) => [g.id, g.result.pass, g.not_evaluated_reason_code])));
    assert(mis.every((g) => g.not_evaluated_reason_code === 'loads.reason.lap_depth_mismatch'), 'engine reason code');
    assert(deep.res.pass !== true, 'no overall pass with unevaluated laps');
    const midLap = deep.res.regions.filter((g) => g.kind === 'lap' && g.support === 2);
    assert(midLap.length === 2 && midLap.every((g) => g.result.pass !== null), 'S2|S2 lap evaluated');
    const rmv = ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [] }), 'remove S2');
    assert(rmv.accepted.includes('spanSections') && JSON.stringify(p.__testGetCase().state.spans.spanSections) === JSON.stringify(['S1', 'S1', 'S1', 'S1']), 'removed → S1 ' + JSON.stringify(rmv));
    ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [{ id: 'S2', name: '9CS2.5x059', template: 'lippedc', params: { ...C059 } }], spans: { spanSections: ['S1', 'S2', 'S2', 'S1'] } }), 'S2 again');
    const n1 = p._model.node[0];
    ok(await ai({ action: 'modify_node', node_id: 1, x: n1[1] + 1e-4, z: n1[2] }), 'edit a node');
    const blocked = await call('run_case_check', { what: 'member' });
    assert((blocked.isError || blocked.data.error) && /template/i.test(blocked.text), 'edited model blocks per-span sections ' + blocked.text.slice(0, 300));
    const noSet = ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [{ id: 'S3', template: 'lippedc', params: { ...C059 } }] }), 'set on edited');
    assert(noSet.rejected.some((x) => x.key === 'sections' && x.reason_code === 'host.case.sections_need_template'), 'sections refused on an edited model');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { ...C070 } }), 'template again');
    notes.push(`P4: depth 9 | 10 in → ${mis.length} lap regions not evaluated (loads.reason.lap_depth_mismatch), removed S2 → S1, edited model refused`);

    // ── P5: MCP 본문 = 화면 본문 · 파일 · 랩 접합 · SI ──
    const scr = await pressPurlin();
    engine.length = 0;
    const m = await tool('design_purlin', { ...II1A, sections: [{ id: 'S2', name: '9CS2.5x059', ...C059 }], span_sections: ['S1', 'S2', 'S2', 'S1'], detail: 'full' });
    assert.deepStrictEqual(sent('analyze_loads').pop().params, scr.loads, 'MCP analyze_loads body = screen body');
    assert.deepStrictEqual(m.data.regions.map((g) => [g.id, g.section_id, g.result.utilization]), scr.res.regions.map((g) => [g.id, g.section_id, g.result.utilization]), 'same regions');
    // 경간 표를 주면서 span_sections 를 주지 않으면 모든 경간 S1(묶음의 규칙)
    const reset = await tool('design_purlin', { ...II1A });
    assert(reset.data.case_inputs_written.includes('spanSections') && JSON.stringify(p.__testGetCase().state.spans.spanSections) === JSON.stringify(['S1', 'S1', 'S1', 'S1']), 'span table without span_sections → S1');
    await tool('design_purlin', { ...II1A, span_sections: ['S1', 'S2', 'S2', 'S1'] });
    // 파일 왕복
    ok(await ai({ action: 'save_case' }), 'save');
    const file = p.caseFile().path;
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepStrictEqual(saved.case.spans.spanSections, ['S1', 'S2', 'S2', 'S1']); assert.strictEqual(saved.case.sections[0].id, 'S2');
    ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [] }), 'clear');
    ok(await ai({ action: 'open_case', name: 'A' }), 'reopen A');
    assert.deepStrictEqual(p.__testGetCase().state.spans.spanSections, ['S1', 'S2', 'S2', 'S1'], 'file round trip');
    assert.strictEqual(p.__testGetCase().state.sections[0].params.t, 0.059);
    // 랩 접합: 지점 2(S1 | S2) — 두 부재
    engine.length = 0;
    ok(await ai({ action: 'set_case_inputs', inputs: { connLapLeft: 24, connLapRight: 33, connMu: 144, connVu: 2.5, connFastenerDia: 0.19, connNRows: 2, connLapPnvs: 1.2,
      connEdgeDist: 0.5, connLapSupport: null } }), 'lap inputs');
    const lap = await tool('run_case_check', { what: 'lap', detail: 'full' });
    const lb = sent('lap_connection').pop().params;
    assert(lb.t === 0.07 && lb.t_2 === 0.059 && lb.d_2 === 9 && lb.Ixx > lb.Ixx_2 && lb.Se > lb.Se_2 && lb.Se_2 > 0, 'lap body two members ' + JSON.stringify(lb));
    assert(lap.data.lap_two_members === true && lap.data.section_source.members.length === 2, 'lap result two members');
    notes.push(`P5: MCP body = screen body; span table without span_sections → S1; file round trip; lap at support ${lap.data.section_source.support} (${lap.data.section_source.support_defaulted ? 'governing lap' : 'given'}) t ${lb.t} | ${lb.t_2}, Se ${lb.Se.toFixed(3)} | ${lb.Se_2.toFixed(3)}`);
    // SI 답 · 예산
    const sumSI = await tool('run_case_check', { what: 'member', units: 'SI' });
    assert(!sumSI.data.si_unconverted, 'summary SI: no unconverted key ' + JSON.stringify([...new Set((sumSI.data.si_unconverted || []).map((x) => x.replace(/\[\d+\]/g, '[]')))]));
    const topKeys = (d) => Object.entries(d || {}).map(([k, v]) => [k, JSON.stringify(v).length]).sort((a, b) => b[1] - a[1]).slice(0, 10).map((x) => x.join(' ')).join(', ');
    const regKeys = (d) => { const c = {}; for (const g of d.regions || []) { for (const [k, v] of Object.entries(g)) { c[k] = (c[k] || 0) + JSON.stringify(v).length; } } return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x.join(' ')).join(', '); };
    assert(sumSI.bytes <= 40 * KB, `design_purlin summary ${sumSI.bytes} B ≤ 40 KB (largest: ${topKeys(sumSI.data)}; regions: ${regKeys(sumSI.data)}; elsewhere: ${JSON.stringify((sumSI.data.notices_elsewhere || []).map((n) => [String(n.text).slice(0, 50), (n.where || []).length]))})`);
    assert(Array.isArray(sumSI.data.sections) && !JSON.stringify(sumSI.data.sections).includes('load_factors'), 'summary sections without curves');
    const lapLine = sumSI.data.regions.find((g) => g.lap_members && g.lap_members[0].section_id !== g.lap_members[1].section_id);
    assert(lapLine && typeof lapLine.reference_sum_of_strengths_ratio === 'number', 'summary lap line with both members');
    assert(Math.abs(sumSI.data.sections.find((x) => x.id === 'S2').params.t - 0.059 * 25.4) < 1e-9, 'section params in mm');
    const fullSI = await tool('run_case_check', { what: 'member', units: 'SI', detail: 'full' });
    assert(!fullSI.data.si_unconverted, 'full SI: no unconverted key ' + JSON.stringify([...new Set((fullSI.data.si_unconverted || []).map((x) => x.replace(/\[\d+\]/g, '[]')))]).slice(0, 1500));
    const gi = await tool('get_case_inputs', { units: 'SI' });
    assert(gi.bytes <= 12 * KB && Math.abs(gi.data.sections[0].params.t - 0.059 * 25.4) < 1e-9 && gi.data.spans.spanSections.join() === 'S1,S2,S2,S1', 'get_case_inputs SI ' + gi.bytes);
    const loadsSI = await tool('run_case_check', { what: 'loads', units: 'SI' });
    assert(!loadsSI.data.si_unconverted, 'analyze_loads SI ' + JSON.stringify(loadsSI.data.si_unconverted || []).slice(0, 400));
    notes.push(`P5b: SI summary ${sumSI.bytes} B (single section ${sumOne.bytes} B; ≤ 40 KB, no curves), full ${fullSI.bytes} B, get_case_inputs ${gi.bytes} B, no unconverted key`);
    // 변경 묶음: 기록에 그 글
    const ch = ok(await ai({ action: 'list_changes', limit: 40 }), 'list_changes');
    const titles = JSON.stringify(ch);
    assert(/경간 2 단면 S1 → S2|단면 S2 추가/.test(titles), 'change titles ' + titles.slice(0, 400));
  } finally {
    S.writerKeyDir = saveKey; S.projectRoots = saveRoots;
    try { await client.close(); } catch { /* 닫힘 */ }
    try { await bridge.stop(); } catch { /* 닫힘 */ }
    ctx.close();
    try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* 남김 */ }
  }
  console.log('span_sections_contract: PASS\n  ' + notes.join('\n  '));
}

main().catch((e) => { console.error('span_sections_contract: FAIL\n', e && e.stack || e); process.exit(1); });
