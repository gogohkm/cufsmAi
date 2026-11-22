/**
 * 화면 다리 클라이언트 — desktop/host/BRIDGE.md 의 경로만 쓴다. 같은 출처 쿠키(브라우저) · Bearer(Electron 세션)로 인증된다.
 *
 *  - `mcp(action, params)`  = `POST /api/mcp/action` — AI 가 부르는 도구와 같은 호스트 경로(엔진 · US 단위). 화면의 조회는
 *    AI 호출로 세지 않는다(다리가 요청 id 머리를 붙이지 않는다).
 *  - `mcpStatus()`          = `GET /api/mcp/status` — MCP get_status 와 같은 것.
 *  - `last(id, commands)`   = `GET /api/wv/<id>/last` — 호스트가 설계 패널에 보낸 메시지 가운데 지금 유효한 마지막 것.
 *  - `connectEvents()`      = `EventSource('/api/events')` — 호스트의 물음 · 알림 · `host:message` · `file:current` …
 */

export interface ApiResult<T = any> { success: boolean; data?: T; error?: string; status: number; seq?: number }

export async function api<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch (err) {
    return { success: false, error: `다리에 닿지 않는다: ${String(err)}`, status: 0 };
  }
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return { ...j, success: !!j?.success, status: res.status };
  } catch {
    return { success: false, error: text.slice(0, 300), status: res.status };
  }
}

/** 호스트 MCP 다리의 `/action` 응답 그대로(엔진 결과 · US). 다리 · 엔진 오류는 `{ error }` */
export async function mcp<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T & { error?: string }> {
  let res: Response;
  try {
    res = await fetch('/api/mcp/action', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    });
  } catch (err) {
    return { error: `다리에 닿지 않는다: ${String(err)}` } as T & { error?: string };
  }
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 300) } as T & { error?: string }; }
}

export async function mcpStatus<T = any>(): Promise<T & { error?: string }> {
  try {
    const res = await fetch('/api/mcp/status', { credentials: 'same-origin' });
    return await res.json();
  } catch (err) {
    return { error: String(err) } as T & { error?: string };
  }
}

export interface LastEntry<T = any> { seq: number; message: { command: string; data: T } }

export async function last(webviewId: string, commands: string[], which: 'last' | 'first' = 'last'): Promise<{ data: Record<string, LastEntry | null>; seq: number } | null> {
  const q = commands.map(c => `command=${encodeURIComponent(c)}`).join('&');
  const r = await api<Record<string, LastEntry | null>>('GET', `/api/wv/${encodeURIComponent(webviewId)}/${which}?${q}`);
  return r.success && r.data ? { data: r.data, seq: r.seq ?? 0 } : null;
}

export interface BridgeEvent { seq: number; at: number; type: string; source: string; data: any }

export function connectEvents(onHello: (h: { lastSeq: number; state: any }) => void, onEvent: (e: BridgeEvent) => void): EventSource {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', e => {
    try { onHello(JSON.parse((e as MessageEvent).data)); } catch { /* 무시 */ }
  });
  es.onmessage = e => {
    let ev: BridgeEvent;
    try { ev = JSON.parse(e.data); } catch { return; }
    onEvent(ev);
  };
  return es;
}
