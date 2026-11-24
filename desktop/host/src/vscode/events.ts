/** Disposable · EventEmitter · CancellationToken — VS Code 의 같은 이름과 같은 규약. */

export type Listener<T> = (e: T) => unknown;

export interface Event<T> {
  (listener: Listener<T>, thisArgs?: unknown, disposables?: { dispose(): unknown }[]): Disposable;
}

export class Disposable {
  private callOnDispose: (() => unknown) | undefined;

  constructor(callOnDispose: () => unknown) {
    this.callOnDispose = callOnDispose;
  }

  static from(...items: Array<{ dispose(): unknown } | undefined>): Disposable {
    return new Disposable(() => {
      for (const item of items) { try { item?.dispose(); } catch { /* 하나가 실패해도 나머지는 정리한다 */ } }
    });
  }

  dispose(): unknown {
    const fn = this.callOnDispose;
    this.callOnDispose = undefined;
    return fn?.();
  }
}

export class EventEmitter<T> {
  private listeners: Array<{ fn: Listener<T>; thisArgs: unknown }> = [];
  private disposed = false;
  private eventFn: Event<T> | undefined;

  get event(): Event<T> {
    if (!this.eventFn) {
      this.eventFn = (listener, thisArgs, disposables) => {
        if (this.disposed) { return new Disposable(() => undefined); }
        const entry = { fn: listener, thisArgs };
        this.listeners.push(entry);
        const d = new Disposable(() => {
          const i = this.listeners.indexOf(entry);
          if (i >= 0) { this.listeners.splice(i, 1); }
        });
        disposables?.push(d);
        return d;
      };
    }
    return this.eventFn;
  }

  fire(data: T): void {
    for (const { fn, thisArgs } of [...this.listeners]) {
      try { fn.call(thisArgs, data); }
      catch (err) { console.error('[vscode-shim] 이벤트 처리기 예외', err); }
    }
  }

  get listenerCount(): number { return this.listeners.length; }

  dispose(): void {
    this.disposed = true;
    this.listeners = [];
  }
}

export interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: Event<unknown>;
}

/** withProgress 가 작업에 넘기는 취소 표지. StCFSD 는 cancellable: false 로만 쓴다. */
export class CancellationTokenSource {
  private emitter = new EventEmitter<unknown>();
  private cancelled = false;
  readonly token: CancellationToken;

  constructor() {
    const self = this;
    this.token = {
      get isCancellationRequested() { return self.cancelled; },
      onCancellationRequested: (listener, thisArgs, disposables) => {
        if (self.cancelled) {
          // VS Code 와 같이 이미 취소됐으면 곧바로 부른다.
          queueMicrotask(() => listener.call(thisArgs, undefined));
          return new Disposable(() => undefined);
        }
        return self.emitter.event(listener, thisArgs, disposables);
      },
    };
  }

  cancel(): void {
    if (this.cancelled) { return; }
    this.cancelled = true;
    this.emitter.fire(undefined);
  }

  dispose(cancel = false): void {
    if (cancel) { this.cancel(); }
    this.emitter.dispose();
  }
}
