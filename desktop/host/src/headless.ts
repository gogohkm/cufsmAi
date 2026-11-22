/**
 * 화면 없는 StCFSD 호스트.
 *
 *   node desktop/host/dist/headless.js [--open <파일.csd>]… [--port-file <경로>] [--port <n>]
 *                                      [--python <python.exe>] [--user-data <폴더>] [--repo <저장소 루트>]
 *
 * 확장 호스트(out/extension.js)를 포트 파일 방식(K1)으로 띄우고 설계 패널을 만든 뒤, MCP 다리 주소와
 * MCP 클라이언트가 쓸 환경(`STCFSD_MCP_PORT_FILE` · `STCFSD_MCP_STANDALONE`)을 출력하고 떠 있다.
 * `--open` 은 여러 번 줄 수 있다(차례로 연다 — 확장의 「열기」 길). Ctrl+C 로 끝낸다.
 *
 * `--port-file` 을 주지 않으면 개발용 임시 파일(`<임시 폴더>/stcfsd-desktop/stcfsd-mcp-port`)을 쓴다 —
 * 사용자의 진짜 앱 데이터 폴더(`%APPDATA%\StCFSD\mcp\`)에는 그 경로를 분명히 줄 때만 쓴다.
 * 토큰은 출력하지 않는다(포트 파일에 있다). 아무 설정 파일에도 등록하지 않는다 — Claude Desktop 항목은 보이기만 한다.
 *
 * stdout 에는 이 CLI 의 줄만 쓴다. 확장 · Python 의 console 출력은 stderr 로 돌린다.
 * 마지막 시작 줄은 `STCFSD_HOST_READY {…}`(JSON) — 기계가 읽는 줄이다.
 *
 * 제어 통로(IPC): 부모가 `child_process.fork` · `stdio: [..., 'ipc']` 로 띄웠으면 메시지로 부릴 수 있다 —
 * `{id, type:'status'}` · `{id, type:'open', file}` · `{id, type:'save', file}` · `{id, type:'shutdown'}`.
 * 답은 `{id, ok, result | error}`. 부모가 끊기면 끝낸다. 연기 시험과 뒤의 껍데기가 쓴다.
 * (Windows 에서는 다른 프로세스가 보낸 SIGTERM 을 받을 수 없다 — 그 프로세스는 곧바로 죽는다.
 * 깔끔히 끝내는 길은 콘솔의 Ctrl+C · Ctrl+Break 와 IPC `shutdown` 이다.)
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { format } from 'node:util';
import { defaultUserDataDir, startHost, type HostHandle } from './loader';
import { createHeadlessPlatform, type HeadlessPlatform } from './platform';

function parseArgs(argv: string[]): { flags: Record<string, string | true>; open: string[] } {
  const flags: Record<string, string | true> = {};
  const open: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    const value: string | true = next !== undefined && !next.startsWith('--') ? (i++, next) : true;
    if (key === 'open') { if (typeof value === 'string') { open.push(value); } } else { flags[key] = value; }
  }
  return { flags, open };
}

const out = (line: string) => process.stdout.write(`${line}\n`);

/** 확장 · Python 의 console 출력을 stderr 로 — stdout 은 이 CLI 의 줄만 */
function routeConsoleToStderr(): void {
  const toErr = (...args: unknown[]) => { process.stderr.write(`${format(...args)}\n`); };
  console.log = toErr;
  console.info = toErr;
  console.warn = toErr;
  console.error = toErr;
  console.debug = toErr;
}

/** 개발판의 기본 포트 파일 — 임시 폴더. 같은 경로라 껐다 켜도 클라이언트가 다시 붙는다(K1 의 재시작 막기를 거쳐) */
function devPortFile(): string {
  return path.join(os.tmpdir(), 'stcfsd-desktop', 'stcfsd-mcp-port');
}

/** 셸에 그대로 붙여 넣을 수 있게 — 공백이 있으면 따옴표 */
const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);

function describeClient(host: HostHandle): string[] {
  const envLine = Object.entries(host.mcp.env).map(([k, v]) => `${k}=${q(v)}`).join(' ');
  const lines = [`MCP 클라이언트: ${envLine} node ${q(host.mcp.serverScript)}`];
  if (host.mcp.entry) { lines.push(`Claude Desktop 항목(등록하지 않음): ${JSON.stringify({ stcfsd: host.mcp.entry })}`); }
  return lines;
}

