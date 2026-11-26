/* global process */
// B1(2026-11-25) — 뜬 자릿수의 연동 줄(「Fy 295 → 294.9999999999998 MPa」). 끼운 화면이 단위를 오가며 다시 읽어 알린 수는
// 지금 값과 화면이 적는 자리(표시 단위의 유효 숫자 12 자리 — designState._applyValues · app.js refreshUnits 의 toPrecision(12),
// 쉼표 목록은 복원 때 6 자리)에서 같으면 새 값이 아니다: 상태 · 출처 · 판 · 기록이 움직이지 않는다. 다른 수는 받은 그대로.
//   node test/webview/shown_echo_contract.js
//  1. keeper(파이썬 없이): 출처마다(user · mirror · unit-toggle · file · load-analysis), 경간 표의 칸, 쉼표 목록, 거울 칸
//  2. 패널(진짜 파이썬): 단위 SI → US → SI 왕복이 변경 줄 · 결과 무효화를 남기지 않고, 그 뒤의 진짜 연동 줄에 왕복의 꼬리가 섞이지 않는다
'use strict';
const assert = require('assert');
const path = require('path');
const { loadTs, makeFakeVscode, createPanel, ROOT } = require('./panel_harness');

const DS = require(path.join(ROOT, 'webview', 'js', 'designState.js'));
const F = DS.UNIT_FACTORS;
const us12 = (v) => Number(v.toPrecision(12));                       // US 화면의 글을 다시 읽은 수
const si12 = (v, u) => Number((v * F[u]).toPrecision(12)) / F[u];     // SI 화면의 글을 다시 읽은 수(fromDisplay)
const results = [];
function t(name, fn) { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e]); } }

// ── 1. keeper ──────────────────────────────────────────────────────────────
const { CaseKeeper } = loadTs(path.join('src', 'case', 'caseKeeper.ts'), makeFakeVscode({ posted: [], info: [], warn: [], error: [] }));
const fy295 = DS.defaultValue('fy');                                   // 295 MPa 의 US 값(처음 값)
const tail = 294.9999999999998 / F.stress;                            // 보고된 그 수

t('the reported tail number is shown as 295 MPa and is not the stored double', () => {
  assert.notStrictEqual(tail, fy295);
  assert.strictEqual(String(Number((tail * F.stress).toPrecision(12))), '295');
});

for (const origin of ['user', 'mirror', 'unit-toggle', 'load-analysis']) {
  t(`${origin}: a number equal to the stored value at the shown digits changes nothing (value, source, rev)`, () => {
    const k = new CaseKeeper();
    if (origin === 'load-analysis') { k.noteFreshLoadAnalysis(); }
    const before = JSON.parse(JSON.stringify(k.state));
    const r = k.edit({ origin, changes: { fy: tail, fyLoad: tail, plasticFy: tail }, baseRev: 0, seenRev: 0 });
    assert.deepStrictEqual(r.accepted, []);
    assert.deepStrictEqual(r.rejected, []);
    assert.strictEqual(k.state.inputs.fy, fy295, 'the stored double stays');
    assert.deepStrictEqual(k.state.sources, before.sources);
    assert.strictEqual(k.state.rev, before.rev);
  });
}

t('file (inside the open window): the echo does not change the stored value', () => {
  const k = new CaseKeeper();
  const st = JSON.parse(JSON.stringify(k.state));
  st.inputs.Lb = 3000 / F.length; st.sources.Lb = 'user';
  k.loadFromFile(st);
  const r = k.edit({ origin: 'file', changes: { Lb: 3000 * (1 + 1e-15) / F.length } });
  assert.deepStrictEqual(r.accepted, []);
  assert.strictEqual(k.state.inputs.Lb, 3000 / F.length);
});

