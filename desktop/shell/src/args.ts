/**
 * 명령줄 인자 — 껍데기가 쓰는 것만. Electron · Chromium 의 스위치(`--inspect`, `--enable-logging` …)는 그대로 둔다.
 *
 *   StCFSD.exe [파일.csd] [--open <파일.csd>] [--user-data <폴더>] [--theme dark|light] [--ui [classic]]
 *
 * 기본 화면(U4)은 새 검토 화면(`desktop/ui/` 의 `/ui/`)이다. `--ui classic`(`--ui=classic` · `--classic`)은 예전의 틀(`/` —
 * 제목 표시줄 + 설계 화면 탭 6개)을 연다 — 한 판 동안 남긴다. `--ui` 만 주면 새 화면(예전 스위치 — 그대로 받는다).
 *
 * 파일 연결(탐색기에서 .csd 를 두 번 누름)은 `StCFSD.exe "C:\…\a.csd"` 꼴로 온다 — 맨 인자 하나.
 * 개발판은 `electron . a.csd` 라 앞의 두 칸(electron, .)을 건너뛴다(`process.defaultApp`).
 */
import * as path from 'node:path';

export interface ShellArgs {
  /** 열 파일(절대 경로) — 여럿이면 첫 것 */
  open?: string;
  /** 함께 넘어온 다른 프로젝트 파일(열지 않고 알린다 — V5-12b) */
  extra?: string[];
  /** 사용자 폴더(로그 · 창 위치 · 호스트 설정 · MCP 포트 파일). 시험은 모두 이것을 준다 */
  userData?: string;
  theme?: 'dark' | 'light';
  /** 여는 화면 — 기본 'ui'(새 검토 화면), 'classic' = 예전의 틀(스위치) */
  screen: 'ui' | 'classic';
}

export const PROJECT_EXT = /\.(csd|stcfsd)$/i;

export function parseArgs(argv: string[], cwd: string, defaultApp: boolean): ShellArgs {
  const out: ShellArgs = { screen: 'ui' };
  const rest = argv.slice(defaultApp ? 2 : 1);
  const add = (f: string) => { if (!out.open) { out.open = f; } else if (f !== out.open && !(out.extra ?? []).includes(f)) { (out.extra ??= []).push(f); } };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--classic' || a === '--ui=classic') { out.screen = 'classic'; continue; }
    if (a === '--ui') { if (rest[i + 1] === 'classic') { out.screen = 'classic'; i++; } else { out.screen = 'ui'; } continue; }
    const take = (name: string): string | undefined => {
      if (a === `--${name}`) { const v = rest[i + 1]; if (v !== undefined && !v.startsWith('--')) { i++; return v; } return undefined; }
      if (a.startsWith(`--${name}=`)) { return a.slice(name.length + 3); }
      return undefined;
    };
    const open = take('open');
    if (open !== undefined) { add(path.resolve(cwd, open)); continue; }
    const ud = take('user-data');
    if (ud !== undefined) { out.userData = path.resolve(cwd, ud); continue; }
    const theme = take('theme');
    if (theme !== undefined) { if (theme === 'dark' || theme === 'light') { out.theme = theme; } continue; }
    if (!a.startsWith('-') && PROJECT_EXT.test(a)) { add(path.resolve(cwd, a)); }
  }
  return out;
}