async function main(): Promise<void> {
  const { flags, open } = parseArgs(process.argv.slice(2));
  if (flags.help || flags.h) {
    out('사용법: node desktop/host/dist/headless.js [--open <파일.csd>]… [--port-file <경로>] [--port <n>] [--python <python.exe>] [--user-data <폴더>] [--repo <루트>]');
    return;
  }
  routeConsoleToStderr();
  const repoRoot = typeof flags.repo === 'string' ? path.resolve(flags.repo) : path.resolve(__dirname, '..', '..', '..');
  const userDataDir = typeof flags['user-data'] === 'string' ? path.resolve(flags['user-data']) : defaultUserDataDir();
  let mcpPort: number | undefined;
  if (typeof flags.port === 'string') {
    mcpPort = Number(flags.port);
    if (!Number.isInteger(mcpPort) || mcpPort <= 0 || mcpPort > 65535) { throw new Error(`--port 가 포트 번호가 아니다: ${flags.port}`); }
  }
  const pythonPath = typeof flags.python === 'string' ? flags.python : undefined;
  const portFile = typeof flags['port-file'] === 'string' ? path.resolve(flags['port-file']) : devPortFile();

  const log = (line: string) => process.stderr.write(`${line}\n`);
  const platform: HeadlessPlatform = createHeadlessPlatform({ log });
  const host = await startHost({ repoRoot, userDataDir, platform, pythonPath, portFile, mcpPort, log });

  out(`StCFSD headless 호스트 — 명령 ${host.commands.ids().length}개, 활성화 ${host.activationMs} ms, 설계 패널 ${host.panelMs} ms`);
  out(`Python: ${host.python.path} (${host.python.source})`);
  out(`MCP 다리: ${host.mcp.url}  (Bearer 토큰 · GET /status · POST /action · GET /last-call)`);
  out(`포트 파일: ${host.mcp.portFile}`);
  for (const line of describeClient(host)) { out(line); }

  for (const file of open) {
    const r = await host.openProject(file);
    out(`열기 ${file}: ${r.ok ? '성공' : '실패'} — ${r.message ?? ''}`);
  }
  out(`STCFSD_HOST_READY ${JSON.stringify({ pid: process.pid, mcpPort: host.mcp.port, url: host.mcp.url,
    portFile: host.mcp.portFile, env: host.mcp.env, serverScript: host.mcp.serverScript,
    python: host.python.path, designer: host.designer.id, blockedCommands: host.runtime.commands.blockedIds() })}`);

  let stopping = false;
  const stop = async (why: string) => {
    if (stopping) { return; }
    stopping = true;
    out(`${why} — 정리하는 중`);
    await host.dispose();
    out('정리 끝');
    process.exitCode = 0;
    if (process.connected) { process.disconnect(); }
    // 남은 핸들이 없으면 여기서 스스로 끝난다. 무엇이 남아 붙잡으면 알리고 끝낸다.
    setTimeout(() => {
      process.stderr.write(`[headless] 끝나지 않는다 — 남은 핸들: ${process.getActiveResourcesInfo().join(', ')}\n`);
      process.exit(0);
    }, 10_000).unref();
  };
  process.on('SIGINT', () => { void stop('SIGINT'); });
  process.on('SIGTERM', () => { void stop('SIGTERM'); });
  if (process.platform === 'win32') { process.on('SIGBREAK', () => { void stop('SIGBREAK'); }); }

  if (process.send) {
    const reply = (msg: unknown) => { if (process.connected) { process.send!(msg); } };
    process.on('message', (raw: unknown) => {
      const m = (raw ?? {}) as { id?: unknown; type?: string; file?: string };
      const answer = async (): Promise<unknown> => {
        switch (m.type) {
          case 'status':
            return {
              designerAlive: host.designer.alive(),
              designer: host.designer.id,
              webviews: host.webviews.list().map(w => ({ id: w.id, viewType: w.viewType, visible: w.visible, pinned: w.pinned })),
              messageCounts: host.messageCounts(),
              unimplemented: host.unimplemented(),
              questions: platform.questions,
              notifications: platform.notifications.map(n => ({ severity: n.severity, message: n.message })),
              mcpConfigWrites: host.mcpConfigWrites(),
              // 토큰은 IPC 로도 내지 않는다(부모는 포트 파일을 읽는다).
              mcp: { ...host.mcp, token: undefined },
            };
          case 'open':
            if (typeof m.file !== 'string') { throw new Error('open 에는 file 이 있어야 한다'); }
            return host.openProject(m.file);
          case 'save':
            if (typeof m.file !== 'string') { throw new Error('save 에는 file 이 있어야 한다'); }
            return host.saveProject(m.file);
          case 'shutdown':
            setImmediate(() => { void stop('IPC shutdown'); });
            return { stopping: true };
          default:
            throw new Error(`모르는 요청: ${String(m.type)}`);
        }
      };
      answer().then(result => reply({ id: m.id, ok: true, result }),
        err => reply({ id: m.id, ok: false, error: String((err as Error)?.message ?? err) }));
    });
    process.on('disconnect', () => { void stop('부모 연결 끊김'); });
  }
  // MCP 다리(HTTP 서버)와 Python 이 이벤트 루프를 붙잡고 있어 여기서 떠 있는다.
}

main().catch(err => {
  process.stderr.write(`[headless] 시작 실패: ${err?.stack ?? err}\n`);
  process.exit(1);
});
