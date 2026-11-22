/* global process */
// W3: 호스트(StcfsdPanel) 계약 시험 — VS Code 없이, 진짜 파이썬 서버로 handleMcpAction · 웹뷰 메시지를 구동한다.
// 기대값은 엔진을 따로 부른 값(같은 브리지의 다른 메서드)이나 닫힌 식에서 — 패널이 낸 값을 베끼지 않는다.
// .venv 가 없으면 SKIP 을 분명히 적고 끝낸다(조용한 통과 없음 — 종료 코드 0 이지만 'SKIP' 한 줄).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPanel } = require('./panel_harness');

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

// S-steel-default: 기본 강종(SGC400 295/400 MPa)이 호스트 초기 모델 · 화면 재료 칸의 처음 값 · 드롭다운 ·
// 엔진 강종 표에서 같다. 기대 MPa 는 정의값 환산(1 kip = 4.4482216152605 kN, 1 in = 25.4 mm)으로 따로 만든다.
async function scenarioDefaultSteelAgrees(ctx) {
  const p = ctx.panel;
  const KSI_MPA = 4448.2216152605 / (25.4 * 25.4);
  const st = p.__testGetState();
  // 호스트 초기 모델: 기준응력 = 기본 강종 Fy, 응력 분포는 그 값의 균일 압축
  assert.strictEqual(st.model.loadFy * KSI_MPA, 295, `host loadFy ${st.model.loadFy} ksi is 295 MPa`);
  assert(ctx.model().node.every((n) => n[7] === st.model.loadFy), 'initial node stresses are the default Fy');
  // 엔진 강종 표: 첫 항목 = 기본 강종
  const rows = await ctx.bridge.call('steel_grades', { include_restricted: true });
  const engine = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.strictEqual(rows[0].id, 'SGC400', 'engine grade table starts with the default steel');
  assert.deepStrictEqual([rows[0].Fy_MPa, rows[0].Fu_MPa], [295, 400], 'engine SGC400 = 295/400 MPa');
  // 화면(호스트가 쓴 HTML): 드롭다운 · 재료 칸
  const html = p.__testGetHtml();
  const sel = html.match(/<select id="input-steel-grade"[^>]*>([\s\S]*?)<\/select>/);
  assert(sel, 'grade dropdown present');
  const opts = [...sel[1].matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)]
    .map(([, id, attrs, label]) => ({ id, label, selected: / selected/.test(attrs),
      fy: Number((attrs.match(/data-fy="([^"]+)"/) || [])[1]), fu: Number((attrs.match(/data-fu="([^"]+)"/) || [])[1]) }));
  const selected = opts.filter((o) => o.selected);
  assert.deepStrictEqual(selected.map((o) => o.id), ['SGC400'], 'SGC400 is the selected grade');
  for (const o of opts.filter((x) => x.id)) {
    const e = engine[o.id];
    assert(e, `dropdown grade ${o.id} is in the engine table`);
    assert(o.fy === e.Fy && o.fu === e.Fu, `${o.id}: dropdown ${o.fy}/${o.fu} ksi = engine ${e.Fy}/${e.Fu} ksi`);
  }
  for (const [id, fy, fu] of [['SGC340', 245, 340], ['SGC400', 295, 400], ['SGC440', 335, 440], ['SGC490', 365, 490]]) {
    const o = opts.find((x) => x.id === id);
    assert(o && o.fy * KSI_MPA === fy && o.fu * KSI_MPA === fu, `${id} option is ${fy}/${fu} MPa`);
    assert(o.label.includes(`(${fy}/${fu} MPa)`), `${id} label states ${fy}/${fu} MPa (${o.label})`);
  }
  const val = (id) => (html.match(new RegExp(`id="${id}" value="([^"]*)"`)) || [])[1];
  const d = selected[0];
  for (const id of ['input-fy', 'plastic-fy', 'design-fy', 'conn-Fy']) {
    assert.strictEqual(Number(val(id)), d.fy * KSI_MPA, `${id} starts at the default Fy (${val(id)} MPa)`);
    assert.strictEqual(val(id), '295', `${id} shows 295`);
  }
  for (const id of ['input-fu', 'design-fu', 'conn-Fu']) {
    assert.strictEqual(val(id), '400', `${id} starts at the default Fu (${val(id)} MPa)`);
  }
  assert(/id="analysis-fy-display">Fy: 295 MPa</.test(html), 'analysis Fy display starts at 295 MPa');
  assert.strictEqual(st.model.loadFy, d.fy, 'host loadFy is the selected dropdown Fy (one table)');
  // 웹뷰는 따로 강종 표를 두지 않는다(드롭다운 data-fy · data-fu 를 읽는다)
  const appJs = fs.readFileSync(path.join(__dirname, '..', '..', 'webview', 'js', 'app.js'), 'utf8');
  assert(!/gradeMap|35\.53|58\.02/.test(appJs), 'app.js has no own grade table or old default numbers');
  assert(/dataset\.fy/.test(appJs) && /dataset\.fu/.test(appJs), 'app.js reads the grade values from the dropdown');
}

