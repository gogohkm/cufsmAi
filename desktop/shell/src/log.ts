/**
 * 로그 — `userData/logs/main-<날짜>.log` 하나에 모은다.
 *
 * 들어오는 것: 껍데기 자신의 줄, 호스트 · 다리의 `log`, 주 프로세스의 `console.*`(확장 호스트 `out/` 의
 * console.log 와 Python 엔진의 stderr 가 여기로 온다). (StAnal `desktop/shell/src/log.ts` 를 옮김)
 * 화면(터미널)에는 껍데기의 줄과 경고 · 오류만 보낸다. 나머지는 파일에만.
 *
 * 크기 제한: 한 파일이 `maxBytes`(기본 8 MiB)를 넘으면 `main-<날짜>.1.log`, `.2.log` … 로 넘긴다.
 * 정리: 시작할 때 `keepDays`(기본 14일)보다 오래된 파일과, 합이 `maxTotalBytes`(기본 64 MiB)를
 * 넘는 오래된 파일을 지운다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { format } from 'node:util';

export type LogLevel = 'info' | 'warn' | 'error';

export interface ShellLogger {
  readonly dir: string;
  /** 지금 쓰는 파일 */
  file(): string;
  /** 껍데기의 줄 — 파일 + (개발이면) 터미널 */
  shell(line: string, level?: LogLevel): void;
  /** 호스트 · 다리 · 출력 채널의 줄 — 파일에만(경고 · 오류처럼 보이면 터미널에도) */
  host(line: string): void;
  /** console.* 를 가로챈다. 되돌리는 함수를 돌려준다 */
  captureConsole(): () => void;
  close(): void;
}

export interface LoggerOptions {
  dir: string;
  /** 터미널에 찍는가(개발 · 시험) */
  echo: boolean;
  maxBytes?: number;
  keepDays?: number;
  maxTotalBytes?: number;
  now?: () => Date;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (d: Date) => `${dayOf(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;

/** 로그 폴더 정리 — 오래된 것, 합이 넘친 것 */
export function pruneLogs(dir: string, keepDays: number, maxTotalBytes: number, now = new Date()): string[] {
  let names: string[];
  try { names = fs.readdirSync(dir).filter(n => /^main-\d{4}-\d{2}-\d{2}(\.\d+)?\.log$/.test(n)); } catch { return []; }
  const files = names.map(n => {
    const f = path.join(dir, n);
    try { const s = fs.statSync(f); return { f, size: s.size, mtime: s.mtimeMs }; } catch { return undefined; }
  }).filter((x): x is { f: string; size: number; mtime: number } => !!x).sort((a, b) => b.mtime - a.mtime);
  const removed: string[] = [];
  const cutoff = now.getTime() - keepDays * 86_400_000;
  let total = 0;
  for (const x of files) {
    total += x.size;
    if (x.mtime < cutoff || total > maxTotalBytes) {
      try { fs.unlinkSync(x.f); removed.push(x.f); } catch { /* 다른 프로세스가 쥐고 있다 */ }
    }
  }
  return removed;
}

export function createLogger(opts: LoggerOptions): ShellLogger {
  const now = opts.now ?? (() => new Date());
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  fs.mkdirSync(opts.dir, { recursive: true });
  pruneLogs(opts.dir, opts.keepDays ?? 14, opts.maxTotalBytes ?? 64 * 1024 * 1024, now());

  let day = '';
  let part = 0;
  let current = '';
  let fd: number | undefined;
  let written = 0;
  let closed = false;

  const open = () => {
    const d = dayOf(now());
    if (fd !== undefined && d === day && written < maxBytes) { return; }
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* 무시 */ } fd = undefined; }
    if (d !== day) { day = d; part = 0; }
    for (;;) {
      current = path.join(opts.dir, part === 0 ? `main-${day}.log` : `main-${day}.${part}.log`);
      let size = 0;
      try { size = fs.statSync(current).size; } catch { size = 0; }
      if (size < maxBytes) { written = size; break; }
      part += 1;
    }
    fd = fs.openSync(current, 'a');
  };

  // 줄마다 동기 쓰기 — 강제 종료 · 충돌 직전의 줄을 잃지 않는다. 활성화 때 수백 줄이어도 수 ms 다.
  const write = (tag: string, text: string) => {
    if (closed) { return; }
    try {
      open();
      const line = `${stamp(now())} ${tag} ${text.replace(/\r?\n/g, '\n    ')}\n`;
      const buf = Buffer.from(line, 'utf8');
      fs.writeSync(fd!, buf);
      written += buf.length;
    } catch { /* 로그 실패가 프로그램을 막지 않는다 */ }
  };
  const echo = (level: LogLevel, text: string) => {
    if (!opts.echo) { return; }
    try { (level === 'info' ? process.stdout : process.stderr).write(`${text}\n`); } catch { /* 닫힌 터미널 */ }
  };
  // 엔진의 stderr(numpy 경고 등)는 파일에만 남긴다.
  const noisy = (text: string) => /^\[StCFSD Python stderr\]/.test(text);
  const looksBad = (line: string) => /\b(error|warn(ing)?|exception|fail(ed)?)\b|실패|오류|예외|경고/i.test(line);

  return {
    dir: opts.dir,
    file: () => { open(); return current; },
    shell(line, level = 'info') {
      write(level === 'info' ? '[shell]' : `[shell:${level}]`, line);
      echo(level, `[shell] ${line}`);
    },
    host(line) {
      write('[host]', line);
      if (looksBad(line) && !noisy(line)) { echo('warn', line); }
    },
    captureConsole() {
      const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
      const mk = (tag: string, level: LogLevel) => (...args: unknown[]) => {
        const text = format(...args);
        write(tag, text);
        if (level !== 'info' && !noisy(text)) { echo(level, `${tag} ${text}`); }
      };
      console.log = mk('[console]', 'info');
      console.info = mk('[console]', 'info');
      console.debug = mk('[console:debug]', 'info');
      console.warn = mk('[console:warn]', 'warn');
      console.error = mk('[console:error]', 'error');
      return () => { Object.assign(console, orig); };
    },
    close() {
      closed = true;
      if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* 무시 */ } fd = undefined; }
    },
  };
}
