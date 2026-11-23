/**
 * K2-1 — 검토 대상의 상태(CaseState). 순수 모듈 — vscode · 파일 · 화면을 쓰지 않는다. 아직 아무도 부르지 않는다.
 *
 * 설계: docs/implementation/20261123-k2-design.md §2(모양 · 단위 · 판) · §3(쓰는 이 · 충돌) · §6(.csd 1.4 · 이전 판).
 * 표는 하나 — webview/js/designState.js 의 FIELDS(다섯째 열 meta: owner · group · def · inv · opts). 화면과 호스트가 같은 파일을 읽는다.
 *
 *  - 값은 늘 US 내부값(FIELDS 의 단위 종류). 빈 칸 = null.
 *  - owner 'case' 만 상태의 inputs 에 둔다. 'mirror'(fyLoad · fuPre · plasticFy)는 주인 키(fy · fu) 하나로,
 *    'model'(해석 조건 · 템플릿 · E/ν/G 19 키)은 호스트 모델이 주인이라 두지 않는다, 'view'(cFSM 표시 체크)는 view 로.
 *  - rev 는 받아들인 변경마다 +1(보기 설정 · 같은 값 다시 쓰기는 세지 않는다). revs[key] = 그 키가 마지막으로 바뀐 판.
 */

const DS: DesignStateModule = require('../../webview/js/designState');

export const CASE_SCHEMA = 'stcfsd-case/1';

export type Source = 'default' | 'user' | 'ai' | 'file' | 'load-analysis' | 'mirror';
export type Owner = 'case' | 'mirror' | 'model' | 'view';
export type Invalidation = 'load' | 'design' | 'connection' | 'analysis-at-run' | 'none';
export type InputValue = number | string | boolean | number[] | null;

export interface FieldMeta {
    key: string; id: string; unit: string | null; kind: 'num' | 'sel' | 'chk' | 'list';
    owner: Owner; group: string; def: unknown; src: 'page' | 'steel' | 'blank' | 'model' | 'mirror'; inv: Invalidation;
    opts?: string[]; optSpan?: (string | null)[]; mirrorOf?: string; follows?: string;
}

export interface SpanTable {
    spans: (number | null)[];                                        // ft
    supports: string[];                                              // P · R · F · N
    lapsPerSupport: { left: number | null; right: number | null }[]; // ft, 칸이 없는 쪽은 null
}

export interface CaseView {
    unitSystem: 'US' | 'SI';
    cfsm: Record<string, boolean>;   // chkCfsmEnable · G · D · L · O
}

export interface CaseState {
    schema: typeof CASE_SCHEMA;
    rev: number;
    units: 'US';
    inputs: Record<string, InputValue>;
    spans: SpanTable;
    sources: Record<string, Source>;
    revs: Record<string, number>;
    /** 화면 칸이 없는 MCP 인자 — 도구 이름 → 인자(K2-5 부터 쓴다) */
    mcpOnly: Record<string, Record<string, unknown>>;
    view: CaseView;
}

/** .csd 1.4 의 `case` */
export interface CaseRecord {
    schema: string; units: 'US'; rev: number;
    inputs: Record<string, InputValue>; spans: SpanTable; sources: Record<string, Source>;
    mcpOnly: Record<string, Record<string, unknown>>; view: CaseView;
}

/** designState.js 가 내보내는 것 가운데 이 모듈이 쓰는 것 */
interface DesignStateModule {
    FIELDS: [string, string, string | null, string, Omit<FieldMeta, 'key' | 'id' | 'unit' | 'kind'>][];
    KEYS: Record<Owner, string[]>;
    fieldMeta(key: string): FieldMeta | null;
    defaultValue(key: string): InputValue | undefined;
    defaultSpanTable(spanType: string, nSpans: number): SpanTable;
    spanCount(spanType: string, nSpans: number): number;
    matchOption(key: string, value: unknown): string | null;
    validateValue(key: string, value: unknown, opts?: { owners?: Owner[] }): string | null;
    validateSpanTable(t: SpanTable, spanType: string, nSpans: number): string[];
    invalidationScope(keys: string[]): { scope: Invalidation; analysisAtRun: boolean };
}