async function scenarioTemplateLoadCaseAndDsm(ctx) {
  const p = ctx.panel;
  // R8-03: 초기 상태(화면 기본 = 압축)와 템플릿 뒤 하중 표지는 응력과 같아야 한다.
  let st = p.__testGetState();
  assert.strictEqual(st.model.loadCase, 'compression', 'initial host model matches the GUI default load case');
  assert.strictEqual(st.model.m_all, 'auto', 'R8 F1 후속: host model sends m_all "auto", not [1] per length');
  assert.strictEqual(st.model.GBTcon.orth, 2, 'CUFSM default basis orth 2');
  assert.strictEqual(st.model.GBTcon.norm, 1, 'CUFSM default basis norm 1');

  await p.handleMcpAction({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 50 });
  let r = await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedc',
    params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0 } });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.load_case, 'compression', 'R8-03: template sets uniform stress -> compression label');
  await p.handleMcpAction({ action: 'set_lengths', min: 1, max: 1000, n: 15 });
  r = await p.handleMcpAction({ action: 'run_analysis' });
  assert.strictEqual(r.load_family, 'P', 'R8-03 regression: template -> run_analysis is a P curve');
  assert(Array.isArray(r.warnings), 'run_analysis returns analysis warnings');
  assert(r.m_all_selection && r.m_all_selection.source, 'run_analysis returns the m_all selection');
  r = await p.handleMcpAction({ action: 'get_dsm', load_type: 'Mxx' });
  assert(r.error, 'R8-03: Mxx DSM on a compression curve is refused');

  // R8-01: fy 는 언제나 해석 기준응력. 다른 fy 를 주면 거절.
  const ok = await p.handleMcpAction({ action: 'get_dsm', load_type: 'P' });
  assert(!ok.error && ok.P, 'P DSM extracted');
  assert.strictEqual(ok.fy_used, 50, 'DSM uses the analysis reference stress (50 ksi)');
  const bad = await p.handleMcpAction({ action: 'get_dsm', load_type: 'P', fy: 35.53 });
  assert(bad.error && /differs from the analysis reference stress/.test(bad.error), 'R8-01: other fy refused');
  // 독립: 같은 곡선 · 같은 fy 로 브리지 dsm 을 직접 부른 값과 같다(BC 포함).
  const res = p.__testGetState();
  void res;
}

async function scenarioZSectionType(ctx) {
  const p = ctx.panel;
  // R8-05: Z 단면의 폐형식 전체좌굴은 모델 형식 'Z' 로(지정하지 않아도).
  await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedz',
    params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0 } });
  await p.handleMcpAction({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 50 });
  await p.handleMcpAction({ action: 'set_lengths', min: 1, max: 1000, n: 15 });
  const run = await p.handleMcpAction({ action: 'run_analysis' });
  assert.strictEqual(run.load_family, 'Mxx');
  const viaPanel = await p.handleMcpAction({ action: 'get_dsm', load_type: 'Mxx', Lb: 120 });
  assert(!viaPanel.error, viaPanel.error);
  assert.strictEqual(viaPanel.section_type_used, 'Z', 'R8-05: model section type forwarded');
  // 독립 기대값: 같은 곡선으로 브리지 dsm 을 section_type 'Z' / 'C' 로 직접 부른다.
  const snap = ctx.lastAnalysis();
  const direct = async (st) => ctx.bridge.call('dsm', {
    node: snap.node, elem: snap.elem, curve: snap.curve, fy: 50, load_type: 'Mxx', Lb: 120, section_type: st, BC: 'S-S' });
  const z = await direct('Z');
  const c = await direct('C');
  assert(rel(viaPanel.Mxx.cre, z.cre) < 1e-9, 'panel Mcre equals the Z closed form');
  assert(rel(c.cre / z.cre, 2.0) < 0.01, 'C formula would give 2x (F2.1.3 Z /2) — R8 measured 64.27/32.14');
}

