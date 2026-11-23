/* global process */
// K4b — 엔진 알림의 경계(webview/js/notices.js, 계약 docs/implementation/20261123-check-contract.md §16).
//  1. US 는 엔진의 글과 글자까지 같다: 고정값 test/python/notice_render_fixture.json 의 192 쌍 전부, 영어(text) · 한국어(text_ko)
//  2. SI: 물리량 매개변수는 SI 값 · SI 단위 글자, 단위 글자가 없던 물리량에도 단위를 붙인다, quantity null 은 받은 그대로,
//     템플릿 글에 박힌 US 상수(「3/16 in」 「0.08 ≤ d ≤ 0.25 in」 「95 ksi」 「33 ft」)도 SI — SI 로 읽는 글에 US 수가 남지 않는다
//  3. Python format(fixed 의 짝수 반올림 · g · e · repr)과 JSON 이 가르지 못하는 3 / 3.0
//  4. 읽는 꼴(forReader): 옛 글 목록 → {code, text}(한국어 · 그 단위), 이유 → 한국어 + reason_code, 영어 이름은 뺀다, 하위 묶음의 같은 글도
//  5. 목록 도우미(utils.warningsList …) · 패스너 이름표 · 검토 항목(readerCheck) · 호스트 글(textMap)
'use strict';
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const N = require(path.join(ROOT, 'webview', 'js', 'notices.js'));
const U = require(path.join(ROOT, 'webview', 'js', 'utils.js'));
const FIX = require(path.join(ROOT, 'test', 'python', 'notice_render_fixture.json'));

const notes = [];
const US_NUM = /(^|[^A-Za-z0-9_.])\d+(?:\.\d+)?\s?(in\b|in\.|ksi|kips?\b|kip-in)/;

// 1 ─────────────────────────────────────────────────────────────────
{
  let n = 0;
  for (const c of FIX.pairs) {
    assert.strictEqual(N.render(c, { units: 'US', lang: 'en' }), c.text, `US en ${c.code}`);
    assert.strictEqual(N.render(c, { units: 'US', lang: 'ko' }), c.text_ko, `US ko ${c.code}`);
    n++;
  }
  assert.strictEqual(FIX.grammar, 'notice-template/1');
  notes.push(`US: ${n} fixture pairs byte for byte (en and ko)`);
}

