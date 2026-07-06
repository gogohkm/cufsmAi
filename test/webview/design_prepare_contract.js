const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readUtf8(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
}

function main() {
  const panelTs = readUtf8(path.join('src', 'webview', 'StcfsdPanel.ts'));
  const appJs = readUtf8(path.join('webview', 'js', 'app.js'));

  // 새 계약: 별도 "설계용 FSM 해석 준비" 버튼은 제거되고, 해석 실행(analysisComplete)
  // 시 _autoPrepareDesignDsm()이 부재 유형에 맞는 설계용 좌굴값을 자동 준비한다.
  assert(!panelTs.includes('id="btn-prepare-design-dsm"'),
    'the standalone FSM prepare button must be removed (merged into 해석 실행)');
  assert(panelTs.includes("case 'prepareDesignDsm'"), 'panel must handle prepareDesignDsm webview messages');
  assert(panelTs.includes("case 'prepare_design_dsm'"), 'panel MCP action handler must support prepare_design_dsm');

  assert(appJs.includes('function _autoPrepareDesignDsm()'),
    'app.js must define the auto-prepare helper');
  assert(appJs.includes('_autoPrepareDesignDsm();'),
    'app.js must invoke auto-prepare after analysisComplete');
  assert(appJs.includes("command: 'prepareDesignDsm'"),
    'app.js must send prepareDesignDsm (from the auto-prepare helper)');
  assert(appJs.includes("case 'designDsmPrepared'"),
    'app.js must handle designDsmPrepared responses from the extension host');

  console.log('design_prepare_contract: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