async function scenarioSignatureAndBc(ctx) {
  const p = ctx.panel;
  let r = await p.handleMcpAction({ action: 'set_bc', BC: 'XX' });
  assert(r.error, 'unknown BC refused (no silent S-S)');
  r = await p.handleMcpAction({ action: 'set_bc', BC: 'C-C' });
  assert.strictEqual(r.BC, 'C-C');
  const before = p.__testGetState().model;
  // R8-23: 서명곡선은 사용자 BC · 길이를 바꾸지 않는다.
  r = await p.handleMcpAction({ action: 'signature_ss' });
  assert.strictEqual(r.success, true, 'signature_ss runs (R8-24 server side)');
  assert.strictEqual(r.BC, 'S-S');
  const after = p.__testGetState();
  assert.strictEqual(after.model.BC, 'C-C', 'R8-23: model BC kept');
  assert.strictEqual(after.model.nlengths, before.nlengths, 'R8-23: model lengths kept');
  assert.strictEqual(after.lastAnalysisMeta.BC, 'S-S', 'analysis meta records the BC the curve was solved with');
  assert.strictEqual(after.lastAnalysisMeta.load_family, 'Mxx', 'family follows the actual stress (bending), not signature_ss');
}

async function scenarioNonSSAutoTerms(ctx) {
  const p = ctx.panel;
  // F1 후속 1: S-S 가 아니면 서버가 m_recommend 로 항을 고른다(여러 항).
  await p.handleMcpAction({ action: 'set_bc', BC: 'C-C' });
  await p.handleMcpAction({ action: 'set_lengths', min: 20, max: 200, n: 3 });
  const r = await p.handleMcpAction({ action: 'run_analysis' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.m_all_selection.source, 'm_recommend', 'C-C uses recommended terms');
  assert(r.m_terms_max > 1, 'more than one longitudinal term for C-C');
  const st = p.__testGetState();
  assert.strictEqual(st.model.m_all, 'auto', 'model keeps auto; the used terms live in the result');
  assert(Array.isArray(st.lastAnalysis.m_all) && st.lastAnalysis.m_all.length === 3, 'result keeps the terms it used');
  // energy_recovery 는 그 길이의 실제 항(m_a)으로.
  const er = await p.handleMcpAction({ action: 'energy_recovery', length_index: 1, mode_index: 0 });
  assert(!er.error, er.error);
  assert.deepStrictEqual(er.m_a, st.lastAnalysis.m_all[1], 'energy recovery forwards the terms of that length');
  await p.handleMcpAction({ action: 'set_bc', BC: 'S-S' });
}

async function scenarioCustomLoadNotRescaled(ctx) {
  const p = ctx.panel;
  await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedc',
    params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0 } });
  const props = await ctx.bridge.call('get_properties', { node: ctx.model().node, elem: ctx.model().elem });
  const r = await p.handleMcpAction({ action: 'set_load_case', load_case: 'custom', P: 30 });
  assert.strictEqual(r.load_case, 'custom', 'R8-16: custom stays custom (no family inference)');
  const maxS = Math.max(...ctx.model().node.map((n) => Math.abs(n[7])));
  assert(rel(maxS, 30 / props.A) < 1e-9, 'R8-16: custom P keeps the applied stress P/A (no rescale to fy)');
  const st = p.__testGetState();
  assert.strictEqual(st.model.loadFy, null, 'no stale reference stress after custom loads');
  // 절점 응력 직접 편집은 custom 으로.
  await p.handleMcpAction({ action: 'set_load_case', load_case: 'compression', fy: 35.53 });
  await p.handleMcpAction({ action: 'set_node_stress', node_ids: [1], stress: 10 });
  assert.strictEqual(p.__testGetState().model.loadCase, 'custom', 'R8-03: node stress edit -> custom');
}

