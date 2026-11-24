/* global process */
// K2-1 — 검토 상태의 표와 순수 함수(브라우저 · 파이썬 없이).
//   node test/webview/k2_case_state.js
// 보는 것:
//   1. 표(designState.FIELDS 의 meta 열): 소유 · 묶음 · 무효화 · 선택지가 지금 화면(입력 목록 JSON — 진짜 DOM 에서 만든 것)과 같다
//   2. 처음 값 = 지금 화면의 처음 값(SI 칸 글을 화면과 같은 식으로 US 로 — 단위 계수는 app.js 의 UNIT 줄과 바이트 대조)
//   3. snapshot · diff · 검사 · 선택지 맞추기 · 무효화 범위
//   4. 이전: 고정한 .csd 들(K2 0단계 golden)을 상태로 읽고 1.3 모양으로 다시 쓰면 같은 입력 · 1.0 · 1.2 · 1.4 왕복
//   5. 쓰기: 합치기 · 같은 값 · 충돌(baseRev) · 거울 · 접합 Fy 따름 · 경간 표 · MCP 묶음 쓰기와 「덮은 것」 목록
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const DS = require(path.join(ROOT, 'webview', 'js', 'designState.js'));
const { loadTs } = require(path.join(ROOT, 'test', 'webview', 'panel_harness.js'));
const CS = loadTs(path.join('src', 'case', 'caseState.ts'), {});
const INV = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'implementation', '20261123-k2-input-inventory.json'), 'utf8'));
const V = require(path.join(ROOT, 'test', 'rendered', 'k2', 'values.js'));
const golden = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'rendered', 'k2', 'golden', n + '.json'), 'utf8'));
const gval = (n, id) => { const e = golden(n).entries.find((x) => x.id === id); assert(e, `golden ${n}::${id}`); return e.value; };

const results = [];
function t(name, fn) {
  try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e]); }
}
const invById = new Map(INV.items.map((i) => [i.id, i]));
const MODEL_FROM_INV = INV.items.filter((i) => /host model/.test(i.default.source)).map((i) => i.id).sort();

// ── 1. 표 ─────────────────────────────────────────────────────────────────
t('every FIELDS row has a meta column with a known owner, group, invalidation and default source', () => {
  for (const r of DS.FIELDS) {
    const m = r[4];
    assert(m && ['case', 'mirror', 'model', 'view'].includes(m.owner), `${r[0]} owner`);
    assert(typeof m.group === 'string' && m.group, `${r[0]} group`);
    assert(['load', 'design', 'connection', 'analysis-at-run', 'none'].includes(m.inv), `${r[0]} inv ${m.inv}`);
    assert(['page', 'steel', 'blank', 'model', 'mirror'].includes(m.src), `${r[0]} src`);
    if (r[3] === 'sel' && m.owner !== 'model') { assert(Array.isArray(m.opts) && m.opts.length, `${r[0]} opts`); }
    if (m.owner === 'mirror') { assert(DS.fieldMeta(m.mirrorOf) && DS.fieldMeta(m.mirrorOf).owner === 'case', `${r[0]} mirrorOf`); }
  }
  const n = (o) => DS.KEYS[o].length;
  assert.strictEqual(n('case') + n('mirror') + n('model') + n('view'), DS.FIELDS.length);
});
t('owner model = the 19 controls the page overwrites from the host model (inventory)', () => {
  const ids = DS.KEYS.model.map((k) => DS.fieldMeta(k).id).sort();
  assert.deepStrictEqual(ids, MODEL_FROM_INV);
  assert.deepStrictEqual(DS.KEYS.mirror.sort(), ['fuPre', 'fyLoad', 'lapRestrainedLap', 'plasticFy']);
  assert.deepStrictEqual(DS.KEYS.view.map((k) => DS.fieldMeta(k).id).sort(),
    INV.items.filter((i) => /^chk-cfsm-/.test(i.id)).map((i) => i.id).sort());
});
t('select options equal the page <option> values in order (incl. the R 0.70 simple / continuous pair)', () => {
  for (const r of DS.FIELDS) {
    const m = r[4];
    if (r[3] !== 'sel' || m.owner === 'model') { continue; }
    const inv = invById.get(r[1]);
    const values = inv.options.map((o) => o.replace(/\[[a-z]+\]$/, ''));
    assert.deepStrictEqual(m.opts, values, r[1]);
    if (m.optSpan) { assert.deepStrictEqual(m.optSpan, inv.options.map((o) => ((/\[([a-z]+)\]$/.exec(o) || [])[1]) || null), `${r[1]} spans`); }
  }
});
t('invalidation column = today\'s rule (② tab → load, ① · ③ → design unless view-only; analysis conditions at run; ④ → connection [decision 7])', () => {
  const vo = new Map(DS.VIEW_ONLY_CONTROLS);
  for (const r of DS.FIELDS) {
    const inv = invById.get(r[1]);
    let want;
    // 계약 §6.3 의 랩 구속 진술(퍼린 탭의 칸 · 랩 탭의 거울): 하중 해석과 접합에는 쓰이지 않는다 — 부재 설계 · 랩 결과만 지운다(design)
    if (r[0] === 'lapRestrained' || r[0] === 'lapRestrainedLap') { want = 'design'; }
    else if (inv.tab === 'tab-loads') { want = 'load'; }
    else if (inv.tab === 'tab-connection') { want = 'connection'; }
    else if (vo.has(r[1])) { want = /해석 실행/.test(vo.get(r[1])) ? 'analysis-at-run' : 'none'; }
    else { want = 'design'; }
    assert.strictEqual(r[4].inv, want, `${r[0]} (#${r[1]}, ${inv.tab})`);
    if (inv.tab !== 'tab-connection') { assert.strictEqual(DS.invalidatesResults(r[1]), want !== 'none' && want !== 'analysis-at-run', `${r[1]} vs invalidatesResults`); }
  }
});

