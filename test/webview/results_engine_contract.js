/* global process */
// K3(오케스트레이터 덧붙임) — 저장한 결과는 그것을 만든 엔진의 것이다: .csd 의 resultsEngine.engine_id(엔진 소스의 sha256)가
// 지금 엔진과 같을 때만 결과를 되살린다. 기록이 없는 파일(지금까지 저장한 것)은 다른 엔진 — 입력은 남기고 결과는 버리며 알린다.
// 'unknown' 은 어느 쪽이든 되살리지 않는다. 진짜 호스트(StcfsdPanel) + 진짜 파이썬, 화면 없이.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPanel } = require('./panel_harness');

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('results_engine_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const base = path.join(__dirname, '..', 'rendered', 'out', 'k3');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'engine-'));
  try {
    const st = p._pythonBridge.selftest || {};
    assert(typeof st.engine_id === 'string' && /^(sha256:)?[0-9a-f]{16,}$/.test(st.engine_id), `the engine reports engine_id (${st.engine_id})`);
    // 결과 하나: 압축 해석 → 설계
    await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 } });
    await p.handleMcpAction({ action: 'set_load_case', load_case: 'compression', fy: 50 });
    await p.handleMcpAction({ action: 'run_analysis' });
    const d = await p.handleMcpAction({ action: 'aisi_design', member_type: 'compression', design_method: 'LRFD', Fy: 50, Fu: 65, KxLx: 96, KyLy: 48, KtLt: 48, Pu: 4 });
    assert(!d.error, d.error);
    const f = path.join(dir, 'same.csd');
    await p.__testWriteProjectFile(f);
    const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.strictEqual(saved.resultsEngine.engine_id, st.engine_id, 'save records the running engine');
    assert(saved.designResult && saved.analysisResult, 'the file has results');

    const open = (file) => { const r = p.__testLoadProjectFile(file); return { r, design: !!p._lastDesignResult, analysis: !!p._lastAnalysisResult }; };
    // 같은 엔진 → 결과가 돌아온다
    let o = open(f);
    assert(!o.r.error && o.design && o.analysis, `same engine restores results (${JSON.stringify(o.r)})`);
    assert(!o.r.warnings.some((w) => /were not restored/.test(w)), 'no notice for the same engine');

    const variant = (name, mutate) => {
      const j = JSON.parse(JSON.stringify(saved));
      mutate(j);
      const g = path.join(dir, name);
      fs.writeFileSync(g, JSON.stringify(j));
      return g;
    };
    // 다른 엔진(고친 id) · 기록 없음(옛 파일) · unknown(파일 쪽) → 입력은 남고 결과는 없다, 알림
    for (const [name, mutate] of [
      ['other.csd', (j) => { j.resultsEngine.engine_id = 'sha256:' + '0'.repeat(64); }],
      ['missing.csd', (j) => { delete j.resultsEngine.engine_id; }],
      ['unknown.csd', (j) => { j.resultsEngine.engine_id = 'unknown'; }],
    ]) {
      o = open(variant(name, mutate));
      assert(!o.r.error, o.r.error);
      assert(!o.design && !o.analysis, `${name}: results dropped`);
      assert(o.r.warnings.some((w) => /were not restored\.\s*Inputs were kept|were not restored — inputs were kept/i.test(w)), `${name}: notice says why (${o.r.warnings.join(' | ')})`);
      assert.strictEqual(p.__testGetCase().state.inputs.KxLx, saved.case.inputs.KxLx, `${name}: inputs kept`);
    }
    // 지금 엔진이 unknown 이면 같은 파일도 되살리지 않는다
    const real = p._pythonBridge._selftest;
    p._pythonBridge._selftest = { ...real, engine_id: 'unknown' };
    o = open(f);
    p._pythonBridge._selftest = real;
    assert(!o.design && !o.analysis, 'a running engine with unknown id never restores');
    console.log('results_engine_contract: PASS (same engine restores; other / missing / unknown engine_id keep inputs and drop results with the notice)');
  } finally {
    ctx.close();
  }
}

main().catch((e) => { console.error('results_engine_contract: FAIL', e); process.exitCode = 1; });
