/* global process */
// B2(2026-11-25) — 끼운 화면(webview/js)의 표시 넷 + R9. 브라우저 · 파이썬 없이.
//   node test/webview/page_display_b2_contract.js
//  1. SI 결과 수는 엔진의 반올림 전 값(display_unrounded)에서 — utils.withUnroundedValues = src/mcp/siUnits.ts 의 것(같은 입력 → 같은 사본),
//     app.js 의 _fp 가 SI 화면에서 그것을 쓴다
//  2. 조항 이름표에 §E3.1.1.1(원형관 국부좌굴)
//  3. notices.render: 한국어가 등록되지 않은 알림(text_ko · template_ko null)은 엔진의 글(영어) — 빈 글을 그리지 않는다
//  4. 「부모멘트 구간 (-M)」 머리는 결과의 값(Fcre_detail · design_checks)을 읽는다 — 지금 칸(design-Lb · design-Cb · design-Mx)이 아니다
//  5. R9: cFSM 체크 다섯은 보기 설정(해석을 구속하지 않는다)이라고 화면이 밝힌다
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadTs, makeFakeVscode, ROOT } = require('./panel_harness');

const N = require(path.join(ROOT, 'webview', 'js', 'notices.js'));
const U = require(path.join(ROOT, 'webview', 'js', 'utils.js'));
const SI = loadTs(path.join('src', 'mcp', 'siUnits.ts'), makeFakeVscode({ posted: [], info: [], warn: [], error: [] }));
const appJs = fs.readFileSync(path.join(ROOT, 'webview', 'js', 'app.js'), 'utf8');
const panelTs = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'StcfsdPanel.ts'), 'utf8');
const results = [];
function t(name, fn) { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e]); } }

t('1. page withUnroundedValues = the MCP one (top level, nested groups, list entries, purlin regions)', () => {
  const r = {
    Pn: 15.68, design_strength: 13.33, shear: { Vn: 4.12, Vu: 2, display_unrounded: undefined },
    positive_region: { Mn: 30.11, Cb: 1 }, display_unrounded: { Pn: 15.6754321, design_strength: 13.3241, shear: { Vn: 4.1234567 }, positive_region: { Mn: 30.10987 } },
    limit_states: [{ Rn: 1.234, display_unrounded: { Rn: 1.23449 } }],
    regions: [{ result: { Mn: 5.55, display_unrounded: { Mn: 5.5512 } } }],
    __hold: 'x',
  };
  delete r.shear.display_unrounded;
  const a = U.withUnroundedValues(r), b = SI.withUnroundedValues(r);
  assert.deepStrictEqual(a, b);
  assert(a.used && a.value.Pn === 15.6754321 && a.value.shear.Vn === 4.1234567 && a.value.shear.Vu === 2 && a.value.positive_region.Mn === 30.10987
    && a.value.limit_states[0].Rn === 1.23449 && a.value.regions[0].result.Mn === 5.5512, JSON.stringify(a.value));
  assert.strictEqual(r.Pn, 15.68, 'the input is not changed');
  const disp = { Mu: 1.5, __display_rounded: true, display_unrounded: { Mu: 1.51 } };
  assert.strictEqual(U.withUnroundedValues(disp).value, disp, 'display-rounded summaries stay');
});
t('1. app.js _fp uses it for the SI screen only', () => {
  assert(/const _fp = \(r\) => \{[\s\S]{0,400}_unitSystem === 'SI' && _U && typeof _U\.withUnroundedValues === 'function' \? _U\.withUnroundedValues\(r\)\.value : r;[\s\S]{0,80}_N\.forPage\(src, _unitSystem\)/.test(appJs));
});
t('2. clause tip table has §E3.1.1.1', () => {
  assert(/'E3\.1\.1\.1': '[^']*Cylindrical Tubular[^']*'/.test(appJs));
});
t('3. render: an unregistered Korean text falls back to the engine text, never an empty string', () => {
  assert.strictEqual(N.render({ code: 'x.y', kind: 'warning', text: 'Engine text', text_ko: null }, { lang: 'ko' }), 'Engine text');
  assert.strictEqual(N.render({ code: 'x.y', kind: 'warning', text: 'Engine text', text_ko: '' }, { lang: 'ko' }), 'Engine text');
  assert.strictEqual(N.render({ code: 'x.y', kind: 'warning', template: 'P = {P}', template_ko: null, params: [{ symbol: 'P', value: 2, quantity: 'force', fmt: '.3f', unit: 'kips' }], text: 'P = 2.000 kips', text_ko: null }, { lang: 'ko' }).startsWith('P = 2'), true);
  assert.strictEqual(N.render({ code: 'x.y', kind: 'warning', text: null, text_ko: null }, { lang: 'ko' }), 'x.y', 'no text at all → the code, not an empty bullet');
  assert.strictEqual(N.render({ code: 'x.y', kind: 'group', parts: [], text: 'G', text_ko: null }, { lang: 'ko' }), 'G');
  // 목록 줄도
  const res = { warnings: ['Engine text'], notices: [{ list: 'warnings', code: 'x.y', kind: 'warning', text: 'Engine text', text_ko: null }] };
  const ls = N.lines(res, { units: 'US', lang: 'ko', lists: ['warnings'] });
  assert(ls.length === 1 && ls[0].text === 'Engine text', JSON.stringify(ls));
  assert.deepStrictEqual(U.warningsList(res), ['Engine text']);
});
t('4. the -M header reads the result (Fcre_detail · design_checks), not the fields', () => {
  const i = appJs.indexOf("부모멘트 구간 (-M)' + (_hp.length");
  assert(i > 0, 'header line');
  const block = appJs.slice(appJs.lastIndexOf("if (mt === 'flexure' && data.positive_region && !data.purlin_mode)", i), i);
  assert(/data\.Fcre_detail/.test(block) && /c\.group === 'member\.flexure' && c\.demand/.test(block) && /length_assumed/.test(block), block);
  assert(!/getNum\('design-(Lb|Cb|Mx)'/.test(block), 'no field read in the header');
});
t('5. R9: the cFSM checkboxes say they are a view setting that does not constrain the analysis', () => {
  const i = panelTs.indexOf('id="chk-cfsm-enable"');
  const near = panelTs.slice(i - 900, i);
  assert(/보기 설정 — 해석을 구속하지 않는다/.test(near) && /title="보기 설정 — 해석을 구속하지 않는다/.test(near), near);
});

let bad = 0;
for (const [name, ok, e] of results) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n     ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e}`}`); if (!ok) { bad += 1; } }
console.log(`page_display_b2_contract: ${results.length - bad}/${results.length} ${bad ? 'FAIL' : 'PASS'}`);
process.exit(bad ? 1 : 0);