// ── 2. 처음 값 ────────────────────────────────────────────────────────────
t('unit factors are byte-identical to app.js UNIT (the page fromDisplay)', () => {
  const app = fs.readFileSync(path.join(ROOT, 'webview', 'js', 'app.js'), 'utf8');
  const a = app.indexOf('const _KIP_KN');
  const b = app.indexOf('\n    };', app.indexOf('const UNIT = {', a));
  assert(a > 0 && b > a, 'UNIT block found in app.js');
  const UNIT = vm.runInNewContext(app.slice(a, b + 7) + '\nUNIT;', { Math });
  for (const [u, def] of Object.entries(UNIT)) { assert.strictEqual(DS.UNIT_FACTORS[u], def.factor, u); }
  assert.deepStrictEqual(Object.keys(DS.UNIT_FACTORS).sort(), Object.keys(UNIT).sort());
});
t('defaults = the page\'s initial values exactly (SI field text → US with the page\'s formula), and their US display', () => {
  const bad = [];
  for (const r of DS.FIELDS) {
    const [key, id, unit, kind, m] = r;
    if (m.owner === 'model') { assert.strictEqual(DS.defaultValue(key), null, key); continue; }
    const inv = invById.get(id);
    const si = inv.default.SI, us = inv.default.US;
    const got = DS.defaultValue(key);
    let want;
    if (kind === 'chk') { want = si; }
    else if (kind === 'sel') { want = si; }
    else if (kind === 'list') { want = si === '' ? null : si.split(/[,;\s]+/).map(Number).map((v) => DS.siToUs(v, unit)); }
    else { want = si === '' ? null : DS.siToUs(parseFloat(si), unit); }
    if (JSON.stringify(got) !== JSON.stringify(want)) { bad.push(`${key}: table ${JSON.stringify(got)} ≠ page ${JSON.stringify(want)} (SI ${JSON.stringify(si)})`); }
    // US 화면(단위 전환 = 12 자리)과도 맞는다
    if (kind === 'num' && got !== null && unit) {
      const usText = String(Number(got.toPrecision(12)));
      if (usText !== String(Number(parseFloat(us).toPrecision(12)))) { bad.push(`${key}: US display ${usText} ≠ page ${us}`); }
    }
  }
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});
// 2026-11-25: 길이 넷(KxLx · KyLy · KtLt · Lb)을 빈 칸으로, 냉간가공을 끔으로 — 손으로 정한 공학 기본값 44 → 39
t('the 39 hard-coded engineering defaults are in the table unchanged and marked page', () => {
  const ids = INV.summary.hardCodedEngineeringDefaults.filter((id) => !id.startsWith('.'));
  for (const id of ids) {
    const r = DS.FIELDS.find((x) => x[1] === id);
    assert(r, id);
    assert.strictEqual(r[4].src, id === 'input-steel-grade' ? 'steel' : 'page', id);
    assert.notStrictEqual(DS.defaultValue(r[0]), null, id);
  }
  assert.strictEqual(INV.summary.hardCodedEngineeringDefaults.length, 39);
});
t('steel defaults come from the SGC400 row (295 / 400 MPa) of src/webview/steelGrades.ts', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'steelGrades.ts'), 'utf8');
  assert(/\{ id: 'SGC400', Fy: mpa\(295\), Fu: mpa\(400\)/.test(src) && /DEFAULT_STEEL_GRADE = 'SGC400'/.test(src), 'steelGrades SGC400 row');
  assert.strictEqual(DS.defaultValue('fy') * DS.UNIT_FACTORS.stress, 295);
  assert.strictEqual(DS.defaultValue('fu') * DS.UNIT_FACTORS.stress, 400);
  assert.strictEqual(DS.defaultValue('presteelGrade'), 'SGC400');
  assert.strictEqual(DS.defaultValue('fyLoad'), DS.defaultValue('fy'));
  assert.strictEqual(DS.defaultValue('connFy'), DS.defaultValue('fy'));
});
t('span table defaults = buildSpanTable (cont-3: 5 m spans, P supports, laps 0, no outer lap cells)', () => {
  const d = DS.defaultSpanTable('cont-3', 5);
  const s = DS.siToUs(5, 'length_ft');
  assert.deepStrictEqual(d, { spans: [s, s, s], supports: ['P', 'P', 'P', 'P'],
    lapsPerSupport: [{ left: null, right: 0 }, { left: 0, right: 0 }, { left: 0, right: 0 }, { left: 0, right: null }] });
  assert.strictEqual(String(invById.get('.span-tbl-len').default.SI), '5.00');
  assert.deepStrictEqual(DS.defaultSpanTable('cantilever', 1).supports, ['F', 'N']);
  assert.deepStrictEqual(DS.defaultSpanTable('simple', 1).lapsPerSupport, [{ left: null, right: null }, { left: null, right: null }]);
  assert.strictEqual(DS.defaultSpanTable('cont-n', 4).spans.length, 4);
});

