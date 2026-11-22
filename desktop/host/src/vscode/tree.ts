/**
 * TreeView — 객체는 만들되 화면은 없다. StCFSD 의 `stcfsd.projectExplorer`(사이드바 트리)가 여기 온다.
 * 제공자(TreeDataProvider)는 등록부에 남겨 두어, 뒤에 새 화면(U1)이 `getChildren`/`getTreeItem` 을
 * 직접 부를 수 있다. 확장은 `onDidChangeSelection` 으로 트리 클릭을 받는다 — 바깥이 `setSelection` 으로 넣는다.
 */
import { EventEmitter } from './events';
import { guard, type UnimplementedTracker } from './unimplemented';

export interface TreeDataProviderLike {
  getChildren(element?: unknown): unknown;
  getTreeItem(element: unknown): unknown;
  onDidChangeTreeData?: (listener: (e: unknown) => unknown) => { dispose(): unknown };
}

export class ShimTreeView {
  selection: unknown[] = [];
  visible = false;
  title?: string;
  description?: string;
  message?: string;
  private readonly selectionEmitter = new EventEmitter<{ selection: unknown[] }>();
  private readonly visibilityEmitter = new EventEmitter<{ visible: boolean }>();
  readonly onDidChangeSelection = this.selectionEmitter.event;
  readonly onDidChangeVisibility = this.visibilityEmitter.event;
  /** 트리가 바뀌었다고 제공자가 알린 횟수 — 화면이 다시 그릴 때가 됐는지 본다 */
  changeCount = 0;
  private providerSub: { dispose(): unknown } | undefined;

  constructor(readonly viewId: string, readonly options: { treeDataProvider: TreeDataProviderLike; [k: string]: unknown },
    private readonly onReveal: (viewId: string) => void) {
    this.providerSub = options.treeDataProvider.onDidChangeTreeData?.(() => { this.changeCount += 1; });
  }

  async reveal(_element: unknown, _options?: unknown): Promise<void> { this.onReveal(this.viewId); }

  /** 바깥(화면)에서 선택을 바꾼다. */
  setSelection(selection: unknown[]): void {
    this.selection = selection;
    this.selectionEmitter.fire({ selection });
  }

  dispose(): void {
    this.providerSub?.dispose();
    this.selectionEmitter.dispose();
    this.visibilityEmitter.dispose();
  }
}

export class TreeRegistry {
  readonly views = new Map<string, ShimTreeView>();

  constructor(private readonly tracker: UnimplementedTracker, private readonly onReveal: (viewId: string) => void) {}

  createTreeView(viewId: string, options: { treeDataProvider: TreeDataProviderLike }): ShimTreeView {
    const raw = new ShimTreeView(viewId, options, this.onReveal);
    this.views.set(viewId, raw);
    const api = guard(raw, 'TreeView', this.tracker);
    const origDispose = raw.dispose.bind(raw);
    raw.dispose = () => {
      origDispose();
      if (this.views.get(viewId) === raw) { this.views.delete(viewId); }
    };
    return api;
  }

  /** 등록된 제공자(화면이 트리를 그릴 때) */
  provider(viewId: string): TreeDataProviderLike | undefined { return this.views.get(viewId)?.options.treeDataProvider; }
}
