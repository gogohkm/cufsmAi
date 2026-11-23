/* global process */
// K2 0단계 — 입력 목록(inventory)을 코드에서 만든다.
//   node test/rendered/k2/inventory.js        (먼저 `node test/rendered/k2/run.js --only=defaults,mcp` 를 돌려 화면 칸 목록과 MCP 결과를 남긴다)
// 쓰는 것: docs/implementation/20261123-k2-input-inventory.json, 그리고 같은 이름의 .md 안 <!-- inventory:begin --> … <!-- inventory:end --> 표.
// 출처(모두 자동으로 읽는다):
//   1. 화면 칸: 진짜 웹뷰를 띄워 DOM 을 걸은 것(test/rendered/out/k2/dom_controls.json — run.js 의 defaults 묶음)
//   2. 저장 표: webview/js/designState.js FIELDS · VIEW_ONLY_CONTROLS · UNIT_FIELDS
//   3. 읽는 곳: webview/js/app.js 에서 그 id 를 글자로 쓰는 줄 → 그 줄을 품은 함수 · 처리기 → 그 함수가 보내는 메시지(아래 표)
//   4. 처음 값의 출처: src/webview/StcfsdPanel.ts 의 HTML 줄(${…} 치환 여부), app.js 의 동기화 함수가 쓰는 칸
//   5. MCP: 진짜 MCP 서버의 tools/list(인자 이름) + 아래 대응표(손으로 적고, 도구 스키마에 그 인자가 있는지 자동 대조)
//   6. MCP 가 화면 칸에 닿는가: run.js 의 mcp 묶음 고정값(test/rendered/k2/golden/mcp-*.json)의 inputsChanged
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, 'test', 'rendered', 'out', 'k2');
const GOLDEN = path.join(__dirname, 'golden');
const DOC_JSON = path.join(ROOT, 'docs', 'implementation', '20261123-k2-input-inventory.json');
const DOC_MD = path.join(ROOT, 'docs', 'implementation', '20261123-k2-input-inventory.md');

const DS = require(path.join(ROOT, 'webview', 'js', 'designState.js'));
const APP = fs.readFileSync(path.join(ROOT, 'webview', 'js', 'app.js'), 'utf8').split(/\r?\n/);
const PANEL = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'StcfsdPanel.ts'), 'utf8').split(/\r?\n/);

// ── app.js: 줄 → 그 줄을 품은 이름 있는 묶음 ────────────────────────────────
// 맨 위(들여쓰기 4칸)의 function 과, 단추 처리기처럼 이름 없는 맨 위 묶음(const x = …; if (x) { … })을 이름 붙여 나눈다.
function appBlocks() {
  const blocks = [];
  const anchors = [
    [/^    const btnLapDesign = /, 'btn-run-lap-design click', ['runLapConnection']],
    [/^    const btnSingleConn = /, 'btn-run-single-conn click', ['runConnection']],
    [/^    const connTypeSelect = /, 'conn-single-type change (rows)', []],
    [/^    const btnPlastic = /, 'btn-run-plastic click', ['runPlastic']],
    [/^    const btnVibration = /, 'btn-run-vibration click', ['runVibration']],
    [/^    const btnGenTemplate = /, 'btn-generate-template click', ['generateTemplate']],
    [/^    const selTemplateEl = /, 'select-template change (qlip row)', []],
    [/^    const selLoadCase = /, 'select-load-case change (custom rows)', []],
    [/^    const btnRun = /, 'btn-run-analysis click', ['runAnalysis']],
    [/^    const selGradePre = /, 'input-steel-grade change (Fy · Fu · E · G)', []],
    [/^    const selMemberType = /, 'select-member-type change (visibility, V4-17 clear)', []],
    [/^    const btnDesign = /, 'btn-run-design click', ['runDesign', 'runPurlinDesign']],
    [/^    const chkBeta = /, 'chk-beta-dist toggle / β preview', []],
    [/^    const cbEl = /, 'design-Cb hint', []],
    [/^    const btnAnalyze = /, 'btn-analyze-loads click', ['analyzeLoads']],
    [/^    const loadsPanel = /, 'tab-loads change → invalidate(load)', ['invalidateDerivedResults']],
    [/^    \['tab-design', 'tab-preprocessor'\]\.forEach/, 'tab-design/preprocessor change → invalidate(design)', ['invalidateDerivedResults']],
    [/^    const VALIDATION_RULES = /, 'design input range check (red border)', []],
  ];
  for (let i = 0; i < APP.length; i++) {
    const fm = /^    (?:async )?function (\w+)\s*\(/.exec(APP[i]);
    if (fm) { blocks.push({ start: i, name: fm[1], kind: 'function' }); continue; }
    for (const [re, name, msgs] of anchors) { if (re.test(APP[i])) { blocks.push({ start: i, name, kind: 'handler', msgs }); } }
  }
  blocks.sort((a, b) => a.start - b.start);
  for (let k = 0; k < blocks.length; k++) {
    // 끝: 다음 묶음의 시작 앞, 또는 맨 위 들여쓰기의 닫는 줄
    const next = k + 1 < blocks.length ? blocks[k + 1].start : APP.length;
    let end = next - 1;
    for (let j = blocks[k].start + 1; j < next; j++) { if (/^    \}\)?;?\s*$/.test(APP[j])) { end = j; break; } }
    blocks[k].end = end;
  }
  return blocks;
}
const BLOCKS = appBlocks();
function blockAt(line) {
  let b = null;
  for (const x of BLOCKS) { if (x.start <= line && line <= x.end) { b = x; } }
  return b;
}

