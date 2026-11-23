/* global require, module, process */
// R2-1 — 스냅숏 비교 · 변경 묶음 · 사람 말 제목(단위는 src/mcp/siUnits.ts) · 묶음 끊기.
'use strict';
const assert = require('assert');
const { rec, suite } = require('./_harness');

async function run() {
  const { t, done } = suite('records_changes');
  const D = rec('differ'), T = rec('changeText'), CH = rec('changes'), F = rec('fp');
  const SI = rec('../mcp/siUnits');

  // 템플릿으로 다시 만든 립 Z: 두께만 바뀌었지만 절점 좌표 · 요소 두께가 모두 바뀐다
  const T20 = 2 / 25.4, T23 = 2.3 / 25.4;
  const zModel = (t) => ({
    sectionTemplate: 'lippedz', sectionParams: { H: 200 / 25.4, B: 75 / 25.4, D: 20 / 25.4, t, r: 4 / 25.4 },
    node: Array.from({ length: 37 }, (_, i) => [i + 1, i * t, i * 0.1 + t, 1, 1, 1, 1, 50]),
    elem: Array.from({ length: 36 }, (_, i) => [i + 1, i + 1, i + 2, t, 100]),
    prop: [[100, 29500, 29500, 0.3, 0.3, 11300]], BC: 'S-S', lengths: [1, 2, 3], neigs: 10, loadCase: 'bending_xx_pos', loadFy: 50,
  });
  const info = (k) => ({ fy: { group: 'material', unit: 'stress' }, Lb: { group: 'design', unit: 'length' }, memberType: { group: 'member', unit: null } }[k] || null);
  const label = (p) => ({ 'case.inputs.fy': '설계 Fy', 'case.inputs.Lb': '비지지 길이 Lb' }[p] || null);
  const snap = (model, inputs = {}, spans = null, mcpOnly = {}) => ({ model, case: { inputs, spans, mcpOnly } });

  await t('template regeneration: one meaningful field (t) + summaries; title "두께 t 2 → 2.3 mm" in SI, inches in US', () => {
    const d = D.diffSnapshots(snap(zModel(T20)), snap(zModel(T23)), info);
    assert.deepStrictEqual(d.fields.map((f) => f.path), ['model.sectionParams.t', 'model.elem', 'model.node']);
    const elem = d.fields.find((f) => f.path === 'model.elem');
    assert.deepStrictEqual([elem.summary.changed, elem.summary.columns], [36, ['t']]);
    assert.strictEqual(T.changeTitle(d.fields, 'SI'), '두께 t 2 → 2.3 mm');
    assert.strictEqual(T.changeTitle(d.fields, 'US'), `두께 t ${T.formatNumber(T20)} → ${T.formatNumber(T23)} in`);
  });
  await t('case inputs: unit from the field table via siUnits.CASE_UNIT_KIND; labels from the host; SI = toSI(US)', () => {
    const d = D.diffSnapshots(snap({}, { fy: 42.786, Lb: 96 }), snap({}, { fy: 50, Lb: 72 }), info);
    assert.deepStrictEqual(d.fields.map((f) => [f.path, f.group, f.unit]), [['case.inputs.Lb', 'design', 'length'], ['case.inputs.fy', 'material', 'stress']]);
    const fyText = T.fieldText(d.fields[1], 'SI', label);
    assert.strictEqual(fyText, `설계 Fy ${T.formatNumber(SI.toSI(42.786, 'stress'))} → ${T.formatNumber(SI.toSI(50, 'stress'))} MPa`);
    assert.strictEqual(T.fieldText(d.fields[0], 'US', label), '비지지 길이 Lb 96 → 72 in');
    assert.strictEqual(T.changeTitle(d.fields, 'SI', label), `비지지 길이 Lb ${T.formatNumber(96 * 25.4)} → ${T.formatNumber(72 * 25.4)} mm 외 1`);
  });
  await t('titles state from → to only — no engineering words, no judgement', () => {
    const d = D.diffSnapshots(snap(zModel(T20), { fy: 50 }), snap({ ...zModel(T23), BC: 'C-C', loadFy: 35 }, { fy: 35 }), info);
    for (const f of d.fields) {
      const s = T.fieldText(f, 'SI', label);
      assert(/→/.test(s) || /바뀜/.test(s), s);
      assert(!/(안전|위험|OK|NG|부족|충분|좋|나쁨|권장|safe|unsafe)/i.test(s), s);
    }
  });
  await t('material, analysis conditions, spans, supports, laps, MCP-only arguments are all compared', () => {
    const s0 = { spans: [20, 20], supports: ['P', 'P', 'P'], lapsPerSupport: [{ left: null, right: null }, { left: 1.5, right: 1.5 }, { left: null, right: null }] };
    const s1 = { spans: [20, 25, 20], supports: ['P', 'R', 'P', 'P'], lapsPerSupport: [{ left: null, right: null }, { left: 2, right: 1.5 }, { left: null, right: null }, { left: null, right: null }] };
    const m0 = zModel(T20), m1 = { ...zModel(T20), prop: [[100, 29000, 29000, 0.3, 0.3, 11200]], BC: 'C-C', neigs: 7, loadFy: 35, lengths: [1, 2] };
    const d = D.diffSnapshots(snap(m0, {}, s0, { aisi_design_flexure: { moment_sign: 'positive' } }), snap(m1, { memberType: 'flexure' }, s1, { aisi_design_flexure: { moment_sign: 'negative' } }), info);
    const paths = d.fields.map((f) => f.path);
    for (const p of ['model.prop.E', 'model.prop.Ey', 'model.prop.G', 'model.BC', 'model.neigs', 'model.loadFy', 'model.lengths', 'case.inputs.memberType',
      'case.spans.spans[1]', 'case.spans.spans[2]', 'case.spans.supports[1]', 'case.spans.supports[3]', 'case.spans.lapsPerSupport[1].left', 'case.mcpOnly.aisi_design_flexure.moment_sign']) {
      assert(paths.includes(p), p);
    }
    assert.strictEqual(d.fields.find((f) => f.path === 'case.spans.spans[1]').unit, 'length_ft');
    assert.strictEqual(T.fieldText(d.fields.find((f) => f.path === 'case.spans.spans[1]'), 'SI'), `경간 2 ${T.formatNumber(20 * 0.3048)} → ${T.formatNumber(25 * 0.3048)} m`);
    assert.strictEqual(T.fieldText(d.fields.find((f) => f.path === 'model.lengths'), 'SI'), '반파장 3 → 2개');
  });
  await t('hand-edited section compares by index; more than 200 fields → 200 kept and the rest counted', () => {
    const m0 = zModel(T20), m1 = JSON.parse(JSON.stringify(m0));
    m1.node[4][1] += 0.5; m1.node.push([38, 9, 9, 1, 1, 1, 1, 50]);
    const d = D.diffSnapshots(snap(m0), snap(m1));
    assert.deepStrictEqual(d.fields[0].summary, { count: { from: 37, to: 38 }, changed: 1, added: 1, removed: 0, indices: [5], columns: ['x'] });
    const many0 = {}, many1 = {};
    for (let i = 0; i < 250; i += 1) { many0[`k${i}`] = i; many1[`k${i}`] = i + 1; }
    const big = D.diffSnapshots(snap({}, many0), snap({}, many1));
    assert.strictEqual(big.fields.length, 200);
    assert.strictEqual(big.omitted, 50);
  });
  await t('buildChange: null when nothing differs; fingerprints before / after; reason checked, control characters removed', () => {
    const ctx = { caseId: 'cabcdefghijklmnop', actor: { kind: 'ai', client: 'claude' }, trigger: 'set_section_template' };
    assert.strictEqual(CH.buildChange(ctx, snap(zModel(T20)), snap(zModel(T20))), null);
    const b = CH.buildChange({ ...ctx, reason: 't 2.0 에서\u0007 뒤틀림 NG', work: 'I-1', source: 'S-2' }, snap(zModel(T20)), snap(zModel(T23)));
    assert.strictEqual(b.title, '두께 t 2 → 2.3 mm');
    assert.strictEqual(b.reason, 't 2.0 에서 뒤틀림 NG');
    assert.strictEqual(b.before.contentFp, F.contentFp(zModel(T20), { inputs: {}, spans: null, mcpOnly: {} }).contentFp);
    assert.notStrictEqual(b.before.contentFp, b.after.contentFp);
    assert.throws(() => CH.buildChange({ ...ctx, reason: 'x'.repeat(301) }, snap(zModel(T20)), snap(zModel(T23))), /longer than 300/);
    assert.throws(() => CH.buildChange({ ...ctx, work: '../x' }, snap(zModel(T20)), snap(zModel(T23))), /work item/);
    const f = CH.buildChange(ctx, snap({}), snap({}), { follows: [{ path: 'case.inputs.Mu', from: 0, to: 7.28, by: 'load-analysis' }] });
    assert(f && f.fields.length === 0 && f.follows.length === 1);
  });

  // ── 묶음 끊기 ────────────────────────────────────────────────────
  function batcher() {
    let state = snap({ v: 0 }, { a: 0 });
    let clock = 0;
    const out = [];
    const b = new CH.ChangeBatcher({ snapshot: () => JSON.parse(JSON.stringify(state)), emit: (x, c) => out.push(Object.defineProperty(x, "__actor", { value: c.actor.kind, enumerable: false })), now: () => clock, quietMs: 2000 });
    return { b, out, set: (v) => { state = snap({ v: v.v ?? state.model.v }, { a: v.a ?? state.case.inputs.a }); }, tick: (ms) => { clock += ms; } };
  }
  const ai = { caseId: 'cabcdefghijklmnop', actor: { kind: 'ai', request: 'r1' }, trigger: 'set_case_inputs' };
  const person = { caseId: 'cabcdefghijklmnop', actor: { kind: 'person' }, trigger: 'edit-session' };
  await t('one MCP request = one change set; nested requests of the same actor fold into the outer one', async () => {
    const x = batcher();
    await x.b.run(ai, async () => { x.set({ a: 1 }); await x.b.run(ai, () => x.set({ v: 2 })); });
    assert.strictEqual(x.out.length, 1);
    assert.deepStrictEqual(x.out[0].fields.map((f) => f.path).sort(), ['case.inputs.a']);   // 모델의 v 는 비교 대상 필드가 아니다
    await x.b.run(ai, () => {});
    assert.strictEqual(x.out.length, 1, 'no change → no set');
  });
  await t('edit session = one person set; an AI request in between is its own set and the session continues after it', async () => {
    const x = batcher();
    x.b.sessionStart(person);
    x.set({ a: 1 }); x.b.touch(person);
    await x.b.run(ai, () => x.set({ a: 5 }));
    x.set({ a: 7 }); x.b.touch(person);
    x.b.sessionEnd();
    assert.deepStrictEqual(x.out.map((c) => [c.fields[0].from, c.fields[0].to]), [[0, 1], [1, 5], [5, 7]]);
  });
  await t('discard emits nothing and says whether the content is back to the start', () => {
    const x = batcher();
    x.b.sessionStart(person);
    x.set({ a: 3 });
    assert.deepStrictEqual(x.b.sessionDiscard(), { backToStart: false });
    x.set({ a: 0 });
    x.b.sessionStart(person); x.set({ a: 9 }); x.set({ a: 0 });
    assert.deepStrictEqual(x.b.sessionDiscard(), { backToStart: true });
    assert.strictEqual(x.out.length, 0);
  });
  await t('outside the edit session, screen edits are grouped by 2 s of quiet', () => {
    const x = batcher();
    const gui = { ...person, trigger: 'webview' };
    x.set({ a: 1 }); x.b.touch(gui); x.tick(1500); x.b.tick();
    x.set({ a: 2 }); x.b.touch(gui); x.tick(1999); x.b.tick();
    assert.strictEqual(x.out.length, 0);
    x.tick(1); x.b.tick();
    assert.strictEqual(x.out.length, 1);
  });

  return done();
}
module.exports = { run };
if (require.main === module) { run().then((r) => { process.exitCode = r.pass === r.total ? 0 : 1; require('./_harness').cleanupTemps(); }); }
