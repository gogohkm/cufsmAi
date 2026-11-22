/**
 * 화면 다리 — 호스트가 127.0.0.1 에 여는 화면용 HTTP 서버(S2). 지금의 웹뷰(탭 6개)를 보통 브라우저에서 그대로 돌린다.
 *
 *   startBridge(host, { platform, port?, theme?, claude? }) → { url, origin, port, token, events, dispose() }
 *
 * 경로(자세한 것은 desktop/host/BRIDGE.md):
 *  - `/`                    틀: 제목 표시줄 + 설계 패널 iframe(+ 좌굴 보고서 패널) + 호스트의 물음(`frame/`)
 *  - `/wv/<id>/`            웹뷰 HTML(리소스 주소 · CSP · nonce 고쳐 쓰기, `acquireVsCodeApi` 대체, 테마 — inject.ts)
 *  - `/res/webview/…` · `/res/media/…`   웹뷰 리소스(두 뿌리만)
 *  - `/api/wv/<id>/out`     호스트 → 웹뷰(SSE, 차례대로, 새로 고침이면 다시 보내기 — channel.ts) · `…/in` 웹뷰 → 호스트(POST)
 *  - `/api/events`          틀이 받는 이벤트(SSE): 호스트의 물음 · 알림 · 진행, 웹뷰가 생김 · 없어짐, 지금 파일
 *  - `/api/state`           지금 상태(틀이 처음 그릴 때)
 *  - `/api/platform/answer` 호스트의 물음에 대한 답
 *  - `/api/webviews/<id>/close`  웹뷰 닫기(좌굴 보고서). 설계 패널은 고정이라 숨김만 된다
 *  - `/api/mcp/<경로>`      호스트의 MCP 다리로 중계(그 토큰을 다리가 붙인다 — 화면에는 주지 않는다. AI 요청 id 머리 없음)
 *  - `/api/claude/status`   Claude Desktop 연결 상태(읽기만) · `POST /api/claude/connect|disconnect` 등록 · 지우기(S4, 화면의 세션만 — claude.ts)
 *  - `/ui/`                 새 검토 화면(U1, `desktop/ui/` — `uiDir` 를 줄 때만). 기본 화면은 여전히 `/` 의 틀이다
 *  - `/api/wv/<id>/last` · `…/first`  다시 보내기 기록에 남은 호스트 → 웹뷰 메시지(새 화면이 읽는다, U1)
 *  이벤트 `host:message {id, viewType, command, seq}` — 호스트가 설계 패널에 메시지를 보낼 때마다(본문 없음, U1)
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
  baseHeaders, checkRequest, readJson, safeFile, sendFile, sendJson, sendText, sessionCookie, type Guard,
} from './http';
import { injectWebviewHtml, type ResourceRoot } from './inject';
import type { BridgePlatform } from './platform';
import { EventBus, SseStream, type BridgeEvent } from './sse';
import type { ThemeName } from './theme';

export { createBridgePlatform, defaultDocumentsDir } from './platform';
export type { BridgePlatform, BridgePlatformOptions, PendingQuestion } from './platform';
export type { BridgeClaudeOptions, ClaudeStatus, ClaudeActionResult, ClaudeUiState } from './claude';
export type { BridgeEvent } from './sse';
export { themeVariables, usedThemeVariables, missingThemeVariables, themeCss } from './theme';
export type { ThemeName } from './theme';
export { injectWebviewHtml, rewriteCsp, rewriteResourceUrls } from './inject';

export interface StartBridgeOptions {
  /** startHost 에 넘긴 createBridgePlatform() — 물음을 화면으로 넘기려면 같은 것을 준다 */
  platform: BridgePlatform;
  /** 0 이면 빈 포트 */
  port?: number;
  theme?: ThemeName;
  log?: (line: string) => void;
  /** Claude Desktop 연결 상태. 시험은 임시 폴더의 가짜 설정을 준다 */
  claude?: BridgeClaudeOptions;
  /** 틀의 파일 폴더(기본: desktop/host/frame) */
  frameDir?: string;
  /**
   * 새 검토 화면의 폴더(U1 — `desktop/ui`: `index.html` · `dist/` · `style/`). 주면 `/ui/` 로 내준다. 주지 않으면 `/ui/` 는 없다.
   * 기본 화면(`/`)은 이것과 상관없이 틀이다 — 무엇을 여는지는 serve 의 `--ui` · 껍데기의 `--ui` 가 고른다.
   */
  uiDir?: string;
}