const SPAN_KEYS = ['spans', 'supports', 'lapsPerSupport'] as const;
/** 옛 파일에 있을 수 있는, 표 밖의 키(읽을 때 경고하지 않는다) */
const KNOWN_EXTRA = new Set(['unitSystem', 'analysisMethod', 'analysisLoadP', 'analysisLoadMxx', 'analysisLoadMzz', ...SPAN_KEYS]);
/** 사람이 정한 값(무엇을 덮었는지 알릴 대상 — 결정 1 의 덧붙임) */
const PERSON_SOURCES: Source[] = ['user', 'file', 'load-analysis'];

export function fieldMeta(key: string): FieldMeta | null { return DS.fieldMeta(key); }
export function caseKeys(): string[] { return [...DS.KEYS.case]; }
export function modelKeys(): string[] { return [...DS.KEYS.model]; }
export function invalidationScope(keys: string[]): { scope: Invalidation; analysisAtRun: boolean } { return DS.invalidationScope(keys); }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** 모든 키가 처음 값(출처 default)인 상태. */
export function createCaseState(): CaseState {
    const inputs: Record<string, InputValue> = {};
    const sources: Record<string, Source> = {};
    const revs: Record<string, number> = {};
    for (const k of DS.KEYS.case) { inputs[k] = clone(DS.defaultValue(k) as InputValue); sources[k] = 'default'; revs[k] = 0; }
    const spans = DS.defaultSpanTable(String(inputs.spanType), Number(inputs.nSpans));
    for (const k of SPAN_KEYS) { sources[k] = 'default'; revs[k] = 0; }
    const cfsm: Record<string, boolean> = {};
    for (const k of DS.KEYS.view) { cfsm[k] = DS.defaultValue(k) as boolean; }
    return { schema: CASE_SCHEMA, rev: 0, units: 'US', inputs, spans, sources, revs, mcpOnly: {}, view: { unitSystem: 'SI', cfsm } };
}

// ── 이전 판(1.0 – 1.3)과 1.4 ────────────────────────────────────────────────

export interface MigrateResult {
    state: CaseState;
    /** 파일의 판(없으면 '1.0') */
    fromVersion: string;
    /** 사람이 읽는 알림(모르는 키, 선택지가 아닌 값, R 0.70 의 경간 조건 …) */
    warnings: string[];
    /** 파일의 designInputs 에 든 모델 키 값(초안 — 상태에는 두지 않는다. 열 때는 모델이 이긴다: 고정값 csd-model-differs) */
    modelDrafts: Record<string, InputValue>;
    /** V7-07: 파일이 적은 출처 가운데 열 때 'file' 로 바꾼 것(키 → 파일에 적힌 출처) — 보여 주기만, 「덮은 값」 판단에는 쓰지 않는다 */
    recordedSources?: Record<string, Source>;
}

/** V7-09: .csd 의 case.mcpOnly 로 받는 것 — 이 호스트가 쓰는 도구 이름, 인자 이름 꼴, 크기 상한(넘으면 버리고 알린다) */
export const MCP_ONLY_TOOLS = ['aisi_design_flexure', 'aisi_design_compression', 'aisi_design_combined', 'aisi_design_tension',
    'aisi_design_connection', 'design_purlin', 'analyze_loads', 'design_connection', 'design_lap_connection'] as const;
