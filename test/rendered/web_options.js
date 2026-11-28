/* global process */
// 2026-11-26 H2 후속 — 웹 구멍 · 횡방향 웹 보강재 · 비틀림(§H4) 의 화면(끼운 편집 화면 app.js)을 진짜 화면의 칸 · 단추로(렌더 시험, 보이지 않는 창).
//   npm run test:rendered        (test/rendered/run.js 다음에 이 파일 — package.json)
//   node test/rendered/web_options.js [--only=W1,W5]
// 진짜 호스트(StcfsdPanel) · 파이썬 · 웹뷰(헤드리스 Edge, test/rendered/lib.js). 구역을 그 선택 칸으로 열고, SI 로 값을 치고, 「설계 검토 실행」 을 누른다.
// 경우마다: 화면 글(카드 · 게이지 · 표), 화면 예외 0 · 콘솔 오류 0, 결과 칸에 undefined · NaN · [object Object] 없음, 호스트가 가진 결과(US)를 SI 로 바꾼 값과 같은 수.
//  W1 원형 구멍(한계 안) — 「웹 구멍」 카드(순단면 · 구멍의 탄성값), §F2.2 · §F3.2.2 · §F4.2, 전단 카드의 qs, §G6 Rc
//  W2 가장자리 보강 구멍 — 큰 소요: NG(구멍 없는 강도로도 넘음, 게이지 글에 상한의 비, 그 검토의 비는 「구멍 없는 강도로 낸 비」) · 작은 소요: 판정 없음과 까닭
//  W3 보강재 있음 — 자료 없이: 평가하지 못함(빠진 자료) · 맞는 자료: 곡선 · kv, §G4.1 묶음
//  W4 §H4 — 응력을 직접: R · 편심 하중: R, 지배 절점, 경간의 위치(mm)
//  W5 잘못된 값(보강재 Fy 0 · 음수) — 실행이 막히고 그 칸 이름 · 강조, 앞 결과 카드는 지금 것으로 남지 않는다
//  W6 엔진 오류(구멍 간격 ≤ 구멍 길이) — 옛 카드가 지워지고 한국어 오류가 구역 · 칸을 이른다
//  W7 세 구역을 「없음」 으로 — 카드가 사라지고 본문은 처음 본문
//  W8 압축 + 구멍(§E 조항 · Pynet), W9 조합 + 구멍(상호작용), W10 자동 계산(바닥 장선) + 구멍(구간 표)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { start, findBrowser, sleep } = require('./lib');
const { pythonPath } = require('../webview/panel_harness');

const ONLY = ((process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length)).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const results = [];
async function step(name, fn) {
  if (ONLY.length && !ONLY.some((o) => name.toLowerCase().includes(o))) { console.log(`  skip ${name} (--only)`); return; }
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e && e.stack || e) });
    console.log(`  FAIL ${name}: ${e && e.message || e}`);
  }
}

const IN = 25.4, KIP = 4.4482216152605, KSI = KIP * 1000 / 645.16, KIPIN = KIP * 0.0254;
const WEB_KEY = /^(hole_|stiffener_|torsion_|transverse_stiffeners)/;
/** 화면의 수 글 하나(자릿수에 맞춘 허용차로 엔진 값 × 계수와 같은지) */
function sameShown(shown, exact, what) {
  const s = String(shown).replace(/,/g, '');
  const v = parseFloat(s);
  const dec = (s.split('.')[1] || '').length;
  const tol = 0.5 * Math.pow(10, -dec) + 1e-9 * Math.abs(exact);
  assert(Number.isFinite(v) && Math.abs(v - exact) <= tol, `${what}: shown ${shown} vs host ${exact} (±${tol})`);
}
/** 글에서 「앞말 수」 의 수 */
function numAfter(text, re, what) {
  const m = new RegExp(re.source + '\\s*(-?[0-9][0-9,]*\\.?[0-9]*(?:e[-+]?\\d+)?)').exec(String(text || ''));
  assert(m, `${what}: «${re.source}» not in «${String(text).slice(0, 400)}»`);
  return m[1];
}