t('unit-toggle: both systems are the shown digits (US text from the SI value, then back)', () => {
  const k = new CaseKeeper();
  k.edit({ origin: 'user', baseRev: 0, changes: { Lb: 3000 / F.length } });
  const rev = k.state.rev;
  const toUs = us12(3000 / F.length);
  const r1 = k.edit({ origin: 'unit-toggle', seenRev: rev, changes: { unitSystem: 'US', Lb: toUs, fy: us12(fy295) } });
  const r2 = k.edit({ origin: 'unit-toggle', seenRev: rev, changes: { unitSystem: 'SI', Lb: si12(toUs, 'length'), fy: si12(us12(fy295), 'stress') } });
  assert.deepStrictEqual([r1.accepted, r2.accepted], [[], []]);
  assert.strictEqual(k.state.inputs.Lb, 3000 / F.length);
  assert.strictEqual(k.state.inputs.fy, fy295);
  assert.strictEqual(k.state.sources.Lb, 'user');
  assert.strictEqual(k.state.rev, rev);
  assert.strictEqual(k.state.view.unitSystem, 'SI');
});

t('a genuinely different number is stored exactly as reported (13th significant digit shown → different)', () => {
  const k = new CaseKeeper();
  const v = 295.000000001 / F.stress;                                  // SI 글 「295.000000001」(12 자리) — 보인다
  const r = k.edit({ origin: 'user', baseRev: 0, changes: { fy: v } });
  assert.deepStrictEqual(r.accepted.filter((x) => x === 'fy'), ['fy']);
  assert.strictEqual(k.state.inputs.fy, v);
  assert.strictEqual(k.state.sources.fy, 'user');
  const w = 296 / F.stress;
  k.edit({ origin: 'mirror', seenRev: k.state.rev, changes: { fy: w } });
  assert.strictEqual(k.state.inputs.fy, w, 'mirror: stored exactly');
});

t('span table: echoed cells keep the stored doubles, a changed cell is stored as reported', () => {
  const k = new CaseKeeper();
  const sp0 = k.state.spans.spans.slice();
  const echo = sp0.map((x) => si12(us12(x), 'length_ft'));
  assert(echo.some((x, i) => x !== sp0[i]) || true);
  let r = k.edit({ origin: 'unit-toggle', seenRev: 0, changes: { unitSystem: 'US', spans: sp0.map(us12) } });
  assert(!r.accepted.includes('spans'), 'all cells echo: ' + JSON.stringify(r.accepted));
  assert.deepStrictEqual(k.state.spans.spans, sp0);
  const sent = sp0.map((x) => x * (1 + 1e-15));
  sent[1] = 20.123456789;
  r = k.edit({ origin: 'user', baseRev: k.state.rev, changes: { spans: sent } });
  assert(r.accepted.includes('spans'));
  const want = sp0.slice(); want[1] = 20.123456789;
  assert.deepStrictEqual(k.state.spans.spans, want, 'unchanged cells keep the stored doubles');
  // 랩 길이(객체의 칸)
  const laps0 = JSON.parse(JSON.stringify(k.state.spans.lapsPerSupport));
  const lapsSent = laps0.map((l) => ({ left: l.left == null ? l.left : l.left * (1 + 1e-15), right: l.right == null ? l.right : l.right * (1 + 1e-15) }));
  r = k.edit({ origin: 'mirror', seenRev: k.state.rev, changes: { lapsPerSupport: lapsSent } });
  assert(!r.accepted.includes('lapsPerSupport'));
  assert.deepStrictEqual(k.state.spans.lapsPerSupport, laps0);
});

t('comma lists: an echo origin is compared at the 6 digits the restore writes, the person at 12', () => {
  const k = new CaseKeeper();
  const L = [1.23456789 / F.length_ft, 2.3456789123 / F.length_ft];   // ft — 복원 글 「1.23457, 2.34568」 m
  k.edit({ origin: 'user', baseRev: 0, changes: { bracePointsFt: L } });
  const echo6 = L.map((x) => Number((x * F.length_ft).toPrecision(6)) / F.length_ft);
  let r = k.edit({ origin: 'mirror', seenRev: k.state.rev, changes: { bracePointsFt: echo6 } });
  assert(!r.accepted.includes('bracePointsFt'));
  assert.deepStrictEqual(k.state.inputs.bracePointsFt, L);
  r = k.edit({ origin: 'user', baseRev: k.state.rev, changes: { bracePointsFt: echo6 } });
  assert(r.accepted.includes('bracePointsFt'), 'the person typed the 6-digit numbers — a change');
  assert.deepStrictEqual(k.state.inputs.bracePointsFt, echo6);
});

