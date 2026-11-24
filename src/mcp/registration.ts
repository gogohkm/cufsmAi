// 로컬 MCP 서버 등록 — 순수 로직 (vscode API 무의존, node 테스트 가능).
//
// 배경: 기존 setupMcpConfig는 워크스페이스 .mcp.json을 통째로 덮어써
// 사용자의 다른 MCP 서버 설정을 삭제했고, 등록 여부 확인·해제 수단이 없었다.
// 이 모듈은 병합(merge) 기반 등록/해제/상태 판정을 제공하고,
// 실제 파일 쓰기·검증·UI는 extension.ts 명령이 담당한다.

export const MCP_SERVER_KEY = 'stcfsd-section-designer';

export interface McpServerConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
}

export type MergeResult =
    | { ok: true; text: string; changed: boolean }
    | { ok: false; error: string };

export type RemoveResult =
    | { ok: true; text: string; removed: boolean }
    | { ok: false; error: string };

/** 브릿지 포트·번들 경로로 서버 설정 생성 */
export function buildServerConfig(serverPath: string, port: number): McpServerConfig {
    return {
        command: 'node',
        args: [serverPath],
        env: { STCFSD_MCP_PORT: String(port) },
    };
}

/** 기존 JSON에 우리 서버를 병합. 기존 파일이 깨졌으면 덮어쓰지 않고 에러. */
export function mergeServerConfig(
    existingText: string | undefined,
    key: string,
    config: McpServerConfig
): MergeResult {
    if (existingText === undefined || existingText.trim() === '') {
        return {
            ok: true,
            changed: true,
            text: JSON.stringify({ mcpServers: { [key]: config } }, null, 2),
        };
    }
    let existing: any;
    try {
        existing = JSON.parse(existingText);
    } catch {
        return { ok: false, error: '기존 JSON 파싱 실패 — 덮어쓰지 않았습니다' };
    }
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
        return { ok: false, error: '기존 JSON이 객체가 아님 — 덮어쓰지 않았습니다' };
    }
    if (existing.mcpServers === undefined) {
        existing.mcpServers = {};
    }
    if (existing.mcpServers === null || typeof existing.mcpServers !== 'object') {
        return { ok: false, error: '기존 mcpServers가 객체가 아님 — 덮어쓰지 않았습니다' };
    }
    // R8-22: 우리 항목이 이미 같은 내용이면(키 순서 무관) 파일 글을 한 글자도 바꾸지 않는다 —
    // 호출자가 changed=false 를 보고 쓰지 않는 것이 원칙이지만, 쓰더라도 사용자 파일의 들여쓰기 ·
    // 줄바꿈 · 다른 서버 항목의 표기가 다시 직렬화되지 않게 원문을 그대로 돌려준다.
    if (canonicalJson(existing.mcpServers[key]) === canonicalJson(config)) {
        return { ok: true, changed: false, text: existingText };
    }
    existing.mcpServers[key] = config;
    return { ok: true, changed: true, text: JSON.stringify(existing, null, 2) };
}

/** 키 순서와 무관한 비교용 직렬화 */
function canonicalJson(v: any): string {
    if (v === undefined) { return 'undefined'; }
    if (v === null || typeof v !== 'object') { return JSON.stringify(v); }
    if (Array.isArray(v)) { return '[' + v.map(canonicalJson).join(',') + ']'; }
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

/** 쓰기 계획: 파일을 실제로 써야 하는지. 활성화 때마다 같은 내용을 다시 쓰지 않게 호출자가 쓴다. */
export function planServerConfigWrite(
    existingText: string | undefined,
    key: string,
    config: McpServerConfig
): { ok: true; write: boolean; text: string } | { ok: false; error: string } {
    const merged = mergeServerConfig(existingText, key, config);
    if (!merged.ok) { return merged; }
    return { ok: true, write: merged.changed, text: merged.text };
}

/** 기존 JSON에서 우리 서버만 제거. 다른 서버는 보존. */
export function removeServerConfig(
    existingText: string | undefined,
    key: string
): RemoveResult {
    if (existingText === undefined || existingText.trim() === '') {
        return { ok: true, text: '', removed: false };
    }
    let existing: any;
    try {
        existing = JSON.parse(existingText);
    } catch {
        return { ok: false, error: '기존 JSON 파싱 실패 — 변경하지 않았습니다' };
    }
    if (!existing || typeof existing !== 'object' || !existing.mcpServers
        || !(key in existing.mcpServers)) {
        return { ok: true, text: existingText, removed: false };
    }
    delete existing.mcpServers[key];
    return { ok: true, text: JSON.stringify(existing, null, 2), removed: true };
}

export type RegisterScope = 'workspace' | 'global' | 'both';

export interface ScopePathsOptions {
    workspaceRoot?: string;
    homeDir: string;
}

function joinPath(...parts: string[]): string {
    return parts.join('/').replace(/\/+/g, '/');
}

/** 스코프별 설정 파일 경로 목록 */
export function configPathsForScope(scope: RegisterScope, opts: ScopePathsOptions): string[] {
    const paths: string[] = [];
    if ((scope === 'workspace' || scope === 'both') && opts.workspaceRoot) {
        paths.push(joinPath(opts.workspaceRoot, '.mcp.json'));
        paths.push(joinPath(opts.workspaceRoot, '.claude', 'mcp.json'));
    }
    if (scope === 'global' || scope === 'both') {
        paths.push(joinPath(opts.homeDir, '.claude', 'mcp.json'));
    }
    return paths;
}

/** 상태 표시용 파싱: 파일별 등록 여부·포트 */
export interface RegistrationState {
    path: string;
    exists: boolean;
    registered: boolean;
    port?: string;
    error?: string;
}

export function inspectRegistration(
    path: string,
    existingText: string | undefined,
    key: string
): RegistrationState {
    if (existingText === undefined) {
        return { path, exists: false, registered: false };
    }
    let parsed: any;
    try {
        parsed = JSON.parse(existingText);
    } catch {
        return { path, exists: true, registered: false, error: 'JSON 파싱 실패' };
    }
    const entry = parsed?.mcpServers?.[key];
    if (!entry) {
        return { path, exists: true, registered: false };
    }
    return { path, exists: true, registered: true, port: entry?.env?.STCFSD_MCP_PORT };
}
