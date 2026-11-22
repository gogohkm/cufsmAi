// StCFSD 제거 도우미(V5-05) — 설치본의 resources/app/uninstall/disconnect.js 로 실린다.
//
//   ELECTRON_RUN_AS_NODE=1 "<설치 폴더>\StCFSD.exe" "<설치 폴더>\resources\app\uninstall\disconnect.js"
//
// 제거 프로그램(NSIS, desktop/installer/installer.nsh 의 customUnInstall)이 파일을 지우기 **전에** 부른다. 하는 일은 제목 표시줄의
// 「끊기」와 같다 — Claude Desktop 설정의 `mcpServers.stcfsd` 가 **이 설치본이 넣는 항목과 같을 때만** 지운다(K1 의
// disconnectClaudeDesktop: 다른 항목 · 다른 설치를 가리키는 stcfsd 는 그대로, 쓰기 전 백업, 임시 파일 + 이름 바꾸기, 다시 읽어 확인).
// 이 설치본의 항목 = command 이 실행 파일(process.execPath), args 이 설치본의 media/mcp-server.js, 포트 파일 %APPDATA%\StCFSD\mcp\
// stcfsd-mcp-port — 껍데기가 「연결」 때 만드는 것과 같은 식(desktop/shell/src/main.ts).
//
// 조용하다: 창 · 대화상자 없음, 결과는 stdout 한 줄(JSON). 무엇이 실패해도 종료 코드 0 — 제거를 막지 않는다.
// 덮어 설치(판 올리기)에서는 부르지 않는다(설치 자리가 같아 등록이 그대로 맞다 — installer.nsh 의 ${isUpdated}).
// `--config <파일>` · `--user-data <폴더>` 는 시험용(포장본 시험이 가짜 설정 · 임시 사용자 폴더로 이 파일 자체를 돌린다).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : undefined; };
  const resources = path.resolve(__dirname, '..', '..');
  const appRoot = path.join(resources, 'app-root');
  const helper = path.join(appRoot, 'out', 'mcp', 'claudeDesktop.js');
  if (!fs.existsSync(helper)) { return { ok: false, reason: 'no-helper', helper }; }
  const cd = require(helper);
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const userData = opt('--user-data') ? path.resolve(opt('--user-data')) : path.join(appData, 'StCFSD');
  const entry = cd.standaloneMcpEntry({
    command: process.execPath, serverScript: path.join(appRoot, 'media', 'mcp-server.js'),
    portFile: path.join(userData, 'mcp', 'stcfsd-mcp-port'), electron: true,
  });
  const r = cd.disconnectClaudeDesktop({ entry, configPath: opt('--config') ? path.resolve(opt('--config')) : undefined });
  return { ok: r.ok === true, action: r.action, reason: r.reason, wrote: r.wrote, configPath: r.configPath, backupPath: r.backupPath };
}

let result;
try { result = main(); } catch (err) { result = { ok: false, reason: 'exception', error: String((err && err.message) || err) }; }
try { process.stdout.write(`STCFSD_UNINSTALL_DISCONNECT ${JSON.stringify(result)}\n`); } catch { /* 출력이 닫힘 */ }
process.exitCode = 0;
