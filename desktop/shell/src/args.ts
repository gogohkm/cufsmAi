/**
 * 명령줄 인자 — 껍데기가 쓰는 것만. Electron · Chromium 의 스위치(`--inspect`, `--enable-logging` …)는 그대로 둔다.
 *
 *   StCFSD.exe [파일.csd] [--open <파일.csd>] [--user-data <폴더>] [--theme dark|light] [--ui]
 *
 * `--ui` — 새 검토 화면(U1, `desktop/ui/` 의 `/ui/`)을 연다. 없으면 지금처럼 틀(`/` — 제목 표시줄 + 설계 화면 탭 6개)이다.
 *
 * 파일 연결(탐색기에서 .csd 를 두 번 누름)은 `StCFSD.exe "C:\…\a.csd"` 꼴로 온다 — 맨 인자 하나.
 * 개발판은 `electron . a.csd` 라 앞의 두 칸(electron, .)을 건너뛴다(`process.defaultApp`).
 */
import * as path from 'node:path';

export interface ShellArgs {
  /** 열 파일(절대 경로) */
  open?: string;
  /** 사용자 폴더(로그 · 창 위치 · 호스트 설정 · MCP 포트 파일). 시험은 모두 이것을 준다 */
  userData?: string;
  theme?: 'dark' | 'light';
  /** 새 검토 화면(U1)을 연다 — 기본은 틀(U4 에서 바꾼다) */
  ui?: boolean;
}

export const PROJECT_EXT = /\.(csd|stcfsd)$/i;

export function parseArgs(argv: string[], cwd: string, defaultApp: boolean): ShellArgs {
  const out: ShellArgs = {};
  const rest = argv.slice(defaultApp ? 2 : 1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--ui') { out.ui = true; continue; }
    const take = (name: string): string | undefined => {
      if (a === `--${name}`) { const v = rest[i + 1]; if (v !== undefined && !v.startsWith('--')) { i++; return v; } return undefined; }
      if (a.startsWith(`--${name}=`)) { return a.slice(name.length + 3); }
      return undefined;
    };
    const open = take('open');
    if (open !== undefined) { out.open = path.resolve(cwd, open); continue; }
    const ud = take('user-data');
    if (ud !== undefined) { out.userData = path.resolve(cwd, ud); continue; }
    const theme = take('theme');
    if (theme !== undefined) { if (theme === 'dark' || theme === 'light') { out.theme = theme; } continue; }
    if (!a.startsWith('-') && PROJECT_EXT.test(a) && !out.open) { out.open = path.resolve(cwd, a); }
  }
  return out;
}
