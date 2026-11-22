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
 *  - V5(2026-11-22): rename 바로 앞에서 다시 보고 그사이 바뀌었으면 다시 읽어 우리 한 가지만 다시 얹는다(몇 번 —
 *    계속 바뀌면 `config-busy`, 덮어쓰지 않음). 같은 키가 두 번 있는 설정은 `invalid-config`. 심볼릭 링크는 대상에,
 *    하드 링크는 제자리에 쓴다. 우리 백업은 최근 `CLAUDE_BACKUPS_KEPT` 개만. Windows 에서는 경로를 대소문자 ·
 *    구분자 없이 비교한다.
 * 모든 경로는 주입할 수 있다(`configPath` · `pathOptions`) — 시험은 진짜 설정에 닿지 않는다.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PORT_FILE_ENV, STANDALONE_ENV, atomicWriteFile, sleepSync } from './portFile';

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

/**
 * V5-15(d) · 경로 비교. Windows 에서는 대소문자 · `/` 와 `\` 를 가리지 않는다 — `process.execPath` 의 글자 꼴은 실행한
 * 방법을 따른다(소문자 경로로 띄우면 `C:\program files\…` — V5-S5 에서 확인). 그 밖의 OS 는 글자 그대로.
 */
export function samePath(a: unknown, b: unknown, platform: NodeJS.Platform = process.platform): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') { return false; }
    if (a === b) { return true; }
    if (platform !== 'win32') { return false; }
    const norm = (s: string) => path.win32.normalize(s).toLowerCase();
    return norm(a) === norm(b);
}

/** env 값 가운데 경로인 것(포트 파일)만 경로로 비교한다. 다른 값은 글자 그대로. */
function sameEnv(a: Record<string, unknown> | undefined, b: Record<string, string> | undefined, platform: NodeJS.Platform): boolean {
    const ea = Object.entries(a ?? {}).sort(([x], [y]) => x.localeCompare(y));
    const eb = Object.entries(b ?? {}).sort(([x], [y]) => x.localeCompare(y));
    return ea.length === eb.length && ea.every(([k, v], i) => eb[i][0] === k
        && (k === PORT_FILE_ENV ? samePath(v, eb[i][1], platform) : eb[i][1] === v));
}

/**
 * 설정에 있는 값이 이 항목과 같은가(env 키 순서 무관, 다른 키가 더 있으면 다르다).
 * `command` · `args` · 포트 파일 경로는 `samePath`(Windows 는 대소문자 · 구분자 무관).
 */
export function sameEntry(raw: unknown, expected: McpEntry, platform: NodeJS.Platform = process.platform): boolean {
    if (!isObject(raw)) { return false; }
    const extra = Object.keys(raw).filter(k => k !== 'command' && k !== 'args' && k !== 'env');
    const args = raw.args;
    const env = raw.env;
    return extra.length === 0
        && samePath(raw.command, expected.command, platform)
        && Array.isArray(args) && args.length === expected.args.length && args.every((a, i) => samePath(a, expected.args[i], platform))
        && (env === undefined || isObject(env))
        && sameEnv(env as JsonObject | undefined, expected.env, platform);
}

// ─── 설정 파일 읽기 ────────────────────────────────────────────────

interface TextFormat { indent: string; eol: string; finalNewline: boolean }

/** V5-06 · 읽은 순간의 파일 — 크기 · 수정 시각 · 내용 해시. 없으면 null. */
interface Fingerprint { size: number; mtimeMs: number; hash: string }

interface ReadConfig {
    exists: boolean;
    text: string | null;
    error?: string;
    cfg?: JsonObject;
    bom: boolean;
    format: TextFormat;
    /** 읽은 바이트 그대로(백업은 이것을 쓴다 — 읽은 것과 다른 것을 백업하지 않게) */
    raw?: Buffer;
    fingerprint: Fingerprint | null;
}

const DEFAULT_FORMAT: TextFormat = { indent: '  ', eol: '\n', finalNewline: true };

/** 원문의 들여쓰기 · 줄바꿈 꼴. 다시 쓸 때 따른다(다른 항목이 공연히 바뀌어 보이지 않게). */
function detectFormat(text: string): TextFormat {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const m = /\n([ \t]+)\S/.exec(text);
    return { indent: m ? m[1] : '  ', eol, finalNewline: /\n$/.test(text) || text.trim() === '' };
}

