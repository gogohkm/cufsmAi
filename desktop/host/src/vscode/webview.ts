/**
 * Webview · WebviewPanel — 객체는 제대로 만들되 화면은 없다.
 *
 * 모든 패널은 `WebviewHub` 에 id 로 등록된다. 바깥(S2 의 화면 다리, 시험)은 hub 로
 *  - 패널이 생기고 없어지는 것, HTML 이 바뀌는 것, 호스트가 웹뷰로 보내는 메시지를 듣고
 *  - `deliver(id, message)` 로 웹뷰가 호스트로 보내는 메시지를 넣는다.
 *
 * StCFSD 의 패널은 둘이다: 설계 패널 `stcfsd.designer`(모델 · 결과가 패널 객체에 있다)와
 * 좌굴 보고서 패널. 설계 패널은 적재기가 `pin()` 해 두어 프로그램이 끝날 때까지 없어지지 않는다
 * (아래 `ShimWebviewPanel.dispose`). 사이드바 웹뷰 뷰 · 커스텀 편집기는 StCFSD 가 쓰지 않아 두지 않았다.
 */
import { EventEmitter, type Event } from './events';
import { Uri, encodeUriPath } from './uri';
import { ViewColumn } from './types';
import { guard, type UnimplementedTracker } from './unimplemented';

export interface WebviewInfo {
  id: string;
  viewType: string;
  title: string;
}

export interface WebviewResourceMapper {
  /** 로컬 파일 Uri → 웹뷰 안에서 쓸 URL 문자열 */
  toWebviewUrl(uri: Uri): string;
  cspSource: string;
}

/** VS Code 와 같은 모양의 기본 주소. `toString()` 하면 VS Code 처럼 `https://file%2B.vscode-resource…/c%3A/…` 가 된다(S2 의 다리가 HTML 에서 고쳐 쓴다). */
export const defaultResourceMapper: WebviewResourceMapper = {
  toWebviewUrl: uri => `https://file+.vscode-resource.vscode-cdn.net${encodeUriPath(uri.path)}`,
  cspSource: 'https://*.vscode-cdn.net',
};

export class WebviewHub {
  private seq = 0;
  private readonly entries = new Map<string, { info: WebviewInfo; webview: ShimWebview; owner: ShimWebviewPanel }>();
  private readonly pinned = new Set<string>();
  /** 호스트가 끝나는 중 — 고정된 패널도 이제는 없앤다 */
  private releasing = false;
  /** 웹뷰가 생겼다 */
  readonly onDidCreate = new EventEmitter<WebviewInfo>();
  readonly onDidDispose = new EventEmitter<WebviewInfo>();
  /** html 이 대입됐다 */
  readonly onDidSetHtml = new EventEmitter<{ id: string; html: string }>();
  /** 호스트 → 웹뷰 메시지(`webview.postMessage`) */
  readonly onDidPostMessage = new EventEmitter<{ id: string; message: unknown }>();
  /** 고정된 패널을 닫으려는 요청을 숨김으로 바꿨다 */
  readonly onDidRefuseDispose = new EventEmitter<WebviewInfo>();
  mapper: WebviewResourceMapper = defaultResourceMapper;

  constructor(readonly tracker: UnimplementedTracker) {}

  nextId(viewType: string): string {
    this.seq += 1;
    return `panel:${viewType}:${this.seq}`;
  }

  add(info: WebviewInfo, webview: ShimWebview, owner: ShimWebviewPanel): void {
    this.entries.set(info.id, { info, webview, owner });
    this.onDidCreate.fire(info);
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) { return; }
    this.entries.delete(id);
    this.pinned.delete(id);
    this.onDidDispose.fire(e.info);
  }

  list(): Array<WebviewInfo & { html: string; visible: boolean; pinned: boolean }> {
    return [...this.entries.values()].map(({ info, webview, owner }) =>
      ({ ...info, html: webview.html, visible: owner.visible, pinned: this.pinned.has(info.id) }));
  }

  has(id: string): boolean { return this.entries.has(id); }

  /** 지금 HTML. 없으면 undefined */
  html(id: string): string | undefined { return this.entries.get(id)?.webview.html; }

  /** 웹뷰 → 호스트 메시지를 넣는다. 그 웹뷰가 없으면 false */
  deliver(id: string, message: unknown): boolean {
    const e = this.entries.get(id);
    if (!e) { return false; }
    e.webview.receive(message);
    return true;
  }

  /** 프로그램이 끝날 때까지 없애지 않는다. 닫기 요청은 숨김이 된다. */
  pin(id: string): void { if (this.entries.has(id)) { this.pinned.add(id); } }
  isPinned(id: string): boolean { return this.pinned.has(id) && !this.releasing; }

  /** 웹뷰를 닫는다(사용자가 탭을 닫은 것과 같다). 고정된 패널이면 숨기기만 한다. */
  close(id: string): void { this.entries.get(id)?.owner.dispose(); }

  /** 호스트를 끝낼 때만 — 고정을 풀고 모두 없앤다. */
  disposeAll(): void {
    this.releasing = true;
    for (const { owner } of [...this.entries.values()]) { try { owner.dispose(); } catch { /* 정리 계속 */ } }
  }
}

