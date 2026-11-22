/**
 * 화면 다리 — 호스트가 127.0.0.1 에 여는 화면용 HTTP 서버(S2). 지금의 웹뷰(탭 6개)를 보통 브라우저에서 그대로 돌린다.
 *
 *   startBridge(host, { platform, port?, theme?, claude? }) → { url, origin, port, token, events, dispose() }
 *
 * 두 곳에서 듣는다(V5-04 · V5-18 — 인증과 열쇠는 http.ts 머리말). 포트가 다르니 출처가 다르다:
 *  틀 서버(`origin`):
 *  - `/`                    틀: 제목 표시줄 + 설계 패널 iframe(+ 좌굴 보고서 패널) + 호스트의 물음(`frame/`)
 *  - `/?t=<토큰>`           브라우저의 첫 진입 — 쿠키 + 쓰기 열쇠(그 탭의 sessionStorage)를 주는 작은 페이지 뒤 `/` · `/ui/` 로
 *  - `/api/wv-key?id=`      그 웹뷰의 열쇠(쓰기 열쇠가 있어야 — 틀이 받아 그 id 를 실은 자기 iframe 에만 postMessage 로 건넨다)
 *  웹뷰 서버(`webviewOrigin` — 쓰기 경로가 없다):
 *  - `/wv/<id>/`            웹뷰 HTML(리소스 주소 · CSP · nonce 고쳐 쓰기, `acquireVsCodeApi` 대체, 테마 — inject.ts)
 *  - `/res/webview/…` · `/res/media/…`   웹뷰 리소스(두 뿌리만)
 *  - `/api/wv/<id>/out?k=`  호스트 → 웹뷰(SSE, 차례대로, 새로 고침이면 다시 보내기 — channel.ts) · `…/in` 웹뷰 → 호스트(POST, 웹뷰 열쇠)
 *  틀 서버(이어서):
 *  - `/api/events`          틀이 받는 이벤트(SSE): 호스트의 물음 · 알림 · 진행, 웹뷰가 생김 · 없어짐, 지금 파일
 *  - `/api/state`           지금 상태(틀이 처음 그릴 때)
 *  - `/api/platform/answer` 호스트의 물음에 대한 답
 *  - `/api/webviews/<id>/close`  웹뷰 닫기(좌굴 보고서). 설계 패널은 고정이라 숨김만 된다
 *  - `/api/mcp/<경로>`      호스트의 MCP 다리로 중계(그 토큰을 다리가 붙인다 — 화면에는 주지 않는다. AI 요청 id 머리 없음)
 *  - `/api/claude/status`   Claude Desktop 연결 상태(읽기만) · `POST /api/claude/connect|disconnect` 등록 · 지우기(S4, 화면의 세션만 — claude.ts)
 *  - `/ui/`                 새 검토 화면(U1, `desktop/ui/` — `uiDir` 를 줄 때만). U4 부터 기본 화면이다 — `/` 가 여기로 보낸다
 *                           (예전의 틀은 `defaultScreen: 'classic'` 일 때 `/` 에)
 *  - `/api/wv/<id>/last` · `…/first`  다시 보내기 기록에 남은 호스트 → 웹뷰 메시지(새 화면이 읽는다, U1)
 *  이벤트 `host:message {id, viewType, command, seq}` — 호스트가 설계 패널에 메시지를 보낼 때마다(본문 없음, U1).
 *    `focusRequest` 만 본문을 `focus` 로 싣는다(한 번만 뜻이 있어 기록에 남기지 않는다 — U3, 보기 계약 3절)
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type * as net from 'node:net';
import * as path from 'node:path';
import type { HostHandle } from '../loader';
import { Channel } from './channel';
import { createClaudeRoutes, type BridgeClaudeOptions } from './claude';
import {
  baseHeaders, bootstrapTarget, checkRequest, hasKey, readJson, safeFile, sameToken, sendFile, sendJson, sendText, sessionCookie,
  WEBVIEW_KEY_HEADER, WRITE_HEADER, type Guard,
} from './http';
import { injectWebviewHtml, type ResourceRoot } from './inject';
import type { BridgePlatform } from './platform';
import { EventBus, SseStream, type BridgeEvent } from './sse';
import type { ThemeName } from './theme';

/** 브라우저의 쓰기 열쇠 자리(틀 출처의 sessionStorage) — 이름에 포트를 넣는다. 틀 · 새 화면이 같은 이름을 읽는다 */
export const WRITE_KEY_STORAGE = 'stcfsd.bridge.key.';