export const MCP_ONLY_LIMITS = { argBytes: 16 * 1024, toolBytes: 64 * 1024, totalBytes: 256 * 1024 } as const;
const ARG_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** 파일의 mcpOnly → 받을 것(규칙은 위). 버린 것은 warnings 에 */
export function sanitizeMcpOnly(raw: unknown, warnings: string[]): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return out; }
    let total = 0;
    for (const [tool, args] of Object.entries(raw as Record<string, unknown>)) {
        if (!(MCP_ONLY_TOOLS as readonly string[]).includes(tool)) { warnings.push(`case.mcpOnly: '${tool.slice(0, 64)}' is not a design tool of this program — dropped`); continue; }
        if (!args || typeof args !== 'object' || Array.isArray(args)) { warnings.push(`case.mcpOnly.${tool}: not an argument object — dropped`); continue; }
        const keep: Record<string, unknown> = {};
        let toolBytes = 0;
        for (const [name, v] of Object.entries(args as Record<string, unknown>)) {
            const bytes = Buffer.byteLength(JSON.stringify(v ?? null) || 'null', 'utf8');
            if (!ARG_NAME.test(name)) { warnings.push(`case.mcpOnly.${tool}: an argument name that is not an identifier — dropped`); continue; }
            if (bytes > MCP_ONLY_LIMITS.argBytes || toolBytes + bytes > MCP_ONLY_LIMITS.toolBytes || total + bytes > MCP_ONLY_LIMITS.totalBytes) {
                warnings.push(`case.mcpOnly.${tool}.${name}: ${bytes} B is over the size limit — dropped`);
                continue;
            }
            keep[name] = clone(v);
            toolBytes += bytes;
            total += bytes;
        }
        if (Object.keys(keep).length) { out[tool] = keep; }
    }
    return out;
}

/**
 * 1.1 – 1.3 의 designInputs → 상태. 지금 화면의 복원(designState.restoreDesignInputs)과 같은 규칙:
 *  먼저 모든 키를 처음 값으로(V4-10), 파일 값을 얹는다. 빈 수 칸은 빈 칸(null), 선택 · 체크의 null 은 건너뛴다.
 *  거울: fy = fy ?? fyLoad (fyLoad · plasticFy 의 다른 값은 버린다 — 지금과 같다), fu = fu ?? fuPre
 *  (지금 화면은 ① Fu 에 fuPre 를 남겨 탭마다 다르게 보인다 — 결함 D-3, 상태에는 하나).
 *  경간 표: spanType · nSpans 로 만든 표의 칸에만(없는 칸의 값은 버린다 — 화면 _fillSpans 와 같다).
 */
