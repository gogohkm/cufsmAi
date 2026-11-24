/** SSE(Server-Sent Events) 한 연결과 순서 번호가 붙는 이벤트 흐름. (StAnal `sse.ts` 를 옮김) */
import type * as http from 'node:http';

export class SseStream {
  private closed = false;
  private readonly timer: NodeJS.Timeout;
  readonly onClose: Array<() => void> = [];

  constructor(private readonly req: http.IncomingMessage, private readonly res: http.ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1000\n\n');
    // 놀고 있는 연결을 끊지 않게 15초마다 주석 한 줄.
    this.timer = setInterval(() => this.write(': ping\n\n'), 15_000);
    this.timer.unref();
    const done = () => this.finish();
    req.on('close', done);
    res.on('close', done);
    res.on('error', done);
  }

  get isClosed(): boolean { return this.closed; }

  private write(chunk: string): void {
    if (this.closed) { return; }
    try { this.res.write(chunk); } catch { this.finish(); }
  }

  /** `data` 는 이미 JSON 문자열이다(줄바꿈 없음 — JSON.stringify 는 줄바꿈을 \n 으로 쓴다). */
  send(data: string, event?: string, id?: number): void {
    let out = '';
    if (id !== undefined) { out += `id: ${id}\n`; }
    if (event) { out += `event: ${event}\n`; }
    out += `data: ${data}\n\n`;
    this.write(out);
  }

  close(): void {
    if (this.closed) { return; }
    try { this.res.end(); } catch { /* 이미 끊김 */ }
    this.finish();
  }

  private finish(): void {
    if (this.closed) { return; }
    this.closed = true;
    clearInterval(this.timer);
    for (const f of this.onClose.splice(0)) { try { f(); } catch { /* 계속 */ } }
  }
}

export type EventOrigin = 'host' | 'webview' | 'platform' | 'bridge';

export interface BridgeEvent {
  seq: number;
  at: number;
  type: string;
  source: EventOrigin;
  data: unknown;
}

/** 틀(`/`)이 받는 이벤트 흐름. 최근 것은 고리 버퍼에 두어 다시 붙으면 `Last-Event-ID` 뒤부터 다시 보낸다. */
export class EventBus {
  private seq = 0;
  private readonly ring: Array<{ ev: BridgeEvent; text: string }> = [];
  private readonly clients = new Set<SseStream>();
  private readonly listeners = new Set<(ev: BridgeEvent) => void>();
  /** 붙은 화면 수가 바뀌었다 */
  onClientsChanged: (count: number) => void = () => {};

  constructor(private readonly ringSize = 500) {}

  get lastSeq(): number { return this.seq; }
  get clientCount(): number { return this.clients.size; }

  /** 같은 프로세스에서 이벤트를 듣는다(S3 의 Electron 껍데기 · 시험). 돌려받은 함수 = 그만 듣기 */
  on(listener: (ev: BridgeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(type: string, source: EventOrigin, data: unknown): BridgeEvent {
    this.seq += 1;
    const ev: BridgeEvent = { seq: this.seq, at: Date.now(), type, source, data };
    const text = JSON.stringify(ev);
    this.ring.push({ ev, text });
    if (this.ring.length > this.ringSize) { this.ring.shift(); }
    for (const c of this.clients) { c.send(text, undefined, ev.seq); }
    for (const fn of [...this.listeners]) {
      try { fn(ev); } catch (err) { process.stderr.write(`[bridge] 이벤트 구독자 오류(${type}): ${String(err)}\n`); }
    }
    return ev;
  }

  /** 최근 이벤트(시험 · 진단용) */
  recent(): BridgeEvent[] { return this.ring.map(r => r.ev); }

  attach(req: http.IncomingMessage, res: http.ServerResponse, since: number | undefined, hello: unknown): SseStream {
    const s = new SseStream(req, res);
    s.send(JSON.stringify({ lastSeq: this.seq, ...(hello as object) }), 'hello');
    if (since !== undefined && Number.isFinite(since)) {
      for (const r of this.ring) { if (r.ev.seq > since) { s.send(r.text, undefined, r.ev.seq); } }
    }
    this.clients.add(s);
    this.onClientsChanged(this.clients.size);
    s.onClose.push(() => { this.clients.delete(s); this.onClientsChanged(this.clients.size); });
    return s;
  }

  closeAll(): void {
    for (const c of [...this.clients]) { c.close(); }
    this.listeners.clear();
  }
}
