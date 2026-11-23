// W2 (2026-11-22, V4 뒤 개정): MCP 도구 → 실제 브리지 → 실제 StcfsdPanel.handleMcpAction → 실제 Python 서버 의
// 종단 계약 시험.
//
// 무엇을 덮나
//   - 실제 MCP 서버 소스(src/mcp/server.ts · siUnits.ts 를 transpile)를 MCP SDK 클라이언트로 stdio 로 부른다.
//   - 실제 브리지(src/mcp/bridge.ts 의 McpBridgeServer, 127.0.0.1).
//   - 실제 패널: W3 의 test/webview/panel_harness.js 가 src/webview/StcfsdPanel.ts 를 가짜 vscode 로 불러오고
//     진짜 PythonBridge(.venv)를 붙인다. US/SI 비교 · 퍼린 · 보고서 · 검증은 모두 이 패널을 지난다.
//   - 패널 대역(echo)은 §4 「지어낸 입력 없음」 에만 쓴다 — 도구가 브리지에 보낸 본문 자체를 보는 검사라
//     패널의 상태 변화가 필요 없고, 실제 패널로 하면 단면 · 응력이 바뀌어 다음 검사의 상태가 흐려진다.
// 무엇을 덮지 않나
//   - VS Code 안의 웹뷰 렌더 · 확장 활성화(extension.ts) · 등록 파일 쓰기 · 미리보기 PNG 왕복.
//
// 검사
//   1. 도구 62 개의 이름이 공개 계약과 같다(K4a: get_view · focus · get_design_check 를 더했다).
//   2. units 를 받는 도구의 수치 인자는 모두 SI 입력 표나 무차원 목록에 있다(중첩 포함).
//   3. 인자 이름 = 파이썬 이름(엔진 서명 · _KNOWN_KEYS · design_member 의 params.get 키).
//   3b. 호스트 ↔ 스키마(V4-05): StcfsdPanel.handleMcpAction 의 각 action 이 받는 인자를 소스에서 뽑아,
//       (a) 호스트가 받는데 그 action 으로 보내는 어느 도구도 내놓지 않는 인자, (b) 도구가 보내는데 호스트가
//       받지 않는(조용히 버려질) 인자가 있으면 실패. 의도한 제외는 아래 HOST_ONLY 에 까닭과 함께.
//   4. 지어낸 입력 없음: 최소 인자로 부른 도구가 보낸 본문에 호출자가 주지 않은 값이 없다(echo 대역).
//   5. 브리지 보안(R8-09).
//   6. 응답: load_project / save_project / preview 실패는 isError(실제 패널).
//   7. 같은 물리 부재를 US 와 SI 로(실제 패널): 브리지 본문이 비트 단위로 같고, SI 결과의 모든 수치 = US × 정의 계수
//      또는 무차원 그대로, 모르는 수치 키 없음, 판정 같음, 핵심 키는 기대 단위로 확인.
//   8. design_purlin: MCP 결과 = 같은 인자로 패널 함수를 직접 부른 결과(GUI 와 같은 길), 웹 크리플링 평가됨(V4-05),
//      SI 묶음 응답 전체 변환(V4-16). generate_report · validate_design 도 같은 비교.
//   9. K4a 검토 항목 계약(design_checks): 7 · 8 의 모든 비교에서 design_checks 안의 물리량 {value, quantity} 마다
//      SI = US × 그 quantity 의 정의 계수(무차원 · 각도 · 개수는 그대로), rounded_to 는 그 값의 단위로, ratio · factor ·
//      digits 는 그대로. quantity 어휘는 엔진 표(python/design/checks.py QUANTITIES)와 siUnits 의 표가 같고, 어휘의 모든
//      종류가 한 번 이상 지난다(실제 엔진 출력에 없는 종류는 같은 변환기에 합성 항목으로). 모르는 quantity 는 si_unconverted
//      로 드러난다(조용히 지나가지 않는다). 퍼린 구간: 검토 지점마다의 design_checks · 위치(x) · 조합.
//  10. K4a 3a 응답 크기: 설계 도구의 기본 응답은 요약(detail summary) — 판정 · 지배 검토 · 검토마다 한 줄 · 경고 · 가정 ·
//      범위 · 미평가가 전체 결과와 같고, US/SI 비교는 full · checks · summary 세 수준에서. 예산: 단일 부재 · 접합 · 랩
//      요약 ≤ 12 KB, 38 구간 퍼린 요약 ≤ 40 KB, get_design_check ≤ 20 KB(그 항목 = 전체 결과의 항목, 계산 과정 포함),
//      지워진 결과에는 get_design_check 가 오류(장부의 까닭)로 답한다.
// Python 환경이 없으면(.venv 없음 — CI 의 ts 작업) 3 · 6 · 7 · 8 을 건너뛰고 그렇게 출력한다.
// STCFSD_REQUIRE_PY=1 이면 건너뛰지 않고 실패한다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const cp = require('child_process');
const process = require('process');

const ROOT = path.resolve(__dirname, '..', '..');
const { Client } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'index.js'));
const { StdioClientTransport } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'stdio.js'));
const harness = require('./panel_harness.js');

// 정의값 계수 (이 시험 안에서 따로 계산 — siUnits.ts 를 베끼지 않음)
const KIP = 0.45359237 * 9.80665;             // kN per kip
const F = {
  length: 25.4, area: 645.16, modulus: 25.4 ** 3, inertia: 25.4 ** 4, warping: 25.4 ** 6,
  force: KIP, stress: KIP * 1000 / 645.16, moment: KIP * 0.0254, moment_ft: KIP * 0.3048,
  length_ft: 0.3048, linload: KIP / 1000 / 0.3048, density: KIP * 1000 / 0.0254 ** 4,
  rot_stiff: KIP, lat_stiff: KIP / 0.0254 ** 2, spring_disc: KIP / 0.0254, pressure: KIP / 1000 / 0.3048 ** 2,
};
const FACTORS = Object.values(F);

const PUBLIC_TOOLS = ['add_element', 'add_node', 'aisi_design_combined', 'aisi_design_compression', 'focus', 'get_view',
  'get_case_inputs', 'set_case_inputs', 'run_case_check',
  'get_design_check',
  // R1-2: 기록 도구 일곱(이름으로만 — 경로 없음)
  'get_case_status', 'list_projects', 'open_project', 'list_cases', 'open_case', 'new_case', 'save_case', 'list_changes',
  // R3-2: 업무 항목 · 가정 · 원자료
  'work_items', 'assumptions', 'sources',
  // R4: 확인 표시(읽기) · 대안
  'get_reviews', 'alternatives',
  // R5: 문서(목록 · 점검 · 초안)
  'documents',
  'aisi_design_connection', 'aisi_design_flexure', 'aisi_design_guide', 'aisi_design_tension',
  'analyze_loads', 'build_section', 'calc_deck_stiffness', 'check_block_shear', 'check_lap_length',
  'check_shear_lag', 'classify_modes', 'cold_work', 'custom_section_guide', 'delete_element', 'delete_node',
  'design_connection', 'design_lap_connection', 'design_purlin', 'double_mesh', 'flange_curling',
  'generate_report', 'get_buckling_curve', 'get_cutwp', 'get_dsm_values', 'get_elements',
  'get_energy_recovery', 'get_full_state', 'get_nodes', 'get_section_preview', 'get_section_properties',
  'get_status', 'get_web_crippling', 'load_project', 'modify_element', 'modify_node', 'run_analysis',
  'run_plastic_surface', 'run_signature_curve', 'run_vibration', 'save_project', 'set_boundary_condition',
  'set_constraints', 'set_custom_section', 'set_elements', 'set_gbtcon', 'set_lengths', 'set_load_case',
  'set_material', 'set_node_stress', 'set_nodes', 'set_section_template', 'set_springs', 'set_stress',
  'steel_grades', 'validate_design'];

// 브리지 action → 그 action 으로 보내는 MCP 도구
const ACTION_TOOLS = {
  generate_template: ['set_section_template', 'set_custom_section', 'build_section'],
  set_material: ['set_material'], set_bc: ['set_boundary_condition'], set_lengths: ['set_lengths'],
  set_load_case: ['set_load_case'], set_stress: ['set_stress'], run_analysis: ['run_analysis'],
  get_dsm: ['get_dsm_values'], classify: ['classify_modes'], vibration: ['run_vibration'],
  plastic: ['run_plastic_surface'],
  aisi_design: ['aisi_design_compression', 'aisi_design_flexure', 'aisi_design_combined', 'aisi_design_tension',
    'aisi_design_connection'],
  aisi_guide: ['aisi_design_guide'], analyze_loads: ['analyze_loads'], generate_report: ['generate_report'],
  validate_design: ['validate_design'], design_purlin: ['design_purlin'], save_project: ['save_project'],
  load_project: ['load_project'], set_node_stress: ['set_node_stress'], set_springs: ['set_springs'],
  set_constraints: ['set_constraints'], set_nodes: ['set_nodes'], set_elements: ['set_elements'],
  add_node: ['add_node'], add_element: ['add_element'], modify_node: ['modify_node'], delete_node: ['delete_node'],
  modify_element: ['modify_element'], delete_element: ['delete_element'], energy_recovery: ['get_energy_recovery'],
  set_gbtcon: ['set_gbtcon'], web_crippling: ['get_web_crippling'], calc_deck_stiffness: ['calc_deck_stiffness'],
  check_lap_length: ['check_lap_length'], shear_lag: ['check_shear_lag'], block_shear: ['check_block_shear'],
  cold_work: ['cold_work'], flange_curling: ['flange_curling'], steel_grades: ['steel_grades'],
  lap_connection: ['design_lap_connection'], design_connection: ['design_connection', 'aisi_design_connection'],
  get_view: ['get_view'], focus: ['focus'], get_design_check: ['get_design_check'],
};

// 호스트는 받지만 MCP 도구가 일부러 내놓지 않는 인자 — 까닭과 함께(검사 3b-a 의 예외)
const HOST_ONLY = {
  generate_template: { section_type: '도구 이름 · type 인자가 정한다', params: '도구 인자 전체가 params 로 간다' },
  classify: { GBTcon: '설정은 set_gbtcon 으로 모델에 둔다' },
  prepare_design_dsm: { '*': 'GUI 전용 action — 패널이 설계 때 스스로 준비한다' },
  apply_deck_springs: { '*': 'GUI 전용 action — MCP 는 set_springs' },
  // K3: 도구의 units 는 서버가 report_units 로 넘긴다(설계 도구의 units 와 달리 값을 바꾸지 않고 보고서 · 항목의 글을 그 단위로)
  generate_report: { report_units: '도구의 units 를 서버가 이 이름으로 넘긴다' },
  validate_design: { report_units: '도구의 units 를 서버가 이 이름으로 넘긴다' },
  aisi_design: {
    member_type: '도구가 정한다', props: '호스트가 현재 단면에서 채운다', dsm: '호스트가 현재 해석에서 채운다',
    section: '호스트가 템플릿 치수에서 채운다', section_type: '호스트가 모델 형식으로 채운다(MCP 덮어쓰기 없음)',
    through_fastened: '호스트가 모델 스프링에서 정한다', query_type: 'aisi_design_guide 의 인자',
    H: 'props 가 없을 때만 쓰는 엔진 내부 템플릿 치수', B: '같음', D: '같음', t: '같음', r: '같음', qlip: '같음',
    n_f: 'section 기하(호스트)', n_le: '같음', n_w: '같음', hat_lip_depth: '같음',
    top_width: 'props 가 없을 때만 쓰는 hat 템플릿 치수(호스트는 늘 props 를 보냄)', depth: '같음', brim: '같음',
    OD: 'props 가 없을 때만 쓰는 CHS 템플릿 치수',
    distortional_not_applicable: '호스트 퍼린 랩 구간 전용 내부 플래그', _auto_error: '엔진 내부',
  },
  design_connection: { member_type: '도구가 정한다', props: '접합에 쓰지 않음', dsm: '같음', section: '같음' },
  report_view: { '*': '화면이 자기 보기를 알리는 길(K4a view contract) — AI 도구가 아니다(AI 는 get_view 로 읽는다)' },
};

function transpile(outDir) {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  fs.mkdirSync(outDir, { recursive: true });
  // K1: server.ts · bridge.ts 가 hostConnection · portFile 을 import 한다
  void ts;
  require('./mcp_transpile.js').transpileMcp(outDir, ['server', 'siUnits', 'bridge', 'hostConnection', 'portFile']);
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// ------------------------------------------------------------------ 호스트 인자 뽑기 (StcfsdPanel.ts 소스)
function hostAcceptedParams(engineKeys) {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'StcfsdPanel.ts'), 'utf8');
  const block = (from) => {
    const i = src.indexOf(from);
    if (i < 0) { return ''; }
    let d = 0; let k = src.indexOf('{', i);
    for (; k < src.length; k++) { if (src[k] === '{') { d++; } else if (src[k] === '}') { d--; if (d === 0) { break; } } }
    return src.slice(i, k);
  };
  const strList = (txt) => [...txt.matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)].map((m) => m[1]);
  const staticList = (name) => {
    const m = src.match(new RegExp(`static readonly ${name}[^=]*= \\[([\\s\\S]*?)\\];`));
    return m ? strList(m[1]) : [];
  };
  const kwAllow = {};
  const kwBlock = src.match(/static readonly KW_ALLOWLISTS[^=]*= \{([\s\S]*?)\n {4}\};/);
  assert(kwBlock, 'KW_ALLOWLISTS not found in StcfsdPanel.ts');
  for (const m of kwBlock[1].matchAll(/(\w+): \[([\s\S]*?)\]/g)) { kwAllow[m[1]] = strList(m[2]); }
  const keysIn = (txt) => new Set([...txt.matchAll(/\b(?:options|input)\??\.(\w+)/g)].map((m) => m[1])
    .concat([...txt.matchAll(/for \(const k of \[([^\]]*)\]\)[^{]*\{[^}]*options\[k\]/g)].flatMap((m) => strList(m[1])))
    .concat([...txt.matchAll(/StcfsdPanel\.([A-Z_]+)/g)].filter((m) => m[1] !== 'KW_ALLOWLISTS').flatMap((m) => staticList(m[1]))));
  const helperKeys = {
    _designMember: keysIn(block('private async _designMember(')),
    _analyzeLoads: keysIn(block('private async _analyzeLoads(')),
    _designPurlin: new Set([...keysIn(block('private async _designPurlin(')), ...keysIn(block('private async _analyzeLoads('))]),
  };
  const handler = block('public async handleMcpAction(');
  const parts = handler.split(/\n\s*case '([a-z_]+)':/);
  const out = {};
  for (let i = 1; i < parts.length; i += 2) {
    const action = parts[i];
    const body = parts[i + 1].split(/\n\s*default:/)[0];
    const keys = keysIn(body);
    for (const [h, ks] of Object.entries(helperKeys)) {
      if (new RegExp(`this\\.${h}\\(`).test(body)) { ks.forEach((k) => keys.add(k)); }
    }
    const kw = body.match(/_kwParams\((?:'(\w+)'|action)/);
    if (kw) { (kwAllow[kw[1] || action] || []).forEach((k) => keys.add(k)); }
    if (/_dictParams\(|_designMember\(/.test(body) && engineKeys[action]) { engineKeys[action].forEach((k) => keys.add(k)); }
    keys.delete('action');
    keys.delete('units');
    out[action] = keys;
  }
  // 'shear_lag' · 'block_shear' · 'cold_work' 는 'flange_curling' case 와 몸체를 함께 쓴다
  for (const a of ['shear_lag', 'block_shear', 'cold_work']) {
    if (out[a] && out[a].size === 0) { (kwAllow[a] || []).forEach((k) => out[a].add(k)); }
  }
  return { out, kwAllow };
}

// ------------------------------------------------------------------ 패널 대역 (§4 전용)
function makeEchoPanel() {
  const posted = [];
  return {
    posted,
    getStatus() { return { ok: true, echo: true }; },
    async handleMcpAction(body) {
      posted.push(JSON.parse(JSON.stringify(body)));
      const { action, ...opts } = body;
      if (action === 'load_project') { throw new Error(`ENOENT: no such file '${opts.filepath}'`); }
      if (action === 'capture_section_preview') { return { error: 'Capture timeout' }; }
      return { success: true, echo: opts };
    },
  };
}

// ------------------------------------------------------------------ 비교 도우미
function leaves(o, p = '', out = new Map()) {
  if (Array.isArray(o)) { o.forEach((v, i) => leaves(v, `${p}[${i}]`, out)); }
  else if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) { leaves(v, p ? `${p}.${k}` : k, out); } }
  else { out.set(p, o); }
  return out;
}
function at(o, p) {
  return p.split(/\.|\[(\d+)\]/).filter((x) => x !== undefined && x !== '').reduce((a, k) => (a == null ? a : a[k]), o);
}