export function readDesignInputs(di: Record<string, unknown> | null | undefined): { state: CaseState; warnings: string[]; modelDrafts: Record<string, InputValue> } {
    const state = createCaseState();
    const warnings: string[] = [];
    const modelDrafts: Record<string, InputValue> = {};
    if (!di || typeof di !== 'object') { return { state, warnings, modelDrafts }; }
    const put = (k: string, v: unknown): void => {
        const m = DS.fieldMeta(k);
        if (!m) { return; }
        if ((m.kind === 'chk' || m.kind === 'sel') && v == null) { return; }
        let val: unknown = v;
        if (m.kind === 'num' && (v == null || typeof v !== 'number' || !isFinite(v))) { val = null; }
        if (m.kind === 'list' && v != null && !Array.isArray(v)) { val = null; }
        if (m.kind === 'list' && Array.isArray(v) && v.length === 0) { val = null; }
        if (m.kind === 'sel' && typeof v === 'string' && !(m.opts || []).includes(v)) {
            const hit = DS.matchOption(k, v);
            if (hit === null) { warnings.push(`'${k}' 의 값 ${JSON.stringify(v)} 은(는) 선택지가 아니라 처음 값을 둔다`); return; }
            warnings.push(`'${k}' 의 값 ${JSON.stringify(v)} 을(를) 선택지 ${JSON.stringify(hit)} 로 읽었다`);
            val = hit;
        }
        const err = DS.validateValue(k, val);
        if (err) { warnings.push(err); return; }
        state.inputs[k] = clone(val as InputValue);
        state.sources[k] = 'file';
    };
    for (const [k, v] of Object.entries(di)) {
        const m = DS.fieldMeta(k);
        if (!m) { if (!KNOWN_EXTRA.has(k)) { warnings.push(`모르는 입력 키 '${k}' 은(는) 버린다`); } continue; }
        if (v === undefined) { continue; }
        if (m.owner === 'case') { put(k, v); }
        else if (m.owner === 'model') { modelDrafts[k] = clone(v as InputValue); }
        else if (m.owner === 'view') { if (typeof v === 'boolean') { state.view.cfsm[k] = v; } }
    }
    // 거울 — 지금 복원의 규칙(restoredFy = fy ?? fyLoad, Fu 는 fu ?? fuPre)
    if (di.fy == null && typeof di.fyLoad === 'number') { put('fy', di.fyLoad); }
    else if (di.fy == null && di.fyLoad === null && 'fyLoad' in di) { put('fy', null); }
    if (di.fu == null && typeof di.fuPre === 'number') { put('fu', di.fuPre); }
    if (typeof di.fy === 'number' && ((typeof di.fyLoad === 'number' && di.fyLoad !== di.fy) || (typeof di.plasticFy === 'number' && di.plasticFy !== di.fy))) {
        warnings.push(`파일의 Fy 가 탭마다 다르다(설계 ${di.fy} · ① ${di.fyLoad} · 소성 ${di.plasticFy} ksi) — 설계 Fy ${di.fy} 하나로 읽었다`);
    }
    if (typeof di.fu === 'number' && typeof di.fuPre === 'number' && di.fuPre !== di.fu) {
        warnings.push(`파일의 Fu 가 탭마다 다르다(설계 ${di.fu} · ① ${di.fuPre} ksi) — 설계 Fu ${di.fu} 하나로 읽었다(결함 D-3)`);
    }
    // R 0.70: 선택지 둘(단순 · 연속)이 같은 값이다 — 파일은 값만 담았다(결함 D-1). 지금 화면처럼 첫 것(단순)으로 읽고 알린다.
    if (state.inputs.rValue === '0.70') {
        warnings.push('§I6.2.1 R 0.70 의 경간 조건(단순 · 연속)을 파일이 담지 않았다 — 단순으로 읽었다(지금 화면과 같다)');
    }
    // 경간 표: 그 경간 유형의 표를 만들고 있는 칸에만 얹는다
    const table = DS.defaultSpanTable(String(state.inputs.spanType), Number(state.inputs.nSpans));
    const spans = Array.isArray(di.spans) ? di.spans as unknown[] : null;
    const sups = Array.isArray(di.supports) ? di.supports as unknown[] : null;
    const laps = Array.isArray(di.lapsPerSupport) ? di.lapsPerSupport as unknown[] : null;
    const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
    if (spans) { table.spans = table.spans.map((d, i) => (i < spans.length ? num(spans[i]) : d)); state.sources.spans = 'file'; }
    if (sups) {
        table.supports = table.supports.map((d, i) => (typeof sups[i] === 'string' && ['P', 'R', 'F', 'N'].includes(sups[i] as string) ? sups[i] as string : d));
        state.sources.supports = 'file';
    }
    if (laps) {
        table.lapsPerSupport = table.lapsPerSupport.map((d, i) => {
            const l = laps[i] as { left?: unknown; right?: unknown } | undefined;
            if (!l || typeof l !== 'object') { return d; }
            return {
                left: d.left !== null && 'left' in l ? num(l.left) : d.left,
                right: d.right !== null && 'right' in l ? num(l.right) : d.right,
            };
        });
        state.sources.lapsPerSupport = 'file';
    }
    state.spans = table;
    if (di.unitSystem === 'US' || di.unitSystem === 'SI') { state.view.unitSystem = di.unitSystem; }
    return { state, warnings, modelDrafts };
}