async function main() {
  if (!findBrowser()) { console.log('web_options (rendered): SKIP — no Edge/Chrome found (set V4_BROWSER).'); return; }
  if (!pythonPath()) { console.log('web_options (rendered): SKIP — no .venv python.'); return; }
  const outDir = path.join(__dirname, 'out', 'web_options');
  const ctx = await start({ outDir });
  const S = (id, v) => ctx.setVal(id, v);
  const host = () => ctx.panel._lastDesignResult;
  const hu = (r, block, k) => {
    const du = r && r.display_unrounded;
    if (block) { const b = du && du[block]; return b && typeof b[k] === 'number' ? b[k] : r[block][k]; }
    return du && typeof du[k] === 'number' ? du[k] : r[k];
  };
  /** 구역 머리(접이)를 열고 그 선택 칸으로 고른다 */
  const openSec = async (sec, selId, val) => {
    const exp = await ctx.eval(`(document.getElementById('sec-${sec}')||{}).dataset ? document.getElementById('sec-${sec}').dataset.expanded : 'missing'`);
    if (exp === 'false') { await ctx.click(`#sec-${sec}`); }
    assert.strictEqual(await S(selId, val), 'ok', selId);
  };
  const setAll = async (o) => { for (const [k, v] of Object.entries(o)) { assert.strictEqual(await S(k, v), 'ok', k); } };
  /** 「설계 검토 실행」 — 보낸 본문 · 화면 글 · 예외 · 콘솔 오류 · 나쁜 글 */
  const press = async (opts = {}) => {
    await ctx.tab('design');
    const m = ctx.mark();
    await ctx.click('#btn-run-design');
    if (opts.blocked) { await ctx.drain(); await sleep(200); await ctx.drain(); }
    else { await ctx.waitMsg(opts.purlin ? 'designPurlinResult' : 'designResult', m.h2w, 600000); await ctx.drain(); await ctx.settle(200); await ctx.drain(); }
    const sentMsg = ctx.log.w2h.slice(m.w2h).find((x) => x.command === 'runDesign' || x.command === 'runPurlinDesign');
    const out = {
      sent: sentMsg ? sentMsg.data : null,
      card: await ctx.text('#design-summary'),
      inter: await ctx.eval(`(()=>{const e=document.getElementById('design-interaction'); return e && e.style.display!=='none' ? e.innerText : '';})()`),
      ref: await ctx.text('#design-reference'),
      val: await ctx.eval(`(()=>{const e=document.getElementById('design-validation'); return e && e.style.display!=='none' ? e.textContent : '';})()`),
      status: await ctx.eval(`(document.getElementById('status-text')||document.getElementById('status')||{}).textContent || ''`),
    };
    const since = ctx.since(m);
    assert.deepStrictEqual(since.exceptions.map((e) => e.text), [], 'page / host exceptions');
    assert.deepStrictEqual(since.console.filter((c) => c.type === 'error' || c.type === 'log-error').map((c) => c.text), [], 'console errors');
    for (const sel of ['#design-summary', '#design-interaction', '#design-reference']) {
      const bad = (await ctx.badTokens(sel)) || [];
      assert.deepStrictEqual(bad.filter((b) => !/\bnull\b/.test(b) || /: null|= null| null /.test(b)), [], `bad tokens in ${sel}`);
    }
    // 배치: 결과 표 · 묶음이 결과 칸보다 넓지 않다(긴 까닭 글이 비 · 판정 칸을 화면 밖으로 밀지 않는다), 묶음의 값 칸이 30px 로 눌리지 않는다
    const lay = await ctx.eval(`(()=>{const s=document.getElementById('design-summary'); if(!s) return null; const W=s.getBoundingClientRect().right;
      const wide=[...s.querySelectorAll('table')].filter(t=>t.getBoundingClientRect().right>W+2).map(t=>(t.innerText||'').slice(0,60).replace(/\\n/g,' | '));
      const squeezed=[...s.querySelectorAll('.web-option-block td:last-child')].filter(td=>td.getBoundingClientRect().width<120).map(td=>(td.innerText||'').slice(0,40));
      const dbg=[...s.querySelectorAll('table')].map(t=>Math.round(t.getBoundingClientRect().right)+'/'+t.scrollWidth+'/'+t.clientWidth); return {wide, squeezed, W: Math.round(W), dbg};})()`);
    if (process.env.WO_DEBUG) { console.log('     layout', JSON.stringify(lay)); }
    assert.deepStrictEqual(lay && lay.wide, [], 'tables wider than the result area');
    assert.deepStrictEqual(lay && lay.squeezed, [], 'web-option value cells squeezed');
    return out;
  };
  const C8 = { 'tpl-H': 203.2, 'tpl-B': 63.5, 'tpl-D': 15.875, 'tpl-t': 1.4986, 'tpl-r': 4.7625 };
  const template = async (dims = C8) => {
    await ctx.tab('preprocessor');
    await S('select-template', 'lippedc');
    await setAll(dims);
    const m = ctx.mark();
    await ctx.click('#btn-generate-template');
    await ctx.waitMsg('templateGenerated', m.h2w, 60000);
    await ctx.settle(300);
    await S('input-fy', 345); await S('input-fu', 450);
  };
  const memberType = async (t) => { await ctx.tab('loads'); await S('select-member-type', t); await ctx.tab('design'); };
  const flexIn = { 'design-Mx': 4.5, 'design-V': 4, 'design-Lb': 1524, 'design-Cb': 1, 'design-P': '' };
  const noneAll = async () => { await S('select-hole-shape', 'none'); await S('select-stiffener-mode', 'none'); await S('select-torsion-mode', 'none'); await S('chk-hole-edge-stiffened', false); };

  let baseline = null;
  try {
    await ctx.click('#btn-unit-SI');
    await template();
    await memberType('flexure');
    // 처음 본문(세 구역 없음)
    await step('W0 default body: no web-option key, no hole card', async () => {
      await setAll(flexIn);
      const r = await press();
      assert(r.sent && !Object.keys(r.sent).some((k) => WEB_KEY.test(k)), 'default body has no new key ' + JSON.stringify(Object.keys(r.sent || {})));
      assert(!/웹 구멍 —|휨 \+ 비틀림 —|횡방향 웹 보강재 —/.test(r.card), 'no new cards');
      baseline = r.sent;
    });

    await step('W1 circular hole within the limits: hole card, hole clauses, shear qs, G6 Rc = host values in SI', async () => {
      await openSec('holes', 'select-hole-shape', 'circular');
      await setAll({ 'design-hole-dh': 38.1, 'design-hole-spacing': 762, 'design-hole-end-distance': 305, 'design-hole-bearing-distance': 152.4, ...flexIn });
      const r = await press();
      const h = host();
      assert(r.sent.hole_shape === 'circular' && Math.abs(r.sent.hole_depth - 1.5) < 1e-12 && Math.abs(r.sent.hole_spacing - 30) < 1e-12, 'body (US) ' + JSON.stringify(r.sent));
      assert(h && h.holes && h.holes.evaluated !== false, 'host evaluated the holes ' + JSON.stringify(h && h.holes && h.holes.reasons));
      assert(/웹 구멍 — 부록 2 · 구멍이 있는 부재/.test(r.card) && /원형/.test(r.card), 'hole card');
      sameShown(numAfter(r.card, /Anet/, 'Anet'), hu(h, 'holes', 'Anet') * 645.16, 'Anet mm²');
      sameShown(numAfter(r.card, /Sfnet/, 'Sfnet'), hu(h, 'holes', 'Sfnet') * Math.pow(IN, 3), 'Sfnet mm³');
      sameShown(numAfter(r.card, /Mcrℓ,h/, 'Mcrl_h'), hu(h, 'holes', 'Mcrl_h') * KIPIN, 'Mcrℓ,h kN-m');
      assert(/Mynet/.test(r.card), 'Mynet on the card');
      sameShown(numAfter(r.card, /Mynet/, 'Mynet'), hu(h, 'holes', 'Mynet') * KIPIN, 'Mynet kN-m');
      assert(/휨\(§F2\.2 · §F3\.2\.2 · §F4\.2\) 평가함/.test(r.card), 'hole flexure clauses evaluated on the card');
      const fl = h.design_checks.find((c) => c.id === 'member.flexure.local');
      assert(fl.clause === 'F3.2.2' && fl.clause_variant === 'holes', 'host check F3.2.2');
      // 검토 항목의 구멍 조항(엔진 design_checks) — 화면의 참조 조항 줄은 엔진 spec_sections 그대로
      const clauses = h.design_checks.filter((c) => c.clause_variant === 'holes').map((c) => c.clause);
      assert(['F2.2', 'F3.2.2', 'F4.2'].every((c) => clauses.includes(c)), 'host checks carry the hole clauses ' + JSON.stringify(clauses));
      for (const c of (h.spec_sections || [])) { assert(r.ref.includes(c), `reference line shows §${c} — «${r.ref.slice(0, 200)}»`); }
      assert(/전단 — §G3/.test(r.card) && /qs \(§G3\)/.test(r.card), 'shear card with qs');
      sameShown(numAfter(r.card, /qs \(§G3\)/, 'qs'), h.shear.qs, 'qs');
      assert(/§G6 Rc \(구멍\)/.test(r.inter), 'web crippling card shows Rc ' + r.inter.slice(0, 300));
      sameShown(numAfter(r.inter, /§G6 Rc \(구멍\)/, 'Rc'), hu(h, 'web_crippling', 'Rc'), 'Rc');
      await ctx.shotEl('w1_hole_cards', '#design-summary');
    });

    await step('W2 edge-stiffened hole: large demand NG on the strength without holes, small demand no verdict', async () => {
      await S('chk-hole-edge-stiffened', true);
      await setAll({ ...flexIn, 'design-Mx': 30 });
      const r = await press();
      const h = host();
      const U = require(path.join(ctx.REPO, 'webview', 'js', 'utils.js'));
      const b = U.lengthBoundFailure(h);
      assert(h.pass === false && b && b.basis === 'holes', 'host: NG on the bound ' + JSON.stringify(b));
      assert(/종합 판정: .*(NG|불합격)/.test(r.card), 'banner NG ' + r.card.slice(0, 120));
      assert(/NG — 구멍 없는 강도로도 넘음/.test(r.card), 'gauge note wording');
      assert(r.card.includes(`비 ${b.ratio.toFixed(3)}`) && r.card.includes(b.governing_check), `gauge note has the bound ratio ${b.ratio.toFixed(3)} and ${b.governing_check}`);
      assert(r.card.includes(`${(b.ratio * 100).toFixed(0)}%`), 'gauge percent = the bound ratio');
      assert(/구멍 조항을 평가하지 못함 — 위 강도는 구멍 없는 계산/.test(r.card), 'strength cards marked as without holes');
      // trusted false 검토의 비는 「구멍 없는 강도로 낸 비」 로만(카드의 판정 줄)
      const fwh = h.design_checks.filter((c) => U.failsWithoutHoles(c));
      assert(fwh.length > 0, 'fails_without_holes checks');
      for (const c of fwh) {
        if (r.card.includes(`(비 ${c.ratio.toFixed(3)})`)) { assert.fail(`ordinary-looking ratio for ${c.id}`); }
      }
      assert(/판정\s+NG — 구멍 없는 강도로도 넘음/.test(r.card) || /판정\s*\S*\s*— 구멍 없는 강도로도 넘음/.test(r.card), 'hole card 판정 row');
      await ctx.shotEl('w2_certain_failure', '#design-summary');
      await setAll({ 'design-Mx': 1 });
      const r2 = await press();
      assert(host().pass === null, 'host: no verdict');
      assert(/종합 판정: .*판정 없음/.test(r2.card), 'banner 판정 없음 ' + r2.card.slice(0, 120));
      assert(/평가하지 못함/.test(r2.card) && /가장자리|stiffened|보강/.test(r2.card), 'the reason (edge-stiffened holes) shown');
      assert(!/구멍 없는 강도로도 넘음/.test(r2.card), 'no certain-failure wording when within the bound');
      await S('chk-hole-edge-stiffened', false);
      await S('select-hole-shape', 'none');
    });

    await step('W3 stiffeners: without data not evaluated (missing data); conforming data → curve, kv, §G4.1', async () => {
      await openSec('stiffeners', 'select-stiffener-mode', 'present');
      await setAll({ ...flexIn, 'design-stiffener-spacing': '', 'design-stiffener-Is': '', 'design-stiffener-area': '', 'design-stiffener-Fy': '' });
      await S('select-stiffener-kind', '');
      const r = await press();
      assert(r.sent.transverse_stiffeners === true && !('stiffener_Fy' in r.sent), 'body: only the statement');
      assert(/횡방향 웹 보강재 — §G4\.1/.test(r.card) && /판정 없음/.test(r.card), 'G4.1 block: no verdict');
      assert(/참고값/.test(r.card) && /판정에 쓰지 않음/.test(r.card), 'shear: §G2.1 reference value only');
      const st = host().web_stiffeners;
      assert(st && (st.missing || []).length > 0, 'host: missing stiffener data ' + JSON.stringify(st));
      assert(/stiffener|보강재/.test(r.card.split('횡방향 웹 보강재 — §G4.1')[1] || ''), 'missing-data hint under the G4.1 block');
      await setAll({ 'design-stiffener-spacing': 254, 'design-stiffener-Is': 20811.3, 'design-stiffener-area': 322.58, 'design-stiffener-Fy': 345 });
      await S('select-stiffener-kind', 'pair');
      const r2 = await press();
      const h = host();
      assert(h.shear.curve === 'G2.2' || h.shear.curve === 'G2.1', 'host curve ' + h.shear.curve);
      assert(r2.card.includes(h.shear.curve) && new RegExp('kv\\s+' + h.shear.kv.toFixed(3).replace('.', '\\.')).test(r2.card), 'curve and kv shown');
      assert(/횡방향 웹 보강재 — §G4\.1/.test(r2.card) && /Is ≥ Is,min/.test(r2.card) && /Ast ≥ 최소/.test(r2.card), 'G4.1 block');
      const g4 = h.design_checks.find((c) => c.id === 'member.web_stiffeners');
      assert(g4 && g4.verdict === 'pass' && /§G4\.1[\s\S]*통과|OK/.test(r2.card), 'G4.1 verdict shown');
      sameShown(numAfter(r2.card, /간격 a/, 'a'), hu(h, 'web_stiffeners', 'a') * IN, 'stiffener a mm');
      await ctx.shotEl('w3_stiffeners', '#design-summary');
      await S('select-stiffener-mode', 'none');
    });

    await step('W4 §H4: direct stresses → R; eccentric load → R, node, position in mm', async () => {
      await openSec('torsion', 'select-torsion-mode', 'direct');
      await setAll({ ...flexIn, 'design-torsion-fb': -28.27, 'design-torsion-ft': -8.894 });
      const r = await press();
      const h = host();
      assert(h.torsion && h.torsion.evaluated, 'host torsion evaluated ' + JSON.stringify(h.torsion).slice(0, 200));
      assert(/휨 \+ 비틀림 — §H4/.test(r.card) && /응력을 직접/.test(r.card), 'H4 card, route');
      sameShown(numAfter(r.card, /\bR\s/, 'R'), h.torsion.R, 'R');
      await S('select-torsion-mode', 'eccentric');
      await setAll({ 'design-torsion-e': 26.67, 'design-torsion-span': 7620 });
      await S('select-torsion-load', 'uniform'); await S('select-torsion-support', 'simple');
      const r2 = await press();
      const h2 = host();
      assert(h2.torsion && h2.torsion.evaluated && h2.torsion.route === 'computed', 'host computed route');
      assert(/편심 하중으로/.test(r2.card), 'route (b) label');
      sameShown(numAfter(r2.card, /\bR\s/, 'R'), h2.torsion.R, 'R (b)');
      assert(r2.card.includes('절점 ' + h2.torsion.node), 'governing node ' + h2.torsion.node);
      sameShown(numAfter(r2.card, /경간의/, 'y'), hu(h2, 'torsion', 'y') * IN, 'position mm');
      assert(/경간의 [0-9.,]+ mm/.test(r2.card), 'position in mm');
      await ctx.shotEl('w4_torsion', '#design-summary');
      await S('select-torsion-mode', 'none');
    });

    await step('W5 invalid stiffener Fy (0, negative): blocked, field named and highlighted, old card not current', async () => {
      await setAll(flexIn);
      await press();                                   // 지금 결과 카드(유효)
      await openSec('stiffeners', 'select-stiffener-mode', 'present');
      await setAll({ 'design-stiffener-spacing': 254, 'design-stiffener-Is': 20811.3, 'design-stiffener-area': 322.58 });
      await S('select-stiffener-kind', 'pair');
      for (const bad of [0, -50]) {
        await S('design-stiffener-Fy', bad);
        await ctx.drain();
        const r = await press({ blocked: true });
        assert(!r.sent, `Fy ${bad}: nothing sent`);
        assert(/보강재 Fy/.test(r.val) && /0 보다 커야/.test(r.val), `Fy ${bad}: message names the field — «${r.val}»`);
        const hl = await ctx.eval(`document.getElementById('design-stiffener-Fy').classList.contains('input-missing')`);
        assert(hl, `Fy ${bad}: field highlighted`);
        assert(!/종합 판정/.test(r.card), `Fy ${bad}: the previous result card is not left looking current — «${r.card.slice(0, 160)}»`);
      }
      const st = ctx.panel.__testGetCase ? ctx.panel.__testGetCase().state.inputs.stiffenerFy : undefined;
      assert(!(typeof st === 'number' && st <= 0), 'case state did not take the invalid value ' + st);
      await S('design-stiffener-Fy', 345);
      await S('select-stiffener-mode', 'none');
    });

    await step('W6 engine error (spacing ≤ hole length): old cards cleared, Korean error names section and field', async () => {
      await setAll(flexIn);
      await openSec('holes', 'select-hole-shape', 'circular');
      await setAll({ 'design-hole-dh': 38.1, 'design-hole-spacing': 762 });
      const ok = await press();                         // 웹 크리플링 카드 · 참조가 있는 결과
      assert(/종합 판정/.test(ok.card) && ok.inter, 'a result with cards first');
      await S('select-hole-shape', 'noncircular');
      await setAll({ 'design-hole-Lh': 114.3, 'design-hole-spacing': 76.2, 'design-hole-corner-radius': 6.35 });
      const r = await press();
      assert(/입력 오류 — 「웹 구멍\(천공\)」 구역/.test(r.card) && /「웹 구멍 중심 간격 s」/.test(r.card), 'Korean error: section and field — ' + r.card.slice(0, 300));
      assert(!/종합 판정/.test(r.card) && r.inter === '' && String(r.ref || '').trim() === '', 'old cards cleared');
      await S('select-hole-shape', 'none');
    });

    await step('W7 all sections back to none: cards gone, request body = the default body', async () => {
      await noneAll();
      await setAll(flexIn);
      const r = await press();
      assert(!/웹 구멍 —|휨 \+ 비틀림 —|횡방향 웹 보강재 —|전단 — §G/.test(r.card), 'no web-option cards');
      assert.deepStrictEqual(r.sent, baseline, 'request body = the default body');
    });

    await step('W8 compression with a hole: §E clauses and Pynet on the card', async () => {
      await memberType('compression');
      await setAll({ 'design-KxLx': 2438.4, 'design-KyLy': 1219.2, 'design-KtLt': 1219.2, 'design-P': 4.448 });
      await openSec('holes', 'select-hole-shape', 'circular');
      await setAll({ 'design-hole-dh': 38.1, 'design-hole-spacing': 762 });
      const r = await press();
      const h = host();
      assert(h.member_type === 'compression' && h.holes, 'host compression with holes');
      assert(/압축\(§E2\.5 · §E3\.2\.2 · §E4\.2\)/.test(r.card), '§E clauses on the card');
      sameShown(numAfter(r.card, /Pynet/, 'Pynet'), hu(h, 'holes', 'Pynet') * KIP, 'Pynet kN');
      assert(!('hole_end_distance' in r.sent), 'compression body: §E keys only');
      await S('select-hole-shape', 'none');
    });

    await step('W9 combined with a hole: interaction with holes', async () => {
      await memberType('combined');
      await setAll({ 'design-KxLx': 2438.4, 'design-KyLy': 1219.2, 'design-KtLt': 1219.2, 'design-P': 4.448, 'design-Mx': 2, 'design-Lb': 1219.2, 'design-V': '' });
      await openSec('holes', 'select-hole-shape', 'circular');
      await setAll({ 'design-hole-dh': 38.1, 'design-hole-spacing': 762 });
      const r = await press();
      const h = host();
      assert(h.member_type === 'combined' && h.interaction, 'host combined with interaction');
      assert(/P\/Pa/.test(r.inter) && /Total/.test(r.inter), 'interaction card');
      sameShown(numAfter(r.inter, /Total/, 'total'), h.interaction.total, 'interaction total');
      assert(/웹 구멍 — 부록 2/.test(r.card), 'hole card on the combined result');
      await S('select-hole-shape', 'none');
    });

    await step('W10 floor joist (load analysis) with holes: region table renders with the hole results', async () => {
      await ctx.tab('loads');
      await S('select-member-type', 'floor-joist');
      await S('select-span-type', 'simple');
      await ctx.settle(200);
      await ctx.eval(`(()=>{document.querySelectorAll('.span-tbl-len').forEach((e)=>{e.value='4.5';e.dispatchEvent(new Event('change',{bubbles:true}));});})()`);
      await S('config-spacing', 0.6);
      for (const [k, v] of Object.entries({ 'load-D-psf': 0.5, 'load-L-psf': 1.9, 'load-Lr-psf': 0, 'load-S-psf': 0, 'load-Wu-psf': 0, 'load-Wp-psf': 0 })) { await S(k, v); }
      const ma = ctx.mark();
      await ctx.click('#btn-analyze-loads');
      await ctx.waitMsg('loadAnalysisComplete', ma.h2w, 300000);
      await ctx.settle(300);
      await ctx.tab('design');
      await openSec('holes', 'select-hole-shape', 'circular');
      await setAll({ 'design-hole-dh': 38.1, 'design-hole-spacing': 762 });
      const r = await press({ purlin: true });
      const pr = ctx.lastH2W('designPurlinResult');
      assert(pr && Array.isArray(pr.regions) && pr.regions.length > 0, 'purlin-chain result');
      assert(r.sent && r.sent.hole_shape === 'circular', 'chain body carries the hole');
      assert(pr.regions.every((g) => g.result && g.result.holes), 'every region evaluated the holes');
      assert(/구간/.test(r.card) && /이용률/.test(r.card), 'region table');
      assert(/웹 구멍 — 부록 2/.test(r.card), 'hole card for the governing region');
      await ctx.shot('w10_joist_holes', { maxHeight: 9000 });
      // 구간 표도 같은 규칙: 가장자리 보강 구멍 + 큰 하중 → 구멍 없는 강도로도 넘는 구간은 그 상한의 비(＊), 평범한 비가 아니다
      await S('chk-hole-edge-stiffened', true);
      await ctx.tab('loads');
      await S('load-L-psf', 12);
      const mb = ctx.mark();
      await ctx.click('#btn-analyze-loads');
      await ctx.waitMsg('loadAnalysisComplete', mb.h2w, 300000);
      await ctx.settle(300);
      const r2 = await press({ purlin: true });
      const pr2 = ctx.lastH2W('designPurlinResult');
      const U = require(path.join(ctx.REPO, 'webview', 'js', 'utils.js'));
      const bad = pr2.regions.filter((g) => g.result && U.lengthBoundFailure(g.result));
      assert(bad.length > 0, 'some region fails on the strength without holes ' + JSON.stringify(pr2.regions.map((g) => [g.id, g.result && g.result.pass])));
      for (const g of bad) {
        const b = U.lengthBoundFailure(g.result);
        assert(r2.card.includes((b.ratio * 100).toFixed(1) + '%＊'), `region ${g.id}: the bound ratio ${(b.ratio * 100).toFixed(1)}%＊ in the table`);
        if (typeof g.result.utilization === 'number' && Math.abs(g.result.utilization - b.ratio) > 1e-3) {
          assert(!r2.card.includes((g.result.utilization * 100).toFixed(1) + '%\t') , `region ${g.id}: not the ordinary utilization`);
        }
      }
      assert(/종합 판정: .*(NG|불합격)/.test(r2.card), 'banner NG');
      await S('chk-hole-edge-stiffened', false);
      await S('select-hole-shape', 'none');
    });
  } finally {
    await ctx.close();
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ results, exceptions: ctx.log.exceptions,
    console: ctx.log.console.filter((c) => c.type === 'error') }, null, 1));
  console.log(`page exceptions: ${ctx.log.exceptions.length}, console errors: ${ctx.log.console.filter((c) => c.type === 'error').length}`);
  console.log(`web_options (rendered): ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length}${ONLY.length ? `, --only=${ONLY.join(',')}` : ''})`);
  if ((ONLY.length && results.length === 0) || failed.length > 0 || ctx.log.exceptions.length > 0) { process.exitCode = 1; }
  await sleep(200);
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e); process.exit(1); });