const IGNORE_TOP = new Set(['units', 'text_units', 'units_note', 'report', 'timestamp']);
/** displayTol(p) → SI 표시 반올림의 허용(그 칸이 표시 값이면) — 그때는 SI = 바꾼 US 표시 값 ± 그 반올림 */
const TEXT_SI = { n: 0 };
function comparePhysical(tool, us, siR, spot, displayTol = () => null) {
  assert(!us.error, `${tool} US errored: ${us.error}`);
  assert.strictEqual(siR.units, 'SI', `${tool} SI result labelled`);
  assert.strictEqual(siR.text_units, 'US', `${tool} SI text labelled US`);
  assert(!siR.si_unconverted, `${tool}: ${siR.si_unconverted && siR.si_unconverted.length} numeric keys with no unit in the table: ${JSON.stringify((siR.si_unconverted || []).slice(0, 40))}`);
  // K2-5: case_* 는 검토 상태의 기록(판 · 쓴 키 · 바꾼 사람 값)이라 호출 차례에 따라 다르다 — 물리량 비교에서 뺀다
  const noCase = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('case_'))) : o);
  const lu = leaves(noCase(us));
  const ls = leaves(noCase(siR));
  let converted = 0;
  for (const [p, v] of lu) {
    const top = p.split(/[.[]/)[0];
    if (IGNORE_TOP.has(top) && (p === top || top === 'timestamp')) { continue; }
    if (/(^|\.)report$/.test(p) && typeof v === 'string') { continue; }
    assert(ls.has(p), `${tool}: SI result lost ${p}`);
    const s = ls.get(p);
    if (typeof v === 'number') {
      if (v === 0) { assert.strictEqual(s, 0, `${tool}: ${p} 0 → ${s}`); continue; }
      const ratio = s / v;
      const tolD = displayTol(p);
      const ok = Math.abs(ratio - 1) < 1e-12 || FACTORS.some((f) => Math.abs(ratio / f - 1) < 1e-12)
        || (tolD !== null && [1, ...FACTORS].some((f) => Math.abs(s - v * f) <= tolD));
      assert(ok, `${tool}: ${p} US ${v} → SI ${s} (ratio ${ratio} is not 1 or a unit factor)`);
      if (Math.abs(ratio - 1) >= 1e-12) { converted++; }
    } else if (/\.unit$/.test(p) || /\.formula_units$/.test(p) || /\.units$/.test(p)) {
      continue;
    } else if (/\.(unit_text|fmt|sep|value_unit_text)$/.test(p)) {
      // K4b: 알림 매개변수 · §I6.2.1 조건의 단위 글자는 SI 글자로(값은 위에서 물리량으로 맞댄다)
      continue;
    } else if (/params\[\d+\]\.text$/.test(p) && at(siR, p.replace(/\.text$/, '.const')) === true) {
      // K4d: 상수 매개변수(템플릿의 치수)의 글은 그 값의 SI 글 — 값은 위에서 물리량으로 맞댄다
      assert(/^-?\d/.test(String(s)), `${tool}: ${p} const text in SI is a number: ${JSON.stringify(s)}`);
      continue;
    } else if (typeof v === 'string' && typeof s === 'string' && s !== v) {
      // K4b: 알림 · 이유 · 이름표 글은 SI 로 다시 그렸다 — US 글에 US 단위의 수가 있었고, SI 글에는 남지 않는다
      // (US 글에 단위 없이 쓴 물리량 — 예 「fy = 50」 — 은 SI 에서 단위를 붙인다: 계약 §16.3)
      assert(/\d\s?(in\b|in\.|in[²³⁴⁶]|ksi|kips?\b|kip-in|kip-ft|ft\b|psf|plf)/.test(v) || /\d\s?(mm|mm[²³⁴⁶]|MPa|kN|kN-m|kN\/m|kPa|m)(?![A-Za-z])/.test(s), `${tool}: ${p} changed although it had no US number (${JSON.stringify(v)} → ${JSON.stringify(s)})`);
      assert(!/\d\s?(ksi|kips?\b|kip-in|kip-ft|psf\b|plf\b|in[²³⁴⁶])/.test(s), `${tool}: ${p} still has a US number in SI: ${JSON.stringify(s)}`);
      TEXT_SI.n++;
      continue;
    } else {
      assert.deepStrictEqual(s, v, `${tool}: ${p} changed (${JSON.stringify(v)} → ${JSON.stringify(s)})`);
    }
  }
  for (const [p, unit] of Object.entries(spot)) {
    const u = at(us, p);
    const s = at(siR, p);
    assert(typeof u === 'number' && Number.isFinite(u) && u !== 0, `${tool}: spot ${p} missing in US result (${u})`);
    const f = unit === 'none' ? 1 : F[unit];
    assert(Math.abs(s / (u * f) - 1) < 1e-12, `${tool}: ${p} expected ${unit}: US ${u} SI ${s}`);
  }
  assert.deepStrictEqual(siR.pass, us.pass, `${tool}: verdict changed with units`);
  return converted;
}

// ------------------------------------------------------------------ K4a: design_checks 의 물리량
// 엔진의 quantity 어휘(python/design/checks.py QUANTITIES 의 US 단위 글) → 이 시험의 정의 계수(F) 이름. 'none' = 그대로.
const ENGINE_UNIT_F = {
  'kip': 'force', 'kip-in': 'moment', 'ksi': 'stress', 'in': 'length', 'in^2': 'area', 'in^3': 'modulus',
  'in^4': 'inertia', 'in^6': 'warping', 'kip/in': 'spring_disc', 'kip-in/rad/in': 'rot_stiff', '-': 'none', 'deg': 'none',
  'kip*s^2/in^4': 'density', 'psf': 'pressure',
};
/** 엔진 소스에서 읽은 quantity → F 이름 (main 에서 채운다) */
const QUNIT = {};
function engineQuantities() {
  const src = fs.readFileSync(path.join(ROOT, 'python', 'design', 'checks.py'), 'utf8');
  const m = src.match(/^QUANTITIES = \{([\s\S]*?)\n\}/m);
  assert(m, 'design.checks.QUANTITIES not found');
  const out = {};
  for (const x of m[1].matchAll(/'([a-z_]+)':\s*'([^']*)'/g)) { out[x[1]] = x[2]; }
  assert(Object.keys(out).length >= 10, 'QUANTITIES parsed');
  return out;
}
const qFactor = (q) => {
  assert(Object.prototype.hasOwnProperty.call(QUNIT, q), `quantity '${q}' is not in the engine vocabulary`);
  return QUNIT[q] === 'none' ? 1 : F[QUNIT[q]];
};
const sameScaled = (us, si, f) => (us === 0 ? si === 0 : Math.abs(si / (us * f) - 1) < 1e-12);
// quantity 가 붙지 않은 design_checks 안의 수: 키 → 계수 이름('none' = 그대로). 그 밖의 수가 나오면 실패한다.
const DC_PLAIN = { ratio: 'none', digits: 'none', step: 'none', Cb: 'none', span: 'none', support: 'none', region_support: 'none', Lb: 'length' };

/**
 * US · SI 결과의 모든 design_checks 를 맞댄다: {value, quantity} 의 value = US × qFactor(quantity),
 * rounded_to 는 그 값(quantity 객체 안) 또는 그 단계 결과의 단위로, factor.value · ratio · digits 는 그대로.
 * seen 에 지난 quantity 를 센다. 돌려주는 값: 맞댄 수의 개수.
 */
function checkDesignChecks(tool, us, si, seen) {
  let n = 0;
  let lists = 0;
  const leaf = (p, u, s, f) => {
    assert(typeof s === 'number', `${tool}: ${p} lost in SI`);
    assert(sameScaled(u, s, f), `${tool}: ${p} US ${u} → SI ${s} (expected × ${f})`);
    n++;
  };
  const dc = (u, s, p, ctxQ, inFactor) => {
    if (Array.isArray(u)) { u.forEach((x, i) => dc(x, s[i], `${p}[${i}]`, ctxQ, inFactor)); return; }
    if (!u || typeof u !== 'object') { return; }
    const isQ = typeof u.quantity === 'string' && 'value' in u;
    const q = isQ ? u.quantity : ctxQ;
    if (isQ && typeof u.value === 'number') {
      leaf(`${p}.value`, u.value, s.value, qFactor(u.quantity));
      seen.set(u.quantity, (seen.get(u.quantity) || 0) + 1);
    }
    for (const [k, v] of Object.entries(u)) {
      const kp = `${p}.${k}`;
      if (isQ && k === 'value') { continue; }
      if (typeof v === 'number') {
        if (k === 'rounded_to') {
          const rq = isQ || ctxQ ? q : (u.result && u.result.quantity);
          assert(typeof rq === 'string', `${tool}: ${kp} has no quantity to scale with`);
          leaf(kp, v, s[k], qFactor(rq));
        } else if (k === 'value' && inFactor) {
          leaf(kp, v, s[k], 1);
        } else {
          assert(Object.prototype.hasOwnProperty.call(DC_PLAIN, k), `${tool}: ${kp} = ${v} is a number in design_checks with no quantity and no rule`);
          leaf(kp, v, s[k], DC_PLAIN[k] === 'none' ? 1 : F[DC_PLAIN[k]]);
        }
      } else if (v && typeof v === 'object') {
        assert(s && s[k] !== undefined, `${tool}: ${kp} lost in SI`);
        dc(v, s[k], kp, isQ ? u.quantity : ctxQ, k === 'factor');
      }
    }
  };
  const find = (u, s, p) => {
    if (Array.isArray(u)) { u.forEach((x, i) => find(x, s && s[i], `${p}[${i}]`)); return; }
    if (!u || typeof u !== 'object') { return; }
    for (const [k, v] of Object.entries(u)) {
      const kp = p ? `${p}.${k}` : k;
      if (k === 'design_checks' && Array.isArray(v)) {
        assert(s && Array.isArray(s[k]) && s[k].length === v.length, `${tool}: ${kp} differs in SI`);
        lists++;
        dc(v, s[k], kp, null, false);
      } else if (v && typeof v === 'object') { find(v, s && s[k], kp); }
    }
  };
  find(us, si, '');
  return { n, lists };
}

// ------------------------------------------------------------------ K4a 3a: 응답의 모양
const DESIGN_SHAPED = new Set(['aisi_design_compression', 'aisi_design_flexure', 'aisi_design_combined', 'aisi_design_tension',
  'aisi_design_connection', 'design_connection', 'design_lap_connection', 'design_purlin']);
const DATA_SHAPED = new Set(['analyze_loads', 'run_plastic_surface', 'run_vibration']);
const KB = 1024;
const NOTICES = ['warnings', 'assumptions', 'scope_notes', 'not_evaluated', 'not_checked', 'force_model', 'dsm_warning', 'host_warnings'];
const NOTICES_JS = require(path.join(ROOT, 'webview', 'js', 'notices.js'));
const stepless = (c) => { const { steps: _s, ...x } = c; void _s; return x; };

// V6-02 · V5c-01 · V6-10 · V6-13: 요약 ⊇ 전체 — 이 시험이 따로 모은다(서버의 모으는 함수를 쓰지 않는다).
const NOTICE_KEYS_T = new Set(['warnings', 'assumptions', 'scope_notes', 'not_evaluated', 'not_checked', 'not_evaluated_relevant',
  'host_warnings', 'dsm_warnings', 'dsm_warning', 'load_not_evaluated']);
/** 전체 결과 어디에 있든 알림 글(검토 항목 · 계산 과정 · 보고서 글 안은 빼고 — 항목은 아래 id 로 본다). */
function noticeTexts(o, out = new Set()) {
  if (Array.isArray(o)) { o.forEach((x) => noticeTexts(x, out)); return out; }
  if (!o || typeof o !== 'object') { return out; }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'design_checks' || k === 'steps' || k === 'report') { continue; }
    if (NOTICE_KEYS_T.has(k) && (Array.isArray(v) || typeof v === 'string')) {
      // K4b: 알림 항목 {code, text} 는 그 글로(notices_elsewhere 는 한 단계로 편다)
      for (const t of (Array.isArray(v) ? v : [v])) { if (t !== null && t !== undefined && t !== '') { out.add(JSON.stringify(t && typeof t === 'object' && typeof t.text === 'string' ? t.text : t)); } }
    } else { noticeTexts(v, out); }
  }
  return out;
}
/** 판정에 드는 불합격 · 미평가, 그리고 지배인 검토 id — 결과 어디의 design_checks 에서든. */
function namedCheckIds(o, out = new Set()) {
  if (Array.isArray(o)) { o.forEach((x) => namedCheckIds(x, out)); return out; }
  if (!o || typeof o !== 'object') { return out; }
  if (typeof o.id === 'string' && typeof o.verdict === 'string'
    && (o.verdict === 'fail' || (o.verdict === 'not_evaluated' && o.counts !== false) || o.governs === true)) { out.add(o.id); }
  Object.values(o).forEach((v) => namedCheckIds(v, out));
  return out;
}
function checkComplete(tag, s, full) {
  const text = JSON.stringify(s);
  const missN = [...noticeTexts(full)].filter((t) => !text.includes(t));
  assert.deepStrictEqual(missN.map((t) => t.slice(0, 140)), [], `${tag}: every notice text of the full result is in the reply`);
  const missI = [...namedCheckIds(full)].filter((id) => !text.includes(JSON.stringify(id)));
  assert.deepStrictEqual(missI, [], `${tag}: every failing / not-evaluated / governing check id is named`);
}

/** 요약 · 검토 목록 수준이 판정의 뜻을 바꾸지 않는다: 판정 · 지배 · 검토 줄 · 알림 · 반올림 안내가 전체 결과와 같다. */
function checkDesignSummary(tag, level, s, fullRaw) {
  // K4b: 요약 · 검토 목록은 사람 · AI 가 읽는 꼴 — 알림 · 이유는 한국어(code 와 함께), 영어 이름은 빼고 name_ko. 전체 결과를 같은 함수로
  // 그 꼴로 바꾼 것과 맞댄다(webview/js/notices.js forReader — 호스트가 쓰는 것)
  const full = NOTICES_JS.forReader(fullRaw, { units: 'US', detail: level });
  if (Array.isArray(full.regions)) { return checkPurlinSummary(tag, level, s, full); }
  assert.strictEqual(s.detail, level, `${tag}: detail echoed`);
  assert.deepStrictEqual(s.pass, full.pass, `${tag}: verdict`);
  checkComplete(tag, s, full);
  for (const k of NOTICES) {
    if (!(k in full)) { continue; }
    if (k === 'force_model' && level === 'summary' && full.force_model && full.force_model.description_code) {
      // 결과마다 같은 고정 글은 요약에서 code + 한 줄 제목(글 전체는 detail 'checks') — 나머지 칸은 그대로
      const f = full.force_model, g = s.force_model;
      assert(g && g.description && g.description.code === f.description_code && typeof g.description.title === 'string' && g.description.title.length < 120,
        `${tag}: force_model.description as code + title`);
      assert.deepStrictEqual((g.known_limitations || []).map((x) => x.code), f.known_limitations_codes, `${tag}: known limitations by code`);
      assert((g.known_limitations || []).every((x) => typeof x.title === 'string' && x.title.length < 80), `${tag}: one-line titles`);
      for (const kk of ['basis', 'clause', 'clause_code', 'specification_provision', 'user_decision_pending']) {
        assert.deepStrictEqual(g[kk], f[kk], `${tag}: force_model.${kk} kept`);
      }
      assert(/force_model\.description \/ known_limitations text/.test(s.more) && /detail:'checks'/.test(s.more), `${tag}: more says where the force model text is`);
      continue;
    }
    assert.deepStrictEqual(s[k], full[k], `${tag} keeps ${k} in full`);
  }
  if (full.display_rounding) { assert.strictEqual(s.display_rounding.note, full.display_rounding.note, `${tag}: display rounding note`); }
  assert(/get_design_check/.test(s.more) && /detail:'full'/.test(s.more), `${tag}: more says where the rest is`);
  const dc = Array.isArray(full.design_checks) ? full.design_checks : [];
  assert.deepStrictEqual(s.governing_checks.map((c) => c.id), dc.filter((c) => c.governs).map((c) => c.id), `${tag}: governing checks`);
  for (const g of s.governing_checks) {
    const f = dc.find((c) => c.id === g.id);
    for (const k of ['clause', 'name', 'name_ko', 'ratio', 'verdict', 'location', 'combination', 'governs_basis']) {
      assert.deepStrictEqual(g[k] ?? null, f[k] ?? null, `${tag}: governing ${g.id}.${k}`);
    }
    // 계약 §9.5: 미평가가 지배하면 참고 비 · 평가한 최대를 따로, 머리 판정비 주의를 단다
    if (f.governs_basis === 'not_evaluated') {
      assert.deepStrictEqual([g.reference_ratio, g.highest_evaluated], [f.reference && f.reference.ratio !== undefined ? f.reference.ratio : null,
        f.highest_evaluated ?? null], `${tag}: governing ${g.id} not evaluated — reference ratio and highest evaluated given apart`);
      assert(new RegExp(g.id.replace(/\./g, '\\.')).test(s.utilization_caveat || ''), `${tag}: utilization caveat names ${g.id}`);
    }
    if (f.out_of_scope) { assert.strictEqual(g.out_of_scope, f.out_of_scope, `${tag}: out_of_scope`); }
    if (f.ratio_form) { assert.strictEqual(g.ratio_form, f.ratio_form, `${tag}: ratio_form`); }
    for (const k of ['demand', 'capacity']) { assert.deepStrictEqual(g[k] && g[k].value, f[k] ? f[k].value : null, `${tag}: governing ${g.id}.${k}`); }
  }
  if (level === 'summary') {
    assert.deepStrictEqual(s.check_lines.map((c) => [c.id, c.ratio, c.verdict, c.governs === true, c.reason ?? null]),
      dc.map((c) => [c.id, c.ratio ?? null, c.verdict, c.governs === true, (c.governs === true ? null : c.reason) || null]), `${tag}: one line per check (a governing check's reason is in its head)`);
    for (const g of s.governing_checks) { const f = dc.find((c) => c.id === g.id); assert.strictEqual(g.reason ?? null, f.reason || null, `${tag}: governing ${g.id} reason in the head`); }
    assert(!('design_checks' in s), `${tag}: no full items in the summary`);
  } else {
    assert.deepStrictEqual(s.design_checks, dc.map(stepless), `${tag}: every item without steps`);
  }
  if (full.fastener_design) {
    const fd = s.fastener_design;
    assert.deepStrictEqual(fd.pass, full.fastener_design.pass, `${tag}: fastener verdict`);
    for (const k of NOTICES) { if (k in full.fastener_design) { assert.deepStrictEqual(fd[k], full.fastener_design[k], `${tag}.fastener_design keeps ${k}`); } }
    // V6-10: 패스너 줄은 모두 남는다 — 위 목록으로 옮겨 실린 id(part_of fastener_design)만 거기서 한 번
    const moved = new Set(dc.filter((c) => c.part_of === 'fastener_design').map((c) => c.id));
    const fdIds = (level === 'summary' ? fd.check_lines : fd.design_checks).map((c) => c.id);
    assert.deepStrictEqual([...fdIds, ...moved].sort(), [...new Set([...full.fastener_design.design_checks.map((c) => c.id), ...moved])].sort(),
      `${tag}: every fastener check is listed once (moved ones in the lap lines)`);
    assert.deepStrictEqual([...(fd.moved_to_top || [])].sort(), [...moved].sort(), `${tag}: moved_to_top names exactly the moved ids`);
  }
}

