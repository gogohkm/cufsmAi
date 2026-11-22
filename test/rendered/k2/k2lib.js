/* global process */
// K2 0단계 — 지금 동작을 고정하는 시험의 공용 도구(제품 코드는 읽기만 한다).
//  - session(): 진짜 호스트(StcfsdPanel) + 진짜 파이썬 + 헤드리스 Edge 의 웹뷰 한 벌(test/rendered/lib.js 의 start).
//    호스트 ↔ 파이썬 경계(PythonBridge.call)를 가로채 엔진 요청을 그대로 적는다(JSON.stringify — 파이썬에 가는 바이트와 같은 글).
//  - mcp(): 진짜 MCP 서버 소스(src/mcp/*.ts 를 transpile, 이 시험의 out 폴더에) → stdio 클라이언트 → 진짜 McpBridgeServer → 그 패널.
//  - Golden: 고정한 값과 비교. expect 'pin' = K2 뒤에도 같아야 함, 'k2-change' = K2 가 일부러 바꿀 지금 동작(까닭과 함께).
'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const { start, sleep } = require('../lib');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, 'test', 'rendered', 'out', 'k2');
const GOLDEN_DIR = path.join(__dirname, 'golden');

let _sessionNo = 0;

/**
 * 엔진 요청 한 건의 글 — 파이썬에 실제로 가는 params 의 JSON(키 차례 그대로). 20 KB 를 넘는 것(앞 해석의 결과를 되돌려
 * 보내는 classify_detailed 등)은 sha256 · 길이 · 앞부분만 — 바이트가 같은지는 해시로 본다.
 */
function wire(params) {
  const s = JSON.stringify(params === undefined ? null : params);
  if (s.length <= 20000) { return s; }
  return { sha256: require('crypto').createHash('sha256').update(s).digest('hex'), length: s.length, head: s.slice(0, 300) };
}

/** 키를 정렬한 JSON(차례만 다른지 가려 보는 데). */
function sortedJson(v) {
  const walk = (x) => {
    if (Array.isArray(x)) { return x.map(walk); }
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) { o[k] = walk(x[k]); } return o; }
    return x;
  };
  return JSON.stringify(walk(JSON.parse(JSON.stringify(v === undefined ? null : v))));
}

