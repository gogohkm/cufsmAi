// 0926 후속-1: webview/js/utils.js 순수 유틸 단위 테스트 + app.js 분리 tripwire.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readUtf8(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
}

function main() {
  const u = require('../../webview/js/utils.js');

  // fmt
  assert.strictEqual(u.fmt('x'), '-', 'non-number -> -');
  assert.strictEqual(u.fmt(1.234567), '1.2346', 'toFixed(4)');
  assert.strictEqual(u.fmt(0.001), (0.001).toExponential(3), 'tiny -> exponential');

  // logspace
  const ls = u.logspace(0, 2, 3);
  assert.strictEqual(ls.length, 3, 'logspace length');
  assert(Math.abs(ls[0] - 1) < 1e-12 && Math.abs(ls[2] - 100) < 1e-9, 'logspace endpoints');

  // convexHull: square + interior point -> 4 corners
  const hull = u.convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]);
  assert.strictEqual(hull.length, 4, 'hull drops interior point');
  assert.deepStrictEqual(u.convexHull([[0, 0], [1, 1]]), [[0, 0], [1, 1]], 'short passthrough');

  // 분리 tripwire: app.js는 정의를 갖지 않고 StcfsdUtils에서 가져와야 함
  const appJs = readUtf8(path.join('webview', 'js', 'app.js'));
  assert(!appJs.includes('function _convexHull('), 'app.js must not define _convexHull');
  assert(!appJs.includes('function logspace('), 'app.js must not define logspace');
  assert(!/function fmt\(/.test(appJs), 'app.js must not define fmt');
  assert(appJs.includes('globalThis.StcfsdUtils'), 'app.js must consume StcfsdUtils');

  // 로드 순서 tripwire: utils.js가 app.js보다 먼저
  const panelTs = readUtf8(path.join('src', 'webview', 'StcfsdPanel.ts'));
  const ui = panelTs.indexOf('utils.js');
  const ai = panelTs.indexOf('app.js');
  assert(ui !== -1 && ui < ai, 'utils.js must load before app.js');

  console.log('utils_contract: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
