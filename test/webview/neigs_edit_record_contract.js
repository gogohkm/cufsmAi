/* global process */
// B4(2026-11-25) — 편집 상태(F2)에서 끼운 화면이 바꾼 고유치 수(10 → 12)가 변경 기록에 남는다(2026-11-24 의 보고).
// 화면은 고유치 수를 「해석 실행」 의 runAnalysis {neigs, …} 로만 보낸다(칸 input-neigs 는 모델 키 analysisNeigs — caseEdit 의 초안).
// 진짜 패널 · 진짜 파이썬, 프로젝트 밖(이 세션의 기록 — list_changes persisted: false 와 같은 줄).
//   node test/webview/neigs_edit_record_contract.js
'use strict';
const assert = require('assert');
const path = require('path');
const { createPanel } = require('./panel_harness');

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('neigs_edit_record_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const personScope = ctx.load(path.join('src', 'mcp', 'actorScope.ts'));
  const session = (st) => personScope.runAs({ kind: 'person' }, () => p.editSession(st));
  try {
    await p.__testDispatchMessage({ command: 'caseHello', data: { inputs: null, drafts: { templateType: 'lippedc' } } });
    const before = p._model.neigs;
    assert.strictEqual(before, 10, 'the initial model has 10 eigenvalues');
    const n0 = p._memChanges.length;
    assert(session('start').ok, 'edit session started (person path)');
    // 화면의 「해석 실행」: 칸의 값으로 모델을 고쳐 보낸다(app.js btn-run-analysis — prop · lengths · BC · neigs …)
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: p.__testGetCase().state.rev, changes: {}, drafts: { analysisNeigs: 12 } } });
    await p.__testDispatchMessage({ command: 'runAnalysis', data: { neigs: 12, BC: p._model.BC, lengths: p._model.lengths, m_all: 'auto' } });
    assert.strictEqual(p._model.neigs, 12, 'the model took the page value');
    session('end');
    const lines = p._memChanges.slice(n0);
    const withNeigs = lines.filter((l) => (l.body.fields || []).some((f) => f.path === 'model.neigs'));
    assert.strictEqual(withNeigs.length, 1, 'one change line carries model.neigs: ' + JSON.stringify(lines.map((l) => [l.actor && l.actor.kind, (l.body.fields || []).map((f) => f.path)])));
    const f = withNeigs[0].body.fields.find((x) => x.path === 'model.neigs');
    assert(f.from === 10 && f.to === 12, 'from 10 to 12: ' + JSON.stringify(f));
    assert.strictEqual(withNeigs[0].actor.kind, 'person', 'made by the person');
    const lc = await p.handleMcpAction({ action: 'list_changes', limit: 20 });
    assert(lc.changes.some((c) => /고유치/.test(c.title) || /neigs/.test(c.title)), 'list_changes shows it: ' + JSON.stringify(lc.changes.map((c) => c.title)));
    console.log(`neigs_edit_record_contract: PASS — 「${lc.changes.find((c) => /고유치|neigs/.test(c.title)).title}」`);
  } finally { ctx.close(); }
}

main().then(() => process.exit(0)).catch((e) => { console.error('neigs_edit_record_contract: FAIL', e); process.exit(1); });
