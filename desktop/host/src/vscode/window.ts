/** vscode.window — 물음은 모두 HostPlatform 으로 보내고, 화면 객체(패널 · 트리)는 등록부에 둔다. */
import type { HostPlatform, PickItem } from '../platform';
import { CancellationTokenSource, type CancellationToken } from './events';
import { Uri } from './uri';
import type { ViewColumn } from './types';
import { createWebviewPanel, type WebviewHub } from './webview';
import type { TreeRegistry, TreeDataProviderLike } from './tree';

export interface WindowDeps {
  platform: HostPlatform;
  hub: WebviewHub;
  trees: TreeRegistry;
}

type MessageItemLike = string | { title: string; isCloseAffordance?: boolean };

function splitMessageArgs(rest: unknown[]): { options: { modal?: boolean; detail?: string }; items: MessageItemLike[] } {
  // (message, options?, ...items) 또는 (message, ...items)
  if (rest.length > 0 && rest[0] && typeof rest[0] === 'object' && !('title' in (rest[0] as object))) {
    return { options: rest[0] as { modal?: boolean; detail?: string }, items: rest.slice(1).filter(Boolean) as MessageItemLike[] };
  }
  return { options: {}, items: rest.filter(Boolean) as MessageItemLike[] };
}

function fsPathOf(uri: unknown): string | undefined {
  return uri instanceof Uri ? uri.fsPath : (uri as { fsPath?: string } | undefined)?.fsPath;
}

export function createWindowNamespace(d: WindowDeps) {
  const { platform } = d;
  let progressSeq = 0;

  const message = (severity: 'info' | 'warning' | 'error') =>
    async (text: string, ...rest: unknown[]): Promise<MessageItemLike | undefined> => {
      const { options, items } = splitMessageArgs(rest);
      const titles = items.map(i => (typeof i === 'string' ? i : i.title));
      const answer = await platform.notify({
        severity, message: String(text), items: titles, modal: options.modal === true, detail: options.detail,
      });
      if (answer === undefined) {
        // 모달을 닫으면 VS Code 는 isCloseAffordance 항목을 돌려준다.
        return options.modal ? items.find(i => typeof i !== 'string' && i.isCloseAffordance) : undefined;
      }
      return items[titles.indexOf(answer)];
    };

  return {
    showInformationMessage: message('info'),
    showWarningMessage: message('warning'),
    showErrorMessage: message('error'),

    async showQuickPick(itemsArg: unknown, options: Record<string, any> = {}, _token?: CancellationToken) {
      const raw = (await itemsArg) as Array<string | PickItem>;
      const items: PickItem[] = raw.map(i => (typeof i === 'string' ? { label: i } : i));
      const canPickMany = options.canPickMany === true;
      const answer = await platform.pick({ items, canPickMany, title: options.title, placeHolder: options.placeHolder });
      if (answer === undefined) { return undefined; }
      if (canPickMany) {
        const idx = Array.isArray(answer) ? answer : [answer];
        return idx.map(i => raw[i]).filter(v => v !== undefined);
      }
      return raw[Array.isArray(answer) ? answer[0] : answer];
    },

    async showInputBox(options: Record<string, any> = {}, _token?: CancellationToken) {
      const answer = await platform.input({
        title: options.title, prompt: options.prompt, value: options.value,
        placeHolder: options.placeHolder, password: options.password,
      });
      if (answer === undefined) { return undefined; }
      if (typeof options.validateInput === 'function') {
        const problem = await options.validateInput(answer);
        // 화면이 있으면 다시 묻는다. 답을 정해 두는 쪽(headless)은 다시 물을 수 없으니 취소로 본다.
        if (problem) { return undefined; }
      }
      return answer;
    },

    async showOpenDialog(options: Record<string, any> = {}) {
      const answer = await platform.fileDialog({
        kind: 'open', title: options.title, defaultPath: fsPathOf(options.defaultUri), filters: options.filters,
        canSelectFiles: options.canSelectFiles ?? true, canSelectFolders: options.canSelectFolders ?? false,
        canSelectMany: options.canSelectMany ?? false, openLabel: options.openLabel,
      });
      return answer?.map(p => Uri.file(p));
    },

    async showSaveDialog(options: Record<string, any> = {}) {
      const answer = await platform.fileDialog({
        kind: 'save', title: options.title, defaultPath: fsPathOf(options.defaultUri), filters: options.filters,
        saveLabel: options.saveLabel,
      });
      return answer?.[0] ? Uri.file(answer[0]) : undefined;
    },

    async withProgress<R>(options: { location?: unknown; title?: string; cancellable?: boolean },
      task: (progress: { report(v: { message?: string; increment?: number }): void }, token: CancellationToken) => PromiseLike<R> | R): Promise<R> {
      progressSeq += 1;
      const id = progressSeq;
      const cts = new CancellationTokenSource();
      let percent = 0;
      const cancellable = options.cancellable === true;
      platform.progress({ id, title: options.title, done: false, cancellable });
      try {
        return await task({
          report(v) {
            if (typeof v.increment === 'number') { percent += v.increment; }
            platform.progress({ id, title: options.title, message: v.message, percent, done: false, cancellable });
          },
        }, cts.token);
      } finally {
        platform.progress({ id, title: options.title, percent, done: true, cancellable });
        cts.dispose();
      }
    },

    createWebviewPanel: (viewType: string, title: string, showOptions: ViewColumn | { viewColumn: ViewColumn } | undefined,
      options?: Record<string, unknown>) => createWebviewPanel(d.hub, viewType, title, showOptions, options ?? {}),
    createTreeView: (viewId: string, options: { treeDataProvider: TreeDataProviderLike }) => d.trees.createTreeView(viewId, options),

    // 텍스트 편집기는 없다. 키는 두어 "없음"이 정상 상태임을 알린다(StcfsdPanel.createOrShow 가 읽는다).
    activeTextEditor: undefined,
  };
}
