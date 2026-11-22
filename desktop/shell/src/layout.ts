/**
 * 파일이 어디 있는가 — 개발(저장소 체크아웃)과 설치본(S5)을 한 곳에서 가른다.
 *
 * 개발:   `appRoot` = 저장소 루트(`STCFSD_REPO_ROOT` 로 덮어쓴다. 기본은 `desktop/shell` 의 두 단계 위).
 *         확장 호스트 `out/extension.js`, 엔진 `python/` + `.venv`, MCP 서버 `media/mcp-server.js`,
 *         호스트 공개 API `desktop/host/dist/index.js`, 틀 `desktop/host/frame/`.
 * 설치본(S5 에서 정한다 — StAnal 의 배치를 따른 자리, 아직 시험하지 않음):
 *         <resources>/app.asar     package.json · dist/main.js · dist/preload.js · host/index.js · host/frame/
 *         <resources>/app-root/    확장 배포물(out · python · media · webview · package.json)이 저장소와 같은 모양 — asar 밖
 *         <resources>/python/      묶어 넣은 Python(numpy · scipy)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type LayoutKind = 'dev' | 'installed';

export interface Layout {
  kind: LayoutKind;
  /** startHost 의 repoRoot(= 확장 폴더) */
  appRoot: string;
  /** 호스트 공개 API 번들 */
  hostEntry: string;
  /** 틀 폴더(다리의 frameDir) */
  frameDir: string;
  /** Claude Desktop 이 띄울 MCP 서버(stdio) */
  mcpServer: string;
  /** 설치본의 묶은 Python(개발에는 없다 — 저장소의 .venv 를 확장이 스스로 찾는다) */
  python?: string;
}

export interface LayoutInput {
  packaged: boolean;
  /** app.getAppPath() — 개발이면 desktop/shell, 설치본이면 …/resources/app.asar */
  appPath: string;
  resourcesPath: string;
  env: NodeJS.ProcessEnv;
}

export function resolveLayout(i: LayoutInput): Layout {
  if (!i.packaged) {
    const repoRoot = path.resolve(i.env.STCFSD_REPO_ROOT || path.join(i.appPath, '..', '..'));
    return {
      kind: 'dev',
      appRoot: repoRoot,
      hostEntry: path.join(repoRoot, 'desktop', 'host', 'dist', 'index.js'),
      frameDir: path.join(repoRoot, 'desktop', 'host', 'frame'),
      mcpServer: path.join(repoRoot, 'media', 'mcp-server.js'),
    };
  }
  const res = i.resourcesPath;
  const appRoot = path.join(res, 'app-root');
  return {
    kind: 'installed',
    appRoot,
    hostEntry: path.join(i.appPath, 'host', 'index.js'),
    frameDir: path.join(i.appPath, 'host', 'frame'),
    mcpServer: path.join(appRoot, 'media', 'mcp-server.js'),
    python: path.join(res, 'python', process.platform === 'win32' ? 'python.exe' : path.join('bin', 'python3')),
  };
}

/** 없으면 시작할 수 없는 파일 */
export function missingFiles(l: Layout): string[] {
  const need = [
    path.join(l.appRoot, 'out', 'extension.js'), path.join(l.appRoot, 'python', 'server.py'), path.join(l.appRoot, 'package.json'),
    l.hostEntry, path.join(l.frameDir, 'index.html'), l.mcpServer,
  ];
  return need.filter(f => !fs.existsSync(f));
}

/** 확장이 쓸 Python 이 있는가(확장의 getPythonPath 순서: 확장 폴더의 .venv → 설정 → PATH) */
export function findPython(l: Layout, env: NodeJS.ProcessEnv): { ok: boolean; path?: string; tried: string[]; override?: string } {
  const tried: string[] = [];
  const override = env.STCFSD_PYTHON || l.python;
  for (const p of [path.join(l.appRoot, '.venv', 'Scripts', 'python.exe'), path.join(l.appRoot, '.venv', 'bin', 'python')]) {
    tried.push(p);
    if (fs.existsSync(p)) { return { ok: true, path: p, tried }; }
  }
  if (override) {
    tried.push(override);
    if (fs.existsSync(override)) { return { ok: true, path: override, tried, override }; }
  }
  return { ok: false, tried };
}