// 엔진 e42adf1: 요약은 표시 값 — 하중 해석 기록의 반올림 전 값(unrounded · *_unrounded)은 빼고, 구간 줄의 수는 display_rounding 의 규칙.
// 요약은 그 규칙으로 바꾼 full 과 맞댄다(같은 것끼리); checks · full 은 반올림 전 값 그대로.
const stripUnrounded = (v) => (Array.isArray(v) ? v.map(stripUnrounded) : (v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'unrounded' && !/_unrounded$/.test(k)).map(([k, x]) => [k, stripUnrounded(x)])) : v));
const roundTo = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? (Math.round(v * 10 ** d) / 10 ** d) || 0 : v);
function i621Compact(i) {
  if (!i || typeof i !== 'object' || !Array.isArray(i.conditions)) { return i; }
  const { checks: _c, conditions, ...rest } = i; void _c;
  return { ...rest, conditions: conditions.map((c) => (c && typeof c === 'object' ? { id: c.id, status: c.status, ...(c.value !== undefined ? { value: c.value } : {}),
    ...(c.limits ? { limits: c.limits } : {}), ...(c.value_unit_text ? { unit: c.value_unit_text } : {}), ...(c.value_as_length ? { value_as_length: c.value_as_length } : {}) } : c)) };
}
function checkPurlinSummary(tag, level, s, full) {
  assert.strictEqual(s.detail, level, `${tag}: detail echoed`);
  assert.deepStrictEqual(s.pass, full.pass, `${tag}: verdict`);
  checkComplete(tag, s, full);
  assert.deepStrictEqual(s.governing, full.governing, `${tag}: governing region`);
  const disp = level === 'summary';
  for (const k of ['warnings', 'assumptions', 'not_evaluated', 'load_not_evaluated', 'wc_reactions', 'uplift_reactions', 'i621_check']) {
    const want = k === 'i621_check' && disp ? i621Compact(stripUnrounded(full[k])) : (disp ? stripUnrounded(full[k]) : full[k]);
    assert.deepStrictEqual(s[k], want, `${tag} keeps ${k}`);
  }
  // K4b: 요약의 §I6.2.1 은 조건마다 id · 판정 · 값 · 한계(이름표 목록 checks 와 이름표 글은 detail 'checks')
  if (disp) {
    assert(!/"unrounded"|_unrounded"/.test(JSON.stringify(s)), `${tag}: the summary carries display values only (no unrounded sub-objects)`);
    assert(/display values/.test(s.more) && /detail:'checks'/.test(s.more), `${tag}: more says the values are display-rounded and where the exact ones are`);
  }
  assert.strictEqual(s.regions.length, full.regions.length, `${tag}: one line per region`);
  s.regions.forEach((line, i) => {
    const g = full.regions[i];
    const r4 = (x) => (disp ? roundTo(x, 4) : x);
    assert.deepStrictEqual([line.id, line.kind, line.start_ft, line.end_ft, line.ratio, line.pass, line.check_point],
      [g.id, g.kind, r4(g.start_ft), r4(g.end_ft), g.result.utilization ?? null, g.result.pass ?? null, g.result.check_point ?? null], `${tag}: region ${g.id}`);
    if (disp) {
      assert.deepStrictEqual([line.Mu, line.Vu, line.Ly_in, line.Cb], [roundTo(g.Mu, 3), roundTo(g.Vu, 3), roundTo(g.Ly_in, 1), roundTo(g.Cb, 2)], `${tag}: region ${g.id} display values`);
    }
    const fails = new Set(g.result.checks.flatMap((pt) => pt.design_checks.filter((c) => c.verdict === 'fail').map((c) => c.id)));
    assert.deepStrictEqual(new Set(line.failing), fails, `${tag}: region ${g.id} failing ids`);
    const govs = new Set(g.result.checks.flatMap((pt) => pt.design_checks.filter((c) => c.governs === true).map((c) => c.id)));
    assert.deepStrictEqual(new Set(line.governs), govs, `${tag}: region ${g.id} governing ids (all check points)`);
    if (level === 'checks') { assert.strictEqual(line.checks.length, g.result.checks.length, `${tag}: region ${g.id} check points`); }
  });
  const gov = full.regions.find((g) => g.id === (full.governing || {}).id);
  if (gov) { assert.deepStrictEqual(s.governing_checks.map((c) => c.id), gov.result.design_checks.filter((c) => c.governs).map((c) => c.id), `${tag}: governing checks of the governing region`); }
  assert(/get_design_check/.test(s.more) && /detail:'full'/.test(s.more), `${tag}: more`);
}

/**
 * V6-08 · V6-09 · V6-12 · V6-13: 퍼린 검토 지점의 소요 · 조합 · 지점/경간 번호를 하중 해석의 격자에서 따로 맞댄다.
 * 구간이 검토하는 플랜지의 부호(정모멘트 · 양력 지점부 = +, 부모멘트 · 랩 · 양력 하부압축 = −)의 포락선 값과 같아야 하고,
 * 조합 이름은 그 지배 조합 도표의 그 점 값이 쓴 값과 같을 때만(또는 그 자리의 이름 붙은 위치의 조합), 아니면 'envelope'.
 * 돌려주는 값: {points, envelope, labelled}
 */
function checkPurlinStations(tag, full) {
  const la = full.load_analysis;
  const supportsFt = la.spans_ft.reduce((a, L) => [...a, a[a.length - 1] + L], [0]);
  const lab = (combo, pattern) => {
    const parts = pattern && typeof pattern === 'object' ? Object.entries(pattern).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') : v}`) : [];
    return parts.length ? `${combo} [${parts.join('; ')}]` : combo;
  };
  const near = (a, b) => Math.abs(a - b) <= 6e-5 + 1e-9 * Math.max(Math.abs(a), Math.abs(b));
  const tally = { points: 0, envelope: 0, labelled: 0 };
  for (const g of full.regions) {
    const env = /^uplift/.test(g.kind) ? la.uplift : la.gravity;
    const sign = g.kind === 'positive' || g.kind === 'uplift_support' ? 1 : -1;
    const share = g.members === 2 ? 0.5 : 1;
    for (const c of g.result.checks) {
      const at = `${tag} ${g.id} ${c.check_point}`;
      const x = c.location.x.value / 12;
      let i = 0;
      env.x_diagram.forEach((xx, k) => { if (Math.abs(xx - x) < Math.abs(env.x_diagram[i] - x)) { i = k; } });
      const M = c.Mu / 12 / share;
      const V = c.Vu === null ? null : c.Vu / share;
      const envM = sign > 0 ? Math.max(0, env.M_envelope_max[i]) : Math.max(0, -env.M_envelope_min[i]);
      let envV = Math.max(Math.abs(env.V_envelope_max[i]), Math.abs(env.V_envelope_min[i]));
      // V6b-01: 지점 위의 검토 지점은 격자(한쪽 면)가 아니라 하중 해석의 지점 면 전단(Vu_left · Vu_right) — 지점이 구간 안이면 큰 면,
      // 구간이 그 지점에서 끝나면 그 구간 쪽 면. 이 시험이 위치 항목에서 따로 고른다(면 값은 소수 3자리 — 그만큼의 허용).
      const kSup = supportsFt.findIndex((xs) => Math.abs(xs - x) <= 1e-6 * Math.max(1, Math.abs(x)));
      const faceLoc = kSup >= 0 ? env.locations.find((l) => l.support === kSup + 1 && Number.isFinite(l.Vu_left) && Number.isFinite(l.Vu_right)) : null;
      let face = null;
      if (faceLoc) {
        // 엔진 65e5ed6: 반올림하지 않은 면 값 · 면마다의 출처
        const vl = Math.abs(faceLoc.Vu_left_unrounded), vr = Math.abs(faceLoc.Vu_right_unrounded);
        const side = x <= g.start_ft + 1e-6 ? 'right' : (x >= g.end_ft - 1e-6 ? 'left' : (vl >= vr ? 'left' : 'right'));
        face = { side, V: side === 'left' ? vl : vr, larger: Math.max(vl, vr), combo: (() => { const sx = side === 'left' ? faceLoc.V_left_source : faceLoc.V_right_source; return lab(env.combos[sx[0]], env.envelope_source.patterns[sx[1]]); })() };
        envV = face.V;
        if (V !== null) {
          assert(Math.abs(V - face.V) <= 1e-9 * Math.max(1, face.V), `${at}: V ${V} on support ${kSup + 1} = the ${side} face ${face.V} of the load analysis — V6b-01`);
          tally.faces = (tally.faces || 0) + 1;
          if (face.V + 1e-9 < face.larger) { tally.ownFaceSmaller = (tally.ownFaceSmaller || 0) + 1; }
        }
      }
      if (c.check_point === 'M_max' || c.check_point === 'V_max') {
        assert(near(M, envM), `${at}: M ${M} kip-ft is the ${sign > 0 ? '+' : '−'}M envelope at x = ${env.x_diagram[i]} ft (${envM}) — V6-09`);
        if (c.check_point === 'V_max') { assert(faceLoc ? Math.abs(V - envV) <= 1e-9 * Math.max(1, envV) : near(V, envV), `${at}: V ${V} = |V| envelope ${envV}`); }
      }
      // K3-6(계약 §6.1 · 6.2): 조합 꼬리표는 하중 해석의 envelope_source(이 시험이 따로 푼다) · 위치 항목의 combo / combo_V / combo_R 에서.
      // 출처가 하나면 그 조합, 다르면 'M: … | V: …' + 그 지점의 가정 한 줄(소요는 그대로)
      tally.points++;
      const srcAt = (key, idx) => {
        const run = (env.envelope_source[key] || []).find((r) => idx >= r[0] && idx < r[0] + r[1]);
        return run ? lab(env.combos[run[2]], env.envelope_source.patterns[run[3]]) : null;
      };
      const loc = /^support /.test(c.check_point) ? env.locations.find((l) => Math.abs(l.x_ft - x) < 1e-6 && l.R_bearing !== undefined) : null;
      const mSrc = loc && Number.isFinite(loc.Mu) ? lab(loc.combo, loc.pattern) : srcAt(sign > 0 ? 'M_max' : 'M_min', i);
      const vSrc = V === null ? null : (face ? (face.combo ?? 'FACE?')
        : srcAt(Math.abs(env.V_envelope_max[i]) >= Math.abs(env.V_envelope_min[i]) ? 'V_max' : 'V_min', i));
      const rSrc = loc ? lab(loc.combo_R, loc.pattern_R) : null;
      const others = [['V', vSrc], ['P', rSrc]].filter(([, s]) => s && s !== mSrc);
      if (env.envelope_source && mSrc) {
        if (others.length === 0) {
          assert.strictEqual(c.combination, mSrc, `${at}: one source → that combination`);
          assert.strictEqual(c.location.demand_basis, 'combination', `${at}: demand_basis`);
          assert(!(c.assumptions || []).some((a) => /서로 다른 조합/.test(a)), `${at}: no mixed-pair line`);
          tally.labelled++;
        } else {
          const want = [`M: ${mSrc}`, ...others.map(([k, s]) => `${k}: ${s}`)].join(' | ');
          if (vSrc === 'FACE?') {
            // 작은 면의 조합은 하중 해석이 주지 않는다 — 꼬리표가 그렇게 밝힌다
            assert(c.combination.startsWith(`M: ${mSrc} | V: envelope (지점 ${kSup + 1} `) && /조합을 주지 않음/.test(c.combination), `${at}: face combination unknown — ${c.combination}`);
            tally.faceUnknown = (tally.faceUnknown || 0) + 1;
          } else { assert.strictEqual(c.combination, want, `${at}: mixed label`); }
          assert.strictEqual(c.location.demand_basis, 'envelope', `${at}: mixed demand_basis`);
          const line = (c.assumptions || []).filter((a) => /서로 다른 조합의 포락값/.test(a));
          assert.strictEqual(line.length, 1, `${at}: exactly one mixed-pair assumption`);
          assert(line[0].includes(mSrc) && others.every(([, s]) => s === 'FACE?' || line[0].includes(s)), `${at}: the line names the combinations`);
          tally.mixed = (tally.mixed || 0) + 1;
        }
        assert.notStrictEqual(c.combination, 'envelope', `${at}: envelope_source gives the combination`);
      } else if (c.combination === 'envelope') { tally.envelope++; assert.strictEqual(c.location.demand_basis, 'envelope', `${at}: demand_basis`); }
      else {
        tally.labelled++;
        const mLab = Math.max(0, sign * env.M_diagram[i]);
        const viaDiagram = c.combination === lab(env.combo, env.pattern) && near(mLab, M) && (V === null || near(Math.abs(env.V_diagram[i]), V));
        const viaLocation = /^support /.test(c.check_point) && env.locations.some((l) => Math.abs(l.x_ft - x) < 1e-6
          && Number.isFinite(l.Mu) && near(Math.abs(l.Mu), M) && c.combination === lab(l.combo, l.pattern));
        assert(viaDiagram || viaLocation, `${at}: combination '${c.combination}' did not produce M ${M} / V ${V} here — V6-08`);
      }
      // 지점 · 경간 번호(1 부터) — V6-12
      const k = supportsFt.findIndex((xs) => Math.abs(xs - x) <= 1e-6);
      if (k >= 0) { assert.deepStrictEqual([c.location.support, c.location.span], [k + 1, null], `${at}: at support ${k + 1}`); }
      else {
        const sp = supportsFt.findIndex((xs, q) => q + 1 < supportsFt.length && x > xs && x < supportsFt[q + 1]) + 1;
        assert.deepStrictEqual([c.location.support, c.location.span], [null, sp], `${at}: in span ${sp}`);
      }
      const m = /^support (\d+)$/.exec(c.check_point);
      if (m) { assert.strictEqual(c.location.support, Number(m[1]), `${at}: support check point numbering`); }
    }
  }
  return tally;
}

/**
 * 서버의 응답 모양 함수(SHAPERS · unitReply)만 꺼내 쓴다 — server.ts 는 불러오면 stdio 서버가 뜨므로 그 토막을 옮겨 돌린다.
 * 엔진만으로 만든 계약 사례 전부(MCP 로는 현재 단면 하나뿐이라 넓게 돌릴 수 없다)를 같은 함수로 줄여 본다.
 */
function loadShapers(si) {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp', 'server.ts'), 'utf8');
  const a = src.indexOf('type Detail = ');
  const b = src.indexOf('// 도구 인자: 응답의 모양');
  const ua = src.indexOf('function unitReply(');
  const ub = src.indexOf('async function postTool(');
  assert(a > 0 && b > a && ua > 0 && ub > ua, 'server.ts reply-shaping section markers');
  const js = ts.transpileModule(src.slice(a, b) + '\n' + src.slice(ua, ub),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const json = (r) => ({ content: [{ type: 'text', text: JSON.stringify(r) }] });
  return new Function('convertOutputSIDeep', 'TEXT_UNITS_NOTE', 'json', `${js}\nreturn { SHAPERS, unitReply };`)(
    si.convertOutputSIDeep, si.TEXT_UNITS_NOTE, json);
}

function toSIArgs(args, spec) {
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    const u = spec[k];
    if (u === undefined || v === null || typeof v === 'boolean' || typeof v === 'string') { out[k] = v; continue; }
    if (typeof u === 'object' && !Array.isArray(u)) {
      out[k] = Array.isArray(v) ? v.map((x) => (x ? toSIArgs(x, u) : x)) : toSIArgs(v, u);
    } else if (Array.isArray(v)) {
      out[k] = v.map((x) => x * F[u]);
    } else {
      out[k] = v * F[u];
    }
  }
  return out;
}

/** 경로 하나를 찾아 돌려준다(점검 키를 결과 모양에 덜 묶이게). */
function findPath(o, pred, p = '') {
  if (Array.isArray(o)) {
    for (let i = 0; i < o.length; i++) { const r = findPath(o[i], pred, `${p}[${i}]`); if (r) { return r; } }
  } else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      const q = p ? `${p}.${k}` : k;
      if (pred(k, v, o)) { return q; }
      const r = findPath(v, pred, q); if (r) { return r; }
    }
  }
  return null;
}

