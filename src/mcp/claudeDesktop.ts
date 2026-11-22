/**
 * K1 · Claude Desktop 등록 — 독립 프로그램의 「연결」 단추 뒤의 일. vscode 비의존(확장은 부르지 않는다).
 *
 * StAnal `desktop/host/src/claude/{paths,connect}.ts` 를 본떴다.
 *  - 설정 파일: Windows `%APPDATA%\Claude\claude_desktop_config.json`(+ MSIX 설치본의
 *    `%LOCALAPPDATA%\Packages\<claude…>\LocalCache\Roaming\Claude\…` — 실제 MSIX 로 확인하지 못함),
 *    macOS `~/Library/Application Support/Claude/…`, 그 밖 `~/.config/Claude/…`.
 *  - `mcpServers.stcfsd` 하나만 더하거나 고친다. 다른 최상위 키 · 다른 서버는 값 그대로(들여쓰기 · 줄바꿈 꼴도 따른다).
 *  - 쓰기 전에 백업(`<파일>.stcfsd-backup-YYYYMMDD-HHMMSS[-n]`), 같은 폴더 임시 파일 + rename(Windows 잠금은 재시도),
 *    쓴 뒤 다시 읽어 확인. JSON 이 아니면(또는 루트 · mcpServers 가 객체가 아니면) 손대지 않고 백업도 하지 않는다.
 *  - Claude 설정 폴더가 없으면(= Claude Desktop 미설치) 만들지 않는다.
 *  - 끊기는 지금 쓸 항목과 **같은** 항목만 지운다.
 * 모든 경로는 주입할 수 있다(`configPath` · `pathOptions`) — 시험은 진짜 설정에 닿지 않는다.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PORT_FILE_ENV, STANDALONE_ENV, atomicWriteFile } from './portFile';

/** Claude Desktop 설정의 항목 이름. (확장의 Claude Code 등록 이름은 registration.ts 의 'stcfsd-section-designer') */
export const CLAUDE_DESKTOP_SERVER_KEY = 'stcfsd';
/** 앱 전용 폴더 이름 — Electron `app.getPath('userData')` 기본(`%APPDATA%\<productName>`)과 맞춘다. */
export const APP_DIR_NAME = 'StCFSD';
export const PORT_FILE_NAME = 'stcfsd-mcp-port';
/** 앱 뿌리(확장 배포물의 뿌리) 기준 MCP 서버 번들 */
export const MCP_SERVER_REL_PATH: readonly string[] = ['media', 'mcp-server.js'];

export interface PathOptions {
    platform?: NodeJS.Platform;
    home?: string;
    env?: NodeJS.ProcessEnv;
}

function resolved(opts: PathOptions = {}) {
    const platform = opts.platform ?? process.platform;
    return {
        platform,
        home: opts.home ?? os.homedir(),
        env: opts.env ?? process.env,
        p: platform === 'win32' ? path.win32 : path.posix,
    };
}

/** 앱 폴더: Windows `%APPDATA%\StCFSD`, macOS `~/Library/Application Support/StCFSD`, 그 밖 `$XDG_CONFIG_HOME/StCFSD`. */
export function appDataDir(override?: string, opts: PathOptions = {}): string {
    const { platform, home, env, p } = resolved(opts);
    if (override) { return p.resolve(override); }
    if (platform === 'win32') { return p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), APP_DIR_NAME); }
    if (platform === 'darwin') { return p.join(home, 'Library', 'Application Support', APP_DIR_NAME); }
    return p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), APP_DIR_NAME);
}

/**
 * 프로그램의 `process.env.STCFSD_MCP_PORT_FILE` 과 Claude 설정의 `env.STCFSD_MCP_PORT_FILE` 에 함께 넣는 경로:
 * `<앱 폴더>/mcp/stcfsd-mcp-port`.
 */
export function standardPortFile(appDir: string, opts: PathOptions = {}): string {
    return resolved(opts).p.join(appDir, 'mcp', PORT_FILE_NAME);
}

/** 앱 뿌리 → MCP 서버 번들 경로 */
export function mcpServerScript(appRoot: string, opts: PathOptions = {}): string {
    return resolved(opts).p.join(appRoot, ...MCP_SERVER_REL_PATH);
}

