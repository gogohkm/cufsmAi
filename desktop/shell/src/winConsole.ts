/**
 * Windows: 자식 프로세스의 콘솔 창을 숨긴다(개발판 `electron .` 에서도 — electron.exe 도 GUI 프로그램이다). (StAnal 의 같은 파일)
 *
 * StCFSD.exe(그리고 개발판의 electron.exe)는 GUI 프로그램이라 콘솔이 없다. 그 안에서 콘솔 프로그램(python.exe)을 `windowsHide` 없이 띄우면
 * Windows 가 새 콘솔 창을 만든다 — 해석 엔진(python server.py)은 오래 떠 있으므로 검은 창이 내내 떠 있게 된다.
 * 확장 코드(src/bridge/PythonBridge.ts 의 spawn, src/extension.ts 의 execSync)는 `windowsHide` 를 주지 않는다(`src/` 는 고치지 않는다). 그래서 껍데기가 호스트를
 * 읽기 전에 `child_process` 의 함수들이 `windowsHide` 를 주지 않았으면 true 로 채우게 감싼다.
 * 확장 번들은 `require("child_process")` 의 내보내기 객체를 부를 때마다 읽으므로 같은 객체를 고치면 닿는다.
 *
 * 닿지 않는 곳: 이 프로세스 밖에서 뜨는 것 — Claude Desktop 이 띄우는 MCP 서버(StCFSD.exe + ELECTRON_RUN_AS_NODE)는
 * Claude Desktop 의 자식이다(그쪽은 콘솔 프로그램으로 뜨고 창을 Claude 가 정한다). PDF 인쇄용 Edge 는 확장이 windowsHide: true 를 준다.
 */
import type * as ChildProcess from 'node:child_process';

type Fn = (...args: unknown[]) => unknown;
const WRAPPED = Symbol.for('stcfsd.windowsHide');

/** (command, args?, options?, callback?) 꼴 인자에서 options 를 찾아 windowsHide 를 채운다 */
export function withWindowsHide(args: unknown[], optionsIndexFrom: number): unknown[] {
  const out = [...args];
  for (let i = optionsIndexFrom; i < out.length; i++) {
    const a = out[i];
    if (typeof a === 'function') { out.splice(i, 0, { windowsHide: true }); return out; }
    if (Array.isArray(a)) { continue; }
    if (a === undefined || a === null) {
      // 자리만 비운 것(spawn(f, undefined, opts))이면 뒤의 options 를 본다. 끝이거나 뒤가 콜백이면 이 자리에 넣는다.
      if (i + 1 < out.length && typeof out[i + 1] !== 'function') { continue; }
      out[i] = { windowsHide: true }; return out;
    }
    if (typeof a === 'object') {
      const o = a as Record<string, unknown>;
      if (!('windowsHide' in o)) { out[i] = { ...o, windowsHide: true }; }
      return out;
    }
  }
  out.push({ windowsHide: true });
  return out;
}

/** child_process 를 감싼다. 감싼 함수 이름을 돌려준다 */
export function hideChildConsoles(cp: typeof ChildProcess, platform = process.platform): string[] {
  if (platform !== 'win32') { return []; }
  const target = cp as unknown as Record<string, Fn & { [WRAPPED]?: boolean }>;
  const done: string[] = [];
  // exec(command, options?, cb?) 만 options 가 둘째. 나머지는 (file, args?, options?, cb?)
  for (const [name, from] of [['spawn', 1], ['spawnSync', 1], ['execFile', 1], ['execFileSync', 1], ['exec', 1], ['execSync', 1], ['fork', 1]] as const) {
    const orig = target[name];
    if (typeof orig !== 'function' || orig[WRAPPED]) { continue; }
    const wrapped = function (this: unknown, ...args: unknown[]) { return orig.apply(this, withWindowsHide(args, from)); } as Fn & { [WRAPPED]?: boolean };
    wrapped[WRAPPED] = true;
    Object.defineProperty(wrapped, 'name', { value: name });
    target[name] = wrapped;
    done.push(name);
  }
  return done;
}
