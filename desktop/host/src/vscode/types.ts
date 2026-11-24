/**
 * 열거형과 값 객체 — 화면과 무관한 vscode 의 순수 자료형.
 *
 * StCFSD 호스트가 쓰는 것만 둔다(`ViewColumn` · `ProgressLocation` · `TreeItemCollapsibleState` ·
 * `ExtensionMode` · `ThemeIcon` · `TreeItem`). 나머지는 대체 모듈 안에서 쓰는 것(`ConfigurationTarget` ·
 * `ExtensionKind` · `UIKind` · `FileType`)이다. 없는 것을 확장이 찾으면 미구현 기록에 남는다.
 */
import { Uri } from './uri';

export enum ViewColumn { Active = -1, Beside = -2, One = 1, Two = 2, Three = 3, Four = 4, Five = 5, Six = 6, Seven = 7, Eight = 8, Nine = 9 }
export enum ProgressLocation { SourceControl = 1, Window = 10, Notification = 15 }
export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
export enum ConfigurationTarget { Global = 1, Workspace = 2, WorkspaceFolder = 3 }
export enum ExtensionMode { Production = 1, Development = 2, Test = 3 }
export enum ExtensionKind { UI = 1, Workspace = 2 }
export enum UIKind { Desktop = 1, Web = 2 }
export enum FileType { Unknown = 0, File = 1, Directory = 2, SymbolicLink = 64 }

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class ThemeIcon {
  static readonly File = new ThemeIcon('file');
  static readonly Folder = new ThemeIcon('folder');
  constructor(public readonly id: string, public readonly color?: ThemeColor) {}
}

/**
 * TreeItem — 확장의 `StcfsdTreeItem`(`src/webview/ProjectExplorerProvider.ts`)이 **모듈 최상단에서**
 * 이것을 상속한다. 그래서 `out/extension.js` 를 require 하는 순간 진짜 클래스여야 한다.
 */
export class TreeItem {
  label?: string | { label: string };
  id?: string;
  iconPath?: unknown;
  description?: string | boolean;
  resourceUri?: Uri;
  tooltip?: unknown;
  command?: { command: string; title: string; arguments?: unknown[] };
  collapsibleState?: TreeItemCollapsibleState;
  contextValue?: string;

  constructor(labelOrUri: string | { label: string } | Uri, collapsibleState?: TreeItemCollapsibleState) {
    if (labelOrUri instanceof Uri) { this.resourceUri = labelOrUri; } else { this.label = labelOrUri; }
    this.collapsibleState = collapsibleState ?? TreeItemCollapsibleState.None;
  }
}
