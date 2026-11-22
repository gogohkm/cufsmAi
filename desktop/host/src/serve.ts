/**
 * 호스트 + 화면 다리(S2).
 *
 *   node desktop/host/dist/serve.js [--open <파일.csd>]… [--theme dark|light] [--port <다리 포트>]
 *                                   [--port-file <MCP 포트 파일>] [--python <python.exe>] [--user-data <폴더>]
 *                                   [--documents <폴더>] [--claude-config <Claude 설정 파일>] [--repo <저장소 루트>]
 *
 * 확장 호스트를 화면이 있는 모드(screenless: false)로 띄우고 다리를 연 뒤, 토큰이 붙은 주소를 출력한다. 보통 브라우저로
 * 연다(뒤에 S3 의 Electron 창). `--open` 은 확장의 「열기」 길로 연다. Ctrl+C(SIGINT) · Ctrl+Break · IPC `shutdown` 으로 끝낸다.
 *
 * MCP 는 headless 와 같이 포트 파일 방식이다(`--port-file`, 기본은 임시 폴더). 아무 설정 파일에도 등록하지 않는다.
 * Claude 연결 상태: `--claude-config` 가 없으면 이 PC 의 Claude Desktop 설정을 **읽기만** 한다(쓰는 것은 S4 의 「연결」뿐).
 * 열기/저장 물음의 기본 폴더는 `<문서>/StCFSD`(`--documents` 로 바꾼다). 확인하기 전에는 읽거나 만들지 않는다.
 *
 * stdout 에는 이 CLI 의 줄만, 마지막 시작 줄은 `STCFSD_BRIDGE_READY {…}`(JSON, 토큰 포함 주소 — 기계가 읽는다).
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { format } from 'node:util';
import { createBridgePlatform, startBridge } from './bridge';
import { defaultUserDataDir, startHost } from './loader';

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
const str = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined);

async function main(): Promise<void> {
  const { flags, open } = parseArgs(process.argv.slice(2));
  if (flags.help || flags.h) {
    out('사용법: node desktop/host/dist/serve.js [--open <파일.csd>]… [--theme dark|light] [--port <n>] [--port-file <경로>] '
      + '[--python <python.exe>] [--user-data <폴더>] [--documents <폴더>] [--claude-config <파일>] [--repo <루트>]');
    return;
  }
  // 확장 · Python 의 console 은 stderr 로 — stdout 은 이 CLI 의 줄만.
  const toErr = (...args: unknown[]) => { process.stderr.write(`${format(...args)}\n`); };
  console.log = toErr; console.info = toErr; console.warn = toErr; console.error = toErr; console.debug = toErr;

  const repoRoot = str(flags.repo) ? path.resolve(str(flags.repo)!) : path.resolve(__dirname, '..', '..', '..');
  const userDataDir = str(flags['user-data']) ? path.resolve(str(flags['user-data'])!) : defaultUserDataDir();
  const portFile = str(flags['port-file']) ? path.resolve(str(flags['port-file'])!) : path.join(os.tmpdir(), 'stcfsd-desktop', 'stcfsd-mcp-port');
  const log = (line: string) => process.stderr.write(`${line}\n`);

  const platform = createBridgePlatform({ log, documentsDir: str(flags.documents) ? path.resolve(str(flags.documents)!) : undefined });
  const host = await startHost({ repoRoot, userDataDir, platform, portFile, pythonPath: str(flags.python), screenless: false, log });
  let bridge;
  try {
    bridge = await startBridge(host, {
      platform, log,
      port: str(flags.port) ? Number(flags.port) : 0,
      theme: flags.theme === 'light' ? 'light' : 'dark',
      claude: { configPath: str(flags['claude-config']) ? path.resolve(str(flags['claude-config'])!) : undefined },
    });
  } catch (err) {
    await host.dispose();
    throw err;
  }
  out(`StCFSD 호스트 + 화면 다리 — 활성화 ${host.activationMs} ms, 설계 패널 ${host.panelMs} ms`);
  out(`화면: ${bridge.url}`);
  out(`MCP 다리: ${host.mcp.url}  포트 파일: ${host.mcp.portFile}`);
  out(`MCP 클라이언트: ${Object.entries(host.mcp.env).map(([k, v]) => `${k}=${v}`).join(' ')} node ${host.mcp.serverScript}`);
  for (const file of open) {
    const r = await host.openProject(file);
    if (r.ok) { bridge.setCurrentFile(r.file); }
    out(`열기 ${file}: ${r.ok ? '성공' : '실패'} — ${r.message ?? ''}`);
  }
  out(`STCFSD_BRIDGE_READY ${JSON.stringify({ pid: process.pid, url: bridge.url, origin: bridge.origin, port: bridge.port,
    mcpPort: host.mcp.port, portFile: host.mcp.portFile, designer: host.designer.id })}`);

  let stopping = false;
  const stop = async (why: string) => {
    if (stopping) { return; }
    stopping = true;
    out(`${why} — 정리하는 중`);
    await bridge.dispose();
    await host.dispose();
    out('정리 끝');
    process.exitCode = 0;
    if (process.connected) { process.disconnect(); }
    setTimeout(() => {
      process.stderr.write(`[serve] 끝나지 않는다 — 남은 핸들: ${process.getActiveResourcesInfo().join(', ')}\n`);
      process.exit(0);
    }, 10_000).unref();
  };
  process.on('SIGINT', () => { void stop('SIGINT'); });
  process.on('SIGTERM', () => { void stop('SIGTERM'); });
  if (process.platform === 'win32') { process.on('SIGBREAK', () => { void stop('SIGBREAK'); }); }
  if (process.send) {
    process.on('message', (raw: unknown) => {
      const m = (raw ?? {}) as { id?: unknown; type?: string };
      const reply = (msg: unknown) => { if (process.connected) { process.send!(msg); } };
      if (m.type === 'shutdown') { reply({ id: m.id, ok: true, result: { stopping: true } }); setImmediate(() => { void stop('IPC shutdown'); }); return; }
      if (m.type === 'status') {
        reply({ id: m.id, ok: true, result: { unimplemented: host.unimplemented(), messageCounts: host.messageCounts(),
          designerAlive: host.designer.alive(), channels: bridge.channels(), mcpConfigWrites: host.mcpConfigWrites(),
          questions: platform.headless.questions, notifications: platform.headless.notifications.map(n => ({ severity: n.severity, message: n.message })) } });
        return;
      }
      reply({ id: m.id, ok: false, error: `모르는 요청: ${String(m.type)}` });
    });
    process.on('disconnect', () => { void stop('부모 연결 끊김'); });
  }
}

main().catch(err => {
  process.stderr.write(`[serve] 시작 실패: ${err?.stack ?? err}\n`);
  process.exit(1);
});