export function claudeDesktopConfigPath(platform: NodeJS.Platform, home: string, appData?: string): string {
    const p = platform === 'win32' ? path.win32 : path.posix;
    if (platform === 'win32') { return p.join(appData || p.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json'); }
    if (platform === 'darwin') { return p.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'); }
    return p.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

export type ClaudeConfigKind = 'standard' | 'msix';

export interface ClaudeConfigCandidate {
    kind: ClaudeConfigKind;
    path: string;
    /** 설정 폴더가 있는가 — Claude Desktop 이 이 사용자로 한 번은 떴다는 근거 */
    dirExists: boolean;
    fileExists: boolean;
}

function exists(file: string): boolean {
    try { fs.statSync(file); return true; } catch { return false; }
}

/** 설정 파일 후보(StAnal paths.ts 와 같은 목록). MSIX 는 Windows 만, `Packages` 아래 이름에 claude 가 든 폴더. */
export function claudeConfigCandidates(opts: PathOptions = {}): ClaudeConfigCandidate[] {
    const { platform, home, env, p } = resolved(opts);
    const standard = claudeDesktopConfigPath(platform, home, env.APPDATA);
    const out: ClaudeConfigCandidate[] = [{
        kind: 'standard', path: standard, dirExists: exists(p.dirname(standard)), fileExists: exists(standard),
    }];
    if (platform === 'win32') {
        const packages = p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'Packages');
        let names: string[];
        try { names = fs.readdirSync(packages); } catch { names = []; }
        for (const name of names.filter(n => /claude/i.test(n)).sort()) {
            const dir = p.join(packages, name, 'LocalCache', 'Roaming', 'Claude');
            if (!exists(dir)) { continue; }
            const file = p.join(dir, 'claude_desktop_config.json');
            out.push({ kind: 'msix', path: file, dirExists: true, fileExists: exists(file) });
        }
    }
    return out;
}

/** 고르는 순서: 파일이 있는 MSIX → 폴더가 있는 standard → 폴더가 있는 MSIX → standard(폴더 없음 = 미설치). */
export function pickClaudeConfig(candidates: ClaudeConfigCandidate[]): ClaudeConfigCandidate {
    return candidates.find(c => c.kind === 'msix' && c.fileExists)
        ?? candidates.find(c => c.kind === 'standard' && c.dirExists)
        ?? candidates.find(c => c.kind === 'msix' && c.dirExists)
        ?? candidates[0];
}

// ─── 등록 항목 ─────────────────────────────────────────────────────

export interface McpEntry {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export interface StandaloneEntryInput {
    /** MCP 서버를 띄울 실행 파일 — 설치본은 `StCFSD.exe`(Electron), 개발은 node 또는 electron */
    command: string;
    /** `<앱 뿌리>/media/mcp-server.js` 의 절대 경로(`mcpServerScript`) */
    serverScript: string;
    /** 프로그램이 쓰는 포트 파일(`standardPortFile`) */
    portFile: string;
    /** command 가 Electron 이면 true(기본) — `ELECTRON_RUN_AS_NODE=1` 을 넣는다. node 면 false */
    electron?: boolean;
}

/**
 * Claude 설정에 넣을 항목. 경로는 OS 모양 그대로(JSON 의 `\\`). 인자 배열이라 공백 · 한글에 따옴표가 필요 없다.
 * 설치본: `{command: StCFSD.exe, args: [<…>/media/mcp-server.js],
 *          env: {ELECTRON_RUN_AS_NODE: "1", STCFSD_MCP_PORT_FILE: <포트 파일>, STCFSD_MCP_STANDALONE: "1"}}`
 */
export function standaloneMcpEntry(input: StandaloneEntryInput): McpEntry {
    return {
        command: input.command,
        args: [input.serverScript],
        env: {
            ...(input.electron === false ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
            [PORT_FILE_ENV]: input.portFile,
            [STANDALONE_ENV]: '1',
        },
    };
}

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

function sameEnv(a: Record<string, unknown> | undefined, b: Record<string, string> | undefined): boolean {
    const ea = Object.entries(a ?? {}).sort(([x], [y]) => x.localeCompare(y));
    const eb = Object.entries(b ?? {}).sort(([x], [y]) => x.localeCompare(y));
    return ea.length === eb.length && ea.every(([k, v], i) => eb[i][0] === k && eb[i][1] === v);
}

/** 설정에 있는 값이 이 항목과 같은가(env 키 순서 무관, 다른 키가 더 있으면 다르다). */
export function sameEntry(raw: unknown, expected: McpEntry): boolean {
    if (!isObject(raw)) { return false; }
    const extra = Object.keys(raw).filter(k => k !== 'command' && k !== 'args' && k !== 'env');
    const args = raw.args;
    const env = raw.env;
    return extra.length === 0
        && raw.command === expected.command
        && Array.isArray(args) && args.length === expected.args.length && args.every((a, i) => a === expected.args[i])
        && (env === undefined || isObject(env))
        && sameEnv(env as JsonObject | undefined, expected.env);
}

// ─── 설정 파일 읽기 ────────────────────────────────────────────────

interface TextFormat { indent: string; eol: string; finalNewline: boolean }

interface ReadConfig {
    exists: boolean;
    text: string | null;
    error?: string;
    cfg?: JsonObject;
    bom: boolean;
    format: TextFormat;
}

const DEFAULT_FORMAT: TextFormat = { indent: '  ', eol: '\n', finalNewline: true };

/** 원문의 들여쓰기 · 줄바꿈 꼴. 다시 쓸 때 따른다(다른 항목이 공연히 바뀌어 보이지 않게). */
function detectFormat(text: string): TextFormat {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const m = /\n([ \t]+)\S/.exec(text);
    return { indent: m ? m[1] : '  ', eol, finalNewline: /\n$/.test(text) || text.trim() === '' };
}

function readConfig(file: string): ReadConfig {
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return { exists: false, text: null, bom: false, format: DEFAULT_FORMAT };
        }
        return { exists: true, text: null, bom: false, format: DEFAULT_FORMAT, error: `cannot read: ${(err as Error).message}` };
    }
    const bom = text.charCodeAt(0) === 0xfeff;
    const body = bom ? text.slice(1) : text;
    const format = detectFormat(body);
    if (!body.trim()) { return { exists: true, text, bom, format, cfg: {} }; }
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch (err) {
        return { exists: true, text, bom, format, error: `not valid JSON: ${(err as Error).message}` };
    }
    if (!isObject(parsed)) { return { exists: true, text, bom, format, error: 'the config root is not a JSON object' }; }
    if (parsed.mcpServers !== undefined && !isObject(parsed.mcpServers)) {
        // 갈아 끼우면 남의 값을 지우게 된다 — 여기서 멈춘다.
        return { exists: true, text, bom, format, error: 'mcpServers is not a JSON object' };
    }
    return { exists: true, text, bom, format, cfg: parsed };
}

function serialize(cfg: JsonObject, read: ReadConfig): string {
    const f = read.exists && read.text ? read.format : DEFAULT_FORMAT;
    let out = JSON.stringify(cfg, null, f.indent);
    if (f.eol !== '\n') { out = out.replace(/\n/g, f.eol); }   // JSON 문자열 안에는 날 줄바꿈이 없다
    if (f.finalNewline) { out += f.eol; }
    return (read.bom ? '﻿' : '') + out;
}

// ─── 상태 ─────────────────────────────────────────────────────────

export interface ClaudeDesktopOptions {
    /** 이 설치본이 넣을 항목(`standaloneMcpEntry`) */
    entry: McpEntry;
    /** 설정 파일을 직접 준다(시험). 주면 후보를 찾지 않는다 */
    configPath?: string;
    pathOptions?: PathOptions;
    now?: () => Date;
}

export type ClaudeDesktopState =
    /** 설정 폴더가 없다(Claude Desktop 이 이 사용자로 뜬 적이 없다) */
    | 'not-installed'
    /** 설정 파일이 깨졌다 — 연결은 손대지 않는다 */
    | 'invalid-config'
    | 'not-registered'
    /** `mcpServers.stcfsd` 가 있지만 이 설치본의 항목과 다르다(옮겼거나 다른 판, 손으로 고침) */
    | 'registered-elsewhere'
    | 'registered';

export interface ClaudeDesktopStatus {
    state: ClaudeDesktopState;
    configPath: string;
    configKind: ClaudeConfigKind | 'given';
    candidates: ClaudeConfigCandidate[];
    configExists: boolean;
    configError?: string;
    /** 지금 있는 `mcpServers.stcfsd`(없으면 undefined) */
    current?: unknown;
    expected: McpEntry;
    /** 함께 있는 다른 서버 이름 */
    others: string[];
}

function locateConfig(opts: ClaudeDesktopOptions): { file: string; kind: ClaudeConfigKind | 'given'; candidates: ClaudeConfigCandidate[] } {
    if (opts.configPath) {
        const file = path.resolve(opts.configPath);
        return {
            file, kind: 'given',
            candidates: [{ kind: 'standard', path: file, dirExists: exists(path.dirname(file)), fileExists: exists(file) }],
        };
    }
    const candidates = claudeConfigCandidates(opts.pathOptions);
    const chosen = pickClaudeConfig(candidates);
    return { file: chosen.path, kind: chosen.kind, candidates };
}

function serversOf(cfg: JsonObject | undefined): JsonObject {
    return cfg && isObject(cfg.mcpServers) ? cfg.mcpServers : {};
}

export function checkClaudeDesktop(opts: ClaudeDesktopOptions): ClaudeDesktopStatus {
    const { file, kind, candidates } = locateConfig(opts);
    const base = { configPath: file, configKind: kind, candidates, expected: opts.entry };
    if (!exists(path.dirname(file))) {
        return { ...base, state: 'not-installed', configExists: false, others: [] };
    }
    const read = readConfig(file);
    if (read.error) {
        return { ...base, state: 'invalid-config', configExists: read.exists, configError: read.error, others: [] };
    }
    const servers = serversOf(read.cfg);
    const current = servers[CLAUDE_DESKTOP_SERVER_KEY];
    const others = Object.keys(servers).filter(k => k !== CLAUDE_DESKTOP_SERVER_KEY);
    const state: ClaudeDesktopState = current === undefined ? 'not-registered'
        : sameEntry(current, opts.entry) ? 'registered' : 'registered-elsewhere';
    return { ...base, state, configExists: read.exists, current, others };
}

// ─── 쓰기 ─────────────────────────────────────────────────────────

function stamp(d: Date): string {
    const z = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

/** 같은 초에 두 번 백업해도 덮어쓰지 않는다. */
function backupPath(file: string, d: Date): string {
    const base = `${file}.stcfsd-backup-${stamp(d)}`;
    if (!exists(base)) { return base; }
    for (let i = 2; ; i++) {
        const c = `${base}-${i}`;
        if (!exists(c)) { return c; }
    }
}

function fileMode(file: string): number | undefined {
    try { return fs.statSync(file).mode & 0o777; } catch { return undefined; }
}

export type ClaudeFailReason = 'claude-not-installed' | 'invalid-config' | 'write-failed';

export interface ClaudeFail {
    ok: false;
    reason: ClaudeFailReason;
    configPath: string;
    error?: string;
    /** 쓰기 도중 실패했으면 쓰기 전 파일의 백업 */
    backupPath?: string;
}

export interface ClaudeConnectOk {
    ok: true;
    /** unchanged = 이미 같음(아무것도 쓰지 않음) · created = 파일을 새로 · added = 항목을 더함 · updated = 다른 stcfsd 를 고침 */
    action: 'unchanged' | 'created' | 'added' | 'updated';
    configPath: string;
    wrote: boolean;
    backupPath?: string;
    /** 바꾼 항목이 있었으면 그 값(백업에도 남는다) */
    previous?: unknown;
    others: string[];
    /** Claude Desktop 을 다시 시작해야 반영된다 */
    restartRequired: boolean;
    entry: McpEntry;
}

export interface ClaudeDisconnectOk {
    ok: true;
    /** removed = 우리 항목을 지움 · absent = 항목 없음 · kept = 지금 항목과 달라 그대로 둠 */
    action: 'removed' | 'absent' | 'kept';
    configPath: string;
    wrote: boolean;
    backupPath?: string;
    /** kept 일 때 그 값 */
    current?: unknown;
    restartRequired: boolean;
}

/** 백업 → 원자적 쓰기 → 다시 읽어 확인. 실패하면 던진다(호출자가 write-failed 로). */
function writeWithBackup(file: string, read: ReadConfig, text: string, now: Date,
    verify: (cfg: JsonObject) => string | null): string | undefined {
    let backup: string | undefined;
    const mode = read.exists ? fileMode(file) : undefined;
    if (read.exists) {
        backup = backupPath(file, now);
        fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    }
    try {
        atomicWriteFile(file, text, mode, 'stcfsd-tmp');
        const check = readConfig(file);
        const problem = check.error ?? (check.cfg ? verify(check.cfg) : 'empty after write');
        if (problem) { throw new Error(`re-read after writing does not match: ${problem}`); }
    } catch (err) {
        (err as Error & { backupPath?: string }).backupPath = backup;
        throw err;
    }
    return backup;
}

function canonical(v: unknown): string {
    if (v === undefined) { return 'undefined'; }
    if (v === null || typeof v !== 'object') { return JSON.stringify(v); }
    if (Array.isArray(v)) { return '[' + v.map(canonical).join(',') + ']'; }
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as JsonObject)[k])).join(',') + '}';
}

/** 다른 키(최상위 · 다른 서버)가 쓰기 전과 같은가 */
function othersUnchanged(before: JsonObject, after: JsonObject): string | null {
    const strip = (cfg: JsonObject) => {
        const servers = { ...serversOf(cfg) };
        delete servers[CLAUDE_DESKTOP_SERVER_KEY];
        return canonical({ ...cfg, mcpServers: servers });
    };
    return strip(before) === strip(after) ? null : 'other entries changed';
}

/** `mcpServers.stcfsd` 를 이 설치본의 항목으로 더하거나 고친다. */
export function connectClaudeDesktop(opts: ClaudeDesktopOptions): ClaudeConnectOk | ClaudeFail {
    const now = (opts.now ?? (() => new Date()))();
    const entry = opts.entry;
    const { file } = locateConfig(opts);
    if (!exists(path.dirname(file))) { return { ok: false, reason: 'claude-not-installed', configPath: file }; }
    const read = readConfig(file);
    if (read.error) { return { ok: false, reason: 'invalid-config', configPath: file, error: read.error }; }
    const cfg = read.cfg ?? {};
    const servers = serversOf(cfg);
    const previous = servers[CLAUDE_DESKTOP_SERVER_KEY];
    const others = Object.keys(servers).filter(k => k !== CLAUDE_DESKTOP_SERVER_KEY);
    if (previous !== undefined && sameEntry(previous, entry)) {
        return { ok: true, action: 'unchanged', configPath: file, wrote: false, others, restartRequired: false, entry };
    }
    const value: McpEntry = { command: entry.command, args: [...entry.args], ...(entry.env ? { env: { ...entry.env } } : {}) };
    // 키 자리를 지킨다: 이미 있으면 그 자리에서 값만, 없으면 끝에.
    const next: JsonObject = { ...cfg, mcpServers: { ...servers, [CLAUDE_DESKTOP_SERVER_KEY]: value } };
    let backup: string | undefined;
    try {
        backup = writeWithBackup(file, read, serialize(next, read), now, (after) =>
            !sameEntry(serversOf(after)[CLAUDE_DESKTOP_SERVER_KEY], entry) ? 'stcfsd entry differs' : othersUnchanged(cfg, after));
    } catch (err) {
        return { ok: false, reason: 'write-failed', configPath: file, error: (err as Error).message,
            backupPath: (err as Error & { backupPath?: string }).backupPath };
    }
    return {
        ok: true,
        action: !read.exists ? 'created' : previous === undefined ? 'added' : 'updated',
        configPath: file, wrote: true, backupPath: backup,
        ...(previous !== undefined ? { previous } : {}),
        others, restartRequired: true, entry,
    };
}

/** 이 설치본의 항목과 **같은** `mcpServers.stcfsd` 만 지운다. 다르면 그대로 두고 알린다. */
export function disconnectClaudeDesktop(opts: ClaudeDesktopOptions): ClaudeDisconnectOk | ClaudeFail {
    const now = (opts.now ?? (() => new Date()))();
    const { file } = locateConfig(opts);
    if (!exists(path.dirname(file))) { return { ok: false, reason: 'claude-not-installed', configPath: file }; }
    const read = readConfig(file);
    if (!read.exists) { return { ok: true, action: 'absent', configPath: file, wrote: false, restartRequired: false }; }
    if (read.error) { return { ok: false, reason: 'invalid-config', configPath: file, error: read.error }; }
    const cfg = read.cfg ?? {};
    const servers = serversOf(cfg);
    const current = servers[CLAUDE_DESKTOP_SERVER_KEY];
    if (current === undefined) { return { ok: true, action: 'absent', configPath: file, wrote: false, restartRequired: false }; }
    if (!sameEntry(current, opts.entry)) {
        return { ok: true, action: 'kept', configPath: file, wrote: false, current, restartRequired: false };
    }
    const rest = { ...servers };
    delete rest[CLAUDE_DESKTOP_SERVER_KEY];
    const next: JsonObject = { ...cfg, mcpServers: rest };
    let backup: string | undefined;
    try {
        backup = writeWithBackup(file, read, serialize(next, read), now, (after) =>
            CLAUDE_DESKTOP_SERVER_KEY in serversOf(after) ? 'stcfsd entry still present' : othersUnchanged(cfg, after));
    } catch (err) {
        return { ok: false, reason: 'write-failed', configPath: file, error: (err as Error).message,
            backupPath: (err as Error & { backupPath?: string }).backupPath };
    }
    return { ok: true, action: 'removed', configPath: file, wrote: true, backupPath: backup, restartRequired: true };
}
