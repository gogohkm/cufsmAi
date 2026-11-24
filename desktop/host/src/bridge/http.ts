/**
 * 다리 HTTP 의 공통 — 인증, 출처 검사, 응답, 안전한 정적 파일. (StAnal `desktop/host/src/bridge/http.ts` 를 옮김)
 *
 * 다리는 두 곳에서 듣는다(V5-04 · V5-18): 틀 서버(`/`, `/ui/`, `/api/*`)와 웹뷰 서버(`/wv/`, `/res/`, `/api/wv/<id>/out|in`).
 * 포트가 다르면 출처가 다르다 — 끼운 웹뷰는 틀의 문서 · 저장소 · 스크립트에 닿지 못한다(VS Code 의 웹뷰도 다른 출처다).
 *
 * 인증(읽기): 무작위 세션 토큰(MCP 다리의 토큰과 따로) — `Authorization: Bearer <토큰>`(Electron · 시험 · CLI). 브라우저는 첫 진입
 * 주소의 `?t=<토큰>` 을 쿠키로 바꾼다. **쿠키 값은 토큰이 아니다**(따로 만든 무작위 값): 쿠키는 포트를 가리지 않아 127.0.0.1 의
 * 다른 포트로도 가므로, 그것을 받은 곳이 `?t=` 를 다시 할 수 없게. 쿠키는 HttpOnly · SameSite=Strict.
 *
 * 쓰기(틀 서버의 GET 아닌 모든 요청과 `/api/wv-key`): 읽기 인증에 더해 `X-StCFSD-Key: <쓰기 열쇠>`. 쓰기 열쇠는 주소 · 쿠키 · 웹뷰에
 * 나오지 않는다 — 브라우저는 `?t=` 교환 응답의 본문이 그 탭의 sessionStorage(틀 출처)에 넣고, Electron 은 주 프로세스가 맨 위
 * 프레임의 요청에만 머리로 붙인다(페이지는 모른다). 웹뷰 서버의 쓰기(`POST /api/wv/<id>/in`)와 `out` 은 웹뷰 열쇠
 * (`X-StCFSD-Webview-Key` · `?k=`)가 있어야 한다 — 틀이 쓰기 열쇠로 받아 postMessage 로 자기 iframe 에만 건넨다.
 *
 * 출처: Host 머리가 그 서버의 `127.0.0.1:<포트>` / `localhost:<포트>` 가 아니면 거부한다(DNS rebinding). Origin 이 있으면
 * 그 서버의 출처여야 하고, `Sec-Fetch-Site` 가 있으면 `same-origin` · `none` 만 받는다 — 같은 PC 의 다른 포트(같은
 * "site")도 막는다. 예외 하나: 웹뷰 서버의 웹뷰 문서(`GET /wv/<id>/`)를 틀이 iframe 으로 싣는 것(`same-site` + `Sec-Fetch-Dest: iframe`) —
 * 그 응답은 `frame-ancestors <틀 출처>` 라 다른 곳에 끼워지지 않는다. CORS 머리는 내지 않는다.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type * as http from 'node:http';
import * as path from 'node:path';

export interface Guard {
  /** Bearer 토큰(그리고 틀 서버의 `?t=` 교환) */
  token: string;
  /** 브라우저 세션 쿠키의 값 — 토큰과 다른 무작위 값 */
  cookie: string;
  /** 이 서버의 포트 */
  port: number;
  cookieName: string;
  /** `?t=` 교환을 받는가(틀 서버만) */
  bootstrap?: boolean;
}

export const WRITE_HEADER = 'x-stcfsd-key';
export const WEBVIEW_KEY_HEADER = 'x-stcfsd-webview-key';

export type GuardResult =
  | { ok: true; viaQuery: boolean }
  | { ok: false; status: number; error: string };

export function sameToken(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) { return undefined; }
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { return part.slice(i + 1).trim(); }
  }
  return undefined;
}

export function allowedOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

