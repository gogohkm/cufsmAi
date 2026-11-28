/* global process */
// 2026-11-28 경간마다 다른 퍼린 단면 — 끼운 편집 화면(app.js)의 「단면 목록」 · 경간 표의 「단면」 칸을 진짜 화면으로(렌더 시험, 보이지 않는 창).
//   npm run test:rendered        (test/rendered/web_options.js 다음에 이 파일 — package.json)
//   node test/rendered/span_sections.js
// 진짜 호스트(StcfsdPanel) · 파이썬 · 웹뷰(헤드리스 Edge, test/rendered/lib.js).
//  R1 템플릿 단면(설계 매뉴얼 II-1A 의 9CS2.5x070)에서 「+ 단면 추가」 → S2 의 치수(9CS2.5x059), 경간 2 · 3 을 S2 — 검토 상태가 화면 칸과 같고, S2 의 Ix 가 보인다
//  R2 「설계 검토 실행」 — 본문에 span_sections, 구간 표에 「단면」 열(랩은 두 부재 · 몫), 단면마다의 표, 화면 본문 = 호스트 본문(그림자), 화면 예외 0
//  R3 S2 를 지우면 경간이 S1 로(호스트의 규칙과 같다), 직접 고친 단면이면 「+ 단면 추가」 가 막히고 까닭이 보인다
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { start, findBrowser, sleep } = require('./lib');
const { pythonPath } = require('../webview/panel_harness');

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (e) { results.push({ name, ok: false, error: String(e && e.stack || e) }); console.log(`  FAIL ${name}: ${e && e.message || e}`); }
}