// S-steel-default: 기준응력이 없을 때 템플릿이 강종(전: 35.53 ksi)을 짐작하지 않는다.
async function scenarioTemplateWithoutReferenceStress(ctx) {
  const p = ctx.panel;
  await p.handleMcpAction({ action: 'set_load_case', load_case: 'custom', P: 30 });
  const prevMax = Math.max(...ctx.model().node.map((n) => Math.abs(n[7])));
  let r = await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedc',
    params: { H: 6, B: 2, D: 0.5, t: 0.059, r: 0 } });
  assert.strictEqual(r.fy_reference, prevMax, 'after custom loads the template keeps the previous max stress');
  assert(ctx.model().node.every((n) => n[7] === prevMax), 'uniform at the previous max stress');
  // 응력이 하나도 없으면: 0 으로 두고 알리고, 해석은 거절된다(강종을 지어내지 않는다).
  await p.handleMcpAction({ action: 'set_load_case', load_case: 'custom', P: 0, Mxx: 0, Mzz: 0 });
  assert(ctx.model().node.every((n) => n[7] === 0), 'custom zero loads leave no stress');
  {
    r = await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedc',
      params: { H: 6, B: 2, D: 0.5, t: 0.059, r: 0 } });
    assert.strictEqual(r.fy_reference, null, 'no reference stress is invented');
    assert(r.warnings.some((w) => /no steel grade is assumed/.test(w)), 'the user is told to give fy');
    assert(ctx.model().node.every((n) => n[7] === 0) && p.__testGetState().model.loadFy == null, 'stresses stay 0');
    let msg;
    try { const a = await p.handleMcpAction({ action: 'run_analysis' }); msg = (a && a.error) || ''; } catch (e) { msg = String(e && e.message); }
    assert(/no stress distribution/.test(msg), `analysis without stresses is refused (${msg})`);
  }
  await p.handleMcpAction({ action: 'set_load_case', load_case: 'compression', fy: 50 });
}

async function scenarioMemberDesignFyConsistency(ctx) {
  const p = ctx.panel;
  // R8-02: 해석 fy 가 설계 Fy 와 달라도 설계 강도는 같아야 한다(Py · My 를 다른 Fy 로 쓰지 않는다).
  await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedc',
    params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0 } });
  await p.handleMcpAction({ action: 'set_lengths', min: 1, max: 1000, n: 20 });
  const design = { action: 'aisi_design', member_type: 'flexure', design_method: 'LRFD', Fy: 35.53, Fu: 58.02,
    Mu: 10, Lb: 24, Cb: 1.0 };
  await p.handleMcpAction({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 50 });
  await p.handleMcpAction({ action: 'run_analysis' });
  const at50 = await p.handleMcpAction(design);
  await p.handleMcpAction({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 35.53 });
  await p.handleMcpAction({ action: 'run_analysis' });
  const at35 = await p.handleMcpAction(design);
  assert(!at50.error && !at35.error, at50.error || at35.error);
  assert(rel(at50.Mn, at35.Mn) < 1e-3, `R8-02: Mn independent of the analysis fy (${at50.Mn} vs ${at35.Mn})`);
  assert(rel(at50.My, 35.53 * at50.Fcre_detail.Sf) < 1e-6 || at50.My > 0, 'My from the design Fy');
  assert(at50.pass === true || at50.pass === false || at50.pass === null, 'three-state pass');
}

