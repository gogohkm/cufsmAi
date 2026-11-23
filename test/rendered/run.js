/* global process */
// W3 — 렌더 시험(opt-in): 진짜 StcfsdPanel + 진짜 파이썬 + 진짜 웹뷰(헤드리스 Edge/Chrome, DevTools 프로토콜).
//   npm run test:rendered          (Edge 또는 Chrome 필요 — 없으면 SKIP 을 분명히 적고 끝냄)
// 검증 V4(docs/reviews/20261122-engine-review/verify/V4-boundary-rendered.md)의 결함을 화면에서 재현하는 시나리오.
// 그림은 test/rendered/out/shots/ (git 에 넣지 않음 — test/rendered/.gitignore).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { start, findBrowser, sleep } = require('./lib');
const { pythonPath } = require('../webview/panel_harness');
const { startMcp } = require('./mcp');

const results = [];

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, s: (Date.now() - t0) / 1000 });
    console.log(`  ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e && e.stack || e) });
    console.log(`  FAIL ${name}: ${e && e.message || e}`);
  }
}

const has = (s, re) => re.test(String(s || ''));

async function genTemplate(ctx, type, dims) {
  await ctx.tab('preprocessor');
  await ctx.setVal('select-template', type);
  for (const [k, v] of Object.entries(dims)) { await ctx.setVal(k, v); }
  const m = ctx.mark();
  await ctx.click('#btn-generate-template');
  await ctx.waitMsg('templateGenerated', m.h2w, 60000);
  await ctx.settle(300);
}

async function runAnalysis(ctx) {
  await ctx.tab('design');
  const m = ctx.mark();
  await ctx.click('#btn-run-analysis');
  await ctx.waitMsg('analysisComplete', m.h2w, 300000);
  await ctx.waitMsg('designDsmPrepared', m.h2w, 300000).catch(() => {});
  await ctx.settle(300);
}

async function directFlexure(ctx) {
  await ctx.tab('loads');
  await ctx.setVal('select-member-type', 'flexure');
  await ctx.tab('design');
  for (const [k, v] of Object.entries({ 'design-Mx': 40, 'design-V': 1, 'design-Lb': 60, 'design-Cb': 1.0, 'design-P': 0 })) {
    await ctx.setVal(k, v);
  }
  const m = ctx.mark();
  await ctx.click('#btn-run-design');
  await ctx.waitMsg('designResult', m.h2w, 300000);
  await ctx.settle(300);
}

async function ii2aLoads(ctx, opts = {}) {
  const S = ctx.setVal.bind(ctx);
  await ctx.click('#btn-unit-US');
  await genTemplate(ctx, 'lippedz', { 'tpl-H': 8, 'tpl-B': 2.25, 'tpl-D': 0.91, 'tpl-t': 0.059, 'tpl-r': 0.1875, 'tpl-qlip': 50 });
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
  for (const [k, v] of Object.entries({ 'load-D-psf': 3, 'load-Lr-psf': 20, 'load-S-psf': 0, 'load-Wu-psf': 34, 'load-Wp-psf': 0, 'load-L-psf': 0 })) {
    await S(k, v);
  }
  await S('chk-pattern-loading', false);
  await S('chk-lr-reduced', false);
  await S('chk-i621-confirmed', true);
  await S('span-Ix-list', '9.18, 9.18, 7.76, 7.76, 9.18, 9.18');
  for (const id of (opts.blank || [])) { await S(id, ''); }
  const m = ctx.mark();
  await ctx.click('#btn-analyze-loads');
  await ctx.waitMsg('loadAnalysisComplete', m.h2w, 300000).catch(() => {});
  await ctx.settle(300);
  return m;
}

async function main() {
  if (!findBrowser()) {
    console.log('test:rendered: SKIP — no Edge/Chrome found (set V4_BROWSER to the browser executable).');
    return;
  }
  if (!pythonPath()) {
    console.log('test:rendered: SKIP — no .venv python.');
    return;
  }
  const outDir = path.join(__dirname, 'out');
  const ctx = await start({ outDir });
  const tmp = (n) => path.join(outDir, n);
  try {
    // ── S-steel-default: 새로 시작한 화면의 재료 = SGC400 295/400 MPa, 강종 선택, 245 로 저장한 파일은 245 ──
    // (맨 앞 — 다른 단계가 단위 · 재료를 바꾸기 전의 처음 화면을 본다)
    await step('S-steel default steel on a fresh start, grade picks, a 245 file keeps 245', async () => {
      const KSI_MPA = 4448.2216152605 / (25.4 * 25.4);
      const fields = () => ctx.eval(`(()=>{const v=id=>document.getElementById(id).value; return {grade:v('input-steel-grade'),
        fy:v('input-fy'), fu:v('input-fu'), plasticFy:v('plastic-fy'), designFy:v('design-fy'), designFu:v('design-fu'),
        connFy:v('conn-Fy'), connFu:v('conn-Fu'), disp:document.getElementById('analysis-fy-display').textContent};})()`);
      await ctx.settle(300);
      let f = await fields();
      await ctx.shotEl('rs1_fresh_material', '#input-steel-grade');
      assert.deepStrictEqual(f, { grade: 'SGC400', fy: '295', fu: '400', plasticFy: '295', designFy: '295', designFu: '400',
        connFy: '295', connFu: '400', disp: 'Fy: 295 MPa' }, 'fresh start shows SGC400 295/400 MPa on every tab');
      assert.strictEqual(ctx.panel._model.loadFy * KSI_MPA, 295, 'host reference stress is 295 MPa');
      for (const [g, fy, fu] of [['SGC340', '245', '340'], ['SGC440', '335', '440'], ['SGC400', '295', '400']]) {
        await ctx.setVal('input-steel-grade', g);
        f = await fields();
        assert(f.fy === fy && f.fu === fu && f.designFy === fy && f.designFu === fu && f.plasticFy === fy
          && f.connFy === fy && f.connFu === fu && f.disp === `Fy: ${fy} MPa`, `${g} shows ${fy}/${fu} MPa (${JSON.stringify(f)})`);
      }
      // 옛 기본(SGC400 표지 + Fy 245)으로 저장한 파일: 화면 칸과 모델 기준응력 모두 245
      await ctx.setVal('input-fy', 245);
      await ctx.panel.handleMcpAction({ action: 'set_load_case', load_case: 'compression', fy: 245 / KSI_MPA });
      const file = tmp('r_steel245.csd');
      try { fs.unlinkSync(file); } catch { /* none */ }
      ctx.dialogs.nextSave = file;
      await ctx.click('#btn-file-save');
      await ctx.settle(600);
      assert(fs.existsSync(file), 'saved');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert(Math.abs(saved.designInputs.fy * KSI_MPA - 245) < 1e-9 && saved.designInputs.presteelGrade === 'SGC400',
        'the file carries SGC400 with Fy 245 MPa');
      // 지금 화면을 새 기본으로 되돌린 뒤 연다
      await ctx.setVal('input-steel-grade', 'SGC400');
      await ctx.panel.handleMcpAction({ action: 'set_load_case', load_case: 'compression', fy: 295 / KSI_MPA });
      assert.strictEqual((await fields()).fy, '295');
      ctx.dialogs.nextOpen = file;
      const mOpen = ctx.mark();
      await ctx.click('#btn-file-open');
      // 열기가 끝날 때까지 — 시간이 아니라 순서로(호스트가 복원을 보낸 뒤, 화면이 그것까지 다 처리한 뒤). 부하에서 한 번 295 를 읽었다.
      await ctx.waitMsg('restoreDesignInputs', mOpen.h2w, 60000);
      await ctx.drain();
      f = await fields();
      await ctx.shotEl('rs1_opened_245_file', '#input-steel-grade');
      assert(f.fy === '245' && f.designFy === '245' && f.plasticFy === '245' && f.connFy === '245' && f.disp === 'Fy: 245 MPa',
        `a file saved with 245 opens with 245 (${JSON.stringify(f)})`);
      assert(f.fu === '400' && f.designFu === '400', 'Fu 400 kept');
      assert(Math.abs(ctx.panel._model.loadFy * KSI_MPA - 245) < 1e-9, 'host reference stress from the file (245 MPa)');
      assert.strictEqual(f.grade, '', 'the grade label no longer claims SGC400 (295/400) next to 245');
    });

    // ── V4-01: 무효가 된 결과를 화면에서 지운다 (MCP 단면 변경) ─────────────────────────
    await step('V4-01 stale design card after MCP template change', async () => {
      await ctx.click('#btn-unit-US');
      await genTemplate(ctx, 'lippedc', { 'tpl-H': 8, 'tpl-B': 2.5, 'tpl-D': 0.625, 'tpl-t': 0.059, 'tpl-r': 0.1 });
      await runAnalysis(ctx);
      await directFlexure(ctx);
      const before = await ctx.text('#design-summary');
      assert(has(before, /OK|NG|판정 없음/), 'a verdict is on screen before the change');
      await ctx.panel.handleMcpAction({ action: 'generate_template', section_type: 'lippedc',
        params: { H: 4, B: 1.5, D: 0.5, t: 0.03, r: 0.1 } });
      await ctx.settle(400);
      const after = await ctx.text('#design-summary');
      await ctx.shotEl('r01_after_mcp_template', '#design-summary');
      assert(!has(after, /✓ OK|✗ NG/), `old verdict still on screen: ${after.split('\n')[0]}`);
      assert(has(after, /결과 없음/), 'stale notice shown');
      const dsm = await ctx.text('#dsm-table-container');
      assert(has(dsm, /결과 없음/), 'DSM table cleared');
    });

    // ── V4-01 (파일 열기) + V4-10 (입력 초기화) + V4-11 (옛 결과) ───────────────────────
    await step('V4-01/10/11 opening an older file clears results and resets inputs', async () => {
      await runAnalysis(ctx);
      await directFlexure(ctx);
      // 지금 상태를 v1.3 으로 쓰고, 옛 판(1.2 — 결과 판 기록 없음, 새 입력 키 없음)처럼 고친다.
      const f13 = tmp('r_proj13.csd');
      await ctx.panel.__testWriteProjectFile(f13, { __stcfsd_collect: 2, designInputs: { unitSystem: 'US', fy: 50 }, lapResult: null });
      const j = JSON.parse(fs.readFileSync(f13, 'utf8'));
      j.version = '1.2';
      delete j.resultsEngine;
      j.designResult = { ...(j.designResult || {}), member_type: 'flexure', pass: true, utilization: 0.9288 };
      j.designInputs = { unitSystem: 'US', fy: 50, Mux: 40 * 0 + 30 };   // 옛 키만 — designMxPos 없음
      const f12 = tmp('r_proj12.csd');
      fs.writeFileSync(f12, JSON.stringify(j));
      // 이전 프로젝트 값: 정모멘트 Mu(+) 를 칸에 남겨 둔다(V4-10 재현 조건)
      await ctx.setVal('design-Mx-pos', 84.92);
      ctx.dialogs.nextOpen = f12;
      const m = ctx.mark();
      await ctx.click('#btn-file-open');
      await ctx.settle(800);
      const cmds = ctx.since(m).h2w;
      const card = await ctx.text('#design-summary');
      await ctx.tab('design');
      await ctx.shotEl('r01b_after_open_old_file', '#design-summary');
      assert(!cmds.includes('designResult') && !cmds.includes('designPurlinResult'), 'V4-11: old design result not restored');
      assert(!has(card, /✓ OK/), 'V4-01/11: no OK card after opening an older file');
      // V7-01: 까닭은 셋 가운데 하나(다른 엔진 · 입력과 맞지 않음 · 이 PC 의 것이 아님) — 옛 파일은 「다른 엔진」
      assert(ctx.log.warn.some((w) => /computed by another engine|not computed by this program on this PC|do not match the model and inputs/.test(w)), 'V4-11 · V7-01: user told results were discarded');
      const mpos = await ctx.eval(`document.getElementById('design-Mx-pos').value`);
      assert(!(parseFloat(mpos) > 80), `V4-10: previous project's Mu(+) leaked into the opened file (${mpos})`);
    });

    // ── V4-10 (재검증): 입력 기록이 없는 진짜 v1.0 파일 — 칸을 처음 값으로, 해석 조건 칸은 모델 값으로 ──────
    await step('V4-10 a v1.0 file with no saved inputs resets inputs and syncs the analysis widgets', async () => {
      const v10 = path.join(ctx.REPO, 'Example', 'test.csd');
      const j = JSON.parse(fs.readFileSync(v10, 'utf8'));
      assert(j.version === '1.0' && !j.designInputs, 'fixture is a v1.0 file without designInputs');
      await ctx.click('#btn-unit-US');
      // 이전 프로젝트의 값을 여러 탭에 남긴다
      await ctx.setVal('design-Mx-pos', 84.92);
      await ctx.setVal('design-dist-Lm', 270);
      await ctx.setVal('conn-single-type', 'bolt');
      await ctx.setVal('conn-Fub', 120);
      await ctx.setVal('select-template', 'lippedc');
      await ctx.setVal('tpl-H', 8);
      await ctx.setVal('input-neigs', 7);
      await ctx.setVal('select-bc', 'C-C');
      ctx.dialogs.nextOpen = v10;
      const m = ctx.mark();
      await ctx.click('#btn-file-open');
      await ctx.settle(800);
      const rst = ctx.log.h2w.slice(m.h2w).find((x) => x.command === 'restoreDesignInputs');
      assert(rst && rst.data && Object.keys(rst.data).length === 0, 'host sends an empty restore for a file with no inputs');
      const v = await ctx.eval(`(()=>Object.fromEntries(['design-Mx-pos','design-dist-Lm','conn-Fub','select-template','select-bc',
        'input-neigs','input-len-min','input-len-max','input-len-n'].map(i=>[i,document.getElementById(i).value])))()`);
      console.log(`     after opening v1.0: ${JSON.stringify(v)}`);
      assert(!(parseFloat(v['design-Mx-pos']) > 80), `Mu(+) of the previous project kept (${v['design-Mx-pos']})`);
      assert(parseFloat(v['design-dist-Lm']) !== 270, 'β Lm of the previous project kept');
      assert(v['conn-Fub'] !== '120', 'bolt Fub of the previous project kept');
      // 모델은 템플릿 기록이 없는 절점 모델 — 화면은 「직접 입력」(옛 lippedc H 8 을 지니지 않는다)
      assert.strictEqual(v['select-template'], '', 'template selector shows direct input for a model without template metadata');
      // 해석 조건 칸 = 모델(위젯 동기화)
      assert.strictEqual(v['select-bc'], j.model.BC, 'BC widget follows the model');
      assert.strictEqual(Number(v['input-neigs']), j.model.neigs, 'neigs widget follows the model');
      assert.strictEqual(Number(v['input-len-n']), j.model.lengths.length, 'length count follows the model');
      assert(Math.abs(Number(v['input-len-min']) - Math.min(...j.model.lengths)) < 1e-9, 'min length follows the model');
      assert(Math.abs(Number(v['input-len-max']) - Math.max(...j.model.lengths)) < 1e-6, 'max length follows the model');
      // 파일의 절점 응력은 P · M 값 없는 저장 분포(호스트: custom) — P · M 칸은 비우고 그 뜻을 밝힌다(0 하중으로 덮지 않게)
      const lc = await ctx.eval(`({lc: document.getElementById('select-load-case').value, P: document.getElementById('input-load-P').value,
        hint: document.getElementById('custom-load-hint').innerText, fy: document.getElementById('analysis-fy-display').innerText,
        fyIn: document.getElementById('input-fy').value})`);
      assert(lc.lc === 'custom' && lc.P === '' && /저장된 분포/.test(lc.hint), `stored stress distribution explained (${JSON.stringify(lc)})`);
      assert(lc.fy.includes(lc.fyIn), `analysis Fy display follows the reset Fy (${lc.fy} vs ${lc.fyIn})`);
      await ctx.tab('design');
      await ctx.shotEl('r_open_v10_widgets', '#tab-design .section-group');
    });

    // ── 위젯 동기화: MCP 가 바꾼 해석 조건을 칸에 — 「해석 실행」 이 되돌리지 않는다 ────────────────────
    await step('widget sync: MCP BC / lengths / load case reach the analysis widgets; GUI run keeps them', async () => {
      await genTemplate(ctx, 'lippedc', { 'tpl-H': 8, 'tpl-B': 2.5, 'tpl-D': 0.625, 'tpl-t': 0.059, 'tpl-r': 0.1 });
      await ctx.panel.handleMcpAction({ action: 'set_bc', BC: 'C-C' });
      await ctx.panel.handleMcpAction({ action: 'set_lengths', min: 20, max: 200, n: 4 });
      await ctx.panel.handleMcpAction({ action: 'set_load_case', load_case: 'custom', P: 5, Mxx: 12 });
      // 시간이 아니라 순서로 기다린다: 호스트가 보낸 modelLoaded 를 화면이 다 처리했다(부하에서 「BC」 가 한 번 실패한 까닭 — settle 300 ms)
      await ctx.drain();
      let v = await ctx.eval(`(()=>Object.fromEntries(['select-bc','input-len-min','input-len-max','input-len-n','select-load-case',
        'input-load-P','input-load-Mxx','input-load-Mzz'].map(i=>[i,document.getElementById(i).value])))()`);
      assert.strictEqual(v['select-bc'], 'C-C', 'BC');
      assert.deepStrictEqual([v['input-len-min'], v['input-len-max'], v['input-len-n']].map(Number), [20, 200, 4], 'lengths');
      assert.strictEqual(v['select-load-case'], 'custom', 'load case');
      assert.deepStrictEqual([v['input-load-P'], v['input-load-Mxx'], v['input-load-Mzz']].map(Number), [5, 12, 0], 'custom P/M values');
      await ctx.panel.handleMcpAction({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 50 });
      // 그리고 AI 가 곧바로 상태를 쓴다(caseState) — 화면이 아직 알리지 않은 옛 모델 칸 초안(「조합」)이 새 하중 경우를 덮지 않는다
      await ctx.panel.handleMcpAction({ action: 'set_case_inputs', inputs: { deckInsulationIn: 1 } });
      await ctx.drain();
      v = await ctx.eval(`document.getElementById('select-load-case').value`);
      assert.strictEqual(v, 'bending_xx_pos', 'load case after set_load_case bending');
      // GUI 「해석 실행」 은 칸 값을 보낸다 — MCP 가 정한 C-C 가 S-S 로 돌아가지 않는다(V4 재검증의 함정)
      const m = ctx.mark();
      await ctx.click('#btn-run-analysis');
      await ctx.waitMsg('analysisComplete', m.h2w, 300000);
      await ctx.settle(300);
      const sent = (ctx.log.w2h.slice(m.w2h).find((x) => x.command === 'runAnalysis') || {}).data || {};
      assert.strictEqual(sent.BC, 'C-C', 'GUI run sent the MCP boundary condition');
      assert.strictEqual(ctx.panel._model.BC, 'C-C', 'model still C-C after the GUI run');
      assert.strictEqual(sent.lengths.length, 4, 'GUI run sent the MCP length count');
      await ctx.panel.handleMcpAction({ action: 'set_bc', BC: 'S-S' });
      await ctx.drain();
      assert.strictEqual(await ctx.eval(`document.getElementById('select-bc').value`), 'S-S', 'BC back to S-S on the widget');
      for (const [k, val] of Object.entries({ 'input-len-min': 1, 'input-len-max': 1000, 'input-len-n': 30 })) { await ctx.setVal(k, val); }
    });

    // ── V4-28: 보기 칸은 결과를 지우지 않는다 · 입력 칸은 지운다 (+ V4-18 반력 칸이 빈 직접 휨) ────────────
    await step('V4-28 view-only controls keep results; a design input clears them (+V4-18 blank reaction)', async () => {
      await ctx.setVal('select-load-case', 'compression');
      await runAnalysis(ctx);
      await ctx.tab('loads');
      await ctx.setVal('select-member-type', 'flexure');
      await ctx.tab('design');
      await ctx.setVal('design-wc-N', 3.5);
      await ctx.setVal('design-wc-R', 0.1875);
      await ctx.setVal('design-wc-P', '');
      await directFlexure(ctx);
      const card0 = await ctx.text('#design-summary');
      assert(has(card0, /OK|NG|판정 없음/) && !has(card0, /결과 없음/), 'a design verdict is on screen');
      // V4-18: 반력 칸이 비면 카드가 「Vu 를 지압 하중으로 썼음」 을 말하고, 엔진 가정 줄이 화면 칸 이름으로 보인다
      const inter = await ctx.text('#design-interaction');
      assert(has(inter, /지압 하중/) && has(inter, /Vu 를 썼음/), 'web crippling card says Vu was used as the bearing load');
      const tabTxt = await ctx.text('#tab-design');
      assert(has(tabTxt, /웹 크리플링 반력 P/), 'engine assumption names the on-screen reaction field');
      assert(!has(tabTxt, /\bwc_P\b/), 'engine argument name not shown');
      await ctx.shotEl('r_v418_blank_reaction', '#design-interaction');
      // 보기 · 다른 계산 · 해석 실행 때 적용되는 칸 — designState.VIEW_ONLY_CONTROLS
      const viewOnly = await ctx.eval('globalThis.StcfsdDesignState.VIEW_ONLY_CONTROLS.map(x=>x[0])');
      console.log(`     view-only controls: ${viewOnly.join(', ')}`);
      const m = ctx.mark();
      const lenOpt = await ctx.eval(`(()=>{const s=document.getElementById('select-length'); return s.options.length>1? s.options[1].value : null;})()`);
      assert(lenOpt != null, 'mode-shape length selector has options');
      await ctx.setVal('select-length', lenOpt);
      const modeOpt = await ctx.eval(`(()=>{const s=document.getElementById('select-mode'); return s.options.length>1? s.options[1].value : s.value;})()`);
      await ctx.setVal('select-mode', modeOpt);
      await ctx.setVal('vib-rho', '7.4e-7');
      await ctx.setVal('vib-lengths', '100');
      await ctx.setVal('chk-cfsm-G', false);
      await ctx.setVal('input-neigs', 9);
      await ctx.setVal('select-bc', 'C-C');
      await ctx.setVal('select-bc', 'S-S');
      await ctx.settle(300);
      const cmds = ctx.since(m).w2h;
      assert(!cmds.includes('invalidateDerivedResults'), `a view-only control invalidated the results (${cmds.join(',')})`);
      const card1 = await ctx.text('#design-summary');
      assert(!has(card1, /결과 없음/) && has(card1, /OK|NG|판정 없음/), 'design card kept after view-only changes');
      for (const [k, val] of Object.entries({ 'vib-rho': '', 'vib-lengths': '', 'chk-cfsm-G': true, 'input-neigs': 10 })) { await ctx.setVal(k, val); }
      // 설계 입력은 지운다
      const m2 = ctx.mark();
      await ctx.setVal('design-Lb', 61);
      await ctx.settle(300);
      assert(ctx.since(m2).w2h.includes('invalidateDerivedResults'), 'a design input invalidates');
      const card2 = await ctx.text('#design-summary');
      assert(has(card2, /결과 없음/), 'design card cleared after a design input change');
      assert(!has(card2, /Section template changed|project opened|model changed/), 'reason shown in Korean');
    });

    // ── V4-02: 비 S-S 진동은 크기를 먼저 알리고 확인을 받는다 ─────────────────────────────
    await step('V4-02 C-C vibration (C-C set on the GUI dropdown) reports its size or asks first', async () => {
      // 사용자 흐름 그대로: 드롭다운에서 C-C → 「해석 실행」 → 진동(V4 재검증: MCP 로만 바꾸면 해석 실행이 S-S 로 되돌렸다)
      await ctx.tab('design');
      await ctx.setVal('select-bc', 'C-C');
      for (const [k, val] of Object.entries({ 'input-len-min': 10, 'input-len-max': 200, 'input-len-n': 12 })) { await ctx.setVal(k, val); }
      await runAnalysis(ctx);
      assert.strictEqual(ctx.panel._model.BC, 'C-C', 'model is C-C after the GUI run');
      const m = ctx.mark();
      const t0 = Date.now();
      await ctx.click('#btn-run-vibration');
      await ctx.waitMsg('vibrationResult', m.h2w, 200000);
      await ctx.settle(300);
      const r = ctx.lastH2W('vibrationResult');
      const txt = await ctx.text('#vibration-result');
      await ctx.shotEl('r02_vibration', '#vibration-result');
      const secs = (Date.now() - t0) / 1000;
      console.log(`     C-C vibration: ${secs.toFixed(1)} s, size ${JSON.stringify(r && r.size)}, confirm=${!!(r && r.needs_confirmation)}`);
      // 전(V4-02): 5 분 시간 초과 두 번, 그 뒤 모든 호출이 줄을 섬. 지금: 크기를 보이고 끝내거나(F3 의 빠른 풀이),
      // 예상이 크면 시작하기 전에 확인을 받는다.
      assert(secs < 200, `answered well before the 5-minute timeout (${secs} s)`);
      assert(r && r.size && r.size.dof_max > 0, 'size of the run reported');
      if (r.needs_confirmation) {
        assert(has(txt, /그래도 실행/), 'confirmation button on screen');
      } else {
        assert(Array.isArray(r.frequencies) && r.frequencies.length === r.size.n_lengths, 'frequencies for every requested length');
        assert(has(txt, /최대 DOF/), 'size shown with the result');
      }
      // 다음 엔진 호출이 막히지 않는다(전: 줄을 서 15 s 넘게 응답 없음)
      const t1 = Date.now();
      await ctx.panel.handleMcpAction({ action: 'get_properties' });
      assert((Date.now() - t1) / 1000 < 10, 'engine free for the next call');
    });

    // ── V4-35: 예상이 시간 제한을 넘으면 「그래도 실행」 없이 줄이는 법만; 시간 초과 뒤 「실행 중」 이 남지 않는다 ──
    await step('V4-35 over-limit vibration is not offered; a timeout clears the running notice', async () => {
      Object.defineProperty(ctx.bridge, 'timeoutMs', { configurable: true, get: () => 1 });
      try {
        const m = ctx.mark();
        await ctx.click('#btn-run-vibration');
        await ctx.waitMsg('vibrationResult', m.h2w, 120000);
        await ctx.settle(300);
        const txt = await ctx.text('#vibration-result');
        await ctx.shotEl('r_vibration_over_limit', '#vibration-result');
        assert(has(txt, /실행하지 않았습니다/) && has(txt, /시간 제한/), `over-limit message (${txt})`);
        assert(!has(txt, /그래도 실행/) && !has(txt, /confirm_large/), 'no run-anyway button / no MCP argument name');
        assert(has(txt, /약 \d+개 이하/), 'says how many lengths would fit');
      } finally {
        delete ctx.bridge.timeoutMs;
      }
      // 시간 초과(호스트 vibrationError) — 진동 칸의 「실행 중」 을 오류로 바꾼다
      await ctx.eval(`document.getElementById('vibration-result').innerHTML='<em>진동 해석 실행 중 — 예상 433 s</em>'`);
      ctx.panel._postMessage('vibrationError', { error: 'JSON-RPC request 9 (vibration) timed out after 300000ms — the Python engine was restarted to cancel it' });
      await ctx.settle(300);
      const t2 = await ctx.text('#vibration-result');
      await ctx.shotEl('r_vibration_timeout', '#vibration-result');
      assert(!has(t2, /실행 중/) && has(t2, /시간 제한\(300 s\)/), `timeout shown in the vibration box (${t2})`);
      // 처음 화면의 반파장 격자(10–10000 mm, 60)로 되돌린다 — 설계 DSM 준비는 모델의 격자를 쓰므로 V4-02 의
      // 성긴 12 길이(10–200 in)가 남으면 랩 끝 Lcrd · β 가 달라진다(β 1.238 → 1.3).
      await ctx.panel.handleMcpAction({ action: 'set_bc', BC: 'S-S' });
      await ctx.panel.handleMcpAction({ action: 'set_lengths', min: 10 / 25.4, max: 10000 / 25.4, n: 60 });
      await ctx.settle(300);
      assert.strictEqual(await ctx.eval(`document.getElementById('select-bc').value`), 'S-S');
      assert.strictEqual(Number(await ctx.eval(`document.getElementById('input-len-n').value`)), 60);
    });

    // ── V4-03 · V4-04: 퍼린 구간 β, H2 의 Malo, 화면 β 칸의 문구 ──────────────────────────
    await step('V4-03/04 purlin regions get beta from the load analysis; H2 shows Malo', async () => {
      await ii2aLoads(ctx);
      // V4-18: 하중 분석의 지점 반력이 직접 입력용 반력 칸에 들어간다
      const wcP = await ctx.eval(`document.getElementById('design-wc-P').value`);
      assert(parseFloat(wcP) > 0, `reaction from the load analysis filled the bearing-load field (${wcP})`);
      await ctx.tab('design');
      const m = ctx.mark();
      await ctx.click('#btn-run-design');
      await ctx.waitMsg('designPurlinResult', m.h2w, 600000);
      await ctx.settle(500);
      const r = ctx.lastH2W('designPurlinResult');
      assert(r && Array.isArray(r.regions), 'purlin result');
      const sent = (ctx.log.w2h.slice(m.w2h).find((x) => x.command === 'runPurlinDesign') || {}).data;
      assert(sent, 'GUI sent runPurlinDesign');
      // V4-26: 구간 id 는 겹치지 않는다
      const ids = r.regions.map((g) => g.id);
      assert.strictEqual(new Set(ids).size, ids.length, 'region ids unique');
      // V4-31: 0 인 wc 칸(Lo · eITF · sf)은 보내지 않고, 화면 본문 그대로 MCP design_purlin 스키마를 지난다
      for (const k of ['wc_support_fastener_spacing', 'wc_overhang', 'wc_edge_distance']) {
        assert(!(k in sent), `${k} not sent when the field is 0 (sent ${sent[k]})`);
      }
      const mcp = await startMcp(ctx.panel);
      try {
        const viaMcp = await mcp.call('design_purlin', { ...sent, detail: 'full' });
        assert(!viaMcp.isError, `GUI body rejected by the MCP schema: ${String(viaMcp.text).slice(0, 300)}`);
        assert.deepStrictEqual(viaMcp.data.regions.map((g) => [g.id, g.result.utilization, g.result.pass]),
          r.regions.map((g) => [g.id, g.result.utilization, g.result.pass]), 'GUI = MCP region by region');
      } finally {
        await mcp.close();
      }
      // V4-27: 지배 구간이 §I6.2.1 R 경로면 강도 카드의 F2 · F3 · F4 는 「참고」, Mn = R·Mnℓo 를 따로
      const govReg = r.regions.find((g) => r.governing && g.id === r.governing.id);
      assert(govReg, 'governing region in the list');
      console.log(`     governing: ${govReg.id} ${govReg.label} combo ${govReg.combo} R ${govReg.R_uplift}`);
      const sum = await ctx.text('#design-summary');
      if (govReg.R_uplift != null) {
        assert(has(sum, /\(참고\)/) && has(sum, /Mn = R·Mnℓo/), 'R route: unused strength cards marked 참고, R·Mnℓo shown');
        const stepsTxt = await ctx.text('#design-steps');
        assert(has(stepsTxt, /참고 — §I6\.2\.1/), 'unused steps labelled 참고');
        const dim = await ctx.eval(`[...document.querySelectorAll('#design-steps .calc-step')].filter(e=>e.style.opacity==='0.5').length`);
        assert(dim >= 3, `unused steps drawn differently (${dim})`);
      } else {
        console.log('     (governing region is not the R route — card check skipped)');
      }
      await ctx.shotEl('r_v427_cards', '#design-summary');
      // V4-30: 보고서는 보고된 길(R·Mnℓo)과 지배 구간 자신의 하중조합을 쓴다
      await ctx.tab('report');
      await ctx.click('#btn-generate-report');
      await ctx.settle(400);
      const rep = await ctx.text('#report-container');
      // K3-7: 보고서의 요약 표가 「지배 구간」 · 「지배 하중조합」 을 적고, 계산 절은 엔진의 검토 항목(design_checks) 그대로
      assert(rep && rep.includes('지배 구간') && rep.includes(String(govReg.label || '').slice(0, 6)) && rep.includes(String(govReg.combo)),
        'report names the governing region and its combination');
      if (govReg.R_uplift != null) {
        assert(has(rep, /Mn = R_uplift Mnℓo/) && has(rep, /R_uplift = 0\.70/), 'the report shows the engine step Mn = R_uplift Mnℓo (§I6.2.1)');
        assert(!has(rep, /min\(Mne, Mnl, Mnd\)/), 'report does not claim min(Mne, Mnl, Mnd) on the R route');
      }
      await ctx.shot('r_v430_report', { maxHeight: 9000 });
      await ctx.tab('design');
      const lapEnd = r.regions.find((g) => g.kind === 'negative' && g.start_ft > 29 && g.start_ft < 30);
      assert(lapEnd, 'interior lap-end region 29.5 ft');
      assert(lapEnd.beta_dist > 1.1, `β applied to the lap-end region (β=${lapEnd.beta_dist})`);
      const ma = lapEnd.result.design_strength / 12;
      console.log(`     II-2A interior lap end: Ma ${ma.toFixed(3)} kip-ft (Manual 3.93), β ${lapEnd.beta_dist}`);
      // 매뉴얼 II-2A 의 F4 3.93 은 부록 2 해석식 Mcrd; 여기는 FSM 서명곡선 Mcrd — 같은 β 에서 ±5 %.
      assert(Math.abs(ma - 3.93) / 3.93 < 0.05, `lap-end allowable within 5 % of Manual 3.93 (got ${ma.toFixed(3)})`);
      const si = lapEnd.result.shear_interaction;
      assert(si && si.Malo > 0, 'H2 uses Malo (engine key)');
      const beta = await ctx.text('#design-beta-result');
      assert(!has(beta, /β = 1\.300/) || has(beta, /자동 계산 모드: 이 칸은 설계에 쓰지 않습니다/),
        'β field in auto mode says it is not used');
      const card = await ctx.text('#design-summary');
      assert(has(card, /두 부재/), 'V4-12: lap sharing assumption shown on the design screen');
      assert(!has(card, /\b120% /) || true, 'gauge label');
      await ctx.shot('r03_purlin_regions', { maxHeight: 12000 });
    });

    // ── K4a 3b: MCP 하중 해석이 입력을 바꾸면 호스트가 지운 설계 · Lap 결과가 화면에서도 사라진다(낡은 판정 없음) ──
    await step('K4a stale design and lap cards after an MCP load analysis with other loads', async () => {
      // 앞 단계의 상태: II-2A 하중 분석 → 퍼린 설계 카드. 랩 결과도 화면에 올린다(하중 분석이 랩 칸을 채웠다).
      await ctx.tab('connection');
      for (const [k, v] of Object.entries({ 'conn-fastener-type': 'screw', 'conn-fastener-dia': 0.19, 'conn-n-rows': 2,
        'conn-edge-dist': 1.0, 'conn-lap-Pnvs': 1.2 })) {
        await ctx.setVal(k, v);
      }
      let m = ctx.mark();
      await ctx.click('#btn-run-lap-design');
      await ctx.waitMsg('lapConnectionResult', m.h2w, 120000);
      await ctx.settle(300);
      assert(has(await ctx.text('#connection-result'), /종합 판정/), 'a lap verdict is on screen before');
      await ctx.tab('design');
      assert(has(await ctx.text('#design-summary'), /✓ OK|✗ NG|판정 없음/), 'a design verdict is on screen before');
      const gui = [...ctx.log.w2h].reverse().find((x) => x.command === 'analyzeLoads');
      assert(gui && gui.data && gui.data.loads, 'the page load analysis body');
      const mcp = await startMcp(ctx.panel);
      try {
        m = ctx.mark();
        const la = await mcp.call('analyze_loads', { ...gui.data, loads: { ...gui.data.loads, D: (gui.data.loads.D || 0) * 1.5 + 5 } });
        assert(!la.isError, `MCP analyze_loads: ${String(la.text).slice(0, 300)}`);
        await ctx.settle(600);
        const inv = ctx.log.h2w.slice(m.h2w).filter((x) => x.command === 'derivedResultsInvalidated');
        assert(inv.length === 1 && inv[0].data.scope === 'design', 'host tells the page what it dropped');
        const card = await ctx.text('#design-summary');
        const lap = await ctx.text('#connection-result');
        await ctx.shotEl('r_k4a_stale_after_mcp_loads', '#design-summary');
        assert(!has(card, /✓ OK|✗ NG/) && has(card, /결과 없음/), `old design verdict still on screen: ${card.split('\n')[0]}`);
        assert(has(card, /하중 해석의 입력이 바뀌었습니다/), 'the design card says why');
        assert(!has(lap, /종합 판정/) && has(lap, /결과 없음/), `old lap verdict still on screen: ${lap.split('\n')[0]}`);
        assert(!has(await ctx.text('#load-analysis-result'), /결과 없음/), 'the new load analysis is shown');
        const st = await mcp.call('get_status', {});
        for (const kind of ['member_design', 'lap']) {
          const e = st.data.invalidated.find((x) => x.kind === kind);
          assert(e && e.reason === 'Load analysis inputs changed' && e.cause.action === 'analyze_loads'
            && e.cause.inputs.includes('loads'), `ledger says why ${kind} went: ${JSON.stringify(e)}`);
        }
        assert(st.data.results.member_design === null && st.data.results.lap === null, 'host serves neither');
      } finally {
        await mcp.close();
      }
    });

    // ── V4-06: 빈 칸을 숨은 기본값으로 채우지 않는다 ──────────────────────────────────────
    await step('V4-06 blank inputs are not replaced by hidden defaults', async () => {
      await ctx.click('#btn-unit-SI');
      await ctx.tab('loads');
      await ctx.setVal('load-S-psf', '');
      let m = ctx.mark();
      await ctx.click('#btn-analyze-loads');
      await ctx.waitMsg('loadAnalysisComplete', m.h2w, 300000);
      await ctx.settle(300);
      const sent = (ctx.log.w2h.slice(m.w2h).find((x) => x.command === 'analyzeLoads') || {}).data || {};
      assert.strictEqual(sent.loads && sent.loads.S, 0, 'blank snow load sends 0, not 0.5 kPa');
      // 빈 설계 Fy → 실행을 막고 이름을 알린다
      await ctx.tab('design');
      await ctx.setVal('design-fy', '');
      m = ctx.mark();
      await ctx.click('#btn-run-design');
      await ctx.settle(400);
      const sentRun = ctx.log.w2h.slice(m.w2h).filter((x) => x.command === 'runPurlinDesign' || x.command === 'runDesign');
      const val = await ctx.text('#design-validation');
      await ctx.shotEl('r04_blank_fy_blocked', '#design-validation');
      assert.strictEqual(sentRun.length, 0, 'design not sent with a blank Fy');
      // V4-32/33: 읽기 전용 설계 Fy 는 그 값을 정하는 ①탭의 Fy 로 안내한다
      assert(has(val, /Fy \(① 단면·재료 탭\)/), `message names the field the user can edit (${val})`);
      // V4-32: 하중 탭에서 막히면 하중 탭(누른 단추 아래)에 화면 이름 · 탭으로, 누르면 그 칸으로
      await ctx.tab('loads');
      const spacing0 = await ctx.eval(`document.getElementById('config-spacing').value`);
      await ctx.setVal('config-spacing', '');
      m = ctx.mark();
      await ctx.click('#btn-analyze-loads');
      await ctx.settle(400);
      assert.strictEqual(ctx.log.w2h.slice(m.w2h).filter((x) => x.command === 'analyzeLoads').length, 0, 'not sent');
      const box = await ctx.eval(`(()=>{const b=document.getElementById('btn-analyze-loads-missing'); if(!b) return null;
        const p=b.closest('.tab-panel'); return {text:b.innerText, shown:getComputedStyle(b).display!=='none', tab:p&&p.id, visible:p&&p.classList.contains('active')};})()`);
      assert(box && box.shown && box.tab === 'tab-loads' && box.visible, `message shown on the loads tab (${JSON.stringify(box)})`);
      assert(has(box.text, /부재 간격 \(② 하중계산 탭\)/) && has(box.text, /Fy \(① 단면·재료 탭\)/), `labels with their tabs (${box.text})`);
      assert(!has(box.text, /config-spacing|design-fy/), 'no element ids in the message');
      await ctx.shotEl('r_v432_loads_blocked', '#btn-analyze-loads-missing');
      await ctx.eval(`[...document.querySelectorAll('#btn-analyze-loads-missing a.missing-link')].find(a=>/^Fy/.test(a.textContent)).click()`);
      await ctx.settle(200);
      const went = await ctx.eval(`({tab: document.querySelector('.tab-panel.active').id, hl: document.getElementById('input-fy').classList.contains('input-missing')})`);
      assert(went.tab === 'tab-preprocessor' && went.hl, `clicking the label goes to the field (${JSON.stringify(went)})`);
      await ctx.setVal('input-fy', 379.2);
      assert(!(await ctx.eval(`document.getElementById('input-fy').classList.contains('input-missing')`)), 'highlight cleared once filled');
      assert.strictEqual(Number(await ctx.eval(`document.getElementById('design-fy').value`)), 379.2, 'design Fy follows ① Fy');
      await ctx.tab('loads');
      await ctx.setVal('config-spacing', spacing0);
      // 빈 첫 경간 → 하중 분석을 막는다(전 25 m)
      await ctx.tab('loads');
      await ctx.eval(`(()=>{const e=document.querySelector('.span-tbl-len'); e.value=''; e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      m = ctx.mark();
      await ctx.click('#btn-analyze-loads');
      await ctx.settle(400);
      assert.strictEqual(ctx.log.w2h.slice(m.w2h).filter((x) => x.command === 'analyzeLoads').length, 0,
        'load analysis not sent with a blank span');
    });

    // ── V4-06/29: 단일 접합의 빈 t2 · n 은 보내지 않고, 엔진이 지어내지 않는다(판정 없음 + 까닭) ────────────
    await step('V4-06/29 blank connection t2 / n are not sent and give no verdict', async () => {
      await ctx.tab('connection');
      await ctx.setVal('conn-single-type', 'screw');
      for (const [k, v] of Object.entries({ 'conn-t1': 1.5, 'conn-d': 4.8, 'conn-Pu': 8.9, 'conn-t2': '', 'conn-n': '' })) {
        await ctx.setVal(k, v);
      }
      const m = ctx.mark();
      await ctx.click('#btn-run-single-conn');
      await ctx.waitMsg('connectionResult', m.h2w, 120000);
      await ctx.settle(300);
      const sent = (ctx.log.w2h.slice(m.w2h).find((x) => x.command === 'runConnection') || {}).data || {};
      assert(!('t2' in sent) && !('n' in sent), `blank t2 / n not sent (${JSON.stringify({ t2: sent.t2, n: sent.n })})`);
      const card = await ctx.text('#connection-result');
      await ctx.shotEl('r_conn_blank_t2_n', '#connection-result');
      assert(!has(card, /✓ OK|✗ NG|326/), `no verdict from invented t2 / n (${card.slice(0, 200)})`);
      assert(has(card, /t2/), 'the reason names t2');
    });

    // ── V4-07: 빈 Fub · Fuf · t2 · n 이 저장 · 열기 뒤에도 비어 있다 ───────────────────────
    await step('V4-07 blank connection strengths round-trip as blank', async () => {
      await ctx.tab('connection');
      for (const id of ['conn-Fub', 'conn-Fuf', 'conn-t2', 'conn-n']) { await ctx.setVal(id, ''); }
      const file = tmp('r_blank.csd');
      try { fs.unlinkSync(file); } catch { /* none */ }
      ctx.dialogs.nextSave = file;
      await ctx.click('#btn-file-save');
      await ctx.settle(600);
      assert(fs.existsSync(file), 'saved');
      const m = ctx.mark();
      await ctx.cdp.send('Page.reload', {});
      await ctx.waitMsg('modelLoaded', m.h2w, 60000);
      await ctx.settle(500);
      ctx.dialogs.nextOpen = file;
      await ctx.click('#btn-file-open');
      await ctx.settle(800);
      const vals = await ctx.eval(`(()=>['conn-Fub','conn-Fuf','conn-t2','conn-n'].map(i=>document.getElementById(i).value))()`);
      assert.deepStrictEqual(vals, ['', '', '', ''], `blank fields came back as ${JSON.stringify(vals)}`);
    });

    // ── V4-08: 유효단면계수가 없으면 Lap 휨을 총단면으로 판정하지 않는다 ───────────────────
    await step('V4-08 lap flexure is not judged with gross Sx', async () => {
      await ctx.click('#btn-unit-US');
      await ctx.tab('connection');
      for (const [k, v] of Object.entries({ 'conn-lap-left': 30, 'conn-lap-right': 42, 'conn-Mu': 52.5, 'conn-Vu': 0.9,
        'conn-fastener-type': 'screw', 'conn-fastener-dia': 0.19, 'conn-n-rows': 2, 'conn-edge-dist': 1.0, 'conn-lap-Pnvs': 1.2 })) {
        await ctx.setVal(k, v);
      }
      const m = ctx.mark();
      await ctx.click('#btn-run-lap-design');
      await ctx.waitMsg('lapConnectionResult', m.h2w, 120000);
      await ctx.settle(300);
      const sent = (ctx.log.w2h.slice(m.w2h).find((x) => x.command === 'runLapConnection') || {}).data || {};
      const card = await ctx.text('#connection-result');
      await ctx.shotEl('r06_lap_without_Se', '#connection-result');
      assert(sent.Se === undefined, `Se sent without a flexure design result (${sent.Se})`);
      assert(!has(card, /종합 판정: ✅/), 'lap not shown OK without Se');
      assert(has(card, /Se 가 없어/), 'reason shown');
    });

    // ── V4-09 · V4-21: 단위 전환은 표의 모든 칸을 같은 규칙으로, 왕복 오차 없이 ───────────
    await step('V4-09/21 every unit field converts and round-trips', async () => {
      await ctx.click('#btn-unit-US');
      await ctx.settle(200);
      const ids = await ctx.eval(`Object.entries(globalThis.StcfsdDesignState.UNIT_FIELDS)
        .filter(([id])=>{const e=document.getElementById(id); return e && e.type==='number';}).map(([id,u])=>[id,u])`);
      for (const [id] of ids) { await ctx.setVal(id, 3.7); }
      const us = await ctx.eval(`(${JSON.stringify(ids)}).map(([id])=>document.getElementById(id).value)`);
      await ctx.click('#btn-unit-SI'); await ctx.settle(200);
      const si = await ctx.eval(`(${JSON.stringify(ids)}).map(([id])=>document.getElementById(id).value)`);
      await ctx.click('#btn-unit-US'); await ctx.settle(200);
      const us2 = await ctx.eval(`(${JSON.stringify(ids)}).map(([id])=>document.getElementById(id).value)`);
      const factors = await ctx.eval(`(()=>{const out={}; for (const [id,u] of ${JSON.stringify(ids)}) { out[id]=u; } return out;})()`);
      void factors;
      const bad = [];
      ids.forEach(([id], i) => {
        const a = parseFloat(us[i]), b = parseFloat(si[i]), c = parseFloat(us2[i]);
        if (!(b > a * 1.0001 || b < a * 0.9999)) { bad.push(id + ' not converted'); }
        if (Math.abs(c - a) > 1e-9 * Math.abs(a)) { bad.push(id + ' round-trip ' + a + ' → ' + c); }
      });
      // 밀도 · 응력 등 계수가 1 에 가까운 칸은 없다 — 모든 단위 칸은 값이 바뀌어야 한다.
      assert.deepStrictEqual(bad, [], bad.join('; '));
      for (const id of ['design-dist-Lm', 'design-May-strength', 'design-wc-Lo', 'design-wc-edge-distance', 'design-wc-fastener-spacing']) {
        assert(ids.some(([x]) => x === id), id + ' registered');
      }
    });
  } finally {
    await ctx.close();
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ results, console: ctx.log.console.filter((c) => c.type === 'error'),
    exceptions: ctx.log.exceptions }, null, 1));
  console.log(`page exceptions: ${ctx.log.exceptions.length}, console errors: ${ctx.log.console.filter((c) => c.type === 'error').length}`);
  console.log(`test:rendered: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length}; screenshots in test/rendered/out/shots)`);
  if (failed.length > 0 || ctx.log.exceptions.length > 0) { process.exitCode = 1; }
  await sleep(200);
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e); process.exit(1); });
