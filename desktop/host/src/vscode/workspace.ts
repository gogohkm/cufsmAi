/**
 * vscode.workspace — 설정, 작업 폴더, 파일 쓰기(workspace.fs).
 *
 * 작업 폴더는 **없다**(`workspaceFolders` = undefined, VS Code 의 빈 창과 같다). StCFSD 호스트가
 * 작업 폴더를 읽는 곳은 MCP 설정 파일 쓰기(`.mcp.json` · `.claude/mcp.json`)뿐이다 — 독립 프로그램은
 * 그 파일을 쓰지 않는다(적재기 머리말의 "MCP 설정 파일"). 작업 폴더가 없으면 그 길이 한 번 더 막힌다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from './events';
import { Uri } from './uri';
import { FileType } from './types';
import type { ConfigurationStore } from './configuration';
import { guard, type UnimplementedTracker } from './unimplemented';

class FileSystemError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = `FileSystemError (${code})`; }
}

function wrapFsError(err: unknown, uri: Uri): never {
  const e = err as NodeJS.ErrnoException;
  const code = e?.code === 'ENOENT' ? 'FileNotFound' : e?.code === 'EEXIST' ? 'FileExists'
    : e?.code === 'EACCES' || e?.code === 'EPERM' ? 'NoPermissions' : 'Unknown';
  throw new FileSystemError(code, `${code}: ${uri.fsPath}${e?.message ? ` (${e.message})` : ''}`);
}

function createFs(tracker: UnimplementedTracker) {
  // StCFSD 는 writeFile 만 쓴다(보고서 HTML 저장). 읽기 · stat · 폴더 만들기는 같은 모양으로 둔다.
  const api = {
    async readFile(uri: Uri): Promise<Uint8Array> {
      try { return new Uint8Array(await fs.promises.readFile(uri.fsPath)); } catch (e) { wrapFsError(e, uri); }
    },
    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      try {
        await fs.promises.mkdir(path.dirname(uri.fsPath), { recursive: true });
        await fs.promises.writeFile(uri.fsPath, content);
      } catch (e) { wrapFsError(e, uri); }
    },
    async stat(uri: Uri) {
      try {
        const s = await fs.promises.stat(uri.fsPath);
        return { type: s.isDirectory() ? FileType.Directory : FileType.File, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
      } catch (e) { wrapFsError(e, uri); }
    },
    async createDirectory(uri: Uri): Promise<void> {
      try { await fs.promises.mkdir(uri.fsPath, { recursive: true }); } catch (e) { wrapFsError(e, uri); }
    },
  };
  return guard(api, 'workspace.fs', tracker);
}

export interface WorkspaceDeps {
  tracker: UnimplementedTracker;
  config: ConfigurationStore;
}

export function createWorkspaceNamespace(d: WorkspaceDeps) {
  const onDidChangeWorkspaceFolders = new EventEmitter<{ added: unknown[]; removed: unknown[] }>();
  const namespace = {
    getConfiguration: (section?: string, _scope?: unknown) => d.config.section(section),
    onDidChangeConfiguration: d.config.onDidChange.event,
    // 작업 폴더 없음. 키는 두어 "없음"이 정상 상태임을 알린다.
    workspaceFolders: undefined,
    // 작업 폴더가 바뀌는 일이 없으니 쏘지 않는다. 확장은 구독만 한다(setupMcpConfig — 독립 프로그램에서는 닿지 않는다).
    onDidChangeWorkspaceFolders: onDidChangeWorkspaceFolders.event,
    fs: createFs(d.tracker),
  };
  return { namespace, dispose: () => onDidChangeWorkspaceFolders.dispose() };
}
