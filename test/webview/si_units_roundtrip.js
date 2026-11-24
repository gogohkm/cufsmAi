// SI↔US 변환 단일 모듈 계약 (0926 P1-7, 2026-11-22 W2: R8-04 · R8-12 · R8-30).
// - siUnits.ts 를 typescript transpileModule 로 node 에서 직접 로드한다.
// - 계수는 정의값에서 이 시험 안에서 따로 계산한 값과 비교한다(코드 값을 베끼지 않음).
// - 입력은 나눗셈(+15 자리)이라 US 로 정확한 값이 그대로 돌아오고, 출력은 곱셈만 한다.
// - 재귀 변환: 중첩 dict, 배열, 한계상태 표, steps[{value, unit}], 열 단위 행렬, US 로 남기는 조건표,
//   모르는 수치 키의 경로 보고.
// - server.ts tripwire: 인라인 변환 맵 · 지어낸 기본값(35.53, D || 1, Fuf || 120, rho 1.0) 금지.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function loadSiUnits() {
  const ts = require('../../node_modules/typescript');
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'mcp', 'siUnits.ts'), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', 'require', js)(mod.exports, mod, require);
  return mod.exports;
}

function readUtf8(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
}

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

function main() {
  const si = loadSiUnits();
  const { US_TO_SI, SI_TO_US, toUS, toSI, convertInputSI, convertOutputSIDeep,
    SI_INPUT_TABLES, SI_INPUT_DIMENSIONLESS, SI_OUT_MEMBER, SI_OUT_LOADS, SI_OUT_GET_DSM } = si;

  // 1) 정의값에서 유도한 계수 (1 lbf = 0.45359237 kg × 9.80665 m/s²; 1 in = 25.4 mm; 1 ft = 0.3048 m)
  const lbfN = 0.45359237 * 9.80665;              // 4.4482216152605 N
  const kipkN = lbfN;                              // 1 kip = 1000 lbf = 4.4482216152605 kN
  const expect = {
    length: 25.4, area: 25.4 ** 2, modulus: 25.4 ** 3, inertia: 25.4 ** 4, warping: 25.4 ** 6,
    force: kipkN, stress: kipkN * 1000 / 645.16, moment: kipkN * 0.0254, moment_ft: kipkN * 0.3048,
    length_ft: 0.3048, linload: lbfN / 1000 / 0.3048, pressure: lbfN / 1000 / 0.3048 ** 2,
    density: kipkN * 1000 / 0.0254 / 0.0254 ** 3,
    rot_stiff: kipkN, lat_stiff: kipkN / 0.0254 ** 2, spring_disc: kipkN / 0.0254,
    rot_spring_disc: kipkN * 0.0254,
  };
  for (const [k, v] of Object.entries(expect)) {
    assert(US_TO_SI[k] !== undefined, `US_TO_SI.${k} missing`);
    assert(rel(US_TO_SI[k], v) < 1e-14, `US_TO_SI.${k} = ${US_TO_SI[k]} vs definition ${v}`);
    assert(rel(SI_TO_US[k] * US_TO_SI[k], 1) < 1e-15, `${k} reciprocal`);
  }
  // 흔히 쓰는 표기값과도 맞는다(소수 6 자리)
  assert(Math.abs(US_TO_SI.stress - 6.894757) < 1e-6, 'ksi→MPa 6.894757');
  assert(Math.abs(US_TO_SI.moment - 0.112985) < 1e-6, 'kip-in→kN-m 0.112985');
  // 강재 밀도 0.2836 lb/in³ ÷ g = 7.345e-7 kip·s²/in⁴ ≈ 7850 kg/m³
  assert(Math.abs(toSI(0.2836 / 386.0886 / 1000, 'density') - 7850) < 2, 'steel density');

  // 2) R8-12: SI 입력은 나눗셈 — US 로 정확한 값이 정확히 돌아온다
  assert.strictEqual(toUS(12.7, 'length'), 0.5, '12.7 mm → 0.5 in exactly (was 0.49999999999999994)');
  assert.strictEqual(toUS(25.4, 'length'), 1);
  assert.strictEqual(toUS(1.4986, 'length'), 0.059);
  assert.strictEqual(toUS(345 / 6.894757293168361 * US_TO_SI.stress, 'stress') > 0, true);
  // US 값 → SI(곱셈) → US(나눗셈+15자리) 는 십진 US 값을 비트 단위로 되돌린다
  const samples = [0.059, 0.0451, 0.1875, 0.5, 0.75, 1.5, 8, 12, 120, 2.5, 0.625, 35.53, 50, 65,
    58.02, 29500, 11346.15, 1.25, 3.7, 0.018, 7.345e-7, 0.1126, 1.28, 25, 100, -150, 40];
  for (const unit of Object.keys(expect)) {
    for (const x of samples) {
      assert.strictEqual(toUS(toSI(x, unit), unit), x, `round trip ${x} ${unit}`);
    }
  }

  // 3) 입력 표: 중첩 dict · 배열 · 열 단위 행렬 · 스프링(이산/분포) · 표에 없는 키는 그대로
  const loads = convertInputSI({
    member_app: 'roof-purlin', span_type: 'cont-3', span_ft: 7.62, spans_ft: [7.62, 9.144],
    loads: { D: 25 * US_TO_SI.linload, W: -150 * US_TO_SI.linload },
    laps_per_support: [null, { left_ft: 0.6096, right_ft: 0.6096 }],
    section: { depth: 203.2, thickness: 1.4986, type: 'Z', Fy: 55 * US_TO_SI.stress },
    deck: { type: 'through-fastened', t_panel: 0.4572, kphi_override: 0.1126 * US_TO_SI.rot_stiff },
    pattern_loading: true, i621_conditions_confirmed: true,
  }, SI_INPUT_TABLES.analyze_loads);
  assert.strictEqual(loads.span_ft, 25);
  assert.deepStrictEqual(loads.spans_ft, [25, 30]);
  assert.deepStrictEqual(loads.loads, { D: 25, W: -150 });
  assert.deepStrictEqual(loads.laps_per_support, [null, { left_ft: 2, right_ft: 2 }]);
  assert.deepStrictEqual(loads.section, { depth: 8, thickness: 0.059, type: 'Z', Fy: 55 });
  assert.deepStrictEqual(loads.deck, { type: 'through-fastened', t_panel: 0.018, kphi_override: 0.1126 });
  assert.strictEqual(loads.pattern_loading, true);

  const nodes = convertInputSI({ nodes: [[1, 25.4, 50.8, 1, 1, 1, 1, 50 * US_TO_SI.stress]],
    elements: [[1, 1, 2, 1.4986, 100]] }, SI_INPUT_TABLES.set_nodes);
  assert.deepStrictEqual(nodes.nodes, [[1, 1, 2, 1, 1, 1, 1, 50]], 'node rows: x, z mm→in, stress MPa→ksi');
  assert.deepStrictEqual(nodes.elements, [[1, 1, 2, 0.059, 100]], 'element rows: t mm→in');

  const springs = convertInputSI({ springs: [
    [1, 3, 0, 0, 0, 2 * US_TO_SI.lat_stiff, 0.5 * US_TO_SI.rot_stiff, 0, 0, 0],
    [2, 4, 0, 0, 0, 3 * US_TO_SI.spring_disc, 0.25 * US_TO_SI.rot_spring_disc, 0, 1, 0.5]] },
  SI_INPUT_TABLES.set_springs);
  assert.deepStrictEqual(springs.springs[0], [1, 3, 0, 0, 0, 2, 0.5, 0, 0, 0], 'distributed spring');
  assert.deepStrictEqual(springs.springs[1], [2, 4, 0, 0, 0, 3, 0.25, 0, 1, 0.5], 'discrete spring, ys ratio kept');

  const corners = convertInputSI({ outer_corners: [[63.5, 0], [0, 0], [0, 203.2]], t: 1.4986 },
    SI_INPUT_TABLES.set_custom_section);
  assert.deepStrictEqual(corners.outer_corners, [[2.5, 0], [0, 0], [0, 8]]);

  // 4) 출력: 중첩 · 한계상태 · steps · 무차원 · 모르는 키 보고
  const r = {
    Pn: 10, design_strength: 8.5, utilization: 0.9, pass: null, governing_check: 'E3',
    limit_states: [{ name: 'Bearing', Rn: 5, design_strength: 3, phi: 0.6, omega: 2.5, direction: 'shear' }],
    interaction_checks: [
      { name: "Bolt tension with F'nt (App. A J3.4)", value: 0.5, limit: 13.25, ratio: 0.0377 },
      { name: 'J4.5.3', value: 0.19, limit: 0.65, ratio: 0.29 }],
    detailing_checks: [{ provided: 1.5, required: 0.75 }],
    positive_region: { Mn: 71.16, Lb: 30, Cb: 1.1 },
    Fcre_detail: { Sf: 1.9, J: 0.001, Cw: 7.5, sigma_ey: 62 },
    steps: [{ step: 1, value: 40.22, unit: 'kips', formula: 'Py = Ag×Fy = 40.22 kips' },
      { step: 2, value: 0.97, unit: '' }],
    conditions: [{ id: '(a)', value: 8 }],
    mystery_number: 3.2,
    report: 'text',
  };
  const { value: o, unconverted } = convertOutputSIDeep(r, SI_OUT_MEMBER);
  assert(rel(o.Pn, 10 * kipkN) < 1e-15 && rel(o.design_strength, 8.5 * kipkN) < 1e-15, 'force keys');
  assert.strictEqual(o.utilization, 0.9); assert.strictEqual(o.pass, null);
  assert(rel(o.limit_states[0].Rn, 5 * kipkN) < 1e-15, 'limit_states[].Rn converted (R8-04)');
  assert.strictEqual(o.limit_states[0].phi, 0.6);
  assert(rel(o.interaction_checks[0].limit, 13.25 * kipkN) < 1e-15, "bolt F'nt check in kN");
  assert.strictEqual(o.interaction_checks[1].value, 0.19, 'dimensionless interaction sum kept');
  assert(rel(o.detailing_checks[0].provided, 1.5 * 25.4) < 1e-15, 'detailing distances in mm');
  assert(rel(o.positive_region.Mn, 71.16 * kipkN * 0.0254) < 1e-15, 'nested positive_region.Mn');
  assert(rel(o.positive_region.Lb, 30 * 25.4) < 1e-15 && o.positive_region.Cb === 1.1);
  assert(rel(o.Fcre_detail.Sf, 1.9 * 25.4 ** 3) < 1e-15 && rel(o.Fcre_detail.Cw, 7.5 * 25.4 ** 6) < 1e-15);
  assert(rel(o.steps[0].value, 40.22 * kipkN) < 1e-15 && o.steps[0].unit === 'kN', 'step value+unit');
  assert.strictEqual(o.steps[0].formula_units, 'US', 'formula text labelled US');
  assert.strictEqual(o.steps[1].value, 0.97, 'dimensionless step kept');
  assert.deepStrictEqual(o.conditions, [{ id: '(a)', value: 8, units: 'US' }], 'US-labelled table kept + marked');
  assert.deepStrictEqual(unconverted, ['mystery_number'], 'unknown numeric keys are reported, not guessed');

  // 하중 해석: 같은 키 이름(Mu)이 kip-ft — 부재 설계(kip-in)와 표가 다르다
  const { value: lo } = convertOutputSIDeep({ gravity: { locations: [{ Mu: 10, Vu: 2, x_ft: 12.5 }] },
    auto_params: { negative_regions: [{ Ly_in: 41, Cb: 1.74, M_max_abs: 8.2 }] },
    input_loads_plf: { D: 25, Lr: 100 } }, SI_OUT_LOADS);
  assert(rel(lo.gravity.locations[0].Mu, 10 * kipkN * 0.3048) < 1e-15, 'loads Mu kip-ft → kN-m');
  assert(rel(lo.gravity.locations[0].x_ft, 12.5 * 0.3048) < 1e-15, 'x ft → m');
  assert(rel(lo.auto_params.negative_regions[0].Ly_in, 41 * 25.4) < 1e-15, 'Ly in → mm');
  assert(rel(lo.input_loads_plf.Lr, 100 * lbfN / 1000 / 0.3048) < 1e-15, 'plf → kN/m');

  // DSM: crl 의 단위는 family 를 따른다(R8-01)
  const { value: dg } = convertOutputSIDeep({ Mxx: { crl: 87.25, Lcrl: 5.9, LF_local: 0.91 }, fy_used: 50 },
    SI_OUT_GET_DSM);
  assert(rel(dg.Mxx.crl, 87.25 * kipkN * 0.0254) < 1e-15, 'Mxx crl in kN-m');
  assert(rel(dg.fy_used, 50 * expect.stress) < 1e-15 && dg.Mxx.LF_local === 0.91);
  const { value: dp } = convertOutputSIDeep({ P: { crl: 6.9 } }, SI_OUT_GET_DSM);
  assert(rel(dp.P.crl, 6.9 * kipkN) < 1e-15, 'P crl in kN');

  // 5) 입력 표 ↔ 무차원 목록이 겹치지 않는다
  for (const [tool, list] of Object.entries(SI_INPUT_DIMENSIONLESS)) {
    for (const k of list) {
      assert(!(SI_INPUT_TABLES[tool] && k in SI_INPUT_TABLES[tool]), `${tool}.${k} both dimensional and dimensionless`);
    }
  }

  // 6) server.ts tripwire
  const serverTs = readUtf8(path.join('src', 'mcp', 'server.ts'));
  assert(!/const (SI_TO_US|US_TO_SI)\b/.test(serverTs), 'conversion constants live in siUnits.ts');
  assert(serverTs.includes('from "./siUnits"'), 'server.ts imports siUnits');
  // 설명 글(따옴표 · 백틱 문자열)과 주석을 빼고 코드만 본다 — 설명은 프로그램 기본 강재를 밝힐 수 있다.
  const code = serverTs
    .replace(/`(?:[^`\\]|\\.)*`/gs, '``')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/\/\/.*$/gm, '');
  for (const bad of ['35.53', '58.02', '|| 1,', 'D || 1', 'Fuf ||', '?? 1.0', 'rho ??', '|| 5.0',
    '?? 12', '?? 2.5', 'KtLt ?? KyLy', '|| 0,', '?? 0,']) {
    assert(!code.includes(bad), `server.ts code must not contain '${bad}' (invented input)`);
  }
  assert(!/(\|\||\?\?)\s*(245|400|414|827|60|120|29500)\b/.test(code), 'no invented material defaults');
  assert(!serverTs.includes("'localhost'") && !serverTs.includes('http://localhost'), 'R8-29: 127.0.0.1 only');

  console.log('si_units_roundtrip: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
