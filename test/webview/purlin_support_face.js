/* global process */
// V6b-01 — 퍼린의 지점 위 검토 지점이 지점 한쪽 면의 전단만 쓰던 결함. 하중 해석 격자는 지점에서 값 하나(한쪽 면)를 갖는다.
// 검토 지점의 V 는 그 지점 위치 항목의 면 전단(Vu_left · Vu_right)이어야 한다: 지점이 구간 안이면 큰 면, 구간이 그 지점에서
// 끝나면 그 구간 쪽 면. 이 시험은 하중 해석 결과에서 그 면을 따로 골라 모든 지점 위 검토 지점과 견주고(독립),
// 검증자의 `flip` 사례(4경간 25 ft, 랩 0.5 ft, ASD)가 랩 구간 H2 1.010 으로 불합격인지 본다(고치기 전: 0.995 합격).
'use strict';
const assert = require('assert');
const harness = require('./panel_harness.js');

const DECK = { type: 'through-fastened', t_panel: 0.018, fastener_spacing: 12 };
const CASES = {
  flip: { member_app: 'roof-purlin', span_type: 'cont-4', span_ft: 25, loads: { D: 15, Lr: 102.2, W: -170 },
    laps: { left_ft: 0.5, right_ft: 0.5 }, deck: DECK, design_method: 'ASD', Fy: 55, Fu: 70 },
  pattern: { member_app: 'roof-purlin', span_type: 'cont-4', span_ft: 25, loads: { D: 15, Lr: 100, W: -170 }, lr_reduced: true,
    laps: { left_ft: 1.0, right_ft: 2.5 }, deck: DECK, i621_conditions_confirmed: true, design_method: 'ASD', Fy: 55, Fu: 70,
    wc_N: 3.5, wc_R: 0.1875, wc_fastened: 'fastened' },
  overhang: { member_app: 'roof-purlin', span_type: 'cont-4', span_ft: 25, spans_ft: [1, 25, 25, 1], supports: ['N', 'P', 'P', 'P', 'N'],
    loads: { D: 15, Lr: 100, W: -170 }, deck: DECK, design_method: 'ASD', Fy: 55, Fu: 70 },
};
// 하중 해석은 면 전단을 소수 3자리(kips)로 싣는다 — 격자 값과는 그 반올림만큼 다를 수 있다(면이 같으면). 면이 다르면 훨씬 크다
const near = (a, b) => Math.abs(a - b) <= 6e-4;

function checkFaces(name, r) {
  const la = r.load_analysis;
  const sup = la.spans_ft.reduce((a, L) => [...a, a[a.length - 1] + L], [0]);
  const t = { points: 0, own: 0 };
  for (const g of r.regions) {
    const env = /uplift/.test(g.kind) || /uplift/.test(g.id) ? la.uplift : la.gravity;
    const share = g.members === 2 ? 0.5 : 1;
    for (const c of g.result.checks) {
      if (!c.location || !c.location.x || c.Vu === null) { continue; }
      const x = c.location.x.value / 12;
      const k = sup.findIndex((s) => Math.abs(s - x) <= 1e-6 * Math.max(1, x));
      if (k < 0) { continue; }
      const L = env.locations.find((l) => l.support === k + 1 && Number.isFinite(l.Vu_left));
      assert(L, `${name} ${g.id} ${c.check_point}: support ${k + 1} has a location entry`);
      const vl = Math.abs(L.Vu_left), vr = Math.abs(L.Vu_right);
      const side = x <= g.start_ft + 1e-6 ? 'right' : (x >= g.end_ft - 1e-6 ? 'left' : (vl >= vr ? 'left' : 'right'));
      const want = (side === 'left' ? vl : vr) * share;
      assert(near(c.Vu, want), `${name} ${g.id} [${g.start_ft}–${g.end_ft}] ${c.check_point} at support ${k + 1}: Vu ${c.Vu} — the ${side} face of the load analysis is ${want}`);
      t.points++;
      if (want + 1e-12 < Math.max(vl, vr) * share) { t.own++; }
    }
  }
  return t;
}

(async () => {
  const h = await harness.createPanel();
  if (!h) { console.log('purlin_support_face: SKIPPED (no .venv python)'); return; }
  const lines = [];
  try {
    const tpl = await h.panel.handleMcpAction({ action: 'generate_template', section_type: 'lippedz', params: { H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 } });
    assert(!tpl.error, tpl.error);
    await h.panel.handleMcpAction({ action: 'set_lengths', min: 1, max: 1000, n: 30 });
    for (const [name, args] of Object.entries(CASES)) {
      const r = JSON.parse(JSON.stringify(await h.panel.handleMcpAction({ action: 'design_purlin', ...JSON.parse(JSON.stringify(args)) })));
      assert(!r.error, `${name}: ${r.error}`);
      const t = checkFaces(name, r);
      assert(t.points > 0, `${name}: some check point sits on a support`);
      lines.push(`${name} ${t.points} support check points = load-analysis face (${t.own} on the region's own, smaller face)`);
      if (name === 'flip') {
        // 지점 2 의 왼쪽 랩 구간: 그 면의 전단으로 H2 1.010 — 불합격(고치기 전 0.995 합격)
        const g = r.regions.find((x) => x.kind === 'lap' && Math.abs(x.end_ft - 25) < 1e-6);
        const pt = g.result.checks.find((c) => c.check_point === 'M_max');
        const h2 = pt.design_checks.find((c) => c.id === 'member.bending_shear');
        assert(h2.ratio > 1.0 && h2.verdict === 'fail' && pt.pass === false, `flip lap left of support 2: H2 ${h2.ratio} ${h2.verdict}`);
        lines.push(`flip lap ${g.start_ft}–${g.end_ft} ft: H2 ${h2.ratio.toFixed(4)} fail`);
      }
    }
  } finally { h.close(); }
  console.log(`purlin_support_face: PASS (${lines.join('; ')})`);
})().catch((e) => { console.error('purlin_support_face: FAIL', e && e.message ? e.message : e); process.exitCode = 1; });