/** 파일을 한 번 열어 fstat 과 내용을 함께 읽는다(둘 사이에 바뀐 것을 섞지 않게). ENOENT 면 null. */
function readSnapshot(file: string): { raw: Buffer; fingerprint: Fingerprint } | null {
    let fd: number;
    try { fd = fs.openSync(file, 'r'); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') { return null; }
        throw err;
    }
    try {
        const st = fs.fstatSync(fd);
        const raw = fs.readFileSync(fd);
        return { raw, fingerprint: { size: st.size, mtimeMs: st.mtimeMs, hash: crypto.createHash('sha256').update(raw).digest('hex') } };
    } finally { fs.closeSync(fd); }
}

function sameFingerprint(a: Fingerprint | null, b: Fingerprint | null): boolean {
    if (!a || !b) { return a === b; }
    return a.size === b.size && a.mtimeMs === b.mtimeMs && a.hash === b.hash;
}

/**
 * V5-15(a) · 올바른 JSON 안에서 같은 객체에 같은 키가 두 번 있는가. 있으면 그 경로(`mcpServers.a`), 없으면 null.
 * JSON.parse 는 마지막 것만 남기므로 다시 쓰면 앞의 것이 말없이 사라진다 — 그런 설정은 손대지 않는다.
 * JSON.parse 를 지난 글에만 부른다(문법은 이미 맞다).
 */