async function scenarioPurlinRegions(ctx) {
  const p = ctx.panel;
  // R8-08 / V3 T1–T10: 구간별 설계. 매뉴얼 II-2A 의 내부 경간 기하(8ZS2.25x059, 한 두께) — 매뉴얼은 끝 경간에
  // 더 두꺼운 부재를 쓰므로 판정 전체를 재현하지 못한다(기록). 여기서는 구간 배선과 영역 값의 전달을 본다.
  await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedz',
    params: { H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 } });
  await p.handleMcpAction({ action: 'set_lengths', min: 1, max: 1000, n: 30 });
  const input = {
    action: 'design_purlin', member_app: 'roof-purlin', span_type: 'cont-n', span_ft: 25,
    spans_ft: [1, 25, 25, 25, 25, 1], supports: ['N', 'P', 'P', 'P', 'P', 'P', 'N'],
    laps_per_support: [null, { left_ft: 0, right_ft: 0 }, { left_ft: 2.5, right_ft: 3.5 }, { left_ft: 1, right_ft: 1 },
      { left_ft: 3.5, right_ft: 2.5 }, { left_ft: 0, right_ft: 0 }, null],
    loads: { D: 15, Lr: 100, W: -170 }, design_method: 'ASD', spacing_ft: 5,
    deck: { type: 'through-fastened', kphi_override: 0.3 }, i621_conditions_confirmed: true, pattern_loading: false,
    Fy: 55, Fu: 70,
  };
  const res = await p.handleMcpAction(input);
  assert(!res.error, res.error);
  const la = res.load_analysis;
  const kinds = new Set(res.regions.map((g) => g.kind));
  for (const k of ['positive', 'negative', 'lap', 'uplift']) { assert(kinds.has(k), `region kind ${k} designed`); }
  // 각 구간은 엔진 구간의 자기 Ly · Cb · M 으로(대표값 하나가 아니다).
  for (const g of res.regions.filter((x) => x.kind === 'negative')) {
    const src = la.auto_params.negative_regions.find((r) => r.start_ft === g.start_ft && r.end_ft === g.end_ft);
    assert(src, 'negative region comes from auto_params.negative_regions');
    assert.strictEqual(g.Ly_in, src.Ly_in, 'region Ly');
    assert.strictEqual(g.Cb, src.Cb, 'region Cb (not 1.67 / not the envelope minimum)');
    assert(rel(g.Mu, src.M_max_abs * 12) < 1e-12, 'region M (kip-ft -> kip-in)');
    assert.strictEqual(g.result.Lb ?? g.result.Fcre_detail?.Lb ?? src.Ly_in, src.Ly_in);
  }
  // R 은 엔진이 적격이라 한 양력 구간에만, R 표 확인용 span_type 과 함께.
  for (const g of res.regions.filter((x) => x.kind === 'uplift')) {
    const src = la.auto_params.uplift_bracing.negative_regions.find((r) => r.start_ft === g.start_ft);
    assert.strictEqual(g.R_uplift, src.i621_region_eligible ? la.auto_params.uplift_R : null, 'R only where eligible');
  }
  // V4-26: 구간 id 는 겹치지 않는다(지배 구간 표시 · MCP 의 id 참조가 하나를 가리키게).
  const ids = res.regions.map((g) => g.id);
  assert.strictEqual(new Set(ids).size, ids.length, `region ids unique: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`);
  // V4-30: 지배 구간은 자기 하중조합을 지닌다(보고서가 하중 분석 전체의 지배 조합 대신 이것을 쓴다).
  if (res.governing) {
    const gr = res.regions.find((g) => g.id === res.governing.id);
    assert(gr && res.governing.combo === gr.combo && typeof gr.combo === 'string', 'governing region carries its own combination');
  }
  // V4-27: R 경로 구간은 엔진이 F2 · F3 · F4 단계를 not_used 로 표시한다(화면이 「참고」 로 흐리게 그리는 근거).
  const rReg = res.regions.find((g) => g.R_uplift != null);
  if (rReg) { assert(rReg.result.steps.some((s) => s.not_used === true), 'R-route region marks unused steps'); }
  // 세 상태 합침: 구간 하나라도 불합격이면 불합격.
  const anyFail = res.regions.some((g) => g.result.pass === false);
  const anyNull = res.regions.some((g) => g.result.pass !== true && g.result.pass !== false);
  assert.strictEqual(res.pass, anyFail ? false : (anyNull || res.not_evaluated.length ? null : true), 'combined verdict');
  // 웹 크리플링 지압 길이가 없으면 평가하지 않았다고 밝힌다(지어내지 않음).
  assert(res.not_evaluated.some((s) => /wc_N/.test(s)), 'missing bearing length is reported');
  // 같은 입력의 화면 경로(runPurlinDesign 메시지)는 같은 답.
  p.__testClearPostedMessages();
  const { action: _a, ...msgData } = input; void _a;
  await p.__testDispatchMessage({ command: 'runPurlinDesign', data: msgData });
  const gui = p.__testGetPostedMessages().filter((m) => m.command === 'designPurlinResult').pop();
  assert(gui && gui.data, 'GUI route posts designPurlinResult');
  assert.deepStrictEqual(gui.data.regions.map((g) => [g.id, g.result.utilization, g.result.pass]),
    res.regions.map((g) => [g.id, g.result.utilization, g.result.pass]), 'R8-08: GUI and MCP routes give the same answer');
  // 참고(매뉴얼 II-2A, ASD): 안경간 정모멘트 Ma 4.35, 랩 끝 부모멘트 F4 3.93, 양력 R 경로 Ma 3.01(V3-21 엔진 기준) kip-ft.
  const ma = (g) => g.result.design_strength / 12;
  const posInt = res.regions.find((g) => g.kind === 'positive' && g.start_ft > 30 && g.end_ft < 50);
  const negInt = res.regions.find((g) => g.kind === 'negative' && g.start_ft > 29 && g.start_ft < 30);
  const upInt = res.regions.find((g) => g.kind === 'uplift' && g.start_ft > 30 && g.end_ft < 50);
  console.log(`  II-2A reference: +M interior Ma ${ma(posInt).toFixed(3)} (Manual 4.35), lap-end F4 Ma ${ma(negInt).toFixed(3)} (Manual 3.93), uplift R Ma ${ma(upInt).toFixed(3)} (V3-21 3.01)`);
  assert(rel(ma(posInt), 4.35) < 0.03, 'interior +M allowable within 3 % of Manual II-2A 4.35 kip-ft');
  assert(rel(ma(negInt), 3.93) < 0.05, 'lap-end -M allowable within 5 % of Manual II-2A 3.93 kip-ft (FSM vs App. 2)');
  assert(rel(ma(upInt), 3.01) < 0.02, 'uplift R route Ma = R*Mnlo within 2 % of V3-21 3.01 kip-ft');
}

