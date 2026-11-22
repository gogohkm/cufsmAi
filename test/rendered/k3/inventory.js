/* global process, console, Buffer */
// K3 0단계 — 검증 항목 · 보고서 절의 목록(inventory)을 코드에서 만든다.
//   node test/rendered/k3/inventory.js   (먼저 `npm run test:k3` 를 돌려 흐름마다 본 검증 항목을 test/rendered/out/k3/ 에 남긴다)
// 쓰는 것: docs/implementation/20261124-k3-inventory.json, 그리고 같은 이름의 .md 안 <!-- inventory:begin --> … <!-- inventory:end --> 표.
// 출처(자동):
//   1. webview/js/app.js 의 runAllValidationChecks 안 checks.push({...}) 자리 전부 — 분류(그 위의 const cat…), 항목 이름, 판정식,
//      그 자리를 품은 조건(if · forEach), 읽는 화면 칸(getNum · getElementById · _optNum → designState 키), 읽는 결과 필드, 판정식의 수.
//   2. 보고서: generateDetailedReport 가 부르는 _rpt* 와 _buildBucklingReportHtml — 제목(h2 · h3), 읽는 칸 · 결과 필드, 박힌 수.
//   3. 렌더 시험이 본 항목(test/rendered/out/k3/observed_validation_items.json)을 정적 목록과 맞댄다 — 빠짐 · 남음.
// 손으로 적은 것: 아래 NOTE(항목마다 엔진과의 관계 · 박힌 공학 한계 · K3 에서 갈 곳) — 항목 이름으로 붙인다(줄 번호가 바뀌어도).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, 'test', 'rendered', 'out', 'k3');
const DOC_JSON = path.join(ROOT, 'docs', 'implementation', '20261124-k3-inventory.json');
const DOC_MD = path.join(ROOT, 'docs', 'implementation', '20261124-k3-inventory.md');
const DS = require(path.join(ROOT, 'webview', 'js', 'designState.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'webview', 'js', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const lineOf = (i) => SRC.slice(0, i).split('\n').length;
const ID2KEY = Object.fromEntries(DS.FIELDS.map((f) => [f[1], f[0]]));

// ── 작은 스캐너: 글자열 · 주석 · 정규식을 건너뛰며 괄호를 맞춘다 ─────────────────
function skipString(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (q === '`' && s[j] === '$' && s[j + 1] === '{') { j = matchBrace(s, j + 1); continue; }
    if (s[j] === q) { return j; }
  }
  return s.length;
}
function isRegexStart(s, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(s[k])) { k--; }
  return k < 0 || '(,=:[!&|?{};'.includes(s[k]);
}
function skipRegex(s, i) {
  let inClass = false;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '[') { inClass = true; } else if (s[j] === ']') { inClass = false; } else if (s[j] === '/' && !inClass) { return j; } else if (s[j] === '\n') { return i; }
  }
  return s.length;
}
/** s[i] 가 여는 괄호일 때 맞는 닫는 괄호의 자리 */
function matchBrace(s, i) {
  const open = s[i], close = { '{': '}', '(': ')', '[': ']' }[open];
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\'' || c === '"' || c === '`') { j = skipString(s, j); continue; }
    if (c === '/' && s[j + 1] === '/') { j = s.indexOf('\n', j); if (j < 0) { return s.length; } continue; }
    if (c === '/' && s[j + 1] === '*') { j = s.indexOf('*/', j) + 1; continue; }
    if (c === '/' && isRegexStart(s, j)) { j = skipRegex(s, j); continue; }
    if (c === open) { depth++; } else if (c === close) { depth--; if (depth === 0) { return j; } }
  }
  return s.length;
}
/** 함수 본문 [시작, 끝] */
function funcRange(name) {
  const at = SRC.indexOf(`function ${name}(`);
  if (at < 0) { throw new Error('no function ' + name); }
  const b = SRC.indexOf('{', SRC.indexOf(')', at));
  return { start: b, end: matchBrace(SRC, b), line: lineOf(at) };
}
/** [lo, hi] 안의 { 마다 그 앞 문장(여는 말: if (...) · forEach(...) 등) */
function openers(lo, hi) {
  const out = [];
  const stack = [];
  for (let j = lo; j <= hi; j++) {
    const c = SRC[j];
    if (c === '\'' || c === '"' || c === '`') { j = skipString(SRC, j); continue; }
    if (c === '/' && SRC[j + 1] === '/') { j = SRC.indexOf('\n', j); continue; }
    if (c === '/' && SRC[j + 1] === '*') { j = SRC.indexOf('*/', j) + 1; continue; }
    if (c === '/' && isRegexStart(SRC, j)) { j = skipRegex(SRC, j); continue; }
    if (c === '{') {
      let k = j - 1; while (k > lo && !';{}'.includes(SRC[k])) { k--; }
      stack.push({ at: j, head: SRC.slice(k + 1, j).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim() });
    } else if (c === '}') { const o = stack.pop(); if (o) { out.push({ ...o, end: j }); } }
  }
  return out;
}
/** 객체 글 {a: …, b: …} 의 맨 위 속성 */
function topProps(obj) {
  const body = obj.slice(1, -1);
  const props = {};
  let depth = 0, start = 0;
  const push = (seg) => { const m = /^\s*([A-Za-z_]\w*)\s*:\s*([\s\S]*)$/.exec(seg); if (m) { props[m[1]] = m[2].trim().replace(/,\s*$/, ''); } };
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === '\'' || c === '"' || c === '`') { j = skipString(body, j); continue; }
    if (c === '/' && body[j + 1] === '/') { j = body.indexOf('\n', j); if (j < 0) { break; } continue; }
    if ('([{'.includes(c)) { depth++; } else if (')]}'.includes(c)) { depth--; } else if (c === ',' && depth === 0) { push(body.slice(start, j)); start = j + 1; }
  }
  push(body.slice(start));
  return props;
}
const literal = (e) => { const m = /^'([^']*)'$/.exec(e || ''); return m ? m[1] : null; };