// 함수 → 그 함수가 결국 내보내는 것(메시지 · 쓰임). 손으로 적은 표 — 줄 번호 대신 함수 이름으로(코드가 움직여도 맞게).
const FN_MESSAGES = {
  collectDesignRunPayload: ['runDesign → host aisi_design', 'runPurlinDesign (wc_* · use_* · Fy · Fu)'],
  collectLoadAnalysisPayload: ['analyzeLoads → host analyze_loads', 'runPurlinDesign → host design_purlin'],
  _autoPrepareDesignDsm: ['prepareDesignDsm → host prepare_design_dsm'],
  generateDetailedReport: ['report (K3)'], _rptSection: ['report (K3)'], _rptBuckling: ['report (K3)'], _rptDesignInput: ['report (K3)'],
  _rptLoadAnalysis: ['report (K3)'], _rptDesignCalc: ['report (K3)'], _rptFlexure: ['report (K3)'], _rptCompression: ['report (K3)'],
  _rptCombined: ['report (K3)'], _rptTension: ['report (K3)'], _rptSummary: ['report (K3)'], _deckNotes: ['report (K3)'],
  runAllValidationChecks: ['validation (K3)'],
  renderLoadAnalysisResult: ['(written from the load-analysis result)'], _autoFillLapInputs: ['(written from the load-analysis result)'],
  _syncAnalysisWidgetsFromModel: ['(written from the host model)'], renderPreprocessor: ['(written from the host model)'],
  propagateFyFuFromPreprocessor: ['(mirror Fy/Fu to the other tabs)'], propagateFyFromPlastic: ['(mirror Fy to the other tabs)'],
  syncFyValue: ['(mirror Fy)'], syncFuValue: ['(mirror Fu)'], updateG: ['(G = E / 2(1+ν))'], updatePLF: ['(plf display)'],
  buildSpanTable: ['(span table rebuilt)'], getSpanCount: ['(span table size)'], _labelRestoredGrade: ['(.csd restore: grade label)'],
  _fireRestoredInputUpdates: ['(.csd restore: change events)'], renderStressPreview: ['(stress preview)'], refreshUnits: ['(unit toggle)'],
  renderDesignResult: ['(result card labels)'], sendTreeUpdate: ['(sidebar tree)'], handleShowSection: ['(tree navigation)'],
  _pickGoverningPurlinDesign: ['(purlin governing pick)'], updateAnalysisFyDisplay: ['(Fy label)'],
};

function appRefs(id, isClass = false) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = isClass ? new RegExp(`[.'"\` ]${esc}(?![\\w-])`) : new RegExp(`['"\`]${esc}['"\`]`);
  const refs = [];
  for (let i = 0; i < APP.length; i++) {
    if (!re.test(APP[i])) { continue; }
    const b = blockAt(i);
    refs.push({ line: i + 1, in: b ? b.name : '(top level)', msgs: b ? (b.msgs || FN_MESSAGES[b.name] || []) : [] });
  }
  return refs;
}

/** 화면 → 호스트 본문의 키: `key: reqNum('id'` · `key: ['id', …]` · `['key', 'id', …]` (접합 · 경간) */
function payloadKeys(id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pats = [
    new RegExp(`(\\w+):\\s*(?:reqNum|_optNum|zeroNum|_optPos|_parseNumberList)\\('${esc}'`, 'g'),
    new RegExp(`(\\w+):\\s*\\['${esc}'`, 'g'),
    new RegExp(`\\['(\\w+)',\\s*'${esc}'`, 'g'),
    new RegExp(`(\\w+):\\s*/\\*\\*[^*]*\\*/\\s*\\(document\\.getElementById\\('${esc}'\\)\\)`, 'g'),
    new RegExp(`data\\.(\\w+)\\s*=\\s*[^;]*'${esc}'`, 'g'),
  ];
  const out = new Set();
  for (const line of APP) { for (const p of pats) { let m; p.lastIndex = 0; while ((m = p.exec(line))) { out.add(m[1]); } } }
  // 탭 이름 표(handleShowSection 의 ['design', 'design-Lb'] 같은 것)는 본문 키가 아니다
  for (const tab of ['preprocessor', 'loads', 'design', 'connection', 'report', 'validation', 'analysis', 'material', 'section']) { out.delete(tab); }
  return [...out];
}