/** .csd 1.4 의 `case` → 상태(키 · 종류 · 선택지를 검사하고, 맞지 않는 것은 버리고 알린다 — V5b-01 과 같은 태도). */
export function readCaseRecord(rec: unknown): { state: CaseState; warnings: string[]; recordedSources: Record<string, Source> } {
    const state = createCaseState();
    const warnings: string[] = [];
    const recordedSources: Record<string, Source> = {};
    const r = rec as Partial<CaseRecord> | null;
    if (!r || typeof r !== 'object') { warnings.push('case 가 비었다 — 처음 값'); return { state, warnings, recordedSources }; }
    if (r.schema !== CASE_SCHEMA) { warnings.push(`case 의 판 ${JSON.stringify(r.schema)} 은(는) 이 빌드의 ${CASE_SCHEMA} 가 아니다 — 아는 키만 읽는다`); }
    for (const [k, v] of Object.entries(r.inputs || {})) {
        const m = DS.fieldMeta(k);
        if (!m || m.owner !== 'case') { warnings.push(`case 의 키 '${k}' 은(는) 검토 상태의 키가 아니라 버린다`); continue; }
        const err = v === null && (m.kind === 'sel' || m.kind === 'chk') ? null : DS.validateValue(k, v);
        if (err) { warnings.push(err); continue; }
        state.inputs[k] = clone(v);
        const src = (r.sources || {})[k];
        state.sources[k] = isSource(src) ? src : 'file';
        // V7-07: 파일의 꼬리표를 그대로 믿지 않는다 — 처음 값과 다른 값을 'default' · 'ai' · 'mirror' 로 적었으면 열 때는 'file'
        // (연 사람의 값 — 설계 도구가 덮으면 case_inputs_replaced 에 나온다). 적힌 출처는 recordedSources 로 따로(보여 주기만).
        if (isSource(src) && FILE_RETAGGED.includes(src) && v !== null && JSON.stringify(v) !== JSON.stringify(DS.defaultValue(k))) {
            state.sources[k] = 'file';
            recordedSources[k] = src;
        }
    }
    if (r.spans) {
        const errs = DS.validateSpanTable(r.spans, String(state.inputs.spanType), Number(state.inputs.nSpans));
        if (errs.length) { warnings.push(...errs.map((e) => `case 경간 표: ${e} — 처음 값`)); }
        else {
            state.spans = clone(r.spans);
            for (const k of SPAN_KEYS) { const s = (r.sources || {})[k]; state.sources[k] = isSource(s) ? s : 'file'; }
        }
    }
    state.mcpOnly = sanitizeMcpOnly(r.mcpOnly, warnings);
    if (r.view && (r.view.unitSystem === 'US' || r.view.unitSystem === 'SI')) { state.view.unitSystem = r.view.unitSystem; }
    if (r.view && r.view.cfsm) { for (const k of DS.KEYS.view) { if (typeof r.view.cfsm[k] === 'boolean') { state.view.cfsm[k] = r.view.cfsm[k]; } } }
    state.rev = Number.isInteger(r.rev) && (r.rev as number) >= 0 ? r.rev as number : 0;
    for (const k of Object.keys(state.revs)) { state.revs[k] = 0; }
    return { state, warnings, recordedSources };
}
const FILE_RETAGGED: Source[] = ['default', 'ai', 'mirror'];

function isSource(s: unknown): s is Source {
    return typeof s === 'string' && ['default', 'user', 'ai', 'file', 'load-analysis', 'mirror'].includes(s);
}

/**
 * `.csd` 한 벌 → 상태. 1.4 는 `case` 를, 1.1 – 1.3 은 `designInputs` 를, 1.0 · MCP 원시 모델(입력 기록 없음)은 처음 값.
 * 2.x 이상은 지금처럼 호출자(_loadProjectFile)가 거절한다 — 여기서는 판을 그대로 돌려준다.
 */
