/* global process */
// 다시 실은 화면은 편집이 아니다 — 진짜 StcfsdPanel + 진짜 파이썬, 화면 없이(화면이 보낼 메시지를 그대로 다시 보낸다).
//   node test/webview/reload_replay_contract.js
// 데스크톱 작성자의 u50 · u5c 순서: MCP aisi_design_flexure(웹 크리플링 칸을 비움 — 「AI: 주지 않음」) → validate_design → 화면을 다시 실음
// (두 번째 caseHello · 다시 보내기 · 다시 보낸 loadAnalysisComplete 가 부르는 채우기 · 상태를 그리며 낸 연동 메아리).
// 그 뒤 판 · 출처 · 값 · 무효 장부 · results.validation 이 그대로여야 한다. 그리고 새 하중 해석의 채우기 · 사람의 변경은 그대로 받는다.
'use strict';
const assert = require('assert');
const { createPanel } = require('./panel_harness');

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('reload_replay_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const notes = [];
  const snap = async () => {
    const c = p.__testGetCase();
    const st = p.getStatus();
    return { rev: c.state.rev, inputs: JSON.stringify(c.state.inputs), sources: JSON.stringify(c.state.sources), spans: JSON.stringify(c.state.spans),
      ledger: JSON.stringify(st.invalidated || []), validation: !!(st.results && st.results.validation) };
  };
  try {
    await p.__testDispatchMessage({ command: 'caseHello', data: { inputs: null, drafts: { templateType: 'lippedc' } } });
    await p.__testDispatchMessage({ command: 'webviewReady' });
    await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedz', params: { H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 } });
    await p.handleMcpAction({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 55 });
    await p.handleMcpAction({ action: 'run_analysis' });
    // 새 하중 해석 — 그 채우기는 받는다(사람이 하중 탭에서 돌린 것과 같은 길)
    const la = await p.handleMcpAction({ action: 'analyze_loads', member_app: 'roof-purlin', span_type: 'cont-3', span_ft: 25, loads: { D: 15, Lr: 100, W: -170 }, design_method: 'ASD', Fy: 55, Fu: 70 });
    assert(!la.error, la.error);
    let r0 = p.__testGetCase().state.rev;
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'load-analysis', seenRev: r0, changes: { wcSupport: 'IOF', Lb: 61 } } });
    assert.deepStrictEqual([p.__testGetCase().state.inputs.wcSupport, p.__testGetCase().state.sources.wcSupport], ['IOF', 'load-analysis'], 'the fill of a new load analysis is taken');
    // AI 의 묶음 쓰기: 웹 크리플링 칸을 비운다(「AI: 주지 않음」)
    const d = await p.handleMcpAction({ action: 'aisi_design', member_type: 'flexure', design_method: 'LRFD', Fy: 55, Fu: 70, Lb: 60, Cb: 1, Mu: 40, Vu: 1 });
    assert(!d.error, d.error);
    assert.deepStrictEqual([p.__testGetCase().state.inputs.wcSupport, p.__testGetCase().state.sources.wcSupport], [null, 'ai']);
    const v = await p.handleMcpAction({ action: 'validate_design' });
    assert(v && v.counts, 'validated');
    const before = await snap();
    assert(before.validation, 'results.validation is there before the reload');

    // ── 다시 실음 ─────────────────────────────────────────────────────
    await p.__testDispatchMessage({ command: 'caseHello', data: { inputs: null, drafts: { templateType: 'lippedz' } } });
    await p.__testDispatchMessage({ command: 'webviewReady' });
    const seen = p.__testGetCase().state.rev;
    // 다시 보낸 loadAnalysisComplete 가 부른 채우기(그 해석의 값 그대로) · 상태를 그리며 낸 연동 메아리 · 단위 칸 메아리 없이
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'load-analysis', seenRev: seen, changes: { wcSupport: 'IOF', Lb: 61, Cb: 1.3 } } });
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'mirror', seenRev: seen, changes: { wcSupport: 'IOF' } } });
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'mirror', changes: { wcSupport: 'EOF', wcFastened: 'fastened' } } });
    const after = await snap();
    for (const k of ['rev', 'inputs', 'sources', 'spans', 'ledger', 'validation']) { assert.deepStrictEqual(after[k], before[k], `the reload changed ${k}`); }
    notes.push(`reload after an AI group write: rev ${after.rev}, sources, values, ledger and results.validation unchanged`);

    // ── 사람의 변경은 받고, 그 뒤의 연동도 받는다 ──────────────────────────
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: p.__testGetCase().state.rev, changes: { Lb: 72 } } });
    assert.strictEqual(p.__testGetCase().state.inputs.Lb, 72, 'a person edit after the reload is taken');
    assert(!(await snap()).validation, 'and it makes the validation stale (as before)');
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'mirror', seenRev: p.__testGetCase().state.rev, changes: { connFy: 40 } } });
    assert.strictEqual(p.__testGetCase().state.inputs.connFy, 40, 'after the person edit the mirror counts again');
    // ── 새 하중 해석 뒤의 채우기는 다시 받는다 ────────────────────────────
    await p.__testDispatchMessage({ command: 'caseHello', data: { inputs: null, drafts: { templateType: 'lippedz' } } });
    await p.handleMcpAction({ action: 'analyze_loads', member_app: 'roof-purlin', span_type: 'cont-3', span_ft: 25, loads: { D: 15, Lr: 90, W: -170 }, design_method: 'ASD', Fy: 55, Fu: 70 });
    r0 = p.__testGetCase().state.rev;
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'load-analysis', seenRev: r0, changes: { wcSupport: 'ITF' } } });
    assert.strictEqual(p.__testGetCase().state.inputs.wcSupport, 'ITF', 'the fill of a new load analysis after a reload is taken');
    notes.push('person edits, mirrors after them and fills of a new load analysis still count');
    console.log(`reload_replay_contract: PASS (${notes.join('; ')})`);
  } finally {
    ctx.close();
  }
}

main().catch((e) => { console.error('reload_replay_contract: FAIL', e); process.exitCode = 1; });
