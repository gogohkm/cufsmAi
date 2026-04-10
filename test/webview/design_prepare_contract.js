const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readUtf8(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
}

function main() {
  const panelTs = readUtf8(path.join('src', 'webview', 'StcfsdPanel.ts'));
  const appJs = readUtf8(path.join('webview', 'js', 'app.js'));

  assert(panelTs.includes('id="btn-prepare-design-dsm"'), 'design tab HTML must include the FSM prepare button');
  assert(panelTs.includes("case 'prepareDesignDsm'"), 'panel must handle prepareDesignDsm webview messages');
  assert(panelTs.includes("case 'prepare_design_dsm'"), 'panel MCP action handler must support prepare_design_dsm');

  assert(appJs.includes("const btnPrepareDesignDsm = document.getElementById('btn-prepare-design-dsm');"),
    'app.js must bind the FSM prepare button');
  assert(appJs.includes("command: 'prepareDesignDsm'"),
    'app.js must send prepareDesignDsm when the FSM prepare button is clicked');
  assert(appJs.includes("case 'designDsmPrepared'"),
    'app.js must handle designDsmPrepared responses from the extension host');

  console.log('design_prepare_contract: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