// ── 3. snapshot · diff · 검사 ─────────────────────────────────────────────
function fakeDocument(values) {
  const els = {};
  for (const [key, id, , kind] of DS.FIELDS) {
    const v = values[key];
    els[id] = kind === 'chk' ? { checked: !!v } : { value: v == null ? '' : (Array.isArray(v) ? v.join(', ') : String(v)) };
  }
  const span = values.spans || [], sup = values.supports || [], laps = values.lapsPerSupport || [];
  const q = {
    '.span-tbl-len': span.map((v) => ({ value: v == null ? '' : String(v) })),
    '.span-tbl-sup': sup.map((v) => ({ value: v })),
  };
  return {
    getElementById: (id) => els[id] || null,
    querySelectorAll: (s) => q[s] || [],
    querySelector: (s) => {
      const m = /^\.span-tbl-lap([lr])\[data-idx="(\d+)"\]$/.exec(s);
      if (!m) { return null; }
      const l = laps[Number(m[2])];
      const v = l ? (m[1] === 'l' ? l.left : l.right) : null;
      return v === null || v === undefined ? null : { value: String(v) };
    },
  };
}
t('snapshot of a page showing the defaults (US) = defaultInputs for every case / mirror / view key', () => {
  const d = DS.defaultInputs();
  const snap = DS.snapshot({ document: fakeDocument(d), fromDisplay: (v) => v, getUnitSystem: () => 'US' });
  const diff = DS.diff(d, snap);
  for (const k of DS.KEYS.model) { delete diff[k]; }
  delete diff.unitSystem;
  assert.deepStrictEqual(diff, {});
});
t('diff: changed keys only, spans and unitSystem included, no-op empty', () => {
  const a = DS.defaultInputs();
  assert.deepStrictEqual(DS.diff(a, JSON.parse(JSON.stringify(a))), {});
  const b = { ...JSON.parse(JSON.stringify(a)), Lb: 72, chkColdWork: true, unitSystem: 'US', spans: [20, 25, 20] };
  assert.deepStrictEqual(DS.diff(a, b), { Lb: 72, chkColdWork: true, spans: [20, 25, 20], unitSystem: 'US' });
});
t('validateValue: unknown keys, owners, kinds, options, lists', () => {
  assert.strictEqual(DS.validateValue('Lb', 72), null);
  assert.strictEqual(DS.validateValue('Lb', null), null);
  assert(DS.validateValue('nope', 1));
  assert(DS.validateValue('analysisBC', 'C-C'), 'model key refused on the case path');
  assert.strictEqual(DS.validateValue('analysisBC', 'C-C', { owners: ['model'] }), null, 'model selects have no option list in the table (the model checks BC)');
  assert(DS.validateValue('Lb', '72'));
  assert(DS.validateValue('Lb', NaN));
  assert(DS.validateValue('chkColdWork', 1));
  assert(DS.validateValue('chkColdWork', null));
  assert.strictEqual(DS.validateValue('wcSupport', 'IOF'), null);
  assert(DS.validateValue('wcSupport', 'XYZ'));
  assert(DS.validateValue('rValue', '0.7'), 'D-2: "0.7" is not an option value');
  assert.strictEqual(DS.validateValue('spanIxIn4', [9.18, 7.76]), null);
  assert(DS.validateValue('spanIxIn4', [9.18, 'x']));
  assert(DS.validateValue('fyLoad', 50), 'mirror keys are not written directly');
});
t('matchOption: exact, numeric-equal (D-2 "0.7" → "0.70"), none', () => {
  assert.strictEqual(DS.matchOption('rValue', '0.60'), '0.60');
  assert.strictEqual(DS.matchOption('rValue', '0.7'), '0.70');
  assert.strictEqual(DS.matchOption('rValue', 0.65), '0.65');
  assert.strictEqual(DS.matchOption('rValue', '0.33'), null);
  assert.strictEqual(DS.matchOption('Lb', '1'), null);
});
t('validateSpanTable and invalidationScope', () => {
  assert.deepStrictEqual(DS.validateSpanTable(DS.defaultSpanTable('cont-n', 4), 'cont-n', 4), []);
  assert(DS.validateSpanTable(DS.defaultSpanTable('cont-3', 5), 'cont-n', 4).length > 0);
  assert(DS.validateSpanTable({ ...DS.defaultSpanTable('cont-2', 0), supports: ['P', 'X', 'P'] }, 'cont-2', 0).length > 0);
  assert.deepStrictEqual(CS.invalidationScope(['Lb']), { scope: 'design', analysisAtRun: false });
  assert.deepStrictEqual(CS.invalidationScope(['connT1', 'Lb', 'loadD']), { scope: 'load', analysisAtRun: false });
  assert.deepStrictEqual(CS.invalidationScope(['connT1']), { scope: 'connection', analysisAtRun: false });
  assert.deepStrictEqual(CS.invalidationScope(['analysisBC', 'vibRho']), { scope: 'none', analysisAtRun: true });
  assert.deepStrictEqual(CS.invalidationScope(['spans']), { scope: 'load', analysisAtRun: false });
});

