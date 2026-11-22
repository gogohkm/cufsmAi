/**
 * Claude Desktop 연결(S4) — 제목 표시줄의 「연결」 상자가 쓰는 세 경로의 몸통.
 *
 *   GET  /api/claude/status       상태(읽기만)
 *   POST /api/claude/connect      `mcpServers.stcfsd` 를 이 설치본의 항목으로 더하거나 고친다
 *   POST /api/claude/disconnect   이 설치본의 항목과 **같은** `mcpServers.stcfsd` 만 지운다
 *
 * 쓰기는 K1 의 도우미(`out/mcp/claudeDesktop.js` — `connectClaudeDesktop` · `disconnectClaudeDesktop`)가 한다:
 * Claude 가 설치돼 있지 않으면(설정 폴더 없음) 만들지 않는다, 깨진 JSON 은 손대지 않는다, 쓰기 전에
 * `<파일>.stcfsd-backup-<시각>` 백업, 임시 파일 + 이름 바꾸기, 다시 읽어 우리 항목 = 기대값 · 다른 항목 = 전과 같음을 확인.
 *
 * 이 등록 · 지우기를 하는 길은 화면 다리의 이 두 POST 뿐이다 — 읽기 인증에 더해 화면의 쓰기 열쇠(`X-StCFSD-Key`)가 있어야 한다
 * (쿠키만으로는 안 된다 — V5-04, 끼운 웹뷰는 다른 출처라 닿지 않는다 — V5-18). AI 는 호스트의 MCP 다리에 붙고, 그 다리에는 이 경로가 없다.
 * 다만 AI 의 도구가 파일을 쓰는 길은 따로 있다: `save_project` 는 모델 파일을 쓴다. V5-01(51e617f, 공용 코드)부터 그것은 이미 있는 파일을
 * 덮어쓰지 않는다 — 자기가 쓴 StCFSD 모델 파일이 아니면 거절한다. 그래서 「AI 가 Claude 설정 파일을 바꿀 수 없다」 는 지금 이렇게 참이다:
 * 등록 경로는 MCP 쪽에 없고, `save_project` 로 Claude 설정 파일을 겨누면 거절되어 파일이 바이트까지 그대로다(`test/connect.mjs` 가 중계로 시험한다).
 * 시험은 `configPath`(임시 폴더의 가짜 설정)를 준다 — 진짜 Claude 설정에 닿지 않는다.
 *
 * 넣는 항목(`entry`): 껍데기(S3)가 `standaloneMcpEntry({ command: <이 프로그램의 실행 파일>, serverScript: <이 설치본의
 * media/mcp-server.js>, portFile: <표준 포트 파일> })` 로 만들어 준다. 주지 않으면 호스트의 항목(개발판 — node 로 띄움).
 *
 * 응답에는 설정 파일 안의 항목 전문(다른 서버의 env 등)을 싣지 않는다. 화면이 쓸 일이 없다.
 */
import * as http from 'node:http';
import * as path from 'node:path';
import type { HostHandle } from '../loader';

export interface BridgeClaudeOptions {
  /** Claude Desktop 설정 파일을 직접 준다(시험 — 임시 폴더의 가짜). 없으면 이 PC 의 후보에서 고른다 */
  configPath?: string;
  /** false 면 등록 상태를 보지 않는다(설정 파일을 읽지 않는다) */
  checkRegistration?: boolean;
  /** 「연결」이 넣을 항목. 없으면 `host.mcp.entry` */
  entry?: unknown;
  /** false 면 「연결」 · 「끊기」를 막는다(읽기만) */
  allowWrite?: boolean;
}

export type ClaudeUiState = 'connected' | 'registered' | 'restart-needed' | 'not-registered' | 'registered-elsewhere'
  | 'not-installed' | 'invalid-config' | 'unknown';

export interface ClaudeStatus {
  /** checkClaudeDesktop 의 상태 그대로 */
  state: string;
  /** 제목 표시줄이 쓰는 상태(마지막 호출 · 다시 시작 대기를 합친 것) */
  ui: ClaudeUiState;
  configPath?: string;
  configKind?: string;
  configExists?: boolean;
  configError?: string;
  otherServers?: number;
  lastAiCall: { at: string; client: string; method: string; endpoint: string; action?: string } | null;
  aiCalls: number;
  canConnect: boolean;
  canDisconnect: boolean;
  /** 「연결」 뒤 Claude Desktop 을 아직 다시 시작하지 않았다(그 뒤 호출이 없다) */
  restartNeeded: boolean;
  /** 제목 표시줄의 한 줄 */
  text: string;
  /** 풍선 도움말 */
  tooltip: string;
}

