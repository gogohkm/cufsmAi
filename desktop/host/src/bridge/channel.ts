/**
 * 호스트 ↔ 웹뷰 통로 하나(웹뷰 하나에 하나)와 다시 보내기 기록.
 *
 * 왜 다시 보내기가 필요한가 — VS Code 의 웹뷰는 `retainContextWhenHidden` 이라 다시 뜨지 않는다. 호스트
 * (`StcfsdPanel`)는 모델과 결과를 **메시지로 밀어 줄 뿐** 다시 보내는 길이 없다. 그리고 `webviewReady` 를 다시 받으면
 * 모델을 기본 단면으로 덮어쓴다(G2 §2.1). 그래서 다리가 웹뷰의 생애를 맡는다:
 *
 *  - 설계 패널의 `webviewReady` 는 **다리가 한 번** 호스트에 보낸다(다리가 뜰 때 — VS Code 에서 패널이 처음 뜬 때와
 *    같은 자리). 페이지가 보내는 `webviewReady` 는 호스트에 넘기지 않고 "이 페이지가 받을 준비가 됐다" 로만 쓴다.
 *  - 호스트 → 웹뷰 메시지는 순서 번호와 함께 기록에 남는다. 페이지가 준비되면(처음이든 새로 고침이든) 기록을 **줄여서**
 *    차례대로 보내고(다시 보내기), 그 뒤로는 오는 대로 보낸다.
 *
 * 줄이는 규칙(기록이 끝없이 크지 않게, 그러면서 보낸 차례는 지킨다):
 *  1. 같은 명령은 마지막 것만 남긴다 — 웹뷰의 받는 쪽(app.js)은 명령마다 그 상태를 통째로 바꾼다.
 *     남은 것들의 서로 간 차례는 원래 차례 그대로다.
 *  2. 결과를 지우는 메시지가 오면 그 앞의 지워질 결과를 뺀다 — `resultsCleared`(다른 파일을 열기 직전 — 모든 결과),
 *     `analysisInvalidated`(해석에서 나온 결과 · 설계 · Lap, `invalidateLoads` 면 하중 해석도), `derivedResultsInvalidated`(U3 —
 *     MCP analyze_loads 의 바뀐 입력: 부재 설계 · 퍼린 · Lap). 지우는 메시지 자신은 남는다
 *     (상태 글이 그대로 보이게). 빼지 않아도 끝 상태는 같지만, 다시 보낸 옛 `analysisComplete` 가 웹뷰의 자동 설계 DSM 준비를
 *     부르는 것(호스트 계산)을 막는다.
 *  3. 한 번만 뜻이 있는 것은 남기지 않는다 — `collectDesignData`(다시 보내면 저장이 돈다), `captureSection`(MCP 의 캡처 요청),
 *     `showSection`(트리 클릭의 탭 이동), `focusRequest`(AI 의 「여기를 보세요」 — 새로 고침 때 다시 따라가지 않게),
 *     `caseState` · `caseAck` · `caseDiscarded` · `restoreDesignInputs`(K2 — 호스트가 상태를 쥐고 새 페이지에 새로 보낸다).
 *  4. 웹뷰가 스스로 다시 묻는 것은 남기지 않는다 — `propertiesResult` · `propertiesError`. 웹뷰는 `modelLoaded` ·
 *     `templateGenerated` 를 그릴 때마다 단면 성질을 호스트에 다시 묻는다(app.js renderPreprocessor). 다시 보내면 그 답과 함께
 *     두 번 그려 도심 축이 겹친다(시험에서 본 것).
 *
 * 설계 탭 입력은 칠 때마다 호스트로 간다(K2 `caseEdit`) — 새로 고침은 호스트의 상태를 다시 받는다. 300 ms 안에 친 글자는
 * 수신부가 `pagehide` 에서 밀어 보낸다(inject.ts).
 */
import * as crypto from 'node:crypto';
import type { SseStream } from './sse';

/**
 * 한 번만 뜻이 있는 것(규칙 3) + `focusRequest`(AI 의 「여기를 보세요」 — 보기 계약 3절): 다시 보내기 기록에 남기면 새로 고침할 때마다
 * 화면이 다시 따라간다. 새 화면은 `host:message` 이벤트에 실린 본문으로 한 번만 받는다(index.ts).
 */
