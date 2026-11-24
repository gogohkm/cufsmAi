// K1: 시험이 진짜 MCP · Claude 설정 파일에 닿지 않았음을 확인한다 — 파일을 열지 않고 크기 · 수정 시각만 본다.
// 대상: 저장소의 .mcp.json · .claude/ · Example/.mcp.json · Example/.claude/, 이 PC 의 Claude Desktop 설정
// (%APPDATA%\Claude\ · MSIX 후보 · macOS/Linux 위치)과 ~/.claude/mcp.json — 있는 것만.
// Claude Desktop 은 떠 있는 동안 자기 설정을 스스로 고쳐 쓸 수 있다(StAnal B3 사고 기록). 그래서 그 파일의 시각이
// 바뀌었을 때는 우리 흔적(같은 폴더의 *.stcfsd-backup-* · *.stcfsd-tmp-*)이 새로 생겼는지로 판정하고, 없으면 경고만 한다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');

const ROOT = path.resolve(__dirname, '..', '..');

function statSafe(p) {
  try { const s = fs.statSync(p); return { size: s.size, mtimeMs: s.mtimeMs, dir: s.isDirectory() }; } catch { return null; }
}

function walk(p, out, depth) {
  const s = statSafe(p);
  if (!s) { return; }
  out.push(p);
  if (!s.dir || depth <= 0) { return; }
  let names;
  try { names = fs.readdirSync(p); } catch { return; }
  for (const n of names) { walk(path.join(p, n), out, depth - 1); }
}

function claudeDesktopPaths() {
  const home = os.homedir();
  const out = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    out.push(path.join(appData, 'Claude', 'claude_desktop_config.json'));
    const packages = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages');
    let names;
    try { names = fs.readdirSync(packages).filter((n) => /claude/i.test(n)); } catch { names = []; }
    for (const n of names) { out.push(path.join(packages, n, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json')); }
  } else if (process.platform === 'darwin') {
    out.push(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
  } else {
    out.push(path.join(home, '.config', 'Claude', 'claude_desktop_config.json'));
  }
  return out.filter((p) => statSafe(p));
}

// 백업은 copyFile 이라 원본의 수정 시각을 물려받을 수 있다 — 시각이 아니라 이름 목록의 차이로 본다.
function fingerprints(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => /\.stcfsd-(backup|tmp)-/.test(n)).sort();
}

/** 지금 상태를 찍는다. 돌려준 객체의 verify() 가 시험 끝에 같은지 본다. */
function snapshotRealConfigs() {
  const strict = [];
  for (const rel of ['.mcp.json', '.claude', path.join('Example', '.mcp.json'), path.join('Example', '.claude')]) {
    walk(path.join(ROOT, rel), strict, 3);
  }
  const userMcp = path.join(os.homedir(), '.claude', 'mcp.json');
  if (statSafe(userMcp)) { strict.push(userMcp); }
  const desktop = claudeDesktopPaths();
  const before = new Map([...strict, ...desktop].map((p) => [p, statSafe(p)]));
  const prints = new Map(desktop.map((p) => [p, fingerprints(path.dirname(p))]));
  return {
    files: [...before.keys()],
    verify(assert) {
      for (const p of strict) {
        const a = before.get(p);
        const b = statSafe(p);
        assert(b && a.size === b.size && a.mtimeMs === b.mtimeMs, `real config must be untouched: ${p}`);
      }
      const warnings = [];
      for (const p of desktop) {
        const a = before.get(p);
        const b = statSafe(p);
        const added = fingerprints(path.dirname(p)).filter((n) => !prints.get(p).includes(n));
        assert.deepStrictEqual(added, [], `no StCFSD backup/temp file next to the real Claude Desktop config: ${p}`);
        if (!b || a.size !== b.size || a.mtimeMs !== b.mtimeMs) {
          warnings.push(`WARN real Claude Desktop config changed during the test without a StCFSD fingerprint `
            + `(Claude Desktop rewrites it while running): ${p}`);
        }
      }
      return warnings;
    },
  };
}

module.exports = { snapshotRealConfigs };