// ── 읽는 것 ────────────────────────────────────────────────────────────────
const RESULT_VARS = {
  d: 'design result (_lastDesignResult)', la: 'load analysis (_lastLoadAnalysis)', p: 'section properties (lastProps)', lastProps: 'section properties',
  dsm: 'DSM (lastDsmResult)', dP: 'DSM.P', dM: 'DSM.Mxx', ap: 'load analysis auto_params', negRegion: 'auto_params.negative_region',
  posR: 'auto_params.positive_region', prV: 'design positive_region', _posR: 'design positive_region', pr: 'design positive_region', _lr: 'lap result (_lastLapResult)',
  lr: 'lap result (_lastLapResult)', lapDesign: 'design.design_lap', model: 'host model (page copy)', analysisResult: 'buckling analysis (page copy)', ps: 'deflection.per_span[]',
  cw: 'design.cold_work', ir: 'design.interaction', si: 'design.shear_interaction', amp: 'design.amplification', c: 'design.compression', f: 'design.flexure_x',
  rptGov: 'load analysis governing', cd: 'load analysis all_combos_detail[]', loc: 'load analysis locations[]', _i6: 'auto_params.i621_check',
};
function reads(text) {
  const dom = new Set(), fields = new Set();
  for (const m of text.matchAll(/(?:getNum|_optNum|getElementById|reqNum|zeroNum)\(\s*'([\w-]+)'/g)) { dom.add(m[1]); }
  for (const m of text.matchAll(/querySelectorAll?\(\s*'([.#][\w-]+)/g)) { dom.add(m[1]); }
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)(?:\?)?\.([A-Za-z_]\w*)/g)) {
    if (RESULT_VARS[m[1]] && !['length', 'forEach', 'filter', 'map', 'some', 'find', 'includes', 'toFixed', 'join', 'push', 'startsWith', 'indexOf', 'concat'].includes(m[2])) {
      fields.add(`${m[1]}.${m[2]}`);
    }
  }
  return { dom: [...dom].sort(), stateKeys: [...dom].map((id) => ID2KEY[id]).filter(Boolean).sort(), fields: [...fields].sort() };
}
/** 판정식 · 그 앞에 정한 지역 변수 안의 수(0 · 1 · 100 · 배열 첨자 제외) — 박힌 한계의 후보 */
function numbers(text) {
  const out = new Set();
  for (const m of text.replace(/'[^']*'/g, '').matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)) {
    const v = Number(m[1]);
    if (![0, 1, 2, 100, 12].includes(v)) { out.add(m[1]); }
  }
  return [...out];
}

// ── 손으로 적은 것: 항목마다 ────────────────────────────────────────────────
// eng: 엔진과의 관계 — 'engine'(엔진 판정을 그대로 옮김) · 'dup'(엔진이 이미 정하는 것을 화면이 다시 정함) · 'contra'(다시 정하는데 다를 수 있음)
//      · 'page'(엔진에 없는 화면만의 점검) · 'always'(늘 같은 판정)
// to: K3 에서 갈 곳 — 'host'(공용 검증 모듈) · 'engine'(엔진 design_checks 의 몫 — K3 에서는 옮기지 않는다) · 'drop'(뜻이 없다 — 지우거나 엔진 것을 보인다)
// hc: 박힌 공학 한계(화면 코드의 상수)
const NOTE = {
  '단면 정의': { eng: 'page', to: 'host', checks: 'the model has nodes' },
  '두께 (t)': { eng: 'page', to: 'host', checks: 't from the template field within a "usual CFS" band', hc: ['0.018 in ≤ t ≤ 0.5 in (warn outside)'] },
  '웹 w/t 비': { eng: 'contra', ref: 'member.applicability.b4 / check_dsm_limits (web h/t ≤ 300 in bending, w/t ≤ 500 in compression, flat width from the section)', to: 'engine', checks: '(H − 2(t + r))/t from the template fields', hc: ['200 (warn)', '500 (fail)'], defect: 'page ignores the 300 limit for webs in bending that the engine applies; uses out-to-out template dims, not the analysed section' },
  '플랜지 b/t 비': { eng: 'dup', ref: 'member.applicability.b4 (edge-stiffened b/t ≤ 160)', to: 'engine', checks: '(B − 2(t + r))/t', hc: ['60 (warn)', '160 (fail)'], defect: 'applies the edge-stiffened 160 limit to every section (Z, hat, track, angle …) — the engine picks the row by element type' },
  '립 d/t 비': { eng: 'dup', ref: 'member.applicability.b4 (lip d/t ≤ 60)', to: 'engine', checks: 'D/t', hc: ['60 (fail)'] },
  '코너 R/t 비': { eng: 'page', to: 'host', checks: 'r/t', hc: ['10 (warn)', '20 (fail)'], defect: 'labelled "Table B4.1-1" but S100-16 Table B4.1-1 has no R/t row; the engine does not check it' },
  '항복강도 (Fy)': { eng: 'dup', ref: 'check_dsm_limits Fy row / §A3.1', to: 'engine', checks: 'design Fy field > 0 and ≤ 95 ksi', hc: ['95 ksi (fail)'] },
  'Fu/Fy 비': { eng: 'dup', ref: 'auto_params.i621_check (o) — §I6.2.1(o) ductility', to: 'host', checks: 'Fu/Fy ≥ 1.08', hc: ['1.08 (warn)'] },
  '인장강도 (Fu)': { eng: 'page', to: 'host', checks: 'Fu > Fy' },
  '반파장 최솟값': { eng: 'page', to: 'host', checks: 'shortest half-wavelength ≤ 0.8·H (or ≤ 5 in without H)', hc: ['0.8·H', '5 in'], defect: 'criterion text says "≤ widest plate"; note says "0.3–0.5·H"; the rule is 0.8·H — three different numbers' },
  '반파장 최댓값': { eng: 'page', to: 'host', checks: 'longest half-wavelength ≥ max(Lb, longest span, 120 in); pass at ≥ 1.5×', hc: ['120 in', '1.5×'] },
  '반파장 개수': { eng: 'page', to: 'host', checks: 'number of lengths ≥ 30', hc: ['30'] },
  '경계조건 (BC)': { eng: 'always', to: 'host', checks: 'always pass; note if not S-S for a purlin / stud' },
  'Load Case 적합성': { eng: 'dup', ref: 'host _dsmForDesign load-family check (R2-05)', to: 'host', checks: 'flexural member with a compression load case (or the reverse) → warn' },
  '해석 실행 여부': { eng: 'page', to: 'host', checks: 'the page holds an analysis curve', defect: 'does not ask whether the analysis is current (host _isAnalysisCurrent knows)' },
  'DSM 값 추출': { eng: 'page', to: 'host', checks: 'page holds DSM P or Mxx' },
  'Mcrl 식별 (국부좌굴)': { eng: 'dup', ref: 'design_checks source.buckling_analysis.method (fsm_minimum …)', to: 'engine', checks: 'Mcrl > 0' },
  'Mcrd 식별 (뒤틀림좌굴)': { eng: 'dup', ref: 'design_checks source.buckling_analysis.method (analytic / analytic_raised_to_floor)', to: 'engine', checks: 'Mcrd > 0, else analytic fallback possible from template dims' },
  '성질 계산 여부': { eng: 'page', to: 'host', checks: 'page holds section properties' },
  '단면계수 Sx': { eng: 'page', to: 'host', checks: 'Sx > 0' },
  '회전반경 rx, rz': { eng: 'page', to: 'host', checks: 'rx, rz > 0' },
  '스팬 길이': { eng: 'contra', ref: 'auto_params.i621_check (span ≤ 33 ft, §I6.2.1)', to: 'host', checks: 'longest span field > 0 and ≤ 40 ft', hc: ['40 ft (status)', '33 ft (criterion · note)'], defect: 'status uses 40 ft, criterion and note say 33 ft — 33 < span ≤ 40 ft passes with a note saying the §I6.2.1 limit is exceeded' },
  '분담폭 (간격)': { eng: 'page', to: 'host', checks: 'spacing > 0 and ≤ 8 ft', hc: ['8 ft', '"typical 4–6 ft" text'], defect: 'blank spacing reads as 3.281 (getNum fallback) — the item passes with a value nobody entered' },
  '고정하중 (D)': { eng: 'page', to: 'host', checks: 'D > 0', hc: ['"typical 5–15 psf" text'] },
  '중력 활하중/적설하중': { eng: 'page', to: 'host', checks: 'any of Lr, S, L > 0' },
  '풍하중 (W, 양력)': { eng: 'always', to: 'host', checks: 'always pass; notes uplift' },
  '하중 분석 실행 여부': { eng: 'page', to: 'host', checks: 'page holds a load analysis' },
  '최대 Mu': { eng: 'page', to: 'host', checks: 'max |Mu| over the governing locations > 0' },
  '전단력 (Vu)': { eng: 'page', to: 'host', checks: 'some location has Vu > 0' },
  '비지지 길이 Ly (부모멘트)': { eng: 'page', to: 'host', checks: 'negative region Ly > 0' },
  '모멘트 구배 Cb': { eng: 'page', to: 'host', checks: 'negative region Cb ≥ 1.0 (note > 2.5)', hc: ['1.0', '2.5'] },
  '양력 R 계수 (§I6.2.1)': { eng: 'engine', ref: 'auto_params.uplift_R · i621_check', to: 'host', checks: 'R > 0 when the engine gave R; warn when uplift exists without R' },
  '비지지 길이 Ly(+) (정모멘트)': { eng: 'page', to: 'host', checks: 'positive region unbraced: Ly > 0' },
  '모멘트 구배 Cb(+)': { eng: 'page', to: 'host', checks: 'positive region Cb ≥ 1.0', hc: ['1.0'] },
  '정모멘트 구간 구속': { eng: 'always', to: 'host', checks: 'braced positive region → always pass' },
  'Lap 끝단 Mu 추출': { eng: 'page', to: 'host', checks: 'laps exist → a "Lap end" location with Mu exists' },
  '처짐 — 스팬': { eng: 'page', to: 'engine', checks: 'L/δ per span ≥ live-load limit (pass at ≥ 1.1×)', hc: ['roof L/240 (LL) · L/180 (TL)', 'floor L/360 · L/240', '1.1× margin'], defect: 'prints the total-load limit but never checks it; the δ is the engine\'s one service combination, not LL alone — the LL limit is applied to whatever combination the engine used' },
  '처짐 검토': { eng: 'page', to: 'host', checks: 'deflection invalid (fail) or missing (warn)' },
  '설계 검토 실행 여부': { eng: 'page', to: 'host', checks: 'page holds a design result' },
  '종합 판정 (엔진)': { eng: 'engine', ref: 'result pass / verdict (fail > not_evaluated > pass)', to: 'host', checks: 'engine three-state verdict → pass / warn (not evaluated) / fail' },
  'Mne vs My': { eng: 'contra', ref: 'member.flexure.global', to: 'drop', checks: 'Mne ≤ 1.01·My (or ≤ Mp with inelastic reserve, detected by "F2.4.2" in a step equation; Mp fallback 1.5·My)', hc: ['1.01', '1.5·My'], defect: 'Mne > My is legitimate with Cb > 1 and no IR? (Mne is capped at My by F2.1 except IR) — the item can fail (null) when the engine marks the check not applicable (R route)' },
  '§F2.4.2 Inelastic Reserve': { eng: 'page', to: 'host', checks: 'inelastic reserve applied (steps contain F2.4.2) → pass, else warn', hc: ['"Mcre > 2.78My" text'], defect: 'not applying an optional provision is shown as a caution in every flexure check' },
  '§I6.2.1 R-factor (양력)': { eng: 'engine', ref: 'member.flexure.uplift_r', to: 'host', checks: 'R applied → pass; uplift region without R → warn; else pass' },
  '§A3.3.2 Cold Work (냉간가공)': { eng: 'engine', ref: 'design.cold_work · use_cold_work', to: 'host', checks: 'cold work requested / applied / blocked by IR', hc: ['"Fu/Fy ≥ 1.2, R/t ≤ 7, ≤ 120°" text'] },
  '§A3.3.2 ↔ §F2.4.2 배타 관계': { eng: 'engine', ref: 'design.use_cold_work · use_inelastic_reserve', to: 'host', checks: 'both options requested → warn' },
  'Mnl vs Mne (국부좌굴 감소)': { eng: 'contra', ref: 'member.flexure.local', to: 'drop', checks: 'Mnl < Mne → warn (reduction shown as a caution), null → fail', defect: 'a local reduction is normal design behaviour, not a caution; null Mnl → fail even when the engine reports the check not applicable' },
  'Mnd vs My (뒤틀림좌굴 감소)': { eng: 'contra', ref: 'member.flexure.distortional', to: 'drop', checks: 'Mnd < My → warn, null → fail', defect: 'same as above; the engine may report distortional not evaluated (no Mcrd) while the item shows pass (Mnd = My placeholder)' },
  '모든 Mn 동일 (잠재적 문제)': { eng: 'contra', ref: 'member.flexure.* (λ computed by the engine)', to: 'drop', checks: 'Mne = Mnl = Mnd = My → warn; recomputes λl = √(My/Mcrl), λd = √(My/Mcrd) from the page DSM', hc: ['0.776', '0.673'], defect: 'λl is computed with My — the specification (F3.2.1) uses Mne; the engine already reports λ in design_checks steps' },
  '정모멘트 φMn(+)': { eng: 'engine', ref: 'member.flexure.positive_region', to: 'host', checks: 'positive-region φMn > 0' },
  '정모멘트 LTB': { eng: 'dup', ref: 'member.flexure.positive_region steps (Fcre vs 2.78Fy branch)', to: 'drop', checks: 'Fcre(+) < 2.78·Fy → warn', hc: ['2.78'] },
  'Pnl vs Pne (국부좌굴 감소)': { eng: 'contra', ref: 'member.compression.local', to: 'drop', checks: 'Pnl < Pne → warn, null → fail' },
  'Pnd vs Py (뒤틀림좌굴 감소)': { eng: 'contra', ref: 'member.compression.distortional', to: 'drop', checks: 'Pnd < Py → warn, null → fail' },
  '이용률 — 부모멘트 (-M)': { eng: 'engine', ref: "limit_state_checks 'F flexure' / member.flexure.*", to: 'host', checks: 'F flexure verdict and ratio' },
  'Lb(-) / Cb(-) (부모멘트)': { eng: 'page', to: 'host', checks: 'design-Lb > 0 (note Cb > 2.3) — from the input fields, not from the result', hc: ['2.3'], defect: 'reads the current fields, not the Lb/Cb the result used (purlin regions have their own) — stale after an edit' },
  '이용률 (DCR)': { eng: 'engine', ref: 'result utilization + verdict', to: 'host', checks: 'engine verdict with utilization' },
  '이용률 — 정모멘트 (+M)': { eng: 'engine', ref: 'member.flexure.positive_region', to: 'host', checks: 'positive region verdict; no Mu(+) → warn' },
  'Lb(+) / Cb(+) (정모멘트)': { eng: 'dup', ref: 'member.flexure.positive_region steps', to: 'drop', checks: 'Lb(+) = 0 or Fcre(+) ≥ 2.78·Fy → pass, else warn', hc: ['2.78'] },
  '저항계수 (φ)': { eng: 'always', ref: 'design_checks[].factor', to: 'engine', checks: 'always pass in LRFD; prints φb = 0.90 / φc = 0.85 constants', hc: ['φb 0.90', 'φc 0.85'], defect: 'constants, not the factors the engine used (design_checks factor); nothing for ASD' },
  '조합 검토 (§H1.2)': { eng: 'engine', ref: 'member.axial_bending', to: 'host', checks: 'interaction verdict' },
  'DSM 경고 #': { eng: 'engine', ref: 'dsm_warnings', to: 'host', checks: 'each engine DSM warning → warn' },
  '설계 경고 #': { eng: 'engine', ref: 'warnings', to: 'host', checks: 'each engine warning → warn (positive-region NG skipped)' },
  '뒤틀림좌굴 해석적 Fallback': { eng: 'engine', ref: 'warnings (§2.3.3.3 / §2.3.1.3)', to: 'host', checks: 'fallback warning → warn' },
  'isFallback': { eng: 'engine', ref: 'warnings', to: 'host', checks: 'each engine warning → warn ("뒤틀림좌굴 해석적 Fallback" when it names §2.3.3.3 / §2.3.1.3; positive-region NG warnings skipped)' },
  'DSM 추출 경고': { eng: 'engine', ref: 'dsm_warning', to: 'host', checks: 'warn' },
  'Lap 구간 휨강도 (§F3, 2겹)': { eng: 'engine', ref: 'design.design_lap', to: 'host', checks: 'design_lap verdict' },
  'Lap 길이 (지점': { eng: 'dup', ref: 'lap.length_condition (lap result)', to: 'engine', checks: 'min(left, right lap) ≥ 1.5·H (template field)', hc: ['1.5·d'], defect: 'uses the template H field and the load-analysis laps, not the lap check of the lap result' },
  'Lap 패스너 전단 (DCR)': { eng: 'engine', ref: 'lap.fastener_group', to: 'host', checks: 'lap utilization + pass' },
  'Lap 휨강도 DCR (2겹 §F3/F4/H2)': { eng: 'engine', ref: 'lap.flexure.* / lap.bending_shear', to: 'host', checks: 'flexure_dcr_governing + flexure_checked' },
  'Lap 접합부 종합 판정': { eng: 'engine', ref: 'lap result verdict', to: 'host', checks: 'lap three-state verdict' },
  'Lap 접합부 설계 실행 여부': { eng: 'page', to: 'host', checks: 'laps + flexure result but no lap result → fail' },
  'Fy 일관성 (해석 vs 설계)': { eng: 'always', to: 'host', checks: '|design Fy field − ① Fy field| < 0.1 (display units)', hc: ['0.1 (ksi or MPa — depends on the display)'], defect: 'both fields mirror the same state since K2 (D-3) — always pass; the analysis reference stress (host loadFy, decision 3) is never compared' },
  '해석 최신성': { eng: 'always', to: 'host', checks: 'always pass when an analysis exists', defect: 'does not compare signatures — says pass after the section changed' },
};
const noteFor = (item) => NOTE[item] || NOTE[Object.keys(NOTE).find((k) => item.startsWith(k))] || null;

// ── 검증 항목 ──────────────────────────────────────────────────────────────
function validationItems() {
  const fr = funcRange('runAllValidationChecks');
  const ops = openers(fr.start + 1, fr.end - 1).filter((o) => o.at > fr.start);
  const items = [];
  let cats = [];
  for (const m of SRC.slice(fr.start, fr.end).matchAll(/(?:const|var) (cat\w*) = '([^']+)'/g)) { cats.push({ v: m[1], name: m[2], at: fr.start + m.index }); }
  // 함수 안의 지역 변수 정의(이름 → 정의 글) — 항목이 쓰는 변수의 출처를 세 겹까지 따라간다
  const body = SRC.slice(fr.start, fr.end);
  const defs = {};
  const addDef = (n, e) => { defs[n] = (defs[n] ? defs[n] + ' ' : '') + e; };
  for (const d of body.matchAll(/(?:const|let|var)\s+([^;]*);/g)) {
    // const a = X, b = Y; — 맨 위 쉼표에서 나눈다(괄호 안의 쉼표는 두고)
    let depth = 0, start = 0;
    const parts = [];
    const txt = d[1];
    for (let j = 0; j < txt.length; j++) {
      const c = txt[j];
      if ('([{'.includes(c)) { depth++; } else if (')]}'.includes(c)) { depth--; } else if (c === ',' && depth === 0 && /^\s*[A-Za-z_]\w*\s*=/.test(txt.slice(j + 1))) { parts.push(txt.slice(start, j)); start = j + 1; }
    }
    parts.push(txt.slice(start));
    for (const p of parts) { const m = /^\s*([A-Za-z_]\w*)\s*=\s*([\s\S]*)$/.exec(p); if (m) { addDef(m[1], m[2]); } }
  }
  for (const d of body.matchAll(/\n\s*([A-Za-z_]\w*)\s*=\s*([^;=][^;]*);/g)) { addDef(d[1], d[2]); }
  for (const d of body.matchAll(/([A-Za-z_]\w*)\s*=\s*getNum\(\s*'([\w-]+)'[^)]*\)/g)) { addDef(d[1], `getNum('${d[2]}')`); }
  const expand = (text) => {
    let t = text;
    const seen = new Set();
    for (let pass = 0; pass < 3; pass++) {
      for (const id of new Set(t.match(/\b[A-Za-z_]\w*\b/g) || [])) { if (defs[id] && !seen.has(id)) { seen.add(id); t += ' ' + defs[id]; } }
    }
    return t;
  };
  for (const m of SRC.slice(fr.start, fr.end).matchAll(/checks\.push\(\{/g)) {
    const at = fr.start + m.index;
    const ob = at + m[0].length - 1;
    const oe = matchBrace(SRC, ob);
    const obj = SRC.slice(ob, oe + 1);
    const p = topProps(obj);
    const cat = cats.find((c) => c.v === p.category) || null;
    const guards = ops.filter((o) => o.at < at && o.end > oe && !/^(?:const|let|var)\b/.test(o.head) && o.head !== '').map((o) => o.head)
      .filter((h) => /^(if|else|\}?\s*else)|forEach|\bfor\b/.test(h));
    const ctxText = expand(obj + ' ' + guards.join(' '));
    const itemLit = literal(p.item);
    const itemName = itemLit != null ? itemLit : p.item.replace(/'/g, '').replace(/\s*\+\s*/g, '');
    const statusExpr = (p.status || '').replace(/\s+/g, ' ');
    const outcomes = ['pass', 'warn', 'fail'].filter((s) => statusExpr.includes(`'${s}'`));
    const viaEngine = /_statusFromVerdict/.test(statusExpr);
    const rd = reads(ctxText);
    items.push({ line: lineOf(at), category: cat ? cat.name : p.category, item: itemName, itemExpr: itemLit == null ? p.item : undefined,
      status: statusExpr, outcomes: viaEngine ? ['pass', 'warn', 'fail', '(from engine verdict)'] : outcomes, guards,
      criterion: literal(p.criterion) || p.criterion.replace(/\s+/g, ' '), note: (literal(p.note) ?? p.note.replace(/\s+/g, ' ')),
      dom: rd.dom, stateKeys: rd.stateKeys, fields: rd.fields, numbers: numbers(expand(statusExpr)).slice(0, 12),
      annotation: noteFor(itemName) });
  }
  items.forEach((it, i) => { it.id = 'V-' + it.category.slice(0, it.category.indexOf('.')) + '-' + String(i + 1).padStart(2, '0'); });
  return { items, line: fr.line, end: lineOf(fr.end) };
}

// ── 보고서 절 ──────────────────────────────────────────────────────────────
const REPORT_FUNCS = ['generateDetailedReport', '_rptSection', '_rptBuckling', '_rptDesignInput', '_rptLoadAnalysis', '_rptDesignCalc', '_rptFlexure',
  '_rptCompression', '_rptCombined', '_rptTension', '_rptSummary', '_verdictListsHtml', '_requiredMoment', 'renderBeamSchematic', 'renderDiagramSVG',
  '_buildBucklingReportHtml', '_canvasPng'];
const DERIVED = [
  [/_ruv\(29500/, 'E = 29500 ksi printed (constant, not the model E)'], [/<td>0\.30<\/td>/, 'ν = 0.30 printed (constant, not the model ν)'],
  [/psfUS \* spacingUS/, 'line load = pressure × spacing computed in the page'], [/1-d\.Mnl\/d\.Mne|1-pr\.Mnl\/pr\.Mne/, '% local reduction = 1 − Mnl/Mne'],
  [/2\.78\s*\*\s*Fy_val|0\.56\s*\*\s*Fy_val/, '2.78·Fy and 0.56·Fy computed to classify the positive-region LTB zone'],
  [/const phi=0\.90,omega=1\.67|const phi=0\.85,omega=1\.80/, 'φ / Ω printed from page constants (0.90/1.67, 0.85/1.80), not design_checks factor'],
  [/&phi;<sub>t<\/sub>=0\.90|&phi;<sub>t<\/sub>=0\.75/, 'tension φt / Ωt printed as constants'],
  [/toDataURL/, 'chart = PNG of the on-screen canvas (needs the page)'],
  [/f\.ratio \* d\.design_strength/, 'required moment Mu = ratio × design strength when the result has no Mu (page-derived demand)'],
  [/\+' ksi/, 'a stress printed with a literal "ksi" (not converted in SI)'],
  [/getNum\('deck-t-panel',0\.018\)|getNum\('deck-fastener-spacing',12\)|getNum\('config-spacing',5\)/, 'blank input printed as a page default (0.018 · 12 · 5)'],
  [/yMax=Math\.max\(\.\.\.points\.map\(p=>p\[1\]\)\)\*1\.15/, 'curve drawn from the page copy of the analysis (scale ×1.15, minimum searched in the page)'],
  [/getNum\('design-Lb'|getNum\('design-Cb'/, 'Lb(−) / Cb(−) printed from the current input fields, not from the result'],
  [/getNum\('tpl-|getNum\('input-fy'|getNum\('input-len/, 'section / analysis values printed from the current input fields, not from the model or the analysis'],
];
function reportSections() {
  return REPORT_FUNCS.map((name) => {
    const fr = funcRange(name);
    const body = SRC.slice(fr.start, fr.end);
    const bodyH = body.replace(/'\s*\+\s*\(\+\+sec\)\s*\+\s*'/g, '#');
    const heads = [...bodyH.matchAll(/<h([123])[^>]*>([^<']*(?:'\+[^+]+\+'[^<']*)?)/g)].map((m) => `h${m[1]} ${m[2].replace(/'\s*\+\s*/g, '«').replace(/\s*\+\s*'/g, '»')}`);
    const rd = reads(body);
    const derived = DERIVED.filter(([re]) => re.test(body)).map(([, t]) => t);
    const calls = [...new Set([...body.matchAll(/\b(_rpt\w+|renderBeamSchematic|renderDiagramSVG|_verdictListsHtml|_canvasPng)\(/g)].map((m) => m[1]))].filter((c) => c !== name);
    return { name, line: fr.line, lines: lineOf(fr.end) - fr.line + 1, heads, dom: rd.dom, stateKeys: rd.stateKeys, fields: rd.fields, derived, calls };
  });
}

// ── 맞대기: 렌더 시험이 본 항목 ─────────────────────────────────────────────
function crossObserved(items) {
  const f = path.join(OUT, 'observed_validation_items.json');
  if (!fs.existsSync(f)) { return { available: false }; }
  const obs = JSON.parse(fs.readFileSync(f, 'utf8'));
  // 이름이 식이면(번호 · 갈래) 그 안의 글자열 조각 가운데 하나로 시작하면 같은 자리로 본다
  const pieces = (it) => (it.itemExpr ? [...it.itemExpr.matchAll(/'([^']*)'/g)].map((m) => m[1].trim()).filter((p) => p.length >= 3) : []);
  const match = (o) => items.find((it) => it.category === o.category && (it.item === o.item || pieces(it).some((p) => o.item.startsWith(p))));
  const unmatched = obs.filter((o) => !match(o)).map((o) => `${o.flow}: ${o.category} / ${o.item}`);
  const seen = new Set(obs.map((o) => { const m = match(o); return m ? m.id : null; }).filter(Boolean));
  const flows = [...new Set(obs.map((o) => o.flow))];
  const perFlow = Object.fromEntries(flows.map((fl) => [fl, obs.filter((o) => o.flow === fl).length]));
  return { available: true, observed: obs.length, flows: perFlow, unmatched, neverSeen: items.filter((it) => !seen.has(it.id)).map((it) => `${it.id} ${it.item}`) };
}

// ── 쓰기 ──────────────────────────────────────────────────────────────────
function mdEsc(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function main() {
  const V = validationItems();
  const R = reportSections();
  const X = crossObserved(V.items);
  const byCat = {};
  V.items.forEach((it) => { byCat[it.category] = (byCat[it.category] || 0) + 1; });
  const byEng = {};
  V.items.forEach((it) => { const e = it.annotation ? it.annotation.eng : '(none)'; byEng[e] = (byEng[e] || 0) + 1; });
  const byTo = {};
  V.items.forEach((it) => { const e = it.annotation ? it.annotation.to : '(none)'; byTo[e] = (byTo[e] || 0) + 1; });
  const hcItems = V.items.filter((it) => it.annotation && it.annotation.hc);
  const hcCount = hcItems.reduce((a, it) => a + it.annotation.hc.length, 0);
  const derivedCount = R.reduce((a, r) => a + r.derived.length, 0);
  const missingNote = V.items.filter((it) => !it.annotation).map((it) => it.item);
  const summary = { validation: { pushSites: V.items.length, function: `app.js ${V.line}–${V.end}`, byCategory: byCat, byEngineRelation: byEng, byDestination: byTo,
    hardCodedThresholds: { items: hcItems.length, thresholds: hcCount }, withDefect: V.items.filter((it) => it.annotation && it.annotation.defect).length, missingNote },
  report: { functions: R.length, pageDerived: derivedCount }, observed: X };
  if (process.argv.includes('--check')) {
    // 시험(npm run test:k3): 목록이 지금 코드와 맞는가 — 자리 수 · 이름 · 주석 · 렌더 시험이 본 항목이 모두 목록에 있는가
    const doc = fs.existsSync(DOC_JSON) ? JSON.parse(fs.readFileSync(DOC_JSON, 'utf8')) : null;
    const sig = (arr) => arr.map((it) => `${it.category}|${it.item}`).join('\n');
    const problems = [];
    if (!doc) { problems.push('no inventory JSON — run node test/rendered/k3/inventory.js'); }
    else if (sig(doc.validation) !== sig(V.items)) { problems.push('the validation items in app.js differ from the inventory JSON — regenerate it (node test/rendered/k3/inventory.js) and review the notes'); }
    if (missingNote.length) { problems.push('items without a NOTE: ' + missingNote.join(', ')); }
    if (X.available && X.unmatched.length) { problems.push('items seen in the rendered run but not in the static list: ' + X.unmatched.join('; ')); }
    if (doc && doc.report && sig(doc.report.map((r) => ({ category: r.name, item: r.heads.join(';') }))) !== sig(R.map((r) => ({ category: r.name, item: r.heads.join(';') })))) {
      problems.push('the report sections in app.js differ from the inventory JSON — regenerate it');
    }
    console.log(problems.length ? 'k3 inventory: FAIL\n  ' + problems.join('\n  ') : `k3 inventory: PASS (${V.items.length} validation push sites — all annotated; ${R.length} report functions; rendered run saw ${X.observed || 0} items, none outside the list; never seen ${X.neverSeen ? X.neverSeen.length : '?'})`);
    if (problems.length) { process.exitCode = 1; }
    return;
  }
  fs.writeFileSync(DOC_JSON, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), by: 'test/rendered/k3/inventory.js', summary, validation: V.items, report: R }, null, 1) + '\n');

  const L = [];
  L.push(`생성: \`node test/rendered/k3/inventory.js\` (${new Date().toISOString().slice(0, 10)}). 손으로 고치지 않는다 — 이 표 밖의 글만 손으로 쓴다.`, '');
  L.push(`### 검증 항목 — \`checks.push\` 자리 ${V.items.length} (app.js ${V.line}–${V.end})`, '');
  L.push(`분류별: ${Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join(' · ')}`, '');
  L.push(`엔진과의 관계: ${Object.entries(byEng).map(([k, v]) => `${k} ${v}`).join(' · ')} · K3 에서 갈 곳: ${Object.entries(byTo).map(([k, v]) => `${k} ${v}`).join(' · ')}`, '');
  L.push(`박힌 공학 한계: 항목 ${hcItems.length} · 한계 ${hcCount}. 결함 표시가 있는 항목 ${summary.validation.withDefect}.${missingNote.length ? ' 주석 없는 항목: ' + missingNote.join(', ') : ''}`, '');
  if (X.available) {
    L.push(`렌더 시험이 본 항목: ${X.observed}(흐름 ${Object.keys(X.flows).length}). 정적 목록에 없는 것: ${X.unmatched.length ? X.unmatched.join('; ') : '없음'}. 한 번도 보지 못한 자리: ${X.neverSeen.length ? X.neverSeen.join('; ') : '없음'}.`, '');
  }
  L.push('| id | 줄 | 항목 | 점검 | 조건 · 판정 | 읽는 칸(상태 키) · 결과 필드 | 박힌 한계 | 엔진 | K3 | 결함 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const it of V.items) {
    const a = it.annotation || {};
    L.push(`| ${it.id} | ${it.line} | ${mdEsc(it.item)} | ${mdEsc(a.checks)} | ${mdEsc((it.guards.length ? it.guards.join(' › ') + ' → ' : '') + it.outcomes.join('/'))} | ${mdEsc([it.stateKeys.join(', '), it.dom.filter((d) => !ID2KEY[d]).join(', '), it.fields.join(', ')].filter(Boolean).join(' · '))} | ${mdEsc((a.hc || []).join('; '))} | ${mdEsc(a.eng)}${a.ref ? ' — ' + mdEsc(a.ref) : ''} | ${mdEsc(a.to)} | ${mdEsc(a.defect)} |`);
  }
  L.push('', `### 보고서 — 함수 ${R.length}, 화면이 스스로 만든 수 · 박힌 값 ${derivedCount}`, '');
  L.push('| 함수 | 줄 | 길이 | 제목 | 읽는 칸(상태 키) | 결과 필드 | 화면이 만든 수 · 박힌 값 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const r of R) {
    L.push(`| ${r.name} | ${r.line} | ${r.lines} | ${mdEsc(r.heads.join('; '))} | ${mdEsc([r.stateKeys.join(', '), r.dom.filter((d) => !ID2KEY[d]).join(', ')].filter(Boolean).join(' · '))} | ${mdEsc(r.fields.join(', '))} | ${mdEsc(r.derived.join('; '))} |`);
  }
  const md = fs.readFileSync(DOC_MD, 'utf8');
  const a = md.indexOf('<!-- inventory:begin -->'), b = md.indexOf('<!-- inventory:end -->');
  if (a < 0 || b < 0) { throw new Error('markers missing in ' + DOC_MD); }
  fs.writeFileSync(DOC_MD, md.slice(0, a + '<!-- inventory:begin -->'.length) + '\n' + L.join('\n') + '\n' + md.slice(b));
  console.log(JSON.stringify(summary, null, 1).slice(0, 3000));
}

main();
