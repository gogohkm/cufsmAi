// 0926 Phase 2/3: 설계 검증 UI + 테마/a11y 회귀 고정.
// - design-validation 박스 + May 가드 tripwire
// - 차트 고정색 제거(테마 토큰) tripwire
// - 미평가 배지 + canvas aria-label + 인쇄 CSS tripwire
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readUtf8(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
}

function main() {
  const appJs = readUtf8(path.join('webview', 'js', 'app.js'));
  const panelTs = readUtf8(path.join('src', 'webview', 'StcfsdPanel.ts'));
  const themeCss = readUtf8(path.join('webview', 'css', 'theme.css'));

  // P2: May 가드
  assert(panelTs.includes('id="design-validation"'),
    'panel must have design-validation box');
  assert(appJs.includes('showDesignValidation'),
    'app.js must define showDesignValidation');
  assert(appJs.includes("member_type === 'combined' && data.Muy > 0"),
    'app.js must guard Muy>0 without May_strength');

  // P3: 차트 테마 토큰 (고정 흰/검 배경 금지)
  assert(appJs.includes('--vscode-editor-background'),
    'chart must read editor background token');
  assert(!appJs.includes("fillStyle = 'rgba(255,255,255,0.85)'"),
    'legend must not use fixed white background');
  assert(!appJs.includes("strokeStyle = 'rgba(0,0,0,0.6)'"),
    'crosshair must not use fixed black');

  // P3: 미평가 배지
  assert(appJs.includes('local_not_evaluated') && appJs.includes('warn-badge'),
    'results must render not-evaluated badges');
  assert(themeCss.includes('.warn-badge'), 'theme must define .warn-badge');
  assert(themeCss.includes('.validation-box'), 'theme must define .validation-box');

  // P3: 3D 폴백 상태 노출
  assert(appJs.includes('CufsmViewer3D not loaded'),
    '3D wrapper must log fallback chain');

  // P4: a11y + 인쇄
  for (const id of ['buckling-curve-canvas', 'classify-curve-canvas',
    'plastic-surface-canvas', 'mode-shape-canvas', 'mode-shape-3d-canvas']) {
    assert(panelTs.includes(`id="${id}"`) && panelTs.includes('aria-label'),
      `canvas ${id} must exist with aria-labels present`);
  }
  assert(themeCss.includes('@media print'), 'theme must have print CSS');

  console.log('gui_contract_0926: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