/*
 * K2(검토 상태가 호스트로 — docs/implementation/20261123-k2-design.md §4 · §9): `caseState` · `caseAck` 는 한 번만 뜻이 있다 —
 * 다시 실린 페이지는 두 번째 `caseHello` 에 호스트가 지금 상태를 새로 보낸다. 옛 판을 다시 보내면 그 판 위에서 칸을 고쳐
 * 호스트가 받지 않는다(3.2). `restoreDesignInputs` 도 남기지 않는다 — 다시 보내면 지난 파일의 입력이 지금 상태 위에 얹혔다
 * (V5b-02 의 뿌리). `caseDiscarded`(저장하지 않은 변경을 버리고 열었다)는 알림이라 한 번만 — 새 화면은 이벤트의 본문으로 받는다.
 * `caseDirty` · `caseReference` 는 마지막 것만(규칙 1).
 * K3(f08e10e): `reportResult {html}` 은 페이지가 물은 것(`generateReport`)에 대한 답이라 남기지 않는다 — 다시 실린 페이지는 다시 묻는다.
 * `validationResult {items}` 는 4b99968 부터 호스트가 쥔 결과(`results.validation`, 장부 kind 'validation')의 항목이라 결과처럼 남긴다 —
 * 호스트가 `derivedResultsInvalidated {kinds: ['validation']}` 로 지우거나 `results.validation` 이 없으면 기록에서도 지운다.
 */
const TRANSIENT = new Set(['collectDesignData', 'captureSection', 'showSection', 'propertiesResult', 'propertiesError', 'focusRequest',
  'caseState', 'caseAck', 'restoreDesignInputs', 'caseDiscarded', 'reportResult']);
/** `resultsCleared` 가 지우는 것 */
const CLEARED_BY_RESULTS = new Set([
  'analysisStarted', 'analysisComplete', 'analysisError', 'dsmResult', 'classifyResult', 'classifyError', 'designDsmPrepared',
  'designResult', 'designPurlinResult', 'loadAnalysisComplete', 'lapConnectionResult', 'connectionResult',
  'plasticResult', 'plasticError', 'vibrationResult', 'vibrationError', 'analysisInvalidated', 'propertiesResult',
]);
/**
 * `derivedResultsInvalidated`(U3 — 호스트가 MCP analyze_loads 의 바뀐 입력으로 부재 설계 · 랩 결과를 지웠다)가 지우는 것.
 * 새로 고침이 낡은 판정 카드를 되살리지 않게. 새 하중 결과(`loadAnalysisComplete`)는 이 뒤에 오므로 남는다.
 */
const CLEARED_BY_DERIVED = new Set(['designResult', 'designPurlinResult', 'lapConnectionResult']);
/**
 * V7-45: `derivedResultsInvalidated {scope}` 의 범위마다 지우는 것 — 호스트 `_invalidateDerived` 와 같은 규칙.
 * connection → 단일 접합만, lap → 랩만, load → 하중 해석 + 부재 설계 · 랩, design(그 밖 · 없음) → 부재 설계 · 랩.
 * 호스트가 지운 결과 종류(`kinds` — 결과 이름 member_design · lap …)를 함께 주면 그것을 따른다(뒤의 계약)
 */
const CLEARED_BY_SCOPE: Record<string, string[]> = {
  connection: ['connectionResult'],
  lap: ['lapConnectionResult'],
  load: ['loadAnalysisComplete', ...CLEARED_BY_DERIVED],
  design: [...CLEARED_BY_DERIVED],
};
/**
 * V7-40: 결과를 싣는 메시지 → 호스트 `results` 의 이름(get_full_state). 다시 보내기 기록은 지금 것의 근거가 아니다 —
 * 페이지가 새로 실릴 때 다리가 호스트의 `results` 를 읽어, 거기 없는(또는 지금 것이 아닌) 결과의 메시지는 보내지 않고 기록에서 지운다.
 */
