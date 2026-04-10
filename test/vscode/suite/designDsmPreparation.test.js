const assert = require('assert');
const vscode = require('vscode');
const { StcfsdPanel } = require('../../../out/webview/StcfsdPanel');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, predicate, timeoutMs = 60000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await Promise.resolve(predicate());
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  await vscode.commands.executeCommand('stcfsd.openDesigner');

  const panel = await waitFor('designer panel', () => StcfsdPanel.currentPanel, 15000);
  assert(panel, 'expected StcfsdPanel.currentPanel to be populated');
  assert(panel.__testGetHtml().includes('btn-prepare-design-dsm'),
    'design tab HTML should contain the FSM prepare button');

  panel.__testClearPostedMessages();
  try {
    await waitFor('default section initialization', () => panel.__testGetState().model.nodeCount > 0, 10000);
  } catch {
    await panel.__testDispatchMessage({ command: 'webviewReady' });
    await waitFor('default section initialization', () => panel.__testGetState().model.nodeCount > 0, 20000);
  }
  await sleep(1500);

  await panel.handleMcpAction({ action: 'set_load_case', load_case: 'compression', fy: 35.53 });
  const analysis = await panel.handleMcpAction({ action: 'run_analysis' });
  assert.strictEqual(analysis.success, true, 'expected baseline compression analysis to succeed');

  const stateBeforePrepare = panel.__testGetState();
  assert.strictEqual(stateBeforePrepare.lastAnalysisMeta.load_type, 'compression',
    'baseline visible analysis should stay on compression before FSM preparation');

  panel.__testClearPostedMessages();
  await panel.__testDispatchMessage({
    command: 'prepareDesignDsm',
    data: { member_type: 'flexure', Fy: 35.53 },
  });

  const prepMessage = await waitFor(
    'designDsmPrepared message',
    () => panel.__testGetPostedMessages().find((msg) => msg.command === 'designDsmPrepared'),
    30000
  );
  assert.strictEqual(prepMessage.data.success, true, 'expected FSM preparation to succeed');
  assert(prepMessage.data.dsm && prepMessage.data.dsm.Mxx, 'expected flexural DSM values to be prepared');

  const stateAfterPrepare = panel.__testGetState();
  assert.strictEqual(stateAfterPrepare.lastAnalysisMeta.load_type, 'compression',
    'FSM preparation must not overwrite the visible analysis load case');
  assert.strictEqual(stateAfterPrepare.lastAnalysisMeta.timestamp, stateBeforePrepare.lastAnalysisMeta.timestamp,
    'FSM preparation must preserve the visible analysis snapshot');
  assert(stateAfterPrepare.preparedDesignDsm && stateAfterPrepare.preparedDesignDsm.Mxx,
    'prepared flexural DSM cache should be stored on the panel');

  panel.__testClearPostedMessages();
  await panel.__testDispatchMessage({
    command: 'runDesign',
    data: {
      member_type: 'flexure',
      design_method: 'LRFD',
      Fy: 35.53,
      Fu: 58.02,
      Mu: 10.0,
      Lb: 120.0,
      Cb: 1.0,
    },
  });

  const designMessage = await waitFor(
    'designResult message',
    () => panel.__testGetPostedMessages().find((msg) => msg.command === 'designResult'),
    30000
  );
  assert(!designMessage.data.error, `design run should succeed: ${designMessage.data.error || ''}`);
  assert(
    !String(designMessage.data.dsm_warning || '').includes('Current analysis load case does not match'),
    'prepared DSM cache should suppress the load-case mismatch warning during design'
  );
  assert(
    !String(designMessage.data.dsm_warning || '').includes('No analysis results'),
    'prepared DSM cache should suppress the missing-analysis warning during design'
  );

  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await waitFor('panel disposal', () => !StcfsdPanel.currentPanel, 10000);
}

module.exports = { run };