t('a mirror field whose owner is echoed does not write the owner in its place', () => {
  const k = new CaseKeeper();
  const r = k.edit({ origin: 'user', baseRev: 0, changes: { fy: tail, fyLoad: 300 / F.stress } });
  assert.deepStrictEqual(r.accepted, []);
  assert.strictEqual(k.state.inputs.fy, fy295);
});

t('nonEchoKeys uses the same rule (the tail is an echo, a shown difference is not)', () => {
  const k = new CaseKeeper();
  assert.deepStrictEqual(k.nonEchoKeys({ fy: tail, unitSystem: 'US' }, 'unit-toggle'), ['unitSystem']);
  assert.deepStrictEqual(k.nonEchoKeys({ fy: 295.000000001 / F.stress }, 'mirror'), ['fy']);
});

t('K2 invariant (compare · shownDiffKeys): same at the shown digits passes; beyond, type, missing / extra key, key order fail', () => {
  const k = new CaseKeeper();
  const host = { Fy: fy295, t_panel: 0.5 / 25.4, I_span_in4: [9.183456789012345, 7.76], sec: { a: 1 } };
  const page = { Fy: Number(fy295.toPrecision(12)), t_panel: Number((0.5).toPrecision(12)) / 25.4, I_span_in4: [9.18345678901, 7.76], sec: { a: 1 } };
  assert.strictEqual(k.compare('x', page, host), true, 'the 12-digit page body = the exact host body');
  // 본문의 키는 단위를 모른다 — 한쪽이 어느 단위의 화면 격자 위에 있을 때 그 단위로 견준다. 12 째 자리의 1 은 다른 단위의 격자에서
  // 같아 보일 수 있다(295 MPa 의 US 값은 kN 격자 위 — 190.3222 kN). 그 자리를 넘는 차이(11 째 자리)는 늘 다르다
  assert.strictEqual(k.compare('x', { ...page, Fy: 42.786132631 }, host), false, 'a difference beyond the shown digits');
  assert.strictEqual(k.compare('x', { ...page, t_panel: page.t_panel * (1 + 1e-10) }, host), false, 'a difference beyond the shown digits (t_panel)');
  assert.strictEqual(k.compare('x', { ...page, Fy: String(page.Fy) }, host), false, 'type');
  const { sec: _s, ...noSec } = page; void _s;
  assert.strictEqual(k.compare('x', noSec, host), false, 'missing key');
  assert.strictEqual(k.compare('x', { ...page, extra: null }, host), false, 'extra key (also null)');
  assert.strictEqual(k.compare('x', { t_panel: page.t_panel, Fy: page.Fy, I_span_in4: page.I_span_in4, sec: page.sec }, host), false, 'key order');
  assert.strictEqual(k.compare('x', { ...page, I_span_in4: [9.18345678901] }, host), false, 'array length');
  assert(k.shadow.slice(-8).every((x, i) => x.same === (i === 0)), 'the shadow log records same / different');
  // 쉼표 목록 칸에서 온 본문 키(I_span_in4 · brace_points_ft)는 그 칸의 단위 · 6 자리로(화면이 목록을 6 자리로 적는다)
  const ix6 = (v) => Number((v * F.inertia).toPrecision(6)) / F.inertia;
  assert.strictEqual(k.compare('x', { I_span_in4: [ix6(9.18), ix6(7.76)] }, { I_span_in4: [9.18, 7.76] }), true, 'I_span_in4 at the 6 list digits');
  assert.strictEqual(k.compare('x', { I_span_in4: [9.181, 7.76] }, { I_span_in4: [9.18, 7.76] }), false, 'I_span_in4 beyond the 6 digits');
  // 상태 = 칸(designInputs 모양): 단위는 표에서, 목록은 6 자리
  const a = { fy: fy295, bracePointsFt: [10 / 3], spans: [16.404199475065617], unitSystem: 'SI' };
  const b = { fy: si12(fy295, 'stress'), bracePointsFt: [Number((10 / 3 * F.length_ft).toPrecision(6)) / F.length_ft], spans: [si12(16.404199475065617, 'length_ft')], unitSystem: 'SI' };
  assert.deepStrictEqual(DS.shownDiffKeys(a, b), []);
  assert.deepStrictEqual(DS.shownDiffKeys(a, { ...b, fy: 296 / F.stress, unitSystem: 'US' }), ['fy', 'unitSystem']);
  const { spans: _sp, ...noSpans } = b; void _sp;
  assert.deepStrictEqual(DS.shownDiffKeys(a, noSpans), ['spans']);
});

