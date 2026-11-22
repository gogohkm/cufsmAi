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
const { Buffer } = require('buffer');
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

    // ─── V5 (2026-11-22): 독립 검증 V5-06 · V5-15 · V5-S5 ────────────────────────────────────────
    const vdir = path.join(tmp, 'v5', 'Claude');
    fs.mkdirSync(vdir, { recursive: true });
    const vcfg = path.join(vdir, 'claude_desktop_config.json');
    let tick = 0;
    const vopts = { entry, configPath: vcfg, pathOptions: { platform: 'win32' }, now: () => new Date(2026, 10, 22, 10, 0, tick++) };
    const otherServers = { windload: { command: 'C:\\x\\wl.exe', args: ['--stdio'], env: { API_KEY: 'secret' } } };

    // V5-06: 읽은 뒤 rename 앞에 다른 프로그램이 쓴다 — 임시 파일을 쓰는 순간에 끼워 넣는다(우리 rename 직전의 틈).
    const realWrite = fs.writeFileSync;
    const interleave = (times, make) => {
      let n = 0;
      fs.writeFileSync = function (p, ...rest) {
        const out = realWrite.call(this, p, ...rest);
        if (String(p).includes('.stcfsd-tmp-') && n < times) { n += 1; realWrite(vcfg, make(n)); }
        return out;
      };
      return () => { fs.writeFileSync = realWrite; return n; };
    };
    const concurrent = (n) => JSON.stringify({ mcpServers: { ...otherServers, [`added-by-claude-${n}`]: { command: 'npx', args: [String(n)] } } }, null, 2);
    realWrite(vcfg, JSON.stringify({ mcpServers: otherServers }, null, 2));
    let restore = interleave(1, concurrent);
    r = reg.connectClaudeDesktop(vopts);
    let interleaved = restore();
    assert.strictEqual(interleaved, 1, 'the concurrent write happened');
    cfg = JSON.parse(fs.readFileSync(vcfg, 'utf8'));
    assert(r.ok && r.action === 'added', JSON.stringify(r));
    assert(cfg.mcpServers['added-by-claude-1'], 'V5-06: a change written between our read and our rename is kept');
    assert.deepStrictEqual(cfg.mcpServers.stcfsd, entry, 'our single change applied on top of it');
    assert.deepStrictEqual(cfg.mcpServers.windload, otherServers.windload);
    assert.strictEqual(fs.readFileSync(r.backupPath, 'utf8'), concurrent(1), 'the backup is the content we actually replaced');
    assert.strictEqual(backups(vcfg).length, 1, 'the aborted attempt left no backup');
    assert.deepStrictEqual(temps(vcfg), []);
    // 끊기도 같다
    restore = interleave(1, (n) => JSON.stringify({ mcpServers: { ...JSON.parse(fs.readFileSync(vcfg, 'utf8')).mcpServers, [`late-${n}`]: { command: 'x' } } }));
    r = reg.disconnectClaudeDesktop(vopts);
    restore();
    cfg = JSON.parse(fs.readFileSync(vcfg, 'utf8'));
    assert(r.ok && r.action === 'removed', JSON.stringify(r));
    assert(cfg.mcpServers['late-1'] && cfg.mcpServers['added-by-claude-1'] && !cfg.mcpServers.stcfsd, 'disconnect keeps a concurrent change too');
    // 계속 바뀌면 덮어쓰지 않고 config-busy
    const nbBusy = backups(vcfg).length;
    restore = interleave(100, concurrent);
    r = reg.connectClaudeDesktop(vopts);
    interleaved = restore();
    assert.deepStrictEqual([r.ok, r.reason], [false, 'config-busy'], JSON.stringify(r));
    assert.strictEqual(interleaved, reg.CLAUDE_WRITE_ATTEMPTS, 'a small bounded number of attempts');
    assert.strictEqual(fs.readFileSync(vcfg, 'utf8'), concurrent(interleaved), 'the other program’s last write stands');
    assert.strictEqual(backups(vcfg).length, nbBusy, 'no backups left from the attempts');
    assert.deepStrictEqual(temps(vcfg), []);

    // V5-15(a): 같은 키가 두 번 — 손대지 않고 까닭을 밝힌다
    assert.strictEqual(reg.findDuplicateKey('{"a":1,"b":{"a":2},"c":[{"a":1},{"a":2}],"d":"\\"a\\":"}'), null, 'same name in different objects is fine');
    assert.strictEqual(reg.findDuplicateKey('{"mcpServers":{"a":{"command":"first"},"a":{"command":"second"}}}'), 'mcpServers.a');
    assert.strictEqual(reg.findDuplicateKey('{"x":[{"k":1,"k":2}]}'), 'x[0].k');
    assert.strictEqual(reg.findDuplicateKey('{"q\\u0022":1,"q\\"":2}'), 'q"', 'keys compared after unescaping');
    for (const dup of ['{"mcpServers":{"a":{"command":"first"},"a":{"command":"second"}}}', '{"globalShortcut":"A","globalShortcut":"B","mcpServers":{}}']) {
      realWrite(vcfg, dup);
      const tb = mtime(vcfg);
      const nbb = backups(vcfg).length;
      st = reg.checkClaudeDesktop(vopts);
      assert.strictEqual(st.state, 'invalid-config', dup);
      assert(/appears more than once/.test(st.configError), st.configError);
      r = reg.connectClaudeDesktop(vopts);
      assert.deepStrictEqual([r.ok, r.reason], [false, 'invalid-config']);
      r = reg.disconnectClaudeDesktop(vopts);
      assert.deepStrictEqual([r.ok, r.reason], [false, 'invalid-config']);
      assert.strictEqual(fs.readFileSync(vcfg, 'utf8'), dup, 'duplicate-key config untouched');
      assert.strictEqual(mtime(vcfg), tb);
      assert.strictEqual(backups(vcfg).length, nbb);
    }

    // V5-15(b): 하드 링크는 제자리에 써서 링크를 지킨다. 심볼릭 링크는 대상에(만들 수 있을 때만 — 개발자 모드 · 관리자)
    const realTarget = path.join(tmp, 'v5', 'real-config.json');
    realWrite(realTarget, JSON.stringify({ mcpServers: otherServers }, null, 2));
    fs.rmSync(vcfg);
    fs.linkSync(realTarget, vcfg);
    assert.strictEqual(fs.statSync(vcfg).nlink, 2);
    r = reg.connectClaudeDesktop(vopts);
    assert(r.ok && r.action === 'added', JSON.stringify(r));
    assert.strictEqual(fs.statSync(vcfg).nlink, 2, 'hard link kept');
    assert.strictEqual(fs.readFileSync(realTarget, 'utf8'), fs.readFileSync(vcfg, 'utf8'), 'both names see the new content');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(realTarget, 'utf8')).mcpServers.stcfsd, entry);
    r = reg.disconnectClaudeDesktop(vopts);
    assert(r.ok && r.action === 'removed' && fs.statSync(vcfg).nlink === 2);
    assert.deepStrictEqual(temps(vcfg), []);

    // V5b-07(a): 제자리 쓰기가 비운 뒤 실패(디스크 가득) → 읽었던 바이트로 되돌린다
    const beforeFail = fs.readFileSync(vcfg);
    const realWriteSync = fs.writeSync;
    let writeCalls = 0;
    fs.writeSync = function (...a) {
      // 새 글(우리 항목이 든 것)을 쓰는 첫 호출만 실패시킨다 — 백업 · 진행 표시 · 되돌리기 쓰기는 그대로
      const ours = Buffer.isBuffer(a[1]) && a[1].includes('"stcfsd"');
      if (ours) { writeCalls += 1; }
      if (ours && writeCalls === 1) { const e = new Error('ENOSPC: no space left on device, write'); e.code = 'ENOSPC'; throw e; }
      return realWriteSync.apply(this, a);
    };
    try { r = reg.connectClaudeDesktop(vopts); } finally { fs.writeSync = realWriteSync; }
    assert.strictEqual(writeCalls, 1, 'the in-place write of the new text failed once');
    assert.deepStrictEqual([r.ok, r.reason], [false, 'write-failed'], JSON.stringify(r));
    assert(/put back as it was/.test(r.error), r.error);
    assert(fs.readFileSync(vcfg).equals(beforeFail), 'V5b-07: config restored byte for byte after a failed in-place write');
    assert.strictEqual(fs.statSync(vcfg).nlink, 2, 'still a hard link');
    assert.deepStrictEqual(temps(vcfg), [], 'no in-place marker left after a restored failure');
    // V5b-07(b): 비운 직후 프로세스가 죽음(전원 · 강제 종료) → 빈 설정 + 진행 표시. 다음 읽기 · 연결은 손대지 않고 까닭을 밝힌다.
    const crashScript = `
      const fs = require('fs');
      const reg = require(${JSON.stringify(path.join(tmp, 'js', 'claudeDesktop.js'))});
      const w = fs.writeSync;
      fs.writeSync = function (...a) {           // 비운 뒤 새 글을 쓰는 순간 죽는다(백업 · 표시는 그 전에 다 썼다)
        if (Buffer.isBuffer(a[1]) && a[1].includes('"stcfsd"')) { process.exit(9); }
        return w.apply(this, a);
      };
      reg.connectClaudeDesktop({ entry: JSON.parse(process.argv[1]), configPath: ${JSON.stringify(vcfg)} });
      process.exit(0);`;
    const crash = require('child_process').spawnSync(process.execPath, ['-e', crashScript, JSON.stringify(entry)], { encoding: 'utf8', windowsHide: true });
    assert.strictEqual(crash.status, 9, `the child died mid-write: ${crash.stderr}`);
    assert.strictEqual(fs.statSync(vcfg).size, 0, 'a crash after truncating leaves a 0-byte config (the risk being fixed)');
    assert(fs.readFileSync(realTarget).length === 0, 'both link names see it');
    const nbCut = backups(vcfg).length;
    st = reg.checkClaudeDesktop(vopts);
    assert.strictEqual(st.state, 'invalid-config', 'V5b-07: an empty config after a cut in-place write is not read as {}');
    assert(/in-place write by StCFSD was cut short/.test(st.configError) && st.configError.includes('.stcfsd-backup-'), st.configError);
    r = reg.connectClaudeDesktop(vopts);
    assert.deepStrictEqual([r.ok, r.reason], [false, 'invalid-config'], 'the next connect does not write over it');
    assert.strictEqual(fs.statSync(vcfg).size, 0, 'left alone');
    assert.strictEqual(backups(vcfg).length, nbCut, 'no backup of the empty file');
    const cutBackup = st.configError.match(/backup: ([^)]+)\)/)[1];
    assert(fs.readFileSync(cutBackup).equals(beforeFail), 'the backup named in the message holds the previous content');
    // 잘린 JSON 도 같은 안내(깨진 JSON 은 원래도 손대지 않는다)
    fs.writeFileSync(vcfg, beforeFail.subarray(0, 20));
    st = reg.checkClaudeDesktop(vopts);
    assert(st.state === 'invalid-config' && /cut short/.test(st.configError), st.configError);
    // 사용자가 백업을 되돌리고 표시를 지우면 다시 된다
    fs.writeFileSync(vcfg, beforeFail);
    fs.rmSync(`${vcfg}.stcfsd-tmp-inplace`);
    assert.strictEqual(reg.checkClaudeDesktop(vopts).state, 'not-registered');
    // V5b-07(c): 아주 깊은 중첩 → 예외가 아니라 invalid-config, 손대지 않음
    const deep = `{"mcpServers":{},"x":${'['.repeat(5000)}${']'.repeat(5000)}}`;
    fs.writeFileSync(vcfg, deep);
    st = reg.checkClaudeDesktop(vopts);
    assert(st.state === 'invalid-config' && /nested 5001 levels deep/.test(st.configError), st.configError);
    r = reg.connectClaudeDesktop(vopts);
    assert.deepStrictEqual([r.ok, r.reason], [false, 'invalid-config'], 'deep config: refused, not thrown');
    r = reg.disconnectClaudeDesktop(vopts);
    assert.deepStrictEqual([r.ok, r.reason], [false, 'invalid-config']);
    assert.strictEqual(fs.readFileSync(vcfg, 'utf8'), deep, 'deep config untouched');
    const nested60 = `{"mcpServers":{},"x":${'['.repeat(60)}"a[{\\"}"${']'.repeat(60)}}`;   // 문자열 안의 괄호는 세지 않는다
    fs.writeFileSync(vcfg, nested60);
    r = reg.connectClaudeDesktop(vopts);
    assert(r.ok && r.action === 'added', `60 levels is fine: ${JSON.stringify(r)}`);
    fs.writeFileSync(vcfg, beforeFail);
    fs.rmSync(vcfg);
    let symlinks = true;
    try { fs.symlinkSync(realTarget, vcfg, 'file'); } catch (e) { symlinks = false; console.log(`  (V5-15b symbolic-link case skipped: ${e.code} — needs developer mode or admin)`); }
    if (symlinks) {
      r = reg.connectClaudeDesktop(vopts);
      assert(r.ok && fs.lstatSync(vcfg).isSymbolicLink(), 'symbolic link kept');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(realTarget, 'utf8')).mcpServers.stcfsd, entry, 'written to the link target');
      fs.rmSync(vcfg);
      fs.symlinkSync(path.join(tmp, 'v5', 'missing.json'), vcfg, 'file');
      r = reg.connectClaudeDesktop(vopts);
      assert.deepStrictEqual([r.ok, r.reason], [false, 'write-failed'], 'dangling link: not written');
      assert(/link whose target cannot be resolved/.test(r.error));
      assert(fs.lstatSync(vcfg).isSymbolicLink() && !fs.existsSync(path.join(tmp, 'v5', 'missing.json')));
      fs.rmSync(vcfg);
    }

    // V5-15(c): 우리 백업은 최근 CLAUDE_BACKUPS_KEPT 개만, 우리 이름 꼴이 아닌 것은 손대지 않는다
    realWrite(vcfg, JSON.stringify({ mcpServers: otherServers }, null, 2));
    for (const b of backups(vcfg)) { fs.rmSync(path.join(vdir, b)); }
    const foreign = [
      'claude_desktop_config.json.stcfsd-backup-mine.txt',                 // 꼴이 아님
      'claude_desktop_config.json.stcfsd-backup-20200101-000000.bak',      // 꼴 뒤에 더 붙음
      'other.json.stcfsd-backup-20200101-000000',                          // 다른 파일의 것
      'claude_desktop_config.json.bak',
    ];
    for (const n of foreign) { realWrite(path.join(vdir, n), 'not ours'); }
    fs.mkdirSync(path.join(vdir, 'claude_desktop_config.json.stcfsd-backup-20200101-000001'));   // 이름은 맞지만 폴더
    const oldOurs = 'claude_desktop_config.json.stcfsd-backup-20200101-000002';
    realWrite(path.join(vdir, oldOurs), '{}');
    let lastBackup;
    for (let i = 0; i < 6; i++) {
      r = reg.connectClaudeDesktop(vopts); assert(r.ok && r.wrote); lastBackup = r.backupPath;
      r = reg.disconnectClaudeDesktop(vopts); assert(r.ok && r.wrote); lastBackup = r.backupPath;
    }
    const ours = backups(vcfg).filter((n) => /\.stcfsd-backup-\d{8}-\d{6}(-\d+)?$/.test(n) && fs.lstatSync(path.join(vdir, n)).isFile());
    // V5b-09: 가장 오래된 우리 백업(StCFSD 가 처음 손대기 전의 원본)은 늘 남고, 그다음 오래된 것부터 지운다.
    assert.strictEqual(ours.length, reg.CLAUDE_BACKUPS_KEPT + 1,
      `V5-15c/V5b-09: 12 writes leave the original + ${reg.CLAUDE_BACKUPS_KEPT} newest, got ${ours.length}`);
    assert(fs.existsSync(lastBackup), 'the newest backup is kept');
    assert.strictEqual(fs.readFileSync(path.join(vdir, oldOurs), 'utf8'), '{}', 'V5b-09: the original (oldest of ours) is never pruned');
    assert.strictEqual(ours.filter((n) => n.includes('-20261122-')).length, reg.CLAUDE_BACKUPS_KEPT, 'the middle ones went');
    for (const n of foreign) { assert.strictEqual(fs.readFileSync(path.join(vdir, n), 'utf8'), 'not ours', `foreign file kept: ${n}`); }
    assert(fs.statSync(path.join(vdir, 'claude_desktop_config.json.stcfsd-backup-20200101-000001')).isDirectory(), 'a directory is never removed');
    // 같은 초의 -2 · -10 은 수로 가른다
    const sameSec = path.join(tmp, 'v5', 'seq', 'c.json');
    fs.mkdirSync(path.dirname(sameSec), { recursive: true });
    for (const s of ['', '-2', '-3', '-9', '-10', '-11']) { realWrite(`${sameSec}.stcfsd-backup-20260101-000000${s}`, 'x'); }
    reg.pruneClaudeBackups(sameSec, 2);
    assert.deepStrictEqual(backups(sameSec).sort(), ['c.json.stcfsd-backup-20260101-000000', 'c.json.stcfsd-backup-20260101-000000-10',
      'c.json.stcfsd-backup-20260101-000000-11'], 'newest two by number (-11, -10) plus the first (no suffix = the original)');

    // V5-15(d) · V5-S5: Windows 에서는 경로의 대소문자 · 구분자만 다른 항목은 같은 항목이다
    const caseOnly = {
      command: entry.command.toLowerCase(),
      args: [entry.args[0].toUpperCase().replace(/\\/g, '/')],
      env: { ...entry.env, STCFSD_MCP_PORT_FILE: entry.env.STCFSD_MCP_PORT_FILE.toLowerCase() },
    };
    realWrite(vcfg, JSON.stringify({ mcpServers: { ...otherServers, stcfsd: caseOnly } }, null, 2));
    assert.strictEqual(reg.checkClaudeDesktop(vopts).state, 'registered', 'win32: case / separator-only difference = registered');
    const tCase = mtime(vcfg);
    r = reg.connectClaudeDesktop(vopts);
    assert(r.ok && r.action === 'unchanged' && mtime(vcfg) === tCase, 'connect does not rewrite it');
    const posix = { ...vopts, pathOptions: { platform: 'linux' } };
    assert.strictEqual(reg.checkClaudeDesktop(posix).state, 'registered-elsewhere', 'other OS: paths compared exactly');
    assert.strictEqual(reg.disconnectClaudeDesktop(posix).action, 'kept');
    r = reg.disconnectClaudeDesktop(vopts);
    assert(r.ok && r.action === 'removed', 'win32: disconnect removes the case-only-different entry');
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(vcfg, 'utf8')).mcpServers), ['windload']);
    assert(!reg.samePath('C:\\a\\b', 'C:\\a\\c', 'win32') && !reg.samePath('/a/B', '/a/b', 'linux') && reg.samePath('c:/A//b', 'C:\\a\\b', 'win32'));
    assert(!reg.sameEntry({ ...entry, env: { ...entry.env, STCFSD_MCP_STANDALONE: 'ONE' } }, { ...entry, env: { ...entry.env, STCFSD_MCP_STANDALONE: 'one' } }, 'win32'),
      'non-path env values stay exact');
    if (process.platform === 'win32') {
      // V5-S5: 실행한 경로의 글자 꼴이 process.execPath 에 그대로 들어간다(확인) — 그래서 위의 비교가 필요하다
      const lower = process.execPath.toLowerCase();
      const seenPath = require('child_process').execFileSync(lower, ['-p', 'process.execPath'], { encoding: 'utf8', windowsHide: true }).trim();
      console.log(`  (V5-S5: launched as "${lower}" → process.execPath = "${seenPath}")`);
      assert(reg.samePath(seenPath, process.execPath, 'win32'), 'the same executable, however it was launched');
      if (seenPath !== process.execPath) {
        const asLaunched = reg.standaloneMcpEntry({ command: seenPath, serverScript: script, portFile });
        realWrite(vcfg, JSON.stringify({ mcpServers: { stcfsd: reg.standaloneMcpEntry({ command: process.execPath, serverScript: script, portFile }) } }));
        assert.strictEqual(reg.checkClaudeDesktop({ ...vopts, entry: asLaunched }).state, 'registered', 'V5-S5: launch-path casing does not turn into registered-elsewhere');
      }
    }

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
