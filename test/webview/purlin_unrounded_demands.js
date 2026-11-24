/* global process */
// 엔진 e42adf1(계약 §6.1) — 퍼린 길이 엔진에 보내는 소요 · 길이 · 계수는 하중 해석의 반올림 전 값(기록마다의 unrounded, 같은 키 이름).
// 진짜 StcfsdPanel + 진짜 파이썬. 패널의 엔진 호출(aisi_design)을 가로채 보낸 값을 모으고, 하중 해석의 모든 기록에서
// (반올림 값, 반올림 전 값) 짝을 모은다. 보낸 값(Mu · Vu · Lb · Cb · dist_Lm · wc_P · wc_M · 위치 x)이 어느 기록의 반올림 값과 같고
// 그 기록의 반올림 전 값과는 다르면(그리고 반올림 전 값 가운데 같은 것이 없으면) — 반올림 값을 보낸 것 — 실패.
// 또 반올림 전 값이 없으면 반올림 값을 쓰고 그것을 밝히는지(_un 과 결과의 rounded_demand_fallbacks)를 본다.
'use strict';
const assert = require('assert');
const harness = require('./panel_harness.js');

const DECK = { type: 'through-fastened', t_panel: 0.018, fastener_spacing: 12 };
const CASES = {
  pattern: { member_app: 'roof-purlin', span_type: 'cont-4', span_ft: 25, loads: { D: 15, Lr: 100, W: -170 }, lr_reduced: true,
    laps: { left_ft: 1.0, right_ft: 2.5 }, deck: DECK, i621_conditions_confirmed: true, design_method: 'ASD', Fy: 55, Fu: 70,
    wc_N: 3.5, wc_R: 0.1875, wc_fastened: 'fastened' },
  overhang: { member_app: 'roof-purlin', span_type: 'cont-4', span_ft: 25, spans_ft: [1, 25, 25, 1], supports: ['N', 'P', 'P', 'P', 'N'],
    loads: { D: 15, Lr: 100, W: -170 }, deck: DECK, design_method: 'ASD', Fy: 55, Fu: 70, wc_N: 3.5, wc_R: 0.1875 },
  ii2a: { member_app: 'roof-purlin', span_type: 'cont-6', span_ft: 25, spans_ft: [1, 25, 25, 25, 25, 1], supports: ['N', 'P', 'P', 'P', 'P', 'P', 'N'],
    laps_per_support: [{ left_ft: 0, right_ft: 0 }, { left_ft: 0, right_ft: 0 }, { left_ft: 2.5, right_ft: 3.5 }, { left_ft: 1, right_ft: 1 }, { left_ft: 3.5, right_ft: 2.5 }, { left_ft: 0, right_ft: 0 }, { left_ft: 0, right_ft: 0 }],
    spacing_ft: 5, loads: { D: 15, Lr: 100, S: 0, W: -170, Wp: 0, L: 0 }, design_method: 'ASD', laps: { left_ft: 3.5, right_ft: 3.5 },
    deck: { type: 'through-fastened', kphi_override: 0.3 }, pattern_loading: false, lr_reduced: false, i621_conditions_confirmed: true,
    I_span_in4: [9.18, 9.18, 7.76, 7.76, 9.18, 9.18], Fy: 55, Fu: 70, lap_restrained: true },
};

/** 하중 해석의 모든 unrounded 짝: 키 → [{r, u}] (값이 다른 것만 · 같은 것은 exact 에) */
function pairs(la) {
  const diff = new Map(), exact = new Map();
  const add = (m, k, v) => { if (!m.has(k)) { m.set(k, []); } m.get(k).push(v); };
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') { return; }
    if (o.unrounded && typeof o.unrounded === 'object') {
      for (const [k, u] of Object.entries(o.unrounded)) {
        const r = o[k];
        if (typeof u !== 'number' || typeof r !== 'number') { continue; }
        if (Math.abs(u - r) > 1e-12 * Math.max(1, Math.abs(u))) { add(diff, k, { r, u }); } else { add(exact, k, u); }
      }
    }
    for (const v of Object.values(o)) { walk(v); }
  };
  walk(la);
  return { diff, exact };
}