// 2 ─────────────────────────────────────────────────────────────────
{
  let dims = 0;
  for (const c of FIX.pairs) {
    const si = N.render(c, { units: 'SI', lang: 'ko' });
    // quantity null 의 단위 글자(예 'ft' · 'kip*s^2/in^4')는 받은 그대로 — 그 밖의 US 수는 남지 않는다
    const nullUnits = (c.params || []).filter((p) => p.quantity === null && p.unit_text).length;
    if (!nullUnits) { assert(!US_NUM.test(si), `SI ${c.code} still has a US number: ${si}`); }
    for (const p of c.params || []) {
      if (!N.isDimensional(p.quantity) || typeof p.value !== 'number') { continue; }
      dims++;
      // US 가 ft 로 쓴 길이(값은 in)는 m 로
      const label = p.quantity === 'length' && p.unit_text === 'ft' ? 'm' : N.QUANTITY[p.quantity].si;
      assert(si.includes(label), `SI ${c.code}: ${p.symbol} carries ${label}: ${si}`);
    }
    for (const p of c.params || []) {
      if (p.quantity === null && typeof p.value === 'string') { assert(si.includes(N.literalToSI(p.value)) || p.notice, `SI ${c.code}: text parameter ${p.symbol} as given (its US numbers in SI)`); }
    }
  }
  const one = { code: 'x', template: 'Lap {a} < 1.5d = {b}', template_ko: '랩 {a} < 1.5d = {b}', text: 'Lap 10.00 in < 1.5d = 12.00 in', text_ko: '랩 10.00 in < 1.5d = 12.00 in',
    params: [{ symbol: 'a', value: 10, quantity: 'length', fmt: '.2f', unit_text: 'in', sep: ' ' }, { symbol: 'b', value: 12, quantity: 'length', fmt: '.2f', unit_text: 'in', sep: ' ' }] };
  assert.strictEqual(N.render(one, { units: 'SI' }), '랩 254.0 mm < 1.5d = 304.8 mm');
  const bare = { code: 'y', template: 't={t}', template_ko: 't={t}', text: 't=0.059', text_ko: 't=0.059', params: [{ symbol: 't', value: 0.059, quantity: 'length', fmt: '' }] };
  assert.strictEqual(N.render(bare, { units: 'SI' }), 't=1.50 mm', 'a physical number written without a unit gets the SI unit');
  const raw = { code: 'z', template: 'rho={rho} {u}', template_ko: 'rho={rho}', text: 'rho=7.345e-07 kip*s^2/in^4', text_ko: 'rho=7.345e-07 kip*s^2/in^4',
    params: [{ symbol: 'rho', value: 7.345e-7, quantity: null, fmt: '', unit_text: 'kip*s^2/in^4', sep: ' ' }] };
  assert.strictEqual(N.render(raw, { units: 'SI' }), 'rho=7.345e-07 kip*s^2/in^4', 'quantity null: as given in SI too');
  const md = { code: 'm', template_ko: 'ρ={rho}', template: 'rho={rho}', text: '', params: [{ symbol: 'rho', value: 7.345e-7, quantity: 'mass_density', fmt: '', unit_text: 'kip*s^2/in^4', sep: ' ' }] };
  assert(/^ρ=78\d\d(\.\d)? kg\/m³$/.test(N.render(md, { units: 'SI' })), `mass_density in kg/m³: ${N.render(md, { units: 'SI' })}`);
  for (const [us, si] of [['t > 3/16 in', 't > 4.76 mm'], ['(0.08 ≤ d ≤ 0.25 in)', '(2.03 ≤ d ≤ 6.35 mm)'], ['Fy < 95 ksi', 'Fy < 655.0 MPa'], ['span ≤ 33 ft', 'span ≤ 10.06 m'],
    ['d <= 12 in.', 'd <= 304.8 mm.'], ['7.345e-7 kip*s^2/in^4', '7.345e-7 kip*s^2/in^4'], ['2 in the web', '2 in the web'], ['1e6 ksi', '1e6 ksi'], ['E60(60 ksi)', 'E60(413.7 MPa)'],
    ['정모멘트 3.25–12.50 ft', '정모멘트 0.99–3.81 m']]) {   // ft 좌표는 자리를 늘리지 않는다(구간 이름표와 같게)
    assert.strictEqual(N.literalToSI(us), si, `literal ${us}`);
  }
  notes.push(`SI: ${dims} physical parameters in SI units, no US number left, null quantities as given, template constants (fractions, ranges, ksi, ft) converted`);
}

// 3 ─────────────────────────────────────────────────────────────────
{
  const cases = [[2.5, '.0f', '2'], [0.125, '.2f', '0.12'], [0.375, '.2f', '0.38'], [-0.0, '.2f', '-0.00'], [1234567, 'g', '1.23457e+06'], [5, 'g', '5'], [1234567.0001, 'g', '1.23457e+06'],
    [0.000012345, '.3g', '1.23e-05'], [12.5, '.4g', '12.5'], [1e-7, '.1e', '1.0e-07'], [0.1, '', '0.1'], [1e16, '', '1e+16'], [1e-5, '', '1e-05'], [3, '', '3.0']];
  for (const [v, spec, want] of cases) { assert.strictEqual(N.pyFormat(v, spec, false), want, `format(${v}, '${spec}')`); }
  assert.strictEqual(N.pyFormat(3, '', true), '3', 'an int value');
  // JSON 은 3 과 3.0 을 가르지 못한다 — US 는 엔진의 글로 정하고(같아질 때), 개수 · 글 매개변수는 정수
  const amb = { code: 'w', template: 'Ω {omega}/φ {phi} (n={n})', template_ko: 'Ω {omega}/φ {phi} (n={n})', text: 'Ω 3.0/φ 0.5 (n=4)', text_ko: 'Ω 3.0/φ 0.5 (n=4)',
    params: [{ symbol: 'omega', value: 3, quantity: 'dimensionless', fmt: '' }, { symbol: 'phi', value: 0.5, quantity: 'dimensionless', fmt: '' }, { symbol: 'n', value: 4, quantity: 'count', fmt: '' }] };
  assert.strictEqual(N.render(amb, { units: 'US' }), 'Ω 3.0/φ 0.5 (n=4)');
  notes.push(`Python format: ${cases.length} specs incl. half-even ties, g/e, repr exponents; 3 vs 3.0 settled by the engine text`);
}