// ------------------------------------------------------------------ 시험 본체
async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-w2-'));
  const py = harness.pythonPath();
  if (!py && process.env.STCFSD_REQUIRE_PY === '1') { throw new Error('python .venv required (STCFSD_REQUIRE_PY=1)'); }
  let client = null;
  let bridge = null;
  let real = null;
  const results = [];
  try {
    transpile(tmp);
    const { McpBridgeServer, checkBridgeRequest } = require(path.join(tmp, 'bridge.js'));
    const si = require(path.join(tmp, 'siUnits.js'));
    const port = await freePort();
    const echo = makeEchoPanel();
    const recorded = [];
    let target = echo;
    const proxy = {
      getStatus: () => target.getStatus(),
      async handleMcpAction(body) {
        // K4b: MCP 서버는 응답 모양(__reply {units, detail})을 함께 싣는다 — 엔진 인자가 아니다(호스트가 뺀다). 기록하는 본문은 그것을 뺀 것
        const { __reply, ...rest } = body || {};
        assert(__reply && (__reply.units === 'US' || __reply.units === 'SI') && typeof __reply.detail === 'string', `every POST carries __reply: ${JSON.stringify(__reply)}`);
        recorded.push(JSON.parse(JSON.stringify(rest)));
        return target.handleMcpAction(body);
      },
    };
    bridge = new McpBridgeServer(() => proxy, port);
    await bridge.start();

    // 5. 브리지 보안 ------------------------------------------------------------
    const raw = (opts, body) => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, ...opts }, (res) => {
        let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
      });
      req.on('error', (e) => resolve({ status: -1, body: String(e) }));
      if (body) { req.write(body); }
      req.end();
    });
    let rr = await raw({ method: 'POST', path: '/action', headers: { 'Content-Type': 'text/plain' } }, '{"action":"save_project","filepath":"x"}');
    assert.strictEqual(rr.status, 415, 'text/plain POST rejected');
    rr = await raw({ method: 'POST', path: '/action', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' } }, '{"action":"get_nodes"}');
    assert.strictEqual(rr.status, 403, 'Origin header rejected');
    rr = await raw({ method: 'GET', path: '/status', headers: { Origin: 'null' } });
    assert.strictEqual(rr.status, 403, 'Origin on GET rejected');
    rr = await raw({ method: 'POST', path: '/action', headers: { 'Content-Type': 'application/json', Host: `evil.example:${port}` } }, '{"action":"get_nodes"}');
    assert.strictEqual(rr.status, 403, 'foreign Host rejected (DNS rebinding)');
    rr = await raw({ method: 'POST', path: '/action', headers: { 'Content-Type': 'application/json' } }, '{oops');
    assert.strictEqual(rr.status, 400, 'broken JSON rejected');
    assert.strictEqual(recorded.length, 0, 'rejected requests never reach the panel');
    rr = await raw({ method: 'GET', path: '/status' });
    assert.strictEqual(rr.status, 200, 'plain local GET /status accepted');
    assert(!('access-control-allow-origin' in rr.headers), 'no CORS allowance header');
    assert.strictEqual(checkBridgeRequest('POST', { host: `localhost:${port}`, 'content-type': 'application/json; charset=utf-8' }, port), null);

    // MCP 클라이언트 ------------------------------------------------------------
    const transport = new StdioClientTransport({
      command: process.execPath, args: [path.join(tmp, 'server.js')],
      env: { ...process.env, STCFSD_MCP_PORT: String(port), NODE_PATH: path.join(ROOT, 'node_modules') },
      stderr: 'pipe',
    });
    client = new Client({ name: 'stcfsd-w2-chain', version: '1.0.0' });
    await client.connect(transport);
    const call = async (name, args) => {
      recorded.length = 0;
      const r = await client.callTool({ name, arguments: args });
      const text = r.content[0].text;
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { isError: !!r.isError, data, body: recorded[0], bytes: require('buffer').Buffer.byteLength(text) };
    };

    // 1. 도구 이름 --------------------------------------------------------------
    const tools = (await client.listTools()).tools;
    assert.deepStrictEqual(tools.map((t) => t.name).sort(), [...PUBLIC_TOOLS].sort(), 'tool names are the public contract');
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    // units · detail 은 MCP 쪽 인자(단위 변환 · 응답 모양) — 호스트 · 엔진에 가지 않는다
    // R2-2: reason · work · source 는 쓰기 도구의 공용 인자 — 머리로 가고 엔진에 가지 않는다(set_case_inputs · focus 의 reason 은 그 도구의 인자)
    const props = (name) => Object.keys(byName[name].inputSchema.properties || {}).filter((k) => k !== 'units' && k !== 'detail' && k !== 'work' && k !== 'source' && !(k === 'reason' && name !== 'set_case_inputs' && name !== 'focus'));

    // 2. SI 입력 표 커버리지 ------------------------------------------------------
    const isNumeric = (s) => s && (s.type === 'number' || s.type === 'integer'
      || (s.type === 'array' && isNumeric(s.items))
      || (Array.isArray(s.anyOf) && s.anyOf.some(isNumeric)));
    function cover(tool, schema, table, dimless, prefix) {
      for (const [k, s] of Object.entries(schema.properties || {})) {
        const p = prefix ? `${prefix}.${k}` : k;
        const obj = s.type === 'object' ? s : (s.type === 'array' && s.items && s.items.type === 'object' ? s.items
          : (Array.isArray(s.anyOf) ? s.anyOf.find((x) => x.type === 'object') : null));
        const sub = table && table[k];
        if (obj && obj.properties) {
          if (sub && typeof sub === 'object' && !sub.columns) { cover(tool, obj, sub, dimless, p); continue; }
          const nums = Object.entries(obj.properties).filter(([, v]) => isNumeric(v)).map(([n]) => n);
          assert(nums.every((n) => dimless.includes(`${p}.${n}`)), `${tool}: nested numeric '${p}' has no SI table`);
          continue;
        }
        if (!isNumeric(s)) { continue; }
        assert((table && (k in table || '*' in table)) || dimless.includes(k) || dimless.includes(p),
          `${tool}: numeric argument '${p}' is neither in SI_INPUT_TABLES nor SI_INPUT_DIMENSIONLESS`);
      }
    }
    for (const t of tools) {
      if (!(t.inputSchema.properties || {}).units) { continue; }
      if (['get_section_properties', 'get_cutwp'].includes(t.name)) { continue; }
      const table = si.SI_INPUT_TABLES[t.name];
      assert(table, `${t.name} has units but no SI input table`);
      cover(t.name, t.inputSchema, table, (si.SI_INPUT_DIMENSIONLESS[t.name] || []).concat(['steps.step', 'nodes', 'node_ids']), '');
    }

    // 3. 엔진 인자 이름 (Python 필요) · 3b 의 엔진 dict 키 ------------------------------------
    const engineKeys = {};
    const aisiSrc = fs.readFileSync(path.join(ROOT, 'python', 'design', 'aisi_s100.py'), 'utf8');
    // 엔진 07caad7: Cmx · Cmy 는 _cm('Cmx', …) 안의 params.get(key) 로 읽는다 — 그 이름도 엔진이 읽는 키
    engineKeys.aisi_design = [...new Set([...aisiSrc.matchAll(/(?:params\.get|_cm)\('([A-Za-z_0-9]+)'/g)].map((m) => m[1]))];
    // 엔진 663771d: Fcre_basis 는 검토 항목을 짓는 곳(member_checks)이 ctx 의 params 에서 읽는다(검토 계약 §16.14)
    const memberChecksSrc = fs.readFileSync(path.join(ROOT, 'python', 'design', 'member_checks.py'), 'utf8');
    engineKeys.aisi_design.push(...[...memberChecksSrc.matchAll(/\(ctx\.get\('params'\) or \{\}\)\.get\('([A-Za-z_0-9]+)'\)/g)].map((m) => m[1]));
    const lapSrc = fs.readFileSync(path.join(ROOT, 'python', 'design', 'lap_connection.py'), 'utf8');
    engineKeys.lap_connection = [...new Set([...lapSrc.matchAll(/params\.get\('([A-Za-z_0-9]+)'/g)].map((m) => m[1])
      .concat(['Pnvs', 'Fub', 'bolt_grade', 'threads_excluded', 'mf', 'hole_type']))];
    // 엔진 17ad004: 랩 구속 진술은 aisi_s100.LAP_STATEMENT_KEYS(lap_restrained · 옛 이름 distortion_restrained)로 읽는다
    const lapStmt = aisiSrc.match(/^LAP_STATEMENT_KEYS = \(([^)]*)\)/m);
    const lapStmtKeys = lapStmt ? [...lapStmt[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
    engineKeys.aisi_design.push(...lapStmtKeys);
    engineKeys.lap_connection.push(...lapStmtKeys);
    engineKeys.aisi_guide = ['query_type'];
    // K4a: 엔진이 모든 설계 dict 에서 받는 꼬리표(design.checks.CONTEXT_KEYS — 접합은 _KNOWN_KEYS 밖에서 따로 받는다)
    const checksSrc = fs.readFileSync(path.join(ROOT, 'python', 'design', 'checks.py'), 'utf8');
    const ctxMatch = checksSrc.match(/^CONTEXT_KEYS = \(([^)]*)\)/m);
    assert(ctxMatch, 'design.checks.CONTEXT_KEYS not found');
    const contextKeys = [...ctxMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual(contextKeys.sort(), ['check_combination', 'check_location'], 'engine context keys');
    engineKeys.aisi_design.push(...contextKeys);
    engineKeys.lap_connection.push(...contextKeys);
    let sigs = null;
    if (py) {
      sigs = JSON.parse(cp.execFileSync(py, ['-c', [
        'import sys, json, inspect',
        `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'python'))})`,
        'from design import shear, special_topics as st, connections as c',
        'from design.loads import required_strength as rs',
        'from design.lap_connection import check_lap_length',
        'f = {"get_web_crippling": shear.web_crippling, "analyze_loads": rs.analyze_loads, "check_shear_lag": st.shear_lag,',
        '     "check_block_shear": st.block_shear, "cold_work": st.cold_work_strength, "flange_curling": st.flange_curling,',
        '     "check_lap_length": check_lap_length}',
        'out = {k: list(inspect.signature(v).parameters) for k, v in f.items()}',
        'out["_connection"] = sorted(c._KNOWN_KEYS)',
        'print(json.dumps(out))'].join('\n')], { encoding: 'utf8' }));
      engineKeys.design_connection = [...sigs._connection, ...contextKeys];
      for (const [tool, names] of Object.entries(sigs)) {
        if (tool.startsWith('_')) { continue; }
        // analyze_loads 의 Fy · Fu 는 호스트가 모델에서 section 을 만들 때만 쓰는 호스트 인자(엔진에 직접 가지 않음)
        const hostArgs = tool === 'analyze_loads' ? ['Fy', 'Fu'] : [];
        for (const k of props(tool)) { assert(names.includes(k) || hostArgs.includes(k), `${tool}.${k} is not a parameter of the engine function`); }
      }
      for (const tool of ['aisi_design_connection', 'design_connection']) {
        for (const k of props(tool)) { assert(engineKeys.design_connection.includes(k), `${tool}.${k} is not a design_connection key`); }
      }
    }
    for (const tool of ['aisi_design_compression', 'aisi_design_flexure', 'aisi_design_combined', 'aisi_design_tension']) {
      for (const k of props(tool)) { assert(engineKeys.aisi_design.includes(k), `${tool}.${k} is not read by design_member`); }
    }
    for (const k of props('design_lap_connection')) { assert(engineKeys.lap_connection.includes(k), `design_lap_connection.${k}`); }

    // 3b. 호스트 ↔ 스키마 (V4-05) --------------------------------------------------
    const { out: host } = hostAcceptedParams(engineKeys);
    const gaps = [];
    for (const [action, accepted] of Object.entries(host)) {
      const toolsFor = ACTION_TOOLS[action];
      const skip = HOST_ONLY[action] || {};
      if (!toolsFor) {
        if (skip['*']) { continue; }
        // 상태 조회 action(get_nodes 등)은 인자가 없다
        if (accepted.size > 0) { gaps.push(`host action '${action}' accepts ${[...accepted]} but no MCP tool posts it`); }
        continue;
      }
      const offered = new Set(toolsFor.flatMap(props));
      if (action === 'generate_template') { continue; } // params 의 키는 템플릿 세 도구가 각각 내놓음(§4 에서 본문 확인)
      for (const k of accepted) {
        if (offered.has(k) || skip[k]) { continue; }
        if (action === 'aisi_design' && engineKeys.design_connection && engineKeys.design_connection.includes(k)
          && offered.has(k)) { continue; }
        // design_member 의 params.get 키 가운데 접합 디스패처로만 가는 키(connection)는 aisi_design_connection 이 내놓는다
        gaps.push(`host action '${action}' accepts '${k}' but no MCP tool (${toolsFor.join(', ')}) offers it`);
      }
      // (b) 도구가 보내는데 호스트가 받지 않는 인자 → 조용히 버려짐
      // generate_report · validate_design: 도구의 units 는 report_units 로 간다(서버가 이름을 바꾼다 — 위 HOST_ONLY)
      const dictLike = ['aisi_design', 'design_connection', 'lap_connection', 'aisi_guide', 'generate_report', 'validate_design'].includes(action);
      if (!dictLike) {
        for (const t of toolsFor) {
          for (const k of props(t)) {
            if (!accepted.has(k)) { gaps.push(`tool ${t} sends '${k}' but host action '${action}' does not read it (silently dropped)`); }
          }
        }
      }
    }

    assert.deepStrictEqual(gaps, [], `V4-05 host ↔ schema gaps:\n  ${gaps.join('\n  ')}`);

    // 4. 지어낸 입력 없음 (echo 대역) --------------------------------------------------
    const exact = async (tool, args, expected) => {
      const { body } = await call(tool, args);
      assert.deepStrictEqual(body, expected, `${tool}: posted body must contain only what the caller gave`);
    };
    await exact('get_dsm_values', { load_type: 'P' }, { action: 'get_dsm', load_type: 'P' });
    await exact('set_section_template', { type: 'lippedc', H: 8, B: 2.5, t: 0.059 },
      { action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, t: 0.059 } });
    await exact('set_section_template', { type: 'chs', OD: 152.4, t: 2.54, units: 'SI' },
      { action: 'generate_template', section_type: 'chs', params: { OD: 6, t: 0.1 } });
    await exact('set_section_template', { type: 'hat', top_width: 3, depth: 4.5, brim: 1.67, t: 0.135 },
      { action: 'generate_template', section_type: 'hat', params: { top_width: 3, depth: 4.5, brim: 1.67, t: 0.135 } });
    await exact('set_custom_section', { outer_corners: [[2.5, 0], [0, 0], [0, 8], [2.5, 8]], t: 0.059 },
      { action: 'generate_template', section_type: 'custom', params: { outer_corners: [[2.5, 0], [0, 0], [0, 8], [2.5, 8]], t: 0.059 } });
    await exact('aisi_design_compression', { Fy: 50, KxLx: 120, KyLy: 60 },
      { action: 'aisi_design', member_type: 'compression', Fy: 50, KxLx: 120, KyLy: 60 });
    await exact('aisi_design_flexure', { Fy: 50, Lb: 60 }, { action: 'aisi_design', member_type: 'flexure', Fy: 50, Lb: 60 });
    await exact('aisi_design_tension', { Fy: 50 }, { action: 'aisi_design', member_type: 'tension', Fy: 50 });
    await exact('aisi_design_connection', { connection_type: 'paf', Fy: 33, Fu: 45, t1: 0.036, t2: 0.25, n: 2 },
      { action: 'aisi_design', member_type: 'connection', connection_type: 'paf', Fy: 33, Fu: 45, t1: 0.036, t2: 0.25, n: 2 });
    await exact('design_connection', { connection_type: 'groove', Fy: 50, Fu: 65, t1: 0.12, t2: 0.12 },
      { action: 'design_connection', connection_type: 'groove', Fy: 50, Fu: 65, t1: 0.12, t2: 0.12 });
    // F6 · V4-29: t2 · n 는 형식에 따라 필수 — 지어내지 않고 보내기 전에 거절한다
    for (const [args, re] of [
      [{ connection_type: 'screw', Fy: 33, Fu: 45, t1: 0.036, n: 2 }, /t2 required/],
      [{ connection_type: 'screw', Fy: 33, Fu: 45, t1: 0.036, t2: 0.06 }, /n required/],
      [{ connection_type: 'bolt', Fy: 50, Fu: 65, t1: 0.059 }, /t2 and n required/],
    ]) {
      const x = await call('design_connection', args);
      assert(x.isError && re.test(x.data.error) && x.body === undefined, `missing t2/n refused before posting: ${JSON.stringify(x.data)}`);
    }
    await exact('design_connection', { connection_type: 'arc_spot', Fy: 33, Fu: 45, t1: 0.03, t_sheets: [0.03], n: 1, da: 0.75 },
      { action: 'design_connection', connection_type: 'arc_spot', Fy: 33, Fu: 45, t1: 0.03, t_sheets: [0.03], n: 1, da: 0.75 });
    await exact('get_web_crippling', { h: 7.5, t: 0.059, R: 0.1875, N: 3.5, Fy: 50 },
      { action: 'web_crippling', h: 7.5, t: 0.059, R: 0.1875, N: 3.5, Fy: 50 });
    await exact('analyze_loads', { member_app: 'roof-purlin', span_type: 'simple', span_ft: 25, loads: { D: 25 } },
      { action: 'analyze_loads', member_app: 'roof-purlin', span_type: 'simple', span_ft: 25, loads: { D: 25 } });
    const pb = (await call('design_purlin', { member_app: 'roof-purlin', span_type: 'simple', span_ft: 25, loads: { D: 25 },
      Fy: 50, wc_N: 3.5, wc_R: 0.1875, wc_fastened: 'fastened', use_cold_work: false })).body;
    assert.deepStrictEqual(pb, { action: 'design_purlin', member_app: 'roof-purlin', span_type: 'simple', span_ft: 25,
      loads: { D: 25 }, Fy: 50, wc_N: 3.5, wc_R: 0.1875, wc_fastened: 'fastened', use_cold_work: false },
    'V4-05: design_purlin passes the web-crippling and member options through');
    // V4-31: GUI 의 퍼린 본문이 싣는 0(「없음」)을 스키마가 거절하지 않는다
    const gui0 = (await call('design_purlin', { member_app: 'roof-purlin', span_type: 'simple', span_ft: 25, loads: { D: 25 },
      Fy: 50, wc_N: 0, wc_overhang: 0, wc_edge_distance: 0, wc_support_fastener_spacing: 0 })).body;
    assert(gui0 && gui0.wc_support_fastener_spacing === 0, 'V4-31: 0 for an optional "not given" field passes the schema');
    await exact('calc_deck_stiffness', { t_panel: 0.018, t_purlin: 0.059 },
      { action: 'calc_deck_stiffness', t_panel: 0.018, t_purlin: 0.059 });
    await exact('run_vibration', {}, { action: 'vibration' });
    await exact('run_vibration', { lengths: [254, 1270], confirm_large: true, units: 'SI' },
      { action: 'vibration', lengths: [10, 50], confirm_large: true });
    await exact('run_plastic_surface', { fy: 50 }, { action: 'plastic', fy: 50 });
    await exact('set_load_case', { load_case: 'compression' }, { action: 'set_load_case', load_case: 'compression' });
    await exact('validate_design', {}, { action: 'validate_design' });
    await exact('set_material', { E: 29500, v: 0.3 }, { action: 'set_material', E: 29500, v: 0.3 });
    await exact('run_analysis', {}, { action: 'run_analysis' });
    // K4a: 보기 도구 — 본문은 준 것뿐(단위 변환 없음)
    await exact('get_view', {}, { action: 'get_view' });
    await exact('focus', { item: { kind: 'check', scope: 'purlin', id: 'member.flexure.distortional',
      location: { region: 'negative-2', check_point: 'support 2' } }, reason: 'governs' },
    { action: 'focus', item: { kind: 'check', scope: 'purlin', id: 'member.flexure.distortional',
      location: { region: 'negative-2', check_point: 'support 2' } }, reason: 'governs' });
    const badFocus = await call('focus', { item: { kind: 'nonsense', id: 'x' } });
    assert(badFocus.isError && badFocus.body === undefined, 'focus item kind is checked by the schema');
    const missingFy = await call('aisi_design_compression', { KxLx: 120, KyLy: 60 });
    assert(missingFy.isError && missingFy.body === undefined, 'Fy is required by the schema (no 35.53)');

    // 9a. K4a quantity 어휘: 엔진 표 = siUnits 표, 계수 = 정의값(이 시험의 F) — 파이썬 없이 소스에서 ---------------
    const engineQ = engineQuantities();
    assert.deepStrictEqual(Object.keys(si.QUANTITY_UNITS).sort(), Object.keys(engineQ).sort(),
      'siUnits QUANTITY_UNITS covers exactly the engine quantity vocabulary (design.checks.QUANTITIES)');
    for (const [q, unitText] of Object.entries(engineQ)) {
      assert(Object.prototype.hasOwnProperty.call(ENGINE_UNIT_F, unitText), `engine unit '${unitText}' of quantity ${q} has no defined factor in this test`);
      QUNIT[q] = ENGINE_UNIT_F[unitText];
      const tsUnit = si.QUANTITY_UNITS[q];
      const tsFactor = tsUnit === 'none' ? 1 : si.US_TO_SI[tsUnit];
      assert(Math.abs(tsFactor / qFactor(q) - 1) < 1e-12, `quantity ${q} (${unitText}): siUnits factor ${tsFactor} ≠ defined ${qFactor(q)}`);
    }
    // 같은 변환기(SI_OUT_MEMBER)에 어휘의 모든 종류를 지나게 한다 — 실제 엔진 출력에 아직 없는 종류도(아래 9c 에 보고).
    const synth = { design_checks: Object.keys(engineQ).map((q, i) => ({
      id: `synthetic.${q}`, ratio: 0.5, factor: { symbol: 'φ', value: 0.9, kind: 'phi', source: { kind: 'specification' } },
      demand: { symbol: 'Q', value: 1.25 + i, quantity: q, source: { kind: 'user_input', key: 'Q' } },
      capacity: { symbol: 'Qc', value: 2.5 + i, quantity: q },
      reference: { capacity: { symbol: 'Qr', value: 3.5 + i, quantity: q }, ratio: 0.4 },
      location: { region: 'r', x: { symbol: 'x', value: 12.5, quantity: 'length' } },
      mirrors: { capacity: { path: 'Qc', digits: 3 } },
      steps: [{ kind: 'design_strength', expr: 'Qc = φ Q', equation: null, rounded_to: 0.001,
        inputs: [{ symbol: 'Q', value: 1.25 + i, quantity: q, source: { kind: 'step', step: 0, rounded_to: 0.01,
          half_wavelength: { symbol: 'L', value: 25, quantity: 'length' } } }],
        result: { symbol: 'Qc', value: 2.5 + i, quantity: q } }],
    })) };
    const synthOut = si.convertOutputSIDeep(JSON.parse(JSON.stringify(synth)), si.SI_OUT_MEMBER);
    assert.deepStrictEqual(synthOut.unconverted, [], `synthetic design_checks: ${JSON.stringify(synthOut.unconverted)}`);
    const SYNTH_SEEN = new Map();
    const synthCount = checkDesignChecks('synthetic design_checks', synth, synthOut.value, SYNTH_SEEN);
    assert.deepStrictEqual([...SYNTH_SEEN.keys()].sort(), Object.keys(engineQ).sort(), 'every quantity kind passes the converter');
    // 모르는 quantity: 값은 그대로 두고 si_unconverted 로 드러난다(조용히 지나가지 않는다).
    const bogus = si.convertOutputSIDeep({ design_checks: [{ id: 'x', ratio: 0.1,
      demand: { symbol: 'Q', value: 3, quantity: 'bogus_kind' } }] }, si.SI_OUT_MEMBER);
    assert.strictEqual(bogus.value.design_checks[0].demand.value, 3, 'unknown quantity: value left as the engine gave it');
    assert(bogus.unconverted.some((u) => /design_checks\[0\]\.demand\.value/.test(u) && /bogus_kind/.test(u)),
      `unknown quantity is reported: ${JSON.stringify(bogus.unconverted)}`);
    assert.throws(() => checkDesignChecks('bogus', { design_checks: [{ demand: { value: 3, quantity: 'bogus_kind' } }] },
      bogus.value, new Map()), /not in the engine vocabulary/, 'the comparison itself rejects an unknown quantity');
    // 입력(check_location)도 같은 규칙: SI 의 {value, quantity} → US (12.7 mm → 정확히 0.5 in), 나머지는 그대로.
    const inLoc = si.convertInputSI({ check_location: { member: 'P1', n: 3, x: { symbol: 'x', value: 12.7, quantity: 'length' } } },
      si.SI_INPUT_TABLES.aisi_design_flexure);
    assert.deepStrictEqual(inLoc.check_location, { member: 'P1', n: 3, x: { symbol: 'x', value: 0.5, quantity: 'length' } },
      'check_location {value, quantity} converted to US exactly, plain values untouched');
    results.push(`quantity vocabulary: ${Object.keys(engineQ).length} kinds = engine; synthetic pass ${synthCount.n} values; unknown quantity reported`);

    // ------------------------------------------------------------------ 실제 패널이 필요한 부분
    if (!py) {
      console.log('mcp_si_chain: PASS (schema, host↔schema, defaults, bridge) — SKIPPED the real-panel chain: no .venv python');
      return;
    }
    real = await harness.createPanel();
    assert(real, 'panel harness could not start');
    target = real.panel;

    // 6. 실패를 성공으로 바꾸지 않는다 ------------------------------------------------
    let r = await call('load_project', { filepath: path.join(tmp, 'does_not_exist.stcfsd') });
    assert(r.isError && /load_project failed/.test(r.data.error), 'R8-07: load_project failure is an error');
    r = await call('save_project', { filepath: 'relative.stcfsd' });
    assert(r.isError, 'save_project with a relative path is an error');
    r = await call('get_section_preview', {});
    assert(r.isError, 'R8-18: no webview answer → error, never an old image');

    // 단면 · 해석 (실제 패널 상태) ------------------------------------------------------
    const ok = async (tool, args) => { const x = await call(tool, args); assert(!x.isError, `${tool}: ${JSON.stringify(x.data).slice(0, 300)}`); return x.data; };
    await ok('set_section_template', { type: 'lippedc', H: 203.2, B: 63.5, D: 15.875, t: 1.4986, r: 4.7625, units: 'SI' });
    const nodesSI = (await ok('get_nodes', {})).nodes;
    await ok('set_section_template', { type: 'lippedc', H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1875 });
    const nodesUS = (await ok('get_nodes', {})).nodes;
    assert.deepStrictEqual(nodesSI, nodesUS, 'the same section in mm and in gives bit-identical nodes');
    await ok('set_material', { E: 29500, v: 0.3 });
    await ok('set_lengths', { min: 1, max: 1000, n: 25 });
    await ok('set_load_case', { load_case: 'compression', fy: 50 });
    await ok('run_analysis', { neigs: 6 });
    // K4a: 상태 · 보기 도구가 실제 패널에 닿는다(화면이 알린 것이 없으면 그렇게 말하고, 실패하지 않는다)
    const gs = await ok('get_status', {});
    assert(gs.section_template === 'lippedc' && gs.section_params.H === 8 && gs.neigs === 6 && gs.analysis_load_family === 'P'
      && Array.isArray(gs.element_roles) && gs.element_roles.length === gs.nelems && Array.isArray(gs.invalidated),
    `get_status K4a fields: ${JSON.stringify(gs).slice(0, 300)}`);
    const gv = await ok('get_view', {});
    assert(gv.current === null && Array.isArray(gv.screens), 'get_view with no screen report');
    const fo = await ok('focus', { item: { kind: 'model', id: 'section' }, reason: 'look' });
    assert(fo.screen_moved === null && typeof fo.note === 'string' && !/moved to/.test(fo.note), 'focus reply never claims the screen moved');

    // 7. US / SI (실제 패널) ----------------------------------------------------------
    // K4a 3a: 모양을 줄이는 도구는 full(전과 같은 내용) · checks · summary 세 수준을 모두 US/SI 로 맞댄다.
    const usVsSi = async (tool, usArgs, siSpec, spot, extra = {}) => {
      const levels = extra.levels || (DESIGN_SHAPED.has(tool) ? ['full', 'checks', 'summary'] : DATA_SHAPED.has(tool) ? ['full', 'summary'] : [undefined]);
      let full = null;
      for (const level of levels) {
        const lv = level ? { detail: level } : {};
        const tag = level ? `${tool}[${level}]` : tool;
        const a = await call(tool, { ...usArgs, ...lv });
        const b = await call(tool, { ...toSIArgs(usArgs, siSpec), units: 'SI', ...lv });
        assert(!a.isError, `${tag} US: ${JSON.stringify(a.data).slice(0, 400)}`);
        assert(!b.isError, `${tag} SI: ${JSON.stringify(b.data).slice(0, 400)}`);
        assert.deepStrictEqual(b.body, a.body, `${tag}: SI input must reach the panel as the identical US values (detail is not sent)`);
        // 퍼린 요약은 표시 값(US · SI 각자의 표시 자릿수) — 그 칸은 SI 표시 반올림 안에서 같은 값
        const SI_DEC = { start_ft: 4, end_ft: 4, x_M_max_ft: 4, Ly_in: 1, Cb: 2, Mu: 4, Vu: 3, Pu: 3, R_uplift: 3, x_ft: 4 };
        const displayTol = tool === 'design_purlin' && level === 'summary' ? (p) => {
          const m = /^(?:regions\[\d+\]\.(start_ft|end_ft|x_M_max_ft|Ly_in|Cb|Mu|Vu)|(?:wc_reactions|uplift_reactions)\[\d+\]\.(Pu|R_uplift|x_ft))$/.exec(p);
          const k = m && (m[1] || m[2]);
          return k ? 0.5 * 10 ** -SI_DEC[k] + 1e-9 : null;
        } : undefined;
        const n = comparePhysical(tag, a.data, b.data, level === undefined || level === 'full' ? spot : {}, displayTol);
        const dcs = checkDesignChecks(tag, a.data, b.data, QTY_SEEN);
        if (level === undefined || level === 'full') {
          if (extra.check) { extra.check(a.data, b.data); }
          full = [a.data, b.data];
        } else {
          SIZES.push({ tool: extra.label || tool, level, us: a.bytes, si: b.bytes });
          (extra.checkShaped || (DESIGN_SHAPED.has(tool) ? checkDesignSummary : () => {}))(tag, level, a.data, full[0]);
        }
        results.push(`${tag}: ${n} numeric fields converted, verdict ${JSON.stringify(a.data.pass)} = ${JSON.stringify(b.data.pass)}`
          + (dcs.lists ? `; design_checks ${dcs.lists} lists, ${dcs.n} values by quantity` : '') + (level && level !== 'full' ? `; ${a.bytes} B` : ''));
      }
      return full;
    };
    const L = 'length'; const S = 'stress'; const Fo = 'force'; const M = 'moment'; const A = 'area';
    const QTY_SEEN = new Map();
    const SIZES = [];
    const DC_SWEEP = { n: 0, max: 0 };
    /** 결과의 항목을 하나씩 get_design_check 로 — 그 항목(계산 과정 포함) 그대로, 20 KB 안, 하나는 SI 로 맞댄다. */
    const sweepChecks = async (scope, fullUS, location) => {
      // 랩: 위쪽 목록에 같은 id 로 옮겨 실은 접합 항목(part_of fastener_design)이 있으면 그것이 답이다 — 안쪽 것은 그 id 가 없을 때만.
      const top = fullUS.design_checks || [];
      const items = [...top, ...((fullUS.fastener_design || {}).design_checks || []).filter((c) => !top.some((t) => t.id === c.id))];
      assert(items.length > 0, `${scope}: items to fetch`);
      for (const item of items) {
        const args = { scope, id: item.id, ...(location ? { location } : {}) };
        const a = await call('get_design_check', args);
        assert(!a.isError, `get_design_check ${scope} ${item.id}: ${JSON.stringify(a.data).slice(0, 300)}`);
        // K4b: AI 가 읽는 꼴(이유는 한국어 + reason_code, 이름은 name_ko) — 같은 함수로 바꾼 항목과 같다
        assert.deepStrictEqual(a.data.check, NOTICES_JS.forReader(item, { units: 'US' }), `get_design_check ${scope} ${item.id}: the item of the current result, with its steps`);
        assert(a.data.current === true && a.bytes <= 20 * KB, `get_design_check ${scope} ${item.id}: ${a.bytes} B (budget 20 KB)`);
        DC_SWEEP.n++; DC_SWEEP.max = Math.max(DC_SWEEP.max, a.bytes);
      }
      const it = items.find((c) => Array.isArray(c.steps) && c.steps.length > 0) || items[0];
      const b = await call('get_design_check', { scope, id: it.id, ...(location ? { location } : {}), units: 'SI' });
      assert(!b.isError && b.data.units === 'SI', `get_design_check SI ${scope} ${it.id}`);
      checkDesignChecks(`get_design_check ${scope}`, { design_checks: [NOTICES_JS.forReader(it, { units: "US" })] }, { design_checks: [b.data.check] }, QTY_SEEN);
    };
    await usVsSi('aisi_design_compression', { Fy: 50, Fu: 65, KxLx: 120, KyLy: 60, KtLt: 60, Pu: 5 },
      { Fy: S, Fu: S, KxLx: L, KyLy: L, KtLt: L, Pu: Fo },
      { Pn: Fo, design_strength: Fo, Py: Fo, 'steps[0].value': Fo, utilization: 'none' },
      { check: (u, s) => { assert(s.report.startsWith('[UNITS'), 'report labelled US'); assert.strictEqual(s.steps[0].unit, 'kN'); } });
    const [tenUS] = await usVsSi('aisi_design_tension', { Fy: 50, Fu: 65, Tu: 10, An: 0.5 }, { Fy: S, Fu: S, Tu: Fo, An: A },
      { Tn: Fo, Tn_rupture: Fo, An_used: A, design_strength: Fo });
    const [dUS] = await usVsSi('get_dsm_values', { load_type: 'P', KxLx: 120, KyLy: 60, KtLt: 60 },
      { KxLx: L, KyLy: L, KtLt: L }, { 'P.crl': Fo, 'P.cre': Fo, 'P.Lcrl': L, fy_used: S });
    assert.strictEqual(dUS.fy_used, 50, 'R8-01: no fy sent → the panel uses the analysis fy');
    await usVsSi('get_section_properties', {}, {}, { A: A, Ixx: 'inertia', Sx: 'modulus', xcg: L, rx: L });
    await usVsSi('get_cutwp', {}, {}, { J: 'inertia', Cw: 'warping', Xs: L });
    await usVsSi('run_plastic_surface', { fy: 50, n_theta: 8, n_na: 5 }, { fy: S },
      { 'P_raw[0]': Fo, Py: Fo, M11_y: M, fy: S });
    const CONN = { Fy: S, Fu: S, Fub: S, t1: L, t2: L, d: L, e: L, s: L, g: L, width: L, Ag: A, Pu: Fo, Vu: Fo, Tu: Fo,
      weld_length: L, weld_size: L, da: L, Pnvs: Fo, Pnts: Fo, dw: L, Fuf: S, Pnov_bolt: Fo, R: L };
    const [boltUS, boltSI] = await usVsSi('aisi_design_connection', { connection_type: 'bolt', design_method: 'LRFD', Fy: 50, Fu: 65,
      t1: 0.059, t2: 0.059, d: 0.5, n: 2, e: 1.5, s: 1.5, Ag: 1.0, width: 4, g: 2, member_case: 'flat_sheet',
      Fub: 60, Vu: 2, Tu: 0.5, Pnov_bolt: 3 }, CONN,
    { design_strength: Fo, 'limit_states[0].Rn': Fo, 'detailing_checks[0].provided': L, 'demands.Vu': Fo,
      'shear_tension_interaction.Fnv': S });
    assert.strictEqual(boltSI.limit_states.length, boltUS.limit_states.length, 'R8-12: same limit states for d = 12.7 mm');
    await usVsSi('design_connection', { connection_type: 'screw', Fy: 33, Fu: 45, t1: 0.036, t2: 0.06, d: 0.19, n: 2,
      e: 1.0, s: 1.0, Pnvs: 1.0, Pnts: 1.2, dw: 0.4, Vu: 0.3, Tu: 0.1, member_case: 'flat_sheet', Ag: 0.2, width: 4 },
    CONN, { design_strength: Fo, 'limit_states[0].Rn': Fo });
    await usVsSi('design_connection', { connection_type: 'fillet_weld', Fy: 50, Fu: 65, t1: 0.105, t2: 0.06, n: 1,
      weld_length: 3, weld_size: 0.125, Vu: 2, load_direction: 'longitudinal', member_case: 'not_tension_member',
      j6_3_not_applicable: true }, CONN, { design_strength: Fo });
    const [pafUS] = await usVsSi('aisi_design_connection', { connection_type: 'paf', Fy: 33, Fu: 45, t1: 0.036, t2: 0.25, d: 0.145,
      n: 2, e: 1.0, s: 1.0, Vu: 0.3, Fuf: 260, dw: 0.5, member_case: 'flat_sheet', Ag: 0.2, width: 4 },
    CONN, { 'limit_states[0].Rn': Fo });
    const [lapUS] = await usVsSi('design_lap_connection', { d: 8, t: 0.059, Fy: 50, Fu: 65, lap_left_in: 24, lap_right_in: 24,
      Mu_support: 200, Vu_support: 2, fastener_type: 'bolt', fastener_dia: 0.5, n_rows: 2, Se: 1.0, Sf: 1.1,
      Mnd: 60, Vn: 8, end_distance: 1.5, Fub: 60 },
    { d: L, t: L, Fy: S, Fu: S, lap_left_in: L, lap_right_in: L, Mu_support: M, Vu_support: Fo, fastener_dia: L,
      Se: 'modulus', Sf: 'modulus', Mnd: M, Vn: Fo, end_distance: L, Fub: S },
    { Pns: Fo, V_transfer: Fo, Mn_lap: M, spacing: L, flexure_dcr: 'none' },
    { check: (u) => { assert(u.force_model, 'lap result carries force_model (in-house assumption)'); } });
    // K4a 3a: get_design_check — 지금 결과의 모든 항목을 하나씩(계산 과정 포함, 예산 20 KB), 하나는 SI 로도
    await sweepChecks('member', tenUS);
    await sweepChecks('connection', pafUS);
    await sweepChecks('lap', lapUS);
    await usVsSi('check_lap_length', { d: 8, lap_left: 12, lap_right: 13 }, { d: L, lap_left: L, lap_right: L },
      { min_lap_in: L });
    await usVsSi('check_shear_lag', { Ag: 1.0, An_net: 0.9, x_bar: 0.5, L_conn: 4, Fu: 65, Fy: 50,
      connection_case: 'angle_bolted', connection_type: 'bolted', b1: 2.0, b2: 1.5 },
    { Ag: A, An_net: A, x_bar: L, L_conn: L, Fu: S, Fy: S, b1: L, b2: L }, { Ae: A, Tn: Fo, U: 'none' });
    await usVsSi('check_block_shear', { Agv: 0.5, Anv: 0.4, Ant: 0.2, Fy: 50, Fu: 65 },
      { Agv: A, Anv: A, Ant: A, Fy: S, Fu: S }, { Rn: Fo });
    await usVsSi('cold_work', { Fyv: 50, Fuv: 65, R: 0.1875, t: 0.059, A_corners: 0.05, A_flange: 0.2, A_total: 0.8,
      buckling_precondition: true },
    { Fyv: S, Fuv: S, R: L, t: L, A_corners: A, A_flange: A, A_total: A }, { Fya: S, C: 'none' });
    await usVsSi('flange_curling', { bf: 2.5, t: 0.059, h: 8, f_avg: 30, allowable_cf: 0.05 },
      { bf: L, t: L, h: L, f_avg: S, allowable_cf: L }, { cf: L });
    await usVsSi('get_web_crippling', { h: 7.5, t: 0.059, R: 0.1875, N: 3.5, Fy: 50 },
      { h: L, t: L, R: L, N: L, Fy: S }, { Pn: Fo, phi_Pn: Fo });
    await usVsSi('calc_deck_stiffness', { t_panel: 0.018, t_purlin: 0.059, Fss_kip: 1.8, D_screw_in: 0.19 },
      { t_panel: L, t_purlin: L, Fss_kip: Fo, D_screw_in: L },
      { kphi: 'rot_stiff', kx: 'lat_stiff', 'kx_detail.Ke': 'spring_disc', 'kx_detail.inputs.Fss_kip': Fo });
    const LOAD_SI = { span_ft: 'length_ft', loads: { D: 'linload', Lr: 'linload', W: 'linload', Wp: 'linload' },
      laps: { left_ft: 'length_ft', right_ft: 'length_ft' }, deck: { t_panel: L },
      section: { depth: L, flange_width: L, thickness: L, lip_depth: L, R_corner: L, Fy: S, Fu: S, Ixx: 'inertia' },
      Fy: S, Fu: S, wc_N: L, wc_R: L };
    const loadsArgs = { member_app: 'roof-purlin', span_type: 'cont-3', span_ft: 25,
      loads: { D: 25, Lr: 100, W: -150, Wp: 40 }, laps: { left_ft: 2, right_ft: 2 },
      deck: { type: 'through-fastened', t_panel: 0.018 },
      section: { depth: 8, flange_width: 2.5, thickness: 0.059, lip_depth: 0.625, R_corner: 0.1875, type: 'Z',
        Fy: 55, Fu: 70, Ixx: 7.59 }, i621_conditions_confirmed: true, design_method: 'LRFD' };
    const [ldUS, ldSI] = await usVsSi('analyze_loads', loadsArgs, LOAD_SI,
      { 'auto_params.negative_region.Ly_in': L, 'auto_params.negative_region.M_max_abs': 'moment_ft',
        'input_loads_plf.D': 'linload', 'deflection.Ixx': 'inertia' });
    const loc = ldUS.gravity.locations.findIndex((l) => typeof l.Mu === 'number' && l.Mu !== 0 && l.x_ft > 0);
    assert(Math.abs(ldSI.gravity.locations[loc].Mu / (ldUS.gravity.locations[loc].Mu * F.moment_ft) - 1) < 1e-12, 'loads Mu kip-ft → kN-m');
    assert(Math.abs(ldSI.gravity.locations[loc].x_ft / (ldUS.gravity.locations[loc].x_ft * 0.3048) - 1) < 1e-12, 'loads x ft → m');

    // 휨 계열: 휨 해석으로 바꾼다
    await ok('set_load_case', { load_case: 'bending_xx_pos', fy: 50 });
    await ok('run_analysis', { neigs: 6 });
    await usVsSi('aisi_design_flexure', { Fy: 50, Fu: 65, Lb: 60, Cb: 1.0, Mu: 50, Vu: 2, wc_N: 3.5, wc_R: 0.1875,
      wc_support: 'EOF', Lb_pos: 30, Mu_pos: 20, Cb_pos: 1.1, dist_Lm: 24,
      check_location: { member: 'P1', x: { symbol: 'x', value: 60, quantity: 'length' } }, check_combination: '6a' },
    { Fy: S, Fu: S, Lb: L, Mu: M, Vu: Fo, wc_N: L, wc_R: L, Lb_pos: L, Mu_pos: M, dist_Lm: L,
      check_location: { x: { value: L } } },
    { Mn: M, phi_Mn: M, My: M, design_strength: M, 'positive_region.Mn': M, 'positive_region.Lb': L, 'shear.Vn': Fo,
      'Fcre_detail.Lb': L, 'Fcre_detail.Sf': 'modulus', 'Fcre_detail.J': 'inertia', 'Fcre_detail.Cw': 'warping',
      'Fcre_detail.sigma_ey': S, Fy_used: S, 'shear_interaction.total': 'none', 'web_crippling.Pn': Fo },
    { check: (u, s) => {
      // K4a: check_location · check_combination — 값을 바꾸지 않고 모든 항목에 붙는다(엔진이 자기 위치를 준 정모멘트 구간 항목은 그 위치)
      assert(Array.isArray(u.design_checks) && u.design_checks.length >= 5, 'flexure result lists design_checks');
      for (const [i, c] of s.design_checks.entries()) {
        assert.strictEqual(c.combination, '6a', `design_checks[${i}].combination`);
        if (c.location && c.location.segment) { continue; }
        assert.strictEqual(c.location.member, 'P1', `design_checks[${i}].location carried`);
        assert(Math.abs(c.location.x.value - 1524) < 1e-9, 'location.x back in mm (60 in)');
        assert.strictEqual(u.design_checks[i].location.x.value, 60, 'location.x in US (in)');
      }
      assert(u.design_checks.some((c) => c.demand && c.demand.source && c.demand.source.kind === 'load_analysis'),
        'check_combination marks the demands as coming from the load analysis');
    } });
    const [combUS] = await usVsSi('aisi_design_combined', { Fy: 50, Fu: 65, KxLx: 120, KyLy: 60, KtLt: 60, Lb: 60, Pu: 3, Mux: 30,
      Muy: 2, May_strength: 20, Vu: 1, Cmx: 0.85, Cmy: 1.0 },
    { Fy: S, Fu: S, KxLx: L, KyLy: L, KtLt: L, Lb: L, Pu: Fo, Mux: M, Muy: M, May_strength: M, Vu: Fo },
    { 'flexure_x.design_strength': M, 'compression.design_strength': Fo, 'amplification.PEx': Fo,
      'amplification.Mux_amp': M, 'interaction.total': 'none', 'shear.design_strength': Fo });
    await sweepChecks('member', combUS);
    await usVsSi('get_dsm_values', { load_type: 'Mxx', Lb: 60 }, { Lb: L },
      { 'Mxx.crl': M, 'Mxx.cre': M, 'Mxx.P_y': M, 'Mxx.Lcrl': L });

    // 8. design_purlin — MCP = 패널 함수 직접(GUI 와 같은 길), 웹 크리플링, SI 묶음 ---------------
    const purlinArgs = { member_app: 'roof-purlin', span_type: 'cont-2', span_ft: 25,
      loads: { D: 25, Lr: 100, W: -150 }, laps: { left_ft: 2, right_ft: 2 },
      deck: { type: 'through-fastened', t_panel: 0.018 }, i621_conditions_confirmed: true, design_method: 'LRFD',
      Fy: 50, Fu: 65, wc_N: 3.5, wc_R: 0.1875, wc_fastened: 'fastened' };
    const [pUS, pSI] = await usVsSi('design_purlin', purlinArgs, LOAD_SI, {});
    // 구간 · 검토점 · 지배 구간의 단위(호스트 코드에서 정한 뜻: 위치 ft, Ly in, Mu kip-in, Vu kips)
    const ri = pUS.regions.findIndex((g) => g.Mu > 0 && g.Ly_in > 0 && g.start_ft > 0 && g.Vu > 0);
    assert(ri >= 0, 'a purlin region with Mu, Vu, Ly and a start position');
    const rg = pUS.regions[ri];
    const ci = rg.result.checks.findIndex((c) => c.Mu > 0 && c.Vu > 0);
    const purlinSpot = {
      [`regions[${ri}].start_ft`]: 'length_ft', [`regions[${ri}].end_ft`]: 'length_ft', [`regions[${ri}].Ly_in`]: 'length',
      [`regions[${ri}].Mu`]: 'moment', [`regions[${ri}].Vu`]: 'force', [`regions[${ri}].Cb`]: 'none',
      [`regions[${ri}].result.Mu_checked`]: 'moment', [`regions[${ri}].result.checks[${ci}].Mu`]: 'moment',
      [`regions[${ri}].result.checks[${ci}].Vu`]: 'force', [`regions[${ri}].result.phi_Mn`]: 'moment',
      'load_analysis.input_loads_plf.D': 'linload',
    };
    for (const [q, unit] of Object.entries(purlinSpot)) {
      const u = at(pUS, q); const v = at(pSI, q); const f = unit === 'none' ? 1 : F[unit];
      assert(typeof u === 'number' && u !== 0 && Math.abs(v / (u * f) - 1) < 1e-12, `design_purlin: ${q} expected ${unit}: US ${u} SI ${v}`);
    }
    // 같은 구간의 M 은 하중 해석의 kip-ft × 12 (설계 입력 kip-in) — 단위 뜻을 엔진 값으로 확인
    assert(rg.Mu > 0 && Math.abs(rg.result.checks[0].Mu - (rg.kind === 'lap' ? 0.5 : 1) * rg.Mu) < 1e-9 * rg.Mu,
      'purlin M_max check uses the region Mu (kip-in)');
    // K4a: 구간마다 검토 지점(M_max · V_max · 지점)의 design_checks · 위치 · 조합 — 지배 지점은 그대로
    let multiPoint = 0; let lapNotes = 0;
    for (const [i, g] of pUS.regions.entries()) {
      const cks = g.result.checks;
      assert(Array.isArray(cks) && cks.length >= 1, `region ${g.id}: checks`);
      if (cks.length > 1) { multiPoint++; }
      for (const [j, c] of cks.entries()) {
        const at = `regions[${i}].result.checks[${j}]`;
        assert(Array.isArray(c.design_checks) && (c.error || c.design_checks.length > 0), `${at}.design_checks`);
        assert.strictEqual(c.location.region, g.id, `${at}.location.region`);
        assert.strictEqual(c.location.check_point, c.check_point, `${at}.location.check_point`);
        assert(c.location.x && c.location.x.quantity === 'length', `${at}.location.x`);
        const xin = c.location.x.value;
        assert(xin >= g.start_ft * 12 - 1e-6 && xin <= g.end_ft * 12 + 1e-6, `${at}: x ${xin} in lies in the region ${g.start_ft}–${g.end_ft} ft`);
        assert(sameScaled(xin, pSI.regions[i].result.checks[j].location.x.value, F.length), `${at}.location.x in mm`);
        for (const item of c.design_checks) {
          assert.strictEqual(item.combination, c.combination, `${at}: item ${item.id} combination`);
          if (!(item.location && item.location.segment)) { assert.deepStrictEqual(item.location, c.location, `${at}: item ${item.id} location`); }
        }
        if (g.members === 2) { assert(/half of the region Mu and Vu/.test(c.host_assumption), `${at}: lap host assumption`); lapNotes++; }
        else { assert.strictEqual(c.host_assumption, undefined, `${at}: no lap note outside laps`); }
      }
      const governing = cks.find((c) => c.check_point === g.result.check_point);
      assert(governing, `region ${g.id}: governing check point is one of its checks`);
      assert.deepStrictEqual(g.result.design_checks, governing.design_checks, `region ${g.id}: region design_checks = its governing point's`);
    }
    assert(multiPoint > 0, 'some purlin region has more than one check point (V_max or a support)');
    const st2 = checkPurlinStations('design_purlin cont-2', pUS);
    results.push(`design_purlin cont-2 stations: ${st2.points} check points = load-analysis envelope (sign of the checked flange), ${st2.labelled} labelled with the combination that produced them (envelope_source), ${st2.mixed || 0} mixed M / V pairs with their assumption line, ${st2.envelope} 'envelope'; V6b-01: ${st2.faces || 0} points on a support use the load-analysis face shear (${st2.ownFaceSmaller || 0} on the smaller face — region ends there; ${st2.faceUnknown || 0} with that face's combination not reported)`);
    assert(lapNotes > 0, 'a lap region carries the host lap assumption on its check points');
    results.push(`design_purlin: ${pUS.regions.length} regions, ${multiPoint} with several check points — design_checks · x · combination per point`);
    for (const g of [pUS.regions[0], pUS.regions.find((x) => x.members === 2)].filter(Boolean)) {
      for (const pt of g.result.checks) { await sweepChecks('purlin', { design_checks: pt.design_checks }, { region: g.id, check_point: pt.check_point }); }
    }
    const direct = JSON.parse(JSON.stringify(await real.panel.handleMcpAction({ action: 'design_purlin', ...purlinArgs })));
    const { units: _u, ...pUSnoUnits } = pUS;
    void _u;
    // K2-5: case_* (검토 상태의 기록)는 호출 차례에 따라 다르다 — 계산 결과만 맞댄다
    const dropCase = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('case_')));
    assert.deepStrictEqual(dropCase(pUSnoUnits), dropCase(direct), 'V4-05: MCP design_purlin = the host purlin function with the same inputs');
    const g5 = findPath(pUS, (k, v) => typeof v === 'string' && /G5|web crippling/i.test(v));
    assert(g5, 'V4-05: with wc_N/wc_R the MCP purlin design evaluates web crippling');
    const noWc = await call('design_purlin', { ...purlinArgs, wc_N: undefined, wc_R: undefined, wc_fastened: undefined });
    assert(!noWc.isError, 'purlin without web-crippling inputs still runs');

    // 8b. V4-16 나머지: 내민 경간이 있는 퍼린 — overhang_ft 같은 키도 SI 표가 덮는다
    const purlinOH = { member_app: 'roof-purlin', span_type: 'cont-n', span_ft: 25, spans_ft: [1.5, 25, 25, 1.5],
      supports: ['N', 'P', 'P', 'P', 'N'], loads: { D: 25, Lr: 100, W: -150 },
      laps_per_support: [null, null, { left_ft: 2, right_ft: 2 }, null, null],
      deck: { type: 'through-fastened', t_panel: 0.018 }, i621_conditions_confirmed: true, design_method: 'LRFD',
      Fy: 50, Fu: 65, wc_N: 3.5, wc_R: 0.1875 };
    const [ohUS] = await usVsSi('design_purlin', purlinOH,
      { ...LOAD_SI, spans_ft: 'length_ft', laps_per_support: { left_ft: 'length_ft', right_ft: 'length_ft' } }, {}, { levels: ['full'] });
    assert(findPath(ohUS, (k, v) => k === 'overhang_ft' && typeof v === 'number' && v > 0),
      'the overhang case really produces overhang_ft values (so the SI check covers them)');

    // 8d. V6-08 · V6-09: 패턴 하중(Lr 감소 → 경간마다 Lr) — 검토 지점의 소요는 검토하는 플랜지 부호의 포락선 값이고,
    //     조합 이름은 그것을 낸 조합 · 패턴일 때만(아니면 'envelope'). 고치기 전: 정모멘트 구간 V_max 에 부모멘트 크기 112.4 kip-in.
    const PAT = { member_app: 'roof-purlin', span_type: 'cont-4', span_ft: 25, loads: { D: 15, Lr: 100, W: -170 }, lr_reduced: true,
      laps: { left_ft: 1.0, right_ft: 2.5 }, deck: { type: 'through-fastened', t_panel: 0.018, fastener_spacing: 12 },
      i621_conditions_confirmed: true, design_method: 'ASD', Fy: 55, Fu: 70, wc_N: 3.5, wc_R: 0.1875, wc_fastened: 'fastened' };
    const [patUS] = await usVsSi('design_purlin', PAT, { ...LOAD_SI, laps: { left_ft: 'length_ft', right_ft: 'length_ft' },
      deck: { t_panel: L, fastener_spacing: L } }, {}, { levels: ['full', 'summary'], label: 'design_purlin pattern' });
    assert(patUS.load_analysis.gravity.pattern && Object.keys(patUS.load_analysis.gravity.pattern).length > 0, 'the pattern case really patterns Lr');
    const stP = checkPurlinStations('design_purlin pattern', patUS);
    // K3-6: 패턴 하중에서도 envelope_source 가 조합을 준다 — 'envelope' 꼬리표는 없다(전: 있어야 했다)
    assert.strictEqual(stP.envelope, 0, 'with envelope_source no check point is labelled only "envelope"');
    results.push(`design_purlin pattern stations: ${stP.points} check points, ${stP.labelled} labelled, ${stP.mixed || 0} mixed M / V, ${stP.envelope} 'envelope'`);

    // 8c. V4-31: 「0 = 없음」 을 엔진이 받는 선택 인자를 스키마가 거절하지 않는다(design_purlin · analyze_loads)
    //     엔진에 0 을 준 결과가 인자를 뺀 결과와 같으면 0 은 「주지 않음」 의 뜻이므로 스키마가 0 을 받아야 한다.
    //     0 이 결과를 바꾸면(실제 값으로 쓰이면) 스키마가 0 을 거절해도 된다. 각 인자를 그 인자가 쓰이는 입력으로 시험한다.
    const purlinSchema = byName.design_purlin.inputSchema;
    const refusesZero = (ps) => ps && (ps.exclusiveMinimum === 0 || (typeof ps.minimum === 'number' && ps.minimum > 0));
    // 각 인자가 실제로 쓰이도록: 시험값(override)이 있으면 패스너 값이 가려지고, E 가 두 곳에 기본값이면 가려진다.
    const loadBase = { member_app: 'roof-purlin', span_type: 'cont-2', span_ft: 25, loads: { D: 25, Lr: 100, W: -150 },
      laps: { left_ft: 2, right_ft: 2 }, spacing_ft: 5, insulation_in: 2, i621_conditions_confirmed: true,
      deck: { type: 'through-fastened', t_panel: 0.018, fastener_spacing: 12, Fss_kip: 2.1, D_screw_in: 0.21,
        Fu_panel_ksi: 65, b_fastener_in: 1.1, c_fastener_in: 1.3 },
      section: { type: 'C', depth: 8, flange_width: 2.5, thickness: 0.059, lip_depth: 0.625, R_corner: 0.1875,
        Fy: 50, Fu: 65, Ixx: 7.59, qlip: 80, E: 28000 } };
    const overrideBase = { ...loadBase, deck: { ...loadBase.deck, kphi_override: 0.2, kx_override: 1.5 } };
    const eBase = { ...loadBase, E: 27000 };
    const ssBase = { ...loadBase, deck: { type: 'standing-seam', R_tested_uplift: 0.6, R_tested_gravity: 0.6 } };
    const flexBase = { member_type: 'flexure', Fy: 50, Fu: 65, Lb: 60, Mu: 50, Vu: 2, wc_N: 3.5, wc_R: 0.1875,
      wc_support: 'EOF', wc_overhang: 1, wc_edge_distance: 2, wc_support_fastener_spacing: 12, wc_n_webs: 1 };
    const probes = [];
    for (const [k, ps] of Object.entries(purlinSchema.properties)) {
      if (ps.type === 'object') {
        for (const [k2, ps2] of Object.entries(ps.properties || {})) { probes.push([[k, k2], ps2]); }
      } else { probes.push([[k], ps]); }
    }
    const zeroGaps = [];
    const inert = [];
    const setPath = (o, keys, v) => {
      const c = JSON.parse(JSON.stringify(o)); let t = c;
      for (const key of keys.slice(0, -1)) { t = t[key]; }
      if (v === undefined) { delete t[keys[keys.length - 1]]; } else { t[keys[keys.length - 1]] = v; }
      return c;
    };
    const runHost = async (body) => JSON.stringify(await real.panel.handleMcpAction(JSON.parse(JSON.stringify(body))));
    let probed = 0;
    for (const [keys, ps] of probes) {
      if (!(ps.type === 'number' || ps.type === 'integer') || !refusesZero(ps)) { continue; }
      if ((purlinSchema.required || []).includes(keys[0]) && keys.length === 1) { continue; }
      if (keys.length === 1 && keys[0] === 'Fu') { continue; } // 강도: 0 은 「없음」 이 아니다(엔진이 I6.2.1 (o) 에서 미확인으로)
      let base; let action;
      if (keys[0].startsWith('wc_')) { base = flexBase; action = 'aisi_design'; }
      else if (keys[0] === 'deck' && keys[1].startsWith('R_tested')) { base = ssBase; action = 'analyze_loads'; }
      else if (keys[0] === 'deck' && keys[1].endsWith('_override')) { base = overrideBase; action = 'analyze_loads'; }
      else if (keys.length === 1 && keys[0] === 'E') { base = eBase; action = 'analyze_loads'; }
      else { base = loadBase; action = 'analyze_loads'; }
      const present = keys.length === 1 ? base[keys[0]] : (base[keys[0]] || {})[keys[1]];
      assert(present !== undefined, `zero probe: base input lacks ${keys.join('.')}`);
      const withZero = await runHost({ action, ...setPath(base, keys, 0) });
      const absent = await runHost({ action, ...setPath(base, keys, undefined) });
      const withValue = await runHost({ action, ...base });
      if (withValue === absent) { inert.push(keys.join('.')); continue; } // 이 입력에서 쓰이지 않음 — 판단 못 함
      probed++;
      if (withZero === absent && !JSON.parse(withZero).error) {
        zeroGaps.push(`${keys.join('.')}: the engine treats 0 as "not given" but the schema refuses 0`);
      }
    }
    assert(probed >= 4, `zero probe exercised ${probed} bounded optional fields (inert: ${inert.join(', ')})`);
    assert.deepStrictEqual(zeroGaps, [], `V4-31 schema bounds:\n  ${zeroGaps.join('\n  ')}`);
    results.push(`design_purlin/analyze_loads bound probe: ${probed} bounded optional fields exercised, 0 ≡ absent for none; not exercised by these inputs: ${inert.join(', ') || '-'}`);

    // 보고서 · 검증 (마지막 설계 = 퍼린 묶음, 마지막 하중 분석)
    // K3: 검증 · 보고서는 호스트가 만든다 — US · SI 는 같은 항목(id · 판정)을 그 단위의 글로(값을 바꾸는 표가 없다)
    {
      const vUS = await call('validate_design', { detail: 'full' });
      const vSI = await call('validate_design', { detail: 'full', units: 'SI' });
      assert(!vUS.isError && !vSI.isError, JSON.stringify(vUS.data).slice(0, 300));
      const dU = vUS.data.items.map((i) => `${i.id} ${i.status}`), dS = vSI.data.items.map((i) => `${i.id} ${i.status}`);
      assert.deepStrictEqual(dS, dU, 'validate_design: the same items and verdicts in US and SI — ' + JSON.stringify(vUS.data.items.filter((i, k) => dS[k] !== dU[k]).concat(vSI.data.items.filter((i, k) => dS[k] !== dU[k]))).slice(0, 1500));
      assert(vSI.data.units === 'SI' && vUS.data.units === 'US');
    }

    // 진동 (S-S, 짧은 길이 목록)
    await ok('set_lengths', { min: 10, max: 100, n: 3 });
    await usVsSi('run_vibration', { rho: 7.345e-7, lengths: [10, 50, 100] }, { rho: 'density', lengths: 'length' },
      { 'rho_used.100': 'density', 'lengths[1]': 'length', 'size.n_lengths': 'none' },
      { check: (u, s) => assert.deepStrictEqual(s.frequencies, u.frequencies, 'Hz unchanged') });

    // 10. K4a 3a 예산 — 38 구간 퍼린(매뉴얼 II-2A 의 6 경간) 요약, 그리고 지워진 결과의 get_design_check
    await ok('set_section_template', { type: 'lippedz', H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875, qlip: 50 });
    await ok('set_lengths', { min: 1, max: 1000, n: 30 });
    const P38 = { member_app: 'roof-purlin', span_type: 'cont-n', span_ft: 25, spans_ft: [1, 25, 25, 25, 25, 1],
      supports: ['N', 'P', 'P', 'P', 'P', 'P', 'N'], laps_per_support: [null, { left_ft: 0, right_ft: 0 }, { left_ft: 2.5, right_ft: 3.5 },
        { left_ft: 1, right_ft: 1 }, { left_ft: 3.5, right_ft: 2.5 }, { left_ft: 0, right_ft: 0 }, null],
      loads: { D: 15, Lr: 100, W: -170 }, design_method: 'ASD', spacing_ft: 5, deck: { type: 'through-fastened', kphi_override: 0.3 },
      i621_conditions_confirmed: true, Fy: 55, Fu: 70, wc_N: 3.5, wc_R: 0.1875 };
    const [p38] = await usVsSi('design_purlin', P38, { ...LOAD_SI, spans_ft: 'length_ft', spacing_ft: 'length_ft', deck: { kphi_override: 'rot_stiff' },
      laps_per_support: { left_ft: 'length_ft', right_ft: 'length_ft' } }, {}, { levels: ['full', 'summary'], label: 'design_purlin 38 regions' });
    assert(p38.regions.length >= 30, `the budget case has many regions (${p38.regions.length})`);
    checkPurlinStations('design_purlin 38 regions', p38);
    const budget = { aisi_design_compression: 12, aisi_design_flexure: 12, aisi_design_combined: 12, aisi_design_tension: 12,
      aisi_design_connection: 12, design_connection: 12, design_lap_connection: 16, 'design_purlin 38 regions': 40, design_purlin: 40,
      'design_purlin pattern': 40 };
    for (const z of SIZES.filter((x) => x.level === 'summary' && budget[x.tool])) {
      assert(Math.max(z.us, z.si) <= budget[z.tool] * KB, `budget: ${z.tool} summary ${Math.max(z.us, z.si)} B > ${budget[z.tool]} KB`);
    }
    results.push(`reply budgets (summary, bytes US/SI): ${SIZES.filter((x) => x.level === 'summary').map((x) => `${x.tool} ${x.us}/${x.si}`).join(', ')}`);
    // K3: validate_design · generate_report — 38 구간 퍼린 묶음 뒤(가장 큰 사례) 요약 ≤ 40 KB, 요약 규칙: full 의 통과 아닌 항목 id ·
    // 알림 글이 모두 요약에. generate_report 는 파일을 쓴다(열린 .csd 가 없으면 임시 폴더) — 경로가 응답에.
    {
      const sizes = [];
      for (const u of ['US', 'SI']) {
        const vs = await call('validate_design', { units: u });
        const vf = await call('validate_design', { units: u, detail: 'full' });
        assert(!vs.isError && !vf.isError, JSON.stringify(vs.data).slice(0, 300));
        const fullNotPass = vf.data.items.filter((i) => i.status !== 'pass');
        assert.deepStrictEqual(vs.data.items.map((i) => i.id), fullNotPass.map((i) => i.id), `validate_design ${u}: every failing / caution id of the full reply is in the summary`);
        const passNotes = [...new Set(vf.data.items.filter((i) => i.status === 'pass' && i.note).map((i) => i.note))];
        assert.deepStrictEqual(vs.data.pass_notes || [], passNotes, `validate_design ${u}: every distinct note of the full reply is in the summary`);
        assert(vs.bytes <= 40 * KB, `budget: validate_design (38-region purlin) summary ${vs.bytes} B > 40 KB`);
        const rs = await call('generate_report', { units: u, format: 'html' });
        const rf = await call('generate_report', { units: u, format: 'html', detail: 'full' });
        assert(!rs.isError && !rf.isError && rs.data.files && rs.data.files.html, JSON.stringify(rs.data).slice(0, 300));
        assert(typeof rf.data.html === 'string' && !('html' in rs.data), 'generate_report: detail full adds the HTML');
        assert.deepStrictEqual(rs.data.notices, rf.data.notices, `generate_report ${u}: the summary carries every notice of the full reply`);
        assert.deepStrictEqual(rs.data.checks, rf.data.checks, `generate_report ${u}: the summary carries every failing / not-evaluated check id`);
        const fullNotices = new Set(rf.data.notices);
        assert(rs.data.notices.every((t) => fullNotices.has(t)) && rs.data.notices.length === fullNotices.size, 'notices are distinct');
        assert(rs.bytes <= 40 * KB, `budget: generate_report (38-region purlin) summary ${rs.bytes} B > 40 KB`);
        sizes.push(`${u} validate ${vs.bytes}/${vf.bytes} B, report ${rs.bytes}/${rf.bytes} B`);
      }
      results.push(`K3 validate_design · generate_report after the 38-region purlin (summary/full): ${sizes.join('; ')}`);
    }
    results.push(`get_design_check: ${DC_SWEEP.n} items fetched one by one, largest ${DC_SWEEP.max} B (budget 20 KB)`);

    // 9b'. K2-5: 검토 상태 도구 — 응답 크기(12 KB), SI 왕복, 받지 않는 키, 설계 도구가 바꾼 사람의 값(case_inputs_replaced)
    {
      const gi = await call('get_case_inputs', {});
      const giSI = await call('get_case_inputs', { units: 'SI' });
      assert(!gi.isError && !giSI.isError, `get_case_inputs: ${gi.data && gi.data.error}`);
      assert(Math.max(gi.bytes, giSI.bytes) <= 12 * KB, `budget: get_case_inputs ${Math.max(gi.bytes, giSI.bytes)} B > 12 KB`);
      assert(Object.keys(gi.data.inputs).length > 80 && gi.data.unit_of.Lb === 'in' && giSI.data.unit_of.Lb === 'mm', 'get_case_inputs: values with units');
      assert(Math.abs(giSI.data.inputs.KxLx - gi.data.inputs.KxLx * 25.4) < 1e-9 * gi.data.inputs.KxLx * 25.4, 'get_case_inputs SI converts lengths');
      const s1 = await call('set_case_inputs', { inputs: { Lb: 96, wcSupport: 'IOF', bogus: 1, tplH: 5, wcFastened: 'nailed' }, reason: 'k2 test' });
      assert(!s1.isError || s1.data.rejected, JSON.stringify(s1.data).slice(0, 300));
      assert.deepStrictEqual(s1.data.accepted.sort(), ['Lb', 'wcSupport'], 'set_case_inputs accepts known keys with valid values');
      assert.deepStrictEqual(s1.data.rejected.map((r) => r.key).sort(), ['bogus', 'tplH', 'wcFastened'], 'unknown / model / invalid keys refused');
      const s2 = await call('set_case_inputs', { units: 'SI', inputs: { Lb: 2438.4 } });
      assert(s2.data.accepted.length === 0 || (await call('get_case_inputs', { keys: ['Lb'] })).data.inputs.Lb === 96, 'SI 2438.4 mm = 96 in exactly');
      assert(Math.max(s1.bytes, s2.bytes) <= 4 * KB, `set_case_inputs replies are small (${s1.bytes} B)`);
      // 사람이 정한 값(화면의 caseEdit)을 MCP 설계 도구가 바꾸면 응답이 그 전 값을 알린다
      await real.panel.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { Cb: 1.3, Lb: 80 } } });
      const fl = await call('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Lb: 60, Mu: 30 });
      assert(!fl.isError, JSON.stringify(fl.data).slice(0, 300));
      const rp = (fl.data.case_inputs_replaced || []).map((x) => [x.key, x.previous, x.previous_source]).sort();
      assert.deepStrictEqual(rp.filter(([k]) => k === 'Cb' || k === 'Lb'), [['Cb', 1.3, 'user'], ['Lb', 80, 'user']], 'replaced person values listed with the previous value');
      assert(/tell the person/.test(fl.data.case_note || ''), 'the reply tells the AI to report it');
      const after = (await call('get_case_inputs', { keys: ['Cb', 'Lb', 'Mux', 'memberType'] })).data;
      assert.deepStrictEqual([after.inputs.Cb, after.inputs.Lb, after.inputs.Mux, after.inputs.memberType, after.sources.Lb], [null, 60, 30, 'flexure', 'ai'],
        'decision 1: the tool group is what the tool got (Cb not given → blank)');
      await real.panel.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { Lb: 80 } } });
      const flSI = await call('aisi_design_flexure', { units: 'SI', design_method: 'LRFD', Fy: 345, Lb: 1524, Mu: 3.39 });
      const lbRep = (flSI.data.case_inputs_replaced || []).find((x) => x.key === 'Lb');
      assert(lbRep && Math.abs(lbRep.previous - 80 * 25.4) < 1e-9 && lbRep.units === 'SI', `SI reply gives the replaced value in mm (${JSON.stringify(lbRep)})`);
      // run_case_check: 화면에 있는 것으로(같은 모양의 요약)
      const rc = await call('run_case_check', { what: 'connection' });
      assert(!rc.isError, JSON.stringify(rc.data).slice(0, 300));
      assert(rc.data.case_check && rc.data.case_check.tool === 'design_connection' && rc.data.detail === 'summary', 'run_case_check: summary of the connection check');
      const rcm = await call('run_case_check', { what: 'member', units: 'SI' });
      assert(!rcm.isError && rcm.data.case_check.tool === 'aisi_design_flexure' && rcm.data.units === 'SI', JSON.stringify(rcm.data).slice(0, 300));
      for (const [t, z] of [['run_case_check connection', rc], ['run_case_check member', rcm]]) {
        assert(z.bytes <= 12 * KB, `budget: ${t} ${z.bytes} B > 12 KB`);
      }
      results.push(`case tools: get_case_inputs ${gi.bytes}/${giSI.bytes} B, set_case_inputs ${s1.bytes} B, run_case_check ${rc.bytes}/${rcm.bytes} B, aisi_design_flexure with replaced values ${fl.bytes} B`);
    }
    await ok('set_material', { E: 29500, v: 0.3 });
    const gone = await call('get_design_check', { scope: 'purlin', id: p38.regions[0].result.design_checks[0].id, location: { region: p38.regions[0].id } });
    assert(gone.isError && /no longer current/.test(gone.data.error) && gone.data.invalidated && gone.data.invalidated.reason === 'Material changed',
      `a deleted result is not served — the ledger says why: ${JSON.stringify(gone.data).slice(0, 300)}`);

    // 11. V6-02 · V6-10 · V5c-01 · V6-16 · V6-17: 계약 사례 전부(엔진만) — 요약 · 검토 목록 ⊇ 전체(알림 글 · 불합격 · 미평가 ·
    //     지배 id), SI 전체에 단위 표 없는 수가 없고, 끝없는 값(Fcre_unbounded · unbounded)은 바꾸지 않으며, 크기 안
    const dump = cp.execFileSync(py, ['-c', [
      'import sys, json',
      `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'python'))})`,
      `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'test', 'python'))})`,
      'import contract_cases_1123 as cc',
      'out = {name: {"method": m, "result": cc.run_case(m, p)} for name, m, p in cc.design_cases()}',
      'sys.stdout.write(json.dumps(out))'].join('\n')], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const cases = JSON.parse(dump);
    const SH = loadShapers(si);
    const toolOf = { aisi_design: 'aisi_design_flexure', design_connection: 'design_connection', lap_connection: 'design_lap_connection' };
    // 랩 16 KB — 결과마다 같은 force_model 의 설명 · 한계 (a)–(e) 는 요약에서 code + 한 줄 제목(글 전체는 detail:'checks')
    const limitOf = { aisi_design: 12, design_connection: 12, lap_connection: 16 };
    const largest = {};
    let nCases = 0; let nUnb = 0;
    // K4b: 호스트가 하듯 먼저 읽는 꼴(forReader — 알림 · 이유를 그 단위의 한국어로)로 바꾼 뒤 모양을 줄인다
    const reply = (r, units, detail, t) => JSON.parse(SH.unitReply(NOTICES_JS.forReader(r, { units, detail }), units, units === 'SI' ? si.SI_OUT_MEMBER : null, SH.SHAPERS[t], detail).content[0].text);
    for (const [name, c] of Object.entries(cases)) {
      if (!c.result || c.result.error) { continue; }
      const t = toolOf[c.method];
      nCases++;
      const fSI = reply(c.result, 'SI', 'full', t);
      assert(!fSI.si_unconverted, `${name}: SI numbers with no unit in the table: ${JSON.stringify(fSI.si_unconverted || []).slice(0, 300)} — V6-17`);
      // 끝없는 값: Fcre_unbounded 옆의 Fcre(1e6 표지)와 unbounded:true 의 value 는 바꾸지 않는다 — V6-16
      const unb = (u, v, p) => {
        if (Array.isArray(u)) { u.forEach((x, i) => unb(x, v[i], `${p}[${i}]`)); return; }
        if (!u || typeof u !== 'object') { return; }
        if (u.Fcre_unbounded === true) { assert.strictEqual(v.Fcre, u.Fcre, `${name} ${p}.Fcre stays the placeholder in SI`); nUnb++; }
        if (u.unbounded === true) { assert.strictEqual(v.value, u.value, `${name} ${p}.value (unbounded) not converted`); nUnb++; }
        for (const [k, x] of Object.entries(u)) { if (x && typeof x === 'object') { unb(x, v[k], `${p}.${k}`); } }
      };
      unb(c.result, fSI, name);
      assert(/expr_units:"US"/.test(fSI.units_note) && !/unit-free/.test(fSI.units_note), 'SI units_note: expressions carry US numbers only in expr_units US steps — V6-11');
      for (const units of ['US', 'SI']) {
        for (const detail of ['summary', 'checks']) {
          const sh = reply(c.result, units, detail, t);
          const bytes = require('buffer').Buffer.byteLength(JSON.stringify(sh));
          checkComplete(`${name} [${units} ${detail}]`, sh, NOTICES_JS.forReader(c.result, { units, detail }));
          if (detail === 'summary') {
            assert(bytes <= limitOf[c.method] * KB, `${name} ${units} summary ${bytes} B > ${limitOf[c.method]} KB`);
            const key = `${c.method} ${units}`;
            if (!largest[key] || largest[key].b < bytes) { largest[key] = { b: bytes, name }; }
          }
        }
      }
    }
    assert(nCases >= 120 && nUnb > 0, `broad set: ${nCases} cases, ${nUnb} unbounded values`);
    results.push(`contract cases through the reply shapers: ${nCases} × US/SI × summary/checks complete (notices, failing / not-evaluated / governing ids); `
      + `largest summaries ${Object.entries(largest).map(([k, v]) => `${k} ${v.b} B (${v.name})`).join(', ')}; ${nUnb} unbounded values left as they are`);

    // K4b: 수가 든 도구는 모두 units 를 받는다(전에는 US 만) — 결과를 물리량으로 바꾼다
    await usVsSi('get_status', {}, {}, { 'section.width': L, 'material.E': S, 'stress.max': S, 'lengths.max': L, 'section_params.H': L, load_fy: S });
    await usVsSi('get_full_state', {}, {}, { 'section.height': L, 'material.G': S, 'lengths.min': L });
    await usVsSi('get_nodes', {}, {}, {}, { check: (u, si2) => {
      const i = u.nodes.findIndex((n) => n[1] !== 0 && n[2] !== 0 && n[7] !== 0);
      assert(i >= 0 && Math.abs(si2.nodes[i][1] - u.nodes[i][1] * F.length) <= 1e-9 * Math.abs(si2.nodes[i][1]) && Math.abs(si2.nodes[i][7] - u.nodes[i][7] * F.stress) <= 1e-9 * Math.abs(si2.nodes[i][7]), 'get_nodes SI: x · z mm, stress MPa');
    } });
    await usVsSi('get_elements', {}, {}, { 'elements[0][3]': L });
    await usVsSi('run_analysis', { neigs: 6 }, {}, { 'lengths[0]': L, 'dsm_P.Pcrl': Fo, 'dsm_P.Lcrl': L, fy_reference: S });
    await usVsSi('get_buckling_curve', {}, {}, { 'curve[0][0]': L, 'curve[0][1]': 'none' });
    await usVsSi('get_energy_recovery', { length_index: 1, mode_index: 0 }, {}, { length: L });
    {
      // 목록(배열) — SI 는 {grades, units}
      const u = (await call('steel_grades', {})).data;
      const s = (await call('steel_grades', { units: 'SI' })).data;
      assert(Array.isArray(u) && Array.isArray(s.grades) && s.grades.length === u.length && s.units === 'SI', 'steel_grades SI: the same list');
      s.grades.forEach((g, i) => assert(Math.abs(g.Fy - u[i].Fy * F.stress) <= 1e-9 * g.Fy && Math.abs(g.Fu - u[i].Fu * F.stress) <= 1e-9 * g.Fu
        && g.Fy_MPa === u[i].Fy_MPa, `steel_grades SI ${g.id}: Fy · Fu in MPa (${g.Fy} vs ${u[i].Fy})`));
      results.push(`steel_grades: ${u.length} grades, Fy · Fu in MPa with units SI`);
    }

    // 9c. 실제 엔진 출력이 지난 quantity 종류(나머지는 9a 의 합성 항목으로만 — 엔진이 아직 내지 않는다)
    const realKinds = [...QTY_SEEN.keys()].sort();
    const synthOnly = Object.keys(engineQ).filter((q) => !QTY_SEEN.has(q)).sort();
    assert(realKinds.length >= 8, `real engine output exercised ${realKinds.length} quantity kinds`);
    results.push(`design_checks quantities from the real engine: ${realKinds.join(', ')}; synthetic only: ${synthOnly.join(', ') || '-'}`);
    for (const line of results) { console.log(`  ${line}`); }
    console.log(`mcp_si_chain: PASS (${results.length} US/SI comparisons through MCP → bridge → real StcfsdPanel → Python)`);
  } finally {
    try { if (client) { await client.close(); } } catch { /* ignore */ }
    try { if (bridge) { bridge.stop(); } } catch { /* ignore */ }
    try { if (real) { real.close(); } } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
}

module.exports = { main };
