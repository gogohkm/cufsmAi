/* global process */
// K3-6 — 검증 · 보고서 결함(docs/implementation/20261124-k3-design.md 부록 A)마다 하나씩: 고치기 전에는 실패하고 고친 뒤에는 통과한다.
//   node test/webview/k3_review_defects.js [review.js 의 경로]   (경로를 주면 그 판으로 — 고치기 전 판에서 실패하는지 볼 때)
// 화면 · 엔진 없이: 모듈(review.js)에 호스트와 같은 가짜 문서(src/case/reviewInput.ts)와 합성한 결과를 준다.
'use strict';
const assert = require('assert');
const path = require('path');
const { loadTs, makeFakeVscode } = require('./panel_harness');

const REVIEW = require(path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'webview', 'js', 'review.js')));
const RI = loadTs('src/case/reviewInput.ts', makeFakeVscode());
const CS = loadTs('src/case/caseState.ts', makeFakeVscode());

const MODEL = { node: [[1, 0, 0]], elem: [], prop: [[100, 29500, 29500, 0.3, 0.3, 11300]], loadFy: 50, lengths: [1, 10, 100, 1000] };
function env(opts = {}) {
  const st = CS.createCaseState();
  Object.assign(st.inputs, opts.inputs || {});
  const drafts = { templateType: 'lippedc', tplH: 8, tplB: 2.5, tplD: 0.625, tplT: 0.059, tplR: 0.1, ...(opts.drafts || {}) };
  const inputs = CS.toDesignInputs13(st, drafts);
  if (opts.spans) { st.spans = opts.spans; }
  const us = opts.unitSystem || 'US';
  return { doc: RI.buildReviewDoc({ inputs, spans: st.spans, unitSystem: us, options: {} }), unitSystem: us,
    model: opts.model === undefined ? MODEL : opts.model, analysisResult: opts.analysis === undefined ? { curve: [[1, 1], [2, 2]] } : opts.analysis,
    lastDsmResult: opts.dsm || null, lastProps: null, design: opts.design || null, load: opts.load || null, lap: opts.lap || null,
    analysisCurrent: opts.analysisCurrent };
}
const run = (e) => REVIEW.make(e).runAllValidationChecks();
const item = (checks, name) => checks.find((c) => c.item === name || c.item.startsWith(name));
const results = [];
function t(name, fn) {
  try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); }
}
const flex = (checks, extra = {}) => ({ member_type: 'flexure', design_method: 'LRFD', Mne: 80, My: 82, Mnl: 70, Mnd: 65, Mn: 65, Fy_used: 50, Fy_original: 50,
  design_checks: checks, ...extra });