export function checkRequest(req: http.IncomingMessage, url: URL, g: Guard, opt: { frameNavigation?: boolean } = {}): GuardResult {
  const host = String(req.headers.host ?? '').toLowerCase();
  if (host !== `127.0.0.1:${g.port}` && host !== `localhost:${g.port}`) {
    return { ok: false, status: 403, error: `Host 머리가 다리 주소가 아니다: ${host || '(없음)'}` };
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigins(g.port).includes(String(origin))) {
    return { ok: false, status: 403, error: `다른 출처의 요청: ${origin}` };
  }
  const site = req.headers['sec-fetch-site'];
  const frameNav = !!opt.frameNavigation && site === 'same-site' && req.method === 'GET'
    && (req.headers['sec-fetch-dest'] === 'iframe' || req.headers['sec-fetch-dest'] === 'frame') && origin === undefined;
  if (site !== undefined && site !== 'same-origin' && site !== 'none' && !frameNav) {
    return { ok: false, status: 403, error: `다른 사이트의 요청(Sec-Fetch-Site: ${site})` };
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ') && sameToken(auth.slice(7), g.token)) {
    return { ok: true, viaQuery: false };
  }
  const c = cookieValue(req.headers.cookie, g.cookieName);
  if (c && sameToken(c, g.cookie)) { return { ok: true, viaQuery: false }; }
  const q = url.searchParams.get('t');
  if (g.bootstrap && q && req.method === 'GET' && sameToken(q, g.token)) { return { ok: true, viaQuery: true }; }
  return { ok: false, status: 401, error: '세션 토큰이 없다' };
}

export function sessionCookie(g: Guard): string {
  return `${g.cookieName}=${g.cookie}; HttpOnly; SameSite=Strict; Path=/`;
}

/** 머리의 열쇠가 맞는가(`X-StCFSD-Key` · `X-StCFSD-Webview-Key`) */
export function hasKey(req: http.IncomingMessage, header: string, key: string): boolean {
  const v = req.headers[header];
  return typeof v === 'string' && v.length > 0 && sameToken(v, key);
}

/**
 * `?t=` 교환 뒤 돌아갈 자리 — 늘 이 출처 안의 정해진 화면(`/` 또는 `/ui/`)이다. 요청 경로를 그대로 쓰지 않는다
 * (V5-10: `/.//evil.example/x` 는 정리하면 `//evil.example/x` — 그대로 Location 에 넣으면 다른 곳으로 간다).
 */
export function bootstrapTarget(pathname: string, search: URLSearchParams, ui: boolean): string {
  const base = ui && (pathname === '/ui' || pathname.startsWith('/ui/')) ? '/ui/' : '/';
  const theme = search.get('theme');
  return theme === 'light' || theme === 'dark' ? `${base}?theme=${theme}` : base;
}

/** 모든 응답에 거는 머리 */
export function baseHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) { try { res.end(); } catch { /* 끊김 */ } return; }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

export function sendText(res: http.ServerResponse, status: number, text: string, type = 'text/plain; charset=utf-8',
  extra: Record<string, string> = {}): void {
  if (res.headersSent) { try { res.end(); } catch { /* 끊김 */ } return; }
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text), ...extra });
  res.end(text);
}

export async function readBody(req: http.IncomingMessage, limit = 64 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) { throw Object.assign(new Error(`본문이 너무 크다(> ${limit} bytes)`), { status: 413 }); }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '');
  if (!/^application\/json\b/i.test(type)) { throw Object.assign(new Error('Content-Type: application/json 이어야 한다'), { status: 415 }); }
  const buf = await readBody(req);
  if (buf.length === 0) { return {}; }
  try { return JSON.parse(buf.toString('utf8')); } catch { throw Object.assign(new Error('JSON 이 아니다'), { status: 400 }); }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

export function contentTypeOf(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * URL 경로의 나머지(`a/b/c.js`, 퍼센트 인코딩 그대로)를 뿌리 안의 실제 파일로.
 * `..` · 빈 마디 · 역슬래시 · NUL · 드라이브 문자 · 심볼릭 링크로 뿌리 밖을 가리키면 undefined.
 */
export function safeFile(rootDir: string, rawRest: string): string | undefined {
  if (!rawRest) { return undefined; }
  const segs: string[] = [];
  for (const raw of rawRest.split('/')) {
    let s: string;
    try { s = decodeURIComponent(raw); } catch { return undefined; }
    if (s === '' || s === '.' || s === '..' || /[\\/\0:]/.test(s)) { return undefined; }
    segs.push(s);
  }
  const root = path.resolve(rootDir);
  const target = path.resolve(root, ...segs);
  if (!target.startsWith(root + path.sep)) { return undefined; }
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(target);
    if (!real.startsWith(realRoot + path.sep)) { return undefined; }
    if (!fs.statSync(real).isFile()) { return undefined; }
    return real;
  } catch {
    return undefined;
  }
}

export function sendFile(res: http.ServerResponse, file: string, extraHeaders: Record<string, string> = {}): void {
  const stat = fs.statSync(file);
  res.writeHead(200, { 'Content-Type': contentTypeOf(file), 'Content-Length': stat.size, ...extraHeaders });
  fs.createReadStream(file).pipe(res);
}