export interface ClaudeActionResult {
  ok: boolean;
  action?: string;
  reason?: string;
  error?: string;
  wrote?: boolean;
  backupPath?: string;
  restartRequired?: boolean;
  /** 사용자에게 보일 한 줄 */
  message: string;
}

interface Helpers {
  checkClaudeDesktop(o: { entry: unknown; configPath?: string }): {
    state: string; configPath: string; configKind: string; configExists: boolean; configError?: string; others: string[];
  };
  connectClaudeDesktop(o: { entry: unknown; configPath?: string }): Record<string, unknown>;
  disconnectClaudeDesktop(o: { entry: unknown; configPath?: string }): Record<string, unknown>;
}

function getJson(port: number, token: string, route: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'GET', path: route,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', Connection: 'close' } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', c => { text += c; });
      res.on('end', () => { try { resolve(JSON.parse(text)); } catch { reject(new Error(`JSON 이 아니다: ${text.slice(0, 120)}`)); } });
    });
    r.setTimeout(5_000, () => r.destroy(new Error('시간 초과')));
    r.on('error', reject);
    r.end();
  });
}

/**
 * `invalid-config` 의 까닭을 사람 말로(K1 의 `error` · `configError` 영어 문구에서). 같은 키가 두 번 있는 설정도 이 이유다 —
 * 「올바른 JSON 이 아니다」 로 적으면 틀리므로 까닭마다 따로.
 */
export function invalidConfigText(error: string | undefined): string {
  const e = String(error ?? '');
  // f8fe4ab · 제자리 쓰기(하드 링크 설정)가 중간에 끊겨 설정이 비었거나 깨졌다 — 되돌릴 백업을 이름으로 알린다
  const cut = /an in-place write by StCFSD was cut short[^(]*\(backup: ([^)]*)\)/.exec(e) ?? /in-place write by StCFSD was cut short; the previous content is in (.+?)\)?$/.exec(e);
  if (cut) {
    const marker = /delete (\S+\.stcfsd-tmp-inplace)/.exec(e)?.[1];
    return `Claude Desktop 설정 파일이 ${/is empty/.test(e) ? '비어 있습니다' : '깨져 있습니다'} — StCFSD 가 그 자리에 쓰다가 중간에 끊겼습니다. `
      + `백업 ${cut[1]} 을(를) 설정 파일 위에 복사하고${marker ? ` 표시 파일 ${marker} 를 지운 뒤` : ''} 다시 누르세요. 그때까지`;
  }
  const deep = /nested (\d+) levels deep/.exec(e);
  if (deep) { return `Claude Desktop 설정 파일이 너무 깊게 겹쳐 있어(${deep[1]} 단계), 다시 쓰다 멈출 수 있으므로`; }
  if (/cannot rewrite this config/.test(e)) { return 'Claude Desktop 설정 파일을 다시 쓸 수 없는 모양이어서'; }
  const dup = /the key "([^"]*)" appears more than once/.exec(e);
  if (dup) { return `Claude Desktop 설정 파일에 같은 이름("${dup[1]}")이 두 번 있어, 다시 쓰면 하나가 사라지므로`; }
  if (/mcpServers is not a JSON object/.test(e)) { return 'Claude Desktop 설정 파일의 mcpServers 가 객체가 아니어서'; }
  if (/root is not a JSON object/.test(e)) { return 'Claude Desktop 설정 파일의 맨 위가 객체가 아니어서'; }
  if (/not valid JSON/.test(e)) { return 'Claude Desktop 설정 파일이 올바른 JSON 이 아니어서'; }
  return 'Claude Desktop 설정 파일을 읽을 수 없어서';
}

/**
 * 쓰기 실패의 사람 말(f8fe4ab). 제자리 쓰기가 실패하고 원래대로 되돌리지 **못했으면** 사용자가 백업을 복사해야 한다 — 그 경로를 앞에 둔다.
 */
