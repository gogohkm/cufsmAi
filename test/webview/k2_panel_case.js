/* global process */
// K2 — 호스트(진짜 StcfsdPanel + 진짜 파이썬, 화면 없이)의 검토 상태 길.
//   node test/webview/k2_panel_case.js
//  - caseEdit → caseAck(판), 검사 실패 · 충돌(baseRev 뒤에 다른 쓰는 이가 바꾼 키)
//  - .csd 1.4: 저장은 상태에서(case + 1.3 모양 designInputs), 열기는 상태로 — 조작된 .csd 의 모르는 키가 상태 · 다음 저장으로 새지 않는다
//  - 두 번째 caseHello(새로 고침)에 상태를 다시 보낸다
//  - 저장 안 한 변경(caseDirty)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPanel } = require('./panel_harness');

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('k2_panel_case: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  // 임시 파일은 이 시험의 출력 폴더에(git 밖 — test/rendered/.gitignore 의 out/)
  const base = path.join(__dirname, '..', 'rendered', 'out', 'k2');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'panel-'));
  const posted = (cmd) => p.__testGetPostedMessages().filter((m) => m.command === cmd);
  try {
    // ── caseEdit · caseAck · 충돌 ─────────────────────────────────────────
    await p.__testDispatchMessage({ command: 'caseHello', data: { inputs: null, drafts: { templateType: 'lippedc' } } });
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: 0, changes: { Lb: 72, wcSupport: 'XYZ' } } });
    let ack = posted('caseAck').pop();
    assert(ack && ack.data.rev === 1, 'rev 1 after one accepted change');
    assert.deepStrictEqual(ack.data.rejected.map((r) => r.key), ['wcSupport'], 'invalid option refused');
    let st = p.__testGetCase().state;
    assert.strictEqual(st.inputs.Lb, 72);
    assert.strictEqual(st.sources.Lb, 'user');
    // 다른 쓰는 이(파일)가 Lb 를 바꾼 뒤, 그것을 보지 못한 화면 변경(baseRev 1)은 Lb 를 덮지 않는다
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'file', changes: { Lb: 96 } } });
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: 1, changes: { Lb: 80, Cb: 1.2 } } });
    ack = posted('caseAck').pop();
    assert.deepStrictEqual(ack.data.conflicts, ['Lb'], 'conflict reported');
    assert(posted('caseState').length === 1, 'state pushed back to the page after a conflict');
    st = p.__testGetCase().state;
    assert.deepStrictEqual([st.inputs.Lb, st.inputs.Cb], [96, 1.2]);

    // ── 저장: 1.4, 상태에서 ───────────────────────────────────────────────
    const f1 = path.join(dir, 'a.csd');
    await p.__testWriteProjectFile(f1);
    const j1 = JSON.parse(fs.readFileSync(f1, 'utf8'));
    assert.strictEqual(j1.version, '1.4');
    assert.strictEqual(j1.case.inputs.Lb, 96);
    assert.strictEqual(j1.designInputs.Lb, 96, '1.3-shaped inputs from the state');
    assert.strictEqual(j1.designInputs.fyLoad, j1.designInputs.fy, 'mirrors written with the owner value');
    assert.strictEqual(j1.designInputs.templateType, 'lippedc', 'model keys from the page drafts');

    // ── 조작된 .csd: case · designInputs · 최상위에 남의 키 → 상태 · 다음 저장에 없다 ─────────────
    const evil = { ...j1, mcpServers: { x: { command: 'evil' } }, hooks: { a: 1 } };
    evil.case = { ...j1.case, inputs: { ...j1.case.inputs, mcpServers: { y: 1 }, analysisBC: 'C-C', Lb: 50 }, sources: { ...j1.case.sources, mcpServers: 'ai' } };
    evil.designInputs = { ...j1.designInputs, hooks: 'x', permissions: { allow: ['*'] } };
    const f2 = path.join(dir, 'evil.csd');
    fs.writeFileSync(f2, JSON.stringify(evil));
    p.__testClearPostedMessages();
    const lr = p.__testLoadProjectFile(f2);
    assert(!lr.error, lr.error);
    assert(lr.warnings.some((w) => /mcpServers/.test(w)) && lr.warnings.some((w) => /analysisBC/.test(w)), 'foreign keys named in the warnings');
    st = p.__testGetCase().state;
    assert.strictEqual(st.inputs.Lb, 50, 'the case record is read');
    assert(!('mcpServers' in st.inputs) && !('analysisBC' in st.inputs) && !('mcpServers' in st.sources), 'no foreign key in the state');
    const rst = posted('restoreDesignInputs')[0];
    assert(rst && !('hooks' in rst.data) && !('permissions' in rst.data) && !('mcpServers' in rst.data), 'no foreign key sent to the page');
    const f3 = path.join(dir, 'resaved.csd');
    await p.__testWriteProjectFile(f3);
    const t3 = fs.readFileSync(f3, 'utf8');
    for (const bad of ['mcpServers', 'hooks', 'permissions', 'evil']) { assert(!t3.includes(bad), `${bad} not in the re-saved .csd`); }
    const raw = path.join(dir, 'raw.stcfsd');
    const sr = await p.handleMcpAction({ action: 'save_project', filepath: raw });
    assert(sr && sr.success, JSON.stringify(sr));
    const tr = fs.readFileSync(raw, 'utf8');
    for (const bad of ['mcpServers', 'hooks', 'permissions']) { assert(!tr.includes(bad), `${bad} not in save_project`); }

    // ── 옛 판(1.3, case 없음) 은 designInputs 로 — 거울은 하나(D-3) ────────────────────
    const old = { ...j1, version: '1.3' };
    delete old.case;
    old.designInputs = { ...j1.designInputs, fu: 65, fuPre: 60 };
    const f4 = path.join(dir, 'old13.csd');
    fs.writeFileSync(f4, JSON.stringify(old));
    p.__testClearPostedMessages();
    assert(!p.__testLoadProjectFile(f4).error);
    const r4 = posted('restoreDesignInputs')[0].data;
    assert.deepStrictEqual([r4.fu, r4.fuPre], [65, 65], 'D-3: the page gets one Fu (65) for every tab');

    // ── 새로 고침: 두 번째 caseHello 에 상태를 다시 ─────────────────────────────────
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseHello', data: { inputs: null, drafts: {} } });
    const cs = posted('caseState');
    assert(cs.length === 1 && cs[0].data.designInputs.fu === 65, 'state pushed to a reloaded page');

    // ── 저장 안 한 변경 ──────────────────────────────────────────────────────
    const dirtyNow = () => posted('caseDirty').pop();
    p.__testClearPostedMessages();
    assert(!p.__testLoadProjectFile(f1).error);
    assert.strictEqual(dirtyNow().data.dirty, false, 'clean right after open');
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', baseRev: p.__testGetCase().state.rev, changes: { Cb: 1.3 } } });
    assert.strictEqual(dirtyNow().data.dirty, true, 'dirty after an edit');
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'unit-toggle', changes: { unitSystem: 'US' } } });
    await p.__testWriteProjectFile(path.join(dir, 'b.csd'));
    assert.strictEqual(dirtyNow().data.dirty, false, 'clean after save');
    p.__testClearPostedMessages();
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'unit-toggle', changes: { unitSystem: 'SI' } } });
    assert(!posted('caseDirty').some((m) => m.data.dirty), 'a unit toggle alone is not a change');
  } finally {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('k2_panel_case: PASS');
}

main().then(() => process.exit(0)).catch((e) => { console.error('k2_panel_case: FAIL', e); process.exit(1); });
