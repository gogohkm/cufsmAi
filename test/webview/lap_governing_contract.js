// 0926 Phase 0: Lap 지배값 선택 + 단위 변환 회귀 고정 (§4 이슈2A/2B).
// - selectLapGoverningMoment 순수함수 단위 테스트 (designState.js 공용)
// - app.js가 공용 함수를 사용하는지 + StcfsdPanel 12x 변환 tripwire
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readUtf8(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
}

function main() {
  const ds = require('../../webview/js/designState.js');
  assert(typeof ds.selectLapGoverningMoment === 'function',
    'designState must export selectLapGoverningMoment');

  // 부모멘트만 선택: 정모멘트(큰 값)가 있어도 부모멘트 선택
  let sel = ds.selectLapGoverningMoment([
    { name: 'Support A', Mu: -1.7, Vu: 2.0 },
    { name: 'Midspan 1', Mu: 5.5, Vu: 0.1 },
    { name: 'Support B', Mu: -1.2, Vu: 2.5 },
  ]);
  assert.strictEqual(sel.negMuFt, -1.7, 'selects max |negative| Mu, not positive');
  assert.strictEqual(sel.negMuName, 'Support A', 'reports governing location');
  assert.strictEqual(sel.maxVu, 2.5, 'selects max |Vu|');

  // 'Lap end' 위치 제외
  sel = ds.selectLapGoverningMoment([
    { name: 'Lap end L', Mu: -9.9, Vu: 9.9 },
    { name: 'Support B', Mu: -1.2, Vu: 1.0 },
  ]);
  assert.strictEqual(sel.negMuFt, -1.2, 'excludes Lap end locations');

  // 부모멘트 없음 → null (정모멘트 오입력 방지)
  sel = ds.selectLapGoverningMoment([{ name: 'Midspan 1', Mu: 5.5, Vu: 0.1 }]);
  assert.strictEqual(sel.negMuFt, null, 'no negative Mu -> null');
  assert.strictEqual(sel.maxVu, 0.1, 'Vu still selected');

  // 빈 입력
  sel = ds.selectLapGoverningMoment([]);
  assert.strictEqual(sel.negMuFt, null, 'empty -> null negMu');
  assert.strictEqual(sel.maxVu, 0, 'empty -> 0 Vu');
  sel = ds.selectLapGoverningMoment(null);
  assert.strictEqual(sel.negMuFt, null, 'null-safe');

  // app.js가 공용 함수를 사용하는지 tripwire
  const appJs = readUtf8(path.join('webview', 'js', 'app.js'));
  assert(appJs.includes('selectLapGoverningMoment(gov.locations)'),
    'app.js _autoFillLapInputs must use the shared selector');
  assert(appJs.includes("Math.abs(sel.negMuFt) * 12"),
    'app.js must convert kip-ft -> kip-in (x12) for conn-Mu');

  // StcfsdPanel lap 이용률 12x 변환 tripwire (§4 이슈2B)
  const panelTs = readUtf8(path.join('src', 'webview', 'StcfsdPanel.ts'));
  assert(panelTs.includes('negMuSupport * 12'),
    'StcfsdPanel must convert negMuSupport kip-ft -> kip-in (x12)');

  console.log('lap_governing_contract: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