export function writeFailedText(error: string, backupPath?: string): string {
  const notBack = /could NOT be put back; copy the backup (\S*) over it/.exec(error);
  if (notBack) {
    return `설정 파일을 쓰지 못했고 원래대로 되돌리지도 못했습니다. 백업 ${notBack[1] || backupPath || ''} 을(를) 설정 파일 위에 복사해 주세요(Claude Desktop 을 끈 채).`;
  }
  if (/was put back as it was/.test(error)) { return `설정 파일을 쓰지 못했습니다 — 원래대로 되돌렸습니다(바뀐 것 없음). ${error.replace(/ — the config was put back as it was/, '')}`; }
  return `설정 파일을 쓰지 못했습니다(${error}).${backupPath ? ` 백업: ${backupPath}` : ''}`;
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export interface ClaudeRoutes {
  status(): Promise<ClaudeStatus>;
  connect(): Promise<{ result: ClaudeActionResult; status: ClaudeStatus }>;
  disconnect(): Promise<{ result: ClaudeActionResult; status: ClaudeStatus }>;
}

export function createClaudeRoutes(host: HostHandle, o: BridgeClaudeOptions = {}): ClaudeRoutes {
  let mod: Helpers | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require(path.join(host.context.extensionPath as string, 'out', 'mcp', 'claudeDesktop.js')) as Helpers;
  } catch { mod = undefined; }
  const entry = o.entry ?? host.mcp.entry;
  const writable = o.allowWrite !== false;
  /** 「연결」로 쓴 때(이 뒤에 AI 호출이 없으면 Claude Desktop 이 아직 새 설정을 읽지 않은 것) */
  let connectedAt: number | undefined;

  const status = async (): Promise<ClaudeStatus> => {
    let reg: Pick<ClaudeStatus, 'state' | 'configPath' | 'configKind' | 'configExists' | 'configError' | 'otherServers'> = { state: 'unknown' };
    if (o.checkRegistration !== false && mod && entry) {
      try {
        const s = mod.checkClaudeDesktop({ entry, configPath: o.configPath });
        reg = { state: s.state, configPath: s.configPath, configKind: s.configKind, configExists: s.configExists,
          configError: s.configError, otherServers: s.others.length };
      } catch (err) { reg = { state: 'unknown', configError: String((err as Error).message ?? err) }; }
    }
    let lastAiCall: ClaudeStatus['lastAiCall'] = null;
    let aiCalls = 0;
    try {
      const lc = await getJson(host.mcp.port, host.mcp.token, '/last-call');
      lastAiCall = lc?.lastAiCall ?? null;
      aiCalls = Number(lc?.aiCalls) || 0;
    } catch { /* 다리가 없으면 호출도 없다 */ }
    const calledAfterConnect = !!lastAiCall && (!connectedAt || Date.parse(lastAiCall.at) >= connectedAt);
    if (calledAfterConnect) { connectedAt = undefined; }
    const restartNeeded = reg.state === 'registered' && connectedAt !== undefined;
    // 「연결됨」은 등록돼 있고 그 뒤 AI 가 부른 때만이다. 「끊기」 뒤에도 Claude Desktop 은 다시 시작할 때까지 옛 설정으로
    // 부를 수 있다 — 그때는 등록 상태를 보이고 마지막 호출은 풍선 도움말에 둔다(단추와 글이 어긋나지 않게).
    const regUi: ClaudeUiState = ['not-registered', 'registered-elsewhere', 'not-installed', 'invalid-config'].includes(reg.state)
      ? reg.state as ClaudeUiState : 'unknown';
    const ui: ClaudeUiState = reg.state === 'registered' ? (calledAfterConnect ? 'connected' : restartNeeded ? 'restart-needed' : 'registered')
      : (reg.state === 'unknown' && calledAfterConnect ? 'connected' : regUi);
    const text: Record<ClaudeUiState, string> = {
      'connected': `Claude 연결됨 · 마지막 호출 ${lastAiCall ? `${hhmm(lastAiCall.at)} · ${lastAiCall.client}` : ''}`,
      'registered': 'Claude 등록됨 · 아직 호출 없음',
      'restart-needed': 'Claude 등록됨 · Claude Desktop 다시 시작 필요',
      'not-registered': 'Claude 등록 안 됨',
      'registered-elsewhere': 'Claude 다른 설치를 가리킴',
      'not-installed': 'Claude Desktop 없음',
      'invalid-config': 'Claude 설정 파일을 읽을 수 없음',
      'unknown': 'Claude 연결 확인 안 됨',
    };
    const tip: Record<ClaudeUiState, string> = {
      'connected': 'Claude Desktop 이 이 프로그램을 부르고 있습니다',
      'registered': 'Claude Desktop 설정에 이 프로그램이 등록돼 있습니다. Claude 가 아직 부르지 않았습니다',
      'restart-needed': '등록했습니다. Claude Desktop 을 한 번 다시 시작하면 연결됩니다',
      'not-registered': '「연결」을 누르면 Claude Desktop 설정에 이 프로그램을 등록합니다(다른 항목은 그대로)',
      'registered-elsewhere': 'Claude Desktop 설정의 StCFSD 항목이 다른 위치의 프로그램을 가리킵니다. 「연결」을 누르면 이 프로그램으로 고칩니다',
      'not-installed': '이 사용자 계정에서 Claude Desktop 을 찾지 못했습니다. Claude Desktop 을 설치하고 한 번 실행한 뒤 다시 보세요',
      'invalid-config': `${invalidConfigText(reg.configError)} 손대지 않습니다`,
      'unknown': '연결 상태를 확인하지 못했습니다',
    };
    const where = reg.configPath ? `\n설정: ${reg.configPath}` : '';
    return {
      ...reg, ui, lastAiCall, aiCalls, restartNeeded,
      canConnect: writable && !!mod && (reg.state === 'not-registered' || reg.state === 'registered-elsewhere'),
      canDisconnect: writable && !!mod && reg.state === 'registered',
      text: text[ui],
      tooltip: `${tip[ui]}${reg.configError ? `\n(${reg.configError})` : ''}${where}${aiCalls ? `\nAI 호출 ${aiCalls}번${lastAiCall ? ` · 마지막 ${hhmm(lastAiCall.at)} · ${lastAiCall.client}` : ''}` : ''}`,
    };
  };

  const summarize = (r: Record<string, unknown>, op: 'connect' | 'disconnect'): ClaudeActionResult => {
    const ok = r.ok === true;
    const action = r.action as string | undefined;
    const reasonText: Record<string, string> = {
      'claude-not-installed': 'Claude Desktop 을 찾지 못해 등록하지 않았습니다.',
      'invalid-config': `${invalidConfigText(r.error as string | undefined)} 손대지 않았습니다.`,
      'config-busy': 'Claude Desktop(또는 다른 프로그램)이 설정 파일을 계속 바꾸고 있어 쓰지 않았습니다. 잠시 뒤 다시 누르세요 — 설정은 그대로입니다.',
      'write-failed': writeFailedText(String(r.error ?? ''), r.backupPath as string | undefined),
    };
    const okText: Record<string, string> = op === 'connect'
      ? { unchanged: '이미 등록돼 있습니다.', created: '등록했습니다. Claude Desktop 을 한 번 다시 시작하세요.',
        added: '등록했습니다. Claude Desktop 을 한 번 다시 시작하세요.', updated: '이 프로그램으로 고쳤습니다. Claude Desktop 을 한 번 다시 시작하세요.' }
      : { removed: '등록을 지웠습니다. Claude Desktop 을 다시 시작하면 반영됩니다.', absent: '등록돼 있지 않습니다.',
        kept: 'StCFSD 항목이 이 프로그램의 것이 아니어서 그대로 두었습니다.' };
    return {
      ok, action, reason: r.reason as string | undefined, error: r.error as string | undefined,
      wrote: r.wrote as boolean | undefined, backupPath: r.backupPath as string | undefined,
      restartRequired: r.restartRequired as boolean | undefined,
      message: ok ? (okText[action ?? ''] ?? String(action)) : (reasonText[String(r.reason)] ?? String(r.error ?? r.reason)),
    };
  };

  const act = async (op: 'connect' | 'disconnect') => {
    if (!writable) { return { result: { ok: false, reason: 'read-only', message: '이 화면에서는 등록을 바꿀 수 없습니다.' }, status: await status() }; }
    if (!mod || !entry) { return { result: { ok: false, reason: 'unavailable', message: '등록 도우미(out/mcp/claudeDesktop.js)가 없습니다.' }, status: await status() }; }
    const raw = op === 'connect'
      ? mod.connectClaudeDesktop({ entry, configPath: o.configPath })
      : mod.disconnectClaudeDesktop({ entry, configPath: o.configPath });
    const result = summarize(raw, op);
    if (op === 'connect' && result.ok && result.wrote) { connectedAt = Date.now(); }
    if (op === 'disconnect' && result.ok && result.wrote) { connectedAt = undefined; }
    return { result, status: await status() };
  };

  return { status, connect: () => act('connect'), disconnect: () => act('disconnect') };
}