// ── 4. 이전 ───────────────────────────────────────────────────────────────
const modelPart = (di) => Object.fromEntries(DS.KEYS.model.map((k) => [k, di[k]]));
function roundTrip13(saved) {
  const r = CS.migrateProject({ version: '1.3', designInputs: saved });
  return { r, back: CS.toDesignInputs13(r.state, modelPart(saved)) };
}
t('pinned 1.3 files (every input non-default, US and SI): state → 1.3 shape gives the same inputs, key order included', () => {
  for (const u of ['US', 'SI']) {
    const saved = gval('csd-roundtrip', `consistent.${u}.saved`);
    const { r, back } = roundTrip13(saved);
    assert.strictEqual(JSON.stringify(back), JSON.stringify(saved), `${u}: ${JSON.stringify(DS.diff(saved, back)).slice(0, 300)}`);
    assert.deepStrictEqual(r.warnings, [], `${u} warnings`);
    for (const k of DS.KEYS.case) { assert.strictEqual(r.state.sources[k], 'file', k); }
  }
  // US: 상태의 값 = 시험이 넣은 「처음 값과 다른」 값 그대로
  const st = roundTrip13(gval('csd-roundtrip', 'consistent.US.saved')).r.state;
  for (const k of DS.KEYS.case) { assert.deepStrictEqual(st.inputs[k], V.NON_DEFAULT[k], k); }
  assert.deepStrictEqual(st.spans, V.SPAN_TABLE);
});
t('pinned purlin save (II-2A after load analysis + lap) round-trips', () => {
  const saved = gval('gui-purlin', 'save.designInputs');
  const { back } = roundTrip13(saved);
  assert.strictEqual(JSON.stringify(back), JSON.stringify(saved), JSON.stringify(DS.diff(saved, back)));
});
// 화면은 파일을 연 뒤 β 체크에 change 를 보낸다(_fireRestoredInputUpdates) — β 가 켜져 있고 Lm 이 0 이면 toggleBeta 가 Lm 칸에
// Lb 를 넣는다(하중 해석이 없을 때). 그래서 처음 값으로 열린 파일의 저장본은 distLm = Lb 다. 상태의 이전은 그것을 흉내 내지 않는다 —
// K2-2 부터 그 쓰기는 화면의 snapshot · diff 로 상태에 들어온다. 새로 찾은 것: 설계 문서 부록 D-9.
// D-9 는 K2-3 에서 고쳤다 — 지금 저장본은 처음 값 그대로(distLm 0). 남는 차이 없음.
const OPEN_SIDE_EFFECT = [];
t('Example/test.csd (1.0, no inputs) → defaults; = the page\'s SI save of it except the β-on-open fill (D-9); US save differs only by display rounding', () => {
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'Example', 'test.csd'), 'utf8'));
  const r = CS.migrateProject(file);
  assert.strictEqual(r.fromVersion, '1.0');
  assert.deepStrictEqual(r.warnings, []);
  for (const k of DS.KEYS.case) { assert.strictEqual(r.state.sources[k], 'default', k); }
  const si = gval('examples', 'Example/test.csd.SI.saved');
  const mine = CS.toDesignInputs13(r.state, modelPart(si));
  assert.deepStrictEqual(Object.keys(DS.diff(si, mine)), OPEN_SIDE_EFFECT, 'SI save = defaults + model (D-9 fixed: no β-on-open fill)');
  assert.strictEqual(si.distLm, 0, 'D-9: the page no longer fills Lm from Lb on open');
  assert.strictEqual(JSON.stringify(Object.keys(mine)), JSON.stringify(Object.keys(si)), 'same key order');
  const us = gval('examples', 'Example/test.csd.US.saved');
  // US 화면은 처음 경간을 16.40 ft 로 적는다(toFixed(2) — 5 m 가 아니다) — 표의 defaultSpanTable(…, 'US') 가 같은 값
  assert.deepStrictEqual(us.spans, DS.defaultSpanTable('cont-3', 5, 'US').spans);
  const back = CS.toDesignInputs13({ ...r.state, spans: { ...r.state.spans, spans: DS.defaultSpanTable('cont-3', 5, 'US').spans },
    view: { ...r.state.view, unitSystem: 'US' } }, modelPart(us));
  const d = DS.diff(us, back);
  for (const [k, v] of Object.entries(d)) {
    if (OPEN_SIDE_EFFECT.includes(k)) { continue; }
    const a = us[k];
    const close = (x, y) => typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x));
    assert(close(a, v) || (Array.isArray(a) && a.every((x, i) => close(x, v[i]))), `US ${k}: ${JSON.stringify(a)} vs ${JSON.stringify(v)}`);
  }
});
t('old 1.2 file (few keys): file keys + defaults for the rest (V4-10), fy covers the mirrors', () => {
  const r = CS.migrateProject({ version: '1.2', designInputs: { unitSystem: 'US', fy: 50, Mux: 30 } });
  assert.strictEqual(r.state.inputs.fy, 50);
  assert.strictEqual(r.state.inputs.Mux, 30);
  assert.strictEqual(r.state.inputs.designMxPos, null, 'V9a-02 · contract §6.4: a demand the file did not give is blank (not 0)');
  assert.strictEqual(r.state.sources.designMxPos, 'default');
  const back = CS.toDesignInputs13(r.state);
  assert.strictEqual(back.fyLoad, 50);
  assert.strictEqual(back.plasticFy, 50);
  assert.strictEqual(back.unitSystem, 'US');
  const r2 = CS.migrateProject({ version: '1.2', designInputs: { fyLoad: 45 } });
  assert.strictEqual(r2.state.inputs.fy, 45, 'fy ?? fyLoad');
});
t('coupled material fields that disagree (pinned): state keeps one Fy 50 / Fu 65 and warns; the page re-saves that one Fu (D-3 fixed in K2-3)', () => {
  const written = { ...V.designInputs('US'), fy: 50, fyLoad: 45, plasticFy: 40, fu: 65, fuPre: 60, presteelGrade: 'A653-50' };
  const r = CS.migrateProject({ version: '1.3', designInputs: written });
  assert.strictEqual(r.state.inputs.fy, 50);
  assert.strictEqual(r.state.inputs.fu, 65);
  assert(r.warnings.some((w) => /Fy 가 탭마다/.test(w)) && r.warnings.some((w) => /Fu 가 탭마다/.test(w)));
  const today = gval('csd-roundtrip', 'coupled.saved');
  assert.strictEqual(today.fuPre, 65, 'the page re-saves one Fu 65 (D-3 fixed in K2-3 — before, it kept ① Fu 60)');
  assert.strictEqual(CS.toDesignInputs13(r.state).fuPre, 65, 'the state writes one Fu');
});
t('R 0.70 in a file: read as the first (simple) option, with a warning (D-1 — the page fix comes with K2-2)', () => {
  const r = CS.migrateProject({ version: '1.3', designInputs: { rValue: '0.70', chkRFactor: true } });
  assert.strictEqual(r.state.inputs.rValue, '0.70');
  assert(r.warnings.some((w) => /0\.70/.test(w)));
  const r2 = CS.migrateProject({ version: '1.3', designInputs: { rValue: '0.7' } });
  assert.strictEqual(r2.state.inputs.rValue, '0.70', 'D-2 value normalised');
});
t('unknown and malformed keys are dropped with a warning; model keys become drafts; span cells outside the table are ignored', () => {
  const r = CS.migrateProject({ version: '1.3', designInputs: { bogus: 1, Lb: 'x', wcSupport: 'XYZ', analysisBC: 'C-C', spanType: 'simple',
    spans: [10, 20], lapsPerSupport: [{ left: 3, right: 4 }, { left: 5, right: 6 }] } });
  assert(r.warnings.some((w) => /bogus/.test(w)) && r.warnings.some((w) => /wcSupport/.test(w)));
  assert.strictEqual(r.state.inputs.Lb, null, 'non-number → blank (restore shows an empty field)');
  assert.strictEqual(r.state.inputs.wcSupport, 'EOF');
  assert.deepStrictEqual(r.modelDrafts, { analysisBC: 'C-C' });
  assert.deepStrictEqual(r.state.spans.spans, [10]);
  assert.deepStrictEqual(r.state.spans.lapsPerSupport, [{ left: null, right: null }, { left: null, right: null }]);
});
t('.csd 1.4 case record round-trips; foreign keys in case are dropped', () => {
  const s = roundTrip13(gval('csd-roundtrip', 'consistent.SI.saved')).r.state;
  const rec = JSON.parse(JSON.stringify(CS.toCaseRecord(s)));
  const r = CS.migrateProject({ version: '1.4', case: rec, designInputs: { Lb: 1 } });
  assert.deepStrictEqual(r.warnings, []);
  assert.deepStrictEqual(r.state.inputs, s.inputs);
  assert.deepStrictEqual(r.state.spans, s.spans);
  assert.deepStrictEqual(r.state.view, s.view);
  const bad = CS.migrateProject({ version: '1.4', case: { ...rec, inputs: { ...rec.inputs, analysisBC: 'C-C', mcpServers: 1 } } });
  assert(bad.warnings.some((w) => /analysisBC/.test(w)) && bad.warnings.some((w) => /mcpServers/.test(w)));
  assert(!('analysisBC' in bad.state.inputs) && !('mcpServers' in bad.state.inputs));
});

