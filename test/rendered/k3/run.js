/* global process, console, Buffer */
// K3 0단계 — 「검증 · 보고서를 호스트로」 구현 전에 지금 동작을 고정하는 렌더 시험(opt-in).
//   npm run test:k3            (Edge 또는 Chrome, .venv 파이썬이 있어야 한다 — 없으면 SKIP 한 줄)
//   node test/rendered/k3/run.js --record           고정값을 전부 지금 값으로 다시 쓴다
//   node test/rendered/k3/run.js --accept=id1,id2   그 항목만 지금 값으로
//   node test/rendered/k3/run.js --only=empty,column,beam,purlin,connection
// 흐름마다(K2 에서 고정한 기둥 · 보 · 퍼린(랩 · 데크 · 양력) · 접합 + 불합격 · 판정 없음 · 빈 화면): 검증 70항목(분류 · 항목 · 판정 ·
// 값 · 기준 · 주석), 상세 보고서(글 · 제목 · HTML 해시), 「PDF 저장」 의 PDF(쪽 수 · 글), 좌굴 보고서 — SI 와 US 화면, 화면 단추와 MCP.
// 진짜 호스트 · 파이썬 · 웹뷰(헤드리스 Edge, 보이지 않음). PDF 는 호스트의 길(시스템 Edge headless, windowsHide) 그대로.
// 고정값: test/rendered/k3/golden/*.json · 임시 파일: test/rendered/out/k3/ (git 밖).
'use strict';
const fs = require('fs');
const path = require('path');
const { findBrowser } = require('../lib');
const { pythonPath } = require('../../webview/panel_harness');
const L = require('./k3lib');
const K = L.K;

const ARGV = process.argv.slice(2);
const ONLY = new Set((ARGV.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean));
const want = (g) => ONLY.size === 0 || ONLY.has(g);

const results = [];
const goldens = [];
const exceptions = [];
const observed = [];   // 모든 흐름에서 본 검증 항목 — inventory.js 가 정적 목록과 맞댄다

async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); } catch (e) {
    results.push({ name, ok: false, error: String(e && e.stack || e) });
    console.log(`  FAIL ${name}: ${e && e.message || e}`);
  }
}

async function withSession(name, fn) {
  const ctx = await L.session(name);
  let m = null;
  try {
    await fn(ctx, async () => { if (!m) { ctx.outDir = ctx.k3Dir; m = await K.mcp(ctx); } return m; });
  } finally {
    if (m) { await m.close(); }
    exceptions.push(...ctx.log.exceptions.map((x) => ({ session: name, ...x })));
    await ctx.close();
  }
}
function golden(name) { const g = new L.Golden(name); goldens.push(g); return g; }

const unit = async (ctx, u) => { await ctx.click(u === 'US' ? '#btn-unit-US' : '#btn-unit-SI'); await ctx.settle(300); };

/** 검증 · 보고서(· PDF) 한 벌을 지금 단위로 고정한다. */
async function pinValidationAndReport(ctx, g, id, opts = {}) {
  const v = await L.runValidation(ctx);
  observed.push(...v.items.map((i) => ({ flow: `${g.name}.${id}`, category: i.category, item: i.item, status: i.status })));
  g.check(`${id}.validation`, v.items, { expect: opts.vExpect || 'pin', reason: opts.vReason });
  g.check(`${id}.validation.counts`, { ...v.counts, badge: v.badge, tree: v.tree }, { expect: 'pin' });
  const r = await L.runReport(ctx);
  g.check(`${id}.report.text`, r.text, { expect: opts.rExpect || 'pin', reason: opts.rReason });
  g.check(`${id}.report.shape`, { heads: r.heads, svgs: r.svgs, tables: r.tables, htmlSha: r.htmlSha, htmlLength: r.htmlLength, printShown: r.printShown },
    { expect: opts.rExpect || 'pin', reason: opts.rReason });
  if (opts.pdf && r.printShown) {
    const p = await L.reportPdf(ctx, `${g.name}-${id}`);
    g.check(`${id}.pdf`, p, { expect: 'pin' });
  }
  findings(g, id, v, r, opts.si);
  return { v, r };
}

/**
 * 고정하며 찾은 결함을 따로 적는다(값이 바뀌면 — 고쳤으면 — 이 항목이 뒤집힌다). 결함 번호는 docs/implementation/20261124-k3-design.md 부록.
 */
