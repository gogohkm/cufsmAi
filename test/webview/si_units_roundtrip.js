// 0926 Phase 0/1 (P1-7): SI↔US 변환 단일 모듈 회귀 고정.
// - siUnits.ts를 typescript transpileModule로 로드 (node 직접 실행)
// - 상수 역원 관계, 입출력 왕복, 도구별 출력 맵 키 고정
// - server.ts에 인라인 SI 맵이 없는지 tripwire
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function loadSiUnits() {
  const ts = require('../../node_modules/typescript');
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'mcp', 'siUnits.ts'), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', 'require', js)(
    mod.exports, mod, require);
  return mod.exports;
}

function readUtf8(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
}

function main() {
  const si = loadSiUnits();
  const { SI_TO_US, US_TO_SI, convertInputSI, convertOutputSI,
    SI_OUTPUT_COMPRESSION, SI_OUTPUT_FLEXURE,
    SI_OUTPUT_CONNECTION, SI_INPUT_CONNECTION } = si;

  // 1) 정·역변환 상수가 역원 관계
  for (const k of Object.keys(SI_TO_US)) {
    assert(US_TO_SI[k] !== undefined, `US_TO_SI missing ${k}`);
    assert(Math.abs(SI_TO_US[k] * US_TO_SI[k] - 1) < 1e-9, `${k} reciprocal`);
  }

  // 2) 입력 왕복: SI -> US -> SI (입력 변환은 반올림 없음)
  const inp = convertInputSI(
    { Fy: 245, t1: 2.0, Pu: 10, Ag: 500 }, SI_INPUT_CONNECTION);
  assert(Math.abs(inp.Fy - 245 / 6.89476) < 1e-9, 'Fy MPa->ksi');
  assert(Math.abs(inp.t1 - 2.0 / 25.4) < 1e-12, 't1 mm->in');
  assert(Math.abs(inp.Ag - 500 / (25.4 * 25.4)) < 1e-12, 'Ag mm2->in2');
  // null/undefined/비숫자는 그대로
  const inp2 = convertInputSI({ d: null, e: undefined, n: 2 }, SI_INPUT_CONNECTION);
  assert.strictEqual(inp2.d, null, 'null passes through');
  assert.strictEqual(inp2.n, 2, 'unmapped key untouched');

  // 3) 출력 왕복: US -> SI (소수 4자리)
  const out = convertOutputSI(
    { Pn: 10, design_strength: 8.5, utilization: 0.9, pass: true },
    SI_OUTPUT_COMPRESSION);
  assert(Math.abs(out.Pn - 10 * 4.44822) < 1e-3, 'Pn kips->kN');
  assert.strictEqual(out.utilization, 0.9, 'dimensionless untouched');
  assert.strictEqual(out.pass, true, 'boolean untouched');

  // 4) 도구별 출력 맵 키 고정 (누락 시 단위 혼합 출력)
  assert.deepStrictEqual(
    Object.keys(SI_OUTPUT_COMPRESSION).sort(),
    ['Pn', 'Pn_omega', 'Pnd', 'Pne', 'Pnl', 'Py', 'design_strength', 'phi_Pn'].sort(),
    'compression output keys');
  assert.deepStrictEqual(
    Object.keys(SI_OUTPUT_FLEXURE).sort(),
    ['Mn', 'Mn_dsm', 'Mn_omega', 'Mnd', 'Mne', 'Mnl', 'My', 'design_strength', 'phi_Mn'].sort(),
    'flexure output keys');
  assert.deepStrictEqual(
    Object.keys(SI_OUTPUT_CONNECTION).sort(), ['Rn', 'design_strength'].sort(),
    'connection output keys');
  // 무차원 키가 맵에 들어가면 안 됨
  for (const m of [SI_OUTPUT_COMPRESSION, SI_OUTPUT_FLEXURE, SI_OUTPUT_CONNECTION]) {
    for (const bad of ['utilization', 'pass', 'ratio', 'equation']) {
      assert(!(bad in m), `dimensionless key ${bad} must not be in output map`);
    }
  }

  // 5) server.ts에 인라인 SI 맵 잔재 tripwire
  const serverTs = readUtf8(path.join('src', 'mcp', 'server.ts'));
  assert(!serverTs.includes('const SI_TO_US'), 'SI_TO_US must live in siUnits.ts');
  assert(!serverTs.includes('const US_TO_SI'), 'US_TO_SI must live in siUnits.ts');
  assert(serverTs.includes("from \"./siUnits\""), 'server.ts must import siUnits');
  assert(serverTs.includes('SI_OUTPUT_COMPRESSION'), 'compression uses shared map');
  assert(serverTs.includes('SI_OUTPUT_FLEXURE'), 'flexure uses shared map');
  assert(serverTs.includes('SI_OUTPUT_CONNECTION'), 'connection uses shared map');
  assert(serverTs.includes('SI_INPUT_CONNECTION'), 'connection input uses shared map');

  console.log('si_units_roundtrip: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
