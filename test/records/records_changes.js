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
    // D6: 5칸 이하는 칸마다 「이름 전 → 후 단위」 를 ` · ` 로(첫 칸은 무게가 가장 큰 칸)
    assert.strictEqual(T.changeTitle(d.fields, 'SI', label), `비지지 길이 Lb ${T.formatNumber(96 * 25.4)} → ${T.formatNumber(72 * 25.4)} mm · ${fyText}`);
  });
  await t('D6: title — 1 field as it is, up to 5 fields joined with " · ", more than 5 → "first · 외 n"; cut at 160 characters', () => {
    const one = D.diffSnapshots(snap({}, { Lb: 96 }), snap({}, { Lb: 72 }), info);
    assert.strictEqual(T.changeTitle(one.fields, 'US', label), '비지지 길이 Lb 96 → 72 in');
    const k = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i + 1]));
    const k1 = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i === 2 ? 30 : i + 2]));
    const three = D.diffSnapshots(snap({}, k(3)), snap({}, k1(3)));
    assert.strictEqual(T.changeTitle(three.fields, 'US'), 'k2 3 → 30 · k0 1 → 2 · k1 2 → 3');
    const five = D.diffSnapshots(snap({}, k(5)), snap({}, k1(5)));
    assert.strictEqual(T.changeTitle(five.fields, 'US').split(' · ').length, 5);
    const seven = D.diffSnapshots(snap({}, k(7)), snap({}, k1(7)));
    assert.strictEqual(T.changeTitle(seven.fields, 'US'), 'k2 3 → 30 · 외 6');
    const long = D.diffSnapshots(snap({}, { a: 'x', b: 'y', c: 'z', d: 'w' }), snap({}, { a: 'ㄱ'.repeat(60), b: 'ㄴ'.repeat(60), c: 'ㄷ'.repeat(60), d: 'ㄹ'.repeat(60) }));
    const lt = T.changeTitle(long.fields, 'US');
    assert([...lt].length === 160 && lt.endsWith('…'), lt);
  });
  await t('D4: shown actor — old person lines of the linkage (mirror · unit-toggle) read as program, external as file only for work_log', () => {
    assert.strictEqual(CH.shownActorKind('person', 'mirror'), 'program');
    assert.strictEqual(CH.shownActorKind('person', 'unit-toggle'), 'program');
    assert.strictEqual(CH.shownActorKind('person', 'edit-session'), 'person');
    assert.strictEqual(CH.shownActorKind('external', 'external'), 'external');
    assert.strictEqual(CH.shownActorKind('external', 'external', { file: true }), 'file');
    assert.strictEqual(CH.shownActorKind('ai', 'set_case_inputs', { file: true }), 'ai');
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
    // R2-3: 줄 번호(첫 칸 — 절점 번호)도 — 화면의 강조
    assert.deepStrictEqual(d.fields[0].summary, { count: { from: 37, to: 38 }, changed: 1, added: 1, removed: 0, indices: [5], columns: ['x'], ids: { changed: [5], added: [38], removed: [] } });
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
  await t('R2-3: no read closes a bundle; a request of the same actor joins the edit session or the quiet bundle', async () => {
    const x = batcher();
    x.b.sessionStart(person);
    x.set({ a: 1 }); x.b.touch(person);
    await x.b.run(ai, () => {});                         // AI 가 묻기만 — 그대로
    await x.b.run(person, () => {});                     // 화면 자신의 읽기 — 그대로
    await x.b.run(person, () => x.set({ a: 2 }));        // 화면 자신의 쓰기 — 그 묶음에
    assert.strictEqual(x.b.pending, 'session');
    x.b.sessionEnd();
    const o1 = x.out.map((c) => [c.__actor, c.fields[0].from, c.fields[0].to]);
    assert.deepStrictEqual(o1, [['person', 0, 2]], JSON.stringify(o1));
    x.b.touch(person); x.set({ a: 3 });              // 화면은 바꾸기 전에 touch 한다(호스트와 같게)
    await x.b.run(person, () => x.set({ a: 4 }));
    await x.b.run(ai, () => {});
    assert.strictEqual(x.b.pending, 'quiet', 'the quiet bundle stays open');
    x.tick(2500); x.b.tick();
    const o2 = x.out.slice(1).map((c) => [c.__actor, c.fields[0].from, c.fields[0].to]);
    assert.deepStrictEqual(o2, [['person', 2, 4]], JSON.stringify(o2));
  });
  await t('R2-3: discard after a split session — recordDiscard writes the undo of what was already recorded', async () => {
    const x = batcher();
    x.b.sessionStart(person);
    x.set({ a: 1 }); x.b.touch(person);
    await x.b.run(ai, () => x.set({ v: 9, a: 1 }));      // AI 가 모델만(비교 밖) — 끼어듦 아님
    await x.b.run({ ...ai, trigger: 'x' }, () => x.set({ a: 1 }));
    x.set({ a: 6 }); x.b.touch(person);
    await x.b.run(ai, () => x.set({ a: 7 }));            // AI 가 바꿈 → 사람 [0→6] · AI [6→7], 다시 연다
    const d = x.b.sessionDiscard();
    assert.strictEqual(d.backToStart, true, 'nothing since the AI line');
    x.set({ a: 0 });                                      // 호스트가 시작으로 되돌렸다(사람의 몫)
    x.b.recordDiscard(person, { model: d.before.model, case: d.before.case });
    assert.deepStrictEqual(x.out.map((c) => [c.__actor, c.trigger, c.fields[0].from, c.fields[0].to]), [['person', 'edit-session', 0, 6], ['ai', 'set_case_inputs', 6, 7], ['person', 'edit-discard', 7, 0]]);
  });
  await t('discard emits nothing and says whether the content is back to the start', () => {
    const x = batcher();
    x.b.sessionStart(person);
    x.set({ a: 3 });
    // R2-3: 들어올 때의 사본도 돌려준다(호스트가 되돌린다)
    const d1 = x.b.sessionDiscard();
    assert.strictEqual(d1.backToStart, false); assert(d1.before && d1.ctx, 'the start snapshot and context');
    x.set({ a: 0 });
    x.b.sessionStart(person); x.set({ a: 9 }); x.set({ a: 0 });
    assert.strictEqual(x.b.sessionDiscard().backToStart, true);
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

  // ── 겹친 요청(호스트의 요청 처리는 비동기다) ──────────────────────────
  // 문 하나: open() 을 부를 때까지 그 요청이 멈춘다
  const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
  const lines = (x) => x.out.map((c) => [c.__actor, c.trigger, c.fields[0].from, c.fields[0].to]);
  const screen = { caseId: 'cabcdefghijklmnop', actor: { kind: 'person' }, trigger: 'get_full_state' };
  const calc = { ...ai, trigger: 'design_purlin' };
  await t('a read during a long AI request does not close its bundle: what the request writes at its end stays one AI set', async () => {
    const x = batcher();
    const g = gate();
    const req = x.b.run(calc, async () => { await g.p; x.set({ a: 5 }); });            // 계산 뒤 끝에 입력을 쓴다(applyMcp)
    await x.b.run(screen, () => {}, { readOnly: true });                                // 화면의 다시 읽기 · 보기 보고
    await x.b.run(ai, () => {}, { readOnly: true });                                    // AI 의 조회
    assert.strictEqual(x.b.pending, 'request', 'the request keeps its bundle');
    g.open(); await req;
    assert.deepStrictEqual(lines(x), [['ai', 'design_purlin', 0, 5]]);
    assert.strictEqual(x.b.pending, null);
  });
  await t('a request of another actor that changes nothing (not marked as a read) overlaps a long AI request — before or past its end: still one AI set', async () => {
    for (const endsFirst of ['person', 'ai']) {
      const x = batcher();
      const gA = gate(), gP = gate();
      const req = x.b.run(calc, async () => { await gA.p; x.set({ a: 5 }); });
      const other = x.b.run({ ...screen, trigger: 'run_case_check' }, async () => { await gP.p; });
      if (endsFirst === 'person') { gP.open(); await other; gA.open(); await req; } else { gA.open(); await req; gP.open(); await other; }
      assert.deepStrictEqual(lines(x), [['ai', 'design_purlin', 0, 5]], endsFirst);
      assert.strictEqual(x.b.pending, null);
    }
  });
  await t('a person request that writes while an AI request runs is its own set; the AI request keeps what it writes afterwards (nothing twice)', async () => {
    const x = batcher();
    const gA = gate();
    const req = x.b.run(calc, async () => { x.set({ a: 1 }); await gA.p; x.set({ a: 9 }); });
    await Promise.resolve();
    await x.b.run({ ...screen, trigger: 'alternatives' }, () => x.set({ a: 4 }));         // 「이 대안으로」 — 사람의 쓰기
    gA.open(); await req;
    assert.deepStrictEqual(lines(x), [['ai', 'design_purlin', 0, 1], ['person', 'alternatives', 1, 4], ['ai', 'design_purlin', 4, 9]]);
  });
  await t('an AI request arriving while a person request runs: the AI set is recorded and the person request closes with nothing of it', async () => {
    const x = batcher();
    const gP = gate();
    const mine = x.b.run({ ...screen, trigger: 'run_case_check' }, async () => { await gP.p; });
    await x.b.run({ ...ai, trigger: 'set_case_inputs' }, () => x.set({ a: 2 }));
    gP.open(); await mine;
    assert.deepStrictEqual(lines(x), [['ai', 'set_case_inputs', 0, 2]]);
  });
  await t('an edit on the screen while an AI request runs: the edit is the person\'s set, the request\'s later write the AI\'s (touch · touchDone)', async () => {
    const x = batcher();
    const gA = gate();
    const req = x.b.run(calc, async () => { await gA.p; x.set({ a: 9 }); });
    await Promise.resolve();
    x.b.touch(person); x.set({ a: 3 }); x.b.touchDone();                                 // 화면은 바꾸기 전에 touch, 쓴 뒤 touchDone
    assert.strictEqual(x.b.pending, 'quiet');
    gA.open(); await req;
    assert.deepStrictEqual(lines(x), [['person', 'edit-session', 0, 3], ['ai', 'design_purlin', 3, 9]]);
    assert.strictEqual(x.b.pending, null, 'the quiet bundle ended where the AI set cut in');
  });
  await t('an edit session started while an AI request runs: the request is not closed — its write becomes the AI set and the session goes on', async () => {
    const x = batcher();
    const gA = gate();
    const req = x.b.run(calc, async () => { x.set({ a: 1 }); await gA.p; x.set({ a: 9 }); });
    await Promise.resolve();
    x.b.sessionStart(person);
    x.b.touch(person); x.set({ a: 3 }); x.b.touchDone();
    gA.open(); await req;
    assert.strictEqual(x.b.pending, 'session');
    x.b.touch(person); x.set({ a: 7 }); x.b.touchDone();
    x.b.sessionEnd();
    assert.deepStrictEqual(lines(x), [['ai', 'design_purlin', 0, 1], ['person', 'edit-session', 1, 3], ['ai', 'design_purlin', 3, 9], ['person', 'edit-session', 9, 7]]);
  });
  await t('in an edit session, the person\'s edits during a long AI request stay the person\'s; a read inside the session changes nothing', async () => {
    const x = batcher();
    x.b.sessionStart(person);
    const gA = gate();
    const req = x.b.run(calc, async () => { await gA.p; x.set({ a: 9 }); });
    await Promise.resolve();
    x.b.touch(person); x.set({ a: 2 }); x.b.touchDone();
    await x.b.run(screen, () => {}, { readOnly: true });
    x.b.touch(person); x.set({ a: 3 }); x.b.touchDone();
    gA.open(); await req;
    x.b.sessionEnd();
    assert.deepStrictEqual(lines(x), [['person', 'edit-session', 0, 3], ['ai', 'design_purlin', 3, 9]]);
  });
  await t('D4: a linkage-only line is the program\'s own set (touch · flush) — it takes nothing of the person\'s set or of an AI request running as a guest', async () => {
    const x = batcher();
    const prog = { caseId: 'cabcdefghijklmnop', actor: { kind: 'program' }, trigger: 'mirror' };
    const gA = gate();
    const req = x.b.run(calc, async () => { await gA.p; x.set({ a: 9 }); });
    await Promise.resolve();
    x.b.touch(person); x.set({ a: 3 }); x.b.touchDone();
    x.tick(2500); x.b.tick();                                                              // 사람의 조용한 묶음이 닫혔다
    x.b.touch(prog); x.set({ a: 4 }); x.b.markVia('mirror'); x.b.flush();                 // 호스트: 연동만의 줄은 바로 낸다
    assert.strictEqual(x.b.pending, null);
    gA.open(); await req;
    assert.deepStrictEqual(lines(x), [['person', 'edit-session', 0, 3], ['program', 'mirror', 3, 4], ['ai', 'design_purlin', 4, 9]]);
  });
  await t('runs: a run noted inside a request goes on that request\'s set (also for a nested / overlapping one); a person set with a run ends there', async () => {
    const x = batcher();
    const g = gate();
    const outer = { ...calc }, inner = { ...ai, trigger: 'set_case_inputs' };
    const req = x.b.run(outer, async () => { x.b.noteRun(outer, 'run-1'); await g.p; x.set({ a: 5 }); });
    await x.b.run(inner, () => { x.b.noteRun(inner, 'run-2'); });                        // 같은 행위자의 겹친 요청 — 같은 묶음에
    await x.b.run(screen, () => { x.b.noteRun(screen, 'run-x'); x.set({ a: 0 }); });      // 다른 행위자 — 바뀐 것이 없으니 줄 없음
    g.open(); await req;
    assert.deepStrictEqual(x.out.map((c) => [c.__actor, c.runs]), [['ai', ['run-1', 'run-2']]]);
    // 화면의 실행이 사람의 조용한 묶음에 들면 그 묶음은 그 실행까지
    const y = batcher();
    y.b.touch(person); y.set({ a: 1 }); y.b.touchDone();
    const runCtx = { ...person, trigger: 'aisi_design' };
    await y.b.run(runCtx, () => { y.b.noteRun(runCtx, 'run-7'); });
    y.b.touch(person); y.set({ a: 2 }); y.b.touchDone();
    y.tick(2500); y.b.tick();
    assert.deepStrictEqual(y.out.map((c) => [c.fields[0].from, c.fields[0].to, c.runs || null]), [[0, 1, ['run-7']], [1, 2, null]]);
  });
  await t('overlapping requests of the same actor fold into one set even when the first one finishes first', async () => {
    const x = batcher();
    const g1 = gate(), g2 = gate();
    const r1 = x.b.run(calc, async () => { await g1.p; x.set({ a: 1 }); });
    const r2 = x.b.run({ ...ai, trigger: 'set_case_inputs' }, async () => { await g2.p; x.set({ a: 2 }); });
    g1.open(); await r1;
    assert.strictEqual(x.out.length, 0, 'still running');
    g2.open(); await r2;
    assert.deepStrictEqual(lines(x), [['ai', 'design_purlin', 0, 2]]);
  });

  await t('E10 (N-7c): thousands separators in titles and field texts — integer part ≥ 1000 only, never in decimals, exponents or short number lists; structured from/to stay numbers', () => {
    assert.strictEqual(T.formatNumber(2000), '2,000');
    assert.strictEqual(T.formatNumber(-1234.5), '-1,234.5');
    assert.strictEqual(T.formatNumber(-1234567.5), '-1,234,570', 'six significant digits, then grouped');
    assert.strictEqual(T.formatNumber(999.5), '999.5');
    assert.strictEqual(T.formatNumber(0.00012345), '0.00012345');
    assert.strictEqual(T.formatNumber(2.5e21), '2.5e+21');
    assert.strictEqual(T.groupThousands('1234.5678'), '1,234.5678');
    const d = D.diffSnapshots(snap(zModel(T20), { Lb: 2000 / 25.4 }), snap(zModel(T20), { Lb: 1800 / 25.4 }), info);
    assert.strictEqual(T.changeTitle(d.fields, 'SI', label), '비지지 길이 Lb 2,000 → 1,800 mm');
    const fr = T.fieldRecord(d.fields[0], 'SI', label);
    assert(fr.text === '비지지 길이 Lb 2,000 → 1,800 mm' && Math.abs(fr.from - 2000) < 1e-9 && Math.abs(fr.to - 1800) < 1e-9, JSON.stringify(fr));
    assert.strictEqual(T.formatValue([1000, 2500], null, 'US'), '1000, 2500', 'a short list joined by commas is not grouped');
  });

  return done();
}
module.exports = { run };
if (require.main === module) { run().then((r) => { process.exitCode = r.pass === r.total ? 0 : 1; require('./_harness').cleanupTemps(); }); }