export class ShimWebview {
  private htmlValue = '';
  options: Record<string, unknown> = {};
  private readonly received = new EventEmitter<unknown>();
  readonly onDidReceiveMessage: Event<unknown> = this.received.event;
  disposed = false;

  constructor(private readonly hub: WebviewHub, readonly id: string) {}

  get html(): string { return this.htmlValue; }
  set html(value: string) {
    this.htmlValue = value;
    this.hub.onDidSetHtml.fire({ id: this.id, html: value });
  }

  get cspSource(): string { return this.hub.mapper.cspSource; }

  asWebviewUri(uri: Uri): Uri {
    return Uri.parse(this.hub.mapper.toWebviewUrl(uri));
  }

  /** 화면이 없어도 메시지는 만들어진다 — hub 가 바깥으로 알린다(S2 의 다리가 그것을 화면에 넘긴다). */
  async postMessage(message: unknown): Promise<boolean> {
    if (this.disposed) { return false; }
    this.hub.onDidPostMessage.fire({ id: this.id, message });
    return true;
  }

  /** hub 내부용 — 웹뷰가 보낸 메시지를 확장에 넘긴다. */
  receive(message: unknown): void {
    if (!this.disposed) { this.received.fire(message); }
  }

  dispose(): void {
    this.disposed = true;
    this.received.dispose();
  }
}

export class ShimWebviewPanel {
  readonly webview: ShimWebview;
  private rawWebview: ShimWebview;
  title: string;
  iconPath?: unknown;
  viewColumn: ViewColumn | undefined;
  active = true;
  visible = true;
  readonly options: Record<string, unknown>;
  private readonly disposeEmitter = new EventEmitter<void>();
  private readonly viewStateEmitter = new EventEmitter<{ webviewPanel: ShimWebviewPanel }>();
  readonly onDidDispose: Event<void> = this.disposeEmitter.event;
  readonly onDidChangeViewState: Event<{ webviewPanel: ShimWebviewPanel }> = this.viewStateEmitter.event;
  private disposed = false;
  /** guard 를 씌운 자신(이벤트 인자로 넘긴다) */
  self: ShimWebviewPanel = this;

  constructor(
    private readonly hub: WebviewHub,
    readonly id: string,
    readonly viewType: string,
    title: string,
    column: ViewColumn | undefined,
    options: Record<string, unknown>,
  ) {
    this.title = title;
    this.viewColumn = column;
    this.options = options;
    const raw = new ShimWebview(hub, id);
    this.rawWebview = raw;
    this.webview = guard(raw, 'Webview', hub.tracker);
  }

  reveal(column?: ViewColumn, _preserveFocus?: boolean): void {
    if (this.disposed) { return; }
    if (column !== undefined) { this.viewColumn = column; }
    this.setViewState(true, true);
  }

  /** 바깥(화면 다리)에서 보임·포커스를 바꾼다. */
  setViewState(visible: boolean, active: boolean): void {
    if (this.visible === visible && this.active === active) { return; }
    this.visible = visible;
    this.active = active;
    this.viewStateEmitter.fire({ webviewPanel: this.self });
  }

  dispose(): void {
    if (this.disposed) { return; }
    // 설계 패널은 모델과 결과를 쥐고 있다(StcfsdPanel 의 필드). 없어지면 MCP 도구 59개 가운데 58개가
    // "No active CUFSM panel" 로 실패한다 — 닫기는 숨김으로 바꾼다. 호스트가 끝날 때만 없앤다.
    if (this.hub.isPinned(this.id)) {
      this.setViewState(false, false);
      this.hub.onDidRefuseDispose.fire({ id: this.id, viewType: this.viewType, title: this.title });
      return;
    }
    this.disposed = true;
    this.visible = false;
    this.active = false;
    this.rawWebview.dispose();
    this.hub.remove(this.id);
    this.disposeEmitter.fire();
    this.disposeEmitter.dispose();
    this.viewStateEmitter.dispose();
  }
}

export function createWebviewPanel(
  hub: WebviewHub, viewType: string, title: string,
  column: ViewColumn | { viewColumn: ViewColumn } | undefined, options: Record<string, unknown> = {},
): ShimWebviewPanel {
  const id = hub.nextId(viewType);
  const col = typeof column === 'object' && column ? column.viewColumn : column;
  const raw = new ShimWebviewPanel(hub, id, viewType, title, col ?? ViewColumn.One, options);
  const api = guard(raw, 'WebviewPanel', hub.tracker);
  raw.self = api;
  hub.add({ id, viewType, title }, raw.webview, raw);
  return api;
}