export const RESULT_KIND_OF: Record<string, string> = {
  analysisComplete: 'buckling_analysis', dsmResult: 'buckling_analysis', classifyResult: 'buckling_analysis',
  designDsmPrepared: 'design_dsm', loadAnalysisComplete: 'load_analysis',
  designResult: 'member_design', designPurlinResult: 'member_design', lapConnectionResult: 'lap', connectionResult: 'connection',
  validationResult: 'validation',
};
const COMMANDS_OF_KIND: Record<string, string[]> = {};
for (const [c, k] of Object.entries(RESULT_KIND_OF)) { (COMMANDS_OF_KIND[k] ??= []).push(c); }
/** `analysisInvalidated` 가 지우는 것(웹뷰 clearStaleResults: 해석 · 설계 · Lap) */
const CLEARED_BY_INVALIDATION = new Set([
  'analysisStarted', 'analysisComplete', 'dsmResult', 'classifyResult', 'designDsmPrepared',
  'designResult', 'designPurlinResult', 'lapConnectionResult',
]);

/**
 * 처음 받은 것을 따로 남기는 명령(U1 — 새 화면이 읽는다). 설계 패널의 첫 `modelLoaded` 는 다리가 보낸 `webviewReady` 에
 * 호스트가 답한 것, 곧 프로그램이 시작할 때 채운 기본 단면이다. 새 화면은 지금 모델이 그것과 같은지로 「기본값」 꼬리표를 단다.
 */
const FIRST_KEPT = new Set(['modelLoaded']);

export interface ChannelClient {
  conn: string;
  sse: SseStream;
  /** 다시 보내기를 마치고 오는 대로 받는다 */
  ready: boolean;
}

interface Entry { seq: number; command: string; text: string }

export class Channel {
  client?: ChannelClient;
  private seq = 0;
  /** 명령 → 마지막 메시지(규칙 1 · 2 를 지킨 것) */
  private readonly state = new Map<string, Entry>();
  /** FIRST_KEPT 명령의 첫 메시지 */
  private readonly first = new Map<string, Entry>();
  /**
   * 붙었지만 아직 다시 보내기를 마치지 않은 페이지에 갈 한 번만 뜻이 있는 메시지 — 다시 보내기 뒤에 그 페이지에만 보낸다.
   * (새로 실린 페이지의 caseHello 에 호스트가 곧바로 답한 caseState 가 다시 보내기보다 먼저 와도 잃지 않게. 다음 페이지에는 가지 않는다)
   */
  private queued: Entry[] = [];
  /** 받은 메시지 수 · 다시 보낸 수(진단용) */
  posted = 0;
  replays = 0;

  constructor(
    readonly id: string,
    readonly viewType: string,
    /** 이 명령을 페이지가 보내면 준비된 것. 없으면 붙자마자 준비(좌굴 보고서 패널) */
    readonly readyCommand: string | undefined,
  ) {}

  /** 호스트 → 웹뷰 한 건. 준비된 페이지가 있으면 곧바로 보낸다. */
  push(message: unknown): void {
    this.posted += 1;
    this.seq += 1;
    const m = (message ?? {}) as { command?: unknown; data?: { invalidateLoads?: unknown } };
    const command = typeof m.command === 'string' ? m.command : '(command 없음)';
    let text: string;
    try { text = JSON.stringify(message); } catch { return; }
    if (FIRST_KEPT.has(command) && !this.first.has(command)) { this.first.set(command, { seq: this.seq, command, text }); }
    if (!TRANSIENT.has(command)) {
      if (command === 'resultsCleared') {
        for (const c of CLEARED_BY_RESULTS) { this.state.delete(c); }
      } else if (command === 'derivedResultsInvalidated') {
        const d = (message as { data?: { scope?: unknown; kinds?: unknown } }).data ?? {};
        const kinds = Array.isArray(d.kinds) ? d.kinds.map(String) : null;
        const list = kinds ? kinds.flatMap(k => COMMANDS_OF_KIND[k] ?? []) : CLEARED_BY_SCOPE[String(d.scope ?? 'design')] ?? CLEARED_BY_SCOPE.design;
        for (const c of list) { this.state.delete(c); }
      } else if (command === 'resultsLedger') {
        // V7-40: 호스트의 장부 메시지가 지금 결과(results — 없는 것은 null)를 싣는다 — 거기 없는 결과의 메시지는 기록에서 지운다
        const res = (message as { data?: { results?: Record<string, any> | null } }).data?.results;
        if (res && typeof res === 'object') {
          for (const c of Object.keys(RESULT_KIND_OF)) {
            const k = RESULT_KIND_OF[c];
            if (k in res && (!res[k] || (k === 'buckling_analysis' && res[k].current === false))) { this.state.delete(c); }
          }
        }
      } else if (command === 'analysisInvalidated') {
        for (const c of CLEARED_BY_INVALIDATION) { this.state.delete(c); }
        if (m.data?.invalidateLoads) { this.state.delete('loadAnalysisComplete'); }
      }
      this.state.delete(command);
      this.state.set(command, { seq: this.seq, command, text });
    }
    if (this.client?.ready) { this.client.sse.send(text, undefined, this.seq); }
    else if (this.client && TRANSIENT.has(command)) { this.queued.push({ seq: this.seq, command, text }); }
  }

