const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readUtf8(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
}

function main() {
  const panelTs = readUtf8(path.join('src', 'webview', 'StcfsdPanel.ts'));
  const appJs = readUtf8(path.join('webview', 'js', 'app.js'));
  const designStateJs = readUtf8(path.join('webview', 'js', 'designState.js'));
  const mcpTs = readUtf8(path.join('src', 'mcp', 'server.ts'));

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

  // 해석곡선 하나를 압축(P)과 휨(Mxx)에 동시에 환산하지 않는다.
  assert(panelTs.includes('private async _extractCurrentAnalysisDsm()'),
    'panel must centralize load-family-specific DSM extraction');
  assert(panelTs.includes("const P = family === 'P'"),
    'compression DSM must only be extracted from a compression curve');
  assert(panelTs.includes("const Mxx = family === 'Mxx'"),
    'flexural DSM must only be extracted from a strong-axis bending curve');
  assert(panelTs.includes("this._requireCurrentSignature(baseSignature, 'Purlin design')"),
    'purlin design must reject results when the model changes during analysis');

  // 양력은 하부 플랜지 압축/무스프링 곡선(dsmNeg)을 사용하고, R 은 §I6.2.1 적격 구간에만 준다(W3 · V3 T5–T7).
  assert(panelTs.includes("addRegions(ub.negative_regions, 'uplift', uplift, dsmNeg,"),
    'uplift regions must use the reverse-bending unbraced DSM curve (dsmNeg)');
  assert(panelTs.includes('r.i621_region_eligible === true && upliftR != null'),
    'R_uplift only where the engine marks the region I6.2.1-eligible');
  assert(!/addRegions\(ub\.negative_regions[^\n]*dsmPos/.test(panelTs),
    'uplift bottom-flange regions must not reuse the deck-braced positive-moment DSM curve');

  // 데크 시험 강성 override와 입력 변경 무효화가 UI/저장 계약에 모두 포함된다.
  assert(panelTs.includes('id="deck-kx-override"'), 'HTML must expose a tested kx override');
  assert(appJs.includes("document.getElementById('deck-kx-override')"), 'load payload must include kx override');
  assert(designStateJs.includes('deckKxOverride'), 'project state must persist kx override');
  assert(appJs.includes("command: 'invalidateDerivedResults'"),
    'UI input changes must invalidate derived load/design results');

  // MCP 스키마와 Extension 동작이 같은 입력을 실제로 소비한다.
  assert(panelTs.includes("if (lc === 'custom')") && panelTs.includes('Mxx: options.Mxx ?? 0'),
    'custom load-case forces must be applied by the extension');
  assert(panelTs.includes('this._model.neigs = neigs'),
    'run_analysis neigs must be applied to the model');
  // W2/W3: Cm 은 MCP 가 채우지 않는다(엔진이 1.0 을 쓰고 assumptions 에 밝힌다). 1.0 이 아닌 기본값만 막는다.
  assert(!/Cm[xy]\s*\?\?\s*(?!1\.0\b)[0-9.]+/.test(mcpTs),
    'MCP must not invent a Cm default other than the engine value 1.0');

  console.log('design_prepare_contract: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