t('D1 — no demand: the engine says flexure not evaluated, the item must not say pass', () => {
  const ne = (id) => ({ id, verdict: 'not_evaluated', reason: 'no demand', name_ko: id });
  const c = run(env({ design: flex([ne('member.flexure.global'), ne('member.flexure.local'), ne('member.flexure.distortional')]) }));
  for (const n of ['Mne vs My', 'Mnl vs Mne', 'Mnd vs My']) { assert.strictEqual(item(c, n).status, 'warn', n); assert(/판정 없음/.test(item(c, n).note), n + ' note'); }
});
t('D1 — a buckling reduction the engine passed is not a caution', () => {
  const ok = (id) => ({ id, verdict: 'pass', name_ko: id });
  const c = run(env({ design: flex([ok('member.flexure.global'), ok('member.flexure.local'), ok('member.flexure.distortional')]) }));
  assert.strictEqual(item(c, 'Mnl vs Mne').status, 'pass');
  assert.strictEqual(item(c, 'Mnd vs My').status, 'pass');
});
t('D16 — the "all Mn equal" item (λℓ from My) is gone', () => {
  const c = run(env({ design: flex([], { Mne: 82, Mnl: 82, Mnd: 82, My: 82 }) }));
  assert(!item(c, '모든 Mn 동일'), 'removed');
});
t('D4 — lap fastener shear passed by the engine is not "not checked"', () => {
  const lap = { utilization: 0.5, pass: false, V_transfer: 1, capacity: 2, design_checks: [{ id: 'lap.fastener_group', verdict: 'pass', name_ko: 'x' }] };
  const la = { laps_per_support: [{ left_ft: 0, right_ft: 0 }, { left_ft: 3, right_ft: 3 }, { left_ft: 0, right_ft: 0 }], governing: { locations: [] } };
  const c = run(env({ design: flex([]), lap, load: la }));
  assert.strictEqual(item(c, 'Lap 패스너 전단').status, 'pass');
});
t('D6 — Fy consistency compares the analysis reference stress with the design Fy', () => {
  const c = run(env({ inputs: { fy: 42.79 } }));   // 모델 loadFy 50 (AI 가 정한 기준응력)
  assert.strictEqual(item(c, 'Fy 일관성').status, 'warn');
});
t('D6 — analysis currency comes from the host (a stale analysis fails)', () => {
  const c = run(env({ analysisCurrent: false }));
  assert.strictEqual(item(c, '해석 최신성').status, 'fail');
});
t('D6 — items that could not fail are removed (wind, φ constants, braced positive region)', () => {
  const c = run(env({ design: flex([]), load: { governing: { locations: [] }, auto_params: { positive_region: { braced: true } } } }));
  for (const n of ['풍하중 (W, 양력)', '저항계수 (φ)', '정모멘트 구간 구속']) { assert(!item(c, n), n); }
});
t('D19 — the half-wavelength verdict does not depend on the display units', () => {
  const a = item(run(env({ unitSystem: 'US' })), '반파장 최댓값').status;
  const b = item(run(env({ unitSystem: 'SI' })), '반파장 최댓값').status;
  assert.strictEqual(a, b, `US ${a} SI ${b}`);
});
t('D5 — an unbounded Fcre is shown as ∞, not 1000000', () => {
  const d = flex([{ id: 'member.flexure.positive_region', verdict: 'pass', name_ko: 'x' }], { positive_region: { Lb: 10, Cb: 1, Fcre: 1e6, Fcre_unbounded: true, Mn: 70, phi_Mn: 60, utilization: 0.5 }, utilization: 0.5 });
  const v = item(run(env({ design: d })), 'Lb(+) / Cb(+)').value;
  assert(/∞/.test(v) && !/1000000/.test(v), v);
});
t('D7 — span limit is §I6.2.1(h) 33 ft (spec and engine), not 40 ft', () => {
  const c = run(env({ spans: { spans: [35], supports: ['P', 'P'], lapsPerSupport: [null, null] }, inputs: { spanType: 'simple', nSpans: 1 } }));
  assert.strictEqual(item(c, '스팬 길이').status, 'warn');
});
t('D2 — cold work not applicable is a caution (with the engine reason), not a failure', () => {
  const d = flex([], { use_cold_work: true, cold_work: { applicable: false }, warnings: ['§A3.3.2: buckling reduces the strength — no cold-work increase'] });
  const i = item(run(env({ design: d })), '§A3.3.2 Cold Work');
  assert.strictEqual(i.status, 'warn');
  assert(/buckling reduces/.test(i.note), i.note);
});
t('D3 — a purlin design ran its own signature curves: analysis / DSM items do not fail', () => {
  const c = run(env({ analysis: null, design: flex([], { purlin_mode: true }) }));
  assert.strictEqual(item(c, '해석 실행 여부').status, 'pass');
  assert.strictEqual(item(c, 'DSM 값 추출').status, 'pass');
});
t('D12 — engine text is escaped in the dashboard', () => {
  const d = flex([], { warnings: ['<img src=x onerror=alert(1)>'] });
  const html = REVIEW.make(env({ design: d })).renderValidationDashboard(run(env({ design: d })));
  assert(!/<img/.test(html) && /&lt;img/.test(html));
});
t('D13 — the total-load limit is checked; the live-load limit applies to live load alone', () => {
  const la = { governing: { locations: [] }, deflection: { valid: true, per_span: [{ span: 1, L_over_delta: 200, abs_delta_in: 1 }] },
    deflection_cases: [{ case: 'Lr', per_span: [{ span: 1, L_over_delta: 300, abs_delta_in: 0.8 }] }] };
  const i = item(run(env({ load: la, inputs: { memberType: 'roof-purlin' } })), '처짐 — 스팬 1');
  assert.strictEqual(i.status, 'pass', JSON.stringify(i));
  const la2 = { ...la, deflection: { valid: true, per_span: [{ span: 1, L_over_delta: 170, abs_delta_in: 1 }] } };
  assert.strictEqual(item(run(env({ load: la2, inputs: { memberType: 'roof-purlin' } })), '처짐 — 스팬 1').status, 'fail', 'TL L/170 < L/180 fails');
});
t('D14 — the half-wavelength minimum states one rule (0.8 × depth)', () => {
  const i = item(run(env({})), '반파장 최솟값');
  assert(/0\.8/.test(i.criterion) && !/최대 판폭/.test(i.criterion), i.criterion);
});
t('D17 / B4 — Fy < 95 ksi is strict (spec and engine)', () => {
  assert.strictEqual(item(run(env({ inputs: { fy: 95 } })), '항복강도 (Fy)').status, 'fail');
});
t('D10 — validation values in SI carry SI stress units (cold work Fya)', () => {
  const d = flex([], { use_cold_work: true, cold_work: { applicable: true, increase_pct: 4 }, Fy_used: 52, Fy_original: 50 });
  const i = item(run(env({ design: d, unitSystem: 'SI' })), '§A3.3.2 Cold Work');
  assert(/MPa/.test(i.value) && !/ksi/.test(i.value), i.value);
});
t('D15 — a purlin negative region shows the Ly / Cb that region used, not the field', () => {
  const neg = { region: { id: 'neg_2', label: '지점 2 부모멘트', Ly_in: 37.5, Cb: 1.75 } };
  const d = flex([], { purlin_mode: true, utilization: 0.5, positive_region: { Lb: 0, Cb: 1, Fcre: 1e6, Fcre_unbounded: true, Mn: 70, phi_Mn: 60 },
    design_negative: neg });
  const i = item(run(env({ design: d, inputs: { designLb: 120, designCb: 1.0 } })), 'Lb(-) / Cb(-)');
  assert(/37\.5/.test(i.value) && /1\.75/.test(i.value) && /지점 2/.test(i.value), i.value);
});
// ── 보고서(K3-7 의 ReportDoc + 그리기 — 옛 판에는 buildReportDoc 이 없어 아래는 실패한다) ─────────────────────
const RENDER = (() => { try { return require(path.join(path.dirname(require.resolve(path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'webview', 'js', 'review.js')))), 'reportRender.js')); } catch { return null; } })();
const SIU = loadTs('src/mcp/siUnits.ts', makeFakeVscode());
const reportOf = (e) => {
  const R = REVIEW.make(e);
  assert(typeof R.buildReportDoc === 'function', 'the report is built as data (buildReportDoc)');
  const doc = R.buildReportDoc();
  const shown = e.unitSystem === 'SI' ? SIU.reportDocToSI(doc) : { value: doc, unconverted: [] };
  assert.deepStrictEqual(shown.unconverted, [], 'every number of the report doc has a quantity');
  return { doc, html: RENDER.renderReportDoc(shown.value) };
};
const rowText = (html, label) => { const m = new RegExp('<td>' + label + '[^<]*</td><td[^>]*>([^<]*)</td>').exec(html); return m ? m[1] : null; };
const MODEL29 = { ...MODEL, prop: [[100, 29000, 29000, 0.25, 0.25, 11600]] };
t('D8 — the report prints E and ν of the model, not 29500 / 0.30', () => {
  const { html } = reportOf(env({ model: MODEL29, design: flex([]) }));
  assert(/29000 ksi/.test(rowText(html, '탄성계수 E') || ''), rowText(html, '탄성계수 E'));
  assert.strictEqual(rowText(html, '포아송비 ν'), '0.250');
});
t('D11 — report values come from the state (no 12-digit field text, no invented defaults; deck rows only for load members)', () => {
  const { html } = reportOf(env({ design: flex([]), inputs: { memberType: 'roof-purlin', deckType: 'through-fastened', deckTPanel: null } }));
  assert(/^\d+\.\d{2} ft$/.test(rowText(html, '분담폭') || ''), 'spacing ' + rowText(html, '분담폭'));
  assert.strictEqual(rowText(html, '패널 두께'), '—', 'a blank panel thickness stays blank');
  const col = reportOf(env({ design: { ...flex([]), member_type: 'compression' }, inputs: { memberType: 'compression' } })).html;
  assert(!/분담폭|데크 정보/.test(col), 'a column report has no spacing / deck rows');
});
t('D10 — the SI report has no US units (values through siUnits; US-written equations say so)', () => {
  const chk = { id: 'member.flexure.global', name_ko: '전체좌굴', verdict: 'pass', clause: 'F2',
    demand: { symbol: 'Mu', value: 50, quantity: 'moment' }, capacity: { symbol: 'φMne', value: 80, quantity: 'moment' }, ratio: 0.625,
    steps: [{ kind: 'equation', expr: 'Mne = Sf Fn', inputs: [{ symbol: 'Fn', value: 50, quantity: 'stress' }], result: { symbol: 'Mne', value: 80, quantity: 'moment' } },
      { kind: 'equation', expr: 'Pnb = n (4.64 α t + 1.53) d t Fu', expr_units: 'US', units_note: 'α = 1 for t in in.', inputs: [], result: null }] };
  const { html } = reportOf(env({ unitSystem: 'SI', design: flex([chk], { warnings: [] }) }));
  const text = html.replace(/<[^>]*>/g, ' ');
  assert(!/\bksi\b|\bkip-in\b|\bkips\b|\bkip-ft\b|\bpsf\b|\bplf\b/.test(text), 'US unit in the SI report: ' + (text.match(/.{30}\b(?:ksi|kip-in|kips|kip-ft|psf|plf)\b.{10}/) || [''])[0]);
  assert(/US 단위로 쓴 식/.test(html), 'a US-written equation is marked');
});
t('D5 — an unbounded value in the report is ∞, not 1000000', () => {
  const chk = { id: 'member.flexure.positive_region', name_ko: '정모멘트', verdict: 'pass',
    steps: [{ kind: 'elastic_buckling', expr: 'Fcre = …', inputs: [], result: { symbol: 'Fcre', value: null, unbounded: true, quantity: 'stress' } }] };
  const html = reportOf(env({ design: flex([chk]) })).html;
  assert(/Fcre = ∞/.test(html) && !/1000000/.test(html), 'unbounded');
});
t('threshold table cites a source for every row', () => {
  assert(REVIEW.THRESHOLDS && Object.values(REVIEW.THRESHOLDS).every((x) => typeof x.source === 'string' && x.source.length > 3));
});

const bad = results.filter((r) => r[0] !== 'ok');
for (const r of results) { console.log(`  ${r[0]}  ${r[1]}${r[2] ? ' — ' + r[2] : ''}`); }
console.log(`k3_review_defects: ${bad.length ? 'FAIL' : 'PASS'} (${results.length - bad.length}/${results.length})`);
if (bad.length) { process.exitCode = 1; }
