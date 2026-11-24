/** vscode.commands — 확장이 등록한 명령. StCFSD 는 VS Code 내장 명령을 부르지 않으므로 흉내도 두지 않는다. */
import { Disposable } from './events';
import type { UnimplementedTracker } from './unimplemented';

export type CommandHandler = (...args: any[]) => unknown;

export class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>();
  /** 등록은 받되 실행하지 않는 명령 → 까닭. 적재기가 정한다(독립 프로그램에서 쓰면 안 되는 확장 명령) */
  private readonly blocked = new Map<string, string>();
  /** 실행 기록(최근 200건) — 시험과 S2 화면이 본다. */
  readonly log: Array<{ id: string; at: number; missing: boolean }> = [];

  constructor(private readonly tracker: UnimplementedTracker) {}

  register(id: string, handler: CommandHandler, thisArg?: unknown): Disposable {
    if (this.handlers.has(id)) {
      // VS Code 는 같은 id 를 두 번 등록하면 던진다. 같게 한다.
      throw new Error(`command '${id}' already exists`);
    }
    this.handlers.set(id, thisArg === undefined ? handler : handler.bind(thisArg));
    return new Disposable(() => { this.handlers.delete(id); });
  }

  /** 이 명령은 실행하지 않는다 — 부르면 까닭을 담아 던진다(확장 안에서 부르든 바깥에서 부르든) */
  block(id: string, reason: string): void { this.blocked.set(id, reason); }
  blockedIds(): string[] { return [...this.blocked.keys()].sort(); }

  has(id: string): boolean { return this.handlers.has(id) && !this.blocked.has(id); }
  /** 실행할 수 있는 명령(막은 것은 뺀다) */
  registeredIds(): string[] { return [...this.handlers.keys()].filter(id => !this.blocked.has(id)).sort(); }

  async execute<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const reason = this.blocked.get(id);
    if (reason !== undefined) {
      this.log.push({ id, at: Date.now(), missing: false });
      throw new Error(`명령 '${id}' 은 독립 프로그램에서 쓰지 않는다 — ${reason}`);
    }
    const own = this.handlers.get(id);
    this.log.push({ id, at: Date.now(), missing: !own });
    if (this.log.length > 200) { this.log.shift(); }
    if (own) { return await own(...args) as T; }
    // 없는 명령(VS Code 내장 명령 포함)을 부르면 미구현으로 남긴다 — 조용히 넘어가지 않는다.
    this.tracker.hit(`commands.executeCommand('${id}')`);
    return undefined as T;
  }

  dispose(): void {
    this.handlers.clear();
  }
}

export function createCommandsNamespace(registry: CommandRegistry) {
  return {
    registerCommand: (id: string, handler: CommandHandler, thisArg?: unknown) => registry.register(id, handler, thisArg),
    executeCommand: <T = unknown>(id: string, ...args: unknown[]) => registry.execute<T>(id, ...args),
    getCommands: async (_filterInternal?: boolean) => registry.registeredIds(),
  };
}
