/* global process */
// V7-01 — .csd 의 결과는 셋이 모두 맞을 때만 「지금 결과」 로 되살린다: 같은 엔진, 파일 자신의 모델 · 입력으로 지금 만든 요청과
// 결과의 지문이 봉인과 같음, 봉인이 이 PC 의 기록자 열쇠로 서명됨. 하나라도 어긋나면 입력만 남기고 결과는 모두 버리며 까닭을 알린다.
// 진짜 호스트(StcfsdPanel) + 진짜 파이썬, 화면 없이. 열쇠 폴더는 이 시험의 출력 폴더(진짜 폴더는 쓰지 않는다 — 아래에서 확인).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPanel } = require('./panel_harness');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'test', 'rendered', 'out', 'results_seal');

async function main() {
  // 소스에 기록 갈래의 기본 열쇠 폴더(defaultKeyDir — 사용자의 진짜 자료 폴더)를 부르는 곳이 없다
  for (const f of ['src/webview/StcfsdPanel.ts', 'src/case/resultSeal.ts', 'src/extension.ts']) {
    assert(!/defaultKeyDir/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} never uses the real default key folder`);
  }
  const ctx = await createPanel();
  if (!ctx) { console.log('results_seal: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const { StcfsdPanel } = Object.getPrototypeOf(p).constructor === undefined ? {} : { StcfsdPanel: p.constructor };
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const KEY = path.join(OUT, 'key-this-pc'), OTHER = path.join(OUT, 'key-other-pc');
  StcfsdPanel.writerKeyDir = KEY;
  assert(path.resolve(StcfsdPanel.writerKeyDir).startsWith(path.resolve(OUT)), 'the key folder of this test is inside its output folder');
  const lines = [];
  try {
    // 실패하는 보(검증자의 예): Fy 50 에서 소요가 강도를 넘는다
    await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 } });
    await p.handleMcpAction({ action: 'set_load_case', load_case: 'compression', fy: 50 });
    await p.handleMcpAction({ action: 'run_analysis' });
    const d = await p.handleMcpAction({ action: 'aisi_design', member_type: 'compression', design_method: 'LRFD', Fy: 50, Fu: 65, KxLx: 96, KyLy: 48, KtLt: 48, Pu: 40 });
    assert(!d.error && d.pass === false, `the beam fails at Fy 50 (${d.error || d.pass})`);
    const honest = path.join(OUT, 'honest.csd');
    const w = await p.__testWriteProjectFile(honest);
    assert(!w.seal_note, 'saved with a seal');
    const saved = JSON.parse(fs.readFileSync(honest, 'utf8'));
    assert(saved.resultsSeal && saved.resultsSeal.sig && saved.resultsSeal.writer, 'the file carries the results seal');
    const kinds = Object.keys(saved.resultsSeal.results);
    assert(['analysisResult', 'designResult'].every((k) => kinds.includes(k)), `sealed kinds ${kinds}`);

    const state = () => ({ design: !!p._lastDesignResult, analysis: !!p._lastAnalysisResult, load: !!p._lastLoadAnalysis, lap: !!p._lastLap,
      dsm: !!p._preparedDesignDsm });
    const open = (file) => { const r = p.__testLoadProjectFile(file); return { r, s: state() }; };
    const notice = (o) => o.r.warnings.join(' | ');
    // 정직한 저장 → 이 PC 에서 다시 열면 모두 돌아온다
    let o = open(honest);
    assert(!o.r.error && o.s.design && o.s.analysis, `an honest save reopens with its results (${notice(o)})`);
    assert(!/not restored|dropped/.test(notice(o)), 'no notice for an honest file');
    lines.push(`honest save → reopen restores ${kinds.length} result kinds`);

    const variant = (name, mutate, from = saved) => {
      const j = JSON.parse(JSON.stringify(from)); mutate(j);
      const g = path.join(OUT, name); fs.writeFileSync(g, JSON.stringify(j, null, 2)); return g;
    };
    const dropped = (name, file, re) => {
      const x = open(file);
      assert(!x.r.error, `${name}: ${x.r.error}`);
      assert(!x.s.design && !x.s.analysis && !x.s.load && !x.s.lap && !x.s.dsm, `${name}: every result dropped (${JSON.stringify(x.s)})`);
      assert(re.test(notice(x)), `${name}: the notice says why — ${notice(x).slice(0, 300)}`);
      assert(/run_case_check/.test(notice(x)), `${name}: the notice says how to recompute`);
      return x;
    };
    // 검증자의 조작: 실패한 보를 「합격」 으로, 입력 Fy 를 33 으로
    dropped('verifier probe (pass + Fy 33)', variant('probe.csd', (j) => {
      j.designResult.pass = true; j.designResult.utilization = 0.5;
      if (j.case && j.case.inputs) { j.case.inputs.fy = 33; }
      if (j.designInputs) { j.designInputs.designFy = 33; }
    }), /do not match the model and inputs/);
    assert.strictEqual(Number(p.__testGetCase().state.inputs.fy).toFixed(0), '33', 'the edited inputs are kept (as inputs only)');
    // 결과 종류마다 하나씩 조작
    for (const k of kinds) {
      dropped(`forged ${k}`, variant(`forged-${k}.csd`, (j) => {
        const s = JSON.stringify(j[k]); const t = s.replace(/(\d)\.(\d)/, (m, a, b) => `${a}.${(Number(b) + 1) % 10}`);
        j[k] = JSON.parse(t === s ? s.replace(/"([a-z_]+)":/, '"$1_x":') : t);
      }), /do not match the model and inputs/);
    }
    // 봉인에 없는 결과를 끼워 넣음(랩 · 하중)
    dropped('injected lapResult', variant('inject-lap.csd', (j) => { j.lapResult = { pass: true, utilization: 0.1 }; }), /do not match/);
    dropped('injected loadAnalysis', variant('inject-load.csd', (j) => { j.loadAnalysis = { governing: { locations: [] } }; }), /do not match/);
    // 서명 없는 파일에 engine_id 를 베껴 넣음
    dropped('copied engine_id, no seal', variant('copied-id.csd', (j) => { delete j.resultsSeal; }), /not computed by this program on this PC/);
    // 다른 PC(다른 열쇠)의 서명
    StcfsdPanel.writerKeyDir = OTHER;
    const otherFile = path.join(OUT, 'other-pc.csd');
    await p.__testWriteProjectFile(otherFile);
    StcfsdPanel.writerKeyDir = KEY;
    dropped('signed by another key', otherFile, /not computed by this program on this PC/);
    // 봉인을 다른 입력의 파일로 옮김
    dropped('seal moved to other inputs', variant('moved.csd', (j) => { if (j.case && j.case.inputs) { j.case.inputs.KxLx = 120; } j.designInputs = null; }), /do not match the model and inputs/);
    // 열쇠를 쓸 수 없다(빈 열쇠 파일) → 저장은 봉인 없이, 알림. 다시 열면 결과는 버린다
    const BROKEN = path.join(OUT, 'key-broken');
    fs.mkdirSync(BROKEN, { recursive: true });
    fs.writeFileSync(path.join(BROKEN, 'writer.key'), '');
    StcfsdPanel.writerKeyDir = BROKEN;
    o = open(honest);
    const un = path.join(OUT, 'unsigned.csd');
    const w2 = await p.__testWriteProjectFile(un);
    assert(w2.seal_note && /saved unsigned/.test(w2.seal_note) && /empty or incomplete/.test(w2.seal_note), `an unusable key saves unsigned with a notice (${w2.seal_note})`);
    assert(!JSON.parse(fs.readFileSync(un, 'utf8')).resultsSeal, 'no seal written');
    StcfsdPanel.writerKeyDir = KEY;
    dropped('saved unsigned', un, /not computed by this program on this PC/);
    // 열쇠 폴더가 없음(설정 안 함) → 봉인 없이
    StcfsdPanel.writerKeyDir = null;
    o = open(honest);
    dropped('no key folder on this PC', honest, /not computed by this program on this PC/);
    StcfsdPanel.writerKeyDir = KEY;
    // V8-03(검증자의 p1b_seal_gap): 템플릿이 없는 모델의 sectionType · cornerRadius 는 엔진 요청(section.type · R_corner)에 닿는다 —
    // 저장 뒤 그 두 칸을 고친 파일은 결과를 「지금 것」 으로 되살리지 않는다(봉인의 모델 지문 = 저장한 모델 전부)
    {
      const raw = path.join(OUT, 'raw-model.json');
      await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedz', params: { H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 } });
      await p.handleMcpAction({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 55 });
      const sv = await p.handleMcpAction({ action: 'save_project', filepath: raw });
      assert(sv && sv.success, JSON.stringify(sv));
      const m = JSON.parse(fs.readFileSync(raw, 'utf8'));
      const model = m.model || m;
      delete model.sectionTemplate; delete model.sectionParams; delete model.elementRoles; delete model.sectionEdited;
      model.sectionType = 'Z'; model.cornerRadius = 0.1875;
      fs.writeFileSync(raw, JSON.stringify(m));
      assert(!p.__testLoadProjectFile(raw).error);
      assert.strictEqual(p._model.sectionTemplate, undefined, 'a model without a template');
      await p.handleMcpAction({ action: 'run_analysis' });
      const dz = await p.handleMcpAction({ action: 'aisi_design', member_type: 'flexure', design_method: 'LRFD', Fy: 55, Fu: 70, Lb: 0, Cb: 1, Mu: 60, Vu: 1,
        wc_N: 3.5, wc_P: 2.5, wc_R: 0.1875, wc_support: 'IOF', wc_fastened: 'fastened' });
      assert(!dz.error, dz.error);
      const zf = path.join(OUT, 'raw-Z.csd');
      await p.__testWriteProjectFile(zf);
      const zs = JSON.parse(fs.readFileSync(zf, 'utf8'));
      o = open(zf);
      assert(o.s.design, `the honest template-less file reopens with its result (${notice(o)})`);
      for (const [name, mut] of [['cornerRadius 0.6', (j) => { j.model.cornerRadius = 0.6; }], ['sectionType C', (j) => { j.model.sectionType = 'C'; }],
        ['both (verifier)', (j) => { j.model.cornerRadius = 0.6; j.model.sectionType = 'C'; }], ['elementRoles added', (j) => { j.model.elementRoles = { 1: 'web' }; }]]) {
        dropped(`V8-03 ${name}`, variant(`raw-Z-${name.replace(/\W/g, '')}.csd`, mut, zs), /do not match the model and inputs/);
      }
      lines.push('V8-03: a template-less model edited in sectionType / cornerRadius / elementRoles drops its results');
    }
    // AI 가 연 .csd(load_project): 결과는 되살리지 않고 응답이 그렇다고 · 다시 계산하는 한 번을 말한다
    const lp = await p.handleMcpAction({ action: 'load_project', filepath: honest });
    assert(lp.success && (lp.warnings || []).some((x) => /not restored/.test(x) && /run_case_check/.test(x)) && !p._lastDesignResult && !p._lastAnalysisResult,
      `load_project opens inputs only and says so (${JSON.stringify(lp).slice(0, 300)})`);
    lines.push(`dropped: verifier probe, ${kinds.length} forged kinds, 2 injected kinds, copied engine_id, other key, moved seal, unusable key, no key folder`);
  } finally { ctx.close(); }
  console.log(`results_seal: PASS (${lines.join('; ')})`);
}
main().catch((e) => { console.error('results_seal: FAIL', e && e.message ? e.message : e); process.exitCode = 1; });