export { createBridgePlatform, defaultDocumentsDir } from './platform';
export type { BridgePlatform, BridgePlatformOptions, PendingQuestion } from './platform';
export type { BridgeClaudeOptions, ClaudeStatus, ClaudeActionResult, ClaudeUiState } from './claude';
export { invalidConfigText, writeFailedText } from './claude';
export type { BridgeEvent } from './sse';
export { themeVariables, usedThemeVariables, missingThemeVariables, themeCss } from './theme';
export type { ThemeName } from './theme';
export { injectWebviewHtml, rewriteCsp, rewriteResourceUrls } from './inject';

export interface StartBridgeOptions {
  /** startHost 에 넘긴 createBridgePlatform() — 물음을 화면으로 넘기려면 같은 것을 준다 */
  platform: BridgePlatform;
  /** 0 이면 빈 포트 */
  port?: number;
  /** 웹뷰 서버의 포트(0 이면 빈 포트) */
  webviewPort?: number;
  theme?: ThemeName;
  log?: (line: string) => void;
  /** Claude Desktop 연결 상태. 시험은 임시 폴더의 가짜 설정을 준다 */
  claude?: BridgeClaudeOptions;
  /** 틀의 파일 폴더(기본: desktop/host/frame) */
  frameDir?: string;
  /**
   * 새 검토 화면의 폴더(U1 — `desktop/ui`: `index.html` · `dist/` · `style/`). 주면 `/ui/` 로 내준다. 주지 않으면 `/ui/` 는 없다.
   */
  uiDir?: string;
  /**
   * 기본 화면(U4) — `/` 가 무엇인가. `'ui'`(기본, `uiDir` 가 있을 때): `/` 는 새 검토 화면 `/ui/` 로 보낸다(303).
   * `'classic'`: `/` 는 예전의 틀(제목 표시줄 + 설계 화면 탭 6개) — 한 판 동안 스위치(serve · 창의 `--ui classic`)로 남긴다.
   */
  defaultScreen?: 'ui' | 'classic';
}

export interface BridgeHandle {
  /** 토큰이 붙은 첫 진입 주소 — 브라우저로 연다 */
  url: string;
  /** 새 검토 화면의 토큰 붙은 주소(`uiDir` 를 주었을 때만) */
  uiUrl?: string;
  origin: string;
  port: number;
  /** 읽기 인증(Bearer). 브라우저 쿠키의 값은 이것이 아니다 */
  token: string;
  /** 쓰기 열쇠(`X-StCFSD-Key`) — 틀 서버의 GET 아닌 요청 · `/api/wv-key` 에 필요하다. Electron 은 맨 위 프레임 요청에만 붙인다 */
  writeKey: string;
  /** 웹뷰 서버 — 끼운 웹뷰(iframe)는 이 출처에서 돈다 */
  webviewOrigin: string;
  webviewPort: number;
  readonly events: EventBus;
  /** 같은 프로세스에서 이벤트를 듣는다(`/api/events` 와 같은 것). 돌려받은 함수 = 그만 듣기 */
  on(listener: (ev: BridgeEvent) => void): () => void;
  /** 지금 파일(제목 표시줄) — 다리를 거치지 않고 연 파일(`--open`)을 알린다 */
  setCurrentFile(file: string | undefined): void;
  /** 통로 진단(시험) */
  channels(): Array<{ id: string; viewType: string; connected: boolean; ready: boolean; posted: number; replays: number; replay: string[] }>;
  dispose(): Promise<void>;
}

const DESIGNER_VIEW_TYPE = 'stcfsd.designer';
/** 새 검토 화면이 같은 출처로 받는 3D 렌더러 번들(media/ 의 이 두 파일만 — 진입점 + Babylon 지연 조각) */
const VIEWER3D_FILES = new Set(['viewer3d.js', 'viewer3d.mode-shape-renderer.js']);