// 4 ─────────────────────────────────────────────────────────────────
const RESULT = {
  warnings: ['Lap 10.00 in < 1.5d = 12.00 in', 'host-added warning'],
  assumptions: ['Inflection points taken as brace points.'],
  notices: [
    { code: 'lap.warning.g', kind: 'warning', list: 'warnings', template: 'Lap {a} < 1.5d = {b}', template_ko: '랩 {a} < 1.5d = {b}', text: 'Lap 10.00 in < 1.5d = 12.00 in', text_ko: '랩 10.00 in < 1.5d = 12.00 in',
      params: [{ symbol: 'a', value: 10, quantity: 'length', fmt: '.2f', unit_text: 'in', sep: ' ' }, { symbol: 'b', value: 12, quantity: 'length', fmt: '.2f', unit_text: 'in', sep: ' ' }] },
    { code: 'loads.assumption.i', kind: 'assumption', list: 'assumptions', template: 'Inflection points taken as brace points.', template_ko: '변곡점을 가새점으로 봄.', text: 'Inflection points taken as brace points.', text_ko: '변곡점을 가새점으로 봄.', params: [] }],
  auto_params: { unbraced: { assumptions: ['Inflection points taken as brace points.'] } },
  design_checks: [{ id: 'lap.flexure.local', name: 'Lap flexure', name_ko: '랩 휨', verdict: 'not_evaluated', reason: 'Se (effective section modulus) not given',
    reason_code: 'lap.reason.se', reason_kind: 'reason', reason_template: 'Se (effective section modulus) not given', reason_template_ko: 'Se (유효단면계수) 미입력', reason_params: [], reason_ko: 'Se (유효단면계수) 미입력' }],
  fastener_label: 'Bolt d=0.500 in',
  fastener_label_parts: { template: 'Bolt d={d}', template_ko: '볼트 d={d}', params: [{ symbol: 'd', value: 0.5, quantity: 'length', fmt: '.3f', unit_text: 'in', sep: ' ' }], values: {} },
};
{
  const r = N.forReader(RESULT, { units: 'SI', detail: 'summary' });
  assert.deepStrictEqual(r.warnings, [{ code: 'lap.warning.g', text: '랩 254.0 mm < 1.5d = 304.8 mm' }, 'host-added warning']);
  assert.deepStrictEqual(r.assumptions, [{ code: 'loads.assumption.i', text: '변곡점을 가새점으로 봄.' }]);
  assert.deepStrictEqual(r.auto_params.unbraced.assumptions, [{ code: 'loads.assumption.i', text: '변곡점을 가새점으로 봄.' }], 'a sub-block without notices: the same text via the tree');
  assert(!('notices' in r), 'the summary drops the structured notices');
  assert.deepStrictEqual([r.design_checks[0].reason, r.design_checks[0].reason_code, 'name' in r.design_checks[0], r.design_checks[0].name_ko], ['Se (유효단면계수) 미입력', 'lap.reason.se', false, '랩 휨']);
  assert(!Object.keys(r.design_checks[0]).some((k) => /^reason_(template|params|ko|kind)/.test(k)), 'structural reason fields dropped');
  assert.strictEqual(r.fastener_label, '볼트 d=12.7 mm');
  const full = N.forReader(RESULT, { units: 'SI', detail: 'full' });
  assert.strictEqual(full.notices[0].text, 'Lap 254.0 mm < 1.5d = 304.8 mm', 'full SI: the original text re-rendered');
  assert.strictEqual(full.notices[0].text_ko, '랩 254.0 mm < 1.5d = 304.8 mm');
  assert.deepStrictEqual([full.notices[0].params[0].unit_text, full.warnings[0], full.design_checks[0].reason_ko], ['mm', 'Lap 254.0 mm < 1.5d = 304.8 mm', 'Se (유효단면계수) 미입력']);
  assert.strictEqual(N.forReader(RESULT, { units: 'US', detail: 'full' }), RESULT, 'full US: as the engine returned it');
  assert.deepStrictEqual(N.forReader({ notices: ['a host list'] }, { units: 'US' }), { notices: ['a host list'] }, 'a host list named notices is left as it is');
  notes.push('forReader: {code, text} Korean in the units, reason + reason_code, no English name, sub-blocks by text, full keeps both languages');
}