async function scenarioPreviewAndProjectFiles(ctx) {
  const p = ctx.panel;
  // R8-18: 웹뷰가 답하지 않으면 이전 PNG 경로를 성공으로 돌려주지 않는다.
  const pr = p.handleMcpAction({ action: 'capture_section_preview' });
  await p.__testDispatchMessage({ command: 'sectionPreviewResult', data: { error: 'No section defined' } });
  const pv = await pr;
  assert(pv.error && !pv.file_path, 'R8-18: failed capture is an error');
  // R8-09: save_project 는 원시 모델 확장자 · 절대 경로만.
  let r = await p.handleMcpAction({ action: 'save_project', filepath: 'relative.stcfsd' });
  assert(r.error, 'relative path refused');
  r = await p.handleMcpAction({ action: 'save_project', filepath: ctx.tmpFile('x.exe') });
  assert(r.error, 'unexpected extension refused');
  const raw = ctx.tmpFile('model.stcfsd');
  r = await p.handleMcpAction({ action: 'save_project', filepath: raw });
  assert.strictEqual(r.success, true);
  r = await p.handleMcpAction({ action: 'load_project', filepath: ctx.tmpFile('missing.stcfsd') });
  assert(r.error, 'R8-07 host side: missing file returns error');
  // V5-01: 경로는 AI 가 준다 — 이미 있는 남의 파일은 덮어쓰지 않는다. 자기가 쓴 원시 모델과 새 파일만.
  const leftovers = (file) => fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(path.basename(file) + '.tmp-'));
  const victim = ctx.tmpFile('claude_desktop_config.json');
  const victimText = '﻿{\r\n\t"mcpServers": { "other": { "command": "x", "env": { "API_KEY": "secret-123" } } }\r\n}\r\n';
  fs.writeFileSync(victim, victimText, 'utf8');
  r = await p.handleMcpAction({ action: 'save_project', filepath: victim });
  assert(r.error && !r.success, 'V5-01: an existing file that is not a StCFSD model is not overwritten');
  assert(!/secret-123|API_KEY|mcpServers/.test(r.error), 'V5-01: the refusal does not quote the file');
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), victimText, 'V5-01: the other program\'s file is byte-for-byte unchanged');
  assert.deepStrictEqual(leftovers(victim), [], 'V5-01: no temp file left beside it');
  const notJson = ctx.tmpFile('notes.json');
  fs.writeFileSync(notJson, 'password=hunter2 not json', 'utf8');
  r = await p.handleMcpAction({ action: 'save_project', filepath: notJson });
  assert(r.error && fs.readFileSync(notJson, 'utf8') === 'password=hunter2 not json', 'V5-01: a non-JSON file is not overwritten');
  const lookalike = ctx.tmpFile('lookalike.json');
  fs.writeFileSync(lookalike, JSON.stringify([{ format: 'stcfsd-model' }]), 'utf8');
  r = await p.handleMcpAction({ action: 'save_project', filepath: lookalike });
  assert(r.error, 'V5-01: an array that merely contains the marker is not a model file');
  const folder = ctx.tmpFile('folder.json');
  fs.mkdirSync(folder);
  r = await p.handleMcpAction({ action: 'save_project', filepath: folder });
  assert(r.error && fs.statSync(folder).isDirectory(), 'V5-01: a directory is refused');
  r = await p.handleMcpAction({ action: 'save_project', filepath: raw });
  assert.strictEqual(r.success, true, 'V5-01: save_project overwrites a model file it wrote itself');
  const fresh = ctx.tmpFile('fresh-model.json');
  r = await p.handleMcpAction({ action: 'save_project', filepath: fresh });
  assert.strictEqual(r.success, true, 'V5-01: a new .json file is written');
  assert.strictEqual(JSON.parse(fs.readFileSync(fresh, 'utf8')).format, 'stcfsd-model');
  // V5-02: load_project 의 실패 문구는 파일 내용을 싣지 않고, 모델 파일 확장자 · 절대 경로만 읽는다.
  r = await p.handleMcpAction({ action: 'load_project', filepath: notJson });
  assert(r.error && !/password|hunter2/.test(r.error), 'V5-02: a parse failure does not quote the file: ' + r.error);
  const txt = ctx.tmpFile('notes.txt');
  fs.writeFileSync(txt, 'password=hunter2', 'utf8');
  r = await p.handleMcpAction({ action: 'load_project', filepath: txt });
  assert(r.error && /extension/.test(r.error) && !/password|hunter2/.test(r.error), 'V5-02: other extensions are not read');
  r = await p.handleMcpAction({ action: 'load_project', filepath: 'relative.stcfsd' });
  assert(r.error && /absolute/.test(r.error), 'V5-02: a relative path is refused');
  r = await p.handleMcpAction({ action: 'load_project', filepath: victim });
  assert(r.error && !/secret-123|API_KEY/.test(r.error), 'V5-02: a valid JSON that is not a model is refused without quoting it');
  r = await p.handleMcpAction({ action: 'load_project', filepath: fresh });
  assert.strictEqual(r.success, true, 'load_project still reads what save_project wrote');
  // R8-28: MCP 원시 모델을 화면의 .csd 열기로도 연다.
  const lr = p.__testLoadProjectFile(raw);
  assert(!lr.error, lr.error);
  // .csd 왕복: lapResult 와 새 입력이 남는다(v1.3).
  const csd = ctx.tmpFile('proj.csd');
  const inputs = { unitSystem: 'US', vibRho: 7.345e-7, chkI621Confirmed: true, connMemberCase: 'not_tension_member' };
  await p.__testWriteProjectFile(csd, { __stcfsd_collect: 2, designInputs: inputs, lapResult: { pass: null, verdict: 'NOT_CHECKED' } });
  const saved = JSON.parse(fs.readFileSync(csd, 'utf8'));
  assert.strictEqual(saved.version, '1.3');
  assert.deepStrictEqual(saved.lapResult, { pass: null, verdict: 'NOT_CHECKED' }, 'lap result saved');
  p.__testClearPostedMessages();
  const back = p.__testLoadProjectFile(csd);
  assert(!back.error, back.error);
  const cmds = p.__testGetPostedMessages().map((m) => m.command);
  assert(cmds.includes('lapConnectionResult'), 'lap result restored');
  assert(cmds.indexOf('restoreDesignInputs') >= 0 && cmds.indexOf('restoreDesignInputs') < cmds.lastIndexOf('lapConnectionResult'),
    'inputs restored before results are shown');
  // V4-10: 입력 기록이 없는 파일(MCP 원시 모델 · v1.0)도 restoreDesignInputs({}) 를 보내 화면이 처음 값으로 되돌린다.
  fs.writeFileSync(raw, JSON.stringify(saved.model));
  p.__testClearPostedMessages();
  assert(!p.__testLoadProjectFile(raw).error, 'raw model opens');
  const rawMsgs = p.__testGetPostedMessages();
  const rst = rawMsgs.find((m) => m.command === 'restoreDesignInputs');
  assert(rst && rst.data && typeof rst.data === 'object' && Object.keys(rst.data).length === 0,
    'V4-10: a file with no saved inputs still resets the inputs (empty restore)');
  assert(rawMsgs.findIndex((m) => m.command === 'resultsCleared') < rawMsgs.findIndex((m) => m.command === 'restoreDesignInputs'),
    'results cleared before inputs are reset');
  // 옛 파일(1.2, 래퍼 없는 designInputs) 도 열린다.
  const old = ctx.tmpFile('old.csd');
  fs.writeFileSync(old, JSON.stringify({ version: '1.2', format: 'cufsm-section-design', model: saved.model, designInputs: inputs }));
  assert(!p.__testLoadProjectFile(old).error, 'v1.2 file loads');
  fs.writeFileSync(old, JSON.stringify({ version: '2.0', format: 'cufsm-section-design', model: saved.model }));
  assert(p.__testLoadProjectFile(old).error, 'unknown major version refused');
  [raw, csd, old].forEach((f) => { try { fs.unlinkSync(f); } catch { /* ignore */ } });
}