export function migrateProject(projectData: unknown): MigrateResult {
    const p = (projectData && typeof projectData === 'object' ? projectData : {}) as Record<string, unknown>;
    const fromVersion = typeof p.version === 'string' ? p.version : '1.0';
    if (p.case && typeof p.case === 'object') {
        const { state, warnings, recordedSources } = readCaseRecord(p.case);
        const di = p.designInputs as Record<string, unknown> | undefined;
        const modelDrafts: Record<string, InputValue> = {};
        if (di && typeof di === 'object') { for (const k of DS.KEYS.model) { if (k in di) { modelDrafts[k] = clone(di[k] as InputValue); } } }
        return { state, fromVersion, warnings, modelDrafts, recordedSources };
    }
    const { state, warnings, modelDrafts } = readDesignInputs(p.designInputs as Record<string, unknown> | null);
    return { state, fromVersion, warnings, modelDrafts };
}

/** 상태 → .csd 1.4 의 `case` */
export function toCaseRecord(state: CaseState): CaseRecord {
    return clone({ schema: state.schema, units: state.units, rev: state.rev, inputs: state.inputs, spans: state.spans,
        sources: state.sources, mcpOnly: state.mcpOnly, view: state.view });
}

/**
 * 상태 → 1.3 모양 designInputs(옛 빌드용 — 결정 5). 키 차례는 지금 collectDesignInputs 와 같다(unitSystem · analysisMethod ·
 * FIELDS 차례 · 경간 표). 거울 키는 주인 값, 모델 키는 modelInputs(호스트가 모델에서 만든 값 — 없으면 null).
 */
export function toDesignInputs13(state: CaseState, modelInputs?: Record<string, InputValue>): Record<string, unknown> {
    const out: Record<string, unknown> = { unitSystem: state.view.unitSystem, analysisMethod: 'DSM' };
    for (const [key] of DS.FIELDS) {
        const m = DS.fieldMeta(key) as FieldMeta;
        if (m.owner === 'case') { out[key] = clone(state.inputs[key]); }
        else if (m.owner === 'mirror') { out[key] = clone(state.inputs[m.mirrorOf as string]); }
        else if (m.owner === 'view') { out[key] = state.view.cfsm[key]; }
        else { out[key] = modelInputs && key in modelInputs ? clone(modelInputs[key]) : null; }
    }
    out.spans = clone(state.spans.spans);
    out.supports = clone(state.spans.supports);
    out.lapsPerSupport = clone(state.spans.lapsPerSupport);
    return out;
}

// ── 쓰기 ────────────────────────────────────────────────────────────────

export interface ApplyResult {
    state: CaseState;
    /** 받아들인 키(거울은 주인 키로) */
    accepted: string[];
    /** 받지 않은 키와 까닭(검사 실패 · 충돌) */
    rejected: { key: string; reason: string }[];
    /** 그 가운데 충돌(baseRev 뒤에 다른 쓰는 이가 바꾼 키) — 화면은 그 칸에 지금 상태를 다시 얹는다 */
    conflicts: string[];
}

/**
 * 키를 합쳐 쓴다(받은 키만). 설계 §3.2:
 *  - 마지막에 쓴 것이 이긴다 — 키마다.
 *  - opts.baseRev 가 있으면(화면의 caseEdit) 그 판 뒤에 **다른 쓰는 이**가 바꾼 키는 받지 않는다(사람이 본 적 없는 값을 덮지 않는다).
 *  - 같은 값은 변경이 아니다(rev 를 올리지 않는다). 보기(unitSystem)도 rev 를 올리지 않는다.
 *  - 거울 키(fyLoad · fuPre · plasticFy)는 주인 키로 바꿔 쓴다. 주인 키가 같은 묶음에 있으면 주인 키가 이긴다.
 *  - Fy · Fu 가 바뀌면 접합 Fy · Fu 가 따라 바뀐다(지금 화면의 syncFyValue · syncFuValue — 출처 mirror).
 *  - 경간 표(spans · supports · lapsPerSupport)는 바뀐 spanType · nSpans 로 검사한다.
 */
