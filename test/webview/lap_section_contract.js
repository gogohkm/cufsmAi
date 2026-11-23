/* global process */
// V8-01 — 퍼린 뒤의 랩 접합 검토는 단면 강도(Se · Vn)를 **그 랩이 걸친 지점의 퍼린 랩 구간**에서 가져온다(지배 구간이 아니다).
//   node test/webview/lap_section_contract.js
//  1. II-2A(랩 진술): 첫 안쪽 지점(지점 3)의 랩 → 랩 휨 국부 비 = 퍼린 lap-1 구간의 F3 비, 뒤틀림은 불합격이 아니다(Mnd 를 보내지 않음),
//     결과의 section_source 가 그 구간 · 지점을 말한다. 화면 단추 · run_case_check 의 본문(호스트) — 같은 함수(utils.deriveLapSection)
//  2. 지점을 모르거나 · 진술이 없으면 짓지 않는다(Se 없음 · 까닭) — 랩 휨은 판정 없음
//  3. 비탄성 여유를 켜도(V8-S2) Se 는 그 지점 랩 구간의 lap_section 블록(엔진 e38af69 — Fn = Fy, 여유 · 냉간가공 없음) — 여유가 랩으로 옮겨 가지 않고,
//     지배 구간을 따라가지도 않는다(K4b: 전에는 짓지 않았다 — 블록이 그 경우를 위해 있다)
//  4. 순수 함수: 정모멘트 구간이 지배해도(V8-S2) · 그 지점의 랩 구간이 없으면 · 왼쪽 · 오른쪽이 다르면(작은 쪽)
'use strict';
const assert = require('assert');
const path = require('path');
const { createPanel } = require('./panel_harness');
const U = require(path.join(__dirname, '..', '..', 'webview', 'js', 'utils.js'));

const II2A = { member_app: 'roof-purlin', span_type: 'cont-6', span_ft: 25, spans_ft: [1, 25, 25, 25, 25, 1], supports: ['N', 'P', 'P', 'P', 'P', 'P', 'N'],
  laps_per_support: [{ left_ft: 0, right_ft: 0 }, { left_ft: 0, right_ft: 0 }, { left_ft: 2.5, right_ft: 3.5 }, { left_ft: 1, right_ft: 1 }, { left_ft: 3.5, right_ft: 2.5 }, { left_ft: 0, right_ft: 0 }, { left_ft: 0, right_ft: 0 }],
  spacing_ft: 5, loads: { D: 15, Lr: 100, S: 0, W: -170, Wp: 0, L: 0 }, design_method: 'ASD', laps: { left_ft: 3.5, right_ft: 3.5 },
  deck: { type: 'through-fastened', kphi_override: 0.3 }, pattern_loading: false, lr_reduced: false, i621_conditions_confirmed: true,
  I_span_in4: [9.18, 9.18, 7.76, 7.76, 9.18, 9.18], Fy: 55, Fu: 70, use_cold_work: true, lap_restrained: true };
const check = (r, id) => (r.design_checks || []).find((c) => c.id === id);
const lapMnl2 = (r) => (r.design_checks.find((c) => c.id === 'member.flexure.local') || {}).nominal.value;