// ── 처음 값의 출처 ──────────────────────────────────────────────────────────
function htmlSourceLine(id) {
  const re = new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
  for (let i = 0; i < PANEL.length; i++) { if (re.test(PANEL[i])) { return { line: i + 1, text: PANEL[i] }; } }
  return null;
}
/** _syncAnalysisWidgetsFromModel · renderPreprocessor 가 모델에서 쓰는 칸 */
const MODEL_SYNCED = (() => {
  const ids = new Set();
  for (const fn of ['_syncAnalysisWidgetsFromModel', 'renderPreprocessor']) {
    const b = BLOCKS.find((x) => x.name === fn);
    for (let i = b.start; i <= b.end; i++) {
      for (const m of APP[i].matchAll(/(?:setNum|setSel|setValue)\('([\w-]+)'/g)) { ids.add(m[1]); }
      for (const m of APP[i].matchAll(/\['(input-load-[PMxz]+)'/g)) { ids.add(m[1]); }
    }
  }
  ['input-load-P', 'input-load-Mxx', 'input-load-Mzz'].forEach((x) => ids.add(x));
  return ids;
})();
/** renderLoadAnalysisResult · _autoFillLapInputs 가 결과로 채우는 칸 */
const LOAD_FILLED = (() => {
  const ids = new Set();
  for (const fn of ['renderLoadAnalysisResult', '_autoFillLapInputs']) {
    const b = BLOCKS.find((x) => x.name === fn);
    const vars = {};
    for (let i = b.start; i <= b.end; i++) {
      for (const m of APP[i].matchAll(/(?:setValueAndNotify|setValue)\('([\w-]+)'/g)) { ids.add(m[1]); }
      for (const m of APP[i].matchAll(/(?:var|const|let)\s+(\w+)\s*=\s*(?:\/\*\*[^*]*\*\/\s*)?\(?document\.getElementById\('([\w-]+)'\)/g)) { vars[m[1]] = m[2]; }
      for (const m of APP[i].matchAll(/\b(\w+)\.(?:value|checked)\s*=/g)) { if (vars[m[1]]) { ids.add(vars[m[1]]); } }
    }
  }
  return ids;
})();
const MIRRORS = { 'design-fy': 'input-fy', 'design-fu': 'input-fu', 'plastic-fy': 'input-fy (two-way)', 'conn-Fy': 'input-fy (copied on change, then free)',
  'conn-Fu': 'input-fu (copied on change, then free)' };
// 공학 값이 아닌 칸(보기 · 표시 설정) — 「손으로 정한 공학 기본값」 표지에서 뺀다
const UI_ONLY = new Set(['select-length', 'select-mode', 'chk-cfsm-enable', 'chk-cfsm-G', 'chk-cfsm-D', 'chk-cfsm-L', 'chk-cfsm-O']);

// ── 의존(켜기 · 보이기 · 다른 칸 만들기) — 손으로 적고, 근거 줄을 코드에서 찾는다 ─────────────────
const DEPENDS = [
  ['select-member-type', 'shows/hides rows: calc mode (roof-purlin · floor-joist · wall-girt · wall-stud) ↔ direct; KxLx/KtLt rows (compression · combined), Lb/Cb (flexure · combined), Cm (combined), web crippling (flexure · combined), Lr/S/W/L load rows; calc → direct clears design-Mx-pos · Lb-pos · Cb-pos · dist-M1M2 · dist-Lm and unchecks β (V4-17)', 'const updateDesignFieldVisibility'],
  ['select-span-type', 'rebuilds the span table (count = 1 · 2 · 3 · 4 · config-n-spans); config-n-spans visible only for cont-n; laps only for continuous', 'selSpanType.addEventListener'],
  ['config-n-spans', 'rebuilds the span table (cont-n)', "nSpanInput.addEventListener('change', buildSpanTable)"],
  ['input-steel-grade', 'writes input-fy · input-fu (grade table), input-E = 29500 ksi, input-G = 11300 ksi, then mirrors Fy/Fu', 'selGradePre.addEventListener'],
  ['input-fy', 'mirrors to design-fy · plastic-fy · conn-Fy and the analysis Fy label; also the analysis reference stress for the GUI run', 'function propagateFyFuFromPreprocessor'],
  ['input-fu', 'mirrors to design-fu · conn-Fu', 'function syncFuValue'],
  ['plastic-fy', 'mirrors back to input-fy · design-fy · conn-Fy', 'function propagateFyFromPlastic'],
  ['input-E', 'G = E / 2(1 + ν) written into input-G on input', 'function updateG'],
  ['input-v', 'G = E / 2(1 + ν) written into input-G on input', 'function updateG'],
  ['select-load-case', 'custom → shows input-load-P/Mxx/Mzz; stress preview', 'selLoadCase.addEventListener'],
  ['select-template', 'shows tpl-qlip for lipped C/Z/angle; dimension hint', 'selTemplateEl.addEventListener'],
  ['chk-beta-dist', 'shows design-dist-M1M2 · design-dist-Lm; when switched on with Lm 0 fills them from the load analysis or Lb', 'const toggleBeta'],
  ['chk-r-factor', 'R_uplift + span_type sent only when checked and select-r-value > 0', 'const chk = /** @type {HTMLInputElement|null} */ (document.getElementById(\'chk-r-factor\'))'],
  ['conn-single-type', 'shows weld / groove / Fub / Pnvs / d\'w / Fuf rows; decides which of them are sent', 'const updateConnTypeUI'],
  ['config-spacing', 'loads are sent as plf = psf × spacing; plf display', 'function updatePLF'],
  ['chk-cold-work', 'notice next to inelastic reserve', 'const updateColdWorkNotice'],
];
function findLine(text, src = APP) { const i = src.findIndex((l) => l.includes(text)); return i >= 0 ? i + 1 : null; }

// ── MCP 대응(손으로 적은 표 — 도구 스키마에 그 인자가 있는지는 자동으로 본다) ─────────────────
const DESIGN_TOOLS = ['aisi_design_compression', 'aisi_design_flexure', 'aisi_design_combined', 'aisi_design_tension'];
const MCP_MAP = {
  'design-fy': [...DESIGN_TOOLS.map((t) => `${t}.Fy`), 'design_purlin.Fy', 'analyze_loads.Fy', 'design_lap_connection.Fy', 'validate_design.Fy', 'generate_report.Fy', 'get_dsm_values.fy', 'get_web_crippling.Fy'],
  'design-fu': [...DESIGN_TOOLS.map((t) => `${t}.Fu`), 'design_purlin.Fu', 'analyze_loads.Fu', 'design_lap_connection.Fu'],
  'input-fy': ['set_load_case.fy', 'set_stress.fy'],
  'input-fu': [],
  'plastic-fy': ['run_plastic_surface.fy'],
  'input-steel-grade': [],
  'input-E': ['set_material.E'], 'input-v': ['set_material.v'], 'input-G': ['set_material.G'],
  'select-design-method': [...DESIGN_TOOLS.map((t) => `${t}.design_method`), 'design_purlin.design_method', 'analyze_loads.design_method',
    'design_connection.design_method', 'design_lap_connection.design_method', 'generate_report.design_method'],
  'select-member-type': ['(tool choice) aisi_design_compression · flexure · combined · tension', 'design_purlin.member_app', 'analyze_loads.member_app', 'generate_report.member_type'],
  'select-span-type': ['design_purlin.span_type', 'analyze_loads.span_type'], 'config-n-spans': ['design_purlin.span_type', 'analyze_loads.span_type'],
  'config-spacing': ['design_purlin.spacing_ft', 'analyze_loads.spacing_ft'],
  'load-D-psf': ['design_purlin.loads.D', 'analyze_loads.loads.D'], 'load-Lr-psf': ['design_purlin.loads.Lr', 'analyze_loads.loads.Lr'],
  'load-S-psf': ['design_purlin.loads.S', 'analyze_loads.loads.S'], 'load-Wu-psf': ['design_purlin.loads.W', 'analyze_loads.loads.W'],
  'load-Wp-psf': ['design_purlin.loads.Wp', 'analyze_loads.loads.Wp'], 'load-L-psf': ['design_purlin.loads.L', 'analyze_loads.loads.L'],
  'chk-pattern-loading': ['design_purlin.pattern_loading', 'analyze_loads.pattern_loading'],
  'chk-lr-reduced': ['design_purlin.lr_reduced', 'analyze_loads.lr_reduced'],
  'span-Ix-list': ['design_purlin.I_span_in4', 'analyze_loads.I_span_in4'],
  'select-deck-type': ['design_purlin.deck.type', 'analyze_loads.deck.type'],
  'deck-t-panel': ['design_purlin.deck.t_panel', 'analyze_loads.deck.t_panel', 'calc_deck_stiffness.t_panel'],
  'deck-fastener-spacing': ['design_purlin.deck.fastener_spacing', 'analyze_loads.deck.fastener_spacing', 'calc_deck_stiffness.fastener_spacing'],
  'deck-kphi-override': ['design_purlin.deck.kphi_override', 'analyze_loads.deck.kphi_override', 'calc_deck_stiffness.kphi_override'],
  'deck-kx-override': ['design_purlin.deck.kx_override', 'analyze_loads.deck.kx_override', 'calc_deck_stiffness.kx_override'],
  'brace-points': ['design_purlin.brace_points_ft', 'analyze_loads.brace_points_ft'],
  'chk-i621-confirmed': ['design_purlin.i621_conditions_confirmed', 'analyze_loads.i621_conditions_confirmed'],
  'chk-lap-restrained': ['design_purlin.lap_restrained', 'design_purlin.distortion_restrained', 'design_lap_connection.lap_restrained', 'design_lap_connection.distortion_restrained'],
  'chk-lap-restrained-lap': ['design_lap_connection.lap_restrained', 'design_lap_connection.distortion_restrained', 'design_purlin.lap_restrained', 'design_purlin.distortion_restrained'],
  'deck-insulation': ['design_purlin.insulation_in', 'analyze_loads.insulation_in'],
  'deck-R-tested': ['design_purlin.deck.R_tested_uplift', 'analyze_loads.deck.R_tested_uplift'],
  'design-KxLx': ['aisi_design_compression.KxLx', 'aisi_design_combined.KxLx', 'get_dsm_values.KxLx', 'generate_report.KxLx'],
  'design-KyLy': ['aisi_design_compression.KyLy', 'aisi_design_combined.KyLy', 'get_dsm_values.KyLy', 'generate_report.KyLy'],
  'design-KtLt': ['aisi_design_compression.KtLt', 'aisi_design_combined.KtLt', 'get_dsm_values.KtLt', 'generate_report.KtLt'],
  'design-Lb': ['aisi_design_flexure.Lb', 'aisi_design_combined.Lb', 'get_dsm_values.Lb', 'generate_report.Lb'],
  'design-Cb': ['aisi_design_flexure.Cb', 'aisi_design_combined.Cb', 'get_dsm_values.Cb', 'generate_report.Cb'],
  'design-Lb-pos': ['aisi_design_flexure.Lb_pos'], 'design-Cb-pos': ['aisi_design_flexure.Cb_pos'],
  'design-Cmx': ['aisi_design_combined.Cmx'], 'design-Cmy': ['aisi_design_combined.Cmy'],
  'design-P': ['aisi_design_compression.Pu', 'aisi_design_combined.Pu', 'aisi_design_tension.Tu', 'generate_report.Pu'],
  'design-V': ['aisi_design_flexure.Vu', 'aisi_design_combined.Vu'],
  'design-Mx': ['aisi_design_flexure.Mu', 'aisi_design_combined.Mux', 'generate_report.Mu'],
  'design-Mx-pos': ['aisi_design_flexure.Mu_pos'], 'design-My': ['aisi_design_combined.Muy'],
  'design-May-strength': ['aisi_design_combined.May_strength'],
  'chk-beta-dist': ['(gate) aisi_design_flexure.dist_M1_M2 / dist_Lm'],
  'design-dist-M1M2': ['aisi_design_flexure.dist_M1_M2', 'aisi_design_combined.dist_M1_M2'],
  'design-dist-Lm': ['aisi_design_flexure.dist_Lm'],
  'chk-r-factor': ['(gate) aisi_design_flexure.R_uplift'], 'select-r-value': ['aisi_design_flexure.R_uplift', 'aisi_design_flexure.span_type'],
  'chk-cold-work': ['aisi_design_flexure.use_cold_work', 'design_purlin.use_cold_work'],
  'chk-inelastic-reserve': ['aisi_design_flexure.use_inelastic_reserve', 'design_purlin.use_inelastic_reserve'],
  'design-wc-N': ['aisi_design_flexure.wc_N', 'design_purlin.wc_N', 'get_web_crippling.N'],
  'design-wc-R': ['aisi_design_flexure.wc_R', 'design_purlin.wc_R', 'get_web_crippling.R'],
  'design-wc-P': ['aisi_design_flexure.wc_P'],
  'design-wc-support': ['aisi_design_flexure.wc_support', 'get_web_crippling.support'],
  'design-wc-fastened': ['aisi_design_flexure.wc_fastened', 'design_purlin.wc_fastened', 'get_web_crippling.fastened'],
  'design-wc-web-config': ['aisi_design_flexure.wc_web_config', 'design_purlin.wc_web_config', 'get_web_crippling.web_config'],
  'design-wc-family': ['aisi_design_flexure.wc_section_family', 'design_purlin.wc_section_family', 'get_web_crippling.section_family'],
  'design-wc-flange-condition': ['aisi_design_flexure.wc_flange_condition', 'design_purlin.wc_flange_condition', 'get_web_crippling.flange_condition'],
  'design-wc-Lo': ['aisi_design_flexure.wc_overhang', 'design_purlin.wc_overhang', 'get_web_crippling.Lo'],
  'design-wc-edge-distance': ['aisi_design_flexure.wc_edge_distance', 'design_purlin.wc_edge_distance', 'get_web_crippling.edge_distance'],
  'design-wc-nwebs': ['aisi_design_flexure.wc_n_webs', 'design_purlin.wc_n_webs', 'get_web_crippling.n_webs'],
  'design-wc-fastener-spacing': ['aisi_design_flexure.wc_support_fastener_spacing', 'design_purlin.wc_support_fastener_spacing', 'get_web_crippling.support_fastener_spacing'],
  'select-template': ['set_section_template.type'], 'tpl-H': ['set_section_template.H', 'design_lap_connection.d'], 'tpl-B': ['set_section_template.B'],
  'tpl-D': ['set_section_template.D'], 'tpl-t': ['set_section_template.t', 'design_lap_connection.t', 'get_web_crippling.t'], 'tpl-r': ['set_section_template.r'], 'tpl-qlip': ['set_section_template.qlip'],
  'select-bc': ['set_boundary_condition.BC'],
  'select-load-case': ['set_load_case.load_case'],
  'input-load-P': ['set_load_case.P'], 'input-load-Mxx': ['set_load_case.Mxx'], 'input-load-Mzz': ['set_load_case.Mzz'],
  'input-len-min': ['set_lengths.min'], 'input-len-max': ['set_lengths.max'], 'input-len-n': ['set_lengths.n'],
  'input-neigs': ['run_analysis.neigs'],
  'chk-cfsm-enable': [], 'chk-cfsm-G': [], 'chk-cfsm-D': [], 'chk-cfsm-L': [], 'chk-cfsm-O': [],
  'vib-rho': ['run_vibration.rho'], 'vib-lengths': ['run_vibration.lengths'],
  'select-length': [], 'select-mode': [],
  'conn-lap-left': ['design_lap_connection.lap_left_in'], 'conn-lap-right': ['design_lap_connection.lap_right_in'],
  'conn-Mu': ['design_lap_connection.Mu_support'], 'conn-Vu': ['design_lap_connection.Vu_support'],
  'conn-fastener-type': ['design_lap_connection.fastener_type'], 'conn-fastener-dia': ['design_lap_connection.fastener_dia'],
  'conn-n-rows': ['design_lap_connection.n_rows'], 'conn-edge-dist': ['design_lap_connection.end_distance'],
  'conn-lap-Pnvs': ['design_lap_connection.Pnvs'],
  'conn-single-type': ['design_connection.connection_type'], 'conn-t1': ['design_connection.t1'], 'conn-t2': ['design_connection.t2'],
  'conn-d': ['design_connection.d'], 'conn-n': ['design_connection.n'], 'conn-Fy': ['design_connection.Fy'], 'conn-Fu': ['design_connection.Fu'],
  'conn-weld-L': ['design_connection.weld_length'], 'conn-weld-size': ['design_connection.weld_size'], 'conn-groove-type': ['design_connection.groove_type'],
  'conn-Fub': ['design_connection.Fub'], 'conn-Pnvs': ['design_connection.Pnvs'], 'conn-dw': ['design_connection.dw'], 'conn-Fuf': ['design_connection.Fuf'],
  'conn-Pu': ['design_connection.Pu'], 'conn-Tu': ['design_connection.Tu'], 'conn-e': ['design_connection.e'], 'conn-s': ['design_connection.s'],
  'conn-member-case': ['design_connection.member_case'], 'conn-width': ['design_connection.width'], 'conn-j63-na': ['design_connection.j6_3_not_applicable'],
  '.span-tbl-len': ['design_purlin.spans_ft', 'analyze_loads.spans_ft', 'design_purlin.span_ft'],
  '.span-tbl-sup': ['design_purlin.supports', 'analyze_loads.supports'],
  '.span-tbl-lapl': ['design_purlin.laps_per_support', 'analyze_loads.laps_per_support', 'design_purlin.laps.left_ft'],
  '.span-tbl-lapr': ['design_purlin.laps_per_support', 'analyze_loads.laps_per_support', 'design_purlin.laps.right_ft'],
};

// ── 화면 단위 처리 ──────────────────────────────────────────────────────────
const UNIT_LABEL = { length: 'in | mm', length_ft: 'ft | m', thickness: 'in | mm', radius: 'in | mm', stress: 'ksi | MPa', force: 'kips | kN',
  moment: 'kip-in | kN-m', pressure: 'psf | kPa', inertia: 'in⁴ | mm⁴', rotStiff: 'kip-in/rad/in | kN-m/rad/m', latStiff: 'kip/in/in | kN/m/m',
  density: 'kip·s²/in⁴ | kg/m³' };

async function listTools() {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  const { Client } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'index.js'));
  const { StdioClientTransport } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'stdio.js'));
  const dir = path.join(OUT, 'inventory-mcpjs');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['server', 'siUnits', 'bridge', 'portFile', 'hostConnection']) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp', `${f}.ts`), 'utf8');
    fs.writeFileSync(path.join(dir, `${f}.js`), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
  }
  const env = { ...process.env, STCFSD_MCP_PORT: '1', NODE_PATH: path.join(ROOT, 'node_modules') };
  delete env.STCFSD_MCP_PORT_FILE; delete env.STCFSD_MCP_STANDALONE;
  const c = new Client({ name: 'stcfsd-k2-inventory', version: '1' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(dir, 'server.js')], env, stderr: 'pipe' }));
  const tools = (await c.listTools()).tools;
  await c.close();
  const flat = (s, p) => {
    const o = [];
    for (const [k, v] of Object.entries(s.properties || {})) {
      const q = p ? `${p}.${k}` : k;
      const obj = v.type === 'object' ? v : (v.type === 'array' && v.items && v.items.type === 'object' ? v.items : (Array.isArray(v.anyOf) ? v.anyOf.find((x) => x.type === 'object') : null));
      o.push(q);
      if (obj && obj.properties) { o.push(...flat(obj, q)); }
    }
    return o;
  };
  return Object.fromEntries(tools.map((t) => [t.name, flat(t.inputSchema, '')]));
}