export function applyChanges(state0: CaseState, changes: Record<string, unknown>, writer: Source,
    opts: { baseRev?: number; keepSource?: boolean } = {}): ApplyResult {
    const state = clone(state0);
    const accepted: string[] = [];
    const rejected: { key: string; reason: string }[] = [];
    const conflicts: string[] = [];
    const nextRev = state.rev + 1;
    const conflicted = (k: string): boolean => opts.baseRev !== undefined && (state.revs[k] ?? 0) > opts.baseRev && state.sources[k] !== writer;
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(changes || {})) {
        const m = DS.fieldMeta(k);
        if (m && m.owner === 'mirror') { const p = m.mirrorOf as string; if (!(p in changes)) { mapped[p] = v; } continue; }
        mapped[k] = v;
    }
    const write = (k: string, v: unknown, src: Source): void => {
        if (JSON.stringify(state.inputs[k]) === JSON.stringify(v)) { return; }
        state.inputs[k] = clone(v as InputValue);
        // 단위 전환의 다시 쓰기(keepSource)는 값의 출처를 바꾸지 않는다 — 사람이 정한 값은 사람의 것으로 남는다
        if (!opts.keepSource) { state.sources[k] = src; }
        state.revs[k] = nextRev;
        if (!accepted.includes(k)) { accepted.push(k); }
    };
    for (const [k, v] of Object.entries(mapped)) {
        if ((SPAN_KEYS as readonly string[]).includes(k)) { continue; }
        if (k === 'unitSystem') {
            if (v === 'US' || v === 'SI') { state.view.unitSystem = v; } else { rejected.push({ key: k, reason: `unitSystem 은 'US' · 'SI'` }); }
            continue;
        }
        const m = DS.fieldMeta(k);
        if (m && m.owner === 'view') {
            if (typeof v === 'boolean') { state.view.cfsm[k] = v; } else { rejected.push({ key: k, reason: `'${k}' 는 true/false 여야 한다` }); }
            continue;
        }
        const err = DS.validateValue(k, v);
        if (err) { rejected.push({ key: k, reason: err }); continue; }
        if (conflicted(k)) { conflicts.push(k); rejected.push({ key: k, reason: `'${k}' 은(는) 판 ${opts.baseRev} 뒤에 ${state.sources[k]} 가 바꿨다 — 덮지 않는다` }); continue; }
        write(k, v, writer);
        const follower = k === 'fy' ? 'connFy' : (k === 'fu' ? 'connFu' : null);
        // 접합 Fy · Fu 의 따름: 지금 화면은 사람이 ① Fy · Fu(또는 소성 fy · 강종)를 고칠 때만 접합 칸에 복사한다(syncFyValue) —
        // 파일을 열 때는 복사하지 않는다. 그래서 사람 · AI 의 쓰기에만 따른다(화면의 caseEdit 는 접합 칸을 함께 보내므로 같은 값).
        if (follower && (writer === 'user' || writer === 'ai') && accepted.includes(k) && !(follower in mapped)) { write(follower, v, 'mirror'); }
    }
    const spanChanges = (SPAN_KEYS as readonly string[]).filter((k) => k in mapped);
    const tableShapeChanged = accepted.includes('spanType') || accepted.includes('nSpans');
    if (spanChanges.length || tableShapeChanged) {
        const cand: SpanTable = clone(state.spans);
        if ('spans' in mapped) { cand.spans = mapped.spans as SpanTable['spans']; }
        if ('supports' in mapped) { cand.supports = mapped.supports as SpanTable['supports']; }
        if ('lapsPerSupport' in mapped) { cand.lapsPerSupport = mapped.lapsPerSupport as SpanTable['lapsPerSupport']; }
        let table = cand;
        let errs = DS.validateSpanTable(table, String(state.inputs.spanType), Number(state.inputs.nSpans));
        if (errs.length && tableShapeChanged && !spanChanges.length) {
            // 경간 유형 · 수만 바뀌었다 — 화면처럼 표를 처음 값으로 다시 만든다(buildSpanTable)
            table = DS.defaultSpanTable(String(state.inputs.spanType), Number(state.inputs.nSpans));
            errs = [];
        }
        const blocked = spanChanges.filter((k) => conflicted(k));
        if (errs.length) { spanChanges.forEach((k) => rejected.push({ key: k, reason: errs.join(' · ') })); }
        else if (blocked.length) { blocked.forEach((k) => { conflicts.push(k); rejected.push({ key: k, reason: `'${k}' 은(는) 판 ${opts.baseRev} 뒤에 바뀌었다 — 덮지 않는다` }); }); }
        else {
            for (const k of SPAN_KEYS) {
                if (JSON.stringify(state.spans[k]) === JSON.stringify(table[k])) { continue; }
                (state.spans as unknown as Record<string, unknown>)[k] = clone(table[k]);
                state.sources[k] = spanChanges.includes(k) ? writer : 'default';
                state.revs[k] = nextRev;
                accepted.push(k);
            }
        }
    }
    if (accepted.length) { state.rev = nextRev; }
    return { state, accepted, rejected, conflicts };
}

