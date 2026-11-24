// 진짜 설정 자리를 열지 않고(또는 MCP 부분만) 시험 전후를 맞춰 보는 도우미 — shell · 포장본 · 다리 시험이 함께 쓴다(V5-16b).
//
// 대부분은 크기 · 수정 시각만 본다. 예외 하나: ~/.claude.json 은 Claude Code 가 쉼 없이 고쳐 쓰는 상태 파일이라 시각으로 보면
// 개발 PC 에서 늘 바뀐다 — 그 안의 MCP 등록(맨 위 · 프로젝트별 `mcpServers`)만 해시로 본다. 그 밖의 내용은 읽어도 쓰지 않는다.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function fingerprint(file) {
  if (path.basename(file).toLowerCase() === '.claude.json') {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return '없음'; }
    try {
      const j = JSON.parse(text);
      const mcp = [j.mcpServers ?? null, Object.entries(j.projects ?? {}).map(([k, v]) => [k, v?.mcpServers ?? null])];
      return `mcp:${crypto.createHash('sha256').update(JSON.stringify(mcp)).digest('hex')}`;
    } catch { return '읽지 못함'; }
  }
  try { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}`; } catch { return '없음'; }
}

/** 이 PC 의 진짜 Claude Desktop · Claude Code · StCFSD 자리 */
export function realConfigPaths(repoRoot, extra = []) {
  const home = process.env.USERPROFILE || os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const list = [
    path.join(appData, 'Claude', 'claude_desktop_config.json'), path.join(home, '.claude', 'mcp.json'), path.join(home, '.claude.json'),
    path.join(repoRoot, '.mcp.json'), path.join(repoRoot, '.claude', 'mcp.json'), path.join(repoRoot, 'Example', '.mcp.json'),
    path.join(repoRoot, 'Example', '.claude', 'mcp.json'), path.join(appData, 'StCFSD'), path.join(appData, 'StCFSD', 'mcp', 'stcfsd-mcp-port'),
    ...extra,
  ];
  try {
    for (const d of fs.readdirSync(path.join(local, 'Packages'))) {
      if (/claude/i.test(d)) { list.push(path.join(local, 'Packages', d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json')); }
    }
  } catch { /* 없음 */ }
  return list;
}

/** 시작할 때 부른다 → 끝에 `changed()` 가 바뀐 자리 목록 */
export function watchRealConfig(repoRoot, extra = []) {
  const list = realConfigPaths(repoRoot, extra);
  const before = new Map(list.map(f => [f, fingerprint(f)]));
  return { list, changed: () => list.filter(f => fingerprint(f) !== before.get(f)) };
}