function mcpReach() {
  const reach = {};   // id → [tool …]
  for (const f of fs.readdirSync(GOLDEN).filter((x) => x.startsWith('mcp-'))) {
    const g = JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));
    for (const e of g.entries) {
      if (!e.id.endsWith('.inputsChanged')) { continue; }
      const tool = e.id.replace(/\.inputsChanged$/, '');
      for (const id of Object.keys(e.value || {})) { (reach[id] = reach[id] || new Set()).add(tool); }
    }
  }
  return Object.fromEntries(Object.entries(reach).map(([k, v]) => [k, [...v].sort()]));
}

async function main() {
  const domFile = path.join(OUT, 'dom_controls.json');
  if (!fs.existsSync(domFile)) { throw new Error('run `node test/rendered/k2/run.js --only=defaults` first (needs the walked DOM)'); }
  const dom = JSON.parse(fs.readFileSync(domFile, 'utf8'));
  const tools = await listTools();
  const reach = mcpReach();
  const fields = new Map(DS.FIELDS.map(([key, id, unit, kind]) => [id, { key, unit, kind }]));
  const viewOnly = new Map(DS.VIEW_ONLY_CONTROLS);

  // 경간 표는 칸마다가 아니라 종류마다 한 줄
  const seen = new Set();
  const rows = [];
  for (const c of dom.controls) {
    const id = c.id || `.${c.cls}`;
    if (seen.has(id)) { continue; }
    seen.add(id);
    rows.push({ c, id });
  }
  const problems = [];
  const items = rows.map(({ c, id }) => {
    const f = fields.get(c.id);
    const isSpan = !c.id;
    const unit = f ? f.unit : (isSpan && c.cls !== 'span-tbl-sup' ? 'length_ft' : null);
    const kind = f ? f.kind : (c.tag === 'select' ? 'sel' : (c.type === 'checkbox' ? 'chk' : 'num'));
    const src = c.id ? htmlSourceLine(c.id) : null;
    const refs = c.id ? appRefs(c.id) : appRefs(c.cls, true);
    const keys = c.id ? payloadKeys(c.id) : [];
    // 처음 값과 그 출처
    let defaultSource;
    if (isSpan) { defaultSource = 'page JS (buildSpanTable: span 5 m, support P, laps 0; count from select-span-type)'; }
    else if (MIRRORS[c.id]) { defaultSource = `mirror of ${MIRRORS[c.id]}`; }
    else if (MODEL_SYNCED.has(c.id)) { defaultSource = 'host model (createDefaultModel / _initializeWithDefaultSection) — overwritten from the model on every modelLoaded'; }
    else if (src && /\$\{steel/.test(src.text)) { defaultSource = 'steel-grade table (src/webview/steelGrades.ts, SGC400)'; }
    else if (c.id === 'input-steel-grade') { defaultSource = 'steel-grade table (src/webview/steelGrades.ts — steelGradeOptionsHtml marks SGC400 selected)'; }
    else if (c.tag === 'select') { defaultSource = 'page HTML (selected option)'; }
    else if (c.type === 'checkbox') { defaultSource = 'page HTML (checked attribute)'; }
    else if (c.htmlValue !== null && c.htmlValue !== '') { defaultSource = 'page HTML (value attribute)'; }
    else { defaultSource = 'blank (no value — the input is absent)'; }
    // 손으로 정한 공학 기본값: 화면 HTML · JS 에 적힌 값으로, 비어 있지 않고 「없음」의 뜻(0 · none · auto · 빈 선택 · 꺼진 체크)이 아닌 것
    const v0 = c.type === 'checkbox' ? c.valueUS : String(c.valueUS);
    const noneLike = c.type === 'checkbox' ? v0 === false : (v0 === '' || /^0(.0+)?$/.test(v0) || ['none', 'auto'].includes(v0));
    const hardCoded = /^page (HTML|JS)/.test(defaultSource) && !UI_ONLY.has(c.id) && !noneLike;
    const zeroAsNone = /^page (HTML|JS)/.test(defaultSource) && !UI_ONLY.has(c.id) && noneLike && v0 !== '' && v0 !== false;
    const mcpArgs = MCP_MAP[c.id || `.${c.cls}`];
    if (mcpArgs === undefined) { problems.push(`no MCP mapping row for ${id}`); }
    const mcpChecked = (mcpArgs || []).map((a) => {
      if (a.startsWith('(')) { return { arg: a, inSchema: null }; }
      const [tool, ...rest] = a.split('.');
      const arg = rest.join('.').replace(/\[\]/g, '');
      const ok = !!(tools[tool] && tools[tool].includes(arg));
      if (!ok) { problems.push(`MCP mapping ${id} → ${a} is not in the tool schema`); }
      return { arg: a, inSchema: ok };
    });
    const msgs = [...new Set(refs.flatMap((r) => r.msgs))];
    const readers = [...new Set(refs.map((r) => r.in))];
    const derivedFrom = [];
    if (LOAD_FILLED.has(c.id)) { derivedFrom.push('load analysis result (renderLoadAnalysisResult / _autoFillLapInputs)'); }
    if (MODEL_SYNCED.has(c.id)) { derivedFrom.push('host model (_syncAnalysisWidgetsFromModel / renderPreprocessor)'); }
    if (MIRRORS[c.id]) { derivedFrom.push(`mirror of ${MIRRORS[c.id]}`); }
    let role = 'input';
    if (c.readOnly) { role = 'derived display (read-only mirror)'; }
    else if (viewOnly.has(c.id) && UI_ONLY.has(c.id)) { role = 'view setting (not an engineering input)'; }
    else if (derivedFrom.length) { role = 'input, also written by the page from ' + derivedFrom.join(' + '); }
    const dep = DEPENDS.filter(([d]) => d === c.id).map(([, what, anchor]) => ({ what, line: findLine(anchor) }));
    const dependsOn = DEPENDS.filter(([d, what]) => d !== c.id && c.id && what.includes(c.id)).map(([d]) => d);
    return {
      id, tab: c.tab, group: c.group, label: c.label || null, control: c.tag === 'select' ? 'select' : (c.type || c.tag),
      csdKey: f ? f.key : (isSpan ? { 'span-tbl-len': 'spans', 'span-tbl-sup': 'supports', 'span-tbl-lapl': 'lapsPerSupport[].left', 'span-tbl-lapr': 'lapsPerSupport[].right' }[c.cls] : null),
      savedInCsd13: !!f || isSpan,
      kind, unit, unitDisplay: unit ? (UNIT_LABEL[unit] || unit) : null,
      unitHandling: unit ? (kind === 'list' ? 'designState UNIT_FIELDS (list: each number converted in refreshUnits)' : 'designState UNIT_FIELDS → refreshUnits (12 digits) · .csd stores US') : (isSpan ? 'refreshUnits converts span-table inputs (length_ft)' : 'none'),
      default: { SI: c.valueSI, US: c.valueUS, html: c.htmlValue ?? c.htmlChecked, source: defaultSource, hardCodedEngineeringDefault: hardCoded, zeroOrNoneDefault: zeroAsNone,
        htmlLine: src ? src.line : null },
      options: c.options ? c.options.map((o) => o.value + (o.span ? `[${o.span}]` : '')) : null,
      readOnly: c.readOnly, initiallyHidden: c.initiallyHidden,
      role, viewOnly: viewOnly.has(c.id) ? viewOnly.get(c.id) : null, invalidatesResultsOnChange: c.tab === 'tab-connection' ? false : (c.id ? DS.invalidatesResults(c.id) : true),
      payloadKeys: keys, readBy: readers, leadsTo: msgs, appLines: refs.map((r) => r.line),
      mcp: mcpChecked, mcpCanSet: (mcpArgs || []).some((a) => !a.startsWith('(gate)')) || (mcpArgs || []).some((a) => a.startsWith('(tool')),
      mcpReachesPage: reach[c.id || `.${c.cls}`] || [],
      dependsOn, drives: dep,
    };
  });

  // FIELDS 에 있는데 화면에 없는 키 · 화면에 있는데 FIELDS 에 없는 칸
  const domIds = new Set(dom.controls.map((c) => c.id).filter(Boolean));
  for (const [id, f] of fields) { if (!domIds.has(id)) { problems.push(`designState key ${f.key} (${id}) has no control on the page`); } }
  const notSaved = items.filter((i) => !i.savedInCsd13).map((i) => i.id);

  // MCP 설계 도구의 인자 가운데 화면 칸이 없는 것(K2 상태가 함께 가져야 할 것)
  const mapped = new Set(Object.values(MCP_MAP).flat().filter((a) => !a.startsWith('(')).map((a) => a.replace(/\[\]/g, '')));
  const MCP_ONLY = {};
  for (const t of [...DESIGN_TOOLS, 'design_purlin', 'analyze_loads', 'design_connection', 'design_lap_connection', 'get_web_crippling', 'calc_deck_stiffness', 'run_vibration', 'run_plastic_surface']) {
    MCP_ONLY[t] = (tools[t] || []).filter((a) => a !== 'units' && !mapped.has(`${t}.${a}`) && !(tools[t] || []).some((b) => b.startsWith(a + '.') && mapped.has(`${t}.${b}`)));
  }

  const byTab = {};
  for (const i of items) { byTab[i.tab] = (byTab[i.tab] || 0) + 1; }
  const engineering = items.filter((i) => i.role !== 'view setting (not an engineering input)');
  const summary = {
    controls: items.length, spanTableKinds: items.filter((i) => i.id.startsWith('.')).length,
    sectionTableInputsExcluded: dom.sectionTableInputs,
    byTab, engineeringInputs: engineering.length,
    savedInCsd13: items.filter((i) => i.savedInCsd13).length, notSavedInCsd13: notSaved,
    mcpCanSet: items.filter((i) => i.mcpCanSet).length,
    mcpReachesPageToday: items.filter((i) => i.mcpReachesPage.length > 0).map((i) => `${i.id} ← ${i.mcpReachesPage.join(', ')}`),
    hardCodedEngineeringDefaults: items.filter((i) => i.default.hardCodedEngineeringDefault).map((i) => i.id),
    zeroOrNoneDefaults: items.filter((i) => i.default.zeroOrNoneDefault).map((i) => i.id),
    derivedOrMirror: items.filter((i) => /derived|written by/.test(i.role)).map((i) => i.id),
    designStateFields: DS.FIELDS.length, viewOnlyControls: DS.VIEW_ONLY_CONTROLS.length,
    problems,
  };
  const doc = {
    about: 'K2 phase 0 — every input outside the section model (StCFSD webview), generated by test/rendered/k2/inventory.js from the walked DOM, designState.js, app.js, StcfsdPanel.ts, the MCP tool schemas and the K2 pin goldens. Do not edit by hand — re-run the generator.',
    generated: new Date().toISOString().slice(0, 10),
    summary, mcpOnlyDesignArgs: MCP_ONLY, items,
  };
  fs.writeFileSync(DOC_JSON, JSON.stringify(doc, null, 1) + '\n');

  // .md 표(있으면 표지 사이를 다시 쓴다)
  if (fs.existsSync(DOC_MD)) {
    const md = fs.readFileSync(DOC_MD, 'utf8');
    const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const tabKo = { 'tab-preprocessor': '①', 'tab-loads': '②', 'tab-design': '③', 'tab-connection': '④' };
    const lines = ['| # | id | 탭 · 묶음 | 칸 | .csd 키 | 단위 | 처음 값 (SI / US) · 출처 | 읽는 곳 → 메시지 | MCP 인자 | MCP → 화면 | 역할 · 의존 |', '|---|---|---|---|---|---|---|---|---|---|---|'];
    items.forEach((i, n) => {
      const def = `${esc(JSON.stringify(i.default.SI))} / ${esc(JSON.stringify(i.default.US))} · ${esc(i.default.source.replace(/ —.*$/, ''))}${i.default.hardCodedEngineeringDefault ? ' **⚑**' : ''}`;
      const reads = esc([...i.readBy.filter((r) => !/^\(top level\)$/.test(r))].slice(0, 6).join(', ')) + (i.leadsTo.length ? ' → ' + esc(i.leadsTo.filter((m) => !m.startsWith('(')).join('; ')) : '');
      const mcpCell = i.mcp.length ? esc(i.mcp.map((m) => m.arg + (m.inSchema === false ? ' ✗' : '')).join(', ')) : '—';
      const role = esc(i.role) + (i.drives.length ? ' · 정함: ' + esc(i.drives.map((d) => d.what).join(' / ')) : '') + (i.dependsOn.length ? ' · 따름: ' + esc(i.dependsOn.join(', ')) : '');
      lines.push(`| ${n + 1} | \`${esc(i.id)}\` | ${tabKo[i.tab] || esc(i.tab)} ${esc(i.group)} | ${esc(i.control)}${i.readOnly ? ' (읽기 전용)' : ''} | ${i.csdKey ? '`' + esc(i.csdKey) + '`' : '— (저장 안 함)'} | ${esc(i.unitDisplay || '—')} | ${def} | ${reads} | ${mcpCell} | ${i.mcpReachesPage.length ? esc(i.mcpReachesPage.join(', ')) : '—'} | ${role} |`);
    });
    const block = `<!-- inventory:begin (생성: node test/rendered/k2/inventory.js — 손으로 고치지 않는다) -->\n${lines.join('\n')}\n<!-- inventory:end -->`;
    const out = md.replace(/<!-- inventory:begin[\s\S]*?<!-- inventory:end -->/, block);
    fs.writeFileSync(DOC_MD, out);
  }
  console.log(JSON.stringify(summary, null, 1));
  console.log('mcp-only design args:', JSON.stringify(MCP_ONLY));
  if (problems.length) { process.exitCode = 1; }
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e); process.exit(1); });
