/* global process */
// K2 0단계 — 「검토 대상의 상태를 호스트로」 구현 전에 지금 동작을 고정하는 렌더 시험(opt-in).
//   npm run test:k2            (Edge 또는 Chrome, .venv 파이썬이 있어야 한다 — 없으면 SKIP 한 줄)
//   node test/rendered/k2/run.js --record           고정값을 전부 지금 값으로 다시 쓴다
//   node test/rendered/k2/run.js --accept=id1,id2   그 항목만 지금 값으로(K2 가 일부러 바꾼 'k2-change' 를 받아들일 때)
//   node test/rendered/k2/run.js --only=gui,csd     묶음만(gui · mcp · csd · example · reload · defaults)
// 진짜 호스트 · 파이썬 · 웹뷰(헤드리스 Edge, 보이지 않음 · 포커스 없음). 묶음마다 새로 띄운다(서로의 상태가 섞이지 않게).
// 고정값: test/rendered/k2/golden/*.json · 그림 · 임시 파일: test/rendered/out/k2/ (git 밖).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { findBrowser } = require('../lib');
const { pythonPath } = require('../../webview/panel_harness');
const K = require('./k2lib');
const V = require('./values');

const ARGV = process.argv.slice(2);
const ONLY = new Set((ARGV.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean));
const want = (g) => ONLY.size === 0 || ONLY.has(g);

const results = [];
const goldens = [];
const exceptions = [];
const KSI_MPA = 4448.2216152605 / (25.4 * 25.4);

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

/** 세션 하나를 띄우고 fn(ctx) 를 돌린 뒤 반드시 닫는다(브라우저 · 파이썬 · 다리 · MCP). */
async function withSession(name, fn) {
  const ctx = await K.session(name);
  let m = null;
  try {
    await fn(ctx, async () => { m = m || await K.mcp(ctx); return m; });
    await caseInvariant(ctx, name);
  } finally {
    if (m) { await m.close(); }
    exceptions.push(...ctx.log.exceptions.map((x) => ({ session: name, ...x })));
    await ctx.close();
  }
}

/**
 * K2 불변식(구현 단계마다): ① 호스트의 검토 상태(+ 초안) = 화면의 칸(collectDesignInputs) ② 그림자 대조 — 화면이 보낸 엔진 본문 =
 * 호스트가 상태로 만든 본문(바이트까지) ③ 화면의 처음 값 = 표의 처음 값. 어긋나면 caseProblems 에 — 실행이 실패한다.
 */
const caseProblems = [];
async function caseInvariant(ctx, name) {
  if (typeof ctx.panel.__testGetCase !== 'function') { return; }
  await K.sleep(450);            // 화면의 글자 칸 모으기(300 ms)가 끝나게
  await ctx.settle(200);
  const c = ctx.panel.__testGetCase();
  const page = await ctx.eval(`(()=>{const ds=globalThis.StcfsdDesignState; const si=document.getElementById('btn-unit-SI').classList.contains('active');
    return ds.collectDesignInputs({document, fromDisplay:(v,u)=> si ? ds.siToUs(v,u) : v, getUnitSystem:()=> si?'SI':'US'});})()`);
  const host = c.designInputs;
  const diff = Object.keys(page).filter((k) => JSON.stringify(page[k]) !== JSON.stringify(host[k]));
  if (diff.length) { caseProblems.push(`${name}: host state ≠ page fields: ${diff.map((k) => `${k} host ${JSON.stringify(host[k])} page ${JSON.stringify(page[k])}`).join('; ').slice(0, 900)}`); }
  for (const x of c.shadow.filter((y) => !y.same)) {
    // 다른 키만 보인다(요청이 길다)
    let keys = '';
    try {
      const pg = JSON.parse(x.page); const ho = JSON.parse(x.host);
      keys = [...new Set([...Object.keys(pg), ...Object.keys(ho)])].filter((k) => JSON.stringify(pg[k]) !== JSON.stringify(ho[k]))
        .map((k) => `${k}: page ${JSON.stringify(pg[k])} host ${JSON.stringify(ho[k])}`).join('; ');
    } catch (e) { keys = String(e); }
    caseProblems.push(`${name}: shadow ${x.what}: ${keys.slice(0, 900)}`);
  }
  if (c.helloMismatch && c.helloMismatch.length) { caseProblems.push(`${name}: initial values ≠ table: ${c.helloMismatch.join('; ')}`); }
  caseChecked.push({ name, shadow: c.shadow.length, rev: c.state.rev });
}
const caseChecked = [];

function golden(name) { const g = new K.Golden(name); goldens.push(g); return g; }

const RESULT_BOXES = ['design-summary', 'design-steps', 'design-interaction', 'dsm-table-container', 'analysis-warnings'];
const LOAD_BOXES = ['load-analysis-result'];
const CONN_BOXES = ['connection-result'];

/** 화면 조작 하나 → 그동안의 엔진 요청과(있으면) 보이는 결과를 고정값으로. */
/** 엔진 요청이 멈출 때까지 기다린다 — 화면이 모델을 받고 다시 묻는 단면 성질(get_properties)이 잡는 창 밖으로 새지 않게. */
async function engineQuiet(ctx) {
  let n = -1;
  for (let i = 0; i < 12 && n !== ctx.engine.length; i++) { n = ctx.engine.length; await K.sleep(400); await ctx.settle(200); }
}

async function pinStep(ctx, g, id, fn, opts = {}) {
  const e0 = ctx.engineMark();
  await fn();
  await ctx.settle(300);
  await engineQuiet(ctx);
  const reqs = ctx.engineSince(e0);
  g.check(`${id}.engine`, reqs, { expect: opts.expect, reason: opts.reason });
  if (opts.texts) { g.check(`${id}.shown`, await K.shownText(ctx, opts.texts), { expect: opts.textExpect || 'pin', reason: opts.textReason }); }
  return reqs;
}

/** MCP 도구 한 번 → 엔진 요청 · 화면 입력 칸의 변화 · 보이는 결과. */
async function pinMcp(ctx, client, g, id, tool, args, opts = {}) {
  const before = await K.snapshotInputs(ctx);
  const e0 = ctx.engineMark();
  const r = await client.call(tool, args);
  await ctx.settle(400);
  await engineQuiet(ctx);
  const reqs = ctx.engineSince(e0);
  const after = await K.snapshotInputs(ctx);
  assert(!r.isError, `${tool} failed: ${String(r.text).slice(0, 300)}`);
  g.check(`${id}.engine`, reqs, { expect: 'pin' });
  g.check(`${id}.inputsChanged`, K.diffInputs(before, after), { expect: opts.inputsExpect || 'pin', reason: opts.inputsReason });
  if (opts.texts) { g.check(`${id}.shown`, await K.shownText(ctx, opts.texts), { expect: 'pin' }); }
  return r;
}

