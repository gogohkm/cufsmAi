/**
 * `GET /api/claude/status` — Claude Desktop 연결 상태(읽기만. 「연결」 · 「끊기」는 S4).
 *
 *  - 등록: K1 의 `checkClaudeDesktop({ entry })`(`out/mcp/claudeDesktop.js`) — Claude Desktop 설정 파일을 **읽기만** 한다.
 *    `entry` 는 이 호스트의 항목(`host.mcp.entry` = `standaloneMcpEntry`). 시험은 `configPath`(임시 폴더의 가짜 파일)를 준다.
 *  - 마지막 호출: 호스트의 MCP 다리 `GET /last-call`(토큰을 붙여서, AI 요청 id 머리 없이 — 이 조회는 AI 호출로 세지 않는다).
 *  - 틀의 제목 표시줄에 쓸 한 줄(`text`)을 함께 만든다.
 *
 * 응답에는 설정 파일 안의 항목 전문(`current` · `expected` — 실행 경로 · env)을 싣지 않는다. 화면이 쓸 일이 없다.
 */
import * as http from 'node:http';
import * as path from 'node:path';
import type { HostHandle } from '../loader';

export interface BridgeClaudeOptions {
  /** Claude Desktop 설정 파일을 직접 준다(시험 — 임시 폴더의 가짜). 없으면 이 PC 의 후보에서 고른다(읽기만) */
  configPath?: string;
  /** false 면 등록 상태를 보지 않는다(설정 파일을 읽지 않는다) */
  checkRegistration?: boolean;
}

export interface ClaudeStatus {
  state: string;
  configPath?: string;
  configKind?: string;
  configExists?: boolean;
  configError?: string;
  otherServers?: number;
  lastAiCall: { at: string; client: string; method: string; endpoint: string; action?: string } | null;
  aiCalls: number;
  /** 제목 표시줄의 한 줄 */
  text: string;
}

interface CheckModule {
  checkClaudeDesktop(o: { entry: unknown; configPath?: string }): {
    state: string; configPath: string; configKind: string; configExists: boolean; configError?: string; others: string[];
  };
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

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function createClaudeStatus(host: HostHandle, o: BridgeClaudeOptions = {}): () => Promise<ClaudeStatus> {
  let mod: CheckModule | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require(path.join(host.context.extensionPath as string, 'out', 'mcp', 'claudeDesktop.js')) as CheckModule;
  } catch { mod = undefined; }

  return async () => {
    let reg: Omit<ClaudeStatus, 'lastAiCall' | 'aiCalls' | 'text'> = { state: 'unknown' };
    if (o.checkRegistration !== false && mod && host.mcp.entry) {
      try {
        const s = mod.checkClaudeDesktop({ entry: host.mcp.entry, configPath: o.configPath });
        reg = { state: s.state, configPath: s.configPath, configKind: s.configKind, configExists: s.configExists,
          configError: s.configError, otherServers: s.others.length };
      } catch (err) { reg = { state: 'error', configError: String((err as Error).message ?? err) }; }
    }
    let lastAiCall: ClaudeStatus['lastAiCall'] = null;
    let aiCalls = 0;
    try {
      const lc = await getJson(host.mcp.port, host.mcp.token, '/last-call');
      lastAiCall = lc?.lastAiCall ?? null;
      aiCalls = Number(lc?.aiCalls) || 0;
    } catch { /* 다리가 없으면 호출도 없다 */ }
    const regText: Record<string, string> = {
      'registered': 'Claude 등록됨', 'registered-elsewhere': 'Claude 다른 항목으로 등록됨', 'not-registered': 'Claude 등록 안 됨',
      'not-installed': 'Claude Desktop 없음', 'invalid-config': 'Claude 설정 파일 읽기 실패', 'unknown': 'Claude 확인 안 함', 'error': 'Claude 확인 실패',
    };
    const text = lastAiCall
      ? `Claude 연결됨 · 마지막 호출 ${hhmm(lastAiCall.at)}`
      : `${regText[reg.state] ?? reg.state} · 아직 호출 없음`;
    return { ...reg, lastAiCall, aiCalls, text };
  };
}