export async function startBridge(host: HostHandle, options: StartBridgeOptions): Promise<BridgeHandle> {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  if (host.screenless) {
    throw new Error('화면 다리는 startHost({ screenless: false }) 로 띄운 호스트에만 붙는다 — 웹뷰 대역과 진짜 화면이 함께 답하면 저장이 두 번 돈다');
  }
  const repoRoot = host.context.extensionPath as string;
  const frameDir = path.resolve(options.frameDir ?? path.join(__dirname, '..', 'frame'));
  const uiDir = options.uiDir && fs.existsSync(path.join(options.uiDir, 'index.html')) ? path.resolve(options.uiDir) : undefined;
  const uiDefault = !!uiDir && options.defaultScreen !== 'classic';
  if (options.uiDir && !uiDir) { log(`[bridge] 새 화면 폴더에 index.html 이 없다 — /ui/ 를 내주지 않는다: ${options.uiDir}`); }
  const theme: ThemeName = options.theme ?? 'dark';
  const roots: ResourceRoot[] = [
    { name: 'webview', dir: path.join(repoRoot, 'webview') },
    { name: 'media', dir: path.join(repoRoot, 'media') },
  ];
  const token = crypto.randomBytes(24).toString('base64url');
  const cookieValue = crypto.randomBytes(24).toString('base64url');
  const writeKey = crypto.randomBytes(24).toString('base64url');
  // 웹뷰 열쇠는 웹뷰마다(V5b-06) — 하나의 비밀에서 웹뷰 id 로 만든다. 그 웹뷰의 /api/wv/<id>/ 통로에서만 맞는다
  const webviewSecret = crypto.randomBytes(32);
  const webviewKey = (id: string) => crypto.createHmac('sha256', webviewSecret).update(`stcfsd-webview\n${id}`).digest('base64url');
  const hub = host.webviews;
  const bus = new EventBus();
  const channels = new Map<string, Channel>();
  const platform = options.platform;
  const subs: Array<{ dispose(): unknown }> = [];
  let currentFile: string | undefined;
  let disposing = false;

  const channelFor = (id: string): Channel | undefined => {
    let ch = channels.get(id);
    if (!ch) {
      const info = hub.list().find(w => w.id === id);
      if (!info) { return undefined; }
      ch = new Channel(id, info.viewType, info.viewType === DESIGNER_VIEW_TYPE ? 'webviewReady' : undefined);
      channels.set(id, ch);
    }
    return ch;
  };
  // 웹뷰 서버의 출처 — HTTP 를 열기 전에 쓰는 곳(이벤트의 주소)이 있어 미리 자리만 둔다(listen 뒤 채운다)
  let wvOrigin = '';
  const wvUrl = (id: string) => `${wvOrigin}/wv/${encodeURIComponent(id)}/`;
  const webviewList = () => hub.list().map(w => {
    const ch = channels.get(w.id);
    return { id: w.id, viewType: w.viewType, title: w.title, pinned: w.pinned, visible: w.visible,
      connected: !!ch?.client, ready: !!ch?.client?.ready, url: wvUrl(w.id) };
  });

  // ── 웹뷰 생김 · 없어짐 · 호스트 → 웹뷰 ─────────────────────────────
  for (const w of hub.list()) { channelFor(w.id); }
  subs.push(hub.onDidCreate.event(info => {
    channelFor(info.id);
    bus.emit('webview:created', 'host', { id: info.id, viewType: info.viewType, title: info.title, url: wvUrl(info.id) });
  }));
  subs.push(hub.onDidDispose.event(info => {
    channels.get(info.id)?.close('webview disposed');
    channels.delete(info.id);
    bus.emit('webview:disposed', 'host', { id: info.id, viewType: info.viewType });
  }));
  subs.push(hub.onDidSetHtml.event(({ id }) => {
    // 좌굴 보고서는 같은 패널에 HTML 을 다시 넣는다(보고서를 다시 열면) — 틀이 iframe 을 다시 읽게 한다.
    bus.emit('webview:html', 'host', { id });
  }));
  const designerId = host.designer.id;
  subs.push(hub.onDidPostMessage.event(({ id, message }) => {
    const ch = channelFor(id);
    ch?.push(message);
    // 새 화면(U1)이 따라가도록 — 설계 패널에 간 메시지의 이름과 순서 번호만 알린다(본문은 `/api/wv/<id>/last` 로 읽는다).
    if (id === designerId && ch) {
      const command = (message as { command?: unknown })?.command;
      // focusRequest(보기 계약 3절)는 다시 보내기 기록에 남지 않으므로(channel.ts TRANSIENT) 본문을 이 이벤트에 한 번만 싣는다
      const focus = command === 'focusRequest' ? (message as { data?: unknown }).data ?? null : undefined;
      // caseDiscarded(K2 — 저장하지 않은 변경을 버리고 열었다)도 한 번만 뜻이 있는 알림 — 본문을 `discarded` 로 싣는다
      const discarded = command === 'caseDiscarded' ? (message as { data?: unknown }).data ?? null : undefined;
      bus.emit('host:message', 'host', { id, viewType: ch.viewType, command: typeof command === 'string' ? command : null, seq: ch.lastSeq,
        ...(focus !== undefined ? { focus } : {}), ...(discarded !== undefined ? { discarded } : {}) });
    }
  }));
  subs.push(hub.onDidRefuseDispose.event(info => { bus.emit('webview:refused', 'host', { id: info.id, viewType: info.viewType }); }));

  // ── 지금 파일(제목 표시줄) ──────────────────────────────────────────
  const setCurrentFile = (file: string | undefined) => {
    if (file === currentFile) { return; }
    currentFile = file;
    bus.emit('file:current', 'bridge', { file: currentFile ?? null, name: currentFile ? path.basename(currentFile) : null });
  };
  let pendingFile: string | undefined;
  platform.onDialogAnswered = (req, paths) => {
    const csd = !req.filters || Object.values(req.filters).flat().some(e => e === 'csd');
    pendingFile = csd && paths?.[0] ? paths[0] : undefined;
  };
  platform.onNotify = req => {
    const m = /^Project (?:loaded|saved)(?: with notes)?(?:: (.+))?$/s.exec(req.message);
    if (m && req.severity !== 'error') {
      const named = m[1] && fs.existsSync(m[1].trim()) ? m[1].trim() : undefined;
      if (named || pendingFile) { setCurrentFile(named ?? pendingFile); }
      pendingFile = undefined;
    } else if (req.severity === 'error') { pendingFile = undefined; }
  };

  // ── 플랫폼(호스트의 물음) ──────────────────────────────────────────
  const detachPlatform = platform.attach({
    hasClient: () => bus.clientCount > 0,
    emit: (type, payload) => { bus.emit(type, 'platform', payload); },
  });
  bus.onClientsChanged = count => { if (count === 0) { platform.cancelAll('화면이 모두 떨어졌다'); } };

  // ── 설계 패널의 처음 webviewReady — 다리가 한 번(channel.ts 머리말) ────────
  {
    let loaded = false;
    const sub = hub.onDidPostMessage.event(({ id, message }) => {
      if (id === designerId && (message as { command?: string })?.command === 'modelLoaded') { loaded = true; }
    });
    hub.deliver(designerId, { command: 'webviewReady' });
    const deadline = Date.now() + 60_000;
    while (!loaded && Date.now() < deadline) { await new Promise(r => setTimeout(r, 25)); }
    sub.dispose();
    if (!loaded) { log('[bridge] 경고: 설계 패널이 60 초 안에 기본 단면(modelLoaded)을 보내지 않았다'); }
    // K2 — 검토 상태의 첫 caseHello 도 다리가 한 번 낸다(입력 없이: 호스트의 상태를 바꾸지 않는다). VS Code 의 패널은 늘 떠 있어
    // 상태가 바뀌는 것을 다 받지만, 독립 프로그램의 페이지는 다리보다 늦게(파일을 연 뒤에도) 붙는다. 그래서 페이지의 hello 는 늘
    // 「두 번째」가 되고, 호스트는 그때마다 지금 상태(caseState)를 새로 보낸다 — 다시 보내기 기록의 옛 상태를 쓰지 않는다(channel.ts).
    hub.deliver(designerId, { command: 'caseHello', data: {} });
  }

  const claude = createClaudeRoutes(host, options.claude);

  // ── HTTP ──────────────────────────────────────────────────────────
  const sockets = new Set<net.Socket>();
  const listen = async (p: number | undefined) => {
    const s = http.createServer();
    s.on('connection', c => { sockets.add(c); c.on('close', () => sockets.delete(c)); });
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(p ?? 0, '127.0.0.1', () => { s.off('error', reject); resolve(); });
    });
    return { server: s, port: (s.address() as net.AddressInfo).port };
  };
  const main = await listen(options.port);
  const wv = await listen(options.webviewPort).catch(async err => { await new Promise(r => main.server.close(r)); throw err; });
  const server = main.server;
  const wvServer = wv.server;
  const port = main.port;
  const webviewPort = wv.port;
  // 쿠키 이름은 틀 서버의 포트로 — 쿠키는 포트를 가리지 않아 웹뷰 서버에도 같은 쿠키가 간다(그래서 웹뷰 서버도 이 이름을 본다)
  const cookieName = `stcfsd_bridge_${port}`;
  const guard: Guard = { token, cookie: cookieValue, port, cookieName, bootstrap: true };
  const wvGuard: Guard = { token, cookie: cookieValue, port: webviewPort, cookieName };
  const origin = `http://127.0.0.1:${port}`;
  wvOrigin = `http://127.0.0.1:${webviewPort}`;
  const frameCsp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
    + `connect-src 'self'; frame-src 'self' ${wvOrigin}; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`;
  const forbidden = (res: http.ServerResponse, what: string) => sendJson(res, 403, { success: false, error: `${what} — 화면의 쓰기 열쇠가 없다` });

  /**
   * `?t=` 교환 — 쿠키(읽기)를 주고, 쓰기 열쇠를 이 탭의 sessionStorage(틀 출처)에 넣은 뒤 정해진 화면으로 간다.
   * 열쇠는 이 응답의 본문(스크립트)에만 있다 — 주소 · 쿠키 · 웹뷰에는 없다. 쿠키만 가진 곳은 이 교환을 할 수 없다(쿠키 ≠ 토큰).
   */
  const bootstrapPage = (res: http.ServerResponse, target: string) => {
    const nonce = crypto.randomBytes(18).toString('base64');
    const js = `try{sessionStorage.setItem(${JSON.stringify(WRITE_KEY_STORAGE + port)},${JSON.stringify(writeKey)});}catch(e){}`
      + `location.replace(${JSON.stringify(target)});`;
    const body = `<!doctype html><meta charset="utf-8"><title>StCFSD</title><script nonce="${nonce}">${js}</script>`;
    sendText(res, 200, body, 'text/html; charset=utf-8', {
      'Set-Cookie': sessionCookie(guard),
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    });
  };

  const relayMcp = (req: http.IncomingMessage, res: http.ServerResponse, rest: string, search: string) => {
    const mcp = host.mcp;
    // 화면의 머리(쿠키 · Origin …)는 넘기지 않는다. 토큰은 다리가 붙이고, AI 호출 표시(X-StCFSD-Request-Id)는 붙이지 않는다.
    const headers: http.OutgoingHttpHeaders = { Authorization: `Bearer ${mcp.token}`, Accept: 'application/json', Connection: 'close' };
    if (req.headers['content-type']) { headers['Content-Type'] = req.headers['content-type']; }
    if (req.headers['content-length']) { headers['Content-Length'] = req.headers['content-length']; }
    const up = http.request({ host: '127.0.0.1', port: mcp.port, method: req.method, path: `/${rest}${search}`, headers }, upRes => {
      res.writeHead(upRes.statusCode ?? 502, { 'Content-Type': upRes.headers['content-type'] ?? 'application/json' });
      upRes.pipe(res);
    });
    up.setTimeout(10 * 60_000, () => up.destroy(new Error('MCP 응답 시간 초과')));
    up.on('error', err => sendJson(res, 502, { success: false, error: `MCP 중계 실패: ${err.message}` }));
    req.pipe(up);
  };

  const state = () => ({
    designer: designerId, webviews: webviewList(), theme, ui: !!uiDir, screen: uiDefault ? 'ui' : 'classic', webviewOrigin: wvOrigin,
    currentFile: currentFile ?? null, currentName: currentFile ? path.basename(currentFile) : null,
    platform: platform.snapshot(), lastSeq: bus.lastSeq,
  });

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    baseHeaders(res);
    let url: URL;
    try { url = new URL(req.url ?? '/', origin); } catch { sendText(res, 400, 'bad url'); return; }
    const verdict = checkRequest(req, url, guard);
    if (!verdict.ok) { sendJson(res, verdict.status, { success: false, error: verdict.error }); return; }
    const p = url.pathname;
    if (verdict.viaQuery) {
      // 토큰을 쿠키(따로 만든 값) + 쓰기 열쇠로 바꾼다. 돌아갈 곳은 요청 경로가 아니라 정해진 화면(V5-10).
      bootstrapPage(res, bootstrapTarget(p, url.searchParams, !!uiDir));
      return;
    }
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'POST') { sendJson(res, 405, { success: false, error: 'GET · POST 만' }); return; }
    // 쓰기(V5-04): GET 이 아닌 모든 요청은 쓰기 열쇠가 있어야 한다 — 쿠키(브라우저가 다른 포트로도 보내는 것)만으로는 받지 않는다.
    if (method !== 'GET' && !hasKey(req, WRITE_HEADER, writeKey)) { forbidden(res, `${method} ${p}`); return; }
    if (p === '/api/wv-key' && method === 'GET') {
      if (!hasKey(req, WRITE_HEADER, writeKey)) { forbidden(res, 'GET /api/wv-key'); return; }
      const id = url.searchParams.get('id') ?? '';
      if (!id) { sendJson(res, 400, { success: false, error: '웹뷰 id(?id=) 가 필요하다 — 열쇠는 웹뷰마다다' }); return; }
      if (!hub.has(id)) { sendJson(res, 404, { success: false, error: `웹뷰가 없다: ${id}` }); return; }
      sendJson(res, 200, { success: true, data: { id, key: webviewKey(id), origin: wvOrigin } });
      return;
    }

    // 기본 화면(U4): 새 검토 화면 — `/` 는 `/ui/` 로. 예전의 틀은 `defaultScreen: 'classic'` 일 때만 `/` 에 있다
    if (uiDefault && (p === '/' || p === '/index.html') && method === 'GET') {
      res.writeHead(303, { Location: `/ui/${url.search}` });
      res.end();
      return;
    }
    // 틀
    if (p === '/' || p === '/index.html') {
      const file = safeFile(frameDir, 'index.html');
      if (!file) { sendJson(res, 500, { success: false, error: `틀 파일이 없다: ${frameDir}` }); return; }
      sendFile(res, file, { 'Content-Security-Policy': frameCsp });
      return;
    }
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }

    // 새 검토 화면의 3D 모드 형상(U2 다음 단계가 쓴다): 제품의 렌더러 번들 두 파일만 그 화면과 같은 출처로 내준다.
    // 번들은 eval · WebAssembly 를 쓰지 않는다(webpack 런타임의 `new Function` 은 globalThis 가 없을 때만의 대비 — 브라우저에선 안 돈다)
    // 그래서 화면의 CSP(script-src 'self')를 넓히지 않는다. 지연 조각은 번들이 자기 주소(publicPath auto)에서 찾는다 — 같은 자리.
    const v3 = /^\/ui\/viewer3d\/([^/]+)$/.exec(p);
    if (uiDir && v3 && method === 'GET') {
      const name = v3[1];
      const media = roots.find(r => r.name === 'media');
      const file = VIEWER3D_FILES.has(name) && media ? safeFile(media.dir, name) : undefined;
      if (!file) { sendJson(res, 404, { success: false, error: '없다' }); return; }
      sendFile(res, file);
      return;
    }
    // 새 검토 화면(U1). 정적 파일은 index.html · dist/ · style/ 만 — 소스 · 시험은 내주지 않는다.
    if (uiDir && (p === '/ui' || p.startsWith('/ui/'))) {
      if (p === '/ui') { res.writeHead(303, { Location: `/ui/${url.search}` }); res.end(); return; }
      const rest = p.slice('/ui/'.length);
      const allowed = rest === '' || rest === 'index.html' || /^(dist|style)\//.test(rest);
      const file = allowed ? safeFile(uiDir, rest === '' ? 'index.html' : rest) : undefined;
      if (!file) { sendJson(res, 404, { success: false, error: '없다' }); return; }
      sendFile(res, file, file.endsWith('.html') ? { 'Content-Security-Policy': frameCsp } : {});
      return;
    }
    const frameMatch = /^\/frame\/(.+)$/.exec(p);
    if (frameMatch) {
      const file = safeFile(frameDir, frameMatch[1]);
      if (!file) { sendJson(res, 404, { success: false, error: '없다' }); return; }
      sendFile(res, file);
      return;
    }

    // 다시 보내기 기록 읽기(U1 — 새 화면). ?command=a&command=b → {a: {seq, message}|null, …}
    const lastMatch = /^\/api\/wv\/([^/]+)\/(last|first)$/.exec(p);
    if (lastMatch && method === 'GET') {
      const id = decodeURIComponent(lastMatch[1]);
      const ch = channelFor(id);
      if (!ch) { sendJson(res, 404, { success: false, error: `웹뷰가 없다: ${id}` }); return; }
      const names = url.searchParams.getAll('command').flatMap(c => c.split(',')).map(c => c.trim()).filter(Boolean).slice(0, 40);
      const data: Record<string, unknown> = {};
      for (const c of names) { data[c] = lastMatch[2] === 'last' ? ch.last(c) : ch.firstOf(c); }
      sendJson(res, 200, { success: true, data, seq: ch.lastSeq });
      return;
    }
    if (p === '/api/events' && method === 'GET') {
      const last = req.headers['last-event-id'] ?? url.searchParams.get('since') ?? undefined;
      bus.attach(req, res, last === undefined ? undefined : Number(last), { state: state() });
      return;
    }
    if (p === '/api/state' && method === 'GET') { sendJson(res, 200, { success: true, data: state() }); return; }
    if (p === '/api/platform/answer' && method === 'POST') {
      const b = await readJson(req) as { qid?: unknown; answer?: unknown };
      const problem = platform.answer(String(b?.qid ?? ''), b?.answer);
      sendJson(res, problem ? 400 : 200, problem ? { success: false, error: problem } : { success: true });
      return;
    }
    const closeMatch = /^\/api\/webviews\/([^/]+)\/close$/.exec(p);
    if (closeMatch && method === 'POST') {
      await readJson(req);
      const id = decodeURIComponent(closeMatch[1]);
      if (!hub.has(id)) { sendJson(res, 404, { success: false, error: `웹뷰가 없다: ${id}` }); return; }
      hub.close(id);
      sendJson(res, 200, { success: true, data: { closed: !hub.has(id) } });
      return;
    }
    if (p === '/api/claude/status' && method === 'GET') { sendJson(res, 200, { success: true, data: await claude.status() }); return; }
    const claudeOp = /^\/api\/claude\/(connect|disconnect)$/.exec(p);
    if (claudeOp) {
      // 쓰기 — 화면의 세션(위의 인증)으로만. 본문은 비어 있어도 JSON 이어야 한다(단순 요청 · 폼 전송을 막는다).
      if (method !== 'POST') { sendJson(res, 405, { success: false, error: 'POST' }); return; }
      await readJson(req);
      const out = claudeOp[1] === 'connect' ? await claude.connect() : await claude.disconnect();
      log(`[bridge] Claude ${claudeOp[1]}: ${out.result.ok ? out.result.action : out.result.reason} — ${out.result.message}`);
      bus.emit('claude:status', 'bridge', out.status);
      sendJson(res, 200, { success: true, data: out });
      return;
    }
    const mcpMatch = /^\/api\/mcp\/(.+)$/.exec(p);
    if (mcpMatch) { relayMcp(req, res, mcpMatch[1], url.search); return; }

    sendJson(res, 404, { success: false, error: `없는 경로: ${p}` });
  };

  /**
   * 웹뷰 서버 — 웹뷰 문서 · 리소스 · 호스트 ↔ 웹뷰 통로만. 틀의 쓰기 경로(Claude 설정 · MCP 중계 · 물음 답 · 닫기)는 여기 없다.
   * 통로는 웹뷰 열쇠가 있어야 한다(`out` 은 `?k=`, `in` 은 머리) — 쿠키만 가진 곳은 화면을 빼앗거나(superseded) 메시지를 넣지 못한다.
   */
  const handleWebview = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    baseHeaders(res);
    let url: URL;
    try { url = new URL(req.url ?? '/', wvOrigin); } catch { sendText(res, 400, 'bad url'); return; }
    const p = url.pathname;
    const wvMatch = /^\/wv\/([^/]+)\/?$/.exec(p);
    const verdict = checkRequest(req, url, wvGuard, { frameNavigation: !!wvMatch });
    if (!verdict.ok) { sendJson(res, verdict.status, { success: false, error: verdict.error }); return; }
    const method = req.method ?? 'GET';

    // 웹뷰 HTML
    if (wvMatch && method === 'GET') {
      const id = decodeURIComponent(wvMatch[1]);
      const html = hub.html(id);
      const info = hub.list().find(w => w.id === id);
      if (html === undefined || !info) { sendJson(res, 404, { success: false, error: `웹뷰가 없다: ${id}` }); return; }
      if (!html) { sendJson(res, 503, { success: false, error: '웹뷰 HTML 이 아직 없다' }); return; }
      const t = url.searchParams.get('theme');
      const out = injectWebviewHtml(html, { webviewId: id, viewType: info.viewType, theme: t === 'light' || t === 'dark' ? t : theme, roots, frameOrigin: origin });
      // meta 의 CSP 가 본 정책이다. 머리에는 meta 로 줄 수 없는 frame-ancestors 만 — 틀 서버만 이 문서를 끼울 수 있다.
      // X-Frame-Options(SAMEORIGIN)는 다른 출처인 틀이 끼우는 것을 막으므로 뗀다(frame-ancestors 가 그 일을 한다).
      res.removeHeader('X-Frame-Options');
      sendText(res, 200, out.html, 'text/html; charset=utf-8', { 'Content-Security-Policy': `frame-ancestors ${origin}` });
      return;
    }

    // 웹뷰 리소스
    const resMatch = /^\/res\/([^/]+)\/(.+)$/.exec(p);
    if (resMatch && method === 'GET') {
      const root = roots.find(r => r.name === resMatch[1]);
      const file = root ? safeFile(root.dir, resMatch[2]) : undefined;
      if (!file) { sendJson(res, 404, { success: false, error: '없다' }); return; }
      sendFile(res, file);
      return;
    }

    // 웹뷰 메시지 통로
    const chMatch = /^\/api\/wv\/([^/]+)\/(out|in)$/.exec(p);
    if (chMatch) {
      const id = decodeURIComponent(chMatch[1]);
      const ch = channelFor(id);
      if (!ch) { sendJson(res, 404, { success: false, error: `웹뷰가 없다: ${id}` }); return; }
      if (chMatch[2] === 'out') {
        if (method !== 'GET') { sendJson(res, 405, { success: false, error: 'GET' }); return; }
        const k = url.searchParams.get('k');
        if (!k || !sameToken(k, webviewKey(id))) { sendJson(res, 403, { success: false, error: '웹뷰 열쇠가 없다' }); return; }
        const client = ch.attach(new SseStream(req, res));
        client.sse.onClose.push(() => bus.emit('webview:client', 'bridge', { id, connected: false }));
        bus.emit('webview:client', 'bridge', { id, connected: true });
        return;
      }
      if (method !== 'POST') { sendJson(res, 405, { success: false, error: 'POST' }); return; }
      if (!hasKey(req, WEBVIEW_KEY_HEADER, webviewKey(id))) { sendJson(res, 403, { success: false, error: '웹뷰 열쇠가 없다' }); return; }
      const body = await readJson(req);
      const client = ch.client;
      if (!client || url.searchParams.get('conn') !== client.conn) {
        sendJson(res, 409, { success: false, error: '이 연결은 끝났다(다른 페이지가 가져갔거나 끊겼다)' });
        return;
      }
      const list = Array.isArray(body) ? body : [body];
      for (const msg of list) {
        const command = (msg as { command?: unknown })?.command;
        try {
          if (ch.readyCommand && command === ch.readyCommand) {
            // 페이지의 webviewReady 는 호스트에 넘기지 않는다(넘기면 모델이 기본 단면으로 돌아간다). 다시 보내기로 답한다.
            const n = ch.replayTo(client);
            bus.emit('webview:ready', 'bridge', { id, replayed: n });
          } else {
            hub.deliver(id, msg);
          }
        } catch (err) { log(`[bridge] 웹뷰 메시지 처리 예외(${String(command)}): ${String(err)}`); }
      }
      sendJson(res, 200, { success: true, count: list.length });
      return;
    }
    sendJson(res, 404, { success: false, error: `없는 경로: ${p}` });
  };

  const onError = (req: http.IncomingMessage, res: http.ServerResponse) => (err: unknown) => {
    const status = (err as { status?: number }).status ?? 500;
    if (status === 500) { log(`[bridge] 요청 처리 예외 ${req.method} ${req.url}: ${(err as Error)?.stack ?? err}`); }
    sendJson(res, status, { success: false, error: (err as Error).message });
  };
  server.on('request', (req, res) => { handle(req, res).catch(onError(req, res)); });
  wvServer.on('request', (req, res) => { handleWebview(req, res).catch(onError(req, res)); });

  return {
    url: `${origin}/?t=${token}`, origin, port, token, writeKey, webviewOrigin: wvOrigin, webviewPort,
    uiUrl: uiDir ? `${origin}/ui/?t=${token}` : undefined,
    events: bus,
    on: listener => bus.on(listener),
    setCurrentFile,
    channels: () => [...channels.values()].map(c => ({ id: c.id, viewType: c.viewType, connected: !!c.client,
      ready: !!c.client?.ready, posted: c.posted, replays: c.replays, replay: c.replayCommands() })),
    async dispose() {
      if (disposing) { return; }
      disposing = true;
      for (const s of subs) { s.dispose(); }
      platform.onDialogAnswered = undefined;
      platform.onNotify = undefined;
      detachPlatform();
      for (const ch of channels.values()) { ch.close('bridge closed'); }
      bus.closeAll();
      await Promise.all([server, wvServer].map(s => new Promise<void>(resolve => { s.close(() => resolve()); })).concat([
        Promise.resolve().then(() => { for (const s of sockets) { s.destroy(); } }),
      ]));
    },
  };
}