// 5 ─────────────────────────────────────────────────────────────────
{
  assert.deepStrictEqual(U.warningsList(RESULT, { units: 'US' }), ['랩 10.00 in < 1.5d = 12.00 in', 'host-added warning']);
  assert.deepStrictEqual(U.warningsList(RESULT, { units: 'SI' }), ['랩 254.0 mm < 1.5d = 304.8 mm', 'host-added warning']);
  assert.deepStrictEqual(U.assumptionsList({ assumptions: ['old'] }), ['old'], 'a result without notices: the old text');
  assert.strictEqual(U.checkReason(RESULT.design_checks[0], { units: 'US' }), 'Se (유효단면계수) 미입력');
  assert.strictEqual(N.fastenerLabel(RESULT.fastener_label_parts, { units: 'US' }, RESULT.fastener_label), '볼트 d=0.500 in');
  const rc = N.readerCheck(RESULT.design_checks[0], { units: 'SI' });
  assert(rc.reason === 'Se (유효단면계수) 미입력' && !('reason_template' in rc) && rc.reason_code === 'lap.reason.se');
  const map = N.textMap(RESULT, { units: 'US' });
  assert.deepStrictEqual([map('Inflection points taken as brace points.'), map('unknown 12 in')], ['변곡점을 가새점으로 봄.', 'unknown 12 in']);
  assert.strictEqual(N.textMap(RESULT, { units: 'SI' })('unknown 12 in'), 'unknown 304.8 mm');
  notes.push('helpers: list texts in the page units, reasons, fastener label, report check, host-copied texts');
}

// 6 ─ 무늬 바꾸기: 정확히 아는 단위 낱말만, 경계가 맞을 때만(엔진 · 호스트가 내는 단위 꼴 전부 — 위첨자 · ^n · 겹단위) ───────
{
  const cases = [
    ['랩 단면 Se = 1.2345 in³ — x', '랩 단면 Se = 20230 mm³ — x'],          // 회귀: 전에는 31.4 mm³(길이로 읽음)
    ['A = 0.8134 in²', 'A = 525 mm²'], ['Ixx = 9.18 in⁴', 'Ixx = 3821004 mm⁴'], ['Ixx = 9.18 in^4', 'Ixx = 3821004 mm⁴'], ['Cw = 12 in⁶', 'Cw = 3222430398 mm⁶'],
    ['Sx = 1.5 in^3', 'Sx = 24581 mm³'], ['M = 40 kip-in', 'M = 4.52 kN-m'], ['M = 12 kip-ft', 'M = 16.27 kN-m'], ['20 psf', '0.958 kPa'], ['100 plf', '1.459 kN/m'],
    ['k = 1.5 kip/in', 'k = 262.69 kN/m'], ['Fy = 50 ksi', 'Fy = 344.7 MPa'], ['P = 3 kips', 'P = 13.34 kN'], ['P = 1 kip', 'P = 4.45 kN'], ['d <= 12 in.', 'd <= 304.8 mm.'],
    ['t > 3/16 in', 't > 4.76 mm'], ['(0.08 ≤ d ≤ 0.25 in)', '(2.03 ≤ d ≤ 6.35 mm)'], ['span ≤ 33 ft', 'span ≤ 10.06 m'],
    // 모르는 꼴 · 다른 단위계 · 단위 이름만 — 그대로
    ['7.345e-7 kip*s^2/in^4', '7.345e-7 kip*s^2/in^4'], ['0.2836 lb/in^3', '0.2836 lb/in^3'], ['in kip*s^2/in^4', 'in kip*s^2/in^4'], ['2 in the web', '2 in the web'],
    ['1e6 ksi', '1e6 ksi'], ['7850 kg/m^3', '7850 kg/m^3'], ['5 in^5', '5 in^5'], ['5 in⁵', '5 in⁵'], ['3 kip-in/rad/in', '3 kip-in/rad/in'], ['4 in-lb', '4 in-lb'],
  ];
  for (const [us, si] of cases) { assert.strictEqual(N.literalToSI(us), si, 'literal ' + us); }
  // 계약 사례(엔진 고정값 전부): code 가 있는 글에는 무늬 바꾸기가 한 번도 쓰이지 않는다(엔진 6fa25f7 — 글로 넘기던 매개변수 둘도 조각 목록이 됐다).
  // 마지막 수단은 code 가 없는 글에만 남는다
  N.STATS.fallback.length = 0;
  for (const c of FIX.pairs) { N.render(c, { units: 'SI', lang: 'ko' }); N.render(c, { units: 'SI', lang: 'en' }); }
  const hits = [...new Set(N.STATS.fallback)].sort();
  assert.deepStrictEqual(hits, [], 'the pattern fallback never fires on coded engine text: ' + JSON.stringify(hits));
  N.STATS.fallback.length = 0;
  assert.strictEqual(N.render('span ≤ 33 ft', { units: 'SI' }), 'span ≤ 10.06 m');
  assert.deepStrictEqual(N.STATS.fallback, ['text'], 'text with no code still has the guarded fallback');
  notes.push(`pattern: ${cases.length} unit forms (in³ regression, ^n, compounds left alone); never fires on the coded corpus (${FIX.pairs.length} pairs), kept only for text with no code`);
}