async function main() {
  const notes = [];
  // ── 4. 순수 함수 ─────────────────────────────────────────────────────
  {
    const reg = (id, kind, support, Mnl, Vn, util) => ({ id, kind, support, result: { Mnl, Fy_used: 50, shear: { Vn }, utilization: util, pass: util <= 1,
      ...(kind === 'lap' ? { lap_section: { available: Mnl > 0, Se: Mnl > 0 ? { symbol: 'Se', value: Mnl / 50, quantity: 'section_modulus' } : null,
        Vn: { symbol: 'Vn', value: Vn, quantity: 'force' }, ...(Mnl > 0 ? {} : { reason: 'no Mcrl' }) } } : {}) } });
    const purlin = { pass: false, regions: [reg('positive-1', 'positive', null, 120, 5, 1.4), reg('lap-1', 'lap', 2, 90, 4, 0.8), reg('lap-2', 'lap', 2, 80, 3.5, 0.7)] };
    assert.strictEqual(U.pickGoverningPurlinDesign(purlin).Mnl, 120, 'the positive region governs this bundle');
    const d = U.deriveLapSection(purlin, 3, { stated: true });
    assert.deepStrictEqual([d.Se, d.Vn, d.regions, d.support, d.reason], [80 / 50, 3.5, ['lap-1', 'lap-2'], 3, null], 'the smaller lap region at support 3 — not the governing positive region');
    for (const [args, re] of [[[purlin, 2, { stated: true }], /no lap region at support 2/], [[purlin, null, { stated: true }], /not set/],
      [[purlin, 3, {}], /not stated/], [[null, 3, { stated: true }], /no purlin/], [[{ regions: [reg('lap-1', 'lap', 2, 0, 4, 1)] }, 3, { stated: true }], /not available — no Mcrl/],
      [[{ regions: [{ id: 'lap-1', kind: 'lap', support: 2, result: { Mnl: 90, Fy_used: 50 } }] }, 3, { stated: true }], /no lap_section block/]]) {
      const x = U.deriveLapSection(...args);
      assert(x.Se === null && x.Vn === null && re.test(x.reason), `${JSON.stringify(args[1])}: ${x.reason}`);
    }
    notes.push('pure function: lap region at the support, smaller side, nothing derived without support / region / statement');
  }

  const ctx = await createPanel();
  if (!ctx) { console.log('lap_section_contract: SKIP — no .venv python (pure function checked)'); return; }
  const p = ctx.panel;
  try {
    await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedz', params: { H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 } });
    await p.handleMcpAction({ action: 'set_lengths', min: 1, max: 1000, n: 30 });
    const lapInputs = (purlin, extra = {}) => {
      const lap1 = purlin.regions.find((g) => g.id === 'lap-1');
      return { connLapLeft: 30, connLapRight: 42, connMu: lap1.Mu, connVu: 1.78, connFastenerType: 'bolt', connFastenerDia: 0.5, connNRows: 2, connLapSupport: 3, ...extra };
    };

    // ── 1. II-2A ──────────────────────────────────────────────────────
    const pr = JSON.parse(JSON.stringify(await p.handleMcpAction({ action: 'design_purlin', ...II2A })));
    assert(!pr.error, pr.error);
    const lap1 = pr.regions.find((g) => g.id === 'lap-1');
    const gov = pr.regions.find((g) => g.id === pr.governing.id);
    assert.notStrictEqual(gov.id, 'lap-1', `the governing region is another region (${gov.id})`);
    const f3 = check(lap1.result, 'member.flexure.local');
    let s = await p.handleMcpAction({ action: 'set_case_inputs', inputs: lapInputs(pr) });
    assert(s.success, JSON.stringify(s.rejected));
    let lr = JSON.parse(JSON.stringify(await p.handleMcpAction({ action: 'run_case_check', what: 'lap' })));
    assert(!lr.error, lr.error);
    const loc = check(lr, 'lap.flexure.local');
    assert(loc && Math.abs(loc.ratio - f3.ratio) <= 1e-6 * f3.ratio, `lap flexure (local) ${loc && loc.ratio} = the purlin lap-1 F3 ratio ${f3.ratio} (was 6.898 with the governing region)`);
    assert.strictEqual(loc.verdict, f3.verdict);
    const dist = check(lr, 'lap.flexure.distortional');
    assert(!dist || dist.verdict !== 'fail', `distortional is not failed from an unrestrained Mnd (${dist && dist.verdict} ${dist && dist.ratio})`);
    const src = lr.section_source;
    const ls1 = lap1.result.lap_section;
    assert(ls1 && ls1.available === true && ls1.Se.quantity === 'section_modulus', 'the lap region carries the lap_section block');
    assert(src && src.Se === ls1.Se.value && src.Vn === ls1.Vn.value && src.support === 3 && src.regions.includes('lap-1') && /lap_section/.test(src.from),
      `section_source names the lap region at support 3 and takes its lap_section block: ${JSON.stringify(src)}`);
    assert(Math.abs(src.Se - gov.result.Mnl / gov.result.Fy_used) > 1e-6, 'Se does not follow the governing region');
    assert(lr.assumptions.some((a) => /랩 단면 Se = .* lap-1/.test(a)), 'the result says where Se came from');
    notes.push(`II-2A support 3: lap local ${loc.ratio.toFixed(4)} = lap-1 F3 ${f3.ratio.toFixed(4)} (governing ${gov.id})`);

    // ── 2. 지점 · 진술이 없으면 짓지 않는다 ───────────────────────────────
    s = await p.handleMcpAction({ action: 'set_case_inputs', inputs: { connLapSupport: null } });
    lr = JSON.parse(JSON.stringify(await p.handleMcpAction({ action: 'run_case_check', what: 'lap' })));
    assert(lr.section_source && lr.section_source.Se === null && /not set/.test(lr.section_source.reason), JSON.stringify(lr.section_source));
    assert.strictEqual(check(lr, 'lap.flexure.local')?.verdict ?? 'not_evaluated', 'not_evaluated', 'lap flexure not evaluated without Se');
    s = await p.handleMcpAction({ action: 'set_case_inputs', inputs: { connLapSupport: 3, lapRestrained: false } });
    lr = JSON.parse(JSON.stringify(await p.handleMcpAction({ action: 'run_case_check', what: 'lap' })));
    // 진술을 바꾸면 부재 설계 결과가 지워진다(무효화 — design) — 그때도 Se 는 짓지 않는다(진술 없음의 까닭은 순수 함수 시험이 본다)
    assert(lr.section_source.Se === null && /not stated|no purlin/.test(lr.section_source.reason), JSON.stringify(lr.section_source));
    notes.push('no support / no statement: Se not derived, flexure not evaluated');

    // ── 3. 비탄성 여유(V8-S2) ─────────────────────────────────────────
    const pr2 = JSON.parse(JSON.stringify(await p.handleMcpAction({ action: 'design_purlin', ...II2A, use_inelastic_reserve: true })));
    assert(!pr2.error, pr2.error);
    await p.handleMcpAction({ action: 'set_case_inputs', inputs: { ...lapInputs(pr2), lapRestrained: true } });
    lr = JSON.parse(JSON.stringify(await p.handleMcpAction({ action: 'run_case_check', what: 'lap' })));
    const l1 = pr2.regions.find((g) => g.id === 'lap-1');
    const g2 = pr2.regions.find((g) => g.id === pr2.governing.id);
    // 엔진 e38af69: 블록은 여유 · 냉간가공과 무관하게 같은 기준 — 구간의 Mnℓ 은 여유로 올라가도 랩의 Se · 국부 비는 여유 없는 것 그대로
    assert(l1.result.Mne > l1.result.My, 'the reserve is applied in the lap region of this run');
    assert(lapMnl2(l1.result) > ls1.Mnl.value * (1 + 1e-9), `the region's Mnl rose with the reserve (${lapMnl2(l1.result)} > ${ls1.Mnl.value})`);
    assert(Math.abs(l1.result.lap_section.Se.value - ls1.Se.value) <= 1e-12 * ls1.Se.value, 'the block does not move with the reserve');
    assert(lr.section_source.Se === l1.result.lap_section.Se.value, `inelastic reserve on: Se from the block (${JSON.stringify(lr.section_source)})`);
    const loc2 = check(lr, 'lap.flexure.local');
    assert(loc2 && Math.abs(loc2.ratio - loc.ratio) <= 1e-9 * loc.ratio, `the lap local ratio is the one without reserve (${loc2 && loc2.ratio} vs ${loc.ratio})`);
    assert(Math.abs(lr.section_source.Se - g2.result.Mnl / g2.result.Fy_used) > 1e-6 || g2.id === 'lap-1', 'Se does not follow the governing region');
    notes.push(`inelastic reserve: lap-1 Mnl ${lapMnl2(l1.result).toFixed(2)} (with reserve) — lap Se ${lr.section_source.Se.toFixed(4)} from the block, lap local ${loc2.ratio.toFixed(4)} unchanged`);

    // ── AI 가 Se 를 직접 주면 그 값과 「부른 쪽이 준 값」 ──────────────────────
    const direct = await p.handleMcpAction({ action: 'lap_connection', d: 8, t: 0.059, Fy: 55, Fu: 70, lap_left_in: 30, lap_right_in: 42, Mu_support: 105,
      Vu_support: 1.78, fastener_type: 'bolt', fastener_dia: 0.5, n_rows: 2, design_method: 'ASD', Se: 1.8, lap_restrained: true });
    assert(direct.section_source && direct.section_source.Se === 1.8 && /given by the caller/.test(direct.section_source.from), JSON.stringify(direct.section_source));
    notes.push('AI-given Se: used and labelled');
    console.log(`lap_section_contract: PASS (${notes.join('; ')})`);
  } finally {
    ctx.close();
  }
}

main().catch((e) => { console.error('lap_section_contract: FAIL', e); process.exitCode = 1; });