async function ii2aGui(ctx) {
  const S = ctx.setVal.bind(ctx);
  await ctx.click('#btn-unit-US');
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
  for (const [k, v] of Object.entries({ 'load-D-psf': 3, 'load-Lr-psf': 20, 'load-S-psf': 0, 'load-Wu-psf': 34, 'load-Wp-psf': 0, 'load-L-psf': 0 })) {
    await S(k, v);
  }
  await S('chk-pattern-loading', false);
  await S('chk-lr-reduced', false);
  await S('chk-i621-confirmed', true);
  // 계약 §6.3: II-2A 는 랩 구속을 가정으로 밝힌다(Design Manual) — 사람의 진술
  await S('chk-lap-restrained', true);
  await S('span-Ix-list', '9.18, 9.18, 7.76, 7.76, 9.18, 9.18');
}

/** II-2A 와 같은 퍼린 입력(MCP design_purlin · analyze_loads 인자, US) */
const II2A_MCP = {
  member_app: 'roof-purlin', span_type: 'cont-6', span_ft: 25, spans_ft: [1, 25, 25, 25, 25, 1],
  supports: ['N', 'P', 'P', 'P', 'P', 'P', 'N'],
  laps_per_support: [{ left_ft: 0, right_ft: 0 }, { left_ft: 0, right_ft: 0 }, { left_ft: 2.5, right_ft: 3.5 }, { left_ft: 1, right_ft: 1 },
    { left_ft: 3.5, right_ft: 2.5 }, { left_ft: 0, right_ft: 0 }, { left_ft: 0, right_ft: 0 }],
  spacing_ft: 5, loads: { D: 15, Lr: 100, S: 0, W: -170, Wp: 0, L: 0 }, design_method: 'ASD',
  laps: { left_ft: 3.5, right_ft: 3.5 }, deck: { type: 'through-fastened', kphi_override: 0.3 },
  pattern_loading: false, lr_reduced: false, i621_conditions_confirmed: true, I_span_in4: [9.18, 9.18, 7.76, 7.76, 9.18, 9.18],
};

