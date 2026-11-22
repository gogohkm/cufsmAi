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
//   1. 도구 59 개의 이름이 공개 계약과 같다.
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
  rot_stiff: KIP, lat_stiff: KIP / 0.0254 ** 2, spring_disc: KIP / 0.0254,
};
const FACTORS = Object.values(F);

const PUBLIC_TOOLS = ['add_element', 'add_node', 'aisi_design_combined', 'aisi_design_compression',
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
};

// 호스트는 받지만 MCP 도구가 일부러 내놓지 않는 인자 — 까닭과 함께(검사 3b-a 의 예외)
const HOST_ONLY = {
  generate_template: { section_type: '도구 이름 · type 인자가 정한다', params: '도구 인자 전체가 params 로 간다' },
  classify: { GBTcon: '설정은 set_gbtcon 으로 모델에 둔다' },
  prepare_design_dsm: { '*': 'GUI 전용 action — 패널이 설계 때 스스로 준비한다' },
  apply_deck_springs: { '*': 'GUI 전용 action — MCP 는 set_springs' },
  generate_report: {
    fy: 'Fy 의 별칭(GUI 호환)', '*design': '부재 설계 인자는 aisi_design_* 가 내놓는다 — generate_report 는 마지막 설계를 쓰라고 설명',
    '*loads': '하중 인자는 analyze_loads 가 내놓는다 — generate_report 는 마지막 하중 분석을 쓴다',
  },
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
};