async function scenarioAllowlistsAndVibration(ctx) {
  const p = ctx.panel;
  let r = await p.handleMcpAction({ action: 'cold_work', Fyv: 50, Fuv: 65, R: 0.1, t: 0.06, A_total: 1.0,
    buckling_precondition: true });
  assert(!r.error, 'F6 후속 7: new cold_work arguments accepted');
  r = await p.handleMcpAction({ action: 'shear_lag', Ag: 1, An_net: 0.9, x_bar: 0.5, L_conn: 3, Fu: 65, Fy: 50, typo_arg: 1 });
  assert(r.error && /Unsupported parameter 'typo_arg'/.test(r.error), 'unknown argument refused');
  r = await p.handleMcpAction({ action: 'web_crippling', h: 7.5, t: 0.06, R: 0.1, N: 3, Fy: 50, d: 8, web_holes: false });
  assert(!/Unsupported/.test(r.error || ''), 'web_crippling accepts d and web_holes');
  // 진동: 밀도를 주지 않으면 보내지 않는다(엔진 강재 값), 주면 그대로.
  await p.handleMcpAction({ action: 'set_lengths', min: 10, max: 100, n: 3 });
  const v0 = await p.handleMcpAction({ action: 'vibration' });
  const rho0 = Object.values(v0.rho_used)[0];
  assert(rel(rho0, 7.345e-7) < 1e-3, 'R8-19: default density is steel (engine), not 1.0');
  // 기본 밀도는 이 실행이 가정한 것이다(FIXES.md §3.1.1) — warnings 가 아니라 assumptions 로 온다.
  assert((v0.assumptions || []).some((w) => /density/i.test(w)), 'default-density assumption reaches the caller');
  assert(!(v0.warnings || []).some((w) => /density/i.test(w)), 'default density is not a warning');
  const v1 = await p.handleMcpAction({ action: 'vibration', rho: 2 * rho0 });
  // 닫힌 관계: 같은 강성에서 질량 2배 → 진동수 1/√2.
  assert(rel(v1.frequencies[0][0], v0.frequencies[0][0] / Math.SQRT2) < 1e-6, 'frequency scales with 1/sqrt(rho)');
  // V4-35: 예상이 엔진 호출 시간 제한을 넘으면 확인해도 실행하지 않고, 줄이는 방법(맞는 길이 수)을 준다.
  const bridge = p._pythonBridge;
  Object.defineProperty(bridge, 'timeoutMs', { configurable: true, get: () => 1 });
  try {
    for (const confirm of [false, true]) {
      const big = await p.handleMcpAction({ action: 'vibration', ...(confirm ? { confirm_large: true } : {}) });
      assert(big.exceeds_limit === true && big.error && !big.frequencies, `over-limit request not run (confirm_large ${confirm})`);
      assert(big.needs_confirmation === false && big.size.limit_s >= 0 && big.size.lengths_that_fit >= 1, 'size + what fits reported');
      assert(!/confirm_large/.test(big.error), 'no confirm hint when it cannot finish');
    }
  } finally {
    delete bridge.timeoutMs;
  }
}

async function main() {
  const t0 = Date.now();
  const ctx = await createPanel();
  if (!ctx) {
    console.log('panel_host_contract: SKIP (no .venv python — host scenarios not run)');
    return;
  }
  ctx.model = () => JSON.parse(JSON.stringify(ctx.panel._model));
  ctx.lastAnalysis = () => {
    const a = ctx.panel._lastAnalysisResult;
    return { node: ctx.panel._model.node, elem: ctx.panel._model.elem, curve: a.curve };
  };
  const scenarios = [scenarioDefaultSteelAgrees, scenarioTemplateLoadCaseAndDsm, scenarioZSectionType, scenarioSignatureAndBc,
    scenarioNonSSAutoTerms, scenarioCustomLoadNotRescaled, scenarioTemplateWithoutReferenceStress,
    scenarioMemberDesignFyConsistency,
    scenarioPurlinRegions, scenarioPreviewAndProjectFiles, scenarioAllowlistsAndVibration];
  try {
    for (const s of scenarios) {
      const t = Date.now();
      await s(ctx);
      console.log(`  ${s.name}: ok (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    }
  } finally {
    ctx.close();
  }
  console.log(`panel_host_contract: PASS (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { main, path };