// ═════════════════════════════════════════════════════════════════════════════
async function phaseDefaults() {
  const g = golden('defaults');
  await withSession('defaults', async (ctx) => {
    await step('defaults: every input on a fresh start (SI, then US) and the controls of the page', async () => {
      const walk = await ctx.eval(`(()=>{
        const clean=(t)=>String(t||'').replace(/[▾▸▼▶]/g,'').replace(/\\s+/g,' ').trim();
        const hdrText=(e)=>{const c=e.cloneNode(true); c.querySelectorAll('button,span.hint-inline,.hint-inline').forEach(x=>x.remove()); return clean(c.textContent);};
        const all=[...document.querySelectorAll('h2,h3,h4,.conn-collapsible,input,select,textarea,button.tab-btn')];
        let hdr=null; const out=[];
        for (const e of all) {
          if (e.matches('h2,h3,h4,.conn-collapsible')) { hdr=hdrText(e); continue; }
          if (e.matches('button')) { continue; }
          // 절점 · 요소 표의 칸(data-row)은 단면 모델 — 이미 호스트의 모델이 가진다(K2 밖). 수만 센다.
          if (e.dataset && e.dataset.row !== undefined) { out.sectionTableInputs = (out.sectionTableInputs||0)+1; continue; }
          const tab=e.closest('.tab-panel'); const tabId= tab? tab.id : '(top bar)';
          let label='';
          const wrap=e.closest('label');
          if (wrap) { const c=wrap.cloneNode(true); c.querySelectorAll('input,select').forEach(x=>x.remove()); label=clean(c.textContent); }
          if (!label) { let p=e.previousElementSibling; while (p && p.tagName!=='LABEL' && !(p.tagName==='SPAN' && !p.classList.contains('hint-inline'))) { p=p.previousElementSibling; } if (p) { label=clean(p.textContent); } }
          if (!label && e.id) { const l=document.querySelector('label[for="'+e.id+'"]'); if (l) { label=clean(l.textContent); } }
          let unitHint=''; const n=e.nextElementSibling; if (n && n.tagName==='SPAN') { unitHint=clean(n.textContent).slice(0,80); }
          let hidden=false; for (let a=e; a && a!==tab; a=a.parentElement) { if (a.style && a.style.display==='none') { hidden=true; break; } }
          out.push({ id: e.id || null, cls: e.id ? null : (e.className||null), dataIdx: e.dataset ? (e.dataset.idx ?? null) : null,
            tag: e.tagName.toLowerCase(), type: e.type || null, tab: tabId, group: hdr, label, unitHint, title: e.title || null,
            readOnly: !!e.readOnly, disabled: !!e.disabled, initiallyHidden: hidden, dataUnit: e.getAttribute('data-unit'),
            min: e.getAttribute('min'), max: e.getAttribute('max'), step: e.getAttribute('step'), placeholder: e.getAttribute('placeholder'),
            htmlValue: e.tagName==='INPUT' ? e.getAttribute('value') : null, htmlChecked: e.type==='checkbox' ? e.hasAttribute('checked') : null,
            options: e.tagName==='SELECT' ? [...e.options].map(o=>({value:o.value, text:clean(o.textContent), selected:o.defaultSelected,
              fy:o.dataset.fy?Number(o.dataset.fy):undefined, fu:o.dataset.fu?Number(o.dataset.fu):undefined, span:o.dataset.span})) : null,
            valueSI: e.type==='checkbox' ? e.checked : e.value });
        }
        return { controls: out, sectionTableInputs: out.sectionTableInputs || 0 }; })()`);
      const sectionTableInputs = walk.sectionTableInputs;
      const controls = walk.controls;
      await ctx.click('#btn-unit-US');
      await ctx.settle(200);
      const us = await ctx.eval(`(()=>{const o=[]; document.querySelectorAll('input,select,textarea').forEach((e)=>{ if (e.dataset && e.dataset.row !== undefined) { return; }
        o.push(e.type==='checkbox'? e.checked : e.value);}); return o;})()`);
      assert.strictEqual(us.length, controls.length, 'same controls in US');
      controls.forEach((c, i) => { c.valueUS = us[i]; });
      const initialUS = await ctx.eval(`globalThis.StcfsdDesignState.collectDesignInputs({document, fromDisplay:(v)=>v, getUnitSystem:()=>'US'})`);
      fs.mkdirSync(K.OUT, { recursive: true });
      fs.writeFileSync(path.join(K.OUT, 'dom_controls.json'), JSON.stringify({ controls, sectionTableInputs, initialUS }, null, 1));
      const model = ctx.panel.__testGetState().model;
      g.check('controls.values', controls.map((c) => [c.id || `${c.cls}[${c.dataIdx}]`, c.tab, c.valueSI, c.valueUS]), { expect: 'pin' });
      g.check('initialInputs.US', initialUS, { expect: 'pin' });
      g.check('hostModel.initial', { BC: model.BC, nlengths: model.nlengths, loadCase: model.loadCase, loadFy_ksi: model.loadFy, sectionType: model.sectionType },
        { expect: 'pin' });
      // 시험이 쓰는 「처음 값과 다른」 값이 정말 처음 값과 다른가
      const same = Object.entries(V.NON_DEFAULT).filter(([k, v]) => JSON.stringify(initialUS[k]) === JSON.stringify(v)).map(([k]) => k);
      assert.deepStrictEqual(same, [], `values.js entries equal to the initial value: ${same.join(', ')}`);
      const dsKeys = await ctx.eval('globalThis.StcfsdDesignState.FIELDS.map(f=>f[0])');
      const missing = dsKeys.filter((k) => !(k in V.NON_DEFAULT));
      assert.deepStrictEqual(missing, [], `values.js has no non-default value for ${missing.join(', ')}`);
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
async function phaseGui() {
  await withSession('gui-column', async (ctx) => {
    const g = golden('gui-column');
    await step('gui column (SI, default section C 100×50×20×2.3, compression)', async () => {
      await ctx.tab('loads');
      await ctx.setVal('select-member-type', 'compression');
      await pinStep(ctx, g, 'analysis', () => K.runAnalysisGui(ctx), { texts: ['dsm-table-container', 'analysis-warnings'] });
      await ctx.tab('design');
      for (const [k, v] of Object.entries({ 'design-KxLx': 2500, 'design-KyLy': 2500, 'design-KtLt': 2500, 'design-P': 20 })) { await ctx.setVal(k, v); }
      await pinStep(ctx, g, 'design', () => K.clickAndWait(ctx, '#btn-run-design', 'designResult'), { texts: RESULT_BOXES });
    });
  });

  await withSession('gui-beam', async (ctx) => {
    const g = golden('gui-beam');
    await step('gui beam (US, lipped C 8×2.5×0.625×0.059, flexure + web crippling)', async () => {
      await ctx.click('#btn-unit-US');
      await pinStep(ctx, g, 'template', () => K.genTemplate(ctx, 'lippedc', { 'tpl-H': 8, 'tpl-B': 2.5, 'tpl-D': 0.625, 'tpl-t': 0.059, 'tpl-r': 0.1 }));
      await ctx.tab('design');
      await ctx.setVal('select-load-case', 'bending_xx_pos');
      await pinStep(ctx, g, 'analysis', () => K.runAnalysisGui(ctx), { texts: ['dsm-table-container'] });
      await ctx.tab('loads');
      await ctx.setVal('select-member-type', 'flexure');
      await ctx.tab('design');
      for (const [k, v] of Object.entries({ 'design-Mx': 40, 'design-V': 1, 'design-Lb': 60, 'design-Cb': 1.0, 'design-P': 0,
        'design-wc-N': 3.5, 'design-wc-R': 0.1875 })) { await ctx.setVal(k, v); }
      await pinStep(ctx, g, 'design', () => K.clickAndWait(ctx, '#btn-run-design', 'designResult'), { texts: RESULT_BOXES });
    });
  });

  await withSession('gui-purlin', async (ctx) => {
    const g = golden('gui-purlin');
    await step('gui purlin II-2A (US, Z 8×2.25 · 6 spans · laps · through-fastened deck) + lap', async () => {
      await ii2aGui(ctx);
      await pinStep(ctx, g, 'loads', () => K.clickAndWait(ctx, '#btn-analyze-loads', 'loadAnalysisComplete'), { texts: LOAD_BOXES });
      g.check('loads.autofilled', await K.snapshotInputs(ctx), { expect: 'pin' });
      await ctx.tab('design');
      await pinStep(ctx, g, 'design', () => K.clickAndWait(ctx, '#btn-run-design', 'designPurlinResult', 900000),
        { texts: ['design-summary', 'design-steps'] });
      await ctx.tab('connection');
      for (const [k, v] of Object.entries({ 'conn-fastener-type': 'screw', 'conn-fastener-dia': 0.19, 'conn-n-rows': 2, 'conn-edge-dist': 1.0, 'conn-lap-Pnvs': 1.2 })) {
        await ctx.setVal(k, v);
      }
      await pinStep(ctx, g, 'lap', () => K.clickAndWait(ctx, '#btn-run-lap-design', 'lapConnectionResult'), { texts: CONN_BOXES });
      // 저장 → 다시 열기: 하중 해석이 채운 칸과 사용자 칸이 그대로인가(지금 동작)
      const f = path.join(K.OUT, 'csd', 'gui-purlin.csd');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      try { fs.unlinkSync(f); } catch { /* */ }
      ctx.dialogs.nextSave = f;
      await ctx.click('#btn-file-save');
      await ctx.settle(800);
      const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
      g.check('save.designInputs', saved.designInputs, { expect: 'pin' });
      g.check('save.has', { lapResult: !!saved.lapResult, designResult: !!saved.designResult, loadAnalysis: !!saved.loadAnalysis }, { expect: 'pin' });
      // 양력 지배(Lr 0): 하중 해석이 §I6.2.1 R 을 직접 입력 칸(chk-r-factor · select-r-value)에 채우는가
      await ctx.tab('loads');
      await ctx.setVal('load-Lr-psf', 0);
      await pinStep(ctx, g, 'loadsUplift', () => K.clickAndWait(ctx, '#btn-analyze-loads', 'loadAnalysisComplete'));
      const rf = await ctx.eval(`(()=>{const s=document.getElementById('select-r-value'); const o=s.selectedIndex>=0? s.options[s.selectedIndex]:null;
        return {checked: document.getElementById('chk-r-factor').checked, value: s.value, selectedIndex: s.selectedIndex, span: o? o.getAttribute('data-span'): null};})()`);
      g.check('loadsUplift.rField', rf, { expect: 'defect',
        reason: 'D-2: the load analysis writes String(uplift_R) ("0.7") into a select whose values are "0.70"/"0.60"… — no option matches, so the direct-input R is lost' });
    });
  });

  await withSession('gui-connection', async (ctx) => {
    const g = golden('gui-connection');
    await step('gui single connections (SI): screw, bolt', async () => {
      await ctx.tab('connection');
      for (const [k, v] of Object.entries({ 'conn-single-type': 'screw', 'conn-t1': 1.5, 'conn-t2': 1.5, 'conn-d': 4.8, 'conn-n': 4, 'conn-Pu': 8.9,
        'conn-Pnvs': 5.3, 'conn-e': 15, 'conn-s': 25 })) { await ctx.setVal(k, v); }
      await pinStep(ctx, g, 'screw', () => K.clickAndWait(ctx, '#btn-run-single-conn', 'connectionResult'), { texts: CONN_BOXES });
      for (const [k, v] of Object.entries({ 'conn-single-type': 'bolt', 'conn-t1': 2.3, 'conn-t2': 2.3, 'conn-d': 12, 'conn-n': 2, 'conn-Pu': 10,
        'conn-Fub': 414, 'conn-e': 25, 'conn-s': 40 })) { await ctx.setVal(k, v); }
      await pinStep(ctx, g, 'bolt', () => K.clickAndWait(ctx, '#btn-run-single-conn', 'connectionResult'), { texts: CONN_BOXES });
      // 접합부 탭의 칸을 바꿔도 결과가 「낡음」 이 되지 않는다(다른 탭과 달리 change 청취기가 없다)
      const m = ctx.mark();
      const card0 = (await K.shownText(ctx, CONN_BOXES))['connection-result'];
      await ctx.setVal('conn-t1', 1.2);
      await ctx.setVal('conn-n', 1);
      await ctx.settle(300);
      const card1 = (await K.shownText(ctx, CONN_BOXES))['connection-result'];
      g.check('editAfterResult', { invalidateSent: ctx.since(m).w2h.includes('invalidateDerivedResults'), cardUnchanged: card0 === card1 }, { expect: 'defect',
        reason: 'D-4: tab-connection has no change listener — after t1 / n change the old connection (and lap) verdict stays on screen as if current' });
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
const K2_INPUTS = 'K2: a design condition set through MCP must show in the edit-state input fields (acceptance criterion 1)';
const K2_GUI = 'K2: pressing the page button must use the case state — what MCP set — not the stale page fields (acceptance criterion 2)';

async function phaseMcp() {
  await withSession('mcp-column', async (ctx, getMcp) => {
    const g = golden('mcp-column');
    await step('mcp column: template, load case fy 50, run_analysis, aisi_design_compression; then the page buttons', async () => {
      const c = await getMcp();
      await pinMcp(ctx, c, g, 'set_section_template', 'set_section_template', { type: 'lippedc', H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 });
      await pinMcp(ctx, c, g, 'set_load_case', 'set_load_case', { load_case: 'compression', fy: 50 }, {
        inputsExpect: 'k2-change', inputsReason: 'K2: the reference stress fy = 50 ksi set through MCP is not shown in the Fy field (input-fy keeps 295 MPa)' });
      await pinMcp(ctx, c, g, 'run_analysis', 'run_analysis', {}, { texts: ['dsm-table-container'] });
      await pinMcp(ctx, c, g, 'aisi_design_compression', 'aisi_design_compression',
        { design_method: 'LRFD', Fy: 50, Fu: 65, KxLx: 96, KyLy: 48, KtLt: 48, Pu: 4 },
        { inputsExpect: 'k2-change', inputsReason: K2_INPUTS + ' — member type compression, Fy 50, KxLx 96, KyLy 48, KtLt 48, Pu 4 do not reach the page', texts: ['design-summary'] });
      // 사용자가 화면에서 「해석 실행」: 화면의 Fy(295 MPa = 42.79 ksi)로 응력을 다시 만든다 — MCP 의 50 ksi 가 사라진다
      await pinStep(ctx, g, 'gui.runAnalysis', () => K.runAnalysisGui(ctx), {
        expect: 'k2-change', reason: K2_GUI + ' — the GUI run rebuilds the stress with the page Fy (42.79 ksi), not the MCP reference stress 50 ksi' });
      g.check('gui.runAnalysis.hostLoadFy_ksi', ctx.panel.__testGetState().model.loadFy, { expect: 'k2-change', reason: 'K2: host reference stress after the GUI run (was 50 from MCP)' });
      // 「설계 검토 실행」: 화면의 부재 유형(처음 값 roof-purlin — 자동 계산)으로 화면의 하중 · 경간 처음 값 퍼린 설계가 돈다
      await ctx.tab('design');
      // K2-5: 결과 메시지는 그때의 부재 유형에 따라(전: 퍼린 — designPurlinResult, K2 뒤: MCP 가 정한 압축 — designResult)
      await pinStep(ctx, g, 'gui.runDesign', () => K.clickAndWait(ctx, '#btn-run-design', ['designPurlinResult', 'designResult'], 900000), {
        expect: 'k2-change', reason: K2_GUI + ' — the page runs a roof-purlin load-analysis design with the page defaults instead of the compression check MCP set',
        texts: ['design-summary'], textExpect: 'k2-change', textReason: 'K2: the card then shows a purlin result for conditions nobody set' });
    });
  });

  await withSession('mcp-beam', async (ctx, getMcp) => {
    const g = golden('mcp-beam');
    await step('mcp beam: user picked flexure on the page; MCP flexure with Lb 96 · Cb 1.14 · Mu 40; then the page design and save', async () => {
      const c = await getMcp();
      await ctx.click('#btn-unit-US');
      await ctx.tab('loads');
      await ctx.setVal('select-member-type', 'flexure');
      await pinMcp(ctx, c, g, 'set_section_template', 'set_section_template', { type: 'lippedc', H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 });
      await pinMcp(ctx, c, g, 'set_load_case', 'set_load_case', { load_case: 'bending_xx_pos', fy: 50 }, {
        inputsExpect: 'k2-change', inputsReason: 'K2: the reference stress fy = 50 ksi set through MCP is not shown in the Fy field' });
      await pinMcp(ctx, c, g, 'run_analysis', 'run_analysis', {});
      await pinMcp(ctx, c, g, 'aisi_design_flexure', 'aisi_design_flexure',
        { design_method: 'LRFD', Fy: 50, Fu: 65, Lb: 96, Cb: 1.14, Mu: 40, Vu: 1, wc_N: 3.5, wc_R: 0.1875 },
        { inputsExpect: 'k2-change', inputsReason: K2_INPUTS + ' — Lb 96, Cb 1.14, Mu 40, Vu 1, wc_N 3.5, wc_R 0.1875 do not reach the page', texts: ['design-summary'] });
      await ctx.tab('design');
      await pinStep(ctx, g, 'gui.runDesign', () => K.clickAndWait(ctx, '#btn-run-design', ['designResult', 'designPurlinResult']), {
        expect: 'k2-change', reason: K2_GUI + ' — the GUI design sends the page Lb 118.11 in · Cb 1 · Mu 0 · Fy 42.79, not what MCP set',
        texts: ['design-summary'], textExpect: 'k2-change', textReason: 'K2: the card then shows the page-field result' });
      const f = path.join(K.OUT, 'csd', 'mcp-beam.csd');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      try { fs.unlinkSync(f); } catch { /* */ }
      ctx.dialogs.nextSave = f;
      await ctx.click('#btn-file-save');
      await ctx.settle(800);
      const di = JSON.parse(fs.readFileSync(f, 'utf8')).designInputs;
      g.check('save.designInputs.subset', { memberType: di.memberType, fy: di.fy, Lb: di.Lb, Cb: di.Cb, Mux: di.Mux, Vu: di.Vu, wcN: di.wcN, wcR: di.wcR, unitSystem: di.unitSystem },
        { expect: 'k2-change', reason: 'K2: .csd save collects the page fields — the design conditions MCP set are not saved' });
    });
  });

  await withSession('mcp-purlin', async (ctx, getMcp) => {
    const g = golden('mcp-purlin');
    await step('mcp purlin: analyze_loads, design_purlin (II-2A); then the page design', async () => {
      const c = await getMcp();
      await pinMcp(ctx, c, g, 'set_section_template', 'set_section_template', { type: 'lippedz', H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 });
      await pinMcp(ctx, c, g, 'analyze_loads', 'analyze_loads', { ...II2A_MCP, Fy: 55, Fu: 70 }, {
        inputsExpect: 'k2-change', inputsReason: K2_INPUTS + ' — spans, supports, laps, loads, spacing, deck, ASD do not reach the page', texts: LOAD_BOXES });
      await pinMcp(ctx, c, g, 'design_purlin', 'design_purlin', { ...II2A_MCP, Fy: 55, Fu: 70, lap_restrained: true }, {
        inputsExpect: 'k2-change', inputsReason: K2_INPUTS + ' — only the derived fields filled from the posted load analysis change; the inputs MCP gave do not',
        texts: ['design-summary', ...LOAD_BOXES] });
      await ctx.tab('design');
      await pinStep(ctx, g, 'gui.runDesign', () => K.clickAndWait(ctx, '#btn-run-design', 'designPurlinResult', 900000), {
        expect: 'k2-change', reason: K2_GUI + ' — the GUI purlin design sends the page spans/loads/deck (defaults), not the II-2A inputs MCP used',
        texts: ['design-summary'], textExpect: 'k2-change', textReason: 'K2: the card then shows the page-default purlin' });
    });
  });

  await withSession('mcp-connection', async (ctx, getMcp) => {
    const g = golden('mcp-connection');
    await step('mcp connection (SI screw) and lap; then the page buttons', async () => {
      const c = await getMcp();
      await pinMcp(ctx, c, g, 'design_connection', 'design_connection',
        { units: 'SI', connection_type: 'screw', design_method: 'LRFD', Fy: 345, Fu: 450, t1: 1.5, t2: 1.5, d: 4.8, n: 4, Pu: 8.9, Pnvs: 5.3, e: 15, s: 25 },
        { inputsExpect: 'k2-change', inputsReason: K2_INPUTS + ' — connection type, t1/t2, d, n, Fy/Fu, Pu, Pnvs, e, s do not reach the page', texts: CONN_BOXES });
      await pinStep(ctx, g, 'gui.runConnection', () => K.clickAndWait(ctx, '#btn-run-single-conn', 'connectionResult'), {
        expect: 'k2-change', reason: K2_GUI + ' — the page sends its own connection fields', texts: CONN_BOXES, textExpect: 'k2-change', textReason: 'K2: the card then shows the result of the page fields, not of what MCP set' });
      await pinMcp(ctx, c, g, 'design_lap_connection', 'design_lap_connection',
        { d: 8, t: 0.059, Fy: 55, Fu: 70, lap_left_in: 30, lap_right_in: 42, Mu_support: 52.5, Vu_support: 0.9, fastener_type: 'screw',
          fastener_dia: 0.19, n_rows: 2, end_distance: 1.0, Pnvs: 1.2, design_method: 'ASD' },
        { inputsExpect: 'k2-change', inputsReason: K2_INPUTS + ' — lap lengths, Mu/Vu, fastener, rows, Pnvs do not reach the page', texts: CONN_BOXES });
      await pinStep(ctx, g, 'gui.runLap', () => K.clickAndWait(ctx, '#btn-run-lap-design', 'lapConnectionResult'), {
        expect: 'k2-change', reason: K2_GUI + ' — the page sends its own lap fields (305 mm laps, Mu 0 …)', texts: CONN_BOXES, textExpect: 'k2-change', textReason: 'K2: the card then shows the result of the page lap fields' });
    });
  });

  await withSession('mcp-analysis', async (ctx, getMcp) => {
    const g = golden('mcp-analysis');
    await step('mcp analysis conditions reach the widgets and survive the GUI run (already synced today — pinned)', async () => {
      const c = await getMcp();
      await ctx.click('#btn-unit-US');
      await pinMcp(ctx, c, g, 'set_section_template', 'set_section_template', { type: 'lippedc', H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 });
      await pinMcp(ctx, c, g, 'set_boundary_condition', 'set_boundary_condition', { BC: 'C-C' });
      await pinMcp(ctx, c, g, 'set_lengths', 'set_lengths', { min: 20, max: 200, n: 6 });
      await pinMcp(ctx, c, g, 'set_material', 'set_material', { E: 29000, v: 0.3 });
      await pinMcp(ctx, c, g, 'set_load_case', 'set_load_case', { load_case: 'custom', P: 5, Mxx: 12 });
      await pinStep(ctx, g, 'gui.runAnalysis', () => K.runAnalysisGui(ctx), { expect: 'pin' });
      const st = ctx.panel.__testGetState().model;
      g.check('gui.runAnalysis.hostModel', { BC: st.BC, nlengths: st.nlengths, loadCase: st.loadCase }, { expect: 'pin' });
      // 고유치 수: MCP run_analysis 의 neigs 는 칸에 오지 않고, 다음 「해석 실행」 이 칸의 10 을 보낸다
      await pinMcp(ctx, c, g, 'run_analysis', 'run_analysis', { neigs: 7 }, {
        inputsExpect: 'k2-change', inputsReason: 'K2: neigs 7 set through MCP run_analysis does not reach input-neigs (stays 10)' });
      await pinStep(ctx, g, 'gui.runAnalysis2', () => K.runAnalysisGui(ctx), {
        expect: 'k2-change', reason: K2_GUI + ' — the GUI run sends neigs 10 from the field, not the 7 MCP used' });
      g.check('gui.runAnalysis2.hostNeigs', ctx.panel._model.neigs, { expect: 'k2-change', reason: 'K2: host neigs after the GUI run (MCP set 7)' });
      // 강종을 고르면 E · G 칸이 29500 · 11300 ksi 로 바뀐다(MCP set_material 의 E 29000 이 다음 「해석 실행」 에서 사라진다)
      await ctx.tab('preprocessor');
      await ctx.setVal('input-steel-grade', 'SGC440');
      await ctx.settle(200);
      g.check('gradeResetsE', { E: await ctx.eval(`document.getElementById('input-E').value`), G: await ctx.eval(`document.getElementById('input-G').value`),
        hostE: ctx.panel._model.prop[0][1] }, { expect: 'defect',
        reason: 'D-8: choosing a steel grade writes the hard-coded E 29500 / G 11300 ksi (app.js) over the E set by MCP or a file; the next GUI run sends them' });
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
async function phaseReload() {
  await withSession('reload', async (ctx) => {
    const g = golden('reload');
    await step('reload: unsaved page inputs and the host model after a page reload (webviewReady again)', async () => {
      await ctx.click('#btn-unit-US');
      await ctx.tab('loads');
      await ctx.setVal('select-member-type', 'flexure');
      await ctx.tab('design');
      await ctx.setVal('design-Lb', 77.7);
      await ctx.panel.handleMcpAction({ action: 'generate_template', section_type: 'lippedz', params: { H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 } });
      await ctx.settle(300);
      const before = { lb: await ctx.eval(`document.getElementById('design-Lb').value`), mt: await ctx.eval(`document.getElementById('select-member-type').value`),
        tpl: ctx.panel._model.sectionTemplate };
      const m = ctx.mark();
      const e0 = ctx.engineMark();
      await ctx.cdp.send('Page.reload', {});
      await ctx.waitMsg('modelLoaded', m.h2w, 60000);
      await ctx.settle(500);
      const after = { lb: await ctx.eval(`document.getElementById('design-Lb').value`), mt: await ctx.eval(`document.getElementById('select-member-type').value`),
        unit: (await K.snapshotInputs(ctx)).__unitSystem, tpl: ctx.panel._model.sectionTemplate, H_in: (ctx.panel._model.sectionParams || {}).H };
      g.check('before', before, { expect: 'pin' });
      g.check('after', after, { expect: 'k2-change',
        reason: 'K2: a page reload loses every input not yet saved (Lb 77.7 in, flexure) and the second webviewReady re-initialises the host model to the default section (lippedz 8 in → lippedc 100 mm) — the host state must survive and be pushed back' });
      g.check('reload.engine', ctx.engineSince(e0).map((r) => r.method), { expect: 'k2-change', reason: 'K2: the reload regenerates the default section in the engine' });
    });
    // u33 (데스크톱 작성자) · V7-S1: 하중 해석 → AI 가 Lb · Cb · wcSupport 를 정함 → 다시 싣기 — 다시 온 옛 loadAnalysisComplete 의
    // 자동 채움이 그 값을 덮지 않는다(호스트가 그 하중 해석보다 뒤에 쓴 user · ai 값은 load-analysis 쓰기로 받지 않는다)
    await step('u33: MCP load analysis → set_case_inputs → page reload — the AI values stay', async () => {
      await ctx.panel.handleMcpAction({ action: 'analyze_loads', ...II2A_MCP, Fy: 55, Fu: 70 });
      await ctx.settle(800);
      await ctx.drain();
      const set = await ctx.panel.handleMcpAction({ action: 'set_case_inputs', inputs: { Lb: 62.99, Cb: 1.05, wcSupport: 'EOF' }, reason: 'u33' });
      assert(!set.error, JSON.stringify(set));
      await ctx.drain();
      const m = ctx.mark();
      await ctx.cdp.send('Page.reload', {});
      await ctx.waitMsg('modelLoaded', m.h2w, 60000);
      await ctx.settle(1500);
      await ctx.drain();
      const st = ctx.panel.__testGetCase().state;
      assert.deepStrictEqual([st.inputs.Lb, st.inputs.Cb, st.inputs.wcSupport], [62.99, 1.05, 'EOF'], `host values after the reload: ${JSON.stringify([st.inputs.Lb, st.inputs.Cb, st.inputs.wcSupport])}`);
      assert.deepStrictEqual([st.sources.Lb, st.sources.Cb, st.sources.wcSupport], ['ai', 'ai', 'ai'], 'still the AI values');
      const page = { lb: await ctx.eval(`document.getElementById('design-Lb').value`), cb: await ctx.eval(`document.getElementById('design-Cb').value`),
        wc: await ctx.eval(`document.getElementById('design-wc-support').value`) };
      assert(Math.abs(parseFloat(page.lb) - (st.view && st.view.unitSystem === 'SI' ? 62.99 * 25.4 : 62.99)) < 0.01 && parseFloat(page.cb) === 1.05 && page.wc === 'EOF',
        `the page shows the host values again: ${JSON.stringify(page)}`);
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
/** 파일을 쓰고(호스트의 .csd 쓰기 그대로) → 화면의 「열기」 → 「저장」 → 저장된 designInputs. */
async function openSave(ctx, designInputs, tag) {
  const dir = path.join(K.OUT, 'csd');
  fs.mkdirSync(dir, { recursive: true });
  const fIn = path.join(dir, `${tag}.in.csd`);
  const fOut = path.join(dir, `${tag}.out.csd`);
  for (const f of [fIn, fOut]) { try { fs.unlinkSync(f); } catch { /* */ } }
  await ctx.panel.__testWriteProjectFile(fIn, { __stcfsd_collect: 2, designInputs, lapResult: null });
  ctx.dialogs.nextOpen = fIn;
  await ctx.click('#btn-file-open');
  await ctx.settle(800);
  const dom = await K.snapshotInputs(ctx);
  ctx.dialogs.nextSave = fOut;
  await ctx.click('#btn-file-save');
  await ctx.settle(800);
  const saved = JSON.parse(fs.readFileSync(fOut, 'utf8')).designInputs;
  return { dom, saved };
}

function compareInputs(written, saved) {
  const exact = [], changed = {};
  let maxRel = 0;
  const keys = new Set([...Object.keys(written), ...Object.keys(saved)]);
  for (const k of [...keys].sort()) {
    const a = written[k], b = saved[k];
    if (JSON.stringify(a) === JSON.stringify(b)) { exact.push(k); continue; }
    const num = (x) => typeof x === 'number';
    const closeNum = (x, y) => num(x) && num(y) && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x));
    const closeArr = Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => closeNum(x, b[i]));
    const closeLaps = Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x && b[i]
      && (x.left === b[i].left || closeNum(x.left, b[i].left)) && (x.right === b[i].right || closeNum(x.right, b[i].right)));
    if (closeNum(a, b) || closeArr || closeLaps) {
      const rel = num(a) ? Math.abs(a - b) / Math.max(1e-30, Math.abs(a)) : 0;
      maxRel = Math.max(maxRel, rel);
      changed[k] = { kind: 'float-noise', written: a, saved: b };
      continue;
    }
    changed[k] = { kind: 'changed', written: a, saved: b };
  }
  return { exactCount: exact.length, changed, maxRelFloat: maxRel };
}

async function setConsistentModel(ctx) {
  const N = V.NON_DEFAULT;
  for (const a of [
    { action: 'generate_template', section_type: N.templateType, params: { H: N.tplH, B: N.tplB, D: N.tplD, t: N.tplT, r: N.tplR, qlip: N.tplQlip } },
    { action: 'set_material', E: N.inputE, v: N.inputV, G: N.inputG },
    { action: 'set_bc', BC: N.analysisBC },
    { action: 'set_lengths', min: N.analysisLenMin, max: N.analysisLenMax, n: N.analysisLenN },
    { action: 'set_load_case', load_case: 'bending_xx_pos', fy: N.fyLoad },
  ]) {
    const r = await ctx.panel.handleMcpAction(a);
    assert(!(r && r.error), `${a.action}: ${r && r.error}`);
  }
  ctx.panel._model.neigs = N.analysisNeigs;   // 고유치 수는 해석 실행 때만 모델에 들어간다 — 시험 준비로 직접
  ctx.panel._postMessage('modelLoaded', ctx.panel._model);
  await ctx.settle(400);
}

async function phaseCsd() {
  await withSession('csd-consistent', async (ctx) => {
    const g = golden('csd-roundtrip');
    await setConsistentModel(ctx);
    for (const unit of ['US', 'SI']) {
      await step(`csd round trip of every inventoried input, non-default, model consistent (${unit})`, async () => {
        const written = V.designInputs(unit);
        const { dom, saved } = await openSave(ctx, written, `consistent-${unit}`);
        const cmp = compareInputs(written, saved);
        console.log(`     ${unit}: ${cmp.exactCount} exact, changed ${Object.keys(cmp.changed).length}: ${Object.entries(cmp.changed).map(([k, v]) => `${k}(${v.kind})`).join(', ')}`);
        g.check(`consistent.${unit}.diff`, cmp, { expect: 'pin' });
        g.check(`consistent.${unit}.dom`, dom, { expect: 'pin' });
        g.check(`consistent.${unit}.saved`, saved, { expect: 'pin' });
      });
    }
    await step('csd: coupled material fields that disagree in the file (fy 50 · fyLoad 45 · plasticFy 40 · fu 65 · fuPre 60)', async () => {
      const written = { ...V.designInputs('US'), fy: 50, fyLoad: 45, plasticFy: 40, fu: 65, fuPre: 60, presteelGrade: 'A653-50' };
      const { dom, saved } = await openSave(ctx, written, 'coupled');
      const pick = (o, ids) => Object.fromEntries(ids.map((i) => [i, o[i]]));
      g.check('coupled.dom', pick(dom, ['input-steel-grade', 'input-fy', 'input-fu', 'design-fy', 'design-fu', 'plastic-fy', 'conn-Fy', 'conn-Fu']), { expect: 'pin' });
      g.check('coupled.saved', pick(saved, ['presteelGrade', 'fy', 'fu', 'fyLoad', 'fuPre', 'plasticFy', 'connFy', 'connFu']), { expect: 'pin' });
    });
    await step('csd: §I6.2.1 R picked as 「0.70 continuous」 — which option comes back after save → open', async () => {
      await ctx.tab('design');
      await ctx.setVal('chk-r-factor', true);
      await ctx.eval(`(()=>{const s=document.getElementById('select-r-value'); const i=[...s.options].findIndex(o=>parseFloat(o.value)===0.7&&o.getAttribute('data-span')==='continuous');
        s.selectedIndex=i; s.dispatchEvent(new Event('change',{bubbles:true})); return i;})()`);
      const pickR = () => ctx.eval(`(()=>{const s=document.getElementById('select-r-value'); const o=s.options[s.selectedIndex];
        return {value: s.value, selectedIndex: s.selectedIndex, span: o && o.getAttribute('data-span')};})()`);
      const before = await pickR();
      const f = path.join(K.OUT, 'csd', 'r-continuous.csd');
      try { fs.unlinkSync(f); } catch { /* */ }
      ctx.dialogs.nextSave = f; await ctx.click('#btn-file-save'); await ctx.settle(800);
      ctx.dialogs.nextOpen = f; await ctx.click('#btn-file-open'); await ctx.settle(800);
      const after = await pickR();
      g.check('rContinuous', { before, after, saved: JSON.parse(fs.readFileSync(f, 'utf8')).designInputs.rValue }, { expect: 'defect',
        reason: 'D-1: the file keeps only the option value "0.70"; two options share it (simple / continuous), so the span condition sent to the engine (span_type) can change on reopen' });
    });
  });

  await withSession('csd-model-differs', async (ctx) => {
    const g = golden('csd-model-differs');
    await step('csd round trip with the default model (file inputs disagree with the model — the model wins for the analysis widgets)', async () => {
      const written = V.designInputs('US');
      const { saved } = await openSave(ctx, written, 'model-differs-US');
      const cmp = compareInputs(written, saved);
      console.log(`     changed ${Object.keys(cmp.changed).length}: ${Object.keys(cmp.changed).join(', ')}`);
      g.check('modelDiffers.US.diff', cmp, { expect: 'pin' });
    });
  });
}

async function phaseExamples() {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory() && !e.name.startsWith('.')) { walk(p); } else if (e.isFile() && e.name.toLowerCase().endsWith('.csd')) { files.push(p); }
  } };
  walk(path.join(K.ROOT, 'Example'));
  await withSession('examples', async (ctx) => {
    const g = golden('examples');
    for (const f of files) {
      const rel = path.relative(K.ROOT, f).replace(/\\/g, '/');
      for (const unit of ['SI', 'US']) {
        await step(`example ${rel}: open → save → open → save gives the same inputs (${unit} display)`, async () => {
          await ctx.click(`#btn-unit-${unit}`);
          await ctx.settle(200);
          const dir = path.join(K.OUT, 'csd');
          fs.mkdirSync(dir, { recursive: true });
          const o1 = path.join(dir, `example-${path.basename(f)}-${unit}-1.csd`);
          const o2 = path.join(dir, `example-${path.basename(f)}-${unit}-2.csd`);
          ctx.dialogs.nextOpen = f; await ctx.click('#btn-file-open'); await ctx.settle(800);
          ctx.dialogs.nextSave = o1; await ctx.click('#btn-file-save'); await ctx.settle(800);
          ctx.dialogs.nextOpen = o1; await ctx.click('#btn-file-open'); await ctx.settle(800);
          ctx.dialogs.nextSave = o2; await ctx.click('#btn-file-save'); await ctx.settle(800);
          const s1 = JSON.parse(fs.readFileSync(o1, 'utf8')).designInputs;
          const s2 = JSON.parse(fs.readFileSync(o2, 'utf8')).designInputs;
          const cmp = compareInputs(s1, s2);
          g.check(`${rel}.${unit}.saved`, s1, { expect: 'pin' });
          g.check(`${rel}.${unit}.resaveDiff`, cmp.changed, { expect: 'pin' });
        });
      }
    }
  });
}

/**
 * 열기 → 깨끗 · 저장 → 깨끗(desktop 작성자의 결함 — 열자마자 dirty: 화면이 연 상태를 다시 적어 알린 메아리가 변경으로 세어졌다).
 * 고정한 모든 .csd(Example · 이 시험이 쓴 csd/*.in.csd)를 US · SI 화면에서 연 바로 뒤 · 저장 바로 뒤 get_unsaved_changes 가 깨끗해야 한다.
 */
async function phaseDirty() {
  const files = [];
  const walk = (d) => { if (!fs.existsSync(d)) { return; } for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory() && !e.name.startsWith('.')) { walk(p); } else if (e.isFile() && /.csd$/i.test(e.name) && !/.out.csd$|-[12].csd$|^dirty-/.test(e.name)) { files.push(p); }
  } };
  walk(path.join(K.ROOT, 'Example'));
  walk(path.join(K.OUT, 'csd'));
  await withSession('dirty', async (ctx) => {
    for (const unit of ['US', 'SI']) {
      await step(`open → clean · save → clean for ${files.length} .csd (${unit} display)`, async () => {
        await ctx.click(`#btn-unit-${unit}`);
        await ctx.settle(200);
        const bad = [];
        for (const f of files) {
          ctx.dialogs.nextOpen = f; await ctx.click('#btn-file-open'); await ctx.settle(800);
          const u1 = await ctx.panel.handleMcpAction({ action: 'get_unsaved_changes' });
          if (u1.dirty) { bad.push(`open ${path.basename(f)}: dirty ${JSON.stringify(u1.inputs_changed)} model ${u1.model_changed}`); }
          const out = path.join(K.OUT, 'csd', `dirty-${unit}-${path.basename(f)}`);
          ctx.dialogs.nextSave = out; await ctx.click('#btn-file-save'); await ctx.settle(800);
          const u2 = await ctx.panel.handleMcpAction({ action: 'get_unsaved_changes' });
          if (u2.dirty) { bad.push(`save ${path.basename(f)}: dirty ${JSON.stringify(u2.inputs_changed)} model ${u2.model_changed}`); }
        }
        assert.deepStrictEqual(bad, [], 'a freshly opened / saved case is clean');
      });
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  if (!findBrowser()) { console.log('test:k2: SKIP — no Edge/Chrome found (set V4_BROWSER to the browser executable).'); return; }
  if (!pythonPath()) { console.log('test:k2: SKIP — no .venv python.'); return; }
  fs.mkdirSync(K.OUT, { recursive: true });
  const t0 = Date.now();
  if (want('defaults')) { await phaseDefaults(); }
  if (want('gui')) { await phaseGui(); }
  if (want('mcp')) { await phaseMcp(); }
  if (want('reload')) { await phaseReload(); }
  if (want('csd')) { await phaseCsd(); }
  if (want('example')) { await phaseExamples(); }
  if (want('dirty')) { await phaseDirty(); }

  let mism = 0;
  const report = [];
  for (const g of goldens) {
    const wrote = g.save();
    for (const m of g.mismatch) {
      mism += 1;
      report.push(`  MISMATCH ${g.name} :: ${m.id} [expect ${m.expect}]${m.orderOnly ? ' (key order only)' : ''}${m.reason ? ' — ' + m.reason : ''}\n           ${m.detail}`);
    }
    const nK2 = g.entries.filter((e) => e.expect === 'k2-change').length;
    console.log(`  golden ${g.name}: ${g.entries.length} entries (${nK2} k2-change)${wrote ? (g.fresh ? ' — RECORDED (new file)' : ' — written') : ''}`);
  }
  if (report.length) { console.log(report.join('\n')); }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(K.OUT, 'results.json'), JSON.stringify({ results, exceptions, mismatches: goldens.flatMap((g) => g.mismatch.map((m) => ({ golden: g.name, ...m }))) }, null, 1));
  console.log(`page exceptions: ${exceptions.length}`);
  console.log(`K2 invariants: ${caseChecked.length} sessions, ${caseChecked.reduce((a, x) => a + x.shadow, 0)} shadow comparisons, ${caseProblems.length} problems`);
  for (const p of caseProblems) { console.log('  CASE ' + p); }
  console.log(`test:k2: ${failed.length === 0 && mism === 0 && exceptions.length === 0 && caseProblems.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length} steps, ${mism} golden mismatches, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (failed.length > 0 || mism > 0 || exceptions.length > 0 || caseProblems.length > 0) { process.exitCode = 1; }
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e); process.exit(1); });
void KSI_MPA;
