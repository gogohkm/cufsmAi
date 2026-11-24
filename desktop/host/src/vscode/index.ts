/**
 * `vscode` 대체 모듈.
 *
 * `createVscodeShim()` 이 만든 `api` 가 확장 호스트(`out/extension.js` 와 그것이 부르는
 * `out/webview/*.js`)의 `require('vscode')` 자리에 들어간다. 최상위와 네임스페이스는 Proxy 로 감싸
 * 없는 멤버에 닿으면 기록한다(`unimplemented.ts`). `runtime` 은 호스트(적재기 · 뒤의 화면 다리 ·
 * 시험)가 쓰는 손잡이다.
 *
 * 두는 것은 StCFSD 호스트가 쓰는 것뿐이다(`src/extension.ts` · `src/webview/StcfsdPanel.ts` ·
 * `src/webview/ProjectExplorerProvider.ts` 를 grep 한 목록 — README 의 표). StAnal 의 대체 모듈에서
 * 커스텀 편집기 · 문서 · 사이드바 웹뷰 · 상태바 · 출력 채널 · 클립보드 · 내장 명령은 가져오지 않았다.
 */
import type { HostPlatform } from '../platform';
import { CommandRegistry, createCommandsNamespace } from './commands';
import { ConfigurationStore } from './configuration';
import { Disposable, EventEmitter } from './events';
import { TreeRegistry } from './tree';
import * as T from './types';
import { guard, UnimplementedTracker } from './unimplemented';
import { Uri } from './uri';
import { WebviewHub, type WebviewResourceMapper } from './webview';
import { createWindowNamespace } from './window';
import { createWorkspaceNamespace } from './workspace';

export interface ShimOptions {
  platform: HostPlatform;
  /** 저장소 `package.json`(설정 기본값의 출처) */
  packageJsonPath: string;
  /** `<userDataDir>/settings.json` */
  settingsFile: string;
  /** 파일에 쓰지 않는 설정 덮어쓰기 */
  settingOverrides?: Record<string, unknown>;
  webviewResources?: WebviewResourceMapper;
  /** 미구현 기록을 찍을 곳 */
  log?: (line: string) => void;
  appRoot?: string;
}

export function createVscodeShim(opts: ShimOptions) {
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const tracker = new UnimplementedTracker(log);
  const { platform } = opts;
  const commands = new CommandRegistry(tracker);
  const config = new ConfigurationStore(opts.packageJsonPath, opts.settingsFile, opts.settingOverrides);
  const hub = new WebviewHub(tracker);
  if (opts.webviewResources) { hub.mapper = opts.webviewResources; }
  const trees = new TreeRegistry(tracker, id => platform.reveal(`tree:${id}`));

  const window = guard(createWindowNamespace({ platform, hub, trees }), 'window', tracker);
  const ws = createWorkspaceNamespace({ tracker, config });
  const workspace = guard(ws.namespace, 'workspace', tracker);
  const commandsNs = guard(createCommandsNamespace(commands), 'commands', tracker);
  const env = guard({
    appName: 'StCFSD',
    appRoot: opts.appRoot ?? process.cwd(),
    appHost: 'desktop',
    language: 'ko',
    machineId: 'stcfsd-desktop',
    sessionId: `stcfsd-${process.pid}-${Date.now()}`,
    uriScheme: 'stcfsd',
    uiKind: T.UIKind.Desktop,
    remoteName: undefined,
    // Python 이 없을 때 확장이 내려받기 쪽을 연다(checkAndInstallDependencies).
    openExternal: (uri: Uri | string) => platform.openExternal(typeof uri === 'string' ? uri : uri.toString()),
  }, 'env', tracker);

  const api = guard({
    // tsc 의 `import * as vscode` 는 `__importStar(require('vscode'))` 다. __esModule 이 없으면 그때 있는
    // 키만 새 객체에 복사해 Proxy 를 거치지 않게 된다 — 최상위의 없는 이름(vscode.StatusBarAlignment 등)이
    // 기록되지 않는다. true 로 두어 이 Proxy 가 그대로 쓰이게 한다.
    __esModule: true,
    version: '1.95.0-stcfsd-shim',
    window, workspace, commands: commandsNs, env,
    Uri, EventEmitter, Disposable,
    ViewColumn: T.ViewColumn, ProgressLocation: T.ProgressLocation,
    TreeItemCollapsibleState: T.TreeItemCollapsibleState, ConfigurationTarget: T.ConfigurationTarget,
    ExtensionMode: T.ExtensionMode, ExtensionKind: T.ExtensionKind, UIKind: T.UIKind, FileType: T.FileType,
    ThemeIcon: T.ThemeIcon, ThemeColor: T.ThemeColor, TreeItem: T.TreeItem,
  }, 'vscode', tracker);

  const runtime = {
    tracker, commands, config, hub, trees, platform,
    /** 화면 객체 · 명령을 모두 정리한다. 고정된 패널도 이때 없어진다. */
    dispose(): void {
      hub.disposeAll();
      for (const v of [...trees.views.values()]) { v.dispose(); }
      commands.dispose();
      config.onDidChange.dispose();
      ws.dispose();
    },
  };
  return { api, runtime };
}

export type VscodeShim = ReturnType<typeof createVscodeShim>;
export type ShimRuntime = VscodeShim['runtime'];
export { UnimplementedTracker } from './unimplemented';
export type { WebviewInfo, WebviewResourceMapper } from './webview';