async function session(name, opts = {}) {
  _sessionNo += 1;
  const outDir = path.join(OUT, 'sess', name);
  fs.mkdirSync(outDir, { recursive: true });
  const ctx = await start({ outDir, httpPort: 47860 + _sessionNo, cdpPort: 9380 + _sessionNo, ...opts });
  // 호스트 → 파이썬 경계에서 엔진 요청을 적는다.
  const calls = [];
  const orig = ctx.bridge.call.bind(ctx.bridge);
  ctx.bridge.call = async (method, params) => {
    // PythonBridge.call 이 빼는 전송 키(action)를 같은 규칙으로 뺀 글 = 파이썬이 받는 params
    let p = params;
    if (p && typeof p === 'object' && !Array.isArray(p) && 'action' in p) { const { action: _a, ...rest } = p; void _a; p = rest; }
    const rec = { method, params: wire(p) };
    calls.push(rec);
    try { return await orig(method, params); } catch (e) { rec.error = String(e && e.message || e); throw e; }
  };
  ctx.engine = calls;
  ctx.name = name;
  ctx.outDir = outDir;
  ctx.engineMark = () => calls.length;
  ctx.engineSince = (i) => calls.slice(i).filter((c) => c.method !== 'ping');
  const close0 = ctx.close.bind(ctx);
  ctx.close = async () => {
    await close0();
    await sleep(300);
    try { fs.rmSync(path.join(outDir, 'edge-profile'), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Edge 가 아직 쥐고 있으면 남긴다(out 은 git 밖) */ }
  };
  return ctx;
}

// ── 화면 조작(test/rendered/run.js 와 같은 방식) ─────────────────────────────
async function genTemplate(ctx, type, dims) {
  await ctx.tab('preprocessor');
  await ctx.setVal('select-template', type);
  for (const [k, v] of Object.entries(dims)) { await ctx.setVal(k, v); }
  const m = ctx.mark();
  await ctx.click('#btn-generate-template');
  await ctx.waitMsg('templateGenerated', m.h2w, 60000);
  await ctx.settle(300);
}

async function runAnalysisGui(ctx) {
  await ctx.tab('design');
  const m = ctx.mark();
  await ctx.click('#btn-run-analysis');
  await ctx.waitMsg('analysisComplete', m.h2w, 300000);
  await ctx.waitMsg('designDsmPrepared', m.h2w, 300000).catch(() => {});
  await ctx.settle(300);
}

async function clickAndWait(ctx, sel, command, timeout = 300000) {
  const m = ctx.mark();
  await ctx.click(sel);
  await ctx.waitMsg(command, m.h2w, timeout);
  await ctx.settle(400);
}

/** 결과 칸의 보이는 글(공백을 줄인 것). */
async function shownText(ctx, ids) {
  return ctx.eval(`(()=>{const o={}; for (const id of ${JSON.stringify(ids)}) { const e=document.getElementById(id);
    o[id] = e ? String(e.innerText||'').replace(/[ \\t]+/g,' ').replace(/\\s*\\n\\s*/g,'\\n').trim() : null; } return o;})()`);
}

/** 입력 칸 전부(designState FIELDS 의 id + 경간 표). 체크는 bool, 그 밖은 칸의 글 그대로. */
async function snapshotInputs(ctx) {
  return ctx.eval(`(()=>{const ds=globalThis.StcfsdDesignState; const o={};
    for (const [, id] of ds.FIELDS) { const e=document.getElementById(id); if(!e) { o[id]=null; continue; }
      o[id] = e.type==='checkbox' ? !!e.checked : String(e.value); }
    const q=(s)=>[...document.querySelectorAll(s)].map(e=>String(e.value));
    o['.span-tbl-len']=q('.span-tbl-len'); o['.span-tbl-sup']=q('.span-tbl-sup');
    o['.span-tbl-lapl']=q('.span-tbl-lapl'); o['.span-tbl-lapr']=q('.span-tbl-lapr');
    o.__unitSystem = document.getElementById('btn-unit-SI') && document.getElementById('btn-unit-SI').classList.contains('active') ? 'SI' : 'US';
    return o;})()`);
}

function diffInputs(a, b) {
  const out = {};
  for (const k of Object.keys(b)) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { out[k] = { before: a[k], after: b[k] }; }
  }
  return out;
}

// ── MCP 사슬(src/mcp 를 이 시험의 out 폴더로 transpile) ─────────────────────────
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function mcp(ctx) {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  const { Client } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'index.js'));
  const { StdioClientTransport } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'stdio.js'));
  const dir = path.join(ctx.outDir, 'mcpjs');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['server', 'siUnits', 'bridge', 'portFile', 'hostConnection']) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp', `${f}.ts`), 'utf8');
    fs.writeFileSync(path.join(dir, `${f}.js`), ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText);
  }
  const { McpBridgeServer } = require(path.join(dir, 'bridge.js'));
  const port = await freePort();
  const bridge = new McpBridgeServer(() => ctx.panel, port);
  await bridge.start();
  // MCP 서버가 사용자 폴더(포트 파일 · 재시작 기록)를 쓰지 않게: 포트 파일 변수는 주지 않고 옛 방식(STCFSD_MCP_PORT)으로만.
  const env = { ...process.env, STCFSD_MCP_PORT: String(port), NODE_PATH: path.join(ROOT, 'node_modules') };
  delete env.STCFSD_MCP_PORT_FILE; delete env.STCFSD_MCP_STANDALONE;
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(dir, 'server.js')], env, stderr: 'pipe' });
  const client = new Client({ name: 'stcfsd-k2-pin', version: '1.0.0' });
  await client.connect(transport);
  return {
    async call(name, args) {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content && r.content[0] && r.content[0].text) || '';
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { isError: !!r.isError, data, text };
    },
    async close() {
      try { await client.close(); } catch { /* */ }
      try { bridge.stop(); } catch { /* */ }
    },
  };
}