function findings(g, id, v, r, si) {
  const it = (re) => v.items.filter((i) => re.test(i.item)).map((i) => `${i.status}: ${i.item} = ${i.value}`);
  const lines = (re) => r.text.split('\n').filter((l) => re.test(l));
  const f = {};
  const cw = it(/^§A3\.3\.2 Cold Work/);
  if (cw.length) { f.coldWork = cw; }
  // 설계 결과가 있는데(퍼린 묶음은 제 서명곡선 해석을 돌렸다) 해석 · DSM 이 없다고 하는 것만 — 빈 화면 · 접합만이면 맞는 말이다
  const designed = v.items.some((i) => i.item === '설계 검토 실행 여부' && i.status === 'pass');
  const an = designed ? it(/^(해석 실행 여부|DSM 값 추출|Load Case 적합성)$/).filter((x) => !x.startsWith('pass')) : [];
  if (an.length) { f.analysisItems = an; }
  const unb = [...it(/Lb\(\+\) \/ Cb\(\+\)/).filter((x) => /1000000/.test(x)), ...lines(/1000000/)];
  if (unb.length) { f.unboundedAsNumber = unb; }
  const always = it(/^(Fy 일관성|해석 최신성|경계조건|풍하중|저항계수)/);
  if (always.length) { f.alwaysSame = always; }
  const lapF = it(/^Lap 패스너 전단/);
  if (lapF.length) { f.lapFastener = lapF; }
  const consts = lines(/^(탄성계수, E|포아송비, ν|분담폭 \(간격\)|패널 두께|체결구 간격)/);
  if (consts.length) { f.reportPageValues = consts; }
  if (si) {
    const us = lines(/\d\s*(ksi|kip-in|kips)\b/);
    if (us.length) { f.usUnitsInSiReport = us.length; f.usUnitsSample = us.slice(0, 4); }
  }
  if (Object.keys(f).length) {
    g.check(`${id}.findings`, f, { expect: 'defect', reason: 'K3 defects found while pinning (design doc appendix): cold work "fail" on an optional provision, analysis items that ignore the purlin chain\'s own analyses, 1e6 ksi printed for an unbounded Fcre, always-pass items, lap fastener shown "not checked" while the engine passes it, constants and raw field text in the report, US units in the SI report' });
  }
}

/** MCP validate_design · generate_report — 요약(기본) · SI · full 의 모양과 크기. */
async function pinMcpPackets(ctx, getMcp, g, id) {
  const c = await getMcp();
  const out = {};
  for (const [k, tool, args] of [
    ['validate.summary', 'validate_design', {}], ['validate.si', 'validate_design', { units: 'SI' }], ['validate.full', 'validate_design', { detail: 'full' }],
    // 보고서: 기본(HTML + PDF) 한 번, 나머지는 HTML 만(PDF 인쇄는 한 흐름에 한 번이면 된다)
    ['report.summary', 'generate_report', {}], ['report.si', 'generate_report', { units: 'SI', format: 'html' }], ['report.full', 'generate_report', { detail: 'full', format: 'html' }],
  ]) {
    const r = await c.call(tool, args);
    out[k] = L.mcpShape(r);
  }
  g.check(`${id}.mcp`, out, { expect: 'k3-change',
    reason: 'K3: validate_design returns checks: [] (raw session data, not the 70 items); generate_report returns a JSON packet, no HTML/PDF — acceptance criterion: the same 70 items without a webview and a report PDF' });
  return out;
}

