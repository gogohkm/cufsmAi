/**
 * ExtensionContext — StCFSD 호스트가 읽는 것은 `subscriptions` · `extensionPath` · `extensionUri` ·
 * `extensionMode` 넷뿐이다. 나머지는 VS Code 와 같은 모양으로 경로만 둔다(폴더는 만들지 않는다).
 *
 * `globalState` · `workspaceState`(Memento)는 쓰지 않아서 두지 않았다. 확장이 그것을 찾으면
 * `[vscode-shim] 미구현: ExtensionContext.globalState` 로 남는다 — 그때 StAnal 의 `FileMemento` 를 옮긴다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Uri } from './uri';
import { ExtensionKind, ExtensionMode } from './types';
import { guard, type UnimplementedTracker } from './unimplemented';

export interface ContextOptions {
  /** 확장 폴더. 개발판은 저장소 루트 — `python/` · `media/` · `webview/` · `.venv` 를 여기서 찾는다 */
  extensionPath: string;
  userDataDir: string;
  extensionMode: ExtensionMode;
}

export function createExtensionContext(opts: ContextOptions, tracker: UnimplementedTracker) {
  const globalStoragePath = path.join(opts.userDataDir, 'globalStorage');
  const logPath = path.join(opts.userDataDir, 'logs');
  const subscriptions: Array<{ dispose(): unknown }> = [];
  let packageJSON: Record<string, unknown> = {};
  try { packageJSON = JSON.parse(fs.readFileSync(path.join(opts.extensionPath, 'package.json'), 'utf8')); } catch { /* 없으면 빈 것 */ }
  const extensionUri = Uri.file(opts.extensionPath);
  const ctx = {
    subscriptions,
    extensionPath: opts.extensionPath,
    extensionUri,
    extensionMode: opts.extensionMode,
    globalStorageUri: Uri.file(globalStoragePath),
    globalStoragePath,
    // 작업 폴더가 없다 — VS Code 도 빈 창에서는 storageUri 가 undefined 다.
    storageUri: undefined,
    storagePath: undefined,
    logUri: Uri.file(logPath),
    logPath,
    asAbsolutePath: (relative: string) => path.join(opts.extensionPath, relative),
    extension: {
      id: `${String(packageJSON.publisher ?? 'stcfsd')}.${String(packageJSON.name ?? 'stcfsd')}`,
      extensionUri, extensionPath: opts.extensionPath, isActive: true, packageJSON,
      extensionKind: ExtensionKind.Workspace, exports: undefined,
    },
  };
  return guard(ctx, 'ExtensionContext', tracker);
}

export type ShimExtensionContext = ReturnType<typeof createExtensionContext>;
