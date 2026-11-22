// W3: .csd v1.3 입력 저장 · 복원 계약 — G2 §3.2 의 저장되지 않던 9 칸, 묶음 2 의 새 입력, 빈 칸(null) 왕복,
// US 내부값 저장(단위계가 바뀌어도 같은 값), 표 채움이 동기(100 ms 타이머 없음), 복원 뒤 연동 hook 호출.
const assert = require('assert');
const path = require('path');
const ds = require(path.join(__dirname, '..', '..', 'webview', 'js', 'designState.js'));

const FACT = { length: 25.4, length_ft: 0.3048, stress: 6.89476, force: 4.44822, moment: 0.11298,
  pressure: 0.04788, thickness: 25.4, radius: 25.4, rotStiff: 4.44822, latStiff: 4.44822 / 0.0254 / 0.0254,
  density: 4448.2216152605 / Math.pow(0.0254, 4), inertia: 416231.0 };

function makeDoc() {
  const byId = new Map();
  const spans = [{ value: '' }, { value: '' }];
  return {
    byId, spans,
    el(id, value = '', checked) {
      const e = { value: String(value), checked: !!checked, style: {} };
      byId.set(id, e);
      return e;
    },
    getElementById: (id) => byId.get(id) || null,
    querySelectorAll: (sel) => (sel === '.span-tbl-len' ? spans : []),
    querySelector: () => null,
  };
}

function deps(doc, sys) {
  const toD = (v, ut) => (sys === 'SI' && ut ? v * FACT[ut] : v);
  const fromD = (v, ut) => (sys === 'SI' && ut ? v / FACT[ut] : v);
  return {
    document: doc,
    fromDisplay: fromD,
    toDisplay: toD,
    getNum: (id, fb) => { const e = doc.getElementById(id); const v = e ? parseFloat(e.value) : NaN; return isFinite(v) ? v : fb; },
    getUnitSystem: () => sys,
  };
}

