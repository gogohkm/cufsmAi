/* global process */
// 계약 §6.3 — 랩 구속은 사람이 밝힌다(lap_restrained, 옛 이름 distortion_restrained). 호스트는 랩 구간에 lap_region: true 와
// 그 진술만 넘기고 Lb · Cb · distortional_not_applicable · Mcrd 를 정하지 않는다. 밝히지 않으면 랩 구간의 F2 · F4 는 판정 없음이고
// 화면 · 응답이 빠진 입력을 말한다. 한 검토 상태 키(lapRestrained) — 화면 칸 · MCP 인자 · 파일이 같다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPanel } = require('./panel_harness');

const OUT = path.join(__dirname, '..', 'rendered', 'out', 'lap_statement');
const II2A = {
  member_app: 'roof-purlin', span_type: 'cont-6', span_ft: 25, spans_ft: [1, 25, 25, 25, 25, 1], supports: ['N', 'P', 'P', 'P', 'P', 'P', 'N'],
  laps_per_support: [{ left_ft: 0, right_ft: 0 }, { left_ft: 0, right_ft: 0 }, { left_ft: 2.5, right_ft: 3.5 }, { left_ft: 1, right_ft: 1 },
    { left_ft: 3.5, right_ft: 2.5 }, { left_ft: 0, right_ft: 0 }, { left_ft: 0, right_ft: 0 }],
  spacing_ft: 5, loads: { D: 15, Lr: 100, S: 0, W: -170, Wp: 0, L: 0 }, design_method: 'ASD', laps: { left_ft: 3.5, right_ft: 3.5 },
  deck: { type: 'through-fastened', kphi_override: 0.3 }, pattern_loading: false, lr_reduced: false, i621_conditions_confirmed: true,
  I_span_in4: [9.18, 9.18, 7.76, 7.76, 9.18, 9.18], Fy: 55, Fu: 70,
};

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('lap_statement_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  // 엔진에 간 요청을 엿본다(값은 바꾸지 않는다)
  const calls = [];
  const orig = p._pythonBridge.call.bind(p._pythonBridge);
  p._pythonBridge.call = (method, params) => { calls.push({ method, params: JSON.parse(JSON.stringify(params || {})) }); return orig(method, params); };
  const lapCalls = () => calls.filter((c) => c.method === 'aisi_design' && c.params.check_location && /^lap/.test(c.params.check_location.region || ''));
  const lines = [];
  try {
    await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedz', params: { H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 } });
    await p.handleMcpAction({ action: 'set_lengths', min: 1, max: 1000, n: 30 });
    // 밝히지 않음
    calls.length = 0;
    const r0 = await p.handleMcpAction({ action: 'design_purlin', ...II2A });
    assert(!r0.error, r0.error);
    const lc0 = lapCalls();
    assert(lc0.length > 0, 'lap regions were designed');
    for (const c of lc0) {
      assert(c.params.lap_region === true && c.params.lap_restrained === undefined, 'lap_region without a statement');
      assert(!('distortional_not_applicable' in c.params) && c.params.Lb === undefined && c.params.Cb === undefined && c.params.dsm.Mcrd !== undefined,
        `the host decides nothing for the lap region: ${JSON.stringify({ Lb: c.params.Lb, Cb: c.params.Cb, dna: c.params.distortional_not_applicable, Mcrd: c.params.dsm.Mcrd })}`);
    }
    const lap0 = r0.regions.filter((g) => g.kind === 'lap');
    for (const g of lap0) {
      const dc = (id) => (g.result.design_checks || []).find((c) => c.id === id);
      // F4: the host passes the section's Mcrd (it no longer deletes it) — the engine evaluates F4 with it; never 'not applicable' without the statement
      assert(dc('member.flexure.distortional').verdict !== 'not_applicable', `${g.id}: F4 is not assumed away without the statement`);
      assert(['not_evaluated', 'fail'].includes(dc('member.flexure.global').verdict), `${g.id}: F2 not evaluated (or failing even at the Lb = 0 bound)`);
      assert(g.Ly_in === null && g.Cb === null, `${g.id}: no invented Ly / Cb`);
    }
    assert(r0.pass !== true, 'the purlin has no pass verdict without the statement');
    assert((r0.not_evaluated || []).some((x) => /lap_restrained/.test(x)), 'the reply names the missing statement');
    lines.push(`unstated: ${lap0.length} lap regions not evaluated (F2 / F4), verdict ${r0.pass}`);
    // 밝힘 → Manual 의 가정
    calls.length = 0;
    const r1 = await p.handleMcpAction({ action: 'design_purlin', ...II2A, lap_restrained: true });
    for (const c of lapCalls()) { assert(c.params.lap_region === true && c.params.lap_restrained === true, 'the statement is passed'); }
    for (const g of r1.regions.filter((x) => x.kind === 'lap')) {
      const dc = (id) => (g.result.design_checks || []).find((c) => c.id === id);
      assert(dc('member.flexure.distortional').verdict === 'not_applicable' && ['pass', 'fail'].includes(dc('member.flexure.global').verdict), `${g.id}: stated → F4 n/a, F2 evaluated`);
      assert(g.Ly_in === 0 && g.Cb === 1.0, `${g.id}: Lb = 0, Cb = 1.0 by the statement`);
    }
    assert.strictEqual(p.__testGetCase().state.inputs.lapRestrained, true, 'the MCP argument writes the case key');
    assert.strictEqual(p.__testGetCase().state.sources.lapRestrained, 'ai');
    lines.push(`stated: lap regions F4 n/a, F2 evaluated, verdict ${r1.pass}`);
    // 옛 이름(랩 도구) → 같은 키; 랩 요청에 lap_restrained
    calls.length = 0;
    await p.handleMcpAction({ action: 'set_case_inputs', inputs: { lapRestrained: false } });
    const lt = await p.handleMcpAction({ action: 'lap_connection', d: 8, t: 0.059, Fy: 55, Fu: 70, lap_left_in: 30, lap_right_in: 42, Mu_support: 60, Vu_support: 2,
      fastener_type: 'bolt', fastener_dia: 0.5, n_rows: 2, design_method: 'ASD', distortion_restrained: true });
    assert(!lt.error, JSON.stringify(lt).slice(0, 200));
    assert.strictEqual(p.__testGetCase().state.inputs.lapRestrained, true, 'the old name writes the same case key');
    // 화면 칸 → 같은 키(화면의 caseEdit), 파일 왕복
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { lapRestrained: false } } });
    assert.strictEqual(p.__testGetCase().state.inputs.lapRestrained, false);
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { lapRestrainedLap: true } } });
    assert.strictEqual(p.__testGetCase().state.inputs.lapRestrained, true, 'the lap-tab box is a mirror of the same key');
    const f = path.join(OUT, 'lap.csd');
    await p.__testWriteProjectFile(f);
    assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).case.inputs.lapRestrained, true, 'saved with the case');
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { lapRestrained: false } } });
    p.__testLoadProjectFile(f);
    assert.strictEqual(p.__testGetCase().state.inputs.lapRestrained, true, 'a reopened file drives the same key');
    // 파일에 그 키가 없으면 밝히지 않음
    const j = JSON.parse(fs.readFileSync(f, 'utf8')); delete j.case.inputs.lapRestrained; delete j.case.sources.lapRestrained;
    const g2 = path.join(OUT, 'old.csd'); fs.writeFileSync(g2, JSON.stringify(j));
    p.__testLoadProjectFile(g2);
    assert(p.__testGetCase().state.inputs.lapRestrained !== true, 'a file without it opens with it unset');
    lines.push('one case key: MCP (new and old name), page box and its mirror, .csd');
  } finally { ctx.close(); }
  console.log(`lap_statement_contract: PASS (${lines.join('; ')})`);
}
main().catch((e) => { console.error('lap_statement_contract: FAIL', e && e.message ? e.message : e); process.exitCode = 1; });