/** 검증 항목 ↔ 엔진 design_checks 의 판정 — 화면이 「통과」 라고 하는데 엔진은 미평가인 것(결함 후보)을 적는다. */
const MAP = [
  [/^Mne vs My$/, 'member.flexure.global'], [/^Mnl vs Mne/, 'member.flexure.local'], [/^Mnd vs My/, 'member.flexure.distortional'],
  [/^Pnl vs Pne/, 'member.compression.local'], [/^Pnd vs Py/, 'member.compression.distortional'],
  [/^§I6\.2\.1 R-factor/, 'member.flexure.uplift_r'], [/^이용률 — 정모멘트/, 'member.flexure.positive_region'],
  [/^Lap 길이 \(지점/, 'lap:lap.length_condition'], [/^Lap 휨강도 DCR/, 'lap:lap.flexure.local'], [/^Lap 패스너 전단/, 'lap:lap.fastener_group'],
];
function crossCheck(ctx, items) {
  const d = ctx.panel._lastDesignResult;
  const lap = ctx.panel._lastLap && ctx.panel._lastLap.result;
  const ev = L.engineVerdicts(d);
  const lv = L.engineVerdicts(lap);
  const rows = [];
  for (const it of items) {
    const hit = MAP.find(([re]) => re.test(it.item));
    if (!hit) { continue; }
    const key = hit[1];
    // 퍼린이면 구간마다의 판정(같은 것은 한 번) — 화면의 항목은 화면이 고른 지배 구간 하나의 값이다
    const eng = key.startsWith('lap:') ? lv[key.slice(4)]
      : (ev[key] || [...new Set(Object.entries(ev).filter(([k]) => k.endsWith(':' + key)).map(([, x]) => x))].sort().join(','));
    rows.push({ item: it.item, page: it.status, engine: eng || '(none)' });
  }
  const overall = d ? (d.pass === true ? 'pass' : d.pass === false ? 'fail' : 'not_evaluated') : null;
  const passOnNotEvaluated = rows.filter((r) => r.page === 'pass' && /not_evaluated/.test(r.engine)).map((r) => r.item);
  return { overall, rows, passOnNotEvaluated };
}

// ═════════════════════════════════════════════════════════════════════════════
async function phaseEmpty() {
  await withSession('empty', async (ctx, getMcp) => {
    const g = golden('empty');
    await step('empty: validation · report · buckling report with nothing computed (SI, then US), MCP', async () => {
      await pinValidationAndReport(ctx, g, 'SI', { si: true });
      // 결과 없이 「상세 보고서 생성」 은 오류 글 — 그 상태에서 단위를 바꾸면 보고서 칸에 글이 있으므로 보고서를 다시 만든다
      await unit(ctx, 'US');
      g.check('unitToggle.reportAfterError', (await L.readReport(ctx)).heads, { expect: 'defect',
        reason: 'K3-D9: with no result the report box shows an error; a unit switch regenerates a full report (no design, page defaults) into it because the box is not empty' });
      await pinValidationAndReport(ctx, g, 'US');
      g.check('buckling', await L.bucklingReport(ctx, 'empty', false), { expect: 'pin' });
      await pinMcpPackets(ctx, getMcp, g, 'empty');
    });
  });
}

async function phaseColumn() {
  await withSession('column', async (ctx, getMcp) => {
    const g = golden('column');
    await step('column (SI, default C 100×50×20×2.3, compression) — validation · report · PDF · buckling report, SI and US, MCP', async () => {
      await ctx.tab('loads');
      await ctx.setVal('select-member-type', 'compression');
      await K.runAnalysisGui(ctx);
      await ctx.tab('design');
      for (const [k, v] of Object.entries({ 'design-KxLx': 2500, 'design-KyLy': 2500, 'design-KtLt': 2500, 'design-P': 20 })) { await ctx.setVal(k, v); }
      await K.clickAndWait(ctx, '#btn-run-design', 'designResult');
      const a = await pinValidationAndReport(ctx, g, 'SI', { pdf: true, si: true });
      g.check('SI.crossCheck', crossCheck(ctx, a.v.items), { expect: 'pin' });
      g.check('buckling', await L.bucklingReport(ctx, 'column', true), { expect: 'pin' });
      await unit(ctx, 'US');
      // 단위를 바꾸면 열려 있는 보고서를 다시 만든다(app.js refreshUnits)
      g.check('US.report.afterToggle', (await L.readReport(ctx)).text, { expect: 'pin' });
      await pinValidationAndReport(ctx, g, 'US', { pdf: true });
      await pinMcpPackets(ctx, getMcp, g, 'column');
      // 결함 재현: AI 가 기준응력 50 ksi(결정 3)와 E 29000 을 정한 뒤 — 「Fy 일관성」 은 화면의 두 거울 칸만, 보고서의 E 는 상수
      const c = await getMcp();
      await c.call('set_material', { E: 29000, v: 0.3 });
      await c.call('set_load_case', { load_case: 'compression', fy: 50 });
      await c.call('run_analysis', {});
      await ctx.settle(400);
      await ctx.tab('design');
      await K.clickAndWait(ctx, '#btn-run-design', 'designResult');   // 재료를 바꾸면 설계가 지워진다 — 보고서를 만들 수 있게 다시
      const vH = await L.runValidation(ctx);
      const rH = await L.runReport(ctx);
      g.check('aiReference.findings', {
        fyItem: vH.items.filter((i) => /^Fy 일관성|^해석 최신성/.test(i.item)).map((i) => `${i.status}: ${i.item} = ${i.value}`),
        hostLoadFy: ctx.panel.__testGetState().model.loadFy,
        modelE: ctx.panel._model.prop && ctx.panel._model.prop[0] && ctx.panel._model.prop[0][1],
        reportE: rH.text.split('\n').filter((l) => /^탄성계수, E|^포아송비/.test(l)),
      }, { expect: 'defect', reason: 'K3-D6 / K3-D8: the analysis ran with the AI reference stress 50 ksi but "Fy 일관성" compares only the two mirrored Fy fields (pass); the report prints E = 29500 ksi while the model E is 29000' });
    });
  });
}

async function phaseBeam() {
  await withSession('beam', async (ctx, getMcp) => {
    const g = golden('beam');
    await step('beam (US, lipped C 8×2.5×0.625×0.059, flexure + web crippling) — pass, then failing, then not evaluated; stale report probe', async () => {
      await unit(ctx, 'US');
      await K.genTemplate(ctx, 'lippedc', { 'tpl-H': 8, 'tpl-B': 2.5, 'tpl-D': 0.625, 'tpl-t': 0.059, 'tpl-r': 0.1 });
      await ctx.tab('design');
      await ctx.setVal('select-load-case', 'bending_xx_pos');
      await K.runAnalysisGui(ctx);
      await ctx.tab('loads');
      await ctx.setVal('select-member-type', 'flexure');
      await ctx.tab('design');
      for (const [k, v] of Object.entries({ 'design-Mx': 40, 'design-V': 1, 'design-Lb': 60, 'design-Cb': 1.0, 'design-P': 0,
        'design-wc-N': 3.5, 'design-wc-R': 0.1875 })) { await ctx.setVal(k, v); }
      await K.clickAndWait(ctx, '#btn-run-design', 'designResult');
      const a = await pinValidationAndReport(ctx, g, 'US', { pdf: true });
      g.check('US.crossCheck', crossCheck(ctx, a.v.items), { expect: 'pin' });
      g.check('buckling', await L.bucklingReport(ctx, 'beam', true), { expect: 'pin' });
      await unit(ctx, 'SI');
      await pinValidationAndReport(ctx, g, 'SI', { pdf: true, si: true });
      await pinMcpPackets(ctx, getMcp, g, 'beam');

      // 낡은 보고서: 보고서를 만든 뒤 설계 입력(Cb)을 바꾼다 — 설계 결과는 지워지는데 보고서 글은 남는가
      await unit(ctx, 'US');
      const before = await L.runReport(ctx);
      await ctx.tab('design');
      await ctx.setVal('design-Cb', 1.3);
      await ctx.settle(400);
      const after = await L.readReport(ctx);
      g.check('stale.reportAfterInputChange', { designResultCleared: ctx.panel._lastDesignResult == null ? 'host-null' : 'host-kept',
        pageDesignShown: (await ctx.text('#design-summary') || '').slice(0, 60), reportUnchanged: before.text === after.text, reportHasDesign: /설계 계산/.test(after.text) },
      { expect: 'pin', reason: 'checked: after a design input changes the result is cleared and the open report is regenerated without the design sections — not stale' });
      const vStale = await L.runValidation(ctx);
      g.check('stale.validationAfterInputChange', vStale.items.filter((i) => /^G\./.test(i.category)).map((i) => [i.item, i.status]), { expect: 'pin' });

      // 불합격: Mu 200 kip-in
      await ctx.setVal('design-Cb', 1.0);
      await ctx.setVal('design-Mx', 200);
      await K.clickAndWait(ctx, '#btn-run-design', 'designResult');
      const f = await pinValidationAndReport(ctx, g, 'fail.US', { pdf: true });
      g.check('fail.crossCheck', crossCheck(ctx, f.v.items), { expect: 'pin' });
      // 판정 없음: 소요 없음(Mu 0, V 0, 웹 크리플링 없음)
      for (const [k, v] of Object.entries({ 'design-Mx': 0, 'design-V': 0, 'design-wc-N': '', 'design-wc-R': '' })) { await ctx.setVal(k, v); }
      await K.clickAndWait(ctx, '#btn-run-design', 'designResult');
      const n = await pinValidationAndReport(ctx, g, 'notEvaluated.US', { pdf: true });
      g.check('notEvaluated.crossCheck', crossCheck(ctx, n.v.items), { expect: 'defect',
        reason: 'K3-D1: no demand — the engine reports member.flexure.* not_evaluated, the page shows "Mne vs My" pass and the local / distortional items as reductions' });
    });
  });
}

async function ii2aGui(ctx) {
  const S = ctx.setVal.bind(ctx);
  await unit(ctx, 'US');
  await K.genTemplate(ctx, 'lippedz', { 'tpl-H': 8, 'tpl-B': 2.25, 'tpl-D': 0.91, 'tpl-t': 0.059, 'tpl-r': 0.1875, 'tpl-qlip': 50 });
  await S('input-fy', 55); await S('input-fu', 70);
  await ctx.tab('loads');
  await S('select-member-type', 'roof-purlin');
  await S('select-design-method', 'ASD');
  await S('select-span-type', 'cont-n');
  await S('config-n-spans', 6);
  await S('config-spacing', 5);
  await ctx.eval(`(()=>{const L=[1,25,25,25,25,1]; const sup=['N','P','P','P','P','P','N'];
    const lap=[[0,0],[0,0],[2.5,3.5],[1,1],[3.5,2.5],[0,0],[0,0]];
    document.querySelectorAll('.span-tbl-len').forEach((e,i)=>{e.value=L[i];e.dispatchEvent(new Event('change',{bubbles:true}));});
    document.querySelectorAll('.span-tbl-sup').forEach((e,i)=>{e.value=sup[i];e.dispatchEvent(new Event('change',{bubbles:true}));});
    document.querySelectorAll('.span-tbl-lapl').forEach(e=>{const i=+e.dataset.idx;e.value=lap[i][0];e.dispatchEvent(new Event('change',{bubbles:true}));});
    document.querySelectorAll('.span-tbl-lapr').forEach(e=>{const i=+e.dataset.idx;e.value=lap[i][1];e.dispatchEvent(new Event('change',{bubbles:true}));});})()`);
  await S('select-deck-type', 'through-fastened');
  await S('deck-kphi-override', 0.3);
  for (const [k, v] of Object.entries({ 'load-D-psf': 3, 'load-Lr-psf': 20, 'load-S-psf': 0, 'load-Wu-psf': 34, 'load-Wp-psf': 0, 'load-L-psf': 0 })) { await S(k, v); }
  await S('chk-pattern-loading', false);
  await S('chk-lr-reduced', false);
  await S('chk-i621-confirmed', true);
  await S('span-Ix-list', '9.18, 9.18, 7.76, 7.76, 9.18, 9.18');
}

async function phasePurlin() {
  await withSession('purlin', async (ctx, getMcp) => {
    const g = golden('purlin');
    await step('purlin II-2A (US, Z 8×2.25, 6 spans, laps, through-fastened deck) + lap; then uplift (Lr 0) — validation · report · PDF, US and SI, MCP', async () => {
      await ii2aGui(ctx);
      await K.clickAndWait(ctx, '#btn-analyze-loads', 'loadAnalysisComplete');
      await ctx.tab('design');
      await K.clickAndWait(ctx, '#btn-run-design', 'designPurlinResult', 900000);
      await ctx.tab('connection');
      for (const [k, v] of Object.entries({ 'conn-fastener-type': 'screw', 'conn-fastener-dia': 0.19, 'conn-n-rows': 2, 'conn-edge-dist': 1.0, 'conn-lap-Pnvs': 1.2 })) {
        await ctx.setVal(k, v);
      }
      await K.clickAndWait(ctx, '#btn-run-lap-design', 'lapConnectionResult');
      const a = await pinValidationAndReport(ctx, g, 'US', { pdf: true });
      g.check('US.crossCheck', crossCheck(ctx, a.v.items), { expect: 'pin' });
      await unit(ctx, 'SI');
      await pinValidationAndReport(ctx, g, 'SI', { pdf: true, si: true });
      await pinMcpPackets(ctx, getMcp, g, 'purlin');
      // 양력 지배: Lr 0
      await unit(ctx, 'US');
      await ctx.tab('loads');
      await ctx.setVal('load-Lr-psf', 0);
      await K.clickAndWait(ctx, '#btn-analyze-loads', 'loadAnalysisComplete');
      await ctx.tab('design');
      await K.clickAndWait(ctx, '#btn-run-design', 'designPurlinResult', 900000);
      const u = await pinValidationAndReport(ctx, g, 'uplift.US', { pdf: true });
      g.check('uplift.crossCheck', crossCheck(ctx, u.v.items), { expect: 'pin' });
    });
  });
}

async function phaseConnection() {
  await withSession('connection', async (ctx, getMcp) => {
    const g = golden('connection');
    await step('single connection (SI screw) and an MCP lap without Mnd (engine b288448: not checked) — validation · report, MCP', async () => {
      await ctx.tab('connection');
      for (const [k, v] of Object.entries({ 'conn-single-type': 'screw', 'conn-t1': 1.5, 'conn-t2': 1.5, 'conn-d': 4.8, 'conn-n': 4, 'conn-Pu': 8.9,
        'conn-Pnvs': 5.3, 'conn-e': 15, 'conn-s': 25 })) { await ctx.setVal(k, v); }
      await K.clickAndWait(ctx, '#btn-run-single-conn', 'connectionResult');
      await pinValidationAndReport(ctx, g, 'SI', {
        vExpect: 'k3-change', vReason: 'K3: the single-connection result is not looked at by any validation item (only the lap result is)',
        rExpect: 'k3-change', rReason: 'K3: the report has no connection section — with only a connection result it says there is no design result', si: true });
      await unit(ctx, 'US');
      await pinValidationAndReport(ctx, g, 'US');
      const c = await getMcp();
      const lap = await c.call('design_lap_connection', { d: 8, t: 0.059, Fy: 55, Fu: 70, lap_left_in: 30, lap_right_in: 42, Mu_support: 52.5, Vu_support: 0.9,
        fastener_type: 'screw', fastener_dia: 0.19, n_rows: 2, end_distance: 1.0, Pnvs: 1.2, design_method: 'ASD' });
      g.check('mcpLap.verdict', { isError: lap.isError, verdict: lap.data && lap.data.verdict, notEvaluated: lap.data && lap.data.not_evaluated }, { expect: 'pin' });
      await pinValidationAndReport(ctx, g, 'afterMcpLap.US');
      await pinMcpPackets(ctx, getMcp, g, 'connection');
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  if (!findBrowser() || !pythonPath()) {
    console.log('test:k3: SKIP (needs Edge/Chrome and .venv python)');
    return;
  }
  const t0 = Date.now();
  if (want('empty')) { await phaseEmpty(); }
  if (want('column')) { await phaseColumn(); }
  if (want('beam')) { await phaseBeam(); }
  if (want('purlin')) { await phasePurlin(); }
  if (want('connection')) { await phaseConnection(); }
  const report = [];
  let mism = 0;
  for (const g of goldens) {
    const wrote = g.save();
    if (wrote) { report.push(`  recorded ${g.name} (${g.entries.length} entries)`); }
    for (const m of g.mismatch) { mism++; report.push(`  MISMATCH ${g.name} :: ${m.id} [expect ${m.expect}]${m.reason ? ' — ' + m.reason : ''}\n           ${m.detail}`); }
  }
  fs.mkdirSync(L.OUT, { recursive: true });
  fs.writeFileSync(path.join(L.OUT, 'observed_validation_items.json'), JSON.stringify(observed, null, 1));
  fs.writeFileSync(path.join(L.OUT, 'results.json'), JSON.stringify({ results, exceptions }, null, 1));
  console.log(report.join('\n'));
  console.log(`K3 shadow (page ↔ host): ${L.shadowStats()} comparisons, ${L.shadowProblems.length} problems`);
  for (const p of L.shadowProblems.slice(0, 8)) { console.log('  SHADOW ' + p); }
  console.log(`page exceptions: ${exceptions.length}`);
  for (const e of exceptions.slice(0, 5)) { console.log('  EXC', e.session, String(e.text).slice(0, 200)); }
  const failed = results.filter((r) => !r.ok).length;
  const ok = failed === 0 && mism === 0 && exceptions.length === 0 && L.shadowProblems.length === 0;
  console.log(`test:k3: ${ok ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length} steps, ${mism} golden mismatches, ${Math.round((Date.now() - t0) / 1000)} s)`);
  if (!ok) { process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