function transpile(outDir) {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  fs.mkdirSync(outDir, { recursive: true });
  // K1: server.ts · bridge.ts 가 hostConnection · portFile 을 import 한다
  for (const f of ['server', 'siUnits', 'bridge', 'hostConnection', 'portFile']) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp', `${f}.ts`), 'utf8');
    const js = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    fs.writeFileSync(path.join(outDir, `${f}.js`), js);
  }
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
function comparePhysical(tool, us, siR, spot) {
  assert(!us.error, `${tool} US errored: ${us.error}`);
  assert.strictEqual(siR.units, 'SI', `${tool} SI result labelled`);
  assert.strictEqual(siR.text_units, 'US', `${tool} SI text labelled US`);
  assert(!siR.si_unconverted, `${tool}: ${siR.si_unconverted && siR.si_unconverted.length} numeric keys with no unit in the table: ${JSON.stringify((siR.si_unconverted || []).slice(0, 40))}`);
  const lu = leaves(us);
  const ls = leaves(siR);
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
      const ok = Math.abs(ratio - 1) < 1e-12 || FACTORS.some((f) => Math.abs(ratio / f - 1) < 1e-12);
      assert(ok, `${tool}: ${p} US ${v} → SI ${s} (ratio ${ratio} is not 1 or a unit factor)`);
      if (Math.abs(ratio - 1) >= 1e-12) { converted++; }
    } else if (/\.unit$/.test(p) || /\.formula_units$/.test(p) || /\.units$/.test(p)) {
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
      async handleMcpAction(body) { recorded.push(JSON.parse(JSON.stringify(body))); return target.handleMcpAction(body); },
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
      return { isError: !!r.isError, data, body: recorded[0] };
    };

    // 1. 도구 이름 --------------------------------------------------------------
    const tools = (await client.listTools()).tools;
    assert.deepStrictEqual(tools.map((t) => t.name).sort(), [...PUBLIC_TOOLS].sort(), 'tool names are the public contract');
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const props = (name) => Object.keys(byName[name].inputSchema.properties || {}).filter((k) => k !== 'units');

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
    engineKeys.aisi_design = [...new Set([...aisiSrc.matchAll(/params\.get\('([A-Za-z_0-9]+)'/g)].map((m) => m[1]))];
    const lapSrc = fs.readFileSync(path.join(ROOT, 'python', 'design', 'lap_connection.py'), 'utf8');
    engineKeys.lap_connection = [...new Set([...lapSrc.matchAll(/params\.get\('([A-Za-z_0-9]+)'/g)].map((m) => m[1])
      .concat(['Pnvs', 'Fub', 'bolt_grade', 'threads_excluded', 'mf', 'hole_type']))];
    engineKeys.aisi_guide = ['query_type'];
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
      engineKeys.design_connection = sigs._connection;
      for (const [tool, names] of Object.entries(sigs)) {
        if (tool.startsWith('_')) { continue; }
        // analyze_loads 의 Fy · Fu 는 호스트가 모델에서 section 을 만들 때만 쓰는 호스트 인자(엔진에 직접 가지 않음)
        const hostArgs = tool === 'analyze_loads' ? ['Fy', 'Fu'] : [];
        for (const k of props(tool)) { assert(names.includes(k) || hostArgs.includes(k), `${tool}.${k} is not a parameter of the engine function`); }
      }
      for (const tool of ['aisi_design_connection', 'design_connection']) {
        for (const k of props(tool)) { assert(sigs._connection.includes(k), `${tool}.${k} is not a design_connection key`); }
      }
    }
    for (const tool of ['aisi_design_compression', 'aisi_design_flexure', 'aisi_design_combined', 'aisi_design_tension']) {
      for (const k of props(tool)) { assert(engineKeys.aisi_design.includes(k), `${tool}.${k} is not read by design_member`); }
    }
    for (const k of props('design_lap_connection')) { assert(engineKeys.lap_connection.includes(k), `design_lap_connection.${k}`); }

    // 3b. 호스트 ↔ 스키마 (V4-05) --------------------------------------------------
    const { out: host } = hostAcceptedParams(engineKeys);
    const loadKeys = new Set(props('analyze_loads'));
    const memberKeys = new Set(['aisi_design_compression', 'aisi_design_flexure', 'aisi_design_combined',
      'aisi_design_tension'].flatMap(props));
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
        if (action === 'generate_report' && (memberKeys.has(k) || loadKeys.has(k)
          || engineKeys.aisi_design.includes(k))) { continue; }
        if (action === 'aisi_design' && engineKeys.design_connection && engineKeys.design_connection.includes(k)
          && offered.has(k)) { continue; }
        // design_member 의 params.get 키 가운데 접합 디스패처로만 가는 키(connection)는 aisi_design_connection 이 내놓는다
        gaps.push(`host action '${action}' accepts '${k}' but no MCP tool (${toolsFor.join(', ')}) offers it`);
      }
      // (b) 도구가 보내는데 호스트가 받지 않는 인자 → 조용히 버려짐
      const dictLike = ['aisi_design', 'design_connection', 'lap_connection', 'aisi_guide', 'generate_report'].includes(action);
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
    const missingFy = await call('aisi_design_compression', { KxLx: 120, KyLy: 60 });
    assert(missingFy.isError && missingFy.body === undefined, 'Fy is required by the schema (no 35.53)');

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

    // 7. US / SI (실제 패널) ----------------------------------------------------------
    const usVsSi = async (tool, usArgs, siSpec, spot, extra = {}) => {
      const a = await call(tool, usArgs);
      const b = await call(tool, { ...toSIArgs(usArgs, siSpec), units: 'SI' });
      assert(!a.isError, `${tool} US: ${JSON.stringify(a.data).slice(0, 400)}`);
      assert(!b.isError, `${tool} SI: ${JSON.stringify(b.data).slice(0, 400)}`);
      assert.deepStrictEqual(b.body, a.body, `${tool}: SI input must reach the panel as the identical US values`);
      const n = comparePhysical(tool, a.data, b.data, spot);
      if (extra.check) { extra.check(a.data, b.data); }
      results.push(`${tool}: ${n} numeric fields converted, verdict ${JSON.stringify(a.data.pass)} = ${JSON.stringify(b.data.pass)}`);
      return [a.data, b.data];
    };
    const L = 'length'; const S = 'stress'; const Fo = 'force'; const M = 'moment'; const A = 'area';
    await usVsSi('aisi_design_compression', { Fy: 50, Fu: 65, KxLx: 120, KyLy: 60, KtLt: 60, Pu: 5 },
      { Fy: S, Fu: S, KxLx: L, KyLy: L, KtLt: L, Pu: Fo },
      { Pn: Fo, design_strength: Fo, Py: Fo, 'steps[0].value': Fo, utilization: 'none' },
      { check: (u, s) => { assert(s.report.startsWith('[UNITS'), 'report labelled US'); assert.strictEqual(s.steps[0].unit, 'kN'); } });
    await usVsSi('aisi_design_tension', { Fy: 50, Fu: 65, Tu: 10, An: 0.5 }, { Fy: S, Fu: S, Tu: Fo, An: A },
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
    await usVsSi('aisi_design_connection', { connection_type: 'paf', Fy: 33, Fu: 45, t1: 0.036, t2: 0.25, d: 0.145,
      n: 2, e: 1.0, s: 1.0, Vu: 0.3, Fuf: 260, dw: 0.5, member_case: 'flat_sheet', Ag: 0.2, width: 4 },
    CONN, { 'limit_states[0].Rn': Fo });
    await usVsSi('design_lap_connection', { d: 8, t: 0.059, Fy: 50, Fu: 65, lap_left_in: 24, lap_right_in: 24,
      Mu_support: 200, Vu_support: 2, fastener_type: 'bolt', fastener_dia: 0.5, n_rows: 2, Se: 1.0, Sf: 1.1,
      Mnd: 60, Vn: 8, end_distance: 1.5, Fub: 60 },
    { d: L, t: L, Fy: S, Fu: S, lap_left_in: L, lap_right_in: L, Mu_support: M, Vu_support: Fo, fastener_dia: L,
      Se: 'modulus', Sf: 'modulus', Mnd: M, Vn: Fo, end_distance: L, Fub: S },
    { Pns: Fo, V_transfer: Fo, Mn_lap: M, spacing: L, flexure_dcr: 'none' },
    { check: (u) => { assert(u.force_model, 'lap result carries force_model (in-house assumption)'); } });
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
      wc_support: 'EOF', Lb_pos: 30, Mu_pos: 20, Cb_pos: 1.1, dist_Lm: 24 },
    { Fy: S, Fu: S, Lb: L, Mu: M, Vu: Fo, wc_N: L, wc_R: L, Lb_pos: L, Mu_pos: M, dist_Lm: L },
    { Mn: M, phi_Mn: M, My: M, design_strength: M, 'positive_region.Mn': M, 'positive_region.Lb': L, 'shear.Vn': Fo,
      'Fcre_detail.Lb': L, 'Fcre_detail.Sf': 'modulus', 'Fcre_detail.J': 'inertia', 'Fcre_detail.Cw': 'warping',
      'Fcre_detail.sigma_ey': S, Fy_used: S, 'shear_interaction.total': 'none', 'web_crippling.Pn': Fo });
    await usVsSi('aisi_design_combined', { Fy: 50, Fu: 65, KxLx: 120, KyLy: 60, KtLt: 60, Lb: 60, Pu: 3, Mux: 30,
      Muy: 2, May_strength: 20, Vu: 1, Cmx: 0.85, Cmy: 1.0 },
    { Fy: S, Fu: S, KxLx: L, KyLy: L, KtLt: L, Lb: L, Pu: Fo, Mux: M, Muy: M, May_strength: M, Vu: Fo },
    { 'flexure_x.design_strength': M, 'compression.design_strength': Fo, 'amplification.PEx': Fo,
      'amplification.Mux_amp': M, 'interaction.total': 'none', 'shear.design_strength': Fo });
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
    const direct = JSON.parse(JSON.stringify(await real.panel.handleMcpAction({ action: 'design_purlin', ...purlinArgs })));
    const { units: _u, ...pUSnoUnits } = pUS;
    void _u;
    assert.deepStrictEqual(pUSnoUnits, direct, 'V4-05: MCP design_purlin = the host purlin function with the same inputs');
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
      { ...LOAD_SI, spans_ft: 'length_ft', laps_per_support: { left_ft: 'length_ft', right_ft: 'length_ft' } }, {});
    assert(findPath(ohUS, (k, v) => k === 'overhang_ft' && typeof v === 'number' && v > 0),
      'the overhang case really produces overhang_ft values (so the SI check covers them)');

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
    await usVsSi('generate_report', {}, {}, { 'section_props.A': A, 'section_props.Ixx': 'inertia',
      'cutwp_props.Cw': 'warping', 'load_analysis.input_loads_plf.D': 'linload' });
    await usVsSi('validate_design', { Fy: 50 }, { Fy: S }, { 'props.Ixx': 'inertia', 'cutwp.J': 'inertia' });

    // 진동 (S-S, 짧은 길이 목록)
    await ok('set_lengths', { min: 10, max: 100, n: 3 });
    await usVsSi('run_vibration', { rho: 7.345e-7, lengths: [10, 50, 100] }, { rho: 'density', lengths: 'length' },
      { 'rho_used.100': 'density', 'lengths[1]': 'length', 'size.n_lengths': 'none' },
      { check: (u, s) => assert.deepStrictEqual(s.frequencies, u.frequencies, 'Hz unchanged') });

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