const IN = 25.4;
async function main() {
  if (!findBrowser()) { console.log('span_sections (rendered): SKIP — no Edge/Chrome found (set V4_BROWSER).'); return; }
  if (!pythonPath()) { console.log('span_sections (rendered): SKIP — no .venv python.'); return; }
  const outDir = path.join(__dirname, 'out', 'span_sections');
  const ctx = await start({ outDir });
  const S = (id, v) => ctx.setVal(id, v);
  const state = () => ctx.panel.__testGetCase().state;
  /** 칸(클래스 · 순서)에 값을 넣고 input · change 를 보낸다 */
  const setAt = (sel, i, v) => ctx.eval(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if(!e) return 'MISSING'; e.value=${JSON.stringify(String(v))};
    e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 'ok';})()`);
  const noErrors = (m, what) => {
    const since = ctx.since(m);
    assert.deepStrictEqual(since.exceptions.map((e) => e.text), [], `${what}: page / host exceptions`);
    assert.deepStrictEqual(since.console.filter((c) => c.type === 'error' || c.type === 'log-error').map((c) => c.text), [], `${what}: console errors`);
  };
  try {
    await step('R1 section list: add S2 (template dimensions), assign spans 2 · 3 — case state = fields, Ix shown', async () => {
      const m0 = ctx.mark();
      await ctx.tab('preprocessor');
      await S('select-template', 'lippedc');
      for (const [k, v] of Object.entries({ 'tpl-H': 9 * IN, 'tpl-B': 2.5 * IN, 'tpl-D': 0.8 * IN, 'tpl-t': 0.070 * IN, 'tpl-r': 0.1875 * IN, 'tpl-qlip': 90 })) { assert.strictEqual(await S(k, v), 'ok', k); }
      const mt = ctx.mark();
      await ctx.click('#btn-generate-template');
      await ctx.waitMsg('templateGenerated', mt.h2w, 60000);
      await ctx.settle(300);
      await S('input-fy', 379.21); await S('input-fu', 482.63);
      await ctx.tab('loads');
      await S('select-member-type', 'roof-purlin');
      await S('select-span-type', 'cont-4');
      await ctx.settle(200);
      for (let i = 0; i < 4; i++) { await setAt('.span-tbl-len', i, 7.62); }
      const laps = [[null, null], [0.6096, 0.8382], [0.381, 0.381], [0.8382, 0.6096], [null, null]];
      for (let i = 1; i <= 3; i++) {
        await ctx.eval(`(()=>{const l=document.querySelector('.span-tbl-lapl[data-idx="${i}"]'), r=document.querySelector('.span-tbl-lapr[data-idx="${i}"]');
          l.value='${laps[i][0]}'; r.value='${laps[i][1]}'; [l,r].forEach(e=>e.dispatchEvent(new Event('change',{bubbles:true})));})()`);
      }
      for (const [k, v] of Object.entries({ 'config-spacing': 1.524, 'load-D-psf': 0.14364, 'load-Lr-psf': 0.86184, 'load-S-psf': 0, 'load-Wu-psf': 1.37894, 'load-Wp-psf': 0,
        'select-deck-type': 'through-fastened', 'deck-t-panel': 0.4826, 'deck-fastener-spacing': 304.8 })) { assert.strictEqual(await S(k, v), 'ok', k); }
      await S('chk-i621-confirmed', true); await S('chk-lap-restrained', true);
      await ctx.settle(300);
      // 처음: S1 줄만, 경간 칸은 모두 S1
      assert.strictEqual(await ctx.eval(`document.querySelectorAll('#sec-list-tbody tr').length`), 1, 'only the S1 row');
      assert.deepStrictEqual(await ctx.eval(`[...document.querySelectorAll('.span-tbl-sec')].map(e=>e.value)`), ['S1', 'S1', 'S1', 'S1']);
      assert.strictEqual(await ctx.eval(`document.getElementById('btn-sec-add').disabled`), false, 'add enabled on a template section');
      await ctx.click('#btn-sec-add');
      await ctx.settle(300);
      assert.strictEqual(await ctx.eval(`document.querySelectorAll('.sec-row[data-sec-id="S2"]').length`), 1, 'S2 row');
      // S2 의 치수(9CS2.5x059): t 1.4986 mm, D 19.634 mm, 이름
      await ctx.eval(`(()=>{const r=document.querySelector('.sec-row[data-sec-id="S2"]'); const set=(sel,v)=>{const e=r.querySelector(sel); e.value=String(v); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));};
        set('.sec-p[data-p="t"]', ${0.059 * IN}); set('.sec-p[data-p="D"]', ${0.773 * IN}); set('.sec-name', '9CS2.5x059');})()`);
      await ctx.settle(300);
      for (const i of [1, 2]) { assert.strictEqual(await setAt('.span-tbl-sec', i, 'S2'), 'ok', 'span select ' + i); }
      await ctx.settle(400); await ctx.drain();
      const st = state();
      assert.deepStrictEqual(st.spans.spanSections, ['S1', 'S2', 'S2', 'S1'], 'host spanSections');
      assert.strictEqual(st.sections.length, 1);
      assert(Math.abs(st.sections[0].params.t - 0.059) < 1e-9 && Math.abs(st.sections[0].params.D - 0.773) < 1e-9 && st.sections[0].name === '9CS2.5x059', 'host section ' + JSON.stringify(st.sections[0]));
      assert(Math.abs(st.sections[0].params.H - 9) < 1e-9, 'H copied from the model');
      // S2 의 Ix(호스트가 그 치수로 만든 단면의 성질)
      const ix = await ctx.text('.sec-ix[data-sec-id="S2"]');
      assert(/[0-9]/.test(ix || ''), 'S2 Ix shown: ' + ix);
      noErrors(m0, 'R1');
      await ctx.shot('r1_section_list', { maxHeight: 4000 });
    });

    await step('R2 run: body with span_sections, region table with a section column (lap = two members), per-section table, page body = host body', async () => {
      const ma = ctx.mark();
      await ctx.click('#btn-analyze-loads');
      await ctx.waitMsg('loadAnalysisComplete', ma.h2w, 300000);
      await ctx.settle(300);
      const sentLoads = ctx.log.w2h.slice(ma.w2h).find((x) => x.command === 'analyzeLoads');
      assert(sentLoads && Array.isArray(sentLoads.data.span_sections) && sentLoads.data.span_sections.join() === 'S1,S2,S2,S1', 'load body span_sections');
      await ctx.tab('design');
      const m = ctx.mark();
      await ctx.click('#btn-run-design');
      await ctx.waitMsg('designPurlinResult', m.h2w, 900000);
      await ctx.drain(); await ctx.settle(300); await ctx.drain();
      const sentMsg = ctx.log.w2h.slice(m.w2h).find((x) => x.command === 'runPurlinDesign');
      assert(sentMsg && sentMsg.data.span_sections.join() === 'S1,S2,S2,S1' && sentMsg.data.sections[0].id === 'S2', 'purlin body');
      const shadow = ctx.panel.__testGetCase().shadow.filter((x) => x.what === 'purlin' || x.what === 'loads');
      assert(shadow.length >= 2 && shadow.every((x) => x.same), 'page body = host body ' + JSON.stringify(shadow.filter((x) => !x.same)).slice(0, 600));
      const pr = ctx.lastH2W('designPurlinResult');
      assert(pr && Array.isArray(pr.sections) && pr.sections.length === 2 && pr.span_sections.join() === 'S1,S2,S2,S1', 'host result sections');
      const card = await ctx.text('#design-summary');
      assert(/단면/.test(card) && /경간마다 단면/.test(card), 'section column and heading');
      const rows = await ctx.eval(`[...document.querySelectorAll('#purlin-region-table tr')].slice(1).map(tr=>tr.cells[1] ? tr.cells[1].innerText : '')`);
      assert(rows.length === pr.regions.length, 'one row per region');
      assert(rows.some((t) => /S1 \d+\.\d% \| S2 \d+\.\d%/.test(t)), 'a lap row shows both members: ' + rows.filter((t) => /\|/.test(t)).slice(0, 2));
      assert(rows.some((t) => /^S2$/.test(t.trim())), 'an interior-span region on S2');
      const secRows = await ctx.eval(`document.querySelectorAll('#purlin-sections-table tr').length`);
      assert.strictEqual(secRows, 3, 'per-section table (header + S1 + S2)');
      const bad = (await ctx.badTokens('#design-summary')) || [];
      assert.deepStrictEqual(bad.filter((b) => !/\bnull\b/.test(b) || /: null|= null| null /.test(b)), [], 'bad tokens in the result card');
      noErrors(m, 'R2');
      await ctx.shot('r2_result', { maxHeight: 9000 });
    });

    await step('R3 remove S2 → spans back to S1; an edited section blocks the list with its reason', async () => {
      const m = ctx.mark();
      await ctx.tab('loads');
      await ctx.click('.sec-del[data-sec-id="S2"]');
      await ctx.settle(400); await ctx.drain();
      assert.deepStrictEqual(await ctx.eval(`[...document.querySelectorAll('.span-tbl-sec')].map(e=>e.value)`), ['S1', 'S1', 'S1', 'S1'], 'page spans S1');
      assert.deepStrictEqual(state().spans.spanSections, ['S1', 'S1', 'S1', 'S1'], 'host spans S1');
      assert.strictEqual(state().sections.length, 0, 'host list empty');
      // 직접 고친 단면(절점 하나를 옮긴다 — 호스트 MCP)
      const n1 = ctx.panel._model.node[0];
      await ctx.panel.handleMcpAction({ action: 'modify_node', node_id: 1, x: n1[1] + 1e-4, z: n1[2] });
      await ctx.settle(400); await ctx.drain();
      assert.strictEqual(await ctx.eval(`document.getElementById('btn-sec-add').disabled`), true, 'add blocked on an edited section');
      const why = await ctx.text('#sec-list-reason');
      assert(/템플릿으로 만든 단면/.test(why || ''), 'reason shown: ' + why);
      noErrors(m, 'R3');
    });
  } finally {
    await ctx.close();
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ results, exceptions: ctx.log.exceptions,
    console: ctx.log.console.filter((c) => c.type === 'error') }, null, 1));
  console.log(`page exceptions: ${ctx.log.exceptions.length}, console errors: ${ctx.log.console.filter((c) => c.type === 'error').length}`);
  console.log(`span_sections (rendered): ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length})`);
  if (failed.length > 0 || ctx.log.exceptions.length > 0) { process.exitCode = 1; }
  await sleep(200);
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e); process.exit(1); });
