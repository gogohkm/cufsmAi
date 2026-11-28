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
//     정모멘트 구간의 강도 = 그 단면 하나로 푼 강도, 랩 = 두 부재 강도의 합(결정 S3′ — 강도의 몫, 매뉴얼 0.7367) · 강성의 몫(참고),
//     데크 강성 한 번(결정 S7′ — kφ 가 가장 작은 단면 0.1126), 단면 블록(성질 · 좌굴값 · 곡선), 검증 · 보고서
//  P3c 부재의 강도를 얻지 못한 랩 → 평가하지 못함
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
  // 검증 2026-11-28 의 5: 단면 목록이 없는 처음 길 — 경간 수를 바꿔도 「경간 n 단면」 필드가 생기지 않는다(이 기능 전과 같은 필드)
  const d4 = CS.applyChanges(CS.createCaseState(), { spanType: 'cont-4' }, 'user').state;
  const d5 = CS.applyChanges(d4, { spanType: 'cont-n', nSpans: 5 }, 'user').state;
  const f45 = DF.diffSnapshots(snap(d4), snap(d5)).fields;
  assert(f45.length > 0 && !f45.some((f) => /spanSections|sections\[/.test(f.path)), 'default path: no span-section field ' + JSON.stringify(f45.map((f) => f.path)));
  const s5 = CS.applyChanges(d5, { sections: [S2], spanSections: ['S1', 'S1', 'S1', 'S1', 'S2'] }, 'user').state;
  assert(DF.diffSnapshots(snap(s5), snap(d4)).fields.some((f) => f.path === 'case.spans.spanSections[4]' && f.from === 'S2' && f.to === 'S1'), 'a missing index is S1');
  // 검증 2026-11-28 의 2: 주지 않은 치수는 S1 의 값(채운 그대로 — 단면마다 알림), S1 에도 없으면 그 단면 · 치수를 든 오류
  const fl = DS.fillSectionDims([{ id: 'S2', template: 'lippedc', params: { H: null, B: null, D: null, t: 0.085, r: null, qlip: null } }], C070);
  assert.deepStrictEqual(fl.list[0].params, { ...C070, t: 0.085 }, 'filled from S1');
  assert.deepStrictEqual(fl.filled, [{ id: 'S2', dims: { H: 9, B: 2.5, D: 0.8, r: 0.1875, qlip: 90 } }]);
  const fe = DS.fillSectionDims([{ id: 'S3', template: 'lippedc', params: { t: 0.06 } }], { H: 9, B: 2.5, D: 0.8, t: 0.07 });
  assert(fe.errors.length === 2 && /section S3: 모서리 r \(r\)/.test(fe.errors[0]) && /qlip/.test(fe.errors[1]), 'S1 has no r / qlip → error ' + fe.errors);
  // 검증 2026-11-28 의 3: 퍼린 결과 없이 단면 목록에서 랩의 두 부재(t · 깊이), 지점이 없고 단면이 다르면 오류, 모두 S1 이면 null, 모두 같은 단면이면 그 단면 둘
  const s1d = { template: 'lippedc', H: 9, B: 2.5, t: 0.07 };
  const lm = U.lapMembersFromSections(['S1', 'S2', 'S2', 'S1'], [S2], s1d, 2);
  assert(lm.from_list && lm.members[0].t === 0.07 && lm.members[1].t === 0.059 && lm.members[1].d === 9 && !lm.allS1 && !lm.same && lm.members.every((m) => m.Se === null), 'members from the list ' + JSON.stringify(lm));
  assert.deepStrictEqual(U.applyLapTwoMembers({ d: 9, t: 0.07 }, lm), { d: 9, t: 0.07, t_2: 0.059, d_2: 9 }, 'body: t_2 · d_2 only');
  assert(/connLapSupport/.test(U.lapMembersFromSections(['S1', 'S2', 'S2', 'S1'], [S2], s1d, null).error), 'blank support, different sections → error');
  assert.strictEqual(U.lapMembersFromSections(['S1', 'S1'], [S2], s1d, null), null, 'all S1 → null');
  assert(U.lapMembersFromSections(['S2', 'S2'], [S2], s1d, null).members.every((m) => m.section_id === 'S2' && m.t === 0.059), 'one section everywhere → that section');
  assert(U.lapMembersFromSections(['S1', 'S2', 'S2', 'S1'], [S2], s1d, 2).allS1 === false && U.lapMembersFromSections(['S1', 'S1', 'S2'], [S2], s1d, 2).allS1 === true, 'support 2 between S1 and S1');
  // 검증 2026-11-28 의 9: 지배 랩을 고른 근거 — 평가하지 못한 랩 · 양력 랩
  const pc = { span_sections: ['S1', 'S2'], regions: [{ id: 'lap-1', kind: 'lap', support: 1, result: { utilization: 0.8, pass: true } }, { id: 'lap-2', kind: 'lap', support: 2, result: { utilization: null, pass: null } },
    { id: 'uplift_lap-1', kind: 'uplift_support', support: 1, result: { utilization: 0.9, pass: true } }] };
  const ch = U.governingLapChoice(pc);
  assert(ch.support === 2 && ch.evaluated && ch.not_evaluated.map((g) => g.id).join() === 'lap-2' && ch.uplift_laps.map((g) => g.id).join() === 'uplift_lap-1' && U.governingLapSupport(pc) === 2, 'governing lap choice ' + JSON.stringify(ch));
  notes.push('P0: default all S1, payload rules, state rules (removed → S1, span count → S1), file / fp unchanged by default, labels, lap two members; '
    + 'default-path span count change has no span-section field, dimensions filled from S1 (or an error naming them), lap members from the list, governing-lap basis');
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
  let tamper = null;   // 엔진 답을 고쳐 보는 시험(부재 강도가 없을 때)
  p._pythonBridge.call = (method, params) => {
    engine.push({ method, params: JSON.parse(JSON.stringify(params ?? null)) });
    const pr = realCall(method, params);
    return tamper ? pr.then((res) => tamper(method, params, res)) : pr;
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
    // 검증 2026-11-28 의 4(b): 목록이 있는데 모든 경간 S1 — 결과에 「목록의 단면이 쓰이지 않음」 한 줄(그 밖은 같다)
    const unusedN = (oneB.res.notices || []).find((n) => n && n.code === 'host.purlin.sections_listed_unused');
    assert(unusedN && /S2/.test(unusedN.text) && oneB.res.warnings.includes(unusedN.text) && !(one.res.notices || []).some((n) => n && n.code === 'host.purlin.sections_listed_unused'), 'listed sections unused notice');
    const dropUnused = (res) => ({ ...res, warnings: res.warnings.filter((t) => t !== unusedN.text), notices: (res.notices || []).filter((n) => n.code !== 'host.purlin.sections_listed_unused') });
    assert.deepStrictEqual(strip(dropUnused(oneB.res)), strip(one.res), 'same result (but the unused-list notice)');
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
      if (g.lap_members) {
        // 결정 S3′: 같은 두 부재 — 강도의 몫 · 강성의 몫 모두 정확히 0.5, 두 번째 검토 없음(본문 · 부르는 수가 앞과 같다)
        assert.deepStrictEqual(g.lap_members.map((m) => [m.share, m.share_V, m.share_stiffness]), [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]], `${g.id} shares 0.5`);
        assert.strictEqual(same.designs.filter((d) => d.check_location && d.check_location.region === g.id && d.check_location.check_point === 'M_max').length,
          new Set(g.lap_members.map((m) => m.section_id)).size, `${g.id}: one call per member section, no second pass`);
      }
    });
    assert(!same.designs.some((d) => d.check_location && 'member_share_V' in d.check_location), 'equal members: no V share of its own in the bodies');
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
    // 결정 S7′: 데크 강성은 한 번 — kφ 가 가장 작은 단면(x059, 0.1126 kip-in/rad/in; x070 자신은 0.1417 — 참고)을 모든 단면 · 경간에
    assert(blk.S1.deck_used.kphi === blk.S2.deck_used.kphi && blk.S1.deck_used.section_id === 'S2' && blk.S2.deck_used.kphi === blk.S2.deck_own.kphi
      && Math.abs(blk.S2.deck_own.kphi - 0.1126) < 2e-4 && Math.abs(blk.S1.deck_own.kphi - 0.1417) < 2e-4, 'deck once (smallest kphi) ' + JSON.stringify([blk.S1.deck_used, blk.S1.deck_own, blk.S2.deck_own]));
    assert(!('dsm_pos_by_deck' in blk.S1) && !('pos_by_deck' in blk.S1.curves) && !('deck' in blk.S1), 'no per-deck variants');
    const apII = two.res.load_analysis.auto_params;
    assert(apII.deck.kphi === blk.S1.deck_used.kphi && apII.deck_basis.section_id === 'S2' && !('deck_by_span' in apII), 'engine deck_basis');
    // S1(x070)의 정모멘트 좌굴값: 혼자일 때(P1 — 그 자신의 kφ 0.1417)와 경간별 단면(kφ 0.1126 — 한 번 정한 값). 데크 스프링이 약해 같거나 작다
    const s1Own = one.res.dsm_positive, s1Per = blk.S1.dsm_pos;
    assert(s1Per.Mxxcrd <= s1Own.Mxxcrd + 1e-9 && s1Per.Mxxcrl > 0, 'S1 +M with the smaller deck stiffness ' + JSON.stringify([s1Own.Mxxcrl, s1Own.Mxxcrd, s1Per.Mxxcrl, s1Per.Mxxcrd]));
    notes.push(`P3 deck: kφ ${blk.S1.deck_own.kphi} (S1 own) · ${blk.S2.deck_own.kphi} (S2) → ${blk.S1.deck_used.kphi} every span; S1 +M Mcrl ${s1Own.Mxxcrl.toFixed(2)} → ${s1Per.Mxxcrl.toFixed(2)}, `
      + `Mcrd ${s1Own.Mxxcrd.toFixed(2)} → ${s1Per.Mxxcrd.toFixed(2)} kip-in; S2 +M Mcrl ${blk.S2.dsm_pos.Mxxcrl.toFixed(2)} · Mcrd ${blk.S2.dsm_pos.Mxxcrd.toFixed(2)} (its own kφ — unchanged)`);
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
    assert.deepStrictEqual(m1.map((m) => m.section_id), ['S1', 'S2']);
    // 결정 S3′(설계 매뉴얼 II-1A 의 가정 (c)): 랩의 판정은 두 부재 강도의 합 — 부재 i 의 몫 = φMn,i / Σ φMn (M), φVn,i / Σ φVn (V)
    const sum = lap1.sum_of_strengths;
    const fM = m1.map((m) => m.design_strength), fV = m1.map((m) => m.shear_strength);
    assert(lap1.strength_basis === 'sum_of_strengths' && sum && sum.basis === 'sum_of_strengths' && !('share_basis' in lap1) && !('reference_sum_of_strengths' in lap1), 'strength basis');
    assert(Math.abs(sum.design_strength_sum - (fM[0] + fM[1])) < 1e-9 && Math.abs(sum.flexure_ratio - lap1.Mu / (fM[0] + fM[1])) < 1e-12, 'sum of strengths ' + JSON.stringify(sum));
    assert(Math.abs(sum.flexure_ratio - 0.7367) < 5e-4, 'II-1A lap flexure ratio 144.42 / (111.81 + 84.23) = 0.7367: ' + sum.flexure_ratio);
    assert(m1.every((m, i) => Math.abs(m.share - fM[i] / (fM[0] + fM[1])) < 1e-12 && Math.abs(m.share_V - fV[i] / (fV[0] + fV[1])) < 1e-12), 'strength shares ' + JSON.stringify(m1.map((m) => [m.share, m.share_V])));
    assert(m1.every((m) => Math.abs(m.Mu / m.design_strength - sum.flexure_ratio) < 1e-12), 'each member: Mu_i / φMn,i = M / Σ φMn');
    assert(Math.abs(sum.shear_ratio - lap1.Vu / (fV[0] + fV[1])) < 1e-12 && m1.every((m) => Math.abs(m.Vu / m.shear_strength - sum.shear_ratio) < 1e-12), 'shear by the sum');
    assert(Math.abs(m1[0].share_stiffness - I1 / (I1 + I2)) < 1e-12 && Math.abs(m1[1].share_stiffness - I2 / (I1 + I2)) < 1e-12, 'stiffness shares (reference) ' + JSON.stringify(m1.map((m) => m.share_stiffness)));
    const gov = m1[lap1.governing_member - 1];
    assert(gov.utilization >= Math.max(...m1.map((m) => m.utilization)) - 1e-12 && lap1.result.utilization === gov.utilization && lap1.section_id === gov.section_id, 'governing member decides');
    // 강성의 몫으로 본 값은 참고(판정에 쓰지 않음) — 오늘까지의 판정비 0.7426 | 0.8607(몫 0.5418 | 0.4582)
    const ref = lap1.reference_stiffness_share;
    assert(ref && ref.basis === 'stiffness_Ix' && ref.members.length === 2 && Math.abs(ref.shares[0] - 0.5418) < 5e-4 && ref.governing_member === 2, 'stiffness reference ' + JSON.stringify(ref).slice(0, 400));
    assert(Math.abs(ref.members[0].utilization - 0.7426) < 2e-3 && Math.abs(ref.members[1].utilization - 0.8607) < 2e-3 && ref.ratio === ref.members[1].utilization, 'reference ratios ' + JSON.stringify(ref.members));
    assert(ref.ratio > lap1.result.utilization, 'the stiffness reference is not the verdict');
    // 엔진 본문: 강성의 몫으로 한 번(강도를 얻으려고), 강도의 몫으로 한 번(판정) — 부재마다 그 단면
    const lapEng = two.designs.filter((d) => d.lap_region && d.check_location.region === lap1.id && d.check_location.check_point === 'M_max');
    assert.deepStrictEqual(lapEng.map((d) => d.section.thickness).sort(), [0.059, 0.059, 0.07, 0.07], 'each member checked with its own section, two passes');
    const fin = lapEng.filter((d) => m1.some((m) => m.section_id === d.check_location.section_id && d.check_location.member_share === m.share));
    assert(fin.length === 2 && fin.every((d) => d.check_location.member_share_V !== undefined), 'final bodies carry the strength shares');
    notes.push(`P3: lap ${lap1.id}: Mu ${lap1.Mu.toFixed(2)} / (${fM[0].toFixed(2)} + ${fM[1].toFixed(2)}) = ${sum.flexure_ratio.toFixed(4)} kip-in, Vu ${lap1.Vu.toFixed(3)} / (${fV[0].toFixed(3)} + ${fV[1].toFixed(3)}) = ${sum.shear_ratio.toFixed(4)}; `
      + `strength shares M ${m1.map((m) => m.share.toFixed(4)).join(' | ')} V ${m1.map((m) => m.share_V.toFixed(4)).join(' | ')}, member ratios ${m1.map((m) => m.utilization).join(' | ')} (governing ${gov.section_id}); `
      + `stiffness reference ${ref.shares.map((s) => s.toFixed(4)).join(' | ')} → ${ref.members.map((x) => x.utilization).join(' | ')}`);
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
    for (const id of ['val.load_analysis.span_sections', 'val.load_analysis.deck_once', 'val.load_analysis.dsm_section.2', 'val.load_analysis.lap_members']) {
      assert(items.some((c) => c.id === id), 'validation item ' + id + ' in ' + items.filter((c) => /단면|랩 —/.test(c.item)).map((c) => c.id));
    }
    const rv = p.__testReview('SI');
    assert(/경간마다 단면/.test(rv.reportHtml) && /랩 구간 — 두 부재/.test(rv.reportHtml) && /강도의 합/.test(rv.reportHtml) && /9CS2\.5x059/.test(rv.reportHtml), 'report blocks');

    // ── P3c: 결정 S3′ — 한 부재의 강도를 얻지 못하면(엔진 답에서 S2 의 휨 설계강도를 지움) 그 랩은 평가하지 못함(첫 검토의 합격이 판정이 되지 않는다) ──
    tamper = (method, params, res) => (method === 'aisi_design' && params && params.lap_region && params.check_location && params.check_location.section_id === 'S2'
      && res && typeof res === 'object' ? { ...res, design_strength: null, display_unrounded: { ...(res.display_unrounded || {}), design_strength: null } } : res);
    let noStr;
    try { noStr = await pressPurlin(); } finally { tamper = null; }
    const lapsNs = noStr.res.regions.filter((g) => g.kind === 'lap');
    assert(lapsNs.length === 6 && lapsNs.every((g) => g.result.pass === null && g.result.utilization === null && g.not_evaluated_reason_code === 'host.purlin.lap_strength_unknown'
      && g.lap_members.every((m) => m.share === null)), 'member strength missing → lap not evaluated ' + JSON.stringify(lapsNs.map((g) => [g.id, g.result.pass, g.not_evaluated_reason_code])));
    assert(noStr.res.pass !== true && (noStr.res.notices || []).some((n) => n && n.code === 'host.purlin.region_not_evaluated'), 'no overall pass');
    notes.push(`P3c: S2 strength removed from the engine reply → ${lapsNs.length} lap regions not evaluated (host.purlin.lap_strength_unknown), overall ${noStr.res.pass}`);

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
    assert(lapLine && typeof lapLine.sum_of_strengths.flexure_ratio === 'number' && typeof lapLine.reference_stiffness_share_ratio === 'number'
      && lapLine.lap_members.every((x) => typeof x.share === 'number'), 'summary lap line with both members ' + JSON.stringify(lapLine));
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

    // ── P6: 독립 검증(2026-11-28)이 찾은 것 ──
    // 요약 · 그린 답의 목록은 {code, text}, detail:'full' 은 글 목록 + notices
    const noteOf = (d, code) => [...(d.assumptions || []), ...(d.warnings || []), ...(d.not_evaluated || []), ...(Array.isArray(d.notices) ? d.notices : [])]
      .find((x) => x && typeof x === 'object' && x.code === code);
    // 4(a): 경간 표를 span_sections 없이 → 모든 경간 S1 이라고 그 답에
    const resetN = noteOf(reset.data, 'host.case.span_sections_reset');
    assert(resetN && /S2/.test(resetN.text), 'reset notice in the reply ' + JSON.stringify(reset.data.assumptions).slice(0, 400));
    // 6(a): 하중 해석의 기본 답 — 경간마다 짧은 줄(§I6.2.1 · 데크), 전체는 detail:'full'
    const alS = await tool('analyze_loads', { ...II1A, sections: [{ id: 'S2', name: '9CS2.5x059', ...C059 }], span_sections: ['S1', 'S2', 'S2', 'S1'] });
    const alF = await tool('analyze_loads', { ...II1A, sections: [{ id: 'S2', name: '9CS2.5x059', ...C059 }], span_sections: ['S1', 'S2', 'S2', 'S1'], detail: 'full' });
    const ib = alS.data.auto_params.i621_by_span, db = alS.data.auto_params.deck_basis;
    assert(ib.length === 4 && ib.every((b) => !('check' in b) && Object.keys(b).every((k) => ['span', 'section_id', 'R', 'real_span', 'failing'].includes(k))) && ib[1].section_id === 'S2', 'compact i621 rows ' + JSON.stringify(ib));
    assert(db.section_id === 'S2' && db.by_section.every((d) => Object.keys(d).join() === 'section_id,spans,kphi,kx,adopted') && !('deck_by_span' in alS.data.auto_params), 'compact deck rows ' + JSON.stringify(db));
    assert(/i621_by_span/.test(alS.data.more) && /deck_basis/.test(alS.data.more), 'more names the shortened blocks');
    assert(alF.data.auto_params.i621_by_span[0].check && alF.data.auto_params.deck_basis.by_section[0].kphi_method, 'full keeps the objects');
    // 검증 때 121.3 KB(경간마다 §I6.2.1 검토 전부 17.8 KB · 데크 블록 5.3 KB) — 짧은 줄로 약 95 KB
    assert(alS.bytes <= 100 * KB, `analyze_loads default reply ${alS.bytes} B`);
    notes.push(`P6 4a · 6a: reset notice; analyze_loads default ${alS.bytes} B (full ${alF.bytes} B), per-span rows compact`);

    // 1: 랩 없이 단면이 바뀌는 지점 — 지점에 얹힌 단면마다 §G5 · §H3(S1|S1|S2|S2, S2 t 0.050)
    const thin = { id: 'S2', name: 'thin', ...C059, t: 0.050, D: 0.75 };
    const wcBase = { ...II1A, loads: { D: 10, Lr: 45, W: -20 }, laps_per_support: [null, null, null, null, null], detail: 'full' };
    const wcAt = (d, sup) => d.regions.flatMap((g) => (g.result.checks || []).filter((c) => c.check_point === `support ${sup}`)
      .map((c) => ({ region: g.id, sec: c.location.section_id, wc: (c.design_checks || []).find((x) => x.id === 'member.web_crippling'), h3: (c.design_checks || []).find((x) => x.id === 'member.bending_web_crippling') })));
    for (const [ss, label] of [[['S1', 'S1', 'S2', 'S2'], 'S1|S1|S2|S2'], [['S2', 'S2', 'S1', 'S1'], 'mirror']]) {
      const wr = await tool('design_purlin', { ...wcBase, sections: [thin], span_sections: ss });
      const at3 = wcAt(wr.data, 3);
      const s2 = at3.find((x) => x.sec === 'S2'), s1 = at3.find((x) => x.sec === 'S1');
      assert(s1 && s2 && s1.region !== s2.region, `${label}: support 3 checked with both sections ` + JSON.stringify(at3.map((x) => [x.region, x.sec])));
      assert(s2.wc.verdict === 'fail' && Math.abs(s2.wc.ratio - 1.158) < 0.002 && Math.abs(s2.h3.ratio - 1.322) < 0.002, `${label}: S2 at support 3 G5 ${s2.wc.ratio} / H3 ${s2.h3.ratio}`);
      assert(s1.wc.verdict === 'pass' && Math.abs(s1.wc.ratio - 0.560) < 0.002 && Math.abs(s1.h3.ratio - 0.686) < 0.002, `${label}: S1 at support 3 G5 ${s1.wc.ratio} / H3 ${s1.h3.ratio}`);
      const ssc = wr.data.support_sections_checked;
      assert(ssc.length === 1 && ssc[0].support === 3 && ssc[0].pass === false && ssc[0].sections_checked.map((x) => x.section_id).sort().join() === 'S1,S2', 'support_sections_checked ' + JSON.stringify(ssc));
      assert(noteOf(wr.data, 'host.purlin.support_section_change'), 'support section rule cited');
      // 끝 지점: 그 경간의 단면 하나
      assert.deepStrictEqual(wcAt(wr.data, 1).map((x) => x.sec), [ss[0]], 'end support 1'); assert.deepStrictEqual(wcAt(wr.data, 5).map((x) => x.sec), [ss[3]], 'end support 5');
      assert(wr.data.pass === false, 'fail wins');
    }
    notes.push('P6 1: support 3 of S1|S1|S2|S2 (and mirrored) checked with S1 (G5 0.560 / H3 0.686 pass) and S2 (1.158 / 1.322 fail); end supports with their span section');

    // 7: 어느 경간도 S1 이 아니면 맨 위 단면 값은 첫 경간의 단면 하나의 것(top_level_section_id)
    const allS2 = await tool('design_purlin', { ...wcBase, sections: [thin], span_sections: ['S2', 'S2', 'S2', 'S2'] });
    const b2 = allS2.data.sections.find((x) => x.id === 'S2');
    assert(allS2.data.top_level_section_id === 'S2' && allS2.data.props.Ixx === b2.props.Ixx && allS2.data.dsm_negative.Mxxcrl === b2.dsm_neg.Mxxcrl && allS2.data.dsm_positive.Mxxcrd === b2.dsm_pos.Mxxcrd,
      'top level = S2 ' + JSON.stringify([allS2.data.top_level_section_id, allS2.data.props.Ixx, b2.props.Ixx]));
    const sumTop = await tool('run_case_check', { what: 'member' });
    assert(sumTop.data.top_level_section_id === 'S2' && /section S2/.test(sumTop.data.more), 'summary names the top-level section');
    assert(m.data.top_level_section_id === 'S1', 'S1 used → S1');
    notes.push(`P6 7: all spans S2 → top-level props / dsm of S2 (Ixx ${b2.props.Ixx.toFixed(3)})`);

    // 2: 주지 않은 치수 — S1 의 값(「S1 과 같고 더 두껍게」), 상태에는 채운 값, 답에 알림(SI 로 그려진다)
    const thick = await tool('design_purlin', { ...II1A, sections: [{ t: 0.085 }], span_sections: ['S2', 'S1', 'S1', 'S2'], units: 'US' });
    assert.deepStrictEqual(p.__testGetCase().state.sections[0].params, { ...C070, t: 0.085 }, 'stored params complete');
    const dimN = noteOf(thick.data, 'host.case.section_dims_from_s1');
    assert(dimN && /qlip = 90/.test(dimN.text) && /r = 0\.1875 in/.test(dimN.text), 'dims-from-S1 notice ' + JSON.stringify(dimN));
    const thickSI = ok(await ai({ action: 'set_case_inputs', units: 'SI', inputs: {}, sections: [{ id: 'S2', template: 'lippedc', params: { t: 2.159 } }], __reply: { units: 'SI' } }), 'set SI');
    const dimSI = noteOf(thickSI, 'host.case.section_dims_from_s1');
    assert(dimSI && /r = 4\.76\d* mm/.test(dimSI.text) && /H = 228\.6 mm/.test(dimSI.text) && Math.abs(p.__testGetCase().state.sections[0].params.t - 0.085) < 1e-12, 'SI notice ' + JSON.stringify(thickSI).slice(0, 400));
    const setN = ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [{ id: 'S2', template: 'lippedc', params: { t: 0.08 } }], __reply: { units: 'US' } }), 'set_case_inputs fill');
    assert(setN.accepted.includes('sections') && setN.assumptions.some((x) => x.code === 'host.case.section_dims_from_s1') && p.__testGetCase().state.sections[0].params.qlip === 90, 'set_case_inputs fills from S1');
    // 뒤에 S1 을 고쳐도 S2 는 그대로
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { ...C070, r: 0.25 } }), 'S1 r 0.25');
    assert.strictEqual(p.__testGetCase().state.sections[0].params.r, 0.1875, 'S2 keeps its r');
    // S1 에도 없는 치수 → 그 단면 · 그 치수를 든 오류
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { H: 9, B: 2.5, D: 0.8, t: 0.07 } }), 'S1 without r / qlip');
    const noR = await call('design_purlin', { ...II1A, sections: [{ id: 'S2', t: 0.06 }], span_sections: ['S1', 'S2', 'S2', 'S1'] });
    assert((noR.isError || noR.data.error) && /section S2: 모서리 r \(r\) is not given/.test(noR.text), 'missing in S1 → error ' + noR.text.slice(0, 300));
    const noRset = ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [{ id: 'S2', template: 'lippedc', params: { t: 0.06 } }] }), 'set without r');
    assert(noRset.rejected.some((x) => x.key === 'sections' && x.reason_code === 'host.case.section_dims_missing'), 'set_case_inputs refuses');
    ok(await ai({ action: 'generate_template', section_type: 'lippedc', params: { ...C070 } }), 'template x070 again');
    notes.push('P6 2: sections [{t: 0.085}] → H B D r qlip from S1 (stored, notice in US / SI), S1 edit leaves S2, no value in S1 → error naming S2 / r');

    // 3: 랩 접합 — 퍼린 결과 없이(단면 목록을 바꿔 지웠다) 지점 2(S1 | S2): 두 부재 x070 / x059, Pns 0.918 kip(전: 1.187 — 두 장 모두 x070)
    ok(await ai({ action: 'set_case_inputs', inputs: { connLapSupport: 2, connLapPnvs: 5.0 }, sections: [{ id: 'S2', name: '9CS2.5x059', template: 'lippedc', params: { ...C059 } }], spans: { spanSections: ['S1', 'S2', 'S2', 'S1'] } }), 'lap inputs, no purlin');
    engine.length = 0;
    const lapNo = await tool('run_case_check', { what: 'lap', detail: 'full' });
    const lbNo = sent('lap_connection').pop().params;
    assert(lbNo.t === 0.07 && lbNo.t_2 === 0.059 && lbNo.d_2 === 9 && !('Se_2' in lbNo) && !('Ixx_2' in lbNo), 'lap body from the list ' + JSON.stringify(lbNo));
    const pnsNo = lapNo.data.Pns ?? (lapNo.data.fastener && lapNo.data.fastener.Pns);
    assert(Math.abs(pnsNo - 0.918) < 0.0015, 'Pns 0.918 (two sheets x070 | x059 — was 1.187 for two x070) ' + JSON.stringify(pnsNo));
    assert(noteOf(lapNo.data, 'host.lap.members_from_list') && lapNo.data.section_source.members.length === 2, 'members-from-list notice');
    assert(lapNo.data.pass !== true, 'lap without Se is not a pass');
    ok(await ai({ action: 'set_case_inputs', inputs: { connLapSupport: null } }), 'blank lap support');
    const lapRef = await call('run_case_check', { what: 'lap' });
    assert((lapRef.isError || lapRef.data.error) && /connLapSupport/.test(lapRef.text), 'blank support, no purlin → refused ' + lapRef.text.slice(0, 300));
    notes.push(`P6 3: lap at support 2 without a purlin result → t ${lbNo.t} | t_2 ${lbNo.t_2}, Pns ${pnsNo} kip; blank support refused`);

    // 9: 지점을 비우고 퍼린 결과의 지배 랩 — 양력 랩은 넣지 않았다고 · 평가하지 못한 랩이 있으면 그 랩을 들어
    ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [{ id: 'S2', name: null, template: 'lippedc', params: { ...C059, H: 10 } }] }), 'S2 deeper (laps 1, 3 not evaluated)');
    await tool('run_case_check', { what: 'member' });
    const lapG = await tool('run_case_check', { what: 'lap', detail: 'full' });
    const gN = noteOf(lapG.data, 'host.lap.governing_support_partial');
    const gKo = gN && (gN.text_ko || gN.text);
    assert(gN && /평가한 중력 랩 가운데/.test(gKo) && /평가하지 못한 랩/.test(gKo) && /지점 2 왼쪽/.test(gKo) && /양력 랩/.test(gKo) && lapG.data.section_source.support === 3, 'honest governing lap notice ' + JSON.stringify(gN));
    notes.push(`P6 9: governing lap (support ${lapG.data.section_source.support}) chosen among the evaluated gravity laps — notice names the laps not evaluated and the uplift laps`);

    // 8: 검증 항목 — 랩 부재가 불합격이면 fail, 춤이 다른 랩은 판정 없음(warn), 내민 경간의 R 없음은 경고가 아니다
    const v8 = ok(await ai({ action: 'validate_design', detail: 'full' }), 'validate (depth mismatch)');
    const it8 = (vv, id) => (vv.items || vv.validation || []).find((c) => c.id === id);
    assert.strictEqual(it8(v8, 'val.load_analysis.lap_members').status, 'warn', 'depth mismatch → not evaluated (warn)');
    ok(await ai({ action: 'set_case_inputs', inputs: {}, sections: [{ id: 'S2', name: 'thin', template: 'lippedc', params: { ...C059, t: 0.040, D: 0.75 } }] }), 'S2 very thin');
    const failRun = await tool('design_purlin', { ...II1A, loads: { D: 15, Lr: 140, W: -144 }, span_sections: ['S1', 'S2', 'S2', 'S1'], detail: 'full' });
    assert(failRun.data.regions.some((g) => Array.isArray(g.lap_members) && g.lap_members.some((x) => x.pass === false)), 'a lap member fails');
    const v8b = ok(await ai({ action: 'validate_design', detail: 'full' }), 'validate (lap member fails)');
    assert.strictEqual(it8(v8b, 'val.load_analysis.lap_members').status, 'fail', 'lap member fails → fail');
    const ovh = await tool('design_purlin', { ...II1A, span_type: 'cont-n', n_spans: 4, spans_ft: [3, 25, 25, 3], supports: ['N', 'P', 'P', 'P', 'N'],
      laps_per_support: [null, { left_ft: 0, right_ft: 2.0 }, { left_ft: 1.25, right_ft: 1.25 }, { left_ft: 2.0, right_ft: 0 }, null],
      sections: [{ id: 'S2', name: '9CS2.5x059', ...C059 }], span_sections: ['S1', 'S2', 'S2', 'S1'], detail: 'full' });
    const rBy = ovh.data.load_analysis.auto_params.uplift_R_by_span;
    assert(rBy[0] === null && rBy[3] === null && rBy[1] !== null && rBy[2] !== null, 'overhang spans have no R ' + JSON.stringify(rBy));
    const v8c = ok(await ai({ action: 'validate_design', detail: 'full' }), 'validate (overhangs)');
    const ur = it8(v8c, 'val.load_analysis.uplift_r_span');
    assert(ur.status === 'pass' && /해당 없음/.test(ur.value), 'overhang spans do not warn ' + JSON.stringify(ur));
    notes.push('P6 8: lap_members warn (depth mismatch) · fail (a member fails); uplift_r_span pass with overhang spans ' + JSON.stringify(rBy));

    // 6(b): 요약의 예산 — 6 경간 · 3 단면 SI ≤ 40 KiB(줄인 것을 more 에), 한 단면 4 경간은 줄이지 않는다
    const S3x = { id: 'S3', name: '9CS2.5x080', ...C070, t: 0.080 };
    const n6 = 6;
    const laps6 = Array.from({ length: n6 + 1 }, (_, j) => (j === 0 || j === n6 ? null : { left_ft: 2.0, right_ft: 2.75 }));
    await tool('design_purlin', { ...II1A, span_type: 'cont-n', n_spans: n6, spans_ft: Array(n6).fill(25), supports: undefined, laps_per_support: laps6,
      sections: [{ id: 'S2', name: '9CS2.5x059', ...C059 }, S3x], span_sections: ['S3', 'S2', 'S1', 'S2', 'S1', 'S3'] });
    const big = await tool('run_case_check', { what: 'member', units: 'SI' });
    assert(big.bytes <= 40 * KB && /Over the 40960 B summary budget/.test(big.data.more), `6 spans / 3 sections SI summary ${big.bytes} B with the budget note`);
    const shortLines = big.data.regions.filter((g) => !('label' in g));
    assert(shortLines.length > 0 && shortLines.every((g) => g.pass === true && Object.keys(g).every((k) => ['id', 'kind', 'span', 'spans', 'section_id', 'ratio', 'pass'].includes(k))), 'shortened lines are passing minimal lines');
    assert(big.data.regions.filter((g) => g.pass !== true).every((g) => 'label' in g) && ('label' in big.data.regions.find((g) => g.id === big.data.governing.id)), 'fail / not-evaluated / governing lines kept');
    notes.push(`P6 6b: 6 spans / 3 sections SI summary ${big.bytes} B (${shortLines.length} passing lines shortened); single-section 4 spans ${sumOne.bytes} B untouched`);
    assert(!/summary budget/.test(sumOne.data.more) && sumOne.bytes <= 40 * KB, 'single-section 4-span summary untouched');
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