// 7 ─ 호스트 알림(host.*) ───────────────────────────────────────────
{
  const codes = Object.keys(N.HOST);
  for (const code of codes) {
    const def = N.HOST[code];
    const vals = {};
    for (const m of (def.template + def.template_ko).matchAll(/\{([A-Za-z_]+)\}/g)) { vals[m[1]] = def.params[m[1]] && def.params[m[1]].quantity ? 1.5 : 'x'; }
    const n = N.hostNotice(code, vals);
    assert(typeof n.text === 'string' && n.text && !/\{[A-Za-z_]+\}/.test(n.text) && !/\{[A-Za-z_]+\}/.test(n.text_ko), code);
    assert(/[가-힣]/.test(n.text_ko) || /^[[ ]|^ \(| — /.test(def.template_ko) || def.template_ko === '[{regions}] {item}', 'Korean template: ' + code);
  }
  const se = N.hostNotice('host.lap.se_from', { Se: 1.2345, from: N.hostNotice('host.lap.from_regions', { regions: 'lap-1', support: 3 }) });
  assert.strictEqual(se.text, 'Lap section Se = 1.2345 in³ — lap_section of the purlin lap region(s) lap-1 at support 3 (Se = Mnl / Fy with Fn = Fy, no inelastic reserve, no cold work; Vn per member — Manual II-1A / II-2A)');
  assert(/^랩 단면 Se = 20230 mm³ — 지점 3 의 퍼린 랩 구간 lap-1 의 lap_section/.test(N.render(se, { units: 'SI' })), N.render(se, { units: 'SI' }));
  const lab = N.hostNotice('host.region.lap', { x0: 23.5, x1: 26, support: N.hostNotice('host.region.support', { n: 3, side: N.hostNotice('host.region.side_left') }) });
  assert.strictEqual(lab.text_ko, '랩 구간 23.50–26.00 ft (지점 3 왼쪽)');
  assert.strictEqual(N.render(lab, { units: 'SI' }), '랩 구간 7.16–7.92 m (지점 3 왼쪽)');
  N.STATS.fallback.length = 0;
  N.render(se, { units: 'SI' }); N.render(lab, { units: 'SI' });
  assert.deepStrictEqual(N.STATS.fallback, [], 'host notices never go through the pattern fallback');
  notes.push(`host registry: ${codes.length} host.* codes render in both languages; lap Se line 「${N.render(se, { units: 'SI' }).slice(0, 26)}…」, labels in m`);
}

// 8 ─ 글 필드 · 알림 사전 · 모드 이름 · 머리(엔진 §16.10 – 16.12) ──────────────────
{
  const meth = N.hostNotice('host.purlin.vu_envelope');
  const res = { governing_check: 'Flexural strength', governing_check_id: 'member.flexure.global',
    design_checks: [{ id: 'member.flexure.global', name: 'Yielding and LTB', name_ko: '항복 및 횡비틀림좌굴', verdict: 'pass' }],
    controlling_mode: 'Local', controlling_mode_code: 'member.label.mode_local', controlling_mode_kind: 'label', controlling_mode_template: 'Local', controlling_mode_template_ko: '국부좌굴', controlling_mode_params: [],
    analysis_method: meth.text, analysis_method_code: meth.code, analysis_method_kind: meth.kind, analysis_method_template: meth.template, analysis_method_template_ko: meth.template_ko, analysis_method_params: meth.params,
    pattern: { M: 'all spans', V: 'spans 1, 3' }, pattern_notices: { M: { code: 'x.all', kind: 'label', template: 'all spans', template_ko: '모든 경간', params: [] },
      V: { code: 'x.sp', kind: 'label', template: 'spans {s}', template_ko: '경간 {s}', params: [{ symbol: 's', value: '1, 3', quantity: null, fmt: '' }] } } };
  const r = N.forReader(res, { units: 'US' });
  assert.deepStrictEqual([r.governing_check, r.controlling_mode, r.analysis_method, r.pattern], ['항복 및 횡비틀림좌굴', '국부좌굴', meth.text_ko, { M: '모든 경간', V: '경간 1, 3' }]);
  assert(!('analysis_method_template' in r) && !('pattern_notices' in r) && r.analysis_method_code === meth.code, 'the summary keeps the code, not the template fields');
  const pg = N.forPage(res, 'SI');
  assert.deepStrictEqual([pg.governing_check, pg.controlling_mode, pg.pattern.V], ['항복 및 횡비틀림좌굴', '국부좌굴', '경간 1, 3']);
  assert(pg.analysis_method_template && pg.design_checks === res.design_checks, 'the page keeps the fields and the checks');
  // 머리 — 하중 해석의 알림을 퍼린 묶음으로 옮긴 「[하중] …」 은 code 를 지킨다
  const ln = { code: 'loads.assumption.x', kind: 'assumption', list: 'assumptions', template: 'Inflection points taken as brace points.', template_ko: '변곡점을 가새점으로 봄.', params: [],
    text: 'Inflection points taken as brace points.', text_ko: '변곡점을 가새점으로 봄.' };
  const pre = N.withPrefix(ln, '[하중] ', '[하중] ', 'assumptions');
  const bundle = { assumptions: [pre.text], notices: [pre] };
  assert.deepStrictEqual(N.lines(bundle, { units: 'US' }), [{ list: 'assumptions', code: 'loads.assumption.x', kind: 'assumption', text: '[하중] 변곡점을 가새점으로 봄.' }]);
  // attachNotices: 호스트가 엮은 목록 — 같은 글의 알림(엔진 · 호스트), 모르는 글은 code null
  const host = N.hostNotice('host.purlin.vu_envelope');
  const made = new Map([[host.text, host], [pre.text, pre]]);
  const out = N.attachNotices({ assumptions: [host.text, pre.text, 'other'] }, [], made);
  assert.deepStrictEqual(out.notices.map((n) => n.code), ['host.purlin.vu_envelope', 'loads.assumption.x', null]);
  // 계산 과정의 출처 메모 · 출처 이름(§16.12)
  const chk = { id: 'c', verdict: 'pass', steps: [{ inputs: [{ symbol: 'Fy', value: 50, quantity: 'stress', source: { kind: 'material', key: 'Fy', note: 'virgin Fy', note_code: 'member.note.virgin_fy',
    note_kind: 'note', note_template: 'virgin Fy', note_template_ko: '원소재 Fy', note_params: [] } }, { symbol: 'Lb', value: 120, quantity: 'length',
    source: { kind: 'engine_default', key: 'Lb', note: 'Lb defaulted to 120 in', note_code: 'member.note.lb_default', note_kind: 'note', note_template: 'Lb defaulted to {L_default}',
    note_template_ko: 'Lb 를 {L_default} 로 둠', note_params: [{ symbol: 'L_default', value: 120, quantity: 'length', fmt: 'raw', text: '120', const: true, unit_text: 'in', sep: ' ' }] } },
    { symbol: 'Mcrl', value: 1, quantity: 'moment', source: { kind: 'buckling_analysis', method: 'fsm_minimum' } }] }] };
  const rc = N.readerCheck(chk, { units: 'SI' });
  const srcs = rc.steps[0].inputs.map((x) => x.source);
  assert.deepStrictEqual([srcs[0].note, srcs[0].kind_ko, srcs[1].note, srcs[2].method_ko], ['원소재 Fy', '재료', 'Lb 를 3048.0 mm 로 둠', 'FSM 극소']);
  assert(!('note_template' in srcs[0]) && srcs[0].note_code === 'member.note.virgin_fy', 'note fields rendered, code kept');
  notes.push('fields: {k}_* · {k}_notices · mode ids → name_ko · [하중] prefix keeps the code · trace notes and source names in Korean / SI');
}

// ── 호스트의 말 — 사람에게 가는 글마다 code · 한국어(한 표) ──
{
  const fs = require('fs');
  const src = ['src/webview/StcfsdPanel.ts', 'src/case/caseKeeper.ts', 'src/case/caseState.ts', 'src/records/desk.ts']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  // 장부의 까닭: 호스트가 쓰는 글(고정 · 모양)마다 code
  const lits = new Set();
  for (const re of [/_invalidateAnalysisState\('([^']+)'/g, /_invalidateAnalysisState\(`([^`]+)`/g, /_ledgerAdd\([^,]+, '([^']+)'/g, /_drop[A-Za-z]+\('([^']+)'/g,
    /reasonIn \?\? '([^']+)'/g, /'(Load inputs changed|Design inputs changed|Lap inputs changed)'/g]) {
    for (const m of src.matchAll(re)) { lits.add(m[1].replace(/\$\{lc\}/, 'compression').replace(/\$\{item\}/, 'ALT-1')); }
  }
  const unc = [...lits].filter((s) => !N.ledgerReason(s).code);
  assert(lits.size > 25 && !unc.length, `every ledger reason has a code (${lits.size}): ${JSON.stringify(unc)}`);
  assert.strictEqual(N.ledgerReason('Inputs changed (set_case_inputs): x').code, 'host.ledger.ai_inputs');
  assert.deepStrictEqual(N.ledgerReason('?'), { code: null, text: '?', text_ko: '?' });
  // 화면의 칸 변경 거절 · 발행 점검의 code 마다 등록표의 한국어 문장
  const codes = new Set([...src.matchAll(/reason_code: '(host\.[a-z_.]+)'/g)].map((m) => m[1]));
  for (const m of src.matchAll(/code: '([a-z-]+)'/g)) { if (/^(no-|stale-|not-evaluated|ng$|open-q|incomplete|provisional|unsaved|damaged|read-only|unknown-issue|report-notices|changed-sources|edited-previous|same-as)/.test(m[1])) { codes.add('host.issue.' + m[1]); } }
  // 사람만 하는 일의 거절(IssueRefusedError · ReviewRefusedError)과 호스트가 단 code
  for (const m of src.matchAll(/RefusedError\([^\n]*?'(host\.[a-z_.-]+)'/g)) { codes.add(m[1]); }
  for (const m of src.matchAll(/code: '(host\.review\.[a-z_]+)'/g)) { codes.add(m[1]); }
  for (const m of src.matchAll(/code: '(case-file-changed)'/g)) { codes.add('host.issue.' + m[1]); }
  for (const c of ['no-design-result', 'stale-results', 'not-evaluated', 'ng', 'open-questions', 'incomplete-reviews', 'provisional-assumptions', 'unsaved-changes', 'no-draft', 'stale-draft', 'damaged-records']) { codes.add('host.issue.pass.' + c); }
  assert(['host.issue.expired', 'host.issue.used', 'host.issue.changed', 'host.issue.failed', 'host.review.shown_differs', 'host.issue.case-file-changed'].every((c) => codes.has(c)), 'the refusal codes are found in the source: ' + [...codes].join(' '));
  assert.strictEqual(N.staleWhyKo('results (member_design)'), '결과(부재 설계)');
  const missing = [...codes].filter((c) => !(N.HOST[c] && N.HOST[c].template_ko));
  assert(codes.size >= 20 && !missing.length, `every host code has a Korean sentence (${codes.size}): ${JSON.stringify(missing)}`);
  // 기록의 사건 이름: 기록 모듈이 쓰는 사건마다 한국어
  const rec = fs.readdirSync(path.join(ROOT, 'src', 'records')).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(ROOT, 'src', 'records', f), 'utf8')).join('\n');
  const evs = new Set([...rec.matchAll(/event: '([a-z-]+)'/g)].map((m) => m[1]));
  const noKo = [...evs].filter((e) => !N.RECORD_EVENTS_KO[e]);
  assert(evs.size >= 8 && !noKo.length, `every record event has a Korean name (${[...evs].join(' ')}): ${JSON.stringify(noKo)}`);
  notes.push(`host words: ${lits.size} ledger reasons · ${codes.size} reason / blocker codes · ${evs.size} record events — each with a code and Korean`);
}

console.log(`notice_render_contract: PASS (${notes.join('; ')})`);
process.exitCode = 0;