function main() {
  const NEW_IDS = ['design-Mx-pos', 'design-Lb-pos', 'design-Cb-pos', 'design-dist-M1M2', 'design-dist-Lm',
    'conn-edge-dist', 'input-E', 'input-G', 'input-v', 'vib-rho', 'deck-insulation', 'deck-R-tested',
    'conn-e', 'conn-s', 'conn-Tu', 'conn-width', 'conn-Pnvs', 'conn-dw', 'conn-lap-Pnvs'];
  const src = makeDoc();
  const vals = {
    'design-Mx-pos': '5.5', 'design-Lb-pos': '1200', 'design-Cb-pos': '1.3', 'design-dist-M1M2': '-0.4',
    'design-dist-Lm': '900', 'conn-edge-dist': '', 'input-E': '203395', 'input-G': '77911', 'input-v': '0.3',
    'vib-rho': '7850', 'deck-insulation': '', 'deck-R-tested': '0.62', 'conn-e': '25', 'conn-s': '',
    'conn-Tu': '1.2', 'conn-width': '150', 'conn-Pnvs': '', 'conn-dw': '9.5', 'conn-lap-Pnvs': '4.1',
  };
  for (const id of NEW_IDS) { src.el(id, vals[id]); }
  src.el('select-r-value', '0.70');
  src.el('conn-member-case', 'not_tension_member');
  src.el('brace-points', '3.0, 6.1');
  src.el('span-Ix-list', '');
  src.el('chk-i621-confirmed', '', true);
  src.el('chk-pattern-loading', '', false);
  src.el('chk-lr-reduced', '', true);
  src.el('conn-j63-na', '', true);
  src.el('input-load-P', '10');
  src.el('input-load-Mxx', '2');
  src.el('input-load-Mzz', '0');

  const data = ds.collectDesignInputs(deps(src, 'SI'));
  // US 내부값으로 저장
  assert(Math.abs(data.vibRho - 7850 / FACT.density) < 1e-18, 'density stored in kip*s^2/in^4');
  assert(Math.abs(data.vibRho - 7.345e-7) / 7.345e-7 < 1e-3, '7850 kg/m^3 = 7.345e-7 kip*s^2/in^4 (closed form)');
  assert.strictEqual(data.connEdgeDist, null, 'empty end distance saved as null (not 0)');
  assert.strictEqual(data.connS, null, 'empty spacing saved as null');
  assert(Math.abs(data.designLbPos - 1200 / 25.4) < 1e-12, 'Lb_pos in inches');
  assert.deepStrictEqual(data.bracePointsFt.map((v) => +v.toFixed(9)), [3.0 / 0.3048, 6.1 / 0.3048].map((v) => +v.toFixed(9)),
    'brace points list in ft');
  assert.strictEqual(data.spanIxIn4, null, 'empty Ix list -> null');
  assert.strictEqual(data.chkI621Confirmed, true);
  assert.strictEqual(data.chkPatternLoading, false);
  assert.strictEqual(data.connMemberCase, 'not_tension_member');
  assert(Math.abs(data.analysisLoadPUs - 10 / FACT.force) < 1e-12, 'custom P stored as US value');

  // 다른 단위계(US)의 화면으로 복원 — 값은 US 로 보인다. 연동 hook 은 한 번, 경간 표는 즉시.
  const dst = makeDoc();
  for (const id of NEW_IDS) { dst.el(id, 'x'); }
  ['select-r-value', 'conn-member-case', 'brace-points', 'span-Ix-list'].forEach((id) => dst.el(id, 'x'));
  ['chk-i621-confirmed', 'chk-pattern-loading', 'chk-lr-reduced', 'conn-j63-na'].forEach((id) => dst.el(id, '', false));
  ['input-load-P', 'input-load-Mxx', 'input-load-Mzz'].forEach((id) => dst.el(id, '0'));
  let hooks = 0;
  let timerUsed = false;
  const d2 = deps(dst, 'US');
  ds.restoreDesignInputs({ ...d2, buildSpanTable: () => {}, setTimeoutFn: () => { timerUsed = true; },
    afterRestore: () => { hooks++; } }, { ...data, spans: [25, 30] });
  assert.strictEqual(timerUsed, false, 'span table filled synchronously (no 100 ms timer)');
  assert.strictEqual(dst.spans[0].value, 25, 'span value restored immediately');
  assert.strictEqual(hooks, 1, 'afterRestore hook fired once');
  assert.strictEqual(dst.getElementById('conn-edge-dist').value, '', 'null -> empty field');
  assert(Math.abs(parseFloat(dst.getElementById('design-Lb-pos').value) - 1200 / 25.4) < 1e-9, 'US display of Lb_pos');
  assert(Math.abs(parseFloat(dst.getElementById('vib-rho').value) - data.vibRho) < 1e-18, 'density restored');
  assert.strictEqual(dst.getElementById('select-r-value').value, '0.70');
  assert.strictEqual(dst.getElementById('conn-member-case').value, 'not_tension_member');
  assert.strictEqual(dst.getElementById('chk-i621-confirmed').checked, true);
  assert.strictEqual(dst.getElementById('chk-pattern-loading').checked, false);
  assert.strictEqual(dst.getElementById('conn-j63-na').checked, true);
  assert.strictEqual(dst.getElementById('span-Ix-list').value, '', 'empty list restored as empty');
  assert(Math.abs(parseFloat(dst.getElementById('input-load-P').value) - 10 / FACT.force) < 1e-9,
    'custom P restored in the current unit system (was display value before)');

  // 옛 파일(v1.2 키만): 새 칸은 지금 화면 값을 그대로 둔다.
  const old = makeDoc();
  old.el('vib-rho', 'keep');
  ds.restoreDesignInputs({ ...deps(old, 'US'), buildSpanTable: () => {} }, { fy: 50 });
  assert.strictEqual(old.getElementById('vib-rho').value, 'keep', 'absent key leaves the field untouched');

  // V4-09: 단위가 있는 모든 <input>(라벨의 data-unit 또는 칸 자신의 data-unit)은 FIELDS 표에 같은 단위로 있어야 한다.
  const fs = require('fs');
  const panel = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'webview', 'StcfsdPanel.ts'), 'utf8');
  const html = panel.slice(panel.indexOf('_getHtmlForWebview'));
  const re = /<label\b[^>]*>([\s\S]*?)<\/label>|<input\b[^>]*>/g;
  let m; let lastUnit = null; const found = [];
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<label')) {
      if (/<input/.test(m[1])) { lastUnit = null; continue; }
      lastUnit = (m[1].match(/data-unit="([^"]+)"/) || [])[1] || null;
      continue;
    }
    const id = (m[0].match(/\bid="([^"]+)"/) || [])[1];
    const own = (m[0].match(/data-unit="([^"]+)"/) || [])[1];
    const unit = own || lastUnit;
    lastUnit = null;
    if (id && unit) { found.push([id, unit]); }
  }
  assert(found.length > 50, 'scanned the unit inputs');
  const same = (a, b) => a === b || ([a, b].every((u) => ['length', 'radius', 'thickness'].includes(u)));
  const missing = found.filter(([id, u]) => !ds.UNIT_FIELDS[id] || !same(ds.UNIT_FIELDS[id], u));
  assert.deepStrictEqual(missing, [], 'unit inputs not registered in designState FIELDS: ' + JSON.stringify(missing));

  // V4-07: 빈 Fub · Fuf · t2 · n 은 null 로 저장되고 빈 칸으로 돌아온다(전 827 MPa · 1.5 mm · 4).
  const c1 = makeDoc();
  ['conn-Fub', 'conn-Fuf', 'conn-t2', 'conn-n'].forEach((id) => c1.el(id, ''));
  const saved = ds.collectDesignInputs(deps(c1, 'SI'));
  assert.deepStrictEqual([saved.connFub, saved.connFuf, saved.connT2, saved.connN], [null, null, null, null]);
  const c2 = makeDoc();
  ['conn-Fub', 'conn-Fuf', 'conn-t2', 'conn-n'].forEach((id) => c2.el(id, '999'));
  ds.restoreDesignInputs({ ...deps(c2, 'SI'), buildSpanTable: () => {} }, saved);
  assert.deepStrictEqual(['conn-Fub', 'conn-Fuf', 'conn-t2', 'conn-n'].map((id) => c2.getElementById(id).value), ['', '', '', '']);

  // V4-10: initialInputs 가 있으면 파일에 없는 칸은 처음 값으로 돌아간다.
  const c3 = makeDoc();
  c3.el('design-Mx-pos', '84.92');
  ds.restoreDesignInputs({ ...deps(c3, 'US'), buildSpanTable: () => {}, initialInputs: { designMxPos: 0 } }, { fy: 50 });
  assert.strictEqual(Number(c3.getElementById('design-Mx-pos').value), 0, 'previous project value replaced by the initial value');

  // V4-28: 결과를 지우지 않는 칸 목록 — 모두 화면에 있고 ③ · ① 탭에 있으며, 설계 입력(design-* · β · R · 접합)은 없다.
  const tabOf = (id) => {
    const at = html.indexOf('id="' + id + '"');
    if (at < 0) { return null; }
    const before = html.slice(0, at);
    const tabs = [...before.matchAll(/<div id="tab-([a-z]+)" class="tab-panel/g)];
    return tabs.length ? tabs[tabs.length - 1][1] : null;
  };
  for (const [id, why] of ds.VIEW_ONLY_CONTROLS) {
    assert(['design', 'preprocessor'].includes(tabOf(id)), `view-only control ${id} is on the design/section tab (${tabOf(id)})`);
    assert(!/^(design-|chk-beta|chk-r-factor|select-r-value|chk-inelastic|conn-|input-fy|input-fu|plastic-fy|select-design-method)/.test(id),
      `${id} feeds a design result and must invalidate (${why})`);
    assert.strictEqual(ds.invalidatesResults(id), false, id);
  }
  for (const id of ['design-Lb', 'design-Mx', 'design-wc-N', 'chk-beta-dist', 'select-r-value', 'input-fy', 'plastic-fy', 'tpl-H', 'select-design-method']) {
    assert.strictEqual(ds.invalidatesResults(id), true, `${id} invalidates results`);
  }

  // V4-33: 엔진 인자 이름 → 화면 칸 이름(탭) — 사용자 글에 인자 이름이 남지 않는다.
  const u = require(path.join(__dirname, '..', '..', 'webview', 'js', 'utils.js'));
  const t = u.userText('give I_span_in4; set pattern_loading=False only; i621_conditions_confirmed missing; rerun with confirm_large');
  for (const [name] of u.USER_TERMS) { assert(!new RegExp('\\b' + name + '\\b').test(t), `${name} replaced: ${t}`); }
  assert(t.includes('「경간별 Ix」(② 하중계산 탭)') && t.includes('「활하중 부분재하(패턴) 검토」(② 하중계산 탭) 끔'), t);
  assert.deepStrictEqual(u.assumptionsList({ assumptions: ['x I_span_in4 y'] }), ['x 「경간별 Ix」(② 하중계산 탭) y']);
  // 화면의 칸 이름이 실제 라벨에 있다(표가 화면과 어긋나지 않게).
  for (const [, label] of u.USER_TERMS.filter((x) => x[2])) {
    const core = label.replace(/^웹 크리플링 /, '').replace(/ \(.*\)$/, '').replace(/^β /, '').split(' ')[0];
    assert(html.includes(core), `label core '${core}' of '${label}' appears in the webview HTML`);
  }

  console.log('design_state_v13_contract: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
