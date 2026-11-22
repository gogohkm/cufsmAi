/**
 * 다리 HTTP 의 공통 — 인증, 출처 검사, 응답, 안전한 정적 파일. (StAnal `desktop/host/src/bridge/http.ts` 를 옮김)
 *
 * 인증: 무작위 세션 토큰(MCP 다리의 토큰과 따로). 첫 진입 주소의 `?t=<토큰>` 을 보면 HttpOnly ·
 * SameSite=Strict 쿠키로 바꾸고 `t` 를 뗀 주소로 돌려보낸다(303). 그 뒤의 iframe · 리소스 · EventSource ·
 * fetch 는 같은 출처라 쿠키가 따라간다 — 주소창 · 기록 · Referer 에 토큰이 남지 않는다. 시험 · Electron(S3)처럼
 * 쿠키를 쓰지 않는 곳은 `Authorization: Bearer <토큰>` 을 쓴다.
 *
 * 출처: Host 머리가 `127.0.0.1:<포트>` / `localhost:<포트>` 가 아니면 거부한다(DNS rebinding). Origin 이 있으면
 * 다리 출처여야 하고, `Sec-Fetch-Site` 가 있으면 `same-origin` · `none` 만 받는다 — 같은 PC 의 다른 포트(같은
 * "site")도 막는다. CORS 머리는 내지 않는다.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type * as http from 'node:http';
import * as path from 'node:path';

export interface Guard {
  token: string;
  port: number;
  cookieName: string;
}

export type GuardResult =
  | { ok: true; viaQuery: boolean }
  | { ok: false; status: number; error: string };

function sameToken(a: string, b: string): boolean {
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

export function checkRequest(req: http.IncomingMessage, url: URL, g: Guard): GuardResult {
  const host = String(req.headers.host ?? '').toLowerCase();
  if (host !== `127.0.0.1:${g.port}` && host !== `localhost:${g.port}`) {
    return { ok: false, status: 403, error: `Host 머리가 다리 주소가 아니다: ${host || '(없음)'}` };
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigins(g.port).includes(String(origin))) {
    return { ok: false, status: 403, error: `다른 출처의 요청: ${origin}` };
  }
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return { ok: false, status: 403, error: `다른 사이트의 요청(Sec-Fetch-Site: ${site})` };
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ') && sameToken(auth.slice(7), g.token)) {
    return { ok: true, viaQuery: false };
  }
  const c = cookieValue(req.headers.cookie, g.cookieName);
  if (c && sameToken(c, g.token)) { return { ok: true, viaQuery: false }; }
  const q = url.searchParams.get('t');
  if (q && req.method === 'GET' && sameToken(q, g.token)) { return { ok: true, viaQuery: true }; }
  return { ok: false, status: 401, error: '세션 토큰이 없다' };
}

export function sessionCookie(g: Guard): string {
  return `${g.cookieName}=${g.token}; HttpOnly; SameSite=Strict; Path=/`;
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