// ── 고정값(golden) ─────────────────────────────────────────────────────────
// 명령줄: --record (전부 다시 씀) · --accept=id1,id2 (그 id 만 지금 값으로 다시 쓰고 expect 를 'pin' 으로)
const ARGV = process.argv.slice(2);
const RECORD_ALL = ARGV.includes('--record');
const ACCEPT = new Set((ARGV.find((a) => a.startsWith('--accept=')) || '').replace('--accept=', '').split(',').filter(Boolean));

class Golden {
  constructor(name) {
    this.name = name;
    this.file = path.join(GOLDEN_DIR, name + '.json');
    this.old = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : null;
    this.entries = [];
    this.mismatch = [];
    this.fresh = !this.old;
  }
  /** value 는 JSON 으로 적을 수 있는 값. meta: { expect: 'pin'|'k2-change', reason } */
  check(id, value, meta = {}) {
    const expect = meta.expect || 'pin';
    const v = JSON.parse(JSON.stringify(value === undefined ? null : value));
    const prev = this.old && this.old.entries.find((e) => e.id === id);
    let entry = { id, expect, ...(meta.reason ? { reason: meta.reason } : {}), value: v };
    if (prev && !RECORD_ALL && !ACCEPT.has(id)) {
      const same = JSON.stringify(prev.value) === JSON.stringify(v);
      if (!same) {
        const orderOnly = sortedJson(prev.value) === sortedJson(v);
        this.mismatch.push({ id, expect: prev.expect, reason: prev.reason, orderOnly, detail: firstDiff(prev.value, v) });
      }
      entry = { ...prev };   // 고정값은 그대로 둔다(비교만)
    } else if (prev && ACCEPT.has(id)) {
      entry = { id, expect: 'pin', ...(prev.reason ? { reason: prev.reason, accepted_from: prev.expect } : {}), value: v };
    } else if (!prev && this.old && !RECORD_ALL && !ACCEPT.has(id)) {
      this.mismatch.push({ id, expect, reason: 'new entry (not in the golden file) — run with --record or --accept=' + id, detail: '' });
    }
    this.entries.push(entry);
    return v;
  }
  save() {
    const write = this.fresh || RECORD_ALL || ACCEPT.size > 0;
    if (!write) { return false; }
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    const doc = { about: `K2 phase 0 golden — ${this.name}. Recorded from the current code; 'k2-change' entries are the behaviour K2 is meant to change.`,
      recorded: new Date().toISOString().slice(0, 10), entries: this.entries };
    fs.writeFileSync(this.file, JSON.stringify(doc, null, 1) + '\n');
    return true;
  }
}

function firstDiff(a, b, p = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) { return null; }
  if (typeof a === 'string' && typeof b === 'string') {
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) { i++; }
    return `${p || '(value)'}: …${JSON.stringify(a.slice(Math.max(0, i - 60), i + 80))} → …${JSON.stringify(b.slice(Math.max(0, i - 60), i + 80))}`;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) { const d = firstDiff(a[k], b[k], p ? `${p}.${k}` : k); if (d) { return d; } }
  }
  return `${p || '(value)'}: ${JSON.stringify(a)?.slice(0, 160)} → ${JSON.stringify(b)?.slice(0, 160)}`;
}

module.exports = { ROOT, OUT, GOLDEN_DIR, session, genTemplate, runAnalysisGui, clickAndWait, shownText, snapshotInputs, diffInputs,
  mcp, Golden, wire, sortedJson, sleep, RECORD_ALL, ACCEPT };
