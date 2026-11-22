// K1 (2026-11-22): Claude Desktop 등록 도우미(src/mcp/claudeDesktop.ts)의 계약 — 가짜 설정 파일만 쓴다.
//
// 새 파일 · 다른 항목 보존(값 · 들여쓰기 · CRLF · BOM) · 이미 같음(쓰지 않음) · 낡은 항목 고침 · 깨진 JSON 거절 ·
// Claude 폴더가 없으면 만들지 않음 · 쓰기 전 백업 · 임시 파일 남지 않음 · 끊기는 자기 항목만, 상태 5 가지,
// 설정 파일 후보(Windows standard · MSIX, macOS, Linux)와 고르는 순서. 진짜 설정은 열지 않는다(real_config_guard.js).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');
const { snapshotRealConfigs } = require('./real_config_guard.js');

const ROOT = path.resolve(__dirname, '..', '..');

function transpile(outDir) {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of ['claudeDesktop', 'portFile']) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp', `${f}.ts`), 'utf8');
    const js = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    fs.writeFileSync(path.join(outDir, `${f}.js`), js);
  }
}

const backups = (file) => fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(path.basename(file) + '.stcfsd-backup-'));
const temps = (file) => fs.readdirSync(path.dirname(file)).filter((n) => n.includes('.stcfsd-tmp-'));
const mtime = (file) => fs.statSync(file).mtimeMs;

