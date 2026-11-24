/* global process */
// W3 — 렌더 시험용 MCP 사슬: 진짜 MCP 서버 소스(src/mcp/*.ts 를 transpile) → MCP SDK 클라이언트(stdio) →
// 진짜 브리지(McpBridgeServer, 127.0.0.1 빈 포트) → 렌더 시험의 진짜 패널(ctx.panel).
// 화면이 실제로 보낸 본문을 MCP 도구 스키마에 그대로 넣어 보는 데 쓴다(V4-31). 저장소 파일은 읽기만 한다.
'use strict';
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function transpile(outDir) {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  fs.mkdirSync(outDir, { recursive: true });
  // server · bridge 가 불러오는 지역 모듈(hostConnection · portFile)도 함께 — 빠지면 사슬이 "Cannot find module" 로 멈춘다.
  void ts;
  require(path.join(ROOT, 'test', 'webview', 'mcp_transpile.js')).transpileMcp(outDir, ['server', 'siUnits', 'bridge', 'portFile', 'hostConnection']);
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/** panel 에 붙은 MCP 클라이언트. 반환 { call(name, args) → {isError, data, text}, close() } */
async function startMcp(panel) {
  const { Client } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'index.js'));
  const { StdioClientTransport } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'stdio.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-rendered-mcp-'));
  transpile(tmp);
  const { McpBridgeServer } = require(path.join(tmp, 'bridge.js'));
  const port = await freePort();
  const bridge = new McpBridgeServer(() => panel, port);
  await bridge.start();
  const transport = new StdioClientTransport({
    command: process.execPath, args: [path.join(tmp, 'server.js')],
    env: { ...process.env, STCFSD_MCP_PORT: String(port), NODE_PATH: path.join(ROOT, 'node_modules') },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stcfsd-w3-rendered', version: '1.0.0' });
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
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}

module.exports = { startMcp };
