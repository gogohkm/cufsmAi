// 패리티 개선 tripwire: MCP 신규 3종 + GUI 진동해석 배선 고정.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readUtf8(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
}

function main() {
  const serverTs = readUtf8(path.join('src', 'mcp', 'server.ts'));
  const panelTs = readUtf8(path.join('src', 'webview', 'StcfsdPanel.ts'));
  const appJs = readUtf8(path.join('webview', 'js', 'app.js'));

  // MCP 신규 도구
  for (const t of ['load_project', 'cold_work', 'flange_curling']) {
    assert(serverTs.includes(`server.tool("${t}"`), `MCP must expose ${t}`);
  }
  // 패널 액션 연결
  assert(panelTs.includes("case 'load_project'"), 'panel must handle load_project');
  assert(panelTs.includes("case 'cold_work'"), 'panel must handle cold_work');
  assert(panelTs.includes('flange_curling'), 'panel must handle flange_curling');

  // GUI 진동해석 배선
  assert(panelTs.includes('id="btn-run-vibration"'), 'panel must have vibration button');
  assert(panelTs.includes('id="vibration-result"'), 'panel must have vibration result div');
  assert(panelTs.includes("case 'runVibration'"), 'panel must route runVibration');
  assert(appJs.includes("command: 'runVibration'"), 'app.js must send runVibration');
  assert(appJs.includes("case 'vibrationResult'"), 'app.js must render vibrationResult');
  assert(appJs.includes('function renderVibrationResult'), 'app.js must define renderer');

  console.log('parity_contract: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