// 보낸 인자 → 하중 해석의 키와 배율(kip-ft → kip-in ×12, 랩은 부재마다 절반)
const SENT = [
  ['Mu', ['M_max_abs', 'Mu'], [12, 6]], ['wc_M', ['Mu'], [12]], ['Vu', ['Vu_left', 'Vu_right', 'Vu'], [1, 0.5]],
  ['Lb', ['Ly_in'], [1]], ['dist_Lm', ['Ly_in'], [1]], ['Cb', ['Cb'], [1]], ['wc_P', ['Pu'], [1]],
];
const same = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));

(async () => {
  const h = await harness.createPanel();
  if (!h) { console.log('purlin_unrounded_demands: SKIPPED (no .venv python)'); return; }
  const lines = [];
  try {
    const P = h.panel.constructor;
    // ── 반올림 전 값이 없을 때: 반올림 값, 그리고 그 사실을 적는다 ──────────────────────────
    const fb = new Set();
    assert.strictEqual(P._un({ Mu: 1.234, unrounded: { Mu: 1.23449 } }, 'Mu', fb, 'locations'), 1.23449, 'unrounded first');
    assert.strictEqual(fb.size, 0);
    assert.strictEqual(P._un({ Mu: 1.234 }, 'Mu', fb, 'locations'), 1.234, 'rounded when unrounded is absent');
    assert.deepStrictEqual([...fb], ['locations.Mu'], 'the fallback is named');

    const tpl = await h.panel.handleMcpAction({ action: 'generate_template', section_type: 'lippedz', params: { H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 } });
    assert(!tpl.error, tpl.error);
    await h.panel.handleMcpAction({ action: 'set_lengths', min: 1, max: 1000, n: 30 });
    const bridge = h.panel._pythonBridge;
    const orig = bridge.call.bind(bridge);
    let sent = [];
    bridge.call = (method, params) => { if (method === 'aisi_design') { sent.push(JSON.parse(JSON.stringify(params))); } return orig(method, params); };
    for (const [name, args] of Object.entries(CASES)) {
      sent = [];
      const r = JSON.parse(JSON.stringify(await h.panel.handleMcpAction({ action: 'design_purlin', ...JSON.parse(JSON.stringify(args)) })));
      assert(!r.error, `${name}: ${r.error}`);
      assert(!r.rounded_demand_fallbacks, `${name}: the load analysis gave every unrounded value (${r.rounded_demand_fallbacks})`);
      const { diff, exact } = pairs(r.load_analysis);
      let checked = 0, fromUnrounded = 0;
      const bad = [];
      for (const p of sent) {
        const vals = SENT.map(([arg, keys, mults]) => [arg, p[arg], keys, mults]);
        if (p.check_location && p.check_location.x) { vals.push(['x', p.check_location.x.value, ['x_ft', 'x_M_max_ft', 'start_ft', 'end_ft'], [12]]); }
        for (const [arg, v, keys, mults] of vals) {
          if (typeof v !== 'number') { continue; }
          checked++;
          const asUnrounded = keys.some((k) => mults.some((m) => [...(diff.get(k) || []).map((x) => x.u), ...(exact.get(k) || [])].some((u) => same(u * m, v))));
          if (asUnrounded) { fromUnrounded++; continue; }
          const rounded = keys.flatMap((k) => mults.flatMap((m) => (diff.get(k) || []).filter((x) => same(x.r * m, v)).map((x) => `${k} ${x.r} (unrounded ${x.u}) ×${m}`)));
          if (rounded.length) { bad.push(`${p.check_location?.region}/${p.check_location?.check_point} ${arg} = ${v} = rounded ${rounded[0]}`); }
        }
      }
      assert.deepStrictEqual(bad, [], `${name}: a demand sent to the engine is a rounded load-analysis value:\n  ${bad.slice(0, 8).join('\n  ')}`);
      assert(fromUnrounded > 0 && [...diff.keys()].length > 0, `${name}: some sent values come from unrounded values that differ from the rounded ones`);
      lines.push(`${name} ${sent.length} calls, ${checked} values, ${fromUnrounded} = an unrounded load-analysis value, ${[...diff.values()].reduce((a, x) => a + x.length, 0)} rounded ≠ unrounded pairs`);
    }
    bridge.call = orig;
  } finally { h.close(); }
  console.log(`purlin_unrounded_demands: PASS (${lines.join('; ')})`);
})().catch((e) => { console.error('purlin_unrounded_demands: FAIL', e && e.message ? e.message : e); process.exitCode = 1; });
