/* global process */
// V7-04 · V7-05 — AI 의 load_project: 열기는 하나, 규칙도 하나(화면의 열기와 같게 — 입력 기록이 없는 파일은 모든 입력을 처음 값으로,
// 저장 기준은 정직하게). 저장 안 한 변경을 덮으면 버린 값(키 · 값 · 출처, 정해진 크기, 요청하면 SI)을 응답과 caseDiscarded 에 싣고,
// set_case_inputs 한 번(restore.arguments)으로 되돌릴 수 있다. 검증자의 시나리오 A5(원시 모델) · A6(1.0 .csd).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPanel } = require('./panel_harness');

const OUT = path.join(__dirname, '..', 'rendered', 'out', 'load_project');

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('load_project_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const lines = [];
  const caseOf = () => p.__testGetCase().state;
  const DEFAULT_LB = caseOf().inputs.Lb;
  try {
    await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 } });
    const raw = path.join(OUT, 'raw.json');
    const sv = await p.handleMcpAction({ action: 'save_project', filepath: raw });
    assert(sv.success, JSON.stringify(sv));
    const v10 = path.join(OUT, 'old10.csd');
    fs.writeFileSync(v10, JSON.stringify({ version: '1.0', format: 'cufsm-section-design', model: JSON.parse(fs.readFileSync(raw, 'utf8')) }));

    for (const [name, file, LB] of [['A5 raw model', raw, 33.3], ['A6 1.0 .csd', v10, 66.6]]) {
      // 사람이 Lb LB · Cb 1.2 를 쳤다(저장 안 함)
      await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { Lb: LB, Cb: 1.2 } } });
      assert.strictEqual(caseOf().inputs.Lb, LB);
      const r = await p.handleMcpAction({ action: 'load_project', filepath: file });
      assert(r.success, JSON.stringify(r));
      // V7-04: 입력은 처음 값(화면의 열기와 같다), 저장 기준은 열린 파일
      assert.strictEqual(caseOf().inputs.Lb, DEFAULT_LB, `${name}: the previous case's Lb is not kept (${caseOf().inputs.Lb})`);
      assert.strictEqual(caseOf().sources.Lb, 'default', `${name}: Lb is the initial value`);
      const u = await p.handleMcpAction({ action: 'get_unsaved_changes' });
      assert.strictEqual(u.dirty, false, `${name}: the opened file is the saved state`);
      assert(r.warnings.some((w) => /reset to its initial value/.test(w)), `${name}: the reply says the inputs were reset`);
      // V7-05: 버린 값과 되돌리는 한 번
      const dc = r.discarded_unsaved_changes;
      assert(dc && Array.isArray(dc.values), `${name}: discarded values reported`);
      const lb = dc.values.find((x) => x.key === 'Lb');
      assert(lb && lb.value === LB && lb.source === 'user' && dc.units === 'US', `${name}: Lb ${LB} (user) is in the reply: ${JSON.stringify(lb)}`);
      assert(dc.restore && dc.restore.tool === 'set_case_inputs' && dc.restore.arguments.inputs.Lb === LB && /set_case_inputs/.test(dc.restore_note), `${name}: restore arguments`);
      const shown = p.__testGetPostedMessages().filter((m) => m.command === 'caseDiscarded').pop();
      assert(shown && shown.data.values.some((x) => x.key === 'Lb' && x.value === LB), `${name}: the page is told the values too`);
      // 화면의 열기와 같은 결과
      const viaAi = JSON.stringify(caseOf().inputs);
      await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { Lb: LB } } });
      p.__testLoadProjectFile(file);
      assert.strictEqual(JSON.stringify(caseOf().inputs), viaAi, `${name}: load_project and the screen's open give the same inputs`);
      // 되돌리기 한 번
      const back = await p.handleMcpAction({ action: 'set_case_inputs', ...dc.restore.arguments });
      assert(!back.error && caseOf().inputs.Lb === LB && caseOf().inputs.Cb === 1.2, `${name}: one set_case_inputs restores the values (${JSON.stringify(back).slice(0, 200)})`);
      lines.push(`${name}: inputs reset, dirty false, Lb ${LB} reported and restored`);
    }
    // SI 로 요청하면 버린 값도 SI
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { Lb: 100 } } });
    const si = await p.handleMcpAction({ action: 'load_project', filepath: raw, report_units: 'SI' });
    const lbSi = si.discarded_unsaved_changes.values.find((x) => x.key === 'Lb');
    assert(si.discarded_unsaved_changes.units === 'SI' && Math.abs(lbSi.value - 2540) < 1e-6, `SI values (${JSON.stringify(lbSi)})`);
    const back = await p.handleMcpAction({ action: 'set_case_inputs', ...si.discarded_unsaved_changes.restore.arguments });
    assert(!back.error && Math.abs(caseOf().inputs.Lb - 100) < 1e-9, 'the SI restore puts back 100 in');
    lines.push('SI on request, restorable');
  } finally { ctx.close(); }
  console.log(`load_project_contract: PASS (${lines.join('; ')})`);
}
main().catch((e) => { console.error('load_project_contract: FAIL', e && e.message ? e.message : e); process.exitCode = 1; });