// ── 2. 패널 ────────────────────────────────────────────────────────────────
async function panel() {
  const ctx = await createPanel();
  if (!ctx) { results.push(['panel: SKIP — no .venv python', true]); return; }
  const p = ctx.panel;
  try {
    await p.__testDispatchMessage({ command: 'caseHello', data: { inputs: null, drafts: { templateType: 'lippedc' } } });
    await p.handleMcpAction({ action: 'set_case_inputs', inputs: { Lb: 3000 / F.length } });
    const st0 = JSON.parse(JSON.stringify(p.__testGetCase().state));
    const n0 = p._memChanges.length;
    let inval = 0;
    const orig = p._invalidateDerived.bind(p);
    p._invalidateDerived = (...a) => { inval += 1; return orig(...a); };
    p.__testClearPostedMessages();
    const usLb = us12(st0.inputs.Lb), usFy = us12(st0.inputs.fy);
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'unit-toggle', seenRev: st0.rev,
      changes: { unitSystem: 'US', Lb: usLb, fy: usFy, fyLoad: usFy, plasticFy: usFy, spans: st0.spans.spans.map(us12) } } });
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'unit-toggle', seenRev: st0.rev,
      changes: { unitSystem: 'SI', Lb: si12(usLb, 'length'), fy: tail, fyLoad: tail, plasticFy: tail, spans: st0.spans.spans.map((x) => si12(us12(x), 'length_ft')) } } });
    const st1 = p.__testGetCase().state;
    t('panel: SI → US → SI leaves the inputs, sources and rev as they were', () => {
      assert.deepStrictEqual(st1.inputs, st0.inputs);
      assert.deepStrictEqual(st1.spans, st0.spans);
      assert.deepStrictEqual(st1.sources, st0.sources);
      assert.strictEqual(st1.rev, st0.rev);
    });
    t('panel: no change line and no result invalidated by the round trip', () => {
      const lines = p._memChanges.slice(n0);
      assert.strictEqual(lines.length, 0, JSON.stringify(lines.map((l) => l.body && l.body.fields)));
      assert.strictEqual(inval, 0);
      assert.strictEqual(p.__testGetPostedMessages().filter((m) => m.command === 'derivedResultsInvalidated').length, 0);
    });
    // 그 뒤의 진짜 연동(값이 바뀐 거울) — 그 줄에는 그 칸만(왕복의 꼬리가 섞이지 않는다), 값은 받은 그대로
    const w = 300 / F.stress;
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'mirror', seenRev: p.__testGetCase().state.rev, changes: { fy: w, fyLoad: w, plasticFy: w, Lb: st0.inputs.Lb * (1 + 1e-15) } } });
    t('panel: a real linkage change after it is one program line with that field only, stored exactly', () => {
      assert.strictEqual(p.__testGetCase().state.inputs.fy, w);
      assert.strictEqual(p.__testGetCase().state.inputs.Lb, st0.inputs.Lb);
      const lines = p._memChanges.slice(n0);
      assert.strictEqual(lines.length, 1, JSON.stringify(lines));
      const paths = (lines[0].body.fields || []).map((f) => f.path);
      assert(paths.includes('case.inputs.fy') && !paths.includes('case.inputs.Lb') && !paths.some((x) => /spans/.test(x)), JSON.stringify(paths));
      assert.strictEqual(lines[0].actor.kind, 'program');
    });
  } finally { ctx.close(); }
}

panel().then(() => {
  let bad = 0;
  for (const [name, ok, e] of results) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n     ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e}`}`); if (!ok) { bad += 1; } }
  console.log(`shown_echo_contract: ${results.length - bad}/${results.length} ${bad ? 'FAIL' : 'PASS'}`);
  process.exit(bad ? 1 : 0);
}).catch((e) => { console.error('shown_echo_contract: FAIL', e); process.exit(1); });