export function findDuplicateKey(text: string): string | null {
    let i = 0;
    const ws = () => { while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\r' || text[i] === '\n')) { i++; } };
    const str = (): string => {
        const start = i;
        i++;
        while (i < text.length && text[i] !== '"') { i += text[i] === '\\' ? 2 : 1; }
        i++;
        return JSON.parse(text.slice(start, i)) as string;
    };
    const value = (where: string): string | null => {
        ws();
        const c = text[i];
        if (c === '{') {
            i++;
            ws();
            if (text[i] === '}') { i++; return null; }
            const seen = new Set<string>();
            for (;;) {
                ws();
                const key = str();
                const at = where ? `${where}.${key}` : key;
                if (seen.has(key)) { return at; }
                seen.add(key);
                ws();
                i++;                                   // ':'
                const inner = value(at);
                if (inner) { return inner; }
                ws();
                if (text[i] === ',') { i++; continue; }
                i++;                                   // '}'
                return null;
            }
        }
        if (c === '[') {
            i++;
            ws();
            if (text[i] === ']') { i++; return null; }
            for (let n = 0; ; n++) {
                const inner = value(`${where}[${n}]`);
                if (inner) { return inner; }
                ws();
                if (text[i] === ',') { i++; continue; }
                i++;                                   // ']'
                return null;
            }
        }
        if (c === '"') { str(); return null; }
        while (i < text.length && !',}] \t\r\n'.includes(text[i])) { i++; }   // 수 · true · false · null
        return null;
    };
    return value('');
}

function readConfig(file: string): ReadConfig {
    let snap: ReturnType<typeof readSnapshot>;
    try { snap = readSnapshot(file); } catch (err) {
        return { exists: true, text: null, bom: false, format: DEFAULT_FORMAT, fingerprint: null, error: `cannot read: ${(err as Error).message}` };
    }
    if (!snap) { return { exists: false, text: null, bom: false, format: DEFAULT_FORMAT, fingerprint: null }; }
    const { raw, fingerprint } = snap;
    const text = raw.toString('utf8');
    const bom = text.charCodeAt(0) === 0xfeff;
    const body = bom ? text.slice(1) : text;
    const format = detectFormat(body);
    const base = { exists: true, text, bom, format, raw, fingerprint };
    if (!body.trim()) { return { ...base, cfg: {} }; }
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch (err) {
        return { ...base, error: `not valid JSON: ${(err as Error).message}` };
    }
    if (!isObject(parsed)) { return { ...base, error: 'the config root is not a JSON object' }; }
    if (parsed.mcpServers !== undefined && !isObject(parsed.mcpServers)) {
        // 갈아 끼우면 남의 값을 지우게 된다 — 여기서 멈춘다.
        return { ...base, error: 'mcpServers is not a JSON object' };
    }
    let dup: string | null;
    try { dup = findDuplicateKey(body); } catch { dup = '(could not check)'; }
    if (dup) {
        return { ...base, error: `the key "${dup}" appears more than once; rewriting the file would silently drop one of them, so StCFSD leaves it alone` };
    }
    return { ...base, cfg: parsed };
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

/** 경로 비교의 기준 OS — 가짜 사용자(pathOptions.platform)를 주면 그것, 아니면 이 프로세스. */
function platformOf(opts: ClaudeDesktopOptions): NodeJS.Platform {
    return opts.pathOptions?.platform ?? process.platform;
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
        : sameEntry(current, opts.entry, platformOf(opts)) ? 'registered' : 'registered-elsewhere';
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

/**
 * V5-15(c) · 남겨 둘 우리 백업 수. 백업은 다른 서버의 비밀 env 까지 든 전체 사본이라 끝없이 쌓이면 안 된다.
 * 다섯 = 연결 · 끊기를 몇 번 되풀이해도 「연결 전」 사본이 남을 만큼, 그러면서 비밀 사본은 적게.
 */
export const CLAUDE_BACKUPS_KEPT = 5;

/** `<파일 이름>.stcfsd-backup-YYYYMMDD-HHMMSS[-n]` — 이 꼴만 우리 백업으로 본다(이름 꼴은 K1 그대로). */
function backupPattern(file: string): RegExp {
    const base = path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${base}\\.stcfsd-backup-(\\d{8})-(\\d{6})(?:-(\\d+))?$`);
}

/** 우리 백업 가운데 최근 `keep` 개만 남긴다. 이름이 꼴에 맞는 일반 파일만(링크 · 폴더 · 다른 이름은 보지도 않는다). */
export function pruneClaudeBackups(file: string, keep = CLAUDE_BACKUPS_KEPT): string[] {
    const dir = path.dirname(file);
    const re = backupPattern(file);
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { return []; }
    const ours = names.map((n) => ({ n, m: re.exec(n) })).filter((x) => x.m !== null).filter((x) => {
        try { return fs.lstatSync(path.join(dir, x.n)).isFile(); } catch { return false; }
    }).map((x) => ({ n: x.n, key: `${x.m![1]}${x.m![2]}`, seq: x.m![3] ? Number(x.m![3]) : 1 }));
    ours.sort((a, b) => a.key === b.key ? b.seq - a.seq : (a.key < b.key ? 1 : -1));   // 새것부터
    const removed: string[] = [];
    for (const old of ours.slice(Math.max(0, keep))) {
        try { fs.unlinkSync(path.join(dir, old.n)); removed.push(old.n); } catch { /* 다음 번에 */ }
    }
    return removed;
}

function fileMode(file: string): number | undefined {
    try { return fs.statSync(file).mode & 0o777; } catch { return undefined; }
}

/**
 * `config-busy`(V5-06) = 쓰는 동안 다른 프로그램(Claude Desktop 등)이 설정을 거듭 바꿔 쓰지 않았다 — 파일은 그 프로그램이
 * 쓴 그대로다.
 */
export type ClaudeFailReason = 'claude-not-installed' | 'invalid-config' | 'write-failed' | 'config-busy';

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

/**
 * V5-15(b) · 실제로 쓸 곳. rename 은 링크를 끊고 일반 파일로 바꾼다.
 *  - 심볼릭 링크 → `realpath` 의 대상에 쓴다(그 폴더의 임시 파일 + rename — 원자적). 대상을 풀 수 없으면(끊긴 링크 ·
 *    고리 · 권한) 쓰지 않고 `write-failed` 로 까닭을 밝힌다.
 *  - 하드 링크(링크 수 > 1) → rename 하면 다른 이름과 갈라진다. 백업을 둔 뒤 **제자리에** 고쳐 쓴다(원자적이지 않다 —
 *    쓰는 도중 꺼지면 백업으로 되돌린다).
 *  - 폴더가 링크(junction)인 것은 rename 이 그 안에서 일어나므로 그대로 둔다.
 */
function writeTarget(file: string): { path: string; inPlace: boolean } | { error: string } {
    let l: fs.Stats;
    try { l = fs.lstatSync(file); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') { return { path: file, inPlace: false }; }
        return { error: `cannot inspect the config (${(err as Error).message}); StCFSD did not write it` };
    }
    let real = file;
    if (l.isSymbolicLink()) {
        try { real = fs.realpathSync(file); } catch (err) {
            return { error: `the config is a link whose target cannot be resolved (${(err as Error).message}); StCFSD did not write it` };
        }
    }
    let s: fs.Stats;
    try { s = fs.statSync(real); } catch (err) {
        return { error: `cannot inspect the config (${(err as Error).message}); StCFSD did not write it` };
    }
    if (!s.isFile()) { return { error: 'the config is not a regular file; StCFSD did not write it' }; }
    return { path: real, inPlace: s.nlink > 1 };
}

/** 하드 링크 · 제자리 쓰기. Windows 잠금(EPERM/EBUSY/EACCES)은 atomicWriteFile 과 같이 다시 해 본다. */
function writeInPlace(file: string, text: string, beforeWrite: () => void): void {
    for (let attempt = 0; ; attempt++) {
        beforeWrite();
        let fd: number;
        try { fd = fs.openSync(file, 'r+'); } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) { throw err; }
            sleepSync(50 * (attempt + 1));
            continue;
        }
        try {
            fs.ftruncateSync(fd, 0);
            fs.writeSync(fd, text, 0, 'utf8');
            fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        return;
    }
}

/** 읽은 뒤 다른 프로그램이 설정을 바꿨다(V5-06) — 이번 시도는 버리고 다시 읽는다. */
class ConfigChangedError extends Error {
    constructor() { super('the config changed while StCFSD was writing it'); }
}

/** V5-06 · 다시 읽어 우리 한 가지 변경을 다시 얹는 시도 수(첫 시도 포함). 다 바뀌면 `config-busy`. */
export const CLAUDE_WRITE_ATTEMPTS = 4;

/** 한 번의 읽기에 대해 무엇을 할까 — 쓸 것이 없으면 `done`, 있으면 쓸 글 · 쓴 뒤 확인 · 성공 결과. */
type Step<T> =
    | { done: T | ClaudeFail }
    | { text: string; verify: (after: JsonObject) => string | null; result: (backup: string | undefined) => T };

/**
 * 읽기 → (우리 변경 한 가지) → 백업 → 쓰기 → 다시 읽어 확인. V5-06: rename(또는 제자리 쓰기) **바로 앞에서** 파일을 다시 보고
 * (크기 · 수정 시각 · 내용 해시) 읽은 것과 다르면 쓰지 않고, 이번 시도의 백업을 지운 뒤 처음부터(다시 읽어 그 위에 우리
 * 변경만) 한다. `CLAUDE_WRITE_ATTEMPTS` 번 다 바뀌면 `config-busy` — 덮어쓰지 않는다.
 * 남는 틈: 다시 본 때와 rename 사이(수 µs)에 끼어든 쓰기는 여전히 알 수 없다 — Claude Desktop 은 잠그지 않으므로 더 좁힐 수 없다.
 */
function changeConfig<T>(file: string, now: Date, step: (read: ReadConfig) => Step<T>): T | ClaudeFail {
    for (let attempt = 0; attempt < CLAUDE_WRITE_ATTEMPTS; attempt++) {
        const read = readConfig(file);
        const s = step(read);
        if ('done' in s) { return s.done; }
        const target = writeTarget(file);
        if ('error' in target) { return { ok: false, reason: 'write-failed', configPath: file, error: target.error }; }
        let backup: string | undefined;
        try {
            if (read.exists && read.raw) {
                // 읽은 바이트 그대로 백업한다(복사하는 사이에 바뀐 것을 백업하지 않게). 다른 서버의 비밀이 들었으니 0600.
                backup = backupPath(file, now);
                fs.writeFileSync(backup, read.raw, { flag: 'wx', mode: 0o600 });
            }
            const guard = () => {
                let nowSnap: ReturnType<typeof readSnapshot>;
                try { nowSnap = readSnapshot(file); } catch { throw new ConfigChangedError(); }
                if (!sameFingerprint(read.fingerprint, nowSnap ? nowSnap.fingerprint : null)) { throw new ConfigChangedError(); }
            };
            if (target.inPlace) {
                writeInPlace(target.path, s.text, guard);
            } else {
                atomicWriteFile(target.path, s.text, read.exists ? fileMode(target.path) : undefined, 'stcfsd-tmp', guard);
            }
        } catch (err) {
            if (err instanceof ConfigChangedError) {
                // 원본은 바뀌지 않았다 — 이번 시도의 백업은 필요 없다(우리가 방금 만든 그 파일만 지운다).
                if (backup) { try { fs.unlinkSync(backup); } catch { /* 남아도 해롭지 않다 */ } }
                sleepSync(20 * (attempt + 1));
                continue;
            }
            return { ok: false, reason: 'write-failed', configPath: file, error: (err as Error).message, backupPath: backup };
        }
        const check = readConfig(file);
        const problem = check.error ?? (check.cfg ? s.verify(check.cfg) : 'empty after write');
        if (problem) {
            return { ok: false, reason: 'write-failed', configPath: file,
                error: `re-read after writing does not match: ${problem}`, backupPath: backup };
        }
        if (backup) { pruneClaudeBackups(file); }
        return s.result(backup);
    }
    return {
        ok: false, reason: 'config-busy', configPath: file,
        error: `the config kept changing while StCFSD was writing it (${CLAUDE_WRITE_ATTEMPTS} tries); `
            + 'nothing was written. Try again; if it keeps happening, quit Claude Desktop first.',
    };
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
    const platform = platformOf(opts);
    const { file } = locateConfig(opts);
    if (!exists(path.dirname(file))) { return { ok: false, reason: 'claude-not-installed', configPath: file }; }
    return changeConfig<ClaudeConnectOk>(file, now, (read) => {
        if (read.error) { return { done: { ok: false, reason: 'invalid-config', configPath: file, error: read.error } }; }
        const cfg = read.cfg ?? {};
        const servers = serversOf(cfg);
        const previous = servers[CLAUDE_DESKTOP_SERVER_KEY];
        const others = Object.keys(servers).filter(k => k !== CLAUDE_DESKTOP_SERVER_KEY);
        if (previous !== undefined && sameEntry(previous, entry, platform)) {
            return { done: { ok: true, action: 'unchanged', configPath: file, wrote: false, others, restartRequired: false, entry } };
        }
        const value: McpEntry = { command: entry.command, args: [...entry.args], ...(entry.env ? { env: { ...entry.env } } : {}) };
        // 키 자리를 지킨다: 이미 있으면 그 자리에서 값만, 없으면 끝에.
        const next: JsonObject = { ...cfg, mcpServers: { ...servers, [CLAUDE_DESKTOP_SERVER_KEY]: value } };
        return {
            text: serialize(next, read),
            verify: (after) => !sameEntry(serversOf(after)[CLAUDE_DESKTOP_SERVER_KEY], entry, platform)
                ? 'stcfsd entry differs' : othersUnchanged(cfg, after),
            result: (backup) => ({
                ok: true,
                action: !read.exists ? 'created' : previous === undefined ? 'added' : 'updated',
                configPath: file, wrote: true, backupPath: backup,
                ...(previous !== undefined ? { previous } : {}),
                others, restartRequired: true, entry,
            }),
        };
    });
}

/** 이 설치본의 항목과 **같은** `mcpServers.stcfsd` 만 지운다. 다르면 그대로 두고 알린다. */
export function disconnectClaudeDesktop(opts: ClaudeDesktopOptions): ClaudeDisconnectOk | ClaudeFail {
    const now = (opts.now ?? (() => new Date()))();
    const platform = platformOf(opts);
    const { file } = locateConfig(opts);
    if (!exists(path.dirname(file))) { return { ok: false, reason: 'claude-not-installed', configPath: file }; }
    return changeConfig<ClaudeDisconnectOk>(file, now, (read) => {
        if (!read.exists) { return { done: { ok: true, action: 'absent', configPath: file, wrote: false, restartRequired: false } }; }
        if (read.error) { return { done: { ok: false, reason: 'invalid-config', configPath: file, error: read.error } }; }
        const cfg = read.cfg ?? {};
        const servers = serversOf(cfg);
        const current = servers[CLAUDE_DESKTOP_SERVER_KEY];
        if (current === undefined) { return { done: { ok: true, action: 'absent', configPath: file, wrote: false, restartRequired: false } }; }
        if (!sameEntry(current, opts.entry, platform)) {
            return { done: { ok: true, action: 'kept', configPath: file, wrote: false, current, restartRequired: false } };
        }
        const rest = { ...servers };
        delete rest[CLAUDE_DESKTOP_SERVER_KEY];
        const next: JsonObject = { ...cfg, mcpServers: rest };
        return {
            text: serialize(next, read),
            verify: (after) => CLAUDE_DESKTOP_SERVER_KEY in serversOf(after) ? 'stcfsd entry still present' : othersUnchanged(cfg, after),
            result: (backup) => ({ ok: true, action: 'removed', configPath: file, wrote: true, backupPath: backup, restartRequired: true }),
        };
    });
}
