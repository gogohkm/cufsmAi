// 로컬 MCP 등록 모듈 계약 테스트.
// - registration.ts 순수함수 단위 테스트 (병합/해제/조회)
// - 명령 등록 tripwire (package.json + extension.ts)
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function loadRegistration() {
  const ts = require('../../node_modules/typescript');
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'mcp', 'registration.ts'), 'utf8');
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
  const reg = loadRegistration();
  const cfg = reg.buildServerConfig('/x/media/mcp-server.js', 52790);
  assert.strictEqual(cfg.command, 'node', 'command node');
  assert.deepStrictEqual(cfg.args, ['/x/media/mcp-server.js'], 'args bundle path');
  assert.strictEqual(cfg.env.STCFSD_MCP_PORT, '52790', 'env port string');

  // 신규 파일
  let m = reg.mergeServerConfig(undefined, 'k', cfg);
  assert(m.ok && m.changed, 'fresh merge');
  assert.deepStrictEqual(JSON.parse(m.text), { mcpServers: { k: cfg } }, 'fresh shape');

  // 기존 서버 보존 병합
  const other = { mcpServers: { other: { command: 'x', args: [], env: {} } } };
  m = reg.mergeServerConfig(JSON.stringify(other), 'k', cfg);
  assert(m.ok && m.changed, 'merge changed');
  const merged = JSON.parse(m.text);
  assert.deepStrictEqual(merged.mcpServers.other, other.mcpServers.other, 'other server kept');
  assert.deepStrictEqual(merged.mcpServers.k, cfg, 'our server added');

  // 동일 내용 재등록 → changed false
  m = reg.mergeServerConfig(m.text, 'k', cfg);
  assert(m.ok && !m.changed, 'idempotent');

  // 깨진 JSON은 덮어쓰지 않음
  m = reg.mergeServerConfig('{oops', 'k', cfg);
  assert(!m.ok, 'broken JSON rejected');
  m = reg.mergeServerConfig('[1,2]', 'k', cfg);
  assert(!m.ok, 'non-object rejected');

  // 해제: 우리 것만 제거
  let r = reg.removeServerConfig(JSON.stringify(merged), 'k');
  assert(r.ok && r.removed, 'removed');
  assert.deepStrictEqual(JSON.parse(r.text).mcpServers, other.mcpServers, 'others kept');
  r = reg.removeServerConfig(JSON.stringify(other), 'k');
  assert(r.ok && !r.removed, 'not registered');
  r = reg.removeServerConfig(undefined, 'k');
  assert(r.ok && !r.removed, 'missing file');
  r = reg.removeServerConfig('{oops', 'k');
  assert(!r.ok, 'broken JSON not touched');

  // 스코프 경로
  const both = reg.configPathsForScope('both', { workspaceRoot: '/ws', homeDir: '/home/u' });
  assert.deepStrictEqual(both, ['/ws/.mcp.json', '/ws/.claude/mcp.json', '/home/u/.claude/mcp.json'],
    'both paths');
  assert.deepStrictEqual(
    reg.configPathsForScope('workspace', { homeDir: '/home/u' }), [],
    'no workspace root -> empty');

  // 상태 조회
  let st = reg.inspectRegistration('/a', undefined, 'k');
  assert(!st.exists && !st.registered, 'missing state');
  st = reg.inspectRegistration('/a', JSON.stringify(merged), 'k');
  assert(st.registered && st.port === '52790', 'registered with port');
  st = reg.inspectRegistration('/a', '{oops', 'k');
  assert(st.exists && st.error, 'broken state');

  // 명령 등록 tripwire
  const pkg = JSON.parse(readUtf8('package.json'));
  const cmds = pkg.contributes.commands.map((c) => c.command);
  for (const c of ['stcfsd.registerMcpServer', 'stcfsd.unregisterMcpServer', 'stcfsd.showMcpStatus']) {
    assert(cmds.includes(c), `package.json must contribute ${c}`);
  }
  const extTs = readUtf8(path.join('src', 'extension.ts'));
  for (const c of ['stcfsd.registerMcpServer', 'stcfsd.unregisterMcpServer', 'stcfsd.showMcpStatus']) {
    assert(extTs.includes(`registerCommand('${c}'`), `extension must register ${c}`);
  }
  // 덮어쓰기 금지 tripwire: 워크스페이스 직접 writeFileSync(mcpJson) 패턴 제거 확인
  assert(!extTs.includes("fs.writeFileSync(path.join(wsRoot, '.mcp.json'), mcpJson)"),
    'workspace clobber pattern must be gone');

  // 패널뷰(트리) + 타이틀 메뉴 tripwire
  const providerTs = readUtf8(path.join('src', 'webview', 'ProjectExplorerProvider.ts'));
  assert(providerTs.includes("sectionId: 'mcp-server'"), 'tree must have MCP root');
  assert(providerTs.includes("commandId: 'stcfsd.registerMcpServer'"), 'tree must run register');
  assert(providerTs.includes("commandId: 'stcfsd.unregisterMcpServer'"), 'tree must run unregister');
  assert(providerTs.includes("commandId: 'stcfsd.showMcpStatus'"), 'tree must run status');
  assert(extTs.includes("sectionId === 'mcp-server'"), 'selection must skip MCP container');
  const titleMenus = pkg.contributes.menus['view/title'] || [];
  assert(titleMenus.some((m) => m.command === 'stcfsd.registerMcpServer'),
    'view/title must offer register');

  console.log('mcp_registration_contract: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