  /** 새 페이지가 붙었다. 앞의 연결은 멈추게 한다(웹뷰 하나에 페이지 하나 — 새로 붙는 쪽이 이긴다). */
  attach(sse: SseStream): ChannelClient {
    if (this.client) {
      this.client.sse.send(JSON.stringify({ reason: '다른 페이지가 이 웹뷰를 가져갔다' }), 'superseded');
      this.client.sse.close();
    }
    this.queued = [];
    const client: ChannelClient = { conn: crypto.randomBytes(9).toString('base64url'), sse, ready: false };
    this.client = client;
    sse.onClose.push(() => { if (this.client === client) { this.client = undefined; } });
    sse.send(JSON.stringify({ conn: client.conn, webview: this.id, viewType: this.viewType }), 'hello');
    if (!this.readyCommand) { this.replayTo(client); }
    return client;
  }

  /**
   * 기록을 차례대로 보내고 준비 상태로 둔다. current(V7-40) = 호스트가 지금 쥔 결과의 이름(get_full_state.results 중 지금 것) —
   * 주면 거기 없는 결과의 메시지는 보내지 않고 기록에서도 지운다(null = 호스트를 읽지 못함 → 결과 메시지를 모두 뺀다: 기록을 믿지 않는다)
   */
  replayTo(client: ChannelClient, current?: Set<string> | null): number {
    if (client.ready) { return 0; }
    const dropped: string[] = [];
    if (current !== undefined) {
      for (const [c, e] of [...this.state.entries()]) {
        const kind = RESULT_KIND_OF[c];
        if (kind && (current === null || !current.has(kind))) { this.state.delete(c); dropped.push(e.command); }
      }
    }
    const entries = [...this.state.values()].sort((a, b) => a.seq - b.seq);
    for (const e of entries) { client.sse.send(e.text, undefined, e.seq); }
    client.sse.send(JSON.stringify({ count: entries.length, commands: entries.map(e => e.command), dropped }), 'replayed');
    client.ready = true;
    if (this.client === client) { for (const q of this.queued) { client.sse.send(q.text, undefined, q.seq); } }
    this.queued = [];
    this.replays += 1;
    return entries.length;
  }

  /** 마지막 순서 번호(받은 메시지 수와 같다) */
  get lastSeq(): number { return this.seq; }

  /**
   * 다시 보내기 기록에 남은 그 명령의 마지막 메시지 — 새 화면(U1)이 읽는다. 페이지가 새로 고침하면 받을 것과 같다:
   * 결과를 지우는 메시지가 지운 결과는 없다(null). 한 번만 뜻이 있는 명령은 남지 않으므로 늘 null 이다.
   */
  last(command: string): { seq: number; message: unknown } | null {
    const e = this.state.get(command);
    return e ? { seq: e.seq, message: JSON.parse(e.text) } : null;
  }

  /** FIRST_KEPT 명령의 첫 메시지 */
  firstOf(command: string): { seq: number; message: unknown } | null {
    const e = this.first.get(command);
    return e ? { seq: e.seq, message: JSON.parse(e.text) } : null;
  }

  /** 다시 보낼 명령(차례대로) — 시험 · 진단용 */
  replayCommands(): string[] {
    return [...this.state.values()].sort((a, b) => a.seq - b.seq).map(e => e.command);
  }

  close(reason: string): void {
    if (this.client) {
      this.client.sse.send(JSON.stringify({ reason }), 'superseded');
      this.client.sse.close();
      this.client = undefined;
    }
  }
}