export interface BridgeHandle {
  /** 토큰이 붙은 첫 진입 주소 — 브라우저로 연다 */
  url: string;
  /** 새 검토 화면의 토큰 붙은 주소(`uiDir` 를 주었을 때만) */
  uiUrl?: string;
  origin: string;
  port: number;
  token: string;
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

export async function startBridge(host: HostHandle, options: StartBridgeOptions): Promise<BridgeHandle> {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  if (host.screenless) {
    throw new Error('화면 다리는 startHost({ screenless: false }) 로 띄운 호스트에만 붙는다 — 웹뷰 대역과 진짜 화면이 함께 답하면 저장이 두 번 돈다');
  }
  const repoRoot = host.context.extensionPath as string;
  const frameDir = path.resolve(options.frameDir ?? path.join(__dirname, '..', 'frame'));
  const uiDir = options.uiDir && fs.existsSync(path.join(options.uiDir, 'index.html')) ? path.resolve(options.uiDir) : undefined;
  if (options.uiDir && !uiDir) { log(`[bridge] 새 화면 폴더에 index.html 이 없다 — /ui/ 를 내주지 않는다: ${options.uiDir}`); }
  const theme: ThemeName = options.theme ?? 'dark';
  const roots: ResourceRoot[] = [
    { name: 'webview', dir: path.join(repoRoot, 'webview') },
    { name: 'media', dir: path.join(repoRoot, 'media') },
  ];
  const token = crypto.randomBytes(24).toString('base64url');
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
  const webviewList = () => hub.list().map(w => {
    const ch = channels.get(w.id);
    return { id: w.id, viewType: w.viewType, title: w.title, pinned: w.pinned, visible: w.visible,
      connected: !!ch?.client, ready: !!ch?.client?.ready, url: `/wv/${encodeURIComponent(w.id)}/` };
  });

  // ── 웹뷰 생김 · 없어짐 · 호스트 → 웹뷰 ─────────────────────────────
  for (const w of hub.list()) { channelFor(w.id); }
  subs.push(hub.onDidCreate.event(info => {
    channelFor(info.id);
    bus.emit('webview:created', 'host', { id: info.id, viewType: info.viewType, title: info.title, url: `/wv/${encodeURIComponent(info.id)}/` });
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
      bus.emit('host:message', 'host', { id, viewType: ch.viewType, command: typeof command === 'string' ? command : null, seq: ch.lastSeq });
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
  }

  const claude = createClaudeRoutes(host, options.claude);

  // ── HTTP ──────────────────────────────────────────────────────────
  const server = http.createServer();
  const sockets = new Set<net.Socket>();
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const port = (server.address() as net.AddressInfo).port;
  const guard: Guard = { token, port, cookieName: `stcfsd_bridge_${port}` };
  const origin = `http://127.0.0.1:${port}`;
  const frameCsp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
    + "connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

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
    designer: designerId, webviews: webviewList(), theme, ui: !!uiDir,
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
      // 토큰을 쿠키로 바꾸고 주소에서 뗀다.
      url.searchParams.delete('t');
      res.writeHead(303, { 'Set-Cookie': sessionCookie(guard), Location: `${p}${url.search}` });
      res.end();
      return;
    }
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'POST') { sendJson(res, 405, { success: false, error: 'GET · POST 만' }); return; }

    // 틀
    if (p === '/' || p === '/index.html') {
      const file = safeFile(frameDir, 'index.html');
      if (!file) { sendJson(res, 500, { success: false, error: `틀 파일이 없다: ${frameDir}` }); return; }
      sendFile(res, file, { 'Content-Security-Policy': frameCsp });
      return;
    }
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }

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

    // 웹뷰 리소스
    const resMatch = /^\/res\/([^/]+)\/(.+)$/.exec(p);
    if (resMatch) {
      const root = roots.find(r => r.name === resMatch[1]);
      const file = root ? safeFile(root.dir, resMatch[2]) : undefined;
      if (!file) { sendJson(res, 404, { success: false, error: '없다' }); return; }
      sendFile(res, file);
      return;
    }

    // 웹뷰 HTML
    const wvMatch = /^\/wv\/([^/]+)\/?$/.exec(p);
    if (wvMatch && method === 'GET') {
      const id = decodeURIComponent(wvMatch[1]);
      const html = hub.html(id);
      const info = hub.list().find(w => w.id === id);
      if (html === undefined || !info) { sendJson(res, 404, { success: false, error: `웹뷰가 없다: ${id}` }); return; }
      if (!html) { sendJson(res, 503, { success: false, error: '웹뷰 HTML 이 아직 없다' }); return; }
      const t = url.searchParams.get('theme');
      const out = injectWebviewHtml(html, { webviewId: id, viewType: info.viewType, theme: t === 'light' || t === 'dark' ? t : theme, roots });
      // meta 의 CSP 가 본 정책이다. 머리에는 meta 로 줄 수 없는 frame-ancestors 만.
      sendText(res, 200, out.html, 'text/html; charset=utf-8', { 'Content-Security-Policy': "frame-ancestors 'self'" });
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
        const client = ch.attach(new SseStream(req, res));
        client.sse.onClose.push(() => bus.emit('webview:client', 'bridge', { id, connected: false }));
        bus.emit('webview:client', 'bridge', { id, connected: true });
        return;
      }
      if (method !== 'POST') { sendJson(res, 405, { success: false, error: 'POST' }); return; }
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

  server.on('request', (req, res) => {
    handle(req, res).catch(err => {
      const status = (err as { status?: number }).status ?? 500;
      if (status === 500) { log(`[bridge] 요청 처리 예외 ${req.method} ${req.url}: ${(err as Error)?.stack ?? err}`); }
      sendJson(res, status, { success: false, error: (err as Error).message });
    });
  });

  return {
    url: `${origin}/?t=${token}`, origin, port, token,
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
      await new Promise<void>(resolve => {
        server.close(() => resolve());
        for (const s of sockets) { s.destroy(); }
      });
    },
  };
}
