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
      const label = N.QUANTITY[p.quantity].si;
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
    ['정모멘트 3.25–12.50 ft', '정모멘트 0.991–3.810 m']]) {
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

console.log(`notice_render_contract: PASS (${notes.join('; ')})`);
process.exitCode = 0;