function main() {
  const guard = snapshotRealConfigs();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-k1-claude-'));
  try {
    transpile(path.join(tmp, 'js'));
    const reg = require(path.join(tmp, 'js', 'claudeDesktop.js'));
    assert.strictEqual(reg.CLAUDE_DESKTOP_SERVER_KEY, 'stcfsd');

    // 가짜 Windows 사용자: 홈 · APPDATA · LOCALAPPDATA 가 모두 임시 폴더
    const home = path.join(tmp, 'home');
    const env = { APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local') };
    const win = { platform: 'win32', home, env };
    const appDir = reg.appDataDir(undefined, win);
    assert.strictEqual(appDir, path.win32.join(env.APPDATA, 'StCFSD'));
    const portFile = reg.standardPortFile(appDir, win);
    assert.strictEqual(portFile, path.win32.join(env.APPDATA, 'StCFSD', 'mcp', 'stcfsd-mcp-port'));
    const exe = path.win32.join(env.LOCALAPPDATA, 'Programs', 'StCFSD', 'StCFSD.exe');
    const script = reg.mcpServerScript(path.win32.join(env.LOCALAPPDATA, 'Programs', 'StCFSD', 'resources', 'app-root'), win);
    assert(script.endsWith(path.win32.join('app-root', 'media', 'mcp-server.js')));
    const entry = reg.standaloneMcpEntry({ command: exe, serverScript: script, portFile });
    assert.deepStrictEqual(entry, {
      command: exe, args: [script],
      env: { ELECTRON_RUN_AS_NODE: '1', STCFSD_MCP_PORT_FILE: portFile, STCFSD_MCP_STANDALONE: '1' },
    }, 'installed entry shape');
    assert.deepStrictEqual(reg.standaloneMcpEntry({ command: 'node', serverScript: script, portFile, electron: false }).env,
      { STCFSD_MCP_PORT_FILE: portFile, STCFSD_MCP_STANDALONE: '1' }, 'node entry has no ELECTRON_RUN_AS_NODE');

    // 후보 경로 --------------------------------------------------------------------------
    const cfgDir = path.join(env.APPDATA, 'Claude');
    const cfgFile = path.join(cfgDir, 'claude_desktop_config.json');
    let cands = reg.claudeConfigCandidates(win);
    assert.deepStrictEqual(cands, [{ kind: 'standard', path: cfgFile, dirExists: false, fileExists: false }]);
    assert.strictEqual(reg.claudeDesktopConfigPath('darwin', '/Users/u'), '/Users/u/Library/Application Support/Claude/claude_desktop_config.json');
    assert.strictEqual(reg.claudeDesktopConfigPath('linux', '/home/u'), '/home/u/.config/Claude/claude_desktop_config.json');
    assert.strictEqual(reg.claudeDesktopConfigPath('win32', 'C:\\Users\\u'), 'C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
    assert.strictEqual(reg.appDataDir(undefined, { platform: 'darwin', home: '/Users/u', env: {} }), '/Users/u/Library/Application Support/StCFSD');
    assert.strictEqual(reg.appDataDir(undefined, { platform: 'linux', home: '/home/u', env: {} }), '/home/u/.config/StCFSD');

    // 1. 미설치: 폴더를 만들지 않는다 ---------------------------------------------------------
    const opts = { entry, pathOptions: win, now: () => new Date(2026, 10, 22, 9, 30, 0) };
    let st = reg.checkClaudeDesktop(opts);
    assert.strictEqual(st.state, 'not-installed');
    let r = reg.connectClaudeDesktop(opts);
    assert.deepStrictEqual([r.ok, r.reason], [false, 'claude-not-installed']);
    assert(!fs.existsSync(cfgDir), 'Claude folder not created');
    assert.strictEqual(reg.disconnectClaudeDesktop(opts).reason, 'claude-not-installed');
    assert(!fs.existsSync(cfgDir));

    // 2. 새 파일 ---------------------------------------------------------------------------
    fs.mkdirSync(cfgDir, { recursive: true });
    st = reg.checkClaudeDesktop(opts);
    assert.deepStrictEqual([st.state, st.configPath, st.configExists], ['not-registered', cfgFile, false]);
    r = reg.connectClaudeDesktop(opts);
    assert(r.ok && r.action === 'created' && r.wrote && r.restartRequired && r.backupPath === undefined, JSON.stringify(r));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')), { mcpServers: { stcfsd: entry } });
    assert.strictEqual(reg.checkClaudeDesktop(opts).state, 'registered');
    assert.deepStrictEqual(temps(cfgFile), [], 'no temp file left');

    // 3. 이미 같음 — 쓰지 않는다 -------------------------------------------------------------
    const t0 = mtime(cfgFile);
    r = reg.connectClaudeDesktop(opts);
    assert(r.ok && r.action === 'unchanged' && !r.wrote && !r.restartRequired);
    assert.strictEqual(mtime(cfgFile), t0);
    assert.deepStrictEqual(backups(cfgFile), []);

    // 4. 다른 항목 보존 + 백업(4 칸 들여쓰기, CRLF, BOM, 다른 최상위 키) ----------------------------------
    const original = '\ufeff{\r\n    "globalShortcut": "Ctrl+Space",\r\n    "mcpServers": {\r\n        "windload": {\r\n            "command": "C:\\\\x\\\\wl.exe",\r\n            "args": ["--stdio"],\r\n            "env": {"A": "1"}\r\n        },\r\n        "other": {"command": "npx", "args": ["-y", "pkg@1.2.3"]}\r\n    },\r\n    "preferences": {"menuBarEnabled": false, "n": 1.5}\r\n}\r\n';
    fs.writeFileSync(cfgFile, original);
    const parsedOriginal = JSON.parse(original.slice(1));
    st = reg.checkClaudeDesktop(opts);
    assert.deepStrictEqual([st.state, st.others], ['not-registered', ['windload', 'other']]);
    r = reg.connectClaudeDesktop(opts);
    assert(r.ok && r.action === 'added' && r.wrote, JSON.stringify(r));
    assert.deepStrictEqual(r.others, ['windload', 'other']);
    assert.strictEqual(fs.readFileSync(r.backupPath, 'utf8'), original, 'backup is the original, byte for byte');
    assert.strictEqual(path.basename(r.backupPath), 'claude_desktop_config.json.stcfsd-backup-20261122-093000');
    let text = fs.readFileSync(cfgFile, 'utf8');
    assert(text.startsWith('\ufeff{\r\n    "globalShortcut"'), 'BOM, CRLF and 4-space indent kept');
    assert(!/[^\r]\n/.test(text), 'all line breaks stay CRLF');
    let cfg = JSON.parse(text.slice(1));
    assert.deepStrictEqual(Object.keys(cfg), ['globalShortcut', 'mcpServers', 'preferences'], 'top-level key order kept');
    assert.deepStrictEqual(Object.keys(cfg.mcpServers), ['windload', 'other', 'stcfsd'], 'ours appended');
    assert.deepStrictEqual(cfg.mcpServers.windload, parsedOriginal.mcpServers.windload);
    assert.deepStrictEqual(cfg.mcpServers.other, parsedOriginal.mcpServers.other);
    assert.deepStrictEqual(cfg.preferences, parsedOriginal.preferences);
    assert.strictEqual(cfg.globalShortcut, 'Ctrl+Space');
    assert.deepStrictEqual(cfg.mcpServers.stcfsd, entry);
    assert.deepStrictEqual(temps(cfgFile), []);

    // 5. 낡은 항목(다른 설치 경로) → registered-elsewhere → 고침, 자리 그대로 ----------------------------
    const stale = { command: 'D:\\old\\StCFSD.exe', args: ['D:\\old\\media\\mcp-server.js'], env: { ELECTRON_RUN_AS_NODE: '1', STCFSD_MCP_PORT_FILE: portFile } };
    cfg.mcpServers = { stcfsd: stale, windload: cfg.mcpServers.windload };
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
    st = reg.checkClaudeDesktop(opts);
    assert.deepStrictEqual([st.state, st.current], ['registered-elsewhere', stale]);
    const nBackups = backups(cfgFile).length;
    r = reg.connectClaudeDesktop({ ...opts, now: () => new Date(2026, 10, 22, 9, 30, 0) });
    assert(r.ok && r.action === 'updated', JSON.stringify(r));
    assert.deepStrictEqual(r.previous, stale, 'previous entry reported');
    assert.strictEqual(backups(cfgFile).length, nBackups + 1, 'a second backup in the same second gets its own name');
    assert(path.basename(r.backupPath).endsWith('-2'));
    cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    assert.deepStrictEqual(Object.keys(cfg.mcpServers), ['stcfsd', 'windload'], 'updated in place');
    assert.deepStrictEqual(cfg.mcpServers.stcfsd, entry);
    // 같은 값이지만 env 키 순서가 다름 → 이미 같음
    cfg.mcpServers.stcfsd = { args: entry.args, command: entry.command, env: { STCFSD_MCP_STANDALONE: '1', STCFSD_MCP_PORT_FILE: portFile, ELECTRON_RUN_AS_NODE: '1' } };
    fs.writeFileSync(cfgFile, JSON.stringify(cfg));
    assert.strictEqual(reg.checkClaudeDesktop(opts).state, 'registered');
    // 다른 키가 하나 더 있으면 같지 않다
    cfg.mcpServers.stcfsd = { ...entry, disabled: true };
    fs.writeFileSync(cfgFile, JSON.stringify(cfg));
    assert.strictEqual(reg.checkClaudeDesktop(opts).state, 'registered-elsewhere');

    // 6. 끊기: 다른 항목이면 그대로, 같으면 그것만 지운다 ---------------------------------------------
    const t1 = mtime(cfgFile);
    const nb = backups(cfgFile).length;
    r = reg.disconnectClaudeDesktop(opts);
    assert(r.ok && r.action === 'kept' && !r.wrote, 'different stcfsd entry is kept');
    assert.strictEqual(mtime(cfgFile), t1);
    assert.strictEqual(backups(cfgFile).length, nb);
    cfg.mcpServers.stcfsd = entry;
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    r = reg.disconnectClaudeDesktop(opts);
    assert(r.ok && r.action === 'removed' && r.wrote && r.backupPath, JSON.stringify(r));
    cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    assert.deepStrictEqual(Object.keys(cfg.mcpServers), ['windload'], 'only our entry removed');
    assert.deepStrictEqual(cfg.mcpServers.windload, parsedOriginal.mcpServers.windload);
    assert.strictEqual(reg.disconnectClaudeDesktop(opts).action, 'absent');
    assert.strictEqual(reg.checkClaudeDesktop(opts).state, 'not-registered');

    // 7. 깨진 JSON · 모양이 이상한 설정: 손대지 않고 백업도 없다 ---------------------------------------
    for (const bad of ['{ "mcpServers": { "a": 1, } ', '[1,2]', '{"mcpServers": []}', '{"mcpServers": "x"}']) {
      fs.writeFileSync(cfgFile, bad);
      const tb = mtime(cfgFile);
      const nbb = backups(cfgFile).length;
      assert.strictEqual(reg.checkClaudeDesktop(opts).state, 'invalid-config', bad);
      r = reg.connectClaudeDesktop(opts);
      assert.deepStrictEqual([r.ok, r.reason], [false, 'invalid-config'], bad);
      r = reg.disconnectClaudeDesktop(opts);
      assert.deepStrictEqual([r.ok, r.reason], [false, 'invalid-config'], bad);
      assert.strictEqual(fs.readFileSync(cfgFile, 'utf8'), bad, 'invalid file untouched');
      assert.strictEqual(mtime(cfgFile), tb);
      assert.strictEqual(backups(cfgFile).length, nbb, 'no backup of an invalid file');
    }
    // 빈 파일은 {} 로 본다
    fs.writeFileSync(cfgFile, '');
    r = reg.connectClaudeDesktop(opts);
    assert(r.ok && r.action === 'added');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')), { mcpServers: { stcfsd: entry } });

    // 8. MSIX 후보와 고르는 순서 -----------------------------------------------------------------
    const msixDir = path.join(env.LOCALAPPDATA, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
    fs.mkdirSync(msixDir, { recursive: true });
    fs.mkdirSync(path.join(env.LOCALAPPDATA, 'Packages', 'Microsoft.Other'), { recursive: true });
    cands = reg.claudeConfigCandidates(win);
    assert.deepStrictEqual(cands.map((c) => c.kind), ['standard', 'msix']);
    assert.strictEqual(reg.pickClaudeConfig(cands).kind, 'standard', 'standard folder exists, MSIX has no file yet');
    fs.writeFileSync(path.join(msixDir, 'claude_desktop_config.json'), '{}');
    cands = reg.claudeConfigCandidates(win);
    assert.strictEqual(reg.pickClaudeConfig(cands).kind, 'msix', 'an MSIX file wins');
    assert.strictEqual(reg.checkClaudeDesktop(opts).configKind, 'msix');
    fs.rmSync(cfgDir, { recursive: true });
    fs.rmSync(path.join(msixDir, 'claude_desktop_config.json'));
    assert.strictEqual(reg.pickClaudeConfig(reg.claudeConfigCandidates(win)).kind, 'msix', 'MSIX folder when standard is missing');

    // 9. configPath 를 직접 주면 후보를 찾지 않는다 ---------------------------------------------------
    const given = path.join(tmp, 'given', 'cfg.json');
    assert.strictEqual(reg.checkClaudeDesktop({ entry, configPath: given }).state, 'not-installed');
    fs.mkdirSync(path.dirname(given));
    assert.strictEqual(reg.connectClaudeDesktop({ entry, configPath: given }).action, 'created');
    assert.strictEqual(reg.checkClaudeDesktop({ entry, configPath: given }).configKind, 'given');

    // 10. vscode 비의존, 확장이 부르지 않는다 ----------------------------------------------------------
    const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp', 'claudeDesktop.ts'), 'utf8');
    assert(!/from ['"]vscode['"]|require\(['"]vscode['"]\)/.test(src), 'no vscode import');
    assert(!fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8').includes('claudeDesktop'), 'the extension does not call it');

    const warnings = guard.verify(assert);
    for (const w of warnings) { console.log(w); }
    console.log(`claude_desktop_contract: PASS (fake configs only; ${guard.files.length} real config paths untouched)`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 무시 */ }
  }
}

try { main(); } catch (e) { console.error(e && e.stack || e); process.exit(1); }