// ── 5. 쓰기 ───────────────────────────────────────────────────────────────
t('applyChanges: merge, no-op, rev, sources, mirrors, connection Fy follows, unitSystem not counted', () => {
  let s = CS.createCaseState();
  let r = CS.applyChanges(s, { Lb: 72 }, 'user');
  assert.deepStrictEqual([r.accepted, r.state.rev, r.state.sources.Lb], [['Lb'], 1, 'user']);
  s = r.state;
  r = CS.applyChanges(s, { Lb: 72, unitSystem: 'US' }, 'user');
  assert.deepStrictEqual([r.accepted, r.state.rev, r.state.view.unitSystem], [[], 1, 'US'], 'same value and unit toggle do not count');
  r = CS.applyChanges(s, { fyLoad: 50, plasticFy: 50 }, 'user');
  assert.deepStrictEqual(r.accepted, ['fy', 'connFy']);
  assert.strictEqual(r.state.inputs.connFy, 50);
  assert.strictEqual(r.state.sources.connFy, 'mirror');
  r = CS.applyChanges(s, { fy: 50, connFy: 48 }, 'user');
  assert.strictEqual(r.state.inputs.connFy, 48, 'an explicit connection Fy in the same change wins');
  r = CS.applyChanges(s, { Lb: 'x', analysisBC: 'C-C' }, 'user');
  assert.deepStrictEqual(r.rejected.map((x) => x.key), ['Lb', 'analysisBC']);
  assert.strictEqual(r.state.rev, 1);
});
t('applyChanges: a page edit made before an AI write does not overwrite that key (baseRev), other keys pass', () => {
  let s = CS.createCaseState();
  s = CS.applyChanges(s, { Lb: 72 }, 'user').state;             // rev 1
  s = CS.applyChanges(s, { Lb: 96 }, 'ai').state;                // rev 2
  const r = CS.applyChanges(s, { Lb: 80, Cb: 1.2 }, 'user', { baseRev: 1 });
  assert.deepStrictEqual(r.conflicts, ['Lb']);
  assert.strictEqual(r.state.inputs.Lb, 96);
  assert.strictEqual(r.state.inputs.Cb, 1.2);
  const r2 = CS.applyChanges(s, { Lb: 80 }, 'user', { baseRev: 2 });
  assert.deepStrictEqual([r2.conflicts, r2.state.inputs.Lb], [[], 80], 'seen the AI value → may change it');
});
t('applyChanges: span type change rebuilds the table like buildSpanTable; a table edit is checked against the new count', () => {
  let s = CS.createCaseState();
  let r = CS.applyChanges(s, { spanType: 'cont-n', nSpans: 4 }, 'user');
  assert.strictEqual(r.state.spans.spans.length, 4);
  assert(r.accepted.includes('spans') && r.state.sources.spans === 'default');
  s = r.state;
  r = CS.applyChanges(s, { spans: [20, 25, 25, 20], supports: ['P', 'R', 'P', 'R', 'P'] }, 'user');
  assert.deepStrictEqual(r.state.spans.spans, [20, 25, 25, 20]);
  r = CS.applyChanges(s, { spans: [20, 25] }, 'user');
  assert.deepStrictEqual(r.rejected.map((x) => x.key), ['spans']);
});
t('replaceGroup (decision 1): the group becomes what the tool got (others blank, selects / checks too) and lists the person values it replaced', () => {
  let s = CS.createCaseState();
  s = CS.applyChanges(s, { Lb: 72, Cb: 1.14 }, 'user').state;
  s = CS.applyChanges(s, { wcN: 2 }, 'file').state;   // 파일에서 온 값
  const r = CS.replaceGroup(s, ['Lb', 'Cb', 'Mux', 'wcN', 'wcSupport', 'chkColdWork'], { Lb: 96, Mux: 40 });
  assert.strictEqual(r.state.inputs.Lb, 96);
  assert.strictEqual(r.state.inputs.Cb, null);
  assert.strictEqual(r.state.inputs.wcSupport, null);
  assert.strictEqual(r.state.inputs.chkColdWork, null);
  assert.strictEqual(r.state.sources.Cb, 'ai');
  assert.deepStrictEqual(r.replaced.map((x) => [x.key, x.previous, x.previousSource]).sort(),
    [['Cb', 1.14, 'user'], ['Lb', 72, 'user'], ['wcN', 2, 'file']].sort());
  assert(!r.replaced.some((x) => x.key === 'Mux' || x.key === 'wcSupport'), 'defaults are not reported as replaced');
  assert(CS.replaceGroup(s, ['Lb'], { Lb: 'x' }).rejected.length === 1);
});

const failed = results.filter((r) => !r[1]);
for (const [name, ok, e] of results) { if (!ok) { console.error(`  FAIL ${name}\n       ${String(e && e.message || e).split('\n').join('\n       ')}`); } }
if (failed.length) { console.error(`k2_case_state: FAIL (${results.length - failed.length}/${results.length})`); process.exit(1); }
console.log(`k2_case_state: PASS (${results.length} checks — ${DS.FIELDS.length} table rows: case ${DS.KEYS.case.length} · mirror ${DS.KEYS.mirror.length} · model ${DS.KEYS.model.length} · view ${DS.KEYS.view.length})`);