export interface ReplaceResult extends ApplyResult {
    /** 이번 호출이 덮은, 사람이 정했던 값(user · file · load-analysis) — MCP 응답에 싣는다(결정 1 의 덧붙임) */
    replaced: { key: string; previous: InputValue; previousSource: Source }[];
}

/**
 * MCP 설계 도구의 쓰기(결정 1): 그 도구의 인자 묶음(groupKeys)을 통째로 — 받은 키는 그 값, 받지 않은 키는 null(「AI: 주지 않음」).
 * 선택 · 체크도 null 로 둔다(그때 호스트 본문은 그 키를 빼고 보낸다 — 설계 §5.1). K2-5 에서 쓴다.
 */
export function replaceGroup(state0: CaseState, groupKeys: string[], args: Record<string, unknown>, writer: Source = 'ai'): ReplaceResult {
    const replaced: ReplaceResult['replaced'] = [];
    const rejected: { key: string; reason: string }[] = [];
    const changes: Record<string, unknown> = {};
    for (const k of groupKeys) {
        const m = DS.fieldMeta(k);
        if (!m || m.owner !== 'case') { rejected.push({ key: k, reason: `'${k}' 은(는) 검토 상태의 키가 아니다` }); continue; }
        changes[k] = k in args ? args[k] : null;
    }
    // 검사: 받은 값은 보통 검사, 받지 않은 것(null)은 선택 · 체크도 허용
    const state = clone(state0);
    const nextRev = state.rev + 1;
    const accepted: string[] = [];
    for (const [k, v] of Object.entries(changes)) {
        const m = DS.fieldMeta(k) as FieldMeta;
        const err = v === null && (m.kind === 'sel' || m.kind === 'chk') ? null : DS.validateValue(k, v);
        if (err) { rejected.push({ key: k, reason: err }); continue; }
        const prev = state.inputs[k];
        if (JSON.stringify(prev) === JSON.stringify(v)) { continue; }
        if (PERSON_SOURCES.includes(state.sources[k]) && prev !== null) {
            replaced.push({ key: k, previous: clone(prev), previousSource: state.sources[k] });
        }
        state.inputs[k] = clone(v as InputValue);
        state.sources[k] = writer;
        state.revs[k] = nextRev;
        accepted.push(k);
    }
    if (accepted.length) { state.rev = nextRev; }
    return { state, accepted, rejected, conflicts: [], replaced };
}
