/**
 * 구현하지 않은 API 에 닿은 것을 기록한다.
 *
 * 대체 모듈의 최상위, 네임스페이스(window, workspace …), 그리고 우리가 만든
 * 객체(ExtensionContext, WebviewPanel …)에 Proxy 를 씌워, 없는 멤버를 읽으면
 * `[vscode-shim] 미구현: window.xxx` 를 한 번씩 남긴다. 조용히 undefined 를
 * 돌려주는 것이 가장 위험하다 — 확장은 그 값을 "기능 없음"으로 받아 다른 길로
 * 가 버리고 아무도 모른다.
 */

/** 런타임이 객체 모양을 살피느라 읽는 이름 — 기록하지 않는다. */
const PROBE_NAMES = new Set<string | symbol>([
  'then', 'catch', 'finally', 'toJSON', 'constructor', '__esModule', 'default',
  'inspect', 'nodeType', 'asymmetricMatch', '$$typeof', 'prototype', 'length',
  'valueOf', 'toString', '__proto__', 'Symbol(Symbol.toPrimitive)',
]);

export class UnimplementedTracker {
  private readonly seen = new Map<string, number>();
  constructor(private readonly log: (line: string) => void) {}

  hit(name: string): void {
    const n = this.seen.get(name) ?? 0;
    this.seen.set(name, n + 1);
    if (n === 0) { this.log(`[vscode-shim] 미구현: ${name}`); }
  }

  /** 이름 → 닿은 횟수 */
  list(): Array<{ name: string; count: number }> {
    return [...this.seen.entries()].map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * `target` 에 없는 멤버를 읽으면 기록한다. 있는 멤버(값이 undefined 라도
 * 키가 있으면)는 그대로 돌려준다 — 선택적 속성은 키를 두고 undefined 로 둔다.
 */
export function guard<T extends object>(target: T, label: string, tracker: UnimplementedTracker): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === 'symbol' || PROBE_NAMES.has(prop)) {
        return Reflect.get(obj, prop, receiver);
      }
      if (!(prop in obj)) {
        tracker.hit(`${label}.${prop}`);
        return undefined;
      }
      return Reflect.get(obj, prop, receiver);
    },
  });
}
